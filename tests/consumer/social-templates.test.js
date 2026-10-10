import test from 'node:test';
import assert from 'node:assert/strict';
import { SOCIAL_TEMPLATES, buildSocialTemplate } from '../../src/social-templates.js';
import { FONTS, createDocument, createPage, createElement, validateDocument, serialiseDocument, parseDocument, updateElement, pageSVG, wrapText } from '../../src/model.js';

const factories = { createDocument, createPage, createElement };
const layers = document => document.pages.flatMap(page => page.elements);
const ids = document => new Set([...document.pages.map(page => page.id), ...layers(document).map(element => element.id)]);

test('social catalogue has ten distinct original layouts and immutable useful metadata', () => {
  assert.equal(SOCIAL_TEMPLATES.length, 10);
  assert.equal(new Set(SOCIAL_TEMPLATES.map(template => template.key)).size, 10);
  assert.ok(Object.isFrozen(SOCIAL_TEMPLATES));
  for (const template of SOCIAL_TEMPLATES) {
    assert.ok(Object.isFrozen(template) && Object.isFrozen(template.tags));
    assert.match(template.key, /^social-[a-z-]+$/);
    assert.equal(template.group, 'social'); assert.ok(template.tags.length >= 3);
    assert.ok(template.name && template.category.includes('×'));
    assert.equal(template.pageCount, template.key === 'social-carousel' ? 5 : 1);
    assert.throws(() => { template.name = 'Changed'; }, TypeError);
  }
  assert.throws(() => SOCIAL_TEMPLATES[0].tags.push('changed'), TypeError);
});

test('unknown names do not call or even need model factories', () => {
  let calls = 0; const never = () => { calls++; throw new Error('No factory call was expected.'); };
  for (const key of ['unknown', '', '__proto__', 'constructor', null, undefined, 3]) assert.equal(buildSocialTemplate(key, { createDocument: never, createPage: never, createElement: never }), null);
  assert.equal(buildSocialTemplate('unknown'), null); assert.equal(calls, 0);
  assert.throws(() => buildSocialTemplate('social-product'), /factories/);
});

test('every layout validates as a complete native document and survives exact JSON round trip', () => {
  for (const template of SOCIAL_TEMPLATES) {
    const document = buildSocialTemplate(template.key, factories);
    assert.equal(document.title, template.name); assert.equal(document.pages.length, template.pageCount);
    assert.deepEqual(validateDocument(document), document);
    assert.deepEqual(parseDocument(serialiseDocument(document)), document);
    for (const page of document.pages) {
      assert.equal(page.width, template.width); assert.equal(page.height, template.height);
      assert.ok(page.elements.some(element => element.type === 'text'));
      assert.ok(page.elements.every(element => ['text', 'frame', 'rect', 'circle', 'shape'].includes(element.type)));
      assert.ok(page.elements.every(element => !element.locked && !element.hidden && element.groupId === null));
      for (const element of page.elements) if (element.type === 'text') assert.ok(FONTS.includes(element.fontFamily));
      assert.match(pageSVG(page), /^<svg/);
    }
    assert.equal(ids(document).size, document.pages.length + layers(document).length);
  }
});

test('native text and photo placeholders are within their canvas and text has room for its wrapped lines', () => {
  for (const template of SOCIAL_TEMPLATES) for (const page of buildSocialTemplate(template.key, factories).pages) for (const element of page.elements) {
    assert.ok(element.x >= 0 && element.y >= 0, `${template.key}: negative element origin`);
    assert.ok(element.x + element.width <= page.width + .000001, `${template.key}: horizontal bounds for ${element.text ?? element.type}`);
    assert.ok(element.y + element.height <= page.height + .000001, `${template.key}: vertical bounds for ${element.text ?? element.type}`);
    if (element.type === 'text') {
      const required = (wrapText(element).length - 1) * element.fontSize * element.lineHeight + element.fontSize;
      assert.ok(required <= element.height + .000001, `${template.key}: text wraps past its own height: ${element.text}`);
      assert.ok(required + element.y <= page.height + .000001, `${template.key}: text wraps outside its page`);
    }
    if (element.type === 'frame') { assert.equal(element.src, ''); assert.ok(!element.credit); }
  }
});

test('a new copy owns every page, layer, palette, crop and text value independently', () => {
  for (const template of SOCIAL_TEMPLATES) {
    const first = buildSocialTemplate(template.key, factories), second = buildSocialTemplate(template.key, factories);
    assert.ok([...ids(first)].every(id => !ids(second).has(id)));
    const snapshot = structuredClone(second);
    first.brand.colours[0] = '#abcdef'; first.pages[0].name = 'Changed page';
    layers(first).find(element => element.type === 'text').text = 'My own words';
    const frame = layers(first).find(element => element.type === 'frame'); if (frame) { frame.crop.width = .5; frame.filters.brightness = 0; }
    assert.deepEqual(second, snapshot);
    assert.deepEqual(buildSocialTemplate(template.key, factories).brand, snapshot.brand);
  }
});

test('the five-slide photo walk preserves its narrative order and each page stays separately editable', () => {
  const document = buildSocialTemplate('social-carousel', factories);
  assert.deepEqual(document.pages.map(page => page.name), ['Cover', 'Colour', 'Details', 'Light', 'Your turn']);
  document.pages.forEach((page, index) => {
    assert.ok(page.elements.some(element => element.type === 'frame'));
    assert.ok(page.elements.some(element => element.type === 'text' && element.text === `${index + 1} / 5`));
  });
  const page = document.pages[2], headline = page.elements.find(element => element.type === 'text' && element.fontSize > 60);
  const changed = updateElement(document, page.id, headline.id, { text: 'Your own advice' });
  assert.equal(changed.pages[2].elements.find(element => element.id === headline.id).text, 'Your own advice');
  assert.deepEqual(changed.pages.slice(0, 2), document.pages.slice(0, 2));
  assert.equal(document.pages[2].elements.find(element => element.id === headline.id).text, 'A small detail\ncan fill the frame.');
});

test('image-forward layouts hold editable photo frames rather than flattened image templates', () => {
  const pixel = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+iRGQAAAAASUVORK5CYII=';
  for (const template of SOCIAL_TEMPLATES.filter(template => template.key !== 'social-quote')) {
    const document = buildSocialTemplate(template.key, factories), page = document.pages[0], frame = page.elements.find(element => element.type === 'frame');
    assert.ok(frame, `${template.key} needs an editable photo placeholder`);
    assert.ok(!layers(document).some(element => element.type === 'image'));
    const changed = updateElement(document, page.id, frame.id, { src: pixel, sourceWidth: 1, sourceHeight: 1 });
    const inserted = changed.pages[0].elements.find(element => element.id === frame.id);
    assert.equal(inserted.type, 'frame'); assert.equal(inserted.src, pixel); assert.equal(frame.src, '');
    assert.equal(inserted.shape, frame.shape); assert.equal(inserted.x, frame.x); assert.equal(inserted.width, frame.width);
    assert.deepEqual(parseDocument(serialiseDocument(changed)), changed);
    assert.match(pageSVG(changed.pages[0]), /href="data:image\/png;base64,/);
  }
});

test('template artwork stays native and never starts a network request or embeds remote image claims', () => {
  const oldFetch = globalThis.fetch; let calls = 0;
  globalThis.fetch = () => { calls++; throw new Error('Templates must not fetch assets.'); };
  try {
    for (const template of SOCIAL_TEMPLATES) for (const page of buildSocialTemplate(template.key, factories).pages) {
      const svg = pageSVG(page);
      // The SVG namespace URL is an identifier, not an asset request.
      assert.doesNotMatch(svg, /(?:href|src)="https?:|url\(['"]?https?:|@import|foreignObject|<script|<image/);
      assert.equal((svg.match(/<text /g) ?? []).length, page.elements.filter(element => element.type === 'text').length);
    }
    assert.equal(calls, 0);
  } finally { globalThis.fetch = oldFetch; }
});
