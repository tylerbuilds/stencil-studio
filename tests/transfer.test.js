import test from 'node:test';
import assert from 'node:assert/strict';
import { createDocument, createPage, createElement, validateDocument, boundsOfElements } from '../src/model.js';
import {
  CLIPBOARD_MIME, CLIPBOARD_PREFIX, MAX_TRANSFER_BYTES,
  encodeSelection, decodeSelection, encodeSelectionText, isSelectionText,
  pasteSelection, insertElements
} from '../src/transfer.js';

const PNG = 'data:image/png;base64,iVBORw0KGgo=';
function documentWith(elements, width = 720, height = 960) {
  const document = createDocument();
  Object.assign(document.pages[0], { width, height, elements });
  return validateDocument(document);
}
function payloadFor(elements, sourcePage = { width: 720, height: 960 }) {
  return JSON.stringify({ schema: 'stencil-studio.clipboard', version: 1, sourcePage, elements });
}
function centre(elements) {
  const bounds = boundsOfElements(elements);
  return { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
}
function near(actual, expected) { assert.ok(Math.abs(actual - expected) < 1e-8, `${actual} differs from ${expected}`); }

test('clipboard marker round trip preserves the exact envelope and rejects other formats', () => {
  const document = documentWith([createElement('text', { text: 'An original idea\n日本語 🌱' })]);
  const payload = encodeSelection(document, document.pages[0].id, [document.pages[0].elements[0].id]);
  assert.equal(CLIPBOARD_MIME, 'application/x-stencil-studio+json');
  assert.equal(encodeSelectionText(payload), CLIPBOARD_PREFIX + payload);
  assert.equal(isSelectionText(encodeSelectionText(payload)), true);
  for (const value of [payload, ' ' + CLIPBOARD_PREFIX + payload, '\ufeff' + CLIPBOARD_PREFIX + payload, CLIPBOARD_PREFIX.replace('\n', '\r\n') + payload, null, {}, 2]) assert.equal(isSelectionText(value), false);
  assert.equal(isSelectionText(CLIPBOARD_PREFIX + 'invalid JSON'), true);
  assert.throws(() => encodeSelectionText('invalid JSON'), /valid JSON/);
  assert.deepEqual(decodeSelection(payload).sourcePage, { width: 720, height: 960 });
  assert.equal(decodeSelection(payload).elements[0].text, 'An original idea\n日本語 🌱');
});

test('copy expands complete groups and cross-document paste preserves locks, crops and editable data with independent IDs', () => {
  const image = createElement('image', {
    id: 'image', groupId: 'source-group', x: 60, y: 90, width: 120, height: 140,
    src: PNG, sourceWidth: 400, sourceHeight: 300, locked: true, flipX: true,
    crop: { x: .1, y: .2, width: .6, height: .5 }, filters: { contrast: 1.3, saturation: .4 }
  });
  const table = createElement('table', {
    id: 'table', groupId: 'source-group', x: 205, y: 95, width: 250, height: 180,
    headerFill: '#6852a1', fontFamily: 'Georgia',
    data: { columns: ['Name', 'Note'], rows: [['A', 'comma, newline\nand quote "'], ['B', '日本語']] }
  });
  const chart = createElement('chart', {
    id: 'chart', x: 105, y: 305, width: 250, height: 200, rotation: 12, hidden: true,
    data: { kind: 'line', labels: ['Alpha', 'Beta'], values: [0, 23] }, palette: ['#6852a1', '#e76543']
  });
  const source = documentWith([image, table, chart]);
  const target = documentWith([createElement('rect', { id: 'image', x: 5, y: 5 })]);
  const originalSource = structuredClone(source), originalTarget = structuredClone(target);
  const payload = encodeSelection(source, source.pages[0].id, ['image', 'chart']);
  const decoded = decodeSelection(payload);
  assert.deepEqual(decoded.elements.map(item => item.id), ['image', 'table', 'chart']);
  const first = pasteSelection(target, target.pages[0].id, payload);
  const copies = first.pages[0].elements.slice(1);
  for (let index = 0; index < copies.length; index++) {
    const copy = copies[index], original = source.pages[0].elements[index];
    assert.notEqual(copy.id, original.id);
    assert.deepEqual({ ...copy, id: original.id, groupId: original.groupId, x: copy.x - 24, y: copy.y - 24 }, original);
  }
  assert.equal(copies[0].groupId, copies[1].groupId);
  assert.notEqual(copies[0].groupId, 'source-group');
  assert.equal(copies[2].groupId, null);
  const second = pasteSelection(first, first.pages[0].id, payload);
  assert.equal(new Set(second.pages[0].elements.map(item => item.id)).size, 7);
  assert.notEqual(second.pages[0].elements[4].groupId, copies[0].groupId);
  copies[0].crop.x = .2;
  copies[1].data.rows[0][0] = 'Changed';
  copies[2].data.values[0] = 77;
  decoded.elements[1].data.columns[0] = 'Changed';
  assert.deepEqual(source, originalSource);
  assert.deepEqual(target, originalTarget);
  assert.equal(decodeSelection(payload).elements[1].data.columns[0], 'Name');
  assert.equal(second.pages[0].elements[5].data.rows[0][0], 'A');
});

test('synthetic validation accepts arbitrary layer and group identifiers that resemble its page ID', () => {
  const elements = [
    createElement('rect', { id: 'clipboard-page', groupId: 'clipboard-page-1' }),
    createElement('circle', { id: 'clipboard-page-2', groupId: 'clipboard-page-1', x: 300 })
  ];
  assert.deepEqual(decodeSelection(payloadFor(elements)).elements, elements);
  const target = createDocument();
  assert.equal(insertElements(target, target.pages[0].id, elements).pages[0].elements.length, 2);
});

test('explicit paste point uses rotated selection bounds while preserving relative positions and geometry', () => {
  const elements = [
    createElement('rect', { id: 'r', x: 100, y: 100, width: 40, height: 120, rotation: 90 }),
    createElement('text', { id: 't', x: 250, y: 220, width: 80, height: 40, rotation: -20, text: 'Keep this size' })
  ];
  const target = documentWith([], 640, 480);
  const next = pasteSelection(target, target.pages[0].id, payloadFor(elements), { point: { x: 210, y: 310 } });
  const pasted = next.pages[0].elements;
  near(centre(pasted).x, 210); near(centre(pasted).y, 310);
  near(pasted[1].x - pasted[0].x, 150); near(pasted[1].y - pasted[0].y, 120);
  for (let index = 0; index < elements.length; index++) {
    for (const field of ['width', 'height', 'rotation', 'fill', 'opacity']) assert.equal(pasted[index][field], elements[index][field]);
  }
});

test('default and explicit off-page placement clamp only the centre without shrinking oversized artwork', () => {
  const target = documentWith([], 64, 96);
  const outside = createElement('rect', { x: 1100, y: -900, width: 800, height: 600, rotation: 15 });
  const payload = payloadFor([outside]);
  const byDefault = pasteSelection(target, target.pages[0].id, payload).pages[0].elements;
  near(centre(byDefault).x, 64); near(centre(byDefault).y, 0);
  const byPoint = pasteSelection(target, target.pages[0].id, payload, { point: { x: -500, y: 2000 } }).pages[0].elements;
  near(centre(byPoint).x, 0); near(centre(byPoint).y, 96);
  assert.equal(byPoint[0].width, 800); assert.equal(byPoint[0].height, 600);
  assert.ok(boundsOfElements(byPoint).x < 0);
});

test('prepared image and text insertion keeps exact positions, remaps IDs and leaves inputs untouched', () => {
  const target = documentWith([createElement('rect', { id: 'existing' })]);
  const elements = [
    createElement('image', { id: 'imported', src: PNG, x: -12, y: 37, width: 123, height: 89 }),
    createElement('text', { id: 'caption', x: 21, y: 210, text: '\nLeading line\r\nLiteral text' })
  ];
  const originalTarget = structuredClone(target), originalElements = structuredClone(elements);
  const next = insertElements(target, target.pages[0].id, elements);
  assert.deepEqual(next.pages[0].elements.slice(1).map(({ id, ...element }) => element), elements.map(({ id, ...element }) => element));
  assert.notEqual(next.pages[0].elements[1].id, 'imported');
  next.pages[0].elements[1].filters.blur = 12;
  assert.deepEqual(elements, originalElements);
  assert.deepEqual(target, originalTarget);
});

test('empty or oversized selections and absent IDs/pages cannot create clipboard artwork', () => {
  const document = documentWith([createElement('rect', { id: 'r' })]);
  for (const ids of [[], ['missing'], [1], new Array(1), Array(301).fill('r')]) assert.throws(() => encodeSelection(document, document.pages[0].id, ids));
  assert.throws(() => encodeSelection(document, 'missing', ['r']), /Page not found/);
  for (const elements of [[], Array(301).fill(document.pages[0].elements[0])]) {
    assert.throws(() => decodeSelection(payloadFor(elements)), /between 1 and 300/);
    assert.throws(() => insertElements(document, document.pages[0].id, elements), /between 1 and 300/);
  }
  assert.throws(() => pasteSelection(document, 'missing', payloadFor(document.pages[0].elements)), /Page not found/);
});

test('envelope schema, version, known fields and source dimensions are strictly checked', () => {
  const base = JSON.parse(payloadFor([createElement('rect')]));
  const invalid = [
    null, [], { ...base, schema: 'foreign' }, { ...base, version: '1' }, { ...base, version: 2 },
    { ...base, extra: true }, { ...base, sourcePage: { ...base.sourcePage, name: 'foreign' } },
    { ...base, sourcePage: { width: 63, height: 960 } }, { ...base, sourcePage: { width: 720, height: 4097 } },
    { ...base, sourcePage: { width: '720', height: 960 } }, { ...base, sourcePage: { width: null, height: 960 } },
    { schema: base.schema, version: 1, elements: base.elements },
    { ...base, elements: [null] }, { ...base, elements: [{ ...base.elements[0], extra: true }] }
  ];
  for (const value of invalid) assert.throws(() => decodeSelection(JSON.stringify(value)));
  for (const value of ['', '{', '{} trailing', {}, 1, null]) assert.throws(() => decodeSelection(value));
  for (const sourcePage of [{ width: 64, height: 4096 }, { width: 4096, height: 64 }]) assert.deepEqual(decodeSelection(payloadFor(base.elements, sourcePage)).sourcePage, sourcePage);
});

test('nested foreign URLs, malformed data and duplicate element/group namespace IDs are rejected', () => {
  const image = createElement('image', { src: PNG });
  for (const src of ['https://example.test/image.png', 'file:///image.png', 'data:image/svg+xml;base64,PHN2Zz4=', 'data:image/png;base64,not base64']) assert.throws(() => decodeSelection(payloadFor([{ ...image, src }])));
  assert.throws(() => decodeSelection(payloadFor([{ ...image, crop: { ...image.crop, width: 2 } }])));
  const chart = createElement('chart');
  assert.throws(() => decodeSelection(payloadFor([{ ...chart, data: { ...chart.data, values: [-1, 2, 3] } }])));
  assert.throws(() => decodeSelection(payloadFor([image, image])));
  assert.throws(() => decodeSelection(payloadFor([{ ...image, groupId: image.id }])));
  const table = createElement('table');
  assert.throws(() => decodeSelection(payloadFor([{ ...table, data: { ...table.data, source: 'https://example.test' } }])));
});

test('transfer byte limit counts UTF-8 bytes and accepts the exact boundary', () => {
  const payload = payloadFor([createElement('rect')]);
  const boundary = payload + ' '.repeat(MAX_TRANSFER_BYTES - new TextEncoder().encode(payload).byteLength);
  assert.equal(decodeSelection(boundary).elements.length, 1);
  assert.throws(() => decodeSelection(boundary + ' '), /12 MiB/);
  const multibyte = 'é'.repeat(MAX_TRANSFER_BYTES / 2 + 1);
  assert.ok(multibyte.length < MAX_TRANSFER_BYTES);
  assert.throws(() => decodeSelection(multibyte), /12 MiB/);
});

test('plain records and dense ordinary arrays reject accessors, symbols, custom prototypes and hidden properties before reading them', () => {
  const target = createDocument(), element = createElement('rect');
  let reads = 0;
  const accessorElement = { ...element };
  Object.defineProperty(accessorElement, 'id', { enumerable: true, get() { reads++; return 'accessor'; } });
  const accessorIDs = ['id'];
  Object.defineProperty(accessorIDs, 0, { enumerable: true, get() { reads++; return 'id'; } });
  const accessorElements = [element];
  Object.defineProperty(accessorElements, 0, { enumerable: true, get() { reads++; return element; } });
  const sparse = new Array(1), decorated = [element], hidden = [element], symbolic = [element];
  decorated.extra = 1;
  Object.defineProperty(hidden, 'extra', { value: 1 });
  symbolic[Symbol('extra')] = 1;
  for (const elements of [[accessorElement], accessorElements, sparse, decorated, hidden, symbolic, Object.setPrototypeOf([element], null), [Object.assign(Object.create(null), element)]]) assert.throws(() => insertElements(target, target.pages[0].id, elements));
  assert.throws(() => encodeSelection(target, target.pages[0].id, accessorIDs));
  const nested = createElement('image', { src: PNG });
  Object.defineProperty(nested.crop, 'x', { enumerable: true, get() { reads++; return 0; } });
  assert.throws(() => insertElements(target, target.pages[0].id, [nested]));
  assert.equal(reads, 0);
});

test('paste points/options are strict finite ordinary records without invoking accessors', () => {
  const target = createDocument(), payload = payloadFor([createElement('rect')]);
  let reads = 0;
  const options = {};
  Object.defineProperty(options, 'point', { enumerable: true, get() { reads++; return { x: 0, y: 0 }; } });
  const point = { y: 0 };
  Object.defineProperty(point, 'x', { enumerable: true, get() { reads++; return 0; } });
  for (const value of [null, [], { unexpected: true }, { point: undefined }, { point: null }, { point: { x: NaN, y: 0 } }, { point: { x: 0, y: Infinity } }, { point: { x: '0', y: 0 } }, { point: { x: 0 } }, { point: { x: 0, y: 0, z: 0 } }, options, { point }, Object.create(null)]) assert.throws(() => pasteSelection(target, target.pages[0].id, payload, value));
  assert.equal(reads, 0);
});

test('page and whole-document element limits reject entire insertions without modifying source or target', () => {
  const makeElements = (count, prefix) => Array.from({ length: count }, (_, index) => createElement('rect', { id: `${prefix}-${index}` }));
  const fullPage = documentWith(makeElements(300, 'full'));
  const source = documentWith(makeElements(2, 'source'));
  const payload = encodeSelection(source, source.pages[0].id, source.pages[0].elements.map(item => item.id));
  const pageBefore = structuredClone(fullPage), sourceBefore = structuredClone(source);
  assert.throws(() => pasteSelection(fullPage, fullPage.pages[0].id, payload));
  assert.throws(() => insertElements(fullPage, fullPage.pages[0].id, source.pages[0].elements));
  assert.deepEqual(fullPage, pageBefore);
  const fullDocument = createDocument();
  fullDocument.pages = [300, 300, 300, 100].map((count, index) => ({ ...createPage(), elements: makeElements(count, `p${index}`) }));
  const valid = validateDocument(fullDocument), before = structuredClone(valid);
  assert.throws(() => pasteSelection(valid, valid.pages[3].id, payload));
  assert.throws(() => insertElements(valid, valid.pages[3].id, source.pages[0].elements));
  assert.deepEqual(valid, before);
  assert.deepEqual(source, sourceBefore);
});
