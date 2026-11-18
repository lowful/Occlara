'use strict';

/**
 * IMPORT A RECORDING (8.12, docs/claude/import.md): a player's own video of a
 * Valorant match, read by the same engine as a live match and reviewed the same
 * way, marked as imported.
 *
 * NOTHING HERE TOUCHES THE LIVE SESSION. Its own engine with its loop timer
 * cleared, its own AI log folder, its own clips out of the file. Never the
 * global engine, state.isCoaching, the seal, the live status or the recorder.
 * A match being played pauses it (o.shouldPause), and it goes on afterwards.
 *
 * THE FILE STAYS ON THE PC. ffmpeg, a separate program bundled unmodified beside
 * the app, decodes it locally. As in a live match, only the frames that are read
 * and the stills of a death are sent. The review keeps the file's base name,
 * never its path, and no path ever reaches a window.
 *
 * Plain Node, everything from outside handed in, so test:importvideo runs it
 * with a fake server and a real ffmpeg.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { withClock } = require('../../shared/virtual-clock');
const clipFrames = require('../../shared/clip-frames');

const LIMITS = Object.freeze({
  MAX_SECONDS: 65 * 60,
  MIN_SECONDS: 60,
  MAX_BYTES: 8 * 1024 * 1024 * 1024,
  // About two reads a second, under the server's 150 a minute.
  MIN_SEND_GAP_MS: 500,
  MAX_SEND_GAP_MS: 4000,
  IN_FLIGHT: 4,
  READ_TIMEOUT_MS: 12000,
  READ_TRIES: 3,
  FAILURES_IN_A_ROW: 20,
  // How much of the video is read past a match's end, for the engine to take
  // back an end that was not one (match-end.js RESUME).
  CONFIRM_END_SECONDS: 120,
  // Fewer rounds than this is no match to review or to charge for.
  MIN_ROUNDS: 3,
  // More than this left unread after the first match is worth saying.
  REST_NOTE_SECONDS: 300,
  KEEP_FRAME_GAP_MS: 10000,
  KEEP_FRAMES: 1500,
  CUT_TIMEOUT_MS: 120000,
  // No frame and no reply for this long, while not paused: the file is gone.
  STALL_MS: 180000,
  // A match is only offered as this recording's when it began this close.
  NEAREST_MS: 30 * 60 * 1000,
});
const EXTENSIONS = Object.freeze(['mp4', 'mkv', 'mov', 'webm']);

const AI_LOG_DEATH_BEFORE = 35000;
const AI_LOG_DEATH_AFTER = 5000;
const AI_LOG_ROUND_MS = 10000;

// ── ffmpeg ────────────────────────────────────────────────────────────────────

/** Where ffmpeg is: beside the app when installed, the dev dependency in the repo. */
function ffmpegPath({ packaged, resourcesPath, env = process.env } = {}) {
  if (packaged) return path.join(resourcesPath, 'ffmpeg.exe');
  if (env.OCCLARA_FFMPEG) return env.OCCLARA_FFMPEG;
  try { return require('ffmpeg-static'); } catch { return null; }
}

function run(ffmpeg, args, { timeoutMs = 30000, spawnFn = spawn, low = false } = {}) {
  return new Promise((resolve, reject) => {
    let err = '';
    let done = false;
    const child = spawnFn(ffmpeg, args, { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
    if (low) { try { if (child.pid) os.setPriority(child.pid, os.constants.priority.PRIORITY_BELOW_NORMAL); } catch { /* normal, then */ } }
    const timer = setTimeout(() => { try { child.kill(); } catch {} finish(new Error('ffmpeg timed out')); }, timeoutMs);
    function finish(e, code) {
      if (done) return;
      done = true;
      clearTimeout(timer);
      if (e) reject(e); else resolve({ code, stderr: err });
    }
    child.stderr.on('data', (d) => { if (err.length < 65536) err += d.toString('utf8'); });
    child.on('error', (e) => finish(e));
    child.on('close', (code) => finish(null, code));
  });
}

/** What `ffmpeg -i` printed about a file, or null when it shows no video. */
function parseProbe(text) {
  const s = String(text || '');
  const d = /Duration:\s*(\d+):(\d{2}):(\d{2}(?:\.\d+)?)/.exec(s);
  const v = /Stream #\d+:\d+[^\n]*?: Video: ([a-z0-9_]+)[^\n]*?[ ,](\d{2,5})x(\d{2,5})[ ,\]]/i.exec(s);
  if (!v) return null;
  const seconds = d ? Number(d[1]) * 3600 + Number(d[2]) * 60 + Number(d[3]) : null;
  return { seconds, codec: v[1].toLowerCase(), width: Number(v[2]), height: Number(v[3]) };
}

/**
 * The file, checked: { ok: true, name, size, mtimeMs, seconds, width, height,
 * codec } or { ok: false, error } with error one of: missing, type, big, video,
 * long, short.
 */
async function probe(file, { ffmpeg, statFn = fs.promises.stat, runFn = run } = {}) {
  const name = path.basename(String(file || ''));
  const ext = path.extname(name).slice(1).toLowerCase();
  if (!EXTENSIONS.includes(ext)) return { ok: false, error: 'type' };
  let st;
  try { st = await statFn(file); } catch { return { ok: false, error: 'missing' }; }
  if (!st.isFile()) return { ok: false, error: 'missing' };
  if (st.size > LIMITS.MAX_BYTES) return { ok: false, error: 'big' };
  let out;
  try { out = await runFn(ffmpeg, ['-hide_banner', '-nostdin', '-i', file]); } catch { return { ok: false, error: 'video' }; }
  const p = parseProbe(out.stderr);
  if (!p || !Number.isFinite(p.seconds) || !(p.seconds > 0)) return { ok: false, error: 'video' };
  if (p.seconds > LIMITS.MAX_SECONDS) return { ok: false, error: 'long' };
  if (p.seconds < LIMITS.MIN_SECONDS) return { ok: false, error: 'short' };
  return { ok: true, name, size: st.size, mtimeMs: st.mtimeMs, ...p };
}

/** Splits a stream of JPEGs on their markers. ffmpeg's hold no thumbnail. */
class JpegSplitter {
  constructor() { this.buf = Buffer.alloc(0); }

  push(chunk) {
    this.buf = this.buf.length ? Buffer.concat([this.buf, chunk]) : chunk;
    const out = [];
    for (;;) {
      const start = this.buf.indexOf(SOI);
      if (start < 0) { this.buf = this.buf.subarray(Math.max(0, this.buf.length - 1)); break; }
      const end = this.buf.indexOf(EOI, start + 2);
      if (end < 0) { this.buf = this.buf.subarray(start); break; }
      out.push(Buffer.from(this.buf.subarray(start, end + 2)));
      this.buf = this.buf.subarray(end + 2);
    }
    return out;
  }
}
const SOI = Buffer.from([0xFF, 0xD8]);
const EOI = Buffer.from([0xFF, 0xD9]);

/**
 * One 1280x720 JPEG a second of the video, as { sec, jpeg }. The pipe is the
 * pace: ffmpeg waits while nothing reads, and stopping early ends it.
 */
async function* videoFrames(file, { ffmpeg, spawnFn = spawn, setPriority = os.setPriority, onChild } = {}) {
  const child = spawnFn(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-nostdin', '-i', file, '-map', '0:v:0', '-an',
    '-vf', 'fps=1,scale=1280:720', '-pix_fmt', 'yuvj420p', '-q:v', '4', '-threads', '2',
    '-f', 'image2pipe', '-c:v', 'mjpeg', 'pipe:1'], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  if (onChild) onChild(child);
  let err = '';
  let exit = null;
  const closed = new Promise((resolve) => {
    child.on('close', (code) => { exit = code; resolve(); });
    child.on('error', (e) => { err = err || e.message; exit = -1; resolve(); });
  });
  child.stderr.on('data', (d) => { if (err.length < 4096) err += d.toString('utf8'); });
  try { if (child.pid) setPriority(child.pid, os.constants.priority.PRIORITY_BELOW_NORMAL); } catch { /* it only runs at normal */ }
  const split = new JpegSplitter();
  let sec = 0;
  try {
    for await (const chunk of child.stdout) {
      for (const jpeg of split.push(chunk)) yield { sec: sec++, jpeg };
    }
    await closed;
    if (exit !== 0) throw new Error(`ffmpeg stopped reading the video (${String(err).trim().slice(0, 200) || exit})`);
  } finally {
    if (exit === null) { try { child.kill(); } catch {} }
  }
}

// ── A clip in the recorder's shape ────────────────────────────────────────────

const ID_SEGMENT = 0x18538067;
const ID_TRACKS = 0x1654AE6B;
const ID_ENTRY = 0xAE;
const ID_CODEC_PRIVATE = 0x63A2;
const ID_VOID = 0xEC;

function elementAt(b, p, limit) {
  if (p >= limit) return null;
  const first = b[p];
  let idLen = 1;
  while (idLen <= 4 && !(first & (0x80 >> (idLen - 1)))) idLen++;
  if (idLen > 4 || p + idLen >= limit) return null;
  let id = 0;
  for (let i = 0; i < idLen; i++) id = id * 256 + b[p + i];
  const q = p + idLen;
  const lead = b[q];
  let sizeLen = 1;
  while (sizeLen <= 8 && !(lead & (0x80 >> (sizeLen - 1)))) sizeLen++;
  if (sizeLen > 8 || q + sizeLen > limit) return null;
  let size = lead & (0xFF >> sizeLen);
  let unknown = size === (0xFF >> sizeLen);
  for (let i = 1; i < sizeLen; i++) {
    size = size * 256 + b[q + i];
    if (b[q + i] !== 0xFF) unknown = false;
  }
  const data = q + sizeLen;
  return { id, start: p, sizeAt: q, sizeLen, data, end: unknown ? limit : Math.min(limit, data + size), size };
}

function childrenOf(b, from, to, visit) {
  for (let p = from; p < to;) {
    const e = elementAt(b, p, to);
    if (!e || e.end <= p) return;
    visit(e);
    p = e.end;
  }
}

/**
 * THE CLIP PLAYER AND THE STILLS DECODER TAKE ONE SHAPE, Chromium's: H.264 in
 * Annex B with SPS and PPS in each keyframe and no CodecPrivate. ffmpeg's
 * Matroska muxer always writes length prefixes and an avcC, whatever the
 * encoder hands it, so both are put right here, in place: a 4 byte length
 * becomes a 4 byte start code, and the CodecPrivate becomes a Void of the same
 * size. Throws on anything else.
 */
function toRecorderShape(input) {
  const b = Buffer.from(input);
  let voided = false;
  const top = elementAt(b, 0, b.length);
  if (!top) throw new Error('no EBML header');
  const seg = elementAt(b, top.end, b.length);
  if (!seg || seg.id !== ID_SEGMENT) throw new Error('no Segment');
  childrenOf(b, seg.data, seg.end, (t) => {
    if (t.id !== ID_TRACKS) return;
    childrenOf(b, t.data, t.end, (entry) => {
      if (entry.id !== ID_ENTRY) return;
      childrenOf(b, entry.data, entry.end, (k) => {
        if (k.id !== ID_CODEC_PRIVATE) return;
        // [id 2][size n][data d] becomes [EC][size n][d + 1 bytes of zero].
        const payload = k.end - k.start - 1 - k.sizeLen;
        if (payload >= 2 ** (7 * k.sizeLen) - 1) throw new Error('CodecPrivate size does not fit');
        b[k.start] = ID_VOID;
        let v = payload;
        for (let i = k.sizeLen - 1; i >= 0; i--) { b[k.start + 1 + i] = v % 256; v = Math.floor(v / 256); }
        b[k.start + 1] |= 0x80 >> (k.sizeLen - 1);
        b.fill(0, k.start + 1 + k.sizeLen, k.end);
        voided = true;
      });
    });
  });
  if (!voided) throw new Error('no CodecPrivate');
  const clip = clipFrames.indexClip(b);
  if (!clip || !clip.frames.length) throw new Error('no frames');
  for (const f of clip.frames) {
    for (let p = f.start; p < f.end;) {
      if (p + 4 > f.end) throw new Error('a cut NAL length');
      const n = b.readUInt32BE(p);
      if (!n || p + 4 + n > f.end) throw new Error('a bad NAL length');
      b.writeUInt32BE(1, p);
      p += 4 + n;
    }
  }
  return b;
}

/** The seconds [from, to] of the file as a clip in the recorder's shape. */
async function cutVideoClip(file, fromSec, toSec, { ffmpeg, tmpDir = os.tmpdir(), runFn = run } = {}) {
  const out = path.join(tmpDir, `occlara-import-${crypto.randomUUID()}.mkv`);
  try {
    const r = await runFn(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-nostdin', '-y',
      '-ss', fromSec.toFixed(3), '-to', toSec.toFixed(3), '-i', file, '-map', '0:v:0', '-an',
      '-vf', 'fps=30,scale=1280:720', '-pix_fmt', 'yuv420p', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '26',
      '-profile:v', 'main', '-bf', '0', '-g', '30', '-keyint_min', '30', '-sc_threshold', '0',
      '-x264-params', 'repeat-headers=1', '-threads', '2', '-cluster_time_limit', '900', '-f', 'matroska', out],
    { timeoutMs: LIMITS.CUT_TIMEOUT_MS, low: true });
    if (r.code !== 0) throw new Error(`ffmpeg could not cut the clip: ${String(r.stderr).trim().slice(0, 200)}`);
    return toRecorderShape(await fs.promises.readFile(out));
  } finally {
    fs.promises.rm(out, { force: true }).catch(() => {});
  }
}

// ── The import's own AI log folder ────────────────────────────────────────────

/**
 * Written as the live log is, one record and JPEG a read. Every frame stays
 * until the review has looked, since a death only Riot's record knows can be
 * anywhere in the match. Then it is thinned like any finished session and
 * becomes one of the kept folders. It is named session-* so a review's eye finds
 * it; index.js keeps it out of the prune while the import runs.
 */
class ImportLog {
  constructor(root, stamp, { version = '' } = {}) {
    this.dir = path.join(root, `session-import-${stamp}`);
    this.version = version;
    this.records = [];
    this.seq = 0;
    this.keepUntil = 0;
    this.turnUntil = 0;
    fs.mkdirSync(this.dir, { recursive: true });
  }

  get id() { return path.basename(this.dir); }

  write(d) {
    if (!d || !d.image) return;
    const at = d.at;
    const i = this.seq++;
    const frame = `frame-${String(i).padStart(5, '0')}.jpg`;
    fs.writeFileSync(path.join(this.dir, frame), Buffer.from(d.image, 'base64'));
    const rec = { i, at, frame, state: d.state || {}, round: typeof d.round === 'number' ? d.round : null,
      died: !!d.died, match: d.match || null };
    if (rec.died) {
      for (const r of this.records) if (r.at >= at - AI_LOG_DEATH_BEFORE) r.keep = true;
      rec.keep = true;
      this.keepUntil = at + AI_LOG_DEATH_AFTER;
    } else if (at <= this.keepUntil) rec.keep = true;
    const prev = this.records[this.records.length - 1];
    if (prev && rec.round !== null && prev.round !== null && rec.round !== prev.round) {
      for (const r of this.records) if (r.at >= at - AI_LOG_ROUND_MS) r.turn = true;
      rec.turn = true;
      this.turnUntil = at + AI_LOG_ROUND_MS;
    } else if (at <= this.turnUntil) rec.turn = true;
    this.records.push(rec);
  }

  flush() {
    fs.writeFileSync(path.join(this.dir, 'log.json'), JSON.stringify({
      startedAt: this.records[0] ? this.records[0].at : 0, app: this.version, imported: true, records: this.records,
    }));
  }

  /** The frames of [from, to], as index.js holdAiLogFrames hands a review them. */
  hold(from, to) {
    this.flush();
    return { dir: this.dir, hold: null,
      records: this.records.filter((r) => r.at >= from - 5000 && r.at <= to + 5000).map((r) => ({ ...r })) };
  }

  /** The review is done: only what a finished session keeps stays on disk. */
  thin() {
    let last = -Infinity;
    const kept = [];
    for (const r of this.records) {
      const keep = r.keep || r.turn || r.at - last >= LIMITS.KEEP_FRAME_GAP_MS;
      if (keep) { last = r.at; kept.push(r); } else this.drop(r);
    }
    while (kept.length > LIMITS.KEEP_FRAMES) {
      let k = kept.findIndex((r) => !r.keep && !r.turn);
      if (k < 0) k = kept.findIndex((r) => !r.keep);
      if (k < 0) k = 0;
      this.drop(kept.splice(k, 1)[0]);
    }
    this.records = kept;
    this.flush();
  }

  drop(r) { try { fs.unlinkSync(path.join(this.dir, r.frame)); } catch {} }

  remove() { try { fs.rmSync(this.dir, { recursive: true, force: true }); } catch {} }
}

// ── Reading the video with the engine ─────────────────────────────────────────

/**
 * An engine that only ever runs on the frames handed to it. Its timer is
 * cleared, and a match it ends is kept here rather than reviewed: the first
 * full match is chosen once it is certain, and reviewed on the real clock.
 */
function createEngine(Engine, t0, opts) {
  return withClock(t0, () => {
    const e = new Engine({ captureFunction: async () => null, ...opts });
    e.importEnded = [];
    e.requestMatchReview = (snap) => { if (snap) e.importEnded.push(snap); };
    e.start();
    clearInterval(e.loopTimer);
    e.loopTimer = null;
    return e;
  });
}

/** The first match worth a review among those the engine ended. */
function firstMatch(engine) {
  return engine.importEnded.find((s) => !s.voided && Array.isArray(s.rounds) && s.rounds.length >= LIMITS.MIN_ROUNDS) || null;
}

/**
 * Every frame through the engine, as the live loop does it: at the phase's
 * cadence (phaseGap), several reads out at once, each sent with the context as
 * it stands and applied strictly in order on its own capture time. A 429 waits
 * and sends the same frame again, so none is lost to pacing.
 *
 * @returns { reason: 'done' | 'cancelled' | 'capped' | 'auth' | 'server',
 *            lastSec, reads }
 */
async function readFrames(o) {
  const { engine, frames, t0, read } = o;
  const sleep = o.sleep || ((ms) => new Promise((r) => setTimeout(r, ms)));
  const now = o.now || Date.now;
  const cancelled = o.cancelled || (() => false);
  const paused = o.paused || (() => false);
  const out = { reason: 'done', lastSec: 0, reads: 0 };
  const flying = [];
  let gap = LIMITS.MIN_SEND_GAP_MS;
  let lastSend = 0;
  let lastAt = -Infinity;
  let failures = 0;
  let stop = null;
  let endedAt = null;

  const send = async (image, context) => {
    for (let tries = 0; ;) {
      if (cancelled()) return { dropped: true };
      const r = await read(image, context);
      if (r.capped) return { capped: true };
      if (r.data) { gap = Math.max(LIMITS.MIN_SEND_GAP_MS, gap * 0.98); return r; }
      if (r.status === 429) {
        gap = Math.min(LIMITS.MAX_SEND_GAP_MS, gap * 1.5);
        await sleep(5000);
        continue;
      }
      if (r.status === 401 || r.status === 403) return { fatal: 'auth' };
      if (r.status === 402) return { fatal: 'server' };
      tries += 1;
      if (tries >= LIMITS.READ_TRIES) return { failed: true };
      await sleep(1000 * tries);
    }
  };
  const land = (f, r) => {
    if (o.onAlive) o.onAlive();
    if (r.capped) { stop = stop || 'capped'; return; }
    if (r.fatal) { stop = stop || r.fatal; return; }
    if (r.dropped) return;
    if (r.failed || !r.data) {
      failures += 1;
      if (failures >= LIMITS.FAILURES_IN_A_ROW) stop = stop || 'server';
      return;
    }
    failures = 0;
    out.reads += 1;
    withClock(f.at, () => engine.applyRead({ data: r.data, shot: f.shot, at: f.at }));
  };
  const landReady = () => { while (flying.length && flying[0].done) { const f = flying.shift(); land(f, f.result); } };
  const landOne = async () => { const f = flying.shift(); land(f, await f.promise); };

  for await (const frame of frames) {
    out.lastSec = frame.sec;
    if (o.onAlive) o.onAlive();
    if (o.onFrame) o.onFrame(frame.sec, out.reads);
    while (paused() && !cancelled()) await sleep(1000);
    if (cancelled()) { stop = 'cancelled'; break; }
    landReady();
    if (stop) break;
    const at = Math.round(t0 + frame.sec * 1000);
    // The first match has ended. A little more is read so that an end which was
    // not one can be taken back, and then the rest of the file is left.
    const ended = firstMatch(engine);
    if (ended && endedAt === null) endedAt = frame.sec;
    if (!ended) endedAt = null;
    if (ended && frame.sec - endedAt >= LIMITS.CONFIRM_END_SECONDS) break;
    const phase = withClock(at, () => engine.phaseGap(at));
    if (at - lastAt < phase.ms) continue;
    while (flying.length >= LIMITS.IN_FLIGHT) await landOne();
    if (stop) break;
    const wait = lastSend + gap - now();
    if (wait > 0) await sleep(wait);
    lastSend = now();
    lastAt = at;
    const context = withClock(at, () => engine.readContext());
    const shot = frame.jpeg.toString('base64');
    const f = { at, shot, done: false, result: null, promise: null };
    f.promise = send(shot, context).then((r) => { f.done = true; f.result = r; return r; });
    flying.push(f);
  }
  while (flying.length) await landOne();
  out.reason = stop || (cancelled() ? 'cancelled' : 'done');
  return out;
}

// ── One import from start to finish ───────────────────────────────────────────

const FAILURE_TEXT = Object.freeze({
  'no-match': 'No full Valorant match was found in this recording.',
  auth: 'Your sign in was refused while reading this recording. Sign in again and retry.',
  server: 'The coach could not read this recording right now.',
  file: 'This recording could not be read to the end.',
  claim: 'Imports are not available right now. Nothing was used, try again shortly.',
});
// What became of the import and its game, as the server settled it, and
// nothing when it did not say.
const SETTLED_TEXT = Object.freeze({
  refunded: 'Your import and game were given back.',
  counted: 'It still used 1 import and 1 game.',
});
const PROBE_TEXT = Object.freeze({
  missing: 'That file could not be opened.',
  type: 'Choose an mp4, mkv, mov or webm video.',
  big: 'That file is over the 8 GB limit.',
  video: 'That file has no video Occlara can read.',
  long: 'That recording is longer than the 65 minute limit.',
  short: 'That recording is shorter than a minute.',
});

/**
 * One import at a time. deps:
 *   ffmpeg, Engine, READ_PATH, engineOptions(), logRoot, version
 *   api { get, post }, auth()          the app's server client and its headers
 *   busy()                             a match is being played or the window sealed
 *   shouldPause()                      a recording session wants the PC
 *   chooseFile()                       the native picker: a path or null
 *   riotMatches()                      Riot's last matches, each { matchId, startedAt, map, ... , taken };
 *                                      throws when the list cannot be had
 *   idle()                             resolves once no match is being played
 *   review({ run, engine, snap })      resolves { id } when its review is whole
 *   push(status)                       what the panel shows
 */
function createImporter(deps) {
  const d = deps;
  let chosen = null;
  let active = null;
  let starting = false;
  let picks = 0;
  let status = { state: 'idle' };

  const say = (next) => { status = next; d.push(status); return status; };
  const publicMatch = (m) => ({ matchId: m.matchId, startedAt: m.startedAt, map: m.map || null, agent: m.agent || null,
    mode: m.mode || null, result: m.result || null, score: m.score || null, taken: !!m.taken });

  async function gate() {
    try {
      const r = await d.api.get('/api/usage/import', d.auth, 15000);
      return r && r.ok && r.data ? r.data : { unavailable: true };
    } catch { return { unavailable: true }; }
  }

  /** The native picker, the file checked, and the match list with the nearest chosen. */
  async function pick() {
    if (active) return status;
    if (d.busy()) return { state: 'idle', error: 'match' };
    const file = await d.chooseFile();
    if (!file) return status;
    const p = await probe(file, { ffmpeg: d.ffmpeg });
    if (!p.ok) { chosen = null; return say({ state: 'idle', error: p.error, message: PROBE_TEXT[p.error] }); }
    let matches = [];
    let listFailed = false;
    try { matches = (await d.riotMatches()) || []; } catch { matches = []; listFailed = true; }
    const guess = p.mtimeMs - p.seconds * 1000;
    let nearest = null;
    for (const m of matches) {
      if (m.taken || !Number.isFinite(m.startedAt) || Math.abs(m.startedAt - guess) > LIMITS.NEAREST_MS) continue;
      if (!nearest || Math.abs(m.startedAt - guess) < Math.abs(nearest.startedAt - guess)) nearest = m;
    }
    picks += 1;
    chosen = { file, probe: p, matches, guess, id: crypto.randomUUID(), pick: picks };
    return say({ state: 'choosing', pick: picks, fileName: p.name, seconds: p.seconds, matches: matches.map(publicMatch),
      nearest: nearest ? nearest.matchId : null,
      message: listFailed ? "Riot's match list could not be loaded. Close and choose the file again to match it, or start now to review it from the screen." : null });
  }

  function forget() {
    chosen = null;
    if (!active) say({ state: 'idle' });
    return status;
  }

  /** Says how the import ended, and answers what the server made of it, or null. */
  async function finishUsage(id, outcome) {
    try {
      const r = await d.api.post('/api/usage/import/end', { job_id: id, outcome }, d.auth, 15000);
      return (r && r.ok && r.data && r.data.status) || null;
    } catch (e) {
      console.log('[import] the end was not reported, the server settles it later:', e.message);
      return null;
    }
  }

  async function start({ matchId } = {}) {
    if (active || starting) return status;
    if (!chosen) return say({ state: 'idle', error: 'none' });
    if (d.busy()) return { ...status, error: 'match' };
    // One id for this choice until it is answered: a claim that timed out after
    // the server took it is the same import when it is tried again.
    const { file, probe: p, matches, guess, id, pick: pickNo } = chosen;
    const match = matchId ? matches.find((m) => m.matchId === matchId && !m.taken) || null : null;
    if (matchId && !match) return say({ ...status, message: 'That match is already in your library. Choose another.' });
    say({ state: 'starting', fileName: p.name, seconds: p.seconds });
    starting = true;
    let claim;
    try { claim = await d.api.post('/api/usage/import', { job_id: id }, d.auth, 15000); } catch { claim = null; }
    starting = false;
    if (!claim || !claim.ok || !claim.data || !claim.data.ok) {
      const data = (claim && claim.data) || {};
      const blocked = data.error === 'plan' || data.error === 'imports' || data.error === 'games';
      return say({ state: 'choosing-refused', pick: pickNo, gate: blocked ? data : null, message: blocked ? null : FAILURE_TEXT.claim,
        fileName: p.name, seconds: p.seconds, matches: matches.map(publicMatch), nearest: match ? match.matchId : null });
    }
    chosen = null;
    const job = { id, cancelled: false, phase: 'reading' };
    active = job;
    runJob(job, file, p, match, match ? match.startedAt : guess)
      .catch((e) => console.log('[import] the job failed:', e.message))
      .finally(() => { active = null; });
    return status;
  }

  async function runJob(job, file, p, match, startAt) {
    const t0 = Math.floor(startAt);
    const auth = () => ({ ...(d.auth() || {}), 'X-Occlara-Import': job.id });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const log = new ImportLog(d.logRoot, stamp, { version: d.version });
    job.logId = log.id;
    if (d.onLog) d.onLog(log.id, true);
    const failed = async (kind) => {
      log.remove();
      if (d.onLog) d.onLog(log.id, false);
      const settled = await finishUsage(job.id, 'failed');
      say({ state: 'failed', error: kind, fileName: p.name,
        message: [FAILURE_TEXT[kind] || FAILURE_TEXT.server, SETTLED_TEXT[settled] || ''].filter(Boolean).join(' ') });
    };
    const stopped = async () => {
      log.remove();
      if (d.onLog) d.onLog(log.id, false);
      await finishUsage(job.id, 'cancelled');
      say({ state: 'idle', cancelled: true });
    };
    const reading = (sec, paused) => say({ state: paused ? 'paused' : 'reading', fileName: p.name, seconds: p.seconds,
      percent: Math.min(99, Math.floor((sec / p.seconds) * 100)) });
    let engine;
    let result;
    let lastPush = 0;
    let at = 0;
    let alive = Date.now();
    let stalled = false;
    const watch = setInterval(() => {
      if (d.shouldPause()) { alive = Date.now(); return; }
      if (Date.now() - alive > LIMITS.STALL_MS) { stalled = true; job.kill && job.kill(); }
    }, 5000);
    if (watch.unref) watch.unref();
    try {
      engine = createEngine(d.Engine, t0, { ...d.engineOptions(), licenseKey: auth,
        diagnostics: (rec) => log.write(rec) });
      reading(0, false);
      result = await readFrames({
        engine, t0,
        frames: videoFrames(file, { ffmpeg: d.ffmpeg, onChild: (c) => { job.kill = () => { try { c.kill(); } catch {} }; } }),
        cancelled: () => job.cancelled,
        onAlive: () => { alive = Date.now(); },
        paused: () => {
          const wait = d.shouldPause();
          if (wait && status.state !== 'paused') reading(at, true);
          return wait;
        },
        read: (image, context) => engine.callServer(d.READ_PATH, { image, context }, { timeoutMs: LIMITS.READ_TIMEOUT_MS }),
        onFrame: (sec) => {
          at = sec;
          if (Date.now() - lastPush >= 1000) { lastPush = Date.now(); reading(sec, false); }
        },
      });
    } catch (e) {
      clearInterval(watch);
      // Cancel ends ffmpeg, which is how a stalled drive lets go.
      if (job.cancelled) { await stopped(); return; }
      console.log(`[import] reading the video failed${stalled ? ' (it stalled)' : ''}:`, e.message);
      await failed('file');
      return;
    }
    clearInterval(watch);
    if (result.reason === 'cancelled') { await stopped(); return; }
    if (result.reason === 'auth' || result.reason === 'server') { await failed(result.reason); return; }
    withClock(t0 + result.lastSec * 1000, () => engine.stop());
    const snap = firstMatch(engine);
    if (!snap) { await failed('no-match'); return; }
    snap.stoppedLive = false;
    delete engine.requestMatchReview;
    job.phase = 'review';
    say({ state: 'review', fileName: p.name, step: 'saved' });
    const run = {
      id: job.id, auth, fileName: p.name, match: match || null, log,
      restUnread: p.seconds - result.lastSec > LIMITS.REST_NOTE_SECONDS,
      step: (step) => { if (step) say({ state: 'review', fileName: p.name, step }); },
      cut: async (fromWall, toWall, moment) => {
        const from = Math.max(0, (fromWall - t0) / 1000);
        const to = Math.min(p.seconds, (toWall - t0) / 1000);
        const m = (moment - t0) / 1000;
        if (!(to > from) || (Number.isFinite(m) && (m < -1 || m > p.seconds + 1))) return null;
        // Encoding is real work for the PC: never while a match is played.
        await d.idle();
        const bytes = await cutVideoClip(file, from, to, { ffmpeg: d.ffmpeg });
        return { bytes, mime: 'video/x-matroska', startWall: t0 + from * 1000 };
      },
    };
    let done;
    try {
      done = await d.review({ run, engine, snap });
    } catch (e) {
      console.log('[import] the review failed:', e.message);
      await failed('server');
      return;
    }
    try { log.thin(); } catch (e) { console.log('[import] the log was not thinned:', e.message); }
    if (d.onLog) d.onLog(log.id, false);
    await finishUsage(job.id, 'done');
    say({ state: 'done', fileName: p.name, reviewId: done && done.id, locked: !!(done && done.locked),
      matched: !!(done && done.matched), restUnread: run.restUnread });
  }

  function cancel() {
    if (active && active.phase === 'reading') {
      active.cancelled = true;
      if (active.kill) active.kill();
      say({ ...status, state: 'cancelling' });
    }
    return status;
  }

  return { gate, pick, start, cancel, forget, status: () => status, running: () => !!active || starting };
}

module.exports = { LIMITS, EXTENSIONS, FAILURE_TEXT, PROBE_TEXT, ffmpegPath, parseProbe, probe, JpegSplitter, videoFrames,
  toRecorderShape, cutVideoClip, ImportLog, createEngine, firstMatch, readFrames, createImporter };
