/** Original, dependency-free design document model. All imports pass this schema. */
import { TABLE_FIELDS, CHART_FIELDS, defaultsForDataElement, validateDataElementFields, renderDataElement } from './data-elements.js';
import { assetMetadataXML } from './asset-notices.js';
export const SCHEMA = 'stencil-studio';
export const VERSION = 4;
export const FONTS = ['Arial', 'Georgia', 'Courier New'];
export const MAX_DOCUMENT_BYTES = 12 * 1024 * 1024;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024 + 64;
const LEGACY_TYPES = ['text', 'rect', 'circle', 'image'];
const V3_TYPES = [...LEGACY_TYPES, 'table', 'chart'];
const TYPES = [...V3_TYPES, 'shape', 'freehand'];
export const SHAPE_KINDS = ['triangle', 'diamond', 'star', 'line', 'arrow'];
export const MAX_STROKE_POINTS = 2000;
const LEGACY_COMMON = ['id', 'type', 'x', 'y', 'width', 'height', 'rotation', 'fill', 'opacity'];
const COMMON = [...LEGACY_COMMON, 'locked', 'hidden', 'flipX', 'flipY', 'groupId'];
const LEGACY_TEXT = ['text', 'fontFamily', 'fontSize', 'fontWeight', 'align'];
const TEXT = [...LEGACY_TEXT, 'lineHeight', 'letterSpacing'];
const IMAGE = ['src', 'sourceWidth', 'sourceHeight', 'crop', 'filters'];
const RECT = ['radius'];
const STROKE = ['stroke', 'strokeWidth'];
export const DEFAULT_GUIDE_SETTINGS = { visible: true, rulers: false, snapToGuides: true, snapToObjects: true, snapToPage: true, tolerance: 6 };
const typeFields = (type, version = VERSION) => type === 'text' ? (version === 1 ? LEGACY_TEXT : TEXT) : type === 'image' ? (version === 1 ? ['src'] : IMAGE) : type === 'rect' ? RECT : type === 'table' && version >= 3 ? TABLE_FIELDS : type === 'chart' && version >= 3 ? CHART_FIELDS : type === 'shape' && version >= 4 ? ['kind', ...STROKE] : type === 'freehand' && version >= 4 ? ['points', 'strokeWidth'] : [];
export const DEFAULT_BRAND = { colours: ['#f6f1e7', '#e76543', '#232a27', '#c5d6c8', '#6852a1'], fontFamily: 'Arial' };
export const PRESETS = [
  { key: 'poster', name: 'Poster', width: 720, height: 960 },
  { key: 'social', name: 'Square social post', width: 1080, height: 1080 },
  { key: 'card', name: 'Landscape card', width: 1000, height: 600 },
  { key: 'presentation', name: 'Presentation', width: 1920, height: 1080 },
  { key: 'banner', name: 'Web banner', width: 1500, height: 500 },
  { key: 'story', name: 'Portrait story', width: 1080, height: 1920 },
  { key: 'resume', name: 'A4 CV', width: 794, height: 1123 },
  { key: 'menu', name: 'A4 menu', width: 794, height: 1123 }
];
const clone = value => structuredClone(value);
const byteLength = value => new TextEncoder().encode(value).byteLength;
export const id = () => globalThis.crypto?.randomUUID?.() ?? `s-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const record = (value, name) => {
  assert(value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype, `${name} must be a plain object.`);
  const descriptors = Object.getOwnPropertyDescriptors(value);
  assert(Reflect.ownKeys(descriptors).every(key => typeof key === 'string' && descriptors[key].enumerable && Object.hasOwn(descriptors[key], 'value')), `${name} contains unsupported properties.`);
};
const array = (value, name, maximum, minimum = 0) => {
  assert(Array.isArray(value) && Object.getPrototypeOf(value) === Array.prototype && value.length >= minimum && value.length <= maximum, `${name} needs between ${minimum} and ${maximum} entries.`);
  const descriptors = Object.getOwnPropertyDescriptors(value);
  assert(Reflect.ownKeys(descriptors).every(key => key === 'length' || typeof key === 'string' && /^(0|[1-9]\d*)$/.test(key) && Number(key) < value.length && descriptors[key].enumerable && Object.hasOwn(descriptors[key], 'value')) && Object.keys(value).length === value.length, `${name} must be a complete ordinary array.`);
};
const keys = (value, allowed, name) => assert(Object.keys(value).every(key => allowed.includes(key)), `${name} contains unsupported properties.`);
const string = (value, name, max = 500) => assert(typeof value === 'string' && value.length <= max && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value), `${name} must be valid text (up to ${max} characters).`);
const numeric = (value, name, low, high) => assert(typeof value === 'number' && Number.isFinite(value) && value >= low && value <= high, `${name} must be between ${low} and ${high}.`);
const colour = (value, name) => assert(typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value), `${name} must be a six-digit hex colour.`);
function embeddedRaster(value) {
  if (typeof value !== 'string' || value.length > MAX_IMAGE_BYTES) return false;
  const prefix = /^data:image\/(?:png|jpeg|webp|gif);base64,/.exec(value);
  if (!prefix) return false;
  const encoded = value.slice(prefix[0].length);
  // A repeated four-character capture can exhaust the regexp stack on large
  // valid images. The linear character scan keeps exactly the same base64 bounds.
  return encoded.length > 0 && encoded.length % 4 === 0 && /^[a-zA-Z0-9+/]+={0,2}$/.test(encoded);
}
function identifier(value, name, seen) {
  string(value, name, 100);
  assert(value.length > 0 && /^[\w-]+$/.test(value) && !seen.has(value), `${name} must be a unique identifier.`);
  seen.add(value);
}
function validateSchema(value, version) {
  record(value, 'Document');
  keys(value, ['schema', 'version', 'title', 'pages', ...(version >= 2 ? ['brand'] : [])], 'Document');
  assert(value.schema === SCHEMA && value.version === version, "This design format or version is not supported. Open a Stencil Studio v1, v2, v3 or v4 JSON file.");
  string(value.title, 'Document title', 150);
  if (version >= 2) {
    record(value.brand, 'Brand');
    keys(value.brand, ['colours', 'fontFamily'], 'Brand');
    array(value.brand.colours, 'Brand colours', 8, 1);
    value.brand.colours.forEach(item => colour(item, 'Brand colour'));
    assert(new Set(value.brand.colours.map(item => item.toLowerCase())).size === value.brand.colours.length, 'Brand colours must be unique.');
    assert(FONTS.includes(value.brand.fontFamily), "Choose a brand font available in Stencil Studio.");
  }
  array(value.pages, 'Document pages', 30, 1);
  const seen = new Set();
  let total = 0, contentBytes = 0;
  const groupPages = new Map();
  for (const page of value.pages) {
    record(page, 'Page');
    keys(page, ['id', 'name', 'width', 'height', 'background', 'elements', ...(version >= 3 ? ['transparentBackground', 'guides', 'guideSettings'] : [])], 'Page');
    identifier(page.id, 'Page ID', seen);
    string(page.name, 'Page name', 100);
    numeric(page.width, "Page width", 64, 4096);
    numeric(page.height, "Page height", 64, 4096);
    colour(page.background, 'Background');
    if (version >= 3) {
      assert(typeof page.transparentBackground === 'boolean', 'Transparent background must be true or false.');
      record(page.guideSettings, 'Guide settings'); keys(page.guideSettings, Object.keys(DEFAULT_GUIDE_SETTINGS), 'Guide settings');
      for (const key of ['visible', 'rulers', 'snapToGuides', 'snapToObjects', 'snapToPage']) assert(typeof page.guideSettings[key] === 'boolean', `${key} must be true or false.`);
      numeric(page.guideSettings.tolerance, 'Snap tolerance', 1, 30);
      array(page.guides, 'Page guides', 40);
      for (const guide of page.guides) { record(guide, 'Guide'); keys(guide, ['id', 'axis', 'position'], 'Guide'); identifier(guide.id, 'Guide ID', seen); assert(['x', 'y'].includes(guide.axis), 'Guide axis must be x or y.'); numeric(guide.position, 'Guide position', 0, guide.axis === 'x' ? page.width : page.height); }
    }
    array(page.elements, 'Page elements', 300);
    total += page.elements.length;
    assert(total <= 1000, "A design can hold up to 1,000 layers.");
    for (const element of page.elements) {
      record(element, 'Element');
      assert((version >= 4 ? TYPES : version === 3 ? V3_TYPES : LEGACY_TYPES).includes(element.type), "This layer type is not supported here.");
      keys(element, [...(version === 1 ? LEGACY_COMMON : COMMON), ...typeFields(element.type, version), ...(version >= 2 && ['rect', 'circle'].includes(element.type) ? STROKE : [])], 'Element');
      identifier(element.id, 'Element ID', seen);
      numeric(element.x, 'Element x', -8192, 8192);
      numeric(element.y, 'Element y', -8192, 8192);
      numeric(element.width, 'Element width', 1, 8192);
      numeric(element.height, 'Element height', 1, 8192);
      numeric(element.rotation, 'Rotation', -360, 360);
      numeric(element.opacity, 'Opacity', 0, 1);
      colour(element.fill, 'Element colour');
      if (version >= 2) {
        for (const prop of ['locked', 'hidden', 'flipX', 'flipY']) assert(typeof element[prop] === 'boolean', `${prop} must be true or false.`);
        if (element.groupId !== null) {
          string(element.groupId, 'Group ID', 100);
          assert(element.groupId.length > 0 && /^[\w-]+$/.test(element.groupId), 'Group ID must be a valid identifier or null.');
          assert(!groupPages.has(element.groupId) || groupPages.get(element.groupId) === page.id, "Keep each group on one page.");
          groupPages.set(element.groupId, page.id);
        }
        if (['rect', 'circle'].includes(element.type)) {
          colour(element.stroke, 'Stroke colour');
          numeric(element.strokeWidth, 'Stroke width', 0, 40);
        }
      }
      if (element.type === 'text') {
        string(element.text, 'Element text', 10000);
        assert(FONTS.includes(element.fontFamily), "Choose a font available in Stencil Studio.");
        numeric(element.fontSize, 'Font size', 4, 500);
        assert([400, 700].includes(element.fontWeight), 'Font weight must be 400 or 700.');
        assert(['left', 'center', 'right'].includes(element.align), "Align text to the left, centre or right.");
        if (version >= 2) {
          numeric(element.lineHeight, 'Line height', .8, 3);
          numeric(element.letterSpacing, 'Letter spacing', -10, 100);
        }
      }
      if (element.type === 'rect') numeric(element.radius, 'Corner radius', 0, 4096);
      if (element.type === 'shape') {
        assert(SHAPE_KINDS.includes(element.kind), "Choose a shape available in Stencil Studio.");
        colour(element.stroke, 'Stroke colour'); numeric(element.strokeWidth, 'Stroke width', 0, 40);
      }
      if (element.type === 'freehand') {
        numeric(element.strokeWidth, 'Brush width', 1, 80);
        array(element.points, 'Brush points', MAX_STROKE_POINTS, 1);
        for (const point of element.points) { record(point, 'Brush point'); keys(point, ['x', 'y'], 'Brush point'); numeric(point.x, 'Brush point x', 0, 1); numeric(point.y, 'Brush point y', 0, 1); }
      }
      if (element.type === 'image') {
        assert(embeddedRaster(element.src), "Images must be embedded in the design as PNG, JPEG, WebP or GIF, up to 6 MB before encoding.");
        if (version >= 2) {
          numeric(element.sourceWidth, 'Source width', 1, 65535);
          numeric(element.sourceHeight, 'Source height', 1, 65535);
          record(element.crop, 'Image crop');
          keys(element.crop, ['x', 'y', 'width', 'height'], 'Image crop');
          numeric(element.crop.x, 'Crop x', 0, 1);
          numeric(element.crop.y, 'Crop y', 0, 1);
          numeric(element.crop.width, 'Crop width', .0001, 1);
          numeric(element.crop.height, 'Crop height', .0001, 1);
          assert(element.crop.x + element.crop.width <= 1 + Number.EPSILON && element.crop.y + element.crop.height <= 1 + Number.EPSILON, "Keep the crop inside the original image.");
          record(element.filters, 'Image filters');
          keys(element.filters, ['brightness', 'contrast', 'saturation', 'grayscale', 'blur'], 'Image filters');
          for (const prop of ['brightness', 'contrast', 'saturation']) numeric(element.filters[prop], prop, 0, 2);
          numeric(element.filters.grayscale, 'Grayscale', 0, 1);
          numeric(element.filters.blur, 'Blur', 0, 20);
        }
      }
      if (['table', 'chart'].includes(element.type)) validateDataElementFields(element);
      // Bound aggregate content before serialising a whole imported object with many large images.
      contentBytes += byteLength(JSON.stringify(element));
      assert(contentBytes <= MAX_DOCUMENT_BYTES, 'This design is too large. Use a file up to 12 MB.');
    }
  }
  for (const groupId of groupPages.keys()) assert(!seen.has(groupId), "Each group needs its own ID, separate from pages and layers.");
  assert(byteLength(JSON.stringify(value, null, 2)) <= MAX_DOCUMENT_BYTES, "This design is too large. Use a file up to 12 MB.");
}
export function validateDocument(value) {
  record(value, 'Document');
  assert(value.schema === SCHEMA && [1, 2, 3, VERSION].includes(value.version), "This design format or version is not supported. Open a Stencil Studio v1, v2, v3 or v4 JSON file.");
  validateSchema(value, value.version);
  if (value.version < VERSION) {
    const migrated = clone(value);
    migrated.version = VERSION;
    if (value.version === 1) migrated.brand = clone(DEFAULT_BRAND);
    for (const page of migrated.pages) {
      if (value.version === 1) page.elements = page.elements.map(element => createElement(element.type, element));
      if (value.version < 3) { page.transparentBackground = false; page.guides = []; page.guideSettings = clone(DEFAULT_GUIDE_SETTINGS); }
    }
    validateSchema(migrated, VERSION);
    return migrated;
  }
  return clone(value);
}
export function parseDocument(json) {
  assert(typeof json === 'string' && json.length <= MAX_DOCUMENT_BYTES && byteLength(json) <= MAX_DOCUMENT_BYTES, "This design is too large. Use a file up to 12 MB.");
  let value;
  try { value = JSON.parse(json); } catch { throw new Error('This file is not valid JSON.'); }
  return validateDocument(value);
}
export function serialiseDocument(value) { return JSON.stringify(validateDocument(value), null, 2); }
export function createElement(type, patch = {}) {
  assert(TYPES.includes(type), "This layer type is not supported here.");
  record(patch, 'Element patch');
  keys(patch, [...COMMON, ...typeFields(type), ...(['rect', 'circle'].includes(type) ? STROKE : [])], 'Element patch');
  const element = { id: id(), type, x: 64, y: 64, width: type === 'text' ? 360 : 200, height: type === 'text' ? 130 : 200, rotation: 0, fill: '#e76543', opacity: 1, locked: false, hidden: false, flipX: false, flipY: false, groupId: null };
  if (type === 'text') Object.assign(element, { text: 'Your next big idea', fill: '#232a27', fontFamily: 'Arial', fontSize: 48, fontWeight: 700, align: 'left', lineHeight: 1.16, letterSpacing: 0 });
  if (type === 'rect') element.radius = 0;
  if (type === 'rect' || type === 'circle') Object.assign(element, { stroke: '#232a27', strokeWidth: 0 });
  if (type === 'shape') Object.assign(element, { kind: 'triangle', stroke: '#232a27', strokeWidth: patch.kind === 'line' ? 6 : 0, ...(patch.kind === 'line' ? { height: 40 } : {}) });
  if (type === 'freehand') Object.assign(element, { points: [{ x: 0, y: 0 }, { x: 1, y: 1 }], fill: '#232a27', strokeWidth: 6 });
  if (type === 'image') Object.assign(element, { src: '', sourceWidth: patch.width ?? element.width, sourceHeight: patch.height ?? element.height, crop: { x: 0, y: 0, width: 1, height: 1 }, filters: { brightness: 1, contrast: 1, saturation: 1, grayscale: 0, blur: 0 } });
  if (type === 'table' || type === 'chart') Object.assign(element, { width: 500, height: 300, fill: type === 'table' ? '#ffffff' : '#e76543' }, defaultsForDataElement(type));
  Object.assign(element, clone(patch));
  if (type === 'image') {
    element.crop = { x: 0, y: 0, width: 1, height: 1, ...patch.crop };
    element.filters = { brightness: 1, contrast: 1, saturation: 1, grayscale: 0, blur: 0, ...patch.filters };
  }
  return element;
}
export function createPage(width = 720, height = 960) { return { id: id(), name: 'Untitled page', width, height, background: '#f6f1e7', transparentBackground: false, guides: [], guideSettings: clone(DEFAULT_GUIDE_SETTINGS), elements: [] }; }
export function createDocument() { return { schema: SCHEMA, version: VERSION, title: 'Untitled design', brand: clone(DEFAULT_BRAND), pages: [createPage()] }; }
export function createBlankDesign(options = {}) {
  record(options, 'Blank design options'); keys(options, ['title', 'width', 'height', 'background'], 'Blank design options');
  const { title = 'Untitled design', width = 720, height = 960, background = '#ffffff' } = options;
  const document = createDocument(); document.title = title; document.pages[0] = { ...createPage(width, height), background }; return validateDocument(document);
}
/** A gesture becomes one editable native stroke. Points are normalised for resizing. */
export function createBrushStroke(points, fill = '#232a27', strokeWidth = 6, elementId = id()) {
  array(points, 'Brush points', MAX_STROKE_POINTS, 1); colour(fill, 'Brush colour'); numeric(strokeWidth, 'Brush width', 1, 80);
  for (const point of points) { record(point, 'Brush point'); keys(point, ['x', 'y'], 'Brush point'); numeric(point.x, 'Brush x', -8192, 8192); numeric(point.y, 'Brush y', -8192, 8192); }
  const pad = strokeWidth / 2, x = Math.min(...points.map(p => p.x)) - pad, y = Math.min(...points.map(p => p.y)) - pad;
  const width = Math.max(1, Math.max(...points.map(p => p.x)) - x + pad), height = Math.max(1, Math.max(...points.map(p => p.y)) - y + pad);
  const stroke = createElement('freehand', { id: elementId, x, y, width, height, fill, strokeWidth, points: points.map(p => ({ x: (p.x - x) / width, y: (p.y - y) / height })) });
  elementSVG(stroke); return stroke;
}
const text = (content, x, y, width, size, fill = '#232a27', other = {}) => createElement('text', { text: content, x, y, width, height: size * (content.split('\n').length * 1.18 + .25), fontSize: size, fill, ...other });
const rect = (x, y, width, height, fill, radius = 0) => createElement('rect', { x, y, width, height, fill, radius });
const circle = (x, y, width, height, fill) => createElement('circle', { x, y, width, height, fill });
export const TEMPLATES = [
  { key: 'poster', name: 'Make some noise', category: 'Poster · 720 × 960', colours: ['#f6f1e7', '#e76543', '#232a27'] },
  { key: 'social', name: 'Small steps, big ideas', category: 'Social · 1080 × 1080', colours: ['#c5d6c8', '#232a27', '#f6f1e7'] },
  { key: 'card', name: 'A note for you', category: 'Card · 1000 × 600', colours: ['#eadbe6', '#6852a1', '#232a27'] },
  { key: 'presentation', name: 'Ideas in motion', category: 'Presentation · 1920 × 1080', colours: ['#232a27', '#c5d6c8', '#e76543'] },
  { key: 'banner', name: 'Room to grow', category: 'Banner · 1500 × 500', colours: ['#c5d6c8', '#232a27', '#f6f1e7'] },
  { key: 'story', name: 'Today is yours', category: 'Story · 1080 × 1920', colours: ['#6852a1', '#eadbe6', '#f6f1e7'] },
  { key: 'resume', name: 'A clear introduction', category: 'CV · 794 × 1123', colours: ['#ffffff', '#232a27', '#c5d6c8'] },
  { key: 'menu', name: 'At our table', category: 'Menu · 794 × 1123', colours: ['#f6f1e7', '#232a27', '#e76543'] }
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
  } else if (key === 'presentation') {
    doc.title = 'Ideas in motion'; page.width = 1920; page.height = 1080; page.name = 'Opening slide'; page.background = '#232a27';
    page.elements = [rect(90, 80, 140, 12, '#e76543'), text('A STUDIO FIELD GUIDE', 90, 118, 1200, 34, '#c5d6c8', { fontWeight: 400 }), text('Ideas\nin motion.', 85, 265, 1300, 180, '#f6f1e7'), circle(1430, 450, 660, 660, '#c5d6c8'), text('Make room for the next possibility.', 92, 932, 1250, 40, '#c5d6c8', { fontWeight: 400 })];
    const second = createPage(1920, 1080); second.name = 'The plan'; second.elements = [text('Three useful questions', 92, 112, 1650, 90), ...['What matters?', 'What can we try?', 'What comes next?'].map((label, i) => text(`${i + 1}. ${label}`, 100, 350 + i * 180, 1600, 65, '#232a27', { fontWeight: 400 })), rect(90, 978, 1740, 4, '#e76543')]; doc.pages.push(second);
  } else if (key === 'banner') {
    doc.title = 'Room to grow'; page.width = 1500; page.height = 500; page.name = 'The banner'; page.background = '#c5d6c8';
    page.elements = [circle(1090, -110, 650, 650, '#f6f1e7'), text('ROOM TO GROW', 75, 62, 900, 24, '#232a27', { fontWeight: 400 }), text('Make space\nfor good ideas.', 70, 128, 1150, 105, '#232a27', { fontFamily: 'Georgia' }), text('Open studio · Every Saturday', 78, 412, 850, 28, '#232a27', { fontWeight: 400 }), circle(1310, 330, 120, 120, '#e76543')];
  } else if (key === 'story') {
    doc.title = 'Today is yours'; page.width = 1080; page.height = 1920; page.name = 'The story'; page.background = '#6852a1';
    page.elements = [text('ONE SMALL BEGINNING', 84, 105, 925, 34, '#eadbe6', { fontWeight: 400 }), circle(710, 270, 530, 530, '#eadbe6'), text('Today\nis yours.', 73, 650, 930, 170, '#f6f1e7', { fontFamily: 'Georgia' }), rect(83, 1420, 908, 5, '#eadbe6'), text('Take the first step.\nThe rest can follow.', 85, 1500, 905, 58, '#f6f1e7', { fontWeight: 400 }), text('YOUR NEXT CHAPTER', 86, 1780, 910, 30, '#eadbe6')];
  } else if (key === 'resume') {
    doc.title = 'A clear introduction'; page.width = 794; page.height = 1123; page.name = 'The CV'; page.background = '#ffffff';
    page.elements = [rect(0, 0, 22, 1123, '#c5d6c8'), text('Alex Morgan', 60, 66, 685, 60), text('DESIGNER / PROBLEM SOLVER', 63, 149, 670, 19, '#232a27', { fontWeight: 400 }), rect(60, 204, 670, 2, '#232a27'), text('PROFILE', 62, 239, 670, 22), text('A thoughtful designer making useful things for people.\nCurious about systems, stories and everyday details.', 62, 284, 669, 22, '#232a27', { fontWeight: 400 }), text('EXPERIENCE', 62, 419, 670, 22), text('Independent Designer\n2022 – present\nDeveloped clear visual identities and digital products.\nWorked with small teams from first sketch to delivery.', 62, 468, 666, 23, '#232a27', { fontWeight: 400 }), text('EDUCATION & SKILLS', 62, 717, 670, 22), text('BA Design · Example University\nVisual communication, prototyping, facilitation', 62, 766, 666, 23, '#232a27', { fontWeight: 400 }), rect(60, 976, 670, 2, '#232a27'), text('alex@example.com · Your city · portfolio.example', 62, 1015, 670, 18, '#232a27', { fontWeight: 400 })];
  } else if (key === 'menu') {
    doc.title = 'At our table'; page.width = 794; page.height = 1123; page.name = 'The menu';
    page.elements = [circle(619, -90, 240, 240, '#e76543'), text('AT OUR TABLE', 60, 73, 675, 54, '#232a27', { fontFamily: 'Georgia', align: 'center' }), text('SEASONAL FOOD / GOOD COMPANY', 60, 156, 674, 18, '#232a27', { fontWeight: 400, align: 'center' }), rect(64, 213, 665, 2, '#232a27'), text('SMALL PLATES', 65, 252, 664, 24), text('Roasted carrots, herby yoghurt          £7\nWarm focaccia, olive oil                    £5\nTomato salad, basil                         £8', 65, 302, 665, 23, '#232a27', { fontWeight: 400 }), text('FROM THE KITCHEN', 65, 476, 664, 24), text('Mushroom risotto                            £16\nMarket vegetables, lentils                 £14\nHouse pasta, seasonal greens             £15', 65, 526, 665, 23, '#232a27', { fontWeight: 400 }), text('SOMETHING SWEET', 65, 705, 664, 24), text('Lemon cake, fresh cream                   £7\nChocolate tart, sea salt                    £8', 65, 755, 665, 23, '#232a27', { fontWeight: 400 }), rect(64, 938, 665, 2, '#232a27'), text('Please tell us about dietary requirements.\nA sample menu, ready for your own dishes.', 65, 980, 665, 18, '#232a27', { fontWeight: 400, align: 'center' })];
  } else throw new Error("This template is not available. Choose another template.");
  return validateDocument(doc);
}
export function editPage(document, pageId, updater) {
  const next = validateDocument(document);
  const page = next.pages.find(item => item.id === pageId);
  assert(page, 'Page not found.');
  updater(page);
  return validateDocument(next);
}
export function updateElement(document, pageId, elementId, patch) {
  return updateElements(document, pageId, [elementId], patch);
}
function selectedElements(page, ids, expandGroups = false) {
  array(ids, 'Layer IDs', 300);
  assert(ids.every(item => typeof item === 'string'), "Supply layer IDs as a list.");
  const chosen = new Set(ids);
  assert(ids.every(elementId => page.elements.some(element => element.id === elementId)), "Layer not found.");
  if (expandGroups) {
    const groups = new Set(page.elements.filter(element => chosen.has(element.id) && element.groupId).map(element => element.groupId));
    page.elements.forEach(element => { if (groups.has(element.groupId)) chosen.add(element.id); });
  }
  return page.elements.filter(element => chosen.has(element.id));
}
function applyPatch(element, patch, blocked = false) {
  record(patch, 'Element patch');
  keys(patch, [...COMMON, ...typeFields(element.type), ...(['rect', 'circle'].includes(element.type) ? STROKE : [])], 'Element patch');
  if (element.locked || blocked) {
    for (const prop of ['locked', 'hidden']) if (Object.hasOwn(patch, prop)) element[prop] = patch[prop];
    return;
  }
  const next = clone(patch);
  if (element.type === 'image') {
    if (Object.hasOwn(patch, 'crop')) { record(patch.crop, 'Image crop'); next.crop = { ...element.crop, ...patch.crop }; }
    if (Object.hasOwn(patch, 'filters')) { record(patch.filters, 'Image filters'); next.filters = { ...element.filters, ...patch.filters }; }
  }
  Object.assign(element, next);
}
export function updateElements(document, pageId, ids, patch) {
  return editPage(document, pageId, page => {
    const elements = selectedElements(page, ids);
    const lockedGroups = new Set(page.elements.filter(element => element.locked && element.groupId).map(element => element.groupId));
    for (const element of elements) applyPatch(element, typeof patch === 'function' ? patch(clone(element)) : patch, lockedGroups.has(element.groupId));
  });
}
function tidyGroups(page) {
  const counts = new Map();
  page.elements.forEach(element => { if (element.groupId) counts.set(element.groupId, (counts.get(element.groupId) ?? 0) + 1); });
  page.elements.forEach(element => { if (element.groupId && counts.get(element.groupId) < 2) element.groupId = null; });
}
export function removeElements(document, pageId, ids) {
  return editPage(document, pageId, page => {
    const lockedGroups = new Set(page.elements.filter(element => element.locked && element.groupId).map(element => element.groupId));
    const chosen = new Set(selectedElements(page, ids, true).filter(element => !element.locked && !lockedGroups.has(element.groupId)).map(element => element.id));
    page.elements = page.elements.filter(item => !chosen.has(item.id));
    tidyGroups(page);
  });
}
export function removeElement(document, pageId, elementId) { return removeElements(document, pageId, [elementId]); }
export function reorderElement(document, pageId, elementId, direction) {
  return editPage(document, pageId, page => {
    const from = page.elements.findIndex(item => item.id === elementId);
    assert(from >= 0, "Layer not found.");
    numeric(direction, 'Layer direction', -1, 1);
    const elements = selectedElements(page, [elementId], true);
    if (!direction || elements.some(element => element.locked)) return;
    const selected = new Set(elements.map(element => element.id));
    const edge = direction > 0 ? Math.max(...elements.map(element => page.elements.indexOf(element))) : Math.min(...elements.map(element => page.elements.indexOf(element)));
    const neighbour = page.elements[edge + Math.sign(direction)];
    if (!neighbour) return;
    const neighbours = selectedElements(page, [neighbour.id], true);
    const remaining = page.elements.filter(element => !selected.has(element.id));
    const target = direction > 0 ? Math.max(...neighbours.map(element => remaining.indexOf(element))) + 1 : Math.min(...neighbours.map(element => remaining.indexOf(element)));
    remaining.splice(target, 0, ...elements); page.elements = remaining;
  });
}
/** Move whole selected groups to an edge, or beside a target group, atomically. */
export function positionLayers(document, pageId, ids, position, targetId = null) {
  assert(['front', 'back', 'before', 'after'].includes(position), "Move the layer to the front, back, before or after another layer.");
  return editPage(document, pageId, page => {
    const elements = selectedElements(page, ids, true);
    if (!elements.length || elements.some(element => element.locked)) return;
    const chosen = new Set(elements.map(e => e.id));
    if (targetId && chosen.has(targetId)) return;
    const remaining = page.elements.filter(e => !chosen.has(e.id));
    let index = position === 'back' ? 0 : remaining.length;
    if (position === 'before' || position === 'after') {
      assert(typeof targetId === 'string', "Choose the layer to place this beside.");
      const target = selectedElements(page, [targetId], true).filter(e => !chosen.has(e.id));
      assert(target.length, "The layer to move beside was not found.");
      index = position === 'before' ? Math.min(...target.map(e => remaining.indexOf(e))) : Math.max(...target.map(e => remaining.indexOf(e))) + 1;
    }
    remaining.splice(index, 0, ...elements); page.elements = remaining;
  });
}
export function duplicatePage(document, pageId) {
  const next = validateDocument(document), index = next.pages.findIndex(page => page.id === pageId);
  assert(index >= 0, 'Page not found.');
  const page = clone(next.pages[index]); page.id = id(); page.name = `${page.name.slice(0, 95)} copy`;
  page.guides.forEach(guide => { guide.id = id(); });
  page.elements = remapElements(page.elements, 0);
  next.pages.splice(index + 1, 0, page);
  return validateDocument(next);
}
export function reorderPage(document, pageId, targetIndex) {
  const next = validateDocument(document), index = next.pages.findIndex(page => page.id === pageId);
  assert(index >= 0, 'Page not found.');
  assert(Number.isInteger(targetIndex) && targetIndex >= 0 && targetIndex < next.pages.length, "Choose a position within the current page list.");
  if (index !== targetIndex) { const [page] = next.pages.splice(index, 1); next.pages.splice(targetIndex, 0, page); }
  return validateDocument(next);
}
export function addPageGuide(document, pageId, axis, position) { return editPage(document, pageId, page => { page.guides.push({ id: id(), axis, position }); }); }
export function updatePageGuide(document, pageId, guideId, patch) {
  record(patch, 'Guide change'); keys(patch, ['axis', 'position'], 'Guide change');
  return editPage(document, pageId, page => { const guide = page.guides.find(item => item.id === guideId); assert(guide, 'Guide not found.'); Object.assign(guide, clone(patch)); });
}
export function removePageGuide(document, pageId, guideId) { return editPage(document, pageId, page => { assert(page.guides.some(guide => guide.id === guideId), 'Guide not found.'); page.guides = page.guides.filter(guide => guide.id !== guideId); }); }
export function setPageGuideSettings(document, pageId, patch) {
  record(patch, 'Guide settings change'); keys(patch, Object.keys(DEFAULT_GUIDE_SETTINGS), 'Guide settings change');
  return editPage(document, pageId, page => { Object.assign(page.guideSettings, clone(patch)); });
}
export function resizePageDocument(document, pageId, width, height, scaleElements = false) {
  numeric(width, "Page width", 64, 4096); numeric(height, "Page height", 64, 4096); assert(typeof scaleElements === 'boolean', 'Scale layout must be true or false.');
  return editPage(document, pageId, page => {
    const sx = width / page.width, sy = height / page.height, lockedGroups = new Set(page.elements.filter(element => element.locked && element.groupId).map(element => element.groupId));
    if (scaleElements) page.elements.forEach(element => { if (element.locked || lockedGroups.has(element.groupId)) return; element.x *= sx; element.y *= sy; element.width *= sx; element.height *= sy; if (['text', 'table', 'chart'].includes(element.type)) element.fontSize = Math.max(4, Math.min(element.type === 'text' ? 500 : 100, element.fontSize * Math.min(sx, sy))); });
    page.guides.forEach(guide => { const limit = guide.axis === 'x' ? width : height; guide.position = Math.min(limit, scaleElements ? guide.position * (guide.axis === 'x' ? sx : sy) : guide.position); });
    page.width = width; page.height = height;
  });
}
/** Screen-pixel snapping with independent sources; guides win equal-distance ties. */
export function snapMovement(page, ids, dx, dy, zoom = 1) {
  numeric(dx, 'Movement x', -16384, 16384); numeric(dy, 'Movement y', -16384, 16384); numeric(zoom, 'Zoom', .05, 3);
  const p = validateDocument({ schema: SCHEMA, version: VERSION, title: '', brand: clone(DEFAULT_BRAND), pages: [page] }).pages[0];
  const elements = selectedElements(p, ids), b = boundsOfElements(elements), chosen = new Set(ids), targets = { x: [], y: [] };
  const add = (axis, values, source) => values.forEach(value => targets[axis].push({ value, source }));
  if (p.guideSettings.snapToGuides) p.guides.forEach(guide => add(guide.axis, [guide.position], 'guide'));
  if (p.guideSettings.snapToPage) { add('x', [0, p.width / 2, p.width], 'page'); add('y', [0, p.height / 2, p.height], 'page'); }
  if (p.guideSettings.snapToObjects) p.elements.filter(element => !chosen.has(element.id) && !element.hidden).forEach(element => { const r = elementBounds(element); add('x', [r.x, r.x + r.width / 2, r.x + r.width], 'object'); add('y', [r.y, r.y + r.height / 2, r.y + r.height], 'object'); });
  const threshold = p.guideSettings.tolerance / zoom;
  const closest = (points, values) => { let best = null; for (const target of values) for (const point of points) { const difference = target.value - point; if (Math.abs(difference) <= threshold && (!best || Math.abs(difference) < Math.abs(best.difference))) best = { difference, ...target }; } return best; };
  const x = closest([b.x + dx, b.x + b.width / 2 + dx, b.x + b.width + dx], targets.x), y = closest([b.y + dy, b.y + b.height / 2 + dy, b.y + b.height + dy], targets.y);
  return { dx: dx + (x?.difference ?? 0), dy: dy + (y?.difference ?? 0), guides: [...(x ? [{ axis: 'x', value: x.value, source: x.source }] : []), ...(y ? [{ axis: 'y', value: y.value, source: y.source }] : [])] };
}
function remapElements(elements, offset) {
  numeric(offset, 'Paste offset', -8192, 8192);
  const groups = new Map();
  const copies = elements.map(element => {
    const copy = clone(element);
    copy.id = id(); copy.x += offset; copy.y += offset;
    if (copy.groupId) { if (!groups.has(copy.groupId)) groups.set(copy.groupId, id()); copy.groupId = groups.get(copy.groupId); }
    return copy;
  });
  tidyGroups({ elements: copies });
  return copies;
}
export function copyElements(document, pageId, ids) {
  const valid = validateDocument(document), page = valid.pages.find(item => item.id === pageId);
  assert(page, 'Page not found.');
  return clone(selectedElements(page, ids, true));
}
export function pasteElements(document, pageId, elements, offset = 24) {
  assert(Array.isArray(elements) && elements.length <= 300, "Copy or paste up to 300 layers at a time.");
  return editPage(document, pageId, page => {
    // Validate the clipboard before remapping so unsupported fields cannot be erased accidentally.
    validateDocument({ schema: SCHEMA, version: VERSION, title: '', brand: clone(DEFAULT_BRAND), pages: [{ ...createPage(), elements }] });
    page.elements.push(...remapElements(elements, offset));
  });
}
export function duplicateElements(document, pageId, ids, offset = 24) { return pasteElements(document, pageId, copyElements(document, pageId, ids), offset); }
export function groupElements(document, pageId, ids) {
  return editPage(document, pageId, page => {
    const elements = selectedElements(page, ids, true);
    assert(elements.length >= 2, "Select at least two layers to group.");
    assert(elements.every(element => !element.locked), "Unlock the layers before grouping them.");
    const groupId = id(), chosen = new Set(elements.map(element => element.id));
    elements.forEach(element => { element.groupId = groupId; });
    // A group occupies consecutive layers at the highest selected layer.
    const top = Math.max(...elements.map(element => page.elements.indexOf(element)));
    const before = page.elements.slice(0, top + 1).filter(element => !chosen.has(element.id));
    const after = page.elements.slice(top + 1).filter(element => !chosen.has(element.id));
    page.elements = [...before, ...elements, ...after];
  });
}
export function ungroupElements(document, pageId, ids) {
  return editPage(document, pageId, page => {
    const elements = selectedElements(page, ids, true);
    assert(elements.every(element => !element.locked), "Unlock the layers before ungrouping them.");
    elements.forEach(element => { element.groupId = null; });
  });
}
export function elementBounds(element) {
  const radians = element.rotation * Math.PI / 180, cos = Math.cos(radians), sin = Math.sin(radians);
  const halfW = element.width / 2, halfH = element.height / 2;
  const width = Math.abs(element.width * cos) + Math.abs(element.height * sin);
  const height = Math.abs(element.width * sin) + Math.abs(element.height * cos);
  return { x: element.x + halfW - width / 2, y: element.y + halfH - height / 2, width, height };
}
export function boundsOfElements(elements) {
  assert(Array.isArray(elements) && elements.length > 0, "Select at least one layer.");
  const bounds = elements.map(elementBounds), x = Math.min(...bounds.map(item => item.x)), y = Math.min(...bounds.map(item => item.y));
  return { x, y, width: Math.max(...bounds.map(item => item.x + item.width)) - x, height: Math.max(...bounds.map(item => item.y + item.height)) - y };
}
function selectionUnits(page, ids) {
  const groups = new Map();
  for (const element of selectedElements(page, ids, true)) {
    const key = element.groupId ?? element.id;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(element);
  }
  return [...groups.values()].map(elements => ({ elements, bounds: boundsOfElements(elements), locked: elements.some(element => element.locked) }));
}
export function alignElements(document, pageId, ids, alignment, toPage = false) {
  assert(['left', 'right', 'top', 'bottom', 'centerX', 'centerY'].includes(alignment), "Choose left, right, top, bottom, horizontal centre or vertical centre alignment.");
  assert(typeof toPage === 'boolean', 'Page alignment must be true or false.');
  return editPage(document, pageId, page => {
    const units = selectionUnits(page, ids);
    if (!units.length) return;
    const target = toPage ? { x: 0, y: 0, width: page.width, height: page.height } : boundsOfElements(units.flatMap(unit => unit.elements));
    for (const unit of units) {
      if (unit.locked) continue;
      const b = unit.bounds;
      const dx = alignment === 'left' ? target.x - b.x : alignment === 'right' ? target.x + target.width - b.x - b.width : alignment === 'centerX' ? target.x + target.width / 2 - b.x - b.width / 2 : 0;
      const dy = alignment === 'top' ? target.y - b.y : alignment === 'bottom' ? target.y + target.height - b.y - b.height : alignment === 'centerY' ? target.y + target.height / 2 - b.y - b.height / 2 : 0;
      unit.elements.forEach(element => { element.x += dx; element.y += dy; });
    }
  });
}
export function distributeElements(document, pageId, ids, axis) {
  assert(['horizontal', 'vertical'].includes(axis), "Space layers horizontally or vertically.");
  return editPage(document, pageId, page => {
    const horizontal = axis === 'horizontal', coord = horizontal ? 'x' : 'y', size = horizontal ? 'width' : 'height';
    const units = selectionUnits(page, ids).sort((a, b) => a.bounds[coord] - b.bounds[coord]);
    assert(units.length >= 3, "Select at least three layers or groups to space evenly.");
    assert(units.every(unit => !unit.locked), "Unlock the layers before spacing them evenly.");
    const first = units[0].bounds, last = units.at(-1).bounds;
    const gap = (last[coord] + last[size] - first[coord] - units.reduce((sum, unit) => sum + unit.bounds[size], 0)) / (units.length - 1);
    let position = first[coord];
    units.forEach((unit, index) => {
      if (index > 0 && index < units.length - 1) {
        const shift = position - unit.bounds[coord];
        unit.elements.forEach(element => { element[coord] += shift; });
      }
      position += unit.bounds[size] + gap;
    });
  });
}
export class History {
  constructor(document, limit = 60) { assert(Number.isInteger(limit) && limit >= 1 && limit <= 100, 'Keep between 1 and 100 undo history states.'); this.current = validateDocument(document); this.past = []; this.future = []; this.limit = limit; }
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
  const spacing = (element.letterSpacing ?? 0) / element.fontSize;
  const widthOf = char => Math.max(.01, characterWidth(char) + spacing);
  const spaceWidth = Math.max(.01, .3 + spacing);
  for (const paragraph of element.text.split('\n')) {
    if (!paragraph) { lines.push(''); continue; }
    let line = '', length = 0;
    for (const word of paragraph.split(/\s+/)) {
      const wordWidth = [...word].reduce((sum, ch) => sum + widthOf(ch), 0);
      if (line && length + spaceWidth + wordWidth > limit) { lines.push(line); line = ''; length = 0; }
      if (wordWidth > limit) {
        for (const ch of word) {
          const cw = widthOf(ch);
          if (line && length + cw > limit) { lines.push(line); line = ''; length = 0; }
          line += ch; length += cw;
        }
      } else { if (line) { line += ' '; length += spaceWidth; } line += word; length += wordWidth; }
    }
    lines.push(line);
  }
  return lines;
}
function renderElement(element, interactive = false) {
  const e = element;
  if (e.hidden) return '';
  const attrs = interactive ? ` data-element-id="${escapeXML(e.id)}" class="design-element${e.locked ? ' locked' : ''}"${e.locked ? ' data-locked="true"' : ''}` : '';
  const flip = e.flipX || e.flipY ? ` translate(${e.flipX ? e.width : 0} ${e.flipY ? e.height : 0}) scale(${e.flipX ? -1 : 1} ${e.flipY ? -1 : 1})` : '';
  const transform = `translate(${e.x} ${e.y}) rotate(${e.rotation} ${e.width / 2} ${e.height / 2})${flip}`;
  let inner;
  if (e.type === 'rect') inner = `<rect width="${e.width}" height="${e.height}" rx="${e.radius}" fill="${e.fill}" stroke="${e.stroke}" stroke-width="${e.strokeWidth}"/>`;
  else if (e.type === 'circle') inner = `<ellipse cx="${e.width / 2}" cy="${e.height / 2}" rx="${e.width / 2}" ry="${e.height / 2}" fill="${e.fill}" stroke="${e.stroke}" stroke-width="${e.strokeWidth}"/>`;
  else if (e.type === 'shape') {
    if (e.kind === 'line') inner = `<line x1="0" y1="${e.height / 2}" x2="${e.width}" y2="${e.height / 2}" stroke="${e.stroke}" stroke-width="${e.strokeWidth}" stroke-linecap="round"/>${interactive ? `<line x1="0" y1="${e.height / 2}" x2="${e.width}" y2="${e.height / 2}" stroke="transparent" stroke-width="${Math.max(12, e.strokeWidth)}"/>` : ''}`;
    else {
      const points = e.kind === 'triangle' ? [[.5, 0], [1, 1], [0, 1]] : e.kind === 'diamond' ? [[.5, 0], [1, .5], [.5, 1], [0, .5]] : e.kind === 'arrow' ? [[0, .3], [.6, .3], [.6, 0], [1, .5], [.6, 1], [.6, .7], [0, .7]] : Array.from({ length: 10 }, (_, i) => { const a = -Math.PI / 2 + i * Math.PI / 5, r = i % 2 ? .22 : .5; return [.5 + Math.cos(a) * r, .5 + Math.sin(a) * r]; });
      inner = `<polygon points="${points.map(([x, y]) => `${x * e.width},${y * e.height}`).join(' ')}" fill="${e.fill}" stroke="${e.stroke}" stroke-width="${e.strokeWidth}" stroke-linejoin="round"/>`;
    }
  }
  else if (e.type === 'freehand') {
    const points = e.points.map(p => `${p.x * e.width},${p.y * e.height}`).join(' ');
    inner = e.points.length === 1 ? `<circle cx="${e.points[0].x * e.width}" cy="${e.points[0].y * e.height}" r="${e.strokeWidth / 2}" fill="${e.fill}"/>` : `<polyline points="${points}" fill="none" stroke="${e.fill}" stroke-width="${e.strokeWidth}" stroke-linecap="round" stroke-linejoin="round"/>`;
    if (interactive && e.points.length > 1) inner += `<polyline points="${points}" fill="none" stroke="transparent" stroke-width="${Math.max(12, e.strokeWidth)}" stroke-linecap="round" stroke-linejoin="round"/>`;
  }
  else if (e.type === 'image') {
    const crop = e.crop, f = e.filters;
    const filterId = `stencil-filter-${e.id}`, clipId = `stencil-crop-${e.id}`;
    const filtered = f.brightness !== 1 || f.contrast !== 1 || f.saturation !== 1 || f.grayscale !== 0 || f.blur !== 0;
    const slope = f.brightness * f.contrast, intercept = .5 * (1 - f.contrast);
    const filter = filtered ? `<filter id="${filterId}" x="-100%" y="-100%" width="300%" height="300%" color-interpolation-filters="sRGB"><feComponentTransfer>${['R', 'G', 'B'].map(channel => `<feFunc${channel} type="linear" slope="${slope}" intercept="${intercept}"/>`).join('')}</feComponentTransfer><feColorMatrix type="saturate" values="${f.saturation}"/><feColorMatrix type="saturate" values="${1 - f.grayscale}"/>${f.blur ? `<feGaussianBlur stdDeviation="${f.blur}"/>` : ''}</filter>` : '';
    const viewport = `${crop.x * e.sourceWidth} ${crop.y * e.sourceHeight} ${crop.width * e.sourceWidth} ${crop.height * e.sourceHeight}`;
    inner = `<defs><clipPath id="${clipId}"><rect width="${e.width}" height="${e.height}"/></clipPath>${filter}</defs><g clip-path="url(#${clipId})"><g${filtered ? ` filter="url(#${filterId})"` : ''}><svg width="${e.width}" height="${e.height}" viewBox="${viewport}" preserveAspectRatio="xMidYMid slice" overflow="hidden"><image width="${e.sourceWidth}" height="${e.sourceHeight}" href="${escapeXML(e.src)}" preserveAspectRatio="xMidYMid slice"/></svg></g></g>`;
    if (interactive) inner += `<rect width="${e.width}" height="${e.height}" fill="transparent"/>`;
  }
  else if (e.type === 'table' || e.type === 'chart') { inner = renderDataElement(e, escapeXML); if (interactive) inner += `<rect width="${e.width}" height="${e.height}" fill="transparent"/>`; }
  else {
    const anchor = e.align === 'center' ? 'middle' : e.align === 'right' ? 'end' : 'start';
    const x = e.align === 'center' ? e.width / 2 : e.align === 'right' ? e.width : 0;
    inner = `<text fill="${e.fill}" font-family="${e.fontFamily}" font-size="${e.fontSize}" font-weight="${e.fontWeight}" letter-spacing="${e.letterSpacing}" text-anchor="${anchor}" dominant-baseline="hanging">${wrapText(e).map((line, index) => `<tspan x="${x}" y="${index * e.fontSize * e.lineHeight}">${escapeXML(line)}</tspan>`).join('')}</text>`;
    if (interactive) inner = `<rect width="${e.width}" height="${e.height}" fill="transparent"/>${inner}`;
  }
  return `<g${attrs} transform="${transform}" opacity="${e.opacity}">${inner}</g>`;
}
export function elementSVG(element, interactive = false) {
  const page = createPage(); page.elements = [element];
  validateDocument({ schema: SCHEMA, version: VERSION, title: '', brand: clone(DEFAULT_BRAND), pages: [page] });
  return renderElement(element, interactive);
}
export function pageSVG(page, interactive = false, includeCredits = false) {
  // Validate at the export boundary as well; direct caller data must never become markup.
  validateDocument({ schema: SCHEMA, version: VERSION, title: '', brand: clone(DEFAULT_BRAND), pages: [page] });
  let content = '', currentGroup = null, groupRun = 0;
  for (const element of page.elements) {
    if (element.hidden) continue;
    if (element.groupId !== currentGroup) {
      if (currentGroup) content += '</g>';
      currentGroup = element.groupId;
      if (currentGroup) content += `<g${interactive ? ` data-group-id="${escapeXML(currentGroup)}" class="design-group"` : ` id="stencil-group-${escapeXML(currentGroup)}-${groupRun++}"`}>`;
    }
    content += renderElement(element, interactive);
  }
  if (currentGroup) content += '</g>';
  const background = !page.transparentBackground || interactive ? `<rect width="100%" height="100%" fill="${page.transparentBackground ? 'transparent' : page.background}"/>` : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${page.width}" height="${page.height}" viewBox="0 0 ${page.width} ${page.height}"${interactive ? ' id="artboard" aria-label="Design canvas" role="img"' : ''}>${!interactive && includeCredits ? assetMetadataXML(page.elements.filter(element => !element.hidden)) : ''}${background}${content}</svg>`;
}
