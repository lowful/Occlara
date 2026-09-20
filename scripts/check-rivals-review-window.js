'use strict';

/**
 * The Marvel Rivals review must actually reach the screen, and must not damage
 * the League one that shares the window.
 *
 * THE SAME RISK check-lol-review-window.js exists for, now doubled. That file's
 * header records it: a channel name drifting between main and preload leaves
 * the surface silently receiving nothing and showing an empty state that looks
 * deliberate. PUSH_RIVALS_REVIEW is a brand new channel with a brand new
 * preload method behind it, so it carries exactly that risk on day one.
 *
 * The second half is the part offline tests genuinely cannot reach. One window
 * now renders two shapes, and each painter hides the sections the other needs.
 * A League review pushed after a Rivals one must come back with its deaths, its
 * objectives and its skill table intact. Getting that wrong does not throw, does
 * not log, and does not fail any check that reads source: it silently drops
 * three sections out of a League player's review forever.
 *
 * So this pushes a Rivals review, reads the DOM, then pushes a League review
 * into the SAME window and reads it again.
 *
 * Results travel through a FILE, not stdout: an Electron main process on Windows
 * does not reliably flush a piped stdout.
 */

const path = require('path');
const fs = require('fs');
const os = require('os');

const REPO = path.join(__dirname, '..');
const OUT = path.join(os.tmpdir(), 'occlara-rivalsreview-check.json');

if (!process.versions.electron) {
  const { spawnSync } = require('child_process');
  const electron = require('electron');
  try { fs.unlinkSync(OUT); } catch { /* nothing to clear */ }

  const env = Object.assign({}, process.env, { OCCLARA_REVIEW_OUT: OUT });
  // This shell exports ELECTRON_RUN_AS_NODE=1, which makes the Electron binary
  // run as plain node and the app dies with a misleading setName error.
  delete env.ELECTRON_RUN_AS_NODE;
  const r = spawnSync(electron, [__filename], { env, timeout: 120000 });

  let rec = null;
  try { rec = JSON.parse(fs.readFileSync(OUT, 'utf8')); } catch { /* reported below */ }
  if (!rec) { console.error('FAIL: the check wrote no result (exit ' + r.status + ')'); process.exit(1); }
  for (const l of rec.lines) console.log('  ' + l);
  if (!rec.ok) { console.error('FAIL: ' + rec.detail); process.exit(1); }
  console.log('PASS: a Rivals review paints, and a League review still paints after it');
  process.exit(0);
}

const { app, BrowserWindow } = require('electron');
const C = require(path.join(REPO, 'src/shared/channels'));
const rivals = require(path.join(REPO, 'src/shared/rivals-review'));
const lol = require(path.join(REPO, 'src/shared/lol-review'));

const lines = [];
let reported = false;
function report(ok, detail) {
  if (reported) return;
  reported = true;
  try { fs.writeFileSync(process.env.OCCLARA_REVIEW_OUT || OUT, JSON.stringify({ ok, detail, lines })); }
  catch { /* exit code still carries it */ }
  app.exit(ok ? 0 : 1);
}

const ud = path.join(os.tmpdir(), 'occlara-check-rivalsreview');
fs.rmSync(ud, { recursive: true, force: true });
fs.mkdirSync(ud, { recursive: true });
fs.writeFileSync(path.join(ud, 'occlara-config.json'), JSON.stringify({
  game: 'rivals', onboardingCompleted: true, licenseKey: '', language: 'en',
}, null, 2));
process.env.OCCLARA_DEV_USERDATA = ud;

app.disableHardwareAcceleration();
app.on('window-all-closed', () => { /* the run below decides when we exit */ });

// A Strategist who did not heal, so the one judgement the review makes is
// exercised rather than skipped.
const SCOREBOARD = {
  phase: 'scoreboard', result: 'defeat',
  map: 'Tokyo 2099: Shin-Shibuya', mode: 'Convergence',
  me: { role: 'Strategist', kills: 4, deaths: 11, assists: 21,
    damage: 9840, blocked: 0, healing: 1240, accuracy: 29 },
};

const LOL_RECORD = {
  me: 'Me#EUW', allies: ['Ally1#EUW'], champion: 'Ahri', role: 'Mid', band: 2, mode: 'CLASSIC',
  stats: { gameTimeSec: 1800, csAt10: 52, deathsBy15: 2, wardScore: 9.5 },
  final: { cs: 180, kills: 5, deaths: 2, assists: 7, ward: 9.5, level: 16 },
  events: [
    { EventID: 1, EventName: 'ChampionKill', EventTime: 310, KillerName: 'Foe#EUW', VictimName: 'Me#EUW' },
    { EventID: 2, EventName: 'DragonKill', EventTime: 950, KillerName: 'Ally1#EUW' },
  ],
};

setTimeout(async () => {
  const registry = require(path.join(REPO, 'src/main/windows/registry'));
  const reviewWindow = require(path.join(REPO, 'src/main/windows/review-window'));

  try {
    const built = rivals.buildReview({ hero: 'Luna Snow', state: SCOREBOARD });
    if (built.empty) return report(false, 'the review built empty: ' + built.why);
    lines.push('built  : ' + built.game.hero + ' ' + built.scoreline.kills + '/'
      + built.scoreline.deaths + '/' + built.scoreline.assists
      + ', refusals=' + built.refused.length);

    reviewWindow.open();
    await new Promise((r) => setTimeout(r, 2800));
    const win = BrowserWindow.getAllWindows().find((w) => (w.webContents.getURL() || '').indexOf('/review/') !== -1);
    if (!win) return report(false, 'the review window never opened');

    const errs = [];
    win.webContents.on('console-message', (e, lvl, msg) => { if (lvl >= 2) errs.push(msg); });
    const js = (s) => win.webContents.executeJavaScript(s);

    // ── The Rivals review, on the real channel ─────────────────────────────
    registry.broadcast(C.PUSH_RIVALS_REVIEW, built);
    await new Promise((r) => setTimeout(r, 1600));

    const shown = await js("!document.getElementById('review').hidden");
    const hero = await js("document.getElementById('r-champ').textContent");
    const head = await js("document.getElementById('r-verdict-head').textContent");
    const verdict = await js("document.getElementById('r-death-head').textContent");
    const arch = await js("document.getElementById('r-arch').textContent");
    const refused = await js("document.querySelectorAll('#r-refused li').length");
    const stats = await js("document.querySelectorAll('#r-scores .stat').length");
    // The League-only sections must be off, not empty.
    const momentsOn = await js("!document.getElementById('r-moments-wrap').hidden");
    const skillsOn = await js("!document.getElementById('r-skills-wrap').hidden");

    lines.push('rivals : hero="' + hero + '" stats=' + stats + ' refusals=' + refused);
    lines.push('       : "' + head + '" / "' + verdict + '"');
    lines.push('       : ' + arch);

    if (!shown) return report(false, 'the Rivals review stayed hidden, so the push never arrived');
    if (hero !== 'Luna Snow') return report(false, 'hero painted as "' + hero + '"');
    if (head !== 'Did you play the role') {
      // The exact bug a screenshot caught: a static League heading sitting above
      // a Rivals verdict.
      return report(false, 'the verdict heading still reads "' + head + '"');
    }
    if (!verdict) return report(false, 'the role verdict is empty');
    if (!/brawl/i.test(arch)) return report(false, 'the archetype line reads "' + arch + '"');
    if (refused < 3) return report(false, 'only ' + refused + ' refusals rendered');
    if (stats !== 5) return report(false, stats + ' stat boxes rendered, expected 5');
    if (momentsOn) return report(false, 'the League moments section was left visible');
    if (skillsOn) return report(false, 'the League skill table was left visible');

    // ── Now a LEAGUE review into the same window ───────────────────────────
    // Everything the Rivals painter hid has to come back.
    const built2 = lol.buildReview(LOL_RECORD, []);
    registry.broadcast(C.PUSH_LOL_REVIEW, built2);
    await new Promise((r) => setTimeout(r, 1600));

    const champ = await js("document.getElementById('r-champ').textContent");
    const head2 = await js("document.getElementById('r-verdict-head').textContent");
    const objs = await js("document.querySelectorAll('#r-obj .obj-row').length");
    const skillsBack = await js("!document.getElementById('r-skills-wrap').hidden");
    const deathsBack = await js("!document.getElementById('r-death-head').closest('.block').hidden");
    const objsBack = await js("!document.getElementById('r-obj').closest('.block').hidden");
    const archOff = await js("document.getElementById('r-arch-wrap').hidden");
    const refusedOff = await js("document.getElementById('r-refused-wrap').hidden");

    lines.push('league : champion="' + champ + '" objectives=' + objs
      + ' skills=' + skillsBack + ' deaths=' + deathsBack);

    if (champ !== 'Ahri') return report(false, 'League champion painted as "' + champ + '"');
    if (head2 !== 'How you died') return report(false, 'the League heading reads "' + head2 + '"');
    if (objs !== 3) return report(false, 'League objective rows rendered ' + objs + ', expected 3');
    if (!skillsBack) return report(false, 'the skill table stayed hidden after a Rivals review');
    if (!deathsBack) return report(false, 'the deaths block stayed hidden after a Rivals review');
    if (!objsBack) return report(false, 'the objectives block stayed hidden after a Rivals review');
    if (!archOff) return report(false, 'the Rivals archetype section was left visible under League');
    if (!refusedOff) return report(false, 'the Rivals refusals were left visible under League');
    if (errs.length) return report(false, 'renderer errors: ' + errs.join(' | '));

    report(true, 'ok');
  } catch (e) {
    report(false, 'threw: ' + e.message);
  }
}, 6500);

require(path.join(REPO, 'src/main/index.js'));
