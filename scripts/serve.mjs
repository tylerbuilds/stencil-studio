import http from 'node:http';
import { constants as fsConstants } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { open, lstat, realpath, mkdir } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { loadAiConfig, createAiHandler } from './ai.mjs';
import { createWorkspaceHandler } from './workspace-backend.mjs';
import { validateDocument } from '../src/model.js';
const args = process.argv.slice(2);
const value = (name, fallback) => {
  if (!args.includes(name)) return fallback;
  const selected = args[args.indexOf(name) + 1];
  if (!selected || selected.startsWith('--') || /[\u0000-\u001f\u007f]/.test(selected)) throw new Error(`Provide a value for the ${name} option.`);
  return selected;
};
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
const mime = { '.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.mjs':'text/javascript; charset=utf-8', '.css':'text/css; charset=utf-8', '.json':'application/json', '.txt':'text/plain; charset=utf-8', '.svg':'image/svg+xml', '.png':'image/png', '.jpg':'image/jpeg', '.webp':'image/webp', '.ico':'image/x-icon', '.woff2':'font/woff2' };
const MAX_STATIC_BYTES = 64 * 1024 * 1024;
const server = http.createServer({ requestTimeout: 30000, headersTimeout: 15000 }, async (req, res) => {
  let handle;
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
    let checkedPath = realRoot;
    for (const component of relative.split('/')) {
      checkedPath = resolve(checkedPath, component);
      if ((await lstat(checkedPath)).isSymbolicLink()) { res.writeHead(404); return res.end('Not found'); }
    }
    const actualFile = await realpath(file);
    if (!actualFile.startsWith(realRoot + sep)) { res.writeHead(404); return res.end('Not found'); }
    // A FIFO must never reach a blocking open. Nonblocking mode also keeps a
    // file swapped after this check from tying up a request or filesystem worker.
    const candidate = await lstat(actualFile);
    if (!candidate.isFile() || candidate.isSymbolicLink() || candidate.nlink !== 1) { res.writeHead(404); return res.end('Not found'); }
    handle = await open(actualFile, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW | fsConstants.O_NONBLOCK);
    const info = await handle.stat();
    if (!info.isFile() || info.nlink !== 1) { res.writeHead(404); return res.end('Not found'); }
    if (info.size > MAX_STATIC_BYTES) { res.writeHead(413); return res.end('This asset is too large to serve'); }
    // Bind the response to the checked file rather than following an alias
    // again during reading. HEAD needs its metadata, not a buffer of its bytes.
    const checked = await lstat(actualFile);
    if (checked.isSymbolicLink() || checked.dev !== info.dev || checked.ino !== info.ino || await realpath(file) !== actualFile) { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, {'Content-Type':mime[extname(file)], 'Content-Length':info.size, 'Cache-Control':'no-cache', 'X-Content-Type-Options':'nosniff', 'Referrer-Policy':'no-referrer'});
    if (req.method === 'HEAD' || info.size === 0) return res.end();
    await pipeline(handle.createReadStream({autoClose:false, end:info.size - 1}), res);
  } catch (error) {
    if (res.headersSent || res.destroyed) { res.destroy(); return; }
    res.writeHead(['ENOENT','ENOTDIR','ELOOP'].includes(error.code) ? 404 : 400); res.end('Unable to serve this request');
  } finally { await handle?.close(); }
});
server.on('error', error => { console.error(error.message); process.exitCode = 1; });
server.listen(port, host, () => console.log(`Stencil Studio running at http://${host}:${port}`));
for (const signal of ['SIGINT','SIGTERM']) process.once(signal, () => server.close(async () => { await workspaceHandler.close(); process.exit(0); }));
