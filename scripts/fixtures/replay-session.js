'use strict';

/**
 * A logged session replayed through the REAL reader (coaching-engine.js), read
 * by read on the clock it was recorded on, as test-session-replay.js does, and
 * its frames kept as the AI log keeps them (index.js recordAiFrame): { at,
 * frame, state, round, died, match }, the round the ledger filed each under.
 * With Riot's record of the match laid over the ledger, as the live link does.
 *
 * replay-match.js is the simpler replay, its ledger fed three guards by hand.
 * This one is what the app runs, and so where a frame the model misread (a
 * buy timer read as the round clock, at a read a second) reaches the death
 * frame picker and the clip cut from what it picked.
 *
 * Used by test-clips.js and test-forensics.js.
 */

const path = require('path');
const Module = require('module');

const REPO = path.join(__dirname, '..', '..');
// The wall clock the session is replayed on: its frame t seconds in is T0 + t s.
const T0 = Date.parse('2026-10-04T20:00:00Z');

/** The real reader, its network replaced: no read leaves the process. */
function engineClass() {
  const realLoad = Module._load;
  Module._load = function patched(request, parent, isMain) {
    if (request === './api-client') {
      return { post: async () => ({ ok: false, status: 0, data: null }), get: async () => ({ ok: false, status: 0, data: null }) };
    }
    return realLoad(request, parent, isMain);
  };
  try {
    return require(path.join(REPO, 'src', 'main', 'services', 'coaching-engine.js'));
  } finally {
    Module._load = realLoad;
  }
}

/**
 * @param file  a session in scripts/fixtures: { frames: [{ t, ...the read's context }] }
 * @param riot  Riot's record of its match, or null for the screen's ledger alone
 * @returns { t0, records, rounds, window, at }
 *   records  every frame read in a match, as the AI log keeps it
 *   rounds   the ledger's rounds, reconciled with `riot` when it is given
 *   window   { from, to }, the match's wall clock bounds as its review's snap has them
 *   at(t)    the wall clock of the frame t seconds into the session
 */
function replaySession(file, riot) {
  const CoachingEngine = engineClass();
  const verify = require(path.join(REPO, 'src', 'shared', 'valorant-verify'));
  const frames = require(path.join(__dirname, file)).frames;
  const records = [];
  let clock = T0;
  const realNow = Date.now;
  const realLog = console.log;
  Date.now = () => clock;
  console.log = () => {};
  try {
    const e = new CoachingEngine({
      licenseKey: 'TEST', captureFunction: async () => null, experiments: () => ({}),
      diagnostics: (d) => {
        const i = records.length;
        records.push({ i, at: d.at, frame: `frame-${String(i).padStart(5, '0')}.jpg`, state: d.state || {},
          round: typeof d.round === 'number' ? d.round : null, died: !!d.died, match: d.match || null });
      },
    });
    e.isRunning = true;
    for (const f of frames) {
      clock = T0 + f.t * 1000;
      const { t, ...context } = f;
      e.applyRead({ data: { context: { ...context } }, shot: null, at: clock });
    }
    const ledger = e.ledger.list();
    return {
      t0: T0,
      records,
      rounds: riot ? verify.reconcile(ledger, riot).rounds : ledger,
      window: { from: e.matchStartedAt, to: clock },
      at: (t) => T0 + t * 1000,
    };
  } finally {
    Date.now = realNow;
    console.log = realLog;
  }
}

module.exports = { replaySession, T0 };
