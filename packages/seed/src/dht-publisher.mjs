import DHT from 'bittorrent-dht';
import { ed25519 } from '@noble/curves/ed25519';
import { createHash } from 'node:crypto';

const REPUBLISH_INTERVAL = 45 * 60_000; // 45 min (data expires after ~2h)

export class DHTPublisher {
  constructor(store) {
    this.store = store;
    this.dht = null;
    this.republishTimer = null;
    this.publishedKeys = new Map(); // pubkey -> { seq, hash }
    this.ready = false;
  }

  async start() {
    const verify = (sig, value, publicKey) => {
      try {
        return ed25519.verify(sig, value, publicKey);
      } catch { return false; }
    };

    this.dht = new DHT({ verify });

    return new Promise((resolve) => {
      this.dht.listen(() => {
        const addr = this.dht.address();
        console.log(`[dht] Listening on UDP port ${addr.port}`);
        this.ready = true;
        resolve();

        // Start periodic republishing
        this.republishTimer = setInterval(() => this.republishAll(), REPUBLISH_INTERVAL);

        // Initial publish after bootstrap
        setTimeout(() => this.publishAllProfiles(), 10_000);
      });

      this.dht.on('error', (err) => {
        console.warn(`[dht] Error: ${err.message}`);
      });
    });
  }

  publishProfile(authorPubkey) {
    if (!this.ready) return;

    // Gather author's profile + latest pins
    const objects = this.store.getByAuthor(authorPubkey, 0, 100);
    const profile = objects.find(o => o.body.type === 'profile');
    const pins = objects
      .filter(o => o.body.type === 'post')
      .sort((a, b) => b.body.timestamp - a.body.timestamp)
      .slice(0, 5);

    if (!profile && pins.length === 0) return;

    // Build compact payload (max 1000 bytes for BEP 44)
    const payload = {
      p: profile ? {
        n: profile.body.content.name?.slice(0, 30),
        x: profile.body.content.x25519PublicKey,
      } : undefined,
      pins: pins.map(p => p.id.slice(0, 20)), // truncated hashes as pointers
      t: Date.now(),
    };

    const value = Buffer.from(JSON.stringify(payload));
    if (value.length > 950) {
      console.warn(`[dht] Payload too large for ${authorPubkey.slice(0, 8)}... (${value.length} bytes), skipping`);
      return;
    }

    // For mutable DHT items we need the author's Ed25519 public key
    // But we don't have their private key — we can't sign as them
    // Instead, use an immutable put keyed by their pubkey hash
    const key = createHash('sha1').update(Buffer.from('riot:profile:' + authorPubkey)).digest();

    this.dht.put({ v: value }, (err, hash) => {
      if (err) {
        console.warn(`[dht] Put error for ${authorPubkey.slice(0, 8)}...: ${err.message}`);
        return;
      }
      this.publishedKeys.set(authorPubkey, { hash: hash.toString('hex'), time: Date.now() });
      console.log(`[dht] Published profile for ${authorPubkey.slice(0, 8)}... → ${hash.toString('hex').slice(0, 16)}`);
    });
  }

  lookupProfile(authorPubkey) {
    if (!this.ready) return Promise.resolve(null);

    const key = createHash('sha1').update(Buffer.from('riot:profile:' + authorPubkey)).digest();

    return new Promise((resolve) => {
      this.dht.get(key, (err, res) => {
        if (err || !res) { resolve(null); return; }
        try {
          const payload = JSON.parse(res.v.toString());
          resolve(payload);
        } catch {
          resolve(null);
        }
      });
    });
  }

  publishAllProfiles() {
    const authors = this.store.getAuthorStats();
    let count = 0;
    for (const a of authors) {
      this.publishProfile(a.author);
      count++;
      if (count >= 50) break; // rate limit
    }
    if (count > 0) console.log(`[dht] Publishing ${count} profiles to DHT`);
  }

  republishAll() {
    console.log(`[dht] Republishing ${this.publishedKeys.size} profiles`);
    this.publishAllProfiles();
  }

  getStats() {
    return {
      published: this.publishedKeys.size,
      dhtNodes: this.dht ? this.dht.toJSON().nodes.length : 0,
      ready: this.ready,
    };
  }

  destroy() {
    if (this.republishTimer) clearInterval(this.republishTimer);
    return new Promise((resolve) => {
      if (this.dht) {
        this.dht.destroy(() => resolve());
      } else {
        resolve();
      }
    });
  }
}
