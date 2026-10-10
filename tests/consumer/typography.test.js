import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultTextStyles, validateTextStyles, validateGradient, gradientSVG, fillReference, renderStyledText } from '../../src/typography.js';

const escapeXML = value => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&apos;');
const fixture = (patch = {}) => ({ id: 'headline', width: 500, height: 150, text: 'First\nSecond', fill: '#123456', fontFamily: 'Arial', fontSize: 40, fontWeight: 700, align: 'left', lineHeight: 1.5, letterSpacing: 4, ...defaultTextStyles(), gradient: null, ...patch });

test('native styles default to the legacy appearance and return independent records', () => {
  const first = defaultTextStyles(), second = defaultTextStyles();
  assert.deepEqual(first, { italic: false, underline: false, effect: 'none', effectColour: '#232a27', effectSize: 4 });
  assert.equal(validateTextStyles(first), first);
  first.italic = true; assert.equal(second.italic, false);
  const legacy = fixture(); for (const key of Object.keys(second)) delete legacy[key]; delete legacy.gradient;
  const svg = renderStyledText(legacy, ['First', 'Second'], escapeXML);
  assert.equal(svg, '<text fill="#123456" font-family="Arial" font-size="40" font-weight="700" letter-spacing="4" text-anchor="start" dominant-baseline="hanging"><tspan x="0" y="0">First</tspan><tspan x="0" y="60">Second</tspan></text>');
  assert.equal(renderStyledText(fixture(), ['First', 'Second'], escapeXML), svg);
});

test('complete native styles enforce booleans, supported effects, colours and bounded sizes', () => {
  for (const effect of ['none', 'shadow', 'outline']) for (const effectSize of [0, 0.5, 20]) validateTextStyles(fixture({ italic: true, underline: true, effect, effectSize }));
  for (const patch of [{ italic: 'yes' }, { underline: 1 }, { effect: 'glow' }, { effect: 'url(https://example.com)' }, { effectColour: '#fff' }, { effectColour: 'red" onload="alert(1)' }, { effectSize: -1 }, { effectSize: 20.001 }, { effectSize: NaN }, { effectSize: Infinity }, { effectSize: '4' }]) assert.throws(() => validateTextStyles(fixture(patch)));
  for (const key of Object.keys(defaultTextStyles())) { const value = fixture(); delete value[key]; assert.throws(() => validateTextStyles(value), /missing fields/); assert.throws(() => renderStyledText(value, ['First']), /missing fields/); }
});

test('gradient definitions preserve two colours and familiar horizontal and vertical directions', () => {
  assert.equal(validateGradient(null), null); assert.equal(gradientSVG('fill-1', null), '');
  assert.equal(fillReference('fill-1', '#abcdef', null), '#abcdef');
  const gradient = { from: '#aBcDeF', to: '#123456', angle: 0 };
  assert.equal(validateGradient(gradient), gradient);
  const horizontal = gradientSVG('fill-1', gradient);
  assert.match(horizontal, /x1="0%" y1="50%" x2="100%" y2="50%"/);
  assert.match(horizontal, /stop offset="0%" stop-color="#aBcDeF"/);
  assert.match(horizontal, /stop offset="100%" stop-color="#123456"/);
  assert.equal(fillReference('fill-1', '#abcdef', gradient), 'url(#fill-1)');
  assert.match(gradientSVG('fill-1', { ...gradient, angle: 90 }), /x1="50%" y1="0%" x2="50%" y2="100%"/);
  assert.match(gradientSVG('fill-1', { ...gradient, angle: 180 }), /x1="100%" y1="50%" x2="0%" y2="50%"/);
  assert.match(gradientSVG('fill-1', { ...gradient, angle: 270 }), /x1="50%" y1="100%" x2="50%" y2="0%"/);
  assert.match(gradientSVG('fill-1', { ...gradient, angle: 45 }), /x1="0%" y1="0%" x2="100%" y2="100%"/);
  assert.equal(gradientSVG('fill-1', { ...gradient, angle: 360 }), horizontal);
  assert.ok(!horizontal.includes('gradientTransform'));
});

test('gradient inputs and identifiers cannot introduce markup, external paint servers or unbounded angles', () => {
  const gradient = { from: '#abcdef', to: '#123456', angle: 45 };
  for (const value of [undefined, [], '#abcdef', { ...gradient, extra: true }, { ...gradient, angle: -0.01 }, { ...gradient, angle: 360.01 }, { ...gradient, angle: '90' }, { ...gradient, angle: NaN }, { ...gradient, angle: Infinity }, { ...gradient, from: 'url(https://example.com)' }, { ...gradient, to: '#fff' }, { from: '#abcdef', angle: 45 }, Object.create(gradient)]) assert.throws(() => validateGradient(value));
  for (const id of ['', 'a"/><script>alert(1)</script>', 'external#fill', 'with space', 'x'.repeat(181), null]) { assert.throws(() => gradientSVG(id, gradient)); assert.throws(() => fillReference(id, '#abcdef', gradient)); }
  assert.throws(() => fillReference('fill-1', 'url(https://example.com)', gradient));
});

test('italic, underline and outline remain genuine text with stable multiline alignment', () => {
  const original = fixture({ italic: true, underline: true, effect: 'outline', effectColour: '#fedcba', effectSize: 8, align: 'center' });
  const before = structuredClone(original);
  const svg = renderStyledText(original, ['First', 'Second'], escapeXML);
  assert.match(svg, /font-style="italic" text-decoration="underline"/);
  assert.match(svg, /stroke="#fedcba" stroke-width="8" stroke-linejoin="round" paint-order="stroke fill"/);
  assert.match(svg, /text-anchor="middle"/); assert.match(svg, /<tspan x="250" y="60">Second<\/tspan>/);
  assert.equal((svg.match(/<text /g) ?? []).length, 1); assert.ok(!svg.includes('foreignObject'));
  assert.deepEqual(original, before);
  assert.match(renderStyledText(fixture({ align: 'right' }), ['Last']), /text-anchor="end".*<tspan x="500" y="0">Last/);
});

test('shadow and gradient definitions are self-contained, bounded and use separate identifiers', () => {
  const svg = renderStyledText(fixture({ effect: 'shadow', effectColour: '#102030', effectSize: 20, gradient: { from: '#abcdef', to: '#fedcba', angle: 90 } }), ['Headline']);
  assert.match(svg, /linearGradient id="stencil-text-fill-headline"/);
  assert.match(svg, /fill="url\(#stencil-text-fill-headline\)"/);
  assert.match(svg, /filter id="stencil-text-shadow-headline" x="-100%" y="-100%" width="300%" height="300%"/);
  assert.match(svg, /feDropShadow dx="10" dy="10" stdDeviation="5" flood-color="#102030" flood-opacity="1"/);
  assert.match(svg, /filter="url\(#stencil-text-shadow-headline\)"/);
  assert.equal((svg.match(/<text /g) ?? []).length, 1);
  assert.ok(!/https?:|href=|foreignObject|<script/i.test(svg));
  for (const effect of ['shadow', 'outline']) { const disabled = renderStyledText(fixture({ effect, effectSize: 0 }), ['Headline']); assert.ok(!/filter=|stroke=|feDropShadow/.test(disabled)); }
});

test('text, family and unrelated malicious metadata cannot introduce SVG markup', () => {
  const attack = '\"/><script>alert(1)</script><text fill=\"red';
  const element = fixture({ fontFamily: attack, metadata: { content: attack, url: 'https://example.com' } });
  const svg = renderStyledText(element, [attack, '& < > " \''], escapeXML);
  assert.ok(!svg.includes('<script')); assert.ok(!svg.includes('https://')); assert.ok(!svg.includes('fill="red'));
  assert.match(svg, /font-family="&quot;\/&gt;&lt;script&gt;/);
  assert.match(svg, /&amp; &lt; &gt; &quot; &apos;/);
  assert.throws(() => renderStyledText(fixture({ id: attack }), ['First']));
  assert.throws(() => renderStyledText(fixture({ fill: attack }), ['First']));
  assert.throws(() => renderStyledText(fixture({ fontFamily: '\u0000' }), ['First']));
});

test('getters on known and unrelated fields never run during validation or rendering', () => {
  let calls = 0;
  for (const key of ['effect', 'effectSize', 'unrelated']) {
    const value = fixture(); Object.defineProperty(value, key, { enumerable: true, get() { calls++; return 'none'; } });
    assert.throws(() => validateTextStyles(value), /ordinary data fields/);
    assert.throws(() => renderStyledText(value, ['First']), /ordinary data fields/);
  }
  const gradient = { from: '#abcdef', to: '#123456' }; Object.defineProperty(gradient, 'angle', { enumerable: true, get() { calls++; return 90; } });
  assert.throws(() => validateGradient(gradient), /ordinary data fields/);
  assert.throws(() => gradientSVG('fill-1', gradient), /ordinary data fields/);
  const lines = ['First']; Object.defineProperty(lines, '0', { enumerable: true, get() { calls++; return 'First'; } });
  assert.throws(() => renderStyledText(fixture(), lines), /ordinary values/);
  assert.equal(calls, 0);
});

test('nonordinary fields, arrays and oversized wrapped text are rejected before rendering', () => {
  const hidden = fixture(); Object.defineProperty(hidden, 'effect', { value: 'none', enumerable: false }); assert.throws(() => validateTextStyles(hidden));
  const symbol = fixture(); symbol[Symbol('style')] = true; assert.throws(() => validateTextStyles(symbol));
  assert.throws(() => validateTextStyles(Object.create(defaultTextStyles())));
  for (const lines of [[], new Array(1), [new String('First')], ['x'.repeat(10001)], Array.from({ length: 10002 }, () => ''), ['First\u0000']]) assert.throws(() => renderStyledText(fixture(), lines));
  const extra = ['First']; extra.label = 'ignored'; assert.throws(() => renderStyledText(fixture(), extra));
  for (const patch of [{ width: 0 }, { width: Infinity }, { fontSize: '40' }, { fontWeight: 900 }, { align: 'justify' }, { lineHeight: 3.001 }, { letterSpacing: -10.001 }]) assert.throws(() => renderStyledText(fixture(patch), ['First']));
  assert.throws(() => renderStyledText(fixture(), ['First'], null));
});
