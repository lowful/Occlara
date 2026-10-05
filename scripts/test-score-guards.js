'use strict';

/**
 * The scoreboard guards, on reads driven through the real engine with a fake
 * clock: one round forward takes two agreeing reads, a step the model misread
 * on consecutive frames is taken back, a lone digit is checked like a pair, a
 * dead phase next to the player's own health is not a death, and a new match
 * the watch never saw the last one end closes that one first.
 *
 * Every case is a reproduction an auditor ran against the shipped engine:
 * 12-10 read once as 13-10 ended the match in round 23, a lone 13 at 12-9 did
 * the same in round 22, and an unrated 13-12 followed by a new match filed the
 * new match under round 27.
 *
 * Run: npm run test:scoreguards
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
      post: async () => ({ ok: true, status: 200, data: { summary: 'A summary.', rounds: {}, focus: null, study: [] } }),
      get: async () => ({ ok: false }),
    };
  }
  return realLoad(request, parent, isMain);
};
const CoachingEngine = require(path.join(__dirname, '..', 'src', 'main', 'services', 'coaching-engine.js'));
Module._load = realLoad;

const realNow = Date.now;
const realLog = console.log;
let clock = Date.parse('2026-10-04T20:00:00Z');
Date.now = () => clock;

function engine() {
  const e = new CoachingEngine({ licenseKey: 'TEST', captureFunction: async () => null, experiments: () => ({}) });
  e.isRunning = true;
  e.reviews = [];
  e.ended = [];
  e.on('match-review', (t, snap) => e.reviews.push(snap));
  e.on('match-ended', (snap) => e.ended.push(snap));
  return e;
}

/** One read through the guards, `sec` seconds after the last. */
function read(e, sec, context) {
  clock += sec * 1000;
  const lines = [];
  console.log = (...a) => lines.push(a.join(' '));
  try {
    e.applyRead({ data: { context: { side: 'attacking', map: 'Bind', ...context } }, shot: null, at: clock });
  } finally {
    console.log = realLog;
  }
  return lines;
}
const score = (e) => `${e.matchContext.teamScore}-${e.matchContext.enemyScore}`;

/** A menu frame (the end of match screen reads as one), `sec` seconds on. */
function menu(e, sec) {
  clock += sec * 1000;
  console.log = () => {};
  try { e.applyRead({ data: { lobby: true }, shot: null, at: clock }); } finally { console.log = realLog; }
}

/** A match played up to a score, a round a minute and a half, two reads a round. */
function playTo(e, team, enemy) {
  let t = 0;
  let en = 0;
  read(e, 2, { phase: 'buy', clock: '0:20', teamScore: 0, enemyScore: 0, playerAlive: true, playerHp: 100 });
  while (t < team || en < enemy) {
    if (t < team) t++; else en++;
    for (let i = 0; i < 2; i++) read(e, 45, { phase: 'buy', clock: '0:20', teamScore: t, enemyScore: en, playerAlive: true, playerHp: 100 });
    read(e, 45, { phase: 'active', clock: '1:10', teamScore: t, enemyScore: en, playerAlive: true, playerHp: 100 });
  }
}

(async () => {
  // ── One round forward needs a second read ───────────────────────────────
  {
    const e = engine();
    playTo(e, 12, 10);
    ok(score(e) === '12-10', `the match reached 12-10 (${score(e)})`);
    read(e, 30, { phase: 'active', clock: '0:55', teamScore: 13, enemyScore: 10, playerAlive: true, playerHp: 100 });
    ok(score(e) === '12-10', `one read of 13-10 is not believed yet (${score(e)})`);
    read(e, 2, { phase: 'active', clock: '0:53', teamScore: 12, enemyScore: 10, playerAlive: true, playerHp: 100 });
    ok(score(e) === '12-10' && !e.endWatch.pendingFinal, 'and the true read after it leaves nothing pending');
    for (let i = 0; i < 15; i++) read(e, 2, { phase: 'active', clock: '0:50', teamScore: 12, enemyScore: 10, playerAlive: true, playerHp: 100 });
    ok(!e.endWatch.ended && !e.ended.length, 'the match did not end in round 23');
  }

  // ── A misread repeated is taken back ─────────────────────────────────────
  {
    const e = engine();
    playTo(e, 5, 3);
    read(e, 30, { phase: 'active', clock: '0:40', teamScore: 6, enemyScore: 3, playerAlive: true, playerHp: 100 });
    read(e, 2, { phase: 'active', clock: '0:38', teamScore: 6, enemyScore: 3, playerAlive: true, playerHp: 100 });
    ok(score(e) === '6-3', `two agreeing reads of 6-3 are believed (${score(e)})`);
    let lines = [];
    for (let i = 0; i < 3; i++) lines = lines.concat(read(e, 2, { phase: 'active', clock: '0:36', teamScore: 5, enemyScore: 3, playerAlive: true, playerHp: 100 }));
    ok(score(e) === '5-3', `three reads of the score before it take the step back (${score(e)})`);
    ok(lines.some((l) => /was a misread/.test(l)), 'and say so in the log');
    read(e, 40, { phase: 'active', clock: '0:02', teamScore: 5, enemyScore: 4, playerAlive: true, playerHp: 100 });
    read(e, 2, { phase: 'active', clock: '0:01', teamScore: 5, enemyScore: 4, playerAlive: true, playerHp: 100 });
    ok(score(e) === '5-4', `the real next score is then accepted, not rejected as backwards (${score(e)})`);
  }
  {
    const e = engine();
    playTo(e, 5, 3);
    read(e, 30, { phase: 'active', clock: '0:40', teamScore: 6, enemyScore: 3, playerAlive: true, playerHp: 100 });
    read(e, 2, { phase: 'active', clock: '0:38', teamScore: 6, enemyScore: 3, playerAlive: true, playerHp: 100 });
    read(e, 20, { phase: 'buy', clock: '0:25', teamScore: 6, enemyScore: 3, playerAlive: true, playerHp: 100 });
    for (let i = 0; i < 4; i++) read(e, 2, { phase: 'buy', clock: '0:20', teamScore: 5, enemyScore: 3, playerAlive: true, playerHp: 100 });
    ok(score(e) === '6-3', `a step a buy phase has confirmed is never taken back (${score(e)})`);
  }

  // ── A lone digit faces the same guard ───────────────────────────────────
  {
    const e = engine();
    playTo(e, 12, 9);
    read(e, 30, { phase: 'active', clock: '0:50', teamScore: 13, playerAlive: true, playerHp: 100 });
    ok(score(e) === '12-9', `a lone 13 at 12-9 is not merged raw (${score(e)})`);
    read(e, 2, { phase: 'active', clock: '0:48', enemyScore: 1, playerAlive: true, playerHp: 100 });
    ok(score(e) === '12-9', `nor is a lone 1 that would drop 9 to 1 (${score(e)})`);
    ok(e.scoreReadThisFrame === false, 'and a lone digit does not count as a scoreboard read');
  }

  // ── A dead phase next to the player's own health ─────────────────────────
  {
    const e = engine();
    playTo(e, 3, 3);
    const before = e.lastDeathAt;
    read(e, 30, { phase: 'dead', clock: '1:00', teamScore: 3, enemyScore: 3, playerAlive: true, playerHp: 100,
      aliveTell: 'own HP 100 and Vandal bottom left' });
    ok(e.lastDeathAt === before, 'phase "dead" with own HP 100 and the own loadout registers no death');
  }

  // ── Nobody dies in a buy phase ───────────────────────────────────────────
  {
    const e = engine();
    playTo(e, 2, 1);
    read(e, 20, { phase: 'buy', clock: '0:26', teamScore: 2, enemyScore: 1, playerAlive: true, playerHp: 100 });
    const before = e.lastDeathAt;
    read(e, 2, { phase: 'dead', clock: '0:24', teamScore: 2, enemyScore: 1, playerAlive: false,
      aliveTell: 'COMBAT REPORT and KILLED BY Clove visible, no own HP number' });
    ok(e.lastDeathAt === before, "last round's combat report in the buy phase is not a death");
    read(e, 30, { phase: 'active', clock: '1:20', teamScore: 2, enemyScore: 1, playerAlive: true, playerHp: 100 });
    read(e, 5, { phase: 'dead', clock: '1:15', teamScore: 2, enemyScore: 1, playerAlive: false,
      aliveTell: 'Spectating teammate with SWITCH PLAYER bottom left' });
    ok(e.lastDeathAt !== before, 'and the real death in the round after it still registers');
  }

  // ── A new match the watch never saw the last one end ─────────────────────
  {
    const e = engine();
    playTo(e, 13, 12);   // unrated sudden death: not a final score, and no menus read
    ok(!e.endWatch.ended, 'an unrated 13-12 is not ended by its score');
    read(e, 120, { phase: 'buy', clock: '0:40', teamScore: 0, enemyScore: 0, map: 'Haven', playerAlive: true, playerHp: 100 });
    ok(!e.ended.length, 'one read of 0-0 does not close a live match');
    read(e, 2, { phase: 'buy', clock: '0:38', teamScore: 0, enemyScore: 0, map: 'Haven', playerAlive: true, playerHp: 100 });
    await new Promise((r) => setTimeout(r, 20));
    ok(e.ended.length === 1 && e.ended[0].endedBy === 'next-match',
      `two reads close the old match as a review of its own (${e.ended.map((s) => s.endedBy)})`);
    // 25 rounds scored and the 26th being played when the next match began.
    ok(e.ended[0] && e.ended[0].rounds.length === 26 && e.ended[0].rounds[25].n === 26,
      `with its own rounds and no phantom one from the 0-0 read (${e.ended[0] && e.ended[0].rounds.length})`);
    ok(e.ledger.size() === 1 && e.ledger.list()[0].n === 1, `and the new match starts at round 1 (${e.ledger.list().map((r) => r.n)})`);
  }

  // ── A final score read once, then the end screen ─────────────────────────
  // At a read a second the last round's banner is often read once before the
  // end screen, which reads as a menu. Found replaying the real 24 round Abyss
  // match: it ended 45 s later on the menu path at 12-11, with no result.
  {
    const e = engine();
    playTo(e, 12, 10);
    read(e, 30, { phase: 'active', clock: '0:20', teamScore: 13, enemyScore: 10, playerAlive: true, playerHp: 100 });
    for (let i = 0; i < 20 && !e.endWatch.ended; i++) menu(e, 3);
    await new Promise((r) => setTimeout(r, 20));
    const snap = e.ended[0];
    ok(snap && snap.endedBy === 'score' && snap.context.teamScore === 13 && snap.context.enemyScore === 10,
      `a final read once and then only menus ends the match on that score (${snap && snap.endedBy} ${snap && snap.context.teamScore}-${snap && snap.context.enemyScore})`);
    ok(snap && snap.rounds.find((r) => r.n === 23).result === 'won', 'and the last round gets its result');
  }
  {
    const e = engine();
    playTo(e, 12, 10);
    read(e, 30, { phase: 'active', clock: '0:20', teamScore: 13, enemyScore: 10, playerAlive: true, playerHp: 100 });
    console.log = () => {};
    e.stop();
    console.log = realLog;
    const snap = e.ended[0];
    ok(snap && snap.endedBy === 'score' && !snap.stoppedLive, 'Stop pressed on that banner is a score end too, and opens');
  }
  {
    const e = engine();
    playTo(e, 12, 10);
    read(e, 30, { phase: 'active', clock: '0:55', teamScore: 13, enemyScore: 10, playerAlive: true, playerHp: 100 });
    read(e, 2, { phase: 'active', clock: '0:53', teamScore: 12, enemyScore: 10, playerAlive: true, playerHp: 100 });
    for (let i = 0; i < 20 && !e.endWatch.ended; i++) menu(e, 3);
    await new Promise((r) => setTimeout(r, 20));
    ok(e.ended[0] && e.ended[0].endedBy === 'lobby',
      'a final read once and then contradicted is no final: an alt tab after it ends nothing on that score');
  }

  // ── A buy read inside a running round clock is the round ─────────────────
  {
    const e = engine();
    playTo(e, 3, 4);
    for (let left = 70; left >= 32; left -= 2) {
      read(e, 2, { phase: 'active', clock: `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`,
        teamScore: 3, enemyScore: 4, playerAlive: true, playerHp: 100 });
    }
    read(e, 2, { phase: 'buy', clock: '0:30', teamScore: 3, enemyScore: 4, playerAlive: true, playerHp: 100 });
    const before = e.lastDeathAt;
    read(e, 4, { phase: 'dead', clock: '0:26', teamScore: 3, enemyScore: 4, playerAlive: false,
      aliveTell: 'COMBAT REPORT visible with KILLED BY REYNA and no own health' });
    ok(e.lastDeathAt !== before, 'a "buy 0:30" two seconds after "active 0:32" does not hide the real death after it');
  }

  // ── A step misread on buy frames is still taken back ──────────────────────
  {
    const e = engine();
    playTo(e, 5, 3);
    read(e, 20, { phase: 'buy', clock: '0:24', teamScore: 6, enemyScore: 3, playerAlive: true, playerHp: 100 });
    read(e, 2, { phase: 'buy', clock: '0:22', teamScore: 6, enemyScore: 3, playerAlive: true, playerHp: 100 });
    ok(score(e) === '6-3' && e.lastStep && !e.lastStep.bought, 'the frames that accepted a step cannot confirm it');
    for (let i = 0; i < 3; i++) read(e, 2, { phase: 'buy', clock: '0:18', teamScore: 5, enemyScore: 3, playerAlive: true, playerHp: 100 });
    ok(score(e) === '5-3', `so a misread pair on buy frames is taken back too (${score(e)})`);
  }

  // ── The review is announced before the narrative is written ──────────────
  {
    const e = engine();
    playTo(e, 4, 3);
    e.stop();
    ok(e.ended.length === 1 && e.reviews.length === 0, 'match-ended fires at once, before the narrative call returns');
    await new Promise((r) => setTimeout(r, 20));
    ok(e.reviews.length === 1 && e.reviews[0].startedAt === e.ended[0].startedAt, 'and match-review follows for the same match');
    ok(e.ended[0].stoppedLive === true, 'a stop with a round on screen is marked as stopped mid match');
  }

  Date.now = realNow;
  console.log(`\n${fails ? fails + ' of ' + checks + ' failed' : 'all ' + checks + ' score guard checks passed'}`);
  process.exit(fails ? 1 : 0);
})();
