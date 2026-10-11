'use strict';

/**
 * The match recorder (src/main/services/recorder.js), offline, on a fake clock
 * and fake files, with a stand in for its page that answers as the real one
 * does (src/renderer/recorder/recorder.js; check:recorder runs the real one).
 *
 * The numbers asserted are the SPEC's, written here, never read back from the
 * module: 720p in 1280x720 at 3 Mbps and 1080p at 6, asked for 60 fps, a
 * keyframe and a chunk a second; one minute pages, two minutes kept, an hour's
 * hold; no start under 8 GB free, a stop under 4; for 20 s straight, under 12
 * frames a second while the picture changes, a chunk 4 s late, the recorder
 * over 60% of a core, the PC over 95%; black under 4 of 255; two busy sessions
 * in seven days. So a constant moved in the module fails a line here.
 *
 * Held here:
 *   the size never crops: the display's own shape filling the box and
 *     covering the read's frame, within H.264 level 4.0, the bitrate with it;
 *     a recording that cannot cover the read leaves the read on GDI
 *   the recording into pages: init once, whole Clusters, the pages joined are
 *     the recording byte for byte, a clip cut from the pages is the clip cut
 *     from the recording, the wall clock within a frame or two
 *   nothing recorded stays in memory: ten minutes of 3 Mbps Clusters
 *   holds and their release, the two minute rule, the hour, the match in
 *     progress kept from its start, the folder gone with its last page
 *   a Valorant match as the recorder takes it, on the real reader: not judged
 *     and nothing kept before a read lands, not judged in the menus after a
 *     match left in round 2, kept ninety minutes back at most
 *   the sweep of what a run left, and nothing outside it; the uninstaller's
 *   the disk guard at the start and while recording
 *   every health rule, on its own, at its boundary, and only in a match
 *   the page's own account (health.js) through the rules: a capture slowed to
 *     a frame every 1.5 or 5 s, or one a second at random, gives up; a healthy
 *     one and a still screen never do
 *   each one falls back to the GDI helper and puts up its notice once
 *   two busy sessions in a week turn Auto off; a week apart do not; Auto
 *     chosen again forgets them; Off chosen by hand takes the recording with it
 *   the comparison with GDI: black, both black, GDI unavailable, once a minute
 *   the live read's frame from the stream, stale frames and a deaf page
 *   the primary display changing: the recording starts again on the new one
 *   the hardware gate, pause, and the counts block the session ends with,
 *     however it ends: Stop, or at once at a quit, a logout or Windows ending
 *     its session (shutdown), marked when the process ends next so index.js
 *     keeps it rather than post it into the exit; a chunk between Stop and
 *     its answer kept
 *   what Settings is told: the track's own size
 *
 * Run: npm run test:recorder
 */

const fs = require('fs');
const path = require('path');
const util = require('util');
const webm = require('../src/shared/webm');
const R = require('../src/main/services/recorder');

const { Recorder, fitSize, covers, bitrateFor, aspectKept, codecFor, compareVerdict, createHealth, strikeOut, reportBlock, everyText } = R;

let fails = 0;
let checks = 0;
// Everything here runs on a fake clock, so an await the recorder never
// settles leaves nothing for node to wait on, and node would end the run
// there, quietly and with exit code 0. A run that never reached its summary
// is a failure.
let finished = false;
process.on('exit', () => {
  if (finished) return;
  console.log('FAIL  the run ended before its last check: something awaited never settled');
  process.exitCode = 1;
});
const ok = (cond, what, detail) => {
  checks++;
  if (!cond) { fails++; console.log(`FAIL  ${what}${detail ? `\n        ${detail}` : ''}`); } else console.log(`ok    ${what}`);
};
const same = (a, b) => util.isDeepStrictEqual(a, b);
async function section(title, fn) {
  console.log(`\n${title}`);
  try { await fn(); } catch (e) { ok(false, 'the section ran to the end', (e && e.stack) || String(e)); }
}

// ── The spec's numbers ──────────────────────────────────────────────────────
const SPEC = {
  res720: { width: 1280, height: 720, bitrate: 3e6 },
  res1080: { width: 1920, height: 1080, bitrate: 6e6 },
  // The read's frame (the Standard profile), which a recording covers, and
  // H.264 level 4.0's frame, which none passes.
  read: { width: 1280, height: 720 }, mbLevel40: 8160,
  askFps: 60, keyframeMs: 1000, timesliceMs: 1000,
  pageMs: 60000, keepRecentMs: 120000, holdMs: 3600000, keepMatchMs: 90 * 60000,
  diskStart: 8 * 1024 ** 3, diskStop: 4 * 1024 ** 3,
  sustainS: 20, minFps: 12, maxLagMs: 4000, maxRecorderCpu: 60, maxSystemCpu: 95,
  black: 4, strikesDays: 7,
  busyText: 'Recording stopped for this session: your PC was busy. The coach still reads your screen every second.',
  blackText: 'Recording needs Windowed Fullscreen in this game. The coach still reads your screen every second.',
  bothBlackText: 'Capture is black. Switch the game to Windowed Fullscreen.',
};
const GB = 1024 ** 3;
const DAY = 24 * 3600 * 1000;
// The page draws a frame 64x36 to read its brightness (recorder.js thumb).
const THUMB_PX = 64 * 36;
// The two dashes the house rules ban, built from their code points so this file carries neither.
const DASHES = new RegExp('[' + String.fromCharCode(0x2013) + String.fromCharCode(0x2014) + ']');

// ── A fake clock: every timer the recorder sets runs on it ─────────────────
async function settle() { for (let i = 0; i < 25; i++) await new Promise((r) => setImmediate(r)); }
function fakeClock(start) {
  let now = start;
  let seq = 0;
  const timers = new Map();
  return {
    now: () => now,
    setTimeout(fn, ms) { const id = ++seq; timers.set(id, { at: now + Math.max(0, Number(ms) || 0), fn }); return id; },
    clearTimeout(id) { timers.delete(id); },
    setInterval(fn, ms) { const id = ++seq; timers.set(id, { at: now + ms, fn, every: ms }); return id; },
    clearInterval(id) { timers.delete(id); },
    async advance(ms) {
      const end = now + ms;
      for (;;) {
        await settle();
        let next = null;
        for (const [id, t] of timers) if (t.at <= end && (!next || t.at < next.t.at || (t.at === next.t.at && id < next.id))) next = { id, t };
        if (!next) break;
        now = Math.max(now, next.t.at);
        if (next.t.every) next.t.at += next.t.every; else timers.delete(next.id);
        next.t.fn();
      }
      now = end;
      await settle();
    },
    jump(ms) { now += ms; },
  };
}

// ── Fake files ──────────────────────────────────────────────────────────────
function memFiles() {
  const files = new Map();
  const dirs = new Set();
  const norm = (p) => path.resolve(p);
  const under = (k, p) => k === p || k.startsWith(p + path.sep);
  const m = {
    files, dirs, failAppend: false,
    mkdir: (d) => { dirs.add(norm(d)); },
    write: (f, b) => { files.set(norm(f), Buffer.from(b)); },
    append: (f, b) => {
      if (m.failAppend) throw new Error('the disk said no');
      files.set(norm(f), Buffer.concat([files.get(norm(f)) || Buffer.alloc(0), Buffer.from(b)]));
    },
    read: (f, off, size) => Buffer.from((files.get(norm(f)) || Buffer.alloc(0)).subarray(off, off + size)),
    remove: (f) => { files.delete(norm(f)); },
    removeTree: (d) => {
      const p = norm(d);
      for (const k of [...files.keys()]) if (under(k, p)) files.delete(k);
      for (const k of [...dirs]) if (under(k, p)) dirs.delete(k);
    },
    list: (d) => {
      const p = norm(d);
      const names = new Set();
      for (const k of [...files.keys(), ...dirs]) if (k.startsWith(p + path.sep)) names.add(k.slice(p.length + 1).split(path.sep)[0]);
      return [...names];
    },
    under: (d) => [...files.keys()].filter((k) => under(k, norm(d))).map((k) => path.relative(norm(d), k).split(path.sep).join('/')).sort(),
  };
  return m;
}

/**
 * Files that keep only how big each is: what the recorder writes goes "to
 * disk" and nowhere else, so the memory a run keeps is the recorder's own.
 */
function sizeFiles() {
  const sizes = new Map();
  const norm = (p) => path.resolve(p);
  const under = (k, p) => k === p || k.startsWith(p + path.sep);
  return {
    sizes,
    total: () => [...sizes.values()].reduce((n, x) => n + x, 0),
    mkdir: () => {},
    write: (f, b) => { sizes.set(norm(f), b.length); },
    append: (f, b) => { sizes.set(norm(f), (sizes.get(norm(f)) || 0) + b.length); },
    read: () => Buffer.alloc(0),
    remove: (f) => { sizes.delete(norm(f)); },
    removeTree: (d) => { for (const k of [...sizes.keys()]) if (under(k, norm(d))) sizes.delete(k); },
    list: () => [],
  };
}

/**
 * A full garbage collection, asked for at run time (the test runs as plain
 * node), done a few times across turns of the event loop: an ArrayBuffer's
 * bytes are let go a little after the object, measured here.
 */
function fullGc() {
  let gc = typeof global.gc === 'function' ? global.gc : null;
  if (!gc) {
    try { require('v8').setFlagsFromString('--expose-gc'); gc = require('vm').runInNewContext('gc'); } catch { gc = null; }
  }
  if (typeof gc !== 'function') return null;
  return async () => { for (let i = 0; i < 4; i++) { gc(); await new Promise((r) => setImmediate(r)); } };
}

function memPrefs(init) {
  const data = { recordingMode: 'auto', recordingRes: '720', recordingStrikes: [], recordingAutoOff: null, recordingLast: null, ...(init || {}) };
  return { data, get: (k) => data[k], set: (k, v) => { data[k] = v; } };
}

// ── Matroska built here: as Chromium writes it, a Segment and Clusters of
// unknown size, one keyframe opening each Cluster, frames 33 ms apart ───────
const W = {
  id(n) { const out = []; for (let v = n; v > 0; v = Math.floor(v / 256)) out.unshift(v % 256); return Buffer.from(out); },
  uint(n, len) { const b = Buffer.alloc(len || 4); for (let i = b.length - 1, v = n; i >= 0; i--, v = Math.floor(v / 256)) b[i] = v % 256; return b; },
  size(n) { const b = Buffer.alloc(8); b[0] = 0x01; for (let i = 7, v = n; i >= 1; i--, v = Math.floor(v / 256)) b[i] = v % 256; return b; },
  el(id, ...payload) { const body = Buffer.concat(payload.map((x) => (Buffer.isBuffer(x) ? x : Buffer.from(String(x), 'latin1')))); return Buffer.concat([W.id(id), W.size(body.length), body]); },
  UNKNOWN: Buffer.from([0x01, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF]),
};
const SYNTH_INIT = Buffer.concat([
  W.el(0x1A45DFA3, W.el(0x4282, 'matroska')),
  W.id(0x18538067), W.UNKNOWN,
  W.el(0x1549A966, W.el(0x2AD7B1, W.uint(1000000, 3))),
  W.el(0x1654AE6B, W.el(0xAE, W.el(0xD7, W.uint(1, 1)), W.el(0x83, W.uint(1, 1)), W.el(0x86, 'V_MPEG4/ISO/AVC'))),
]);
function synthCluster(tcMs) {
  const parts = [W.el(0xE7, W.uint(tcMs, 4))];
  for (let i = 0; i < 30; i++) {
    const rel = Math.round(i * 33.3);
    parts.push(W.el(0xA3, Buffer.from([0x81, (rel >> 8) & 0xFF, rel & 0xFF, i === 0 ? 0x80 : 0x00]), Buffer.alloc(120, i)));
  }
  return Buffer.concat([W.id(0x1F43B675), W.UNKNOWN].concat(parts));
}
const toAB = (b) => b.buffer.slice(b.byteOffset, b.byteOffset + b.length);
// A second at 3 Mbps: 30 frames of 12,500 bytes, a Cluster of about 375 KB.
function bigCluster(tcMs) {
  const parts = [W.el(0xE7, W.uint(tcMs, 4))];
  for (let i = 0; i < 30; i++) {
    const rel = Math.round(i * 33.3);
    parts.push(W.el(0xA3, Buffer.from([0x81, (rel >> 8) & 0xFF, rel & 0xFF, i === 0 ? 0x80 : 0x00]), Buffer.alloc(12500, i)));
  }
  return Buffer.concat([W.id(0x1F43B675), W.UNKNOWN].concat(parts));
}

// ── The page, as the real one answers ───────────────────────────────────────
const STREAM_JPEG = Buffer.from('ffd8ffe000104a46494600010101004800480000ffd9', 'hex');

function fakePage(h) {
  const p = {
    sent: [], closed: false, listener: null, n: 0, deaf: false, stale: false, started: null,
    send(msg) {
      p.sent.push(msg);
      if (p.closed || p.dead) return;
      const later = (fn) => Promise.resolve().then(() => { if (!p.closed) fn(); });
      if (msg.type === 'start') {
        p.started = msg;
        if (h.opts.silentStart) return;
        // The track as Chromium hands it back: the size asked, unless the
        // check says it came back another (trackSize).
        const track = h.opts.trackSize || { width: msg.width, height: msg.height };
        later(() => p.emit('status', h.opts.gate === false
          ? { type: 'started', ok: false, outcome: 'no-hw-encoder', encoderOk: false, why: `no hardware H.264 encoder at ${msg.width}x${msg.height}` }
          : { type: 'started', ok: true, encoderOk: true, startWall: h.clock.now() - (h.opts.startEarly || 0), mime: 'video/x-matroska;codecs=avc1',
            settings: { width: track.width, height: track.height, frameRate: 60 } }));
      } else if (msg.type === 'stop') {
        if (h.opts.slowStop) h.clock.setTimeout(() => p.emit('status', { type: 'stopped', chunks: p.n }), h.opts.slowStop);
        else later(() => p.emit('status', { type: 'stopped', chunks: p.n }));
      } else if (msg.type === 'grab') {
        if (p.deaf) return;
        later(() => p.emit('reply', p.stale ? { id: msg.id, ok: false, why: 'stale', ageMs: 2500 }
          : { id: msg.id, ok: true, jpeg: toAB(STREAM_JPEG), ageMs: 20 }));
      } else if (msg.type === 'compare') {
        later(() => p.emit('reply', { id: msg.id, ok: true, streamLuma: h.env.streamLuma, gdiLuma: msg.gdi ? h.env.gdiLuma : null, mad: 7.5, ageMs: 15 }));
      }
    },
    pid: () => 4242,
    close() { p.closed = true; },
    onMessage(fn) { p.listener = fn; },
    emit(kind, msg) { if (p.listener && !p.closed) p.listener(kind, msg); },
    /** One second of a synthetic recording: a Cluster of 30 frames, the init with the first. */
    feed() {
      const data = p.n === 0 ? Buffer.concat([SYNTH_INIT, synthCluster(0)]) : synthCluster(p.n * 1000);
      p.emit('chunk', { seq: p.n, wall: h.clock.now(), data: toAB(data) });
      p.n += 1;
    },
    health(extra) {
      p.emit('status', { type: 'health', at: h.clock.now(), fps: 30, changing: true, frameAgeMs: 20, lagMs: 0, luma: 100, ...(extra || {}) });
    },
    count: (type) => p.sent.filter((m) => m.type === type).length,
  };
  return p;
}

const ROOT = path.resolve('/occlara-test/userData/recording');
const T0 = Date.UTC(2026, 9, 10, 18, 0, 0);

function harness(opts) {
  const o = opts || {};
  const h = { opts: o };
  h.clock = fakeClock(o.at || T0);
  h.files = o.files || memFiles();
  h.prefs = o.prefs || memPrefs(o.prefsInit);
  h.env = {
    inMatch: false, keepSince: null, free: 100 * GB, streamLuma: 100, gdiLuma: 120, gdi: 'R0RJIGZyYW1l', cadence: 1000,
    metrics: { recorderCpu: 3, systemCpu: 30, memoryMB: 140 },
    // The primary display, as recorder-window.js primarySource() names it.
    displayId: 2779098405, sourceId: 'screen:0:0',
  };
  h.pages = [];
  h.notices = [];
  h.reports = [];
  h.running = [];
  h.prefsEvents = 0;
  h.capture = { stream: null, calls: [], useStream(s) { this.stream = s || null; this.calls.push(s ? 'stream' : 'gdi'); } };
  h.rec = new Recorder({
    root: ROOT, prefs: h.prefs, files: h.files, now: h.clock.now, timers: h.clock,
    page: async () => { if (o.pageFails) throw new Error('no page'); const p = fakePage(h); h.pages.push(p); return p; },
    source: async () => (o.noSource ? null
      : { sourceId: h.env.sourceId, displayId: h.env.displayId, display: o.display || { width: 1920, height: 1080 } }),
    gdi: async () => h.env.gdi,
    capture: h.capture,
    metrics: () => h.env.metrics,
    freeBytes: () => h.env.free,
    inMatch: o.inMatch || (() => h.env.inMatch),
    keepSince: o.keepSince || (() => h.env.keepSince),
    readSize: o.readSize ? () => o.readSize : undefined,
    cadence: () => h.env.cadence,
    limits: () => o.limits || {},
    pageMs: () => o.pageMs || null,
    version: '8.3.0',
    log: () => {},
  });
  h.rec.on('notice', (n) => h.notices.push(n));
  // And how each came: { exiting } says the process ends next (shutdown()).
  h.how = [];
  h.rec.on('report', (b, how) => { h.reports.push(b); h.how.push(how || null); });
  h.rec.on('running', (on) => h.running.push(on));
  h.rec.on('prefs', () => { h.prefsEvents += 1; });
  h.page = () => h.pages[h.pages.length - 1];
  /** Seconds of recording: each, the page's chunk and health, then the recorder's tick. */
  h.run = async (seconds, each) => {
    for (let i = 0; i < seconds; i++) {
      const p = h.page();
      const extra = each ? each(i) : null;
      if (p && !p.closed && h.rec.state === 'recording') {
        if (!(extra && extra.noChunk)) p.feed();
        if (!(extra && extra.noHealth)) p.health(extra && extra.health);
      }
      await h.clock.advance(1000);
    }
  };
  h.start = async (game) => { h.rec.startSession(game); await settle(); return h.page(); };
  h.stop = async () => { const b = await h.rec.stopSession(); await settle(); return b; };
  return h;
}

/**
 * The real Valorant reader (coaching-engine.js) after the real Split
 * competitive match's first `frames` reads, then `menus` menu reads a second
 * apart, on the match's own clock, the network a stand in (as
 * test-session-replay drives it). { e, now }.
 */
function readerAfter(frames, menus) {
  const Module = require('module');
  const realLoad = Module._load;
  Module._load = function patched(request, parent, isMain) {
    if (request === './api-client') return { post: async () => ({ ok: true, status: 200, data: {} }), get: async () => ({ ok: false }) };
    return realLoad(request, parent, isMain);
  };
  let CoachingEngine;
  try { CoachingEngine = require('../src/main/services/coaching-engine.js'); } finally { Module._load = realLoad; }
  const reads = require('./fixtures/valorant-session-split-competitive.json').frames;
  const t0 = Date.parse('2026-10-04T20:00:00Z');
  let clock = t0;
  const realNow = Date.now;
  const realLog = console.log;
  Date.now = () => clock;
  console.log = () => {};
  try {
    const e = new CoachingEngine({ licenseKey: 'TEST', captureFunction: async () => null, experiments: () => ({}) });
    e.isRunning = true;
    for (const f of reads.slice(0, frames)) {
      clock = t0 + f.t * 1000;
      const { t, ...context } = f;
      e.applyRead({ data: { context: { ...context } }, shot: null, at: clock });
    }
    for (let i = 0; i < menus; i++) {
      clock += 1000;
      e.applyRead({ data: { lobby: true }, shot: null, at: clock });
    }
    return { e, now: clock };
  } finally {
    Date.now = realNow;
    console.log = realLog;
  }
}

(async () => {
  await section('the size never crops: the display\'s own shape, filling the box and covering the read\'s frame:', () => {
    // The read is the stream's frame stretched to 1280x720, so a recording
    // fitted to the box alone handed it fewer rows than GDI on a display
    // that is not 16:9: 3440x1440 recorded 1280x536, 5120x1440 1280x360.
    const cases = [
      [[1920, 1080], 720, [1280, 720]], [[1920, 1080], 1080, [1920, 1080]],
      [[3440, 1440], 720, [1720, 720]], [[1920, 1200], 720, [1280, 800]],
      [[5120, 1440], 720, [2560, 720]], [[5120, 1440], 1080, [2560, 720]],
      [[2560, 1440], 720, [1280, 720]], [[3840, 2160], 1080, [1920, 1080]], [[2560, 1080], 1080, [1920, 810]],
      // Never above the display: a 1366x768 laptop is 1280x720 at 720p and
      // itself at 1080p, and a display smaller than the read is all of itself.
      [[1366, 768], 720, [1280, 720]], [[1366, 768], 1080, [1366, 768]], [[1280, 1024], 720, [1280, 1024]],
      // Where the size is odd, it goes to the nearest even one, and an odd
      // display's own size down to the even one below it.
      [[3840, 1600], 720, [1728, 720]], [[1360, 768], 720, [1280, 722]], [[1367, 769], 1080, [1366, 768]],
    ];
    for (const [[w, hh], res, want] of cases) {
      const got = fitSize({ width: w, height: hh }, res);
      const shape = Math.abs(got.width / got.height - w / hh) / (w / hh);
      const mbs = Math.ceil(got.width / 16) * Math.ceil(got.height / 16);
      ok(same([got.width, got.height], want) && got.width % 2 === 0 && got.height % 2 === 0 && shape < 0.01
        && got.width <= w && got.height <= hh && (got.width >= SPEC.read.width && got.height >= SPEC.read.height || w < SPEC.read.width || hh < SPEC.read.height)
        && mbs <= SPEC.mbLevel40,
      `${w}x${hh} at ${res}p records ${want.join('x')}: even, its own shape to within 1%, never past the display, covering the read's 1280x720, within H.264 level 4.0`, JSON.stringify(got));
    }
    // A display so wide that covering the read is past level 4.0's frame: it
    // is brought down to the level, and no longer covers the read.
    const wide = fitSize({ width: 5760, height: 1080 }, 720);
    const wideMbs = Math.ceil(wide.width / 16) * Math.ceil(wide.height / 16);
    ok(wideMbs <= SPEC.mbLevel40 && wideMbs > SPEC.mbLevel40 * 0.95 && wide.height < SPEC.read.height
      && Math.abs(wide.width / wide.height - 5760 / 1080) / (5760 / 1080) < 0.01 && !covers(wide, SPEC.read),
    `5760x1080 at 720p: brought down to H.264 level 4.0's 8160 macroblocks (${wide.width}x${wide.height}, ${wideMbs}), its own shape, and no longer covering the read`);
    // A display smaller than the read's frame, recorded whole, holds every
    // pixel the GDI helper reads of it, stretched up the same way.
    const small = fitSize({ width: 1024, height: 768 }, 720);
    ok(same(small, { width: 1024, height: 768 }) && covers(small, SPEC.read, { width: 1024, height: 768 })
      // An odd display records at the even size below it, which is all of it.
      && same(fitSize({ width: 1153, height: 865 }, 720), { width: 1152, height: 864 })
      && covers({ width: 1152, height: 864 }, SPEC.read, { width: 1153, height: 865 })
      && !covers({ width: 1148, height: 864 }, SPEC.read, { width: 1153, height: 865 })
      && !covers(small, SPEC.read) && !covers({ width: 1022, height: 760 }, SPEC.read, { width: 1280, height: 1024 }),
    'a 1024x768 display is recorded whole, and that covers the read: all of it, as GDI reads it; a part of a display never does');
    ok(same(fitSize({ width: 3440, height: 1440 }, 720, { width: 854, height: 480 }), { width: 1280, height: 536 }),
      'covering the Performance profile\'s 854x480, a 3440x1440 display at 720p is the box\'s 1280x536');
    // Measured on this PC's Chromium: asked a 1280x600 box on a 1920x1080
    // display, the track came back 1280x600, the box and not the screen.
    ok(aspectKept({ width: 1280, height: 720 }, { width: 1920, height: 1080 })
      && !aspectKept({ width: 1280, height: 600 }, { width: 1920, height: 1080 })
      && !aspectKept({ width: 1152, height: 720 }, { width: 1920, height: 1080 }),
    'a track the size of the display\'s shape keeps it, and the box this Chromium hands back for another shape does not');
    ok(codecFor({ width: 1280, height: 720 }) === 'avc1.42E01F' && codecFor({ width: 1920, height: 1080 }) === 'avc1.42E028'
      && codecFor({ width: 1720, height: 720 }) === 'avc1.42E028' && codecFor({ width: 1280, height: 800 }) === 'avc1.42E028',
    'H.264 Baseline, level 3.1 up to 3600 macroblocks (1280x720) and 4.0 past it, as the spike\'s gate was asked');
    ok(codecFor({ width: 1288, height: 712 }) === 'avc1.42E028' && codecFor({ width: 1276, height: 720 }) === 'avc1.42E01F',
      'counted in macroblocks, not pixels: 1288x712 is fewer pixels than 1280x720 and 3645 macroblocks, past level 3.1');
    const rate = (w, hh, res) => bitrateFor({ width: w, height: hh }, res);
    ok(rate(1280, 720, 720) === SPEC.res720.bitrate && rate(1920, 1080, 1080) === SPEC.res1080.bitrate
      && rate(1720, 720, 720) === Math.round(SPEC.res720.bitrate * (1720 * 720) / (1280 * 720))
      && rate(2560, 720, 720) === 2 * SPEC.res720.bitrate && rate(5120, 1440, 720) === 2 * SPEC.res720.bitrate
      && rate(1366, 768, 1080) === SPEC.res1080.bitrate && rate(2560, 720, 1080) === SPEC.res1080.bitrate,
    'the bitrate is the box\'s, more in proportion to the pixels past it, and twice the box\'s at most');
  });

  await section('what the page is told to record:', async () => {
    const h = harness();
    const p = await h.start();
    const s = p && p.started;
    ok(s && s.width === SPEC.res720.width && s.height === SPEC.res720.height && s.bitrate === SPEC.res720.bitrate
      && s.fps === SPEC.askFps && s.keyframeMs === SPEC.keyframeMs && s.timesliceMs === SPEC.timesliceMs && s.sourceId === 'screen:0:0',
    '720p by default: 1280x720 of a 1920x1080 display, 3 Mbps, asked for 60 fps, a keyframe and a chunk every second', JSON.stringify(s));
    ok(s && s.codec === 'avc1.42E01F' && s.mimeTypes[0] === 'video/x-matroska;codecs=avc1'
      && s.mimeTypes.every((m) => /avc1|h264/.test(m)) && !s.mimeTypes.some((m) => /vp8|vp9|av1/.test(m)),
    'H.264 only, the Matroska type first', JSON.stringify(s && s.mimeTypes));
    ok(same(h.rec.liveView(), { res: '720', width: 1280, height: 720, fps: null }) && same(h.rec.view().live, h.rec.liveView()),
      'Settings is told the setting and the size the track is, 1280x720 (no picture change yet, so no frame rate)', JSON.stringify(h.rec.liveView()));
    await h.stop();
    ok(h.rec.liveView() === null && h.rec.view().live === null, 'and nothing once it is not recording');
    const h2 = harness({ prefsInit: { recordingRes: '1080' }, display: { width: 2560, height: 1440 } });
    const s2 = (await h2.start()).started;
    ok(s2.width === SPEC.res1080.width && s2.height === SPEC.res1080.height && s2.bitrate === SPEC.res1080.bitrate && s2.codec === 'avc1.42E028',
      '1080p from Settings: 1920x1080 of a 2560x1440 display at 6 Mbps', JSON.stringify(s2));
    await h2.stop();
    const wideH = harness({ display: { width: 3440, height: 1440 } });
    const sw = (await wideH.start()).started;
    ok(sw.width === 1720 && sw.height === 720 && sw.codec === 'avc1.42E028' && sw.bitrate === Math.round(SPEC.res720.bitrate * 1720 / 1280),
      'a 3440x1440 display at 720p: 1720x720, level 4.0, the bitrate in proportion (4.03 Mbps)', JSON.stringify(sw));
    await wideH.run(4);
    ok(wideH.capture.stream && wideH.rec.liveView().height === 720 && wideH.rec.liveView().width === 1720,
      'it covers the read, so the read is served from it, and Settings is told 1720x720');
    await wideH.stop();
    // The track as it came back, not as it was asked: a laptop on 1080p.
    const laptop = harness({ prefsInit: { recordingRes: '1080' }, display: { width: 1366, height: 768 }, trackSize: { width: 1360, height: 764 } });
    await laptop.start();
    ok(laptop.rec.liveView().res === '1080' && laptop.rec.liveView().width === 1360 && laptop.rec.liveView().height === 764,
      'Settings is told the size the track came back at (1360x764), never the setting\'s 1080', JSON.stringify(laptop.rec.liveView()));
    await laptop.stop();
    const h3 = harness({ noSource: true });
    await h3.start();
    ok(!h3.pages.length && h3.rec.state === 'idle', 'no source that is the primary display: no page, nothing recorded');
    const b3 = await h3.stop();
    ok(b3 && b3.outcome === 'error', 'and the session says error', JSON.stringify(b3));
  });

  await section('a recording that cannot cover the read\'s frame leaves the read on GDI, and records on:', async () => {
    const h = harness({ display: { width: 5760, height: 1080 } });
    const p = await h.start();
    await h.run(70);
    ok(h.rec.state === 'recording' && p.count('compare') >= 2 && h.capture.stream === null,
      'brought down to level 4.0 under the read\'s 720 rows: compared, and still never served, for a minute and more');
    const b = await h.stop();
    ok(b && b.outcome === 'recorded' && b.minutes > 1, 'and the recording went on to its end', JSON.stringify(b));
    // A display smaller than the read's frame is recorded whole: the read is
    // the stream's, a 1280x720 frame stretched up from all of it as GDI would.
    const small = harness({ display: { width: 1024, height: 768 } });
    await small.start();
    await small.run(4);
    const ss = small.capture.stream;
    const up = ss ? await Promise.all([ss.grab({ targetW: 1280, targetH: 720, jpegQuality: 70 }), settle()]).then((x) => x[0]) : null;
    ok(ss && small.page().started.width === 1024 && small.page().started.height === 768 && up === STREAM_JPEG.toString('base64'),
      'a 1024x768 display, recorded whole: served, and a 1280x720 frame asked of it is the stream\'s, never the helper\'s launch a frame');
    await small.stop();
    // Performance's frame covered at the start, then Standard asked of it:
    // that read is the GDI helper's, and the next one at Performance's size
    // is the stream's again.
    const g = harness({ display: { width: 3440, height: 1440 }, readSize: { width: 854, height: 480 } });
    await g.start();
    await g.run(4);
    const s = g.capture.stream;
    ok(s && g.page().started.width === 1280 && g.page().started.height === 536, 'covering Performance\'s 854x480 with 1280x536: served');
    const standard = await Promise.all([s.grab({ targetW: 1280, targetH: 720, jpegQuality: 70 }), settle()]).then((x) => x[0]);
    const perf = await Promise.all([s.grab({ targetW: 854, targetH: 480, jpegQuality: 50 }), settle()]).then((x) => x[0]);
    ok(standard === null && perf === STREAM_JPEG.toString('base64') && g.page().count('grab') === 1 && g.rec.state === 'recording',
      'a 1280x720 frame asked of a 536 row track is no frame (GDI takes that read), an 854x480 one is the stream\'s');
    await g.stop();
  });

  await section('the recording into one minute pages, through webm.js (the real fixture, pages of 4 s):', async () => {
    const FIXTURE = path.join(__dirname, 'fixtures', 'recording-canvas.mkv');
    const META = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'recording-canvas.json'), 'utf8'));
    const FILE = fs.readFileSync(FIXTURE);
    // The recorder started two seconds before its first frame (a still screen
    // sends its first when something changes): the start is only a floor.
    const h = harness({ pageMs: 4000, startEarly: 2000 });
    const p = await h.start();
    const wall0 = h.clock.now();
    let off = 0;
    for (const c of META.chunks) {
      // Each chunk at the wall time it came, as the page stamps it.
      await h.clock.advance(wall0 + c.atMs - h.clock.now());
      p.emit('chunk', { seq: p.n, wall: h.clock.now(), data: toAB(FILE.subarray(off, off + c.size)) });
      p.n += 1;
      off += c.size;
    }
    const block = await h.stop();
    const seg = h.rec.segments[0];
    const dir = seg ? path.relative(ROOT, seg.dir) : '';
    const names = h.files.under(ROOT);
    const truth = webm.indexFile(FIXTURE);
    const pagesWanted = [...new Set(truth.clusters.map((c) => Math.floor(c.timecode / 4000)))].map((k) => `${dir}/page-${String(k).padStart(5, '0')}.mkv`);
    ok(same(names, [`${dir}/init.mkv`].concat(pagesWanted).sort()), `under userData/recording/${dir}: init.mkv and one page per 4 s`, names.join(', '));
    const read = (n) => h.files.read(path.join(ROOT, n), 0, 1e9);
    const joined = Buffer.concat([read(`${dir}/init.mkv`)].concat(pagesWanted.map(read)));
    ok(joined.equals(FILE), `the init segment and the pages, joined, are the recording byte for byte (${joined.length} of ${FILE.length})`);
    ok(read(`${dir}/init.mkv`).equals(truth.init), `init.mkv is every byte before the first Cluster (${truth.init.length}), written once`);
    let whole = true;
    let counts = [];
    for (const n of pagesWanted) {
      const r = webm.createReader();
      r.push(Buffer.concat([truth.init, read(n)]));
      r.end();
      counts.push(r.clusters.length);
      if (r.error || !r.clusters.length || r.clusters.some((c) => c.keyframe !== true || c.truncated)) whole = false;
    }
    const want = pagesWanted.map((n, k) => truth.clusters.filter((c) => Math.floor(c.timecode / 4000) === Number(n.slice(-9, -4))).length);
    ok(whole && same(counts, want), `each page, after the init segment, reads as whole Clusters opening on keyframes (${counts.join(', ')})`, `want ${want.join(', ')}`);
    const zero = seg ? seg.zero() : null;
    ok(zero !== null && zero >= wall0 && zero - wall0 <= 40,
      `the recording's 0 on the wall clock, set by the newest frame each chunk carried, is within 40 ms of its first frame: +${zero - wall0} ms (the start said -2000)`);
    // A clip cut out of the pages by wall clock is the clip webm.js cuts out of
    // the whole recording at the same moments.
    const clip = h.rec.cutClip(wall0 + 5000, wall0 + 9000);
    const direct = webm.cutClip({ init: truth.init, clusters: webm.indexFile(FIXTURE, { keepBytes: true }).clusters, from: wall0 + 5000 - zero, to: wall0 + 9000 - zero });
    ok(clip && direct && clip.bytes.equals(direct) && clip.mime === 'video/x-matroska',
      `a clip of 5 s to 9 s cut from the pages is the one cut from the recording (${clip ? clip.bytes.length : 0} bytes, video/x-matroska)`);
    ok(h.rec.cutClip(wall0 + 60000, wall0 + 70000) === null, 'and a moment the recording never reached has no clip');
    ok(block && block.outcome === 'recorded' && block.minutes === 0.2 && block.encoderOk === true && block.mode === 'auto' && block.res === '720',
      'the session ends recorded, 0.2 minutes, the hardware encoder found', JSON.stringify(block));
    ok(p.closed && h.capture.stream === null && same(h.running, [true, false]), 'stopped cleanly: the page closed, the reads on GDI, running true then false');
  });

  await section('nothing recorded stays in memory: ten minutes of 3 Mbps Clusters (375 KB a second):', async () => {
    const gc = fullGc();
    ok(!!gc, 'a full garbage collection can be asked for, so what is measured is what is kept');
    const files = sizeFiles();
    const h = harness({ files });
    const p = await h.start();
    const seg = h.rec.segments[0];
    // Each Cluster as the Segment is handed it, looked at once it is placed.
    let placed = 0;
    let stillCarrying = 0;
    const place = seg.place.bind(seg);
    seg.place = (c) => { const r = place(c); placed += 1; if (c.data !== undefined) stillCarrying += 1; return r; };
    if (gc) await gc();
    const before = process.memoryUsage().arrayBuffers;
    for (let i = 0; i < 600; i++) {
      const data = i === 0 ? Buffer.concat([SYNTH_INIT, bigCluster(0)]) : bigCluster(i * 1000);
      p.emit('chunk', { seq: p.n, wall: h.clock.now(), data: toAB(data) });
      p.n += 1;
      p.health();
      await h.clock.advance(1000);
    }
    if (gc) await gc();
    const grew = process.memoryUsage().arrayBuffers - before;
    const onDisk = files.total();
    ok(h.rec.state === 'recording' && placed === 599 && onDisk > 90 * 375000 && onDisk < 210 * 375000,
      `600 s recorded, 599 Clusters written, what is two minutes old deleted (${(onDisk / 1e6).toFixed(1)} MB on disk)`);
    ok(seg.reader.clusters.length === 0, `the reader keeps no list of the Clusters it closed (${seg.reader.clusters.length})`);
    ok(stillCarrying === 0 && seg.pages.every((pg) => pg.clusters.every((c) => c.data === undefined)) && !('data' in (seg.reader.open || {})),
      `no Cluster the reader or the Segment still references carries its bytes (${stillCarrying} of ${placed} did once placed)`);
    ok(gc && grew < 30 * 1024 * 1024, `and the process's ArrayBuffers grew ${(grew / 1048576).toFixed(1)} MB over it, under 30 (225 MB of Clusters went through)`);
    await h.stop();
  });

  await section('a page that writes nothing, or a broken stream, gives up as error and keeps what it wrote:', async () => {
    const h = harness();
    const p = await h.start();
    await h.run(3);
    h.files.failAppend = true;
    await h.run(2);
    ok(h.rec.state === 'idle' && p.closed && h.capture.stream === null, 'a write that fails stops the recording, the reads on GDI');
    const b = await h.stop();
    ok(b && b.outcome === 'error' && !h.notices.length, 'outcome error, and no notice: nothing the player can do', JSON.stringify(b));
    const h2 = harness();
    const p2 = await h2.start();
    await h2.run(2);
    p2.emit('chunk', { seq: p2.n + 1, wall: h2.clock.now(), data: toAB(synthCluster(5000)) });
    await settle();
    ok(h2.rec.state !== 'recording' && (await h2.stop()).outcome === 'error', 'a chunk that never came (the next seq skipped) is a broken recording');
  });

  await section('a page that goes away (its renderer crashed):', async () => {
    const h = harness();
    const p = await h.start();
    await h.run(5);
    ok(h.capture.stream && h.rec.state === 'recording', 'recording, and serving the read');
    p.dead = true;
    p.emit('gone', { why: 'crashed' });
    await settle();
    ok(h.capture.stream === null && h.rec.state !== 'recording', 'gone: the reads are back on the GDI helper at once');
    await h.clock.advance(1000);
    ok(p.closed && h.rec.state === 'idle', 'and its window is closed without waiting on a stop a dead page cannot answer');
    const b = await h.stop();
    ok(b && b.outcome === 'error' && !h.notices.length && h.pages.length === 1, 'the session ends as error, no notice, nothing started again', JSON.stringify(b));
  });

  await section('holds and their release:', async () => {
    const h = harness();
    const p = await h.start();
    const startAt = h.clock.now();
    // Four minutes recorded, no match in progress: what is two minutes old goes.
    await h.run(240);
    const seg = h.rec.segments[0];
    const pagesAt = () => seg.pages.map((x) => x.k);
    ok(!pagesAt().includes(0) && pagesAt().includes(2) && pagesAt().includes(3),
      'four minutes in, out of a match: pages 0 and 1 (over two minutes old) gone, 2 and 3 kept', `pages ${pagesAt().join(',')}`);
    const filesNow = h.files.under(ROOT).filter((n) => /page-0000[01]/.test(n));
    ok(!filesNow.length, 'and their files deleted', filesNow.join(', '));
    // A match in progress since 3:00 keeps every page from its start.
    h.env.inMatch = true;
    h.env.keepSince = startAt + 180000;
    await h.run(180);
    const kept = pagesAt();
    ok(kept.includes(3) && kept.includes(4) && kept.includes(5) && kept.includes(6) && !kept.includes(2),
      'a match in progress from 3:00: every page since kept however old (3 to 6), the one before it gone', `pages ${kept.join(',')}`);
    // It ends: held [3:00, 7:00] until its review has looked.
    const hold = h.rec.hold(startAt + 180000, startAt + 420000);
    h.env.inMatch = false;
    h.env.keepSince = null;
    await h.stop();
    ok(p.closed, 'recording stopped');
    await h.clock.advance(5 * 60000);
    const heldPages = h.rec.segments.length ? h.rec.segments[0].pages.map((x) => x.k) : [];
    ok(same(heldPages, [3, 4, 5, 6]), 'five minutes after, the held match\'s pages are all still there', `pages ${heldPages.join(',')}`);
    h.rec.release(hold);
    await h.clock.advance(1000);
    ok(!h.rec.segments.length && !h.files.under(ROOT).length, 'released: the pages go at the next tick, and the folder with its init segment');

    // A hold never released lasts an hour.
    const h2 = harness();
    await h2.start();
    await h2.run(70);
    const t = h2.clock.now();
    const hold2 = h2.rec.hold(t - 70000, t);
    await h2.stop();
    await h2.clock.advance(59 * 60000);
    ok(h2.rec.segments.length === 1 && h2.rec.segments[0].pages.length === 2, 'a hold never released keeps its pages for 59 minutes');
    await h2.clock.advance(2 * 60000);
    ok(!h2.rec.segments.length && !h2.files.under(ROOT).length && hold2, 'and they go once its hour is up');

    // The page being written is never deleted, however old its last frame:
    // the PC asleep for five minutes, no chunk, then one tick.
    const hj = harness();
    await hj.start();
    await hj.run(30);
    const segj = hj.rec.segments[0];
    hj.clock.jump(5 * 60000);
    await hj.clock.advance(1000);
    ok(segj.pages.length === 1 && segj.writing() === segj.pages[0] && hj.files.under(ROOT).some((n) => /page-00000/.test(n)),
      'the page being written stays, though its last frame is five minutes old');
    await hj.stop();

    // Two minutes is the line.
    const h3 = harness();
    await h3.start();
    await h3.run(30);
    await h3.stop();
    const last = h3.rec.segments[0].spanOf(h3.rec.segments[0].pages[0]).to;
    await h3.clock.advance(last + 119000 - h3.clock.now());
    ok(h3.rec.segments.length === 1, 'a page whose last frame is 1:59 old is kept');
    await h3.clock.advance(2000);
    ok(!h3.rec.segments.length, 'and gone at 2:01');
  });

  await section('a Valorant match as the recorder takes it, on the real reader (valorantInMatch, valorantKeepSince):', async () => {
    // index.js matchInProgress(), a Valorant session's half: the seal's own
    // test, cautious on purpose, and unchanged. The recorder takes it as given.
    const inProgress = (e) => !!e.endWatch && !e.endWatch.ended && (e.ledger.size() > 0 || !e.inLobby);
    const fresh = readerAfter(0, 0);
    const playing = readerAfter(33, 0);
    const menus = readerAfter(33, 600);
    const t0 = fresh.e.matchStartedAt;
    ok(inProgress(fresh.e) && fresh.e.analyzedFrames === 0
      && !R.valorantInMatch(fresh.e, inProgress(fresh.e)) && R.valorantKeepSince(fresh.e, inProgress(fresh.e), fresh.now) === null,
    'Start pressed, no read landed yet (the server down, the credits out): "in a match" to the seal, neither judged nor kept from');
    ok(playing.e.ledger.size() === 2 && R.valorantInMatch(playing.e, inProgress(playing.e))
      && R.valorantKeepSince(playing.e, inProgress(playing.e), playing.now) === playing.e.matchStartedAt,
    'round 2 in play, read by the real reader off the real Split match: judged, and kept from the match\'s start');
    ok(menus.e.inLobby && menus.e.ledger.size() === 2 && !menus.e.endWatch.ended && inProgress(menus.e)
      && !R.valorantInMatch(menus.e, inProgress(menus.e)),
    'left in round 2, then ten minutes of menus: the watch never ends a 2 round match, the seal says in a match, the recorder does not judge it');
    ok(R.valorantKeepSince(menus.e, true, menus.now) === menus.e.matchStartedAt
      && R.valorantKeepSince(menus.e, true, menus.e.matchStartedAt + 2 * 3600000) === menus.e.matchStartedAt + 2 * 3600000 - SPEC.keepMatchMs,
    'kept from that match\'s start through the menus (one menu read mid round must not cost a match its pages), ninety minutes back at most');

    // In the recorder: a busy PC (99% CPU) for four minutes before any read
    // lands is never judged, and pages two minutes old go as out of a match.
    const busy = { recorderCpu: 3, systemCpu: 99 };
    const before = harness({
      inMatch: () => R.valorantInMatch(fresh.e, inProgress(fresh.e)),
      keepSince: () => R.valorantKeepSince(fresh.e, inProgress(fresh.e), before.clock.now()),
    });
    before.env.metrics = busy;
    await before.start();
    await before.run(240);
    const kept = before.rec.segments[0] ? before.rec.segments[0].pages.map((x) => x.k) : [];
    ok(before.rec.state === 'recording' && !before.notices.length && !kept.includes(0) && !kept.includes(1),
      `before any read lands, four minutes at 99% CPU: never given up, and pages two minutes old deleted (pages ${kept.join(',')})`);
    await before.stop();
    const after = harness({
      inMatch: () => R.valorantInMatch(menus.e, inProgress(menus.e)),
      keepSince: () => R.valorantKeepSince(menus.e, inProgress(menus.e), after.clock.now()),
    });
    after.env.metrics = busy;
    await after.start();
    await after.run(60);
    ok(after.rec.state === 'recording' && !after.notices.length, 'the menus after a match left in round 2, a minute at 99% CPU (the next loading screen): never given up');
    await after.stop();
    const inPlay = harness({ inMatch: () => R.valorantInMatch(playing.e, inProgress(playing.e)) });
    inPlay.env.metrics = busy;
    await inPlay.start();
    await inPlay.run(30);
    ok(inPlay.rec.state !== 'recording' && inPlay.notices.length === 1, 'and round 2 in play at 99% CPU is judged, and gives up as busy');
    await inPlay.stop();

    // Three hours of one minute pages since that match began, ninety minutes
    // of them before the bound: only the last ninety minutes are kept.
    const end = t0 + 3 * 3600000;
    const files = memFiles();
    const rec = new Recorder({ root: ROOT, files, now: () => end, keepSince: () => R.valorantKeepSince(menus.e, true, end), log: () => {} });
    const seg = new R.Segment(path.join(ROOT, 'rec-three-hours'), files, 60000);
    seg.startWall = t0;
    seg.hi = t0;
    seg.init = Buffer.alloc(1);
    seg.active = false;
    for (let k = 0; k < 180; k++) seg.pages.push({ k, name: `page-${k}.mkv`, bytes: 1, clusters: [{ timecode: k * 60000, last: k * 60000 + 59967 }] });
    rec.segments.push(seg);
    rec.prune(end);
    ok(seg.pages.length === 90 && seg.pages[0].k === 90, `three hours since the match began: ${seg.pages.length} of 180 pages kept, the last ninety minutes`);
  });

  await section('the sweep at launch:', () => {
    const files = memFiles();
    files.write(path.join(ROOT, 'rec-2026-10-09T20-00-00-000Z', 'init.mkv'), Buffer.from('x'));
    files.write(path.join(ROOT, 'rec-2026-10-09T20-00-00-000Z', 'page-00000.mkv'), Buffer.from('screen'));
    files.write(path.join(ROOT, 'rec-2026-10-09T21-00-00-000Z', 'page-00007.mkv'), Buffer.from('screen'));
    files.write(path.join(ROOT, 'stray.tmp'), Buffer.from('?'));
    const beside = path.join(path.dirname(ROOT), 'ai-log', 'session-x', 'log.json');
    files.write(beside, Buffer.from('{}'));
    const h = harness({ files });
    const n = h.rec.sweep();
    ok(n === 3 && !h.files.under(ROOT).length, `every recording a run left is deleted (${n} entries), so a crash leaves no screen on disk`);
    ok(files.files.has(path.resolve(beside)), 'and nothing outside userData/recording is touched');
  });

  await section('what nothing sweeps: an uninstall, and the helper that reads the screen:', () => {
    // The uninstaller kills the app before it runs, so no quit deletes the
    // recording and no launch after it sweeps it: the uninstaller does,
    // inside the guard an update skips, as it deletes the profile's other data.
    const nsh = fs.readFileSync(path.join(__dirname, '..', 'build', 'uninstaller.nsh'), 'utf8').split(/\r?\n/).map((l) => l.trim());
    const guard = nsh.findIndex((l) => l === '${ifNot} ${isUpdated}');
    const end = nsh.findIndex((l, i) => i > guard && l === '${endIf}');
    const rm = (dir, sub) => nsh.findIndex((l) => l === `RMDir /r "$APPDATA\\${dir}\\${sub || 'recording'}"`);
    const inGuard = (i) => i > guard && i < end;
    ok(guard >= 0 && end > guard && inGuard(rm('Occlara')) && inGuard(rm('GhostCoach 2.0'))
      && !nsh.some((l) => /^RMDir \/r "\$APPDATA\\Occlara\\reviews/.test(l)),
    'a real uninstall deletes userData\\recording (and the old profile\'s), never on an update, and the reviews stay');
    // The AI log is the screen too, frames of five sessions, and the
    // app prunes it only at a Start, which never comes after an uninstall.
    ok(inGuard(rm('Occlara', 'ai-log')) && inGuard(rm('GhostCoach 2.0', 'ai-log')),
      'and the AI log\'s frames of the screen with it (both profiles), never on an update');
    // A logout posts its session's counts (the block is not marked exiting),
    // which needs the licence key: the recording ends before it is cleared.
    const idx = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'index.js'), 'utf8');
    const out = idx.slice(idx.indexOf('function logoutToActivation('));
    const body = out.slice(0, out.search(/\r?\n\}\r?\n/));
    const shutAt = body.indexOf('recorder.shutdown(');
    ok(shutAt > 0 && body.indexOf('licenseService.clear()') > shutAt,
      'a logout ends the recording before it clears the licence key, so its counts are posted with it');
    // League's screen is never read: its recording covers the standard frame
    // whatever Performance says (readSize null is READ_SIZE), as Settings says.
    const rs = idx.slice(idx.indexOf('  readSize: () => {'));
    const rsBody = rs.slice(0, rs.indexOf('\n  },'));
    ok(/if \(engine instanceof LolRecorder\) return null;/.test(rsBody) && /captureQuality/.test(rsBody),
      'a League session\'s recording covers the standard frame, never the Performance one: it has no read to cover', rsBody.split('\n')[0]);
    // At 125% a helper that is not DPI aware copies only the top left
    // 1536x864 of a 1920x1080 screen. Built from the source beside it.
    const exe = fs.readFileSync(path.join(__dirname, '..', 'native', 'OcclaraCapture.exe'));
    const cs = fs.readFileSync(path.join(__dirname, '..', 'native', 'OcclaraCapture.cs'), 'utf8');
    const main = cs.slice(cs.indexOf('static int Main('));
    const firstCall = main.slice(main.indexOf('{') + 1).replace(/\/\/[^\n]*\n/g, '').trim();
    ok(exe.includes(Buffer.from('SetProcessDPIAware', 'ascii')) && /^try \{ SetProcessDPIAware\(\); \}/.test(firstCall)
      && /\[DllImport\("user32\.dll"\)\]\s*static extern bool SetProcessDPIAware\(\);/.test(cs),
    'the GDI helper makes itself DPI aware (user32 SetProcessDPIAware) before anything measures the screen, and the shipped exe carries it');
  });

  await section('the free disk guard:', async () => {
    const h = harness();
    h.env.free = SPEC.diskStart - 1;
    await h.start();
    ok(!h.pages.length, 'one byte under 8 GB free: no page opened, nothing recorded');
    ok(h.notices.length === 1 && /8 GB/.test(h.notices[0].text) && /still reads your screen every second/.test(h.notices[0].text)
      && !DASHES.test(h.notices[0].text), 'one notice, saying 8 GB and that the reading goes on', h.notices.map((x) => x.text).join(' | '));
    ok((await h.stop()).outcome === 'disk', 'the session ends as disk');
    const h2 = harness();
    h2.env.free = SPEC.diskStart;
    await h2.start();
    await h2.run(5);
    ok(h2.rec.state === 'recording' && h2.capture.stream, '8 GB exactly: it records, and serves the read');
    h2.env.free = SPEC.diskStop;
    await h2.run(31);
    ok(h2.rec.state === 'recording', '4 GB exactly: it goes on');
    h2.env.free = SPEC.diskStop - 1;
    await h2.run(31);
    ok(h2.rec.state === 'idle' && h2.page().closed && h2.capture.stream === null, 'under 4 GB: stopped within the 30 s check, the reads back on GDI');
    ok(h2.notices.length === 1 && /4 GB/.test(h2.notices[0].text), 'with one notice saying 4 GB', h2.notices.map((x) => x.text).join(' | '));
    ok((await h2.stop()).outcome === 'disk', 'the session ends as disk');
  });

  await section('every health rule, on its own, at its boundary (createHealth):', () => {
    // The verdict, and at which second's sample it came (`second`).
    const run = (n, sample, opts) => {
      const hh = createHealth(opts && opts.limits);
      let at = 0;
      let got = null;
      for (let i = 0; i < n && !got; i++) {
        got = hh.sample({ at, inMatch: true, fps: 30, changing: true, stalled: false, lagMs: 0, recorderCpu: 3, systemCpu: 30, ...sample(i) });
        if (got) got = { ...got, second: i };
        at += 1000;
      }
      return got;
    };
    const RULES = [
      ['fps', { fps: SPEC.minFps - 0.1, changing: true }, { fps: SPEC.minFps, changing: true }],
      ['lag', { lagMs: SPEC.maxLagMs + 1 }, { lagMs: SPEC.maxLagMs }],
      ['recorderCpu', { recorderCpu: SPEC.maxRecorderCpu + 0.1 }, { recorderCpu: SPEC.maxRecorderCpu }],
      ['systemCpu', { systemCpu: SPEC.maxSystemCpu + 0.1 }, { systemCpu: SPEC.maxSystemCpu }],
    ];
    for (const [rule, bad, edge] of RULES) {
      ok(run(SPEC.sustainS, () => bad) === null, `${rule}: bad for 19 s straight (20 samples, 0 to 19 s), nothing yet`);
      const v = run(SPEC.sustainS + 1, () => bad);
      ok(v && v.rule === rule && v.forMs === SPEC.sustainS * 1000, `${rule}: bad for 20 s straight gives up`, JSON.stringify(v));
      ok(run(120, () => edge) === null, `${rule}: at the line itself for two minutes, never`, JSON.stringify(edge));
      const broken = run(60, (i) => (i === 10 ? {} : bad));
      ok(broken && broken.rule === rule && broken.forMs === 20000 && broken.second === 31,
        `${rule}: one good second at 10 s starts the 20 s again (given up at 31 s, not 20)`, JSON.stringify(broken));
    }
    ok(run(120, () => ({ fps: 2, changing: false, stalled: false })) === null,
      'two frames a second on a still screen is not a busy PC (the capturer only sends what changed)');
    const stalled = run(30, () => ({ fps: 0, changing: false, stalled: true }));
    ok(stalled && stalled.rule === 'fps', 'but no frame at all while the newest is old is a capture that stopped, and counts');
    const hh = createHealth();
    let v = null;
    for (let i = 0; i < 120 && !v; i++) v = hh.sample({ at: i * 1000, inMatch: false, fps: 1, changing: true, lagMs: 99999, recorderCpu: 400, systemCpu: 100 });
    ok(v === null, 'outside a match nothing is judged, however bad, for two minutes');
    for (let i = 120; i < 139 && !v; i++) v = hh.sample({ at: i * 1000, inMatch: true, fps: 1, changing: true, lagMs: 0, recorderCpu: 3, systemCpu: 30 });
    ok(v === null, 'and a match that begins starts every streak at nothing');
    const gap = createHealth();
    let g = null;
    for (let i = 0; i < 15; i++) g = gap.sample({ at: i * 1000, inMatch: true, fps: 1, changing: true });
    for (let i = 21; i < 35 && !g; i++) g = gap.sample({ at: i * 1000, inMatch: true, fps: 1, changing: true });
    ok(g === null, 'six seconds without a sample (the main process held up) starts a streak again');
    ok(run(25, () => ({ fps: 50, changing: true }), { limits: { minFps: 1000, sustainMs: 3000 } }).rule === 'fps',
      'the dev limits lay over the rule: a floor of 1000 fps for 3 s gives up at once');
  });

  await section('the page\'s own account of the capture (health.js, as the page loads it), through the recorder and its rules:', async () => {
    const Account = require('../src/renderer/recorder/health.js');
    // A whole match of it: frames arriving at the page's clock times given
    // (ms), each a picture unlike the last, or each the same (a still
    // screen). The page's own account is asked once a second, as its timer
    // does, and what it says is what main is told, chunk and all.
    const capture = async (arrivals, opts) => {
      const o = opts || {};
      const h = harness();
      h.env.inMatch = true;
      const p = await h.start();
      const tally = Account.createTally({ now: 0, frames: 0 });
      const picture = (n) => ({ luma: new Float32Array(THUMB_PX).fill(o.still ? 90 : (n * 9) % 240), mean: 90 });
      let k = 0;
      let newestAt = null;
      let gaveUpAt = null;
      for (let s = 1; s <= (o.seconds || 300) && gaveUpAt === null; s++) {
        const now = s * 1000;
        while (k < arrivals.length && arrivals[k] <= now) { newestAt = arrivals[k]; k += 1; }
        const n = k;
        const a = tally.second({ now, frames: k, newestAt, thumb: () => picture(n) });
        p.feed();
        p.health({ fps: a.fps, changing: a.changing, luma: a.luma, frameAgeMs: a.frameAgeMs, lagMs: 0 });
        await h.clock.advance(1000);
        if (h.rec.state !== 'recording') gaveUpAt = s;
      }
      const b = await h.stop();
      return { gaveUpAt, outcome: b && b.outcome, notices: h.notices.length };
    };
    const every = (ms, until) => { const out = []; for (let t = ms; t <= until; t += ms) out.push(t); return out; };
    // Frames at random, one a second on average, from a seeded generator so
    // every run is the same run.
    const poisson = (seed, until) => {
      let a = seed >>> 0;
      const rnd = () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
      const out = [];
      for (let t = -Math.log(1 - rnd()) * 1000; t <= until; t += -Math.log(1 - rnd()) * 1000) out.push(t);
      return out;
    };
    for (const [what, arrivals] of [['a frame every 1.5 s', every(1500, 400000)], ['a frame every 5 s', every(5000, 400000)]]) {
      const r = await capture(arrivals);
      ok(r.gaveUpAt !== null && r.gaveUpAt <= 30 && r.outcome === 'busy' && r.notices === 1,
        `${what}, the picture changing: gives up as busy within 30 s of the match (${r.gaveUpAt === null ? 'never, in 5 minutes' : r.gaveUpAt + ' s'})`);
    }
    const seeds = [1, 2, 3, 4, 5];
    const randomly = [];
    for (const seed of seeds) randomly.push((await capture(poisson(seed, 400000))).gaveUpAt);
    ok(randomly.every((x) => x !== null && x <= 30), `a frame a second at random (5 seeded runs): each gives up within 30 s (${randomly.map((x) => (x === null ? 'never' : x + ' s')).join(', ')})`);
    const healthy = await capture(every(1000 / 30, 400000));
    ok(healthy.gaveUpAt === null && healthy.outcome === 'recorded', `a healthy capture, 30 frames a second, five minutes of a match: never (${healthy.gaveUpAt})`);
    const still = await capture(every(500, 400000), { still: true });
    ok(still.gaveUpAt === null && still.outcome === 'recorded', `a still screen, the same frame twice a second, five minutes of a match: never (${still.gaveUpAt})`);
    // The account itself: a second with no new frame says what the last frame said.
    const t = Account.createTally({ now: 0, frames: 0 });
    const pic = (v) => () => ({ luma: new Float32Array(THUMB_PX).fill(v), mean: v });
    const s1 = t.second({ now: 1000, frames: 1, newestAt: 900, thumb: pic(10) });
    const s2 = t.second({ now: 2000, frames: 2, newestAt: 1900, thumb: pic(40) });
    const s3 = t.second({ now: 3000, frames: 2, newestAt: 1900, thumb: () => { throw new Error('no frame came, nothing to draw'); } });
    const s4 = t.second({ now: 4000, frames: 3, newestAt: 3900, thumb: pic(40) });
    ok(!s1.changing && s2.changing && s2.fps === 1 && s3.changing && s3.fps === 0 && s3.luma === null && s3.frameAgeMs === 1100 && !s4.changing,
      'the account: the first frame has nothing to differ from, the second differs, a second with no new frame carries "changing", the same picture again is still',
      JSON.stringify([s1, s2, s3, s4]));
  });

  await section('each rule, in the recorder: the reads back on GDI, and one notice:', async () => {
    const cases = [
      ['fps', (h) => ({ health: { fps: 5, changing: true } })],
      ['lag', () => ({ noChunk: true, health: { lagMs: 0 } })],
      ['recorderCpu', (h) => { h.env.metrics = { recorderCpu: 75, systemCpu: 30 }; return null; }],
      ['systemCpu', (h) => { h.env.metrics = { recorderCpu: 3, systemCpu: 99 }; return null; }],
    ];
    for (const [rule, bad] of cases) {
      const h = harness();
      h.env.inMatch = true;
      const p = await h.start();
      await h.run(5);
      ok(h.capture.stream && h.rec.state === 'recording', `${rule}: in a match, the read served from the stream once compared`);
      let seconds = 0;
      while (h.rec.state === 'recording' && seconds < 60) { await h.run(1, () => bad(h)); seconds += 1; }
      const lagGrace = rule === 'lag' ? 5 : 0;   // a chunk is late only 4 s after it was due
      ok(seconds >= SPEC.sustainS + lagGrace && seconds <= SPEC.sustainS + lagGrace + 2,
        `${rule}: gave up after ${seconds} s of it, the 20 s rule`);
      ok(h.capture.stream === null && h.capture.calls[h.capture.calls.length - 1] === 'gdi' && p.closed && p.count('stop') === 1,
        `${rule}: the reads went back to the GDI helper, and the recording was stopped cleanly`);
      await h.run(10, () => bad(h));
      ok(h.notices.length === 1 && h.notices[0].text === SPEC.busyText && h.notices[0].kind === 'recorder',
        `${rule}: one notice, the spec's words, ten seconds later still one`, h.notices.map((x) => x.text).join(' | '));
      ok(h.pages.length === 1, `${rule}: given up for the session, the recorder never starts again in it`);
      const b = await h.stop();
      ok(b && b.outcome === 'busy', `${rule}: the session ends as busy`, JSON.stringify(b));
    }
    // At the moment it gives up, not once the page has finished stopping.
    const now = harness({ slowStop: 5000 });
    now.env.inMatch = true;
    const np = await now.start();
    await now.run(5);
    let given = 0;
    while (now.rec.state === 'recording' && given < 40) { await now.run(1, () => ({ health: { fps: 4, changing: true } })); given += 1; }
    ok(now.rec.state === 'stopping' && !np.closed && now.capture.stream === null && now.notices.length === 1,
      'the reads are on the GDI helper and the notice is up the moment it gives up, while the page is still stopping');
    // The page's last chunk, handed over after Stop and before its answer, as
    // MediaRecorder hands over what it held when it stops.
    const lastTc = np.n * 1000;
    np.feed();
    await now.clock.advance(6000);
    ok(np.closed && now.rec.state === 'idle', 'and the page closes once its last chunks are in');
    const nseg = now.rec.segments[0];
    const lastPage = nseg && nseg.pages[nseg.pages.length - 1];
    const lastC = lastPage && lastPage.clusters[lastPage.clusters.length - 1];
    ok(lastC && lastC.timecode === lastTc && nseg.pageChunks === np.n && nseg.chunks === np.n,
      `a chunk handed over between Stop and its answer is in the last page, and every chunk the page said it sent came (${nseg && nseg.chunks} of ${nseg && nseg.pageChunks})`);
    await now.stop();

    const slow = harness();
    slow.env.inMatch = true;
    slow.env.cadence = 3000;
    await slow.start();
    await slow.run(5);
    await slow.run(25, () => ({ health: { fps: 1, changing: true } }));
    ok(slow.notices[0] && /every 3 seconds\.$/.test(slow.notices[0].text), 'pinned at 3 s, the notice says every 3 seconds, which is true', slow.notices[0] && slow.notices[0].text);
    ok(everyText(1000) === 'every second' && everyText(2000) === 'every 2 seconds', 'and every second at the default');
    const out = harness();
    await out.start();
    await out.run(5);
    await out.run(90, () => ({ health: { fps: 1, changing: true } }));
    ok(out.rec.state === 'recording' && !out.notices.length, 'out of a match the same numbers for 90 s: still recording, no notice');
  });

  await section('two busy sessions within 7 days turn Auto off; a week apart do not:', async () => {
    const prefs = memPrefs();
    const busy = async (at) => {
      const h = harness({ prefs, at });
      h.env.inMatch = true;
      await h.start();
      await h.run(5);
      await h.run(25, () => ({ health: { fps: 3, changing: true } }));
      await h.stop();
      return h;
    };
    const a = await busy(T0);
    ok(same(prefs.data.recordingStrikes.length, 1) && prefs.data.recordingMode === 'auto' && prefs.data.recordingAutoOff === null && !a.prefsEvents,
      'one busy session: one strike, Auto stays on', JSON.stringify(prefs.data));
    const b = await busy(T0 + 3 * DAY);
    ok(prefs.data.recordingStrikes.length === 2 && prefs.data.recordingMode === 'off' && prefs.data.recordingAutoOff
      && prefs.data.recordingAutoOff.reason === 'busy' && b.prefsEvents === 1,
    'a second three days later: Auto is off, and Settings is told why', JSON.stringify(prefs.data));
    const c = harness({ prefs, at: T0 + 4 * DAY });
    await c.start();
    ok(!c.pages.length, 'the next session records nothing');
    const cb = await c.stop();
    ok(cb && cb.outcome === 'off' && cb.mode === 'off', 'and says off', JSON.stringify(cb));
    // Settings' "Try again" is Auto chosen again.
    prefs.set('recordingMode', 'auto');
    c.rec.prefsChanged();
    ok(same(prefs.data.recordingStrikes, []) && prefs.data.recordingAutoOff === null, 'Try again (Auto chosen again): the strikes and the reason are forgotten', JSON.stringify(prefs.data));
    const d = harness({ prefs, at: T0 + 5 * DAY });
    await d.start();
    ok(d.pages.length === 1, 'and the next session records');
    await d.stop();
    const prefs2 = memPrefs();
    for (const at of [T0, T0 + (SPEC.strikesDays + 1) * DAY]) {
      const h = harness({ prefs: prefs2, at });
      h.env.inMatch = true;
      await h.start();
      await h.run(5);
      await h.run(25, () => ({ health: { fps: 3, changing: true } }));
      await h.stop();
    }
    ok(prefs2.data.recordingMode === 'auto' && prefs2.data.recordingStrikes.length === 1,
      'two busy sessions eight days apart: Auto stays on, and only the newer counts', JSON.stringify(prefs2.data));
    const r = strikeOut([T0 - 8 * DAY, T0 - 6 * DAY, 'x', T0 + DAY], T0);
    ok(same(r, { strikes: [T0 - 6 * DAY, T0], off: true }), 'strikeOut keeps the last week\'s, drops the rest, and two is enough', JSON.stringify(r));
    const manual = memPrefs({ recordingMode: 'off', recordingAutoOff: { at: T0, reason: 'busy' } });
    const m = harness({ prefs: manual });
    manual.set('recordingMode', 'auto');
    m.rec.prefsChanged();
    manual.set('recordingMode', 'off');
    m.rec.prefsChanged();
    ok(manual.data.recordingAutoOff === null && manual.data.recordingMode === 'off', 'Off chosen by hand is the player\'s, not the PC\'s: no reason is kept for it');
  });

  await section('Off chosen by hand takes what was recorded with it, held or not (discard):', async () => {
    // A match recorded and ended, its recording held for its review's look,
    // the session stopped: Riot's look would land minutes later.
    const h = harness();
    await h.start();
    await h.run(70);
    const t = h.clock.now();
    h.rec.hold(t - 70000, t);
    await h.stop();
    const at = t - 30000;
    ok(h.rec.cutClip(at - 11000, at + 4000, at) !== null, 'held, the session over: a moment of the match has its clip');
    h.prefs.set('recordingMode', 'off');
    h.rec.prefsChanged();
    ok(h.rec.cutClip(at - 11000, at + 4000, at) === null && !h.rec.holds.length, 'Off chosen: at once, no clip of it, and no hold left');
    await settle();
    ok(!h.files.under(ROOT).length && !h.rec.segments.length, 'and every recording deleted');
    // Chosen with a session recording: no clip of what it recorded from that
    // moment, the recording stopped cleanly, then deleted.
    const r = harness();
    await r.start();
    await r.run(40);
    const t2 = r.clock.now();
    r.rec.hold(t2 - 40000, t2);
    r.prefs.set('recordingMode', 'off');
    r.rec.prefsChanged();
    ok(r.rec.cutClip(t2 - 25000, t2 - 10000, t2 - 14000) === null && r.capture.stream === null, 'Off mid session: at once no clip of it, the reads on GDI');
    await settle();
    ok(r.page().closed && r.page().count('stop') === 1 && r.rec.state === 'idle' && !r.files.under(ROOT).length && !r.rec.segments.length,
      'the recording stopped cleanly, then deleted');
    const rb = await r.stop();
    ok(rb && rb.outcome === 'off', 'and the session says off', JSON.stringify(rb));
    // Auto turning itself off is not Off by hand: the match it gave up in
    // keeps its recording for its clips, whatever is written after it.
    const prefs = memPrefs({ recordingStrikes: [T0 - DAY] });
    const a = harness({ prefs });
    a.env.inMatch = true;
    await a.start();
    await a.run(5);
    await a.run(25, () => ({ health: { fps: 3, changing: true } }));
    const t3 = a.clock.now();
    a.rec.hold(t3 - 30000, t3);
    a.rec.prefsChanged();   // onConfigChanged runs on every config write
    await a.stop();
    ok(prefs.data.recordingMode === 'off' && a.rec.cutClip(t3 - 28000, t3 - 18000, t3 - 22000) !== null,
      'Auto turned itself off (a second busy session): the match it gave up in still has its clip');
  });

  await section('the comparison with GDI:', async () => {
    ok(compareVerdict({ gdiLuma: 120, streamLuma: 110 }) === 'ok', 'both see the game: ok');
    ok(compareVerdict({ gdiLuma: 120, streamLuma: SPEC.black - 0.1 }) === 'stream-black', 'the stream black under 4 of 255 while GDI is not: it cannot see this game');
    ok(compareVerdict({ gdiLuma: SPEC.black - 0.1, streamLuma: 2 }) === 'both-black', 'both black: nothing can see it');
    ok(compareVerdict({ gdiLuma: 2, streamLuma: 120 }) === 'ok', 'GDI black and the stream not: the stream is the better source');
    ok(compareVerdict({ gdiLuma: 120, streamLuma: SPEC.black }) === 'ok', '4 itself is not black');
    ok(compareVerdict({ gdiLuma: 120 }) === null, 'and a comparison missing a side decides nothing');

    const h = harness();
    await h.start();
    ok(h.capture.stream === null, 'before the first comparison the reads stay on GDI');
    h.env.streamLuma = 2;
    await h.run(4);
    ok(h.capture.stream === null && h.rec.state === 'recording' && h.page().count('compare') === 1, 'at 3 s, the stream black once: not served, not given up');
    await h.run(6);
    ok(h.rec.state === 'idle' && h.page().closed && h.capture.stream === null && h.page().count('compare') === 2,
      'black again 5 s later: recording stopped for the session, the reads stay on GDI');
    ok(h.notices.length === 1 && h.notices[0].text === SPEC.blackText, 'and the spec\'s notice', h.notices.map((x) => x.text).join(' | '));
    ok((await h.stop()).outcome === 'black', 'the session ends as black');

    const once = harness();
    await once.start();
    once.env.streamLuma = 2;
    await once.run(4);
    once.env.streamLuma = 90;
    await once.run(6);
    ok(once.rec.state === 'recording' && once.capture.stream && !once.notices.length, 'black once then the game (a fade through black): served, no notice');
    await once.run(60);
    ok(once.page().count('compare') === 3, 'and compared again once a minute', `${once.page().count('compare')} comparisons`);
    await once.stop();

    const both = harness();
    both.env.streamLuma = 1;
    both.env.gdiLuma = 1;
    await both.start();
    await both.run(4);
    ok(!both.notices.length && both.capture.stream, 'both black once: nothing said yet, the read served (both are blind, the stream is cheaper)');
    await both.run(6);
    ok(both.notices.length === 1 && both.notices[0].text === SPEC.bothBlackText && both.notices[0].kind === 'capture' && both.rec.state === 'recording',
      'both black again: the spec\'s capture notice, and recording goes on', both.notices.map((x) => x.text).join(' | '));
    both.env.streamLuma = 80;
    both.env.gdiLuma = 80;
    await both.run(61);
    ok(both.notices.length === 2 && both.notices[1].kind === 'capture' && both.notices[1].text === null,
      'the next comparison sees the game: the notice taken down', JSON.stringify(both.notices[1]));
    await both.stop();

    const blind = harness();
    blind.env.gdi = null;
    await blind.start();
    await blind.run(4);
    ok(blind.capture.stream && blind.rec.state === 'recording', 'GDI unavailable (the helper blocked): a stream that is not black serves the read');
    await blind.stop();
    const dark = harness();
    dark.env.gdi = null;
    dark.env.streamLuma = 1;
    await dark.start();
    await dark.run(12);
    ok(dark.capture.stream === null && dark.rec.state === 'recording' && !dark.notices.length && dark.page().count('compare') >= 2,
      'GDI unavailable and the stream black: nothing decided, nothing served, asked again 5 s on');
    await dark.stop();
  });

  await section('the live read, through the stream:', async () => {
    const h = harness();
    await h.start();
    await h.run(4);
    const s = h.capture.stream;
    ok(s && typeof s.grab === 'function', 'compared, the stream is handed to capture.js');
    const got = await Promise.all([s.grab({ targetW: 1280, targetH: 720, jpegQuality: 70 }), settle()]).then((x) => x[0]);
    const asked = h.page().sent.filter((m) => m.type === 'grab').pop();
    ok(got === STREAM_JPEG.toString('base64') && asked.width === 1280 && asked.height === 720 && asked.quality === 0.7,
      'the read\'s frame is the page\'s JPEG, asked at 1280x720 and 0.7, the frame the read was benched on', JSON.stringify(asked));
    await Promise.all([s.grab({ targetW: 854, targetH: 480, jpegQuality: 50 }), settle()]);
    const perf = h.page().sent.filter((m) => m.type === 'grab').pop();
    ok(perf.width === 854 && perf.height === 480 && perf.quality === 0.5, 'and at the Performance profile, 854x480 at 0.5');
    h.page().stale = true;
    const stale = await Promise.all([s.grab({ targetW: 1280, targetH: 720, jpegQuality: 70 }), settle()]).then((x) => x[0]);
    ok(stale === null && h.rec.state === 'recording', 'a stale frame is no frame (capture.js takes that read from GDI), and recording goes on');
    h.page().stale = false;
    h.page().deaf = true;
    for (let i = 0; i < 2; i++) {
      const g = s.grab({ targetW: 1280, targetH: 720, jpegQuality: 70 });
      await h.clock.advance(1600);
      ok((await g) === null && h.rec.state === 'recording', `a read the page does not answer (${i + 1}) is no frame after 1.5 s`);
    }
    const third = s.grab({ targetW: 1280, targetH: 720, jpegQuality: 70 });
    await h.clock.advance(1600);
    ok((await third) === null && h.rec.state === 'idle' && h.capture.stream === null && !h.notices.length,
      'three in a row: the page is broken, recording stops, the reads on GDI');
    ok((await h.stop()).outcome === 'error', 'the session ends as error');
  });

  await section('the primary display changes mid session (displaysChanged):', async () => {
    const h = harness();
    h.env.displayId = 111;
    h.env.sourceId = 'screen:111:0';
    const p1 = await h.start();
    await h.run(5);
    ok(h.capture.stream && p1.started.sourceId === 'screen:111:0', 'recording display 111, the primary one, and serving the read from it');
    ok(h.rec.displaysChanged(111) === false && !p1.closed && h.capture.stream, 'the displays changed, 111 still the primary one: nothing to do');
    // Display 222 is made the main display (the game moved there, a laptop
    // docked), and Chromium's source stays on 111 while GDI reads 222.
    h.env.displayId = 222;
    h.env.sourceId = 'screen:222:0';
    ok(h.rec.displaysChanged(222) === true && h.capture.stream === null, '222 became the primary one: the read is off the old display\'s stream at once');
    await settle();
    const p2 = h.page();
    ok(p1.closed && p1.count('stop') === 1 && p2 !== p1 && p2.started && p2.started.sourceId === 'screen:222:0' && h.rec.segments.length === 2,
      'the recording of 111 stopped cleanly, and a new one opened on 222, the primary display');
    ok(h.capture.stream === null && h.rec.displaysChanged(222) === false, 'compared before it serves, and 222 is already what it records');
    await h.run(4);
    ok(h.capture.stream && h.rec.state === 'recording', 'then served, from the primary display');
    ok(same(h.running, [true, false, true]), `running: true, false, true (${JSON.stringify(h.running)})`);
    const b = await h.stop();
    ok(b && b.outcome === 'recorded' && b.minutes === 0.2, 'one session, both recordings\' time counted', JSON.stringify(b));
    // Paused, or the recording given up for the session, nothing starts again.
    const g = harness();
    g.env.inMatch = true;
    await g.start();
    await g.run(5);
    await g.run(25, () => ({ health: { fps: 3, changing: true } }));
    ok(g.rec.displaysChanged(333) === false && g.pages.length === 1, 'given up for the session: a display change starts nothing');
    await g.stop();
  });

  await section('the hardware gate:', async () => {
    const h = harness({ gate: false });
    await h.start();
    await h.run(5);
    ok(h.rec.state === 'idle' && h.page().closed && h.capture.stream === null && !h.running.includes(true),
      'no hardware H.264 encoder: nothing recorded, the page closed, nothing served');
    ok(!h.notices.length, 'and no notice: it is this PC\'s for good, Settings says it');
    const b = await h.stop();
    ok(b && b.outcome === 'no-hw-encoder' && b.encoderOk === false && h.prefs.data.recordingLast.outcome === 'no-hw-encoder',
      'the session ends no-hw-encoder, the gate false, and Settings can read it', JSON.stringify(b));
  });

  await section('paused, nothing is recorded:', async () => {
    const h = harness();
    await h.start();
    await h.run(5);
    h.rec.pause();
    await settle();
    ok(h.page().closed && h.capture.stream === null && h.rec.state === 'idle', 'pause: the recording stops, the reads on GDI');
    h.rec.resume();
    await settle();
    ok(h.pages.length === 2 && h.rec.segments.length === 2 && h.capture.stream === null, 'resume: a new recording, compared again before it serves');
    await h.run(4);
    ok(h.capture.stream, 'then served');
    const b = await h.stop();
    ok(b.outcome === 'recorded' && b.minutes === 0.2, 'and the minutes are the recorded ones, the pause left out', JSON.stringify(b));
    const g = harness();
    g.env.inMatch = true;
    await g.start();
    await g.run(5);
    await g.run(25, () => ({ health: { fps: 3, changing: true } }));
    g.rec.pause();
    g.rec.resume();
    await settle();
    ok(g.pages.length === 1, 'given up for the session, a resume does not start it again');
    await g.stop();
  });

  await section('the counts the session ends with:', async () => {
    // 5 s in a menu, 40 in a match (15 of them changing at 30 fps, 25 still at
    // 2), then 30 back in a menu at 5 fps on a busy PC: only the match counts,
    // and of it only the seconds whose picture changed count for fps.
    const h = harness();
    await h.start();
    await h.run(5);
    h.env.inMatch = true;
    let i = 0;
    await h.run(40, () => {
      i += 1;
      h.env.metrics = { recorderCpu: i % 2 ? 2 : 4, systemCpu: i <= 35 ? 40 : 90 };
      return { health: i <= 15 ? { fps: 30, changing: true } : { fps: 2, changing: false } };
    });
    h.env.inMatch = false;
    h.env.metrics = { recorderCpu: 50, systemCpu: 99 };
    await h.run(30, () => ({ health: { fps: 5, changing: true } }));
    const b = await h.stop();
    ok(b && same(Object.keys(b).sort(), ['encoderOk', 'fpsP50', 'game', 'minutes', 'mode', 'outcome', 'recorderCpuP50', 'res', 'systemCpuP90', 'version']),
      'ten fields, and nothing else', JSON.stringify(b));
    ok(b.game === 'valorant', 'the game the session was started for: Valorant', JSON.stringify(b));
    const lol = harness();
    await lol.start('lol');
    await lol.run(3);
    const lb = await lol.stop();
    ok(lb && lb.game === 'lol' && R.GAMES.join() === 'valorant,lol', 'a League game\'s says lol, from the closed list', JSON.stringify(lb));
    ok(b.fpsP50 === 30, 'fps p50 over the seconds in a match whose picture changed: 30 (the still seconds and the menus left out)', `got ${b.fpsP50}`);
    ok(b.recorderCpuP50 === 2 || b.recorderCpuP50 === 4, 'the recorder\'s CPU p50, % of one core, the match\'s alone', `got ${b.recorderCpuP50}`);
    ok(b.systemCpuP90 === 90, 'the PC\'s CPU p90: 90 (5 of the match\'s 40 seconds at 90, the rest at 40, the menu\'s 99 left out)', `got ${b.systemCpuP90}`);
    ok(b.minutes === 1.3 && b.outcome === 'recorded' && b.encoderOk === true && b.version === '8.3.0', 'minutes recorded, the outcome, the gate, the version', JSON.stringify(b));
    ok(R.OUTCOMES.join() === 'recorded,off,no-hw-encoder,busy,disk,black,error', 'the outcomes are the closed list, and only it');
    ok(reportBlock({ outcome: 'something new' }, '8.3.0').outcome === 'error', 'a word off the list is never sent');
    const early = harness({ silentStart: true });
    await early.start();
    const none = await early.stop();
    ok(none === null && !early.reports.length, 'a session stopped before the recorder said it started has nothing to count');
    const off = harness({ prefsInit: { recordingMode: 'off' } });
    await off.start();
    const ob = await off.stop();
    ok(ob && ob.outcome === 'off' && ob.minutes === 0 && ob.fpsP50 === null && ob.encoderOk === null && !off.pages.length,
      'Off: nothing opened, and the block says off', JSON.stringify(ob));
  });

  await section('a quit, a logout or Windows ending its session ends the session as Stop does, at once (shutdown):', async () => {
    const h = harness();
    const p = await h.start();
    await h.run(30);
    h.rec.shutdown({ exiting: true });
    // Nothing awaited from here: app.quit() follows the call at once.
    ok(h.reports.length === 1 && h.reports[0].outcome === 'recorded' && h.reports[0].minutes === 0.5,
      'its block handed out in the call, the 30 s recorded counted', JSON.stringify(h.reports));
    // Posted into the exit, a block can reach the server and lose its answer,
    // and the next launch sent it again: index.js only keeps one marked so.
    ok(same(h.how, [{ exiting: true }]), `and marked as handed out with the process ending, for index.js to keep, not post: ${JSON.stringify(h.how)}`);
    ok(h.prefs.data.recordingLast && h.prefs.data.recordingLast.outcome === 'recorded', 'and recordingLast written for Settings');
    ok(same(h.running, [true, false]), `'running' false in the call, so the AI log is back in captures: ${JSON.stringify(h.running)}`);
    ok(!h.files.under(ROOT).length && p.closed && h.rec.state === 'idle' && h.capture.stream === null && !h.rec.segments.length,
      'and every recording deleted before it returns, the page closed, the reads on GDI');
    await h.clock.advance(15000);
    ok(h.reports.length === 1 && same(h.running, [true, false]) && !h.files.under(ROOT).length,
      'nothing after it: no second block, no second false, nothing written again');

    // Busy then Stop, then a clean session ended by Quit: Settings' "your
    // last session" is the clean one, not the busy one before it.
    const prefs = memPrefs();
    const a = harness({ prefs });
    a.env.inMatch = true;
    await a.start();
    await a.run(5);
    await a.run(25, () => ({ health: { fps: 3, changing: true } }));
    await a.stop();
    const b = harness({ prefs, at: T0 + DAY });
    await b.start();
    await b.run(20);
    ok(prefs.data.recordingLast.outcome === 'busy', 'a busy session stopped: its last session was busy');
    ok(same(a.how, [{ exiting: false }]), `a Stop's block is not marked: the app goes on, and posts it (${JSON.stringify(a.how)})`);
    b.rec.shutdown({ exiting: true });
    ok(prefs.data.recordingLast.outcome === 'recorded' && b.reports.length === 1 && b.reports[0].outcome === 'recorded',
      'the next, ended by Quit: Settings says recorded, and its block is out', JSON.stringify(prefs.data.recordingLast));

    // Busy, then Quit with the recording already stopped: the busy block.
    const c = harness();
    c.env.inMatch = true;
    await c.start();
    await c.run(5);
    await c.run(25, () => ({ health: { fps: 3, changing: true } }));
    c.rec.shutdown({ exiting: true });
    ok(c.reports.length === 1 && c.reports[0].outcome === 'busy', 'a session given up as busy, then Quit: its block says busy', JSON.stringify(c.reports));

    // Stop, then Quit in the same tick (the tray's Stop, then its Quit), the
    // page slow to answer: one block, the time counted, running false, and
    // marked as the process ending, since the Stop never got to hand it out.
    const d = harness({ slowStop: 5000 });
    await d.start();
    await d.run(10);
    const stopping = d.rec.stopSession();
    d.rec.shutdown({ exiting: true });
    ok(d.reports.length === 1 && d.reports[0].outcome === 'recorded' && d.reports[0].minutes === 0.2 && same(d.running, [true, false])
      && same(d.how, [{ exiting: true }]),
    'Stop then Quit at once: one block, its 10 s counted, running false, marked as the process ending', JSON.stringify({ reports: d.reports, running: d.running, how: d.how }));
    await d.clock.advance(12000);
    ok((await stopping) === null && d.reports.length === 1 && same(d.running, [true, false]) && !d.files.under(ROOT).length,
      'and the Stop, done later, adds nothing: no second block, nothing on disk');

    // A logout ends it the same way, and the app goes on: not marked, so its
    // block is posted then.
    const lo = harness();
    await lo.start();
    await lo.run(10);
    lo.rec.shutdown();
    ok(lo.reports.length === 1 && lo.reports[0].outcome === 'recorded' && same(lo.how, [{ exiting: false }]) && !lo.files.under(ROOT).length,
      `a logout: its block handed out in the call, unmarked (the app goes on, and posts it), every recording deleted (${JSON.stringify(lo.how)})`);
    // Logged out with nothing recording: nothing to count, nothing told.
    const e = harness();
    e.rec.shutdown();
    ok(!e.reports.length && !e.running.length, 'shut down with no session: no block, no running');
    // A Stop whose stop finds nothing open, after a recording: false, once.
    const f = harness();
    await f.start();
    await f.run(3);
    f.rec.page = null;
    f.rec.seg = null;
    await f.rec.stopSegment();
    ok(same(f.running, [true, false]), `a stop that finds nothing open still says running false after a true: ${JSON.stringify(f.running)}`);
    await f.stop();
  });

  await section('the words:', () => {
    const all = [SPEC.busyText, SPEC.blackText, SPEC.bothBlackText, R.NOTICE.busy('every second'), R.NOTICE.black('every second'),
      R.NOTICE.bothBlack(), R.NOTICE.diskStart('every second'), R.NOTICE.diskStop('every second')];
    ok(all.every((t) => !DASHES.test(t)) && DASHES.test(String.fromCharCode(0x2014)) && DASHES.test(String.fromCharCode(0x2013)) && !DASHES.test('a-b'),
      'no dash in any notice (the detector matches both dashes and not a hyphen)');
    ok(R.NOTICE.busy('every second') === SPEC.busyText && R.NOTICE.black('every second') === SPEC.blackText && R.NOTICE.bothBlack() === SPEC.bothBlackText,
      'the notices are the spec\'s words');
  });

  console.log(fails ? `\nFAIL: ${fails} of ${checks} recorder checks failed` : `\nPASS: all ${checks} recorder checks passed`);
  finished = true;
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.log(`FAIL  the test itself threw: ${e.stack || e}`); process.exit(1); });
