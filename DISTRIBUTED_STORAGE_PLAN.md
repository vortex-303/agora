# Distributed Storage Plan — Making Relays Optional

> The goal: relay becomes less and less needed as active users grow. Data is always safe. Mathematically guaranteed.

## The Problem

Browser storage is ephemeral. User clears cache → data gone. All browsers close at 3am → data exists only on relay disk. Browser-as-storage adds redundancy while browsers are open, but doesn't solve persistence when everyone sleeps.

## Architecture Layers

```
Layer 1: Relays (always-on servers)          ← exists today
Layer 2: Browser swarm (open tabs)           ← Phase A
Layer 3: Persistent peers (dedicated nodes)  ← Phase C
```

## Data Safety Math

```
Data safety = f(copies)

1 copy  (relay only)           → single point of failure
2 copies (relay + 1 peer)      → survives 1 failure
5 copies (relay + 4 peers)     → practically safe
20 copies (relay + 19 peers)   → relay is redundant
```

Every object needs N copies where the probability of ALL N being offline simultaneously is negligible. With 20 persistent peers across timezones, probability of total data loss ≈ 0.

## Phases

### Phase A: Browser Pull-Sync
**Status: Next to build**

What: Browsers pull missing objects from WebRTC peers, not just relay.

How:
1. On WebRTC peer connect, exchange "watermarks" — latest seq per author, or bloom filter of object IDs
2. Identify what each peer is missing
3. Pull missing objects via WebRTC data channel
4. Validate signature + hash on receipt (already in gossip code)
5. Store in IndexedDB (already happening)

Benefit:
- Feed loads faster (peers respond before relays)
- Works during relay outages while tabs are open
- Conference/LAN scenario: zero internet needed

Code impact: ~200 lines on top of existing gossip + WebRTC infrastructure.

Relay role: Still primary data source. Peers are supplementary.

### Phase B: Replication Counting
**Status: Planned**

What: Track how many copies of each object exist across the network.

How:
1. Each node (relay, browser, persistent peer) periodically advertises what it has
2. A lightweight protocol: `{ action: "have", authors: { "pubkey": maxSeq, ... } }`
3. Any node can calculate: "object X exists on N nodes"
4. If replication drops below threshold (e.g., 3), nodes that have the object proactively push to peers

Benefit:
- Mathematical guarantee of data safety
- Not "we hope someone has it" but "the system ensures N copies exist"
- Automatic rebalancing when nodes join/leave

Code impact: ~300 lines. New wire message type + replication monitor.

Relay role: One of many storage nodes. Special only because it's always-on.

### Phase C: Persistent Peers
**Status: Planned**

What: Lightweight background processes that store + serve objects 24/7. NOT a full relay — no HTTP, no auth for publishers, just storage + serving.

How:
1. Tiny Node.js script: `npx @agora/peer`
2. Connects to relays via WebSocket (reuses existing sync protocol)
3. Stores objects on disk (JSONL, same as relay)
4. Serves objects to browsers that request via WebRTC or WebSocket
5. Runs on Raspberry Pi, VPS, old laptop, Docker, anywhere Node.js runs

Benefit:
- Data persists even when all browsers are closed
- Much lighter than a relay (no auth, no subscriptions, no HTTP serving)
- Anyone can run one — no Fly.io account, no domain, no SSL
- Raspberry Pi = $35 permanent storage node

Code impact: ~400 lines. New package `@agora/peer`.

Relay role: One storage node among many. Could go offline for hours with no impact.

### Phase D: Relay as Bootstrap Only
**Status: Future**

What: Relay does nothing except help new users discover peers. All data flows P2P.

How:
1. New user connects to relay, gets peer list
2. Pulls all data from peers
3. Relay stores nothing long-term
4. Eventually even discovery can use hardcoded peer lists or DHT

Benefit:
- Relay is trivially cheap to run (just WebSocket signaling)
- Network survives relay operator disappearing entirely
- True decentralization — no infrastructure dependency

Relay role: Signaling server only. Optional if you know a peer's address.

## Why This Works (Not Hand-Wavy)

1. **Objects are self-authenticating.** `id = SHA-256(body)`, `sig = Ed25519(body, author)`. Any node can verify any object. A malicious node can withhold data but cannot fabricate it.

2. **Content addressing = natural dedup.** Same object on 20 nodes has the same hash. No coordination needed to detect duplicates.

3. **Sequence numbers = efficient sync.** "Give me author X after seq 47" works against any node — relay, browser, or persistent peer. No need to exchange full hash sets.

4. **No consensus required.** An object is valid if the signature checks out. Period. No voting, no finality, no chain. This is why we don't need a blockchain.

5. **Replication is automatic.** Every browser that opens the app and loads the feed becomes a storage node. The more popular the network, the more redundant the data. Growth = safety.

## Why This Is NOT a Blockchain

| Property | Blockchain | Agora Distributed Storage |
|----------|-----------|--------------------------|
| Consensus | Required (PoW/PoS/BFT) | Not needed — signatures are self-validating |
| Global state | Single agreed-upon state | No global state — each author has independent feed |
| Incentives | Tokens/mining | None — you participate because you use the network |
| Finality | Blocks are "final" after N confirmations | Objects are valid immediately (signature check) |
| Cost | Gas fees, mining hardware | Zero — storage is a side effect of using the app |
| Ordering | Total order across all transactions | Per-author ordering only (seq numbers) |

## User Experience

**What users see:**
- Badge: "Contributing 4.2MB · 340 objects · 3 peers"
- Setting: "Network contribution: On/Off" (default: On)
- Status: "Connected to relay + 5 peers" → "Relay offline, connected to 5 peers" (no disruption)
- Feed loads faster (nearest peer responds first)

**What it costs users:**
- ~5-20MB IndexedDB (already being used for cache)
- Negligible bandwidth (objects are 1-5KB, served on request)
- Minimal battery impact (WebRTC data channels are lightweight)

## Scaling Curve

```
10 users    → relay essential, 2-3 online peers help
100 users   → relay + 20-30 online peers, meaningful redundancy
1,000 users → relay is one of hundreds of nodes, could disappear
10,000 users → relay is irrelevant, data exists everywhere
```

## Implementation Order

1. **Phase A** — browser pull-sync (~200 lines, builds on existing WebRTC/gossip)
2. **Contribution UI** — show users what they're contributing (~50 lines)
3. **Phase B** — replication counting (~300 lines)
4. **Phase C** — persistent peer package (~400 lines)
5. **Phase D** — relay demotion (configuration change, minimal code)

Total estimated code: ~950 lines to go from relay-dependent to relay-optional.
