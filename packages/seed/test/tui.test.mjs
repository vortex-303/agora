// Smoke test: drive data aggregation with a fake store/node, then render the
// Dashboard component via ink-testing-library and assert panel content.
import { EventEmitter } from 'node:events';
import React from 'react';
import htm from 'htm';
import { render } from 'ink-testing-library';
import assert from 'node:assert/strict';
import { startTUI, Dashboard } from '../src/tui.mjs';

const html = htm.bind(React.createElement);

class FakeStore extends EventEmitter {
  constructor() { super(); this._count = 0; }
  count() { return this._count; }
  getStorageSize() { return 1024 * 1024 * 3; }
  getAuthorCount() { return 2; }
  getNeighborhoodStats() { return { prefix: '1a2b', inNeighborhood: this._count, outside: 0 }; }
}

class FakeNode extends EventEmitter {
  constructor() {
    super();
    this.served = 0;
    this.received = 0;
    this.peerId = Array.from({ length: 20 }, (_, i) => String.fromCharCode(i + 1)).join('');
  }
  getStats() { return { peers: 1, swarms: 2, served: this.served, received: this.received }; }
}

const store = new FakeStore();
const node = new FakeNode();
const dhtPublisher = { getStats: () => ({ dhtNodes: 42 }) };
const startTime = Date.now() - 65_000;

// Stub out render during startTUI so we don't mount a real app in the test.
// We rely on the exported test hooks (_sample, _snapshot, _topAuthors) and the
// Dashboard component to verify output.
const origStdoutWrite = process.stdout.write.bind(process.stdout);
process.stdout.write = () => true;

const tui = startTUI({
  store, node, dhtPublisher, startTime, port: 9876,
  dataDir: '/tmp/agora-seed-test', budgetMB: 2048, mode: 'network node',
  trackers: ['wss://tracker.openwebtorrent.com'],
});

// Drive events.
store._count = 5;
node.received = 10;
store.emit('new-object', { id: 'deadbeef', body: { author: 'pk_alice', type: 'post' } });
node.served = 3;
node.emit('served', {
  peerId: 'peer_abcd1234',
  author: 'pk_alice1234567890',
  count: 3,
  bytes: 4096,
  ids: ['a', 'b', 'c'],
  at: Date.now(),
});
node.emit('served', {
  peerId: 'peer_abcd1234',
  author: 'pk_bob_xxxxxxxxxxxx',
  count: 1,
  bytes: 1024,
  at: Date.now(),
});

tui._sample();
tui._sample();

const snapshot = tui._snapshot();
const topAuthors = tui._topAuthors();
const identity = {
  version: '0.1.0',
  mode: 'network node',
  fp: 'e2a91b7c',
  port: 9876,
  dataDir: '/tmp/agora-seed-test',
  trackers: ['wss://tracker.openwebtorrent.com'],
};

tui.stop();
process.stdout.write = origStdoutWrite;

const { lastFrame } = render(
  html`<${Dashboard} snapshot=${snapshot} identity=${identity} topAuthors=${topAuthors}/>`
);
const out = lastFrame();

// Header
assert.ok(out.includes('agora'), 'header: agora');
assert.ok(out.includes('.seed'), 'header: .seed');
assert.ok(out.includes('v0.1.0'), 'header: version');
assert.ok(out.includes('network node'), 'header: mode');
assert.ok(out.includes('e2a91b7c'), 'header: fingerprint');
assert.ok(out.includes(':9876'), 'header: port');

// Panels
assert.ok(out.includes('node'), 'panel: node');
assert.ok(out.includes('throughput'), 'panel: throughput');
assert.ok(out.includes('network'), 'panel: network');
assert.ok(out.includes('neighborhood'), 'panel: neighborhood');
assert.ok(out.includes('top authors served'), 'panel: top authors served');

// No scrolling activity feed remains
assert.ok(!out.includes('activity'), 'activity feed removed');
assert.ok(!out.includes('connected'), 'no peer-up line');
assert.ok(!out.includes('dropped'), 'no peer-drop line');

// Network stats render
assert.ok(out.includes('peers'), 'stat: peers');
assert.ok(out.includes('swarms'), 'stat: swarms');
assert.ok(out.includes('objects'), 'stat: objects');
assert.ok(out.includes('authors'), 'stat: authors');
assert.ok(out.includes('served'), 'stat: served');
assert.ok(out.includes('received'), 'stat: received');

// Neighborhood
assert.ok(out.includes('1a2b'), 'neighborhood prefix');
assert.ok(out.includes('2048MB'), 'budget rendered');
assert.ok(out.includes('42 nodes'), 'DHT nodes');

// Throughput sparklines
assert.ok(out.includes('↓ in'), 'throughput: in label');
assert.ok(out.includes('↑ out'), 'throughput: out label');
assert.ok(out.includes('/s'), 'throughput: rate suffix');

// Top authors aggregation — alice (3) outranks bob (1)
const aliceIdx = out.indexOf('pk_alice');
const bobIdx = out.indexOf('pk_bob');
assert.ok(aliceIdx !== -1, 'top authors: alice shown');
assert.ok(bobIdx !== -1, 'top authors: bob shown');
assert.ok(aliceIdx < bobIdx, 'top authors: alice outranks bob');

// Footer
assert.ok(out.includes('http://localhost:9876'), 'footer: dashboard link');
assert.ok(out.includes('ctrl+c'), 'footer: ctrl+c hint');

console.log('TUI smoke test: OK —', out.length, 'bytes rendered');
