#!/usr/bin/env node

import { existsSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { SwarmNode } from './swarm-node.mjs';
import { ObjectStore } from './store.mjs';
import { startDashboard } from './dashboard.mjs';
import { DHTPublisher } from './dht-publisher.mjs';
import { startTUI } from './tui.mjs';

const args = process.argv.slice(2);
let topics = [];
const HOME = homedir() || '.';
const LEGACY_DIR = join(HOME, '.riot-seed');
const DEFAULT_DIR = join(HOME, '.agora-seed');
// Preserve existing local data from pre-rename installs.
let dataDir = existsSync(DEFAULT_DIR) || !existsSync(LEGACY_DIR) ? DEFAULT_DIR : LEGACY_DIR;
let port = 9876;
let budgetMB = 2048;
let seedAll = false;
let tuiMode = false;

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--topics' && args[i + 1]) {
    topics = args[i + 1].split(',').map(t => t.trim()).filter(Boolean);
    i++;
  } else if (args[i] === '--data' && args[i + 1]) {
    dataDir = args[i + 1];
    i++;
  } else if (args[i] === '--port' && args[i + 1]) {
    port = parseInt(args[i + 1]);
    i++;
  } else if (args[i] === '--budget' && args[i + 1]) {
    budgetMB = parseInt(args[i + 1]);
    i++;
  } else if (args[i] === '--seed-all') {
    seedAll = true;
  } else if (args[i] === '--tui') {
    tuiMode = true;
  } else if (args[i] === '--help' || args[i] === '-h') {
    console.log(`
agora-seed — P2P network node for Agora

Usage:
  agora-seed --topics riot:user:<pubkey>
  agora-seed --topics riot:user:<pubkey> --seed-all
  agora-seed --seed-all --budget 4096 --tui

Options:
  --topics <list>   Comma-separated swarm topics to seed
  --seed-all        Seed all content discovered from peers (network node)
  --data <dir>      Data directory (default: ~/.agora-seed)
  --port <num>      Dashboard port (default: 9876)
  --budget <MB>     Storage budget in MB (default: 2048)
  --tui             Live terminal dashboard (network, files served, new accounts)
  --help            Show this help

Modes:
  Personal:  --topics riot:user:YOUR_KEY
             Seeds your lobby + contacts. Your data stays alive.

  Node:      --seed-all
             Seeds everything you discover. You're a network node.
             Stores data for your XOR neighborhood (auto-assigned).
`);
    process.exit(0);
  }
}

if (topics.length === 0 && !seedAll) {
  console.error('Error: --topics or --seed-all required. Use --help for usage.');
  process.exit(1);
}

if (!existsSync(dataDir)) mkdirSync(dataDir, { recursive: true });

const startTime = Date.now();
const store = new ObjectStore(dataDir, { budgetMB });
await store.load();

const node = new SwarmNode(store);

// If seed-all mode, compute our neighborhood from our peer ID
if (seedAll) {
  const myHash = createHash('sha1').update(node.peerId).digest('hex');
  store.setNeighborhood(myHash);
  console.log(`[agora-seed] Network node mode — neighborhood prefix: ${myHash.slice(0, 4)}`);
}

// Join explicit topics
for (const topic of topics) {
  node.joinSwarm(topic);
}

// Auto-discover swarms from stored objects
function discoverSwarms() {
  // DM swarms
  const dmPairs = store.getDMPairs();
  for (const pair of dmPairs) {
    node.joinSwarm(`riot:dm:${pair}`);
  }

  // User swarms from stored authors
  if (seedAll) {
    const authors = store.getAuthorStats();
    for (const a of authors) {
      node.joinSwarm(`riot:user:${a.author}`);
    }
  }
}

discoverSwarms();

// Join global swarm if seed-all
if (seedAll) {
  node.joinSwarm('riot:global');
}

const totalTopics = node.getTopics().length;
const dmCount = store.getDMPairs().length;

console.log(`\n[agora-seed] Seeding ${totalTopics} swarm(s)`);
console.log(`[agora-seed] Data dir: ${dataDir}`);
console.log(`[agora-seed] Budget: ${budgetMB}MB`);
console.log(`[agora-seed] Objects stored: ${store.count()}`);
console.log(`[agora-seed] Authors hosted: ${store.getAuthorCount()}`);

// Start DHT publisher
const dhtPublisher = new DHTPublisher(store);
await dhtPublisher.start();

// Start dashboard
startDashboard(port, store, node, startTime, dhtPublisher);

console.log(`[agora-seed] Press Ctrl+C to stop\n`);

// Periodically discover new swarms
setInterval(() => {
  discoverSwarms();
}, 60_000);

let tui = null;
if (tuiMode) {
  // Suppress chatty console output once the TUI owns the screen.
  console.log = () => {};
  console.warn = () => {};
  tui = startTUI({
    store, node, dhtPublisher, startTime, port, dataDir, budgetMB,
    mode: seedAll ? 'network node' : 'personal',
  });
} else {
  setInterval(() => {
    const stats = node.getStats();
    console.log(`[agora-seed] peers:${stats.peers} objects:${store.count()} served:${stats.served} received:${stats.received} swarms:${stats.swarms}`);
  }, 30_000);
}

async function shutdown() {
  if (tui) tui.stop();
  else console.log('\n[agora-seed] Shutting down...');
  node.destroy();
  await dhtPublisher.destroy();
  store.save();
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
