import type { Identity, SignedObject } from '@agora/core';
import type { ConnectionStatus } from './relay.js';
import type { FeedManager } from './feed.js';
import type { ProfileManager } from './profiles.js';
import type { DMManager } from './dm.js';

export const identityState = $state<{ identity: Identity | null }>({ identity: null });
export const connectionState = $state<{ status: ConnectionStatus }>({ status: 'disconnected' });
export const feedState = $state<{ objects: SignedObject[] }>({ objects: [] });

export const appState = $state<{
  feedManager: FeedManager | null;
  profileManager: ProfileManager | null;
  dmManager: DMManager | null;
}>({
  feedManager: null,
  profileManager: null,
  dmManager: null,
});

export function addToFeed(obj: SignedObject): void {
  if (feedState.objects.some((o) => o.id === obj.id)) return;
  feedState.objects = [...feedState.objects, obj].sort((a, b) => b.body.timestamp - a.body.timestamp);
}

export function setFeed(objects: SignedObject[]): void {
  const deduped = new Map<string, SignedObject>();
  for (const obj of objects) deduped.set(obj.id, obj);
  feedState.objects = [...deduped.values()].sort((a, b) => b.body.timestamp - a.body.timestamp);
}
