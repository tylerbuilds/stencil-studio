import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { validateCatalogue, searchAssets, assetURL, readLimitedBytes, MAX_CATALOGUE_BYTES } from '../src/asset-catalogue.js';
import { COLLECTION_NOTICES } from '../src/asset-notices.js';
import { createBlankDesign, createElement, validateDocument, parseDocument, serialiseDocument, pageSVG } from '../src/model.js';

const root = new URL('../public/', import.meta.url);
const raw = await readFile(new URL('assets/catalogue.json', root));
const catalogue = validateCatalogue(JSON.parse(raw));
const digest = bytes => createHash('sha256').update(bytes).digest('hex');

test('the shipped library is pinned, licensed, complete and within the catalogue budget', async () => {
  assert.equal(catalogue.assets.length, 7145);
  assert.deepEqual(Object.fromEntries(catalogue.collections.map(source => [source.id, catalogue.assets.filter(asset => asset.collection === source.id).length])), { tabler: 5827, fluent: 1285, doodles: 33 });
  assert(raw.length <= MAX_CATALOGUE_BYTES); assert(gzipSync(raw).length < 650000);
  for (const source of catalogue.collections) {
    const notice = await readFile(new URL(source.noticePath, root));
    assert.equal(digest(notice), source.noticeSha256); assert.equal(notice.length, source.noticeBytes);
    assert.equal(notice.toString('utf8'), COLLECTION_NOTICES[source.id].notice);
    assert.equal(source.source, COLLECTION_NOTICES[source.id].source);
  }
});

test('every shipped asset retains its exact pinned source bytes and no hidden SVG files', async () => {
  let total = 0;
  for (const source of catalogue.collections) {
    const entries = await readdir(new URL(`assets/svg/${source.id}/`, root));
    const assets = catalogue.assets.filter(asset => asset.collection === source.id);
    assert.equal(entries.length, assets.length); assert(entries.every(name => name.endsWith('.svg')));
  }
  for (const asset of catalogue.assets) {
    const bytes = await readFile(new URL(asset.path, root));
    assert.equal(bytes.length, asset.bytes, asset.id); assert.equal(digest(bytes), asset.sha256, asset.id);
    assert(!asset.id.startsWith('tabler-outline-brand-') && !asset.id.startsWith('tabler-filled-brand-'));
    total += bytes.length;
  }
  assert.equal(total, 8715209); assert(total < 9 * 1024 * 1024);
});

test('search, subject filters and bounded pages find useful artwork without losing matches', () => {
  const initial = searchAssets(catalogue);
  assert.equal(initial.assets.length, 36); assert.equal(initial.total, 7145); assert.equal(initial.assets[0].id, 'tabler-outline-heart');
  assert(searchAssets(catalogue, { query: 'heart', collection: 'tabler' }).assets.some(asset => asset.id === 'tabler-outline-heart'));
  assert(searchAssets(catalogue, { query: 'party', collection: 'fluent' }).assets.length > 0);
  assert(searchAssets(catalogue, { query: 'coffee', collection: 'doodles' }).assets.length > 0);
  const doodles = searchAssets(catalogue, { collection: 'doodles', page: 999 }); assert.equal(doodles.assets.length, 33); assert.equal(doodles.pages, 1); assert.equal(doodles.page, 0);
  assert.equal(searchAssets(catalogue, { query: 'no such impossible asset xxyz' }).total, 0);
  const nature = searchAssets(catalogue, { category: 'Nature', collection: 'tabler' }); assert(nature.assets.every(asset => asset.category === 'Nature' && asset.collection === 'tabler'));
  const second = searchAssets(catalogue, { page: 1 }); assert(!second.assets.some(asset => initial.assets.some(first => first.id === asset.id)));
});

test('catalogue validation rejects unsafe routes, forged sources, oversize files and duplicate IDs', () => {
  for (const mutate of [
    copy => { copy.assets[0].path = 'assets/svg/tabler/../../outside.svg'; },
    copy => { copy.assets[0].path = 'https://example.test/asset.svg'; },
    copy => { copy.assets[0].path += '?tracking=1'; },
    copy => { copy.assets[0].bytes = 1024 * 1024; },
    copy => { copy.assets[0].sha256 = 'bad'; },
    copy => { copy.assets[1].id = copy.assets[0].id; },
    copy => { copy.collections[0].source = 'https://example.test'; },
    copy => { copy.collections[0].noticePath = 'assets/licenses/../../private.txt'; }
  ]) { const copy = structuredClone(catalogue); mutate(copy); assert.throws(() => validateCatalogue(copy)); }
  for (const path of ['../secret', '//example.test/asset.svg', 'assets/svg/tabler/heart.svg?x=1', 'assets/svg/unknown/heart.svg']) assert.throws(() => assetURL(path));
  assert.equal(assetURL('assets/svg/tabler/outline-heart.svg', 'https://example.test/stencil-studio/src/asset-catalogue.js'), 'https://example.test/stencil-studio/public/assets/svg/tabler/outline-heart.svg');
});

test('bounded downloads reject redirects, declared and streamed excess, and cancelled reads', async () => {
  const response = text => new Response(text);
  assert.equal(new TextDecoder().decode(await readLimitedBytes(response('asset'), 5)), 'asset');
  await assert.rejects(readLimitedBytes(response('too long'), 3));
  await assert.rejects(readLimitedBytes(new Response('x', { headers: { 'content-length': '100' } }), 3));
  await assert.rejects(readLimitedBytes(new Response('x', { status: 404 }), 3));
  const controller = new AbortController(); controller.abort(); await assert.rejects(readLimitedBytes(response('asset'), 10, controller.signal), error => error.name === 'AbortError');
  await assert.rejects(readLimitedBytes({ ok: true, redirected: true }, 3));
});

test('larger embedded artwork validates and reopens without regexp stack exhaustion', () => {
  const design = createBlankDesign(), src = `data:image/png;base64,${Buffer.alloc(2 * 1024 * 1024).toString('base64')}`;
  design.pages[0].elements.push(createElement('image', { src, width: 220, height: 220, sourceWidth: 2000, sourceHeight: 2000 }));
  assert.equal(validateDocument(design).pages[0].elements[0].src, src);
  assert.equal(parseDocument(serialiseDocument(design)).pages[0].elements[0].src, src);
  assert(pageSVG(design.pages[0], true).includes('data:image/png;base64,'));
  for (const bad of ['data:image/svg+xml;base64,AAAA', 'data:image/png;base64,A===', 'data:image/png;base64,AA=A', 'data:image/png;base64,AAA', 'data:image/png;base64,']) {
    design.pages[0].elements[0].src = bad; assert.throws(() => validateDocument(design));
  }
});
