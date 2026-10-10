/** Model/CSV attack cases use generated designs only and never access browser or network state. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createDocument, createElement, duplicatePage, updateElements, History, validateDocument, pageSVG } from '../../src/model.js';
import { bulkCreate, parseCSV } from '../../src/bulk.js';
function source() { const document = createDocument(); document.pages[0].name = '{{name}}'; return document; }

test('duplicating a valid page at its name boundary still creates a valid copy', () => {
  const document = createDocument(); document.pages[0].name = '界'.repeat(100);
  const next = duplicatePage(document, document.pages[0].id);
  assert.equal(next.pages.length, 2); assert.ok(next.pages[1].name.length <= 100); assert.match(next.pages[1].name, / copy$/);
  assert.equal(document.pages.length, 1);
});

test('history rejects non-finite, oversized and fractional limits before retaining states', () => {
  for (const limit of [NaN, Infinity, -1, 0, 1.5, 100001, '60', null]) assert.throws(() => new History(createDocument(), limit), /history|undo/i);
});

test('sparse and excessive layer selections cannot masquerade as a list of IDs', () => {
  const document = createDocument(), element = createElement('rect'); document.pages[0].elements.push(element);
  for (const ids of [Array(1), Array.from({ length: 100001 }, () => element.id), [undefined], [false]]) assert.throws(() => updateElements(document, document.pages[0].id, ids, { x: 5 }));
  assert.equal(document.pages[0].elements[0].x, 64);
});

test('structured bulk input never executes row getters or accepts sparse data', () => {
  let accessed = 0;
  const row = {}; Object.defineProperty(row, 'name', { enumerable: true, get() { accessed++; return 'Getter'; } });
  const document = source();
  assert.throws(() => bulkCreate(document, document.pages[0].id, { headers: ['name'], rows: [row] }), /plain|getter|data/i);
  assert.equal(accessed, 0);
  assert.throws(() => bulkCreate(document, document.pages[0].id, { headers: ['name'], rows: Array(1) }));
});

test('bulk object strings obey CSV limits even when a short template omits excess columns', () => {
  const document = source();
  const cases = [
    { headers: ['name', 'unused'], rows: [{ name: 'Ada', unused: 'x'.repeat(100001) }] },
    { headers: ['name', 'name'], rows: [{ name: 'Ada' }] },
    { headers: ['name', '__proto__'], rows: [{ name: 'Ada', ['__proto__']: 'literal' }] },
    { headers: ['name'], rows: [{ name: 'Ada', extra: 'unlisted' }] },
    { headers: ['name'], rows: [{ name: 42 }] }
  ];
  for (const csv of cases) assert.throws(() => bulkCreate(document, document.pages[0].id, csv));
});

test('boundary CSV, malformed quotes and 100K-wide rows fail without output', () => {
  for (const csv of ['', false, null, 'name\n"unterminated', 'name\n' + 'x'.repeat(10001), ','.repeat(100001) + '\nvalue']) assert.throws(() => parseCSV(csv));
  assert.equal(parseCSV('name\n' + 'x'.repeat(10000)).rows[0].name.length, 10000);
});

test('HTML, SQL and shell-looking CSV values stay inert after rendering', () => {
  const document = source(); document.pages[0].name = 'Card'; document.pages[0].elements.push(createElement('text', { text: '{{name}}' }));
  const value = '<script>alert(1)</script> $(touch /tmp/never) DROP TABLE designs;';
  const next = bulkCreate(document, document.pages[0].id, { headers: ['name'], rows: [{ name: value }] });
  assert.equal(next.pages[0].elements[0].text, value);
  assert.ok(!pageSVG(next.pages[0]).includes('<script>'));
  assert.deepEqual(document.pages[0].elements[0].text, '{{name}}');
});

test('corrupted models and stale missing-page identifiers fail before mutating', () => {
  const document = source(), corrupt = structuredClone(document); corrupt.pages[0].width = Infinity;
  assert.throws(() => validateDocument(corrupt));
  assert.throws(() => bulkCreate(document, 'missing-page', 'name\nAda'));
  assert.equal(document.pages.length, 1);
});

test('aggregate embedded images are refused before serialising the entire oversized document', t => {
  const document = createDocument(), image = `data:image/png;base64,${'AAAA'.repeat(2 * 1024 * 1024 - 10)}`;
  document.pages[0].elements = Array.from({ length: 3 }, () => createElement('image', { src: image }));
  // Each embedded image is valid in isolation; their aggregate exceeds the document budget.
  const stringify = JSON.stringify; let entireDocumentSerialised = false;
  t.mock.method(JSON, 'stringify', (value, ...args) => { if (value === document) entireDocumentSerialised = true; return stringify(value, ...args); });
  assert.throws(() => validateDocument(document), /too large/);
  assert.equal(document.pages[0].elements.length, 3); assert.equal(entireDocumentSerialised, false);
});
