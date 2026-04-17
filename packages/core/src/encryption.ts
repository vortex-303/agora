import { x25519 } from '@noble/curves/ed25519';
import { hkdf } from '@noble/hashes/hkdf';
import { sha256 } from '@noble/hashes/sha256';
import { randomBytes } from '@noble/hashes/utils';

/**
 * Derive X25519 keypair from mnemonic (separate from Ed25519 signing key).
 * Uses HKDF with a different salt to get a distinct key.
 */
export function deriveX25519FromMnemonic(mnemonic: string): { privateKey: Uint8Array; publicKey: Uint8Array } {
  const encoder = new TextEncoder();
  const seed = hkdf(sha256, encoder.encode(mnemonic), encoder.encode('agora-x25519-v1'), encoder.encode('encryption-key-seed'), 32);
  const publicKey = x25519.getPublicKey(seed);
  return { privateKey: seed, publicKey };
}

// Helper: copy Uint8Array into a fresh ArrayBuffer to satisfy strict TS BufferSource checks
function toBuffer(data: Uint8Array): ArrayBuffer {
  const buf = new ArrayBuffer(data.byteLength);
  new Uint8Array(buf).set(data);
  return buf;
}

/**
 * Encrypt a message for a recipient using X25519 ECDH + AES-256-GCM.
 * Creates a fresh ephemeral keypair per message for forward secrecy.
 */
export async function encryptDM(
  plaintext: string,
  recipientX25519PublicKey: Uint8Array
): Promise<{ ciphertext: Uint8Array; ephemeralPublicKey: Uint8Array; nonce: Uint8Array }> {
  const ephemeralPrivate = randomBytes(32);
  const ephemeralPublicKey = x25519.getPublicKey(ephemeralPrivate);

  const sharedSecret = x25519.getSharedSecret(ephemeralPrivate, recipientX25519PublicKey);
  const aesKeyBytes = hkdf(sha256, sharedSecret, ephemeralPublicKey, new TextEncoder().encode('agora-dm-v1'), 32);

  const aesKey = await crypto.subtle.importKey('raw', toBuffer(aesKeyBytes), { name: 'AES-GCM' }, false, ['encrypt']);

  const nonce = randomBytes(12);
  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: toBuffer(nonce) },
    aesKey,
    new TextEncoder().encode(plaintext)
  );

  return {
    ciphertext: new Uint8Array(encrypted),
    ephemeralPublicKey,
    nonce,
  };
}

/**
 * Decrypt a DM using our X25519 private key.
 */
export async function decryptDM(
  ciphertext: Uint8Array,
  ephemeralPublicKey: Uint8Array,
  nonce: Uint8Array,
  myX25519PrivateKey: Uint8Array
): Promise<string> {
  const sharedSecret = x25519.getSharedSecret(myX25519PrivateKey, ephemeralPublicKey);
  const aesKeyBytes = hkdf(sha256, sharedSecret, ephemeralPublicKey, new TextEncoder().encode('agora-dm-v1'), 32);

  const aesKey = await crypto.subtle.importKey('raw', toBuffer(aesKeyBytes), { name: 'AES-GCM' }, false, ['decrypt']);

  const decrypted = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: toBuffer(nonce) },
    aesKey,
    toBuffer(ciphertext)
  );

  return new TextDecoder().decode(decrypted);
}

/**
 * Self-encrypt data using own X25519 keypair.
 * Per-object random salt ensures unique AES key per encryption (forward secrecy).
 */
export async function selfEncrypt(
  plaintext: string,
  x25519Private: Uint8Array,
  x25519Public: Uint8Array
): Promise<{ ciphertext: Uint8Array; nonce: Uint8Array; salt: Uint8Array }> {
  const sharedSecret = x25519.getSharedSecret(x25519Private, x25519Public);
  const salt = randomBytes(16);
  const info = new Uint8Array([...new TextEncoder().encode('riot-self-v1'), ...salt]);
  const aesKeyBytes = hkdf(sha256, sharedSecret, x25519Public, info, 32);
  const aesKey = await crypto.subtle.importKey('raw', toBuffer(aesKeyBytes), { name: 'AES-GCM' }, false, ['encrypt']);

  const nonce = randomBytes(12);
  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: toBuffer(nonce) },
    aesKey,
    new TextEncoder().encode(plaintext)
  );

  return { ciphertext: new Uint8Array(encrypted), nonce, salt };
}

/**
 * Self-decrypt data using own X25519 keypair.
 */
export async function selfDecrypt(
  ciphertext: Uint8Array,
  nonce: Uint8Array,
  x25519Private: Uint8Array,
  x25519Public: Uint8Array,
  salt?: Uint8Array
): Promise<string> {
  const sharedSecret = x25519.getSharedSecret(x25519Private, x25519Public);
  const info = salt
    ? new Uint8Array([...new TextEncoder().encode('riot-self-v1'), ...salt])
    : new TextEncoder().encode('riot-self-v1');
  const aesKeyBytes = hkdf(sha256, sharedSecret, x25519Public, info, 32);
  const aesKey = await crypto.subtle.importKey('raw', toBuffer(aesKeyBytes), { name: 'AES-GCM' }, false, ['decrypt']);

  const decrypted = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: toBuffer(nonce) },
    aesKey,
    toBuffer(ciphertext)
  );

  return new TextDecoder().decode(decrypted);
}
