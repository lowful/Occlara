'use strict';

/**
 * THE MATCH, RECORDED ON THIS PC (8.3).
 *
 * WHAT IT IS. One capture of the primary display, taken the way OBS's Display
 * Capture takes it: a hidden page (src/renderer/recorder, opened by
 * src/main/windows/recorder-window.js) opens the screen with getUserMedia and
 * records it with MediaRecorder, H.264 on the GPU's own encoder, a keyframe
 * every second and a chunk every second. The same stream hands the live read
 * its frame once a second (capture.js useStream), so while it runs the GDI
 * helper is not launched for every read. Never the game's memory, never its
 * files, never a hook into it: the pixels the display already shows.
 *
 * NOTHING REACHES THE SCREEN. The page is a window that is never shown and has
 * no markup to show. Its one voice is a notice on the window's notice line
 * about capture (index.js pushNotice), never anything about the match.
 *
 * AUTO, AND IT TURNS ITSELF OFF. Recording is on by default ('auto') and
 * measures its own cost on every PC, judged only while a match is in progress
 * (createHealth). When the PC cannot afford it, it stops for the session, the
 * reads go back to the GDI helper at the same cadence (the one second read
 * never stops), and one notice says so. Two such sessions within a week turn
 * Auto off, which Settings says, with a way to try again (strikeOut). With no
 * hardware H.264 encoder it never starts: VP9 took a whole core in software in
 * the 8.3 spike where H.264 on the GPU took 1.5% of its encoder.
 *
 * WHAT IS KEPT. The chunks are read as they come by src/shared/webm.js, which
 * hands back whole Clusters, and written into one minute PAGES that share the
 * one init segment, under userData/recording/<recording>/ (init.mkv and
 * page-00000.mkv on). A page goes once it is two minutes old, unless the
 * match in progress began before it ended (keepSince) or a hold covers it
 * (hold(), as holdAiLogFrames holds the AI log's frames): a finished match is
 * held until its review has looked, and an hour at most. Whatever a run left
 * is swept at the next launch (sweep), and everything goes at quit, at a
 * logout and when Windows ends the session (shutdown, synchronously, since the
 * process can be killed right after). Off chosen by hand takes what was kept
 * with it (discard). A free disk guard keeps it from filling the drive: no
 * start under 8 GB free, a stop under 4 GB.
 *
 * WHICH SOURCE IS RIGHT. At the start, and once a minute, one GDI frame and
 * one stream frame taken back to back are compared (compareVerdict): a stream
 * that reads black while GDI does not cannot see this game (exclusive
 * fullscreen), so recording stops for the session and the reads stay on GDI.
 * Until the first comparison passes the reads stay on GDI too. A recording is
 * of the display that was primary when it opened, and GDI reads whichever is
 * primary now, so when another display becomes the primary one the recording
 * starts again on it (displaysChanged).
 *
 * COUNTS FOR THE DEVELOPER. At the end of each session one block of counts
 * goes to the server (index.js, POST /api/coach/session-report): the outcome
 * from a closed list, the minutes recorded, the median frame rate and CPU, and
 * nothing else (reportBlock). That is how the thresholds below get tuned.
 *
 * Plain Node, no Electron: the page, the files, the clock and the machine's
 * numbers are handed in, so scripts/test-recorder.js drives every rule here on
 * a fake clock and fake files.
 */

const fs = require('fs');
const path = require('path');
const EventEmitter = require('events');
const webm = require('../../shared/webm');

// ── What a recording is asked for ──────────────────────────────────────────
// 720p is the default and 1080p a Setting. Either box is filled with the
// display's own shape (fitSize), never cropped to the box: asked for a box of
// another shape, this Chromium hands back exactly the box (a 1280x600 ask on a
// 1920x1080 display came back 1280x600), which would cut or squash the game.
const RES = {
  720: { width: 1280, height: 720, bitrate: 3e6 },
  1080: { width: 1920, height: 1080, bitrate: 6e6 },
};
// The read's frame, the capture profile's size (CAPTURE.profiles in
// src/shared/config.js) unless index.js says another: the recording covers it.
const READ_SIZE = { width: 1280, height: 720 };
// H.264 counts a frame in macroblocks of 16x16. Level 3.1 holds 3600 of them
// (1280x720) and 4.0 holds 8160 (1920x1088); nothing past 4.0 is asked of the
// encoder, whose gate was only ever asked 3.1 and 4.0.
const MB_LEVEL_31 = 3600;
const MB_LEVEL_40 = 8160;
// A recording bigger than its box is given more bitrate, twice the box's at most.
const BITRATE_MAX_SCALE = 2;
// Asked for 30 with the whole screen moving, the capturer delivered about 21
// frames a second, waiting a full frame period after each grab; asked for 60
// it delivered about 31. So it is asked for 60 to record about 30.
const ASK_FPS = 60;
// Every Cluster then opens on a keyframe that carries its own SPS and PPS
// (measured in the spike), so a clip can begin at any Cluster.
const KEYFRAME_MS = 1000;
const TIMESLICE_MS = 1000;
// H.264 only, and Matroska first: whichever is asked for, Chromium writes
// Matroska and names it video/x-matroska;codecs=avc1 once it has started.
const MIME_TYPES = ['video/x-matroska;codecs=avc1', 'video/webm;codecs=h264', 'video/webm;codecs=avc1'];

// What the reads get when the recorder runs on a generated canvas
// (OCCLARA_FAKE_CAPTURE): a 1920x1080 display, so 720p is 1280x720.
const FAKE_DISPLAY = { width: 1920, height: 1080 };

// ── What is kept, and for how long ─────────────────────────────────────────
const PAGE_MS = 60 * 1000;
const KEEP_RECENT_MS = 2 * 60 * 1000;
const HOLD_MAX_MS = 60 * 60 * 1000;       // a hold that is never released, as the AI log's
// The match in progress is kept from its start, this far back at most
// (valorantKeepSince): a read outage mid match, or the menus after a match
// left before round 3, never keep hours of pages.
const KEEP_MATCH_MS = 90 * 60 * 1000;
const GB = 1024 * 1024 * 1024;
const DISK_START_BYTES = 8 * GB;
const DISK_STOP_BYTES = 4 * GB;
const DISK_CHECK_MS = 30 * 1000;

// ── When the PC cannot afford it ───────────────────────────────────────────
// FIRST GUESSES, every one of them, to be tuned from the session reports'
// counts. Each must hold for sustainMs straight while a match is in progress
// before the recorder gives up, so one slow second never costs a session.
const HEALTH = {
  sustainMs: 20 * 1000,
  // Frames the capturer delivered in a second while the picture was changing.
  // A still screen delivers two or so a second by design and is not judged.
  minFps: 12,
  // How late the next chunk is: a recorder that has stopped handing chunks
  // over is an encoder or a page that cannot keep up.
  maxLagMs: 4000,
  // The recorder page's own process, in % of ONE core. Hardware H.264 cost
  // about 3% of a core in the spike's page; software VP9 took 100%.
  maxRecorderCpu: 60,
  // The whole machine, %: past this the game is short of CPU, and a recorder
  // that is one more thing to schedule should be the first thing to go.
  maxSystemCpu: 95,
};
// A gap this long between two samples is the main process held up, which says
// nothing about the recorder either way, so a rule's streak starts again.
const SAMPLE_GAP_MS = 5000;
// A page that has not reported for this long has gone quiet.
const REPORT_STALE_MS = 3000;
// A newest frame older than this is a capture that stopped delivering: the
// read is never handed it (the GDI helper is used for that read), and in a
// match it counts as frames not arriving while the screen changes.
const STALE_FRAME_MS = 2000;

// ── The comparison with GDI ─────────────────────────────────────────────────
const BLACK_LUMA = 4;                      // a mean brightness under 4 of 255 is black
const COMPARE_FIRST_MS = 3000;             // after the stream starts, once frames are coming
const COMPARE_EVERY_MS = 60 * 1000;
// A verdict that stops a session or puts a notice up is taken twice, this far
// apart: a match fades through black, and one black moment is not a game the
// stream cannot see.
const CONFIRM_MS = 5000;
const BLACK_CONFIRMS = 2;
const COMPARE_TIMEOUT_MS = 4000;

// ── Talking to the page ─────────────────────────────────────────────────────
const START_TIMEOUT_MS = 20 * 1000;
const STOP_TIMEOUT_MS = 10 * 1000;
const GRAB_TIMEOUT_MS = 1500;
// A page that answers none of this many reads in a row is broken, whatever the
// match is doing, and the reads go back to the GDI helper.
const GRAB_MISSES = 3;
// The per second samples a session keeps for its report: four hours of them.
const MAX_SAMPLES = 4 * 3600;

// Two sessions given up as busy within a week turn Auto off.
const STRIKES = { count: 2, withinMs: 7 * 24 * 3600 * 1000 };

// The one closed list a session's outcome comes from; the server keeps no
// other word (server/services/telemetry.js).
const OUTCOMES = ['recorded', 'off', 'no-hw-encoder', 'busy', 'disk', 'black', 'error'];
// The games whose sessions record (index.js startSession), another closed
// list: a League game and a Valorant match cost a PC different things.
const GAMES = ['valorant', 'lol'];

// ── Pure rules ──────────────────────────────────────────────────────────────

/** A size in H.264's macroblocks of 16x16. */
function macroblocks(size) {
  return Math.ceil(size.width / 16) * Math.ceil(size.height / 16);
}

/**
 * The size a display is recorded at: its own shape, never cropped, filling
 * the box of `res` (720 or 1080) and COVERING the read's frame (`read`, the
 * capture profile's size, READ_SIZE unless given). The read is the stream's
 * newest frame drawn stretched to that size, as the GDI helper draws the
 * whole display, so a track smaller than it handed the read fewer rows than
 * GDI ever did: fitted to the box alone, a 3440x1440 display recorded
 * 1280x536 and a 5120x1440 one 1280x360, the score digits, the round timer
 * and the minimap's labels drawn from a quarter to a half fewer rows. So the
 * scale is the larger of the two, never above the display's own size, in
 * even numbers because H.264 counts its picture in pairs of pixels, and where
 * that is past H.264 level 4.0's frame (MB_LEVEL_40) it is brought down to
 * it, which can leave the read uncovered (covers()).
 */
function fitSize(display, res, read) {
  const box = RES[res] || RES[720];
  const r = read && read.width > 0 && read.height > 0 ? read : READ_SIZE;
  const W = Math.round(Number(display && display.width)) || box.width;
  const H = Math.round(Number(display && display.height)) || box.height;
  let scale = Math.min(1, Math.max(Math.min(box.width / W, box.height / H), Math.max(r.width / W, r.height / H)));
  const even = (x, most) => Math.max(2, Math.min(2 * Math.floor(most / 2), 2 * Math.round(x / 2)));
  const at = (k) => ({ width: even(W * k, W), height: even(H * k, H) });
  let size = at(scale);
  while (macroblocks(size) > MB_LEVEL_40 && size.width > 2) { scale *= 0.99; size = at(scale); }
  return size;
}

/**
 * Whether a recording of `size` can hand the read its frame: it holds every
 * row and column of the read's frame, or every pixel of `display` itself. A
 * 1024x768 display recorded whole is all the GDI helper reads of it too,
 * stretched up to 1280x720 the same way, so measured against the read alone
 * it left every read of the session on the helper's launch a frame. Within
 * two pixels, since an odd display is recorded at the even size below it.
 */
function covers(size, read, display) {
  const r = read && read.width > 0 && read.height > 0 ? read : READ_SIZE;
  if (!size) return false;
  if (size.width >= r.width && size.height >= r.height) return true;
  return !!display && display.width > 0 && display.height > 0
    && size.width >= display.width - 2 && size.height >= display.height - 2;
}

/**
 * The bitrate a size is asked for: its box's (3 Mbps at 720p, 6 at 1080p),
 * and for a recording bigger than the box, more in proportion to its pixels,
 * twice the box's at most. A recording within its box keeps the box's.
 */
function bitrateFor(size, res) {
  const box = RES[res] || RES[720];
  const k = size && size.width > 0 && size.height > 0 ? (size.width * size.height) / (box.width * box.height) : 1;
  return Math.round(box.bitrate * Math.min(BITRATE_MAX_SCALE, Math.max(1, k)));
}

/** Whether a track's settings keep the display's shape, to within rounding. */
function aspectKept(settings, display, tolerance) {
  const t = typeof tolerance === 'number' ? tolerance : 0.02;
  if (!settings || !(settings.width > 0) || !(settings.height > 0)) return false;
  if (!display || !(display.width > 0) || !(display.height > 0)) return false;
  const want = display.width / display.height;
  return Math.abs(settings.width / settings.height - want) / want <= t;
}

/**
 * The H.264 profile and level a size is asked for, Baseline, by its frame in
 * macroblocks: 3.1 up to 3600 (1280x720), 4.0 past it, up to the 8160 fitSize
 * never passes. The codec strings the spike's gate answered for. Counted in
 * pixels it was wrong at the edge: 1288x712 is fewer pixels than 1280x720 and
 * 45 more macroblocks than 3.1 holds.
 */
function codecFor(size) {
  return size && macroblocks(size) > MB_LEVEL_31 ? 'avc1.42E028' : 'avc1.42E01F';
}

/**
 * One GDI frame against one stream frame, by mean brightness: 'stream-black'
 * when the stream cannot see what GDI can (exclusive fullscreen), 'both-black'
 * when neither can, 'ok' otherwise, and null when it cannot be told. The mean
 * absolute difference between them is logged, not judged: the two are taken a
 * moment apart and encoded differently. Both frame the whole display since
 * the GDI helper was made DPI aware (8.3, native/OcclaraCapture.cs); before
 * it, at 125% it copied only the top left 1536x864 of a 1920x1080 screen.
 */
function compareVerdict(c) {
  if (!c || !Number.isFinite(c.gdiLuma) || !Number.isFinite(c.streamLuma)) return null;
  const gdiBlack = c.gdiLuma < BLACK_LUMA;
  const streamBlack = c.streamLuma < BLACK_LUMA;
  if (streamBlack && !gdiBlack) return 'stream-black';
  if (streamBlack && gdiBlack) return 'both-black';
  return 'ok';
}

/**
 * The health rules, one sample a second. Each rule has its own streak, and
 * the first to hold for `sustainMs` straight gives { rule, forMs }. Outside a
 * match nothing is judged and every streak starts again: a menu is not what
 * a player needs the PC for.
 *
 *   fps          fewer frames than minFps while the picture changes, or a
 *                capture that has stopped delivering (stalled)
 *   lag          the next chunk more than maxLagMs late
 *   recorderCpu  the recorder page's process over maxRecorderCpu % of a core
 *   systemCpu    the machine over maxSystemCpu %
 */
const RULES = ['fps', 'lag', 'recorderCpu', 'systemCpu'];
function createHealth(limits) {
  const L = { ...HEALTH };
  for (const [k, v] of Object.entries(limits || {})) if (Number.isFinite(v)) L[k] = v;
  const since = {};
  let lastAt = null;
  const reset = () => { for (const r of RULES) since[r] = null; };
  reset();
  return {
    limits: L,
    reset() { reset(); lastAt = null; },
    sample(s) {
      if (!s || !Number.isFinite(s.at)) return null;
      const gap = lastAt !== null && s.at - lastAt > SAMPLE_GAP_MS;
      lastAt = s.at;
      if (!s.inMatch || gap) { reset(); if (!s.inMatch) return null; }
      const bad = {
        fps: Number.isFinite(s.fps) && s.fps < L.minFps && (!!s.changing || !!s.stalled),
        lag: Number.isFinite(s.lagMs) && s.lagMs > L.maxLagMs,
        recorderCpu: Number.isFinite(s.recorderCpu) && s.recorderCpu > L.maxRecorderCpu,
        systemCpu: Number.isFinite(s.systemCpu) && s.systemCpu > L.maxSystemCpu,
      };
      for (const r of RULES) {
        if (!bad[r]) { since[r] = null; continue; }
        if (since[r] === null) since[r] = s.at;
        if (s.at - since[r] >= L.sustainMs) return { rule: r, forMs: s.at - since[r] };
      }
      return null;
    },
  };
}

/**
 * Another busy session on `strikes` (the times of the earlier ones): those of
 * the last week, this one added, and whether that is enough to turn Auto off.
 */
function strikeOut(strikes, now, rule) {
  const R = rule || STRIKES;
  const kept = (Array.isArray(strikes) ? strikes : [])
    .filter((t) => Number.isFinite(t) && t <= now && now - t < R.withinMs);
  kept.push(now);
  return { strikes: kept, off: kept.length >= R.count };
}

/**
 * A VALORANT MATCH AS THE RECORDER TAKES IT. index.js hands in the reader
 * (coaching-engine.js) and its own matchInProgress(), which is the seal's and
 * cautious on purpose: the menus end a match only once it has 3 rounds
 * (match-end.js MIN_ROUNDS), and the reader is not in a menu before its first
 * read lands. So after a match left in round 1 or 2, the menus, the queue and
 * the next loading screen were "in a match", as was every second of a session
 * whose reads all fail (the server down, the AI credits out): judged, 20 s of
 * a loading screen's CPU gave up as busy and took a strike before the next
 * match began, and every page since Start was kept, about 1.3 GB an hour, with
 * no ledger to ever clip it.
 *
 * Judged (valorantInMatch) once a read has landed (analyzedFrames counts the
 * reads applied, from Start) and the last one was not a menu. Kept from the
 * match's start (valorantKeepSince) once a read has landed, menus or not, and
 * KEEP_MATCH_MS back at most: a match of three rounds or more is ended by most
 * of a minute of menus and only then held, and one menu read mid round (the
 * Escape menu) must not cost a match its first pages. A match left before
 * round 3 is dropped when the next one shows itself (closeUnendedMatch), its
 * start moves on, and its pages go then.
 */
function valorantInMatch(engine, inProgress) {
  return !!engine && engine.analyzedFrames > 0 && !engine.inLobby && !!inProgress;
}

function valorantKeepSince(engine, inProgress, now) {
  if (!engine || !(engine.analyzedFrames > 0) || !inProgress || !Number.isFinite(engine.matchStartedAt)) return null;
  return Math.max(engine.matchStartedAt, now - KEEP_MATCH_MS);
}

function quantile(xs, q) {
  const v = (xs || []).filter(Number.isFinite).sort((a, b) => a - b);
  if (!v.length) return null;
  return v[Math.min(v.length - 1, Math.max(0, Math.ceil(q * v.length) - 1))];
}

const round1 = (x) => (Number.isFinite(x) ? Math.round(x * 10) / 10 : null);

/** The track's own settings as the page last read them (its health report), for the minute line. */
function trackText(t) {
  if (!t || !(t.width > 0) || !(t.height > 0)) return "the track's own settings not reported";
  return `the track's own settings ${t.width}x${t.height} at ${Number.isFinite(t.frameRate) ? `${round1(t.frameRate)} fps` : 'no frame rate'}`;
}

/**
 * "up to once a second", or "up to once every 3 seconds" when the read is
 * pinned slower. UP TO since 8.3.2: the gap is the live round's, and menus, a
 * buy phase two reads have confirmed and the time spent dead are read less
 * often (read-cadence.js), so "every second" was no longer true of them.
 */
function everyText(ms) {
  const s = Math.round((Number(ms) || 1000) / 1000);
  return s <= 1 ? 'up to once a second' : `up to once every ${s} seconds`;
}

/**
 * The status line's words. Each says what happened to the recording and that
 * the reading goes on, which is what a player wants to know; none says
 * anything about the match. `every` follows the live cadence, so the words
 * stay true when the read is pinned slower. `still`, when given, is what goes
 * on instead, for a game the coach does not read the screen of: League's
 * review is built from the game's own record (deps.still).
 */
const stillReads = (every) => `The coach still reads your screen ${every}.`;
const NOTICE = {
  busy: (every, still) => `Recording stopped for this session: your PC was busy. ${still || stillReads(every)}`,
  black: (every, still) => `Recording needs Windowed Fullscreen in this game. ${still || stillReads(every)}`,
  bothBlack: () => 'Capture is black. Switch the game to Windowed Fullscreen.',
  diskStart: (every, still) => `Recording is off for this session: less than 8 GB is free on this drive. ${still || stillReads(every)}`,
  diskStop: (every, still) => `Recording stopped for this session: less than 4 GB is left on this drive. ${still || stillReads(every)}`,
};

/**
 * A finished session as the server is sent it: these fields and nothing else,
 * every number rounded, the outcome from OUTCOMES and the game from GAMES.
 * Frame rates and CPU are of the seconds recorded while a match was in
 * progress, the frame rate only of those whose picture changed (a still
 * screen delivers few frames by design).
 */
function reportBlock(s, version) {
  return {
    version: String(version || 'unknown').slice(0, 12),
    game: GAMES.includes(s.game) ? s.game : GAMES[0],
    mode: s.mode === 'off' ? 'off' : 'auto',
    res: String(s.res) === '1080' ? '1080' : '720',
    outcome: OUTCOMES.includes(s.outcome) ? s.outcome : 'error',
    minutes: Math.round((s.recordedMs || 0) / 6000) / 10,
    fpsP50: round1(quantile(s.fps, 0.5)),
    recorderCpuP50: round1(quantile(s.recorderCpu, 0.5)),
    systemCpuP90: round1(quantile(s.systemCpu, 0.9)),
    encoderOk: typeof s.encoderOk === 'boolean' ? s.encoderOk : null,
  };
}

// ── Files ───────────────────────────────────────────────────────────────────

/** Bytes in, whatever IPC handed over: an ArrayBuffer, a view, a Buffer. */
function toBuffer(x) {
  if (Buffer.isBuffer(x)) return x;
  if (ArrayBuffer.isView(x)) return Buffer.from(x.buffer, x.byteOffset, x.byteLength);
  if (Object.prototype.toString.call(x) === '[object ArrayBuffer]') return Buffer.from(x);
  return null;
}

/**
 * The files a recording is written to, through these calls only, so the test
 * hands in its own. Synchronous, as the AI log writes its frames: a Cluster a
 * second is a few hundred KB, and an order of writes the next read can trust
 * is worth more than the millisecond.
 */
const realFiles = {
  mkdir: (d) => fs.mkdirSync(d, { recursive: true }),
  write: (f, b) => fs.writeFileSync(f, b),
  append: (f, b) => fs.appendFileSync(f, b),
  read(f, offset, size) {
    const fd = fs.openSync(f, 'r');
    try {
      const b = Buffer.alloc(size);
      const n = fs.readSync(fd, b, 0, size, offset);
      return n === size ? b : b.subarray(0, n);
    } finally { fs.closeSync(fd); }
  },
  remove: (f) => fs.rmSync(f, { force: true }),
  removeTree: (d) => fs.rmSync(d, { recursive: true, force: true }),
  list: (d) => { try { return fs.readdirSync(d); } catch { return []; } },
};

/** Free bytes on the drive a folder is on, or null when it cannot be told. */
function realFreeBytes(dir) {
  let d = dir;
  for (let i = 0; i < 8 && d; i++) {
    try {
      const s = fs.statfsSync(d);
      return Number(s.bavail) * Number(s.bsize);
    } catch {
      const up = path.dirname(d);
      if (up === d) break;
      d = up;
    }
  }
  return null;
}

const stamp = (ms) => new Date(ms).toISOString().replace(/[:.]/g, '-');

// ── One recording ───────────────────────────────────────────────────────────

/**
 * One MediaRecorder run, from its start to its stop: its own folder, its init
 * segment, its pages and every Cluster in them, and where its timeline sits on
 * the wall clock.
 *
 * THE WALL CLOCK. A Cluster's time counts from the recording's first frame,
 * and the moments a review asks for (a death, the frame the coach looked at)
 * are wall clock times. The first frame came after the recorder started, so
 * its wall time is at least `startWall`; and every chunk was handed over after
 * the frames in it were captured, so it is at most the chunk's wall time less
 * the newest frame the chunk carried. The tightest of those (`hi`) is within a
 * frame or so of it, and the spike measured no drift between the two clocks
 * over five minutes, so one offset serves the whole recording.
 *
 * NOTHING RECORDED STAYS IN MEMORY. A Cluster's bytes go to its page and are
 * dropped, and the reader keeps no list of the Clusters it closed (webm.js
 * keepClusters): kept, every byte recorded stayed in the main process for the
 * whole session, 225 MB after ten minutes at 3 Mbps, about 1.3 GB an hour at
 * 720p and 2.5 at 1080p, beside the game and seen by no health rule. A page
 * keeps where each of its Clusters is (`clusters`) and the clip reads them
 * back from disk.
 */
class Segment {
  constructor(dir, files, pageMs) {
    this.dir = dir;
    this.files = files;
    this.pageMs = pageMs;
    this.reader = webm.createReader({ keepBytes: true, keepClusters: false });
    this.init = null;
    this.pages = [];
    this.active = true;
    this.gone = false;
    this.error = null;
    this.chunks = 0;
    this.pageChunks = null;     // the chunks the page said it handed over, at its stop
    this.startWall = null;
    this.startedAt = null;
    this.hi = Infinity;
    this.bytesOnDisk = 0;
    // Every byte and frame written since it began, a page pruned or not, for
    // the minute line (Recorder logStatus): what it ran at against what it
    // was asked for (`bitrate`).
    this.bytesWritten = 0;
    this.framesWritten = 0;
    this.bitrate = null;
    this.session = null;
    this.displayId = null;      // the display it records, which was the primary one
    this.track = null;          // the track's own size, from the page's 'started'
    this.coversRead = true;     // big enough to hand the read its frame (fitSize)
    this.moved = false;         // the primary display changed: starting again on it
    this.discarded = false;     // Off chosen by hand: no clip is cut from it
  }

  /** One chunk, as the page handed it over. False once the recording is broken. */
  push(data, wall) {
    if (this.error) return false;
    const buf = toBuffer(data);
    if (!buf) { this.error = 'a chunk that is not bytes'; return false; }
    this.chunks += 1;
    let closed;
    try { closed = this.reader.push(buf); } catch (e) { this.error = 'the reader threw: ' + e.message; return false; }
    for (const c of closed) if (!this.place(c)) return false;
    if (this.reader.error) { this.error = 'the recording does not read: ' + this.reader.error; return false; }
    // The newest frame this chunk carried: the open Cluster's latest, since a
    // Cluster closes only once the next one's header has come, a chunk later.
    let newest = null;
    const open = this.reader.open;
    for (const c of closed.concat(open ? [open] : [])) if (Number.isFinite(c.last) && (newest === null || c.last > newest)) newest = c.last;
    if (newest !== null && Number.isFinite(wall)) this.hi = Math.min(this.hi, wall - newest);
    return true;
  }

  /** The stream is over: the last Cluster, which only its end closes. */
  finish() {
    if (!this.active) return;
    this.active = false;
    try { for (const c of this.reader.end()) this.place(c); } catch (e) { this.error = this.error || e.message; }
  }

  /** A whole Cluster into its page, the init segment first of all. */
  place(c) {
    try {
      if (!this.init) {
        this.init = Buffer.from(this.reader.init);
        this.files.write(path.join(this.dir, 'init.mkv'), this.init);
      }
      const k = Math.max(0, Math.floor((Number(c.timecode) || 0) / this.pageMs));
      let p = this.pages[this.pages.length - 1];
      if (!p || p.k !== k) {
        p = { k, name: 'page-' + String(k).padStart(5, '0') + '.mkv', clusters: [], bytes: 0 };
        this.pages.push(p);
      }
      this.files.append(path.join(this.dir, p.name), c.data);
      const size = c.data.length;
      p.clusters.push({
        index: c.index, timecode: c.timecode, first: c.first, last: c.last,
        frames: c.frames, keyframe: c.keyframe, offset: p.bytes, size,
      });
      p.bytes += size;
      this.bytesOnDisk += size;
      this.bytesWritten += size;
      this.framesWritten += Number(c.frames) || 0;
      // On disk now, and read back from there: not held here too.
      delete c.data;
      return true;
    } catch (e) {
      this.error = 'the recording could not be written: ' + e.message;
      return false;
    }
  }

  /** The wall time of the recording's 0 (see THE WALL CLOCK), or null before it is known. */
  zero() {
    const lo = Number.isFinite(this.startWall) ? this.startWall : null;
    if (Number.isFinite(this.hi)) return lo === null ? this.hi : Math.max(lo, this.hi);
    return lo;
  }

  /** A page's span on the wall clock: its first Cluster's start to its last frame. */
  spanOf(p) {
    const z = this.zero();
    if (z === null || !p.clusters.length) return null;
    const a = p.clusters[0];
    const b = p.clusters[p.clusters.length - 1];
    return { from: z + a.timecode, to: z + (Number.isFinite(b.last) ? b.last : b.timecode) };
  }

  /** The page being written, which is never deleted. */
  writing() { return this.active ? this.pages[this.pages.length - 1] || null : null; }

  /** Delete the pages `kept` says go; the folder too once a stopped recording has none. */
  prune(kept) {
    const open = this.writing();
    const stay = [];
    for (const p of this.pages) {
      if (p === open || kept(this, p)) { stay.push(p); continue; }
      try {
        this.files.remove(path.join(this.dir, p.name));
        this.bytesOnDisk -= p.bytes;
      } catch { stay.push(p); }
    }
    this.pages = stay;
    if (!this.active && !this.pages.length) {
      try { this.files.removeTree(this.dir); this.gone = true; } catch { /* the next prune tries again */ }
    }
  }

  /** Every Cluster still on disk, with where its bytes are. */
  clusters() {
    const out = [];
    for (const p of this.pages) {
      for (const c of p.clusters) out.push({ ...c, file: path.join(this.dir, p.name) });
    }
    return out;
  }
}

// ── The recorder ────────────────────────────────────────────────────────────

// The one the app made, for the boot checks to read its holds (current()).
let current = null;

/**
 * new Recorder(deps), where deps are:
 *
 *   root        userData/recording
 *   prefs       { get, set }: recordingMode, recordingRes, recordingStrikes,
 *               recordingAutoOff, recordingLast
 *   page        () => Promise of a page: { send(msg), pid(), close(),
 *               onMessage(fn(kind, msg)) }, kind 'status', 'chunk', 'reply' or 'gone'
 *   source      () => Promise of { sourceId, displayId, display: { width,
 *               height } }, the primary display, or null
 *   gdi         () => Promise of one GDI frame, base64 JPEG
 *   capture     { useStream(source | null) }
 *   metrics     (pid) => { recorderCpu (% of one core), systemCpu (%), memoryMB }
 *   freeBytes   (dir) => free bytes on its drive, or null
 *   inMatch     () => whether a match is in progress (valorantInMatch)
 *   keepSince   () => when the match in progress began (ms), or null
 *               (valorantKeepSince)
 *   readSize    () => the read's frame { width, height }, the capture
 *               profile's: the recording covers it (fitSize)
 *   cadence     () => the read's gap now, for the notices' words
 *   still       () => what goes on without the recording, in a game whose
 *               screen the coach does not read (League), or null
 *   limits      () => health limits to lay over HEALTH (dev only)
 *   pageMs      () => a page's length (dev only)
 *   fake        null, or what the page draws instead of the screen
 *   files, now, timers, version, log
 *
 * Events: 'notice' { kind, text } (text null clears its kind), 'report' (the
 * session's block, at its end however it ended: Stop, quit, logout or Windows
 * ending the session, then { exiting }, true when shutdown() was told the
 * process ends next), 'running' (bool, a recording is being made: false
 * once after every true, and never otherwise), 'prefs' (Auto turned itself
 * off), 'view' (what Settings says of the recording changed: liveView, or
 * the reason this session stopped recording).
 */
class Recorder extends EventEmitter {
  constructor(deps) {
    super();
    const d = deps || {};
    this.root = d.root;
    this.prefs = d.prefs;
    this.openPage = d.page;
    this.pickSource = d.source || (async () => null);
    this.gdi = d.gdi || (async () => null);
    this.capture = d.capture || { useStream() {} };
    this.metrics = d.metrics || (() => ({}));
    this.freeBytes = d.freeBytes || realFreeBytes;
    this.inMatch = d.inMatch || (() => false);
    this.keepSince = d.keepSince || (() => null);
    this.readSize = d.readSize || (() => READ_SIZE);
    this.cadence = d.cadence || (() => 1000);
    this.still = typeof d.still === 'function' ? d.still : () => null;
    this.devLimits = d.limits || (() => ({}));
    this.devPageMs = d.pageMs || (() => null);
    // Read at each recording's start, so a check can draw black for one.
    this.devFake = typeof d.fake === 'function' ? d.fake : () => d.fake || null;
    this.files = d.files || realFiles;
    this.now = d.now || Date.now;
    this.timers = d.timers || { setTimeout, clearTimeout, setInterval, clearInterval };
    this.version = d.version || 'unknown';
    this.log = d.log || (() => {});
    this.keepRecentMs = KEEP_RECENT_MS;

    this.segments = [];
    this.holds = [];
    this.session = null;
    this.ending = null;            // a session stopped whose last step has not run: shutdown() ends it
    this.page = null;
    this.seg = null;
    this.state = 'idle';           // idle | starting | recording | stopping
    this.runningOn = false;        // 'running' as it was last told (running())
    this.serving = false;
    this.health = null;            // the page's last report, and when it came
    this.rules = createHealth();
    this.waits = new Set();
    this.replies = new Map();
    this.reqSeq = 0;
    this.chain = Promise.resolve();
    this.timer = null;
    this.deadPage = null;          // a page whose renderer went away, which answers nothing
    this.lastMode = this.mode();
    // Whether "Capture is black" is up, for the session: a later comparison
    // that sees the game takes it down again.
    this.bothNoticed = false;
    this.resetSegmentState();
    this.lastLiveKey = 'null';     // liveView() as Settings was last told it
    current = this;
  }

  resetSegmentState() {
    this.nextCompareAt = null;
    this.comparing = false;
    this.blackStreak = 0;
    this.bothStreak = 0;
    this.grabMisses = 0;
    this.lastChunkAt = null;
    this.lastDiskAt = 0;
    this.lastStatusAt = 0;
    // What the recording had written at the last minute line: { seg, at, bytes, frames }.
    this.statusMark = null;
    this.lastSample = null;
    this.lastMemoryMB = null;
    this.health = null;
    this.liveFps = [];
  }

  mode() { return this.prefs && this.prefs.get('recordingMode') === 'off' ? 'off' : 'auto'; }
  res() { return this.prefs && String(this.prefs.get('recordingRes')) === '1080' ? '1080' : '720'; }

  /** What Settings and the state show: the choice, and why Auto is off if it turned itself off. */
  view() {
    return {
      mode: this.mode(),
      res: this.res(),
      autoOff: (this.prefs && this.prefs.get('recordingAutoOff')) || null,
      last: (this.prefs && this.prefs.get('recordingLast')) || null,
      recording: this.state === 'recording',
      live: this.liveView(),
      // The session in progress, and why it stopped recording if it did: the
      // reason Settings gives before the last session's.
      session: this.session ? { outcome: this.session.outcome || null } : null,
    };
  }

  /**
   * While recording, what Settings' status line says of it: the setting
   * (`res`), the size the track really is (`width`, `height`, from the page's
   * 'started': a 1366x768 laptop on 1080p records 1366x768, and a 3440x1440
   * display on 720p 1720x720, neither of them "1080p" or "720p"), and the
   * frames a second the capture delivers, about. That is the median of the
   * last ten seconds whose picture changed, to the nearest five (so the line
   * does not flicker between 29 and 31), or null while the screen has been
   * still: a still screen delivers a couple a second by design, which says
   * nothing about the recording. Null when not recording. The size is there
   * whenever the track's is known, which is from 'started' on.
   */
  liveView() {
    const seg = this.seg;
    const s = seg && seg.session;
    if (this.state !== 'recording' || !s) return null;
    const m = quantile(this.liveFps, 0.5);
    const out = { res: s.res, fps: m === null ? null : m >= 5 ? Math.round(m / 5) * 5 : Math.max(1, Math.round(m)) };
    const t = seg.track;
    if (t && t.width > 0 && t.height > 0) { out.width = t.width; out.height = t.height; }
    return out;
  }

  // ── At launch and at quit ─────────────────────────────────────────────────

  /** Every recording a run left, deleted: what is on disk at launch is nobody's any more. */
  sweep() {
    let removed = 0;
    for (const name of this.files.list(this.root)) {
      try { this.files.removeTree(path.join(this.root, name)); removed += 1; } catch { /* the next launch tries again */ }
    }
    if (removed) this.log(`[recorder] swept ${removed} recording${removed === 1 ? '' : 's'} an earlier run left`);
    return removed;
  }

  /**
   * Quitting, logging out, or Windows ending its session (index.js, beside
   * main-window.js's 'session-end'): the session over as stopSession ends it,
   * its recorded time counted and its block handed out ('report', and
   * recordingLast), and 'running' false, but all of it now, in this call, and
   * every recording deleted, held or not, before it returns: app.quit()
   * follows at once, and Windows can end the process right after. Ended
   * through here, a session used to send no counts at all and leave Settings
   * the session before's reason, and a logout left the AI log out of every
   * capture for the rest of the run.
   *
   * `opts.exiting`: the process ends next (a quit, Windows ending its
   * session; not a logout, after which the app goes on). The block goes out
   * marked so, and index.js keeps it for the next launch: posted into the
   * exit, it could reach the server and lose its answer, and the next launch
   * sent it again, the session counted twice.
   */
  shutdown(opts) {
    const exiting = !!(opts && opts.exiting);
    const seg = this.seg;
    const sessions = [this.ending, this.session].filter((s, i, all) => s && all.indexOf(s) === i);
    this.session = null;
    for (const s of sessions) {
      s.ended = true;
      if (seg && seg.session === s && seg.startedAt !== null) {
        s.recordedMs += Math.max(0, this.now() - seg.startedAt);
        seg.startedAt = null;   // counted: a stop still in the queue adds nothing
      }
      this.finish(s, exiting);
    }
    this.unserve();
    // The stop's wait too: this page is closed below and answers nothing more.
    this.cancelWaits(true);
    if (this.page) { try { this.page.close(); } catch { /* gone already */ } }
    this.page = null;
    this.seg = null;
    this.state = 'idle';
    for (const g of this.segments) {
      // A stop still in the queue writes nothing more into a folder that is gone.
      g.active = false;
      try { this.files.removeTree(g.dir); } catch { /* swept at the next launch */ }
    }
    this.segments = [];
    this.holds = [];
    this.stopTimer();
    this.running(false);
  }

  // ── A session: Start to Stop ──────────────────────────────────────────────

  /**
   * Recording follows the session (Valorant's and League's, index.js), if
   * Settings says Auto. `game` is the session's, one of GAMES, for its counts.
   */
  startSession(game) {
    if (this.session) return;
    const s = {
      at: this.now(), game: GAMES.includes(game) ? game : GAMES[0], mode: this.mode(), res: this.res(), outcome: null, encoderOk: null,
      recordedMs: 0, fps: [], recorderCpu: [], systemCpu: [],
      gaveUp: false, paused: false, ended: false, finished: false, limits: this.devLimits() || {},
    };
    this.session = s;
    this.bothNoticed = false;
    this.ensureTimer();
    if (s.mode === 'off') { s.outcome = 'off'; return; }
    this.enqueue(() => this.startSegment(s));
  }

  /**
   * The session is over: the recording stopped cleanly (its last chunks
   * written), and the session's counts handed out as 'report'. A session that
   * never got as far as recording or refusing has nothing to count.
   * Resolves with the block, or null.
   */
  stopSession() {
    const s = this.session;
    if (!s) return Promise.resolve(null);
    this.session = null;
    s.ended = true;
    // Until its last step has run, a quit ends it at once (shutdown).
    this.ending = s;
    this.unserve();
    this.cancelWaits();
    if (this.page) this.state = 'stopping';
    let block = null;
    return this.enqueue(async () => {
      await this.stopSegment();
      block = this.finish(s);
    }).then(() => block);
  }

  /**
   * A session's end, once only: recordingLast, and its block as 'report',
   * with whether the process ends next (`exiting`, shutdown()'s).
   */
  finish(s, exiting) {
    if (!s || s.finished) return null;
    s.finished = true;
    if (this.ending === s) this.ending = null;
    const outcome = s.outcome || (s.recordedMs > 0 ? 'recorded' : null);
    if (!outcome) return null;
    s.outcome = outcome;
    if (this.prefs) this.prefs.set('recordingLast', { outcome, at: this.now() });
    const block = reportBlock(s, this.version);
    this.log(`[recorder] session over: ${JSON.stringify(block)}`);
    this.emit('report', block, { exiting: !!exiting });
    return block;
  }

  /** Paused, nothing is read, so nothing is recorded either: the recording stops and starts again on resume. */
  pause() {
    const s = this.session;
    if (!s || s.paused) return;
    s.paused = true;
    this.unserve();
    this.cancelWaits();
    if (this.page) this.state = 'stopping';
    this.enqueue(() => this.stopSegment());
  }

  resume() {
    const s = this.session;
    if (!s || !s.paused) return;
    s.paused = false;
    if (s.gaveUp || this.mode() !== 'auto') return;
    this.enqueue(() => this.startSegment(s));
  }

  /**
   * Settings changed. On (auto) chosen again after it turned itself off is the
   * "Try again" Settings offers: the strikes are forgotten. Off chosen by hand
   * is the player's own, so the reason Settings gave goes. Either applies to
   * the session in progress at once.
   *
   * OFF CHOSEN BY HAND TAKES WHAT WAS RECORDED WITH IT (discard), whether a
   * session is running or not: a finished match's recording is held for up to
   * an hour, and before, Riot's look landing minutes after Off still cut its
   * clips and kept them beside the review. Auto turning itself off is not
   * this: strike() sets lastMode before it writes the setting, so it never
   * comes here, and the match it gave up in keeps its recording for its clips.
   */
  prefsChanged() {
    const mode = this.mode();
    if (mode === this.lastMode) return;
    this.lastMode = mode;
    if (this.prefs) {
      if (mode === 'auto') this.prefs.set('recordingStrikes', []);
      this.prefs.set('recordingAutoOff', null);
    }
    const s = this.session;
    if (mode === 'off') {
      this.discard();
      if (s) {
        s.mode = mode;
        if (!s.outcome) s.outcome = 'off';
        this.unserve();
        this.cancelWaits();
        if (this.page) this.state = 'stopping';
        this.enqueue(() => this.stopSegment());
      }
      // And the recording that was being written, once its stop is done.
      this.enqueue(() => this.discard());
      return;
    }
    if (!s) return;
    s.mode = mode;
    if (!s.gaveUp && !s.paused) {
      if (s.outcome === 'off') s.outcome = null;
      this.enqueue(() => this.startSegment(s));
    }
  }

  /**
   * Off chosen by hand (prefsChanged): every hold let go and every recording
   * deleted, so nothing recorded before it can become a clip. The one being
   * written goes once it has stopped, and no clip is cut from it meanwhile.
   */
  discard() {
    this.holds = [];
    for (const g of this.segments) {
      g.discarded = true;
      if (g === this.seg) continue;
      g.active = false;
      try { this.files.removeTree(g.dir); g.gone = true; } catch { /* the next prune or launch takes it */ }
    }
    this.segments = this.segments.filter((g) => !g.gone);
  }

  /**
   * The displays changed (index.js, on screen's display-added, display-removed
   * and display-metrics-changed), with the primary display's id now. A
   * recording is of the display that was primary when it opened, Chromium's
   * source being tied to that one monitor, while the GDI helper reads whichever
   * is primary at each frame. So when another display became the primary one
   * (the game moved to it, a laptop docked), every read the stream served, the
   * recording and its clips were of the old one: Discord, a browser, sent to
   * the read and kept in the AI log. A recording on a display that is not the
   * primary one any more stops serving the read at once, stops, and starts
   * again on the primary, through the queue. True when it does.
   */
  displaysChanged(primaryId) {
    const seg = this.seg;
    const s = seg && seg.session;
    if (!seg || seg.moved || seg.displayId === null || primaryId === null || primaryId === undefined) return false;
    if (!this.live(s) || s.paused || s.gaveUp || String(primaryId) === String(seg.displayId)) return false;
    seg.moved = true;
    this.log(`[recorder] display ${primaryId} is the primary one now, not ${seg.displayId}: recording it instead`);
    this.unserve();
    if (this.page) this.state = 'stopping';
    this.enqueue(() => this.stopSegment());
    this.enqueue(() => this.startSegment(s));
    return true;
  }

  // ── Holds ─────────────────────────────────────────────────────────────────

  /**
   * Keep the recording of [from, to] (wall clock ms) until released, and for
   * `forMs` at most (an hour). As holdAiLogFrames: a finished match is held
   * until its review has looked at it, because Riot publishes minutes later.
   */
  hold(from, to, forMs) {
    if (!Number.isFinite(from) || !Number.isFinite(to)) return null;
    const h = { from, to, until: this.now() + (Number.isFinite(forMs) && forMs > 0 ? forMs : HOLD_MAX_MS) };
    this.holds.push(h);
    return h;
  }

  release(h) {
    if (h) this.holds = this.holds.filter((x) => x !== h);
  }

  /**
   * A clip of [fromWall, toWall] cut out of the pages on disk (webm.cutClip),
   * from the recording that covers it: { bytes, mime, startWall }, startWall
   * the wall clock of the clip's 0, or null when no page kept holds it.
   *
   * WHICH RECORDING, when a session holds more than one (a pause, a stop and
   * start between them): the one `at` falls in, the moment the clip is of (a
   * death). The first that overlapped at all was taken before, and a death a
   * few seconds into a recording after a pause, its eleven seconds before
   * reaching back into the one before it, was cut from that one: a clip of the
   * seconds before the pause, without the death. With no `at`, the one the
   * window overlaps most.
   *
   * AND ONLY ONE THAT HOLDS THE MOMENT. A recording that stopped a few seconds
   * before the death (given up as busy, a pause, Stop mid round) or began a
   * few after it (Start pressed mid round, League started mid game) still
   * overlaps the clip's window, and was cut anyway: on the fixture, a death 2 s
   * after the recording ended gave the 10 s before its end, and one 3.5 s
   * before it began gave its first second, each kept as the death's clip and
   * captioned so. The moment is itself an estimate (shared/clips.js momentOf:
   * Riot's second read off a clock to the second, or the frame that registered
   * the death after it), so a recording holds it to within a second of either
   * end; past that there is no clip, and the moment is counted as missed
   * (review-clips.js).
   */
  cutClip(fromWall, toWall, at) {
    const SLACK_MS = 1000;
    const timed = Number.isFinite(at);
    const spans = [];
    for (const g of this.segments) {
      const z = g.zero();
      // Off chosen by hand: nothing recorded before it becomes a clip (discard).
      if (z === null || !g.init || g.discarded) continue;
      const clusters = g.clusters();
      if (!clusters.length) continue;
      const first = z + clusters[0].timecode;
      const last = clusters[clusters.length - 1];
      const end = z + (Number.isFinite(last.last) ? last.last : last.timecode);
      if (toWall < first || fromWall > end) continue;
      if (timed && !(at > first - SLACK_MS && at < end + SLACK_MS)) continue;
      // How far the moment lies outside it: 0 for one it falls in, which goes
      // first where two hold it within their second (back to back recordings).
      const outside = timed ? Math.max(0, first - at, at - end) : 0;
      spans.push({ g, z, clusters, outside, overlap: Math.min(toWall, end) - Math.max(fromWall, first) });
    }
    spans.sort((a, b) => (a.outside - b.outside) || (b.overlap - a.overlap));
    const files = this.files;
    for (const { g, z, clusters } of spans) {
      const bytes = webm.cutClip({
        init: g.init, clusters, from: fromWall - z, to: toWall - z,
        read: (c) => files.read(c.file, c.offset, c.size),
      });
      if (bytes) {
        const head = webm.parseInit(g.init);
        // Where the clip's own 0 is on the wall clock (8.3.1): the look takes
        // its stills at seconds from the death, and the clip opens on the
        // keyframe at or before its first second, up to a second early. The
        // same plan cutClip cut by.
        const plan = webm.planClip(clusters, fromWall - z, toWall - z);
        return { bytes, mime: head ? head.mime : 'video/x-matroska', startWall: plan ? z + plan.start : null };
      }
    }
    return null;
  }

  /** For the logs and the checks: what is on disk and what is held. */
  stats() {
    let pages = 0;
    let bytes = 0;
    for (const g of this.segments) { pages += g.pages.length; bytes += g.bytesOnDisk; }
    return { state: this.state, serving: this.serving, recordings: this.segments.length, pages, bytes, holds: this.holds.length };
  }

  // ── The recording itself ──────────────────────────────────────────────────

  enqueue(fn) {
    this.chain = this.chain.then(fn).catch((e) => this.log('[recorder] ' + ((e && e.stack) || e)));
    return this.chain;
  }

  live(s) { return !!s && this.session === s && !s.ended; }

  /** Whether a session still wants a recording: live, not paused, not given up, not Off. */
  wanted(s) { return this.live(s) && !s.paused && !s.gaveUp && s.mode !== 'off'; }

  /** 'running', told once for each change: false only ever after a true. */
  running(on) {
    if (this.runningOn === !!on) return;
    this.runningOn = !!on;
    this.emit('running', !!on);
  }

  free() {
    try {
      const n = this.freeBytes(this.root);
      return Number.isFinite(n) ? n : null;
    } catch { return null; }
  }

  async startSegment(s) {
    if (!this.wanted(s) || this.page || this.seg) return;
    const free = this.free();
    if (free !== null && free < DISK_START_BYTES) {
      this.giveUp(s, 'disk', { atStart: true, why: `${(free / GB).toFixed(1)} GB free` });
      return;
    }
    this.state = 'starting';
    const fake = this.devFake() || null;
    let source = null;
    if (!fake) {
      try { source = await this.pickSource(); } catch { source = null; }
      if (!this.wanted(s)) { this.state = 'idle'; return; }
      if (!source || !source.sourceId) {
        this.giveUp(s, 'error', { why: 'no capture source is the primary display' });
        this.state = 'idle';
        return;
      }
    }
    const display = source ? source.display : FAKE_DISPLAY;
    let read = READ_SIZE;
    try { read = this.readSize() || READ_SIZE; } catch { read = READ_SIZE; }
    const size = fitSize(display, s.res, read);
    const bitrate = bitrateFor(size, s.res);
    let page = null;
    try { page = await this.openPage(); } catch (e) { page = null; this.log('[recorder] the page did not open: ' + e.message); }
    if (!this.wanted(s)) {
      if (page) { try { page.close(); } catch { /* gone */ } }
      this.state = 'idle';
      return;
    }
    if (!page) { this.giveUp(s, 'error', { why: 'the recorder page did not open' }); this.state = 'idle'; return; }
    const dir = path.join(this.root, 'rec-' + stamp(this.now()));
    try { this.files.mkdir(dir); } catch (e) {
      try { page.close(); } catch { /* gone */ }
      this.giveUp(s, 'error', { why: 'the recording folder could not be made: ' + e.message });
      this.state = 'idle';
      return;
    }
    const pageMs = Number(this.devPageMs()) > 0 ? Number(this.devPageMs()) : PAGE_MS;
    const seg = new Segment(dir, this.files, pageMs);
    seg.session = s;
    seg.display = display;
    seg.bitrate = bitrate;
    seg.displayId = source && source.displayId !== undefined && source.displayId !== null ? source.displayId : null;
    this.segments.push(seg);
    this.resetSegmentState();
    this.rules = createHealth(s.limits);
    this.page = page;
    this.seg = seg;
    page.onMessage((kind, m) => this.fromPage(page, kind, m));
    page.send({
      type: 'start', fake, sourceId: source ? source.sourceId : null,
      width: size.width, height: size.height, fps: ASK_FPS, bitrate, codec: codecFor(size),
      mimeTypes: MIME_TYPES, keyframeMs: KEYFRAME_MS, timesliceMs: TIMESLICE_MS,
    });
    const started = await this.waitFor(page, 'started', START_TIMEOUT_MS);
    // Stopped, paused, given up, turned Off or moved to another display while
    // it started: the stop that follows in the queue closes the page.
    if (this.page !== page || !this.wanted(s) || seg.moved) return;
    if (!started || !started.ok) {
      if (started && typeof started.encoderOk === 'boolean') s.encoderOk = started.encoderOk;
      const outcome = started && started.outcome === 'no-hw-encoder' ? 'no-hw-encoder' : 'error';
      this.giveUp(s, outcome, { why: (started && started.why) || 'the recorder did not start within ' + START_TIMEOUT_MS / 1000 + ' s' });
      return;
    }
    s.encoderOk = true;
    seg.startWall = Number.isFinite(started.startWall) ? started.startWall : this.now();
    seg.startedAt = this.now();
    this.state = 'recording';
    this.lastChunkAt = this.now();
    this.lastDiskAt = this.now();
    this.lastStatusAt = this.now();
    this.statusMark = { seg, at: this.now(), bytes: seg.bytesWritten, frames: seg.framesWritten };
    this.nextCompareAt = this.now() + COMPARE_FIRST_MS;
    const st = started.settings || {};
    // The size the track really is, for Settings (liveView) and for the read.
    seg.track = st.width > 0 && st.height > 0 ? { width: st.width, height: st.height } : { ...size };
    const kept = aspectKept(st, display);
    const took = Number(started.videoBitsPerSecond);
    this.log(`[recorder] recording ${st.width}x${st.height} of a ${display.width}x${display.height} display`
      + ` (${kept ? 'its own shape' : 'NOT its own shape'}), asked ${size.width}x${size.height} at up to ${ASK_FPS} fps,`
      + ` ${round1(bitrate / 1e6)} Mbps, ${started.mime || 'H.264'}${fake ? ', from a generated canvas' : ''};`
      + ` the track's own settings ${Number.isFinite(st.frameRate) ? `${round1(st.frameRate)} fps` : 'with no frame rate'},`
      + ` MediaRecorder at ${took > 0 ? `${round1(took / 1e6)} Mbps` : 'a bitrate it did not say'}`);
    // A track that cannot cover the read's frame (fitSize stopped at H.264
    // level 4.0's frame on a very wide display) would hand the read fewer rows
    // than GDI: the read stays on GDI for this recording, which goes on.
    if (!covers(seg.track, read, display)) {
      seg.coversRead = false;
      this.log(`[recorder] the recording, ${seg.track.width}x${seg.track.height}, is smaller than the read's ${read.width}x${read.height}`
        + ' frame: the read stays on the GDI helper for this recording');
    }
    this.running(true);
  }

  /** The recording stops cleanly: the page's last chunks come, then it closes. */
  async stopSegment() {
    const page = this.page;
    const seg = this.seg;
    if (!page && !seg) { if (this.state !== 'idle') this.state = 'idle'; this.running(false); return; }
    this.unserve();
    this.state = 'stopping';
    if (page) {
      if (this.deadPage !== page) {
        try { page.send({ type: 'stop' }); } catch { /* it is closed below either way */ }
        const stopped = await this.waitFor(page, 'stopped', STOP_TIMEOUT_MS);
        // What the page says it handed over, held against what came
        // (check:recorder): a chunk lost between Stop and its answer is the
        // last second of a match.
        if (seg && stopped && Number.isFinite(stopped.chunks)) seg.pageChunks = stopped.chunks;
      }
      try { page.close(); } catch { /* gone already */ }
    }
    if (seg) {
      seg.finish();
      if (seg.startedAt !== null && seg.session) seg.session.recordedMs += Math.max(0, this.now() - seg.startedAt);
    }
    if (this.page === page) this.page = null;
    if (this.seg === seg) this.seg = null;
    this.state = 'idle';
    this.health = null;
    this.running(false);
  }

  /**
   * Give up for the session: the reads back on the GDI helper at once, the
   * recording stopped cleanly, and one notice. The first reason is the
   * session's outcome; nothing after it starts the recorder again until the
   * next session.
   */
  giveUp(s, outcome, opts) {
    if (!this.live(s) || s.gaveUp) return;
    const o = opts || {};
    s.gaveUp = true;
    if (!s.outcome || s.outcome === 'recorded') s.outcome = outcome;
    this.unserve();
    this.cancelWaits();
    if (this.page) this.state = 'stopping';
    this.log(`[recorder] stopped for this session: ${outcome}${o.why ? ' (' + o.why + ')' : ''}`);
    const every = everyText(this.cadence());
    let still = null;
    try { still = this.still() || null; } catch { still = null; }
    if (outcome === 'busy') {
      this.emit('notice', { kind: 'recorder', text: NOTICE.busy(every, still) });
      this.strike();
    } else if (outcome === 'black') {
      this.emit('notice', { kind: 'recorder', text: NOTICE.black(every, still) });
    } else if (outcome === 'disk') {
      this.emit('notice', { kind: 'recorder', text: o.atStart ? NOTICE.diskStart(every, still) : NOTICE.diskStop(every, still) });
    }
    // Settings gives this session's reason (view()): a start refused (no
    // hardware encoder) was told only by a 'running' false it had no true for.
    this.emit('view');
    this.enqueue(() => this.stopSegment());
  }

  /** A busy session counted; the second in a week turns Auto off. */
  strike() {
    if (!this.prefs) return;
    const now = this.now();
    const r = strikeOut(this.prefs.get('recordingStrikes'), now);
    this.prefs.set('recordingStrikes', r.strikes);
    if (r.off && this.mode() === 'auto') {
      this.lastMode = 'off';
      this.prefs.set('recordingMode', 'off');
      this.prefs.set('recordingAutoOff', { at: now, reason: 'busy', sessions: r.strikes.length });
      this.log(`[recorder] Auto is off: ${r.strikes.length} busy sessions in the last week`);
      this.emit('prefs');
    }
  }

  // ── The page ──────────────────────────────────────────────────────────────

  fromPage(page, kind, m) {
    if (page !== this.page) return;
    const s = this.seg && this.seg.session;
    if (kind === 'gone') {
      // A page that crashed answers nothing: its stop is not waited for.
      this.deadPage = page;
      this.settle(page, 'stopped', null);
      this.giveUp(s, 'error', { why: 'the recorder page went away' + (m && m.why ? ' (' + m.why + ')' : '') });
      return;
    }
    if (kind === 'chunk') { this.onChunk(m); return; }
    if (kind === 'reply') { this.answer(m && m.id, m); return; }
    if (kind !== 'status' || !m) return;
    if (m.type === 'health') { this.health = { ...m, receivedAt: this.now() }; return; }
    if (m.type === 'error') {
      if (this.state === 'stopping') return;
      this.giveUp(s, 'error', { why: `the page failed in ${m.where || 'a step'}: ${m.message || 'no reason given'}` });
      return;
    }
    this.settle(page, m.type, m);
  }

  onChunk(m) {
    const seg = this.seg;
    if (!seg || !m) return;
    // IPC loses nothing, so a chunk out of order is a recording that is broken.
    if (Number.isFinite(m.seq) && m.seq !== seg.chunks) {
      this.giveUp(seg.session, 'error', { why: `chunk ${seg.chunks} never came, ${m.seq} did` });
      return;
    }
    this.lastChunkAt = this.now();
    if (!seg.push(m.data, Number(m.wall))) this.giveUp(seg.session, 'error', { why: seg.error });
  }

  waitFor(page, type, ms) {
    return new Promise((resolve) => {
      const w = { page, type, done: null };
      const timer = this.timers.setTimeout(() => w.done(null), ms);
      w.done = (m) => {
        if (!this.waits.has(w)) return;
        this.waits.delete(w);
        this.timers.clearTimeout(timer);
        resolve(m);
      };
      this.waits.add(w);
    });
  }

  settle(page, type, m) {
    for (const w of [...this.waits]) if (w.page === page && w.type === type) w.done(m);
  }

  /**
   * Whatever waits on the page goes on without it, except a stop's wait for
   * its last chunks, unless `all` (shutdown, which closes the page at once).
   */
  cancelWaits(all) {
    for (const w of [...this.waits]) if (all || w.type !== 'stopped') w.done(null);
    for (const [id, r] of [...this.replies]) { this.replies.delete(id); r.done(null); }
  }

  request(page, msg, ms) {
    const id = ++this.reqSeq;
    return new Promise((resolve) => {
      const timer = this.timers.setTimeout(() => { if (this.replies.delete(id)) resolve(null); }, ms);
      this.replies.set(id, { done: (m) => { this.timers.clearTimeout(timer); resolve(m); } });
      try { page.send({ ...msg, id }); } catch {
        this.replies.delete(id);
        this.timers.clearTimeout(timer);
        resolve(null);
      }
    });
  }

  answer(id, m) {
    const r = this.replies.get(id);
    if (!r) return;
    this.replies.delete(id);
    r.done(m);
  }

  // ── The live read ─────────────────────────────────────────────────────────

  /**
   * The live read takes its frame from the recording (capture.js), not the
   * GDI helper. Not from a recording too small to cover it (fitSize), nor one
   * of a display that is no longer the primary one (displaysChanged).
   */
  serve() {
    if (this.serving || this.state !== 'recording' || !this.page) return;
    if (this.seg && (!this.seg.coversRead || this.seg.moved)) return;
    const page = this.page;
    this.serving = true;
    this.capture.useStream({ grab: (profile) => this.grab(page, profile) });
    this.log('[recorder] the live read takes its frame from the recording now, not the GDI helper');
  }

  unserve() {
    if (!this.serving) return;
    this.serving = false;
    this.capture.useStream(null);
    this.log('[recorder] the live read is back on the GDI helper');
  }

  /**
   * One frame for the read, the size and quality of the capture profile
   * (CAPTURE.profiles in src/shared/config.js), stretched to it as the GDI
   * helper does. Null when the page has no fresh frame, which the caller
   * takes as a frame for the GDI helper to take.
   */
  async grab(page, profile) {
    if (page !== this.page || this.state !== 'recording') return null;
    const p = profile || {};
    const want = { width: p.targetW || 1280, height: p.targetH || 720 };
    // A frame asked bigger than the track (Performance changed to Standard
    // since it started) would be stretched up from fewer rows than GDI reads.
    const seg = this.seg;
    if (seg && seg.track && !covers(seg.track, want, seg.display)) return null;
    const r = await this.request(page, {
      type: 'grab', width: want.width, height: want.height, quality: (p.jpegQuality || 70) / 100,
    }, GRAB_TIMEOUT_MS);
    // Stopping by now (the display it records stopped being the primary one,
    // say): its frame is no longer the one the read wants.
    if (page !== this.page || this.state !== 'recording') return null;
    if (!r) {
      this.grabMisses += 1;
      if (this.grabMisses >= GRAB_MISSES) {
        this.giveUp(this.seg && this.seg.session, 'error', { why: `the recorder page answered none of ${GRAB_MISSES} reads in a row` });
      }
      return null;
    }
    this.grabMisses = 0;
    if (!r.ok) return null;
    const b = toBuffer(r.jpeg);
    return b && b.length ? b.toString('base64') : null;
  }

  // ── Once a second ─────────────────────────────────────────────────────────

  ensureTimer() {
    if (this.timer) return;
    this.timer = this.timers.setInterval(() => {
      try { this.tick(); } catch (e) { this.log('[recorder] tick: ' + e.message); }
    }, 1000);
    if (this.timer && typeof this.timer.unref === 'function') this.timer.unref();
  }

  stopTimer() {
    if (!this.timer) return;
    this.timers.clearInterval(this.timer);
    this.timer = null;
  }

  tick() {
    const now = this.now();
    this.holds = this.holds.filter((h) => h.until > now);
    const s = this.session;
    if (this.state === 'recording' && this.seg && this.seg.session === s && this.live(s)) {
      this.sampleHealth(now, s);
      if (this.state === 'recording') this.checkDisk(now, s);
      if (this.state === 'recording' && !this.comparing && this.nextCompareAt !== null && now >= this.nextCompareAt) this.compare(s);
      if (this.state === 'recording' && now - this.lastStatusAt >= 60000) this.logStatus(now, s);
    }
    this.prune(now);
    // What Settings says of the recording moved (its rounded frame rate, or
    // recording at all): 'view', which index.js pushes with the state.
    const key = JSON.stringify(this.liveView());
    if (key !== this.lastLiveKey) { this.lastLiveKey = key; this.emit('view'); }
    // Nothing on disk and nothing recording: a hold with no pages to keep
    // needs no tick, and the next session's first one drops it if expired.
    if (!this.session && !this.segments.length && !this.page) this.stopTimer();
  }

  sampleHealth(now, s) {
    const h = this.health;
    const fresh = !!h && now - h.receivedAt <= REPORT_STALE_MS;
    const sinceChunk = now - (this.lastChunkAt === null ? now : this.lastChunkAt);
    const pageLag = fresh && Number.isFinite(h.lagMs) ? h.lagMs : 0;
    let m = {};
    try { m = this.metrics(this.page ? this.page.pid() : null) || {}; } catch { m = {}; }
    const sample = {
      at: now,
      inMatch: !!this.inMatch(),
      fps: fresh && Number.isFinite(h.fps) ? h.fps : 0,
      changing: fresh && !!h.changing,
      stalled: !fresh || (Number.isFinite(h.frameAgeMs) && h.frameAgeMs > STALE_FRAME_MS),
      lagMs: Math.max(0, sinceChunk - TIMESLICE_MS, pageLag),
      recorderCpu: Number.isFinite(m.recorderCpu) ? m.recorderCpu : null,
      systemCpu: Number.isFinite(m.systemCpu) ? m.systemCpu : null,
    };
    this.lastSample = sample;
    this.lastMemoryMB = Number.isFinite(m.memoryMB) ? m.memoryMB : null;
    // Settings' "about 30 fps" (liveView), in a match or not.
    if (sample.changing) { this.liveFps.push(sample.fps); if (this.liveFps.length > 10) this.liveFps.shift(); }
    if (sample.inMatch) {
      const keep = (xs, v) => { xs.push(v); if (xs.length > MAX_SAMPLES) xs.shift(); };
      if (sample.changing) keep(s.fps, sample.fps);
      if (sample.recorderCpu !== null) keep(s.recorderCpu, sample.recorderCpu);
      if (sample.systemCpu !== null) keep(s.systemCpu, sample.systemCpu);
    }
    const verdict = this.rules.sample(sample);
    if (verdict) {
      const L = this.rules.limits;
      const why = {
        fps: `under ${L.minFps} frames a second while the picture changed`,
        lag: `a chunk more than ${L.maxLagMs / 1000} s late`,
        recorderCpu: `the recorder over ${L.maxRecorderCpu}% of a core`,
        systemCpu: `the PC over ${L.maxSystemCpu}% CPU`,
      }[verdict.rule];
      this.giveUp(s, 'busy', { why: `${why} for ${Math.round(verdict.forMs / 1000)} s` });
    }
  }

  checkDisk(now, s) {
    if (now - this.lastDiskAt < DISK_CHECK_MS) return;
    this.lastDiskAt = now;
    const free = this.free();
    if (free !== null && free < DISK_STOP_BYTES) this.giveUp(s, 'disk', { why: `${(free / GB).toFixed(1)} GB left` });
  }

  /**
   * The comparison with GDI (compareVerdict): GDI first, then the stream's
   * newest frame, so the two are the same moment to within a frame or so.
   * With GDI unavailable (the helper blocked), a stream that is not black is
   * the only source there is, and the reads take it.
   */
  async compare(s) {
    const page = this.page;
    this.comparing = true;
    let next = COMPARE_EVERY_MS;
    try {
      let gdi = null;
      try { gdi = await this.gdi(); } catch { gdi = null; }
      if (this.page !== page || this.state !== 'recording') return;
      const r = await this.request(page, { type: 'compare', gdi: gdi ? Buffer.from(gdi, 'base64') : null }, COMPARE_TIMEOUT_MS);
      if (this.page !== page || this.state !== 'recording') return;
      if (!r || !r.ok) { next = CONFIRM_MS; return; }
      const verdict = gdi ? compareVerdict(r) : (Number.isFinite(r.streamLuma) && r.streamLuma >= BLACK_LUMA ? 'ok' : null);
      this.log(`[recorder] the stream against GDI: brightness ${r.streamLuma} and ${gdi ? r.gdiLuma : 'unavailable'},`
        + ` differing by ${Number.isFinite(r.mad) ? r.mad : 'n/a'} of 255 on average: ${verdict || 'undecided'}`);
      if (verdict === 'stream-black') {
        this.blackStreak += 1;
        if (this.blackStreak >= BLACK_CONFIRMS) {
          this.giveUp(s, 'black', { why: `the stream read black ${this.blackStreak} times while GDI did not` });
          return;
        }
        next = CONFIRM_MS;
        return;
      }
      this.blackStreak = 0;
      if (verdict === 'both-black') {
        this.bothStreak += 1;
        if (this.bothStreak >= BLACK_CONFIRMS && !this.bothNoticed) {
          this.bothNoticed = true;
          this.emit('notice', { kind: 'capture', text: NOTICE.bothBlack() });
        }
        if (this.bothStreak < BLACK_CONFIRMS) next = CONFIRM_MS;
      } else {
        this.bothStreak = 0;
        if (verdict === 'ok' && this.bothNoticed) {
          this.bothNoticed = false;
          this.emit('notice', { kind: 'capture', text: null });
        }
      }
      if (verdict === 'ok' || verdict === 'both-black') this.serve();
      if (verdict === null) next = CONFIRM_MS;
    } finally {
      this.comparing = false;
      if (this.page === page && this.state === 'recording') this.nextCompareAt = this.now() + next;
    }
  }

  /**
   * Once a minute: how the PC is coping, in counts, for anyone reading
   * debug.log. Beside the frames the capture delivered (the fps p50, of the
   * seconds in a match whose picture changed), the track's own settings as
   * the page last read them, and what the recording wrote since the last
   * line against what it was asked for (8.4.1): on the player's Fracture
   * swiftplay it fell from 57 to 32 frames a second for its last two minutes
   * with no line saying why, and its pages ran 74 to 91 MB a minute at 57,
   * about twice the 6 Mbps asked, a constant 24 KB a frame. Counts only, and
   * no rule reads them.
   */
  logStatus(now, s) {
    this.lastStatusAt = now;
    const last = (xs) => xs.slice(-60);
    const st = this.stats();
    const l = this.lastSample || {};
    const h = this.health || {};
    this.log(`[recorder] fps p50 ${quantile(last(s.fps), 0.5)}, ${trackText(h.track)}, ${this.writtenSince(now)},`
      + ` recorder CPU p50 ${round1(quantile(last(s.recorderCpu), 0.5))}% of a core,`
      + ` PC CPU p90 ${round1(quantile(last(s.systemCpu), 0.9))}%, page memory ${this.lastMemoryMB === null ? 'n/a' : this.lastMemoryMB + ' MB'},`
      + ` frames held open ${Number.isFinite(h.framesOpen) ? h.framesOpen : 'n/a'}, lag ${Math.round(l.lagMs || 0)} ms,`
      + ` ${st.pages} pages on disk (${Math.round(st.bytes / 1048576)} MB), ${st.holds} held`);
  }

  /** What the recording wrote since the last minute line, against the bitrate it was asked for. */
  writtenSince(now) {
    const seg = this.seg;
    const m = this.statusMark;
    if (!seg || !m || m.seg !== seg) return 'nothing written to count yet';
    const secs = Math.max(1, (now - m.at) / 1000);
    const bytes = seg.bytesWritten - m.bytes;
    const frames = seg.framesWritten - m.frames;
    this.statusMark = { seg, at: now, bytes: seg.bytesWritten, frames: seg.framesWritten };
    const asked = Number.isFinite(seg.bitrate) ? `the ${round1(seg.bitrate / 1e6)} Mbps asked` : 'no bitrate asked';
    return `${frames} frames and ${round1(bytes / 1048576)} MB written in the last ${Math.round(secs)} s`
      + ` (${round1(frames / secs)} a second, ${round1((bytes * 8) / 1e6 / secs)} Mbps against ${asked},`
      + ` ${frames > 0 ? `${Math.round(bytes / frames / 1024)} KB` : 'no'} a frame)`;
  }

  /**
   * Delete what nothing needs: a page two minutes old that no hold covers and
   * that ended before the match in progress began.
   */
  prune(now) {
    if (!this.segments.length) return;
    const since = this.keepSince();
    const liveFrom = Number.isFinite(since) ? since : null;
    const holds = this.holds;
    const recent = this.keepRecentMs;
    const kept = (g, p) => {
      const span = g.spanOf(p);
      if (!span) return true;
      if (now - span.to < recent) return true;
      if (liveFrom !== null && span.to >= liveFrom) return true;
      return holds.some((h) => span.from <= h.to && span.to >= h.from);
    };
    for (const g of this.segments) g.prune(kept);
    this.segments = this.segments.filter((g) => !g.gone);
  }
}

module.exports = {
  current: () => current,
  Recorder, Segment, fitSize, covers, bitrateFor, macroblocks, aspectKept, codecFor, compareVerdict, createHealth,
  strikeOut, reportBlock, valorantInMatch, valorantKeepSince,
  everyText, quantile, trackText, realFreeBytes, NOTICE, OUTCOMES, GAMES, HEALTH, STRIKES, RES, READ_SIZE, MB_LEVEL_31, MB_LEVEL_40,
  BITRATE_MAX_SCALE, MIME_TYPES, ASK_FPS,
  PAGE_MS, KEEP_RECENT_MS, KEEP_MATCH_MS, HOLD_MAX_MS, DISK_START_BYTES, DISK_STOP_BYTES, DISK_CHECK_MS, BLACK_LUMA,
  COMPARE_FIRST_MS, COMPARE_EVERY_MS, CONFIRM_MS, STALE_FRAME_MS, GRAB_TIMEOUT_MS, GRAB_MISSES,
  START_TIMEOUT_MS, STOP_TIMEOUT_MS, REPORT_STALE_MS, FAKE_DISPLAY, KEYFRAME_MS, TIMESLICE_MS,
};
