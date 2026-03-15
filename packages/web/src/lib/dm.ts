import {
  createObject,
  encryptDM,
  decryptDM,
  deriveX25519FromMnemonic,
  toBase64,
  fromBase64,
  type SignedObject,
  type DMContent,
  type Identity,
} from '@agora/core';
import type { FeedManager } from './feed.js';
import { CacheManager } from './cache.js';

export interface DecryptedDM {
  id: string;
  from: string; // author public key
  to: string; // recipient public key
  text: string;
  timestamp: number;
  outgoing: boolean;
}

export class DMManager {
  private feedManager: FeedManager;
  private identity: Identity;
  private x25519Private: Uint8Array;
  private x25519Public: Uint8Array;
  private x25519PublicBase64: string;
  private cache: CacheManager;

  // Cached decrypted messages keyed by conversation partner
  private conversations = new Map<string, DecryptedDM[]>();
  private changeHandlers: (() => void)[] = [];

  constructor(feedManager: FeedManager, identity: Identity) {
    this.feedManager = feedManager;
    this.identity = identity;
    this.cache = new CacheManager();

    const x25519 = deriveX25519FromMnemonic(identity.mnemonic);
    this.x25519Private = x25519.privateKey;
    this.x25519Public = x25519.publicKey;
    this.x25519PublicBase64 = toBase64(x25519.publicKey);
  }

  getX25519PublicKey(): string {
    return this.x25519PublicBase64;
  }

  onChange(handler: () => void): void {
    this.changeHandlers.push(handler);
  }

  private emitChange(): void {
    for (const h of this.changeHandlers) h();
  }

  async init(): Promise<void> {
    await this.cache.init();

    // Subscribe to DMs addressed to us or from us
    this.feedManager.onObject(async (obj) => {
      if (obj.body.type === 'dm') {
        await this.handleDMObject(obj);
      }
    });

    // Subscribe to DMs on the relay
    await this.feedManager.subscribe('dms', [
      { types: ['dm'], authors: [this.identity.publicKeyBase64] }, // our outgoing
    ]);
    // Also subscribe to objects addressed to us (all DMs, filter client-side)
    await this.feedManager.subscribe('dms-in', [{ types: ['dm'] }]);

    // Load cached DMs
    await this.loadCachedDMs();
  }

  private async loadCachedDMs(): Promise<void> {
    const all = await this.cache.listByTimestamp();
    for (const obj of all) {
      if (obj.body.type === 'dm') {
        await this.handleDMObject(obj);
      }
    }
  }

  private async handleDMObject(obj: SignedObject): Promise<void> {
    const content = obj.body.content as DMContent;
    const isOutgoing = obj.body.author === this.identity.publicKeyBase64;
    const isIncoming = content.recipient === this.identity.publicKeyBase64;

    if (!isOutgoing && !isIncoming) return;

    let text: string | null = null;

    if (isOutgoing) {
      // We can't decrypt our own outgoing DMs — use stored plaintext
      text = this.getOutgoingPlaintext(obj.id);
      if (!text) text = '[message sent from this device]'; // fallback if localStorage cleared
    } else {
      // Incoming — decrypt with our X25519 private key
      try {
        text = await decryptDM(
          fromBase64(content.ciphertext),
          fromBase64(content.ephemeralPublicKey),
          fromBase64(content.nonce),
          this.x25519Private
        );
      } catch {
        return; // Can't decrypt — not for us
      }
    }

    const partner = isOutgoing ? content.recipient : obj.body.author;
    const dm: DecryptedDM = {
      id: obj.id,
      from: obj.body.author,
      to: content.recipient,
      text,
      timestamp: obj.body.timestamp,
      outgoing: isOutgoing,
    };

    const conv = this.conversations.get(partner) || [];
    if (!conv.some((m) => m.id === dm.id)) {
      conv.push(dm);
      conv.sort((a, b) => a.timestamp - b.timestamp);
      this.conversations.set(partner, conv);
      this.emitChange();
    }
  }

  async sendDM(recipientPublicKey: string, recipientX25519PublicKey: string, text: string): Promise<void> {
    const { ciphertext, ephemeralPublicKey, nonce } = await encryptDM(
      text,
      fromBase64(recipientX25519PublicKey)
    );

    const state = this.feedManager.getAuthorState(this.identity.publicKeyBase64);
    const obj = createObject({
      author: this.identity.publicKeyBase64,
      privateKey: this.identity.privateKey,
      type: 'dm',
      content: {
        recipient: recipientPublicKey,
        ciphertext: toBase64(ciphertext),
        ephemeralPublicKey: toBase64(ephemeralPublicKey),
        nonce: toBase64(nonce),
      } as DMContent,
      seq: state.seq + 1,
      prev: state.lastId,
    });

    // Store outgoing plaintext directly (we can't decrypt our own outgoing DMs)
    const dm: DecryptedDM = {
      id: obj.id,
      from: this.identity.publicKeyBase64,
      to: recipientPublicKey,
      text,
      timestamp: obj.body.timestamp,
      outgoing: true,
    };
    const conv = this.conversations.get(recipientPublicKey) || [];
    if (!conv.some((m) => m.id === dm.id)) {
      conv.push(dm);
      conv.sort((a, b) => a.timestamp - b.timestamp);
      this.conversations.set(recipientPublicKey, conv);
      this.emitChange();
    }

    // Persist plaintext for outgoing messages in localStorage
    this.storeOutgoingPlaintext(obj.id, text);

    await this.feedManager.publish(obj);
  }

  private storeOutgoingPlaintext(id: string, text: string): void {
    try {
      const key = `agora_dm_out:${id}`;
      localStorage.setItem(key, text);
    } catch { /* localStorage full or unavailable */ }
  }

  private getOutgoingPlaintext(id: string): string | null {
    try {
      return localStorage.getItem(`agora_dm_out:${id}`);
    } catch { return null; }
  }

  getConversation(partner: string): DecryptedDM[] {
    return this.conversations.get(partner) || [];
  }

  getConversationList(): Array<{ partner: string; lastMessage: DecryptedDM }> {
    const list: Array<{ partner: string; lastMessage: DecryptedDM }> = [];
    for (const [partner, msgs] of this.conversations) {
      if (msgs.length > 0) {
        list.push({ partner, lastMessage: msgs[msgs.length - 1] });
      }
    }
    list.sort((a, b) => b.lastMessage.timestamp - a.lastMessage.timestamp);
    return list;
  }
}
