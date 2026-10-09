import http from 'node:http';
import { readFile, stat, lstat, realpath, mkdir } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { loadAiConfig, createAiHandler } from './ai.mjs';
import { createWorkspaceHandler } from './workspace-backend.mjs';
import { validateDocument } from '../src/model.js';
const args = process.argv.slice(2);
const value = (name, fallback) => args.includes(name) ? args[args.indexOf(name) + 1] : fallback;
const port = Number(value('--port', process.env.PORT || '4202'));
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Choose a port between 1024 and 65535');
const host = value('--host', '127.0.0.1');
const root = resolve(value('--dir', '.'));
const realRoot = await realpath(root);
const aiHandler = createAiHandler(await loadAiConfig(args));
const selectedDataDirectory = value('--data-dir', '');
const dataDirectory = selectedDataDirectory ? resolve(selectedDataDirectory) : undefined;
if (dataDirectory && [root, resolve('.')].some(folder => dataDirectory === folder || dataDirectory.startsWith(folder + sep))) throw new Error('Keep shared data outside the source and public app directories.');
if (dataDirectory) {
  await mkdir(dataDirectory, {recursive:true, mode:0o700});
  const actualDataDirectory = await realpath(dataDirectory);
  if ([realRoot, await realpath('.')].some(folder => actualDataDirectory === folder || actualDataDirectory.startsWith(folder + sep))) throw new Error('Keep shared data outside the source and public app directories, including symlinked ancestors.');
}
const workspaceHandler = await createWorkspaceHandler({dataDirectory, allowedOrigin: value('--public-origin', '') || undefined, validators: {'stencil-studio': validateDocument, 'clearcv': () => {throw new Error('This document belongs to another app.');}}});
const mime = { '.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.mjs':'text/javascript; charset=utf-8', '.css':'text/css; charset=utf-8', '.json':'application/json', '.svg':'image/svg+xml', '.png':'image/png', '.jpg':'image/jpeg', '.webp':'image/webp', '.ico':'image/x-icon', '.woff2':'font/woff2' };
const server = http.createServer(async (req, res) => {
  try {
    if (['127.0.0.1', 'localhost', '::1'].includes(host)) {
      const requestHost = new URL(`http://${req.headers.host || ''}`).hostname;
      if (!['127.0.0.1', 'localhost', '[::1]', ...(value('--public-origin', '') ? [new URL(value('--public-origin', '')).hostname] : [])].includes(requestHost)) { res.writeHead(403); return res.end('Open the app through its local address'); }
    }
    const requestPath = new URL(req.url, 'http://localhost').pathname;
    if (await workspaceHandler(req, res)) return;
    if (await aiHandler(req, res, requestPath)) return;
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405, {Allow:'GET, HEAD'}); return res.end(); }
    const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    const relative = pathname === '/' ? 'index.html' : pathname.slice(1);
    const allowed = ['index.html', 'styles.css', 'manifest.json', 'sw.js'].includes(relative) || relative.startsWith('src/') || relative.startsWith('public/');
    const file = resolve(root, relative);
    if (!allowed || !file.startsWith(root + sep) || relative.split('/').some(p => p.startsWith('.')) || !mime[extname(file)]) { res.writeHead(404); return res.end('Not found'); }
    if (!(await stat(file)).isFile()) { res.writeHead(404); return res.end('Not found'); }
    let checkedPath = realRoot;
    for (const component of relative.split('/')) {
      checkedPath = resolve(checkedPath, component);
      if ((await lstat(checkedPath)).isSymbolicLink()) { res.writeHead(404); return res.end('Not found'); }
    }
    const actualFile = await realpath(file);
    if (!actualFile.startsWith(realRoot + sep)) { res.writeHead(404); return res.end('Not found'); }
    const content = await readFile(actualFile);
    res.writeHead(200, {'Content-Type':mime[extname(file)], 'Cache-Control':'no-cache', 'X-Content-Type-Options':'nosniff', 'Referrer-Policy':'no-referrer'});
    res.end(req.method === 'HEAD' ? undefined : content);
  } catch (error) { res.writeHead(error.code === 'ENOENT' ? 404 : 400); res.end('Unable to serve this request'); }
});
server.on('error', error => { console.error(error.message); process.exitCode = 1; });
server.listen(port, host, () => console.log(`Stencil Studio running at http://${host}:${port}`));
for (const signal of ['SIGINT','SIGTERM']) process.once(signal, () => server.close(async () => { await workspaceHandler.close(); process.exit(0); }));
