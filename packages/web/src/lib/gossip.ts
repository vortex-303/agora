import type { SignedObject } from '@agora/core';
import { validateObject } from '@agora/core';
import type { PeerManager } from './webrtc.js';

export type GossipObjectHandler = (obj: SignedObject) => void;

export class GossipManager {
  private peerManager: PeerManager;
  private seen = new Set<string>(); // object ids we've already processed
  private objectHandlers: GossipObjectHandler[] = [];

  constructor(peerManager: PeerManager) {
    this.peerManager = peerManager;

    // Handle incoming gossip from peers
    peerManager.onData((_peerKey, data) => {
      try {
        const msg = JSON.parse(data);
        if (msg.type === 'gossip' && msg.object) {
          this.handleGossip(msg.object);
        }
      } catch {
        // ignore malformed
      }
    });
  }

  onObject(handler: GossipObjectHandler): void {
    this.objectHandlers.push(handler);
  }

  // Mark an object as seen (called when received from relay too)
  markSeen(id: string): void {
    this.seen.add(id);
  }

  // Gossip a new object to all peers
  gossip(obj: SignedObject): void {
    this.seen.add(obj.id);
    const msg = JSON.stringify({ type: 'gossip', object: obj });
    const sent = this.peerManager.broadcast(msg);
    if (sent > 0) {
      console.log(`[Gossip] Forwarded ${obj.id.slice(0, 16)}... to ${sent} peers`);
    }
  }

  private handleGossip(obj: SignedObject): void {
    // Dedup
    if (this.seen.has(obj.id)) return;
    this.seen.add(obj.id);

    // Validate
    const result = validateObject(obj);
    if (!result.valid) {
      console.warn('[Gossip] Rejected invalid object:', result.error);
      return;
    }

    // Notify handlers
    for (const h of this.objectHandlers) h(obj);

    // Forward to other peers (gossip protocol)
    const msg = JSON.stringify({ type: 'gossip', object: obj });
    this.peerManager.broadcast(msg);
  }
}
