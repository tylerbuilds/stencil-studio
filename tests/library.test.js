import test from 'node:test';
import assert from 'node:assert/strict';
import { VERSION, createDocument, createElement, templateDocument } from '../src/model.js';
import { LIBRARY_KEY, LIBRARY_SCHEMA, LIBRARY_VERSION, MAX_DESIGNS, MAX_LIBRARY_BYTES, LibraryError, listDesigns, saveDesign, loadDesign, duplicateDesign, deleteDesign, exportLibrary, importLibrary } from '../src/library.js';

class MemoryStorage {
  constructor() { this.values = new Map(); this.writes = 0; this.full = false; }
  getItem(key) { return this.values.get(key) ?? null; }
  setItem(key, value) {
    if (this.full) throw new DOMException('Quota exceeded', 'QuotaExceededError');
    this.values.set(key, String(value)); this.writes++;
  }
}
const backup = designs => ({ schema: LIBRARY_SCHEMA, version: LIBRARY_VERSION, designs });

test('named saves and updates keep independent documents and metadata', () => {
  const storage = new MemoryStorage(), document = templateDocument('poster');
  assert.deepEqual(listDesigns(storage), []);
  const first = saveDesign(document, { name: ' My poster ', id: undefined }, storage);
  assert.equal(first.name, 'My poster');
  assert.match(first.updatedAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.deepEqual(listDesigns(storage), [{ id: first.id, name: first.name, updatedAt: first.updatedAt }]);
  document.title = 'Caller mutation'; first.document.pages[0].background = '#ffffff';
  const loaded = loadDesign(first.id, storage);
  assert.equal(loaded.title, 'Make some noise');
  assert.equal(loaded.pages[0].background, '#f6f1e7');
  loaded.title = 'Loaded mutation';
  assert.equal(loadDesign(first.id, storage).title, 'Make some noise');
  const changed = loadDesign(first.id, storage); changed.title = 'Updated';
  const second = saveDesign(changed, { id: first.id, name: 'Updated poster' }, storage);
  assert.equal(second.id, first.id); assert.equal(listDesigns(storage).length, 1);
  assert.equal(loadDesign(first.id, storage).title, 'Updated');
});

test('duplicate and delete affect only the selected saved design', () => {
  const storage = new MemoryStorage();
  const first = saveDesign(templateDocument('card'), {}, storage), second = duplicateDesign(first.id, storage);
  assert.notEqual(first.id, second.id); assert.equal(second.name, `${first.name} copy`);
  assert.equal(second.document.title, second.name);
  second.document.pages[0].background = '#000000';
  saveDesign(second.document, { id: second.id, name: second.name }, storage);
  assert.equal(loadDesign(first.id, storage).pages[0].background, '#eadbe6');
  assert.equal(deleteDesign(second.id, storage), true); assert.equal(listDesigns(storage).length, 1);
  assert.throws(() => loadDesign(second.id, storage), /not found/);
  assert.throws(() => saveDesign(createDocument(), { id: 'missing-id' }, storage), /not found/);
  assert.throws(() => deleteDesign('missing-id', storage), /not found/);
});

test('library backups round-trip; repeated merge skips exact saved records', () => {
  const source = new MemoryStorage(), destination = new MemoryStorage();
  const record = saveDesign(templateDocument('social'), {}, source);
  const text = exportLibrary(source);
  assert.ok(Buffer.byteLength(text) <= MAX_LIBRARY_BYTES);
  assert.deepEqual(importLibrary(text, {}, destination), { imported: 1, skipped: 0, total: 1 });
  assert.deepEqual(loadDesign(record.id, destination), record.document);
  const writes = destination.writes;
  assert.deepEqual(importLibrary(text, {}, destination), { imported: 0, skipped: 1, total: 1 });
  assert.equal(destination.writes, writes);
  const reordered = JSON.parse(text);
  reordered.designs[0] = { document: reordered.designs[0].document, updatedAt: record.updatedAt, name: record.name, id: record.id };
  assert.deepEqual(importLibrary(reordered, {}, destination), { imported: 0, skipped: 1, total: 1 });
});

test('all records are validated before an import writes, and ID conflicts never overwrite', () => {
  const storage = new MemoryStorage(), first = saveDesign(templateDocument('poster'), {}, storage);
  const before = storage.getItem(LIBRARY_KEY), writes = storage.writes;
  const valid = { ...first, id: 'a-new-design' }, invalid = { ...first, id: 'another-new-design', document: { ...first.document, unsupported: true } };
  assert.throws(() => importLibrary(backup([valid, invalid]), {}, storage), /unsupported/);
  assert.equal(storage.getItem(LIBRARY_KEY), before); assert.equal(storage.writes, writes);
  const conflict = { ...first, name: 'A different saved name' };
  assert.throws(() => importLibrary(backup([valid, conflict]), {}, storage), /different saved design/);
  assert.equal(storage.getItem(LIBRARY_KEY), before); assert.equal(storage.writes, writes);
  assert.deepEqual(importLibrary(backup([valid]), { mode: 'replace' }, storage), { imported: 1, skipped: 0, total: 1 });
  assert.equal(listDesigns(storage)[0].id, 'a-new-design');
});

test('invalid formats, dates, identifiers and duplicate IDs cannot change the library', () => {
  const storage = new MemoryStorage(), record = saveDesign(createDocument(), {}, storage), before = exportLibrary(storage);
  for (const payload of [
    '{bad-json',
    { ...backup([]), version: 99 },
    { ...backup([]), unknown: true },
    backup([{ ...record, extra: true }]),
    backup([{ ...record, id: '<script>' }]),
    backup([{ ...record, name: '   ' }]),
    backup([{ ...record, name: 'bad\nname' }]),
    backup([{ ...record, updatedAt: '2026-02-31T10:00:00.000Z' }]),
    JSON.stringify(backup([record, record]))
  ]) assert.throws(() => importLibrary(payload, {}, storage), LibraryError);
  assert.equal(exportLibrary(storage), before);
  assert.throws(() => importLibrary(backup([]), { mode: 'overwrite' }, storage), /Choose whether to add this backup to your saved designs or replace them\./);
});

test('prototype, accessor, hidden and cyclic object payloads are rejected without executing code', () => {
  const storage = new MemoryStorage(); let accessed = false;
  const accessor = backup([]);
  Object.defineProperty(accessor, 'designs', { enumerable: true, get() { accessed = true; return []; } });
  const hidden = backup([]); Object.defineProperty(hidden, 'hidden', { value: true });
  const customPrototype = Object.assign(Object.create({ malicious: true }), backup([]));
  const cycle = backup([]); cycle.designs.push(cycle);
  const symbol = backup([]); symbol[Symbol('private')] = true;
  const sparse = backup(Array(1));
  for (const payload of [accessor, hidden, customPrototype, cycle, symbol, sparse, '{"schema":"stencil-studio-library","version":1,"designs":[],"__proto__":{"polluted":true}}']) {
    assert.throws(() => importLibrary(payload, {}, storage), LibraryError);
  }
  assert.equal(accessed, false); assert.equal({}.polluted, undefined); assert.equal(storage.writes, 0);
});

test('legacy v1 documents migrate through the model at save and library-import boundaries', () => {
  const legacy = { schema: 'stencil-studio', version: 1, title: 'Legacy poster', pages: [{ id: 'legacy-page', name: 'Poster', width: 720, height: 960, background: '#f6f1e7', elements: [{ id: 'legacy-text', type: 'text', x: 64, y: 64, width: 360, height: 130, rotation: 0, fill: '#232a27', opacity: 1, text: 'A saved idea', fontFamily: 'Arial', fontSize: 48, fontWeight: 700, align: 'left' }] }] };
  const storage = new MemoryStorage(), saved = saveDesign(legacy, {}, storage);
  assert.equal(saved.document.version, VERSION); assert.equal(saved.document.pages[0].elements[0].locked, false);
  assert.equal(saved.document.pages[0].elements[0].text, 'A saved idea'); assert.equal(legacy.version, 1);
  const destination = new MemoryStorage();
  importLibrary(backup([{ ...saved, document: legacy }]), {}, destination);
  assert.deepEqual(loadDesign(saved.id, destination), saved.document);
  assert.equal(JSON.parse(exportLibrary(destination)).designs[0].document.version, VERSION);
});

test('unsafe document images cannot enter a saved or imported library', () => {
  const storage = new MemoryStorage(), record = saveDesign(createDocument(), {}, storage), before = exportLibrary(storage);
  for (const src of ['https://example.com/image.png', 'data:image/svg+xml;base64,PHN2Zz4=']) {
    const document = createDocument();
    document.pages[0].elements.push(createElement('image', { src }));
    assert.throws(() => saveDesign(document, {}, storage), /embedded/);
    assert.throws(() => importLibrary(backup([{ ...record, document }]), {}, storage), /embedded/);
  }
  assert.equal(exportLibrary(storage), before);
});

test('design-count and aggregate UTF-8 size limits preserve prior saved data', () => {
  const storage = new MemoryStorage();
  const first = saveDesign(createDocument(), {}, storage);
  for (let index = 1; index < MAX_DESIGNS; index++) saveDesign(createDocument(), { name: `Design ${index}` }, storage);
  const before = exportLibrary(storage);
  assert.throws(() => saveDesign(createDocument(), {}, storage), new RegExp(`up to ${MAX_DESIGNS}`));
  assert.throws(() => duplicateDesign(first.id, storage), new RegExp(`up to ${MAX_DESIGNS}`));
  assert.equal(exportLibrary(storage), before);
  assert.throws(() => importLibrary(' '.repeat(MAX_LIBRARY_BYTES + 1), {}, storage), /too large/);

  const large = createDocument();
  large.pages[0].elements = Array.from({ length: 260 }, () => createElement('text', { text: '界'.repeat(10000) }));
  const aggregate = backup(Array.from({ length: 3 }, (_, index) => ({ ...first, id: `large-${index}`, document: structuredClone(large) })));
  assert.ok(JSON.stringify(aggregate).length < MAX_LIBRARY_BYTES);
  assert.throws(() => importLibrary(aggregate, { mode: 'replace' }, storage), /too large/);
  assert.equal(exportLibrary(storage), before);
});

test('quota failures on save, duplicate, delete and replacement preserve the saved library', () => {
  const storage = new MemoryStorage(), record = saveDesign(templateDocument('poster'), {}, storage);
  const before = storage.getItem(LIBRARY_KEY); storage.full = true;
  for (const write of [
    () => saveDesign(createDocument(), {}, storage),
    () => saveDesign({ ...record.document, title: 'Changed' }, { id: record.id }, storage),
    () => duplicateDesign(record.id, storage),
    () => deleteDesign(record.id, storage),
    () => importLibrary(backup([]), { mode: 'replace' }, storage)
  ]) {
    assert.throws(write, error => error instanceof LibraryError && error.code === 'storage-write-failed' && /full or unavailable/.test(error.message));
    assert.equal(storage.getItem(LIBRARY_KEY), before);
  }
  assert.deepEqual(loadDesign(record.id, storage), record.document);
});

test('corrupt saved data is retained; explicit validated replacement can restore a backup', () => {
  const storage = new MemoryStorage(); storage.values.set(LIBRARY_KEY, 'corrupt saved data');
  assert.throws(() => listDesigns(storage), error => error.code === 'invalid-stored-library' && /stored data has been kept/.test(error.message));
  assert.throws(() => saveDesign(createDocument(), {}, storage), /stored data has been kept/);
  assert.equal(storage.getItem(LIBRARY_KEY), 'corrupt saved data');
  assert.deepEqual(importLibrary(backup([]), { mode: 'replace' }, storage), { imported: 0, skipped: 0, total: 0 });
  assert.deepEqual(listDesigns(storage), []);
  const unreadable = { getItem() { throw new Error('Denied'); }, setItem() { throw new Error('Denied'); } };
  assert.throws(() => listDesigns(unreadable), error => error.code === 'storage-unavailable');
});
