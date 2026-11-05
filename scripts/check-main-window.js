'use strict';

/**
 * The one window (8.1), booted for real: the shell's sidebar lists the pages,
 * Home paints the last match from the library, a click in the sidebar shows
 * that page's view beside it at the sidebar's edge, the seal hides every page
 * and paints the Recording screen while a match is in progress, a page asked
 * for while sealed shows when the seal lifts, and a recent match on Home opens
 * its review in the same window. A review still being built (8.4.1) opens on
 * its loading screen, Home's last match and its row in Matches say it is being
 * checked where its grade would be, and once its work is done the review is
 * painted whole and the grade is back. Then the window itself: the seal a
 * stop mid match holds keeps the sidebar open and lifts on a page opened, the
 * X and Alt+F4 quit by the tray's own path, asking nothing with nothing at
 * stake (8.4.1, check:seal asks the questions) and never inside the close
 * event itself, a quit Electron would cancel, Ctrl+Shift+M hides the window
 * to the corner mark and brings it back, and a window made again mid match
 * keeps the seal while the pages of the one that went are closed with it.
 * And the record card is its two buttons (8.3), and stays them recording,
 * between matches and in one, with no agent check over them (8.4.4), with
 * the notice line in the top strip instead: empty with nothing to say, one
 * line in the strip when there is a notice, cut and whole in its title when
 * it is long, out of the drag region the strip around it still is.
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
 * check:lolreview, check:gameswitch, check:onboardingriot);
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
  console.log('PASS: one window: the sidebar lists the pages and its record card is its two buttons, recording between matches and mid match too with no agent check over them, a notice is one line in the top strip and empty, never hidden, with none, Home paints the last match, pages show beside the sidebar and move in only once painted out of sight, forward and back, minimised or loaded again, the seal hides them all at once mid match and holds after a stop until a page is opened, a recent match opens its review, a review still being built is a loading screen and its grade on Home and in Matches says it is being checked until it is whole, closing quits with nothing asked when nothing is at stake, on the turn after its close event and never inside it, Ctrl+Shift+M hides the window to the corner mark, and a window made again keeps the seal');
  process.exit(0);
}

const { app } = require('electron');
const surfaces = require('./fixtures/surfaces');
// THE SAMPLE LIBRARY (8.7, scripts/fixtures/proof-reviews.js): four saved
// Valorant reviews built from the real match, the older three looked at with
// a clip kept beside the second, a seeded Free account with its two games
// used, and the stand-in reader step 5b records with. Shared with the site
// proof exporter, so the website's pictures are of what this check holds.
const proof = require('./fixtures/proof-reviews');
const { composite } = require('./fixtures/window-shot');
const { SEEDED_VIEW, SEEDED_REFERRAL, usage, readers } = proof;

const lines = [];
let reported = false;
function report(ok, detail) {
  if (reported) return;
  reported = true;
  try { fs.writeFileSync(process.env.OCCLARA_MAIN_OUT || OUT, JSON.stringify({ ok, detail, lines })); }
  catch { /* exit code still carries it */ }
  app.exit(ok ? 0 : 1);
}

proof.installStandIns();
const ud = path.join(os.tmpdir(), 'occlara-check-main-window');
const seeded = proof.seed(ud);
const { played, built, store, SEEDED, ids: seededIds } = seeded;
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
 * main-<name>.png, through scripts/fixtures/window-shot.js (the shell and the
 * page composited), which the site proof exporter shoots with too.
 */
async function shot(name, mainWindow, win) {
  if (process.env.OCCLARA_SHOTS !== '1') return;
  await wait(500);   // the last change painted before it is captured
  const pic = await composite(mainWindow, win);
  if (!pic) { lines.push(`shot main-${name}.png could not be captured`); return; }
  const dir = path.join(REPO, 'dist-surface-shots');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `main-${name}.png`), pic.png);
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
    if (nav !== 'Home,Matches,Patterns,Moments,Stats,Ask Coach') return report(false, `the sidebar lists ${nav}`);
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
    if (recent !== SEEDED) return report(false, `Home lists ${recent} recent matches, ${SEEDED} were saved`);
    if (!/^Enter second/.test(focus)) return report(false, 'Home has no focus for the next match');
    // 8.2.1: the last match ends on the eye's View match and Open review and
    // nothing else (these matches were saved with no AI log kept, so the eye
    // is there, disabled); no Riot ID, so no rank card; and the record card
    // has no status word over its buttons.
    const foot = await hjs(`(() => {
      const f = document.querySelector('#last .last-foot');
      const eye = f && f.querySelector('.log-eye');
      return f ? { text: f.textContent, buttons: f.querySelectorAll('button').length, eye: !!eye, eyeOff: !!(eye && eye.disabled),
        rank: document.getElementById('rank').hidden } : null;
    })()`);
    const statusRow = await sjs("!!document.getElementById('status-text') || !!document.querySelector('#rec .rec-state')");
    lines.push(`home foot: ${JSON.stringify(foot)} | record card status row=${statusRow}`);
    if (!foot || foot.text !== 'View matchOpen review' || foot.buttons !== 2 || !foot.eye || !foot.eyeOff) {
      return report(false, `Home's last match ends on ${JSON.stringify(foot)}, not the eye's View match and Open review alone`);
    }
    if (!foot.rank) return report(false, 'Home shows a rank card with no Riot ID');
    if (statusRow) return report(false, 'the record card still has its status row');
    // THE GAMES LEFT (8.7): one quiet line in the rail under Start, main's
    // words alone, and no copy of it on Home.
    const gamesLine = await until(() => sjs("(() => { const g = document.getElementById('rail-games'); return g && !g.hidden ? g.textContent : null; })()"), 3000);
    const homeGames = await hjs("!!document.getElementById('h-games') || !!document.querySelector('.h-aside')");
    lines.push(`rail games line: "${gamesLine}" | a copy on Home: ${homeGames}`);
    if (gamesLine !== SEEDED_VIEW.gamesLeft || gamesLine !== 'You have used your 2 free games' || homeGames) {
      return report(false, `the rail's games line reads "${gamesLine}", not main's "${SEEDED_VIEW.gamesLeft}" (copy on Home: ${homeGames})`);
    }
    // THE INVITE AND PROFILE BUTTONS (8.7, 8.8), in the sidebar's foot: Invite,
    // then Profile directly above Settings, one column, no gap between them.
    const footer = await sjs(`(() => {
      const f = document.querySelector('.side .foot');
      const kids = [...f.children].filter((c) => !c.hidden).map((c) => c.dataset.page || c.id);
      const inv = document.getElementById('nav-invite').getBoundingClientRect();
      const pro = document.getElementById('nav-profile').getBoundingClientRect();
      const set = document.getElementById('nav-settings').getBoundingClientRect();
      return { kids: kids.join(), text: document.getElementById('nav-invite').textContent.trim(), profile: document.getElementById('nav-profile').textContent.trim(),
        gap: Math.round(pro.top - inv.bottom), gap2: Math.round(set.top - pro.bottom), sameX: inv.left === set.left && pro.left === set.left };
    })()`);
    lines.push(`sidebar foot: ${JSON.stringify(footer)}`);
    if (!footer.kids.startsWith('invite,profile,settings') || footer.text !== 'Invite' || footer.profile !== 'Profile'
      || footer.gap < 0 || footer.gap > 4 || footer.gap2 < 0 || footer.gap2 > 4 || !footer.sameX) {
      return report(false, `the Invite and Profile buttons are not directly above Settings in the sidebar's foot: ${JSON.stringify(footer)}`);
    }    // THE RECORD CARD IS ITS TWO BUTTONS (8.3), measured on the real layout:
    // no line of text under them, and the card's one padding the same above
    // them as below.
    const card = await sjs(`(() => {
      const rec = document.getElementById('rec');
      const r = rec.getBoundingClientRect();
      const b = rec.querySelector('.rec-controls').getBoundingClientRect();
      const texts = [...rec.querySelectorAll('p')].filter((p) => getComputedStyle(p).display !== 'none' && p.getBoundingClientRect().height > 0);
      return { line: !!document.getElementById('line'), texts: texts.length, buttons: rec.querySelectorAll('.rec-controls button').length,
        height: Math.round(r.height), controls: Math.round(b.height), above: Math.round(b.top - r.top), below: Math.round(r.bottom - b.bottom) };
    })()`);
    lines.push(`record card: ${JSON.stringify(card)}`);
    if (card.line || card.texts || card.buttons !== 2) return report(false, `the record card is not its two buttons alone: ${JSON.stringify(card)}`);
    if (card.controls !== 48 || card.above !== card.below) return report(false, `the record card is not balanced on its buttons: ${JSON.stringify(card)}`);
    // THE GRADE TREND KEEPS ITS HEIGHT (8.7), measured on the real layout:
    // with Recent matches beside it made tall, the bars stay 120px tall over
    // their baseline rather than growing into a second hero, no map is
    // printed under a bar, and the tallest bar is its grade of the whole
    // track.
    const fill = await hjs(`(async () => {
      const recentCard = document.getElementById('recent');
      recentCard.style.minHeight = '440px';
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      const trend = document.getElementById('trend');
      const bars = trend.querySelector('.bars').getBoundingClientRect();
      const track = trend.querySelector('.bar-track').getBoundingClientRect().height;
      const bar = Math.max(...[...trend.querySelectorAll('.bar')].map((b) => b.getBoundingClientRect().height));
      const maps = trend.querySelectorAll('.bar-map').length;
      recentCard.style.minHeight = '';
      return { bars: Math.round(bars.height), track: Math.round(track), bar: Math.round(bar), maps };
    })()`);
    lines.push(`home trend beside a tall Recent matches: ${JSON.stringify(fill)} for a grade of ${built.grade.score}`);
    if (fill.bars !== 120 || fill.maps || Math.abs(fill.bar - Math.round((built.grade.score / 100) * fill.track)) > 2) {
      return report(false, `the grade trend does not keep its 120px over a tall list: ${JSON.stringify(fill)}`);
    }
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

    // 3c. THE NOTICE LINE (8.3), on the real layout. Empty with nothing to
    // say, never hidden, its live region in place; a notice pushed as main pushes one is on one line inside the 40px
    // strip, left of the window's buttons, cut with an ellipsis when long and
    // whole in its title, the text out of the drag region and the strip
    // around it still in it; and empty again once it clears.
    const noticeAt = () => sjs(`(() => {
      const n = document.getElementById('notice');
      const top = document.querySelector('.top');
      const t = top.getBoundingClientRect();
      const r = n.getBoundingClientRect();
      const ctl = document.querySelector('.win-controls').getBoundingClientRect();
      const cs = getComputedStyle(n);
      const region = (el) => getComputedStyle(el).getPropertyValue('-webkit-app-region') || getComputedStyle(el).webkitAppRegion || '';
      return { hidden: n.hidden, shown: cs.display !== 'none' && r.width > 0, text: n.textContent, title: n.title,
        cut: n.scrollWidth > n.clientWidth, lines: Math.round(r.height / parseFloat(cs.lineHeight)),
        inStrip: r.top >= t.top && r.bottom <= t.bottom, leftOfButtons: r.right <= ctl.left,
        strip: Math.round(t.height), width: Math.round(r.width), stripWidth: Math.round(t.width),
        weight: cs.fontWeight, font: cs.fontFamily.split(',')[0], region: { strip: region(top), notice: region(n) } };
    })()`);
    const quiet = await noticeAt();
    lines.push(`notice line at rest: ${JSON.stringify(quiet)}`);
    if (quiet.hidden || quiet.shown || quiet.text) return report(false, `with nothing to say, the notice line shows, or is hidden where its live region should wait empty: ${JSON.stringify(quiet)}`);
    const stateNow = await sjs('window.occlara.getState()');
    const BUSY = 'Recording stopped for this session: your PC was busy. The coach still reads your screen up to once a second.';
    const BLOCKED = 'Windows blocked screen capture. Add Occlara to your antivirus exclusions (Windows Security, Virus and threat protection, Exclusions), then start again.';
    shell.webContents.send(CH.PUSH_STATE, { ...stateNow, notice: { text: BUSY, at: Date.now(), kind: 'recorder' } });
    const busy = await until(async () => { const n = await noticeAt(); return n.shown ? n : null; }, 3000);
    lines.push(`notice line, recording stopped for the session: ${JSON.stringify(busy)}`);
    if (!busy || busy.text !== BUSY || busy.title !== BUSY || busy.lines !== 1 || !busy.inStrip || !busy.leftOfButtons || busy.strip !== mainWindow.TOP_H) {
      return report(false, `a notice is not one line in the strip, left of the window's buttons: ${JSON.stringify(busy)}`);
    }
    if (busy.region.strip !== 'drag' || busy.region.notice !== 'no-drag') return report(false, `the strip is ${busy.region.strip} and its notice ${busy.region.notice}, not drag around a no-drag text`);
    if (!['400', '500', '600', '700', '800'].includes(String(busy.weight)) || !/Geist/.test(busy.font)) {
      return report(false, `the notice line is drawn in ${busy.font} ${busy.weight}, not a Geist weight that ships`);
    }
    if (busy.cut) return report(false, `at the default width the busy notice is cut (${busy.width} of ${busy.stripWidth}px), where shell.css says it is whole`);
    await shot('notice', mainWindow, win);
    shell.webContents.send(CH.PUSH_STATE, { ...stateNow, notice: { text: BLOCKED, at: Date.now(), kind: 'capture' } });
    const long = await until(async () => { const n = await noticeAt(); return n.text === BLOCKED ? n : null; }, 3000);
    lines.push(`notice line, capture blocked: ${JSON.stringify(long)}`);
    if (!long || !long.cut || long.lines !== 1 || long.title !== BLOCKED || !long.inStrip || long.width > Math.round(long.stripWidth * 0.7) + 1) {
      return report(false, `a long notice is not cut on one line, whole in its title, within 70% of the strip: ${JSON.stringify(long)}`);
    }
    await shot('notice-long', mainWindow, win);
    shell.webContents.send(CH.PUSH_STATE, { ...stateNow, notice: null });
    const cleared = await until(async () => { const n = await noticeAt(); return !n.text ? n : null; }, 3000);
    lines.push(`notice line cleared: ${JSON.stringify(cleared)}`);
    if (!cleared || cleared.hidden || cleared.shown || cleared.text || cleared.title) return report(false, `a notice cleared stays on the line: ${JSON.stringify(cleared)}`);

    // 4. The seal.
    mainWindow.setSealed(true);
    await wait(400);
    const anyShown = [...mainWindow.pageViews().values()].some((v) => v.getVisible());
    const sealedScreen = await sjs("!document.getElementById('sealed').hidden");
    const navLocked = await sjs("[...document.querySelectorAll('#nav .nav-item'), document.getElementById('nav-invite'), document.getElementById('nav-profile'), document.getElementById('nav-settings')].every((b) => b.disabled)");
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
    // Both team comps, one line under the strip (8.5.0), as main presents them.
    const comps = await review.webContents.executeJavaScript(
      "(() => { const c = document.getElementById('v-comps'); return c ? { hidden: c.hidden, text: c.textContent, under: c.parentNode.id } : null; })()");
    lines.push(`comps line: ${JSON.stringify(comps)}`);
    if (!comps || comps.hidden || comps.under !== 'v-rounds-wrap'
      || comps.text !== 'Your team: Breach, Jett (you), Killjoy, Omen, Sova. Theirs: Cypher, Killjoy, Phoenix, Skye, Viper.') {
      return report(false, `the review's comps line is not one line of both teams' agents under the strip: ${JSON.stringify(comps)}`);
    }

    await wait(1500);
    await shot('review', mainWindow, win);
    if (process.env.OCCLARA_SHOTS === '1') {
      // The strip and the comps line under it (8.5.0), scrolled into view.
      await review.webContents.executeJavaScript("document.getElementById('v-rounds-wrap').scrollIntoView({ block: 'start' }); true");
      await shot('review-comps', mainWindow, win);
      // The ranked lists (8.7), and the share sheet open over the page.
      await review.webContents.executeJavaScript("document.getElementById('insights-host').scrollIntoView({ block: 'start' }); true");
      await shot('review-lists', mainWindow, win);
      await review.webContents.executeJavaScript("document.getElementById('v-rounds-wrap').scrollIntoView({ block: 'end' }); true");
      await shot('review-bottom', mainWindow, win);
      await review.webContents.executeJavaScript("document.querySelector('.body').scrollTo(0, 0); document.getElementById('share').click(); true");
      await wait(600);
      await shot('review-share', mainWindow, win);
      await review.webContents.executeJavaScript("document.getElementById('share').click(); document.querySelector('.body').scrollTo(0, 0); true");
    }
    // A LOCKED REVIEW (8.7), on the real page: the review as main serves it
    // once the account had no games left (locked: true), painted by the
    // page's own paint(). Its result and Riot's scoreboard, then the upgrade
    // card; no Verdict, no share image, no progress strip, no grade, no read,
    // no rounds, no Ask about this match, and no reveal.
    const rjs = (s) => review.webContents.executeJavaScript(s);
    await rjs("window.__unlocked = current; paint(Object.assign({}, current, { id: current.id + '-locked', locked: true })); true");
    await wait(600);
    const lockedPage = await rjs(`(() => {
      const shown = (id) => { const n = document.getElementById(id); return !!n && !n.hidden; };
      const card = document.getElementById('locked');
      return { card: shown('locked'), under: card.previousElementSibling && card.previousElementSibling.id,
        title: document.getElementById('lk-title').textContent, body: document.getElementById('lk-body').textContent,
        upgrade: shown('lk-upgrade') ? document.getElementById('lk-upgrade').textContent : null, invite: shown('lk-invite'),
        stats: shown('v-stats-wrap') ? document.querySelectorAll('#v-stats .v-stat').length : 0, score: document.getElementById('v-score').textContent,
        verdict: !!document.querySelector('#v-grade .vd-letter') || !!document.querySelector('#v-grade .vd-score') || shown('v-focus-wrap'),
        share: shown('share'), prog: shown('v-prog'), grade: shown('grade-host') || shown('common'),
        read: shown('v-summary-wrap'), rounds: shown('v-rounds-wrap'), ask: shown('ask'),
        revealing: document.getElementById('vreview').classList.contains('revealing'),
        canAsk: typeof window.occlara.getAccount === 'function' };
    })()`);
    lines.push(`locked review: ${JSON.stringify(lockedPage)}`);
    if (!lockedPage.card || lockedPage.under !== 'v-verdict' || !lockedPage.stats || lockedPage.score !== '13 : 11') {
      return report(false, `a locked review does not show its numbers and the upgrade card under them: ${JSON.stringify(lockedPage)}`);
    }
    if (lockedPage.verdict || lockedPage.share || lockedPage.prog || lockedPage.grade || lockedPage.read || lockedPage.rounds || lockedPage.ask || lockedPage.revealing) {
      return report(false, `a locked review shows what grades or reads the match: ${JSON.stringify(lockedPage)}`);
    }
    // The card's lines are main's when this page's bridge can ask for the
    // account (review-preload.js getAccount), and its own plain ones before.
    if (lockedPage.canAsk ? lockedPage.title !== SEEDED_VIEW.cap.title : lockedPage.title !== 'This review is locked') {
      return report(false, `the locked review's card reads "${lockedPage.title}"`);
    }
    await shot('review-locked', mainWindow, win);
    await rjs('paint(window.__unlocked); delete window.__unlocked; true');

    // THE INVITE PAGE (8.7), from its button above Settings: the link main
    // gave, the progress line usage.js wrote and how it works in two lines.
    await sjs("document.getElementById('nav-invite').click(); true");
    if (!await until(settled('invite'), 4000)) return report(false, 'the Invite button did not bring the Invite page in');
    const ijs = (s) => mainWindow.pageViews().get('invite').webContents.executeJavaScript(s);
    const invitePage = await until(() => ijs(`(() => {
      if (document.getElementById('inv-body').hidden) return null;
      return { link: document.getElementById('inv-link').textContent, progress: document.getElementById('inv-progress').textContent,
        how: [...document.querySelectorAll('#inv-how li')].map((l) => l.textContent), games: !!document.getElementById('inv-games'),
        copy: !document.getElementById('inv-copy').disabled };
    })()`), 4000);
    const inviteMark = await sjs("(() => { const b = document.querySelector('.nav-item[aria-current=page]'); return b ? b.id : null; })()");
    lines.push(`invite page: ${JSON.stringify(invitePage)} | marked ${inviteMark}`);
    if (!invitePage || invitePage.link !== SEEDED_REFERRAL.link || invitePage.progress !== SEEDED_REFERRAL.line
      || invitePage.how.join('|') !== usage.INVITE_HOW.join('|') || !invitePage.copy || invitePage.games || inviteMark !== 'nav-invite') {
      return report(false, `the Invite page does not show main's link, line and how: ${JSON.stringify(invitePage)} marked ${inviteMark}`);
    }
    await shot('invite', mainWindow, win);

    // THE PROFILE PAGE (8.8), from its button between Invite and Settings: the
    // games left as profile.js wrote them from main's account view, the buy
    // section at 5 games for $10, three figures of the sample library's play
    // and the three plans with Free marked.
    await sjs("document.getElementById('nav-profile').click(); true");
    if (!await until(settled('profile'), 4000)) return report(false, 'the Profile button did not bring the Profile page in');
    const pjs = (s) => mainWindow.pageViews().get('profile').webContents.executeJavaScript(s);
    const profileWant = require(path.join(REPO, 'src/shared/profile')).hero(SEEDED_VIEW);
    const profilePage = await until(() => pjs(`(() => {
      if (document.getElementById('pr-body').hidden) return null;
      const r = (el) => el.getBoundingClientRect();
      const page = document.querySelector('.body');
      return { number: document.getElementById('pr-number').textContent, plan: document.getElementById('pr-plan').textContent,
        buy: document.getElementById('pr-buy').textContent, picks: [...document.querySelectorAll('#pr-picks button')].map((b) => b.textContent),
        figs: [...document.querySelectorAll('.pr-fig')].map((f) => [f.querySelector('.pr-fig-v').textContent, f.querySelector('.pr-fig-s').textContent]),
        plans: [...document.querySelectorAll('.pr-plan-row')].map((p) => p.querySelector('.pr-plan-name').textContent),
        numberPx: parseFloat(getComputedStyle(document.getElementById('pr-number')).fontSize),
        overflow: page.scrollWidth > page.clientWidth + 1 };
    })()`), 4000);
    const profileMark = await sjs("(() => { const b = document.querySelector('.nav-item[aria-current=page]'); return b ? b.id : null; })()");
    lines.push(`profile page: ${JSON.stringify(profilePage)} | marked ${profileMark}`);
    if (!profilePage || profilePage.number !== profileWant.number || profilePage.plan !== profileWant.plan || profilePage.buy !== 'Buy 5 games for $10'
      || profilePage.picks.join('|') !== '1 for $2|5 for $10|10 for $20|25 for $50' || profilePage.figs.length !== 3
      || profilePage.figs[1][0] !== 'Jett' || profilePage.plans.join('|') !== 'FreeYour plan|Pro|Max' || profilePage.numberPx < 48
      || profilePage.overflow || profileMark !== 'nav-profile') {
      return report(false, `the Profile page does not show main's games, the buy section, the figures and the plans: ${JSON.stringify(profilePage)} marked ${profileMark}`);
    }
    await shot('profile', mainWindow, win);
    if (process.env.OCCLARA_SHOTS === '1') {
      await pjs("document.querySelector('.body').scrollTop = 99999; true");
      await wait(200);
      await shot('profile-plans', mainWindow, win);
      await pjs("document.querySelector('.body').scrollTop = 0; true");
    }

    // SETTINGS' ACCOUNT SECTION (8.7): email, plan, games, key, Sign out.
    mainWindow.show('settings');
    if (!await until(settled('settings'), 4000)) return report(false, 'Settings never came in');
    const setjs = (s) => mainWindow.pageViews().get('settings').webContents.executeJavaScript(s);
    const acctPage = await until(() => setjs(`(() => {
      const t = (id) => { const n = document.getElementById(id); return n && !n.hidden ? n.textContent : null; };
      if (!t('acct-email')) return null;
      return { email: t('acct-email'), tier: t('acct-tier'), games: t('acct-games'), key: t('acct-key'),
        signOut: t('acct-signout'), signIn: t('acct-signin'), upgrade: t('acct-upgrade'), manage: t('acct-manage'), invite: t('acct-invite') };
    })()`), 4000);
    lines.push(`settings account: ${JSON.stringify(acctPage)}`);
    if (!acctPage || acctPage.email !== SEEDED_VIEW.email || acctPage.tier !== 'Free' || acctPage.games !== SEEDED_VIEW.gamesLeft
      || acctPage.key !== SEEDED_VIEW.accountKey || acctPage.signOut !== 'Sign out' || acctPage.signIn !== null
      || acctPage.upgrade !== 'Upgrade' || acctPage.manage !== 'Manage plan' || acctPage.invite !== 'Invite friends') {
      return report(false, `Settings' Account section does not say what main handed it: ${JSON.stringify(acctPage)}`);
    }
    if (process.env.OCCLARA_SHOTS === '1') {
      await setjs("document.getElementById('acct').scrollIntoView({ block: 'start' }); true");
      await shot('settings-account', mainWindow, win);
      await setjs("document.querySelector('.body').scrollTop = 0; true");
    }

    // THE MOMENTS PAGE (8.7), in the Breakdown tab's place: every seeded
    // match under its own line, its deaths and highlights, the compilation by
    // repeated mistake with Play all for the one kept clip, and a row opening
    // its review at its round.
    mainWindow.show('moments');
    if (!await until(settled('moments'), 4000)) return report(false, 'the Moments page never came in');
    const mojs = (s) => mainWindow.pageViews().get('moments').webContents.executeJavaScript(s);
    const momentsPage = await until(() => mojs(`(() => {
      if (document.getElementById('mo-log').hidden) return null;
      const q = (s) => document.querySelectorAll(s).length;
      return { matches: q('#mo-list .mo-match'), rows: q('#mo-list .mo-row'), deaths: q('#mo-list .mo-kind.death'), highlights: q('#mo-list .mo-kind.highlight'),
        comp: q('#mo-comp-rows .mo-crow'), playAll: [...document.querySelectorAll('#mo-comp-rows button.btn')].map((b) => b.textContent).join(),
        plays: q('#mo-list .mo-play'), gone: q('#mo-list .mo-gone'), marks: q('#mo-list .mo-mark.across'), note: document.getElementById('mo-note').hidden,
        filter: document.querySelectorAll('#mo-filter.seg-slide .seg-thumb').length, counts: document.getElementById('mo-counts').textContent,
        risen: q('#mo-list .mo-row.rise'), causeTitle: (document.querySelector('#mo-list .mo-row .mo-mtitle') || {}).textContent };
    })()`), 6000);
    lines.push(`moments page: ${JSON.stringify(momentsPage)}`);
    if (!momentsPage || momentsPage.matches !== SEEDED || !momentsPage.rows || !momentsPage.deaths || !momentsPage.highlights) {
      return report(false, `the Moments page does not list the seeded matches with their deaths and highlights: ${JSON.stringify(momentsPage)}`);
    }
    if (!momentsPage.comp || !/Play all/.test(momentsPage.playAll) || momentsPage.plays !== 1 || momentsPage.gone < 1 || !momentsPage.marks
      || !momentsPage.note || momentsPage.filter !== 1 || momentsPage.risen < 8) {
      return report(false, `the Moments page is missing its compilation, its one kept clip, its marks, its sliding filter or its rising rows: ${JSON.stringify(momentsPage)}`);
    }
    await shot('moments', mainWindow, win);
    if (process.env.OCCLARA_SHOTS === '1') {
      // The rows themselves, scrolled to, and the filter on Highlights.
      await mojs("document.getElementById('mo-log').scrollIntoView({ block: 'start' }); true");
      await shot('moments-rows', mainWindow, win);
      await mojs("document.querySelector('#mo-filter button[data-kind=\"highlight\"]').click(); document.getElementById('mo-log').scrollIntoView({ block: 'start' }); true");
      await wait(400);
      await shot('moments-highlights', mainWindow, win);
      await mojs("document.querySelector('#mo-filter button[data-kind=\"all\"]').click(); document.querySelector('.body').scrollTop = 0; true");
    }
    // A row opens its review at its round: round 2 of the second match,
    // which the review page jumps to and hands the keyboard (flashTo).
    await mojs(`document.querySelector('#mo-list .mo-row[data-key="${seededIds[1]}:r2"] .mo-open').click(); true`);
    if (!await until(settled('review'), 4000)) return report(false, 'a Moments row did not open its review');
    const rvjs = (s) => mainWindow.pageViews().get('review').webContents.executeJavaScript(s);
    const landed = await until(() => rvjs("(() => { const a = document.activeElement; return a && a.id === 'round-2' && a.classList.contains('flash') ? a.id : null; })()"), 5000);
    lines.push(`moments row opened its review at ${landed}`);
    if (landed !== 'round-2') return report(false, 'the review opened from a Moments row did not jump to its round');
    await shot('moments-review', mainWindow, win);

    if (process.env.OCCLARA_SHOTS === '1') {
      for (const page of ['patterns', 'stats', 'coach', 'settings']) {
        mainWindow.show(page);
        await wait(3000);
        await shot(page, mainWindow, win);
      }
      // The breakdown, folded at the foot of Patterns (8.7), opened.
      mainWindow.show('patterns');
      await wait(1500);
      const pjs = (s) => mainWindow.pageViews().get('patterns').webContents.executeJavaScript(s);
      await pjs("(() => { const d = document.getElementById('breakdown'); d.open = true; d.scrollIntoView({ block: 'start' }); return true; })()");
      await wait(600);
      await shot('patterns-breakdown', mainWindow, win);
      await pjs("(() => { const d = document.getElementById('breakdown'); d.open = false; document.querySelector('.body').scrollTop = 0; return true; })()");
    }

    // 5b. A REVIEW STILL BEING BUILT IS A LOADING SCREEN (8.4.1), through the
    // real index.js: a match the stand-in reader's watch ends opens the review
    // page on its loading screen, Home's last match and its row in Matches say
    // it is being checked where its grade would be, and once its work is done
    // (with no Riot ID, the narrative back and the coach's look from the
    // screen, which with no frame to look at ends at once) the review is
    // painted whole, and the grade is back on Home and in Matches.
    const { ipcMain: ipc } = require('electron');
    const CH5 = require(path.join(REPO, 'src/shared/channels'));
    ipc.emit(CH5.COACH_START, { sender: null });
    const reader = readers[readers.length - 1];
    if (!reader) return report(false, 'recording did not start a reader for the review still being built');
    // NO AGENT CHECK ON THE RECORD CARD (8.4.4), on the real layout. Start
    // opened "Reading your agent..." over its buttons in a Valorant session,
    // then "Playing" and the agent with a tick, or a field to type one, and
    // mid match as readily. Recording, between matches and in one, the card
    // is its two buttons at the height it had before Start, Stop for Start.
    const CARD_NOW = `(() => {
      const rec = document.getElementById('rec');
      return { kids: [...rec.children].map((c) => c.id || c.className).join(), text: rec.innerText.replace(/\\s+/g, ' ').trim(),
        buttons: rec.querySelectorAll('button').length, height: Math.round(rec.getBoundingClientRect().height),
        agent: !!rec.querySelector('[id*="agent"], [class*="agent"], [id^="ab-"]') || /agent/i.test(rec.innerText) };
    })()`;
    await wait(1500);
    const recCard = await sjs(CARD_NOW);
    reader.inLobby = false;
    ipc.emit(CH5.SHELL_NAV, { sender: null }, 'home');
    const inMatch = await until(() => mainWindow.current().sealed, 3000);
    await wait(600);
    const matchCard = await sjs(CARD_NOW);
    lines.push(`recording: card ${JSON.stringify(recCard)} | mid match: sealed=${!!inMatch} card ${JSON.stringify(matchCard)}`);
    const twoButtons = (c) => c.kids === 'rec-controls' && c.buttons === 2 && c.text === 'Stop' && !c.agent && c.height === card.height;
    if (!inMatch) return report(false, 'recording, a match in progress did not seal the window');
    if (!twoButtons(recCard) || !twoButtons(matchCard)) {
      return report(false, `recording, the record card is not its two buttons alone: ${JSON.stringify({ recCard, matchCard, before: card.height })}`);
    }
    await shot('recording', mainWindow, win);
    reader.inLobby = true;
    ipc.emit(CH5.SHELL_NAV, { sender: null }, 'home');
    if (!await until(() => !mainWindow.current().sealed, 3000)) return report(false, 'recording, the match over, the seal did not lift');
    const endedAt = Date.now();
    const snap = { rounds: played.rounds, tips: [], notes: [], context: { ...played.context, agent: 'Jett', language: 'en' },
      startedAt: endedAt - 40 * 60000, endedAt, endedBy: 'score' };
    reader.endWatch.ended = true;
    reader.emit('match-ended', snap);
    if (!await until(settled('review'), 6000)) return report(false, 'the review of the match that ended never came in');
    const rpage = surfaces.find('/review/');
    const rjs5 = (s) => rpage.webContents.executeJavaScript(s);
    const BUILDING = `(() => {
      const b = document.getElementById('building');
      return { building: !b.hidden && getComputedStyle(b).display !== 'none', vreview: !document.getElementById('vreview').hidden,
        title: document.getElementById('b-title').textContent, ask: !document.getElementById('ask').hidden,
        steps: [...document.querySelectorAll('#b-steps .b-step')].map((li) => li.dataset.step + ':' + li.className.split(' ')[1]).join(' '),
        font: getComputedStyle(document.getElementById('b-title')).fontFamily.split(',')[0], weight: getComputedStyle(document.getElementById('b-title')).fontWeight };
    })()`;
    const loading = await until(async () => { const s = await rjs5(BUILDING); return s.building ? s : null; }, 6000) || await rjs5(BUILDING);
    lines.push(`a review still being built: ${JSON.stringify(loading)}`);
    if (!loading.building || loading.vreview || loading.ask || loading.title !== 'Writing your review'
      || loading.steps !== 'saved:done writing:now look:next') {
      return report(false, `the review still being built is not its loading screen: ${JSON.stringify(loading)}`);
    }
    if (!/Geist/.test(loading.font) || !['600', '700', '800'].includes(String(loading.weight))) {
      return report(false, `the loading screen is drawn in ${loading.font} ${loading.weight}, not a Geist weight that ships`);
    }
    await shot('review-building', mainWindow, win);
    const CHECKING_HOME = `(() => {
      const last = document.getElementById('last');
      const row = document.querySelector('#recent-list .r-row');
      return { card: !!last.querySelector('.gv-checking-card'), grade: !!last.querySelector('.gv-grade'), score: !!last.querySelector('.score'),
        text: (last.querySelector('.gv-checking-card') || {}).textContent || '', pill: !!(row && row.querySelector('.gv-checking')),
        rowScore: !!(row && row.querySelector('.r-score')) };
    })()`;
    mainWindow.show('home');
    await until(settled('home'), 4000);
    const homeCheck = await until(async () => { const s = await hjs(CHECKING_HOME); return s.card ? s : null; }, 6000) || await hjs(CHECKING_HOME);
    lines.push(`Home while it is built: ${JSON.stringify(homeCheck)}`);
    if (!homeCheck.card || homeCheck.grade || homeCheck.score || !homeCheck.pill || homeCheck.rowScore) {
      return report(false, `Home shows the grade of a review still being built: ${JSON.stringify(homeCheck)}`);
    }
    await shot('home-checking', mainWindow, win);
    mainWindow.show('matches');
    await until(settled('matches'), 4000);
    const mjs = (s) => mainWindow.pageViews().get('matches').webContents.executeJavaScript(s);
    const ROW = "(() => { const r = document.querySelector('#list .m-row'); return r ? { pill: !!r.querySelector('.m-grade .gv-checking'), score: (r.querySelector('.m-score') || {}).textContent || null } : null; })()";
    const rowCheck = await until(async () => { const s = await mjs(ROW); return s && s.pill ? s : null; }, 6000) || await mjs(ROW);
    lines.push(`its row in Matches while it is built: ${JSON.stringify(rowCheck)}`);
    if (!rowCheck || !rowCheck.pill || rowCheck.score) return report(false, `the Matches row shows the grade of a review still being built: ${JSON.stringify(rowCheck)}`);
    // Opened again from its row (REVIEW_OPEN), it arrives with its work
    // (index.js present()), with nothing pushed meanwhile: still loading.
    await mjs("document.querySelector('#list .m-row').click(); true");
    if (!await until(settled('review'), 4000)) return report(false, 'the row of the review still being built did not open it');
    await wait(600);
    const reopened = await rjs5(BUILDING);
    lines.push(`opened again from its row while it is built: ${JSON.stringify(reopened)}`);
    if (!reopened.building || reopened.vreview) return report(false, `opened from its row, the review still being built was painted half done: ${JSON.stringify(reopened)}`);
    // The narrative comes back; the look from the screen, with no frame of
    // the match in the AI log, ends at once; the review is whole.
    reader.emit('match-review', null, { ...snap, ai: { summary: 'The coach read the match from the screen.', rounds: {}, focus: 'Trade your entries.', study: [] } });
    const WHOLE = `(() => ({ building: !document.getElementById('building').hidden, vreview: !document.getElementById('vreview').hidden,
      summary: document.getElementById('v-summary').textContent, ask: !document.getElementById('ask').hidden }))()`;
    const whole = await until(async () => { const s = await rjs5(WHOLE); return !s.building && s.vreview ? s : null; }, 8000) || await rjs5(WHOLE);
    lines.push(`its work done: ${JSON.stringify(whole)}`);
    if (whole.building || !whole.vreview || whole.summary !== 'The coach read the match from the screen.' || !whole.ask) {
      return report(false, `once its work was done the review was not painted whole: ${JSON.stringify(whole)}`);
    }
    await shot('review-whole', mainWindow, win);
    // Its grade back where the pill was, whatever the screen alone could
    // grade: a number, or "--" with no grade card where it measured too
    // little (one category is not a grade, grade.js).
    const newest = store.list('valorant')[0];
    const graded = !!(newest && newest.grade && typeof newest.grade.score === 'number');
    const want = graded ? String(newest.grade.score) : '--';
    const homeBack = await until(async () => { const s = await hjs(CHECKING_HOME); return !s.card && s.score ? s : null; }, 6000) || await hjs(CHECKING_HOME);
    const rowBack = await until(async () => { const s = await mjs(ROW); return s && !s.pill && s.score ? s : null; }, 6000) || await mjs(ROW);
    lines.push(`and then Home: ${JSON.stringify(homeBack)} | Matches: ${JSON.stringify(rowBack)} | its grade ${want}`);
    if (!newest || newest.at !== endedAt) return report(false, 'the review of the match that ended is not the newest in the library');
    if (homeBack.card || !homeBack.score || homeBack.grade !== graded || !homeBack.rowScore || !rowBack || rowBack.pill || rowBack.score !== want) {
      return report(false, `the review whole, Home or Matches still say it is being checked: ${JSON.stringify({ homeBack, rowBack, want })}`);
    }
    ipc.emit(CH5.COACH_STOP, { sender: null });

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

    // 6b. HOME'S RANK JOURNEY OPENS THE JOURNEY (8.4.1), through the real
    // register-ipc.js and index.js: OPEN_STATS with 'journey' shows Stats with
    // the journey open under the Rank tile, as the page loads, and kept from
    // before, as it is about to show (its arm) or as it comes back called off
    // a switch that never arrived (an enter alone). Shown plainly, it is as
    // the player left it.
    const statsJs = (s) => mainWindow.pageViews().get('stats').webContents.executeJavaScript(s);
    const notesOpen = "document.getElementById('rank-reveal').classList.contains('open')";
    const fold = () => statsJs("document.querySelector('#cards .card.clickable').click(); true");
    // On screen, not only asked for: the page it replaced is out of sight.
    const settledOn = (to, from) => until(() => mainWindow.current().shown === to
      && !!mainWindow.pageViews().get(from) && !mainWindow.pageViews().get(from).getVisible(), 4000);
    ipc.emit(CH5.OPEN_STATS, { sender: null }, 'journey');
    const firstOpen = await until(async () => mainWindow.current().shown === 'stats' && mainWindow.pageViews().get('stats')
      && await statsJs(notesOpen), 8000);
    await fold();
    mainWindow.show('home');
    await settledOn('home', 'stats');
    mainWindow.show('stats');
    await settledOn('stats', 'home');
    await wait(400);
    const plainFolded = !(await statsJs(notesOpen));
    mainWindow.show('home');
    await settledOn('home', 'stats');
    ipc.emit(CH5.OPEN_STATS, { sender: null }, 'journey');
    const armOpen = await until(async () => mainWindow.current().shown === 'stats' && await statsJs(notesOpen), 5000);
    await fold();
    await wait(300);
    mainWindow.show('home');           // and before Home has come in,
    ipc.emit(CH5.OPEN_STATS, { sender: null }, 'journey');   // Stats is called back
    const enterOpen = await until(async () => mainWindow.current().shown === 'stats' && await statsJs(notesOpen), 5000);
    lines.push(`Rank journey: opened=${!!firstOpen} shown plainly after it is folded=${plainFolded ? 'folded' : 'open'}`
      + ` from Home again=${!!armOpen} called back mid switch=${!!enterOpen}`);
    if (!firstOpen) return report(false, 'Home\'s Rank journey opened Stats with the journey folded in the Rank tile');
    if (!plainFolded) return report(false, 'Stats shown plainly opened the journey the player had folded');
    if (!armOpen) return report(false, 'Home\'s Rank journey, with Stats kept from before, did not open the journey');
    if (!enterOpen) return report(false, 'Home\'s Rank journey, Stats called back before Home came in, did not open the journey');
    mainWindow.show('patterns');
    await until(() => mainWindow.current().shown === 'patterns', 3000);

    // 7. CLOSING QUITS (8.4.1). Its X and Alt+F4 (the taskbar's Close is the
    // same 'close') quit by the tray's own path, cleanupAndQuit, and with no
    // match being recorded and no review being built (step 5b's is whole)
    // they ask nothing first. Nothing is hidden in the tray any more. app.quit
    // and the dialog are stood in for, so the check goes on. Ctrl+Shift+M
    // still hides the window to the corner mark, and brings it back.
    const registry = require(path.join(REPO, 'src/main/windows/registry'));
    const markShown = () => { const d = registry.get('dock'); return !!(d && d.isVisible()); };
    const { dialog } = require('electron');
    const realBox = dialog.showMessageBox;
    const realQuit = app.quit;
    let boxes = 0;
    let quits = 0;
    dialog.showMessageBox = async () => { boxes++; return { response: 0 }; };
    app.quit = () => { quits++; };
    const putBack = () => { dialog.showMessageBox = realBox; app.quit = realQuit; };
    if (dialog.showMessageBox === realBox || app.quit === realQuit) { putBack(); return report(false, 'the dialog or app.quit could not be stood in for'); }
    // NEVER INSIDE THE CLOSE EVENT. Electron takes a close its handler
    // prevented for a quit cancelled, so app.quit() called in that same event,
    // as it was with nothing to ask, closed every window and never quit: the
    // real app ran on with no window and no tray. Heard after main-window.js's
    // own listener, this says how many quits that event had already asked for.
    let quitsInEvent = null;
    const inEvent = () => { quitsInEvent = quits; };
    win.on('close', inEvent);
    if (!win.isVisible()) mainWindow.toggleHidden();
    await until(() => win.isVisible(), 3000);
    await sjs("document.getElementById('w-close').click(); true");
    await until(() => quits >= 1, 3000);
    await wait(500);
    lines.push(`X: quit=${quits} (in its close event ${quitsInEvent}) asked=${boxes} window alive=${!win.isDestroyed()} visible=${win.isVisible()} corner mark=${markShown()}`);
    if (quits !== 1 || boxes) { win.removeListener('close', inEvent); putBack(); return report(false, `the X did not quit by itself with nothing at stake: quit ${quits}, asked ${boxes}`); }
    if (quitsInEvent !== 0) { win.removeListener('close', inEvent); putBack(); return report(false, 'the X quit inside its own close event, which Electron then cancels: the app would run on with no window'); }
    if (markShown()) { win.removeListener('close', inEvent); putBack(); return report(false, 'the X put the window out of sight to the tray, the corner mark up'); }
    quitsInEvent = null;
    win.close();
    await until(() => quits >= 2, 3000);
    await wait(300);
    lines.push(`Alt+F4: quit=${quits} (in its close event ${quitsInEvent}) asked=${boxes} window alive=${!win.isDestroyed()}`);
    win.removeListener('close', inEvent);
    putBack();
    if (quits !== 2 || boxes) return report(false, `Alt+F4 did not quit by itself with nothing at stake: quit ${quits}, asked ${boxes}`);
    if (quitsInEvent !== 1) return report(false, 'Alt+F4 quit inside its own close event, which Electron then cancels: the app would run on with no window');
    // Ctrl+Shift+M: out of sight, the corner mark up, and back.
    mainWindow.toggleHidden();
    await until(() => !win.isVisible(), 3000);
    // Waited for: the mark goes up a turn after the window hides (index.js
    // placeMark), never in the same moment.
    const markUp = await until(markShown, 3000);
    lines.push(`Ctrl+Shift+M: window alive=${!win.isDestroyed()} visible=${win.isVisible()} corner mark=${!!markUp}`);
    if (win.isDestroyed() || win.isVisible()) return report(false, 'Ctrl+Shift+M did not put the window out of sight');
    if (!markUp) return report(false, 'hidden, the corner mark did not show');
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
