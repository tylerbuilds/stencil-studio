/** Named local designs. A failed validation or storage write never replaces a library. */
import { VERSION as DOCUMENT_VERSION, id as createId, validateDocument } from './model.js';
import { StorageConflictError, preserveMigrationSource, writeWithMigrationBackup } from './migration-storage.js';

export const LIBRARY_KEY = 'stencil-studio.library.v1';
export const LIBRARY_SCHEMA = 'stencil-studio-library';
export const LIBRARY_VERSION = 2;
export const MAX_DESIGNS = 100;
export const MAX_FOLDERS = 50;
export const MAX_DESIGN_VERSIONS = 5;
export const MAX_TAGS = 12;
export const MAX_LIBRARY_BYTES = 18 * 1024 * 1024;
const encoder = new TextEncoder();
const clone = value => structuredClone(value);
const emptyLibrary = () => ({ schema: LIBRARY_SCHEMA, version: LIBRARY_VERSION, designs: [], folders: [], trash: [] });
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
  return retainedName ? value : value.trim();
}
function validTimestamp(value, label = 'Saved design date') {
  require(typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value, `${label} must be a valid UTC timestamp.`);
  return value;
}
function folderName(value) {
  require(typeof value === 'string' && value.trim().length > 0 && value.length <= 80 && !hiddenControls.test(value), 'Use 1 to 80 characters for the folder name, without hidden control characters.');
  return value.trim();
}
function validTags(value) {
  require(Array.isArray(value) && value.length <= MAX_TAGS, `Use up to ${MAX_TAGS} tags per design.`);
  const seen = new Set();
  return value.map(tag => {
    require(typeof tag === 'string' && tag.trim().length > 0 && tag.length <= 40 && !hiddenControls.test(tag), 'Use 1 to 40 characters for each tag, without hidden control characters.');
    const clean = tag.trim(), folded = clean.toLocaleLowerCase('en-GB');
    require(!seen.has(folded), 'Use each tag only once.'); seen.add(folded); return clean;
  });
}
function validDocument(document) {
  checkJSON(document);
  try { return validateDocument(document); }
  catch (cause) { throw new LibraryError(`This design could not be saved: ${cause.message}`, 'invalid-document', cause); }
}
function validateLibrary(value) {
  checkJSON(value);
  const legacy = value?.version === 1;
  ownKeys(value, legacy ? ['schema', 'version', 'designs'] : ['schema', 'version', 'designs', 'folders', 'trash'], 'Library');
  require(value.schema === LIBRARY_SCHEMA && [1, LIBRARY_VERSION].includes(value.version), 'This backup format or version is not supported. Open a Stencil Studio v1 or v2 library backup.');
  const folders = legacy || !Object.hasOwn(value, 'folders') ? [] : value.folders, trash = legacy || !Object.hasOwn(value, 'trash') ? [] : value.trash;
  require(Array.isArray(value.designs) && Array.isArray(trash) && value.designs.length + trash.length <= MAX_DESIGNS, `Keep up to ${MAX_DESIGNS} saved designs, including Trash. Export a backup, then permanently delete a design from Trash to make room.`);
  require(Array.isArray(folders) && folders.length <= MAX_FOLDERS, `Keep up to ${MAX_FOLDERS} folders.`);
  const ids = new Set();
  const takeId = identifier => { identifier = designId(identifier); require(!ids.has(identifier), 'The library contains duplicate design IDs or folder/version identifiers.'); ids.add(identifier); return identifier; };
  const validFolders = folders.map(folder => { ownKeys(folder, ['id', 'name', 'updatedAt'], 'Folder'); return { id: takeId(folder.id), name: folderName(folder.name), updatedAt: validTimestamp(folder.updatedAt, 'Folder date') }; });
  const folderIds = new Set(validFolders.map(folder => folder.id));
  function record(item, deleted = false) {
    ownKeys(item, legacy ? ['id', 'name', 'updatedAt', 'document'] : ['id', 'name', 'updatedAt', 'document', 'folderId', 'tags', 'favourite', 'versions', ...(deleted ? ['deletedAt'] : [])], 'Saved design');
    const identifier = takeId(item.id), updatedAt = validTimestamp(item.updatedAt);
    const folderId = legacy ? null : item.folderId ?? null;
    require(folderId === null || (typeof folderId === 'string' && folderIds.has(folderId)), 'A saved design refers to a missing folder.');
    const favourite = legacy || !Object.hasOwn(item, 'favourite') ? false : item.favourite;
    require(typeof favourite === 'boolean', 'Favourite must be true or false.');
    const versions = legacy || !Object.hasOwn(item, 'versions') ? [] : item.versions;
    require(Array.isArray(versions) && versions.length <= MAX_DESIGN_VERSIONS, `Keep the last ${MAX_DESIGN_VERSIONS} saved versions per design.`);
    let previousSavedAt = '';
    const validVersions = versions.map(version => {
      ownKeys(version, ['id', 'name', 'savedAt', 'document'], 'Saved version');
      const savedAt = validTimestamp(version.savedAt, 'Saved version date');
      require(savedAt > previousSavedAt && savedAt < updatedAt, 'Saved versions must have distinct dates, oldest first, before the current design.');
      previousSavedAt = savedAt;
      return { id: takeId(version.id), name: designName(version.name, true), savedAt, document: validDocument(version.document) };
    });
    const result = { id: identifier, name: designName(item.name, true), updatedAt, document: validDocument(item.document), folderId, tags: legacy || !Object.hasOwn(item, 'tags') ? [] : validTags(item.tags), favourite, versions: validVersions };
    if (deleted) { result.deletedAt = validTimestamp(item.deletedAt, 'Deleted design date'); require(result.deletedAt <= updatedAt, 'Deleted design date cannot be after its last update.'); }
    return result;
  }
  const library = { schema: LIBRARY_SCHEMA, version: LIBRARY_VERSION, designs: value.designs.map(item => record(item)), folders: validFolders, trash: trash.map(item => record(item, true)) };
  require(byteLength(JSON.stringify(library, null, 2)) <= MAX_LIBRARY_BYTES, 'Your saved designs are too large (18 MB maximum). Export a backup, then clear saved versions or permanently delete designs from Trash to make room.');
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
  try {
    const resolved = storageFor(storage), original = snapshots.get(library);
    if (resolved.getItem(LIBRARY_KEY) !== original) throw new StorageConflictError();
    // Pure library-format upgrades also need an exact recovery copy, even when
    // the embedded documents are already the latest model version.
    let earlier; try { earlier = JSON.parse(original); } catch { /* Explicit replacement can recover corrupt storage. */ }
    const earlierDocument = document => document?.schema === 'stencil-studio' && Number.isInteger(document.version) && document.version >= 1 && document.version < DOCUMENT_VERSION;
    const earlierRecords = earlier?.schema === LIBRARY_SCHEMA ? [...(Array.isArray(earlier.designs) ? earlier.designs : []), ...(Array.isArray(earlier.trash) ? earlier.trash : [])] : [];
    if (earlier?.schema === LIBRARY_SCHEMA && (earlier.version === 1 || earlierRecords.some(record => earlierDocument(record.document) || (Array.isArray(record.versions) && record.versions.some(version => earlierDocument(version.document)))))) preserveMigrationSource(resolved, LIBRARY_KEY, original);
    writeWithMigrationBackup(resolved, LIBRARY_KEY, payload, 'library', { expectedRaw: original });
  }
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
  const used = new Set([...library.folders, ...library.designs, ...library.trash, ...[...library.designs, ...library.trash].flatMap(record => record.versions)].map(item => item.id));
  for (let attempt = 0; attempt < 64; attempt++) { const identifier = createId(); if (!used.has(identifier)) return identifier; }
  throw new LibraryError('A unique design ID could not be created. Your saved designs are unchanged. Try again.', 'id-unavailable');
}
function recordSummary(record) {
  return { id: record.id, name: record.name, updatedAt: record.updatedAt, folderId: record.folderId, tags: clone(record.tags), favourite: record.favourite, versionCount: record.versions.length, versions: record.versions.map(versionSummary), pageCount: record.document.pages.length, firstPage: clone(record.document.pages[0]), ...(record.deletedAt ? { deletedAt: record.deletedAt } : {}) };
}
function versionSummary(version) {
  return { id: version.id, name: version.name, savedAt: version.savedAt, pageCount: version.document.pages.length, documentVersion: version.document.version };
}
function retainVersion(library, record) {
  record.versions.push({ id: uniqueId(library), name: record.name, savedAt: record.updatedAt, document: clone(record.document) });
  // Fixed advertised retention, never an attempt to make an oversized write fit.
  if (record.versions.length > MAX_DESIGN_VERSIONS) record.versions.shift();
}
function findFolder(library, identifier) {
  designId(identifier); const folder = library.folders.find(item => item.id === identifier);
  require(folder, 'Folder not found. Refresh My designs and try again.'); return folder;
}
function findTrashed(library, identifier) {
  designId(identifier); const record = library.trash.find(item => item.id === identifier);
  require(record, 'Deleted design not found. Refresh Trash and try again.'); return record;
}
function mutationOptions(options, label) { return checkedOptions(options, ['expectedUpdatedAt'], label); }
function applyDesignMetadata(library, record, patch) {
  if (Object.hasOwn(patch, 'folderId')) { require(patch.folderId === null || typeof patch.folderId === 'string', 'Choose a folder or leave this design unfiled.'); if (patch.folderId !== null) findFolder(library, patch.folderId); record.folderId = patch.folderId; }
  if (Object.hasOwn(patch, 'tags')) record.tags = validTags(patch.tags);
  if (Object.hasOwn(patch, 'favourite')) { require(typeof patch.favourite === 'boolean', 'Favourite must be true or false.'); record.favourite = patch.favourite; }
}

export function listDesigns(storage) { return metadata(readLibrary(storage)); }
export function listDesignSummaries(storage) {
  const library = readLibrary(storage);
  return metadata(library).map(record => recordSummary(findDesign(library, record.id)));
}
export function renameDesign(identifier, name, storage, options = {}) {
  options = checkedOptions(options, ['expectedUpdatedAt'], 'Rename options');
  const library = readLibrary(storage), record = findDesign(library, identifier);
  checkExpectedTimestamp(options, record);
  const nextName = designName(name, typeof name === 'string' && name.trim() === record.name);
  if (nextName !== record.name || record.document.title !== nextName) retainVersion(library, record);
  record.name = nextName; record.document.title = record.name; record.updatedAt = timestamp(record.updatedAt);
  writeLibrary(library, storage); return clone(record);
}

export function saveDesign(document, options = {}, storage) {
  options = checkedOptions(options, ['id', 'name', 'expectedUpdatedAt', 'folderId', 'tags', 'favourite'], 'Save options');
  const valid = validDocument(document), library = readLibrary(storage);
  const existing = options.id === undefined ? null : findDesign(library, options.id);
  checkExpectedTimestamp(options, existing);
  const proposedName = options.name ?? (valid.title.replace(/\s+/g, ' ').trim() || 'Untitled design');
  const name = designName(proposedName, Boolean(existing && typeof proposedName === 'string' && proposedName.trim() === existing.name));
  if (existing && (name !== existing.name || canonicalJSON(valid) !== canonicalJSON(existing.document))) retainVersion(library, existing);
  const record = { id: existing?.id ?? uniqueId(library), name, updatedAt: timestamp(existing?.updatedAt), document: valid, folderId: existing?.folderId ?? null, tags: existing?.tags ?? [], favourite: existing?.favourite ?? false, versions: existing?.versions ?? [] };
  applyDesignMetadata(library, record, options);
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
  const record = { id: uniqueId(library), name, updatedAt: timestamp(), document: { ...clone(source.document), title: name }, folderId: source.folderId, tags: clone(source.tags), favourite: source.favourite, versions: [] };
  library.designs.push(record);
  writeLibrary(library, storage);
  return clone(record);
}

export function deleteDesign(identifier, storage, options = {}) {
  options = checkedOptions(options, ['expectedUpdatedAt'], 'Delete options');
  const library = readLibrary(storage), record = findDesign(library, identifier);
  checkExpectedTimestamp(options, record);
  library.designs.splice(library.designs.indexOf(record), 1);
  record.updatedAt = timestamp(record.updatedAt); record.deletedAt = record.updatedAt; library.trash.push(record);
  writeLibrary(library, storage);
  return true;
}

export function listFolders(storage) {
  const library = readLibrary(storage);
  return library.folders.map(folder => ({ ...folder, designCount: library.designs.filter(record => record.folderId === folder.id).length })).sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
}
export function createFolder(name, storage) {
  const library = readLibrary(storage), folder = { id: uniqueId(library), name: folderName(name), updatedAt: timestamp() };
  library.folders.push(folder); writeLibrary(library, storage); return clone(folder);
}
export function renameFolder(identifier, name, storage, options = {}) {
  options = mutationOptions(options, 'Rename folder options');
  const library = readLibrary(storage), folder = findFolder(library, identifier); checkExpectedTimestamp(options, folder);
  folder.name = folderName(name); folder.updatedAt = timestamp(folder.updatedAt); writeLibrary(library, storage); return clone(folder);
}
export function deleteFolder(identifier, storage, options = {}) {
  options = mutationOptions(options, 'Delete folder options');
  const library = readLibrary(storage), folder = findFolder(library, identifier); checkExpectedTimestamp(options, folder);
  library.folders.splice(library.folders.indexOf(folder), 1);
  for (const record of [...library.designs, ...library.trash]) if (record.folderId === identifier) {
    record.folderId = null; record.updatedAt = timestamp(record.updatedAt);
  }
  writeLibrary(library, storage); return true;
}
export function updateDesignMetadata(identifier, patch, storage, options = {}) {
  options = mutationOptions(options, 'Design details options'); patch = checkedOptions(patch, ['folderId', 'tags', 'favourite'], 'Design details');
  const library = readLibrary(storage), record = findDesign(library, identifier); checkExpectedTimestamp(options, record);
  applyDesignMetadata(library, record, patch);
  record.updatedAt = timestamp(record.updatedAt); writeLibrary(library, storage); return clone(record);
}
export function listTrash(storage) {
  return readLibrary(storage).trash.map(recordSummary).sort((a, b) => b.deletedAt.localeCompare(a.deletedAt) || a.id.localeCompare(b.id));
}
export function restoreDesign(identifier, storage, options = {}) {
  options = mutationOptions(options, 'Restore options');
  const library = readLibrary(storage), record = findTrashed(library, identifier); checkExpectedTimestamp(options, record);
  library.trash.splice(library.trash.indexOf(record), 1); delete record.deletedAt; record.updatedAt = timestamp(record.updatedAt); library.designs.push(record);
  writeLibrary(library, storage); return clone(record);
}
export function permanentlyDeleteDesign(identifier, storage, options = {}) {
  options = mutationOptions(options, 'Permanent delete options');
  const library = readLibrary(storage), record = findTrashed(library, identifier); checkExpectedTimestamp(options, record);
  library.trash.splice(library.trash.indexOf(record), 1); writeLibrary(library, storage); return true;
}
export function emptyTrash(storage) {
  const library = readLibrary(storage); const removed = library.trash.length;
  if (removed) { library.trash = []; writeLibrary(library, storage); } return removed;
}
export function listDesignVersions(identifier, storage) {
  return findDesign(readLibrary(storage), identifier).versions.map(versionSummary).reverse();
}
export function restoreDesignVersion(identifier, versionIdentifier, storage, options = {}) {
  options = mutationOptions(options, 'Restore version options');
  const library = readLibrary(storage), record = findDesign(library, identifier); checkExpectedTimestamp(options, record); designId(versionIdentifier);
  const version = record.versions.find(item => item.id === versionIdentifier); require(version, 'Saved version not found. Refresh versions and try again.');
  const document = clone(version.document), name = version.name;
  retainVersion(library, record); record.document = document; record.name = name; record.updatedAt = timestamp(record.updatedAt);
  writeLibrary(library, storage); return clone(record);
}
export function clearDesignVersions(identifier, storage, options = {}) {
  options = mutationOptions(options, 'Clear version options');
  const library = readLibrary(storage), record = findDesign(library, identifier); checkExpectedTimestamp(options, record);
  record.versions = []; record.updatedAt = timestamp(record.updatedAt); writeLibrary(library, storage); return clone(record);
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
  let added = 0, skipped = 0, changed = false;
  for (const folder of imported.folders) {
    const existing = library.folders.find(item => item.id === folder.id);
    if (existing) require(canonicalJSON(existing) === canonicalJSON(folder), `A different folder already uses ID ${folder.id}. Export your existing library first, then choose replacement to restore this backup.`);
    else { library.folders.push(folder); changed = true; }
  }
  for (const record of imported.designs) {
    const existing = [...library.designs, ...library.trash].find(item => item.id === record.id);
    if (existing) {
      require(canonicalJSON(existing) === canonicalJSON(record), `A different saved design already uses ID ${record.id}. Export your existing library first, then choose replacement to restore this backup.`);
      skipped++;
    } else { library.designs.push(record); added++; changed = true; }
  }
  for (const record of imported.trash) {
    const existing = [...library.designs, ...library.trash].find(item => item.id === record.id);
    if (existing) require(canonicalJSON(existing) === canonicalJSON(record), `A different saved design already uses ID ${record.id}. Export your existing library first, then choose replacement to restore this backup.`);
    else { library.trash.push(record); changed = true; }
  }
  if (mode === 'replace' || changed) writeLibrary(library, storage);
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
