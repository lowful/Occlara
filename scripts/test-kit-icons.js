#!/usr/bin/env node
'use strict';

/**
 * The guns' and abilities' icons (npm run sync:kiticons, shared/kit-icons.js):
 * the index's shape, every gun the game data knows with a file on disk, every
 * agent's four abilities with theirs, and killIcon turning Riot's weapon name
 * into { kind, file, label } or null, never throwing on a word it does not know.
 *
 *   npm run test:kiticons
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const index = require(path.join(ROOT, 'src', 'shared', 'valorant-kit-icons.generated.json'));
const data = require(path.join(ROOT, 'src', 'shared', 'valorant-data.generated.json'));
const { killIcon } = require(path.join(ROOT, 'src', 'shared', 'kit-icons.js'));

let checks = 0;
let fails = 0;
const ok = (cond, what, detail) => {
  checks++;
  if (!cond) { fails++; console.log(`FAIL  ${what}${detail ? `\n        ${detail}` : ''}`); } else console.log(`ok    ${what}`);
};
const onDisk = (rel) => fs.existsSync(path.join(ROOT, 'assets', rel));
const isPng = (rel) => { try { return fs.readFileSync(path.join(ROOT, 'assets', rel)).subarray(0, 4).toString('hex') === '89504e47'; } catch { return false; } };

// ── The index's shape ───────────────────────────────────────────────────────
ok(index && typeof index.weapons === 'object' && typeof index.abilities === 'object', 'the index has weapons and abilities');
const FILE = /^[A-Za-z0-9-]+\.png$/;
ok(Object.values(index.weapons).every((f) => typeof f === 'string' && FILE.test(f)), 'every weapon file is a plain PNG name');

const guns = [...Object.keys(data.weapons || {}), 'melee'];
const missing = guns.filter((g) => { const k = killIcon(g); return !k || k.kind !== 'weapon' || !onDisk(k.file) || !isPng(k.file); });
ok(guns.length >= 15 && !missing.length, `every gun the game data knows, and the knife, has an icon on disk (${guns.length})`, missing.join(', '));

const agents = Object.keys(data.agents || {});
const noKit = agents.filter((a) => {
  const kit = index.abilities[a];
  return !Array.isArray(kit) || kit.length !== 4
    || !kit.every((x) => x && typeof x.name === 'string' && x.name && FILE.test(x.file) && ['Ability1', 'Ability2', 'Grenade', 'Ultimate'].includes(x.slot) && isPng(`valorant/abilities/${x.file}`));
});
ok(agents.length >= 20 && !noKit.length, `every agent the game data knows has its four ability icons on disk (${agents.length})`, noKit.join(', '));
const keys = Object.values(index.abilities).flat().map((x) => x.key);
ok(keys.every((k) => ['Q', 'E', 'C', 'X'].includes(k)), 'each ability carries its key from the game data');

const bytes = [
  ...Object.values(index.weapons).map((f) => `valorant/weapons/${f}`),
  ...Object.values(index.abilities).flat().map((x) => `valorant/abilities/${x.file}`),
].reduce((n, rel) => n + fs.statSync(path.join(ROOT, 'assets', rel)).size, 0);
ok(bytes < 3 * 1024 * 1024, `the icons stay under 3 MB (${Math.round(bytes / 1024)} KB)`);

// ── killIcon ────────────────────────────────────────────────────────────────
const v = killIcon('Vandal');
ok(v && v.kind === 'weapon' && v.file === 'valorant/weapons/Vandal.png' && v.label === 'Vandal', 'a gun is a weapon with its kill feed icon', JSON.stringify(v));
ok(JSON.stringify(killIcon('vandal')) === JSON.stringify(v) && JSON.stringify(killIcon(' VANDAL ')) === JSON.stringify(v), 'in any case and spacing');
ok(killIcon('Melee') && killIcon('Melee').file === 'valorant/weapons/Melee.png', 'the knife is Melee');

const hh = killIcon('Headhunter');
ok(hh && hh.kind === 'ability' && hh.file === 'valorant/abilities/Chamber-Ability1.png' && hh.label === 'Headhunter',
  'an ability Riot names is the ability with its icon', JSON.stringify(hh));
ok(JSON.stringify(killIcon('Headhunter', 'Chamber')) === JSON.stringify(hh), 'and the same in its own agent\'s kit');
ok(killIcon('Headhunter', 'Jett') === null, 'but never under another agent the index knows');
ok(killIcon('Blade Storm', 'Jett') && killIcon('Blade Storm', 'Jett').file === 'valorant/abilities/Jett-Ultimate.png', 'a kit with a space in its name');
ok(killIcon('Headhunter', 'Somebody#NA1') && killIcon('Headhunter', 'Somebody#NA1').kind === 'ability', 'an agent word the index does not know is no hint');

const junk = [undefined, null, '', '   ', 'Weapon', 'Ability', 'Ultimate', 'Someone#NA1', '../../etc/passwd', 'Vandal.png', 42, {}, [], 'valorant/weapons/Vandal'];
let threw = false;
let any = false;
for (const j of junk) {
  try { if (killIcon(j) !== null) any = true; } catch { threw = true; }
  try { if (killIcon(j, j) !== null) any = true; } catch { threw = true; }
}
ok(!threw && !any, 'a word that names no gun or ability is null, and nothing throws');

const all = [...guns, ...Object.values(index.abilities).flat().map((x) => x.name)].map((n) => killIcon(n)).filter(Boolean);
ok(all.every((k) => /^valorant\/(weapons\/[A-Za-z0-9]+|abilities\/[A-Za-z0-9]+-[A-Za-z0-9]+)\.png$/.test(k.file)),
  'every file it names fits the pattern the pages draw');

const DASHES = new RegExp('[\\u2013\\u2014]');
ok(!DASHES.test(fs.readFileSync(path.join(ROOT, 'src', 'shared', 'kit-icons.js'), 'utf8'))
  && !DASHES.test(fs.readFileSync(path.join(ROOT, 'scripts', 'sync-kit-icons.js'), 'utf8'))
  && !DASHES.test(JSON.stringify(index)), 'no dash in the helper, the sync or the index');

console.log(`\n${fails ? `${fails} of ${checks} failed` : `all ${checks} passed`}`);
process.exit(fails ? 1 : 0);
