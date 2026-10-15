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
 *   node scripts/bench-read.js --trace out.jsonl <models...>   every read, and the rounds, to a file
 *   node scripts/bench-read.js --min-gap 1000 <models...>  reads of a model at least 1 s apart
 *
 * --trace FILE appends one JSON line per read (the frame, its latency, the
 * model the server says answered, the error, what the STATE said) and one per
 * model with the rounds it invented and missed, which the table only counts.
 * --min-gap MS starts a model's reads at least MS apart. A model that fails in
 * a tenth of a second sends all 240 frames in seconds and spends the licence's
 * 150 reads a minute, which refuses the player's own reads for that minute
 * too. A healthy read takes longer than a second, so 1000 changes nothing
 * else. Neither is on by default.
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
 *
 *   npm run verify:ai -- --variant b               the read prompt's variant b
 *   npm run verify:ai -- --lag 4 --variant b
 *   npm run verify:ai -- --variant c               and c, written from b's judging
 *   npm run verify:ai -- --lag 4 --variant c
 *
 * --variant NAME READS WITH A VARIANT OF THE READ PROMPT (8.4.1,
 * server/services/read-prompt.js), on the live model or any other, and needs
 * the admin password too: the server serves a variant only beside it, so no
 * player's read is ever an experiment. The server says which prompt answered,
 * and a run it did not honour (no password, or a server that has not deployed
 * the variant yet) stops rather than report the live prompt's numbers under
 * the variant's name. Without the flag nothing is sent and nothing changes.
 *
 *   node scripts/bench-read.js live --engine --session <session> [--variant c] [--lag 4]
 *
 * --engine READS THE SESSION AS THE APP READS IT (8.4.3). Without it each
 * frame is sent the server's own replies merged raw, so one misread fed back
 * stays fed back: on both Fracture runs of 14 Oct a 0 to 0 read dropped the
 * score line from the next prompt and the engine's new match rule reset the
 * match, and buy frames sent "the player was DEAD on the last frame" were read
 * dead 35 to 50% of the time against 11 to 19% without it. With it each frame
 * is sent what coaching-engine.js's readContext() gives, and each reply is
 * applied through the real engine in capture order as drain() applies it (a
 * failed read skipped, a LOBBY a menu), its network stubbed and its clock the
 * frame's capture time (read-score.js AppReader), so every guard, the ledger
 * and the next context are the app's; --lag N sends frame k the context the
 * engine had once the replies up to k - N were applied. The run is scored by
 * time against Riot's own record of that session (read-score.js), not the
 * Abyss's, and the trace gives each read the context it was `sent`. It is no
 * gate, so --gate is refused beside it, and without the flag nothing here
 * changes: npm run verify:ai sends and prints what it always has
 * (test:benchsession holds it byte for byte).
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
const TRACE = flag('trace', '');
const MIN_GAP = Math.max(0, Number(flag('min-gap', 0)) || 0);
// The read prompt's variant to read with ('b', 'c'), or none: the live prompt.
// Any name is sent; the server serves only one it has, and says which.
const VARIANT = String(flag('variant', '') || '').trim().toLowerCase();
// A flag's value is never a model, though a trace path has slashes in it.
const VALUED = new Set(['session', 'frames', 'lag', 'parallel', 'trace', 'min-gap', 'variant']);
const valueAt = new Set(args.map((a, i) => (a.startsWith('--') && VALUED.has(a.slice(2)) ? i + 1 : -1)).filter((i) => i >= 0));
// 'live' is whatever the server runs with no override, which is what a player
// gets: npm run verify:ai measures that and fails below the gate.
const MODELS = args.filter((a, i) => !valueAt.has(i) && (a.includes('/') || a === 'live') && !a.startsWith('--'));
/** One JSON line to the --trace file, when there is one. */
const trace = (o) => { if (TRACE) fs.appendFileSync(TRACE, JSON.stringify(o) + '\n'); };
const GATE = args.includes('--gate');
// Each frame sent the engine's readContext(), each reply through the engine.
const ENGINE = args.includes('--engine');
if (!MODELS.length) { console.log('name at least one model'); process.exit(1); }
if (ENGINE && GATE) {
  console.log('--gate is verify:ai\'s, read as it always has been (each frame sent the replies before it merged raw), '
    + 'and --engine reads another way: run the gate without --engine.');
  process.exit(1);
}

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
const ADMIN = BENCHING || VARIANT ? adminPassword() : '';
if (BENCHING && !ADMIN) {
  console.log('A bench model needs the admin password: the server ignores benchModel without it, and every '
    + 'frame would quietly run on the live model under the name you asked for.\n'
    + 'Set ADMIN_PASSWORD in the environment or in server/.env (the same value Railway has), or bench "live" only.');
  process.exit(1);
}
if (VARIANT && !ADMIN) {
  console.log(`The read prompt's variant ${VARIANT} needs the admin password: the server serves the live prompt `
    + 'without it, and every frame would quietly be read with that under the variant\'s name.\n'
    + 'Set ADMIN_PASSWORD in the environment or in server/.env (the same value Railway has).');
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
      ...(bench || VARIANT ? { 'x-admin-password': ADMIN } : {}) },
    body: JSON.stringify({ image, context, benchModel: bench ? model : undefined, variant: VARIANT || undefined }),
  });
  const ms = Date.now() - t0;
  if (!resp.ok) return { err: `${resp.status} ${(await resp.text()).slice(0, 80)}`, ms };
  const j = await resp.json();
  // The server names the model that answered a bench request. Anything else
  // means benchModel was not honoured, and the numbers would belong to the
  // live model, so the run stops rather than reporting them under this name.
  // The same for a variant of the prompt: the server names the one it read with.
  return { ...j, ms, serverMs: j.ms, ignored: bench && j.model !== model,
    ignoredVariant: !!VARIANT && j.variant !== VARIANT };
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
  let lastStart = 0;
  for (const f of frames) {
    r.n++;
    found.push(ctx);
    const sent = found[found.length - LAG] || {};
    const image = fs.readFileSync(path.join(dir, f.frame)).toString('base64');
    if (MIN_GAP) {
      const wait = lastStart + MIN_GAP - Date.now();
      if (wait > 0) await new Promise((res) => setTimeout(res, wait));
    }
    lastStart = Date.now();
    let j;
    try { j = await read(model, image, sent); } catch (e) { j = { err: e.message, ms: 0 }; }
    trace({ model, i: r.n, frame: f.frame, at: f.at, ms: j.ms, serverMs: j.serverMs == null ? null : j.serverMs,
      err: j.err || null, servedBy: j.model || null, lobby: !!j.lobby, parsed: !!j.parsed, context: j.context || null });
    if (j.err) { r.errs++; r.firstErr = r.firstErr || j.err; continue; }
    if (j.ignored) {
      r.errs = frames.length;
      r.firstErr = `the server ran ${j.model || 'the live model'}, not ${model}: check ADMIN_PASSWORD`;
      console.log(`  ${model}: ${r.firstErr}`);
      break;
    }
    if (j.ignoredVariant) {
      r.errs = frames.length;
      r.firstErr = `the server read with ${j.variant ? `variant ${j.variant}` : 'the live prompt'}, not variant ${VARIANT}: `
        + 'check ADMIN_PASSWORD, or the server has not deployed it yet';
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
  trace({ model, summary: true, lag: LAG, ...(VARIANT ? { variant: VARIANT } : {}), n: r.n, errs: r.errs, firstErr: r.firstErr, lobby: r.lobby, parsed: r.parsed,
    labels: r.labels, labelsOk: r.labelsOk, hp: r.hp, finalRead, deaths: d,
    rounds: ledger.list(finalRead ? 24 : null).map((x) => ({ n: x.n, died: !!x.died, side: x.side, spot: x.deathSpot || null })) });
  return r;
}

/**
 * One model's run with --engine. Frame k is sent once the replies up to
 * k - LAG are applied, with what readContext() then gives at k's capture time,
 * and its reply waits its turn, as one in flight waits in pending, so with
 * LAG reads out the context is LAG reads old, as the app's is. Each reply is
 * kept as the server sent it (the engine edits the object it is handed, and
 * is handed a copy).
 */
async function runEngine(model) {
  const { AppReader } = require('./read-score');
  const order = frames.map((f, k) => ({ f, k })).sort((a, b) => a.f.at - b.f.at || a.k - b.k).map((x) => x.f);
  const app = new AppReader(order.length ? order[0].at : 0);
  const r = { model, n: 0, errs: 0, firstErr: null, lobby: 0, parsed: 0, ms: [], reads: [] };
  const waiting = [];
  const applyThrough = (k) => { while (waiting.length && waiting[0].k <= k) app.apply(waiting.shift().read); };
  let lastStart = 0;
  for (const [k, f] of order.entries()) {
    r.n++;
    applyThrough(k - LAG);
    const sent = app.context(f.at);
    const image = fs.readFileSync(path.join(dir, f.frame)).toString('base64');
    if (MIN_GAP) {
      const wait = lastStart + MIN_GAP - Date.now();
      if (wait > 0) await new Promise((res) => setTimeout(res, wait));
    }
    lastStart = Date.now();
    let j;
    try { j = await read(model, image, sent); } catch (e) { j = { err: e.message, ms: 0 }; }
    const line = { model, i: r.n, frame: f.frame, at: f.at, ms: j.ms, serverMs: j.serverMs == null ? null : j.serverMs,
      err: j.err || null, servedBy: j.model || null, lobby: !!j.lobby, parsed: !!j.parsed, context: j.context || null, sent };
    trace(line);
    r.reads.push(line);
    if (j.err) { r.errs++; r.firstErr = r.firstErr || j.err; waiting.push({ k, read: line }); continue; }
    if (j.ignored) {
      r.errs = frames.length;
      r.firstErr = `the server ran ${j.model || 'the live model'}, not ${model}: check ADMIN_PASSWORD`;
      console.log(`  ${model}: ${r.firstErr}`);
      break;
    }
    if (j.ignoredVariant) {
      r.errs = frames.length;
      r.firstErr = `the server read with ${j.variant ? `variant ${j.variant}` : 'the live prompt'}, not variant ${VARIANT}: `
        + 'check ADMIN_PASSWORD, or the server has not deployed it yet';
      console.log(`  ${model}: ${r.firstErr}`);
      break;
    }
    r.ms.push(j.ms);
    if (j.lobby) r.lobby++;
    else if (j.parsed) r.parsed++;
    waiting.push({ k, read: line });
  }
  applyThrough(Infinity);
  const last = r.reads.length ? r.reads[r.reads.length - 1].at : 0;
  const { ledger } = app.stop(last);
  r.registered = app.records.filter((x) => x.died).length;
  r.matches = app.ended.map((x) => ({ endedBy: x.snap.endedBy, rounds: x.snap.rounds.length, voided: !!x.snap.voided }));
  trace({ model, summary: true, engine: true, lag: LAG, ...(VARIANT ? { variant: VARIANT } : {}), n: r.n, errs: r.errs, firstErr: r.firstErr,
    lobby: r.lobby, parsed: r.parsed, matches: r.matches,
    rounds: ledger.map((x) => ({ n: x.n, died: !!x.died, side: x.side, spot: x.deathSpot || null })) });
  return r;
}

/** --engine's report: scored by time against the session's own Riot record when the repo has one. */
async function engineMain() {
  const score = require('./read-score');
  const known = score.sessionOf(SESSION);
  const record = known ? score.riotRecord(known) : null;
  console.log(`${frames.length} frames from ${SESSION}, read as the app reads them (--engine): each frame sent coaching-engine.js's `
    + 'readContext(), each reply applied through the engine in capture order');
  console.log(record
    ? `Riot's record of it: ${known.riot}, ${record.map} ${record.score}, ${record.perRound.filter((x) => x.died).length} deaths in ${record.rounds} rounds\n`
    : 'No Riot record of this session in scripts/fixtures: its reads are applied and counted, not scored against Riot\n');
  if (VARIANT) console.log(`read with the read prompt's variant ${VARIANT}, not the live prompt\n`);
  const CONC = Number(flag('parallel', 2));
  const results = [];
  for (let i = 0; i < MODELS.length; i += CONC) {
    const batch = await Promise.all(MODELS.slice(i, i + CONC)
      .map((m) => runEngine(m).then((r) => { console.log(`  done ${m}`); return r; })));
    results.push(...batch);
  }
  console.log('');
  if (record) {
    const logged = score.traceOfLog(log.records);
    const res = score.scoreSession({ riot: record, map: known.map, logged,
      runs: results.map((r) => ({ name: r.model, trace: { reads: r.reads } })) });
    for (const l of score.sessionLines(res, logged.reads.length ? logged.reads[0].at : 0)) console.log(l);
    console.log('\nlogged is the AI log\'s own reads of the session, as the app read it then. A death is caught from 5 s before');
    console.log('Riot\'s moment to the next buy phase; "buy dead" is buy frames read dead of the buy frames judged.');
  } else {
    console.log(`${'model'.padEnd(36)} reads  err  LOBBY  parse  p50    p90    deaths registered  matches ended`);
    for (const r of results) {
      console.log(`${r.model.padEnd(36)} ${String(r.n).padStart(5)}  ${String(r.errs).padStart(3)}  ${String(r.lobby).padStart(5)}  `
        + `${String(pct(r.parsed, r.n - r.lobby - r.errs)).padStart(4)}%  ${String(q(r.ms, 0.5)).padStart(5)}  ${String(q(r.ms, 0.9)).padStart(5)}  `
        + `${String(r.registered).padStart(17)}  ${r.matches.length}` + (r.errs ? `   ${r.errs} err (${r.firstErr})` : ''));
    }
  }
  if (LAG > 1) console.log(`each frame was sent the engine's context of ${LAG} reads earlier (--lag ${LAG}).`);
  if (VARIANT) console.log(`every frame was read with the read prompt's variant ${VARIANT} (--variant ${VARIANT}).`);
}

const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);
const q = (arr, p) => { const s = arr.slice().sort((a, b) => a - b); return s.length ? s[Math.min(s.length - 1, Math.floor(s.length * p))] : 0; };

(async () => {
  if (ENGINE) { await engineMain(); return; }
  console.log(`${frames.length} frames from ${SESSION}; Riot has ${riot.perRound.filter((x) => x.died).length} deaths in ${riot.rounds} rounds\n`);
  if (VARIANT) console.log(`read with the read prompt's variant ${VARIANT}, not the live prompt\n`);
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
  if (VARIANT) console.log(`every frame was read with the read prompt's variant ${VARIANT} (--variant ${VARIANT}).`);

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
