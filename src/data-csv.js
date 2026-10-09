/** Local CSV for retained data elements. Cells are never evaluated. */
export function parseDataCSV(value, type) {
  if (!['table', 'chart'].includes(type)) throw new Error('Choose a table or chart.');
  if (typeof value !== 'string' || new TextEncoder().encode(value).byteLength > 1024 * 1024) throw new Error('Data CSV must be under 1 MB.');
  const rows = [], csv = value.replace(/^\uFEFF/, ''); let row = [], field = '', quoted = false, endedQuote = false;
  const pushField = () => { if (field.length > 1000) throw new Error('Data cells must be under 1,000 characters.'); row.push(field); field = ''; endedQuote = false; };
  const pushRow = () => { pushField(); rows.push(row); row = []; if (rows.length > (type === 'table' ? 51 : 31)) throw new Error(`Use up to ${type === 'table' ? 50 : 30} data rows.`); };
  for (let index = 0; index < csv.length; index++) {
    const char = csv[index];
    if (quoted) { if (char === '"') { if (csv[index + 1] === '"') { field += '"'; index++; } else { quoted = false; endedQuote = true; } } else field += char; }
    else if (char === '"') { if (field || endedQuote) throw new Error('CSV has a misplaced quote.'); quoted = true; }
    else if (char === ',') pushField();
    else if (char === '\r' || char === '\n') { if (char === '\r' && csv[index + 1] === '\n') index++; pushRow(); }
    else { if (endedQuote) throw new Error('A quoted cell must end at a comma or new line.'); field += char; }
  }
  if (quoted) throw new Error('CSV has an unclosed quoted cell.');
  if (field || row.length || endedQuote) pushRow();
  if (!rows.length) throw new Error('CSV needs a header row.');
  const columns = rows.shift();
  if (columns.length < 1 || columns.length > 8 || columns.some(column => !column.trim() || column.length > 100)) throw new Error('Use 1–8 non-empty column names up to 100 characters.');
  if (rows.some(values => values.length !== columns.length)) throw new Error('Each CSV row needs the same number of cells as its header.');
  if (type === 'table') return { columns, rows };
  if (columns.length !== 2 || !rows.length) throw new Error('Charts need two columns (label,value) and 1–30 rows.');
  const labels = rows.map(values => values[0]), values = rows.map(values => {
    if (!values[1].trim()) throw new Error('Enter a number for every chart value.');
    const numeric = Number(values[1]); if (!Number.isFinite(numeric) || numeric < 0 || numeric > 1e9) throw new Error('Chart values must be numbers between 0 and 1,000,000,000.'); return numeric;
  });
  if (labels.some(label => !label.trim() || label.length > 100)) throw new Error('Chart labels need 1–100 characters.');
  return { labels, values };
}
export function serialiseDataCSV(type, data) {
  const quote = value => { const text = value === null ? '' : String(value); return (text === '' || text.startsWith('\uFEFF') || /[",\r\n]/.test(text)) ? `"${text.replaceAll('"', '""')}"` : text; };
  const rows = type === 'table' ? [data.columns, ...data.rows] : [['Label', 'Value'], ...data.labels.map((label, index) => [label, data.values[index]])];
  return rows.map(row => row.map(quote).join(',')).join('\n');
}
