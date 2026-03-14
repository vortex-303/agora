import type { SignedObject, PostContent } from '@agora/core';

const DB_NAME = 'agora_cache';
const DB_VERSION = 2;
const OBJECTS_STORE = 'objects';
const CURSORS_STORE = 'cursors';

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(OBJECTS_STORE)) {
        const store = db.createObjectStore(OBJECTS_STORE, { keyPath: 'id' });
        store.createIndex('author_seq', ['body.author', 'body.seq'], { unique: false });
        store.createIndex('timestamp', 'body.timestamp', { unique: false });
        store.createIndex('type', 'body.type', { unique: false });
      }
      if (!db.objectStoreNames.contains(CURSORS_STORE)) {
        db.createObjectStore(CURSORS_STORE);
      }
    };
  });
}

export class CacheManager {
  private db: IDBDatabase | null = null;

  async init(): Promise<void> {
    this.db = await openDB();
  }

  private getDB(): IDBDatabase {
    if (!this.db) throw new Error('CacheManager not initialized');
    return this.db;
  }

  async put(obj: SignedObject): Promise<void> {
    const db = this.getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(OBJECTS_STORE, 'readwrite');
      tx.objectStore(OBJECTS_STORE).put(obj);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async putMany(objects: SignedObject[]): Promise<void> {
    if (objects.length === 0) return;
    const db = this.getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(OBJECTS_STORE, 'readwrite');
      const store = tx.objectStore(OBJECTS_STORE);
      for (const obj of objects) {
        store.put(obj);
      }
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async get(id: string): Promise<SignedObject | null> {
    const db = this.getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(OBJECTS_STORE, 'readonly');
      const request = tx.objectStore(OBJECTS_STORE).get(id);
      request.onsuccess = () => resolve(request.result ?? null);
      request.onerror = () => reject(request.error);
    });
  }

  async has(id: string): Promise<boolean> {
    return (await this.get(id)) !== null;
  }

  async listByTimestamp(since?: number, limit?: number): Promise<SignedObject[]> {
    const db = this.getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(OBJECTS_STORE, 'readonly');
      const index = tx.objectStore(OBJECTS_STORE).index('timestamp');
      const range = since ? IDBKeyRange.lowerBound(since, true) : undefined;
      const request = index.getAll(range, limit);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async listPosts(since?: number, limit?: number): Promise<SignedObject[]> {
    // Get all objects by timestamp, filter to posts
    const all = await this.listByTimestamp(since);
    const posts = all.filter((o) => o.body.type === 'post');
    return limit ? posts.slice(0, limit) : posts;
  }

  async listPostsByTopic(topic: string, since?: number, limit?: number): Promise<SignedObject[]> {
    const posts = await this.listPosts(since);
    const filtered = posts.filter((o) => (o.body.content as PostContent).topic === topic);
    return limit ? filtered.slice(0, limit) : filtered;
  }

  // Sync cursors — track latest timestamp per subscription
  async getCursor(subscriptionId: string): Promise<number | null> {
    const db = this.getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(CURSORS_STORE, 'readonly');
      const request = tx.objectStore(CURSORS_STORE).get(subscriptionId);
      request.onsuccess = () => resolve(request.result ?? null);
      request.onerror = () => reject(request.error);
    });
  }

  async setCursor(subscriptionId: string, timestamp: number): Promise<void> {
    const db = this.getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(CURSORS_STORE, 'readwrite');
      tx.objectStore(CURSORS_STORE).put(timestamp, subscriptionId);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  // Update cursor if this object's timestamp is newer
  async updateCursor(subscriptionId: string, obj: SignedObject): Promise<void> {
    const current = await this.getCursor(subscriptionId);
    if (!current || obj.body.timestamp > current) {
      await this.setCursor(subscriptionId, obj.body.timestamp);
    }
  }
}
