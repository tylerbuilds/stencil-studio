import test from 'node:test';
import assert from 'node:assert/strict';
import { crc32, deflateSync } from 'node:zlib';
import { readLimitedBytes, validateCatalogue, searchAssets, assetURL } from '../../src/asset-catalogue.js';
import { sanitiseAssetSVG } from '../../src/asset-svg.js';
import { classifyFiles, prepareFiles, checkImageDimensions } from '../../src/browser-intake.js';
import { buildPDF } from '../../src/export.js';
import { removeBackground, keyBackgroundPixels } from '../../src/image-tools.js';
import { parseDataCSV } from '../../src/data-csv.js';
import { COLLECTION_NOTICES, embedAssetNotice, collectAssetNotices } from '../../src/asset-notices.js';
import { decodeSelection, pasteSelection } from '../../src/transfer.js';
import { createBlankDesign, createElement, serialiseDocument, pageSVG } from '../../src/model.js';

/**
 * Sweep map: malformed/type confusion (PDF, uploads, catalogue, CSV), races
 * (abort while reading; independent concurrent intakes), boundaries/resources
 * (pre-decode pixel limit, SVG traversal, streaming budgets), corruption
 * (partial UTF-8/clipboard/notice metadata), injection (paths, literal text),
 * invalid assumptions (sparse arrays, stream availability, mutable results).
 * SQL/shell/filesystem injection is impossible: these modules never invoke
 * shells, databases or filesystem paths. All browser APIs below are mocks;
 * no browser launch, fetch or production storage is used.
 */

const jpeg = Uint8Array.from([255, 216, 255, 224, 0, 4, 0, 0, 255, 217]);
const page = { width: 720, height: 960, jpeg };
const nativeTimeout = globalThis.setTimeout;
const delay = ms => new Promise(resolve => nativeTimeout(resolve, ms));
function replaceGlobal(t, name, value) {
  const original = Object.getOwnPropertyDescriptor(globalThis, name);
  Object.defineProperty(globalThis, name, { value, writable: true, configurable: true });
  t.after(() => original ? Object.defineProperty(globalThis, name, original) : delete globalThis[name]);
}
function pngHeader(width, height) {
  const bytes = new Uint8Array(33), view = new DataView(bytes.buffer);
  bytes.set([137, 80, 78, 71, 13, 10, 26, 10]); view.setUint32(8, 13);
  bytes.set(new TextEncoder().encode('IHDR'), 12);
  view.setUint32(16, width); view.setUint32(20, height); bytes[24] = 8; bytes[25] = 6;
  view.setUint32(29, crc32(bytes.subarray(12, 29))); return bytes;
}
const dataURI = bytes => `data:image/png;base64,${Buffer.from(bytes).toString('base64')}`;
function catalogueFixture() {
  return { version: 1, collections: Object.entries(COLLECTION_NOTICES).map(([id, notice]) => ({ id, name: id, kind: id === 'tabler' ? 'icon' : id === 'fluent' ? 'sticker' : 'illustration', ...notice, revision: 'fictional-test', noticePath: `assets/licenses/${id}.txt`, noticeSha256: 'a'.repeat(64), noticeBytes: 100 })), assets: Array.from({ length: 80 }, (_, index) => ({ id: `tabler-test-${index}`, collection: 'tabler', name: `Test ${index}`, category: 'Fixture', tags: ['fictional'], path: `assets/svg/tabler/test-${index}.svg`, sha256: 'a'.repeat(64), bytes: 10 })) };
}

test('regression: sparse PDF pages must not declare absent objects in xref', () => {
  for (const pages of [new Array(1), [page, , page]]) assert.throws(() => buildPDF(pages), /pages|page/i);
});

test('regression: sparse file batches fail classification before any file is read', async () => {
  let reads = 0;
  const file = { name: 'good.txt', type: 'text/plain', size: 1, async arrayBuffer() { reads++; return Uint8Array.of(65).buffer; } };
  assert.throws(() => classifyFiles([file, , file]), /file/i);
  await assert.rejects(prepareFiles([file, , file]), /file/i);
  assert.equal(reads, 0);
});

test('regression: background removal rejects decompression excess before Image.decode', async t => {
  let decodes = 0;
  replaceGlobal(t, 'Image', class { async decode() { decodes++; this.naturalWidth = 16384; this.naturalHeight = 16384; } });
  await assert.rejects(removeBackground(dataURI(pngHeader(16384, 16384))), /four million pixels/);
  assert.equal(decodes, 0);
});

test('regression: an already cancelled non-stream response is never consumed', async () => {
  const controller = new AbortController(); controller.abort(); let reads = 0;
  const response = { ok: true, redirected: false, headers: new Headers(), async arrayBuffer() { reads++; return Uint8Array.of(1).buffer; } };
  await assert.rejects(readLimitedBytes(response, 2, controller.signal), { name: 'AbortError' });
  assert.equal(reads, 0);
});

test('regression: cancellation releases a blocked stream without waiting for another chunk', async () => {
  let cancelled = false;
  const stream = new ReadableStream({ pull() {}, cancel() { cancelled = true; } });
  const controller = new AbortController(), response = new Response(stream);
  const pending = readLimitedBytes(response, 10, controller.signal).then(() => 'resolved', error => error.name);
  controller.abort();
  assert.equal(await Promise.race([pending, delay(100).then(() => 'blocked')]), 'AbortError');
  assert.equal(cancelled, true); assert.equal(stream.locked, false);
});

function svgNode(children = []) {
  const attrs = new Map([['viewBox', '0 0 24 24']]);
  return { nodeType: 1, localName: 'svg', namespaceURI: 'http://www.w3.org/2000/svg', childNodes: children,
    get attributes() { return [...attrs].map(([name, value]) => ({ name, value, namespaceURI: null })); },
    getAttribute: name => attrs.get(name) ?? null, setAttribute: (name, value) => attrs.set(name, value),
    removeAttribute: name => attrs.delete(name), querySelectorAll: () => children };
}

test('regression: SVG child sprays hit the complexity limit before spreading the whole tree', t => {
  const children = Array.from({ length: 131000 }, () => ({ nodeType: 1, childNodes: [] })), svg = svgNode(children);
  replaceGlobal(t, 'DOMParser', class { parseFromString() { return { nodeType: 9, childNodes: [svg], documentElement: svg, querySelector: () => null }; } });
  assert.throws(() => sanitiseAssetSVG('<svg/>'), /too complex/);
});

test('regression: background editing rejects a forged raster MIME before the decoder', async t => {
  let decodes = 0;
  replaceGlobal(t, 'Image', class { async decode() { decodes++; throw new Error('decoder reached'); } });
  const gif = new TextEncoder().encode('GIF89a\x01\x00\x01\x00');
  await assert.rejects(removeBackground(dataURI(gif)), /uploaded PNG, JPEG or WebP/);
  assert.equal(decodes, 0);
});

test('stream size limits count all chunks and leave no partial success or held lock', async () => {
  let cancelled = 0;
  const stream = new ReadableStream({ start(controller) { controller.enqueue(Uint8Array.of(1, 2)); controller.enqueue(Uint8Array.of(3, 4)); }, cancel() { cancelled++; } });
  await assert.rejects(readLimitedBytes(new Response(stream, { headers: { 'content-length': '1' } }), 3), /too large/);
  assert.equal(cancelled, 1); assert.equal(stream.locked, false);
  const exact = await readLimitedBytes(new Response(Uint8Array.of(1, 2, 3)), 3);
  assert.deepEqual(exact, Uint8Array.of(1, 2, 3));
});

test('invalid byte budgets are rejected before consuming a response', async () => {
  let reads = 0;
  const response = { ok: true, redirected: false, headers: new Headers(), async arrayBuffer() { reads++; return new ArrayBuffer(0); } };
  for (const max of [NaN, Infinity, -1, 1.5, '3', null]) await assert.rejects(readLimitedBytes(response, max), /size limit/);
  assert.equal(reads, 0); assert.deepEqual(await readLimitedBytes(response, 0), new Uint8Array());
});

test('interleaved stream reads isolate cancellation from a successful neighbour', async () => {
  const controller = new AbortController(), blocked = new ReadableStream({ pull() {} });
  const stopped = readLimitedBytes(new Response(blocked), 20, controller.signal);
  const completed = readLimitedBytes(new Response(Uint8Array.of(8, 9, 10)), 3);
  controller.abort();
  await assert.rejects(stopped, { name: 'AbortError' });
  assert.deepEqual(await completed, Uint8Array.of(8, 9, 10));
});

test('fallback reads recheck cancellation after an in-flight buffer resolves', async () => {
  let finish;
  const controller = new AbortController(), response = { ok: true, redirected: false, headers: new Headers(), arrayBuffer: () => new Promise(resolve => { finish = resolve; }) };
  const pending = readLimitedBytes(response, 3, controller.signal);
  controller.abort(); finish(Uint8Array.of(1, 2, 3).buffer);
  await assert.rejects(pending, { name: 'AbortError' });
});

test('concurrent text intakes keep results and the original design independent', async () => {
  const document = createBlankDesign(), before = serialiseDocument(document); let complete;
  const delayed = { name: 'one.txt', type: 'text/plain', size: 3, arrayBuffer: () => new Promise(resolve => { complete = resolve; }) };
  const other = { name: 'two.txt', type: 'text/plain', size: 3, async arrayBuffer() { return new TextEncoder().encode('Two').buffer; } };
  const first = prepareFiles([delayed], { page: document.pages[0], brand: document.brand });
  const second = await prepareFiles([other], { page: document.pages[0], brand: document.brand });
  complete(new TextEncoder().encode('One').buffer);
  const result = await first; result.elements[0].text = 'Changed';
  assert.equal(second.elements[0].text, 'Two'); assert.equal(serialiseDocument(document), before);
});

test('truncated UTF-8 and file-size substitutions fail without returning partial layers', async () => {
  const document = createBlankDesign(), options = { page: document.pages[0], brand: document.brand };
  const file = bytes => ({ name: 'fixture.txt', type: 'text/plain', size: bytes.length, async arrayBuffer() { return bytes.buffer; } });
  await assert.rejects(prepareFiles([file(Uint8Array.of(65)), file(Uint8Array.of(0xe2, 0x82))], options), /UTF-8/);
  await assert.rejects(prepareFiles([{ ...file(Uint8Array.of(65, 66)), size: 1 }], options), /changed while/);
  assert.equal(document.pages[0].elements.length, 0);
});

test('hostile clipboard text and CSV cells stay literal through a new native SVG', () => {
  const document = createBlankDesign(), literal = '</text><script>alert(1)</script> $(touch /tmp/fictional) ../../secret =1+1\u202e';
  const data = parseDataCSV(`Name\n"${literal}"`, 'table');
  const payload = JSON.stringify({ schema: 'stencil-studio.clipboard', version: 1, sourcePage: { width: 64, height: 64 }, elements: [createElement('table', { data })] });
  const result = pasteSelection(document, document.pages[0].id, payload);
  assert.equal(result.pages[0].elements[0].data.rows[0][0], literal);
  const svg = pageSVG(result.pages[0]); assert(!svg.includes('<script>')); assert(svg.includes('&lt;script&gt;'));
  assert.equal(document.pages[0].elements.length, 0);
});

test('deep unexpected clipboard records and appended garbage cannot alter the target', () => {
  const document = createBlankDesign(), before = serialiseDocument(document), element = createElement('rect');
  const value = { schema: 'stencil-studio.clipboard', version: 1, sourcePage: { width: 64, height: 64 }, elements: [element] };
  let deep = {}; for (let index = 0; index < 200; index++) deep = { nested: deep };
  element.extra = deep;
  assert.throws(() => decodeSelection(JSON.stringify(value)), /unsupported/);
  assert.throws(() => pasteSelection(document, document.pages[0].id, JSON.stringify(value) + '\u0000'), /valid JSON/);
  assert.equal(serialiseDocument(document), before);
});

test('binary JPEG payload delimiters cannot move the PDF cross-reference table', () => {
  const opaque = Buffer.concat([Buffer.from([255, 216]), Buffer.from('\nendstream\nendobj\nxref\n/JavaScript (fictional)\n'), Buffer.from([255, 217])]);
  const output = buildPDF([{ width: 64, height: 4096, jpeg: opaque }]);
  const pdf = Buffer.from(output).toString('latin1');
  assert(pdf.includes(`/Length ${opaque.length} >>\nstream\n`));
  const start = Number(/startxref\n(\d+)\n%%EOF\n$/.exec(pdf)[1]);
  assert.equal(Buffer.from(output.subarray(start, start + 5)).toString(), 'xref\n');
  assert(Buffer.from(output).includes(opaque));
});

test('maximum PDF page count produces every object and rejects one more page', () => {
  const maximum = Array.from({ length: 30 }, () => ({ ...page })), output = buildPDF(maximum);
  const pdf = Buffer.from(output).toString('latin1');
  assert.match(pdf, /\/Count 30/); assert.match(pdf, /92 0 obj/); assert.match(pdf, /xref\n0 93\n/);
  assert.throws(() => buildPDF([...maximum, page]), /1 to 30/);
});

test('one-pixel background removal is bounded and keeps licensed notices in the new PNG', async t => {
  const ihdr = pngHeader(1, 1).subarray(16, 29);
  const chunk = (type, data) => { const out = Buffer.alloc(data.length + 12); out.writeUInt32BE(data.length); out.write(type, 4); out.set(data, 8); out.writeUInt32BE(crc32(out.subarray(4, -4)), out.length - 4); return out; };
  const png = Buffer.concat([Buffer.from(pngHeader(1, 1).subarray(0, 8)), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(Buffer.from([0, 255, 255, 255, 255]))), chunk('IEND', Buffer.alloc(0))]);
  const record = { collection: 'tabler', id: 'tabler-fixture', name: 'Fictional fixture', ...COLLECTION_NOTICES.tabler };
  const source = dataURI(embedAssetNotice(png, record)), pixels = new Uint8ClampedArray([255, 255, 255, 255]);
  replaceGlobal(t, 'Image', class { naturalWidth = 1; naturalHeight = 1; async decode() {} });
  replaceGlobal(t, 'document', { createElement: () => ({ getContext: () => ({ drawImage() {}, getImageData: () => ({ data: pixels }), putImageData() {} }), toDataURL: () => dataURI(png) }) });
  const next = await removeBackground(source, { colour: '#ffffff', tolerance: 0 });
  assert.equal(pixels[3], 0); assert.deepEqual(collectAssetNotices([{ type: 'image', src: next }]), [record]);
  assert.deepEqual(collectAssetNotices([{ type: 'image', src: source }]), [record]);
});

test('transparent one-pixel buffers and maximum tolerance preserve input ownership', () => {
  const input = new Uint8ClampedArray([1, 2, 3, 0]), output = keyBackgroundPixels(input, 1, 1, { colour: '#ffffff', tolerance: 255 });
  output[0] = 200; assert.equal(input[0], 1); assert.equal(output[3], 0);
  checkImageDimensions(1, 16384);
});

test('regression: accepted library items must fit the retained credit metadata limits', () => {
  for (const mutate of [asset => { asset.name = 'x'.repeat(101); }, asset => { asset.id = `tabler-${'x'.repeat(125)}`; }, asset => { asset.name = '<fictional>'; }]) {
    const catalogue = catalogueFixture(); mutate(catalogue.assets[0]);
    assert.throws(() => validateCatalogue(catalogue), /invalid item/);
  }
});

test('catalogue searches bound hostile queries and paging without reordering the source', () => {
  const catalogue = validateCatalogue(catalogueFixture()), before = JSON.stringify(catalogue);
  assert.equal(searchAssets(catalogue, { query: 'test 3' }).assets[0].name, 'Test 3');
  assert.equal(searchAssets(catalogue, { query: '界'.repeat(100000), page: Infinity }).assets.length, 36);
  assert.equal(searchAssets(catalogue, { query: 'Fíctíónal', page: 100000 }).page, 2);
  assert.equal(searchAssets(catalogue, { query: '$(fictional) ../../secret <script>' }).total, 0);
  assert.equal(JSON.stringify(catalogue), before);
  const oversized = catalogueFixture(); oversized.assets = Array(10001).fill(oversized.assets[0]);
  assert.throws(() => validateCatalogue(oversized), /cannot be opened/);
});

test('encoded traversal and protocol spellings cannot escape the same-origin asset directory', () => {
  for (const path of ['assets/svg/tabler/%2e%2e.svg', 'assets/svg/tabler/test%2fsecret.svg', 'assets/svg/tabler/test\\secret.svg', 'assets/svg/tabler/test.svg#x', 'assets/licenses/a.txt\u0000', 'https:\\example.test\\asset.svg']) assert.throws(() => assetURL(path));
  const result = new URL(assetURL('assets/svg/tabler/test-0.svg', 'https://fictional.test/stencil/src/asset-catalogue.js'));
  assert.equal(result.origin, 'https://fictional.test'); assert.equal(result.pathname, '/stencil/public/assets/svg/tabler/test-0.svg');
});

test('SVG policy accepts original inert primitives and rejects active or external attributes', t => {
  let svg = svgNode();
  replaceGlobal(t, 'DOMParser', class { parseFromString() { return { nodeType: 9, childNodes: [svg], documentElement: svg, querySelector: () => null }; } });
  replaceGlobal(t, 'XMLSerializer', class { serializeToString(value) { return `<svg width="${value.getAttribute('width')}" height="${value.getAttribute('height')}" fill="${value.getAttribute('fill')}"/>`; } });
  svg.setAttribute('fill', 'currentColor');
  const accepted = sanitiseAssetSVG('<svg/>', '#aabbcc'); assert.equal(accepted.width, 2000); assert.equal(accepted.height, 2000); assert(accepted.svg.includes('fill="#aabbcc"'));
  for (const [name, value] of [['onload', 'fictional()'], ['style', 'fill:red'], ['fill', 'url(https://fictional.test/x)'], ['fill', 'url(#absent)'], ['fill', 'url(\\23 unsafe)']]) {
    svg = svgNode(); svg.setAttribute(name, value);
    assert.throws(() => sanitiseAssetSVG('<svg/>'));
  }
  assert.throws(() => sanitiseAssetSVG('<!DOCTYPE svg><svg/>'), /safely/);
  assert.throws(() => sanitiseAssetSVG('x'.repeat(512 * 1024 + 1)), /safely/);
});
