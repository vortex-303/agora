import { WebSocketServer as WSServer, WebSocket } from 'ws';
import type { IncomingMessage } from 'node:http';
import { validateObject } from '@agora/core';
import type { SignedObject, WireMessage, SubscriptionFilter } from '@agora/core';
import { createChallenge, verifyAuth, type PendingAuth } from './auth.js';
import { ObjectStore } from './store.js';
import { SubscriptionManager } from './subscription.js';
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
  publicKey?: string;
  x25519PublicKey?: string;
  authenticated: boolean;
  pendingAuth?: PendingAuth;
  geo?: GeoInfo;
}

let clientCounter = 0;

export class RelayServer {
  private wss: WSServer;
  private clients: Map<string, ClientState> = new Map();
  private store: ObjectStore;
  private subscriptions: SubscriptionManager;

  constructor(server: import('node:http').Server) {
    this.store = new ObjectStore();
    this.subscriptions = new SubscriptionManager();

    this.wss = new WSServer({ server });
    this.wss.on('connection', (ws, req) => this.handleConnection(ws, req));

    console.log(`[Relay] WebSocket server ready (${this.store.size} objects in store)`);
  }

  private handleConnection(ws: WebSocket, req: IncomingMessage): void {
    const clientId = `c${++clientCounter}`;
    const client: ClientState = { id: clientId, ws, authenticated: false };
    this.clients.set(clientId, client);

    const forwarded = req.headers['x-forwarded-for'];
    const ip = typeof forwarded === 'string' ? forwarded.split(',')[0].trim() : req.socket.remoteAddress || '';
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

  private send(ws: WebSocket, msg: object): void {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(msg));
    }
  }

  getStats(): { clients: number; authenticated: number; objects: number } {
    let authenticated = 0;
    for (const c of this.clients.values()) {
      if (c.authenticated) authenticated++;
    }
    return {
      clients: this.clients.size,
      authenticated,
      objects: this.store.size,
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
