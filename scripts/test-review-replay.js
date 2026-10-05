'use strict';

/**
 * The review's round facts through the REAL engine, which feeds the ledger its
 * merged context rather than one frame's read. Three bugs a player could see
 * in a review, each of which only shows up that way:
 *
 *   a plant planted the next round as well. The engine keeps "planted" in its
 *   context until a buy phase clears it, because a field the model leaves out
 *   is never merged, so the round end banner, which already prints the next
 *   score, carried the plant into the round after it
 *   a match ended on the menu or by Stop reviewed an empty round after the
 *   final score, because only a score end knew where the match stopped
 *   the real Abyss session's round 17 banner was round 18's only plant
 *
 * The network is replaced and the clock is driven, the way
 * test-match-lifecycle.js and test-session-replay.js drive the engine.
 *
 * Run: npm run test:reviewreplay
 */

const path = require('path');
const Module = require('module');

let fails = 0;
let checks = 0;
const ok = (cond, what) => {
  checks++;
  if (!cond) { fails++; console.log(`FAIL  ${what}`); } else console.log(`ok    ${what}`);
};

const realLoad = Module._load;
Module._load = function patched(request, parent, isMain) {
  if (request === './api-client') {
    return {
      post: async () => ({ ok: true, status: 200, data: { review: 'A summary.', summary: 'A summary.', rounds: {}, focus: null, study: [] } }),
      get: async () => ({ ok: false }),
    };
  }
  return realLoad(request, parent, isMain);
};
const CoachingEngine = (() => {
  const m = require(path.join(__dirname, '..', 'src', 'main', 'services', 'coaching-engine.js'));
  return m.CoachingEngine || m;
})();
Module._load = realLoad;

const verify = require('../src/shared/valorant-verify');
const review = require('../src/shared/valorant-review');

const realNow = Date.now;
const realLog = console.log;
const quiet = (fn) => { console.log = () => {}; try { return fn(); } finally { console.log = realLog; } };

function engine() {
  const e = new CoachingEngine({ licenseKey: 'TEST', captureFunction: async () => null, experiments: () => ({}) });
  e.isRunning = true;   // as if started, without the timers start() arms
  return e;
}

/**
 * One frame as the engine's context holds it after the guards, into the
 * ledger the way applyRead records it. `spike` stays whatever the context had,
 * which is the point: nothing here clears it but a buy phase.
 */
function frame(e, at, f) {
  Date.now = () => at;
  Object.assign(e.matchContext, {
    teamScore: f.team, enemyScore: f.enemy, phase: f.phase || 'active', clock: f.clock || null,
    side: f.side || 'attacking', gameMode: f.mode || 'standard', playerAlive: f.phase !== 'dead',
  });
  if ('spike' in f) e.matchContext.spike = f.spike;
  if ('spikeSpot' in f) e.matchContext.spikeSpot = f.spikeSpot;
  e.inLobby = false;
  quiet(() => e.recordFrame({ lobby: false, died: !!f.died }));
}

function menu(e, at) {
  Date.now = () => at;
  e.inLobby = true;
  quiet(() => e.recordFrame({ lobby: true, died: false }));
}

const clock = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

/** A whole round at a read every two seconds: its buy phase, then play down to `until` seconds left. */
function round(e, t, score, { until = 40, plant = null, side = 'attacking' } = {}) {
  for (let s = 30; s >= 2; s -= 2) { frame(e, t, { ...score, side, phase: 'buy', clock: clock(s) }); t += 2000; }
  // The buy phase clears the spike, as the engine's own phase change does.
  e.matchContext.spike = null;
  e.matchContext.spikeSpot = null;
  for (let s = 100; s >= until; s -= 2) { frame(e, t, { ...score, side, phase: 'active', clock: clock(s) }); t += 2000; }
  if (plant) {
    for (let i = 0; i < 10; i++) { frame(e, t, { ...score, side, phase: 'postplant', spike: 'planted', spikeSpot: plant }); t += 2000; }
  }
  return t;
}

(async () => {
  // ── A plant does not cross the round end banner ───────────────────────────
  {
    const e = engine();
    const reviews = [];
    e.on('match-review', (text, snap) => reviews.push(snap));
    let t = Date.parse('2026-10-04T20:00:00Z');
    t = round(e, t, { team: 2, enemy: 2 });
    t = round(e, t, { team: 3, enemy: 2 }, { plant: 'B Site' });
    // The banner prints 4 to 2 while the context still says planted.
    for (let i = 0; i < 4; i++) { frame(e, t, { team: 4, enemy: 2, phase: 'active', clock: '0:01' }); t += 2000; }
    t = round(e, t, { team: 4, enemy: 2 });
    frame(e, t, { team: 4, enemy: 2, phase: 'dead', clock: '0:38', died: true }); t += 2000;
    for (let s = 36; s >= 16; s -= 4) { frame(e, t, { team: 4, enemy: 2, phase: 'dead', clock: clock(s) }); t += 2000; }
    frame(e, t, { team: 4, enemy: 3, phase: 'active', clock: '0:01' }); t += 2000;
    t = round(e, t, { team: 4, enemy: 3 });
    const rows = e.ledger.list();
    const r6 = rows.find((r) => r.n === 6);
    const r7 = rows.find((r) => r.n === 7);
    ok(r6 && r6.planted && r6.plantSpot === 'B Site', 'round 6 is planted at B Site');
    ok(r7 && !r7.planted && r7.died, `round 7, played after its banner, is not (${r7 && r7.planted})`);
    const card = review.build({ rounds: rows, context: e.matchContext, endedBy: 'stop' }).rounds.find((c) => c.n === 7);
    ok(card && !card.planted && !card.facts.some((x) => /Spike planted/.test(x)),
      `and its round card says nothing about a spike (${card && card.facts})`);
    Date.now = realNow;
  }

  // ── A match ended on the menu has no round after its last ─────────────────
  // 13 to 12 is deliberately not a final score: unrated ends there and
  // competitive does not, so it ends on most of a minute of menus.
  {
    const e = engine();
    const reviews = [];
    e.on('match-review', (text, snap) => reviews.push(snap));
    let t = Date.parse('2026-10-04T21:00:00Z');
    t = round(e, t, { team: 11, enemy: 11 }, { side: 'defending' });
    frame(e, t, { team: 12, enemy: 11, side: 'defending', phase: 'active', clock: '0:02' }); t += 2000;
    t = round(e, t, { team: 12, enemy: 11 }, { side: 'defending' });
    frame(e, t, { team: 12, enemy: 12, side: 'defending', phase: 'active', clock: '0:02' }); t += 2000;
    t = round(e, t, { team: 12, enemy: 12 }, { side: 'defending' });
    for (let i = 0; i < 3; i++) { frame(e, t, { team: 13, enemy: 12, side: 'defending', phase: 'active', clock: '0:01' }); t += 2000; }
    for (let i = 0; i < 30 && !reviews.length; i++) { menu(e, t); t += 2000; }
    await new Promise((r) => setTimeout(r, 20));
    const snap = reviews[0];
    ok(snap && snap.endedBy === 'lobby', `the 13 to 12 ends on the menu path (${snap && snap.endedBy})`);
    ok(snap && snap.rounds.map((r) => r.n).join() === '23,24,25',
      `with rounds 23 to 25 and no empty 26th (${snap && snap.rounds.map((r) => r.n)})`);
    const built = snap && review.build({ rounds: snap.rounds, context: snap.context, endedBy: snap.endedBy });
    ok(built && built.watched.rounds === 3 && built.rounds.length === 3, 'so the header and the strip say three rounds');
    Date.now = realNow;
  }

  // ── Stop on the end screen of the same match ──────────────────────────────
  {
    const e = engine();
    const reviews = [];
    e.on('match-review', (text, snap) => reviews.push(snap));
    let t = Date.parse('2026-10-04T22:00:00Z');
    t = round(e, t, { team: 12, enemy: 12 }, { side: 'defending' });
    for (let i = 0; i < 3; i++) { frame(e, t, { team: 13, enemy: 12, side: 'defending', phase: 'active', clock: '0:01' }); t += 2000; }
    Date.now = () => t;
    quiet(() => e.stop());
    await new Promise((r) => setTimeout(r, 20));
    const snap = reviews[0];
    ok(snap && snap.endedBy === 'stop' && snap.rounds.map((r) => r.n).join() === '25',
      `Stop keeps the last round played and drops the one the banner opened (${snap && snap.rounds.map((r) => r.n)})`);
    Date.now = realNow;
  }

  // ── The real Abyss session, against Riot's record of it ───────────────────
  {
    const riot = require('./fixtures/riot-abyss-13-11.json');
    const truth = new Map(riot.perRound.map((r) => [r.n, r]));
    const frames = require('./fixtures/valorant-session-abyss-unrated.json').frames;
    const e = engine();
    const t0 = Date.parse('2026-10-04T23:00:00Z');
    for (const f of frames) {
      const at = t0 + f.t * 1000;
      Date.now = () => at;
      const { t, ...context } = f;
      quiet(() => e.applyRead({ data: { context: { ...context } }, shot: null, at }));
    }
    Date.now = realNow;
    const rows = e.ledger.list();
    const byN = new Map(rows.map((r) => [r.n, r]));
    const wrong = rows.filter((r) => r.planted && truth.has(r.n) && !truth.get(r.n).planted).map((r) => r.n);
    ok(!wrong.length, `the screen plants no round Riot says was not planted (${wrong})`);
    ok(byN.get(17).planted && !byN.get(18).planted,
      'the round 17 banner, already reading 10 to 7, plants round 17 and not round 18');
    const { rounds } = verify.reconcile(rows, riot);
    ok(rounds.every((r) => r.planted === !!truth.get(r.n).planted), "with Riot's record every round's plant is Riot's");
    ok(rounds.find((r) => r.n === 18).planted, "and round 18's own plant, which the coach never saw, comes from Riot");
  }

  console.log(`\n${fails ? fails + ' of ' + checks + ' failed' : 'all ' + checks + ' review replay checks passed'}`);
  process.exit(fails ? 1 : 0);
})();
