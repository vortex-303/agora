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

  private _objectsServed = 0;
  private _objectsReceived = 0;
  private _bytesServed = 0;

  private watermarkSent = new Set<string>();

  constructor(swarm: SwarmManager) {
    this.swarm = swarm;

    swarm.onData((peerId, data) => {
      try {
        const msg = JSON.parse(data);
        switch (msg.type) {
          case 'gossip':
            if (msg.object) this.handleGossip(msg.object);
            break;
          case 'watermark':
            if (msg.authors) this.handleWatermark(peerId, msg.authors);
            break;
          case 'request':
            if (msg.author) this.handleRequest(peerId, msg.author, msg.afterSeq || 0);
            break;
          case 'response':
            if (msg.objects) this.handleResponse(msg.objects);
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

  gossip(obj: SignedObject): void {
    this.seen.add(obj.id);
    const msg = JSON.stringify({ type: 'gossip', object: obj });
    this.swarm.broadcast(msg);
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
    if (authorCount === 0) {
      console.log('[Gossip] No watermarks to send (empty cache)');
      return;
    }

    const msg = JSON.stringify({ type: 'watermark', authors });
    const sent = this.swarm.broadcast(msg);
    console.log(`[Gossip] Sent watermarks (${authorCount} authors) to ${sent} peers`);
  }

  private watermarkReplied = new Set<string>();

  private async handleWatermark(peerId: string, peerAuthors: Watermarks): Promise<void> {
    const myWatermarks = await this.buildWatermarks();

    let requested = 0;
    for (const [author, peerSeq] of Object.entries(peerAuthors)) {
      const mySeq = myWatermarks[author] || 0;
      if (peerSeq > mySeq) {
        this.swarm.sendToPeer(peerId,
          JSON.stringify({ type: 'request', author, afterSeq: mySeq }));
        requested++;
      }
    }

    // Only reply with our watermarks ONCE per peer (prevent infinite loop)
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
      // Priority: dm > read_receipt > profile > encrypted_state > post > other
      const PRIORITY: Record<string, number> = { dm: 0, read_receipt: 1, profile: 2, encrypted_state: 3, post: 4 };
      const matching = objects
        .filter(o => o.body.author === author && o.body.seq > afterSeq)
        .sort((a, b) => {
          const pa = PRIORITY[a.body.type] ?? 5;
          const pb = PRIORITY[b.body.type] ?? 5;
          if (pa !== pb) return pa - pb; // priority first
          return a.body.seq - b.body.seq; // then sequence
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

  private handleResponse(objects: SignedObject[]): void {
    let ingested = 0;
    for (const obj of objects) {
      if (this.seen.has(obj.id)) continue;
      this.seen.add(obj.id);

      const result = validateObject(obj);
      if (!result.valid) continue;

      this._objectsReceived++;
      ingested++;
      for (const h of this.objectHandlers) h(obj);
    }
    if (ingested > 0) console.log(`[Gossip] Received ${ingested} objects from peer (types: ${objects.filter(o => !this.seen.has(o.id) || ingested > 0).map(o => o.body.type).slice(0,5).join(',')})`);
  }

  private handleGossip(obj: SignedObject): void {
    if (this.seen.has(obj.id)) return;
    this.seen.add(obj.id);

    const result = validateObject(obj);
    if (!result.valid) return;

    this._objectsReceived++;
    for (const h of this.objectHandlers) h(obj);

    const msg = JSON.stringify({ type: 'gossip', object: obj });
    this.swarm.broadcast(msg);
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
