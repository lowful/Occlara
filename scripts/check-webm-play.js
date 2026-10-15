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
 * AND THE REVIEW'S CLIP PLAYER (8.4.4) on the clip a review keeps of it, in a
 * page of its own: every frame decoded by WebCodecs and told by its time
 * code, then the player's own controls (a step before it ever played, the
 * timeline, ten frame steps forward and back across a dropped frame and the
 * last frame before a keyframe, comma and full stop, the death, the start,
 * and at the last frame a step, a second and the timeline's end again), each
 * landing judged by the picture shown against the decoder's frame at that
 * index. Stepping to frames' starts, this is where frame 30 was lost, and
 * seeking again to where the last frame stood, where the clip looped to 0.
 * Then the same clip with a capture stall put in it, stepped frame by frame
 * across the stall with each step checked against the frame shown, where a
 * step inside the last frames before it showed the frame before.
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
  console.log('\nPASS: all ' + rec.lines.length + ' playback checks passed, every clip loads, knows its length, seeks and shows its moment, and the review\'s player steps onto the frame the decoder shows at each index');
  process.exit(0);
}

// ── Child: under Electron ──────────────────────────────────────────────────
const { app, BrowserWindow } = require('electron');
const webm = require(path.join(REPO, 'src', 'shared', 'webm.js'));
const clipFrames = require(path.join(REPO, 'src', 'shared', 'clip-frames.js'));
const ClipTime = require(path.join(REPO, 'src', 'renderer', 'review', 'clip-time.js'));

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

/**
 * BESIDE A CAPTURE STALL (8.4.4): the fixture clip with every Cluster from the
 * recording's fifth on put STALL_MS later, a stall in front of a keyframe as
 * a capture that hung leaves one. Paused, Chromium shows the first frame whose
 * end by its own estimate, an average that takes in the frames decoded ahead,
 * reaches the time asked for, so a step inside one of the last frames before
 * the stall showed the frame before it. The player checks the frame shown
 * against the one asked for (requestVideoFrameCallback) and seeks again. Each
 * step near the stall is judged by its time code against the decoder's frame
 * at that index, with the check and, to say the case is real, without it.
 */
async function stallSteps(job) {
  const fromB64 = (s) => { const bin = atob(s); const out = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i); return out; };
  // eslint-disable-next-line no-eval
  if (!window.ClipPlayer) for (const src of job.sources) (0, eval)(src);
  const canvas = document.createElement('canvas');
  canvas.width = job.width;
  canvas.height = job.height;
  const g = canvas.getContext('2d', { willReadFrequently: true });
  const codeOf = (img) => {
    g.fillStyle = '#000';
    g.fillRect(0, 0, job.width, job.height);
    g.drawImage(img, 0, 0, job.width, job.height);
    const px = g.getImageData(0, 0, job.width, job.height).data;
    const lum = (x0, y0, w, h) => {
      let sum = 0;
      for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) { const i = (y * job.width + x) * 4; sum += 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2]; }
      return sum / (w * h);
    };
    const c = job.code;
    let code = 0;
    for (let i = 0; i < c.bits; i++) code = code * 2 + (lum(c.x + i * c.size + c.size / 4, c.y + c.size / 4, c.size / 2, c.size / 2) > 128 ? 1 : 0);
    return code;
  };
  const codes = [];
  let failed = null;
  const decoder = new VideoDecoder({
    output: (frame) => { try { codes.push(codeOf(frame)); } finally { frame.close(); } },
    error: (e) => { failed = e; },
  });
  decoder.configure({ codec: job.codec, codedWidth: job.width, codedHeight: job.height, optimizeForLatency: true });
  for (const c of job.chunks) decoder.decode(new EncodedVideoChunk({ type: c.key ? 'key' : 'delta', timestamp: c.ts, data: fromB64(c.data) }));
  await decoder.flush();
  decoder.close();
  if (failed || codes.length !== job.times.length) return { error: `decoded ${codes.length} of ${job.times.length} frames${failed ? ': ' + failed.message : ''}` };
  const url = URL.createObjectURL(new Blob([fromB64(job.clip)], { type: job.mime }));
  const walk = async (checked) => {
    const keep = HTMLVideoElement.prototype.requestVideoFrameCallback;
    if (!checked) delete HTMLVideoElement.prototype.requestVideoFrameCallback;
    let player = null;
    try {
      player = window.ClipPlayer.create({ url, label: 'The clip of round 2', frames: { times: job.times, end: job.end }, death: job.death, stills: [] });
    } finally {
      if (!checked) HTMLVideoElement.prototype.requestVideoFrameCallback = keep;
    }
    document.body.appendChild(player.el);
    const v = player.video;
    const fig = player.el;
    const range = fig.querySelector('.cp-seek');
    const btn = (act) => fig.querySelector('.cp-btn[data-act="' + act + '"]');
    let seeks = 0;
    let lastSeek = 0;
    v.addEventListener('seeking', () => { seeks += 1; lastSeek = performance.now(); });
    // A move, and the frame on screen once its seeks are done: one came, and none for 250 ms.
    const settled = async (fn) => {
      const before = seeks;
      fn();
      const until = performance.now() + 5000;
      while (performance.now() < until) {
        await new Promise((r) => setTimeout(r, 25));
        if (seeks > before && !v.seeking && performance.now() - lastSeek > 250) break;
      }
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      return { code: codeOf(v), seeks: seeks - before, text: fig.querySelector('.cp-time').textContent };
    };
    const out = [];
    await settled(() => { range.value = String(Math.round(job.times[job.from] + 1)); range.dispatchEvent(new Event('input', { bubbles: true })); });
    for (let k = job.from + 1; k <= job.to; k++) out.push({ k, ...(await settled(() => btn('forwardFrame').click())) });
    for (let k = job.to - 1; k >= job.from; k--) out.push({ k, ...(await settled(() => btn('backFrame').click())) });
    window.ClipPlayer.release(fig);
    fig.remove();
    return out.map((x) => ({ k: x.k, right: x.code === codes[x.k], shown: codes.indexOf(x.code), seeks: x.seeks, text: x.text }));
  };
  const checked = await walk(true);
  const blind = await walk(false);
  URL.revokeObjectURL(url);
  return { checked, blind };
}

/**
 * THE REVIEW'S CLIP PLAYER (8.4.4), on a clip of the fixture, in this page:
 * its own two files loaded as the review page loads them, a player made for
 * the clip as a blob (same origin, so the frame it shows can be read), and
 * every frame of the clip decoded by WebCodecs to say which frame is which by
 * its time code. Each move is made with the player's own controls, and the
 * frame it shows once the move lands is read off the picture.
 */
async function playerSteps(job) {
  const fromB64 = (s) => { const bin = atob(s); const out = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i); return out; };
  // eslint-disable-next-line no-eval
  for (const src of job.sources) (0, eval)(src);
  const canvas = document.createElement('canvas');
  canvas.width = job.width;
  canvas.height = job.height;
  const g = canvas.getContext('2d', { willReadFrequently: true });
  const codeOf = (img) => {
    g.fillStyle = '#000';
    g.fillRect(0, 0, job.width, job.height);
    g.drawImage(img, 0, 0, job.width, job.height);
    const px = g.getImageData(0, 0, job.width, job.height).data;
    const lum = (x0, y0, w, h) => {
      let sum = 0;
      for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) { const i = (y * job.width + x) * 4; sum += 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2]; }
      return sum / (w * h);
    };
    const c = job.code;
    let code = 0;
    for (let i = 0; i < c.bits; i++) code = code * 2 + (lum(c.x + i * c.size + c.size / 4, c.y + c.size / 4, c.size / 2, c.size / 2) > 128 ? 1 : 0);
    return code;
  };
  // Every frame of the clip as the decoder outputs it, in order.
  const codes = [];
  let failed = null;
  const decoder = new VideoDecoder({
    output: (frame) => { try { codes.push(codeOf(frame)); } finally { frame.close(); } },
    error: (e) => { failed = e; },
  });
  decoder.configure({ codec: job.codec, codedWidth: job.width, codedHeight: job.height, optimizeForLatency: true });
  for (const c of job.chunks) decoder.decode(new EncodedVideoChunk({ type: c.key ? 'key' : 'delta', timestamp: c.ts, data: fromB64(c.data) }));
  await decoder.flush();
  decoder.close();
  if (failed || codes.length !== job.times.length) return { error: `decoded ${codes.length} of ${job.times.length} frames${failed ? ': ' + failed.message : ''}` };
  const url = URL.createObjectURL(new Blob([fromB64(job.clip)], { type: job.mime }));
  const player = window.ClipPlayer.create({ url, label: 'The clip of round 2', frames: { times: job.times, end: job.end }, death: job.death, stills: [] });
  document.body.appendChild(player.el);
  const v = player.video;
  const fig = player.el;
  const range = fig.querySelector('.cp-seek');
  const btn = (act) => fig.querySelector('.cp-btn[data-act="' + act + '"]');
  const wait = (name, ms) => new Promise((res) => {
    let t = null;
    const on = () => { clearTimeout(t); v.removeEventListener(name, on); res(true); };
    v.addEventListener(name, on);
    t = setTimeout(() => { v.removeEventListener(name, on); res(false); }, ms);
  });
  // A move, and the frame shown once it landed: its time code, judged against
  // the decoder's frame at each index (a frame the canvas never redrew carries
  // the picture of the one before, so it is judged by its picture, not its
  // index), and the frame the code names first, for the report.
  const shown = async (fn) => {
    const s = wait('seeked', 8000);
    fn();
    const seeked = await s;
    if (seeked && v.readyState < 2) await wait('canplay', 2000);
    await new Promise((r) => setTimeout(r, 30));
    const code = codeOf(v);
    return { seeked, frame: codes.indexOf(code), code, t: v.currentTime, text: fig.querySelector('.cp-time').textContent };
  };
  const key = (k) => fig.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));
  const out = { codes, unique: new Set(codes).size, preload: v.getAttribute('preload') };
  out.first = await shown(() => btn('forwardFrame').click());
  out.preloaded = v.getAttribute('preload');
  out.timeline = await shown(() => { range.value = String(Math.round(job.times[job.from] + 10)); range.dispatchEvent(new Event('input', { bubbles: true })); });
  out.forward = [];
  for (let i = 0; i < job.steps; i++) out.forward.push(await shown(() => btn('forwardFrame').click()));
  out.back = [];
  for (let i = 0; i < job.steps; i++) out.back.push(await shown(() => btn('backFrame').click()));
  out.keyForward = [];
  for (let i = 0; i < 3; i++) out.keyForward.push(await shown(() => key('.')));
  out.keyBack = [];
  for (let i = 0; i < 3; i++) out.keyBack.push(await shown(() => key(',')));
  out.death = await shown(() => { range.value = String(Math.round(job.death)); range.dispatchEvent(new Event('input', { bubbles: true })); });
  out.start = await shown(() => btn('start').click());
  // AT THE LAST FRAME: a step on, a second on, the timeline at its end again
  // and full stop. Chromium answers a seek to where a clip already stands
  // there by looping it back to its start, so the player sets none.
  const stay = async (fn) => {
    fn();
    await new Promise((r) => setTimeout(r, 700));
    return { code: codeOf(v), t: v.currentTime, text: fig.querySelector('.cp-time').textContent };
  };
  out.end = await shown(() => { range.value = range.max; range.dispatchEvent(new Event('input', { bubbles: true })); });
  out.endStep = await stay(() => btn('forwardFrame').click());
  out.endSecond = await stay(() => btn('forwardSecond').click());
  out.endAgain = await stay(() => { range.value = range.max; range.dispatchEvent(new Event('input', { bubbles: true })); });
  out.endKey = await stay(() => key('.'));
  window.ClipPlayer.release(document.body);
  URL.revokeObjectURL(url);
  return out;
}

app.setPath('userData', path.join(os.tmpdir(), 'occlara-webm-play-profile'));
// A window under another reads as hidden and paints nothing: the stall's walk
// needs its frames presented (stallSteps).
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');
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

  // The review's clip player on the clip a review keeps of this recording
  // (check:clips seeds the same one): 2 to 8 s, 211 frames that came unevenly.
  const stepBytes = webm.cutClip({ init: reader.init, clusters: C, from: 2000, to: 8000 });
  const stepClip = clipFrames.indexClip(stepBytes);
  const stepTimes = stepClip.frames.map((f) => f.ms);
  const decodeAll = clipFrames.decodeJob(stepClip, stepTimes.map((t) => t + 1));
  // From frame 23, ten steps on: across the dropped frame after 26, the last
  // frame of the first Cluster (30) and the keyframe that opens the next (31).
  const STEP_FROM = 23;
  const STEP_N = 10;
  // The death in a frame whose picture is its own: the canvas was not redrawn
  // for frames 1, 90, 120, 150, 180 and 210, each the picture before it.
  const STEP_DEATH = stepTimes[140] + 12;
  const stepJob = {
    mime, width: meta.asked.width, height: meta.asked.height, code: meta.code, codec: decodeAll.codec,
    chunks: decodeAll.chunks.map((c) => ({ ts: c.ts, key: c.key, data: Buffer.from(c.data).toString('base64') })),
    clip: stepBytes.toString('base64'), times: stepTimes, end: stepClip.endMs, from: STEP_FROM, steps: STEP_N, death: STEP_DEATH,
    sources: ['clip-time.js', 'clip-player.js'].map((f) => fs.readFileSync(path.join(REPO, 'src', 'renderer', 'review', f), 'utf8')),
  };
  win.destroy();
  // In a page of its own from a file, as the app's frames page is: WebCodecs
  // is for a secure context, which a data: page is not.
  const stepPage = path.join(os.tmpdir(), 'occlara-webm-play-player.html');
  fs.writeFileSync(stepPage, '<!doctype html><meta charset="utf-8"><body style="margin:0;background:#000;width:640px"></body>');
  const stepWin = new BrowserWindow({
    show: false, width: 680, height: 560, skipTaskbar: true, focusable: false,
    webPreferences: { backgroundThrottling: false, contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  await stepWin.loadFile(stepPage);
  const steps = await stepWin.webContents.executeJavaScript('(' + String(playerSteps) + ')(' + JSON.stringify(stepJob) + ')', true);
  // The same clip with a capture stall put in front of the recording's fifth Cluster.
  const STALL_MS = 300;
  const stalled = C.map((c, i) => (i >= 4 ? { ...c, timecode: c.timecode + STALL_MS, first: c.first + STALL_MS, last: c.last + STALL_MS } : c));
  const stallBytes = webm.cutClip({ init: reader.init, clusters: stalled, from: 2000, to: 8000 + STALL_MS });
  const stallClip = clipFrames.indexClip(stallBytes);
  const stallTimes = stallClip.frames.map((f) => f.ms);
  const stallAt = stallTimes.findIndex((t, i) => i + 1 < stallTimes.length && stallTimes[i + 1] - t > 200);
  const stallDecode = clipFrames.decodeJob(stallClip, stallTimes.map((t) => t + 1));
  const stallJob = {
    mime, width: meta.asked.width, height: meta.asked.height, code: meta.code, codec: stallDecode.codec,
    chunks: stallDecode.chunks.map((c) => ({ ts: c.ts, key: c.key, data: Buffer.from(c.data).toString('base64') })),
    clip: stallBytes.toString('base64'), times: stallTimes, end: stallClip.endMs, from: stallAt - 8, to: stallAt + 4,
    death: stallTimes[140] + 12, sources: stepJob.sources,
  };
  stepWin.destroy();
  // ON SCREEN: the player reads the frame shown off the compositor, and a
  // window never shown presents no frame, so the check could not engage. Shown
  // without taking the focus, the boot lock keeping every other check's
  // window off it, and nothing occludes it (CalculateNativeWinOcclusion off).
  const stallWin = new BrowserWindow({
    show: false, width: 680, height: 560, x: 40, y: 40, skipTaskbar: true, focusable: false,
    webPreferences: { backgroundThrottling: false, contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  await stallWin.loadFile(stepPage);
  stallWin.showInactive();
  const stall = stallAt > 20 ? await stallWin.webContents.executeJavaScript('(' + String(stallSteps) + ')(' + JSON.stringify(stallJob) + ')', true) : null;
  stallWin.destroy();

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

  // ── The review's clip player: a step lands on the frame the decoder shows at that index ──
  const st = steps || {};
  const codes = Array.isArray(st.codes) ? st.codes : [];
  // Shown as frame k: its picture is the decoder's frame k.
  const isFrame = (x, k) => !!x && x.seeked && typeof x.code === 'number' && x.code === codes[k];
  const all = (list, want) => Array.isArray(list) && list.length === want.length && list.every((x, i) => isFrame(x, want[i]));
  const named = (list) => JSON.stringify((Array.isArray(list) ? list : []).map((x) => x.frame));
  const range = (a, n, d) => Array.from({ length: n }, (_v, i) => a + d * i);
  const repeats = codes.map((c, i) => (i > 0 && c === codes[i - 1] ? i : -1)).filter((i) => i >= 0);
  ok(!st.error && codes.length === stepTimes.length && st.unique >= stepTimes.length - 8,
    `the player's clip, every one of its ${stepTimes.length} frames decoded by WebCodecs and told by its time code (${st.unique} pictures: `
      + `frames ${repeats.join(', ')} repeat the one before, the canvas not redrawn)${st.error ? ': ' + st.error : ''}`);
  ok(st.preload === 'none' && isFrame(st.first, 1) && st.preloaded === 'auto',
    `a step before the clip ever played loads it and shows its frame 1 (${st.first && st.first.frame})`);
  ok(isFrame(st.timeline, STEP_FROM), `the timeline moved shows the frame there: ${st.timeline && st.timeline.frame}, ${STEP_FROM} asked`);
  const fwd = range(STEP_FROM + 1, STEP_N, 1);
  ok(all(st.forward, fwd),
    `a frame step forward shows the decoder's next frame every time, across a dropped frame and the last frame before a keyframe: ${named(st.forward)}, ${JSON.stringify(fwd)} wanted`);
  const back = range(STEP_FROM + STEP_N - 1, STEP_N, -1);
  ok(all(st.back, back), `and a step back the one before it, every time: ${named(st.back)}, ${JSON.stringify(back)} wanted`);
  ok(all(st.keyForward, range(STEP_FROM + 1, 3, 1)) && all(st.keyBack, range(STEP_FROM + 2, 3, -1)),
    `full stop and comma do the same: ${named(st.keyForward)}, then ${named(st.keyBack)}`);
  const deathFrame = (() => { let k = 0; while (k + 1 < stepTimes.length && stepTimes[k + 1] <= STEP_DEATH) k++; return k; })();
  ok(isFrame(st.death, deathFrame) && st.death.text === 'At the death' && !repeats.includes(deathFrame) && !repeats.includes(deathFrame + 1),
    `the death's frame shown says so: frame ${st.death && st.death.frame} ("${st.death && st.death.text}"), ${deathFrame} wanted`);
  ok(isFrame(st.start, 0), `back to the start shows the first frame (${st.start && st.start.frame})`);
  // ── Beside a capture stall: each step checked against the frame shown ──
  const ss = stall || {};
  const sTimes = ClipTime.framesOf({ times: stallTimes, end: stallClip.endMs });
  const wordsFor = (k) => ClipTime.timeWords(ClipTime.insideOf(sTimes, k), { death: stallJob.death, frames: sTimes }).text;
  const sChecked = Array.isArray(ss.checked) ? ss.checked : [];
  const sBlind = Array.isArray(ss.blind) ? ss.blind : [];
  const sWrong = sChecked.filter((x) => !x.right || x.text !== wordsFor(x.k));
  const bWrong = sBlind.filter((x) => !x.right);
  ok(stallAt > 20 && !ss.error && sChecked.length === 2 * (stallJob.to - stallJob.from) && !sWrong.length,
    `beside a capture stall of ${STALL_MS} ms after frame ${stallAt}, every step from frame ${stallJob.from} to ${stallJob.to} and back shows the decoder's frame at that index and says its time`
      + ` (${sChecked.filter((x) => x.seeks > 1).length} needed a second seek)${sWrong.length ? ': wrong ' + sWrong.map((x) => `${x.k}>${x.shown} "${x.text}"`).join(', ') : ''}${ss.error ? ': ' + ss.error : ''};`
      + ` unchecked against the frame shown, ${bWrong.length} of them showed another${bWrong.length ? ` (${bWrong.map((x) => `${x.k}>${x.shown}`).join(', ')})` : ''}`);
  const lastFrame = stepTimes.length - 1;
  const stays = [st.endStep, st.endSecond, st.endAgain, st.endKey];
  ok(isFrame(st.end, lastFrame) && stays.every((x) => !!x && x.code === codes[lastFrame] && x.t === st.end.t),
    `at the last frame a step on, a second on, the timeline at its end again and full stop all keep it there, never back at the start: `
      + `${stays.map((x) => (x ? `${x.t.toFixed(3)} s` : '?')).join(', ')} (its last frame at ${st.end && typeof st.end.t === 'number' ? st.end.t.toFixed(3) : '?'} s)`);
  report(null);
}).catch((e) => report('the check failed: ' + String((e && e.stack) || e)));
