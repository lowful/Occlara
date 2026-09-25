'use strict';

/**
 * The engine's side of the post-match review: a match ends ONCE, its review is
 * requested with the rounds the ledger recorded, and the next match starts
 * clean, agent included.
 *
 * The real CoachingEngine runs here with the network replaced, driven frame by
 * frame through recordFrame the way captureAndAnalyze drives it, so the order
 * of end, reset and review is exercised rather than described.
 *
 * Also asserts the switch itself, because every surface reads it and a typo in
 * one place would leave that surface showing live tips.
 *
 * Run: npm run test:matchlifecycle
 */

const path = require('path');
const Module = require('module');

let fails = 0;
let checks = 0;
const ok = (cond, what) => {
  checks++;
  if (!cond) { fails++; console.log(`FAIL  ${what}`); } else console.log(`ok    ${what}`);
};

const posted = [];
let failNext = false;
const realLoad = Module._load;
Module._load = function patched(request, parent, isMain) {
  if (request === './api-client') {
    return {
      post: async (p, body) => {
        posted.push({ path: p, body });
        if (failNext) { failNext = false; return { ok: false, status: 502, data: null }; }
        return { ok: true, status: 200, data: { review: 'A summary.', summary: 'A summary.', rounds: {}, focus: 'Wait.', study: [] } };
      },
      get: async () => ({ ok: false }),
    };
  }
  return realLoad(request, parent, isMain);
};
const { CoachingEngine } = (() => {
  const m = require(path.join(__dirname, '..', 'src', 'main', 'services', 'coaching-engine.js'));
  return { CoachingEngine: m.CoachingEngine || m };
})();
Module._load = realLoad;

const games = require('../src/shared/games');

function engine() {
  const e = new CoachingEngine({ licenseKey: 'TEST', captureFunction: async () => null, experiments: () => ({}) });
  e.isRunning = true;   // as if started, without the timers start() arms
  return e;
}

function frame(e, { team, enemy, phase = 'active', clock = '1:10', died = false, side = 'defending' }) {
  Object.assign(e.matchContext, { teamScore: team, enemyScore: enemy, phase, clock, side, gameMode: 'standard' });
  e.inLobby = false;
  e.recordFrame({ lobby: false, died });
}

function menu(e) {
  e.inLobby = true;
  e.recordFrame({ lobby: true, died: false });
}

(async () => {
  // ── The switch ────────────────────────────────────────────────────────────
  ok(games.liveTipsClosed('valorant') === true, 'live tips are closed for Valorant');
  ok(games.liveTipsClosed('rivals') === false && games.liveTipsClosed('lol') === false,
    'and only for Valorant, the switch is not global');
  ok(games.LIVE_TIPS_CLOSED_LABEL === 'Live Tips are temporarily closed', 'every surface gets the same words');

  // ── A match that ends on its score ─────────────────────────────────────────
  {
    posted.length = 0;
    const e = engine();
    const reviews = [];
    e.on('match-review', (text, snap) => reviews.push(snap));
    e.matchContext.agent = 'Jett';
    e.matchContext.agentConfirmed = true;
    frame(e, { team: 11, enemy: 9, phase: 'buy' });
    frame(e, { team: 11, enemy: 9, died: true, clock: '1:20' });
    frame(e, { team: 12, enemy: 9, phase: 'buy' });
    frame(e, { team: 12, enemy: 9 });
    frame(e, { team: 13, enemy: 9, phase: 'active', clock: '0:02' });   // the final score, read once
    ok(!reviews.length && !e.endWatch.ended, 'one final read does not end the match');
    menu(e);                                                              // confirmed by the menu
    await new Promise((r) => setTimeout(r, 20));
    ok(reviews.length === 1, 'the menu after it ends the match and requests one review');
    const snap = reviews[0];
    ok(snap && snap.endedBy === 'score', 'ended by its score');
    ok(snap && snap.rounds.map((r) => r.n).join(',') === '21,22', `with the rounds the ledger saw (${snap && snap.rounds.map((r) => r.n)})`);
    ok(snap && snap.rounds[0].died && snap.rounds[0].result === 'won', 'round 21 carries its death and its win');
    ok(snap && snap.context.agent === 'Jett', 'the snapshot keeps the agent it was played on');
    ok(e.matchContext.agent === null, 'and the engine forgets it for the next match');
    ok(posted.length === 1 && Array.isArray(posted[0].body.rounds), 'the server is sent the ledger');

    // The end screen still shows 13 to 9 and a HUD. It is not a new match.
    frame(e, { team: 13, enemy: 9 });
    menu(e); menu(e); menu(e);
    await new Promise((r) => setTimeout(r, 20));
    ok(reviews.length === 1, 'the end screen and the menus after it do not review the match again');
    ok(e.ledger.size() === 0, 'and nothing from the end screen is recorded');

    // Next match.
    frame(e, { team: 0, enemy: 0, phase: 'buy' });
    ok(!e.endWatch.ended && e.ledger.size() === 1, 'a 0 to 0 frame starts recording the next match');

    // Stopping mid way reviews only what this match recorded.
    frame(e, { team: 0, enemy: 1, phase: 'buy' });
    e.stop();
    await new Promise((r) => setTimeout(r, 20));
    ok(reviews.length === 2 && reviews[1].endedBy === 'stop', 'stopping mid match reviews the rounds so far');
    ok(reviews[1].rounds.every((r) => r.n <= 2), 'and none of the previous match');
  }

  // ── Stop after the watch already ended the match ──────────────────────────
  {
    const e = engine();
    const reviews = [];
    e.on('match-review', (text, snap) => reviews.push(snap));
    frame(e, { team: 12, enemy: 11 });
    frame(e, { team: 13, enemy: 11 });
    frame(e, { team: 13, enemy: 11 });
    await new Promise((r) => setTimeout(r, 20));
    // The model keeps writing on the end screen. Without the guard in stop(),
    // three of those are enough to review a "match" of nothing but end screen.
    for (let i = 0; i < 3; i++) e.tipHistory.push({ text: `End screen tip ${i}.`, source: 'ai', time: Date.now() });
    e.stop();
    await new Promise((r) => setTimeout(r, 20));
    ok(reviews.length === 1, 'stopping after the match ended does not review it twice');
  }

  // ── The server being down never costs the player the review ───────────────
  {
    failNext = true;
    const e = engine();
    const reviews = [];
    e.on('match-review', (text, snap) => reviews.push({ text, snap }));
    frame(e, { team: 3, enemy: 2, phase: 'buy' });
    frame(e, { team: 3, enemy: 2, died: true });
    e.stop();
    await new Promise((r) => setTimeout(r, 20));
    ok(reviews.length === 1 && reviews[0].text === null && reviews[0].snap.ai === null,
      'a failed review call still emits, with no narrative');
    ok(reviews[0] && reviews[0].snap.rounds.length === 1, 'and the computed rounds intact');
  }

  console.log(`\n${fails ? fails + ' of ' + checks + ' failed' : 'all ' + checks + ' match lifecycle checks passed'}`);
  process.exit(fails ? 1 : 0);
})();
