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

- **Every piece of data is self-authenticating** — posts, replies, profiles, votes, communities, mod actions, DMs are content-addressed (SHA-256) and signed (Ed25519). Anyone can verify any object without trusting the server that delivered it.

- **Relays are dumb pipes** — they store and forward signed objects. They cannot forge, modify, or selectively censor content they can't even decrypt. Users connect to multiple relays simultaneously. If one goes down, others keep working.

- **Browsers talk directly** — WebRTC data channels between browsers enable peer-to-peer gossip and pull-sync. Posts propagate through the mesh even when all relays are offline.

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
- **Communities** — user-created communities with first-claim naming. Creator becomes moderator. Communities track member count and post count from feed state.
- **Community feeds** — `/c/[name]` pages showing posts in a specific community
- **Community directory** — `/communities` browse page listing all communities sorted by activity
- **Posts with images** — text posts with optional inline base64 images (paste or file select, 500KB limit)
- **Markdown rendering** — bold (`**`), italic (`*`), strikethrough (`~~`), inline code, fenced code blocks, auto-linked URLs with clean display
- **Upvote/downvote** — cryptographically signed votes using `reaction` objects. One vote per identity per target (latest vote wins, allows changing direction). Enforced by public key dedup — no sockpuppeting without a new keypair.
- **Main Feed ranking** — engagement-weighted algorithm: `(max(votes, 0) + 1) * (1 + replies * 0.3) / ((ageHours / 6) + 1)^1.5`. Recent popular posts rise, old posts decay.
- **Personal "My Feed"** — follow communities, see only posts from followed communities. Defaults to personal feed when communities are followed.
- **Single-level replies** — click a post to see/write replies (no threading)
- **Delete own posts** — signed `delete` objects that any node can verify came from the original author
- **User profiles** — `/u/[pubkey]` pages showing user's posts, location, online status
- **Search** — full-text search over cached posts, topics, and people
- **Username** — set display name in settings, shown everywhere instead of public key

### Moderation
- **Community moderators** — creator is auto-moderator; moderator list stored in community object
- **Mod actions** — hide (remove post from feed), ban (block user from community), pin (sticky post), with undo variants (unhide, unban, unpin)
- **Transparent moderation** — all mod actions are signed objects on the public feed. Anyone can audit who moderated what and why. Reason field included.
- **Client-side mute** — hide a user's posts from your feed (localStorage, no network broadcast)
- **Client-side block** — hide a user from everything including DMs (localStorage, no network broadcast)
- **Mute/block persistence** — stored in localStorage, survives page reload

### Messaging
- **E2E encrypted DMs** — X25519 ECDH + HKDF + AES-256-GCM, per-message forward secrecy
- **WhatsApp-style layout** — conversation sidebar + chat panel (responsive: stacks on mobile)
- **Key exchange via relay** — X25519 public keys included in hello message + profile objects
- **Outgoing plaintext storage** — sender's own messages stored locally (can't decrypt own outgoing DMs)

### Networking
- **Multi-relay** — clients connect to all configured relays simultaneously, dedup objects across them
- **Relay-to-relay sync** — relays connect to peer relays and exchange objects via `PEER_RELAYS` env var
- **WebRTC P2P** — data channels between browsers, relay used for signaling (offer/answer/ICE)
- **P2P pull-sync protocol** — on WebRTC peer connect, exchange watermarks (highest seq per author), identify gaps, request missing objects in batches (up to 50), validate signatures on receipt. Four message types: `gossip`, `watermark`, `request`, `response`.
- **P2P gossip** — new objects forwarded to all WebRTC peers, validated before accepting
- **GeoIP** — relay resolves client IP to city/country, included in peer list
- **Peer discovery** — relay broadcasts online peer list with geo + X25519 keys
- **Contribution stats** — gossip manager tracks objects served, objects received, bytes served, seen count, connected peers

### Offline & Persistence
- **IndexedDB cache** — all objects cached locally with indexes on author+seq and timestamp
- **Outbox queue** — posts created offline queued in IndexedDB, auto-published on reconnect
- **Sync cursors** — each subscription tracks latest timestamp, reconnect fetches only new objects
- **PWA** — installable as home screen app on iOS/Android, service worker caches static assets

### Chrome Extension
- **MV3 manifest** — `packages/extension/`, Manifest V3 with `storage` and `alarms` permissions
- **Background health polling** — service worker polls relay `/health` endpoints every 60 seconds (MV3 doesn't support persistent WebSocket)
- **IndexedDB object store** — caches objects received from the web app, acts as persistent node
- **Badge display** — shows cached object count (orange) or `!` (red) when relays are offline
- **Popup UI** — shows relay connection status, object count, last sync time
- **Message API** — `store_objects` and `get_stats` actions for communication with the web app

### Network Status Page
- **`/status` route** — real-time network dashboard showing:
  - Aggregate stats: total objects, connected users, countries, relays online
  - Relay sync status (in sync vs syncing, based on object count delta)
  - Per-relay cards: objects, users, countries, sync peers, latency, uptime
  - P2P section: WebRTC peers, cached objects, objects served/received
  - Community table: posts and members per community
- **Auto-refresh** — polls relay health every 15 seconds

### Relay Dashboard
- **HTML dashboard at `/`** — every relay serves a styled status page with:
  - Live stats: objects, clients, authenticated users, countries, uptime
  - Sync peer status with object counts
  - Auto-refreshes every 15 seconds via `<meta http-equiv="refresh">`
  - Themed to match the Agora design system (orange accent, dark background)

### Infrastructure
- **Rate limiting** — 30 publishes/min, 20 subscribes/min, 50 connections/IP
- **Object expiry** — 7-day TTL, 10K max objects, 1K per author on relay
- **JSONL persistence** — relay stores objects in daily JSONL files on persistent volume
- **Invite links** — `/join/[address]` URLs that auto-open DM after identity creation
- **Content seeding** — `scripts/seed-content.mjs` populates a fresh relay with sample posts across communities

### Deployment
- **Docker Compose template** — `deploy/docker-compose.yml` for self-hosting a relay with persistent volume and peer relay sync
- **Fly.io template** — `deploy/fly-template.toml` for one-command Fly.io deployment
- **Install script** — `deploy/install.sh` clones, builds, and configures a relay with instructions to run
- **2 production relays** — US West (San Jose) and EU West (Amsterdam) with relay-to-relay sync via `PEER_RELAYS`

### UX
- **Onboarding flow** — 3 steps: create identity, save recovery phrase, pick username
- **Community picker** — dropdown in compose bar to select which community to post in, with "Browse all" link
- **Feed mode tabs** — toggle between "Main Feed" (ranked) and "My Feed" (followed communities)
- **Contribution footer** — shows cached objects, connected peers, objects served to network
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
│  Browser (SPA)  │────>│  Relay US (sjc)  │<───sync───>│  Relay EU (ams)  │
│  SvelteKit PWA  │     │  Node.js + ws    │            │  Node.js + ws    │
│                 │────>│                  │            │                  │
└────────┬────────┘     └─────────────────┘            └──────────────────┘
         │
         │ WebRTC
         │ data channel
         │ (gossip + pull-sync)
         v
┌─────────────────┐     ┌─────────────────┐
│  Browser (SPA)  │     │ Chrome Extension │
│  SvelteKit PWA  │     │ Persistent node  │
└─────────────────┘     └─────────────────┘
```

### Data Flow

1. **Publish:** Client creates SignedObject -> sends to all connected relays -> relays validate signature -> store -> broadcast to subscribers -> forward to peer relays
2. **Subscribe:** Client sends filter (authors, topics, types, since) -> relay sends matching stored objects -> sends `eose` -> streams live matches
3. **P2P Gossip:** Client receives object from relay or peer -> validates sig+hash -> caches to IndexedDB -> forwards to WebRTC peers
4. **P2P Pull-Sync:** On peer connect, exchange watermarks (author -> highest seq) -> identify gaps -> request missing objects -> validate + ingest
5. **DM:** Sender encrypts with recipient's X25519 key -> publishes as `dm` object -> relay stores ciphertext -> recipient decrypts with private key
6. **Vote:** Client creates signed `reaction` object (emoji = "upvote" or "downvote") -> publishes -> all clients tally votes per target, one per author
7. **Moderation:** Moderator creates signed `modaction` object -> community peers verify moderator role -> apply action (hide/ban/pin)

### Authentication Flow

```
Client                          Relay
  │                               │
  │──── hello (publicKey, x25519) ──>│
  │                               │
  │<── challenge (32-byte nonce) ──│
  │                               │
  │──── auth (Ed25519 sig of nonce) ──>│
  │                               │
  │<──────── auth_ok ─────────────│
```

---

## Tech Stack

### Monorepo Structure

```
agora/                          ~9,200 lines · 125 source files
├── packages/
│   ├── core/                   @agora/core — 1,012 lines
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
│   ├── relay/                  @agora/relay — 966 lines
│   │   └── src/
│   │       ├── server.ts       WebSocket server, auth, routing, GeoIP, sync
│   │       ├── store.ts        In-memory index + JSONL persistence
│   │       ├── subscription.ts Filter matching, broadcast
│   │       ├── auth.ts         Challenge-response authentication
│   │       ├── sync.ts         Relay-to-relay object sync
│   │       ├── ratelimit.ts    Per-identity + per-IP rate limiting
│   │       ├── config.ts       Environment configuration
│   │       └── index.ts        HTTP server + /health + HTML dashboard
│   │
│   ├── web/                    @agora/web — 39 files, 5,373 lines
│   │   ├── src/lib/
│   │   │   ├── relay.ts        RelayClient — single WebSocket connection
│   │   │   ├── relay-pool.ts   RelayPool — multi-relay with dedup
│   │   │   ├── relay-interface.ts  Shared interface type
│   │   │   ├── feed.ts         FeedManager — orchestrates relay+P2P+cache
│   │   │   ├── cache.ts        IndexedDB object cache with sync cursors
│   │   │   ├── outbox.ts       Offline publish queue
│   │   │   ├── dm.ts           DMManager — E2E encrypted conversations
│   │   │   ├── profiles.ts     ProfileManager — users, geo, online status
│   │   │   ├── webrtc.ts       PeerManager — WebRTC data channels
│   │   │   ├── gossip.ts       GossipManager — P2P gossip + pull-sync protocol
│   │   │   ├── votes.ts        VoteManager — upvote/downvote tallying
│   │   │   ├── communities.ts  CommunityManager — create, claim, moderate
│   │   │   ├── moderation-client.ts  ClientModeration — mute, block, delete, follow communities
│   │   │   ├── identity.ts     IndexedDB identity persistence
│   │   │   ├── topics.ts       Pre-defined topic definitions
│   │   │   ├── stores.svelte.ts  Svelte 5 rune stores
│   │   │   ├── Markdown.svelte Markdown rendering (bold, italic, code, links, strikethrough)
│   │   │   ├── GridCanvas.svelte  Animated grid background
│   │   │   ├── LinkText.svelte URL detection + rendering
│   │   │   └── theme.css       Design tokens + component styles
│   │   └── src/routes/         15 pages
│   │       ├── +layout.svelte  Root: nav, identity init, manager chain
│   │       ├── +page.svelte    Feed: Main Feed (ranked) + My Feed (personal)
│   │       ├── post/[id]/      Post detail + replies + voting
│   │       ├── c/[name]/       Community feed page
│   │       ├── communities/    Community directory (browse all)
│   │       ├── dm/             WhatsApp-style DM layout
│   │       ├── network/        Online peers with GeoIP
│   │       ├── status/         Network status dashboard
│   │       ├── search/         Full-text search
│   │       ├── settings/       Profile, relay management, identity
│   │       ├── setup/          3-step onboarding
│   │       ├── u/[pubkey]/     User profile page
│   │       └── join/[address]/ Invite link handler
│   │
│   └── extension/              Chrome Extension — 5 files, 273 lines
│       ├── manifest.json       MV3 manifest (storage, alarms permissions)
│       ├── background.js       Service worker: health polling, IndexedDB cache
│       ├── popup.html          Extension popup UI
│       ├── popup.js            Popup logic: stats display
│       └── icons/              Extension icons (16, 48, 128px)
│
├── scripts/
│   └── seed-content.mjs        Content seeding script for fresh relays
│
├── deploy/
│   ├── docker-compose.yml      Self-hosting with persistent volume
│   ├── fly-template.toml       Fly.io one-command deployment
│   └── install.sh              Clone + build + configure script
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
| **extension** | (none — vanilla JS) | (none) |

### Key Technical Decisions

| Decision | Choice | Why |
|----------|--------|-----|
| Crypto library | @noble/curves (not Web Crypto API) | Synchronous Ed25519, works identically in browser and Node.js, no async overhead |
| Identity model | BIP-39 mnemonic -> HKDF -> Ed25519 | Deterministic, portable, human-readable backup, proven standard |
| DM encryption | Per-message ephemeral X25519 -> ECDH -> AES-256-GCM | Forward secrecy per message, no session state to manage |
| Object format | Content-addressed (SHA-256 hash as ID) | Self-authenticating, dedup across relays is trivial, no coordination needed |
| Hash chain | `prev` + `seq` per author | Efficient sync ("give me everything after seq N"), detects missing objects |
| Web framework | SvelteKit 5 with adapter-static | SPA with client-side routing, smallest bundle, Svelte 5 runes for reactivity |
| Relay protocol | JSON over WebSocket | Simple, debuggable, no binary protocol overhead at this scale |
| Storage (relay) | In-memory Map + daily JSONL files | Fast reads, append-only writes, easy to inspect/backup/replay |
| Storage (client) | IndexedDB | Only persistent storage available in browsers, survives tab close |
| Multi-relay | RelayPool wrapping N RelayClient instances | Same interface, transparent dedup, publish to all, subscribe to all |
| P2P | WebRTC data channels | Only way to get browser-to-browser without plugins |
| Relay sync | WebSocket peer connections with object exchange | Relays are also clients to each other, reuse existing protocol |
| Voting | Signed reaction objects, one per identity | Cryptographically enforced — can't double-vote without new keypair |
| Feed ranking | votes * replies / time decay | Simple, transparent, no opaque algorithm. Formula is in client code. |
| Moderation | Signed mod actions on public feed | Transparent, auditable, no shadow bans. Every action has a trail. |
| Extension | MV3 with fetch polling | MV3 service workers don't support persistent WebSocket; alarms + fetch is reliable |

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
| **reaction** | `target`, `emoji` (upvote/downvote) | Implemented |
| **delete** | `target` | Implemented |
| **community** | `name`, `description?`, `moderators?[]` | Implemented |
| **modaction** | `community`, `target`, `action`, `reason?` | Implemented |
| **follow** | `target`, `unfollow?` | Type defined |

### Wire Protocol

| Message | Direction | Purpose |
|---------|-----------|---------|
| `hello` | C->S | Start auth (publicKey + x25519PublicKey) |
| `challenge` | S->C | 32-byte random nonce |
| `auth` | C->S | Ed25519 signature of nonce |
| `auth_ok` / `auth_fail` | S->C | Auth result |
| `publish` | C->S | Submit signed object |
| `subscribe` | C->S | Register filter (authors, topics, types, since, limit) |
| `event` | S->C | Object matching subscription |
| `eose` | S->C | End of stored events (live streaming begins) |
| `signal` | C->S->C | WebRTC signaling (offer/answer/ice) |
| `peers` | C->S->C | Online peer list with geo + x25519 keys |
| `relay_sync` | S->S | Relay-to-relay sync subscription |
| `relay_sync_object` | S->S | Object exchange between relays |
| `error` | S->C | Error message |

### P2P Sync Protocol (WebRTC data channel)

| Message | Direction | Purpose |
|---------|-----------|---------|
| `gossip` | P->P | Push new object to peers (real-time) |
| `watermark` | P->P | Exchange highest seq per author on connect |
| `request` | P->P | Request objects for author after given seq |
| `response` | P->P | Batch response with requested objects (max 50) |

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

### Self-Hosting

Three ways to run your own relay:

1. **Docker Compose** (`deploy/docker-compose.yml`): `docker-compose up -d` with persistent volume and peer relay sync pre-configured
2. **Fly.io** (`deploy/fly-template.toml`): one-command `fly launch` deployment
3. **Bare metal** (`deploy/install.sh`): clone, build, run. Requires Node.js and git.

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
- UI: Inter (400-800)
- Code/addresses: JetBrains Mono (400-500)

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
- [x] Relay-to-relay sync (US <-> EU) via `PEER_RELAYS`
- [x] WebRTC P2P with gossip protocol
- [x] P2P pull-sync (watermark exchange + batch object serving)
- [x] E2E encrypted DMs (X25519 + AES-256-GCM)
- [x] User-created communities with first-claim naming
- [x] Community moderation (hide, ban, pin + undo variants)
- [x] Transparent mod actions (signed, auditable)
- [x] Upvote/downvote (cryptographically enforced, one per identity)
- [x] Main Feed ranking algorithm (votes * replies / time decay)
- [x] Personal "My Feed" (follow communities)
- [x] Posts with images + markdown rendering
- [x] Single-level replies
- [x] Delete own posts (signed delete objects)
- [x] Client-side mute and block (localStorage)
- [x] User profiles with GeoIP location
- [x] Search (posts, topics, people)
- [x] Offline support (cache + outbox)
- [x] Rate limiting + spam prevention
- [x] PWA (installable, service worker)
- [x] Mobile-responsive layout
- [x] Invite links (`/join/[address]`)
- [x] Onboarding flow (3-step)
- [x] Settings (profile, relay management)
- [x] Chrome extension (MV3, background health polling, persistent IndexedDB node)
- [x] Network status page (`/status`)
- [x] Relay HTML dashboard (at `/`)
- [x] Content seeding script
- [x] Deploy templates (Docker Compose, Fly.io, install script)
- [x] Contribution UI (cached objects, peers, objects served)
- [x] Landing page (agorap2p.com)
- [x] Custom domain deployment

### Not Yet Built
- [ ] Reactions (emoji on posts, beyond upvote/downvote)
- [ ] Replication counting (track N copies of each object across network)
- [ ] Persistent peer package (`@agora/peer` — lightweight always-on node)
- [ ] Browser push notifications
- [ ] Relay discovery (advertise relay list in profile)
- [ ] Media via CAS (content-addressed blob storage, not inline base64)
- [ ] Social recovery (multi-device key sync)
- [ ] Proof-of-work spam prevention
- [ ] Threaded replies (beyond single-level)
- [ ] OpenGraph link previews (server-side fetch)
- [ ] Relay demotion to bootstrap-only (Phase D of distributed storage plan)

---

## Metrics

| Metric | Value |
|--------|-------|
| Total source code | ~9,200 lines |
| Source files | 125 |
| Test count | 34 |
| Dependencies (runtime) | 4 |
| Bundle size (client JS) | ~35 KB gzipped |
| Relay image size | 78 MB |
| Web image size | 23 MB |
| Relay boot time | <1s |
| Test suite time | <300ms |
| Relays deployed | 2 (US + EU) |
| Chrome extension | MV3, 273 lines |
