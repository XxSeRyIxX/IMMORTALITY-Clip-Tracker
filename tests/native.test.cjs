const assert = require('node:assert/strict');
const { test } = require('node:test');
const { loadScript } = require('./helpers.cjs');

const Tracker = loadScript('core.js', 'Tracker');
const createBridge = loadScript('native.js', 'createNativeBridge', { Tracker });

function connection(send) {
  let receive;
  const sent = [];
  const ask = createBridge({
    receiveMessage: callback => { receive = callback; },
    sendMessage: raw => {
      const message = JSON.parse(raw);
      sent.push(message);
      if (send) send(message);
    },
  });
  return { ask, sent, reply: raw => receive(raw) };
}

test('native requests receive their own replies in order', async () => {
  const bridge = connection();
  const first = bridge.ask('find');
  const second = bridge.ask('read', 'SaveGame.abr');
  await Promise.resolve();
  assert.deepEqual(bridge.sent, [{ cmd: 'find' }]);
  bridge.reply('{"ok":true,"value":"first"}');
  assert.equal((await first).value, 'first');
  await Promise.resolve();
  assert.deepEqual(bridge.sent[1], { cmd: 'read', path: 'SaveGame.abr' });
  bridge.reply('{"ok":true,"value":"second"}');
  assert.equal((await second).value, 'second');
});

test('a failed native request does not block queued requests', async () => {
  const bridge = connection();
  const failure = assert.rejects(bridge.ask('find'), /not found/);
  const next = bridge.ask('open');
  await Promise.resolve();
  bridge.reply('{"error":"not found"}');
  await failure;
  await Promise.resolve();
  assert.equal(bridge.sent.length, 2);
  bridge.reply('{"cancelled":true}');
  assert.equal((await next).cancelled, true);
});

test('malformed replies and transport failures leave the bridge usable', async () => {
  let failSend = true;
  const bridge = connection(() => {
    if (failSend) throw new Error('send failed');
  });
  await assert.rejects(bridge.ask('find'), /send failed/);
  failSend = false;
  const malformed = assert.rejects(bridge.ask('find'));
  await Promise.resolve();
  bridge.reply('not json');
  await malformed;
  bridge.reply('{"ok":true}');
  const next = bridge.ask('find');
  await Promise.resolve();
  bridge.reply('{"ok":true,"value":"recovered"}');
  assert.equal((await next).value, 'recovered');
});