import { FONTS, TEMPLATES, PRESETS, SHAPE_KINDS, MAX_STROKE_POINTS, History, id, createDocument, createBlankDesign, createBrushStroke, createPage, createElement, templateDocument, validateDocument, parseDocument, serialiseDocument, editPage, updateElement, updateElements, removeElement, removeElements, reorderElement, positionLayers, duplicatePage, duplicateElements, groupElements, ungroupElements, alignElements, distributeElements, copyElements, pasteElements, pageSVG, escapeXML, reorderPage, addPageGuide, updatePageGuide, removePageGuide, setPageGuideSettings, resizePageDocument, snapMovement } from './model.js';
import { LIBRARY_KEY, withLibraryLock, listDesigns, listDesignSummaries, saveDesign, loadDesign, renameDesign, duplicateDesign, deleteDesign, exportLibrary, importLibrary } from './library.js';
import { parseCSV, bulkCreate } from './bulk.js';
import { parseDataCSV, serialiseDataCSV } from './data-csv.js';
import { TABLE_FIELDS, CHART_FIELDS } from './data-elements.js';
import { buildPDF } from './export.js';
import { getAiStatus, generateWriting } from './ai-client.js';
import { needsMigration, preserveMigrationSource, writeWithMigrationBackup } from './migration-storage.js';
import { CLIPBOARD_MIME, CLIPBOARD_PREFIX, encodeSelection, encodeSelectionText, isSelectionText, pasteSelection, insertElements } from './transfer.js';
import { prepareFiles, textElement } from './browser-intake.js';
import { collectAssetNotices, assetCredits, appendExportNotices } from './asset-notices.js';
const $ = selector => document.querySelector(selector);
const STORAGE_KEY = 'stencil-studio.document.v1'; // Retained so earlier installations migrate in place.
let initial, recoveryMessage, recoveryRaw = null, recoveryPreserved = true, storageHealthy = true, storedRaw = null;
try {
  storedRaw = localStorage.getItem(STORAGE_KEY); initial = storedRaw !== null ? parseDocument(storedRaw) : createBlankDesign();
  if (storedRaw !== null && needsMigration(storedRaw)) {
    recoveryRaw = storedRaw;
    try { preserveMigrationSource(localStorage, STORAGE_KEY, storedRaw); recoveryMessage = 'Your earlier design is open. We kept a backup of the original before updating it.'; }
    catch { recoveryPreserved = false; recoveryMessage = 'Your earlier design is open, but its backup could not be saved. Autosave is paused to keep the original. Choose File → Save JSON to keep your new work.'; }
  }
}
catch {
  initial = createBlankDesign(); recoveryRaw = storedRaw; recoveryPreserved = false;
  if (typeof storedRaw === 'string') {
    try {
      let hash = 2166136261; for (let index = 0; index < storedRaw.length; index++) hash = Math.imul(hash ^ storedRaw.charCodeAt(index), 16777619);
      let key = `${STORAGE_KEY}.recovery.${(hash >>> 0).toString(16)}`;
      const previous = localStorage.getItem(key); if (previous !== null && previous !== storedRaw) key += `.${id()}`;
      localStorage.setItem(key, storedRaw); recoveryPreserved = true;
    } catch { /* Preserve the original active key when a durable recovery copy cannot be written. */ }
  }
  recoveryMessage = recoveryPreserved ? 'Your previous design could not open. We kept its original data and opened a blank canvas. Choose Recovery data in File to download the original.' : 'Your previous design could not open. Its original data is still kept, so autosave is paused. Choose File → Save JSON to keep your new work.';
}
const history = new History(initial);
const pristineDocument = storedRaw === null && recoveryPreserved ? serialiseDocument(initial) : null;
let drawMode = false, brushColour = '#232a27', brushWidth = 6, layerDrag = null;
let pageId = initial.pages[0].id, selection = new Set(), libraryId = null, zoom = 1, fit = true, drag = null, snap = true, toastTimer, presentationIndex = 0, dataTool = 'table', dataDraft = null, dataTarget = null, dataCSVDirty = false, dataCSVBaseline = null, guideTarget = null, aiController = null, aiGeneration = 0, aiTarget = null, aiEnabled = false, backgroundTarget = null, backgroundResult = null, videoController = null, videoURL = null, videoCreditsURL = null, videoPreview = null, videoPreviewController = null, videoPreviewGeneration = 0, videoSessionGeneration = 0, cloudSession = null, cloudClient = null, cloudStop = null, cloudBaseline = null, cloudPending = null, cloudGeneration = 0;
let intakeGeneration = 0, intakeActive = null, documentRevision = 0, fileDragDepth = 0;
let expectedDocumentRaw = storedRaw, designNameTarget = null;
const ACTIVE_DESIGN_KEY = 'stencil-studio.active-design.v1';
const savedBindings = new Map(), historyBindings = new WeakMap();
// Detect an ordinary shared-autosave change before restoring a per-tab association.
// The fingerprint is not a credential or a tamper-proof security check.
function draftFingerprint(raw) {
  let first = 2166136261, second = 5381;
  for (let index = 0; index < raw.length; index++) { const code = raw.charCodeAt(index); first = Math.imul(first ^ code, 16777619); second = Math.imul(second, 33) ^ code; }
  return `${raw.length}:${(first >>> 0).toString(16)}:${(second >>> 0).toString(16)}`;
}
function rememberSaved(record) {
  savedBindings.set(record.id, { updatedAt: record.updatedAt, baseline: serialiseDocument(record.document) });
  libraryId = record.id; historyBindings.set(history.current, libraryId); keepActiveBinding();
}
function keepActiveBinding() {
  try { if (storageHealthy && recoveryPreserved && libraryId && savedBindings.has(libraryId)) sessionStorage.setItem(ACTIVE_DESIGN_KEY, JSON.stringify({ id: libraryId, updatedAt: savedBindings.get(libraryId).updatedAt, draft: draftFingerprint(serialiseDocument(history.current)) })); else sessionStorage.removeItem(ACTIVE_DESIGN_KEY); }
  catch { /* Saving a named design still works when per-tab storage is unavailable. */ }
}
try {
  const raw = sessionStorage.getItem(ACTIVE_DESIGN_KEY);
  if (raw && raw.length <= 300) {
    const binding = JSON.parse(raw);
    if (recoveryPreserved && storedRaw !== null && binding && Object.keys(binding).length === 3 && binding.draft === draftFingerprint(serialiseDocument(initial)) && typeof binding.id === 'string' && /^[\w-]{1,100}$/.test(binding.id) && typeof binding.updatedAt === 'string') {
      const record = listDesigns().find(item => item.id === binding.id && item.updatedAt === binding.updatedAt);
      if (record) { libraryId = record.id; savedBindings.set(record.id, { updatedAt: record.updatedAt, baseline: serialiseDocument(loadDesign(record.id)) }); }
    }
  }
} catch { /* Keep the open draft when a stale or invalid saved binding cannot be restored. */ }
historyBindings.set(history.current, libraryId); keepActiveBinding();
const page = () => history.current.pages.find(item => item.id === pageId) ?? history.current.pages[0];
const selectedElements = () => page().elements.filter(element => selection.has(element.id));
const selected = () => selectedElements().at(-1);
const safe = escapeXML;
const selectionIds = () => [...selection];
const effectivelyLocked = e => e.locked || Boolean(e.groupId && page().elements.some(member => member.groupId === e.groupId && member.locked));
function toast(message, error = false) { const node = $('#toast'); node.textContent = message; node.classList.toggle('error', error); node.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => { node.hidden = true; }, error ? 6500 : 3500); }
function persist() {
  if (!recoveryPreserved) { storageHealthy = false; $('#save-status').textContent = 'Autosave paused. Save JSON'; toast('Autosave is paused to keep your earlier design. Choose File → Save JSON to keep your new work.', true); return false; }
  try { const payload = serialiseDocument(history.current); writeWithMigrationBackup(localStorage, STORAGE_KEY, payload, 'document', { expectedRaw: expectedDocumentRaw }); expectedDocumentRaw = payload; $('#save-status').textContent = 'Saved on this device'; storageHealthy = true; keepActiveBinding(); return true; }
  catch (error) { storageHealthy = false; keepActiveBinding(); $('#save-status').textContent = 'Not saved. Save JSON'; toast(error?.name === 'StorageConflictError' || error?.code === 'storage-conflict' ? 'Another tab saved a newer draft. Your edits are still here. Save a named copy or download JSON before refreshing.' : 'Your browser could not save this design. Keep it open and choose File → Save JSON to download a copy.', true); return false; }
}
function attempt(operation) { try { return operation(); } catch (error) { toast(error.message || 'That change didn’t work. Try again.', true); return false; } }
function commit(next, options = {}) {
  if (cloudSession?.role === 'view' && !options.fromCloud) throw new Error('You have view-only access. Keep a local copy and disconnect to make your own edits.');
  if (!history.commit(next)) return false;
  historyBindings.set(history.current, libraryId);
  documentRevision++; cancelIntake('The design changed, so insertion was cancelled. Choose your files or paste again.');
  drag = null; // A new accepted edit invalidates any preview based on the earlier document.
  if (!history.current.pages.some(item => item.id === pageId)) pageId = history.current.pages[0].id;
  selection = new Set([...selection].filter(elementId => page().elements.some(e => e.id === elementId)));
  const saved = persist(); render(options); return saved;
}
function closePageTools() {
  guideTarget = null; dataDraft = null; dataTarget = null; dataCSVDirty = false; dataCSVBaseline = null;
  for (const selector of ['#guides-dialog', '#table-dialog']) if ($(selector).open) $(selector).close();
}
function requireGuideTarget(target = guideTarget) {
  if (!target || target !== guideTarget || target.pageId !== pageId || !$('#guides-dialog').open) throw new Error('The design changed. Open Guides & rulers again to make this change.');
}
function openDocument(next, savedId = null) {
  const valid = validateDocument(next); setDrawMode(false); cancelIntake('Insertion cancelled. You opened another design.'); closePageTools(); drag = null; cloudGeneration++; if (cloudSession) { cloudStop?.(); cloudStop = null; cloudSession = null; cloudBaseline = null; cloudPending = null; window.history.replaceState(null, '', location.pathname + location.search); } pageId = valid.pages[0].id; selection.clear(); libraryId = savedId; fit = true;
  const unchanged = JSON.stringify(valid) === JSON.stringify(history.current), saved = commit(valid); historyBindings.set(history.current, libraryId); keepActiveBinding(); if (!saved) render(); return unchanged ? storageHealthy : saved;
}
function field(label, key, value, options = {}) {
  const { type = 'number', min, max, step = 'any', maxlength } = options;
  const attrs = `${min !== undefined ? ` min="${min}"` : ''}${max !== undefined ? ` max="${max}"` : ''}${maxlength ? ` maxlength="${maxlength}"` : ''}`;
  return `<label class="property-field"><span>${safe(label)}</span><input data-property="${key}" aria-label="${safe(label)}" type="${type}" value="${safe(value)}"${attrs}${type === 'number' ? ` step="${step}"` : ''}></label>`;
}
function colourField(label, key, value) { return `<label class="property-field"><span>${safe(label)}</span><span class="colour-field"><input type="color" data-property="${key}" aria-label="${safe(label)}" value="${safe(value)}"><code>${safe(value.toUpperCase())}</code></span></label>`; }
function selectField(label, key, value, options) { return `<label class="property-field"><span>${safe(label)}</span><select data-property="${key}" aria-label="${safe(label)}">${options.map(([val, text]) => `<option value="${safe(val)}"${String(value) === String(val) ? ' selected' : ''}>${safe(text)}</option>`).join('')}</select></label>`; }
function checkbox(label, key, value) { return `<label class="checkbox-field"><input type="checkbox" data-property="${key}"${value ? ' checked' : ''}>${safe(label)}</label>`; }
function bounds(elements) { const left = Math.min(...elements.map(e => e.x)), top = Math.min(...elements.map(e => e.y)); return { x: left, y: top, width: Math.max(...elements.map(e => e.x + e.width)) - left, height: Math.max(...elements.map(e => e.y + e.height)) - top }; }
function renderProperties() {
  const elements = selectedElements(), element = elements.length === 1 ? elements[0] : null, p = page();
  $('#inspector-heading').textContent = elements.length > 1 ? `${elements.length} selected` : element ? { text: 'Text', rect: 'Rectangle', circle: 'Circle', image: 'Image', table: 'Table', chart: 'Chart', shape: layerName(element), freehand: 'Brush stroke' }[element.type] : 'Artboard';
  let content = '';
  if (!elements.length) {
    content = field('Page name', 'name', p.name, { type: 'text', maxlength: 100 }) + selectField('Canvas preset', 'preset', '', [['', 'Choose a size'], ...PRESETS.map(preset => [preset.key, `${preset.name} · ${preset.width} × ${preset.height}`])]) + '<label class="checkbox-field"><input id="scale-layout" type="checkbox" checked>Scale the layout when resizing</label><div class="property-grid">' + field('Canvas width', 'width', p.width, { min: 64, max: 4096 }) + field('Canvas height', 'height', p.height, { min: 64, max: 4096 }) + '</div>' + colourField('Background', 'background', p.background) + checkbox('Transparent background', 'transparentBackground', p.transparentBackground) + '<p class="panel-hint">Shift-click to select several layers. Drag empty space to select an area. Alt-click edits inside a group.</p>';
  } else {
    content = '<div class="selection-actions"><button id="duplicate-element">Duplicate</button><button id="delete-element" class="danger">Delete</button><button id="deselect">Done</button></div>';
    if (element && effectivelyLocked(element)) content += '<p class="selection-summary">This layer or its group is locked. Unlock it in Layers to edit it.</p>';
    if (element?.type === 'text') content += `<label class="property-field"><span>Text</span><textarea data-property="text" aria-label="Text" maxlength="10000">${safe(element.text)}</textarea></label>` + selectField('Font', 'fontFamily', element.fontFamily, FONTS.map(font => [font, font])) + '<div class="property-grid">' + field('Font size', 'fontSize', element.fontSize, { min: 4, max: 500 }) + selectField('Weight', 'fontWeight', element.fontWeight, [[400, 'Regular'], [700, 'Bold']]) + field('Line height', 'lineHeight', element.lineHeight, { min: .8, max: 3, step: .05 }) + field('Letter spacing', 'letterSpacing', element.letterSpacing, { min: -10, max: 100 }) + '</div>' + selectField('Alignment', 'align', element.align, [['left', 'Left'], ['center', 'Centre'], ['right', 'Right']]);
    if (element && ['table', 'chart'].includes(element.type)) {
      content += '<button id="edit-data-element" class="quiet-button">Edit data</button>' + selectField('Font', 'fontFamily', element.fontFamily, FONTS.map(font => [font, font])) + field('Font size', 'fontSize', element.fontSize, { min: 4, max: 100 }) + colourField('Text colour', 'textFill', element.textFill);
      if (element.type === 'table') content += checkbox('Show header', 'header', element.header) + colourField('Header colour', 'headerFill', element.headerFill) + colourField('Header text colour', 'headerTextFill', element.headerTextFill) + colourField('Border colour', 'borderColor', element.borderColor) + field('Border width', 'borderWidth', element.borderWidth, { min: 0, max: 10 });
      else content += checkbox('Show labels', 'showLabels', element.showLabels) + checkbox('Show values', 'showValues', element.showValues) + field('Pie colours (use commas)', 'palette', element.palette.join(', '), { type: 'text', maxlength: 80 });
    }
    if (element && element.type !== 'image' && !(element.type === 'shape' && element.kind === 'line')) content += colourField(element.type === 'freehand' ? 'Brush colour' : 'Fill colour', 'fill', element.fill);
    if (element) {
      content += '<div class="property-grid">' + field('X position', 'x', element.x, { min: -8192, max: 8192 }) + field('Y position', 'y', element.y, { min: -8192, max: 8192 }) + field('Width', 'width', element.width, { min: 1, max: 8192 }) + field('Height', 'height', element.height, { min: 1, max: 8192 }) + field('Rotation', 'rotation', element.rotation, { min: -360, max: 360 }) + field('Opacity', 'opacity', element.opacity, { min: 0, max: 1, step: .05 }) + '</div>';
      if (element.type === 'rect') content += field('Corner radius', 'radius', element.radius, { min: 0, max: 4096 });
      if (['rect', 'circle', 'shape'].includes(element.type)) content += colourField(element.type === 'shape' && element.kind === 'line' ? 'Line colour' : 'Outline colour', 'stroke', element.stroke) + field('Outline width', 'strokeWidth', element.strokeWidth, { min: 0, max: 40 });
      if (element.type === 'freehand') content += field('Brush width', 'strokeWidth', element.strokeWidth, { min: 1, max: 80 });
      content += '<div class="property-grid">' + checkbox('Flip horizontal', 'flipX', element.flipX) + checkbox('Flip vertical', 'flipY', element.flipY) + checkbox('Lock layer', 'locked', element.locked) + checkbox('Hide layer', 'hidden', element.hidden) + '</div>';
      if (element.type === 'image') content += '<h3 class="property-section-title">Crop image · percentages</h3><div class="property-grid">' + field('Crop left %', 'crop.x', element.crop.x * 100, { min: 0, max: 99, step: 1 }) + field('Crop top %', 'crop.y', element.crop.y * 100, { min: 0, max: 99, step: 1 }) + field('Crop width %', 'crop.width', element.crop.width * 100, { min: 1, max: 100, step: 1 }) + field('Crop height %', 'crop.height', element.crop.height * 100, { min: 1, max: 100, step: 1 }) + '</div><button id="reset-crop" class="quiet-button">Reset crop</button><h3 class="property-section-title">Photo adjustments</h3>' + ['brightness', 'contrast', 'saturation', 'grayscale', 'blur'].map(key => field(key[0].toUpperCase() + key.slice(1), `filters.${key}`, element.filters[key], { min: 0, max: key === 'blur' ? 20 : key === 'grayscale' ? 1 : 2, step: key === 'blur' ? 1 : .05 })).join('') + '<button id="reset-filters" class="quiet-button">Reset adjustments</button><button id="remove-background-colour" class="quiet-button">Remove a background colour</button>';
    } else {
      const b = bounds(elements); content += `<p class="selection-summary">${Math.round(b.width)} × ${Math.round(b.height)} px · Shift-click to change the selection. Groups keep layers together when you move or copy them.</p>`;
      content += colourField('Selection colour', 'fill', elements.find(e => e.type !== 'image')?.fill ?? '#232a27') + '<div class="selection-controls"><button id="lock-selection">Lock</button><button id="unlock-selection">Unlock</button><button id="hide-selection">Hide</button><button id="flip-selection-x">Flip left/right</button><button id="flip-selection-y">Flip up/down</button></div>';
    }
    content += '<h3 class="property-section-title">Layer order</h3><div class="selection-controls"><button id="selection-to-front">Bring to front</button><button id="selection-to-back">Send to back</button></div>';
    content += '<h3 class="property-section-title">Align and distribute</h3><label class="checkbox-field"><input id="align-to-page" type="checkbox"' + (elements.length === 1 ? ' checked' : '') + '>Align to page</label><div class="alignment-buttons">' + [['left', 'Left'], ['centerX', 'Centre X'], ['right', 'Right'], ['top', 'Top'], ['centerY', 'Centre Y'], ['bottom', 'Bottom']].map(([key, label]) => `<button data-align="${key}">${label}</button>`).join('') + '</div><div class="selection-controls"><button data-distribute="horizontal"' + (elements.length < 3 ? ' disabled' : '') + '>Space across</button><button data-distribute="vertical"' + (elements.length < 3 ? ' disabled' : '') + '>Space down</button></div>';
  }
  content += '<section class="brand-settings"><h3 class="property-section-title">Design palette</h3><div class="brand-swatches">' + history.current.brand.colours.map(colour => `<button data-swatch="${colour}" style="--swatch:${colour}" aria-label="Apply palette colour ${colour}">${colour}</button>`).join('') + '</div>' + field('Colours (use commas)', 'brand.colours', history.current.brand.colours.join(', '), { type: 'text', maxlength: 80 }) + selectField('Default font', 'brand.fontFamily', history.current.brand.fontFamily, FONTS.map(font => [font, font])) + '</section>';
  $('#properties').innerHTML = content;
  $('#properties').querySelectorAll('[data-property]').forEach(input => input.addEventListener('change', () => {
    try {
      const key = input.dataset.property; let value = input.type === 'checkbox' ? input.checked : input.value;
      if (input.type === 'number' || key === 'fontWeight') { if (String(value).trim() === '') throw new Error('Enter a number to make this change.'); value = Number(value); }
      if (key === 'palette') value = value.split(',').map(colour => colour.trim());
      let next;
      if (key.startsWith('brand.')) { const prop = key.split('.')[1]; if (prop === 'colours') value = value.split(',').map(c => c.trim()); next = { ...history.current, brand: { ...history.current.brand, [prop]: value } }; }
      else if (key === 'preset') {
        const preset = PRESETS.find(item => item.key === value); if (!preset) return;
        next = resizePage(preset.width, preset.height, $('#scale-layout')?.checked);
      } else if (elements.length) {
        if (key.includes('.')) { const [section, prop] = key.split('.'); next = updateElement(history.current, p.id, element.id, { [section]: { ...selected()[section], [prop]: section === 'crop' ? value / 100 : value } }); }
        else next = updateElements(history.current, p.id, selectionIds(), e => key === 'fill' && e.type === 'shape' && e.kind === 'line' ? { fill: value, stroke: value } : { [key]: value });
      } else if (key === 'width' || key === 'height') next = resizePage(key === 'width' ? value : page().width, key === 'height' ? value : page().height, $('#scale-layout')?.checked);
      else next = editPage(history.current, p.id, nextPage => { nextPage[key] = value; });
      commit(next, { keepInspector: key !== 'preset' && !key.startsWith('brand.') && !['locked', 'hidden'].includes(key) });
      if (input.type === 'color') input.closest('.colour-field').querySelector('code').textContent = value.toUpperCase();
    } catch (error) { toast(error.message || 'That change didn’t work. Try again.', true); restoreInput(input); }
  }));
  $('#delete-element')?.addEventListener('click', deleteSelection); $('#duplicate-element')?.addEventListener('click', duplicateSelection);
  $('#selection-to-front')?.addEventListener('click', () => attempt(() => commit(positionLayers(history.current, pageId, selectionIds(), 'front'))));
  $('#selection-to-back')?.addEventListener('click', () => attempt(() => commit(positionLayers(history.current, pageId, selectionIds(), 'back'))));
  $('#deselect')?.addEventListener('click', () => { selection.clear(); render(); });
  $('#reset-crop')?.addEventListener('click', () => applySelection({ crop: { x: 0, y: 0, width: 1, height: 1 } }));
  $('#reset-filters')?.addEventListener('click', () => applySelection({ filters: { brightness: 1, contrast: 1, saturation: 1, grayscale: 0, blur: 0 } }));
  $('#remove-background-colour')?.addEventListener('click', openBackgroundTool);
  $('#edit-data-element')?.addEventListener('click', () => attempt(() => { const current = page().elements.find(item => item.id === element.id); if (!current) throw new Error('Select the table or chart again to edit its data.'); openDataEditor(current.type, current); }));
  if (elements.length && elements.every(effectivelyLocked)) {
    $('#properties').querySelectorAll('[data-property]').forEach(control => { const key = control.dataset.property; if (!['locked', 'hidden'].includes(key) && !key.startsWith('brand.')) control.disabled = true; });
    $('#properties').querySelectorAll('[data-swatch], [data-align], [data-distribute], #delete-element, #selection-to-front, #selection-to-back, #reset-crop, #reset-filters, #remove-background-colour, #edit-data-element, #flip-selection-x, #flip-selection-y').forEach(control => { control.disabled = true; });
  }
  if (elements.some(effectivelyLocked)) for (const selector of ['#selection-to-front', '#selection-to-back']) $(selector)?.setAttribute('disabled', '');
  const actions = { 'lock-selection': { locked: true }, 'unlock-selection': { locked: false }, 'hide-selection': { hidden: true } };
  for (const [buttonId, patch] of Object.entries(actions)) $(`#${buttonId}`)?.addEventListener('click', () => applySelection(patch));
  $('#flip-selection-x')?.addEventListener('click', () => toggleSelection('flipX')); $('#flip-selection-y')?.addEventListener('click', () => toggleSelection('flipY'));
  $('#properties').querySelectorAll('[data-align]').forEach(button => button.addEventListener('click', () => attempt(() => commit(alignElements(history.current, p.id, selectionIds(), button.dataset.align, $('#align-to-page').checked)))));
  $('#properties').querySelectorAll('[data-distribute]').forEach(button => button.addEventListener('click', () => attempt(() => commit(distributeElements(history.current, p.id, selectionIds(), button.dataset.distribute)))));
  $('#properties').querySelectorAll('[data-swatch]').forEach(button => button.addEventListener('click', () => elements.length ? applySelection({ fill: button.dataset.swatch }) : attempt(() => commit(editPage(history.current, p.id, next => { next.background = button.dataset.swatch; })))));
  if (cloudSession?.role === 'view') $('#properties').querySelectorAll('input,textarea,select,button').forEach(control => { control.disabled = true; });
}
function restoreInput(input) {
  const key = input.dataset.property; let value;
  if (key.startsWith('brand.')) value = history.current.brand[key.split('.')[1]];
  else if (key.includes('.')) { const [section, prop] = key.split('.'); value = selected()?.[section]?.[prop]; if (section === 'crop') value *= 100; }
  else value = (selection.size ? selected() : page())?.[key];
  if (input.type === 'checkbox') input.checked = Boolean(value); else input.value = Array.isArray(value) ? value.join(', ') : value ?? '';
}
function resizePage(width, height, scale) { return resizePageDocument(history.current, pageId, width, height, Boolean(scale)); }
function applySelection(patch) { attempt(() => commit(updateElements(history.current, pageId, selectionIds(), e => Object.hasOwn(patch, 'fill') && e.type === 'shape' && e.kind === 'line' ? { ...patch, stroke: patch.fill } : patch))); }
function toggleSelection(key) { attempt(() => commit(updateElements(history.current, pageId, selectionIds(), e => ({ [key]: !e[key] })))); }
function chooseElement(elementId, shift = false, individual = false) {
  const e = page().elements.find(item => item.id === elementId); if (!e) return;
  const ids = e.groupId && !individual ? page().elements.filter(item => item.groupId === e.groupId).map(item => item.id) : [e.id];
  if (!shift) selection = new Set(ids);
  else if (ids.every(item => selection.has(item))) ids.forEach(item => selection.delete(item)); else ids.forEach(item => selection.add(item));
}
function renderLayers() {
  const elements = page().elements; $('#layer-count').textContent = `${elements.length} ${elements.length === 1 ? 'layer' : 'layers'}`;
  $('#layers').innerHTML = elements.length ? [...elements].reverse().map((e, displayIndex) => `<div draggable="${!effectivelyLocked(e) && cloudSession?.role !== 'view'}" class="layer-row${selection.has(e.id) ? ' selected' : ''}${e.locked ? ' locked' : ''}${e.hidden ? ' hidden-layer' : ''}" data-layer-id="${safe(e.id)}"><button class="layer-select" data-select="${safe(e.id)}" aria-label="Select ${safe(layerName(e))}" aria-pressed="${selection.has(e.id)}"><span class="layer-symbol${e.type === 'rect' || e.type === 'circle' ? ' shape' : ''}" style="--layer-fill:${e.fill}${e.type === 'circle' ? ';border-radius:50%' : ''}">${e.type === 'text' ? 'T' : e.type === 'image' ? '▧' : e.type === 'freehand' ? '〰' : e.type === 'shape' ? '◇' : ''}</span><span class="layer-name">${e.groupId ? '▣ ' : ''}${safe(layerName(e))}</span></button><div class="layer-actions"><button data-lock="${safe(e.id)}" title="${e.locked ? 'Unlock' : 'Lock'} ${safe(layerName(e))}" aria-label="${e.locked ? 'Unlock' : 'Lock'} ${safe(layerName(e))}" class="${e.locked ? 'active' : ''}"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><rect x="5" y="10" width="14" height="11" rx="2"/><path d="${e.locked ? 'M8 10V7a4 4 0 0 1 8 0v3' : 'M8 10V7a4 4 0 0 1 8 0'}"/><path d="M12 14v3"/></svg></button><button data-hide="${safe(e.id)}" title="${e.hidden ? 'Show' : 'Hide'} ${safe(layerName(e))}" aria-label="${e.hidden ? 'Show' : 'Hide'} ${safe(layerName(e))}" class="${e.hidden ? 'active' : ''}"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M2 12Q12 1 22 12Q12 23 2 12Z"/><circle cx="12" cy="12" r="3"/>${e.hidden ? '<path d="M3 3L21 21"/>' : ''}</svg></button><button data-order="1" data-id="${safe(e.id)}" aria-label="Bring ${safe(layerName(e))} forward"${displayIndex === 0 || effectivelyLocked(e) ? ' disabled' : ''}>↑</button><button data-order="-1" data-id="${safe(e.id)}" aria-label="Send ${safe(layerName(e))} backward"${displayIndex === elements.length - 1 || effectivelyLocked(e) ? ' disabled' : ''}>↓</button><button data-delete="${safe(e.id)}" aria-label="Delete ${safe(layerName(e))}"${effectivelyLocked(e) ? ' disabled' : ''}>×</button></div></div>`).join('') : '<div class="empty-layers">Your canvas is ready.<br>Add text, a shape or an image.</div>';
  $('#layers').querySelectorAll('[data-layer-id]').forEach(row => {
    row.addEventListener('dragstart', event => { const e = page().elements.find(item => item.id === row.dataset.layerId); if (!e || effectivelyLocked(e) || cloudSession?.role === 'view') { event.preventDefault(); return; } layerDrag = { pageId, revision: documentRevision, id: e.id }; event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('application/x-stencil-layer-order', e.id); row.classList.add('dragging'); });
    row.addEventListener('dragover', event => { if (!layerDrag || layerDrag.pageId !== pageId || layerDrag.revision !== documentRevision) return; event.preventDefault(); event.dataTransfer.dropEffect = 'move'; row.classList.add('drop-target'); });
    row.addEventListener('dragleave', () => row.classList.remove('drop-target'));
    row.addEventListener('drop', event => { event.preventDefault(); event.stopPropagation(); const moving = layerDrag; layerDrag = null; if (!moving || moving.pageId !== pageId || moving.revision !== documentRevision) { renderLayers(); return; } const above = event.clientY < row.getBoundingClientRect().top + row.getBoundingClientRect().height / 2; chooseElement(moving.id); attempt(() => commit(positionLayers(history.current, pageId, [moving.id], above ? 'after' : 'before', row.dataset.layerId))); renderLayers(); });
    row.addEventListener('dragend', () => { layerDrag = null; renderLayers(); });
  });
  $('#layers').querySelectorAll('[data-select]').forEach(button => button.addEventListener('click', event => { chooseElement(button.dataset.select, event.shiftKey, event.altKey); render(); }));
  $('#layers').querySelectorAll('[data-order]').forEach(button => button.addEventListener('click', () => attempt(() => commit(reorderElement(history.current, pageId, button.dataset.id, Number(button.dataset.order))))));
  $('#layers').querySelectorAll('[data-delete]').forEach(button => button.addEventListener('click', () => attempt(() => commit(removeElement(history.current, pageId, button.dataset.delete)))));
  for (const key of ['locked', 'hidden']) $('#layers').querySelectorAll(key === 'locked' ? '[data-lock]' : '[data-hide]').forEach(button => button.addEventListener('click', () => { const e = page().elements.find(item => item.id === (key === 'locked' ? button.dataset.lock : button.dataset.hide)); attempt(() => commit(updateElement(history.current, pageId, e.id, { [key]: !e[key] }))); }));
}
const imageLayerNames = new WeakMap();
function imageLayerName(element) {
  if (imageLayerNames.has(element)) return imageLayerNames.get(element);
  let name = 'Image';
  try { const notices = collectAssetNotices([element]); if (notices.length === 1) name = notices[0].name; } catch { /* An unknown uploaded image must still be selectable. */ }
  imageLayerNames.set(element, name); return name;
}
function layerName(e) { return e.type === 'text' ? e.text.replaceAll('\n', ' ').slice(0, 40) || 'Empty text' : e.type === 'rect' ? 'Rectangle' : e.type === 'circle' ? 'Circle' : e.type === 'table' ? 'Table' : e.type === 'chart' ? `${e.data.kind[0].toUpperCase() + e.data.kind.slice(1)} chart` : e.type === 'freehand' ? 'Brush stroke' : e.type === 'shape' ? e.kind[0].toUpperCase() + e.kind.slice(1) : imageLayerName(e); }
function calculateZoom() { const area = $('#canvas-area'), p = page(), margin = window.innerWidth <= 1150 ? 48 : 76; return Math.max(.05, Math.min(2, (area.clientWidth - margin) / p.width, (area.clientHeight - margin) / p.height)); }
function renderCanvas(previewPage = page()) {
  if (fit) zoom = calculateZoom();
  const elements = previewPage.elements.filter(e => selection.has(e.id) && !e.hidden), handle = Math.max(5, 7 / zoom);
  let overlay = elements.map(e => `<g transform="translate(${e.x} ${e.y}) rotate(${e.rotation} ${e.width / 2} ${e.height / 2})"><rect class="selection-outline" width="${e.width}" height="${e.height}"/>${elements.length === 1 && !effectivelyLocked(e) ? [[0, 0, 'nw'], [e.width, 0, 'ne'], [0, e.height, 'sw'], [e.width, e.height, 'se']].map(([x, y, corner]) => `<rect class="resize-handle" data-resize="${corner}" x="${x - handle / 2}" y="${y - handle / 2}" width="${handle}" height="${handle}"/>`).join('') : ''}</g>`).join('');
  if (elements.length > 1) { const b = bounds(elements); overlay += `<rect class="selection-outline" stroke-dasharray="4 4" x="${b.x}" y="${b.y}" width="${b.width}" height="${b.height}"/>`; }
  if (drag?.guides) overlay += drag.guides.map(guide => guide.axis === 'x' ? `<line class="snap-guide" x1="${guide.value}" x2="${guide.value}" y1="0" y2="${previewPage.height}"/>` : `<line class="snap-guide" x1="0" x2="${previewPage.width}" y1="${guide.value}" y2="${guide.value}"/>`).join('');
  if (drag?.marquee && drag.current) { const a = drag.start, b = drag.current; overlay += `<rect class="marquee" x="${Math.min(a.x, b.x)}" y="${Math.min(a.y, b.y)}" width="${Math.abs(b.x - a.x)}" height="${Math.abs(b.y - a.y)}"/>`; }
  if (previewPage.guideSettings.visible) overlay += previewPage.guides.map(guide => {
    const attrs = guide.axis === 'x' ? `x1="${guide.position}" x2="${guide.position}" y1="0" y2="${previewPage.height}"` : `x1="0" x2="${previewPage.width}" y1="${guide.position}" y2="${guide.position}"`;
    return `<g data-guide-id="${safe(guide.id)}" class="manual-guide"><line class="guide-hit" ${attrs}/><line class="guide-line" ${attrs}/></g>`;
  }).join('');
  const markup = pageSVG(previewPage, true), end = markup.lastIndexOf('</svg>');
  $('#canvas-mount').innerHTML = markup.slice(0, end) + overlay + markup.slice(end);
  $('#canvas-mount').classList.toggle('transparent-page', previewPage.transparentBackground);
  const svg = $('#artboard'); svg.style.width = `${previewPage.width * zoom}px`; svg.style.height = `${previewPage.height * zoom}px`;
  $('#canvas-mount').style.width = `${previewPage.width * zoom}px`; $('#canvas-mount').style.height = `${previewPage.height * zoom}px`;
  $('#canvas-area').style.justifyContent = previewPage.width * zoom > $('#canvas-area').clientWidth - 40 ? 'flex-start' : 'center'; $('#canvas-area').style.alignItems = previewPage.height * zoom > $('#canvas-area').clientHeight - 40 ? 'flex-start' : 'center';
  $('#zoom-value').textContent = `${Math.round(zoom * 100)}%`; svg.addEventListener('pointerdown', startDrag);
  renderRulers(previewPage);
}
function render(options = {}) {
  const p = page(); pageId = p.id; selection = new Set([...selection].filter(elementId => p.elements.some(e => e.id === elementId)));
  if (intakeActive && intakeActive.pageId !== pageId) cancelIntake('Insertion cancelled. You switched pages.');
  $('#draw-tool').disabled = cloudSession?.role === 'view';
  $('#canvas-mount').classList.toggle('drawing', drawMode);
  $('#copy-selection').disabled = !selection.size; $('#paste-content').disabled = cloudSession?.role === 'view';
  if (document.activeElement !== $('#document-title')) $('#document-title').value = history.current.title;
  $('#page-name-display').textContent = p.name || 'Untitled page'; $('#canvas-size').textContent = `${Math.round(p.width)} × ${Math.round(p.height)} px`;
  $('#undo').disabled = !history.past.length || cloudSession?.role === 'view'; $('#redo').disabled = !history.future.length || cloudSession?.role === 'view'; $('#document-title').disabled = cloudSession?.role === 'view'; $('#delete-page').disabled = history.current.pages.length === 1;
  $('#group-selection').disabled = selectedElements().length < 2 || selectedElements().some(effectivelyLocked); $('#ungroup-selection').disabled = !selectedElements().some(e => e.groupId) || selectedElements().some(effectivelyLocked); $('#selection-count').textContent = selection.size ? `${selection.size} selected` : 'No selection';
  $('#pages').innerHTML = history.current.pages.map((item, index) => `<button class="page-tab" data-page-id="${safe(item.id)}" aria-current="${item.id === pageId}" aria-label="Page ${index + 1}: ${safe(item.name || 'Untitled page')}" title="${safe(item.name)}"><span class="page-number">${index + 1}</span><span class="page-title">${safe(item.name || 'Untitled page')}</span></button>`).join('');
  $('#pages').querySelectorAll('button').forEach(button => button.addEventListener('click', () => { drag = null; closePageTools(); pageId = button.dataset.pageId; selection.clear(); render(); }));
  const pages = $('#pages'), activePage = pages.querySelector('[aria-current="true"]');
  if (activePage) { const activeRect = activePage.getBoundingClientRect(), listRect = pages.getBoundingClientRect(); if (activeRect.left < listRect.left) pages.scrollLeft -= listRect.left - activeRect.left; else if (activeRect.right > listRect.right) pages.scrollLeft += activeRect.right - listRect.right; }
  const pageIndex = history.current.pages.findIndex(item => item.id === pageId), readOnly = cloudSession?.role === 'view';
  $('#move-page-earlier').disabled = readOnly || pageIndex === 0; $('#move-page-later').disabled = readOnly || pageIndex === history.current.pages.length - 1;
  $('#page-order-position').max = history.current.pages.length; $('#page-order-position').disabled = readOnly; $('#move-page-to').disabled = readOnly;
  if (document.activeElement !== $('#page-order-position')) $('#page-order-position').value = pageIndex + 1;
  renderCanvas(); renderLayers(); if (!options.keepInspector) renderProperties(); updateSavedStatus();
}
function rulerMarkup(p, axis) {
  const size = p[axis === 'x' ? 'width' : 'height'], raw = 50 / zoom, magnitude = 10 ** Math.floor(Math.log10(raw));
  const interval = [1, 2, 5, 10].find(step => step * magnitude >= raw) * magnitude;
  const horizontal = axis === 'x', pixels = size * zoom;
  let ticks = '';
  for (let value = 0; value <= size; value += interval) {
    const coordinate = Number((value * zoom).toFixed(3)); ticks += horizontal ? `<line x1="${coordinate}" x2="${coordinate}" y1="16" y2="22"/><text x="${coordinate + 3}" y="12">${value}</text>` : `<line x1="16" x2="22" y1="${coordinate}" y2="${coordinate}"/><text x="3" y="${coordinate + 12}">${value}</text>`;
  }
  return `<svg data-ruler-axis="${axis}" class="canvas-ruler ruler-${horizontal ? 'horizontal' : 'vertical'}" width="${horizontal ? pixels : 22}" height="${horizontal ? 22 : pixels}" role="button" tabindex="0" aria-label="${horizontal ? 'Horizontal' : 'Vertical'} ruler: click to add a ${horizontal ? 'vertical' : 'horizontal'} guide; Enter opens guide settings" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%"/>${ticks}</svg>`;
}
function renderRulers(p) {
  if (!p.guideSettings.rulers) return;
  $('#canvas-mount').insertAdjacentHTML('beforeend', rulerMarkup(p, 'x') + rulerMarkup(p, 'y'));
  $('#canvas-mount').querySelectorAll('[data-ruler-axis]').forEach(ruler => {
    ruler.addEventListener('click', event => attempt(() => {
      const axis = ruler.dataset.rulerAxis, point = svgPoint(event, $('#artboard').getScreenCTM().inverse()), position = Number(Math.max(0, Math.min(p[axis === 'x' ? 'width' : 'height'], point[axis])).toFixed(3));
      commit(addPageGuide(history.current, pageId, axis, position));
    }));
    ruler.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); openGuides(); } });
  });
}
function renderGuideList() {
  const target = guideTarget, p = page(), readOnly = cloudSession?.role === 'view';
  $('#guide-list').innerHTML = p.guides.length ? p.guides.map(guide => `<div class="guide-row"><span>${guide.axis === 'x' ? 'Vertical · X' : 'Horizontal · Y'}</span><label><span class="sr-only">Guide ${safe(guide.id)} position</span><input type="number" data-guide-position="${safe(guide.id)}" aria-label="${guide.axis === 'x' ? 'Vertical' : 'Horizontal'} guide position" min="0" max="${p[guide.axis === 'x' ? 'width' : 'height']}" step="any" value="${guide.position}"${readOnly ? ' disabled' : ''}></label><button data-remove-guide="${safe(guide.id)}" class="quiet-button"${readOnly ? ' disabled' : ''}>Delete</button></div>`).join('') : '<p class="panel-hint">No guides yet. Enter a position above or click a ruler to add one.</p>';
  $('#guide-list').querySelectorAll('[data-guide-position]').forEach(input => input.addEventListener('change', () => {
    const original = page().guides.find(guide => guide.id === input.dataset.guidePosition);
    try { requireGuideTarget(target); if (!original) throw new Error('This guide has gone. Open Guides & rulers again.'); if (!input.value.trim()) throw new Error('Enter a guide position.'); commit(updatePageGuide(history.current, pageId, original.id, { position: Number(input.value) })); }
    catch (error) { input.value = original?.position ?? '';  toast(error.message, true); }
  }));
  $('#guide-list').querySelectorAll('[data-remove-guide]').forEach(button => button.addEventListener('click', () => attempt(() => { requireGuideTarget(target); commit(removePageGuide(history.current, pageId, button.dataset.removeGuide)); renderGuideList(); })));
  $('#add-guide').disabled = readOnly || p.guides.length >= 40;
}
function openGuides() {
  guideTarget = { pageId };
  const readOnly = cloudSession?.role === 'view';
  $('#guides-dialog').querySelectorAll('[data-guide-setting]').forEach(input => { if (input.type === 'checkbox') input.checked = page().guideSettings[input.dataset.guideSetting]; else input.value = page().guideSettings[input.dataset.guideSetting]; input.disabled = readOnly; });
  $('#guide-axis').disabled = $('#guide-position').disabled = readOnly; updateGuideMaximum(); renderGuideList(); $('#guides-dialog').showModal();
}
function updateGuideMaximum() { $('#guide-position').max = page()[$('#guide-axis').value === 'x' ? 'width' : 'height']; }
$('#guides-settings').addEventListener('click', openGuides);
$('#guides-dialog').addEventListener('close', () => { guideTarget = null; });
$('#guide-axis').addEventListener('change', updateGuideMaximum);
$('#guides-dialog').querySelectorAll('[data-guide-setting]').forEach(input => input.addEventListener('change', () => {
  const key = input.dataset.guideSetting;
  try { requireGuideTarget(); if (input.type !== 'checkbox' && !input.value.trim()) throw new Error('Enter a snap distance.'); commit(setPageGuideSettings(history.current, pageId, { [key]: input.type === 'checkbox' ? input.checked : Number(input.value) })); }
  catch (error) { if (input.type === 'checkbox') input.checked = page().guideSettings[key]; else input.value = page().guideSettings[key]; toast(error.message, true); }
}));
$('#add-guide').addEventListener('click', () => attempt(() => { requireGuideTarget(); if (!$('#guide-position').value.trim()) throw new Error('Enter a guide position.'); commit(addPageGuide(history.current, pageId, $('#guide-axis').value, Number($('#guide-position').value))); renderGuideList(); }));
$('#move-page-earlier').addEventListener('click', () => attempt(() => commit(reorderPage(history.current, pageId, history.current.pages.findIndex(p => p.id === pageId) - 1))));
$('#move-page-later').addEventListener('click', () => attempt(() => commit(reorderPage(history.current, pageId, history.current.pages.findIndex(p => p.id === pageId) + 1))));
$('#move-page-to').addEventListener('click', () => { try { const value = $('#page-order-position').value; if (!value.trim()) throw new Error('Enter a page position.'); commit(reorderPage(history.current, pageId, Number(value) - 1)); } catch (error) { $('#page-order-position').value = history.current.pages.findIndex(p => p.id === pageId) + 1; toast(error.message, true); } });

const svgPoint = (event, inverse) => new DOMPoint(event.clientX, event.clientY).matrixTransform(inverse);
function startDrag(event) {
  if (event.button !== 0) return;
  if (editingTarget(document.activeElement)) document.activeElement.blur();
  const guideNode = event.target.closest('[data-guide-id]'), node = event.target.closest('[data-element-id]'), handle = event.target.closest('[data-resize]'), inverse = $('#artboard').getScreenCTM().inverse();
  event.preventDefault(); $('#canvas-mount').setPointerCapture(event.pointerId);
  if (drawMode && !guideNode) {
    if (cloudSession?.role === 'view') return;
    cancelIntake('Insertion cancelled because drawing started.'); selection.clear();
    const start = clampBrushPoint(svgPoint(event, inverse));
    drag = { drawing: true, points: [start], fill: brushColour, strokeWidth: brushWidth, elementId: id(), inverse, pointerId: event.pointerId, pageId, revision: documentRevision, preview: null };
    previewBrush(); return;
  }
  if (guideNode) {
    if (cloudSession?.role === 'view') return;
    const guide = page().guides.find(item => item.id === guideNode.dataset.guideId);
    drag = { guideId: guide.id, axis: guide.axis, inverse, pointerId: event.pointerId, preview: null }; return;
  }
  if (!node && !handle) { if (!event.shiftKey) selection.clear(); drag = { marquee: true, start: svgPoint(event, inverse), inverse, pointerId: event.pointerId, base: new Set(selection), individual: event.altKey }; render(); return; }
  if (node) {
    const e = page().elements.find(item => item.id === node.dataset.elementId);
    if (!selection.has(e.id) || event.shiftKey || event.altKey) chooseElement(e.id, event.shiftKey, event.altKey);
  }
  if (cloudSession?.role === 'view') { render(); return; }
  const originals = selectedElements().filter(e => !effectivelyLocked(e) && !e.hidden); if (!originals.length) { render(); return; }
  drag = { originals: structuredClone(originals), start: svgPoint(event, inverse), inverse, corner: handle?.dataset.resize, moved: false, preview: null, pointerId: event.pointerId, guides: [] }; render();
}
function clampBrushPoint(point) { return { x: Math.max(0, Math.min(page().width, point.x)), y: Math.max(0, Math.min(page().height, point.y)) }; }
function sampleBrush(point, final = false) {
  if (!drag?.drawing) return; const p = clampBrushPoint(point), last = drag.points.at(-1);
  if (Math.hypot(p.x - last.x, p.y - last.y) < (final ? .01 : Math.max(.5, 1 / zoom))) return;
  if (drag.points.length >= MAX_STROKE_POINTS) { const lastPoint = drag.points.at(-1); drag.points = drag.points.filter((_, index) => index % 2 === 0); drag.points.push(lastPoint); }
  drag.points.push(p);
}
function previewBrush() {
  if (!drag?.drawing) return;
  if (drag.pageId !== pageId || drag.revision !== documentRevision) { drag = null; render(); return; }
  try { const e = createBrushStroke(drag.points, drag.fill, drag.strokeWidth, drag.elementId); drag.preview = editPage(history.current, pageId, p => p.elements.push(e)); renderCanvas(drag.preview.pages.find(p => p.id === pageId)); }
  catch (error) { drag = null; render(); toast(error.message || 'The stroke could not be added. Your design is unchanged.', true); }
}
function snapDelta(originals, dx, dy) { return snapMovement(page(), originals.map(element => element.id), dx, dy, zoom); }
window.addEventListener('pointermove', event => {
  if (!drag || event.pointerId !== drag.pointerId) return;
  const current = svgPoint(event, drag.inverse);
  if (drag.drawing) { sampleBrush(current); previewBrush(); return; }
  if (drag.marquee) { drag.current = current; renderCanvas(); return; }
  if (drag.guideId) {
    const position = Number(Math.max(0, Math.min(page()[drag.axis === 'x' ? 'width' : 'height'], current[drag.axis])).toFixed(3));
    try { drag.preview = updatePageGuide(history.current, pageId, drag.guideId, { position }); renderCanvas(drag.preview.pages.find(item => item.id === pageId)); } catch { /* Retain the last valid guide. */ }
    return;
  }
  let dx = current.x - drag.start.x, dy = current.y - drag.start.y; if (Math.abs(dx) + Math.abs(dy) < 1 && !drag.moved) return; drag.moved = true;
  let next;
  try {
    if (!drag.corner) {
      const snapped = snap && !event.altKey ? snapDelta(drag.originals, dx, dy) : { dx, dy, guides: [] }; dx = snapped.dx; dy = snapped.dy; drag.guides = snapped.guides;
      const originals = new Map(drag.originals.map(e => [e.id, e])); next = updateElements(history.current, pageId, [...originals.keys()], e => ({ x: Number((originals.get(e.id).x + dx).toFixed(3)), y: Number((originals.get(e.id).y + dy).toFixed(3)) }));
    } else {
      const e = drag.originals[0], angle = e.rotation * Math.PI / 180, cos = Math.cos(angle), sin = Math.sin(angle), localDx = dx * cos + dy * sin, localDy = -dx * sin + dy * cos;
      const west = drag.corner.includes('w'), north = drag.corner.includes('n'), width = Math.max(1, Math.min(8192, e.width + (west ? -localDx : localDx))), height = Math.max(1, Math.min(8192, e.height + (north ? -localDy : localDy)));
      const centerDx = (west ? -1 : 1) * (width - e.width) / 2, centerDy = (north ? -1 : 1) * (height - e.height) / 2;
      next = updateElement(history.current, pageId, e.id, { width: Math.round(width), height: Math.round(height), x: Math.round(e.x + e.width / 2 + centerDx * cos - centerDy * sin - width / 2), y: Math.round(e.y + e.height / 2 + centerDx * sin + centerDy * cos - height / 2) });
    }
    drag.preview = next; renderCanvas(next.pages.find(p => p.id === pageId));
  } catch { /* Keep the last validated drag position if schema bounds are reached. */ }
});
function endDrag(event) {
  if (!drag || event.pointerId !== drag.pointerId) return;
  if (drag.drawing) { sampleBrush(svgPoint(event, drag.inverse), true); previewBrush(); if (drag?.pageId !== pageId || drag?.revision !== documentRevision) { drag = null; render(); return; } selection = new Set([drag.elementId]); }
  const currentDrag = drag; drag = null;
  if (currentDrag.marquee && currentDrag.current) {
    const a = currentDrag.start, b = currentDrag.current, left = Math.min(a.x, b.x), right = Math.max(a.x, b.x), top = Math.min(a.y, b.y), bottom = Math.max(a.y, b.y);
    selection = new Set(currentDrag.base); const intersected = page().elements.filter(e => !e.hidden && !effectivelyLocked(e) && e.x < right && e.x + e.width > left && e.y < bottom && e.y + e.height > top); intersected.forEach(e => { selection.add(e.id); if (e.groupId && !currentDrag.individual) page().elements.filter(member => member.groupId === e.groupId).forEach(member => selection.add(member.id)); }); render();
  } else if (currentDrag.preview) attempt(() => commit(currentDrag.preview)); else render();
}
window.addEventListener('pointerup', endDrag); window.addEventListener('pointercancel', event => { if (drag && event.pointerId === drag.pointerId) { drag = null; render(); } });
window.addEventListener('blur', () => { if (drag) { drag = null; render(); } });
function deleteSelection() { attempt(() => commit(removeElements(history.current, pageId, selectionIds()))); }
function selectNewElements(next) { const old = new Set(page().elements.map(e => e.id)); selection = new Set(next.pages.find(p => p.id === pageId).elements.filter(e => !old.has(e.id)).map(e => e.id)); commit(next); }
function duplicateSelection() { attempt(() => selectNewElements(duplicateElements(history.current, pageId, selectionIds()))); }
function addElement(type, patch = {}) {
  return attempt(() => { const p = page(), element = createElement(type, { x: Math.round(p.width * .12), y: Math.round(p.height * .15), width: Math.min(type === 'text' ? 420 : 220, p.width * .7), height: Math.min(type === 'text' ? 140 : 220, p.height * .5), fill: type === 'text' ? history.current.brand.colours[2] ?? history.current.brand.colours[0] : history.current.brand.colours[1] ?? history.current.brand.colours[0], ...(type === 'text' ? { fontFamily: history.current.brand.fontFamily } : {}), ...patch }); const next = editPage(history.current, p.id, updated => updated.elements.push(element)); selection = new Set([element.id]); return commit(next); });
}
const libraryTabs = ['templates', 'elements', 'assets', 'library'];
let assetBrowser = null, assetBrowserLoading = null;
async function openAssets() {
  try {
    if (!assetBrowserLoading) assetBrowserLoading = import('./asset-browser.js').then(({ createAssetBrowser }) => {
      assetBrowser = createAssetBrowser({
        insert: (asset, source, colour) => runIntake(async request => {
          const { prepareAssetFile } = await import('./asset-svg.js');
          const file = await prepareAssetFile(asset, source, { colour, signal: request.controller.signal });
          const result = await prepareFiles([file], { page: request.page, brand: request.brand, signal: request.controller.signal });
          const element = result.elements[0], edge = Math.min(source.kind === 'illustration' ? 360 : 220, request.page.width * .55, request.page.height * .55), scale = edge / Math.max(element.sourceWidth, element.sourceHeight);
          element.width = element.sourceWidth * scale; element.height = element.sourceHeight * scale; element.x = (request.page.width - element.width) / 2; element.y = (request.page.height - element.height) / 2;
          return result;
        }, asset.name), credits: downloadAssetCredits
      }); return assetBrowser;
    });
    await assetBrowserLoading; await assetBrowser.open();
  } catch { assetBrowserLoading = null; $('#asset-status').textContent = 'The asset library could not open. Switch tabs, then choose Assets to try again.'; }
}
function downloadAssetCredits() {
  attempt(() => {
    const records = assetCredits(history.current.pages.flatMap(p => p.elements));
    if (!records.length) { toast('This design has no library assets yet.'); return; }
    const content = records.map(record => `${record.collection}\n${record.source}\n${record.license}\n\n${record.notice}`).join('\n\n────\n\n');
    download(content, 'text/plain;charset=utf-8', `${filename()}-asset-credits.txt`); toast('Asset credits downloaded. Keep them with artwork you share.');
  });
}
function switchLibrary(tab) {
  for (const key of libraryTabs) { const selected = key === tab; $(`#${key}-tab`).setAttribute('aria-selected', String(selected)); $(`#${key}-tab`).tabIndex = selected ? 0 : -1; $(`#${key}-panel`).hidden = !selected; }
  if (tab === 'library') renderLibrary(); if (tab === 'assets') openAssets();
}
for (const tab of libraryTabs) {
  const button = $(`#${tab}-tab`); button.addEventListener('click', () => switchLibrary(tab));
  button.addEventListener('keydown', event => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault(); event.stopPropagation(); const current = libraryTabs.indexOf(tab), index = event.key === 'Home' ? 0 : event.key === 'End' ? libraryTabs.length - 1 : (current + (event.key === 'ArrowRight' ? 1 : -1) + libraryTabs.length) % libraryTabs.length;
    switchLibrary(libraryTabs[index]); $(`#${libraryTabs[index]}-tab`).focus();
  });
}
$('#templates').innerHTML = TEMPLATES.map(template => `<button class="template-button" data-template="${template.key}"><span class="template-preview">${pageSVG(templateDocument(template.key).pages[0])}</span><strong>${safe(template.name)}</strong><small>${safe(template.category)}</small></button>`).join('');
function designDialogState() { return [...document.querySelectorAll('dialog[open]')].filter(dialog => dialog.id !== 'design-name-dialog').map(dialog => dialog.id).join(','); }
function captureDesignState() { return { revision: documentRevision, document: serialiseDocument(history.current), draft: draftSignature(), dialogs: designDialogState(), libraryId, updatedAt: savedBindings.get(libraryId)?.updatedAt }; }
function requireDesignState(state, checkBinding = true) {
  if (state.revision !== documentRevision || state.document !== serialiseDocument(history.current) || state.draft !== draftSignature() || state.dialogs !== designDialogState() || Boolean(drag) || checkBinding && (state.libraryId !== libraryId || state.updatedAt !== savedBindings.get(libraryId)?.updatedAt)) throw new Error('Your design changed while saved designs were busy. Your edits are still here. Try again when you are ready.');
}
async function preserveCurrentDesign(guard = () => {}) {
  const state = captureDesignState(); guard();
  if (pristineDocument === state.document) return null;
  if (!recoveryPreserved) throw new Error('Autosave is paused to protect your earlier design. Download your current JSON and Recovery data before starting or opening another design.');
  const binding = libraryId && savedBindings.get(libraryId);
  if (binding && state.document === binding.baseline) return null;
  const options = { name: history.current.title.trim() || 'Untitled design', ...(binding ? { id: libraryId, expectedUpdatedAt: binding.updatedAt } : {}) };
  try {
    const record = await withLibraryLock(() => { guard(); requireDesignState(state); const saved = saveDesign(parseDocument(state.document), options); rememberSaved(saved); return saved; });
    guard(); requireDesignState(state, false);
    if (libraryId !== record.id || savedBindings.get(record.id)?.updatedAt !== record.updatedAt) throw new Error('A different saved design was opened while this one was being kept.');
    return record;
  } catch (error) { throw new Error(`Your current design is still open. ${error.message} Choose Save a copy or download JSON, then try again.`); }
}
async function startNewDocument(next, guard = () => {}) {
  const valid = validateDocument(next), state = captureDesignState(); const recovery = await preserveCurrentDesign(guard); guard(); requireDesignState(state, false); setDrawMode(false);
  const saved = openDocument(valid); switchLibrary('elements');
  if (saved) toast(recovery ? 'Your new canvas is ready. Your previous design is kept in My designs.' : 'Your canvas is ready. Add text or a shape, or choose Draw.');
  return saved;
}
function openNewDesign() {
  if (editingTarget(document.activeElement)) document.activeElement.blur();
  drag = null; cancelIntake('Insertion cancelled. You opened New design.'); renderCanvas();
  $('#new-title').value = 'Untitled design'; $('#new-preset').value = 'poster'; $('#new-width').value = 720; $('#new-height').value = 960; $('#new-background').value = '#ffffff'; $('#new-design-error').textContent = '';
  $('#new-design-dialog').showModal();
}
$('#new-design').addEventListener('click', openNewDesign); $('#blank-design').addEventListener('click', openNewDesign);
$('#new-preset').addEventListener('change', () => { const preset = PRESETS.find(p => p.key === $('#new-preset').value); if (preset) { $('#new-width').value = preset.width; $('#new-height').value = preset.height; } });
for (const selector of ['#new-width', '#new-height']) $(selector).addEventListener('input', () => { $('#new-preset').value = ''; });
$('#new-design-form').addEventListener('submit', async event => {
  event.preventDefault(); if ($('#create-new-design').disabled) return; $('#create-new-design').disabled = true;
  const signature = () => JSON.stringify([...$('#new-design-form').querySelectorAll('input,select')].map(input => input.value)), draft = signature();
  const guard = () => { if (!$('#new-design-dialog').open || signature() !== draft) throw new Error('Your new design settings changed. Choose Create design again when you are ready.'); };
  try { const next = createBlankDesign({ title: $('#new-title').value.trim() || 'Untitled design', width: Number($('#new-width').value), height: Number($('#new-height').value), background: $('#new-background').value }); await startNewDocument(next, guard); $('#new-design-dialog').close(); }
  catch (error) { $('#new-design-error').textContent = error.message; }
  finally { $('#create-new-design').disabled = false; }
});
$('#new-export-current').addEventListener('click', () => download(serialiseDocument(history.current), 'application/json', `${filename()}.json`));
$('#templates').querySelectorAll('button').forEach(button => button.addEventListener('click', async () => { if (button.disabled) return; button.disabled = true; drag = null; renderCanvas(); try { await startNewDocument(templateDocument(button.dataset.template)); } catch (error) { toast(error.message, true); } finally { button.disabled = false; } }));
function setDrawMode(enabled) {
  if (enabled && cloudSession?.role === 'view') { toast('You have view-only access. Keep a local copy and disconnect to draw on it.', true); return; }
  drag = null; drawMode = Boolean(enabled); $('#draw-tool').setAttribute('aria-pressed', String(drawMode)); $('#draw-tool').textContent = drawMode ? 'Brush on · B' : 'Draw · B'; $('#select-tool').setAttribute('aria-pressed', String(!drawMode)); $('#brush-settings').hidden = !drawMode; $('#canvas-mount').classList.toggle('drawing', drawMode); renderCanvas();
}
$('#draw-tool').addEventListener('click', () => setDrawMode(!drawMode)); $('#select-tool').addEventListener('click', () => setDrawMode(false));
$('#brush-colour').addEventListener('input', event => { brushColour = event.target.value; });
$('#brush-width').addEventListener('change', event => { const width = Number(event.target.value); if (!Number.isFinite(width) || width < 1 || width > 80) { event.target.value = brushWidth; toast('Choose a brush width from 1 to 80 pixels.', true); return; } brushWidth = width; });
for (const kind of SHAPE_KINDS) $(`#add-${kind}`).addEventListener('click', () => { setDrawMode(false); addElement('shape', { kind, ...(kind === 'line' ? { height: 40, stroke: history.current.brand.colours[1] ?? '#e76543', strokeWidth: 6 } : {}) }); });
$('#add-text').addEventListener('click', () => { setDrawMode(false); addElement('text'); }); $('#add-rectangle').addEventListener('click', () => { setDrawMode(false); addElement('rect'); }); $('#add-circle').addEventListener('click', () => { setDrawMode(false); addElement('circle'); });
$('#document-title').addEventListener('change', event => attempt(() => commit({ ...history.current, title: event.target.value }, { keepInspector: true })));
function undoRedo(redo = false) { const hadDrag = Boolean(drag); drag = null; cancelIntake('Insertion cancelled by Undo or Redo.'); if (cloudSession?.role === 'view') { if (hadDrag) render(); toast('You have view-only access. Keep a local copy and disconnect to edit it.', true); return; } if (redo ? history.redo() : history.undo()) { documentRevision++; libraryId = historyBindings.get(history.current) ?? null; if (!savedBindings.has(libraryId)) libraryId = null; keepActiveBinding(); pageId = page().id; selection = new Set([...selection].filter(elementId => page().elements.some(e => e.id === elementId))); persist(); render(); } else if (hadDrag) render(); }
$('#undo').addEventListener('click', () => undoRedo()); $('#redo').addEventListener('click', () => undoRedo(true));
$('#select-all').addEventListener('click', () => { selection = new Set(page().elements.filter(e => !e.hidden && !effectivelyLocked(e)).map(e => e.id)); render(); });
$('#group-selection').addEventListener('click', () => attempt(() => commit(groupElements(history.current, pageId, selectionIds())))); $('#ungroup-selection').addEventListener('click', () => attempt(() => commit(ungroupElements(history.current, pageId, selectionIds()))));
$('#snap-toggle').addEventListener('click', () => { snap = !snap; $('#snap-toggle').setAttribute('aria-pressed', String(snap)); $('#snap-toggle').textContent = snap ? 'Snap on' : 'Snap off'; });
$('#add-page').addEventListener('click', () => attempt(() => { const p = createPage(page().width, page().height); p.name = `Page ${history.current.pages.length + 1}`; const next = validateDocument({ ...history.current, pages: [...history.current.pages, p] }); pageId = p.id; selection.clear(); commit(next); }));
$('#duplicate-page').addEventListener('click', () => attempt(() => { const next = duplicatePage(history.current, pageId), index = next.pages.findIndex(p => p.id === pageId); pageId = next.pages[index + 1].id; selection.clear(); commit(next); }));
$('#delete-page').addEventListener('click', () => attempt(() => { if (history.current.pages.length > 1) commit({ ...history.current, pages: history.current.pages.filter(p => p.id !== pageId) }); }));
$('#fit-canvas').addEventListener('click', () => { fit = true; renderCanvas(); }); $('#zoom-in').addEventListener('click', () => { fit = false; zoom = Math.min(3, zoom * 1.2); renderCanvas(); }); $('#zoom-out').addEventListener('click', () => { fit = false; zoom = Math.max(.05, zoom / 1.2); renderCanvas(); });
new ResizeObserver(() => { if (fit) renderCanvas(); }).observe($('#canvas-area'));
window.addEventListener('keydown', event => {
  if ($('#presentation-dialog').open) { if (['ArrowLeft', 'ArrowRight'].includes(event.key)) { event.preventDefault(); changeSlide(event.key === 'ArrowLeft' ? -1 : 1); } return; }
  if (event.target.matches('input,textarea,select,[contenteditable]') || [...document.querySelectorAll('dialog')].some(d => d.open)) return;
  const mod = event.ctrlKey || event.metaKey, key = event.key.toLowerCase();
  if (event.target.closest('.action-menu') && !mod) return;
  if (mod && key === 'z') { event.preventDefault(); undoRedo(event.shiftKey); }
  else if (mod && key === 'y') { event.preventDefault(); undoRedo(true); }
  else if (mod && key === 'a') { event.preventDefault(); $('#select-all').click(); }
  else if (mod && key === 'd') { event.preventDefault(); duplicateSelection(); }
  else if (mod && ['[', ']'].includes(key)) { event.preventDefault(); if (selection.size) attempt(() => commit(positionLayers(history.current, pageId, selectionIds(), key === ']' ? 'front' : 'back'))); }
  else if (!mod && key === 'b') { event.preventDefault(); setDrawMode(!drawMode); }
  else if (!mod && key === 'v') { event.preventDefault(); setDrawMode(false); }
  else if (mod && key === 'g') { event.preventDefault(); (event.shiftKey ? $('#ungroup-selection') : $('#group-selection')).click(); }
  else if (event.key === 'Escape') { drag = null; setDrawMode(false); selection.clear(); render(); }
  else if (selection.size && ['Delete', 'Backspace'].includes(event.key)) { event.preventDefault(); deleteSelection(); }
  else if (selection.size && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) {
    event.preventDefault(); const step = event.shiftKey ? 10 : 1;
    attempt(() => commit(updateElements(history.current, pageId, selectionIds(), e => ({ x: e.x + (event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0), y: e.y + (event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0) }))));
  }
});
function editingTarget(target) { return Boolean(target?.closest?.('input,textarea,select,[contenteditable]:not([contenteditable="false"])')); }
const modalOpen = () => [...document.querySelectorAll('dialog')].some(dialog => dialog.open);
function draftSignature() { return JSON.stringify([...document.querySelectorAll('#document-title, #page-order-position, #properties input, #properties textarea, #properties select')].map(input => [input.id, input.dataset.property, input.type === 'checkbox' ? input.checked : input.value])); }
function intakeFeedback(message, error = false) { $('#intake-status').textContent = message; $('#intake-status').classList.toggle('error', error); }
function updateIntakeOverlay() {
  const active = Boolean(intakeActive), dropping = fileDragDepth > 0;
  $('#intake-overlay').hidden = !active && !dropping;
  $('#intake-overlay').classList.toggle('preparing', active);
  $('#intake-overlay-label').textContent = active ? 'Preparing your files…' : 'Drop files onto your canvas';
  $('#cancel-insertion').hidden = !active;
  $('#canvas-area').classList.toggle('accepting-drop', dropping && !active);
}
function cancelIntake(message = '') {
  if (!intakeActive) return;
  intakeGeneration++; intakeActive.controller.abort(); intakeActive = null; updateIntakeOverlay();
  if (message) intakeFeedback(message, true);
}
function captureIntake() {
  if (cloudSession?.role === 'view') throw new Error('You have view-only access. Keep a local copy and disconnect to add things.');
  if (modalOpen()) throw new Error('Finish or close this window before adding files or pasting onto the canvas.');
  if (editingTarget(document.activeElement)) document.activeElement.blur();
  cancelIntake();
  if (drag) { drag = null; renderCanvas(); }
  const request = { generation: ++intakeGeneration, revision: documentRevision, pageId, cloudGeneration, base: serialiseDocument(history.current), draft: draftSignature(), page: structuredClone(page()), brand: structuredClone(history.current.brand), controller: new AbortController() };
  intakeActive = request; updateIntakeOverlay(); intakeFeedback('Checking your files before adding them…'); return request;
}
function requireIntakeTarget(request) {
  if (intakeActive !== request || request.generation !== intakeGeneration || request.controller.signal.aborted) throw new DOMException('Insertion cancelled.', 'AbortError');
  if (request.revision !== documentRevision || request.pageId !== pageId || request.cloudGeneration !== cloudGeneration || request.base !== serialiseDocument(history.current) || request.draft !== draftSignature() || modalOpen() || cloudSession?.role === 'view') throw new Error('The design changed while these files were loading. Nothing was added. Choose your files or paste again.');
}
async function runIntake(prepare, description = 'Content') {
  let request;
  try {
    request = captureIntake(); const result = await prepare(request); requireIntakeTarget(request);
    let next;
    if (result.kind === 'document') {
      if (result.confirmDocument !== false && !window.confirm('Open this Stencil design? Your current work will be kept in My designs first.')) { intakeActive = null; updateIntakeOverlay(); intakeFeedback('Your current design is still open.'); return; }
      requireIntakeTarget(request); await preserveCurrentDesign(); requireIntakeTarget(request); intakeActive = null; updateIntakeOverlay();
      if (openDocument(result.document)) { intakeFeedback('Design opened. Your previous design is kept in My designs.'); toast('Design opened. Your previous design is kept in My designs.'); }
      return;
    }
    next = result.kind === 'selection' ? pasteSelection(history.current, pageId, result.payload, result.point ? { point: result.point } : {}) : insertElements(history.current, pageId, result.elements);
    const old = new Set(page().elements.map(element => element.id)), ids = next.pages.find(p => p.id === pageId).elements.filter(element => !old.has(element.id)).map(element => element.id);
    intakeActive = null; updateIntakeOverlay(); selection = new Set(ids);
    const saved = commit(next); intakeFeedback(saved ? `${description} inserted · ${ids.length} ${ids.length === 1 ? 'layer' : 'layers'}. Undo removes everything you just added.` : 'Added to this design, but your browser could not save it. Choose File → Save JSON to keep your work.', !saved);
    if (saved) toast(`${ids.length} ${ids.length === 1 ? 'layer' : 'layers'} inserted. Undo removes everything you just added.`);
    return true;
  } catch (error) {
    if (request && request.generation !== intakeGeneration) return false;
    if (request) { intakeActive = null; updateIntakeOverlay(); }
    const message = error.name === 'AbortError' ? 'Insertion cancelled. Your design is unchanged.' : error.message || 'This could not be added to the canvas.';
    intakeFeedback(message, true); toast(message, true); return false;
  }
}
function insertFiles(files, point, confirmDocument = true) { return runIntake(async request => ({ ...await prepareFiles(files, { page: request.page, brand: request.brand, point, signal: request.controller.signal }), confirmDocument }), 'Files'); }
function insertText(text, point) { return runIntake(request => ({ kind: 'elements', elements: [textElement(text, request.page, request.brand, point)] }), 'Text'); }
function pastePayload(payload, point) { return runIntake(() => ({ kind: 'selection', payload, point }), 'Copied layers'); }
$('#cancel-insertion').addEventListener('click', () => cancelIntake('Insertion cancelled. Your design is unchanged.'));
$('#upload-image').addEventListener('click', () => $('#image-input').click());
for (const selector of ['#insert-files', '#upload-assets']) $(selector).addEventListener('click', () => $('#asset-input').click());
for (const selector of ['#image-input', '#asset-input', '#document-input']) $(selector).addEventListener('change', event => { const files = Array.from(event.target.files ?? []); event.target.value = ''; if (files.length) insertFiles(files, undefined, selector !== '#document-input'); });
window.addEventListener('copy', event => {
  if (editingTarget(event.target) || modalOpen() || !selection.size || !event.clipboardData || window.getSelection()?.toString()) return;
  try {
    const payload = encodeSelection(history.current, pageId, selectionIds());
    event.clipboardData.setData('text/plain', encodeSelectionText(payload));
    try { event.clipboardData.setData(CLIPBOARD_MIME, payload); } catch { /* The portable text envelope works when custom MIME types are unsupported. */ }
    event.preventDefault(); toast('Layers copied. Paste them into another Stencil tab.');
  } catch (error) { toast(error.message || 'These layers could not be copied. Select them and try again.', true); }
});
function transferContent(data) {
  const payload = data.getData(CLIPBOARD_MIME), text = data.getData('text/plain') || data.getData('text/uri-list');
  if (payload) return { kind: 'selection', payload };
  if (isSelectionText(text)) return { kind: 'selection', payload: text.slice(CLIPBOARD_PREFIX.length) };
  const files = Array.from(data.files ?? []);
  if (!files.length) for (const item of Array.from(data.items ?? [])) if (item.kind === 'file') { const file = item.getAsFile(); if (file) files.push(file); }
  if (files.length) return { kind: 'files', files };
  if (text) return { kind: 'text', text };
  return { kind: 'unsupported' };
}
function insertTransfer(content, point) {
  if (content.kind === 'selection') pastePayload(content.payload, point);
  else if (content.kind === 'files') insertFiles(content.files, point);
  else if (content.kind === 'text') insertText(content.text, point);
  else { const message = 'Copy plain text, an image or layers from another Stencil tab, then paste again. HTML and SVG cannot be pasted here.'; intakeFeedback(message, true); toast(message, true); }
}
window.addEventListener('paste', event => {
  if (editingTarget(event.target) || modalOpen() || !event.clipboardData) return;
  event.preventDefault(); insertTransfer(transferContent(event.clipboardData));
});
$('#copy-selection').addEventListener('click', async () => {
  try { const payload = encodeSelection(history.current, pageId, selectionIds()); if (!navigator.clipboard?.writeText || !window.isSecureContext) throw new Error('This browser cannot use the Copy button here. Select your layers and press Ctrl/Cmd-C.'); await navigator.clipboard.writeText(encodeSelectionText(payload)); toast('Layers copied.'); }
  catch (error) { toast(error.name === 'NotAllowedError' ? 'Your browser blocked clipboard access. Select your layers and press Ctrl/Cmd-C instead.' : error.message || 'Could not copy layers. Use Ctrl/Cmd-C.', true); }
});
$('#paste-content').addEventListener('click', () => runIntake(async request => {
  if (!navigator.clipboard || !window.isSecureContext) throw new Error('This browser cannot use the Paste button here. Click the canvas and press Ctrl/Cmd-V.');
  let text = '', files = [];
  try {
    if (navigator.clipboard.read) {
      const items = await navigator.clipboard.read();
      if (items.length > 20) throw new Error('Paste up to 20 files at a time.');
      const readClipboardText = async (item, type) => { const blob = await item.getType(type); if (blob.size > 12 * 1024 * 1024 + CLIPBOARD_PREFIX.length) throw new Error('The clipboard data is too large. Copy fewer layers or less text.'); return blob.text(); };
      // Native layers take precedence over a raster alternative in both event and button paths.
      for (const item of items) {
        const nativeType = item.types.find(type => type === CLIPBOARD_MIME || type === `web ${CLIPBOARD_MIME}`);
        if (nativeType) return { kind: 'selection', payload: await readClipboardText(item, nativeType) };
      }
      const texts = [];
      for (const item of items) if (item.types.includes('text/plain')) {
        const value = await readClipboardText(item, 'text/plain');
        if (isSelectionText(value)) return { kind: 'selection', payload: value.slice(CLIPBOARD_PREFIX.length) };
        texts.push(value);
      }
      text = texts.join('');
      for (const item of items) {
        const imageType = item.types.find(type => ['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/svg+xml'].includes(type));
        if (imageType) { const blob = await item.getType(imageType); files.push(new File([blob], `clipboard-${files.length + 1}`, { type: imageType })); }
      }
    } else if (navigator.clipboard.readText) text = await navigator.clipboard.readText();
    else throw new Error('This browser cannot read the clipboard here. Click the canvas and press Ctrl/Cmd-V.');
  } catch (error) { if (error.name === 'NotAllowedError') throw new Error('Your browser blocked clipboard access. Click the canvas and press Ctrl/Cmd-V. Your design is unchanged.'); throw error; }
  if (files.length) return prepareFiles(files, { page: request.page, brand: request.brand, signal: request.controller.signal });
  if (isSelectionText(text)) return { kind: 'selection', payload: text.slice(CLIPBOARD_PREFIX.length) };
  return { kind: 'elements', elements: [textElement(text, request.page, request.brand)] };
}, 'Clipboard content'));
$('#copy-page-image').addEventListener('click', async () => {
  const p = structuredClone(page()), outputName = `${filename()}-page-${history.current.pages.findIndex(item => item.id === pageId) + 1}.png`;
  let rasterPromise;
  try {
    if (!navigator.clipboard?.write || !window.ClipboardItem || !window.isSecureContext) throw new Error('unsupported');
    rasterPromise = renderRaster(p);
    rasterPromise.catch(() => {}); // Clipboard construction or permission can fail before the raster settles.
    const item = new ClipboardItem({ 'image/png': rasterPromise }); await navigator.clipboard.write([item]); toast('Page copied as PNG.');
  } catch {
    try { download(await (rasterPromise ?? renderRaster(p)), 'image/png', outputName); toast('Your browser could not copy the image, so we downloaded a PNG instead.'); }
    catch (error) { toast(error.message || 'The image could not be copied or downloaded. Try SVG from Download.', true); }
  }
});
const transferableDrag = data => data && Array.from(data.types ?? []).some(type => ['Files', 'text/plain', 'text/html', 'text/uri-list', CLIPBOARD_MIME].includes(type));
window.addEventListener('dragover', event => { if (transferableDrag(event.dataTransfer) && (!editingTarget(event.target) || Array.from(event.dataTransfer.types).includes('Files'))) { event.preventDefault(); event.dataTransfer.dropEffect = event.target.closest?.('#canvas-area') ? 'copy' : 'none'; } });
$('#canvas-area').addEventListener('dragenter', event => { if (transferableDrag(event.dataTransfer)) { event.preventDefault(); fileDragDepth++; updateIntakeOverlay(); } });
$('#canvas-area').addEventListener('dragleave', event => { if (transferableDrag(event.dataTransfer)) { fileDragDepth = Math.max(0, fileDragDepth - 1); updateIntakeOverlay(); } });
window.addEventListener('drop', event => {
  if (!transferableDrag(event.dataTransfer)) return;
  const files = Array.from(event.dataTransfer.types).includes('Files');
  if (editingTarget(event.target) && !files) return;
  event.preventDefault(); fileDragDepth = 0; updateIntakeOverlay();
  if (!event.target.closest?.('#canvas-area')) { toast('Drop images or text files onto the canvas, or choose Insert files from File.', true); return; }
  let point; const board = $('#artboard'), rect = board.getBoundingClientRect();
  if (event.clientX >= rect.left && event.clientX <= rect.right && event.clientY >= rect.top && event.clientY <= rect.bottom) { const value = svgPoint(event, board.getScreenCTM().inverse()); point = { x: Math.max(0, Math.min(page().width, value.x)), y: Math.max(0, Math.min(page().height, value.y)) }; }
  insertTransfer(transferContent(event.dataTransfer), point);
});
window.addEventListener('dragend', () => { fileDragDepth = 0; updateIntakeOverlay(); });
$('#canvas-area').addEventListener('click', () => { if (editingTarget(document.activeElement)) document.activeElement.blur(); });
function download(content, type, filename) { const url = URL.createObjectURL(new Blob([content], { type })); const anchor = document.createElement('a'); anchor.href = url; anchor.download = filename; document.body.append(anchor); anchor.click(); anchor.remove(); setTimeout(() => URL.revokeObjectURL(url), 2000); }
const filename = () => (history.current.title || 'stencil-design').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80) || 'stencil-design';
$('#save-document').addEventListener('click', () => attempt(() => { download(serialiseDocument(history.current), 'application/json', `${filename()}.stencil.json`); toast('Design downloaded. Open this JSON file in Stencil to keep editing.'); }));
$('#import-document').addEventListener('click', () => $('#document-input').click());
$('#export-svg').addEventListener('click', () => attempt(() => { download(pageSVG(page(), false, true), 'image/svg+xml', `${filename()}-page-${history.current.pages.findIndex(p => p.id === pageId) + 1}.svg`); toast('Current page downloaded as SVG.'); }));
async function renderRaster(p, type = 'image/png') {
  const url = URL.createObjectURL(new Blob([pageSVG(p, false, true)], { type: 'image/svg+xml' })); let image;
  try { image = await new Promise((resolve, reject) => { const img = new Image(); img.onload = () => resolve(img); img.onerror = () => reject(new Error('This page could not be turned into an image. Try SVG from Download.')); img.src = url; }); } finally { URL.revokeObjectURL(url); }
  const canvas = document.createElement('canvas'); canvas.width = Math.round(p.width); canvas.height = Math.round(p.height); const context = canvas.getContext('2d'); if (!context) throw new Error('Your browser could not make the image. Try SVG from Download.'); if (type === 'image/jpeg') { context.fillStyle = p.background; context.fillRect(0, 0, canvas.width, canvas.height); } context.drawImage(image, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise(resolve => canvas.toBlob(resolve, type, .95)); if (!blob) throw new Error('Image export failed. Try SVG instead.');
  const notices = collectAssetNotices(p.elements); return notices.length ? new Blob([appendExportNotices(new Uint8Array(await blob.arrayBuffer()), type, notices)], { type }) : blob;
}
$('#export-png').addEventListener('click', async () => { const button = $('#export-png'); button.disabled = true; try { const p = structuredClone(page()), blob = await renderRaster(p); download(blob, 'image/png', `${filename()}-page-${history.current.pages.findIndex(item => item.id === p.id) + 1}.png`); toast('Current page downloaded as PNG at full size.'); } catch (error) { toast(error.message, true); } finally { button.disabled = false; } });
$('#export-jpg').addEventListener('click', async () => { const button = $('#export-jpg'); button.disabled = true; try { const p = structuredClone(page()); download(await renderRaster(p, 'image/jpeg'), 'image/jpeg', `${filename()}-page-${history.current.pages.findIndex(item => item.id === p.id) + 1}.jpg`); toast('Current page downloaded as JPEG.'); } catch (error) { toast(error.message, true); } finally { button.disabled = false; } });
$('#export-pdf').addEventListener('click', async () => {
  const button = $('#export-pdf'); button.disabled = true; const pages = structuredClone(history.current.pages);
  try { if (pages.reduce((sum, p) => sum + p.width * p.height, 0) > 120000000) throw new Error('This PDF is too large. Try fewer pages or a smaller canvas size.'); const rendered = []; for (const p of pages) { $('#save-status').textContent = `Preparing PDF · ${rendered.length + 1}/${pages.length}`; rendered.push({ width: Math.round(p.width), height: Math.round(p.height), jpeg: new Uint8Array(await (await renderRaster(p, 'image/jpeg')).arrayBuffer()) }); } download(buildPDF(rendered), 'application/pdf', `${filename()}.pdf`); toast('PDF downloaded. It keeps your page layouts as images.'); }
  catch (error) { toast(error.message || 'PDF export failed.', true); } finally { button.disabled = false; $('#save-status').textContent = storageHealthy ? 'Saved on this device' : recoveryPreserved ? 'Not saved. Save JSON' : 'Autosave paused. Save JSON'; }
});
$('#print-design').addEventListener('click', () => attempt(() => { $('#print-pages').innerHTML = history.current.pages.map(p => `<section class="print-page">${pageSVG(p, false, true)}</section>`).join(''); window.print(); }));
function updateSavedStatus() {
  const binding = libraryId && savedBindings.get(libraryId), changed = Boolean(binding && serialiseDocument(history.current) !== binding.baseline);
  $('#library-save-current').textContent = binding ? changed ? 'Save changes' : 'Saved design' : 'Save design';
  $('#library-save-current').disabled = Boolean(binding && !changed);
  $('#open-designs').classList.toggle('has-unsaved-design', changed);
  $('#open-designs').title = changed ? 'Open My designs · named design has changes to save' : 'Open and organise your saved designs';
  $('#saved-designs').querySelectorAll('[data-saved-id]').forEach(card => { const active = card.dataset.savedId === libraryId; card.classList.toggle('current-design', active); const badge = card.querySelector('.saved-design-badge'); badge.hidden = !active; badge.textContent = changed ? 'Open · edited' : 'Open'; });
}
function savedDesignPreview(firstPage, namespace = `preview-${id()}`) {
  const preview = structuredClone(firstPage), groups = new Map();
  preview.id = `${namespace}-page`;
  preview.elements.forEach((element, index) => { element.id = `${namespace}-layer-${index}`; if (element.groupId) { if (!groups.has(element.groupId)) groups.set(element.groupId, `${namespace}-group-${groups.size}`); element.groupId = groups.get(element.groupId); } });
  preview.guides.forEach((guide, index) => { guide.id = `${namespace}-guide-${index}`; });
  return pageSVG(preview, false);
}
function renderLibrary() {
  let records;
  try { records = listDesignSummaries(); }
  catch (error) { $('#saved-designs').textContent = error.message; $('#library-count').textContent = ''; $('#library-status').textContent = 'Your stored designs have been kept. You can still download the open design from File.'; $('#library-status').classList.add('error'); return; }
  const identifiers = new Set(records.map(record => record.id));
  for (const identifier of savedBindings.keys()) if (!identifiers.has(identifier)) savedBindings.delete(identifier);
  if (libraryId && !identifiers.has(libraryId)) { libraryId = null; historyBindings.set(history.current, null); keepActiveBinding(); }
  const externalChange = Boolean(libraryId && records.find(record => record.id === libraryId)?.updatedAt !== savedBindings.get(libraryId)?.updatedAt);
  const query = $('#design-search').value.trim().toLocaleLowerCase();
  const visible = records.filter(record => record.name.toLocaleLowerCase().includes(query));
  if ($('#design-sort').value === 'name') visible.sort((a, b) => a.name.localeCompare(b.name) || a.updatedAt.localeCompare(b.updatedAt));
  $('#library-count').textContent = `${records.length} / 20`;
  $('#library-status').classList.remove('error');
  $('#library-status').textContent = externalChange ? 'This design changed in another tab. Your open draft stays here. Save a copy to keep your edits, or open the latest version.' : query ? `${visible.length} ${visible.length === 1 ? 'design' : 'designs'} found.` : records.length ? 'Open a design to carry on where you left off.' : 'Save a named design, or open a Stencil JSON file from your device.';
  $('#saved-designs').innerHTML = visible.length ? visible.map(record => `<article class="saved-design" data-saved-id="${safe(record.id)}"><button class="saved-open" data-open-design="${safe(record.id)}" aria-label="Open ${safe(record.name)}"><span class="saved-design-preview" aria-hidden="true">${savedDesignPreview(record.firstPage)}</span><span class="saved-design-title">${safe(record.name)}</span><span class="saved-design-badge" hidden>Open</span><span class="saved-design-meta">${record.pageCount} ${record.pageCount === 1 ? 'page' : 'pages'} · ${record.firstPage.width} × ${record.firstPage.height} px</span><span class="saved-design-date">Saved ${safe(new Date(record.updatedAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }))}</span><span class="saved-open-label">Open design <span aria-hidden="true">↗</span></span></button><div class="saved-design-actions"><button data-rename-design="${safe(record.id)}" aria-label="Rename ${safe(record.name)}">Rename</button><button data-copy-design="${safe(record.id)}" aria-label="Duplicate ${safe(record.name)}">Duplicate</button><button data-delete-design="${safe(record.id)}" class="danger" aria-label="Delete ${safe(record.name)}">Delete</button></div></article>`).join('') : `<div class="design-empty"><span aria-hidden="true">▧</span><strong>${query ? 'No matching designs' : 'Your designs belong here'}</strong><p>${query ? 'Try another name or clear your search.' : 'Give your canvas a name and save it to come back to it later.'}</p></div>`;
  $('#saved-designs').querySelectorAll('[data-open-design]').forEach(button => button.addEventListener('click', async () => {
    try {
      const identifier = button.dataset.openDesign; loadDesign(identifier);
      if (editingTarget(document.activeElement)) document.activeElement.blur();
      const state = captureDesignState(); await preserveCurrentDesign(); requireDesignState(state, false);
      const record = listDesigns().find(item => item.id === identifier);
      if (!record) throw new Error('This saved design was removed in another tab. Your current design is still open.');
      const openedDocument = loadDesign(identifier);
      savedBindings.set(identifier, { updatedAt: record.updatedAt, baseline: serialiseDocument(openedDocument) });
      const saved = openDocument(openedDocument, identifier); renderLibrary();
      if (saved) toast('Design opened. Your previous work is kept in My designs.');
    } catch (error) { toast(error.message, true); }
  }));
  $('#saved-designs').querySelectorAll('[data-rename-design]').forEach(button => button.addEventListener('click', () => attempt(() => { const record = listDesigns().find(item => item.id === button.dataset.renameDesign); if (!record) throw new Error('That design was removed in another tab. Refresh My designs.'); openDesignName({ mode: 'rename', id: record.id, updatedAt: record.updatedAt, name: record.name }); })));
  $('#saved-designs').querySelectorAll('[data-copy-design]').forEach(button => button.addEventListener('click', async () => {
    button.disabled = true;
    try { const source = records.find(record => record.id === button.dataset.copyDesign); const record = await withLibraryLock(() => duplicateDesign(source.id, undefined, { expectedUpdatedAt: source.updatedAt })); renderLibrary(); toast(`“${record.name}” is ready in My designs.`); }
    catch (error) { toast(error.message, true); } finally { button.disabled = false; }
  }));
  $('#saved-designs').querySelectorAll('[data-delete-design]').forEach(button => button.addEventListener('click', async () => {
    const record = records.find(item => item.id === button.dataset.deleteDesign);
    if (!window.confirm(`Delete “${record.name}” from My designs? This cannot be undone. The design on your canvas stays open.`)) return;
    button.disabled = true;
    try { await withLibraryLock(() => deleteDesign(record.id, undefined, { expectedUpdatedAt: record.updatedAt })); savedBindings.delete(record.id); if (libraryId === record.id) { libraryId = null; historyBindings.set(history.current, null); keepActiveBinding(); } renderLibrary(); toast('Saved design deleted.'); }
    catch (error) { toast(error.message, true); } finally { button.disabled = false; }
  }));
  updateSavedStatus();
  if (externalChange) { const badge = $('#saved-designs').querySelector('.current-design .saved-design-badge'); if (badge) { badge.hidden = false; badge.textContent = 'Changed elsewhere'; } }
}
function openDesignName(options = {}) {
  if (editingTarget(document.activeElement)) document.activeElement.blur();
  drag = null; cancelIntake('Insertion cancelled. You opened the design name window.'); renderCanvas();
  const mode = options.mode ?? 'save', binding = libraryId && savedBindings.get(libraryId);
  designNameTarget = { ...options, mode, state: captureDesignState(), ...(mode === 'save' && binding ? { id: libraryId, updatedAt: binding.updatedAt } : {}) };
  const currentName = history.current.title.trim() || 'Untitled design';
  $('#design-name-heading').textContent = mode === 'rename' ? 'Rename your design' : mode === 'copy' ? 'Save a new copy' : binding ? 'Save your changes' : 'Save your design';
  $('#design-name').value = mode === 'rename' ? options.name : mode === 'copy' ? `${currentName.slice(0, 145)} copy` : currentName;
  $('#design-name-hint').textContent = mode === 'rename' ? 'The saved design and its title will use this name.' : mode === 'copy' ? 'Your original saved design stays as it is.' : binding ? 'Update this named design in My designs.' : 'Find it again in My designs on this device.';
  $('#design-name-save').textContent = mode === 'rename' ? 'Rename design' : mode === 'copy' ? 'Save a copy' : 'Save design';
  $('#design-name-error').textContent = ''; $('#design-name-dialog').showModal(); $('#design-name').focus(); $('#design-name').select();
}
$('#design-name-form').addEventListener('submit', async event => {
  event.preventDefault(); const target = designNameTarget; if (!target || $('#design-name-save').disabled) return;
  $('#design-name-save').disabled = true;
  try {
    const name = $('#design-name').value.trim();
    if (!name) throw new Error('Give your design a name.');
    const requireTarget = () => { if (target !== designNameTarget || !$('#design-name-dialog').open) throw new Error('Saving was cancelled. Your design is still open.'); requireDesignState(target.state); };
    if (target.mode === 'rename') {
      const record = await withLibraryLock(() => { requireTarget(); return renameDesign(target.id, name, undefined, { expectedUpdatedAt: target.updatedAt }); });
      requireDesignState(target.state);
      const active = libraryId === target.id;
      savedBindings.set(record.id, { updatedAt: record.updatedAt, baseline: serialiseDocument(record.document) });
      if (active) { commit({ ...history.current, title: name }); keepActiveBinding(); }
      $('#design-name-dialog').close(); renderLibrary(); if (storageHealthy) toast('Design renamed.');
    } else {
      const document = { ...parseDocument(target.state.document), title: name };
      const record = await withLibraryLock(() => { requireTarget(); return saveDesign(document, { name, ...(target.id && target.mode !== 'copy' ? { id: target.id, expectedUpdatedAt: target.updatedAt } : {}) }); });
      requireDesignState(target.state);
      rememberSaved(record); if (history.current.title !== name) commit(document); else updateSavedStatus();
      $('#design-name-dialog').close(); renderLibrary();
      toast(storageHealthy ? target.mode === 'copy' ? 'Your new copy is saved in My designs.' : 'Design saved in My designs.' : 'Your named design is saved in My designs. The open draft could not autosave; download JSON before refreshing.', !storageHealthy);
    }
  } catch (error) { if (target === designNameTarget && $('#design-name-dialog').open) $('#design-name-error').textContent = error.message; else toast(error.message, true); }
  finally { $('#design-name-save').disabled = false; }
});
$('#design-name-dialog').addEventListener('close', () => { designNameTarget = null; });
for (const selector of ['#save-to-library', '#library-save-current']) $(selector).addEventListener('click', () => openDesignName());
$('#library-save-copy').addEventListener('click', () => openDesignName({ mode: 'copy' }));
for (const selector of ['#open-designs', '#browse-designs']) $(selector).addEventListener('click', () => { switchLibrary('library'); $('#library-tab').focus(); });
$('#library-open-file').addEventListener('click', () => $('#document-input').click());
$('#design-search').addEventListener('input', renderLibrary); $('#design-sort').addEventListener('change', renderLibrary);
window.addEventListener('storage', event => { if (event.key === LIBRARY_KEY && !$('#library-panel').hidden) renderLibrary(); });
$('#export-library').addEventListener('click', () => attempt(() => { download(exportLibrary(), 'application/json', 'stencil-studio-library.json'); toast('My designs backup downloaded.'); })); $('#import-library').addEventListener('click', () => $('#library-input').click());
$('#library-input').addEventListener('change', async event => { const file = event.target.files?.[0]; event.target.value = ''; if (!file) return; try { if (file.size > 18 * 1024 * 1024) throw new Error('Choose a library backup under 18 MB.'); const payload = await file.text(); await withLibraryLock(() => importLibrary(payload)); renderLibrary(); toast('Backup added to My designs. Your existing designs were kept.'); } catch (error) { toast(error.message, true); } });
$('#bulk-create').addEventListener('click', () => $('#bulk-dialog').showModal()); $('#load-csv').addEventListener('click', () => $('#csv-input').click());
$('#csv-input').addEventListener('change', async event => { const file = event.target.files?.[0]; event.target.value = ''; if (!file) return; try { if (file.size > 1024 * 1024) throw new Error('Choose a CSV file up to 1 MB.'); $('#bulk-csv').value = await file.text(); } catch (error) { toast(error.message, true); } });
$('#create-bulk-pages').addEventListener('click', () => attempt(() => { const next = bulkCreate(history.current, pageId, $('#bulk-csv').value); const saved = openDocument(next); $('#bulk-dialog').close(); if (saved) toast(`${next.pages.length} pages created from CSV. Undo restores your previous design.`); }));
function openDataEditor(kind, element = null) {
  if (cloudSession?.role === 'view') { toast('This shared design is view-only.', true); return; }
  if (element && effectivelyLocked(element)) { toast('Unlock this layer before editing its data.', true); return; }
  dataTool = kind; dataDraft = structuredClone(element ?? createElement(kind, { fontFamily: history.current.brand.fontFamily, ...(kind === 'chart' ? { palette: history.current.brand.colours } : {}) }));
  dataTarget = { pageId, elementId: element?.id ?? null }; dataCSVDirty = false;
  $('#data-tool-heading').textContent = `${element ? 'Edit' : 'Add'} ${kind === 'table' ? 'a table' : 'a chart'}`;
  $('#data-tool-hint').textContent = kind === 'table' ? 'Fill in the cells, then save. You can use up to 8 columns and 50 rows, and change them later with Edit data.' : 'Add labels and values of zero or more, then choose a chart type. Choose Edit data to change them later.';
  $('#chart-kind-field').hidden = kind !== 'chart'; if (kind === 'chart') $('#chart-kind').value = dataDraft.data.kind;
  $('#data-add-column').hidden = $('#data-remove-column').hidden = kind !== 'table';
  $('#create-data-tool').textContent = `${element ? 'Update' : 'Create'} ${kind}`; $('#data-csv-panel').open = false;
  renderDataGrid(); $('#table-dialog').showModal();
}
function syncDataCSV() { const original = serialiseDataCSV(dataTool, dataDraft.data); $('#tool-csv').value = original; dataCSVBaseline = { original, normalised: $('#tool-csv').value }; dataCSVDirty = false; }
function renderDataGrid() {
  const data = dataDraft.data, columns = dataTool === 'table' ? data.columns : ['Label', 'Value'], rows = dataTool === 'table' ? data.rows : data.labels.map((label, index) => [label, data.values[index]]);
  $('#data-grid').innerHTML = `<table><thead><tr>${columns.map((column, index) => `<th>${dataTool === 'table' ? `<textarea data-column="${index}" aria-label="Column ${index + 1} name" maxlength="100" rows="${/[\r\n]/.test(column) ? 2 : 1}">${safe(column)}</textarea>` : safe(column)}</th>`).join('')}<th><span class="sr-only">Remove row</span></th></tr></thead><tbody>${rows.map((row, rowIndex) => `<tr>${row.map((value, colIndex) => `<td>${dataTool === 'chart' && colIndex === 1 ? `<input data-cell-row="${rowIndex}" data-cell-column="${colIndex}" aria-label="Row ${rowIndex + 1}, Value" type="number" min="0" max="1000000000" step="any" value="${safe(value ?? '')}">` : `<textarea data-cell-row="${rowIndex}" data-cell-column="${colIndex}" aria-label="Row ${rowIndex + 1}, ${safe(columns[colIndex])}" maxlength="${dataTool === 'chart' ? 100 : 1000}" rows="${/[\r\n]/.test(String(value)) ? 2 : 1}">${safe(value)}</textarea>`}</td>`).join('')}<td><button data-remove-row="${rowIndex}" aria-label="Remove row ${rowIndex + 1}"${dataTool === 'chart' && rows.length === 1 ? ' disabled' : ''}>×</button></td></tr>`).join('')}</tbody></table>`;
  const literalValues = new WeakMap();
  // Preserve exact retained strings when the textarea's normalised display is unchanged.
  $('#data-grid').querySelectorAll('textarea').forEach(input => {
    const original = input.dataset.column !== undefined ? data.columns[Number(input.dataset.column)] : dataTool === 'table' ? data.rows[Number(input.dataset.cellRow)][Number(input.dataset.cellColumn)] : data.labels[Number(input.dataset.cellRow)];
    input.value = original; literalValues.set(input, { original, normalised: input.value });
  });
  $('#data-grid').querySelectorAll('input,textarea').forEach(input => input.addEventListener('input', () => {
    const literal = literalValues.get(input), value = literal && input.value === literal.normalised ? literal.original : input.value;
    if (input.dataset.column !== undefined) data.columns[Number(input.dataset.column)] = value;
    else { const row = Number(input.dataset.cellRow), col = Number(input.dataset.cellColumn); if (dataTool === 'table') data.rows[row][col] = value; else if (col === 0) data.labels[row] = value; else data.values[row] = input.value.trim() === '' ? null : Number(input.value); }
    syncDataCSV();
  }));
  $('#data-grid').querySelectorAll('[data-remove-row]').forEach(button => button.addEventListener('click', () => { const row = Number(button.dataset.removeRow); if (dataTool === 'table') data.rows.splice(row, 1); else { data.labels.splice(row, 1); data.values.splice(row, 1); } renderDataGrid(); }));
  $('#data-add-row').disabled = rows.length >= (dataTool === 'table' ? 50 : 30); $('#data-add-column').disabled = columns.length >= 8; $('#data-remove-column').disabled = columns.length <= 1;
  $('#data-editor-status').textContent = `${rows.length} rows${dataTool === 'table' ? ` · ${columns.length} columns` : ''}`; syncDataCSV();
}
function loadDataCSV() { const csv = $('#tool-csv').value === dataCSVBaseline?.normalised ? dataCSVBaseline.original : $('#tool-csv').value, parsed = parseDataCSV(csv, dataTool); dataDraft.data = dataTool === 'table' ? parsed : { ...parsed, kind: $('#chart-kind').value }; renderDataGrid(); }
for (const kind of ['table', 'chart']) $(`#add-${kind}`).addEventListener('click', () => attempt(() => openDataEditor(kind)));
$('#tool-csv').addEventListener('input', () => { dataCSVDirty = $('#tool-csv').value !== dataCSVBaseline?.normalised; }); $('#load-data-csv').addEventListener('click', () => attempt(loadDataCSV));
$('#chart-kind').addEventListener('change', event => { dataDraft.data.kind = event.target.value; });
$('#data-add-row').addEventListener('click', () => { if (dataTool === 'table') dataDraft.data.rows.push(dataDraft.data.columns.map(() => '')); else { dataDraft.data.labels.push(`Item ${dataDraft.data.labels.length + 1}`); dataDraft.data.values.push(0); } renderDataGrid(); });
$('#data-add-column').addEventListener('click', () => { dataDraft.data.columns.push(`Column ${dataDraft.data.columns.length + 1}`); dataDraft.data.rows.forEach(row => row.push('')); renderDataGrid(); });
$('#data-remove-column').addEventListener('click', () => { dataDraft.data.columns.pop(); dataDraft.data.rows.forEach(row => row.pop()); renderDataGrid(); });
$('#create-data-tool').addEventListener('click', () => attempt(() => {
  if (dataCSVDirty) loadDataCSV();
  if (dataTarget.pageId !== pageId) throw new Error('You switched pages. Open Edit data again before saving.');
  let next, elementId = dataTarget.elementId;
  if (elementId) {
    const target = page().elements.find(element => element.id === elementId); if (!target || effectivelyLocked(target)) throw new Error('This table or chart has gone or is locked. Select it and open Edit data again.');
    const fields = dataTool === 'table' ? TABLE_FIELDS : CHART_FIELDS; next = updateElement(history.current, pageId, elementId, Object.fromEntries(fields.map(field => [field, dataDraft[field]])));
  } else {
    const p = page(), element = createElement(dataTool, { ...dataDraft, x: p.width * .1, y: p.height * .12, width: p.width * .8, height: Math.min(p.height * .65, 400) }); elementId = element.id; next = editPage(history.current, pageId, updated => updated.elements.push(element));
  }
  selection = new Set([elementId]); const saved = commit(next); $('#table-dialog').close(); if (saved) toast(`${dataTool === 'table' ? 'Table' : 'Chart'} ${dataTarget.elementId ? 'updated' : 'created'}. Choose Edit data to change the values later.`);
}));
function renderSlide() { const p = history.current.pages[presentationIndex]; $('#slide-art').innerHTML = pageSVG(p); $('#slide-name').textContent = p.name || history.current.title; $('#slide-number').textContent = `${presentationIndex + 1} / ${history.current.pages.length}`; $('#previous-slide').disabled = presentationIndex === 0; $('#next-slide').disabled = presentationIndex === history.current.pages.length - 1; }
function changeSlide(direction) { presentationIndex = Math.max(0, Math.min(history.current.pages.length - 1, presentationIndex + direction)); renderSlide(); }
$('#present-design').addEventListener('click', () => { presentationIndex = history.current.pages.findIndex(p => p.id === pageId); renderSlide(); $('#presentation-dialog').showModal(); }); $('#previous-slide').addEventListener('click', () => changeSlide(-1)); $('#next-slide').addEventListener('click', () => changeSlide(1));
$('#close-presentation').addEventListener('click', async () => { if (document.fullscreenElement) await document.exitFullscreen(); $('#presentation-dialog').close(); }); $('#fullscreen-presentation').addEventListener('click', () => attempt(() => $('#presentation-dialog').requestFullscreen?.().catch(() => toast('Full screen is unavailable in this browser.', true))));
$('#video-design').addEventListener('click', async () => {
  videoSessionGeneration++; videoPreviewGeneration++; videoPreviewController?.abort(); videoPreviewController = null; videoPreview?.stop(); videoPreview = null; $('#video-preview-start').disabled = false;
  $('#scene-durations').innerHTML = history.current.pages.map((p, index) => `<label class="property-field"><span>Page ${index + 1} · ${safe(p.name || 'Untitled page')} (seconds)</span><input data-scene-index="${index}" type="number" min=".25" max="30" step=".25" value="3"></label>`).join('');
  $('#video-dialog').showModal(); try { const { getVideoSupport } = await import('./video.js'), support = getVideoSupport(); $('#video-status').textContent = support.supported ? `Video format: ${support.mime}. Export takes about as long as your video. Keep this tab open. Export when ready. Timing settings are not saved with the design.` : support.reason; $('#video-export').disabled = !support.supported; } catch (error) { $('#video-status').textContent = error.message; $('#video-export').disabled = true; }
});
$('#video-export').addEventListener('click', async () => {
  if (videoController) return; const controller = new AbortController(), sessionGeneration = videoSessionGeneration, exportDocument = structuredClone(history.current), exportName = filename(); videoController = controller; $('#video-export').disabled = true; $('#video-cancel').disabled = false;
  try { const credits = assetCredits(exportDocument.pages.flatMap(p => p.elements)); const { exportTimeline } = await import('./video.js'); const sceneSeconds = [...$('#scene-durations').querySelectorAll('input')].map(input => Number(input.value)); const result = await exportTimeline(exportDocument, { sceneSeconds, transition: $('#video-transition').value, fps: 30, signal: controller.signal, ...($('#video-audio').files?.[0] ? { audioSrc: $('#video-audio').files[0] } : {}), onProgress: progress => { if (videoSessionGeneration !== sessionGeneration || !$('#video-dialog').open) return; if (typeof progress === 'number') $('#video-status').textContent = `Exporting video · ${Math.round(progress * 100)}%`; else $('#video-status').textContent = `${progress?.phase === 'preparing' ? 'Preparing pages' : 'Exporting video'}${Number.isFinite(progress?.progress) ? ` · ${Math.round(progress.progress * 100)}%` : '…'}`; } }); if (controller.signal.aborted || !$('#video-dialog').open || videoSessionGeneration !== sessionGeneration) return; if (videoURL) URL.revokeObjectURL(videoURL); videoURL = URL.createObjectURL(result.blob); $('#video-result').innerHTML = `<video controls src="${safe(videoURL)}" aria-label="Slideshow preview"></video>`; download(result.blob, result.mime, `${exportName}.${result.extension}`); if (videoCreditsURL) { URL.revokeObjectURL(videoCreditsURL); videoCreditsURL = null; } if (credits.length) { const content = credits.map(record => `${record.collection}\n${record.source}\n${record.license}\n\n${record.notice}`).join('\n\n'); videoCreditsURL = URL.createObjectURL(new Blob([content], { type: 'text/plain;charset=utf-8' })); const note = document.createElement('p'), link = document.createElement('a'); link.href = videoCreditsURL; link.download = `${exportName}-asset-credits.txt`; link.textContent = 'Download asset credits'; note.append(link, document.createTextNode(' · Keep these credits with the video.')); $('#video-result').append(note); } $('#video-status').textContent = 'Your video has downloaded. Play it below.'; }
  catch (error) { if (videoSessionGeneration === sessionGeneration) $('#video-status').textContent = controller.signal.aborted ? 'Video export cancelled.' : error.message || 'The video could not be exported. Try again with this tab open.'; }
  finally { if (videoController === controller) videoController = null; if (videoSessionGeneration === sessionGeneration) { $('#video-export').disabled = false; $('#video-cancel').disabled = true; } }
});
$('#video-cancel').addEventListener('click', () => videoController?.abort());
$('#video-preview-start').addEventListener('click', async () => {
  const button = $('#video-preview-start'), generation = ++videoPreviewGeneration, sessionGeneration = videoSessionGeneration, controller = new AbortController();
  videoPreviewController?.abort(); videoPreviewController = controller; button.disabled = true; videoPreview?.stop(); videoPreview = null;
  const current = () => generation === videoPreviewGeneration && sessionGeneration === videoSessionGeneration && !controller.signal.aborted && $('#video-dialog').open;
  try { const { previewTimeline } = await import('./video.js'); const sceneSeconds = [...$('#scene-durations').querySelectorAll('input')].map(input => Number(input.value)); const preview = await previewTimeline(history.current, { canvas: $('#video-live-preview'), sceneSeconds, transition: $('#video-transition').value, fps: 30, signal: controller.signal, onProgress: progress => { if (current() && progress.phase === 'preview') $('#video-seek').value = progress.seconds / progress.duration * 100; } }); if (!current()) { preview.stop(); return; } videoPreview = preview; $('#video-live-preview').hidden = false; $('#video-preview-play').disabled = false; $('#video-preview-pause').disabled = false; $('#video-seek').disabled = false; $('#video-status').textContent = 'Preview ready. Your audio will be added when you export.'; }
  catch (error) { if (current()) $('#video-status').textContent = error.message || 'The preview could not be loaded. Try again.'; } finally { if (current()) button.disabled = false; }
});
$('#video-preview-play').addEventListener('click', () => videoPreview?.play()); $('#video-preview-pause').addEventListener('click', () => videoPreview?.pause()); $('#video-seek').addEventListener('input', event => videoPreview?.seek(Number(event.target.value) / 100 * videoPreview.duration));
$('#video-dialog').addEventListener('close', () => { videoSessionGeneration++; videoPreviewGeneration++; videoController?.abort(); videoPreviewController?.abort(); videoPreviewController = null; videoPreview?.stop(); videoPreview = null; $('#video-live-preview').hidden = true; $('#video-preview-play').disabled = true; $('#video-preview-pause').disabled = true; $('#video-seek').disabled = true; $('#video-result video')?.pause(); if (videoCreditsURL) { URL.revokeObjectURL(videoCreditsURL); videoCreditsURL = null; } if (videoURL) { URL.revokeObjectURL(videoURL); videoURL = null; $('#video-result').innerHTML = ''; } });
async function getCloudClient() { if (!cloudClient) { const module = await import('./cloud-client.mjs'); cloudClient = module.createCloudClient({ baseURL: '/api/workspaces' }); } return cloudClient; }
function cloudDirty() { const active = document.activeElement, editing = active?.matches('input,textarea,select') && (active.id === 'document-title' || active.closest('#properties,#table-dialog,#guides-dialog,.page-order')); return cloudBaseline !== null && (Boolean(editing) || Boolean(drag) || Boolean(intakeActive) || $('#table-dialog').open || $('#guides-dialog').open || serialiseDocument(history.current) !== cloudBaseline); }
async function openCloudSnapshot(snapshot, token) {
  cancelIntake('Insertion cancelled because the shared design changed.');
  if (snapshot.workspace.kind !== 'stencil-studio') throw new Error('This link belongs to another app.');
  const valid = validateDocument(snapshot.workspace.document), unchanged = serialiseDocument(valid) === serialiseDocument(history.current); cloudSession = { ...snapshot, token }; cloudBaseline = serialiseDocument(valid); cloudPending = null; if (!unchanged || !valid.pages.some(p => p.id === pageId)) { pageId = valid.pages[0].id; selection.clear(); fit = true; } libraryId = null; closePageTools(); drag = null;
  commit(valid, { fromCloud: true }); render(); await renderCloud(); startCloudWatch();
}
async function renderCloud() {
  $('#cloud-session').hidden = !cloudSession; $('#cloud-create-actions').hidden = Boolean(cloudSession); if (!cloudSession) return;
  const session = cloudSession, generation = cloudGeneration, { workspace, role } = session;
  const active = () => cloudSession === session && cloudGeneration === generation;
  $('#cloud-role').textContent = `${workspace.title} · ${role} access · version ${workspace.revision}`; $('#cloud-save').disabled = role === 'view'; $('#cloud-add-comment').disabled = role === 'view';
  $('#cloud-status').textContent = cloudPending ? 'Someone has updated this shared design. Your edits are still here. Refresh to see their changes.' : `Connected to the shared design. ${cloudDirty() ? 'You have changes to save.' : 'You are up to date.'}`;
  const { shareLink } = await import('./cloud-client.mjs'); if (!active()) return;
  let links = `<label class="property-field"><span>Your ${safe(role)} access link</span><input readonly aria-label="Current access link" value="${safe(shareLink({ id: workspace.id, token: session.token, baseURL: location.href }))}"></label>`;
  if (role === 'owner') for (const permission of ['edit', 'view']) links += `<div class="permission-row"><strong>${permission === 'edit' ? 'Editors' : 'Viewers'}</strong><span>${workspace.permissions[permission] ? 'On' : 'Off'}</span><button data-permission="${permission}" data-enabled="${!workspace.permissions[permission]}" class="quiet-button">${workspace.permissions[permission] ? 'Turn off access' : 'Create a new link'}</button></div>${session.tokens?.[permission] && workspace.permissions[permission] ? `<label class="property-field"><span>${permission} access link</span><input readonly aria-label="${permission} access link" value="${safe(shareLink({ id: workspace.id, token: session.tokens[permission], baseURL: location.href }))}"></label>` : ''}`;
  $('#cloud-permissions').innerHTML = links;
  $('#cloud-permissions').querySelectorAll('[data-permission]').forEach(button => button.addEventListener('click', async () => { try { const result = await (await getCloudClient()).setPermission({ id: workspace.id, token: session.token, baseRevision: session.workspace.revision, role: button.dataset.permission, enabled: button.dataset.enabled === 'true' }); if (!active()) return; session.workspace = result.workspace; session.role = result.role; session.tokens ??= {}; session.tokens[button.dataset.permission] = result.share.token; await renderCloud(); } catch (error) { if (active()) cloudError(error); } }));
  try { const comments = await (await getCloudClient()).comments({ id: workspace.id, token: session.token }); if (!active()) return; $('#cloud-comments').innerHTML = comments.comments.map(comment => `<article class="shared-comment"><strong>${safe(comment.author)}</strong><p>${safe(comment.text)}</p><small>${safe(new Date(comment.createdAt).toLocaleString())}</small></article>`).join('') || '<p class="panel-hint">No comments yet.</p>'; } catch (error) { if (active()) $('#cloud-comments').textContent = error.message; }
  if (!active()) return;
  if (role === 'view') $('#cloud-revisions').innerHTML = '<p class="panel-hint">Only owners and editors can open saved versions.</p>';
  else try { const result = await (await getCloudClient()).revisions({ id: workspace.id, token: session.token }); if (!active()) return; $('#cloud-revisions').innerHTML = result.revisions.slice().reverse().map(revision => `<button class="revision-button" data-restore-revision="${revision.revision}">Version ${revision.revision} · ${safe(revision.title)}</button>`).join(''); $('#cloud-revisions').querySelectorAll('[data-restore-revision]').forEach(button => button.addEventListener('click', () => { if (!active()) return; const revision = result.revisions.find(r => r.revision === Number(button.dataset.restoreRevision)); if (window.confirm('Open this saved version? Choose Save shared changes afterwards to share it as a new version.')) attempt(() => { const valid = validateDocument(revision.document); pageId = valid.pages[0].id; selection.clear(); commit(valid); }); })); } catch (error) { if (active()) $('#cloud-revisions').textContent = error.message; }
}
function cloudError(error) { if (error.status === 409) { cloudPending = error.workspace ?? error.current; $('#cloud-status').textContent = 'Someone saved changes before you. Your edits are still here. Refresh to see their version before saving yours.'; } else $('#cloud-status').textContent = error.message || 'The shared design could not be updated. Try again.'; toast(error.message || 'Sharing didn’t work. Try again.', true); }
function startCloudWatch() {
  cloudStop?.(); cloudStop = null; if (!cloudSession) return;
  const session = cloudSession, generation = cloudGeneration;
  getCloudClient().then(client => {
    if (cloudSession !== session || cloudGeneration !== generation) return;
    cloudStop = client.watch({ id: session.workspace.id, token: session.token, revision: session.workspace.revision, intervalMs: 2500, onChange: async snapshot => {
      if (cloudSession !== session || cloudGeneration !== generation) return;
      try { validateDocument(snapshot.workspace.document); if (cloudDirty()) { cloudPending = snapshot; $('#cloud-status').textContent = 'Someone updated the shared design. Your edits are still here until you choose Refresh.'; } else await openCloudSnapshot({ ...snapshot, tokens: session.tokens }, session.token); } catch (error) { if (cloudGeneration === generation) cloudError(error); }
    }, onError: error => { if (cloudSession === session && cloudGeneration === generation) cloudError(error); } });
  });
}
async function keepReturnedWorkspace(snapshot, token) {
  const { shareLink } = await import('./cloud-client.mjs'), node = $('#cloud-returned-workspace');
  node.hidden = false; node.innerHTML = `<p class="panel-hint">A shared design was created. Your newer edits are still open here. Keep this owner link to open the shared copy.</p><label class="property-field"><span>Owner link for the shared copy</span><input readonly value="${safe(shareLink({ id: snapshot.workspace.id, token, baseURL: location.href }))}"></label><button id="cloud-open-returned" class="quiet-button">Open shared copy</button>`;
  $('#cloud-open-returned').addEventListener('click', async () => { if (!window.confirm('Open the shared copy instead of this design? Choose File → Save JSON first if you want to keep this one.')) return; cloudGeneration++; await openCloudSnapshot(snapshot, token); node.hidden = true; });
}
async function connectSharedLink() {
  const generation = cloudGeneration, before = serialiseDocument(history.current);
  try { const module = await import('./cloud-client.mjs'), access = module.readShareLink(location.href); if (!access) return; const snapshot = await (await getCloudClient()).open(access); if (cloudGeneration !== generation) return; if (serialiseDocument(history.current) !== before && !window.confirm('The shared design is ready, but you have made new edits here. Replace them with the shared design?')) return; await openCloudSnapshot(snapshot, access.token); toast(`Shared design opened with ${snapshot.role} access.`); } catch (error) { if (cloudGeneration === generation) toast(error.message || 'The shared design could not be opened.', true); }
}
$('#share-design').addEventListener('click', async () => { $('#share-dialog').showModal(); if (cloudSession) { await renderCloud(); return; } try { const status = await (await getCloudClient()).status(); $('#cloud-create').disabled = !status.enabled; $('#cloud-status').textContent = status.enabled ? 'Sharing is ready. Create a shared design, then choose who can edit or view it.' : 'Sharing is not set up here. You can still save your design on this device or download it.'; } catch (error) { $('#cloud-status').textContent = error.message || 'The sharing server is not available. Try again later.'; } });
$('#cloud-create').addEventListener('click', async () => {
  const generation = cloudGeneration, requested = serialiseDocument(history.current); $('#cloud-create').disabled = true;
  try {
    const result = await (await getCloudClient()).create({ kind: 'stencil-studio', title: parseDocument(requested).title || 'Untitled design', document: parseDocument(requested) });
    if (cloudGeneration !== generation || cloudSession) { await keepReturnedWorkspace(result, result.tokens.owner); return; }
    if (Boolean(drag) || serialiseDocument(history.current) !== requested) { cloudSession = { ...result, token: result.tokens.owner }; cloudBaseline = serialiseDocument(validateDocument(result.workspace.document)); cloudPending = null; await renderCloud(); startCloudWatch(); toast('Shared design created. Your newer edits are still here; save again to share them.'); }
    else await openCloudSnapshot(result, result.tokens.owner);
  } catch (error) { if (cloudGeneration === generation) cloudError(error); } finally { $('#cloud-create').disabled = false; }
});
$('#cloud-save').addEventListener('click', async () => {
  const session = cloudSession, generation = cloudGeneration; if (!session) return; const requested = serialiseDocument(history.current); $('#cloud-save').disabled = true;
  try {
    const result = await (await getCloudClient()).update({ id: session.workspace.id, token: session.token, baseRevision: session.workspace.revision, document: parseDocument(requested), title: parseDocument(requested).title || 'Untitled design' });
    if (cloudGeneration !== generation || cloudSession !== session) return;
    if (Boolean(drag) || serialiseDocument(history.current) !== requested) { cloudSession = { ...result, token: session.token, tokens: session.tokens }; cloudBaseline = serialiseDocument(validateDocument(result.workspace.document)); cloudPending = null; await renderCloud(); startCloudWatch(); toast('Shared design saved. Your newer edits are still here; save again to share them.'); }
    else { await openCloudSnapshot({ ...result, tokens: session.tokens }, session.token); toast('Shared design saved to the server.'); }
  } catch (error) { if (cloudGeneration === generation && cloudSession === session) cloudError(error); } finally { $('#cloud-save').disabled = cloudSession?.role === 'view'; }
});
$('#cloud-refresh').addEventListener('click', async () => {
  const session = cloudSession, generation = cloudGeneration; if (!session) return; const before = serialiseDocument(history.current);
  if (cloudDirty() && !window.confirm('Replace your edits with the latest shared version? Choose File → Save JSON first to keep a copy of your edits.')) return;
  try { const snapshot = await (await getCloudClient()).open({ id: session.workspace.id, token: session.token }); if (cloudGeneration !== generation || cloudSession !== session) return; if ((Boolean(drag) || serialiseDocument(history.current) !== before) && !window.confirm('You made new edits while this was loading. Replace them with the shared version?')) { cloudPending = snapshot; $('#cloud-status').textContent = 'Your newer edits are still here. Refresh again when you are ready to open the shared version.'; return; } await openCloudSnapshot({ ...snapshot, tokens: session.tokens }, session.token); } catch (error) { if (cloudGeneration === generation && cloudSession === session) cloudError(error); }
});
$('#cloud-add-comment').addEventListener('click', async () => {
  const session = cloudSession, generation = cloudGeneration; if (!session) return;
  try { const result = await (await getCloudClient()).addComment({ id: session.workspace.id, token: session.token, baseRevision: session.workspace.revision, text: $('#cloud-comment').value, author: $('#cloud-author').value }); if (cloudGeneration !== generation || cloudSession !== session) return; session.workspace = result.workspace; session.role = result.role; $('#cloud-comment').value = ''; await renderCloud(); } catch (error) { if (cloudGeneration === generation && cloudSession === session) cloudError(error); }
});
$('#cloud-disconnect').addEventListener('click', () => { cloudGeneration++; cloudStop?.(); cloudStop = null; cloudSession = null; cloudPending = null; cloudBaseline = null; window.history.replaceState(null, '', location.pathname + location.search); render(); renderCloud(); toast('Your copy is open on this device. It is no longer connected to the shared design.'); });
$('#ai-writing').addEventListener('click', async () => {
  const openingGeneration = ++aiGeneration; aiController?.abort(); aiController = null;
  aiTarget = selected()?.type === 'text' && !effectivelyLocked(selected()) && cloudSession?.role !== 'view' ? { pageId, elementId: selected().id } : null;
  $('#ai-content').value = aiTarget ? selected().text : ''; $('#ai-result').value = ''; $('#ai-apply').disabled = true; $('#ai-status').textContent = 'Checking whether AI writing is available…'; $('#ai-generate').disabled = true;
  $('#ai-dialog').showModal(); const status = await getAiStatus(); if (openingGeneration !== aiGeneration || !$('#ai-dialog').open) return; aiEnabled = status.enabled;
  $('#ai-status').textContent = aiEnabled ? `${status.model || 'The writing service'} is ready. Read or edit your draft before using it.` : 'AI writing is not set up here. You can still write and edit your own text.';
  $('#ai-generate').disabled = !aiEnabled;
});
$('#ai-generate').addEventListener('click', async () => {
  if (!aiEnabled || aiController) return;
  const controller = new AbortController(), generation = ++aiGeneration; aiController = controller; $('#ai-generate').disabled = true; $('#ai-cancel').disabled = false; $('#ai-apply').disabled = true; $('#ai-status').textContent = 'Writing a draft…';
  try {
    const task = $('#ai-task').value, result = await generateWriting({ task, content: $('#ai-content').value, context: $('#ai-context').value, ...(task === 'translate' ? { language: $('#ai-language').value } : {}) }, { signal: controller.signal });
    if (controller.signal.aborted || !$('#ai-dialog').open || generation !== aiGeneration) return;
    $('#ai-result').value = result.text; $('#ai-status').textContent = `Draft from ${result.model || 'the writing service'}. Read or edit it below.`; $('#ai-apply').disabled = !aiTarget || task === 'design-plan';
  } catch (error) { if (!controller.signal.aborted && generation === aiGeneration) $('#ai-status').textContent = error.message || 'The draft could not be written. Your text is unchanged.'; }
  finally { if (aiController === controller) aiController = null; if (generation === aiGeneration) { $('#ai-generate').disabled = !aiEnabled; $('#ai-cancel').disabled = true; } }
});
function cancelAi() { aiGeneration++; aiController?.abort(); aiController = null; $('#ai-status').textContent = 'Writing cancelled. Your text is unchanged.'; $('#ai-cancel').disabled = true; $('#ai-generate').disabled = !aiEnabled; }
$('#ai-cancel').addEventListener('click', cancelAi); $('#ai-dialog').addEventListener('close', () => { if (aiController) cancelAi(); });
$('#ai-apply').addEventListener('click', () => attempt(() => { if (!aiTarget) throw new Error('Select a text layer before choosing Apply to selected text.'); const next = updateElement(history.current, aiTarget.pageId, aiTarget.elementId, { text: $('#ai-result').value }); const saved = commit(next); $('#ai-dialog').close(); if (saved) toast('Text updated. Undo brings your earlier wording back.'); }));
function openBackgroundTool() {
  const e = selected(); if (!e || e.type !== 'image') return; if (effectivelyLocked(e)) { toast('Unlock this image or its group before changing it.', true); return; }
  backgroundTarget = { pageId, elementId: e.id, src: e.src }; backgroundResult = null; $('#background-result').innerHTML = ''; $('#background-apply').disabled = true; $('#background-download').disabled = true; $('#background-dialog').showModal();
}
$('#background-preview').addEventListener('click', async () => {
  const button = $('#background-preview'), target = backgroundTarget; button.disabled = true;
  try { const { removeBackground } = await import('./image-tools.js'); const result = await removeBackground(target.src, { colour: $('#background-colour').value, tolerance: Number($('#background-tolerance').value), contiguous: true }); if (backgroundTarget !== target || !$('#background-dialog').open) return; backgroundResult = result; $('#background-result').innerHTML = `<img src="${safe(backgroundResult)}" alt="Transparent background colour preview">`; $('#background-apply').disabled = false; $('#background-download').disabled = false; }
  catch (error) { if (backgroundTarget === target && $('#background-dialog').open) toast(error.message || 'Background colour removal failed.', true); } finally { if (backgroundTarget === target) button.disabled = false; }
});
$('#background-dialog').addEventListener('close', () => { backgroundTarget = null; backgroundResult = null; $('#background-preview').disabled = false; });
$('#background-download').addEventListener('click', () => { if (!backgroundResult) return; const anchor = document.createElement('a'); anchor.href = backgroundResult; anchor.download = `${filename()}-transparent.png`; document.body.append(anchor); anchor.click(); anchor.remove(); });
$('#background-apply').addEventListener('click', () => attempt(() => { if (!backgroundResult || !backgroundTarget) return; const saved = commit(updateElement(history.current, backgroundTarget.pageId, backgroundTarget.elementId, { src: backgroundResult, crop: { x: 0, y: 0, width: 1, height: 1 } })); $('#background-dialog').close(); if (saved) toast('Image updated. Undo brings the original back.'); }));
$('#shortcuts').addEventListener('click', () => $('#shortcuts-dialog').showModal()); $('#close-shortcuts').addEventListener('click', () => $('#shortcuts-dialog').close());
for (const dialog of document.querySelectorAll('dialog')) { dialog.querySelector('[data-close]')?.addEventListener('click', () => dialog.close()); dialog.addEventListener('click', event => { if (event.target === dialog) { const rect = dialog.getBoundingClientRect(); if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) dialog.close(); } }); }
const actionMenus = [...document.querySelectorAll('.action-menu')];
for (const menu of actionMenus) menu.addEventListener('toggle', () => { if (menu.open) for (const other of actionMenus) if (other !== menu) other.open = false; });
document.addEventListener('click', event => { for (const menu of actionMenus) if (!menu.contains(event.target) || event.target.closest('button')?.closest('.action-menu') === menu) menu.open = false; });
document.addEventListener('keydown', event => {
  if (event.key !== 'Escape' || [...document.querySelectorAll('dialog')].some(dialog => dialog.open)) return;
  const openMenu = actionMenus.find(menu => menu.open); if (!openMenu) return;
  event.preventDefault(); event.stopPropagation(); openMenu.open = false; openMenu.querySelector('summary').focus();
}, true);
if (recoveryRaw !== null) { const button = document.createElement('button'); button.id = 'download-recovery'; button.textContent = 'Recovery data'; button.addEventListener('click', () => download(recoveryRaw, 'application/json', 'stencil-original-recovery.json')); $('#file-menu .action-menu-panel').append(button); }
render(); if (!recoveryPreserved) { storageHealthy = false; $('#save-status').textContent = 'Autosave paused. Save JSON'; } if (recoveryMessage) toast(recoveryMessage, true);
if (new URLSearchParams(location.hash.slice(1)).has('workspace')) connectSharedLink();
