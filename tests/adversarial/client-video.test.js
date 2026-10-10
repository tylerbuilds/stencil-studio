/** Network and image decoders are mocked; no remote services or user media are used. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { generateWriting, getAiStatus } from '../../src/ai-client.js';
import { createCloudClient, readShareLink } from '../../src/cloud-client.mjs';
import { createDocument, createElement } from '../../src/model.js';
import { previewTimeline } from '../../src/video.js';
const workspace = '00000000-0000-4000-8000-000000000001', token = 'x'.repeat(43);

test('AI calls reject redirected private text and omit cookies and referrer', async t => {
  let options; t.mock.method(globalThis, 'fetch', async (_url, config) => { options = config; return new Response(JSON.stringify({ text: 'A usable draft' })); });
  const result = await generateWriting({ text: 'Fictional private design words', direction: 'Shorter', task: 'rewrite' });
  assert.equal(result.text, 'A usable draft');
  assert.equal(options.redirect, 'error'); assert.equal(options.credentials, 'omit'); assert.equal(options.referrerPolicy, 'no-referrer');
});

test('AI null, empty, oversize and error objects become helpful bounded errors', async t => {
  let payload;
  t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify(payload)));
  for (payload of [null, false, [], { text: '' }, { text: 'x'.repeat(100001) }, { error: {} }]) {
    await assert.rejects(generateWriting({ text: 'Fictional', task: 'rewrite' }), error => !(error instanceof TypeError) && error.message.length <= 600);
  }
  payload = { enabled: true, model: 'x'.repeat(100001) };
  assert.deepEqual(await getAiStatus(), { enabled: true });
});

test('a 100K-plus unbounded AI body is refused while a malformed stream stays contained', async t => {
  let response = new Response(JSON.stringify({ text: 'Okay', unused: 'x'.repeat(128001) }));
  t.mock.method(globalThis, 'fetch', async () => response);
  await assert.rejects(generateWriting({ text: 'Fictional', task: 'rewrite' }), /too large/);
  response = new Response(new Uint8Array([0xff]));
  await assert.rejects(generateWriting({ text: 'Fictional', task: 'rewrite' }), /respond|unreadable/i);
});

test('cloud tokens and IDs must be strings without executing coercion hooks', async () => {
  let coercions = 0, calls = 0;
  const client = createCloudClient({ fetchImpl: async () => { calls++; return new Response('{}'); } });
  const coercedId = { toString() { coercions++; return workspace; } };
  const coercedToken = { toString() { coercions++; return token; } };
  for (const args of [{ id: coercedId, token }, { id: workspace, token: coercedToken }]) assert.throws(() => client.open(args), TypeError);
  assert.equal(coercions, 0); assert.equal(calls, 0);
});

test('non-HTTP share links and primitive success responses are rejected', async () => {
  assert.equal(readShareLink(`data:text/plain,design#workspace=${workspace}&token=${token}`), null);
  for (const payload of [null, 42, [], false]) {
    const client = createCloudClient({ fetchImpl: async () => new Response(JSON.stringify(payload)) });
    await assert.rejects(client.open({ id: workspace, token }), error => error.code === 'invalid_response');
  }
});

test('oversize video image headers are checked before allocating a native decoder', async t => {
  const bytes = new Uint8Array(24); bytes.set([137,80,78,71,13,10,26,10]); bytes.set([73,72,68,82],12);
  new DataView(bytes.buffer).setUint32(16, 10000); new DataView(bytes.buffer).setUint32(20, 10000);
  const src = `data:image/png;base64,${Buffer.from(bytes).toString('base64')}`;
  const document = createDocument(); document.pages[0].elements.push(createElement('image', { src, sourceWidth: 10000, sourceHeight: 10000 }));
  let decoders = 0;
  class ImageMock { constructor() { decoders++; } set src(value) { if(value) queueMicrotask(() => this.onerror?.()); } }
  const previous = globalThis.Image; globalThis.Image = ImageMock; t.after(() => { if (previous === undefined) delete globalThis.Image; else globalThis.Image = previous; });
  await assert.rejects(previewTimeline(document, { canvas: { getContext() { return {}; } } }), /24 million pixels/);
  assert.equal(decoders, 0);
});
