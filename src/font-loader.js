import { BUNDLED_FONTS } from './font-catalogue.js';
import { readLimitedBytes } from './asset-catalogue.js';

export const MAX_FONT_BYTES = 256 * 1024;
export const MAX_FONT_LOAD_MS = 15000;
const bytesCache = new Map(), loadedFaces = new WeakMap();
const fail = message => { throw new Error(message); };

export function documentFontFamilies(value) {
  const names = new Set();
  if (value?.brand?.fontFamily) names.add(value.brand.fontFamily);
  const pages = Array.isArray(value?.pages) ? value.pages : value?.elements ? [value] : [];
  for (const page of pages) for (const element of page.elements ?? []) if (typeof element.fontFamily === 'string') names.add(element.fontFamily);
  return BUNDLED_FONTS.filter(font => value === undefined || names.has(font.family));
}

export function fontURL(path, moduleURL = import.meta.url) {
  if (!/^fonts\/[a-z]+(?:-[a-z0-9]+)*-(?:400|700|400-700)-latin(?:-ext)?\.woff2$/.test(path)) fail('This font address is invalid.');
  return new URL(`../public/${path}`, moduleURL).href;
}

function rule(font, face, source) {
  return `@font-face{font-family:'${font.family}';font-style:normal;font-weight:${face.weight};font-display:swap;src:url('${source}') format('woff2');unicode-range:${face.unicodeRange};}`;
}

/** CSS for the editor/print page. Browsers request only the families actually used. */
export function fontStyleText(value) {
  return documentFontFamilies(value).flatMap(font => font.faces.map(face => rule(font, face, fontURL(face.path)))).join('\n');
}

async function fontBytes(face, { signal, fetchImpl = globalThis.fetch } = {}) {
  signal?.throwIfAborted();
  const cached = bytesCache.get(face.path);
  if (cached) return cached;
  const controller = new AbortController(), abort = () => controller.abort(signal.reason), timer = setTimeout(() => controller.abort(), 15000);
  signal?.addEventListener('abort', abort, { once: true });
  try {
    signal?.throwIfAborted();
    const response = await fetchImpl(fontURL(face.path), { credentials: 'omit', redirect: 'error', signal: controller.signal });
    const bytes = await readLimitedBytes(response, Math.min(MAX_FONT_BYTES, face.bytes), controller.signal);
    if (bytes.length !== face.bytes || bytes.length < 48 || String.fromCharCode(...bytes.subarray(0, 4)) !== 'wOF2' || new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(8) !== bytes.length) fail('This font file is damaged. Update Stencil and try again.');
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
    const hash = Array.from(digest, byte => byte.toString(16).padStart(2, '0')).join('');
    if (hash !== face.sha256) fail('This font file does not match the bundled version.');
    controller.signal.throwIfAborted();
    bytesCache.set(face.path, bytes);
    return bytes;
  } finally {
    clearTimeout(timer); signal?.removeEventListener('abort', abort);
  }
}

function loadNativeFace(instance, { signal, timeoutMs }) {
  signal?.throwIfAborted();
  const deadline = performance.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    let settled = false, timer;
    const finish = (error, failed = false) => {
      if (settled) return; settled = true; clearTimeout(timer); signal?.removeEventListener('abort', abort);
      if (failed) reject(error); else resolve(deadline);
    };
    const timedOut = () => finish(new Error('This font took too long to load. Try again.'), true);
    const abort = () => finish(signal.reason ?? new DOMException('Font loading cancelled.', 'AbortError'), true);
    const failed = error => finish(error instanceof Error ? error : new Error('This font could not be loaded. Try again.'), true);
    timer = setTimeout(timedOut, timeoutMs); signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) { abort(); return; }
    // FontFace has no cancellation API. Ignore late completion and consume late
    // rejection after abandoning this result; never add it to document.fonts.
    try {
      Promise.resolve(instance.load()).then(() => {
        if (signal?.aborted) abort(); else if (performance.now() >= deadline) timedOut(); else finish();
      }, failed);
    } catch (error) { failed(error); }
  });
}

/** Load a design's bundled faces before capture; native decoding has a 15s ceiling. */
export async function loadDocumentFonts(value, { document: owner = globalThis.document, FontFace: Face = globalThis.FontFace, signal, fetchImpl, fontLoadTimeoutMs = MAX_FONT_LOAD_MS } = {}) {
  if (!Number.isSafeInteger(fontLoadTimeoutMs) || fontLoadTimeoutMs < 1 || fontLoadTimeoutMs > MAX_FONT_LOAD_MS) fail('Choose a font loading limit between 1 and 15000 milliseconds.');
  const fonts = documentFontFamilies(value);
  if (!fonts.length) return [];
  if (!owner?.fonts || typeof Face !== 'function') fail('This browser cannot load the bundled fonts. Try a current browser.');
  let loaded = loadedFaces.get(owner);
  if (!loaded) { loaded = new Map(); loadedFaces.set(owner, loaded); }
  const results = [];
  for (const font of fonts) for (const face of font.faces) {
    signal?.throwIfAborted();
    const key = `${font.family}:${face.path}:${face.weight}`;
    if (loaded.has(key)) { results.push(loaded.get(key)); continue; }
    const bytes = await fontBytes(face, { signal, fetchImpl });
    const instance = new Face(font.family, bytes, { style: 'normal', weight: face.weight, unicodeRange: face.unicodeRange });
    const deadline = await loadNativeFace(instance, { signal, timeoutMs: fontLoadTimeoutMs });
    signal?.throwIfAborted(); if (performance.now() >= deadline) fail('This font took too long to load. Try again.');
    owner.fonts.add(instance); loaded.set(key, instance); results.push(instance);
  }
  return results;
}

const base64 = bytes => {
  let binary = '';
  for (let start = 0; start < bytes.length; start += 8192) binary += String.fromCharCode(...bytes.subarray(start, start + 8192));
  return btoa(binary);
};

/** Self-contained SVG CSS. Embedded fonts keep their OFL notices with the file. */
export async function documentFontCSS(value, options = {}) {
  const sections = [];
  for (const font of documentFontFamilies(value)) {
    const notice = font.notice.replaceAll('*/', '* /');
    sections.push(`/* ${font.family} — SIL Open Font Licence 1.1\n${notice} */`);
    for (const face of font.faces) sections.push(rule(font, face, `data:font/woff2;base64,${base64(await fontBytes(face, options))}`));
  }
  return sections.join('\n');
}
