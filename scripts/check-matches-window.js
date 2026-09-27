'use strict';

/**
 * The match library must list what was saved, and a row must open its review.
 *
 * test:grade covers the store and the patterns offline. What it cannot see is
 * the path through the real app: main reading the store behind REVIEWS_LIST and
 * PATTERNS_GET, the preload bridge, the renderer painting rows, and a click
 * travelling back through REVIEW_OPEN to open the review window on THAT match
 * with its kept frame. A channel drifting between main and preload shows an
 * empty library that looks exactly like a player who has not played yet.
 *
 * Results travel through a FILE, not stdout: an Electron main process on Windows
 * does not reliably flush a piped stdout.
 *
 * Run: npm run check:matches
 */

const path = require('path');
const fs = require('fs');
const os = require('os');

const REPO = path.join(__dirname, '..');
const OUT = path.join(os.tmpdir(), 'occlara-matches-check.json');

if (!process.versions.electron) {
  const { spawnSync } = require('child_process');
  const electron = require('electron');
  try { fs.unlinkSync(OUT); } catch { /* nothing to clear */ }
  const env = Object.assign({}, process.env, { OCCLARA_MATCHES_OUT: OUT });
  delete env.ELECTRON_RUN_AS_NODE;
  const r = spawnSync(electron, [__filename], { env, timeout: 120000 });
  let rec = null;
  try { rec = JSON.parse(fs.readFileSync(OUT, 'utf8')); } catch { /* reported below */ }
  if (!rec) { console.error('FAIL: the check wrote no result (exit ' + r.status + ')'); process.exit(1); }
  for (const l of rec.lines) console.log('  ' + l);
  if (!rec.ok) { console.error('FAIL: ' + rec.detail); process.exit(1); }
  console.log('PASS: saved reviews are listed, patterns paint, and a row opens its review');
  process.exit(0);
}

const { app, BrowserWindow } = require('electron');
const { replay, load } = require('./fixtures/replay-match');
const verify = require(path.join(REPO, 'src/shared/valorant-verify'));
const valorantReview = require(path.join(REPO, 'src/shared/valorant-review'));
const { ReviewStore, newId } = require(path.join(REPO, 'src/main/services/review-store'));

const lines = [];
let reported = false;
function report(ok, detail) {
  if (reported) return;
  reported = true;
  try { fs.writeFileSync(process.env.OCCLARA_MATCHES_OUT || OUT, JSON.stringify({ ok, detail, lines })); }
  catch { /* exit code still carries it */ }
  app.exit(ok ? 0 : 1);
}

// A profile holding three saved Valorant reviews, built from the real match.
const ud = path.join(os.tmpdir(), 'occlara-check-matches');
fs.rmSync(ud, { recursive: true, force: true });
fs.mkdirSync(ud, { recursive: true });
fs.writeFileSync(path.join(ud, 'occlara-config.json'), JSON.stringify({
  game: 'valorant', onboardingCompleted: true, licenseKey: '', language: 'en',
}, null, 2));
const played = replay(load('valorant-match-abyss-13-11.json').frames, 'standard');
const { rounds } = verify.reconcile(played.rounds, load('riot-abyss-13-11.json'));
rounds.find((r) => r.n === 2).forensics = { cause: 'dry-peek', what: 'You swung wide with nothing thrown.', better: 'Wait for the flash.', frames: ['r2-before.jpg'] };
const built = valorantReview.build({ rounds, context: played.context, endedBy: 'score', ai: {}, role: 'Duelist', history: [],
  riotMe: { kills: 31, deaths: 21, assists: 4, score: 9168 } });
const store = new ReviewStore(path.join(ud, 'reviews'));
const now = Date.now();
const ids = [0, 1, 2].map((i) => {
  const id = newId('valorant', now - i * 3600000);
  const review = { ...built, id, at: now - i * 3600000, kind: 'valorant' };
  // A real JPEG header is not needed: the check only asserts the data URL arrives.
  store.save({ id, game: 'valorant', at: review.at, review, frames: i === 0 ? { 'r2-before.jpg': Buffer.from('frame').toString('base64') } : null });
  return id;
});
process.env.OCCLARA_DEV_USERDATA = ud;

app.disableHardwareAcceleration();
app.on('window-all-closed', () => { /* the run below decides when we exit */ });

setTimeout(async () => {
  const matchesWindow = require(path.join(REPO, 'src/main/windows/matches-window'));
  try {
    matchesWindow.open();
    await new Promise((r) => setTimeout(r, 3200));
    const win = BrowserWindow.getAllWindows().find((w) => (w.webContents.getURL() || '').includes('/matches/'));
    if (!win) return report(false, 'the matches window never opened');
    const errs = [];
    win.webContents.on('console-message', (e, lvl, msg) => { if (lvl >= 2) errs.push(msg); });
    const js = (s) => win.webContents.executeJavaScript(s);

    const rows = await js("document.querySelectorAll('#list .m-row').length");
    const grade = await js("(document.querySelector('#list .m-row .m-score') || {}).textContent || ''");
    const pats = await js("document.querySelectorAll('#p-lists .gv-item').length");
    const avg = await js("document.getElementById('p-avg-num').textContent");
    lines.push(`rows=${rows} first grade=${grade} pattern items=${pats} average=${avg}`);
    if (rows !== 3) return report(false, `listed ${rows} matches, expected 3`);
    if (String(grade) !== String(built.grade.score)) return report(false, `the row shows grade ${grade}, the review says ${built.grade.score}`);
    if (!pats) return report(false, 'three matches painted no patterns');

    // Click the newest row: it must open the review window on that match.
    await js("document.querySelector('#list .m-row').click(); true");
    await new Promise((r) => setTimeout(r, 3500));
    const rwin = BrowserWindow.getAllWindows().find((w) => (w.webContents.getURL() || '').includes('/review/'));
    if (!rwin) return report(false, 'clicking a row did not open the review window');
    const rjs = (s) => rwin.webContents.executeJavaScript(s);
    const shown = await rjs("!document.getElementById('vreview').hidden");
    const letter = await rjs("(document.querySelector('.gv-letter') || {}).textContent || ''");
    const img = await rjs("(document.querySelector('.v-shot img') || {}).src || ''");
    const ask = await rjs("!document.getElementById('ask').hidden");
    lines.push(`review shown=${shown} letter=${letter} frame=${img.slice(0, 30)} ask=${ask}`);
    if (!shown) return report(false, 'the review window opened empty');
    if (letter !== built.grade.letter) return report(false, `the review painted grade ${letter}, expected ${built.grade.letter}`);
    if (!img.startsWith('data:image/jpeg;base64,')) return report(false, 'the kept frame did not reach the review');
    if (!ask) return report(false, 'a saved review offers no Ask about this match');
    if (errs.length) return report(false, 'renderer errors: ' + errs.join(' | '));
    report(true, 'ok');
  } catch (e) {
    report(false, 'threw: ' + e.message);
  }
}, 6500);

require(path.join(REPO, 'src/main/index.js'));
