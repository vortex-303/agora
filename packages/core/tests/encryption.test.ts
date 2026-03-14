import { describe, it, expect } from 'vitest';
import { deriveX25519FromMnemonic, encryptDM, decryptDM } from '../src/encryption.js';
import { generateMnemonic } from '../src/identity.js';
import { toBase64 } from '../src/crypto.js';

describe('X25519 derivation', () => {
  it('is deterministic from mnemonic', () => {
    const m = generateMnemonic();
    const a = deriveX25519FromMnemonic(m);
    const b = deriveX25519FromMnemonic(m);
    expect(toBase64(a.publicKey)).toBe(toBase64(b.publicKey));
    expect(toBase64(a.privateKey)).toBe(toBase64(b.privateKey));
  });

  it('different mnemonic → different key', () => {
    const a = deriveX25519FromMnemonic(generateMnemonic());
    const b = deriveX25519FromMnemonic(generateMnemonic());
    expect(toBase64(a.publicKey)).not.toBe(toBase64(b.publicKey));
  });
});

describe('encrypt/decrypt DM', () => {
  it('round-trips a message', async () => {
    const recipient = deriveX25519FromMnemonic(generateMnemonic());
    const plaintext = 'Hello, this is a secret message!';

    const { ciphertext, ephemeralPublicKey, nonce } = await encryptDM(plaintext, recipient.publicKey);
    const decrypted = await decryptDM(ciphertext, ephemeralPublicKey, nonce, recipient.privateKey);

    expect(decrypted).toBe(plaintext);
  });

  it('fails with wrong private key', async () => {
    const recipient = deriveX25519FromMnemonic(generateMnemonic());
    const wrongKey = deriveX25519FromMnemonic(generateMnemonic());

    const { ciphertext, ephemeralPublicKey, nonce } = await encryptDM('secret', recipient.publicKey);

    await expect(decryptDM(ciphertext, ephemeralPublicKey, nonce, wrongKey.privateKey))
      .rejects.toThrow();
  });

  it('each encryption uses different ephemeral key (forward secrecy)', async () => {
    const recipient = deriveX25519FromMnemonic(generateMnemonic());

    const a = await encryptDM('msg1', recipient.publicKey);
    const b = await encryptDM('msg2', recipient.publicKey);

    expect(toBase64(a.ephemeralPublicKey)).not.toBe(toBase64(b.ephemeralPublicKey));
    expect(toBase64(a.ciphertext)).not.toBe(toBase64(b.ciphertext));
  });

  it('handles unicode text', async () => {
    const recipient = deriveX25519FromMnemonic(generateMnemonic());
    const text = 'Hello 🌍 你好世界 مرحبا';

    const { ciphertext, ephemeralPublicKey, nonce } = await encryptDM(text, recipient.publicKey);
    const decrypted = await decryptDM(ciphertext, ephemeralPublicKey, nonce, recipient.privateKey);

    expect(decrypted).toBe(text);
  });
});
