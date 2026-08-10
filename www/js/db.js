/*
 * db.js — local persistent storage.
 *
 * Uses IndexedDB (survives app restarts and background cache cleanups)
 * plus navigator.storage.persist() to ask Android to exempt this origin's
 * storage from automatic eviction under storage pressure.
 *
 * Object stores:
 *   - "notes"    : { id, tab: 'urgent'|'plans', text, order, createdAt, updatedAt, reminderAt }
 *   - "shopping" : { id: 'groceries'|'things', text, updatedAt }
 *
 * This module is intentionally the ONLY place that talks to IndexedDB,
 * so the rest of the app never needs to know the storage details.
 */
const DB = (() => {
  const DB_NAME = 'notes-app-db';
  const DB_VERSION = 1;
  let dbPromise = null;

  function open() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains('notes')) {
          const store = db.createObjectStore('notes', { keyPath: 'id' });
          store.createIndex('tab', 'tab', { unique: false });
        }
        if (!db.objectStoreNames.contains('shopping')) {
          db.createObjectStore('shopping', { keyPath: 'id' });
        }
      };
      req.onsuccess = (e) => resolve(e.target.result);
      req.onerror = (e) => reject(e.target.error);
    });
    return dbPromise;
  }

  async function tx(storeName, mode) {
    const db = await open();
    return db.transaction(storeName, mode).objectStore(storeName);
  }

  async function getAllNotes(tabName) {
    const store = await tx('notes', 'readonly');
    return new Promise((resolve, reject) => {
      const idx = store.index('tab');
      const req = idx.getAll(IDBKeyRange.only(tabName));
      req.onsuccess = () => {
        const items = req.result || [];
        items.sort((a, b) => a.order - b.order);
        resolve(items);
      };
      req.onerror = () => reject(req.error);
    });
  }

  async function putNote(note) {
    const store = await tx('notes', 'readwrite');
    return new Promise((resolve, reject) => {
      const req = store.put(note);
      req.onsuccess = () => resolve(note);
      req.onerror = () => reject(req.error);
    });
  }

  async function deleteNote(id) {
    const store = await tx('notes', 'readwrite');
    return new Promise((resolve, reject) => {
      const req = store.delete(id);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  }

  async function getShopping(id) {
    const store = await tx('shopping', 'readonly');
    return new Promise((resolve, reject) => {
      const req = store.get(id);
      req.onsuccess = () => resolve(req.result ? req.result.text : '');
      req.onerror = () => reject(req.error);
    });
  }

  async function setShopping(id, text) {
    const store = await tx('shopping', 'readwrite');
    return new Promise((resolve, reject) => {
      const req = store.put({ id, text, updatedAt: Date.now() });
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  }

  async function requestPersistence() {
    if (navigator.storage && navigator.storage.persist) {
      try {
        const already = await navigator.storage.persisted();
        if (!already) await navigator.storage.persist();
      } catch (e) { /* not fatal — best effort */ }
    }
  }

  function newId() {
    return 'n_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
  }

  return { getAllNotes, putNote, deleteNote, getShopping, setShopping, requestPersistence, newId };
})();
