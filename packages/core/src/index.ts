// Types
export type {
  ObjectType,
  ObjectBody,
  ObjectContent,
  SignedObject,
  PostContent,
  FollowContent,
  ReactionContent,
  ProfileContent,
  DeleteContent,
  DMContent,
  CommunityContent,
  ModActionContent,
  StateCategory,
  EncryptedStateContent,
  SubscriptionFilter,
  SubscribeMessage,
  PublishMessage,
  EventMessage,
  EoseMessage,
  ErrorMessage,
  HelloMessage,
  ChallengeMessage,
  AuthMessage,
  AuthResultMessage,
  WireMessage,
} from './types.js';

// Crypto
export {
  canonicalize,
  toBase64,
  fromBase64,
  bytesToHex,
  hexToBytes,
  hashBytes,
  hashString,
  sign,
  verify,
  keypairFromSeed,
  deriveBytes,
} from './crypto.js';

// Identity
export type { Identity } from './identity.js';
export {
  generateMnemonic,
  validateMnemonic,
  deriveKeypairFromMnemonic,
  generateIdentity,
  restoreIdentity,
} from './identity.js';

// Objects
export type { CreateObjectParams, ValidationResult } from './objects.js';
export { createObject, validateObject } from './objects.js';

// Storage
export type { StorageAdapter } from './storage.js';

// Encryption (Phase 4: DMs)
export { deriveX25519FromMnemonic, encryptDM, decryptDM, selfEncrypt, selfDecrypt } from './encryption.js';

// BIP-39
export { BIP39_WORDLIST } from './bip39-wordlist.js';
