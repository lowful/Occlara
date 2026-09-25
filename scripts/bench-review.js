'use strict';

/**
 * Live A/B/C of the post-match review, on real matches.
 *
 *   A  the old review: tip list plus observed notes, three or four sentences
 *   B  round aware: the round ledger and the computed patterns
 *   C  B plus sourced playbook notes to draw the WHY from
 *
 * Each real fixture is replayed through the same ledger the app uses, sent to
 * the live server once per variant, and graded on what CAN be graded
 * mechanically: did it parse, did every place it named appear in the ledger,
 * did it claim kills or damage the ledger never had, did it restate the coach's
 * read instead of explaining it, and did it carry a dash. Whether the advice is
 * WISE is not on that list, for the reason review-log.js gives: no honest score
 * can grade it. So everything is printed for a person to read as well.
 *
 * It is a bench, not a check, and run-all.js does not pick it up. It spends
 * real money on the AI provider.
 *
 *   npm run bench:review                  every fixture, all three variants
 *   npm run bench:review -- --runs 2      twice each, to see the variance
 */

const fs = require('fs');
const path = require('path');
const https = require('https');
const { replay, load } = require('./fixtures/replay-match');
const review = require('../src/shared/valorant-review');

const args = process.argv.slice(2);
const flag = (name, dflt) => {
  const i = args.indexOf('--' + name);
  return i >= 0 && args[i + 1] ? args[i + 1] : dflt;
};
const RUNS = Number(flag('runs', 1));
const VARIANTS = String(flag('variants', 'A,B,C')).split(',');
const SERVER = process.env.OCCLARA_SERVER || 'https://ghostcoach-production.up.railway.app';
const APPDATA = process.env.APPDATA || '';
const cfg = JSON.parse(fs.readFileSync(path.join(APPDATA, 'Occlara', 'occlara-config.json'), 'utf8'));

const MATCHES = [
  { file: 'valorant-match-abyss-13-11.json', mode: 'standard', agent: 'Iso', map: 'Abyss' },
  { file: 'valorant-match-swiftplay-2-5.json', mode: 'swiftplay', agent: 'Iso', map: null },
];

function post(body) {
  return new Promise((resolve) => {
    const data = JSON.stringify(body);
    const u = new URL('/api/coach/match-review', SERVER);
    const req = https.request({
      hostname: u.hostname, path: u.pathname, method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data),
        'x-license-key': cfg.licenseKey },
      timeout: 60000,
    }, (res) => {
      let out = '';
      res.on('data', (c) => { out += c; });
      res.on('end', () => { try { resolve(JSON.parse(out)); } catch { resolve({ error: out.slice(0, 200) }); } });
    });
    req.on('error', (e) => resolve({ error: e.message }));
    req.on('timeout', () => { req.destroy(); resolve({ error: 'timeout' }); });
    req.write(data);
    req.end();
  });
}

const words = (t) => new Set(String(t).toLowerCase().split(/[^a-z0-9']+/).filter((w) => w.length > 3));
function overlap(a, b) {
  const A = words(a);
  const B = words(b);
  if (!A.size || !B.size) return 0;
  let n = 0;
  for (const w of A) if (B.has(w)) n++;
  return n / A.size;
}

// Callout shaped phrases: a site letter or Mid followed by a capitalised word.
function places(text) {
  const out = new Set();
  const toks = String(text).split(/\s+/);
  for (let i = 0; i < toks.length - 1; i++) {
    const a = toks[i].replace(/[^A-Za-z]/g, '');
    const b = toks[i + 1].replace(/[^A-Za-z]/g, '');
    // A sentence ending on the letter ("they hit B. You should") is not a place.
    if (/[.,;:]$/.test(toks[i])) continue;
    if (/^(A|B|C|Mid)$/.test(a) && /^[A-Z][a-z]+$/.test(b)) out.add(`${a} ${b}`.toLowerCase());
  }
  return out;
}

const UNSUPPORTED = ['killed', 'kills', 'frag', 'damage', 'credits', 'eco round', 'force buy', 'headshot'];

function grade(res, body) {
  const all = [res.summary || res.review || '', ...Object.values(res.rounds || {}), res.focus || ''].join(' ');
  const known = new Set();
  for (const r of body.rounds) {
    // Two word prefixes too, since the extractor reads two words: "B Boat House".
    for (const s of [r.deathSpot, r.plantSpot]) {
      if (!s) continue;
      known.add(s.toLowerCase());
      known.add(s.toLowerCase().split(/\s+/).slice(0, 2).join(' '));
    }
    for (const t of r.reads) for (const p of places(t)) known.add(p);
  }
  const named = [...places(all)];
  const foreign = named.filter((p) => !known.has(p));
  const said = all.toLowerCase();
  const claims = UNSUPPORTED.filter((w) => said.includes(w)
    && !body.rounds.some((r) => r.reads.some((t) => t.toLowerCase().includes(w))));
  // The three failures the first run showed when the text was read by hand: an
  // ultimate recommended with no ult read, a man advantage nobody could see,
  // and round numbers spelled out in a list of seventeen.
  for (const [n, why] of Object.entries(res.rounds || {})) {
    const r = body.rounds.find((x) => x.n === Number(n));
    const w = String(why).toLowerCase();
    if ((w.includes('ultimate') || w.includes(' ult ')) && !(r && r.ultReady)) claims.push(`ult in R${n}`);
  }
  if (said.includes('man advantage')) claims.push('man advantage');
  if (said.includes('clutch')) claims.push('clutch');
  if (/\b(twenty|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen) (one|two|three|four)?/.test(said)
      || /\brounds (one|two|three|four|five|six|seven|eight|nine|ten)\b/.test(said)) claims.push('spelled rounds');
  const restate = Object.entries(res.rounds || {}).map(([n, why]) => {
    const r = body.rounds.find((x) => x.n === Number(n));
    return r && r.reads.length ? Math.max(...r.reads.map((t) => overlap(why, t))) : 0;
  });
  return {
    parsed: !!(res.summary || res.review),
    roundLines: Object.keys(res.rounds || {}).length,
    focus: !!res.focus,
    foreign,
    claims,
    restate: restate.length ? Math.round((restate.reduce((a, b) => a + b, 0) / restate.length) * 100) : null,
    dashes: (all.match(/[\u2013\u2014]/g) || []).length,
    words: all.split(/\s+/).filter(Boolean).length,
  };
}

(async () => {
  const totals = {};
  for (const m of MATCHES) {
    const rep = replay(load(m.file).frames, m.mode);
    const ctx = { ...rep.context, agent: m.agent, map: rep.context.map || m.map };
    const tips = rep.rounds.flatMap((r) => r.reads.map((x) => x.text));
    const body = review.requestBody({ rounds: rep.rounds, context: ctx, endedBy: rep.endedBy, tips });
    console.log(`\n${'='.repeat(78)}\n${m.file}: ${rep.rounds.length} rounds, ended by ${rep.endedBy}, `
      + `patterns: ${body.patterns.map((p) => p.key).join(', ') || 'none'}\n${'='.repeat(78)}`);
    for (let run = 0; run < RUNS; run++) {
      for (const v of VARIANTS) {
        const res = await post({ ...body, variant: v });
        if (res.error) { console.log(`\n[${v}] ERROR ${res.error}`); continue; }
        if (v !== 'A' && !res.variant) console.log(`\n[${v}] WARNING the live server ignored the variant, it has not deployed yet`);
        const g = grade(res, body);
        const t = totals[v] || (totals[v] = { n: 0, parsed: 0, roundLines: 0, foreign: 0, claims: 0, restate: [], dashes: 0, words: 0 });
        t.n++; t.parsed += g.parsed ? 1 : 0; t.roundLines += g.roundLines; t.foreign += g.foreign.length;
        t.claims += g.claims.length; if (g.restate !== null) t.restate.push(g.restate); t.dashes += g.dashes; t.words += g.words;
        console.log(`\n[${v}] run ${run + 1}  parsed ${g.parsed}  rounds ${g.roundLines}  focus ${g.focus}  `
          + `foreign places ${g.foreign.join('/') || 'none'}  unsupported ${g.claims.join('/') || 'none'}  `
          + `restates read ${g.restate === null ? 'n/a' : g.restate + '%'}  dashes ${g.dashes}  words ${g.words}`);
        console.log(`SUMMARY: ${res.summary || res.review}`);
        for (const [n, why] of Object.entries(res.rounds || {})) console.log(`  R${n}: ${why}`);
        if (res.focus) console.log(`FOCUS: ${res.focus}`);
        if (res.study && res.study.length) console.log(`STUDY: ${res.study.map((s) => s.text.slice(0, 70)).join(' | ')}`);
      }
    }
  }
  console.log(`\n${'='.repeat(78)}\nTOTALS`);
  for (const [v, t] of Object.entries(totals)) {
    const r = t.restate.length ? Math.round(t.restate.reduce((a, b) => a + b, 0) / t.restate.length) : 'n/a';
    console.log(`${v}: parsed ${t.parsed}/${t.n}, round lines ${t.roundLines}, foreign places ${t.foreign}, `
      + `unsupported claims ${t.claims}, restates read ${r}%, dashes ${t.dashes}, words ${Math.round(t.words / t.n)} avg`);
  }
})();
