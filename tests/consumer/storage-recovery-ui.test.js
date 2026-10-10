/** Exercise the shipped recovery controls; this VM does not claim native IndexedDB proof. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { escapeXML } from '../../src/model.js';

const source = await readFile(new URL('../../src/app.js', import.meta.url), 'utf8');
const first = source.indexOf('let storageReviewGeneration ='), last = source.indexOf("$('#export-library').addEventListener", first);
assert.ok(first >= 0 && last > first, 'Actual recovery controls are present');
const controller = source.slice(first, last);
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
function fixture({ inspect, keep, remove, copies = [], raws = new Map() } = {}) {
  const nodes = new Map(), inspections = [], acknowledgements = [], removals = [], reads = [], downloads = [], confirmations = [], errors = [];
  let persisted = 0, confirmed = false;
  function node(selector) {
    if (!nodes.has(selector)) nodes.set(selector, { disabled: false, hidden: false, open: false, textContent: '', handlers: new Map(), buttons: [],
      addEventListener(type, handler) { this.handlers.set(type, handler); },
      showModal() { this.open = true; },
      close() { this.open = false; this.handlers.get('close')?.(); },
      set innerHTML(markup) {
        this.markup = markup; this.buttons = [...markup.matchAll(/<button\b([^>]*)>/g)].map(([, attrs]) => {
          const button = { disabled: /\sdisabled(?:\s|$)/.test(attrs), dataset: {}, handlers: new Map(), addEventListener(type, handler) { this.handlers.set(type, handler); } };
          for (const [, key, value] of attrs.matchAll(/data-([a-z-]+)="([^"]*)"/g)) button.dataset[key.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())] = value;
          return button;
        });
      },
      get innerHTML() { return this.markup; },
      querySelectorAll(selector) { const key = selector.slice(6, -1).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase()); return this.buttons.filter(button => Object.hasOwn(button.dataset, key)); },
    });
    return nodes.get(selector);
  }
  const browserStorage = {
    async inspectLegacyChanges() { inspections.push(true); return inspect ? inspect(inspections.length) : { token: 'review-token', changes: [{ key: 'draft', kind: 'document', bytes: 120, deleted: false }] }; },
    async keepBothLegacyCopies(token) { acknowledgements.push(token); return keep ? keep(token) : { kept: 1, recoveryKeys: copies.map(copy => copy.key) }; },
    listLegacyRecoveries() { return copies; },
    readLegacyRecovery(key) { reads.push(key); if (!raws.has(key)) throw new Error('That earlier recovery copy is not available.'); return raws.get(key); },
    async removeLegacyRecovery(key) { removals.push(key); if (remove) return remove(key); const index = copies.findIndex(copy => copy.key === key); assert.ok(index >= 0); copies.splice(index, 1); return true; },
  };
  const context = { $: node, browserStorage, safe: escapeXML,
    window: { confirm(message) { confirmations.push(message); return confirmed; } },
    download(raw, mime, filename) { downloads.push({ raw, mime, filename }); },
    persist() { persisted++; },
    toast(message) { errors.push(message); },
    attempt(operation) { try { return operation(); } catch (error) { errors.push(error.message); return false; } },
  };
  runInNewContext(controller, context);
  const click = selector => node(selector).handlers.get('click')?.();
  const copyButton = (attribute, key) => node('#earlier-storage-copies').buttons.find(button => button.dataset[attribute] === key);
  const fireCopy = (attribute, key) => { const button = copyButton(attribute, key); assert.ok(button); return button.handlers.get('click')(); };
  return { node, click, copyButton, fireCopy, inspections, acknowledgements, removals, reads, downloads, confirmations, errors, copies, persisted: () => persisted, confirm: value => { confirmed = value; }, close: () => node('#storage-recovery-dialog').close(), open: () => click('#earlier-storage-data') };
}

test('actual review inspects metadata and acknowledges an earlier source only on the explicit Keep both click', async () => {
  const view = fixture(); await view.open();
  assert.equal(view.inspections.length, 1); assert.equal(view.acknowledgements.length, 0); assert.equal(view.persisted(), 0); assert.equal(view.reads.length, 0);
  assert.equal(view.node('#keep-both-storage-copies').disabled, false); await view.click('#keep-both-storage-copies');
  assert.deepEqual(view.acknowledgements, ['review-token']); assert.equal(view.persisted(), 1); assert.match(view.node('#storage-recovery-status').textContent, /1 earlier copy kept/);
  await view.click('#keep-both-storage-copies'); assert.equal(view.acknowledgements.length, 1);
});

test('a late actual inspection cannot change a closed and reopened recovery window', async () => {
  const old = deferred(), fresh = deferred(), view = fixture({ inspect: call => call === 1 ? old.promise : fresh.promise });
  const opening = view.open(); view.close(); const reopening = view.open();
  fresh.resolve({ token: 'fresh', changes: [{ kind: 'library', bytes: 400, deleted: false }] }); await reopening;
  const current = view.node('#storage-recovery-status').textContent;
  old.resolve({ token: 'old', changes: [{ kind: 'document', bytes: 200, deleted: false }] }); await opening;
  assert.equal(view.node('#storage-recovery-status').textContent, current); await view.click('#keep-both-storage-copies'); assert.deepEqual(view.acknowledgements, ['fresh']);
});

test('late acknowledgement after closing does not retry an autosave or change the new recovery window', async () => {
  const pending = deferred(), view = fixture({ keep: () => pending.promise }); await view.open();
  const keeping = view.click('#keep-both-storage-copies'); view.close(); await view.open();
  const current = view.node('#storage-recovery-status').textContent; pending.resolve({ kept: 1, recoveryKeys: ['earlier'] }); await keeping;
  assert.equal(view.persisted(), 0); assert.equal(view.node('#storage-recovery-status').textContent, current); assert.equal(view.node('#keep-both-storage-copies').disabled, false);
});

test('actual earlier JSON is exact and removal requires its download followed by confirmation', async () => {
  const key = 'stencil-studio.document.v1.legacy-recovery.v1.123', raw = '{\n "title": "Earlier café ☕"\n}\n';
  const view = fixture({ copies: [{ key, kind: 'document', bytes: 40 }], raws: new Map([[key, raw]]) }); await view.open();
  assert.equal(view.copyButton('removeEarlierCopy', key).disabled, true); await view.fireCopy('removeEarlierCopy', key); assert.equal(view.removals.length, 0);
  view.fireCopy('earlierCopy', key); assert.deepEqual(view.downloads, [{ raw, mime: 'application/json', filename: 'stencil-earlier-document-1.json' }]);
  assert.equal(view.copyButton('removeEarlierCopy', key).disabled, false); await view.fireCopy('removeEarlierCopy', key); assert.equal(view.removals.length, 0); assert.equal(view.confirmations.length, 1);
  view.confirm(true); await view.fireCopy('removeEarlierCopy', key); assert.deepEqual(view.removals, [key]); assert.equal(view.copies.length, 0); assert.equal(view.persisted(), 0);
  assert.equal(view.node('#keep-both-storage-copies').disabled, true); assert.match(view.node('#storage-recovery-status').textContent, /Earlier copy removed/);
});

test('a failed earlier download cannot enable removal and a rejected deletion keeps its recovery visible', async () => {
  const key = 'stencil-studio.library.v1.legacy-recovery.v1.456', raw = '{"designs":[]}';
  const view = fixture({ copies: [{ key, kind: 'library', bytes: 14 }], raws: new Map(), remove: () => { throw new Error('Newer recovery changed'); } }); await view.open();
  view.fireCopy('earlierCopy', key); assert.equal(view.copyButton('removeEarlierCopy', key).disabled, true); assert.equal(view.removals.length, 0);
  // The exact copy becomes readable without changing its displayed identity.
  const ready = fixture({ copies: [{ key, kind: 'library', bytes: 14 }], raws: new Map([[key, raw]]), remove: () => { throw new Error('Newer recovery changed'); } }); await ready.open();
  ready.fireCopy('earlierCopy', key); ready.confirm(true); await ready.fireCopy('removeEarlierCopy', key);
  assert.equal(ready.copies.length, 1); assert.equal(ready.copyButton('removeEarlierCopy', key).disabled, false); assert.equal(ready.node('#storage-recovery-error').textContent, 'Newer recovery changed');
});

test('a removal finishing after the window closes cannot replace a fresh review status', async () => {
  const key = 'stencil-studio.uploads.v1.legacy-recovery.v1.789', pending = deferred();
  const view = fixture({ copies: [{ key, kind: 'uploads', bytes: 2 }], raws: new Map([[key, '{}']]), remove: () => pending.promise }); await view.open();
  view.fireCopy('earlierCopy', key); view.confirm(true); const removing = view.fireCopy('removeEarlierCopy', key); view.close(); await view.open();
  const current = view.node('#storage-recovery-status').textContent; pending.resolve(true); await removing;
  assert.equal(view.node('#storage-recovery-status').textContent, current); assert.equal(view.persisted(), 0);
});

test('no-change review cannot acknowledge, and a capacity failure stays visible without autosave or deletion', async () => {
  const empty = fixture({ inspect: () => ({ token: 'empty', changes: [] }) }); await empty.open(); await empty.click('#keep-both-storage-copies'); assert.equal(empty.acknowledgements.length, 0);
  const full = fixture({ keep: () => { throw new Error('Earlier recovery is full. Download a copy before removing it.'); } }); await full.open(); await full.click('#keep-both-storage-copies');
  assert.equal(full.persisted(), 0); assert.equal(full.removals.length, 0); assert.match(full.node('#storage-recovery-error').textContent, /recovery is full/); assert.equal(full.node('#keep-both-storage-copies').disabled, true);
});
