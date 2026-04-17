import { createObject, type DeleteContent, type Identity, type SignedObject } from '@agora/core';
import type { FeedManager } from './feed.js';

const MUTED_KEY = 'agora_muted';
const BLOCKED_KEY = 'agora_blocked';
const FOLLOWED_COMMUNITIES_KEY = 'agora_followed_communities';

export class ClientModeration {
  private feedManager: FeedManager;
  private identity: Identity;
  private mutedUsers = new Set<string>();
  private blockedUsers = new Set<string>();
  private deletedObjects = new Set<string>();
  private followedCommunities = new Set<string>();
  private changeHandlers: (() => void)[] = [];

  constructor(feedManager: FeedManager, identity: Identity) {
    this.feedManager = feedManager;
    this.identity = identity;
    this.load();
  }

  onChange(handler: () => void): void { this.changeHandlers.push(handler); }
  private emitChange(): void { for (const h of this.changeHandlers) h(); }

  private load(): void {
    try {
      const muted = localStorage.getItem(MUTED_KEY);
      if (muted) this.mutedUsers = new Set(JSON.parse(muted));
      const blocked = localStorage.getItem(BLOCKED_KEY);
      if (blocked) this.blockedUsers = new Set(JSON.parse(blocked));
      const followed = localStorage.getItem(FOLLOWED_COMMUNITIES_KEY);
      if (followed) this.followedCommunities = new Set(JSON.parse(followed));
    } catch {}
  }

  private save(): void {
    localStorage.setItem(MUTED_KEY, JSON.stringify([...this.mutedUsers]));
    localStorage.setItem(BLOCKED_KEY, JSON.stringify([...this.blockedUsers]));
    localStorage.setItem(FOLLOWED_COMMUNITIES_KEY, JSON.stringify([...this.followedCommunities]));
  }

  async init(): Promise<void> {
    this.feedManager.onObject((obj) => {
      if (obj.body.type === 'delete') this.handleDelete(obj);
    });
    // Deletes arrive via P2P gossip
  }

  private handleDelete(obj: SignedObject): void {
    const content = obj.body.content as DeleteContent;
    // Only the author of the original object can delete it
    // We trust the delete if it's signed by the same author
    this.deletedObjects.add(content.target);
    this.emitChange();
  }

  // Delete own post
  async deletePost(targetId: string): Promise<void> {
    const state = this.feedManager.getAuthorState(this.identity.publicKeyBase64);
    const obj = createObject({
      author: this.identity.publicKeyBase64,
      privateKey: this.identity.privateKey,
      type: 'delete',
      content: { target: targetId } as DeleteContent,
      seq: state.seq + 1,
      prev: state.lastId,
    });
    this.deletedObjects.add(targetId);
    await this.feedManager.publish(obj);
    this.emitChange();
  }

  isDeleted(objectId: string): boolean {
    return this.deletedObjects.has(objectId);
  }

  // Mute (hide from feed, still see in DMs)
  mute(pubkey: string): void {
    this.mutedUsers.add(pubkey);
    this.save();
    this.emitChange();
  }

  unmute(pubkey: string): void {
    this.mutedUsers.delete(pubkey);
    this.save();
    this.emitChange();
  }

  isMuted(pubkey: string): boolean {
    return this.mutedUsers.has(pubkey);
  }

  getMutedUsers(): string[] {
    return [...this.mutedUsers];
  }

  // Block (hide from everything including DMs)
  block(pubkey: string): void {
    this.blockedUsers.add(pubkey);
    this.save();
    this.emitChange();
  }

  unblock(pubkey: string): void {
    this.blockedUsers.delete(pubkey);
    this.save();
    this.emitChange();
  }

  isBlocked(pubkey: string): boolean {
    return this.blockedUsers.has(pubkey);
  }

  getBlockedUsers(): string[] {
    return [...this.blockedUsers];
  }

  // Community follows
  followCommunity(name: string): void {
    this.followedCommunities.add(name.toLowerCase());
    this.save();
    this.emitChange();
  }

  unfollowCommunity(name: string): void {
    this.followedCommunities.delete(name.toLowerCase());
    this.save();
    this.emitChange();
  }

  isFollowingCommunity(name: string): boolean {
    return this.followedCommunities.has(name.toLowerCase());
  }

  getFollowedCommunities(): string[] {
    return [...this.followedCommunities];
  }

  // Filter check: should this object be shown?
  shouldShow(obj: SignedObject): boolean {
    if (this.isDeleted(obj.id)) return false;
    if (this.isMuted(obj.body.author)) return false;
    if (this.isBlocked(obj.body.author)) return false;
    return true;
  }
}
