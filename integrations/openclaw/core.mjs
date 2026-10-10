/** Scoped OpenClaw design tools. No shell, provider generation or arbitrary file access. */
import { constants } from 'node:fs';
import { lstat, realpath, open, mkdir, unlink, rmdir } from 'node:fs/promises';
import { resolve, dirname, basename, join, relative, sep, isAbsolute } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';

const MAX_JSON = 12 * 1024 * 1024;
const MAX_IMAGE = 6 * 1024 * 1024;
const DESIGN_NAME = /^[a-f0-9-]{36}\.stencil\.json$/;
const INPUT_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,179}$/;
const SHA = /^[a-f0-9]{40}$/;
const HASH = /^[a-f0-9]{64}$/;
const leases = new Set();
const own = value => typeof process.getuid !== 'function' || value.uid === process.getuid();
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const fail = message => { throw new Error(message); };
const inside = (root, path) => { const rel = relative(root, path); return rel === '' || !rel.startsWith(`..${sep}`) && rel !== '..' && !isAbsolute(rel); };

export function plainTree(value, maximum = MAX_JSON) {
  let size = 0, nodes = 0;
  const pending = [value];
  while (pending.length) {
    if (++nodes > 100000) fail('The tool input has too many fields.');
    const current = pending.pop();
    if (typeof current === 'string') size += Buffer.byteLength(current) + 2;
    else if (current === null || typeof current === 'boolean' || typeof current === 'number' && Number.isFinite(current)) size += 16;
    else if (current && typeof current === 'object') {
      const array = Array.isArray(current);
      if (Object.getPrototypeOf(current) !== (array ? Array.prototype : Object.prototype)) fail('Supply ordinary JSON objects and arrays.');
      const descriptors = Object.getOwnPropertyDescriptors(current);
      if (array && (current.length > 4000 || Object.keys(current).length !== current.length)) fail('Supply complete, bounded JSON arrays.');
      for (const key of Reflect.ownKeys(descriptors)) {
        if (array && key === 'length') continue;
        const field = descriptors[key];
        if (typeof key !== 'string' || !field.enumerable || !Object.hasOwn(field, 'value') || ['__proto__', 'constructor', 'prototype'].includes(key) || array && (!/^(0|[1-9]\d*)$/.test(key) || Number(key) >= current.length)) fail('Supply ordinary JSON fields without accessors.');
        size += Buffer.byteLength(key) + 4; pending.push(field.value);
      }
    } else fail('Supply valid JSON values.');
    if (size > maximum) fail('The tool input exceeds its size limit.');
  }
  return value;
}

function fields(value, allowed, required = []) {
  plainTree(value);
  if (!value || Array.isArray(value) || typeof value !== 'object' || Object.keys(value).some(key => !allowed.includes(key)) || required.some(key => !Object.hasOwn(value, key))) fail('This tool received missing or unsupported fields.');
}

async function directory(path, privateDirectory = false) {
  if (!isAbsolute(path)) fail('The plugin needs an absolute directory configured by the operator.');
  const absolute = resolve(path);
  let cursor = absolute;
  while (true) {
    const item = await lstat(cursor);
    if (item.isSymbolicLink() || !item.isDirectory()) fail('Use regular directories without symlink ancestors.');
    if (cursor === absolute && (!own(item) || privateDirectory && (item.mode & 0o077))) fail('The design directory must belong to the service user and be private.');
    const parent = dirname(cursor); if (parent === cursor) break; cursor = parent;
  }
  if (await realpath(absolute) !== absolute) fail('The configured directory changed.');
  return absolute;
}

async function readOwned(path, root, maximum) {
  if (!inside(root, path)) fail('Keep files inside the configured design directory.');
  await directory(root, true);
  await directory(dirname(path));
  const before = await lstat(path);
  if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1 || !own(before) || before.size < 1 || before.size > maximum) fail('Use a regular owned file within the size limit, without links.');
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const observed = await handle.stat();
    if (observed.ino !== before.ino || observed.dev !== before.dev || observed.nlink !== 1 || observed.size !== before.size) fail('The input file changed.');
    const chunks = [], buffer = Buffer.alloc(Math.min(64 * 1024, before.size + 1));
    let total = 0;
    while (total <= before.size) {
      const { bytesRead } = await handle.read(buffer, 0, Math.min(buffer.length, before.size + 1 - total), null);
      if (!bytesRead) break;
      total += bytesRead;
      if (total > before.size || total > maximum) fail('The input file grew while being read.');
      chunks.push(Buffer.from(buffer.subarray(0, bytesRead)));
    }
    const bytes = Buffer.concat(chunks, total);
    const after = await handle.stat();
    if (bytes.length !== before.size || after.size !== before.size || after.mtimeMs !== observed.mtimeMs || after.ctimeMs !== observed.ctimeMs) fail('The input file changed while being read.');
    return bytes;
  } finally { await handle.close(); }
}

function inputName(value) {
  if (typeof value !== 'string' || !INPUT_NAME.test(value) || value.includes('..')) fail('Use an incoming filename only, without folders or traversal.');
  return value;
}

function designName(value) {
  if (typeof value !== 'string' || !DESIGN_NAME.test(value)) fail('Use the design filename returned by a Stencil tool.');
  return value;
}

function json(bytes, name) {
  let value;
  try { value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); } catch { fail(`${name} must be valid UTF-8 JSON.`); }
  return plainTree(value);
}

export function authorisedAgent(config, context) {
  if (!config || !context) return false;
  const ids = config.allowedAgentIds ?? ['main'];
  if (!Array.isArray(ids) || ids.length < 1 || ids.length > 8 || ids.some(id => typeof id !== 'string' || !/^[A-Za-z0-9_-]{1,80}$/.test(id))) return false;
  const fromSession = typeof context.sessionKey === 'string' ? /^agent:([A-Za-z0-9_-]+):/.exec(context.sessionKey)?.[1] : undefined;
  const agent = context.agentId ?? fromSession;
  return typeof agent === 'string' && ids.includes(agent) && (!fromSession || fromSession === agent);
}

/** The manifest pins the whole installed runtime, including this plugin and bundled fonts. */
export async function verifyRuntime(runtimeRoot, config) {
  if (!SHA.test(config.releaseSha ?? '') || !HASH.test(config.manifestSha256 ?? '') || basename(runtimeRoot) !== config.releaseSha) fail('Configure the exact released runtime and manifest hashes.');
  await directory(runtimeRoot, true);
  const manifestBytes = await readOwned(join(runtimeRoot, 'runtime-public-manifest.json'), runtimeRoot, 256 * 1024);
  if (digest(manifestBytes) !== config.manifestSha256) fail('The installed runtime manifest does not match its configured hash.');
  const manifest = json(manifestBytes, 'Runtime manifest');
  if (manifest.schema !== 'stencil-public-runtime/v1' || manifest.source_head !== config.releaseSha || manifest.source_state !== 'public-release' || !Array.isArray(manifest.entries) || manifest.entries.length < 1 || manifest.entries.length > 300) fail('Use a pinned public release runtime.');
  const seen = new Set(), sources = new Map(); let total = 0;
  for (const entry of manifest.entries) {
    if (!entry || typeof entry.path !== 'string' || entry.path.startsWith('/') || entry.path.split('/').some(part => !part || part === '.' || part === '..' || part.startsWith('.')) || seen.has(entry.path) || !HASH.test(entry.sha256 ?? '') || !Number.isInteger(entry.bytes) || entry.bytes < 1 || entry.bytes > 2 * 1024 * 1024) fail('The runtime manifest contains an unsupported file.');
    seen.add(entry.path); total += entry.bytes; if (total > 8 * 1024 * 1024) fail('The installed runtime exceeds its size limit.');
    const bytes = await readOwned(join(runtimeRoot, entry.path), runtimeRoot, 2 * 1024 * 1024);
    if (bytes.length !== entry.bytes || digest(bytes) !== entry.sha256) fail('An installed runtime file does not match its pinned hash.');
    if (/\.(?:js|mjs)$/.test(entry.path)) sources.set(entry.path, bytes.toString('utf8'));
  }
  for (const path of ['package.json', 'scripts/agent-design.mjs', 'src/model.js', 'src/agent-design.js', 'src/font-loader.js', 'schemas/design-request.schema.json', 'integrations/openclaw/index.mjs', 'integrations/openclaw/core.mjs', 'integrations/openclaw/schemas.mjs', 'integrations/openclaw/openclaw.plugin.json', 'integrations/openclaw/package.json']) if (!seen.has(path)) fail('The runtime manifest is missing a required source file.');
  // Every literal local module dependency must itself be checked, even when an
  // incomplete operator manifest leaves an unlisted file on disk.
  for (const [path, source] of sources) {
    for (const match of source.matchAll(/(?:from\s*|import\s*\()\s*(['"])(\.[^'"]+)\1/g)) {
      const dependency = relative(runtimeRoot, resolve(runtimeRoot, dirname(path), match[2])).split(sep).join('/');
      if (!seen.has(dependency)) fail('The runtime manifest omits a local module dependency.');
    }
  }
  for (const match of (sources.get('src/font-catalogue.js') ?? '').matchAll(/"(?:path|noticePath)"\s*:\s*"(fonts\/[^"]+)"/g)) if (!seen.has(`public/${match[1]}`)) fail('The runtime manifest omits a bundled font or its licence.');
  return manifest;
}

async function identity(path) {
  await directory(path, true);
  const item = await lstat(path);
  return { ino: item.ino, dev: item.dev };
}

async function unchanged(path, expected) {
  const observed = await identity(path);
  if (!expected || observed.ino !== expected.ino || observed.dev !== expected.dev) fail('A configured design directory changed during this operation.');
}

export function createManager(runtimeRoot, config) {
  fields(config, ['releaseSha', 'manifestSha256', 'outputDirectory', 'allowedAgentIds'], ['releaseSha', 'manifestSha256', 'outputDirectory']);
  const output = resolve(config.outputDirectory ?? '');
  if (!isAbsolute(config.outputDirectory ?? '') || inside(runtimeRoot, output) || inside(output, runtimeRoot)) fail('Choose a separate absolute design output directory.');
  const incoming = join(output, 'incoming');
  async function execute(name, parameters = {}, callerSignal) {
    if (leases.has(output)) return { ok: false, code: 'busy', message: 'A Stencil tool is still working. Retry after it finishes.' };
    leases.add(output); let work, outputIdentity, incomingIdentity, workIdentity, staged = [];
    try {
      plainTree(parameters);
      outputIdentity = await identity(output); incomingIdentity = await identity(incoming);
      await verifyRuntime(runtimeRoot, config);
      const signal = callerSignal ? AbortSignal.any([callerSignal, AbortSignal.timeout(45000)]) : AbortSignal.timeout(45000);
      signal.throwIfAborted();
      const cli = await import(pathToFileURL(join(runtimeRoot, 'scripts/agent-design.mjs')).href);
      const helpers = await import(pathToFileURL(join(runtimeRoot, 'src/agent-design.js')).href);
      const model = await import(pathToFileURL(join(runtimeRoot, 'src/model.js')).href);
      async function guard() {
        signal.throwIfAborted();
        await unchanged(output, outputIdentity); await unchanged(incoming, incomingIdentity);
        if (work) await unchanged(work, workIdentity);
      }
      const run = async args => { await guard(); return cli.runAgentCLI(args, { signal }); };
      if (name === 'stencil_presets') { fields(parameters, []); return { ...await run(['presets']), releaseSha: config.releaseSha }; }
      await guard(); work = join(output, `work-${randomUUID()}`); await mkdir(work, { mode: 0o700 }); workIdentity = await identity(work);
      async function stage(filename, bytes) {
        await guard();
        const path = join(work, filename), handle = await open(path, 'wx', 0o600);
        staged.push(path);
        try { await guard(); await handle.writeFile(bytes, { signal }); await handle.sync(); } finally { await handle.close(); }
        return path;
      }
      async function incomingBytes(filename, maximum) { await guard(); return readOwned(join(incoming, inputName(filename)), incoming, maximum); }
      async function snapshotDesign(filename) {
        const bytes = await readOwned(join(output, designName(filename)), output, MAX_JSON);
        const document = model.parseDocument(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
        return { path: await stage('input.stencil.json', bytes), document };
      }
      function remoteGate() { if (parameters.allowRemote !== true) fail('Remote import needs allowRemote: true. No download was started.'); }
      function remoteOption() { if (parameters.allowRemote !== undefined && typeof parameters.allowRemote !== 'boolean') fail('allowRemote must be a boolean.'); }
      async function remoteSnapshot(url, filename) {
        remoteGate();
        if (typeof url !== 'string' || url.length > 4000) fail('Supply an existing HTTPS image output URL.');
        const bytes = await cli.downloadImage(url, { signal });
        helpers.imageAssetFromBytes(bytes);
        return stage(filename, bytes);
      }
      function result(value, design) { return { ...value, ...(design ? { designFile: design, path: join(output, design) } : {}), releaseSha: config.releaseSha }; }
      if (name === 'stencil_create_design') {
        fields(parameters, ['request', 'allowRemote'], ['request']);
        remoteOption();
        const request = helpers.validateAgentRequest(parameters.request);
        if (request.assets?.some(asset => asset.url !== undefined || asset.prediction !== undefined)) remoteGate();
        for (let i = 0; i < (request.assets ?? []).length; i++) {
          const asset = request.assets[i];
          if (asset.file !== undefined) asset.file = await stage(`asset-${i}.raster`, await incomingBytes(asset.file, MAX_IMAGE));
          if (asset.prediction !== undefined) {
            const prediction = json(await incomingBytes(asset.prediction, 1024 * 1024), 'Prediction');
            asset.url = helpers.predictionImageURL(prediction, asset.outputIndex ?? 0); delete asset.prediction; delete asset.outputIndex;
          }
          if (asset.url !== undefined) { asset.file = await remoteSnapshot(asset.url, `asset-${i}.raster`); delete asset.url; }
          if (asset.credit) asset.credit = helpers.sanitiseAgentCredit(asset.credit);
        }
        const requestPath = await stage('request.json', `${JSON.stringify(request)}\n`), design = `${randomUUID()}.stencil.json`;
        return result(await run(['create', '--request', requestPath, '--output', join(output, design)]), design);
      }
      if (name === 'stencil_validate_design') {
        fields(parameters, ['design'], ['design']); return result(await run(['validate', '--input', (await snapshotDesign(parameters.design)).path]), parameters.design);
      }
      if (name === 'stencil_import_image') {
        fields(parameters, ['design', 'source', 'allowRemote', 'page', 'x', 'y', 'width', 'height', 'credit'], ['design', 'source']);
        fields(parameters.source, ['file', 'dataUrl', 'url', 'prediction', 'outputIndex']);
        remoteOption();
        const source = parameters.source;
        if (['file', 'dataUrl', 'url', 'prediction'].filter(key => Object.hasOwn(source, key)).length !== 1 || Object.hasOwn(source, 'outputIndex') && !Object.hasOwn(source, 'prediction')) fail('Supply exactly one image source. outputIndex is for predictions only.');
        const snapshot = await snapshotDesign(parameters.design), design = `${randomUUID()}.stencil.json`;
        const pageIndex = (parameters.page ?? 1) - 1;
        if (!Number.isInteger(pageIndex) || pageIndex < 0 || pageIndex >= snapshot.document.pages.length) fail('Choose a page number in this design, starting at 1.');
        const geometry = {};
        for (const key of ['x', 'y', 'width', 'height']) if (parameters[key] !== undefined) { if (typeof parameters[key] !== 'number' || !Number.isFinite(parameters[key])) fail('Image placement must use finite numbers.'); geometry[key] = parameters[key]; }
        const credit = helpers.sanitiseAgentCredit(parameters.credit ?? null), preflight = structuredClone(snapshot.document);
        preflight.pages[pageIndex].elements.push(model.createElement('image', { src: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGPQ8HP7DwADGgG8pjyfTwAAAABJRU5ErkJggg==', sourceWidth: 1, sourceHeight: 1, credit, ...geometry }));
        model.validateDocument(preflight);
        const args = ['import', '--input', snapshot.path, '--output', join(output, design)];
        if (source.file !== undefined) args.push('--image', await stage('image.raster', await incomingBytes(source.file, MAX_IMAGE)));
        else if (source.dataUrl !== undefined) {
          if (typeof source.dataUrl !== 'string' || source.dataUrl.length > Math.ceil(MAX_IMAGE / 3) * 4 + 50 || !/^data:image\/(?:png|jpeg|webp|gif);base64,[A-Za-z0-9+/]+={0,2}$/.test(source.dataUrl)) fail('Supply an embedded PNG, JPEG, WebP or GIF up to 6 MiB.');
          const encoded = source.dataUrl.slice(source.dataUrl.indexOf(',') + 1), bytes = Buffer.from(encoded, 'base64');
          if (bytes.toString('base64') !== encoded) fail('The embedded image uses invalid base64.');
          const imported = helpers.imageAssetFromBytes(bytes);
          if (imported.src.slice(0, imported.src.indexOf(';')) !== source.dataUrl.slice(0, source.dataUrl.indexOf(';'))) fail('The embedded image does not match its declared type.');
          args.push('--image', await stage('image.raster', bytes));
        } else {
          remoteGate();
          if (source.prediction !== undefined) plainTree(source.prediction, 1024 * 1024);
          const url = source.prediction !== undefined ? helpers.predictionImageURL(source.prediction, source.outputIndex ?? 0) : source.url;
          args.push('--image', await remoteSnapshot(url, 'image.raster'));
        }
        for (const key of ['page', 'x', 'y', 'width', 'height']) if (parameters[key] !== undefined) { if (typeof parameters[key] !== 'number' || !Number.isFinite(parameters[key])) fail('Image placement must use finite numbers.'); args.push(`--${key}`, String(parameters[key])); }
        if (parameters.credit !== undefined) args.push('--credit', await stage('credit.json', JSON.stringify(credit)));
        return result(await run(args), design);
      }
      if (name === 'stencil_export_svg') {
        fields(parameters, ['design'], ['design']);
        const folder = `artwork-${randomUUID()}`;
        return result(await run(['export', '--input', (await snapshotDesign(parameters.design)).path, '--format', 'svg', '--outdir', join(output, folder)]));
      }
      fail('Choose one of the registered Stencil tools.');
    } catch (error) {
      const message = error?.name === 'AbortError' || error?.name === 'TimeoutError' ? 'The Stencil operation stopped or timed out.' : ['ENOENT', 'EACCES', 'ENOTDIR', 'ELOOP'].includes(error?.code) ? 'A configured directory or incoming file is unavailable. Check the owned directories and incoming filename.' : String(error?.message ?? 'Stencil could not complete this operation.').replace(/https?:\/\/\S+/gi, '[remote image URL]').slice(0, 400);
      return { ok: false, code: 'stencil-operation-failed', message };
    } finally {
      // A replacement path must never direct cleanup into another directory.
      let cleanupSafe = false;
      if (work && outputIdentity && incomingIdentity && workIdentity) {
        try { await unchanged(output, outputIdentity); await unchanged(incoming, incomingIdentity); await unchanged(work, workIdentity); cleanupSafe = true; } catch {}
      }
      if (cleanupSafe) { for (const path of staged) await unlink(path).catch(() => {}); await rmdir(work).catch(() => {}); }
      leases.delete(output);
    }
  }
  return { execute };
}
