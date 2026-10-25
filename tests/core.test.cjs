const assert = require('node:assert/strict');
const { readdirSync } = require('node:fs');
const { join } = require('node:path');
const { test } = require('node:test');
const vm = require('node:vm');
const { readApp, loadScript, saveFixture } = require('./helpers.cjs');

const I18n = loadScript('i18n.js', 'I18n');
const Tracker = loadScript('core.js', 'Tracker', { I18n });
const data = JSON.parse(readApp('clips.json'));
const ids = new Set(data.clips.map(clip => clip.id));

test('every shipped clip survives a progress-code round trip', () => {
  const selections = [new Set(), ids, ...data.clips.map(clip => new Set([clip.id]))];
  for (const found of selections) {
    const code = Tracker.encodeMarks(found, data.clips.length);
    assert.deepEqual(Array.from(Tracker.decodeMarks(code)), [...found]);
    assert.deepEqual(Array.from(Tracker.decodeMarks(code, data.clips.length)), [...found]);
    assert.deepEqual(Array.from(Tracker.decodeMarks(`Progress backup\n${code}\n`)), [...found]);
  }
});

test('damaged and unrelated progress codes are rejected', () => {
  const code = Tracker.encodeMarks(new Set([1]), data.clips.length);
  const changed = code.slice(0, 10) + (code[10] === 'A' ? 'B' : 'A') + code.slice(11);
  for (const invalid of ['', 'not a code', 'ICT1-', code.slice(0, -1), changed]) {
    assert.equal(Tracker.decodeMarks(invalid), null);
  }
});

test('strict imports reject partial and wrong-size codes without changing the format', () => {
  const count = data.clips.length;
  const found = new Set([1]);
  const code = Tracker.encodeMarks(found, count);
  for (let end = 5; end < code.length; end++) {
    assert.equal(Tracker.decodeMarks(code.slice(0, end), count), null);
  }
  assert.equal(Tracker.decodeMarks(Tracker.encodeMarks(found, 8), count), null);
  assert.equal(Tracker.decodeMarks(Tracker.encodeMarks(new Set([16]), 16), 9), null);
  assert.deepEqual(Array.from(Tracker.decodeMarks(`Backup\n${code}\n`, count)), [1]);
  assert.equal(code, 'ICT1-AQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA-A');
});

test('progress codes use canonical base64 and integer clip identifiers', () => {
  const code = Tracker.encodeMarks(new Set([1]), data.clips.length);
  assert.equal(Tracker.decodeMarks(code.slice(0, -1) + 'B'), null);
  const invalidIds = new Set([0, -1, 1.5, '1', NaN, Infinity, data.clips.length + 1]);
  assert.equal(Tracker.decodeMarks(Tracker.encodeMarks(invalidIds, data.clips.length)).size, 0);
});

test('manual marks reconstruct the shipped clip scores without mutating metadata', () => {
  const original = JSON.stringify(data);
  const empty = Tracker.markedSave(data, new Set());
  assert.equal(empty.watched.size, 0);
  assert.deepEqual(Array.from(empty.themes), [0, 0, 0]);
  const save = Tracker.markedSave(data, ids);
  assert.equal(save.watched.size, ids.size);
  assert.equal(save.hosts.size, 0);
  const totals = [0, 0, 0];
  for (const clip of data.clips) {
    clip.theme.forEach((amount, axis) => { totals[axis] += amount; });
    assert.equal(save.watched.get(clip.id).secret, clip.kind === 'Secret');
  }
  assert.deepEqual(Array.from(save.themes), totals);
  const clips = Tracker.buildClips(data, save);
  const byId = new Map(clips.map(clip => [clip.id, clip]));
  assert.ok(clips.every(clip => clip.watched));
  for (const clip of clips) assert.ok(Tracker.routeFor(clip, byId).length > 0);
  assert.equal(JSON.stringify(data), original);
});

test('search accepts the game date formats and film aliases', () => {
  const clips = [
    { id: 4, movie: 'Minsky', take: '4B', date: '27/07/1970', line: "I don't remember." },
    { id: 5, movie: '2OE', take: '3A', date: '09/01/1999', line: 'Two of everything, please.' },
  ];
  for (const query of ['MINSKY 4B 27/7/1970', 'Minsky 4B 7/27/70', 'Minsky 4B 1970. 7. 27.', 'Minsky 4B July 27']) {
    assert.deepEqual(Array.from(Tracker.findClips(clips, query), hit => hit.clip.id), [4]);
  }
  assert.deepEqual(Array.from(Tracker.findClips(clips, 'two of everything 3a'), hit => hit.clip.id), [5]);
  assert.equal(Tracker.findClips(clips, "don't remember")[0].byLine, true);
  assert.equal(Tracker.findClips(clips, 'two of everything please')[0].byLine, true);
  assert.equal(Tracker.findClips(clips, ' ').length, 0);
});

test('invalid and truncated saves produce actionable errors', () => {
  assert.throws(() => Tracker.readSave(new ArrayBuffer(0)), /not an IMMORTALITY save/);
  const truncated = new Uint8Array(17);
  truncated[9] = 1;
  assert.equal(Tracker.looksLikeSave(truncated), true);
  assert.throws(() => Tracker.readSave(truncated.buffer), /could not be read/);
});

test('a synthetic save reads history, references, assignments and scores', () => {
  const ordinary = { ClipID: 1, Views: 2, IsSupernatural: false };
  const secret = { ClipID: 5, Views: 1, IsSupernatural: true };
  const unused = { ClipID: 999, Views: 1, IsSupernatural: false };
  const buffer = saveFixture({
    Game: {
      ViewHistory: { _size: 3, _items: [ordinary, secret, ordinary, unused] },
      AssignedSecrets: { KeyValuePairs: [{ key: 279, value: 1 }] },
      TotalThemeA: 1.25, TotalThemeB: 2.5, TotalThemeC: 0.75,
    },
  });
  const save = Tracker.readSave(buffer);
  assert.deepEqual(Array.from(save.watched.keys()), [1, 5]);
  assert.equal(save.watched.get(1).views, 2);
  assert.equal(save.watched.get(1).secret, false);
  assert.equal(save.watched.get(5).secret, true);
  assert.deepEqual(Array.from(save.hosts, pair => Array.from(pair)), [[279, 1]]);
  assert.deepEqual(Array.from(save.themes), [1.25, 2.5, 0.75]);
  assert.throws(() => Tracker.readSave(buffer.slice(0, -1)), /could not be read/);
});

test('well-formed unrelated and empty saves receive distinct errors', () => {
  assert.throws(() => Tracker.readSave(saveFixture({ OtherGame: {} })), /not from IMMORTALITY/);
  assert.throws(() => Tracker.readSave(saveFixture({ Game: { ViewHistory: { _size: 0, _items: [] } } })), /no clips watched yet/);
});

test('oversized saves are rejected before parsing', () => {
  assert.doesNotThrow(() => Tracker.checkSaveSize(1024, 'SaveGame.abr'));
  assert.throws(() => Tracker.checkSaveSize(32 * 1024 * 1024 + 1, 'SaveThumbnail.abr'), /too big to be a save/);
  assert.throws(() => Tracker.readSave(new ArrayBuffer(33 * 1024 * 1024)), /too big to be a save/);
});

test('clip identifiers, references and packed pictures are consistent', () => {
  const index = JSON.parse(readApp('pictures.json'));
  const archive = readApp('pictures.pack', null);
  assert.equal(ids.size, data.clips.length);
  for (const [position, clip] of data.clips.entries()) {
    assert.equal(clip.id, position + 1);
    assert.equal(clip.theme.length, 3);
    assert.ok(clip.theme.every(Number.isFinite));
    const length = Math.hypot(...clip.theme);
    assert.ok(length === 0 || Math.abs(length - 1) < 0.0001);
    assert.ok(index.at[String(clip.id)]);
    for (const route of clip.routes || []) {
      assert.ok(ids.has(route.shot));
      assert.ok(index.at[route.pic]);
      assert.equal(route.box.length, 4);
      assert.ok(route.box.every(Number.isFinite));
    }
    for (const entrance of clip.enter || []) assert.ok(ids.has(entrance.from));
  }
  for (const [name, [offset, length]] of Object.entries(index.at)) {
    assert.ok(offset >= 0 && length > 12 && offset + length <= archive.length, name);
    assert.equal(archive.toString('ascii', offset, offset + 4), 'RIFF', name);
    assert.equal(archive.toString('ascii', offset + 8, offset + 12), 'WEBP', name);
  }
});

test('all shipped scripts have valid JavaScript syntax', () => {
  for (const name of ['i18n.js', 'core.js', 'loading.js', 'native.js', 'app.js', 'sw.js']) {
    assert.doesNotThrow(() => new vm.Script(readApp(name), { filename: name }));
  }
});

test('nothing the site ships has a name download managers take over, even when the page only reads it', () => {
  // IDM's default file types: in Chrome it takes these over from a page's own requests, and the page never gets them.
  const grabbed = /\.(3gp|7z|aac|ace|aif|apk|arj|asf|avi|bin|bz2|exe|gz|gzip|img|iso|lzh|m4a|m4v|mkv|mov|mp3|mp4|mpa|mpe|mpeg|mpg|msi|msu|ogg|ogv|pdf|plj|pps|ppt|qt|r\d\d|ra|rar|rm|rmvb|sea|sit|sitx|tar|tif|tiff|wav|webm|wma|wmv|z|zip)$/i;
  const shipped = readdirSync(join(__dirname, '..', 'app'), { recursive: true }).map(String);
  assert.deepEqual(shipped.filter(name => grabbed.test(name)), []);
});