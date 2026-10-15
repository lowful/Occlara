'use strict';

/**
 * The read scorer (read-score.js), offline:
 *
 *   - Riot's records of the Sunset and the Fracture are the matches they say,
 *     in the form of the Abyss's and the Split's, and no Riot record here names
 *     a player, a puuid or a tag (the repo is public)
 *   - the barrier drops, from the public session fixtures' reads alone, put
 *     Riot's deaths where the app's own recording put them: the Sunset's clips
 *     (its fixture's note) and the Fracture's looks, within a second
 *   - by time, through the real engine: a death caught from 5 s before Riot's
 *     moment and not 6, one the next read withdrew never caught, a buy frame
 *     read dead counted as one, a false plant, LOBBY, errors, labels, latency
 *   - the AI log's reads of the three current sessions catch every death Riot
 *     has, as the judge's production rows of 14 Oct did
 *   - the app's reader on the capture clock: a reply is never edited, a failed
 *     read never applied, the clock and the console always given back
 *   - the judge's terms, each met and each not, and the judge's bench before
 *     them: three whole runs of each prompt on the four sessions, every run done
 *
 * Run: npm run test:readscore
 */

const fs = require('fs');
const path = require('path');
const S = require('./read-score');
const data = require('../src/shared/valorant-data.generated.json');

let fails = 0;
const ok = (cond, what, detail) => {
  if (!cond) { fails++; console.log(`FAIL  ${what}${detail ? `\n        ${detail}` : ''}`); }
  else console.log(`ok    ${what}`);
};
const FIX = path.join(__dirname, 'fixtures');
const T0 = 1800000000000;

// ── Riot's records ──────────────────────────────────────────────────────────
{
  const sunset = S.riotRecord('sunset');
  const fracture = S.riotRecord('fracture');
  const deaths = (r) => r.perRound.filter((x) => x.died).map((x) => `${x.n}@${x.deathMs / 1000}${x.afterPlant ? 'p' : ''}`).join(' ');
  ok(fracture.map === 'Fracture' && fracture.queue === 'swiftplay' && fracture.score === '5-1' && fracture.result === 'Victory' && fracture.rounds === 6
    && deaths(fracture) === '2@31 5@33p 6@3' && fracture.perRound.filter((x) => !x.won).map((x) => x.n).join() === '5'
    && fracture.perRound.filter((x) => x.planted).map((x) => x.n).join() === '5,6'
    && fracture.perRound.every((x) => x.side === (x.n <= 4 ? 'defending' : 'attacking')) && fracture.wholeSeconds === true,
  'the Fracture is FRACTURE_RIOT\'s match: won 5 to 1 on defence then attack, deaths in rounds 2, 5 (after the plant) and 6 at 31, 33 and 3 s', deaths(fracture));
  ok(sunset.map === 'Sunset' && sunset.queue === 'swiftplay' && sunset.score === '2-5' && sunset.result === 'Defeat' && sunset.rounds === 7
    && deaths(sunset) === '1@26 2@27p 3@20 6@20 7@12' && sunset.perRound.filter((x) => x.won).map((x) => x.n).join() === '4,5'
    && sunset.perRound.filter((x) => x.planted).map((x) => x.n).join() === '1,2,4,5,6,7'
    && sunset.perRound.every((x) => x.side === (x.n <= 4 ? 'attacking' : 'defending')) && sunset.wholeSeconds === true,
  'the Sunset is the swiftplay lost 2 to 5: deaths in rounds 1, 2 (after the plant), 3, 6 and 7 at 26, 27, 20, 20 and 12 s', deaths(sunset));
  const pistol = (n) => [...S.pistolRounds(S.riotRecord(n))].join();
  ok(pistol('sunset') === '1,5' && pistol('fracture') === '1,5' && pistol('split') === '1,13' && pistol('abyss') === '1,13',
    'the pistol rounds, whose buy phase is 45 s, are round 1 and the first after the sides change: 5 in a swiftplay, 13 otherwise',
    ['sunset', 'fracture', 'split', 'abyss'].map(pistol).join(' | '));

  // NO PLAYER NAME, PUUID OR TAG. The two written here hold nothing but rounds,
  // sides, results, death seconds, agents and plants: every key is one of
  // those, and every agent is one the game has. And no Riot record here holds
  // a Riot ID, a puuid, a uuid or a token, nor the name or tag of the Riot ID
  // this PC's app is set to (when it has one; never printed).
  const KEYS = new Set(['note', 'map', 'queue', 'rounds', 'score', 'result', 'wholeSeconds', 'me', 'agent', 'perRound',
    'n', 'won', 'side', 'died', 'deathMs', 'killerAgent', 'planted', 'plantMs', 'afterPlant']);
  const AGENTS = new Set(Object.keys(data.agents || {}).map((a) => a.toLowerCase()));
  const RIOT_ID = /[^\s#"]{2,16}\s?#\s?[A-Za-z0-9]{2,5}\b/;
  const UUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i;
  const TOKEN = /[A-Za-z0-9_-]{40,}/;
  ok(RIOT_ID.test('Somebody#EUW') && RIOT_ID.test('Lord Of War #1234') && RIOT_ID.test('{"id":"Ab#EU1"}') && !RIOT_ID.test('round 5 #')
    && !RIOT_ID.test('Riot record of the Sunset') && UUID.test('a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d')
    && TOKEN.test('x'.repeat(78)) && !TOKEN.test('session-2026-10-12T03-13-18-396Z') && !TOKEN.test('valorant-session-sunset-swiftplay.json'),
  'the leak patterns match a Riot ID, a uuid and a puuid sized token, and not a session or a file name');
  let own = null;
  try {
    const { profileDir, configPath } = require('./profile-path');
    const cfg = JSON.parse(fs.readFileSync(configPath(profileDir(process.env.APPDATA || '')), 'utf8'));
    const id = String(cfg.riotId || cfg.riotID || '').trim();
    if (/#/.test(id)) own = id.split('#').map((x) => x.trim().toLowerCase()).filter((x) => x.length >= 3);
  } catch (e) { own = null; }
  const leaks = (file, strict) => {
    const out = [];
    const walk = (v, where) => {
      if (Array.isArray(v)) { v.forEach((x, k) => walk(x, `${where}[${k}]`)); return; }
      if (v && typeof v === 'object') {
        for (const [k, x] of Object.entries(v)) {
          if (strict && !KEYS.has(k)) out.push(`${where}.${k}: a key that is none of rounds, sides, results, death seconds, agents and plants`);
          if (/name|puuid|tag|riot ?id|player|user|account|email/i.test(k)) out.push(`${where}.${k}: a key for a person`);
          walk(x, `${where}.${k}`);
        }
        return;
      }
      if (typeof v !== 'string') return;
      if (RIOT_ID.test(v)) out.push(`${where}: a Riot ID`);
      if (UUID.test(v)) out.push(`${where}: a uuid`);
      if (TOKEN.test(v)) out.push(`${where}: a token`);
      if (own && own.some((x) => v.toLowerCase().includes(x))) out.push(`${where}: this PC's Riot ID`);
      if (strict && /(agent|killerAgent)$/.test(where) && !AGENTS.has(v.toLowerCase())) out.push(`${where}: not an agent`);
    };
    walk(JSON.parse(fs.readFileSync(path.join(FIX, file), 'utf8')), file);
    return out;
  };
  const found = [...leaks('riot-sunset-2-5.json', true), ...leaks('riot-fracture-5-1.json', true),
    ...leaks('riot-abyss-13-11.json', false), ...leaks('riot-split-13-7.json', false)];
  ok(!found.length, `no Riot record here names a player, a puuid or a tag${own ? ', this PC\'s Riot ID included' : ''}, and the two written here hold `
    + 'nothing but rounds, sides, results, death seconds and agents', found.join('\n        '));
}

// ── where Riot's rounds and deaths were ─────────────────────────────────────
{
  const at = (fixture) => S.traceOfFixture(JSON.parse(fs.readFileSync(path.join(FIX, fixture), 'utf8')), T0);
  const sunset = S.truthOf(S.riotRecord('sunset'), [at('valorant-session-sunset-swiftplay.json')]);
  const fracture = S.truthOf(S.riotRecord('fracture'), [at('valorant-session-fracture-swiftplay.json')]);
  const moment = (T, n) => { const r = T.rounds.find((x) => x.n === n); return r && r.moment !== null ? (r.moment - T0) / 1000 : null; };
  // The Sunset's clips (its fixture's note) and the Fracture's recording looks
  // (the judge of 14 Oct, from its review's stills), seconds into the session.
  const CLIPS = { 2: 163.5, 3: 252.6, 6: 518.1, 7: 614.7 };
  const LOOKS = { 2: 142.2, 5: 414.9, 6: 474.7 };
  const off = (T, want) => Object.entries(want).map(([n, s]) => ({ n, s, got: moment(T, Number(n)) }));
  const sOff = off(sunset, CLIPS);
  const fOff = off(fracture, LOOKS);
  ok(sunset.rounds.every((r) => r.drop !== null) && sOff.every((x) => x.got !== null && Math.abs(x.got - x.s) <= 1),
    'the Sunset\'s barrier drops, from its AI log\'s reads alone, put Riot\'s deaths within a second of where its clips show them',
    sOff.map((x) => `r${x.n} ${x.got} against ${x.s}`).join(', '));
  ok(fracture.rounds.every((r) => r.drop !== null) && fOff.every((x) => x.got !== null && Math.abs(x.got - x.s) <= 1),
    'and the Fracture\'s within a second of its recording looks', fOff.map((x) => `r${x.n} ${x.got} against ${x.s}`).join(', '));

  // A synthetic round 1, its barriers at D: every frame with S left read at D + x, x in [99 - S, 100 - S).
  const D = T0 + 45000;
  const clocked = (x, extra) => ({ frame: `f${x}`, at: D + x * 1000, context: { phase: 'active', clock: `1:${String(99 - Math.floor(x) - 60).padStart(2, '0')}`, ...(extra || {}) } });
  const reads = [10.5, 15.5, 20.5, 25.5].map((x) => clocked(x));
  const one = S.dropsOf(S.spansOf([{ reads }]));
  const misread = S.dropsOf(S.spansOf([{ reads: reads.concat([{ frame: 'g', at: D + 18500, context: { phase: 'active', clock: '1:30' } }]) }]));
  const two = S.dropsOf(S.spansOf([{ reads: reads.concat([10.5, 15.5].map((x) => ({ ...clocked(x), frame: `h${x}`, at: D + 100000 + x * 1000 }))) }]));
  ok(one.length === 1 && Math.abs(one[0].at - D) <= 500 && one[0].frames === 4
    && misread.length === 1 && Math.abs(misread[0].at - D) <= 500
    && two.length === 2 && Math.abs(two[1].at - (D + 100000)) <= 500,
  'a drop is where the round clock\'s spans meet, a misread clock is outvoted, and spans 100 s apart are two rounds',
  JSON.stringify({ one, misread: misread.map((d) => d.at - D), two: two.map((d) => d.at - D) }));
  const votes = S.spansOf([{ reads }, { reads }, { reads: [clocked(10.5)] }]);
  ok(votes.length === 4 && votes.find((s) => s.frame === 'f10.5').votes === 3,
    'a frame read with the same clock by several runs is one span with their votes, not several spans', JSON.stringify(votes));
}

// ── one run, by time, through the real engine ───────────────────────────────
// Round 1 (a 45 s pistol buy from T0, barriers at D1) Riot has the player
// dying 30 s in; round 2 (barriers at D2) survived, unplanted.
const D1 = T0 + 45000;
const D2 = D1 + 100000;
const RIOT = { map: 'Fracture', queue: 'swiftplay', rounds: 2, score: '1-1', perRound: [
  { n: 1, won: false, side: 'defending', died: true, deathMs: 30000, planted: false, plantMs: null, afterPlant: false },
  { n: 2, won: true, side: 'defending', died: false, deathMs: null, planted: false, plantMs: null, afterPlant: false }] };
const sec = (x) => `${Math.floor(x / 60)}:${String(x % 60).padStart(2, '0')}`;
const live = (D, x, o) => ({ at: D + x * 1000, context: { phase: 'active', clock: sec(99 - Math.floor(x)), teamScore: 0, enemyScore: D === D1 ? 0 : 1,
  side: 'defending', playerAlive: true, playerHp: 100, playerWeapon: 'Vandal', aliveTell: 'own HP 100 and Vandal bottom left', ...(o || {}) } });
const dead = (D, x, tell, o) => ({ at: D + x * 1000, context: { phase: 'dead', clock: sec(99 - Math.floor(x)), teamScore: 0, enemyScore: 0, side: 'defending',
  playerAlive: false, aliveTell: tell, ...(o || {}) } });
/** A session of the two rounds, its round 1 frames from 10.5 s past the drop given as `round1`. */
function session(round1) {
  const reads = [
    { at: T0 + 5000, context: { phase: 'buy', clock: '0:40', teamScore: 0, enemyScore: 0, side: 'defending', playerAlive: true, playerHp: 100,
      playerWeapon: 'Classic', aliveTell: 'own HP 100 and Classic bottom left', locLabel: 'Defender Side Spawn' } },
    { at: T0 + 20000, context: { phase: 'buy', clock: '0:25', teamScore: 0, enemyScore: 0, side: 'defending', playerAlive: true, playerHp: 100, playerWeapon: 'Vandal' } },
    { at: T0 + 21000, err: '503 {"error":"read-unavailable"}' },
    live(D1, 10.5, { locLabel: 'A Rope' }), live(D1, 15.5), live(D1, 20.5),
    ...round1,
    dead(D1, 50.5, 'SWITCH PLAYER and spectating teammate'),
    // Round 2's buy phase: the COMBAT REPORT read dead once.
    { at: D1 + 75000, context: { phase: 'buy', clock: '0:25', teamScore: 0, enemyScore: 1, side: 'defending', playerAlive: true, playerHp: 100, playerWeapon: 'Vandal' } },
    { at: D1 + 77000, context: { phase: 'buy', clock: '0:23', teamScore: 0, enemyScore: 1, side: 'defending', playerAlive: false, aliveTell: 'KILLED BY Jett and COMBAT REPORT' } },
    { at: D1 + 79000, context: { phase: 'buy', clock: '0:21', teamScore: 0, enemyScore: 1, side: 'defending', playerAlive: true, playerHp: 100, playerWeapon: 'Vandal' } },
    live(D2, 10.5), live(D2, 15.5), live(D2, 20.5, { locLabel: 'B Nowhere' }),
    // A plant Riot never had, and the end screen.
    { at: D2 + 40000, context: { phase: 'postplant', spike: 'planted', teamScore: 0, enemyScore: 1, side: 'defending', playerAlive: true, playerHp: 80, playerWeapon: 'Vandal' } },
    { at: D2 + 70000, lobby: true, context: {} },
  ];
  return { reads: reads.map((r, k) => ({ i: k + 1, frame: `frame-${String(k).padStart(5, '0')}.jpg`, ms: 1000 + 100 * k, serverMs: 900, parsed: !r.lobby && !r.err, lobby: false, err: null, ...r })) };
}
{
  const killed = (x) => dead(D1, x, 'KILLED BY Jett and COMBAT REPORT');
  const runs = {
    onTime: session([live(D1, 25.5), killed(31.5), dead(D1, 36.5, 'SWITCH PLAYER and spectating teammate')]),
    early4: session([killed(25.5), dead(D1, 36.5, 'SWITCH PLAYER and spectating teammate')]),
    early6: session([killed(23.5), dead(D1, 36.5, 'SWITCH PLAYER and spectating teammate')]),
    withdrawn: session([live(D1, 25.5), dead(D1, 31.5, 'Spectating teammate'), live(D1, 32.5)]),
  };
  const res = S.scoreSession({ riot: RIOT, map: 'Fracture', runs: Object.entries(runs).map(([name, trace]) => ({ name, trace })) });
  const by = Object.fromEntries(res.runs.map((r) => [r.name, r]));
  const drop = res.T.rounds[0].drop;
  ok(Math.abs(drop - D1) <= 1000 && Math.abs(res.T.rounds[1].drop - D2) <= 1000,
    'the synthetic rounds\' drops are found where their clocks put them', `${drop - D1} ${res.T.rounds[1].drop - D2}`);
  const c = (r) => r.caught[1];
  ok(c(by.onTime) && c(by.onTime).late > 0 && c(by.onTime).late < 3 && !by.onTime.missed.length && !by.onTime.invented.length,
    'a death the engine registers on the death screen a second or two after Riot\'s moment is caught', JSON.stringify(by.onTime.claims));
  ok(c(by.early4) && c(by.early4).late < -3 && c(by.early4).late > -5 && !by.early4.invented.length,
    'one registered 4 s before Riot\'s moment is still that death (the app\'s own early rule)', JSON.stringify(by.early4.claims));
  ok(!c(by.early6) && by.early6.missed.join() === '1' && by.early6.invented.length === 1 && by.early6.invented[0].at === D1 + 23500,
    'one registered 6 s before it is a death invented, and the real one missed', JSON.stringify(by.early6.claims));
  ok(by.withdrawn.claims.length === 1 && by.withdrawn.claims[0].withdrawn && by.withdrawn.withdrawn === 1
    && by.withdrawn.missed.join() === '1' && !by.withdrawn.invented.length,
  'a death on a weak tell the next read withdrew (the player\'s own HUD as it stood) catches nothing', JSON.stringify(by.withdrawn.claims));
  const r = by.onTime;
  ok(r.fv.buy === 5 && r.fv.rawDeadAliveBuy === 1 && Math.abs(r.buyDeadRate - 0.2) < 1e-9,
    'a buy frame read dead is counted as one of the buy frames judged, the round before\'s COMBAT REPORT over a living player',
    JSON.stringify(r.fv));
  ok(r.plants.invented.join() === '2' && !r.plants.missed.length, 'a plant Riot never had is a false plant, filed under its round', JSON.stringify(r.plants));
  // Seventeen latencies of 1000 + 100 k ms (the failed read's left out, the LOBBY's in).
  ok(r.n === 18 && r.errs === 1 && r.lobby === 1 && r.parsePct === 100 && r.labels === 3 && r.labelsOk === 2 && r.bad['B Nowhere'] === 1
    && r.p50 === 1900 && r.p90 === 2600,
  'and the reads, the failed one and the LOBBY are counted, the labels held to the map, and p50 and p90 are bench-read\'s own',
  JSON.stringify({ n: r.n, errs: r.errs, lobby: r.lobby, parse: r.parsePct, labels: [r.labels, r.labelsOk, r.bad], p50: r.p50, p90: r.p90 }));
  const lines = S.sessionLines(res, T0);
  const row = (n) => lines.find((l) => l.startsWith(`r${n} `)) || '';
  ok(/ 00007 \+1\.\ds /.test(row(1)) && / 00006 -4\.\ds /.test(row(1)) && /MISSED; invented 00006/.test(row(1)) && /MISSED\s*$/.test(row(1))
    && (row(2).match(/false plant/g) || []).length === 4,
  'its by round lines say which run caught, missed and invented which death, and which planted a round Riot did not', lines.join('\n        '));
}

// ── the AI log's reads of the three current sessions ────────────────────────
{
  const rows = [];
  for (const name of ['split', 'sunset', 'fracture']) {
    const s = S.sessionOf(name);
    const trace = S.traceOfFixture(JSON.parse(fs.readFileSync(path.join(FIX, s.fixture), 'utf8')), T0);
    const r = S.scoreSession({ riot: S.riotRecord(s), map: s.map, runs: [{ name, trace }] }).runs[0];
    rows.push({ name, caught: Object.keys(r.caught).length, of: r.riotDeaths, missed: r.missed });
  }
  ok(rows.every((x) => x.caught === x.of && !x.missed.length),
    'the AI log\'s own reads of the Split, the Sunset and the Fracture catch every death Riot has, through today\'s engine (the judge\'s production rows)',
    JSON.stringify(rows));
}

// ── the app's reader ────────────────────────────────────────────────────────
{
  const app = new S.AppReader(T0);
  const realNow = Date.now;
  const realLog = console.log;
  const read = { frame: 'a', at: T0 + 1000, lobby: false, context: { phase: 'buy', clock: '0:40', teamScore: 0, enemyScore: 0, playerAlive: false,
    aliveTell: 'KILLED BY Jett and COMBAT REPORT' } };
  const before = JSON.stringify(read);
  const f = app.apply(read);
  const failed = app.apply({ frame: 'b', at: T0 + 2000, err: '503' });
  const frames = app.e.analyzedFrames;
  ok(JSON.stringify(read) === before && f.alive === true && failed.err === '503' && frames === 1,
    'the app\'s reader applies a copy of each reply, never the reply itself, and a failed read is never applied (drain() skips it)',
    JSON.stringify({ after: read, f: { alive: f.alive, phase: f.phase }, frames }));
  const seen = app.at(T0 + 4321, () => Date.now());
  let threw = false;
  try { app.at(T0, () => { throw new Error('inside'); }); } catch (e) { threw = true; }
  ok(seen === T0 + 4321 && threw && Date.now === realNow && console.log === realLog && Math.abs(Date.now() - realNow()) < 1000,
    'every call runs on the frame\'s capture clock, and the real clock and console are given back, a throw included');
  ok(JSON.stringify(Object.keys(app.context(T0 + 5000))) === '["agent","map","side","phase","gameMode","teamScore","enemyScore","roundNumber","playerAlive"]'
    && app.context(T0 + 5000).playerAlive === true,
  'and its context is readContext()\'s: the dead read in the buy phase is not sent on as a death', JSON.stringify(app.context(T0 + 5000)));
}

// ── the judge's terms ───────────────────────────────────────────────────────
{
  const run = (o) => ({ caught: Object.fromEntries((o.caught || []).map((n) => [n, { n }])), missed: o.missed || [], invented: Array(o.invented || 0).fill({}),
    plants: { invented: Array(o.plants || 0).fill(2) }, lobby: o.lobby || 0, buyDeadRate: o.buy === undefined ? 0.1 : o.buy });
  const session = (name, base, cand) => ({ name, runs: { live: base, c: cand } });
  const good = () => [
    session('sunset', [run({ caught: [1, 2], invented: 1, plants: 1, lobby: 2, buy: 0.1 }), run({ caught: [1, 2], invented: 1, lobby: 2, buy: 0.1 }),
      run({ caught: [1], missed: [2], invented: 1, lobby: 2, buy: 0.1 })],
    [run({ caught: [1, 2], invented: 1, lobby: 1, buy: 0.05 }), run({ caught: [1, 2], lobby: 1, buy: 0.05 }), run({ caught: [1, 2], lobby: 1, buy: 0.05 })]),
    session('fracture', [run({ caught: [2], buy: 0 }), run({ caught: [2], buy: 0 })], [run({ caught: [2], buy: 0 }), run({ caught: [2], buy: 0 })]),
  ];
  const opts = (o) => ({ base: 'live', candidate: 'c', gates: { plain: 'PASSED', lag4: 'PASSED' }, cost: { live: { usd: 1, reads: 3000 }, c: { usd: 1.05, reads: 3000 } }, ...(o || {}) });
  const terms = (v) => v.terms.map((t) => `${t.ok ? '+' : '-'} ${t.term}`).join(' | ');
  const all = S.acceptance(good(), opts());
  ok(all.ok && all.terms.length === 7, 'a candidate better or level on every count, its gates passed and its cost within a tenth, meets every term', terms(all));
  const fail = (what, sessions, o, term) => {
    const v = S.acceptance(sessions, opts(o));
    const bad = v.terms.filter((t) => !t.ok).map((t) => t.term);
    ok(!v.ok && bad.length === 1 && bad[0].startsWith(term), `and fails ${what}`, terms(v));
  };
  // Live caught the Sunset's round 2 in two runs of three.
  const lost = good();
  lost[0].runs.c = lost[0].runs.c.map((r, k) => (k ? { ...r, caught: { 1: { n: 1 } }, missed: [2] } : r));
  fail('when a death the live prompt caught in most runs is caught in fewer than half of its own', lost, {}, 'no real death live caught is missed');
  const less = good();
  less[0].runs.live[2] = run({ caught: [1, 2], invented: 1, lobby: 2, buy: 0.1 });
  less[0].runs.c[0] = { ...less[0].runs.c[0], caught: { 1: { n: 1 } }, missed: [2] };
  const v = S.acceptance(less, opts());
  ok(v.ok && v.terms[0].detail === 'none missed; caught less often: sunset r2 (live 3/3, c 2/3)',
    'but not when it is still caught in most runs, which it says', terms(v) + ' / ' + v.terms[0].detail);
  const inv = good();
  inv[0].runs.c[1] = { ...inv[0].runs.c[1], invented: Array(3).fill({}) };
  fail('on more invented deaths than the live prompt\'s mean', inv, {}, 'invented deaths');
  const pl = good();
  pl[0].runs.c[0] = { ...pl[0].runs.c[0], plants: { invented: [3, 4] } };
  fail('on more invented plants', pl, {}, 'invented plants');
  const lob = good();
  lob[0].runs.c[0] = { ...lob[0].runs.c[0], lobby: 9 };
  fail('on more LOBBY replies', lob, {}, 'LOBBY replies');
  const buy = good();
  buy[1].runs.c[0] = { ...buy[1].runs.c[0], buyDeadRate: 0.01 };
  fail('when one session reads more buy frames dead (none where live read none)', buy, {}, 'buy frames read dead');
  fail('when verify:ai failed at --lag 4', good(), { gates: { plain: 'PASSED', lag4: 'FAILED' } }, 'verify:ai');
  fail('or was not run', good(), { gates: {} }, 'verify:ai');
  fail('when a read costs more than a tenth over the live prompt\'s', good(), { cost: { live: { usd: 1, reads: 3000 }, c: { usd: 1.11, reads: 3000 } } }, 'cost a read');
  fail('or its cost was not measured', good(), { cost: { live: { usd: 1, reads: 3000 } } }, 'cost a read');

  // THE JUDGE'S BENCH (opts.bench, which bench:sessions gives): three whole
  // runs of each prompt on each of the four sessions, every run done, or the
  // seven terms replace nothing.
  const four = () => ['abyss', 'split', 'sunset', 'fracture'].map((name) => session(name,
    [0, 1, 2].map(() => run({ caught: [1], lobby: 1 })), [0, 1, 2].map(() => run({ caught: [1], lobby: 1, buy: 0.05 }))));
  const whole = S.acceptance(four(), opts({ bench: {} }));
  ok(whole.ok && whole.terms.length === 8 && whole.terms[0].ok
    && whole.terms[0].term === 'the judge\'s bench: 3 whole runs of each prompt on abyss, split, sunset, fracture, every run done',
  'the judge\'s bench comes first when the bench gives it: three whole runs of each prompt on each of the four sessions, every run done, is met',
  terms(whole) + ' / ' + whole.terms[0].detail);
  fail('when the bench stopped before its last run', four(), { bench: { stopped: 'run 9: 1 read refused (429 slow down)' } }, 'the judge\'s bench');
  fail('or a session has two runs of the candidate', four().map((s) => (s.name === 'fracture' ? { ...s, runs: { ...s.runs, c: s.runs.c.slice(1) } } : s)),
    { bench: {} }, 'the judge\'s bench');
  fail('or a session was not run', four().filter((s) => s.name !== 'split'), { bench: {} }, 'the judge\'s bench');
  const none = S.acceptance([], opts({ bench: { stopped: 'run 3: 1 read refused' } }));
  ok(!none.ok && none.terms.map((t) => `${t.ok ? '+' : '-'} ${t.term.split(':')[0]}`).join(' | ') === '- the judge\'s bench | - runs of both prompts'
    && /stopped \(run 3: 1 read refused\); short: abyss live 0, c 0/.test(none.terms[0].detail),
  'and a bench with no session of both prompts says so beside it, why it stopped and what it lacks', JSON.stringify(none.terms));
}

console.log(fails ? `\nFAIL: ${fails} problem(s)` : '\nPASS: the read scorer finds Riot\'s rounds and deaths by time, scores a run through the real engine, holds no player in its records, and checks the judge\'s terms');
process.exit(fails ? 1 : 0);
