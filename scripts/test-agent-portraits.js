'use strict';

/**
 * test:agentportraits. The full portraits (sync:agentportraits) are there for
 * every agent the data knows, each a WebP 720 pixels tall with its own
 * transparency, all together under the budget; shared/agent-portraits.js
 * names only those, refuses a Riot ID and League; and nothing in the Trainer
 * asks for one (trainer.md: nothing of Riot's in the Trainer).
 */

const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { portraitOf, portraitOfIcon } = require('../src/shared/agent-portraits');
const { iconKey } = require('../src/shared/agent-icons');
const DATA = require('../src/shared/valorant-data.generated.json');

const ROOT = path.join(__dirname, '..');
const DIR = path.join(ROOT, 'assets', 'agents-full');
const BUDGET = 4 * 1024 * 1024;
let n = 0;
const ok = (name) => { n++; console.log(`  ok  ${name}`); };

/** A WebP's canvas size and whether it says it has alpha (the VP8X chunk). */
function webpInfo(buf) {
  assert.strictEqual(buf.toString('ascii', 0, 4), 'RIFF', 'a RIFF file');
  assert.strictEqual(buf.toString('ascii', 8, 12), 'WEBP', 'a WebP');
  // Chromium refuses a WebP whose RIFF size is not its length (ffmpeg writing to a pipe leaves it 0).
  assert.strictEqual(buf.readUInt32LE(4) + 8, buf.length, 'the RIFF size is the file\'s length');
  assert.strictEqual(buf.toString('ascii', 12, 16), 'VP8X', 'the extended header, which carries the alpha flag');
  const flags = buf[20];
  const w = 1 + buf.readUIntLE(24, 3);
  const h = 1 + buf.readUIntLE(27, 3);
  return { w, h, alpha: !!(flags & 0x10) };
}

let total = 0;
for (const name of Object.keys(DATA.agents || {})) {
  const rel = portraitOf(name);
  assert.ok(rel, `${name} has a portrait path`);
  const file = path.join(ROOT, 'assets', rel);
  assert.ok(fs.existsSync(file), `${rel} is on disk (npm run sync:agentportraits)`);
  const buf = fs.readFileSync(file);
  const info = webpInfo(buf);
  assert.strictEqual(info.h, 720, `${rel} is 720 tall, not ${info.h}`);
  assert.ok(info.w > 150 && info.w < 900, `${rel} is a figure's width, not ${info.w}`);
  assert.ok(info.alpha, `${rel} keeps its transparency`);
  total += buf.length;
}
ok(`every one of the ${Object.keys(DATA.agents).length} agents has a 720 tall WebP with alpha`);
assert.ok(total < BUDGET, `all together ${(total / 1048576).toFixed(2)} MB, under ${BUDGET / 1048576} MB`);
ok(`all together ${(total / 1048576).toFixed(2)} MB, under the budget`);

const files = fs.readdirSync(DIR).filter((f) => f.endsWith('.webp'));
const known = new Set(Object.keys(DATA.agents).map(iconKey));
for (const f of files) assert.ok(known.has(f.replace(/\.webp$/, '')), `${f} is an agent the data knows`);
ok('no file for an agent the data does not know');

assert.strictEqual(portraitOf('Jett'), 'agents-full/Jett.webp');
assert.strictEqual(portraitOf('jett'), 'agents-full/Jett.webp');
assert.strictEqual(portraitOf('KAY/O'), 'agents-full/KAYO.webp');
assert.strictEqual(portraitOf('Someone#EUW'), null);
assert.strictEqual(portraitOf('Jett#1234'), null);
assert.strictEqual(portraitOf('Ahri'), null);
assert.strictEqual(portraitOf(''), null);
assert.strictEqual(portraitOf(null), null);
assert.strictEqual(portraitOf('../../etc'), null);
ok('portraitOf names a known agent only, never a Riot ID, League or a path');

assert.strictEqual(portraitOfIcon('valorant/agents/Jett.png'), 'agents-full/Jett.webp');
assert.strictEqual(portraitOfIcon('valorant/agents/KAYO.png'), 'agents-full/KAYO.webp');
assert.strictEqual(portraitOfIcon('lol/champions/Ahri.png'), null);
assert.strictEqual(portraitOfIcon('valorant/agents/Nobody.png'), null);
assert.strictEqual(portraitOfIcon('valorant/agents/../x.png'), null);
ok('portraitOfIcon reads a Valorant head icon path alone');

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));
}
const trainer = path.join(ROOT, 'src', 'renderer', 'trainer');
if (fs.existsSync(trainer)) {
  for (const f of walk(trainer).filter((x) => /\.(js|mjs|html|css)$/.test(x))) {
    const s = fs.readFileSync(f, 'utf8');
    assert.ok(!/agents-full|agent-portraits|portraitOf/.test(s), `${path.relative(ROOT, f)} asks for an agent portrait: the Trainer ships nothing of Riot's`);
  }
}
ok('the Trainer asks for no portrait');

console.log(`\ntest:agentportraits: ${n} passed`);
