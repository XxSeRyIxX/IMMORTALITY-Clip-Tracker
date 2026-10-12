const assert = require('node:assert/strict');
const { test } = require('node:test');
const { readApp, loadScript } = require('./helpers.cjs');

function worker({ fetch, cached, put = async () => {} } = {}) {
  const handlers = new Map();
  const writes = [];
  let claims = 0;
  let deletions = 0;
  const cache = {
    put: async (...args) => { writes.push(args); await put(...args); },
  };
  const shell = loadScript('sw.js', 'SHELL', {
    URL,
    fetch: fetch || (async () => new Response('live')),
    self: {
      location: { origin: 'https://example.test' },
      addEventListener: (name, handler) => handlers.set(name, handler),
      clients: { claim: async () => { claims++; } },
    },
    caches: {
      open: async () => cache,
      match: async () => cached?.clone(),
      keys: async () => ['ict', 'another-app'],
      delete: async () => { deletions++; },
    },
  });
  function dispatch(name, request) {
    const lifetimes = [];
    let response;
    handlers.get(name)({
      request,
      waitUntil: promise => lifetimes.push(promise),
      respondWith: promise => { response = promise; },
    });
    return { lifetimes, response };
  }
  return { shell, dispatch, writes, claims: () => claims, deletions: () => deletions };
}

test('the offline shell includes every page script', () => {
  const { shell } = worker();
  for (const [, script] of readApp('index.html').matchAll(/<script src="([^"]+)"/g)) {
    assert.ok(shell.includes(script), `${script} is not cached for offline use`);
  }
});

test('activation claims clients without deleting another app cache', async () => {
  const instance = worker();
  await Promise.all(instance.dispatch('activate').lifetimes);
  assert.equal(instance.claims(), 1);
  assert.equal(instance.deletions(), 0);
});

test('cache writes extend the worker lifetime', async () => {
  let finishWrite;
  const pending = new Promise(resolve => { finishWrite = resolve; });
  const instance = worker({ put: () => pending });
  const event = instance.dispatch('fetch', new Request('https://example.test/app.js'));
  assert.equal(await (await event.response).text(), 'live');
  assert.equal(event.lifetimes.length, 1);
  assert.equal(instance.writes.length, 1);
  finishWrite();
  await Promise.all(event.lifetimes);
  assert.equal(await instance.writes[0][1].text(), 'live');
});

test('cache write failures do not break a successful network response', async () => {
  const instance = worker({ put: async () => { throw new Error('quota'); } });
  const event = instance.dispatch('fetch', new Request('https://example.test/app.js'));
  assert.equal(await (await event.response).text(), 'live');
  await Promise.all(event.lifetimes);
});

test('cached files survive network and HTTP failures', async () => {
  for (const fetch of [
    async () => { throw new Error('offline'); },
    async () => new Response('unavailable', { status: 503 }),
  ]) {
    const instance = worker({ fetch, cached: new Response('cached') });
    const event = instance.dispatch('fetch', new Request('https://example.test/app.js'));
    assert.equal(await (await event.response).text(), 'cached');
    assert.equal(instance.writes.length, 0);
  }
});

test('an uncached HTTP error is returned unchanged', async () => {
  const instance = worker({ fetch: async () => new Response('missing', { status: 404 }) });
  const event = instance.dispatch('fetch', new Request('https://example.test/missing.js'));
  assert.equal((await event.response).status, 404);
});

test('foreign-origin and non-GET requests are left alone', () => {
  const instance = worker();
  for (const request of [
    new Request('https://another.test/app.js'),
    new Request('https://example.test/save', { method: 'POST' }),
  ]) {
    assert.equal(instance.dispatch('fetch', request).response, undefined);
  }
});