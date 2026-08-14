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

// Conexão cacheadas: abrir o IndexedDB por operação custa caro e gera
// conexões concorrentes (cada operação abria e nunca fechava a própria).
let dbPromise = null;

function openDB() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        req.result.createObjectStore(STORE_NAME, { keyPath: 'id' });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => {
        // Falha pode ser transitória (ex.: quota) — não envenena a promise
        // cacheada; a próxima chamada tenta abrir de novo.
        dbPromise = null;
        reject(req.error);
      };
    });
  }
  return dbPromise;
}

async function withStore(mode, fn) {
  const db = await openDB();
  const tx = db.transaction(STORE_NAME, mode);
  const store = tx.objectStore(STORE_NAME);
  const result = fn(store);
  // IDBRequest não é uma promise: `await` não espera a resposta do
  // IndexedDB. Resolve manualmente via onsuccess/onerror para que o
  // valor retornado seja o RESULTADO (ex.: o array do getAll), não o
  // objeto request.
  const value = (result && typeof result.then === 'function')
    ? await result
    : await new Promise((resolve, reject) => {
        result.onsuccess = () => resolve(result.result);
        result.onerror = () => reject(result.error);
      });
  await new Promise((resolve, reject) => {
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
  return value;
}

// ── Public API ──────────────────────────────────────────────────────────────

/** Add a capture item to the queue. Returns the stored item. */
export async function addToQueue(item) {
  await withStore('readwrite', store => store.put(item));
  return item;
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

/** Get a single item by id (or undefined if not present). Usado pelo app
 * para resolver updates da fila sem depender do handle em memória. */
export async function getItem(id) {
  return withStore('readonly', store => store.get(id));
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
