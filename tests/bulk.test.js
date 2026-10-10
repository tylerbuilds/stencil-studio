import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCSV, bulkCreate } from '../src/bulk.js';
import { createDocument, createElement, editPage } from '../src/model.js';
test('CSV handles literal quoted commas, escaped quotes, multiline fields and BOM/CRLF', () => {
  const parsed = parseCSV('\uFEFFname,note\r\nAda,"Good, very good"\r\nSam,"A ""quote""\nand a new line"\r\n');
  assert.deepEqual(parsed.headers, ['name', 'note']);
  assert.equal(parsed.rows[0].note, 'Good, very good');
  assert.equal(parsed.rows[1].note, 'A "quote"\nand a new line');
});
test('malformed CSV, reserved duplicate headers, ragged rows and missing data fail closed', () => {
  for (const csv of ['name,name\na,b', '__proto__,note\na,b', 'name,note\na', 'name\n"open', 'name\n"closed"x', 'name\n', 'name\nba"d']) assert.throws(() => parseCSV(csv));
});
test('bulk creation substitutes literal text, owns identifiers and leaves original unchanged', () => {
  const first = createDocument(); first.pages[0].name = '{{name}} card';
  const doc = editPage(first, first.pages[0].id, p => p.elements.push(createElement('text', { text: 'Hello {{name}}\n{{note}}' })));
  const next = bulkCreate(doc, doc.pages[0].id, 'name,note\nAda,<script>\nSam,Second');
  assert.equal(next.pages.length, 2); assert.equal(next.pages[0].name, 'Ada card');
  assert.equal(next.pages[0].elements[0].text, 'Hello Ada\n<script>');
  assert.notEqual(next.pages[0].id, doc.pages[0].id); assert.notEqual(next.pages[0].elements[0].id, next.pages[1].elements[0].id);
  assert.equal(doc.pages[0].elements[0].text, 'Hello {{name}}\n{{note}}');
  assert.throws(() => bulkCreate(doc, doc.pages[0].id, 'other\nAda'), /Add the column “name” to the CSV file\./);
});
