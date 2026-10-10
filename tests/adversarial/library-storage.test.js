/** All state is fictitious and in memory; regressions cover stale writes and bounded recovery. */
import test from 'node:test';
import assert from 'node:assert/strict';
import * as library from '../../src/library.js';
import { createDocument } from '../../src/model.js';
import { writeWithMigrationBackup, preserveMigrationSource } from '../../src/migration-storage.js';
class MemoryStorage {
  values = new Map();
  getItem(key) { return this.values.get(key) ?? null; }
  setItem(key, value) { this.values.set(key, value); }
}

test('a stale named-save baseline cannot overwrite another tab, even within one clock tick', t => {
  t.mock.method(Date, 'now', () => 1728000000000);
  const storage = new MemoryStorage(), first = library.saveDesign(createDocument(), { name: 'First' }, storage);
  const changed = { ...first.document, title: 'Other tab' };
  const second = library.saveDesign(changed, { id: first.id, name: 'Other tab' }, storage);
  const before = storage.getItem(library.LIBRARY_KEY);
  assert.throws(() => library.saveDesign(first.document, { id: first.id, name: 'Stale', expectedUpdatedAt: first.updatedAt }, storage), error => error.code === 'design-conflict');
  assert.equal(storage.getItem(library.LIBRARY_KEY), before);
  assert.ok(Date.parse(second.updatedAt) > Date.parse(first.updatedAt));
  const third = library.saveDesign(second.document, { id: second.id, name: 'Third', expectedUpdatedAt: second.updatedAt }, storage);
  assert.equal(third.name, 'Third');
});

test('saved timestamps remain strictly ordered after wall-clock rollback', t => {
  t.mock.method(Date, 'now', () => 1728000000000);
  const storage = new MemoryStorage(), first = library.saveDesign(createDocument(), {}, storage);
  t.mock.method(Date, 'now', () => 1);
  const changed = library.saveDesign(first.document, { id: first.id }, storage);
  assert.ok(Date.parse(changed.updatedAt) > Date.parse(first.updatedAt));
});

test('a concurrent library write between read and storage commit is retained', () => {
  const storage = new MemoryStorage(); library.saveDesign(createDocument(), {}, storage);
  const ordinaryRead = storage.getItem.bind(storage); let reads = 0;
  const newer = JSON.parse(ordinaryRead(library.LIBRARY_KEY)); newer.designs[0].name = 'Another tab';
  const newerRaw = JSON.stringify(newer);
  storage.getItem = key => {
    const raw = ordinaryRead(key);
    if (key === library.LIBRARY_KEY && ++reads === 1) storage.values.set(key, newerRaw);
    return raw;
  };
  assert.throws(() => library.saveDesign(createDocument(), {}, storage), error => error.code === 'library-conflict');
  assert.equal(ordinaryRead(library.LIBRARY_KEY), newerRaw);
});

test('shared autosave detects a changed draft before replacing it', () => {
  const storage = new MemoryStorage(); storage.setItem('draft', 'Other tab');
  assert.throws(() => writeWithMigrationBackup(storage, 'draft', 'Local edits', 'document', { expectedRaw: 'Earlier draft' }), /another tab|changed/i);
  assert.equal(storage.getItem('draft'), 'Other tab');
  writeWithMigrationBackup(storage, 'draft', 'New draft', 'document', { expectedRaw: 'Other tab' });
  assert.equal(storage.getItem('draft'), 'New draft');
});

test('a change during migration backup does not overwrite the newer active draft', () => {
  const storage = new MemoryStorage(), legacy = JSON.stringify({ schema: 'stencil-studio', version: 1 });
  storage.setItem('draft', legacy);
  const setItem = storage.setItem.bind(storage);
  storage.setItem = (key, value) => { setItem(key, value); if (key.includes('.migration.')) setItem('draft', 'Newer draft'); };
  assert.throws(() => writeWithMigrationBackup(storage, 'draft', 'Updated local draft', 'document', { expectedRaw: legacy }), /another tab|changed/i);
  assert.equal(storage.getItem('draft'), 'Newer draft');
  assert.ok([...storage.values].some(([key, value]) => key.includes('.migration.') && value === legacy));
});

test('malformed controls, oversized names and wrong timestamp types do not write', () => {
  const storage = new MemoryStorage(), record = library.saveDesign(createDocument(), {}, storage), before = storage.getItem(library.LIBRARY_KEY);
  for (const name of ['\u202ehidden', 'x'.repeat(100001), '\0', '', [], false]) assert.throws(() => library.saveDesign(record.document, { id: record.id, name }, storage));
  for (const expectedUpdatedAt of [0, null, false, [], {}, 'invalid']) assert.throws(() => library.saveDesign(record.document, { id: record.id, expectedUpdatedAt }, storage));
  assert.equal(storage.getItem(library.LIBRARY_KEY), before);
});

test('rename and summaries are isolated copies and rename survives reopening', () => {
  const storage = new MemoryStorage(), record = library.saveDesign(createDocument(), { name: 'Before' }, storage);
  const renamed = library.renameDesign(record.id, ' After ', storage);
  assert.equal(renamed.name, 'After'); assert.equal(renamed.document.title, 'After');
  assert.equal(library.loadDesign(record.id, storage).title, 'After');
  const summaries = library.listDesignSummaries(storage);
  assert.equal(summaries[0].pageCount, 1); assert.equal(summaries[0].firstPage.id, record.document.pages[0].id);
  summaries[0].firstPage.background = '#000000';
  assert.equal(library.loadDesign(record.id, storage).pages[0].background, record.document.pages[0].background);
});

test('hostile names stay literal data and corruption blocks further mutations', () => {
  const storage = new MemoryStorage(), name = '<img src=x onerror=alert(1)> ../../etc/passwd';
  const saved = library.saveDesign(createDocument(), { name }, storage);
  assert.equal(library.listDesigns(storage)[0].name, name);
  const raw = storage.getItem(library.LIBRARY_KEY); storage.setItem(library.LIBRARY_KEY, raw.slice(0, -1));
  const corrupt = storage.getItem(library.LIBRARY_KEY);
  assert.throws(() => library.duplicateDesign(saved.id, storage), error => error.code === 'invalid-stored-library');
  assert.equal(storage.getItem(library.LIBRARY_KEY), corrupt);
});

test('cooperating tab writes acquire the same exclusive library lock before fresh reads', async () => {
  const storage = new MemoryStorage(), calls = []; let queue = Promise.resolve();
  const locks = { request(name, options, operation) { calls.push({ name, mode: options.mode, signal: options.signal }); const next = queue.then(operation); queue = next.catch(() => {}); return next; } };
  await Promise.all(Array.from({ length: 20 }, (_, index) => library.withLibraryLock(() => library.saveDesign(createDocument(), { name: `Design ${index}` }, storage), { locks })));
  assert.equal(library.listDesigns(storage).length, 20);
  assert.equal(calls.length, 20); assert.ok(calls.every(call => call.name === library.LIBRARY_KEY && call.mode === 'exclusive'));
});

test('cancelled lock waits and operation errors leave saved data unchanged', async () => {
  const storage = new MemoryStorage(), before = library.saveDesign(createDocument(), {}, storage), raw = storage.getItem(library.LIBRARY_KEY);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(library.withLibraryLock(() => library.deleteDesign(before.id, storage), { locks: null, signal: controller.signal }), error => error.code === 'library-busy');
  await assert.rejects(library.withLibraryLock(() => { throw new Error('Example failure'); }, { locks: null }), /Example failure/);
  assert.equal(storage.getItem(library.LIBRARY_KEY), raw);
});

test('repeated identifiers and recovery-name collisions are bounded failures', t => {
  const storage = new MemoryStorage(), record = library.saveDesign(createDocument(), {}, storage), raw = storage.getItem(library.LIBRARY_KEY);
  t.mock.method(globalThis.crypto, 'randomUUID', () => record.id);
  assert.throws(() => library.duplicateDesign(record.id, storage), error => error.code === 'id-unavailable');
  assert.equal(storage.getItem(library.LIBRARY_KEY), raw);
  let reads = 0;
  const hostile = { getItem() { reads++; return 'occupied'; }, setItem() { throw new Error('Must not write'); } };
  assert.throws(() => preserveMigrationSource(hostile, 'draft', 'Original'), /Too many recovery/);
  assert.ok(reads <= 130);
});


test('a confirmed card cannot delete or duplicate an unseen newer revision', () => {
  const storage = new MemoryStorage(), before = library.saveDesign(createDocument(), {}, storage);
  const newer = library.renameDesign(before.id, 'Changed elsewhere', storage), raw = storage.getItem(library.LIBRARY_KEY);
  for (const mutation of [library.deleteDesign, library.duplicateDesign]) assert.throws(() => mutation(before.id, storage, { expectedUpdatedAt: before.updatedAt }), error => error.code === 'design-conflict');
  assert.equal(storage.getItem(library.LIBRARY_KEY), raw);
  const duplicate = library.duplicateDesign(newer.id, storage, { expectedUpdatedAt: newer.updatedAt });
  assert.equal(duplicate.name, 'Changed elsewhere copy');
});
