import { defaultVideoSettings } from './video-settings.js';
/** Validated, local-only artwork transfers. No DOM, network or clipboard access. */
import {
  SCHEMA, VERSION, DEFAULT_BRAND, DEFAULT_GUIDE_SETTINGS,
  validateDocument, copyElements, pasteElements, boundsOfElements
} from './model.js';

export const CLIPBOARD_MIME = 'application/x-stencil-studio+json';
export const CLIPBOARD_PREFIX = 'STENCIL_STUDIO_CLIPBOARD_V1\n';
export const MAX_TRANSFER_BYTES = 12 * 1024 * 1024;

const fail = message => { throw new Error(message); };
const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const clone = value => structuredClone(value);

function record(value, name, allowed, required = allowed) {
  if (!value || typeof value !== 'object' || Object.getPrototypeOf(value) !== Object.prototype) fail(`${name} must be a plain object.`);
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== 'string' || (allowed && !allowed.includes(key))) fail(`${name} contains unsupported fields.`);
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !own(descriptor, 'value') || !descriptor.enumerable) fail(`${name} must contain ordinary data fields.`);
  }
  if (required && required.some(key => !own(value, key))) fail(`${name} has missing fields.`);
}

function list(value, name, minimum = 1, maximum = 300) {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype || value.length < minimum || value.length > maximum) fail(`${name} needs between ${minimum} and ${maximum} entries.`);
  for (const key of Reflect.ownKeys(value)) {
    if (key === 'length') continue;
    if (typeof key !== 'string' || !/^(?:0|[1-9][0-9]*)$/.test(key) || Number(key) >= value.length) fail(`${name} contains unsupported properties.`);
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !own(descriptor, 'value') || !descriptor.enumerable) fail(`${name} must contain ordinary values.`);
  }
  for (let index = 0; index < value.length; index++) if (!own(value, index)) fail(`${name} must not contain missing entries.`);
}

function finite(value, name, minimum = -Infinity, maximum = Infinity) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum || value > maximum) fail(`${name} must be a finite number between ${minimum} and ${maximum}.`);
}

function payloadBytes(payload) {
  if (typeof payload !== 'string') fail('Copied content must be JSON text.');
  if (new TextEncoder().encode(payload).byteLength > MAX_TRANSFER_BYTES) fail('Copied content is over the 12 MiB limit. Copy fewer layers.');
}

function validateElements(elements, sourcePage) {
  list(elements, 'Copied layers');
  // Check descriptors before reading IDs. The synthetic page must never collide
  // with an otherwise valid arbitrary layer or group identifier.
  const used = new Set();
  for (const element of elements) {
    record(element, 'Copied layer', undefined, undefined);
    if (typeof element.id === 'string') used.add(element.id);
    if (typeof element.groupId === 'string') used.add(element.groupId);
  }
  let pageId = 'clipboard-page';
  for (let suffix = 1; used.has(pageId); suffix++) pageId = `clipboard-page-${suffix}`;
  const legacy = elements.every(element => element.type !== 'frame' && ['gradient', 'credit', 'italic', 'underline', 'effect', 'effectColour', 'effectSize'].every(key => !Object.hasOwn(element, key)));
  const page = { id: pageId, name: '', width: sourcePage.width, height: sourcePage.height, background: '#ffffff', transparentBackground: false, guides: [], guideSettings: clone(DEFAULT_GUIDE_SETTINGS), elements };
  const validated = validateDocument(legacy ? { schema: SCHEMA, version: 4, title: '', brand: clone(DEFAULT_BRAND), pages: [page] } : {
    schema: SCHEMA, version: VERSION, title: '', video: defaultVideoSettings(), brand: clone(DEFAULT_BRAND),
    pages: [{
      id: pageId, name: '', width: sourcePage.width, height: sourcePage.height,
      background: '#ffffff', transparentBackground: false, backgroundGradient: null, duration: 3, guides: [],
      guideSettings: clone(DEFAULT_GUIDE_SETTINGS), elements
    }]
  });
  return validated.pages[0].elements;
}

export function encodeSelection(document, pageId, ids) {
  list(ids, 'Selected element IDs');
  if (ids.some(value => typeof value !== 'string')) fail('Selected element IDs must be strings.');
  const valid = validateDocument(document);
  const page = valid.pages.find(item => item.id === pageId);
  if (!page) fail('Page not found.');
  const sourcePage = { width: page.width, height: page.height };
  const elements = validateElements(copyElements(valid, pageId, ids), sourcePage);
  const payload = JSON.stringify({ schema: 'stencil-studio.clipboard', version: 1, sourcePage, elements });
  payloadBytes(payload);
  return payload;
}

export function decodeSelection(payloadString) {
  payloadBytes(payloadString);
  let payload;
  try { payload = JSON.parse(payloadString); }
  catch { fail('Copied content must contain valid JSON.'); }
  record(payload, 'Copied content', ['schema', 'version', 'sourcePage', 'elements']);
  if (payload.schema !== 'stencil-studio.clipboard' || payload.version !== 1) fail('This copied content uses an unsupported Stencil format or version.');
  record(payload.sourcePage, 'Copied page', ['width', 'height']);
  finite(payload.sourcePage.width, 'Source page width', 64, 4096);
  finite(payload.sourcePage.height, 'Source page height', 64, 4096);
  const sourcePage = { width: payload.sourcePage.width, height: payload.sourcePage.height };
  return { elements: validateElements(payload.elements, sourcePage), sourcePage };
}

export function encodeSelectionText(payloadString) {
  decodeSelection(payloadString);
  return CLIPBOARD_PREFIX + payloadString;
}

export function isSelectionText(text) {
  return typeof text === 'string' && text.startsWith(CLIPBOARD_PREFIX);
}

export function pasteSelection(document, pageId, payloadString, options = {}) {
  record(options, 'Paste options', ['point'], []);
  let point;
  if (own(options, 'point')) {
    record(options.point, 'Paste point', ['x', 'y']);
    finite(options.point.x, 'Paste point x');
    finite(options.point.y, 'Paste point y');
    point = options.point;
  }
  const valid = validateDocument(document);
  const page = valid.pages.find(item => item.id === pageId);
  if (!page) fail('Page not found.');
  const { elements } = decodeSelection(payloadString);
  const bounds = boundsOfElements(elements);
  const centre = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
  const requested = point ?? { x: centre.x + 24, y: centre.y + 24 };
  const clamp = (value, maximum) => Math.min(maximum, Math.max(0, value));
  const dx = clamp(requested.x, page.width) - centre.x;
  const dy = clamp(requested.y, page.height) - centre.y;
  const positioned = elements.map(element => ({ ...element, x: element.x + dx, y: element.y + dy }));
  return pasteElements(valid, pageId, positioned, 0);
}

export function insertElements(document, pageId, elements) {
  const valid = validateDocument(document);
  const page = valid.pages.find(item => item.id === pageId);
  if (!page) fail('Page not found.');
  const prepared = validateElements(elements, { width: page.width, height: page.height });
  return pasteElements(valid, pageId, prepared, 0);
}
