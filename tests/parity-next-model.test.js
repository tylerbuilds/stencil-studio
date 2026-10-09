import test from 'node:test';
import assert from 'node:assert/strict';
import { VERSION, DEFAULT_GUIDE_SETTINGS, createDocument, createPage, createElement, validateDocument, parseDocument, serialiseDocument, pageSVG, History, reorderPage, duplicatePage, addPageGuide, updatePageGuide, removePageGuide, setPageGuideSettings, resizePageDocument, snapMovement, updateElement, duplicateElements, groupElements } from '../src/model.js';
import { bulkCreate } from '../src/bulk.js';

function v2Fixture() {
  const document = createDocument(); document.version = 2;
  document.pages.push(createPage(400, 300), createPage(500, 400));
  document.pages.forEach((page, index) => { page.name = `Original ${index + 1}`; delete page.transparentBackground; delete page.guides; delete page.guideSettings; });
  document.pages[0].elements = [createElement('text', { text: 'Keep <markup> & Unicode 界', x: -4, fontFamily: 'Georgia' }), createElement('rect', { locked: true, hidden: true, rotation: 17 })];
  const groupId = 'original-chart-group';
  document.pages[1].elements = [createElement('rect', { groupId, width: 88 }), createElement('text', { groupId, text: 'Original primitive chart' })];
  return document;
}

test('strict v2 migration preserves all original fields, identifiers, ordered content and primitive groups', () => {
  const original = v2Fixture(), bytes = JSON.stringify(original), migrated = parseDocument(bytes);
  assert.equal(migrated.version, VERSION); assert.equal(JSON.stringify(original), bytes);
  assert.deepEqual(migrated.brand, original.brand);
  migrated.pages.forEach((page, index) => {
    const { transparentBackground, guides, guideSettings, ...oldFields } = page;
    assert.deepEqual(oldFields, original.pages[index]); assert.equal(transparentBackground, false);
    assert.deepEqual(guides, []); assert.deepEqual(guideSettings, DEFAULT_GUIDE_SETTINGS);
  });
  migrated.pages[0].guideSettings.tolerance = 12;
  assert.equal(migrated.pages[1].guideSettings.tolerance, 6);
  const invalid = v2Fixture(); invalid.pages[0].transparentBackground = false;
  assert.throws(() => validateDocument(invalid), /unsupported properties/);
  assert.deepEqual(parseDocument(serialiseDocument(migrated)), migrated);
});

test('page moves retain identity, content and guides and undo returns the exact old order', () => {
  let original = validateDocument(v2Fixture()); original = addPageGuide(original, original.pages[1].id, 'x', 123.5);
  const history = new History(original), currentId = original.pages[1].id;
  history.commit(reorderPage(original, currentId, 0));
  assert.deepEqual(history.current.pages.map(page => page.id), [currentId, original.pages[0].id, original.pages[2].id]);
  assert.deepEqual(history.current.pages[0], original.pages[1]);
  history.undo(); assert.deepEqual(history.current, original); history.redo(); assert.equal(history.current.pages[0].id, currentId);
  assert.throws(() => reorderPage(original, currentId, -1)); assert.throws(() => reorderPage(original, currentId, 1.5));
  assert.throws(() => reorderPage(original, 'missing', 0)); assert.deepEqual(reorderPage(original, currentId, 1), original);
});

test('guides validate precisely, preserve identity on edit and remap across page duplicate and bulk', () => {
  let document = createDocument(), pageId = document.pages[0].id;
  document = addPageGuide(document, pageId, 'x', 120.25); const guideId = document.pages[0].guides[0].id;
  document = updatePageGuide(document, pageId, guideId, { position: 121.75 });
  assert.equal(document.pages[0].guides[0].id, guideId); assert.equal(document.pages[0].guides[0].position, 121.75);
  for (const patch of [{ position: 721 }, { position: NaN }, { axis: 'diagonal' }, { id: 'replacement' }]) assert.throws(() => updatePageGuide(document, pageId, guideId, patch));
  const duplicate = duplicatePage(document, pageId); assert.notEqual(duplicate.pages[1].guides[0].id, guideId); assert.equal(duplicate.pages[1].guides[0].position, 121.75);
  document.pages[0].name = '{{name}}'; const bulk = bulkCreate(document, pageId, 'name\nAda\nSam');
  assert.notEqual(bulk.pages[0].guides[0].id, bulk.pages[1].guides[0].id); assert.notEqual(bulk.pages[0].guides[0].id, guideId);
  assert.deepEqual(removePageGuide(document, pageId, guideId).pages[0].guides, []);
  const collision = structuredClone(document); collision.pages[0].guides[0].id = pageId; assert.throws(() => validateDocument(collision), /unique/);
  const missing = structuredClone(document); delete missing.pages[0].guideSettings.snapToObjects; assert.throws(() => validateDocument(missing));
});

test('page resizing scales or clamps guides without altering locked content or retained datasets', () => {
  let document = createDocument(), pageId = document.pages[0].id;
  document.pages[0].elements = [createElement('table', { locked: true }), createElement('chart', { x: 100, width: 200 })];
  document = addPageGuide(document, pageId, 'x', 700); document = addPageGuide(document, pageId, 'y', 500);
  const scaled = resizePageDocument(document, pageId, 360, 480, true);
  assert.deepEqual(scaled.pages[0].elements[0], document.pages[0].elements[0]);
  assert.equal(scaled.pages[0].elements[1].width, 100); assert.deepEqual(scaled.pages[0].elements[1].data, document.pages[0].elements[1].data);
  assert.deepEqual(scaled.pages[0].guides.map(guide => guide.position), [350, 250]);
  const clamped = resizePageDocument(document, pageId, 360, 480, false);
  assert.deepEqual(clamped.pages[0].guides.map(guide => guide.position), [360, 480]);
  assert.deepEqual(clamped.pages[0].elements, document.pages[0].elements);
});

test('snapping respects exact fractional guides, independent source switches and screen tolerance at zoom', () => {
  let document = createDocument(), pageId = document.pages[0].id;
  document.pages[0].elements = [createElement('rect', { x: 100, y: 200, width: 40, height: 40 }), createElement('circle', { x: 350, y: 350, width: 20, height: 20 })];
  document = addPageGuide(document, pageId, 'x', 120.5);
  document = setPageGuideSettings(document, pageId, { snapToPage: false, snapToObjects: false, tolerance: 4 });
  const p = document.pages[0], ids = [p.elements[0].id], near = snapMovement(p, ids, .6, 10, 1);
  assert.ok(Math.abs(near.dx - .5) < 1e-10); assert.equal(near.dy, 10); assert.deepEqual(near.guides, [{ axis: 'x', value: 120.5, source: 'guide' }]);
  assert.equal(snapMovement(p, ids, 5, 10, 1).guides.length, 0); assert.equal(snapMovement(p, ids, 5, 10, .5).dx, .5);
  const disabled = setPageGuideSettings(document, pageId, { snapToGuides: false }); assert.deepEqual(snapMovement(disabled.pages[0], ids, .6, 10), { dx: .6, dy: 10, guides: [] });
  assert.throws(() => setPageGuideSettings(document, pageId, { tolerance: 0 })); assert.throws(() => setPageGuideSettings(document, pageId, { snapToGuides: 1 }));
});

test('transparent SVG omits only the page background and never exports rulers or guides', () => {
  let document = createDocument(), pageId = document.pages[0].id;
  document.pages[0].elements = [createElement('rect', { x: 10, y: 12, fill: '#e76543' })];
  document = addPageGuide(document, pageId, 'x', 10); document.pages[0].guideSettings.rulers = true;
  const opaque = pageSVG(document.pages[0]); assert.match(opaque, /fill="#f6f1e7"/);
  document.pages[0].transparentBackground = true; const transparent = pageSVG(document.pages[0]);
  assert.doesNotMatch(transparent, /fill="#f6f1e7"|guide|ruler/); assert.match(transparent, /fill="#e76543"/);
  assert.match(pageSVG(document.pages[0], true), /fill="transparent"/);
  assert.deepEqual(parseDocument(serialiseDocument(document)), document);
});

test('retained table and chart data survive copy, editing, locking, JSON and SVG export without aliases', () => {
  const document = createDocument(), p = document.pages[0]; p.elements = [createElement('table'), createElement('chart')];
  const original = validateDocument(document), duplicate = duplicateElements(original, p.id, [p.elements[1].id]);
  const copied = duplicate.pages[0].elements.at(-1); assert.notEqual(copied.id, p.elements[1].id); assert.deepEqual(copied.data, p.elements[1].data);
  const changed = updateElement(duplicate, p.id, copied.id, { data: { kind: 'line', labels: ['<literal>', '界'], values: [3, 8] } });
  assert.deepEqual(changed.pages[0].elements[1].data, original.pages[0].elements[1].data);
  assert.match(pageSVG(changed.pages[0]), /&lt;literal&gt;/); assert.doesNotMatch(pageSVG(changed.pages[0]), /<literal>/);
  const locked = updateElement(changed, p.id, copied.id, { locked: true });
  assert.deepEqual(updateElement(locked, p.id, copied.id, { data: { kind: 'pie', labels: ['Changed'], values: [9] } }), locked);
  assert.deepEqual(parseDocument(serialiseDocument(changed)), changed);
  const grouped = groupElements(changed, p.id, changed.pages[0].elements.slice(0, 2).map(element => element.id)); assert.ok(grouped.pages[0].elements[0].groupId);
});
