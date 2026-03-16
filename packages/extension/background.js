/**
 * Agora Extension — Background Service Worker
 * Maintains relay connections, stores objects, persists across tab close.
 */

const RELAYS = [
  'wss://agora-relay.fly.dev',
  'wss://agora-relay-eu.fly.dev',
];

const DB_NAME = 'agora_extension';
const DB_VERSION = 1;
const STORE_NAME = 'objects';
const STATS_KEY = 'agora_stats';

let connections = new Map();
let objectCount = 0;

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
      }
    };
  });
}

async function storeObject(obj) {
  try {
    const db = await openDB();
    return new Promise((resolve) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).put(obj);
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => resolve(false);
    });
  } catch { return false; }
}

async function getObjectCount() {
  try {
    const db = await openDB();
    return new Promise((resolve) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const req = tx.objectStore(STORE_NAME).count();
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(0);
    });
  } catch { return 0; }
}

// --- WebSocket ---
function connectToRelay(url) {
  if (connections.has(url)) {
    const ws = connections.get(url);
    if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) return;
  }

  console.log(`[Agora] Connecting to ${url}`);

  try {
    const ws = new WebSocket(url);
    connections.set(url, ws);

    ws.onopen = () => {
      console.log(`[Agora] Connected to ${url}, subscribing to sync...`);
      ws.send(JSON.stringify({ action: 'relay_sync', mode: 'subscribe' }));
      saveStats();
    };

    ws.onmessage = async (event) => {
      try {
        const msg = JSON.parse(event.data);

        if (msg.action === 'relay_sync_object' && msg.object) {
          const stored = await storeObject(msg.object);
          if (stored) {
            objectCount++;
            if (objectCount % 20 === 0) saveStats();
          }
        }

        if (msg.action === 'relay_sync_ready') {
          console.log(`[Agora] Synced ${msg.count} objects from ${url}`);
          saveStats();
        }

        if (msg.action === 'error') {
          console.warn(`[Agora] Relay error: ${msg.message}`);
        }
      } catch { /* ignore malformed */ }
    };

    ws.onclose = () => {
      console.log(`[Agora] Disconnected from ${url}`);
      connections.delete(url);
      saveStats();
    };

    ws.onerror = () => { /* onclose fires after */ };
  } catch (e) {
    console.error(`[Agora] Failed to connect to ${url}:`, e);
  }
}

function connectAll() {
  for (const url of RELAYS) {
    connectToRelay(url);
  }
}

// --- Stats ---
async function saveStats() {
  const count = await getObjectCount();
  objectCount = count;
  const connected = [...connections.values()].filter(ws => ws.readyState === WebSocket.OPEN).length;

  try {
    chrome.action.setBadgeText({ text: count > 0 ? String(count) : '' });
    chrome.action.setBadgeBackgroundColor({ color: connected > 0 ? '#f97316' : '#ef4444' });
  } catch { /* badge API may not be ready */ }

  try {
    chrome.storage.local.set({
      [STATS_KEY]: {
        objectCount: count,
        connectedRelays: connected,
        totalRelays: RELAYS.length,
        updatedAt: Date.now(),
      }
    });
  } catch { /* storage may not be ready */ }
}

// --- Keep alive ---
chrome.alarms.create('agora-keepalive', { periodInMinutes: 4 });
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'agora-keepalive') {
    console.log('[Agora] Keepalive tick');
    connectAll();
    saveStats();
  }
});

// --- Init ---
console.log('[Agora] Extension starting');
connectAll();
setTimeout(saveStats, 3000);
