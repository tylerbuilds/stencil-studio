import { createElement, parseDocument } from './model.js';
import { collectAssetNotices } from './asset-notices.js';

export const MAX_FILES = 20;
export const MAX_IMAGE_BYTES = 6 * 1024 * 1024;
export const MAX_BATCH_BYTES = 8 * 1024 * 1024;
export const MAX_TEXT_LENGTH = 10000;
const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];
const fail = message => { throw new Error(message); };
const abort = signal => { if (signal?.aborted) throw new DOMException('Insertion cancelled.', 'AbortError'); };
const ascii = (bytes, start, length) => String.fromCharCode(...bytes.subarray(start, start + length));
const u16 = (bytes, start) => bytes[start] * 256 + bytes[start + 1];
const le24 = (bytes, start) => bytes[start] + bytes[start + 1] * 256 + bytes[start + 2] * 65536;

export function identifyRaster(bytes) {
  if (!(bytes instanceof Uint8Array)) fail('The image could not be read.');
  if (bytes.length >= 24 && ascii(bytes, 1, 3) === 'PNG' && bytes[0] === 137 && bytes[4] === 13 && bytes[5] === 10 && bytes[6] === 26 && bytes[7] === 10 && ascii(bytes, 12, 4) === 'IHDR') {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    return { type: 'image/png', width: view.getUint32(16), height: view.getUint32(20) };
  }
  if (bytes.length >= 10 && ['GIF87a', 'GIF89a'].includes(ascii(bytes, 0, 6))) return { type: 'image/gif', width: bytes[6] + bytes[7] * 256, height: bytes[8] + bytes[9] * 256 };
  if (bytes.length >= 30 && ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 4) === 'WEBP') {
    const chunk = ascii(bytes, 12, 4);
    if (chunk === 'VP8X') return { type: 'image/webp', width: le24(bytes, 24) + 1, height: le24(bytes, 27) + 1 };
    if (chunk === 'VP8 ' && ascii(bytes, 23, 3) === '\x9d\x01\x2a') return { type: 'image/webp', width: (bytes[26] + bytes[27] * 256) & 16383, height: (bytes[28] + bytes[29] * 256) & 16383 };
    if (chunk === 'VP8L' && bytes[20] === 47) return { type: 'image/webp', width: 1 + bytes[21] + ((bytes[22] & 63) << 8), height: 1 + (bytes[22] >> 6) + (bytes[23] << 2) + ((bytes[24] & 15) << 10) };
  }
  if (bytes.length >= 4 && bytes[0] === 255 && bytes[1] === 216) {
    const starts = new Set([192, 193, 194, 195, 197, 198, 199, 201, 202, 203, 205, 206, 207]);
    let offset = 2;
    while (offset < bytes.length) {
      if (bytes[offset++] !== 255) break;
      while (bytes[offset] === 255) offset++;
      const marker = bytes[offset++];
      if (marker === 217 || marker === 218) break;
      if (marker === 1 || marker >= 208 && marker <= 215) continue;
      if (offset + 2 > bytes.length) break;
      const length = u16(bytes, offset);
      if (length < 2 || offset + length > bytes.length) break;
      if (starts.has(marker) && length >= 8) return { type: 'image/jpeg', width: u16(bytes, offset + 5), height: u16(bytes, offset + 3) };
      offset += length;
    }
  }
  fail("Choose a PNG, JPEG, WebP or GIF image. Save SVG artwork as one of these image types first.");
}

export function checkImageDimensions(width, height) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width > 16384 || height > 16384 || width * height > 40000000) fail("Use an image up to 16,384 pixels on each side and 40 megapixels in total.");
}
export function validatePlainText(text) {
  if (typeof text !== 'string' || !text.length || text.length > MAX_TEXT_LENGTH || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(text)) fail("Use 1 to 10,000 characters of plain text, without hidden control characters.");
  return text;
}
export function classifyFiles(files) {
  if (!Array.isArray(files) || !files.length || files.length > MAX_FILES) fail(`Choose between 1 and ${MAX_FILES} files.`);
  const kinds = files.map(file => {
    if (!file || !Number.isInteger(file.size) || file.size < 1) fail("This file is empty or cannot be read. Choose another file.");
    const type = String(file.type || '').toLowerCase(), name = String(file.name || '');
    if (type === 'application/json' || /\.json$/i.test(name)) { if (file.size > 12 * 1024 * 1024) fail("This design is too large. Use a file up to 12 MiB."); return 'document'; }
    if (type === 'text/plain' || /\.txt$/i.test(name)) { if (file.size > MAX_TEXT_LENGTH * 4 + 4) fail('This text file is too large. Use up to 10,000 characters.'); return 'text'; }
    if (IMAGE_TYPES.includes(type) || !type && /\.(png|jpe?g|webp|gif)$/i.test(name)) { if (file.size > MAX_IMAGE_BYTES) fail("Use images up to 6 MiB each."); return 'image'; }
    fail('Choose PNG, JPEG, WebP, GIF, UTF-8 .txt or a Stencil .json design. HTML, SVG, PDF and other files are not supported.');
  });
  if (kinds.includes('document') && files.length !== 1) fail("Open one Stencil JSON design at a time. Add images and text files separately.");
  if (!kinds.includes('document') && files.reduce((total, file) => total + file.size, 0) > MAX_BATCH_BYTES) fail("These files are over the 8 MiB total limit. Add fewer files at a time.");
  return kinds;
}
export function placement(page, width, height, point, index = 0) {
  const x = (point?.x ?? page.width / 2) + index * 24, y = (point?.y ?? page.height / 2) + index * 24;
  return { x: Number(Math.max(0, Math.min(page.width - width, x - width / 2)).toFixed(3)), y: Number(Math.max(0, Math.min(page.height - height, y - height / 2)).toFixed(3)) };
}
export function textElement(text, page, brand, point, index = 0) {
  validatePlainText(text);
  const width = Math.min(420, page.width * .7), height = Math.min(page.height * .65, Math.max(60, 28 * (text.split(/\r\n|\r|\n/).length * 1.18 + .25)));
  return createElement('text', { text, width, height, ...placement(page, width, height, point, index), fontSize: 28, fontWeight: 400, fontFamily: brand.fontFamily, fill: brand.colours[2] ?? brand.colours[0] });
}
function readDataURL(blob, signal) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    const cancel = () => reader.abort();
    const finish = () => signal?.removeEventListener('abort', cancel);
    reader.onload = () => { finish(); resolve(reader.result); };
    reader.onerror = () => { finish(); reject(new Error('This image could not be read.')); };
    reader.onabort = () => { finish(); reject(new DOMException('Insertion cancelled.', 'AbortError')); };
    signal?.addEventListener('abort', cancel, { once: true }); reader.readAsDataURL(blob);
  });
}
function decodeImage(blob, signal) {
  return new Promise((resolve, reject) => {
    const image = new Image(), url = URL.createObjectURL(blob);
    const finish = () => { clearTimeout(timer); signal?.removeEventListener('abort', cancel); URL.revokeObjectURL(url); image.onload = null; image.onerror = null; };
    const cancel = () => { finish(); image.removeAttribute('src'); reject(new DOMException('Insertion cancelled.', 'AbortError')); };
    const timer = setTimeout(() => { finish(); reject(new Error("This image took too long to open. Try a smaller image.")); }, 20000);
    image.onload = () => { const result = { width: image.naturalWidth, height: image.naturalHeight }; finish(); resolve(result); };
    image.onerror = () => { finish(); reject(new Error("This image is damaged or cannot be opened in your browser.")); };
    signal?.addEventListener('abort', cancel, { once: true }); image.src = url;
  });
}
export async function prepareFiles(files, { page, brand, point, signal } = {}) {
  const kinds = classifyFiles(files), elements = [];
  for (let index = 0; index < files.length; index++) {
    abort(signal); const file = files[index], bytes = new Uint8Array(await file.arrayBuffer()); abort(signal);
    if (bytes.length !== file.size) fail("This file changed while it was being read. Choose it again.");
    if (kinds[index] !== 'image') {
      let text; try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { fail('Text and design files must use valid UTF-8.'); }
      if (kinds[index] === 'document') return { kind: 'document', document: parseDocument(text) };
      elements.push(textElement(text, page, brand, point, index)); continue;
    }
    const raster = identifyRaster(bytes); checkImageDimensions(raster.width, raster.height);
    if (file.type && file.type !== raster.type) fail("This image does not match its file type. Save it again as PNG, JPEG, WebP or GIF.");
    const blob = new Blob([bytes], { type: raster.type }), dimensions = await decodeImage(blob, signal); abort(signal);
    checkImageDimensions(dimensions.width, dimensions.height);
    const src = await readDataURL(blob, signal); abort(signal);
    // Ordinary uploads stay unchanged; recognised library credits must be intact.
    collectAssetNotices([{ type: 'image', src }]);
    const scale = Math.min(1, page.width * .65 / dimensions.width, page.height * .65 / dimensions.height), width = Math.max(1, dimensions.width * scale), height = Math.max(1, dimensions.height * scale);
    elements.push(createElement('image', { src, sourceWidth: dimensions.width, sourceHeight: dimensions.height, width, height, ...placement(page, width, height, point, index) }));
  }
  return { kind: 'elements', elements };
}
