'use strict';

/**
 * The one window (8.1), booted for real: the shell's sidebar lists the pages,
 * Home paints the last match from the library, a click in the sidebar shows
 * that page's view beside it at the sidebar's edge, the seal hides every page
 * and paints the Recording screen while a match is in progress, a page asked
 * for while sealed shows when the seal lifts, and a recent match on Home opens
 * its review in the same window. Then the window itself: the seal a stop mid
 * match holds keeps the sidebar open and lifts on a page opened, the X and
 * Alt+F4 hide the window and leave the corner mark rather than quit, and a
 * window made again mid match keeps the seal while the pages of the one that
 * went are closed with it.
 *
 * Everything else about the pages is the surfaces' own checks (check:matches,
 * check:rivalsreview, check:lolreview, check:gameswitch, check:onboardingriot);
 * this is the window around them.
 *
 * Results travel through a FILE, not stdout: an Electron main process on Windows
 * does not reliably flush a piped stdout.
 *
 * Run: npm run check:mainwindow
 */

const path = require('path');
const fs = require('fs');
const os = require('os');

const REPO = path.join(__dirname, '..');
const OUT = path.join(os.tmpdir(), 'occlara-main-window-check.json');

if (!process.versions.electron) {
  const { spawnSync } = require('child_process');
  const electron = require('electron');
  try { fs.unlinkSync(OUT); } catch { /* nothing to clear */ }
  const env = Object.assign({}, process.env, { OCCLARA_MAIN_OUT: OUT });
  delete env.ELECTRON_RUN_AS_NODE;
  const r = spawnSync(electron, [__filename], { env, timeout: 120000 });
  let rec = null;
  try { rec = JSON.parse(fs.readFileSync(OUT, 'utf8')); } catch { /* reported below */ }
  if (!rec) { console.error('FAIL: the check wrote no result (exit ' + r.status + ')'); process.exit(1); }
  for (const l of rec.lines) console.log('  ' + l);
  if (!rec.ok) { console.error('FAIL: ' + rec.detail); process.exit(1); }
  console.log('PASS: one window: the sidebar lists the pages, Home paints the last match, pages show beside the sidebar, the seal hides them all mid match and holds after a stop until a page is opened, a recent match opens its review, closing hides the window, and a window made again keeps the seal');
  process.exit(0);
}

const { app, BrowserWindow } = require('electron');
const { replay, load } = require('./fixtures/replay-match');
const surfaces = require('./fixtures/surfaces');
const verify = require(path.join(REPO, 'src/shared/valorant-verify'));
const valorantReview = require(path.join(REPO, 'src/shared/valorant-review'));
const { ReviewStore, newId } = require(path.join(REPO, 'src/main/services/review-store'));

const lines = [];
let reported = false;
function report(ok, detail) {
  if (reported) return;
  reported = true;
  try { fs.writeFileSync(process.env.OCCLARA_MAIN_OUT || OUT, JSON.stringify({ ok, detail, lines })); }
  catch { /* exit code still carries it */ }
  app.exit(ok ? 0 : 1);
}

// A profile with two saved Valorant reviews built from the real match.
const ud = path.join(os.tmpdir(), 'occlara-check-main-window');
fs.rmSync(ud, { recursive: true, force: true });
fs.mkdirSync(ud, { recursive: true });
fs.writeFileSync(path.join(ud, 'occlara-config.json'), JSON.stringify({
  game: 'valorant', onboardingCompleted: true, licenseKey: '', language: 'en',
}, null, 2));
const played = replay(load('valorant-match-abyss-13-11.json').frames, 'standard');
const { rounds } = verify.reconcile(played.rounds, load('riot-abyss-13-11.json'));
const built = valorantReview.build({ rounds, context: { ...played.context, agent: 'Jett' }, endedBy: 'score',
  ai: { focus: 'Enter second for a match: let a teammate or your utility take first contact, then trade.' },
  role: 'Duelist', history: [], riotMe: { kills: 31, deaths: 21, assists: 4, score: 9168 } });
const store = new ReviewStore(path.join(ud, 'reviews'));
const now = Date.now();
[0, 1].forEach((i) => {
  const at = now - i * 3600000;
  const id = newId('valorant', at);
  store.save({ id, game: 'valorant', at, review: { ...built, id, at, kind: 'valorant' } });
});
process.env.OCCLARA_DEV_USERDATA = ud;

app.disableHardwareAcceleration();
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');
app.on('window-all-closed', () => { /* the run below decides when we exit */ });

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms) {
  const end = Date.now() + ms;
  for (;;) {
    let v = null;
    try { v = await fn(); } catch { v = null; }
    if (v) return v;
    if (Date.now() > end) return null;
    await wait(150);
  }
}

/**
 * OCCLARA_SHOTS=1: the window as a player sees it, to dist-surface-shots/
 * main-<name>.png. The shell and the page are two webContents, so each is
 * captured and the page is drawn over the shell at the sidebar's edge.
 */
async function capture(wc) {
  for (let i = 0; i < 5; i++) {
    try { return await wc.capturePage(); } catch { await wait(500); }
  }
  return null;
}

async function shot(name, mainWindow, win) {
  if (process.env.OCCLARA_SHOTS !== '1') return;
  await wait(500);   // the last change painted before it is captured
  const shellImg = await capture(win.webContents);
  const s = mainWindow.current().shown;
  const v = s && mainWindow.pageViews().get(s);
  const pageImg = v ? await capture(v.webContents) : null;
  if (!shellImg || (v && !pageImg)) { lines.push(`shot main-${name}.png could not be captured`); return; }
  const scale = shellImg.getSize().width / win.getContentSize()[0];
  const comp = new BrowserWindow({ show: false, width: 200, height: 200 });
  await comp.loadURL('data:text/html,<canvas id="c"></canvas>');
  const data = await comp.webContents.executeJavaScript(`(async () => {
    const load = (src) => new Promise((r) => { const i = new Image(); i.onload = () => r(i); i.src = src; });
    const a = await load(${JSON.stringify(shellImg.toDataURL())});
    const c = document.getElementById('c'); c.width = a.width; c.height = a.height;
    const g = c.getContext('2d'); g.drawImage(a, 0, 0);
    ${pageImg ? `const b = await load(${JSON.stringify(pageImg.toDataURL())});
    g.drawImage(b, ${Math.round(mainWindow.SIDEBAR_W * scale)}, ${Math.round(mainWindow.TOP_H * scale)});` : ''}
    return c.toDataURL('image/png');
  })()`);
  comp.destroy();
  const dir = path.join(REPO, 'dist-surface-shots');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `main-${name}.png`), Buffer.from(String(data).split(',')[1], 'base64'));
  lines.push(`shot main-${name}.png`);
}

setTimeout(async () => {
  const mainWindow = require(path.join(REPO, 'src/main/windows/main-window'));
  try {
    const win = mainWindow.create();
    win.show();
    await until(() => surfaces.find('/shell/'), 6000);
    const shell = surfaces.find('/shell/');
    if (!shell) return report(false, 'the shell never loaded');
    const sjs = (s) => shell.webContents.executeJavaScript(s);
    const errs = [];
    const watch = (wc, label) => wc.on('console-message', (e, lvl, msg) => {
      const level = typeof lvl === 'number' ? lvl : ({ warning: 2, error: 3 })[e && e.level];
      if (level >= 2) errs.push(`${label}: ${msg !== undefined ? msg : e && e.message}`);
    });
    watch(shell.webContents, 'shell');
    await until(() => sjs("document.querySelectorAll('#nav .nav-item').length > 0"), 4000);

    // 1. The sidebar.
    const nav = await sjs("[...document.querySelectorAll('#nav .nav-item')].map((b) => b.textContent.trim()).join(',')");
    const start = await sjs("document.querySelector('#toggle .t-label').textContent");
    lines.push(`sidebar: ${nav} | Start reads "${start}"`);
    if (nav !== 'Home,Matches,Patterns,Breakdown,Stats,Ask Coach') return report(false, `the sidebar lists ${nav}`);
    if (start !== 'Start') return report(false, `the record button reads ${start}`);

    // 2. Home, the page the window opens on.
    const home = await until(() => surfaces.find('/home/'), 6000);
    if (!home) return report(false, 'Home never loaded');
    watch(home.webContents, 'home');
    const hjs = (s) => home.webContents.executeJavaScript(s);
    await until(() => hjs("!document.getElementById('content').hidden"), 6000);
    const last = await hjs("(document.querySelector('#last .score') || {}).textContent || ''");
    const gradeNum = await hjs("(document.querySelector('#last .gv-score') || {}).textContent || ''");
    const recent = await hjs("document.querySelectorAll('#recent-list .r-row').length");
    const focus = await hjs("document.getElementById('focus-text').textContent");
    lines.push(`home: score="${last}" grade=${gradeNum} recent=${recent} focus="${focus.slice(0, 40)}"`);
    if (last !== '13 : 11') return report(false, `Home's last match reads "${last}"`);
    if (String(gradeNum) !== String(built.grade.score)) return report(false, `Home's grade reads ${gradeNum}, the review ${built.grade.score}`);
    if (recent !== 2) return report(false, `Home lists ${recent} recent matches`);
    if (!/^Enter second/.test(focus)) return report(false, 'Home has no focus for the next match');
    await shot('home', mainWindow, win);

    // 3. A page from the sidebar shows beside it, at the sidebar's edge.
    await sjs("document.querySelector('#nav .nav-item[data-page=\"matches\"]').click(); true");
    await until(() => mainWindow.current().shown === 'matches', 4000);
    const views = mainWindow.pageViews();
    const mv = views.get('matches');
    const hv = views.get('home');
    const [w, h] = win.getContentSize();
    const b = mv && mv.getBounds();
    lines.push(`matches: shown=${mainWindow.current().shown} visible=${mv && mv.getVisible()} home visible=${hv && hv.getVisible()} bounds=${JSON.stringify(b)} window=${w}x${h}`);
    if (!mv || !mv.getVisible() || (hv && hv.getVisible())) return report(false, 'the Matches page is not the one showing');
    if (!b || b.x !== mainWindow.SIDEBAR_W || b.y !== mainWindow.TOP_H || b.width !== w - mainWindow.SIDEBAR_W
      || b.height !== h - mainWindow.TOP_H) return report(false, `the page sits at ${JSON.stringify(b)}`);
    const current = await until(() => sjs("(document.querySelector('.nav-item[aria-current=\"page\"]') || {}).dataset.page"), 3000);
    if (current !== 'matches') return report(false, `the sidebar marks ${current} as the page`);
    await shot('matches', mainWindow, win);

    // 4. The seal.
    mainWindow.setSealed(true);
    await wait(400);
    const anyShown = [...mainWindow.pageViews().values()].some((v) => v.getVisible());
    const sealedScreen = await sjs("!document.getElementById('sealed').hidden");
    const navLocked = await sjs("[...document.querySelectorAll('#nav .nav-item')].every((b) => b.disabled)");
    lines.push(`sealed: any page shown=${anyShown} recording screen=${sealedScreen} nav locked=${navLocked}`);
    if (anyShown) return report(false, 'a page still shows while sealed');
    if (!sealedScreen || !navLocked) return report(false, 'sealed, the shell does not paint the Recording screen and lock the pages');
    await shot('sealed', mainWindow, win);
    mainWindow.show('review');
    await wait(400);
    if (mainWindow.current().shown !== null) return report(false, 'a review opened over a sealed window');
    mainWindow.setSealed(false);
    await until(() => mainWindow.current().shown === 'review', 3000);
    const rv = mainWindow.pageViews().get('review');
    lines.push(`unsealed: shown=${mainWindow.current().shown} review visible=${rv && rv.getVisible()}`);
    if (!rv || !rv.getVisible()) return report(false, 'unsealed, the review asked for meanwhile does not show');
    const after = await sjs("document.getElementById('sealed').hidden");
    if (!after) return report(false, 'unsealed, the Recording screen stays up');

    // 5. A recent match on Home opens its review in the same window.
    mainWindow.show('home');
    await wait(300);
    await hjs("document.querySelector('#recent-list .r-row').click(); true");
    await until(() => mainWindow.current().shown === 'review', 4000);
    const review = surfaces.find('/review/');
    const painted = review && await until(() => review.webContents.executeJavaScript("!document.getElementById('vreview').hidden"), 5000);
    lines.push(`home row: shown=${mainWindow.current().shown} review painted=${!!painted}`);
    if (mainWindow.current().shown !== 'review' || !painted) return report(false, 'a recent match on Home did not open its review');

    await wait(1500);
    await shot('review', mainWindow, win);
    if (process.env.OCCLARA_SHOTS === '1') {
      for (const page of ['patterns', 'breakdown', 'stats', 'coach', 'settings']) {
        mainWindow.show(page);
        await wait(3000);
        await shot(page, mainWindow, win);
      }
    }

    // 6. Held: a stop in the middle of a match leaves the seal on with the
    // sidebar open, and a page the player opens lifts it.
    mainWindow.setSealed(true, { held: true });
    await wait(400);
    const heldTitle = await sjs("document.getElementById('sealed-title').textContent");
    const heldOpen = await sjs("[...document.querySelectorAll('#nav .nav-item')].every((b) => !b.disabled)");
    const heldFacts = await sjs("document.getElementById('sealed-facts').hidden");
    const heldShown = [...mainWindow.pageViews().values()].some((v) => v.getVisible());
    lines.push(`held: title="${heldTitle}" sidebar open=${heldOpen} facts hidden=${heldFacts} any page shown=${heldShown}`);
    if (heldShown) return report(false, 'a page shows while the seal is held');
    if (heldTitle !== 'Recording stopped' || !heldOpen || !heldFacts) return report(false, 'held, the shell does not say recording stopped with the sidebar open');
    await shot('held', mainWindow, win);
    await sjs("document.querySelector('#nav .nav-item[data-page=\"patterns\"]').click(); true");
    const lifted = await until(() => mainWindow.current().shown === 'patterns', 4000);
    lines.push(`held, a page opened: shown=${mainWindow.current().shown} sealed=${mainWindow.current().sealed}`);
    if (!lifted) return report(false, 'a page opened from the sidebar did not lift the held seal');

    // 7. Its X, and Alt+F4, hide the window and leave the corner mark: Occlara
    // keeps running. Ctrl+Shift+M brings it back and the mark goes.
    const registry = require(path.join(REPO, 'src/main/windows/registry'));
    const markShown = () => { const d = registry.get('dock'); return !!(d && d.isVisible()); };
    await sjs("document.getElementById('w-close').click(); true");
    await until(() => !win.isVisible(), 3000);
    lines.push(`X: window alive=${!win.isDestroyed()} visible=${win.isVisible()} corner mark=${markShown()}`);
    if (win.isDestroyed() || win.isVisible()) return report(false, 'the X did not hide the window, or closed it');
    if (!await until(markShown, 3000)) return report(false, 'hidden, the corner mark did not show');
    mainWindow.toggleHidden();
    await until(() => win.isVisible(), 3000);
    if (!win.isVisible() || markShown()) return report(false, 'Ctrl+Shift+M did not bring the window back and drop the mark');
    win.close();
    await until(() => !win.isVisible(), 3000);
    lines.push(`Alt+F4: window alive=${!win.isDestroyed()} visible=${win.isVisible()}`);
    if (win.isDestroyed() || win.isVisible()) return report(false, 'closing the window quit it instead of hiding it');
    mainWindow.toggleHidden();
    await until(() => win.isVisible(), 3000);

    // 8. A window made again mid match keeps the seal, and the pages of the
    // one that went go with it.
    // Held by their webContents: a closed view's own webContents reads undefined.
    const oldPages = [...mainWindow.pageViews().values()].map((v) => v.webContents);
    mainWindow.setSealed(true);
    win.destroy();
    const gone = await until(() => oldPages.every((wc) => wc.isDestroyed()), 3000);
    // Read at once: the new shell's first SHELL_GET settles the seal from the
    // real match state, which in this check is no match at all.
    mainWindow.show('review');
    const madeAgain = mainWindow.current();
    const anyNewShown = [...mainWindow.pageViews().values()].some((v) => v.getVisible());
    lines.push(`made again: old pages closed=${!!gone} sealed=${madeAgain.sealed} shown=${madeAgain.shown} any page shown=${anyNewShown}`);
    if (!gone) return report(false, 'the pages of a closed window stayed alive');
    if (!madeAgain.sealed || madeAgain.shown !== null || anyNewShown) return report(false, 'a window made again mid match showed a page');
    mainWindow.setSealed(false);
    if (!await until(() => mainWindow.current().shown === 'review', 3000)) return report(false, 'unsealed, the window made again shows no page');

    if (errs.length) return report(false, 'renderer errors: ' + errs.join(' | '));
    report(true, 'ok');
  } catch (e) {
    report(false, 'threw: ' + e.message);
  }
}, 6500);

require(path.join(REPO, 'src/main/index.js'));
