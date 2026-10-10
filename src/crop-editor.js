/** Local drag-and-zoom photo cropping. Importing this module has no DOM effects. */
import { frameClipSVG, validateFrameFields } from './frames.js';
const fail = message => { throw new Error(message); };
const finite = (value, name, low, high = Infinity) => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < low || value > high) fail(`${name} is outside the supported range.`);
  return value;
};
const clamp = (value, low, high) => Math.min(high, Math.max(low, value));
function dimensions(image, viewport) {
  const sw = finite(image?.sourceWidth, 'Photo width', 1, 65535), sh = finite(image?.sourceHeight, 'Photo height', 1, 65535);
  const vw = finite(viewport?.width, 'Crop width', 1, 8192), vh = finite(viewport?.height, 'Crop height', 1, 8192);
  const minimumScale = Math.max(vw / sw, vh / sh), maximumScale = Math.min(vw / (sw * .0001), vh / (sh * .0001));
  if (maximumScale + Number.EPSILON < minimumScale) fail('Choose a less narrow frame for this photo.');
  return { sw, sh, vw, vh, minimumScale, maximumScale };
}
function cropBounds(crop) {
  finite(crop?.x, 'Crop left', 0, 1); finite(crop?.y, 'Crop top', 0, 1);
  finite(crop?.width, 'Crop width', .0001, 1); finite(crop?.height, 'Crop height', .0001, 1);
  if (crop.x + crop.width > 1 + Number.EPSILON || crop.y + crop.height > 1 + Number.EPSILON) fail('Keep the crop inside the original photo.');
  return crop;
}

/** A placement is the source image's top-left and scale in viewport coordinates. */
export function clampPlacement(image, placement, viewport) {
  const { sw, sh, vw, vh, minimumScale, maximumScale } = dimensions(image, viewport);
  finite(placement?.x, 'Photo position', -Infinity); finite(placement?.y, 'Photo position', -Infinity);
  const scale = clamp(finite(placement?.scale, 'Photo zoom', Number.MIN_VALUE), minimumScale, maximumScale);
  return { x: clamp(placement.x, vw - sw * scale, 0), y: clamp(placement.y, vh - sh * scale, 0), scale };
}

/** Converts the actually visible region into the model's normalised source crop. */
export function cropFromPlacement(image, placement, viewport) {
  const p = clampPlacement(image, placement, viewport), { sw, sh, vw, vh } = dimensions(image, viewport);
  const width = clamp(vw / (sw * p.scale), .0001, 1), height = clamp(vh / (sh * p.scale), .0001, 1);
  // Bounding x against 1-width also avoids accumulated floating-point overflow.
  return { x: clamp(-p.x / (sw * p.scale), 0, 1 - width), y: clamp(-p.y / (sh * p.scale), 0, 1 - height), width, height };
}

/** Existing numeric crops may have a different ratio; match SVG's centred slice. */
export function placementFromCrop(image, crop, viewport) {
  cropBounds(crop);
  const { sw, sh, vw, vh } = dimensions(image, viewport);
  const scale = Math.max(vw / (crop.width * sw), vh / (crop.height * sh));
  return clampPlacement(image, {
    x: (vw - crop.width * sw * scale) / 2 - crop.x * sw * scale,
    y: (vh - crop.height * sh * scale) / 2 - crop.y * sh * scale,
    scale
  }, viewport);
}

/** Centred fill, with no stretching or empty edges. Aspect is width / height. */
export function coverCrop(image, aspect = image.width / image.height) {
  finite(aspect, 'Crop aspect', 1 / 8192, 8192);
  const viewport = aspect >= 1 ? { width: Math.min(8192, aspect), height: 1 } : { width: 1, height: Math.min(8192, 1 / aspect) };
  const { sw, sh, vw, vh, minimumScale } = dimensions(image, viewport);
  return cropFromPlacement(image, { x: (vw - sw * minimumScale) / 2, y: (vh - sh * minimumScale) / 2, scale: minimumScale }, viewport);
}

/** Zoom about a point while keeping source edges outside the crop. */
export function zoomPlacement(image, placement, scale, viewport, anchor = { x: viewport.width / 2, y: viewport.height / 2 }) {
  finite(anchor?.x, 'Zoom anchor', 0, viewport.width); finite(anchor?.y, 'Zoom anchor', 0, viewport.height);
  const current = clampPlacement(image, placement, viewport), bounds = dimensions(image, viewport);
  const nextScale = clamp(finite(scale, 'Photo zoom', Number.MIN_VALUE), bounds.minimumScale, bounds.maximumScale);
  const ratio = nextScale / current.scale;
  return clampPlacement(image, { x: anchor.x - (anchor.x - current.x) * ratio, y: anchor.y - (anchor.y - current.y) * ratio, scale: nextScale }, viewport);
}

function aspectDimensions(image, aspect) {
  finite(aspect, 'Crop aspect', 1 / 8192, 8192);
  let width = image.width, height = width / aspect;
  if (height > 8192) { height = 8192; width = height * aspect; }
  if (height < 1) { height = 1; width = aspect; }
  if (width > 8192) { width = 8192; height = width / aspect; }
  if (width < 1) { width = 1; height = 1 / aspect; }
  return { width, height };
}

/**
 * Captures a clone of one image. Apply emits {crop,width,height}; frames keep
 * their original dimensions. The caller must check its document/target revision.
 * Link src/crop-editor.css from the app. close/cancel/destroy all cancel once.
 */
export function openCropEditor(image, { onApply, onCancel = () => {} } = {}) {
  if (typeof onApply !== 'function' || typeof onCancel !== 'function') fail('Crop actions are required.');
  if (typeof document === 'undefined' || !document.body) fail('The photo crop editor needs a browser.');
  const source = structuredClone(image), framed = source.type === 'frame';
  if (!['image', 'frame'].includes(source.type)) fail('Choose a photo or a filled photo frame.');
  validateFrameFields(framed ? source : { ...source, type: 'frame', shape: 'rect', cornerRadius: 0, borderColour: '#232a27', borderWidth: 0 });
  if (!source.src) fail('Add a photo to this frame before cropping it.');
  const previousFocus = document.activeElement;
  const namespace = `stencil-crop-preview-${globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2)}`;
  const dialog = document.createElement('dialog'); dialog.className = 'crop-editor';
  dialog.setAttribute('aria-labelledby', `${namespace}-title`);
  dialog.innerHTML = `<form method="dialog" class="crop-editor-form"><header><div><h2 id="${namespace}-title">Crop photo</h2><p>Drag the photo to choose what stays in view.</p></div><button type="button" data-crop="close" class="crop-close" aria-label="Close crop editor">×</button></header><div class="crop-preview-wrap"><svg class="crop-viewport" data-crop="viewport" xmlns="http://www.w3.org/2000/svg" role="img" tabindex="0" aria-label="Photo crop preview. Arrow keys move the photo; plus and minus change zoom."><defs data-crop="defs"></defs><g data-crop="clipped"><image data-crop="photo" preserveAspectRatio="xMidYMid slice"/></g></svg></div><div class="crop-controls"><label class="crop-zoom-label">Zoom <input data-crop="zoom" type="range" min="1" max="20" step="0.01" value="1"><output data-crop="zoom-value">100%</output></label><label class="crop-aspect-label">Shape <select data-crop="aspect"><option value="current">${framed ? 'Keep frame shape' : 'Current proportions'}</option>${framed ? '' : '<option value="original">Original photo</option><option value="1">Square</option><option value="1.3333333333333333">Landscape · 4:3</option><option value="1.7777777777777777">Wide · 16:9</option><option value="0.75">Portrait · 3:4</option>'}</select></label><div class="crop-reset-actions"><button type="button" data-crop="fit">Fit photo</button><button type="button" data-crop="reset">Reset</button></div></div><p class="crop-error" data-crop="error" role="alert" hidden></p><footer><button type="button" data-crop="cancel">Cancel</button><button type="submit" data-crop="apply" class="crop-apply">Apply crop</button></footer></form>`;
  const find = key => dialog.querySelector(`[data-crop="${key}"]`);
  const viewportElement = find('viewport'), photo = find('photo'), zoom = find('zoom'), aspect = find('aspect'), apply = find('apply');
  const listeners = [], listen = (element, name, handler, options) => { element.addEventListener(name, handler, options); listeners.push(() => element.removeEventListener(name, handler, options)); };
  let done = false, applying = false, drag = null, viewport, placement, output = { width: source.width, height: source.height };
  photo.setAttribute('href', source.src);
  const releaseDrag = () => {
    const captured = drag; drag = null; viewportElement.classList.remove('dragging');
    if (captured) { try { viewportElement.releasePointerCapture(captured.id); } catch { /* Capture may already have ended. */ } }
  };
  const finish = (cancelled = true) => {
    if (done) return;
    done = true; releaseDrag(); listeners.splice(0).forEach(remove => remove());
    if (dialog.open) dialog.close(); dialog.remove();
    if (previousFocus?.isConnected && typeof previousFocus.focus === 'function') previousFocus.focus();
    if (cancelled) onCancel();
  };
  const error = message => { const element = find('error'); element.textContent = message; element.hidden = !message; };
  const update = () => {
    placement = clampPlacement(source, placement, viewport);
    photo.setAttribute('x', String(placement.x)); photo.setAttribute('y', String(placement.y));
    photo.setAttribute('width', String(source.sourceWidth * placement.scale)); photo.setAttribute('height', String(source.sourceHeight * placement.scale));
    const minimum = dimensions(source, viewport).minimumScale, factor = placement.scale / minimum;
    zoom.max = String(Math.max(20, factor)); zoom.value = String(factor); find('zoom-value').textContent = `${Math.round(factor * 100)}%`;
  };
  const prepare = (crop = source.crop) => {
    const scale = Math.min(640 / output.width, 400 / output.height);
    viewport = { width: output.width, height: output.height };
    viewportElement.setAttribute('viewBox', `0 0 ${viewport.width} ${viewport.height}`);
    viewportElement.setAttribute('width', String(viewport.width)); viewportElement.setAttribute('height', String(viewport.height));
    viewportElement.style.width = `${viewport.width * scale}px`;
    const frame = { shape: framed ? source.shape : 'rect', width: viewport.width, height: viewport.height, cornerRadius: framed ? source.cornerRadius : 0 };
    const f = source.filters, slope = f.brightness * f.contrast, intercept = .5 * (1 - f.contrast);
    find('defs').innerHTML = `${frameClipSVG(namespace, frame)}<filter id="${namespace}-filter" x="-100%" y="-100%" width="300%" height="300%" color-interpolation-filters="sRGB"><feComponentTransfer>${['R', 'G', 'B'].map(channel => `<feFunc${channel} type="linear" slope="${slope}" intercept="${intercept}"/>`).join('')}</feComponentTransfer><feColorMatrix type="saturate" values="${f.saturation}"/><feColorMatrix type="saturate" values="${1 - f.grayscale}"/>${f.blur ? `<feGaussianBlur stdDeviation="${f.blur}"/>` : ''}</filter>`;
    find('clipped').setAttribute('clip-path', `url(#${namespace})`);
    find('clipped').setAttribute('transform', `translate(${source.flipX ? viewport.width : 0} ${source.flipY ? viewport.height : 0}) scale(${source.flipX ? -1 : 1} ${source.flipY ? -1 : 1})`);
    photo.setAttribute('filter', `url(#${namespace}-filter)`);
    placement = placementFromCrop(source, crop, viewport); update();
  };
  const point = event => {
    const bounds = viewportElement.getBoundingClientRect();
    if (!bounds.width || !bounds.height || !Number.isFinite(event.clientX) || !Number.isFinite(event.clientY)) return null;
    const x = (event.clientX - bounds.left) * viewport.width / bounds.width, y = (event.clientY - bounds.top) * viewport.height / bounds.height;
    return { x: source.flipX ? viewport.width - x : x, y: source.flipY ? viewport.height - y : y };
  };
  listen(viewportElement, 'pointerdown', event => {
    if (done || applying || drag || event.isPrimary === false || (event.pointerType === 'mouse' && event.button !== 0)) return;
    const p = point(event); if (!p) return;
    event.preventDefault(); drag = { id: event.pointerId, x: p.x, y: p.y, placement: { ...placement } };
    try { viewportElement.setPointerCapture(event.pointerId); } catch { releaseDrag(); return; }
    viewportElement.classList.add('dragging'); viewportElement.focus();
  });
  listen(viewportElement, 'pointermove', event => {
    if (!drag || drag.id !== event.pointerId || done || applying) return;
    const p = point(event); if (!p) return;
    event.preventDefault(); placement = { x: drag.placement.x + p.x - drag.x, y: drag.placement.y + p.y - drag.y, scale: drag.placement.scale }; update();
  });
  for (const name of ['pointerup', 'pointercancel', 'lostpointercapture']) listen(viewportElement, name, event => { if (drag?.id === event.pointerId) releaseDrag(); });
  listen(viewportElement, 'keydown', event => {
    if (done || applying) return;
    const directions = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    if (directions[event.key]) { event.preventDefault(); const [dx, dy] = directions[event.key], step = event.shiftKey ? 30 : 5; placement = { ...placement, x: placement.x + dx * step * (source.flipX ? -1 : 1), y: placement.y + dy * step * (source.flipY ? -1 : 1) }; update(); }
    else if (['+', '=', '-'].includes(event.key)) { event.preventDefault(); placement = zoomPlacement(source, placement, placement.scale * (event.key === '-' ? 1 / 1.1 : 1.1), viewport); update(); }
  });
  listen(zoom, 'input', () => { if (!done && !applying) { releaseDrag(); placement = zoomPlacement(source, placement, dimensions(source, viewport).minimumScale * Number(zoom.value), viewport); update(); } });
  listen(aspect, 'change', () => {
    if (done || applying || framed) return;
    releaseDrag(); error('');
    try { const ratio = aspect.value === 'current' ? source.width / source.height : aspect.value === 'original' ? source.sourceWidth / source.sourceHeight : Number(aspect.value); output = aspectDimensions(source, ratio); prepare(coverCrop(source, output.width / output.height)); }
    catch (problem) { error(problem.message); aspect.value = 'current'; output = { width: source.width, height: source.height }; prepare(); }
  });
  listen(find('fit'), 'click', () => { if (!done && !applying) { releaseDrag(); prepare(coverCrop(source, output.width / output.height)); } });
  listen(find('reset'), 'click', () => { if (!done && !applying) { releaseDrag(); aspect.value = 'current'; output = { width: source.width, height: source.height }; prepare(); error(''); } });
  for (const key of ['cancel', 'close']) listen(find(key), 'click', () => finish());
  listen(dialog, 'cancel', event => { event.preventDefault(); finish(); });
  listen(dialog, 'close', () => finish());
  listen(dialog.querySelector('form'), 'submit', async event => {
    event.preventDefault(); if (done || applying) return;
    releaseDrag(); applying = true; apply.disabled = true; error('');
    try {
      const result = await onApply({ crop: cropFromPlacement(source, placement, viewport), width: output.width, height: output.height });
      if (result === false) fail('This photo has changed. Close the crop editor and open it again.');
      if (!done) finish(false);
    } catch (problem) { if (!done) error(problem.message || 'The crop could not be applied. Try again.'); }
    finally { applying = false; if (!done) apply.disabled = false; }
  });
  try { prepare(); document.body.append(dialog); dialog.showModal(); viewportElement.focus(); }
  catch (problem) { finish(false); throw problem; }
  return { dialog, close: () => finish(), cancel: () => finish(), destroy: () => finish() };
}
