import {
  createObject,
  encryptDM,
  decryptDM,
  deriveX25519FromMnemonic,
  toBase64,
  fromBase64,
  type SignedObject,
  type DMContent,
  type ReadReceiptContent,
  type Identity,
} from '@agora/core';
import type { FeedManager } from './feed.js';
import { CacheManager } from './cache.js';

export type DMStatus = 'queued' | 'sent' | 'read';

export interface DecryptedDM {
  id: string;
  from: string;
  to: string;
  text: string;
  timestamp: number;
  outgoing: boolean;
  status?: DMStatus;
}

export class DMManager {
  private feedManager: FeedManager;
  private identity: Identity;
  private x25519Private: Uint8Array;
  private x25519Public: Uint8Array;
  private x25519PublicBase64: string;
  private cache: CacheManager;

  private conversations = new Map<string, DecryptedDM[]>();
  private changeHandlers: (() => void)[] = [];
  private activePartner: string | null = null;
  private sentIds = new Set<string>();
  private readReceiptsSent = new Set<string>();

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

    this.feedManager.onObject(async (obj) => {
      if (obj.body.type === 'dm') {
        await this.handleDMObject(obj);
      } else if (obj.body.type === 'read_receipt') {
        this.handleReadReceipt(obj);
      }
    });

    // When peers connect, check if queued messages can be marked sent
    this.feedManager.swarmManager.onPeerChange(() => {
      this.updateDeliveryStatus();
    });

    // Load cached DMs — live DMs arrive via P2P gossip
    await this.loadCachedDMs();

    // Pre-connect DM swarms for all existing conversations
    for (const [partner] of this.conversations) {
      this.feedManager.joinDMSwarm(partner);
    }
  }

  openConversation(partner: string): void {
    if (this.activePartner === partner) return;
    if (this.activePartner) {
      this.feedManager.leaveDMSwarm(this.activePartner);
      this.feedManager.leaveUserSwarm(this.activePartner);
    }
    this.activePartner = partner;
    this.feedManager.joinDMSwarm(partner);
    this.feedManager.joinUserSwarm(partner);
  }

  closeConversation(): void {
    if (this.activePartner) {
      this.feedManager.leaveDMSwarm(this.activePartner);
      this.feedManager.leaveUserSwarm(this.activePartner);
      this.activePartner = null;
    }
  }

  private async sendReadReceipt(messageId: string, senderPubkey: string): Promise<void> {
    const state = this.feedManager.getAuthorState(this.identity.publicKeyBase64);
    const obj = createObject({
      author: this.identity.publicKeyBase64,
      privateKey: this.identity.privateKey,
      type: 'read_receipt',
      content: { messageId } as ReadReceiptContent,
      seq: state.seq + 1,
      prev: state.lastId,
    });
    // Send directly to the message sender, not broadcast
    this.feedManager.gossipTo(obj, senderPubkey);
    // Also store in cache for sync
    await this.feedManager.publish(obj);
  }

  private handleReadReceipt(obj: SignedObject): void {
    const content = obj.body.content as ReadReceiptContent;
    // Find the message and update its status to 'read'
    for (const [, msgs] of this.conversations) {
      const msg = msgs.find(m => m.id === content.messageId);
      if (msg && msg.outgoing && msg.status !== 'read') {
        msg.status = 'read';
        this.emitChange();
        return;
      }
    }
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
      text = this.getOutgoingPlaintext(obj.id);
      if (!text) text = '[message sent from this device]';
    } else {
      try {
        text = await decryptDM(
          fromBase64(content.ciphertext),
          fromBase64(content.ephemeralPublicKey),
          fromBase64(content.nonce),
          this.x25519Private
        );
      } catch {
        return;
      }
    }

    const partner = isOutgoing ? content.recipient : obj.body.author;

    // If we received our own message back from a peer, it was delivered
    if (isOutgoing && !this.sentIds.has(obj.id)) {
      this.sentIds.add(obj.id);
    }

    // Send read receipt for incoming messages we just decrypted
    if (isIncoming && !this.readReceiptsSent.has(obj.id)) {
      this.readReceiptsSent.add(obj.id);
      this.sendReadReceipt(obj.id, obj.body.author);
    }

    const dm: DecryptedDM = {
      id: obj.id,
      from: obj.body.author,
      to: content.recipient,
      text,
      timestamp: obj.body.timestamp,
      outgoing: isOutgoing,
      status: isOutgoing ? (this.sentIds.has(obj.id) ? 'sent' : 'queued') : undefined,
    };

    const conv = this.conversations.get(partner) || [];
    const existing = conv.findIndex(m => m.id === dm.id);
    if (existing !== -1) {
      // Update status if it changed (never downgrade from 'read')
      if (dm.status && conv[existing].status !== 'read' && conv[existing].status !== dm.status) {
        conv[existing].status = dm.status;
        this.emitChange();
      }
      return;
    }
    conv.push(dm);
    conv.sort((a, b) => a.timestamp - b.timestamp);
    this.conversations.set(partner, conv);
    this.emitChange();
  }

  private updateDeliveryStatus(): void {
    const hasPeers = this.feedManager.swarmManager.getConnectedCount() > 0;
    if (!hasPeers) return;

    let changed = false;
    for (const [, msgs] of this.conversations) {
      for (const msg of msgs) {
        if (msg.outgoing && msg.status === 'queued') {
          msg.status = 'sent';
          this.sentIds.add(msg.id);
          changed = true;
        }
      }
    }
    if (changed) this.emitChange();
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

    // Send directly to recipient (not broadcast to all peers)
    const directSent = this.feedManager.gossipTo(obj, recipientPublicKey);
    const status: DMStatus = directSent ? 'sent' : 'queued';
    if (directSent) this.sentIds.add(obj.id);

    const dm: DecryptedDM = {
      id: obj.id,
      from: this.identity.publicKeyBase64,
      to: recipientPublicKey,
      text,
      timestamp: obj.body.timestamp,
      outgoing: true,
      status,
    };
    const conv = this.conversations.get(recipientPublicKey) || [];
    if (!conv.some((m) => m.id === dm.id)) {
      conv.push(dm);
      conv.sort((a, b) => a.timestamp - b.timestamp);
      this.conversations.set(recipientPublicKey, conv);
      this.emitChange();
    }

    this.storeOutgoingPlaintext(obj.id, text);
    // Store in cache + gossip as fallback (direct send already happened above)
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
