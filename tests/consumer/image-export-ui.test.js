/** Exercise the actual modal listeners in a VM; no DOM/native pixel decoding. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { createDocument, createPage, History, serialiseDocument } from '../../src/model.js';
import { buildPageArchive } from '../../src/page-archive.js';

const source = await readFile(new URL('../../src/app.js', import.meta.url), 'utf8');
function actualBlock(start, end) {
  const first = source.indexOf(start), last = source.indexOf(end, first);
  assert.ok(first >= 0 && last > first, `Actual image download controller exists: ${start}`);
  return source.slice(first, last);
}
const controller = `${actualBlock('const filename = () =>', "$('#save-document').addEventListener")}
${actualBlock('let imageExportTarget =', "$('#export-pdf').addEventListener")}
globalThis.exportState = () => ({ target: imageExportTarget, controller: imageExportController, generation: imageExportGeneration });`;
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const raster = mime => new Blob([Uint8Array.from([1, 2, 3])], { type: mime });
function fixture({ render, archive } = {}) {
  const document = createDocument(); document.title = 'Captured campaign'; document.pages[0].name = 'Cover';
  document.pages.push({ ...createPage(1000, 600), name: 'Details', transparentBackground: true });
  const history = new History(document), nodes = new Map(), downloads = [], renders = [], archives = [];
  function node(selector) {
    if (!nodes.has(selector)) nodes.set(selector, { value: '', checked: false, disabled: false, hidden: false, textContent: '', open: false, handlers: new Map(),
      addEventListener(type, callback) { this.handlers.set(type, callback); },
      showModal() { this.open = true; },
      close() { this.open = false; this.handlers.get('close')?.(); },
    });
    return nodes.get(selector);
  }
  const renderRaster = (page, mime, options) => { renders.push({ page, mime, options }); return render ? render(page, mime, options, renders.length) : raster(mime); };
  const context = { structuredClone, AbortController, Blob, history, pageId: history.current.pages[1].id, $: node,
    renderRaster,
    buildPageArchive(snapshot, options) {
      archives.push({ snapshot, options });
      if (archive) return archive(snapshot, options, archives.length);
      // Convert only the controller's newly-created options object to this realm;
      // run the real archive function, not an implementation copied into the VM.
      return buildPageArchive(snapshot, { format: options.format, renderPage: options.renderPage, signal: options.signal, onProgress: options.onProgress });
    },
    download(blob, mime, filename) { downloads.push({ blob, mime, filename }); },
  };
  runInNewContext(controller, context);
  const event = { preventDefault() {} };
  const fire = (selector, type) => { const listener = node(selector).handlers.get(type); assert.equal(typeof listener, 'function'); return listener(event); };
  return { context, history, node, downloads, renders, archives, open: () => fire('#export-images', 'click'), submit: () => fire('#image-export-form', 'submit'), cancel: () => fire('#image-export-cancel', 'click'), close: () => node('#image-export-dialog').close(), changeFormat: () => fire('#image-export-format', 'change') };
}

test('actual modal exports its captured page and filename after active document and selected page change', async () => {
  const pending = deferred(), view = fixture({ render: () => pending.promise }), capturedId = view.history.current.pages[1].id;
  view.open(); view.node('#image-export-scope').value = 'current'; view.node('#image-export-transparent').checked = false;
  view.history.current.title = 'A different active design'; view.history.current.pages[1].name = 'New active name'; view.history.current.pages[1].width = 640; view.history.current.pages.reverse(); view.context.pageId = view.history.current.pages[1].id;
  const submitting = view.submit();
  assert.equal(view.renders.length, 1); assert.equal(view.renders[0].page.id, capturedId); assert.equal(view.renders[0].page.name, 'Details'); assert.equal(view.renders[0].page.width, 1000);
  pending.resolve(raster('image/png')); await submitting;
  assert.equal(view.downloads.length, 1); assert.equal(view.downloads[0].filename, 'captured-campaign-page-2.png'); assert.equal(view.downloads[0].mime, 'image/png');
});

test('actual all-page transparency override affects only the exported snapshot and keeps native page order', async () => {
  const view = fixture(), before = serialiseDocument(view.history.current), order = view.history.current.pages.map(page => page.id);
  view.open(); view.node('#image-export-scope').value = 'all'; view.node('#image-export-transparent').checked = true; await view.submit();
  assert.equal(view.downloads.length, 1); assert.equal(view.downloads[0].mime, 'application/zip'); assert.equal(view.downloads[0].filename, 'captured-campaign-png-pages.zip');
  assert.deepEqual(view.renders.map(call => call.page.id), order); assert.ok(view.renders.every(call => call.page.transparentBackground === true));
  assert.equal(serialiseDocument(view.history.current), before); assert.equal(view.history.past.length, 0);
});

test('actual JPG choice is opaque, uses JPEG extension and preserves a transparent design', async () => {
  const view = fixture(), before = serialiseDocument(view.history.current);
  view.open(); view.node('#image-export-scope').value = 'current'; view.node('#image-export-format').value = 'jpeg'; view.node('#image-export-transparent').checked = true; view.changeFormat(); await view.submit();
  assert.equal(view.renders[0].mime, 'image/jpeg'); assert.equal(view.renders[0].page.transparentBackground, false); assert.equal(view.downloads[0].filename, 'captured-campaign-page-2.jpg');
  assert.equal(view.node('#image-export-transparent-field').hidden, true); assert.equal(view.node('#image-export-transparent').disabled, true); assert.equal(serialiseDocument(view.history.current), before);
});

test('closing the actual modal aborts its signal and a late renderer result cannot download a file', async () => {
  const pending = deferred(), view = fixture({ render: () => pending.promise });
  view.open(); view.node('#image-export-scope').value = 'current'; const submitting = view.submit(), signal = view.renders[0].options.signal;
  view.close(); assert.equal(signal.aborted, true); assert.equal(view.context.exportState().target, null);
  pending.resolve(raster('image/png')); await submitting; assert.equal(view.downloads.length, 0); assert.equal(view.context.exportState().controller, null);
});

test('late archive progress and completion cannot affect a reopened modal or its newer job', async () => {
  const first = deferred(), second = deferred(), view = fixture({ archive: (_snapshot, _options, call) => call === 1 ? first.promise : second.promise });
  view.open(); const oldSubmission = view.submit(); view.close(); view.history.current.title = 'New campaign'; view.open(); view.node('#image-export-format').value = 'jpeg'; const newSubmission = view.submit();
  const newController = view.context.exportState().controller;
  view.archives[1].options.onProgress({ completed: 1, total: 2 }); const status = view.node('#image-export-status').textContent;
  view.archives[0].options.onProgress({ completed: 99, total: 99 }); assert.equal(view.node('#image-export-status').textContent, status);
  first.resolve({ blob: new Blob(['old']), mime: 'application/zip', filename: 'old.zip', pageCount: 2 }); await oldSubmission;
  assert.equal(view.downloads.length, 0); assert.equal(view.context.exportState().controller, newController); assert.equal(view.node('#image-export-submit').disabled, true); assert.equal(view.node('#image-export-cancel').disabled, false);
  second.resolve({ blob: new Blob(['new']), mime: 'application/zip', filename: 'new-campaign-jpg-pages.zip', pageCount: 2 }); await newSubmission;
  assert.equal(view.downloads.length, 1); assert.equal(view.downloads[0].filename, 'new-campaign-jpg-pages.zip'); assert.equal(view.node('#image-export-submit').disabled, false);
});

test('actual Cancel suppresses a late successful result and allows another download after settlement', async () => {
  const pending = deferred(), view = fixture({ render: (_page, mime, _options, call) => call === 1 ? pending.promise : raster(mime) });
  view.open(); view.node('#image-export-scope').value = 'current'; const submitting = view.submit(); view.cancel(); assert.equal(view.renders[0].options.signal.aborted, true);
  pending.resolve(raster('image/png')); await submitting; assert.equal(view.downloads.length, 0); assert.equal(view.node('#image-export-submit').disabled, false);
  await view.submit(); assert.equal(view.downloads.length, 1); assert.equal(view.renders.length, 2);
});

test('actual cancellation error restores controls and a subsequent render failure stays visible without downloading', async () => {
  const pending = deferred(), view = fixture({ render: (_page, _mime, _options, call) => call === 1 ? pending.promise : Promise.reject(new Error('Fictional render failed')) });
  view.open(); view.node('#image-export-scope').value = 'current'; const submitting = view.submit(); view.cancel(); pending.reject(new DOMException('Cancelled', 'AbortError')); await submitting;
  assert.match(view.node('#image-export-status').textContent, /cancelled/); assert.equal(view.node('#image-export-cancel').disabled, true); assert.equal(view.node('#image-export-submit').disabled, false); assert.equal(view.node('#image-export-transparent').disabled, false);
  await view.submit(); assert.equal(view.node('#image-export-error').textContent, 'Fictional render failed'); assert.equal(view.downloads.length, 0); assert.equal(view.node('#image-export-scope').disabled, false);
});

test('actual submit guard permits only one pending download and invalid format never starts a renderer', async () => {
  const pending = deferred(), view = fixture({ render: () => pending.promise }); view.open(); view.node('#image-export-scope').value = 'current'; const first = view.submit(); await view.submit(); assert.equal(view.renders.length, 1);
  pending.resolve(raster('image/png')); await first; assert.equal(view.downloads.length, 1);
  view.node('#image-export-format').value = 'svg'; await view.submit(); assert.equal(view.renders.length, 1); assert.match(view.node('#image-export-error').textContent, /Choose an image format/); assert.equal(view.node('#image-export-submit').disabled, false);
});
