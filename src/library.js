/** Named local designs. A failed validation or storage write never replaces a library. */
import { id as createId, validateDocument } from './model.js';
import { writeWithMigrationBackup } from './migration-storage.js';

export const LIBRARY_KEY = 'stencil-studio.library.v1';
export const LIBRARY_SCHEMA = 'stencil-studio-library';
export const LIBRARY_VERSION = 1;
export const MAX_DESIGNS = 20;
export const MAX_LIBRARY_BYTES = 18 * 1024 * 1024;
const encoder = new TextEncoder();
const clone = value => structuredClone(value);
const emptyLibrary = () => ({ schema: LIBRARY_SCHEMA, version: LIBRARY_VERSION, designs: [] });

export class LibraryError extends Error {
  constructor(message, code = 'invalid-library', cause) {
    super(message, cause ? { cause } : undefined);
    this.name = 'LibraryError';
    this.code = code;
  }
}

const require = (condition, message) => { if (!condition) throw new LibraryError(message); };
const byteLength = value => encoder.encode(value).byteLength;
function storageFor(storage) {
  try {
    const resolved = storage ?? globalThis.localStorage;
    require(resolved && typeof resolved.getItem === 'function' && typeof resolved.setItem === 'function', 'Browser storage is unavailable. Export your open design as JSON to keep a copy.');
    return resolved;
  } catch (cause) {
    throw new LibraryError('Browser storage is unavailable. Export your open design as JSON to keep a copy.', 'storage-unavailable', cause);
  }
}
function ownKeys(value, allowed, label) {
  require(value && typeof value === 'object' && !Array.isArray(value), `${label} must be an object.`);
  require(Object.keys(value).every(key => allowed.includes(key)), `${label} contains unsupported properties.`);
}
function checkedOptions(value, allowed, label) {
  ownKeys(value, allowed, label);
  require([Object.prototype, null].includes(Object.getPrototypeOf(value)), `${label} must be plain data.`);
  const options = {};
  for (const key of Reflect.ownKeys(value)) {
    require(typeof key === 'string' && allowed.includes(key), `${label} contains unsupported properties.`);
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    require(descriptor.enumerable && 'value' in descriptor, `${label} cannot contain getters or hidden properties.`);
    if (descriptor.value !== undefined) options[key] = descriptor.value;
  }
  checkJSON(options);
  return options;
}

// Object imports must be plain JSON data, just like parsed file imports. Inspect
// descriptors rather than reading getters, and bound work before cloning data.
function checkJSON(value) {
  const seen = new WeakSet();
  let nodes = 0, bytes = 0;
  function visit(item, depth) {
    require(++nodes <= 1000000 && depth <= 32, 'The library is too complex to import.');
    if (typeof item === 'string') {
      require(item.length <= MAX_LIBRARY_BYTES, 'The library is too large (18 MB maximum).');
      bytes += byteLength(item);
      require(bytes <= MAX_LIBRARY_BYTES, 'The library is too large (18 MB maximum).');
      return;
    }
    if (item === null || typeof item === 'boolean') return;
    if (typeof item === 'number') { require(Number.isFinite(item), 'Library values must be valid JSON data.'); return; }
    require(item && typeof item === 'object', 'Library values must be valid JSON data.');
    require(!seen.has(item), 'Library data cannot contain cycles.');
    seen.add(item);
    const array = Array.isArray(item);
    require(array ? Object.getPrototypeOf(item) === Array.prototype : [Object.prototype, null].includes(Object.getPrototypeOf(item)), 'Library objects must be plain JSON data.');
    const keys = Reflect.ownKeys(item);
    require(!array || keys.length === item.length + 1, 'Library arrays cannot contain missing entries or extra properties.');
    for (const key of keys) {
      if (array && key === 'length') continue;
      require(typeof key === 'string' && !['__proto__', 'constructor', 'prototype'].includes(key), 'Library data contains an unsupported property.');
      if (array) require(/^(0|[1-9]\d*)$/.test(key) && Number(key) < item.length, 'Library arrays contain unsupported properties.');
      const descriptor = Object.getOwnPropertyDescriptor(item, key);
      require(descriptor.enumerable && 'value' in descriptor, 'Library data cannot contain getters or hidden properties.');
      visit(descriptor.value, depth + 1);
    }
    seen.delete(item);
  }
  visit(value, 0);
}
function designId(value) {
  require(typeof value === 'string' && value.length > 0 && value.length <= 100 && /^[\w-]+$/.test(value), 'Saved design ID must be a valid identifier.');
  return value;
}
function designName(value) {
  require(typeof value === 'string' && value.trim().length > 0 && value.length <= 150 && !/[\u0000-\u001f\u007f]/.test(value), 'Design name must contain 1–150 characters without control characters.');
  return value.trim();
}
function validDocument(document) {
  checkJSON(document);
  try { return validateDocument(document); }
  catch (cause) { throw new LibraryError(`This design cannot be saved: ${cause.message}`, 'invalid-document', cause); }
}
function validateLibrary(value) {
  checkJSON(value);
  ownKeys(value, ['schema', 'version', 'designs'], 'Library');
  require(value.schema === LIBRARY_SCHEMA && value.version === LIBRARY_VERSION, 'Unsupported library format or version. Use a Stencil Studio v1 library backup.');
  require(Array.isArray(value.designs) && value.designs.length <= MAX_DESIGNS, `A library supports up to ${MAX_DESIGNS} saved designs. Export a backup, then remove a design to make room.`);
  const ids = new Set();
  const designs = value.designs.map(item => {
    ownKeys(item, ['id', 'name', 'updatedAt', 'document'], 'Saved design');
    const identifier = designId(item.id);
    require(!ids.has(identifier), 'The library contains duplicate design IDs.');
    ids.add(identifier);
    require(typeof item.updatedAt === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(item.updatedAt) && Number.isFinite(Date.parse(item.updatedAt)) && new Date(item.updatedAt).toISOString() === item.updatedAt, 'Saved design date must be a valid UTC timestamp.');
    return { id: identifier, name: designName(item.name), updatedAt: item.updatedAt, document: validDocument(item.document) };
  });
  const library = { schema: LIBRARY_SCHEMA, version: LIBRARY_VERSION, designs };
  require(byteLength(JSON.stringify(library, null, 2)) <= MAX_LIBRARY_BYTES, 'The library is too large (18 MB maximum). Export a backup, then remove a design to make room.');
  return library;
}
function parseLibrary(payload) {
  if (typeof payload !== 'string') return validateLibrary(payload);
  require(byteLength(payload) <= MAX_LIBRARY_BYTES, 'The library is too large (18 MB maximum).');
  let value;
  try { value = JSON.parse(payload); }
  catch (cause) { throw new LibraryError('This library backup is not valid JSON.', 'invalid-json', cause); }
  return validateLibrary(value);
}
function readLibrary(storage) {
  const resolved = storageFor(storage);
  let payload;
  try { payload = resolved.getItem(LIBRARY_KEY); }
  catch (cause) { throw new LibraryError('The saved library cannot be read because browser storage is unavailable. Export your open design as JSON to keep a copy.', 'storage-unavailable', cause); }
  if (payload === null) return emptyLibrary();
  try { return parseLibrary(payload); }
  catch (cause) { throw new LibraryError(`Your saved library could not be loaded. Its stored data has been kept. ${cause.message}`, 'invalid-stored-library', cause); }
}
function writeLibrary(library, storage) {
  const valid = validateLibrary(library);
  const payload = JSON.stringify(valid, null, 2);
  try { writeWithMigrationBackup(storageFor(storage), LIBRARY_KEY, payload, 'library'); }
  catch (cause) { throw new LibraryError('The library could not be saved because browser storage is full or unavailable. Your previous saved library is unchanged. Export your open design as JSON to keep a copy.', 'storage-write-failed', cause); }
  return valid;
}
function metadata(library) {
  return library.designs.map(({ id, name, updatedAt }) => ({ id, name, updatedAt })).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
}
function findDesign(library, identifier) {
  designId(identifier);
  const record = library.designs.find(item => item.id === identifier);
  require(record, 'Saved design not found. Refresh your library and try again.');
  return record;
}
function uniqueId(library) {
  let identifier;
  do { identifier = createId(); } while (library.designs.some(item => item.id === identifier));
  return identifier;
}

export function listDesigns(storage) { return metadata(readLibrary(storage)); }

export function saveDesign(document, options = {}, storage) {
  options = checkedOptions(options, ['id', 'name'], 'Save options');
  const valid = validDocument(document), library = readLibrary(storage);
  const existing = options.id === undefined ? null : findDesign(library, options.id);
  const name = designName(options.name ?? (valid.title.replace(/\s+/g, ' ').trim() || 'Untitled design'));
  const record = { id: existing?.id ?? uniqueId(library), name, updatedAt: new Date().toISOString(), document: valid };
  if (existing) library.designs[library.designs.indexOf(existing)] = record;
  else library.designs.push(record);
  writeLibrary(library, storage);
  return clone(record);
}

export function loadDesign(identifier, storage) { return clone(findDesign(readLibrary(storage), identifier).document); }

export function duplicateDesign(identifier, storage) {
  const library = readLibrary(storage), source = findDesign(library, identifier);
  const name = `${source.name.slice(0, 145)} copy`;
  const record = { id: uniqueId(library), name, updatedAt: new Date().toISOString(), document: { ...clone(source.document), title: name } };
  library.designs.push(record);
  writeLibrary(library, storage);
  return clone(record);
}

export function deleteDesign(identifier, storage) {
  const library = readLibrary(storage), record = findDesign(library, identifier);
  library.designs.splice(library.designs.indexOf(record), 1);
  writeLibrary(library, storage);
  return true;
}

export function exportLibrary(storage) { return JSON.stringify(readLibrary(storage), null, 2); }

function canonicalJSON(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJSON).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJSON(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}

/** Merge skips exact records but rejects ID conflicts; replacement is explicit. */
export function importLibrary(payload, options = {}, storage) {
  options = checkedOptions(options, ['mode'], 'Import options');
  const mode = options.mode ?? 'merge';
  require(['merge', 'replace'].includes(mode), 'Import mode must be merge or replace.');
  const imported = parseLibrary(payload);
  const library = mode === 'replace' ? emptyLibrary() : readLibrary(storage);
  let added = 0, skipped = 0;
  for (const record of imported.designs) {
    const existing = library.designs.find(item => item.id === record.id);
    if (existing) {
      require(canonicalJSON(existing) === canonicalJSON(record), `A different saved design already uses ID ${record.id}. Export your existing library first, then choose replacement to restore this backup.`);
      skipped++;
    } else { library.designs.push(record); added++; }
  }
  if (mode === 'replace' || added) writeLibrary(library, storage);
  return { imported: added, skipped, total: library.designs.length };
}
