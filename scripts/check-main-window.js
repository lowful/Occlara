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
 * Moving between pages (8.2), on the real views: the sidebar's one marker on
 * the current page; each switch arming the new page while the page on screen
 * is still up and over it, the old one hidden only after the new one's
 * PAGE_READY, forward down the sidebar and back up it; a page that never
 * answers let in at READY_MS; sealing mid switch hiding every page in the same
 * call, with nothing coming back on the switch's timer; the page asked for
 * while sealed staged off the page area's edge until it is ready, then placed;
 * a page staged with the window minimised let in by its own ready once
 * restored, never by its timer before it could paint; and a page loading
 * again refusing its old document's ready and let in on its new one's.
 * OCCLARA_SHOTS=1 pictures each page after its switch, to see that none is
 * left invisible or offset.
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
  console.log('PASS: one window: the sidebar lists the pages, Home paints the last match, pages show beside the sidebar and move in only once painted out of sight, forward and back, minimised or loaded again, the seal hides them all at once mid match and holds after a stop until a page is opened, a recent match opens its review, closing hides the window, and a window made again keeps the seal');
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
    // The window's first page came in (8.2): staged, armed as it loaded, then
    // placed and let in, its cards arriving one after another as it did.
    const settled = (page) => () => { const m = mainWindow.motionState(); return m.onScreen === page && !m.coming && !m.staged; };
    const homeIn = await until(settled('home'), 4000);
    const homeState = await until(() => hjs(`(() => {
      const r = document.documentElement;
      return r.classList.contains('page-armed') ? null
        : { leaving: r.classList.contains('page-leaving'), cards: document.querySelectorAll('.home .card.card-in').length };
    })()`), 4000);
    lines.push(`home came in: placed=${!!homeIn} ${JSON.stringify(homeState)}`);
    if (!homeIn || !homeState || homeState.leaving) return report(false, 'Home, the first page, never came in');
    if (homeState.cards < 3) return report(false, `only ${homeState.cards} of Home's cards arrived one after another`);
    await shot('home', mainWindow, win);

    // 3. A page from the sidebar shows beside it, at the sidebar's edge.
    await sjs("document.querySelector('#nav .nav-item[data-page=\"matches\"]').click(); true");
    await until(() => mainWindow.current().shown === 'matches', 4000);
    // The page is let in once it has painted itself armed, so it is the one
    // showing a moment after the sidebar says so, not at once.
    await until(settled('matches'), 4000);
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
    // ONE MARKER, moved to the current page (8.2), not a background per item.
    const markerAt = () => sjs(`(() => {
      const m = document.getElementById('nav-marker');
      const b = document.querySelector('.nav-item[aria-current="page"]');
      const t = new DOMMatrix(getComputedStyle(m).transform);
      return { on: m.classList.contains('on'), y: Math.round(t.m42), top: b ? b.offsetTop : -1, page: b ? b.dataset.page : null,
        markers: document.querySelectorAll('.nav-marker').length,
        itemBg: b ? getComputedStyle(b).backgroundColor : '', hover: !!(b && b.matches(':hover')) };
    })()`);
    await wait(400);
    const mk = await markerAt();
    lines.push(`marker: ${JSON.stringify(mk)}`);
    if (mk.markers !== 1 || !mk.on || mk.page !== 'matches' || mk.y !== mk.top) return report(false, `the sidebar's one marker is not on Matches: ${JSON.stringify(mk)}`);
    // Under the pointer an item has its hover ground; anywhere else none.
    if (!mk.hover && mk.itemBg !== 'rgba(0, 0, 0, 0)') return report(false, `the current item paints a background of its own, ${mk.itemBg}, beside the marker`);
    await shot('matches', mainWindow, win);

    // 3b. MOVING BETWEEN PAGES (8.2), carried out on real views. Every PUSH_PAGE
    // a page is sent, every page shown and hidden and every PAGE_READY as it
    // arrives go in one log in the order they happened. A switch must arm the
    // new page while the page on screen is still up and over it, and take the
    // old one away only once the new one is ready.
    const { ipcMain } = require('electron');
    const CH = require(path.join(REPO, 'src/shared/channels'));
    const { READY_MS } = require(path.join(REPO, 'src/shared/shell-nav'));
    const motionLog = [];
    const watched = new WeakSet();
    const watchViews = () => {
      for (const [id, v] of mainWindow.pageViews()) {
        if (watched.has(v)) continue;
        watched.add(v);
        const setVisible = v.setVisible.bind(v);
        v.setVisible = (on) => { motionLog.push({ ev: on ? 'show' : 'hide', id, at: Date.now() }); return setVisible(on); };
        const send = v.webContents.send.bind(v.webContents);
        v.webContents.send = (ch, msg, ...rest) => {
          if (ch === CH.PUSH_PAGE) motionLog.push({ ev: msg.phase, id, dir: msg.dir, at: Date.now() });
          return send(ch, msg, ...rest);
        };
      }
    };
    // Ahead of main's own listener, so what this sees is the moment before
    // main acts on it: which page is on its way, whether the page it replaces
    // is still showing, and whether it is over the new one.
    // Never throws: a listener that threw would keep main's from running.
    const onReady = (_e, id) => {
      const snap = { id };
      try {
        const m = mainWindow.motionState();
        const c = m.coming;
        const vs = mainWindow.pageViews();
        const kids = win.contentView.children;
        Object.assign(snap, { to: c && c.to, staged: m.staged });
        if (c && c.from) {
          snap.fromShown = vs.get(c.from).getVisible();
          snap.under = kids.indexOf(vs.get(c.to)) < kids.indexOf(vs.get(c.from));
        }
        if (c && c.to && vs.get(c.to)) snap.x = vs.get(c.to).getBounds().x;
      } catch (e) {
        snap.error = e.message;
      }
      motionLog.push({ ev: 'ready', id, at: Date.now(), snap });
    };
    ipcMain.prependListener(CH.PAGE_READY, onReady);
    const pjsOf = (id) => (s) => mainWindow.pageViews().get(id).webContents.executeJavaScript(s);
    const classes = (id) => pjsOf(id)("({ armed: document.documentElement.classList.contains('page-armed'), leaving: document.documentElement.classList.contains('page-leaving'), dir: document.documentElement.dataset.pageDir || 'none' })");
    const at = (log, ev, id) => log.findIndex((x) => x.ev === ev && x.id === id);
    /** One switch from the sidebar: its log, retried when the timer won the race, which says nothing. */
    const switchTo = async (to, from) => {
      for (let attempt = 1; attempt <= 3; attempt++) {
        if (mainWindow.motionState().onScreen !== from) {
          mainWindow.show(from);
          await until(settled(from), 3000);
          await wait(300);
        }
        watchViews();
        motionLog.length = 0;
        await sjs(`document.querySelector('.nav-item[data-page="${to}"]').click(); true`);
        const done = await until(settled(to), 3000);
        await wait(400);   // the page's entrance through
        const log = motionLog.slice();
        const iArm = at(log, 'arm', to);
        const iReady = at(log, 'ready', to);
        const iHide = at(log, 'hide', from);
        const iEnter = at(log, 'enter', to);
        const r = { done: !!done, attempt, order: log.map((x) => `${x.ev} ${x.id}${x.dir ? ' ' + x.dir : ''}`).join(' > '),
          arm: log[iArm], ready: log[iReady], iArm, iReady, iHide, iEnter, page: await classes(to) };
        if (iReady !== -1 && iReady < iHide) return r;
        lines.push(`  ${from} to ${to}, try ${attempt}: the timer let it in first (${r.order}), again`);
      }
      return null;
    };
    const checkSwitch = (r, from, to, dir) => {
      if (!r) return `${from} to ${to}: in three tries the page never answered before the timer`;
      lines.push(`${from} to ${to}: ${r.order} | page ${JSON.stringify(r.page)}`);
      if (!r.done) return `${from} to ${to}: the switch never settled`;
      if (r.iArm === -1 || r.arm.dir !== dir) return `${from} to ${to}: the page was armed ${r.arm ? r.arm.dir : 'never'}, not ${dir}`;
      if (!(r.iArm < r.iReady && r.iReady < r.iHide && r.iHide < r.iEnter)) return `${from} to ${to}: out of order, ${r.order}`;
      const s = r.ready.snap;
      if (!s.fromShown || !s.under || s.to !== to) return `${from} to ${to}: at its ready the page was not under the one on screen: ${JSON.stringify(s)}`;
      if (r.page.armed || r.page.leaving || r.page.dir !== dir) return `${from} to ${to}: the page came in as ${JSON.stringify(r.page)}`;
      return null;
    };
    let bad = checkSwitch(await switchTo('home', 'matches'), 'matches', 'home', 'back');
    if (bad) return report(false, bad);
    bad = checkSwitch(await switchTo('matches', 'home'), 'home', 'matches', 'forward');
    if (bad) return report(false, bad);
    const mk2 = await markerAt();
    if (!mk2.on || mk2.page !== 'matches' || mk2.y !== mk2.top) return report(false, `after the switches the marker is off its page: ${JSON.stringify(mk2)}`);

    // A page that never answers is let in all the same, at READY_MS.
    const mainReady = ipcMain.listeners(CH.PAGE_READY).filter((l) => l !== onReady);
    for (const l of mainReady) ipcMain.removeListener(CH.PAGE_READY, l);
    motionLog.length = 0;
    const t0 = Date.now();
    await sjs("document.querySelector('.nav-item[data-page=\"home\"]').click(); true");
    const silentIn = await until(settled('home'), 3000);
    const tookMs = Date.now() - t0;
    for (const l of mainReady) ipcMain.on(CH.PAGE_READY, l);
    await wait(400);
    const silent = motionLog.map((x) => `${x.ev} ${x.id}`).join(' > ');
    const silentPage = await classes('home');
    lines.push(`a page that never answers: in after ${tookMs}ms (${silent}) page ${JSON.stringify(silentPage)}`);
    if (!silentIn || at(motionLog, 'hide', 'matches') === -1 || at(motionLog, 'enter', 'home') === -1) return report(false, 'a page whose ready never reached main was never let in');
    if (tookMs < READY_MS - 20 || tookMs > READY_MS + 1500) return report(false, `a page that never answered came in after ${tookMs}ms, not at ${READY_MS}`);
    if (silentPage.armed) return report(false, 'a page let in by the timer stayed armed, invisible');
    // Back to Matches for the seal below.
    mainWindow.show('matches');
    await until(settled('matches'), 3000);

    // Sealing mid switch hides every page in the same call, and the switch's
    // timer brings nothing back. Unsealed, the page asked for is staged off
    // the page area's edge until it has painted itself armed, then placed.
    let unsealed = null;
    for (let attempt = 1; attempt <= 3 && !unsealed; attempt++) {
      mainWindow.show(attempt % 2 ? 'home' : 'patterns');
      const want = mainWindow.current().page;
      mainWindow.setSealed(true);
      const sealedNow = [...mainWindow.pageViews().values()].filter((v) => v.getVisible()).length;
      const sealedState = mainWindow.motionState();
      await wait(READY_MS * 3);
      const sealedLater = [...mainWindow.pageViews().values()].filter((v) => v.getVisible()).length;
      lines.push(`sealed mid switch to ${want}: shown at once=${sealedNow} after its timer=${sealedLater} state=${JSON.stringify(sealedState)}`);
      if (sealedNow || sealedState.onScreen || sealedState.coming) return report(false, 'sealing mid switch left a page showing for even a moment');
      if (sealedLater) return report(false, 'a page came back after the seal, when its switch\'s timer ran');
      motionLog.length = 0;
      watchViews();
      mainWindow.setSealed(false);
      const stagedIn = await until(settled(want), 3000);
      const stagedReady = motionLog.find((x) => x.ev === 'ready' && x.id === want);
      const [cw] = win.getContentSize();
      const placedAt = mainWindow.pageViews().get(want).getBounds();
      lines.push(`unsealed: ${motionLog.map((x) => `${x.ev} ${x.id}`).join(' > ')} at its ready ${JSON.stringify(stagedReady && stagedReady.snap)} placed at x=${placedAt.x}`);
      if (!stagedIn) return report(false, 'unsealed, the page asked for never came in');
      if (placedAt.x !== mainWindow.SIDEBAR_W) return report(false, `unsealed, the page was left at x=${placedAt.x}`);
      // Its ready came in before the timer (it did not on a busy machine: again).
      if (stagedReady && motionLog.indexOf(stagedReady) < at(motionLog, 'enter', want)) unsealed = { snap: stagedReady.snap, cw };
    }
    if (!unsealed) return report(false, 'in three tries the page unsealed never answered before the timer');
    if (unsealed.snap.staged !== unsealed.snap.to || unsealed.snap.x !== unsealed.cw - mainWindow.STAGE_PX) {
      return report(false, `unsealed, the page was not staged off the edge until it was ready: ${JSON.stringify(unsealed.snap)}`);
    }

    // Minimised, nobody can see the window and its pages paint nothing, so a
    // page staged as the seal lifts is not let in by its timer: only its own
    // ready lets it in, and once restored it comes in.
    const evs = (log, t0) => log.map((x) => `${x.ev} ${x.id} +${x.at - t0}ms`).join(' > ');
    mainWindow.show('matches');
    await until(settled('matches'), 3000);
    win.minimize();
    if (!await until(() => win.isMinimized(), 3000)) return report(false, 'the window would not minimise');
    mainWindow.setSealed(true);
    watchViews();
    motionLog.length = 0;
    const tMin = Date.now();
    mainWindow.setSealed(false);
    await wait(READY_MS * 4);
    const whileMin = mainWindow.motionState();
    const minLog = evs(motionLog, tMin);
    win.restore();
    const restoredIn = await until(settled('matches'), 4000);
    await wait(300);
    const iMinReady = at(motionLog, 'ready', 'matches');
    const iMinEnter = at(motionLog, 'enter', 'matches');
    lines.push(`minimised, unsealed: after ${READY_MS * 4}ms on its way=${whileMin.coming && whileMin.coming.to} staged=${whileMin.staged} (${minLog}) | restored: ${evs(motionLog, tMin)}`);
    if (!restoredIn) return report(false, 'restored, the page staged while the window was minimised never came in');
    if (iMinEnter === -1 || iMinReady === -1 || iMinEnter < iMinReady) {
      return report(false, 'minimised, a staged page was let in by its timer before it had painted');
    }

    // A page loading again, as Ask about this match loads Ask Coach: a ready
    // from the document it replaces (sent here at once, before the new one
    // can have committed) changes nothing, and the new document's own ready
    // lets it in, not LOAD_MS. Retried when the new document was slower to
    // answer than the timer, which says nothing.
    let reloaded = null;
    for (let attempt = 1; attempt <= 3 && !reloaded; attempt++) {
      mainWindow.show('coach');
      await until(settled('coach'), 3000);
      mainWindow.show('matches');
      await until(settled('matches'), 3000);
      await wait(300);
      watchViews();
      motionLog.length = 0;
      const coachWc = mainWindow.pageViews().get('coach').webContents;
      const tReload = Date.now();
      mainWindow.show('coach', { reload: true });
      const staleTaken = mainWindow.pageReady('coach', coachWc);
      const atStale = mainWindow.motionState();
      const inAgain = await until(settled('coach'), 3000);
      await wait(300);
      const log = motionLog.slice();
      lines.push(`loaded again, try ${attempt}: the old document's ready taken=${staleTaken} on its way=${atStale.coming && atStale.coming.to} on screen=${atStale.onScreen} loading=${atStale.reloading.join(',')} | ${evs(log, tReload)}`);
      if (staleTaken || !atStale.coming || atStale.coming.to !== 'coach' || atStale.onScreen !== 'matches' || !atStale.reloading.includes('coach')) {
        return report(false, 'a ready from the document a reload replaces let the page in');
      }
      if (!inAgain) return report(false, 'loaded again, Ask Coach never came in');
      const iReady = at(log, 'ready', 'coach');
      const iEnter = at(log, 'enter', 'coach');
      if (iReady === -1 || iEnter < iReady) continue;
      reloaded = { gap: log[iEnter].at - log[iReady].at };
    }
    if (!reloaded) return report(false, 'in three tries the page loaded again never answered before LOAD_MS');
    if (reloaded.gap > 100) {
      return report(false, `loaded again, Ask Coach came in ${reloaded.gap}ms after its new document's ready: the commit never ended the wait, LOAD_MS did`);
    }
    ipcMain.removeListener(CH.PAGE_READY, onReady);
    mainWindow.show('matches');
    await until(settled('matches'), 3000);

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
    // Waited for, like every other page here: the review's view was only made
    // when the seal lifted a moment ago, and a view has no URL to find it by
    // until its page commits, which failed this step on two runs in three.
    const review = await until(() => surfaces.find('/review/'), 5000);
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
    // The mark sits over Valorant's kill feed while the game is played, so it
    // is kept out of every capture, Occlara's own included (dock-window.js).
    // Electron reports content protection on Windows and macOS only.
    if (process.platform === 'win32' || process.platform === 'darwin') {
      const protectedMark = registry.get('dock').isContentProtected();
      lines.push(`corner mark kept out of capture=${protectedMark}`);
      if (!protectedMark) return report(false, 'the corner mark is not protected from capture, so it is in every frame read');
    }
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
