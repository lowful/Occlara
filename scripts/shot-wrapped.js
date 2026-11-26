'use strict';

/**
 * PICTURES OF OCCLARA WRAPPED (docs/claude/wrapped.md), every slide of the
 * sample year at a window size, so the look is looked at and not only
 * compiled. Dev tool, never shipped.
 *
 *   npx electron scripts/shot-wrapped.js --out <dir> [--size 1200x780] [--frames] [--perf] [--reduced] [--real]
 *
 * The real page and its real preload in a window of that content size, main's
 * half stood in for by the real wrapped-service.js on the sample year
 * (scripts/fixtures/wrapped-sample.js), and its clips by one test pattern
 * made with the bundled ffmpeg and served on occlara-clip:// as main serves a
 * kept clip. --real reads this PC's own year record (or its library, read
 * only, when there is no record yet) instead of the sample: nothing of it is
 * written anywhere but the pictures in --out, which must not be in the repo.
 *
 *   <slide index>-<kind>.png         each slide once its arrival has settled
 *   frames-<kind>-<ms>.png           --frames: the opening and the title at moments
 *   perf.json                        --perf: frame times on the heaviest slide
 *
 * Run it from Git Bash as: env -u ELECTRON_RUN_AS_NODE npx electron scripts/shot-wrapped.js ...
 */

const { app, BrowserWindow, ipcMain, protocol, screen } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const C = require(path.join(ROOT, 'src/shared/channels'));
const clipScheme = require(path.join(ROOT, 'src/main/services/clip-scheme'));
const { createWrapped } = require(path.join(ROOT, 'src/main/services/wrapped-service'));
const W = require(path.join(ROOT, 'src/shared/wrapped'));

const arg = (name, dflt) => { const i = process.argv.indexOf(name); return i > 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : dflt; };
const has = (name) => process.argv.includes(name);
const OUT = path.resolve(arg('--out', path.join(os.tmpdir(), 'occlara-wrapped-shots')));
const [WIDTH, HEIGHT] = String(arg('--size', '1200x780')).split('x').map(Number);
const SAMPLE_CLIP = path.join(os.tmpdir(), 'occlara-wrapped-test-clip.mkv');

protocol.registerSchemesAsPrivileged([clipScheme.PRIVILEGED]);
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');
if (has('--reduced')) app.commandLine.appendSwitch('force-prefers-reduced-motion');
app.on('window-all-closed', () => {});

/** A test pattern clip, 8 seconds of 1280 by 720, made once with the bundled ffmpeg. */
function testClip() {
  if (fs.existsSync(SAMPLE_CLIP)) return SAMPLE_CLIP;
  let ff = null;
  try { ff = require('ffmpeg-static'); } catch { ff = null; }
  if (!ff) return null;
  const r = spawnSync(ff, ['-y', '-f', 'lavfi', '-i', 'testsrc2=size=1280x720:rate=30', '-t', '8', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', SAMPLE_CLIP], { windowsHide: true });
  return r.status === 0 && fs.existsSync(SAMPLE_CLIP) ? SAMPLE_CLIP : null;
}

/** This PC's rows: its year record if it has one, else its library read through rowOf. Read only. */
function realRows() {
  const ud = path.join(process.env.APPDATA || '', 'Occlara');
  const { YearRecord } = require(path.join(ROOT, 'src/main/services/year-record'));
  const rec = new YearRecord(path.join(ud, 'wrapped'));
  const kept = rec.years().length ? rec.rows() : [];
  if (kept.length) return { rows: kept, ud };
  const dir = path.join(ud, 'reviews');
  const index = JSON.parse(fs.readFileSync(path.join(dir, 'index.json'), 'utf8'));
  const rows = [];
  for (const m of index) {
    try {
      const e = JSON.parse(fs.readFileSync(path.join(dir, `${m.id}.json`), 'utf8'));
      const r = W.rowOf(m.id, m.game, m.at, e.review);
      if (r) rows.push(r);
    } catch { /* skipped */ }
  }
  return { rows, ud };
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

app.whenReady().then(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const real = has('--real') ? realRows() : null;
  const clip = real ? null : testClip();
  const rows = real ? real.rows : require('./fixtures/wrapped-sample').rows();
  const year = real ? new Date().getFullYear() : W.yearOfAt(rows[rows.length - 1].at);
  // The clips the sample names are this one test pattern; a real run plays the PC's own.
  protocol.handle(clipScheme.SCHEME, clipScheme.createHandler({
    fileOf: (id, name) => (real ? path.join(real.ud, 'reviews', id, name) : clip),
  }));
  const wrapped = createWrapped({
    year: { rows: () => rows },
    store: { get: () => ({}), set() {} },
    now: () => new Date(year, 11, 20, 20).getTime(),
    busy: () => false,
    free: () => true,
    hasClip: (id, name) => (real ? fs.existsSync(path.join(real.ud, 'reviews', id, name)) : !!clip),
    clipUrl: (id, name) => clipScheme.urlFor(id, name),
    extras: () => (real ? {} : { trainer: 41, drills: 12 }),
    sounds: () => false,
    hz: () => screen.getPrimaryDisplay().displayFrequency,
    show: () => true,
    sample: () => (real ? null : rows),
  });
  ipcMain.handle(C.WRAPPED_GET, async () => wrapped.get());
  ipcMain.on(C.WRAPPED_ACT, () => {});

  const win = new BrowserWindow({
    width: WIDTH, height: HEIGHT, useContentSize: true, show: false, frame: false, backgroundColor: '#05060A',
    opacity: has('--visible') ? 1 : 0, focusable: false, skipTaskbar: true,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: false, preload: path.join(ROOT, 'src/preload/wrapped-preload.js') },
  });
  win.setIgnoreMouseEvents(true);
  await win.loadFile(path.join(ROOT, 'src/renderer/wrapped/index.html'));
  win.showInactive();
  // The pictures are of the story, not of the pause the script holds it in.
  await win.webContents.insertCSS('.wr.paused .wr-stage::after { display: none !important; }');
  const js = (s) => win.webContents.executeJavaScript(s);
  const ready = async () => { for (let i = 0; i < 100; i++) { const s = await js('window.__wrapped && window.__wrapped.state()'); if (s && (s.ready || s.slides.length === 0)) return s; await wait(100); } return null; };
  const st = await ready();
  if (!st || !st.ready) {
    await wait(800);
    fs.writeFileSync(path.join(OUT, 'empty.png'), (await win.capturePage()).toPNG());
    console.log('not ready:', JSON.stringify(st));
    app.exit(0);
    return;
  }
  await js('window.__wrapped.pause(true)');
  const kinds = st.slides;
  const tag = `${WIDTH}x${HEIGHT}${has('--reduced') ? '-reduced' : ''}${real ? '-real' : ''}`;
  console.log('slides:', kinds.join(', '));
  const shoot = async (name) => { const img = await win.capturePage(); fs.writeFileSync(path.join(OUT, name), img.toPNG()); console.log('shot', name); };

  for (let i = 0; i < kinds.length; i++) {
    // Each slide played to its settled state, then held still for the picture.
    await js(`(window.__wrapped.pause(false), window.__wrapped.go(${i}), true)`);
    await wait(has('--reduced') ? 700 : 3200);
    await js('window.__wrapped.pause(true)');
    await wait(250);
    await shoot(`${tag}-${String(i + 1).padStart(2, '0')}-${kinds[i]}.png`);
  }

  if (has('--frames')) {
    for (const kind of ['open', 'title', 'highlights']) {
      const i = kinds.indexOf(kind);
      if (i < 0) continue;
      await js('window.__wrapped.go(0)');
      await js(`(window.__wrapped.pause(false), window.__wrapped.go(${i === 0 ? 1 : 0}), true)`);
      await wait(600);
      await js(`window.__wrapped.go(${i})`);
      const t0 = Date.now();
      for (const at of [250, 700, 1400, 3000]) {
        await wait(Math.max(0, at - (Date.now() - t0)));
        await shoot(`${tag}-frames-${kind}-${String(at).padStart(4, '0')}ms.png`);
      }
    }
  }

  if (has('--perf')) {
    // The heaviest slide: the one with the clip playing over the moving
    // ground (highlights, else best, else title), measured for 6 seconds.
    const heavy = ['highlights', 'best', 'title'].find((k) => kinds.includes(k));
    await js(`(window.__wrapped.pause(false), window.__wrapped.go(${kinds.indexOf(heavy)}), true)`);
    await wait(1500);
    await js('window.__wrapped.gl() && window.__wrapped.gl().resetStats()');
    const page = await js(`new Promise((resolve) => { const xs = []; let last = 0; const end = performance.now() + 6000;
      const f = (t) => { if (last) xs.push(t - last); last = t; if (t < end) requestAnimationFrame(f); else { xs.sort((a, b) => a - b);
      const mean = xs.reduce((a, b) => a + b, 0) / xs.length; resolve({ frames: xs.length, meanMs: +mean.toFixed(2), p95Ms: +xs[Math.floor(xs.length * 0.95)].toFixed(2), p99Ms: +xs[Math.floor(xs.length * 0.99)].toFixed(2), maxMs: +xs[xs.length - 1].toFixed(2), over20: xs.filter((x) => x > 20).length }); } };
      requestAnimationFrame(f); })`);
    const glStats = await js('window.__wrapped.state().gl');
    const out = { slide: heavy, size: tag, page, gl: glStats };
    if (has('--stress')) {
      // A machine under load (a game behind the app), stood in for by 40 ms of
      // busy work in every frame for 5 seconds (25 frames a second, under half
      // the panel and under 29): the ground must step down.
      out.stress = await js(`new Promise((resolve) => { const end = performance.now() + 5000; const before = window.__wrapped.state().gl.level;
        const burn = () => { const t = performance.now(); while (performance.now() - t < 40) {} if (performance.now() < end) requestAnimationFrame(burn); else resolve({ before, after: window.__wrapped.state().gl, noGl: document.getElementById('wr').classList.contains('no-gl') }); };
        requestAnimationFrame(burn); })`);
    }
    fs.writeFileSync(path.join(OUT, `${tag}-perf.json`), JSON.stringify(out, null, 2));
    console.log('perf', JSON.stringify(out));
  }
  app.exit(0);
}).catch((e) => { console.error(e); app.exit(1); });
