import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, open, readdir, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { createWorkspaceHandler } from '../scripts/workspace-backend.mjs';
import { CloudError, createCloudClient, readShareLink, shareLink } from '../src/cloud-client.mjs';

async function fixture(t, options = {}) {
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'workspace-service-test-'));
  const dataDirectory = path.join(temporary, 'private');
  let handler; let server; let origin;
  const start = async () => {
    handler = await createWorkspaceHandler({ dataDirectory, ...options });
    server = createServer(async (req, res) => { if (!await handler(req, res)) { res.writeHead(404); res.end(); } });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    origin = `http://127.0.0.1:${server.address().port}`;
  };
  const stop = async () => {
    server?.closeAllConnections();
    await new Promise(resolve => server ? server.close(resolve) : resolve());
    await handler?.close();
  };
  await start();
  t.after(async () => { await stop(); await rm(temporary, { recursive: true, force: true }); });
  const request = async (route = '', { method = 'GET', token, body, headers = {}, originHeader = origin } = {}) => {
    const response = await fetch(`${origin}/api/workspaces${route}`, {
      method, headers: { ...(token ? { 'X-Workspace-Token': token } : {}),
        ...(body === undefined ? {} : { 'Content-Type': 'application/json', 'X-Workspace-Client': '1', Origin: originHeader }), ...headers },
      ...(body === undefined ? {} : { body: JSON.stringify(body) })
    });
    return { status: response.status, headers: response.headers, payload: await response.json() };
  };
  const create = async (kind = 'clearcv', document = { name: 'Ada', experience: [] }) => {
    const result = await request('', { method: 'POST', body: { kind, title: 'Example', document } });
    assert.equal(result.status, 201);
    return result.payload;
  };
  return { temporary, dataDirectory, request, create, stop, start, get origin() { return origin; }, get handler() { return handler; } };
}

test('service is explicitly disabled by default and cannot create cloud documents', async t => {
  const handler = await createWorkspaceHandler();
  const server = createServer(async (req, res) => { await handler(req, res); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await handler.close(); });
  const origin = `http://127.0.0.1:${server.address().port}`;
  const status = await fetch(`${origin}/api/workspaces/status`);
  assert.deepEqual(await status.json(), { enabled: false });
  const create = await fetch(`${origin}/api/workspaces`, { method: 'POST' });
  assert.equal(create.status, 503);
  assert.equal((await create.json()).error.code, 'service_disabled');
});

test('distinct capability roles persist hashes only; viewer cannot write or read old versions', async t => {
  const f = await fixture(t);
  const { workspace, tokens } = await f.create();
  assert.equal(new Set(Object.values(tokens)).size, 3);
  for (const token of Object.values(tokens)) assert.match(token, /^[A-Za-z0-9_-]{43}$/);
  for (const [role, token] of Object.entries(tokens)) {
    const result = await f.request(`/${workspace.id}`, { token });
    assert.equal(result.payload.role, role);
    assert.deepEqual(result.payload.workspace.document, { name: 'Ada', experience: [] });
    assert.equal(JSON.stringify(result.payload).includes(token), false);
    assert.equal('tokenHashes' in result.payload.workspace, false);
  }
  const viewer = await f.request(`/${workspace.id}`, { method: 'PUT', token: tokens.view, body: { baseRevision: 1, document: { name: 'Mallory' } } });
  assert.equal(viewer.status, 403);
  assert.equal((await f.request(`/${workspace.id}/revisions`, { token: tokens.view })).status, 403);
  const unauthorised = await f.request(`/${workspace.id}`, { token: 'A'.repeat(43) });
  assert.equal(unauthorised.status, 404);
  const durable = await readFile(path.join(f.dataDirectory, `${workspace.id}.json`), 'utf8');
  for (const token of Object.values(tokens)) assert.equal(durable.includes(token), false);
  assert.equal((await stat(f.dataDirectory)).mode & 0o777, 0o700);
  assert.equal((await stat(path.join(f.dataDirectory, `${workspace.id}.json`))).mode & 0o777, 0o600);
});

test('permission rotation and revocation immediately invalidate old links without granting owner authority', async t => {
  const f = await fixture(t);
  const { workspace, tokens } = await f.create();
  assert.equal((await f.request(`/${workspace.id}/permissions`, { method: 'POST', token: tokens.edit, body: { baseRevision: 1, role: 'view', enabled: false } })).status, 403);
  const revoke = await f.request(`/${workspace.id}/permissions`, { method: 'POST', token: tokens.owner, body: { baseRevision: 1, role: 'view', enabled: false } });
  assert.equal(revoke.status, 200); assert.equal(revoke.payload.share.token, null);
  assert.equal(revoke.payload.workspace.permissions.view, false);
  assert.equal((await f.request(`/${workspace.id}`, { token: tokens.view })).status, 404);
  const rotate = await f.request(`/${workspace.id}/permissions`, { method: 'POST', token: tokens.owner, body: { baseRevision: 2, role: 'edit', enabled: true } });
  assert.equal(rotate.status, 200);
  assert.notEqual(rotate.payload.share.token, tokens.edit);
  assert.equal((await f.request(`/${workspace.id}`, { token: tokens.edit })).status, 404);
  assert.equal((await f.request(`/${workspace.id}`, { token: rotate.payload.share.token })).payload.role, 'edit');
  assert.equal((await f.request(`/${workspace.id}`, { token: tokens.owner })).payload.role, 'owner');
});

test('concurrent updates reject the stale writer with a recoverable revision, and persist one exact document', async t => {
  const f = await fixture(t);
  const { workspace, tokens } = await f.create();
  const changes = ['Owner edit', 'Collaborator edit'];
  const updates = await Promise.all(changes.map((name, index) => f.request(`/${workspace.id}`, {
    method: 'PUT', token: index ? tokens.edit : tokens.owner, body: { baseRevision: 1, document: { name } }
  })));
  assert.deepEqual(updates.map(result => result.status).sort(), [200, 409]);
  const winner = updates.find(result => result.status === 200).payload.workspace;
  const conflict = updates.find(result => result.status === 409).payload;
  assert.equal(conflict.error.code, 'revision_conflict'); assert.equal(conflict.revision, 2);
  assert.deepEqual(conflict.workspace, winner);
  const saved = (await f.request(`/${workspace.id}`, { token: tokens.owner })).payload.workspace;
  assert.deepEqual(saved, winner);
  assert.equal((await readdir(f.dataDirectory)).filter(name => name.endsWith('.tmp')).length, 0);
});

test('comments, revision history and rotated permissions survive a real service restart', async t => {
  const f = await fixture(t);
  const { workspace, tokens } = await f.create();
  const update = await f.request(`/${workspace.id}`, { method: 'PUT', token: tokens.edit, body: { baseRevision: 1, document: { name: 'Ada Lovelace' }, title: 'Updated' } });
  assert.equal(update.status, 200);
  const comment = await f.request(`/${workspace.id}/comments`, { method: 'POST', token: tokens.edit, body: { baseRevision: 2, text: '<script>plain text</script>', author: 'Reader' } });
  assert.equal(comment.status, 200); assert.equal(comment.payload.workspace.revision, 3);
  const permission = await f.request(`/${workspace.id}/permissions`, { method: 'POST', token: tokens.owner, body: { baseRevision: 3, role: 'view', enabled: true } });
  const replacement = permission.payload.share.token;
  await f.stop(); await f.start();
  const saved = await f.request(`/${workspace.id}`, { token: replacement });
  assert.equal(saved.payload.workspace.revision, 4);
  assert.deepEqual(saved.payload.workspace.document, { name: 'Ada Lovelace' });
  assert.equal((await f.request(`/${workspace.id}`, { token: tokens.view })).status, 404);
  const comments = await f.request(`/${workspace.id}/comments`, { token: replacement });
  assert.equal(comments.payload.comments[0].text, '<script>plain text</script>');
  const history = await f.request(`/${workspace.id}/revisions`, { token: tokens.owner });
  assert.deepEqual(history.payload.revisions.map(item => [item.revision, item.document.name]), [[1, 'Ada'], [2, 'Ada Lovelace']]);
});

test('cross-origin writes, missing guard headers and invalid document complexity are rejected before persistence', async t => {
  const f = await fixture(t);
  assert.equal((await f.request('', { method: 'POST', body: { kind: 'clearcv', document: {} }, originHeader: 'https://attacker.invalid' })).status, 403);
  assert.equal((await f.request('', { method: 'POST', body: { kind: 'clearcv', document: {} }, headers: { 'X-Workspace-Client': '0' } })).status, 403);
  const missingOrigin = await fetch(`${f.origin}/api/workspaces`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Workspace-Client': '1' }, body: JSON.stringify({ kind: 'clearcv', document: {} }) });
  assert.equal(missingOrigin.status, 403);
  const dangerous = JSON.parse('{"__proto__":{"polluted":true}}');
  assert.equal((await f.request('', { method: 'POST', body: { kind: 'clearcv', document: dangerous } })).status, 400);
  let complex = {}; for (let depth = 0; depth < 40; depth++) complex = { item: complex };
  assert.equal((await f.request('', { method: 'POST', body: { kind: 'clearcv', document: complex } })).status, 400);
  assert.equal((await f.request('', { method: 'POST', body: { kind: 'clearcv', document: { large: 'x'.repeat(12 * 1024 * 1024) } } })).status, 413);
  assert.equal((await readdir(f.dataDirectory)).filter(name => name.endsWith('.json')).length, 0);
});

test('strict application validators reject documents and service cannot acquire a second writer', async t => {
  const f = await fixture(t, { validators: { clearcv: doc => { if (typeof doc.name !== 'string') throw new Error('private data should never escape'); } } });
  const rejected = await f.request('', { method: 'POST', body: { kind: 'clearcv', document: { bad: true } } });
  assert.equal(rejected.status, 400);
  assert.equal(JSON.stringify(rejected.payload).includes('private data'), false);
  await assert.rejects(createWorkspaceHandler({ dataDirectory: f.dataDirectory }), /already locked/);
  await assert.rejects(createWorkspaceHandler({ dataDirectory: './relative' }), /absolute/);
  await assert.rejects(createWorkspaceHandler({ allowedOrigin: 'https://example.com/path' }), /without a path/);
  await assert.rejects(createWorkspaceHandler({ validators: { clearcv: async () => {} } }), /synchronous/);
});

test('workspace identifiers cannot escape storage, and symlinked records cannot reveal external data', async t => {
  const f = await fixture(t);
  const { workspace, tokens } = await f.create();
  const escaped = await f.request('/%2e%2e%2fsecret', { token: tokens.owner });
  assert.equal(escaped.status, 404);
  const secret = path.join(f.temporary, 'secret.json');
  await writeFile(secret, JSON.stringify({ private: 'DO NOT DISCLOSE' }));
  const id = randomUUID();
  await symlink(secret, path.join(f.dataDirectory, `${id}.json`));
  const read = await f.request(`/${id}`, { token: tokens.owner });
  assert.equal(read.status, 503);
  assert.equal(JSON.stringify(read.payload).includes('DO NOT DISCLOSE'), false);
  const saved = await f.request(`/${workspace.id}`, { method: 'PUT', token: tokens.owner, body: { baseRevision: 1, document: { name: 'New' } } });
  assert.equal(saved.status, 503); // Fail closed when another record makes the store unsafe.
  assert.equal(JSON.parse(await readFile(secret, 'utf8')).private, 'DO NOT DISCLOSE');
});

test('document history is bounded and preserves the current version under many edits', async t => {
  const f = await fixture(t);
  const { workspace, tokens } = await f.create();
  for (let revision = 1; revision <= 25; revision++) {
    const update = await f.request(`/${workspace.id}`, { method: 'PUT', token: tokens.edit, body: { baseRevision: revision, document: { name: `Edit ${revision}` } } });
    assert.equal(update.status, 200);
  }
  const history = (await f.request(`/${workspace.id}/revisions`, { token: tokens.owner })).payload.revisions;
  assert.equal(history.length, 21);
  assert.equal(history[0].revision, 6);
  assert.equal(history.at(-1).revision, 26);
  assert.equal(history.at(-1).document.name, 'Edit 25');
});

test('large old document versions are trimmed to the history byte budget without dropping the current document', async t => {
  const f = await fixture(t);
  const large = 'x'.repeat(2 * 1024 * 1024);
  const { workspace, tokens } = await f.create('stencil-studio', { large, name: 'Original' });
  for (let revision = 1; revision <= 14; revision++) {
    const result = await f.request(`/${workspace.id}`, { method: 'PUT', token: tokens.owner, body: { baseRevision: revision, document: { large, name: `Large ${revision}` } } });
    assert.equal(result.status, 200);
  }
  const durable = JSON.parse(await readFile(path.join(f.dataDirectory, `${workspace.id}.json`), 'utf8'));
  assert.ok(Buffer.byteLength(JSON.stringify(durable.history)) <= 24 * 1024 * 1024);
  assert.equal(durable.document.name, 'Large 14');
  assert.equal(durable.revision, 15);
  assert.ok(durable.history.length < 14);
});

test('workspace count quota rejects a new document while keeping existing documents writable', async t => {
  const f = await fixture(t);
  const first = await f.create();
  for (let index = 1; index < 100; index++) await f.create();
  const excessive = await f.request('', { method: 'POST', body: { kind: 'clearcv', document: { name: 'Excess' } } });
  assert.equal(excessive.status, 507);
  assert.equal(excessive.payload.error.code, 'storage_limit');
  const existing = await f.request(`/${first.workspace.id}`, { method: 'PUT', token: first.tokens.owner, body: { baseRevision: 1, document: { name: 'Still works' } } });
  assert.equal(existing.status, 200);
  assert.equal(existing.payload.workspace.document.name, 'Still works');
  assert.equal((await readdir(f.dataDirectory)).filter(name => name.endsWith('.json')).length, 100);
});

test('crash-orphaned storage counts against the quota and remains preserved for operator recovery', async t => {
  const f = await fixture(t);
  const orphan = path.join(f.dataDirectory, `.${randomUUID()}.${randomUUID()}.tmp`);
  const file = await open(orphan, 'wx', 0o600);
  await file.truncate(512 * 1024 * 1024); // Sparse file: exercise accounting without allocating 512 MiB.
  await file.close();
  const rejected = await f.request('', { method: 'POST', body: { kind: 'clearcv', document: { name: 'No space' } } });
  assert.equal(rejected.status, 507);
  assert.equal((await stat(orphan)).size, 512 * 1024 * 1024);
  assert.equal((await readdir(f.dataDirectory)).filter(name => name.endsWith('.json')).length, 0);
});

test('browser client sends token headers only, enforces same-origin APIs and reports actionable conflicts', async t => {
  const f = await fixture(t);
  const calls = [];
  const fetchImpl = (url, options) => { calls.push({ url, options }); return fetch(`${f.origin}${url}`, { ...options, headers: { ...options.headers, ...(options.body === undefined ? {} : { Origin: f.origin }) } }); };
  const client = createCloudClient({ fetchImpl });
  assert.equal((await client.status()).enabled, true);
  const created = await client.create({ kind: 'clearcv', title: 'Client', document: { name: 'Original' } });
  const credentials = { id: created.workspace.id, token: created.tokens.owner };
  await client.update({ ...credentials, baseRevision: 1, document: { name: 'Changed' } });
  await assert.rejects(client.update({ ...credentials, baseRevision: 1, document: { name: 'Stale' } }), error => {
    assert.ok(error instanceof CloudError); assert.equal(error.status, 409); assert.equal(error.revision, 2); assert.equal(error.current.document.name, 'Changed'); return true;
  });
  for (const { url, options } of calls) {
    assert.equal(url.includes(created.tokens.owner), false);
    assert.equal(options.referrerPolicy, 'no-referrer'); assert.equal(options.redirect, 'error'); assert.equal(options.credentials, 'omit');
  }
  assert.throws(() => createCloudClient({ baseURL: 'https://another.example/api/workspaces' }), { name: 'TypeError', message: 'The workspace service must use a path starting with / on this site.' });
  assert.throws(() => createCloudClient({ baseURL: '//another.example/api/workspaces' }), { name: 'TypeError', message: 'The workspace service must use a path starting with / on this site.' });
  assert.throws(() => createCloudClient({ baseURL: '/\n/another.example/api/workspaces' }), { name: 'TypeError', message: 'The workspace service must use a path starting with / on this site.' });
  assert.throws(() => createCloudClient({ baseURL: '/api/../workspaces' }), { name: 'TypeError', message: 'The workspace service must use a path starting with / on this site.' });
  const link = shareLink({ id: credentials.id, token: created.tokens.view, baseURL: 'https://example.org/stencil-studio/?template=1' });
  assert.equal(new URL(link).search.includes(created.tokens.view), false);
  assert.deepEqual(readShareLink(link), { id: credentials.id, token: created.tokens.view });
  assert.equal(readShareLink(`${link}&token=${created.tokens.owner}`), null);
});

test('polling observes a real remote edit and stops after permission revocation', async t => {
  const f = await fixture(t);
  const fetchImpl = (url, options) => fetch(`${f.origin}${url}`, { ...options, headers: { ...options.headers, ...(options.body === undefined ? {} : { Origin: f.origin }) } });
  const client = createCloudClient({ fetchImpl });
  const created = await client.create({ kind: 'stencil-studio', document: { pages: [] }, title: 'Watched' });
  const id = created.workspace.id;
  const changed = Promise.withResolvers(); const revoked = Promise.withResolvers();
  const timeout = setTimeout(() => { changed.reject(new Error('Polling timed out')); revoked.reject(new Error('Revocation timed out')); }, 5000);
  const stop = client.watch({ id, token: created.tokens.view, revision: 1, intervalMs: 250,
    onChange: value => changed.resolve(value), onError: error => revoked.resolve(error) });
  t.after(() => { stop(); clearTimeout(timeout); });
  await client.update({ id, token: created.tokens.edit, baseRevision: 1, document: { pages: [{ title: 'Remote edit' }] } });
  assert.equal((await changed.promise).workspace.document.pages[0].title, 'Remote edit');
  await client.setPermission({ id, token: created.tokens.owner, baseRevision: 2, role: 'view', enabled: false });
  assert.equal((await revoked.promise).status, 404);
  stop(); clearTimeout(timeout);
});
