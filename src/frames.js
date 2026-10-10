/** Original photo frames and collage geometry. No DOM, network or model imports. */
import { checkEmbeddedRasterLimits } from './raster-limits.js';
export const FRAME_FIELDS = ['shape', 'cornerRadius', 'borderColour', 'borderWidth'];
export const FRAME_SHAPES = ['rect', 'rounded', 'circle', 'diamond', 'star', 'arch'];
const IMAGE_FIELDS = ['src', 'sourceWidth', 'sourceHeight', 'crop', 'filters'];
const COMMON_FIELDS = ['id', 'type', 'x', 'y', 'width', 'height', 'rotation', 'fill', 'opacity', 'locked', 'hidden', 'flipX', 'flipY', 'groupId', 'gradient', 'credit'];
const fail = message => { throw new Error(message); };
const number = (value, name, low, high) => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < low || value > high) fail(`${name} must be between ${low} and ${high}.`);
};
function plain(value, name, allowed, required = allowed) {
  if (!value || typeof value !== 'object' || Object.getPrototypeOf(value) !== Object.prototype) fail(`${name} must be a plain object.`);
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (typeof key !== 'string' || !allowed.includes(key) || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) fail(`${name} contains unsupported fields.`);
  }
  if (required.some(key => !Object.hasOwn(value, key))) fail(`${name} has missing fields.`);
}
const colour = (value, name) => { if (typeof value !== 'string' || !/^#[0-9a-f]{6}$/i.test(value)) fail(`${name} must be a six-digit hex colour.`); };
const svgNumber = value => String(Number(value.toFixed(8)));
const xml = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&apos;');

/** Type fields only: the document model supplies common geometry and identity. */
export function defaultsForFrame(patch = {}) {
  const width = Number.isFinite(patch.width) && patch.width > 0 ? patch.width : 240;
  const height = Number.isFinite(patch.height) && patch.height > 0 ? patch.height : 240;
  return {
    src: patch.src ?? '', sourceWidth: patch.sourceWidth ?? width, sourceHeight: patch.sourceHeight ?? height,
    crop: { x: 0, y: 0, width: 1, height: 1, ...patch.crop },
    filters: { brightness: 1, contrast: 1, saturation: 1, grayscale: 0, blur: 0, ...patch.filters },
    shape: patch.shape ?? 'rounded', cornerRadius: patch.cornerRadius ?? Math.min(24, width / 2, height / 2),
    borderColour: patch.borderColour ?? '#232a27', borderWidth: patch.borderWidth ?? 0
  };
}

/** Validates complete frame/image fields. Empty sources are intentional placeholders. */
export function validateFrameFields(element) {
  plain(element, 'Photo frame', [...COMMON_FIELDS, ...IMAGE_FIELDS, ...FRAME_FIELDS], ['type', 'width', 'height', ...IMAGE_FIELDS, ...FRAME_FIELDS]);
  if (element.type !== 'frame' || !FRAME_SHAPES.includes(element.shape)) fail('Choose a frame shape available in Stencil Studio.');
  number(element.width, 'Frame width', 1, 8192); number(element.height, 'Frame height', 1, 8192);
  number(element.cornerRadius, 'Frame corner radius', 0, Math.min(element.width, element.height) / 2);
  colour(element.borderColour, 'Frame border colour'); number(element.borderWidth, 'Frame border width', 0, 40);
  if (typeof element.src !== 'string' || element.src.length > 8 * 1024 * 1024 + 64) fail('Choose an embedded photo up to 6 MB before encoding.');
  if (element.src) {
    const prefix = /^data:image\/(?:png|jpeg|webp|gif);base64,/.exec(element.src);
    const encoded = prefix ? element.src.slice(prefix[0].length) : '';
    if (!encoded || encoded.length % 4 || !/^[a-zA-Z0-9+/]+={0,2}$/.test(encoded)) fail('Frames must use embedded PNG, JPEG, WebP or GIF images.');
  }
  number(element.sourceWidth, 'Source width', 1, 65535); number(element.sourceHeight, 'Source height', 1, 65535);
  if (element.src) checkEmbeddedRasterLimits(element.src, element.sourceWidth, element.sourceHeight);
  plain(element.crop, 'Frame crop', ['x', 'y', 'width', 'height']);
  number(element.crop.x, 'Crop x', 0, 1); number(element.crop.y, 'Crop y', 0, 1);
  number(element.crop.width, 'Crop width', .0001, 1); number(element.crop.height, 'Crop height', .0001, 1);
  if (element.crop.x + element.crop.width > 1 + Number.EPSILON || element.crop.y + element.crop.height > 1 + Number.EPSILON) fail('Keep the crop inside the original image.');
  plain(element.filters, 'Frame adjustments', ['brightness', 'contrast', 'saturation', 'grayscale', 'blur']);
  for (const field of ['brightness', 'contrast', 'saturation']) number(element.filters[field], field, 0, 2);
  number(element.filters.grayscale, 'Grayscale', 0, 1); number(element.filters.blur, 'Blur', 0, 20);
  return element;
}

function shapeSVG(element, attributes = '') {
  const width = svgNumber(element.width), height = svgNumber(element.height);
  if (element.shape === 'rect' || element.shape === 'rounded') return `<rect width="${width}" height="${height}"${element.shape === 'rounded' ? ` rx="${svgNumber(element.cornerRadius)}"` : ''}${attributes}/>`;
  if (element.shape === 'circle') return `<ellipse cx="${svgNumber(element.width / 2)}" cy="${svgNumber(element.height / 2)}" rx="${svgNumber(element.width / 2)}" ry="${svgNumber(element.height / 2)}"${attributes}/>`;
  if (element.shape === 'arch') return `<path d="M0 ${height} V${svgNumber(element.height / 2)} A${svgNumber(element.width / 2)} ${svgNumber(element.height / 2)} 0 0 1 ${width} ${svgNumber(element.height / 2)} V${height} Z"${attributes}/>`;
  const points = element.shape === 'diamond' ? [[.5, 0], [1, .5], [.5, 1], [0, .5]] : Array.from({ length: 10 }, (_, index) => {
    const angle = -Math.PI / 2 + index * Math.PI / 5, radius = index % 2 ? .23 : .5;
    return [.5 + Math.cos(angle) * radius, .5 + Math.sin(angle) * radius];
  });
  return `<polygon points="${points.map(([x, y]) => `${svgNumber(x * element.width)},${svgNumber(y * element.height)}`).join(' ')}"${attributes}/>`;
}

/** A caller-supplied unique ID keeps preview and export namespaces separate. */
export function frameClipSVG(id, element) {
  if (typeof id !== 'string' || !/^[\w-]{1,180}$/.test(id)) fail('The frame needs a valid clipping ID.');
  if (!FRAME_SHAPES.includes(element.shape)) fail('Choose a frame shape available in Stencil Studio.');
  number(element.width, 'Frame width', 1, 8192); number(element.height, 'Frame height', 1, 8192);
  number(element.cornerRadius, 'Frame corner radius', 0, Math.min(element.width, element.height) / 2);
  return `<clipPath id="${id}" clipPathUnits="userSpaceOnUse">${shapeSVG(element)}</clipPath>`;
}

/** Safe inner SVG; the model retains position, grouping, rotation, flips and opacity. */
export function renderFrameContent(element, escapeXML = xml, interactive = false) {
  validateFrameFields(element);
  if (typeof escapeXML !== 'function') fail('An XML escaping function is required.');
  if (typeof element.id !== 'string' || !/^[\w-]{1,100}$/.test(element.id)) fail('This frame needs a valid layer ID.');
  colour(element.fill, 'Frame colour');
  const clipId = `stencil-frame-clip-${element.id}`, filterId = `stencil-frame-filter-${element.id}`;
  const f = element.filters, filtered = f.brightness !== 1 || f.contrast !== 1 || f.saturation !== 1 || f.grayscale !== 0 || f.blur !== 0;
  const slope = f.brightness * f.contrast, intercept = .5 * (1 - f.contrast);
  const filter = element.src && filtered ? `<filter id="${filterId}" x="-100%" y="-100%" width="300%" height="300%" color-interpolation-filters="sRGB"><feComponentTransfer>${['R', 'G', 'B'].map(channel => `<feFunc${channel} type="linear" slope="${svgNumber(slope)}" intercept="${svgNumber(intercept)}"/>`).join('')}</feComponentTransfer><feColorMatrix type="saturate" values="${f.saturation}"/><feColorMatrix type="saturate" values="${1 - f.grayscale}"/>${f.blur ? `<feGaussianBlur stdDeviation="${f.blur}"/>` : ''}</filter>` : '';
  let content = shapeSVG(element, ` fill="${element.fill}"`);
  if (element.src) {
    const c = element.crop;
    const viewport = [c.x * element.sourceWidth, c.y * element.sourceHeight, c.width * element.sourceWidth, c.height * element.sourceHeight].map(svgNumber).join(' ');
    content += `<g${filtered ? ` filter="url(#${filterId})"` : ''}><svg width="${element.width}" height="${element.height}" viewBox="${viewport}" preserveAspectRatio="xMidYMid slice" overflow="hidden"><image width="${element.sourceWidth}" height="${element.sourceHeight}" href="${escapeXML(element.src)}" preserveAspectRatio="xMidYMid slice"/></svg></g>`;
  } else {
    // Small original landscape artwork stays useful even in tiny empty frames.
    content += `<svg width="${element.width}" height="${element.height}" viewBox="0 0 240 240" preserveAspectRatio="xMidYMid slice" aria-hidden="true"><path d="M0 195 76 106l50 59 39-42 75 72v45H0Z" fill="#c5d6c8"/><circle cx="160" cy="70" r="19" fill="#f6f1e7"/><rect x="96" y="92" width="48" height="40" rx="7" fill="#ffffff" fill-opacity=".85"/><path d="M108 112h24m-12-12v24" stroke="#2b6b5b" stroke-width="3" stroke-linecap="round"/></svg>`;
  }
  const border = element.borderWidth ? shapeSVG(element, ` fill="none" stroke="${element.borderColour}" stroke-width="${element.borderWidth}" stroke-linejoin="round"`) : '';
  return `<defs>${frameClipSVG(clipId, element)}${filter}</defs><g clip-path="url(#${clipId})">${content}</g>${border}${interactive ? shapeSVG(element, ' fill="transparent"') : ''}`;
}

/** Bounded empty frame patches. The caller supplies IDs and an optional group. */
export function collageLayout(page, preset, { padding, gutter } = {}) {
  number(page?.width, 'Page width', 64, 4096); number(page?.height, 'Page height', 64, 4096);
  if (!['2columns', '3columns', '2x2', 'hero'].includes(preset)) fail('Choose a collage layout available in Stencil Studio.');
  const shortest = Math.min(page.width, page.height);
  padding ??= Math.min(40, shortest * .06); gutter ??= Math.min(20, shortest * .03);
  number(padding, 'Collage padding', 0, shortest / 3); number(gutter, 'Collage gap', 0, shortest / 3);
  const width = page.width - 2 * padding, height = page.height - 2 * padding;
  const patch = (x, y, w, h) => {
    number(w, 'Collage frame width', 1, 8192); number(h, 'Collage frame height', 1, 8192);
    return { type: 'frame', x, y, width: w, height: h, fill: '#e7ece8', ...defaultsForFrame({ width: w, height: h, shape: 'rounded', cornerRadius: Math.min(12, w / 2, h / 2) }) };
  };
  if (preset.endsWith('columns')) {
    const count = preset === '2columns' ? 2 : 3, cell = (width - gutter * (count - 1)) / count;
    return Array.from({ length: count }, (_, index) => patch(padding + index * (cell + gutter), padding, cell, height));
  }
  if (preset === '2x2') {
    const w = (width - gutter) / 2, h = (height - gutter) / 2;
    return Array.from({ length: 4 }, (_, index) => patch(padding + (index % 2) * (w + gutter), padding + Math.floor(index / 2) * (h + gutter), w, h));
  }
  const heroWidth = (width - gutter) * .64, sideWidth = width - gutter - heroWidth, sideHeight = (height - gutter) / 2;
  return [patch(padding, padding, heroWidth, height), patch(padding + heroWidth + gutter, padding, sideWidth, sideHeight), patch(padding + heroWidth + gutter, padding + sideHeight + gutter, sideWidth, sideHeight)];
}
