'use strict';

/**
 * FIGHT IT AGAIN (src/shared/trainer-replay.js, src/main/services/trainer-store.js):
 * which of the player's own deaths a saved Valorant review can replay in the
 * Trainer, and what each replay is. Held here: the shape on the sample
 * library's reviews (scripts/fixtures/proof-reviews.js, built from the real
 * Abyss match and Riot's record of it), every null case, every cause key to one
 * situation, every weapon in the game data to one class, the range rule, the
 * line's words (no Riot ID, no #, no dash), replaysOf's order and cap, the
 * review's marks, and main's half on a fake store: refused mid match, fresh and
 * seen, a replay opened by its id, and a replay run saved.
 *
 * npm run test:trainerreplay
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const R = require('../src/shared/trainer-replay');
const T = require('../src/shared/trainer-math');
const causes = require('../src/shared/death-causes');
const verify = require('../src/shared/valorant-verify');
const DATA = require('../src/shared/valorant-data.generated.json');
const { createTrainer } = require('../src/main/services/trainer-store');
const proof = require('./fixtures/proof-reviews');

let passed = 0;
let failed = 0;
const ok = (cond, what, detail) => {
  if (cond) { passed += 1; console.log(`ok    ${what}`); } else { failed += 1; console.log(`FAIL  ${what}${detail !== undefined ? `  (${detail})` : ''}`); }
};
const EM = String.fromCharCode(8212);
const EN = String.fromCharCode(8211);
const clone = (x) => JSON.parse(JSON.stringify(x));

// ── The sample library: the real Abyss match, built and looked at ────────────
const NOW = 1763500000000;
const HOUR = 3600000;
const b = proof.build({ now: NOW });
const NEW_ID = 'valorant-1763500000000-abcd12';
const OLD_ID = 'valorant-1763496400000-efgh34';
const newest = { ...clone(b.built), id: NEW_ID, at: NOW };
const looked = { ...clone(b.builtLooked), id: OLD_ID, at: NOW - HOUR };

// ── The shape ────────────────────────────────────────────────────────────────
const KEYS = ['id', 'reviewId', 'round', 'at', 'map', 'agent', 'title', 'line', 'spec'];
const SPEC_KEYS = ['dist', 'range', 'killerWeapon', 'side', 'afterPlant', 'cause', 'situation', 'enemies', 'flagged'];
{
  const all = looked.rounds.map((c) => R.replayOf(looked, c)).filter(Boolean);
  const died = looked.rounds.filter((c) => c.died).length;
  ok(all.length === died && died === 21, `every one of the sample's 21 deaths is a replay (${all.length} of ${died})`);
  const bad = all.filter((x) => JSON.stringify(Object.keys(x)) !== JSON.stringify(KEYS) || JSON.stringify(Object.keys(x.spec)) !== JSON.stringify(SPEC_KEYS));
  ok(!bad.length, 'each replay has exactly the keys, and its spec exactly its keys', bad.map((x) => x.id).join(', '));
  ok(all.every((x) => x.id === `${OLD_ID}:${x.round}` && x.reviewId === OLD_ID && x.title === `Round ${x.round}` && x.at === NOW - HOUR),
    'its id is "<reviewId>:<round>", its title "Round n", its time the match\'s');
  ok(all.every((x) => x.map === 'Abyss' && x.agent === 'Jett'), 'its map and the player\'s agent are the review\'s');
  ok(all.every((x) => ['close', 'mid', 'long'].includes(x.spec.range) && R.SITUATION_KINDS.includes(x.spec.situation)
    && [1, 2, 3].includes(x.spec.enemies) && typeof x.spec.flagged === 'boolean'
    && (x.spec.side === 'attack' || x.spec.side === 'defence') && typeof x.spec.afterPlant === 'boolean'
    && (x.spec.killerWeapon === null || R.CLASSES.includes(x.spec.killerWeapon))),
  'every spec field is one of its values');
  ok(all.every((x) => x.spec.dist === null), 'a review saved before the distance was kept has none, never a guess');

  const r2 = R.replayOf(looked, 2);
  ok(r2 && r2.line === 'Killed by Viper with a sniper, 15 seconds into the round, on defence.', 'round 2: Riot\'s Marshal is a sniper, 15 s in, on defence', r2 && r2.line);
  ok(r2 && r2.spec.range === 'long' && r2.spec.cause === 'isolated' && r2.spec.situation === 'rotate' && r2.spec.afterPlant === false,
    'round 2: no distance, so long from the sniper; the look\'s cause, caught alone, is a rotate', JSON.stringify(r2 && r2.spec));
  const r6 = R.replayOf(looked, 6);
  ok(r6 && r6.line === 'Killed by Skye with a rifle, after the plant, on defence.' && r6.spec.afterPlant === true && r6.spec.range === 'mid',
    'round 6: a Phantom is a rifle, after the plant, mid with no distance', r6 && r6.line);
  ok(r6 && r6.spec.enemies === 2, 'round 6: the player\'s own kill 0.6 s before the death puts two enemies in the fight', r6 && r6.spec.enemies);
  const n6 = R.replayOf(newest, 6);
  ok(n6 && n6.spec.cause === null && n6.spec.situation === 'duel', 'with no look the counted mistakes decide: round 6 of the newest, the same killer, is a duel', JSON.stringify(n6 && n6.spec));
  const n23 = R.replayOf(newest, 23);
  ok(n23 && n23.spec.situation === 'peek', 'the first death of a round on attack is a peek (round 23)', n23 && n23.spec.situation);
  const n2 = R.replayOf(newest, 2);
  ok(n2 && n2.spec.situation === 'hold', 'the first death of a round on defence is no peek: early, a hold (round 2)', n2 && n2.spec.situation);
}

// ── The null cases ───────────────────────────────────────────────────────────
{
  const card = (n, o) => ({ n, died: true, sideKey: 'attacking', riot: { sec: 20, killer: 'Jett', weapon: 'Vandal', afterPlant: false, feed: [] }, ...(o || {}) });
  const rv = (rounds, o) => ({ id: NEW_ID, at: NOW, kind: 'valorant', game: { map: 'Bind', agent: 'Sova' }, rounds, ...(o || {}) });
  ok(R.replayOf(rv([card(3)]), 3) !== null, 'a plain death with Riot\'s record is a replay');
  ok(R.replayOf({ ...rv([card(3)]), kind: 'lol' }, 3) === null, 'not a Valorant review: null');
  ok(R.replayOf(rv([card(3)], { locked: true }), 3) === null, 'a locked review: null');
  ok(R.replayOf(rv([card(3)], { id: undefined }), 3) === null && R.replayOf(rv([card(3)], { id: 'Brindlecap#EU1' }), 3) === null, 'no review id, or one that is not one: null');
  ok(R.replayOf(rv([card(3)]), 4) === null && R.replayOf(rv([card(3)]), 0) === null && R.replayOf(rv([card(3)]), '3') === null, 'a round the review has not: null');
  ok(R.replayOf(rv([card(3, { died: false })]), 3) === null, 'a round the player survived: null');
  ok(R.replayOf(rv([card(3, { riot: { ...card(3).riot, afk: true } })]), 3) === null
    && R.replayOf(rv([card(3, { riot: { ...card(3).riot, inSpawn: true } })]), 3) === null, 'a round the player sat out: null');
  ok(R.replayOf(rv([card(3, { riot: null })]), 3) === null, 'a death the screen saw and nothing else knows: null');
  ok(R.replayOf(rv([card(3, { riot: { sec: null, killer: null, weapon: null, afterPlant: false } })]), 3) === null,
    'a death Riot confirms with no second, killer, gun or distance: null');
  ok(R.replayOf(rv([card(3, { riot: null, forensics: { cause: 'unclear' } })]), 3) === null, 'an unclear look alone is nothing known: null');
  const lookOnly = R.replayOf(rv([card(3, { riot: null, forensics: { cause: 'dry-peek', source: 'screen' } })]), 3);
  ok(lookOnly && lookOnly.spec.cause === 'dry-peek' && lookOnly.spec.situation === 'peek' && lookOnly.spec.afterPlant === null
    && lookOnly.spec.range === 'mid' && lookOnly.line === 'Killed, on attack.', 'a look from the screen alone is a replay, plant unknown as null', JSON.stringify(lookOnly));
  ok(R.replayOf(null, 1) === null && R.replayOf('x', 1) === null && R.replayOf(rv('x'), 1) === null, 'garbage: null, never a throw');
}

// ── Every cause to one situation ─────────────────────────────────────────────
{
  const keys = Object.keys(causes.CAUSES);
  ok(keys.length === 10, `death-causes.js names its 10 causes (${keys.join(', ')})`);
  for (const k of keys) {
    ok(Object.prototype.hasOwnProperty.call(R.SITUATIONS, k) && R.SITUATION_KINDS.includes(R.SITUATIONS[k]), `the cause ${k} maps to one situation, ${R.SITUATIONS[k]}`);
  }
  const WANT = { 'dry-peek': 'peek', 'repeek': 'peek', 'overextend': 'peek', 'first-death': 'peek',
    'crossfire': 'hold', 'same-spot': 'hold', 'exposed': 'hold', 'early': 'hold',
    'rotating': 'rotate', 'isolated': 'rotate', 'caught-alone': 'rotate', 'untraded': 'rotate',
    'lost-duel': 'duel', 'same-killer': 'duel', 'one-v-one': 'duel', 'no-escape': 'duel', 'unclear': 'duel' };
  ok(JSON.stringify(R.SITUATIONS) === JSON.stringify(WANT), 'the table is the one written down');
  // Every fact key the table reads is a key insights.js counts.
  const insightsSrc = fs.readFileSync(path.join(ROOT, 'src', 'shared', 'insights.js'), 'utf8');
  const KEY_RE = /key: '([a-z-]+)'/g;
  ok(KEY_RE.test("key: 'same-spot'"), 'the insights key pattern matches a known key');
  KEY_RE.lastIndex = 0;
  const insightKeys = new Set();
  for (let m = KEY_RE.exec(insightsSrc); m; m = KEY_RE.exec(insightsSrc)) insightKeys.add(m[1]);
  for (const k of Object.keys(R.SITUATIONS).filter((x) => !keys.includes(x))) ok(insightKeys.has(k), `the fact key ${k} is one insights.js counts`);
  for (const k of R.FACT_ORDER) ok(Object.prototype.hasOwnProperty.call(R.SITUATIONS, k), `the fact key ${k} decides a situation`);
  ok(R.situationOf('lost-advantage') === 'duel' && R.situationOf(null) === 'duel' && R.situationOf('__proto__') === 'duel' && R.situationOf('toString') === 'duel',
    'any other key, and none, is a duel');
  // Through replayOf, each cause on a look.
  for (const k of keys) {
    const rv = { id: NEW_ID, at: NOW, kind: 'valorant', rounds: [{ n: 4, died: true, sideKey: 'defending', riot: null, forensics: { cause: k, source: 'riot' } }] };
    const x = R.replayOf(rv, 4);
    if (k === 'unclear') ok(x === null, 'an unclear look alone is no replay');
    else ok(x && x.spec.cause === k && x.spec.situation === R.SITUATIONS[k], `a look of ${k} replays as ${R.SITUATIONS[k]}`);
  }
  ok(R.replayOf({ id: NEW_ID, kind: 'valorant', rounds: [{ n: 4, died: true, riot: null, forensics: { cause: 'not-a-cause' } }] }, 4) === null,
    'a cause the list does not name is no cause');
}

// ── Every weapon to one class ────────────────────────────────────────────────
{
  const names = Object.keys(DATA.weapons || {});
  ok(names.length >= 19, `the game data names its weapons (${names.length})`);
  for (const w of names) ok(R.CLASSES.includes(R.weaponClass(w)) && R.weaponClass(w) !== 'ability', `${w} has a weapon class, ${R.weaponClass(w)}`);
  const WANT = { Vandal: 'rifle', Phantom: 'rifle', Bulldog: 'rifle', Guardian: 'rifle', Operator: 'sniper', Marshal: 'sniper', Outlaw: 'sniper',
    Spectre: 'smg', Stinger: 'smg', Judge: 'shotgun', Bucky: 'shotgun', Shorty: 'shotgun', Classic: 'pistol', Ghost: 'pistol', Sheriff: 'pistol',
    Frenzy: 'pistol', Odin: 'heavy', Ares: 'heavy', Melee: 'melee' };
  const wrong = Object.entries(WANT).filter(([w, c]) => R.weaponClass(w) !== c);
  ok(!wrong.length, 'the classes are the ones written down, in Riot\'s spelling', JSON.stringify(wrong));
  ok(R.weaponClass('Headhunter') === 'ability' && R.weaponClass('Tour De Force') === 'ability', 'a kit\'s weapon (Headhunter, Tour De Force) is an ability');
  ok(verify.NOT_A_WEAPON.every((w) => R.weaponClass(w) === null) && R.weaponClass('') === null && R.weaponClass(null) === null && R.weaponClass('Brindlecap1') === null,
    'a word that names no weapon, and an unknown name, is no class');
}

// ── The range rule ───────────────────────────────────────────────────────────
{
  ok(R.rangeOf(0, null) === 'close' && R.rangeOf(9.9, 'sniper') === 'close', 'under 10 m is close, whatever the gun');
  ok(R.rangeOf(10, null) === 'mid' && R.rangeOf(25, 'smg') === 'mid', '10 to 25 m is mid');
  ok(R.rangeOf(25.1, null) === 'long' && R.rangeOf(60, 'shotgun') === 'long', 'over 25 m is long');
  ok(R.rangeOf(null, 'sniper') === 'long' && R.rangeOf(null, 'smg') === 'close' && R.rangeOf(null, 'shotgun') === 'close' && R.rangeOf(null, 'melee') === 'close',
    'with no distance, a sniper long, an SMG, a shotgun and the knife close');
  ok(['rifle', 'pistol', 'heavy', 'ability', null].every((c) => R.rangeOf(null, c) === 'mid'), 'and anything else, or no gun, mid');
  const c = clone(looked.rounds.find((x) => x.n === 2));
  c.riot.dist = 23.4;
  const x = R.replayOf({ ...looked, rounds: [c] }, 2);
  ok(x && x.spec.dist === 23.4 && x.spec.range === 'mid' && x.line === 'Killed by Viper with a sniper from 23 metres, 15 seconds into the round, on defence.',
    'a distance Riot measured beats the gun: a sniper from 23 m is mid, and the line says the metres', x && x.line);
  c.riot.dist = 3;
  const y = R.replayOf({ ...looked, rounds: [c] }, 2);
  ok(y && y.spec.range === 'close' && /up close/.test(y.line), 'a kill from 3 m is close, "up close"', y && y.line);
}

// ── The line's words ─────────────────────────────────────────────────────────
{
  const lines = [newest, looked].flatMap((rv) => rv.rounds.map((c) => R.replayOf(rv, c)).filter(Boolean).map((x) => x.line));
  ok(lines.every((l) => !l.includes('#') && !l.includes(EM) && !l.includes(EN)), 'no line holds a #, an em dash or an en dash');
  ok(lines.every((l) => /^Killed[^.]*\.$/.test(l)), 'each line is one sentence, starting Killed');
  ok(/^Killed[^.]*\.$/.test('Killed by Jett, on attack.'), 'the sentence pattern matches a known line');
  const forged = { id: NEW_ID, kind: 'valorant', rounds: [{ n: 5, died: true, sideKey: 'attacking',
    riot: { sec: 4, killer: 'Brindlecap#EU1', weapon: 'Lowfulwyrm#QX7', afterPlant: false, feed: [] } }] };
  const f = R.replayOf(forged, 5);
  ok(f && f.line === 'Killed, 4 seconds into the round, on attack.' && !f.line.includes('Brindlecap') && !f.line.includes('Lowfulwyrm'),
    'a killer or gun that is a Riot ID is never said, only the facts that are known', f && f.line);
  const one = R.replayOf({ ...forged, rounds: [{ ...forged.rounds[0], riot: { ...forged.rounds[0].riot, sec: 1 } }] }, 5);
  ok(one && /1 second into/.test(one.line), 'one second is "1 second"', one && one.line);
  const src = fs.readFileSync(path.join(ROOT, 'src', 'shared', 'trainer-replay.js'), 'utf8');
  ok(!src.includes(EM) && !src.includes(EN), 'no em or en dash in trainer-replay.js');
}

// ── Enemies and the flag ─────────────────────────────────────────────────────
{
  const base = (feed, cause) => ({ id: NEW_ID, kind: 'valorant', rounds: [{ n: 7, died: true, sideKey: 'defending',
    riot: { sec: 30, killer: 'Jett', weapon: 'Vandal', feed }, ...(cause ? { forensics: { cause, source: 'screen' } } : {}) }] });
  const death = { ms: 30000, by: 'enemy', on: 'me', ka: 'Jett' };
  ok(R.replayOf(base([death]), 7).spec.enemies === 1, 'one enemy when nothing says more');
  ok(R.replayOf(base([], 'crossfire'), 7).spec.enemies === 2, 'a crossfire is two enemies');
  const k = (ms, va) => ({ ms, by: 'me', on: 'enemy', va });
  ok(R.replayOf(base([k(28000, 'Sova'), death]), 7).spec.enemies === 2, 'an enemy the player killed 2 s before the death was in the fight');
  ok(R.replayOf(base([k(20000, 'Sova'), death]), 7).spec.enemies === 1, 'one killed 10 s before was not');
  ok(R.replayOf(base([k(27500, 'Sova'), k(28000, 'Omen'), k(29000, 'Fade'), death]), 7).spec.enemies === 3, 'never more than three');
  const flagged = { ...clone(looked), deathFlags: { rounds: [{ n: 9 }, { n: 4, noDeath: true }] } };
  ok(R.replayOf(flagged, 9).spec.flagged === true && R.replayOf(flagged, 4).spec.flagged === false && R.replayOf(flagged, 2).spec.flagged === false,
    'a flagged death is flagged; a flag Riot has no death for is not');
}

// ── replaysOf: order and cap ─────────────────────────────────────────────────
{
  const flaggedLooked = { ...clone(looked), deathFlags: { rounds: [{ n: 12 }, { n: 7 }] } };
  const list = R.replaysOf([flaggedLooked, newest]);
  ok(list.length === R.MAX_DEFAULT && R.MAX_DEFAULT === 30, `capped at 30 by default (${list.length})`);
  ok(list.slice(0, 21).every((x) => x.reviewId === NEW_ID) && list.slice(21).every((x) => x.reviewId === OLD_ID), 'the newest match first, whole, then the older');
  ok(list[21].round === 7 && list[22].round === 12 && list[23].round === 2, 'the flagged deaths first within a match, then by round',
    list.slice(21, 24).map((x) => x.round).join(', '));
  const rounds = list.slice(0, 21).map((x) => x.round);
  ok(rounds.every((r, i) => i === 0 || r > rounds[i - 1]), 'unflagged deaths by round');
  ok(R.replaysOf([newest], { max: 5 }).length === 5 && R.replaysOf([newest], { max: 0 }).length === 21 - 0 && R.replaysOf([newest], { max: 'x' }).length === 21,
    'opts.max caps; a max that is not one keeps the default');
  const entries = R.replaysOf([{ id: OLD_ID, at: NOW - HOUR, review: { ...clone(b.builtLooked), id: undefined, at: undefined } },
    { id: NEW_ID, at: NOW, review: clone(b.built) }], { max: 100 });
  ok(entries.length === 42 && entries[0].reviewId === NEW_ID && entries[41].reviewId === OLD_ID && entries[41].at === NOW - HOUR,
    'library entries ({ id, at, review }) work alike, the entry\'s id and time standing in', entries.length);
  ok(R.replaysOf([newest, newest]).length === 21, 'a review given twice counts once');
  ok(R.replaysOf(null).length === 0 && R.replaysOf([null, 'x', {}]).length === 0, 'garbage gives none');
}

// ── The review's marks (index.js present) ────────────────────────────────────
{
  const marked = R.markRounds(looked, looked.rounds);
  ok(marked.filter((c) => c.replay).length === 21 && marked.every((c) => !c.replay || (c.died && c.replay === `${OLD_ID}:${c.n}`)),
    'every replayable death carries its replay id, and nothing else does');
  ok(marked.find((c) => c.n === 1) === looked.rounds.find((c) => c.n === 1), 'a round survived is handed back as it was');
  ok(!('replay' in looked.rounds[1]), 'the saved cards are never written to');
  ok(R.markRounds({ ...looked, id: undefined }, looked.rounds).every((c) => !c.replay), 'a review with no id marks nothing');
}

// ── Opening one by id ────────────────────────────────────────────────────────
{
  const p = R.parseOpen(`replay:${NEW_ID}:7`);
  ok(p && p.reviewId === NEW_ID && p.round === 7 && p.id === `${NEW_ID}:7`, 'an open id reads back as its review and round');
  ok(R.openId(`${NEW_ID}:7`) === `replay:${NEW_ID}:7`, 'and openId makes one');
  for (const bad of [`${NEW_ID}:7`, `replay:${NEW_ID}:0`, `replay:${NEW_ID}:x`, `replay:${NEW_ID}:1234`, 'replay:Brindlecap#EU1:3', `replay:${NEW_ID}:7:8`, null, 7]) {
    ok(R.parseOpen(bad) === null, `${JSON.stringify(bad)} is no open id`);
  }
}

// ── Main's half on a fake store ──────────────────────────────────────────────
{
  const mem = {};
  let isBusy = false;
  let clock = NOW + 1000;
  const opened = [];
  let library = [{ id: OLD_ID, at: NOW - HOUR, review: looked }];
  const older = { id: 'valorant-1763000000000-zzzz99', at: NOW - 100 * HOUR, review: { ...clone(b.built), id: 'valorant-1763000000000-zzzz99', at: NOW - 100 * HOUR } };
  const tr = createTrainer({
    store: { get: (k) => mem[k], set: (k, v) => { mem[k] = JSON.parse(JSON.stringify(v)); } },
    busy: () => isBusy,
    open: (pg) => opened.push(pg),
    changed: () => {},
    now: () => clock,
    recent: () => library,
    review: (id) => (id === older.id ? older : library.find((e) => e.id === id) || null),
  });
  const first = tr.replays();
  ok(first && first.list.length === 21 && first.fresh.length === 21, 'never shown: every replay is fresh', first && first.fresh.length);
  const s = tr.seen();
  ok(s.ok === true && s.seenAt === NOW + 1000 && mem.trainer.seenAt === NOW + 1000, 'seen stamps main\'s time in the trainer value');
  ok(tr.replays().fresh.length === 0, 'shown once, none is fresh');
  library = [{ id: NEW_ID, at: NOW + 5000, review: { ...newest, at: NOW + 5000 } }, ...library];
  const after = tr.replays();
  ok(after.list.length === 30 && after.fresh.length === 21 && after.fresh.every((id) => id.startsWith(`${NEW_ID}:`)),
    'a match saved since: only its deaths are fresh', after.fresh.length);
  clock = NOW + 9000;
  const saved = tr.save({ scenario: 'replay', at: 5, score: 300, kills: 1, bots: 1, shots: 3, hits: 2 });
  ok(saved.ok === true && saved.run.scenario === 'replay' && saved.best === true, 'a replay run saves under the one scenario id replay');
  ok(mem.trainer.seenAt === NOW + 1000 && mem.trainer.runs.length === 1, 'and saving keeps seenAt');
  ok(tr.save({ scenario: 'replay', at: 5, score: 100 }).best === false, 'replay runs chart together: a lower one is no best');
  ok(!tr.has('replay'), 'replay is no scenario of the list (trainer-scenarios.json is untouched)');
  ok(tr.save({ scenario: 'replay:x', at: 5 }).ok === false, 'a replay\'s own id is no scenario to save under');

  ok(tr.open(`replay:${NEW_ID}:7`) === true && opened[opened.length - 1] === 'trainer', 'open takes a replay that exists and shows the Trainer');
  const g = tr.get();
  ok(g.opened === `replay:${NEW_ID}:7` && g.replay && g.replay.id === `${NEW_ID}:7` && g.replay.round === 7, 'get answers it as opened, with the replay itself');
  const g2 = tr.get();
  ok(g2.opened === null && g2.replay === null, 'once');
  ok(tr.open(`replay:${older.id}:2`) === true && tr.get().replay.reviewId === older.id, 'a review older than the recent ones opens through its own read');
  const n = opened.length;
  ok(tr.open(`replay:${NEW_ID}:1`) === false && tr.open(`replay:${NEW_ID}:99`) === false && tr.open('replay:valorant-1700000000000-nope00:2') === false
    && opened.length === n, 'a round survived, a round not there and a review not there open nothing');
  ok(tr.open('spray-wall') === true && tr.get().replay === null, 'a scenario still opens as before, with no replay');
  ok(tr.clear('replay').ok === true && tr.get().runs.length === 0, 'the replay runs clear like a scenario\'s');

  isBusy = true;
  const before = JSON.stringify(mem);
  const pushed = opened.length;
  ok(tr.replays() === null, 'mid match replays answers null');
  const sm = tr.seen();
  ok(sm.ok === false && sm.error === 'match', 'mid match seen answers { ok: false, error: match }');
  const rs = tr.save({ scenario: 'replay', at: 5, score: 1 });
  ok(rs.ok === false && rs.error === 'match', 'mid match a replay run is refused');
  ok(tr.open(`replay:${NEW_ID}:7`) === false && opened.length === pushed, 'mid match a replay opens nothing');
  ok(JSON.stringify(mem) === before, 'mid match nothing is written');
  isBusy = false;
  ok(tr.get().opened === null, 'a replay refused mid match leaves nothing pending');

  const lonely = createTrainer({ store: { get: () => undefined, set: () => {} }, busy: () => false });
  ok(JSON.stringify(lonely.replays()) === '{"list":[],"fresh":[]}' && lonely.open(`replay:${NEW_ID}:7`) === false, 'with no reviews to read: no replays, none opens');
  const thrower = createTrainer({ store: { get: () => undefined, set: () => {} }, busy: () => false, recent: () => { throw new Error('x'); }, review: () => { throw new Error('y'); } });
  ok(thrower.replays().list.length === 0 && thrower.open(`replay:${NEW_ID}:7`) === false, 'a library that throws is no replays, never a throw');
}

console.log(`${failed ? 'FAILED' : 'OK'}: ${passed} passed, ${failed} failed`);
if (failed) process.exitCode = 1;
