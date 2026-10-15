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

/**
 * A read's latency as a live session has it, lognormal (sigma 0.5) about the
 * median that gives `p90`, drawn from a seeded generator so a run is the same
 * run every time.
 */
function latencies(seed, p90) {
  let s = seed >>> 0;
  const next = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  const median = p90 / Math.exp(1.2816 * 0.5);
  return () => {
    const u1 = Math.max(1e-9, next());
    const u2 = next();
    return median * Math.exp(0.5 * Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2)) * 1000;
  };
}

/**
 * Replay a fixture's reads through applyRead, on its own clock. With
 * `latency` ({ seed, p90 }) each reply is applied once it is in and every one
 * before it is, as drain() applies them: the clock then reads the second it was
 * APPLIED, and `at` the second its frame was captured, as a live session has it.
 */
function replay(file, { menusAfter = 0, latency = null, cadence = true, edit = null, then = [] } = {}) {
  // `edit` reads the session otherwise: the frames copied, never the cached fixture changed.
  // `then` is read after it, a read each: { t, lobby: true } or { t, ...the read's context }.
  const real = require(path.join(__dirname, 'fixtures', file)).frames;
  const frames = (edit ? real.map((f) => edit({ ...f })) : real).concat(then);
  const t0 = Date.parse('2026-10-04T20:00:00Z');
  let clock = t0;
  Date.now = () => clock;
  const lines = [];
  console.log = (...a) => { lines.push(a.join(' ')); };
  // What the AI log is handed for each frame: when it was captured, and whether
  // the engine says a death registered on it.
  const logged = [];
  const e = new CoachingEngine({ licenseKey: 'TEST', captureFunction: async () => null, experiments: () => ({}),
    diagnostics: (rec) => logged.push({ t: Math.round((rec.at - t0) / 100) / 10, died: !!rec.died }) });
  e.isRunning = true;
  // The read cadence switched off: it is told nothing and asks for nothing.
  if (!cadence) e.readCadence = { reset() {}, applied() {}, gap: (s, now, base) => ({ ms: base, why: 'off' }) };
  const reviews = [];
  const resumed = [];
  e.on('match-review', (text, snap) => reviews.push({ snap, at: clock }));
  e.on('match-resumed', (r) => resumed.push(r));
  const modes = [];
  // The round the ledger filed each frame under, by the frame's own second.
  const filed = [];
  // The second of each frame a death registered on, and the map held after each.
  const deaths = [];
  const maps = [];
  // The rounds planted after each frame, and the read cadence's ask a second on.
  const plants = [];
  const gaps = [];
  let registered = 0;
  const lag = latency ? latencies(latency.seed, latency.p90) : null;
  let applied = 0;
  try {
    for (const f of frames) {
      const captured = t0 + f.t * 1000;
      applied = lag ? Math.max(applied, captured + lag()) : captured;
      clock = Math.round(applied);
      const { t, lobby, ...context } = f;
      const before = e.matchContext.gameMode;
      const deathBefore = e.lastDeathAt;
      e.applyRead(lobby ? { data: { lobby: true }, shot: null, at: captured }
        : { data: { context: { ...context } }, shot: null, at: captured });
      filed.push({ t, n: e.ledger.current() });
      maps.push({ t, map: e.matchContext.map || null });
      plants.push({ t, rounds: [...e.ledger.rounds.values()].filter((r) => r.planted).map((r) => r.n) });
      gaps.push({ t, ...e.phaseGap(captured + 1000) });
      if (e.lastDeathAt !== deathBefore) { registered++; deaths.push(t); }
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
  return { e, reviews, resumed, modes, lines, registered, deaths, maps, logged, filed, plants, gaps, restore: () => { Date.now = realNow; } };
}

/** What the review is built from, a replay at a time: each round, its death and where. */
const ledgerOf = (run) => run.e.ledger.list()
  .map((r) => `${r.n}${r.died ? `D${r.deathClock === null ? '' : r.deathClock}${r.deathSpot || ''}` : ''}${r.ultAtDeath === 'ready' ? 'U' : ''}`).join(' ');

/** The map the engine held from one second to another, each change once ('' for none). */
const mapsBetween = (run, from, to) => run.maps.filter((m) => m.t >= from && m.t <= to).map((m) => m.map || '')
  .filter((m, i, all) => i === 0 || m !== all[i - 1]);
const shown = (maps) => maps.map((m) => m || 'unknown').join(' -> ');

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
    // Riot's record of this match (riot-split-13-7.json): a death in 16 of its
    // 20 rounds, and every one of them is the screen's too.
    const splitTruth = {};
    for (const r of require('./fixtures/riot-split-13-7.json').perRound) if (r.died) splitTruth[r.n] = r.deathMs / 1000;
    const vs = againstRiot(rounds, splitTruth);
    ok(vs.agree === 16 && vs.missed === 0 && vs.invented === 0 && vs.close >= 13,
      `deaths round by round against Riot (${JSON.stringify(vs)})`);
    // Round 18's buy phase: "buy 0:24" and "buy 0:18" agree the timer runs out
    // at 1811 s, a "buy" read with no clock at 1802.6 s used to cut that window
    // to two seconds, and round 17's COMBAT REPORT at 1805.6 s was round 18's
    // death. Riot has the player alive in round 18.
    const r18 = rounds.find((r) => r.n === 18);
    ok(r18 && !r18.died, `round 18 keeps no death: a buy read with no clock does not cut short a window two clocked reads agree on (${r18 && r18.died})`);
    // THE FRAME'S OWN ULTIMATE READ. Round 16's alternated ready and charging,
    // the last ready nine seconds before the death and two empty reads after
    // it, and the one the context held made it "died holding your ultimate".
    const r16 = rounds.find((r) => r.n === 16);
    ok(r16 && r16.died && r16.ultAtDeath !== 'ready',
      `round 16 does not die holding an ultimate it read ready once (${r16 && r16.ultAtDeath})`);
    // The model read Haven at 41.3 s, after B Main and Mid Bottom were printed:
    // a map the labels had already ruled out.
    ok(!run.maps.some((m) => m.map === 'Haven'),
      `Haven, which the printed labels had ruled out, is never locked (${shown(mapsBetween(run, 0, 60))})`);
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
    ok(vs.agree === 5 && vs.invented === 0 && vs.missed === 0,
      `the screen's deaths line up with Riot's, round by round (${JSON.stringify(vs)})`);
    ok(vs.timed >= 3 && vs.close === vs.timed, 'and every timed one is within ten seconds of Riot');
    // A DEATH ON A WEAK TELL, judged by the read after it. Round 7's, at 676.2
    // s, read "no own health number spectating teammate's view": the read after
    // it was the player's own 50 health and knife, the HUD as it stood before.
    const rounds = run.e.ledger.list();
    const at = (t) => run.logged.find((x) => x.t === t);
    ok(run.deaths.includes(676.2) && !rounds.find((r) => r.n === 7).died && at(676.2) && at(676.2).died === false,
      'round 7 keeps no death: the read after it is the player\'s own HUD again, and the AI log has the frame as no death');
    // Round 1's read "Spectating teammate with HP 61", and the read after it
    // "own HP 61 and knife", the spectated teammate's HUD read as the player's:
    // the player had 75 and a Bandit. Riot has the death.
    ok(rounds.find((r) => r.n === 1).died && at(191.3) && at(191.3).died === true,
      'round 1 keeps its death, though the read after it claims the HUD: a teammate\'s health and gun are not the player\'s');
  }

  // ── The Sunset swiftplay, read a second (8.3.0) ───────────────────────────
  // Round 5 is a post plant, and at 436.8 s a frame read "buy 0:39" off the
  // ammo counter a second after the last post plant read, then four more
  // timers on any number. The ledger took the first for round 6's buy phase:
  // the rest of round 5 went to round 6, its false death with it (a
  // "Spectating 1" counter at 459.1 s), and round 6's real death was refused
  // for it, so round 6 died at A Site with its ultimate ready. Round 6's buy
  // phase begins at 467 s, its death came 20.8 s in by the clip.
  {
    const run = replay('valorant-session-sunset-swiftplay.json');
    const post = run.filed.filter((x) => x.t >= 436.8 && x.t <= 461.1);
    ok(post.length === 25 && post.every((x) => x.n === 5),
      `round 5's post plant stays round 5 through the misread buy timers (${[...new Set(post.map((x) => x.n))].join(',')})`);
    const six = run.filed.find((x) => x.n === 6);
    ok(six && six.t >= 462, `round 6 begins after round 5 ends, not in its post plant (${six && six.t} s)`);
    const rounds = run.e.ledger.list();
    const r6 = rounds.find((r) => r.n === 6);
    ok(r6 && r6.died && r6.deathClock !== null && r6.deathClock >= 70,
      `round 6 keeps its own death, early in the round (${r6 && r6.deathClock} left)`);
    ok(!rounds.some((r) => r.died && r.ultAtDeath === 'ready'),
      `and no death holds an ultimate that one misread put there (${rounds.map((r) => r.ultAtDeath).join(',')})`);

    // THE DEATHS, ON THE FRAMES THAT SHOW THEM. Each of the five reads "KILLED
    // BY <agent> and COMBAT REPORT" first, which the death proof did not know:
    // round 2's at 165.1 s, its alive flag unread, and round 6's at 519.0 s
    // registered a read late. And two registered on the SPECTATORS 1 counter
    // at the top right, a living player's HUD: the round 4 banner at 348.6 s,
    // a "dead" phase nothing checked, and 459.1 s in round 5's post plant.
    ok(run.deaths.join() === '70.9,165.1,253.3,459.1,519,615.4',
      `each death registers on the first frame of its death screen (${run.deaths.join(', ')} s)`);
    ok(!run.deaths.some((t) => t >= 348 && t <= 350),
      'nothing registers on the spectator counter of the round 4 banner, read as dead on two frames running');
    // 459.1 s read "Spectating teammate, own HP not shown" off the counter, and
    // the read a second later was the player's own 100 health and Ghost.
    const at459 = run.logged.find((x) => x.t === 459.1);
    ok(!rounds.find((r) => r.n === 5).died && at459 && at459.died === false,
      'round 5\'s weak tell death is withdrawn by the read after it, in the ledger and in the AI log');
    ok(rounds.filter((r) => r.died).map((r) => r.n).join() === '1,2,3,6,7',
      `the screen files a death in rounds 1, 2, 3, 6 and 7, those of the death screens (${rounds.filter((r) => r.died).map((r) => r.n)})`);

    // THE MAP LOCK AGAINST THE PRINTED LABELS. Haven won the lock on the first
    // two buy phase reads; the game then printed B Lobby, which Haven does not
    // have, at 24.3 and 35.4 s, then B Main and Mid Bottom, and the model kept
    // reading Haven for minutes.
    ok(mapsBetween(run, 14.2, 35).join() === 'Haven' && mapsBetween(run, 35.4, 35.4).join() === '',
      `Haven, locked at 14.2 s, is released by the second B Lobby read (${shown(mapsBetween(run, 0, 40))})`);
    const after = mapsBetween(run, 35.4, 999);
    ok(after.join() === ',Sunset',
      `and no Haven read the labels rule out locks it again, until Sunset does (${shown(after)})`);
    run.restore();
  }

  // ── Two misread timers that agree by chance hold no buy window ────────────
  // Round 5's post plant read five "buy" timers in six seconds off anything,
  // 0:39, 0:13, 0:23, 0:19 and 0:39 (436.8 to 441.9 s), and buy with no clock
  // from 445 to 454 s. Had the last been 0:18, it and the 0:19 before it end
  // within a second of each other: two clocked reads that agree, which a buy
  // read with no clock no longer cuts (coaching-engine.js buyWindow). The
  // round ledger took neither for a buy phase (buyVerdict), so the window is
  // held only where its buy end agrees, and a real death later in that post
  // plant is a death, not the combat report of the round before.
  {
    const dies = (f) => {
      if (f.t === 441.9) f.clock = '0:18';
      if (f.t >= 457.1 && f.t <= 461.1) {
        delete f.playerHp;
        delete f.playerWeapon;
        Object.assign(f, { phase: 'dead', playerAlive: false, spike: 'planted',
          aliveTell: f.t === 457.1 ? 'KILLED BY Jett and COMBAT REPORT no own health' : 'Spectating teammate with SWITCH PLAYER bottom left' });
      }
      return f;
    };
    const run = replay('valorant-session-sunset-swiftplay.json', { edit: dies });
    const r5 = run.e.ledger.list().find((r) => r.n === 5);
    ok(run.deaths.includes(457.1) && r5 && r5.died,
      `two misread timers agreeing in a post plant keep no window over a real death there (deaths ${run.deaths.filter((t) => t > 430 && t < 470).join(', ') || 'none'} s)`);
    run.restore();
  }

  // ── Round 5's first buy timer, a tenth from the countdown's last frame ────
  // The Sunset round 4 countdown read "postplant 0:04" at 345.6 s, the frames
  // after it carry that phase to its 0:00 at 349.6 s, the last frame of play,
  // and round 5's 0:43 at 351.7 s puts its timer's start at 349.7 s, a tenth
  // after it. Taken exactly (8.4.1's first round 5 check), the 0:43 read 0.2 s
  // earlier counted for nothing, the 0:33 was the one pistol timer left, and
  // the side swap, the model's inference, locked swiftplay at 382.1 s.
  {
    for (const shift of [0, -0.2]) {
      const early = (f) => (f.t === 351.7 ? Object.assign(f, { t: Math.round((351.7 + shift) * 10) / 10 }) : f);
      const run = replay('valorant-session-sunset-swiftplay.json', { edit: early });
      const sp = run.modes.find((m) => m.mode === 'swiftplay');
      ok(sp && sp.t === 361.8 && run.lines.some((l) => /pistol round's buy timer, 0:33/.test(l)),
        `round 5's 0:43 read ${shift ? `${-shift} s earlier` : 'as it was'} counts: swiftplay is locked on the pistol timer at 361.8 s (${JSON.stringify(run.modes)})`);
      run.restore();
    }
  }

  // ── The Fracture swiftplay, won 5 to 1, read a second (8.4.0) ─────────────
  // Riot's record of it, from its verified review: rounds 1 to 4 won on
  // defence, round 5 lost and round 6 won on attack, the deaths 31, 33 and 3
  // seconds into rounds 2, 5 and 6.
  //
  // 8.4.0 LOCKED STANDARD ON THE ROUND 4 END COUNTDOWN: the TAB scoreboard open
  // over it, "buy 0:01" and "buy 0:00" at 334.4 and 335.4 s with round 4's
  // 4,550 credits, after the banner's 4 to 0 had moved the ledger to round 5.
  // Rounds 5 and 6 were then defence by the halftime math, 4 to 1 was no match
  // point, so round 6's dead phase was read every 3 s and the final 5 to 1 fell
  // between two reads, and the review waited for Stop. The AI log keeps each
  // read as the guards left them, and they took out the step's first read of 4
  // to 0 (at 330.4 s, or the read before it: 331.4 s was its second): put back,
  // the replay is the live run. Kept as it was, round 4's money counts once,
  // which blocked both swiftplay tells and left the mode unknown.
  {
    const RIOT = { 1: { won: true, side: 'defending' }, 2: { won: true, side: 'defending', died: 31 },
      3: { won: true, side: 'defending' }, 4: { won: true, side: 'defending' },
      5: { won: false, side: 'attacking', died: 33 }, 6: { won: true, side: 'attacking', died: 3 } };
    const live = (f) => (f.t === 330.4 ? Object.assign(f, { teamScore: 4, enemyScore: 0 }) : f);
    // What the match point cadence reads after the last frame: the banner's 5
    // to 1 twice, spectating, then the end screen, which reads as a menu.
    const banner = (t) => ({ t, phase: 'dead', playerAlive: false, teamScore: 5, enemyScore: 1, side: 'attacking',
      aliveTell: 'Spectating someone with SWITCH PLAYER bottom left' });
    const run = replay('valorant-session-fracture-swiftplay.json',
      { edit: live, then: [banner(550.1), banner(551.1), { t: 552.1, lobby: true }, { t: 553.1, lobby: true }] });
    const { e, modes, lines, reviews } = run;
    const sp = modes.find((m) => m.mode === 'swiftplay');
    ok(sp && sp.t === 338.6 && sp.score === '4-0' && lines.some((l) => /pistol round's buy timer, 0:42/.test(l)),
      `swiftplay is locked in round 5 on the pistol round's buy timer, 0:43 then 0:42 (${JSON.stringify(modes)})`);
    ok(!modes.some((m) => m.mode === 'standard') && !lines.some((l) => /bought with 4550 credits/.test(l)),
      'and never standard: the round end countdown\'s 0:01 and 0:00 began inside round 4, and its 4,550 credits count for nothing');
    const plain = replay('valorant-session-fracture-swiftplay.json');
    ok(plain.modes.map((m) => `${m.mode}@${m.t}`).join() === 'swiftplay@338.6',
      `the session as the AI log kept it locks swiftplay on the same read (${JSON.stringify(plain.modes)})`);
    plain.restore();
    // THE MATCH ENDS ON ITS SCORE, WITH NO STOP: 4 to 1 is match point in a
    // swiftplay, so round 6's dead phase is read at the gap, and its 5 to 1
    // with the end screen read twice ends it.
    const dead6 = run.gaps.filter((g) => g.t > 480.4 && g.t <= 549.1);
    ok(dead6.length >= 20 && dead6.every((g) => g.why === 'match point' && g.ms === 1000),
      `round 6's dead phase at 4 to 1 is read at the gap, match point (${[...new Set(dead6.map((g) => `${g.why} ${g.ms}`))].join(', ')})`);
    await new Promise((r) => setTimeout(r, 30));
    const snap = reviews[0] && reviews[0].snap;
    ok(reviews.length === 1 && snap.endedBy === 'score' && e.isRunning,
      `the watch ends it on its score, with recording still on (${reviews.length} review, ended by ${snap && snap.endedBy})`);
    ok(snap && snap.rounds.length === 6 && snap.context.gameMode === 'swiftplay',
      `with its 6 rounds, as a swiftplay match (${snap && snap.rounds.length}, ${snap && snap.context.gameMode})`);
    const rounds = snap ? snap.rounds : [];
    ok(rounds.map((r) => `${r.n}${r.side ? r.side[0] : '?'}`).join(' ') === '1d 2d 3d 4d 5a 6a',
      `rounds 1 to 4 on defence and rounds 5 and 6 on attack, Riot's sides (${rounds.map((r) => `${r.n}${r.side ? r.side[0] : '?'}`).join(' ')})`);
    ok(rounds.length === 6 && rounds.every((r) => RIOT[r.n] && r.result !== null && (r.result === 'won') === RIOT[r.n].won),
      `and every round's result is Riot's (${rounds.map((r) => `${r.n}${r.result ? r.result[0] : '?'}`).join(' ')})`);
    // THE DEATHS. Rounds 2, 5 and 6 register on the first frame of their death
    // screens, "KILLED BY <agent> and COMBAT REPORT", and round 3's weak tell
    // at 264.3 s is withdrawn by the read after it, the player's own 89 health
    // and knife. Round 1's at 74.8 s is the model's: the WON banner forming at
    // 0:06 over a living player, read as the read prompt's own example
    // sentence ("Spectating, teammate's portrait and name above SWITCH
    // PLAYER"). The replies are fixed, so it stays here; the read prompt's fix
    // is what takes it away, and Riot's record takes it off the review.
    const at = (t) => run.logged.find((x) => x.t === t);
    ok(run.deaths.join() === '74.8,143.1,264.3,415.2,475.4' && at(264.3) && at(264.3).died === false,
      `deaths register at 74.8, 143.1, 415.2 and 475.4 s, and at 264.3 s on a weak tell the next read withdraws (${run.deaths.join(', ')} s)`);
    const truth = {};
    for (const [n, r] of Object.entries(RIOT)) if (r.died !== undefined) truth[n] = r.died;
    const vs = againstRiot(rounds, truth);
    ok(vs.agree === 3 && vs.missed === 0 && vs.invented === 1 && rounds[0].died,
      `against Riot: rounds 2, 5 and 6 agree, and round 1's is the prompt's invention (${JSON.stringify(vs)})`);
    // A RETURN FROM THE DEAD, ONE READ LONG. 34 s after round 6's death, at
    // 509.9 s, a frame showing SWITCH PLAYER and the COMBAT REPORT read "own HP
    // 50 and Sheriff", and the next, at 511.7 s, SWITCH PLAYER again: believed,
    // the first made the player alive and the second a second death.
    ok(!run.deaths.includes(511.7) && at(511.7) && at(511.7).died === false
      && lines.some((l) => /holding a return from the dead/.test(l)),
      'round 6\'s one read "back alive" at 509.9 s is held, and the SWITCH PLAYER read after it is no second death');
    // NO PLANT WHILE THE ROUND CLOCK RUNS. Round 3 at 0:51 read "planted at B"
    // off the chat line "spotted the SPIKE in B", its clock running on, and
    // Riot has no plant. Its round end countdown, at 276.3 s, read "postplant
    // 0:00, planted at B Site" too, which the banner rule still credits to
    // round 3: no clock rule can tell that read from a plant seen only on the
    // banner, and the read prompt's fix is what can.
    ok(run.plants.filter((p) => p.t < 276.3).every((p) => !p.rounds.includes(3))
      && lines.some((l) => /ignoring "planted" on a live round read, its round clock 0:51/.test(l)),
      `round 3's play plants nothing, the chat line at 0:51 with its round clock running included (${run.plants.find((p) => p.rounds.includes(3)) ? run.plants.find((p) => p.rounds.includes(3)).t : 'never'} s)`);
    run.restore();
  }

  // ── The Fracture's round 5 read as 0 to 0, three times in two seconds ─────
  // On the bench of 14 Oct the live read prompt read round 5's first seconds
  // of play, 4 to 0 printed plainly and the round clock at 1:38, as 0 to 0 on
  // frames 00269 to 00271, the first with 4 to 0 in its context, then 4 to 0 once, then
  // 0 to 0 three times more. From round 5 two such reads in a row were a new
  // match: the match closed into the library at round 5, its rounds 5 and 6
  // filed as the next one's. A new match needs ten seconds of them with none
  // of the held score between (coaching-engine.js newMatchRun), and these are
  // two. The live prompt's replies to those frames, their score, phase, clock
  // and HUD as it wrote them, laid over the AI log's reads of the same frames.
  {
    const said = (phase, roundNumber, team, clock, aliveTell, playerWeapon) => ({ side: 'attacking', phase, roundNumber,
      teamScore: team, enemyScore: 0, playerHp: 100, playerAlive: true, aliveTell, playerWeapon, locLabel: 'A Hall', clock });
    const BENCH = {
      382.9: { ...said('buy', 1, 0, '1:38', 'own HP 100 and Ghost bottom left', 'Ghost'), playerCredits: 800 },
      383.9: said('buy', 1, 0, '1:37', 'own HP 100 and Ghost bottom center', 'Ghost'),
      384.9: said('buy', 1, 0, '1:36', 'own HP 100 and Ghost bottom left', 'Ghost'),
      385.9: said('buy', 5, 4, '1:35', 'own HP 100 and Bandit bottom left', 'Bandit'),
      386.9: said('active', 1, 0, '1:34', 'own HP 100 and Ghost bottom left', 'Ghost'),
      387.9: said('buy', 1, 0, '1:33', 'own HP 100 and Ghost bottom left', 'Ghost'),
      388.9: said('buy', 1, 0, '1:32', 'own HP 100 and Bandit bottom left', 'Bandit'),
      389.9: said('buy', 5, 4, '1:31', 'own HP 100 bottom center with own abilities bottom left', 'Bandit'),
    };
    const live = (f) => (f.t === 330.4 ? Object.assign(f, { teamScore: 4, enemyScore: 0 }) : f);
    const bench = (f) => (BENCH[f.t] ? { t: f.t, ...BENCH[f.t] } : live(f));
    const banner = (t) => ({ t, phase: 'dead', playerAlive: false, teamScore: 5, enemyScore: 1, side: 'attacking',
      aliveTell: 'Spectating someone with SWITCH PLAYER bottom left' });
    const then = [banner(550.1), banner(551.1), { t: 552.1, lobby: true }, { t: 553.1, lobby: true }];
    const ref = replay('valorant-session-fracture-swiftplay.json', { edit: live, then });
    ref.restore();
    const run = replay('valorant-session-fracture-swiftplay.json', { edit: bench, then });
    await new Promise((r) => setTimeout(r, 30));
    run.restore();
    const resets = run.lines.filter((l) => /new match detected|never seen ending/.test(l));
    const refused = (r) => r.lines.filter((l) => /ignoring backwards scoreboard read: round 5 -> 1$/.test(l)).length;
    ok(!resets.length && refused(run) === 6 && refused(ref) === 0,
      `round 5 read as 0 to 0 three times in two seconds, twice, is six reads refused and no new match (${refused(run)} refused; ${resets.join('; ') || 'no reset'})`);
    const rows = (rv) => (rv && rv.snap ? rv.snap.rounds : []).map((r) => `${r.n}${r.side ? r.side[0] : '?'}${r.result ? r.result[0] : '?'}${r.died ? 'D' : ''}`).join(' ');
    ok(run.reviews.length === 1 && run.reviews[0].snap.endedBy === 'score' && rows(run.reviews[0]) === rows(ref.reviews[0])
      && rows(ref.reviews[0]).split(' ').length === 6 && run.deaths.join() === ref.deaths.join(),
      `and the match is the one the AI log's reads give: ended on its score, the same 6 rounds and deaths (${run.reviews.map((r) => `${r.snap.endedBy}: ${rows(r)}`).join('; ')})`);
  }

  // ── The fixture maker keeps a word where it drops one ─────────────────────
  // make-session-fixture.js cut a name out of a kill feed line and moved the
  // rest up: "<name> killed by Chamber" became "killed by Chamber", which the
  // spectate guard reads as the player's own death banner, and the Fracture
  // replay above lost its round 6 return. And the repo is public: every word
  // of its fixture is one the scrubber allows, the game's own, a number or
  // the placeholder, but two the maker was told were no names.
  {
    const maker = require(path.join(__dirname, 'fixtures', 'make-session-fixture.js'));
    const spectate = require(path.join(__dirname, '..', 'src', 'shared', 'spectate-tells.js'));
    const feed = maker.scrub('Xyzzy killed by Chamber');
    ok(feed === 'someone killed by Chamber' && !spectate.KILLED_BY_PLAYER.test(feed)
      && spectate.KILLED_BY_PLAYER.test(maker.scrub('KILLED BY CHAMBER')) && maker.scrub('Xyzzy') === undefined,
      `a dropped name leaves a placeholder ("${feed}"), so a line about somebody else is never the player's banner`);
    const strange = Object.keys(maker.strangeWords(require('./fixtures/valorant-session-fracture-swiftplay.json').frames))
      .map((w) => w.toLowerCase()).sort();
    ok(strange.join() === 'aide,m4a1',
      `the Fracture fixture holds no word the lists do not know but the model's "Aide" label and its "M4A1" (${strange.join(', ')})`);
    // And what the maker refuses on: a session of made up names in a profile
    // folder of its own, a name in a raw field and the Riot ID in another.
    const fs = require('fs');
    const os = require('os');
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'occlara-fixture-'));
    try {
      const dir = path.join(home, 'ai-log', 'session-x');
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(home, 'occlara-config.json'), JSON.stringify({ riotId: 'Zorblax#Q7Z' }));
      fs.writeFileSync(path.join(dir, 'log.json'), JSON.stringify({ records: [
        { i: 0, at: 1000, state: { phase: 'dead', playerAlive: false, aliveTell: 'Spectating Quuxly with SWITCH PLAYER', killFeed: 'Zorblax killed by Sage' } },
        { i: 1, at: 2000, state: { phase: 'active', playerSpot: 'near Quuxly', spikeSpot: 'Zorblax', clock: '1:20' } },
      ] }));
      const frames = maker.build(dir);
      const leak = maker.leaks(dir, frames);
      ok(frames[0].aliveTell === 'Spectating someone with SWITCH PLAYER' && leak.riotId.join() === 'zorblax'
        && leak.session.includes('quuxly') && leak.session.includes('zorblax'),
      `a name left in a field the maker keeps as it is, and the Riot ID, are what it refuses to write (Riot ID ${leak.riotId.length}, others ${leak.session.length})`);
    } finally {
      fs.rmSync(home, { recursive: true, force: true });
    }
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
    // The round 10 buy phase's last frame read its kill feed as "killed by
    // Skye", a dead read in a buy phase, and the next one a "dead" phase that
    // proves nothing ("own HP 100 and Vandal bottom center with death"), three
    // seconds into a round the player is read alive in at 19 health nine
    // seconds later. Riot has the death fifteen seconds in, the screen's next.
    ok(!run.deaths.includes(939.1) && run.deaths.includes(957.1),
      `a dead read in the buy phase is no first read of two (deaths at ${run.deaths.filter((t) => t > 900 && t < 1000).join(', ')} s)`);
    run.restore();
  }

  // ── 0 to 0 misread now and then, over the Abyss match's long stretch ─────
  // From 812.9 s to 957.1 s, two rounds and fifteen reads, the AI log has no
  // score read: the player dead and spectating, then a buy phase. A read with
  // no score of its own never ends a wait for a new match, so 0 to 0 laid over
  // five of those reads, each 24 to 31 s after the one before, was a new
  // match on the third: the match closed into the library at round 10 and its
  // last 14 rounds filed as the next one's. The three reads and ten seconds
  // fall within thirty of the wait's first (coaching-engine.js
  // NEW_MATCH_WITHIN_MS), and these never do.
  {
    const MIS = [821.6, 848.8, 879.1, 905.8, 930];
    const base = replay('valorant-session-abyss-unrated.json');
    const want = { ledger: ledgerOf(base), deaths: base.deaths.join() };
    base.restore();
    const run = replay('valorant-session-abyss-unrated.json',
      { edit: (f) => (MIS.includes(f.t) ? Object.assign(f, { teamScore: 0, enemyScore: 0 }) : f) });
    run.restore();
    const resets = run.lines.filter((l) => /new match detected|never seen ending/.test(l));
    const refused = run.lines.filter((l) => /ignoring backwards scoreboard read: round 10 -> 1$/.test(l)).length;
    ok(!resets.length && refused === MIS.length && ledgerOf(run) === want.ledger && run.deaths.join() === want.deaths,
      `five 0 to 0 misreads over its 144 s with no score read, 24 to 31 s apart, are five reads refused and no new match: `
      + `its 24 rounds and their deaths as the AI log's reads give them (${refused} refused; ${resets.join('; ') || 'no reset'})`);
  }

  // ── Read latency changes nothing ──────────────────────────────────────────
  // Live, a reply is applied one to four seconds after its frame was captured,
  // later behind a slow one, and every guard used to measure on when it was
  // applied: the same session read differently from run to run. At a read p90
  // of 2.7 seconds, the Sunset post plant was filed under round 6 again (seeds
  // 14 and 67 of 100), the Abyss swiftplay lost round 1's death (14 of 100), and
  // the Split and Abyss matches moved a death or its second (24 and 11 of 100).
  // On the second each frame was captured, every run is the run with none.
  {
    const CASES = [
      ['valorant-session-sunset-swiftplay.json', [14, 67]],
      ['valorant-session-abyss-swiftplay.json', [16, 21]],
      ['valorant-session-split-competitive.json', [6, 15]],
      ['valorant-session-abyss-unrated.json', [17, 25]],
      ['valorant-session-fracture-swiftplay.json', [3, 9]],
    ];
    for (const [file, seeds] of CASES) {
      const base = replay(file);
      const want = { ledger: ledgerOf(base), filed: base.filed.map((x) => x.n).join(), deaths: base.deaths.join() };
      base.restore();
      for (const seed of seeds) {
        const run = replay(file, { latency: { seed, p90: 2.7 } });
        const got = { ledger: ledgerOf(run), filed: run.filed.map((x) => x.n).join(), deaths: run.deaths.join() };
        run.restore();
        const differ = Object.keys(want).filter((k) => want[k] !== got[k]);
        ok(!differ.length, `${file.replace(/^valorant-session-|\.json$/g, '')} at a read p90 of 2.7 s (seed ${seed}): `
          + `the rounds, their deaths and where each frame is filed are the capture time replay's (${differ.join(', ') || 'same'})`);
      }
    }
  }

  // ── The read cadence only watches ─────────────────────────────────────────
  // read-cadence.js is told every read the engine applies and decides only
  // when the next one goes. Fed the four sessions, it must leave every round,
  // death, filed frame, mode and map exactly as the engine without it has
  // them, and have followed the reads to the last.
  {
    for (const file of ['valorant-session-sunset-swiftplay.json', 'valorant-session-abyss-swiftplay.json',
      'valorant-session-split-competitive.json', 'valorant-session-abyss-unrated.json',
      'valorant-session-fracture-swiftplay.json']) {
      const on = replay(file);
      const off = replay(file, { cadence: false });
      const of = (r) => ({ ledger: ledgerOf(r), filed: r.filed.map((x) => x.n).join(), deaths: r.deaths.join(),
        modes: JSON.stringify(r.modes), maps: r.maps.map((m) => m.map).join() });
      const a = of(on);
      const b = of(off);
      const differ = Object.keys(a).filter((k) => a[k] !== b[k]);
      const frames = require(path.join(__dirname, 'fixtures', file)).frames;
      const last = Date.parse('2026-10-04T20:00:00Z') + frames[frames.length - 1].t * 1000;
      on.restore();
      off.restore();
      ok(!differ.length && on.e.readCadence.appliedAt === last,
        `${file.replace(/^valorant-session-|\.json$/g, '')}: the read cadence changes nothing the guards decide, `
        + `and has followed every read to the last (${differ.join(', ') || 'same'})`);
    }
  }

  // ── The ultimate the ledger is handed ─────────────────────────────────────
  // The context keeps the last ultimate read when a read leaves it empty, so
  // `ult` is one read carried; `ultRead` is the frame's own, the player's only.
  {
    const e = new CoachingEngine({ licenseKey: 'TEST', captureFunction: async () => null, experiments: () => ({}) });
    e.isRunning = true;
    const handed = [];
    const observe = e.ledger.observe.bind(e.ledger);
    e.ledger.observe = (f) => { handed.push(`${f.ult || '-'}/${f.ultRead === undefined ? 'none' : f.ultRead || '-'}`); return observe(f); };
    const t0 = Date.parse('2026-10-04T20:00:00Z');
    const read = (s, ctx) => {
      Date.now = () => t0 + s * 1000;
      console.log = () => {};
      try {
        e.applyRead({ data: { context: { phase: 'active', clock: '1:20', teamScore: 0, enemyScore: 0, playerAlive: true,
          playerHp: 100, playerWeapon: 'Vandal', ...ctx } }, shot: null, at: t0 + s * 1000 });
      } finally { console.log = realLog; }
    };
    read(1, { playerUlt: 'ready' });
    read(2, {});
    read(3, { playerUlt: 'charging' });
    read(4, { phase: 'dead', playerAlive: false, playerHp: null, aliveTell: 'KILLED BY Neon and COMBAT REPORT shown', playerUlt: 'ready' });
    Date.now = realNow;
    ok(handed.join() === 'ready/ready,ready/-,charging/charging,charging/-',
      `each frame hands the ledger its own ultimate read, none when it read none or the HUD is a teammate's (${handed.join(', ')})`);
  }

  // ── A death still on trial when recording stops ───────────────────────────
  // No read is coming to judge it, so it stands, and the AI log gets its frame
  // as a death: held for a verdict that never came, the frame the review's
  // picker takes for the screen's look at it was never written.
  {
    const logged = [];
    const e = new CoachingEngine({ licenseKey: 'TEST', captureFunction: async () => null, experiments: () => ({}),
      diagnostics: (rec) => logged.push(rec) });
    e.isRunning = true;
    const t0 = Date.parse('2026-10-04T20:00:00Z');
    console.log = () => {};
    try {
      Date.now = () => t0 + 1000;
      e.applyRead({ data: { context: { phase: 'postplant', spike: 'planted', teamScore: 1, enemyScore: 3, playerAlive: true,
        playerHp: 100, playerWeapon: 'Ghost' } }, shot: 'a', at: t0 + 1000 });
      Date.now = () => t0 + 2000;
      e.applyRead({ data: { context: { phase: 'postplant', teamScore: 1, enemyScore: 3, playerAlive: false,
        aliveTell: 'Spectating teammate, own HP not shown' } }, shot: 'b', at: t0 + 2000 });
      e.stop();
      await new Promise((r) => setTimeout(r, 30));
    } finally { console.log = realLog; Date.now = realNow; }
    ok(logged.length === 2 && logged[1].died === true && e.ledger.list().some((r) => r.died),
      `a death on trial when recording stops stands, and its frame is logged as one (${logged.map((r) => r.died).join(', ')})`);
  }

  // ── The Fracture guards at their boundaries, on reads written by hand ─────
  const readBy = (reads) => {
    const t0 = Date.parse('2026-10-04T20:00:00Z');
    const lines = [];
    const deaths = [];
    const e = new CoachingEngine({ licenseKey: 'TEST', captureFunction: async () => null, experiments: () => ({}) });
    e.isRunning = true;
    console.log = (...a) => lines.push(a.join(' '));
    try {
      for (const r of reads) {
        const at = t0 + r.t * 1000;
        Date.now = () => at;
        const { t, ...context } = r;
        const before = e.lastDeathAt;
        e.applyRead({ data: { context }, shot: null, at });
        if (e.lastDeathAt !== before) deaths.push(t);
      }
    } finally { console.log = realLog; Date.now = realNow; }
    return { e, lines, deaths };
  };
  const clockOf = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  {
    // When a buy timer began: buyVerdict's start, to within the two seconds
    // a whole second clock and the countdown's last second leave.
    const { RoundLedger } = require(path.join(__dirname, '..', 'src', 'shared', 'valorant-rounds.js'));
    const L = new RoundLedger();
    L.lastPlayAt = 100000;
    ok(!L.beganAfterPlay(100000, 43) && L.beganAfterPlay(100001, 43) && !L.beganAfterPlay(98000, 30) && L.beganAfterPlay(98001, 30)
      && !L.beganAfterPlay(112000, 31) && L.beganAfterPlay(112001, 31) && !L.beganAfterPlay(200000, null)
      && !L.beganAfterPlay(101000, 0) && !L.beganAfterPlay(128000, 0) && new RoundLedger().beganAfterPlay(5000, 0),
    'a buy timer began after the last play when its clock puts its start no more than 2 s before it: 45 s past 0:30, 30 s to it, never with no clock, and a 0:00 a second on never');

    // Rounds 1 to 4 won on defence: a buy phase, play read every 10 s down to
    // 0:49, and the won banner's score read twice. Round 4's last play is at
    // 381 s, its banner's 4 to 0 is taken at 393 s, and round 5 is read after.
    const fourWon = (after) => {
      const out = [];
      for (let n = 0; n < 4; n++) {
        const t = n * 100;
        const at = { teamScore: n, enemyScore: 0, side: 'defending', playerAlive: true, playerHp: 100 };
        out.push({ ...at, t, phase: 'buy', clock: n ? '0:29' : '0:43', playerCredits: 800 + n * 1000, playerWeapon: 'Classic' });
        out.push({ ...at, t: t + 1, phase: 'buy', clock: n ? '0:28' : '0:42', playerWeapon: 'Classic' });
        for (let k = 0; k < 6; k++) out.push({ ...at, t: t + 31 + k * 10, phase: 'active', clock: clockOf(99 - k * 10), playerWeapon: 'Vandal' });
        out.push({ ...at, t: t + 92, phase: 'active', clock: '0:06', teamScore: n + 1, playerWeapon: 'Vandal' });
        out.push({ ...at, t: t + 93, phase: 'active', clock: '0:05', teamScore: n + 1, playerWeapon: 'Vandal' });
      }
      return out.concat(after.map((r) => ({ teamScore: 4, enemyScore: 0, side: 'defending', playerAlive: true, playerHp: 100,
        playerWeapon: 'Knife', ...r })));
    };
    const countdown = [{ t: 397, phase: 'buy', clock: '0:01', playerCredits: 4550 }, { t: 398, phase: 'buy', clock: '0:00', playerCredits: 4550 }];
    const pistol = [{ t: 401, phase: 'buy', clock: '0:43', playerCredits: 800, side: 'attacking' },
      { t: 402, phase: 'buy', clock: '0:42', playerCredits: 800, side: 'attacking' }];
    const swift = readBy(fourWon([...countdown, ...pistol]));
    ok(swift.e.matchContext.gameMode === 'swiftplay' && !swift.lines.some((l) => /bought with/.test(l)),
      `round 4's end countdown, "buy 0:01" and "0:00" with its 4,550 credits, counts for nothing, and 0:43 then 0:42 with 800 lock swiftplay (${swift.e.matchContext.gameMode})`);
    const comp = readBy(fourWon([...countdown, { t: 401, phase: 'buy', clock: '0:29', playerCredits: 3550 },
      { t: 402, phase: 'buy', clock: '0:28', playerCredits: 3550 }]));
    ok(comp.e.matchContext.gameMode === 'standard' && comp.lines.some((l) => /bought with 3550 credits/.test(l)),
      `and a standard round 5 bought at 0:29 with 3,550 locks standard (${comp.e.matchContext.gameMode})`);
    const blind = readBy(fourWon([{ t: 401, phase: 'buy', playerCredits: 3550 }, { t: 402, phase: 'buy', playerCredits: 3550 }]));
    ok(blind.e.matchContext.gameMode === null,
      `a buy read with no clock of its own says nothing of when its buy phase began, so its money counts for nothing (${blind.e.matchContext.gameMode})`);
    // Round 4 ended after a plant: its countdown read "postplant 0:04", the
    // frames after it carry that phase, and its 0:00 at 397.8 s is the last
    // frame of play. A standard round 5 at 0:29 with 3,550 read at 398.7 s
    // began by its clock at 397.7 s at the earliest, a tenth before it, and so
    // does every read a second after it. Taken exactly they counted for
    // nothing, and the side misread as attacking on five of them locked
    // swiftplay on a standard match by the side swap.
    const postCountdown = [{ t: 394, phase: 'postplant', clock: '0:04' }, { t: 395.8, clock: '0:02' },
      { t: 396.8, clock: '0:01' }, { t: 397.8, clock: '0:00' }];
    const misread = [0, 1, 2, 3, 4].map((k) => ({ t: 398.7 + k, phase: 'buy', clock: `0:${29 - k}`, playerCredits: 3550, side: 'attacking' }));
    const tight = readBy(fourWon([...postCountdown, ...misread]));
    ok(tight.e.matchContext.gameMode === 'standard' && tight.lines.some((l) => /bought with 3550 credits/.test(l))
      && tight.e.ledger.lastPlayAt === Date.parse('2026-10-04T20:00:00Z') + 397800,
      `and one whose timer began a tenth before the countdown's last frame is standard's money, never a side swap (${tight.e.matchContext.gameMode})`);
    // The two proofs nothing outranks, after a swiftplay lock from round 5's
    // timer: a team on 5 buying another round, and a sixth round won.
    const round5 = [...pistol];
    for (let k = 0; k < 6; k++) round5.push({ t: 431 + k * 10, phase: 'active', clock: clockOf(99 - k * 10), side: 'attacking' });
    round5.push({ t: 492, phase: 'active', clock: '0:06', teamScore: 5, side: 'attacking' }, { t: 493, phase: 'active', clock: '0:05', teamScore: 5, side: 'attacking' });
    const buyAt5 = readBy(fourWon([...round5, { t: 501, phase: 'buy', clock: '0:29', teamScore: 5 }, { t: 502, phase: 'buy', clock: '0:28', teamScore: 5 }]));
    ok(buyAt5.e.matchContext.gameMode === 'standard' && buyAt5.lines.some((l) => /mode corrected to standard \(a buy phase at 5-0/.test(l)),
      `a buy phase with a team on 5 proves standard over it (${buyAt5.e.matchContext.gameMode})`);
    const round6 = [];
    for (let k = 0; k < 6; k++) round6.push({ t: 531 + k * 10, phase: 'active', clock: clockOf(99 - k * 10), teamScore: 5, side: 'attacking' });
    round6.push({ t: 592, phase: 'active', clock: '0:06', teamScore: 6, side: 'attacking' }, { t: 593, phase: 'active', clock: '0:05', teamScore: 6, side: 'attacking' },
      { t: 594, phase: 'active', clock: '0:04', teamScore: 6, side: 'attacking' });
    const six = readBy(fourWon([...round5, ...round6]));
    ok(six.e.matchContext.gameMode === 'standard' && six.lines.some((l) => /mode corrected to standard \(score\/round past swiftplay limits/.test(l)),
      `and so does a score past swiftplay's (${six.e.matchContext.gameMode})`);
  }
  {
    // A RETURN FROM THE DEAD. Round 3, the death on its death screen at 1:20.
    const alive = { phase: 'active', teamScore: 1, enemyScore: 1, side: 'defending', playerAlive: true, playerHp: 100,
      playerWeapon: 'Vandal', aliveTell: 'own HP 100 and Vandal bottom left' };
    const dead = { phase: 'dead', teamScore: 1, enemyScore: 1, playerAlive: false, aliveTell: 'Spectating someone with SWITCH PLAYER bottom left' };
    const died = [{ t: 0, ...alive, clock: '1:30' }, { t: 5, ...alive, clock: '1:25' },
      { t: 10, ...dead, clock: '1:20', aliveTell: 'KILLED BY Jett and COMBAT REPORT shown' }, { t: 15, ...dead, clock: '1:15' }];
    const back = (t, o) => ({ t, ...alive, playerHp: 50, playerWeapon: 'Sheriff', aliveTell: 'own HP 50 and Sheriff bottom right', ...o });
    const once = readBy([...died, back(40, { clock: '0:50' }), { t: 41, ...dead, clock: '0:49' }]);
    ok(once.deaths.join() === '10' && once.lines.some((l) => /holding a return from the dead/.test(l)) && once.e.matchContext.playerAlive === false,
      `one "own HP" read 30 s on, its round clock carrying on the death's, is held, and the SWITCH PLAYER read after it is no second death (deaths at ${once.deaths.join(', ')} s)`);
    const twice = readBy([...died, back(40, { clock: '0:50' }), back(41, { clock: '0:49' })]);
    ok(twice.e.matchContext.playerAlive === true, 'two in a row are believed: a revive costs one read');
    const elsewhere = readBy([...died, back(40, { clock: '0:20' })]);
    const moved = readBy([...died, back(40, { clock: '0:50', teamScore: 2 })]);
    const bought = readBy([...died, back(40, { phase: 'buy', clock: '0:28' })]);
    ok([elsewhere, moved, bought].every((r) => r.e.matchContext.playerAlive === true && !r.lines.some((l) => /holding a return/.test(l))),
      'and none is held whose clock does not carry on the death\'s, whose score moved on, or that is a buy read');
    const heldPlant = readBy([...died, back(40, { clock: '0:50', spike: 'planted', spikeSpot: 'B' })]);
    ok(heldPlant.lines.some((l) => /holding a return/.test(l)) && heldPlant.e.matchContext.spike !== 'planted',
      'a held read saying "planted" on the live round, its round clock running, plants nothing either');
  }
  {
    // NO SPIKE IS DOWN WHILE THE ROUND CLOCK RUNS.
    const at = { teamScore: 2, enemyScore: 0, side: 'defending', playerAlive: true, playerHp: 89, playerWeapon: 'Knife' };
    const planted = (r) => r.e.matchContext.spike === 'planted' || r.e.ledger.list().some((x) => x.planted);
    const chat = readBy([{ t: 0, ...at, phase: 'active', clock: '1:02' }, { t: 10, ...at, phase: 'active', clock: '0:52', spike: 'planted', spikeSpot: 'B' },
      { t: 20, ...at, phase: 'active', clock: '0:42' }]);
    const early = readBy([{ t: 0, ...at, phase: 'active', clock: '1:22', spike: 'planted', spikeSpot: 'A Site' }]);
    ok(!planted(chat) && !planted(early),
      'a live round read saying "planted" plants nothing while its round clock runs on, or reads over 45 s');
    const moment = readBy([{ t: 0, ...at, phase: 'active', clock: '1:22' }, { t: 10, ...at, phase: 'postplant', clock: '1:12', spike: 'planted', spikeSpot: 'B site' }]);
    const held = readBy([{ t: 0, ...at, phase: 'active', clock: '1:22' }, { t: 5, ...at, phase: 'postplant', spike: 'planted', spikeSpot: 'B site' },
      { t: 7, ...at, phase: 'active', clock: '1:15', spike: 'planted' }]);
    const banner = readBy([{ t: 0, ...at, phase: 'active', clock: '1:22' }, { t: 60, ...at, phase: 'active', clock: '0:01', spike: 'planted', spikeSpot: 'B Site' }]);
    ok(planted(moment) && planted(held) && planted(banner),
      'the frame of the plant read post plant, the timer\'s last second on it, plants; a plant already held stays; a banner\'s still counts');
  }

  console.log(`\n${fails ? fails + ' of ' + checks + ' failed' : 'all ' + checks + ' session replay checks passed'}`);
  process.exit(fails ? 1 : 0);
})();
