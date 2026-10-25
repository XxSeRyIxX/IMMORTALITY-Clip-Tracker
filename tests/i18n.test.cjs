const assert = require('node:assert/strict');
const { test } = require('node:test');
const { readApp, loadScript } = require('./helpers.cjs');

const I18n = loadScript('i18n.js', 'I18n');
const Tracker = loadScript('core.js', 'Tracker', { I18n });
const data = JSON.parse(readApp('clips.json'));
const scripts = ['core.js', 'native.js', 'app.js'].map(name => readApp(name)).join('\n');

const placeholders = text => [...text.matchAll(/\{\d+\}/g)].map(m => m[0]).sort().join();

/** Runs fn with the interface in Spanish, then puts English back. */
function inSpanish(fn) {
  I18n.setLang('es');
  try {
    return fn();
  } finally {
    I18n.setLang('en');
  }
}

test('English and Spanish have the same texts with the same placeholders', () => {
  const { en, es } = I18n.STRINGS;
  assert.deepEqual(Object.keys(es).sort(), Object.keys(en).sort());
  for (const key of Object.keys(en)) assert.equal(placeholders(es[key]), placeholders(en[key]), key);
});

test('every text the scripts ask for exists, and every text is used', () => {
  const keys = Object.keys(I18n.STRINGS.en);
  // Put together at run time, so no literal names them.
  const used = new Set(['file.named', 'file.that', 'movie.Other', 'and', 'or', 'kind.Clip', 'kind.Secret',
    'route.slow', 'route.fast', 'route.reversed', 'error.unreadable', 'hint.damaged',
    ...['movie', 'take', 'date', 'kind', 'status', 'watched'].map(key => `detail.${key}`),
    ...['tooBig', 'notSave', 'otherGame', 'empty'].flatMap(key => [`error.${key}`, `hint.${key}`]),
    ...['route.orTo', 'route.orToMutual'].flatMap(key => [`${key}.one`, `${key}.other`])]);
  for (const [, call, key] of scripts.matchAll(/\b(t|tn)\('([^']+)'/g)) {
    if (call === 'tn') used.add(`${key}.one`).add(`${key}.other`);
    else used.add(key);
  }
  assert.deepEqual([...used].filter(key => !keys.includes(key)), [], 'asked for but missing');
  assert.deepEqual(keys.filter(key => !used.has(key)), [], 'never used');
});

test('every translated part of the page has its Spanish, and nothing else does', () => {
  const page = readApp('index.html');
  const keys = new Set([...page.matchAll(/data-i18n(?:-[a-z-]+)?="([^"]+)"/g)].map(m => m[1]));
  assert.deepEqual([...keys].filter(key => !(key in I18n.PAGE_ES)), []);
  assert.deepEqual(Object.keys(I18n.PAGE_ES).filter(key => !keys.has(key)), []);
  // The Spanish is set as HTML: it may hold formatting and links, never scripts or handlers.
  for (const [key, html] of Object.entries(I18n.PAGE_ES)) {
    assert.doesNotMatch(html, /<script|\son\w+\s*=|javascript:/i, key);
  }
});

test('counts, lists and file names follow the language', () => {
  assert.equal(I18n.tn('list.count', 1), '1 clip');
  assert.equal(I18n.tn('list.count', 2), '2 clips');
  assert.equal(I18n.list([1, 2, 3], 'and'), '1, 2 and 3');
  assert.equal(I18n.list([7], 'or'), '7');
  assert.equal(I18n.fileLabel(''), 'That file');
  inSpanish(() => {
    assert.equal(I18n.tn('code.loaded', 1), 'Cargado 1 vídeo encontrado.');
    assert.equal(I18n.list([1, 2, 3], 'or'), '1, 2 o 3');
    assert.equal(I18n.fileLabel('SaveGame.abr'), '«SaveGame.abr»');
    assert.throws(() => Tracker.readSave(new ArrayBuffer(0), 'x.abr'), { message: '«x.abr» no es una partida guardada de IMMORTALITY.' });
  });
  assert.equal(I18n.langForBrowser(['es-ES', 'en']), 'es');
  assert.equal(I18n.langForBrowser(['en-GB', 'es']), 'en');
  assert.equal(I18n.langForBrowser(['fr', 'es-MX']), 'es');
  assert.equal(I18n.langForBrowser(['fr']), 'en');
  assert.equal(I18n.langForBrowser(undefined), 'en');
});

test('the game\'s own Spanish names every film, line and object it translates', () => {
  const objects = new Set(data.clips.flatMap(clip => (clip.routes || []).map(route => route.object)));
  // People keep their names: two words with capitals, or a single first name.
  for (const name of [...objects].filter(name => !(name in data.es.objects))) {
    assert.match(name, /^[A-Z][a-z]+( [A-Z][a-z]+)*( De [A-Z][a-z]+)?$/, name);
  }
  assert.deepEqual(Object.keys(data.es.objects).filter(name => !objects.has(name)), []);
  assert.deepEqual(data.clips.filter(clip => clip.line && !data.es.lines[clip.id]).map(clip => clip.id), []);
  assert.deepEqual(data.es.films, { '2OE': '2DC' });

  const ids = new Set(data.clips.map(clip => clip.id));
  const clips = inSpanish(() => Tracker.buildClips(data, Tracker.markedSave(data, ids)));
  const byId = new Map(clips.map(clip => [clip.id, clip]));
  assert.equal(byId.get(1).line, 'Oye… Quiero algo nuevo…');
  assert.equal(byId.get(288).line, 'El final');
  assert.ok(clips.filter(clip => clip.movie === '2OE').every(clip => clip.film === '2DC' && clip.title.startsWith('2DC')));
  assert.ok(clips.some(clip => clip.routes?.some(route => route.object === 'Reloj')));
  assert.equal(Tracker.buildClips(data, Tracker.markedSave(data, ids))[0].line, data.clips[0].line);
});

test('a search finds what the game shows in English or Spanish, whichever the tracker shows', () => {
  const ids = new Set(data.clips.map(clip => clip.id));
  for (const spanish of [false, true]) {
    const clips = spanish ? inSpanish(() => Tracker.buildClips(data, Tracker.markedSave(data, ids))) : Tracker.buildClips(data, Tracker.markedSave(data, ids));
    const found = query => Array.from(Tracker.findClips(clips, query), hit => hit.clip.id);
    assert.deepEqual(found('quiero algo nuevo').slice(0, 1), [1]);
    assert.deepEqual(found('I want something new').slice(0, 1), [1]);
    assert.deepEqual(found('2DC 37'), found('2OE 37'));
    assert.deepEqual(found('dos de cada 37'), found('two of everything 37'));
    assert.ok(found('2DC 37').length > 0);
  }
});

test('every route is worded in Spanish with nothing left over', () => {
  const ids = new Set(data.clips.map(clip => clip.id));
  const routes = () => {
    const clips = Tracker.buildClips(data, Tracker.markedSave(data, ids));
    const byId = new Map(clips.map(clip => [clip.id, clip]));
    return clips.map(clip => Tracker.routeFor(clip, byId));
  };
  const english = routes();
  const spanish = inSpanish(routes);
  spanish.forEach((steps, i) => steps.forEach((step, j) => {
    for (const text of [step.text, step.note]) assert.doesNotMatch(text, /\{\d\}|undefined|NaN/);
    assert.notEqual(step.text, english[i][j].text);
  }));
  // A clip outside the four films is named in the interface language.
  assert.ok(inSpanish(() => Tracker.buildClips(data, Tracker.markedSave(data, ids))).some(clip => clip.title === 'Otros'));
});

test('Spanish month names find clips only with the Spanish interface', () => {
  const clips = [{ id: 4, movie: 'Minsky', take: '4B', date: '27/07/1970', line: '' }];
  const ids = query => inSpanish(() => Array.from(Tracker.findClips(clips, query), hit => hit.clip.id));
  assert.equal(Tracker.findClips(clips, 'Minsky julio').length, 0);
  assert.deepEqual(ids('Minsky julio 27'), [4]);
  assert.deepEqual(ids('Minsky July'), [4]);
});
