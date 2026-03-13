import { describe, it, expect } from 'vitest';
import {
  generateIdentity,
  createObject,
  validateObject,
  canonicalize,
  hashString,
  toBase64,
  fromBase64,
} from '../src/index.js';
import type { PostContent, SignedObject } from '../src/types.js';

describe('createObject', () => {
  it('creates a valid signed post', () => {
    const id = generateIdentity();
    const obj = createObject({
      author: id.publicKeyBase64,
      privateKey: id.privateKey,
      type: 'post',
      content: { text: 'Hello, Agora!', topic: 'general' } as PostContent,
      seq: 1,
      timestamp: 1700000000000,
    });

    expect(obj.id).toMatch(/^sha256:/);
    expect(obj.body.author).toBe(id.publicKeyBase64);
    expect(obj.body.seq).toBe(1);
    expect(obj.body.type).toBe('post');
    expect((obj.body.content as PostContent).text).toBe('Hello, Agora!');
  });

  it('hash is content-addressed', () => {
    const id = generateIdentity();
    const params = {
      author: id.publicKeyBase64,
      privateKey: id.privateKey,
      type: 'post' as const,
      content: { text: 'test' } as PostContent,
      seq: 1,
      timestamp: 1700000000000,
    };
    const obj1 = createObject(params);
    const obj2 = createObject(params);
    expect(obj1.id).toBe(obj2.id);
  });

  it('chains objects via prev', () => {
    const id = generateIdentity();
    const obj1 = createObject({
      author: id.publicKeyBase64,
      privateKey: id.privateKey,
      type: 'post',
      content: { text: 'first' },
      seq: 1,
      timestamp: 1700000000000,
    });
    const obj2 = createObject({
      author: id.publicKeyBase64,
      privateKey: id.privateKey,
      type: 'post',
      content: { text: 'second' },
      seq: 2,
      prev: obj1.id,
      timestamp: 1700000001000,
    });
    expect(obj2.body.prev).toBe(obj1.id);
    expect(obj2.body.seq).toBe(2);
  });
});

describe('validateObject', () => {
  it('validates a correctly signed object', () => {
    const id = generateIdentity();
    const obj = createObject({
      author: id.publicKeyBase64,
      privateKey: id.privateKey,
      type: 'post',
      content: { text: 'valid' },
      seq: 1,
      timestamp: 1700000000000,
    });
    const result = validateObject(obj);
    expect(result.valid).toBe(true);
    expect(result.error).toBeUndefined();
  });

  it('rejects tampered body (text changed)', () => {
    const id = generateIdentity();
    const obj = createObject({
      author: id.publicKeyBase64,
      privateKey: id.privateKey,
      type: 'post',
      content: { text: 'original' },
      seq: 1,
      timestamp: 1700000000000,
    });

    // Tamper with content
    const tampered: SignedObject = {
      ...obj,
      body: {
        ...obj.body,
        content: { text: 'tampered' },
      },
    };

    const result = validateObject(tampered);
    expect(result.valid).toBe(false);
    expect(result.error).toContain('Hash mismatch');
  });

  it('rejects tampered body with recalculated hash but wrong sig', () => {
    const id = generateIdentity();
    const obj = createObject({
      author: id.publicKeyBase64,
      privateKey: id.privateKey,
      type: 'post',
      content: { text: 'original' },
      seq: 1,
      timestamp: 1700000000000,
    });

    // Tamper and fix hash but keep old sig
    const newBody = { ...obj.body, content: { text: 'tampered' } };
    const newId = hashString(canonicalize(newBody));
    const tampered: SignedObject = {
      body: newBody,
      id: newId,
      sig: obj.sig, // old signature
    };

    const result = validateObject(tampered);
    expect(result.valid).toBe(false);
    expect(result.error).toContain('Invalid signature');
  });

  it('rejects object signed by wrong key', () => {
    const id1 = generateIdentity();
    const id2 = generateIdentity();

    // Create with id1's key but claim id2 as author
    const obj = createObject({
      author: id2.publicKeyBase64, // claim to be id2
      privateKey: id1.privateKey, // but sign with id1
      type: 'post',
      content: { text: 'forged' },
      seq: 1,
      timestamp: 1700000000000,
    });

    const result = validateObject(obj);
    expect(result.valid).toBe(false);
    expect(result.error).toContain('Invalid signature');
  });
});

describe('serialization round-trip', () => {
  it('survives JSON serialize/deserialize', () => {
    const id = generateIdentity();
    const obj = createObject({
      author: id.publicKeyBase64,
      privateKey: id.privateKey,
      type: 'post',
      content: { text: 'roundtrip', topic: 'test' },
      seq: 1,
      timestamp: 1700000000000,
    });

    const json = JSON.stringify(obj);
    const parsed: SignedObject = JSON.parse(json);
    const result = validateObject(parsed);
    expect(result.valid).toBe(true);
  });
});
