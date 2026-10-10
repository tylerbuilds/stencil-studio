import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { BUNDLED_FONTS, FONT_FAMILIES } from '../../src/font-catalogue.js';
import { MAX_FONT_LOAD_MS, documentFontFamilies, fontURL, fontStyleText, documentFontCSS, loadDocumentFonts } from '../../src/font-loader.js';
import { MEDIA_PAGE_SIZE, MAX_MEDIA_BYTES, MAX_MEDIA_TOTAL_BYTES, validateMediaCatalogue, mediaURL, searchMedia, fetchMediaCatalogue, fetchMediaAsset, initMediaLibrary } from '../../src/media-library.js';

const publicRoot = new URL('../../public/', import.meta.url), sha = bytes => createHash('sha256').update(bytes).digest('hex');
const catalogue = JSON.parse(await readFile(new URL('assets/media-catalogue.json', publicRoot)));
const localFetch = async (url, options) => {
  assert.equal(options.credentials, 'omit'); assert.equal(options.redirect, 'error');
  assert.ok(String(url).startsWith(publicRoot.href));
  return new Response(await readFile(new URL(String(url))));
};

test('the complete photo set is local, bounded and pinned to explicit CC0 provenance', async () => {
  assert.equal(validateMediaCatalogue(catalogue), catalogue);
  assert.equal(catalogue.assets.length, 12);
  const provenance = JSON.parse(await readFile(new URL('assets/media-provenance.json', publicRoot)));
  let total = 0;
  for (const asset of catalogue.assets) {
    const bytes = await readFile(new URL(asset.path, publicRoot)), source = provenance.assets.find(item => item.id === asset.id);
    assert.equal(sha(bytes), asset.sha256); assert.equal(bytes.length, asset.bytes); assert.ok(bytes.length <= MAX_MEDIA_BYTES);
    assert.equal(source.licence, 'CC0-1.0'); assert.equal(source.source, asset.source); assert.equal(source.revision, asset.revision);
    assert.ok(source.sourceSnapshot.endsWith(String(asset.revision))); assert.match(source.sourceImageSha1, /^[a-f0-9]{40}$/);
    assert.match(source.downloadSha256, /^[a-f0-9]{64}$/); assert.match(source.sourceDate, /^20(?:13|14|15|16|17)-/);
    assert.match(source.licenceBasis, /Commons/); total += bytes.length;
  }
  assert.equal(total, 1721126); assert.ok(total < MAX_MEDIA_TOTAL_BYTES);
});

test('photo manifest rejects unsafe paths, external sources, duplicates and resource limits', () => {
  for (const patch of [{ path: '../outside.webp' }, { path: 'assets/photos/mountain-lake.webp?remote=true' }, { path: 'https://example.com/image.webp' }, { source: 'https://commons.wikimedia.org.example.com/wiki/File:test.jpg' }, { licence: 'All rights reserved' }, { width: 1281 }, { height: 0 }, { bytes: MAX_MEDIA_BYTES + 1 }, { name: '<script>bad</script>' }, { name: 'Hidden\u202ephoto' }, { revision: Infinity }, { surprise: true }]) {
    const value = structuredClone(catalogue); Object.assign(value.assets[0], patch); assert.throws(() => validateMediaCatalogue(value), /damaged|invalid|cannot/);
  }
  const repeated = structuredClone(catalogue); repeated.assets.push(structuredClone(repeated.assets[0])); assert.throws(() => validateMediaCatalogue(repeated), /damaged/);
  for (const path of ['assets/photos/../private.webp', 'assets/photos/a.webp#fragment', 'https://upload.wikimedia.org/a.webp', 'assets/backgrounds/a.svg']) assert.throws(() => mediaURL(path), /invalid/);
  assert.match(mediaURL(catalogue.assets[0].path), /\/public\/assets\/photos\/mountain-lake.webp$/);
});

test('photo search combines words and subjects and clamps pages', () => {
  assert.equal(MEDIA_PAGE_SIZE, 16);
  assert.deepEqual(searchMedia(catalogue, { query: 'NIGHT SKY' }).assets.map(asset => asset.id), ['night-sky']);
  assert.equal(searchMedia(catalogue, { query: 'coffee', category: 'Botanical' }).total, 0);
  assert.equal(searchMedia(catalogue, { category: 'Botanical' }).total, 4);
  assert.equal(searchMedia(catalogue, { kind: 'background' }).total, 4);
  assert.equal(searchMedia(catalogue, { page: 999 }).page, 0);
  assert.equal(searchMedia(catalogue, { page: -1 }).page, 0);
});

test('local catalogue fetch enforces byte bounds, redirects and schema', async () => {
  assert.deepEqual(await fetchMediaCatalogue({ fetchImpl: localFetch }), catalogue);
  await assert.rejects(fetchMediaCatalogue({ fetchImpl: async () => new Response('{}') }), /cannot/);
  await assert.rejects(fetchMediaCatalogue({ fetchImpl: async () => new Response('{}', { headers: { 'content-length': '999999999' } }) }), /large/);
  const response = new Response(JSON.stringify(catalogue)); Object.defineProperty(response, 'redirected', { value: true });
  await assert.rejects(fetchMediaCatalogue({ fetchImpl: async () => response }), /could not load/);
});

test('every bundled photo inserts verified bytes, original dimensions and licence details', async () => {
  for (const asset of catalogue.assets) {
    const inserted = await fetchMediaAsset(asset, { fetchImpl: localFetch });
    assert.ok(inserted.src.startsWith('data:image/webp;base64,'));
    assert.equal(sha(Buffer.from(inserted.src.split(',')[1], 'base64')), asset.sha256);
    assert.equal(inserted.width, asset.width); assert.equal(inserted.height, asset.height); assert.equal(inserted.license, 'CC0-1.0');
    assert.equal(inserted.source, asset.source); assert.equal(inserted.author, asset.author);
  }
});

test('damaged, changed and cancelled photos cannot reach insertion', async () => {
  const asset = catalogue.assets[0], bytes = await readFile(new URL(asset.path, publicRoot)), changed = Buffer.from(bytes); changed[changed.length - 1] ^= 1;
  await assert.rejects(fetchMediaAsset(asset, { fetchImpl: async () => new Response(changed) }), /match/);
  await assert.rejects(fetchMediaAsset(asset, { fetchImpl: async () => new Response(bytes.subarray(0, 30)) }), /incomplete/);
  await assert.rejects(fetchMediaAsset({ ...asset, width: asset.width + 1 }, { fetchImpl: async () => new Response(bytes) }), /match/);
  const signal = AbortSignal.abort(); let fetched = false;
  await assert.rejects(fetchMediaAsset(asset, { signal, fetchImpl: async () => { fetched = true; return new Response(bytes); } }), { name: 'AbortError' });
  assert.equal(fetched, false);
});

test('six distinct font families retain the legacy families and exact upstream OFL notices', async () => {
  assert.deepEqual(FONT_FAMILIES.slice(0, 3), ['Arial', 'Georgia', 'Courier New']); assert.equal(BUNDLED_FONTS.length, 6);
  assert.equal(new Set(FONT_FAMILIES).size, 9);
  const provenance = JSON.parse(await readFile(new URL('fonts/provenance.json', publicRoot)));
  assert.match(provenance.googleFontsCommit, /^[a-f0-9]{40}$/);
  let total = 0;
  for (const font of BUNDLED_FONTS) {
    assert.equal(font.license, 'OFL-1.1'); assert.equal(await readFile(new URL(font.noticePath, publicRoot), 'utf8'), font.notice);
    assert.match(font.notice, /SIL OPEN FONT LICENSE Version 1\.1/);
    assert.ok(font.source.includes(provenance.googleFontsCommit));
    for (const face of font.faces) {
      const bytes = await readFile(new URL(face.path, publicRoot));
      assert.equal(bytes.subarray(0, 4).toString(), 'wOF2'); assert.equal(bytes.readUInt32BE(8), bytes.length);
      assert.equal(sha(bytes), face.sha256); assert.equal(bytes.length, face.bytes); assert.match(face.unicodeRange, /^U\+/); total += bytes.length;
    }
  }
  assert.equal(total, 421628); assert.ok(total < 1024 * 1024);
});

test('font families are chosen from the design and local CSS never contacts a provider', () => {
  const doc = { brand: { fontFamily: 'DM Sans' }, pages: [{ elements: [{ fontFamily: 'Georgia' }, { fontFamily: 'IBM Plex Mono' }, { fontFamily: 'DM Sans' }] }] };
  assert.deepEqual(documentFontFamilies(doc).map(font => font.family), ['DM Sans', 'IBM Plex Mono']);
  const css = fontStyleText(doc); assert.match(css, /@font-face/); assert.match(css, /\/public\/fonts\/dm-sans/); assert.doesNotMatch(css, /fonts\.gstatic|googleapis/);
  assert.equal(fontStyleText({ pages: [{ elements: [{ fontFamily: "DM Sans');url(https://evil.example)" }] }] }), '');
  assert.equal(fontStyleText({ pages: [{ elements: [{ fontFamily: 'Arial' }] }] }), '');
  for (const path of ['fonts/../escape.woff2', 'https://fonts.gstatic.com/font.woff2', 'fonts/test-400-latin.woff2?remote=true']) assert.throws(() => fontURL(path), /invalid/);
});

test('corrupted font bytes are rejected before being added or embedded', async () => {
  const font = BUNDLED_FONTS.find(item => item.family === 'Space Grotesk'), face = font.faces[0], bytes = await readFile(new URL(face.path, publicRoot)), changed = Buffer.from(bytes); changed[changed.length - 1] ^= 1;
  await assert.rejects(documentFontCSS({ brand: { fontFamily: font.family } }, { fetchImpl: async () => new Response(changed) }), /match/);
});

test('SVG export embeds every used font subset and its complete licence', async () => {
  const doc = { pages: [{ elements: [{ fontFamily: 'DM Sans' }] }] }, font = BUNDLED_FONTS.find(item => item.family === 'DM Sans');
  const css = await documentFontCSS(doc, { fetchImpl: localFetch });
  assert.ok(css.includes(font.notice.replaceAll('*/', '* /'))); assert.match(css, /font-weight:400 700/);
  const payloads = [...css.matchAll(/data:font\/woff2;base64,([^']+)/g)].map(match => Buffer.from(match[1], 'base64'));
  assert.equal(payloads.length, font.faces.length); assert.deepEqual(payloads.map(sha), font.faces.map(face => face.sha256));
  assert.doesNotMatch(css, /url\('(?:https?:|file:)/);
});

test('FontFace loads real bundled bytes once per document and preserves weight and subsets', async () => {
  const added = [], owner = { fonts: { add(face) { added.push(face); } } }, doc = { brand: { fontFamily: 'DM Sans' } };
  class Face { constructor(family, bytes, options) { this.family = family; this.bytes = bytes; this.options = options; } async load() { return this; } }
  const first = await loadDocumentFonts(doc, { document: owner, FontFace: Face, fetchImpl: localFetch });
  const second = await loadDocumentFonts(doc, { document: owner, FontFace: Face, fetchImpl: () => { throw new Error('Already loaded'); } });
  assert.equal(first.length, 2); assert.deepEqual(first, second); assert.equal(added.length, 2);
  for (const face of added) { assert.equal(face.family, 'DM Sans'); assert.equal(face.options.weight, '400 700'); assert.match(face.options.unicodeRange, /^U\+/); assert.equal(String.fromCharCode(...face.bytes.subarray(0, 4)), 'wOF2'); }
  assert.deepEqual(await loadDocumentFonts({ brand: { fontFamily: 'Arial' } }), []);
});

function mediaDOM() {
  let owner;
  class Element {
    constructor(tag) { this.tagName = tag; this.ownerDocument = owner; this.children = []; this.className = ''; this.textContent = ''; this.value = ''; this.hidden = false; this.disabled = false; this.listeners = new Map(); this.attributes = new Map(); this.classList = { toggle() {} }; }
    append(...items) { this.children.push(...items); }
    replaceChildren(...items) { this.children = [...items]; }
    setAttribute(key, value) { this.attributes.set(key, value); }
    removeAttribute(key) { this.attributes.delete(key); }
    addEventListener(type, listener) { this.listeners.set(type, listener); }
    querySelectorAll(selector) {
      const result = [];
      for (const child of this.children) {
        if (selector.startsWith('.') ? child.className.split(' ').includes(selector.slice(1)) : child.tagName === selector) result.push(child);
        result.push(...child.querySelectorAll(selector));
      }
      return result;
    }
    querySelector(selector) { return this.querySelectorAll(selector)[0] ?? null; }
    emit(type) { return this.listeners.get(type)?.({ target: this }); }
  }
  owner = { createElement(tag) { return new Element(tag); } };
  return new Element('div');
}

test('photo click captures its target synchronously before loading and forwards that exact context', async t => {
  const container = mediaDOM(), asset = catalogue.assets[0], bytes = await readFile(new URL(asset.path, publicRoot)), order = [];
  let finishFetch, target = 'original-page', seenContext, insertions = 0;
  const captured = { target, revision: 'original-revision' };
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    if (String(url).endsWith('media-catalogue.json')) return localFetch(url, options);
    order.push('fetch'); return new Promise(resolve => { finishFetch = () => resolve(new Response(bytes)); });
  });
  const library = initMediaLibrary(container, {
    onBeforeInsert(selected) { assert.equal(selected.id, asset.id); order.push('capture'); return captured; },
    onInsert(item, context) { order.push('insert'); seenContext = context; assert.equal(item.id, asset.id); if (context.target !== target) return false; insertions++; }
  });
  await library.open(); const button = container.querySelector('.media-add'), pending = button.emit('click');
  assert.deepEqual(order, ['capture', 'fetch']);
  target = 'different-page'; finishFetch(); await pending;
  assert.deepEqual(order, ['capture', 'fetch', 'insert']); assert.equal(seenContext, captured); assert.equal(insertions, 0);
  assert.equal(container.querySelector('.media-status').textContent, 'Nothing was added. Try another photo.');
  assert.equal(button.disabled, false); library.destroy();
});

test('failed photo target capture fetches nothing, reports the error and permits a later retry', async t => {
  const container = mediaDOM(); let attempts = 0, imageFetches = 0, inserted = 0;
  t.mock.method(globalThis, 'fetch', async (url, options) => { if (!String(url).endsWith('media-catalogue.json')) imageFetches++; return localFetch(url, options); });
  const library = initMediaLibrary(container, {
    onBeforeInsert() { if (++attempts === 1) throw new Error('Choose a page before adding a photo.'); return { target: 'chosen-page' }; },
    onInsert(item, context) { assert.equal(context.target, 'chosen-page'); assert.ok(item.src.startsWith('data:image/webp;base64,')); inserted++; }
  });
  await library.open(); const button = container.querySelector('.media-add'); await button.emit('click');
  assert.equal(imageFetches, 0); assert.equal(inserted, 0); assert.equal(button.disabled, false);
  assert.equal(container.querySelector('.media-status').textContent, 'Choose a page before adding a photo.');
  await button.emit('click'); assert.equal(imageFetches, 1); assert.equal(inserted, 1); library.destroy();
});

test('photo insertion without a capture hook retains the original one-argument callback', async t => {
  const container = mediaDOM(); let args;
  t.mock.method(globalThis, 'fetch', localFetch);
  const library = initMediaLibrary(container, { onInsert(...value) { args = value; } });
  await library.open(); await container.querySelector('.media-add').emit('click');
  assert.equal(args.length, 1); assert.equal(args[0].id, catalogue.assets[0].id); library.destroy();
});

function trackFontCleanup(t, signal) {
  const timers = new Set(), listeners = new Set(), schedule = globalThis.setTimeout, clear = globalThis.clearTimeout;
  const listen = signal.addEventListener.bind(signal), remove = signal.removeEventListener.bind(signal);
  t.mock.method(globalThis, 'setTimeout', (callback, ms, ...args) => {
    const token = schedule(() => { timers.delete(token); callback(...args); }, ms); timers.add(token); return token;
  });
  t.mock.method(globalThis, 'clearTimeout', token => { timers.delete(token); return clear(token); });
  t.mock.method(signal, 'addEventListener', (type, callback, options) => { if (type === 'abort') listeners.add(callback); return listen(type, callback, options); });
  t.mock.method(signal, 'removeEventListener', (type, callback, options) => { if (type === 'abort') listeners.delete(callback); return remove(type, callback, options); });
  return { timers, listeners, schedule };
}

test('a never-settling native FontFace reaches its deadline and cleans up without adding a face', { timeout: 1000 }, async t => {
  const controller = new AbortController(), cleanup = trackFontCleanup(t, controller.signal), added = [], owner = { fonts: { add(face) { added.push(face); } } };
  class Face { load() { return new Promise(() => {}); } }
  const started = performance.now();
  await assert.rejects(loadDocumentFonts({ brand: { fontFamily: 'DM Sans' } }, { document: owner, FontFace: Face, fetchImpl: localFetch, signal: controller.signal, fontLoadTimeoutMs: 20 }), /too long to load/);
  assert.ok(performance.now() - started < 500); assert.equal(added.length, 0); assert.equal(cleanup.timers.size, 0); assert.equal(cleanup.listeners.size, 0);
});

test('aborting a stalled native FontFace promptly releases its wait and all listeners/timers', { timeout: 1000 }, async t => {
  const controller = new AbortController(), cleanup = trackFontCleanup(t, controller.signal), added = [], owner = { fonts: { add(face) { added.push(face); } } };
  let notify; const nativeStarted = new Promise(resolve => { notify = resolve; });
  class Face { load() { notify(); return new Promise(() => {}); } }
  const pending = loadDocumentFonts({ brand: { fontFamily: 'DM Sans' } }, { document: owner, FontFace: Face, fetchImpl: localFetch, signal: controller.signal });
  await nativeStarted; const abortedAt = performance.now(); controller.abort();
  await assert.rejects(pending, { name: 'AbortError' });
  assert.ok(performance.now() - abortedAt < 500); assert.equal(added.length, 0); assert.equal(cleanup.timers.size, 0); assert.equal(cleanup.listeners.size, 0);
});

test('late native font completion after a deadline is abandoned and a retry creates fresh faces', { timeout: 1000 }, async () => {
  const added = [], owner = { fonts: { add(face) { added.push(face); } } }; let complete, first;
  class LateFace { constructor() { first = this; } load() { return new Promise(resolve => { complete = resolve; }); } }
  const doc = { brand: { fontFamily: 'DM Sans' } };
  await assert.rejects(loadDocumentFonts(doc, { document: owner, FontFace: LateFace, fetchImpl: localFetch, fontLoadTimeoutMs: 15 }), /too long to load/);
  complete(first); await new Promise(resolve => setTimeout(resolve, 0)); assert.equal(added.length, 0);
  class ReadyFace { async load() { return this; } }
  const loaded = await loadDocumentFonts(doc, { document: owner, FontFace: ReadyFace, fetchImpl: localFetch });
  assert.equal(loaded.length, 2); assert.equal(added.length, 2); assert.ok(loaded.every(face => face instanceof ReadyFace));
});

test('native font timeout injection cannot disable or exceed the declared 15 second bound', async () => {
  assert.equal(MAX_FONT_LOAD_MS, 15000); let fetched = 0;
  for (const fontLoadTimeoutMs of [0, -1, 15001, Infinity, NaN, 1.5, '20', null]) {
    await assert.rejects(loadDocumentFonts({ brand: { fontFamily: 'DM Sans' } }, { fontLoadTimeoutMs, fetchImpl: async () => { fetched++; } }), /between 1 and 15000/);
  }
  assert.equal(fetched, 0);
});

test('a native font rejection without a reason still fails without adding or caching the face', async () => {
  const owner = { fonts: { add() { assert.fail('Rejected native fonts must never be added'); } } };
  class Face { load() { return Promise.reject(); } }
  await assert.rejects(loadDocumentFonts({ brand: { fontFamily: 'DM Sans' } }, { document: owner, FontFace: Face, fetchImpl: localFetch }), /could not be loaded/);
});
