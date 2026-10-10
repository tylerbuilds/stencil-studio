#!/usr/bin/env node
/** Explicit local CLI. No provider calls, runtime credentials or browser storage. */
import { stat, mkdir, unlink, rmdir, open, link } from 'node:fs/promises';
import { randomUUID, createHash } from 'node:crypto';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { get } from 'node:https';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { parseArgs } from 'node:util';
import { PRESETS, TEMPLATES, parseDocument, serialiseDocument, validateDocument, createElement, pageSVG, MAX_DOCUMENT_BYTES } from '../src/model.js';
import { buildAgentDesign, validateAgentRequest, imageAssetFromBytes, predictionImageURL, sanitiseAgentCredit } from '../src/agent-design.js';
import { documentFontFamilies } from '../src/font-loader.js';
import { MAX_IMAGE_BYTES } from '../src/browser-intake.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const fail = message => { throw new Error(message); };
const help = `Stencil agent design CLI — Node 22.19+ or 24.11+

  presets
  create --request request.json --output design.stencil.json [--allow-remote] [--dry-run]
  validate --input design.stencil.json
  import --input design.stencil.json --image image.png --output updated.stencil.json
  import --input design.stencil.json --url HTTPS --allow-remote --output updated.stencil.json
  import --input design.stencil.json --prediction prediction.json --allow-remote --output updated.stencil.json
  export --input design.stencil.json --format svg --outdir new-folder
  export --input design.stencil.json --format png|jpeg --outdir new-folder [--browser /path/to/chrome]

Import options: --page 1 --x 0 --y 0 --width 640 --height 640 --output-index 0 --credit credit.json
PNG/JPEG need the existing development Playwright package (npm ci). SVG needs no packages.
Downloads need --allow-remote; supplied URLs are fetched, not generator APIs.
Output files/folders must be new; existing work is never overwritten.
Results and errors are JSON. See docs/agent-design.md and schemas/design-request.schema.json.
`;
const optionSpecs = {
  help: { type: 'boolean', short: 'h' }, request: { type: 'string' }, input: { type: 'string' }, output: { type: 'string' }, image: { type: 'string' },
  url: { type: 'string' }, prediction: { type: 'string' }, 'allow-remote': { type: 'boolean' }, 'dry-run': { type: 'boolean' },
  'output-index': { type: 'string' }, credit: { type: 'string' }, page: { type: 'string' }, x: { type: 'string' }, y: { type: 'string' }, width: { type: 'string' }, height: { type: 'string' },
  format: { type: 'string' }, outdir: { type: 'string' }, browser: { type: 'string' },
};
const allowed = {
  presets: [], create: ['request', 'output', 'allow-remote', 'dry-run'], validate: ['input'],
  import: ['input', 'output', 'image', 'url', 'prediction', 'allow-remote', 'dry-run', 'output-index', 'credit', 'page', 'x', 'y', 'width', 'height'],
  export: ['input', 'format', 'outdir', 'browser', 'dry-run'],
};
async function bytesFromFile(path, maximum, name) {
  const handle = await open(path, 'r');
  try {
    const details = await handle.stat();
    if (!details.isFile() || details.size < 1 || details.size > maximum) fail(`${name} must be a non-empty file up to ${Math.floor(maximum / 1024 / 1024)} MiB.`);
    // Read the same descriptor into a bounded buffer, including one sentinel
    // byte. Replacing a path or growing its contents cannot force readFile to
    // allocate an arbitrarily large file between a stat and the read.
    const bytes = Buffer.alloc(details.size + 1); let length = 0;
    while (length < bytes.length) { const { bytesRead } = await handle.read(bytes, length, bytes.length - length, null); if (!bytesRead) break; length += bytesRead; }
    const after = await handle.stat();
    if (length !== details.size || after.size !== details.size || after.mtimeMs !== details.mtimeMs) fail(`${name} changed while being read or exceeds its size limit.`);
    return bytes.subarray(0, length);
  } finally { await handle.close(); }
}
async function jsonFromFile(path, maximum, name) {
  let text; try { text = new TextDecoder('utf-8', { fatal: true }).decode(await bytesFromFile(path, maximum, name)); } catch (error) { if (error instanceof TypeError) fail(`${name} must use valid UTF-8.`); throw error; }
  try { return JSON.parse(text); } catch { fail(`${name} is not valid JSON.`); }
}
async function documentFromFile(path) {
  const bytes = await bytesFromFile(path, MAX_DOCUMENT_BYTES, 'Design');
  let text; try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { fail('Design JSON must use valid UTF-8.'); }
  return parseDocument(text);
}
export function publicAddress(address) {
  const family = isIP(address);
  if (family === 4) {
    const [a, b, c] = address.split('.').map(Number);
    return !(a === 0 || a === 10 || a === 127 || a >= 224 || a === 169 && b === 254 || a === 172 && b >= 16 && b <= 31 || a === 192 && b === 168 || a === 100 && b >= 64 && b <= 127 || a === 198 && [18, 19].includes(b) || a === 192 && b === 0 || a === 192 && b === 2 || a === 198 && b === 51 && c === 100 || a === 203 && b === 0 && c === 113);
  }
  // Only global unicast; reject documentation, mapped/transition and local ranges.
  return family === 6 && /^[23][0-9a-f]{3}:/i.test(address) && !/^2001:(?:0?db8|0{1,4}):/i.test(address) && !/^2002:/i.test(address);
}
export function checkedRemoteURL(value) {
  let url; try { url = new URL(value); } catch { fail('Use an HTTPS image URL.'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.port && url.port !== '443') fail('Use an HTTPS image URL without credentials, on port 443.');
  if (url.hash) url.hash = '';
  if (url.hostname.length > 253 || ['localhost', 'localhost.localdomain'].includes(url.hostname.toLowerCase()) || /\.(?:localhost|local|internal)$/i.test(url.hostname)) fail('Remote import needs a public HTTPS host.');
  return url;
}
/** DNS answers are checked, then pinned into the TLS request; every redirect repeats this. */
export async function downloadImage(source, { resolveHost = lookup, request = get, signal } = {}) {
  signal?.throwIfAborted();
  let current = checkedRemoteURL(source);
  const deadline = Date.now() + 30000;
  for (let redirects = 0; redirects <= 3; redirects++) {
    const hostname = current.hostname.replace(/^\[|\]$/g, '');
    let timer, abort;
    const records = isIP(hostname) ? [{ address: hostname, family: isIP(hostname) }] : await Promise.race([
      resolveHost(hostname, { all: true, verbatim: true }),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Image host lookup timed out.')), Math.max(1, deadline - Date.now())); timer.unref?.(); abort = () => reject(new Error('Image download cancelled.')); signal?.addEventListener('abort', abort, { once: true }); }),
    ]).finally(() => { clearTimeout(timer); if (abort) signal?.removeEventListener('abort', abort); });
    signal?.throwIfAborted();
    if (!Array.isArray(records) || !records.length || records.some(record => !publicAddress(record.address))) fail('Remote import needs a public HTTPS address; local and private networks are blocked.');
    const pinned = records[0];
    const result = await new Promise((resolveDownload, reject) => {
      const timeout = Math.max(1, deadline - Date.now());
      const req = request(current, { lookup: (_hostname, options, callback) => options.all ? callback(null, [pinned]) : callback(null, pinned.address, pinned.family), headers: { Accept: 'image/png,image/jpeg,image/webp,image/gif', 'User-Agent': 'Stencil-Studio-Agent-Import/1' }, timeout }, response => {
        if ([301, 302, 303, 307, 308].includes(response.statusCode)) { const location = response.headers.location; response.destroy(); if (!location) reject(new Error('Image redirect has no destination.')); else resolveDownload({ location }); return; }
        if (response.statusCode !== 200) { response.destroy(); reject(new Error(`Image download returned HTTP ${response.statusCode}. The provider URL may have expired.`)); return; }
        const declared = response.headers['content-length'];
        if (declared !== undefined && (!/^\d+$/.test(declared) || Number(declared) > MAX_IMAGE_BYTES)) { response.destroy(); reject(new Error('Remote image exceeds the 6 MiB limit.')); return; }
        const chunks = []; let size = 0;
        response.on('data', chunk => { size += chunk.length; if (size > MAX_IMAGE_BYTES) { response.destroy(); reject(new Error('Remote image exceeds the 6 MiB limit.')); } else chunks.push(chunk); });
        response.on('end', () => resolveDownload({ bytes: Buffer.concat(chunks), type: response.headers['content-type']?.split(';')[0].trim().toLowerCase() }));
        response.on('aborted', () => reject(new Error('Image download stopped before completion.')));
        response.on('error', () => reject(new Error('Image download failed.')));
      });
      const timer = setTimeout(() => req.destroy(new Error('Image download timed out.')), timeout); timer.unref?.();
      const abort = () => req.destroy(new Error('Image download cancelled.')); signal?.addEventListener('abort', abort, { once: true });
      req.on('close', () => { clearTimeout(timer); signal?.removeEventListener('abort', abort); });
      req.on('timeout', () => req.destroy(new Error('Image download timed out.')));
      req.on('error', () => reject(new Error('Image download failed or timed out.')));
    });
    if (result.location !== undefined) {
      if (!result.location || redirects === 3) fail('Image download has too many or invalid redirects.');
      current = checkedRemoteURL(new URL(result.location, current).href); continue;
    }
    const asset = imageAssetFromBytes(result.bytes);
    if (result.type && !['application/octet-stream', asset.src.slice(5, asset.src.indexOf(';'))].includes(result.type)) fail('The downloaded image does not match its declared file type.');
    return result.bytes;
  }
  fail('Image download failed.');
}
async function resolveAsset(asset, base, allowRemote, signal) {
  signal?.throwIfAborted();
  const credit = sanitiseAgentCredit(asset.credit ?? null);
  let bytes;
  if (asset.file !== undefined) bytes = await bytesFromFile(resolve(base, asset.file), MAX_IMAGE_BYTES, 'Image');
  else {
    if (!allowRemote) fail('Remote assets need --allow-remote. No download was started.');
    const url = asset.prediction !== undefined ? predictionImageURL(await jsonFromFile(resolve(base, asset.prediction), 1024 * 1024, 'Prediction'), asset.outputIndex ?? 0) : asset.url;
    bytes = await downloadImage(url, { signal });
  }
  signal?.throwIfAborted();
  return imageAssetFromBytes(bytes, credit);
}
async function saveNew(path, data) {
  const output = resolve(path), temporary = join(dirname(output), `.stencil-${randomUUID()}.tmp`);
  let created = false;
  try { const handle = await open(temporary, 'wx', 0o600); created = true; try { await handle.writeFile(data); await handle.sync(); } finally { await handle.close(); } await link(temporary, output); }
  catch (error) { if (error.code === 'EEXIST') fail('Output already exists. Choose a new filename; existing work was kept.'); throw error; }
  finally { if (created) await unlink(temporary).catch(() => {}); }
  return output;
}
const required = (options, key) => { if (!options[key]) fail(`Supply --${key}.`); return options[key]; };
async function newOutput(path) {
  try { await stat(resolve(path)); fail('Output already exists. Choose a new filename; existing work was kept.'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
}
function numberOption(options, key, fallback) {
  if (options[key] === undefined) return fallback;
  if (!/^-?(?:\d+\.?\d*|\.\d+)$/.test(options[key]) || !Number.isFinite(Number(options[key]))) fail(`--${key} must be a finite number.`);
  return Number(options[key]);
}
function summary(document) { return { title: document.title, pages: document.pages.length, layers: document.pages.reduce((sum, page) => sum + page.elements.length, 0), documentSchema: document.schema, documentVersion: document.version }; }
async function embeddedFontCSS(page) {
  const wanted = documentFontFamilies(page), rules = [];
  for (const font of wanted) for (const face of font.faces) {
    const bytes = await bytesFromFile(join(root, 'public', face.path), 256 * 1024, 'Bundled font');
    if (bytes.length !== face.bytes || createHash('sha256').update(bytes).digest('hex') !== face.sha256) fail('A bundled font does not match its pinned version.');
    rules.push(`/* ${font.family} | ${font.license}\n${font.notice.replaceAll('*/', '* /')} */\n@font-face{font-family:'${font.family}';font-style:normal;font-weight:${face.weight};font-display:block;src:url('data:font/woff2;base64,${bytes.toString('base64')}') format('woff2');unicode-range:${face.unicodeRange}}`);
  }
  return rules.join('\n');
}
async function rasterPages(pages, format, browserPath, signal) {
  let chromium; try { ({ chromium } = await import('@playwright/test')); } catch { fail('PNG/JPEG export needs the existing development package. Run npm ci, or export SVG.'); }
  const server = createServer(async (request, response) => {
    const path = new URL(request.url, 'http://127.0.0.1').pathname;
    if (!['GET', 'HEAD'].includes(request.method)) { response.writeHead(405); response.end(); return; }
    if (path === '/') { response.writeHead(200, { 'Content-Type': 'text/html', 'Cache-Control': 'no-store' }); response.end('<!doctype html><html><body></body></html>'); return; }
    if (!/^\/src\/[a-z0-9-]+\.(?:js|mjs)$/.test(path) && !/^\/public\/fonts\/[a-z0-9-]+\.woff2$/.test(path)) { response.writeHead(404); response.end(); return; }
    try { const bytes = await bytesFromFile(join(root, path.slice(1)), path.endsWith('.woff2') ? 256 * 1024 : 2 * 1024 * 1024, 'Renderer source'); response.writeHead(200, { 'Content-Type': path.endsWith('.woff2') ? 'font/woff2' : 'text/javascript', 'Cache-Control': 'no-store' }); response.end(request.method === 'HEAD' ? undefined : bytes); }
    catch { response.writeHead(404); response.end(); }
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const origin = `http://127.0.0.1:${server.address().port}`;
  let browser;
  const cancel = () => browser?.close().catch(() => {});
  try {
    signal?.throwIfAborted();
    browser = await chromium.launch({ headless: true, ...(browserPath ? { executablePath: resolve(browserPath) } : {}) });
    signal?.addEventListener('abort', cancel, { once: true }); signal?.throwIfAborted();
    const context = await browser.newContext({ viewport: { width: 320, height: 240 } });
    await context.route('**/*', route => { const url = new URL(route.request().url()); return url.origin === origin && ['GET', 'HEAD'].includes(route.request().method()) ? route.continue() : route.abort(); });
    const tab = await context.newPage(); await tab.goto(origin);
    const result = [];
    for (const { page } of pages) {
      signal?.throwIfAborted();
      const data = await tab.evaluate(async ({ page, type }) => {
        const { renderPageRaster } = await import('/src/raster-export.js');
        const blob = await renderPageRaster(page, type);
        return await new Promise((resolveData, reject) => { const reader = new FileReader(); reader.onload = () => resolveData(reader.result); reader.onerror = () => reject(new Error('Artwork bytes could not be read.')); reader.readAsDataURL(blob); });
      }, { page, type: format === 'png' ? 'image/png' : 'image/jpeg' });
      result.push(Buffer.from(data.slice(data.indexOf(',') + 1), 'base64'));
    }
    await context.close(); return result;
  } finally { signal?.removeEventListener('abort', cancel); if (browser) await browser.close(); server.closeAllConnections(); await new Promise(resolveClose => server.close(resolveClose)); }
}
async function exportArtwork(document, options, signal) {
  document = structuredClone(document);
  for (const page of document.pages) for (const layer of page.elements) layer.credit = sanitiseAgentCredit(layer.credit);
  const format = options.format ?? 'svg'; if (!['svg', 'png', 'jpeg'].includes(format)) fail('Choose SVG, PNG or JPEG.');
  if (format === 'svg' && options.browser) fail('--browser applies only to PNG/JPEG export.');
  required(options, 'outdir');
  try { await stat(resolve(options.outdir)); fail('Export folder already exists. Choose a new folder; existing work was kept.'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (document.pages.reduce((sum, page) => sum + Math.round(page.width) * Math.round(page.height), 0) > 120000000) fail('Artwork exceeds the 120 megapixel batch limit. Export a smaller design.');
  const pages = [];
  for (const page of document.pages) pages.push({ page, svg: pageSVG(page, false, true, await embeddedFontCSS(page)) });
  const files = format === 'svg' ? pages.map(({ svg }) => Buffer.from(svg)) : await rasterPages(pages, format, options.browser, signal);
  if (files.reduce((total, file) => total + file.length, 0) > 100 * 1024 * 1024) fail('Export exceeds the 100 MiB batch limit. Export fewer pages.');
  const manifest = { schema: 'stencil-artwork-export', version: 1, title: document.title, format, pages: document.pages.map((page, index) => ({ file: `page-${String(index + 1).padStart(2, '0')}.${format === 'jpeg' ? 'jpg' : format}`, name: page.name, width: Math.round(page.width), height: Math.round(page.height), credits: page.elements.filter(element => !element.hidden && element.credit).map(element => element.credit) })) };
  if (options['dry-run']) return { ok: true, command: 'export', dryRun: true, ...summary(document), format, files: manifest.pages.map(page => page.file) };
  const output = resolve(options.outdir); const written = [];
  signal?.throwIfAborted();
  try { await mkdir(output); } catch (error) { if (error.code === 'EEXIST') fail('Export folder already exists. Choose a new folder; existing work was kept.'); throw error; }
  try {
    for (let index = 0; index < files.length; index++) { signal?.throwIfAborted(); const path = await saveNew(join(output, manifest.pages[index].file), files[index]); written.push(path); }
    signal?.throwIfAborted(); const manifestPath = await saveNew(join(output, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`); written.push(manifestPath); signal?.throwIfAborted();
  } catch (error) { for (const path of written) await unlink(path).catch(() => {}); await rmdir(output).catch(() => {}); throw error; }
  return { ok: true, command: 'export', output, ...summary(document), format, files: manifest.pages.map(page => page.file) };
}
export async function runAgentCLI(args = process.argv.slice(2), { signal } = {}) {
  signal?.throwIfAborted();
  const { values: options, positionals } = parseArgs({ args, options: optionSpecs, allowPositionals: true, strict: true });
  if (options.help || !positionals.length) return { help };
  const [command] = positionals;
  if (positionals.length !== 1 || !Object.hasOwn(allowed, command)) fail('Choose presets, create, validate, import or export. Use --help for examples.');
  if (Object.keys(options).some(key => !allowed[command].includes(key))) fail('This command received an unsupported option. Use --help for its options.');
  if (command === 'presets') return { ok: true, presets: PRESETS, templates: TEMPLATES.map(({ key, name, category }) => ({ key, name, category })) };
  if (command === 'create') {
    const requestPath = resolve(required(options, 'request')); required(options, 'output');
    await newOutput(options.output);
    const request = validateAgentRequest(await jsonFromFile(requestPath, MAX_DOCUMENT_BYTES, 'Design request'));
    const assets = {};
    // A missing network gate fails before importing even the first local asset.
    if (!options['allow-remote'] && (request.assets ?? []).some(asset => asset.url !== undefined || asset.prediction !== undefined)) fail('Remote assets need --allow-remote. No download was started.');
    for (const asset of request.assets ?? []) Object.defineProperty(assets, asset.id, { enumerable: true, value: await resolveAsset(asset, dirname(requestPath), options['allow-remote'], signal) });
    const document = buildAgentDesign(request, assets), payload = serialiseDocument(document);
    signal?.throwIfAborted();
    return { ok: true, command, ...summary(document), ...(options['dry-run'] ? { dryRun: true } : { output: await saveNew(options.output, payload) }) };
  }
  const document = await documentFromFile(required(options, 'input'));
  if (command === 'validate') return { ok: true, command, ...summary(document) };
  if (command === 'export') return exportArtwork(document, options, signal);
  required(options, 'output');
  await newOutput(options.output);
  if (['image', 'url', 'prediction'].filter(key => options[key] !== undefined).length !== 1) fail('Import needs exactly one --image, --url or --prediction.');
  if (options['output-index'] !== undefined && options.prediction === undefined) fail('--output-index applies only to --prediction.');
  const pageIndex = numberOption(options, 'page', 1) - 1;
  if (!Number.isInteger(pageIndex) || pageIndex < 0 || pageIndex >= document.pages.length) fail('Choose a page number in this design, starting at 1.');
  const geometry = {};
  for (const key of ['x', 'y', 'width', 'height']) if (options[key] !== undefined) geometry[key] = numberOption(options, key);
  const credit = sanitiseAgentCredit(options.credit ? await jsonFromFile(options.credit, 16 * 1024, 'Image credit') : null);
  const outputIndex = numberOption(options, 'output-index', 0);
  if (!Number.isInteger(outputIndex) || outputIndex < 0 || outputIndex > 99) fail('Choose an outputIndex between 0 and 99.');
  const preflight = structuredClone(document);
  preflight.pages[pageIndex].elements.push(createElement('image', { src: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGPQ8HP7DwADGgG8pjyfTwAAAABJRU5ErkJggg==', sourceWidth: 1, sourceHeight: 1, credit, ...geometry }));
  validateDocument(preflight);
  const imported = await resolveAsset({ ...(options.image ? { file: options.image } : options.url ? { url: options.url } : { prediction: options.prediction, outputIndex }), credit }, process.cwd(), options['allow-remote'], signal);
  const page = document.pages[pageIndex], scale = Math.min(page.width * .8 / imported.sourceWidth, page.height * .8 / imported.sourceHeight, 1);
  const width = numberOption(options, 'width', Math.max(1, imported.sourceWidth * scale)), height = numberOption(options, 'height', Math.max(1, imported.sourceHeight * scale));
  page.elements.push(createElement('image', { ...imported, width, height, x: numberOption(options, 'x', (page.width - width) / 2), y: numberOption(options, 'y', (page.height - height) / 2) }));
  const valid = validateDocument(document);
  signal?.throwIfAborted();
  return { ok: true, command, ...summary(valid), ...(options['dry-run'] ? { dryRun: true } : { output: await saveNew(options.output, serialiseDocument(valid)) }) };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const controller = new AbortController(); process.once('SIGINT', () => controller.abort(new Error('Command cancelled.')));
  try { const result = await runAgentCLI(process.argv.slice(2), { signal: controller.signal }); if (result.help) process.stdout.write(result.help); else process.stdout.write(`${JSON.stringify(result)}\n`); }
  catch (error) { const code = ['ENOENT', 'EACCES', 'ENOTDIR'].includes(error.code) ? 'file-unavailable' : 'invalid-request'; const message = ['ENOENT', 'EACCES', 'ENOTDIR'].includes(error.code) ? 'A required file or output directory is unavailable. Check paths and permissions.' : error.message; process.stderr.write(`${JSON.stringify({ ok: false, code, message })}\n`); process.exitCode = 1; }
}
