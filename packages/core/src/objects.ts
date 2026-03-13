import type { ObjectBody, ObjectContent, ObjectType, SignedObject } from './types.js';
import { canonicalize, hashString, sign, verify, toBase64, fromBase64 } from './crypto.js';

export interface CreateObjectParams {
  author: string; // base64 public key
  privateKey: Uint8Array; // 32-byte Ed25519 seed
  type: ObjectType;
  content: ObjectContent;
  seq: number;
  prev?: string;
  timestamp?: number;
}

/**
 * Create a signed object: build body, compute content-addressed hash, sign.
 */
export function createObject(params: CreateObjectParams): SignedObject {
  const body: ObjectBody = {
    author: params.author,
    content: params.content,
    seq: params.seq,
    timestamp: params.timestamp ?? Date.now(),
    type: params.type,
  };
  if (params.prev) {
    body.prev = params.prev;
  }

  const canonical = canonicalize(body);
  const id = hashString(canonical);

  const encoder = new TextEncoder();
  const sig = sign(encoder.encode(canonical), params.privateKey);

  return {
    body,
    id,
    sig: toBase64(sig),
  };
}

export interface ValidationResult {
  valid: boolean;
  error?: string;
}

/**
 * Validate a signed object: verify hash integrity and Ed25519 signature.
 */
export function validateObject(obj: SignedObject): ValidationResult {
  // Verify hash
  const canonical = canonicalize(obj.body);
  const expectedId = hashString(canonical);
  if (obj.id !== expectedId) {
    return { valid: false, error: `Hash mismatch: expected ${expectedId}, got ${obj.id}` };
  }

  // Verify signature
  const encoder = new TextEncoder();
  const sigBytes = fromBase64(obj.sig);
  const pubKeyBytes = fromBase64(obj.body.author);
  const isValid = verify(sigBytes, encoder.encode(canonical), pubKeyBytes);
  if (!isValid) {
    return { valid: false, error: 'Invalid signature' };
  }

  return { valid: true };
}
