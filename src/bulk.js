import { id, validateDocument } from './model.js';
const fail = message => { throw new Error(message); };
/** RFC 4180-style parsing, without evaluating cells or fetching linked resources. */
export function parseCSV(value) {
  if (typeof value !== 'string' || new TextEncoder().encode(value).byteLength > 1024 * 1024) fail('Choose a CSV file up to 1 MB.');
  const csv = value.replace(/^\uFEFF/, '');
  const rows = [];
  let row = [], field = '', quoted = false, endedQuote = false;
  const pushField = () => { if (row.length >= 30) fail('Use up to 30 columns in each CSV row.'); if (field.length > 10000) fail("Keep each cell to 10,000 characters or fewer."); row.push(field); field = ''; endedQuote = false; };
  const pushRow = () => { pushField(); if (row.some(cell => cell !== '')) rows.push(row); row = []; if (rows.length > 31) fail("Create copies from up to 30 data rows at a time."); };
  for (let i = 0; i < csv.length; i++) {
    const ch = csv[i];
    if (quoted) {
      if (ch === '"') { if (csv[i + 1] === '"') { field += '"'; i++; } else { quoted = false; endedQuote = true; } }
      else field += ch;
    } else if (ch === '"') { if (field || endedQuote) fail("A quote is in the wrong place in this CSV file."); quoted = true; }
    else if (ch === ',') pushField();
    else if (ch === '\r' || ch === '\n') { if (ch === '\r' && csv[i + 1] === '\n') i++; pushRow(); }
    else { if (endedQuote) fail("Put a comma or new line after a quoted cell."); field += ch; }
  }
  if (quoted) fail("A quoted cell is missing its closing quote.");
  if (field || row.length || endedQuote) pushRow();
  if (rows.length < 2) fail("Add column names and at least one data row to the CSV file.");
  const headers = rows.shift().map(header => header.trim());
  if (headers.length > 30 || headers.some(header => !header || header.length > 100) || new Set(headers).size !== headers.length) fail("Use up to 30 different column names. Give each one 1 to 100 characters.");
  if (headers.some(header => ['__proto__', 'prototype', 'constructor'].includes(header))) fail("This column name is reserved. Choose a different name.");
  if (rows.some(values => values.length !== headers.length)) fail("Use the same number of cells in each row as in the column-name row.");
  return { headers, rows: rows.map(values => Object.fromEntries(headers.map((header, index) => [header, values[index]]))) };
}
function checkedCSV(value) {
  const plain = (record, label) => {
    if (!record || typeof record !== 'object' || Object.getPrototypeOf(record) !== Object.prototype) fail(`${label} must be plain CSV data.`);
    const descriptors = Object.getOwnPropertyDescriptors(record);
    if (!Reflect.ownKeys(descriptors).every(key => typeof key === 'string' && descriptors[key].enumerable && Object.hasOwn(descriptors[key], 'value'))) fail(`${label} cannot contain getters or hidden properties.`);
  };
  const dense = (array, max, label) => {
    if (!Array.isArray(array) || Object.getPrototypeOf(array) !== Array.prototype || !array.length || array.length > max) fail(`${label} must contain 1 to ${max} entries.`);
    const descriptors = Object.getOwnPropertyDescriptors(array);
    if (!Reflect.ownKeys(descriptors).every(key => key === 'length' || typeof key === 'string' && /^(0|[1-9]\d*)$/.test(key) && Number(key) < array.length && descriptors[key].enumerable && Object.hasOwn(descriptors[key], 'value')) || Object.keys(array).length !== array.length) fail(`${label} must be complete plain data.`);
  };
  plain(value, 'CSV');
  if (Object.keys(value).some(key => !['headers', 'rows'].includes(key))) fail('CSV contains unsupported properties.');
  dense(value.headers, 30, 'Column names'); dense(value.rows, 30, 'CSV rows');
  if (value.headers.some(header => typeof header !== 'string' || !header.trim() || header !== header.trim() || header.length > 100 || ['__proto__', 'prototype', 'constructor'].includes(header)) || new Set(value.headers).size !== value.headers.length) fail('Use up to 30 different, unreserved column names of 1 to 100 characters.');
  for (const row of value.rows) {
    plain(row, 'CSV row');
    if (Object.keys(row).length !== value.headers.length || value.headers.some(header => !Object.hasOwn(row, header) || typeof row[header] !== 'string' || row[header].length > 10000) || Object.keys(row).some(key => !value.headers.includes(key))) fail('CSV rows must match their columns and keep each cell to 10,000 characters or fewer.');
  }
  return value;
}
export function bulkCreate(document, pageId, csv) {
  const original = validateDocument(document), parsed = typeof csv === 'string' ? parseCSV(csv) : checkedCSV(csv);
  const base = original.pages.find(page => page.id === pageId);
  if (!base) fail('Select a template page first.');
  if (!parsed || !Array.isArray(parsed.headers) || !Array.isArray(parsed.rows) || !parsed.rows.length || parsed.rows.length > 30) fail("Use 1 to 30 data rows to create copies.");
  const placeholders = new Set();
  for (const source of [base.name, ...base.elements.filter(e => e.type === 'text').map(e => e.text)]) for (const match of source.matchAll(/\{\{([^{}]+)\}\}/g)) placeholders.add(match[1].trim());
  if (!placeholders.size) fail("Add a column name in double braces, such as {{column}}, to the page text or name first.");
  for (const placeholder of placeholders) if (!parsed.headers.includes(placeholder)) fail(`Add the column “${placeholder}” to the CSV file.`);
  const replace = (text, values) => text.replace(/\{\{([^{}]+)\}\}/g, (_, key) => {
    if (!Object.hasOwn(values, key.trim()) || typeof values[key.trim()] !== 'string') fail("The CSV data does not match its column names.");
    return values[key.trim()];
  });
  const pages = parsed.rows.map((values, index) => {
    const page = structuredClone(base), groups = new Map(); page.id = id(); page.name = replace(page.name, values);
    page.guides.forEach(guide => { guide.id = id(); });
    if (page.name === base.name) page.name = `${base.name.slice(0, 82)} · ${index + 1}`;
    page.elements.forEach(e => { e.id = id(); if (e.groupId) { if (!groups.has(e.groupId)) groups.set(e.groupId, id()); e.groupId = groups.get(e.groupId); } if (e.type === 'text') e.text = replace(e.text, values); });
    return page;
  });
  return validateDocument({ ...original, title: `${original.title.slice(0, 140)} · bulk`, pages });
}
