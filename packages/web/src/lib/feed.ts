import type { SignedObject } from '@agora/core';
import { CacheManager } from './cache.js';
import { Outbox } from './outbox.js';
import type { ConnectionStatus } from './relay.js';
import type { RelayLike } from './relay-interface.js';
import { PeerManager } from './webrtc.js';
import { GossipManager } from './gossip.js';
import type { Identity } from '@agora/core';

type ObjectHandler = (obj: SignedObject) => void;
type StatusHandler = (status: ConnectionStatus) => void;

export class FeedManager {
  private cache: CacheManager;
  private outbox: Outbox;
  readonly relay: RelayLike;
  private identity: Identity;
  readonly peerManager: PeerManager;
  private gossip: GossipManager;

  private objectHandlers: ObjectHandler[] = [];
  private statusHandlers: StatusHandler[] = [];

  private seen = new Set<string>();
  private authorSeq = new Map<string, { seq: number; lastId?: string }>();

  constructor(relay: RelayLike, identity: Identity) {
    this.cache = new CacheManager();
    this.outbox = new Outbox();
    this.relay = relay;
    this.identity = identity;
    this.peerManager = new PeerManager(relay, identity.publicKeyBase64);
    this.gossip = new GossipManager(this.peerManager);
  }

  onObject(handler: ObjectHandler): void { this.objectHandlers.push(handler); }
  onStatusChange(handler: StatusHandler): void { this.statusHandlers.push(handler); }

  private emitObject(obj: SignedObject): void {
    for (const h of this.objectHandlers) h(obj);
  }
  private emitStatus(status: ConnectionStatus): void {
    for (const h of this.statusHandlers) h(status);
  }

  async init(): Promise<void> {
    await this.cache.init();
    await this.outbox.init();

    // Give gossip access to cache for pull-sync
    this.gossip.setCache(this.cache);

    // Relay events → ingest + cache
    this.relay.onEvent(async (_subId, obj) => {
      this.gossip.markSeen(obj.id); // don't re-gossip relay objects
      await this.ingestObject(obj, _subId);
    });

    this.relay.onStatusChange(async (status) => {
      this.emitStatus(status);
      if (status === 'connected') {
        await this.outbox.flush((obj) => this.relay.publish(obj));
        // Request peer list for WebRTC
        this.relay.requestPeers();
      }
    });

    // Peer discovery
    this.relay.onPeers((peers) => {
      this.peerManager.connectToPeers(peers.map((p) => p.publicKey));
    });

    // Gossip events → ingest + cache
    this.gossip.onObject(async (obj) => {
      await this.ingestObject(obj, 'p2p');
    });
  }

  async loadCachedFeed(): Promise<SignedObject[]> {
    const posts = await this.cache.listPosts();
    for (const obj of posts) {
      this.seen.add(obj.id);
      this.gossip.markSeen(obj.id);
      this.trackAuthorSeq(obj);
    }
    return posts;
  }

  async loadCachedTopic(topic: string): Promise<SignedObject[]> {
    const posts = await this.cache.listPostsByTopic(topic);
    for (const obj of posts) {
      this.seen.add(obj.id);
      this.gossip.markSeen(obj.id);
    }
    return posts;
  }

  async subscribe(id: string, filters: Array<{ authors?: string[]; topics?: string[]; types?: string[]; since?: number; limit?: number }>): Promise<void> {
    const cursor = await this.cache.getCursor(id);
    if (cursor) {
      filters = filters.map((f) => ({
        ...f,
        since: f.since ? Math.max(f.since, cursor) : cursor,
      }));
    }
    this.relay.subscribe(id, filters);
  }

  private async ingestObject(obj: SignedObject, subscriptionId: string): Promise<void> {
    if (this.seen.has(obj.id)) return;
    this.seen.add(obj.id);
    this.trackAuthorSeq(obj);

    await this.cache.put(obj);
    await this.cache.updateCursor(subscriptionId, obj);

    this.emitObject(obj);
  }

  private trackAuthorSeq(obj: SignedObject): void {
    const current = this.authorSeq.get(obj.body.author);
    if (!current || obj.body.seq > current.seq) {
      this.authorSeq.set(obj.body.author, { seq: obj.body.seq, lastId: obj.id });
    }
  }

  getAuthorState(author: string): { seq: number; lastId?: string } {
    return this.authorSeq.get(author) || { seq: 0 };
  }

  getNetworkStats() {
    const gossipStats = this.gossip.getStats();
    return {
      cachedObjects: this.seen.size,
      ...gossipStats,
    };
  }

  async publish(obj: SignedObject): Promise<void> {
    await this.ingestObject(obj, 'local');

    // Gossip to P2P peers
    this.gossip.gossip(obj);

    if (this.relay.connected) {
      this.relay.publish(obj);
    } else {
      await this.outbox.add(obj);
      console.log('[Feed] Queued object in outbox (offline)');
    }
  }
}
