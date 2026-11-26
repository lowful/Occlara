'use strict';

/**
 * THE LIVE RATING, MEASURED (docs/claude/rating.md, "Live").
 *
 * Reads the owner's own matches on this PC, READ ONLY, and prints counts and
 * numbers, never a name, a frame or a Riot ID: every saved session whose frames
 * the AI log or the bench kept beside Riot's record of its match (the Abyss and
 * the Split fixtures' records with their bench frames, and the saved reviews
 * whose AI log still has its frames). For each:
 *
 *   1. Riot's rounds laid on the session's clock (read-score.js truthOf: each
 *      round's barrier drop from the clocked reads), so every kill and death
 *      Riot records has a moment on the frames' clock.
 *   2. Every frame's kill feed read by the detector (src/shared/killfeed.js),
 *      the region cut by the bundled ffmpeg exactly as index.js cuts it.
 *   3. The session replayed through the real reader (read-score.js AppReader,
 *      the guards of the day, network stubbed) and the live rating fed frame
 *      by frame as main feeds it (src/shared/live-rating.js).
 *   4. The player's kills and deaths the live rating counted, matched one to
 *      one against Riot's (a kill from 1.5 s before Riot's moment to 8 s
 *      after, a death from 6 s before to 10 s after): recall, precision and
 *      the lag from Riot's moment to the frame that counted it; and the live
 *      final against the rating counted from Riot's record of the same rounds.
 *
 * Offline, no network, no model, writes nothing. Needs the bundled ffmpeg
 * (ffmpeg-static, a dev dependency) and the owner's userData.
 *
 *   node scripts/live-rating-measure.js [--mine N] [--engine-deaths] [--reads-only]
 *     --mine N         frames the yellow must be seen on for the player's kill (default 2)
 *     --engine-deaths  count a death only the engine registered, at the round's end
 *     --reads-only     no detector: what the reads alone give (with --engine-deaths, their deaths)
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const rs = require('./read-score');
const killfeed = require('../src/shared/killfeed');
const { createLiveRating } = require('../src/shared/live-rating');
const rating = require('../src/shared/rating');

const args = process.argv.slice(2);
const MINE = (() => { const i = args.indexOf('--mine'); return i >= 0 ? Number(args[i + 1]) : 2; })();
const ENGINE_DEATHS = args.includes('--engine-deaths');
const NO_DETECTOR = args.includes('--reads-only');
const ROOT = path.join(process.env.APPDATA || '', 'Occlara');
let FFMPEG = null;
try { FFMPEG = require('ffmpeg-static'); } catch { FFMPEG = null; }

/** A saved review's cards as Riot's record in the fixtures' shape. */
function riotOfReview(v) {
  return {
    map: null,
    queue: (v.scoreline && v.scoreline.mode) || '',
    perRound: (v.rounds || []).map((c) => {
      const feed = (c.riot && Array.isArray(c.riot.feed)) ? c.riot.feed : [];
      const d = feed.find((e) => e.on === 'me');
      return { n: c.n, side: c.sideKey || c.side, won: c.result === 'won' ? true : c.result === 'lost' ? false : null, died: !!c.died,
        deathMs: d ? d.ms : (c.riot && Number.isFinite(c.riot.sec) ? c.riot.sec * 1000 : null),
        planted: !!c.planted, plantMs: c.riot && Number.isFinite(c.riot.plantSec) ? c.riot.plantSec * 1000 : null, feed };
    }),
  };
}

/** Every session with frames and a record of its match. */
function sessions() {
  const out = [];
  for (const name of ['abyss', 'split']) {
    const s = rs.sessionOf(name);
    const dir = path.join(ROOT, 'bench', s.id);
    if (!fs.existsSync(path.join(dir, 'log.json'))) continue;
    out.push({ name, dir, riot: rs.riotRecord(s), log: JSON.parse(fs.readFileSync(path.join(dir, 'log.json'), 'utf8')), every10: name === 'abyss' });
  }
  const reviews = path.join(ROOT, 'reviews');
  for (const f of fs.existsSync(reviews) ? fs.readdirSync(reviews).filter((x) => x.endsWith('.json') && x !== 'index.json') : []) {
    let v;
    try { v = JSON.parse(fs.readFileSync(path.join(reviews, f), 'utf8')).review; } catch { continue; }
    if (!v || !v.aiLog || !v.aiLog.session || !(v.rounds || []).some((c) => c.riot && Array.isArray(c.riot.feed))) continue;
    if (out.some((s) => s.dir.endsWith(v.aiLog.session))) continue;
    let dir = path.join(ROOT, 'bench', v.aiLog.session);
    if (!fs.existsSync(path.join(dir, 'log.json'))) dir = path.join(ROOT, 'ai-log', v.aiLog.session);
    if (!fs.existsSync(path.join(dir, 'log.json'))) continue;
    const log = JSON.parse(fs.readFileSync(path.join(dir, 'log.json'), 'utf8'));
    if (!(log.records || []).some((r) => fs.existsSync(path.join(dir, r.frame)))) continue;
    out.push({ name: `review ${f.replace(/^valorant-\d+-/, '').replace(/\.json$/, '')}`, dir, riot: riotOfReview(v), log, swift: (v.rounds || []).length <= 9 });
  }
  for (const S of out) {
    S.trace = rs.traceOfLog(S.log.records);
    S.T = rs.truthOf(S.riot, [S.trace]);
    S.kills = []; S.deaths = [];
    for (const r of S.T.rounds) {
      if (r.drop === null) continue;
      for (const e of r.feed || []) {
        if (e.by === 'me' && e.on === 'enemy') S.kills.push({ at: r.drop + e.ms, n: r.n });
        if (e.on === 'me') S.deaths.push({ at: r.drop + e.ms, n: r.n });
      }
      if (r.died && r.moment && !(r.feed || []).some((e) => e.on === 'me')) S.deaths.push({ at: r.moment, n: r.n });
    }
    S.covered = new Set(S.T.rounds.filter((r) => r.drop !== null).map((r) => r.n));
  }
  return out;
}

function jpegSize(file) {
  const b = fs.readFileSync(file);
  let i = 2;
  while (i < b.length) {
    if (b[i] !== 0xFF) { i++; continue; }
    const m = b[i + 1];
    if (m >= 0xC0 && m <= 0xC3) return [b.readUInt16BE(i + 7), b.readUInt16BE(i + 5)];
    i += 2 + b.readUInt16BE(i + 2);
  }
  return null;
}

/** The detector on one kept frame, the region cut as index.js cuts it. */
function detectFile(file) {
  const size = jpegSize(file);
  if (!size) return null;
  const [W, H] = size;
  const r = killfeed.regionOf(W, H);
  const data = execFileSync(FFMPEG, ['-loglevel', 'error', '-i', file, '-vf', `crop=${r.width}:${r.height}:${r.x}:${r.y}`,
    '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { maxBuffer: 1 << 26 });
  const t0 = process.hrtime.bigint();
  const det = killfeed.detect({ width: r.width, height: r.height, data, channels: 3 }, H);
  return { det, ms: Number(process.hrtime.bigint() - t0) / 1e6, H };
}

/** One to one, in time order: each counted event to the first truth it can be. */
function match(truth, evs, lo, hi) {
  const used = new Set();
  let hit = 0;
  const lag = [];
  for (const e of evs) {
    const k = truth.findIndex((t, i) => !used.has(i) && e.at >= t.at + lo && e.at <= t.at + hi);
    if (k >= 0) { used.add(k); hit++; lag.push((e.at - truth[k].at) / 1000); }
  }
  return { hit, lag };
}

const q = (a, p) => { const s = a.slice().sort((x, y) => x - y); return s.length ? s[Math.min(s.length - 1, Math.floor(s.length * p))] : null; };
const pct = (a, b) => (b ? `${((a / b) * 100).toFixed(1)}%` : '-');

function main() {
  if (!FFMPEG || !fs.existsSync(FFMPEG)) { console.log('No bundled ffmpeg (ffmpeg-static): nothing to measure with.'); return; }
  const all = sessions();
  if (!all.length) { console.log('No session with frames and Riot\'s record of its match on this PC.'); return; }
  const tot = { k: { riot: 0, hit: 0, ev: 0, lag: [] }, d: { riot: 0, hit: 0, ev: 0, lag: [] }, r: { hit: 0, ev: 0, lag: [] }, gaps: [], ms: [] };
  console.log(`The yellow on ${MINE} frame(s) for the player's kill; the engine's own deaths ${ENGINE_DEATHS ? 'counted' : 'not counted'}.`);
  for (const S of all) {
    const reads = S.trace.reads.slice().sort((a, b) => a.at - b.at);
    const app = new rs.AppReader(reads[0].at);
    const live = createLiveRating({ mineSeen: MINE, engineDeaths: ENGINE_DEATHS, queue: S.swift ? 'swiftplay' : null });
    const sizes = new Set();
    const regs = [];   // the reader's own death registrations, a guard's withdrawal taken off
    for (const rd of reads) {
      const f = app.apply(rd);
      const c = app.e.matchContext;
      if (f.withdrew && regs.length) regs.pop();
      if (f.registered) regs.push({ at: rd.at, n: app.e.ledger.current() });
      const file = path.join(S.dir, rd.frame);
      const got = fs.existsSync(file) ? detectFile(file) : null;
      if (got) { tot.ms.push(got.ms); sizes.add(got.H); }
      live.frame({ at: rd.at, match: app.e.matchStartedAt, round: app.e.ledger.current(), side: c.side || null, phase: c.phase || null,
        alive: c.playerAlive, died: f.registered, withdrew: f.withdrew, spike: c.spike || null,
        team: Number.isInteger(c.teamScore) ? c.teamScore : null, enemy: Number.isInteger(c.enemyScore) ? c.enemyScore : null,
        clock: c.clock || null, mode: c.gameMode || null, det: got && !NO_DETECTOR ? got.det : null });
    }
    const first = reads[0].at;
    const lastAt = reads[reads.length - 1].at;
    const cov = (at) => { const n = S.T.roundAt(at); return n !== null && S.covered.has(n); };
    const evs = live.events().filter((e) => e.kind === 'kill' && e.out && !e.out.ignored && e.at && cov(e.at));
    const inside = (k) => cov(k.at) && k.at >= first && k.at <= lastAt;
    const tk = S.kills.filter(inside);
    const td = S.deaths.filter(inside);
    const mk = match(tk, evs.filter((e) => e.killer === 'me'), -1500, 8000);
    const md = match(td, evs.filter((e) => e.victim === 'me'), -6000, 10000);
    const nMe = evs.filter((e) => e.killer === 'me').length;
    const nD = evs.filter((e) => e.victim === 'me').length;
    const firstRegs = regs.filter((r, i) => cov(r.at) && regs.findIndex((x) => x.n === r.n) === i);
    const mr = match(td, firstRegs, -6000, 10000);
    // The confirmed rating of the same rounds, from Riot's record.
    const rounds = S.riot.perRound.filter((r) => S.covered.has(r.n)).map((r) => ({ n: r.n, side: r.side, won: typeof r.won === 'boolean' ? r.won : null,
      feed: (r.feed || []).map((e) => ({ ms: e.ms, by: e.by, on: e.on })), plantMs: r.plantMs }));
    const confirmed = rating.fromRecord({ rounds, queue: S.swift ? 'swiftplay' : null }).rating;
    const gap = confirmed ? Math.round((live.value() - confirmed.value) * 10) / 10 : null;
    const gaps = (S.every10 ? '(a read every 10 s)' : '');
    console.log(`${S.name.padEnd(16)} ${[...sizes].join('/')}p ${String(S.covered.size).padStart(2)} rounds  kills ${mk.hit}/${tk.length} found, ${nMe} counted  deaths ${md.hit}/${td.length} found, ${nD} counted  live ${live.value().toFixed(1)} confirmed ${confirmed ? confirmed.value.toFixed(1) : '-'} ${gaps}`);
    if (S.every10) continue;   // a read every ten seconds sees a row at most once: kept out of the totals
    tot.k.riot += tk.length; tot.k.hit += mk.hit; tot.k.ev += nMe; tot.k.lag.push(...mk.lag);
    tot.d.riot += td.length; tot.d.hit += md.hit; tot.d.ev += nD; tot.d.lag.push(...md.lag);
    tot.r.hit += mr.hit; tot.r.ev += firstRegs.length; tot.r.lag.push(...mr.lag);
    if (gap !== null) tot.gaps.push(gap);
  }
  console.log('');
  console.log(`own kills   recall ${tot.k.hit}/${tot.k.riot} ${pct(tot.k.hit, tot.k.riot)}  precision ${tot.k.hit}/${tot.k.ev} ${pct(tot.k.hit, tot.k.ev)}  lag p50 ${q(tot.k.lag, 0.5)} s p90 ${q(tot.k.lag, 0.9)} s`);
  console.log(`own deaths  recall ${tot.d.hit}/${tot.d.riot} ${pct(tot.d.hit, tot.d.riot)}  precision ${tot.d.hit}/${tot.d.ev} ${pct(tot.d.hit, tot.d.ev)}  lag p50 ${q(tot.d.lag, 0.5)} s p90 ${q(tot.d.lag, 0.9)} s`);
  console.log(`the reads alone, deaths: the reader's registrations, one a round: recall ${tot.r.hit}/${tot.d.riot} ${pct(tot.r.hit, tot.d.riot)}  precision ${tot.r.hit}/${tot.r.ev} ${pct(tot.r.hit, tot.r.ev)}  lag p50 ${q(tot.r.lag, 0.5)} s; kills: no field says whose a kill is`);
  if (tot.gaps.length) console.log(`live final less confirmed  ${tot.gaps.map((g) => (g > 0 ? `+${g}` : `${g}`)).join(', ')}  mean absolute ${(tot.gaps.reduce((a, b) => a + Math.abs(b), 0) / tot.gaps.length).toFixed(2)}`);
  console.log(`detector    ${tot.ms.length} frames, p50 ${q(tot.ms, 0.5).toFixed(2)} ms p99 ${q(tot.ms, 0.99).toFixed(2)} ms a frame`);
  const bar = tot.k.riot && tot.d.riot && tot.k.hit / tot.k.riot >= 0.85 && tot.k.hit / tot.k.ev >= 0.95 && tot.d.hit / tot.d.riot >= 0.95 && tot.d.hit / tot.d.ev >= 0.95;
  console.log(`the bar (kills 85% recall and 95% precision, deaths 95% both): ${bar ? 'MET' : 'NOT MET'}`);
}

if (require.main === module) main();
module.exports = { sessions, riotOfReview, match };
