/** Transactional browser storage for designs, their saved versions and uploads.
 * The synchronous Storage facade is writable only inside an awaited run().
 * IndexedDB's transaction completion is the point at which a save succeeds.
 */
import { StorageConflictError } from './migration-storage.js';

export const DATABASE_NAME = 'stencil-studio.local-designs';
export const DATABASE_VERSION = 1;
export const MAX_LEGACY_RECOVERIES = 6;
export const MAX_LEGACY_RECOVERY_BYTES = 32 * 1024 * 1024;
const STORE = 'records';
const PREFIX = 'stencil-studio.';
const BASE_KEYS = ['document.v1', 'library.v1', 'uploads.v1'].map(key => PREFIX + key);
const ownedKey = key => typeof key === 'string' && /^stencil-studio\.(?:document|library|uploads)\.v1(?:\.|$)/.test(key);
const earlierBackupKey = key => typeof key === 'string' && /^stencil-studio\.(?:document|library|uploads)\.v1\.(?:migration|recovery)\.[\w.-]+$/.test(key);
const IMPORTED = '@legacy-import-complete';
const legacyKey = key => `@legacy:${key}`;
const originalLegacyKey = key => `@legacy-original:${key}`;
const recoveryKey = key => /^stencil-studio\.(document|library|uploads)\.v1\.legacy-recovery\.v1\.[\w-]+(?:\.\d+)?$/.test(key);
const utf8Bytes = value => new TextEncoder().encode(value).byteLength;
const kindFor = key => key.split('.')[1];
let configuredStorage;

export function getBrowserStorage() { return configuredStorage ?? globalThis.localStorage; }
export function configureBrowserStorage(storage) { configuredStorage = storage; }

function earlierValues(storage) {
  const values = new Map();
  if (!storage) return values;
  const keys = new Set(BASE_KEYS);
  // A real Storage enumerates keys; the base keys also support explicit test facades.
  for (let index = 0; index < storage.length; index++) {
    const key = storage.key(index); if (ownedKey(key)) keys.add(key);
  }
  for (const key of keys) {
    const raw = storage.getItem(key);
    if (raw !== null && typeof raw !== 'string') throw new Error('Earlier saved designs are not readable browser data.');
    values.set(key, raw);
  }
  return values;
}

function synchronous(operation, values) {
  const result = operation(values);
  if (result && typeof result.then === 'function') {
    // A late rejection must not become an unhandled rejection after aborting the write.
    Promise.resolve(result).catch(() => {});
    throw new Error('A storage transaction must finish synchronously. Prepare files before saving.');
  }
  return result;
}

/** Small backend boundary also used to test atomic aborts without a DOM emulator. */
export async function createTransactionalStorage(backend, { legacyStorage, channel } = {}) {
  if (!backend || typeof backend.transaction !== 'function') throw new Error('A transactional design store is required.');
  let cache = new Map(), active = null, backupReads = null, queue = Promise.resolve(), closed = false, inspection = null, inspectionSerial = 0;
  const subscribers = new Set();
  const enqueue = operation => {
    const next = queue.then(() => { if (closed) throw new Error('The design store is closed. Refresh before saving.'); return operation(); });
    queue = next.catch(() => {}); return next;
  };
  const publish = (keys, external) => {
    for (const listener of subscribers) { try { listener({ keys, external }); } catch { /* A view cannot invalidate a completed save. */ } }
  };
  const imported = await backend.transaction(values => {
    if (!values.has(IMPORTED)) {
      const previous = earlierValues(legacyStorage);
      for (const [key, raw] of previous) {
        if (raw !== null && !values.has(key)) values.set(key, raw);
        values.set(legacyKey(key), JSON.stringify(raw));
        values.set(originalLegacyKey(key), JSON.stringify(raw));
      }
      values.set(IMPORTED, '1');
    }
    for (const key of BASE_KEYS) if (values.has(legacyKey(key)) && !values.has(originalLegacyKey(key))) values.set(originalLegacyKey(key), values.get(legacyKey(key)));
  });
  cache = imported.values;
  const facade = {
    kind: 'indexeddb',
    getItem(key) {
      key = String(key);
      // An older tab may have made a recovery file after the initial transfer.
      // Import its exact bytes only when a transaction actually reads that backup.
      // This also lets migration's collision check choose another backup name.
      if (active && !active.has(key) && legacyStorage && earlierBackupKey(key)) {
        const raw = legacyStorage.getItem(key);
        if (raw !== null) {
          if (typeof raw !== 'string') throw new Error('An earlier recovery file could not be read. Its data has been kept.');
          active.set(key, raw); backupReads.set(key, raw);
          active.set(legacyKey(key), JSON.stringify(raw));
          if (!active.has(originalLegacyKey(key))) active.set(originalLegacyKey(key), JSON.stringify(raw));
        }
      }
      return (active ?? cache).get(key) ?? null;
    },
    setItem(key, value) {
      if (!active) throw new Error('Await a storage transaction before reporting this design as saved.');
      key = String(key); if (!ownedKey(key)) throw new Error('This key is outside Stencil design storage.');
      active.set(key, String(value));
    },
    removeItem(key) {
      if (!active) throw new Error('Await a storage transaction before deleting saved data.');
      key = String(key); if (!ownedKey(key)) throw new Error('This key is outside Stencil design storage.');
      active.delete(key);
    },
    run(operation) {
      if (typeof operation !== 'function') return Promise.reject(new Error('A saved-design operation is required.'));
      return enqueue(async () => {
        let changed = [];
        const committed = await backend.transaction(values => {
          if (closed) throw new Error('The design store is closed. Refresh before saving.');
          const before = new Map(values); active = values; backupReads = new Map();
          let result;
          try {
            result = synchronous(() => operation(), values);
            changed = [...new Set([...before.keys(), ...values.keys()])].filter(key => ownedKey(key) && before.get(key) !== values.get(key));
            // Earlier application tabs still use localStorage. Never silently overwrite
            // their changed source or mistake it for the already imported snapshot.
            for (const [key, raw] of backupReads) {
              if (values.get(key) !== raw || legacyStorage.getItem(key) !== raw) throw new StorageConflictError();
            }
            if (legacyStorage) for (const key of changed) {
              const expected = backupReads.has(key) ? backupReads.get(key) : before.has(legacyKey(key)) ? JSON.parse(before.get(legacyKey(key))) : null;
              if (legacyStorage.getItem(key) !== expected) throw new StorageConflictError();
            }
          } finally { active = null; backupReads = null; }
          return result;
        });
        cache = committed.values;
        if (changed.length) {
          publish(changed, false);
          try { channel?.postMessage({ type: 'changed', keys: changed }); } catch { /* IndexedDB remains authoritative. */ }
        }
        return committed.result;
      });
    },
    refresh() {
      return enqueue(async () => {
        const refreshed = await backend.transaction(() => { if (closed) throw new Error('The design store is closed. Refresh before saving.'); }, 'readonly');
        const changed = [...new Set([...cache.keys(), ...refreshed.values.keys()])].filter(key => ownedKey(key) && cache.get(key) !== refreshed.values.get(key));
        cache = refreshed.values; if (changed.length) publish(changed, true); return changed;
      });
    },
    subscribe(listener) {
      if (typeof listener !== 'function') throw new Error('A storage change listener is required.');
      subscribers.add(listener); return () => subscribers.delete(listener);
    },
    async inspectLegacyChanges() {
      await facade.refresh();
      const changes = [];
      if (legacyStorage) for (const key of BASE_KEYS) {
        const previousRaw = cache.has(legacyKey(key)) ? JSON.parse(cache.get(legacyKey(key))) : null;
        const raw = legacyStorage.getItem(key);
        if (raw !== previousRaw) changes.push({ key, raw, previousRaw, canonicalRaw: cache.get(key) ?? null });
      }
      const token = String(++inspectionSerial);
      inspection = { token, changes };
      return { token, changes: changes.map(({ key, raw }) => ({ key, kind: kindFor(key), bytes: raw === null ? 0 : utf8Bytes(raw), deleted: raw === null })) };
    },
    keepBothLegacyCopies(token) {
      return enqueue(async () => {
        const captured = inspection;
        if (!captured || typeof token !== 'string' || captured.token !== token) throw new Error('Earlier tab data changed. Review both copies again before keeping them.');
        const keptKeys = [];
        const committed = await backend.transaction(values => {
          if (closed) throw new Error('The design store is closed. Refresh before saving.');
          const existing = [...values].filter(([key]) => recoveryKey(key));
          let count = existing.length, bytes = existing.reduce((total, [, raw]) => total + utf8Bytes(raw), 0);
          for (const { key, raw, previousRaw, canonicalRaw } of captured.changes) {
            if (legacyStorage.getItem(key) !== raw || (values.get(key) ?? null) !== canonicalRaw || (values.has(legacyKey(key)) ? JSON.parse(values.get(legacyKey(key))) : null) !== previousRaw) throw new StorageConflictError();
            if (raw !== null) {
              let hash = 2166136261; for (let index = 0; index < raw.length; index++) hash = Math.imul(hash ^ raw.charCodeAt(index), 16777619);
              const prefix = `${key}.legacy-recovery.v1.${(hash >>> 0).toString(16)}`;
              let retainedKey = prefix, suffix = 0;
              while (values.has(retainedKey) && values.get(retainedKey) !== raw) {
                if (++suffix > 128) throw new Error('Earlier copies use this recovery name. Download them before continuing.');
                retainedKey = `${prefix}.${suffix}`;
              }
              if (!values.has(retainedKey)) {
                if (++count > MAX_LEGACY_RECOVERIES || (bytes += utf8Bytes(raw)) > MAX_LEGACY_RECOVERY_BYTES) throw new Error('Earlier tab recovery is full (6 files or 32 MB). Existing copies are unchanged. Download your current design and earlier copies before continuing.');
                values.set(retainedKey, raw);
              }
              keptKeys.push(retainedKey);
            }
            values.set(legacyKey(key), JSON.stringify(raw));
          }
        });
        cache = committed.values; if (inspection === captured) inspection = null;
        if (keptKeys.length) {
          publish(keptKeys, false);
          try { channel?.postMessage({ type: 'changed', keys: keptKeys }); } catch { /* Backups remain committed. */ }
        }
        return { kept: keptKeys.length, recoveryKeys: keptKeys };
      });
    },
    listLegacyRecoveries() {
      return [...cache].filter(([key]) => recoveryKey(key)).map(([key, raw]) => ({ key, kind: kindFor(key), bytes: utf8Bytes(raw) }));
    },
    readLegacyRecovery(key) {
      if (typeof key !== 'string' || !recoveryKey(key) || !cache.has(key)) throw new Error('That earlier recovery copy is not available. Refresh the recovery list.');
      return cache.get(key);
    },
    removeLegacyRecovery(key) {
      const captured = facade.readLegacyRecovery(key);
      return enqueue(async () => {
        const committed = await backend.transaction(values => {
          if (closed) throw new Error('The design store is closed. Refresh before saving.');
          if (values.get(key) !== captured) throw new StorageConflictError();
          values.delete(key);
        });
        cache = committed.values; publish([key], false);
        try { channel?.postMessage({ type: 'changed', keys: [key] }); } catch { /* The confirmed deletion is committed. */ }
        return true;
      });
    },
    async idle() { await queue; },
    close() { closed = true; channel?.close(); backend.close?.(); subscribers.clear(); },
  };
  if (channel) channel.onmessage = event => {
    if (event.data?.type === 'changed') facade.refresh().catch(() => {});
  };
  return facade;
}

function indexedDBBackend(database) {
  return {
    transaction(operation, mode = 'readwrite') {
      return new Promise((resolve, reject) => {
        let transaction, result, values, failure;
        try {
          try { transaction = database.transaction(STORE, mode, mode === 'readwrite' ? { durability: 'strict' } : undefined); }
          catch (error) {
            // Older engines do not accept the optional durability argument.
            if (!(error instanceof TypeError)) throw error;
            transaction = database.transaction(STORE, mode);
          }
          transaction.onabort = () => reject(failure ?? transaction.error ?? new Error('Your browser could not save this design. The previous saved data is unchanged.'));
          transaction.onerror = () => { /* The transaction abort event reports the final result. */ };
          transaction.oncomplete = () => resolve({ result, values });
          const store = transaction.objectStore(STORE), read = store.getAll();
          read.onsuccess = () => {
            try {
              values = new Map();
              for (const record of read.result) {
                if (!record || typeof record.key !== 'string' || typeof record.value !== 'string') throw new Error('Stored designs could not be read. Their data has been kept.');
                values.set(record.key, record.value);
              }
              const before = new Map(values); result = synchronous(operation, values);
              if (mode === 'readonly' && [...new Set([...before.keys(), ...values.keys()])].some(key => before.get(key) !== values.get(key))) throw new Error('A read-only storage transaction cannot change designs.');
              if (mode === 'readwrite') {
                for (const [key, value] of values) if (before.get(key) !== value) store.put({ key, value });
                for (const key of before.keys()) if (!values.has(key)) store.delete(key);
              }
            } catch (error) { failure = error; transaction.abort(); }
          };
        } catch (error) { reject(error); }
      });
    },
    close() { database.close(); },
  };
}

export async function createBrowserStorage(options = {}) {
  const factory = options.indexedDB ?? globalThis.indexedDB;
  if (!factory || typeof factory.open !== 'function') throw new Error('Your browser does not support design storage. Keep the design open and download JSON.');
  let legacyStorage;
  try { legacyStorage = Object.hasOwn(options, 'legacyStorage') ? options.legacyStorage : globalThis.localStorage; }
  catch { /* IndexedDB can still work when localStorage access is blocked. */ }
  const database = await new Promise((resolve, reject) => {
    const request = factory.open(DATABASE_NAME, DATABASE_VERSION);
    let settled = false;
    const timeout = setTimeout(() => { settled = true; reject(new Error('Design storage could not open. Close other Stencil tabs and try again. Your existing data is unchanged.')); }, 5000);
    request.onupgradeneeded = () => { if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE, { keyPath: 'key' }); };
    request.onerror = () => { clearTimeout(timeout); settled = true; reject(request.error ?? new Error('Browser design storage is unavailable.')); };
    request.onsuccess = () => { clearTimeout(timeout); if (settled) { request.result.close(); return; } settled = true; resolve(request.result); };
  });
  database.onversionchange = () => database.close();
  let channel;
  try { if (typeof globalThis.BroadcastChannel === 'function' && options.broadcast !== false) channel = new BroadcastChannel(DATABASE_NAME); } catch { /* Fresh reads in every transaction still prevent lost writes. */ }
  try { return await createTransactionalStorage(indexedDBBackend(database), { legacyStorage, channel }); }
  catch (error) { channel?.close(); database.close(); throw error; }
}
