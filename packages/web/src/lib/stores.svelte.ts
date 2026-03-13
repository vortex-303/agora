import type { Identity, SignedObject } from '@agora/core';
import type { ConnectionStatus } from './relay.js';

// Identity state
export const identityState = $state<{ identity: Identity | null }>({ identity: null });

// Connection status
export const connectionState = $state<{ status: ConnectionStatus }>({ status: 'disconnected' });

// Feed state — objects sorted by timestamp, newest first
export const feedState = $state<{ objects: SignedObject[] }>({ objects: [] });

export function addToFeed(obj: SignedObject): void {
  // Dedup by id
  if (feedState.objects.some((o) => o.id === obj.id)) return;
  feedState.objects = [...feedState.objects, obj].sort((a, b) => b.body.timestamp - a.body.timestamp);
}
