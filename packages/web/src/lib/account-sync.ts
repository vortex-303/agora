import {
  createObject,
  selfEncrypt,
  selfDecrypt,
  deriveX25519FromMnemonic,
  toBase64,
  fromBase64,
  type SignedObject,
  type EncryptedStateContent,
  type StateCategory,
  type Identity,
} from '@agora/core';
import type { FeedManager } from './feed.js';

interface AccountState {
  contacts: string[];
  blocked: string[];
  settings: {
    concierge?: {
      availability?: string;
      services?: string;
      preferredContact?: string;
      links?: Array<{ label: string; url: string }>;
      faqs?: Array<{ q: string; a: string }>;
    };
  };
}

export class AccountSync {
  private feedManager: FeedManager;
  private identity: Identity;
  private x25519Private: Uint8Array;
  private x25519Public: Uint8Array;
  private state: AccountState = { contacts: [], blocked: [], settings: {} };
  private changeHandlers: Array<() => void> = [];
  private latestSeqPerCategory = new Map<StateCategory, number>();

  constructor(feedManager: FeedManager, identity: Identity) {
    this.feedManager = feedManager;
    this.identity = identity;
    const x25519 = deriveX25519FromMnemonic(identity.mnemonic);
    this.x25519Private = x25519.privateKey;
    this.x25519Public = x25519.publicKey;
  }

  onChange(handler: () => void): void { this.changeHandlers.push(handler); }
  private emitChange(): void { for (const h of this.changeHandlers) h(); }

  async init(): Promise<void> {
    // Load from localStorage first (instant)
    this.loadLocal();

    // Listen for encrypted_state objects from P2P
    this.feedManager.onObject(async (obj) => {
      if (obj.body.type === 'encrypted_state' && obj.body.author === this.identity.publicKeyBase64) {
        await this.handleStateObject(obj);
      }
    });
  }

  private loadLocal(): void {
    try {
      const contacts = localStorage.getItem('riot_contacts');
      if (contacts) this.state.contacts = JSON.parse(contacts);
    } catch {}
    try {
      const blocked = localStorage.getItem('agora_blocked');
      if (blocked) this.state.blocked = JSON.parse(blocked);
    } catch {}
    try {
      const concierge = localStorage.getItem('riot_concierge_profile');
      if (concierge) this.state.settings.concierge = JSON.parse(concierge);
    } catch {}
  }

  private saveLocal(): void {
    try {
      localStorage.setItem('riot_contacts', JSON.stringify(this.state.contacts));
      localStorage.setItem('agora_blocked', JSON.stringify(this.state.blocked));
      if (this.state.settings.concierge) {
        localStorage.setItem('riot_concierge_profile', JSON.stringify(this.state.settings.concierge));
      }
    } catch {}
  }

  private async handleStateObject(obj: SignedObject): Promise<void> {
    const content = obj.body.content as EncryptedStateContent;
    const category = content.category;

    // Only process if newer than what we have
    const prevSeq = this.latestSeqPerCategory.get(category) || 0;
    if (obj.body.seq <= prevSeq) return;
    this.latestSeqPerCategory.set(category, obj.body.seq);

    try {
      const plaintext = await selfDecrypt(
        fromBase64(content.ciphertext),
        fromBase64(content.nonce),
        this.x25519Private,
        this.x25519Public
      );
      const data = JSON.parse(plaintext);

      switch (category) {
        case 'contacts':
          this.state.contacts = data;
          break;
        case 'blocked':
          this.state.blocked = data;
          break;
        case 'settings':
          this.state.settings = data;
          break;
      }

      this.saveLocal();
      this.emitChange();
    } catch {
      // Can't decrypt — not our object or corrupted
    }
  }

  private async publishState(category: StateCategory, data: any): Promise<void> {
    const plaintext = JSON.stringify(data);
    const { ciphertext, nonce } = await selfEncrypt(plaintext, this.x25519Private, this.x25519Public);

    const state = this.feedManager.getAuthorState(this.identity.publicKeyBase64);
    const obj = createObject({
      author: this.identity.publicKeyBase64,
      privateKey: this.identity.privateKey,
      type: 'encrypted_state',
      content: {
        category,
        ciphertext: toBase64(ciphertext),
        nonce: toBase64(nonce),
      } as EncryptedStateContent,
      seq: state.seq + 1,
      prev: state.lastId,
    });

    await this.feedManager.publish(obj);
  }

  // --- Contacts ---

  getContacts(): string[] {
    return [...this.state.contacts];
  }

  async addContact(pubkey: string): Promise<void> {
    if (this.state.contacts.includes(pubkey)) return;
    this.state.contacts.push(pubkey);
    this.saveLocal();
    this.emitChange();
    await this.publishState('contacts', this.state.contacts);
  }

  async removeContact(pubkey: string): Promise<void> {
    this.state.contacts = this.state.contacts.filter(c => c !== pubkey);
    this.saveLocal();
    this.emitChange();
    await this.publishState('contacts', this.state.contacts);
  }

  // --- Blocked ---

  getBlocked(): string[] {
    return [...this.state.blocked];
  }

  isBlocked(pubkey: string): boolean {
    return this.state.blocked.includes(pubkey);
  }

  async block(pubkey: string): Promise<void> {
    if (this.state.blocked.includes(pubkey)) return;
    this.state.blocked.push(pubkey);
    this.saveLocal();
    this.emitChange();
    await this.publishState('blocked', this.state.blocked);
  }

  async unblock(pubkey: string): Promise<void> {
    this.state.blocked = this.state.blocked.filter(b => b !== pubkey);
    this.saveLocal();
    this.emitChange();
    await this.publishState('blocked', this.state.blocked);
  }

  // --- Settings ---

  getSettings(): AccountState['settings'] {
    return { ...this.state.settings };
  }

  async updateSettings(settings: AccountState['settings']): Promise<void> {
    this.state.settings = { ...this.state.settings, ...settings };
    this.saveLocal();
    this.emitChange();
    await this.publishState('settings', this.state.settings);
  }
}
