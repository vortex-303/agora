import { generateIdentity, restoreIdentity, type Identity, toBase64, fromBase64 } from '@agora/core';

const DB_NAME = 'agora_identity';
const DB_VERSION = 1;
const STORE_NAME = 'keys';
const KEY_ID = 'identity';

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
  });
}

interface StoredIdentity {
  publicKeyBase64: string;
  privateKeyBase64: string;
  mnemonic: string;
}

export async function loadIdentity(): Promise<Identity | null> {
  try {
    const db = await openDB();
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const request = store.get(KEY_ID);
    const result = await new Promise<StoredIdentity | undefined>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    db.close();

    if (!result) return null;

    return {
      publicKey: fromBase64(result.publicKeyBase64),
      privateKey: fromBase64(result.privateKeyBase64),
      publicKeyBase64: result.publicKeyBase64,
      mnemonic: result.mnemonic,
    };
  } catch {
    return null;
  }
}

export async function saveIdentity(identity: Identity): Promise<void> {
  const stored: StoredIdentity = {
    publicKeyBase64: identity.publicKeyBase64,
    privateKeyBase64: toBase64(identity.privateKey),
    mnemonic: identity.mnemonic,
  };
  const db = await openDB();
  const tx = db.transaction(STORE_NAME, 'readwrite');
  tx.objectStore(STORE_NAME).put(stored, KEY_ID);
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

export async function clearIdentity(): Promise<void> {
  const db = await openDB();
  const tx = db.transaction(STORE_NAME, 'readwrite');
  tx.objectStore(STORE_NAME).delete(KEY_ID);
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

export { generateIdentity, restoreIdentity };
