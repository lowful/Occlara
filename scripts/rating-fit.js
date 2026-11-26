'use strict';

/**
 * THE MATCH RATING'S CHANCE TO WIN, FITTED (docs/claude/rating.md, "The
 * table"). Every round of Riot's record with a kill feed, both teams: the
 * repo's fixtures and, with --library, the saved reviews in
 * %APPDATA%\Occlara\reviews (or --library=<dir>). Each kill and the plant is
 * a state (attackers standing, defenders standing, the spike down or not,
 * players already down) labelled by whether the attackers won the round.
 *
 * It fits each candidate logistic by maximum likelihood, scores it on every
 * state AND held out by match (each match scored by a fit on the others),
 * prints the attackers' share at 5v5 against each model's, and fits the
 * attackers' chance once they are all down after the plant against the time
 * the spike has left. Numbers only; it writes nothing. A refit that changes
 * a number in rating.js WP bumps rating.js VERSION.
 *
 *   node scripts/rating-fit.js --library
 */

const path = require('path');
const rating = require('../src/shared/rating');
const cal = require('./rating-calibrate');

const sig = (z) => 1 / (1 + Math.exp(-z));

/** The states of every round, and the attackers wiped after the plant with the time left. */
function statesOf(matches) {
  const S = [];
  const wiped = [];
  let rounds = 0;
  matches.forEach((m, mi) => {
    for (const r of m.rounds) {
      if (!(r.side === 'attacking' || r.side === 'defending') || typeof r.won !== 'boolean' || !Array.isArray(r.feed)) continue;
      rounds++;
      const usAtt = r.side === 'attacking';
      const y = (usAtt ? r.won : !r.won) ? 1 : 0;
      let a = 5; let d = 5; let planted = false; let wipedSeen = false;
      const evs = r.feed.filter((k) => typeof k.ms === 'number').map((k) => ({ t: k.ms, k }))
        .concat(typeof r.plantMs === 'number' ? [{ t: r.plantMs, plant: true }] : []).sort((x, z) => x.t - z.t);
      S.push({ a, d, p: 0, y, m: mi, open: 1 });
      for (const e of evs) {
        if (e.plant) { planted = true; if (a > 0 && d > 0) S.push({ a, d, p: 1, y, m: mi }); continue; }
        if (planted && e.t > r.plantMs + rating.W.SPIKE_MS) break;
        const onUs = e.k.on === 'me' || e.k.on === 'mate';
        const onAtt = onUs ? usAtt : !usAtt;
        if (e.k.on !== 'me' && e.k.on !== 'mate' && e.k.on !== 'enemy') continue;
        if (onAtt) a = Math.max(0, a - 1); else d = Math.max(0, d - 1);
        if (a > 0 && d > 0) S.push({ a, d, p: planted ? 1 : 0, y, m: mi });
        else if (a === 0 && planted && d > 0 && !wipedSeen) { wipedSeen = true; wiped.push({ left: (r.plantMs + rating.W.SPIKE_MS - e.t) / 1000, d, y }); }
      }
    }
  });
  return { S, wiped, rounds };
}

function fit(data, f, l2) {
  if (!data.length) return null;
  const k = f(data[0]).length;
  const w = new Array(k).fill(0);
  for (let it = 0; it < 5000; it++) {
    const g = new Array(k).fill(0);
    for (const s of data) { const x = f(s); const p = sig(x.reduce((q, v, i) => q + v * w[i], 0)); for (let i = 0; i < k; i++) g[i] += (p - s.y) * x[i]; }
    for (let i = 0; i < k; i++) w[i] -= 0.5 * (g[i] / data.length + (l2 || 0) * w[i] * (i ? 1 : 0));
  }
  return w;
}
function logLoss(data, f, w) {
  return -data.reduce((q, s) => {
    const p = Math.min(1 - 1e-9, Math.max(1e-9, sig(f(s).reduce((z, v, i) => z + v * w[i], 0))));
    return q + (s.y ? Math.log(p) : Math.log(1 - p));
  }, 0) / data.length;
}

const MODELS = {
  diff: (s) => [1, s.a - s.d, s.p],
  'diff+open': (s) => [1, s.a - s.d, s.p, s.open ? 1 : 0],
  'diff+ratio': (s) => [1, s.a - s.d, Math.log(s.a / s.d), s.p],
  'diff+down': (s) => [1, s.a - s.d, 10 - s.a - s.d, s.p],
  'diff+down+spike*down': (s) => [1, s.a - s.d, 10 - s.a - s.d, s.p, s.p * (10 - s.a - s.d)],
};

function run(matches) {
  const { S, wiped, rounds } = statesOf(matches);
  console.log(`matches ${matches.length}, rounds ${rounds}, states with both sides up ${S.length}, attackers wiped after the plant ${wiped.length}`);
  const start = S.filter((s) => s.a === 5 && s.d === 5 && !s.p);
  console.log(`5v5 at the start: attackers won ${(start.reduce((q, s) => q + s.y, 0) / start.length * 100).toFixed(1)} percent of ${start.length}`);
  const out = {};
  for (const [name, f] of Object.entries(MODELS)) {
    const w = fit(S, f);
    let cv = 0; let n = 0;
    for (let mi = 0; mi < matches.length; mi++) {
      const te = S.filter((s) => s.m === mi);
      if (!te.length) continue;
      cv += logLoss(te, f, fit(S.filter((s) => s.m !== mi), f)) * te.length; n += te.length;
    }
    const p55 = sig(f({ a: 5, d: 5, p: 0, open: 1 }).reduce((q, v, i) => q + v * w[i], 0));
    out[name] = { w, inSample: logLoss(S, f, w), heldOut: cv / n, p55 };
    console.log(`${name.padEnd(22)} weights ${w.map((x) => x.toFixed(3)).join(' ')}  in sample ${out[name].inSample.toFixed(4)}  held out by match ${out[name].heldOut.toFixed(4)}  the opening 5v5 ${(p55 * 100).toFixed(1)}`);
  }
  // Wiped after the plant: the attackers' chance against the seconds the spike has left.
  const wf = (s) => [1, s.left];
  const ww = fit(wiped, wf, 0.01);
  if (ww) {
    console.log(`wiped after the plant: logit = ${ww[0].toFixed(3)} + ${ww[1].toFixed(3)} x seconds left (${wiped.length} states, attackers won ${wiped.filter((s) => s.y).length})`);
    for (const left of [5, 10, 15, 20, 30]) console.log(`  ${left} s left: ${(sig(ww[0] + ww[1] * left) * 100).toFixed(0)} percent`);
  }
  return { out, ww, S, wiped };
}

if (require.main === module) {
  const arg = process.argv.find((a) => a.startsWith('--library'));
  const dir = arg ? (arg.includes('=') ? arg.split('=')[1] : path.join(process.env.APPDATA || '', 'Occlara', 'reviews')) : null;
  run([...['riot-abyss-13-11', 'riot-split-13-7'].map(cal.fixtureMatch), ...cal.libraryMatches(dir)]);
}

module.exports = { run, statesOf, MODELS };
