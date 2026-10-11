'use strict';

/**
 * A real recording for test:webm and check:webmplay, of a GENERATED canvas,
 * never anybody's screen.
 *
 * src/shared/webm.js reads what Chromium's MediaRecorder writes, so its fixture
 * is written by that MediaRecorder, asked what the recorder asks: H.264, a
 * keyframe every 1000 ms (videoKeyFrameIntervalDuration) and a chunk every
 * 1000 ms (the timeslice), in this repo's Electron. Only the source differs: a
 * 640x360 canvas this script draws, so the file holds nothing captured and can
 * sit in a public repo.
 *
 * WHAT THE CANVAS SHOWS. A colour that drifts and a ball and a bar that move,
 * so every frame differs from the last as a game's do, and along its foot
 * sixteen squares, black or white, spelling in binary the milliseconds since
 * the recorder started. A frame drawn back out of a clip therefore says which
 * moment it is, and check:webmplay holds a clip's frame to the source's at the
 * same time instead of only calling it not black. Never black itself: the
 * colour stays at 45% lightness.
 *
 * WHAT IS WRITTEN, beside this script:
 *   recording-canvas.mkv   the chunks joined in the order they came
 *   recording-canvas.json  each chunk's size and when it came, so the test
 *                          feeds the reader the chunks exactly as they arrived;
 *                          the file's length and SHA-256, so a checkout that
 *                          changed a byte fails the test and not the reader; and
 *                          where the time code is drawn
 * A recording that does not read as one (webm.js refuses it, a Cluster that
 * does not open on a keyframe, too few Clusters) is not written.
 *
 * Run: node scripts/fixtures/make-recording-fixture.js [--seconds 12 to 15]
 *
 * It relaunches itself under Electron without ELECTRON_RUN_AS_NODE, which this
 * shell exports and which boots Electron as plain node. A rerun writes a new
 * recording with new bytes; the tests take their numbers from the JSON and the
 * file, so they hold on any rerun. Commit the two files together.
 */

const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

const electron = require('electron');

const OUT_MKV = path.join(__dirname, 'recording-canvas.mkv');
const OUT_JSON = path.join(__dirname, 'recording-canvas.json');
const RESULT = path.join(os.tmpdir(), 'occlara-recording-fixture.json');

const CFG = {
  width: 640,
  height: 360,
  fps: 30,
  // A few hundred KB for 12 s: the canvas is flat colour, so a low rate keeps
  // the squares sharp.
  videoBitsPerSecond: 200000,
  videoKeyFrameIntervalDuration: 1000,
  timesliceMs: 1000,
  // The order the 8.3 spike tried them in; Chromium names any of them
  // video/x-matroska;codecs=avc1 once it starts.
  mimeTypes: ['video/webm;codecs=h264', 'video/webm;codecs=avc1', 'video/x-matroska;codecs=avc1'],
  // The time code: 16 bits, most significant first, in squares of `size` px
  // from x 0 along y `y`, white for a 1.
  code: { bits: 16, size: 40, y: 300 },
};

// 12 s at least, because the tests cut a clip from Cluster 4 into Cluster 9;
// 15 at most, so the file stays a couple of hundred KB.
const SECONDS_MIN = 12;
const SECONDS_MAX = 15;
const SECONDS_SAY = '--seconds must be a whole number from ' + SECONDS_MIN + ' to ' + SECONDS_MAX;

function argSeconds(argv) {
  const at = argv.indexOf('--seconds');
  const n = at >= 0 ? Number(argv[at + 1]) : SECONDS_MIN;
  return Number.isInteger(n) && n >= SECONDS_MIN && n <= SECONDS_MAX ? n : null;
}

// ---------------------------------------------------------------------------
// The page: serialized into executeJavaScript, so it uses only the browser
// ---------------------------------------------------------------------------

async function recordCanvas(cfg) {
  const canvas = document.createElement('canvas');
  canvas.width = cfg.width;
  canvas.height = cfg.height;
  document.body.appendChild(canvas);
  const g = canvas.getContext('2d');
  const mime = cfg.mimeTypes.find((m) => MediaRecorder.isTypeSupported(m));
  if (!mime) throw new Error('MediaRecorder records none of ' + cfg.mimeTypes.join(', '));

  let t0 = null;
  let drawn = 0;
  const draw = () => {
    const ms = t0 === null ? 0 : Math.max(0, Math.round(performance.now() - t0));
    drawn += 1;
    g.fillStyle = 'hsl(' + ((ms / 40) % 360) + ', 55%, 45%)';
    g.fillRect(0, 0, cfg.width, cfg.height);
    g.fillStyle = '#ffffff';
    g.beginPath();
    g.arc(((ms / 5) % (cfg.width + 80)) - 40, 150, 36, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#1a1a1a';
    g.fillRect(cfg.width - ((ms / 3) % cfg.width), 40, 18, 220);
    const c = cfg.code;
    for (let i = 0; i < c.bits; i++) {
      g.fillStyle = (ms >> (c.bits - 1 - i)) & 1 ? '#ffffff' : '#000000';
      g.fillRect(i * c.size, c.y, c.size, c.size);
    }
  };
  draw();
  const timer = setInterval(draw, 1000 / cfg.fps);

  const stream = canvas.captureStream(cfg.fps);
  const recorder = new MediaRecorder(stream, {
    mimeType: mime,
    videoBitsPerSecond: cfg.videoBitsPerSecond,
    videoKeyFrameIntervalDuration: cfg.videoKeyFrameIntervalDuration,
  });
  const chunks = [];
  let queue = Promise.resolve();
  let failure = null;
  // In order, stamped when the chunk was handed over.
  recorder.ondataavailable = (ev) => {
    const atMs = Math.round(performance.now() - t0);
    const timecode = ev.timecode;
    queue = queue.then(() => new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const url = String(reader.result);
        chunks.push({ atMs, timecode, size: ev.data.size, base64: url.slice(url.indexOf(',') + 1) });
        resolve();
      };
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(ev.data);
    })).catch((e) => { failure = String((e && e.message) || e); });
  };
  recorder.onerror = (ev) => { failure = String((ev.error && ev.error.message) || ev.error || ev); };
  const stopped = new Promise((resolve) => { recorder.onstop = resolve; });
  t0 = performance.now();
  recorder.start(cfg.timesliceMs);
  const mimeAtStart = recorder.mimeType;
  await new Promise((resolve) => setTimeout(resolve, cfg.seconds * 1000));
  recorder.stop();
  await stopped;
  await queue;
  clearInterval(timer);
  stream.getTracks().forEach((t) => t.stop());
  if (failure) throw new Error(failure);
  return { mimeAsked: mime, mimeAtStart, mimeAfterStop: recorder.mimeType, drawn, chunks };
}

// ---------------------------------------------------------------------------
// Under Electron
// ---------------------------------------------------------------------------

function electronMain() {
  const { app, BrowserWindow } = electron;
  const webm = require(path.join(__dirname, '..', '..', 'src', 'shared', 'webm.js'));
  const seconds = argSeconds(process.argv);
  const report = (ok, detail) => {
    try { fs.writeFileSync(RESULT, JSON.stringify({ ok, detail })); } catch { /* the exit code says it */ }
    app.exit(ok ? 0 : 1);
  };
  if (!seconds) { report(false, SECONDS_SAY); return; }

  // A profile of its own, of caches only, out of the user's.
  app.setPath('userData', path.join(os.tmpdir(), 'occlara-recording-fixture-profile'));
  app.on('window-all-closed', () => { /* the run decides when to quit */ });
  process.on('uncaughtException', (e) => report(false, String((e && e.stack) || e)));
  process.on('unhandledRejection', (e) => report(false, String((e && e.stack) || e)));

  app.whenReady().then(async () => {
    const win = new BrowserWindow({
      show: false, width: CFG.width, height: CFG.height, skipTaskbar: true, focusable: false,
      webPreferences: { backgroundThrottling: false, contextIsolation: true, nodeIntegration: false, sandbox: true },
    });
    await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent('<!doctype html><meta charset="utf-8"><body style="margin:0;background:#000"></body>'));
    const cfg = Object.assign({}, CFG, { seconds });
    const got = await win.webContents.executeJavaScript('(' + String(recordCanvas) + ')(' + JSON.stringify(cfg) + ')', true);
    win.destroy();

    const parts = got.chunks.map((c) => Buffer.from(c.base64, 'base64'));
    const bytes = Buffer.concat(parts);
    // Read as the test will, before anything is written over the old fixture.
    const reader = webm.createReader();
    for (const p of parts) reader.push(p);
    reader.end();
    const problems = [];
    if (reader.error) problems.push('webm.js refused it: ' + reader.error);
    if (reader.clusters.length < 10) problems.push('only ' + reader.clusters.length + ' Clusters in ' + seconds + ' s, and the tests cut into the tenth');
    const notKey = reader.clusters.filter((c) => c.keyframe !== true).map((c) => c.index);
    if (notKey.length) problems.push('Clusters ' + notKey.join(', ') + ' do not open on a keyframe');
    if (parts.some((p, i) => p.length !== got.chunks[i].size)) problems.push('a chunk decoded to a size other than its Blob\'s');
    if (problems.length) { report(false, problems.join('; ')); return; }

    const frames = reader.clusters.reduce((n, c) => n + c.frames, 0);
    const last = reader.clusters[reader.clusters.length - 1];
    const json = {
      what: 'A recording of a generated 640x360 canvas, never a screen, written by Chromium\'s own MediaRecorder for test:webm and check:webmplay.',
      made: 'node scripts/fixtures/make-recording-fixture.js --seconds ' + seconds,
      electron: process.versions.electron,
      chromium: process.versions.chrome,
      asked: {
        mimeType: got.mimeAsked, width: CFG.width, height: CFG.height, fps: CFG.fps,
        videoBitsPerSecond: CFG.videoBitsPerSecond, videoKeyFrameIntervalDuration: CFG.videoKeyFrameIntervalDuration,
        timesliceMs: CFG.timesliceMs, seconds,
      },
      recorder: { mimeTypeAtStart: got.mimeAtStart, mimeTypeAfterStop: got.mimeAfterStop },
      read: { docType: reader.docType, codec: reader.video && reader.video.codec, clusters: reader.clusters.length, frames, lastFrameMs: last.last, drawn: got.drawn },
      code: Object.assign({ means: 'milliseconds since the recorder started, in binary, most significant bit first, white for a 1', x: 0 }, CFG.code),
      bytes: bytes.length,
      sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
      chunks: got.chunks.map((c) => ({ size: c.size, atMs: c.atMs, timecode: Math.round(c.timecode) })),
    };
    fs.writeFileSync(OUT_MKV, bytes);
    fs.writeFileSync(OUT_JSON, JSON.stringify(json, null, 2) + '\n');
    report(true, bytes.length + ' bytes in ' + got.chunks.length + ' chunks, ' + reader.clusters.length + ' Clusters, ' + frames + ' frames ('
      + Math.round(frames / ((last.last + 1000 / CFG.fps) / 1000)) + ' a second), recorded as ' + got.mimeAfterStop);
  }).catch((e) => report(false, String((e && e.stack) || e)));
}

// ---------------------------------------------------------------------------
// Under node: relaunch under Electron, then say what it wrote
// ---------------------------------------------------------------------------

function launch() {
  if (!argSeconds(process.argv)) { console.error(SECONDS_SAY); process.exit(2); }
  try { fs.unlinkSync(RESULT); } catch { /* nothing left from a last run */ }
  const env = Object.assign({}, process.env);
  delete env.ELECTRON_RUN_AS_NODE;
  const r = spawnSync(electron, [__filename].concat(process.argv.slice(2)), { env, stdio: ['ignore', 'ignore', 'inherit'], timeout: 120000 });
  let rec = null;
  try { rec = JSON.parse(fs.readFileSync(RESULT, 'utf8')); } catch { /* said below */ }
  if (!rec) { console.error('FAIL  the recording wrote no result (exit ' + r.status + ')'); process.exit(1); }
  console.log((rec.ok ? 'PASS  wrote ' + path.relative(process.cwd(), OUT_MKV) + ': ' : 'FAIL  ') + rec.detail);
  process.exit(rec.ok ? 0 : 1);
}

if (typeof electron === 'string') launch();
else electronMain();
