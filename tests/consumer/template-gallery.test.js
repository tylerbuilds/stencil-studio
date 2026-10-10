import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { TEMPLATE_CATEGORIES, templateCategory, filterTemplates } from '../../src/template-gallery.js';
import { TEMPLATES, templateDocument, validateDocument, serialiseDocument, parseDocument, updateElement, pageSVG } from '../../src/model.js';

const keys = templates => templates.map(template => template.key);
const layers = document => document.pages.flatMap(page => page.elements);
const documentIds = document => [...document.pages.map(page => page.id), ...layers(document).map(element => element.id)];
const categoryKeys = {
  posts: ['social', 'launch', 'collage', 'quote', 'social-product', 'social-photo', 'social-carousel', 'social-quote', 'social-announcement', 'social-pinterest', 'social-editorial'],
  stories: ['story', 'social-event-story'],
  covers: ['banner', 'social-thumbnail', 'social-cover'],
  other: ['poster', 'card', 'presentation', 'resume', 'menu', 'invitation', 'journal', 'planner']
};

test('practical categories expose all 24 layouts once, including legacy print designs', () => {
  assert.deepEqual(TEMPLATE_CATEGORIES.map(category => category.key), ['all', 'posts', 'stories', 'covers', 'other']);
  assert.ok(Object.isFrozen(TEMPLATE_CATEGORIES));
  assert.ok(TEMPLATE_CATEGORIES.every(category => Object.isFrozen(category) && category.name));
  assert.equal(TEMPLATES.length, 24);
  assert.equal(new Set(keys(TEMPLATES)).size, 24);
  const reached = [];
  for (const [category, expected] of Object.entries(categoryKeys)) {
    const found = filterTemplates(TEMPLATES, { category });
    assert.deepEqual(keys(found), expected, category);
    assert.ok(found.every(template => templateCategory(template) === category));
    reached.push(...keys(found));
  }
  assert.equal(new Set(reached).size, 24);
  assert.deepEqual(reached.toSorted(), keys(TEMPLATES).toSorted());
});

test('search finds names, practical types, keys and discovery tags', () => {
  for (const [query, expected] of [
    ['Sunday, slowly', ['social-photo']],
    ['CV', ['resume']],
    ['social-carousel', ['social-carousel']],
    ['lifestyle', ['social-pinterest']],
    ['craft', ['social-thumbnail']],
    ['announcement', ['social-announcement']],
    ['carousel', ['social-carousel']]
  ]) assert.deepEqual(keys(filterTemplates(TEMPLATES, { query })), expected, query);
  assert.deepEqual(filterTemplates(TEMPLATES, { query: 'a design that is not here' }), []);
});

test('multiword searches ignore case, accents and extra whitespace while requiring every term', () => {
  assert.deepEqual(keys(filterTemplates(TEMPLATES, { query: '  OPÉN   PHÓTO\t' })), ['social-announcement']);
  assert.deepEqual(keys(filterTemplates(TEMPLATES, { query: 'MÉMORY' })), ['social-photo']);
  assert.deepEqual(keys(filterTemplates(TEMPLATES, { query: 'WALK PHÓTO' })), ['social-carousel']);
  assert.deepEqual(filterTemplates(TEMPLATES, { query: 'walk quote' }), []);
});

test('search narrows the chosen type and clearing it restores that type', () => {
  assert.deepEqual(keys(filterTemplates(TEMPLATES, { category: 'posts', query: 'quote' })), ['quote', 'social-quote']);
  assert.deepEqual(keys(filterTemplates(TEMPLATES, { category: 'stories', query: 'event' })), ['social-event-story']);
  assert.deepEqual(keys(filterTemplates(TEMPLATES, { category: 'covers', query: 'craft' })), ['social-thumbnail']);
  assert.deepEqual(filterTemplates(TEMPLATES, { category: 'posts', query: 'craft' }), []);
  assert.deepEqual(keys(filterTemplates(TEMPLATES, { category: 'other', query: 'photo' })), ['journal']);
  assert.deepEqual(keys(filterTemplates(TEMPLATES, { category: 'covers', query: '   ' })), categoryKeys.covers);
  assert.deepEqual(keys(filterTemplates(TEMPLATES, { category: 'all', query: 'craft' })), ['social-thumbnail']);
});

test('filtering preserves catalogue order and ownership and enforces the search limit', () => {
  const snapshot = structuredClone(TEMPLATES);
  const all = filterTemplates(TEMPLATES);
  assert.deepEqual(keys(all), keys(TEMPLATES));
  assert.notEqual(all, TEMPLATES);
  all.forEach((template, index) => assert.equal(template, TEMPLATES[index]));
  all.pop();
  assert.deepEqual(TEMPLATES, snapshot);
  assert.equal(filterTemplates(TEMPLATES, { query: ' '.repeat(120) }).length, 24);
  for (const query of [null, 12, false, {}, [], ' '.repeat(121)]) {
    assert.throws(() => filterTemplates(TEMPLATES, { query }), /shorter search/);
  }
  for (const category of ['unknown', 'constructor', '', null, 1]) {
    assert.throws(() => filterTemplates(TEMPLATES, { category }), /template type/);
  }
});

test('every gallery result opens a native design with editable text and independently owned IDs', () => {
  for (const template of TEMPLATES) {
    const results = filterTemplates(TEMPLATES, { category: templateCategory(template), query: template.name });
    assert.ok(results.includes(template), `${template.key} must remain discoverable by name`);
    const first = templateDocument(template.key), second = templateDocument(template.key);
    assert.equal(first.title, template.name);
    assert.deepEqual(validateDocument(first), first);
    assert.deepEqual(parseDocument(serialiseDocument(first)), first);
    assert.equal(first.pages.length, template.pageCount ?? (template.key === 'presentation' ? 2 : 1));
    const firstIds = documentIds(first), secondIds = new Set(documentIds(second));
    assert.equal(new Set(firstIds).size, firstIds.length, `${template.key}: IDs within a design`);
    assert.ok(firstIds.every(id => !secondIds.has(id)), `${template.key}: fresh IDs when opened again`);
    const savedSecond = structuredClone(second);
    for (const page of first.pages) {
      const editableText = page.elements.find(element => element.type === 'text' && !element.hidden && !element.locked);
      assert.ok(editableText, `${template.key}: editable words on ${page.name}`);
      assert.match(pageSVG(page), /<text /, `${template.key}: semantic SVG text`);
      const changed = updateElement(first, page.id, editableText.id, { text: 'Words for my own design', fill: '#345678' });
      const changedText = changed.pages.find(item => item.id === page.id).elements.find(element => element.id === editableText.id);
      assert.equal(changedText.text, 'Words for my own design');
      assert.equal(changedText.fill, '#345678');
      assert.equal(changedText.type, 'text');
      assert.notEqual(editableText.text, changedText.text);
      assert.deepEqual(parseDocument(serialiseDocument(changed)), changed);
    }
    first.brand.colours[0] = '#abcdef';
    first.pages[0].name = 'My page';
    layers(first).find(element => element.type === 'text').text = 'My words';
    assert.deepEqual(second, savedSecond, `${template.key}: separate template instances`);
  }
});

test('all photo frames remain separate editable layers after a gallery design is opened', () => {
  const pixel = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+iRGQAAAAASUVORK5CYII=';
  let photoDesigns = 0;
  for (const template of filterTemplates(TEMPLATES)) {
    const document = templateDocument(template.key);
    const pagesWithFrames = document.pages.filter(page => page.elements.some(element => element.type === 'frame'));
    if (pagesWithFrames.length) photoDesigns++;
    for (const page of pagesWithFrames) for (const frame of page.elements.filter(element => element.type === 'frame')) {
      assert.equal(frame.src, '', `${template.key}: user photo placeholder`);
      assert.ok(!frame.locked && !frame.hidden, `${template.key}: visible editable frame`);
      const changed = updateElement(document, page.id, frame.id, { src: pixel, sourceWidth: 1, sourceHeight: 1 });
      const inserted = changed.pages.find(item => item.id === page.id).elements.find(element => element.id === frame.id);
      assert.equal(inserted.src, pixel);
      assert.equal(inserted.type, 'frame');
      assert.equal(inserted.shape, frame.shape);
      assert.deepEqual([inserted.x, inserted.y, inserted.width, inserted.height], [frame.x, frame.y, frame.width, frame.height]);
      assert.equal(frame.src, '');
      assert.deepEqual(parseDocument(serialiseDocument(changed)), changed);
    }
  }
  assert.equal(photoDesigns, 13);
});

test('the gallery form presents the same categories and bounded search as the module', () => {
  const html = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');
  for (const id of ['templates-tab', 'templates-panel', 'template-search', 'template-category', 'template-count', 'templates', 'blank-design']) {
    assert.equal([...html.matchAll(/\bid="([^"]+)"/g)].filter(match => match[1] === id).length, 1, `one #${id}`);
  }
  const categorySelect = html.match(/<select\b[^>]*\bid="template-category"[^>]*>([\s\S]*?)<\/select>/)?.[1];
  assert.ok(categorySelect);
  assert.deepEqual([...categorySelect.matchAll(/<option\b[^>]*\bvalue="([^"]+)"/g)].map(match => match[1]), TEMPLATE_CATEGORIES.map(category => category.key));
  assert.match(html, /<input\b[^>]*\bid="template-search"[^>]*\bmaxlength="120"/);
  assert.match(html, /<p\b[^>]*\bid="template-count"[^>]*\baria-live="polite"/);
});
