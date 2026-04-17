import type { Identity, SignedObject } from '@agora/core';
import type { FeedManager } from './feed.js';
import type { ProfileManager } from './profiles.js';
import type { DMManager } from './dm.js';
import type { CommunityManager } from './communities.js';
import type { VoteManager } from './votes.js';
import type { ClientModeration } from './moderation-client.js';
import type { AccountSync } from './account-sync.js';
import type { SeedMode } from './seed-mode.js';

export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected';

export const identityState = $state<{ identity: Identity | null }>({ identity: null });
export const connectionState = $state<{ status: ConnectionStatus }>({ status: 'disconnected' });
export const feedState = $state<{ objects: SignedObject[] }>({ objects: [] });

export const appState = $state<{
  feedManager: FeedManager | null;
  profileManager: ProfileManager | null;
  dmManager: DMManager | null;
  communityManager: CommunityManager | null;
  voteManager: VoteManager | null;
  moderation: ClientModeration | null;
  accountSync: AccountSync | null;
  seedMode: SeedMode | null;
}>({
  feedManager: null,
  profileManager: null,
  dmManager: null,
  communityManager: null,
  voteManager: null,
  moderation: null,
  accountSync: null,
  seedMode: null,
});

export const reactiveState = $state<{ tick: number }>({ tick: 0 });
export function triggerReactive(): void { reactiveState.tick++; }

export function addToFeed(obj: SignedObject): void {
  if (feedState.objects.some((o) => o.id === obj.id)) return;
  feedState.objects = [...feedState.objects, obj].sort((a, b) => b.body.timestamp - a.body.timestamp);
}

export function setFeed(objects: SignedObject[]): void {
  const deduped = new Map<string, SignedObject>();
  for (const obj of objects) deduped.set(obj.id, obj);
  feedState.objects = [...deduped.values()].sort((a, b) => b.body.timestamp - a.body.timestamp);
}
