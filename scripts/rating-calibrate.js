'use strict';

/**
 * THE MATCH RATING'S CALIBRATION (docs/claude/rating.md, "Calibration").
 *
 *   node scripts/rating-calibrate.js            the repo's fixtures only
 *   node scripts/rating-calibrate.js --library  and the saved reviews in
 *                                               %APPDATA%\Occlara\reviews
 *   node scripts/rating-calibrate.js --library=<dir>
 *
 * Reads Riot's record of every match with a kill feed, rates every player the
 * feed names by agent (all ten where every kill names both ends, the player
 * alone otherwise), and prints the distribution, each match's best and worst,
 * and the correlations with kills less deaths, ACS and Occlara's grade. It
 * prints numbers and agents only: a review's file holds no other player's
 * name, and nothing of the player's is printed. It writes nothing.
 */

const fs = require('fs');
const path = require('path');
const rating = require('../src/shared/rating');

const FIXTURES = ['riot-abyss-13-11', 'riot-split-13-7'];

function fixtureMatch(name) {
  const g = require(`./fixtures/${name}.json`);
  return {
    tag: name, queue: g.queue || null, acs: g.me && g.me.score && g.rounds ? g.me.score / g.rounds : null, grade: null,
    meAgent: g.me && g.me.agent,
    rounds: g.perRound.map((r) => ({ n: r.n, side: r.side, won: r.won, satOut: !!(r.afk || r.inSpawn),
      plantMs: typeof r.plantMs === 'number' ? r.plantMs : null, feed: r.feed || null })),
  };
}

function libraryMatches(dir) {
  if (!dir || !fs.existsSync(dir)) return [];
  const out = [];
  for (const f of fs.readdirSync(dir).filter((x) => /^valorant-.*\.json$/.test(x)).sort()) {
    let rv;
    try { rv = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')).review; } catch { continue; }
    if (!rv || !Array.isArray(rv.rounds) || !rv.rounds.length) continue;
    const rounds = rating.roundsOfReview(rv);
    if (!rounds.every((r) => r.feed)) continue;
    const g = rv.game && typeof rv.game === 'object' ? rv.game : {};
    const tops = typeof g.score === 'string' ? g.score.split('-').map(Number) : [];
    out.push({
      tag: `library ${out.length + 1}`, queue: g.mode || (rounds.length <= 9 && Math.max(...tops) === 5 ? 'swiftplay' : null),
      acs: rv.scoreline && typeof rv.scoreline.acs === 'number' ? rv.scoreline.acs : null,
      grade: rv.grade && typeof rv.grade.score === 'number' ? rv.grade.score : null,
      meAgent: g.agent || null, rounds,
    });
  }
  return out;
}

/** Kills and deaths of every key, counted off the feed. */
function kd(rounds) {
  const c = new Map();
  const add = (key, f) => { if (!key || !/^(me|us:.+|them:.+)$/.test(key)) return; const x = c.get(key) || { k: 0, d: 0 }; x[f]++; c.set(key, x); };
  for (const r of rounds) for (const k of r.feed) {
    const by = rating.keyOf(k.by, k.ka); const on = rating.keyOf(k.on, k.va);
    if (by !== on && (k.by === 'enemy') !== (k.on === 'enemy')) add(by, 'k');
    add(on, 'd');
  }
  return c;
}

function corr(xs, ys) {
  const n = xs.length;
  if (n < 3) return null;
  const mx = xs.reduce((a, b) => a + b, 0) / n; const my = ys.reduce((a, b) => a + b, 0) / n;
  let sxy = 0; let sxx = 0; let syy = 0;
  for (let i = 0; i < n; i++) { sxy += (xs[i] - mx) * (ys[i] - my); sxx += (xs[i] - mx) ** 2; syy += (ys[i] - my) ** 2; }
  return sxx && syy ? sxy / Math.sqrt(sxx * syy) : null;
}
const q = (arr, p) => { const s = arr.slice().sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.max(0, Math.round(p * (s.length - 1))))]; };
const f2 = (v) => (v === null ? 'n/a' : v.toFixed(2));

function run(matches) {
  const all = [];
  const me = [];
  const perMatch = [];
  for (const m of matches) {
    const keyed = rating.allKeyed(m.rounds);
    const r = rating.createRating({ queue: m.queue, meAgent: m.meAgent, players: keyed ? rating.lobbyOf(m.rounds) : ['me'] });
    for (const round of m.rounds) for (const e of rating.eventsOfRound(round)) r.push(e);
    const snap = r.snapshot();
    const counts = kd(m.rounds);
    const list = snap.players.filter((p) => keyed || p.key === 'me').map((p) => ({ ...p, kd: (counts.get(p.key) || { k: 0, d: 0 }) }));
    for (const p of list) all.push({ value: p.value, diff: p.kd.k - p.kd.d, per: (p.kd.k - p.kd.d) / m.rounds.length, kills: p.kd.k, match: m.tag });
    const mine = list.find((p) => p.key === 'me');
    me.push({ value: mine.value, acs: m.acs, grade: m.grade, tag: m.tag, rounds: m.rounds.length });
    if (keyed) {
      const vals = list.map((p) => p.value).sort((a, b) => b - a);
      perMatch.push({ tag: m.tag, rounds: m.rounds.length, best: vals[0], worst: vals[vals.length - 1], mean: vals.reduce((a, b) => a + b, 0) / vals.length,
        place: rating.fromRecord({ rounds: m.rounds, queue: m.queue, meAgent: m.meAgent }).rating.place });
    }
  }
  const vals = all.map((a) => a.value);
  console.log(`matches ${matches.length}, timelines ${all.length} (${perMatch.length} matches with all ten)`);
  console.log(`mean ${f2(vals.reduce((a, b) => a + b, 0) / vals.length)}, median ${q(vals, 0.5)}, p10 ${q(vals, 0.1)}, p90 ${q(vals, 0.9)}, min ${Math.min(...vals)}, max ${Math.max(...vals)}`);
  const buckets = {};
  for (const v of vals) { const b = Math.floor(v); buckets[b] = (buckets[b] || 0) + 1; }
  console.log('by whole point', Object.keys(buckets).sort((a, b) => a - b).map((b) => `${b}: ${buckets[b]}`).join(', '));
  console.log(`9.0 or more: ${vals.filter((v) => v >= 9).length}, 10.0: ${vals.filter((v) => v >= 10).length}`);
  for (const p of perMatch) console.log(`  ${p.tag}, ${p.rounds} rounds: best ${p.best}, worst ${p.worst}, mean ${f2(p.mean)}, the player ${p.place ? `${p.place.n} of ${p.place.of}` : 'n/a'}`);
  console.log(`corr with kills less deaths, all timelines: ${f2(corr(vals, all.map((a) => a.diff)))}, per round: ${f2(corr(vals, all.map((a) => a.per)))}`);
  const acs = me.filter((x) => typeof x.acs === 'number');
  const gr = me.filter((x) => typeof x.grade === 'number');
  console.log(`the player's matches: ${me.length}; corr with ACS ${f2(corr(acs.map((x) => x.value), acs.map((x) => x.acs)))} (n ${acs.length}), with the grade ${f2(corr(gr.map((x) => x.value), gr.map((x) => x.grade)))} (n ${gr.length})`);
  for (const x of me) console.log(`  ${x.tag}: ${x.value}, ACS ${x.acs === null ? 'n/a' : Math.round(x.acs)}, grade ${x.grade === null ? 'n/a' : x.grade}`);
  return { all, me, perMatch };
}

if (require.main === module) {
  const arg = process.argv.find((a) => a.startsWith('--library'));
  const dir = arg ? (arg.includes('=') ? arg.split('=')[1] : path.join(process.env.APPDATA || '', 'Occlara', 'reviews')) : null;
  run([...FIXTURES.map(fixtureMatch), ...libraryMatches(dir)]);
}

module.exports = { run, fixtureMatch, libraryMatches, corr };
