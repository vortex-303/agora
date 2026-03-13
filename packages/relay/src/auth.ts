import { randomBytes } from 'node:crypto';
import { verify, fromBase64, toBase64 } from '@agora/core';

export interface PendingAuth {
  nonce: Uint8Array;
  createdAt: number;
}

const AUTH_TIMEOUT_MS = 30_000;

export function createChallenge(): { nonce: Uint8Array; nonceBase64: string } {
  const nonce = randomBytes(32);
  return { nonce: new Uint8Array(nonce), nonceBase64: toBase64(new Uint8Array(nonce)) };
}

export function verifyAuth(
  signatureBase64: string,
  nonceBase64: string,
  publicKeyBase64: string,
  pending: PendingAuth
): boolean {
  // Check timeout
  if (Date.now() - pending.createdAt > AUTH_TIMEOUT_MS) {
    return false;
  }

  // Verify the nonce matches
  const providedNonce = fromBase64(nonceBase64);
  if (providedNonce.length !== pending.nonce.length) return false;
  for (let i = 0; i < providedNonce.length; i++) {
    if (providedNonce[i] !== pending.nonce[i]) return false;
  }

  // Verify signature
  const sig = fromBase64(signatureBase64);
  const pubKey = fromBase64(publicKeyBase64);
  return verify(sig, pending.nonce, pubKey);
}
