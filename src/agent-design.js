/** Portable agent requests become ordinary, editable Stencil documents. No I/O. */
import { createDocument, createPage, createElement, validateDocument, validateCredit, PRESETS, TEMPLATES, templateDocument, MAX_DOCUMENT_BYTES } from './model.js';
import { identifyRaster, checkImageDimensions, MAX_IMAGE_BYTES } from './browser-intake.js';
import { checkEmbeddedRasterLimits } from './raster-limits.js';

export const AGENT_REQUEST_SCHEMA = 'stencil-design-request';
export const AGENT_REQUEST_VERSION = 1;
export const MAX_AGENT_ASSETS = 20;
const fail = message => { throw new Error(message); };
function plainJSON(value, name) {
  const stack = [{ value, depth: 0 }], path = new WeakSet(); let nodes = 0, characters = 0;
  while (stack.length) {
    const entry = stack.pop(), current = entry.value;
    if (entry.leave) { path.delete(current); continue; }
    if (++nodes > 500000 || entry.depth > 30) fail(`${name} is too complex. Use ordinary JSON within the document limits.`);
    if (current === null || typeof current === 'boolean' || typeof current === 'number' && Number.isFinite(current)) continue;
    if (typeof current === 'string') { characters += current.length; if (characters > MAX_DOCUMENT_BYTES) fail(`${name} is too large. Use a file up to 12 MB.`); continue; }
    if (!current || typeof current !== 'object' || ![Object.prototype, Array.prototype].includes(Object.getPrototypeOf(current)) || path.has(current)) fail(`${name} must contain ordinary JSON data, without cycles.`);
    const descriptors = Object.getOwnPropertyDescriptors(current), keys = Reflect.ownKeys(descriptors);
    if (keys.length > 2001) fail(`${name} is too complex. Use ordinary JSON within the document limits.`);
    const isArray = Array.isArray(current);
    if (keys.some(key => typeof key !== 'string' || key !== 'length' && (!descriptors[key].enumerable || !Object.hasOwn(descriptors[key], 'value')) || key === 'length' && !isArray)) fail(`${name} contains accessors or hidden properties.`);
    if (isArray && (keys.some(key => key !== 'length' && (!/^(0|[1-9]\d*)$/.test(key) || Number(key) >= current.length)) || keys.length !== current.length + 1)) fail(`${name} contains an incomplete array.`);
    path.add(current); stack.push({ value: current, leave: true });
    for (const key of keys) if (!(isArray && key === 'length')) stack.push({ value: descriptors[key].value, depth: entry.depth + 1 });
  }
}
function object(value, name, allowed) {
  if (!value || Object.getPrototypeOf(value) !== Object.prototype) fail(`${name} must be a plain object.`);
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Reflect.ownKeys(descriptors).some(key => typeof key !== 'string' || !descriptors[key].enumerable || !Object.hasOwn(descriptors[key], 'value') || !allowed.includes(key))) fail(`${name} contains unsupported properties.`);
}
function list(value, name, maximum, minimum = 0) {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype || value.length < minimum || value.length > maximum) fail(`${name} needs ${minimum} to ${maximum} entries.`);
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Reflect.ownKeys(descriptors).some(key => key !== 'length' && (typeof key !== 'string' || !/^(0|[1-9]\d*)$/.test(key) || Number(key) >= value.length || !descriptors[key].enumerable || !Object.hasOwn(descriptors[key], 'value'))) || Object.keys(value).length !== value.length) fail(`${name} must be a complete ordinary array.`);
}
function text(value, name, maximum = 150) {
  if (typeof value !== 'string' || value.length > maximum || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)) fail(`${name} must be valid text (up to ${maximum} characters).`);
}
const assetId = value => {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(value)) fail('Each asset needs an ID using letters, numbers, underscores or hyphens.');
};

/** Checks request structure before the CLI reads a file or downloads an image. */
export function validateAgentRequest(request) {
  plainJSON(request, 'Design request');
  object(request, 'Design request', ['schema', 'version', 'title', 'preset', 'template', 'brand', 'pages', 'assets']);
  if (request.schema !== AGENT_REQUEST_SCHEMA || request.version !== AGENT_REQUEST_VERSION) fail('Use a stencil-design-request version 1 request.');
  if (request.title !== undefined) text(request.title, 'Design title');
  if (request.preset !== undefined && !PRESETS.some(preset => preset.key === request.preset)) fail('Choose a preset listed by the presets command.');
  if (request.template !== undefined && !TEMPLATES.some(template => template.key === request.template)) fail('Choose a template listed by the presets command.');
  if (request.template !== undefined && (request.pages !== undefined || request.preset !== undefined)) fail('Choose a template, or supply pages and a preset.');
  if (request.brand !== undefined) object(request.brand, 'Brand', ['colours', 'fontFamily']);
  const pages = request.pages ?? [{}];
  list(pages, 'Request pages', 30, 1);
  let total = 0;
  for (const page of pages) {
    object(page, 'Request page', ['name', 'preset', 'width', 'height', 'background', 'transparentBackground', 'backgroundGradient', 'duration', 'elements']);
    if (page.name !== undefined) text(page.name, 'Page name', 100);
    if (page.preset !== undefined && !PRESETS.some(preset => preset.key === page.preset)) fail('Choose a page preset listed by the presets command.');
    if (page.preset !== undefined && (page.width !== undefined || page.height !== undefined)) fail('Choose a page preset or custom dimensions.');
    if ((page.width === undefined) !== (page.height === undefined)) fail('Custom pages need both width and height.');
    if (page.width !== undefined && (![page.width, page.height].every(value => Number.isInteger(value) && value >= 64 && value <= 4096))) fail('Custom page dimensions must be whole pixels between 64 and 4,096.');
    const elements = page.elements ?? [];
    list(elements, 'Request layers', 300);
    total += elements.length;
    if (total > 1000) fail('A design can hold up to 1,000 layers.');
    for (const layer of elements) {
      // createElement checks the native type-specific fields and defaults below.
      if (!layer || Object.getPrototypeOf(layer) !== Object.prototype) fail('Each request layer must be a plain object.');
      const descriptors = Object.getOwnPropertyDescriptors(layer);
      if (Reflect.ownKeys(descriptors).some(key => typeof key !== 'string' || !descriptors[key].enumerable || !Object.hasOwn(descriptors[key], 'value'))) fail('A request layer contains unsupported properties.');
      if (layer.asset !== undefined) { assetId(layer.asset); if (!['image', 'frame'].includes(layer.type)) fail('Only image and frame layers can use an asset.'); }
      const { asset, ...patch } = layer;
      createElement(layer.type, patch);
    }
  }
  const assets = request.assets ?? [];
  list(assets, 'Request assets', MAX_AGENT_ASSETS);
  const seen = new Set();
  for (const asset of assets) {
    object(asset, 'Request asset', ['id', 'file', 'url', 'prediction', 'outputIndex', 'credit']); assetId(asset.id);
    if (seen.has(asset.id)) fail('Asset IDs must be unique.'); seen.add(asset.id);
    if (['file', 'url', 'prediction'].filter(key => asset[key] !== undefined).length !== 1) fail('Each asset needs exactly one file, url or prediction source.');
    for (const key of ['file', 'url', 'prediction']) if (asset[key] !== undefined) { text(asset[key], `Asset ${key}`, 4000); if (!asset[key]) fail('Asset sources cannot be empty.'); }
    if (asset.url !== undefined) { let url; try { url = new URL(asset.url); } catch { fail('Asset URLs must use HTTPS.'); } if (url.protocol !== 'https:' || url.username || url.password || url.port && url.port !== '443') fail('Asset URLs must use HTTPS without credentials, on port 443.'); }
    if (asset.outputIndex !== undefined && (asset.prediction === undefined || !Number.isInteger(asset.outputIndex) || asset.outputIndex < 0 || asset.outputIndex > 99)) fail('Use outputIndex 0 to 99 only with a prediction file.');
    if (asset.credit !== undefined) validateCredit(asset.credit);
  }
  const referenced = new Set();
  for (const page of pages) for (const layer of page.elements ?? []) if (layer.asset !== undefined) { if (!seen.has(layer.asset)) fail(`Asset ${layer.asset} is not declared in this request.`); referenced.add(layer.asset); }
  if ([...seen].some(id => !referenced.has(id))) fail('Remove unused asset declarations; each asset must be placed on a page.');
  // Validate native layer fields before any caller performs external I/O. Only
  // missing image bytes are substituted, not typography, crop or geometry.
  const placeholders = Object.fromEntries([...seen].map(id => [id, { src: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGPQ8HP7DwADGgG8pjyfTwAAAABJRU5ErkJggg==', sourceWidth: 1, sourceHeight: 1, credit: null }]));
  assembleDesign(request, placeholders);
  return structuredClone(request);
}

/** Source URLs describe origin; query strings, fragments and credentials do not travel. */
export function sanitiseAgentCredit(credit = null) {
  validateCredit(credit);
  if (credit === null) return null;
  const clean = structuredClone(credit);
  for (const key of ['sourceUrl', 'licenceUrl']) if (clean[key]) { const url = new URL(clean[key]); url.search = ''; url.hash = ''; clean[key] = url.href; }
  return clean;
}

/** Header and allocation checks; a browser still checks full pixel decoding. */
export function imageAssetFromBytes(bytes, credit = null) {
  if (!(bytes instanceof Uint8Array) || !bytes.length || bytes.length > MAX_IMAGE_BYTES) fail('Use an image between 1 byte and 6 MiB.');
  const raster = identifyRaster(bytes); checkImageDimensions(raster.width, raster.height);
  let encoded;
  if (typeof Buffer !== 'undefined') encoded = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('base64');
  else { let binary = ''; for (let at = 0; at < bytes.length; at += 8192) binary += String.fromCharCode(...bytes.subarray(at, at + 8192)); encoded = btoa(binary); }
  const src = `data:${raster.type};base64,${encoded}`;
  checkEmbeddedRasterLimits(src, raster.width, raster.height);
  return { src, sourceWidth: raster.width, sourceHeight: raster.height, credit: sanitiseAgentCredit(credit) };
}

/** No prompts, instructions, paths or remote URLs become executable document fields. */
export function buildAgentDesign(input, resolvedAssets = {}) {
  const request = validateAgentRequest(input);
  object(resolvedAssets, 'Resolved assets', (request.assets ?? []).map(asset => asset.id));
  for (const imported of Object.values(resolvedAssets)) {
    object(imported, 'Resolved image', ['src', 'sourceWidth', 'sourceHeight', 'credit']);
    if (typeof imported.src !== 'string') fail('Resolved image src must be embedded raster data.');
    sanitiseAgentCredit(imported.credit ?? null);
  }
  return assembleDesign(request, resolvedAssets);
}
function assembleDesign(request, resolvedAssets) {
  // Repeated references embed repeated bytes in the native format. Refuse the
  // aggregate before cloning image strings into hundreds of editable layers.
  let sourceBytes = 0;
  for (const page of request.pages ?? []) for (const layer of page.elements ?? []) {
    if (layer.asset !== undefined && !Object.hasOwn(resolvedAssets, layer.asset)) fail(`Asset ${layer.asset} has not been imported.`);
    const source = layer.asset === undefined ? layer.src : resolvedAssets[layer.asset]?.src;
    if (typeof source === 'string') { sourceBytes += source.length; if (sourceBytes > MAX_DOCUMENT_BYTES) fail('This design is too large. Use a file up to 12 MB.'); }
  }
  let document = request.template ? templateDocument(request.template) : createDocument();
  if (request.title !== undefined) document.title = request.title;
  if (request.brand !== undefined) document.brand = { ...document.brand, ...request.brand };
  if (!request.template) {
    document.pages = (request.pages ?? [{}]).map((inputPage, index) => {
      const preset = PRESETS.find(item => item.key === (inputPage.preset ?? request.preset ?? 'social'));
      const page = createPage(inputPage.width ?? preset.width, inputPage.height ?? preset.height);
      page.name = inputPage.name ?? `Page ${index + 1}`;
      for (const key of ['background', 'transparentBackground', 'backgroundGradient', 'duration']) if (inputPage[key] !== undefined) page[key] = structuredClone(inputPage[key]);
      page.elements = (inputPage.elements ?? []).map(layer => {
        const { asset, ...patch } = layer;
        if (asset !== undefined) {
          if (!Object.hasOwn(resolvedAssets, asset)) fail(`Asset ${asset} has not been imported.`);
          const imported = resolvedAssets[asset];
          object(imported, 'Resolved image', ['src', 'sourceWidth', 'sourceHeight', 'credit']);
          if (patch.src !== undefined || patch.sourceWidth !== undefined || patch.sourceHeight !== undefined) fail('An asset layer cannot also provide src or source dimensions.');
          Object.assign(patch, structuredClone(imported), { credit: sanitiseAgentCredit(imported.credit ?? null) });
          const scale = Math.min(page.width * .8 / imported.sourceWidth, page.height * .8 / imported.sourceHeight, 1);
          patch.width ??= Math.max(1, imported.sourceWidth * scale); patch.height ??= Math.max(1, imported.sourceHeight * scale);
          patch.x ??= (page.width - patch.width) / 2; patch.y ??= (page.height - patch.height) / 2;
        }
        if (patch.credit !== undefined) patch.credit = sanitiseAgentCredit(patch.credit);
        return createElement(layer.type, patch);
      });
      return page;
    });
  }
  return validateDocument(document);
}

/** Picks actual output data, never logs/input/URLs from a provider response. */
export function predictionImageURL(value, outputIndex = 0) {
  if (!Number.isInteger(outputIndex) || outputIndex < 0 || outputIndex > 99) fail('Choose an outputIndex between 0 and 99.');
  function providerObject(value) {
    if (!value || Object.getPrototypeOf(value) !== Object.prototype) fail('Prediction objects must be plain JSON data.');
    const descriptors = Object.getOwnPropertyDescriptors(value);
    if (Reflect.ownKeys(descriptors).some(key => typeof key !== 'string' || !descriptors[key].enumerable || !Object.hasOwn(descriptors[key], 'value'))) fail('Prediction objects must not contain accessors or hidden properties.');
  }
  if (value && typeof value === 'object' && !Array.isArray(value)) providerObject(value);
  if (value && typeof value === 'object' && !Array.isArray(value) && Object.hasOwn(value, 'status') && value.status !== 'succeeded') fail('The prediction is not succeeded. Wait for the generator to finish.');
  const output = value && typeof value === 'object' && !Array.isArray(value) && Object.hasOwn(value, 'output') ? value.output : value;
  const files = Array.isArray(output) ? output : [output];
  list(files, 'Prediction outputs', 100, 1);
  const selected = files[outputIndex];
  if (selected && typeof selected === 'object') providerObject(selected);
  const url = typeof selected === 'string' ? selected : selected && typeof selected === 'object' && Object.hasOwn(selected, 'url') && typeof selected.url === 'string' ? selected.url : null;
  if (!url || url.length > 4000) fail('No image URL exists at that prediction output index. Supply a downloaded image with --image instead.');
  let parsed; try { parsed = new URL(url); } catch { fail('Prediction output must be an HTTPS image URL.'); }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password) fail('Prediction output must be an HTTPS image URL without embedded credentials.');
  return parsed.href;
}
