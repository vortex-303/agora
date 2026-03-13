import { describe, it, expect } from 'vitest';
import {
  canonicalize,
  toBase64,
  fromBase64,
  hashString,
  sign,
  verify,
  keypairFromSeed,
  deriveBytes,
} from '../src/crypto.js';
import {
  generateMnemonic,
  validateMnemonic,
  deriveKeypairFromMnemonic,
  generateIdentity,
  restoreIdentity,
} from '../src/identity.js';

describe('canonicalize', () => {
  it('sorts keys deterministically', () => {
    const a = canonicalize({ z: 1, a: 2, m: 3 });
    const b = canonicalize({ a: 2, m: 3, z: 1 });
    expect(a).toBe(b);
    expect(a).toBe('{"a":2,"m":3,"z":1}');
  });

  it('handles nested objects', () => {
    const result = canonicalize({ b: { d: 1, c: 2 }, a: 'hello' });
    expect(result).toBe('{"a":"hello","b":{"c":2,"d":1}}');
  });

  it('handles arrays', () => {
    const result = canonicalize([3, 1, 2]);
    expect(result).toBe('[3,1,2]');
  });

  it('omits undefined values', () => {
    const result = canonicalize({ a: 1, b: undefined, c: 3 });
    expect(result).toBe('{"a":1,"c":3}');
  });
});

describe('base64', () => {
  it('round-trips', () => {
    const bytes = new Uint8Array([1, 2, 3, 255, 0, 128]);
    expect(fromBase64(toBase64(bytes))).toEqual(bytes);
  });
});

describe('hashString', () => {
  it('returns sha256: prefixed hex', () => {
    const h = hashString('hello');
    expect(h).toMatch(/^sha256:[a-f0-9]{64}$/);
  });

  it('is deterministic', () => {
    expect(hashString('test')).toBe(hashString('test'));
  });
});

describe('sign/verify', () => {
  it('round-trips with valid keypair', () => {
    const seed = new Uint8Array(32);
    seed[0] = 42;
    const { privateKey, publicKey } = keypairFromSeed(seed);

    const message = new TextEncoder().encode('hello world');
    const sig = sign(message, privateKey);

    expect(verify(sig, message, publicKey)).toBe(true);
  });

  it('fails with wrong message', () => {
    const seed = new Uint8Array(32);
    const { privateKey, publicKey } = keypairFromSeed(seed);

    const sig = sign(new TextEncoder().encode('hello'), privateKey);
    expect(verify(sig, new TextEncoder().encode('world'), publicKey)).toBe(false);
  });

  it('fails with wrong key', () => {
    const seed1 = new Uint8Array(32);
    seed1[0] = 1;
    const seed2 = new Uint8Array(32);
    seed2[0] = 2;
    const kp1 = keypairFromSeed(seed1);
    const kp2 = keypairFromSeed(seed2);

    const message = new TextEncoder().encode('test');
    const sig = sign(message, kp1.privateKey);
    expect(verify(sig, message, kp2.publicKey)).toBe(false);
  });
});

describe('mnemonic', () => {
  it('generates 12 words', () => {
    const m = generateMnemonic();
    expect(m.split(' ')).toHaveLength(12);
  });

  it('validates correct mnemonic', () => {
    const m = generateMnemonic();
    expect(validateMnemonic(m)).toBe(true);
  });

  it('rejects invalid word', () => {
    expect(validateMnemonic('abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon xyzzy')).toBe(false);
  });

  it('rejects wrong word count', () => {
    expect(validateMnemonic('abandon abandon abandon')).toBe(false);
  });

  it('rejects bad checksum', () => {
    // All valid words but checksum won't match
    expect(validateMnemonic('abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon zoo')).toBe(false);
  });
});

describe('deterministic derivation', () => {
  it('same mnemonic → same keypair', () => {
    const m = generateMnemonic();
    const kp1 = deriveKeypairFromMnemonic(m);
    const kp2 = deriveKeypairFromMnemonic(m);
    expect(toBase64(kp1.publicKey)).toBe(toBase64(kp2.publicKey));
    expect(toBase64(kp1.privateKey)).toBe(toBase64(kp2.privateKey));
  });

  it('different mnemonic → different keypair', () => {
    const m1 = generateMnemonic();
    const m2 = generateMnemonic();
    const kp1 = deriveKeypairFromMnemonic(m1);
    const kp2 = deriveKeypairFromMnemonic(m2);
    expect(toBase64(kp1.publicKey)).not.toBe(toBase64(kp2.publicKey));
  });

  it('generateIdentity round-trips through restoreIdentity', () => {
    const id1 = generateIdentity();
    const id2 = restoreIdentity(id1.mnemonic);
    expect(id1.publicKeyBase64).toBe(id2.publicKeyBase64);
  });
});

describe('deriveBytes (HKDF)', () => {
  it('is deterministic', () => {
    const ikm = new TextEncoder().encode('secret');
    const a = deriveBytes(ikm, 'salt', 'info', 32);
    const b = deriveBytes(ikm, 'salt', 'info', 32);
    expect(toBase64(a)).toBe(toBase64(b));
  });

  it('different salt → different output', () => {
    const ikm = new TextEncoder().encode('secret');
    const a = deriveBytes(ikm, 'salt1', 'info', 32);
    const b = deriveBytes(ikm, 'salt2', 'info', 32);
    expect(toBase64(a)).not.toBe(toBase64(b));
  });
});
