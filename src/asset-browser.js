import { fetchCatalogue, searchAssets, assetURL } from './asset-catalogue.js';

const make = (tag, className, text) => { const node = document.createElement(tag); if (className) node.className = className; if (text !== undefined) node.textContent = text; return node; };
export function createAssetBrowser({ insert, credits }) {
  const panel = document.querySelector('#assets-panel'), status = panel.querySelector('#asset-status'), grid = panel.querySelector('#asset-grid'), query = panel.querySelector('#asset-search'), collection = panel.querySelector('#asset-collection'), category = panel.querySelector('#asset-category'), previous = panel.querySelector('#asset-previous'), next = panel.querySelector('#asset-next'), position = panel.querySelector('#asset-page'), retry = panel.querySelector('#asset-retry'), colour = panel.querySelector('#asset-colour');
  let catalogue = null, loading = null, currentPage = 0, insertion = 0;
  function feedback(message, error = false) { status.textContent = message; status.classList.toggle('error', error); }
  function categories() {
    const names = [...new Set(catalogue.assets.filter(asset => !collection.value || asset.collection === collection.value).map(asset => asset.category))].sort((a, b) => a.localeCompare(b));
    category.replaceChildren(new Option('All subjects', ''), ...names.map(name => new Option(name, name)));
    panel.querySelector('#asset-colour-field').hidden = Boolean(collection.value && collection.value !== 'tabler');
  }
  function render() {
    if (!catalogue) return;
    const result = searchAssets(catalogue, { query: query.value, collection: collection.value, category: category.value, page: currentPage }); currentPage = result.page;
    grid.replaceChildren(); grid.classList.toggle('illustrations', collection.value === 'doodles');
    for (const asset of result.assets) {
      const source = catalogue.collections.find(item => item.id === asset.collection), button = make('button', 'asset-card');
      button.type = 'button'; button.dataset.assetId = asset.id; button.setAttribute('aria-label', `Add ${asset.name} · ${source.kind === 'icon' ? 'icon' : source.kind === 'sticker' ? 'sticker' : 'illustration'}`); button.title = `${asset.name} · ${source.name}`;
      const preview = make('span', `asset-preview ${source.kind}`), image = make('img'); image.src = assetURL(asset.path); image.alt = ''; image.loading = 'lazy'; image.decoding = 'async'; image.width = 80; image.height = 80;
      image.addEventListener('error', () => { preview.classList.add('unavailable'); image.hidden = true; preview.textContent = 'Unavailable'; });
      preview.append(image); button.append(preview, make('span', 'asset-name', asset.name));
      button.addEventListener('click', async () => {
        const generation = ++insertion; button.setAttribute('aria-busy', 'true'); feedback(`Adding ${asset.name}…`);
        try { const added = await insert(asset, source, colour.value); if (generation === insertion) feedback(added ? `${asset.name} added. Move, resize or turn it in the canvas.` : 'Nothing was added. Choose an asset to try again.'); }
        catch (error) { if (generation === insertion) feedback(error.message || 'This asset could not be added. Try again.', true); }
        finally { button.removeAttribute('aria-busy'); }
      });
      grid.append(button);
    }
    const total = result.total.toLocaleString('en-GB');
    feedback(result.total ? `${total} ${result.total === 1 ? 'asset' : 'assets'}${query.value ? ' found' : ' to choose from'}. Click one to add it.` : 'No matches yet. Try another word or choose All subjects.');
    if (!result.total) grid.append(make('p', 'asset-empty', 'Try “flower”, “party”, “coffee” or “heart”.'));
    previous.disabled = result.page === 0; next.disabled = result.page + 1 >= result.pages; position.textContent = `${result.page + 1} / ${result.pages}`;
  }
  async function open() {
    if (catalogue) return;
    if (loading) return loading;
    feedback('Opening the asset library…'); retry.hidden = true; panel.setAttribute('aria-busy', 'true');
    loading = (async () => {
      const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 20000);
      try { catalogue = await fetchCatalogue({ signal: controller.signal }); categories(); render(); }
      catch (error) { feedback(error.name === 'AbortError' ? 'The asset library took too long to load. Check your connection and try again.' : error.message || 'The asset library could not load. Check your connection and try again.', true); retry.hidden = false; }
      finally { clearTimeout(timer); loading = null; panel.removeAttribute('aria-busy'); }
    })();
    return loading;
  }
  let searchTimer;
  query.addEventListener('input', () => { clearTimeout(searchTimer); searchTimer = setTimeout(() => { currentPage = 0; render(); }, 100); });
  collection.addEventListener('change', () => { currentPage = 0; if (catalogue) categories(); render(); });
  category.addEventListener('change', () => { currentPage = 0; render(); });
  for (const [button, step] of [[previous, -1], [next, 1]]) button.addEventListener('click', () => { currentPage += step; render(); grid.scrollIntoView({ block: 'nearest' }); });
  retry.addEventListener('click', open);
  panel.querySelector('#asset-credits').addEventListener('click', () => {
    const dialog = document.querySelector('#asset-credits-dialog'), content = dialog.querySelector('#asset-credits-content'); content.replaceChildren();
    if (catalogue) for (const source of catalogue.collections) {
      const section = make('section', 'asset-credit-source'), title = make('h3', '', source.name), link = make('a', '', `Read ${source.license} licence`); link.href = assetURL(source.noticePath); link.target = '_blank'; link.rel = 'noopener noreferrer';
      const upstream = make('a', '', 'Source'); upstream.href = source.source; upstream.target = '_blank'; upstream.rel = 'noopener noreferrer';
      section.append(title, make('p', '', source.id === 'doodles' ? 'Public domain illustrations by Pablo Stanley.' : source.id === 'fluent' ? 'Colour stickers by Microsoft, shared under the MIT licence.' : 'Icons by the Tabler contributors, shared under the MIT licence.'), link, document.createTextNode(' · '), upstream); content.append(section);
    }
    dialog.showModal();
  });
  panel.querySelector('#download-asset-credits').addEventListener('click', credits);
  return { open };
}
