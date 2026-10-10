import test from 'node:test';
import assert from 'node:assert/strict';
import { FRAME_FIELDS, FRAME_SHAPES, defaultsForFrame, validateFrameFields, frameClipSVG, renderFrameContent, collageLayout } from '../../src/frames.js';
import { clampPlacement, cropFromPlacement, placementFromCrop, coverCrop, zoomPlacement, openCropEditor } from '../../src/crop-editor.js';

const src = 'data:image/png;base64,iVBORw0KGgo=';
const frame = (patch = {}) => ({ type: 'frame', id: 'photo', width: 300, height: 200, fill: '#e7ece8', ...defaultsForFrame({ width: 300, height: 200, ...patch }), ...patch });
const image = (patch = {}) => { const f = frame({ src, sourceWidth: 1200, sourceHeight: 800, ...patch }); for (const key of FRAME_FIELDS) delete f[key]; return { ...f, type: 'image' }; };
const approx = (actual, expected, tolerance = 1e-10) => assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} != ${expected}`);
const bounded = crop => {
  assert.ok(crop.x >= 0 && crop.y >= 0 && crop.width >= .0001 && crop.height >= .0001);
  assert.ok(crop.x + crop.width <= 1 + Number.EPSILON && crop.y + crop.height <= 1 + Number.EPSILON);
};

test('empty frame defaults have independent crop/adjustments and bounded corners', () => {
  const first = defaultsForFrame({ width: 13, height: 8 }), second = defaultsForFrame({ width: 13, height: 8 });
  assert.equal(first.src, ''); assert.equal(first.cornerRadius, 4); assert.equal(first.shape, 'rounded');
  first.crop.x = .1; first.filters.contrast = .5; assert.equal(second.crop.x, 0); assert.equal(second.filters.contrast, 1);
  assert.equal(validateFrameFields(frame()).type, 'frame');
});

test('frames reject external/active sources, malformed crops, excessive borders and invalid shapes', () => {
  for (const patch of [{ src: 'https://example.test/photo.png' }, { src: 'javascript:alert(1)' }, { src: 'data:image/svg+xml;base64,AAAA' }, { src: 'data:image/png;base64,AAA' }, { borderWidth: 41 }, { borderColour: 'url(#paint)' }, { shape: '<script>' }, { cornerRadius: 101 }, { sourceWidth: Infinity }, { crop: { x: .8, y: 0, width: .4, height: 1 } }, { filters: { brightness: 1, contrast: 1, saturation: 1, grayscale: 0, blur: 21 } }]) assert.throws(() => validateFrameFields(frame(patch)));
  assert.equal(validateFrameFields(frame({ src })).src, src);
});

test('nested frame and top-level accessors are rejected without invoking them', () => {
  let calls = 0; const original = frame(), candidates = [];
  for (const key of ['shape', 'src', 'crop', 'filters']) { const f = structuredClone(original); Object.defineProperty(f, key, { enumerable: true, get() { calls++; return original[key]; } }); candidates.push(f); }
  const crop = { y: 0, width: 1, height: 1 }; Object.defineProperty(crop, 'x', { enumerable: true, get() { calls++; return 0; } }); candidates.push({ ...original, crop });
  const filters = { brightness: 1, contrast: 1, saturation: 1, grayscale: 0 }; Object.defineProperty(filters, 'blur', { enumerable: true, get() { calls++; return 0; } }); candidates.push({ ...original, filters });
  for (const f of candidates) assert.throws(() => validateFrameFields(f)); assert.equal(calls, 0);
});

test('each native frame shape clips placeholder and raster artwork with a distinct definition', () => {
  for (const shape of FRAME_SHAPES) {
    const f = frame({ shape, borderWidth: 3, borderColour: '#abcdef' }), empty = renderFrameContent(f), filled = renderFrameContent({ ...f, src });
    assert.match(empty, /clip-path="url\(#stencil-frame-clip-photo\)"/); assert.match(empty, /fill="#c5d6c8"/);
    assert.match(filled, /href="data:image\/png;base64,/); assert.match(filled, /stroke="#abcdef" stroke-width="3"/);
    assert.match(frameClipSVG('preview', f), shape === 'circle' ? /<ellipse/ : shape === 'arch' ? /<path/ : ['star', 'diamond'].includes(shape) ? /<polygon/ : /<rect/);
    assert.doesNotMatch(filled, /NaN|undefined|https:|script/);
  }
  assert.throws(() => frameClipSVG('x" onclick="alert(1)', frame())); assert.throws(() => renderFrameContent(frame({ id: 'a"b' })));
});

test('frame crops and colour adjustments are retained in export without editor controls', () => {
  const f = frame({ src, sourceWidth: 1000, sourceHeight: 500, crop: { x: .1, y: .2, width: .6, height: .7 }, filters: { brightness: .8, contrast: 1.2, saturation: .4, grayscale: .5, blur: 3 } });
  const exported = renderFrameContent(f), editable = renderFrameContent(f, undefined, true);
  assert.match(exported, /viewBox="100 100 600 350"/); assert.match(exported, /stencil-frame-filter-photo/); assert.match(exported, /feGaussianBlur stdDeviation="3"/);
  assert.doesNotMatch(exported, /fill="transparent"/); assert.match(editable, /fill="transparent"/);
});

test('collage presets fill the padded page with separate editable, non-overlapping frames', () => {
  for (const preset of ['2columns', '3columns', '2x2', 'hero']) {
    const page = { width: 720, height: 960 }, patches = collageLayout(page, preset, { padding: 24, gutter: 16 });
    assert.equal(patches.length, { '2columns': 2, '3columns': 3, '2x2': 4, hero: 3 }[preset]);
    for (const p of patches) { assert.equal(p.type, 'frame'); assert.equal(p.src, ''); assert.ok(!('id' in p) && !('groupId' in p)); assert.ok(p.x >= 24 && p.y >= 24 && p.x + p.width <= 696.000001 && p.y + p.height <= 936.000001); validateFrameFields({ ...p, id: 'a' }); }
    for (let a = 0; a < patches.length; a++) for (let b = a + 1; b < patches.length; b++) { const x = patches[a], y = patches[b]; assert.ok(x.x + x.width <= y.x || y.x + y.width <= x.x || x.y + x.height <= y.y || y.y + y.height <= x.y); }
  }
  assert.throws(() => collageLayout({ width: 64, height: 64 }, '3columns', { padding: 20, gutter: 20 }));
  assert.throws(() => collageLayout({ width: 640, height: 480 }, 'unknown')); assert.throws(() => collageLayout({ width: 63, height: 480 }, '2x2'));
});

test('centred fill and legacy mismatched crop ratios match the renderer visible region', () => {
  const photo = image(), square = coverCrop(photo, 1);
  approx(square.x, 1 / 6); approx(square.y, 0); approx(square.width, 2 / 3); approx(square.height, 1);
  const oldCrop = { x: .1, y: .2, width: .8, height: .6 }, viewport = { width: 300, height: 300 };
  const visible = cropFromPlacement(photo, placementFromCrop(photo, oldCrop, viewport), viewport);
  approx(visible.x, .3); approx(visible.y, .2); approx(visible.width, .4); approx(visible.height, .6);
  approx(visible.width * photo.sourceWidth / (visible.height * photo.sourceHeight), 1); bounded(visible);
});

test('dragging and zoom preserve a bounded source crop at every edge', () => {
  const photo = image(), viewport = { width: 300, height: 200 };
  for (const x of [-1e9, -500, 0, 1e9]) for (const y of [-1e9, -500, 0, 1e9]) for (const scale of [.000001, .25, 3, 1e9]) {
    const crop = cropFromPlacement(photo, { x, y, scale }, viewport); bounded(crop);
    const placement = placementFromCrop(photo, crop, viewport), roundTrip = cropFromPlacement(photo, placement, viewport);
    for (const key of ['x', 'y', 'width', 'height']) approx(roundTrip[key], crop[key]);
    approx(crop.width * photo.sourceWidth / (crop.height * photo.sourceHeight), viewport.width / viewport.height, 1e-7);
  }
});

test('zoom keeps the source point under its anchor and rejects invalid maths', () => {
  const photo = image(), viewport = { width: 300, height: 200 }, placement = { x: -200, y: -120, scale: .7 }, anchor = { x: 100, y: 80 };
  const zoomed = zoomPlacement(photo, placement, 1.4, viewport, anchor);
  approx((anchor.x - placement.x) / placement.scale, (anchor.x - zoomed.x) / zoomed.scale); approx((anchor.y - placement.y) / placement.scale, (anchor.y - zoomed.y) / zoomed.scale);
  for (const candidate of [{ x: NaN, y: 0, scale: 1 }, { x: 0, y: Infinity, scale: 1 }, { x: 0, y: 0, scale: 0 }]) assert.throws(() => clampPlacement(photo, candidate, viewport));
  assert.throws(() => coverCrop(photo, 0)); assert.throws(() => coverCrop({ sourceWidth: 65535, sourceHeight: 1 }, 1 / 8192));
  assert.throws(() => placementFromCrop(photo, { x: .5, y: 0, width: .8, height: 1 }, viewport));
});

class FakeNode {
  constructor() { this.events = new Map(); this.attributes = new Map(); this.style = {}; this.isConnected = true; this.value = ''; this.disabled = false; this.hidden = false; this.captured = new Set(); this.released = 0; const classes = new Set(); this.classList = { add: value => classes.add(value), remove: value => classes.delete(value) }; }
  setAttribute(key, value) { this.attributes.set(key, value); }
  getAttribute(key) { return this.attributes.get(key); }
  addEventListener(key, action) { if (!this.events.has(key)) this.events.set(key, new Set()); this.events.get(key).add(action); }
  removeEventListener(key, action) { this.events.get(key)?.delete(action); }
  async emit(key, event = {}) { const e = { preventDefault() {}, ...event }; for (const action of [...(this.events.get(key) ?? [])]) await action(e); }
  focus() { globalThis.document.activeElement = this; }
  setPointerCapture(id) { this.captured.add(id); }
  releasePointerCapture(id) { this.captured.delete(id); this.released++; }
  getBoundingClientRect() { const [,, width, height] = (this.getAttribute('viewBox') ?? '0 0 300 200').split(' ').map(Number); return { left: 0, top: 0, width, height }; }
  remove() { this.isConnected = false; }
}
class FakeDialog extends FakeNode {
  set innerHTML(value) { this.markup = value; this.parts = new Map(); for (const match of value.matchAll(/data-crop="([a-z-]+)"/g)) this.parts.set(match[1], new FakeNode()); this.form = new FakeNode(); this.parts.get('aspect').value = 'current'; }
  get innerHTML() { return this.markup; }
  querySelector(selector) { if (selector === 'form') return this.form; return this.parts.get(/data-crop="([a-z-]+)"/.exec(selector)?.[1]); }
  showModal() { this.open = true; }
  close() { this.open = false; this.emit('close'); }
}
function withDOM(action) {
  const original = globalThis.document, focus = new FakeNode();
  globalThis.document = { activeElement: focus, body: { append(node) { node.isConnected = true; } }, createElement(tag) { assert.equal(tag, 'dialog'); return new FakeDialog(); } };
  const result = action(focus);
  return Promise.resolve(result).finally(() => { if (original === undefined) delete globalThis.document; else globalThis.document = original; });
}
const part = (session, name) => session.dialog.querySelector(`[data-crop="${name}"]`);
const listenerCount = session => [...session.dialog.parts.values(), session.dialog.form, session.dialog].reduce((total, node) => total + [...node.events.values()].reduce((sum, set) => sum + set.size, 0), 0);

test('frame crop UI preserves shape/dimensions, copies source and applies one bounded patch', () => withDOM(async focus => {
  let result, calls = 0; const original = frame({ src, shape: 'star', sourceWidth: 1200, sourceHeight: 800 }), session = openCropEditor(original, { onApply: patch => { result = patch; calls++; } });
  original.src = ''; assert.equal(part(session, 'photo').getAttribute('href'), src); assert.match(part(session, 'defs').innerHTML, /<polygon/); assert.doesNotMatch(session.dialog.innerHTML, /Square|Original photo/);
  part(session, 'zoom').value = '2'; await part(session, 'zoom').emit('input'); await session.dialog.form.emit('submit');
  assert.equal(calls, 1); assert.equal(result.width, 300); assert.equal(result.height, 200); approx(result.crop.width, .5); approx(result.crop.height, .5); bounded(result.crop);
  assert.equal(session.dialog.isConnected, false); assert.equal(listenerCount(session), 0); assert.equal(globalThis.document.activeElement, focus); session.close(); assert.equal(calls, 1);
}));

test('ordinary image aspect choice resizes output, Fit centres and Reset restores original proportions/crop', () => withDOM(async () => {
  let result; const session = openCropEditor(image(), { onApply: patch => { result = patch; } });
  part(session, 'aspect').value = '1'; await part(session, 'aspect').emit('change');
  await part(session, 'fit').emit('click'); await session.dialog.form.emit('submit'); assert.equal(result.width, 300); assert.equal(result.height, 300); approx(result.crop.width, 2 / 3); approx(result.crop.x, 1 / 6);
  const reset = openCropEditor(image(), { onApply: patch => { result = patch; } }); part(reset, 'aspect').value = '.75'; await part(reset, 'aspect').emit('change'); await part(reset, 'reset').emit('click'); await reset.dialog.form.emit('submit'); assert.equal(result.height, 200); approx(result.crop.width, 1); approx(result.crop.height, 1);
}));

test('pointer dragging is bounded, touch cancel releases capture and closing disposes all handlers exactly once', () => withDOM(async focus => {
  let cancellations = 0; const session = openCropEditor(image(), { onApply() {}, onCancel() { cancellations++; } }), viewport = part(session, 'viewport');
  part(session, 'zoom').value = '2'; await part(session, 'zoom').emit('input');
  await viewport.emit('pointerdown', { pointerId: 7, pointerType: 'touch', clientX: 100, clientY: 80 }); assert.ok(viewport.captured.has(7));
  await viewport.emit('pointermove', { pointerId: 7, clientX: 100000, clientY: 100000 }); assert.equal(Number(part(session, 'photo').getAttribute('x')), 0); assert.equal(Number(part(session, 'photo').getAttribute('y')), 0);
  await viewport.emit('pointercancel', { pointerId: 7 }); assert.equal(viewport.captured.size, 0);
  await viewport.emit('pointerdown', { pointerId: 8, pointerType: 'touch', clientX: 50, clientY: 40 }); session.destroy();
  assert.equal(viewport.captured.size, 0); assert.equal(viewport.released, 2); assert.equal(listenerCount(session), 0); assert.equal(cancellations, 1); assert.equal(globalThis.document.activeElement, focus); session.cancel(); assert.equal(cancellations, 1);
}));

test('failed or stale apply keeps the editor open and offers a useful error without duplicating an in-flight apply', () => withDOM(async () => {
  let resolve, calls = 0; const session = openCropEditor(image(), { onApply() { calls++; return new Promise(value => { resolve = value; }); } });
  const pending = session.dialog.form.emit('submit'); assert.equal(part(session, 'apply').disabled, true); await session.dialog.form.emit('submit'); assert.equal(calls, 1); resolve(false); await pending;
  assert.equal(session.dialog.open, true); assert.equal(part(session, 'apply').disabled, false); assert.equal(part(session, 'error').hidden, false); assert.match(part(session, 'error').textContent, /has changed/); session.close(); assert.equal(listenerCount(session), 0);
}));

test('flipped photos preview in the same direction and pointer/keyboard moves retain source crop coordinates', () => withDOM(async () => {
  let result; const session = openCropEditor(image({ flipX: true, flipY: true }), { onApply: patch => { result = patch; } }), viewport = part(session, 'viewport');
  assert.match(part(session, 'clipped').getAttribute('transform'), /translate\(300 200\) scale\(-1 -1\)/);
  part(session, 'zoom').value = '2'; await part(session, 'zoom').emit('input'); const initial = Number(part(session, 'photo').getAttribute('x'));
  await viewport.emit('pointerdown', { pointerId: 1, pointerType: 'mouse', button: 0, clientX: 100, clientY: 80 }); await viewport.emit('pointermove', { pointerId: 1, clientX: 120, clientY: 80 }); await viewport.emit('pointerup', { pointerId: 1 });
  approx(Number(part(session, 'photo').getAttribute('x')), initial - 20);
  await viewport.emit('keydown', { key: 'ArrowRight' }); approx(Number(part(session, 'photo').getAttribute('x')), initial - 25);
  await session.dialog.form.emit('submit'); approx(result.crop.x, 175 / 600); bounded(result.crop);
}));

test('escape and native close cancel once; empty frames and unsupported sources never create a dialog', () => withDOM(async () => {
  let cancellations = 0; const session = openCropEditor(image(), { onApply() {}, onCancel() { cancellations++; } }); await session.dialog.emit('cancel'); session.close(); assert.equal(cancellations, 1); assert.equal(listenerCount(session), 0);
  const closed = openCropEditor(image(), { onApply() {}, onCancel() { cancellations++; } }); closed.dialog.close(); assert.equal(cancellations, 2); assert.equal(listenerCount(closed), 0);
  assert.throws(() => openCropEditor(frame(), { onApply() {} }), /Add a photo/); assert.throws(() => openCropEditor(image({ src: 'https://example.test/a.jpg' }), { onApply() {} }), /embedded/);
}));
