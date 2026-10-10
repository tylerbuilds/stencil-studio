import test from 'node:test';
import assert from 'node:assert/strict';
import { deflateSync } from 'node:zlib';
import { createTransactionalStorage, configureBrowserStorage, MAX_LEGACY_RECOVERY_BYTES, MAX_LEGACY_RECOVERIES } from '../../src/durable-storage.js';
import { createBlankDesign, createElement, serialiseDocument } from '../../src/model.js';
import { LIBRARY_KEY, saveDesign, renameDesign, importLibrary, listDesigns, loadDesign, exportLibrary, listDesignVersions, withLibraryLock } from '../../src/library.js';
import { UPLOADS_KEY, saveUpload, listUploads, withUploadsLock } from '../../src/uploads.js';
import { StorageConflictError, preserveMigrationSource, writeWithMigrationBackup } from '../../src/migration-storage.js';

const DRAFT_KEY = 'stencil-studio.document.v1';
class LegacyStorage {
  values = new Map(); writes = 0;
  get length() { return this.values.size; }
  key(index) { return [...this.values.keys()][index] ?? null; }
  getItem(key) { return this.values.get(key) ?? null; }
  setItem(key, value) { this.writes++; this.values.set(key, String(value)); }
}
// Simulates atomic backend commits, not IndexedDB request timing. Native browser
// acceptance separately exercises the real driver and a full localStorage origin.
class AtomicBackend {
  values = new Map(); queue = Promise.resolve(); fail = null; barrier = null;
  transaction(operation) {
    const next = this.queue.then(async () => {
      const values = new Map(this.values), result = operation(values);
      if (result?.then) throw new Error('Backend callback must be synchronous');
      if (this.barrier) await this.barrier;
      if (this.fail) throw this.fail;
      this.values = values; return { result, values: new Map(values) };
    });
    this.queue = next.catch(() => {}); return next;
  }
}
async function fixture() {
  const backend = new AtomicBackend(), legacyStorage = new LegacyStorage();
  const storage = await createTransactionalStorage(backend, { legacyStorage });
  return { backend, legacyStorage, storage };
}
function useStorage(t, storage) { configureBrowserStorage(storage); t.after(() => configureBrowserStorage(undefined)); }
function deferred() { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; }

function crc(bytes) {
  let value = 0xffffffff;
  for (const byte of bytes) { value ^= byte; for (let bit = 0; bit < 8; bit++) value = value & 1 ? (value >>> 1) ^ 0xedb88320 : value >>> 1; }
  return (value ^ 0xffffffff) >>> 0;
}
function png(width = 512, height = 512) {
  const rows = Buffer.alloc((width * 4 + 1) * height); let random = 0x12345678;
  for (let y = 0; y < height; y++) for (let x = 0; x < width * 4; x++) { random ^= random << 13; random ^= random >>> 17; random ^= random << 5; rows[y * (width * 4 + 1) + x + 1] = random & 255; }
  const chunk = (name, data) => { const value = Buffer.alloc(data.length + 12); value.writeUInt32BE(data.length); value.write(name, 4); data.copy(value, 8); value.writeUInt32BE(crc(value.subarray(4, -4)), value.length - 4); return value; };
  const header = Buffer.alloc(13); header.writeUInt32BE(width); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 6;
  return `data:image/png;base64,${Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), chunk('IHDR', header), chunk('IDAT', deflateSync(rows)), chunk('IEND', Buffer.alloc(0))]).toString('base64')}`;
}

test('migration copies exact Stencil sources and recovery data without touching shared-origin applications', async () => {
  const backend = new AtomicBackend(), legacy = new LegacyStorage();
  const raw = '  { "preserve": "界", "format": true }\n';
  legacy.values.set(DRAFT_KEY, raw); legacy.values.set(`${DRAFT_KEY}.migration.v4.123`, 'earlier exact source\n');
  legacy.values.set('clearcv.workspace.v1', 'private CV'); legacy.values.set('petrealm.state', 'pet game');
  const storage = await createTransactionalStorage(backend, { legacyStorage: legacy });
  assert.equal(storage.getItem(DRAFT_KEY), raw);
  assert.equal(storage.getItem(`${DRAFT_KEY}.migration.v4.123`), 'earlier exact source\n');
  assert.equal(JSON.parse(backend.values.get(`@legacy:${DRAFT_KEY}`)), raw);
  assert.equal(storage.getItem('clearcv.workspace.v1'), null); assert.equal(storage.getItem('petrealm.state'), null);
  assert.equal(legacy.writes, 0); assert.equal(legacy.getItem(DRAFT_KEY), raw);
});

test('a failed initial migration leaves every legacy byte and backend record unchanged', async () => {
  const backend = new AtomicBackend(), legacy = new LegacyStorage(); legacy.values.set(DRAFT_KEY, 'exact original');
  backend.fail = new DOMException('Quota exceeded', 'QuotaExceededError');
  await assert.rejects(createTransactionalStorage(backend, { legacyStorage: legacy }), { name: 'QuotaExceededError' });
  assert.equal(backend.values.size, 0); assert.equal(legacy.getItem(DRAFT_KEY), 'exact original'); assert.equal(legacy.writes, 0);
});

test('synchronous setters cannot claim persistence outside an awaited transaction', async () => {
  const { storage } = await fixture();
  assert.throws(() => storage.setItem(DRAFT_KEY, 'not saved'), /Await/);
  assert.throws(() => storage.removeItem(DRAFT_KEY), /Await/); assert.equal(storage.getItem(DRAFT_KEY), null);
  await assert.rejects(storage.run(() => storage.setItem('clearcv.workspace', 'forbidden')), /outside Stencil/);
});

test('a save result and cached value publish only after atomic commit completes', async () => {
  const { storage, backend } = await fixture(), gate = deferred(); backend.barrier = gate.promise;
  let returned = false, notified = false; storage.subscribe(() => { notified = true; });
  const saving = storage.run(() => { storage.setItem(DRAFT_KEY, 'new draft'); return 'saved'; }).then(value => { returned = true; return value; });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(storage.getItem(DRAFT_KEY), null); assert.equal(backend.values.has(DRAFT_KEY), false); assert.equal(returned, false); assert.equal(notified, false);
  gate.resolve(); assert.equal(await saving, 'saved'); assert.equal(storage.getItem(DRAFT_KEY), 'new draft'); assert.equal(notified, true);
});

test('quota and security failures roll back the entire staged write and permit a later retry', async () => {
  const { storage, backend } = await fixture(); await storage.run(() => storage.setItem(DRAFT_KEY, 'previous'));
  for (const name of ['QuotaExceededError', 'SecurityError']) {
    backend.fail = new DOMException('Browser storage failed', name);
    await assert.rejects(storage.run(() => { storage.setItem(DRAFT_KEY, 'unsaved'); storage.setItem(LIBRARY_KEY, 'also unsaved'); }), { name });
    assert.equal(storage.getItem(DRAFT_KEY), 'previous'); assert.equal(backend.values.get(DRAFT_KEY), 'previous'); assert.equal(storage.getItem(LIBRARY_KEY), null);
  }
  backend.fail = null; await storage.run(() => storage.setItem(DRAFT_KEY, 'retry')); assert.equal(storage.getItem(DRAFT_KEY), 'retry');
});

test('promise-returning callbacks abort staged writes rather than escaping the transaction', async () => {
  const { storage, backend } = await fixture();
  await assert.rejects(storage.run(async () => { storage.setItem(DRAFT_KEY, 'must abort'); }), /synchronously/);
  assert.equal(storage.getItem(DRAFT_KEY), null); assert.equal(backend.values.has(DRAFT_KEY), false);
});

test('large draft, named image design, upload and saved versions work without localStorage writes', async t => {
  const { storage, backend, legacyStorage } = await fixture(); useStorage(t, storage);
  const picture = png(), document = createBlankDesign({ title: 'Fictitious poster' });
  document.pages[0].elements.push(createElement('image', { src: picture, sourceWidth: 512, sourceHeight: 512 }));
  const raw = serialiseDocument(document); await storage.run(() => storage.setItem(DRAFT_KEY, raw));
  let saved = await withLibraryLock(() => saveDesign(document, { name: 'Poster' }), { locks: null });
  for (let edit = 0; edit < 3; edit++) saved = await withLibraryLock(() => saveDesign({ ...saved.document, title: `Poster ${edit}` }, { id: saved.id, name: `Poster ${edit}`, expectedUpdatedAt: saved.updatedAt }), { locks: null });
  await withUploadsLock(() => saveUpload({ name: 'Fictional photo', src: picture, width: 512, height: 512 }), { locks: null });
  assert.ok([...backend.values].filter(([key]) => !key.startsWith('@')).reduce((total, [, value]) => total + value.length, 0) > 5 * 1024 * 1024);
  assert.equal(listDesignVersions(saved.id).length, 3); assert.equal(listUploads().length, 1); assert.equal(loadDesign(saved.id).pages[0].elements[0].src, picture);
  assert.equal(legacyStorage.writes, 0); assert.equal(legacyStorage.getItem(DRAFT_KEY), null);
  const reloaded = await createTransactionalStorage(backend, { legacyStorage });
  assert.equal(reloaded.getItem(DRAFT_KEY), raw); assert.equal(JSON.parse(reloaded.getItem(LIBRARY_KEY)).designs[0].versions.length, 3);
  assert.equal(JSON.parse(reloaded.getItem(UPLOADS_KEY)).uploads[0].src, picture);
});

test('a failed named library commit cannot return a saved record or replace the prior backup', async t => {
  const { storage, backend } = await fixture(); useStorage(t, storage);
  const saved = await withLibraryLock(() => saveDesign(createBlankDesign(), { name: 'Already saved' }), { locks: null }), before = exportLibrary();
  backend.fail = new DOMException('Quota exceeded', 'QuotaExceededError');
  await assert.rejects(withLibraryLock(() => saveDesign(createBlankDesign(), { name: 'Unsaved' }), { locks: null }), error => error.code === 'storage-write-failed');
  assert.equal(exportLibrary(), before); assert.equal(listDesigns().length, 1); assert.deepEqual(loadDesign(saved.id), saved.document);
});

test('two independent tabs read current library data atomically without Web Locks', async () => {
  const { storage: first, backend, legacyStorage } = await fixture(), second = await createTransactionalStorage(backend, { legacyStorage });
  await Promise.all([first.run(() => saveDesign(createBlankDesign(), { name: 'Tab one' }, first)), second.run(() => saveDesign(createBlankDesign(), { name: 'Tab two' }, second))]);
  await first.refresh(); await second.refresh();
  assert.deepEqual(listDesigns(first).map(item => item.name).sort(), ['Tab one', 'Tab two']); assert.equal(listDesigns(second).length, 2);
});

test('another tab cannot overwrite a saved-design revision it no longer owns', async () => {
  const { storage: first, backend, legacyStorage } = await fixture();
  const original = await first.run(() => saveDesign(createBlankDesign(), { name: 'Original' }, first)), second = await createTransactionalStorage(backend, { legacyStorage });
  await second.run(() => saveDesign(original.document, { id: original.id, name: 'Newer tab', expectedUpdatedAt: original.updatedAt }, second));
  await assert.rejects(first.run(() => saveDesign(original.document, { id: original.id, name: 'Stale tab', expectedUpdatedAt: original.updatedAt }, first)), error => error.code === 'design-conflict');
  assert.equal(listDesigns(second).find(record => record.id === original.id).name, 'Newer tab');
});

test('a stale draft cannot replace a newer tab even when its local cache is old', async () => {
  const { storage: first, backend, legacyStorage } = await fixture(); await first.run(() => first.setItem(DRAFT_KEY, 'initial'));
  const second = await createTransactionalStorage(backend, { legacyStorage }); await second.run(() => second.setItem(DRAFT_KEY, 'newer'));
  await assert.rejects(first.run(() => writeWithMigrationBackup(first, DRAFT_KEY, 'stale edit', 'document', { expectedRaw: 'initial' })), StorageConflictError);
  assert.equal(backend.values.get(DRAFT_KEY), 'newer'); assert.equal(first.getItem(DRAFT_KEY), 'initial');
});

test('an old localStorage tab changing the imported draft is detected without losing either copy', async () => {
  const backend = new AtomicBackend(), legacyStorage = new LegacyStorage(); legacyStorage.values.set(DRAFT_KEY, 'original source');
  const storage = await createTransactionalStorage(backend, { legacyStorage }); await storage.run(() => storage.setItem(DRAFT_KEY, 'new IndexedDB draft'));
  legacyStorage.values.set(DRAFT_KEY, 'old application tab edit');
  await assert.rejects(storage.run(() => storage.setItem(DRAFT_KEY, 'would overwrite')), StorageConflictError);
  assert.equal(backend.values.get(DRAFT_KEY), 'new IndexedDB draft'); assert.equal(legacyStorage.getItem(DRAFT_KEY), 'old application tab edit');
  assert.equal(JSON.parse(backend.values.get(`@legacy:${DRAFT_KEY}`)), 'original source');
  // Keeping a named copy remains possible when only the old draft was changed.
  await storage.run(() => saveDesign(createBlankDesign(), { name: 'Kept local copy' }, storage)); assert.equal(listDesigns(storage).length, 1);
});

test('an old localStorage tab cannot change its library unnoticed after migration', async t => {
  const { storage, backend, legacyStorage } = await fixture(); useStorage(t, storage);
  const saved = await withLibraryLock(() => saveDesign(createBlankDesign(), { name: 'Current library' }), { locks: null }), previous = exportLibrary();
  legacyStorage.values.set(LIBRARY_KEY, 'older app library edit');
  await assert.rejects(withLibraryLock(() => saveDesign(saved.document, { id: saved.id, name: 'Will not overwrite' }), { locks: null }), error => error.code === 'library-conflict');
  assert.equal(storage.getItem(LIBRARY_KEY), previous); assert.equal(backend.values.get(LIBRARY_KEY), previous); assert.equal(legacyStorage.getItem(LIBRARY_KEY), 'older app library edit');
});

test('refreshes queue behind a pending save and notify only committed external changes', async () => {
  const { storage, backend, legacyStorage } = await fixture(), second = await createTransactionalStorage(backend, { legacyStorage }), gate = deferred();
  const events = []; second.subscribe(event => events.push(event)); backend.barrier = gate.promise;
  const saving = storage.run(() => storage.setItem(DRAFT_KEY, 'committed elsewhere')), refreshing = second.refresh();
  await new Promise(resolve => setImmediate(resolve)); assert.equal(second.getItem(DRAFT_KEY), null); assert.equal(events.length, 0);
  gate.resolve(); await saving; await refreshing; assert.equal(second.getItem(DRAFT_KEY), 'committed elsewhere');
  assert.deepEqual(events, [{ keys: [DRAFT_KEY], external: true }]);
});

test('closing an adapter rejects subsequent saves and leaves durable records intact', async () => {
  const { storage, backend } = await fixture(); await storage.run(() => storage.setItem(DRAFT_KEY, 'kept')); storage.close();
  await assert.rejects(storage.run(() => {}), /closed/); assert.equal(backend.values.get(DRAFT_KEY), 'kept');
});

test('a cancelled named save queued behind a draft cannot run later and alter the library', async t => {
  const { storage, backend } = await fixture(); useStorage(t, storage);
  const gate = deferred(), controller = new AbortController(); backend.barrier = gate.promise;
  const draft = storage.run(() => storage.setItem(DRAFT_KEY, 'kept draft'));
  await new Promise(resolve => setImmediate(resolve));
  const named = withLibraryLock(() => saveDesign(createBlankDesign(), { name: 'Cancelled save' }), { locks: null, signal: controller.signal });
  controller.abort(); gate.resolve(); await draft;
  await assert.rejects(named, error => error.code === 'library-busy'); assert.equal(storage.getItem(LIBRARY_KEY), null);
});

test('explicit Keep both copies retains the divergent source exactly and unblocks later saves', async () => {
  const backend = new AtomicBackend(), legacyStorage = new LegacyStorage(), original = '{ "title": "First source" }\n', earlier = '{ "title": "Earlier tab change" }\n';
  legacyStorage.values.set(DRAFT_KEY, original);
  const storage = await createTransactionalStorage(backend, { legacyStorage }); await storage.run(() => storage.setItem(DRAFT_KEY, 'current IndexedDB draft'));
  legacyStorage.values.set(DRAFT_KEY, earlier);
  const inspected = await storage.inspectLegacyChanges();
  assert.deepEqual(inspected.changes, [{ key: DRAFT_KEY, kind: 'document', bytes: Buffer.byteLength(earlier), deleted: false }]);
  const kept = await storage.keepBothLegacyCopies(inspected.token);
  assert.equal(kept.kept, 1); assert.equal(storage.readLegacyRecovery(kept.recoveryKeys[0]), earlier);
  assert.equal(storage.getItem(DRAFT_KEY), 'current IndexedDB draft'); assert.equal(legacyStorage.getItem(DRAFT_KEY), earlier);
  assert.equal(JSON.parse(backend.values.get(`@legacy-original:${DRAFT_KEY}`)), original);
  await storage.run(() => storage.setItem(DRAFT_KEY, 'new accepted edit')); assert.equal(storage.getItem(DRAFT_KEY), 'new accepted edit');
  assert.equal(legacyStorage.writes, 0); assert.equal(storage.listLegacyRecoveries().length, 1);
});

test('an earlier tab changing again while its copies are reviewed cannot be acknowledged unseen', async () => {
  const { backend, storage, legacyStorage } = await fixture(); legacyStorage.values.set(DRAFT_KEY, 'reviewed earlier draft');
  const inspected = await storage.inspectLegacyChanges(), before = new Map(backend.values);
  legacyStorage.values.set(DRAFT_KEY, 'unseen later edit');
  await assert.rejects(storage.keepBothLegacyCopies(inspected.token), StorageConflictError);
  assert.deepEqual(backend.values, before); assert.equal(storage.listLegacyRecoveries().length, 0); assert.equal(legacyStorage.getItem(DRAFT_KEY), 'unseen later edit');
});

test('a second tab resolving and editing the current draft invalidates the first recovery decision', async () => {
  const { backend, storage: first, legacyStorage } = await fixture(), second = await createTransactionalStorage(backend, { legacyStorage });
  legacyStorage.values.set(DRAFT_KEY, 'earlier tab'); const oldInspection = await first.inspectLegacyChanges(), freshInspection = await second.inspectLegacyChanges();
  await second.keepBothLegacyCopies(freshInspection.token); await second.run(() => second.setItem(DRAFT_KEY, 'newer current draft'));
  const before = new Map(backend.values); await assert.rejects(first.keepBothLegacyCopies(oldInspection.token), StorageConflictError);
  assert.deepEqual(backend.values, before); assert.equal(second.getItem(DRAFT_KEY), 'newer current draft');
});

test('a failed Keep both copies transaction publishes no recovery or acknowledged baseline', async () => {
  const { backend, storage, legacyStorage } = await fixture(); legacyStorage.values.set(LIBRARY_KEY, 'earlier library');
  const inspected = await storage.inspectLegacyChanges(), before = new Map(backend.values);
  backend.fail = new DOMException('Quota exceeded', 'QuotaExceededError');
  await assert.rejects(storage.keepBothLegacyCopies(inspected.token), { name: 'QuotaExceededError' });
  assert.deepEqual(backend.values, before); assert.equal(storage.listLegacyRecoveries().length, 0);
  backend.fail = null; const kept = await storage.keepBothLegacyCopies(inspected.token); assert.equal(storage.readLegacyRecovery(kept.recoveryKeys[0]), 'earlier library');
});

test('fixed recovery count never discards an earlier copy to make another acknowledgement fit', async () => {
  const { backend, storage, legacyStorage } = await fixture();
  for (let index = 0; index < MAX_LEGACY_RECOVERIES; index++) {
    legacyStorage.values.set(DRAFT_KEY, `earlier copy ${index}`); const inspected = await storage.inspectLegacyChanges(); await storage.keepBothLegacyCopies(inspected.token);
  }
  const before = new Map(backend.values); legacyStorage.values.set(DRAFT_KEY, 'over count limit'); const inspected = await storage.inspectLegacyChanges();
  await assert.rejects(storage.keepBothLegacyCopies(inspected.token), /recovery is full/); assert.deepEqual(backend.values, before);
  assert.equal(storage.listLegacyRecoveries().length, MAX_LEGACY_RECOVERIES);
  for (let index = 0; index < MAX_LEGACY_RECOVERIES; index++) assert.ok(storage.listLegacyRecoveries().some(({ key }) => storage.readLegacyRecovery(key) === `earlier copy ${index}`));
});

test('fixed UTF-8 recovery budget fails atomically without advancing the source baseline', async () => {
  const { backend, storage, legacyStorage } = await fixture(); legacyStorage.values.set(DRAFT_KEY, '界'.repeat(Math.floor(MAX_LEGACY_RECOVERY_BYTES / 3) + 1));
  const inspected = await storage.inspectLegacyChanges(), before = new Map(backend.values);
  await assert.rejects(storage.keepBothLegacyCopies(inspected.token), /recovery is full/); assert.deepEqual(backend.values, before);
  assert.equal(storage.listLegacyRecoveries().length, 0);
});

test('an earlier tab deleting its source is acknowledged while the original and current drafts remain kept', async () => {
  const backend = new AtomicBackend(), legacyStorage = new LegacyStorage(); legacyStorage.values.set(DRAFT_KEY, 'exact original');
  const storage = await createTransactionalStorage(backend, { legacyStorage }); await storage.run(() => storage.setItem(DRAFT_KEY, 'current draft'));
  legacyStorage.values.delete(DRAFT_KEY); const inspected = await storage.inspectLegacyChanges(); assert.equal(inspected.changes[0].deleted, true);
  const kept = await storage.keepBothLegacyCopies(inspected.token); assert.equal(kept.kept, 0);
  assert.equal(JSON.parse(backend.values.get(`@legacy-original:${DRAFT_KEY}`)), 'exact original'); assert.equal(storage.getItem(DRAFT_KEY), 'current draft');
  await storage.run(() => storage.setItem(DRAFT_KEY, 'new draft')); assert.equal(storage.getItem(DRAFT_KEY), 'new draft');
});

test('an explicit recovery deletion frees room without changing the canonical or original copies', async () => {
  const { storage, backend, legacyStorage } = await fixture(); await storage.run(() => storage.setItem(DRAFT_KEY, 'current draft'));
  for (let index = 0; index < MAX_LEGACY_RECOVERIES; index++) { legacyStorage.values.set(DRAFT_KEY, `earlier ${index}`); const review = await storage.inspectLegacyChanges(); await storage.keepBothLegacyCopies(review.token); }
  const firstKey = storage.listLegacyRecoveries()[0].key, original = backend.values.get(`@legacy-original:${DRAFT_KEY}`);
  await assert.rejects(Promise.resolve().then(() => storage.removeLegacyRecovery(DRAFT_KEY)), /not available/);
  assert.equal(await storage.removeLegacyRecovery(firstKey), true); assert.equal(storage.listLegacyRecoveries().length, MAX_LEGACY_RECOVERIES - 1);
  legacyStorage.values.set(DRAFT_KEY, 'new earlier source'); const review = await storage.inspectLegacyChanges(); await storage.keepBothLegacyCopies(review.token);
  assert.equal(storage.listLegacyRecoveries().length, MAX_LEGACY_RECOVERIES); assert.equal(storage.getItem(DRAFT_KEY), 'current draft'); assert.equal(backend.values.get(`@legacy-original:${DRAFT_KEY}`), original);
  assert.equal(legacyStorage.getItem(DRAFT_KEY), 'new earlier source');
});

test('unchanged imported names retain their exact spaces across migration, save and rename', async () => {
  const { storage } = await fixture(), name = '  Imported poster  ', document = createBlankDesign({ title: name });
  await storage.run(() => importLibrary({ schema: 'stencil-studio-library', version: 1, designs: [{ id: 'retained-name', name, updatedAt: '2026-10-09T00:00:00.000Z', document }] }, {}, storage));
  const saved = await storage.run(() => saveDesign(document, { id: 'retained-name', name }, storage));
  assert.equal(saved.name, name); assert.equal(saved.versions.length, 0);
  const renamed = await storage.run(() => renameDesign(saved.id, name, storage)); assert.equal(renamed.name, name); assert.equal(renamed.versions.length, 0);
});

test('surrounding spaces in a new name are trimmed rather than mistaken for an unchanged retained name', async () => {
  const { storage } = await fixture(), document = createBlankDesign({ title: 'Poster' });
  const saved = await storage.run(() => saveDesign(document, { name: 'Poster' }, storage));
  const renamed = await storage.run(() => renameDesign(saved.id, '  Poster  ', storage)); assert.equal(renamed.name, 'Poster');
  const updated = await storage.run(() => saveDesign(renamed.document, { id: saved.id, name: '  Poster  ' }, storage)); assert.equal(updated.name, 'Poster'); assert.equal(updated.versions.length, 0);
});

test('a migration backup created by an older tab is retained and does not block saving after Keep both copies', async () => {
  const backend = new AtomicBackend(), legacyStorage = new LegacyStorage(), document = createBlankDesign({ title: 'Original poster' });
  const original = JSON.stringify({ schema: 'stencil-studio-library', version: 1, designs: [{ id: 'earlier-library', name: 'Original poster', updatedAt: '2026-10-09T00:00:00.000Z', document }] }, null, 3) + '\n';
  legacyStorage.values.set(LIBRARY_KEY, original); const storage = await createTransactionalStorage(backend, { legacyStorage });
  saveDesign(createBlankDesign({ title: 'Earlier tab addition' }), { name: 'Earlier tab addition' }, legacyStorage);
  const oldBackupKey = [...legacyStorage.values.keys()].find(key => key.includes('.migration.')), earlierLibrary = legacyStorage.getItem(LIBRARY_KEY);
  await assert.rejects(storage.run(() => saveDesign(createBlankDesign(), { name: 'Current tab addition' }, storage)), StorageConflictError);
  const review = await storage.inspectLegacyChanges(); await storage.keepBothLegacyCopies(review.token);
  await storage.run(() => saveDesign(createBlankDesign(), { name: 'Current tab addition' }, storage));
  assert.equal(storage.getItem(oldBackupKey), original); assert.equal(legacyStorage.getItem(oldBackupKey), original); assert.equal(legacyStorage.getItem(LIBRARY_KEY), earlierLibrary);
  assert.deepEqual(listDesigns(storage).map(item => item.name).sort(), ['Current tab addition', 'Original poster']);
  assert.ok(storage.listLegacyRecoveries().some(({ key }) => storage.readLegacyRecovery(key) === earlierLibrary));
});

test('later legacy recovery name collisions keep both exact backup payloads and choose an unused name', async () => {
  const { storage, legacyStorage } = await fixture(), original = 'exact first source\n';
  const probe = new LegacyStorage(), prefix = preserveMigrationSource(probe, DRAFT_KEY, original);
  legacyStorage.values.set(prefix, 'different existing recovery\n'); legacyStorage.values.set(`${prefix}.1`, original);
  const keptKey = await storage.run(() => preserveMigrationSource(storage, DRAFT_KEY, original));
  assert.equal(keptKey, `${prefix}.1`); assert.equal(storage.getItem(prefix), 'different existing recovery\n'); assert.equal(storage.getItem(keptKey), original);
  assert.equal(legacyStorage.getItem(prefix), 'different existing recovery\n'); assert.equal(legacyStorage.getItem(keptKey), original);
});

test('a later legacy backup changing after its guarded read aborts the whole migration transaction', async () => {
  const { backend, storage, legacyStorage } = await fixture(), raw = 'earlier original';
  const probe = new LegacyStorage(), key = preserveMigrationSource(probe, DRAFT_KEY, raw); legacyStorage.values.set(key, raw);
  const get = legacyStorage.getItem.bind(legacyStorage); let reads = 0;
  legacyStorage.getItem = name => { const value = get(name); if (name === key && ++reads === 1) legacyStorage.values.set(key, 'changed during review'); return value; };
  const before = new Map(backend.values);
  await assert.rejects(storage.run(() => { preserveMigrationSource(storage, DRAFT_KEY, raw); storage.setItem(DRAFT_KEY, 'would replace'); }), StorageConflictError);
  assert.deepEqual(backend.values, before); assert.equal(storage.getItem(key), null); assert.equal(get(key), 'changed during review');
});

test('reading then removing a newly observed legacy backup cannot bypass its preservation guard', async () => {
  const { storage, backend, legacyStorage } = await fixture(), raw = 'earlier exact recovery';
  const probe = new LegacyStorage(), key = preserveMigrationSource(probe, DRAFT_KEY, raw); legacyStorage.values.set(key, raw);
  const before = new Map(backend.values);
  await assert.rejects(storage.run(() => { assert.equal(storage.getItem(key), raw); storage.removeItem(key); }), StorageConflictError);
  assert.deepEqual(backend.values, before); assert.equal(legacyStorage.getItem(key), raw); assert.equal(storage.getItem(key), null);
});
