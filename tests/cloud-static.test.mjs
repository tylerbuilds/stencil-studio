import test from 'node:test';
import assert from 'node:assert/strict';
import { createCloudClient } from '../src/cloud-client.mjs';

test('opening sharing on GitHub Pages makes no request to its absent backend', async t => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'location');
  Object.defineProperty(globalThis, 'location', { configurable: true, value: { hostname: 'tylerbuilds.github.io' } });
  t.after(() => {
    if (previous) Object.defineProperty(globalThis, 'location', previous);
    else delete globalThis.location;
  });
  let calls = 0;
  const client = createCloudClient({ fetchImpl: async () => { calls++; throw new Error('Static hosting has no workspace route.'); } });
  assert.deepEqual(await client.status(), { enabled: false });
  assert.equal(calls, 0);
});
