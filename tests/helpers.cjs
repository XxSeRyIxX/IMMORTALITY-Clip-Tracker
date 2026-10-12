const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const vm = require('node:vm');

const appPath = join(__dirname, '..', 'app');
const readApp = (name, encoding = 'utf8') => readFileSync(join(appPath, name), encoding);

function loadScript(name, expression, globals = {}) {
  return vm.runInNewContext(readApp(name) + '\n' + expression, {
    TextDecoder, atob, btoa, ...globals,
  }, { filename: name });
}

function saveFixture(root) {
  const parts = [];
  const objects = new Map();
  const byte = value => parts.push(Buffer.from([value]));
  const int = value => {
    const buffer = Buffer.alloc(4);
    buffer.writeInt32LE(value);
    parts.push(buffer);
  };
  const text = value => {
    const buffer = Buffer.from(value, 'utf8');
    let length = buffer.length;
    while (length >= 128) { byte((length & 127) | 128); length = Math.floor(length / 128); }
    byte(length);
    parts.push(buffer);
  };
  function value(item) {
    if (item === null) { byte(10); return; }
    if (typeof item === 'boolean') { byte(8); byte(1); byte(Number(item)); return; }
    if (typeof item === 'number') {
      byte(8);
      if (Number.isInteger(item)) { byte(8); int(item); }
      else {
        byte(6);
        const buffer = Buffer.alloc(8);
        buffer.writeDoubleLE(item);
        parts.push(buffer);
      }
      return;
    }
    if (typeof item !== 'object') throw new TypeError('Unsupported fixture value.');
    if (objects.has(item)) { byte(9); int(objects.get(item)); return; }
    const id = objects.size + 1;
    objects.set(item, id);
    if (Array.isArray(item)) {
      byte(16); int(id); int(item.length);
      item.forEach(value);
    } else {
      const entries = Object.entries(item);
      byte(2); int(id); text('Fixture' + id); int(entries.length);
      entries.forEach(([name]) => text(name));
      entries.forEach(([, member]) => value(member));
    }
  }
  byte(0); int(1); int(-1); int(1); int(0);
  value(root);
  byte(11);
  return Uint8Array.from(Buffer.concat(parts)).buffer;
}

module.exports = { readApp, loadScript, saveFixture };