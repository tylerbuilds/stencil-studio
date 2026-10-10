import test from 'node:test';
import assert from 'node:assert/strict';
import { createPage, createElement } from '../../src/model.js';
import { renderPageRaster, EXPORT_STAGE_TIMEOUT_MS } from '../../src/raster-export.js';

const photo = 'data:image/png;base64,AAAA';
function pageWithPhotos(count = 1) {
  const page = createPage(1080, 1350, 'Post'); page.background = '#fff8ec'; page.transparentBackground = true;
  page.elements = Array.from({ length: count }, () => createElement('image', { src: photo, sourceWidth: 100, sourceHeight: 80 })); return page;
}
function browser(t, options = {}) {
  const originals = { Image: globalThis.Image, document: globalThis.document, create: URL.createObjectURL, revoke: URL.revokeObjectURL };
  const images = [], canvases = [], created = [], revoked = [], draws = [], fills = [], blobs = [];
  class ImageMock {
    constructor() { this.naturalWidth = options.width ?? 100; this.naturalHeight = options.height ?? 80; images.push(this); }
    set src(value) {
      this.source = value;
      const kind = value.startsWith('data:') ? 'embedded' : 'svg';
      if (options.stall === kind) return;
      queueMicrotask(() => { if (options.error === kind) this.onerror?.(); else this.onload?.(); });
    }
    removeAttribute(name) { if (name === 'src') this.removed = true; }
  }
  globalThis.Image = ImageMock;
  globalThis.document = { createElement(kind) {
    assert.equal(kind, 'canvas');
    const context = { fillStyle: '', fillRect(...args) { fills.push({ colour: this.fillStyle, args }); }, drawImage(...args) { draws.push(args); } };
    const canvas = { width: 0, height: 0, getContext() { return context; }, toBlob(callback, type, quality) {
      blobs.push({ width: this.width, height: this.height, type, quality });
      if (options.stall === 'blob') { this.callback = callback; return; }
      queueMicrotask(() => callback(options.badBlob ? new Blob(['wrong'], { type: 'text/plain' }) : new Blob(['encoded'], { type })));
    } }; canvases.push(canvas); return canvas;
  } };
  URL.createObjectURL = blob => { created.push(blob); return `blob:fake-${created.length}`; };
  URL.revokeObjectURL = url => revoked.push(url);
  t.after(() => { if (originals.Image === undefined) delete globalThis.Image; else globalThis.Image = originals.Image; if (originals.document === undefined) delete globalThis.document; else globalThis.document = originals.document; URL.createObjectURL = originals.create; URL.revokeObjectURL = originals.revoke; });
  return { images, canvases, created, revoked, draws, fills, blobs };
}
const flush = async () => { for (let i = 0; i < 15; i++) await Promise.resolve(); };
function cleaned(state) {
  assert.ok(state.images.every(image => image.onload === null && image.onerror === null && image.removed));
  assert.ok(state.canvases.every(canvas => canvas.width === 0 && canvas.height === 0));
  assert.equal(state.revoked.length, state.created.length);
}

test('every distinct visible raster is decoded before SVG capture; repeated and hidden sources do not add decoders', async t => {
  const state = browser(t), page = pageWithPhotos(2);
  page.elements.push(createElement('frame', { src: photo, sourceWidth: 100, sourceHeight: 80 }));
  page.elements.push(createElement('image', { src: 'data:image/png;base64,eA==', sourceWidth: 100, sourceHeight: 80, hidden: true }));
  const blob = await renderPageRaster(page);
  assert.equal(blob.type, 'image/png'); assert.equal(state.images.length, 2); assert.equal(state.images[0].source, photo);
  assert.equal(state.images[1].source, 'blob:fake-1'); assert.equal(state.draws.length, 1); assert.deepEqual(state.blobs[0], { width: 1080, height: 1350, type: 'image/png', quality: .95 }); cleaned(state);
});
test('a damaged image or filled frame stops before the outer SVG and canvas can silently drop it', async t => {
  const state = browser(t, { error: 'embedded' });
  for (const type of ['image', 'frame']) {
    const page = pageWithPhotos(0); page.elements.push(createElement(type, { src: photo, sourceWidth: 100, sourceHeight: 80 }));
    await assert.rejects(renderPageRaster(page), /photo.*could not be read/);
  }
  assert.equal(state.created.length, 0); assert.equal(state.canvases.length, 0); cleaned(state);
});
test('recognisable excessive headers reject before native decoding even when declared dimensions are tiny', async t => {
  const state = browser(t), page = pageWithPhotos();
  const bytes = Buffer.alloc(24); bytes.set([137, 80, 78, 71, 13, 10, 26, 10]); bytes.write('IHDR', 12); bytes.writeUInt32BE(17000, 16); bytes.writeUInt32BE(1, 20);
  page.elements[0].src = `data:image/png;base64,${bytes.toString('base64')}`; page.elements[0].sourceWidth = 1; page.elements[0].sourceHeight = 1;
  await assert.rejects(renderPageRaster(page), /16,384/); assert.equal(state.images.length, 0); assert.equal(state.created.length, 0);
});
test('actual native dimensions are bounded independently of plausible source metadata', async t => {
  const state = browser(t, { width: 10000, height: 5000 });
  await assert.rejects(renderPageRaster(pageWithPhotos()), /40 megapixels/); assert.equal(state.created.length, 0); cleaned(state);
});
test('PNG preserves transparency while JPEG fills the captured page background at native dimensions', async t => {
  const state = browser(t), page = pageWithPhotos(0);
  await renderPageRaster(page, 'image/png'); assert.equal(state.fills.length, 0);
  await renderPageRaster(page, 'image/jpeg'); assert.deepEqual(state.fills, [{ colour: '#fff8ec', args: [0, 0, 1080, 1350] }]);
  assert.equal(page.transparentBackground, true); cleaned(state);
});
test('asynchronous image admission uses a captured page even when the caller changes its size and colours', async t => {
  const state = browser(t), page = pageWithPhotos();
  const result = renderPageRaster(page, 'image/jpeg'); page.width = 64; page.height = 64; page.background = '#000000'; page.elements = [];
  await result; assert.deepEqual(state.fills, [{ colour: '#fff8ec', args: [0, 0, 1080, 1350] }]); assert.equal(state.images.length, 2); cleaned(state);
});
test('an already cancelled download does not start a decoder', async t => {
  const state = browser(t), controller = new AbortController(); controller.abort();
  await assert.rejects(renderPageRaster(pageWithPhotos(), 'image/png', { signal: controller.signal }), { name: 'AbortError' }); assert.equal(state.images.length, 0);
});
for (const stage of ['embedded', 'svg', 'blob']) {
  test(`cancellation during ${stage} settles and releases image, URL and canvas resources`, async t => {
    const state = browser(t, { stall: stage }), controller = new AbortController();
    const result = renderPageRaster(pageWithPhotos(), 'image/png', { signal: controller.signal }); const assertion = assert.rejects(result, { name: 'AbortError' });
    await flush(); controller.abort(); await assertion; cleaned(state);
    for (const canvas of state.canvases) canvas.callback?.(new Blob(['late'], { type: 'image/png' })); await flush(); assert.equal(state.draws.length, stage === 'blob' ? 1 : 0);
  });
  test(`a stalled ${stage} stage has a fixed 20-second ceiling and releases resources`, async t => {
    t.mock.timers.enable({ apis: ['setTimeout'] }); const state = browser(t, { stall: stage });
    const result = renderPageRaster(pageWithPhotos()); const assertion = assert.rejects(result, /too long/);
    await flush(); t.mock.timers.tick(EXPORT_STAGE_TIMEOUT_MS); await assertion; cleaned(state);
  });
}
test('failed outer SVG decoding and wrong browser output MIME never return a usable image', async t => {
  const state = browser(t, { error: 'svg' }); await assert.rejects(renderPageRaster(pageWithPhotos(0)), /could not become/); cleaned(state);
});
test('a browser output with the wrong MIME is refused and every resource is released', async t => {
  const state = browser(t, { badBlob: true }); await assert.rejects(renderPageRaster(pageWithPhotos(0)), /export failed/); cleaned(state);
});
