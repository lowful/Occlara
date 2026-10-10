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
 *   p50 / p90   latency, which decides how often the game can be read: with up
 *               to four requests in flight, auto holds a tier while p90 stays
 *               under four gaps and a tenth (adaptCadence in coaching-engine.js)
 *
 * The default session is the 240 frame Abyss match whose Riot record is in
 * scripts/fixtures/riot-abyss-13-11.json. Frames come from the session on
 * disk: its copy in userData/bench first, then the AI log, which keeps only
 * the five newest recording sessions and deletes the rest at every Start,
 * this one included once five are newer (benchSession in profile-path.js).
 * Keep it copied to %APPDATA%\Occlara\bench\session-2026-09-22T04-24-07-240Z.
 *
 * COSTS REAL MONEY, a little: every frame is one call per model. Models run in
 * parallel, frames in order within a model, because each read carries the
 * context of the reads before it, as the client's does.
 *
 *   node scripts/bench-read.js qwen/qwen3.7-flash deepseek/deepseek-v4.1-flash
 *   node scripts/bench-read.js --frames 60 <models...>     first 60 frames only
 *   node scripts/bench-read.js --lag 4 <models...>         context four reads old
 *
 * --lag N SENDS EACH FRAME WITH THE CONTEXT OF N READS EARLIER, as the client
 * does with N reads in flight: the replies to the reads just before it have
 * not landed when it goes. The default, 1, is the previous read's context,
 * which is what every number beside readModel in coach.js was measured on.
 * Frames still go one at a time, so the read limiter sees the same rate.
 * npm run verify:ai -- --lag 4 gates the read the way four in flight send it.
 *
 * A MODEL OTHER THAN 'live' NEEDS THE ADMIN PASSWORD. The server honours
 * benchModel only beside X-Admin-Password, because any licence could otherwise
 * switch every read to a dearer model. Set ADMIN_PASSWORD in the environment
 * or in server/.env (the value Railway has). 'live', which is all verify:ai
 * runs, needs nothing.
 */

const fs = require('fs');
const path = require('path');
const { RoundLedger } = require('../src/shared/valorant-rounds');
const { CAPTURE_TIERS } = require('../src/shared/config');
const { profileDir, configPath, benchSession } = require('./profile-path');

const SERVER = process.env.OCCLARA_SERVER || 'https://ghostcoach-production.up.railway.app';
const ROOT = profileDir(process.env.APPDATA || '');
const args = process.argv.slice(2);
const flag = (name, d) => { const i = args.indexOf('--' + name); return i >= 0 ? args[i + 1] : d; };
const SESSION = flag('session', 'session-2026-09-22T04-24-07-240Z');
const LIMIT = Number(flag('frames', 0)) || Infinity;
const LAG = Math.max(1, Math.floor(Number(flag('lag', 1))) || 1);
// 'live' is whatever the server runs with no override, which is what a player
// gets: npm run verify:ai measures that and fails below the gate.
const MODELS = args.filter((a) => (a.includes('/') || a === 'live') && !a.startsWith('--'));
const GATE = args.includes('--gate');
if (!MODELS.length) { console.log('name at least one model'); process.exit(1); }

/** ADMIN_PASSWORD from the environment, or from server/.env when it exists. */
function adminPassword() {
  const envFile = path.join(__dirname, '..', 'server', '.env');
  if (!process.env.ADMIN_PASSWORD && fs.existsSync(envFile)) {
    try {
      let dotenv;
      try { dotenv = require(path.join(__dirname, '..', 'server', 'node_modules', 'dotenv')); }
      catch { dotenv = require('dotenv'); }
      dotenv.config({ path: envFile });
    } catch (e) { console.log(`could not read ${envFile}: ${e.message}`); }
  }
  return process.env.ADMIN_PASSWORD || '';
}
const BENCHING = MODELS.some((m) => m !== 'live');
const ADMIN = BENCHING ? adminPassword() : '';
if (BENCHING && !ADMIN) {
  console.log('A bench model needs the admin password: the server ignores benchModel without it, and every '
    + 'frame would quietly run on the live model under the name you asked for.\n'
    + 'Set ADMIN_PASSWORD in the environment or in server/.env (the same value Railway has), or bench "live" only.');
  process.exit(1);
}

// The session's copy in userData/bench first, then the AI log, which keeps
// only the five newest sessions and prunes the rest at the next Start.
const { dir, looked } = benchSession(ROOT, SESSION);
if (!dir) {
  console.log(`No recorded session ${SESSION} to read. Looked for its log.json in:\n`
    + looked.map((d) => `  ${d}\n`).join('')
    + `The AI log keeps only the five newest sessions, so copy the session's folder, log.json and frames,\n`
    + `to the first of those, which nothing prunes.`);
  process.exit(1);
}
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
  const bench = model !== 'live';
  const resp = await fetch(`${SERVER}/api/coach/read`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-license-key': cfg.licenseKey,
      ...(bench ? { 'x-admin-password': ADMIN } : {}) },
    body: JSON.stringify({ image, context, benchModel: bench ? model : undefined }),
  });
  const ms = Date.now() - t0;
  if (!resp.ok) return { err: `${resp.status} ${(await resp.text()).slice(0, 80)}`, ms };
  const j = await resp.json();
  // The server names the model that answered a bench request. Anything else
  // means benchModel was not honoured, and the numbers would belong to the
  // live model, so the run stops rather than reporting them under this name.
  return { ...j, ms, ignored: bench && j.model !== model };
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
  // The context each frame found, every read before it applied: frame i is
  // sent with the one after read i - LAG, and nothing before the first.
  const found = [];
  for (const f of frames) {
    r.n++;
    found.push(ctx);
    const sent = found[found.length - LAG] || {};
    const image = fs.readFileSync(path.join(dir, f.frame)).toString('base64');
    let j;
    try { j = await read(model, image, sent); } catch (e) { j = { err: e.message, ms: 0 }; }
    if (j.err) { r.errs++; r.firstErr = r.firstErr || j.err; continue; }
    if (j.ignored) {
      r.errs = frames.length;
      r.firstErr = `the server ran ${j.model || 'the live model'}, not ${model}: check ADMIN_PASSWORD`;
      console.log(`  ${model}: ${r.firstErr}`);
      break;
    }
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
    // The tier auto holds at this p90: up to four requests in flight, and a
    // step down only past four gaps and a tenth.
    const held = CAPTURE_TIERS.find((t) => p90 <= t * 4 * 1.1) || CAPTURE_TIERS[CAPTURE_TIERS.length - 1];
    const gap = p90 ? `${held / 1000}s` : '-';
    console.log(`${r.model.padEnd(36)} ${String(pct(r.parsed, r.n - r.lobby - r.errs)).padStart(3)}%   `
      + `${String(agreed).padStart(2)}/${String(d.invented.length).padStart(2)}/${String(d.missed.length).padEnd(2)}             `
      + `${String(pct(r.labelsOk, r.labels)).padStart(3)}%       ${String(pct(r.hp, r.n)).padStart(3)}%  `
      + `${r.finalRead ? 'yes' : 'no '}    ${String(q(r.ms, 0.5)).padStart(5)}  ${String(p90).padStart(5)}  ${gap}`
      + (r.errs ? `   ${r.errs} err (${r.firstErr})` : ''));
  }
  console.log('\ndeaths is the number that matters: agreed with Riot / invented / missed, out of Riot\'s real deaths.');
  console.log('gap is the read cadence auto holds at that p90, with up to four requests in flight.');
  if (LAG > 1) console.log(`each frame was sent with the context of ${LAG} reads earlier (--lag ${LAG}).`);

  // THE GATE, for npm run verify:ai. Every model or prompt change runs this
  // before it ships: the read must parse, must not invent deaths Riot does
  // not have, must read real labels, and must answer within six seconds at
  // p90. That was the 3s tier with two in flight; with four it holds 2s.
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
      if (q(r.ms, 0.9) > 6000) bad.push(`${r.model}: p90 ${q(r.ms, 0.9)}ms, gate 6000ms`);
      if (r.errs > r.n * 0.05) bad.push(`${r.model}: ${r.errs} failed reads of ${r.n}`);
    }
    console.log(bad.length ? `\nGATE FAILED\n${bad.map((b) => '  ' + b).join('\n')}` : '\nGATE PASSED');
    process.exit(bad.length ? 1 : 0);
  }
})();
