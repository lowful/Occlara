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
 * COSTS REAL MONEY, a little: four calls per model, two images each.
 *
 * NEEDS THE ADMIN PASSWORD. The server honours benchModel only beside
 * X-Admin-Password, so set ADMIN_PASSWORD in the environment or in server/.env
 * (the value Railway has).
 *
 *   node scripts/bench-forensics.js google/gemini-3.5-flash-lite openai/gpt-6-luna
 *   node scripts/bench-forensics.js openai/gpt-6-luna --screen
 */

const fs = require('fs');
const path = require('path');
const { replay, load } = require('./fixtures/replay-match');
const verify = require('../src/shared/valorant-verify');
const deathFrames = require('../src/shared/death-frames');
const { profileDir, configPath, benchSession } = require('./profile-path');

const SERVER = process.env.OCCLARA_SERVER || 'https://ghostcoach-production.up.railway.app';
const ROOT = profileDir(process.env.APPDATA || '');
const SESSION = 'session-2026-09-22T04-24-07-240Z';
const MODELS = process.argv.slice(2).filter((a) => a.includes('/'));
const SCREEN = process.argv.includes('--screen');
const SOURCE = SCREEN ? 'screen' : 'riot';
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
const { rounds } = verify.reconcile(played.rounds, load('riot-abyss-13-11.json'));
// The looks the client takes, by the same picker: Riot's verified deaths, or
// with --screen the screen's own ledger, which Riot never checked.
const looks = deathFrames.looksFor(records, SCREEN ? played.rounds : rounds, {}, SOURCE);
const riotOf = (n) => rounds.find((r) => r.n === n) || {};

const deaths = looks.map(({ round: r, frames: recs, gap }) => ({
  n: r.n, side: r.side, sec: r.deathSec, killer: r.killerAgent, weapon: r.weapon,
  firstDeath: r.firstDeath, traded: r.traded, alive: r.aliveAtDeath,
  planted: r.planted, afterPlant: r.afterPlant, spot: r.deathSpot, gap,
  frames: recs.map((x) => fs.readFileSync(path.join(dir, x.frame)).toString('base64')),
  shown: recs.map((x) => x.frame),
}));

(async () => {
  console.log(`Abyss 13 to 11, Jett, ${SCREEN ? 'from the screen alone' : "from Riot's record"}. `
    + `Deaths looked at: ${deaths.map((d) => `R${d.n} (${d.shown.join(', ')})`).join(', ')}\n`);
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
