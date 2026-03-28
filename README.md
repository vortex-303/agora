# Agora

Decentralized peer-to-peer social platform. No accounts, no servers owning your data.

Your identity is an Ed25519 keypair derived from a 12-word mnemonic. Posts are content-addressed and cryptographically signed. DMs use per-message ephemeral X25519 for forward secrecy. Browsers gossip directly over WebRTC. Relays are dumb pipes that store and forward signed objects — they can't forge, modify, or read encrypted content.

## Live

| | URL |
|---|---|
| Landing | https://agorap2p.com |
| App | https://app.agorap2p.com |
| Relay US (San Jose) | wss://agora-relay.fly.dev |
| Relay EU (Amsterdam) | wss://agora-relay-eu.fly.dev |

## Quick Start

```bash
pnpm install
pnpm build

# Start relay (port 9800)
node packages/relay/dist/index.js &

# Start web dev server (port 5173)
pnpm --filter @agora/web dev
```

## Run a Relay

Support the Agora network by running a relay node. Relays store and forward signed objects — they can't read encrypted content or forge messages.

**See all active relays:** Visit `/network` on any relay (e.g. https://agora-relay.fly.dev/network)

### One-command Docker setup

```bash
curl -sL https://raw.githubusercontent.com/vortex-303/agora/main/deploy/docker-compose.community.yml -o docker-compose.yml
docker compose up -d
```

Your relay starts on port 9800 and auto-syncs with the public Agora network. Visit `http://localhost:9800` to see your relay dashboard.

### Configure your relay

Edit `docker-compose.yml` and uncomment the environment variables:

```yaml
environment:
  - RELAY_NAME=My Agora Relay
  - RELAY_DESCRIPTION=Community relay in Tokyo
  - RELAY_CONTACT=you@example.com
  - RELAY_URL=wss://your-domain.com
```

Setting `RELAY_URL` registers your relay on the public network status page so others can discover it.

### Other methods

**Docker (manual build):**
```bash
docker build -t agora-relay .
docker run -p 9800:9800 -v agora-data:/data agora-relay
```

**Fly.io:**
```bash
fly launch --config fly.toml
fly volumes create agora_data --size 1
fly deploy
```

**From source:**
```bash
pnpm install
pnpm --filter @agora/core build
pnpm --filter @agora/relay build
DATA_DIR=./data node packages/relay/dist/index.js
```

### Relay endpoints

| Endpoint | Description |
|---|---|
| `/` | Relay dashboard |
| `/health` | Health check (JSON) |
| `/info` | Relay metadata + live stats (JSON) |
| `/network` | Public network status page (all relays) |
| `/relays` | Registry of all known relays (JSON API) |

### Environment variables

| Variable | Default | Description |
|---|---|---|
| `PORT` | `9800` | Listen port |
| `DATA_DIR` | `/data` | JSONL storage directory |
| `PEER_RELAYS` | — | Comma-separated relay URLs for sync |
| `RELAY_NAME` | — | Display name for your relay |
| `RELAY_DESCRIPTION` | — | Short description |
| `RELAY_CONTACT` | — | Your contact info |
| `RELAY_URL` | — | Public `wss://` URL (enables network registration) |
| `MAX_OBJECTS` | `10000` | Max stored objects |
| `MAX_OBJECTS_PER_AUTHOR` | `1000` | Per-author limit |
| `OBJECT_TTL` | 7 days | Object expiry |
| `RATE_LIMIT_PUBLISH` | `30` | Publishes per minute |
| `RATE_LIMIT_SUBSCRIBE` | `20` | Subscribes per minute |
| `RATE_LIMIT_CONNECTIONS` | `50` | Connections per IP |

## Architecture

```
packages/
  core/     @agora/core   — crypto, identity, object model, storage adapters
  relay/    @agora/relay   — WebSocket relay server, auth, JSONL persistence, GeoIP, relay-to-relay sync
  web/      @agora/web     — SvelteKit 5 SPA, feed/DM/network/search UI, WebRTC P2P, IndexedDB cache
landing/    — static landing page (Vercel)
```

**Data flow:** Client creates SignedObject (SHA-256 content hash + Ed25519 signature) and publishes to all connected relays. Relays validate, store, broadcast to subscribers, and sync with peer relays. Browsers forward objects to WebRTC peers via gossip.

## Tech Stack

- **Language:** TypeScript (monorepo via pnpm workspaces + Turborepo)
- **Web:** SvelteKit 5 with adapter-static, Svelte 5 runes
- **Crypto:** @noble/curves (Ed25519, X25519), @noble/hashes (SHA-256, HKDF), Web Crypto (AES-256-GCM)
- **Relay:** Node.js, ws, geoip-lite
- **Deploy:** Fly.io (relays), Vercel (web + landing)
- **P2P:** WebRTC data channels with relay-based signaling

## Features

- **Cryptographic identity** — BIP-39 mnemonic generates deterministic Ed25519 keypair, no registration
- **Self-authenticating objects** — content-addressed (SHA-256) and signed (Ed25519), verifiable without trusting any server
- **E2E encrypted DMs** — per-message ephemeral X25519 + ECDH + AES-256-GCM, forward secrecy
- **Multi-relay** — connect to multiple relays simultaneously with automatic dedup
- **Relay-to-relay sync** — relays gossip objects to each other (US + EU)
- **WebRTC P2P** — browser-to-browser data channels, works even if relays go down
- **Gossip protocol** — objects propagate through the peer mesh, validated before acceptance
- **Topic feeds** — 9 topics: General, Tech, Crypto, P2P, WW3, Memes, Art, Science, Random
- **Posts with images** — inline images via paste or file select (500KB limit)
- **Single-level replies** — click any post to view and write replies
- **Link detection** — URLs auto-rendered as clickable links
- **User profiles** — display name, bio, GeoIP location, online status
- **Search** — full-text across posts, topics, and people
- **Offline support** — IndexedDB cache + outbox queue, auto-publish on reconnect
- **Sync cursors** — reconnect fetches only new objects
- **PWA** — installable on iOS/Android, service worker caches static assets
- **Invite links** — `/join/[address]` opens DM with target user
- **Rate limiting** — per-identity and per-IP limits on publish, subscribe, and connections
- **GeoIP** — relay resolves client location, shown on network page

## Contributing

MIT License.

```bash
# Run tests (34 tests, <300ms)
pnpm --filter @agora/core test

# Build everything
pnpm build

# Dev server
pnpm --filter @agora/web dev
```

## Links

- **Landing:** https://agorap2p.com
- **App:** https://app.agorap2p.com
- **Relay US:** wss://agora-relay.fly.dev
- **Relay EU:** wss://agora-relay-eu.fly.dev
- **Source:** https://github.com/vortex-303/agora
