import { createObject, deriveX25519FromMnemonic, toBase64, type SignedObject, type ProfileContent, type Identity } from '@agora/core';
import type { FeedManager } from './feed.js';

export interface Profile {
  publicKey: string;
  name?: string;
  x25519PublicKey?: string;
  lastSeen?: number;
  online?: boolean;
  city?: string;
  country?: string;
  countryCode?: string;
}

export class ProfileManager {
  private feedManager: FeedManager;
  private identity: Identity;
  private profiles = new Map<string, Profile>();
  private changeHandlers: (() => void)[] = [];

  constructor(feedManager: FeedManager, identity: Identity) {
    this.feedManager = feedManager;
    this.identity = identity;
  }

  onChange(handler: () => void): void { this.changeHandlers.push(handler); }
  private emitChange(): void { for (const h of this.changeHandlers) h(); }

  async init(): Promise<void> {
    this.loadCachedProfiles();

    this.feedManager.onObject((obj) => {
      if (obj.body.type === 'profile') this.handleProfile(obj);
      this.trackSeen(obj.body.author, obj.body.timestamp);
    });

    await this.publishProfile();
  }

  private loadCachedProfiles(): void {
    try {
      const cached = localStorage.getItem('agora_profiles_cache');
      if (cached) {
        const profiles: Profile[] = JSON.parse(cached);
        for (const p of profiles) {
          this.profiles.set(p.publicKey, p);
        }
      }
    } catch {}
  }

  private saveCachedProfiles(): void {
    try {
      const toCache = [...this.profiles.values()].filter(p => p.name || p.x25519PublicKey).slice(0, 200);
      localStorage.setItem('agora_profiles_cache', JSON.stringify(toCache));
    } catch {}
  }

  private async publishProfile(): Promise<void> {
    const x25519 = deriveX25519FromMnemonic(this.identity.mnemonic);
    const state = this.feedManager.getAuthorState(this.identity.publicKeyBase64);

    const pendingName = typeof localStorage !== 'undefined' ? localStorage.getItem('agora_pending_username') : null;
    if (pendingName) localStorage.removeItem('agora_pending_username');

    const content: ProfileContent = {
      x25519PublicKey: toBase64(x25519.publicKey),
    };
    if (pendingName) content.name = pendingName;

    const obj = createObject({
      author: this.identity.publicKeyBase64,
      privateKey: this.identity.privateKey,
      type: 'profile',
      content,
      seq: state.seq + 1,
      prev: state.lastId,
    });
    await this.feedManager.publish(obj);
  }

  private handleProfile(obj: SignedObject): void {
    const content = obj.body.content as ProfileContent;
    const existing = this.profiles.get(obj.body.author) || { publicKey: obj.body.author };
    if (existing.lastSeen && existing.lastSeen > obj.body.timestamp) return;
    if (content.name) existing.name = content.name;
    if (content.x25519PublicKey) existing.x25519PublicKey = content.x25519PublicKey;
    existing.lastSeen = obj.body.timestamp;
    existing.publicKey = obj.body.author;
    this.profiles.set(obj.body.author, existing);
    this.saveCachedProfiles();
    this.emitChange();
  }

  private trackSeen(author: string, timestamp: number): void {
    const existing = this.profiles.get(author);
    if (existing) {
      if (!existing.lastSeen || timestamp > existing.lastSeen) existing.lastSeen = timestamp;
    } else {
      this.profiles.set(author, { publicKey: author, lastSeen: timestamp });
    }
  }

  getProfile(publicKey: string): Profile | undefined {
    return this.profiles.get(publicKey);
  }

  getX25519Key(publicKey: string): string | undefined {
    return this.profiles.get(publicKey)?.x25519PublicKey;
  }

  getAllProfiles(): Profile[] {
    return [...this.profiles.values()]
      .filter((p) => p.publicKey !== this.identity.publicKeyBase64)
      .sort((a, b) => (b.lastSeen || 0) - (a.lastSeen || 0));
  }

  locationString(publicKey: string): string | undefined {
    const p = this.profiles.get(publicKey);
    if (!p) return undefined;
    if (p.city && p.country) return `${p.city}, ${p.country}`;
    if (p.country) return p.country;
    if (p.city) return p.city;
    return undefined;
  }

  displayName(publicKey: string): string {
    const p = this.profiles.get(publicKey);
    if (p?.name) return p.name;
    return publicKey.slice(0, 8) + '...';
  }
}
