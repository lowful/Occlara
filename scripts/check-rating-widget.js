'use strict';

/**
 * THE STREAM WIDGET IN A REAL BROWSER (the live rating, docs/claude/rating.md
 * "Live"). OBS's browser source is Chromium, and so is Electron's: this check
 * serves the widget from the real server (src/main/services/rating-stream.js,
 * 127.0.0.1, the token, the page made whole by rating-widget-page.js), loads it
 * in a window the way OBS would, and sends it what main sends: nothing between
 * matches, the live rating and its moves, the compact size, "Full time". It
 * reads the page back each time and checks the page fetched nothing but its
 * own events. The app's index.js is not loaded: no web guard, no reader.
 *
 * OCCLARA_SHOTS=1 writes dist-surface-shots/widget-*.png: each as OBS lays it
 * (transparent) and the same over a dark and a bright ground.
 *
 * Results travel through a FILE, not stdout (an Electron main process on
 * Windows does not reliably flush a piped stdout).
 *
 * Run: npm run check:ratingwidget (a window: never on a PC someone is playing on)
 */

const path = require('path');
const fs = require('fs');
const os = require('os');

const REPO = path.join(__dirname, '..');
const OUT = path.join(os.tmpdir(), 'occlara-rating-widget-check.json');

if (!process.versions.electron) {
  const { spawnSync } = require('child_process');
  const electron = require('electron');
  try { fs.unlinkSync(OUT); } catch { /* nothing to clear */ }
  const env = Object.assign({}, process.env, { OCCLARA_WIDGET_OUT: OUT });
  delete env.ELECTRON_RUN_AS_NODE;
  const r = spawnSync(electron, [__filename], { env, timeout: 90000 });
  let rec = null;
  try { rec = JSON.parse(fs.readFileSync(OUT, 'utf8')); } catch { /* reported below */ }
  if (!rec) { console.error('FAIL: the check wrote no result (exit ' + r.status + ')'); process.exit(1); }
  for (const l of rec.lines) console.log('  ' + l);
  if (!rec.ok) { console.error('FAIL: ' + rec.detail); process.exit(1); }
  console.log('PASS: the widget served on 127.0.0.1 shows nothing between matches, the live rating with its move and label, the compact size and Full time, and fetches nothing but its own events');
  process.exit(0);
}

const { app, BrowserWindow } = require('electron');
const { createRatingStream, newToken } = require('../src/main/services/rating-stream');
const widgetPage = require('../src/main/services/rating-widget-page');

const lines = [];
let reported = false;
function report(ok, detail) {
  if (reported) return;
  reported = true;
  try { fs.writeFileSync(process.env.OCCLARA_WIDGET_OUT || OUT, JSON.stringify({ ok, detail, lines })); }
  catch { /* exit code still carries it */ }
  app.exit(ok ? 0 : 1);
}
app.disableHardwareAcceleration();
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');
app.on('window-all-closed', () => { /* the run decides */ });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms) {
  const end = Date.now() + ms;
  for (;;) {
    let v = null;
    try { v = await fn(); } catch { v = null; }
    if (v) return v;
    if (Date.now() > end) return null;
    await wait(120);
  }
}

const NOW = `(() => {
  const w = document.getElementById('w');
  const r = w.getBoundingClientRect();
  return { shown: !w.hidden && w.classList.contains('on'), num: document.getElementById('w-num').textContent,
    badge: document.getElementById('w-badge').className, delta: document.getElementById('w-delta').textContent,
    up: document.getElementById('w-delta').classList.contains('up'), down: document.getElementById('w-delta').classList.contains('down'),
    label: document.getElementById('w-label').textContent, state: document.getElementById('w-state').textContent,
    path: document.getElementById('w-path').getAttribute('d') || '', width: Math.round(r.width), height: Math.round(r.height),
    compact: document.body.classList.contains('compact'), font: getComputedStyle(document.getElementById('w-num')).fontFamily.split(',')[0],
    bg: getComputedStyle(document.body).backgroundColor };
})()`;

async function shoot(win, name, ground) {
  if (process.env.OCCLARA_SHOTS !== '1') return;
  const dir = path.join(REPO, 'dist-surface-shots');
  fs.mkdirSync(dir, { recursive: true });
  await wait(700);
  const js = (s) => win.webContents.executeJavaScript(s);
  if (ground) await js(`document.documentElement.style.setProperty('background', '${ground}', 'important'); true`);
  await wait(120);
  const img = await win.webContents.capturePage();
  fs.writeFileSync(path.join(dir, `widget-${name}.png`), img.toPNG());
  lines.push(`shot widget-${name}.png`);
  if (ground) await js("document.documentElement.style.removeProperty('background'); true");
}

app.whenReady().then(async () => {
  let stream = null;
  try {
    const token = newToken();
    stream = createRatingStream({ token, page: widgetPage.page });
    const st = await stream.start();
    if (!st.ok) return report(false, `the widget's server did not start: ${st.error}`);
    lines.push(`served on 127.0.0.1:${st.port}`);
    const requests = [];
    const open = async (url) => {
      const win = new BrowserWindow({ show: false, width: 560, height: 230, transparent: true, frame: false, backgroundColor: '#00000000',
        webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } });
      win.showInactive();
      win.webContents.session.webRequest.onBeforeRequest((d, cb) => { requests.push(d.url); cb({}); });
      await win.loadURL(url);
      return win;
    };
    const win = await open(stream.url('standard'));
    const js = (s) => win.webContents.executeJavaScript(s);

    // Nothing between matches.
    stream.send({ state: 'idle' });
    await wait(800);
    const idle = await js(NOW);
    lines.push(`idle: ${JSON.stringify({ shown: idle.shown, bg: idle.bg })}`);
    if (idle.shown) return report(false, 'between matches the widget shows something');
    if (!/rgba\(0, 0, 0, 0\)|transparent/.test(idle.bg)) return report(false, `the page's ground is not transparent: ${idle.bg}`);

    // Live: a move up, then a move down. On the 100 scale since 9.1 (the
    // owner's item 16): main sends the value in the rating's own units and
    // the move as shown, and the badge writes the number times ten.
    stream.send({ state: 'live', rating: { value: 6.4, shown: '64', tier: 'fair', last: { delta: '+4', up: true, down: false, label: 'First kill, 5v5' }, line: [6, 6.4] } });
    stream.send({ state: 'live', rating: { value: 7.1, shown: '71', tier: 'good', last: { delta: '+7', up: true, down: false, label: 'Kill as the last one up, 1v2' }, line: [6, 6.4, 6.2, 7.1] } });
    const live = await until(async () => { const s = await js(NOW); return s.shown && s.num === '71' ? s : null; }, 4000) || await js(NOW);
    lines.push(`live: ${JSON.stringify(live)}`);
    if (!live.shown || live.num !== '71' || !/\bt-good\b/.test(live.badge) || live.label !== 'Kill as the last one up, 1v2' || live.state !== 'Live, provisional'
      || live.delta !== '+7' || !live.up || !live.path.startsWith('M') || !/Onest/.test(live.font)) {
      return report(false, `the live widget does not show the number in its tier, the move up, the label and the line: ${JSON.stringify(live)}`);
    }
    await shoot(win, 'live');
    await shoot(win, 'live-on-dark', '#1b2129');
    await shoot(win, 'live-on-bright', '#c9cdd2');
    stream.send({ state: 'live', rating: { value: 6.6, shown: '66', tier: 'fair', last: { delta: '-5', up: false, down: true, label: 'Died first, 5v5' }, line: [6, 6.4, 6.2, 7.1, 6.6] } });
    const down = await until(async () => { const s = await js(NOW); return s.num === '66' ? s : null; }, 3000) || await js(NOW);
    if (down.delta !== '-5' || !down.down || down.label !== 'Died first, 5v5' || !/\bt-fair\b/.test(down.badge)) {
      return report(false, `a move down does not fall in red with its label: ${JSON.stringify(down)}`);
    }
    await shoot(win, 'live-down', '#1b2129');

    // Not reading the kill feed: the plate says so, no number.
    stream.send({ state: 'blind' });
    const blind = await until(async () => { const s = await js(NOW); return s.label === 'Not reading the kill feed' ? s : null; }, 3000) || await js(NOW);
    lines.push(`not reading: ${JSON.stringify({ shown: blind.shown, num: blind.num, label: blind.label })}`);
    if (!blind.shown || blind.num !== '' || blind.label !== 'Not reading the kill feed') return report(false, `"not reading" does not show in place of the number: ${JSON.stringify(blind)}`);
    await shoot(win, 'blind', '#1b2129');

    // Full time.
    stream.send({ state: 'final', rating: { value: 7.4, shown: '74', tier: 'good' } });
    const fin = await until(async () => { const s = await js(NOW); return s.state === 'Full time' ? s : null; }, 3000) || await js(NOW);
    lines.push(`full time: ${JSON.stringify({ num: fin.num, state: fin.state, label: fin.label, delta: fin.delta })}`);
    if (!fin.shown || fin.num !== '74' || fin.state !== 'Full time' || fin.delta !== '') return report(false, `"Full time" is not shown with the confirmed number: ${JSON.stringify(fin)}`);
    await shoot(win, 'final', '#1b2129');

    // The compact size.
    const small = await open(stream.url('compact'));
    const sjs = (s) => small.webContents.executeJavaScript(s);
    stream.send({ state: 'live', rating: { value: 8.3, shown: '83', tier: 'great', last: { delta: '+3', up: true, down: false, label: 'Triple kill with the opening kill' }, line: [6, 7.2, 8.3] } });
    const c = await until(async () => { const s = await sjs(NOW); return s.shown && s.num === '83' ? s : null; }, 4000) || await sjs(NOW);
    lines.push(`compact: ${JSON.stringify({ num: c.num, width: c.width, height: c.height, compact: c.compact })}`);
    if (!c.compact || !c.shown || c.width > 380 || c.width < 250 || !/\bt-great\b/.test(c.badge)) return report(false, `the compact widget is not the small corner: ${JSON.stringify(c)}`);
    if (live.width < 440 || live.width > 540) return report(false, `the standard widget is not its size: ${live.width}`);
    await shoot(small, 'compact', '#1b2129');

    // Back to nothing.
    stream.send({ state: 'idle' });
    const gone = await until(async () => { const s = await js(NOW); return !s.shown ? s : null; }, 3000);
    if (!gone) return report(false, 'after the match the widget did not go');

    // It fetched nothing but its own page and events.
    const foreign = requests.filter((u) => !u.startsWith(`http://127.0.0.1:${st.port}/${token}/`));
    lines.push(`requests: ${requests.length}, none elsewhere: ${!foreign.length}`);
    if (foreign.length) return report(false, `the widget fetched something else: ${foreign.join(', ')}`);

    // Stopped: the page's events end, nothing answers.
    await stream.stop();
    const refused = await new Promise((resolve) => {
      require('http').get({ host: '127.0.0.1', port: st.port, path: `/${token}/`, agent: false, headers: { Host: `127.0.0.1:${st.port}` } }, () => resolve(false))
        .on('error', () => resolve(true));
    });
    if (!refused) return report(false, 'stopped, the widget still answered');
    report(true, 'ok');
  } catch (e) {
    report(false, `the check threw: ${e && e.stack ? e.stack : e}`);
  } finally {
    if (stream) stream.stop().catch(() => {});
  }
});
