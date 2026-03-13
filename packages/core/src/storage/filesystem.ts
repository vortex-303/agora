import type { SignedObject, PostContent } from '../types.js';
import type { StorageAdapter } from '../storage.js';
import { readFileSync, writeFileSync, existsSync, mkdirSync, unlinkSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

export class FilesystemStorage implements StorageAdapter {
  private dir: string;

  constructor(dir: string) {
    this.dir = dir;
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
  }

  private filePath(id: string): string {
    // "sha256:<hex>" → use hex as filename
    const hex = id.startsWith('sha256:') ? id.slice(7) : id;
    // 2-char prefix directory for sharding
    const prefix = hex.slice(0, 2);
    const prefixDir = join(this.dir, prefix);
    if (!existsSync(prefixDir)) {
      mkdirSync(prefixDir, { recursive: true });
    }
    return join(prefixDir, hex + '.json');
  }

  async put(obj: SignedObject): Promise<void> {
    writeFileSync(this.filePath(obj.id), JSON.stringify(obj));
  }

  async get(id: string): Promise<SignedObject | null> {
    const path = this.filePath(id);
    if (!existsSync(path)) return null;
    return JSON.parse(readFileSync(path, 'utf-8'));
  }

  async has(id: string): Promise<boolean> {
    return existsSync(this.filePath(id));
  }

  async delete(id: string): Promise<boolean> {
    const path = this.filePath(id);
    if (!existsSync(path)) return false;
    unlinkSync(path);
    return true;
  }

  private readAll(): SignedObject[] {
    const objects: SignedObject[] = [];
    if (!existsSync(this.dir)) return objects;
    for (const prefix of readdirSync(this.dir)) {
      const prefixDir = join(this.dir, prefix);
      try {
        for (const file of readdirSync(prefixDir)) {
          if (!file.endsWith('.json')) continue;
          try {
            const data = readFileSync(join(prefixDir, file), 'utf-8');
            objects.push(JSON.parse(data));
          } catch { /* skip corrupt files */ }
        }
      } catch { /* not a directory */ }
    }
    return objects;
  }

  async listByAuthor(author: string, afterSeq?: number, limit?: number): Promise<SignedObject[]> {
    const all = this.readAll()
      .filter((o) => o.body.author === author && (afterSeq === undefined || o.body.seq > afterSeq))
      .sort((a, b) => a.body.seq - b.body.seq);
    return limit ? all.slice(0, limit) : all;
  }

  async listByTopic(topic: string, since?: number, limit?: number): Promise<SignedObject[]> {
    const all = this.readAll()
      .filter(
        (o) =>
          o.body.type === 'post' &&
          (o.body.content as PostContent).topic === topic &&
          (since === undefined || o.body.timestamp > since)
      )
      .sort((a, b) => a.body.timestamp - b.body.timestamp);
    return limit ? all.slice(0, limit) : all;
  }

  async list(since?: number, limit?: number): Promise<SignedObject[]> {
    const all = this.readAll()
      .filter((o) => since === undefined || o.body.timestamp > since)
      .sort((a, b) => a.body.timestamp - b.body.timestamp);
    return limit ? all.slice(0, limit) : all;
  }
}
