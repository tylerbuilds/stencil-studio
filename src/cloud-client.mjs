/** Browser client for the optional same-origin workspace service. */
const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const TOKEN = /^[A-Za-z0-9_-]{43}$/;

export class CloudError extends Error {
  constructor(status, payload) {
    super(payload?.error?.message || 'The shared workspace request failed.');
    this.name = 'CloudError'; this.status = status; this.code = payload?.error?.code || 'request_failed';
    this.revision = payload?.revision; this.current = payload?.workspace;
  }
}

function connection(id, token) {
  if (!ID.test(id) || !TOKEN.test(token)) throw new TypeError('A valid shared workspace ID and token are required.');
}

export function shareLink({ id, token, baseURL = globalThis.location?.href }) {
  connection(id, token);
  const url = new URL(baseURL);
  if (!['http:', 'https:'].includes(url.protocol)) throw new TypeError('Share links need an HTTP(S) application URL.');
  url.hash = new URLSearchParams({ workspace: id, token }).toString();
  return url.href;
}

export function readShareLink(url = globalThis.location?.href) {
  try {
    const parsed = new URL(url);
    const params = new URLSearchParams(parsed.hash.slice(1));
    if (params.getAll('workspace').length !== 1 || params.getAll('token').length !== 1) return null;
    const id = params.get('workspace'); const token = params.get('token');
    connection(id, token);
    return { id, token };
  } catch { return null; }
}

export function createCloudClient({ baseURL = '/api/workspaces', fetchImpl = globalThis.fetch } = {}) {
  if (typeof fetchImpl !== 'function') throw new TypeError('Fetch is required.');
  if (typeof baseURL !== 'string' || !baseURL.startsWith('/') || baseURL.startsWith('//') || /[\u0000-\u0020\u007f?#\\]/.test(baseURL)) throw new TypeError('The workspace API must use a same-origin absolute path.');
  const normalized = new URL(baseURL, 'http://workspace-client.invalid');
  if (normalized.origin !== 'http://workspace-client.invalid' || normalized.pathname !== baseURL) throw new TypeError('The workspace API must use a same-origin absolute path.');
  const base = baseURL.replace(/\/$/, '');
  const request = async (route, { method = 'GET', token, body, signal } = {}) => {
    const headers = { Accept: 'application/json' };
    if (token) headers['X-Workspace-Token'] = token;
    if (body !== undefined) { headers['Content-Type'] = 'application/json'; headers['X-Workspace-Client'] = '1'; }
    const response = await fetchImpl(`${base}${route}`, { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      cache: 'no-store', credentials: 'omit', redirect: 'error', referrerPolicy: 'no-referrer', signal });
    let payload;
    try { payload = await response.json(); }
    catch { throw new CloudError(response.status, { error: { code: 'invalid_response', message: 'The workspace service returned an invalid response.' } }); }
    if (!response.ok) throw new CloudError(response.status, payload);
    return payload;
  };
  const scoped = (args, route, method, body) => { connection(args.id, args.token); return request(`/${args.id}${route}`, { token: args.token, method, body, signal: args.signal }); };
  const client = {
    status: ({ signal } = {}) => request('/status', { signal }),
    create: ({ kind, title, document, signal }) => request('', { method: 'POST', body: { kind, title, document }, signal }),
    open: args => scoped(args, '', 'GET'),
    update: args => scoped(args, '', 'PUT', { baseRevision: args.baseRevision, document: args.document, ...(args.title === undefined ? {} : { title: args.title }) }),
    comments: args => scoped(args, '/comments', 'GET'),
    addComment: args => scoped(args, '/comments', 'POST', { baseRevision: args.baseRevision, text: args.text, author: args.author }),
    revisions: args => scoped(args, '/revisions', 'GET'),
    setPermission: args => scoped(args, '/permissions', 'POST', { baseRevision: args.baseRevision, role: args.role, enabled: args.enabled }),
    watch({ id, token, revision, onChange, onError = () => {}, intervalMs = 1500, signal }) {
      connection(id, token);
      if (typeof onChange !== 'function' || typeof onError !== 'function') throw new TypeError('Watch callbacks must be functions.');
      const controller = new AbortController(); let timer; let stopped = false; let current = revision;
      const stop = () => { if (stopped) return; stopped = true; clearTimeout(timer); controller.abort(); signal?.removeEventListener('abort', stop); };
      const poll = async () => {
        try {
          const result = await client.open({ id, token, signal: controller.signal });
          if (!stopped && result.workspace.revision !== current) { current = result.workspace.revision; await onChange(result); }
        } catch (error) {
          if (!stopped) {
            try { await onError(error); } catch { /* Caller errors cannot strand the poller. */ }
            if (error instanceof CloudError && [403, 404, 503].includes(error.status)) stop();
          }
        } finally { if (!stopped) timer = setTimeout(poll, Math.min(60_000, Math.max(250, Number(intervalMs) || 1500))); }
      };
      if (signal?.aborted) stop();
      else { signal?.addEventListener('abort', stop, { once: true }); void poll(); }
      return stop;
    }
  };
  return client;
}
