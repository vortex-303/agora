import { existsSync, readFileSync, writeFileSync, appendFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';

export class ObjectStore extends EventEmitter {
  constructor(dataDir, opts = {}) {
    super();
    this.dataDir = dataDir;
    this.filePath = join(dataDir, 'objects.jsonl');
    this.objects = new Map();
    this.authorSeq = new Map();
    this.authorCount = new Map();
    this.storageBudgetMB = opts.budgetMB || 2048;
    this.neighborhoodPrefix = null;
  }

  async load() {
    if (!existsSync(this.filePath)) return;
    try {
      const data = readFileSync(this.filePath, 'utf-8');
      for (const line of data.split('\n')) {
        if (!line.trim()) continue;
        try {
          const obj = JSON.parse(line);
          if (obj.id && obj.body) {
            this.objects.set(obj.id, obj);
            this.trackSeq(obj);
          }
        } catch {}
      }
      console.log(`[store] Loaded ${this.objects.size} objects from disk`);
    } catch (e) {
      console.warn(`[store] Could not load: ${e.message}`);
    }
  }

  setNeighborhood(pubkeyHash) {
    this.neighborhoodPrefix = pubkeyHash.slice(0, 4);
  }

  isInNeighborhood(authorPubkey) {
    if (!this.neighborhoodPrefix) return true;
    const hash = createHash('sha1').update(authorPubkey).digest('hex');
    return hash.startsWith(this.neighborhoodPrefix);
  }

  trackSeq(obj) {
    const author = obj.body.author;
    const seq = obj.body.seq;
    const current = this.authorSeq.get(author) || 0;
    if (seq > current) this.authorSeq.set(author, seq);
    this.authorCount.set(author, (this.authorCount.get(author) || 0) + 1);
  }

  put(obj) {
    if (this.objects.has(obj.id)) return false;

    // Check budget
    if (this.getStorageSize() > this.storageBudgetMB * 1024 * 1024) {
      this.evict();
    }

    const author = obj.body.author;
    const isNewAuthor = !this.authorSeq.has(author);

    this.objects.set(obj.id, obj);
    this.trackSeq(obj);
    try {
      appendFileSync(this.filePath, JSON.stringify(obj) + '\n');
    } catch (e) {
      console.warn(`[store] Write error: ${e.message}`);
    }

    if (isNewAuthor) this.emit('new-author', { author, firstObject: obj });
    this.emit('new-object', obj);
    return true;
  }

  evict() {
    // Evict oldest objects from authors outside our neighborhood
    const candidates = [...this.objects.values()]
      .filter(o => !this.isInNeighborhood(o.body.author))
      .sort((a, b) => a.body.timestamp - b.body.timestamp);

    const toRemove = Math.max(Math.floor(candidates.length * 0.2), 10);
    for (let i = 0; i < toRemove && i < candidates.length; i++) {
      this.objects.delete(candidates[i].id);
    }
    console.log(`[store] Evicted ${Math.min(toRemove, candidates.length)} objects`);
    this.rebuildStats();
    this.save();
  }

  rebuildStats() {
    this.authorSeq.clear();
    this.authorCount.clear();
    for (const obj of this.objects.values()) {
      const author = obj.body.author;
      const seq = obj.body.seq;
      const current = this.authorSeq.get(author) || 0;
      if (seq > current) this.authorSeq.set(author, seq);
      this.authorCount.set(author, (this.authorCount.get(author) || 0) + 1);
    }
  }

  has(id) {
    return this.objects.has(id);
  }

  get(id) {
    return this.objects.get(id);
  }

  getByAuthor(author, afterSeq = 0, limit = 50) {
    const results = [];
    for (const obj of this.objects.values()) {
      if (obj.body.author === author && obj.body.seq > afterSeq) {
        results.push(obj);
      }
    }
    results.sort((a, b) => a.body.seq - b.body.seq);
    return results.slice(0, limit);
  }

  query({ type, author, limit = 50 } = {}) {
    let results = [...this.objects.values()];
    if (type) results = results.filter(o => o.body.type === type);
    if (author) results = results.filter(o => o.body.author === author);
    results.sort((a, b) => b.body.timestamp - a.body.timestamp);
    return results.slice(0, limit).map(o => ({
      id: o.id,
      type: o.body.type,
      author: o.body.author.slice(0, 16) + '...',
      seq: o.body.seq,
      timestamp: o.body.timestamp,
      preview: o.body.content?.text?.slice(0, 80) || o.body.content?.name || '',
    }));
  }

  getDMPairs() {
    const pairs = new Set();
    for (const obj of this.objects.values()) {
      if (obj.body.type === 'dm' && obj.body.content?.recipient) {
        const sorted = [obj.body.author, obj.body.content.recipient].sort();
        pairs.add(sorted.join(':'));
      }
    }
    return [...pairs];
  }

  getWatermarks() {
    const wm = {};
    for (const [author, seq] of this.authorSeq) {
      wm[author] = seq;
    }
    return wm;
  }

  getAuthorCount() {
    return this.authorSeq.size;
  }

  getAuthorStats() {
    const stats = [];
    for (const [author, maxSeq] of this.authorSeq) {
      stats.push({
        author,
        maxSeq,
        count: this.authorCount.get(author) || 0,
      });
    }
    stats.sort((a, b) => b.count - a.count);
    return stats;
  }

  getStorageSize() {
    try {
      if (existsSync(this.filePath)) {
        return statSync(this.filePath).size;
      }
    } catch {}
    return 0;
  }

  getNeighborhoodStats() {
    if (!this.neighborhoodPrefix) return { prefix: 'all', inNeighborhood: this.objects.size, outside: 0 };
    let inside = 0, outside = 0;
    for (const obj of this.objects.values()) {
      if (this.isInNeighborhood(obj.body.author)) inside++;
      else outside++;
    }
    return { prefix: this.neighborhoodPrefix, inNeighborhood: inside, outside };
  }

  count() {
    return this.objects.size;
  }

  save() {
    try {
      const lines = [...this.objects.values()].map(o => JSON.stringify(o)).join('\n') + '\n';
      writeFileSync(this.filePath, lines);
      console.log(`[store] Saved ${this.objects.size} objects`);
    } catch (e) {
      console.warn(`[store] Save error: ${e.message}`);
    }
  }
}
