'use strict';

/**
 * WHAT THE LIVE RATING'S CORNER READ COSTS, in Chromium (the live rating,
 * docs/claude/rating.md "Live"). The recorder's page reads the kill feed's
 * corner of its newest VideoFrame five times a second (renderer/recorder
 * feedTick): a clone, the corner alone drawn into a canvas of the corner's
 * size, read back, read by the detector. This check does exactly that on
 * VideoFrames made from a drawn 1080p, 720p and 480p frame (no screen, no
 * game), times it, and times a whole frame drawn and read back beside it for
 * comparison. It also checks the detector reads the drawn rows right through
 * the canvas.
 *
 * On GitHub's machine there is no GPU: the frames are in memory and the
 * canvas is software, so this is the CPU cost of the work, not a game PC's
 * GPU readback. That one is logged in the field (index.js, once a minute).
 *
 * Run: npm run check:feedcost (a window, never on a PC someone is playing on)
 */

const path = require('path');
const fs = require('fs');
const os = require('os');

const REPO = path.join(__dirname, '..');
const OUT = path.join(os.tmpdir(), 'occlara-feed-cost-check.json');

if (!process.versions.electron) {
  const { spawnSync } = require('child_process');
  const electron = require('electron');
  try { fs.unlinkSync(OUT); } catch { /* nothing to clear */ }
  const env = Object.assign({}, process.env, { OCCLARA_FEEDCOST_OUT: OUT });
  delete env.ELECTRON_RUN_AS_NODE;
  spawnSync(electron, [__filename], { env, timeout: 90000 });
  let rec = null;
  try { rec = JSON.parse(fs.readFileSync(OUT, 'utf8')); } catch { /* reported below */ }
  if (!rec) { console.error('FAIL: the check wrote no result'); process.exit(1); }
  for (const l of rec.lines) console.log('  ' + l);
  if (!rec.ok) { console.error('FAIL: ' + rec.detail); process.exit(1); }
  console.log('PASS: the corner read finds the drawn rows through a canvas at 1080p, 720p and 480p, and costs what the lines above say');
  process.exit(0);
}

const { app, BrowserWindow } = require('electron');
const { drawFrame } = require('./fixtures/killfeed-frames');
const lines = [];
let done = false;
function report(ok, detail) {
  if (done) return;
  done = true;
  try { fs.writeFileSync(process.env.OCCLARA_FEEDCOST_OUT || OUT, JSON.stringify({ ok, detail, lines })); } catch { /* exit code */ }
  app.exit(ok ? 0 : 1);
}
app.disableHardwareAcceleration();
app.on('window-all-closed', () => {});

app.whenReady().then(async () => {
  try {
    const win = new BrowserWindow({ show: false, width: 400, height: 300, webPreferences: { sandbox: true, contextIsolation: true } });
    await win.loadURL('about:blank');
    const js = (s) => win.webContents.executeJavaScript(s);
    await js(fs.readFileSync(path.join(REPO, 'src', 'shared', 'killfeed.js'), 'utf8') + '\n;true');
    for (const [W, H] of [[1920, 1080], [1280, 720], [854, 480]]) {
      const f = drawFrame({ W, H, order: 'rgb', rows: [{ slot: 0, killer: 'ally', victim: 'enemy', mine: 'kill' }, { slot: 1, killer: 'enemy', victim: 'ally', mine: 'death' }, { slot: 2, killer: 'ally', victim: 'enemy' }] });
      const rgba = Buffer.alloc(W * H * 4);
      for (let i = 0, j = 0; i < f.data.length; i += 3, j += 4) { rgba[j] = f.data[i]; rgba[j + 1] = f.data[i + 1]; rgba[j + 2] = f.data[i + 2]; rgba[j + 3] = 255; }
      const b64 = rgba.toString('base64');
      const r = await js(`(async () => {
        const W = ${W}, H = ${H};
        const bin = atob('${b64}');
        const px = new Uint8ClampedArray(bin.length);
        for (let i = 0; i < bin.length; i++) px[i] = bin.charCodeAt(i);
        const src = new OffscreenCanvas(W, H);
        src.getContext('2d').putImageData(new ImageData(px, W, H), 0, 0);
        const frame = new VideoFrame(src, { timestamp: 0 });
        const kf = self.OcclaraKillfeed;
        const reg = kf.regionOf(W, H);
        const c = new OffscreenCanvas(reg.width, reg.height);
        const ctx = c.getContext('2d', { willReadFrequently: true });
        const N = 60;
        let det = null;
        const t0 = performance.now();
        for (let i = 0; i < N; i++) {
          const f = frame.clone();
          ctx.drawImage(f, reg.x, reg.y, reg.width, reg.height, 0, 0, reg.width, reg.height);
          f.close();
          const d = ctx.getImageData(0, 0, reg.width, reg.height);
          det = kf.detect({ width: reg.width, height: reg.height, data: d.data, channels: 4 }, H);
        }
        const corner = (performance.now() - t0) / N;
        const full = new OffscreenCanvas(W, H);
        const fctx = full.getContext('2d', { willReadFrequently: true });
        const t1 = performance.now();
        for (let i = 0; i < 10; i++) { const f = frame.clone(); fctx.drawImage(f, 0, 0); f.close(); fctx.getImageData(0, 0, W, H); }
        const whole = (performance.now() - t1) / 10;
        frame.close();
        return { corner, whole, region: reg, rows: det.list.map((x) => x.slot + ':' + x.killer + '>' + x.victim + (x.mine ? '*' + x.mine : '')).join(' ') };
      })()`);
      lines.push(`${H}p: the corner ${r.region.width}x${r.region.height}, ${r.corner.toFixed(2)} ms a read (${(r.corner * 5).toFixed(1)} ms a second at five a second); a whole frame drawn and read back ${r.whole.toFixed(2)} ms; rows ${r.rows}`);
      if (r.rows !== '0:ally>enemy*kill 1:enemy>ally*death 2:ally>enemy') return report(false, `at ${H}p the corner read through a canvas does not find the drawn rows: ${r.rows}`);
      if (!(r.corner < r.whole)) return report(false, `at ${H}p the corner costs no less than a whole frame (${r.corner} against ${r.whole})`);
    }
    report(true, 'ok');
  } catch (e) {
    report(false, `the check threw: ${e && e.stack ? e.stack : e}`);
  }
});
