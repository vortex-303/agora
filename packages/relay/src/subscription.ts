import type { SignedObject, SubscriptionFilter } from '@agora/core';
import type { ObjectStore } from './store.js';

export interface Subscription {
  id: string;
  filters: SubscriptionFilter[];
  send: (obj: SignedObject) => void;
}

export class SubscriptionManager {
  private subscriptions: Map<string, Subscription[]> = new Map(); // clientId → subs

  add(clientId: string, sub: Subscription): void {
    const subs = this.subscriptions.get(clientId) || [];
    // Replace existing sub with same id
    const idx = subs.findIndex((s) => s.id === sub.id);
    if (idx !== -1) subs[idx] = sub;
    else subs.push(sub);
    this.subscriptions.set(clientId, subs);
  }

  remove(clientId: string, subId?: string): void {
    if (!subId) {
      this.subscriptions.delete(clientId);
      return;
    }
    const subs = this.subscriptions.get(clientId);
    if (!subs) return;
    const idx = subs.findIndex((s) => s.id === subId);
    if (idx !== -1) subs.splice(idx, 1);
  }

  removeAll(clientId: string): void {
    this.subscriptions.delete(clientId);
  }

  broadcast(obj: SignedObject, store: ObjectStore): void {
    for (const [, subs] of this.subscriptions) {
      for (const sub of subs) {
        for (const filter of sub.filters) {
          if (store.matchesFilter(obj, filter)) {
            sub.send(obj);
            break; // Don't send same object twice per subscription
          }
        }
      }
    }
  }
}
