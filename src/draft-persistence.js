/** One active durable write and only the newest waiting draft. */
import { writeWithMigrationBackup } from './migration-storage.js';
import { MAX_DOCUMENT_BYTES } from './model.js';

export function createDraftPersistence({ storage, key, initialRaw = null, onState = () => {} }) {
  if (!storage || typeof storage.run !== 'function' || typeof key !== 'string' || !key || initialRaw !== null && typeof initialRaw !== 'string' || typeof onState !== 'function') throw new Error('Draft saving needs a storage transaction and its original data.');
  let expectedRaw = initialRaw, pending = null, running = false, settled = Promise.resolve({ ok: true, revision: -1 }), result = { ok: true, revision: -1 };
  const report = state => { try { onState(state); } catch { /* A display failure must not interrupt a durable transaction. */ } };
  async function drain() {
    try {
      while (pending) {
        const target = pending; pending = null;
        try {
          await storage.run(() => writeWithMigrationBackup(storage, key, target.payload, 'document', { expectedRaw }));
          expectedRaw = target.payload; result = { ok: true, ...target }; report({ phase: 'saved', ...target });
        } catch (error) { result = { ok: false, ...target, error }; report({ phase: 'error', ...target, error }); }
      }
      return result;
    } finally { running = false; }
  }
  return Object.freeze({
    save(payload, revision) {
      if (typeof payload !== 'string' || !Number.isSafeInteger(revision) || revision < 0) throw new Error('Choose a valid draft and edit revision to save.');
      if (new TextEncoder().encode(payload).length > MAX_DOCUMENT_BYTES) throw new Error('Keep a design within the 12 MiB file limit.');
      pending = { payload, revision }; report({ phase: 'saving', ...pending });
      if (!running) { running = true; settled = drain(); }
    },
    whenSettled: () => settled,
    get expectedRaw() { return expectedRaw; }
  });
}
