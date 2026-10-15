'use strict';

/**
 * Which model should look at a death, and does it say anything true?
 *
 * Runs the four most teachable deaths of the real Abyss 13 to 11 through
 * POST /api/coach/death-forensics on each model named, with the frames the
 * client would send (the last one before Riot's death second, and the one just
 * after), and prints what each model said beside Riot's facts.
 *
 * THE FIXTURE FRAMES CARRY THE OLD LIVE TIP CARDS. This match was played on a
 * build that still showed tips, and the cards sit over the game in the very
 * frames being judged. The prompt says to ignore them; a model that repeats a
 * card's words back ("the death review says...") is reading the card, not the
 * game, and should be graded down for it.
 *
 * A BENCH, NOT A CHECK. Whether "you swung wide into mid with no utility" is
 * true of a frame is a human judgement, so this prints and a person grades.
 * What it can count is the plumbing: a label from the list, sentences that
 * survived the gates, and how long it took.
 *
 * --screen (8.2): the look a review Riot's record never reached takes, on the
 * same match. The deaths the screen saw, before Riot's record is laid over
 * them, each framed by the frame the screen registered it on and the one
 * before it (death-frames.js looksFor), sent with `source: 'screen'`, so the
 * prompt says the facts were read off the screen and no killer may be named.
 * Riot's record of each round is printed beside the answer, which is what a
 * person grades it against: whether the frames showed the moment at all
 * (the screen can read a death late), and whether a killer slipped through.
 *
 * --timed: the body an 8.3.1+ client sends for a match it did not record.
 * Without it the deaths go as a client from before 8.3.1 sent them, two
 * frames each and no seconds, and the server answers with that prompt. With
 * it the rounds are given Riot's own milliseconds first (withRiotTimes, as
 * index.js hands forensicsFor), so the frames are picked and timed by Riot's
 * moment, and each death whose look knows that moment carries frameAt, each
 * frame's seconds from it, and framesFrom 'reads', its frames in the order
 * index.js sends them (look-stills.js sendOrder). A death the round clock
 * could not place goes without, as it does from the client. The server then
 * builds its timed prompt, which is the one players get: on round one's bench
 * a model's verdict flipped between the two bodies. A look from the screen
 * alone is sent untimed by the client, so --timed changes nothing with
 * --screen.
 *
 * COSTS REAL MONEY, a little: four calls per model, two images each.
 *
 * NEEDS THE ADMIN PASSWORD. The server honours benchModel only beside
 * X-Admin-Password, so set ADMIN_PASSWORD in the environment or in server/.env
 * (the value Railway has).
 *
 *   node scripts/bench-forensics.js google/gemini-3.5-flash-lite openai/gpt-6-luna
 *   node scripts/bench-forensics.js openai/gpt-6-luna --timed
 *   node scripts/bench-forensics.js openai/gpt-6-luna --screen
 *
 * BENCH A, THE LABELS (8.5.0): --own. The set make-look-set.js wrote to
 * userData/bench/looks/ (set.json), the player's own deaths as the live
 * client sends them, mostly five recording stills a death, and the Abyss 13
 * to 11's four, each sent alone so its time is its own, with the variant of
 * the look's prompt asked for (--variant a, b or b2, admin only on the
 * server; bench-look-score.js VARIANTS), --runs times. Every reply is kept RAW beside the server's parsed look
 * (bench-look-score.js reads the raw ones: a parse that enforces the families
 * cannot show a contradiction), and the server must send the raw reply to an
 * admin bench, or the bench stops at its first answer. --key scores it
 * against key.json beside the set, written before the bench by people who
 * watched each death; --costs reads each look's exact cost from
 * /api/admin/costs (the 'bench' route), and the run STOPS at --budget dollars
 * (1.50 by default, half of bench A's $3, since b and its control a are two
 * runs), counted at the larger of the ledger's figure and the estimate,
 * before a look that would pass it. The server sends a bench the reply's
 * label words raw (death-forensics.js rawLabels), never its sentences, or
 * the reply's text from a server that sends that. --dry reads the set and builds
 * every body, and sends nothing, reads no licence and needs no password.
 * Everything is written to userData/bench/looks/runs/, never the repo.
 *
 *   npm run bench:forensics -- openai/gpt-6-sol --own --key --variant b --runs 5 --costs
 *   npm run bench:forensics -- openai/gpt-6-sol --own --key --variant b2 --runs 5 --costs
 *   npm run bench:forensics -- openai/gpt-6-sol --own --key --variant a --runs 5 --costs   (the control)
 *   npm run bench:forensics -- --own --dry
 */

const fs = require('fs');
const path = require('path');
const { replay, load } = require('./fixtures/replay-match');
const verify = require('../src/shared/valorant-verify');
const deathFrames = require('../src/shared/death-frames');
const lookStills = require('../src/main/services/look-stills');
const { profileDir, configPath, benchSession } = require('./profile-path');

const SERVER = process.env.OCCLARA_SERVER || 'https://ghostcoach-production.up.railway.app';
const ROOT = profileDir(process.env.APPDATA || '');
const SESSION = 'session-2026-09-22T04-24-07-240Z';
const MODELS = process.argv.slice(2).filter((a) => a.includes('/'));

// Bench A runs on its own set, and the Abyss bench below is left as it was.
if (process.argv.includes('--own')) {
  ownBench().then((code) => process.exit(code), (e) => { console.error(e && e.stack ? e.stack : e); process.exit(1); });
  return;
}
const SCREEN = process.argv.includes('--screen');
const SOURCE = SCREEN ? 'screen' : 'riot';
// The client's timed body (8.3.1+), for Riot's look; the screen's read frames go untimed from the client.
const TIMED = process.argv.includes('--timed') && !SCREEN;
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
const ADMIN = adminPassword();
if (!ADMIN) {
  console.log('This bench needs the admin password: the server ignores benchModel without it, and every '
    + 'death would quietly be looked at by the live model.\n'
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
const fixture = load('valorant-match-abyss-13-11.json');
const played = replay(fixture.frames, 'standard');
if (played.records.length !== log.records.length) {
  console.log(`the fixture has ${played.records.length} frames and the log ${log.records.length}; they must line up`);
  process.exit(1);
}
// The fixture was cut from this very log, frame for frame, so the replay's
// round for frame i is the round of the log's frame i.
const records = played.records.map((r, i) => ({ ...r, frame: log.records[i].frame }));
const riotRecord = load('riot-abyss-13-11.json');
const { rounds } = verify.reconcile(played.rounds, riotRecord);
// The looks the client takes, by the same picker: Riot's verified deaths, or
// with --screen the screen's own ledger, which Riot never checked. Timed, the
// rounds carry Riot's milliseconds as they do in index.js, which moves the
// moment off the rounded second and can change which frames are picked.
const looks = deathFrames.looksFor(records, SCREEN ? played.rounds
  : TIMED ? deathFrames.withRiotTimes(rounds, riotRecord) : rounds, {}, SOURCE);
const riotOf = (n) => rounds.find((r) => r.n === n) || {};

const deaths = looks.map(({ round: r, frames: recs, gap, frameAt }) => {
  const d = {
    n: r.n, side: r.side, sec: r.deathSec, killer: r.killerAgent, weapon: r.weapon,
    firstDeath: r.firstDeath, traded: r.traded, alive: r.aliveAtDeath,
    planted: r.planted, afterPlant: r.afterPlant, spot: r.deathSpot, gap,
    frames: recs.map((x) => fs.readFileSync(path.join(dir, x.frame)).toString('base64')),
    shown: recs.map((x) => x.frame),
  };
  if (!TIMED || !Array.isArray(frameAt) || frameAt.length !== recs.length || !frameAt.every(Number.isFinite)) return d;
  // index.js askForensics: the last frame before the death and the first after it lead.
  const order = lookStills.sendOrder(frameAt);
  return { ...d, frames: order.map((i) => d.frames[i]), shown: order.map((i) => d.shown[i]),
    frameAt: order.map((i) => frameAt[i]), framesFrom: 'reads' };
});

(async () => {
  console.log(`Abyss 13 to 11, Jett, ${SCREEN ? 'from the screen alone' : "from Riot's record"}`
    + `${TIMED ? ", timed as an 8.3.1+ client sends a match it did not record" : ''}. `
    + `Deaths looked at: ${deaths.map((d) => `R${d.n} (${d.shown.join(', ')}${d.frameAt ? `; at ${d.frameAt.join(', ')} s` : ''})`).join(', ')}\n`);
  for (const model of MODELS) {
    const t0 = Date.now();
    const resp = await fetch(`${SERVER}/api/coach/death-forensics`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-license-key': cfg.licenseKey, 'x-admin-password': ADMIN },
      body: JSON.stringify({ agent: 'Jett', map: 'Abyss', source: SOURCE, deaths: deaths.map(({ shown, ...d }) => d), benchModel: model }),
    });
    const ms = Date.now() - t0;
    const j = resp.ok ? await resp.json() : { error: `${resp.status} ${(await resp.text()).slice(0, 100)}` };
    console.log(`── ${model}  (${ms}ms, served by ${j.model || '?'})`);
    if (j.error) { console.log('   ', j.error); continue; }
    if (j.model !== model) {
      console.log(`    the server ran ${j.model || 'its live model'}, not ${model}, so these are not this model's answers: check ADMIN_PASSWORD`);
      continue;
    }
    for (const d of j.deaths || []) {
      const facts = deaths.find((x) => x.n === d.n);
      // Riot's record of the round, beside what the screen sent when that is
      // what was sent: a death Riot does not have is one the screen invented.
      const rr = riotOf(d.n);
      const said = !rr.died ? 'no death in this round'
        : `${rr.deathSec}s, ${rr.killerAgent} with a ${rr.weapon}${rr.firstDeath ? ', first death' : ''}`;
      const screen = SCREEN ? `[Screen: ${facts.spot || 'no spot'}${facts.planted ? ', planted' : ''}] ` : '';
      console.log(`   R${d.n}  ${d.cause}${d.failed ? '  FAILED' : ''}   ${screen}[Riot: ${said}]`);
      if (d.what) console.log(`        saw:    ${d.what}`);
      if (d.better) console.log(`        better: ${d.better}`);
    }
    console.log('');
  }
})();

// ── Bench A: the labels, on the player's own deaths (--own) ─────────────────

/** The models the server will bench, from its BENCH_MODELS list, or null when it cannot be read. */
function benchList() {
  try {
    const src = fs.readFileSync(path.join(__dirname, '..', 'server', 'routes', 'coach.js'), 'utf8');
    const block = /const BENCH_MODELS = new Set\(\[([\s\S]*?)\]\);/.exec(src);
    return block ? new Set([...block[1].matchAll(/'([^']+)'/g)].map((m) => m[1])) : null;
  } catch {
    return null;
  }
}

/** The bench's own spend so far today, from /api/admin/costs: the 'bench' route, or the look's own on a server from before it. Null when unread. */
async function benchSpend(admin) {
  try {
    const resp = await fetch(`${SERVER}/api/admin/costs`, { headers: { 'x-admin-password': admin } });
    if (!resp.ok) return null;
    const j = await resp.json();
    const routes = (j.spend && j.spend.today && j.spend.today.routes) || {};
    const r = routes.bench || routes.forensics || null;
    return r ? { route: routes.bench ? 'bench' : 'forensics', real: r.real || 0, estimated: r.estimated || 0, calls: r.calls || 0 } : null;
  } catch {
    return null;
  }
}

async function ownBench() {
  const score = require('./bench-look-score');
  const args = process.argv.slice(2);
  const flag = (name, dflt) => {
    const i = args.indexOf(`--${name}`);
    return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : dflt;
  };
  const DRY = args.includes('--dry');
  const KEYED = args.includes('--key');
  const COSTS = args.includes('--costs');
  const RUNS = Math.max(1, Math.floor(Number(flag('runs', 1)) || 1));
  const VARIANT = String(flag('variant', 'a')).trim().toLowerCase();
  const BUDGET = Number(flag('budget', score.RUN_USD));
  const GAP_MS = Math.max(0, Number(flag('gap', 2)) * 1000);
  const LOOKS = path.resolve(flag('looks', path.join(ROOT, 'bench', 'looks')));
  if (!score.VARIANTS.includes(VARIANT)) {
    console.log(`--variant is ${score.VARIANTS.slice(0, -1).join(', ')} or ${score.VARIANTS[score.VARIANTS.length - 1]}, not ${VARIANT}`);
    return 1;
  }
  if (!(BUDGET > 0)) { console.log('--budget is the dollars the run may spend, more than 0'); return 1; }

  let set = null;
  try { set = JSON.parse(fs.readFileSync(path.join(LOOKS, 'set.json'), 'utf8')); } catch { set = null; }
  if (!set || !Array.isArray(set.deaths) || !set.deaths.length) {
    console.log(`No look set in ${LOOKS}. Make it first, with the moments of any clip saved before 8.4.4:\n`
      + '  npx electron scripts/make-look-set.js --only <reviews> --at <review>@<round>=<seconds>');
    return 1;
  }
  let key = null;
  if (KEYED) {
    try { key = JSON.parse(fs.readFileSync(path.join(LOOKS, 'key.json'), 'utf8')); } catch { key = null; }
    if (!key) {
      console.log(`--key needs ${path.join(LOOKS, 'key.json')}: key.template.json beside it, filled by the people who watched each death, before the bench.`);
      return 1;
    }
    const problems = score.keyProblems(set, key);
    if (problems.length) { console.log(`The key cannot score this set:\n${problems.map((p) => `  ${p}`).join('\n')}`); return 1; }
  }
  const read = (rel) => fs.readFileSync(path.join(LOOKS, rel));
  const bodies = set.deaths.map((d) => ({ d, death: score.bodyDeath(d, read) }));
  const planned = bodies.reduce((a, b) => a + score.estimate(b.d), 0) * RUNS;
  console.log(`Bench A on ${set.deaths.length} deaths (${set.deaths.filter((d) => d.body === 'recording').length} from the recording, `
    + `${set.deaths.filter((d) => d.body === 'reads').length} the read's frames), ${RUNS} run${RUNS === 1 ? '' : 's'}, variant ${VARIANT}: `
    + `${bodies.length * RUNS} looks, about $${planned.toFixed(2)}, stopped at $${BUDGET.toFixed(2)}.`);
  for (const { d, death } of bodies) {
    console.log(`  ${d.key.padEnd(10)} ${String(d.match).padEnd(20)} ${d.body.padEnd(9)} ${death.frames.length} frame${death.frames.length === 1 ? '' : 's'}`
      + `${death.frameAt ? ` at ${death.frameAt.join(', ')} s` : ''}`);
  }
  if (DRY) { console.log('\n--dry: nothing sent.'); return 0; }

  // A model is named as a provider/model word, never a flag's own value (a --looks path has slashes too).
  const VALUED = new Set(['looks', 'variant', 'runs', 'budget', 'gap']);
  const models = args.filter((a, i) => a.includes('/') && !a.startsWith('--') && !(i > 0 && VALUED.has(args[i - 1].replace(/^--/, ''))));
  const model = models[0] || null;
  if (models.length !== 1) { console.log('Name the one model to bench, as on the server\'s BENCH_MODELS list.'); return 1; }
  const listed = benchList();
  if (listed && !listed.has(model)) { console.log(`${model} is not on the server's BENCH_MODELS list, so the server would answer on its own model.`); return 1; }
  const admin = adminPassword();
  if (!admin) { console.log('Bench A needs ADMIN_PASSWORD: the server honours benchModel and a variant only beside it.'); return 1; }
  const cfg = JSON.parse(fs.readFileSync(configPath(ROOT), 'utf8'));
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  const looks = [];
  let spent = 0;
  let stopped = null;
  for (let run = 1; run <= RUNS && !stopped; run++) {
    for (const { d, death } of bodies) {
      // A look the server could not take (its 25 s timeout, the provider's
      // error: `failed`, and no reply to be raw about) is asked once more,
      // within the budget, and a second failure stops the run saying so.
      let look = null;
      let ms = 0;
      let booked = null;
      for (let attempt = 1; attempt <= 2 && !look && !stopped; attempt++) {
        const est = score.estimate(d);
        if (spent + est > BUDGET) { stopped = `the budget: $${spent.toFixed(4)} spent, and the next look would pass $${BUDGET.toFixed(2)}`; break; }
        const before = COSTS ? await benchSpend(admin) : null;
        const t0 = Date.now();
        let j = null;
        try {
          const resp = await fetch(`${SERVER}/api/coach/death-forensics`, {
            method: 'POST',
            headers: { 'content-type': 'application/json', 'x-license-key': cfg.licenseKey, 'x-admin-password': admin, 'x-occlara-version': '8.5.0' },
            body: JSON.stringify({ agent: d.agent, map: d.map, language: 'en', source: d.source, deaths: [death], benchModel: model, variant: VARIANT, raw: true }),
          });
          j = resp.ok ? await resp.json() : { error: `${resp.status} ${(await resp.text()).slice(0, 120)}` };
        } catch (e) { j = { error: e.message }; }
        ms = Date.now() - t0;
        const after = COSTS ? await benchSpend(admin) : null;
        booked = before && after && before.route === after.route ? Math.max(0, (after.real + after.estimated) - (before.real + before.estimated)) : null;
        spent += Math.max(booked || 0, est);
        if (j.error) { stopped = `the server: ${j.error}`; break; }
        if (j.model !== model) { stopped = `the server answered on ${j.model || 'its live model'}, not ${model}: check ADMIN_PASSWORD`; break; }
        if (j.variant !== VARIANT) { stopped = `the server answered with variant ${j.variant || 'none'}, not ${VARIANT}: is it deployed?`; break; }
        const got = (j.deaths || [])[0] || {};
        if (got.failed) {
          console.log(`  run ${run} ${d.key.padEnd(10)} FAILED on the server, ${ms} ms${attempt === 1 ? ', asking once more' : ''}`);
          if (attempt === 2) stopped = `the server failing ${d.key} twice (its timeout or the provider's error)`;
          continue;
        }
        if (typeof got.raw !== 'string' && !(got.raw && typeof got.raw === 'object')) { stopped = 'the server sent no raw reply, and bench A scores raw replies'; break; }
        look = got;
      }
      if (!look) break;
      looks.push({ key: d.key, run, raw: look.raw, parsed: { cause: look.cause, fight: look.fight || null, change: look.change || null,
        what: look.what || null, better: look.better || null, failed: !!look.failed }, ms, cost: booked });
      const r = score.rawLook(look.raw);
      console.log(`  run ${run} ${d.key.padEnd(10)} raw ${r.fight ? `${r.fight}/` : ''}${r.cause || 'none'}${r.change ? ` (${r.change})` : ''}`
        + ` parsed ${look.cause}${look.failed ? ' FAILED' : ''}  ${ms} ms${booked !== null ? `, $${booked.toFixed(4)}` : ''}`);
      await sleep(GAP_MS);
    }
  }
  const result = score.score({ set, key, looks, variant: VARIANT, runs: RUNS });
  const out = path.join(LOOKS, 'runs', `${new Date().toISOString().replace(/[:.]/g, '-')}-${model.replace(/[^a-z0-9.-]+/gi, '_')}-${VARIANT}.json`);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify({ model, variant: VARIANT, runs: RUNS, spent, stopped, looks, result }, null, 1));
  console.log(`\n${looks.length} looks, $${spent.toFixed(4)} spent${COSTS ? '' : ' (estimated: run with --costs for the ledger\'s)'}${stopped ? `; stopped by ${stopped}` : ''}.`);
  for (const p of result.perDeath) console.log(`  ${p.key.padEnd(10)} raw ${p.raw.join(' | ')}${p.answer ? `   key ${p.answer.acceptable.join('/') || 'none'}` : ''}`);
  if (!KEYED) console.log('\nNo key: the bars need --key.');
  for (const b of result.bars) console.log(`  ${b.pass === null ? 'n/a ' : b.pass ? 'PASS' : 'FAIL'}  ${b.name.padEnd(10)} ${b.value}, ${b.limit}${b.note ? ` (${b.note})` : ''}`);
  console.log(`\nWritten to ${out}`);
  return stopped || (KEYED && !result.pass) ? 1 : 0;
}
