'use strict';

/**
 * A READ RUN SCORED BY TIME AGAINST RIOT'S RECORD (8.4.3), the judge's scorer
 * of 14 Oct 2026 made reusable: bench-read.js --engine scores its own run with
 * it, npm run bench:sessions scores every run with it, and its own test
 * (test-read-score.js) holds it.
 *
 * Why by time. bench-read.js's default run files each read into a round by the
 * score it carries and compares rounds with the Abyss record, so on any other
 * session its deaths and its gate mean nothing, and a ledger a round out
 * counts a death caught as one missed and one invented. Here nothing the run
 * read decides where Riot's rounds are:
 *
 *   the drops    when each round's barriers dropped, on the wall clock, from
 *                every run's clocked reads of the same frames: a read with S
 *                seconds of the round clock left (over 45, not a buy read, not
 *                after a plant) was taken 99 - S to 100 - S seconds after the
 *                drop, each frame and clock one vote however many runs read it
 *                so, and a round is where the spans of many frames meet. Each
 *                cluster is numbered by the score most runs read on its frames
 *   Riot's death the drop plus Riot's milliseconds (the Abyss and the Split),
 *                or Riot's whole second (the Sunset and the Fracture, kept as
 *                the review rounds them, wholeSeconds)
 *   a catch      a death the run's REAL ENGINE registered (replay below), from
 *                5 s before Riot's moment (the app's own early rule) to the next
 *                buy phase, and still standing: one on a weak tell the next read
 *                withdrew is no catch. A registration no death owns is invented
 *   a verdict    each frame's raw reply against Riot at that moment: alive in a
 *                buy phase, alive or dead in play, nothing within 1.5 s of
 *                Riot's death or 2.5 s of a buy phase starting
 *
 * Every run is replayed through coaching-engine.js on the clock its frames
 * were captured on, network stubbed, replies in capture order, a failed read
 * skipped and a LOBBY applied as a menu, which is what drain() does
 * (AppReader). So a run read by the default bench (its context the replies
 * merged raw) and one read by --engine (the engine's readContext()) are scored
 * by the same guards; only what each was SENT differs.
 *
 * Offline: nothing here calls the network or reads a secret.
 *
 *   node scripts/read-score.js <session> name=trace.jsonl [name=trace.jsonl ...] [--json out.json]
 *
 * <session> is abyss, split, sunset or fracture (or its folder's name), read
 * from userData/bench first, then the AI log (profile-path.js benchSession);
 * the AI log's own reads are scored beside the traces as "logged", and count
 * towards the drops like every run.
 */

const fs = require('fs');
const path = require('path');
const Module = require('module');
const { clockSeconds } = require('../src/shared/valorant-rounds');
const spectate = require('../src/shared/spectate-tells');

const REPO = path.join(__dirname, '..');
const FIXTURES = path.join(__dirname, 'fixtures');

/*
 * THE FOUR REAL SESSIONS the read is benched on, each with Riot's record of
 * its match and the public fixture of the AI log's reads of it.
 */
const SESSIONS = {
  abyss: { id: 'session-2026-09-22T04-24-07-240Z', map: 'Abyss', riot: 'riot-abyss-13-11.json', fixture: 'valorant-session-abyss-unrated.json' },
  split: { id: 'session-2026-10-04T23-06-29-175Z', map: 'Split', riot: 'riot-split-13-7.json', fixture: 'valorant-session-split-competitive.json' },
  sunset: { id: 'session-2026-10-12T03-13-18-396Z', map: 'Sunset', riot: 'riot-sunset-2-5.json', fixture: 'valorant-session-sunset-swiftplay.json' },
  fracture: { id: 'session-2026-10-14T00-24-51-649Z', map: 'Fracture', riot: 'riot-fracture-5-1.json', fixture: 'valorant-session-fracture-swiftplay.json' },
};

/** A session by its name or its folder's, as { name, id, map, riot, fixture }, or null. */
function sessionOf(x) {
  const k = String(x || '').trim();
  if (SESSIONS[k.toLowerCase()]) return { name: k.toLowerCase(), ...SESSIONS[k.toLowerCase()] };
  const hit = Object.entries(SESSIONS).find(([, s]) => s.id === k);
  return hit ? { name: hit[0], ...hit[1] } : null;
}

/** Riot's record of a session's match, from scripts/fixtures. */
function riotRecord(session) {
  const s = typeof session === 'string' ? sessionOf(session) : session;
  if (!s) return null;
  return JSON.parse(fs.readFileSync(path.join(FIXTURES, s.riot), 'utf8'));
}

// ── the runs ────────────────────────────────────────────────────────────────

/** A --trace file: its reads in the order sent, and its summary line. */
function readTraceFile(file) {
  const reads = [];
  let summary = null;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    if (!line.trim()) continue;
    const o = JSON.parse(line);
    if (o.summary) { summary = o; continue; }
    reads.push(o);
  }
  return { reads, summary };
}

/**
 * The AI log's own reads as a run: what the live read answered at the time,
 * its context as the guards left it (updateMatchContext edits the reply it is
 * handed, and the log keeps that object).
 */
function traceOfLog(records) {
  const sorted = (records || []).map((r, k) => ({ r, k })).sort((a, b) => a.r.at - b.r.at || a.k - b.k).map((x) => x.r);
  return { reads: sorted.map((r, k) => ({ i: k + 1, frame: r.frame, at: r.at, ms: null, err: null, lobby: false, parsed: true, context: r.state || {} })), summary: null };
}

/** A public session fixture ({ frames: [{ t, ...context }] }) as a run, its frame t seconds in at t0 + t s. */
function traceOfFixture(fixture, t0) {
  return { reads: fixture.frames.map((f, k) => {
    const { t, ...context } = f;
    return { i: k + 1, frame: `frame-${String(k).padStart(5, '0')}.jpg`, at: t0 + t * 1000, ms: null, err: null, lobby: false, parsed: true, context };
  }), summary: null };
}

/** The real reader, its network stubbed: no call it makes ever leaves the process, or answers. */
function engineClass() {
  const realLoad = Module._load;
  Module._load = function patched(request, parent, isMain) {
    // Never answered: a match review the engine asks for at a match's end
    // waits for good, so nothing it logs afterwards lands in a bench's output.
    if (request === './api-client') return { post: () => new Promise(() => {}), get: () => new Promise(() => {}) };
    return realLoad(request, parent, isMain);
  };
  // A fresh copy, whoever loaded the engine first, so the stub is the one it holds.
  const file = require.resolve(path.join(REPO, 'src', 'main', 'services', 'coaching-engine.js'));
  delete require.cache[file];
  try {
    return require(file);
  } finally {
    Module._load = realLoad;
  }
}

/**
 * THE APP'S READER, ON THE CAPTURE CLOCK. One coaching-engine.js, started as
 * the app starts it, its heartbeat stopped (no read is sent by it) and no
 * agent looked for: since 8.4.4 the look sends a read's own frame of the
 * player's HUD to detect-agent, a network call, and no frame is given here, so
 * the context carries no agent, as in a match whose look never locked one.
 * Every call runs with Date.now at the frame's capture time and the engine's
 * log kept apart, synchronously, so two readers in one process never see each
 * other's clock or lines.
 *
 *   context(at)  what readContext() sends with a frame captured at `at`
 *   apply(read)  one reply, as drain() applies it: a failed read skipped, a
 *                LOBBY a menu, the rest through every guard. Returns what the
 *                engine made of it
 *   stop(at)     Stop pressed after the last frame: the match it was on ends
 */
class AppReader {
  constructor(at) {
    const Engine = engineClass();
    this.lines = [];
    this.ended = [];
    this.resumed = [];
    this.records = [];
    this.e = this.at(at, () => {
      const e = new Engine({ licenseKey: 'BENCH', captureFunction: async () => null, experiments: () => ({}),
        diagnostics: (d) => this.records.push({ at: d.at, state: d.state || {}, round: typeof d.round === 'number' ? d.round : null,
          died: !!d.died, match: d.match || null }) });
      e.on('match-ended', (snap) => this.ended.push({ at: this.clock, snap }));
      e.on('match-resumed', (r) => this.resumed.push({ at: this.clock, ...r }));
      e.start();
      clearInterval(e.loopTimer);
      e.loopTimer = null;
      return e;
    });
  }

  /** fn() with the clock at `at` and the engine's log lines kept apart. */
  at(at, fn) {
    const realNow = Date.now;
    const realLog = console.log;
    const realErr = console.error;
    this.clock = at;
    const bucket = [];
    Date.now = () => at;
    console.log = (...a) => { const s = a.join(' '); bucket.push(s); this.lines.push({ at, s }); };
    console.error = console.log;
    try {
      return fn(bucket);
    } finally {
      Date.now = realNow;
      console.log = realLog;
      console.error = realErr;
    }
  }

  context(at) {
    return this.at(at, () => this.e.readContext());
  }

  /**
   * @param read { frame, at, err, lobby, context } a trace line, or a reply
   *   ({ lobby, context, ... }) with its frame's `at`
   * @returns { registered, weak, withdrew, ... } what the engine made of it,
   *   or { err } for a failed read, which drain() never applies
   */
  apply(read) {
    if (read.err) return { frame: read.frame, at: read.at, err: read.err };
    const e = this.e;
    const raw = read.lobby ? null : JSON.parse(JSON.stringify(read.context || {}));
    return this.at(read.at, (bucket) => {
      const deathBefore = e.lastDeathAt;
      const trialBefore = e.onTrial;
      e.applyRead(read.lobby ? { data: { lobby: true, context: {} }, shot: null, at: read.at }
        : { data: { lobby: false, context: JSON.parse(JSON.stringify(read.context || {})) }, shot: null, at: read.at });
      const c = e.matchContext;
      const registered = e.lastDeathAt !== deathBefore;
      return {
        frame: read.frame, at: read.at, lobby: !!read.lobby, raw, ms: read.ms, serverMs: read.serverMs,
        registered,
        weak: registered && !!e.onTrial && e.onTrial.frame === e.analyzedFrames,
        // The death the read before this one left on trial, withdrawn by this read (judgeTrial).
        withdrew: !!(trialBefore && trialBefore.withdrawn),
        alive: c.playerAlive, phase: c.phase, team: c.teamScore | 0, enemy: c.enemyScore | 0,
        round: e.ledger.current(), match: e.matchStartedAt, map: c.map || null, mode: c.gameMode || null,
        spike: c.spike || null, clock: c.clock || null, lines: bucket.slice(),
      };
    });
  }

  stop(at) {
    return this.at(at, () => {
      const beforeStop = { ledger: this.e.ledger.list(), startedAt: this.e.matchStartedAt };
      this.e.stop();
      return beforeStop;
    });
  }
}

/** A run through the app's reader, in capture order: every frame's verdict, the matches it ended. */
function replay(trace) {
  const reads = trace.reads.map((r, k) => ({ r, k })).sort((a, b) => a.r.at - b.r.at || a.k - b.k).map((x) => x.r);
  const app = new AppReader(reads.length ? reads[0].at : 0);
  const frames = [];
  let last = null;
  for (const r of reads) {
    const f = app.apply(r);
    if (!f.err) {
      // The very next applied read is the one that judges a weak registration.
      if (f.withdrew && last && last.registered && last.weak) { last.withdrawn = true; last.withdrawnBy = f.frame; }
      last = f;
    }
    frames.push(f);
  }
  const beforeStop = app.stop(reads.length ? reads[reads.length - 1].at : 0);
  return { reads, frames, records: app.records, ended: app.ended, resumed: app.resumed, beforeStop, lines: app.lines };
}

// ── Riot's rounds on the wall clock ─────────────────────────────────────────

/** Every clocked read of the round clock as the span its barrier drop lies in, one vote a frame and clock. */
function spansOf(traces) {
  const seen = new Map();
  for (const t of traces) {
    for (const r of t.reads) {
      if (r.err || r.lobby || !r.context) continue;
      const c = r.context;
      if (c.phase === 'buy' || c.phase === 'postplant' || c.spike === 'planted') continue;
      const left = clockSeconds(c.clock);
      if (left === null || left <= 45 || left >= 100) continue;
      const k = `${r.frame}|${left}`;
      if (seen.has(k)) { seen.get(k).votes++; continue; }
      seen.set(k, { frame: r.frame, at: r.at, left, lo: r.at - (100 - left) * 1000, hi: r.at - (99 - left) * 1000, votes: 1 });
    }
  }
  return [...seen.values()].sort((a, b) => a.lo - b.lo);
}

/** Where most of the spans meet, a 300 ms margin each side, weighted by votes. */
function deepest(spans) {
  const edges = [];
  for (const s of spans) edges.push([s.lo - 300, s.votes], [s.hi + 300, -s.votes]);
  edges.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  let depth = 0;
  let best = 0;
  let where = null;
  for (let i = 0; i + 1 < edges.length; i++) {
    depth += edges[i][1];
    const a = edges[i][0];
    const b = edges[i + 1][0];
    if (b <= a || depth <= 0) continue;
    if (depth > best) { best = depth; where = [a, b]; }
  }
  return { best, where };
}

/** The barrier drops: spans more than 20 s apart are different rounds. */
function dropsOf(spans) {
  const clusters = [];
  for (const s of spans) {
    const c = clusters[clusters.length - 1];
    if (c && s.lo - c.maxLo <= 20000) { c.spans.push(s); c.maxLo = Math.max(c.maxLo, s.lo); } else clusters.push({ spans: [s], maxLo: s.lo });
  }
  return clusters.map((c) => {
    const frames = new Set(c.spans.map((s) => s.frame));
    const d = deepest(c.spans);
    const mid = d.where ? Math.round((d.where[0] + d.where[1]) / 2) : null;
    const agree = c.spans.filter((s) => s.lo - 300 <= mid && mid < s.hi + 300);
    return { at: mid, frames: frames.size, spans: c.spans.length, agree: agree.length, width: d.where ? d.where[1] - d.where[0] : null,
      firstFrame: c.spans[0].frame, lastFrame: c.spans[c.spans.length - 1].frame };
  });
}

/** Every run's read of each frame, by frame. */
function readsByFrame(traces) {
  const by = new Map();
  traces.forEach((t, k) => {
    for (const r of t.reads) {
      if (!by.has(r.frame)) by.set(r.frame, { frame: r.frame, at: r.at, reads: {} });
      by.get(r.frame).reads[k] = r;
    }
  });
  return by;
}

/** The score most runs read on a frame, or null. */
function consensusScore(entry) {
  const votes = {};
  for (const r of Object.values((entry && entry.reads) || {})) {
    const c = r && !r.err && !r.lobby ? r.context || {} : null;
    if (!c || typeof c.teamScore !== 'number' || typeof c.enemyScore !== 'number') continue;
    const k = `${c.teamScore}-${c.enemyScore}`;
    votes[k] = (votes[k] || 0) + 1;
  }
  const best = Object.entries(votes).sort((a, b) => b[1] - a[1])[0];
  return best ? { score: best[0], votes: best[1], of: Object.values(votes).reduce((a, b) => a + b, 0) } : null;
}

/**
 * Riot's rounds laid on the session's wall clock: each round's drop, numbered
 * by the score printed on its cluster's frames, so no run's ledger decides it,
 * and Riot's death as the drop plus Riot's time into the round.
 */
function roundsOnClock(riot, traces) {
  const by = readsByFrame(traces);
  const spans = spansOf(traces);
  const ds = dropsOf(spans);
  const numbered = ds.map((d) => {
    const frames = spans.filter((s) => s.lo - 300 <= d.at + 20000 && s.lo >= d.at - 25000).map((s) => s.frame);
    const tally = {};
    for (const f of new Set(frames)) {
      const cs = consensusScore(by.get(f));
      if (!cs) continue;
      const [t, e] = cs.score.split('-').map(Number);
      const n = t + e + 1;
      tally[n] = (tally[n] || 0) + 1;
    }
    const best = Object.entries(tally).sort((a, b) => b[1] - a[1])[0];
    return { ...d, n: best ? Number(best[0]) : null, tally };
  });
  const byN = {};
  for (const d of numbered) {
    if (d.n === null) continue;
    const cur = byN[d.n];
    if (!cur || d.frames * 10 + d.agree > cur.frames * 10 + cur.agree) byN[d.n] = d;
  }
  const rounds = riot.perRound.map((rr) => {
    const d = byN[rr.n] || null;
    const drop = d ? d.at : null;
    const moment = rr.died && drop !== null && Number.isFinite(rr.deathMs) ? drop + rr.deathMs : null;
    return { ...rr, drop, dropFrames: d ? d.frames : 0, dropAgree: d ? d.agree : 0, moment };
  });
  return { rounds, clusters: numbered };
}

/**
 * The pistol rounds, whose buy phase is 45 s where every other is 30: round 1
 * and the first round Riot's sides change (5 in a swiftplay, 13 otherwise).
 */
function pistolRounds(riot) {
  const per = riot.perRound || [];
  const first = per.find((r) => r.n === 1);
  const swap = first && first.side ? per.find((r) => r.n > 1 && r.side && r.side !== first.side) : null;
  return new Set([1, swap ? swap.n : /swift/i.test(String(riot.queue || '')) ? 5 : 13]);
}

const EDGE_MS = 1500;       // within this of Riot's death moment: no verdict
const BUY_EDGE_MS = 2500;   // within this of a buy phase's start: no verdict
const EARLY_MS = 5000;      // a registration this far before Riot's moment still catches it

/**
 * Riot's verdict on the player at any moment of the session, from the drops
 * of every run given (the more runs, the better each drop).
 *
 *   at(t)       { n, say: 'alive'|'dead'|'?', part: 'buy'|'play'|'after'|'menu'|'edge', why }
 *   deathAt(t)  the round whose death a registration at t is, or null
 */
function truthOf(riot, traces) {
  const { rounds, clusters } = roundsOnClock(riot, traces);
  const pistol = pistolRounds(riot);
  const buyLen = (n) => (pistol.has(n) ? 45000 : 30000);
  const R = rounds.filter((r) => r.drop !== null).sort((a, b) => a.drop - b.drop);
  const buyStart = (r) => r.drop - buyLen(r.n);
  function stateIn(r, t, part) {
    if (!r.died) return { n: r.n, say: 'alive', part, why: `Riot: survived round ${r.n}` };
    if (r.moment === null) return { n: r.n, say: '?', part, why: `Riot: died in round ${r.n}, not timed` };
    if (Math.abs(t - r.moment) < EDGE_MS) return { n: r.n, say: '?', part: 'edge', why: `within ${EDGE_MS / 1000} s of Riot's death in round ${r.n}` };
    return t > r.moment
      ? { n: r.n, say: 'dead', part, why: `Riot: died in round ${r.n} ${((t - r.moment) / 1000).toFixed(1)} s earlier` }
      : { n: r.n, say: 'alive', part, why: `Riot: dies in round ${r.n} ${((r.moment - t) / 1000).toFixed(1)} s later` };
  }
  function at(t) {
    if (!R.length || t < buyStart(R[0]) - BUY_EDGE_MS) return { n: null, say: '?', part: 'menu', why: 'before round 1' };
    let k = 0;
    for (let i = 0; i < R.length; i++) if (buyStart(R[i]) - BUY_EDGE_MS <= t) k = i;
    const r = R[k];
    const bs = buyStart(r);
    if (Math.abs(t - bs) < BUY_EDGE_MS) return { n: r.n, say: '?', part: 'edge', why: `within ${BUY_EDGE_MS / 1000} s of round ${r.n}'s buy phase starting` };
    if (t < bs) {
      const p = R[k - 1];
      if (!p) return { n: null, say: '?', part: 'menu', why: 'before round 1' };
      return stateIn(p, t, 'after');
    }
    if (t < r.drop) return { n: r.n, say: 'alive', part: 'buy', why: `round ${r.n}'s buy phase, ${((r.drop - t) / 1000).toFixed(1)} s before the barriers drop` };
    return stateIn(r, t, 'play');
  }
  function deathAt(t) {
    for (let i = 0; i < R.length; i++) {
      const r = R[i];
      if (!r.died || r.moment === null) continue;
      const next = R[i + 1];
      const until = next ? buyStart(next) : Infinity;
      if (t >= r.moment - EARLY_MS && t < until) return r;
    }
    return null;
  }
  /** The round a moment belongs to, for a person: the one whose buy phase began last at or before it, or null. */
  function roundAt(t) {
    let n = null;
    for (const r of R) if (buyStart(r) <= t) n = r.n;
    return n;
  }
  return { riot, rounds, clusters, at, deathAt, roundAt, buyStart, R };
}

// ── one run ─────────────────────────────────────────────────────────────────

const data = require('../src/shared/valorant-data.generated.json');
/** The callouts of a map, and their aliases, lower case. */
function callouts(map) {
  const geo = (data.mapGeometry || {})[String(map || '').toLowerCase()] || {};
  const set = new Set();
  for (const c of geo.callouts || []) { set.add(c.n.toLowerCase()); if (c.a) set.add(String(c.a).toLowerCase()); }
  return set;
}
/** bench-read.js's own label rule, on any map. */
function labelOk(set, l) {
  const n = String(l || '').toLowerCase().replace(/\s+/g, ' ').trim();
  return set.has(n) || ['a', 'b', 'c'].some((p) => set.has(`${p} ${n}`));
}

/** What a reply says of the player: 'dead', 'alive' or null. */
function verdict(ctx) {
  if (!ctx) return null;
  if (ctx.playerAlive === false || ctx.phase === 'dead') return 'dead';
  if (ctx.playerAlive === true) return 'alive';
  return null;
}

/** bench-read.js's quantile, so a p90 here is the p90 there. */
const q = (arr, p) => { const s = arr.filter(Number.isFinite).sort((a, b) => a - b); return s.length ? s[Math.min(s.length - 1, Math.floor(s.length * p))] : null; };
const pct = (a, b) => (b ? Math.round((a / b) * 1000) / 10 : null);

/**
 * One run, scored against Riot by time.
 * @param trace  { reads } in a trace's shape
 * @param T      truthOf(...) of the session
 * @param opts   { map } the session's map, for the labels
 */
function scoreRun(trace, T, opts = {}) {
  const run = replay(trace);
  const frames = run.frames;
  const claims = frames.filter((f) => f.registered).map((f) => {
    const death = T.deathAt(f.at);
    return { frame: f.frame, at: f.at, withdrawn: !!f.withdrawn, weak: !!f.weak, tell: f.raw ? String(f.raw.aliveTell || '') : '',
      riot: T.at(f.at), death: death ? death.n : null,
      late: death ? Math.round((f.at - death.moment) / 100) / 10 : null, ledgerRound: f.round, match: f.match };
  });
  const standing = claims.filter((c) => !c.withdrawn);
  const caught = {};
  const invented = [];
  for (const c of standing) {
    if (c.death !== null && !caught[c.death]) caught[c.death] = c;
    else if (c.death === null) invented.push(c);
    else c.duplicate = true;
  }
  const riotDeaths = T.rounds.filter((r) => r.died);
  const missed = riotDeaths.filter((r) => !caught[r.n]).map((r) => r.n);

  // Each frame's raw reply, and the engine's verdict on it, against Riot's.
  const fv = { known: 0, buy: 0, rawDeadAlive: 0, rawDeadAliveBuy: 0, rawAliveDead: 0, rawNoneDead: 0, guardDeadAlive: 0, guardAliveDead: 0 };
  for (const f of frames) {
    if (f.err || f.lobby) continue;
    const tr = T.at(f.at);
    f.truth = tr;
    if (tr.say === '?') continue;
    const v = verdict(f.raw);
    fv.known++;
    if (tr.part === 'buy' && tr.say === 'alive') fv.buy++;
    if (v === 'dead' && tr.say === 'alive') { fv.rawDeadAlive++; if (tr.part === 'buy') fv.rawDeadAliveBuy++; }
    if (v === 'alive' && tr.say === 'dead') fv.rawAliveDead++;
    if (v === null && tr.say === 'dead') fv.rawNoneDead++;
    const g = f.alive === false || f.phase === 'dead' ? 'dead' : 'alive';
    if (g === 'dead' && tr.say === 'alive') fv.guardDeadAlive++;
    if (g === 'alive' && tr.say === 'dead') fv.guardAliveDead++;
  }

  // Plants: the round in which the engine's context first held a planted spike, against Riot's.
  const riotPlanted = new Set(T.riot.perRound.filter((r) => r.planted).map((r) => r.n));
  const firstPlant = {};
  let prev = null;
  for (const f of frames) {
    if (f.err || f.lobby) continue;
    const t = f.truth || T.at(f.at);
    if (f.spike === 'planted' && prev !== 'planted' && t.n && !firstPlant[t.n]) {
      firstPlant[t.n] = { frame: f.frame, at: f.at, clock: f.raw ? f.raw.clock || null : null, phase: f.raw ? f.raw.phase || null : null };
    }
    prev = f.spike;
  }
  const planted = Object.keys(firstPlant).map(Number).sort((a, b) => a - b);
  const plants = { riot: [...riotPlanted].sort((a, b) => a - b), screen: planted,
    invented: planted.filter((n) => !riotPlanted.has(n)), missed: [...riotPlanted].filter((n) => !firstPlant[n]).sort((a, b) => a - b), first: firstPlant };

  const reads = trace.reads;
  const errs = reads.filter((r) => r.err).length;
  const lobby = reads.filter((r) => !r.err && r.lobby).length;
  const parsed = reads.filter((r) => !r.err && !r.lobby && r.parsed).length;
  const empty = frames.filter((f) => !f.err && !f.lobby && f.raw && verdict(f.raw) === null && !f.raw.aliveTell && !f.raw.phase
    && typeof f.raw.teamScore !== 'number' && !f.raw.clock).length;
  const cs = callouts(opts.map || T.riot.map);
  let labels = 0;
  let labelsOk = 0;
  const bad = {};
  for (const r of reads) {
    const l = !r.err && !r.lobby && r.context && r.context.locLabel;
    if (!l) continue;
    labels++;
    if (labelOk(cs, l)) labelsOk++; else bad[l] = (bad[l] || 0) + 1;
  }
  const ms = reads.filter((r) => !r.err && Number.isFinite(r.ms)).map((r) => r.ms);
  const sms = reads.filter((r) => !r.err && Number.isFinite(r.serverMs)).map((r) => r.serverMs);
  const dead = reads.filter((r) => !r.err && !r.lobby && verdict(r.context) === 'dead');
  const said = (re) => run.lines.filter((l) => re.test(l.s));
  return {
    n: reads.length, errs, lobby, parsed, parsePct: pct(parsed, reads.length - lobby - errs), empty,
    labels, labelsOk, labelPct: pct(labelsOk, labels), bad,
    p50: q(ms, 0.5), p90: q(ms, 0.9), sp50: q(sms, 0.5), sp90: q(sms, 0.9),
    claims, caught, invented, missed, riotDeaths: riotDeaths.length, withdrawn: claims.filter((c) => c.withdrawn).length,
    fv, buyDeadRate: fv.buy ? fv.rawDeadAliveBuy / fv.buy : 0, plants,
    // The "SPECTATORS 1" counter named in a dead read, which the engine drops.
    counterInDead: dead.filter((r) => spectate.SPECTATOR_COUNT.test(String(r.context.aliveTell || ''))).length,
    newMatches: said(/new match detected/).length,
    menuEnds: said(/match over \(lobby\)/).length,
    resumed: run.resumed.length,
    refusedScores: said(/was a misread|ignoring backwards|impossible scoreboard|implausible scoreboard/).length,
    frames: frames.map((f) => ({ frame: f.frame, at: f.at, err: f.err || null, lobby: !!f.lobby, v: f.err ? 'err' : f.lobby ? 'lobby' : verdict(f.raw),
      guarded: f.err || f.lobby ? null : (f.alive === false || f.phase === 'dead' ? 'dead' : 'alive'),
      registered: !!f.registered, withdrawn: !!f.withdrawn, round: f.round, spike: f.spike || null, truth: f.truth || null })),
  };
}

/**
 * Every run of one session against Riot, on drops from all of them and the AI
 * log's own reads.
 * @param o { riot, map, logged?: trace, runs: [{ name, trace }] }
 */
function scoreSession(o) {
  const all = [...(o.logged ? [o.logged] : []), ...o.runs.map((r) => r.trace)];
  const T = truthOf(o.riot, all);
  const runs = [...(o.logged ? [{ name: 'logged', trace: o.logged }] : []), ...o.runs]
    .map((r) => ({ name: r.name, ...scoreRun(r.trace, T, { map: o.map || o.riot.map }) }));
  return { T, runs };
}

// ── what a person reads ─────────────────────────────────────────────────────

const secs = (t0) => (at) => (at === null || at === undefined ? '-' : `${((at - t0) / 1000).toFixed(1)}s`);
const frameNo = (f) => String(f || '').replace(/^frame-/, '').replace(/\.jpg$/, '');

/** One session's runs as lines: a row a run, then Riot's rounds one by one. */
function sessionLines(res, t0) {
  const at = secs(t0);
  const out = [];
  const T = res.T;
  const deaths = T.rounds.filter((r) => r.died);
  const untimed = T.rounds.filter((r) => r.drop === null).map((r) => r.n);
  out.push(`Riot: ${T.riot.map}, ${T.riot.score}, ${T.rounds.length} rounds, deaths in ${deaths.map((r) => r.n).join(', ') || 'none'}`
    + `${T.riot.wholeSeconds ? ' (Riot\'s whole seconds)' : ''}; barrier drops found for ${T.rounds.length - untimed.length} of ${T.rounds.length}`
    + (untimed.length ? ` (none for ${untimed.join(', ')}: their deaths cannot be caught)` : ''));
  const head = ['run', 'reads', 'err', 'LOBBY', 'empty', 'parse', 'labels', 'p50', 'p90', 'caught', 'missed', 'invented', 'withdrawn', 'plants inv', 'buy dead', 'false dead', 'false alive', 'other'];
  const rows = res.runs.map((r) => [r.name, r.n, r.errs, r.lobby, r.empty, r.parsePct === null ? '-' : `${r.parsePct}%`,
    r.labelPct === null ? '-' : `${r.labelPct}%`, r.p50 === null ? '-' : r.p50, r.p90 === null ? '-' : r.p90,
    `${Object.keys(r.caught).length}/${r.riotDeaths}`, r.missed.join(',') || '-', r.invented.length, r.withdrawn,
    r.plants.invented.join(',') || '-', `${r.fv.rawDeadAliveBuy}/${r.fv.buy}`, r.fv.rawDeadAlive, r.fv.rawAliveDead,
    [r.newMatches ? `${r.newMatches} new match` : '', r.menuEnds ? `${r.menuEnds} menu end` : '', r.resumed ? `${r.resumed} resumed` : '',
      r.refusedScores ? `${r.refusedScores} scores refused` : ''].filter(Boolean).join(', ') || '-'].map(String));
  const w = head.map((h, i) => Math.max(h.length, ...rows.map((row) => row[i].length)));
  const line = (cells) => cells.map((c, i) => (i === 0 ? c.padEnd(w[i]) : c.padStart(w[i]))).join('  ');
  out.push(line(head));
  for (const row of rows) out.push(line(row));
  out.push('');
  out.push('by round (a death caught by its frame and seconds against Riot\'s moment; an invented death by its frame):');
  const names = res.runs.map((r) => r.name);
  const cell = (r, rr) => {
    const bits = [];
    const c = r.caught[rr.n];
    if (rr.died) bits.push(c ? `${frameNo(c.frame)} ${c.late >= 0 ? '+' : ''}${c.late}s` : 'MISSED');
    const inv = r.invented.filter((x) => T.roundAt(x.at) === rr.n);
    if (inv.length) bits.push(`invented ${inv.map((x) => frameNo(x.frame)).join(',')}`);
    if (r.plants.invented.includes(rr.n)) bits.push('false plant');
    if (rr.planted && r.plants.missed.includes(rr.n)) bits.push('plant missed');
    return bits.join('; ') || '-';
  };
  const riotCell = (rr) => `${rr.won ? 'won' : 'lost'} ${rr.side || '?'}, ${rr.died ? `died ${rr.deathMs / 1000}s${rr.afterPlant ? ' after the plant' : ''}` : 'survived'}`
    + `${rr.planted ? ', planted' : ''}, drop ${rr.drop === null ? 'not found' : at(rr.drop)}`;
  const table = T.rounds.map((rr) => [`r${rr.n}`, riotCell(rr), ...res.runs.map((r) => cell(r, rr))]);
  const before = res.runs.map((r) => r.invented.filter((x) => T.roundAt(x.at) === null).map((x) => frameNo(x.frame)).join(',') || '-');
  if (before.some((b) => b !== '-')) table.unshift(['menus', 'before round 1', ...before.map((b) => (b === '-' ? '-' : `invented ${b}`))]);
  const tw = [Math.max(5, ...table.map((r) => r[0].length)), Math.max(4, ...table.map((r) => r[1].length)),
    ...names.map((n, i) => Math.max(n.length, ...table.map((r) => r[i + 2].length)))];
  out.push(['round'.padEnd(tw[0]), 'Riot'.padEnd(tw[1]), ...names.map((n, i) => n.padEnd(tw[i + 2]))].join('  ').trimEnd());
  for (const r of table) out.push(r.map((c, i) => c.padEnd(tw[i])).join('  ').trimEnd());
  return out;
}

// ── a candidate prompt against the live one ─────────────────────────────────

const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

/**
 * THE JUDGE'S TERMS (14 Oct 2026) for a read prompt to replace the live one,
 * checked over runs of both on the same sessions:
 *
 *   1. no real death live caught is missed: a death live caught in most of its
 *      runs is caught in most of the candidate's
 *   2. invented deaths at or under live's mean (summed over the sessions)
 *   3. invented plants at or under live's mean
 *   4. buy frames read dead under live's in every session, as a share of the
 *      buy frames each run judged (none, where live read none)
 *   5. LOBBY replies at or under live's mean
 *   6. verify:ai passed plain and at --lag 4
 *   7. its cost a read within a tenth of live's
 *
 * And, given opts.bench (bench:sessions gives it), the judge's bench itself
 * comes first: three whole runs of each prompt on each of the four sessions,
 * and every run planned done. Seven terms met on a bench that stopped, after a
 * few runs or on its last, or on fewer runs or sessions, are no reason to
 * replace a prompt.
 *
 * @param sessions  [{ name, runs: { [prompt]: [scoreRun result, ...] } }]
 * @param opts      { base: 'live', candidate, gates: { plain, lag4 } each 'PASSED', 'FAILED' or null,
 *                    cost: { [prompt]: { usd, reads } } or null where it was not measured,
 *                    bench: { runs: 3, sessions: the four, stopped: why it stopped, its last run included, or null } }
 * @returns { ok, terms: [{ term, ok, detail }] }
 */
function acceptance(sessions, opts) {
  const base = opts.base || 'live';
  const cand = opts.candidate;
  const terms = [];
  const add = (term, ok, detail) => terms.push({ term, ok, detail });
  const runsOf = (s, p) => (s.runs && s.runs[p]) || [];
  if (opts.bench) {
    const want = opts.bench.runs || 3;
    const names = opts.bench.sessions || Object.keys(SESSIONS);
    const count = names.map((n) => {
      const s = sessions.find((x) => x.name === n);
      return { n, b: s ? runsOf(s, base).length : 0, c: s ? runsOf(s, cand).length : 0 };
    });
    const short = count.filter((x) => x.b < want || x.c < want);
    const why = [opts.bench.stopped ? `stopped (${opts.bench.stopped})` : '',
      short.length ? `short: ${short.map((x) => `${x.n} ${base} ${x.b}, ${cand} ${x.c}`).join('; ')}` : ''].filter(Boolean);
    add(`the judge's bench: ${want} whole runs of each prompt on ${names.join(', ')}, every run done`, !why.length,
      why.join('; ') || count.map((x) => `${x.n} ${base} ${x.b}, ${cand} ${x.c}`).join('; '));
  }
  const usable = sessions.filter((s) => runsOf(s, base).length && runsOf(s, cand).length);
  if (!usable.length) {
    add('runs of both prompts', false, `no session has runs of both ${base} and ${cand}`);
    return { ok: false, terms };
  }

  {
    const lost = [];
    const fewer = [];
    for (const s of usable) {
      const B = runsOf(s, base);
      const C = runsOf(s, cand);
      const ns = [...new Set(B.concat(C).flatMap((r) => Object.keys(r.caught).concat(r.missed.map(String))).map(Number))].sort((a, b) => a - b);
      for (const n of ns) {
        const b = B.filter((r) => r.caught[n]).length;
        const c = C.filter((r) => r.caught[n]).length;
        if (b / B.length > 0.5 && c / C.length <= 0.5) lost.push(`${s.name} r${n} (${base} ${b}/${B.length}, ${cand} ${c}/${C.length})`);
        else if (c / C.length < b / B.length) fewer.push(`${s.name} r${n} (${base} ${b}/${B.length}, ${cand} ${c}/${C.length})`);
      }
    }
    add(`no real death ${base} caught is missed`, !lost.length,
      (lost.length ? `missed: ${lost.join('; ')}` : `none missed`) + (fewer.length ? `; caught less often: ${fewer.join('; ')}` : ''));
  }
  const total = (p, f) => usable.reduce((sum, s) => sum + mean(runsOf(s, p).map(f)), 0);
  const r2 = (x) => Math.round(x * 100) / 100;
  for (const [term, f] of [['invented deaths', (r) => r.invented.length], ['invented plants', (r) => r.plants.invented.length], ['LOBBY replies', (r) => r.lobby]]) {
    const b = total(base, f);
    const c = total(cand, f);
    add(`${term} at or under ${base}'s mean`, c <= b + 1e-9, `${cand} ${r2(c)} against ${base} ${r2(b)}, a run's mean summed over ${usable.map((s) => s.name).join(', ')}`);
  }
  {
    const per = usable.map((s) => {
      const b = mean(runsOf(s, base).map((r) => r.buyDeadRate));
      const c = mean(runsOf(s, cand).map((r) => r.buyDeadRate));
      return { name: s.name, b, c, ok: b === 0 ? c === 0 : c < b };
    });
    const p1 = (x) => `${Math.round(x * 1000) / 10}%`;
    add(`buy frames read dead under ${base}'s in every session`, per.every((x) => x.ok),
      per.map((x) => `${x.name} ${cand} ${p1(x.c)} against ${p1(x.b)}${x.ok ? '' : ' (not under)'}`).join('; '));
  }
  {
    const g = opts.gates || {};
    add('verify:ai passed plain and at --lag 4', g.plain === 'PASSED' && g.lag4 === 'PASSED',
      `plain ${g.plain || 'not run'}, --lag 4 ${g.lag4 || 'not run'}`);
  }
  {
    const cost = opts.cost || {};
    const per = (p) => (cost[p] && cost[p].reads > 0 && Number.isFinite(cost[p].usd) ? cost[p].usd / cost[p].reads : null);
    const b = per(base);
    const c = per(cand);
    add(`cost a read within 10% of ${base}`, b !== null && c !== null && c <= b * 1.1,
      b === null || c === null ? 'not measured' : `${cand} $${c.toFixed(7)} against ${base} $${b.toFixed(7)} a read (${((c / b - 1) * 100).toFixed(1)}%)`);
  }
  return { ok: terms.every((t) => t.ok), terms };
}

module.exports = {
  SESSIONS, sessionOf, riotRecord, readTraceFile, traceOfLog, traceOfFixture, engineClass, AppReader, replay,
  spansOf, dropsOf, roundsOnClock, pistolRounds, truthOf, callouts, labelOk, verdict, scoreRun, scoreSession,
  sessionLines, acceptance, EARLY_MS, EDGE_MS, BUY_EDGE_MS,
};

if (require.main === module) {
  const args = process.argv.slice(2);
  const s = sessionOf(args[0]);
  if (!s) {
    console.log(`name a session: ${Object.keys(SESSIONS).join(', ')} (or its folder's name), then name=trace.jsonl for each run`);
    process.exit(1);
  }
  const { profileDir, benchSession } = require('./profile-path');
  const { dir, looked } = benchSession(profileDir(process.env.APPDATA || ''), s.id);
  if (!dir) {
    console.log(`No recorded session ${s.id} to read. Looked for its log.json in:\n${looked.map((d) => `  ${d}\n`).join('')}`);
    process.exit(1);
  }
  const log = JSON.parse(fs.readFileSync(path.join(dir, 'log.json'), 'utf8'));
  const logged = traceOfLog(log.records);
  const ji = args.indexOf('--json');
  const runs = args.slice(1).filter((a, i) => /=/.test(a) && args[i] !== '--json')
    .map((a) => { const k = a.indexOf('='); return { name: a.slice(0, k), trace: readTraceFile(a.slice(k + 1)) }; });
  const res = scoreSession({ riot: riotRecord(s), map: s.map, logged, runs });
  console.log(`== ${s.name} (${s.id})`);
  for (const l of sessionLines(res, logged.reads.length ? logged.reads[0].at : 0)) console.log(l);
  if (ji > 0) fs.writeFileSync(args[ji + 1], JSON.stringify(res.runs.map((r) => ({ ...r, frames: undefined }))));
}
