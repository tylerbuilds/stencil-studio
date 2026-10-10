import { MAX_ASSET_BYTES, assetURL, readLimitedBytes } from './asset-catalogue.js';
import { embedAssetNotice } from './asset-notices.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const TAGS = new Set(['svg', 'g', 'path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon', 'defs', 'linearGradient', 'radialGradient', 'stop', 'clipPath', 'mask', 'title', 'desc']);
const ATTRS = new Set(['id', 'viewBox', 'width', 'height', 'x', 'y', 'x1', 'y1', 'x2', 'y2', 'cx', 'cy', 'r', 'rx', 'ry', 'd', 'points', 'fill', 'fill-rule', 'fill-opacity', 'clip-rule', 'stroke', 'stroke-width', 'stroke-linecap', 'stroke-linejoin', 'stroke-miterlimit', 'stroke-dasharray', 'stroke-dashoffset', 'stroke-opacity', 'opacity', 'transform', 'clip-path', 'mask', 'offset', 'stop-color', 'stop-opacity', 'gradientUnits', 'gradientTransform', 'spreadMethod', 'fx', 'fy', 'fr', 'clipPathUnits', 'maskUnits', 'maskContentUnits', 'preserveAspectRatio']);
const fail = message => { throw new Error(message); };

/** Only the pinned, simple drawing primitives used by these collections are accepted. */
export function sanitiseAssetSVG(source, colour = '#232a27') {
  if (typeof source !== 'string' || source.length > MAX_ASSET_BYTES || /<!DOCTYPE|<!ENTITY/i.test(source) || !/^#[a-f0-9]{6}$/i.test(colour)) fail('This artwork cannot be opened safely.');
  const document = new DOMParser().parseFromString(source, 'image/svg+xml'), svg = document.documentElement;
  if (svg.localName !== 'svg' || svg.namespaceURI !== SVG_NS || document.querySelector('parsererror')) fail('This artwork is damaged. Choose another asset.');
  const descendants = [document], nodes = []; let visited = 0;
  while (descendants.length) {
    const node = descendants.pop(); if (node.nodeType === 7) fail('This artwork contains an unsupported instruction.');
    if (++visited > 10001 || visited + descendants.length + node.childNodes.length > 10001) fail('This artwork is too complex to open.');
    if (node.nodeType === 1) nodes.push(node);
    for (const child of node.childNodes) descendants.push(child);
  }
  for (const node of nodes) {
    if (node.namespaceURI !== SVG_NS || !TAGS.has(node.localName)) fail('This artwork contains an unsupported drawing.');
    for (const attribute of [...node.attributes]) {
      const { name, value } = attribute;
      if (['class', 'version'].includes(name) || name === 'xmlns:xlink') { node.removeAttribute(name); continue; }
      if (name === 'xmlns' && node === svg && value === SVG_NS) continue;
      if (attribute.namespaceURI || !ATTRS.has(name) || value.length > MAX_ASSET_BYTES || /[\\\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value) || value.includes('/*')) fail('This artwork contains an unsupported setting.');
      if (/url\s*\(/i.test(value) && !/^url\(#[a-zA-Z0-9_-]+\)$/.test(value)) fail('This artwork contains an external reference.');
      if (/(?:https?:|data:|javascript:|file:|\/\/)/i.test(value)) fail('This artwork contains an external reference.');
    }
  }
  const ids = new Set(nodes.map(node => node.getAttribute('id')).filter(Boolean));
  for (const node of nodes) for (const attribute of [...node.attributes]) {
    const fragment = /^url\(#([a-zA-Z0-9_-]+)\)$/.exec(attribute.value);
    if (fragment && !ids.has(fragment[1])) fail('This artwork has a missing drawing reference.');
  }
  const box = (svg.getAttribute('viewBox') ?? '').trim().split(/[ ,]+/).map(Number);
  if (box.length !== 4 || box.some(value => !Number.isFinite(value)) || box[2] <= 0 || box[3] <= 0 || box[2] > 16384 || box[3] > 16384 || box[2] * box[3] > 40000000) fail('This artwork has an invalid size.');
  // SVG currentColor becomes a fixed, safe colour in the embedded artwork.
  for (const node of nodes) for (const name of ['fill', 'stroke', 'stop-color']) if (node.getAttribute(name)?.toLowerCase() === 'currentcolor') node.setAttribute(name, colour);
  // Keep the existing colour-removal tool's four-megapixel bound as well.
  const longest = Math.max(box[2], box[3]), edge = Math.min(2048, Math.sqrt(4000000 * longest * longest / (box[2] * box[3])));
  const width = Math.max(1, Math.floor(edge * box[2] / longest)), height = Math.max(1, Math.floor(edge * box[3] / longest));
  svg.setAttribute('width', String(width)); svg.setAttribute('height', String(height));
  return { svg: new XMLSerializer().serializeToString(svg), width, height };
}

async function verifiedText(path, hash, max, signal) {
  const response = await fetch(assetURL(path), { credentials: 'omit', redirect: 'error', signal });
  const bytes = await readLimitedBytes(response, max, signal);
  const digest = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(value => value.toString(16).padStart(2, '0')).join('');
  signal?.throwIfAborted(); if (digest !== hash) fail('This asset does not match its library copy. Reload Stencil and try again.');
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
}

async function rasterise({ svg, width, height }, signal) {
  signal?.throwIfAborted();
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' })), image = new Image();
  try {
    await new Promise((resolve, reject) => {
      const finish = () => { clearTimeout(timer); signal?.removeEventListener('abort', abort); image.onload = null; image.onerror = null; };
      const abort = () => { finish(); image.removeAttribute('src'); reject(new DOMException('Insertion cancelled.', 'AbortError')); };
      const timer = setTimeout(() => { finish(); image.removeAttribute('src'); reject(new Error('This artwork took too long to open. Choose another asset.')); }, 15000);
      image.onload = () => { finish(); resolve(); }; image.onerror = () => { finish(); reject(new Error('This artwork could not be opened. Choose another asset.')); };
      signal?.addEventListener('abort', abort, { once: true }); image.src = url;
    });
    signal?.throwIfAborted(); const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
    const context = canvas.getContext('2d'); if (!context) fail('Your browser could not add this artwork.'); context.drawImage(image, 0, 0, width, height);
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png')); signal?.throwIfAborted(); if (!blob || blob.size > 6 * 1024 * 1024) fail('This artwork is too large to add. Choose another asset.');
    return new Uint8Array(await blob.arrayBuffer());
  } finally { image.onload = null; image.onerror = null; image.removeAttribute('src'); URL.revokeObjectURL(url); }
}

export async function prepareAssetFile(asset, collection, { colour = '#232a27', signal } = {}) {
  if (!asset || !collection || asset.collection !== collection.id) fail('Choose an asset from the library.');
  const [source, notice] = await Promise.all([
    verifiedText(asset.path, asset.sha256, MAX_ASSET_BYTES, signal),
    verifiedText(collection.noticePath, collection.noticeSha256, 16384, signal)
  ]);
  signal?.throwIfAborted(); const artwork = sanitiseAssetSVG(source, colour), png = await rasterise(artwork, signal);
  const record = { collection: collection.id, id: asset.id, name: asset.name, license: collection.license, source: collection.source, notice };
  const bytes = embedAssetNotice(png, record); signal?.throwIfAborted();
  return new File([bytes], `${asset.id}.png`, { type: 'image/png' });
}
