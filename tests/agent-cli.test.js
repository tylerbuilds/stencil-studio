/** Actual public command entrypoint checks; no browser, provider or live HTTPS. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, writeFile, readdir, rm, open } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { parseDocument } from '../src/model.js';

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGPQ8HP7DwADGgG8pjyfTwAAAABJRU5ErkJggg==', 'base64');
function cli(args, success = true) {
  const result = spawnSync(process.execPath, ['scripts/agent-design.mjs', ...args], { cwd: resolve('.'), encoding: 'utf8', timeout: 10000, maxBuffer: 1024 * 1024 });
  assert.equal(result.error, undefined); assert.equal(result.signal, null); assert.equal(result.status, success ? 0 : 1, result.stderr);
  if (success) { assert.equal(result.stderr, ''); const output = JSON.parse(result.stdout); assert.equal(output.ok, true); return output; }
  assert.equal(result.stdout, ''); const error = JSON.parse(result.stderr); assert.equal(error.ok, false); return error;
}
async function folderFor(t) { const folder = await mkdtemp(join(tmpdir(), 'stencil-real-cli-')); t.after(() => rm(folder, { recursive: true, force: true })); return folder; }

test('real CLI creates the documented editable bookshop and exports embedded-font SVG', async t => {
  const folder = await folderFor(t), input = join(folder, 'bookshop.json');
  const created = cli(['create', '--request', 'examples/agent-design/social-post.json', '--output', input]);
  assert.equal(created.pages, 1); assert.equal(created.layers, 5);
  const document = parseDocument(await readFile(input, 'utf8')); assert.equal(document.pages[0].elements.find(layer => layer.type === 'text').text, 'CEDAR STREET BOOKSHOP');
  assert.equal(cli(['validate', '--input', input]).documentVersion, 5);
  const exported = cli(['export', '--input', input, '--format', 'svg', '--outdir', join(folder, 'artwork')]); assert.deepEqual(exported.files, ['page-01.svg']);
  const svg = await readFile(join(folder, 'artwork', 'page-01.svg'), 'utf8'); assert.match(svg, /A good book/); assert.match(svg, /data:font\/woff2;base64,/);
  const before = await readFile(input); assert.match(cli(['create', '--request', 'examples/agent-design/social-post.json', '--output', input], false).message, /already exists/); assert.deepEqual(await readFile(input), before);
});
test('real CLI keeps carousel order, imports local image bytes and preserves originals', async t => {
  const folder = await folderFor(t), input = join(folder, 'carousel.json'), output = join(folder, 'with-image.json');
  assert.equal(cli(['create', '--request', 'examples/agent-design/carousel.json', '--output', input]).pages, 3);
  const before = await readFile(input); await writeFile(join(folder, 'generated.png'), png);
  const imported = cli(['import', '--input', input, '--image', join(folder, 'generated.png'), '--page', '2', '--x', '70', '--y', '90', '--width', '400', '--height', '500', '--output', output]); assert.equal(imported.pages, 3);
  const document = parseDocument(await readFile(output, 'utf8')), layer = document.pages[1].elements.at(-1);
  assert.equal(layer.type, 'image'); assert.deepEqual([layer.x, layer.y, layer.width, layer.height], [70, 90, 400, 500]); assert.deepEqual(Buffer.from(layer.src.split(',')[1], 'base64'), png);
  assert.deepEqual(await readFile(input), before); assert.deepEqual(await readFile(join(folder, 'generated.png')), png);
  cli(['export', '--input', output, '--outdir', join(folder, 'artwork')]);
  const manifest = JSON.parse(await readFile(join(folder, 'artwork', 'manifest.json'), 'utf8')); assert.deepEqual(manifest.pages.map(page => page.name), ['Start here', 'Something thoughtful', 'Visit the shop']);
  assert.deepEqual(manifest.pages.map(page => page.file), ['page-01.svg', 'page-02.svg', 'page-03.svg']);
  assert.match(cli(['export', '--input', output, '--outdir', join(folder, 'artwork')], false).message, /already exists/);
});
test('real CLI validates prediction output selection before any network connection', async t => {
  const folder = await folderFor(t), input = join(folder, 'design.json'), prediction = join(folder, 'prediction.json');
  cli(['create', '--request', 'examples/agent-design/social-post.json', '--output', input]);
  await writeFile(prediction, JSON.stringify({ status: 'succeeded', output: ['https://replicate.delivery/selected-zero.png', 'http://127.0.0.1/selected-one.png'], input: { secret: 'not copied' }, logs: 'ignore' }));
  const selected = cli(['import', '--input', input, '--prediction', prediction, '--output-index', '1', '--allow-remote', '--output', join(folder, 'absent.json')], false); assert.match(selected.message, /HTTPS/); assert.equal(selected.message.includes('selected-zero'), false);
  const gated = cli(['import', '--input', input, '--prediction', prediction, '--output', join(folder, 'absent.json')], false); assert.match(gated.message, /allow-remote/);
  await writeFile(prediction, JSON.stringify({ status: 'processing', output: 'https://replicate.delivery/not-done.png' }));
  assert.match(cli(['import', '--input', input, '--prediction', prediction, '--allow-remote', '--output', join(folder, 'absent.json')], false).message, /not succeeded/);
  assert.deepEqual((await readdir(folder)).sort(), ['design.json', 'prediction.json']);
});
test('real CLI malformed and oversize inputs exit non-zero without output or temporary artefacts', async t => {
  const folder = await folderFor(t), invalid = join(folder, 'invalid.json'), output = join(folder, 'absent.json');
  await writeFile(invalid, '{ malformed'); assert.match(cli(['create', '--request', invalid, '--output', output], false).message, /not valid JSON/);
  await writeFile(invalid, JSON.stringify({ schema: 'stencil-design-request', version: 1, pages: [{ elements: [{ type: 'text', fontSize: 99999 }] }] })); assert.match(cli(['create', '--request', invalid, '--output', output], false).message, /Font size/);
  const oversized = join(folder, 'oversized.json'), handle = await open(oversized, 'wx'); await handle.truncate(12 * 1024 * 1024 + 1); await handle.close();
  assert.match(cli(['create', '--request', oversized, '--output', output], false).message, /12 MiB/);
  const input = join(folder, 'design.json'); cli(['create', '--request', 'examples/agent-design/social-post.json', '--output', input]);
  const oversizedImage = join(folder, 'oversized.png'), imageHandle = await open(oversizedImage, 'wx'); await imageHandle.truncate(6 * 1024 * 1024 + 1); await imageHandle.close();
  assert.match(cli(['import', '--input', input, '--image', oversizedImage, '--output', output], false).message, /6 MiB/);
  const baseline = await readFile(input); assert.match(cli(['import', '--input', input, '--image', 'does-not-exist.png', '--output', input], false).message, /already exists/); assert.deepEqual(await readFile(input), baseline);
  assert.deepEqual((await readdir(folder)).sort(), ['design.json', 'invalid.json', 'oversized.json', 'oversized.png']);
});
