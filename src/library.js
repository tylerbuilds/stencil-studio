/** Named local designs. A failed validation or storage write never replaces a library. */
import { id as createId, validateDocument } from './model.js';
import { StorageConflictError, writeWithMigrationBackup } from './migration-storage.js';

export const LIBRARY_KEY = 'stencil-studio.library.v1';
export const LIBRARY_SCHEMA = 'stencil-studio-library';
export const LIBRARY_VERSION = 1;
export const MAX_DESIGNS = 20;
export const MAX_LIBRARY_BYTES = 18 * 1024 * 1024;
const encoder = new TextEncoder();
const clone = value => structuredClone(value);
const emptyLibrary = () => ({ schema: LIBRARY_SCHEMA, version: LIBRARY_VERSION, designs: [] });
const snapshots = new WeakMap();
const hiddenControls = /[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/;
function timestamp(previous) {
  const value = Math.max(Date.now(), previous ? Date.parse(previous) + 1 : 0);
  require(Number.isFinite(value) && value <= 253402300799999, 'The device clock cannot create a valid saved-design timestamp.');
  return new Date(value).toISOString();
}
function checkExpectedTimestamp(options, existing) {
  if (options.expectedUpdatedAt === undefined) return;
  require(existing && typeof options.expectedUpdatedAt === 'string' && Number.isFinite(Date.parse(options.expectedUpdatedAt)), 'Choose an existing design and its saved timestamp before updating it.');
  if (existing.updatedAt !== options.expectedUpdatedAt) throw new LibraryError('This design was changed in another tab. Your local edits are still open. Save a copy or reopen the newer design.', 'design-conflict');
}

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
      require(item.length <= MAX_LIBRARY_BYTES, "This backup is too large. Use a file up to 18 MB.");
      bytes += byteLength(item);
      require(bytes <= MAX_LIBRARY_BYTES, "This backup is too large. Use a file up to 18 MB.");
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
function designName(value, retainedName = false) {
  const controls = retainedName ? /[\u0000-\u001f\u007f]/ : hiddenControls;
  require(typeof value === 'string' && value.trim().length > 0 && value.length <= 150 && !controls.test(value), "Use 1 to 150 characters for the design name, without hidden control characters.");
  return value.trim();
}
function validDocument(document) {
  checkJSON(document);
  try { return validateDocument(document); }
  catch (cause) { throw new LibraryError(`This design could not be saved: ${cause.message}`, 'invalid-document', cause); }
}
function validateLibrary(value) {
  checkJSON(value);
  ownKeys(value, ['schema', 'version', 'designs'], 'Library');
  require(value.schema === LIBRARY_SCHEMA && value.version === LIBRARY_VERSION, "This backup format or version is not supported. Open a Stencil Studio v1 library backup.");
  require(Array.isArray(value.designs) && value.designs.length <= MAX_DESIGNS, `Keep up to ${MAX_DESIGNS} saved designs. Export a backup, then remove a design to make room.`);
  const ids = new Set();
  const designs = value.designs.map(item => {
    ownKeys(item, ['id', 'name', 'updatedAt', 'document'], 'Saved design');
    const identifier = designId(item.id);
    require(!ids.has(identifier), 'The library contains duplicate design IDs.');
    ids.add(identifier);
    require(typeof item.updatedAt === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(item.updatedAt) && Number.isFinite(Date.parse(item.updatedAt)) && new Date(item.updatedAt).toISOString() === item.updatedAt, 'Saved design date must be a valid UTC timestamp.');
    return { id: identifier, name: designName(item.name, true), updatedAt: item.updatedAt, document: validDocument(item.document) };
  });
  const library = { schema: LIBRARY_SCHEMA, version: LIBRARY_VERSION, designs };
  require(byteLength(JSON.stringify(library, null, 2)) <= MAX_LIBRARY_BYTES, "Your saved designs are too large (18 MB maximum). Export a backup, then remove a design to make room.");
  return library;
}
function parseLibrary(payload) {
  if (typeof payload !== 'string') return validateLibrary(payload);
  require(payload.length <= MAX_LIBRARY_BYTES && byteLength(payload) <= MAX_LIBRARY_BYTES, "This backup is too large. Use a file up to 18 MB.");
  let value;
  try { value = JSON.parse(payload); }
  catch (cause) { throw new LibraryError('This library backup is not valid JSON.', 'invalid-json', cause); }
  return validateLibrary(value);
}
function readLibrary(storage) {
  const resolved = storageFor(storage);
  let payload;
  try { payload = resolved.getItem(LIBRARY_KEY); }
  catch (cause) { throw new LibraryError("Your saved designs cannot be opened because browser storage is unavailable. Export your open design as JSON to keep a copy.", 'storage-unavailable', cause); }
  if (payload === null) { const library = emptyLibrary(); snapshots.set(library, null); return library; }
  try { const library = parseLibrary(payload); snapshots.set(library, payload); return library; }
  catch (cause) { throw new LibraryError(`Your saved designs could not be opened. Their stored data has been kept. ${cause.message}`, 'invalid-stored-library', cause); }
}
function writeLibrary(library, storage) {
  const valid = validateLibrary(library);
  const payload = JSON.stringify(valid, null, 2);
  try { writeWithMigrationBackup(storageFor(storage), LIBRARY_KEY, payload, 'library', { expectedRaw: snapshots.get(library) }); }
  catch (cause) { if (cause instanceof StorageConflictError) throw new LibraryError('Your saved designs changed in another tab. Your local edits are still open. Refresh My designs and try again.', 'library-conflict', cause); throw new LibraryError("Your designs could not be saved because browser storage is full or unavailable. Your previously saved designs are unchanged. Export your open design as JSON to keep a copy.", 'storage-write-failed', cause); }
  return valid;
}
function metadata(library) {
  return library.designs.map(({ id, name, updatedAt }) => ({ id, name, updatedAt })).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
}
function findDesign(library, identifier) {
  designId(identifier);
  const record = library.designs.find(item => item.id === identifier);
  require(record, "Saved design not found. Refresh My designs and try again.");
  return record;
}
function uniqueId(library) {
  for (let attempt = 0; attempt < 64; attempt++) { const identifier = createId(); if (!library.designs.some(item => item.id === identifier)) return identifier; }
  throw new LibraryError('A unique design ID could not be created. Your saved designs are unchanged. Try again.', 'id-unavailable');
}

export function listDesigns(storage) { return metadata(readLibrary(storage)); }
export function listDesignSummaries(storage) {
  const library = readLibrary(storage);
  return metadata(library).map(record => { const document = findDesign(library, record.id).document; return { ...record, pageCount: document.pages.length, firstPage: clone(document.pages[0]) }; });
}
export function renameDesign(identifier, name, storage, options = {}) {
  options = checkedOptions(options, ['expectedUpdatedAt'], 'Rename options');
  const library = readLibrary(storage), record = findDesign(library, identifier);
  checkExpectedTimestamp(options, record);
  record.name = designName(name, typeof name === 'string' && name.trim() === record.name); record.document.title = record.name; record.updatedAt = timestamp(record.updatedAt);
  writeLibrary(library, storage); return clone(record);
}

export function saveDesign(document, options = {}, storage) {
  options = checkedOptions(options, ['id', 'name', 'expectedUpdatedAt'], 'Save options');
  const valid = validDocument(document), library = readLibrary(storage);
  const existing = options.id === undefined ? null : findDesign(library, options.id);
  checkExpectedTimestamp(options, existing);
  const proposedName = options.name ?? (valid.title.replace(/\s+/g, ' ').trim() || 'Untitled design');
  const name = designName(proposedName, Boolean(existing && typeof proposedName === 'string' && proposedName.trim() === existing.name));
  const record = { id: existing?.id ?? uniqueId(library), name, updatedAt: timestamp(existing?.updatedAt), document: valid };
  if (existing) library.designs[library.designs.indexOf(existing)] = record;
  else library.designs.push(record);
  writeLibrary(library, storage);
  return clone(record);
}

export function loadDesign(identifier, storage) { return clone(findDesign(readLibrary(storage), identifier).document); }

export function duplicateDesign(identifier, storage, options = {}) {
  options = checkedOptions(options, ['expectedUpdatedAt'], 'Duplicate options');
  const library = readLibrary(storage), source = findDesign(library, identifier);
  checkExpectedTimestamp(options, source);
  const name = `${source.name.slice(0, 145)} copy`;
  const record = { id: uniqueId(library), name, updatedAt: timestamp(), document: { ...clone(source.document), title: name } };
  library.designs.push(record);
  writeLibrary(library, storage);
  return clone(record);
}

export function deleteDesign(identifier, storage, options = {}) {
  options = checkedOptions(options, ['expectedUpdatedAt'], 'Delete options');
  const library = readLibrary(storage), record = findDesign(library, identifier);
  checkExpectedTimestamp(options, record);
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
  require(['merge', 'replace'].includes(mode), "Choose whether to add this backup to your saved designs or replace them.");
  const imported = parseLibrary(payload);
  const library = mode === 'replace' ? emptyLibrary() : readLibrary(storage);
  if (mode === 'replace') { let raw; try { raw = storageFor(storage).getItem(LIBRARY_KEY); } catch (cause) { throw new LibraryError('Browser storage is unavailable. Your saved designs are unchanged.', 'storage-unavailable', cause); } snapshots.set(library, raw); }
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

/** Serialise cooperating browser tabs. The fallback detects drift but cannot provide cross-tab atomicity. */
let localMutationQueue = Promise.resolve();
export async function withLibraryLock(operation, { locks = globalThis.navigator?.locks, signal } = {}) {
  require(typeof operation === 'function', 'A saved-design operation is required.');
  const boundedSignal = signal ? AbortSignal.any([signal, AbortSignal.timeout(5000)]) : AbortSignal.timeout(5000);
  const run = () => { if (boundedSignal.aborted) throw new LibraryError('Saved designs are busy in another tab. Your work is still open. Try again.', 'library-busy'); return operation(); };
  try {
    if (typeof locks?.request === 'function') return await locks.request(LIBRARY_KEY, { mode: 'exclusive', signal: boundedSignal }, run);
    const next = localMutationQueue.then(run, run); localMutationQueue = next.catch(() => {}); return await next;
  } catch (cause) {
    if (boundedSignal.aborted) throw new LibraryError('Saved designs are busy in another tab. Your work is still open. Try again.', 'library-busy', cause);
    throw cause;
  }
}
