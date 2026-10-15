'use strict';

/**
 * A READ PROMPT AGAINST THE LIVE ONE, READ AS THE APP READS, OVER THE REAL
 * SESSIONS (8.4.3): npm run bench:sessions.
 *
 * SPENDS MONEY, so it is never part of npm test, and it spends nothing until
 * --go: without it, it prints every read it would send, what they would cost
 * at the prices observed and how long they would take, and stops.
 *
 *   npm run bench:sessions                        the plan and its cost, nothing sent
 *   npm run bench:sessions -- --go                run it
 *     --sessions abyss,split,sunset,fracture      the sessions (default the four)
 *     --prompts live,c                            the first is the base the rest are judged against
 *     --runs 3                                    runs of each prompt on each session
 *     --lag N                                     each frame sent the engine's context N reads old (default 1)
 *     --no-gate                                   skip verify:ai for the candidates
 *     --price 0.00033                             the price a read the estimate uses (default both observed)
 *     --max-usd X                                 stop before a run that could take the spend past X
 *     --out DIR                                   the traces and results (default userData/bench/runs/<when>)
 *
 * WHY. b's bench of 14 Oct sent each frame the server's replies merged raw,
 * so a misread fed back stayed fed back (a 0 to 0 dropped the score line and
 * reset the match on both Fracture runs; buy frames sent "the player was DEAD
 * on the last frame" were read dead 35 to 50% of the time against 11 to 19%),
 * scored every session against the Abyss record, and ran each prompt once at
 * temperature 0.7 while OpenRouter changed provider under it. So:
 *
 *   - every session run is bench-read.js --engine: each frame sent the real
 *     engine's readContext(), each reply applied through it in capture order
 *   - THE RUNS INTERLEAVE, live, c, live, c: run 1 of each prompt on every
 *     session, then run 2, so the prompts share one upstream window
 *   - the candidates' verify:ai runs first, plain and at --lag 4, exactly as
 *     npm run verify:ai -- --variant c runs it
 *   - each run is its own process with /health and /api/admin/costs read
 *     either side of it, so its cost is exact: the licence's own read spend
 *     (the provider's figure and the flat estimate for the calls it priced
 *     not), and the data policy's fallbacks are watched
 *   - it stops before the next run when a run's prompt was not served, a read
 *     was refused (401, 402, 403, 429), more than 5% failed, the run read
 *     fewer frames than its session has (it died part way), the data policy
 *     fell back, the server restarted, or the spend could pass --max-usd
 *   - at the end every whole run is scored by time against Riot's record of
 *     its session (read-score.js), on barrier drops from all of them and the
 *     AI log, and the judge's terms are checked and printed for each
 *     candidate (read-score.js acceptance), the judge's bench itself first:
 *     three whole runs of each prompt on each of the four sessions, every run
 *     done, so a bench that stopped, or ran fewer, never says to replace one
 *
 * The admin password (server/.env, or ADMIN_PASSWORD) and the licence key
 * (the app's config) are read here and by bench-read.js, sent only in the
 * headers the server reads, and never printed or written: the licence's row
 * in the cost view is found by the same 8 character hash the view prints.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { profileDir, configPath, benchSession } = require('./profile-path');
const score = require('./read-score');

const SERVER = process.env.OCCLARA_SERVER || 'https://ghostcoach-production.up.railway.app';
const ROOT = profileDir(process.env.APPDATA || '');
const args = process.argv.slice(2);
const flag = (name, d) => { const i = args.indexOf('--' + name); return i >= 0 && i + 1 < args.length ? args[i + 1] : d; };
const GO = args.includes('--go');
const SESSION_NAMES = String(flag('sessions', 'abyss,split,sunset,fracture')).split(',').map((s) => s.trim()).filter(Boolean);
const PROMPTS = String(flag('prompts', 'live,c')).split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
const RUNS = Math.max(1, Math.floor(Number(flag('runs', 3))) || 3);
const LAG = Math.max(1, Math.floor(Number(flag('lag', 1))) || 1);
const GATES = !args.includes('--no-gate');
const MIN_GAP = 1000;
// What one read cost on 14 Oct 2026 (b's bench, exact from the cost view):
// about $0.00033 until OpenRouter moved the read to another provider at about
// 23:08 UTC, $0.00012 after. And how long one took: 2.4 s, then 1.0 s.
const OBSERVED = [{ usd: 0.00033, seconds: 2.4, when: 'before 23:08 UTC, 14 Oct 2026' }, { usd: 0.00012, seconds: 1.0, when: 'after it' }];
const PRICES = flag('price', null) !== null ? [{ usd: Number(flag('price')), seconds: 2.4, when: '--price' }] : OBSERVED;
const DEAREST = Math.max(...PRICES.map((p) => p.usd));
const BASE = PROMPTS[0];
const CANDIDATES = PROMPTS.slice(1);
// The verify:ai session, whose Riot record bench-read.js's gate scores.
const GATE_SESSION = 'session-2026-09-22T04-24-07-240Z';

function fail(msg) { console.log(msg); process.exit(1); }
if (!PROMPTS.length || PROMPTS.length < 2 || new Set(PROMPTS).size !== PROMPTS.length) fail('--prompts names the base and at least one other, each once: live,c');
if (PRICES.some((p) => !Number.isFinite(p.usd) || p.usd <= 0)) fail('--price is dollars a read, more than 0');

/** A session's frames on disk, as bench-read.js reads them: the log's records with their frame. */
function framesOf(id) {
  const { dir, looked } = benchSession(ROOT, id);
  if (!dir) return { dir: null, looked, n: 0, log: null };
  const log = JSON.parse(fs.readFileSync(path.join(dir, 'log.json'), 'utf8'));
  const n = log.records.filter((r) => r.frame && fs.existsSync(path.join(dir, r.frame))).length;
  return { dir, looked, n, log };
}

const sessions = SESSION_NAMES.map((name) => {
  const s = score.sessionOf(name);
  if (!s) fail(`no session called ${name}: ${Object.keys(score.SESSIONS).join(', ')}`);
  const f = framesOf(s.id);
  if (!f.dir) fail(`No recorded session ${s.id} (${s.name}) to read. Looked for its log.json in:\n${f.looked.map((d) => `  ${d}\n`).join('')}`);
  return { ...s, ...f };
});
const gateFrames = GATES && CANDIDATES.some((p) => p !== 'live') ? framesOf(GATE_SESSION) : null;
if (gateFrames && !gateFrames.dir) fail(`verify:ai's session ${GATE_SESSION} is not on disk; copy it to ${gateFrames.looked[0]}, or pass --no-gate`);

/** Every run, in the order they go. */
function planRuns() {
  const plan = [];
  if (GATES) {
    for (const p of CANDIDATES) {
      if (p === 'live') continue;
      for (const lag of [1, 4]) plan.push({ kind: 'gate', prompt: p, lag, session: GATE_SESSION, name: 'abyss', reads: gateFrames.n });
    }
  }
  for (let k = 1; k <= RUNS; k++) {
    for (const s of sessions) for (const p of PROMPTS) plan.push({ kind: 'session', prompt: p, k, lag: LAG, session: s.id, name: s.name, reads: s.n });
  }
  return plan.map((r, i) => ({ ...r, i: i + 1 }));
}
const plan = planRuns();
const totalReads = plan.reduce((a, r) => a + r.reads, 0);
const usd = (x) => `$${x.toFixed(x >= 0.1 ? 2 : 4)}`;
const hours = (s) => (s >= 3600 ? `${(s / 3600).toFixed(1)} h` : `${Math.round(s / 60)} min`);
const MAX_USD = Number(flag('max-usd', totalReads * DEAREST * 1.25));
if (!Number.isFinite(MAX_USD) || MAX_USD <= 0) fail('--max-usd is dollars, more than 0');

console.log(`bench:sessions, ${GO ? 'RUNNING' : 'the plan (nothing is sent without --go)'}`);
console.log(`  prompts ${PROMPTS.join(', ')} (${BASE} the base), ${RUNS} run${RUNS === 1 ? '' : 's'} of each on ${sessions.map((s) => `${s.name} (${s.n} frames)`).join(', ')}`);
console.log(`  every session run reads as the app reads (bench-read.js --engine), each frame the engine's context${LAG > 1 ? ` ${LAG} reads old (--lag ${LAG})` : ''}`);
console.log('');
const w = { i: String(plan.length).length };
const label = (r) => (r.kind === 'gate' ? `verify:ai ${r.lag > 1 ? '--lag 4' : 'plain'}` : `run ${r.k}`).padEnd(17);
for (const r of plan) {
  console.log(`  ${String(r.i).padStart(w.i)}. ${label(r)}  ${r.name.padEnd(8)}  ${r.prompt.padEnd(5)}  ${String(r.reads).padStart(4)} reads`);
}
console.log('');
console.log(`  ${plan.length} runs, ${totalReads} reads, a read at least ${MIN_GAP / 1000} s apart`);
for (const p of PRICES) {
  console.log(`  at $${p.usd} a read (${p.when}): about ${usd(totalReads * p.usd)}, and about ${hours(totalReads * Math.max(MIN_GAP / 1000, p.seconds))} at ${p.seconds} s a read`);
}
console.log(`  a candidate's prompt is longer than the live one (b's cost 5 to 7% more a read); stops before a run that could pass ${usd(MAX_USD)} (--max-usd)`);
if (!GO) {
  console.log('\nNothing was sent. Run it with --go to spend that.');
  process.exit(0);
}

// ── running it ──────────────────────────────────────────────────────────────

function adminPassword() {
  const envFile = path.join(__dirname, '..', 'server', '.env');
  if (!process.env.ADMIN_PASSWORD && fs.existsSync(envFile)) {
    try {
      let dotenv;
      try { dotenv = require(path.join(__dirname, '..', 'server', 'node_modules', 'dotenv')); } catch { dotenv = require('dotenv'); }
      dotenv.config({ path: envFile, quiet: true });
    } catch (e) { console.log(`could not read ${envFile}: ${e.message}`); }
  }
  return process.env.ADMIN_PASSWORD || '';
}
const ADMIN = adminPassword();
if (!ADMIN) fail('The bench needs the admin password, for the candidate prompts and for the cost of each run: set ADMIN_PASSWORD or server/.env.');
const licenceHash = (() => {
  let key = '';
  try { key = String(JSON.parse(fs.readFileSync(configPath(ROOT), 'utf8')).licenseKey || '').trim().toUpperCase(); } catch { key = ''; }
  return key ? crypto.createHash('sha256').update(key).digest('hex').slice(0, 8) : null;
})();
if (!licenceHash) fail(`No licence key in ${configPath(ROOT)}: the reads are sent with the app's own.`);

const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const OUT = path.resolve(flag('out', path.join(ROOT, 'bench', 'runs', stamp)));
fs.mkdirSync(OUT, { recursive: true });

async function getJson(url, headers) {
  const resp = await fetch(url, { headers: headers || {} });
  if (!resp.ok) throw new Error(`${url.replace(SERVER, '')} answered ${resp.status}`);
  return resp.json();
}

/** The read route's spend of one period's view, or zeros. */
const readOf = (v) => {
  const r = v && v.routes && v.routes.read;
  return { calls: r ? r.calls : 0, real: r ? r.real : 0, estimated: r ? r.estimated : 0, cost: r ? r.cost : 0 };
};

/** /health and /api/admin/costs as one snapshot: the licence's own read spend, the data policy, the boot. */
async function snapshot() {
  const health = await getJson(`${SERVER}/health`);
  const costs = await getJson(`${SERVER}/api/admin/costs`, { 'x-admin-password': ADMIN });
  const mine = (costs.topUsers || []).find((u) => u.user === licenceHash) || null;
  const sum = (o) => Object.values(o || {}).reduce((a, b) => a + (Number(b) || 0), 0);
  return {
    asOf: costs.asOf || new Date().toISOString(), since: costs.since, startedAt: health.startedAt || null,
    readModel: health.readModel || null,
    dataPolicy: { mode: health.dataPolicy ? health.dataPolicy.mode : null, fellBack: sum(health.dataPolicy && health.dataPolicy.fellBack),
      refusedAgain: sum(health.dataPolicy && health.dataPolicy.refusedAgain) },
    own: mine ? { today: readOf(mine.spendToday), month: readOf(mine.spendMonth) } : null,
  };
}

/**
 * What one run cost, from the snapshots either side of it: the licence's month
 * when both have its row in the same month, else its day (a licence with no
 * call yet today has no row, which is a day of zeros), else unknown.
 */
function costBetween(a, b) {
  const r6 = (x) => Math.round(x * 1e6) / 1e6;
  const restarted = a.since !== b.since || (a.startedAt && b.startedAt && Math.abs(Date.parse(a.startedAt) - Date.parse(b.startedAt)) > 5000);
  const day = (s) => String(s.asOf).slice(0, 10);
  const month = (s) => String(s.asOf).slice(0, 7);
  let from = null;
  let to = null;
  let basis = null;
  if (!b.own) return { known: false, restarted, why: 'the licence has no row in the cost view after the run' };
  if (a.own && month(a) === month(b)) { from = a.own.month; to = b.own.month; basis = 'month'; }
  else if (day(a) === day(b)) { from = a.own ? a.own.today : readOf(null); to = b.own.today; basis = a.own ? 'day' : 'day, from no row'; }
  if (!from || restarted) return { known: false, restarted, why: restarted ? 'the server restarted, its ledger with it' : 'the run crossed a month with no row before it' };
  return { known: true, restarted, basis, calls: to.calls - from.calls, real: r6(to.real - from.real), estimated: r6(to.estimated - from.estimated),
    usd: r6(to.cost - from.cost), fellBack: b.dataPolicy.fellBack - a.dataPolicy.fellBack, refusedAgain: b.dataPolicy.refusedAgain - a.dataPolicy.refusedAgain };
}

/** One bench-read.js process, its output to a file beside its trace. */
function benchRead(run) {
  const trace = path.join(OUT, `${String(run.i).padStart(2, '0')}-${run.kind === 'gate' ? `gate-lag${run.lag}` : `run${run.k}`}-${run.name}-${run.prompt}.jsonl`);
  const a = ['live', '--trace', trace, '--min-gap', String(MIN_GAP)];
  if (run.prompt !== 'live') a.push('--variant', run.prompt);
  if (run.lag > 1) a.push('--lag', String(run.lag));
  if (run.kind === 'gate') a.push('--gate');
  else a.push('--engine', '--session', run.session);
  if (fs.existsSync(trace)) fs.unlinkSync(trace);
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [path.join(__dirname, 'bench-read.js'), ...a], { env: process.env, windowsHide: true });
    let out = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { out += d; });
    child.on('exit', (status) => {
      fs.writeFileSync(trace.replace(/\.jsonl$/, '.out.txt'), out);
      resolve({ status, out, trace });
    });
  });
}

/** Why the bench must stop after this run, or null. */
function stopAfter(run, res, cost) {
  if (/not variant|check ADMIN_PASSWORD/.test(res.out)) return `run ${run.i} was not read with ${run.prompt}: ${(/the server [^\n]*/.exec(res.out) || [''])[0]}`;
  let reads = [];
  try { reads = score.readTraceFile(res.trace).reads; } catch { reads = []; }
  if (!reads.length) return `run ${run.i} read nothing (exit ${res.status}): ${res.out.trim().split('\n').slice(-3).join(' | ')}`;
  const hard = reads.filter((r) => /^(401|402|403|429)\b/.test(String(r.err || '')));
  if (hard.length) return `run ${run.i}: ${hard.length} read${hard.length === 1 ? '' : 's'} refused (${hard[0].err.slice(0, 60)})`;
  const errs = reads.filter((r) => r.err).length;
  if (errs > reads.length * 0.05) return `run ${run.i}: ${errs} of ${reads.length} reads failed (${reads.find((r) => r.err).err.slice(0, 60)})`;
  // A run that died part way (a frame gone from its session, say) is no run.
  if (reads.length < run.reads) {
    const why = /^\w*Error\b[^\n]*/m.exec(res.out);
    return `run ${run.i} read ${reads.length} of its ${run.reads} frames (exit ${res.status}): ${(why ? why[0] : res.out.trim().split('\n').slice(-1)[0] || '').slice(0, 160)}`;
  }
  if (cost.restarted) return `the server restarted during run ${run.i}`;
  if (cost.known && (cost.fellBack > 0 || cost.refusedAgain > 0)) return `the data policy fell back during run ${run.i} (fellBack +${cost.fellBack}, refusedAgain +${cost.refusedAgain})`;
  return null;
}

(async () => {
  const results = { started: new Date().toISOString(), server: SERVER, prompts: PROMPTS, runs: RUNS, lag: LAG, plan, done: [] };
  const save = () => fs.writeFileSync(path.join(OUT, 'results.json'), JSON.stringify(results, null, 1));
  console.log(`\ntraces and results in ${OUT}\n`);
  let spent = 0;
  let stopped = null;
  for (const run of plan) {
    if (spent + run.reads * DEAREST > MAX_USD) { stopped = `run ${run.i} could take the spend past ${usd(MAX_USD)} (${usd(spent)} so far)`; break; }
    let before;
    try { before = await snapshot(); } catch (e) { stopped = `no snapshot before run ${run.i}: ${e.message}`; break; }
    const t0 = Date.now();
    const res = await benchRead(run);
    let after;
    try { after = await snapshot(); } catch (e) { after = null; }
    const cost = after ? costBetween(before, after) : { known: false, why: 'no snapshot after the run' };
    if (cost.known) spent += cost.usd;
    else spent += run.reads * DEAREST;
    const gate = run.kind === 'gate' ? (/^GATE PASSED$/m.test(res.out) ? 'PASSED' : /^GATE FAILED$/m.test(res.out) ? 'FAILED' : null) : null;
    let reads = [];
    try { reads = score.readTraceFile(res.trace).reads; } catch { reads = []; }
    const done = { ...run, status: res.status, trace: res.trace, gate, sent: reads.length, errs: reads.filter((r) => r.err).length,
      seconds: Math.round((Date.now() - t0) / 1000), cost, readModel: after ? after.readModel : null };
    results.done.push(done);
    save();
    const per = cost.known && cost.calls ? ` ($${(cost.usd / cost.calls).toFixed(7)} a read)` : '';
    console.log(`  ${String(run.i).padStart(w.i)}. ${run.kind === 'gate' ? `verify:ai${run.lag > 1 ? ' --lag 4' : ''} ${gate || 'NO VERDICT'}` : `run ${run.k}`}`
      + ` ${run.name} ${run.prompt}: ${done.sent} reads, ${done.errs} failed, ${hours(done.seconds)}, `
      + (cost.known ? `$${cost.usd.toFixed(6)}${per}, ${cost.calls} calls (${cost.basis})` : `cost unknown: ${cost.why}`)
      + (cost.known && cost.calls !== done.sent ? `; the licence's calls moved ${cost.calls} for ${done.sent} sent, so another read was in it` : ''));
    stopped = stopAfter(run, res, cost);
    if (stopped) break;
  }
  results.stopped = stopped;
  results.spent = Math.round(spent * 1e6) / 1e6;
  save();
  if (stopped) console.log(`\nSTOPPED: ${stopped}`);
  console.log(`\nspent about $${results.spent.toFixed(6)} in ${results.done.length} of ${plan.length} runs`);

  // ── scored by time against Riot ───────────────────────────────────────────
  const scored = [];
  for (const s of sessions) {
    // Whole runs only: one that died part way would score its unread rounds as missed.
    const runs = results.done.filter((d) => d.kind === 'session' && d.session === s.id && d.sent && d.sent === d.reads);
    if (!runs.length) continue;
    const res = score.scoreSession({ riot: score.riotRecord(s), map: s.map, logged: score.traceOfLog(s.log.records),
      runs: runs.map((d) => ({ name: `${d.prompt}#${d.k}`, trace: score.readTraceFile(d.trace), prompt: d.prompt })) });
    console.log(`\n== ${s.name} (${s.id})`);
    for (const l of score.sessionLines(res, s.log.records.length ? s.log.records[0].at : 0)) console.log(l);
    const byPrompt = {};
    res.runs.forEach((r) => {
      const p = r.name === 'logged' ? null : r.name.split('#')[0];
      if (p) (byPrompt[p] = byPrompt[p] || []).push(r);
    });
    scored.push({ name: s.name, runs: byPrompt });
  }
  const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
  const r1 = (x) => (x === null ? '-' : String(Math.round(x * 10) / 10));
  if (scored.length) {
    console.log('\nthe mean of each prompt\'s runs:');
    console.log(`  ${'session'.padEnd(9)} ${'prompt'.padEnd(6)} runs  caught  invented  plants inv  buy dead  LOBBY   err   p50   p90`);
    for (const s of scored) {
      for (const p of PROMPTS) {
        const rs = s.runs[p] || [];
        if (!rs.length) continue;
        console.log(`  ${s.name.padEnd(9)} ${p.padEnd(6)} ${String(rs.length).padStart(4)}  ${r1(mean(rs.map((r) => Object.keys(r.caught).length))).padStart(4)}/${rs[0].riotDeaths}`
          + `  ${r1(mean(rs.map((r) => r.invented.length))).padStart(8)}  ${r1(mean(rs.map((r) => r.plants.invented.length))).padStart(10)}`
          + `  ${(r1(mean(rs.map((r) => r.buyDeadRate * 100))) + '%').padStart(8)}  ${r1(mean(rs.map((r) => r.lobby))).padStart(5)}`
          + `  ${r1(mean(rs.map((r) => r.errs))).padStart(4)}  ${r1(mean(rs.map((r) => r.p50))).padStart(4)}  ${r1(mean(rs.map((r) => r.p90))).padStart(4)}`);
      }
    }
  }
  const costOf = (p) => {
    const ds = results.done.filter((d) => d.kind === 'session' && d.prompt === p && d.cost && d.cost.known);
    return ds.length ? { usd: ds.reduce((a, d) => a + d.cost.usd, 0), reads: ds.reduce((a, d) => a + d.cost.calls, 0) } : null;
  };
  const gateOf = (p, lag) => { const d = results.done.find((x) => x.kind === 'gate' && x.prompt === p && x.lag === lag); return d ? d.gate : null; };
  results.verdicts = {};
  for (const cand of CANDIDATES) {
    // The judge's bench first: a bench stopped, or narrowed by --runs or --sessions, replaces nothing.
    // Stopped on its last run too: a read refused there, or the data policy
    // falling back, leaves every run planned done and that run whole by its frames.
    const verdict = score.acceptance(scored, { base: BASE, candidate: cand, gates: { plain: gateOf(cand, 1), lag4: gateOf(cand, 4) },
      cost: { [BASE]: costOf(BASE), [cand]: costOf(cand) },
      bench: { stopped: stopped || (results.done.length < plan.length ? 'not every run was done' : null) } });
    results.verdicts[cand] = verdict;
    console.log(`\n${cand} against ${BASE}, the judge's terms:`);
    for (const t of verdict.terms) console.log(`  ${t.ok ? 'MET    ' : 'NOT MET'}  ${t.term}: ${t.detail}`);
    console.log(verdict.ok ? `\n${cand} meets every term: it can replace the ${BASE} prompt.`
      : `\n${cand} does not meet ${verdict.terms.filter((t) => !t.ok).length} of ${verdict.terms.length} terms: keep the ${BASE} prompt.`);
  }
  results.scored = scored.map((s) => ({ name: s.name, runs: Object.fromEntries(Object.entries(s.runs).map(([p, rs]) => [p, rs.map((r) => ({ ...r, frames: undefined }))])) }));
  results.finished = new Date().toISOString();
  save();
  process.exitCode = stopped ? 2 : 0;
})();
