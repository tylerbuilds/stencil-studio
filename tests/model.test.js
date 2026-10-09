import test from 'node:test';
import assert from 'node:assert/strict';
import { createDocument, createElement, templateDocument, validateDocument, parseDocument, serialiseDocument, editPage, updateElement, removeElement, reorderElement, duplicatePage, History, pageSVG, wrapText } from '../src/model.js';

test('original templates validate and own their state and identifiers', () => {
  for (const key of ['poster', 'social', 'card']) {
    const first = templateDocument(key), second = templateDocument(key);
    assert.notEqual(first.pages[0].id, second.pages[0].id);
    first.pages[0].elements[0].fill = '#ffffff';
    assert.notEqual(first.pages[0].elements[0].fill, second.pages[0].elements[0].fill);
    assert.deepEqual(parseDocument(serialiseDocument(second)), second);
  }
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
