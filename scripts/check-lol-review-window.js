'use strict';

/**
 * The post-game review must actually reach the screen.
 *
 * The logic is covered offline by test:lolreview. What that cannot see is the
 * part this repo has been bitten by twice: a channel name drifting between main
 * and preload, after which the surface silently receives nothing and shows an
 * empty state that looks deliberate. So this boots the real app, broadcasts a
 * real review on the real channel, and reads the rendered DOM back.
 *
 * Results travel through a FILE, not stdout: an Electron main process on Windows
 * does not reliably flush a piped stdout.
 */

const path = require('path');
const fs = require('fs');
const os = require('os');

const REPO = path.join(__dirname, '..');
const OUT = path.join(os.tmpdir(), 'occlara-lolreview-check.json');

if (!process.versions.electron) {
  const { spawnSync } = require('child_process');
  const electron = require('electron');
  try { fs.unlinkSync(OUT); } catch { /* nothing to clear */ }

  const env = Object.assign({}, process.env, { OCCLARA_REVIEW_OUT: OUT });
  // This shell exports ELECTRON_RUN_AS_NODE=1, which makes the Electron binary
  // run as plain node and the app dies with a misleading error.
  delete env.ELECTRON_RUN_AS_NODE;
  const r = spawnSync(electron, [__filename], { env, timeout: 120000 });

  let rec = null;
  try { rec = JSON.parse(fs.readFileSync(OUT, 'utf8')); } catch { /* reported below */ }
  if (!rec) { console.error('FAIL: the check wrote no result (exit ' + r.status + ')'); process.exit(1); }
  for (const l of rec.lines) console.log('  ' + l);
  if (!rec.ok) { console.error('FAIL: ' + rec.detail); process.exit(1); }
  console.log('PASS: a finished League game reaches the review window and paints');
  process.exit(0);
}

const { app, BrowserWindow } = require('electron');
const C = require(path.join(REPO, 'src/shared/channels'));
const review = require(path.join(REPO, 'src/shared/lol-review'));

const lines = [];
let reported = false;
function report(ok, detail) {
  if (reported) return;
  reported = true;
  try { fs.writeFileSync(process.env.OCCLARA_REVIEW_OUT || OUT, JSON.stringify({ ok, detail, lines })); }
  catch { /* exit code still carries it */ }
  app.exit(ok ? 0 : 1);
}

const ud = path.join(os.tmpdir(), 'occlara-check-lolreview');
fs.rmSync(ud, { recursive: true, force: true });
fs.mkdirSync(ud, { recursive: true });
fs.writeFileSync(path.join(ud, 'occlara-config.json'), JSON.stringify({
  game: 'lol', onboardingCompleted: true, licenseKey: '', language: 'en', lolRole: 'Mid', lolBand: 2,
}, null, 2));
process.env.OCCLARA_DEV_USERDATA = ud;

app.disableHardwareAcceleration();
app.on('window-all-closed', () => { /* the run below decides when we exit */ });

const ME = 'Me#EUW';
const FOE = 'Foe#EUW';
const RECORD = {
  me: ME, allies: ['Ally1#EUW', 'Ally2#EUW'], champion: 'Ahri', role: 'Mid', band: 2, mode: 'CLASSIC',
  stats: { gameTimeSec: 1800, csAt10: 52, deathsBy15: 2, wardScore: 9.5, deathsAhead: null, goldHeldSec: null },
  final: { cs: 180, kills: 5, deaths: 2, assists: 7, ward: 9.5, level: 16 },
  events: [
    { EventID: 1, EventName: 'ChampionKill', EventTime: 300, KillerName: FOE, VictimName: 'Ally1#EUW' },
    { EventID: 2, EventName: 'ChampionKill', EventTime: 310, KillerName: FOE, VictimName: ME },
    { EventID: 3, EventName: 'ChampionKill', EventTime: 900, KillerName: FOE, VictimName: ME },
    { EventID: 4, EventName: 'DragonKill', EventTime: 950, KillerName: 'Ally2#EUW' },
  ],
};

setTimeout(async () => {
  const registry = require(path.join(REPO, 'src/main/windows/registry'));
  const reviewWindow = require(path.join(REPO, 'src/main/windows/review-window'));

  try {
    const built = review.buildReview(RECORD, []);
    lines.push('built: ' + built.game.champion + ' ' + built.scoreline.kills + '/'
      + built.scoreline.deaths + '/' + built.scoreline.assists + ', moments=' + built.moments.length);

    reviewWindow.open();
    await new Promise((r) => setTimeout(r, 2800));
    const win = BrowserWindow.getAllWindows().find((w) => (w.webContents.getURL() || '').indexOf('/review/') !== -1);
    if (!win) return report(false, 'the review window never opened');

    const errs = [];
    win.webContents.on('console-message', (e, lvl, msg) => { if (lvl >= 2) errs.push(msg); });

    // The real channel, the real broadcast helper. A name drifting between main
    // and preload is exactly what this is here to catch.
    registry.broadcast(C.PUSH_LOL_REVIEW, built);
    await new Promise((r) => setTimeout(r, 1600));

    const js = (s) => win.webContents.executeJavaScript(s);
    const shown = await js("!document.getElementById('review').hidden");
    const champ = await js("document.getElementById('r-champ').textContent");
    const death = await js("document.getElementById('r-death-head').textContent");
    const moments = await js("document.querySelectorAll('#r-moments .moment').length");
    const objs = await js("document.querySelectorAll('#r-obj .obj-row').length");
    const next = await js("document.getElementById('r-next-title').textContent");

    lines.push('painted: champion="' + champ + '" moments=' + moments + ' objectives=' + objs);
    lines.push('deaths : ' + death);
    lines.push('next   : ' + next);

    if (!shown) return report(false, 'the review stayed hidden, so the push never arrived');
    if (champ !== 'Ahri') return report(false, 'champion painted as "' + champ + '"');
    if (moments !== built.moments.length) return report(false, 'moments rendered ' + moments + ', expected ' + built.moments.length);
    if (objs !== 3) return report(false, 'objective rows rendered ' + objs + ', expected 3');
    if (!death) return report(false, 'the death summary is empty');
    if (!next) return report(false, 'the review did not say what to work on next');
    if (errs.length) return report(false, 'renderer errors: ' + errs.join(' | '));

    report(true, 'ok');
  } catch (e) {
    report(false, 'threw: ' + e.message);
  }
}, 6500);

require(path.join(REPO, 'src/main/index.js'));
