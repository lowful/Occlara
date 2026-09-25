'use strict';

/**
 * Replay a logged match through the round ledger and the match-end watch.
 *
 * The AI decision log stores the model's RAW read of each frame, and the
 * ledger in production is fed the engine's GUARDED context instead. So this
 * applies the three guards that decide rounds, in the simplest form that holds
 * on the real fixtures: a score never moves backwards, a buy phase means the
 * player is alive, and a death needs a fresh alive to dead edge twenty seconds
 * after the last one. Anything subtler stays in coaching-engine.js, which is
 * what the live feed runs through.
 *
 * Used by test-valorant-review.js and by the review bench, so the bench sends
 * the server exactly the ledger the test has already checked.
 */

const path = require('path');
const { RoundLedger } = require('../../src/shared/valorant-rounds');
const { MatchEndWatch } = require('../../src/shared/match-end');

function load(name) {
  return require(path.join(__dirname, name));
}

/**
 * @param frames  fixture frames ({ t, phase, teamScore, ... , shown })
 * @param mode    'standard' | 'swiftplay' | null, as the engine would have locked it
 * @returns { rounds, context, endedBy, events }
 */
function replay(frames, mode) {
  const ledger = new RoundLedger();
  const watch = new MatchEndWatch();
  const events = [];
  let team = 0;
  let enemy = 0;
  let prevAlive = true;
  let lastDeath = -1e9;
  let map = null;
  let endedBy = null;
  let finalScore = null;

  for (const f of frames) {
    const at = f.t * 1000;
    if (typeof f.teamScore === 'number' && typeof f.enemyScore === 'number'
        && f.teamScore >= team && f.enemyScore >= enemy) {
      team = f.teamScore;
      enemy = f.enemyScore;
    }
    if (f.map) map = map || f.map;
    const alive = f.phase === 'buy' ? true : f.playerAlive;
    const died = alive === false && prevAlive !== false && at - lastDeath > 20000;
    if (died) lastDeath = at;
    prevAlive = alive;

    const w = watch.play({ team, enemy, mode, at });
    if (w) events.push({ at: f.t, ...w, score: `${team}-${enemy}` });
    if (w && w.kind === 'end') { endedBy = w.reason; finalScore = { team, enemy }; }
    if (w && (w.kind === 'ignore' || w.kind === 'end')) continue;

    ledger.observe({
      at, team, enemy, side: f.side, phase: f.phase, alive, died,
      deathSpot: f.locLabel || f.playerSpot, clock: f.clock, ult: f.ult,
      spike: f.spike, spikeSpot: f.spikeSpot, loc: f.locLabel || f.playerSpot,
      tip: f.shown ? { text: f.shown.text, source: 'ai', death: f.shown.death } : null,
    });
  }
  // The log stops when the player pressed stop; in the app the next frames are
  // menus, which is what confirms a final score read once.
  if (!endedBy) {
    const last = frames.length ? frames[frames.length - 1].t * 1000 : 0;
    const w = watch.lobby({ at: last + 10000, rounds: ledger.size() });
    if (w) events.push({ at: 'menu', ...w, score: `${team}-${enemy}` });
    if (w && w.kind === 'end') { endedBy = w.reason; finalScore = { team, enemy }; }
  }
  const lastRound = finalScore ? finalScore.team + finalScore.enemy : null;
  return {
    rounds: ledger.list(lastRound),
    context: { teamScore: team, enemyScore: enemy, map, gameMode: mode },
    endedBy: endedBy || 'stop',
    events,
  };
}

module.exports = { replay, load };
