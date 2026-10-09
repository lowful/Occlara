'use strict';

/**
 * The breakdown on the real fixtures: what each map and agent row counts, the
 * floors that keep a small sample from reading as a rate, the headline rule,
 * old saved cards read back from their fact lines, the recorded sessions as
 * the real engine read them, and the other two games. And the claims a row
 * makes: the second pistol from Riot's own sides, a death spot only when it
 * leads, a repeat only of the same place, agent or direction, a hero's duty
 * from its labelled role, and League one mode at a time, the most played first.
 *
 * Run: npm run test:breakdown
 */

const path = require('path');
const Module = require('module');
const { replay, load } = require('./fixtures/replay-match');
const verify = require('../src/shared/valorant-verify');
const review = require('../src/shared/valorant-review');
const riotReview = require('../src/shared/riot-review');
const breakdown = require('../src/shared/breakdown');

// The engine reads the recorded sessions below, with the network replaced as
// test-session-replay.js replaces it: nothing here is sent anywhere.
const realLoad = Module._load;
Module._load = function patched(request, parent, isMain) {
  if (request === './api-client') {
    return {
      post: async () => ({ ok: true, status: 200, data: { summary: 'A summary.', rounds: {}, focus: null, study: [] } }),
      get: async () => ({ ok: false }),
    };
  }
  return realLoad(request, parent, isMain);
};
const CoachingEngine = require(path.join(__dirname, '..', 'src', 'main', 'services', 'coaching-engine.js'));
Module._load = realLoad;

/** A recorded session read by the real engine, read by read on its own clock: its ledger and context. */
function session(file) {
  const frames = load(file).frames;
  const t0 = Date.parse('2026-10-04T20:00:00Z');
  let clock = t0;
  const realNow = Date.now;
  const realLog = console.log;
  Date.now = () => clock;
  console.log = () => {};
  try {
    const e = new CoachingEngine({ licenseKey: 'TEST', captureFunction: async () => null, experiments: () => ({}) });
    e.isRunning = true;
    for (const f of frames) {
      clock = t0 + f.t * 1000;
      const { t, ...context } = f;
      e.applyRead({ data: { context: { ...context } }, shot: null, at: clock });
    }
    return { rounds: e.ledger.list(), context: { ...e.matchContext } };
  } finally {
    console.log = realLog;
    Date.now = realNow;
  }
}

// Every number a round card gives the breakdown, all of them Riot's.
const ROUND_KEYS = ['attack', 'defence', 'pistol', 'postPlant', 'retake', 'firstKill', 'firstDeath', 'survived', 'traded'];

let fails = 0;
let checks = 0;
const ok = (cond, what) => {
  checks++;
  if (!cond) { fails++; console.log(`FAIL  ${what}`); } else console.log(`ok    ${what}`);
};
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// The two dashes the house rules ban, built from their code points so this
// file carries neither character, and checked against both and against a
// plain hyphen.
const DASHES = new RegExp(`[${String.fromCharCode(0x2013)}${String.fromCharCode(0x2014)}]`);
ok(DASHES.test(`a${String.fromCharCode(0x2014)}b`) && DASHES.test(`a${String.fromCharCode(0x2013)}b`) && !DASHES.test('a-b'),
  'the dash pattern matches both dashes and not a hyphen');

const riot = load('riot-abyss-13-11.json');
const played = replay(load('valorant-match-abyss-13-11.json').frames, 'standard');
const { rounds } = verify.reconcile(played.rounds, riot);
const TRACKER = { matchId: 'w1', map: 'Abyss', agent: 'Jett', result: 'Victory', score: '13-11', kills: 31,
  deaths: 21, assists: 4, kd: 1.48, acs: 382, adr: 243, headshotPct: 25 };
const watched = review.build({ rounds, context: { ...played.context, map: 'Abyss', agent: 'Jett' }, endedBy: 'score',
  ai: {}, role: 'Duelist', history: [], riotMe: riot.me, queue: riot.queue, tracker: TRACKER });

const T0 = Date.parse('2026-09-01T18:00:00Z');
const HOUR = 3600000;
const letterOf = (s) => (s >= 90 ? 'S' : s >= 80 ? 'A' : s >= 70 ? 'B' : s >= 60 ? 'C' : 'D');
let seq = 0;
/** A saved entry as reviewStore.recent() hands them over, with the fields a case needs changed. */
function saved(rv, over = {}) {
  seq++;
  const r = JSON.parse(JSON.stringify(rv));
  for (const k of ['map', 'agent', 'mode', 'result']) if (over[k] !== undefined) r.game[k] = over[k];
  if (over.grade !== undefined) {
    r.grade = over.grade === null ? null
      : { ...r.grade, score: over.grade, letter: letterOf(over.grade), provisional: !!over.provisional };
  }
  return { id: `valorant-${T0 + seq * HOUR}-t${String(seq).padStart(4, '0')}`, game: 'valorant', at: T0 + seq * HOUR, review: r };
}
const newestFirst = (list) => list.slice().sort((a, b) => b.at - a.at);

// ── One real match, counted by hand from Riot's record ─────────────────────
const one = breakdown.build('valorant', [saved(watched)]);
const abyss = one.rows.map[0];
{
  ok(one.matches === 1 && one.rows.map.length === 1 && abyss.label === 'Abyss' && abyss.matches === 1,
    'one match is one Abyss row');
  ok(same(abyss.record, { won: 1, lost: 0, drawn: 0, known: 1 }) && abyss.winRate.pct === null && abyss.winRate.n === 1,
    'a 1-0 record, and no win rate from one match');
  const s = abyss.stats;
  ok(same(s.attack, { count: 6, n: 12, pct: 50 }) && same(s.defence, { count: 7, n: 12, pct: 58 }),
    `attack 6 of 12 and defence 7 of 12, as Riot has them (${s.attack.count}/${s.attack.n}, ${s.defence.count}/${s.defence.n})`);
  ok(same(s.pistol, { count: 1, n: 2, pct: null }), 'pistol rounds are 1 and 13: one won, two too few for a rate');
  ok(same(s.postPlant, { count: 6, n: 10, pct: 60 }) && same(s.retake, { count: 2, n: 6, pct: 33 }),
    'post plants 6 of 10 on attack, retakes 2 of 6 on defence');
  ok(same(s.firstKill, { count: 8, n: 24, pct: 33 }) && same(s.firstDeath, { count: 4, n: 24, pct: 17 }),
    'first kill in 8 of 24 rounds, first death in 4');
  ok(same(s.survived, { count: 3, n: 24, pct: 13 }) && same(s.traded, { count: 1, n: 21, pct: 5 }),
    'alive at the end of 3 rounds, 1 of 21 deaths traded');
  ok(s.kd.value === 1.48 && s.kd.kills === 31 && s.kd.deaths === 21 && s.acs.value === 382 && s.adr.value === 243
    && s.hs.value === 25, 'the scoreboard is the scoreline, K/D as kills over deaths');
  ok(s.checked === 1 && s.rounds === 24 && one.checked === 1, 'one match checked against Riot, 24 rounds');
  // ONE PLACE HOWEVER THE SCREEN CASED IT. The real match reads "A site" once
  // (round 6) beside five "A Site", and the review's own spot pattern and
  // insights fold case too, so the tally here does as well.
  const placed = watched.rounds.filter((c) => c.died && c.spot);
  const counts = new Map();
  for (const c of placed) {
    const k = c.spot.toLowerCase();
    const e = counts.get(k) || { spot: c.spot, deaths: 0 };
    e.deaths++;
    counts.set(k, e);
  }
  const top = [...counts.values()].sort((a, b) => b.deaths - a.deaths)[0];
  ok(abyss.spots.placed === placed.length && abyss.spots.top[0].spot === top.spot && abyss.spots.top[0].deaths === top.deaths,
    `where the coach placed the deaths: ${top.spot}, ${top.deaths} of ${placed.length}`);
  ok(placed.some((c) => c.spot === 'A site') && abyss.spots.top[0].spot === 'A Site' && abyss.spots.top[0].deaths === 6
    && abyss.spots.placed === 17, 'rounds 2, 6, 7, 14, 16 and 18 are one place: A Site, 6 of the 17 placed');
  ok(Boolean(abyss.spots.callout) === (top.deaths >= 3 && top.deaths * 4 >= placed.length), 'the spot callout follows its floor');
  ok(abyss.mistake === null && abyss.strength === null, 'one match repeats nothing');
  ok(abyss.vsRest === null, 'and has nothing to be compared with');
  ok(one.rows.agent.length === 1 && one.rows.agent[0].label === 'Jett' && one.rows.agent[0].sub === 'Duelist'
    && one.rows.agent[0].spots === null, 'the agent row names the role, and places no deaths');
  ok(abyss.sub === null, 'a map row has no role');
}

// ── An old saved review reads the same from its fact lines ─────────────────
{
  const legacy = JSON.parse(JSON.stringify(watched));
  delete legacy.source;
  for (const c of legacy.rounds) {
    delete c.sideKey; delete c.verified; delete c.watched; delete c.spot; delete c.ultReady; delete c.riot;
  }
  const old = breakdown.build('valorant', [saved(legacy)]).rows.map[0];
  ok(same(old.stats, abyss.stats), 'every round stat of a pre 8.0.3 review matches the structured cards');
  ok(same(old.spots, abyss.spots), 'and so do the death spots');
}

// ── A match graded from Riot's record alone ─────────────────────────────────
{
  const only = riotReview.fromRiot({ row: { ...TRACKER, matchId: 'r1', mode: 'Unrated', startedAt: T0 }, riot, history: [] }).review;
  const r = breakdown.build('valorant', [saved(only)]).rows.map[0];
  for (const k of ROUND_KEYS) {
    ok(same(r.stats[k], abyss.stats[k]), `Riot only rounds count the same ${k}`);
  }
  ok(r.spots.placed === 0 && r.spots.callout === null && r.spots.top.length === 0,
    'and a match the coach never watched places no death');
  // Not even from a card that claims a place: nothing in a match the coach
  // never watched came off the screen.
  const odd = JSON.parse(JSON.stringify(only));
  Object.assign(odd.rounds.find((c) => c.died), { spot: 'A Site', watched: true });
  ok(breakdown.build('valorant', [saved(odd)]).rows.map[0].spots.placed === 0, 'whatever one of its cards claims');
}

// ── Overtime is never a pistol round ────────────────────────────────────────
{
  // A 14 to 12 match plays rounds 25 and 26 on full buys. Counting them as
  // pistols (round 25 is 1 after twice 12) would fold two gun rounds in.
  const ot = JSON.parse(JSON.stringify(watched));
  for (const n of [25, 26]) ot.rounds.push({ ...JSON.parse(JSON.stringify(ot.rounds[0])), n });
  ot.game.score = '14-12';
  const r = breakdown.build('valorant', [saved(ot)]).rows.map[0];
  ok(same(r.stats.pistol, abyss.stats.pistol) && r.stats.rounds === 26,
    `rounds 25 and 26 are counted, and neither is a pistol round (${JSON.stringify(r.stats.pistol)})`);
}

// ── The second pistol is where Riot's sides change ─────────────────────────
{
  // A review linked by 8.0.0 or 8.0.1 carries the screen's halftimeAfter, and
  // the screen has locked swiftplay on a competitive match: 4 on a 24 round
  // standard match. Riot's sides change after round 12, so the pistols stay
  // rounds 1 and 13, one won and one lost. Taken from halftimeAfter they
  // would be rounds 1 and 5, both won.
  const wrong = JSON.parse(JSON.stringify(watched));
  wrong.halftimeAfter = 4;
  const r = breakdown.build('valorant', [saved(wrong)]).rows.map[0];
  ok(same(r.stats.pistol, { count: 1, n: 2, pct: null }) && same(r.stats.pistol, abyss.stats.pistol),
    `a wrong halftimeAfter of 4 still finds pistols 1 and 13 from the sides (${JSON.stringify(r.stats.pistol)})`);
  // The same from a card saved before 8.0.3, whose side is only its label.
  const old = JSON.parse(JSON.stringify(wrong));
  delete old.source;
  for (const c of old.rounds) { delete c.sideKey; delete c.verified; delete c.watched; delete c.spot; delete c.ultReady; delete c.riot; }
  ok(same(breakdown.build('valorant', [saved(old)]).rows.map[0].stats.pistol, { count: 1, n: 2, pct: null }),
    'and so does an old card, from its Attack and Defence labels');
  // With no side on any card, halftimeAfter is all there is to go on.
  const blind = JSON.parse(JSON.stringify(wrong));
  for (const c of blind.rounds) { c.sideKey = null; c.side = null; }
  ok(same(breakdown.build('valorant', [saved(blind)]).rows.map[0].stats.pistol, { count: 2, n: 2, pct: null }),
    'with no sides known, halftimeAfter decides: rounds 1 and 5, both won');

  const sp = breakdown.secondPistol;
  const sided = (side, ns) => ns.map((n) => ({ n, side }));
  ok(sp([...sided('defending', [1, 2, 12]), ...sided('attacking', [13, 14])], 4) === 13,
    'the first round on the other side is the second pistol, whatever halftimeAfter says');
  ok(sp(sided('attacking', [1, 2, 3, 4, 5, 6, 7, 8]), 4) === null,
    'a match that ended in its first half has no second pistol, though halftimeAfter names round 5');
  ok(sp([...sided('attacking', [1, 2, 24]), ...sided('defending', [25])], 12) === null,
    'a side change in overtime is never a pistol round');
  ok(sp([{ n: 1, side: null }, ...sided('attacking', [13])], 12) === 13 && sp(sided('attacking', [1]), 12) === 13,
    'round 1 with no side, or no later side, leaves it to halftimeAfter');
  ok(sp([], null) === null, 'and with neither, there is no second pistol');
}

// ── A death spot is called out only when it leads ──────────────────────────
{
  // Four placed deaths at A Site and four at B Site, nothing else placed. A
  // tie names no place: picking one alphabetically called A Site the place
  // the player dies most, when B Site is exactly as much so.
  const tie = JSON.parse(JSON.stringify(watched));
  const died = tie.rounds.filter((c) => c.died);
  died.forEach((c, i) => { c.spot = i < 4 ? 'A Site' : i < 8 ? 'B Site' : null; });
  const t = breakdown.build('valorant', [saved(tie)]).rows.map[0].spots;
  ok(t.placed === 8 && t.callout === null && t.top.map((x) => `${x.spot}:${x.deaths}`).join() === 'A Site:4,B Site:4',
    `a tie at the top is listed and never called out (${JSON.stringify(t)})`);
  died[8].spot = 'A Site';
  const l = breakdown.build('valorant', [saved(tie)]).rows.map[0].spots;
  ok(l.callout && l.callout.spot === 'A Site' && l.callout.deaths === 5 && l.callout.placed === 9,
    `one more at A Site and it leads, so it is called out (${JSON.stringify(l.callout)})`);
}

// ── The recorded sessions, as the real engine read them ────────────────────
{
  // The same 24 round Abyss match, read every ten seconds by the real engine:
  // another screen ledger, with round 8 lost to a misread score and a death in
  // round 17 that Riot does not have. Once Riot checks it every round number
  // is Riot's, so it counts exactly what was counted by hand above.
  const s = session('valorant-session-abyss-unrated.json');
  const { rounds: vr } = verify.reconcile(s.rounds, riot);
  const rv = review.build({ rounds: vr, context: { ...s.context, map: 'Abyss', agent: 'Jett' }, endedBy: 'stop',
    ai: {}, role: 'Duelist', history: [], riotMe: riot.me, queue: riot.queue, tracker: TRACKER });
  const row = breakdown.build('valorant', [saved(rv)]).rows.map[0];
  const differ = ROUND_KEYS.filter((k) => !same(row.stats[k], abyss.stats[k]));
  ok(s.rounds.length >= 20 && !differ.length,
    `another reading of the same match counts the same round numbers once Riot checks it (${differ.join() || 'all equal'})`);
  const placed = rv.rounds.filter((c) => c.died && c.spot).length;
  ok(row.spots.placed === placed && s.rounds.some((r) => r.n === 17 && r.died && r.deathSpot)
    && !rv.rounds.find((c) => c.n === 17).spot,
    `the screen's round 17 death is not placed once Riot says it did not happen (${placed} placed)`);
}
{
  // Two recorded matches Riot never checked: a Split competitive stopped at 12
  // to 7, and a swiftplay on Abyss. The screen read a side and a result on
  // most of their rounds, and none of it reaches a round number.
  const split = session('valorant-session-split-competitive.json');
  const swift = session('valorant-session-abyss-swiftplay.json');
  const asReview = (s) => review.build({ rounds: s.rounds, context: s.context, endedBy: 'stop', ai: {}, role: null, history: [] });
  const b = breakdown.build('valorant', newestFirst([saved(asReview(split)), saved(asReview(swift))]));
  const read = split.rounds.filter((r) => r.side && r.result).length;
  ok(b.matches === 2 && b.checked === 0 && b.rows.map.map((r) => r.label).join() === 'Abyss,Split',
    'two recorded matches, neither checked against Riot');
  ok(read >= 15 && b.rows.map.every((r) => r.stats.checked === 0 && r.stats.rounds === 0
    && ROUND_KEYS.every((k) => r.stats[k].n === 0 && r.stats[k].pct === null)),
  `no round number from rounds Riot never checked, though the screen read a side and a result on ${read} of Split's`);
  ok(b.rows.map.every((r) => r.stats.kd.n === 0 && r.stats.kd.value === null && r.stats.acs.value === null),
    'and no scoreboard number without a scoreboard');
  ok(b.queues.map((q) => q.label).sort().join() === 'Standard,Swiftplay', "the screen's own mode names are the queues");
  ok(b.unknown.agent === 2 && b.rows.agent.length === 0, 'no agent was confirmed, so there is no agent row');
  const sp = b.rows.map.find((r) => r.label === 'Split').spots;
  ok(sp.placed === 17 && sp.top.length === 3 && sp.top[0].spot === 'A Site' && sp.top[0].deaths === 4 && sp.callout === null,
    `Split: A Site is 4 of the 17 placed deaths, under a quarter, so it is listed and never called out (${JSON.stringify(sp.top[0])})`);
  const ab = b.rows.map.find((r) => r.label === 'Abyss').spots;
  ok(ab.placed === 4 && ab.top.length === 0 && ab.callout === null, `the swiftplay places ${ab.placed} deaths, too few to list a spot`);
}

// ── Several matches: grouping, floors, repeats, the rest, the headline ─────
{
  const list = newestFirst([
    saved(watched, { grade: 80 }), saved(watched, { grade: 76 }), saved(watched, { grade: 72 }),
    saved(watched, { map: 'Bind', agent: 'Sova', result: 'Defeat', grade: 60 }),
    saved(watched, { map: 'Bind', agent: 'Sova', result: 'Defeat', grade: 64 }),
    saved(watched, { map: 'Bind', grade: 70 }),
    saved(watched, { map: 'Haven', agent: 'Omen', result: 'Defeat', grade: 50, provisional: true }),
  ]);
  const b = breakdown.build('valorant', list);
  const maps = b.rows.map.map((r) => `${r.label}:${r.matches}`).join();
  ok(maps === 'Abyss:3,Bind:3,Haven:1', `maps by matches, then grade (${maps})`);
  const [ab, bi, ha] = b.rows.map;
  ok(ab.winRate.pct === 100 && bi.winRate.pct === 33 && ha.winRate.pct === null, 'win rates from three matches up');
  ok(ab.grade.avg === 76 && ab.grade.letter === 'B' && ab.grade.n === 3, 'Abyss averages 76 over three graded matches');
  ok(ha.grade.avg === null && ha.grade.provisional === 1, 'a provisional grade is left out and counted as left out');
  ok(ab.mistake && ab.mistake.matches === 3 && ab.mistake.of === 3 && typeof ab.mistake.fix === 'string',
    `a mistake in all three Abyss matches repeats there (${ab.mistake && ab.mistake.title})`);
  ok(ab.vsRest && ab.vsRest.grade === 11 && ab.vsRest.winRate === 75,
    `Abyss against the rest: grade +11, win rate +75 points (${JSON.stringify(ab.vsRest)})`);
  // Three checked Abyss matches against four checked others, the same match
  // copied, so the first death share is identical on both sides.
  ok(ab.vsRest && ab.vsRest.firstDeath === 0, `and first deaths level with the rest (${ab.vsRest && ab.vsRest.firstDeath})`);
  const jett = b.rows.agent.find((r) => r.label === 'Jett');
  ok(jett.matches === 4 && jett.cross.map((c) => `${c.label}:${c.matches}`).join() === 'Abyss:3,Bind:1',
    'the agent row lists the maps it was played on');
  ok(jett.vsRest && jett.vsRest.firstDeath === null, 'an agent is not compared on first deaths, which differ by role');
  const kinds = b.headline.map((h) => `${h.kind}:${h.label}`).join();
  ok(kinds === 'strongest:Abyss,weakest:Bind,most:Jett', `the headline calls what clears the bar (${kinds})`);
  ok(b.headline.every((h) => h.title && h.detail && !DASHES.test(h.title + h.detail)), 'each with a title and a detail, no dashes');
  ok(b.note === null, 'and no note when something was called');
}
{
  const b = breakdown.build('valorant', newestFirst([saved(watched, { grade: 80 }), saved(watched, { map: 'Bind', grade: 60 })]));
  ok(!b.headline.some((h) => h.kind === 'strongest' || h.kind === 'weakest') && /stands out yet/.test(b.note || ''),
    'two matches call nothing, and say why');
  ok(!DASHES.test(b.note || ''), 'and the note carries no dash');
  // Against the rest needs three matches in the row and three outside it, and
  // that holds for first deaths too: 24 rounds a side clears the rounds floor
  // from one match each, which is a coincidence, not a comparison.
  ok(b.rows.map.length === 2 && b.rows.map.every((r) => r.vsRest === null),
    `one match on each side compares nothing, first deaths included (${JSON.stringify(b.rows.map.map((r) => r.vsRest))})`);
}

// ── A repeat is the same place, the same agent ─────────────────────────────
{
  // The real match's own death spot and killer entries, moved to another
  // place or agent in each match and alone in the list, so the row's repeated
  // mistake can only be one of them. saved() makes each newer than the last,
  // so the last one made is the newest, whose title a repeat used to wear.
  const spot = watched.insights.mistakes.find((m) => m.key === 'same-spot');
  const killer = watched.insights.mistakes.find((m) => m.key === 'same-killer');
  ok(spot && spot.place === 'A Site' && /A Site/.test(spot.fix) && killer && killer.agent === 'Skye' && /Skye/.test(killer.fix),
    'the real match has a death spot and a killer, each naming its place or agent in the fix');
  const moved = (entry, from, to) => JSON.parse(JSON.stringify(entry).split(from).join(to));
  const only = (mistakes) => {
    const s = saved(watched);
    s.review.insights = { mistakes, strengths: [], missed: [] };
    return s;
  };
  const rowOf = (list) => breakdown.build('valorant', newestFirst(list)).rows.map[0];
  const at = (place) => moved(spot, 'A Site', place);

  const spread = rowOf([only([at('Mid Top')]), only([at('A Site')]), only([at('B Main')])]);
  ok(spread.matches === 3 && spread.mistake === null,
    `dying at a different place in each of three matches repeats nothing (${spread.mistake && spread.mistake.title})`);
  const two = rowOf([only([at('A site')]), only([at('A Site')]), only([at('B Main')])]);
  ok(two.mistake && two.mistake.key === 'same-spot' && two.mistake.matches === 2 && two.mistake.of === 3
    && two.mistake.title === 'Dying at A Site' && /A Site/.test(two.mistake.fix) && !/B Main/.test(two.mistake.fix),
    `two of three at A Site, however the screen cased it, repeat as A Site, not as the newest match's B Main (${JSON.stringify(two.mistake)})`);

  const by = (agent) => moved(killer, 'Skye', agent);
  const killers = rowOf([only([by('Skye')]), only([by('Raze')]), only([by('Jett')])]);
  ok(killers.mistake === null, `a different agent winning in each of three matches repeats nothing (${killers.mistake && killers.mistake.title})`);
  const skye = rowOf([only([by('Skye')]), only([by('Skye')]), only([by('Jett')])]);
  ok(skye.mistake && skye.mistake.key === 'same-killer' && skye.mistake.matches === 2 && skye.mistake.of === 3
    && skye.mistake.title === 'Skye kept winning' && /Skye/.test(skye.mistake.fix) && !/Jett/.test(skye.mistake.fix),
    `Skye in two of three repeats as Skye, not as the newest match's Jett (${JSON.stringify(skye.mistake)})`);

  // A Site on Bind, on Abyss and on Haven are three places. An agent row spans
  // maps, so the same name on three maps repeats nothing there.
  const onMap = (map) => { const s = only([at('A Site')]); s.review.game.map = map; return s; };
  const jett = breakdown.build('valorant', newestFirst([onMap('Bind'), onMap('Abyss'), onMap('Haven')])).rows.agent[0];
  ok(jett.matches === 3 && jett.mistake === null,
    `"A Site" on three maps is not one repeated spot on an agent row (${jett.mistake && JSON.stringify(jett.mistake)})`);
  const twice = breakdown.build('valorant', newestFirst([onMap('Bind'), onMap('Bind'), onMap('Haven')])).rows.agent[0];
  ok(twice.mistake && twice.mistake.key === 'same-spot' && twice.mistake.matches === 2,
    'while A Site on the same map twice is');
}

// ── Queues, other modes, unknown maps ──────────────────────────────────────
{
  const list = newestFirst([
    saved(watched, { mode: 'Competitive' }), saved(watched, { mode: 'Unrated' }), saved(watched, { mode: 'Unrated' }),
    saved(watched, { mode: 'Spike Rush' }), saved(watched, { map: null }),
  ]);
  const all = breakdown.build('valorant', list);
  ok(all.left === 1 && all.matches === 4 && all.total === 4, 'Spike Rush is left out, and counted as left out');
  ok(all.queues.map((q) => `${q.label}:${q.matches}`).join() === 'Unrated:3,Competitive:1',
    `queues present, most played first (${all.queues.map((q) => q.label).join()})`);
  ok(all.unknown.map === 1 && all.rows.map.reduce((a, r) => a + r.matches, 0) === 3, 'a match with no map read is no map row');
  const comp = breakdown.build('valorant', list, { queue: 'Competitive' });
  ok(comp.queue === 'Competitive' && comp.matches === 1 && comp.total === 4, 'the queue filter keeps one queue');
  ok(breakdown.build('valorant', list, { queue: 'Nonsense' }).queue === 'All', 'an unknown queue falls back to All');
}

// ── Every pattern against a known string, and the weighting ────────────────
{
  const o = breakdown.outcome;
  ok(o('Victory') === 'won' && o('VICTORY') === 'won' && o('Win') === 'won' && o('won') === 'won',
    'a win reads as won however it is written');
  ok(o('Defeat') === 'lost' && o('DEFEAT') === 'lost' && o('Loss') === 'lost' && o('lost') === 'lost',
    'a loss reads as lost');
  ok(o('Draw') === 'drawn' && o('Tie') === 'drawn', 'a draw reads as drawn');
  ok(o(null) === null && o('') === null && o('Winter') === null && o('Remake') === null, 'and nothing else is a result');

  // Old cards: the fact lines roundFacts() writes, read back.
  const lived = breakdown.roundOf({ n: 3, side: 'Attack', result: 'won', died: false, planted: true,
    facts: ['Survived', '3 kills', 'First kill of the round', 'Spike planted at B Site'] }, { verified: true });
  ok(lived.side === 'attacking' && lived.verified && lived.riot.kills === 3 && lived.riot.firstKill === true
    && lived.riot.traded === null && lived.spot === null, 'an old card reads its side, kills and opening from its lines');
  const fell = breakdown.roundOf({ n: 4, side: 'Defence', result: 'lost', died: true, planted: false,
    facts: ['Died at A Main, 14s in, to Viper with a Vandal', 'First death of the round', 'Not traded', '1 kill'] },
  { verified: true });
  ok(fell.side === 'defending' && fell.spot === 'A Main' && fell.riot.kills === 1 && fell.riot.firstDeath === true
    && fell.riot.traded === false, 'and a death, its place, and that nobody traded it');
  const unseen = breakdown.roundOf({ n: 5, side: 'Attack', result: 'won', died: true,
    facts: ['Died 20s in, to Sova with a Vandal', 'Traded by a teammate', 'Not watched by the coach'] }, { verified: true });
  ok(unseen.watched === false && unseen.spot === null && unseen.riot.traded === true,
    'a round the coach did not watch is read as unwatched, and places no death');

  // ACS, ADR and headshots weighted by rounds: (382 x 24 + 200 x 16) / 40 is
  // 309, where a plain mean of the two matches would say 291.
  const long = saved(watched, { map: 'Pearl' });
  const short = saved(watched, { map: 'Pearl' });
  short.review.game.score = '13-3';
  short.review.scoreline = { ...short.review.scoreline, acs: 200, adr: 150, headshotPct: 15 };
  const pearl = breakdown.build('valorant', newestFirst([long, short])).rows.map[0];
  ok(pearl.stats.acs.value === 309 && pearl.stats.acs.n === 2 && pearl.stats.adr.value === 206 && pearl.stats.hs.value === 21,
    `ACS, ADR and headshots weighted by the rounds each match ran (${pearl.stats.acs.value}, ${pearl.stats.adr.value}, ${pearl.stats.hs.value})`);
  ok(pearl.stats.kd.value === 1.48 && pearl.stats.kd.kills === 62 && pearl.stats.kd.deaths === 42,
    'K/D is every kill over every death');
}

// ── Marvel Rivals ───────────────────────────────────────────────────────────
{
  const rv = (hero, role, map, result, sl, score) => ({ id: `rivals-${T0 + (++seq) * HOUR}-r${seq}`, game: 'rivals', at: T0 + seq * HOUR,
    review: { kind: 'rivals', empty: false, game: { hero, role, map, mode: 'Competitive', result },
      scoreline: sl, grade: { score, letter: letterOf(score), provisional: false, categories: [] },
      insights: { mistakes: [], strengths: [], missed: [] } } });
  const list = newestFirst([
    rv('Luna Snow', 'Strategist', 'Tokyo 2099', 'VICTORY', { kills: 10, deaths: 5, assists: 20, damage: 8000, healing: 15000, blocked: 0, accuracy: 40 }, 78),
    rv('Luna Snow', 'Strategist', 'Yggsgard', 'DEFEAT', { kills: 6, deaths: 7, assists: 18, damage: 6000, healing: 17000, blocked: 0, accuracy: 44 }, 66),
    rv('Hela', 'Duelist', 'Tokyo 2099', 'VICTORY', { kills: 30, deaths: 8, assists: 5, damage: 30000, healing: 0, blocked: 0, accuracy: 50 }, 85),
  ]);
  const b = breakdown.build('rivals', list);
  ok(same(b.dims.map((d) => d.key), ['map', 'hero']), 'Rivals is by map and by hero');
  const luna = b.rows.hero.find((r) => r.label === 'Luna Snow');
  ok(luna.sub === 'Strategist' && luna.stats.kd.value === 1.33 && luna.stats.duty.label === 'Healing'
    && luna.stats.duty.value === 16000 && luna.stats.accuracy.value === 42, 'a Strategist is read on healing and her own accuracy');
  ok(same(luna.record, { won: 1, lost: 1, drawn: 0, known: 2 }), 'VICTORY and DEFEAT read as a 1-1 record');
  const tokyo = b.rows.map.find((r) => r.label === 'Tokyo 2099');
  ok(tokyo.matches === 2 && tokyo.stats.accuracy === null && tokyo.stats.duty === null,
    'a map row never averages accuracy or duty across heroes');
}
{
  // Deadpool is three roles. Two matches as a Strategist and one as a
  // Vanguard: the row is labelled Strategist, so its healing is the two
  // Strategist matches' alone, never the Vanguard match's 300 folded in.
  const dp = (role, healing, blocked) => ({ id: `rivals-${T0 + (++seq) * HOUR}-d${seq}`, game: 'rivals', at: T0 + seq * HOUR,
    review: { kind: 'rivals', empty: false, game: { hero: 'Deadpool', role, map: 'Tokyo 2099', mode: 'Competitive', result: 'VICTORY' },
      scoreline: { kills: 10, deaths: 5, assists: 5, damage: 9000, healing, blocked, accuracy: 40 },
      grade: { score: 70, letter: 'B', provisional: false, categories: [] }, insights: { mistakes: [], strengths: [], missed: [] } } });
  const row = breakdown.build('rivals', newestFirst([dp('Strategist', 10000, 0), dp('Vanguard', 300, 25000), dp('Strategist', 14000, 0)]))
    .rows.hero[0];
  ok(row.sub === 'Strategist' && row.stats.duty && row.stats.duty.label === 'Healing'
    && row.stats.duty.value === 12000 && row.stats.duty.n === 2,
    `a hero of several roles is read on the labelled role's duty over that role's matches (${JSON.stringify(row.stats.duty)})`);
}
{
  // What repeats across Rivals matches is the direction against the
  // player's average. Each match's own percentage ("Kills down 50%") is not
  // the repeat, so the row says the direction alone, the right way round for
  // deaths, where lower is better.
  const insights = require('../src/shared/insights');
  const vs = (id, label, value, baseline, lowerIsBetter) => {
    const delta = value - baseline;
    return { id, label, scope: 'role', value, baseline, delta, better: lowerIsBetter ? delta < 0 : delta > 0, games: 4 };
  };
  const match = (hero, role, against) => {
    const review = { kind: 'rivals', empty: false, against, scoreline: {},
      game: { hero, role, map: 'Tokyo 2099', mode: 'Competitive', result: 'VICTORY' },
      grade: { score: 70, letter: 'B', provisional: false, categories: [] } };
    review.insights = insights.rivals(review);
    return { id: `rivals-${T0 + (++seq) * HOUR}-v${seq}`, game: 'rivals', at: T0 + seq * HOUR, review };
  };
  const list = newestFirst([
    match('Luna Snow', 'Strategist', [vs('kills', 'Kills', 6, 10), vs('deaths', 'Deaths', 5, 8, true)]),
    match('Luna Snow', 'Strategist', [vs('kills', 'Kills', 8, 10), vs('deaths', 'Deaths', 6, 8, true)]),
    match('Luna Snow', 'Strategist', [vs('kills', 'Kills', 5, 10), vs('deaths', 'Deaths', 10, 8, true)]),
    match('Hela', 'Duelist', [vs('deaths', 'Deaths', 12, 8, true)]),
    match('Hela', 'Duelist', [vs('deaths', 'Deaths', 11, 8, true)]),
  ]);
  const own = list.flatMap((s) => [...s.review.insights.mistakes, ...s.review.insights.strengths])
    .filter((x) => x.key.startsWith('vs:'));
  ok(own.length === 8 && own.every((x) => /\d+%$/.test(x.title)) && own.some((x) => x.title === 'Kills down 50%'),
    `each match's own comparison carries that match's percentage (${own.map((x) => x.title).join(', ')})`);
  const rows = breakdown.build('rivals', list).rows.hero;
  const luna = rows.find((r) => r.label === 'Luna Snow');
  const hela = rows.find((r) => r.label === 'Hela');
  ok(luna.mistake && luna.mistake.title === 'Kills below your average' && luna.mistake.matches === 3,
    `kills down in three matches repeat as below the average, with no one match's number (${luna.mistake && luna.mistake.title})`);
  ok(luna.strength && luna.strength.title === 'Deaths below your average' && luna.strength.matches === 2,
    `fewer deaths in two of three repeat as a strength, below the average (${luna.strength && luna.strength.title})`);
  ok(hela.mistake && hela.mistake.title === 'Deaths above your average' && hela.mistake.matches === 2,
    `more deaths in both repeat as a mistake, above the average (${hela.mistake && hela.mistake.title})`);
  ok([luna.mistake, luna.strength, hela.mistake].every((x) => x && !/\d/.test(x.title) && !DASHES.test(x.title)),
    'no repeated title carries a number or a dash');
}

// ── League of Legends ───────────────────────────────────────────────────────
{
  const lr = (champion, role, durationSec, sl, score) => ({ id: `lol-${T0 + (++seq) * HOUR}-l${seq}`, game: 'lol', at: T0 + seq * HOUR,
    review: { game: { champion, role, durationSec, mode: 'CLASSIC' }, scoreline: sl,
      grade: { score, letter: letterOf(score), provisional: false, categories: [] }, insights: { mistakes: [], strengths: [], missed: [] } } });
  const b = breakdown.build('lol', newestFirst([
    lr('Ahri', 'Middle', 1800, { kills: 8, deaths: 2, assists: 6, cs: 240, ward: 18 }, 80),
    lr('Ahri', 'Middle', 1800, { kills: 4, deaths: 6, assists: 4, cs: 210, ward: 12 }, 62),
  ]));
  const ahri = b.rows.champion[0];
  ok(same(b.dims.map((d) => d.key), ['champion']) && ahri.record === null && ahri.winRate === null,
    'League is by champion, with no record, since its reviews carry no result');
  ok(ahri.stats.csPerMin.value === 7.5 && ahri.stats.kda.value === 2.75 && ahri.stats.visionPerMin.value === 0.5
    && ahri.stats.deathsPer10.value === 1.3, 'CS, KDA, vision and deaths per ten from the totals');
  const lulu = breakdown.build('lol', [lr('Lulu', 'UTILITY', 1800, { kills: 1, deaths: 3, assists: 20, cs: 30, ward: 60 }, 70)])
    .rows.champion[0];
  ok(lulu.stats.csPerMin.value === null && lulu.stats.csPerMin.n === 0 && lulu.stats.visionPerMin.value === 2,
    'a support is not read on CS, and is on vision');
}
{
  // One mode at a time. An ARAM, an Arena (CHERRY to the client) and a URF
  // game of Ahri's are other maps on other clocks: the ARAM's 60 CS in twenty
  // minutes alone would pull her Rift 7.5 a minute down to 6.4. A game with no
  // mode recorded is the Rift, since nothing says it was not; a practice tool
  // game is no game.
  const game = (mode, champion, durationSec, sl) => ({ id: `lol-${T0 + (++seq) * HOUR}-m${seq}`, game: 'lol', at: T0 + seq * HOUR,
    review: { game: { champion, role: 'Middle', durationSec, mode }, scoreline: sl,
      grade: { score: 70, letter: 'B', provisional: false, categories: [] }, insights: { mistakes: [], strengths: [], missed: [] } } });
  const list = newestFirst([
    game('CLASSIC', 'Ahri', 1800, { kills: 8, deaths: 2, assists: 6, cs: 240, ward: 18 }),
    game('CLASSIC', 'Ahri', 1800, { kills: 4, deaths: 6, assists: 4, cs: 210, ward: 12 }),
    game('ARAM', 'Ahri', 1200, { kills: 20, deaths: 10, assists: 30, cs: 60, ward: 0 }),
    game('CHERRY', 'Ahri', 900, { kills: 9, deaths: 4, assists: 2, cs: 0, ward: 0 }),
    game('URF', 'Ahri', 1500, { kills: 25, deaths: 12, assists: 15, cs: 150, ward: 4 }),
    game(null, 'Lux', 1800, { kills: 3, deaths: 3, assists: 12, cs: 180, ward: 30 }),
    game('PRACTICETOOL', 'Ahri', 600, { kills: 0, deaths: 0, assists: 0, cs: 200, ward: 0 }),
  ]);
  const b = breakdown.build('lol', list);
  ok(b.queue === "Summoner's Rift" && b.matches === 3 && b.total === 6 && b.left === 1,
    `it opens on the most played mode, the Rift's three games, and the practice tool is no game (${b.queue}, ${b.matches}, ${b.left})`);
  ok(b.allQueue === false && b.queues.map((q) => `${q.label}:${q.matches}`).join() === "Summoner's Rift:3,ARAM:1,Arena:1,URF:1",
    `each mode is its own, with no All that folds them together (${b.queues.map((q) => q.label).join()})`);
  const ahri = b.rows.champion.find((r) => r.label === 'Ahri');
  ok(ahri.matches === 2 && ahri.stats.csPerMin.value === 7.5 && ahri.stats.csPerMin.n === 2 && ahri.stats.kda.value === 2.75,
    `Ahri's numbers are her Rift games' (${ahri.matches} games, CS ${ahri.stats.csPerMin.value} a minute)`);
  ok(b.rows.champion.some((r) => r.label === 'Lux' && r.matches === 1), 'a game with no mode recorded is counted');
  const asked = breakdown.build('lol', list, { queue: 'ARAM' });
  const aram = asked.rows.champion.find((r) => r.label === 'Ahri');
  ok(asked.queue === 'ARAM' && asked.matches === 1 && aram.stats.csPerMin.value === 3,
    `ARAM is broken down on its own, with its own numbers (${aram.stats.csPerMin.value} CS a minute)`);
  ok(breakdown.build('lol', list, { queue: 'All' }).queue === "Summoner's Rift", 'and asking for All opens the most played mode');
  const onlyAram = breakdown.build('lol', newestFirst([game('ARAM', 'Ahri', 1200, { kills: 20, deaths: 10, assists: 30, cs: 60, ward: 0 })]));
  ok(onlyAram.queue === 'ARAM' && onlyAram.matches === 1, 'a player who only plays ARAM still gets a breakdown');
}

ok(breakdown.build('valorant', []).matches === 0 && breakdown.build('nonsense', []).dims.length === 0, 'nothing in, nothing out');

console.log(`\n${fails ? fails + ' of ' + checks + ' failed' : 'all ' + checks + ' breakdown checks passed'}`);
process.exit(fails ? 1 : 0);
