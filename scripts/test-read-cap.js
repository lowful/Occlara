'use strict';

/**
 * No games left mid match is silent (8.7): the server's 402 { error: 'cap' }
 * on /read stops the engine's reads for the match, with no notice and no
 * failed read counted, while the recording goes on; one read every five
 * minutes asks whether there are games again; a read the server takes again
 * resumes; the review a capped match ends with asks the model nothing; and
 * the AI's own 402 (out of credits) keeps its old rule. The real engine, the
 * network and the clock stood in for. No guard is touched by any of it.
 *
 * Run: npm run test:readcap
 */

const path = require('path');
const Module = require('module');

let fails = 0;
let checks = 0;
const ok = (cond, what, detail) => {
  checks++;
  if (!cond) { fails++; console.log(`FAIL  ${what}${detail ? `\n      ${detail}` : ''}`); } else console.log(`ok    ${what}`);
};

let clock = Date.parse('2026-11-04T12:00:00Z');
const realNow = Date.now;
Date.now = () => clock;

let answer = null;
const posts = [];
const realLoad = Module._load;
Module._load = function patched(request, parent, isMain) {
  if (request === './api-client') {
    return {
      post: async (p, body) => { posts.push({ p, at: clock }); return answer(p, body); },
      get: async () => ({ ok: false, status: 0, data: {} }),
    };
  }
  return realLoad(request, parent, isMain);
};
const CoachingEngine = require(path.join(__dirname, '..', 'src', 'main', 'services', 'coaching-engine.js'));
Module._load = realLoad;
const { API } = require(path.join(__dirname, '..', 'src', 'shared', 'config.js'));

const flush = () => new Promise((r) => setImmediate(r));
// A round being played, read every gap: nothing in it moves a guard.
const PLAY = { ok: true, status: 200, data: { lobby: false, context: { phase: 'active', playerAlive: true, playerHp: 100,
  teamScore: 0, enemyScore: 0, roundNumber: 1, side: 'attacking', clock: '1:20' } } };
const CAP = { ok: false, status: 402, data: { error: 'cap', left: 0 } };
const CREDITS = { ok: false, status: 402, data: { error: 'Payment Required' } };

function engine() {
  const e = new CoachingEngine({ licenseKey: 'TEST', captureSpeed: 1000, experiments: () => ({}),
    captureFunction: async () => 'frame' });
  e.isRunning = true;
  const seen = { notices: [], ended: [], reviewed: [] };
  e.on('notice', (n) => seen.notices.push(n));
  e.on('match-ended', (s) => seen.ended.push(s));
  e.on('match-review', (text, s) => seen.reviewed.push({ text, s }));
  return { e, seen };
}

/** Heartbeats for `ms`, each one letting the reads it sends finish. */
async function run(e, ms) {
  const end = clock + ms;
  while (clock < end) {
    clock += 200;
    e.tick();
    await flush(); await flush(); await flush();
  }
}

const reads = () => posts.filter((x) => x.p === API.READ).length;

async function main() {
  console.log('\n[readcap] the cap stops the reads, silently');
  {
    posts.length = 0;
    answer = () => PLAY;
    const { e, seen } = engine();
    await run(e, 3000);
    const before = reads();
    ok(before >= 2 && !e.capped, 'reads go out while the account has games', `reads ${before}`);
    answer = (p) => (p === API.READ ? CAP : PLAY);
    await run(e, 2000);
    const atCap = reads();
    ok(!!e.capped, 'the server\'s 402 cap marks the engine capped');
    await run(e, 60 * 1000);
    ok(reads() === atCap, 'and no read goes out for the next minute', `reads ${atCap} then ${reads()}`);
    ok(seen.notices.length === 0, 'nothing is said: no notice of any kind', JSON.stringify(seen.notices));
    ok(e.failStreak === 0 && !e.warnedFailure && !e.aiCreditsOutAt, 'and no failed read is counted, nor out of credits');
    await run(e, 4 * 60 * 1000);
    ok(reads() === atCap + 1, 'five minutes on, one read asks whether there are games again', `reads ${reads()}`);
    ok(!!e.capped && seen.notices.length === 0, 'refused again, still capped and still silent');
    answer = () => PLAY;
    await run(e, 5 * 60 * 1000 + 2000);
    ok(!e.capped && reads() > atCap + 2, 'a read the server takes again resumes reading', `reads ${reads()}`);
    ok(seen.notices.length === 0, 'and nothing was said through any of it');
  }

  console.log('\n[readcap] the review of a capped match asks the model nothing');
  {
    posts.length = 0;
    answer = () => ({ ok: true, status: 200, data: { review: 'x' } });
    const { e, seen } = engine();
    await e.requestMatchReview({ endedBy: 'stop', rounds: [{ n: 1 }], context: {}, startedAt: clock - 1000, endedAt: clock, capped: true });
    ok(seen.ended.length === 1 && seen.ended[0].capped === true, 'the match is ended and handed over capped, for main to save locked');
    ok(seen.reviewed.length === 1 && seen.reviewed[0].text === null && seen.reviewed[0].s.ai === null, 'its review arrives with no narrative');
    ok(!posts.some((x) => x.p === API.MATCH_REVIEW), 'and /match-review is never called', JSON.stringify(posts));
    answer = () => CAP;
    const snap = { endedBy: 'stop', rounds: [{ n: 1 }], context: {}, startedAt: clock - 1000, endedAt: clock };
    await e.requestMatchReview(snap);
    ok(posts.some((x) => x.p === API.MATCH_REVIEW) && seen.reviewed[1] && seen.reviewed[1].s.capped === true,
      'a /match-review the server refuses for the cap hands the match over capped');
    e.capped = { at: clock };
    e.ledger.list = () => [{ n: 1 }];
    const s = e.matchSnapshot('stop');
    ok(s && s.capped === true, 'a snapshot taken while capped says so');
    e.capped = null;
    ok(!('capped' in e.matchSnapshot('stop')), 'and one taken while reading carries no such key');
  }

  console.log('\n[readcap] the AI out of credits keeps its own rule');
  {
    posts.length = 0;
    answer = (p) => (p === API.READ ? CREDITS : PLAY);
    const { e } = engine();
    await run(e, 3000);
    ok(!e.capped && e.aiCreditsOutAt > 0, 'a 402 that is no cap is the AI out of credits, as before');
  }

  console.log('\n[readcap] the start clears it');
  {
    const { e } = engine();
    e.isRunning = false;
    e.capped = { at: clock };
    e.start();
    ok(e.capped === null, 'a new session starts reading');
    e.stop();
  }

  Date.now = realNow;
  console.log(`\n${fails ? 'FAIL' : 'all'} ${checks - fails} of ${checks} read cap checks passed`);
  process.exit(fails ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
