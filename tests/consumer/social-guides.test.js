import test from 'node:test';
import assert from 'node:assert/strict';
import { createBlankDesign, createElement, createPage, PRESETS, pageSVG, parseDocument, serialiseDocument, snapMovement, validateDocument } from '../../src/model.js';
import { availableSocialTextGuides, addSocialTextGuides } from '../../src/social-guides.js';

const pinterestDocument = () => createBlankDesign({ width: 1080, height: 1920 });
const guidePositions = page => page.guides.map(({ axis, position }) => ({ axis, position }));
const expected = [{ axis: 'x', position: 65 }, { axis: 'x', position: 885 }, { axis: 'y', position: 270 }, { axis: 'y', position: 1130 }];

test('published guides are offered only at exact original canvas dimensions', () => {
  const page = pinterestDocument().pages[0], preset = PRESETS.find(item => item.key === 'pinterest-video');
  assert.deepEqual(availableSocialTextGuides(page), [preset]);
  assert.equal(availableSocialTextGuides(page)[0], preset);
  page.guideSettings.visible = false;
  assert.deepEqual(availableSocialTextGuides(page), [preset]);
  for (const value of [undefined, null, {}, { width: 1080, height: 1919 }, { width: 1079, height: 1920 }, { width: 2160, height: 3840 }, { width: 1920, height: 1080 }, { width: '1080', height: 1920 }]) {
    assert.deepEqual(availableSocialTextGuides(value), []);
  }
});

test('the published margins become four native editable boundaries without changing the original', () => {
  const original = pinterestDocument(), page = original.pages[0], before = structuredClone(original);
  page.guideSettings.visible = false; page.guideSettings.rulers = false; page.guideSettings.snapToGuides = false;
  page.guideSettings.snapToObjects = false; page.guideSettings.snapToPage = false; page.guideSettings.tolerance = 17;
  before.pages[0].guideSettings = structuredClone(page.guideSettings);
  const next = addSocialTextGuides(original, page.id, 'pinterest-video'), updated = next.pages[0];
  assert.deepEqual(guidePositions(updated), expected);
  assert.deepEqual(updated.guideSettings, { ...page.guideSettings, visible: true, rulers: true, snapToGuides: true });
  assert.deepEqual(original, before);
  assert.notEqual(next, original);
  assert.notEqual(updated, page);
  assert.equal(new Set(updated.guides.map(guide => guide.id)).size, 4);
  assert.ok(updated.guides.every(guide => guide.id !== page.id));
  assert.deepEqual(validateDocument(next), next);
  assert.deepEqual(parseDocument(serialiseDocument(next)), next);
});

test('existing identities and positions survive and a repeated addition creates no duplicates', () => {
  const original = pinterestDocument(), page = original.pages[0];
  page.guides = [
    { id: 'retained-guide', axis: 'y', position: 85.25 },
    { id: 'existing-left', axis: 'x', position: 65 },
    { id: 'same-number-other-axis', axis: 'y', position: 65 }
  ];
  const next = addSocialTextGuides(original, page.id, 'pinterest-video');
  assert.deepEqual(next.pages[0].guides.slice(0, 3), page.guides);
  assert.equal(next.pages[0].guides.length, 6);
  assert.deepEqual(guidePositions(next.pages[0]).slice(3), expected.slice(1));
  const repeated = addSocialTextGuides(next, page.id, 'pinterest-video');
  assert.deepEqual(repeated, next);
  assert.equal(repeated.pages[0].guides.length, 6);
  assert.deepEqual(original.pages[0].guides, page.guides);
});

test('other pages and their guides remain intact with document-wide unique identities', () => {
  const original = pinterestDocument(), first = original.pages[0], other = createPage(1080, 1920);
  other.guides = [{ id: 'other-guide', axis: 'x', position: 65 }];
  other.elements = [createElement('text', { text: 'A different page' })];
  original.pages.push(other);
  const next = addSocialTextGuides(original, first.id, 'pinterest-video');
  assert.deepEqual(next.pages[1], other);
  assert.equal(next.pages[1].guides.length, 1);
  const identifiers = next.pages.flatMap(page => [page.id, ...page.guides.map(guide => guide.id), ...page.elements.map(element => element.id)]);
  assert.equal(new Set(identifiers).size, identifiers.length);
});

test('capacity accounts for missing boundaries and a full page fails atomically', () => {
  const original = pinterestDocument(), page = original.pages[0];
  page.guides = Array.from({ length: 37 }, (_, index) => ({ id: `retained-${index}`, axis: 'x', position: index }));
  page.guideSettings.visible = false; page.guideSettings.rulers = false; page.guideSettings.snapToGuides = false;
  const before = structuredClone(original);
  assert.throws(() => addSocialTextGuides(original, page.id, 'pinterest-video'), /40 guides.*Remove/);
  assert.deepEqual(original, before);
  const full = structuredClone(original);
  full.pages[0].guides = Array.from({ length: 40 }, (_, index) => ({ id: `full-${index}`, axis: 'x', position: index }));
  const fullBefore = structuredClone(full);
  assert.throws(() => addSocialTextGuides(full, page.id, 'pinterest-video'), /40 guides/);
  assert.deepEqual(full, fullBefore);
  page.guides.push({ id: 'existing-left', axis: 'x', position: 65 });
  const withOneBoundary = structuredClone(original);
  assert.throws(() => addSocialTextGuides(original, page.id, 'pinterest-video'), /40 guides/);
  assert.deepEqual(original, withOneBoundary);
  page.guides.splice(0, 1);
  const next = addSocialTextGuides(original, page.id, 'pinterest-video');
  assert.equal(next.pages[0].guides.length, 40);
  assert.deepEqual(addSocialTextGuides(next, page.id, 'pinterest-video'), next);
});

test('unknown choices, unsupported surfaces, size mismatches and missing pages fail without edits', () => {
  const original = pinterestDocument(), page = original.pages[0], before = structuredClone(original);
  for (const key of ['missing', '', undefined, null, 'toString']) assert.throws(() => addSocialTextGuides(original, page.id, key), /canvas size is not available/);
  for (const key of ['portrait-video', 'story', 'pinterest', 'youtube-cover']) assert.throws(() => addSocialTextGuides(original, page.id, key), /no published text-area guide/);
  assert.throws(() => addSocialTextGuides(original, 'missing-page', 'pinterest-video'), /Page not found/);
  assert.deepEqual(original, before);
  for (const dimensions of [[1080, 1919], [1079, 1920], [2160, 3840]]) {
    const document = createBlankDesign({ width: dimensions[0], height: dimensions[1] }), copy = structuredClone(document);
    assert.throws(() => addSocialTextGuides(document, document.pages[0].id, 'pinterest-video'), /needs a 1080 × 1920 canvas/);
    assert.deepEqual(document, copy);
  }
});

test('native snapping can use the added text-area guides immediately', () => {
  const original = pinterestDocument(), page = original.pages[0];
  page.elements = [createElement('rect', { x: 60, y: 500, width: 20, height: 20 })];
  Object.assign(page.guideSettings, { snapToGuides: false, snapToObjects: false, snapToPage: false });
  const next = addSocialTextGuides(original, page.id, 'pinterest-video');
  const snapped = snapMovement(next.pages[0], [page.elements[0].id], 2, 0, 1);
  assert.equal(snapped.dx, 5);
  assert.deepEqual(snapped.guides, [{ axis: 'x', value: 65, source: 'guide' }]);
  assert.equal(original.pages[0].guideSettings.snapToGuides, false);
});

test('hidden and off-canvas artwork stays unchanged and guides never enter exported SVG', () => {
  const original = pinterestDocument(), page = original.pages[0];
  page.transparentBackground = true;
  page.elements = [
    createElement('rect', { x: -55, y: -15, width: 160, height: 70, locked: true, fill: '#123456' }),
    createElement('text', { text: 'Hidden private note', hidden: true, x: 135, y: 175 }),
    createElement('text', { text: 'A bright idea', x: 100, y: 300 })
  ];
  const exportedBefore = pageSVG(page), next = addSocialTextGuides(original, page.id, 'pinterest-video');
  assert.deepEqual(next.pages[0].elements, page.elements);
  assert.equal(pageSVG(next.pages[0]), exportedBefore);
  assert.doesNotMatch(pageSVG(next.pages[0]), /Hidden private note|guide|ruler|Pinterest|safeGuide/);
  assert.match(pageSVG(next.pages[0]), /A bright idea|fill="#123456"/);
});
