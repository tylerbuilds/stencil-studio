import test from 'node:test';
import assert from 'node:assert/strict';
import { checkEmbeddedRasterLimits, MAX_RASTER_EDGE, MAX_RASTER_PIXELS, MAX_RASTER_HEADER_STEPS } from '../../src/raster-limits.js';

const url = (bytes, type = 'png') => `data:image/${type};base64,${Buffer.from(bytes).toString('base64')}`;
function png(width, height) {
  const bytes = Buffer.alloc(24); Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(bytes); bytes.writeUInt32BE(13, 8); bytes.write('IHDR', 12); bytes.writeUInt32BE(width, 16); bytes.writeUInt32BE(height, 20); return bytes;
}
function gif(width, height, frames = [], extension = false) {
  const header = Buffer.alloc(13); header.write('GIF89a'); header.writeUInt16LE(width, 6); header.writeUInt16LE(height, 8); const parts = [header];
  if (extension) parts.push(Buffer.from([0x21, 0xfe, 4, 0x2c, 0xff, 0x9d, 0x2f, 0]));
  for (const frame of frames) {
    const descriptor = Buffer.alloc(10); descriptor[0] = 0x2c; descriptor.writeUInt16LE(frame.width, 5); descriptor.writeUInt16LE(frame.height, 7); if (frame.palette) descriptor[9] = 0x80;
    parts.push(descriptor); if (frame.palette) parts.push(Buffer.alloc(6)); parts.push(Buffer.from([2, 2, 0x4c, 1, 0]));
  }
  parts.push(Buffer.from([0x3b])); return Buffer.concat(parts);
}
function jpeg(width, height, marker = 0xc0, incomplete = false) {
  const bytes = Buffer.alloc(incomplete ? 11 : 15); bytes[0] = 0xff; bytes[1] = 0xd8; bytes[2] = 0xff; bytes[3] = marker; bytes.writeUInt16BE(11, 4); bytes[6] = 8; bytes.writeUInt16BE(height, 7); bytes.writeUInt16BE(width, 9); if (!incomplete) bytes[11] = 1; return bytes;
}
function chunk(kind, payload, declaredSize = payload.length) {
  const header = Buffer.alloc(8); header.write(kind); header.writeUInt32LE(declaredSize, 4); return Buffer.concat([header, payload, ...(payload.length % 2 ? [Buffer.from([0])] : [])]);
}
function webp(chunks) { const bytes = Buffer.concat([Buffer.alloc(12), ...chunks]); bytes.write('RIFF'); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write('WEBP', 8); return bytes; }
function canvas(width, height) { const payload = Buffer.alloc(10); payload.writeUIntLE(width - 1, 4, 3); payload.writeUIntLE(height - 1, 7, 3); return chunk('VP8X', payload); }
function picture(kind, width, height) {
  const payload = Buffer.alloc(kind === 'VP8L' ? 5 : 10);
  if (kind === 'VP8L') { payload[0] = 0x2f; payload.writeUInt32LE(((width - 1) | (height - 1) << 14) >>> 0, 1); }
  else { payload.set([0x9d, 1, 0x2a], 3); payload.writeUInt16LE(width, 6); payload.writeUInt16LE(height, 8); }
  return chunk(kind, payload);
}
function animation(width, height, nested = []) { const header = Buffer.alloc(16); header.writeUIntLE(width - 1, 6, 3); header.writeUIntLE(height - 1, 9, 3); return chunk('ANMF', Buffer.concat([header, ...nested])); }

test('compact PNG/GIF headers refuse excessive allocation with or without source metadata', () => {
  for (const [bytes, mime] of [[png(16385, 1), 'png'], [png(16000, 3000), 'png'], [gif(16385, 1), 'gif'], [gif(10000, 5000), 'gif']]) {
    assert.throws(() => checkEmbeddedRasterLimits(url(bytes, mime)), /16,384|40 megapixels/);
    assert.throws(() => checkEmbeddedRasterLimits(url(bytes, mime), 1, 1), /16,384|40 megapixels/);
  }
  assert.equal(checkEmbeddedRasterLimits(url(png(8000, 5000)), 1, 1), true);
  assert.equal(checkEmbeddedRasterLimits(url(gif(MAX_RASTER_EDGE, 1), 'gif')), true);
  assert.equal(MAX_RASTER_PIXELS, 40_000_000);
});

test('declared limits run before atob, even when metadata is fractional or a source is cached', () => {
  const original = globalThis.atob; let calls = 0; globalThis.atob = value => { calls++; return original(value); };
  try {
    const source = url(png(101, 103));
    assert.throws(() => checkEmbeddedRasterLimits(source, 16385, 1)); assert.throws(() => checkEmbeddedRasterLimits(source, 8000.5, 5000)); assert.equal(calls, 0);
    assert.equal(checkEmbeddedRasterLimits(source, 101.5, 103.25), true); assert.equal(calls, 1);
    assert.equal(checkEmbeddedRasterLimits(source, 103.25, 101.5), true); assert.equal(calls, 1);
    assert.throws(() => checkEmbeddedRasterLimits(source, 16385, 1)); assert.equal(calls, 1);
  } finally { globalThis.atob = original; }
});

test('legacy short and fake syntax fixtures remain accepted, without requiring a complete image', () => {
  for (const source of ['data:image/png;base64,iVBORw0KGgo=', 'data:image/png;base64,AAAA', 'data:image/jpeg;base64,/9j/', 'data:image/webp;base64,AAAA', 'data:image/gif;base64,R0lGODlh', 'data:image/png;base64,eA==']) assert.equal(checkEmbeddedRasterLimits(source, 800, 600), true);
  assert.equal(checkEmbeddedRasterLimits(url(png(200, 300)), 300, 200), true); // Orientation metadata may swap axes.
  assert.equal(checkEmbeddedRasterLimits(url(png(0, 0)), 1, 1), true); // Validity remains the decoder's job.
  assert.equal(checkEmbeddedRasterLimits(''), true); assert.equal(checkEmbeddedRasterLimits(url(gif(2, 3).subarray(0, 10), 'gif')), true);
});

test('actual magic bytes determine allocation checks even when MIME and declared dimensions lie', () => {
  assert.throws(() => checkEmbeddedRasterLimits(url(png(20000, 1), 'jpeg'), 1, 1));
  assert.throws(() => checkEmbeddedRasterLimits(url(gif(10000, 10000), 'png'), 2, 2));
  assert.equal(checkEmbeddedRasterLimits(url(png(10, 20), 'gif'), 20, 10), true);
});

test('every GIF frame is bounded after extensions, compressed blocks and colour tables', () => {
  for (const frame of [{ width: 17000, height: 1 }, { width: 8000, height: 6000 }]) assert.throws(() => checkEmbeddedRasterLimits(url(gif(1, 1, [{ width: 1, height: 1, palette: true }, frame], true), 'gif'), 1, 1));
  const safe = gif(20, 20, [{ width: 2, height: 3, palette: true }, { width: 4, height: 5 }], true); assert.equal(checkEmbeddedRasterLimits(url(safe, 'gif')), true);
  const incomplete = gif(1, 1, [{ width: 20000, height: 1 }]).subarray(0, 22); assert.throws(() => checkEmbeddedRasterLimits(url(incomplete, 'gif')));
});

test('all JPEG SOF marker variants and compact incomplete headers receive allocation checks', () => {
  for (const marker of [0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]) {
    assert.throws(() => checkEmbeddedRasterLimits(url(jpeg(20000, 1, marker, true), 'jpeg'), 1, 1));
    assert.throws(() => checkEmbeddedRasterLimits(url(jpeg(8000, 6000, marker), 'jpeg')));
    assert.equal(checkEmbeddedRasterLimits(url(jpeg(100, 200, marker, true), 'jpeg'), 200, 100), true);
  }
});

test('WebP VP8X canvas, lossy VP8 and lossless VP8L dimensions are checked independently', () => {
  assert.throws(() => checkEmbeddedRasterLimits(url(webp([canvas(20000, 1)]), 'webp'), 1, 1));
  for (const kind of ['VP8 ', 'VP8L']) {
    assert.throws(() => checkEmbeddedRasterLimits(url(webp([picture(kind, 10000, 10000)]), 'webp')));
    assert.throws(() => checkEmbeddedRasterLimits(url(webp([canvas(1, 1), picture(kind, 10000, 10000)]), 'webp'), 1, 1));
    assert.equal(checkEmbeddedRasterLimits(url(webp([canvas(1, 1), picture(kind, 300, 400)]), 'webp'), 400, 300), true);
  }
});

test('small WebP animation/canvas headers cannot mask oversized ANMF or nested bitstreams', () => {
  assert.throws(() => checkEmbeddedRasterLimits(url(webp([canvas(1, 1), animation(17000, 1)]), 'webp'), 1, 1));
  assert.throws(() => checkEmbeddedRasterLimits(url(webp([canvas(1, 1), animation(8000, 6000)]), 'webp'), 1, 1));
  for (const kind of ['VP8 ', 'VP8L']) {
    assert.throws(() => checkEmbeddedRasterLimits(url(webp([canvas(1, 1), animation(1, 1, [chunk('ALPH', Buffer.from([0])), picture(kind, 10000, 10000)])]), 'webp'), 1, 1));
    assert.equal(checkEmbeddedRasterLimits(url(webp([canvas(1, 1), animation(1, 1, [picture(kind, 2, 3)])]), 'webp')), true);
  }
});

test('truncated containers remain compatible but recognisable present oversized headers still fail', () => {
  const truncated = webp([canvas(17000, 1)]); truncated.writeUInt32LE(10000, 16);
  assert.throws(() => checkEmbeddedRasterLimits(url(truncated, 'webp')));
  assert.equal(checkEmbeddedRasterLimits(url(webp([canvas(10, 20)]).subarray(0, 27), 'webp')), true);
  assert.equal(checkEmbeddedRasterLimits(url(Buffer.from([255, 216, 255, 224, 255, 255, 1, 2]), 'jpeg')), true);
});

test('header scanning has a fixed shared step budget and does not silently skip later headers', () => {
  const emptyChunk = chunk('JUNK', Buffer.alloc(0));
  const excessive = webp([Buffer.concat(Array.from({ length: MAX_RASTER_HEADER_STEPS + 1 }, () => emptyChunk))]);
  assert.throws(() => checkEmbeddedRasterLimits(url(excessive, 'webp')), /too many header blocks/);
  const jpegFills = Buffer.concat([Buffer.from([255, 216]), Buffer.alloc(MAX_RASTER_HEADER_STEPS + 2, 255)]);
  assert.throws(() => checkEmbeddedRasterLimits(url(jpegFills, 'jpeg')), /too many header blocks/);
  assert.equal(checkEmbeddedRasterLimits(url(webp([emptyChunk, canvas(300, 400)]), 'webp')), true);
});
