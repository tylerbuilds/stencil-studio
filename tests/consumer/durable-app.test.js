import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { createBlankDesign, parseDocument, serialiseDocument } from '../../src/model.js';

const source = await readFile(new URL('../../src/app.js', import.meta.url), 'utf8');
const preservation = source.slice(source.indexOf('async function preserveCurrentDesign('), source.indexOf('async function startNewDocument('));
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
function fixture() {
  const document = createBlankDesign({ title: 'Current work' }), raw = serialiseDocument(document), committed = deferred(), events = [];
  const binding = { updatedAt: '2026-10-10T10:00:00.000Z', baseline: 'Earlier saved version' };
  const context = {
    pristineDocument: null, recoveryPreserved: true, libraryId: 'original-id', savedBindings: new Map([['original-id', binding]]), history: { current: document }, parseDocument,
    captureDesignState: () => ({ document: raw }), requireDesignState: () => {},
    saveDesign(value, options) { events.push('staged'); assert.deepEqual(value, document); assert.equal(options.id, 'original-id'); return { id: 'original-id', updatedAt: '2026-10-10T11:00:00.000Z', document: value }; },
    async withLibraryLock(operation) { const record = operation(); await committed.promise; events.push('committed'); return record; },
    rememberSaved(record) { events.push('bound'); context.libraryId = record.id; context.savedBindings.set(record.id, { updatedAt: record.updatedAt, baseline: raw }); }
  };
  const result = runInNewContext(`${preservation}\npreserveCurrentDesign();`, context);
  return { result, context, committed, events, binding };
}
test('actual design preservation cannot bind a staged record whose durable transaction later fails', async () => {
  const { result, context, committed, events, binding } = fixture();
  assert.deepEqual(events, ['staged']); assert.deepEqual(context.savedBindings.get('original-id'), binding);
  const assertion = assert.rejects(result, /current design is still open.*quota/); committed.reject(new Error('Disk quota refused the commit')); await assertion;
  assert.deepEqual(events, ['staged']); assert.deepEqual(context.savedBindings.get('original-id'), binding); assert.equal(context.libraryId, 'original-id');
});
test('actual design preservation updates its saved association only after the transaction completes', async () => {
  const { result, context, committed, events } = fixture(); assert.deepEqual(events, ['staged']);
  committed.resolve(); const record = await result; assert.deepEqual(events, ['staged', 'committed', 'bound']);
  assert.equal(context.savedBindings.get(record.id).updatedAt, record.updatedAt); assert.equal(context.savedBindings.get(record.id).baseline, serialiseDocument(record.document));
});
test('actual preservation leaves an independently changed canvas association intact after a slow commit', async () => {
  const { result, context, committed, events } = fixture();
  context.requireDesignState = () => { throw new Error('The user opened another design'); };
  const assertion = assert.rejects(result, /current design is still open.*another design/); committed.resolve(); await assertion;
  assert.deepEqual(events, ['staged', 'committed']); assert.equal(context.savedBindings.get('original-id').updatedAt, '2026-10-10T10:00:00.000Z');
});

test('actual external-draft notification clears a stale saved claim without replacing the canvas', () => {
  const document = createBlankDesign({ title: 'This tab' }), raw = serialiseDocument(document), node = { textContent: 'Saved on this device' };
  let callback, bindingUpdates = 0, stored = raw;
  const first = source.indexOf('browserStorage?.subscribe?.('), last = source.indexOf("window.addEventListener('focus'", first);
  const context = { STORAGE_KEY: 'draft', LIBRARY_KEY: 'library', storageHealthy: true, history: { current: document }, serialiseDocument,
    browserStorage: { getItem: () => stored, subscribe: handler => { callback = handler; } },
    $: () => node, keepActiveBinding: () => { bindingUpdates++; }, renderLibrary: () => {}, renderUploads: () => {},
  };
  runInNewContext(source.slice(first, last), context);
  callback({ keys: ['draft'], external: false }); callback({ keys: ['draft'], external: true });
  assert.equal(node.textContent, 'Saved on this device'); assert.equal(bindingUpdates, 0);
  stored = serialiseDocument(createBlankDesign({ title: 'Other tab' })); callback({ keys: ['draft'], external: true });
  assert.equal(context.storageHealthy, false); assert.equal(bindingUpdates, 1); assert.equal(node.textContent, 'Newer draft in another tab. Save a copy'); assert.equal(serialiseDocument(document), raw);
});
