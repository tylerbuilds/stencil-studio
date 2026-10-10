import test from 'node:test';
import assert from 'node:assert/strict';
import { VERSION, DEFAULT_BRAND, PRESETS, TEMPLATES, createDocument, createElement, templateDocument, validateDocument, parseDocument, serialiseDocument, editPage, updateElement, updateElements, removeElement, removeElements, reorderElement, duplicatePage, duplicateElements, groupElements, ungroupElements, alignElements, distributeElements, copyElements, pasteElements, elementBounds, boundsOfElements, History, pageSVG, elementSVG, wrapText } from '../src/model.js';

test('original templates validate and own their state and identifiers', () => {
  assert.equal(TEMPLATES.length, 8);
  for (const { key } of TEMPLATES) {
    const first = templateDocument(key), second = templateDocument(key);
    assert.notEqual(first.pages[0].id, second.pages[0].id);
    first.pages[0].elements[0].fill = '#ffffff';
    assert.notEqual(first.pages[0].elements[0].fill, second.pages[0].elements[0].fill);
    assert.deepEqual(parseDocument(serialiseDocument(second)), second);
  }
});

function fixture(elements) {
  const doc = createDocument(); doc.pages[0].elements = elements; return validateDocument(doc);
}
function legacyDocument() {
  const base = { x: 20, y: 30, width: 240, height: 100, rotation: 0, fill: '#232a27', opacity: 1 };
  return { schema: 'stencil-studio', version: 1, title: 'A saved v1 design', pages: [{ id: 'legacy-page', name: 'Original page', width: 720, height: 960, background: '#f6f1e7', elements: [
    { ...base, id: 'legacy-text', type: 'text', text: 'Keep this\nline break', fontFamily: 'Georgia', fontSize: 24, fontWeight: 400, align: 'right' },
    { ...base, id: 'legacy-rect', type: 'rect', radius: 12 },
    { ...base, id: 'legacy-circle', type: 'circle' },
    { ...base, id: 'legacy-image', type: 'image', src: 'data:image/png;base64,iVBORw0KGgo=' }
  ] }] };
}
test('v1 imports strictly migrate all element types and preserve old image slicing and typography', () => {
  const old = legacyDocument(), migrated = parseDocument(JSON.stringify(old));
  assert.equal(old.version, 1); assert.equal(migrated.version, VERSION);
  assert.deepEqual(migrated.brand, DEFAULT_BRAND);
  const [text, rect, circle, image] = migrated.pages[0].elements;
  assert.equal(text.id, 'legacy-text'); assert.equal(text.fontFamily, 'Georgia');
  assert.equal(text.lineHeight, 1.16); assert.equal(text.letterSpacing, 0);
  assert.equal(rect.radius, 12); assert.equal(rect.strokeWidth, 0); assert.equal(circle.strokeWidth, 0);
  assert.equal(image.sourceWidth, image.width); assert.equal(image.sourceHeight, image.height);
  assert.deepEqual(image.crop, { x: 0, y: 0, width: 1, height: 1 });
  assert.deepEqual(image.filters, { brightness: 1, contrast: 1, saturation: 1, grayscale: 0, blur: 0 });
  for (const element of migrated.pages[0].elements) {
    assert.equal(element.locked, false); assert.equal(element.hidden, false); assert.equal(element.flipX, false); assert.equal(element.flipY, false); assert.equal(element.groupId, null);
  }
  assert.match(pageSVG(migrated.pages[0]), /viewBox="0 0 240 100" preserveAspectRatio="xMidYMid slice"/);
  assert.deepEqual(parseDocument(serialiseDocument(migrated)), migrated);
});
test('migration rejects unsupported legacy fields before defaults can hide them', () => {
  const extra = legacyDocument(); extra.pages[0].elements[0].locked = true;
  assert.throws(() => validateDocument(extra), /unsupported properties/);
  const bad = legacyDocument(); bad.pages[0].elements[0].fontSize = 0;
  assert.throws(() => validateDocument(bad), /Font size/);
  const brand = legacyDocument(); brand.brand = DEFAULT_BRAND;
  assert.throws(() => validateDocument(brand), /unsupported properties/);
});
test('v2 imports require complete bounded fields and do not silently repair invalid files', () => {
  const first = fixture([createElement('text')]);
  for (const prop of ['locked', 'hidden', 'flipX', 'flipY', 'groupId', 'lineHeight', 'letterSpacing']) {
    const bad = structuredClone(first); delete bad.pages[0].elements[0][prop];
    assert.throws(() => validateDocument(bad));
  }
  for (const patch of [{ locked: 1 }, { hidden: 'yes' }, { flipX: null }, { groupId: 'x" onclick="bad' }, { lineHeight: 3.1 }, { letterSpacing: -11 }]) {
    assert.throws(() => updateElement(first, first.pages[0].id, first.pages[0].elements[0].id, patch));
  }
  const missingBrand = structuredClone(first); delete missingBrand.brand;
  assert.throws(() => validateDocument(missingBrand), /Brand/);
  const duplicateColour = structuredClone(first); duplicateColour.brand.colours = ['#abcdef', '#ABCDEF'];
  assert.throws(() => validateDocument(duplicateColour), /unique/);
});
test('new document brand state and every preset are independent, valid and usable', () => {
  const a = createDocument(), b = createDocument(); a.brand.colours[0] = '#ffffff';
  assert.notEqual(a.brand.colours[0], b.brand.colours[0]);
  assert.notEqual(a.brand.colours, DEFAULT_BRAND.colours);
  for (const preset of PRESETS) {
    const doc = templateDocument(preset.key), page = doc.pages[0];
    assert.equal(page.width, preset.width); assert.equal(page.height, preset.height);
    assert.ok(pageSVG(page).startsWith('<svg'));
  }
  assert.equal(templateDocument('presentation').pages.length, 2);
});
test('locked elements resist edits, deletion and reordering while visibility and unlocking remain available', () => {
  const a = createElement('rect', { x: 10, locked: true }), b = createElement('circle', { x: 300 });
  const doc = fixture([a, b]), pageId = doc.pages[0].id;
  assert.deepEqual(updateElement(doc, pageId, a.id, { x: 200, fill: '#ffffff' }), doc);
  assert.deepEqual(removeElement(doc, pageId, a.id), doc);
  assert.deepEqual(reorderElement(doc, pageId, a.id, 1), doc);
  const hidden = updateElement(doc, pageId, a.id, { hidden: true });
  assert.equal(hidden.pages[0].elements[0].hidden, true);
  const unlocked = updateElement(hidden, pageId, a.id, { locked: false, x: 200 });
  assert.equal(unlocked.pages[0].elements[0].x, 10);
  assert.equal(updateElement(unlocked, pageId, a.id, { x: 200 }).pages[0].elements[0].x, 200);
});
test('grouping, duplication, paste and page duplication preserve relative layout and remap every identifier', () => {
  const a = createElement('rect', { x: 10 }), between = createElement('rect', { x: 200 }), b = createElement('circle', { x: 450 });
  const doc = fixture([a, between, b]), pageId = doc.pages[0].id;
  const grouped = groupElements(doc, pageId, [a.id, b.id]);
  const elements = grouped.pages[0].elements, groupId = elements[1].groupId;
  assert.equal(elements[0].id, between.id); assert.equal(elements[1].id, a.id); assert.equal(elements[2].id, b.id);
  assert.equal(elements[2].groupId, groupId); assert.ok(groupId);
  const copied = copyElements(grouped, pageId, [a.id]); assert.equal(copied.length, 2);
  copied[0].fill = '#ffffff'; assert.equal(grouped.pages[0].elements[1].fill, a.fill);
  const duplicated = duplicateElements(grouped, pageId, [a.id]), duplicates = duplicated.pages[0].elements.slice(3);
  assert.equal(duplicates.length, 2); assert.notEqual(duplicates[0].groupId, groupId); assert.equal(duplicates[0].groupId, duplicates[1].groupId);
  assert.equal(duplicates[0].x, a.x + 24); assert.equal(duplicates[1].x - duplicates[0].x, b.x - a.x);
  assert.ok(duplicates.every(element => !elements.some(old => old.id === element.id)));
  const pageCopy = duplicatePage(grouped, pageId);
  assert.notEqual(pageCopy.pages[1].elements[1].groupId, groupId);
  assert.equal(pageCopy.pages[1].elements[1].groupId, pageCopy.pages[1].elements[2].groupId);
  const ungrouped = ungroupElements(grouped, pageId, [a.id]); assert.ok(ungrouped.pages[0].elements.every(element => element.groupId === null));
  const removed = removeElements(grouped, pageId, [a.id]); assert.deepEqual(removed.pages[0].elements.map(element => element.id), [between.id]);
});
test('a locked member protects its entire group from moving, deleting and reordering', () => {
  const a = createElement('rect'), b = createElement('circle'), c = createElement('text');
  const doc = fixture([a, b, c]), pageId = doc.pages[0].id;
  const grouped = groupElements(doc, pageId, [a.id, b.id]);
  const locked = updateElement(grouped, pageId, a.id, { locked: true });
  assert.deepEqual(updateElements(locked, pageId, [a.id, b.id], { x: 900 }), locked);
  assert.deepEqual(removeElement(locked, pageId, b.id), locked);
  assert.deepEqual(reorderElement(locked, pageId, b.id, 1), locked);
  assert.deepEqual(alignElements(locked, pageId, [b.id], 'right', true), locked);
  assert.throws(() => ungroupElements(locked, pageId, [b.id]), /Unlock/);
  const reordered = reorderElement(grouped, pageId, a.id, 1);
  assert.deepEqual(reordered.pages[0].elements.map(element => element.id), [c.id, a.id, b.id]);
});
test('batch updates are atomic, support per-element deltas and leave original state untouched', () => {
  const a = createElement('rect', { x: 100 }), b = createElement('circle', { x: 400 });
  const doc = fixture([a, b]), pageId = doc.pages[0].id;
  const moved = updateElements(doc, pageId, [a.id, b.id], element => ({ x: element.x + 80, y: element.y + 20 }));
  assert.equal(moved.pages[0].elements[0].x, 180); assert.equal(moved.pages[0].elements[1].x, 480);
  assert.equal(doc.pages[0].elements[0].x, 100);
  assert.throws(() => updateElements(doc, pageId, [a.id, b.id], element => ({ width: element.id === b.id ? -1 : 500 })), /width/);
  assert.equal(doc.pages[0].elements[0].width, 200);
  assert.throws(() => updateElements(doc, pageId, ['missing'], {}), /not found/);
  assert.throws(() => pasteElements(doc, pageId, [{ ...a, unexpected: true }]), /unsupported properties/);
});
test('alignment respects rotated geometry, groups and the combined selection or page bounds', () => {
  const a = createElement('rect', { x: 20, y: 10, width: 100, height: 50 }), b = createElement('circle', { x: 300, y: 90, width: 50, height: 150 });
  const doc = fixture([a, b]), pageId = doc.pages[0].id;
  const aligned = alignElements(doc, pageId, [a.id, b.id], 'right');
  assert.deepEqual(aligned.pages[0].elements.map(element => element.x + element.width), [350, 350]);
  const centred = alignElements(doc, pageId, [a.id], 'centerX', true);
  assert.equal(centred.pages[0].elements[0].x, (doc.pages[0].width - a.width) / 2);
  const bottom = alignElements(doc, pageId, [a.id], 'bottom', true);
  assert.equal(bottom.pages[0].elements[0].y, doc.pages[0].height - a.height);
  const rotated = createElement('rect', { x: 20, y: 30, width: 100, height: 200, rotation: 90 });
  const rb = elementBounds(rotated); assert.ok(Math.abs(rb.width - 200) < 1e-10); assert.ok(Math.abs(rb.height - 100) < 1e-10);
  const rdoc = fixture([rotated]), rpageId = rdoc.pages[0].id;
  const left = alignElements(rdoc, rpageId, [rotated.id], 'left', true);
  assert.ok(Math.abs(elementBounds(left.pages[0].elements[0]).x) < 1e-10);
  const grouped = groupElements(doc, pageId, [a.id, b.id]);
  const groupAligned = alignElements(grouped, pageId, [a.id], 'centerY', true), [aa, bb] = groupAligned.pages[0].elements;
  assert.equal(bb.y - aa.y, b.y - a.y);
  const bounds = boundsOfElements(groupAligned.pages[0].elements); assert.equal(bounds.y + bounds.height / 2, doc.pages[0].height / 2);
});
test('distribution creates equal gaps while retaining first and last objects and rejecting locked groups', () => {
  const a = createElement('rect', { x: 0, y: 0, width: 100, height: 100 }), b = createElement('rect', { x: 120, y: 120, width: 50, height: 50 }), c = createElement('rect', { x: 500, y: 500, width: 200, height: 200 });
  const doc = fixture([a, b, c]), pageId = doc.pages[0].id, ids = [a.id, b.id, c.id];
  const horizontal = distributeElements(doc, pageId, ids, 'horizontal');
  assert.equal(horizontal.pages[0].elements[0].x, 0); assert.equal(horizontal.pages[0].elements[2].x, 500);
  assert.equal(horizontal.pages[0].elements[1].x, 275);
  const vertical = distributeElements(doc, pageId, ids, 'vertical'); assert.equal(vertical.pages[0].elements[1].y, 275);
  assert.throws(() => distributeElements(doc, pageId, [a.id, b.id], 'horizontal'), /three/);
  const locked = updateElement(doc, pageId, b.id, { locked: true });
  assert.throws(() => distributeElements(locked, pageId, ids, 'horizontal'), /Unlock/);
});
test('crop and filter controls export genuine safe SVG operations and reject out-of-range or unsupported data', () => {
  const image = createElement('image', { width: 300, height: 200, sourceWidth: 1200, sourceHeight: 800, src: 'data:image/png;base64,iVBORw0KGgo=' });
  const doc = fixture([image]), pageId = doc.pages[0].id;
  const cropped = updateElement(doc, pageId, image.id, { crop: { x: .25, y: .125, width: .5, height: .5 }, filters: { brightness: 1.2, contrast: .8, saturation: 1.5, grayscale: .4, blur: 3 } });
  const svg = pageSVG(cropped.pages[0]);
  assert.match(svg, /viewBox="300 100 600 400"/); assert.match(svg, /<image width="1200" height="800"/);
  assert.match(svg, /feComponentTransfer/); assert.match(svg, /feColorMatrix type="saturate" values="1.5"/); assert.match(svg, /feGaussianBlur stdDeviation="3"/);
  assert.match(svg, /clip-path="url\(#stencil-crop-/); assert.ok(!svg.includes('https://'));
  const partial = updateElement(cropped, pageId, image.id, { filters: { blur: 0 } });
  assert.equal(partial.pages[0].elements[0].filters.brightness, 1.2);
  for (const patch of [{ crop: { x: .8, width: .5 } }, { crop: { width: 0 } }, { filters: { blur: 21 } }, { filters: { brightness: NaN } }, { filters: { saturation: -1 } }, { filters: { unexpected: 1 } }, { sourceWidth: 0 }]) {
    assert.throws(() => updateElement(doc, pageId, image.id, patch));
  }
  for (const src of ['data:image/png;base64,a', 'data:image/png;base64,', 'data:image/png;base64,a===']) {
    assert.throws(() => updateElement(doc, pageId, image.id, { src }), /embedded/);
  }
});
test('SVG exports omit hidden content, preserve flip and typography, and contain editable group wrappers', () => {
  const text = createElement('text', { text: 'First\nSecond', width: 1000, fontSize: 40, lineHeight: 1.5, letterSpacing: 4, flipX: true, flipY: true });
  const rect = createElement('rect', { fill: '#abcdef', stroke: '#123456', strokeWidth: 12 });
  const hidden = createElement('text', { text: 'SECRET HIDDEN CONTENT', hidden: true });
  const doc = fixture([text, rect, hidden]), pageId = doc.pages[0].id, grouped = groupElements(doc, pageId, [text.id, rect.id]);
  const svg = pageSVG(grouped.pages[0]);
  assert.ok(!svg.includes('SECRET HIDDEN')); assert.match(svg, /scale\(-1 -1\)/); assert.match(svg, /letter-spacing="4"/); assert.match(svg, /y="60">Second/);
  assert.match(svg, /stroke="#123456" stroke-width="12"/); assert.match(svg, /id="stencil-group-/);
  assert.match(pageSVG(grouped.pages[0], true), /data-group-id=/);
  assert.ok(!svg.includes('data-element-id'));
  assert.throws(() => elementSVG({ ...text, fill: '\" onload=\"x' }), /colour/);
  assert.equal(elementSVG(hidden), '');
});
test('group identifiers cannot collide with element or page IDs or span pages', () => {
  const a = createElement('rect'), b = createElement('circle'), doc = fixture([a, b]), pageId = doc.pages[0].id;
  assert.throws(() => updateElement(doc, pageId, a.id, { groupId: b.id }), /separate from pages and layers/);
  const grouped = groupElements(doc, pageId, [a.id, b.id]);
  const another = createDocument().pages[0]; another.elements = [createElement('text', { groupId: grouped.pages[0].elements[0].groupId })];
  assert.throws(() => validateDocument({ ...grouped, pages: [...grouped.pages, another] }), /one page/);
});
test('history stores atomic edits, undo and redo, and drops redo after a new change', () => {
  const first = templateDocument('poster'), history = new History(first);
  const page = first.pages[0], element = page.elements[0];
  history.commit(updateElement(history.current, page.id, element.id, { x: 120 }));
  assert.equal(history.current.pages[0].elements[0].x, 120);
  assert.equal(first.pages[0].elements[0].x, 42);
  history.undo(); assert.equal(history.current.pages[0].elements[0].x, 42);
  history.redo(); assert.equal(history.current.pages[0].elements[0].x, 120);
  history.undo(); history.commit(updateElement(history.current, page.id, element.id, { y: 90 }));
  assert.equal(history.redo(), false);
  assert.equal(history.commit(history.current), false);
});
test('bounded history retains the most recent edits', () => {
  const doc = createDocument(), history = new History(doc, 2);
  for (const title of ['one', 'two', 'three']) history.commit({ ...history.current, title });
  assert.equal(history.past.length, 2);
  history.undo(); history.undo(); assert.equal(history.current.title, 'one'); assert.equal(history.undo(), false);
});
test('invalid imports are rejected before they can change state', () => {
  const valid = templateDocument('card');
  assert.throws(() => parseDocument('not json'), /valid JSON/);
  assert.throws(() => validateDocument({ ...valid, version: 9 }), /version/);
  assert.throws(() => validateDocument({ ...valid, injected: true }), /unsupported properties/);
  assert.throws(() => validateDocument({ ...valid, pages: [] }), /1 and 30/);
  assert.throws(() => editPage(valid, valid.pages[0].id, page => { page.width = NaN; }), /width/);
  assert.throws(() => updateElement(valid, valid.pages[0].id, valid.pages[0].elements[0].id, { fill: 'url(https://bad.invalid)' }), /colour/);
  assert.throws(() => updateElement(valid, valid.pages[0].id, valid.pages[0].elements[0].id, { id: valid.pages[0].id }), /unique/);
});
test('images require embedded safe raster formats; URL, SVG and malformed base64 are rejected', () => {
  const doc = createDocument(), page = doc.pages[0];
  for (const src of ['https://example.com/a.png', 'data:image/svg+xml;base64,PHN2Zz4=', 'data:image/png;base64,abc<script>']) {
    assert.throws(() => editPage(doc, page.id, p => p.elements.push(createElement('image', { src }))), /embedded/);
  }
  const png = 'data:image/png;base64,iVBORw0KGgo=';
  const next = editPage(doc, page.id, p => p.elements.push(createElement('image', { src: png })));
  assert.match(pageSVG(next.pages[0]), /href="data:image\/png;base64/);
});
test('SVG escapes text and exports only validated values without editor adornments', () => {
  const doc = createDocument(), page = doc.pages[0];
  const next = editPage(doc, page.id, p => p.elements.push(createElement('text', { text: '<script>& "hello"', width: 1000 })));
  const svg = pageSVG(next.pages[0]);
  assert.ok(svg.includes('&lt;script&gt;&amp; &quot;hello&quot;'));
  assert.ok(!svg.includes('<script>')); assert.ok(!svg.includes('data-element-id'));
  assert.match(pageSVG(next.pages[0], true), /data-element-id/);
});
test('layer order, delete and duplicate page preserve content and avoid aliasing', () => {
  const first = templateDocument('poster'), page = first.pages[0], selected = page.elements[0];
  const reordered = reorderElement(first, page.id, selected.id, 1);
  assert.equal(reordered.pages[0].elements[1].id, selected.id);
  assert.equal(first.pages[0].elements[0].id, selected.id);
  const removed = removeElement(reordered, page.id, selected.id);
  assert.equal(removed.pages[0].elements.length, page.elements.length - 1);
  const duplicated = duplicatePage(first, page.id);
  assert.equal(duplicated.pages.length, 2);
  assert.notEqual(duplicated.pages[0].id, duplicated.pages[1].id);
  assert.notEqual(duplicated.pages[0].elements[0].id, duplicated.pages[1].elements[0].id);
  assert.equal(duplicated.pages[0].elements[0].fill, duplicated.pages[1].elements[0].fill);
});
test('text layout wraps without losing hard paragraph breaks or long words', () => {
  const element = createElement('text', { text: 'hello world\n\nabcdefghijklmnop', width: 100, fontSize: 30 });
  const lines = wrapText(element);
  assert.ok(lines.includes('')); assert.equal(lines.join('').replaceAll(' ', ''), 'helloworldabcdefghijklmnop');
  assert.ok(lines.length > 3);
});
test('UTF-8 and formatted JSON share one file-size limit, so accepted exports reimport', () => {
  const doc = createDocument(), page = doc.pages[0];
  const unicode = editPage(doc, page.id, p => p.elements.push(createElement('text', { text: '界'.repeat(1000) })));
  const exported = serialiseDocument(unicode);
  assert.ok(Buffer.byteLength(exported) > exported.length);
  assert.deepEqual(parseDocument(exported), unicode);
  const oversized = createDocument();
  oversized.pages[0].elements = Array.from({ length: 300 }, () => createElement('text', { text: '界'.repeat(10000) }));
  const second = createDocument().pages[0];
  second.elements = Array.from({ length: 300 }, () => createElement('text', { text: '界'.repeat(10000) }));
  oversized.pages.push(second);
  assert.ok(JSON.stringify(oversized).length < 12 * 1024 * 1024);
  assert.throws(() => validateDocument(oversized), /too large/);
  assert.throws(() => parseDocument(JSON.stringify(oversized)), /too large/);
});
