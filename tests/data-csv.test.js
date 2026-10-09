import test from 'node:test';
import assert from 'node:assert/strict';
import { parseDataCSV, serialiseDataCSV } from '../src/data-csv.js';
import { createDocument, createElement, editPage, updateElement, serialiseDocument, parseDocument, pageSVG } from '../src/model.js';

test('table CSV preserves literal quotes, Unicode, line breaks, duplicate headings and empty rows', () => {
  const data = { columns: ['\uFEFFA', '\uFEFFA'], rows: [['界,"quoted"\nnext', '=1+1'], ['', ''], ['<script>', 'x\ry']] };
  assert.deepEqual(parseDataCSV(serialiseDataCSV('table', data), 'table'), data);
  for (const rows of [[], [['']], [[''], ['']]]) {
    const one = { columns: ['One'], rows }; assert.deepEqual(parseDataCSV(serialiseDataCSV('table', one), 'table'), one);
  }
});
test('data CSV supports its retained model bounds while bulk parsing remains independent', () => {
  const data = { columns: Array.from({ length: 8 }, (_, i) => `Column ${i}`), rows: Array.from({ length: 50 }, () => Array(8).fill('data')) };
  assert.deepEqual(parseDataCSV(serialiseDataCSV('table', data), 'table'), data);
  assert.throws(() => parseDataCSV(serialiseDataCSV('table', { ...data, rows: [...data.rows, data.rows[0]] }), 'table'), /50/);
  assert.throws(() => parseDataCSV('Label,Value\nx,\n', 'chart'), /number/);
  for (const source of ['Label,Value\nx,-1', 'Label,Value\nx,Infinity', 'Label,Value\nx,1000000001', 'Label,Value\n,2', 'a,b\nx', 'a,b\n"unclosed,b', 'a,b\n"x"bad,2']) assert.throws(() => parseDataCSV(source, 'chart'));
});
test('CSV → native chart → re-edit → JSON and SVG keeps values, source isolation and stable identity', () => {
  const document = createDocument(), page = document.pages[0], element = createElement('chart', { data: { ...parseDataCSV('Label,Value\n"North, west",25.5\n界,74.5', 'chart'), kind: 'pie' } });
  const first = editPage(document, page.id, p => p.elements.push(element));
  const replacement = { ...parseDataCSV('Label,Value\nOnly,100', 'chart'), kind: 'pie' };
  const next = updateElement(first, page.id, element.id, { data: replacement }); replacement.values[0] = 1;
  const exported = parseDocument(serialiseDocument(next));
  assert.equal(exported.pages[0].elements[0].id, element.id); assert.equal(exported.pages[0].elements[0].data.values[0], 100);
  assert.equal(first.pages[0].elements[0].data.values[0], 25.5); assert.match(pageSVG(exported.pages[0]), /circle/);
});
