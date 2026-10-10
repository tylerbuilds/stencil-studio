/** Public blob packaging in fictional, isolated Git repositories. No remote or browser. */
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, writeFile, readdir, realpath, rm, chmod, symlink, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFileSync, spawnSync } from 'node:child_process';
import https from 'node:https';
import dns from 'node:dns/promises';
import { syncBuiltinESMExports } from 'node:module';

const project = fileURLToPath(new URL('../../../', import.meta.url));
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
let networkCalls = 0;
const originalGet = https.get, originalLookup = dns.lookup;
https.get = () => { networkCalls++; throw new Error('Packaging qualification must not request HTTPS.'); };
dns.lookup = () => { networkCalls++; throw new Error('Packaging qualification must not resolve DNS.'); };
syncBuiltinESMExports();
after(() => { https.get = originalGet; dns.lookup = originalLookup; syncBuiltinESMExports(); assert.equal(networkCalls, 0); });

// No operator Git configuration, inherited repository override, signing or
// hooks may participate in these disposable local commits.
const gitEnvironment = { ...process.env };
for (const key of Object.keys(gitEnvironment)) if (key.startsWith('GIT_')) delete gitEnvironment[key];
Object.assign(gitEnvironment, { GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null' });

async function fixture(t) {
  const base = await mkdtemp(join(await realpath(tmpdir()), 'stencil-public-packager-'));
  t.after(() => rm(base, { recursive: true, force: true }));
  const repository = join(base, 'fictional-public-source'), parent = join(base, 'private-runtimes');
  await mkdir(repository, { mode: 0o700 }); await mkdir(parent, { mode: 0o700 });
  const files = ['package.json', 'LICENSE', 'README.md', 'scripts/agent-design.mjs', 'docs/agent-design.md', 'schemas/design-request.schema.json', 'integrations/openclaw/README.md'];
  for (const folder of ['src', 'integrations/openclaw']) {
    for (const entry of await readdir(join(project, folder), { withFileTypes: true })) if (entry.isFile() && /\.(?:js|mjs|json)$/.test(entry.name)) files.push(`${folder}/${entry.name}`);
  }
  for (const folder of ['public/fonts', 'examples/agent-design']) {
    for (const entry of await readdir(join(project, folder), { withFileTypes: true })) if (entry.isFile() && /\.(?:woff2|txt|json)$/.test(entry.name)) files.push(`${folder}/${entry.name}`);
  }
  for (const file of files) {
    await mkdir(dirname(join(repository, file)), { recursive: true, mode: 0o700 });
    await writeFile(join(repository, file), await readFile(join(project, file)), { flag: 'wx', mode: 0o600 });
  }
  function git(args) {
    return execFileSync('git', ['-C', repository, '-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false', '-c', 'user.name=Fictional Stencil Test', '-c', 'user.email=stencil-test@example.invalid', ...args], { env: gitEnvironment, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 10000, maxBuffer: 4 * 1024 * 1024 });
  }
  git(['init', '--initial-branch=main']); git(['add', '--', ...files]); git(['commit', '-m', 'Fictional public runtime fixture']);
  const revision = git(['rev-parse', 'HEAD']).trim(); assert.match(revision, /^[a-f0-9]{40}$/);
  const builder = join(repository, 'integrations/openclaw/package-runtime.mjs');
  function packageAt(revisionToUse = revision, output = join(parent, revisionToUse), success = true) {
    const result = spawnSync(process.execPath, [builder, '--revision', revisionToUse, '--output', output], { cwd: repository, env: gitEnvironment, encoding: 'utf8', timeout: 15000, maxBuffer: 2 * 1024 * 1024 });
    assert.equal(result.error, undefined); assert.equal(result.signal, null);
    assert.equal(result.status, success ? 0 : 1, result.stderr);
    if (success) { assert.equal(result.stderr, ''); const value = JSON.parse(result.stdout); assert.equal(value.ok, true); return value; }
    assert.equal(result.stdout, ''); return result.stderr;
  }
  return { base, repository, parent, revision, git, packageAt };
}

async function filesAndHashes(directory) {
  const result = {};
  async function walk(current, prefix = '') {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const path = `${prefix}${entry.name}`;
      if (entry.isDirectory()) await walk(join(current, entry.name), `${path}/`);
      else { assert.equal(entry.isFile(), true); result[path] = digest(await readFile(join(current, entry.name))); }
    }
  }
  await walk(directory); return result;
}

test('exact Git blobs form a verified private runtime despite dirty source and a private sentinel', async t => {
  const f = await fixture(t), modelBefore = await readFile(join(f.repository, 'src/model.js'));
  const sentinel = 'FICTIONAL_PRIVATE_SENTINEL=never-copy-this-fixture-value';
  await writeFile(join(f.repository, 'src/model.js'), '// Dirty working tree substitution; not a released Git blob.\n');
  await writeFile(join(f.repository, '.env'), sentinel, { mode: 0o600 });
  await mkdir(join(f.repository, 'node_modules'), { mode: 0o700 });
  await writeFile(join(f.repository, 'node_modules/private-fixture.txt'), sentinel, { mode: 0o600 });
  const packaged = f.packageAt();
  assert.equal(packaged.releaseSha, f.revision); assert.equal(packaged.runtimeDirectory, join(f.parent, f.revision));
  assert.equal((await stat(packaged.runtimeDirectory)).mode & 0o077, 0);
  assert.deepEqual(await readFile(join(packaged.runtimeDirectory, 'src/model.js')), modelBefore);
  const installed = await filesAndHashes(packaged.runtimeDirectory);
  assert.equal(Object.keys(installed).some(path => path === '.env' || path.startsWith('node_modules/')), false);
  for (const path of Object.keys(installed)) assert.equal((await readFile(join(packaged.runtimeDirectory, path))).includes(Buffer.from(sentinel)), false);
  const manifestBytes = await readFile(join(packaged.runtimeDirectory, 'runtime-public-manifest.json'));
  assert.equal(digest(manifestBytes), packaged.manifestSha256);
  const output = join(f.base, 'editable-designs'); await mkdir(output, { mode: 0o700 }); await mkdir(join(output, 'incoming'), { mode: 0o700 });
  const { verifyRuntime, createManager } = await import(pathToFileURL(join(packaged.runtimeDirectory, 'integrations/openclaw/core.mjs')).href);
  const config = { releaseSha: f.revision, manifestSha256: packaged.manifestSha256, outputDirectory: output };
  const manifest = await verifyRuntime(packaged.runtimeDirectory, config);
  assert.equal(manifest.entries.length, packaged.files); assert.equal(manifest.source_state, 'public-release');
  const manager = createManager(packaged.runtimeDirectory, config);
  const request = JSON.parse(await readFile(join(packaged.runtimeDirectory, 'examples/agent-design/social-post.json'), 'utf8'));
  const created = await manager.execute('stencil_create_design', { request }); assert.equal(created.ok, true, created.message);
  const saved = JSON.parse(await readFile(created.path, 'utf8')); assert.equal(saved.schema, 'stencil-studio'); assert.ok(saved.pages[0].elements.some(layer => layer.type === 'text'));
  const exported = await manager.execute('stencil_export_svg', { design: created.designFile }); assert.equal(exported.ok, true, exported.message);
  const svg = await readFile(join(exported.output, 'page-01.svg'), 'utf8'); assert.match(svg, /A good book/); assert.match(svg, /data:font\/woff2;base64,/);
  assert.equal(f.git(['status', '--porcelain']).includes(' M src/model.js'), true);
});

test('a repeated installation cannot replace or modify an existing runtime', async t => {
  const f = await fixture(t), packaged = f.packageAt(), before = await filesAndHashes(packaged.runtimeDirectory);
  assert.match(f.packageAt(f.revision, packaged.runtimeDirectory, false), /EEXIST|already exists/);
  assert.deepEqual(await filesAndHashes(packaged.runtimeDirectory), before);
});

test('malformed revisions, public parents and symlink ancestors cannot admit an output', async t => {
  const f = await fixture(t);
  for (const revision of ['main', 'abc', 'A'.repeat(40), `${f.revision};touch-pwned`]) assert.match(f.packageAt(revision, join(f.parent, 'rejected-output'), false), /40-character/);
  assert.match(f.packageAt(f.revision, join(f.parent, 'wrong-name'), false), /final name/);
  await chmod(f.parent, 0o755); assert.match(f.packageAt(f.revision, join(f.parent, f.revision), false), /private/); await chmod(f.parent, 0o700);
  const alias = join(f.base, 'parent-alias'); await symlink(f.parent, alias);
  assert.match(f.packageAt(f.revision, join(alias, f.revision), false), /symlink ancestors/);
  const nested = join(f.parent, 'nested'); await mkdir(nested, { mode: 0o700 });
  assert.match(f.packageAt(f.revision, join(alias, 'nested', f.revision), false), /symlink ancestors/);
  assert.deepEqual(await readdir(f.parent), ['nested']); assert.deepEqual(await readdir(nested), []);
});

test('a committed revision missing a required public file creates no runtime or partial output', async t => {
  const f = await fixture(t), missing = 'schemas/design-request.schema.json';
  await rm(join(f.repository, missing)); f.git(['add', '--', missing]); f.git(['commit', '-m', 'Fictional incomplete public source']);
  const revision = f.git(['rev-parse', 'HEAD']).trim();
  assert.match(f.packageAt(revision, join(f.parent, revision), false), /missing a regular file: schemas\/design-request\.schema\.json/);
  assert.deepEqual(await readdir(f.parent), []);
});
