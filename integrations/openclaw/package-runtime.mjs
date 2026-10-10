#!/usr/bin/env node
/** Export public Git blobs only. Never reads workspace credentials, dependencies or designs. */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstatSync, realpathSync, mkdirSync, openSync, writeFileSync, closeSync, unlinkSync, rmdirSync } from 'node:fs';
import { resolve, dirname, basename, join, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const project = fileURLToPath(new URL('../../', import.meta.url));
const SHA = /^[a-f0-9]{40}$/;
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const fail = message => { throw new Error(message); };
const git = args => execFileSync('git', ['-C', project, ...args], { encoding: null, maxBuffer: 12 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
function regularParent(path) {
  let cursor = path;
  while (true) {
    const item = lstatSync(cursor);
    if (!item.isDirectory() || item.isSymbolicLink()) fail('Use regular output parent directories without symlink ancestors.');
    if (cursor === path && (typeof process.getuid === 'function' && item.uid !== process.getuid() || item.mode & 0o077)) fail('The output parent must be private and belong to this user.');
    const parent = dirname(cursor); if (parent === cursor) break; cursor = parent;
  }
  if (realpathSync(path) !== path) fail('The output parent changed.');
}

export function packageRuntime({ revision, output }) {
  if (!SHA.test(revision ?? '')) fail('Use the full 40-character public released Git commit SHA.');
  if (!isAbsolute(output ?? '') || basename(output) !== revision) fail('Use a new absolute output directory whose final name equals the release SHA.');
  const destination = resolve(output), parent = dirname(destination);
  regularParent(parent);
  const resolved = git(['rev-parse', '--verify', `${revision}^{commit}`]).toString('utf8').trim();
  if (resolved !== revision) fail('The selected commit is unavailable. Fetch the published release first.');
  const catalogue = new Map();
  for (const line of git(['ls-tree', '-r', '-z', revision]).toString('utf8').split('\0').filter(Boolean)) {
    const match = /^(\d+) blob ([a-f0-9]{40})\t(.+)$/.exec(line);
    if (match) catalogue.set(match[3], { mode: match[1], oid: match[2] });
  }
  const fixed = [
    'package.json', 'LICENSE', 'README.md', 'scripts/agent-design.mjs',
    'docs/agent-design.md', 'schemas/design-request.schema.json',
    'integrations/openclaw/index.mjs', 'integrations/openclaw/core.mjs', 'integrations/openclaw/schemas.mjs',
    'integrations/openclaw/openclaw.plugin.json', 'integrations/openclaw/package.json', 'integrations/openclaw/design-request.schema.json',
    'integrations/openclaw/package-runtime.mjs', 'integrations/openclaw/README.md',
  ];
  const paths = [...new Set([...fixed, ...catalogue.keys()].filter(path => fixed.includes(path) || /^src\/[^/]+\.(?:js|mjs)$/.test(path) || /^public\/fonts\/[^/]+\.(?:woff2|txt|json)$/.test(path) || /^examples\/agent-design\/[^/]+\.json$/.test(path)))].sort();
  if (paths.length > 300) fail('The public runtime has too many files.');
  const blobs = [], entries = []; let total = 0;
  for (const path of paths) {
    const item = catalogue.get(path);
    if (!item || !['100644', '100755'].includes(item.mode) || path.split('/').some(part => !part || part.startsWith('.'))) fail(`The released public source is missing a regular file: ${path}`);
    const bytes = git(['cat-file', 'blob', item.oid]);
    if (!bytes.length || bytes.length > 2 * 1024 * 1024 || (total += bytes.length) > 8 * 1024 * 1024) fail('The public runtime exceeds its size limit.');
    blobs.push({ path, bytes }); entries.push({ path, bytes: bytes.length, sha256: digest(bytes) });
  }
  const authoringSchema = blobs.find(item => item.path === 'schemas/design-request.schema.json')?.bytes;
  const pluginSchema = blobs.find(item => item.path === 'integrations/openclaw/design-request.schema.json')?.bytes;
  if (!authoringSchema?.equals(pluginSchema)) fail('The plugin authoring schema must exactly match the released runtime schema.');
  const manifestBytes = Buffer.from(`${JSON.stringify({ schema: 'stencil-public-runtime/v1', source_head: revision, source_state: 'public-release', entries }, null, 2)}\n`);
  if (manifestBytes.length > 256 * 1024) fail('The runtime manifest exceeds its size limit.');
  // A new runtime only: exclusive files, never merge with an existing installation.
  const files = [], directories = [];
  mkdirSync(destination, { mode: 0o700 }); directories.push(destination);
  try {
    for (const { path, bytes } of [...blobs, { path: 'runtime-public-manifest.json', bytes: manifestBytes }]) {
      const target = join(destination, path);
      const chain = []; let cursor = dirname(target);
      while (cursor !== destination) { chain.unshift(cursor); cursor = dirname(cursor); }
      for (const directory of chain) if (!directories.includes(directory)) { mkdirSync(directory, { mode: 0o700 }); directories.push(directory); }
      const fd = openSync(target, 'wx', 0o600); files.push(target);
      try { writeFileSync(fd, bytes); } finally { closeSync(fd); }
    }
    return { ok: true, releaseSha: revision, manifestSha256: digest(manifestBytes), runtimeDirectory: destination, pluginDirectory: join(destination, 'integrations/openclaw'), files: entries.length, bytes: total };
  } catch (error) {
    for (const path of files.reverse()) { try { unlinkSync(path); } catch {} }
    for (const path of directories.reverse()) { try { rmdirSync(path); } catch {} }
    throw error;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const { values, positionals } = parseArgs({ args: process.argv.slice(2), strict: true, allowPositionals: true, options: { revision: { type: 'string' }, output: { type: 'string' }, help: { type: 'boolean' } } });
    if (values.help) process.stdout.write('Usage: node integrations/openclaw/package-runtime.mjs --revision <public-release-commit-sha> --output <new-absolute-directory-ending-in-that-sha>\n');
    else { if (positionals.length) fail('Use the documented named options.'); process.stdout.write(`${JSON.stringify(packageRuntime(values), null, 2)}\n`); }
  } catch (error) { process.stderr.write(`${error instanceof Error ? error.message : 'Could not package this public release.'}\n`); process.exitCode = 1; }
}
