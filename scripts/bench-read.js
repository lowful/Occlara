'use strict';

/**
 * Which model should READ the game live, and how fast can it go?
 *
 * Occlara reads the screen during a match and reviews it afterwards, so the per
 * frame job is facts only (POST /api/coach/read). This puts candidate models in
 * front of the same real frames and scores them against RIOT'S OWN RECORD of
 * the match, which is the only exact answer there is:
 *
 *   deaths      replay each model's reads through the round ledger and compare
 *               with Riot, per round: agreed, invented, missed
 *   labels      printed locations that really exist on the map (the client
 *               fingerprints the map from these, so an invented one is costly)
 *   final       did it read the final score
 *   parse       did a STATE line come back
 *   p50 / p90   latency, which decides how often the game can be read: with two
 *               requests in flight the sustainable gap is about p90 / 2
 *
 * The default session is the 240 frame Abyss match whose Riot record is in
 * scripts/fixtures/riot-abyss-13-11.json. Frames come from the AI log on disk.
 *
 * COSTS REAL MONEY, a little: every frame is one call per model. Models run in
 * parallel, frames in order within a model, because each read carries the
 * previous one's context exactly as the client does.
 *
 *   node scripts/bench-read.js qwen/qwen3.7-flash deepseek/deepseek-v4.1-flash
 *   node scripts/bench-read.js --frames 60 <models...>     first 60 frames only
 */

const fs = require('fs');
const path = require('path');
const { RoundLedger } = require('../src/shared/valorant-rounds');
const { profileDir, configPath } = require('./profile-path');

const SERVER = process.env.OCCLARA_SERVER || 'https://ghostcoach-production.up.railway.app';
const ROOT = profileDir(process.env.APPDATA || '');
const args = process.argv.slice(2);
const flag = (name, d) => { const i = args.indexOf('--' + name); return i >= 0 ? args[i + 1] : d; };
const SESSION = flag('session', 'session-2026-09-22T04-24-07-240Z');
const LIMIT = Number(flag('frames', 0)) || Infinity;
// 'live' is whatever the server runs with no override, which is what a player
// gets: npm run verify:ai measures that and fails below the gate.
const MODELS = args.filter((a) => (a.includes('/') || a === 'live') && !a.startsWith('--'));
const GATE = args.includes('--gate');
if (!MODELS.length) { console.log('name at least one model'); process.exit(1); }

const dir = path.join(ROOT, 'ai-log', SESSION);
const cfg = JSON.parse(fs.readFileSync(configPath(ROOT), 'utf8'));
const log = JSON.parse(fs.readFileSync(path.join(dir, 'log.json'), 'utf8'));
const frames = log.records.filter((r) => r.frame && fs.existsSync(path.join(dir, r.frame))).slice(0, LIMIT);
const riot = require('./fixtures/riot-abyss-13-11.json');
const geo = require('../src/shared/valorant-data.generated.json').mapGeometry || {};
const CALLOUTS = new Set();
for (const c of (geo.abyss || {}).callouts || []) { CALLOUTS.add(c.n.toLowerCase()); if (c.a) CALLOUTS.add(String(c.a).toLowerCase()); }
const validLabel = (l) => {
  const n = String(l || '').toLowerCase().replace(/\s+/g, ' ').trim();
  return CALLOUTS.has(n) || ['a', 'b', 'c'].some((p) => CALLOUTS.has(`${p} ${n}`));
};

async function read(model, image, context) {
  const t0 = Date.now();
  const resp = await fetch(`${SERVER}/api/coach/read`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-license-key': cfg.licenseKey },
    body: JSON.stringify({ image, context, benchModel: model === 'live' ? undefined : model }),
  });
  const ms = Date.now() - t0;
  if (!resp.ok) return { err: `${resp.status} ${(await resp.text()).slice(0, 80)}`, ms };
  return { ...(await resp.json()), ms };
}

async function run(model) {
  const r = { model, n: 0, parsed: 0, lobby: 0, errs: 0, firstErr: null, ms: [], labels: 0, labelsOk: 0, hp: 0 };
  const ledger = new RoundLedger();
  let ctx = {};
  let team = 0;
  let enemy = 0;
  let prevAlive = true;
  let lastDeath = -1e9;
  let finalRead = false;
  for (const f of frames) {
    r.n++;
    const image = fs.readFileSync(path.join(dir, f.frame)).toString('base64');
    let j;
    try { j = await read(model, image, ctx); } catch (e) { j = { err: e.message, ms: 0 }; }
    if (j.err) { r.errs++; r.firstErr = r.firstErr || j.err; continue; }
    r.ms.push(j.ms);
    if (j.lobby) { r.lobby++; continue; }
    const s = j.context || {};
    if (j.parsed) r.parsed++;
    if (s.locLabel) { r.labels++; if (validLabel(s.locLabel)) r.labelsOk++; }
    if (typeof s.playerHp === 'number') r.hp++;
    // The same light guards the review replay uses: scores never go backwards,
    // a buy phase means alive, a death needs a fresh edge twenty seconds apart.
    if (typeof s.teamScore === 'number' && typeof s.enemyScore === 'number'
        && s.teamScore >= team && s.enemyScore >= enemy) { team = s.teamScore; enemy = s.enemyScore; }
    if (team === 13 && enemy === 11) finalRead = true;
    const alive = s.phase === 'buy' ? true : s.playerAlive;
    const at = f.at;
    const died = alive === false && prevAlive !== false && at - lastDeath > 20000;
    if (died) lastDeath = at;
    prevAlive = alive;
    ledger.observe({ at, team, enemy, side: s.side, phase: s.phase, alive, died,
      deathSpot: s.locLabel || s.playerSpot, clock: s.clock, loc: s.locLabel || s.playerSpot });
    ctx = { ...ctx, ...s };
  }
  // Scored per Riot round, directly. A round the model never reached counts as
  // a miss, not as agreement, so a run that stops early cannot look perfect.
  const byN = new Map(ledger.list(finalRead ? 24 : null).map((x) => [x.n, x]));
  const d = { riotDeaths: 0, agreed: 0, invented: [], missed: [] };
  for (const rr of riot.perRound) {
    const saw = byN.get(rr.n);
    const sawDeath = !!(saw && saw.died);
    if (rr.died) d.riotDeaths++;
    if (rr.died && sawDeath) d.agreed++;
    else if (rr.died) d.missed.push(rr.n);
    else if (sawDeath) d.invented.push(rr.n);
  }
  r.deaths = d;
  r.finalRead = finalRead;
  return r;
}

const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);
const q = (arr, p) => { const s = arr.slice().sort((a, b) => a - b); return s.length ? s[Math.min(s.length - 1, Math.floor(s.length * p))] : 0; };

(async () => {
  console.log(`${frames.length} frames from ${SESSION}; Riot has ${riot.perRound.filter((x) => x.died).length} deaths in ${riot.rounds} rounds\n`);
  // TWO MODELS AT A TIME. The read limiter is per licence, and nine models at
  // once spent it in seconds: the first sweep came back 90% "slow down".
  const CONC = Number(flag('parallel', 2));
  const results = [];
  for (let i = 0; i < MODELS.length; i += CONC) {
    const batch = await Promise.all(MODELS.slice(i, i + CONC)
      .map((m) => run(m).then((r) => { console.log(`  done ${m}`); return r; })));
    results.push(...batch);
  }
  console.log(`\n${'model'.padEnd(36)} parse  deaths(ok/inv/miss)  labels-ok  hp    final  p50    p90    gap`);
  console.log('-'.repeat(118));
  for (const r of results) {
    const d = r.deaths || { riotDeaths: 0, agreed: 0, invented: [], missed: [] };
    const agreed = d.agreed;
    const p90 = q(r.ms, 0.9);
    // Two requests in flight: a new read can start every p90 / 2.
    const gap = p90 ? (p90 / 2 <= 1000 ? '1s' : p90 / 2 <= 2000 ? '2s' : p90 / 2 <= 3000 ? '3s' : '5s') : '-';
    console.log(`${r.model.padEnd(36)} ${String(pct(r.parsed, r.n - r.lobby - r.errs)).padStart(3)}%   `
      + `${String(agreed).padStart(2)}/${String(d.invented.length).padStart(2)}/${String(d.missed.length).padEnd(2)}             `
      + `${String(pct(r.labelsOk, r.labels)).padStart(3)}%       ${String(pct(r.hp, r.n)).padStart(3)}%  `
      + `${r.finalRead ? 'yes' : 'no '}    ${String(q(r.ms, 0.5)).padStart(5)}  ${String(p90).padStart(5)}  ${gap}`
      + (r.errs ? `   ${r.errs} err (${r.firstErr})` : ''));
  }
  console.log('\ndeaths is the number that matters: agreed with Riot / invented / missed, out of Riot\'s real deaths.');
  console.log('gap is the fastest read cadence the model sustains with two requests in flight.');

  // THE GATE, for npm run verify:ai. Every model or prompt change runs this
  // before it ships: the read must parse, must not invent deaths Riot does
  // not have, must read real labels, and must keep up with at least the 3s tier.
  if (GATE) {
    const bad = [];
    for (const r of results) {
      const d = r.deaths;
      const parsed = pct(r.parsed, r.n - r.lobby - r.errs);
      const labels = pct(r.labelsOk, r.labels);
      if (parsed < 95) bad.push(`${r.model}: STATE parsed on ${parsed}% of frames, gate 95%`);
      if (labels < 95) bad.push(`${r.model}: ${labels}% of location labels exist on the map, gate 95%`);
      if (d.invented.length > 1) bad.push(`${r.model}: invented ${d.invented.length} deaths Riot does not have, gate 1`);
      if (d.agreed < d.riotDeaths * 0.8) bad.push(`${r.model}: agreed with ${d.agreed} of Riot's ${d.riotDeaths} deaths, gate 80%`);
      if (q(r.ms, 0.9) > 6000) bad.push(`${r.model}: p90 ${q(r.ms, 0.9)}ms is too slow for even the 3s tier`);
      if (r.errs > r.n * 0.05) bad.push(`${r.model}: ${r.errs} failed reads of ${r.n}`);
    }
    console.log(bad.length ? `\nGATE FAILED\n${bad.map((b) => '  ' + b).join('\n')}` : '\nGATE PASSED');
    process.exit(bad.length ? 1 : 0);
  }
})();
