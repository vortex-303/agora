export type ObjectType =
  | 'post'
  | 'follow'
  | 'reaction'
  | 'profile'
  | 'delete'
  | 'dm'
  | 'community'
  | 'modaction';

// Content types

export interface PostContent {
  text: string;
  topic?: string;
  reply?: string; // id of object being replied to
  image?: string; // data URL (base64) or external URL
}

export interface FollowContent {
  target: string; // public key of followed user
  unfollow?: boolean;
}

export interface ReactionContent {
  target: string; // id of object being reacted to
  emoji: string;
}

export interface ProfileContent {
  name?: string;
  bio?: string;
  avatar?: string; // URL or CAS hash
  x25519PublicKey?: string; // for encrypted DMs
}

export interface DeleteContent {
  target: string; // id of object to delete
}

export interface DMContent {
  recipient: string; // public key
  ciphertext: string; // base64 AES-GCM encrypted
  ephemeralPublicKey: string; // base64 X25519 ephemeral key
  nonce: string; // base64 AES-GCM nonce
}

export interface CommunityContent {
  name: string;
  description?: string;
  moderators?: string[]; // public keys
}

export interface ModActionContent {
  community: string; // community object id
  target: string; // object id or public key
  action: 'hide' | 'ban' | 'pin' | 'unban' | 'unhide' | 'unpin';
  reason?: string;
}

export type ObjectContent =
  | PostContent
  | FollowContent
  | ReactionContent
  | ProfileContent
  | DeleteContent
  | DMContent
  | CommunityContent
  | ModActionContent;

// Core object model

export interface ObjectBody {
  author: string; // base64 Ed25519 public key
  content: ObjectContent;
  prev?: string; // hash of author's previous object
  seq: number; // sequence number in author's feed
  timestamp: number; // unix ms
  type: ObjectType;
}

export interface SignedObject {
  body: ObjectBody;
  id: string; // "sha256:<hex>" of canonical JSON of body
  sig: string; // base64 Ed25519 signature of canonical body
}

// Wire protocol types

export interface SubscriptionFilter {
  authors?: string[];
  topics?: string[];
  types?: ObjectType[];
  since?: number; // unix ms
  limit?: number;
}

export interface SubscribeMessage {
  action: 'subscribe';
  id: string;
  filters: SubscriptionFilter[];
}

export interface PublishMessage {
  action: 'publish';
  object: SignedObject;
}

export interface EventMessage {
  action: 'event';
  subscriptionId: string;
  object: SignedObject;
}

export interface EoseMessage {
  action: 'eose';
  subscriptionId: string;
}

export interface ErrorMessage {
  action: 'error';
  message: string;
}

// Auth messages
export interface HelloMessage {
  action: 'hello';
  publicKey: string;
}

export interface ChallengeMessage {
  action: 'challenge';
  nonce: string; // base64
}

export interface AuthMessage {
  action: 'auth';
  signature: string; // base64
  nonce: string; // base64
}

export interface AuthResultMessage {
  action: 'auth_ok' | 'auth_fail';
  reason?: string;
}

export type WireMessage =
  | SubscribeMessage
  | PublishMessage
  | EventMessage
  | EoseMessage
  | ErrorMessage
  | HelloMessage
  | ChallengeMessage
  | AuthMessage
  | AuthResultMessage;
