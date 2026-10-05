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
 * COSTS REAL MONEY, a little: four calls per model, two images each.
 *
 * NEEDS THE ADMIN PASSWORD. The server honours benchModel only beside
 * X-Admin-Password, so set ADMIN_PASSWORD in the environment or in server/.env
 * (the value Railway has).
 *
 *   node scripts/bench-forensics.js google/gemini-3.5-flash-lite openai/gpt-6-luna
 */

const fs = require('fs');
const path = require('path');
const { replay, load } = require('./fixtures/replay-match');
const verify = require('../src/shared/valorant-verify');
const deathFrames = require('../src/shared/death-frames');
const { profileDir, configPath } = require('./profile-path');

const SERVER = process.env.OCCLARA_SERVER || 'https://ghostcoach-production.up.railway.app';
const ROOT = profileDir(process.env.APPDATA || '');
const SESSION = 'session-2026-09-22T04-24-07-240Z';
const MODELS = process.argv.slice(2).filter((a) => a.includes('/'));
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

const dir = path.join(ROOT, 'ai-log', SESSION);
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
const { rounds } = verify.reconcile(played.rounds, load('riot-abyss-13-11.json'));
const picks = deathFrames.teachableDeaths(rounds, 4);

const deaths = picks.map((r) => {
  const recs = deathFrames.framesFor(records, r, {});
  return {
    n: r.n, side: r.side, sec: r.deathSec, killer: r.killerAgent, weapon: r.weapon,
    firstDeath: r.firstDeath, traded: r.traded, alive: r.aliveAtDeath,
    planted: r.planted, afterPlant: r.afterPlant, spot: r.deathSpot,
    gap: recs[0] && deathFrames.secondsIn(recs[0]) !== null ? Math.max(0, r.deathSec - deathFrames.secondsIn(recs[0])) : null,
    frames: recs.map((x) => fs.readFileSync(path.join(dir, x.frame)).toString('base64')),
    shown: recs.map((x) => x.frame),
  };
}).filter((d) => d.frames.length);

(async () => {
  console.log(`Abyss 13 to 11, Jett. Deaths looked at: ${deaths.map((d) => `R${d.n} (${d.shown.join(', ')})`).join(', ')}\n`);
  for (const model of MODELS) {
    const t0 = Date.now();
    const resp = await fetch(`${SERVER}/api/coach/death-forensics`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-license-key': cfg.licenseKey, 'x-admin-password': ADMIN },
      body: JSON.stringify({ agent: 'Jett', map: 'Abyss', deaths: deaths.map(({ shown, ...d }) => d), benchModel: model }),
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
      console.log(`   R${d.n}  ${d.cause}${d.failed ? '  FAILED' : ''}   [Riot: ${facts.sec}s, ${facts.killer} with a ${facts.weapon}${facts.firstDeath ? ', first death' : ''}]`);
      if (d.what) console.log(`        saw:    ${d.what}`);
      if (d.better) console.log(`        better: ${d.better}`);
    }
    console.log('');
  }
})();
