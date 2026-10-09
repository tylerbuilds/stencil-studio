import test from 'node:test';
import assert from 'node:assert/strict';
import { TABLE_FIELDS, CHART_FIELDS, defaultsForDataElement, validateDataElementFields, renderDataElement } from '../src/data-elements.js';

const element = (type, patch = {}) => ({ id: 'native-data-element', type, width: 600, height: 300, fill: type === 'table' ? '#f6f1e7' : '#e76543', ...defaultsForDataElement(type), ...patch });
const valid = value => assert.equal(validateDataElementFields(value), value);

test('table and chart defaults are independent editable data with every declared field', () => {
  const table = element('table'), otherTable = element('table'), chart = element('chart'), otherChart = element('chart');
  assert.deepEqual(Object.keys(defaultsForDataElement('table')).sort(), [...TABLE_FIELDS].sort());
  assert.deepEqual(Object.keys(defaultsForDataElement('chart')).sort(), [...CHART_FIELDS].sort());
  valid(table); valid(chart);
  table.data.rows[0][0] = 'Changed cell'; chart.data.values[0] = 800; chart.palette[0] = '#000000';
  assert.equal(otherTable.data.rows[0][0], 'First'); assert.equal(otherChart.data.values[0], 10); assert.equal(otherChart.palette[0], '#e76543');
  assert.throws(() => defaultsForDataElement('image'), /chart or table/);
});

test('retained table content round-trips literal markup, multiline cells and Unicode unchanged', () => {
  const table = element('table', { data: { columns: ['日本語', 'Zoë & café'], rows: [['<script>alert("x")</script>', 'First\nSecond'], ['=SUM(A1)', 'constructor']] } });
  const before = JSON.stringify(table);
  valid(table); valid(JSON.parse(before));
  const svg = renderDataElement(table);
  assert.match(svg, /&lt;script&gt;alert\(&quot;x&quot;\)&lt;\/script&gt;/);
  assert.match(svg, /日本語|Zoë &amp; café/);
  assert.doesNotMatch(svg, /<script>|<image|<foreignObject|href=|https?:/);
  assert.match(svg, /clip-path="url\(#stencil-data-cell-native-data-element-r1-c0\)"/);
  assert.equal(JSON.stringify(table), before);
  assert.deepEqual(JSON.parse(before).data, table.data);
});

test('table bounds accept zero rows and maximum size but reject invalid dimensions and non-string cells', () => {
  valid(element('table', { header: false, data: { columns: ['Only column'], rows: [] } }));
  const maximum = element('table', { data: { columns: Array.from({ length: 8 }, (_, index) => `Column ${index}`), rows: Array.from({ length: 50 }, () => Array(8).fill('x'.repeat(1000))) } });
  valid(maximum);
  for (const data of [
    { columns: [], rows: [] }, { columns: Array(9).fill('Column'), rows: [] },
    { columns: ['Column'], rows: Array.from({ length: 51 }, () => ['Cell']) },
    { columns: ['Column'], rows: [['Cell', 'Extra']] }, { columns: ['Column'], rows: [[10]] },
    { columns: ['Column'], rows: [['x'.repeat(1001)]] }, { columns: ['  '], rows: [] },
    { columns: ['Column'], rows: [['Null\u0000byte']] }, { columns: ['Column'], rows: [], externalURL: 'https://example.com' }
  ]) assert.throws(() => validateDataElementFields(element('table', { data })));
});

test('chart numbers retain fractional values and allow all-zero bar/line charts', () => {
  for (const kind of ['bar', 'line']) {
    const chart = element('chart', { data: { kind, labels: ['Zero', 'Fraction', 'Maximum'], values: [0, .125, 1_000_000_000] } });
    valid(chart);
    assert.deepEqual(JSON.parse(JSON.stringify(chart)).data.values, [0, .125, 1_000_000_000]);
    valid(element('chart', { data: { kind, labels: ['Zero'], values: [0] } }));
  }
  valid(element('chart', { data: { kind: 'pie', labels: ['Zero', 'Positive'], values: [0, .125] } }));
  valid(element('chart', { data: { kind: 'bar', labels: Array.from({ length: 30 }, (_, index) => `Item ${index}`), values: Array(30).fill(0) } }));
});

test('chart schema rejects mismatched, non-finite, negative, oversized and empty pie data', () => {
  for (const data of [
    { kind: 'scatter', labels: ['One'], values: [1] }, { kind: 'bar', labels: [], values: [] },
    { kind: 'bar', labels: ['One', 'Two'], values: [1] }, { kind: 'bar', labels: ['One'], values: [-1] },
    { kind: 'bar', labels: ['One'], values: [Infinity] }, { kind: 'bar', labels: ['One'], values: [NaN] },
    { kind: 'bar', labels: ['One'], values: ['1'] }, { kind: 'bar', labels: ['One'], values: [1_000_000_001] },
    { kind: 'pie', labels: ['Zero', 'Also zero'], values: [0, 0] },
    { kind: 'bar', labels: Array(31).fill('Item'), values: Array(31).fill(1) },
    { kind: 'bar', labels: ['x'.repeat(101)], values: [1] }, { kind: 'line', labels: [' '], values: [1] },
    { kind: 'pie', labels: ['One'], values: [1], secret: true }
  ]) assert.throws(() => validateDataElementFields(element('chart', { data })));
});

test('nested accessors, sparse arrays, custom prototypes and unsupported properties never become retained data', () => {
  let accessorCalls = 0;
  const top = element('table'); Object.defineProperty(top, 'type', { get() { accessorCalls++; return 'table'; }, enumerable: true });
  const nested = element('table'); Object.defineProperty(nested.data, 'columns', { get() { accessorCalls++; return ['Column']; }, enumerable: true });
  const array = element('chart'); Object.defineProperty(array.data.labels, '0', { get() { accessorCalls++; return 'Label'; }, enumerable: true });
  for (const value of [top, nested, array]) assert.throws(() => validateDataElementFields(value), /ordinary/);
  assert.equal(accessorCalls, 0);
  const sparse = element('chart'); delete sparse.data.values[1];
  assert.throws(() => validateDataElementFields(sparse), /missing entries/);
  const prototype = element('table'); Object.setPrototypeOf(prototype.data, { inherited: true });
  assert.throws(() => validateDataElementFields(prototype), /plain object/);
  const arrayPrototype = element('chart'); Object.setPrototypeOf(arrayPrototype.palette, Object.create(Array.prototype));
  assert.throws(() => validateDataElementFields(arrayPrototype), /entries/);
  const extra = element('table'); extra.data.rows[0].note = 'Unserialised surprise';
  assert.throws(() => validateDataElementFields(extra), /unsupported/);
  const symbol = element('chart'); symbol.data[Symbol('secret')] = true;
  assert.throws(() => validateDataElementFields(symbol), /unsupported/);
  const hidden = element('chart'); Object.defineProperty(hidden.data, 'values', { value: hidden.data.values, enumerable: false });
  assert.throws(() => validateDataElementFields(hidden), /ordinary/);
});

test('style fields remain strict local values rather than URLs or executable markup', () => {
  const invalidTable = { fontFamily: 'Remote Font', fontSize: 101, header: 'true', headerFill: 'url(https://example.com)', headerTextFill: '#fff', borderColor: 'red', borderWidth: 11, textFill: 'javascript:alert(1)' };
  for (const [key, value] of Object.entries(invalidTable)) assert.throws(() => validateDataElementFields(element('table', { [key]: value })));
  const invalidChart = { showLabels: 1, showValues: null, palette: [], header: true, fontSize: 3, textFill: '#ffff' };
  for (const [key, value] of Object.entries(invalidChart)) assert.throws(() => validateDataElementFields(element('chart', { [key]: value })));
  assert.throws(() => validateDataElementFields(element('chart', { palette: Array(9).fill('#000000') })));
  assert.throws(() => validateDataElementFields(element('chart', { palette: ['https://example.com/paint'] })));
  const missing = element('table'); delete missing.header;
  assert.throws(() => validateDataElementFields(missing), /missing/);
});

test('bar geometry follows retained values and a subsequent data edit changes actual artwork', () => {
  const chart = element('chart', { showLabels: false, showValues: false, data: { kind: 'bar', labels: ['Half', 'Full', 'Zero'], values: [10, 20, 0] } });
  const before = JSON.stringify(chart), svg = renderDataElement(chart);
  const widths = [...svg.matchAll(/<rect x="[^"]+" y="[^"]+" width="([^"]+)" height="[^"]+" fill="#e76543"/g)].map(match => Number(match[1]));
  assert.equal(widths.length, 3); assert.equal(widths[0] * 2, widths[1]); assert.equal(widths[2], 0);
  const updated = structuredClone(chart); updated.data.values[0] = 20;
  assert.notEqual(renderDataElement(updated), svg);
  assert.equal(JSON.stringify(chart), before);
});

test('line charts render real polyline and points with no non-finite geometry, including one point and zero values', () => {
  for (const values of [[0], [2, 4, 1], [0, 0]]) {
    const chart = element('chart', { data: { kind: 'line', labels: values.map((_, index) => `Point ${index}`), values } });
    const svg = renderDataElement(chart);
    assert.match(svg, /<polyline points="[0-9., ]+"/);
    assert.equal([...svg.matchAll(/<circle /g)].length, values.length);
    assert.doesNotMatch(svg, /NaN|Infinity|undefined/);
    const coords = svg.match(/<polyline points="([^"]+)"/)[1].split(' ').map(point => point.split(',').map(Number));
    assert.ok(coords.every(([x, y]) => Number.isFinite(x) && Number.isFinite(y) && x >= 0 && x <= chart.width && y >= 0 && y <= chart.height));
  }
});

test('pie charts draw a full circle for a single positive slice and real arcs for multiple slices', () => {
  const single = element('chart', { showLabels: false, showValues: false, data: { kind: 'pie', labels: ['Zero', 'Whole', 'Zero again'], values: [0, 5, 0] } });
  const circle = renderDataElement(single);
  assert.equal([...circle.matchAll(/<circle /g)].length, 1); assert.doesNotMatch(circle, /<path /);
  const multiple = element('chart', { showLabels: false, showValues: false, data: { kind: 'pie', labels: ['Three quarters', 'Quarter'], values: [3, 1] } });
  const arcs = renderDataElement(multiple);
  assert.equal([...arcs.matchAll(/<path d="M /g)].length, 2);
  assert.match(arcs, / A [0-9.]+ [0-9.]+ 0 1 1 /); assert.match(arcs, / A [0-9.]+ [0-9.]+ 0 0 1 /);
  assert.doesNotMatch(arcs, /NaN|Infinity|undefined/);
});

test('all native data artworks clip locally and escape user content without mutating it', () => {
  const drawings = [element('table'), ...['bar', 'line', 'pie'].map(kind => element('chart', { data: { kind, labels: ['<path onload="evil()">', '日本語 & café'], values: [1, 2] } }))];
  for (const drawing of drawings) {
    const before = JSON.stringify(drawing), svg = renderDataElement(drawing);
    assert.match(svg, /<clipPath id="stencil-data-root-native-data-element"/);
    assert.match(svg, /<g clip-path="url\(#stencil-data-root-native-data-element\)">/);
    assert.doesNotMatch(svg, /onload="evil|<foreignObject|<script|https?:|NaN|Infinity/);
    if (drawing.type === 'chart') assert.match(svg, /&lt;path onload=&quot;evil\(\)&quot;&gt;/);
    assert.equal(JSON.stringify(drawing), before);
  }
  assert.throws(() => renderDataElement(element('chart', { id: 'unsafe"><script>' })), /valid element ID/);
  assert.throws(() => renderDataElement(element('chart', { width: Infinity })), /between/);
  assert.throws(() => renderDataElement(element('table', { fill: 'url(https://example.com)' })), /hex/);
});

test('root and cell clip IDs cannot collide between otherwise valid native element IDs', () => {
  const table = element('table', { id: 'foo' });
  const chart = element('chart', { id: 'foo-r0-c0' });
  const anotherTable = element('table', { id: 'foo-r0-c0-r1-c1' });
  const svg = [table, chart, anotherTable].map(item => renderDataElement(item)).join('');
  const definitions = [...svg.matchAll(/<clipPath id="([^"]+)"/g)].map(match => match[1]);
  assert.equal(new Set(definitions).size, definitions.length);
  assert.ok(definitions.includes('stencil-data-root-foo-r0-c0'));
  assert.ok(definitions.includes('stencil-data-cell-foo-r0-c0'));
});
