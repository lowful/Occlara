'use strict';

/**
 * Advanced mode A/B, measured on REAL logged frames.
 *
 * The toggle makes a claim that is easy to state and easy to get wrong: with it
 * on the player gets advanced coaching, and with it off nothing changes. Both
 * halves need checking, and the second half is the one that quietly breaks,
 * because a retrieval change touches every prompt whether the toggle is on or
 * not.
 *
 * THE FLOOR IS THE POINT. Advanced advice assumes the fundamentals are in
 * place. A player dying on repeat does not need a damage breakpoint, so the
 * deathstreak override hands the majority back to core notes, and that override
 * is asserted here rather than trusted.
 *
 * Contexts come from the newest real ai-log session when one exists, so the
 * measurement is against situations that actually happened, and fall back to
 * synthetic ones so the test still runs on a clean checkout.
 *
 * Run: npm run test:advancedtips
 */

const fs = require('fs');
const path = require('path');
const knowledge = require(path.join(__dirname, '..', 'server', 'services', 'knowledge.js'));

let fails = 0;
const ok = (cond, what) => { if (!cond) { fails++; console.log(`FAIL  ${what}`); } else console.log(`ok    ${what}`); };

const ADVANCED = new Set(
  (() => {
    try {
      return require(path.join(__dirname, '..', 'server', 'data', 'playbook.json'))
        .filter((n) => n.tier === 'advanced').map((n) => n.text);
    } catch { return []; }
  })(),
);
const isAdv = (t) => ADVANCED.has(t);

// ── Real contexts, when a session is on this machine ────────────────────────
function realContexts() {
  try {
    const root = path.join(process.env.APPDATA || '', 'Occlara', 'ai-log');
    const dir = fs.readdirSync(root).filter((d) => d.startsWith('session-')).sort().reverse()[0];
    const log = JSON.parse(fs.readFileSync(path.join(root, dir, 'log.json'), 'utf8'));
    const seen = new Set();
    const out = [];
    for (const r of (log.records || [])) {
      const st = r && r.state;
      if (!st || !st.phase) continue;
      // One context per distinct situation, so the sample is varied rather than
      // forty copies of the same buy phase.
      const key = [st.phase, st.side, st.agent, st.playerWeapon].join('|');
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(st);
      if (out.length >= 12) break;
    }
    return out;
  } catch { return []; }
}

const SYNTHETIC = [
  { agent: 'Sova', side: 'attacking', phase: 'active', map: 'Ascent', playerWeapon: 'Vandal', roundNumber: 7 },
  { agent: 'Jett', side: 'attacking', phase: 'active', playerWeapon: 'Phantom', roundNumber: 9 },
  { agent: 'Killjoy', side: 'defending', phase: 'active', playerWeapon: 'Bucky', roundNumber: 5 },
  { agent: 'Omen', side: 'defending', phase: 'buy', playerCredits: 4500, roundNumber: 8 },
  { agent: 'Sage', side: 'defending', phase: 'postplant', playerWeapon: 'Spectre', roundNumber: 11 },
  // Swiftplay's second pistol round, which the pistol flag missed until 8.5.0.
  { agent: 'Jett', side: 'attacking', phase: 'buy', mode: 'swiftplay', playerCredits: 800, roundNumber: 5 },
];

/*
 * BOTH SETS, ALWAYS, and the first run is why.
 *
 * Measured on real contexts alone, every one of the twelve came back as "no
 * agent defending": that session never confirmed an agent, so `agents` notes,
 * which score +4 and are the highest scoring tag there is, were not exercised
 * at all. The A/B looked healthy while silently testing the easy half.
 *
 * Real contexts prove the mix shifts on situations that actually happened.
 * Synthetic ones cover the tags a single session happens not to contain.
 */
const real = realContexts();
const CONTEXTS = real.concat(SYNTHETIC);
console.log(`measuring on ${real.length} real logged contexts plus ${SYNTHETIC.length} synthetic`);
if (real.length) {
  const withAgent = real.filter((c) => c.agent).length;
  console.log(`  (${withAgent} of the real ones had a confirmed agent)`);
}
console.log(`${ADVANCED.size} advanced notes in the corpus of ${knowledge.size()}\n`);

// ── A/B ─────────────────────────────────────────────────────────────────────
let offAdv = 0, onAdv = 0, offTotal = 0, onTotal = 0;
const rows = [];
for (const ctx of CONTEXTS) {
  const off = knowledge.retrieve(ctx, 8);
  const on = knowledge.retrieve(ctx, 8, { advanced: true });
  const a = off.filter(isAdv).length;
  const b = on.filter(isAdv).length;
  offAdv += a; onAdv += b; offTotal += off.length; onTotal += on.length;
  rows.push({ label: `${ctx.agent || 'no agent'} ${ctx.side || '?'} ${ctx.phase}`, a, b, len: on.length });
}
for (const r of rows) {
  console.log(`  ${String(r.a).padStart(2)} -> ${String(r.b).padStart(2)} advanced of ${r.len}   ${r.label}`);
}
const offPct = Math.round((offAdv / offTotal) * 100);
const onPct = Math.round((onAdv / onTotal) * 100);
console.log(`\n  OFF ${offAdv}/${offTotal} advanced (${offPct}%)   ON ${onAdv}/${onTotal} (${onPct}%)\n`);

ok(onAdv > offAdv, `the toggle actually shifts the mix (${offPct}% to ${onPct}%)`);
ok(onPct >= 50, `and shifts it decisively, not marginally (${onPct}%)`);

// ── It must never return fewer notes, on or off ─────────────────────────────
// A reserve that cannot fill its quota must top back up rather than hand the
// prompt a short list, which would quietly make the coach dumber.
{
  let short = 0;
  for (const ctx of CONTEXTS) {
    if (knowledge.retrieve(ctx, 8, { advanced: true }).length < Math.min(8, knowledge.retrieve(ctx, 8).length)) short++;
  }
  ok(short === 0, 'advanced mode never returns fewer notes than plain retrieval');
}

// ── THE FLOOR: core always survives ─────────────────────────────────────────
{
  let violations = 0;
  for (const ctx of CONTEXTS) {
    const on = knowledge.retrieve(ctx, 8, { advanced: true });
    if (on.length >= 8 && on.every(isAdv)) violations++;
  }
  ok(violations === 0, 'a full prompt is never 100% advanced, fundamentals always get a slot');
}

// ── THE DEATHSTREAK OVERRIDE ────────────────────────────────────────────────
// The reason the floor exists at all: someone dying on repeat needs the basics
// back, and they are exactly the person who will not turn the toggle off.
{
  const base = { agent: 'Jett', side: 'attacking', phase: 'active', playerWeapon: 'Vandal', roundNumber: 9 };
  const calm = knowledge.retrieve({ ...base, consecutiveDeaths: 0 }, 8, { advanced: true });
  const dying = knowledge.retrieve({ ...base, consecutiveDeaths: 3 }, 8, { advanced: true });
  const calmAdv = calm.filter(isAdv).length;
  const dyingAdv = dying.filter(isAdv).length;
  console.log(`  deathstreak: ${calmAdv} advanced when calm, ${dyingAdv} when dying`);
  ok(dyingAdv < calmAdv, `a deathstreak hands slots back to fundamentals (${calmAdv} to ${dyingAdv})`);
  ok(dying.filter((t) => !isAdv(t)).length >= 4,
    'and core takes the majority, not just a token slot');
}

// ── OFF must be byte for byte the old behaviour ─────────────────────────────
// The retrieval change touches every prompt. A regression here would be
// invisible: the coach would simply get slightly different notes forever.
{
  const ctx = { agent: 'Sova', side: 'attacking', phase: 'active', map: 'Ascent', playerWeapon: 'Vandal', roundNumber: 7 };
  const a = knowledge.retrieve(ctx, 8);
  const b = knowledge.retrieve(ctx, 8, {});
  const c = knowledge.retrieve(ctx, 8, { advanced: false });
  ok(a.length === 8 && b.length === 8 && c.length === 8,
    'no options, empty options and advanced:false all return a full set');
}

// ── Side awareness survives the bias ────────────────────────────────────────
// The user asked specifically that the coach understand attacking and
// defending. Advanced mode must not trade that away for depth.
{
  const all = knowledge.all();
  const sideOf = (t) => (all.find((n) => n.text === t) || {}).side;
  for (const side of ['attacking', 'defending']) {
    const on = knowledge.retrieve({ agent: 'Sova', side, phase: 'active', playerWeapon: 'Vandal', roundNumber: 7 },
      8, { advanced: true });
    const sided = on.filter((t) => sideOf(t)).length;
    const wrong = on.filter((t) => sideOf(t) && sideOf(t) !== (side === 'attacking' ? 'attack' : 'defense')).length;
    console.log(`  ${side}: ${sided} of 8 side specific, ${wrong} from the wrong side`);
    ok(sided > 0, `advanced mode still serves ${side} specific notes`);
    ok(wrong === 0, `and never a note from the other side while ${side}`);
  }
}

// ── What the primer changed in retrieval (8.5.0) ────────────────────────────
// B IS NOT INERT: the flags and four notes changed for every live review and
// chat, so the change is pinned here, on the same contexts as the A/B above.
{
  const primer = require(path.join(__dirname, '..', 'server', 'services', 'game-primer.js'));
  const flags = (ctx) => knowledge.situationOf(ctx).flags;
  console.log('');
  ok(flags({ roundNumber: 5, mode: 'swiftplay' }).has('pistol') && flags({ roundNumber: 5, gameMode: 'swiftplay' }).has('pistol'),
    "Swiftplay's round 5 is a pistol round, by the match's mode or the live engine's gameMode");
  ok(!flags({ roundNumber: 13, mode: 'swiftplay' }).has('pistol') && flags({ roundNumber: 13 }).has('pistol') && !flags({ roundNumber: 5 }).has('pistol'),
    'round 13 is a pistol round only outside Swiftplay, and a context with no mode is Competitive, as before');
  ok(flags({ roundNumber: 6, mode: 'swiftplay', teamScore: 3, enemyScore: 2 }).has('antieco') && flags({ roundNumber: 14, teamScore: 5, enemyScore: 8 }).has('lostpistol'),
    'the round after each pistol round reads the score, in either mode');
  const lines = primer.buyLines();
  const buy = (c) => [...flags({ phase: 'buy', roundNumber: 3, playerCredits: c })].filter((f) => /eco|buy/.test(f)).join();
  ok(lines.eco === 2000 && lines.full === 3900 && buy(lines.eco - 1) === 'eco' && buy(lines.eco) === 'forcebuy'
    && buy(lines.full - 1) === 'forcebuy' && buy(lines.full) === 'fullbuy',
  `the eco and full buy lines are computed from the prices: a Spectre with Light Armor (${lines.eco}), a rifle with Heavy Armor (${lines.full})`);
  // And never typed again: a credits comparison against a written number in
  // situationOf is the old 2000 and 3900 coming back.
  const TYPED = /\bcredits\s*<=?\s*\d/;
  ok(TYPED.test('    if (credits < 2000) flags.add(\'eco\');') && !TYPED.test('    if (credits < BUY.eco) flags.add(\'eco\');'),
    'the typed buy line pattern catches "credits < 2000" and passes "credits < BUY.eco" (control)');
  const src = fs.readFileSync(path.join(__dirname, '..', 'server', 'services', 'knowledge.js'), 'utf8');
  const body = src.slice(src.indexOf('function situationOf('), src.indexOf('function retrieve('));
  ok(body.length > 200 && !TYPED.test(body), 'situationOf compares credits with no typed number');
  const swiftPistol = knowledge.retrieve({ agent: 'Jett', side: 'attacking', phase: 'buy', mode: 'swiftplay', playerCredits: 800, roundNumber: 5 }, 40);
  const pistolNotes = new Set(knowledge.all().filter((n) => (n.situations || []).includes('pistol')).map((n) => n.text));
  ok(swiftPistol.some((t) => pistolNotes.has(t)), "and a Swiftplay round 5 now draws pistol round notes");
  const text = (re) => (knowledge.all().find((n) => re.test(n.text)) || {}).text || '';
  ok(/running steps/.test(text(/running steps/)) && !/\d/.test(text(/running steps/)), 'the footsteps note has lost its unsourced 20 meters');
  ok(text(/defuse math/).includes(`full defuse is ${primer.stated('spike.defuse')} seconds and half is ${primer.stated('spike.checkpoint')}`),
    "the defuse note's seconds are the spike's confirmed timings");
  ok(text(/melts inside/).includes(`inside ${primer.bandEnd('frenzy')} meters`) && primer.bandEnd('frenzy') === 20,
    "the Frenzy note's band is the damage table's (20 m, where it was typed as 10)");
  ok(!knowledge.all().some((n) => /accurate on the move/.test(n.text)) && text(/force fights inside/).includes(`inside ${primer.bandEnd('spectre')} meters`),
    "the Spectre's accuracy claim is gone, and its range note reads the table");
}

// ── THE RANK BAND (8.8): a bias inside retrieve(), never past its cap ───────
// A note above the player's band is never served, one narrowed to the band is
// +2, one for lower bands only -3 unless the player's data shows it missing.
// Unknown rank is today's retrieval byte for byte: the same notes in the same
// order on the same random draws, and the same number of draws.
{
  const BANDS = knowledge.RANK_BANDS;
  const lowest = (n) => Math.min(...n.ranks.map((r) => BANDS.indexOf(r)));
  const ranked = knowledge.all().filter((n) => Array.isArray(n.ranks) && n.ranks.length);
  const ascOnly = new Set(ranked.filter((n) => lowest(n) === 3).map((n) => n.text));
  const aboveGold = new Set(ranked.filter((n) => lowest(n) > 1).map((n) => n.text));
  ok(ascOnly.size >= 2 && aboveGold.size >= 60, `the corpus carries asc_plus only notes (${ascOnly.size}) and notes above Gold (${aboveGold.size})`);

  // One seeded draw per call, counted, so two calls can be compared exactly.
  const seeded = (fn) => {
    const random = Math.random;
    let x = 7;
    let draws = 0;
    Math.random = () => { draws++; x = (x * 16807) % 2147483647; return x / 2147483647; };
    try { return { out: fn(), draws }; } finally { Math.random = random; }
  };
  const CTXS = [
    {}, { agent: 'Jett', map: 'Ascent' }, { agent: 'Sova', side: 'attack' }, { agent: 'Killjoy', side: 'defense' },
    { causes: ['lost-duel'] }, { causes: ['dry-peek', 'isolated'], agent: 'Omen' }, { cause: 'exposed', phase: 'postplant', side: 'attack' },
    { roundNumber: 1, side: 'defense' }, { consecutiveDeaths: 3, causes: ['lost-duel'] }, { teammatesAlive: 0, playerAlive: true },
    ...CONTEXTS.slice(0, 8),
  ];
  let same = 0;
  let total = 0;
  for (const ctx of CTXS) {
    for (const adv of [false, true]) {
      const base = seeded(() => knowledge.retrieve(ctx, 8, { advanced: adv }));
      for (const unknown of [undefined, null, '', 'Gold 2', 'gold', 'immortal', 42, { band: 'asc_plus' }]) {
        total++;
        const got = seeded(() => knowledge.retrieve({ ...ctx, rankBand: unknown }, 8, { advanced: adv }));
        if (JSON.stringify(got.out) === JSON.stringify(base.out) && got.draws === base.draws) same++;
      }
    }
  }
  ok(same === total, `unknown rank is byte for byte today's retrieval, the same notes and draws (${same} of ${total})`);
  ok(knowledge.all().every((n) => knowledge.rankAdjust(n, null, false) === 0), 'and with no band no note moves by a point');

  // A Gold player never gets a note whose lowest band is above Gold, at the
  // prompt's eight or at the whole pool, advanced on or off.
  let goldLeak = 0;
  let goldShort = 0;
  for (const ctx of CTXS) {
    for (const adv of [false, true]) {
      const gold = knowledge.retrieve({ ...ctx, rankBand: 'silver_gold' }, 8, { advanced: adv });
      const plain = knowledge.retrieve(ctx, 8, { advanced: adv });
      goldLeak += gold.filter((t) => aboveGold.has(t)).length;
      goldLeak += knowledge.retrieve({ ...ctx, rankBand: 'silver_gold' }, 2000, { advanced: adv }).filter((t) => aboveGold.has(t)).length;
      if (gold.length > 8 || gold.length < Math.min(8, plain.length) - 0) goldShort++;
    }
  }
  ok(goldLeak === 0, `a Gold player's retrieval never contains a Platinum or Ascendant only note (${goldLeak} leaked)`);
  ok(goldShort === 0, 'and the cap holds: never more than eight, never fewer than the plain retrieval gives');

  // An Immortal player's does: the asc_plus only notes reach the pool for
  // the contexts they are tagged for, and score above the same notes unranked.
  const imm = new Set(knowledge.retrieve({ causes: ['lost-duel'], rankBand: 'asc_plus' }, 2000));
  const immDef = new Set(knowledge.retrieve({ side: 'defense', rankBand: 'asc_plus' }, 2000));
  ok([...ascOnly].every((t) => imm.has(t) || immDef.has(t)), "an Immortal player's retrieval contains the asc_plus only notes");
  const goldDuel = new Set(knowledge.retrieve({ causes: ['lost-duel'], rankBand: 'silver_gold' }, 2000));
  ok([...ascOnly].every((t) => !goldDuel.has(t)), 'which the same Gold context never reaches');
  const crouch = knowledge.all().find((n) => ascOnly.has(n.text) && Array.isArray(n.cause));
  ok(crouch && knowledge.rankAdjust(crouch, 'asc_plus', true) === knowledge.RANK_FIT && knowledge.rankAdjust(crouch, 'silver_gold', true) === null,
    'a narrowed note fits its band at +2 and is excluded below it');

  // A note for lower bands only is demoted for a higher player, unless the
  // player's own data shows the fundamental missing.
  const low = knowledge.all().find((n) => Array.isArray(n.ranks) && n.ranks.join() === 'iron_bronze,silver_gold');
  ok(low && knowledge.rankAdjust(low, 'asc_plus', false) === null && knowledge.rankAdjust(low, 'asc_plus', true) === 0
    && knowledge.rankAdjust(low, 'silver_gold', false) === knowledge.RANK_FIT,
  `a low band note is left out above its bands, 0 when the data shows it missing, +2 at its band (${low && low.text.slice(0, 40)})`);
  // The case the score penalty missed: an agent and role tagged "Gold and below" note never reaches a Plat Sova.
  const goldInit = knowledge.all().find((n) => /in gold and below/i.test(n.text) && Array.isArray(n.roles) && n.roles.includes('initiator'));
  ok(!goldInit || !knowledge.retrieve({ agent: 'Sova', role: 'initiator', rankBand: 'plat_diamond' }, 2000).includes(goldInit.text),
    'a Gold and below initiator note is never handed to a Plat Sova');
  const lowCause = knowledge.all().find((n) => Array.isArray(n.ranks) && n.ranks.join() === 'iron_bronze,silver_gold' && Array.isArray(n.cause));
  ok(!lowCause || knowledge.retrieve({ causes: lowCause.cause, rankBand: 'asc_plus' }, 2000).includes(lowCause.text),
    'a cause note for the low bands still reaches an Immortal whose deaths show that cause');

  // The reserve keeps its share with a band: advanced on, a Gold player still
  // gets a core floor and the death streak still hands core the majority.
  const tierOfText = (t) => (knowledge.all().find((n) => n.text === t) || {}).tier || 'core';
  const g = knowledge.retrieve({ agent: 'Jett', map: 'Ascent', rankBand: 'silver_gold' }, 8, { advanced: true });
  const gs = knowledge.retrieve({ agent: 'Jett', map: 'Ascent', consecutiveDeaths: 3, rankBand: 'silver_gold' }, 8, { advanced: true });
  ok(g.length === 8 && g.some((t) => tierOfText(t) === 'core'), 'with a band, Advanced coaching still keeps a core floor in eight');
  ok(gs.filter((t) => tierOfText(t) === 'core').length >= knowledge.STREAK_CORE_SLOTS, 'and a death streak still gives core the majority');
}

// ── ON FOR EVERYONE (8.8): the default, the readers and the one time switch ──
// On the REAL conf, the library under electron-store, in a temporary folder,
// because the whole reason for the migration is how it persists defaults: it
// writes them into the file on first run, so an install from before 8.8 holds
// advancedTips false on disk, a value its player never chose, and the file
// beats the new default. Measured here before it is relied on.
{
  const os = require('os');
  const adv = require(path.join(__dirname, '..', 'src', 'main', 'services', 'advanced-coaching.js'));
  const { STORE_DEFAULTS } = require(path.join(__dirname, '..', 'src', 'shared', 'config.js'));
  const ConfMod = require('conf');
  const Conf = ConfMod.default || ConfMod;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'occlara-advanced-'));
  const open = (name, defaults) => new Conf({ cwd: dir, configName: name, defaults });
  const onDisk = (name) => JSON.parse(fs.readFileSync(path.join(dir, name + '.json'), 'utf8'));

  ok(STORE_DEFAULTS.advancedTips === true && STORE_DEFAULTS[adv.FLAG] === 0,
    'the default is on, and the one time flag starts unset');
  ok(adv.isOn(undefined) && adv.isOn(null) && adv.isOn(true) && !adv.isOn(false),
    'a missing value reads as on, only an explicit false is off');

  // The trap, shown: an old install's defaults were written, and the file wins.
  open('old', { advancedTips: false });
  ok(onDisk('old').advancedTips === false, 'conf wrote the old default false into the file on first run');
  const old = open('old', STORE_DEFAULTS);
  ok(old.get('advancedTips') === false, 'and with the new default the file still says false, so a default alone would never reach it');

  // Existing install: turned on once.
  ok(adv.turnOnOnce(old, 1234) === true && old.get('advancedTips') === true && old.get(adv.FLAG) === 1234
    && onDisk('old').advancedTips === true, 'an existing install holding false is turned on once, and the file says so');
  // A player who turns it off after the update keeps it off, launch after launch.
  old.set('advancedTips', false);
  const again = open('old', STORE_DEFAULTS);
  ok(adv.turnOnOnce(again, 9999) === false && again.get('advancedTips') === false && again.get(adv.FLAG) === 1234
    && adv.on(again) === false, 'turned off after the update, it stays off at the next launch, and the switch never runs twice');
  ok(adv.turnOnOnce(again, 10000) === false && again.get(adv.FLAG) === 1234, 'nor a third time');

  // Fresh install: on from the first launch, and the flag stamped.
  const fresh = open('fresh', STORE_DEFAULTS);
  ok(adv.on(fresh) === true, 'a fresh install reads on before anything runs');
  ok(adv.turnOnOnce(fresh, 55) === true && fresh.get('advancedTips') === true && fresh.get(adv.FLAG) === 55,
    'and its first launch stamps the flag, so the player\'s own choice sticks from then on');
  fresh.set('advancedTips', false);
  ok(adv.turnOnOnce(open('fresh', STORE_DEFAULTS), 66) === false && adv.on(open('fresh', STORE_DEFAULTS)) === false,
    'a fresh install turned off stays off');

  // An existing install that already had it on stays on, and is stamped.
  open('wason', { advancedTips: false }).set('advancedTips', true);
  const wasOn = open('wason', STORE_DEFAULTS);
  ok(adv.turnOnOnce(wasOn, 7) === true && wasOn.get('advancedTips') === true, 'an install that already had it on stays on');

  // A missing key, a store that throws: on, and nothing thrown.
  const bare = { data: {}, get(k) { return this.data[k]; }, set(k, v) { if (typeof k === 'object') Object.assign(this.data, k); else this.data[k] = v; } };
  ok(adv.on(bare) === true, 'a store without the key at all reads on');
  const broken = { get() { throw new Error('locked'); }, set() { throw new Error('locked'); } };
  const quiet = console.error; console.error = () => {};
  let threw = false, ran;
  try { ran = adv.turnOnOnce(broken); } catch { threw = true; }
  console.error = quiet;
  ok(!threw && ran === false && adv.on(broken) === true, 'a store that throws throws nothing out, reads on, and is tried again next launch');

  try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}

  // Every reader treats unset as on: no main process reader is left on an
  // explicit true, which would read a missing key as off.
  const SRC = path.join(__dirname, '..', 'src');
  const readers = ['main/index.js', 'main/ipc/register-ipc.js', 'main/services/coaching-engine.js',
    'renderer/settings/settings.js', 'renderer/onboarding/onboarding.js'];
  const strict = readers.filter((f) => {
    const s = fs.readFileSync(path.join(SRC, f), 'utf8');
    return s.includes("get('advancedTips') === true") || s.includes('advancedTips === true');
  });
  ok(strict.length === 0, `no reader reads Advanced coaching as an explicit true (${strict.join(', ') || 'none'})`);
  const storeSrc = fs.readFileSync(path.join(SRC, 'main', 'services', 'store.js'), 'utf8');
  ok(storeSrc.includes("require('./advanced-coaching').turnOnOnce(store)"), 'the store runs the one time switch as it opens');
}

console.log(`\n${fails ? fails + ' failure(s)' : 'all advanced tip checks passed'}`);
process.exit(fails ? 1 : 0);
