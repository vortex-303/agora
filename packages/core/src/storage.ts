import type { SignedObject } from './types.js';

export interface StorageAdapter {
  put(obj: SignedObject): Promise<void>;
  get(id: string): Promise<SignedObject | null>;
  has(id: string): Promise<boolean>;
  delete(id: string): Promise<boolean>;

  // Query by author feed
  listByAuthor(author: string, afterSeq?: number, limit?: number): Promise<SignedObject[]>;

  // Query by topic + time
  listByTopic(topic: string, since?: number, limit?: number): Promise<SignedObject[]>;

  // List all objects (with optional pagination)
  list(since?: number, limit?: number): Promise<SignedObject[]>;
}
