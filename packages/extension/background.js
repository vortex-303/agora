/**
 * Riot Extension — Background Service Worker
 * Uses fetch polling since MV3 service workers don't support WebSocket reliably.
 */

const RELAYS = [
  'https://agora-relay.fly.dev',
  'https://agora-relay-eu.fly.dev',
];

const DB_NAME = 'agora_extension';
const DB_VERSION = 1;
const STORE_NAME = 'objects';
const STATS_KEY = 'agora_stats';

let objectCount = 0;
let connectedRelays = 0;

// --- IndexedDB ---
function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onerror = () => reject(req.error);
    req.onsuccess = () => resolve(req.result);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' });
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

// --- Health polling (works in MV3 service workers) ---
async function pollRelay(url) {
  try {
    const res = await fetch(`${url}/health`, { signal: AbortSignal.timeout(5000) });
    if (res.ok) {
      const data = await res.json();
      return data;
    }
  } catch { /* offline */ }
  return null;
}

async function syncFromRelays() {
  let connected = 0;
  let totalObjects = 0;

  for (const url of RELAYS) {
    const health = await pollRelay(url);
    if (health) {
      connected++;
      totalObjects += health.objects || 0;
    }
  }

  connectedRelays = connected;
  objectCount = await getObjectCount();

  // If we have fewer objects than relay, we need to sync
  // For now, store the relay stats — full sync happens via the web app
  await saveStats(totalObjects);
}

// --- Stats ---
async function saveStats(relayObjects) {
  const count = await getObjectCount();
  objectCount = count;

  try {
    chrome.action.setBadgeText({ text: connectedRelays > 0 ? String(count || relayObjects || '0') : '!' });
    chrome.action.setBadgeBackgroundColor({ color: connectedRelays > 0 ? '#f97316' : '#ef4444' });
  } catch {}

  try {
    chrome.storage.local.set({
      [STATS_KEY]: {
        objectCount: count,
        relayObjects: relayObjects || 0,
        connectedRelays,
        totalRelays: RELAYS.length,
        updatedAt: Date.now(),
      }
    });
  } catch {}
}

// --- Alarms ---
chrome.alarms.create('agora-sync', { periodInMinutes: 1 });
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'agora-sync') {
    syncFromRelays();
  }
});

// --- Messages from web app (if same origin or via content script) ---
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.action === 'store_objects' && msg.objects) {
    (async () => {
      let stored = 0;
      for (const obj of msg.objects) {
        const ok = await storeObject(obj);
        if (ok) stored++;
      }
      objectCount += stored;
      await saveStats();
      sendResponse({ stored });
    })();
    return true; // async response
  }
  if (msg.action === 'get_stats') {
    getObjectCount().then(count => {
      sendResponse({ objectCount: count, connectedRelays, totalRelays: RELAYS.length });
    });
    return true;
  }
});

// --- Init ---
console.log('[Riot] Extension starting — polling mode');
syncFromRelays();
