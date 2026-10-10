/** Ordered, bounded page images in a standard stored ZIP. No runtime dependencies. */
import { validateDocument } from './model.js';

export const MAX_ARCHIVE_BYTES = 64 * 1024 * 1024;
export const MAX_ARCHIVE_PIXELS = 120_000_000;
const encoder = new TextEncoder();
const fail = message => { throw new Error(message); };
const crcTable = Uint32Array.from({ length: 256 }, (_, value) => {
  for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ value >>> 1 : value >>> 1;
  return value >>> 0;
});
function crc32(bytes) {
  let value = 0xffffffff;
  for (const byte of bytes) value = crcTable[(value ^ byte) & 255] ^ value >>> 8;
  return (value ^ 0xffffffff) >>> 0;
}
export const exportSlug = title => String(title || 'design').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 64) || 'design';
const abort = signal => { if (signal?.aborted) throw new DOMException('Image download cancelled.', 'AbortError'); };
function abortable(promise, signal) {
  if (!signal) return Promise.resolve(promise);
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error, value) => { if (settled) return; settled = true; signal.removeEventListener('abort', cancel); error ? reject(error) : resolve(value); };
    const cancel = () => finish(new DOMException('Image download cancelled.', 'AbortError'));
    signal.addEventListener('abort', cancel, { once: true });
    Promise.resolve(promise).then(value => finish(null, value), error => finish(error ?? new Error('This page could not be saved.')));
    if (signal.aborted) cancel();
  });
}
function header(length) { const bytes = new Uint8Array(length); return { bytes, view: new DataView(bytes.buffer) }; }
function localHeader(name, bytes, checksum) {
  const result = header(30 + name.length), v = result.view;
  v.setUint32(0, 0x04034b50, true); v.setUint16(4, 20, true); v.setUint16(6, 0x0800, true);
  v.setUint16(12, 33, true); // A fixed valid DOS date: 1 January 1980.
  v.setUint32(14, checksum, true); v.setUint32(18, bytes, true); v.setUint32(22, bytes, true);
  v.setUint16(26, name.length, true); result.bytes.set(name, 30); return result.bytes;
}
function centralHeader(name, bytes, checksum, offset) {
  const result = header(46 + name.length), v = result.view;
  v.setUint32(0, 0x02014b50, true); v.setUint16(4, 20, true); v.setUint16(6, 20, true); v.setUint16(8, 0x0800, true);
  v.setUint16(14, 33, true); v.setUint32(16, checksum, true); v.setUint32(20, bytes, true); v.setUint32(24, bytes, true);
  v.setUint16(28, name.length, true); v.setUint32(42, offset, true); result.bytes.set(name, 46); return result.bytes;
}
function endHeader(count, bytes, offset) {
  const result = header(22), v = result.view; v.setUint32(0, 0x06054b50, true);
  v.setUint16(8, count, true); v.setUint16(10, count, true); v.setUint32(12, bytes, true); v.setUint32(16, offset, true);
  return result.bytes;
}
function cleanOptions(options) {
  if (!options || Object.getPrototypeOf(options) !== Object.prototype) fail('Image download options must be a plain object.');
  const output = {};
  for (const key of Reflect.ownKeys(options)) {
    const descriptor = Object.getOwnPropertyDescriptor(options, key);
    if (!['format', 'pageIds', 'renderPage', 'signal', 'onProgress'].includes(key) || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) fail('Image download options contain unsupported fields.');
    output[key] = descriptor.value;
  }
  return output;
}

/**
 * Capture the design once; render one page at a time. No partial archive escapes
 * on cancellation, quota refusal or a failed image. The callback owns raster
 * decoding and must observe the supplied signal where its APIs allow it.
 */
export async function buildPageArchive(document, options = {}) {
  const { format = 'png', pageIds, renderPage, signal, onProgress } = cleanOptions(options);
  if (!['png', 'jpeg'].includes(format) || typeof renderPage !== 'function' || onProgress !== undefined && typeof onProgress !== 'function') fail('Choose PNG or JPG and a page renderer.');
  const snapshot = validateDocument(document); abort(signal);
  let pages = snapshot.pages;
  if (pageIds !== undefined) {
    if (!Array.isArray(pageIds) || Object.getPrototypeOf(pageIds) !== Array.prototype || !pageIds.length || pageIds.length > 30 || Reflect.ownKeys(pageIds).length !== pageIds.length + 1) fail('Choose distinct pages from this design.');
    for (let index = 0; index < pageIds.length; index++) { const field = Object.getOwnPropertyDescriptor(pageIds, String(index)); if (!field?.enumerable || !Object.hasOwn(field, 'value') || typeof field.value !== 'string') fail('Choose distinct pages from this design.'); }
    if (new Set(pageIds).size !== pageIds.length || pageIds.some(id => !pages.some(page => page.id === id))) fail('Choose distinct pages from this design.');
    const chosen = new Set(pageIds); pages = pages.filter(page => chosen.has(page.id));
  }
  if (pages.reduce((sum, page) => sum + Math.round(page.width) * Math.round(page.height), 0) > MAX_ARCHIVE_PIXELS) fail('These pages are too large to download together. Choose fewer pages or smaller canvas sizes.');
  const mime = format === 'png' ? 'image/png' : 'image/jpeg', extension = format === 'png' ? 'png' : 'jpg';
  const entries = pages.map((page, index) => ({ page, name: `${String(index + 1).padStart(2, '0')}-${exportSlug(page.name)}.${extension}` }));
  const parts = [], central = [], files = []; let offset = 0, centralBytes = 0;
  for (const [index, { page, name }] of entries.entries()) {
    abort(signal); onProgress?.({ completed: index, total: entries.length, pageId: page.id }); abort(signal);
    const image = await abortable(renderPage(structuredClone(page), mime, { signal }), signal); abort(signal);
    if (!(image instanceof Blob) || image.type !== mime || image.size < 1) fail('A page could not be saved in the chosen image format. Try that page separately.');
    const nameBytes = encoder.encode(name), needed = 30 + nameBytes.length + image.size + centralBytes + 46 + nameBytes.length + 22;
    if (offset + needed > MAX_ARCHIVE_BYTES) fail('This image download is over 64 MiB. Choose fewer pages or JPG, or download pages separately.');
    const bytes = new Uint8Array(await abortable(image.arrayBuffer(), signal)); abort(signal);
    if (bytes.length !== image.size) fail('A rendered image changed while it was being saved. Try the page again.');
    const checksum = crc32(bytes), local = localHeader(nameBytes, bytes.length, checksum), directory = centralHeader(nameBytes, bytes.length, checksum, offset);
    parts.push(local, bytes); central.push(directory); offset += local.length + bytes.length; centralBytes += directory.length;
    files.push({ name, pageId: page.id, width: Math.round(page.width), height: Math.round(page.height), bytes: bytes.length });
    onProgress?.({ completed: index + 1, total: entries.length, pageId: page.id });
  }
  abort(signal);
  const blob = new Blob([...parts, ...central, endHeader(files.length, centralBytes, offset)], { type: 'application/zip' });
  if (blob.size > MAX_ARCHIVE_BYTES) fail('This image download is over 64 MiB. Download pages separately.');
  return { blob, files, pageCount: files.length, filename: `${exportSlug(snapshot.title)}-${extension}-pages.zip`, mime: 'application/zip' };
}
