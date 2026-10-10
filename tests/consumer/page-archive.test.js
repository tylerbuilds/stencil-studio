/** ZIP bytes only: fictitious page rasters, no browser or native image decoder. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPageArchive, exportSlug, MAX_ARCHIVE_BYTES, MAX_ARCHIVE_PIXELS } from '../../src/page-archive.js';
import { createDocument, createPage } from '../../src/model.js';

const tick = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const raster = (bytes = [1, 2, 3], mime = 'image/png') => new Blob([Uint8Array.from(bytes)], { type: mime });
function design(count = 3, width = 720, height = 960) {
  const document = createDocument(); document.title = 'Summer carousel';
  document.pages = Array.from({ length: count }, (_, index) => ({ ...createPage(width, height), id: `archive-page-${index + 1}`, name: `Page ${index + 1}` }));
  return document;
}

// Separate bit-at-a-time implementation rather than the writer's lookup table.
function referenceCRC(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) { crc ^= byte; for (let bit = 0; bit < 8; bit++) crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1; }
  return (crc ^ 0xffffffff) >>> 0;
}
async function inspectZIP(blob) {
  assert.equal(blob.type, 'application/zip');
  const bytes = new Uint8Array(await blob.arrayBuffer()), view = new DataView(bytes.buffer), text = new TextDecoder('utf-8', { fatal: true });
  const u16 = at => view.getUint16(at, true), u32 = at => view.getUint32(at, true), end = bytes.length - 22;
  assert.equal(u32(end), 0x06054b50, 'ZIP end record is not at the end');
  assert.equal(u16(end + 4), 0); assert.equal(u16(end + 6), 0); assert.equal(u16(end + 20), 0);
  const count = u16(end + 10), directorySize = u32(end + 12), directoryOffset = u32(end + 16);
  assert.equal(u16(end + 8), count); assert.equal(directoryOffset + directorySize, end);
  const entries = []; let centralAt = directoryOffset, expectedLocal = 0;
  for (let index = 0; index < count; index++) {
    assert.equal(u32(centralAt), 0x02014b50); assert.equal(u16(centralAt + 10), 0, 'Only stored entries are expected');
    assert.equal(u16(centralAt + 8), 0x0800); assert.equal(u16(centralAt + 14), 33);
    const checksum = u32(centralAt + 16), size = u32(centralAt + 24), nameLength = u16(centralAt + 28), extraLength = u16(centralAt + 30), commentLength = u16(centralAt + 32), localAt = u32(centralAt + 42);
    assert.equal(u32(centralAt + 20), size); assert.equal(localAt, expectedLocal, 'Local data must be ordered and contiguous');
    const name = text.decode(bytes.subarray(centralAt + 46, centralAt + 46 + nameLength));
    assert.equal(u32(localAt), 0x04034b50); assert.equal(u16(localAt + 6), 0x0800); assert.equal(u16(localAt + 8), 0); assert.equal(u16(localAt + 12), 33);
    assert.equal(u32(localAt + 14), checksum); assert.equal(u32(localAt + 18), size); assert.equal(u32(localAt + 22), size);
    const localNameLength = u16(localAt + 26), localExtraLength = u16(localAt + 28);
    assert.equal(text.decode(bytes.subarray(localAt + 30, localAt + 30 + localNameLength)), name);
    const dataAt = localAt + 30 + localNameLength + localExtraLength, payload = bytes.slice(dataAt, dataAt + size);
    assert.equal(payload.length, size); assert.equal(referenceCRC(payload), checksum, `Bad CRC for ${name}`);
    entries.push({ name, size, checksum, payload, localAt }); expectedLocal = dataAt + size;
    centralAt += 46 + nameLength + extraLength + commentLength;
  }
  assert.equal(expectedLocal, directoryOffset); assert.equal(centralAt, end); assert.equal(new Set(entries.map(entry => entry.name)).size, count);
  return { entries, bytes, directoryOffset, directorySize };
}

test('stored PNG ZIP has independent correct CRCs, matching local/central records and exact end offsets', async () => {
  const document = design(), expected = document.pages.map((page, index) => Uint8Array.from([index, 0, 255, 42, 128]));
  const result = await buildPageArchive(document, { renderPage: (page, mime) => { assert.equal(mime, 'image/png'); return raster(expected[document.pages.findIndex(item => item.id === page.id)]); } });
  assert.equal(result.filename, 'summer-carousel-png-pages.zip'); assert.equal(result.mime, 'application/zip'); assert.equal(result.pageCount, 3);
  const zip = await inspectZIP(result.blob);
  assert.deepEqual(zip.entries.map(entry => entry.name), ['01-page-1.png', '02-page-2.png', '03-page-3.png']);
  for (let index = 0; index < zip.entries.length; index++) { assert.deepEqual(zip.entries[index].payload, expected[index]); assert.equal(result.files[index].bytes, expected[index].length); assert.equal(result.files[index].pageId, document.pages[index].id); }
});

test('JPG archive uses JPEG render MIME and safe distinct filenames despite duplicates, traversal and controls', async () => {
  const document = design(4); document.title = '../../ MY / Summer\nLaunch 🚀';
  ['../../Cover\tone', '../../Cover\tone', '..', '<img src=x> \\ C: folder'].forEach((name, index) => { document.pages[index].name = name; });
  const result = await buildPageArchive(document, { format: 'jpeg', renderPage: (page, mime) => { assert.equal(mime, 'image/jpeg'); return raster([17], mime); } });
  const zip = await inspectZIP(result.blob);
  assert.equal(result.filename, 'my-summer-launch-jpg-pages.zip'); assert.equal(result.pageCount, 4);
  assert.deepEqual(zip.entries.map(entry => entry.name), ['01-cover-one.jpg', '02-cover-one.jpg', '03-design.jpg', '04-img-src-x-c-folder.jpg']);
  for (const entry of zip.entries) assert.match(entry.name, /^\d{2}-[a-z0-9-]+\.jpg$/);
  assert.equal(exportSlug('日本語'), 'design'); assert.ok(exportSlug('a'.repeat(200)).length <= 64);
});

test('selected pages retain native document order even when supplied IDs are reversed', async () => {
  const document = design(4), rendered = [];
  const result = await buildPageArchive(document, { pageIds: [document.pages[3].id, document.pages[1].id], renderPage: page => { rendered.push(page.id); return raster(); } });
  assert.deepEqual(rendered, [document.pages[1].id, document.pages[3].id]); assert.deepEqual(result.files.map(file => file.pageId), rendered);
  assert.deepEqual((await inspectZIP(result.blob)).entries.map(entry => entry.name), ['01-page-2.png', '02-page-4.png']);
});

test('one captured snapshot survives active document and renderer argument mutations', async () => {
  const document = design(2), first = deferred(), seen = []; let calls = 0;
  const exporting = buildPageArchive(document, { renderPage: page => { seen.push({ id: page.id, name: page.name, width: page.width }); page.name = 'Renderer changed its clone'; page.width = 64; return ++calls === 1 ? first.promise : raster(); } });
  document.title = 'New active design'; document.pages[0].name = 'New active page'; document.pages[1].name = 'Other new page'; document.pages[1].width = 1000; document.pages.reverse();
  first.resolve(raster()); const result = await exporting;
  assert.equal(result.filename, 'summer-carousel-png-pages.zip'); assert.deepEqual(seen.map(page => page.name), ['Page 1', 'Page 2']); assert.deepEqual(result.files.map(file => file.width), [720, 720]);
  assert.deepEqual((await inspectZIP(result.blob)).entries.map(entry => entry.name), ['01-page-1.png', '02-page-2.png']);
});

test('renders run sequentially and progress only reports captured page identities', async () => {
  const document = design(), progress = [], calls = []; let active = 0, maximum = 0;
  const result = await buildPageArchive(document, { renderPage: async page => { active++; maximum = Math.max(maximum, active); calls.push(page.id); await tick(); active--; return raster(); }, onProgress: value => progress.push(value) });
  assert.equal(maximum, 1); assert.equal(active, 0); assert.deepEqual(calls, document.pages.map(page => page.id));
  assert.deepEqual(progress.map(value => value.completed), [0, 1, 1, 2, 2, 3]); assert.ok(progress.every(value => value.total === 3 && calls.includes(value.pageId))); assert.equal(result.pageCount, 3);
});

test('thirty pages at the 120 MP boundary work; extra pages or pixels reject before rendering', async () => {
  assert.equal(MAX_ARCHIVE_PIXELS, 120_000_000); let rendered = 0;
  const result = await buildPageArchive(design(30, 2000, 2000), { renderPage: () => { rendered++; return raster([1]); } });
  assert.equal(rendered, 30); assert.equal(result.pageCount, 30); assert.equal((await inspectZIP(result.blob)).entries.length, 30);
  for (const document of [design(31, 64, 64), design(30, 2000, 2001)]) { rendered = 0; await assert.rejects(buildPageArchive(document, { renderPage: () => { rendered++; return raster(); } })); assert.equal(rendered, 0); }
});

test('invalid formats, renderer/progress options and selected page identities reject without rendering', async () => {
  const document = design(); let rendered = 0; const renderPage = () => { rendered++; return raster(); };
  for (const options of [{ format: 'jpg' }, { format: 'svg' }, { format: null }, { renderPage: null }, { onProgress: false }, { pageIds: [] }, { pageIds: ['missing'] }, { pageIds: [document.pages[0].id, document.pages[0].id] }, { pageIds: [1] }, { pageIds: document.pages[0].id }, { unsupported: true }]) {
    await assert.rejects(buildPageArchive(document, { renderPage, ...options })); assert.equal(rendered, 0);
  }
});

test('options, document and page-selection getters never execute during rejected validation', async () => {
  const document = design(); let read = 0, rendered = 0; const renderPage = () => { rendered++; return raster(); };
  for (const key of ['format', 'pageIds', 'renderPage', 'signal', 'onProgress']) {
    const options = { renderPage }; Object.defineProperty(options, key, { enumerable: true, get() { read++; return renderPage; } }); await assert.rejects(buildPageArchive(document, options));
  }
  const selected = [document.pages[0].id]; Object.defineProperty(selected, '0', { enumerable: true, get() { read++; return document.pages[0].id; } });
  const hidden = [document.pages[0].id]; Object.defineProperty(hidden, '0', { value: document.pages[0].id, enumerable: false });
  const symbol = [document.pages[0].id]; symbol[Symbol.iterator] = () => { read++; return [][Symbol.iterator](); };
  const extra = [document.pages[0].id]; extra.side = 'extra';
  for (const pageIds of [selected, hidden, symbol, extra, Array(1), Object.assign(Object.create([]), { 0: document.pages[0].id, length: 1 })]) await assert.rejects(buildPageArchive(document, { pageIds, renderPage }));
  const unsafeDocument = { ...document }; Object.defineProperty(unsafeDocument, 'title', { enumerable: true, get() { read++; return 'Hidden'; } }); await assert.rejects(buildPageArchive(unsafeDocument, { renderPage }));
  assert.equal(read, 0); assert.equal(rendered, 0);
});

test('failed later renderer and invalid image results never produce a partial archive', async () => {
  const document = design(); let calls = 0, returned = false;
  await assert.rejects(buildPageArchive(document, { renderPage: () => { if (++calls === 2) throw new Error('Render failed'); return raster(); } }).then(value => { returned = true; return value; }), /Render failed/);
  assert.equal(calls, 2); assert.equal(returned, false);
  for (const value of [null, undefined, 'image', {}, new Blob([], { type: 'image/png' }), raster([1], 'image/jpeg')]) await assert.rejects(buildPageArchive(design(1), { renderPage: () => value }), /chosen image format/);
});

test('changed renderer byte length and failed Blob reads reject before returning an archive', async () => {
  class ChangedBlob extends Blob { async arrayBuffer() { return Uint8Array.from([1, 2]).buffer; } }
  class FailedBlob extends Blob { async arrayBuffer() { throw new Error('Read failed'); } }
  await assert.rejects(buildPageArchive(design(1), { renderPage: () => new ChangedBlob([Uint8Array.from([1])], { type: 'image/png' }) }), /changed/);
  await assert.rejects(buildPageArchive(design(1), { renderPage: () => new FailedBlob([Uint8Array.from([1])], { type: 'image/png' }) }), /Read failed/);
});

test('ZIP payload is the same captured byte buffer used to compute its CRC', async () => {
  class SnapshotBlob extends Blob { async arrayBuffer() { return Uint8Array.from([9, 8, 7]).buffer; } }
  const result = await buildPageArchive(design(1), { renderPage: () => new SnapshotBlob([Uint8Array.from([1, 2, 3])], { type: 'image/png' }) });
  const zip = await inspectZIP(result.blob); assert.deepEqual(zip.entries[0].payload, Uint8Array.from([9, 8, 7]));
});

test('64 MiB budget includes ZIP overhead and rejects an oversized Blob before reading it', async () => {
  assert.equal(MAX_ARCHIVE_BYTES, 64 * 1024 * 1024); let reads = 0;
  class OversizedBlob extends Blob { get size() { return MAX_ARCHIVE_BYTES; } async arrayBuffer() { reads++; throw new Error('Must not read an oversized image'); } }
  await assert.rejects(buildPageArchive(design(1), { renderPage: () => new OversizedBlob([Uint8Array.from([1])], { type: 'image/png' }) }), /64 MiB/); assert.equal(reads, 0);
});

test('a complete stored archive at exactly 64 MiB is accepted', async () => {
  const document = design(1); document.pages[0].name = 'Page';
  const nameLength = new TextEncoder().encode('01-page.png').length, overhead = 30 + nameLength + 46 + nameLength + 22;
  const image = new Blob([new Uint8Array(MAX_ARCHIVE_BYTES - overhead)], { type: 'image/png' });
  const result = await buildPageArchive(document, { renderPage: () => image }); assert.equal(result.blob.size, MAX_ARCHIVE_BYTES); assert.equal(result.files[0].bytes, MAX_ARCHIVE_BYTES - overhead);
});

test('an already-cancelled signal prevents the first renderer', async () => {
  const controller = new AbortController(); controller.abort(); let calls = 0;
  await assert.rejects(buildPageArchive(design(), { signal: controller.signal, renderPage: () => { calls++; return raster(); } }), { name: 'AbortError' }); assert.equal(calls, 0);
});

test('cancelling while renderer is pending rejects promptly, consumes late rejection and never renders another page', async () => {
  const controller = new AbortController(), pending = deferred(), unhandled = []; let calls = 0, returned = false;
  const observer = reason => unhandled.push(reason); process.on('unhandledRejection', observer);
  try {
    const exporting = buildPageArchive(design(), { signal: controller.signal, renderPage: (page, mime, options) => { calls++; assert.equal(options.signal, controller.signal); return pending.promise; } }).then(value => { returned = true; return value; });
    controller.abort(); await assert.rejects(exporting, { name: 'AbortError' }); pending.reject(new Error('Late renderer failure')); await tick(); await tick();
    assert.equal(calls, 1); assert.equal(returned, false); assert.deepEqual(unhandled, []);
  } finally { process.removeListener('unhandledRejection', observer); }
});

test('cancellation during a pending Blob read consumes its late rejection and produces no archive', async () => {
  const controller = new AbortController(), reading = deferred(), started = deferred(); let calls = 0;
  class PendingBlob extends Blob { arrayBuffer() { started.resolve(); return reading.promise; } }
  const exporting = buildPageArchive(design(), { signal: controller.signal, renderPage: () => { calls++; return new PendingBlob([Uint8Array.from([1])], { type: 'image/png' }); } });
  await started.promise; controller.abort(); await assert.rejects(exporting, { name: 'AbortError' }); reading.reject(new Error('Late Blob failure')); await tick(); assert.equal(calls, 1);
});

test('a progress callback can cancel before a renderer begins', async () => {
  const controller = new AbortController(); let calls = 0;
  await assert.rejects(buildPageArchive(design(), { signal: controller.signal, onProgress: () => controller.abort(), renderPage: () => { calls++; return raster(); } }), { name: 'AbortError' }); assert.equal(calls, 0);
});

test('a progress failure stops the export before another renderer or partial archive', async () => {
  let calls = 0;
  await assert.rejects(buildPageArchive(design(), { renderPage: () => { calls++; return raster(); }, onProgress: progress => { if (progress.completed === 1) throw new Error('Progress failed'); } }), /Progress failed/); assert.equal(calls, 1);
});
