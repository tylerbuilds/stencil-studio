import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createWorkspaceHandler } from '../scripts/workspace-backend.mjs';
import { createDocument, createPage, createElement, validateDocument, VERSION } from '../src/model.js';

async function service(t) {
  const directory = await mkdtemp(join(tmpdir(), 'stencil-data-cloud-'));
  let handler, server, origin;
  const start = async () => {
    handler = await createWorkspaceHandler({ dataDirectory: directory, validators: { 'stencil-studio': validateDocument, clearcv: () => { throw new Error('Another app.'); } } });
    server = createServer(async (req, res) => { if (!await handler(req, res)) { res.writeHead(404); res.end(); } });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    origin = `http://127.0.0.1:${server.address().port}`;
  };
  const stop = async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await handler.close(); };
  await start();
  t.after(async () => { await stop(); await rm(directory, { recursive: true, force: true }); });
  const request = async (route, { token, method = 'GET', body } = {}) => {
    const response = await fetch(`${origin}/api/workspaces${route}`, { method, headers: {
      ...(token ? { 'X-Workspace-Token': token } : {}),
      ...(body === undefined ? {} : { 'Content-Type': 'application/json', 'X-Workspace-Client': '1', Origin: origin })
    }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { status: response.status, payload: await response.json() };
  };
  const create = async document => {
    const result = await request('', { method: 'POST', body: { kind: 'stencil-studio', title: document.title, document } });
    assert.equal(result.status, 201);
    return result.payload;
  };
  return { directory, request, create, start, stop };
}

function retainedDesign() {
  assert.equal(VERSION, 5);
  const document = createDocument(); document.title = 'Native data · café 日本語';
  const first = document.pages[0]; first.id = 'first-data-page'; first.name = 'Data'; first.transparentBackground = true;
  first.guides = [{ id: 'left-guide', axis: 'x', position: 95 }, { id: 'top-guide', axis: 'y', position: 120 }];
  first.guideSettings = { visible: false, rulers: true, snapToGuides: true, snapToObjects: false, snapToPage: false, tolerance: 9 };
  const consumerLayers = [
    createElement('shape', { id: 'retained-star', kind: 'star', x: 600, y: 50, width: 80, height: 80, fill: '#654321', stroke: '#123456', strokeWidth: 2, groupId: 'art-group' }),
    createElement('freehand', { id: 'retained-brush', x: 610, y: 160, width: 60, height: 70, points: [{ x: .1, y: .2 }, { x: .8, y: .9 }], strokeWidth: 5, groupId: 'art-group' }),
  ];
  first.elements = [
    createElement('table', { id: 'retained-table', width: 500, height: 220, fontFamily: 'Georgia', fontSize: 18, borderWidth: 3,
      data: { columns: ['Name', 'Notes'], rows: [['Zoë', '<script>literal</script> & café'], ['日本語', 'First\nSecond']] } }),
    createElement('chart', { id: 'retained-pie', x: 50, y: 450, width: 550, height: 250, fontFamily: 'Courier New', showValues: false,
      data: { kind: 'pie', labels: ['Zero', 'Whole'], values: [0, 5] }, palette: ['#123456', '#abcdef'] })
  ];
  first.elements.push(...consumerLayers);
  const second = createPage(1000, 600); second.id = 'second-data-page'; second.name = 'Trends';
  second.guides = [{ id: 'right-guide', axis: 'x', position: 1000 }];
  second.elements = [createElement('chart', { id: 'retained-line', data: { kind: 'line', labels: ['Start', 'Fraction', 'Maximum'], values: [0, .125, 1_000_000_000] } }), createElement('rect', { id: 'old-shape', x: 50, y: 50, width: 90, height: 60, fill: '#123456' })];
  document.pages = [second, first]; // Array order is the retained page/presentation order.
  return validateDocument(document);
}

test('native data, page order, guides and transparency survive shared edits, document history and durable restart', async t => {
  const f = await service(t), original = retainedDesign();
  const created = await f.create(original), id = created.workspace.id, token = created.tokens.owner;
  assert.deepEqual(created.workspace.document, original);
  const updated = structuredClone(original); updated.pages.reverse();
  updated.pages[0].elements[0].data.rows[0][1] = 'Edited after sharing · café';
  updated.pages[0].elements[1].data.values = [3, 2];
  updated.pages[0].guides[0].position = 180; updated.pages[0].transparentBackground = false;
  updated.pages[0].guideSettings.tolerance = 12;
  const save = await f.request(`/${id}`, { method: 'PUT', token: created.tokens.edit, body: { baseRevision: 1, document: updated } });
  assert.equal(save.status, 200); assert.deepEqual(save.payload.workspace.document, updated);
  assert.deepEqual(validateDocument(save.payload.workspace.document), updated);
  const history = await f.request(`/${id}/revisions`, { token });
  assert.deepEqual(history.payload.revisions.map(revision => revision.document), [original, updated]);
  await f.stop(); await f.start();
  const reopened = await f.request(`/${id}`, { token: created.tokens.view });
  assert.equal(reopened.status, 200); assert.deepEqual(reopened.payload.workspace.document, updated);
  assert.equal(reopened.payload.role, 'view');
  const durable = JSON.parse(await readFile(join(f.directory, `${id}.json`), 'utf8'));
  assert.deepEqual(durable.document, updated); assert.deepEqual(durable.history[0].document, original);
  for (const secret of Object.values(created.tokens)) assert.equal(JSON.stringify(durable).includes(secret), false);
});

test('invalid retained data and guide extensions are rejected without changing durable bytes or current revision', async t => {
  const f = await service(t), original = retainedDesign(), created = await f.create(original);
  const id = created.workspace.id, token = created.tokens.owner, record = join(f.directory, `${id}.json`);
  const before = await readFile(record, 'utf8');
  const mutations = [
    doc => { doc.pages[1].elements[0].data.externalURL = 'https://example.invalid/track'; },
    doc => { doc.pages[1].elements[0].data.rows[0].push('Extra cell'); },
    doc => { doc.pages[1].elements[0].data.rows[0][0] = { html: '<script>' }; },
    doc => { doc.pages[1].elements[0].data.rows = Array.from({ length: 51 }, () => ['A', 'B']); },
    doc => { doc.pages[1].elements[1].data.values = [0]; },
    doc => { doc.pages[1].elements[1].data.values = [0, 0]; },
    doc => { doc.pages[1].elements[1].data.values = [1, 1_000_000_001]; },
    doc => { doc.pages[1].elements[1].palette = Array(9).fill('#000000'); },
    doc => { doc.pages[1].elements[1].fontSize = 101; },
    doc => { doc.pages[0].guides[0].position = doc.pages[0].width + 1; },
    doc => { doc.pages[0].guides[0].axis = 'z'; },
    doc => { doc.pages[0].guides[0].id = doc.pages[0].id; },
    doc => { doc.pages[0].guideSettings.tolerance = 31; },
    doc => { doc.pages[0].guideSettings.newBackendPermission = true; },
    doc => { doc.pages[0].transparentBackground = 'true'; }
  ];
  for (const mutate of mutations) {
    const invalid = structuredClone(original); mutate(invalid);
    const rejected = await f.request(`/${id}`, { method: 'PUT', token, body: { baseRevision: 1, document: invalid } });
    assert.equal(rejected.status, 400); assert.equal(rejected.payload.error.code, 'invalid_document');
    assert.equal(await readFile(record, 'utf8'), before);
  }
  const read = await f.request(`/${id}`, { token });
  assert.equal(read.payload.workspace.revision, 1); assert.deepEqual(read.payload.workspace.document, original);
});

test('v5 document fields preserve existing view/edit permission and revision-conflict boundaries', async t => {
  const f = await service(t), original = retainedDesign(), created = await f.create(original), id = created.workspace.id;
  const changed = structuredClone(original); changed.pages[0].elements[0].data.values[1] = .5;
  const viewer = await f.request(`/${id}`, { method: 'PUT', token: created.tokens.view, body: { baseRevision: 1, document: changed } });
  assert.equal(viewer.status, 403);
  assert.equal(viewer.payload.workspace, undefined);
  const owner = await f.request(`/${id}`, { method: 'PUT', token: created.tokens.owner, body: { baseRevision: 1, document: changed } });
  assert.equal(owner.status, 200);
  const stale = await f.request(`/${id}`, { method: 'PUT', token: created.tokens.edit, body: { baseRevision: 1, document: original } });
  assert.equal(stale.status, 409); assert.equal(stale.payload.revision, 2); assert.deepEqual(stale.payload.workspace.document, changed);
  assert.equal('tokenHashes' in stale.payload.workspace, false);
  const status = await f.request('/status'); assert.equal(status.payload.maxDocumentBytes, 12 * 1024 * 1024);
});
