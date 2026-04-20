# @agorap2p/seed — Specification

> P2P network/seeder node for Agora. Joins swarms, stores signed objects, serves them to peers, publishes endpoints to the BitTorrent DHT.

## Purpose

Two modes of operation, one binary:

| Mode | Flag | Behavior |
|------|------|----------|
| **Personal seeder** | `--topics riot:user:<pk>` | Pins a user's own data (lobby, contacts) so it stays alive when they're offline. |
| **Network node** | `--seed-all` | Joins a neighborhood (XOR-assigned by peer ID), mirrors everything discovered. Contributes to the mesh. |

## Runtime Architecture

```
┌────────────────────────────────────────────────┐
│ agora-seed (node process)                      │
│                                                │
│  ┌──────────────┐    ┌──────────────────────┐  │
│  │ SwarmNode    │◄──►│ TrackerSwarm (per    │  │
│  │ (EventEmitter)│   │  topic, WebRTC peers)│  │
│  └──────┬───────┘    └──────────────────────┘  │
│         │                                      │
│         ▼                                      │
│  ┌──────────────┐    ┌──────────────────────┐  │
│  │ ObjectStore  │    │ DHTPublisher         │  │
│  │ (EventEmitter)│   │ (BitTorrent DHT +    │  │
│  │  jsonl-backed│    │  riot:profile:<pk>)  │  │
│  └──────┬───────┘    └──────────────────────┘  │
│         │                                      │
│         ▼                                      │
│  ┌──────────────┐    ┌──────────────────────┐  │
│  │ Dashboard    │    │ TUI (optional --tui) │  │
│  │ :9876 (HTTP) │    │ stdout ANSI redraw   │  │
│  └──────────────┘    └──────────────────────┘  │
└────────────────────────────────────────────────┘
```

## Wire Protocol (unchanged — network-visible)

These strings MUST stay stable; changing them forks the network:

| Element | Value |
|---------|-------|
| Swarm topic — user feed | `riot:user:<pubkey>` |
| Swarm topic — DM pair | `riot:dm:<sorted(pkA,pkB)>` |
| Swarm topic — global | `riot:global` |
| DHT key for peer endpoint | `sha1("riot:profile:" + pubkey)` |
| WebRTC data channel label | `riot` |
| libdatachannel PeerConnection identity | `riot-seed` |
| Tracker | `wss://tracker.openwebtorrent.com` |

> "Agora" is the user-facing product name; `riot:` prefixes are the stable on-wire identifiers inherited from the project's early codename. Do not rename.

## Events (internal API)

`SwarmNode extends EventEmitter`:

| Event | Payload | Fired when |
|-------|---------|-----------|
| `peer` | `{ peerId, at }` | WebRTC data channel opens to a new peer. |
| `served` | `{ peerId, author, count, bytes, ids[], at }` | Peer requested objects via watermark sync and we replied. |

`ObjectStore extends EventEmitter`:

| Event | Payload | Fired when |
|-------|---------|-----------|
| `new-object` | the object | An object passes dedup and lands in the store. |
| `new-author` | `{ author, firstObject }` | First object ever seen from an author. |

The TUI (`src/tui.mjs`) consumes these and drives its three panels.

## CLI

```
agora-seed [options]

  --seed-all                Network-node mode (XOR neighborhood)
  --topics <list>           Personal mode — comma-separated swarm topics
  --tui                     Live terminal dashboard
  --data <dir>              Data directory (default: ~/.agora-seed)
  --port <n>                HTTP dashboard port (default: 9876)
  --budget <MB>             Storage cap (default: 2048)
  --help                    Show usage
```

### Data directory layout

```
~/.agora-seed/
  objects.jsonl    append-only log of all SignedObjects
```

Back-compat: if `~/.agora-seed/` does not exist but `~/.riot-seed/` does, the legacy dir is used automatically (pre-rename installs).

## HTTP dashboard

Listens on `127.0.0.1:<port>`, default 9876.

| Route | Returns |
|-------|---------|
| `GET /` | HTML dashboard (auto-refresh every 5s) |
| `GET /api/stats` | `{ peers, swarms, objects, authors, served, received, storageMB, topics[], neighborhood, dht }` |
| `GET /api/objects?type=&author=&limit=` | Recent objects (metadata only) |
| `GET /api/authors` | `[ { author, maxSeq, count } ]` |

## TUI (`--tui`)

ANSI-redraw terminal UI, no `ink`/`blessed` dependency. Three panels:

1. **Header stats** — peers, swarms, DHT nodes, neighborhood, objects, served, authors, disk, bandwidth (↓ in / ↑ out, 1-second sample window).
2. **Files served** — last 10 `served` events: age, object hash, peer, bytes, author.
3. **New accounts seen** — last 10 `new-author` events: age, pubkey, object type.

Suppresses `console.log` / `console.warn` while active; HTTP dashboard remains available. Ctrl-C restores the cursor and saves the store.

## Storage model

- JSONL append-only at `<data>/objects.jsonl`.
- Dedup keyed by `SignedObject.id` (`sha256(canonicalJSON(body))`).
- On budget overflow: evict oldest 20% of objects **outside** the local neighborhood.
- Neighborhood prefix: first 4 hex chars of `sha1(peerId)` (only when `--seed-all`).
- Watermarks: `authorSeq` map tracks max seq per author for efficient pull-sync.

## Distribution

Two artifacts, one codebase:

| Channel | Command |
|---------|---------|
| npm | `npx -y @agorap2p/seed --seed-all --tui` |
| Docker | `docker run --rm -it -v agora-seed:/data -p 9876:9876 ghcr.io/vortex-303/agora-seed --seed-all --tui` |

### Docker image

- Base: `node:22-bookworm-slim` (build + runtime)
- Build stage installs `python3 make g++ cmake git` for native `node-datachannel` fallback
- Runtime: non-root `agora` user, `tini` as PID 1, volume `/data`, EXPOSE 9876
- Default `CMD`: `--seed-all --data /data`

### Native dependency note

`node-datachannel` ships prebuilt binaries for linux-x64/arm64, macos-x64/arm64, win-x64 on Node 20/22. On other platforms, the postinstall compiles from source (cmake required).

## Non-goals

- Mobile clients (browser/extension handle that).
- Content moderation (handled by the community layer above the mesh).
- Storage of unsigned data — every object must be a valid `SignedObject`.
