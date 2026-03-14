import { RelayClient, type ConnectionStatus, type EventHandler, type EoseHandler,
  type StatusHandler, type SignalHandler, type PeersHandler, type PeerEntry } from './relay.js';
import type { SignedObject, SubscriptionFilter, Identity } from '@agora/core';

export type PoolStatus = 'disconnected' | 'partial' | 'connected';

export const DEFAULT_RELAYS = [
  'wss://relay.agorap2p.com',
  'wss://agora-relay.fly.dev',
  'wss://agora-relay-eu.fly.dev',
];

export class RelayPool {
  private relays: Map<string, RelayClient> = new Map();
  private identity: Identity;
  private seenObjects = new Set<string>();
  private seenPeers = new Map<string, PeerEntry>(); // dedup peers across relays

  private eventHandlers: EventHandler[] = [];
  private eoseHandlers: EoseHandler[] = [];
  private statusHandlers: StatusHandler[] = [];
  private signalHandlers: SignalHandler[] = [];
  private peersHandlers: PeersHandler[] = [];
  private pendingSubscriptions: Array<{ id: string; filters: SubscriptionFilter[] }> = [];
  private relayStatuses = new Map<string, ConnectionStatus>();

  constructor(urls: string[], identity: Identity) {
    this.identity = identity;
    for (const url of urls) {
      this.addRelay(url);
    }
  }

  addRelay(url: string): void {
    if (this.relays.has(url)) return;

    const client = new RelayClient(url, this.identity);
    this.relays.set(url, client);
    this.relayStatuses.set(url, 'disconnected');

    // Dedup events across relays
    client.onEvent((subId, obj) => {
      if (this.seenObjects.has(obj.id)) return;
      this.seenObjects.add(obj.id);
      for (const h of this.eventHandlers) h(subId, obj);
    });

    client.onEose((subId) => {
      for (const h of this.eoseHandlers) h(subId);
    });

    client.onStatusChange((status) => {
      this.relayStatuses.set(url, status);
      const poolStatus = this.computePoolStatus();
      for (const h of this.statusHandlers) h(poolStatus);

      // Re-subscribe on any relay that connects
      if (status === 'connected') {
        for (const sub of this.pendingSubscriptions) {
          client.subscribe(sub.id, sub.filters);
        }
      }
    });

    client.onSignal((source, signalType, data) => {
      for (const h of this.signalHandlers) h(source, signalType, data);
    });

    client.onPeers((peers) => {
      // Merge peers from all relays, dedup by publicKey
      for (const peer of peers) {
        this.seenPeers.set(peer.publicKey, peer);
      }
      for (const h of this.peersHandlers) h([...this.seenPeers.values()]);
    });
  }

  removeRelay(url: string): void {
    const client = this.relays.get(url);
    if (client) {
      client.disconnect();
      this.relays.delete(url);
      this.relayStatuses.delete(url);
    }
  }

  private computePoolStatus(): ConnectionStatus {
    const statuses = [...this.relayStatuses.values()];
    if (statuses.every((s) => s === 'connected')) return 'connected';
    if (statuses.some((s) => s === 'connected')) return 'connected'; // partial = still connected
    if (statuses.some((s) => s === 'connecting' || s === 'authenticating')) return 'connecting';
    return 'disconnected';
  }

  // Public API — same interface as RelayClient
  onEvent(handler: EventHandler): void { this.eventHandlers.push(handler); }
  onEose(handler: EoseHandler): void { this.eoseHandlers.push(handler); }
  onStatusChange(handler: StatusHandler): void { this.statusHandlers.push(handler); }
  onSignal(handler: SignalHandler): void { this.signalHandlers.push(handler); }
  onPeers(handler: PeersHandler): void { this.peersHandlers.push(handler); }

  connect(): void {
    for (const client of this.relays.values()) {
      client.connect();
    }
  }

  disconnect(): void {
    for (const client of this.relays.values()) {
      client.disconnect();
    }
  }

  subscribe(id: string, filters: SubscriptionFilter[]): void {
    const existing = this.pendingSubscriptions.findIndex((s) => s.id === id);
    if (existing !== -1) this.pendingSubscriptions[existing] = { id, filters };
    else this.pendingSubscriptions.push({ id, filters });

    // Send to all connected relays
    for (const client of this.relays.values()) {
      client.subscribe(id, filters);
    }
  }

  publish(object: SignedObject): void {
    this.seenObjects.add(object.id); // don't echo back
    for (const client of this.relays.values()) {
      client.publish(object);
    }
  }

  sendSignal(target: string, signalType: string, data: any): void {
    // Send signal to all relays — target may be on a different one
    for (const client of this.relays.values()) {
      client.sendSignal(target, signalType, data);
    }
  }

  requestPeers(): void {
    for (const client of this.relays.values()) {
      client.requestPeers();
    }
  }

  send(msg: object): void {
    for (const client of this.relays.values()) {
      client.send(msg);
    }
  }

  get connected(): boolean {
    for (const client of this.relays.values()) {
      if (client.connected) return true;
    }
    return false;
  }

  getRelayUrls(): string[] {
    return [...this.relays.keys()];
  }

  getRelayStatus(url: string): ConnectionStatus {
    return this.relayStatuses.get(url) || 'disconnected';
  }

  getConnectedCount(): number {
    let count = 0;
    for (const status of this.relayStatuses.values()) {
      if (status === 'connected') count++;
    }
    return count;
  }

  getTotalCount(): number {
    return this.relays.size;
  }
}
