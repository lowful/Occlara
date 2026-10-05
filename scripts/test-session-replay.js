'use strict';

/**
 * Two real sessions replayed through the real engine, read by read, on the
 * clock they were recorded on.
 *
 * THE COMPETITIVE ONE IS THE BUG. A Split competitive match, read every one to
 * five seconds. At round 5 the model read the side flipped twice in two
 * seconds, the engine locked swiftplay from it, the wrong lock went back to the
 * model as context, and at 3 to 5 the match-end watch ended the match on two
 * reads two seconds apart: a review opened over round 9, everything after it
 * was ignored as the end screen, and stopping at 12 to 7 reviewed nothing.
 *
 * The swiftplay one is the same mode done right, so the fix is held to both.
 *
 * Run: npm run test:sessionreplay
 */

const path = require('path');
const Module = require('module');

let fails = 0;
let checks = 0;
const ok = (cond, what) => {
  checks++;
  if (!cond) { fails++; console.log(`FAIL  ${what}`); } else console.log(`ok    ${what}`);
};

// The network is replaced; the review call answers at once.
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
const CoachingEngine = require(path.join(__dirname, '..', 'src', 'main', 'services', 'coaching-engine.js'));
Module._load = realLoad;

const realNow = Date.now;
const realLog = console.log;

/** Replay a fixture's reads through applyRead, on its own clock. */
function replay(file, { menusAfter = 0 } = {}) {
  const frames = require(path.join(__dirname, 'fixtures', file)).frames;
  const t0 = Date.parse('2026-10-04T20:00:00Z');
  let clock = t0;
  Date.now = () => clock;
  const lines = [];
  console.log = (...a) => { lines.push(a.join(' ')); };
  const e = new CoachingEngine({ licenseKey: 'TEST', captureFunction: async () => null, experiments: () => ({}) });
  e.isRunning = true;
  const reviews = [];
  const resumed = [];
  e.on('match-review', (text, snap) => reviews.push({ snap, at: clock }));
  e.on('match-resumed', (r) => resumed.push(r));
  const modes = [];
  let registered = 0;
  try {
    for (const f of frames) {
      clock = t0 + f.t * 1000;
      const { t, ...context } = f;
      const before = e.matchContext.gameMode;
      const deathBefore = e.lastDeathAt;
      e.applyRead({ data: { context: { ...context } }, shot: null, at: clock });
      if (e.lastDeathAt !== deathBefore) registered++;
      if (e.matchContext.gameMode !== before) {
        modes.push({ t, mode: e.matchContext.gameMode, score: `${e.matchContext.teamScore}-${e.matchContext.enemyScore}` });
      }
    }
    const last = frames.length ? t0 + frames[frames.length - 1].t * 1000 : t0;
    for (let i = 1; i <= menusAfter; i++) {
      clock = last + i * 3000;
      e.applyRead({ data: { lobby: true }, shot: null, at: clock });
    }
  } finally {
    console.log = realLog;
  }
  return { e, reviews, resumed, modes, lines, registered, restore: () => { Date.now = realNow; } };
}

/**
 * The ledger's deaths against Riot's, over the rounds the ledger has, and the
 * timed ones against Riot's second. `truth` is { round: secondsIn }.
 */
function againstRiot(rounds, truth) {
  let agree = 0, invented = 0, missed = 0, timed = 0, close = 0;
  for (const r of rounds) {
    const t = Object.prototype.hasOwnProperty.call(truth, r.n) ? truth[r.n] : undefined;
    if (r.died && t !== undefined) agree++;
    else if (r.died) invented++;
    else if (t !== undefined) missed++;
    if (r.died && t !== undefined && r.deathClock !== null && r.deathClock !== undefined) {
      timed++;
      if (Math.abs((100 - r.deathClock) - t) <= 10) close++;
    }
  }
  return { agree, invented, missed, timed, close };
}

(async () => {
  // ── The competitive match that ended at 3 to 5 ─────────────────────────────
  {
    const run = replay('valorant-session-split-competitive.json');
    const { e, reviews, modes, lines } = run;
    ok(!modes.some((m) => m.mode === 'swiftplay'), `swiftplay is never locked (${JSON.stringify(modes)})`);
    const std = modes.find((m) => m.mode === 'standard');
    ok(std && std.score === '2-2', `standard is locked in round 5, at 2 to 2 (${std && std.score})`);
    ok(lines.some((l) => /round 5 was bought with \d+ credits/.test(l)),
      'from the money round 5 was bought with, a printed number, not the side');
    ok(reviews.length === 0, `no review opens while the match is played (${reviews.length})`);
    ok(!e.endWatch.ended, 'the watch never ends it');
    ok(!lines.some((l) => /match over/.test(l)), 'and nothing logs a match over');
    const rounds = e.ledger.list();
    ok(rounds.length === 20 && rounds[0].n === 1 && rounds[rounds.length - 1].n === 20,
      `all 20 rounds are recorded in one ledger (${rounds.length}: ${rounds.map((r) => r.n).join(',')})`);
    const r5 = rounds.find((r) => r.n === 5);
    ok(r5 && r5.frames > 20, `round 5 keeps its frames instead of losing them to a false round 6 (${r5 && r5.frames})`);
    ok(run.registered <= 18,
      `the last round's combat report in a buy phase is not a death (${run.registered} registered, it was 29)`);
    const early = rounds.filter((r) => r.n >= 5 && r.n <= 12);
    const attack = early.filter((r) => r.side === 'attacking').length;
    ok(attack >= 6, `rounds 5 to 12 read as the first half side, not flipped (${attack} of ${early.length} attacking)`);
    console.log = () => {};
    e.stop();
    console.log = realLog;
    await new Promise((r) => setTimeout(r, 30));
    ok(reviews.length === 1 && reviews[0].snap.endedBy === 'stop', 'stopping at 12 to 7 reviews the match');
    ok(reviews[0] && reviews[0].snap.rounds.length === 20, `with its 20 rounds (${reviews[0] && reviews[0].snap.rounds.length})`);
    ok(reviews[0] && reviews[0].snap.context.gameMode === 'standard', 'as a standard match');
    run.restore();
  }

  // ── The swiftplay match, ended on its score ───────────────────────────────
  {
    const run = replay('valorant-session-abyss-swiftplay.json');
    const { e, reviews, modes, lines } = run;
    const sp = modes.find((m) => m.mode === 'swiftplay');
    ok(sp && sp.score === '1-3', `swiftplay is locked in round 5 (${JSON.stringify(modes)})`);
    ok(lines.some((l) => /pistol round's buy timer/.test(l)), "from round 5's 45 second pistol buy timer");
    ok(!modes.some((m) => m.mode === 'standard'), 'and never corrected to standard');
    ok(reviews.length === 0 && !e.endWatch.ended, 'the final score alone does not end it');
    run.restore();

    // The log ends with the player dead in round 8 and the final score never
    // read: the end screen reads as a menu. So it ends on the menu path, most
    // of a minute of menus, which is what the real session did.
    const done = replay('valorant-session-abyss-swiftplay.json', { menusAfter: 20 });
    await new Promise((r) => setTimeout(r, 30));
    ok(done.reviews.length === 1, `the menus after it end it, once (${done.reviews.length})`);
    const snap = done.reviews[0] && done.reviews[0].snap;
    ok(snap && snap.endedBy === 'lobby', `on the menu path (${snap && snap.endedBy})`);
    ok(snap && snap.rounds.length === 8 && snap.rounds[7].n === 8, `with its 8 rounds (${snap && snap.rounds.length})`);
    ok(snap && snap.context.gameMode === 'swiftplay', 'as a swiftplay match');
    done.restore();

    // Riot's record of this match, from its verified review: died in rounds
    // 1, 2, 4, 6 and 8, at these seconds into the round.
    const vs = againstRiot(run.e.ledger.list(), { 1: 51, 2: 13, 4: 18, 6: 34, 8: 10 });
    ok(vs.agree >= 4 && vs.invented <= 1 && vs.missed <= 1,
      `the screen's deaths line up with Riot's, round by round (${JSON.stringify(vs)})`);
    ok(vs.timed >= 3 && vs.close === vs.timed, 'and every timed one is within ten seconds of Riot');
  }

  // ── The 24 round Abyss match, against Riot's record of it ─────────────────
  {
    const riot = require('./fixtures/riot-abyss-13-11.json');
    const truth = {};
    for (const r of riot.perRound) if (r.died) truth[r.n] = r.deathMs / 1000;
    const run = replay('valorant-session-abyss-unrated.json');
    const vs = againstRiot(run.e.ledger.list(), truth);
    // At a read every ten seconds the screen has round 17 from a spectator
    // frame and loses round 8 to a misread score; everything else agrees.
    ok(vs.agree >= 20 && vs.invented <= 1 && vs.missed <= 1, `deaths round by round against Riot (${JSON.stringify(vs)})`);
    ok(vs.timed >= 12 && vs.close >= 7, `with the death second for more of them (${vs.timed} timed, ${vs.close} within ten seconds)`);
    run.restore();
  }

  console.log(`\n${fails ? fails + ' of ' + checks + ' failed' : 'all ' + checks + ' session replay checks passed'}`);
  process.exit(fails ? 1 : 0);
})();
