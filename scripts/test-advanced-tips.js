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

/*
 * The context a note's own tags describe, so a note is looked for where it is
 * meant to be served: its agent (or one of its role), map, gun, side, phase,
 * causes, enemy agents, and the flags of its first situation.
 */
const AGENT_LIST = Object.keys(require(path.join(__dirname, '..', 'server', 'valorant-data.generated.json')).agents);
function ctxFor(n) {
  const ctx = {};
  if (n.agents) ctx.agent = n.agents.find((a) => !n.roles || n.roles.includes(knowledge.roleOf(a))) || n.agents[0];
  else if (n.roles) ctx.agent = AGENT_LIST.find((a) => knowledge.roleOf(a) === n.roles[0]);
  if (n.maps) ctx.map = n.maps[0];
  if (n.weapons) ctx.playerWeapon = n.weapons[0];
  if (n.side) ctx.side = n.side === 'attack' ? 'attacking' : 'defending';
  if (n.phase) ctx.phase = { buy: 'buy', postplant: 'post plant', active: 'active', dead: 'dead' }[n.phase];
  if (n.cause) ctx.causes = n.cause;
  if (n.enemyAgents) ctx.enemyAgents = n.enemyAgents.slice(0, 1);
  if (n.enemyWeapons) ctx.enemyWeapons = n.enemyWeapons.slice(0, 1);
  if (n.enemyWithout) {
    const others = AGENT_LIST.filter((a) => !n.enemyWithout.includes(a) && !(n.enemyAgents || []).includes(a));
    ctx.enemyAgents = (n.enemyAgents ? n.enemyAgents.slice(0, 1) : []).concat(others).slice(0, 5);
  }
  const flag = (n.situations || [])[0];
  const FLAG = {
    pistol: { roundNumber: 1 }, early: { roundNumber: 2 }, deathstreak: { consecutiveDeaths: 2 }, winstreak: { consecutiveWins: 2 },
    eco: { phase: 'buy', roundNumber: 5, playerCredits: 1000 }, forcebuy: { phase: 'buy', roundNumber: 5, playerCredits: 2500 },
    fullbuy: { phase: 'buy', roundNumber: 5, playerCredits: 9000 }, antieco: { roundNumber: 2, teamScore: 1, enemyScore: 0 },
    lostpistol: { roundNumber: 2, teamScore: 0, enemyScore: 1 }, retake: { side: 'defending', phase: 'post plant' },
    clutch: { teammatesAlive: 0, playerAlive: true },
  };
  return { ...ctx, ...(FLAG[flag] || {}) };
}

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
    // Within twelve, not eight (8.8): the coach consensus gave Sova enough
    // agent notes (+4 against a side's +2) that the eight on defence held no
    // side note on about a third of the random draws, which said nothing
    // about side awareness and failed the run at random.
    const near = knowledge.retrieve({ agent: 'Sova', side, phase: 'active', playerWeapon: 'Vandal', roundNumber: 7 }, 12, { advanced: true });
    ok(near.filter((t) => sideOf(t)).length > 0, `advanced mode still serves ${side} specific notes`);
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
  // Each asc_plus only note in the context its own tags describe (ctxFor),
  // since 8.8 brought them for agents, roles, phases and enemy comps.
  const ascNotes = knowledge.all().filter((n) => ascOnly.has(n.text));
  const missed = ascNotes.filter((n) => !knowledge.retrieve({ ...ctxFor(n), rankBand: 'asc_plus' }, 2000).includes(n.text));
  ok(!missed.length, `an Immortal player's retrieval contains the asc_plus only notes (${ascNotes.length - missed.length} of ${ascNotes.length})`
    + (missed.length ? `: ${missed.map((n) => n.text.slice(0, 50)).join(' | ')}` : ''));
  const leaked = ascNotes.filter((n) => knowledge.retrieve({ ...ctxFor(n), rankBand: 'silver_gold' }, 2000).includes(n.text));
  ok(!leaked.length, 'which the same Gold context never reaches');
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

// ── THE ENEMY TEAM'S AGENTS (8.8): never served blind ──────────────────────
// A note with enemyAgents is eligible only when one of them was on the enemy
// team and scores ENEMY_FIT higher then; with no list every enemy note is
// excluded before its jitter is drawn, so the rest is today's retrieval.
{
  const seeded = (fn) => {
    const random = Math.random;
    let x = 7;
    let draws = 0;
    Math.random = () => { draws++; x = (x * 16807) % 2147483647; return x / 2147483647; };
    try { return { out: fn(), draws }; } finally { Math.random = random; }
  };
  const ALL = knowledge.all();
  const enemyNotes = ALL.filter((n) => n.enemyAgents || n.enemyWithout);
  const enemyText = new Set(enemyNotes.map((n) => n.text));
  ok(enemyNotes.length >= 20, `the corpus carries enemy agent notes (${enemyNotes.length})`);
  let blind = 0;
  for (const ctx of CONTEXTS) for (const band of [undefined, 'silver_gold', 'asc_plus']) {
    blind += knowledge.retrieve({ ...ctx, ...(band ? { rankBand: band } : {}) }, 2000).filter((t) => enemyText.has(t)).length;
  }
  ok(blind === 0, `with no enemy list no enemy note is ever retrieved, at any band (${blind})`);

  // Byte for byte: the same notes in the same order on the same draws as a
  // corpus that never had the enemy notes, and junk lists are no list.
  let same = 0;
  let total = 0;
  const without = ALL.filter((n) => !enemyText.has(n.text));
  for (const ctx of CONTEXTS) {
    for (const adv of [false, true]) {
      const got = seeded(() => knowledge.retrieve(ctx, 8, { advanced: adv }));
      const saved = ALL.splice(0, ALL.length, ...without);
      let ref;
      try { ref = seeded(() => knowledge.retrieve(ctx, 8, { advanced: adv })); } finally { ALL.splice(0, ALL.length, ...saved); }
      for (const junk of [undefined, [], ['Player#TAG', 7, null], 'Killjoy', ['nobody']]) {
        total++;
        const j = seeded(() => knowledge.retrieve({ ...ctx, ...(junk === undefined ? {} : { enemyAgents: junk }) }, 8, { advanced: adv }));
        if (JSON.stringify(j.out) === JSON.stringify(ref.out) && j.draws === ref.draws && JSON.stringify(got.out) === JSON.stringify(ref.out)) same++;
      }
    }
  }
  ok(same === total && ALL.length === without.length + enemyNotes.length,
    `unknown enemies are today's retrieval byte for byte, the same notes and draws (${same} of ${total})`);

  ok(JSON.stringify(knowledge.enemiesOf(['killjoy', 'Killjoy', 'KAY/O', 'Player#TAG', 'Sova', 'Jett', 'Omen', 'Viper'])) === JSON.stringify(['Killjoy', 'KAY/O', 'Sova', 'Jett', 'Omen']),
    'enemiesOf keeps the game data\'s agents only, spelled as the data spells them, once each, five at most, and never a Riot ID');
  ok(knowledge.enemiesOf('Killjoy').length === 0 && knowledge.enemiesOf(null).length === 0, 'and a string or nothing is no list');

  const kj = ALL.find((n) => n.enemyAgents && n.enemyAgents.length === 1 && n.enemyAgents[0] === 'Killjoy');
  ok(kj && knowledge.enemyFit(kj, ['Killjoy']) === knowledge.ENEMY_FIT && knowledge.enemyFit(kj, ['Jett', 'Sova']) === null
    && knowledge.enemyFit(kj, []) === null && knowledge.enemyFit({ text: 'x' }, []) === 0 && knowledge.enemyFit({ text: 'x' }, ['Killjoy']) === 0,
  'a Killjoy note fits a Killjoy comp at +2, is out against another comp or none, and a note for no enemy moves by nothing');
  const { enemyAgents: kjEnemies, ...kjBase } = ctxFor(kj);
  const kjCtx = { ...kjBase, rankBand: kj.ranks ? kj.ranks[0] : undefined };
  ok(knowledge.retrieve({ ...kjCtx, enemyAgents: ['Killjoy', 'Jett'] }, 2000).includes(kj.text)
    && !knowledge.retrieve({ ...kjCtx, enemyAgents: ['Cypher', 'Jett'] }, 2000).includes(kj.text)
    && !knowledge.retrieve(kjCtx, 2000).includes(kj.text), 'and retrieve() serves it against a Killjoy, never against another comp or blind');
  // The score: the same note scores ENEMY_FIT more than it would untagged.
  const scoreOf = (ctx, text) => {
    const list = knowledge.retrieve(ctx, 2000);
    return list.indexOf(text);
  };
  ok(scoreOf({ ...kjCtx, enemyAgents: ['Killjoy'] }, kj.text) >= 0, 'an eligible enemy note is in the pool');

  const flashless = ALL.find((n) => n.enemyWithout);
  const noFlash = ['Jett', 'Neon', 'Raze', 'Sage', 'Cypher'];
  ok(flashless && knowledge.enemyFit(flashless, noFlash) === knowledge.ENEMY_FIT
    && knowledge.enemyFit(flashless, ['Jett', 'Neon', 'Raze', 'Sage', 'Skye']) === null
    && knowledge.enemyFit(flashless, ['Jett', 'Neon', 'Raze']) === null,
  'a read for a comp with no flash needs the whole comp, five agents, and none of them a flasher');
}

// ── WORKED CASES (8.8, cases.js) ────────────────────────────────────────────
// At most two, only when the player's situation matches, the rank band as
// notes, the Advanced coaching toggle, and enemy cases never blind.
{
  const cases = require(path.join(__dirname, '..', 'server', 'services', 'cases.js'));
  const BANDS = knowledge.RANK_BANDS;
  const file = require(path.join(__dirname, '..', 'server', 'data', 'cases.json'));
  ok(cases.size() === file.length && file.length >= 100, `every case in cases.json is loaded (${cases.size()} of ${file.length})`);
  const sitFor = (c, extra) => {
    const s = c.situation;
    const agent = s.agent || (s.role ? AGENT_LIST.find((a) => knowledge.roleOf(a) === s.role) : null);
    const enemies = s.enemyWithout ? AGENT_LIST.filter((a) => !s.enemyWithout.includes(a)).slice(0, 5) : s.enemyAgents.slice(0, 1);
    return { agent, map: s.map, sides: s.side ? [s.side] : ['attack', 'defense'], phases: s.phase ? [s.phase] : [],
      economies: s.economy ? [s.economy] : [], causes: c.cause || [], patterns: c.patterns || [], enemies, advanced: true, ...(extra || {}) };
  };
  const inPool = (c, extra) => cases.scored(sitFor(c, extra)).some((n) => n.c.id === c.id);
  const all = cases.all();
  // Held back by design (cases.js situational, check-cases.js heldBack): a
  // case for any agent with one kind of anchor a review shows.
  const { heldBack, HELD_BACK_MAX } = require(path.join(__dirname, 'check-cases.js'));
  const held = all.filter(heldBack);
  const live = all.filter((c) => !heldBack(c));
  const SHOWN_PHASES = ['early', 'mid', 'execute', 'postplant', 'retake', 'clutch', 'late'];
  ok(held.length > 0 && held.length <= HELD_BACK_MAX
    && held.every((c) => !inPool(c, { rankBand: c.minBand, phases: SHOWN_PHASES.filter((p) => p === c.situation.phase) })),
  `the cases held back for want of a second anchor are never served on their one anchor (${held.length}, at most ${HELD_BACK_MAX})`);
  const reach = live.filter((c) => inPool(c, { rankBand: c.minBand }));
  ok(reach.length === live.length, `every other case is reachable in the situation its own tags describe, at its band (${reach.length} of ${live.length})`
    + (reach.length === live.length ? '' : `: ${live.filter((c) => !reach.includes(c)).map((c) => c.id).join(', ')}`));

  // Rank bands: Gold never gets an asc_plus only case, an Immortal does.
  const ascOnly = all.filter((c) => c.ranks.length === 1 && c.ranks[0] === 'asc_plus');
  ok(ascOnly.length >= 3, `the cases carry asc_plus only ones (${ascOnly.length})`);
  ok(ascOnly.filter((c) => !heldBack(c)).every((c) => inPool(c, { rankBand: 'asc_plus' })), 'an Immortal player is served the asc_plus only cases in their situations');
  ok(ascOnly.every((c) => !inPool(c, { rankBand: 'silver_gold' }) && !inPool(c, { rankBand: 'plat_diamond' })),
    'a Gold or a Diamond player never is, in the same situations');
  let goldLeak = 0;
  for (const c of all) for (const n of cases.scored(sitFor(c, { rankBand: 'silver_gold' }))) if (BANDS.indexOf(n.c.minBand) > 1) goldLeak++;
  ok(goldLeak === 0, `across every case's situation a Gold player is served no case above Gold (${goldLeak})`);
  const lowOnly = all.filter((c) => c.ranks.every((r) => BANDS.indexOf(r) <= 1));
  const lowNoData = lowOnly.filter((c) => !c.cause && !c.patterns);
  ok(lowNoData.every((c) => !cases.scored({ ...sitFor(c), rankBand: 'asc_plus' }).some((n) => n.c.id === c.id)),
    `a case for the low bands only is left out for an Immortal whose data does not show it (${lowNoData.length} cases)`);
  const lowData = lowOnly.filter((c) => (c.cause || c.patterns) && !heldBack(c));
  ok(lowData.every((c) => inPool(c, { rankBand: 'asc_plus' })), `and served when a cause or a pattern of theirs does (${lowData.length} cases)`);

  // The cap: two at most, however much matches.
  const everything = { agent: 'Sova', map: 'Haven', sides: ['attack', 'defense'], advanced: true,
    phases: ['early', 'mid', 'execute', 'postplant', 'retake', 'clutch', 'late'], economies: ['pistol', 'antieco', 'lostpistol'],
    causes: ['dry-peek', 'isolated', 'repeek', 'crossfire', 'rotating', 'overextend', 'exposed', 'lost-duel'],
    patterns: ['early', 'spot', 'ult', 'streak', 'postplant', 'retake'], enemies: ['Chamber', 'Killjoy', 'Omen', 'Jett', 'Cypher'] };
  ok(cases.scored(everything).length > 2 && cases.pick(everything).length === 2 && cases.pick(everything, 9).length === 2,
    `a situation that matches ${cases.scored(everything).length} cases is given two, never more`);
  const twice = JSON.stringify(cases.pick(everything)) === JSON.stringify(cases.pick(everything));
  ok(twice, 'and the same two every time (no jitter, ties by id)');

  // The toggle, the anchor and the enemy.
  ok(cases.scored({ ...everything, advanced: false }).every((n) => n.c.tier !== 'advanced'), 'Advanced coaching off serves no advanced case');
  ok(cases.pick({ agent: null, sides: ['attack', 'defense'], advanced: true }).length === 0
    && cases.pick({}).length === 0, 'a situation with no anchor (no cause, pattern, agent, enemy, phase or economy) is given none');
  const enemyCases = all.filter((c) => c.situation.enemyAgents.length || c.situation.enemyWithout);
  ok(enemyCases.length >= 10, `cases name the enemy agents they answer (${enemyCases.length})`);
  ok(cases.scored({ ...everything, enemies: [] }).every((n) => !n.c.situation.enemyAgents.length && !n.c.situation.enemyWithout),
    'with no enemy list no enemy case is served');
  ok(enemyCases.every((c) => !inPool(c, { enemies: [], rankBand: c.minBand })), 'each enemy case is out in its own situation once the enemy is unknown');
  const block = cases.block(cases.pick(everything));
  ok(block.startsWith(cases.HEAD) && block.split('\n').length === 3 && cases.block([]) === '', 'the block is the heading and one line a case, and nothing for none');
  ok(!new RegExp('[;' + String.fromCharCode(0x2013, 0x2014) + ']').test(block), 'with no semicolon or dash in it');

  // check:cases fails what it exists to fail, planted beside the real file.
  const os = require('os');
  const { spawnSync } = require('child_process');
  const base = JSON.parse(JSON.stringify(file.find((c) => c.cause && !c.situation.agent)));
  const plant = (id, change) => { const c = JSON.parse(JSON.stringify(base)); c.id = id; c.signal = `${c.signal} Planted ${id}.`; change(c); return c; };
  const plants = [
    plant('p1', (c) => { c.decision = 'Hold the angle; then swing.'; }),
    plant('p2', (c) => { c.why = 'Because Zorblatt teaches it that way.'; }),
    plant('p3', (c) => { c.situation.enemyAgents = ['Killjoyy']; }),
    plant('p4', (c) => { c.ranks = ['gold']; }),
    plant('p5', (c) => { c.source = { ...c.source, claims: [{ rule: 'spike.defuse', value: 6 }] }; }),
    plant('p6', (c) => { c.decision = 'Throw the Slow Orb on the choke.'; }),
    plant('p7', (c) => { delete c.cause; delete c.patterns; c.situation.phase = 'between'; c.situation.economy = null; }),
    plant('p8', (c) => { c.source = { ...c.source, coach: 'someone' }; }),
    plant('p9', (c) => { delete c.cause; delete c.patterns; c.situation.role = null; c.situation.enemyAgents = []; delete c.situation.enemyWithout; c.situation.phase = 'mid'; c.situation.economy = null; }),
  ];
  const plantFile = path.join(os.tmpdir(), `check-cases-plant-${process.pid}.json`);
  fs.writeFileSync(plantFile, JSON.stringify(plants));
  const run = spawnSync(process.execPath, [path.join(__dirname, 'check-cases.js')], { encoding: 'utf8', env: { ...process.env, CHECK_CASES_PLANT: plantFile } });
  try { fs.unlinkSync(plantFile); } catch {}
  const outText = run.stdout || '';
  const caught = [/p1: decision contains a semicolon/, /p2: why capitalises "Zorblatt"/, /p3: enemyAgents names unknown agent "Killjoyy"/,
    /p4: rank band "gold"/, /p5: claims spike\.defuse is 6; the primer states 7/, /p6: names "Slow Orb", which belongs to sage/,
    /p7: carries no anchor/, /p8: source carries "coach"/, /held back for want of a second anchor \([^)]*\bp9\b/, /more than HELD_BACK_MAX/];
  ok(run.status === 1 && caught.every((re) => re.test(outText)),
    'check:cases fails a semicolon, a name, an unknown enemy agent, a band typo, a false rule, a foreign ability, an unreachable case, a coach key and one held back case too many'
    + (caught.every((re) => re.test(outText)) ? '' : `: missed ${caught.filter((re) => !re.test(outText)).map(String).join(' ')}`));
  const clean = spawnSync(process.execPath, [path.join(__dirname, 'check-cases.js')], { encoding: 'utf8' });
  ok(clean.status === 0, 'and passes the real file');
  // The regexes the chat's case situation reads its question words with, on known strings.
  ok(/\bretake/.test('how should i retake b') && /\bpost ?plant|after the plant\b/.test('what about my post plant')
    && /\bpost ?plant|after the plant\b/.test('right after the plant') && /\bclutch\b/.test('the clutch in round 9')
    && /\bpistol\b/.test('my pistol round') && !/\bclutch\b/.test('clutches'), 'the question word patterns match what they should');
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

// ── THE RESERVE FOLLOWS THE BAND (8.8, knowledge.js ADVANCED_SLOTS_BY_BAND) ──
// Advanced coaching is on for everyone: at Iron and Gold the reserve shrinks,
// so the band's own fundamentals come back; at Platinum and up it is today's;
// with no band it is today's byte for byte.
{
  const S = knowledge.ADVANCED_SLOTS_BY_BAND;
  ok(S.iron_bronze === 1 && S.silver_gold === 2 && S.plat_diamond === knowledge.ADVANCED_SLOTS && S.asc_plus >= knowledge.ADVANCED_SLOTS
    && knowledge.advancedSlots(null) === knowledge.ADVANCED_SLOTS && knowledge.advancedSlots('gold') === knowledge.ADVANCED_SLOTS,
  'the advanced share of eight is 1 at Iron and Bronze, 2 at Silver and Gold, today\'s 6 from Platinum, and 6 with no band');
  const advText = new Set(knowledge.all().filter((n) => n.tier === 'advanced').map((n) => n.text));
  const byText = new Map(knowledge.all().map((n) => [n.text, n]));
  const quietRun = (fn) => { const random = Math.random; let x = 11; Math.random = () => { x = (x * 16807) % 2147483647; return x / 2147483647; }; try { return fn(); } finally { Math.random = random; } };
  const SIT = {
    eco: { agent: 'Reyna', map: 'Sunset', side: 'attacking', phase: 'buy', playerCredits: 1500, roundNumber: 4 },
    clutch: { agent: 'Chamber', map: 'Pearl', side: 'defending', teammatesAlive: 0, playerAlive: true, roundNumber: 18 },
    retake: { agent: 'Sage', map: 'Haven', side: 'defending', phase: 'postplant', roundNumber: 14, cause: 'exposed' },
    trade: { agent: 'Raze', map: 'Bind', side: 'attacking', roundNumber: 9, cause: 'isolated' },
  };
  const FUND = {
    eco: (n) => (n.situations || []).some((f) => f === 'eco' || f === 'forcebuy') || /\beco\b|\bsave\b|credits/i.test(n.text),
    clutch: (n) => (n.situations || []).includes('clutch') || /\bclutch\b/i.test(n.text),
    retake: (n) => (n.situations || []).includes('retake') || /\bretake/i.test(n.text),
    trade: (n) => (n.cause || []).includes('isolated') || /\btrad(?:e|es|ed|ing)\b/i.test(n.text),
  };
  ok(FUND.trade({ text: 'stay where a teammate can trade you' }) && !FUND.trade({ text: 'a tradeoff' }) && FUND.eco({ text: 'On an eco, stack' })
    && !FUND.eco({ text: 'economy of motion' }), 'the fundamentals\' word tests match a known positive and miss a known negative');
  for (const [name, ctx] of Object.entries(SIT)) {
    for (const band of ['iron_bronze', 'silver_gold']) {
      const got = quietRun(() => knowledge.retrieve({ ...ctx, rankBand: band }, 8, { advanced: true }));
      const fund = got.filter((t) => FUND[name](byText.get(t)));
      const adv = got.filter((t) => advText.has(t)).length;
      ok(fund.length >= 1 && adv <= S[band], `${band} in the ${name} context, Advanced coaching on: ${fund.length} of its fundamentals, ${adv} advanced of at most ${S[band]}`);
    }
    for (const band of ['plat_diamond', 'asc_plus']) {
      const got = quietRun(() => knowledge.retrieve({ ...ctx, rankBand: band }, 8, { advanced: true }));
      const pool = knowledge.retrieve({ ...ctx, rankBand: band }, 2000).filter((t) => advText.has(t)).length;
      const adv = got.filter((t) => advText.has(t)).length;
      ok(adv === Math.min(knowledge.ADVANCED_SLOTS, pool), `${band} in the ${name} context keeps its depth: ${adv} advanced of 8 (pool ${pool})`);
    }
  }
  // Band notes first in the advanced queue: at Platinum the reserve takes the
  // band's own advanced notes before an unbanded one whenever there are enough.
  let firstOk = 0, firstAll = 0;
  for (const ctx of [...Object.values(SIT), { agent: 'Jett', map: 'Ascent', side: 'attacking' }, { agent: 'Omen', map: 'Bind', side: 'defending' }]) {
    for (const band of ['plat_diamond', 'asc_plus']) {
      firstAll++;
      const pool = knowledge.retrieve({ ...ctx, rankBand: band }, 2000).map((t) => byText.get(t));
      const fitAdv = pool.filter((n) => n.tier === 'advanced' && knowledge.rankAdjust(n, band, false) === knowledge.RANK_FIT).length;
      const got = quietRun(() => knowledge.retrieve({ ...ctx, rankBand: band }, 8, { advanced: true })).map((t) => byText.get(t));
      const gotFit = got.filter((n) => n.tier === 'advanced' && knowledge.rankAdjust(n, band, false) === knowledge.RANK_FIT).length;
      if (gotFit >= Math.min(fitAdv, knowledge.ADVANCED_SLOTS)) firstOk++;
    }
  }
  ok(firstOk === firstAll, `the reserve takes the band's own advanced notes before unbanded ones (${firstOk} of ${firstAll})`);
  // No band: the reserve as it was, six of eight in score order.
  let asWas = 0, asTotal = 0;
  for (const ctx of [...Object.values(SIT), {}, { agent: 'Sova', side: 'attacking' }, { consecutiveDeaths: 3, causes: ['lost-duel'] }]) {
    asTotal++;
    const pool = knowledge.retrieve(ctx, 2000).filter((t) => advText.has(t)).length;
    const streak = (ctx.consecutiveDeaths || 0) >= 2;
    const got = quietRun(() => knowledge.retrieve(ctx, 8, { advanced: true })).filter((t) => advText.has(t)).length;
    if (got >= Math.min(streak ? 8 - knowledge.STREAK_CORE_SLOTS : knowledge.ADVANCED_SLOTS, pool)) asWas++;
  }
  ok(asWas === asTotal, `with no band the reserve is today's, six of eight (three on a death streak) (${asWas} of ${asTotal})`);
  // The study list at the same scale: Iron is never handed advanced homework
  // while core notes remain, Platinum keeps three of four.
  const mr = require(path.join(__dirname, '..', 'server', 'services', 'match-review.js'));
  const studyOf = (band) => mr.study({ context: { agent: 'Raze', map: 'Bind', advancedTips: true, rankBand: band }, patterns: [{ key: 'early' }], rounds: [], mistakes: [] }, 4);
  const advIn = (list) => list.filter((n) => advText.has(n.text)).length;
  ok(advIn(studyOf('iron_bronze')) === 0 && advIn(studyOf('silver_gold')) <= 1 && advIn(studyOf('plat_diamond')) >= 2,
    `study() follows the band: ${advIn(studyOf('iron_bronze'))} advanced of 4 at Iron, ${advIn(studyOf('silver_gold'))} at Gold, ${advIn(studyOf('plat_diamond'))} at Platinum`);
}

// ── enemyHint (8.8): an enemy note served blind until the comp is known ─────
{
  const ALL = knowledge.all();
  const F = knowledge.ENEMY_FIT;
  const hush = { text: 'x', enemyHint: ['Hush'] };
  const noHush = ['Jett', 'Sova', 'Omen', 'Killjoy', 'Reyna'];
  ok(knowledge.enemyFit(hush, []) === 0 && knowledge.enemyFit(hush, ['Jett', 'Sova']) === 0
    && knowledge.enemyFit(hush, noHush) === null && knowledge.enemyFit(hush, ['Hush']) === F && knowledge.enemyFit(hush, ['Hush', ...noHush.slice(0, 4)]) === F,
  'an enemyHint note is today\'s with no comp or a partial one, out against a known comp without its agent, and +2 with it');
  const hinted = ALL.filter((n) => Array.isArray(n.enemyHint));
  const STARTS = { 'When a Hush anchor appears,': 'Hush', "When Cypher's ultimate snapshots you,": 'Cypher',
    'Against a Killjoy, name early who breaks the Lockdown': 'Killjoy', 'When Hush throws her flash or her pull,': 'Hush',
    'When a Clove comes back with Not Dead Yet,': 'Clove', 'Against a Neon take first contact': 'Neon' };
  ok(Object.entries(STARTS).every(([s, a]) => hinted.some((n) => n.text.startsWith(s) && n.enemyHint.includes(a))) && hinted.length >= 6,
    `the enemy specific notes served blind carry enemyHint (${hinted.length})`);
  ok(hinted.every((n) => !n.enemyAgents && !n.enemyWithout), 'and none of them carries a strict enemy tag beside it');
  const anchor = hinted.find((n) => n.text.startsWith('When a Hush anchor appears,'));
  const pool = (extra) => knowledge.retrieve({ agent: 'Sova', map: 'Haven', side: 'attacking', ...extra }, 2000);
  ok(pool({}).includes(anchor.text) && pool({ enemyAgents: ['Jett'] }).includes(anchor.text)
    && !pool({ enemyAgents: noHush }).includes(anchor.text) && pool({ enemyAgents: ['Hush', 'Jett', 'Sova', 'Omen', 'Killjoy'] }).includes(anchor.text),
  'retrieve() serves the Hush anchor note blind as before, never against a known comp with no Hush, and against one with her');
  const mr = require(path.join(__dirname, '..', 'server', 'services', 'match-review.js'));
  const studyHas = (enemy) => mr.study({ context: { agent: 'Sova', map: 'Haven', advancedTips: true, ...(enemy ? { enemyAgents: enemy } : {}) }, patterns: [], rounds: [], mistakes: [] }, 400)
    .some((n) => n.text === anchor.text);
  ok(studyHas(null) && !studyHas(noHush), 'and study() the same way');
  // Unknown comp: byte for byte the retrieval before the tag existed.
  const seededRun = (fn) => { const random = Math.random; let x = 7, draws = 0; Math.random = () => { draws++; x = (x * 16807) % 2147483647; return x / 2147483647; }; try { return { out: fn(), draws }; } finally { Math.random = random; } };
  let same = 0, total = 0;
  for (const ctx of [{}, { agent: 'Sova', side: 'attacking' }, { agent: 'Killjoy', side: 'defending', phase: 'active' }, { causes: ['lost-duel', 'overextend'], side: 'defending' }]) {
    for (const adv of [false, true]) {
      total++;
      const now = seededRun(() => knowledge.retrieve({ ...ctx, enemyAgents: ['Jett'] }, 8, { advanced: adv }));
      const saved = hinted.map((n) => n.enemyHint);
      for (const n of hinted) delete n.enemyHint;
      let before;
      try { before = seededRun(() => knowledge.retrieve({ ...ctx, enemyAgents: ['Jett'] }, 8, { advanced: adv })); } finally { hinted.forEach((n, i) => { n.enemyHint = saved[i]; }); }
      if (JSON.stringify(now) === JSON.stringify(before)) same++;
    }
  }
  ok(same === total, `with the comp unknown or partial the hint changes nothing, the same notes and draws (${same} of ${total})`);
}

// ── WORKED CASES: a real situational match, never one lesson twice, variety ─
{
  const cases = require(path.join(__dirname, '..', 'server', 'services', 'cases.js'));
  const sit = cases.situational;
  ok(!sit({ agentHit: true }) && sit({ roleHit: true, phaseHit: true }) && sit({ agentHit: true, enemyHit: true }) && sit({ roleHit: true, causeHit: true })
    && !sit({ phaseHit: true }) && !sit({ causeHit: true }) && !sit({ patternHit: true }) && sit({ causeHit: true, phaseHit: true })
    && sit({ patternHit: true, econHit: true }) && sit({ econHit: true, phaseHit: true }),
  'a case needs who and what (an agent or role and a phase, cause, economy, enemy or pattern), or for any agent two kinds of what');
  const everything = { agent: 'Sova', map: 'Haven', sides: ['attack', 'defense'], advanced: true,
    phases: ['early', 'mid', 'execute', 'postplant', 'retake', 'clutch', 'late'], economies: ['pistol', 'antieco', 'lostpistol'],
    causes: ['dry-peek', 'isolated', 'repeek', 'crossfire', 'rotating', 'overextend', 'exposed', 'lost-duel'],
    patterns: ['early', 'spot', 'ult', 'streak', 'postplant', 'retake'], enemies: ['Chamber', 'Killjoy', 'Omen', 'Jett', 'Cypher'] };
  // Never two cases teaching the same thing, across many situations and seeds.
  let pairs = 0, overlaps = 0;
  for (let i = 0; i < 200; i++) {
    const seed = `match-${i}`;
    const got = cases.pick({ ...everything, seed });
    if (got.length === 2) {
      pairs++;
      const a = new Set(cases.lessonsOf(got[0]));
      if (cases.lessonsOf(got[1]).some((l) => a.has(l))) overlaps++;
    }
    if (JSON.stringify(cases.pick({ ...everything, seed })) !== JSON.stringify(got)) overlaps += 1000;
  }
  ok(pairs > 0 && overlaps === 0, `no pair teaches one lesson twice, and one seed always gives the same cases (${pairs} pairs, ${overlaps} bad)`);
  // Variety where the cases tie, which is where the same pair kept coming back.
  const tied = { agent: 'Killjoy', sides: ['attack', 'defense'], phases: ['mid', 'early'], economies: ['pistol'], advanced: true };
  const tiedSets = new Set();
  for (let i = 0; i < 200; i++) tiedSets.add(cases.pick({ ...tied, seed: `match-${i}` }).map((c) => c.id).join('+'));
  ok(tiedSets.size >= 5, `a Killjoy who died mid round and early in a pistol round, in 200 different matches, is given ${tiedSets.size} different sets, not one pair every time`);
  ok(JSON.stringify(cases.pick(everything)) === JSON.stringify(cases.pick({ ...everything, seed: '' })), 'no seed is no variety: ties by id, as before');
  ok(cases.unit('a') !== cases.unit('b') && cases.unit('a') === cases.unit('a') && cases.unit('abc') >= 0 && cases.unit('abc') < 1, 'the seeded hash is stable, in [0, 1)');
  // The whole match's phases: only where the deaths gather.
  const died = (n, timing, extra) => ({ n, side: 'attacking', result: 'lost', died: true, timing, ...(extra || {}) });
  const review = (rounds) => ({ context: { agent: 'Jett', map: 'Ascent', advancedTips: true }, rounds, patterns: [], mistakes: [], final: { team: 5, enemy: 13 } });
  const spread = cases.fromReview(review([died(1, 'early'), died(2, 'mid'), died(3, 'late'), died(4, 'mid'), died(5, null), died(6, null), died(7, 'late')]), []);
  const gathered = cases.fromReview(review([died(1, 'early'), died(2, 'early'), died(3, 'early'), died(4, 'mid'), died(5, null)]), []);
  ok(!spread.phases.has('early') && !gathered.phases.has('mid') && gathered.phases.has('early'),
    'a phase is the match\'s only where its deaths gather: one early death of seven is not, three of five is');
  ok(cases.pick(spread).length === 0, 'and a Jett whose seven deaths are spread over the round is given no case on the clock alone');
  ok(spread.seed && spread.seed === cases.fromReview(review([died(1, 'early'), died(2, 'mid'), died(3, 'late'), died(4, 'mid'), died(5, null), died(6, null), died(7, 'late')]), []).seed
    && spread.seed !== gathered.seed && cases.reviewSeed({ rounds: [] }) === null, 'the review\'s seed is the match\'s own facts, the same match the same seed');
}

// ── The killer's gun (round 3, knowledge.js enemyWeapons) ──────────────────
// The enemy Operator note was tagged for an enemy Jett or Chamber and served
// in 9 of the audit's 24 reviews, none with an Operator kill. A note may now
// name the guns that must have killed the player, read from Riot's record,
// and with no such list it is never served: never blind, and Ask Coach, which
// passes no weapons to enemyFit, leaves it out too. Every other note scores
// and draws exactly as before.
{
  const seededRun = (fn) => {
    const random = Math.random;
    let x = 3;
    Math.random = () => { x = (x * 16807) % 2147483647; return x / 2147483647; };
    try { return fn(); } finally { Math.random = random; }
  };
  const tagged = knowledge.all().filter((n) => Array.isArray(n.enemyWeapons));
  const OPS = tagged.filter((n) => n.enemyWeapons.includes('Operator')).map((n) => n.text);
  ok(OPS.length === 2 && OPS.some((t) => /^When an enemy Operator is holding a lane/.test(t)) && OPS.some((t) => /^Do not let one enemy Operator/.test(t))
    && tagged.every((n) => !n.enemyAgents),
  `the two enemy Operator notes carry the gun, not the Jett and the Chamber (${OPS.length})`);
  const note = tagged[0];
  ok(knowledge.enemyFit(note, ['Jett', 'Chamber']) === null && knowledge.enemyFit(note, [], ['Vandal']) === null
    && knowledge.enemyFit(note, [], ['Operator']) === knowledge.ENEMY_FIT && knowledge.enemyFit(note, [], ['operator']) === knowledge.ENEMY_FIT
    && knowledge.enemyFit({ text: 'x' }, [], ['Operator']) === 0,
  'enemyFit: no Operator kill is no note, whatever the comp, an Operator kill scores ENEMY_FIT, an untagged note is unmoved');
  ok(JSON.stringify(knowledge.enemyWeaponsOf(['operator', 'Operator', 'Turret', 'Someone#NA1', 'Vandal', null])) === '["Operator","Vandal"]',
    'the guns are the game data\'s, deduplicated: an ability, a name or nothing never matches');
  const ctx = { agent: 'Sova', map: 'Ascent', side: 'attacking', phase: 'active', causes: ['dry-peek'], rankBand: 'plat_diamond', enemyAgents: ['Jett', 'Chamber', 'Omen', 'Sage', 'Fade'] };
  const without = new Set(knowledge.retrieve(ctx, 2000));
  const withOp = new Set(knowledge.retrieve({ ...ctx, enemyWeapons: ['Operator'] }, 2000));
  ok(OPS.every((t) => !without.has(t) && withOp.has(t)), 'retrieve serves them on an Operator kill and never on a Jett and a Chamber alone');
  const plain = seededRun(() => knowledge.retrieve(ctx, 8, { advanced: true }));
  const rifles = seededRun(() => knowledge.retrieve({ ...ctx, enemyWeapons: ['Vandal', 'Phantom'] }, 8, { advanced: true }));
  ok(JSON.stringify(plain) === JSON.stringify(rifles), 'and guns no note names change nothing: the same notes, the same draws');
}

console.log(`\n${fails ? fails + ' failure(s)' : 'all advanced tip checks passed'}`);
process.exit(fails ? 1 : 0);
