/** Header allocation limits, before a native image decoder. No DOM/model imports. */
export const MAX_RASTER_EDGE = 16_384;
export const MAX_RASTER_PIXELS = 40_000_000;
export const MAX_RASTER_HEADER_STEPS = 131_072;
const MAX_SOURCE_LENGTH = 8 * 1024 * 1024 + 64;
const MAX_CACHE_ENTRIES = 32, MAX_CACHE_BYTES = 8 * 1024 * 1024;
const checkedSources = new Map();
let cacheBytes = 0;
const fail = () => { throw new Error('Use an image up to 16,384 pixels on each side and 40 megapixels in total.'); };
const ascii = (bytes, start, count) => String.fromCharCode(...bytes.subarray(start, start + count));
const u16 = (bytes, at, little = false) => little ? bytes[at] + bytes[at + 1] * 256 : bytes[at] * 256 + bytes[at + 1];
const u24 = (bytes, at) => bytes[at] + bytes[at + 1] * 256 + bytes[at + 2] * 65536;
const u32 = (bytes, at, little = false) => little ? (bytes[at] | bytes[at + 1] << 8 | bytes[at + 2] << 16 | bytes[at + 3] << 24) >>> 0 : (bytes[at] << 24 | bytes[at + 1] << 16 | bytes[at + 2] << 8 | bytes[at + 3]) >>> 0;

function declaredDimensions(width, height) {
  for (const value of [width, height]) if (value !== undefined && (typeof value !== 'number' || !Number.isFinite(value) || value <= 0 || value > MAX_RASTER_EDGE)) fail();
  if (width !== undefined && height !== undefined && width * height > MAX_RASTER_PIXELS) fail();
}
function headerDimensions(width, height) {
  // Zero/truncated/malformed image validity stays with the existing decoder.
  // This guard refuses only recognisable excessive allocations.
  if (width > MAX_RASTER_EDGE || height > MAX_RASTER_EDGE || width * height > MAX_RASTER_PIXELS) fail();
}
function scanBudget() {
  let steps = 0;
  return () => { if (++steps > MAX_RASTER_HEADER_STEPS) throw new Error('This image has too many header blocks to check safely. Use a simpler image.'); };
}

function png(bytes) {
  if (bytes.length < 24 || ![137, 80, 78, 71, 13, 10, 26, 10].every((value, index) => bytes[index] === value) || ascii(bytes, 12, 4) !== 'IHDR') return false;
  headerDimensions(u32(bytes, 16), u32(bytes, 20)); return true;
}

function gif(bytes, step) {
  if (bytes.length < 10 || !['GIF87a', 'GIF89a'].includes(ascii(bytes, 0, 6))) return false;
  headerDimensions(u16(bytes, 6, true), u16(bytes, 8, true));
  if (bytes.length < 13) return true;
  let at = 13 + (bytes[10] & 0x80 ? 3 * 2 ** ((bytes[10] & 7) + 1) : 0);
  function skipBlocks() {
    while (at < bytes.length) {
      step();
      const size = bytes[at++];
      if (!size) return true;
      if (size > bytes.length - at) return false;
      at += size;
    }
    return false;
  }
  while (at < bytes.length) {
    step();
    const kind = bytes[at++];
    if (kind === 0x3b) break;
    if (kind === 0x21) {
      if (at >= bytes.length) break;
      at++; if (!skipBlocks()) break;
    } else if (kind === 0x2c) {
      if (at + 8 > bytes.length) break;
      headerDimensions(u16(bytes, at + 4, true), u16(bytes, at + 6, true));
      if (at + 9 > bytes.length) break;
      const packed = bytes[at + 8];
      at += 9 + (packed & 0x80 ? 3 * 2 ** ((packed & 7) + 1) : 0);
      if (at >= bytes.length) break;
      at++; // LZW minimum code size; validity is checked by the browser.
      if (!skipBlocks()) break;
    } else break;
  }
  return true;
}

const JPEG_SOF = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);
function jpeg(bytes, step) {
  if (bytes.length < 2 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return false;
  let at = 2;
  while (at < bytes.length) {
    step();
    if (bytes[at++] !== 0xff) break;
    while (bytes[at] === 0xff) { step(); at++; }
    if (at >= bytes.length) break;
    const marker = bytes[at++];
    if (marker === 0xd9 || marker === 0xda) break;
    if (marker === 1 || marker >= 0xd0 && marker <= 0xd7) continue;
    if (at + 2 > bytes.length) break;
    const size = u16(bytes, at);
    // Check a compact SOF header even when the rest of its segment is absent.
    if (JPEG_SOF.has(marker) && size >= 7 && at + 7 <= bytes.length) headerDimensions(u16(bytes, at + 5), u16(bytes, at + 3));
    if (size < 2 || size > bytes.length - at) break;
    at += size;
  }
  return true;
}

function webpPicture(bytes, kind, data, size, end) {
  if (kind === 'VP8X' && size >= 10 && data + 10 <= end) headerDimensions(u24(bytes, data + 4) + 1, u24(bytes, data + 7) + 1);
  if (kind === 'VP8 ' && size >= 10 && data + 10 <= end && bytes[data + 3] === 0x9d && bytes[data + 4] === 1 && bytes[data + 5] === 0x2a) headerDimensions(u16(bytes, data + 6, true) & 0x3fff, u16(bytes, data + 8, true) & 0x3fff);
  if (kind === 'VP8L' && size >= 5 && data + 5 <= end && bytes[data] === 0x2f) {
    const bits = u32(bytes, data + 1, true);
    headerDimensions((bits & 0x3fff) + 1, ((bits >>> 14) & 0x3fff) + 1);
  }
}
function webpChunks(bytes, start, end, frames, step) {
  let at = start;
  while (at + 8 <= end) {
    step();
    const kind = ascii(bytes, at, 4), size = u32(bytes, at + 4, true), data = at + 8;
    // A recognisable short header is enough. Do not demand a complete container.
    const availableEnd = Math.min(end, data + size);
    webpPicture(bytes, kind, data, size, availableEnd);
    if (kind === 'ANMF' && size >= 12 && data + 12 <= availableEnd) {
      headerDimensions(u24(bytes, data + 6) + 1, u24(bytes, data + 9) + 1);
      // Valid animation frames contain image chunks, never nested animations.
      // Keep recursion to one level while checking every nested image header.
      if (frames && size >= 24 && data + 24 <= availableEnd) webpChunks(bytes, data + 16, availableEnd, false, step);
    }
    const next = data + size + (size & 1);
    if (next > end) break;
    at = next;
  }
}
function webp(bytes, step) {
  if (bytes.length < 12 || ascii(bytes, 0, 4) !== 'RIFF' || ascii(bytes, 8, 4) !== 'WEBP') return false;
  webpChunks(bytes, 12, bytes.length, true, step); return true;
}

function remember(src) {
  if (src.length > MAX_CACHE_BYTES) return;
  while (checkedSources.size >= MAX_CACHE_ENTRIES || cacheBytes + src.length > MAX_CACHE_BYTES) {
    const oldest = checkedSources.keys().next().value;
    cacheBytes -= oldest.length; checkedSources.delete(oldest);
  }
  checkedSources.set(src, true); cacheBytes += src.length;
}

/**
 * Refuses excessive declared or recognisable raster-header allocations. This is
 * not a container-validity check: previous short/fake syntax fixtures still pass.
 * Width/height may be absent (v1) or finite positive fractions (old metadata).
 * Actual and metadata dimensions need not match, including oriented images.
 */
export function checkEmbeddedRasterLimits(src, width, height) {
  declaredDimensions(width, height); // Must run before atob or cache lookup.
  if (typeof src !== 'string' || !/^data:image\/(?:png|jpeg|webp|gif);base64,/i.test(src)) return true;
  if (src.length > MAX_SOURCE_LENGTH) throw new Error('Use an embedded image up to 6 MB before encoding.');
  if (checkedSources.has(src)) return true;
  const encoded = src.slice(src.indexOf(',') + 1);
  let binary;
  try { binary = atob(encoded); } catch { return true; }
  const bytes = Uint8Array.from(binary, character => character.charCodeAt(0));
  // Sniff actual bytes rather than trusting the declared MIME or source size.
  const step = scanBudget();
  if (!png(bytes) && !gif(bytes, step) && !jpeg(bytes, step)) webp(bytes, step);
  remember(src); return true;
}
