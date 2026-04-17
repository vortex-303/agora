import type { SignedObject } from '@agora/core';
import { CacheManager } from './cache.js';
import { Outbox } from './outbox.js';
import { GossipManager } from './gossip.js';
import { SwarmManager, riotTopic, dmTopic } from './swarm.js';
import type { Identity } from '@agora/core';

type ConnectionStatus = 'disconnected' | 'connecting' | 'connected';
type ObjectHandler = (obj: SignedObject) => void;
type StatusHandler = (status: ConnectionStatus) => void;

export class FeedManager {
  private cache: CacheManager;
  private outbox: Outbox;
  private identity: Identity;
  readonly swarmManager: SwarmManager;
  private gossip: GossipManager;

  private objectHandlers: ObjectHandler[] = [];
  private statusHandlers: StatusHandler[] = [];

  private seen = new Set<string>();
  private authorSeq = new Map<string, { seq: number; lastId?: string }>();

  constructor(identity: Identity) {
    this.cache = new CacheManager();
    this.outbox = new Outbox();
    this.identity = identity;
    this.swarmManager = new SwarmManager(identity.publicKeyBase64);
    this.gossip = new GossipManager(this.swarmManager);
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

    this.gossip.setCache(this.cache);

    this.gossip.onObject(async (obj) => {
      await this.ingestObject(obj);
    });

    this.swarmManager.onStatus((trackerConnected) => {
      if (trackerConnected) {
        this.emitStatus('connected');
        this.outbox.flush((obj) => this.gossip.gossip(obj));
      }
    });

    this.swarmManager.onPeerChange(() => {
      const count = this.swarmManager.getConnectedCount();
      if (count > 0) {
        this.outbox.flush((obj) => this.gossip.gossip(obj));
      }
    });

    // Join own user swarm (always present for lobby)
    this.swarmManager.joinSwarm(riotTopic('user', this.identity.publicKeyBase64));

    this.emitStatus('connecting');

    // Evict expired objects on startup
    this.cache.evictExpired(this.identity.publicKeyBase64);
  }

  joinUserSwarm(pubkey: string): void {
    this.swarmManager.joinSwarm(riotTopic('user', pubkey));
  }

  leaveUserSwarm(pubkey: string): void {
    if (pubkey === this.identity.publicKeyBase64) return;
    this.swarmManager.leaveSwarm(riotTopic('user', pubkey));
  }

  joinDMSwarm(otherPubkey: string): void {
    this.swarmManager.joinSwarm(dmTopic(this.identity.publicKeyBase64, otherPubkey));
  }

  leaveDMSwarm(otherPubkey: string): void {
    this.swarmManager.leaveSwarm(dmTopic(this.identity.publicKeyBase64, otherPubkey));
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

  private async ingestObject(obj: SignedObject): Promise<void> {
    if (this.seen.has(obj.id)) return;
    this.seen.add(obj.id);
    this.trackAuthorSeq(obj);

    await this.cache.put(obj);
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

  // Send to specific pubkey (for DMs, read receipts)
  gossipTo(obj: SignedObject, pubkey: string): boolean {
    return this.gossip.gossipTo(obj, pubkey);
  }

  async publish(obj: SignedObject): Promise<void> {
    await this.ingestObject(obj);

    // DMs and read receipts are point-to-point, don't broadcast
    if (obj.body.type !== 'dm' && obj.body.type !== 'read_receipt') {
      this.gossip.gossip(obj);
    }

    if (this.swarmManager.getConnectedCount() === 0) {
      await this.outbox.add(obj);
    }
  }
}
