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
function replay(file, { menusAfter = 0, latency = null, cadence = true, edit = null } = {}) {
  // `edit` reads the session otherwise: the frames copied, never the cached fixture changed.
  const real = require(path.join(__dirname, 'fixtures', file)).frames;
  const frames = edit ? real.map((f) => edit({ ...f })) : real;
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
  let registered = 0;
  const lag = latency ? latencies(latency.seed, latency.p90) : null;
  let applied = 0;
  try {
    for (const f of frames) {
      const captured = t0 + f.t * 1000;
      applied = lag ? Math.max(applied, captured + lag()) : captured;
      clock = Math.round(applied);
      const { t, ...context } = f;
      const before = e.matchContext.gameMode;
      const deathBefore = e.lastDeathAt;
      e.applyRead({ data: { context: { ...context } }, shot: null, at: captured });
      filed.push({ t, n: e.ledger.current() });
      maps.push({ t, map: e.matchContext.map || null });
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
  return { e, reviews, resumed, modes, lines, registered, deaths, maps, logged, filed, restore: () => { Date.now = realNow; } };
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
      'valorant-session-split-competitive.json', 'valorant-session-abyss-unrated.json']) {
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

  console.log(`\n${fails ? fails + ' of ' + checks + ' failed' : 'all ' + checks + ' session replay checks passed'}`);
  process.exit(fails ? 1 : 0);
})();
