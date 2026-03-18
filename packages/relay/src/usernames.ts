import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { config } from './config.js';

interface UsernameEntry {
  username: string;
  publicKey: string;
  claimed: number;    // unix ms
  expires: number;    // unix ms
  lastActive: number; // unix ms
}

const LEASE_DURATION = 365 * 24 * 60 * 60 * 1000; // 1 year
const INACTIVE_THRESHOLD = 90 * 24 * 60 * 60 * 1000; // 90 days
const GRACE_PERIOD = 30 * 24 * 60 * 60 * 1000; // 30 days after inactive

export class UsernameRegistry {
  private entries = new Map<string, UsernameEntry>(); // username → entry
  private keyToUsername = new Map<string, string>(); // publicKey → username
  private filePath: string;

  constructor() {
    this.filePath = join(config.dataDir, 'usernames.json');
    this.load();
  }

  private load(): void {
    try {
      if (existsSync(this.filePath)) {
        const data = JSON.parse(readFileSync(this.filePath, 'utf-8'));
        for (const entry of data) {
          this.entries.set(entry.username, entry);
          this.keyToUsername.set(entry.publicKey, entry.username);
        }
        console.log(`[Usernames] Loaded ${this.entries.size} usernames`);
      }
    } catch { /* no file yet */ }
  }

  private save(): void {
    try {
      writeFileSync(this.filePath, JSON.stringify([...this.entries.values()], null, 2));
    } catch (e) {
      console.error('[Usernames] Failed to save:', e);
    }
  }

  claim(username: string, publicKey: string): { ok: boolean; error?: string } {
    const name = username.toLowerCase().trim();

    // Validate
    if (name.length < 2 || name.length > 20) return { ok: false, error: 'Username must be 2-20 characters' };
    if (!/^[a-z0-9_-]+$/.test(name)) return { ok: false, error: 'Only lowercase letters, numbers, - and _' };

    // Reserved
    const reserved = ['admin', 'riot', 'system', 'help', 'settings', 'setup', 'dm', 'inbox', 'network', 'status', 'p'];
    if (reserved.includes(name)) return { ok: false, error: 'Reserved name' };

    // Already own a name? Release old one first
    const existingName = this.keyToUsername.get(publicKey);
    if (existingName && existingName !== name) {
      this.entries.delete(existingName);
      this.keyToUsername.delete(publicKey);
    }

    // Check if taken
    const existing = this.entries.get(name);
    if (existing && existing.publicKey !== publicKey) {
      // Check if expired or inactive
      if (this.isExpired(existing)) {
        // Release it
        this.keyToUsername.delete(existing.publicKey);
      } else {
        return { ok: false, error: 'Username taken' };
      }
    }

    const now = Date.now();
    const entry: UsernameEntry = {
      username: name,
      publicKey,
      claimed: existing?.publicKey === publicKey ? existing.claimed : now,
      expires: now + LEASE_DURATION,
      lastActive: now,
    };

    this.entries.set(name, entry);
    this.keyToUsername.set(publicKey, name);
    this.save();
    console.log(`[Usernames] ${name} → ${publicKey.slice(0, 8)}... (expires ${new Date(entry.expires).toISOString().slice(0, 10)})`);
    return { ok: true };
  }

  lookup(username: string): UsernameEntry | null {
    const entry = this.entries.get(username.toLowerCase().trim());
    if (!entry) return null;
    if (this.isExpired(entry)) {
      this.entries.delete(entry.username);
      this.keyToUsername.delete(entry.publicKey);
      this.save();
      return null;
    }
    return entry;
  }

  lookupByKey(publicKey: string): string | null {
    return this.keyToUsername.get(publicKey) || null;
  }

  // Called on every publish to keep activity fresh
  touchActivity(publicKey: string): void {
    const name = this.keyToUsername.get(publicKey);
    if (!name) return;
    const entry = this.entries.get(name);
    if (!entry) return;
    const now = Date.now();
    entry.lastActive = now;
    // Auto-extend if within 30 days of expiry
    if (entry.expires - now < 30 * 24 * 60 * 60 * 1000) {
      entry.expires = now + LEASE_DURATION;
      console.log(`[Usernames] Auto-renewed ${name} for another year`);
    }
    // Don't save on every touch — save periodically
  }

  // Periodic save (call every minute or so)
  periodicSave(): void {
    this.save();
  }

  private isExpired(entry: UsernameEntry): boolean {
    const now = Date.now();
    // Past expiry date
    if (now > entry.expires) return true;
    // Inactive for 90 days + 30 day grace
    if (now - entry.lastActive > INACTIVE_THRESHOLD + GRACE_PERIOD) return true;
    return false;
  }

  getStats(): { total: number; active: number } {
    let active = 0;
    const now = Date.now();
    for (const entry of this.entries.values()) {
      if (now - entry.lastActive < INACTIVE_THRESHOLD) active++;
    }
    return { total: this.entries.size, active };
  }
}
