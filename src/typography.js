/** Native SVG text styling and two-stop gradients. No DOM, model or network calls. */
export const TEXT_STYLE_FIELDS = Object.freeze(['italic', 'underline', 'effect', 'effectColour', 'effectSize']);
export const TEXT_EFFECTS = Object.freeze(['none', 'shadow', 'outline']);

const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const fail = message => { throw new Error(message); };
const xml = value => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&apos;');

function ordinaryRecord(value, name, allowed = null, required = []) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) fail(`${name} must be a plain object.`);
  // Inspect every own descriptor before reading a field. A getter on an unrelated
  // property must not be run by validation, rendering or an implicit copy.
  const descriptors = Object.getOwnPropertyDescriptors(value);
  for (const key of Reflect.ownKeys(descriptors)) {
    if (typeof key !== 'string' || (allowed && !allowed.includes(key))) fail(`${name} contains unsupported properties.`);
    if (!descriptors[key].enumerable || !own(descriptors[key], 'value')) fail(`${name} must contain ordinary data fields.`);
  }
  if (required.some(key => !own(descriptors, key))) fail(`${name} has missing fields.`);
  return descriptors;
}

function number(value, name, minimum, maximum) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum || value > maximum) fail(`${name} must be between ${minimum} and ${maximum}.`);
}
function colour(value, name) {
  if (typeof value !== 'string' || !/^#[0-9a-f]{6}$/i.test(value)) fail(`${name} must be a six-digit hex colour.`);
}
function text(value, name, maximum) {
  if (typeof value !== 'string' || value.length > maximum || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)) fail(`${name} must be valid text up to ${maximum} characters.`);
}
function identifier(value) {
  if (typeof value !== 'string' || !/^[\w-]{1,180}$/.test(value)) fail('An SVG definition needs a valid identifier.');
}
function svgNumber(value) { return String(Math.abs(value) < 0.0000005 ? 0 : Number(value.toFixed(6))); }

/** A fresh set of v5 style fields; old designs keep their existing appearance. */
export function defaultTextStyles() {
  return { italic: false, underline: false, effect: 'none', effectColour: '#232a27', effectSize: 4 };
}

/** Checks complete style fields on an ordinary element without changing it. */
export function validateTextStyles(element) {
  ordinaryRecord(element, 'Text styles', null, TEXT_STYLE_FIELDS);
  for (const key of ['italic', 'underline']) if (typeof element[key] !== 'boolean') fail(`${key} must be true or false.`);
  if (!TEXT_EFFECTS.includes(element.effect)) fail('Choose no text effect, shadow or outline.');
  colour(element.effectColour, 'Text effect colour');
  number(element.effectSize, 'Text effect size', 0, 20);
  return element;
}

/** A null gradient means the solid colour remains in use. */
export function validateGradient(gradient) {
  if (gradient === null) return gradient;
  ordinaryRecord(gradient, 'Gradient', ['from', 'to', 'angle'], ['from', 'to', 'angle']);
  colour(gradient.from, 'Gradient start colour');
  colour(gradient.to, 'Gradient end colour');
  number(gradient.angle, 'Gradient angle', 0, 360);
  return gradient;
}

/**
 * A self-contained SVG definition. 0 degrees runs left to right and 90 degrees
 * runs top to bottom. Diagonals meet the bounding-box edges; 360 equals 0.
 */
export function gradientSVG(id, gradient) {
  identifier(id); validateGradient(gradient);
  if (gradient === null) return '';
  const radians = (gradient.angle % 360) * Math.PI / 180;
  const horizontal = Math.cos(radians), vertical = Math.sin(radians);
  const extent = 0.5 / Math.max(Math.abs(horizontal), Math.abs(vertical));
  const x1 = 0.5 - horizontal * extent, y1 = 0.5 - vertical * extent;
  const x2 = 0.5 + horizontal * extent, y2 = 0.5 + vertical * extent;
  return `<defs><linearGradient id="${id}" x1="${svgNumber(x1 * 100)}%" y1="${svgNumber(y1 * 100)}%" x2="${svgNumber(x2 * 100)}%" y2="${svgNumber(y2 * 100)}%" gradientUnits="objectBoundingBox"><stop offset="0%" stop-color="${gradient.from}"/><stop offset="100%" stop-color="${gradient.to}"/></linearGradient></defs>`;
}

/** Safe attribute value for artwork that includes the matching definition. */
export function fillReference(id, solid, gradient) {
  identifier(id); colour(solid, 'Solid colour'); validateGradient(gradient);
  return gradient === null ? solid : `url(#${id})`;
}

function ordinaryLines(lines) {
  if (!Array.isArray(lines) || Object.getPrototypeOf(lines) !== Array.prototype) fail('Wrapped text must be an ordinary array.');
  const descriptors = Object.getOwnPropertyDescriptors(lines);
  const length = descriptors.length?.value;
  if (!Number.isInteger(length) || length < 1 || length > 10001) fail('Wrapped text needs between 1 and 10,001 lines.');
  for (const key of Reflect.ownKeys(descriptors)) {
    if (key === 'length') continue;
    if (typeof key !== 'string' || !/^(?:0|[1-9]\d*)$/.test(key) || Number(key) >= length || !descriptors[key].enumerable || !own(descriptors[key], 'value')) fail('Wrapped text must contain ordinary values.');
  }
  let characters = 0;
  for (let index = 0; index < length; index++) {
    if (!own(descriptors, index)) fail('Wrapped text must not contain missing lines.');
    const value = descriptors[index].value;
    text(value, 'Wrapped line', 10000); characters += value.length;
  }
  if (characters > 10000) fail('Wrapped text can contain up to 10,000 characters.');
}

/**
 * Local text artwork; the model keeps its element transform and hit target.
 * The caller supplies already wrapped lines and its trusted XML escaping helper.
 * Completely absent style fields are accepted for standalone legacy rendering.
 */
export function renderStyledText(element, wrappedLines, escapeXML = xml) {
  const descriptors = ordinaryRecord(element, 'Text element');
  ordinaryLines(wrappedLines);
  if (typeof escapeXML !== 'function') fail('An XML escaping function is required.');
  identifier(element.id);
  number(element.width, 'Text width', 1, 8192);
  number(element.fontSize, 'Font size', 4, 500);
  if (![400, 700].includes(element.fontWeight)) fail('Font weight must be 400 or 700.');
  if (!['left', 'center', 'right'].includes(element.align)) fail('Align text to the left, centre or right.');
  text(element.fontFamily, 'Font family', 150);
  colour(element.fill, 'Text colour');
  const lineHeight = own(descriptors, 'lineHeight') ? element.lineHeight : 1.16;
  const letterSpacing = own(descriptors, 'letterSpacing') ? element.letterSpacing : 0;
  number(lineHeight, 'Line height', 0.8, 3);
  number(letterSpacing, 'Letter spacing', -10, 100);
  const hasStyles = TEXT_STYLE_FIELDS.some(key => own(descriptors, key));
  const styles = hasStyles ? validateTextStyles(element) : defaultTextStyles();
  const gradient = own(descriptors, 'gradient') ? element.gradient : null;
  const gradientId = `stencil-text-fill-${element.id}`;
  const shadowId = `stencil-text-shadow-${element.id}`;
  const fill = fillReference(gradientId, element.fill, gradient);
  let definitions = gradientSVG(gradientId, gradient);
  let effects = '';
  if (styles.italic) effects += ' font-style="italic"';
  if (styles.underline) effects += ' text-decoration="underline"';
  if (styles.effectSize > 0 && styles.effect === 'outline') effects += ` stroke="${styles.effectColour}" stroke-width="${svgNumber(styles.effectSize)}" stroke-linejoin="round" paint-order="stroke fill"`;
  if (styles.effectSize > 0 && styles.effect === 'shadow') {
    definitions += `<defs><filter id="${shadowId}" x="-100%" y="-100%" width="300%" height="300%" color-interpolation-filters="sRGB"><feDropShadow dx="${svgNumber(styles.effectSize / 2)}" dy="${svgNumber(styles.effectSize / 2)}" stdDeviation="${svgNumber(styles.effectSize / 4)}" flood-color="${styles.effectColour}" flood-opacity="1"/></filter></defs>`;
    effects += ` filter="url(#${shadowId})"`;
  }
  const anchor = element.align === 'center' ? 'middle' : element.align === 'right' ? 'end' : 'start';
  const x = element.align === 'center' ? element.width / 2 : element.align === 'right' ? element.width : 0;
  const spans = wrappedLines.map((line, index) => `<tspan x="${svgNumber(x)}" y="${svgNumber(index * element.fontSize * lineHeight)}">${escapeXML(line)}</tspan>`).join('');
  return `${definitions}<text fill="${fill}" font-family="${escapeXML(element.fontFamily)}" font-size="${svgNumber(element.fontSize)}" font-weight="${element.fontWeight}" letter-spacing="${svgNumber(letterSpacing)}" text-anchor="${anchor}" dominant-baseline="hanging"${effects}>${spans}</text>`;
}
