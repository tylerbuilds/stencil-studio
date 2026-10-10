import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { History, createBlankDesign, createElement, validateDocument, serialiseDocument, pageSVG } from '../../src/model.js';
import { saveDesign, loadDesign, listDesigns } from '../../src/library.js';
import { writeWithMigrationBackup } from '../../src/migration-storage.js';

const source = await readFile(new URL('../../src/app.js', import.meta.url), 'utf8');
function actualFunction(start, end) {
  const first = source.indexOf(start), last = source.indexOf(end, first);
  assert.ok(first >= 0 && last > first, `The actual ${start} controller is available`);
  return source.slice(first, last);
}
const controller = [
  actualFunction('function rememberSaved(', 'function keepActiveBinding('),
  actualFunction('function commit(', 'function closePageTools('),
  actualFunction('function openDocument(', 'function field('),
  actualFunction('function undoRedo(', "$('#undo').addEventListener"),
].join('\n');
const memoryStorage = () => {
  const values = new Map();
  return { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
};
function fixture() {
  const storage = memoryStorage(), documentA = createBlankDesign({ title: 'Poster A' }), documentB = createBlankDesign({ title: 'Card B', width: 1000, height: 600 });
  const savedA = saveDesign(documentA, { name: documentA.title }, storage), savedB = saveDesign(documentB, { name: documentB.title }, storage);
  const key = 'stencil-studio.document.v1', raw = serialiseDocument(documentA); storage.setItem(key, raw);
  const nodes = new Map();
  const context = vm.createContext({ History, initial: documentA, savedA, savedB, validateDocument, serialiseDocument, writeWithMigrationBackup, localStorage: storage, STORAGE_KEY: key, raw, namedDocument: (document, title) => ({ ...document, title }),
    $: selector => { if (!nodes.has(selector)) nodes.set(selector, {}); return nodes.get(selector); },
    setDrawMode() {}, cancelIntake() {}, closePageTools() {}, render() {}, keepActiveBinding() {}, toast() {},
  });
  vm.runInContext(`
    const history = new History(initial), historyBindings = new WeakMap(), savedBindings = new Map();
    let libraryId = null, pageId = initial.pages[0].id, selection = new Set(), fit = true, drag = null;
    let documentRevision = 0, cloudGeneration = 0, cloudSession = null, cloudStop = null, cloudBaseline = null, cloudPending = null;
    let expectedDocumentRaw = raw, storageHealthy = true;
    const page = () => history.current.pages.find(item => item.id === pageId) ?? history.current.pages[0];
    function persist() { const payload = serialiseDocument(history.current); writeWithMigrationBackup(localStorage, STORAGE_KEY, payload, 'document', { expectedRaw: expectedDocumentRaw }); expectedDocumentRaw = payload; return true; }
    ${controller}
    rememberSaved(savedA);
    savedBindings.set(savedB.id, { updatedAt: savedB.updatedAt, baseline: serialiseDocument(savedB.document) });
    globalThis.snapshot = () => ({ id: libraryId, document: history.current, binding: savedBindings.get(libraryId) });
    globalThis.changeTitle = title => commit(namedDocument(history.current, title));
  `, context);
  return { context, storage, savedA, savedB };
}

test('Undo after opening another named design restores the first association and cannot overwrite the second', () => {
  const { context, storage, savedA, savedB } = fixture();
  vm.runInContext('openDocument(savedB.document, savedB.id); undoRedo();', context);
  const current = context.snapshot();
  assert.equal(current.id, savedA.id); assert.equal(current.document.title, 'Poster A');
  saveDesign(current.document, { id: current.id, name: current.document.title, expectedUpdatedAt: current.binding.updatedAt }, storage);
  assert.deepEqual(loadDesign(savedB.id, storage), savedB.document);
  assert.equal(listDesigns(storage).length, 2);
});

test('Redo across a named-design switch restores its association; ordinary edit Undo retains it', () => {
  const { context, savedB } = fixture();
  vm.runInContext('openDocument(savedB.document, savedB.id); undoRedo(); undoRedo(true); changeTitle("Card B edited"); undoRedo();', context);
  assert.equal(context.snapshot().id, savedB.id);
  assert.equal(context.snapshot().document.title, 'Card B');
});

test('Undo into an unsaved design detaches its named target rather than replacing a library record', () => {
  const { context, savedB } = fixture();
  vm.runInContext('const blank = validateDocument(namedDocument(initial, "New scratch canvas")); openDocument(blank); openDocument(savedB.document, savedB.id); undoRedo();', context);
  assert.equal(context.snapshot().id, null);
  assert.equal(context.snapshot().document.title, 'New scratch canvas');
});


test('Duplicate design previews have isolated crop/filter/group IDs without changing stored document IDs', () => {
  const original = createBlankDesign(), picture = createElement('image', { id: 'picture', src: 'data:image/png;base64,iVBORw0KGgo=', sourceWidth: 1200, sourceHeight: 800, groupId: 'shared-group', filters: { brightness: 1.2, contrast: 1, saturation: 1, grayscale: 0, blur: 0 } });
  original.pages[0].elements.push(picture);
  const before = serialiseDocument(original), context = vm.createContext({ structuredClone, pageSVG, id: () => 'unused' });
  vm.runInContext(actualFunction('function savedDesignPreview(', 'function renderLibrary('), context);
  const first = context.savedDesignPreview(original.pages[0], 'preview-A'), second = context.savedDesignPreview(original.pages[0], 'preview-B');
  const firstIDs = [...first.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]), secondIDs = [...second.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);
  assert.ok(firstIDs.length >= 3);
  assert.ok(firstIDs.every(identifier => !secondIDs.includes(identifier)));
  for (const markup of [first, second]) { const identifiers = [...markup.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]); for (const reference of markup.matchAll(/url\(#([^)]+)\)/g)) assert.ok(identifiers.includes(reference[1])); }
  assert.equal(serialiseDocument(original), before);
});

/** Regression: a local variable named document shadowed DOM document before declaration, preventing every saved-card Open. */
test('the actual saved-card click listener preserves current work and opens its selected design', async () => {
  let click, preserved = 0, opened = null, blurred = 0;
  const messages = [], alpha = createBlankDesign({ title: 'Alpha' }), savedBindings = new Map();
  const record = { id: 'fictional-alpha', name: 'Alpha', updatedAt: '2026-10-10T12:00:00.000Z' };
  const button = { dataset: { openDesign: record.id }, addEventListener(type, listener) { assert.equal(type, 'click'); click = listener; } };
  const context = vm.createContext({
    $: () => ({ querySelectorAll: () => [button] }),
    document: { activeElement: { blur() { blurred++; } } },
    editingTarget: () => true,
    loadDesign(identifier) { assert.equal(identifier, record.id); return structuredClone(alpha); },
    listDesigns: () => [record],
    captureDesignState: () => ({ revision: 1 }),
    async preserveCurrentDesign() { preserved++; },
    requireDesignState(state, checkBinding) { assert.equal(state.revision, 1); assert.equal(checkBinding, false); },
    serialiseDocument, savedBindings,
    openDocument(document, identifier) { opened = { document, identifier }; return true; },
    renderLibrary() {},
    toast(message, error = false) { messages.push({ message, error }); },
  });
  const listener = actualFunction("  $('#saved-designs').querySelectorAll('[data-open-design]').forEach", "  $('#saved-designs').querySelectorAll('[data-rename-design]')");
  vm.runInContext(listener, context); await click();
  assert.equal(preserved, 1); assert.equal(blurred, 1);
  assert.equal(opened?.identifier, record.id); assert.equal(opened.document.title, 'Alpha');
  assert.equal(savedBindings.get(record.id).baseline, serialiseDocument(alpha));
  assert.ok(messages.length > 0); assert.ok(messages.every(message => !message.error));
});
