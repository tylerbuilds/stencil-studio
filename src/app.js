import { FONTS, TEMPLATES, History, createDocument, createPage, createElement, templateDocument, validateDocument, parseDocument, serialiseDocument, editPage, updateElement, removeElement, reorderElement, duplicatePage, pageSVG, escapeXML } from './model.js';
const $ = selector => document.querySelector(selector);
const STORAGE_KEY = 'stencil-studio.document.v1';
let initial, recoveryMessage;
try { const stored = localStorage.getItem(STORAGE_KEY); initial = stored ? parseDocument(stored) : templateDocument('poster'); }
catch { initial = templateDocument('poster'); recoveryMessage = 'Your saved design could not be loaded. A fresh template is open; your stored data has been kept.'; }
const history = new History(initial);
let pageId = initial.pages[0].id, selection = null, zoom = 1, fit = true, drag = null, toastTimer;
const page = () => history.current.pages.find(item => item.id === pageId) ?? history.current.pages[0];
const selected = () => page().elements.find(element => element.id === selection);
const safe = escapeXML;
function toast(message, error = false) { const node = $('#toast'); node.textContent = message; node.classList.toggle('error', error); node.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => { node.hidden = true; }, error ? 6500 : 3500); }
function persist() {
  try { localStorage.setItem(STORAGE_KEY, serialiseDocument(history.current)); $('#save-status').textContent = 'Saved on this device'; return true; }
  catch { $('#save-status').textContent = 'Browser storage full — save JSON'; toast('Your design is open, but browser storage is unavailable or full. Use Save JSON to keep a copy.', true); return false; }
}
function attempt(operation) { try { return operation(); } catch (error) { toast(error.message || 'That change could not be made.', true); return false; } }
function commit(next, options = {}) {
  const changed = history.commit(next); if (!changed) return;
  if (!history.current.pages.some(item => item.id === pageId)) pageId = history.current.pages[0].id;
  if (!selected()) selection = null;
  const saved = persist(); render(options); return saved;
}
function field(label, key, value, options = {}) {
  const { type = 'number', min, max, step = 'any' } = options;
  const attrs = `${min !== undefined ? ` min="${min}"` : ''}${max !== undefined ? ` max="${max}"` : ''}`;
  return `<label class="property-field"><span>${safe(label)}</span><input data-property="${key}" aria-label="${safe(label)}" type="${type}" value="${safe(value)}"${attrs}${type === 'number' ? ` step="${step}"` : ''}></label>`;
}
function colourField(label, key, value) { return `<label class="property-field"><span>${safe(label)}</span><span class="colour-field"><input type="color" data-property="${key}" aria-label="${safe(label)}" value="${safe(value)}"><code>${safe(value.toUpperCase())}</code></span></label>`; }
function selectField(label, key, value, options) { return `<label class="property-field"><span>${safe(label)}</span><select data-property="${key}" aria-label="${safe(label)}">${options.map(([val, text]) => `<option value="${safe(val)}"${String(value) === String(val) ? ' selected' : ''}>${safe(text)}</option>`).join('')}</select></label>`; }
function renderProperties() {
  const element = selected(), p = page();
  $('#inspector-heading').textContent = element ? { text: 'Typography', rect: 'Rectangle', circle: 'Circle', image: 'Image' }[element.type] : 'Artboard';
  let content;
  if (!element) {
    content = field('Page name', 'name', p.name, { type: 'text' }) + '<div class="property-grid">' + field('Canvas width', 'width', p.width, { min: 64, max: 4096 }) + field('Canvas height', 'height', p.height, { min: 64, max: 4096 }) + '</div>' + colourField('Background', 'background', p.background) + '<p class="panel-hint">Click an element to edit it.<br>Drag it to find the right spot.</p>';
  } else {
    content = '<div class="selection-actions"><button id="duplicate-element">Duplicate</button><button id="delete-element" class="danger">Delete</button><button id="deselect">Done</button></div>';
    if (element.type === 'text') content += `<label class="property-field"><span>Text</span><textarea data-property="text" aria-label="Text" maxlength="10000">${safe(element.text)}</textarea></label>` + selectField('Font', 'fontFamily', element.fontFamily, FONTS.map(font => [font, font])) + '<div class="property-grid">' + field('Font size', 'fontSize', element.fontSize, { min: 4, max: 500 }) + selectField('Weight', 'fontWeight', element.fontWeight, [[400, 'Regular'], [700, 'Bold']]) + '</div>' + selectField('Alignment', 'align', element.align, [['left', 'Left'], ['center', 'Centre'], ['right', 'Right']]);
    if (element.type !== 'image') content += colourField('Colour', 'fill', element.fill);
    content += '<div class="property-grid">' + field('X position', 'x', element.x, { min: -8192, max: 8192 }) + field('Y position', 'y', element.y, { min: -8192, max: 8192 }) + field('Width', 'width', element.width, { min: 1, max: 8192 }) + field('Height', 'height', element.height, { min: 1, max: 8192 }) + field('Rotation', 'rotation', element.rotation, { min: -360, max: 360 }) + field('Opacity', 'opacity', element.opacity, { min: 0, max: 1, step: .05 }) + '</div>';
    if (element.type === 'rect') content += field('Corner radius', 'radius', element.radius, { min: 0, max: 4096 });
    if (element.type === 'image') content += '<p class="panel-hint">Image fills its frame; resize the frame to crop. Original image is embedded in your document.</p>';
  }
  $('#properties').innerHTML = content;
  $('#properties').querySelectorAll('[data-property]').forEach(input => input.addEventListener('change', () => {
    try {
      let value = input.value;
      if (input.type === 'number' || input.dataset.property === 'fontWeight') {
        if (value.trim() === '') throw new Error('Enter a number before applying this change.'); value = Number(value);
      }
      const next = element ? updateElement(history.current, p.id, element.id, { [input.dataset.property]: value }) : editPage(history.current, p.id, nextPage => { nextPage[input.dataset.property] = value; });
      // Preserve this form so moving to the next field does not remove its click target.
      commit(next, { keepInspector: true });
      if (input.type === 'color') input.closest('.colour-field').querySelector('code').textContent = value.toUpperCase();
    } catch (error) {
      toast(error.message || 'That change could not be made.', true);
      input.value = (element ? selected() : page())?.[input.dataset.property] ?? '';
    }
  }));
  $('#delete-element')?.addEventListener('click', deleteSelection);
  $('#duplicate-element')?.addEventListener('click', () => attempt(() => { const e = selected(), duplicate = { ...structuredClone(e), id: createElement(e.type).id, x: e.x + 24, y: e.y + 24 }; const next = editPage(history.current, p.id, updated => updated.elements.push(duplicate)); selection = duplicate.id; commit(next); }));
  $('#deselect')?.addEventListener('click', () => { selection = null; render(); });
}
function renderLayers() {
  const elements = page().elements;
  $('#layer-count').textContent = `${elements.length} ${elements.length === 1 ? 'element' : 'elements'}`;
  $('#layers').innerHTML = elements.length ? [...elements].reverse().map((e, displayIndex) => `<div class="layer-row${e.id === selection ? ' selected' : ''}" data-layer-id="${safe(e.id)}"><button class="layer-select" data-select="${safe(e.id)}" aria-label="Select ${safe(layerName(e))}"><span class="layer-symbol${e.type === 'rect' || e.type === 'circle' ? ' shape' : ''}" style="--layer-fill:${e.fill}${e.type === 'circle' ? ';border-radius:50%' : ''}">${e.type === 'text' ? 'T' : e.type === 'image' ? '▧' : ''}</span><span class="layer-name">${safe(layerName(e))}</span></button><div class="layer-actions"><button data-order="1" data-id="${safe(e.id)}" aria-label="Bring ${safe(layerName(e))} forward"${displayIndex === 0 ? ' disabled' : ''}>↑</button><button data-order="-1" data-id="${safe(e.id)}" aria-label="Send ${safe(layerName(e))} backward"${displayIndex === elements.length - 1 ? ' disabled' : ''}>↓</button><button data-delete="${safe(e.id)}" aria-label="Delete ${safe(layerName(e))}">×</button></div></div>`).join('') : '<div class="empty-layers">Your canvas is ready.<br>Add text, a shape or an image.</div>';
  $('#layers').querySelectorAll('[data-select]').forEach(button => button.addEventListener('click', () => { selection = button.dataset.select; render(); }));
  $('#layers').querySelectorAll('[data-order]').forEach(button => button.addEventListener('click', () => attempt(() => commit(reorderElement(history.current, page().id, button.dataset.id, Number(button.dataset.order))))));
  $('#layers').querySelectorAll('[data-delete]').forEach(button => button.addEventListener('click', () => attempt(() => commit(removeElement(history.current, page().id, button.dataset.delete)))));
}
function layerName(element) { return element.type === 'text' ? element.text.replaceAll('\n', ' ').slice(0, 40) || 'Empty text' : element.type === 'rect' ? 'Rectangle' : element.type === 'circle' ? 'Circle' : 'Image'; }
function calculateZoom() {
  const area = $('#canvas-area'), p = page();
  const margin = window.innerWidth <= 700 ? 48 : window.innerWidth <= 1150 ? 48 : 76;
  return Math.max(.05, Math.min(2, (area.clientWidth - margin) / p.width, (area.clientHeight - margin) / p.height));
}
function renderCanvas(previewPage = page()) {
  if (fit) zoom = calculateZoom();
  const e = previewPage.elements.find(element => element.id === selection), handle = Math.max(5, 7 / zoom);
  let selectionSVG = '';
  if (e) {
    selectionSVG = `<g transform="translate(${e.x} ${e.y}) rotate(${e.rotation} ${e.width / 2} ${e.height / 2})"><rect class="selection-outline" width="${e.width}" height="${e.height}"/>${[[0, 0, 'nw'], [e.width, 0, 'ne'], [0, e.height, 'sw'], [e.width, e.height, 'se']].map(([x, y, corner]) => `<rect class="resize-handle" data-resize="${corner}" x="${x - handle / 2}" y="${y - handle / 2}" width="${handle}" height="${handle}"/>`).join('')}</g>`;
  }
  $('#canvas-mount').innerHTML = pageSVG(previewPage, true).replace('</svg>', `${selectionSVG}</svg>`);
  const svg = $('#artboard'); svg.style.width = `${previewPage.width * zoom}px`; svg.style.height = `${previewPage.height * zoom}px`;
  $('#canvas-mount').style.width = `${previewPage.width * zoom}px`; $('#canvas-mount').style.height = `${previewPage.height * zoom}px`;
  $('#canvas-area').style.justifyContent = previewPage.width * zoom > $('#canvas-area').clientWidth - 40 ? 'flex-start' : 'center';
  $('#canvas-area').style.alignItems = previewPage.height * zoom > $('#canvas-area').clientHeight - 40 ? 'flex-start' : 'center';
  $('#zoom-value').textContent = `${Math.round(zoom * 100)}%`;
  svg.addEventListener('pointerdown', startDrag);
}
function render(options = {}) {
  const p = page(); pageId = p.id;
  if (document.activeElement !== $('#document-title')) $('#document-title').value = history.current.title;
  $('#page-name-display').textContent = p.name || 'Untitled page'; $('#canvas-size').textContent = `${Math.round(p.width)} × ${Math.round(p.height)} px`;
  $('#undo').disabled = !history.past.length; $('#redo').disabled = !history.future.length; $('#delete-page').disabled = history.current.pages.length === 1;
  $('#pages').innerHTML = history.current.pages.map((item, index) => `<button class="page-tab" data-page-id="${safe(item.id)}" aria-current="${item.id === pageId}" title="${safe(item.name)}">${index + 1}${history.current.pages.length < 4 ? ` · ${safe(item.name.slice(0, 18))}` : ''}</button>`).join('');
  $('#pages').querySelectorAll('button').forEach(button => button.addEventListener('click', () => { pageId = button.dataset.pageId; selection = null; render(); }));
  renderCanvas(); renderLayers(); if (!options.keepInspector) renderProperties();
}
function svgPoint(event, inverse) { const pt = new DOMPoint(event.clientX, event.clientY); return pt.matrixTransform(inverse); }
function startDrag(event) {
  if (event.button !== 0) return;
  const node = event.target.closest('[data-element-id]'), handle = event.target.closest('[data-resize]');
  if (!node && !handle) { selection = null; render(); return; }
  event.preventDefault();
  $('#canvas-mount').setPointerCapture(event.pointerId);
  if (node) selection = node.dataset.elementId;
  const element = selected(); if (!element) return;
  const inverse = $('#artboard').getScreenCTM().inverse();
  drag = { original: structuredClone(element), start: svgPoint(event, inverse), inverse, corner: handle?.dataset.resize, moved: false, preview: null, pointerId: event.pointerId };
  render();
}
window.addEventListener('pointermove', event => {
  if (!drag || event.pointerId !== drag.pointerId) return;
  const current = svgPoint(event, drag.inverse), dx = current.x - drag.start.x, dy = current.y - drag.start.y;
  if (Math.abs(dx) + Math.abs(dy) < 1 && !drag.moved) return;
  drag.moved = true;
  const e = drag.original; let patch;
  if (!drag.corner) patch = { x: Math.max(-8192, Math.min(8192, Math.round(e.x + dx))), y: Math.max(-8192, Math.min(8192, Math.round(e.y + dy))) };
  else {
    // Resize in element-local axes; the opposite corner stays fixed even for rotated elements.
    const angle = e.rotation * Math.PI / 180, cos = Math.cos(angle), sin = Math.sin(angle);
    const localDx = dx * cos + dy * sin, localDy = -dx * sin + dy * cos;
    const west = drag.corner.includes('w'), north = drag.corner.includes('n');
    const width = Math.max(1, Math.min(8192, e.width + (west ? -localDx : localDx)));
    const height = Math.max(1, Math.min(8192, e.height + (north ? -localDy : localDy)));
    const centerDx = (west ? -1 : 1) * (width - e.width) / 2, centerDy = (north ? -1 : 1) * (height - e.height) / 2;
    patch = { width: Math.round(width), height: Math.round(height), x: Math.round(e.x + e.width / 2 + centerDx * cos - centerDy * sin - width / 2), y: Math.round(e.y + e.height / 2 + centerDx * sin + centerDy * cos - height / 2) };
  }
  try { drag.preview = updateElement(history.current, pageId, e.id, patch); renderCanvas(drag.preview.pages.find(item => item.id === pageId)); } catch { /* Bounds are enforced; keep the last valid preview. */ }
});
function endDrag(event) { if (!drag || event.pointerId !== drag.pointerId) return; const next = drag.preview; drag = null; if (next) commit(next); else render(); }
window.addEventListener('pointerup', endDrag); window.addEventListener('pointercancel', () => { if (drag) { drag = null; render(); } });
function deleteSelection() { if (selection) attempt(() => commit(removeElement(history.current, pageId, selection))); }
function addElement(type, patch = {}) { return attempt(() => { const p = page(), element = createElement(type, { x: Math.round(p.width * .12), y: Math.round(p.height * .15), width: Math.min(type === 'text' ? 420 : 220, p.width * .7), height: Math.min(type === 'text' ? 140 : 220, p.height * .5), ...patch }); const next = editPage(history.current, p.id, updated => updated.elements.push(element)); selection = element.id; return commit(next); }); }
function switchLibrary(tab) { const templates = tab === 'templates'; $('#templates-tab').setAttribute('aria-selected', String(templates)); $('#elements-tab').setAttribute('aria-selected', String(!templates)); $('#templates-panel').hidden = !templates; $('#elements-panel').hidden = templates; }
$('#templates-tab').addEventListener('click', () => switchLibrary('templates')); $('#elements-tab').addEventListener('click', () => switchLibrary('elements'));
$('#templates').innerHTML = TEMPLATES.map(template => `<button class="template-button" data-template="${template.key}"><span class="template-preview">${pageSVG(templateDocument(template.key).pages[0])}</span><strong>${safe(template.name)}</strong><small>${safe(template.category)}</small></button>`).join('');
$('#templates').querySelectorAll('button').forEach(button => button.addEventListener('click', () => attempt(() => { const next = templateDocument(button.dataset.template); pageId = next.pages[0].id; selection = null; fit = true; if (commit(next)) toast('Template opened. Undo brings back your previous design.'); })));
$('#blank-design').addEventListener('click', () => { const next = createDocument(); pageId = next.pages[0].id; selection = null; fit = true; commit(next); switchLibrary('elements'); });
$('#add-text').addEventListener('click', () => addElement('text')); $('#add-rectangle').addEventListener('click', () => addElement('rect')); $('#add-circle').addEventListener('click', () => addElement('circle'));
$('#document-title').addEventListener('change', event => attempt(() => commit({ ...history.current, title: event.target.value }, { keepInspector: true })));
$('#undo').addEventListener('click', () => { if (history.undo()) { persist(); render(); } }); $('#redo').addEventListener('click', () => { if (history.redo()) { persist(); render(); } });
$('#add-page').addEventListener('click', () => attempt(() => { const p = createPage(page().width, page().height); p.name = `Page ${history.current.pages.length + 1}`; const next = validateDocument({ ...history.current, pages: [...history.current.pages, p] }); pageId = p.id; selection = null; commit(next); }));
$('#duplicate-page').addEventListener('click', () => attempt(() => { const next = duplicatePage(history.current, pageId), index = next.pages.findIndex(item => item.id === pageId); pageId = next.pages[index + 1].id; selection = null; commit(next); }));
$('#delete-page').addEventListener('click', () => attempt(() => { if (history.current.pages.length > 1) commit({ ...history.current, pages: history.current.pages.filter(item => item.id !== pageId) }); }));
$('#fit-canvas').addEventListener('click', () => { fit = true; renderCanvas(); }); $('#zoom-in').addEventListener('click', () => { fit = false; zoom = Math.min(3, zoom * 1.2); renderCanvas(); }); $('#zoom-out').addEventListener('click', () => { fit = false; zoom = Math.max(.05, zoom / 1.2); renderCanvas(); });
new ResizeObserver(() => { if (fit) renderCanvas(); }).observe($('#canvas-area'));
window.addEventListener('keydown', event => {
  if (event.target.matches('input,textarea,select,[contenteditable]') || $('#shortcuts-dialog').open) return;
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') { event.preventDefault(); (event.shiftKey ? $('#redo') : $('#undo')).click(); }
  else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'y') { event.preventDefault(); $('#redo').click(); }
  else if (event.key === 'Escape') { selection = null; render(); }
  else if (selection && ['Delete', 'Backspace'].includes(event.key)) { event.preventDefault(); deleteSelection(); }
  else if (selection && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) {
    event.preventDefault(); const e = selected(); if (!e) return; const step = event.shiftKey ? 10 : 1;
    attempt(() => commit(updateElement(history.current, pageId, selection, { x: e.x + (event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0), y: e.y + (event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0) })));
  }
});
$('#upload-image').addEventListener('click', () => $('#image-input').click());
$('#image-input').addEventListener('change', async event => {
  const file = event.target.files?.[0]; event.target.value = ''; if (!file) return;
  if (file.size > 6 * 1024 * 1024 || !['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(file.type)) { toast('Choose a PNG, JPEG, WebP or GIF image smaller than 6 MB.', true); return; }
  try {
    const dataURL = await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = reject; reader.readAsDataURL(file); });
    const image = await new Promise((resolve, reject) => { const img = new Image(); img.onload = () => resolve(img); img.onerror = () => reject(new Error('This image could not be decoded.')); img.src = dataURL; });
    const width = Math.min(page().width * .65, image.naturalWidth), height = width * image.naturalHeight / image.naturalWidth;
    if (!image.naturalWidth || !image.naturalHeight || height > 8192) throw new Error('This image has unsupported dimensions.');
    if (addElement('image', { src: dataURL, width: Math.max(1, Math.round(width)), height: Math.max(1, Math.round(height)) })) toast('Image added from your device.');
  } catch (error) { toast(error.message || 'Could not read this image.', true); }
});
function download(content, type, filename) { const url = URL.createObjectURL(new Blob([content], { type })); const anchor = document.createElement('a'); anchor.href = url; anchor.download = filename; document.body.append(anchor); anchor.click(); anchor.remove(); setTimeout(() => URL.revokeObjectURL(url), 2000); }
const filename = () => (history.current.title || 'stencil-design').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80) || 'stencil-design';
$('#save-document').addEventListener('click', () => attempt(() => { download(serialiseDocument(history.current), 'application/json', `${filename()}.stencil.json`); toast('All pages saved as editable JSON.'); }));
$('#import-document').addEventListener('click', () => $('#document-input').click());
$('#document-input').addEventListener('change', async event => {
  const file = event.target.files?.[0]; event.target.value = ''; if (!file) return;
  try { if (file.size > 12 * 1024 * 1024) throw new Error('The document is too large (12 MB maximum).'); const next = parseDocument(await file.text()); pageId = next.pages[0].id; selection = null; fit = true; if (commit(next)) toast('Design opened. Undo restores your previous design.'); }
  catch (error) { toast(error.message || 'Could not open this document.', true); }
});
$('#export-svg').addEventListener('click', () => attempt(() => { download(pageSVG(page()), 'image/svg+xml', `${filename()}-page-${history.current.pages.findIndex(p => p.id === pageId) + 1}.svg`); toast('Current page downloaded as SVG.'); }));
$('#export-png').addEventListener('click', async () => {
  const button = $('#export-png'); button.disabled = true;
  try {
    const p = structuredClone(page()), svg = pageSVG(p), url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
    let img;
    try { img = await new Promise((resolve, reject) => { const image = new Image(); image.onload = () => resolve(image); image.onerror = () => reject(new Error('This page could not be rendered. Try SVG instead.')); image.src = url; }); } finally { URL.revokeObjectURL(url); }
    const canvas = document.createElement('canvas'); canvas.width = p.width; canvas.height = p.height; const context = canvas.getContext('2d'); if (!context) throw new Error('Your browser could not create an image canvas.'); context.drawImage(img, 0, 0);
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png')); if (!blob) throw new Error('PNG export failed. Try SVG instead.');
    download(blob, 'image/png', `${filename()}-page-${history.current.pages.findIndex(item => item.id === p.id) + 1}.png`); toast('Current page downloaded as PNG at full size.');
  } catch (error) { toast(error.message || 'Could not export PNG. Try SVG instead.', true); } finally { button.disabled = false; }
});
$('#shortcuts').addEventListener('click', () => $('#shortcuts-dialog').showModal()); $('#close-shortcuts').addEventListener('click', () => $('#shortcuts-dialog').close()); $('#shortcuts-dialog').addEventListener('click', event => { if (event.target === $('#shortcuts-dialog')) { const rect = event.target.getBoundingClientRect(); if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) event.target.close(); } });
render(); if (recoveryMessage) toast(recoveryMessage, true);
