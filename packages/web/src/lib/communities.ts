import { createObject, type SignedObject, type CommunityContent, type ModActionContent, type PostContent, type Identity } from '@agora/core';
import type { FeedManager } from './feed.js';

export interface Community {
  id: string; // object id of the community creation object
  name: string; // topic name (e.g. "tech")
  description?: string;
  moderators: string[]; // public keys
  creator: string; // public key
  createdAt: number;
  memberCount: number; // unique authors who posted in this topic
  postCount: number;
}

export interface ModAction {
  id: string;
  community: string; // community object id
  target: string; // object id or public key
  action: 'hide' | 'ban' | 'pin' | 'unban' | 'unhide' | 'unpin';
  reason?: string;
  moderator: string;
  timestamp: number;
}

export class CommunityManager {
  private feedManager: FeedManager;
  private identity: Identity;
  private communities = new Map<string, Community>(); // keyed by topic name
  private modActions: ModAction[] = [];
  private hiddenObjects = new Set<string>(); // object ids hidden by mods
  private bannedUsers = new Map<string, Set<string>>(); // community name → set of banned pubkeys
  private pinnedObjects = new Map<string, string[]>(); // community name → pinned object ids
  private changeHandlers: (() => void)[] = [];

  constructor(feedManager: FeedManager, identity: Identity) {
    this.feedManager = feedManager;
    this.identity = identity;
  }

  onChange(handler: () => void): void { this.changeHandlers.push(handler); }
  private emitChange(): void { for (const h of this.changeHandlers) h(); }

  async init(): Promise<void> {
    this.feedManager.onObject((obj) => {
      if (obj.body.type === 'community') this.handleCommunity(obj);
      if (obj.body.type === 'modaction') this.handleModAction(obj);
    });

    // Communities/modactions arrive via P2P gossip
  }

  private handleCommunity(obj: SignedObject): void {
    const content = obj.body.content as CommunityContent;
    const name = content.name.toLowerCase().trim();

    // First claim wins — don't overwrite existing community
    if (this.communities.has(name)) {
      const existing = this.communities.get(name)!;
      // Only the creator can update
      if (existing.creator !== obj.body.author) return;
      // Update if newer
      if (obj.body.timestamp <= existing.createdAt) return;
    }

    this.communities.set(name, {
      id: obj.id,
      name,
      description: content.description,
      moderators: content.moderators || [obj.body.author],
      creator: obj.body.author,
      createdAt: obj.body.timestamp,
      memberCount: 0,
      postCount: 0,
    });
    this.emitChange();
  }

  private handleModAction(obj: SignedObject): void {
    const content = obj.body.content as ModActionContent;

    // Find which community this mod action belongs to
    let communityName: string | null = null;
    for (const [name, c] of this.communities) {
      if (c.id === content.community) {
        communityName = name;
        break;
      }
    }
    if (!communityName) return;

    // Verify the author is a moderator
    const community = this.communities.get(communityName)!;
    if (!community.moderators.includes(obj.body.author)) return;

    const action: ModAction = {
      id: obj.id,
      community: content.community,
      target: content.target,
      action: content.action,
      reason: content.reason,
      moderator: obj.body.author,
      timestamp: obj.body.timestamp,
    };
    this.modActions.push(action);

    // Apply action
    switch (content.action) {
      case 'hide':
        this.hiddenObjects.add(content.target);
        break;
      case 'unhide':
        this.hiddenObjects.delete(content.target);
        break;
      case 'ban': {
        const banned = this.bannedUsers.get(communityName) || new Set();
        banned.add(content.target);
        this.bannedUsers.set(communityName, banned);
        break;
      }
      case 'unban': {
        this.bannedUsers.get(communityName)?.delete(content.target);
        break;
      }
      case 'pin': {
        const pinned = this.pinnedObjects.get(communityName) || [];
        if (!pinned.includes(content.target)) pinned.unshift(content.target);
        this.pinnedObjects.set(communityName, pinned);
        break;
      }
      case 'unpin': {
        const pinned = this.pinnedObjects.get(communityName) || [];
        this.pinnedObjects.set(communityName, pinned.filter((id) => id !== content.target));
        break;
      }
    }
    this.emitChange();
  }

  // Create or update a community
  async createCommunity(name: string, description?: string): Promise<void> {
    const topicName = name.toLowerCase().trim();
    const state = this.feedManager.getAuthorState(this.identity.publicKeyBase64);

    const obj = createObject({
      author: this.identity.publicKeyBase64,
      privateKey: this.identity.privateKey,
      type: 'community',
      content: {
        name: topicName,
        description,
        moderators: [this.identity.publicKeyBase64],
      } as CommunityContent,
      seq: state.seq + 1,
      prev: state.lastId,
    });

    await this.feedManager.publish(obj);
  }

  // Moderator actions
  async moderate(communityName: string, target: string, action: ModActionContent['action'], reason?: string): Promise<void> {
    const community = this.communities.get(communityName);
    if (!community) return;
    if (!community.moderators.includes(this.identity.publicKeyBase64)) return;

    const state = this.feedManager.getAuthorState(this.identity.publicKeyBase64);
    const obj = createObject({
      author: this.identity.publicKeyBase64,
      privateKey: this.identity.privateKey,
      type: 'modaction',
      content: {
        community: community.id,
        target,
        action,
        reason,
      } as ModActionContent,
      seq: state.seq + 1,
      prev: state.lastId,
    });

    await this.feedManager.publish(obj);
  }

  // Queries
  getCommunity(name: string): Community | undefined {
    return this.communities.get(name.toLowerCase());
  }

  getAllCommunities(): Community[] {
    return [...this.communities.values()].sort((a, b) => b.postCount - a.postCount || b.createdAt - a.createdAt);
  }

  isHidden(objectId: string): boolean {
    return this.hiddenObjects.has(objectId);
  }

  isBanned(communityName: string, pubkey: string): boolean {
    return this.bannedUsers.get(communityName)?.has(pubkey) || false;
  }

  getPinnedIds(communityName: string): string[] {
    return this.pinnedObjects.get(communityName) || [];
  }

  isModerator(communityName: string, pubkey?: string): boolean {
    const community = this.communities.get(communityName);
    if (!community) return false;
    return community.moderators.includes(pubkey || this.identity.publicKeyBase64);
  }

  // Update member/post counts from feed state
  updateCounts(objects: SignedObject[]): void {
    const topicAuthors = new Map<string, Set<string>>();
    const topicPosts = new Map<string, number>();

    for (const obj of objects) {
      if (obj.body.type !== 'post') continue;
      const topic = (obj.body.content as PostContent).topic;
      if (!topic) continue;
      const name = topic.toLowerCase();

      if (!topicAuthors.has(name)) topicAuthors.set(name, new Set());
      topicAuthors.get(name)!.add(obj.body.author);
      topicPosts.set(name, (topicPosts.get(name) || 0) + 1);
    }

    for (const [name, community] of this.communities) {
      community.memberCount = topicAuthors.get(name)?.size || 0;
      community.postCount = topicPosts.get(name) || 0;
    }
  }
}
