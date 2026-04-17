# Riot P2P — Technical Specification

> Peer-to-peer encrypted messaging and identity platform. No servers. No accounts. No surveillance.

**Live:** https://app.riotp2p.com
**Landing:** https://riotp2p.com
**Source:** https://github.com/vortex-303/agora

---

## Architecture Overview

Riot is a fully decentralized messaging platform where browsers connect directly to each other via WebRTC. Peer discovery happens through public BitTorrent tracker infrastructure. There are no Riot-operated servers.

```
┌──────────┐         ┌──────────────────┐         ┌──────────┐
│ Browser  │◄═══════►│  BitTorrent      │◄═══════►│ Browser  │
│ (user A) │  WebRTC │  Tracker         │  WebRTC │ (user B) │
│          │  direct │  (discovery only)│  direct │          │
└──────────┘         └──────────────────┘         └──────────┘
     ▲                                                  ▲
     │              ┌──────────────────┐                │
     └══════════════│ Seeder CLI       │════════════════┘
        WebRTC      │ (optional node)  │        WebRTC
                    └──────────────────┘
```

### Key Properties

- **No servers.** The tracker is public BitTorrent infrastructure (openwebtorrent.com), not operated by Riot.
- **Self-authenticating data.** Every object is signed with Ed25519 and content-addressed with SHA-256.
- **E2E encrypted messaging.** Per-message forward secrecy via X25519 ECDH + AES-256-GCM.
- **Portable identity.** 12-word BIP-39 mnemonic generates all keys deterministically.
- **Offline-capable.** Data persists in IndexedDB. Sync happens when peers reconnect.

---

## Identity & Cryptography

### Key Derivation

```
Mnemonic (12 words, 128-bit entropy + checksum)
    │
    ├── HKDF(SHA-256, mnemonic, "agora-ed25519-v1") → Ed25519 seed
    │   └── Ed25519 keypair (signing + identity)
    │       └── Public key = user's identity (base64-encoded)
    │
    └── HKDF(SHA-256, mnemonic, "agora-x25519-v1") → X25519 seed
        └── X25519 keypair (encryption)
            ├── Used for DM encryption (ECDH with recipient)
            └── Used for self-encryption (account sync)
```

### Libraries

- **@noble/curves** — Ed25519 signing, X25519 ECDH
- **@noble/hashes** — SHA-256, SHA-1 (infohash), HKDF
- **Web Crypto API** — AES-256-GCM encryption/decryption

---

## Network Layer

### Peer Discovery

All peers announce to a single BitTorrent WebSocket tracker using infohash `SHA-1("riot:network:v1")`. The tracker returns WebRTC offers from other peers.

```
1. Browser → Tracker: announce(infohash, peer_id, [WebRTC offer])
2. Tracker → Browser: here's another peer's offer
3. Browser → Tracker: answer(offer_id, [WebRTC answer])
4. Tracker forwards answer to the offering peer
5. WebRTC DataChannel established (direct, no tracker involvement)
```

### Connection Management

**Tiebreaker:** When both peers simultaneously offer to each other, the peer with the lexicographically lower tracker ID is the designated offerer. The higher ID peer accepts offers only. This ensures exactly ONE connection per peer pair.

**Announce interval:** Every 20 seconds.

**ICE configuration:** STUN only (stun.l.google.com). No TURN servers.

### Pubkey Handshake

On DataChannel open, both peers exchange: `{ _riot_hello: "ed25519_public_key_base64" }`

This maps tracker peer IDs to cryptographic identities, enabling:
- Direct message delivery by pubkey
- Profile lookup for connected peers
- Contact online/offline status

---

## Object Model

### SignedObject

Every piece of data in Riot is a SignedObject:

```typescript
interface SignedObject {
  id: string;        // "sha256:<hex>" — content-addressed
  sig: string;       // base64 Ed25519 signature of body
  body: {
    author: string;  // base64 Ed25519 public key
    type: ObjectType;
    content: ObjectContent;
    seq: number;     // monotonic per author
    timestamp: number;
    prev?: string;   // hash chain
  };
}
```

### Object Types

| Type | Content | Purpose |
|------|---------|---------|
| `post` | text, topic?, image?, reply? | Lobby pins, shared files |
| `profile` | name?, bio?, x25519PublicKey? | User identity |
| `dm` | recipient, ciphertext, ephemeralPublicKey, nonce | Encrypted DM |
| `read_receipt` | messageId | DM read confirmation |
| `reaction` | target, emoji | Upvote/downvote |
| `delete` | target | Author-signed deletion |
| `encrypted_state` | category, ciphertext, nonce | Self-encrypted account data |
| `community` | name, description?, moderators? | Community definition |
| `modaction` | community, target, action, reason? | Moderation action |

---

## Gossip Protocol

Runs over WebRTC DataChannels. Four message types:

```
gossip      → push new object to peer (real-time)
watermark   → exchange highest seq per author (on connect)
request     → ask for objects from author after seq N
response    → batch of requested objects (max 50)
```

### Sync Flow

```
Peer A connects to Peer B:
  A → B: watermark { "authorX": 5, "authorY": 3 }
  B → A: watermark { "authorX": 5, "authorZ": 7 }
  A → B: request { author: "authorZ", afterSeq: 0 }
  B → A: response { objects: [...all of Z's objects...] }
```

Objects are validated on receipt: signature verified, hash checked. Invalid objects are silently dropped.

---

## DM Encryption

### Sending

```
1. Generate ephemeral X25519 keypair
2. ECDH(ephemeral_private, recipient_x25519_public) → shared_secret
3. HKDF(shared_secret, ephemeral_public, "agora-dm-v1") → AES key
4. AES-256-GCM(key, random_nonce, plaintext) → ciphertext
5. Publish: { recipient, ciphertext, ephemeralPublicKey, nonce }
```

### Receiving

```
1. ECDH(my_x25519_private, ephemeral_public_key) → same shared_secret
2. HKDF → same AES key
3. AES-256-GCM decrypt → plaintext
```

### Delivery

- **Direct:** if recipient is connected, send on their DataChannel
- **Gossip fallback:** if offline, store in cache; delivered via watermark sync when they connect
- **Status indicators:** ⏳ queued → ✓ sent → ✓✓ read

---

## Account Sync

Contacts, settings, and blocked users are stored as self-encrypted SignedObjects:

```
selfEncrypt(data):
  ECDH(my_x25519_private, my_x25519_public) → deterministic shared secret
  HKDF("riot-self-v1") → AES key
  AES-256-GCM(key, nonce, JSON.stringify(data)) → ciphertext
```

Published as `encrypted_state` objects. Only the owner's mnemonic can decrypt. Synced across devices via gossip.

| Category | Data |
|----------|------|
| `contacts` | List of pubkeys |
| `settings` | Concierge profile (availability, services, links, FAQ) |
| `blocked` | Blocked pubkey list |

---

## Seed Mode

Browser-based community hosting. Toggle in Network tab.

**When enabled:**
- Caches all objects received from any peer
- Serves cached objects to any peer that requests them
- Tracks contribution: objects served, peers helped, uptime

**Badges:** New Seeder → Seeder → Active Seeder → Veteran Seeder

---

## Seeder CLI

Always-on Node.js process for 24/7 network participation.

```bash
# Personal: keep your lobby alive
npx @riotp2p/seed --topics riot:user:YOUR_KEY

# Network node: host content for others
npx @riotp2p/seed --seed-all --budget 512
```

### Features

- WebRTC via node-datachannel
- JSONL storage at `~/.riot-seed/objects.jsonl`
- Web dashboard at `localhost:9876`
- DHT publishing (BEP 44)
- Neighborhood storage with XOR-based assignment
- Budget-aware eviction

---

## Persistence Layers

```
Layer 1: IndexedDB (browser)
  └── Instant, per-device, survives tab close

Layer 2: Reciprocal peer cache
  └── Every connected peer caches received objects

Layer 3: Seeder CLI (optional)
  └── Disk-backed, always-on, serves objects 24/7

Layer 4: BitTorrent DHT (seeder publishes)
  └── 20M+ nodes, profiles survive 2-8h without any Riot node
```

---

## Tech Stack

### Monorepo

```
agora/
├── packages/
│   ├── core/         Crypto, objects, types (~1,100 lines)
│   ├── web/          SvelteKit 5 SPA (~5,000 lines)
│   └── seed/         Node.js seeder CLI (~600 lines)
└── landing/          Landing page (single HTML)
```

### Dependencies

| Package | Runtime Deps |
|---------|-------------|
| @agora/core | @noble/curves, @noble/hashes |
| @agora/web | @agora/core, @noble/hashes |
| @riotp2p/seed | @noble/curves, @noble/hashes, node-datachannel, bittorrent-dht |

### Deployment

| Component | Platform | URL |
|-----------|----------|-----|
| Web app | Vercel (static SPA) | app.riotp2p.com |
| Landing | Vercel | riotp2p.com |
| Seeder | Any Node.js 18+ machine | localhost:9876 |

---

## Security Model

### Protects against
- Surveillance (E2E encryption, no server sees plaintext)
- Impersonation (Ed25519 signatures verify authorship)
- Tampering (SHA-256 content addressing)
- Metadata leakage (no central server)
- Account theft (no server holds credentials)

### Does NOT protect against
- Traffic analysis (observer can see IP connections)
- Key loss (lose mnemonic = lose identity)
- Sybil attacks (free keypair creation)
- Eclipse attacks (all-malicious peers can withhold data)

---

## Roadmap

### Done
- [x] Cryptographic identity (BIP-39 + Ed25519)
- [x] Signed content-addressed objects
- [x] WebRTC P2P via BitTorrent tracker
- [x] Single-swarm discovery with tiebreaker
- [x] E2E encrypted DMs with forward secrecy
- [x] Direct peer messaging (pubkey-addressed)
- [x] Read receipts (queued → sent → read)
- [x] Contact management with online status
- [x] Account sync (self-encrypted)
- [x] Seed mode (browser community hosting)
- [x] Seeder CLI with dashboard + DHT
- [x] Desktop layout (sidebar nav)
- [x] Image compression + 5MB upload
- [x] Lobby with pins, files, inbox

### Planned
- [ ] Voice/video calls (WebRTC media tracks)
- [ ] Vanity URLs (name.pubkey-prefix)
- [ ] WebTorrent file sharing (magnet links)
- [ ] AI concierge (Ollama in seeder)
- [ ] Group DMs
- [ ] npm publish (@riotp2p/seed)
- [ ] Contribution badges on profile
