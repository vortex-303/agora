import { ed25519 } from '@noble/curves/ed25519';
import { sha256 } from '@noble/hashes/sha256';
import { hkdf } from '@noble/hashes/hkdf';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils';

// Canonical JSON: sorted keys, no whitespace
export function canonicalize(obj: unknown): string {
  if (obj === null || obj === undefined) return 'null';
  if (typeof obj === 'boolean' || typeof obj === 'number') return JSON.stringify(obj);
  if (typeof obj === 'string') return JSON.stringify(obj);
  if (Array.isArray(obj)) {
    return '[' + obj.map((v) => canonicalize(v)).join(',') + ']';
  }
  const keys = Object.keys(obj as Record<string, unknown>).sort();
  const pairs = keys
    .filter((k) => (obj as Record<string, unknown>)[k] !== undefined)
    .map((k) => JSON.stringify(k) + ':' + canonicalize((obj as Record<string, unknown>)[k]));
  return '{' + pairs.join(',') + '}';
}

// Base64 encode/decode
export function toBase64(bytes: Uint8Array): string {
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(bytes).toString('base64');
  }
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

export function fromBase64(b64: string): Uint8Array {
  if (typeof Buffer !== 'undefined') {
    return new Uint8Array(Buffer.from(b64, 'base64'));
  }
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

// Hex encode
export { bytesToHex, hexToBytes };

// SHA-256 hash of bytes
export function hashBytes(data: Uint8Array): Uint8Array {
  return sha256(data);
}

// SHA-256 hash of string, returns "sha256:<hex>"
export function hashString(data: string): string {
  const encoder = new TextEncoder();
  const hash = sha256(encoder.encode(data));
  return 'sha256:' + bytesToHex(hash);
}

// Ed25519 sign (using @noble/curves — works in both browser and Node.js)
export function sign(message: Uint8Array, privateKey: Uint8Array): Uint8Array {
  return ed25519.sign(message, privateKey);
}

// Ed25519 verify
export function verify(signature: Uint8Array, message: Uint8Array, publicKey: Uint8Array): boolean {
  try {
    return ed25519.verify(signature, message, publicKey);
  } catch {
    return false;
  }
}

// Derive Ed25519 keypair from seed bytes
export function keypairFromSeed(seed: Uint8Array): { privateKey: Uint8Array; publicKey: Uint8Array } {
  const publicKey = ed25519.getPublicKey(seed);
  return { privateKey: seed, publicKey };
}

// HKDF derive
export function deriveBytes(
  ikm: Uint8Array,
  salt: string,
  info: string,
  length: number = 32
): Uint8Array {
  const encoder = new TextEncoder();
  return hkdf(sha256, ikm, encoder.encode(salt), encoder.encode(info), length);
}
