import test from 'node:test';
import assert from 'node:assert/strict';
import { createDocument, createElement, serialiseDocument, parseDocument, VERSION } from '../src/model.js';
import { needsMigration, preserveMigrationSource, writeWithMigrationBackup } from '../src/migration-storage.js';
import { LIBRARY_KEY, loadDesign, saveDesign, deleteDesign, importLibrary } from '../src/library.js';
class Storage {
  values = new Map(); writes = []; failBackup = false; failActive = false;
  getItem(key) { return this.values.get(key) ?? null; }
  setItem(key, value) { this.writes.push(key); if (key.includes('.migration.') ? this.failBackup : this.failActive) throw new Error('Quota exceeded'); this.values.set(key, value); }
}
function oldDocument() { const document = createDocument(); document.version = 2; document.title = 'Original 界'; document.pages[0].elements.push(createElement('text', { text: '<literal> & original' })); for (const key of ['guides', 'guideSettings', 'transparentBackground']) delete document.pages[0][key]; return document; }
const key = 'stencil-studio.document.v1';

test('first migrated document save preserves exact source bytes before replacing its active key', () => {
  const storage = new Storage(), original = JSON.stringify(oldDocument(), null, 4) + '\n', current = parseDocument(original);
  storage.values.set(key, original); current.title = 'Edited after migration';
  writeWithMigrationBackup(storage, key, serialiseDocument(current));
  const backup = storage.writes[0]; assert.ok(backup.includes(`.migration.v${VERSION}.`)); assert.equal(storage.getItem(backup), original);
  assert.equal(parseDocument(storage.getItem(key)).title, current.title); assert.equal(JSON.parse(storage.getItem(key)).version, VERSION);
  assert.equal(preserveMigrationSource(storage, key, original), backup); assert.equal(storage.writes.length, 2);
  const reloaded = parseDocument(storage.getItem(key)); assert.equal(reloaded.title, current.title); assert.equal(storage.getItem(backup), original);
});
test('a selectively failed backup blocks the otherwise writable active key and retains raw old data', () => {
  const storage = new Storage(), original = JSON.stringify(oldDocument()); storage.values.set(key, original); storage.failBackup = true;
  assert.throws(() => writeWithMigrationBackup(storage, key, serialiseDocument(parseDocument(original))), /Quota/);
  assert.equal(storage.getItem(key), original); assert.equal(storage.writes.some(item => item === key), false);
  storage.failBackup = false; storage.failActive = true;
  assert.throws(() => writeWithMigrationBackup(storage, key, serialiseDocument(parseDocument(original))), /Quota/);
  assert.equal(storage.getItem(key), original); assert.ok([...storage.values].some(([name, value]) => name.includes('.migration.') && value === original));
});
test('backup key collision never overwrites an earlier backup and migration detection is bounded to old documents', () => {
  const storage = new Storage(), raw = JSON.stringify(oldDocument()), backup = preserveMigrationSource(storage, key, raw);
  storage.values.set(backup, 'Existing unrelated recovery');
  const second = preserveMigrationSource(storage, key, raw); assert.notEqual(second, backup); assert.equal(storage.getItem(backup), 'Existing unrelated recovery'); assert.equal(storage.getItem(second), raw);
  assert.equal(needsMigration(raw), true); assert.equal(needsMigration(serialiseDocument(parseDocument(raw))), false); assert.equal(needsMigration('malformed'), false);
});
test('library migration retains the entire exact old library before updates and backup quota blocks every mutation', () => {
  const storage = new Storage(), original = JSON.stringify({ schema: 'stencil-studio-library', version: 1, designs: [{ id: 'old-design', name: 'Original', updatedAt: '2026-10-09T00:00:00.000Z', document: oldDocument() }] }, null, 3) + '\n';
  storage.values.set(LIBRARY_KEY, original); assert.equal(loadDesign('old-design', storage).version, VERSION);
  assert.equal(storage.writes.length, 0); storage.failBackup = true;
  for (const mutation of [() => saveDesign(createDocument(), {}, storage), () => deleteDesign('old-design', storage), () => importLibrary({ schema: 'stencil-studio-library', version: 1, designs: [] }, { mode: 'replace' }, storage)]) {
    assert.throws(mutation, /unchanged/); assert.equal(storage.getItem(LIBRARY_KEY), original);
  }
  assert.equal(storage.writes.includes(LIBRARY_KEY), false); storage.failBackup = false; saveDesign(createDocument(), {}, storage);
  assert.ok([...storage.values].some(([name, value]) => name.startsWith(`${LIBRARY_KEY}.migration.`) && value === original));
  assert.equal(JSON.parse(storage.getItem(LIBRARY_KEY)).designs[0].document.version, VERSION); assert.equal(loadDesign('old-design', storage).title, 'Original 界');
});


test('explicit validated replacement can recover parseable corrupt library records without misreporting storage failure', () => {
  const raw = JSON.stringify({ schema: 'stencil-studio-library', version: 1, designs: [null] });
  const memory = new Map([[LIBRARY_KEY, raw]]), storage = { getItem: key => memory.get(key) ?? null, setItem: (key, value) => memory.set(key, value) };
  assert.equal(needsMigration(raw, 'library'), false);
  const clean = JSON.stringify({ schema: 'stencil-studio-library', version: 1, designs: [] });
  assert.deepEqual(importLibrary(clean, { mode: 'replace' }, storage), { imported: 0, skipped: 0, total: 0 });
  assert.deepEqual(JSON.parse(memory.get(LIBRARY_KEY)).designs, []);
});
