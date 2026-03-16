import type { SignedObject } from '@agora/core';
import { validateObject } from '@agora/core';
import type { PeerManager } from './webrtc.js';
import type { CacheManager } from './cache.js';

export type GossipObjectHandler = (obj: SignedObject) => void;

/**
 * P2P gossip + pull-sync protocol.
 *
 * Messages:
 *   { type: "gossip", object }         — push new object to peers
 *   { type: "watermark", authors }     — exchange seq watermarks on connect
 *   { type: "request", author, afterSeq } — request missing objects
 *   { type: "response", objects }      — batch response to request
 */

interface Watermarks {
  [author: string]: number; // author pubkey → highest seq we have
}

export class GossipManager {
  private peerManager: PeerManager;
  private cache: CacheManager | null = null;
  private seen = new Set<string>();
  private objectHandlers: GossipObjectHandler[] = [];

  // Stats
  private _objectsServed = 0;
  private _objectsReceived = 0;
  private _bytesServed = 0;

  constructor(peerManager: PeerManager) {
    this.peerManager = peerManager;

    peerManager.onData((peerKey, data) => {
      try {
        const msg = JSON.parse(data);
        switch (msg.type) {
          case 'gossip':
            if (msg.object) this.handleGossip(msg.object);
            break;
          case 'watermark':
            if (msg.authors) this.handleWatermark(peerKey, msg.authors);
            break;
          case 'request':
            if (msg.author) this.handleRequest(peerKey, msg.author, msg.afterSeq || 0);
            break;
          case 'response':
            if (msg.objects) this.handleResponse(msg.objects);
            break;
        }
      } catch { /* ignore malformed */ }
    });

    // When a new peer connects, send our watermarks
    peerManager.onChange(() => {
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

  // Push new object to all peers
  gossip(obj: SignedObject): void {
    this.seen.add(obj.id);
    const msg = JSON.stringify({ type: 'gossip', object: obj });
    this.peerManager.broadcast(msg);
  }

  // Build watermarks from local cache
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

  // Tracked peers we've already sent watermarks to
  private watermarkSent = new Set<string>();

  private async sendWatermarksToNewPeers(): Promise<void> {
    const peers = this.peerManager.getPeers();
    for (const peer of peers) {
      if (peer.status === 'connected' && !this.watermarkSent.has(peer.publicKey)) {
        this.watermarkSent.add(peer.publicKey);
        const authors = await this.buildWatermarks();
        const authorCount = Object.keys(authors).length;
        if (authorCount > 0) {
          this.peerManager.sendToPeer(peer.publicKey,
            JSON.stringify({ type: 'watermark', authors }));
          console.log(`[Sync] Sent watermarks to ${peer.publicKey.slice(0, 8)}... (${authorCount} authors)`);
        }
      }
    }
  }

  // Received peer's watermarks — compare with ours and request missing objects
  private async handleWatermark(peerKey: string, peerAuthors: Watermarks): Promise<void> {
    const myWatermarks = await this.buildWatermarks();

    // For each author the peer has, check if they have objects we don't
    for (const [author, peerSeq] of Object.entries(peerAuthors)) {
      const mySeq = myWatermarks[author] || 0;
      if (peerSeq > mySeq) {
        // Peer has objects we're missing — request them
        this.peerManager.sendToPeer(peerKey,
          JSON.stringify({ type: 'request', author, afterSeq: mySeq }));
        console.log(`[Sync] Requesting ${author.slice(0, 8)}... seq ${mySeq + 1}-${peerSeq} from peer`);
      }
    }

    // Also send OUR watermarks back so they can request from us
    const myAuthorCount = Object.keys(myWatermarks).length;
    if (myAuthorCount > 0) {
      this.peerManager.sendToPeer(peerKey,
        JSON.stringify({ type: 'watermark', authors: myWatermarks }));
    }
  }

  // Peer is requesting objects we have — serve from cache
  private async handleRequest(peerKey: string, author: string, afterSeq: number): Promise<void> {
    if (!this.cache) return;

    try {
      const objects = await this.cache.listByTimestamp();
      const matching = objects
        .filter(o => o.body.author === author && o.body.seq > afterSeq)
        .sort((a, b) => a.body.seq - b.body.seq)
        .slice(0, 50); // batch limit

      if (matching.length > 0) {
        const msg = JSON.stringify({ type: 'response', objects: matching });
        this.peerManager.sendToPeer(peerKey, msg);
        this._objectsServed += matching.length;
        this._bytesServed += msg.length;
        console.log(`[Sync] Served ${matching.length} objects to ${peerKey.slice(0, 8)}...`);
      }
    } catch { /* cache not ready */ }
  }

  // Received objects from peer — validate and ingest
  private handleResponse(objects: SignedObject[]): void {
    for (const obj of objects) {
      if (this.seen.has(obj.id)) continue;
      this.seen.add(obj.id);

      const result = validateObject(obj);
      if (!result.valid) {
        console.warn('[Sync] Rejected invalid object from peer:', result.error);
        continue;
      }

      this._objectsReceived++;
      for (const h of this.objectHandlers) h(obj);
    }
  }

  private handleGossip(obj: SignedObject): void {
    if (this.seen.has(obj.id)) return;
    this.seen.add(obj.id);

    const result = validateObject(obj);
    if (!result.valid) {
      console.warn('[Gossip] Rejected invalid object:', result.error);
      return;
    }

    this._objectsReceived++;
    for (const h of this.objectHandlers) h(obj);

    // Forward to other peers
    const msg = JSON.stringify({ type: 'gossip', object: obj });
    this.peerManager.broadcast(msg);
  }

  // Stats for UI
  getStats() {
    return {
      objectsServed: this._objectsServed,
      objectsReceived: this._objectsReceived,
      bytesServed: this._bytesServed,
      seenCount: this.seen.size,
      connectedPeers: this.peerManager.getConnectedCount(),
    };
  }
}
