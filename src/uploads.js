/** A small reusable raster shelf. Records stay on this browser; licence facts are supplied by the user. */
import { id as createId } from './model.js';

export const UPLOADS_KEY = 'stencil-studio.uploads.v1';
export const UPLOADS_SCHEMA = 'stencil-studio-uploads';
export const UPLOADS_VERSION = 1;
export const MAX_UPLOADS = 20;
// This bounds the entire UTF-8 JSON shelf, including base64 and metadata, rather than just image bytes.
export const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;
export const MAX_UPLOAD_EDGE = 16_384;
export const MAX_UPLOAD_PIXELS = 40_000_000;
const encoder = new TextEncoder();
const snapshots = new WeakMap();
const controls = /[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/;
const emptyShelf = () => ({ schema: UPLOADS_SCHEMA, version: UPLOADS_VERSION, uploads: [] });
const clone = value => structuredClone(value);
const byteLength = value => encoder.encode(value).byteLength;

export class UploadError extends Error {
  constructor(message, code = 'invalid-upload', cause) {
    super(message, cause ? { cause } : undefined);
    this.name = 'UploadError'; this.code = code;
  }
}
const require = (condition, message, code) => { if (!condition) throw new UploadError(message, code); };

// Read descriptors before values so imports cannot execute getters or custom toJSON methods.
function checkJSON(value) {
  const seen = new WeakSet(); let nodes = 0, bytes = 0;
  function visit(item, depth) {
    require(++nodes <= 10000 && depth <= 12, 'This upload backup is too complex.');
    if (typeof item === 'string') {
      require(item.length <= MAX_UPLOAD_BYTES, 'This upload backup is too large. Use a file up to 8 MB.');
      bytes += byteLength(item);
      require(bytes <= MAX_UPLOAD_BYTES, 'This upload backup is too large. Use a file up to 8 MB.'); return;
    }
    if (item === null || typeof item === 'boolean') return;
    if (typeof item === 'number') { require(Number.isFinite(item), 'Uploads must contain valid JSON data.'); return; }
    require(item && typeof item === 'object', 'Uploads must contain valid JSON data.');
    require(!seen.has(item), 'Upload data cannot contain cycles.'); seen.add(item);
    const array = Array.isArray(item);
    require(array ? Object.getPrototypeOf(item) === Array.prototype : [Object.prototype, null].includes(Object.getPrototypeOf(item)), 'Upload objects must be plain JSON data.');
    const keys = Reflect.ownKeys(item);
    require(!array || keys.length === item.length + 1, 'Upload arrays cannot have missing entries or extra properties.');
    for (const key of keys) {
      if (array && key === 'length') continue;
      require(typeof key === 'string' && !['__proto__', 'constructor', 'prototype'].includes(key), 'Upload data contains an unsupported property.');
      if (array) require(/^(0|[1-9]\d*)$/.test(key) && Number(key) < item.length, 'Upload arrays contain unsupported properties.');
      const descriptor = Object.getOwnPropertyDescriptor(item, key);
      require(descriptor.enumerable && 'value' in descriptor, 'Upload data cannot contain getters or hidden properties.');
      visit(descriptor.value, depth + 1);
    }
    seen.delete(item);
  }
  visit(value, 0);
}
function fields(value, allowed, label, optionalUndefined = false) {
  require(value && typeof value === 'object' && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value)), `${label} must be a plain object.`);
  const output = {};
  for (const key of Reflect.ownKeys(value)) {
    require(typeof key === 'string' && allowed.includes(key), `${label} contains unsupported properties.`);
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    require(descriptor.enumerable && 'value' in descriptor, `${label} cannot contain getters or hidden properties.`);
    if (optionalUndefined && descriptor.value === undefined) continue;
    output[key] = descriptor.value;
  }
  checkJSON(output); return output;
}
function identifier(value) {
  require(typeof value === 'string' && value.length > 0 && value.length <= 100 && /^[\w-]+$/.test(value), 'Upload ID must be a valid identifier.'); return value;
}
function text(value, label, maximum, allowEmpty = false) {
  require(typeof value === 'string' && value.length <= maximum && !controls.test(value) && (allowEmpty || value.trim().length > 0), `${label} needs ${allowEmpty ? 'up to' : '1 to'} ${maximum} characters without hidden control characters.`);
  return value.trim();
}
function licenceFacts(value) {
  const facts = fields(value, ['name', 'creator', 'sourceUrl', 'licenceUrl', 'attribution'], 'Licence details');
  const output = {};
  for (const [key, fact] of Object.entries(facts)) {
    if (['sourceUrl', 'licenceUrl'].includes(key)) {
      const url = text(fact, 'Source or licence URL', 2000);
      let parsed; try { parsed = new URL(url); } catch { throw new UploadError('Use a complete http or https URL for source or licence details.'); }
      require(['http:', 'https:'].includes(parsed.protocol) && !parsed.username && !parsed.password, 'Use an http or https URL without credentials for source or licence details.'); output[key] = url;
    } else output[key] = text(fact, 'Licence details', key === 'attribution' ? 1000 : 200);
  }
  return output;
}
const number = (value, low, high, message) => require(Number.isInteger(value) && value >= low && value <= high, message);
function checkedDimensions(width, height) {
  number(width, 1, MAX_UPLOAD_EDGE, 'Image width must be between 1 and 16,384 pixels.');
  number(height, 1, MAX_UPLOAD_EDGE, 'Image height must be between 1 and 16,384 pixels.');
  require(width * height <= MAX_UPLOAD_PIXELS, 'Images can contain up to 40 million pixels. Choose a smaller image.', 'image-too-large');
}
const ascii = (bytes, start, count) => String.fromCharCode(...bytes.subarray(start, start + count));
const u16 = (bytes, at, little = false) => little ? bytes[at] | bytes[at + 1] << 8 : bytes[at] << 8 | bytes[at + 1];
const u24 = (bytes, at) => bytes[at] | bytes[at + 1] << 8 | bytes[at + 2] << 16;
const u32 = (bytes, at, little = false) => little ? (bytes[at] | bytes[at + 1] << 8 | bytes[at + 2] << 16 | bytes[at + 3] << 24) >>> 0 : (bytes[at] << 24 | bytes[at + 1] << 16 | bytes[at + 2] << 8 | bytes[at + 3]) >>> 0;
const badImage = () => new UploadError('This file does not have a valid PNG, JPEG, WebP or GIF raster header.', 'invalid-raster');
function exifOrientation(bytes, start, end) {
  if (ascii(bytes, start, 6) === 'Exif\0\0') start += 6;
  if (end - start < 8) return 1;
  const order = ascii(bytes, start, 2), little = order === 'II';
  if (!['II', 'MM'].includes(order) || u16(bytes, start + 2, little) !== 42) return 1;
  const directory = start + u32(bytes, start + 4, little);
  if (directory < start + 8 || directory + 2 > end) return 1;
  const count = u16(bytes, directory, little);
  if (count > 512 || directory + 2 + count * 12 > end) return 1;
  for (let index = 0; index < count; index++) {
    const at = directory + 2 + index * 12;
    if (u16(bytes, at, little) === 0x112 && u16(bytes, at + 2, little) === 3 && u32(bytes, at + 4, little) === 1) {
      const orientation = u16(bytes, at + 8, little); return orientation >= 1 && orientation <= 8 ? orientation : 1;
    }
  }
  return 1;
}
function webpImageDimensions(bytes, data, size, kind) {
  let width, height;
  if (kind === 'VP8L') {
    if (size < 5 || bytes[data] !== 0x2f) throw badImage();
    const bits = u32(bytes, data + 1, true); if (bits >>> 29) throw badImage();
    width = (bits & 0x3fff) + 1; height = ((bits >>> 14) & 0x3fff) + 1;
  } else {
    if (size < 10 || bytes[data] & 1 || ![0x9d, 0x01, 0x2a].every((value, index) => bytes[data + 3 + index] === value)) throw badImage();
    width = u16(bytes, data + 6, true) & 0x3fff; height = u16(bytes, data + 8, true) & 0x3fff;
  }
  checkedDimensions(width, height); return { width, height };
}
function rasterDimensions(bytes, mime) {
  let width, height, orientation = 1;
  if (mime === 'image/png') {
    if (bytes.length < 45 || ![137, 80, 78, 71, 13, 10, 26, 10].every((value, index) => bytes[index] === value)) throw badImage();
    let at = 8, imageData = false, ended = false, header = false;
    while (at + 12 <= bytes.length) {
      const size = u32(bytes, at), kind = ascii(bytes, at + 4, 4), data = at + 8, next = data + size + 4;
      if (next > bytes.length || !/^[A-Za-z]{4}$/.test(kind)) throw badImage();
      if (!header) {
        if (kind !== 'IHDR' || size !== 13) throw badImage();
        width = u32(bytes, data); height = u32(bytes, data + 4);
        const colour = bytes[data + 9], depths = { 0: [1, 2, 4, 8, 16], 2: [8, 16], 3: [1, 2, 4, 8], 4: [8, 16], 6: [8, 16] };
        if (!depths[colour]?.includes(bytes[data + 8]) || bytes[data + 10] !== 0 || bytes[data + 11] !== 0 || bytes[data + 12] > 1) throw badImage(); header = true;
      } else if (kind === 'IHDR') throw badImage();
      if (kind === 'IDAT' && size) imageData = true;
      if (kind === 'eXIf') orientation = exifOrientation(bytes, data, data + size);
      if (kind === 'IEND') { if (size !== 0 || next !== bytes.length) throw badImage(); ended = true; break; }
      at = next;
    }
    if (!header || !imageData || !ended) throw badImage();
  } else if (mime === 'image/jpeg') {
    if (bytes.length < 12 || bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes.at(-2) !== 0xff || bytes.at(-1) !== 0xd9) throw badImage();
    let at = 2, scan = false;
    while (at < bytes.length - 2) {
      if (bytes[at++] !== 0xff) throw badImage();
      while (bytes[at] === 0xff) at++;
      const marker = bytes[at++];
      if (!marker || [0xd8, 0xd9].includes(marker)) throw badImage();
      if (marker === 1 || marker >= 0xd0 && marker <= 0xd7) continue;
      if (at + 2 > bytes.length) throw badImage();
      const size = u16(bytes, at), end = at + size;
      if (size < 2 || end > bytes.length - 2) throw badImage();
      if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
        if (size < 8 || width !== undefined || !bytes[at + 7] || size !== 8 + bytes[at + 7] * 3) throw badImage();
        height = u16(bytes, at + 3); width = u16(bytes, at + 5);
      }
      if (marker === 0xe1 && ascii(bytes, at + 2, 6) === 'Exif\0\0') orientation = exifOrientation(bytes, at + 2, end);
      if (marker === 0xda) { if (size < 6) throw badImage(); scan = true; break; }
      at = end;
    }
    if (!scan || width === undefined) throw badImage();
  } else if (mime === 'image/gif') {
    if (bytes.length < 14 || !['GIF87a', 'GIF89a'].includes(ascii(bytes, 0, 6))) throw badImage();
    width = u16(bytes, 6, true); height = u16(bytes, 8, true);
    let at = 13 + (bytes[10] & 0x80 ? 3 * 2 ** ((bytes[10] & 7) + 1) : 0), imageData = false, ended = false;
    function blocks() {
      while (at < bytes.length) { const size = bytes[at++]; if (!size) return; if (at + size > bytes.length) throw badImage(); at += size; }
      throw badImage();
    }
    while (at < bytes.length) {
      const kind = bytes[at++];
      if (kind === 0x3b) { if (at !== bytes.length) throw badImage(); ended = true; break; }
      if (kind === 0x21) { if (at >= bytes.length) throw badImage(); at++; blocks(); }
      else if (kind === 0x2c) {
        if (at + 9 > bytes.length) throw badImage();
        const left = u16(bytes, at, true), top = u16(bytes, at + 2, true), frameWidth = u16(bytes, at + 4, true), frameHeight = u16(bytes, at + 6, true), packed = bytes[at + 8];
        if (!frameWidth || !frameHeight || left + frameWidth > width || top + frameHeight > height) throw badImage();
        at += 9 + (packed & 0x80 ? 3 * 2 ** ((packed & 7) + 1) : 0);
        if (at >= bytes.length || bytes[at] < 2 || bytes[at] > 8) throw badImage(); at++; blocks(); imageData = true;
      } else throw badImage();
    }
    if (!ended || !imageData) throw badImage();
  } else {
    if (bytes.length < 20 || ascii(bytes, 0, 4) !== 'RIFF' || ascii(bytes, 8, 4) !== 'WEBP' || u32(bytes, 4, true) !== bytes.length - 8) throw badImage();
    let at = 12, imageData = false;
    while (at + 8 <= bytes.length) {
      const kind = ascii(bytes, at, 4), size = u32(bytes, at + 4, true), data = at + 8, end = data + size;
      if (end + (size & 1) > bytes.length) throw badImage();
      if (kind === 'VP8X') {
        if (size !== 10 || width !== undefined) throw badImage(); width = u24(bytes, data + 4) + 1; height = u24(bytes, data + 7) + 1;
        checkedDimensions(width, height);
      }
      if (['VP8L', 'VP8 '].includes(kind)) {
        const image = webpImageDimensions(bytes, data, size, kind);
        if (width !== undefined && (image.width !== width || image.height !== height)) throw badImage();
        width = image.width; height = image.height; imageData = true;
      }
      if (kind === 'ANMF') {
        if (size < 24 || width === undefined) throw badImage();
        const frameX = u24(bytes, data) * 2, frameY = u24(bytes, data + 3) * 2, frameWidth = u24(bytes, data + 6) + 1, frameHeight = u24(bytes, data + 9) + 1;
        checkedDimensions(frameWidth, frameHeight);
        if (frameX + frameWidth > width || frameY + frameHeight > height) throw badImage();
        let part = data + 16, frameData = false;
        while (part + 8 <= end) {
          const partKind = ascii(bytes, part, 4), partSize = u32(bytes, part + 4, true), partData = part + 8, next = partData + partSize + (partSize & 1);
          if (next > end) throw badImage();
          if (['VP8L', 'VP8 '].includes(partKind)) {
            const image = webpImageDimensions(bytes, partData, partSize, partKind);
            if (frameData || image.width !== frameWidth || image.height !== frameHeight) throw badImage(); frameData = true;
          } else if (partKind !== 'ALPH') throw badImage();
          part = next;
        }
        if (part !== end || !frameData) throw badImage(); imageData = true;
      }
      if (kind === 'EXIF') orientation = exifOrientation(bytes, data, end);
      at = end + (size & 1);
    }
    if (at !== bytes.length || !imageData || width === undefined) throw badImage();
  }
  checkedDimensions(width, height);
  return orientation >= 5 ? { width: height, height: width } : { width, height };
}
function raster(src, width, height) {
  // Reject oversized declared dimensions before decoding or allocating base64 bytes.
  // Parsed header dimensions receive the same check before a record can reach an <img>.
  checkedDimensions(width, height);
  require(typeof src === 'string' && src.length <= MAX_UPLOAD_BYTES, 'Use an embedded PNG, JPEG, WebP or GIF image that fits the 8 MB upload shelf.', 'invalid-raster');
  const prefix = /^data:(image\/(?:png|jpeg|webp|gif));base64,/.exec(src);
  require(prefix, 'Use an embedded PNG, JPEG, WebP or GIF image.', 'invalid-raster');
  const encoded = src.slice(prefix[0].length);
  require(encoded.length > 0 && encoded.length % 4 === 0 && /^[A-Za-z0-9+/]+={0,2}$/.test(encoded), 'This image does not contain valid base64 data.', 'invalid-raster');
  let binary; try { binary = atob(encoded); } catch (cause) { throw new UploadError('This image does not contain valid base64 data.', 'invalid-raster', cause); }
  require(btoa(binary) === encoded, 'This image does not contain canonical base64 data.', 'invalid-raster');
  const bytes = Uint8Array.from(binary, character => character.charCodeAt(0));
  const dimensions = rasterDimensions(bytes, prefix[1]);
  require(width === dimensions.width && height === dimensions.height, 'The saved dimensions do not match this image header.', 'invalid-raster');
  return { mime: prefix[1], bytes: bytes.length };
}
function validDate(value) {
  require(typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value, 'Upload date must be a valid UTC timestamp.'); return value;
}
function timestamp(previous) {
  const now = Math.max(Date.now(), previous ? Date.parse(previous) + 1 : 0);
  require(Number.isFinite(now) && now >= 0 && now <= 253402300799999, 'The device clock cannot create a valid upload date.'); return new Date(now).toISOString();
}
function validateRecord(value) {
  const record = fields(value, ['id', 'name', 'src', 'width', 'height', 'mime', 'bytes', 'updatedAt', 'licence'], 'Saved upload');
  const checked = raster(record.src, record.width, record.height);
  require(record.mime === checked.mime && record.bytes === checked.bytes, 'Saved upload format and byte count must match the image.');
  return { id: identifier(record.id), name: text(record.name, 'Upload name', 150), src: record.src, width: record.width, height: record.height, ...checked, updatedAt: validDate(record.updatedAt), ...(record.licence === undefined ? {} : { licence: licenceFacts(record.licence) }) };
}
function validateShelf(value) {
  checkJSON(value); const shelf = fields(value, ['schema', 'version', 'uploads'], 'Upload shelf');
  require(shelf.schema === UPLOADS_SCHEMA && shelf.version === UPLOADS_VERSION, 'Open a Stencil Studio v1 upload backup.');
  require(Array.isArray(shelf.uploads) && shelf.uploads.length <= MAX_UPLOADS, 'Keep up to 20 reusable uploads. Export a backup, then remove an image to make room.');
  const ids = new Set(), uploads = shelf.uploads.map(item => {
    const record = validateRecord(item); require(!ids.has(record.id), 'This backup contains duplicate upload IDs.'); ids.add(record.id); return record;
  });
  const valid = { schema: UPLOADS_SCHEMA, version: UPLOADS_VERSION, uploads };
  require(byteLength(JSON.stringify(valid, null, 2)) <= MAX_UPLOAD_BYTES, 'Your reusable uploads are too large (8 MB maximum). Export a backup, then remove an image to make room.'); return valid;
}
function parseShelf(payload) {
  if (typeof payload !== 'string') return validateShelf(payload);
  require(payload.length <= MAX_UPLOAD_BYTES && byteLength(payload) <= MAX_UPLOAD_BYTES, 'This upload backup is too large. Use a file up to 8 MB.');
  let value; try { value = JSON.parse(payload); } catch (cause) { throw new UploadError('This upload backup is not valid JSON.', 'invalid-json', cause); }
  return validateShelf(value);
}
function storageFor(storage) {
  try {
    const resolved = storage ?? globalThis.localStorage;
    require(resolved && typeof resolved.getItem === 'function' && typeof resolved.setItem === 'function', 'Browser storage is unavailable. Your image file has not been changed.', 'storage-unavailable'); return resolved;
  } catch (cause) { if (cause instanceof UploadError) throw cause; throw new UploadError('Browser storage is unavailable. Your image file has not been changed.', 'storage-unavailable', cause); }
}
function rawShelf(storage) {
  let raw; try { raw = storage.getItem(UPLOADS_KEY); } catch (cause) { throw new UploadError('Your uploads cannot be opened because browser storage is unavailable.', 'storage-unavailable', cause); }
  require(raw === null || typeof raw === 'string', 'Browser storage returned invalid upload data.', 'storage-unavailable'); return raw;
}
function readShelf(storage) {
  const raw = rawShelf(storageFor(storage));
  try { const shelf = raw === null ? emptyShelf() : parseShelf(raw); snapshots.set(shelf, raw); return shelf; }
  catch (cause) { throw new UploadError(`Your uploads could not be opened. Their stored data has been kept. ${cause.message}`, 'invalid-stored-uploads', cause); }
}
function writeShelf(shelf, storage) {
  const valid = validateShelf(shelf), payload = JSON.stringify(valid, null, 2), resolved = storageFor(storage);
  require(rawShelf(resolved) === snapshots.get(shelf), 'Your uploads changed in another tab. Refresh Uploads and try again.', 'uploads-conflict');
  try { resolved.setItem(UPLOADS_KEY, payload); }
  catch (cause) { throw new UploadError('Your uploads could not be saved because browser storage is full or unavailable. Previously saved uploads are unchanged. Keep your original image file or export a backup.', 'storage-write-failed', cause); }
  return valid;
}
function findUpload(shelf, value) {
  const id = identifier(value), record = shelf.uploads.find(item => item.id === id);
  require(record, 'Upload not found. Refresh Uploads and try again.', 'upload-not-found'); return record;
}
function expected(options, record) {
  if (options.expectedUpdatedAt === undefined) return;
  validDate(options.expectedUpdatedAt);
  require(record && options.expectedUpdatedAt === record.updatedAt, 'This upload changed in another tab. Refresh Uploads before changing it.', 'upload-conflict');
}
function uniqueId(shelf) {
  for (let attempt = 0; attempt < 64; attempt++) { const id = identifier(createId()); if (!shelf.uploads.some(item => item.id === id)) return id; }
  throw new UploadError('A unique upload ID could not be created. Previously saved uploads are unchanged. Try again.', 'id-unavailable');
}

/** Returns independent records, including embedded src values for reusable previews. */
export function listUploads(storage) {
  return clone(readShelf(storage).uploads).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
}
export function loadUpload(id, storage) { return clone(findUpload(readShelf(storage), id)); }

/** Decode the image in the browser before saving; this module checks containers and headers, not pixel decoding. */
export function saveUpload(asset, options = {}, storage) {
  const input = fields(asset, ['name', 'src', 'width', 'height', 'licence'], 'Upload', true);
  options = fields(options, ['id', 'expectedUpdatedAt'], 'Save options', true);
  const checked = raster(input.src, input.width, input.height), shelf = readShelf(storage);
  const existing = options.id === undefined ? null : findUpload(shelf, options.id); expected(options, existing);
  const record = { id: existing?.id ?? uniqueId(shelf), name: text(input.name, 'Upload name', 150), src: input.src, width: input.width, height: input.height, ...checked, updatedAt: timestamp(existing?.updatedAt), ...(input.licence === undefined ? {} : { licence: licenceFacts(input.licence) }) };
  if (existing) shelf.uploads[shelf.uploads.indexOf(existing)] = record; else shelf.uploads.push(record);
  writeShelf(shelf, storage); return clone(record);
}
export function renameUpload(id, name, storage, options = {}) {
  options = fields(options, ['expectedUpdatedAt'], 'Rename options', true);
  const shelf = readShelf(storage), record = findUpload(shelf, id); expected(options, record);
  record.name = text(name, 'Upload name', 150); record.updatedAt = timestamp(record.updatedAt); writeShelf(shelf, storage); return clone(record);
}
export function deleteUpload(id, storage, options = {}) {
  options = fields(options, ['expectedUpdatedAt'], 'Delete options', true);
  const shelf = readShelf(storage), record = findUpload(shelf, id); expected(options, record);
  shelf.uploads.splice(shelf.uploads.indexOf(record), 1); writeShelf(shelf, storage); return true;
}
export function exportUploads(storage) { return JSON.stringify(readShelf(storage), null, 2); }
function canonicalJSON(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJSON).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJSON(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}
export function importUploads(payload, options = {}, storage) {
  options = fields(options, ['mode'], 'Import options', true); const mode = options.mode ?? 'merge';
  require(['merge', 'replace'].includes(mode), 'Choose whether to add this upload backup or replace your uploads.');
  const imported = parseShelf(payload), shelf = mode === 'replace' ? emptyShelf() : readShelf(storage);
  if (mode === 'replace') snapshots.set(shelf, rawShelf(storageFor(storage)));
  let added = 0, skipped = 0;
  for (const record of imported.uploads) {
    const existing = shelf.uploads.find(item => item.id === record.id);
    if (existing) { require(canonicalJSON(existing) === canonicalJSON(record), `A different upload already uses ID ${record.id}. Export your existing uploads before choosing replacement.`, 'upload-id-conflict'); skipped++; }
    else { shelf.uploads.push(record); added++; }
  }
  if (mode === 'replace' || added) writeShelf(shelf, storage);
  return { imported: added, skipped, total: shelf.uploads.length };
}

/** Cooperating browser tabs can make writes atomic with Web Locks. The fallback only detects drift. */
let mutationQueue = Promise.resolve();
export async function withUploadsLock(operation, { locks = globalThis.navigator?.locks, signal } = {}) {
  require(typeof operation === 'function', 'An upload operation is required.');
  const boundedSignal = signal ? AbortSignal.any([signal, AbortSignal.timeout(5000)]) : AbortSignal.timeout(5000);
  const run = () => { require(!boundedSignal.aborted, 'Uploads are busy in another tab. Try again.', 'uploads-busy'); return operation(); };
  try {
    if (typeof locks?.request === 'function') return await locks.request(UPLOADS_KEY, { mode: 'exclusive', signal: boundedSignal }, run);
    const next = mutationQueue.then(run, run); mutationQueue = next.catch(() => {}); return await next;
  } catch (cause) { if (boundedSignal.aborted) throw new UploadError('Uploads are busy in another tab. Try again.', 'uploads-busy', cause); throw cause; }
}
