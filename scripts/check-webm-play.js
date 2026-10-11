'use strict';

/**
 * A clip cut by webm.js plays and seeks in Chromium's own <video>.
 *
 * test:webm holds the bytes: Timecodes rebased, blocks copied, a Duration,
 * Cues. Only a player can say whether those bytes are a clip a player takes,
 * so this boots Electron, cuts three clips out of the real recording in
 * scripts/fixtures (a generated canvas, never a screen: see
 * make-recording-fixture.js) and plays each in a hidden <video> as the type
 * parseInit names for it, video/x-matroska. For each:
 *
 *   it loads, with no media error
 *   its duration is finite (cut without a Duration it reads Infinity) and right
 *     to within half a frame of where its last frame ends: where the
 *     recording's next frame begins, read off the recording's own blocks
 *   seeking to its middle fires seeked
 *   the frame drawn there is not black, and it is THE frame: the canvas spells
 *     the milliseconds since the recording began in squares along its foot, so
 *     the clip's frame is read and held to the source recording's frame at the
 *     same moment, seeked in a second <video>, pixel for pixel
 *
 * A clip from the very start, one from the middle and one to the very end. The
 * seek lands halfway between two frames, so which frame shows is never a
 * rounding question.
 *
 * WHAT A PLAYER DOES NOT SHOW. Played from a blob, Chromium seeks these clips
 * with the Cues off by a byte or missing, or their Clusters of unknown size,
 * and plays them typed video/webm too, sniffing the container: each was tried,
 * and every line about playing them stayed green. So the Cues and the sizes
 * are held by test:webm, and whether a served type is held to
 * video/x-matroska is for whatever serves the clips to check.
 *
 * Results travel through a FILE, not stdout: an Electron main process on
 * Windows does not reliably flush a piped stdout.
 *
 * Run: npm run check:webmplay
 */

const path = require('path');
const fs = require('fs');
const os = require('os');

const REPO = path.join(__dirname, '..');
const FIXTURE = path.join(__dirname, 'fixtures', 'recording-canvas.mkv');
const META_FILE = path.join(__dirname, 'fixtures', 'recording-canvas.json');
const OUT = path.join(os.tmpdir(), 'occlara-webm-play-check.json');
// The type an H.264 clip is played as: parseInit names it, and canPlayType
// answers "probably" to it and nothing to avc1 in video/webm.
const MIME = 'video/x-matroska';
const BLACK = 16;             // a mean brightness under 16 of 255 is a black frame

// ── Parent: run the child under Electron and report ────────────────────────
if (!process.versions.electron) {
  const { spawnSync } = require('child_process');
  const electron = require('electron');
  try { fs.unlinkSync(OUT); } catch { /* nothing left from a last run */ }
  const env = Object.assign({}, process.env);
  // This shell exports ELECTRON_RUN_AS_NODE=1, which boots Electron as plain node.
  delete env.ELECTRON_RUN_AS_NODE;
  const r = spawnSync(electron, [__filename], { env, timeout: 90000 });
  let rec = null;
  try { rec = JSON.parse(fs.readFileSync(OUT, 'utf8')); } catch { /* reported below */ }
  if (!rec) {
    console.error('FAIL: the check wrote no result (exit ' + r.status + (r.error ? ', ' + r.error.message : '') + ')');
    process.exit(1);
  }
  for (const line of rec.lines) console.log((line.ok ? 'ok    ' : 'FAIL  ') + line.what);
  if (rec.fatal) console.log('FAIL  ' + rec.fatal);
  const bad = rec.lines.filter((l) => !l.ok).length + (rec.fatal ? 1 : 0);
  if (bad || r.status !== 0) { console.error('\nFAIL: ' + bad + ' of ' + rec.lines.length + ' playback checks failed'); process.exit(1); }
  console.log('\nPASS: all ' + rec.lines.length + ' playback checks passed, every clip loads, knows its length, seeks and shows its moment');
  process.exit(0);
}

// ── Child: under Electron ──────────────────────────────────────────────────
const { app, BrowserWindow } = require('electron');
const webm = require(path.join(REPO, 'src', 'shared', 'webm.js'));

const lines = [];
let reported = false;
function report(fatal) {
  if (reported) return;
  reported = true;
  try { fs.writeFileSync(OUT, JSON.stringify({ lines, fatal: fatal || null })); } catch { /* the exit code still says it */ }
  app.exit(fatal || lines.some((l) => !l.ok) ? 1 : 0);
}
const ok = (cond, what) => { lines.push({ ok: !!cond, what }); };

// Every frame's time in ms, off the blocks: of a clip as cutClip writes it, or
// of the recording as Chromium did, a Segment and Clusters of unknown size, an
// unknown size Cluster ending where the next begins. One byte track numbers.
// Written here, apart from webm.js, so the end a clip's duration is held to is
// not webm.js's own sum.
const CLUSTER = 0x1F43B675;
function frameTimes(buf) {
  const vlen = (x) => { let n = 1; while (n <= 8 && !(x & (0x100 >> n))) n += 1; return n; };
  const head = (p) => {
    const il = vlen(buf[p]);
    let id = 0;
    for (let i = 0; i < il; i++) id = id * 256 + buf[p + i];
    const sl = vlen(buf[p + il]);
    const top = 0xFF >> sl;
    let size = buf[p + il] & top;
    let unknown = size === top;
    for (let i = 1; i < sl; i++) { size = size * 256 + buf[p + il + i]; if (buf[p + il + i] !== 0xFF) unknown = false; }
    return { id, data: p + il + sl, end: unknown ? null : p + il + sl + size };
  };
  const times = [];
  const seg = head(head(0).end);
  const segEnd = seg.end === null ? buf.length : seg.end;
  for (let p = seg.data; p < segEnd;) {
    const h = head(p);
    if (h.id !== CLUSTER) { p = h.end; continue; }
    const stop = h.end === null ? segEnd : h.end;
    let tc = 0;
    let q = h.data;
    while (q < stop) {
      const k = head(q);
      if (k.id === CLUSTER) break;
      if (k.id === 0xE7) { tc = 0; for (let i = k.data; i < k.end; i++) tc = tc * 256 + buf[i]; }
      if (k.id === 0xA3) times.push(tc + buf.readInt16BE(k.data + 1));
      q = k.end;
    }
    p = q;
  }
  return times;
}

// The page: serialized into executeJavaScript, so it uses only the browser.
async function playAll(job) {
  const fromB64 = (s) => { const bin = atob(s); const out = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i); return out; };
  const canvas = document.createElement('canvas');
  canvas.width = job.width;
  canvas.height = job.height;
  const g = canvas.getContext('2d', { willReadFrequently: true });
  const wait = (v, name, ms) => new Promise((resolve) => {
    const t0 = performance.now();
    let timer = null;
    const done = (fired, why) => {
      v.removeEventListener(name, onOk);
      v.removeEventListener('error', onErr);
      clearTimeout(timer);
      resolve({ fired, ms: Math.round(performance.now() - t0), why: why || null });
    };
    const onOk = () => done(true);
    const onErr = () => done(false, v.error ? 'media error ' + v.error.code + ': ' + v.error.message : 'an error event');
    v.addEventListener(name, onOk);
    v.addEventListener('error', onErr);
    timer = setTimeout(() => done(false, 'nothing within ' + ms + ' ms'), ms);
  });
  async function open(b64) {
    const v = document.createElement('video');
    v.muted = true;
    v.preload = 'auto';
    document.body.appendChild(v);
    const url = URL.createObjectURL(new Blob([fromB64(b64)], { type: job.mime }));
    const meta = wait(v, 'loadedmetadata', 8000);
    v.src = url;
    const m = await meta;
    return { v, url, metadata: m };
  }
  function close(x) {
    x.v.pause();
    x.v.removeAttribute('src');
    x.v.load();
    x.v.remove();
    URL.revokeObjectURL(x.url);
  }
  // Seeks, then draws the frame: its mean brightness, the time code in the
  // squares along its foot, and its pixels to compare.
  async function frameAt(v, t) {
    const s = wait(v, 'seeked', 5000);
    v.currentTime = t;
    const seeked = await s;
    if (seeked.fired && v.readyState < 2) await wait(v, 'canplay', 2000);
    const out = { seeked, readyState: v.readyState, currentTime: v.currentTime, luma: null, code: null, px: null };
    if (!seeked.fired || v.readyState < 2) return out;
    g.drawImage(v, 0, 0, job.width, job.height);
    const px = g.getImageData(0, 0, job.width, job.height).data;
    const lum = (x0, y0, w, h) => {
      let sum = 0;
      for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) { const i = (y * job.width + x) * 4; sum += 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2]; }
      return sum / (w * h);
    };
    out.luma = Math.round(lum(0, 0, job.width, job.height) * 10) / 10;
    const c = job.code;
    let code = 0;
    for (let i = 0; i < c.bits; i++) code = code * 2 + (lum(c.x + i * c.size + c.size / 4, c.y + c.size / 4, c.size / 2, c.size / 2) > 128 ? 1 : 0);
    out.code = code;
    out.px = px;
    return out;
  }
  const results = [];
  const source = await open(job.source);
  for (const clip of job.clips) {
    const res = { label: clip.label };
    const x = await open(clip.b64);
    res.metadata = x.metadata;
    res.duration = Number.isFinite(x.v.duration) ? x.v.duration : String(x.v.duration);
    res.seekable = [];
    for (let i = 0; i < x.v.seekable.length; i++) res.seekable.push([x.v.seekable.start(i), x.v.seekable.end(i)]);
    res.mediaError = x.v.error ? x.v.error.code + ' ' + x.v.error.message : null;
    if (x.metadata.fired) {
      const f = await frameAt(x.v, clip.at);
      const s = source.metadata.fired ? await frameAt(source.v, clip.sourceAt) : null;
      res.seeked = f.seeked;
      res.readyState = f.readyState;
      res.luma = f.luma;
      res.code = f.code;
      res.sourceCode = s ? s.code : null;
      res.sourceSeeked = s ? s.seeked : null;
      if (f.px && s && s.px) {
        let d = 0;
        for (let i = 0; i < f.px.length; i += 4) d += Math.abs(f.px[i] - s.px[i]) + Math.abs(f.px[i + 1] - s.px[i + 1]) + Math.abs(f.px[i + 2] - s.px[i + 2]);
        res.meanDiff = Math.round((d / (f.px.length / 4 * 3)) * 100) / 100;
      }
    }
    close(x);
    results.push(res);
  }
  close(source);
  return { canPlay: document.createElement('video').canPlayType(job.mime + '; codecs="avc1.42C01F"'), results };
}

app.setPath('userData', path.join(os.tmpdir(), 'occlara-webm-play-profile'));
app.on('window-all-closed', () => { /* report() decides when to quit */ });
process.on('uncaughtException', (e) => report('the check threw: ' + String((e && e.stack) || e)));
process.on('unhandledRejection', (e) => report('the check threw: ' + String((e && e.stack) || e)));

app.whenReady().then(async () => {
  const meta = JSON.parse(fs.readFileSync(META_FILE, 'utf8'));
  const reader = webm.indexFile(FIXTURE, { keepBytes: true });
  if (reader.error) return report('webm.js refused the fixture: ' + reader.error);
  const C = reader.clusters;
  const last = C[C.length - 1];
  const head = webm.parseInit(reader.init);
  const mime = head ? head.mime : null;
  ok(mime === MIME, `parseInit names the type the clips are played as: ${mime}`);
  const wanted = [
    { label: 'the very start', from: 0, to: C[2].timecode + 300 },
    { label: 'the middle', from: C[4].timecode + 370, to: C[8].timecode + 274 },
    { label: 'the very end', from: last.timecode + 200, to: Infinity },
  ];
  const sourceTimes = frameTimes(fs.readFileSync(FIXTURE));
  const clips = [];
  for (const w of wanted) {
    const plan = webm.planClip(C, w.from, w.to);
    const bytes = webm.cutClip({ init: reader.init, clusters: C, from: w.from, to: w.to });
    if (!plan || !bytes) return report('no clip of ' + w.label + ' could be cut');
    const times = frameTimes(bytes);
    const frame = (times[times.length - 1] - times[0]) / (times.length - 1);
    // The clip's last frame lasts until the recording's next frame; after the
    // recording's last, a mean frame.
    const next = sourceTimes.find((t) => t > plan.start + times[times.length - 1]);
    const ends = next === undefined ? times[times.length - 1] + frame : next - plan.start;
    // Halfway between the two frames either side of the clip's middle.
    const mid = ends / 2;
    let k = 0;
    while (k + 2 < times.length && times[k + 1] <= mid) k += 1;
    const at = (times[k] + times[k + 1]) / 2;
    clips.push({
      label: w.label, b64: bytes.toString('base64'), at: at / 1000, sourceAt: (plan.start + at) / 1000,
      frames: times.length, frameMs: frame, ends, startsAt: plan.start, bytes: bytes.length, endsAtNext: next !== undefined,
    });
  }

  const win = new BrowserWindow({
    show: false, width: 640, height: 360, skipTaskbar: true, focusable: false,
    webPreferences: { backgroundThrottling: false, contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent('<!doctype html><meta charset="utf-8"><body style="margin:0;background:#000"></body>'));
  const job = {
    mime, width: meta.asked.width, height: meta.asked.height, code: meta.code,
    source: fs.readFileSync(FIXTURE).toString('base64'),
    clips: clips.map((c) => ({ label: c.label, b64: c.b64, at: c.at, sourceAt: c.sourceAt })),
  };
  const got = await win.webContents.executeJavaScript('(' + String(playAll) + ')(' + JSON.stringify(job) + ')', true);
  win.destroy();

  ok(got.canPlay === 'probably', `Chromium plays H.264 as ${mime}: canPlayType says "${got.canPlay}"`);
  const offsets = [];
  got.results.forEach((res, i) => {
    const c = clips[i];
    const name = `${c.label} (${c.bytes} bytes, ${c.frames} frames from ${c.startsAt} ms of the recording)`;
    ok(res.metadata && res.metadata.fired && !res.mediaError,
      `${name}: loads in a hidden <video> as ${mime}${res.metadata && res.metadata.fired ? ', metadata after ' + res.metadata.ms + ' ms' : ': ' + ((res.metadata && res.metadata.why) || res.mediaError)}`);
    const durMs = typeof res.duration === 'number' ? res.duration * 1000 : NaN;
    ok(Number.isFinite(durMs) && Math.abs(durMs - c.ends) <= c.frameMs / 2,
      `${c.label}: its duration is finite and right to within half a frame: ${res.duration} s against its last frame ending at ${(c.ends / 1000).toFixed(3)} s`
      + ` (${c.endsAtNext ? 'where the recording\'s next frame begins' : 'a mean frame after it, the recording\'s last'}; a frame is ${c.frameMs.toFixed(1)} ms)`);
    ok(res.seeked && res.seeked.fired,
      `${c.label}: seeking to its middle, ${c.at.toFixed(3)} s, fires seeked${res.seeked && res.seeked.fired ? ' after ' + res.seeked.ms + ' ms' : ': ' + (res.seeked && res.seeked.why)}`);
    ok(typeof res.luma === 'number' && res.luma >= BLACK, `${c.label}: the frame drawn there is not black (mean brightness ${res.luma} of 255)`);
    ok(typeof res.code === 'number' && res.code === res.sourceCode && typeof res.meanDiff === 'number' && res.meanDiff < 1,
      `${c.label}: and it is the recording's frame at ${(c.sourceAt).toFixed(3)} s: time code ${res.code} against the source's ${res.sourceCode}, pixels differing by ${res.meanDiff} of 255 on average`);
    if (typeof res.code === 'number') offsets.push(res.code - c.sourceAt * 1000);
  });
  // The time code is when the canvas drew the frame, so against the frame's
  // time in the recording it is a fixed lag, the same in every clip.
  const spread = offsets.length ? Math.max(...offsets) - Math.min(...offsets) : Infinity;
  ok(offsets.length === clips.length && spread <= 2 * Math.max(...clips.map((c) => c.frameMs)),
    `every clip shows the moment it was cut for: the drawn time less the recording's time is ${offsets.map((o) => Math.round(o)).join(', ')} ms, within two frames of each other`);
  report(null);
}).catch((e) => report('the check failed: ' + String((e && e.stack) || e)));
