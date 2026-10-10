/** The asset library is optional: nothing here is fetched until Assets is opened. */
export const ASSET_PAGE_SIZE = 36;
export const MAX_CATALOGUE_BYTES = 3 * 1024 * 1024;
export const MAX_ASSET_BYTES = 512 * 1024;
const COLLECTIONS = ['tabler', 'fluent', 'doodles'];
const fail = message => { throw new Error(message); };
const plain = value => value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype;
const text = (value, max) => typeof value === 'string' && value.length > 0 && value.length <= max && !/[\u0000-\u001f\u007f]/.test(value);
const identifier = value => typeof value === 'string' && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value) && value.length <= 160;
export const foldSearch = value => String(value).normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
export function validateCatalogue(value) {
  if (!plain(value) || value.version !== 1 || !Array.isArray(value.collections) || value.collections.length !== 3 || !Array.isArray(value.assets) || !value.assets.length || value.assets.length > 10000) fail('This asset library cannot be opened. Try again after updating Stencil.');
  const sources = { tabler: 'https://github.com/tabler/tabler-icons', fluent: 'https://github.com/microsoft/fluentui-emoji', doodles: 'https://www.opendoodles.com' };
  const collectionIds = new Set();
  for (const collection of value.collections) {
    if (!plain(collection) || !COLLECTIONS.includes(collection.id) || collectionIds.has(collection.id) || !text(collection.name, 80) || !['icon', 'sticker', 'illustration'].includes(collection.kind) || collection.license !== (collection.id === 'doodles' ? 'CC0-1.0' : 'MIT') || collection.source !== sources[collection.id] || !text(collection.revision, 100) || !/^assets\/licenses\/[a-zA-Z0-9-]+\.txt$/.test(collection.noticePath) || !/^[a-f0-9]{64}$/.test(collection.noticeSha256) || !Number.isInteger(collection.noticeBytes) || collection.noticeBytes < 1 || collection.noticeBytes > 16384) fail('This asset collection is damaged. Try again after updating Stencil.');
    collectionIds.add(collection.id);
  }
  const ids = new Set(), paths = new Set();
  for (const asset of value.assets) {
    if (!plain(asset) || !identifier(asset.id) || !asset.id.startsWith(`${asset.collection}-`) || ids.has(asset.id) || !collectionIds.has(asset.collection) || !text(asset.name, 120) || !text(asset.category, 80) || !Array.isArray(asset.tags) || asset.tags.length > 40 || asset.tags.some(tag => !text(tag, 80)) || !new RegExp(`^assets/svg/${asset.collection}/[a-z0-9]+(?:-[a-z0-9]+)*\\.svg$`).test(asset.path) || paths.has(asset.path) || !/^[a-f0-9]{64}$/.test(asset.sha256) || !Number.isInteger(asset.bytes) || asset.bytes < 1 || asset.bytes > MAX_ASSET_BYTES) fail('This asset library has an invalid item. Try again after updating Stencil.');
    ids.add(asset.id); paths.add(asset.path);
  }
  return value;
}
export function searchAssets(catalogue, { query = '', collection = '', category = '', page = 0 } = {}) {
  const terms = foldSearch(String(query).slice(0, 120)).split(' ').filter(Boolean).slice(0, 12);
  const filtered = catalogue.assets.filter(asset => (!collection || asset.collection === collection) && (!category || asset.category === category) && terms.every(term => foldSearch(`${asset.name} ${asset.category} ${asset.tags.join(' ')}`).includes(term)));
  if (terms.length) filtered.sort((a, b) => {
    const q = terms.join(' '), score = asset => foldSearch(asset.name) === q ? 0 : foldSearch(asset.name).startsWith(q) ? 1 : 2;
    return score(a) - score(b);
  });
  const pages = Math.max(1, Math.ceil(filtered.length / ASSET_PAGE_SIZE));
  const current = Math.min(pages - 1, Math.max(0, Number.isInteger(page) ? page : 0));
  return { assets: filtered.slice(current * ASSET_PAGE_SIZE, (current + 1) * ASSET_PAGE_SIZE), total: filtered.length, page: current, pages };
}
export function assetURL(path, moduleURL = import.meta.url) {
  if (!/^assets\/(?:svg\/(?:tabler|fluent|doodles)\/[a-z0-9]+(?:-[a-z0-9]+)*\.svg|licenses\/[a-zA-Z0-9-]+\.txt)$/.test(path)) fail('This asset address is invalid.');
  return new URL(`../public/${path}`, moduleURL).href;
}
export async function readLimitedBytes(response, max, signal) {
  if (!response.ok || response.redirected) fail('The asset library could not load. Check your connection and try again.');
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > max) fail('This asset file is too large to open.');
  if (!response.body?.getReader) { const bytes = new Uint8Array(await response.arrayBuffer()); if (bytes.length > max) fail('This asset file is too large to open.'); return bytes; }
  const reader = response.body.getReader(), chunks = []; let length = 0;
  try {
    while (true) {
      signal?.throwIfAborted(); const { done, value } = await reader.read(); if (done) break;
      length += value.length; if (length > max) fail('This asset file is too large to open.'); chunks.push(value);
    }
  } catch (error) { await reader.cancel().catch(() => {}); throw error; } finally { reader.releaseLock(); }
  signal?.throwIfAborted(); const result = new Uint8Array(length); let offset = 0; for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.length; } return result;
}
export async function fetchCatalogue({ signal } = {}) {
  const response = await fetch(new URL('../public/assets/catalogue.json', import.meta.url), { credentials: 'omit', redirect: 'error', signal });
  const bytes = await readLimitedBytes(response, MAX_CATALOGUE_BYTES, signal);
  let value; try { value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); } catch { fail('This asset library is damaged. Try again after updating Stencil.'); }
  return validateCatalogue(value);
}
