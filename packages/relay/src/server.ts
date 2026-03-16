import { WebSocketServer as WSServer, WebSocket } from 'ws';
import type { IncomingMessage } from 'node:http';
import { validateObject } from '@agora/core';
import type { SignedObject, WireMessage, SubscriptionFilter } from '@agora/core';
import { config } from './config.js';
import { createChallenge, verifyAuth, type PendingAuth } from './auth.js';
import { ObjectStore } from './store.js';
import { SubscriptionManager } from './subscription.js';
import { RelaySync } from './sync.js';
import { RateLimiter } from './ratelimit.js';
import geoip from 'geoip-lite';

interface GeoInfo {
  city?: string;
  country?: string;
  countryCode?: string;
  region?: string;
  ll?: [number, number];
}

interface ClientState {
  id: string;
  ws: WebSocket;
  ip: string;
  publicKey?: string;
  x25519PublicKey?: string;
  authenticated: boolean;
  pendingAuth?: PendingAuth;
  geo?: GeoInfo;
  isSyncPeer?: boolean; // relay-to-relay sync connection
}

let clientCounter = 0;

export class RelayServer {
  private wss: WSServer;
  private clients: Map<string, ClientState> = new Map();
  private store: ObjectStore;
  private subscriptions: SubscriptionManager;
  private sync: RelaySync;
  private rateLimiter: RateLimiter;
  private syncSubscribers: Set<string> = new Set(); // client IDs that want sync

  constructor(server: import('node:http').Server) {
    this.store = new ObjectStore();
    this.subscriptions = new SubscriptionManager();
    this.rateLimiter = new RateLimiter();

    // Relay-to-relay sync
    this.sync = new RelaySync(this.store, (obj) => {
      this.subscriptions.broadcast(obj, this.store);
    });
    this.sync.start();

    // Cleanup rate limiter periodically
    setInterval(() => this.rateLimiter.cleanup(), 60_000);

    this.wss = new WSServer({ server });
    this.wss.on('connection', (ws, req) => this.handleConnection(ws, req));

    console.log(`[Relay] WebSocket server ready (${this.store.size} objects in store)`);
  }

  private handleConnection(ws: WebSocket, req: IncomingMessage): void {
    const forwarded = req.headers['x-forwarded-for'];
    const ip = typeof forwarded === 'string' ? forwarded.split(',')[0].trim() : req.socket.remoteAddress || '';

    // Rate limit connections per IP
    if (!this.rateLimiter.addConnection(ip)) {
      ws.close(4029, 'Too many connections');
      return;
    }

    const clientId = `c${++clientCounter}`;
    const client: ClientState = { id: clientId, ws, ip, authenticated: false };
    this.clients.set(clientId, client);
    console.log(`[Relay] Client ${clientId} connected from ${ip}`);

    // Resolve geolocation
    const geo = geoip.lookup(ip);
    if (geo) {
      client.geo = {
        city: geo.city || undefined,
        country: geo.country ? regionName(geo.country) : undefined,
        countryCode: geo.country || undefined,
        region: geo.region || undefined,
        ll: geo.ll as [number, number] || undefined,
      };
      console.log(`[Relay] Client ${clientId} geo: ${client.geo.city || '?'}, ${client.geo.country || '?'}`);
    }

    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString());
        this.handleMessage(client, msg);
      } catch (e) {
        this.send(ws, { action: 'error', message: 'Invalid JSON' });
      }
    });

    ws.on('close', () => {
      this.subscriptions.removeAll(clientId);
      this.syncSubscribers.delete(clientId);
      this.rateLimiter.removeConnection(ip);
      this.clients.delete(clientId);
      console.log(`[Relay] Client ${clientId} disconnected`);
    });

    ws.on('error', (err) => {
      console.error(`[Relay] Client ${clientId} error:`, err.message);
    });
  }

  private handleMessage(client: ClientState, msg: any): void {
    switch (msg.action) {
      case 'hello':
        this.handleHello(client, msg);
        break;
      case 'auth':
        this.handleAuth(client, msg);
        break;
      case 'publish':
        this.handlePublish(client, msg);
        break;
      case 'subscribe':
        this.handleSubscribe(client, msg);
        break;
      case 'signal':
        this.handleSignal(client, msg);
        break;
      case 'peers':
        this.handlePeers(client);
        break;
      case 'relay_sync':
        this.handleRelaySync(client, msg);
        break;
      case 'relay_sync_object':
        this.handleRelaySyncObject(client, msg);
        break;
      default:
        this.send(client.ws, { action: 'error', message: `Unknown action: ${msg.action}` });
    }
  }

  private handleHello(client: ClientState, msg: { publicKey: string; x25519PublicKey?: string }): void {
    if (!msg.publicKey) {
      this.send(client.ws, { action: 'error', message: 'Missing publicKey' });
      return;
    }
    client.publicKey = msg.publicKey;
    if (msg.x25519PublicKey) client.x25519PublicKey = msg.x25519PublicKey;
    const { nonce, nonceBase64 } = createChallenge();
    client.pendingAuth = { nonce, createdAt: Date.now() };
    this.send(client.ws, { action: 'challenge', nonce: nonceBase64 });
  }

  private handleAuth(client: ClientState, msg: { signature: string; nonce: string }): void {
    if (!client.pendingAuth || !client.publicKey) {
      this.send(client.ws, { action: 'auth_fail', reason: 'No pending challenge' });
      return;
    }

    const valid = verifyAuth(msg.signature, msg.nonce, client.publicKey, client.pendingAuth);
    client.pendingAuth = undefined;

    if (valid) {
      client.authenticated = true;
      this.send(client.ws, { action: 'auth_ok' });
      console.log(`[Relay] Client ${client.id} authenticated as ${client.publicKey.slice(0, 8)}...`);
    } else {
      this.send(client.ws, { action: 'auth_fail', reason: 'Invalid signature' });
    }
  }

  private handlePublish(client: ClientState, msg: { object: SignedObject }): void {
    if (!client.authenticated) {
      this.send(client.ws, { action: 'error', message: 'Not authenticated' });
      return;
    }
    if (!this.rateLimiter.check(client.publicKey || client.ip, 'publish')) {
      this.send(client.ws, { action: 'error', message: 'Rate limited: too many publishes' });
      return;
    }

    const obj = msg.object;
    if (!obj || !obj.body || !obj.id || !obj.sig) {
      this.send(client.ws, { action: 'error', message: 'Invalid object' });
      return;
    }

    const validation = validateObject(obj);
    if (!validation.valid) {
      this.send(client.ws, { action: 'error', message: `Validation failed: ${validation.error}` });
      return;
    }

    if (obj.body.author !== client.publicKey) {
      this.send(client.ws, { action: 'error', message: 'Author mismatch' });
      return;
    }

    const isNew = this.store.put(obj);
    if (isNew) {
      this.subscriptions.broadcast(obj, this.store);
      this.sync.broadcastToPeers(obj); // relay-to-relay sync
      // Forward to sync subscribers
      for (const subId of this.syncSubscribers) {
        const c = this.clients.get(subId);
        if (c) this.send(c.ws, { action: 'relay_sync_object', object: obj });
      }
    }
  }

  private handleSubscribe(client: ClientState, msg: { id: string; filters: SubscriptionFilter[] }): void {
    if (!client.authenticated) {
      this.send(client.ws, { action: 'error', message: 'Not authenticated' });
      return;
    }

    const subId = msg.id;
    if (!subId || !msg.filters) {
      this.send(client.ws, { action: 'error', message: 'Missing subscription id or filters' });
      return;
    }

    this.subscriptions.add(client.id, {
      id: subId,
      filters: msg.filters,
      send: (obj) => {
        this.send(client.ws, { action: 'event', subscriptionId: subId, object: obj });
      },
    });

    const matches = this.store.match(msg.filters);
    for (const obj of matches) {
      this.send(client.ws, { action: 'event', subscriptionId: subId, object: obj });
    }

    this.send(client.ws, { action: 'eose', subscriptionId: subId });
  }

  // Phase 3: WebRTC signaling
  private handleSignal(client: ClientState, msg: { target: string; signalType: string; data: any }): void {
    if (!client.authenticated || !client.publicKey) {
      this.send(client.ws, { action: 'error', message: 'Not authenticated' });
      return;
    }

    const { target, signalType, data } = msg;
    if (!target || !signalType || !data) {
      this.send(client.ws, { action: 'error', message: 'Missing signal fields' });
      return;
    }

    // Find target client by public key
    for (const [, c] of this.clients) {
      if (c.publicKey === target && c.authenticated) {
        this.send(c.ws, {
          action: 'signal',
          source: client.publicKey,
          signalType,
          data,
        });
        return;
      }
    }
    // Target not found — silently drop
  }

  // Phase 3: List online peers with geo info
  private handlePeers(client: ClientState): void {
    if (!client.authenticated) {
      this.send(client.ws, { action: 'error', message: 'Not authenticated' });
      return;
    }

    const peers: Array<{ publicKey: string; geo?: GeoInfo; x25519PublicKey?: string }> = [];
    for (const [, c] of this.clients) {
      if (c.authenticated && c.publicKey && c.publicKey !== client.publicKey) {
        peers.push({ publicKey: c.publicKey, geo: c.geo, x25519PublicKey: c.x25519PublicKey });
      }
    }

    this.send(client.ws, { action: 'peers', peers });
  }

  // Relay-to-relay sync: peer relay subscribes to all new objects
  private handleRelaySync(client: ClientState, msg: { mode: string }): void {
    if (msg.mode === 'subscribe') {
      client.isSyncPeer = true;
      this.syncSubscribers.add(client.id);
      console.log(`[Sync] Peer ${client.id} subscribed for sync`);
      // Send all stored objects
      const all = this.store.match([{}]);
      console.log(`[Sync] Sending ${all.length} stored objects to ${client.id}`);
      for (const obj of all) {
        this.send(client.ws, { action: 'relay_sync_object', object: obj });
      }
      this.send(client.ws, { action: 'relay_sync_ready', count: all.length });
    }
  }

  // Incoming object from a peer relay
  private handleRelaySyncObject(client: ClientState, msg: { object: SignedObject }): void {
    if (!client.isSyncPeer) return;
    const obj = msg.object;
    if (!obj?.body || !obj.id || !obj.sig) return;
    if (this.store.has(obj.id)) return;

    const result = validateObject(obj);
    if (!result.valid) return;

    const isNew = this.store.put(obj);
    if (isNew) {
      this.subscriptions.broadcast(obj, this.store);
      // Forward to other sync peers
      for (const subId of this.syncSubscribers) {
        if (subId === client.id) continue;
        const c = this.clients.get(subId);
        if (c) this.send(c.ws, { action: 'relay_sync_object', object: obj });
      }
    }
  }

  private send(ws: WebSocket, msg: object): void {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(msg));
    }
  }

  getStats() {
    let authenticated = 0;
    const countries = new Set<string>();
    for (const c of this.clients.values()) {
      if (c.authenticated) authenticated++;
      if (c.geo?.countryCode) countries.add(c.geo.countryCode);
    }
    return {
      clients: this.clients.size,
      authenticated,
      objects: this.store.size,
      countries: countries.size,
      syncPeers: this.syncSubscribers.size,
      peerRelays: config.peerRelays.length,
      uptime: Math.floor(process.uptime()),
      region: process.env.FLY_REGION || process.env.PRIMARY_REGION || 'local',
    };
  }
}

// Convert 2-letter country code to name
const COUNTRY_NAMES: Record<string, string> = {
  US: 'United States', GB: 'United Kingdom', CA: 'Canada', AU: 'Australia',
  DE: 'Germany', FR: 'France', JP: 'Japan', BR: 'Brazil', IN: 'India',
  CN: 'China', KR: 'South Korea', MX: 'Mexico', ES: 'Spain', IT: 'Italy',
  NL: 'Netherlands', SE: 'Sweden', NO: 'Norway', DK: 'Denmark', FI: 'Finland',
  CH: 'Switzerland', AT: 'Austria', BE: 'Belgium', PT: 'Portugal', PL: 'Poland',
  CZ: 'Czech Republic', RO: 'Romania', HU: 'Hungary', IE: 'Ireland',
  NZ: 'New Zealand', SG: 'Singapore', HK: 'Hong Kong', TW: 'Taiwan',
  AR: 'Argentina', CL: 'Chile', CO: 'Colombia', PE: 'Peru', UY: 'Uruguay',
  ZA: 'South Africa', NG: 'Nigeria', EG: 'Egypt', KE: 'Kenya',
  IL: 'Israel', AE: 'UAE', SA: 'Saudi Arabia', TR: 'Turkey',
  RU: 'Russia', UA: 'Ukraine', TH: 'Thailand', VN: 'Vietnam',
  PH: 'Philippines', MY: 'Malaysia', ID: 'Indonesia',
};

function regionName(code: string): string {
  return COUNTRY_NAMES[code] || code;
}
