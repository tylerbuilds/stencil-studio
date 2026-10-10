import test from 'node:test';
import assert from 'node:assert/strict';
import {
  UPLOADS_KEY, UPLOADS_SCHEMA, UPLOADS_VERSION, MAX_UPLOADS, MAX_UPLOAD_BYTES, MAX_UPLOAD_EDGE, MAX_UPLOAD_PIXELS, UploadError,
  listUploads, loadUpload, saveUpload, renameUpload, deleteUpload, exportUploads, importUploads, withUploadsLock
} from '../../src/uploads.js';

class MemoryStorage {
  values = new Map(); writes = 0; full = false; onRead = null;
  getItem(key) { this.onRead?.(key); return this.values.get(key) ?? null; }
  setItem(key, value) {
    if (this.full) throw new DOMException('Quota exceeded', 'QuotaExceededError');
    this.values.set(key, String(value)); this.writes++;
  }
}
const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=';
const gif = 'data:image/gif;base64,R0lGODlhAQABAIAAAP///wAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw==';
const asset = (name = 'Paper star', src = png, width = 1, height = 1) => ({ name, src, width, height });
const shelf = uploads => ({ schema: UPLOADS_SCHEMA, version: UPLOADS_VERSION, uploads });
const dataURI = (mime, bytes) => `data:${mime};base64,${Buffer.from(bytes).toString('base64')}`;
function headerDimensions(src, width, height) {
  // These fixtures exercise only container/header validation; no native image is decoded.
  const mime = src.slice(5, src.indexOf(';')), bytes = Buffer.from(src.split(',')[1], 'base64');
  if (mime === 'image/gif') { bytes.writeUInt16LE(width, 6); bytes.writeUInt16LE(height, 8); }
  else { bytes.writeUInt32BE(width, 16); bytes.writeUInt32BE(height, 20); }
  return dataURI(mime, bytes);
}
const jpeg = (orientation = 1, includeXMP = false) => {
  const exif = [0x45, 0x78, 0x69, 0x66, 0, 0, 0x49, 0x49, 42, 0, 8, 0, 0, 0, 1, 0, 0x12, 1, 3, 0, 1, 0, 0, 0, orientation, 0, 0, 0, 0, 0, 0, 0];
  const xmp = [...Buffer.from('http://ns.adobe.com/xap/1.0/\0<x:xmpmeta/>')];
  const extra = includeXMP ? [0xff, 0xe1, 0, xmp.length + 2, ...xmp] : [];
  return dataURI('image/jpeg', [0xff, 0xd8, 0xff, 0xe1, 0, exif.length + 2, ...exif, ...extra, 0xff, 0xc0, 0, 11, 8, 0, 1, 0, 2, 1, 1, 0x11, 0, 0xff, 0xda, 0, 8, 1, 1, 0, 0, 63, 0, 0, 0xff, 0xd9]);
};
function webp(extraBytes = 0) {
  // A bounded VP8L container; pixel decoding remains the browser's responsibility.
  const payload = Buffer.alloc(6 + extraBytes); payload[0] = 0x2f;
  const header = Buffer.alloc(20); header.write('RIFF'); header.writeUInt32LE(12 + payload.length, 4); header.write('WEBP', 8); header.write('VP8L', 12); header.writeUInt32LE(payload.length, 16);
  return dataURI('image/webp', Buffer.concat([header, payload]));
}
function webpChunk(kind, payload) {
  const header = Buffer.alloc(8); header.write(kind); header.writeUInt32LE(payload.length, 4);
  return Buffer.concat([header, payload, Buffer.alloc(payload.length & 1)]);
}
function webpPicture(kind, width, height) {
  const payload = Buffer.alloc(kind === 'VP8L' ? 5 : 10);
  if (kind === 'VP8L') { payload[0] = 0x2f; payload.writeUInt32LE(((width - 1) | (height - 1) << 14) >>> 0, 1); }
  else { payload.set([0x9d, 1, 0x2a], 3); payload.writeUInt16LE(width, 6); payload.writeUInt16LE(height, 8); }
  return webpChunk(kind, payload);
}
function webpCanvas(width, height, animated = false) {
  const payload = Buffer.alloc(10); payload[0] = animated ? 2 : 0; payload.writeUIntLE(width - 1, 4, 3); payload.writeUIntLE(height - 1, 7, 3);
  return webpChunk('VP8X', payload);
}
function webpContainer(chunks) {
  const payload = Buffer.concat(chunks), header = Buffer.alloc(12); header.write('RIFF'); header.writeUInt32LE(payload.length + 4, 4); header.write('WEBP', 8);
  return dataURI('image/webp', Buffer.concat([header, payload]));
}
function webpAnimation(canvasWidth, canvasHeight, frames) {
  const chunks = [webpCanvas(canvasWidth, canvasHeight, true), webpChunk('ANIM', Buffer.alloc(6))];
  for (const { width, height, imageWidth = width, imageHeight = height, kind = 'VP8L', x = 0, y = 0 } of frames) {
    const header = Buffer.alloc(16); header.writeUIntLE(x / 2, 0, 3); header.writeUIntLE(y / 2, 3, 3); header.writeUIntLE(width - 1, 6, 3); header.writeUIntLE(height - 1, 9, 3);
    chunks.push(webpChunk('ANMF', Buffer.concat([header, webpPicture(kind, imageWidth, imageHeight)])));
  }
  return webpContainer(chunks);
}
function withUUID(factory, operation) {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis.crypto, 'randomUUID');
  Object.defineProperty(globalThis.crypto, 'randomUUID', { configurable: true, value: factory });
  try { return operation(); } finally { if (descriptor) Object.defineProperty(globalThis.crypto, 'randomUUID', descriptor); else delete globalThis.crypto.randomUUID; }
}

test('new uploads are reusable independent records with factual metadata and exact byte counts', () => {
  const storage = new MemoryStorage(); assert.deepEqual(listUploads(storage), []);
  const input = { ...asset(' Paper star '), licence: { name: 'CC BY 4.0', creator: 'Mina', sourceUrl: 'https://example.org/star', licenceUrl: 'https://creativecommons.org/licenses/by/4.0/', attribution: 'Paper star by Mina' } };
  const saved = saveUpload(input, { id: undefined }, storage);
  assert.equal(saved.name, 'Paper star'); assert.equal(saved.mime, 'image/png');
  assert.equal(saved.bytes, Buffer.from(png.split(',')[1], 'base64').byteLength);
  assert.equal(saved.licence.attribution, 'Paper star by Mina');
  saved.licence.creator = 'Caller changed this'; input.licence.name = 'Caller changed this';
  const loaded = loadUpload(saved.id, storage); assert.equal(loaded.licence.creator, 'Mina'); assert.equal(loaded.licence.name, 'CC BY 4.0');
  loaded.name = 'Loaded mutation'; listUploads(storage)[0].name = 'List mutation'; assert.equal(loadUpload(saved.id, storage).name, 'Paper star');
  const withoutLicence = saveUpload(asset('My drawing'), {}, storage); assert.equal('licence' in withoutLicence, false);
});

test('updates and renames preserve identities; deletions leave independent uploads intact', () => {
  const storage = new MemoryStorage(), first = saveUpload(asset(), {}, storage), second = saveUpload(asset('Comet', gif), {}, storage);
  const changed = saveUpload(asset('New star', gif), { id: first.id, expectedUpdatedAt: first.updatedAt }, storage);
  assert.equal(changed.id, first.id); assert.equal(listUploads(storage).length, 2); assert.ok(changed.updatedAt > first.updatedAt);
  const renamed = renameUpload(first.id, ' Renamed ', storage, { expectedUpdatedAt: changed.updatedAt });
  assert.equal(renamed.name, 'Renamed'); assert.ok(renamed.updatedAt > changed.updatedAt);
  assert.equal(deleteUpload(first.id, storage, { expectedUpdatedAt: renamed.updatedAt }), true);
  assert.deepEqual(listUploads(storage), [second]); assert.throws(() => loadUpload(first.id, storage), error => error.code === 'upload-not-found');
  assert.throws(() => saveUpload(asset(), { id: 'missing' }, storage), error => error.code === 'upload-not-found');
});

test('backups round-trip and reordered exact merges skip without writes', () => {
  const source = new MemoryStorage(), target = new MemoryStorage(), record = saveUpload(asset(), {}, source), backup = exportUploads(source);
  assert.deepEqual(importUploads(backup, {}, target), { imported: 1, skipped: 0, total: 1 }); assert.deepEqual(loadUpload(record.id, target), record);
  const writes = target.writes, reordered = { ...shelf([]), uploads: [{ updatedAt: record.updatedAt, bytes: record.bytes, mime: record.mime, height: record.height, width: record.width, src: record.src, name: record.name, id: record.id }] };
  assert.deepEqual(importUploads(reordered, {}, target), { imported: 0, skipped: 1, total: 1 }); assert.equal(target.writes, writes);
});

test('malformed later records and merge ID conflicts never partially import earlier records', () => {
  const storage = new MemoryStorage(), record = saveUpload(asset(), {}, storage), before = exportUploads(storage), writes = storage.writes;
  const added = { ...record, id: 'new-image' };
  assert.throws(() => importUploads(shelf([added, { ...record, id: 'invalid-image', bytes: record.bytes + 1 }]), {}, storage), /byte count/);
  assert.throws(() => importUploads(shelf([added, { ...record, name: 'Different image' }]), {}, storage), error => error.code === 'upload-id-conflict');
  assert.equal(exportUploads(storage), before); assert.equal(storage.writes, writes);
  assert.deepEqual(importUploads(shelf([added]), { mode: 'replace' }, storage), { imported: 1, skipped: 0, total: 1 }); assert.equal(listUploads(storage)[0].id, 'new-image');
});

test('unsupported formats, dimensions, dates, IDs, names and backup properties are rejected atomically', () => {
  const storage = new MemoryStorage(), record = saveUpload(asset(), {}, storage), before = exportUploads(storage), writes = storage.writes;
  for (const payload of [
    '{bad json', { ...shelf([]), version: 9 }, { ...shelf([]), unexpected: true }, shelf([record, record]),
    shelf([{ ...record, id: '<img>' }]), shelf([{ ...record, name: ' ' }]), shelf([{ ...record, name: 'bad\u202ename' }]),
    shelf([{ ...record, width: 0 }]), shelf([{ ...record, height: 65536 }]), shelf([{ ...record, width: 2 }]),
    shelf([{ ...record, mime: 'image/gif' }]), shelf([{ ...record, updatedAt: '2026-02-31T00:00:00.000Z' }]),
    shelf([{ ...record, src: 'https://example.org/picture.png' }]), shelf([{ ...record, src: 'data:image/svg+xml;base64,PHN2Zz4=' }]),
    shelf([{ ...record, extra: true }]), shelf([{ ...record, licence: { permission: 'invented' } }]),
    shelf([{ ...record, licence: { sourceUrl: 'javascript:alert(1)' } }]), shelf([{ ...record, licence: { licenceUrl: 'https://secret@example.org/' } }])
  ]) assert.throws(() => importUploads(payload, {}, storage), UploadError);
  assert.equal(exportUploads(storage), before); assert.equal(storage.writes, writes);
});

test('base64 and real raster container headers must match the stated MIME and dimensions', () => {
  const storage = new MemoryStorage();
  for (const input of [asset('PNG'), asset('GIF', gif), asset('WebP', webp()), asset('JPEG', jpeg(), 2, 1), asset('Rotated JPEG', jpeg(6), 1, 2)]) saveUpload(input, {}, storage);
  const before = exportUploads(storage), invalid = [
    png.replace('image/png', 'image/gif'), png.replace('base64,', 'base64, '), png.slice(0, -1),
    'data:image/png;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==',
    'data:image/png;base64,YQ==', 'data:image/png;base64,YR==',
    dataURI('image/png', Buffer.from(png.split(',')[1], 'base64').subarray(0, 33)),
    dataURI('image/gif', Buffer.from(gif.split(',')[1], 'base64').subarray(0, -1)),
    webp().replace('image/webp', 'image/jpeg')
  ];
  for (const src of invalid) assert.throws(() => saveUpload(asset('Invalid', src), {}, storage), error => error.code === 'invalid-raster');
  assert.throws(() => saveUpload(asset('Wrong rotation', jpeg(6), 2, 1), {}, storage), /dimensions/);
  assert.equal(exportUploads(storage), before);
});

test('accessors, custom prototypes, cycles, hidden properties and sparse arrays cannot execute import code', () => {
  const storage = new MemoryStorage(); let accessed = false;
  const accessor = shelf([]); Object.defineProperty(accessor, 'uploads', { enumerable: true, get() { accessed = true; return []; } });
  const hidden = shelf([]); Object.defineProperty(hidden, 'hidden', { value: true });
  const custom = Object.assign(Object.create({ malicious: true }), shelf([])), cycle = shelf([]); cycle.uploads.push(cycle);
  const symbol = shelf([]); symbol[Symbol('hidden')] = true;
  for (const payload of [accessor, hidden, custom, cycle, symbol, shelf(Array(1)), '{"schema":"stencil-studio-uploads","version":1,"uploads":[],"__proto__":{"polluted":true}}']) assert.throws(() => importUploads(payload, {}, storage), UploadError);
  const unsafeAsset = asset(); Object.defineProperty(unsafeAsset, 'src', { enumerable: true, get() { accessed = true; return png; } });
  assert.throws(() => saveUpload(unsafeAsset, {}, storage), UploadError);
  const unsafeOptions = {}; Object.defineProperty(unsafeOptions, 'id', { enumerable: true, get() { accessed = true; return 'some-id'; } });
  assert.throws(() => saveUpload(asset(), unsafeOptions, storage), UploadError);
  assert.equal(accessed, false); assert.equal({}.polluted, undefined); assert.equal(storage.writes, 0);
});

test('JPEG XMP metadata after EXIF keeps the decoded orientation dimensions', () => {
  const storage = new MemoryStorage(), src = jpeg(6, true), saved = saveUpload(asset('Portrait photo', src, 1, 2), {}, storage);
  assert.equal(saved.width, 1); assert.equal(saved.height, 2);
  assert.deepEqual(loadUpload(saved.id, storage), saved);
});

test('oversized GIF and PNG imports reject atomically using declared and actual header dimensions', () => {
  const storage = new MemoryStorage(), saved = saveUpload(asset(), {}, storage), before = exportUploads(storage), writes = storage.writes;
  for (const base of [gif, png]) for (const [width, height, message] of [[MAX_UPLOAD_EDGE + 1, 1, /16,384/], [1, MAX_UPLOAD_EDGE + 1, /16,384/], [5000, 8001, /40 million/]]) {
    const src = headerDimensions(base, width, height), mime = src.slice(5, src.indexOf(';'));
    for (const metadata of [{ width, height }, { width: 1, height: 1 }]) {
      const oversized = { ...saved, id: 'oversized-raster', src, mime, bytes: Buffer.from(src.split(',')[1], 'base64').length, ...metadata };
      for (const mode of ['merge', 'replace']) {
        assert.throws(() => importUploads(shelf([{ ...saved, id: 'valid-first' }, oversized]), { mode }, storage), error => error instanceof UploadError && message.test(error.message));
        assert.equal(storage.getItem(UPLOADS_KEY), before); assert.equal(storage.writes, writes);
      }
    }
    assert.throws(() => saveUpload(asset('Oversized', src, width, height), {}, storage), error => error instanceof UploadError && message.test(error.message));
    assert.equal(storage.getItem(UPLOADS_KEY), before); assert.equal(storage.writes, writes);
  }
});

test('oversized declared dimensions reject before base64 decoding and allocation', () => {
  const storage = new MemoryStorage(), saved = saveUpload(asset(), {}, storage), before = exportUploads(storage), originalAtob = globalThis.atob;
  let decoded = 0;
  globalThis.atob = encoded => { decoded++; return originalAtob(encoded); };
  try {
    for (const [width, height] of [[MAX_UPLOAD_EDGE + 1, 1], [1, MAX_UPLOAD_EDGE + 1], [8001, 5000]]) {
      assert.throws(() => saveUpload(asset('Oversized', png, width, height), {}, storage), UploadError);
      assert.throws(() => importUploads(shelf([{ ...saved, width, height }]), {}, storage), UploadError);
      assert.equal(storage.getItem(UPLOADS_KEY), before);
    }
    assert.equal(decoded, 0, 'Oversized metadata reached base64 decoding');
  } finally { globalThis.atob = originalAtob; }
});

test('earlier safe upload shelves at the browser dimension limits remain loadable', () => {
  assert.equal(MAX_UPLOAD_EDGE, 16_384); assert.equal(MAX_UPLOAD_PIXELS, 40_000_000);
  const storage = new MemoryStorage(), seed = saveUpload(asset(), {}, storage);
  for (const [width, height] of [[MAX_UPLOAD_EDGE, 1], [1, MAX_UPLOAD_EDGE], [5000, 8000]]) {
    const src = headerDimensions(gif, width, height), record = { ...seed, src, mime: 'image/gif', bytes: Buffer.from(src.split(',')[1], 'base64').length, width, height };
    storage.values.set(UPLOADS_KEY, JSON.stringify(shelf([record]), null, 2));
    assert.deepEqual(loadUpload(record.id, storage), record); assert.deepEqual(listUploads(storage), [record]);
    assert.equal(JSON.parse(exportUploads(storage)).uploads[0].width, width);
  }
});

test('small WebP canvases and animation frames cannot mask oversized VP8 or VP8L headers', () => {
  const storage = new MemoryStorage(), saved = saveUpload(asset(), {}, storage), before = exportUploads(storage), writes = storage.writes;
  for (const kind of ['VP8L', 'VP8 ']) {
    const sources = [
      webpContainer([webpCanvas(1, 1), webpPicture(kind, 10000, 10000)]),
      webpAnimation(1, 1, [{ width: 1, height: 1, imageWidth: 10000, imageHeight: 10000, kind }]),
      webpAnimation(1, 1, [{ width: 10000, height: 10000, imageWidth: 1, imageHeight: 1, kind }])
    ];
    for (const src of sources) {
      const record = { ...saved, id: 'oversized-webp', src, mime: 'image/webp', bytes: Buffer.from(src.split(',')[1], 'base64').length };
      assert.throws(() => saveUpload(asset('Masked dimensions', src), {}, storage), error => error instanceof UploadError && /40 million/.test(error.message));
      for (const mode of ['merge', 'replace']) assert.throws(() => importUploads(shelf([{ ...saved, id: 'valid-first' }, record]), { mode }, storage), error => error instanceof UploadError && /40 million/.test(error.message));
      assert.equal(storage.getItem(UPLOADS_KEY), before); assert.equal(storage.writes, writes);
    }
  }
});

test('WebP canvas, animation frame and nested image headers must all fit and agree', () => {
  const storage = new MemoryStorage(), saved = saveUpload(asset(), {}, storage), before = exportUploads(storage);
  const invalid = [
    [webpContainer([webpCanvas(MAX_UPLOAD_EDGE + 1, 1), webpPicture('VP8L', 1, 1)]), 1, 1],
    [webpAnimation(1, 1, [{ width: MAX_UPLOAD_EDGE + 1, height: 1, imageWidth: 1 }]), 1, 1],
    [webpContainer([webpCanvas(1, 1), webpPicture('VP8L', 2, 1)]), 1, 1],
    [webpAnimation(2, 2, [{ width: 1, height: 1, imageWidth: 2 }]), 2, 2],
    [webpAnimation(2, 2, [{ width: 1, height: 1, x: 2 }]), 2, 2],
    [webpAnimation(2, 2, [{ width: 1, height: 1 }, { width: 1, height: 1, imageWidth: 10000, imageHeight: 10000 }]), 2, 2]
  ];
  for (const [src, width, height] of invalid) {
    const record = { ...saved, id: 'invalid-webp', src, mime: 'image/webp', bytes: Buffer.from(src.split(',')[1], 'base64').length, width, height };
    assert.throws(() => saveUpload(asset('Invalid headers', src, width, height), {}, storage), UploadError);
    assert.throws(() => importUploads(shelf([{ ...saved, id: 'valid-first' }, record]), {}, storage), UploadError);
    assert.equal(storage.getItem(UPLOADS_KEY), before);
  }
  for (const kind of ['VP8L', 'VP8 ']) {
    const src = webpAnimation(2, 2, [{ width: 1, height: 1, kind }]), record = saveUpload(asset('Small animation headers', src, 2, 2), {}, storage);
    assert.deepEqual(loadUpload(record.id, storage), record);
    const still = saveUpload(asset('Matching still headers', webpContainer([webpCanvas(2, 1), webpPicture(kind, 2, 1)]), 2, 1), {}, storage);
    assert.deepEqual(loadUpload(still.id, storage), still);
  }
});

test('20-record and 8 MB aggregate limits preserve the previous shelf', () => {
  const storage = new MemoryStorage();
  for (let index = 0; index < MAX_UPLOADS; index++) saveUpload(asset(`Image ${index}`), {}, storage);
  const before = exportUploads(storage), record = listUploads(storage)[0];
  assert.throws(() => saveUpload(asset('Overflow'), {}, storage), /up to 20/); assert.equal(exportUploads(storage), before);
  assert.throws(() => importUploads(' '.repeat(MAX_UPLOAD_BYTES + 1), {}, storage), /too large/);
  const src = webp(3 * 1024 * 1024), largeBytes = Buffer.from(src.split(',')[1], 'base64').length;
  const large = shelf([{ ...record, src, mime: 'image/webp', bytes: largeBytes, id: 'large-a' }, { ...record, src, mime: 'image/webp', bytes: largeBytes, id: 'large-b' }]);
  assert.throws(() => importUploads(large, { mode: 'replace' }, storage), /too large/); assert.equal(exportUploads(storage), before);
});

test('quota errors on every write operation keep exact earlier stored bytes', () => {
  const storage = new MemoryStorage(), record = saveUpload(asset(), {}, storage), before = storage.getItem(UPLOADS_KEY); storage.full = true;
  for (const operation of [
    () => saveUpload(asset('Extra'), {}, storage), () => saveUpload(asset('Changed'), { id: record.id }, storage),
    () => renameUpload(record.id, 'Changed', storage), () => deleteUpload(record.id, storage),
    () => importUploads(shelf([]), { mode: 'replace' }, storage)
  ]) {
    assert.throws(operation, error => error.code === 'storage-write-failed' && /Previously saved uploads are unchanged/.test(error.message));
    assert.equal(storage.getItem(UPLOADS_KEY), before);
  }
  assert.deepEqual(loadUpload(record.id, storage), record);
});

test('stale record updates, rename and deletion cannot overwrite a newer tab', () => {
  const storage = new MemoryStorage(), first = saveUpload(asset(), {}, storage), changed = renameUpload(first.id, 'Other tab', storage);
  const before = exportUploads(storage), writes = storage.writes;
  for (const operation of [
    () => saveUpload(asset('Stale'), { id: first.id, expectedUpdatedAt: first.updatedAt }, storage),
    () => renameUpload(first.id, 'Stale', storage, { expectedUpdatedAt: first.updatedAt }),
    () => deleteUpload(first.id, storage, { expectedUpdatedAt: first.updatedAt })
  ]) assert.throws(operation, error => error.code === 'upload-conflict');
  assert.equal(exportUploads(storage), before); assert.equal(storage.writes, writes); assert.equal(loadUpload(first.id, storage).updatedAt, changed.updatedAt);
});

test('raw storage drift before commit rejects writes rather than replacing another tab', () => {
  for (const operation of [
    (storage, record) => saveUpload(asset('New'), {}, storage),
    (storage, record) => renameUpload(record.id, 'New', storage),
    (storage, record) => deleteUpload(record.id, storage),
    (storage, record) => importUploads(shelf([{ ...record, id: 'added' }]), {}, storage),
    storage => importUploads(shelf([]), { mode: 'replace' }, storage)
  ]) {
    const storage = new MemoryStorage(), record = saveUpload(asset(), {}, storage), otherRaw = JSON.stringify(shelf([{ ...record, name: 'Other tab won' }]), null, 2), writes = storage.writes;
    let reads = 0; storage.onRead = key => { if (key === UPLOADS_KEY && ++reads === 2) storage.values.set(key, otherRaw); };
    assert.throws(() => operation(storage, record), error => error.code === 'uploads-conflict');
    storage.onRead = null; assert.equal(storage.getItem(UPLOADS_KEY), otherRaw); assert.equal(storage.writes, writes);
  }
});

test('generated ID collisions retry; persistent collisions never overwrite an existing upload', () => {
  const storage = new MemoryStorage(), first = saveUpload(asset(), {}, storage); let attempts = 0;
  const second = withUUID(() => ++attempts < 3 ? first.id : 'fresh-image-id', () => saveUpload(asset('Second'), {}, storage));
  assert.equal(attempts, 3); assert.equal(second.id, 'fresh-image-id'); assert.equal(loadUpload(first.id, storage).name, 'Paper star');
  const before = exportUploads(storage); let failedAttempts = 0;
  assert.throws(() => withUUID(() => { failedAttempts++; return first.id; }, () => saveUpload(asset('Collision'), {}, storage)), error => error.code === 'id-unavailable');
  assert.equal(failedAttempts, 64); assert.equal(exportUploads(storage), before);
});

test('corrupt stored uploads remain intact until explicit validated replacement', () => {
  const storage = new MemoryStorage(); storage.values.set(UPLOADS_KEY, 'broken stored data');
  assert.throws(() => listUploads(storage), error => error.code === 'invalid-stored-uploads' && /stored data has been kept/.test(error.message));
  assert.throws(() => saveUpload(asset(), {}, storage), error => error.code === 'invalid-stored-uploads'); assert.equal(storage.getItem(UPLOADS_KEY), 'broken stored data');
  assert.throws(() => importUploads('{bad', { mode: 'replace' }, storage), error => error.code === 'invalid-json'); assert.equal(storage.getItem(UPLOADS_KEY), 'broken stored data');
  assert.deepEqual(importUploads(shelf([]), { mode: 'replace' }, storage), { imported: 0, skipped: 0, total: 0 }); assert.deepEqual(listUploads(storage), []);
  const denied = { getItem() { throw new Error('Denied'); }, setItem() {} };
  assert.throws(() => listUploads(denied), error => error.code === 'storage-unavailable'); assert.throws(() => saveUpload(asset(), {}, denied), error => error.code === 'storage-unavailable');
});

test('lock helper serialises cooperating writes and uses the shelf Web Lock', async () => {
  const storage = new MemoryStorage(), order = []; let release;
  const first = withUploadsLock(async () => { order.push('first'); await new Promise(resolve => { release = resolve; }); saveUpload(asset('First'), {}, storage); }, { locks: null });
  const second = withUploadsLock(() => { order.push('second'); saveUpload(asset('Second'), {}, storage); }, { locks: null });
  await Promise.resolve(); assert.deepEqual(order, ['first']); release(); await Promise.all([first, second]); assert.deepEqual(order, ['first', 'second']); assert.equal(listUploads(storage).length, 2);
  const calls = [], locks = { request(key, options, operation) { calls.push({ key, mode: options.mode }); return operation(); } };
  assert.equal(await withUploadsLock(() => 42, { locks }), 42); assert.deepEqual(calls, [{ key: UPLOADS_KEY, mode: 'exclusive' }]);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(withUploadsLock(() => assert.fail('Aborted operation ran'), { locks, signal: controller.signal }), error => error.code === 'uploads-busy');
});
