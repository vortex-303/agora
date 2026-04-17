import type { SignedObject } from '@agora/core';
import { validateObject } from '@agora/core';
import type { SwarmManager } from './swarm.js';
import type { CacheManager } from './cache.js';

export type GossipObjectHandler = (obj: SignedObject) => void;

interface Watermarks {
  [author: string]: number;
}

export class GossipManager {
  private swarm: SwarmManager;
  private cache: CacheManager | null = null;
  private seen = new Set<string>();
  private objectHandlers: GossipObjectHandler[] = [];
  private watermarkReplied = new Set<string>();

  private _objectsServed = 0;
  private _objectsReceived = 0;
  private _bytesServed = 0;

  constructor(swarm: SwarmManager) {
    this.swarm = swarm;

    swarm.onData((peerId, data) => {
      try {
        const msg = JSON.parse(data);
        switch (msg.type) {
          case 'gossip':
            if (msg.object) this.handleGossip(msg.object, peerId);
            break;
          case 'watermark':
            if (msg.authors) this.handleWatermark(peerId, msg.authors);
            break;
          case 'request':
            if (msg.author) this.handleRequest(peerId, msg.author, msg.afterSeq || 0);
            break;
          case 'response':
            if (msg.objects) this.handleResponse(msg.objects, peerId);
            break;
        }
      } catch { /* ignore malformed */ }
    });

    swarm.onPeerChange(() => {
      this.sendWatermarksToNewPeers();
    });
  }

  setCache(cache: CacheManager): void {
    this.cache = cache;
  }

  onObject(handler: GossipObjectHandler): void {
    this.objectHandlers.push(handler);
  }

  markSeen(id: string): void {
    this.seen.add(id);
  }

  // Broadcast to all peers (for non-DM objects like profiles, posts)
  gossip(obj: SignedObject): void {
    this.seen.add(obj.id);
    const msg = JSON.stringify({ type: 'gossip', object: obj });
    this.swarm.broadcast(msg);
  }

  // Send to a specific peer only (for DMs, read receipts)
  gossipTo(obj: SignedObject, pubkey: string): boolean {
    this.seen.add(obj.id);
    const msg = JSON.stringify({ type: 'gossip', object: obj });
    return this.swarm.sendToPubkey(pubkey, msg);
  }

  private async buildWatermarks(): Promise<Watermarks> {
    if (!this.cache) return {};
    const watermarks: Watermarks = {};
    try {
      const objects = await this.cache.listByTimestamp();
      for (const obj of objects) {
        const author = obj.body.author;
        const seq = obj.body.seq;
        if (!watermarks[author] || seq > watermarks[author]) {
          watermarks[author] = seq;
        }
      }
    } catch { /* cache not ready */ }
    return watermarks;
  }

  private async sendWatermarksToNewPeers(): Promise<void> {
    const authors = await this.buildWatermarks();
    const authorCount = Object.keys(authors).length;
    if (authorCount === 0) return;
    const msg = JSON.stringify({ type: 'watermark', authors });
    this.swarm.broadcast(msg);
  }

  private async handleWatermark(peerId: string, peerAuthors: Watermarks): Promise<void> {
    const myWatermarks = await this.buildWatermarks();

    for (const [author, peerSeq] of Object.entries(peerAuthors)) {
      const mySeq = myWatermarks[author] || 0;
      if (peerSeq > mySeq) {
        this.swarm.sendToPeer(peerId,
          JSON.stringify({ type: 'request', author, afterSeq: mySeq }));
      }
    }

    // Only reply with our watermarks ONCE per peer
    if (!this.watermarkReplied.has(peerId)) {
      this.watermarkReplied.add(peerId);
      const myAuthorCount = Object.keys(myWatermarks).length;
      if (myAuthorCount > 0) {
        this.swarm.sendToPeer(peerId,
          JSON.stringify({ type: 'watermark', authors: myWatermarks }));
      }
    }
  }

  private async handleRequest(peerId: string, author: string, afterSeq: number): Promise<void> {
    if (!this.cache) return;

    try {
      const objects = await this.cache.listByTimestamp();
      const PRIORITY: Record<string, number> = { dm: 0, read_receipt: 1, profile: 2, encrypted_state: 3, post: 4 };
      const matching = objects
        .filter(o => o.body.author === author && o.body.seq > afterSeq)
        .sort((a, b) => {
          const pa = PRIORITY[a.body.type] ?? 5;
          const pb = PRIORITY[b.body.type] ?? 5;
          if (pa !== pb) return pa - pb;
          return a.body.seq - b.body.seq;
        })
        .slice(0, 50);

      if (matching.length > 0) {
        const msg = JSON.stringify({ type: 'response', objects: matching });
        this.swarm.sendToPeer(peerId, msg);
        this._objectsServed += matching.length;
        this._bytesServed += msg.length;
      }
    } catch { /* cache not ready */ }
  }

  private handleResponse(objects: SignedObject[], peerId: string): void {
    for (const obj of objects) {
      if (this.seen.has(obj.id)) continue;
      this.seen.add(obj.id);

      const result = validateObject(obj);
      if (!result.valid) {
        this.swarm.scorePeer(peerId, -5);
        continue;
      }

      this.swarm.scorePeer(peerId, 1);
      this._objectsReceived++;
      for (const h of this.objectHandlers) h(obj);
    }
  }

  private handleGossip(obj: SignedObject, peerId: string): void {
    if (this.seen.has(obj.id)) return;
    this.seen.add(obj.id);

    const result = validateObject(obj);
    if (!result.valid) {
      this.swarm.scorePeer(peerId, -5);
      return;
    }

    this.swarm.scorePeer(peerId, 1);
    this._objectsReceived++;
    for (const h of this.objectHandlers) h(obj);

    // Only forward non-private objects
    if (obj.body.type !== 'dm' && obj.body.type !== 'read_receipt') {
      const msg = JSON.stringify({ type: 'gossip', object: obj });
      this.swarm.broadcast(msg);
    }
  }

  getStats() {
    return {
      objectsServed: this._objectsServed,
      objectsReceived: this._objectsReceived,
      bytesServed: this._bytesServed,
      seenCount: this.seen.size,
      connectedPeers: this.swarm.getConnectedCount(),
    };
  }
}
