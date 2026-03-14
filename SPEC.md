# Agora — Product & Development Spec

> Decentralized P2P social platform. No accounts, no servers owning your data. Cryptographic identity, end-to-end encrypted DMs, peer-to-peer gossip.

**Live:** https://agora-web.fly.dev/
**Relay:** wss://agora-relay.fly.dev

---

## Architecture

```
agora/
├── packages/
│   ├── core/          @agora/core — crypto, types, object model (TypeScript)
│   ├── web/           @agora/web — SvelteKit 5 SPA (Svelte 5 runes)
│   └── relay/         @agora/relay — Node.js WebSocket relay server
├── fly.toml           Relay deployment (Fly.io)
├── Dockerfile         Relay container
├── turbo.json         Monorepo orchestration
└── pnpm-workspace.yaml
```

**Stack:** TypeScript · pnpm workspaces · Turborepo · SvelteKit 5 (adapter-static) · @noble/curves (Ed25519, X25519) · ws · geoip-lite · Fly.io

**Total:** ~4,700 lines of source code · 34 tests passing

---

## Data Model

Every piece of data is a **SignedObject**: content-addressed (SHA-256), signed (Ed25519), typed, sequenced.

```typescript
interface SignedObject {
  body: {
    author: string;         // base64 Ed25519 public key
    content: ObjectContent; // type-specific payload
    type: ObjectType;       // "post" | "profile" | "dm" | ...
    seq: number;            // sequence in author's feed
    timestamp: number;      // unix ms
    prev?: string;          // hash chain to previous object
  };
  id: string;               // "sha256:<hex>" of canonical JSON body
  sig: string;              // base64 Ed25519 signature
}
```

### Object Types (8)

| Type | Content | Status |
|------|---------|--------|
| `post` | `{ text, topic?, reply? }` | Implemented |
| `profile` | `{ name?, bio?, x25519PublicKey? }` | Implemented |
| `dm` | `{ recipient, ciphertext, ephemeralPublicKey, nonce }` | Implemented |
| `follow` | `{ target, unfollow? }` | Type defined |
| `reaction` | `{ target, emoji }` | Type defined |
| `delete` | `{ target }` | Type defined |
| `community` | `{ name, description?, moderators? }` | Type defined |
| `modaction` | `{ community, target, action, reason? }` | Type defined |

---

## Identity & Cryptography

- **Identity = Ed25519 keypair** derived from a 12-word BIP-39 mnemonic via HKDF
  - Salt: `agora-ed25519-v1`, Info: `signing-key-seed`
  - Same mnemonic → same keypair on any device
- **Encryption keypair = X25519** derived from same mnemonic (separate HKDF salt: `agora-x25519-v1`)
  - Auto-published in profile object
- **DM encryption:** Per-message ephemeral X25519 → ECDH → HKDF → AES-256-GCM (forward secrecy)
- **Object integrity:** `id = SHA-256(canonicalJSON(body))`, `sig = Ed25519(canonicalJSON(body))`

### Dependencies
- `@noble/curves` — Ed25519 signing, X25519 ECDH (no Node.js crypto dependency)
- `@noble/hashes` — SHA-256, HKDF
- Web Crypto API — AES-256-GCM encryption

---

## Wire Protocol

WebSocket JSON messages between client ↔ relay.

### Authentication (challenge-response)
```
Client → { action: "hello", publicKey }
Server → { action: "challenge", nonce }          // 32 random bytes, base64
Client → { action: "auth", signature, nonce }    // Ed25519 sign(nonce)
Server → { action: "auth_ok" }
```

### Data Flow
```
Client → { action: "publish", object: SignedObject }
Client → { action: "subscribe", id, filters: [{ authors?, topics?, types?, since? }] }
Server → { action: "event", subscriptionId, object }    // stored + live matches
Server → { action: "eose", subscriptionId }              // end of stored events
```

### P2P Signaling
```
Client → { action: "signal", target, signalType: "offer"|"answer"|"ice", data }
Server → relays to target client
Client → { action: "peers" }
Server → { action: "peers", peers: [{ publicKey, geo: { city, country } }] }
```

---

## Relay Server (`@agora/relay`)

**Port:** 9800 · **Deploy:** Fly.io (sjc) · **Storage:** persistent volume at `/data`

### Components

| File | Lines | Purpose |
|------|-------|---------|
| `server.ts` | 280 | WebSocket server, auth, message routing, WebRTC signaling, GeoIP |
| `store.ts` | 160 | In-memory index + daily JSONL persistence |
| `subscription.ts` | 49 | Filter matching, broadcast to subscribers |
| `auth.ts` | 38 | Challenge-response Ed25519 authentication |
| `config.ts` | 7 | Environment configuration |
| `index.ts` | 22 | HTTP server + `/health` endpoint |

### Object Store
- **In-memory:** `Map<id, SignedObject>` + `Map<author, SignedObject[]>` (sorted by seq)
- **Persistence:** Daily JSONL files (`data/objects/YYYY-MM-DD.jsonl`)
- **Eviction:** 7-day TTL · 10,000 max objects · 1,000 per author
- **Load on startup:** reads all JSONL files back into memory

### GeoIP
- Resolves client IP on connect via `geoip-lite`
- City + country included in `peers` response
- Uses `X-Forwarded-For` header (Fly.io proxy)

### Health
```
GET /health → { status: "ok", clients: N, authenticated: N, objects: N }
```

---

## Web Client (`@agora/web`)

**Framework:** SvelteKit 5 (adapter-static, SPA) · **Deploy:** Fly.io (nginx)

### Manager Architecture

The app initializes a chain of managers in `+layout.svelte`:

```
RelayClient → FeedManager → ProfileManager
                          → DMManager
                          → PeerManager → GossipManager
```

| Manager | Purpose |
|---------|---------|
| `RelayClient` | WebSocket connection, auth, reconnect, event dispatch |
| `FeedManager` | Orchestrates relay + P2P + cache + outbox |
| `CacheManager` | IndexedDB persistence with sync cursors |
| `Outbox` | Queues objects created offline, flushes on reconnect |
| `ProfileManager` | Tracks profiles, online status, GeoIP, display names |
| `DMManager` | E2E encrypted conversations, outgoing plaintext storage |
| `PeerManager` | WebRTC data channels, offer/answer via relay signaling |
| `GossipManager` | Forwards objects to P2P peers, validates incoming gossip |

### IndexedDB Databases (3)

| Database | Purpose |
|----------|---------|
| `agora_identity` | Ed25519 keypair + mnemonic (persists across sessions) |
| `agora_cache` | Object store with indexes on `[author, seq]`, `timestamp`, `type` |
| `agora_outbox` | Pending objects for offline publish |

### Routes

| Route | Page |
|-------|------|
| `/` | Feed — topic tabs, compose, post list with reply counts |
| `/post/[id]` | Post detail — parent post + single-level replies |
| `/topic/[name]` | Topic feed (legacy, still works) |
| `/network` | Online peers with GeoIP location, add by address |
| `/dm` | WhatsApp-style split layout — sidebar conversations + chat |
| `/dm/[pubkey]` | Redirects to `/dm` with conversation auto-selected |
| `/settings` | Profile editing (username), identity management, sign out |
| `/setup` | Onboarding — create new identity or restore from phrase |

### Topics (9 pre-defined)

| ID | Label | Description |
|----|-------|-------------|
| `general` | General | Anything goes |
| `tech` | Tech | Software, hardware, hacking |
| `crypto` | Crypto | Cryptography, protocols, privacy |
| `p2p` | P2P | Decentralization, mesh networks |
| `ww3` | WW3 | Geopolitics, conflict, world events |
| `memes` | Memes | Internet culture, shitposts |
| `art` | Art | Creative work, music, visuals |
| `science` | Science | Research, papers, discoveries |
| `random` | Random | Off-topic chaos |

### Design System

- **Theme:** Dark background (`#07070a`), orange accent (`#f97316`)
- **Fonts:** Inter (UI), JetBrains Mono (code/addresses)
- **Background:** CSS grid lines + canvas with animated pulsing nodes that respond to mouse movement
- **Components:** `.btn`, `.btn-secondary`, `.card`, `.badge`, `.input`, `.mono`
- **Glow effects:** Ambient blurred orbs, hover glow on cards, accent shadows
- **Nav:** Geometric icons with active glow underline, pulse animations

---

## P2P Layer

### WebRTC Data Channels
- **Signaling:** Relay forwards `offer`/`answer`/`ice` messages between peers
- **STUN:** `stun:stun.l.google.com:19302`
- **Conflict avoidance:** Only the peer with the "lower" public key initiates (prevents double-connect)
- **Data format:** JSON `{ type: "gossip", object: SignedObject }`

### Gossip Protocol
- New objects are forwarded to all connected P2P peers
- Dedup by seen-set (object ID)
- Incoming gossip objects are validated (signature + hash) before accepting
- Objects from gossip are cached to IndexedDB same as relay objects

### Offline Support
- **Outbox:** Objects created while disconnected are queued in IndexedDB
- **Flush on reconnect:** Outbox drains when relay connection re-establishes
- **Cache cursors:** Each subscription tracks its latest timestamp; on reconnect, subscribes with `since` to avoid re-fetching

---

## Encrypted DMs

### Flow
1. Sender looks up recipient's X25519 public key from their profile object
2. Generates fresh ephemeral X25519 keypair (per-message forward secrecy)
3. ECDH: `sharedSecret = X25519(ephemeral_private, recipient_public)`
4. HKDF: `aesKey = HKDF(sharedSecret, ephemeralPublicKey, "agora-dm-v1")`
5. Encrypt: `AES-256-GCM(plaintext, aesKey, random_nonce)`
6. Publish as `dm` object with ciphertext + ephemeral public key + nonce

### Sender-side display
- Sender cannot decrypt their own outgoing DMs (encrypted with recipient's key)
- Outgoing plaintext stored in `localStorage` keyed by object ID
- Loaded back on page refresh for display

### Key Discovery
- Each client auto-publishes a `profile` object containing their X25519 public key on connect
- DM UI shows "E2E encryption pending" if recipient's key hasn't been received yet

---

## Tests

34 tests across 3 test files:

| File | Tests | Coverage |
|------|-------|----------|
| `crypto.test.ts` | 20 | Canonical JSON, base64, SHA-256, Ed25519 sign/verify, BIP-39 mnemonic generation/validation, deterministic derivation, HKDF |
| `objects.test.ts` | 8 | Object creation, hash integrity, signature validation, tamper detection, JSON round-trip |
| `encryption.test.ts` | 6 | X25519 deterministic derivation, encrypt/decrypt round-trip, wrong key rejection, forward secrecy verification, unicode |

```bash
pnpm --filter @agora/core test   # 34 tests, <300ms
```

---

## Deployment

### Relay (`agora-relay`)
- **Platform:** Fly.io, sjc region
- **Container:** Node.js 22-slim, multi-stage Docker build
- **Storage:** 1GB persistent volume at `/data`
- **VM:** shared-cpu-1x, 256MB RAM
- **Auto-scaling:** stops when idle, starts on request

### Web Client (`agora-web`)
- **Platform:** Fly.io, sjc region
- **Container:** nginx:alpine serving static SPA
- **Routing:** SPA fallback (`try_files $uri /index.html`)
- **Relay URL:** `wss://agora-relay.fly.dev` (production), `ws://localhost:9800` (dev)

### Local Development
```bash
cd agora
pnpm install
node packages/relay/dist/index.js &   # relay on :9800
pnpm --filter @agora/web dev          # web on :5173
```

---

## What's Implemented vs Planned

### Done
- [x] Phase 0: Core library (crypto, identity, object model)
- [x] Phase 1: Relay + live feed
- [x] Phase 2: Persistence + offline (IndexedDB cache, outbox, sync cursors)
- [x] Phase 3: Browser-to-browser P2P (WebRTC + gossip)
- [x] Phase 4: Encrypted DMs (X25519 ECDH + AES-256-GCM)
- [x] Topic-based feeds with pre-defined topics
- [x] Single-level post replies
- [x] Profile editing (username)
- [x] GeoIP location on peers
- [x] Orange matrix UI theme with animated grid canvas
- [x] Production deployment (Fly.io)

### Not Yet Built
- [ ] Phase 5: Communities + moderation (moderator actions, client-side filtering)
- [ ] Follows / following-only feed
- [ ] Reactions (emoji on posts)
- [ ] Delete objects
- [ ] Media attachments
- [ ] Mobile-responsive layout
- [ ] Custom relay URL in settings UI
- [ ] Social recovery / multi-device sync
