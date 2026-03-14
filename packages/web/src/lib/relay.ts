import { sign, toBase64, fromBase64, deriveX25519FromMnemonic } from '@agora/core';
import type { SignedObject, SubscriptionFilter, Identity } from '@agora/core';

export type ConnectionStatus = 'disconnected' | 'connecting' | 'authenticating' | 'connected';

export type EventHandler = (subscriptionId: string, object: SignedObject) => void;
export type EoseHandler = (subscriptionId: string) => void;
export type StatusHandler = (status: ConnectionStatus) => void;
export type SignalHandler = (source: string, signalType: string, data: any) => void;
export interface PeerGeo {
  city?: string;
  country?: string;
  countryCode?: string;
}
export interface PeerEntry {
  publicKey: string;
  geo?: PeerGeo;
  x25519PublicKey?: string;
}
export type PeersHandler = (peers: PeerEntry[]) => void;

export class RelayClient {
  private ws: WebSocket | null = null;
  private url: string;
  private identity: Identity;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectDelay = 1000;
  private maxReconnectDelay = 30000;
  private pendingNonce: string | null = null;

  private eventHandlers: EventHandler[] = [];
  private eoseHandlers: EoseHandler[] = [];
  private statusHandlers: StatusHandler[] = [];
  private signalHandlers: SignalHandler[] = [];
  private peersHandlers: PeersHandler[] = [];
  private pendingSubscriptions: Array<{ id: string; filters: SubscriptionFilter[] }> = [];

  constructor(url: string, identity: Identity) {
    this.url = url;
    this.identity = identity;
  }

  onEvent(handler: EventHandler): void { this.eventHandlers.push(handler); }
  onEose(handler: EoseHandler): void { this.eoseHandlers.push(handler); }
  onStatusChange(handler: StatusHandler): void { this.statusHandlers.push(handler); }
  onSignal(handler: SignalHandler): void { this.signalHandlers.push(handler); }
  onPeers(handler: PeersHandler): void { this.peersHandlers.push(handler); }

  private emitEvent(subId: string, obj: SignedObject): void {
    for (const h of this.eventHandlers) h(subId, obj);
  }
  private emitEose(subId: string): void {
    for (const h of this.eoseHandlers) h(subId);
  }
  private emitStatus(status: ConnectionStatus): void {
    for (const h of this.statusHandlers) h(status);
  }
  private emitSignal(source: string, signalType: string, data: any): void {
    for (const h of this.signalHandlers) h(source, signalType, data);
  }
  private emitPeers(peers: PeerEntry[]): void {
    for (const h of this.peersHandlers) h(peers);
  }

  connect(): void {
    if (this.ws && this.ws.readyState <= WebSocket.OPEN) return;

    this.emitStatus('connecting');
    this.ws = new WebSocket(this.url);

    this.ws.onopen = () => {
      this.reconnectDelay = 1000;
      const x25519 = deriveX25519FromMnemonic(this.identity.mnemonic);
      this.send({ action: 'hello', publicKey: this.identity.publicKeyBase64, x25519PublicKey: toBase64(x25519.publicKey) });
      this.emitStatus('authenticating');
    };

    this.ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        this.handleMessage(msg);
      } catch {
        console.error('[Relay] Invalid message');
      }
    };

    this.ws.onclose = () => {
      this.emitStatus('disconnected');
      this.scheduleReconnect();
    };

    this.ws.onerror = (e) => {
      console.warn(`[Relay] Connection error to ${this.url}`);
    };
  }

  disconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.onclose = null;
      this.ws.close();
      this.ws = null;
    }
    this.emitStatus('disconnected');
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, this.reconnectDelay);
    this.reconnectDelay = Math.min(this.reconnectDelay * 2, this.maxReconnectDelay);
  }

  private handleMessage(msg: any): void {
    switch (msg.action) {
      case 'challenge': {
        try {
          this.pendingNonce = msg.nonce;
          const nonceBytes = fromBase64(msg.nonce);
          const sig = sign(nonceBytes, this.identity.privateKey);
          this.send({ action: 'auth', signature: toBase64(sig), nonce: msg.nonce });
        } catch (e) {
          console.error('[Relay] Auth signing failed:', e);
        }
        break;
      }
      case 'auth_ok':
        this.emitStatus('connected');
        for (const sub of this.pendingSubscriptions) {
          this.send({ action: 'subscribe', ...sub });
        }
        break;
      case 'auth_fail':
        console.error('[Relay] Auth failed:', msg.reason);
        this.disconnect();
        break;
      case 'event':
        this.emitEvent(msg.subscriptionId, msg.object);
        break;
      case 'eose':
        this.emitEose(msg.subscriptionId);
        break;
      case 'signal':
        this.emitSignal(msg.source, msg.signalType, msg.data);
        break;
      case 'peers':
        this.emitPeers(msg.peers);
        break;
      case 'error':
        console.error('[Relay] Error:', msg.message);
        break;
    }
  }

  subscribe(id: string, filters: SubscriptionFilter[]): void {
    const existing = this.pendingSubscriptions.findIndex((s) => s.id === id);
    if (existing !== -1) this.pendingSubscriptions[existing] = { id, filters };
    else this.pendingSubscriptions.push({ id, filters });
    this.send({ action: 'subscribe', id, filters });
  }

  publish(object: SignedObject): void {
    this.send({ action: 'publish', object });
  }

  sendSignal(target: string, signalType: string, data: any): void {
    this.send({ action: 'signal', target, signalType, data });
  }

  requestPeers(): void {
    this.send({ action: 'peers' });
  }

  send(msg: object): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  get connected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }
}
