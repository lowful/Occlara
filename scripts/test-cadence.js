'use strict';

/**
 * The read cadence, through the real engine, on a fake clock.
 *
 * AUTO RAN AT TWO SECONDS FALLING TO THREE on real sessions. Two reads in
 * flight held a read a second only while the p90 latency stayed under 2.2
 * seconds, and one hung read held every reply behind it for the client's 30
 * second timeout, though the server gives up on a read at 9. Here the 200ms
 * heartbeat is driven by hand, tick() by tick(), against a fake server whose
 * replies come back out of order, and the engine is held to:
 *
 *   replies applied in capture order, however they come back
 *   at most four reads out, and two before any latency is measured
 *   a read a second held at p90 3s and 4.3s, stepped down at 4.6s, and back
 *     up once p90 falls under 2.8s
 *   three failed reads in a row step it down, two do not
 *   a 429 steps it down once and stops sending for ten seconds
 *   a pinned speed is never stepped, and still waits out a 429
 *   a read gives up at 12 seconds, agent detection still waits 30
 *   the capture helper's time logged as a p50 and a p90
 *
 * Run: npm run test:cadence
 */

const path = require('path');
const Module = require('module');

let fails = 0;
let checks = 0;
const ok = (cond, what) => {
  checks++;
  if (!cond) { fails++; console.log(`FAIL  ${what}`); } else console.log(`ok    ${what}`);
};

// ── The clock ───────────────────────────────────────────────────────────────
// Every guard and every timing in the engine reads Date.now(), so the whole
// run is on this one, moved only by run() below.
const realNow = Date.now;
let clock = Date.parse('2026-10-10T12:00:00Z');
Date.now = () => clock;

// The scenario running now. The fake server and the fake capture answer
// through it, so each scenario starts from nothing.
let sim = null;

// ── The network, replaced ───────────────────────────────────────────────────
const realLoad = Module._load;
Module._load = function patched(request, parent, isMain) {
  if (request === './api-client') {
    return {
      post: (p, body, key, timeoutMs) => sim.post(p, body, timeoutMs),
      get: async () => ({ ok: false, status: 0, data: {} }),
    };
  }
  return realLoad(request, parent, isMain);
};
const CoachingEngine = require(path.join(__dirname, '..', 'src', 'main', 'services', 'coaching-engine.js'));
Module._load = realLoad;
const { API } = require(path.join(__dirname, '..', 'src', 'shared', 'config.js'));

// What every answered read says: a round being played, with nothing in it that
// moves a guard. The cadence is under test here, not the reading.
const READ = { phase: 'active', playerAlive: true, playerHp: 100, teamScore: 0, enemyScore: 0,
  roundNumber: 1, side: 'attacking', clock: '1:20' };

/**
 * A fresh engine before a fake server. `plan(n)` gives the n-th read sent its
 * latency and status, Infinity for one the server never answers; `capture(k)`
 * gives the k-th capture its time.
 */
function scenario({ plan, capture = () => 100, speed = 'auto' }) {
  const s = {
    events: [], eventN: 0, lastTick: clock - 200,
    reads: [], other: [], answered: [], sends: [], applied: [], cadence: [], notices: [], lines: [],
    out: 0, maxOut: 0, maxInFlight: 0, maxUnmeasured: 0, measured: false,
    later(ms, fn) { this.events.push({ at: clock + ms, fn, n: this.eventN++ }); },
    post(p, body, timeoutMs) {
      if (p !== API.READ) {
        this.other.push({ path: p, at: clock, timeoutMs });
        const data = p === API.DETECT_AGENT ? { agent: 'jett' } : {};
        return new Promise((resolve) => this.later(300, () => resolve({ ok: true, status: 200, data })));
      }
      const n = this.reads.length;
      const { ms, status = 200 } = plan(n);
      this.reads.push({ n, at: clock, timeoutMs, status });
      this.out++;
      this.maxOut = Math.max(this.maxOut, this.out);
      return new Promise((resolve, reject) => {
        // Unanswered by its own timeout, the real client aborts and fetch throws.
        if (!(ms <= timeoutMs)) {
          this.later(timeoutMs, () => { this.out--; reject(new Error('This operation was aborted')); });
          return;
        }
        this.later(ms, () => {
          this.out--;
          this.answered.push(n);
          resolve(status === 200
            ? { ok: true, status, data: { lobby: false, context: { ...READ } } }
            : { ok: false, status, data: { error: 'refused' } });
        });
      });
    },
  };
  s.engine = new CoachingEngine({
    licenseKey: 'TEST', captureSpeed: speed, experiments: () => ({}),
    captureFunction: () => new Promise((resolve) => {
      const k = s.sends.length;
      s.sends.push(clock);
      s.later(capture(k), () => resolve(`frame-${k}`));
    }),
    // The AI log's sink, which sees every read at the moment it is applied.
    diagnostics: (rec) => s.applied.push({ k: Number(String(rec.image).slice(6)), at: clock }),
  });
  // Running without start(): its heartbeat is a real setInterval, and the
  // heartbeat here is run().
  s.engine.isRunning = true;
  s.engine.on('cadence', (ms) => s.cadence.push({ ms, at: clock }));
  s.engine.on('notice', (x) => s.notices.push(x));
  sim = s;
  return s;
}

/** Let every continuation the last event or tick started run to its end. */
const flush = () => new Promise((r) => setImmediate(r));

function watch(s) {
  const e = s.engine;
  s.maxInFlight = Math.max(s.maxInFlight, e.inFlight);
  if (e.latencies.length) s.measured = true;
  if (!s.measured) s.maxUnmeasured = Math.max(s.maxUnmeasured, e.inFlight);
}

/** The heartbeat for `ms` of fake time: whatever falls due, then the tick. */
async function run(s, ms) {
  const end = clock + ms;
  const log = console.log;
  const err = console.error;
  console.log = (...a) => { s.lines.push(a.join(' ')); };
  console.error = (...a) => { s.lines.push(a.join(' ')); };
  try {
    while (clock < end) {
      const next = s.events.reduce((m, ev) => Math.min(m, ev.at), Infinity);
      clock = Math.min(s.lastTick + 200, next, end);
      for (;;) {
        const due = s.events.filter((ev) => ev.at <= clock).sort((a, b) => a.at - b.at || a.n - b.n)[0];
        if (!due) break;
        s.events.splice(s.events.indexOf(due), 1);
        due.fn();
        await flush();
        watch(s);
      }
      if (clock >= s.lastTick + 200) {
        s.lastTick = clock;
        s.engine.tick();
        await flush();
        watch(s);
      }
    }
  } finally {
    console.log = log;
    console.error = err;
  }
}

const inOrder = (list) => list.every((k, i) => i === 0 || k > list[i - 1]);

(async () => {
  // ── Out of order, and a read a second held at p90 3 seconds ──────────────
  {
    // Three slow reads in a row, then quick ones: the quick ones come back
    // before the slow ones sent ahead of them, and four are out at once.
    const LAT = [3000, 2900, 2500, 600, 700, 800, 900, 1000, 1100, 3000];
    const CAP = [80, 90, 100, 110, 400];
    const s = scenario({ plan: (n) => ({ ms: LAT[n % LAT.length] }), capture: (k) => CAP[k % CAP.length] });
    await run(s, 180000);
    const e = s.engine;
    const order = s.applied.map((a) => a.k);
    ok(order.length > 150 && order.every((k, i) => k === i),
      `every reply is applied in capture order (${order.length} applied, first out of place at ${order.findIndex((k, i) => k !== i)})`);
    const early = s.answered.filter((n, i) => i > 0 && n < s.answered[i - 1]).length;
    ok(early > 10, `though the server answered ${early} of them before one sent ahead of it`);
    ok(s.maxUnmeasured === 2, `two reads out before any latency is measured (${s.maxUnmeasured})`);
    ok(s.maxInFlight === 4 && s.maxOut <= 4, `then up to four, never more (engine ${s.maxInFlight}, server ${s.maxOut})`);
    ok(e.inFlightLimit() === 4, `four allowed at p90 3s and a gap of a second (${e.inFlightLimit()})`);
    ok(!s.cadence.length && e.gapMs === 1000, `auto holds a read a second at p90 3s (${JSON.stringify(s.cadence)})`);
    const lastMinute = s.sends.filter((t) => t >= clock - 60000).length;
    ok(lastMinute >= 59, `and reads every second of the last minute (${lastMinute} sent)`);
    const capLine = s.lines.find((l) => /\[engine\] capture p50/.test(l));
    ok(!!capLine && /capture p50 100ms, p90 400ms over the last 60 frames/.test(capLine),
      `the capture helper's time is logged as a p50 and a p90 (${capLine})`);
    ok(!!capLine && /reading every 1000ms, up to 4 in flight, read p90 3000ms/.test(capLine),
      'beside the cadence and the read latency it ran at');
  }

  // ── Held at 4.3 seconds, stepped down at 4.6, back up under 2.8 ──────────
  {
    // Four slow reads in a row: a fifth would be due while all four are out,
    // so the limit, not the gap, decides when it goes.
    let slow = 4300;
    let quick = false;
    const s = scenario({ plan: (n) => ({ ms: quick ? 1000 : n % 10 < 4 ? slow : 900 }) });
    await run(s, 90000);
    ok(!s.cadence.length && s.engine.gapMs === 1000, `a read a second still held at p90 4.3s (${JSON.stringify(s.cadence)})`);
    const held = s.sends.filter((t, i) => i > 0 && t - s.sends[i - 1] > 1000).length;
    ok(s.maxInFlight === 4 && s.maxOut <= 4 && held > 0,
      `four out at most, though that p90 asks for six: ${held} sends waited for a slot (most out ${s.maxInFlight})`);
    slow = 4600;
    await run(s, 60000);
    ok(s.cadence.length === 1 && s.cadence[0].ms === 2000
      && s.lines.some((l) => /read cadence 1000ms -> 2000ms \(p90 4600ms\)/.test(l)),
      `stepped down to two seconds past 4.4s (${JSON.stringify(s.cadence)})`);
    await run(s, 60000);
    ok(s.cadence.length === 1 && s.engine.gapMs === 2000, `and held there at p90 4.6s (${JSON.stringify(s.cadence)})`);
    quick = true;
    await run(s, 90000);
    ok(s.cadence.length === 2 && s.cadence[1].ms === 1000
      && s.lines.some((l) => /read cadence 2000ms -> 1000ms \(p90 1000ms\)/.test(l)),
      `back to a second once p90 falls under 2.8s (${JSON.stringify(s.cadence)})`);
    ok(s.maxInFlight <= 4 && s.maxOut <= 4, `never more than four out on the way (${s.maxInFlight})`);
  }

  // ── Three failed reads in a row step it down, two do not ─────────────────
  {
    const FAIL = new Set([10, 11, 13, 14, 30, 31, 32]);
    const s = scenario({ plan: (n) => ({ ms: 500, status: FAIL.has(n) ? 503 : 200 }) });
    await run(s, 29000);
    ok(s.reads.length >= 25 && !s.cadence.length,
      `two failed reads, an answer and two more do not step it (${JSON.stringify(s.cadence)})`);
    await run(s, 10000);
    ok(s.cadence.length === 1 && s.cadence[0].ms === 2000
      && s.lines.some((l) => /read cadence 1000ms -> 2000ms \(reads failing\)/.test(l)),
      `three in a row do (${JSON.stringify(s.cadence)})`);
    const order = s.applied.map((a) => a.k);
    ok(!order.some((k) => FAIL.has(k)) && inOrder(order), 'the failed reads are skipped and the rest applied in order');
    await run(s, 60000);
    ok(s.cadence.length === 2 && s.cadence[1].ms === 1000,
      `and back to a second once reads answer again (${JSON.stringify(s.cadence)})`);
  }

  // ── A 429 steps it down once and stops sending for ten seconds ───────────
  {
    // Three reads out together, all refused: one refusal, said three times.
    const LIMITED = new Set([20, 21, 22]);
    const s = scenario({ plan: (n) => ({ ms: 2500, status: LIMITED.has(n) ? 429 : 200 }) });
    await run(s, 40000);
    const refused = s.reads.filter((r) => LIMITED.has(r.n));
    const first = refused.length ? refused[0].at + 2500 : 0;
    const last = refused.length ? refused[refused.length - 1].at + 2500 : 0;
    ok(refused.length === 3 && refused[2].at < first, 'three reads were out together when the first was refused');
    ok(s.cadence.length === 1 && s.cadence[0].ms === 2000
      && s.lines.some((l) => /read cadence 1000ms -> 2000ms \(the server is limiting reads\)/.test(l)),
      `one step down for the three of them (${JSON.stringify(s.cadence)})`);
    const during = s.sends.filter((t) => t > first && t < last + 10000);
    ok(!during.length, `nothing is sent until ten seconds after the last refusal (${during.map((t) => t - first)})`);
    const resumed = s.sends.find((t) => t >= last + 10000);
    ok(resumed !== undefined && resumed - (last + 10000) <= 200,
      `then sending resumes (${resumed === undefined ? 'never' : `${resumed - last}ms after the last refusal`})`);
    const said = s.notices.filter((x) => x && x.text).map((x) => x.text);
    ok(said.length > 0 && said.every((t) => /limiting reads/.test(t) && !/Cannot reach/.test(t)),
      `the panel says the server is limiting reads, never that it is out of reach (${JSON.stringify(said)})`);
    await run(s, 60000);
    ok(s.cadence.length === 2 && s.cadence[1].ms === 1000,
      `and recovers once the server answers again (${JSON.stringify(s.cadence)})`);
  }

  // ── A pinned speed is never stepped, and still waits out a 429 ───────────
  {
    const s = scenario({ speed: 1000, plan: (n) => ({ ms: n >= 10 && n < 40 ? 4600 : 600, status: n === 45 ? 429 : 200 }) });
    await run(s, 90000);
    ok(!s.cadence.length && s.engine.gapMs === 1000,
      `a pinned second stays a second at p90 4.6s and through a 429 (${JSON.stringify(s.cadence)})`);
    const refused = s.reads.find((r) => r.n === 45);
    const at = refused ? refused.at + 600 : 0;
    const during = s.sends.filter((t) => t > at && t < at + 10000);
    ok(!!refused && !during.length && s.sends.some((t) => t >= at + 10000),
      `and sends nothing for the ten seconds after the 429 (${during.length} sent)`);
  }

  // ── A read the server never answers gives up at 12 seconds ───────────────
  {
    const s = scenario({ plan: (n) => ({ ms: n === 10 ? Infinity : 500 }) });
    await run(s, 40000);
    const waits = [...new Set(s.reads.map((r) => r.timeoutMs))];
    ok(waits.length === 1 && waits[0] === 12000, `every read waits 12 seconds at most (${waits})`);
    const hung = s.reads[10];
    const next = s.applied.find((a) => a.k === 11);
    ok(!!hung && !!next && next.at === hung.at + 12000,
      `the replies behind a hung read wait 12 seconds for it, not 30 (${hung && next ? next.at - hung.at : '?'}ms)`);
    const order = s.applied.map((a) => a.k);
    ok(!order.includes(10) && inOrder(order), 'and are applied in order once it gives up');
    const held = hung ? s.applied.filter((a) => a.at === hung.at + 12000).length : 0;
    ok(held >= 10, `all at once (${held})`);
    const meanwhile = hung ? s.sends.filter((t) => t > hung.at && t < hung.at + 12000).length : 0;
    ok(meanwhile >= 11, `while reading carried on every second (${meanwhile} sent)`);
    // Agent detection is one call, off the read path, past the server's own
    // 22 second race: it keeps its 30.
    while (s.engine.isCapturing) await run(s, 50);
    s.engine.detectAgent();
    await run(s, 2000);
    const detect = s.other.find((o) => o.path === API.DETECT_AGENT);
    ok(!!detect && detect.timeoutMs === 30000, `agent detection still waits 30 seconds (${detect && detect.timeoutMs})`);
    ok(s.engine.matchContext.agent === 'Jett' && !s.engine.matchContext.agentConfirmed,
      `and still takes the agent it answers, for the player to confirm (${s.engine.matchContext.agent})`);
  }

  Date.now = realNow;
  console.log(`\n${fails ? fails + ' of ' + checks + ' failed' : 'all ' + checks + ' cadence checks passed'}`);
  process.exit(fails ? 1 : 0);
})().catch((e) => {
  Date.now = realNow;
  console.log('FAIL  the cadence test threw:', e && e.stack ? e.stack : e);
  process.exit(1);
});
