/** Optional self-hosted capability-token document service. No dependencies. */
import { constants as fsConstants } from 'node:fs';
import { chmod, lstat, mkdir, open, readdir, realpath, rename, unlink } from 'node:fs/promises';
import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import path from 'node:path';

const PREFIX = '/api/workspaces';
const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const TOKEN = /^[A-Za-z0-9_-]{43}$/;
const HASH = /^[a-f0-9]{64}$/;
const KINDS = new Set(['clearcv', 'stencil-studio']);
const MAX_DOCUMENT = 12 * 1024 * 1024;
const MAX_HISTORY_BYTES = 24 * 1024 * 1024;
const MAX_RECORD = 40 * 1024 * 1024;
const MAX_STORAGE = 512 * 1024 * 1024;
const MAX_WORKSPACES = 100;
const MAX_COMMENTS = 300;
const MAX_HISTORY = 20;
const own = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
const bytes = value => Buffer.byteLength(JSON.stringify(value));
const tokenHash = value => createHash('sha256').update(value).digest('hex');
const newToken = () => randomBytes(32).toString('base64url');
const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);

class ApiError extends Error {
  constructor(status, code, message, extra = {}) { super(message); Object.assign(this, { status, code, extra }); }
}
const fail = (status, code, message, extra) => { throw new ApiError(status, code, message, extra); };

function validateDocument(document, kind, validators) {
  if (!isObject(document)) fail(400, 'invalid_document', 'A JSON document object is required.');
  let count = 0;
  const visit = (value, depth) => {
    if (depth > 32 || ++count > 100_000) fail(400, 'invalid_document', 'The document is too complex.');
    if (value === null || typeof value === 'boolean' || typeof value === 'string') return;
    if (typeof value === 'number' && Number.isFinite(value)) return;
    if (Array.isArray(value)) { for (const item of value) visit(item, depth + 1); return; }
    if (!isObject(value)) fail(400, 'invalid_document', 'Only JSON values are supported.');
    for (const [key, item] of Object.entries(value)) {
      if (key === '__proto__' || key === 'constructor' || key === 'prototype') fail(400, 'invalid_document', 'Unsafe document keys are not supported.');
      visit(item, depth + 1);
    }
  };
  visit(document, 0);
  if (bytes(document) > MAX_DOCUMENT) fail(413, 'document_too_large', 'Shared documents must be no larger than 12 MiB.');
  if (validators?.[kind]) {
    try {
      const result = validators[kind](document);
      if (result && typeof result.then === 'function') {
        // A mistakenly async validator cannot silently authorise a document.
        void Promise.resolve(result).catch(() => {});
        throw new TypeError('Document validators must be synchronous.');
      }
    }
    catch { fail(400, 'invalid_document', 'This document does not match the application format.'); }
  }
}

function validTitle(title) {
  if (typeof title !== 'string' || title.length > 160 || /[\u0000-\u001f\u007f]/.test(title)) fail(400, 'invalid_title', 'Use a document title of at most 160 characters.');
  return title;
}

function authorName(author) {
  if (author === undefined) return 'Collaborator';
  if (typeof author !== 'string' || author.trim().length < 1 || author.length > 80 || /[\u0000-\u001f\u007f]/.test(author)) fail(400, 'invalid_author', 'Use a display name of 1–80 characters.');
  return author.trim();
}

function validateRecord(record, expectedId, validators) {
  if (!isObject(record) || record.version !== 1 || record.id !== expectedId || !KINDS.has(record.kind)
    || !Number.isSafeInteger(record.revision) || record.revision < 1 || !Number.isSafeInteger(record.documentRevision)
    || record.documentRevision < 1 || record.documentRevision > record.revision
    || !Array.isArray(record.history) || record.history.length > MAX_HISTORY
    || !Array.isArray(record.comments) || record.comments.length > MAX_COMMENTS
    || !isObject(record.tokenHashes) || !HASH.test(record.tokenHashes.owner)
    || !['edit', 'view'].every(role => record.tokenHashes[role] === null || HASH.test(record.tokenHashes[role]))) {
    fail(503, 'storage_unavailable', 'The document store needs operator attention.');
  }
  const date = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) && Number.isFinite(Date.parse(value));
  if (![record.createdAt, record.updatedAt, record.documentUpdatedAt].every(date)) fail(503, 'storage_unavailable', 'The document store needs operator attention.');
  try {
    validTitle(record.title);
    validateDocument(record.document, record.kind, validators);
    let previous = 0;
    for (const item of record.history) {
      if (!isObject(item) || !Number.isSafeInteger(item.revision) || item.revision <= previous || item.revision >= record.documentRevision || !date(item.createdAt)) throw new Error();
      previous = item.revision;
      validTitle(item.title);
      validateDocument(item.document, record.kind, validators);
    }
    const commentIds = new Set();
    for (const item of record.comments) {
      if (!isObject(item) || !ID.test(item.id) || commentIds.has(item.id) || !date(item.createdAt) || typeof item.text !== 'string' || item.text.trim().length < 1 || item.text.length > 4000) throw new Error();
      commentIds.add(item.id);
      authorName(item.author);
    }
  } catch { fail(503, 'storage_unavailable', 'The document store needs operator attention.'); }
}

function snapshot(record) {
  return { id: record.id, kind: record.kind, title: record.title, document: record.document, revision: record.revision,
    createdAt: record.createdAt, updatedAt: record.updatedAt,
    permissions: { edit: record.tokenHashes.edit !== null, view: record.tokenHashes.view !== null } };
}

function identify(record, token) {
  if (typeof token !== 'string' || !TOKEN.test(token)) fail(404, 'not_found', 'Shared document unavailable.');
  const candidate = Buffer.from(tokenHash(token), 'hex');
  let result = null;
  for (const role of ['owner', 'edit', 'view']) {
    const hash = record.tokenHashes[role];
    if (hash && timingSafeEqual(candidate, Buffer.from(hash, 'hex'))) result = role;
  }
  if (!result) fail(404, 'not_found', 'Shared document unavailable.');
  return result;
}

function requireRevision(body, record) {
  if (!Number.isSafeInteger(body.baseRevision) || body.baseRevision < 1) fail(400, 'revision_required', 'Supply the current baseRevision.');
  if (body.baseRevision !== record.revision) fail(409, 'revision_conflict', 'The shared document changed. Load its current revision before saving.', { revision: record.revision, workspace: snapshot(record) });
}

function send(res, status, payload) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store',
    Pragma: 'no-cache', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'", 'Referrer-Policy': 'no-referrer' });
  res.end(JSON.stringify(payload));
}

function readBody(req) {
  if (!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type'] || '') || req.headers['content-encoding']) fail(415, 'json_required', 'Send an uncompressed application/json body.');
  const limit = MAX_DOCUMENT + 8192;
  if (req.headers['content-length'] && (!/^\d+$/.test(req.headers['content-length']) || Number(req.headers['content-length']) > limit)) {
    req.resume(); fail(413, 'body_too_large', 'The request body is too large.');
  }
  return new Promise((resolve, reject) => {
    let length = 0; const chunks = [];
    const cleanup = () => { clearTimeout(timeout); req.off('data', data); req.off('end', end); req.off('error', error); req.off('aborted', aborted); };
    const error = () => { cleanup(); reject(new ApiError(400, 'invalid_body', 'The request body could not be read.')); };
    const aborted = error;
    const data = chunk => {
      length += chunk.length;
      if (length > limit) { cleanup(); req.resume(); reject(new ApiError(413, 'body_too_large', 'The request body is too large.')); }
      else chunks.push(chunk);
    };
    const end = () => {
      cleanup();
      try { const body = JSON.parse(Buffer.concat(chunks).toString('utf8')); if (!isObject(body)) throw new Error(); resolve(body); }
      catch { reject(new ApiError(400, 'invalid_json', 'Send a valid JSON object.')); }
    };
    const timeout = setTimeout(() => { cleanup(); req.resume(); reject(new ApiError(408, 'body_timeout', 'The request body took too long.')); }, 15_000);
    timeout.unref();
    req.on('data', data); req.on('end', end); req.on('error', error); req.on('aborted', aborted);
  });
}

function originAllowed(req, configuredOrigin) {
  const origin = req.headers.origin;
  if (!origin) return true;
  if (typeof origin !== 'string' || origin === 'null') return false;
  if (configuredOrigin) return origin === configuredOrigin;
  // Without explicit configuration, support loopback HTTP development only.
  try {
    const target = new URL(`http://${req.headers.host}`);
    return ['localhost', '127.0.0.1', '[::1]'].includes(target.hostname) && target.origin === origin;
  } catch { return false; }
}

async function secureRead(filename) {
  let handle;
  try {
    handle = await open(filename, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
    const info = await handle.stat();
    if (!info.isFile() || info.nlink !== 1 || info.size > MAX_RECORD || (process.getuid && info.uid !== process.getuid())) fail(503, 'storage_unavailable', 'The document store needs operator attention.');
    return await handle.readFile('utf8');
  } finally { await handle?.close(); }
}

/**
 * Returns an async (req, res) => boolean handler with .close().
 * Disabled without dataDirectory. An enabled data directory has one service writer.
 * validators are optional synchronous application document validators by kind.
 */
export async function createWorkspaceHandler({ dataDirectory, allowedOrigin, validators = {} } = {}) {
  if (allowedOrigin) {
    let parsed;
    try { parsed = new URL(allowedOrigin); } catch { throw new TypeError('allowedOrigin must be an HTTP(S) origin.'); }
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.origin !== allowedOrigin) throw new TypeError('allowedOrigin must be an HTTP(S) origin without a path.');
  }
  if (!isObject(validators) || Object.values(validators).some(value => typeof value !== 'function' || value.constructor?.name === 'AsyncFunction')) throw new TypeError('validators must contain synchronous validator functions.');
  let directory; let lockHandle; let closed = false; let active = 0; let serial = Promise.resolve();
  if (dataDirectory !== undefined && dataDirectory !== null && dataDirectory !== '') {
    if (typeof dataDirectory !== 'string' || !path.isAbsolute(dataDirectory)) throw new TypeError('dataDirectory must be an absolute operator-selected path.');
    await mkdir(dataDirectory, { recursive: true, mode: 0o700 });
    const info = await lstat(dataDirectory);
    if (!info.isDirectory() || info.isSymbolicLink() || (process.getuid && info.uid !== process.getuid())) throw new Error('The workspace data directory must be a real directory owned by this user.');
    await chmod(dataDirectory, 0o700);
    directory = await realpath(dataDirectory);
    try {
      lockHandle = await open(path.join(directory, '.workspace-service.lock'), 'wx', 0o600);
      await lockHandle.writeFile(JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }));
      await lockHandle.sync();
    } catch (error) {
      await lockHandle?.close();
      throw new Error(error.code === 'EEXIST' ? 'This data directory is already locked. Stop its other service; after a crash, an operator must confirm the recorded PID is dead before removing .workspace-service.lock.' : 'The workspace data directory could not be locked.');
    }
  }

  const filename = id => path.join(directory, `${id}.json`);
  const load = async id => {
    try {
      const record = JSON.parse(await secureRead(filename(id)));
      validateRecord(record, id, validators);
      return record;
    } catch (error) {
      if (error.code === 'ENOENT') fail(404, 'not_found', 'Shared document unavailable.');
      if (error instanceof ApiError) throw error;
      fail(503, 'storage_unavailable', 'The document store needs operator attention.');
    }
  };
  const store = async record => {
    const data = JSON.stringify(record);
    if (Buffer.byteLength(data) > MAX_RECORD) fail(413, 'storage_limit', 'This shared document has reached its storage limit.');
    const names = await readdir(directory);
    let usage = 0; let workspaceCount = 0;
    for (const name of names) {
      const info = await lstat(path.join(directory, name));
      if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1) fail(503, 'storage_unavailable', 'The document store needs operator attention.');
      if (/\.json$/.test(name) && ID.test(name.slice(0, -5))) workspaceCount++;
      // Include crash-orphaned temporary writes and operator files in the quota.
      // Recovery material is never silently deleted to make space.
      if (name !== `${record.id}.json`) usage += info.size;
    }
    if (workspaceCount > MAX_WORKSPACES || (workspaceCount === MAX_WORKSPACES && !names.includes(`${record.id}.json`)) || usage + Buffer.byteLength(data) > MAX_STORAGE) fail(507, 'storage_limit', 'The workspace service has reached its storage limit.');
    const temporary = path.join(directory, `.${record.id}.${randomUUID()}.tmp`);
    let handle; let directoryHandle;
    try {
      handle = await open(temporary, 'wx', 0o600);
      await handle.writeFile(data);
      await handle.sync();
      await handle.close(); handle = null;
      await rename(temporary, filename(record.id));
      directoryHandle = await open(directory, fsConstants.O_RDONLY);
      await directoryHandle.sync();
    } finally {
      await handle?.close(); await directoryHandle?.close();
      await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; });
    }
  };
  const sequence = task => {
    const result = serial.then(task);
    serial = result.catch(() => {});
    return result;
  };

  const handler = async (req, res) => {
    let url;
    try { url = new URL(req.url, 'http://local.invalid'); } catch { return false; }
    if (url.pathname !== PREFIX && !url.pathname.startsWith(`${PREFIX}/`)) return false;
    try {
      if (closed) fail(503, 'service_closed', 'The workspace service is stopped.');
      if (!originAllowed(req, allowedOrigin)) fail(403, 'origin_rejected', 'This origin cannot access the workspace service.');
      if (req.method === 'GET' && url.pathname === `${PREFIX}/status`) {
        send(res, 200, { enabled: Boolean(directory), ...(directory ? { transport: 'polling', authentication: 'capability-tokens', maxDocumentBytes: MAX_DOCUMENT } : {}) }); return true;
      }
      if (!directory) fail(503, 'service_disabled', 'Shared workspaces are disabled. Start the self-hosted server with an explicit data directory.');
      if (active >= 32) fail(429, 'busy', 'The workspace service is busy. Try again shortly.');
      const parts = url.pathname.slice(PREFIX.length).split('/').filter(Boolean);
      if (parts.length > 2 || (parts[0] && !ID.test(parts[0])) || url.search) fail(404, 'not_found', 'Shared document unavailable.');
      const mutating = ['POST', 'PUT', 'DELETE', 'PATCH'].includes(req.method);
      if (mutating && (req.headers['x-workspace-client'] !== '1' || !req.headers.origin)) fail(403, 'write_guard', 'Workspace writes require the same-origin client header and Origin.');
      active++;
      try {
        const body = mutating ? await readBody(req) : null;
        const result = await sequence(async () => {
          if (closed) fail(503, 'service_closed', 'The workspace service is stopped.');
          if (parts.length === 0) {
            if (req.method !== 'POST') fail(405, 'method_not_allowed', 'Use POST to create a shared workspace.');
            if (!KINDS.has(body.kind)) fail(400, 'invalid_kind', 'Choose clearcv or stencil-studio.');
            validateDocument(body.document, body.kind, validators);
            const title = validTitle(body.title ?? 'Untitled');
            const tokens = { owner: newToken(), edit: newToken(), view: newToken() };
            const timestamp = new Date().toISOString();
            const record = { version: 1, id: randomUUID(), kind: body.kind, title, document: body.document, revision: 1,
              documentRevision: 1, createdAt: timestamp, updatedAt: timestamp, documentUpdatedAt: timestamp,
              tokenHashes: Object.fromEntries(Object.entries(tokens).map(([role, token]) => [role, tokenHash(token)])), history: [], comments: [] };
            await store(record);
            return { status: 201, payload: { workspace: snapshot(record), role: 'owner', tokens } };
          }
          const record = await load(parts[0]);
          const role = identify(record, req.headers['x-workspace-token']);
          const route = parts[1];
          if (!route && req.method === 'GET') return { payload: { workspace: snapshot(record), role } };
          if (route === 'comments' && req.method === 'GET') return { payload: { revision: record.revision, comments: record.comments } };
          if (route === 'revisions' && req.method === 'GET') {
            if (role === 'view') fail(403, 'permission_denied', 'Revision history requires edit permission.');
            return { payload: { revision: record.revision, revisions: [...record.history, { revision: record.documentRevision, title: record.title, document: record.document, createdAt: record.documentUpdatedAt }] } };
          }
          if ((!route && req.method === 'PUT') || (route === 'comments' && req.method === 'POST') || (route === 'permissions' && req.method === 'POST')) {
            if (role === 'view' || (route === 'permissions' && role !== 'owner')) fail(403, 'permission_denied', 'This operation requires a stronger sharing permission.');
            requireRevision(body, record);
            const timestamp = new Date().toISOString();
            const extra = {};
            if (!route) {
              validateDocument(body.document, record.kind, validators);
              const title = own(body, 'title') ? validTitle(body.title) : record.title;
              record.history.push({ revision: record.documentRevision, title: record.title, document: record.document, createdAt: record.documentUpdatedAt });
              while (record.history.length > MAX_HISTORY || bytes(record.history) > MAX_HISTORY_BYTES) record.history.shift();
              record.document = body.document; record.title = title;
              record.documentRevision = record.revision + 1; record.documentUpdatedAt = timestamp;
            } else if (route === 'comments') {
              if (record.comments.length >= MAX_COMMENTS) fail(413, 'comment_limit', 'This document has reached its comment limit.');
              if (typeof body.text !== 'string' || body.text.trim().length < 1 || body.text.length > 4000 || /\u0000/.test(body.text)) fail(400, 'invalid_comment', 'Use a comment of 1–4000 characters.');
              const comment = { id: randomUUID(), text: body.text.trim(), author: authorName(body.author), createdAt: timestamp };
              record.comments.push(comment); extra.comment = comment;
            } else {
              if (!['edit', 'view'].includes(body.role) || typeof body.enabled !== 'boolean') fail(400, 'invalid_permission', 'Choose an edit or view permission and an enabled boolean.');
              const token = body.enabled ? newToken() : null;
              record.tokenHashes[body.role] = token ? tokenHash(token) : null;
              extra.share = { role: body.role, token };
            }
            record.revision++; record.updatedAt = timestamp;
            await store(record);
            return { payload: { workspace: snapshot(record), role, ...extra } };
          }
          fail(405, 'method_not_allowed', 'This workspace operation is not supported.');
        });
        send(res, result.status || 200, result.payload);
      } finally { active--; }
    } catch (error) {
      if (!res.headersSent && !res.destroyed) {
        if (error instanceof ApiError) send(res, error.status, { error: { code: error.code, message: error.message }, ...error.extra });
        else send(res, 503, { error: { code: 'storage_unavailable', message: 'The workspace service could not complete this operation.' } });
      }
    }
    return true;
  };
  handler.close = async () => {
    if (closed) return;
    closed = true;
    await serial;
    if (lockHandle) {
      await lockHandle.close(); lockHandle = null;
      await unlink(path.join(directory, '.workspace-service.lock'));
    }
  };
  return handler;
}
