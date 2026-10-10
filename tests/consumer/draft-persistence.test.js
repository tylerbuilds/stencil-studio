import test from 'node:test';
import assert from 'node:assert/strict';
import { createDraftPersistence } from '../../src/draft-persistence.js';
import { createBlankDesign, serialiseDocument, MAX_DOCUMENT_BYTES } from '../../src/model.js';
const key = 'stencil-studio.document.v1';
const payload = title => serialiseDocument(createBlankDesign({ title }));
const turn = () => new Promise(resolve => setImmediate(resolve));
class TransactionStorage {
  committed = new Map(); working = null; gates = []; fail = false; calls = 0;
  getItem(key) { return (this.working ?? this.committed).get(key) ?? null; }
  setItem(key, value) { assert.ok(this.working, 'writes occur only inside a transaction'); this.working.set(key, value); }
  async run(operation) {
    this.calls++; await new Promise(resolve => this.gates.push(resolve));
    this.working = new Map(this.committed);
    try { const value = operation(); if (this.fail) throw new Error('Disk quota refused the commit'); this.committed = this.working; return value; } finally { this.working = null; }
  }
  release() { const gate = this.gates.shift(); assert.ok(gate, 'there is a pending transaction'); gate(); }
}

test('rapid edits hold one active write and only the newest waiting draft, with success reported after commit', async () => {
  const storage = new TransactionStorage(), states = [], queue = createDraftPersistence({ storage, key, onState: state => states.push(state) });
  const first = payload('First'); queue.save(first, 1); for (let revision = 2; revision <= 100; revision++) queue.save(payload(`Edit ${revision}`), revision);
  assert.equal(storage.calls, 1); assert.equal(storage.getItem(key), null); assert.equal(states.filter(state => state.phase === 'saved').length, 0);
  storage.release(); await turn(); assert.equal(storage.calls, 2); assert.equal(storage.getItem(key), first);
  assert.equal(states.filter(state => state.phase === 'saved').length, 1); storage.release(); const result = await queue.whenSettled();
  assert.equal(result.ok, true); assert.equal(result.revision, 100); assert.equal(storage.getItem(key), result.payload);
  assert.deepEqual(states.filter(state => state.phase === 'saved').map(state => state.revision), [1, 100]); assert.equal(queue.expectedRaw, result.payload);
});
test('a quota failure keeps the committed bytes and expected value, then a later write can retry', async () => {
  const original = payload('Original'), storage = new TransactionStorage(); storage.committed.set(key, original); storage.fail = true;
  const queue = createDraftPersistence({ storage, key, initialRaw: original }); queue.save(payload('Unsaved edit'), 1); storage.release();
  const failed = await queue.whenSettled(); assert.equal(failed.ok, false); assert.match(failed.error.message, /quota/); assert.equal(storage.getItem(key), original); assert.equal(queue.expectedRaw, original);
  storage.fail = false; const next = payload('Retry'); queue.save(next, 2); storage.release(); assert.equal((await queue.whenSettled()).ok, true); assert.equal(storage.getItem(key), next); assert.equal(queue.expectedRaw, next);
});
test('a newer tab draft is checked inside the transaction and is never overwritten by stale queued edits', async () => {
  const original = payload('Original'), newer = payload('Another tab'), storage = new TransactionStorage(); storage.committed.set(key, original);
  const queue = createDraftPersistence({ storage, key, initialRaw: original }); queue.save(payload('Stale edit one'), 1); queue.save(payload('Stale edit two'), 2);
  storage.committed.set(key, newer); storage.release(); await turn(); storage.release(); const result = await queue.whenSettled();
  assert.equal(result.ok, false); assert.equal(result.error.name, 'StorageConflictError'); assert.equal(storage.getItem(key), newer); assert.equal(queue.expectedRaw, original);
});
test('the original earlier-format bytes are kept in the same durable transaction before their replacement', async () => {
  const current = JSON.parse(payload('Earlier')); current.version = 4; delete current.video;
  for (const page of current.pages) { delete page.duration; delete page.backgroundGradient; }
  const original = JSON.stringify(current), storage = new TransactionStorage(); storage.committed.set(key, original);
  const queue = createDraftPersistence({ storage, key, initialRaw: original }), next = payload('Updated'); queue.save(next, 1); storage.release(); await queue.whenSettled();
  assert.equal(storage.getItem(key), next); assert.equal([...storage.committed].filter(([name, value]) => name !== key && value === original).length, 1);
});
test('a display callback failure cannot cause an uncommitted success or interrupt later saving', async () => {
  const storage = new TransactionStorage(), queue = createDraftPersistence({ storage, key, onState: () => { throw new Error('Display failed'); } });
  const first = payload('First'); queue.save(first, 1); storage.release(); assert.equal((await queue.whenSettled()).ok, true); assert.equal(storage.getItem(key), first);
  const next = payload('Next'); queue.save(next, 2); storage.release(); await queue.whenSettled(); assert.equal(storage.getItem(key), next);
});
test('invalid revisions and UTF-8 drafts above the document byte limit never start a transaction', () => {
  const storage = new TransactionStorage(), queue = createDraftPersistence({ storage, key });
  for (const revision of [-1, NaN, Infinity, .5, '1']) assert.throws(() => queue.save(payload('Invalid revision'), revision));
  assert.throws(() => queue.save('é'.repeat(MAX_DOCUMENT_BYTES / 2 + 1), 1), /12 MiB/); assert.equal(storage.calls, 0);
});
