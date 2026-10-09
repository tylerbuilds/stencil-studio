/** Original, dependency-free design document model. All imports pass this schema. */
export const SCHEMA = 'stencil-studio';
export const VERSION = 1;
export const FONTS = ['Arial', 'Georgia', 'Courier New'];
export const MAX_DOCUMENT_BYTES = 12 * 1024 * 1024;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024 + 64;
const TYPES = ['text', 'rect', 'circle', 'image'];
const COMMON = ['id', 'type', 'x', 'y', 'width', 'height', 'rotation', 'fill', 'opacity'];
const TEXT = ['text', 'fontFamily', 'fontSize', 'fontWeight', 'align'];
const IMAGE = ['src'];
const RECT = ['radius'];
const clone = value => structuredClone(value);
const byteLength = value => new TextEncoder().encode(value).byteLength;
export const id = () => globalThis.crypto?.randomUUID?.() ?? `s-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const record = (value, name) => assert(value && typeof value === 'object' && !Array.isArray(value), `${name} must be an object.`);
const keys = (value, allowed, name) => assert(Object.keys(value).every(key => allowed.includes(key)), `${name} contains unsupported properties.`);
const string = (value, name, max = 500) => assert(typeof value === 'string' && value.length <= max && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value), `${name} must be valid text (up to ${max} characters).`);
const numeric = (value, name, low, high) => assert(typeof value === 'number' && Number.isFinite(value) && value >= low && value <= high, `${name} must be between ${low} and ${high}.`);
const colour = (value, name) => assert(typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value), `${name} must be a six-digit hex colour.`);
function identifier(value, name, seen) {
  string(value, name, 100);
  assert(value.length > 0 && /^[\w-]+$/.test(value) && !seen.has(value), `${name} must be a unique identifier.`);
  seen.add(value);
}
export function validateDocument(value) {
  record(value, 'Document');
  keys(value, ['schema', 'version', 'title', 'pages'], 'Document');
  assert(value.schema === SCHEMA && value.version === VERSION, 'Unsupported document format or version. Use a Stencil Studio v1 JSON file.');
  string(value.title, 'Document title', 150);
  assert(Array.isArray(value.pages) && value.pages.length > 0 && value.pages.length <= 30, 'Document needs between 1 and 30 pages.');
  const seen = new Set();
  let total = 0;
  for (const page of value.pages) {
    record(page, 'Page');
    keys(page, ['id', 'name', 'width', 'height', 'background', 'elements'], 'Page');
    identifier(page.id, 'Page ID', seen);
    string(page.name, 'Page name', 100);
    numeric(page.width, 'Artboard width', 64, 4096);
    numeric(page.height, 'Artboard height', 64, 4096);
    colour(page.background, 'Background');
    assert(Array.isArray(page.elements) && page.elements.length <= 300, 'A page supports up to 300 elements.');
    total += page.elements.length;
    assert(total <= 1000, 'A document supports up to 1000 elements.');
    for (const element of page.elements) {
      record(element, 'Element');
      assert(TYPES.includes(element.type), 'Unsupported element type.');
      keys(element, [...COMMON, ...(element.type === 'text' ? TEXT : element.type === 'image' ? IMAGE : element.type === 'rect' ? RECT : [])], 'Element');
      identifier(element.id, 'Element ID', seen);
      numeric(element.x, 'Element x', -8192, 8192);
      numeric(element.y, 'Element y', -8192, 8192);
      numeric(element.width, 'Element width', 1, 8192);
      numeric(element.height, 'Element height', 1, 8192);
      numeric(element.rotation, 'Rotation', -360, 360);
      numeric(element.opacity, 'Opacity', 0, 1);
      colour(element.fill, 'Element colour');
      if (element.type === 'text') {
        string(element.text, 'Element text', 10000);
        assert(FONTS.includes(element.fontFamily), 'Unsupported font family.');
        numeric(element.fontSize, 'Font size', 4, 500);
        assert([400, 700].includes(element.fontWeight), 'Font weight must be 400 or 700.');
        assert(['left', 'center', 'right'].includes(element.align), 'Unsupported text alignment.');
      }
      if (element.type === 'rect') numeric(element.radius, 'Corner radius', 0, 4096);
      if (element.type === 'image') {
        assert(typeof element.src === 'string' && element.src.length <= MAX_IMAGE_BYTES && /^data:image\/(png|jpeg|webp|gif);base64,[a-zA-Z0-9+/]+={0,2}$/.test(element.src), 'Images must be embedded PNG, JPEG, WebP or GIF data (up to 6 MB before encoding).');
      }
    }
  }
  assert(byteLength(JSON.stringify(value, null, 2)) <= MAX_DOCUMENT_BYTES, 'The document is too large (12 MB maximum).');
  return clone(value);
}
export function parseDocument(json) {
  assert(typeof json === 'string' && byteLength(json) <= MAX_DOCUMENT_BYTES, 'The document is too large (12 MB maximum).');
  let value;
  try { value = JSON.parse(json); } catch { throw new Error('This file is not valid JSON.'); }
  return validateDocument(value);
}
export function serialiseDocument(value) { return JSON.stringify(validateDocument(value), null, 2); }
export function createElement(type, patch = {}) {
  assert(TYPES.includes(type), 'Unsupported element type.');
  const element = { id: id(), type, x: 64, y: 64, width: type === 'text' ? 360 : 200, height: type === 'text' ? 130 : 200, rotation: 0, fill: '#e76543', opacity: 1 };
  if (type === 'text') Object.assign(element, { text: 'Your next big idea', fill: '#232a27', fontFamily: 'Arial', fontSize: 48, fontWeight: 700, align: 'left' });
  if (type === 'rect') element.radius = 0;
  if (type === 'image') element.src = '';
  return Object.assign(element, patch);
}
export function createPage(width = 720, height = 960) { return { id: id(), name: 'Untitled page', width, height, background: '#f6f1e7', elements: [] }; }
export function createDocument() { return { schema: SCHEMA, version: VERSION, title: 'Untitled design', pages: [createPage()] }; }
const text = (content, x, y, width, size, fill = '#232a27', other = {}) => createElement('text', { text: content, x, y, width, height: size * (content.split('\n').length * 1.18 + .25), fontSize: size, fill, ...other });
const rect = (x, y, width, height, fill, radius = 0) => createElement('rect', { x, y, width, height, fill, radius });
const circle = (x, y, width, height, fill) => createElement('circle', { x, y, width, height, fill });
export const TEMPLATES = [
  { key: 'poster', name: 'Make some noise', category: 'Poster · 720 × 960', colours: ['#f6f1e7', '#e76543', '#232a27'] },
  { key: 'social', name: 'Small steps, big ideas', category: 'Social · 1080 × 1080', colours: ['#c5d6c8', '#232a27', '#f6f1e7'] },
  { key: 'card', name: 'A note for you', category: 'Card · 1000 × 600', colours: ['#eadbe6', '#6852a1', '#232a27'] }
];
export function templateDocument(key) {
  const doc = createDocument();
  let page = doc.pages[0];
  if (key === 'poster') {
    doc.title = 'Make some noise'; page.name = 'The poster';
    page.elements = [rect(42, 48, 636, 3, '#232a27'), text('THE INDEPENDENT CREATIVE CLUB', 44, 66, 630, 17, '#232a27', { fontWeight: 400 }), circle(402, 116, 260, 260, '#e76543'), text('MAKE\nSOME\nNOISE.', 40, 220, 645, 128), rect(44, 742, 630, 3, '#232a27'), text('GOOD IDEAS DESERVE TO BE HEARD.', 44, 774, 630, 22), text('Friday 18 October · Doors at 7\nThe workshop, wherever you are', 44, 846, 600, 20, '#232a27', { fontWeight: 400 })];
  } else if (key === 'social') {
    doc.title = 'Small steps, big ideas'; page.width = page.height = 1080; page.name = 'The square'; page.background = '#c5d6c8';
    page.elements = [circle(650, -130, 580, 580, '#f6f1e7'), rect(72, 75, 8, 128, '#232a27'), text('FIELD NOTES\nVOL. 01 / THE BEGINNING', 111, 86, 700, 24, '#232a27', { fontWeight: 400 }), text('Small steps.\nBig ideas.', 75, 305, 950, 138, '#232a27', { fontFamily: 'Georgia' }), rect(75, 754, 928, 4, '#232a27'), text('Start where you are.\nMake something that matters.', 77, 800, 900, 38, '#232a27', { fontWeight: 400 }), circle(934, 934, 70, 70, '#e76543')];
  } else if (key === 'card') {
    doc.title = 'A note for you'; page.width = 1000; page.height = 600; page.name = 'The card'; page.background = '#eadbe6';
    page.elements = [circle(690, -80, 430, 430, '#6852a1'), circle(-80, 430, 220, 220, '#6852a1'), text('A NOTE FOR YOU', 68, 68, 810, 20, '#232a27', { fontWeight: 400 }), text('You make\ngood things\nhappen.', 65, 170, 870, 88, '#232a27', { fontFamily: 'Georgia' }), text('A little gratitude goes a long way.', 68, 521, 850, 24, '#232a27', { fontWeight: 400 })];
  } else throw new Error('Unknown template.');
  return validateDocument(doc);
}
export function editPage(document, pageId, updater) {
  const next = clone(document);
  const page = next.pages.find(item => item.id === pageId);
  assert(page, 'Page not found.');
  updater(page);
  return validateDocument(next);
}
export function updateElement(document, pageId, elementId, patch) {
  return editPage(document, pageId, page => {
    const element = page.elements.find(item => item.id === elementId);
    assert(element, 'Element not found.');
    Object.assign(element, patch);
  });
}
export function removeElement(document, pageId, elementId) { return editPage(document, pageId, page => { page.elements = page.elements.filter(item => item.id !== elementId); }); }
export function reorderElement(document, pageId, elementId, direction) {
  return editPage(document, pageId, page => {
    const from = page.elements.findIndex(item => item.id === elementId);
    assert(from >= 0, 'Element not found.');
    const to = Math.max(0, Math.min(page.elements.length - 1, from + Math.sign(direction)));
    const [element] = page.elements.splice(from, 1); page.elements.splice(to, 0, element);
  });
}
export function duplicatePage(document, pageId) {
  const next = clone(document), index = next.pages.findIndex(page => page.id === pageId);
  assert(index >= 0, 'Page not found.');
  const page = clone(next.pages[index]); page.id = id(); page.name += ' copy';
  page.elements.forEach(element => { element.id = id(); });
  next.pages.splice(index + 1, 0, page);
  return validateDocument(next);
}
export class History {
  constructor(document, limit = 60) { this.current = validateDocument(document); this.past = []; this.future = []; this.limit = limit; }
  commit(next) {
    const valid = validateDocument(next);
    if (JSON.stringify(valid) === JSON.stringify(this.current)) return false;
    this.past.push(this.current); if (this.past.length > this.limit) this.past.shift();
    this.current = valid; this.future = []; return true;
  }
  undo() { if (!this.past.length) return false; this.future.push(this.current); this.current = this.past.pop(); return true; }
  redo() { if (!this.future.length) return false; this.past.push(this.current); this.current = this.future.pop(); return true; }
}
export const escapeXML = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&apos;');
function characterWidth(char) { return /[ilI.,'!:;]/.test(char) ? .28 : /[MW@#]/.test(char) ? .88 : /[A-Z]/.test(char) ? .68 : .54; }
export function wrapText(element) {
  const limit = element.width / element.fontSize, lines = [];
  for (const paragraph of element.text.split('\n')) {
    if (!paragraph) { lines.push(''); continue; }
    let line = '', length = 0;
    for (const word of paragraph.split(/\s+/)) {
      const wordWidth = [...word].reduce((sum, ch) => sum + characterWidth(ch), 0);
      if (line && length + .3 + wordWidth > limit) { lines.push(line); line = ''; length = 0; }
      if (wordWidth > limit) {
        for (const ch of word) {
          const cw = characterWidth(ch);
          if (line && length + cw > limit) { lines.push(line); line = ''; length = 0; }
          line += ch; length += cw;
        }
      } else { if (line) { line += ' '; length += .3; } line += word; length += wordWidth; }
    }
    lines.push(line);
  }
  return lines;
}
export function elementSVG(element, interactive = false) {
  const e = element, attrs = interactive ? ` data-element-id="${escapeXML(e.id)}" class="design-element"` : '';
  const transform = `translate(${e.x} ${e.y}) rotate(${e.rotation} ${e.width / 2} ${e.height / 2})`;
  let inner;
  if (e.type === 'rect') inner = `<rect width="${e.width}" height="${e.height}" rx="${e.radius}" fill="${e.fill}"/>`;
  else if (e.type === 'circle') inner = `<ellipse cx="${e.width / 2}" cy="${e.height / 2}" rx="${e.width / 2}" ry="${e.height / 2}" fill="${e.fill}"/>`;
  else if (e.type === 'image') inner = `<image width="${e.width}" height="${e.height}" href="${escapeXML(e.src)}" preserveAspectRatio="xMidYMid slice"/>`;
  else {
    const anchor = e.align === 'center' ? 'middle' : e.align === 'right' ? 'end' : 'start';
    const x = e.align === 'center' ? e.width / 2 : e.align === 'right' ? e.width : 0;
    inner = `<text fill="${e.fill}" font-family="${e.fontFamily}" font-size="${e.fontSize}" font-weight="${e.fontWeight}" text-anchor="${anchor}" dominant-baseline="hanging">${wrapText(e).map((line, index) => `<tspan x="${x}" y="${index * e.fontSize * 1.16}">${escapeXML(line)}</tspan>`).join('')}</text>`;
    if (interactive) inner = `<rect width="${e.width}" height="${e.height}" fill="transparent"/>${inner}`;
  }
  return `<g${attrs} transform="${transform}" opacity="${e.opacity}">${inner}</g>`;
}
export function pageSVG(page, interactive = false) {
  // Validate at the export boundary as well; direct caller data must never become markup.
  validateDocument({ schema: SCHEMA, version: VERSION, title: '', pages: [page] });
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${page.width}" height="${page.height}" viewBox="0 0 ${page.width} ${page.height}"${interactive ? ' id="artboard" aria-label="Design artboard" role="img"' : ''}><rect width="100%" height="100%" fill="${page.background}"/>${page.elements.map(element => elementSVG(element, interactive)).join('')}</svg>`;
}
