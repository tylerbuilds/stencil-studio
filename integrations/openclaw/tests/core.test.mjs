/** Real scoped tools against a copied, hash-pinned runtime. No browser or network. */
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, writeFile, readdir, chmod, realpath, rm, symlink, link, open, rename } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import https from 'node:https';
import dns from 'node:dns/promises';
import { syncBuiltinESMExports } from 'node:module';
import { createManager, verifyRuntime, plainTree, authorisedAgent } from '../core.mjs';
import { parseDocument } from '../../../src/model.js';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const releaseSha = 'ab'.repeat(20);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
// Original 32px colour tile from the isolated bridge proof, embedded for portable tests.
const png = Buffer.from('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', 'base64');
const request = () => ({ schema: 'stencil-design-request', version: 1, title: 'Cedar Street Bookshop', pages: [{ preset: 'social', elements: [{ type: 'text', text: 'A good book awaits', x: 80, y: 90, width: 800, height: 120, fontFamily: 'DM Sans' }] }] });
const assetRequest = (source = { file: 'tile.png' }) => ({ schema: 'stencil-design-request', version: 1, title: 'Original colour tile', assets: [{ id: 'tile', ...source }], pages: [{ preset: 'social', elements: [{ type: 'image', asset: 'tile' }] }] });

// A failed boundary check must not silently attempt HTTPS or DNS. These guards
// are process-local: node:test runs this file in its own worker.
let networkCalls = 0;
const get = https.get, lookup = dns.lookup;
https.get = () => { networkCalls++; throw new Error('Unexpected HTTPS request in a local tool test.'); };
dns.lookup = () => { networkCalls++; throw new Error('Unexpected DNS lookup in a local tool test.'); };
syncBuiltinESMExports();
after(() => { https.get = get; dns.lookup = lookup; syncBuiltinESMExports(); assert.equal(networkCalls, 0); });

async function fixture(t) {
  const base = await mkdtemp(join(await realpath(tmpdir()), 'stencil-scoped-tools-'));
  t.after(() => rm(base, { recursive: true, force: true }));
  const runtime = join(base, releaseSha), output = join(base, 'designs'), incoming = join(output, 'incoming');
  for (const directory of [runtime, output, incoming]) await mkdir(directory, { mode: 0o700 });
  const paths = ['package.json', 'scripts/agent-design.mjs', 'schemas/design-request.schema.json'];
  for (const folder of ['src', 'integrations/openclaw']) {
    for (const entry of await readdir(join(root, folder), { withFileTypes: true })) if (entry.isFile() && /\.(?:js|mjs|json)$/.test(entry.name)) paths.push(`${folder}/${entry.name}`);
  }
  for (const entry of await readdir(join(root, 'public/fonts'), { withFileTypes: true })) if (entry.isFile() && /\.(?:woff2|txt|json)$/.test(entry.name)) paths.push(`public/fonts/${entry.name}`);
  const entries = [];
  for (const path of paths.sort()) {
    const bytes = await readFile(join(root, path));
    await mkdir(dirname(join(runtime, path)), { recursive: true, mode: 0o700 });
    await writeFile(join(runtime, path), bytes, { flag: 'wx', mode: 0o600 });
    entries.push({ path, bytes: bytes.length, sha256: hash(bytes) });
  }
  const manifest = { schema: 'stencil-public-runtime/v1', source_head: releaseSha, source_state: 'public-release', entries };
  const manifestBytes = Buffer.from(`${JSON.stringify(manifest)}\n`);
  await writeFile(join(runtime, 'runtime-public-manifest.json'), manifestBytes, { flag: 'wx', mode: 0o600 });
  await writeFile(join(incoming, 'tile.png'), png, { flag: 'wx', mode: 0o600 });
  const config = { releaseSha, manifestSha256: hash(manifestBytes), outputDirectory: output, allowedAgentIds: ['main', 'zeus'] };
  const manager = createManager(runtime, config);
  return { base, runtime, output, incoming, manifest, config, manager };
}

async function created(f) {
  const result = await f.manager.execute('stencil_create_design', { request: request() });
  assert.equal(result.ok, true, result.message);
  assert.match(result.designFile, /^[a-f0-9-]{36}\.stencil\.json$/);
  assert.equal(result.releaseSha, releaseSha);
  return result;
}
async function cleanWork(f) { assert.equal((await readdir(f.output)).some(name => name.startsWith('work-')), false); }
function rejected(result, pattern) { assert.equal(result.ok, false); assert.equal(result.code, 'stencil-operation-failed'); if (pattern) assert.match(result.message, pattern); }

test('scoped tools create an editable design, validate it and export embedded-font SVG', async t => {
  const f = await fixture(t);
  assert.equal((await verifyRuntime(f.runtime, f.config)).source_head, releaseSha);
  const presets = await f.manager.execute('stencil_presets'); assert.equal(presets.ok, true); assert.ok(presets.presets.length > 5);
  const result = await created(f), before = await readFile(result.path);
  const document = parseDocument(before.toString('utf8'));
  assert.equal(document.title, 'Cedar Street Bookshop'); assert.equal(document.pages[0].elements[0].text, 'A good book awaits');
  assert.equal((await f.manager.execute('stencil_validate_design', { design: result.designFile })).ok, true);
  const exported = await f.manager.execute('stencil_export_svg', { design: result.designFile });
  assert.equal(exported.ok, true, exported.message); assert.deepEqual(exported.files, ['page-01.svg']);
  const svg = await readFile(join(exported.output, 'page-01.svg'), 'utf8');
  assert.match(svg, /A good book awaits/); assert.match(svg, /data:font\/woff2;base64,/);
  assert.deepEqual(await readFile(result.path), before); await cleanWork(f);
});

test('local and inline PNG imports create new editable outputs and preserve every original', async t => {
  const f = await fixture(t), result = await created(f), before = await readFile(result.path);
  for (const source of [{ file: 'tile.png' }, { dataUrl: `data:image/png;base64,${png.toString('base64')}` }]) {
    const imported = await f.manager.execute('stencil_import_image', { design: result.designFile, source, page: 1, x: 37, y: 48, width: 320, height: 240 });
    assert.equal(imported.ok, true, imported.message); assert.notEqual(imported.designFile, result.designFile);
    const document = parseDocument(await readFile(imported.path, 'utf8')), image = document.pages[0].elements.at(-1);
    assert.equal(image.type, 'image'); assert.deepEqual([image.x, image.y, image.width, image.height], [37, 48, 320, 240]);
    assert.deepEqual(Buffer.from(image.src.split(',')[1], 'base64'), png);
  }
  const withAsset = await f.manager.execute('stencil_create_design', { request: assetRequest() }); assert.equal(withAsset.ok, true, withAsset.message);
  assert.equal(parseDocument(await readFile(withAsset.path, 'utf8')).pages[0].elements[0].type, 'image');
  assert.deepEqual(await readFile(result.path), before); assert.deepEqual(await readFile(join(f.incoming, 'tile.png')), png); await cleanWork(f);
});

test('tool inputs cannot select a shell, browser, output path or undeclared source field', async t => {
  const f = await fixture(t), result = await created(f), before = await readFile(result.path);
  for (const [name, parameters] of [
    ['stencil_presets', { shell: 'sh' }],
    ['stencil_create_design', { request: request(), output: '/tmp/change-me.json' }],
    ['stencil_export_svg', { design: result.designFile, browser: '/bin/sh' }],
    ['stencil_import_image', { design: result.designFile, source: { file: 'tile.png', shell: 'sh' } }],
    ['stencil_import_image', { design: result.designFile, source: { file: 'tile.png', dataUrl: 'also-set' } }],
    ['stencil_import_image', { design: result.designFile, source: { file: 'tile.png', outputIndex: 0 } }],
    ['unregistered_tool', {}],
  ]) rejected(await f.manager.execute(name, parameters), /unsupported|exactly one|registered/);
  assert.deepEqual(await readFile(result.path), before); await cleanWork(f);
});

test('filenames are scoped at both top-level and nested request asset boundaries', async t => {
  const f = await fixture(t), result = await created(f);
  for (const filename of ['../tile.png', '/tmp/tile.png', 'nested/tile.png', 'folder\\tile.png', 'a..png']) {
    rejected(await f.manager.execute('stencil_import_image', { design: result.designFile, source: { file: filename } }), /filename|traversal/);
    rejected(await f.manager.execute('stencil_create_design', { request: assetRequest({ file: filename }) }), /filename|traversal/);
    rejected(await f.manager.execute('stencil_create_design', { request: assetRequest({ prediction: filename }), allowRemote: true }), /filename|traversal/);
  }
  for (const name of ['../outside.stencil.json', '/tmp/outside.stencil.json', 'tile.png']) rejected(await f.manager.execute('stencil_validate_design', { design: name }), /design filename/);
  await cleanWork(f);
});

test('symlinked, hardlinked, FIFO and oversized incoming files are rejected before reading', async t => {
  const f = await fixture(t), result = await created(f), outside = join(f.base, 'outside.png');
  await writeFile(outside, png, { mode: 0o600 });
  await symlink(outside, join(f.incoming, 'symlink.png'));
  await link(outside, join(f.incoming, 'hardlink.png'));
  const fifo = spawnSync('mkfifo', [join(f.incoming, 'fifo.png')], { encoding: 'utf8', timeout: 2000 }); assert.equal(fifo.status, 0, fifo.stderr);
  const handle = await open(join(f.incoming, 'oversized.png'), 'wx', 0o600); await handle.truncate(6 * 1024 * 1024 + 1); await handle.close();
  for (const file of ['symlink.png', 'hardlink.png', 'fifo.png', 'oversized.png']) rejected(await f.manager.execute('stencil_import_image', { design: result.designFile, source: { file } }), /regular owned file/);
  assert.deepEqual(await readFile(outside), png); await cleanWork(f);
});

test('configured root directories and their ancestors cannot be symlinks or public output folders', async t => {
  const f = await fixture(t);
  const outputAlias = join(f.base, 'design-alias'), ancestorAlias = join(f.base, 'runtime-alias');
  await symlink(f.output, outputAlias); await symlink(f.base, ancestorAlias);
  rejected(await createManager(f.runtime, { ...f.config, outputDirectory: outputAlias }).execute('stencil_presets'), /symlink ancestors/);
  rejected(await createManager(join(ancestorAlias, releaseSha), f.config).execute('stencil_presets'), /symlink ancestors/);
  await chmod(f.output, 0o755); rejected(await f.manager.execute('stencil_presets'), /private/); await chmod(f.output, 0o700);
  await rm(f.incoming, { recursive: true }); await symlink(f.base, f.incoming);
  rejected(await f.manager.execute('stencil_presets'), /symlink ancestors/);
  assert.throws(() => createManager(f.runtime, { ...f.config, outputDirectory: f.runtime }), /separate/);
});

test('release, manifest and every runtime source hash are checked for every operation', async t => {
  const f = await fixture(t);
  rejected(await createManager(f.runtime, { ...f.config, releaseSha: 'cd'.repeat(20) }).execute('stencil_presets'), /exact released/);
  rejected(await createManager(f.runtime, { ...f.config, manifestSha256: '0'.repeat(64) }).execute('stencil_presets'), /manifest.*hash/);
  assert.equal((await f.manager.execute('stencil_presets')).ok, true);
  const source = join(f.runtime, 'src/agent-design.js'), original = await readFile(source);
  await writeFile(source, Buffer.concat([original, Buffer.from('\n// changed after the first import\n')]));
  rejected(await f.manager.execute('stencil_presets'), /pinned hash/);
  rejected(await f.manager.execute('stencil_create_design', { request: request() }), /pinned hash/);
  await writeFile(source, original);
  assert.equal((await f.manager.execute('stencil_presets')).ok, true);
  const manifest = join(f.runtime, 'runtime-public-manifest.json');
  await writeFile(manifest, `${JSON.stringify({ ...f.manifest, source_state: 'unreleased' })}\n`);
  rejected(await f.manager.execute('stencil_presets'), /manifest.*hash/);
  assert.deepEqual((await readdir(f.output)).sort(), ['incoming']);
});

test('a rehashed manifest must pin all transitive modules, schemas, font faces and licences', async t => {
  const f = await fixture(t), manifestPath = join(f.runtime, 'runtime-public-manifest.json');
  for (const [omitted, message] of [
    ['src/typography.js', /local module dependency/],
    ['src/font-loader.js', /required source file/],
    ['schemas/design-request.schema.json', /required source file/],
    ['integrations/openclaw/schemas.mjs', /required source file/],
    ['public/fonts/dm-sans-400-700-latin.woff2', /bundled font or its licence/],
    ['public/fonts/dm-sans-OFL.txt', /bundled font or its licence/],
  ]) {
    const path = join(f.runtime, omitted), original = await readFile(path);
    const manifest = { ...f.manifest, entries: f.manifest.entries.filter(entry => entry.path !== omitted) };
    const bytes = Buffer.from(`${JSON.stringify(manifest)}\n`);
    await writeFile(manifestPath, bytes);
    const config = { ...f.config, manifestSha256: hash(bytes) };
    // Removing a hash entry cannot grant trust to an unchanged file left on
    // disk, or to later substituted contents that the manifest never checked.
    await assert.rejects(verifyRuntime(f.runtime, config), message);
    await writeFile(path, Buffer.concat([original, Buffer.from('\nUnlisted substitution\n')]));
    await assert.rejects(verifyRuntime(f.runtime, config), message);
    rejected(await createManager(f.runtime, config).execute('stencil_presets'), message);
    await writeFile(path, original);
  }
  assert.deepEqual((await readdir(f.output)).sort(), ['incoming']);
});

test('remote imports require opt-in and reject local HTTPS targets without DNS or downloads', async t => {
  const f = await fixture(t), result = await created(f), initial = networkCalls;
  rejected(await f.manager.execute('stencil_import_image', { design: result.designFile, source: { url: 'https://example.com/tile.png' } }), /allowRemote/);
  rejected(await f.manager.execute('stencil_create_design', { request: assetRequest({ url: 'https://example.com/tile.png' }) }), /allowRemote/);
  for (const url of ['https://127.0.0.1/tile.png', 'https://10.0.0.1/tile.png', 'https://192.168.1.1/tile.png', 'https://[::1]/tile.png', 'https://localhost/tile.png', 'https://printer.local/tile.png', 'http://127.0.0.1/tile.png']) {
    rejected(await f.manager.execute('stencil_import_image', { design: result.designFile, source: { url }, allowRemote: true }), /public HTTPS|HTTPS image URL/);
  }
  await writeFile(join(f.incoming, 'prediction.json'), JSON.stringify({ status: 'succeeded', output: 'https://127.0.0.1/tile.png' }), { mode: 0o600 });
  rejected(await f.manager.execute('stencil_create_design', { request: assetRequest({ prediction: 'prediction.json' }), allowRemote: true }), /public HTTPS/);
  rejected(await f.manager.execute('stencil_import_image', { design: result.designFile, source: { prediction: { status: 'processing', output: 'https://example.com/tile.png' } }, allowRemote: true }), /not succeeded/);
  assert.equal(networkCalls, initial); await cleanWork(f);
});

test('remote image placement and credit are validated before any download starts', async t => {
  const f = await fixture(t), result = await created(f), original = await readFile(result.path), initial = networkCalls;
  const badCredit = { name: 'Original colour tile', creator: 'Fictional artist', licence: 'Original artwork', sourceUrl: 'javascript:alert(1)', licenceUrl: '' };
  for (const invalid of [{ page: 2 }, { page: 0 }, { page: 1.5 }, { x: 99999 }, { y: -99999 }, { width: 0 }, { height: 0 }, { width: 8193 }, { height: 8193 }, { width: '320' }, { credit: badCredit }]) {
    const response = await f.manager.execute('stencil_import_image', { design: result.designFile, source: { url: 'https://example.com/fictional-tile.png' }, allowRemote: true, ...invalid });
    rejected(response); assert.doesNotMatch(response.message, /Unexpected DNS|Unexpected HTTPS/);
    assert.equal(networkCalls, initial, `Invalid placement or credit reached a download: ${JSON.stringify(invalid)}`);
  }
  assert.deepEqual(await readFile(result.path), original);
  assert.deepEqual((await readdir(f.output)).sort(), [result.designFile, 'incoming'].sort()); await cleanWork(f);
});

test('allowRemote accepts booleans only, including when the image source is local', async t => {
  const f = await fixture(t), result = await created(f);
  for (const allowRemote of ['true', 'false', 1, 0, null, [], {}]) {
    rejected(await f.manager.execute('stencil_create_design', { request: request(), allowRemote }), /boolean/);
    rejected(await f.manager.execute('stencil_import_image', { design: result.designFile, source: { file: 'tile.png' }, allowRemote }), /boolean/);
  }
  assert.equal((await f.manager.execute('stencil_create_design', { request: request(), allowRemote: false })).ok, true);
  assert.equal((await f.manager.execute('stencil_import_image', { design: result.designFile, source: { file: 'tile.png' }, allowRemote: false })).ok, true);
  await cleanWork(f);
});

async function directoryBytes(directory) {
  const files = {};
  async function walk(current, prefix = '') {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const relative = `${prefix}${entry.name}`;
      if (entry.isDirectory()) await walk(join(current, entry.name), `${relative}/`);
      else { assert.equal(entry.isFile(), true); files[relative] = hash(await readFile(join(current, entry.name))); }
    }
  }
  await walk(directory); return files;
}

test('remote await cannot redirect final writes or cleanup into a replacement output root', async t => {
  const deniedGet = https.get, deniedLookup = dns.lookup, initial = networkCalls;
  try {
    for (const operation of ['create', 'import']) for (const replacement of ['symlink', 'owned-directory']) {
      const f = await fixture(t), existing = await created(f), originalBytes = await readFile(existing.path);
      const preserved = join(f.base, 'admitted-designs-preserved'), outside = join(f.base, 'outside-admitted-root');
      await mkdir(outside, { mode: 0o700 });
      let fakeDnsCalls = 0, fakeHttpsCalls = 0, target, trapBytes;
      dns.lookup = async () => {
        fakeDnsCalls++;
        assert.equal(fakeDnsCalls, 1);
        // Replacement occurs only inside the download's explicit await. The
        // new root has correct ownership/mode; inode identity must still fail.
        await rename(f.output, preserved);
        if (replacement === 'symlink') { await symlink(outside, f.output); target = outside; }
        else { await rename(outside, f.output); target = f.output; }
        await mkdir(join(target, 'incoming'), { mode: 0o700 });
        await writeFile(join(target, 'keep-me.txt'), 'Original boundary trap\n', { mode: 0o600 });
        for (const name of (await readdir(preserved)).filter(name => name.startsWith('work-'))) {
          const trap = join(target, name); await mkdir(trap, { mode: 0o700 });
          for (const file of ['request.json', 'input.stencil.json', 'asset-0.raster', 'image.raster', 'credit.json']) await writeFile(join(trap, file), `Keep ${file} intact\n`, { mode: 0o600 });
        }
        trapBytes = await directoryBytes(target);
        return [{ address: '8.8.8.8', family: 4 }];
      };
      https.get = (_url, _options, callback) => {
        fakeHttpsCalls++;
        const request = new EventEmitter();
        request.destroy = error => { if (error) request.emit('error', error); request.emit('close'); return request; };
        process.nextTick(() => {
          const response = new PassThrough(); response.statusCode = 200;
          response.headers = { 'content-type': 'image/png', 'content-length': String(png.length) };
          response.once('end', () => request.emit('close'));
          callback(response); response.end(png);
        });
        return request;
      };
      syncBuiltinESMExports();
      const result = operation === 'create'
        ? await f.manager.execute('stencil_create_design', { request: assetRequest({ url: 'https://example.com/fictional-tile.png' }), allowRemote: true })
        : await f.manager.execute('stencil_import_image', { design: existing.designFile, source: { url: 'https://example.com/fictional-tile.png' }, allowRemote: true });
      rejected(result, /changed|symlink|directory/i);
      assert.equal(fakeDnsCalls, 1); assert.equal(fakeHttpsCalls, 1);
      assert.deepEqual(await directoryBytes(target), trapBytes, `${operation}/${replacement} wrote outside or cleaned through the replacement root`);
      assert.deepEqual(await readFile(join(preserved, existing.designFile)), originalBytes);
      https.get = deniedGet; dns.lookup = deniedLookup; syncBuiltinESMExports();
    }
  } finally { https.get = deniedGet; dns.lookup = deniedLookup; syncBuiltinESMExports(); }
  assert.equal(networkCalls, initial);
});

test('inline images must have canonical base64 and match their declared raster type', async t => {
  const f = await fixture(t), result = await created(f);
  for (const dataUrl of ['data:image/svg+xml;base64,PHN2Zy8+', `data:image/jpeg;base64,${png.toString('base64')}`, 'data:image/png;base64,AAAA=', 'data:image/png;base64,!!!!']) rejected(await f.manager.execute('stencil_import_image', { design: result.designFile, source: { dataUrl } }), /embedded|declared type|base64|PNG/);
  await cleanWork(f);
});

test('malformed JSON, UTF-8 and native request data fail without creating a design', async t => {
  const f = await fixture(t);
  const malformed = '00000000-0000-4000-8000-000000000001.stencil.json';
  await writeFile(join(f.output, malformed), '{ incomplete', { mode: 0o600 });
  rejected(await f.manager.execute('stencil_validate_design', { design: malformed }), /JSON/);
  await writeFile(join(f.incoming, 'prediction.json'), Buffer.from([0xff, 0xfe]), { mode: 0o600 });
  rejected(await f.manager.execute('stencil_create_design', { request: assetRequest({ prediction: 'prediction.json' }), allowRemote: true }), /valid UTF-8 JSON/);
  await writeFile(join(f.incoming, 'prediction.json'), '{ malformed');
  rejected(await f.manager.execute('stencil_create_design', { request: assetRequest({ prediction: 'prediction.json' }), allowRemote: true }), /valid UTF-8 JSON/);
  const invalid = request(); invalid.pages[0].elements[0].fontSize = 99999;
  rejected(await f.manager.execute('stencil_create_design', { request: invalid }), /Font size/);
  const oversized = request(); oversized.title = 'x'.repeat(12 * 1024 * 1024 + 1);
  rejected(await f.manager.execute('stencil_create_design', { request: oversized }), /size limit/);
  assert.deepEqual((await readdir(f.output)).sort(), [malformed, 'incoming']); await cleanWork(f);
});

test('the serial busy boundary and cancellation keep outputs intact and release the tool', async t => {
  const f = await fixture(t), controller = new AbortController(); controller.abort();
  const first = f.manager.execute('stencil_create_design', { request: request() }, controller.signal);
  const second = await f.manager.execute('stencil_presets'); assert.equal(second.ok, false); assert.equal(second.code, 'busy');
  rejected(await first, /stopped|timed out/);
  assert.deepEqual((await readdir(f.output)).sort(), ['incoming']);
  assert.equal((await f.manager.execute('stencil_presets')).ok, true); await cleanWork(f);
});

test('plain JSON guards reject executable properties, exotic prototypes and unbounded values', () => {
  let getterCalls = 0;
  const accessor = {}; Object.defineProperty(accessor, 'request', { enumerable: true, get() { getterCalls++; return {}; } });
  assert.throws(() => plainTree(accessor), /accessors/); assert.equal(getterCalls, 0);
  for (const value of [Object.create(null), new Date(), { value: NaN }, { value: undefined }, { value: () => {} }, { value: Symbol('hidden') }]) assert.throws(() => plainTree(value), /ordinary|valid JSON/);
  assert.throws(() => plainTree(JSON.parse('{"__proto__":{"polluted":true}}')), /ordinary JSON fields/);
  assert.throws(() => plainTree({ body: 'x'.repeat(257) }, 256), /size limit/);
  const incomplete = []; incomplete.length = 1; incomplete.extra = true;
  assert.throws(() => plainTree(incomplete), /complete|ordinary/);
  const cyclic = {}; cyclic.self = cyclic; assert.throws(() => plainTree(cyclic), /too many/);
  assert.deepEqual(plainTree({ pages: [{ width: 1080 }], allowed: true, label: null }), { pages: [{ width: 1080 }], allowed: true, label: null });
});

test('agent identity honours explicit allowlists and rejects conflicting session identity', () => {
  const config = { allowedAgentIds: ['main', 'zeus'] };
  assert.equal(authorisedAgent(config, { agentId: 'zeus', sessionKey: 'agent:zeus:main' }), true);
  assert.equal(authorisedAgent(config, { sessionKey: 'agent:main:main' }), true);
  assert.equal(authorisedAgent(config, { agentId: 'unlisted', sessionKey: 'agent:unlisted:main' }), false);
  assert.equal(authorisedAgent(config, { agentId: 'zeus', sessionKey: 'agent:main:main' }), false);
  assert.equal(authorisedAgent({ allowedAgentIds: ['bad:id'] }, { agentId: 'bad:id' }), false);
  assert.equal(authorisedAgent(config, {}), false);
});
