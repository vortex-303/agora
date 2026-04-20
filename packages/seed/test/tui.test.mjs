// Smoke test: drive TUI with fake store/node, capture ANSI output, assert panels render.
import { EventEmitter } from 'node:events';
import { startTUI } from '../src/tui.mjs';
import assert from 'node:assert/strict';

const captured = [];
const origWrite = process.stdout.write.bind(process.stdout);
process.stdout.write = (s) => { captured.push(s); return true; };

class FakeStore extends EventEmitter {
  constructor() { super(); this._count = 0; }
  count() { return this._count; }
  getStorageSize() { return 1024 * 1024 * 3; }
  getAuthorCount() { return 2; }
  getNeighborhoodStats() { return { prefix: 'all', inNeighborhood: this._count, outside: 0 }; }
}

class FakeNode extends EventEmitter {
  constructor() { super(); this.served = 0; this.received = 0; }
  getStats() { return { peers: 1, swarms: 2, served: this.served, received: this.received }; }
}

const store = new FakeStore();
const node = new FakeNode();
const dhtPublisher = { getStats: () => ({ dhtNodes: 42 }) };
const startTime = Date.now() - 65_000;

const tui = startTUI({
  store, node, dhtPublisher, startTime, port: 9876,
  dataDir: '/tmp/xxx', budgetMB: 2048, mode: 'network node',
});

// Fire events
store._count = 5;
node.received = 10;
store.emit('new-object', { id: 'deadbeef', body: { author: 'pk_alice', type: 'post' } });
store.emit('new-author', { author: 'pk_alice1234567890', firstObject: { body: { type: 'post' } } });
store.emit('new-author', { author: 'pk_bob_xxxxxxxxxxxx', firstObject: { body: { type: 'profile' } } });
node.served = 3;
node.emit('served', {
  peerId: 'peer_abcd1234',
  author: 'pk_alice1234567890',
  count: 3,
  bytes: 4096,
  ids: ['obj_hash_aaa', 'obj_hash_bbb', 'obj_hash_ccc'],
  at: Date.now(),
});
node.emit('peer', { peerId: 'peer_abcd1234', at: Date.now() });

// Let timers tick; but we don't need to wait — render happens synchronously.
tui.render();
tui.stop();

process.stdout.write = origWrite;

const out = captured.join('');
assert.ok(out.includes('agora'), 'header renders');
assert.ok(out.includes('network node'), 'mode renders');
assert.ok(out.includes('peers'), 'peers label');
assert.ok(out.includes('files served'), 'files-served panel');
assert.ok(out.includes('new accounts seen'), 'new-accounts panel');
assert.ok(out.includes('pk_alice'), 'new author shown');
assert.ok(out.includes('peer_abc'), 'served peer id shown');
assert.ok(out.includes('4.0KB') || out.includes('4.0 KB') || out.includes('4096'), 'served bytes shown');
assert.ok(out.includes('DHT'), 'DHT label');

console.log('TUI smoke test: OK — captured', captured.length, 'frames,', out.length, 'bytes');
