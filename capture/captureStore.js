/**
 * captureStore.js — IndexedDB wrapper for the offline capture queue.
 *
 * Stores audio blobs and metadata persistently so captures survive:
 * - browser close / crash
 * - offline airplane mode
 * - network failures mid-upload
 *
 * Dependencies: none (raw IndexedDB, ~40 lines).
 */

const DB_NAME = 'ConciergeCaptureQueue';
const DB_VERSION = 1;
const STORE_NAME = 'captures';

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(STORE_NAME, { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function withStore(mode, fn) {
  const db = await openDB();
  const tx = db.transaction(STORE_NAME, mode);
  const store = tx.objectStore(STORE_NAME);
  const result = await fn(store);
  await new Promise((resolve, reject) => {
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
  return result;
}

// ── Public API ──────────────────────────────────────────────────────────────

/** Add a capture item to the queue. Returns the stored item. */
export async function addToQueue(item) {
  return withStore('readwrite', store => store.put(item).then(() => item));
}

/** Get all pending items, ordered by creation time (oldest first). */
export async function getPendingItems() {
  return withStore('readonly', store => store.getAll()).then(
    items => items.filter(i => i.status !== 'done').sort((a, b) => a.createdAt - b.createdAt)
  );
}

/** Get all items (including done), ordered by creation time (newest first). */
export async function getAllItems() {
  return withStore('readonly', store => store.getAll()).then(
    items => items.sort((a, b) => b.createdAt - a.createdAt)
  );
}

/** Update specific fields of a stored item. */
export async function updateItem(id, updates) {
  return withStore('readwrite', async store => {
    const existing = await new Promise((resolve, reject) => {
      const r = store.get(id);
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
    if (!existing) throw new Error(`Item ${id} not found in queue`);
    Object.assign(existing, updates);
    return store.put(existing);
  });
}

/** Remove an item from the queue. */
export async function removeItem(id) {
  return withStore('readwrite', store => store.delete(id));
}
