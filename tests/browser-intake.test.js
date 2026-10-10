import test from 'node:test';
import assert from 'node:assert/strict';
import { createDocument, createElement, editPage } from '../src/model.js';
import { classifyFiles, identifyRaster, checkImageDimensions, validatePlainText, placement, textElement, prepareFiles } from '../src/browser-intake.js';

test('file batches reject an unsupported member or mixed document before reading any bytes', () => {
  const image = { type: 'image/png', name: 'picture.png', size: 20 };
  assert.deepEqual(classifyFiles([image, { type: 'text/plain', name: 'copy.txt', size: 30 }]), ['image', 'text']);
  for (const bad of [{ type: 'image/svg+xml', name: 'unsafe.svg', size: 20 }, { type: 'image/png', size: 6 * 1024 * 1024 + 1 }, { type: '', name: 'empty.txt', size: 0 }]) assert.throws(() => classifyFiles([image, bad]));
  assert.throws(() => classifyFiles([image, { type: 'application/json', name: 'design.json', size: 10 }]));
  assert.throws(() => classifyFiles(Array.from({ length: 21 }, () => image)));
  assert.throws(() => classifyFiles([{ ...image, size: 5 * 1024 * 1024 }, { ...image, size: 5 * 1024 * 1024 }]));
});
test('signature and pixel limits reject disguised markup and large decompression before browser decoding', () => {
  const png = Uint8Array.from([137,80,78,71,13,10,26,10,0,0,0,13,73,72,68,82,0,0,2,0,0,0,1,0]);
  assert.deepEqual(identifyRaster(png), { type: 'image/png', width: 512, height: 256 });
  assert.deepEqual(identifyRaster(new TextEncoder().encode('GIF89a\x02\x00\x03\x00')), { type: 'image/gif', width: 2, height: 3 });
  assert.throws(() => identifyRaster(new TextEncoder().encode('<svg onload="fetch(1)"></svg>')));
  assert.throws(() => checkImageDimensions(16000, 16000));
  assert.throws(() => checkImageDimensions(0, 20));
  checkImageDimensions(4000, 3000);
});
test('plain text is literal, exact Unicode/newlines survive and unsupported controls/oversize fail', () => {
  const doc = createDocument(), text = '\nHeading\r\n<script>&界 https://example.test/a';
  const element = textElement(text, doc.pages[0], doc.brand, { x: 200, y: 250 });
  assert.equal(element.text, text); assert.equal(element.x + element.width / 2, 210); // The frame's left edge clamps to the canvas.
  assert.equal(validatePlainText('界'.repeat(10000)).length, 10000);
  assert.throws(() => validatePlainText('a'.repeat(10001))); assert.throws(() => validatePlainText('\u0000'));
  assert.deepEqual(placement({ width: 100, height: 100 }, 40, 20, { x: 95, y: 5 }), { x: 60, y: 0 });
});
test('ordered UTF8 text-file preparation is atomic, abortable and does not mutate the active document', async () => {
  const doc = createDocument(), original = JSON.stringify(doc), make = (name, text) => { const bytes = new TextEncoder().encode(text); return { name, type: 'text/plain', size: bytes.length, arrayBuffer: async () => bytes.buffer }; };
  const prepared = await prepareFiles([make('one.txt', 'First'), make('two.txt', 'Second')], { page: doc.pages[0], brand: doc.brand });
  assert.deepEqual(prepared.elements.map(e => e.text), ['First', 'Second']); assert.equal(prepared.elements[1].x - prepared.elements[0].x, 24); assert.equal(JSON.stringify(doc), original);
  await assert.rejects(prepareFiles([make('one.txt', 'First'), make('two.txt', '\u0000')], { page: doc.pages[0], brand: doc.brand }));
  const bytes = Uint8Array.from([255]); await assert.rejects(prepareFiles([{ name: 'bad.txt', type: 'text/plain', size: 1, arrayBuffer: async () => bytes.buffer }], { page: doc.pages[0], brand: doc.brand }), /UTF-8/);
  const controller = new AbortController(); controller.abort(); await assert.rejects(prepareFiles([make('one.txt', 'First')], { page: doc.pages[0], brand: doc.brand, signal: controller.signal }), { name: 'AbortError' });
  assert.equal(JSON.stringify(doc), original);
});
