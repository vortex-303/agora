#!/usr/bin/env node

import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { SwarmNode } from './swarm-node.mjs';
import { ObjectStore } from './store.mjs';
import { startDashboard } from './dashboard.mjs';

const args = process.argv.slice(2);
let topics = [];
let dataDir = join(process.env.HOME || '.', '.riot-seed');
let port = 9876;
let budgetMB = 2048;
let seedAll = false;

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
  } else if (args[i] === '--help' || args[i] === '-h') {
    console.log(`
riot-seed — P2P network node for Riot

Usage:
  riot-seed --topics riot:user:<pubkey>
  riot-seed --topics riot:user:<pubkey> --seed-all
  riot-seed --seed-all --budget 4096

Options:
  --topics <list>   Comma-separated swarm topics to seed
  --seed-all        Seed all content discovered from peers (network node)
  --data <dir>      Data directory (default: ~/.riot-seed)
  --port <num>      Dashboard port (default: 9876)
  --budget <MB>     Storage budget in MB (default: 2048)
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
  console.log(`[riot-seed] Network node mode — neighborhood prefix: ${myHash.slice(0, 4)}`);
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

console.log(`\n[riot-seed] Seeding ${totalTopics} swarm(s)`);
console.log(`[riot-seed] Data dir: ${dataDir}`);
console.log(`[riot-seed] Budget: ${budgetMB}MB`);
console.log(`[riot-seed] Objects stored: ${store.count()}`);
console.log(`[riot-seed] Authors hosted: ${store.getAuthorCount()}`);

// Start dashboard
startDashboard(port, store, node, startTime);

console.log(`[riot-seed] Press Ctrl+C to stop\n`);

// Periodically discover new swarms + log stats
setInterval(() => {
  discoverSwarms();
}, 60_000);

setInterval(() => {
  const stats = node.getStats();
  console.log(`[riot-seed] peers:${stats.peers} objects:${store.count()} served:${stats.served} received:${stats.received} swarms:${stats.swarms}`);
}, 30_000);

process.on('SIGINT', () => {
  console.log('\n[riot-seed] Shutting down...');
  node.destroy();
  store.save();
  process.exit(0);
});

process.on('SIGTERM', () => {
  node.destroy();
  store.save();
  process.exit(0);
});
