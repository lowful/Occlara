'use strict';

/**
 * THE READ CADENCE (src/shared/read-cadence.js, 8.3.2): how often each phase
 * of a match is read, held against reading everything at the engine's gap.
 *
 *   1. every rule at its boundary, on the pure module
 *   2. the edge cases the cadence was measured on, through the real engine
 *      and its 200 ms heartbeat on a fake clock, a fake server answering each
 *      capture with the screen at that second: the same deaths, rounds,
 *      results and match end as reading everything, and no second of a live
 *      round left unread
 *   3. the four real sessions in scripts/fixtures, through the real engine at
 *      the cadence's own capture times, the read latency drawn: the reads
 *      saved, phase by phase, and the deaths, rounds, results, mode, map,
 *      plants, match end and the frames every look picks against reading
 *      everything, each difference one the analysis measured and accepted
 *
 * The fixtures keep the reads the AI log kept, and beside them how many it
 * thinned away before each (make-session-fixture.js `thinned`): a gap the
 * cadence filled with more reads than that held LOBBY replies, which the log
 * never writes, and they are put back here. Where reads were thinned their
 * screen is unknown, so the comparison reads only what was kept, and a kept
 * read after a thinned gap is read by both runs.
 *
 * Run: npm run test:readpolicy
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const Module = require('module');

// NOTHING LEAVES THE PROCESS. The engine is a fresh copy below with its network
// replaced, and fetch itself throws, so a module that reached the real client
// by another path (ai-log-store.js loads the engine through ai-log-timeline.js,
// with the real api-client) still sends nothing.
let fetched = 0;
global.fetch = async () => { fetched++; throw new Error('test-read-policy: no network'); };

let fails = 0;
let checks = 0;
const ok = (cond, what) => {
  checks++;
  if (!cond) { fails++; console.log(`FAIL  ${what}`); } else console.log(`ok    ${what}`);
};

const REPO = path.join(__dirname, '..');
const SHARED = path.join(REPO, 'src', 'shared');
const { ReadCadence, RULES, matchPoint, DEATH_SCREEN } = require(path.join(SHARED, 'read-cadence.js'));
const deathFrames = require(path.join(SHARED, 'death-frames.js'));
const verify = require(path.join(SHARED, 'valorant-verify.js'));
const { clockSeconds } = require(path.join(SHARED, 'valorant-rounds.js'));
const { API } = require(path.join(SHARED, 'config.js'));
const aiLogStore = require(path.join(REPO, 'src', 'main', 'services', 'ai-log-store.js'));
const { replaySession } = require('./fixtures/replay-session.js');

// ── The clock, the network and the engine ───────────────────────────────────
const realNow = Date.now;
const realLog = console.log;
const realErr = console.error;
let clock = Date.parse('2026-10-04T20:00:00Z');
Date.now = () => Math.round(clock);
let net = null;
const realLoad = Module._load;
Module._load = function patched(request, parent, isMain) {
  if (request === './api-client') {
    return {
      post: (p, body, key, timeoutMs) => (net ? net.post(p, body, timeoutMs) : Promise.resolve({ ok: false, status: 0, data: null })),
      get: async () => ({ ok: false, status: 0, data: null }),
    };
  }
  return realLoad(request, parent, isMain);
};
// A FRESH copy, whoever loaded the engine first: cached with the real client by
// an earlier require, the engine posted its reads to the live server.
const ENGINE_FILE = require.resolve(path.join(REPO, 'src', 'main', 'services', 'coaching-engine.js'));
delete require.cache[ENGINE_FILE];
const CoachingEngine = require(ENGINE_FILE);
Module._load = realLoad;
const T0 = Date.parse('2026-10-04T20:00:00Z');

// Everything due on the fake clock: the server's replies.
let events = [];
let eventN = 0;
const later = (at, fn) => events.push({ at, fn, n: eventN++ });
const flush = () => new Promise((r) => setImmediate(r));
async function runUntil(t) {
  for (;;) {
    let due = null;
    for (const ev of events) if (ev.at <= t && (!due || ev.at < due.at || (ev.at === due.at && ev.n < due.n))) due = ev;
    if (!due) break;
    events.splice(events.indexOf(due), 1);
    clock = Math.max(clock, due.at);
    due.fn();
    await flush();
  }
  clock = Math.max(clock, t);
}
async function runOut() {
  while (events.length) await runUntil(Math.min(...events.map((ev) => ev.at)));
  await flush();
}

/**
 * A read's latency, lognormal (sigma 0.5) about the median that gives `p90` s,
 * seeded BY THE FRAME READ (`key`), so a frame both runs read takes as long in
 * each. Drawn in the order reads went out instead, the run that skipped a read
 * gave every later frame another latency, and the four in flight cap then
 * dropped other frames in each run: on the Sunset match at a p90 of 4.3 s,
 * reading everything lost round 5's pistol timer read to it, the cadence the
 * post plant read that set the gun a weak tell's death is judged against.
 */
function latencies(seed, p90) {
  const median = p90 / Math.exp(1.2816 * 0.5);
  return (key) => {
    let s = (seed >>> 0) ^ 0x9e3779b9;
    for (const ch of String(key)) s = Math.imul(s ^ ch.charCodeAt(0), 16777619) >>> 0;
    const next = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
    next();
    const u1 = Math.max(1e-9, next());
    const u2 = next();
    return median * Math.exp(0.5 * Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2)) * 1000;
  };
}

/**
 * The fake server: `answer(image)` is { data } for a reply, { status } for a
 * refusal or { hang: true } for a read never answered, which the client gives
 * up on at its own timeout.
 */
function server(answer, lag) {
  return {
    post(p, body, timeoutMs) {
      if (p !== API.READ) return Promise.resolve({ ok: false, status: 0, data: null });
      const sentAt = clock;
      const a = answer(body.image) || { status: 503 };
      const ms = lag(body.image);
      return new Promise((resolve, reject) => {
        if (a.hang || !(ms <= timeoutMs)) { later(sentAt + timeoutMs, () => reject(new Error('This operation was aborted'))); return; }
        later(sentAt + ms, () => resolve(a.status
          ? { ok: false, status: a.status, data: { error: 'refused' } } : { ok: true, status: 200, data: a.data }));
      });
    },
  };
}

/** The real engine, its read cadence switched off (`full`) to read everything at its gap. */
function makeEngine({ full, speed = 1000, capture, record }) {
  const e = new CoachingEngine({ licenseKey: 'TEST', captureSpeed: speed, experiments: () => ({}),
    captureFunction: capture, diagnostics: record });
  e.isRunning = true;
  if (full) e.readCadence = { reset() {}, applied() {}, gap: (s, now, base) => ({ ms: base, why: 'full' }) };
  return e;
}

const mute = () => { console.log = () => {}; console.error = () => {}; };
const unmute = () => { console.log = realLog; console.error = realErr; };

// ── The AI log's keep rules, main's own (index.js recordAiFrame) ─────────────
// What a review finds at its match's end, the frames its looks pick from:
// main's code run in a sandbox, its files in memory, as test:ailog runs it.
const MAIN_SRC = fs.readFileSync(path.join(REPO, 'src', 'main', 'index.js'), 'utf8');
const between = (src, head, tail) => {
  const i = src.indexOf(head);
  const j = i < 0 ? -1 : src.indexOf(tail, i + head.length);
  return j < 0 ? '' : src.slice(i, j);
};
const KEEP_SRC = between(MAIN_SRC, '\nconst AI_LOG_RECENT', '\nfunction releaseAiLogFrames(');
function keepRules() {
  const box = vm.createContext({
    path, Buffer, JSON, Math, console: { log() {}, error() {}, warn() {} }, Date: { now: () => Math.round(clock) },
    setTimeout: () => 0, clearTimeout() {}, aiLogDirsCache: null, store: { get: () => true }, aiLogStore,
    app: { getPath: () => path.join(os.tmpdir(), 'occlara-readpolicy'), getVersion: () => 'test' },
    fs: { writeFileSync() {}, unlinkSync() {}, existsSync: () => true, mkdirSync() {} },
  });
  const api = vm.runInContext(`${KEEP_SRC}\n;({ record: recordAiFrame, hold: holdAiLogFrames, records: () => aiLogRecords,`
    + ' open: (d) => { aiLogDir = d; aiLogRecords = []; aiLogSeq = 0; aiLogKeepUntil = 0; aiLogTurnUntil = 0; } })', box);
  api.open(path.join(os.tmpdir(), 'occlara-readpolicy', 'session-replay'));
  return api;
}

const sec = (at) => (Number.isFinite(at) ? Math.round((at - T0) / 100) / 10 : null);
const fmt = (s) => `${Math.floor(s / 60)}:${String(Math.max(0, Math.floor(s % 60))).padStart(2, '0')}`;

// ── The edge cases, as screens a second at a time ─────────────────────────────
// What the coach saw in play, a note a read: the fixtures carry none (make-session-fixture.js).
const NOTES = ['holding the corner with the rifle', 'peeking mid alone', 'checking the long angle from cover',
  'rotating through the courtyard', 'pushing into site with the team', 'jiggling the doorway angle'];
const alive = (team, enemy, extra) => (i) => ({ phase: 'active', clock: fmt(99 - i), teamScore: team, enemyScore: enemy,
  playerAlive: true, playerHp: 100, playerWeapon: 'Vandal', aliveTell: 'own HP 100 and Vandal bottom left', side: 'attacking', map: 'Ascent',
  playerNote: NOTES[(i + team * 7 + enemy * 3) % NOTES.length], ...(extra || {}) });
const buy = (team, enemy, len = 30) => (i) => ({ phase: 'buy', clock: fmt(len - 1 - i), teamScore: team, enemyScore: enemy,
  playerAlive: true, playerHp: 100, playerWeapon: 'Classic', aliveTell: 'own HP 100 and Classic bottom left', side: 'attacking', map: 'Ascent',
  playerCredits: len === 45 ? 800 : 3000 });
const dead = (team, enemy, from) => (i) => ({ phase: 'dead', clock: fmt(Math.max(0, from - i)), teamScore: team, enemyScore: enemy,
  playerAlive: false, aliveTell: i < 2 ? 'KILLED BY Jett and COMBAT REPORT' : 'Spectating teammate with SWITCH PLAYER bottom left', side: 'attacking', map: 'Ascent' });
const banner = (team, enemy) => () => ({ phase: 'active', clock: '0:01', teamScore: team, enemyScore: enemy, side: 'attacking', map: 'Ascent',
  playerAlive: false, aliveTell: 'Spectating teammate with SWITCH PLAYER bottom left' });
const LOBBY = () => 'LOBBY';
/** A round: bought, played for `live` s, died (or not), the banner at the new score. */
const round = (t, e, { live = 20, dies = true, t2 = t, e2 = e + 1, buyLen = 30, after = 40 } = {}) => {
  const steps = [[buyLen, buy(t, e, buyLen)], [live, alive(t, e)]];
  steps.push([after, dies ? dead(t, e, 99 - live) : (i) => alive(t, e)(live + i)]);
  steps.push([3, banner(t2, e2)]);
  return steps;
};
const match = (order, { swift = false } = {}) => {
  const s = [];
  let t = 0;
  let e = 0;
  for (const c of order) {
    const t2 = c === 'W' ? t + 1 : t;
    const e2 = c === 'L' ? e + 1 : e;
    const pistol = t + e === 0 || t + e === (swift ? 4 : 12);
    s.push(...round(t, e, { t2, e2, buyLen: pistol ? 45 : 30 }));
    t = t2;
    e = e2;
  }
  return s;
};

/**
 * One scenario on the heartbeat: steps of [seconds, (i) => screen], a
 * screen being a read's context, 'LOBBY' or { pause: true } (the engine
 * paused). Every capture is answered with the screen at its second, except
 * the first one captured at or after `refuseAt` (the server's limiter: 429)
 * and `hangAt` (never answered), and every one from `failFrom` to `failTo`
 * (the server down).
 */
const secondsOf = (steps) => steps.reduce((s, [n]) => s + n, 0);
async function scenario(def, { full = false, seed = 5, p90 = 1.5, speed = 1000 } = {}) {
  const { steps, refuseAt = Infinity, hangAt = Infinity, failFrom = Infinity, failTo = -Infinity } = Array.isArray(def) ? { steps: def } : def;
  const screens = [];
  for (const [n, f] of steps) for (let i = 0; i < n; i++) screens.push(f(i));
  events = [];
  clock = T0;
  const lag = latencies(seed, p90);
  const sends = [];
  const sendTimes = [];
  const deaths = [];
  const ended = [];
  const special = {};
  net = server((img) => {
    const k = Number(img.slice(1));
    const x = screens[k];
    if (k >= refuseAt && special.refused === undefined) { special.refused = k; special.refusedReply = clock + lag(img); return { status: 429 }; }
    if (k >= hangAt && special.hung === undefined) { special.hung = k; return { hang: true }; }
    if (k >= failFrom && k < failTo) return { status: 503 };
    if (x === 'LOBBY') return { data: { lobby: true, context: {} } };
    if (!x || x.pause) return { status: 503 };
    return { data: { lobby: false, context: JSON.parse(JSON.stringify(x)) } };
  }, lag);
  const e = makeEngine({ full, speed,
    capture: () => { const k = Math.floor((clock - T0) / 1000); sends.push(k); sendTimes.push(clock); return Promise.resolve(`s${k}`); },
    record: (rec) => { if (rec.died) deaths.push(Math.floor((rec.at - T0) / 1000)); } });
  e.on('match-ended', (snap) => ended.push({ at: clock, snap }));
  mute();
  try {
    for (let t = T0; t < T0 + screens.length * 1000; t += 200) {
      await runUntil(t);
      const x = screens[Math.floor((t - T0) / 1000)];
      if (x && x.pause && !e.paused) e.pause();
      if (!(x && x.pause) && e.paused) e.resume();
      e.tick();
      await flush();
    }
    await runOut();
    e.stop();
    await flush();
  } finally { unmute(); }
  const main = ended.map((x) => x.snap).filter((x) => !x.voided).sort((a, b) => b.rounds.length - a.rounds.length)[0] || null;
  // The seconds of live play read: active, alive, a mid round clock.
  const live = new Set(sends.filter((k) => {
    const x = screens[k];
    return x && x.phase === 'active' && x.playerAlive === true && clockSeconds(x.clock) >= 15;
  }));
  return {
    sends, sendTimes, deaths: deaths.join(','), live, screens, special, failFrom, failTo,
    ends: ended.map((x) => `${x.snap.endedBy}`).join(' '), endAt: ended.map((x) => (x.at - T0) / 1000),
    rounds: main ? main.rounds.map((r) => `${r.n}${r.result ? r.result[0] : '-'}${r.died ? 'D' : ''}`).join(' ') : '',
    notes: main ? main.rounds.map((r) => (r.reads || []).map((x) => x.text).join('|')).join(' / ') : '',
    engine: e,
  };
}
const SCENARIOS = {
  // A standard match to 13 to 11, a death every round, then the end screen.
  'a standard match to 13 to 11': { steps: () => [[20, LOBBY], ...match('WLWLWLWLWLWLWLWLWLWLWLWW'), [60, LOBBY]], endWithin: 5 },
  // 13 to 12 is deliberately no final score: the menus end it.
  '13 to 12, ended by the menus': { steps: () => [...round(12, 11, { t2: 12, e2: 12 }), ...round(12, 12, { t2: 13, e2: 12 }), [60, LOBBY]], endWithin: 5 },
  'overtime to 15 to 13': { steps: () => [...round(12, 11, { t2: 12, e2: 12 }), ...round(12, 12, { t2: 13, e2: 12 }),
    ...round(13, 12, { t2: 13, e2: 13 }), ...round(13, 13, { t2: 14, e2: 13 }), ...round(14, 13, { t2: 15, e2: 13 }), [40, LOBBY]], endWithin: 5 },
  'a swiftplay final at 2 to 5': { steps: () => [...match('LLWLWLLL', { swift: true }), [40, LOBBY]], endWithin: 5 },
  'the big map open 8 s mid round': { steps: () => [...round(0, 0, { t2: 0, e2: 1 }),
    [30, buy(0, 1)], [10, alive(0, 1)], [8, LOBBY], [2, (i) => alive(0, 1)(18 + i)], [40, dead(0, 1, 79)], [3, banner(0, 2)], [10, buy(0, 2)]] },
  'Escape for 25 s mid round': { steps: () => [...round(0, 0, { t2: 0, e2: 1 }),
    [30, buy(0, 1)], [10, alive(0, 1)], [25, LOBBY], [20, (i) => alive(0, 1)(35 + i)], [40, dead(0, 1, 44)], [3, banner(0, 2)], [10, buy(0, 2)]], lost: 2 },
  'a revive': { steps: () => [...round(0, 0, { t2: 0, e2: 1 }),
    [30, buy(0, 1)], [15, alive(0, 1)], [15, dead(0, 1, 84)],
    [30, (i) => ({ ...alive(0, 1)(30 + i), aliveTell: 'own HP 100 and Vandal bottom left, revived' })], [3, banner(1, 1)], [10, buy(1, 1)]], lost: 2 },
  'a 90 s pause in a buy phase': { steps: () => [...round(0, 0, { t2: 0, e2: 1 }),
    [10, buy(0, 1)], [90, () => ({ pause: true })], [30, alive(0, 1)], [40, dead(0, 1, 69)], [3, banner(0, 2)], [10, buy(0, 2)]] },
  'a remake': { steps: () => [...round(0, 0, { t2: 0, e2: 1 }), ...round(0, 1, { t2: 1, e2: 1 }), [40, LOBBY],
    [45, buy(0, 0, 45)], [20, alive(0, 0)], [40, dead(0, 0, 79)], [3, banner(0, 1)], [10, buy(0, 1)]], endWithin: 5 },
  // Sunset round 5's "buy 0:39" read off the ammo counter, mid round.
  'a buy timer misread mid round': { steps: () => [...round(0, 0, { t2: 0, e2: 1 }),
    [30, buy(0, 1)], [20, alive(0, 1)], [5, LOBBY],
    [1, () => ({ ...buy(0, 1)(0), clock: '0:29' })], [1, () => ({ ...buy(0, 1)(0), clock: '0:28' })],
    [20, (i) => alive(0, 1)(27 + i)], [40, dead(0, 1, 52)], [3, banner(0, 2)], [4, LOBBY], [30, buy(0, 2)], [10, alive(0, 2)]] },
  'a round end banner of 2 s while dead': { steps: () => [...round(0, 0, { t2: 0, e2: 1 }),
    [30, buy(0, 1)], [15, alive(0, 1)], [50, dead(0, 1, 84)], [2, banner(1, 1)], [3, LOBBY], [30, buy(1, 1)], [10, alive(1, 1)]] },
  // The shop open for the whole of a buy phase.
  'the shop held for a whole buy phase': { steps: () => [...round(1, 1, { t2: 2, e2: 1 }),
    [2, buy(2, 1)], [26, LOBBY], [2, (i) => buy(2, 1)(28 + i)], [25, alive(2, 1)], [40, dead(2, 1, 74)], [3, banner(2, 2)], [10, buy(2, 2)]] },
  // The COMBAT REPORT of a round survived, read as dead as the buy phase starts.
  'the combat report as a buy phase starts, after a round survived': { steps: () => [
    [30, buy(5, 3)], [70, alive(5, 3)], [3, () => ({ ...banner(6, 3)(), playerAlive: true, aliveTell: 'own HP 40 and Vandal bottom left' })],
    [1, () => ({ phase: 'buy', clock: '0:29', teamScore: 6, enemyScore: 3, playerAlive: false, aliveTell: 'COMBAT REPORT shown, KILLED BY Jett', map: 'Ascent' })],
    [2, (i) => ({ phase: 'buy', teamScore: 6, enemyScore: 3, playerAlive: false, aliveTell: 'COMBAT REPORT shown', map: 'Ascent', clock: fmt(28 - i) })],
    [27, (i) => buy(6, 3)(3 + i)], [20, alive(6, 3)], [40, dead(6, 3, 79)], [3, banner(6, 4)], [10, buy(6, 4)]] },
  // A buy read with no clock cut the engine's combat report window to 2 s
  // (coaching-engine.js buyUntil), and the clocked read after it put it back.
  // Asleep, the read after it came 5 s later and was the combat report, and
  // it registered as round 10's death in its buy phase. Since 8.3.2 a window
  // two clocked reads agree on, the ledger's buy end with them, is kept
  // (buyWindow), as here after 13 of them; the cut of one read's window, the
  // case the sleep's `covered` is for, is in the engine's buy window checks.
  'the combat report after a buy read with no clock, the buy phase asleep': { steps: () => [...round(5, 3, { t2: 6, e2: 3 }),
    [13, buy(6, 3)], [1, () => ({ ...buy(6, 3)(13), clock: undefined })], [1, () => buy(6, 3)(14)],
    [5, (i) => ({ phase: 'dead', clock: fmt(14 - i), teamScore: 6, enemyScore: 3, playerAlive: false,
      aliveTell: 'COMBAT REPORT shown, KILLED BY Jett', map: 'Ascent' })],
    [10, (i) => buy(6, 3)(20 + i)], [20, alive(6, 3)], [40, dead(6, 3, 79)], [3, banner(6, 4)], [10, buy(6, 4)]] },
  'a buy phase read with no clock': { steps: () => [...round(5, 3, { t2: 6, e2: 3 }),
    [30, () => ({ ...buy(6, 3)(0), clock: undefined })], [20, alive(6, 3)], [40, dead(6, 3, 79)], [3, banner(6, 4)], [10, buy(6, 4)]] },
  // The server's limiter refuses a read 8 s into a buy phase: ten seconds of nothing.
  'a 429 in a buy phase': { steps: () => {
    const s = round(5, 3, { t2: 6, e2: 3 });
    const refuseAt = secondsOf(s) + 8;
    return { steps: [...s, [30, buy(6, 3)], [20, alive(6, 3)], [40, dead(6, 3, 79)], [3, banner(6, 4)], [10, buy(6, 4)]], refuseAt };
  } },
  // One read never answered, 12 s after a death: everything behind it waits 12 s.
  'a hung read while dead': { steps: () => {
    const s = [...round(5, 3, { t2: 6, e2: 3 }), [30, buy(6, 3)], [20, alive(6, 3)]];
    const hangAt = secondsOf(s) + 12;
    return { steps: [...s, [40, dead(6, 3, 79)], [3, banner(6, 4)], [10, buy(6, 4)]], hangAt };
  } },
  // The server down for 20 s while the player is dead.
  'the server down for 20 s while dead': { steps: () => {
    const s = [...round(5, 3, { t2: 6, e2: 3 }), [30, buy(6, 3)], [20, alive(6, 3)]];
    const failFrom = secondsOf(s) + 8;
    return { steps: [...s, [40, dead(6, 3, 79)], [3, banner(6, 4)], [10, buy(6, 4)]], failFrom, failTo: failFrom + 20 };
  } },
  // An alt tab of 50 s mid match ends it on the menu path; the match resumes.
  'a false end on an alt tab, and the match resuming': { steps: () => [...match('WLWL'),
    [10, buy(2, 2)], [50, LOBBY], [20, (i) => buy(2, 2)(10 + i)], ...round(2, 2, { t2: 3, e2: 2, buyLen: 0 }), [60, LOBBY]] },
};

// ── The real sessions ───────────────────────────────────────────────────────
const FIX = (file) => require(path.join(__dirname, 'fixtures', file));
const atOf = (f) => T0 + Math.round(f.t * 1000);
/** A thinned read's screen, for counting only: its nearer neighbour's, the clock run on. */
const fillOf = (s) => {
  const same = s.from.phase === s.to.phase;
  const near = same || s.at - atOf(s.from) <= atOf(s.to) - s.at ? s.from : s.to;
  const { t, ...st } = JSON.parse(JSON.stringify(near));
  const left = clockSeconds(st.clock);
  if (left !== null) {
    const l = near === s.from ? left - (s.at - atOf(s.from)) / 1000 : left + (atOf(s.to) - s.at) / 1000;
    if (l >= 0 && l <= 100) st.clock = fmt(l); else delete st.clock;
  }
  return st;
};
/**
 * A session's reads as it ran: every read kept, the LOBBY replies put back
 * where the log's numbering leaves room for them, `before` and `after`
 * seconds of menus, and (counting only) the thinned reads filled from their
 * neighbours, or the whole session on a `step` grid.
 */
function sessionSlots(file, { before = 60, after = 0, mode = 'fidelity', step = 0 } = {}) {
  const fx = FIX(file);
  const frames = fx.frames;
  const thinned = Array.isArray(fx.thinned) && fx.thinned.length === frames.length ? fx.thinned : frames.map(() => 0);
  const singles = [];
  for (let k = 1; k < frames.length; k++) if (!thinned[k]) singles.push({ k, dt: atOf(frames[k]) - atOf(frames[k - 1]) });
  const dts = singles.map((x) => x.dt).sort((a, b) => a - b);
  const gap = dts[Math.floor(dts.length * 0.3)] || 1000;
  // The cadence each gap ran at: auto stepped between tiers on 8.0.1.
  const localGap = (k) => {
    const near = singles.slice().sort((x, y) => Math.abs(x.k - k) - Math.abs(y.k - k)).slice(0, 12)
      .map((x) => x.dt).filter((dt) => dt < 4000).sort((x, y) => x - y);
    return near.length ? near[Math.floor(near.length / 2)] : gap;
  };
  let slots = [];
  const first = atOf(frames[0]);
  for (let j = Math.round((before * 1000) / gap); j >= 1; j--) slots.push({ at: first - j * gap, kind: 'lobby', where: 'pre' });
  for (let k = 0; k < frames.length; k++) {
    const a = frames[k];
    slots.push({ at: atOf(a), kind: 'kept', frame: a, forced: k > 0 && thinned[k] > 0 });
    const b = frames[k + 1];
    if (!b) break;
    const di = thinned[k + 1];
    const lg = localGap(k + 1);
    const span = atOf(b) - atOf(a);
    const n = Math.max(di + 1, span < 1.6 * lg ? 1 : Math.round(span / lg));
    const interior = n - 1;
    if (interior <= 0) continue;
    const lobbyN = interior - di;
    const kinds = new Array(interior).fill('thinned');
    if (!di) kinds.fill('lobby');
    else {
      for (let j = 0, placed = 0; j < interior && placed < lobbyN; j++) {
        if (Math.floor(((j + 1) * lobbyN) / interior) > placed) { kinds[j] = 'lobby'; placed++; }
      }
    }
    for (let j = 0; j < interior; j++) {
      slots.push({ at: atOf(a) + Math.round(((j + 1) * span) / n), kind: kinds[j], where: 'mid', pure: !di, from: a, to: b });
    }
  }
  const last = atOf(frames[frames.length - 1]);
  for (let j = 1; j <= Math.round((after * 1000) / gap); j++) slots.push({ at: last + j * gap, kind: 'lobby', where: 'post' });
  if (mode === 'fidelity') {
    slots = slots.filter((s) => s.kind !== 'thinned' && (s.kind !== 'lobby' || s.where !== 'mid' || s.pure));
  } else {
    for (const s of slots) if (s.kind === 'thinned') s.fill = fillOf(s);
    if (step) {
      // One read at 2 s counted as it would be read at 1 s: each grid slot
      // the nearest slot's screen, its clock run on.
      const src = slots;
      slots = [];
      let j = 0;
      for (let at = src[0].at; at <= src[src.length - 1].at; at += step) {
        while (j + 1 < src.length && Math.abs(src[j + 1].at - at) <= Math.abs(src[j].at - at)) j++;
        const s = src[j];
        if (s.kind === 'lobby') { slots.push({ at, kind: 'lobby', where: s.where }); continue; }
        const { t, ...st } = JSON.parse(JSON.stringify(s.kind === 'kept' ? s.frame : s.fill));
        const left = clockSeconds(st.clock);
        if (left !== null) {
          const l = left - (at - s.at) / 1000;
          if (l >= 0 && l <= 100) st.clock = fmt(l); else delete st.clock;
        }
        slots.push({ at, kind: 'thinned', fill: st });
      }
    }
  }
  slots.forEach((s, i) => { s.idx = i; });
  return { slots, gap };
}
/** What a slot showed, for the count by phase. */
const phaseOf = (s, ended) => {
  if (s.kind === 'lobby') return s.where === 'pre' ? 'menus' : s.where === 'post' ? 'end screen' : ended ? 'menus' : 'lobby in match';
  const st = s.kind === 'kept' ? s.frame : s.fill || {};
  if (st.phase === 'buy') return 'buy';
  if (st.playerAlive === false || st.phase === 'dead') return 'dead';
  if (st.phase === 'postplant') return 'post plant';
  const left = clockSeconds(st.clock);
  if (st.phase === 'active' && left !== null && left < 15) return 'banner';
  return st.phase === 'active' ? 'live' : 'other';
};

/** One session through the real engine, the cadence on or off (`full`): tick() at each slot. */
async function replay(slots, { full = false, seed = 7, p90 = 1.5, trace = null } = {}) {
  events = [];
  clock = slots[0].at - 1000;
  const lag = latencies(seed, p90);
  const keep = keepRules();
  const records = [];
  const ended = [];
  const modes = [];
  const maps = [];
  const sent = [];
  const phases = {};
  let current = null;
  net = server((img) => {
    const s = slots[Number(String(img).slice(5))];
    if (!s || s.kind === 'lobby') return { data: { lobby: true, context: {} } };
    const { t, ...ctx } = s.kind === 'kept' ? s.frame : s.fill;
    return { data: { lobby: false, context: JSON.parse(JSON.stringify(ctx)) } };
  }, lag);
  const e = makeEngine({ full,
    capture: () => {
      sent.push(current);
      const p = phaseOf(current, !!e.endWatch.ended);
      phases[p] = (phases[p] || 0) + 1;
      return Promise.resolve(`slot-${current.idx}`);
    },
    record: (d) => {
      records.push({ at: d.at, state: d.state || {}, round: d.round, died: !!d.died });
      keep.record({ ...d, image: 'AA==' });
    } });
  // The capture second of the read that ended a match, or the clock at a stop.
  e.on('match-ended', (snap) => {
    ended.push({ at: snap.endedBy === 'stop' ? clock : e.frameAt, snap });
    keep.hold(snap.startedAt, snap.endedAt);
  });
  const apply = e.applyRead.bind(e);
  let lastMode = null;
  let lastMap = null;
  e.applyRead = (r) => {
    const raw = r.data && r.data.context ? JSON.stringify(r.data.context) : 'LOBBY';
    apply(r);
    const c = e.matchContext;
    if (c.gameMode !== lastMode) { lastMode = c.gameMode; modes.push(`${lastMode}@${sec(r.at)}`); }
    if (c.map !== lastMap) { lastMap = c.map; maps.push({ map: lastMap, at: sec(r.at) }); }
    // For a look by hand: every read applied between two seconds, and what it left.
    if (trace && sec(r.at) >= trace[0] && sec(r.at) <= trace[1]) {
      const g = e.readCadence.gap(e.cadenceState(), Math.round(clock), e.gapMs);
      process.stdout.write(`${full ? 'full' : 'cadence'} ${sec(r.at)} applied ${sec(clock)} | ${raw.slice(0, 150)}`
        + ` | ctx ${c.teamScore}-${c.enemyScore} ${c.phase} alive ${c.playerAlive} mode ${c.gameMode} trial ${!!e.onTrial}`
        + ` death ${sec(e.lastDeathAt)} round ${e.ledger.current()} | next ${g.ms} ${g.why}\n`);
    }
  };
  mute();
  try {
    for (const s of slots) {
      await runUntil(s.at);
      current = s;
      // A kept read after a thinned gap: what the gap held is unknown, so both read it.
      if (s.forced) e.lastSendAt = -Infinity;
      e.tick();
      await flush();
    }
    await runOut();
    e.stop();
    await flush();
  } finally { unmute(); }
  const kept = keep.records().map((r) => ({ at: r.at, frame: r.frame, state: r.state, round: r.round, died: r.died, match: r.match }));
  return { records, kept, ended, modes, maps, sent, phases };
}

/** Everything the review is built from, as one run left it. */
function outputsOf(run, riot) {
  const snaps = run.ended.map((x) => x.snap).filter((x) => !x.voided);
  const snap = snaps.slice().sort((a, b) => b.rounds.length - a.rounds.length)[0] || null;
  const rows = snap ? snap.rounds : [];
  const window = snap ? { from: snap.startedAt, to: snap.endedAt } : {};
  const out = {
    sent: run.sent.length,
    deaths: run.records.filter((r) => r.died).map((r) => sec(r.at)),
    deathRounds: run.records.filter((r) => r.died).map((r) => r.round),
    phases: run.phases,
    rounds: rows.map((r) => ({ n: r.n, result: r.result, died: r.died, clock: r.deathClock, spot: r.deathSpot, early: r.early,
      planted: r.planted, plantSpot: r.plantSpot, ult: r.ultAtDeath, side: r.side, afterPlant: r.afterPlant })),
    modes: run.modes.join(' '),
    maps: run.maps,
    ends: run.ended.map((x) => ({ by: x.snap.endedBy, at: sec(x.at) })),
    screen: rows.length ? deathFrames.looksFor(run.kept, rows, window, 'screen').map((l) => `${l.round.n}:${l.frames.map((f) => sec(f.at)).join('/')}`).join(' ') : '',
  };
  if (riot && rows.length) {
    const rec = verify.reconcile(rows, riot, { records: run.kept, window });
    const timed = deathFrames.withRiotTimes(rec.rounds, riot);
    const look = (l) => ({ n: l.round.n, moment: sec(l.moment), frames: l.frames.map((f) => sec(f.at)).join('/') });
    out.invented = rec.checks ? rec.checks.invented.slice() : [];
    out.four = deathFrames.looksFor(run.kept, timed, window, 'riot', 4).map(look);
    out.looks = deathFrames.looksFor(run.kept, timed, window, 'riot', 24).map(look);
    out.drops = {};
    for (const r of timed) {
      const d = deathFrames.barrierDrop(run.kept, r.n, window);
      out.drops[r.n] = d ? { at: sec(d.at), frames: d.frames, of: d.of } : null;
    }
  }
  return out;
}

/** Every difference between reading everything (a) and the cadence (b), as lines. */
function diffOf(a, b) {
  const lines = [];
  const add = (kind, text) => lines.push({ kind, text });
  if (a.deaths.join() !== b.deaths.join()) add('deaths', `deaths ${a.deaths.join(',')} -> ${b.deaths.join(',')}`);
  if (a.rounds.map((r) => r.n).join() !== b.rounds.map((r) => r.n).join()) add('rounds', `rounds ${a.rounds.map((r) => r.n)} -> ${b.rounds.map((r) => r.n)}`);
  const byN = new Map(b.rounds.map((r) => [r.n, r]));
  for (const x of a.rounds) {
    const y = byN.get(x.n);
    if (!y) continue;
    for (const k of Object.keys(x)) if (JSON.stringify(x[k]) !== JSON.stringify(y[k])) add(k, `R${x.n} ${k} ${JSON.stringify(x[k])} -> ${JSON.stringify(y[k])}`);
  }
  if (a.modes !== b.modes) add('mode', `mode ${a.modes} -> ${b.modes}`);
  const mapText = (m) => m.map((x) => `${x.map}@${x.at}`).join(' ');
  if (mapText(a.maps) !== mapText(b.maps)) add('map', `map ${mapText(a.maps)} -> ${mapText(b.maps)}`);
  const endText = (m) => m.map((x) => `${x.by}@${x.at}`).join(' ');
  if (endText(a.ends) !== endText(b.ends)) add('end', `end ${endText(a.ends)} -> ${endText(b.ends)}`);
  if (a.screen !== b.screen) add('screen looks', `screen looks ${a.screen} -> ${b.screen}`);
  if (a.four) {
    const t4 = (l) => l.map((x) => x.n).join();
    if (t4(a.four) !== t4(b.four)) add('four', `the four looks ${t4(a.four)} -> ${t4(b.four)}`);
    const lb = new Map(b.looks.map((l) => [l.n, l]));
    for (const l of a.looks) {
      const m = lb.get(l.n);
      if (!m) { add('look', `look R${l.n} gone`); continue; }
      if (l.frames !== m.frames) add('look frames', `look R${l.n} frames ${l.frames} -> ${m.frames}`);
      if (l.moment !== m.moment) add('look moment', `look R${l.n} moment ${l.moment} -> ${m.moment} (${(m.moment - l.moment).toFixed(1)} s)`);
    }
    for (const l of b.looks) if (!a.looks.some((x) => x.n === l.n)) add('look', `look R${l.n} new`);
    for (const [n, d] of Object.entries(a.drops)) {
      const e = b.drops[n];
      if (JSON.stringify(d && d.at) !== JSON.stringify(e && e.at)) add('drop', `drop R${n} ${d ? `${d.at} (${d.frames} of ${d.of})` : 'none'} -> ${e ? `${e.at} (${e.frames} of ${e.of})` : 'none'}`);
    }
  }
  return lines;
}

/**
 * The differences the analysis did not measure and accept, of those diffOf
 * found. Accepted, each measured on these sessions:
 *   a death Riot does not have, the screen's invention, not registered (the
 *     Split's round 18, the round 17 combat report, which the sleep skips)
 *   a map lock the labels later release taken late or not at all (Haven on
 *     the Sunset and the Abyss swiftplay), the right map locked on the same read
 *   a plant's callout in other words for the same site ("A" for "A site"), a
 *     plant seen on a dead frame read 3 s apart
 *   a look's moment and a barrier drop within 0.3 s, a clocked frame more
 *     kept or fewer (the Split's round 6)
 *   the match's end within 5 s: menus read every 5 s once the run passes 45 s
 */
function unaccepted(a, b) {
  const out = [];
  const gone = new Set();
  const da = a.deaths.map((t, i) => ({ t, n: a.deathRounds[i] }));
  const db = new Set(b.deaths);
  if (b.deaths.some((t) => !a.deaths.includes(t))) out.push('a death the cadence registered and reading everything did not');
  for (const d of da) {
    if (db.has(d.t)) continue;
    if ((a.invented || []).includes(d.n)) gone.add(d.n);
    else out.push(`round ${d.n}'s death at ${d.t} s lost`);
  }
  const site = (v) => { const m = /^\s*([abc])\b/i.exec(String(v || '')); return m ? m[1].toUpperCase() : String(v); };
  for (const x of diffOf(a, b)) {
    const m = /^R(\d+) (\w+) (.*) -> (.*)$/.exec(x.text);
    if (x.kind === 'deaths') continue;
    if (m && gone.has(Number(m[1])) && ['died', 'clock', 'spot', 'early', 'ult', 'afterPlant'].includes(m[2])) continue;
    if (m && m[2] === 'plantSpot' && site(JSON.parse(m[3])) === site(JSON.parse(m[4]))) continue;
    if (x.kind === 'map') {
      const last = (list) => list.length ? list[list.length - 1].map : null;
      const firstOf = (list, map) => (list.find((y) => y.map === map) || {}).at;
      if (last(a.maps) && last(a.maps) === last(b.maps) && firstOf(a.maps, last(a.maps)) === firstOf(b.maps, last(b.maps))) continue;
    }
    if (x.kind === 'end' && a.ends.length === b.ends.length
      && a.ends.every((e, i) => e.by === b.ends[i].by && (e.by === 'stop' || Math.abs(e.at - b.ends[i].at) <= 5))) continue;
    if (x.kind === 'look moment' || x.kind === 'drop') {
      const n = /(-?\d+(?:\.\d+)?)\s*->\s*(-?\d+(?:\.\d+)?)/.exec(x.text.replace(/\(\d+ of \d+\)/g, ''));
      if (n && Math.round(Math.abs(Number(n[2]) - Number(n[1])) * 10) <= 3) continue;
    }
    out.push(x.text);
  }
  return out;
}

// Riot's record of each match: the Split and the 24 round Abyss from theirs;
// the Sunset's deaths where its clips show them (test-clips.js: the seconds
// from its round's buy timer reading 0:00), its first from the screen's own
// clock; the Abyss swiftplay's at the seconds its verified review had.
const ref = (file) => replaySession(file, null);
const sunsetRef = ref('valorant-session-sunset-swiftplay.json');
const zeroOf = (recs, n) => { const z = recs.filter((x) => x.round === n && x.state.phase === 'buy' && x.state.clock === '0:00').pop(); return z ? z.at : null; };
const CLIP_DEATH = { 2: 163.5, 3: 252.62, 6: 518.1, 7: 614.7 };
const plantOf = (recs, n) => {
  const p = recs.find((x) => x.round === n && (x.state.phase === 'postplant' || x.state.spike === 'planted'));
  const z = zeroOf(recs, n);
  return p && z !== null ? Math.round(p.at - (z + 500)) : null;
};
const SUNSET_RIOT = { perRound: sunsetRef.rounds.map((r) => {
  const z = zeroOf(sunsetRef.records, r.n);
  const ms = !r.died ? null : CLIP_DEATH[r.n] && z !== null ? Math.round(sunsetRef.t0 + CLIP_DEATH[r.n] * 1000 - (z + 500))
    : r.deathClock !== null ? (100 - r.deathClock) * 1000 : null;
  return { n: r.n, won: r.result === 'won', died: !!r.died, deathMs: ms, planted: !!r.planted,
    plantMs: r.n === 2 ? plantOf(sunsetRef.records, 2) : null, afterPlant: r.n === 2 || !!r.afterPlant, traded: false, firstDeath: false };
}), map: 'Sunset', queue: 'swiftplay' };
const swiftRef = ref('valorant-session-abyss-swiftplay.json');
const SWIFT_SEC = { 1: 51, 2: 13, 4: 18, 6: 34, 8: 10 };
const SWIFT_RIOT = { perRound: swiftRef.rounds.map((r) => ({ n: r.n, won: r.result === 'won', died: SWIFT_SEC[r.n] !== undefined,
  deathMs: SWIFT_SEC[r.n] !== undefined ? SWIFT_SEC[r.n] * 1000 : null, planted: !!r.planted, plantMs: null, afterPlant: false,
  traded: false, firstDeath: false })), map: 'Abyss', queue: 'swiftplay' };
async function main() {
  // ══ 1. Every rule at its boundary ══════════════════════════════════════════
  // The engine's state as cadenceState() hands it: a live round by default.
  const S = (o) => ({ reads: 10, inLobby: false, ended: false, rounds: 3, bought: false, buyEndsAt: null,
    team: 1, enemy: 0, mode: 'standard', phase: 'active', clock: '1:20', alive: true, lastDeathAt: 0,
    onTrial: false, unsettled: false, ...(o || {}) });
  const B = 1000;
  const T = T0 + 3600e3;
  const gapOf = (p, s, now) => p.gap(s, now, B);
  const lobbies = (p, s, from, n, step = 1000) => { for (let k = 0; k < n; k++) p.applied(s, { at: from + k * step, lobby: true }); };
  {
    console.log('the rules, one at a time:');
    let p = new ReadCadence();
    const menu = S({ inLobby: true, rounds: 0 });
    ok(gapOf(p, S(), T).ms === B && gapOf(p, S(), T).why === 'play', 'a live round is read at the gap');
    lobbies(p, menu, T, 1);
    ok(gapOf(p, menu, T + 1000).ms === B, 'one LOBBY reply out of a match: still the gap');
    lobbies(p, menu, T + 1000, 1);
    ok(gapOf(p, menu, T + 2000).ms === RULES.menus.gapMs && RULES.menus.gapMs === 5000, 'two in a row: every 5 s');
    p = new ReadCadence();
    lobbies(p, menu, T, 180, 1000);
    ok(gapOf(p, menu, T + 179000 + 900).ms === 5000, 'a menu run of 2 min 59 s: still every 5 s');
    ok(gapOf(p, menu, T + 180000).ms === 10000 && RULES.idle.afterMs === 180000, 'three minutes of it: every 10 s');
    // Stale: nothing applied for the gap and 4 s more.
    p = new ReadCadence();
    lobbies(p, menu, T, 2);
    ok(gapOf(p, menu, T + 1000 + 9000).ms === 5000, 'the last read applied 9 s ago, a 5 s gap: still slow');
    ok(gapOf(p, menu, T + 1000 + 9001).ms === B && gapOf(p, menu, T + 1000 + 9001).why === 'stale',
      'and past the gap and 4 s, the state is stale: the gap');
    // After an end, the menus are out of a match, a game read is the gap.
    p = new ReadCadence();
    const after = S({ ended: true, inLobby: true, rounds: 0 });
    lobbies(p, after, T, 2);
    ok(gapOf(p, after, T + 2000).ms === 5000, 'menus after the watch ended a match: every 5 s');
    p.applied(S({ ended: true, alive: false, phase: 'dead', lastDeathAt: T - 20000 }), { at: T + 2000, aliveTell: 'Spectating teammate' });
    ok(gapOf(p, S({ ended: true, alive: false, phase: 'dead', lastDeathAt: T - 20000 }), T + 3000).ms === B,
      'a game read after an end, the match perhaps resuming: the gap, dead or not');
  }
  {
    console.log('\na menu inside the match:');
    let p = new ReadCadence();
    const inMatch = S({ inLobby: true, rounds: 4 });
    lobbies(p, inMatch, T, 9);
    ok(gapOf(p, inMatch, T + 9000).ms === B, 'nine LOBBY replies in a row in a match (the big map, Escape): still the gap');
    lobbies(p, inMatch, T + 9000, 1);
    ok(gapOf(p, inMatch, T + 10000).ms === 3000 && gapOf(p, inMatch, T + 10000).why === 'lobby', 'the tenth: every 3 s');
    lobbies(p, inMatch, T + 10000, 12, 3000);
    ok(gapOf(p, inMatch, T + 44999).ms === 3000, 'a run of 44.9 s: every 3 s');
    ok(gapOf(p, inMatch, T + 45000).ms === 5000 && gapOf(p, inMatch, T + 45000).why === 'end screen', 'from 45 s: every 5 s, the end screen');
    // The shop, on the ledger's own buy phase.
    p = new ReadCadence();
    const end = T + 25000;
    const shop = S({ inLobby: true, rounds: 4, bought: true, buyEndsAt: end, team: 5, enemy: 4 });
    lobbies(p, shop, T, 1);
    ok(gapOf(p, shop, T + 1000).ms === B, 'one LOBBY in the ledger\'s buy phase: the gap (the shop, perhaps)');
    lobbies(p, shop, T + 1000, 1);
    ok(gapOf(p, shop, T + 2000).ms === 3000 && gapOf(p, shop, T + 2000).why === 'shop', 'two: the shop, every 3 s');
    lobbies(p, shop, T + 2000, 18);
    ok(gapOf(p, shop, end - 5001).ms === 3000 && gapOf(p, shop, end - 5000).ms === B,
      'until 5 s before its barriers drop, then the gap');
    lobbies(p, shop, T + 20000, 20);
    ok(gapOf(p, shop, end + 14999).ms === B, 'and the gap until 15 s after they drop');
    ok(gapOf(p, shop, end + 15000).ms === 3000, 'then the menu rule, every 3 s after ten replies');
    const notBought = S({ inLobby: true, rounds: 4, bought: false, buyEndsAt: end });
    p = new ReadCadence();
    lobbies(p, notBought, T, 2);
    ok(gapOf(p, notBought, T + 2000).ms === B, 'a buy end the ledger has not taken this boundary\'s buy phase for: no shop');
    const shopMode = S({ inLobby: true, rounds: 6, bought: true, buyEndsAt: end, team: 3, enemy: 3, mode: null });
    p = new ReadCadence();
    lobbies(p, shopMode, T, 3);
    ok(gapOf(p, shopMode, T + 3000).ms === B && gapOf(p, shopMode, T + 3000).why === 'mode',
      'the shop in rounds 4 to 9 while the mode is unknown: the gap (round 5 tells it, rounds 5 to 8 count the side swap)');
  }
  {
    console.log('\nthe buy phase, asleep on a timer two reads agree on:');
    // A frame that set the ledger's buy end from the clock printed on it: the
    // ledger's end is its capture plus the whole seconds it shows.
    const buyRead = (p, at, left, extra) => {
      const clockText = fmt(left);
      const s = S({ phase: 'buy', clock: clockText, bought: true, buyEndsAt: at + Math.floor(left) * 1000, team: 6, enemy: 5, ...(extra || {}) });
      p.applied(s, { at, phase: 'buy', clock: clockText });
      return s;
    };
    let p = new ReadCadence();
    buyRead(p, T, 25);
    let s = buyRead(p, T + 1000, 24);
    ok(p.buyEnd === null && gapOf(p, s, T + 2000).ms === B, 'two reads 1 s apart: not confirmed, the gap');
    p = new ReadCadence();
    buyRead(p, T, 25);
    s = buyRead(p, T + 1799, 23);
    ok(p.buyEnd === null, 'two reads 1.799 s apart: not confirmed');
    s = buyRead(p, T + 1800, 23);
    ok(p.buyEnd === T + 25000 && gapOf(p, s, T + 2000).ms === 5000 && gapOf(p, s, T + 2000).why === 'buy',
      'two reads 1.8 s apart, their ends agreeing: asleep, a read every 5 s');
    // Read every 5 s while asleep, as it would be.
    for (const at of [T + 6000, T + 11000, T + 16000]) s = buyRead(p, at, (T + 25000 - at) / 1000);
    ok(gapOf(p, s, T + 25000 - 4001).ms === 5000 && gapOf(p, s, T + 25000 - 4000).ms === B,
      'until 4 s before the barriers drop, then the gap');
    p = new ReadCadence();
    p.applied(S({ phase: 'buy', clock: '0:25', buyEndsAt: T + 25000 }), { at: T, phase: 'buy', clock: '0:25' });
    p.applied(S({ phase: 'buy', clock: '0:25', buyEndsAt: T + 27000 }), { at: T + 2000, phase: 'buy', clock: '0:25' });
    ok(p.buyEnd === null, 'the same clock read twice is one read, never a confirmation (a still number misread twice)');
    p = new ReadCadence();
    buyRead(p, T, 25);
    buyRead(p, T + 3100, 24);
    ok(p.buyEnd === null, 'ends 2.1 s apart do not agree');
    p = new ReadCadence();
    buyRead(p, T, 25);
    buyRead(p, T + 3000, 24);
    ok(p.buyEnd === T + 27000, 'ends 2 s apart do, the later one kept');
    // A read whose clock did not set the ledger's end (no clock, or the ledger took it as a misread).
    p = new ReadCadence();
    buyRead(p, T, 25);
    p.applied(S({ phase: 'buy', clock: '0:24', buyEndsAt: T + 26000 }), { at: T + 2000, phase: 'buy' });
    ok(p.buyEnd === null, 'a buy read with no clock of its own confirms nothing, whatever the ledger held');
    p.applied(S({ phase: 'buy', clock: '0:23', buyEndsAt: T + 25000 }), { at: T + 3000, phase: 'buy', clock: '0:21' });
    ok(p.buyEnd === null, 'nor one whose clock the ledger did not take');
    // Woken. Asleep on a buy phase ending at T + 25 s; each read 5 s in, the
    // buy timer reading 0:20 then.
    const sleeping = () => { const q = new ReadCadence(); buyRead(q, T, 25); buyRead(q, T + 2000, 23); return q; };
    const WAKES = [
      ['a post plant read', 5000, S({ phase: 'postplant' }), { phase: 'postplant' }],
      ['a planted spike', 5000, S({ phase: 'active', clock: '0:20' }), { phase: 'active', spike: 'planted', clock: '0:20' }],
      ['the player held dead', 5000, S({ phase: 'dead', alive: false }), { phase: 'dead' }],
      ['an active read with no clock', 5000, S(), { phase: 'active' }],
      ['an active read over 0:45', 5000, S(), { phase: 'active', clock: '1:39' }],
      ['an active read 3.1 s off the buy timer', 5100, S(), { phase: 'active', clock: '0:23' }],
      ['a buy timer 3.1 s off', 4900, S({ phase: 'buy' }), { phase: 'buy', clock: '0:17' }],
    ];
    for (const [what, dt, st, read] of WAKES) {
      const q = sleeping();
      q.applied(st, { at: T + dt, ...read });
      ok(q.buyEnd === null, `woken by ${what}`);
    }
    const STAYS = [
      ['a LOBBY reply (the shop)', 5000, S({ inLobby: true }), { lobby: true }],
      ['a buy read with no clock', 5000, S({ phase: 'buy' }), { phase: 'buy' }],
      ['an active read on the buy timer, 3 s off', 5000, S({ phase: 'active', clock: '0:23' }), { phase: 'active', clock: '0:23' }],
      ['a buy read on its own timer', 5000, S({ phase: 'buy', clock: '0:20' }), { phase: 'buy', clock: '0:20' }],
    ];
    for (const [what, dt, st, read] of STAYS) {
      const q = sleeping();
      q.applied(st, { at: T + dt, ...read });
      ok(q.buyEnd === T + 25000, `not woken by ${what}`);
    }
    // Asleep only in the buy phase and its shop.
    const q = sleeping();
    ok(gapOf(q, S({ phase: 'active', clock: '0:21' }), T + 6000).ms === B,
      'asleep only while the context is the buy phase or a menu: an active read held is the gap');
    ok(gapOf(q, S({ inLobby: true, rounds: 4 }), T + 6000).ms === 5000, 'the shop inside a confirmed buy phase: every 5 s');
    // And only while the engine's own combat report window (buyUntil) reaches
    // the end of the sleep, 4 s before the barriers drop at T + 25 s.
    const until = (u) => S({ phase: 'buy', clock: '0:19', buyUntil: u });
    ok(gapOf(q, until(T + 27000), T + 6000).ms === 5000 && gapOf(q, until(T + 21000), T + 6000).ms === 5000,
      'asleep while the engine\'s buy window reaches the end of the sleep');
    ok(gapOf(q, until(T + 20999), T + 6000).ms === B && gapOf(q, until(0), T + 6000).ms === B,
      'and the gap once a buy read with no clock cut that window short, or before it was ever set');
  }
  {
    console.log('\nthe mode, told in round 5\'s buy phase:');
    // Dead, ten seconds after the death, on the spectator screen.
    const deadAt = (team, enemy, mode, o) => S({ team, enemy, mode, phase: 'dead', alive: false, lastDeathAt: T - 10000, ...(o || {}) });
    const p = new ReadCadence();
    p.applied(deadAt(1, 1, null), { at: T - 1000, phase: 'dead', aliveTell: 'Spectating teammate' });
    ok(gapOf(p, deadAt(1, 1, null), T).ms === 3000, 'round 3, the mode unknown, dead: every 3 s');
    ok(gapOf(p, deadAt(2, 1, null), T).ms === B && gapOf(p, deadAt(2, 1, null), T).why === 'mode', 'round 4, the mode unknown: the gap');
    ok(gapOf(p, deadAt(2, 2, null), T).ms === B, 'round 5: the gap');
    ok(gapOf(p, deadAt(3, 2, null), T).ms === 3000, 'round 6: every 3 s again');
    ok(gapOf(p, deadAt(2, 1, 'standard'), T).ms === 3000 && gapOf(p, deadAt(2, 2, 'swiftplay'), T).ms === 3000,
      'and rounds 4 and 5 of a match whose mode is locked: every 3 s');
    const ps = new ReadCadence();
    ps.applied(deadAt(1, 1, null), { at: T - 1000, phase: 'dead', aliveTell: 'Spectating teammate', team: 2, enemy: 1 });
    ok(gapOf(ps, deadAt(1, 1, null), T).ms === B, 'a read printing 2 to 1 opens round 4\'s window before the context takes the step');
    ps.applied(deadAt(1, 1, null), { at: T - 500, phase: 'dead', aliveTell: 'Spectating teammate', team: 9, enemy: 9 });
    ok(gapOf(ps, deadAt(2, 1, null), T).ms === B, 'and a misread score never closes it: the context\'s 2 to 1 still holds it open');
    // The buy phases of rounds 4 to 9 never sleep while the mode is unknown.
    const buyAt = (team, enemy, mode) => {
      const q = new ReadCadence();
      const st = (at, left) => S({ phase: 'buy', clock: fmt(left), bought: true, buyEndsAt: at + left * 1000, team, enemy, mode });
      q.applied(st(T, 25), { at: T, phase: 'buy', clock: '0:25' });
      q.applied(st(T + 2000, 23), { at: T + 2000, phase: 'buy', clock: '0:23' });
      return gapOf(q, st(T + 2000, 23), T + 3000).ms;
    };
    ok(buyAt(1, 1, null) === 5000 && buyAt(4, 5, 'standard') === 5000, 'a confirmed buy phase sleeps in round 3, or once the mode is locked');
    ok([[2, 1], [2, 2], [3, 2], [4, 3], [4, 4]].every(([t, e]) => buyAt(t, e, null) === B),
      'and never in rounds 4 to 9 while the mode is unknown (round 5 tells it, rounds 5 to 8 count the side swap)');
    ok(buyAt(5, 4, null) === 5000, 'round 10 sleeps again');
  }
  {
    console.log('\ndead or spectating:');
    const SPEC = 'Spectating teammate with SWITCH PLAYER bottom left';
    const dead = (o) => S({ phase: 'dead', alive: false, lastDeathAt: T, team: 3, enemy: 6, ...(o || {}) });
    const p = new ReadCadence();
    p.applied(dead(), { at: T + 100, phase: 'dead', aliveTell: SPEC });
    ok(gapOf(p, dead(), T + 4999).ms === B && gapOf(p, dead(), T + 5000).ms === 3000,
      'the gap for 5 s after the death (the frame after it is Riot\'s look\'s), then every 3 s');
    ok(gapOf(p, dead({ onTrial: true }), T + 6000).ms === B, 'the gap while a weak tell\'s death is on trial');
    ok(gapOf(p, dead({ unsettled: true }), T + 6000).ms === B, 'and while a score step or a final waits for its second read');
    ok(gapOf(p, dead({ team: 12, enemy: 6 }), T + 6000).ms === B && gapOf(p, dead({ team: 6, enemy: 12, mode: null }), T + 6000).ms === B,
      'and at match point, a team on 12');
    ok(gapOf(p, dead({ team: 4, enemy: 2, mode: 'swiftplay' }), T + 6000).ms === B && gapOf(p, dead({ team: 4, enemy: 2, mode: null }), T + 6000).ms === B
      && gapOf(p, dead({ team: 4, enemy: 2, mode: 'standard' }), T + 6000).ms === 3000,
    'a team on 4 is match point in a swiftplay or a match of no known mode, never a standard one');
    ok(gapOf(p, dead({ team: 11, enemy: 11 }), T + 6000).ms === 3000 && gapOf(p, dead({ team: 13, enemy: 12 }), T + 6000).ms === B,
      '11 to 11 is not match point, overtime is');
    const tells = [
      ['own HP 100 and Vandal bottom left', B, 'a tell that is neither screen (a revive, a misread): the gap'],
      ['SPECTATORS 1 top right', B, 'the spectator counter, a living player\'s HUD: the gap'],
      ['Spectating teammate, own HP not shown', 3000, 'the spectator screen: every 3 s'],
      ['KILLED BY Jett and COMBAT REPORT shown', 3000, 'the death screen: every 3 s'],
    ];
    for (const [tell, want, what] of tells) {
      const q = new ReadCadence();
      q.applied(dead(), { at: T + 100, phase: 'dead', aliveTell: tell });
      ok(gapOf(q, dead(), T + 6000).ms === want, what);
    }
    ok(gapOf(p, S({ lastDeathAt: T }), T + 6000).ms === B, 'alive again (a buy read, an alive read): the gap');
    ok(['KILLED BY Jett', 'COMBAT REPORT', 'SWITCH PLAYER', 'killcam', 'death recap'].every((t) => DEATH_SCREEN.test(t))
      && !DEATH_SCREEN.test('own HP 100 and Vandal'), 'the death screen\'s words are matched, a living HUD is not');
    ok(matchPoint(12, 0, 'standard') && matchPoint(0, 12, null) && matchPoint(4, 0, 'swiftplay') && !matchPoint(4, 0, 'standard')
      && !matchPoint(11, 11, 'standard') && matchPoint(12, 12, 'standard') && !matchPoint(3, 3, 'swiftplay'),
    'match point at its edges');
  }

  // ══ 1b. What the engine hands the cadence, and what tick() does with it ════
  {
    console.log('\nthe engine\'s state, as the cadence decides on it:');
    events = [];
    clock = T0;
    let captured = 0;
    const e = makeEngine({ capture: () => { captured++; return Promise.resolve('x'); }, record: () => {} });
    const read = (s, ctx) => {
      clock = T0 + s * 1000;
      mute();
      try { e.applyRead({ data: ctx === 'LOBBY' ? { lobby: true, context: {} } : { lobby: false, context: { ...ctx } }, shot: null, at: clock }); } finally { unmute(); }
    };
    net = server(() => ({ data: { lobby: true, context: {} } }), () => 500);
    const live = { phase: 'active', clock: '1:20', teamScore: 0, enemyScore: 0, playerAlive: true, playerHp: 100, playerWeapon: 'Vandal',
      aliveTell: 'own HP 100 and Vandal bottom left', side: 'attacking' };
    read(1, live);
    let st = e.cadenceState();
    ok(st.reads === 1 && !st.inLobby && !st.ended && st.rounds === 1 && st.team === 0 && st.enemy === 0 && st.phase === 'active' && st.alive === true
      && st.lastDeathAt === 0 && !st.onTrial && !st.unsettled, 'a live read: one read, in a match, alive, nothing pending');
    read(2, { ...live, teamScore: 1 });
    ok(e.cadenceState().unsettled && e.readCadence.printed === 1 && e.cadenceState().team === 0,
      'a score step read once: unsettled, and the cadence holds the score it printed before the guards took it');
    read(3, { ...live, teamScore: 1 });
    read(50, { ...live, teamScore: 1, phase: 'buy', clock: '0:25' });
    st = e.cadenceState();
    ok(st.bought && st.buyEndsAt === T0 + 50000 + 25000 && !st.unsettled, 'a buy read with its timer: the ledger\'s buy phase and when its barriers drop');
    read(52, { ...live, teamScore: 1, phase: 'buy', clock: '0:23' });
    ok(e.readCadence.buyEnd === T0 + 75000, 'a second one 2 s on, another second of the timer: the buy phase confirmed');
    clock = T0 + 52000;
    e.lastSendAt = clock;
    e.skipMark = clock;
    e.skipped = {};
    mute();
    try { for (let k = 1; k <= 25; k++) { clock = T0 + 52000 + k * 200; e.tick(); } } finally { unmute(); }
    await flush();
    ok(captured === 1 && e.skipped.buy === 4, `tick() holds a confirmed buy phase to a read every 5 s, the four the gap would have sent counted as skipped (${captured} read, ${JSON.stringify(e.skipped)})`);
    ok(/^4 reads skipped by phase \(buy 4\)$/.test(e.skippedSince()) && e.skippedSince() === 'no read skipped by phase',
      'and the capture log\'s line says so, once');
    mute();
    try { await runOut(); } finally { unmute(); }
    read(60, { ...live, teamScore: 1, phase: 'dead', playerAlive: false, playerHp: null, aliveTell: 'Spectating teammate, own HP not shown', clock: '1:30' });
    st = e.cadenceState();
    ok(st.lastDeathAt === T0 + 60000 && st.onTrial && st.alive === false, 'a death on a weak tell: dead, on trial');
    read(61, { ...live, teamScore: 1, phase: 'dead', playerAlive: false, playerHp: null, aliveTell: 'Spectating teammate', clock: '1:29' });
    ok(!e.cadenceState().onTrial, 'judged by the next read');
    read(62, 'LOBBY');
    ok(e.cadenceState().inLobby && e.readCadence.lobbyN === 1, 'a LOBBY reply: in a menu, one in a row');
  }
  {
    // THE ENGINE'S BUY WINDOW, WHICH THE SLEEP HOLDS ON. A dead read is the
    // combat report of the round before until a buy timer read runs out
    // (coaching-engine.js buyUntil). A buy read with no clock never cuts short
    // a window two clocked reads agree on, and cuts one a single read opened
    // to 2 s, since that read can be a misread mid round.
    events = [];
    clock = T0;
    const engineAt = () => {
      const e = makeEngine({ capture: () => Promise.resolve('x'), record: () => {} });
      const read = (s, ctx) => {
        clock = T0 + s * 1000;
        mute();
        try { e.applyRead({ data: { lobby: false, context: { ...ctx } }, shot: null, at: clock }); } finally { unmute(); }
      };
      const gap = (s) => e.readCadence.gap(e.cadenceState(), T0 + s * 1000, e.gapMs);
      return { e, read, gap };
    };
    const b = { phase: 'buy', teamScore: 6, enemyScore: 3, playerAlive: true, playerHp: 100, playerWeapon: 'Classic',
      aliveTell: 'own HP 100 and Classic bottom left', side: 'attacking' };
    {
      const { e, read, gap } = engineAt();
      read(10, { ...b, clock: '0:25' });
      read(12, { ...b, clock: '0:23' });
      ok(e.cadenceState().buyUntil === T0 + 37000 && e.readCadence.buyEnd === T0 + 35000 && gap(13).ms === 5000,
        'the engine\'s buy window runs to the timer\'s end and 2 s more, the cadence asleep on it');
      read(17, { ...b, clock: undefined });
      ok(e.cadenceState().buyUntil === T0 + 37000 && gap(17.5).ms === 5000,
        'a buy read with no clock leaves a window two clocked reads agree on: asleep still');
      read(18, { ...b, clock: '0:17' });
      ok(e.cadenceState().buyUntil === T0 + 37000 && gap(19).ms === 5000, 'and the clocked read after it keeps it: asleep');
    }
    {
      const { e, read, gap } = engineAt();
      read(10, { ...b, clock: '0:25' });
      read(13, { ...b, clock: undefined });
      ok(e.cadenceState().buyUntil === T0 + 15000 && gap(13.5).ms === 1000,
        'one clocked read\'s window a buy read with no clock cuts to 2 s, and the buy phase is read at the gap');
    }
    {
      // The same clock text twice is one read, never two agreeing ones.
      const { e, read } = engineAt();
      read(10, { ...b, clock: '0:25' });
      read(10.4, { ...b, clock: '0:25' });
      read(13, { ...b, clock: undefined });
      ok(e.cadenceState().buyUntil === T0 + 15000, 'the same clock read twice opens no window a clockless read cannot cut');
    }
    {
      // Two misread timers that agree by chance, in a post plant: the round
      // ledger took neither for a buy phase (valorant-rounds.js buyVerdict),
      // its buy end still the last real one's, so a buy read with no clock
      // cuts their window as it cuts one read's, and the death after it counts.
      const { e, read } = engineAt();
      read(10, { ...b, clock: '0:25' });
      read(40, { ...b, phase: 'active', clock: '1:39', playerWeapon: 'Vandal', aliveTell: 'own HP 100 and Vandal bottom left' });
      read(70, { ...b, phase: 'active', clock: '1:09', playerWeapon: 'Vandal', aliveTell: 'own HP 100 and Vandal bottom left' });
      read(80, { ...b, phase: 'postplant', spike: 'planted', playerWeapon: 'Vandal', aliveTell: 'own HP 100 and Vandal bottom left' });
      read(85, { ...b, clock: '0:19', playerWeapon: 'Vandal', aliveTell: 'own HP 100 and Vandal bottom left' });
      read(86, { ...b, clock: '0:18', playerWeapon: 'Vandal', aliveTell: 'own HP 100 and Vandal bottom left' });
      read(88, { ...b, clock: undefined, playerWeapon: 'Vandal', aliveTell: 'own HP 100 and Vandal bottom left' });
      const cut = e.cadenceState().buyUntil;
      read(92, { phase: 'dead', teamScore: 6, enemyScore: 3, side: 'attacking', spike: 'planted', playerAlive: false,
        aliveTell: 'KILLED BY Jett and COMBAT REPORT, no own health' });
      ok(e.buyWindow && e.buyWindow.confirmed && cut === T0 + 90000 && e.lastDeathAt === T0 + 92000,
        `two post plant misreads that agree hold no window the ledger never opened: cut to 2 s, the death after it counted (${(cut - T0) / 1000} s, death at ${(e.lastDeathAt - T0) / 1000} s)`);
    }
  }

  // ══ 2. The edge cases, through the real engine and its heartbeat ═══════════
  console.log('\nthe edge cases, read every second against the cadence, through the real engine:');
  const outcomes = {};
  for (const [name, sc] of Object.entries(SCENARIOS)) {
    const a = await scenario(sc.steps(), { full: true });
    const b = await scenario(sc.steps());
    outcomes[name] = { a, b };
    const missed = [...a.live].filter((k) => !b.live.has(k));
    const endOk = a.endAt.length === b.endAt.length && a.ends === b.ends
      && a.endAt.every((t, i) => Math.abs(t - b.endAt[i]) <= (sc.endWithin || 5));
    ok(a.deaths === b.deaths && a.rounds === b.rounds && a.notes === b.notes && endOk && missed.length <= (sc.lost || 0),
      `${name}: ${a.sends.length} reads, ${b.sends.length} with the cadence; the same deaths (${b.deaths || 'none'}), rounds (${b.rounds || 'none'})`
      + ` and end (${b.ends || 'none'}${b.endAt.length ? ` at ${b.endAt.map((t, i) => `${t.toFixed(1)} s, ${(t - a.endAt[i] >= 0 ? '+' : '') + (t - a.endAt[i]).toFixed(1)}`).join('; ')}` : ''})`
      + `${missed.length ? `, ${missed.length} live second${missed.length === 1 ? '' : 's'} unread (${missed.join(', ')})` : ', every live second read'}`
      + (a.deaths !== b.deaths ? ` [deaths ${a.deaths} -> ${b.deaths}]` : '') + (a.rounds !== b.rounds ? ` [rounds ${a.rounds} -> ${b.rounds}]` : '')
      + (!endOk ? ` [end ${a.ends} ${a.endAt} -> ${b.ends} ${b.endAt}]` : '') + (a.notes !== b.notes ? ` [notes ${a.notes} -> ${b.notes}]` : ''));
  }
  {
    // What the coach saw: each round's last three notes of play, frozen at the death.
    const { a, b } = outcomes['a standard match to 13 to 11'];
    const filled = b.notes.split(' / ').filter((x) => x.split('|').length === 3).length;
    ok(a.notes === b.notes && filled >= 20, `the notes each round keeps are the same, ${filled} rounds of three (round 1: ${b.notes.split(' / ')[0]})`);
  }
  {
    // The pinned speed is the floor: read every 2 s, the cadence never reads faster.
    const steps = SCENARIOS['a standard match to 13 to 11'].steps();
    const a = await scenario(steps, { full: true, speed: 2000 });
    const b = await scenario(steps, { speed: 2000 });
    const fastest = Math.min(...b.sends.slice(1).map((k, i) => k - b.sends[i]));
    // Read every 2 s, each run reads its own half of each step: a death
    // registers on the first dead second either reads, one gap apart at most.
    const da = a.deaths.split(',').map(Number);
    const db = b.deaths.split(',').map(Number);
    const near = da.length === db.length && da.every((t, i) => Math.abs(t - db[i]) <= 2);
    ok(near && a.rounds === b.rounds && a.ends === b.ends && fastest >= 2 && b.sends.length < a.sends.length * 0.8,
      `pinned at 2 s: never faster than 2 s (${fastest} s at the closest), ${a.sends.length} reads to ${b.sends.length}, the same rounds and end,`
      + ` each of the ${db.length} deaths within one gap of reading everything (${da.filter((t, i) => t !== db[i]).length} on the other second)`
      + (!near ? ` [deaths ${a.deaths} -> ${b.deaths}]` : '') + (a.rounds !== b.rounds ? ` [rounds ${a.rounds} -> ${b.rounds}]` : '')
      + (a.ends !== b.ends ? ` [end ${a.ends} -> ${b.ends}]` : ''));
  }
  {
    // What the cadence holds back, phase by phase, on the 13 to 11 match.
    const { a, b } = outcomes['a standard match to 13 to 11'];
    const kind = (x) => (x === 'LOBBY' ? 'menus' : !x ? 'none' : x.phase === 'buy' ? 'buy' : x.phase === 'dead' || x.playerAlive === false ? 'dead' : 'live');
    const count = (r) => r.sends.reduce((m, k) => { const p = kind(r.screens[k]); m[p] = (m[p] || 0) + 1; return m; }, {});
    const ca = count(a);
    const cb = count(b);
    ok(cb.buy <= ca.buy * 0.55 && cb.dead <= ca.dead * 0.6 && cb.menus <= ca.menus * 0.5 && cb.live >= ca.live,
      `the 13 to 11 match: buy phases ${ca.buy} reads to ${cb.buy}, dead ${ca.dead} to ${cb.dead}, menus ${ca.menus} to ${cb.menus}, the live round ${ca.live} to ${cb.live}`);
    // A hung read and an outage: nothing is applied, the state goes stale
    // past the phase's gap and 4 s, and the gap reads on.
    const hung = outcomes['a hung read while dead'];
    const hk = hung.b.special.hung;
    const during = (r, from, to) => r.sends.filter((k) => k > from && k < to).length;
    ok(hk !== undefined && during(hung.b, hk, hk + 12) >= 7,
      `a read hung for 12 s while dead: the state goes stale and the gap reads on behind it (${during(hung.b, hk, hk + 12)} reads in those 12 s, `
      + `${during(hung.a, hung.a.special.hung, hung.a.special.hung + 12)} reading everything)`);
    const down = outcomes['the server down for 20 s while dead'];
    ok(during(down.b, down.b.failFrom + 8, down.b.failTo) >= 11,
      `the server down for 20 s while dead: from 7 s after the last reply landed, the gap (${during(down.b, down.b.failFrom, down.b.failTo)} reads in the 20 s)`);
    // A 429: nothing for ten seconds from the refusal, then a read at once.
    const q = outcomes['a 429 in a buy phase'].b;
    const qr = q.special.refusedReply;
    const quiet = q.sendTimes.filter((t) => t > qr && t < qr + 10000);
    const back = q.sendTimes.find((t) => t >= qr + 10000);
    ok(Number.isFinite(qr) && !quiet.length && back !== undefined && back - (qr + 10000) <= 200,
      `a 429 in a buy phase: nothing for the ten seconds after the refusal, then a read ${back === undefined ? 'never' : `${Math.round(back - qr - 10000)} ms after`}`);
    // ROUND 4'S BUY PHASE, READ WHOLE FROM THE FIRST READ OF ITS SCORE. The
    // score lags the round: round 3's banner went unread and round 4's buy
    // phase began on the old score, so the context said round 3 and the
    // buy phase slept. The first read of the new score is a step held for a
    // second read, its digits out of the context, and the score it printed
    // is what opens the window, a sleeping read sooner.
    const lagged = [...round(0, 0, { t2: 1, e2: 0 }), ...round(1, 0, { t2: 1, e2: 1 }),
      [30, buy(1, 1)], [20, alive(1, 1)], [40, dead(1, 1, 79)], [4, buy(1, 1)], [26, (i) => buy(2, 1)(4 + i)], [20, alive(2, 1)]];
    const lg = await scenario(lagged, { seed: 4 });
    const buyAt = secondsOf(lagged.slice(0, -3));
    const first21 = lg.sends.find((k) => k >= buyAt + 4);
    const after21 = lg.sends.filter((k) => k > first21 && k < buyAt + 30 - 4).length;
    ok(first21 !== undefined && after21 >= buyAt + 30 - 4 - first21 - 2,
      `round 4's buy phase begun on round 3's score: from its first read of 2 to 1 (${first21 - buyAt} s in), read at the gap (${after21} reads in the ${buyAt + 30 - 4 - first21 - 1} s to its last 4)`);
    // THE KNOWN EXPOSURE: Stop pressed on a round's banner while dead, outside
    // match point. Read every 3 s, the banner's score can be read once before
    // the stop, and a step needs two reads: that last round keeps no result.
    // Read on into the next buy phase, it has its result.
    const banner2 = [...round(5, 3, { t2: 6, e2: 3 }), [30, buy(6, 3)], [20, alive(6, 3)], [40, dead(6, 3, 79)], [3, banner(6, 4)]];
    const results = async (steps) => {
      const a2 = await scenario(steps, { full: true, seed: 3 });
      const b2 = await scenario(steps, { seed: 3 });
      return [a2.rounds, b2.rounds];
    };
    const [onBanner, onBuy] = [await results(banner2), await results([...banner2, [10, buy(6, 4)]])];
    ok(onBuy[0] === onBuy[1] && /10l/.test(onBuy[1]),
      `the last round's result, read on into the next buy phase, is the same (${onBuy[1]}); stopped on its banner it was ${onBanner[1]}, reading everything ${onBanner[0]}`);
  }

  // ══ 3. The real sessions ═══════════════════════════════════════════════════
  console.log('\nthe real sessions, through the real engine at the cadence\'s own capture times:');
  const SESSIONS = [
    { name: 'sunset', file: 'valorant-session-sunset-swiftplay.json', riot: SUNSET_RIOT, after: 80 },
    { name: 'abyss swiftplay', file: 'valorant-session-abyss-swiftplay.json', riot: SWIFT_RIOT, after: 80 },
    { name: 'split', file: 'valorant-session-split-competitive.json', riot: FIX('riot-split-13-7.json'), after: 0 },
    { name: 'abyss unrated', file: 'valorant-session-abyss-unrated.json', riot: FIX('riot-abyss-13-11.json'), after: 80 },
  ];
  {
    // The accepted list, held to known differences and known refusals.
    const base = { deaths: [10, 20], deathRounds: [1, 2], invented: [2], modes: 'swiftplay@5', maps: [{ map: 'Haven', at: 1 }, { map: 'Sunset', at: 9 }],
      ends: [{ by: 'lobby', at: 100 }], screen: '1:9/10', rounds: [{ n: 1, plantSpot: 'A site', died: true }, { n: 2, died: true, spot: 'B' }],
      four: [{ n: 1, moment: 10.1, frames: '9/10.5' }], looks: [{ n: 1, moment: 10.1, frames: '9/10.5' }], drops: { 1: { at: 0.4, frames: 9, of: 9 } } };
    const like = (o) => ({ ...JSON.parse(JSON.stringify(base)), ...o });
    const accepted = unaccepted(base, like({ deaths: [10], deathRounds: [1], maps: [{ map: 'Sunset', at: 9 }], ends: [{ by: 'lobby', at: 104.9 }],
      rounds: [{ n: 1, plantSpot: 'A', died: true }, { n: 2, died: false, spot: null }], looks: [{ n: 1, moment: 9.8, frames: '9/10.5' }],
      drops: { 1: { at: 0.1, frames: 10, of: 10 } } }));
    const refusals = [
      like({ deaths: [10, 20, 30], deathRounds: [1, 2, 3] }), like({ deaths: [20], deathRounds: [2] }), like({ modes: 'swiftplay@9' }),
      like({ maps: [{ map: 'Sunset', at: 12 }] }), like({ ends: [{ by: 'lobby', at: 105.1 }] }), like({ rounds: [{ n: 1, plantSpot: 'B site', died: true }, base.rounds[1]] }),
      like({ looks: [{ n: 1, moment: 10.5, frames: '9/10.5' }] }), like({ looks: [{ n: 1, moment: 10.1, frames: '8/10.5' }] }), like({ screen: '1:8/10' }),
      like({ drops: { 1: { at: 0.8, frames: 9, of: 9 } } }), like({ four: [] }),
    ];
    const refused = refusals.map((b) => unaccepted(base, b).length);
    ok(!accepted.length && refused.every((n) => n > 0),
      `the accepted differences pass and every other one is refused (${accepted.length ? accepted.join('; ') : 'none left'}; refused ${refused.join(',')})`);
  }
  const DRAWS = process.env.READPOLICY_DRAWS ? JSON.parse(process.env.READPOLICY_DRAWS)
    : [[1.5, 7], [1.5, 108], [1.5, 115], [2.7, 7], [2.7, 108], [4.3, 7], [4.3, 108]];
  for (const S2 of SESSIONS) {
    const { slots } = sessionSlots(S2.file, { after: S2.after });
    const rows = [];
    let left = [];
    let readsA = 0;
    let readsB = 0;
    for (const [p90, seed] of DRAWS) {
      const a = outputsOf(await replay(slots, { full: true, seed, p90 }), S2.riot);
      const b = outputsOf(await replay(slots, { seed, p90 }), S2.riot);
      readsA += a.sent;
      readsB += b.sent;
      const d = diffOf(a, b).map((x) => x.text);
      const u = unaccepted(a, b);
      rows.push({ p90, seed, a, b, d });
      left = left.concat(u.map((x) => `p90 ${p90} seed ${seed}: ${x}`));
    }
    const kinds = [...new Set(rows.flatMap((r) => r.d.map((x) => x.replace(/[\d.,-]+/g, '#').replace(/R#/g, 'R'))))];
    ok(!left.length, `${S2.name}, ${DRAWS.length} latency draws (p90 ${[...new Set(DRAWS.map((x) => x[0]))].join(', ')} s): the kept reads `
      + `${readsA} to ${readsB}, ${(100 * (1 - readsB / readsA)).toFixed(1)}% fewer; the same deaths, rounds, results, mode, plants and looks`
      + (kinds.length ? `, and only the accepted differences (${[...new Set(rows.flatMap((r) => r.d))].length} of them: ${kinds.slice(0, 6).join('; ')})` : ', and no difference at all')
      + (left.length ? ` [NOT ACCEPTED: ${left.slice(0, 6).join(' | ')}]` : ''));
    // Who died where, against Riot: reading everything and the cadence alike.
    const one = rows[0];
    ok(JSON.stringify(one.a.four) === JSON.stringify(one.b.four) || one.a.four === undefined,
      `${S2.name}: the four looks are the same deaths and the same frames (${(one.b.four || []).map((l) => `R${l.n} ${l.frames}`).join(', ') || 'none'})`);
  }
  {
    // THE READS SAVED, phase by phase, at a read a second: every read the
    // session sent, the thinned ones filled from their neighbours, and the
    // 8.0.1 sessions, read every 2 s, counted on a 1 s grid.
    const COUNT = [
      { name: 'sunset', file: 'valorant-session-sunset-swiftplay.json', step: 0, after: 80, min: 0.32 },
      { name: 'abyss swiftplay', file: 'valorant-session-abyss-swiftplay.json', step: 1000, after: 80, min: 0.32 },
      { name: 'split', file: 'valorant-session-split-competitive.json', step: 1000, after: 0, min: 0.3 },
    ];
    for (const c of COUNT) {
      const { slots } = sessionSlots(c.file, { mode: 'accounting', step: c.step, after: c.after });
      const a = await replay(slots, { full: true, seed: 7, p90: 1.5 });
      const b = await replay(slots, { seed: 7, p90: 1.5 });
      const saved = 1 - b.sent.length / a.sent.length;
      const by = Object.keys(a.phases).sort((x, y) => a.phases[y] - a.phases[x]).map((p) => `${p} ${a.phases[p]} to ${b.phases[p] || 0}`);
      const live = (r) => (r.phases.live || 0) + (r.phases['post plant'] || 0);
      // The buy phase at under 0.7 of its reads: asleep on two agreeing timers,
      // and only while the engine's own buy window covers the sleep, which the
      // Split's buy reads with no clock (each one twice on the 1 s grid) cost
      // 5 of its 612 (393 to 398).
      ok(saved >= c.min && live(b) >= live(a) - 4 && (b.phases.buy || 0) < (a.phases.buy || 0) * 0.7 && (b.phases.dead || 0) < (a.phases.dead || 0) * 0.85,
        `${c.name}, every read a second: ${a.sent.length} reads to ${b.sent.length}, ${(100 * saved).toFixed(1)}% fewer (${by.join(', ')})`);
    }
  }

  unmute();
  ok(fetched === 0, `and nothing tried the network (${fetched} fetches)`);
  console.log(`\n${fails ? fails + ' of ' + checks + ' failed' : 'all ' + checks + ' read policy checks passed'}`);
  Date.now = realNow;
  process.exit(fails ? 1 : 0);
}

module.exports = { sessionSlots, replay, outputsOf, diffOf, scenario, SCENARIOS, phaseOf, latencies };

if (require.main === module) {
  main().catch((e) => {
    unmute();
    Date.now = realNow;
    console.log('FAIL  the read policy test threw:', e && e.stack ? e.stack : e);
    process.exit(1);
  });
}
