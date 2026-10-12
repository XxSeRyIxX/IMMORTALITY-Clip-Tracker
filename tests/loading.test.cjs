const assert = require('node:assert/strict');
const { test } = require('node:test');
const { loadScript } = require('./helpers.cjs');

const { createLoader, checkLoad } = loadScript('loading.js', '({ createLoader, checkLoad })', { AbortController, DOMException });

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

test('the newest load cancels older work and owns the busy state', async () => {
  const busy = [];
  const commits = [];
  const firstRead = deferred();
  const secondRead = deferred();
  const loading = createLoader(value => busy.push(value), assert.fail);
  const first = loading(async signal => {
    await firstRead.promise;
    checkLoad(signal);
    commits.push('old');
  });
  await Promise.resolve();
  const second = loading(async signal => {
    await secondRead.promise;
    checkLoad(signal);
    commits.push('new');
  });
  firstRead.resolve();
  await first;
  assert.deepEqual(busy, [true, true]);
  assert.deepEqual(commits, []);
  secondRead.resolve();
  await second;
  assert.deepEqual(busy, [true, true, false]);
  assert.deepEqual(commits, ['new']);
});

test('errors from cancelled loads do not replace the current message', async () => {
  const errors = [];
  const read = deferred();
  const loading = createLoader(() => {}, error => errors.push(error.message));
  const first = loading(async () => {
    await read.promise;
    throw new Error('stale failure');
  });
  await Promise.resolve();
  await loading(async () => 'current');
  read.resolve();
  await first;
  assert.deepEqual(errors, []);
  await loading(async () => { throw new Error('current failure'); });
  assert.deepEqual(errors, ['current failure']);
});

test('work superseded before its first frame never starts', async () => {
  const frame = deferred();
  const starts = [];
  const loading = createLoader(() => {}, assert.fail, () => frame.promise);
  const first = loading(async () => { starts.push('old'); });
  const second = loading(async () => { starts.push('new'); return 'result'; });
  frame.resolve();
  await first;
  assert.equal(await second, 'result');
  assert.deepEqual(starts, ['new']);
});

test('closing an owner cancels pending work and permits a later load', async () => {
  const busy = [];
  const commits = [];
  const read = deferred();
  const loading = createLoader(value => busy.push(value), assert.fail);
  const pending = loading(async signal => {
    await read.promise;
    checkLoad(signal);
    commits.push('closed');
  });
  await Promise.resolve();
  loading.cancel();
  loading.cancel();
  assert.deepEqual(busy, [true, false]);
  read.resolve();
  await pending;
  assert.deepEqual(commits, []);
  assert.deepEqual(busy, [true, false]);
  assert.equal(await loading(async () => 'reopened'), 'reopened');
  assert.deepEqual(busy, [true, false, true, false]);
});