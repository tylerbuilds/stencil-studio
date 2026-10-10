/** Retained chart/table data and SVG artwork. No DOM, network or model imports. */
export const TABLE_FIELDS = ['data', 'fontFamily', 'fontSize', 'header', 'headerFill', 'headerTextFill', 'textFill', 'borderColor', 'borderWidth'];
export const CHART_FIELDS = ['data', 'fontFamily', 'fontSize', 'textFill', 'showLabels', 'showValues', 'palette'];
const COMMON_FIELDS = ['id', 'type', 'x', 'y', 'width', 'height', 'rotation', 'fill', 'opacity', 'locked', 'hidden', 'flipX', 'flipY', 'groupId'];
const FONTS = ['Arial', 'Georgia', 'Courier New'];
const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const fail = message => { throw new Error(message); };

function plain(value, name, allowed, required = allowed) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) fail(`${name} must be a plain object.`);
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== 'string' || !allowed.includes(key)) fail(`${name} contains unsupported fields.`);
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !own(descriptor, 'value') || !descriptor.enumerable) fail(`${name} must contain ordinary data fields.`);
  }
  if (required.some(key => !own(value, key))) fail(`${name} has missing fields.`);
}

function list(value, name, minimum, maximum) {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype || value.length < minimum || value.length > maximum) fail(`${name} needs between ${minimum} and ${maximum} entries.`);
  for (const key of Reflect.ownKeys(value)) {
    if (key === 'length') continue;
    if (typeof key !== 'string' || !/^(?:0|[1-9][0-9]*)$/.test(key) || Number(key) >= value.length) fail(`${name} contains unsupported properties.`);
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !own(descriptor, 'value') || !descriptor.enumerable) fail(`${name} must contain ordinary values.`);
  }
  for (let index = 0; index < value.length; index++) if (!own(value, index)) fail(`${name} must not contain missing entries.`);
}

function text(value, name, maximum, nonempty = false) {
  if (typeof value !== 'string' || value.length > maximum || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value) || (nonempty && !value.trim())) fail(`${name} must be valid text${nonempty ? ' with a non-empty label' : ''} up to ${maximum} characters.`);
}
function numeric(value, name, minimum, maximum) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum || value > maximum) fail(`${name} must be between ${minimum} and ${maximum}.`);
}
function colour(value, name) { if (typeof value !== 'string' || !/^#[0-9a-f]{6}$/i.test(value)) fail(`${name} must be a six-digit hex colour.`); }
function boolean(value, name) { if (typeof value !== 'boolean') fail(`${name} must be true or false.`); }

export function defaultsForDataElement(type) {
  if (type === 'table') return {
    data: { columns: ['Item', 'Details', 'Value'], rows: [['First', 'A starting point', '10'], ['Second', 'Another idea', '20'], ['Third', 'Your next step', '30']] },
    fontFamily: 'Arial', fontSize: 20, header: true, headerFill: '#232a27', headerTextFill: '#ffffff', textFill: '#232a27', borderColor: '#c5d6c8', borderWidth: 1
  };
  if (type === 'chart') return {
    data: { kind: 'bar', labels: ['First', 'Second', 'Third'], values: [10, 20, 30] },
    fontFamily: 'Arial', fontSize: 20, textFill: '#232a27', showLabels: true, showValues: true, palette: ['#e76543', '#6852a1', '#2b6b5b']
  };
  fail("Choose a chart or table.");
}

/** Checks complete type-specific fields; the document model checks common geometry. */
export function validateDataElementFields(element) {
  // Inspect descriptors before reading type or any nested value: accessors never run.
  plain(element, 'Data element', [...COMMON_FIELDS, ...TABLE_FIELDS, ...CHART_FIELDS], ['type']);
  const fields = element.type === 'table' ? TABLE_FIELDS : element.type === 'chart' ? CHART_FIELDS : null;
  if (!fields) fail("Choose a chart or table.");
  plain(element, 'Data element', [...COMMON_FIELDS, ...fields], ['type', ...fields]);
  if (!FONTS.includes(element.fontFamily)) fail("Choose a font available in Stencil Studio.");
  numeric(element.fontSize, 'Data font size', 4, 100);
  colour(element.textFill, 'Data text colour');
  if (element.type === 'table') {
    plain(element.data, 'Table data', ['columns', 'rows']);
    list(element.data.columns, 'Table columns', 1, 8);
    element.data.columns.forEach(value => text(value, 'Table column', 100, true));
    list(element.data.rows, 'Table rows', 0, 50);
    element.data.rows.forEach(row => {
      list(row, 'Table row', element.data.columns.length, element.data.columns.length);
      row.forEach(value => text(value, 'Table cell', 1000));
    });
    boolean(element.header, 'Table header');
    for (const field of ['headerFill', 'headerTextFill', 'borderColor']) colour(element[field], field);
    numeric(element.borderWidth, 'Table border width', 0, 10);
  } else {
    plain(element.data, 'Chart data', ['kind', 'labels', 'values']);
    if (!['bar', 'line', 'pie'].includes(element.data.kind)) fail('Choose a bar, line or pie chart.');
    list(element.data.labels, 'Chart labels', 1, 30);
    element.data.labels.forEach(value => text(value, 'Chart label', 100, true));
    list(element.data.values, 'Chart values', element.data.labels.length, element.data.labels.length);
    element.data.values.forEach(value => numeric(value, 'Chart value', 0, 1_000_000_000));
    if (element.data.kind === 'pie' && element.data.values.reduce((sum, value) => sum + value, 0) <= 0) fail("A pie chart needs at least one value above zero.");
    boolean(element.showLabels, 'Chart labels'); boolean(element.showValues, 'Chart values');
    list(element.palette, 'Chart palette', 1, 8);
    element.palette.forEach(value => colour(value, 'Chart palette colour'));
  }
  return element;
}

const xml = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&apos;');
const number = value => {
  if (!Number.isFinite(value)) fail("The chart has an invalid size or position.");
  return String(Math.abs(value) < 1e-10 ? 0 : Number(value.toFixed(6)));
};

/** Returns safe local SVG inner artwork; common element transforms stay in model. */
export function renderDataElement(element, escapeXML = xml) {
  validateDataElementFields(element);
  if (typeof escapeXML !== 'function') fail('An XML escaping function is required.');
  if (typeof element.id !== 'string' || !/^[\w-]{1,100}$/.test(element.id)) fail("This chart or table needs a valid layer ID.");
  numeric(element.width, 'Data artwork width', 1, 8192); numeric(element.height, 'Data artwork height', 1, 8192);
  colour(element.fill, 'Data element colour');
  const { width, height, fontFamily, fontSize, textFill } = element;
  // Root/cell roles need disjoint namespaces. Otherwise a valid second element
  // ID such as "foo-r0-c0" can reuse the first table's cell clip definition.
  const clipId = `stencil-data-root-${element.id}`;
  const rootClip = `<defs><clipPath id="${clipId}"><rect width="${number(width)}" height="${number(height)}"/></clipPath></defs>`;
  const label = (content, x, y, fill = textFill, extra = '') => `<text x="${number(x)}" y="${number(y)}" fill="${fill}" font-family="${escapeXML(fontFamily)}" font-size="${number(fontSize)}" dominant-baseline="hanging"${extra}>${escapeXML(content)}</text>`;
  let artwork = '';
  if (element.type === 'table') {
    const rows = [...(element.header ? [element.data.columns] : []), ...element.data.rows];
    if (!rows.length) artwork = `<rect width="${number(width)}" height="${number(height)}" fill="${element.fill}" stroke="${element.borderColor}" stroke-width="${number(element.borderWidth)}"/>`;
    const cellWidth = width / element.data.columns.length;
    const cellHeight = height / Math.max(1, rows.length);
    rows.forEach((values, rowIndex) => values.forEach((value, columnIndex) => {
      const x = columnIndex * cellWidth, y = rowIndex * cellHeight, header = element.header && rowIndex === 0;
      const cellClip = `stencil-data-cell-${element.id}-r${rowIndex}-c${columnIndex}`;
      const padding = Math.min(8, cellWidth / 8, cellHeight / 8);
      const lineHeight = fontSize * 1.18;
      const visibleLines = Math.max(1, Math.floor((cellHeight - 2 * padding) / lineHeight));
      const lines = value.split(/\r\n|\r|\n/).slice(0, visibleLines);
      artwork += `<rect x="${number(x)}" y="${number(y)}" width="${number(cellWidth)}" height="${number(cellHeight)}" fill="${header ? element.headerFill : element.fill}" stroke="${element.borderColor}" stroke-width="${number(element.borderWidth)}"/>`;
      artwork += `<defs><clipPath id="${cellClip}"><rect x="${number(x + padding)}" y="${number(y + padding)}" width="${number(Math.max(.001, cellWidth - 2 * padding))}" height="${number(Math.max(.001, cellHeight - 2 * padding))}"/></clipPath></defs><g clip-path="url(#${cellClip})">`;
      lines.forEach((line, index) => { artwork += label(line, x + padding, y + padding + index * lineHeight, header ? element.headerTextFill : textFill, header ? ' font-weight="700"' : ''); });
      artwork += '</g>';
    }));
  } else if (element.data.kind === 'bar') {
    const { labels, values } = element.data;
    const maximum = Math.max(1, ...values), rowHeight = height / values.length;
    const labelWidth = element.showLabels ? width * .28 : 0;
    const valueWidth = element.showValues ? width * .18 : 0;
    const gap = Math.min(8, width / 30), barWidth = Math.max(.001, width - labelWidth - valueWidth - 2 * gap);
    values.forEach((value, index) => {
      const y = index * rowHeight;
      if (element.showLabels) artwork += label(labels[index], 0, y + rowHeight * .2);
      artwork += `<rect x="${number(labelWidth + gap)}" y="${number(y + rowHeight * .15)}" width="${number(barWidth * value / maximum)}" height="${number(rowHeight * .7)}" fill="${element.fill}"/>`;
      if (element.showValues) artwork += label(String(value), labelWidth + gap + barWidth + gap, y + rowHeight * .2);
    });
  } else if (element.data.kind === 'line') {
    const { labels, values } = element.data;
    const padding = Math.min(12, width / 10, height / 10);
    const labelSpace = element.showLabels ? Math.min(fontSize * 1.8, height * .3) : padding;
    const top = element.showValues ? Math.min(fontSize * 1.5, height * .25) : padding;
    const plotWidth = Math.max(.001, width - 2 * padding), plotHeight = Math.max(.001, height - top - labelSpace);
    const maximum = Math.max(1, ...values);
    const points = values.map((value, index) => ({ x: padding + (values.length === 1 ? plotWidth / 2 : index * plotWidth / (values.length - 1)), y: top + plotHeight * (1 - value / maximum) }));
    artwork += `<path d="M ${number(padding)} ${number(top)} V ${number(top + plotHeight)} H ${number(padding + plotWidth)}" fill="none" stroke="${textFill}" stroke-width="1"/>`;
    artwork += `<polyline points="${points.map(point => `${number(point.x)},${number(point.y)}`).join(' ')}" fill="none" stroke="${element.fill}" stroke-width="${number(Math.min(3, width / 100, height / 100))}"/>`;
    points.forEach((point, index) => {
      artwork += `<circle cx="${number(point.x)}" cy="${number(point.y)}" r="${number(Math.min(4, width / 40, height / 40))}" fill="${element.fill}"/>`;
      if (element.showValues) artwork += label(String(values[index]), point.x, Math.max(0, point.y - fontSize * 1.25), textFill, ' text-anchor="middle"');
      if (element.showLabels) artwork += label(labels[index], point.x, top + plotHeight + padding / 2, textFill, ' text-anchor="middle"');
    });
  } else {
    const { labels, values } = element.data;
    const total = values.reduce((sum, value) => sum + value, 0);
    const legend = element.showLabels || element.showValues;
    const chartWidth = legend ? width * .6 : width;
    const radius = Math.max(.001, Math.min(chartWidth, height) * .44);
    const cx = chartWidth / 2, cy = height / 2;
    let angle = -Math.PI / 2;
    values.forEach((value, index) => {
      const fraction = value / total, delta = fraction * 2 * Math.PI;
      if (fraction >= 1) artwork += `<circle cx="${number(cx)}" cy="${number(cy)}" r="${number(radius)}" fill="${element.palette[index % element.palette.length]}"/>`;
      else if (fraction > 0 && delta > 0) {
        const startX = cx + radius * Math.cos(angle), startY = cy + radius * Math.sin(angle);
        const endX = cx + radius * Math.cos(angle + delta), endY = cy + radius * Math.sin(angle + delta);
        artwork += `<path d="M ${number(cx)} ${number(cy)} L ${number(startX)} ${number(startY)} A ${number(radius)} ${number(radius)} 0 ${fraction > .5 ? 1 : 0} 1 ${number(endX)} ${number(endY)} Z" fill="${element.palette[index % element.palette.length]}"/>`;
      }
      angle += delta;
      if (legend) {
        const y = index * height / values.length, marker = Math.min(10, height / values.length * .5, width * .04);
        artwork += `<rect x="${number(chartWidth)}" y="${number(y + 2)}" width="${number(marker)}" height="${number(marker)}" fill="${element.palette[index % element.palette.length]}"/>`;
        const content = `${element.showLabels ? labels[index] : ''}${element.showLabels && element.showValues ? ' — ' : ''}${element.showValues ? String(value) : ''}`;
        artwork += label(content, chartWidth + marker + Math.min(6, width * .015), y);
      }
    });
  }
  return `${rootClip}<g clip-path="url(#${clipId})">${artwork}</g>`;
}
