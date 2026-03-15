import { createObject, type SignedObject, type ReactionContent, type Identity } from '@agora/core';
import type { FeedManager } from './feed.js';

export interface VoteCount {
  up: number;
  down: number;
  score: number;
  myVote: 'upvote' | 'downvote' | null;
}

export class VoteManager {
  private feedManager: FeedManager;
  private identity: Identity;
  // target → author → vote direction
  private votes = new Map<string, Map<string, 'upvote' | 'downvote'>>();
  private changeHandlers: (() => void)[] = [];

  constructor(feedManager: FeedManager, identity: Identity) {
    this.feedManager = feedManager;
    this.identity = identity;
  }

  onChange(handler: () => void): void { this.changeHandlers.push(handler); }
  private emitChange(): void { for (const h of this.changeHandlers) h(); }

  async init(): Promise<void> {
    this.feedManager.onObject((obj) => {
      if (obj.body.type === 'reaction') this.handleReaction(obj);
    });
    await this.feedManager.subscribe('votes', [{ types: ['reaction'] }]);
  }

  private handleReaction(obj: SignedObject): void {
    const content = obj.body.content as ReactionContent;
    if (content.emoji !== 'upvote' && content.emoji !== 'downvote') return;

    let targetVotes = this.votes.get(content.target);
    if (!targetVotes) {
      targetVotes = new Map();
      this.votes.set(content.target, targetVotes);
    }
    // Latest vote wins (allows changing vote)
    targetVotes.set(obj.body.author, content.emoji as 'upvote' | 'downvote');
    this.emitChange();
  }

  getVotes(targetId: string): VoteCount {
    const targetVotes = this.votes.get(targetId);
    if (!targetVotes) return { up: 0, down: 0, score: 0, myVote: null };

    let up = 0, down = 0;
    for (const dir of targetVotes.values()) {
      if (dir === 'upvote') up++;
      else down++;
    }
    const myVote = targetVotes.get(this.identity.publicKeyBase64) || null;
    return { up, down, score: up - down, myVote };
  }

  async vote(targetId: string, direction: 'upvote' | 'downvote'): Promise<void> {
    // Check if already voted same direction
    const current = this.getVotes(targetId);
    if (current.myVote === direction) return; // no double voting

    const state = this.feedManager.getAuthorState(this.identity.publicKeyBase64);
    const obj = createObject({
      author: this.identity.publicKeyBase64,
      privateKey: this.identity.privateKey,
      type: 'reaction',
      content: { target: targetId, emoji: direction } as ReactionContent,
      seq: state.seq + 1,
      prev: state.lastId,
    });
    await this.feedManager.publish(obj);
  }
}
