/** Browser page export shared by the editor and local automation. */
import { pageSVG } from './model.js';
import { loadDocumentFonts, documentFontCSS } from './font-loader.js';
import { collectAssetNotices, appendExportNotices } from './asset-notices.js';
import { checkEmbeddedRasterLimits, MAX_RASTER_EDGE, MAX_RASTER_PIXELS } from './raster-limits.js';
export const EXPORT_STAGE_TIMEOUT_MS = 20_000;
const abort = signal => { if (signal?.aborted) throw new DOMException('Image download cancelled.', 'AbortError'); };
function waitForStage(promise, signal, message, disposeLateValue) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error, value) => { if (settled) return; settled = true; clearTimeout(timer); signal?.removeEventListener('abort', cancel); error ? reject(error) : resolve(value); };
    const cancel = () => finish(new DOMException('Image download cancelled.', 'AbortError'));
    const timer = setTimeout(() => finish(new Error(message)), EXPORT_STAGE_TIMEOUT_MS);
    signal?.addEventListener('abort', cancel, { once: true });
    Promise.resolve(promise).then(value => {
      if (settled) { try { disposeLateValue?.(value); } catch {} return; }
      finish(null, value);
    }, error => finish(error instanceof Error ? error : new Error(message)));
    if (signal?.aborted) cancel();
  });
}
const closeBitmap = bitmap => { try { bitmap?.close(); } catch {} };
async function checkPageImages(page, signal) {
  const sources = new Set();
  for (const element of page.elements) {
    if (element.hidden || !['image', 'frame'].includes(element.type) || !element.src || sources.has(element.src)) continue;
    sources.add(element.src); abort(signal);
    checkEmbeddedRasterLimits(element.src, element.sourceWidth, element.sourceHeight);
    if (typeof globalThis.createImageBitmap !== 'function') throw new Error('Your browser could not fully decode this photo. Try a current browser.');
    // Decode the encoded bytes, not an Image element: Image load/decode can
    // accept a damaged pixel stream and silently replace its pixels with alpha.
    const comma = element.src.indexOf(','), mime = element.src.slice(5, element.src.indexOf(';'));
    const binary = atob(element.src.slice(comma + 1)), bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
    const source = new Blob([bytes], { type: mime }); let bitmap;
    try {
      const unreadable = () => new Error('A photo in this page could not be read. Replace it and try again.');
      let decoded; try { decoded = globalThis.createImageBitmap(source); } catch { throw unreadable(); }
      const admission = Promise.resolve(decoded).catch(() => { throw unreadable(); });
      bitmap = await waitForStage(admission, signal, 'A photo in this page took too long to load. Try a smaller image.', closeBitmap); abort(signal);
      const width = bitmap.width, height = bitmap.height;
      if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1 || width > MAX_RASTER_EDGE || height > MAX_RASTER_EDGE || width * height > MAX_RASTER_PIXELS) throw new Error('Use an image up to 16,384 pixels on each side and 40 megapixels in total.');
    } finally { closeBitmap(bitmap); }
  }
}
export async function renderPageRaster(page, type = 'image/png', { signal } = {}) {
  if (!['image/png', 'image/jpeg'].includes(type)) throw new Error('Choose PNG or JPG for an image download.');
  abort(signal);
  // Validate before touching native image decoders or font loading. SVG image
  // load alone does not report a failed embedded raster, so admit those first.
  pageSVG(page); page = structuredClone(page);
  await checkPageImages(page, signal);
  await loadDocumentFonts(page, { signal }); const css = await documentFontCSS(page, { signal }); abort(signal);
  const markup = pageSVG(page, false, true, css), url = URL.createObjectURL(new Blob([markup], { type: 'image/svg+xml' }));
  const image = new Image(); let canvas;
  try {
    const loaded = new Promise((resolve, reject) => { image.onload = () => resolve(); image.onerror = () => reject(new Error('This page could not become an image. Try SVG from Download.')); image.src = url; });
    await waitForStage(loaded, signal, 'This page took too long to download. Try a smaller canvas or SVG.'); abort(signal);
    canvas = document.createElement('canvas'); canvas.width = Math.round(page.width); canvas.height = Math.round(page.height);
    const context = canvas.getContext('2d'); if (!context) throw new Error('Your browser could not make the image. Try SVG from Download.');
    if (type === 'image/jpeg') { context.fillStyle = page.background; context.fillRect(0, 0, canvas.width, canvas.height); }
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const blob = await waitForStage(new Promise(resolve => canvas.toBlob(resolve, type, .95)), signal, 'The image took too long to save. Try SVG instead.'); abort(signal);
    if (!(blob instanceof Blob) || !blob.size || blob.type !== type) throw new Error('Image export failed. Try SVG instead.');
    const notices = collectAssetNotices(page.elements);
    if (!notices.length) return blob;
    const bytes = new Uint8Array(await waitForStage(blob.arrayBuffer(), signal, 'The image could not be read for its asset credits.')); abort(signal);
    return new Blob([appendExportNotices(bytes, type, notices)], { type });
  } finally {
    image.onload = null; image.onerror = null; image.removeAttribute?.('src'); URL.revokeObjectURL(url);
    if (canvas) { canvas.width = 0; canvas.height = 0; }
  }
}
