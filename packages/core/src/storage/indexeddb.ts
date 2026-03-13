import type { SignedObject, PostContent } from '../types.js';
import type { StorageAdapter } from '../storage.js';

const DB_NAME = 'agora_objects';
const DB_VERSION = 1;
const STORE_NAME = 'objects';

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
        store.createIndex('author_seq', ['body.author', 'body.seq'], { unique: false });
        store.createIndex('timestamp', 'body.timestamp', { unique: false });
      }
    };
  });
}

export class IndexedDBStorage implements StorageAdapter {
  private dbPromise: Promise<IDBDatabase> | null = null;

  private getDB(): Promise<IDBDatabase> {
    if (!this.dbPromise) {
      this.dbPromise = openDB();
    }
    return this.dbPromise;
  }

  async put(obj: SignedObject): Promise<void> {
    const db = await this.getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).put(obj);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async get(id: string): Promise<SignedObject | null> {
    const db = await this.getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const request = tx.objectStore(STORE_NAME).get(id);
      request.onsuccess = () => resolve(request.result ?? null);
      request.onerror = () => reject(request.error);
    });
  }

  async has(id: string): Promise<boolean> {
    const obj = await this.get(id);
    return obj !== null;
  }

  async delete(id: string): Promise<boolean> {
    const had = await this.has(id);
    if (!had) return false;
    const db = await this.getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).delete(id);
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => reject(tx.error);
    });
  }

  async listByAuthor(author: string, afterSeq?: number, limit?: number): Promise<SignedObject[]> {
    const db = await this.getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const index = tx.objectStore(STORE_NAME).index('author_seq');
      const lower = [author, afterSeq ?? 0];
      const upper = [author, Number.MAX_SAFE_INTEGER];
      const range = IDBKeyRange.bound(lower, upper, !!afterSeq, false);
      const request = index.getAll(range, limit);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async listByTopic(topic: string, since?: number, limit?: number): Promise<SignedObject[]> {
    // Full scan with filter — IndexedDB doesn't support compound indexes on nested content fields
    const all = await this.list(since, undefined);
    const filtered = all.filter(
      (obj) => obj.body.type === 'post' && (obj.body.content as PostContent).topic === topic
    );
    return limit ? filtered.slice(0, limit) : filtered;
  }

  async list(since?: number, limit?: number): Promise<SignedObject[]> {
    const db = await this.getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const index = tx.objectStore(STORE_NAME).index('timestamp');
      const range = since ? IDBKeyRange.lowerBound(since, true) : undefined;
      const request = index.getAll(range, limit);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }
}
