import { BIP39_WORDLIST } from './bip39-wordlist.js';
import { hashBytes, keypairFromSeed, deriveBytes, toBase64, fromBase64 } from './crypto.js';
import { sha256 } from '@noble/hashes/sha256';

export interface Identity {
  publicKey: Uint8Array;
  privateKey: Uint8Array; // 32-byte seed
  publicKeyBase64: string;
  mnemonic: string;
}

/**
 * Generate a BIP-39 mnemonic (12 words from 128 bits of entropy).
 */
export function generateMnemonic(entropy?: Uint8Array): string {
  if (!entropy) {
    entropy = new Uint8Array(16);
    crypto.getRandomValues(entropy);
  }

  // SHA-256 checksum
  const hash = sha256(entropy);
  const checksumByte = hash[0];

  // 128 bits entropy + 4 bits checksum = 132 bits = 12 × 11-bit indices
  const bits: number[] = [];
  for (const byte of entropy) {
    for (let i = 7; i >= 0; i--) {
      bits.push((byte >> i) & 1);
    }
  }
  for (let i = 7; i >= 4; i--) {
    bits.push((checksumByte >> i) & 1);
  }

  const words: string[] = [];
  for (let i = 0; i < 12; i++) {
    let index = 0;
    for (let j = 0; j < 11; j++) {
      if (bits[i * 11 + j]) index |= 1 << (10 - j);
    }
    words.push(BIP39_WORDLIST[index]);
  }

  return words.join(' ');
}

/**
 * Validate a BIP-39 mnemonic (word count, wordlist, checksum).
 */
export function validateMnemonic(phrase: string): boolean {
  const words = phrase.toLowerCase().trim().split(/\s+/);
  if (words.length !== 12) return false;

  const indices: number[] = [];
  for (const word of words) {
    const idx = BIP39_WORDLIST.indexOf(word);
    if (idx === -1) return false;
    indices.push(idx);
  }

  // Convert to bits
  const bits: number[] = [];
  for (const idx of indices) {
    for (let j = 10; j >= 0; j--) {
      bits.push((idx >> j) & 1);
    }
  }

  // Extract entropy (128 bits)
  const entropy = new Uint8Array(16);
  for (let i = 0; i < 16; i++) {
    let byte = 0;
    for (let j = 0; j < 8; j++) {
      if (bits[i * 8 + j]) byte |= 1 << (7 - j);
    }
    entropy[i] = byte;
  }

  // Verify checksum
  const hash = sha256(entropy);
  const checksumByte = hash[0];
  for (let i = 0; i < 4; i++) {
    const expected = (checksumByte >> (7 - i)) & 1;
    if (expected !== bits[128 + i]) return false;
  }

  return true;
}

/**
 * Derive Ed25519 keypair from mnemonic via HKDF.
 * Same mnemonic always produces the same keypair.
 */
export function deriveKeypairFromMnemonic(mnemonic: string): { privateKey: Uint8Array; publicKey: Uint8Array } {
  const encoder = new TextEncoder();
  const seed = deriveBytes(
    encoder.encode(mnemonic),
    'agora-ed25519-v1',
    'signing-key-seed',
    32
  );
  return keypairFromSeed(seed);
}

/**
 * Generate a new identity with a fresh mnemonic.
 */
export function generateIdentity(): Identity {
  const mnemonic = generateMnemonic();
  const { privateKey, publicKey } = deriveKeypairFromMnemonic(mnemonic);
  return {
    publicKey,
    privateKey,
    publicKeyBase64: toBase64(publicKey),
    mnemonic,
  };
}

/**
 * Restore identity from a 12-word recovery phrase.
 */
export function restoreIdentity(mnemonic: string): Identity {
  const normalized = mnemonic.toLowerCase().trim();
  if (!validateMnemonic(normalized)) {
    throw new Error('Invalid recovery phrase');
  }
  const { privateKey, publicKey } = deriveKeypairFromMnemonic(normalized);
  return {
    publicKey,
    privateKey,
    publicKeyBase64: toBase64(publicKey),
    mnemonic: normalized,
  };
}
