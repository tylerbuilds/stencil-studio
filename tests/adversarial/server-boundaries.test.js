import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { mkdtemp, mkdir, writeFile, readFile, open, link, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const project = fileURLToPath(new URL('../../', import.meta.url));
const { name } = JSON.parse(await readFile(new URL('../../package.json', import.meta.url), 'utf8'));
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function temporary(t) {
  const directory = await mkdtemp(path.join(tmpdir(), 'oss-adversarial-server-'));
  return directory;
}
async function request(base, route, { method = 'GET', headers = {}, body, partial, deadline = 2000 } = {}) {
  let client;
  const response = new Promise((resolve, reject) => {
    const timer = setTimeout(() => { client.destroy(); reject(new Error('The server did not answer within the bounded test deadline.')); }, deadline);
    client = http.request(`${base}${route}`, { method, headers }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => { clearTimeout(timer); resolve({ status: res.statusCode, headers: res.headers, text: Buffer.concat(chunks).toString('utf8') }); });
    });
    client.on('error', (error) => { clearTimeout(timer); reject(error); });
    if (partial !== undefined) client.write(partial);
    else client.end(body);
  });
  return { client, response };
}
async function complete(base, route, options) { return (await request(base, route, options)).response; }
async function staticFixture(t, { host = '127.0.0.1' } = {}) {
  const directory = await temporary(t); const root = path.join(directory, 'site');
  await mkdir(path.join(root, 'public'), { recursive: true });
  await mkdir(path.join(root, 'src'));
  await writeFile(path.join(root, 'index.html'), 'Synthetic public page');
  await writeFile(path.join(root, 'public', 'small.json'), '{"public":true}');
  const reservation = http.createServer();
  await new Promise((resolve) => reservation.listen(0, '127.0.0.1', resolve));
  const port = reservation.address().port; await new Promise((resolve) => reservation.close(resolve));
  const child = spawn(process.execPath, ['scripts/serve.mjs', '--dir', root, '--port', String(port), '--host', host], {
    cwd: project, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, AI_BASE_URL: '', AI_MODEL: '', AI_API_KEY: '', FEDORA_VLLM_API_KEY: '', VLLM_API_KEY: '' },
  });
  let output = ''; child.stdout.on('data', (chunk) => { output += chunk; }); child.stderr.on('data', (chunk) => { output += chunk; });
  t.after(async () => {
    if (child.exitCode === null) {
      const ended = once(child, 'exit'); child.kill('SIGTERM');
      const force = setTimeout(() => child.kill('SIGKILL'), 500); force.unref();
      try { await ended; } finally { clearTimeout(force); }
    }
    await rm(directory, { recursive: true, force: true });
  });
  const base = `http://127.0.0.1:${port}`;
  for (let attempt = 0; attempt < 100; attempt++) {
    try { if ((await complete(base, '/')).status === 200) return { base, root, directory }; } catch {}
    if (child.exitCode !== null) break;
    await pause(25);
  }
  assert.fail(`Synthetic static server did not start: ${output}`);
}

test('HEAD returns real length without serving bytes', async (t) => {
  const f = await staticFixture(t);
  const head = await complete(f.base, '/public/small.json', { method: 'HEAD' });
  assert.equal(head.status, 200); assert.equal(head.text, '');
  assert.equal(Number(head.headers['content-length']), Buffer.byteLength('{"public":true}'));
});
test('oversized sparse assets are refused before HEAD or GET reads', async (t) => {
  const f = await staticFixture(t);
  const huge = await open(path.join(f.root, 'public', 'huge.json'), 'wx');
  try { await huge.truncate(64 * 1024 * 1024 + 1); } finally { await huge.close(); }
  assert.equal((await complete(f.base, '/public/huge.json', { method: 'HEAD' })).status, 413);
  assert.equal((await complete(f.base, '/public/huge.json')).status, 413);
});

test('loopback servers reject foreign Host names while preserving localhost aliases', async (t) => {
  const f = await staticFixture(t);
  assert.equal((await complete(f.base, '/', { headers: { Host: 'attacker.invalid' } })).status, 403);
  assert.equal((await complete(f.base, '/', { headers: { Host: 'localhost' } })).status, 200);
});

test('explicit non-loopback hosting still accepts the operator-selected public host', async (t) => {
  const f = await staticFixture(t, { host: '0.0.0.0' });
  assert.equal((await complete(f.base, '/', { headers: { Host: 'synthetic-public.invalid' } })).status, 200);
});

test('public-root hardlink aliases cannot reveal synthetic private files', async (t) => {
  const f = await staticFixture(t); const secret = path.join(f.directory, 'private.json');
  await writeFile(secret, '{"marker":"SYNTHETIC_PRIVATE_OUTSIDE_ROOT"}');
  await link(secret, path.join(f.root, 'public', 'alias.json'));
  const response = await complete(f.base, '/public/alias.json');
  assert.equal(response.status, 404);
  assert.doesNotMatch(response.text, /SYNTHETIC_PRIVATE_OUTSIDE_ROOT/);
});

test('an allowed-path FIFO without a writer is refused without blocking later requests', async (t) => {
  const f = await staticFixture(t);
  await promisify(execFile)('mkfifo', [path.join(f.root, 'public', 'pipe.json')]);
  const fifo = await complete(f.base, '/public/pipe.json', { deadline: 750 });
  assert.equal(fifo.status, 404);
  const ordinary = await complete(f.base, '/public/small.json', { deadline: 750 });
  assert.equal(ordinary.status, 200); assert.equal(ordinary.text, '{"public":true}');
});

test('malformed paths, non-files and wrong methods cannot break later valid static requests', async (t) => {
  const f = await staticFixture(t);
  for (const route of ['/public/%zz.json', '/public/%00.json', '/src/', '/public/missing.json', '/public/%2f..%2fprivate.json']) {
    const response = await complete(f.base, route);
    assert.ok([400, 404].includes(response.status), route);
  }
  assert.equal((await complete(f.base, '/', { method: 'PATCH', body: '<script>synthetic</script>' })).status, 405);
  const responses = await Promise.all(Array.from({ length: 40 }, () => complete(f.base, '/public/small.json')));
  assert.ok(responses.every((value) => value.status === 200 && value.text === '{"public":true}'));
});

if (name !== 'petrealm') {
  const { createAiHandler, loadAiConfig } = await import('../../scripts/ai.mjs');
  const { createWorkspaceHandler } = await import('../../scripts/workspace-backend.mjs');
  const valid = { task: 'summary', content: 'A synthetic writing sample.' };
  const headers = { 'Content-Type': 'application/json', 'X-Local-Workspace': '1' };
  async function aiFixture(t, options = {}) {
    let calls = 0; let arrivals = 0;
    const handler = createAiHandler({ enabled: true, baseUrl: 'http://fake.invalid/v1', model: 'synthetic', apiKey: 'fake-not-a-secret' }, {
      fetchImpl: async () => { calls++; return new Response(JSON.stringify({ choices: [{ message: { content: 'Synthetic result.' } }] })); },
      timeoutMs: 1000, ...options,
    });
    const server = http.createServer(async (req, res) => { arrivals++; if (!await handler(req, res, new URL(req.url, 'http://local.invalid').pathname)) { res.writeHead(404); res.end(); } });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    t.after(async () => { server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); });
    return { base: `http://127.0.0.1:${server.address().port}`, get calls() { return calls; }, async waitFor(count) { for (let tries = 0; tries < 100 && arrivals < count; tries++) await pause(10); assert.ok(arrivals >= count); } };
  }
  test('AI accepts real JSON parameters but rejects suffix impersonation and declared compression', async (t) => {
    const f = await aiFixture(t);
    for (const extra of [{ 'Content-Type': 'application/json-fake' }, { 'Content-Type': 'application/jsonp' }, { 'Content-Encoding': 'gzip' }]) {
      await t.test(JSON.stringify(extra), async () => {
        const response = await complete(f.base, '/api/ai', { method: 'POST', headers: { ...headers, ...extra }, body: JSON.stringify(valid) });
        assert.equal(response.status, 415);
      });
    }
    assert.equal(f.calls, 0);
    const real = await complete(f.base, '/api/ai', { method: 'POST', headers: { ...headers, 'Content-Type': 'Application/JSON; charset=UTF-8' }, body: JSON.stringify(valid) });
    assert.equal(real.status, 200); assert.equal(f.calls, 1);
  });
  test('AI rejects oversized declared bodies before waiting for their content', async (t) => {
    const f = await aiFixture(t, { bodyTimeoutMs: 50 });
    const huge = await request(f.base, '/api/ai', { method: 'POST', headers: { ...headers, 'Content-Length': '96001' }, partial: '{', deadline: 1500 });
    try { assert.equal((await huge.response).status, 413); } finally { huge.client.destroy(); }
    assert.equal(f.calls, 0);
  });
  test('AI unfinished body timeout releases the reader for a later valid request', async (t) => {
    const f = await aiFixture(t, { bodyTimeoutMs: 50 });
    const slow = await request(f.base, '/api/ai', { method: 'POST', headers, partial: '{', deadline: 1500 });
    try { assert.equal((await slow.response).status, 408); } finally { slow.client.destroy(); }
    assert.equal(f.calls, 0);
    assert.equal((await complete(f.base, '/api/ai', { method: 'POST', headers, body: JSON.stringify(valid) })).status, 200);
  });
  test('AI pending body readers are bounded and disconnected readers release their slots', async (t) => {
    const f = await aiFixture(t, { maxPendingRequests: 2, bodyTimeoutMs: 2000 });
    const first = await request(f.base, '/api/ai', { method: 'POST', headers, partial: '{', deadline: 3000 }); first.response.catch(() => {});
    const second = await request(f.base, '/api/ai', { method: 'POST', headers, partial: '{', deadline: 3000 }); second.response.catch(() => {});
    await f.waitFor(2);
    try {
      assert.equal((await complete(f.base, '/api/ai', { method: 'POST', headers, body: JSON.stringify(valid) })).status, 429);
      assert.equal(f.calls, 0);
      first.client.destroy(); second.client.destroy(); await pause(30);
      assert.equal((await complete(f.base, '/api/ai', { method: 'POST', headers, body: JSON.stringify(valid) })).status, 200);
    } finally { first.client.destroy(); second.client.destroy(); }
  });
  test('AI malformed fields and provider injection text stay data rather than native commands', async (t) => {
    const f = await aiFixture(t);
    for (const body of ['null', '[]', '{broken', JSON.stringify({ ...valid, content: true }), JSON.stringify({ ...valid, context: ['bad'] }), JSON.stringify({ ...valid, task: ['summary'] }), JSON.stringify({ ...valid, content: ' ' }), JSON.stringify({ ...valid, content: 'x'.repeat(100_001) })]) {
      assert.equal((await complete(f.base, '/api/ai', { method: 'POST', headers, body })).status, Buffer.byteLength(body)>96000 ? 413 : 400);
    }
    const injected = await complete(f.base, '/api/ai', { method: 'POST', headers, body: JSON.stringify({ ...valid, content: '$(touch /synthetic-no-file); <script>source text</script>\u202e' }) });
    assert.equal(injected.status, 200); assert.equal(f.calls, 1);
    assert.doesNotMatch(injected.text, /fake-not-a-secret/);
  });
  test('AI rejects malformed operator option values instead of enabling a broken provider', async (t) => {
    for (const args of [['--ai-model'], ['--ai-base-url', '--ai-model', 'synthetic'], ['--ai-env-file']]) await t.test(args.join(' '), async () => { await assert.rejects(loadAiConfig(args, {}), /value|option/i); });
    for (const env of [{ AI_BASE_URL: 'http://127.0.0.1/v1', AI_MODEL: true }, { AI_BASE_URL: 'http://127.0.0.1/v1', AI_MODEL: 'ok\nwrong' }]) await t.test(typeof env.AI_MODEL === 'boolean' ? 'boolean model' : 'control character model', async () => { await assert.rejects(loadAiConfig([], env), /model/i); });
  });
  test('concurrent workspace closes all wait for lock release before a replacement starts', async (t) => {
    const directory = await temporary(t); const dataDirectory = path.join(directory, 'data');
    const handler = await createWorkspaceHandler({ dataDirectory });
    t.after(async () => { await handler.close(); await rm(directory, { recursive: true, force: true }); });
    const first = handler.close(); const second = handler.close();
    await second;
    assert.equal((await readdir(dataDirectory)).includes('.workspace-service.lock'), false);
    await first;
    const replacement = await createWorkspaceHandler({ dataDirectory }); await replacement.close();
  });
  test('corrupted workspace records fail closed without exposing tokens or private fields', async (t) => {
    const directory = await temporary(t); const dataDirectory = path.join(directory, 'data');
    const handler = await createWorkspaceHandler({ dataDirectory });
    const server = http.createServer(async (req, res) => { if (!await handler(req, res)) { res.writeHead(404); res.end(); } });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    t.after(async () => { server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); await handler.close(); await rm(directory, { recursive: true, force: true }); });
    const base = `http://127.0.0.1:${server.address().port}`;
    const created = await complete(base, '/api/workspaces', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Workspace-Client': '1', Origin: base }, body: JSON.stringify({ kind: name, document: { synthetic: true } }) });
    assert.equal(created.status, 201); const { workspace, tokens } = JSON.parse(created.text);
    const filename = path.join(dataDirectory, `${workspace.id}.json`);
    for (const raw of ['{broken SYNTHETIC_PRIVATE_MARKER', JSON.stringify({ version: 2, private: 'SYNTHETIC_PRIVATE_MARKER' }), '["SYNTHETIC_PRIVATE_MARKER"]']) {
      await writeFile(filename, raw);
      const response = await complete(base, `/api/workspaces/${workspace.id}`, { headers: { 'X-Workspace-Token': tokens.owner } });
      assert.equal(response.status, 503); assert.doesNotMatch(response.text, /SYNTHETIC_PRIVATE_MARKER|fake-not-a-secret/);
      assert.equal(await readFile(filename, 'utf8'), raw);
    }
  });
}
