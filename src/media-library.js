import { foldSearch, readLimitedBytes } from './asset-catalogue.js';
import { identifyRaster } from './browser-intake.js';

export const MEDIA_PAGE_SIZE = 16;
export const MAX_MEDIA_CATALOGUE_BYTES = 256 * 1024;
export const MAX_MEDIA_BYTES = 256 * 1024;
export const MAX_MEDIA_TOTAL_BYTES = 2 * 1024 * 1024;
const CATEGORIES = ['Nature', 'Botanical', 'Food & drink', 'Everyday', 'Sky & space'];
const fail = message => { throw new Error(message); };
const plain = value => value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype;
const text = (value, max) => typeof value === 'string' && value.trim().length > 0 && value.length <= max && !/[<>\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/.test(value);
const slug = value => typeof value === 'string' && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value) && value.length <= 80;
const fields = ['id', 'name', 'category', 'kind', 'tags', 'path', 'type', 'width', 'height', 'bytes', 'sha256', 'licence', 'licenceURL', 'author', 'source', 'revision'];

export function validateMediaCatalogue(value) {
  if (!plain(value) || Object.keys(value).some(key => !['version', 'assets'].includes(key)) || value.version !== 1 || !Array.isArray(value.assets) || !value.assets.length || value.assets.length > 64) fail('This photo library cannot be opened. Update Stencil and try again.');
  const ids = new Set(), paths = new Set(); let total = 0;
  for (const asset of value.assets) {
    if (!plain(asset) || Object.keys(asset).length !== fields.length || Object.keys(asset).some(key => !fields.includes(key)) || !slug(asset.id) || ids.has(asset.id) || !text(asset.name, 100) || !CATEGORIES.includes(asset.category) || !['photo', 'background'].includes(asset.kind) || !Array.isArray(asset.tags) || asset.tags.length > 20 || asset.tags.some(tag => !text(tag, 40)) || !new RegExp(`^assets/${asset.kind === 'photo' ? 'photos' : 'backgrounds'}/${asset.id}\\.webp$`).test(asset.path) || paths.has(asset.path) || asset.type !== 'image/webp' || !Number.isInteger(asset.width) || !Number.isInteger(asset.height) || asset.width < 1 || asset.height < 1 || asset.width > 1280 || asset.height > 1280 || !Number.isInteger(asset.bytes) || asset.bytes < 30 || asset.bytes > MAX_MEDIA_BYTES || !/^[a-f0-9]{64}$/.test(asset.sha256) || asset.licence !== 'CC0-1.0' || asset.licenceURL !== 'https://creativecommons.org/publicdomain/zero/1.0/' || !text(asset.author, 200) || !/^https:\/\/commons\.wikimedia\.org\/wiki\/File:[A-Za-z0-9_%().-]+$/.test(asset.source) || !Number.isSafeInteger(asset.revision) || asset.revision < 1) fail('This photo library has a damaged item. Update Stencil and try again.');
    total += asset.bytes; ids.add(asset.id); paths.add(asset.path);
  }
  if (total > MAX_MEDIA_TOTAL_BYTES) fail('This photo library is too large to open.');
  return value;
}

export function mediaURL(path, moduleURL = import.meta.url) {
  if (!/^assets\/(?:photos|backgrounds)\/[a-z0-9]+(?:-[a-z0-9]+)*\.webp$/.test(path)) fail('This photo address is invalid.');
  return new URL(`../public/${path}`, moduleURL).href;
}

export function searchMedia(catalogue, { query = '', category = '', kind = '', page = 0 } = {}) {
  const terms = foldSearch(String(query).slice(0, 120)).split(' ').filter(Boolean).slice(0, 12);
  const matches = catalogue.assets.filter(asset => (!category || asset.category === category) && (!kind || asset.kind === kind) && terms.every(term => foldSearch(`${asset.name} ${asset.category} ${asset.tags.join(' ')}`).includes(term)));
  const pages = Math.max(1, Math.ceil(matches.length / MEDIA_PAGE_SIZE)), current = Math.min(pages - 1, Math.max(0, Number.isInteger(page) ? page : 0));
  return { assets: matches.slice(current * MEDIA_PAGE_SIZE, (current + 1) * MEDIA_PAGE_SIZE), total: matches.length, pages, page: current };
}

async function bounded(signal, operation) {
  const controller = new AbortController(), abort = () => controller.abort(signal.reason), timer = setTimeout(() => controller.abort(), 15000);
  signal?.addEventListener('abort', abort, { once: true });
  try { signal?.throwIfAborted(); return await operation(controller.signal); }
  finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); }
}

export async function fetchMediaCatalogue({ signal, fetchImpl = globalThis.fetch } = {}) {
  return bounded(signal, async requestSignal => {
    const response = await fetchImpl(new URL('../public/assets/media-catalogue.json', import.meta.url), { credentials: 'omit', redirect: 'error', signal: requestSignal });
    const bytes = await readLimitedBytes(response, MAX_MEDIA_CATALOGUE_BYTES, requestSignal);
    let value; try { value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); } catch { fail('This photo library is damaged. Update Stencil and try again.'); }
    return validateMediaCatalogue(value);
  });
}

export async function fetchMediaAsset(asset, { signal, fetchImpl = globalThis.fetch } = {}) {
  validateMediaCatalogue({ version: 1, assets: [asset] });
  return bounded(signal, async requestSignal => {
    const response = await fetchImpl(mediaURL(asset.path), { credentials: 'omit', redirect: 'error', signal: requestSignal });
    const bytes = await readLimitedBytes(response, Math.min(MAX_MEDIA_BYTES, asset.bytes), requestSignal);
    if (bytes.length !== asset.bytes) fail('This photo file is incomplete. Update Stencil and try again.');
    const dimensions = identifyRaster(bytes);
    if (dimensions.type !== asset.type || dimensions.width !== asset.width || dimensions.height !== asset.height) fail('This photo does not match the bundled version.');
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
    if (Array.from(digest, byte => byte.toString(16).padStart(2, '0')).join('') !== asset.sha256) fail('This photo does not match the bundled version.');
    requestSignal.throwIfAborted(); let binary = '';
    for (let start = 0; start < bytes.length; start += 8192) binary += String.fromCharCode(...bytes.subarray(start, start + 8192));
    return { ...asset, src: `data:${asset.type};base64,${btoa(binary)}`, license: asset.licence };
  });
}

/** Call when the consumer opens Photos. No upstream or account service is used. */
export function initMediaLibrary(container, { onInsert, onBeforeInsert } = {}) {
  if (!container?.ownerDocument || typeof onInsert !== 'function') fail('The photo library needs a place to open and an insert action.');
  if (onBeforeInsert !== undefined && typeof onBeforeInsert !== 'function') fail('The photo library needs a valid target capture action.');
  const owner = container.ownerDocument, make = (tag, className, content) => { const element = owner.createElement(tag); if (className) element.className = className; if (content !== undefined) element.textContent = content; return element; };
  const panel = make('section', 'media-library'), heading = make('h3', '', 'Photos & backgrounds'), controls = make('div', 'media-controls'), searchLabel = make('label', '', 'Search photos'), search = make('input'), categoryLabel = make('label', '', 'Subject'), category = make('select'), grid = make('div', 'media-grid'), status = make('p', 'media-status'), pager = make('div', 'media-pager'), previous = make('button', '', 'Previous'), next = make('button', '', 'Next'), position = make('span'), retry = make('button', 'quiet-button', 'Try again');
  search.type = 'search'; search.maxLength = 120; search.placeholder = 'Flowers, coffee, night sky…'; searchLabel.append(search); categoryLabel.append(category);
  for (const [value, label] of [['', 'All subjects'], ...CATEGORIES.map(name => [name, name])]) { const option = make('option', '', label); option.value = value; category.append(option); }
  status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite'); position.setAttribute('aria-live', 'polite');
  for (const button of [previous, next, retry]) button.type = 'button'; retry.hidden = true;
  controls.append(searchLabel, categoryLabel); pager.append(previous, position, next); panel.append(heading, controls, grid, status, pager, retry); container.replaceChildren(panel);
  let catalogue, loading, page = 0, busy = false, destroyed = false, generation = 0, activeController;
  const feedback = (message, error = false) => { status.textContent = message; status.classList.toggle('error', error); };
  function render() {
    if (!catalogue || destroyed) return;
    const result = searchMedia(catalogue, { query: search.value, category: category.value, page }); page = result.page; grid.replaceChildren();
    for (const asset of result.assets) {
      const card = make('div', 'media-card'), button = make('button', 'media-add'), image = make('img'), caption = make('span', 'media-name', asset.name), credit = make('a', 'media-credit', 'CC0 · Source');
      button.type = 'button'; button.disabled = busy; button.setAttribute('aria-label', `Add ${asset.name}`); image.src = mediaURL(asset.path); image.alt = ''; image.width = asset.width; image.height = asset.height; image.loading = 'lazy'; image.decoding = 'async';
      image.addEventListener('error', () => { image.hidden = true; button.disabled = true; caption.textContent = `${asset.name} unavailable`; });
      credit.href = asset.source; credit.target = '_blank'; credit.rel = 'noopener noreferrer'; credit.title = `${asset.author} · Public domain`; credit.setAttribute('aria-label', `Photo source and licence for ${asset.name}`);
      button.append(image, caption); card.append(button, credit); grid.append(card);
      button.addEventListener('click', async () => {
        if (busy || destroyed) return; busy = true; const token = ++generation; activeController = new AbortController();
        for (const item of grid.querySelectorAll('.media-add')) item.disabled = true; button.setAttribute('aria-busy', 'true'); feedback(`Adding ${asset.name}…`);
        try { const context = onBeforeInsert?.(asset); const item = await fetchMediaAsset(asset, { signal: activeController.signal }); if (destroyed || token !== generation) return; const added = await (onBeforeInsert ? onInsert(item, context) : onInsert(item)); if (!destroyed && token === generation) feedback(added === false ? 'Nothing was added. Try another photo.' : `${asset.name} added.`); }
        catch (error) { if (!destroyed && token === generation) feedback(error.name === 'AbortError' ? 'Adding the photo took too long. Try again.' : error.message || 'This photo could not be added. Try again.', true); }
        finally { if (token === generation) { busy = false; activeController = null; button.removeAttribute('aria-busy'); for (const item of grid.querySelectorAll('.media-add')) if (!item.querySelector('img')?.hidden) item.disabled = false; } }
      });
    }
    feedback(result.total ? `${result.total} ${result.total === 1 ? 'photo' : 'photos'} · Click one to add it.` : 'No photos found. Try another word.');
    if (!result.total) grid.append(make('p', 'media-empty', 'Try “flowers”, “coffee” or “sky”.'));
    previous.disabled = page === 0; next.disabled = page + 1 >= result.pages; position.textContent = `${page + 1} / ${result.pages}`;
  }
  async function open() {
    if (catalogue || destroyed) return; if (loading) return loading;
    feedback('Opening photos…'); retry.hidden = true; panel.setAttribute('aria-busy', 'true'); activeController = new AbortController();
    loading = (async () => {
      try { const value = await fetchMediaCatalogue({ signal: activeController.signal }); if (!destroyed) { catalogue = value; render(); } }
      catch (error) { if (!destroyed) { feedback(error.name === 'AbortError' ? 'Photos took too long to load. Try again.' : error.message || 'Photos could not load. Try again.', true); retry.hidden = false; } }
      finally { loading = null; activeController = null; panel.removeAttribute('aria-busy'); }
    })(); return loading;
  }
  search.addEventListener('input', () => { page = 0; render(); }); category.addEventListener('change', () => { page = 0; render(); }); retry.addEventListener('click', open);
  previous.addEventListener('click', () => { page--; render(); }); next.addEventListener('click', () => { page++; render(); });
  void open();
  return { open, destroy() { destroyed = true; generation++; activeController?.abort(); container.replaceChildren(); } };
}
