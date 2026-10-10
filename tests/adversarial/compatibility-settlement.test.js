/** Earlier public-format names and stalled stream cleanup remain safe; all data/services are synthetic. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createDocument } from '../../src/model.js';
import { LIBRARY_KEY, LIBRARY_SCHEMA, LIBRARY_VERSION, listDesigns, loadDesign, exportLibrary, importLibrary, saveDesign, renameDesign, duplicateDesign } from '../../src/library.js';
import { generateWriting } from '../../src/ai-client.js';
import { createCloudClient } from '../../src/cloud-client.mjs';
import { readLimitedBytes } from '../../src/asset-catalogue.js';
function storage() { const records = new Map(); return { getItem: key => records.get(key) ?? null, setItem: (key, value) => records.set(key, value) }; }

test('previously valid bidi saved names stay exact and unrelated saved designs remain usable', () => {
  const memory = storage(), legacyName = '\u202eExisting design', older = createDocument(); older.title = legacyName;
  const plain = createDocument(); plain.title = 'Ordinary design';
  const records = [
    { id: 'old-bidi-design', name: legacyName, updatedAt: '2026-10-09T00:00:00.000Z', document: older },
    { id: 'ordinary-design', name: plain.title, updatedAt: '2026-10-09T00:00:00.001Z', document: plain }
  ];
  memory.setItem(LIBRARY_KEY, JSON.stringify({ schema: LIBRARY_SCHEMA, version: LIBRARY_VERSION, designs: records }));
  const original = memory.getItem(LIBRARY_KEY);
  assert.equal(listDesigns(memory).length, 2); assert.equal(listDesigns(memory).find(item => item.id === records[0].id).name, legacyName);
  assert.equal(loadDesign(records[1].id, memory).title, 'Ordinary design');
  const exported = exportLibrary(memory), other = storage(); importLibrary(exported, {}, other);
  assert.equal(JSON.parse(exportLibrary(other)).designs.find(item => item.id === records[0].id).name, legacyName);
  assert.equal(memory.getItem(LIBRARY_KEY), original);
  const saved = saveDesign({ ...older, pages: older.pages.map(page => ({ ...page, background: '#ffffff' })) }, { id: records[0].id, name: legacyName, expectedUpdatedAt: records[0].updatedAt }, memory);
  assert.equal(saved.name, legacyName);
  assert.equal(renameDesign(saved.id, legacyName, memory).name, legacyName);
  assert.equal(duplicateDesign(saved.id, memory).name, `${legacyName} copy`);
  assert.throws(() => saveDesign(createDocument(), { name: '\u202eNew name' }, memory));
  assert.throws(() => renameDesign(records[0].id, '\u202eChanged name', memory));
});

function neverSettlingCancellation(bytes, rejectCleanup = false) {
  let cancels = 0;
  const response = new Response(new ReadableStream({ start(controller) { controller.enqueue(bytes); }, cancel() { cancels++; return rejectCleanup ? Promise.reject(new Error('Synthetic cleanup failure')) : new Promise(() => {}); } }));
  return { response, cancellations: () => cancels };
}
async function settlesFailure(operation) {
  let timer;
  try { return await Promise.race([operation.then(() => 'resolved', error => error), new Promise(resolve => { timer = setTimeout(() => resolve('cleanup-stalled'), 150); })]); }
  finally { clearTimeout(timer); }
}

test('AI oversize refusal does not wait forever for the underlying stream cancellation', async t => {
  const stream = neverSettlingCancellation(new Uint8Array(128001));
  t.mock.method(globalThis, 'fetch', async () => stream.response);
  const result = await settlesFailure(generateWriting({ text: 'Fictional', task: 'rewrite' }));
  assert.ok(result instanceof Error); assert.match(result.message, /too large/);
  assert.equal(stream.cancellations(), 1); assert.equal(stream.response.body.locked, false);
});

test('AI malformed UTF-8 refusal keeps its original error despite stalled cancellation', async t => {
  const stream = neverSettlingCancellation(new Uint8Array([255]));
  t.mock.method(globalThis, 'fetch', async () => stream.response);
  const result = await settlesFailure(generateWriting({ text: 'Fictional', task: 'rewrite' }));
  assert.ok(result instanceof Error); assert.match(result.message, /respond|unreadable/);
  assert.equal(stream.cancellations(), 1); assert.equal(stream.response.body.locked, false);
});

test('cloud response limits settle and release reader locks despite stalled cancellation', async () => {
  const stream = neverSettlingCancellation(new Uint8Array(42 * 1024 * 1024 + 1));
  const client = createCloudClient({ fetchImpl: async () => stream.response });
  const result = await settlesFailure(client.open({ id: '00000000-0000-4000-8000-000000000001', token: 'x'.repeat(43) }));
  assert.ok(result instanceof Error); assert.equal(result.code, 'invalid_response');
  assert.equal(stream.cancellations(), 1); assert.equal(stream.response.body.locked, false);
});

test('asset oversize and abort refusals settle without awaiting stream teardown', async () => {
  const oversized = neverSettlingCancellation(new Uint8Array(9));
  const result = await settlesFailure(readLimitedBytes(oversized.response, 8));
  assert.ok(result instanceof Error); assert.match(result.message, /too large/);
  assert.equal(oversized.cancellations(), 1); assert.equal(oversized.response.body.locked, false);
  let cancels = 0;
  const blocked = new Response(new ReadableStream({ cancel() { cancels++; return new Promise(() => {}); } })), controller = new AbortController();
  const operation = readLimitedBytes(blocked, 8, controller.signal); controller.abort();
  const aborted = await settlesFailure(operation);
  assert.ok(aborted instanceof Error); assert.equal(aborted.name, 'AbortError');
  assert.equal(cancels, 1); assert.equal(blocked.body.locked, false);
});


test('AI refusal retains its error when stream cancellation rejects', async t => {
  for (const bytes of [new Uint8Array(128001), new Uint8Array([255])]) {
    const stream = neverSettlingCancellation(bytes, true); t.mock.method(globalThis, 'fetch', async () => stream.response);
    const result = await settlesFailure(generateWriting({ text: 'Fictional', task: 'rewrite' }));
    assert.ok(result instanceof Error); assert.ok(!result.message.includes('Synthetic cleanup failure'));
    assert.equal(stream.cancellations(), 1); assert.equal(stream.response.body.locked, false);
  }
});

test('cloud malformed UTF-8 refusal cancels without waiting and preserves invalid-response error', async () => {
  for (const rejectCleanup of [false, true]) {
    const stream = neverSettlingCancellation(new Uint8Array([255]), rejectCleanup);
    const client = createCloudClient({ fetchImpl: async () => stream.response });
    const result = await settlesFailure(client.open({ id: '00000000-0000-4000-8000-000000000001', token: 'x'.repeat(43) }));
    assert.ok(result instanceof Error); assert.equal(result.code, 'invalid_response');
    assert.equal(stream.cancellations(), 1); assert.equal(stream.response.body.locked, false);
  }
});

test('asset refusal preserves the size error when stream cancellation rejects', async () => {
  const stream = neverSettlingCancellation(new Uint8Array(9), true);
  const result = await settlesFailure(readLimitedBytes(stream.response, 8));
  assert.ok(result instanceof Error); assert.match(result.message, /too large/);
  assert.equal(stream.cancellations(), 1); assert.equal(stream.response.body.locked, false);
});
