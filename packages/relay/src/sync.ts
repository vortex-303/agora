import WebSocket from 'ws';
import { validateObject } from '@agora/core';
import type { SignedObject } from '@agora/core';
import { config } from './config.js';
import { ObjectStore } from './store.js';

/**
 * Relay-to-relay sync: connects to peer relays and exchanges objects.
 * Each relay is both publisher and subscriber to its peers.
 * Objects are validated before accepting — no trust required.
 */
export class RelaySync {
  private store: ObjectStore;
  private peers: Map<string, { ws: WebSocket | null; reconnectTimer?: ReturnType<typeof setTimeout> }> = new Map();
  private onNewObject: (obj: SignedObject) => void;

  constructor(store: ObjectStore, onNewObject: (obj: SignedObject) => void) {
    this.store = store;
    this.onNewObject = onNewObject;
  }

  start(): void {
    for (const url of config.peerRelays) {
      this.connectToPeer(url);
    }
  }

  private connectToPeer(url: string): void {
    if (this.peers.has(url) && this.peers.get(url)!.ws?.readyState === WebSocket.OPEN) return;

    console.log(`[Sync] Connecting to peer: ${url}`);
    const ws = new WebSocket(url);
    this.peers.set(url, { ws });

    ws.on('open', () => {
      console.log(`[Sync] Connected to peer: ${url}`);
      // Subscribe to all objects from this peer
      ws.send(JSON.stringify({ action: 'relay_sync', mode: 'subscribe' }));
    });

    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString());
        if (msg.action === 'relay_sync_object' && msg.object) {
          this.handlePeerObject(msg.object, url);
        }
      } catch { /* ignore malformed */ }
    });

    ws.on('close', () => {
      console.log(`[Sync] Disconnected from peer: ${url}`);
      this.scheduleReconnect(url);
    });

    ws.on('error', () => {
      // onclose fires after
    });
  }

  private scheduleReconnect(url: string): void {
    const peer = this.peers.get(url);
    if (peer?.reconnectTimer) return;
    const timer = setTimeout(() => {
      if (peer) peer.reconnectTimer = undefined;
      this.connectToPeer(url);
    }, 10_000 + Math.random() * 5_000); // 10-15s jitter
    if (peer) peer.reconnectTimer = timer;
  }

  private handlePeerObject(obj: SignedObject, fromUrl: string): void {
    // Already have it?
    if (this.store.has(obj.id)) return;

    // Validate signature + hash
    const result = validateObject(obj);
    if (!result.valid) {
      console.warn(`[Sync] Rejected invalid object from ${fromUrl}: ${result.error}`);
      return;
    }

    // Store and broadcast to local clients
    const isNew = this.store.put(obj);
    if (isNew) {
      this.onNewObject(obj);
      // Forward to other peers (gossip)
      this.broadcastToPeers(obj, fromUrl);
    }
  }

  // Called when local clients publish new objects
  broadcastToPeers(obj: SignedObject, exceptUrl?: string): void {
    for (const [url, peer] of this.peers) {
      if (url === exceptUrl) continue;
      if (peer.ws?.readyState === WebSocket.OPEN) {
        peer.ws.send(JSON.stringify({ action: 'relay_sync_object', object: obj }));
      }
    }
  }

  stop(): void {
    for (const [, peer] of this.peers) {
      if (peer.reconnectTimer) clearTimeout(peer.reconnectTimer);
      peer.ws?.close();
    }
    this.peers.clear();
  }
}
