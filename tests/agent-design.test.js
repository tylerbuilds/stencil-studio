import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import { buildAgentDesign, validateAgentRequest, imageAssetFromBytes, predictionImageURL, sanitiseAgentCredit } from '../src/agent-design.js';
import { parseDocument, serialiseDocument, PRESETS } from '../src/model.js';
import { checkedRemoteURL, publicAddress, downloadImage, runAgentCLI } from '../scripts/agent-design.mjs';

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGPQ8HP7DwADGgG8pjyfTwAAAABJRU5ErkJggg==', 'base64');
const request = (patch = {}) => ({ schema: 'stencil-design-request', version: 1, title: 'Fictional shop', preset: 'social', pages: [{ elements: [{ type: 'text', text: 'A new chapter', x: 70, y: 80, fill: '#284e46', fontSize: 54 }] }], ...patch });
const credit = { name: 'Fictional artwork', creator: 'Example artist', sourceUrl: 'https://replicate.delivery/output.png?token=private#preview', licenceUrl: 'https://example.org/terms?key=private', licence: 'Permission supplied by owner' };
const imageRequest = () => request({ assets: [{ id: 'art', file: 'generated.png', credit }], pages: [{ elements: [{ type: 'image', asset: 'art', width: 600, height: 400 }, { type: 'text', text: 'Still editable' }] }] });

test('agent requests create the existing editable model, independent of caller changes', () => {
  const input = request(), document = buildAgentDesign(input);
  assert.equal(document.schema, 'stencil-studio'); assert.equal(document.version, 5);
  assert.equal(document.pages[0].width, 1080); assert.equal(document.pages[0].height, 1080);
  assert.equal(document.pages[0].elements[0].text, 'A new chapter'); assert.equal(document.pages[0].elements[0].fontSize, 54);
  assert.deepEqual(parseDocument(serialiseDocument(document)), document);
  input.pages[0].elements[0].text = 'Changed'; assert.equal(document.pages[0].elements[0].text, 'A new chapter');
});
test('presets use the same dimensions as the editor and custom carousels retain page order', () => {
  for (const preset of PRESETS) {
    const document = buildAgentDesign({ schema: 'stencil-design-request', version: 1, preset: preset.key });
    assert.deepEqual([document.pages[0].width, document.pages[0].height], [preset.width, preset.height]);
  }
  const document = buildAgentDesign(request({ pages: [{ name: 'Cover', width: 800, height: 1000 }, { name: 'Next', width: 800, height: 1000 }] }));
  assert.deepEqual(document.pages.map(page => page.name), ['Cover', 'Next']);
});
test('template requests return editable native layers and reject ambiguous page overrides', () => {
  const document = buildAgentDesign({ schema: 'stencil-design-request', version: 1, template: 'social', title: 'Chosen title' });
  assert.equal(document.title, 'Chosen title'); assert.ok(document.pages[0].elements.some(layer => layer.type === 'text'));
  assert.throws(() => buildAgentDesign(request({ template: 'social' })), /Choose a template/);
});
test('request validation rejects native geometry, wrong fonts and malformed layers before file I/O', () => {
  assert.throws(() => validateAgentRequest(request({ pages: [{ elements: [{ type: 'text', fontSize: 9999 }] }] })), /Font size/);
  assert.throws(() => validateAgentRequest(request({ pages: [{ elements: [{ type: 'text', fontFamily: 'Remote Font' }] }] })), /font available/);
  assert.throws(() => validateAgentRequest(request({ pages: [{ elements: [{ type: 'rect', onclick: 'run something' }] }] })), /unsupported properties/);
  assert.throws(() => validateAgentRequest(request({ pages: [{ width: 800 }] })), /both width and height/);
  assert.throws(() => validateAgentRequest(request({ instruction: 'Do something else' })), /unsupported properties/);
  assert.throws(() => validateAgentRequest(request({ preset: 'unknown' })), /preset listed/);
});
test('requests reject accessors, sparse arrays and unused or undeclared assets', () => {
  const hostile = request(); Object.defineProperty(hostile, 'title', { enumerable: true, get: () => { throw new Error('Executed'); } });
  assert.throws(() => validateAgentRequest(hostile), /accessors or hidden properties/);
  assert.throws(() => validateAgentRequest(request({ pages: new Array(2) })), /incomplete array/);
  let reads = 0; const nested = request({ pages: [{ elements: [{ type: 'rect', gradient: {} }] }] }); Object.defineProperty(nested.pages[0].elements[0].gradient, 'type', { enumerable: true, get: () => { reads++; return 'linear'; } });
  assert.throws(() => validateAgentRequest(nested), /accessors or hidden properties/); assert.equal(reads, 0);
  assert.throws(() => validateAgentRequest(request({ assets: [{ id: 'unused', url: 'https://example.org/x.png' }] })), /unused asset/);
  assert.throws(() => validateAgentRequest(request({ pages: [{ elements: [{ type: 'image', asset: 'missing' }] }] })), /not declared/);
});
test('raster assets are embedded, preserve supplied rights and strip signed URL secrets', () => {
  const asset = imageAssetFromBytes(png, credit), document = buildAgentDesign(imageRequest(), { art: asset });
  const layer = document.pages[0].elements[0]; assert.match(layer.src, /^data:image\/png;base64,/);
  assert.deepEqual([layer.sourceWidth, layer.sourceHeight], [1, 1]); assert.equal(layer.credit.sourceUrl, 'https://replicate.delivery/output.png');
  assert.equal(layer.credit.licenceUrl, 'https://example.org/terms'); assert.equal(credit.sourceUrl.includes('private'), true);
  assert.ok(!serialiseDocument(document).includes('private')); assert.equal(document.pages[0].elements[1].type, 'text');
  assert.throws(() => sanitiseAgentCredit({ ...credit, sourceUrl: 'https://person:secret@example.org/a' }), /HTTP or HTTPS/);
});
test('raster intake rejects non-images, large files, header allocations and nested animated WebP allocations', () => {
  assert.throws(() => imageAssetFromBytes(Buffer.from('<svg onload="bad"/>')), /Choose a PNG/);
  assert.throws(() => imageAssetFromBytes(Buffer.alloc(6 * 1024 * 1024 + 1)), /6 MiB/);
  const huge = Buffer.from(png); huge.writeUInt32BE(20000, 16); assert.throws(() => imageAssetFromBytes(huge), /16,384/);
  // VP8X canvas is small; its nested animation frame requests excessive pixels.
  const webp = Buffer.alloc(62); webp.write('RIFF', 0); webp.writeUInt32LE(54, 4); webp.write('WEBP', 8); webp.write('VP8X', 12); webp.writeUInt32LE(10, 16); webp[24] = 9; webp[27] = 9;
  webp.write('ANMF', 30); webp.writeUInt32LE(24, 34); webp[44] = 0x1f; webp[45] = 0x4e; webp[47] = 9;
  assert.throws(() => imageAssetFromBytes(webp), /16,384/);
});
test('provider output selection ignores input, logs and instruction-like fields', () => {
  const response = { status: 'succeeded', input: { secret: 'never copied' }, logs: 'ignore', output: [{ url: 'https://replicate.delivery/a.png?signed=value' }, 'https://replicate.delivery/b.png'] };
  assert.equal(predictionImageURL(response, 1), 'https://replicate.delivery/b.png');
  assert.equal(predictionImageURL(response), 'https://replicate.delivery/a.png?signed=value');
  assert.throws(() => predictionImageURL({ ...response, status: 'processing' }), /not succeeded/);
  assert.throws(() => predictionImageURL({ status: 'succeeded', output: null }), /No image URL/);
  assert.throws(() => predictionImageURL({ output: 'http://localhost/p.png' }), /HTTPS/);
  assert.throws(() => predictionImageURL({ output: 'https://person:secret@example.org/p.png' }), /credentials/);
  assert.throws(() => predictionImageURL({ output: Object.create({ url: 'https://example.org/inherited.png' }) }), /plain JSON/);
  let reads = 0; const accessor = {}; Object.defineProperty(accessor, 'url', { enumerable: true, get: () => { reads++; return 'https://example.org/accessor.png'; } });
  assert.throws(() => predictionImageURL({ output: accessor }), /accessors/); assert.equal(reads, 0);
});
test('resolved source getters and oversized repeated image references fail before materialising layers', () => {
  let reads = 0; const accessor = { sourceWidth: 1, sourceHeight: 1, credit: null }; Object.defineProperty(accessor, 'src', { enumerable: true, get: () => { reads++; return 'not used'; } });
  assert.throws(() => buildAgentDesign(imageRequest(), { art: accessor }), /unsupported properties/); assert.equal(reads, 0);
  const repeated = imageRequest(); repeated.pages[0].elements.push({ type: 'image', asset: 'art' });
  const large = { src: `data:image/png;base64,${'A'.repeat(7 * 1024 * 1024)}`, sourceWidth: 1, sourceHeight: 1, credit: null };
  assert.throws(() => buildAgentDesign(repeated, { art: large }), /too large/);
});
test('remote URL policy rejects local schemes, credentials and ports without reflecting secrets', () => {
  for (const url of ['http://example.org/a.png', 'file:///tmp/a.png', 'https://person:password@example.org/a', 'https://example.org:444/a', 'https://localhost/a', 'https://host.internal/a']) assert.throws(() => checkedRemoteURL(url), error => !error.message.includes('password'));
  for (const address of ['127.0.0.1', '10.0.0.1', '169.254.169.254', '172.16.0.2', '192.168.1.1', '100.64.0.1', '0.0.0.0', '224.0.0.1', '::1', 'fc00::1', 'fe80::1', '::ffff:127.0.0.1', '2001:db8::1']) assert.equal(publicAddress(address), false, address);
  for (const address of ['1.1.1.1', '8.8.8.8', '2606:4700:4700::1111']) assert.equal(publicAddress(address), true, address);
});
function fakeRequest(responses, calls) {
  return (url, options, callback) => {
    const request = new EventEmitter(); request.destroy = error => { if (error) request.emit('error', error); request.emit('close'); };
    calls.push({ hostname: url.hostname, options });
    setImmediate(() => { const next = responses.shift(); const response = Readable.from(next.bytes ? [next.bytes] : []); response.statusCode = next.status ?? 200; response.headers = next.headers ?? { 'content-type': 'image/png' }; callback(response); response.on('end', () => request.emit('close')); response.on('close', () => request.emit('close')); });
    return request;
  };
}
test('remote downloader pins validated DNS and refuses mixed private answers before connecting', async () => {
  const calls = [];
  const bytes = await downloadImage('https://images.example.org/a.png?private=secret', { resolveHost: async () => [{ address: '1.1.1.1', family: 4 }], request: fakeRequest([{ bytes: png }], calls) });
  assert.deepEqual(bytes, png); assert.equal(calls.length, 1);
  let pinned; calls[0].options.lookup('images.example.org', {}, (_error, address) => { pinned = address; }); assert.equal(pinned, '1.1.1.1');
  assert.deepEqual(Object.keys(calls[0].options.headers), ['Accept', 'User-Agent']);
  await assert.rejects(downloadImage('https://images.example.org/a.png', { resolveHost: async () => [{ address: '1.1.1.1', family: 4 }, { address: '10.0.0.1', family: 4 }], request: () => { throw new Error('Should not connect'); } }), /private networks/);
});
test('redirects repeat public-address checks and downloaded MIME/byte budgets are enforced', async () => {
  const calls = [];
  await assert.rejects(downloadImage('https://images.example.org/a.png', { resolveHost: async () => [{ address: '1.1.1.1', family: 4 }], request: fakeRequest([{ status: 302, headers: { location: 'https://127.0.0.1/private.png' } }], calls) }), /private networks/);
  assert.equal(calls.length, 1);
  await assert.rejects(downloadImage('https://images.example.org/a.png', { resolveHost: async () => [{ address: '1.1.1.1', family: 4 }], request: fakeRequest([{ bytes: png, headers: { 'content-type': 'text/html' } }], []) }), /declared file type/);
  await assert.rejects(downloadImage('https://images.example.org/a.png', { resolveHost: async () => [{ address: '1.1.1.1', family: 4 }], request: fakeRequest([{ headers: { 'content-length': String(6 * 1024 * 1024 + 1) } }], []) }), /6 MiB/);
  await assert.rejects(downloadImage('https://images.example.org/a.png', { resolveHost: async () => [{ address: '1.1.1.1', family: 4 }], request: fakeRequest([{ status: 302, headers: {} }], []) }), /no destination/);
  const controller = new AbortController(); controller.abort(new Error('Cancelled for test'));
  await assert.rejects(downloadImage('https://images.example.org/a.png', { signal: controller.signal, resolveHost: () => { throw new Error('Must not resolve'); } }), /Cancelled for test/);
});
test('public examples create, validate, import and export locally without dependencies or overwriting', async t => {
  const folder = await mkdtemp(join(tmpdir(), 'stencil-agent-test-')); t.after(() => rm(folder, { recursive: true, force: true }));
  const output = join(folder, 'bookshop.stencil.json'), artwork = join(folder, 'artwork');
  const create = await runAgentCLI(['create', '--request', 'examples/agent-design/social-post.json', '--output', output]); assert.equal(create.layers, 5);
  assert.equal((await runAgentCLI(['validate', '--input', output])).documentVersion, 5);
  await assert.rejects(runAgentCLI(['create', '--request', 'examples/agent-design/social-post.json', '--output', output]), /already exists/);
  const baseline = await readFile(output, 'utf8'); await writeFile(join(folder, 'image.png'), png);
  const imported = await runAgentCLI(['import', '--input', output, '--image', join(folder, 'image.png'), '--output', join(folder, 'with-image.json'), '--x', '50', '--y', '75', '--width', '400', '--height', '500']);
  assert.equal(imported.layers, 6); assert.equal(await readFile(output, 'utf8'), baseline);
  const exportResult = await runAgentCLI(['export', '--input', output, '--format', 'svg', '--outdir', artwork]); assert.deepEqual(exportResult.files, ['page-01.svg']);
  const svg = await readFile(join(artwork, 'page-01.svg'), 'utf8'); assert.match(svg, /A good book/); assert.match(svg, /data:font\/woff2;base64,/);
  await assert.rejects(runAgentCLI(['export', '--input', output, '--outdir', artwork]), /already exists/);
  assert.deepEqual((await readdir(folder)).sort(), ['artwork', 'bookshop.stencil.json', 'image.png', 'with-image.json']);
  const carousel = await runAgentCLI(['create', '--request', 'examples/agent-design/carousel.json', '--output', join(folder, 'carousel.json')]); assert.equal(carousel.pages, 3);
  const exported = await runAgentCLI(['export', '--input', join(folder, 'carousel.json'), '--outdir', join(folder, 'carousel')]); assert.deepEqual(exported.files, ['page-01.svg', 'page-02.svg', 'page-03.svg']);
  const legacyCredit = parseDocument(baseline); legacyCredit.pages[0].elements[0].credit = credit; const signedInput = serialiseDocument(legacyCredit); await writeFile(join(folder, 'signed.json'), signedInput);
  await runAgentCLI(['export', '--input', join(folder, 'signed.json'), '--outdir', join(folder, 'redacted')]);
  assert.equal(await readFile(join(folder, 'signed.json'), 'utf8'), signedInput);
  assert.equal((await readFile(join(folder, 'redacted', 'manifest.json'), 'utf8')).includes('private'), false);
  assert.equal((await readFile(join(folder, 'redacted', 'page-01.svg'), 'utf8')).includes('private'), false);
});
test('CLI dry runs write nothing; remote opt-in, invalid native fields and bad flags fail closed', async t => {
  const folder = await mkdtemp(join(tmpdir(), 'stencil-agent-failure-')); t.after(() => rm(folder, { recursive: true, force: true }));
  const dry = await runAgentCLI(['create', '--request', 'examples/agent-design/social-post.json', '--output', join(folder, 'absent.json'), '--dry-run']); assert.equal(dry.dryRun, true); assert.deepEqual(await readdir(folder), []);
  const remote = imageRequest(); remote.assets[0] = { id: 'art', url: 'https://example.org/a.png?token=hidden' }; await writeFile(join(folder, 'request.json'), JSON.stringify(remote));
  await assert.rejects(runAgentCLI(['create', '--request', join(folder, 'request.json'), '--output', join(folder, 'absent.json')]), /allow-remote/);
  remote.pages[0].elements[1].fontSize = 99999; await writeFile(join(folder, 'request.json'), JSON.stringify(remote));
  await assert.rejects(runAgentCLI(['create', '--request', join(folder, 'request.json'), '--output', join(folder, 'absent.json'), '--allow-remote']), /Font size/);
  await assert.rejects(runAgentCLI(['create', '--request', 'examples/agent-design/social-post.json', '--output', join(folder, 'absent.json'), '--browser', '/unneeded']), /unsupported option/);
  await runAgentCLI(['create', '--request', 'examples/agent-design/social-post.json', '--output', join(folder, 'input.json')]);
  await assert.rejects(runAgentCLI(['import', '--input', join(folder, 'input.json'), '--url', 'https://example.org/a.png?private=secret', '--allow-remote', '--width', '99999', '--output', join(folder, 'absent.json')]), /Element width/);
  const result = spawnSync(process.execPath, ['scripts/agent-design.mjs', 'import', '--input', 'absent.json'], { cwd: resolve('.'), encoding: 'utf8' });
  assert.equal(result.status, 1); assert.equal(JSON.parse(result.stderr).ok, false); assert.equal(result.stdout, '');
});
