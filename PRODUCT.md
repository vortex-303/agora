# Agora — Product Definition, Architecture & Stack

> A decentralized peer-to-peer social platform. No accounts, no servers owning your data, no surveillance. Identity is cryptography. Communication is peer-to-peer. Encryption is default.

**Production URLs:**
- Landing: https://agorap2p.com
- App: https://app.agorap2p.com
- Relay US: wss://agora-relay.fly.dev (San Jose)
- Relay EU: wss://agora-relay-eu.fly.dev (Amsterdam)
- Source: https://github.com/vortex-303/agora

---

## Product Definition

### What Agora Is

Agora is a web-first decentralized social platform where:

- **Your identity is a cryptographic keypair** — no email, no password, no phone number, no registration server. A 12-word mnemonic phrase generates your Ed25519 keypair deterministically. Same words = same identity on any device.

- **Every piece of data is self-authenticating** — posts, replies, profiles, DMs are content-addressed (SHA-256) and signed (Ed25519). Anyone can verify any object without trusting the server that delivered it.

- **Relays are dumb pipes** — they store and forward signed objects. They cannot forge, modify, or selectively censor content they can't even decrypt. Users connect to multiple relays simultaneously. If one goes down, others keep working.

- **Browsers talk directly** — WebRTC data channels between browsers enable peer-to-peer gossip. Posts propagate through the mesh even when all relays are offline.

- **DMs are end-to-end encrypted** — every message uses a fresh ephemeral X25519 keypair for forward secrecy. Relays see only ciphertext.

### What Agora Is Not

- Not a blockchain (no consensus, no tokens, no fees)
- Not federated (no server-to-server protocol negotiation — objects are self-authenticating)
- Not a Nostr clone (different object model, built-in P2P, built-in encryption)
- Not a mobile app (PWA — installable from browser, runs on any device)

---

## Current Features

### Identity & Cryptography
- BIP-39 mnemonic generation (12 words, 128 bits entropy + checksum)
- Deterministic Ed25519 keypair derivation via HKDF
- Separate X25519 keypair for DM encryption (same mnemonic, different HKDF salt)
- Identity persisted in IndexedDB, portable via recovery phrase
- Profile publishing (username, bio, X25519 public key)

### Social Features
- **Topic-based feeds** — 9 pre-defined topics: General, Tech, Crypto, P2P, WW3, Memes, Art, Science, Random
- **Posts with images** — text posts with optional inline base64 images (paste or file select, 500KB limit)
- **Single-level replies** — click a post to see/write replies (no threading)
- **Link detection** — URLs in posts auto-rendered as clickable links with cleaned display
- **User profiles** — `/u/[pubkey]` pages showing user's posts, location, online status
- **Search** — full-text search over cached posts, topics, and people
- **Username** — set display name in settings, shown everywhere instead of public key

### Messaging
- **E2E encrypted DMs** — X25519 ECDH + HKDF + AES-256-GCM, per-message forward secrecy
- **WhatsApp-style layout** — conversation sidebar + chat panel (responsive: stacks on mobile)
- **Key exchange via relay** — X25519 public keys included in hello message + profile objects
- **Outgoing plaintext storage** — sender's own messages stored locally (can't decrypt own outgoing DMs)

### Networking
- **Multi-relay** — clients connect to all configured relays simultaneously, dedup objects across them
- **Relay-to-relay sync** — relays connect to peer relays and exchange objects (gossip protocol between servers)
- **WebRTC P2P** — data channels between browsers, relay used for signaling (offer/answer/ICE)
- **P2P gossip** — new objects forwarded to all WebRTC peers, validated before accepting
- **GeoIP** — relay resolves client IP to city/country, included in peer list
- **Peer discovery** — relay broadcasts online peer list with geo + X25519 keys

### Offline & Persistence
- **IndexedDB cache** — all objects cached locally with indexes on author+seq and timestamp
- **Outbox queue** — posts created offline queued in IndexedDB, auto-published on reconnect
- **Sync cursors** — each subscription tracks latest timestamp, reconnect fetches only new objects
- **PWA** — installable as home screen app on iOS/Android, service worker caches static assets

### Infrastructure
- **Rate limiting** — 30 publishes/min, 20 subscribes/min, 50 connections/IP
- **Object expiry** — 7-day TTL, 10K max objects, 1K per author on relay
- **JSONL persistence** — relay stores objects in daily JSONL files on persistent volume
- **Invite links** — `/join/[address]` URLs that auto-open DM after identity creation

### UX
- **Onboarding flow** — 3 steps: create identity → save recovery phrase → pick username
- **Mobile dropdown nav** — current page selector with full labels (not cramped icon bar)
- **Desktop animated nav** — icons with glow effects, active state underline animation
- **User menu** — dropdown with public address copy + settings link
- **Orange matrix theme** — animated canvas grid with mouse-tracking nodes, ambient glow orbs
- **DM notification badge** — unread count on Messages nav item

---

## Architecture

### System Diagram

```
┌─────────────────┐     ┌─────────────────┐
│  Browser (SPA)  │────▶│  Relay US (sjc)  │◀───sync───▶│  Relay EU (ams)  │
│  SvelteKit PWA  │     │  Node.js + ws    │            │  Node.js + ws    │
│                 │────▶│                  │            │                  │
└────────┬────────┘     └─────────────────┘            └──────────────────┘
         │
         │ WebRTC
         │ data channel
         ▼
┌─────────────────┐
│  Browser (SPA)  │
│  SvelteKit PWA  │
└─────────────────┘
```

### Data Flow

1. **Publish:** Client creates SignedObject → sends to all connected relays → relays validate signature → store → broadcast to subscribers → forward to peer relays
2. **Subscribe:** Client sends filter (authors, topics, types, since) → relay sends matching stored objects → sends `eose` → streams live matches
3. **P2P:** Client receives object from relay or peer → validates sig+hash → caches to IndexedDB → forwards to WebRTC peers (gossip)
4. **DM:** Sender encrypts with recipient's X25519 key → publishes as `dm` object → relay stores ciphertext → recipient decrypts with private key

### Authentication Flow

```
Client                          Relay
  │                               │
  │──── hello (publicKey, x25519) ──▶│
  │                               │
  │◀── challenge (32-byte nonce) ──│
  │                               │
  │──── auth (Ed25519 sig of nonce) ──▶│
  │                               │
  │◀──────── auth_ok ─────────────│
```

---

## Tech Stack

### Monorepo Structure

```
agora/                          6,527 lines · 48 source files
├── packages/
│   ├── core/                   @agora/core — 10 files, 1,414 lines
│   │   ├── src/
│   │   │   ├── types.ts        Object model, wire protocol types
│   │   │   ├── crypto.ts       Ed25519, SHA-256, HKDF, canonical JSON
│   │   │   ├── identity.ts     BIP-39 mnemonic, keypair derivation
│   │   │   ├── encryption.ts   X25519 ECDH + AES-256-GCM for DMs
│   │   │   ├── objects.ts      createObject(), validateObject()
│   │   │   ├── storage.ts      StorageAdapter interface
│   │   │   ├── storage/        IndexedDB + filesystem implementations
│   │   │   ├── bip39-wordlist.ts  2048-word English wordlist
│   │   │   └── index.ts        Barrel exports
│   │   └── tests/              3 test files, 34 tests
│   │
│   ├── relay/                  @agora/relay — 8 files, 807 lines
│   │   └── src/
│   │       ├── server.ts       WebSocket server, auth, routing, GeoIP, sync
│   │       ├── store.ts        In-memory index + JSONL persistence
│   │       ├── subscription.ts Filter matching, broadcast
│   │       ├── auth.ts         Challenge-response authentication
│   │       ├── sync.ts         Relay-to-relay object sync
│   │       ├── ratelimit.ts    Per-identity + per-IP rate limiting
│   │       ├── config.ts       Environment configuration
│   │       └── index.ts        HTTP server + /health endpoint
│   │
│   └── web/                    @agora/web — 30 files, 4,306 lines
│       ├── src/lib/
│       │   ├── relay.ts        RelayClient — single WebSocket connection
│       │   ├── relay-pool.ts   RelayPool — multi-relay with dedup
│       │   ├── relay-interface.ts  Shared interface type
│       │   ├── feed.ts         FeedManager — orchestrates relay+P2P+cache
│       │   ├── cache.ts        IndexedDB object cache with sync cursors
│       │   ├── outbox.ts       Offline publish queue
│       │   ├── dm.ts           DMManager — E2E encrypted conversations
│       │   ├── profiles.ts     ProfileManager — users, geo, online status
│       │   ├── webrtc.ts       PeerManager — WebRTC data channels
│       │   ├── gossip.ts       GossipManager — P2P object forwarding
│       │   ├── identity.ts     IndexedDB identity persistence
│       │   ├── topics.ts       9 pre-defined topic definitions
│       │   ├── stores.svelte.ts  Svelte 5 rune stores
│       │   ├── GridCanvas.svelte  Animated grid background
│       │   ├── LinkText.svelte URL detection + rendering
│       │   └── theme.css       Design tokens + component styles
│       └── src/routes/         11 pages
│           ├── +layout.svelte  Root: nav, identity init, manager chain
│           ├── +page.svelte    Feed: topic tabs, compose, post list
│           ├── post/[id]/      Post detail + replies
│           ├── dm/             WhatsApp-style DM layout
│           ├── network/        Online peers with GeoIP
│           ├── search/         Full-text search
│           ├── settings/       Profile, relay management, identity
│           ├── setup/          3-step onboarding
│           ├── u/[pubkey]/     User profile page
│           ├── join/[address]/ Invite link handler
│           └── topic/[name]/   Topic feed (legacy)
│
├── landing/                    Landing page (standalone HTML)
│   ├── index.html              Single-file landing with animations
│   ├── favicon.svg             Orange message-circle-dashed icon
│   └── vercel.json             Vercel SPA config
│
├── fly.toml                    US relay deployment (Fly.io, sjc)
├── fly-eu.toml                 EU relay deployment (Fly.io, ams)
├── Dockerfile                  Multi-stage relay container
├── turbo.json                  Monorepo task orchestration
├── pnpm-workspace.yaml         Workspace package config
└── tsconfig.base.json          Shared TypeScript config
```

### Dependencies

| Package | Runtime Dependencies | Dev Dependencies |
|---------|---------------------|-----------------|
| **@agora/core** | @noble/curves, @noble/hashes | typescript, vitest, @types/node |
| **@agora/relay** | @agora/core, ws, geoip-lite | typescript, ts-node, @types/node, @types/ws |
| **@agora/web** | @agora/core | svelte, @sveltejs/kit, @sveltejs/adapter-static, vite, typescript |

### Key Technical Decisions

| Decision | Choice | Why |
|----------|--------|-----|
| Crypto library | @noble/curves (not Web Crypto API) | Synchronous Ed25519, works identically in browser and Node.js, no async overhead |
| Identity model | BIP-39 mnemonic → HKDF → Ed25519 | Deterministic, portable, human-readable backup, proven standard |
| DM encryption | Per-message ephemeral X25519 → ECDH → AES-256-GCM | Forward secrecy per message, no session state to manage |
| Object format | Content-addressed (SHA-256 hash as ID) | Self-authenticating, dedup across relays is trivial, no coordination needed |
| Hash chain | `prev` + `seq` per author | Efficient sync ("give me everything after seq N"), detects missing objects |
| Web framework | SvelteKit 5 with adapter-static | SPA with client-side routing, smallest bundle, Svelte 5 runes for reactivity |
| Relay protocol | JSON over WebSocket | Simple, debuggable, no binary protocol overhead at this scale |
| Storage (relay) | In-memory Map + daily JSONL files | Fast reads, append-only writes, easy to inspect/backup/replay |
| Storage (client) | IndexedDB | Only persistent storage available in browsers, survives tab close |
| Multi-relay | RelayPool wrapping N RelayClient instances | Same interface, transparent dedup, publish to all, subscribe to all |
| P2P | WebRTC data channels | Only way to get browser-to-browser without plugins |
| Relay sync | WebSocket peer connections with object exchange | Relays are also clients to each other, reuse existing protocol |

---

## Object Model

### Core Object

```typescript
interface SignedObject {
  body: ObjectBody;
  id: string;           // "sha256:<hex>" — content-addressed hash of canonical JSON body
  sig: string;          // base64 Ed25519 signature of canonical JSON body
}

interface ObjectBody {
  author: string;       // base64 Ed25519 public key
  content: ObjectContent; // type-specific payload
  type: ObjectType;     // "post" | "profile" | "dm" | "follow" | "reaction" | "delete" | "community" | "modaction"
  seq: number;          // sequence number in author's feed (monotonic)
  timestamp: number;    // unix milliseconds
  prev?: string;        // hash of author's previous object (hash chain)
}
```

### Content Types

| Type | Fields | Status |
|------|--------|--------|
| **post** | `text`, `topic?`, `reply?`, `image?` | Implemented |
| **profile** | `name?`, `bio?`, `avatar?`, `x25519PublicKey?` | Implemented |
| **dm** | `recipient`, `ciphertext`, `ephemeralPublicKey`, `nonce` | Implemented |
| **follow** | `target`, `unfollow?` | Type defined |
| **reaction** | `target`, `emoji` | Type defined |
| **delete** | `target` | Type defined |
| **community** | `name`, `description?`, `moderators?[]` | Type defined |
| **modaction** | `community`, `target`, `action`, `reason?` | Type defined |

### Wire Protocol

| Message | Direction | Purpose |
|---------|-----------|---------|
| `hello` | C→S | Start auth (publicKey + x25519PublicKey) |
| `challenge` | S→C | 32-byte random nonce |
| `auth` | C→S | Ed25519 signature of nonce |
| `auth_ok` / `auth_fail` | S→C | Auth result |
| `publish` | C→S | Submit signed object |
| `subscribe` | C→S | Register filter (authors, topics, types, since, limit) |
| `event` | S→C | Object matching subscription |
| `eose` | S→C | End of stored events (live streaming begins) |
| `signal` | C→S→C | WebRTC signaling (offer/answer/ice) |
| `peers` | C→S→C | Online peer list with geo + x25519 keys |
| `relay_sync` | S→S | Relay-to-relay sync subscription |
| `relay_sync_object` | S→S | Object exchange between relays |
| `error` | S→C | Error message |

---

## Deployment

### Infrastructure

| Component | Platform | Region | URL | Config |
|-----------|----------|--------|-----|--------|
| Landing page | Vercel | Edge | agorap2p.com | `landing/vercel.json` |
| Web app | Vercel | Edge | app.agorap2p.com | Static SPA build |
| Relay US | Fly.io | sjc (San Jose) | agora-relay.fly.dev | `fly.toml` |
| Relay EU | Fly.io | ams (Amsterdam) | agora-relay-eu.fly.dev | `fly-eu.toml` |

### Relay Configuration

| Setting | Value | Env Var |
|---------|-------|---------|
| Port | 9800 | `PORT` |
| Data directory | /data | `DATA_DIR` |
| Max objects | 10,000 | `MAX_OBJECTS` |
| Max per author | 1,000 | `MAX_OBJECTS_PER_AUTHOR` |
| Object TTL | 7 days | `OBJECT_TTL` |
| Peer relays | comma-separated URLs | `PEER_RELAYS` |
| Rate limit (publish) | 30/min | `RATE_LIMIT_PUBLISH` |
| Rate limit (subscribe) | 20/min | `RATE_LIMIT_SUBSCRIBE` |
| Rate limit (connections) | 50/IP | `RATE_LIMIT_CONNECTIONS` |

### Relay VM

- 1 shared CPU, 256MB RAM
- 1GB persistent volume at `/data`
- Auto-stop when idle, auto-start on request
- Multi-stage Docker build (Node.js 22-slim)

---

## Testing

34 tests across 3 files in `@agora/core`:

| File | Tests | Coverage |
|------|-------|----------|
| `crypto.test.ts` | 20 | Canonical JSON, base64, SHA-256, Ed25519 sign/verify, BIP-39 mnemonic, deterministic derivation, HKDF |
| `objects.test.ts` | 8 | Object creation, hash integrity, signature validation, tamper detection, JSON round-trip, wrong-key rejection |
| `encryption.test.ts` | 6 | X25519 derivation, encrypt/decrypt round-trip, wrong key fails, forward secrecy verification, unicode |

```bash
pnpm --filter @agora/core test   # 34 tests, <300ms
```

---

## Design System

### Colors
| Token | Value | Usage |
|-------|-------|-------|
| `--accent` | `#f97316` | Orange primary accent |
| `--accent-hover` | `#fb923c` | Hover state |
| `--bg-root` | `#07070a` | Page background |
| `--bg-surface` | `#0e0e12` | Card backgrounds |
| `--bg-raised` | `#141418` | Elevated surfaces |
| `--bg-input` | `#111116` | Input fields |
| `--text-primary` | `#f0f0f0` | Main text |
| `--text-secondary` | `#a0a0a8` | Secondary text |
| `--text-tertiary` | `#606068` | Muted text |

### Typography
- UI: Inter (400–800)
- Code/addresses: JetBrains Mono (400–500)

### Visual Effects
- Animated canvas grid with pulsing nodes that respond to mouse movement
- Ambient glow orbs (blurred, fixed position)
- CSS grid background lines (orange at 3% opacity)
- Scroll reveal animations (translateY + opacity, cubic-bezier easing)
- Nav glow underline on active tab
- Card hover border glow

### App Icon
- Lucide `message-circle-dashed` — orange `#f97316` on dark `#07070a`
- Sizes: 32px (favicon), 180px (apple-touch-icon), 192px, 512px, 512px maskable

---

## What's Built vs Planned

### Implemented
- [x] Cryptographic identity (BIP-39 + Ed25519)
- [x] Signed, content-addressed objects
- [x] Multi-relay connections with dedup
- [x] Relay-to-relay sync (US ↔ EU)
- [x] WebRTC P2P with gossip protocol
- [x] E2E encrypted DMs (X25519 + AES-256-GCM)
- [x] Topic-based feeds (9 topics)
- [x] Posts with images + link detection
- [x] Single-level replies
- [x] User profiles with GeoIP location
- [x] Search (posts, topics, people)
- [x] Offline support (cache + outbox)
- [x] Rate limiting + spam prevention
- [x] PWA (installable, service worker)
- [x] Mobile-responsive layout
- [x] Invite links (`/join/[address]`)
- [x] Onboarding flow (3-step)
- [x] Settings (profile, relay management)
- [x] Landing page (agorap2p.com)
- [x] Custom domain deployment

### Not Yet Built
- [ ] Follows + personalized "Following" feed
- [ ] Reactions (emoji on posts)
- [ ] Delete objects
- [ ] Communities + moderation (moderator roles, hide/ban/pin)
- [ ] Browser push notifications
- [ ] Relay discovery (advertise relay list in profile)
- [ ] Media via CAS (content-addressed blob storage, not inline base64)
- [ ] Social recovery (multi-device key sync)
- [ ] Proof-of-work spam prevention
- [ ] Threaded replies
- [ ] Rich text / markdown rendering
- [ ] OpenGraph link previews (server-side fetch)

---

## Metrics

| Metric | Value |
|--------|-------|
| Total source code | 6,527 lines |
| Source files | 48 |
| Test count | 34 |
| Dependencies (runtime) | 4 |
| Bundle size (client JS) | ~35 KB gzipped |
| Relay image size | 78 MB |
| Web image size | 23 MB |
| Relay boot time | <1s |
| Test suite time | <300ms |
| Relays deployed | 2 (US + EU) |
