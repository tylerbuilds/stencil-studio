import test from 'node:test';
import assert from 'node:assert/strict';
import { createDocument, createPage, createElement, makeSizeCopies, PRESETS } from '../../src/model.js';

test('social size copies keep the selected order after their original without moving unrelated pages', () => {
  const document = createDocument(), page = document.pages[0];
  page.name = 'Original post'; page.elements.push(createElement('text', { text: 'Still editable', x: 60, y: 80 }));
  document.pages.push({ ...createPage(), name: 'An unrelated page' });
  const original = structuredClone(document), keys = ['portrait', 'story', 'linkedin'];
  const next = makeSizeCopies(document, page.id, keys);
  assert.deepEqual(document, original); assert.deepEqual(next.pages[0], original.pages[0]);
  assert.deepEqual(next.pages.slice(1, 4).map(page => [page.name, page.width, page.height]), keys.map(key => { const preset = PRESETS.find(preset => preset.key === key); return [preset.name, preset.width, preset.height]; }));
  assert.deepEqual(next.pages[4], original.pages[1]);
  assert.ok(next.pages.slice(1, 4).every(copy => copy.elements[0].text === 'Still editable' && copy.id !== page.id && copy.elements[0].id !== page.elements[0].id));
  next.pages[1].elements[0].text = 'Edited copy'; assert.equal(next.pages[2].elements[0].text, 'Still editable');
});
