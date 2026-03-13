import { WebSocketServer as WSServer, WebSocket } from 'ws';
import type { IncomingMessage } from 'node:http';
import { validateObject } from '@agora/core';
import type { SignedObject, WireMessage, SubscriptionFilter } from '@agora/core';
import { createChallenge, verifyAuth, type PendingAuth } from './auth.js';
import { ObjectStore } from './store.js';
import { SubscriptionManager } from './subscription.js';

interface ClientState {
  id: string;
  ws: WebSocket;
  publicKey?: string;
  authenticated: boolean;
  pendingAuth?: PendingAuth;
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

    const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
    console.log(`[Relay] Client ${clientId} connected from ${ip}`);

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
      default:
        this.send(client.ws, { action: 'error', message: `Unknown action: ${msg.action}` });
    }
  }

  private handleHello(client: ClientState, msg: { publicKey: string }): void {
    if (!msg.publicKey) {
      this.send(client.ws, { action: 'error', message: 'Missing publicKey' });
      return;
    }
    client.publicKey = msg.publicKey;
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

    // Validate signature and hash
    const validation = validateObject(obj);
    if (!validation.valid) {
      this.send(client.ws, { action: 'error', message: `Validation failed: ${validation.error}` });
      return;
    }

    // Ensure author matches authenticated key
    if (obj.body.author !== client.publicKey) {
      this.send(client.ws, { action: 'error', message: 'Author mismatch' });
      return;
    }

    // Store and broadcast
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

    // Register subscription for live events
    this.subscriptions.add(client.id, {
      id: subId,
      filters: msg.filters,
      send: (obj) => {
        this.send(client.ws, { action: 'event', subscriptionId: subId, object: obj });
      },
    });

    // Send stored matches
    const matches = this.store.match(msg.filters);
    for (const obj of matches) {
      this.send(client.ws, { action: 'event', subscriptionId: subId, object: obj });
    }

    // End of stored events
    this.send(client.ws, { action: 'eose', subscriptionId: subId });
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
