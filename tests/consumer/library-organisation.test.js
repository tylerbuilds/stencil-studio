/** Fictitious in-memory records only: persistence, migration and recovery boundaries. */
import test from 'node:test';
import assert from 'node:assert/strict';
import * as library from '../../src/library.js';
import { VERSION, DEFAULT_BRAND, DEFAULT_GUIDE_SETTINGS, createDocument, createElement } from '../../src/model.js';

class MemoryStorage {
  values = new Map(); writes = 0; full = false;
  getItem(key) { return this.values.get(key) ?? null; }
  setItem(key, value) { if (this.full) throw new DOMException('Quota exceeded', 'QuotaExceededError'); this.values.set(key, String(value)); this.writes++; }
}
const raw = storage => storage.getItem(library.LIBRARY_KEY);
const backup = storage => JSON.parse(library.exportLibrary(storage));
const current = (id, storage) => library.listDesignSummaries(storage).find(record => record.id === id);

test('v1 libraries migrate lazily, retaining every name, document and exact recovery source', () => {
  const storage = new MemoryStorage();
  const legacy = { schema: library.LIBRARY_SCHEMA, version: 1, designs: [1, 2, 3, 4].map(version => ({
    id: `legacy-${version}`, name: `Legacy ${version}`, updatedAt: '2026-01-01T00:00:00.000Z',
    document: { schema: 'stencil-studio', version, title: `Content ${version}`, ...(version >= 2 ? { brand: structuredClone(DEFAULT_BRAND) } : {}), pages: [{ id: `page-${version}`, name: 'Poster', width: 720, height: 960, background: '#f6f1e7', elements: [], ...(version >= 3 ? { transparentBackground: false, guides: [], guideSettings: structuredClone(DEFAULT_GUIDE_SETTINGS) } : {}) }] }
  })) };
  const original = JSON.stringify(legacy, null, 2); storage.values.set(library.LIBRARY_KEY, original);
  assert.equal(library.listDesignSummaries(storage).length, 4); assert.equal(raw(storage), original); assert.equal(storage.writes, 0);
  for (const record of legacy.designs) { assert.equal(library.loadDesign(record.id, storage).version, VERSION); assert.equal(library.loadDesign(record.id, storage).title, record.document.title); }
  library.createFolder('Old sketches', storage);
  assert.equal(backup(storage).version, 2);
  assert.ok([...storage.values].some(([key, value]) => key.includes('.migration.') && value === original));
  assert.deepEqual(library.listDesigns(storage).map(item => item.name).sort(), legacy.designs.map(item => item.name).sort());
  for (const record of library.listDesignSummaries(storage)) { assert.equal(record.folderId, null); assert.deepEqual(record.tags, []); assert.equal(record.favourite, false); assert.equal(record.versionCount, 0); }
});

test('a pure v1 library-format migration retains a recovery source and fails safely without backup space', () => {
  const storage = new MemoryStorage(), document = createDocument();
  const original = JSON.stringify({ schema: library.LIBRARY_SCHEMA, version: 1, designs: [{ id: 'old-library', name: 'Unchanged name', updatedAt: '2026-01-01T00:00:00.000Z', document }] });
  storage.values.set(library.LIBRARY_KEY, original); storage.full = true;
  assert.throws(() => library.createFolder('Archive', storage), error => error.code === 'storage-write-failed'); assert.equal(raw(storage), original);
  storage.full = false; library.createFolder('Archive', storage);
  assert.ok([...storage.values].some(([key, value]) => key.includes('.migration.') && value === original));
});

test('model migration retains the exact v2 source when only historical and trashed documents are old', () => {
  const storage = new MemoryStorage(), first = library.saveDesign(createDocument(), {}, storage), second = library.saveDesign(createDocument(), {}, storage);
  library.renameDesign(first.id, 'New current', storage); library.deleteDesign(second.id, storage);
  const earlierDocument = id => ({ schema: 'stencil-studio', version: 1, title: 'Earlier content', pages: [{ id, name: 'Page', width: 720, height: 960, background: '#f6f1e7', elements: [] }] });
  const value = backup(storage); value.designs[0].versions[0].document = earlierDocument('history-old-page'); value.trash[0].document = earlierDocument('trash-old-page');
  const original = JSON.stringify(value, null, 2); storage.values.set(library.LIBRARY_KEY, original);
  assert.equal(library.listDesignVersions(first.id, storage)[0].documentVersion, VERSION); assert.equal(raw(storage), original);
  library.createFolder('Model upgrade', storage);
  assert.ok([...storage.values].some(([key, raw]) => key.includes('.migration.') && raw === original));
  assert.equal(backup(storage).designs[0].versions[0].document.version, VERSION); assert.equal(backup(storage).trash[0].document.version, VERSION);
});

test('folders, tags and favourites persist, isolate caller data and unfile safely on folder deletion', () => {
  const storage = new MemoryStorage(), folder = library.createFolder(' Sketches ', storage), first = library.saveDesign(createDocument(), { name: 'Cover' }, storage), second = library.saveDesign(createDocument(), { name: 'Back cover' }, storage);
  const patch = { folderId: folder.id, tags: ['Print', 'Summer'], favourite: true };
  const updated = library.updateDesignMetadata(first.id, patch, storage, { expectedUpdatedAt: first.updatedAt }); patch.tags[0] = 'Changed caller'; updated.tags[0] = 'Changed return';
  library.updateDesignMetadata(second.id, { folderId: folder.id }, storage); library.deleteDesign(second.id, storage);
  const deletedAt = library.listTrash(storage)[0].deletedAt;
  assert.deepEqual(current(first.id, storage).tags, ['Print', 'Summer']); assert.equal(current(first.id, storage).favourite, true); assert.equal(current(first.id, storage).versionCount, 0);
  const renamed = library.renameFolder(folder.id, 'Prints', storage, { expectedUpdatedAt: folder.updatedAt }); assert.equal(library.listFolders(storage)[0].name, 'Prints'); assert.equal(library.listFolders(storage)[0].designCount, 1);
  const document = library.loadDesign(first.id, storage);
  library.deleteFolder(folder.id, storage, { expectedUpdatedAt: renamed.updatedAt });
  assert.equal(current(first.id, storage).folderId, null); assert.equal(library.listTrash(storage)[0].folderId, null); assert.equal(library.listTrash(storage)[0].deletedAt, deletedAt); assert.deepEqual(library.loadDesign(first.id, storage), document);
});

test('deletion is recoverable across reopen and permanent deletion is restricted to Trash', () => {
  const storage = new MemoryStorage(), saved = library.saveDesign(createDocument(), { name: 'Keep me' }, storage);
  assert.throws(() => library.permanentlyDeleteDesign(saved.id, storage), /Deleted design not found/);
  assert.equal(library.deleteDesign(saved.id, storage, { expectedUpdatedAt: saved.updatedAt }), true); assert.equal(library.listDesigns(storage).length, 0); assert.throws(() => library.loadDesign(saved.id, storage), /not found/);
  const destination = new MemoryStorage(); library.importLibrary(library.exportLibrary(storage), {}, destination);
  const trashed = library.listTrash(destination)[0], restored = library.restoreDesign(saved.id, destination, { expectedUpdatedAt: trashed.updatedAt });
  assert.deepEqual(restored.document, saved.document); assert.equal(restored.name, saved.name); assert.equal(library.listTrash(destination).length, 0);
  library.deleteDesign(restored.id, destination); assert.equal(library.permanentlyDeleteDesign(restored.id, destination), true); assert.equal(library.listTrash(destination).length, 0);
});

test('Trash counts towards the configured saved-design cap and explicit permanent deletion releases room', () => {
  const storage = new MemoryStorage(); let first;
  for (let i = 0; i < library.MAX_DESIGNS; i++) { const saved = library.saveDesign(createDocument(), { name: `Design ${i}` }, storage); first ??= saved; }
  library.deleteDesign(first.id, storage); const before = raw(storage);
  assert.throws(() => library.saveDesign(createDocument(), {}, storage), /including Trash/); assert.equal(raw(storage), before);
  library.permanentlyDeleteDesign(first.id, storage); library.saveDesign(createDocument(), {}, storage); assert.equal(library.listDesigns(storage).length, library.MAX_DESIGNS);
});

test('a named save commits metadata atomically and retains omitted organisation on later saves', () => {
  const storage = new MemoryStorage(), folder = library.createFolder('For print', storage);
  let saved = library.saveDesign(createDocument(), { name: 'Cover', folderId: folder.id, tags: ['Print'], favourite: true }, storage);
  assert.equal(saved.folderId, folder.id); assert.deepEqual(saved.tags, ['Print']); assert.equal(saved.favourite, true);
  saved = library.saveDesign({ ...saved.document, title: 'Changed' }, { id: saved.id, name: saved.name, expectedUpdatedAt: saved.updatedAt }, storage);
  assert.equal(saved.folderId, folder.id); assert.deepEqual(saved.tags, ['Print']); assert.equal(saved.favourite, true);
  const before = raw(storage); assert.throws(() => library.saveDesign(saved.document, { id: saved.id, name: 'Bad save', folderId: 'missing' }, storage), /Folder not found/); assert.equal(raw(storage), before);
  saved = library.saveDesign(saved.document, { id: saved.id, name: saved.name, folderId: null, tags: [], favourite: false }, storage);
  assert.equal(saved.folderId, null); assert.deepEqual(saved.tags, []); assert.equal(saved.favourite, false);
});

test('the last five prior saved versions persist and restoring one preserves the current content', () => {
  const storage = new MemoryStorage(); let record = library.saveDesign({ ...createDocument(), title: 'Revision 0' }, {}, storage);
  for (let i = 1; i <= 7; i++) record = library.saveDesign({ ...record.document, title: `Revision ${i}` }, { id: record.id, name: `Revision ${i}`, expectedUpdatedAt: record.updatedAt }, storage);
  const versions = library.listDesignVersions(record.id, storage);
  assert.equal(versions.length, 5); assert.deepEqual(versions.map(version => version.name), ['Revision 6', 'Revision 5', 'Revision 4', 'Revision 3', 'Revision 2']); assert.ok(versions.every(version => !Object.hasOwn(version, 'document')));
  const target = versions.at(-1), restored = library.restoreDesignVersion(record.id, target.id, storage, { expectedUpdatedAt: record.updatedAt });
  assert.equal(restored.document.title, 'Revision 2'); assert.equal(restored.name, 'Revision 2'); assert.equal(library.listDesignVersions(record.id, storage)[0].name, 'Revision 7');
  const destination = new MemoryStorage(); library.importLibrary(library.exportLibrary(storage), {}, destination); assert.deepEqual(library.loadDesign(record.id, destination), restored.document); assert.equal(library.listDesignVersions(record.id, destination).length, 5);
  const cleared = library.clearDesignVersions(record.id, destination); assert.equal(cleared.versions.length, 0); assert.equal(library.listDesignVersions(record.id, destination).length, 0);
});

test('unchanged saves and metadata changes do not consume content-history slots; duplication starts fresh', () => {
  const storage = new MemoryStorage(); let record = library.saveDesign(createDocument(), { name: 'Same' }, storage);
  record = library.saveDesign(record.document, { id: record.id, name: record.name }, storage); record = library.updateDesignMetadata(record.id, { favourite: true }, storage); assert.equal(record.versions.length, 0);
  record = library.renameDesign(record.id, 'New title', storage); assert.equal(record.versions.length, 1);
  const duplicate = library.duplicateDesign(record.id, storage); assert.equal(duplicate.versions.length, 0); assert.equal(duplicate.favourite, true); assert.equal(library.listDesignVersions(record.id, storage).length, 1);
});

test('malformed v2 folders, references, metadata, history and Trash are rejected before any write', () => {
  const storage = new MemoryStorage(), saved = library.saveDesign(createDocument(), {}, storage); library.renameDesign(saved.id, 'Second', storage); const good = backup(storage), before = raw(storage);
  const cases = [
    value => { value.designs[0].folderId = 'missing'; },
    value => { value.folders.push({ id: saved.id, name: 'Collision', updatedAt: saved.updatedAt }); },
    value => { value.designs[0].tags = ['Print', ' print ']; },
    value => { value.designs[0].favourite = 'yes'; },
    value => { value.designs[0].favourite = null; },
    value => { value.designs[0].tags = null; },
    value => { value.designs[0].versions = null; },
    value => { value.folders = null; },
    value => { value.trash = null; },
    value => { value.designs[0].versions[0].document.extra = true; },
    value => { value.designs[0].versions[0].savedAt = value.designs[0].updatedAt; },
    value => { value.designs[0].versions.push(structuredClone(value.designs[0].versions[0])); },
    value => { value.trash.push({ ...value.designs[0], id: 'trashed', versions: [], deletedAt: 'bad date' }); },
    value => { value.unknown = true; }
  ];
  for (const mutate of cases) { const candidate = structuredClone(good); mutate(candidate); assert.throws(() => library.importLibrary(candidate, { mode: 'replace' }, storage), library.LibraryError); assert.equal(raw(storage), before); }
  let evaluated = false; const patch = {}; Object.defineProperty(patch, 'favourite', { enumerable: true, get() { evaluated = true; return true; } }); assert.throws(() => library.updateDesignMetadata(saved.id, patch, storage)); assert.equal(evaluated, false);
});

test('all new mutations respect timestamp guards and leave another tab’s changes intact', () => {
  const storage = new MemoryStorage(), saved = library.saveDesign(createDocument(), {}, storage), updated = library.renameDesign(saved.id, 'Newer', storage), before = raw(storage);
  for (const mutate of [() => library.updateDesignMetadata(saved.id, { favourite: true }, storage, { expectedUpdatedAt: saved.updatedAt }), () => library.restoreDesignVersion(saved.id, updated.versions[0].id, storage, { expectedUpdatedAt: saved.updatedAt }), () => library.clearDesignVersions(saved.id, storage, { expectedUpdatedAt: saved.updatedAt })]) { assert.throws(mutate, error => error.code === 'design-conflict'); assert.equal(raw(storage), before); }
  library.deleteDesign(saved.id, storage); const trashed = library.listTrash(storage)[0], trashRaw = raw(storage);
  for (const mutate of [library.restoreDesign, library.permanentlyDeleteDesign]) { assert.throws(() => mutate(saved.id, storage, { expectedUpdatedAt: updated.updatedAt }), error => error.code === 'design-conflict'); assert.equal(raw(storage), trashRaw); }
  const folder = library.createFolder('Folder', storage); library.renameFolder(folder.id, 'Other tab', storage); const folderRaw = raw(storage);
  for (const mutate of [() => library.renameFolder(folder.id, 'Stale', storage, { expectedUpdatedAt: folder.updatedAt }), () => library.deleteFolder(folder.id, storage, { expectedUpdatedAt: folder.updatedAt })]) { assert.throws(mutate, error => error.code === 'design-conflict'); assert.equal(raw(storage), folderRaw); }
  assert.ok(trashed.deletedAt);
});

test('quota failures on metadata, recovery, history and folder writes retain exact stored data', () => {
  const storage = new MemoryStorage(), folder = library.createFolder('Folder', storage), first = library.saveDesign(createDocument(), {}, storage), second = library.saveDesign(createDocument(), {}, storage);
  library.renameDesign(first.id, 'Changed', storage); library.deleteDesign(second.id, storage); const version = library.listDesignVersions(first.id, storage)[0], before = raw(storage); storage.full = true;
  for (const mutate of [() => library.createFolder('New', storage), () => library.renameFolder(folder.id, 'Changed', storage), () => library.deleteFolder(folder.id, storage), () => library.updateDesignMetadata(first.id, { favourite: true }, storage), () => library.restoreDesign(second.id, storage), () => library.permanentlyDeleteDesign(second.id, storage), () => library.emptyTrash(storage), () => library.restoreDesignVersion(first.id, version.id, storage), () => library.clearDesignVersions(first.id, storage)]) { assert.throws(mutate, error => error.code === 'storage-write-failed'); assert.equal(raw(storage), before); }
});

test('history budget overflow keeps every prior snapshot until an explicit clear', () => {
  const storage = new MemoryStorage(), document = createDocument(); document.pages[0].elements = Array.from({ length: 300 }, () => createElement('text', { text: '界'.repeat(7000) }));
  let saved = library.saveDesign(document, { name: 'Large 0' }, storage);
  saved = library.saveDesign({ ...saved.document, title: 'Large 1' }, { id: saved.id, name: 'Large 1' }, storage); const before = raw(storage), versions = library.listDesignVersions(saved.id, storage);
  assert.throws(() => library.saveDesign({ ...saved.document, title: 'Large 2' }, { id: saved.id, name: 'Large 2' }, storage), /too large/); assert.equal(raw(storage), before); assert.deepEqual(library.listDesignVersions(saved.id, storage), versions);
  library.clearDesignVersions(saved.id, storage); library.saveDesign({ ...saved.document, title: 'Large 2' }, { id: saved.id, name: 'Large 2' }, storage); assert.equal(library.loadDesign(saved.id, storage).title, 'Large 2');
});

test('concurrent state arriving during v1 format backup survives the guarded commit', () => {
  const storage = new MemoryStorage(); const original = JSON.stringify({ schema: library.LIBRARY_SCHEMA, version: 1, designs: [] }); storage.values.set(library.LIBRARY_KEY, original);
  const setItem = storage.setItem.bind(storage), newer = JSON.stringify({ schema: library.LIBRARY_SCHEMA, version: 2, designs: [], folders: [], trash: [] });
  storage.setItem = (key, value) => { setItem(key, value); if (key.includes('.migration.')) setItem(library.LIBRARY_KEY, newer); };
  assert.throws(() => library.createFolder('Stale folder', storage), error => error.code === 'library-conflict'); assert.equal(raw(storage), newer); assert.ok([...storage.values].some(([key, value]) => key.includes('.migration.') && value === original));
});

test('backups merge folders and Trash idempotently; conflicting identities cannot lose recovery content', () => {
  const storage = new MemoryStorage(), folder = library.createFolder('Archive', storage), record = library.saveDesign(createDocument(), {}, storage); library.updateDesignMetadata(record.id, { folderId: folder.id, tags: ['Keep'] }, storage); library.deleteDesign(record.id, storage);
  const exported = library.exportLibrary(storage), destination = new MemoryStorage(); library.importLibrary(exported, {}, destination); const before = raw(destination); library.importLibrary(exported, {}, destination); assert.equal(raw(destination), before); assert.equal(library.listFolders(destination).length, 1); assert.equal(library.listTrash(destination).length, 1);
  const different = JSON.parse(exported); different.folders[0].name = 'Different'; assert.throws(() => library.importLibrary(different, {}, destination), /different folder/); assert.equal(raw(destination), before);
  library.restoreDesign(record.id, destination); const restoredRaw = raw(destination); assert.throws(() => library.importLibrary(exported, {}, destination), /different saved design/); assert.equal(raw(destination), restoredRaw);
});
