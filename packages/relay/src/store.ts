import type { SignedObject, PostContent } from '@agora/core';
import type { SubscriptionFilter } from '@agora/core';
import { config } from './config.js';
import { existsSync, mkdirSync, appendFileSync, readFileSync, writeFileSync, readdirSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';

export class ObjectStore {
  private objects: Map<string, SignedObject> = new Map(); // id → object
  private authorSeqs: Map<string, SignedObject[]> = new Map(); // author → sorted by seq
  private insertOrder: string[] = []; // ring buffer of ids
  private dataDir: string;

  constructor() {
    this.dataDir = join(config.dataDir, 'objects');
    if (!existsSync(this.dataDir)) {
      mkdirSync(this.dataDir, { recursive: true });
    }
    this.loadFromDisk();
  }

  private loadFromDisk(): void {
    try {
      const files = readdirSync(this.dataDir).filter((f) => f.endsWith('.jsonl')).sort();
      for (const file of files) {
        const lines = readFileSync(join(this.dataDir, file), 'utf-8').split('\n').filter(Boolean);
        for (const line of lines) {
          try {
            const obj: SignedObject = JSON.parse(line);
            this.indexObject(obj);
          } catch { /* skip corrupt lines */ }
        }
      }
      console.log(`[Store] Loaded ${this.objects.size} objects from disk`);
    } catch { /* no data yet */ }
  }

  private indexObject(obj: SignedObject): void {
    if (this.objects.has(obj.id)) return;
    this.objects.set(obj.id, obj);
    this.insertOrder.push(obj.id);

    const authorFeed = this.authorSeqs.get(obj.body.author) || [];
    authorFeed.push(obj);
    authorFeed.sort((a, b) => a.body.seq - b.body.seq);
    this.authorSeqs.set(obj.body.author, authorFeed);
  }

  put(obj: SignedObject): boolean {
    if (this.objects.has(obj.id)) return false;

    // Enforce per-author limit
    const authorFeed = this.authorSeqs.get(obj.body.author) || [];
    if (authorFeed.length >= config.maxObjectsPerAuthor) {
      return false;
    }

    this.indexObject(obj);

    // Persist to daily JSONL file
    const date = new Date(obj.body.timestamp).toISOString().slice(0, 10);
    appendFileSync(join(this.dataDir, `${date}.jsonl`), JSON.stringify(obj) + '\n');

    // Evict old objects if over limit
    this.evict();

    return true;
  }

  get(id: string): SignedObject | undefined {
    return this.objects.get(id);
  }

  has(id: string): boolean {
    return this.objects.has(id);
  }

  match(filters: SubscriptionFilter[]): SignedObject[] {
    const results: SignedObject[] = [];
    const seen = new Set<string>();

    for (const filter of filters) {
      const candidates = this.getCandidates(filter);
      for (const obj of candidates) {
        if (seen.has(obj.id)) continue;
        if (this.matchesFilter(obj, filter)) {
          seen.add(obj.id);
          results.push(obj);
        }
      }
    }

    results.sort((a, b) => a.body.timestamp - b.body.timestamp);
    return results;
  }

  private getCandidates(filter: SubscriptionFilter): SignedObject[] {
    // If filtering by specific authors, use author index
    if (filter.authors && filter.authors.length > 0) {
      const candidates: SignedObject[] = [];
      for (const author of filter.authors) {
        const feed = this.authorSeqs.get(author) || [];
        if (filter.since) {
          candidates.push(...feed.filter((o) => o.body.timestamp > filter.since!));
        } else {
          candidates.push(...feed);
        }
      }
      return candidates;
    }
    // Otherwise scan all
    return Array.from(this.objects.values());
  }

  matchesFilter(obj: SignedObject, filter: SubscriptionFilter): boolean {
    if (filter.authors && !filter.authors.includes(obj.body.author)) return false;
    if (filter.types && !filter.types.includes(obj.body.type)) return false;
    if (filter.since && obj.body.timestamp <= filter.since) return false;
    if (filter.topics) {
      if (obj.body.type !== 'post') return false;
      const topic = (obj.body.content as PostContent).topic;
      if (!topic || !filter.topics.includes(topic)) return false;
    }
    return true;
  }

  private evict(): void {
    // TTL eviction
    const cutoff = Date.now() - config.objectTTL;
    while (this.insertOrder.length > 0) {
      const oldestId = this.insertOrder[0];
      const oldest = this.objects.get(oldestId);
      if (!oldest || oldest.body.timestamp < cutoff) {
        this.removeObject(this.insertOrder.shift()!);
      } else {
        break;
      }
    }

    // Size eviction
    while (this.insertOrder.length > config.maxObjects) {
      this.removeObject(this.insertOrder.shift()!);
    }
  }

  private removeObject(id: string): void {
    const obj = this.objects.get(id);
    if (!obj) return;
    this.objects.delete(id);
    const feed = this.authorSeqs.get(obj.body.author);
    if (feed) {
      const idx = feed.findIndex((o) => o.id === id);
      if (idx !== -1) feed.splice(idx, 1);
      if (feed.length === 0) this.authorSeqs.delete(obj.body.author);
    }
  }

  get size(): number {
    return this.objects.size;
  }
}
