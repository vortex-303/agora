/**
 * Agora Extension — Background Service Worker
 *
 * Maintains WebSocket connections to relays, stores objects in IndexedDB,
 * and keeps the node alive even when the Agora tab is closed.
 */

const RELAYS = [
  'wss://agora-relay.fly.dev',
  'wss://agora-relay-eu.fly.dev',
];

const DB_NAME = 'agora_extension';
const DB_VERSION = 1;
const STORE_NAME = 'objects';
const RECONNECT_ALARM = 'agora-reconnect';
const STATS_KEY = 'agora_stats';

// State
let connections = new Map(); // url → WebSocket
let objectCount = 0;
let lastObjectTime = 0;

// --- IndexedDB ---
function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onerror = () => reject(req.error);
    req.onsuccess = () => resolve(req.result);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
        store.createIndex('timestamp', 'body.timestamp');
        store.createIndex('author_seq', ['body.author', 'body.seq']);
      }
    };
  });
}

async function storeObject(obj) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put(obj);
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => reject(tx.error);
  });
}

async function hasObject(id) {
  const db = await openDB();
  return new Promise((resolve) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const req = tx.objectStore(STORE_NAME).count(id);
    req.onsuccess = () => resolve(req.result > 0);
  });
}

async function getObjectCount() {
  const db = await openDB();
  return new Promise((resolve) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const req = tx.objectStore(STORE_NAME).count();
    req.onsuccess = () => resolve(req.result);
  });
}

// --- WebSocket ---
function connectToRelay(url) {
  if (connections.has(url)) {
    const existing = connections.get(url);
    if (existing.readyState === WebSocket.OPEN || existing.readyState === WebSocket.CONNECTING) return;
  }

  console.log(`[Agora] Connecting to ${url}`);
  const ws = new WebSocket(url);
  connections.set(url, ws);

  ws.onopen = () => {
    console.log(`[Agora] Connected to ${url}`);
    // Subscribe to all objects (no auth needed for sync subscriber)
    ws.send(JSON.stringify({ action: 'relay_sync', mode: 'subscribe' }));
    updateBadge();
  };

  ws.onmessage = async (event) => {
    try {
      const msg = JSON.parse(event.data);
      if (msg.action === 'relay_sync_object' && msg.object) {
        const obj = msg.object;
        const exists = await hasObject(obj.id);
        if (!exists) {
          await storeObject(obj);
          objectCount++;
          lastObjectTime = Date.now();
          // Update badge every 10 objects
          if (objectCount % 10 === 0) updateBadge();
        }
      }
    } catch { /* ignore */ }
  };

  ws.onclose = () => {
    console.log(`[Agora] Disconnected from ${url}`);
    connections.delete(url);
    updateBadge();
    // Reconnect via alarm
    chrome.alarms.create(RECONNECT_ALARM, { delayInMinutes: 0.5 });
  };

  ws.onerror = () => { /* onclose will fire */ };
}

function connectAll() {
  for (const url of RELAYS) {
    connectToRelay(url);
  }
}

// --- Badge ---
async function updateBadge() {
  const count = await getObjectCount();
  objectCount = count;
  const connected = [...connections.values()].filter(ws => ws.readyState === WebSocket.OPEN).length;

  chrome.action.setBadgeText({ text: connected > 0 ? String(count) : '!' });
  chrome.action.setBadgeBackgroundColor({ color: connected > 0 ? '#f97316' : '#ef4444' });

  // Save stats for popup
  chrome.storage.local.set({
    [STATS_KEY]: {
      objectCount: count,
      connectedRelays: connected,
      totalRelays: RELAYS.length,
      lastObjectTime,
      updatedAt: Date.now(),
    }
  });
}

// --- Alarms ---
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === RECONNECT_ALARM) {
    connectAll();
  }
});

// Keep alive: reconnect every 4 minutes (MV3 service worker timeout is 5 min)
chrome.alarms.create('agora-keepalive', { periodInMinutes: 4 });
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'agora-keepalive') {
    connectAll();
    updateBadge();
  }
});

// --- Init ---
console.log('[Agora] Extension background starting');
connectAll();
updateBadge();
