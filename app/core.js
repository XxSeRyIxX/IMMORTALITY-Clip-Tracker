'use strict';

/**
 * Save parsing and clip logic. No DOM, no globals beyond `Tracker` (its texts come
 * from `I18n`), and no ES modules so the same file works over http:// and inside
 * the native shell.
 */
const Tracker = (() => {

const CORRUPT = 'not a readable save';

/**
 * Cheap check before committing to a full parse: an MS-NRBF stream opens with a
 * SerializedStreamHeader, which is record type 0 followed by two ids and the
 * version pair 1.0. Anything else is some other kind of file.
 */
function looksLikeSave(bytes) {
  if (!bytes || bytes.length < 17 || bytes[0] !== 0) return false;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return view.getInt32(9, true) === 1 && view.getInt32(13, true) === 0;
}

/* ------------------------------------------------------------------ *
 * MS-NRBF reader
 * SaveGame.abr is a .NET BinaryFormatter stream. Only the records the
 * save actually uses are implemented, but the walk is a full one so the
 * stream stays in sync.
 * ------------------------------------------------------------------ */

class Ref {
  constructor(target) { this.target = target; }
}

// Fixed-size primitives by MS-NRBF type code: [bytes, DataView getter].
const FIXED = {
  1: [1, 'getUint8'], 2: [1, 'getUint8'], 6: [8, 'getFloat64'], 7: [2, 'getInt16'],
  8: [4, 'getInt32'], 9: [8, 'getBigInt64'], 10: [1, 'getInt8'], 11: [4, 'getFloat32'],
  12: [8, 'getBigInt64'], 13: [8, 'getBigInt64'], 14: [2, 'getUint16'], 15: [4, 'getUint32'],
  16: [8, 'getBigUint64'],
};

class Nrbf {
  constructor(buffer) {
    this.view = new DataView(buffer);
    this.bytes = new Uint8Array(buffer);
    this.pos = 0;
    this.classes = new Map();
    this.objects = new Map();
    this.rootId = 0;
    this.utf8 = new TextDecoder('utf-8');
  }

  parse() {
    // A damaged stream can otherwise keep producing plausible-looking records.
    let budget = 4_000_000;
    while (this.pos < this.bytes.length) {
      if (budget-- <= 0) throw new Error(CORRUPT);
      if (this.record().kind === 'end') return this.objects.get(this.rootId);
    }
    throw new Error(CORRUPT);
  }

  deref(value) {
    let hops = 0;
    while (value instanceof Ref && hops++ < 64) value = this.objects.get(value.target);
    return value;
  }

  /** Every item costs at least one byte, so no count can exceed what is left. */
  bounded(count) {
    if (!Number.isInteger(count) || count < 0 || count > this.bytes.length - this.pos) {
      throw new Error(CORRUPT);
    }
    return count;
  }

  need(size) {
    if (this.pos + size > this.bytes.length) throw new Error(CORRUPT);
  }

  byte() {
    if (this.pos >= this.bytes.length) throw new Error(CORRUPT);
    return this.bytes[this.pos++];
  }

  int32() {
    this.need(4);
    const v = this.view.getInt32(this.pos, true);
    this.pos += 4;
    return v;
  }

  string() {
    let length = 0, shift = 0, b;
    do {
      b = this.byte();
      length |= (b & 0x7f) << shift;
      shift += 7;
      if (shift > 35) throw new Error(CORRUPT);
    } while (b & 0x80);
    this.bounded(length);
    const s = this.utf8.decode(this.bytes.subarray(this.pos, this.pos + length));
    this.pos += length;
    return s;
  }

  primitive(type) {
    if (type === 5 || type === 18) return this.string();     // Decimal travels as text, like String
    const p = this.pos;
    if (type === 3) {                                         // Char: one UTF-8 sequence
      this.need(1);
      const b0 = this.bytes[p];
      const n = b0 < 0x80 ? 1 : b0 < 0xe0 ? 2 : b0 < 0xf0 ? 3 : 4;
      this.need(n);
      this.pos += n;
      return this.utf8.decode(this.bytes.subarray(p, p + n));
    }
    const [size, getter] = FIXED[type] || [];
    if (!size) throw new Error(CORRUPT);
    this.need(size);
    this.pos += size;
    const value = this.view[getter](p, true);
    return type === 1 ? value !== 0 : value;
  }

  primitives(objectId, length, type) {
    const arr = [];
    for (let i = 0; i < length; i++) arr.push(this.primitive(type));
    this.objects.set(objectId, arr);
    return arr;
  }

  /** What follows a member's binary type: a primitive type code, or a class name to skip. */
  typeInfo(binaryType) {
    if (binaryType === 0 || binaryType === 7) return this.byte();
    if (binaryType === 3) this.string();
    if (binaryType === 4) { this.string(); this.int32(); }
    return null;
  }

  members(objectId, cls) {
    const obj = {};
    this.objects.set(objectId, obj);            // register first so cycles resolve
    cls.names.forEach((name, i) => {
      obj[name] = cls.types && cls.types[i] === 0
        ? this.primitive(cls.extra[i])
        : this.value();
    });
    return obj;
  }

  classRecord(withTypes, withLibrary) {
    const objectId = this.int32();
    this.string();                              // class name
    const count = this.bounded(this.int32());
    const names = [];
    for (let i = 0; i < count; i++) names.push(this.string());

    let types = null, extra = null;
    if (withTypes) {
      types = [];
      extra = [];
      for (let i = 0; i < count; i++) types.push(this.byte());
      for (let i = 0; i < count; i++) extra.push(this.typeInfo(types[i]));
    }
    if (withLibrary) this.int32();

    const cls = { names, types, extra };
    this.classes.set(objectId, cls);
    return this.members(objectId, cls);
  }

  elements(objectId, length) {
    this.bounded(length);
    const arr = new Array(length).fill(null);
    this.objects.set(objectId, arr);
    let i = 0;
    while (i < length) {
      const r = this.record();
      if (r.kind === 'none') continue;
      if (r.kind === 'end') break;
      if (r.kind === 'null') { i += r.count; continue; }
      arr[i++] = r.value;
    }
    return arr;
  }

  binaryArray() {
    const objectId = this.int32();
    const arrayType = this.byte();
    const rank = this.bounded(this.int32());
    let length = 1;
    for (let i = 0; i < rank; i++) length *= this.int32();
    this.bounded(length);
    if (arrayType >= 3 && arrayType <= 5) for (let i = 0; i < rank; i++) this.int32();

    const binType = this.byte();
    const primType = this.typeInfo(binType);
    return binType === 0
      ? this.primitives(objectId, length, primType)
      : this.elements(objectId, length);
  }

  value() {
    while (this.pos < this.bytes.length) {
      const r = this.record();
      if (r.kind === 'val') return r.value;
      if (r.kind !== 'none') return null;
    }
    return null;
  }

  record() {
    const type = this.byte();
    switch (type) {
      case 0:                                   // SerializedStreamHeader
        this.rootId = this.int32();
        this.pos += 12;
        return { kind: 'none' };
      case 1: {                                 // ClassWithId
        const objectId = this.int32();
        const metadataId = this.int32();
        return { kind: 'val', value: this.members(objectId, this.classes.get(metadataId)) };
      }
      case 2: return { kind: 'val', value: this.classRecord(false, false) };
      case 3: return { kind: 'val', value: this.classRecord(false, true) };
      case 4: return { kind: 'val', value: this.classRecord(true, false) };
      case 5: return { kind: 'val', value: this.classRecord(true, true) };
      case 6: {                                 // BinaryObjectString
        const objectId = this.int32();
        const value = this.string();
        this.objects.set(objectId, value);
        return { kind: 'val', value };
      }
      case 7: return { kind: 'val', value: this.binaryArray() };
      case 8: return { kind: 'val', value: this.primitive(this.byte()) };
      case 9: return { kind: 'val', value: new Ref(this.int32()) };
      case 10: return { kind: 'null', count: 1 };
      case 11: return { kind: 'end' };
      case 12: this.int32(); this.string(); return { kind: 'none' };
      case 13: return { kind: 'null', count: this.byte() };
      case 14: return { kind: 'null', count: this.int32() };
      case 15: {                                // ArraySinglePrimitive
        const objectId = this.int32();
        const length = this.bounded(this.int32());
        return { kind: 'val', value: this.primitives(objectId, length, this.byte()) };
      }
      case 16: case 17: {
        const objectId = this.int32();
        return { kind: 'val', value: this.elements(objectId, this.bounded(this.int32())) };
      }
      default:
        throw new Error(CORRUPT);
    }
  }
}

/** An error carrying a second line of advice for the UI to show. */
function saveError(message, hint) {
  const error = new Error(message);
  error.hint = hint;
  return error;
}

/** The error for a file named `name` (or none), worded by the `error.` and `hint.` texts of `key`. */
const fileError = (key, name, hint = key) =>
  saveError(I18n.t(`error.${key}`, I18n.fileLabel(name)), I18n.t(`hint.${hint}`));

const notSave = name => fileError('notSave', name);

function checkSaveSize(size, name) {
  if (size > 32 * 1024 * 1024) throw fileError('tooBig', name);
}

/** Returns { watched: Map<id,{views,secret}>, hosts: Map<id,hostId>, themes: [a,b,c] }. */
function readSave(buffer, name) {
  checkSaveSize(buffer.byteLength, name);
  const bytes = new Uint8Array(buffer);
  if (!looksLikeSave(bytes)) throw notSave(name);

  const reader = new Nrbf(buffer);
  let root;
  try {
    root = reader.parse();
  } catch {
    throw fileError('unreadable', name, 'damaged');
  }
  if (!root || !root.Game) throw fileError('otherGame', name);

  const game = reader.deref(root.Game);
  const history = reader.deref(game.ViewHistory);
  const items = reader.deref(history?._items) || [];
  const size = Math.min(Number(history?._size) || 0, items.length);

  const watched = new Map();
  for (let i = 0; i < size; i++) {
    const viewed = reader.deref(items[i]);
    if (!viewed) continue;
    watched.set(Number(viewed.ClipID), {
      views: Number(viewed.Views),
      secret: !!viewed.IsSupernatural,
    });
  }

  // Randomised per playthrough: which clip each free-floating secret landed in.
  const hosts = new Map();
  const assigned = reader.deref(game.AssignedSecrets);
  const pairs = assigned ? reader.deref(assigned.KeyValuePairs) : null;
  for (const entry of pairs || []) {
    const pair = reader.deref(entry);
    if (pair) hosts.set(Number(pair.key), Number(pair.value));
  }

  if (!watched.size) throw fileError('empty', name);
  // Three hidden scores every newly watched clip adds to; the ending needs some of each.
  const themes = ['TotalThemeA', 'TotalThemeB', 'TotalThemeC'].map(key => Number(game[key]));
  return { watched, hosts, themes };
}

/* ------------------------------------------------------------------ *
 * Clips
 *
 * Everything here comes from app/clips.json, which tools/make-data.py reads
 * out of the game itself, so the app only joins it to the save.
 * ------------------------------------------------------------------ */

const label = clip => clip.date ? `${clip.title} (${clip.date})` : clip.title;

/**
 * The clips in the interface language. clips.json has the game's English in its rows and, beside them, the
 * game's own words in each other language: films, first lines, and objects by their English names.
 */
function buildClips(data, save) {
  // Clips already holding a free-floating secret, which keep it for good.
  const taken = new Set(save.hosts.values());
  const progress = gameProgress(data, save);
  const words = data[I18n.lang()] ?? {};
  const others = Object.keys(data).filter(key => key !== 'clips').map(key => data[key]);
  // "Other" is the app's word for clips outside the three films.
  const film = movie => (movie === 'Other' ? t('movie.Other') : words.films?.[movie] ?? movie);
  return data.clips.map(row => {
    const seen = save.watched.get(row.id);
    const line = words.lines?.[row.id] ?? row.line;
    const clip = {
      ...row,
      line,
      film: film(row.movie),
      watched: !!seen,
      secret: row.kind === 'Secret',
      views: seen ? seen.views : 0,
      // Plain fields, not getters: these are read once per row on every redraw.
      // The app builds the clips again when the interface language changes.
      title: row.take ? `${film(row.movie)} ${row.take}` : film(row.movie),
      subtitle: [row.date, line].filter(Boolean).join('  \u00b7  '),
      // What a player may type from the game in any of its languages, whichever the tracker shows.
      names: [row.movie, ...others.map(other => other.films?.[row.movie])].filter(Boolean),
      lines: [row.line, ...others.map(other => other.lines?.[row.id])].filter(Boolean),
    };
    if (row.routes) clip.routes = row.routes.map(route => ({ ...route, object: words.objects?.[route.object] ?? route.object }));
    // A free-floating secret can be in any clip of its pool. The save knows
    // which one it landed in, or else which of them are still free.
    if (row.pool) {
      const host = save.hosts.get(row.id);
      const open = row.enter.filter(way => host ? way.from === host : !taken.has(way.from));
      clip.enter = open.length ? open : row.enter;
      clip.placed = !!host && open.length > 0;
    }
    if (row.ending) clip.ending = endingProgress(row.ending, save);
    if (row.gate) {
      clip.progress = progress;
      clip.heldBack = progress === null || progress < row.gate;
    }
    return clip;
  });
}

/**
 * How much of the game the save has seen, in percent, measured as the game
 * measures it for every gate: the theme scores so far over their maximum.
 * Each ending threshold is a quarter of one of those maximums.
 */
function gameProgress(data, save) {
  const quarters = data.clips.find(row => row.ending)?.ending.themes;
  if (!quarters || save.themes.some(Number.isNaN)) return null;
  const sum = values => values.reduce((a, b) => a + b, 0);
  return 100 * sum(save.themes) / (4 * sum(quarters));
}

function endingProgress(need, save) {
  const seen = [...save.watched.values()];
  return {
    ...need,
    watched: save.watched.size,
    secretsSeen: seen.filter(clip => clip.secret).length,
    missing: need.clips.filter(id => !save.watched.has(id)),
    themesMet: save.themes.some(Number.isNaN) ? null
      : need.themes.every((amount, i) => save.themes[i] >= amount - 0.001),
  };
}

/* ------------------------------------------------------------------ *
 * Marking by hand
 *
 * For anyone with no save file to read, on a console for instance. The marks
 * stand in for the save's view history, and since the first view of a clip
 * adds its theme to the three hidden scores, its rounded weights estimate them.
 * ------------------------------------------------------------------ */

function markedSave(data, found) {
  const watched = new Map();
  const themes = [0, 0, 0];
  for (const row of data.clips) {
    if (!found.has(row.id)) continue;
    watched.set(row.id, { views: 0, secret: row.kind === 'Secret' });
    row.theme.forEach((amount, i) => { themes[i] += amount; });
  }
  return { watched, hosts: new Map(), themes };
}

// A progress code: one bit per clip and a check byte, short enough to paste anywhere.
const CODE = 'ICT1-';
const check = bytes => bytes.reduce((sum, byte, i) => (sum * 31 + byte + i) & 255, 7);
const encodeBytes = bytes => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

function encodeMarks(found, count) {
  const bytes = new Uint8Array(Math.ceil(count / 8) + 1);
  for (const id of found) {
    if (Number.isInteger(id) && id >= 1 && id <= count) bytes[(id - 1) >> 3] |= 1 << ((id - 1) & 7);
  }
  bytes[bytes.length - 1] = check(bytes.subarray(0, -1));
  return CODE + encodeBytes(bytes);
}

/** The marks in a code, wherever it sits in the text, or null if it is not one or was mistyped. */
function decodeMarks(text, count) {
  const match = /ICT1-([A-Za-z0-9_-]+)/.exec(String(text));
  if (!match) return null;
  if (count !== undefined && (!Number.isInteger(count) || count < 1
    || match[1].length !== Math.ceil((Math.ceil(count / 8) + 1) * 4 / 3))) return null;
  let bytes;
  try {
    bytes = Uint8Array.from(atob(match[1].replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
    if (encodeBytes(bytes) !== match[1]) return null;
  } catch {
    return null;
  }
  if (bytes.length < 2 || bytes[bytes.length - 1] !== check(bytes.subarray(0, -1))) return null;
  const found = new Set();
  for (let bit = 0; bit < (bytes.length - 1) * 8; bit++) {
    if (bytes[bit >> 3] & (1 << (bit & 7))) {
      if (count !== undefined && bit >= count) return null;
      found.add(bit + 1);
    }
  }
  return found;
}

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july',
  'august', 'september', 'october', 'november', 'december'];
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio',
  'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

const plain = text => String(text).normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .toLowerCase().replace(/['\u2019]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();

/** Whether one typed word names something the game shows under this clip, or its number. */
function namesClip(word, clip) {
  // "Other" is the app's word; the game writes no film under those clips.
  const films = clip.movie === 'Other' ? [] : clip.names ?? [clip.movie];
  if (/[a-z]/.test(word) && films.some(name => name.toLowerCase().startsWith(word))) return true;
  if (clip.take && word === clip.take.toLowerCase()) return true;
  if (!/^\d+$/.test(word)) {
    const month = clip.date && Number(clip.date.split('/')[1]);
    if (word.length < 3 || !month) return false;
    // English always, as before; Spanish as well with the Spanish interface.
    return MONTHS[month - 1].startsWith(word) || (I18n.lang() === 'es' && MESES[month - 1].startsWith(word));
  }
  const n = Number(word);
  if (n === clip.id) return true;
  if (!clip.date) return false;
  // Day and month in either order, as the game's two date formats show them.
  const [day, month, year] = clip.date.split('/').map(Number);
  return n === day || n === month || n === year || (word.length === 2 && n === year % 100);
}

/**
 * The clips a search names, best first: those where every word matches what
 * the game writes under the clip (film, take, date) or its number, then those
 * whose first line contains what was typed. `byLine` says which it was.
 */
function findClips(clips, query) {
  const typed = plain(query);
  // The film the game writes as 2OE, and 2DC in Spanish, is called this in full; lines keep the words.
  const words = typed.replace(/\btwo of everything\b/g, '2oe').replace(/\bdos de cada\b/g, '2dc').split(' ').filter(Boolean);
  if (!words.length) return [];
  const named = [], said = [];
  for (const clip of clips) {
    if (words.every(word => namesClip(word, clip))) named.push({ clip, byLine: false });
    else if (typed.length >= 3 && (clip.lines ?? [clip.line]).some(line => plain(line).includes(typed))) said.push({ clip, byLine: true });
  }
  return named.concat(said);
}

/** Seconds into a clip, written the way a player reads a scrubber. */
const clock = seconds => {
  const whole = Math.max(0, Math.round(seconds));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
};

const { t, tn } = I18n;
const step = (text, note = '', pic = '', mark = null) => ({ text, note, pic, mark });

function cutStep(route, byId) {
  const from = byId.get(route.shot);
  const note = [
    route.at !== undefined ? t('route.at', clock(route.at)) : '',
    // Only when no ordinary clip holds the object; the generator avoids it otherwise.
    from.secret ? t('route.fromSecret') : '',
    route.lands === 1 ? t('route.always') : tn(route.mutual ? 'route.orToMutual' : 'route.orTo', route.lands - 1),
    // Already said above when they are the very clips it can cut to.
    route.also && !route.mutual ? tn('route.also', route.also) : '',
  ].filter(Boolean).join('  \u00b7  ');
  return step(t('route.cut', route.object, label(from)),
    note, route.pic || String(route.shot), route.box || null);
}

// What to press (route.slow, route.fast or route.reversed): a secret opens only in
// its own speed range, and the arrow keys swap direction inside a clip that plays reversed.
function rewindStep(way, byId) {
  const host = byId.get(way.from);
  const [from, to] = way.at;
  const when = to - from < 1 ? t('route.past', clock(from)) : t('route.between', clock(to), clock(from));
  // A secret's own picture is not shown until the player has found it.
  return step(t('route.rewind', host.id, label(host), when), t(`route.${way.speed}`), host.secret ? '' : String(host.id));
}

function secretSteps(clip, byId) {
  const ways = clip.enter || [];
  if (clip.pool && !clip.placed) {
    const more = ways.length - 3;
    return [
      step(ways.length > 1 ? t('route.anyOf', ways.length) : t('route.this'), tn('route.chance', ways.length)),
      ...ways.slice(0, 3).map(way => rewindStep(way, byId)),
      ...(more > 0 ? [step(tn('route.more', more))] : []),
    ];
  }
  // A secret inside a secret: walk back to the ordinary clip the chain starts in.
  const chain = [];
  for (let at = clip; at && at.secret && at.enter && chain.length < 8; at = byId.get(at.enter[0].from)) {
    chain.unshift(at.enter[0]);
  }
  return chain.map(way => rewindStep(way, byId));
}

function endingSteps(e) {
  const tally = (have, need) => have >= need ? t('route.done') : t('route.have', have);
  return [
    step(t('route.watch', e.watch), tally(e.watched, e.watch)),
    step(t('route.secrets', e.secrets), tally(e.secretsSeen, e.secrets)),
    step(t('route.clips', I18n.list(e.clips, 'and')), e.missing.length ? t('route.toFind', e.missing.join(', ')) : t('route.done')),
    step(t('route.scores'),
      e.themesMet === null ? t('route.adds') : e.themesMet ? t('route.done') : t('route.notYet')),
    step(t('route.key', e.key.length, I18n.list(e.clips, 'or')), t('route.starts')),
    step(t('route.credits')),
  ];
}

/**
 * How to reach a clip, as steps of { text, note, pic, mark }: `pic` names a
 * picture in pictures.json and `mark` is the box to ring on it.
 */
function routeFor(clip, byId) {
  if (clip.ending) return endingSteps(clip.ending);
  const steps = clip.secret ? secretSteps(clip, byId) : clip.routes.map(route => cutStep(route, byId));
  if (clip.heldBack) {
    steps.push(step(t('route.gate', Math.round(clip.gate)),
      clip.progress === null ? t('route.held') : t('route.progress', Math.floor(clip.progress))));
  }
  return steps;
}

return {
  looksLikeSave, saveError, notSave, checkSaveSize, readSave, buildClips, routeFor,
  markedSave, encodeMarks, decodeMarks, findClips,
};
})();
