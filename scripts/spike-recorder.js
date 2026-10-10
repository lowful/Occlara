'use strict';

/**
 * The 8.3 recorder spike. Before anything is wired into the app, measure
 * whether ONE persistent capture source can feed both the 1 frame a second
 * read and a 30 fps recording cheaply, and whether clips can be cut from that
 * recording in plain JavaScript, without ffmpeg. The pass bars reported here
 * are the plan's (8.3, item 1); the ones only the game can show are said so.
 *
 * Dev only and never shipped: electron-builder packages src/ and assets/, not
 * scripts/. It touches no network, no server and no model. What it captures is
 * your own screen, so without --keep every frame and video file it wrote is
 * deleted at the end, whether the run passed, failed or was interrupted, and
 * only report.json and report.md stay. A run killed outright (its terminal
 * closed) cannot clean up, so the next run sweeps what it left. Chromium's own
 * profile for the spike (caches, nothing captured) is kept in the system temp
 * folder as occlara-spike-profile.
 *
 * RUN IT
 *
 *   node scripts/spike-recorder.js [--seconds 60] [--res 720|1080]
 *        [--codec auto|h264|vp9|vp8] [--out <dir>] [--keep] [--motion]
 *
 * which relaunches itself under Electron and prints report.md at the end, or
 * as Electron directly (this shell exports ELECTRON_RUN_AS_NODE=1, which boots
 * Electron as plain node, hence the env -u):
 *
 *   env -u ELECTRON_RUN_AS_NODE npx electron scripts/spike-recorder.js --seconds 20
 *
 *   --seconds  how long to record, 12 to 900 (default 60). The whole recording
 *              is read into memory to be parsed: 900 s at 1080p is about 1 GB.
 *   --res      720 records 1280x720 at 4 Mbps, 1080 records 1920x1080 at 8 Mbps.
 *   --codec    auto tries h264, then vp9, then vp8.
 *   --fps      the frame rate the capture is asked for, 15 to 120 (default
 *              60). Asked for 30 with the whole screen moving, the capturer
 *              delivered about 21; asked for 60, about 31. The report holds the
 *              recorded rate against 30.
 *   --out      the folder for the report. Default: a new spike-<stamp> folder
 *              in the system temp folder (%TEMP%\occlara-spike). Never the repo.
 *   --keep     keep video.webm, clip.webm, clip-indexed.webm and three sample
 *              JPEGs, to look at.
 *   --motion   desk tests only: a small animated window in the bottom right.
 *              The screen capturer delivers a frame only when something on
 *              screen changed, so a still desktop records a few frames a second
 *              and says nothing about 30 fps. Never use it in the game.
 *
 * A run is the 10 s baseline, then --seconds, then about 20 s of analysis.
 *
 * WHAT IT DOES, IN ORDER
 *
 *   1. A hidden window (backgroundThrottling off) is handed the primary
 *      display's source from desktopCapturer, matched on display_id.
 *      app.disableHardwareAcceleration() is deliberately NOT called: the
 *      hardware encoder is the point.
 *   2. 10 s of baseline: this app's CPU from app.getAppMetrics(), once a
 *      second. In the game, this is your time to switch back to it.
 *   3. getUserMedia (chromeMediaSource desktop) at 720p or 1080p, 30 fps max.
 *   4. MediaRecorder with a keyframe every 1000 ms and a 1 s timeslice. This
 *      main process appends each chunk to video.webm and keeps the page's wall
 *      clock time for it.
 *   5. Once a second for the whole run, from a CLONED track: one frame
 *      stretched to 1280x720 (as the GDI helper does), JPEG 0.7, timed, and
 *      its brightness checked for black. Every VideoFrame is closed.
 *   6. CPU and memory during the capture, beside the baseline, and the GPU's
 *      Video Encode and 3D engines for this app's processes, read from the
 *      Windows performance counters (typeperf, which ships with Windows).
 *   7. An EBML reader walks the whole of video.webm, not the chunks (they do
 *      not line up with clusters): the header, Segment, Info, Tracks, Cues,
 *      and every Cluster, whether it starts on a keyframe, and its timecode
 *      against the wall clock of the chunk that carried it.
 *   8. A clip from 8 s before 30 s to 2 s after it (around the middle of a
 *      shorter run) is cut two ways: clip.webm, every byte before the first
 *      Cluster plus whole clusters from the last keyframe cluster at or before
 *      the start, timecodes rebased to 0; and clip-indexed.webm, the same
 *      clusters with Duration and Cues written in, as 8.3's webm.js would.
 *      Both are loaded and seeked in a hidden <video>, and the clip's blocks
 *      are decoded with WebCodecs and compared with what the <video> drew.
 *   9. report.json and report.md: every number, the machine, the arguments,
 *      and a pass or fail for each bar a desk can measure.
 *
 * THE RUN IN VALORANT. FPS loss shows only in the game, so this part is yours.
 * Log frame times with a tool that reads ETW and injects nothing (CapFrameX,
 * PresentMon or NVIDIA FrameView), never an overlay that hooks the game. In
 * The Range, pick one 60 s routine you can repeat exactly.
 *
 *   1. Settings, Video, General, Display Mode: Fullscreen.
 *   2. Spike OFF: log the routine three times, noting the FPS average and the
 *      1% low of each.
 *   3. Spike ON: `node scripts/spike-recorder.js --seconds 300 --res 720`,
 *      switch to the game during the 10 s baseline, and log the routine three
 *      times while it records. In Task Manager, Performance, GPU, set one of
 *      the engine graphs to "Video Encode" and note it (on a second monitor,
 *      or right after). The report reads that engine for the spike's own
 *      processes too.
 *   4. Display Mode: Windowed Fullscreen, then steps 2 and 3 again.
 *   5. All of it again with --res 1080.
 *   6. Loss = (off - on) / off, for the average and for the 1% lows. The bar
 *      is 5% or less for both. Black frames in a Fullscreen report mean the
 *      capture cannot see that mode. That is expected only with Fullscreen
 *      Optimizations turned off for the game's exe, and it is what 8.3's black
 *      capture notice is for.
 *   7. Once with --keep, look at the clip and the three sample frames: they
 *      must show the game, not black, and no Occlara window.
 *
 * Exit code: 0 when the run completed (bars may still fail, the report says
 * which), 1 when it could not complete, 2 for bad arguments.
 */

const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawn, spawnSync } = require('child_process');

const electron = require('electron');

// ---------------------------------------------------------------------------
// What is measured, and against what
// ---------------------------------------------------------------------------

const CHANNEL = 'occlara-spike';      // this script's own IPC channel, never one of the app's
const BASELINE_S = 10;
const TIMESLICE_MS = 1000;
const KEYFRAME_MS = 1000;
// The frame rate a recording should hold. The capture is ASKED for more
// (--fps, default 60): asked for 30 with the whole screen moving, as in a game,
// the capturer delivered about 21, waiting a full frame period after each
// grab; asked for 60 it delivered 31 to 32.
const FPS = 30;
// The live read's frame: the size and quality the read model was benched on,
// CAPTURE.profiles.standard in src/shared/config.js.
const GRAB = { width: 1280, height: 720, quality: 0.7 };
const BLACK_LUMA = 4;                 // a mean brightness under 4 of 255 is a black frame
const GRAB_P90_BAR_MS = 100;
const KEYFRAME_SHARE_BAR = 0.99;
const SEEK_TO_S = 2;
const SEEK_TOLERANCE_S = 0.1;
const RES = {
  720: { width: 1280, height: 720, bitrate: 4e6 },
  1080: { width: 1920, height: 1080, bitrate: 8e6 },
};
// In the order auto tries them. Once it starts, Chromium names an h264
// recording video/x-matroska;codecs=avc1, whichever of these was asked for.
const MIME_FOR = {
  h264: ['video/webm;codecs=h264', 'video/webm;codecs=avc1', 'video/x-matroska;codecs=avc1'],
  vp9: ['video/webm;codecs=vp9'],
  vp8: ['video/webm;codecs=vp8'],
};
const PROBE_TYPES = [
  'video/webm;codecs=h264', 'video/webm;codecs=avc1', 'video/webm;codecs=vp9', 'video/webm;codecs=vp8',
  'video/x-matroska;codecs=avc1', 'video/webm;codecs=av1', 'video/mp4;codecs=avc1',
];
// isTypeSupported says nothing about hardware. Whether WebCodecs can open a
// hardware encoder for a codec at all says a little more, and the GPU's Video
// Encode engine (the Cost table) says what actually ran. MediaCapabilities
// encodingInfo would have been the third, but this Chromium no longer accepts
// its 'record' type.
const ENCODER_PROBES = [
  { name: 'h264 720p', codec: 'avc1.42E01F', width: 1280, height: 720, bitrate: 4e6 },
  { name: 'h264 1080p', codec: 'avc1.42E028', width: 1920, height: 1080, bitrate: 8e6 },
  { name: 'vp9 720p', codec: 'vp09.00.31.08', width: 1280, height: 720, bitrate: 4e6 },
  { name: 'vp9 1080p', codec: 'vp09.00.40.08', width: 1920, height: 1080, bitrate: 8e6 },
  { name: 'vp8 720p', codec: 'vp8', width: 1280, height: 720, bitrate: 4e6 },
  { name: 'vp8 1080p', codec: 'vp8', width: 1920, height: 1080, bitrate: 8e6 },
  { name: 'av1 720p', codec: 'av01.0.05M.08', width: 1280, height: 720, bitrate: 4e6 },
  { name: 'av1 1080p', codec: 'av01.0.08M.08', width: 1920, height: 1080, bitrate: 8e6 },
];

// ---------------------------------------------------------------------------
// Arguments and paths
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const o = { seconds: 60, res: 720, codec: 'auto', fps: 60, out: null, keep: false, motion: false, problems: [] };
  for (let i = 0; i < argv.length; i++) {
    const raw = String(argv[i]);
    if (!raw.startsWith('--')) continue;
    const eq = raw.indexOf('=');
    const name = eq > 0 ? raw.slice(0, eq) : raw;
    const value = () => (eq > 0 ? raw.slice(eq + 1) : argv[++i]);
    if (name === '--seconds') o.seconds = Number(value());
    else if (name === '--res') o.res = Number(String(value()).split('p')[0]);
    else if (name === '--codec') o.codec = String(value()).toLowerCase();
    else if (name === '--fps') o.fps = Number(value());
    else if (name === '--out') o.out = value() || null;
    else if (name === '--keep') o.keep = true;
    else if (name === '--motion') o.motion = true;
    // Anything else is a Chromium or Electron switch, and theirs to read.
  }
  if (!Number.isInteger(o.seconds) || o.seconds < 12 || o.seconds > 900) {
    o.problems.push('--seconds must be a whole number from 12 to 900 (a clip needs 10 s, and the whole recording is read into memory to be parsed)');
  }
  if (!RES[o.res]) o.problems.push('--res must be 720 or 1080');
  if (!Number.isInteger(o.fps) || o.fps < 15 || o.fps > 120) o.problems.push('--fps must be a whole number from 15 to 120');
  if (o.codec !== 'auto' && !Object.prototype.hasOwnProperty.call(MIME_FOR, o.codec)) o.problems.push('--codec must be auto, h264, vp9 or vp8');
  return o;
}

// Under Electron, process.argv holds the binary and the script before the
// arguments, and possibly switches of Chromium's own, so take what follows
// this file.
function scriptArgs() {
  const me = path.resolve(__filename).toLowerCase();
  const at = process.argv.findIndex((a) => {
    try { return path.resolve(String(a)).toLowerCase() === me; } catch { return false; }
  });
  return process.argv.slice(at >= 0 ? at + 1 : 2);
}

function stamp() {
  return new Date().toISOString().split(':').join('-').split('.').join('-');
}

// The system temp folder, so a capture of the desktop never lands in the repo.
function defaultOutDir() {
  return path.join(os.tmpdir(), 'occlara-spike', 'spike-' + stamp());
}

// What a run writes besides its report: the capture of the desktop, and the
// page it loads.
const CAPTURED_FILES = ['video.webm', 'clip.webm', 'clip-indexed.webm', 'grab-first.jpg', 'grab-middle.jpg', 'grab-last.jpg'];
const PAGE_FILES = ['spike-page.html', 'spike-page.js'];
const MARKER = 'RUNNING.json';

function alive(pid) {
  try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; }
}

// A run that was killed (the terminal closed, the process ended from Task
// Manager) never reaches its cleanup, so its capture of the desktop would stay
// on disk. Each run marks its folder while it runs, and the next run sweeps
// every marked spike- folder beside its own whose process is gone, keeping the
// files only of a run that had asked for --keep.
function sweepAbandoned(outDir) {
  const swept = [];
  const parent = path.dirname(outDir);
  let names = [];
  try { names = fs.readdirSync(parent); } catch { return swept; }
  for (const name of names) {
    const dir = path.join(parent, name);
    if (!name.startsWith('spike-') || dir === outDir) continue;
    let mark = null;
    try { mark = JSON.parse(fs.readFileSync(path.join(dir, MARKER), 'utf8')); } catch { continue; }
    if (mark && alive(mark.pid)) continue;
    const doomed = PAGE_FILES.concat(mark && mark.keep ? [] : CAPTURED_FILES);
    for (const f of doomed.concat([MARKER])) {
      const p = path.join(dir, f);
      if (!fs.existsSync(p)) continue;
      try { fs.rmSync(p, { force: true }); if (f !== MARKER) swept.push(name + '/' + f); } catch { /* the next run tries again */ }
    }
  }
  return swept;
}

// ---------------------------------------------------------------------------
// Small numbers
// ---------------------------------------------------------------------------

function r1(x) { return typeof x === 'number' && Number.isFinite(x) ? Math.round(x * 10) / 10 : (x === undefined ? null : x); }
function r3(x) { return typeof x === 'number' && Number.isFinite(x) ? Math.round(x * 1000) / 1000 : (x === undefined ? null : x); }
function pct(x) { return typeof x === 'number' && Number.isFinite(x) ? r1(100 * x) + '%' : 'n/a'; }
function hex2(n) { return (n & 0xFF).toString(16).toUpperCase().padStart(2, '0'); }
function hex4(n) { return typeof n === 'number' ? '0x' + n.toString(16).toUpperCase().padStart(4, '0') : null; }

function stat(xs, digits) {
  const v = xs.filter((x) => typeof x === 'number' && Number.isFinite(x));
  if (!v.length) return { n: 0 };
  const round = digits === 2 ? (x) => Math.round(x * 100) / 100 : r1;
  const s = v.slice().sort((a, b) => a - b);
  const q = (p) => s[Math.min(s.length - 1, Math.max(0, Math.ceil(p * s.length) - 1))];
  return { n: s.length, mean: round(s.reduce((a, b) => a + b, 0) / s.length), p50: round(q(0.5)), p90: round(q(0.9)), p95: round(q(0.95)), min: round(s[0]), max: round(s[s.length - 1]) };
}

function diffs(xs) {
  const out = [];
  for (let i = 1; i < xs.length; i++) out.push(xs[i] - xs[i - 1]);
  return out;
}

// Theil-Sen: the median of the slopes between every pair of points. The first
// chunk carries the first cluster AND the start of the next one, and that one
// point swung a least squares line by more than a second a minute on a 20 s
// run; it hardly moves this. Pairs are thinned so 900 s stays near 100k.
function slope(xs, ys) {
  const n = xs.length;
  if (n < 3) return null;
  const step = Math.max(1, Math.floor(n / 400));
  const s = [];
  for (let i = 0; i < n; i += step) {
    for (let j = i + step; j < n; j += step) if (xs[j] !== xs[i]) s.push((ys[j] - ys[i]) / (xs[j] - xs[i]));
  }
  if (!s.length) return null;
  s.sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

// Shared by this main process and serialized into the page and the worker.
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));
}

// ---------------------------------------------------------------------------
// EBML: a reader for the whole file
//
// Chromium's MediaRecorder writes WebM (Matroska for h264) the way a live
// stream is written: a Segment of unknown size, Clusters of unknown size, no
// Cues, no Duration. An unknown-size Cluster ends where an element that cannot
// be its child begins, which is how this walks them.
// ---------------------------------------------------------------------------

const ID = {
  EBML: 0x1A45DFA3, DocType: 0x4282, DocTypeVersion: 0x4287,
  Segment: 0x18538067, SeekHead: 0x114D9B74, Seek: 0x4DBB, SeekID: 0x53AB, SeekPosition: 0x53AC,
  Info: 0x1549A966, TimecodeScale: 0x2AD7B1, Duration: 0x4489, MuxingApp: 0x4D80, WritingApp: 0x5741,
  Tracks: 0x1654AE6B, TrackEntry: 0xAE, TrackNumber: 0xD7, TrackType: 0x83, CodecID: 0x86, CodecPrivate: 0x63A2,
  DefaultDuration: 0x23E383, Video: 0xE0, PixelWidth: 0xB0, PixelHeight: 0xBA,
  Cues: 0x1C53BB6B, CuePoint: 0xBB, CueTime: 0xB3, CueTrackPositions: 0xB7, CueTrack: 0xF7, CueClusterPosition: 0xF1,
  Cluster: 0x1F43B675, Timecode: 0xE7, SilentTracks: 0x5854, Position: 0xA7, PrevSize: 0xAB,
  SimpleBlock: 0xA3, BlockGroup: 0xA0, Block: 0xA1, ReferenceBlock: 0xFB, EncryptedBlock: 0xAF,
  Void: 0xEC, CRC32: 0xBF, Tags: 0x1254C367, Chapters: 0x1043A770, Attachments: 0x1941A469,
};
const ID_NAME = {};
for (const [name, id] of Object.entries(ID)) ID_NAME[id] = name;
const CLUSTER_CHILDREN = new Set([ID.Timecode, ID.SilentTracks, ID.Position, ID.PrevSize, ID.SimpleBlock, ID.BlockGroup, ID.EncryptedBlock, ID.Void, ID.CRC32]);

// A variable length integer. An ID keeps its length marker bits (that is how
// IDs are written down); a size drops them, and all value bits set means the
// size is unknown.
function readVint(buf, pos, keepMarker) {
  if (pos >= buf.length) return null;
  const first = buf[pos];
  let len = 1;
  let mask = 0x80;
  while (len <= 8 && (first & mask) === 0) { len += 1; mask >>= 1; }
  if (len > 8) return { bad: true };
  if (pos + len > buf.length) return null;
  let value = keepMarker ? first : (first & (mask - 1));
  let allOnes = (first & (mask - 1)) === mask - 1;
  for (let i = 1; i < len; i++) {
    const b = buf[pos + i];
    value = value * 256 + b;
    if (b !== 0xFF) allOnes = false;
  }
  return { value, len, unknown: !keepMarker && allOnes };
}

function readHeader(buf, pos) {
  const id = readVint(buf, pos, true);
  if (!id || id.bad || id.len > 4) return null;
  const size = readVint(buf, pos + id.len, false);
  if (!size || size.bad) return null;
  const dataStart = pos + id.len + size.len;
  return { id: id.value, start: pos, dataStart, size: size.unknown ? null : size.value, end: size.unknown ? null : dataStart + size.value };
}

function kids(buf, start, end) {
  const out = [];
  let p = start;
  while (p < end) {
    const h = readHeader(buf, p);
    if (!h || h.end === null || h.end > end) break;
    out.push(h);
    p = h.end;
  }
  return out;
}

function uint(buf, s, e) {
  let v = 0;
  for (let i = s; i < e; i++) v = v * 256 + buf[i];
  return v;
}

function float(buf, s, e) {
  if (e - s === 4) return buf.readFloatBE(s);
  if (e - s === 8) return buf.readDoubleBE(s);
  return null;
}

function str(buf, s, e) {
  let end = s;
  while (end < e && buf[end] !== 0) end += 1;
  return buf.toString('latin1', s, end);
}

function parseWebm(buf) {
  const w = {
    bytes: buf.length, docType: null, docTypeVersion: null, segment: null, infoEl: null, tracksEl: null,
    info: { timecodeScale: 1000000, durationTicks: null, muxingApp: null, writingApp: null }, tickMs: 1,
    tracks: [], videoTrack: null, cues: { present: false, points: 0 }, seekHead: false, level1: {},
    clusters: [], blocks: [], firstClusterOffset: null, notes: [],
  };
  const head = readHeader(buf, 0);
  if (!head || head.id !== ID.EBML || head.end === null) { w.notes.push('no EBML header at byte 0'); return w; }
  for (const ch of kids(buf, head.dataStart, head.end)) {
    if (ch.id === ID.DocType) w.docType = str(buf, ch.dataStart, ch.end);
    else if (ch.id === ID.DocTypeVersion) w.docTypeVersion = uint(buf, ch.dataStart, ch.end);
  }
  const seg = readHeader(buf, head.end);
  if (!seg || seg.id !== ID.Segment) { w.notes.push('no Segment after the EBML header'); return w; }
  w.segment = { start: seg.start, dataStart: seg.dataStart, sizeKnown: seg.size !== null, size: seg.size };
  if (seg.end !== null && seg.end > buf.length) w.notes.push('the Segment declares more bytes than the file has');
  const end = seg.end === null ? buf.length : Math.min(seg.end, buf.length);
  let p = seg.dataStart;
  while (p < end) {
    const h = readHeader(buf, p);
    if (!h) { w.notes.push('unreadable element at byte ' + p + ' of ' + buf.length); break; }
    const name = ID_NAME[h.id] || '0x' + h.id.toString(16).toUpperCase();
    w.level1[name] = (w.level1[name] || 0) + 1;
    if (h.id === ID.Cluster) { p = parseCluster(buf, h, end, w); continue; }
    if (h.end === null) { w.notes.push(name + ' of unknown size at byte ' + p + ', the walk stopped there'); break; }
    if (h.end > end) { w.notes.push(name + ' at byte ' + p + ' runs past the end of the file'); break; }
    if (h.id === ID.Info) readInfo(buf, h, w);
    else if (h.id === ID.Tracks) readTracks(buf, h, w);
    else if (h.id === ID.Cues) {
      w.cues.present = true;
      w.cues.points = kids(buf, h.dataStart, h.end).filter((k) => k.id === ID.CuePoint).length;
    } else if (h.id === ID.SeekHead) w.seekHead = true;
    p = h.end;
  }
  return w;
}

function readInfo(buf, h, w) {
  w.infoEl = h;
  for (const ch of kids(buf, h.dataStart, h.end)) {
    if (ch.id === ID.TimecodeScale) w.info.timecodeScale = uint(buf, ch.dataStart, ch.end);
    else if (ch.id === ID.Duration) w.info.durationTicks = float(buf, ch.dataStart, ch.end);
    else if (ch.id === ID.MuxingApp) w.info.muxingApp = str(buf, ch.dataStart, ch.end);
    else if (ch.id === ID.WritingApp) w.info.writingApp = str(buf, ch.dataStart, ch.end);
  }
  w.tickMs = w.info.timecodeScale / 1e6;
}

function readTracks(buf, h, w) {
  w.tracksEl = h;
  for (const te of kids(buf, h.dataStart, h.end)) {
    if (te.id !== ID.TrackEntry) continue;
    const t = { number: null, type: null, codecId: null, codecPrivate: null, pixelWidth: null, pixelHeight: null, defaultDurationNs: null };
    for (const ch of kids(buf, te.dataStart, te.end)) {
      if (ch.id === ID.TrackNumber) t.number = uint(buf, ch.dataStart, ch.end);
      else if (ch.id === ID.TrackType) t.type = uint(buf, ch.dataStart, ch.end);
      else if (ch.id === ID.CodecID) t.codecId = str(buf, ch.dataStart, ch.end);
      else if (ch.id === ID.CodecPrivate) t.codecPrivate = Buffer.from(buf.subarray(ch.dataStart, ch.end));
      else if (ch.id === ID.DefaultDuration) t.defaultDurationNs = uint(buf, ch.dataStart, ch.end);
      else if (ch.id === ID.Video) {
        for (const v of kids(buf, ch.dataStart, ch.end)) {
          if (v.id === ID.PixelWidth) t.pixelWidth = uint(buf, v.dataStart, v.end);
          else if (v.id === ID.PixelHeight) t.pixelHeight = uint(buf, v.dataStart, v.end);
        }
      }
    }
    w.tracks.push(t);
    if (t.type === 1 && w.videoTrack === null) w.videoTrack = t.number;
  }
}

// Returns where the next level 1 element starts.
function parseCluster(buf, h, limit, w) {
  const c = {
    index: w.clusters.length, start: h.start, sizeKnown: h.size !== null, timecode: null, children: [],
    videoBlocks: 0, firstBlockKey: null, lastBlockTime: null, firstBlockIndex: w.blocks.length, truncated: false,
  };
  if (w.firstClusterOffset === null) w.firstClusterOffset = h.start;
  const stop = h.end === null ? limit : Math.min(h.end, limit);
  let p = h.dataStart;
  while (p < stop) {
    const k = readHeader(buf, p);
    if (!k) { c.truncated = true; break; }
    if (h.end === null && !CLUSTER_CHILDREN.has(k.id)) break;
    if (k.end === null || k.end > stop) { c.truncated = true; break; }
    c.children.push({ id: k.id, start: k.start, end: k.end });
    if (k.id === ID.Timecode) c.timecode = uint(buf, k.dataStart, k.end);
    else if (k.id === ID.SimpleBlock) addBlock(buf, k.dataStart, k.end, k, c, w, null);
    else if (k.id === ID.BlockGroup) {
      // A Block in a group is a keyframe unless the group references another.
      const parts = kids(buf, k.dataStart, k.end);
      const block = parts.find((x) => x.id === ID.Block);
      if (block) addBlock(buf, block.dataStart, block.end, k, c, w, !parts.some((x) => x.id === ID.ReferenceBlock));
    }
    p = k.end;
  }
  if (c.truncated) w.notes.push('cluster ' + c.index + ' at byte ' + h.start + ' is cut short');
  for (let i = c.firstBlockIndex; i < w.blocks.length; i++) {
    const b = w.blocks[i];
    b.time = (c.timecode || 0) + b.rel;
    if (b.track === w.videoTrack) c.lastBlockTime = b.time;
  }
  w.clusters.push(c);
  return h.end === null ? p : Math.max(p, Math.min(h.end, limit));
}

// SimpleBlock and Block share a layout: the track number, a 16 bit timecode
// relative to the cluster's, and a flags byte whose 0x80 bit marks a keyframe
// (in a SimpleBlock only).
function addBlock(buf, s, e, el, c, w, keyOverride) {
  const tn = readVint(buf, s, false);
  if (!tn || tn.bad || s + tn.len + 3 > e) return;
  const flags = buf[s + tn.len + 2];
  const b = {
    cluster: c.index, track: tn.value, rel: buf.readInt16BE(s + tn.len), time: null,
    key: keyOverride === null ? (flags & 0x80) !== 0 : keyOverride, lacing: (flags >> 1) & 3,
    frameStart: s + tn.len + 3, frameEnd: e, elStart: el.start, elEnd: el.end,
  };
  w.blocks.push(b);
  if (b.track === w.videoTrack) {
    c.videoBlocks += 1;
    if (c.firstBlockKey === null) c.firstBlockKey = b.key;
  }
}

function describeWebm(w) {
  return {
    bytes: w.bytes,
    docType: w.docType,
    docTypeVersion: w.docTypeVersion,
    segment: w.segment ? { sizeKnown: w.segment.sizeKnown, size: w.segment.size } : null,
    level1: w.level1,
    seekHead: w.seekHead,
    info: {
      timecodeScale: w.info.timecodeScale,
      durationPresent: w.info.durationTicks !== null,
      durationMs: w.info.durationTicks === null ? null : r1(w.info.durationTicks * w.tickMs),
      muxingApp: w.info.muxingApp,
      writingApp: w.info.writingApp,
    },
    tracks: w.tracks.map((t) => ({
      number: t.number, type: t.type, codecId: t.codecId,
      codecPrivateBytes: t.codecPrivate ? t.codecPrivate.length : 0,
      codecPrivateIsAvcC: !!(t.codecPrivate && t.codecPrivate[0] === 1),
      pixelWidth: t.pixelWidth, pixelHeight: t.pixelHeight, defaultDurationNs: t.defaultDurationNs,
    })),
    cues: w.cues,
    clusters: w.clusters.length,
    notes: w.notes,
  };
}

// The cluster layout, and its timeline against the wall clock.
function layoutOf(w, chunks) {
  const t = w.tickMs;
  const video = w.blocks.filter((b) => b.track === w.videoTrack);
  const clusters = w.clusters.filter((c) => c.videoBlocks > 0);
  if (!video.length || !clusters.length) return null;
  const times = video.map((b) => b.time * t);
  const gaps = diffs(times);
  const frameMs = stat(gaps).p50 || 1000 / FPS;
  const spanMs = times[times.length - 1] - times[0];
  const durations = clusters.map((c, i) => {
    const next = clusters[i + 1];
    return next ? (next.timecode - c.timecode) * t : (c.lastBlockTime - c.timecode) * t + frameMs;
  });
  const keyTimes = video.filter((b) => b.key).map((b) => b.time * t);
  const L = {
    clusters: clusters.length,
    emptyClusters: w.clusters.length - clusters.length,
    clustersOfKnownSize: w.clusters.filter((c) => c.sizeKnown).length,
    keyframeFirst: clusters.filter((c) => c.firstBlockKey).length,
    keyframeShare: clusters.filter((c) => c.firstBlockKey).length / clusters.length,
    clusterMs: stat(durations),
    videoBlocks: video.length,
    laced: video.filter((b) => b.lacing).length,
    keyframes: keyTimes.length,
    spanMs: r1(spanMs),
    framesPerSecond: video.length > 1 && spanMs > 0 ? r1((video.length - 1) / (spanMs / 1000)) : null,
    frameIntervalMs: stat(gaps),
    gapsOver50ms: gaps.filter((g) => g > 50).length,
    keyframeIntervalMs: stat(diffs(keyTimes)),
  };
  if (chunks.length) {
    // Each cluster's timecode against the wall clock of the chunk its first
    // byte arrived in, the first chunk's wall time being zero. Chunks are cut
    // on a timer and clusters begin at keyframes, so a cluster's first byte
    // often rides at the tail of the chunk before the one its time suggests:
    // the offset sits within a timeslice of 0, and only a walk is drift.
    const wall0 = chunks[0].wall;
    let k = 0;
    const perCluster = clusters.map((c) => {
      while (k + 1 < chunks.length && chunks[k + 1].offset <= c.start) k += 1;
      const wallMs = chunks[k].wall - wall0;
      return { cluster: c.index, timecodeMs: r1(c.timecode * t), chunk: k, wallMs, driftMs: r1(wallMs - c.timecode * t) };
    });
    const driftSlope = slope(perCluster.map((x) => x.timecodeMs), perCluster.map((x) => x.driftMs));
    L.clusterDrift = Object.assign(stat(perCluster.map((x) => x.driftMs)), { slopeMsPerMinute: driftSlope === null ? null : r1(driftSlope * 60000), perCluster });
    // A finer clock: the newest complete block in each chunk against that
    // chunk's wall time, relative to the first chunk. A timeline running
    // slow or fast against the wall clock shows as a slope here.
    const pairs = [];
    let bi = -1;
    for (const ch of chunks) {
      const endByte = ch.offset + ch.size;
      while (bi + 1 < video.length && video[bi + 1].elEnd <= endByte) bi += 1;
      if (bi >= 0) pairs.push({ wallMs: ch.wall - wall0, blockMs: video[bi].time * t });
    }
    if (pairs.length) {
      const lag0 = pairs[0].wallMs - pairs[0].blockMs;
      const rel = pairs.map((x) => x.wallMs - x.blockMs - lag0);
      const relSlope = slope(pairs.map((x) => x.wallMs), rel);
      L.newestBlockDrift = Object.assign(stat(rel), { atEndMs: r1(rel[rel.length - 1]), slopeMsPerMinute: relSlope === null ? null : r1(relSlope * 60000), firstChunkLagMs: r1(lag0) });
    }
    L.wallSpanMs = chunks[chunks.length - 1].wall - wall0;
  }
  return L;
}

// ---------------------------------------------------------------------------
// EBML: a writer, and the clip cut two ways
// ---------------------------------------------------------------------------

function encodeUint(n, len) {
  let size = len || 1;
  if (!len) while (size < 8 && n >= Math.pow(2, 8 * size)) size += 1;
  const out = Buffer.alloc(size);
  let v = n;
  for (let i = size - 1; i >= 0; i--) { out[i] = v % 256; v = Math.floor(v / 256); }
  return out;
}

// All value bits set is reserved for "unknown", hence the minus one.
function encodeSize(n, len) {
  let size = len || 1;
  if (!len) while (size < 8 && n >= Math.pow(2, 7 * size) - 1) size += 1;
  const out = encodeUint(n, size);
  out[0] |= 0x80 >> (size - 1);
  return out;
}

const encodeId = (id) => encodeUint(id);      // an ID keeps its marker bits, so its bytes are the number's
const UNKNOWN_SIZE = Buffer.from([0x01, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF]);

function el(id, payload) {
  return Buffer.concat([encodeId(id), encodeSize(payload.length), payload]);
}

function floatEl(id, x) {
  const b = Buffer.alloc(8);
  b.writeDoubleBE(x);
  return el(id, b);
}

// A cluster with a new timecode. Position and PrevSize describe the old file
// and would be wrong in a new one, so they go.
function rebuildCluster(buf, c, timecode, knownSize) {
  const parts = [el(ID.Timecode, encodeUint(timecode))];
  for (const ch of c.children) {
    if (ch.id === ID.Timecode || ch.id === ID.Position || ch.id === ID.PrevSize) continue;
    parts.push(buf.subarray(ch.start, ch.end));
  }
  const body = Buffer.concat(parts);
  return Buffer.concat([encodeId(ID.Cluster), knownSize ? encodeSize(body.length) : UNKNOWN_SIZE, body]);
}

// The clusters a clip of [startMs, endMs] needs: from the last cluster that
// starts on a keyframe at or before the start (a decoder must begin on one),
// through the last cluster that starts by the end.
function planClip(w, startMs, endMs) {
  const t = w.tickMs;
  const usable = w.clusters.filter((c) => c.timecode !== null && c.videoBlocks > 0);
  let first = null;
  for (const c of usable) if (c.timecode * t <= startMs && c.firstBlockKey) first = c;
  if (!first) first = usable.find((c) => c.firstBlockKey) || null;
  if (!first) return null;
  const clusters = usable.filter((c) => c.index >= first.index && c.timecode * t <= endMs);
  return { clusters, base: first.timecode, earlyByMs: startMs - first.timecode * t };
}

// clip.webm: every byte before the first Cluster, verbatim, then the clusters
// with their timecodes rebased so the clip starts at 0. Nothing else is
// written, which is the question: does a cut this plain play and seek?
function writeClipAsCut(buf, w, plan) {
  const clusters = plan.clusters.map((c) => rebuildCluster(buf, c, c.timecode - plan.base, c.sizeKnown));
  if (!w.segment.sizeKnown) return Buffer.concat([buf.subarray(0, w.firstClusterOffset)].concat(clusters));
  // A Segment that declared its size would now declare the wrong one.
  const body = Buffer.concat([buf.subarray(w.segment.dataStart, w.firstClusterOffset)].concat(clusters));
  return Buffer.concat([buf.subarray(0, w.segment.start), encodeId(ID.Segment), encodeSize(body.length, 8), body]);
}

// clip-indexed.webm: the same clusters with known sizes, under a Segment of
// known size that holds a SeekHead, Info with a Duration, the source's Tracks
// verbatim, and Cues pointing at each keyframe cluster. Every number in the
// SeekHead and Cues is written at a fixed width, so their sizes are known
// before the positions they hold.
function writeClipIndexed(buf, w, plan, frameMs) {
  const t = w.tickMs;
  const clusters = plan.clusters.map((c) => ({ c, bytes: rebuildCluster(buf, c, c.timecode - plan.base, true) }));
  const last = plan.clusters[plan.clusters.length - 1];
  const durationTicks = (last.lastBlockTime - plan.base) + frameMs / t;
  const infoParts = [];
  let hasScale = false;
  if (w.infoEl) {
    for (const ch of kids(buf, w.infoEl.dataStart, w.infoEl.end)) {
      if (ch.id === ID.Duration) continue;
      if (ch.id === ID.TimecodeScale) hasScale = true;
      infoParts.push(buf.subarray(ch.start, ch.end));
    }
  }
  if (!hasScale) infoParts.unshift(el(ID.TimecodeScale, encodeUint(1000000)));
  infoParts.push(floatEl(ID.Duration, durationTicks));
  const info = el(ID.Info, Buffer.concat(infoParts));
  const tracks = buf.subarray(w.tracksEl.start, w.tracksEl.end);
  const keyed = clusters.filter((x) => x.c.firstBlockKey);
  const cues = (positions) => el(ID.Cues, Buffer.concat(keyed.map((x, i) => el(ID.CuePoint, Buffer.concat([
    el(ID.CueTime, encodeUint(x.c.timecode - plan.base, 8)),
    el(ID.CueTrackPositions, Buffer.concat([
      el(ID.CueTrack, encodeUint(w.videoTrack, 1)),
      el(ID.CueClusterPosition, encodeUint(positions[i], 8)),
    ])),
  ])))));
  const seekHead = (pos) => el(ID.SeekHead, Buffer.concat([[ID.Info, pos.info], [ID.Tracks, pos.tracks], [ID.Cues, pos.cues]].map(([id, at]) =>
    el(ID.Seek, Buffer.concat([el(ID.SeekID, encodeId(id)), el(ID.SeekPosition, encodeUint(at, 8))])))));
  // Positions count from the first byte of the Segment's data.
  const seekLen = seekHead({ info: 0, tracks: 0, cues: 0 }).length;
  const cuesLen = cues(keyed.map(() => 0)).length;
  const pos = { info: seekLen, tracks: seekLen + info.length, cues: seekLen + info.length + tracks.length };
  let at = pos.cues + cuesLen;
  const where = new Map();
  for (const x of clusters) { where.set(x.c.index, at); at += x.bytes.length; }
  const body = Buffer.concat([seekHead(pos), info, tracks, cues(keyed.map((x) => where.get(x.c.index)))].concat(clusters.map((x) => x.bytes)));
  return {
    bytes: Buffer.concat([buf.subarray(0, w.segment.start), encodeId(ID.Segment), encodeSize(body.length, 8), body]),
    durationMs: durationTicks * t,
  };
}

function describeClip(w) {
  const video = w.blocks.filter((b) => b.track === w.videoTrack);
  return {
    bytes: w.bytes,
    segmentSizeKnown: w.segment ? w.segment.sizeKnown : null,
    durationMs: w.info.durationTicks === null ? null : r1(w.info.durationTicks * w.tickMs),
    cuePoints: w.cues.present ? w.cues.points : 0,
    seekHead: w.seekHead,
    clusters: w.clusters.length,
    clustersOfKnownSize: w.clusters.filter((c) => c.sizeKnown).length,
    firstTimecodeMs: w.clusters.length ? r1(w.clusters[0].timecode * w.tickMs) : null,
    keyframeFirst: w.clusters.filter((c) => c.firstBlockKey).length,
    videoBlocks: video.length,
    spanMs: video.length ? r1((video[video.length - 1].time - video[0].time) * w.tickMs) : null,
    notes: w.notes,
  };
}

// ---------------------------------------------------------------------------
// H.264 inside the blocks: how a decoder must be configured to read them
// ---------------------------------------------------------------------------

function parseAvcC(b) {
  if (!b || b.length < 7 || b[0] !== 1) return null;
  return { profile: b[1], compat: b[2], level: b[3], lengthSize: (b[4] & 3) + 1, spsCount: b[5] & 0x1F, codec: 'avc1.' + hex2(b[1]) + hex2(b[2]) + hex2(b[3]) };
}

// Annex B frames start with a start code; AVC frames with a NAL length.
function nalFormat(f) {
  return f.length > 4 && f[0] === 0 && f[1] === 0 && (f[2] === 1 || (f[2] === 0 && f[3] === 1)) ? 'annexb' : 'avc';
}

function nalTypes(f, format, lengthSize) {
  const types = [];
  if (format === 'annexb') {
    for (let i = 0; i + 3 < f.length; i++) {
      if (f[i] === 0 && f[i + 1] === 0 && f[i + 2] === 1) { types.push(f[i + 3] & 0x1F); i += 3; }
    }
    return types;
  }
  let p = 0;
  while (p + lengthSize < f.length) {
    let n = 0;
    for (let k = 0; k < lengthSize; k++) n = n * 256 + f[p + k];
    p += lengthSize;
    if (n < 1 || p + n > f.length) break;
    types.push(f[p] & 0x1F);
    p += n;
  }
  return types;
}

// The codec string from the stream's own SPS: profile, constraints, level.
function spsCodec(f, format, lengthSize) {
  if (format === 'annexb') {
    for (let i = 0; i + 6 < f.length && i < 4096; i++) {
      if (f[i] === 0 && f[i + 1] === 0 && f[i + 2] === 1) {
        if ((f[i + 3] & 0x1F) === 7) return 'avc1.' + hex2(f[i + 4]) + hex2(f[i + 5]) + hex2(f[i + 6]);
        i += 2;
      }
    }
    return null;
  }
  let p = 0;
  while (p + lengthSize < f.length) {
    let n = 0;
    for (let k = 0; k < lengthSize; k++) n = n * 256 + f[p + k];
    p += lengthSize;
    if (n < 4 || p + n > f.length) return null;
    if ((f[p] & 0x1F) === 7) return 'avc1.' + hex2(f[p + 1]) + hex2(f[p + 2]) + hex2(f[p + 3]);
    p += n;
  }
  return null;
}

// Whether a clip that starts at any keyframe can be decoded from the blocks
// alone: an Annex B stream needs its SPS and PPS repeated at each keyframe.
function h264Facts(buf, w) {
  const track = w.tracks.find((t) => t.number === w.videoTrack);
  if (!track || track.codecId !== 'V_MPEG4/ISO/AVC') return null;
  const avcc = parseAvcC(track.codecPrivate);
  const keys = w.blocks.filter((b) => b.track === w.videoTrack && b.key);
  if (!keys.length) return { avcC: avcc, keyframes: 0 };
  const first = buf.subarray(keys[0].frameStart, keys[0].frameEnd);
  const format = nalFormat(first);
  const lengthSize = avcc ? avcc.lengthSize : 4;
  let withSpsPps = 0;
  for (const k of keys) {
    const types = nalTypes(buf.subarray(k.frameStart, Math.min(k.frameEnd, k.frameStart + 4096)), format, lengthSize);
    if (types.includes(7) && types.includes(8)) withSpsPps += 1;
  }
  return {
    format,
    avcC: avcc,
    codecFromStream: spsCodec(first, format, lengthSize),
    keyframes: keys.length,
    keyframesWithSpsPps: withSpsPps,
    firstKeyframeNalTypes: nalTypes(first.subarray(0, Math.min(first.length, 4096)), format, lengthSize),
  };
}

// WebCodecs reads length-prefixed NAL units when it is given an avcC
// description, and Annex B when it is not.
function decoderConfig(w, buf) {
  const track = w.tracks.find((t) => t.number === w.videoTrack);
  if (!track) return { error: 'no video track' };
  const size = { codedWidth: track.pixelWidth || 1280, codedHeight: track.pixelHeight || 720 };
  if (track.codecId === 'V_VP8') return { config: Object.assign({ codec: 'vp8' }, size), format: 'vp8', description: null };
  if (track.codecId === 'V_VP9') return { config: Object.assign({ codec: 'vp09.00.41.08' }, size), format: 'vp9', description: null };
  if (track.codecId === 'V_AV1') return { config: Object.assign({ codec: 'av01.0.08M.08' }, size), format: 'av1', description: null };
  if (track.codecId === 'V_MPEG4/ISO/AVC') {
    const key = w.blocks.find((b) => b.track === w.videoTrack && b.key);
    const frame = key ? buf.subarray(key.frameStart, key.frameEnd) : Buffer.alloc(0);
    const format = nalFormat(frame);
    const avcc = parseAvcC(track.codecPrivate);
    const codec = (avcc && avcc.codec) || spsCodec(frame, format, 4) || 'avc1.42E01F';
    return { config: Object.assign({ codec }, size), format, description: format === 'avc' && avcc ? track.codecPrivate : null };
  }
  return { error: 'no WebCodecs mapping for ' + track.codecId };
}

// ---------------------------------------------------------------------------
// Cost: this app's CPU and memory, the machine's CPU, the GPU's engines
// ---------------------------------------------------------------------------

function cpuTimes() {
  let idle = 0;
  let total = 0;
  for (const c of os.cpus()) {
    const t = c.times;
    idle += t.idle;
    total += t.user + t.nice + t.sys + t.idle + t.irq;
  }
  return { idle, total };
}

// percentCPUUsage is per process, since the previous call, and in Electron 41
// it is ALREADY DIVIDED BY THE CORE COUNT: one core kept busy for two seconds
// read 6.24 on this 16 thread machine, and Windows' own counters matched the
// reading times 16 to within 2 points on six runs. So it is multiplied by the
// core count here, and 100 is then one whole core. skip() names processes that
// are not the recorder's (the --motion window's page).
const CORES = os.cpus().length || 1;
function startSampler(app, skip) {
  app.getAppMetrics();
  let prev = cpuTimes();
  const samples = [];
  const timer = setInterval(() => {
    const now = cpuTimes();
    const dt = now.total - prev.total;
    const systemCpu = dt > 0 ? 100 * (1 - (now.idle - prev.idle) / dt) : null;
    prev = now;
    let cpu = 0;
    let ws = 0;
    let priv = 0;
    const byType = {};
    const skipped = skip();
    for (const m of app.getAppMetrics()) {
      if (skipped.includes(m.pid)) continue;
      const c = ((m.cpu && m.cpu.percentCPUUsage) || 0) * CORES;
      cpu += c;
      byType[m.type] = (byType[m.type] || 0) + c;
      ws += (m.memory && m.memory.workingSetSize) || 0;
      priv += (m.memory && m.memory.privateBytes) || 0;
    }
    samples.push({ at: Date.now(), cpu, byType, systemCpu, workingSetMB: ws / 1024, privateMB: priv / 1024 });
  }, 1000);
  return { stop() { clearInterval(timer); return samples; } };
}

function cpuSummary(samples, cores) {
  const cpu = samples.map((s) => s.cpu);
  const types = {};
  for (const s of samples) for (const k of Object.keys(s.byType)) (types[k] = types[k] || []).push(s.byType[k]);
  const byType = {};
  for (const k of Object.keys(types)) byType[k] = stat(types[k]);
  return {
    seconds: samples.length,
    appCpuPercentOfOneCore: stat(cpu),
    appCpuPercentOfMachine: stat(cpu.map((c) => c / cores), 2),
    byProcessType: byType,
    systemCpuPercent: stat(samples.map((s) => s.systemCpu)),
    workingSetMB: stat(samples.map((s) => s.workingSetMB)),
    privateMB: stat(samples.map((s) => s.privateMB)),
    perSecond: samples.map((s) => ({ cpu: r1(s.cpu), system: r1(s.systemCpu), workingSetMB: r1(s.workingSetMB) })),
  };
}

// The GPU engines Task Manager draws come from these counters, one instance
// per process per engine, named with the pid. typeperf ships with Windows; a
// failure here only loses this table.
function startGpuCounters(samples) {
  const BS = String.fromCharCode(92);
  const counters = ['VideoEncode', '3D'].map((e) => BS + 'GPU Engine(*engtype_' + e + ')' + BS + 'Utilization Percentage');
  let text = '';
  let error = null;
  let proc = null;
  try {
    proc = spawn('typeperf', counters.concat(['-si', '1', '-sc', String(samples)]), { windowsHide: true });
    proc.stdout.on('data', (d) => { text += d; });
    proc.on('error', (e) => { error = e.message; });
  } catch (e) { error = e.message; }
  const exited = new Promise((resolve) => { if (!proc) resolve(); else proc.on('close', resolve); });
  const kill = () => { if (proc && proc.exitCode === null) { try { proc.kill(); } catch { /* already gone */ } } };
  return {
    kill,
    async stop(pids) {
      await Promise.race([exited, sleep(5000)]);
      kill();
      return parseTypeperf(text, pids, error);
    },
  };
}

function parseTypeperf(text, pids, error) {
  const rows = text.split('\n').map((l) => l.trim()).filter((l) => l.startsWith('"'));
  if (rows.length < 2) return { error: error || 'typeperf printed no samples' };
  const cells = (l) => l.slice(1, -1).split('","');
  const head = cells(rows[0]).slice(1).map((name) => {
    const p = name.indexOf('(pid_');
    const e = name.indexOf('engtype_');
    return { pid: p >= 0 ? parseInt(name.slice(p + 5), 10) : null, engine: e >= 0 ? name.slice(e + 8, name.indexOf(')', e)) : '?' };
  });
  const per = {};
  const others = {};          // another process on an engine: pid and engine, then its samples
  let samples = 0;
  for (const l of rows.slice(1)) {
    const sums = {};
    let any = false;
    cells(l).slice(1).forEach((v, i) => {
      const x = parseFloat(v);
      if (!Number.isFinite(x) || !head[i]) return;
      any = true;
      const s = sums[head[i].engine] || (sums[head[i].engine] = { ours: 0, all: 0 });
      s.all += x;
      if (pids.includes(head[i].pid)) s.ours += x;
      else {
        const key = head[i].pid + ' ' + head[i].engine;
        (others[key] = others[key] || []).push(x);
      }
    });
    if (!any) continue;
    samples += 1;
    for (const [eng, s] of Object.entries(sums)) {
      const p = per[eng] || (per[eng] = { ours: [], all: [] });
      p.ours.push(s.ours);
      p.all.push(s.all);
    }
  }
  const engines = {};
  for (const [eng, p] of Object.entries(per)) engines[eng] = { ours: stat(p.ours), all: stat(p.all) };
  // Whoever else holds an engine, NVIDIA's Instant Replay on the encoder for
  // one, is part of the game's FPS baseline too, so it is named.
  const busyOthers = Object.entries(others)
    .map(([key, xs]) => ({ pid: parseInt(key, 10), engine: key.split(' ')[1], mean: r1(xs.reduce((x, y) => x + y, 0) / xs.length) }))
    .filter((o) => o.mean >= 1)
    .sort((x, y) => y.mean - x.mean)
    .slice(0, 6);
  return { samples, instancesForThisApp: head.filter((h) => pids.includes(h.pid)).length, engines, busyOthers };
}

// Image names for pids, from tasklist (it ships with Windows).
function processNames(pids) {
  const out = {};
  if (!pids.length) return out;
  try {
    const r = spawnSync('tasklist', ['/FO', 'CSV', '/NH'], { encoding: 'utf8', windowsHide: true, timeout: 15000 });
    for (const line of String(r.stdout || '').split('\n')) {
      const cells = line.trim().slice(1, -1).split('","');
      const pid = parseInt(cells[1], 10);
      if (pids.includes(pid)) out[pid] = cells[0];
    }
  } catch { /* the pids stand without names */ }
  return out;
}

// ---------------------------------------------------------------------------
// The page and the grab worker. These functions are serialized into
// spike-page.js and into the worker's source, so they may use only each
// other and the browser's globals.
// ---------------------------------------------------------------------------

// Mean brightness of RGBA pixels, Rec. 601 weights, 0 to 255.
function meanLuma(px) {
  let sum = 0;
  for (let i = 0; i < px.length; i += 4) sum += 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];
  return px.length ? sum / (px.length / 4) : 0;
}

function makeTools(cfg) {
  const canvas = new OffscreenCanvas(cfg.width, cfg.height);
  const small = new OffscreenCanvas(160, 90);
  return { canvas, ctx: canvas.getContext('2d'), small, sctx: small.getContext('2d', { willReadFrequently: true }) };
}

// One live read frame: stretched to 1280x720 with no aspect handling, as
// OcclaraCapture.cs does with new Bitmap(shot, w, h), then JPEG at 0.7, then
// a 160x90 copy for the black check.
async function encodeGrab(image, tools, cfg) {
  const t0 = performance.now();
  tools.ctx.drawImage(image, 0, 0, cfg.width, cfg.height);
  const t1 = performance.now();
  const blob = await tools.canvas.convertToBlob({ type: 'image/jpeg', quality: cfg.quality });
  const t2 = performance.now();
  tools.sctx.drawImage(tools.canvas, 0, 0, 160, 90);
  const lum = meanLuma(tools.sctx.getImageData(0, 0, 160, 90).data);
  return { blob, drawMs: t1 - t0, encodeMs: t2 - t1, blackCheckMs: performance.now() - t2, lum };
}

// Once a second, the newest frame the capturer delivered. Every frame is read
// and all but the newest closed at once: the capturer sends a frame only when
// the screen changed, so waiting for the next one at each tick would time a
// still screen rather than the grab, and a frame left open holds one of the
// capture's few buffers, which stalls the capture.
async function grabLoop(readable, cfg, control, emit) {
  const reader = readable.getReader();
  const tools = makeTools(cfg);
  const st = { latest: null, latestAt: 0, delivered: 0, first: null, ended: false, readError: null };
  const drain = (async () => {
    try {
      for (;;) {
        const r = await reader.read();
        if (r.done) break;
        st.delivered += 1;
        if (!st.first) st.first = { codedWidth: r.value.codedWidth, codedHeight: r.value.codedHeight, displayWidth: r.value.displayWidth, displayHeight: r.value.displayHeight, format: r.value.format };
        if (st.latest) st.latest.close();
        st.latest = r.value;
        st.latestAt = performance.now();
        if (control.stopped) break;
      }
    } catch (e) { st.readError = String((e && e.message) || e); }
    st.ended = true;
  })();
  const grabs = [];
  let lastBlob = null;
  const t0 = performance.now();
  for (let tick = 0; !control.stopped && !st.ended; tick++) {
    await sleep(t0 + tick * 1000 - performance.now());
    if (control.stopped) break;
    const g0 = performance.now();
    while (!st.latest && !control.stopped && !st.ended) await sleep(5);
    if (!st.latest) break;
    const frame = st.latest.clone();
    const g1 = performance.now();
    const ageMs = g1 - st.latestAt;
    let r;
    try { r = await encodeGrab(frame, tools, cfg); } finally { frame.close(); }
    const rec = { i: grabs.length, at: Date.now(), waitMs: g1 - g0, drawMs: r.drawMs, encodeMs: r.encodeMs, totalMs: g1 - g0 + r.drawMs + r.encodeMs, blackCheckMs: r.blackCheckMs, ageMs, bytes: r.blob.size, lum: r.lum };
    grabs.push(rec);
    if (cfg.keep) {
      lastBlob = r.blob;
      if (rec.i === 0) emit({ type: 'sample', name: 'first', jpeg: await r.blob.arrayBuffer() });
      else if (rec.i === cfg.middle) emit({ type: 'sample', name: 'middle', jpeg: await r.blob.arrayBuffer() });
    }
  }
  control.stopped = true;
  try { await reader.cancel(); } catch { /* the stream may already be closed */ }
  await drain;
  if (st.latest) { st.latest.close(); st.latest = null; }
  if (cfg.keep && lastBlob) emit({ type: 'sample', name: 'last', jpeg: await lastBlob.arrayBuffer() });
  return { grabs, delivered: st.delivered, deliveredForMs: performance.now() - t0, first: st.first, readError: st.readError };
}

// The fallback when there is no MediaStreamTrackProcessor: grabFrame waits
// for the next frame each time, which on a still screen is a long wait.
async function imageCaptureLoop(track, cfg, control, emit) {
  const capture = new ImageCapture(track);
  const tools = makeTools(cfg);
  const grabs = [];
  const errors = [];
  let lastBlob = null;
  const t0 = performance.now();
  for (let tick = 0; !control.stopped; tick++) {
    await sleep(t0 + tick * 1000 - performance.now());
    if (control.stopped) break;
    const g0 = performance.now();
    let bitmap;
    try { bitmap = await capture.grabFrame(); } catch (e) { errors.push(String((e && e.message) || e)); continue; }
    const g1 = performance.now();
    let r;
    try { r = await encodeGrab(bitmap, tools, cfg); } finally { bitmap.close(); }
    const rec = { i: grabs.length, at: Date.now(), waitMs: g1 - g0, drawMs: r.drawMs, encodeMs: r.encodeMs, totalMs: g1 - g0 + r.drawMs + r.encodeMs, blackCheckMs: r.blackCheckMs, ageMs: null, bytes: r.blob.size, lum: r.lum };
    grabs.push(rec);
    if (cfg.keep) {
      lastBlob = r.blob;
      if (rec.i === 0) emit({ type: 'sample', name: 'first', jpeg: await r.blob.arrayBuffer() });
      else if (rec.i === cfg.middle) emit({ type: 'sample', name: 'middle', jpeg: await r.blob.arrayBuffer() });
    }
  }
  if (cfg.keep && lastBlob) emit({ type: 'sample', name: 'last', jpeg: await lastBlob.arrayBuffer() });
  return { grabs, delivered: null, deliveredForMs: performance.now() - t0, first: null, readError: errors.length ? errors.length + ' failed grabs, first: ' + errors[0] : null };
}

function workerMain() {
  const control = { stopped: false };
  self.onmessage = async (e) => {
    const m = e.data;
    if (m.type === 'stop') { control.stopped = true; return; }
    if (m.type !== 'start') return;
    try {
      self.postMessage({ type: 'started' });
      const summary = await grabLoop(m.readable, m.cfg, control, (msg) => self.postMessage(msg, msg.jpeg ? [msg.jpeg] : []));
      self.postMessage({ type: 'done', summary });
    } catch (err) {
      self.postMessage({ type: 'failed', message: String((err && err.message) || err) });
    }
  };
}

function pageMain(CFG) {
  const { ipcRenderer } = require('electron');
  const fs = require('fs');
  const send = (type, payload) => ipcRenderer.send(CFG.channel, Object.assign({ type }, payload || {}));
  const errText = (e) => (e && e.name && e.message ? e.name + ': ' + e.message : String((e && e.message) || e));
  addEventListener('error', (e) => send('page-error', { message: String(e.message) + ' (' + e.filename + ':' + e.lineno + ')' }));
  addEventListener('unhandledrejection', (e) => send('page-error', { message: 'unhandled rejection: ' + errText(e.reason) }));

  const small = document.createElement('canvas');
  small.width = 320;
  small.height = 180;
  const smallCtx = small.getContext('2d', { willReadFrequently: true });
  const drawSmall = (source) => { smallCtx.drawImage(source, 0, 0, 320, 180); return smallCtx.getImageData(0, 0, 320, 180).data; };
  const finite = (x) => (Number.isFinite(x) ? x : String(x));
  const ranges = (tr) => { const out = []; for (let i = 0; i < tr.length; i++) out.push([finite(tr.start(i)), finite(tr.end(i))]); return out; };
  const pixels = {};          // clip label, then seconds: what the <video> drew, for WebCodecs to be compared with
  let session = null;

  function psnr(a, b) {
    let se = 0;
    let n = 0;
    for (let i = 0; i < a.length; i += 4) {
      for (let k = 0; k < 3; k++) { const d = a[i + k] - b[i + k]; se += d * d; n += 1; }
    }
    const mse = se / n;
    return mse === 0 ? 'identical' : Math.round(10 * Math.log10((255 * 255) / mse) * 10) / 10;
  }

  function trackStats(track) {
    try {
      const s = track.stats;
      return s ? { deliveredFrames: s.deliveredFrames, discardedFrames: s.discardedFrames, totalFrames: s.totalFrames } : null;
    } catch (e) { return { error: errText(e) }; }
  }

  async function probe() {
    const out = { visibilityState: document.visibilityState, isSecureContext };
    out.rafFires = await new Promise((resolve) => { requestAnimationFrame(() => resolve(true)); setTimeout(() => resolve(false), 1000); });
    out.api = {};
    for (const name of ['MediaRecorder', 'MediaStreamTrackProcessor', 'ImageCapture', 'VideoDecoder', 'VideoEncoder', 'OffscreenCanvas']) out.api[name] = typeof self[name] === 'function';
    out.isTypeSupported = {};
    for (const t of CFG.probeTypes) out.isTypeSupported[t] = MediaRecorder.isTypeSupported(t);
    const v = document.createElement('video');
    out.canPlayType = {};
    for (const t of ['video/webm; codecs="avc1.42E01E"', 'video/x-matroska; codecs="avc1.42E01E"', 'video/webm; codecs="vp9"', 'video/webm; codecs="vp8"']) out.canPlayType[t] = v.canPlayType(t) || 'no';
    out.webcodecsEncoder = {};
    for (const c of CFG.encoderProbes) {
      for (const pref of ['prefer-hardware', 'prefer-software']) {
        try {
          const s = await VideoEncoder.isConfigSupported({ codec: c.codec, width: c.width, height: c.height, bitrate: c.bitrate, framerate: 30, hardwareAcceleration: pref });
          out.webcodecsEncoder[c.name + ', ' + pref] = s.supported;
        } catch (e) { out.webcodecsEncoder[c.name + ', ' + pref] = errText(e); }
      }
    }
    return out;
  }

  // The plan's shape is a worker grabbing from a cloned track. In this
  // Chromium, MediaStreamTrackProcessor exists in the page only and a track
  // cannot be transferred, so the page makes the processor and hands the
  // worker its stream of VideoFrames; failing that, the page does the work;
  // failing that, ImageCapture.
  async function startGrabs(track, cfg) {
    const attempts = [];
    const onSample = (m) => send('sample', { name: m.name, jpeg: m.jpeg });
    if (typeof MediaStreamTrackProcessor === 'function') {
      const clone = track.clone();
      try {
        const proc = new MediaStreamTrackProcessor({ track: clone, maxBufferSize: 1 });
        const worker = new Worker(URL.createObjectURL(new Blob([CFG.workerSource], { type: 'text/javascript' })));
        let finish = null;
        let fail = null;
        const done = new Promise((resolve, reject) => { finish = resolve; fail = reject; });
        done.catch(() => {});
        const started = new Promise((resolve, reject) => {
          worker.onmessage = (e) => {
            const m = e.data;
            if (m.type === 'started') resolve();
            else if (m.type === 'sample') onSample(m);
            else if (m.type === 'done') finish(m.summary);
            else if (m.type === 'failed') { const err = new Error(m.message); reject(err); fail(err); }
          };
          worker.onerror = (e) => { const err = new Error(e.message || 'the worker failed to load'); reject(err); fail(err); };
          setTimeout(() => reject(new Error('the worker did not start within 3 s')), 3000);
        });
        worker.postMessage({ type: 'start', readable: proc.readable, cfg }, [proc.readable]);
        await started;
        return {
          method: 'MediaStreamTrackProcessor on a cloned track in the page, its VideoFrames transferred to a worker that draws and encodes them',
          attempts,
          stop: async () => {
            worker.postMessage({ type: 'stop' });
            const s = await done.catch((err) => ({ grabs: [], delivered: null, readError: 'the worker failed: ' + errText(err) }));
            worker.terminate();
            clone.stop();
            return s;
          },
        };
      } catch (e) {
        attempts.push('a worker: ' + errText(e));
        clone.stop();
      }
      const clone2 = track.clone();
      const control = { stopped: false };
      const running = grabLoop(new MediaStreamTrackProcessor({ track: clone2, maxBufferSize: 1 }).readable, cfg, control, onSample);
      return {
        method: 'MediaStreamTrackProcessor on a cloned track, drawn and encoded in the page',
        attempts,
        stop: async () => { control.stopped = true; const s = await running; clone2.stop(); return s; },
      };
    }
    attempts.push('no MediaStreamTrackProcessor in the page');
    const clone3 = track.clone();
    const control = { stopped: false };
    const running = imageCaptureLoop(clone3, cfg, control, onSample);
    return {
      method: 'ImageCapture.grabFrame on a cloned track, in the page',
      attempts,
      stop: async () => { control.stopped = true; const s = await running; clone3.stop(); return s; },
    };
  }

  async function start(msg) {
    const notes = [];
    let via = 'getUserMedia, chromeMediaSource desktop';
    let stream = null;
    const t0 = performance.now();
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { mandatory: { chromeMediaSource: 'desktop', chromeMediaSourceId: msg.sourceId, maxWidth: msg.width, maxHeight: msg.height, maxFrameRate: msg.fps } },
      });
    } catch (e) {
      notes.push('getUserMedia refused the desktop source: ' + errText(e) + '; tried getDisplayMedia');
      stream = await navigator.mediaDevices.getDisplayMedia({ audio: false, video: { width: { max: msg.width }, height: { max: msg.height }, frameRate: { max: msg.fps } } });
      via = 'getDisplayMedia, answered by setDisplayMediaRequestHandler';
    }
    const gumMs = performance.now() - t0;
    const track = stream.getVideoTracks()[0];
    track.addEventListener('ended', () => send('page-error', { message: 'the capture track ended by itself' }));

    // A getter tells whether this build reads the option at all; the keyframe
    // spacing in the file tells whether it is honoured.
    let keyframeOptionRead = false;
    const options = { mimeType: msg.mimeType, videoBitsPerSecond: msg.bitrate };
    Object.defineProperty(options, 'videoKeyFrameIntervalDuration', { enumerable: true, get() { keyframeOptionRead = true; return msg.keyframeMs; } });
    const recorder = new MediaRecorder(stream, options);
    let seq = 0;
    let queue = Promise.resolve();
    let recorderError = null;
    // In order, and stamped when the chunk was handed over, not when its
    // bytes were read out of the Blob.
    recorder.ondataavailable = (ev) => {
      const wall = Date.now();
      const n = seq++;
      const timecode = ev.timecode;
      queue = queue.then(async () => {
        const data = await ev.data.arrayBuffer();
        send('chunk', { seq: n, wall, timecode, size: data.byteLength, data });
      }).catch((e) => { recorderError = 'chunk ' + n + ': ' + errText(e); });
    };
    recorder.onerror = (ev) => { recorderError = errText(ev.error || ev); };
    const stopped = new Promise((resolve) => { recorder.onstop = () => resolve(); });
    const recStartWall = Date.now();
    recorder.start(msg.timesliceMs);
    const grabs = await startGrabs(track, msg.grab);
    session = { stream, track, recorder, stopped, drain: () => queue, recorderError: () => recorderError, grabs, statsStart: trackStats(track) };
    send('started', {
      via, gumMs, notes, recStartWall, settings: track.getSettings(), label: track.label, contentHint: track.contentHint,
      recorder: { mimeType: recorder.mimeType, state: recorder.state, videoBitsPerSecond: recorder.videoBitsPerSecond },
      keyframeOptionRead, grabMethod: grabs.method, grabAttempts: grabs.attempts,
    });
  }

  async function stop() {
    const s = session;
    if (!s) throw new Error('stop before start');
    const statsEnd = trackStats(s.track);
    const results = await Promise.all([
      s.grabs.stop(),
      (async () => { if (s.recorder.state !== 'inactive') s.recorder.stop(); await s.stopped; await s.drain(); })(),
    ]);
    const mimeAfter = s.recorder.mimeType;
    s.stream.getTracks().forEach((t) => t.stop());
    session = null;
    send('stopped', { grab: results[0], statsStart: s.statsStart, statsEnd, recorderError: s.recorderError(), mimeAfter, recStopWall: Date.now() });
  }

  function waitMedia(v, name, ms) {
    return new Promise((resolve) => {
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
  }

  async function seekTo(v, t, ms) {
    const wait = waitMedia(v, 'seeked', ms);
    try { v.currentTime = t; } catch (e) { return { fired: false, why: errText(e), currentTime: finite(v.currentTime) }; }
    const r = await wait;
    return { fired: r.fired, ms: r.ms, why: r.why, currentTime: finite(v.currentTime) };
  }

  // A blob URL rather than a file URL: a file URL is another origin to this
  // page, and the canvas it drew on could not then be read back.
  async function testClip(msg) {
    const res = { label: msg.label };
    let url = null;
    const v = document.createElement('video');
    v.muted = true;
    v.preload = 'auto';
    document.body.appendChild(v);
    try {
      const bytes = fs.readFileSync(msg.path);
      res.bytes = bytes.length;
      url = URL.createObjectURL(new Blob([bytes], { type: msg.mime }));
      const meta = waitMedia(v, 'loadedmetadata', 8000);
      v.src = url;
      res.metadata = await meta;
      res.duration = finite(v.duration);
      res.size = [v.videoWidth, v.videoHeight];
      res.seekable = ranges(v.seekable);
      if (res.metadata.fired) {
        res.seek = await seekTo(v, msg.seekTo, 5000);
        res.seekOk = !!(res.seek.fired && typeof res.seek.currentTime === 'number' && Math.abs(res.seek.currentTime - msg.seekTo) <= msg.tolerance);
        res.frames = [];
        pixels[msg.label] = {};
        for (const t of msg.times) {
          const s = await seekTo(v, t, 5000);
          const frame = { t, fired: s.fired, currentTime: s.currentTime, readyState: v.readyState, lum: null };
          if (s.fired && v.readyState >= 2) {
            const px = drawSmall(v);
            pixels[msg.label][t] = px;
            frame.lum = Math.round(meanLuma(px) * 10) / 10;
          }
          res.frames.push(frame);
        }
        await seekTo(v, 3, 5000);
        const from = v.currentTime;
        try {
          await v.play();
          await sleep(1000);
          v.pause();
          res.play = { from: finite(from), to: finite(v.currentTime), advanced: v.currentTime - from > 0.3 };
        } catch (e) { res.play = { error: errText(e) }; }
        res.durationAfter = finite(v.duration);
        res.seekableAfter = ranges(v.seekable);
      }
    } catch (e) { res.error = errText(e); }
    res.mediaError = v.error ? { code: v.error.code, message: v.error.message } : null;
    v.pause();
    v.removeAttribute('src');
    v.load();
    v.remove();
    if (url) URL.revokeObjectURL(url);
    send('clip-result', res);
  }

  // Every block of the clip through WebCodecs, in order, from its first
  // keyframe; the frames at the asked times are kept and set beside what the
  // <video> drew there.
  async function testDecode(msg) {
    const res = { codec: msg.config.codec, format: msg.format, description: !!msg.description, blocks: msg.blocks.length };
    try {
      if (typeof VideoDecoder !== 'function') throw new Error('no VideoDecoder in this page');
      const bytes = fs.readFileSync(msg.path);
      const config = Object.assign({}, msg.config);
      if (msg.description) config.description = new Uint8Array(msg.description);
      res.supported = (await VideoDecoder.isConfigSupported(config)).supported;
      res.hardwareDecoderAvailable = (await VideoDecoder.isConfigSupported(Object.assign({}, config, { hardwareAcceleration: 'prefer-hardware' }))).supported;
      if (res.supported) {
        const targets = msg.times.map((t) => ({ t, us: Math.round(t * 1e6), best: -1, px: null }));
        let frames = 0;
        let firstOutMs = null;
        let lastTs = null;
        let decodeError = null;
        const t0 = performance.now();
        const dec = new VideoDecoder({
          output: (frame) => {
            try {
              frames += 1;
              if (firstOutMs === null) firstOutMs = performance.now() - t0;
              lastTs = frame.timestamp;
              for (const tg of targets) if (frame.timestamp <= tg.us + 500 && frame.timestamp > tg.best) { tg.best = frame.timestamp; tg.px = drawSmall(frame); }
            } finally { frame.close(); }
          },
          error: (e) => { decodeError = errText(e); },
        });
        dec.configure(config);
        for (const b of msg.blocks) dec.decode(new EncodedVideoChunk({ type: b.key ? 'key' : 'delta', timestamp: Math.round(b.ms * 1000), data: bytes.subarray(b.start, b.end) }));
        await dec.flush();
        const ms = performance.now() - t0;
        if (dec.state !== 'closed') dec.close();
        Object.assign(res, { frames, ms: Math.round(ms), fps: Math.round(frames / (ms / 1000)), firstOutMs: Math.round(firstOutMs), lastFrameS: lastTs === null ? null : lastTs / 1e6, decodeError });
        res.targets = targets.map((tg) => {
          const drawn = pixels[msg.compareWith] && pixels[msg.compareWith][tg.t];
          return { t: tg.t, frameAtS: tg.best >= 0 ? tg.best / 1e6 : null, lum: tg.px ? Math.round(meanLuma(tg.px) * 10) / 10 : null, psnrVsVideoDb: tg.px && drawn ? psnr(tg.px, drawn) : null };
        });
      }
    } catch (e) { res.error = errText(e); }
    send('decode-result', res);
  }

  const handlers = { start, stop, clip: testClip, decode: testDecode };
  ipcRenderer.on(CFG.channel, (_e, msg) => {
    const h = handlers[msg && msg.type];
    if (!h) return;
    Promise.resolve().then(() => h(msg)).catch((err) => send('fatal', { where: msg.type, message: errText(err) }));
  });
  probe().then((p) => send('ready', p), (err) => send('fatal', { where: 'probe', message: errText(err) }));
}

function writePage(files, cfg) {
  const workerSource = [sleep, meanLuma, makeTools, encodeGrab, grabLoop].map(String).join('\n\n') + '\n\n(' + String(workerMain) + ')();\n';
  const js = '// Written by scripts/spike-recorder.js for one run, and deleted at its end.\n'
    + [sleep, meanLuma, makeTools, encodeGrab, grabLoop, imageCaptureLoop, pageMain].map(String).join('\n\n')
    + '\n\npageMain(' + JSON.stringify(Object.assign({}, cfg, { workerSource })) + ');\n';
  fs.writeFileSync(files.pageJs, js);
  fs.writeFileSync(files.pageHtml, '<!doctype html><html><head><meta charset="utf-8"><title>spike</title></head><body><script src="spike-page.js"></script></body></html>\n');
}

// A moving bar, a changing colour and a counter, redrawn 60 times a second,
// so a desk test always has a changed screen for the capturer to deliver.
const MOTION_HTML = '<!doctype html><meta charset="utf-8"><body style="margin:0;overflow:hidden;background:#000">'
  + '<canvas id="c" width="320" height="180"></canvas><script>'
  + 'const g = document.getElementById("c").getContext("2d"); let n = 0;'
  + 'setInterval(() => { n += 1; g.fillStyle = "hsl(" + (n * 3 % 360) + ",60%,40%)"; g.fillRect(0, 0, 320, 180);'
  + ' g.fillStyle = "#fff"; g.fillRect((n * 6) % 320, 0, 24, 180); g.font = "20px sans-serif"; g.fillText("spike motion " + n, 12, 32); }, 16);'
  + '</script></body>';

function openMotionWindow(BrowserWindow, display) {
  const W = 320;
  const H = 180;
  const area = display.workArea;
  const w = new BrowserWindow({
    x: area.x + area.width - W - 16, y: area.y + area.height - H - 16, width: W, height: H,
    frame: false, resizable: false, movable: false, focusable: false, skipTaskbar: true, alwaysOnTop: true, show: false,
    backgroundColor: '#000000', webPreferences: { backgroundThrottling: false },
  });
  w.setAlwaysOnTop(true, 'screen-saver');
  w.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(MOTION_HTML));
  w.once('ready-to-show', () => { if (!w.isDestroyed()) w.showInactive(); });
  return w;
}

// ---------------------------------------------------------------------------
// The main process
// ---------------------------------------------------------------------------

function machineInfo() {
  const cpus = os.cpus();
  return {
    cpu: cpus.length ? cpus[0].model.trim() : null,
    logicalCores: cpus.length,
    ramGB: r1(os.totalmem() / 1073741824),
    os: (typeof os.version === 'function' ? os.version() + ', ' : '') + os.release(),
    electron: process.versions.electron,
    chromium: process.versions.chrome,
    node: process.versions.node,
  };
}

// Read after the capture, while the GPU process is up: read at launch, before
// any window exists, the same calls report everything in software.
async function gpuInfo(app) {
  const out = { devices: [], renderer: null, featureStatus: null, gpuProcess: null };
  try {
    const b = await app.getGPUInfo('basic');
    out.devices = (b.gpuDevice || []).map((d) => ({ name: d.deviceString || null, vendorId: hex4(d.vendorId), deviceId: hex4(d.deviceId), driverVersion: d.driverVersion || null, active: !!d.active }));
    out.inProcessGpu = b.auxAttributes ? b.auxAttributes.inProcessGpu : null;
  } catch (e) { out.error = e.message; }
  try { out.featureStatus = app.getGPUFeatureStatus(); } catch (e) { out.featureError = e.message; }
  try {
    const c = await Promise.race([app.getGPUInfo('complete'), sleep(8000).then(() => null)]);
    if (c && c.auxAttributes) out.renderer = c.auxAttributes.glRenderer || null;
  } catch { /* the basic answer stands */ }
  out.gpuProcess = app.getAppMetrics().some((m) => m.type === 'GPU');
  return out;
}

async function loadWithRetry(win, file) {
  let last = null;
  for (let i = 0; i < 6; i++) {
    try { await win.loadFile(file); return; } catch (e) { last = e; await sleep(400); }
  }
  throw last;
}

function chooseMime(codec, supported) {
  const order = codec === 'auto' ? ['h264', 'vp9', 'vp8'] : [codec];
  for (const c of order) for (const m of MIME_FOR[c]) if (supported[m]) return { codec: c, mime: m };
  return null;
}

function grabSummary(g, started) {
  const list = (g && g.grabs) || [];
  return {
    method: started ? started.grabMethod : null,
    attemptsBeforeIt: started ? started.grabAttempts : [],
    count: list.length,
    totalMs: stat(list.map((x) => x.totalMs)),
    waitMs: stat(list.map((x) => x.waitMs)),
    drawMs: stat(list.map((x) => x.drawMs)),
    encodeMs: stat(list.map((x) => x.encodeMs)),
    blackCheckMs: stat(list.map((x) => x.blackCheckMs)),
    frameAgeMs: stat(list.map((x) => x.ageMs)),
    jpegKB: stat(list.map((x) => x.bytes / 1024)),
    luma: stat(list.map((x) => x.lum)),
    nearBlack: list.filter((x) => x.lum < BLACK_LUMA).length,
    deliveredFrames: g ? g.delivered : null,
    deliveredPerSecond: g && typeof g.delivered === 'number' && g.deliveredForMs ? r1(g.delivered / (g.deliveredForMs / 1000)) : null,
    firstFrame: g ? g.first : null,
    readError: g ? g.readError : null,
    each: list.map((x) => ({ at: x.at, totalMs: r1(x.totalMs), lum: r1(x.lum), kb: r1(x.bytes / 1024) })),
  };
}

function trackDelta(a, b) {
  if (!a || !b || a.error || b.error) return a || b || null;
  return { delivered: b.deliveredFrames - a.deliveredFrames, discarded: b.discardedFrames - a.discardedFrames, total: b.totalFrames - a.totalFrames };
}

function electronMain() {
  const { app, BrowserWindow, desktopCapturer, screen, ipcMain, session } = electron;
  const opts = parseArgs(scriptArgs());
  if (opts.problems.length) {
    console.error(opts.problems.join('\n'));
    app.exit(2);
    return;
  }
  const outDir = path.resolve(opts.out || process.env.OCCLARA_SPIKE_OUT || defaultOutDir());
  const files = {
    video: path.join(outDir, 'video.webm'),
    clip: path.join(outDir, 'clip.webm'),
    indexed: path.join(outDir, 'clip-indexed.webm'),
    pageHtml: path.join(outDir, 'spike-page.html'),
    pageJs: path.join(outDir, 'spike-page.js'),
  };
  const written = new Set();
  const R = {
    spike: 'Occlara 8.3 recorder spike (plan section 8.3, item 1)',
    startedAt: new Date().toISOString(),
    args: { seconds: opts.seconds, res: opts.res, codec: opts.codec, fps: opts.fps, keep: opts.keep, motion: opts.motion, out: outDir },
    machine: null, display: null, gpu: null, page: null, systemMemory: null,
    capture: {}, cost: {}, recording: null, webm: null, clip: {},
    bars: [], problems: [], console: [], files: { samples: [], left: [] },
  };

  process.env.ELECTRON_DISABLE_SECURITY_WARNINGS = 'true';
  app.setPath('userData', path.join(os.tmpdir(), 'occlara-spike-profile'));
  app.on('window-all-closed', () => { /* the run decides when to quit */ });

  let win = null;
  let motionWin = null;
  let videoFd = null;
  let videoBytes = 0;
  let watchdog = null;
  let finishing = false;
  const chunks = [];
  const gpuRuns = new Set();
  const waiters = new Map();
  const early = new Map();
  let pageFailed = null;
  let rejectFatal = () => {};
  const fatal = new Promise((_resolve, reject) => { rejectFatal = reject; });
  fatal.catch(() => {});

  const toPage = (type, payload) => win.webContents.send(CHANNEL, Object.assign({ type }, payload || {}));

  function waitFor(type, ms) {
    if (pageFailed) return Promise.reject(pageFailed);
    if (early.has(type)) { const m = early.get(type); early.delete(type); return Promise.resolve(m); }
    const answer = new Promise((resolve, reject) => {
      const timer = setTimeout(() => { waiters.delete(type); reject(new Error('the page did not send ' + type + ' within ' + ms / 1000 + ' s')); }, ms);
      waiters.set(type, { resolve: (m) => { clearTimeout(timer); resolve(m); }, reject: (e) => { clearTimeout(timer); reject(e); } });
    });
    answer.catch(() => {});
    return Promise.race([answer, fatal]);
  }

  function onChunk(m) {
    if (videoFd === null) { R.problems.push('chunk ' + m.seq + ' arrived after video.webm was closed'); return; }
    const buf = Buffer.from(m.data);
    fs.writeSync(videoFd, buf);
    chunks.push({ seq: m.seq, wall: m.wall, timecode: m.timecode, size: buf.length, offset: videoBytes, recvAt: Date.now() });
    videoBytes += buf.length;
  }

  function onSample(m) {
    if (!opts.keep) return;             // never written without --keep
    const file = path.join(outDir, 'grab-' + m.name + '.jpg');
    fs.writeFileSync(file, Buffer.from(m.jpeg));
    written.add(file);
    R.files.samples.push(path.basename(file));
  }

  ipcMain.on(CHANNEL, (_e, msg) => {
    if (!msg || !msg.type) return;
    if (msg.type === 'chunk') { onChunk(msg); return; }
    if (msg.type === 'sample') { onSample(msg); return; }
    if (msg.type === 'page-error') { R.problems.push('page: ' + msg.message); return; }
    if (msg.type === 'fatal') {
      pageFailed = new Error('the page failed in ' + msg.where + ': ' + msg.message);
      for (const w of waiters.values()) w.reject(pageFailed);
      waiters.clear();
      rejectFatal(pageFailed);
      return;
    }
    const w = waiters.get(msg.type);
    if (w) { waiters.delete(msg.type); w.resolve(msg); } else early.set(msg.type, msg);
  });

  // The --motion window is not part of what is measured: its page process is
  // left out of every figure. Its drawing still lands in the shared GPU
  // process, which cannot be split, and the report says so.
  const notMeasured = () => {
    if (!motionWin || motionWin.isDestroyed()) return [];
    try { return [motionWin.webContents.getOSProcessId()]; } catch { return []; }
  };

  function startPhase(seconds) {
    const sampler = startSampler(app, notMeasured);
    const gpu = startGpuCounters(Math.max(1, seconds - 2));
    gpuRuns.add(gpu);
    return {
      async stop() {
        const samples = sampler.stop();
        const skipped = notMeasured();
        const pids = app.getAppMetrics().map((m) => m.pid).filter((pid) => !skipped.includes(pid));
        const gpuEngines = await gpu.stop(pids);
        gpuRuns.delete(gpu);
        return { cpu: cpuSummary(samples, os.cpus().length), gpuEngines };
      },
    };
  }

  async function run() {
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(path.join(outDir, MARKER), JSON.stringify({ pid: process.pid, keep: opts.keep, startedAt: R.startedAt }));
    const swept = sweepAbandoned(outDir);
    if (swept.length) R.problems.push('swept ' + swept.length + ' files an earlier run left when it was killed: ' + swept.join(', '));
    const limitS = BASELINE_S + opts.seconds + 180;
    watchdog = setTimeout(() => fail(new Error('the run took longer than ' + limitS + ' s and was stopped')), limitS * 1000);
    R.machine = machineInfo();
    const display = screen.getPrimaryDisplay();
    R.display = {
      id: display.id, bounds: display.bounds, scaleFactor: display.scaleFactor, refreshHz: display.displayFrequency || null,
      physical: { width: Math.round(display.size.width * display.scaleFactor), height: Math.round(display.size.height * display.scaleFactor) },
      displays: screen.getAllDisplays().length,
    };

    // 1. The primary display's source.
    const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 0, height: 0 } });
    const source = sources.find((s) => String(s.display_id) === String(display.id)) || sources[0];
    if (!source) throw new Error('desktopCapturer found no screen to capture');
    R.capture.source = { id: source.id, name: source.name, displayId: source.display_id, matchedPrimary: String(source.display_id) === String(display.id), screens: sources.length };
    // The fallback, should this build refuse the legacy getUserMedia path:
    // getDisplayMedia, answered with the same source and no picker.
    session.defaultSession.setDisplayMediaRequestHandler((_request, callback) => callback({ video: source }));

    writePage(files, { channel: CHANNEL, probeTypes: PROBE_TYPES, encoderProbes: ENCODER_PROBES });
    written.add(files.pageHtml);
    written.add(files.pageJs);
    win = new BrowserWindow({
      show: false, width: 640, height: 360, skipTaskbar: true, focusable: false,
      webPreferences: { nodeIntegration: true, contextIsolation: false, backgroundThrottling: false },
    });
    win.webContents.on('render-process-gone', (_e, d) => fail(new Error('the page process ended: ' + (d && d.reason))));
    win.webContents.on('console-message', (e, level, message) => {
      const text = e && typeof e.message === 'string' ? e.message : message;
      const lvl = e && e.level !== undefined ? e.level : level;
      if ((lvl === 'warning' || lvl === 'error' || lvl === 2 || lvl === 3) && R.console.length < 40) R.console.push(String(lvl) + ': ' + String(text).slice(0, 300));
    });
    await loadWithRetry(win, files.pageHtml);
    R.page = await waitFor('ready', 20000);
    const pick = chooseMime(opts.codec, R.page.isTypeSupported || {});
    if (!pick) throw new Error('MediaRecorder supports no type for --codec ' + opts.codec);
    R.capture.codec = pick.codec;
    R.capture.mimeRequested = pick.mime;

    // 2. The baseline: the app idle, its hidden page loaded.
    const mem0 = process.getSystemMemoryInfo();
    R.systemMemory = { totalMB: Math.round(mem0.total / 1024), freeMBBefore: Math.round(mem0.free / 1024) };
    const baseline = startPhase(BASELINE_S);
    await Promise.race([sleep(BASELINE_S * 1000), fatal]);
    R.cost.baseline = await baseline.stop();

    // 3 to 6. The capture: recorder, live grabs, cost.
    if (opts.motion) motionWin = openMotionWindow(BrowserWindow, display);
    videoFd = fs.openSync(files.video, 'w');
    written.add(files.video);
    const res = RES[opts.res];
    toPage('start', {
      sourceId: source.id, width: res.width, height: res.height, fps: opts.fps, mimeType: pick.mime, bitrate: res.bitrate,
      keyframeMs: KEYFRAME_MS, timesliceMs: TIMESLICE_MS,
      grab: { width: GRAB.width, height: GRAB.height, quality: GRAB.quality, keep: opts.keep, middle: Math.floor(opts.seconds / 2) },
    });
    const started = await waitFor('started', 20000);
    R.capture.stream = { via: started.via, getUserMediaMs: r1(started.gumMs), settings: started.settings, label: started.label, contentHint: started.contentHint, notes: started.notes };
    R.capture.recorder = Object.assign({}, started.recorder);
    const during = startPhase(opts.seconds);
    await Promise.race([sleep(opts.seconds * 1000), fatal]);
    toPage('stop');
    const stopped = await waitFor('stopped', 30000);
    R.cost.capture = await during.stop();
    fs.closeSync(videoFd);
    videoFd = null;
    const motionPids = notMeasured();
    R.cost.processes = app.getAppMetrics().map((m) => ({ pid: m.pid, type: m.type, name: m.name || null, motionWindow: motionPids.includes(m.pid) }));
    if (motionWin) { motionWin.destroy(); motionWin = null; }
    R.systemMemory.freeMBAfter = Math.round(process.getSystemMemoryInfo().free / 1024);
    const otherPids = [];
    for (const p of [R.cost.baseline, R.cost.capture]) {
      for (const o of (p && p.gpuEngines && p.gpuEngines.busyOthers) || []) if (!otherPids.includes(o.pid)) otherPids.push(o.pid);
    }
    R.cost.otherProcessNames = processNames(otherPids);
    R.gpu = await gpuInfo(app);
    R.capture.recorder.mimeTypeAfterStop = stopped.mimeAfter;
    R.capture.recorder.error = stopped.recorderError;
    R.capture.grabs = grabSummary(stopped.grab, started);
    R.capture.trackStats = { during: trackDelta(stopped.statsStart, stopped.statsEnd), atStart: stopped.statsStart, atEnd: stopped.statsEnd };
    R.recording = {
      bytes: videoBytes,
      chunks: chunks.length,
      chunkKB: stat(chunks.map((c) => c.size / 1024)),
      chunkIntervalMs: stat(diffs(chunks.map((c) => c.wall))),
      deliveryToMainMs: stat(chunks.map((c) => c.recvAt - c.wall)),
      firstChunkAfterStartMs: chunks.length ? chunks[0].wall - started.recStartWall : null,
      recordedForS: r1((stopped.recStopWall - started.recStartWall) / 1000),
      averageMbps: r1((videoBytes * 8) / 1e6 / Math.max(0.001, (stopped.recStopWall - started.recStartWall) / 1000)),
      each: chunks.map((c) => ({ seq: c.seq, wall: c.wall, kb: r1(c.size / 1024), offset: c.offset, timecode: r1(c.timecode) })),
    };

    // 7. The whole file, read as a player would read it.
    const buf = fs.readFileSync(files.video);
    const webm = parseWebm(buf);
    R.webm = describeWebm(webm);
    R.webm.layout = layoutOf(webm, chunks);
    R.webm.h264 = h264Facts(buf, webm);
    const ki = R.webm.layout && R.webm.layout.keyframeIntervalMs;
    R.capture.keyframeOption = {
      readByThisBuild: !!started.keyframeOptionRead,
      keyframeIntervalP50Ms: ki && ki.n ? ki.p50 : null,
      honoured: ki && ki.n ? Math.abs(ki.p50 - KEYFRAME_MS) <= 150 : null,
    };
    if (!R.webm.layout) throw new Error('video.webm holds no video blocks, so there is nothing to cut');

    // 8. The clip.
    await clipTests(buf, webm);
    clearTimeout(watchdog);
    finish(0);
  }

  async function clipTests(buf, webm) {
    const layout = R.webm.layout;
    const t = webm.tickMs;
    const spanS = layout.spanMs / 1000;
    const atS = spanS >= 32 ? 30 : spanS / 2;
    const wanted = { aroundS: r1(atS), fromS: r1(Math.max(0, atS - 8)), toS: r1(atS + 2) };
    const video = webm.blocks.filter((b) => b.track === webm.videoTrack);
    const zeroMs = video[0].time * t;
    const plan = planClip(webm, zeroMs + wanted.fromS * 1000, zeroMs + wanted.toS * 1000);
    if (!plan) throw new Error('no cluster starts on a keyframe, so no clip can start on one');
    const frameMs = layout.frameIntervalMs.p50 || 1000 / FPS;
    const asCut = writeClipAsCut(buf, webm, plan);
    fs.writeFileSync(files.clip, asCut);
    written.add(files.clip);
    const indexed = writeClipIndexed(buf, webm, plan, frameMs);
    fs.writeFileSync(files.indexed, indexed.bytes);
    written.add(files.indexed);
    const asCutW = parseWebm(asCut);
    const indexedW = parseWebm(indexed.bytes);
    R.clip = {
      wanted,
      cut: {
        fromS: r3((plan.base * t - zeroMs) / 1000),
        startsEarlyByS: r3(plan.earlyByMs / 1000),
        clusters: plan.clusters.length,
        clusterIndexes: [plan.clusters[0].index, plan.clusters[plan.clusters.length - 1].index],
      },
      asCut: { file: 'clip.webm', structure: describeClip(asCutW) },
      indexed: { file: 'clip-indexed.webm', structure: describeClip(indexedW) },
    };
    const clipS = indexed.durationMs / 1000;
    const times = [1, 5, 9].map((s) => r3(Math.min(s, Math.max(0, clipS - 0.3))));
    const mime = String(R.capture.recorder.mimeTypeAfterStop || R.capture.mimeRequested).split(';')[0];
    toPage('clip', { label: 'as-cut', path: files.clip, mime, seekTo: SEEK_TO_S, tolerance: SEEK_TOLERANCE_S, times });
    R.clip.asCut.play = await waitFor('clip-result', 45000);
    toPage('clip', { label: 'indexed', path: files.indexed, mime, seekTo: SEEK_TO_S, tolerance: SEEK_TOLERANCE_S, times });
    R.clip.indexed.play = await waitFor('clip-result', 45000);

    const dc = decoderConfig(indexedW, indexed.bytes);
    if (dc.error) { R.clip.webcodecs = { error: dc.error }; return; }
    const blocks = indexedW.blocks.filter((b) => b.track === indexedW.videoTrack).map((b) => ({ start: b.frameStart, end: b.frameEnd, ms: b.time * indexedW.tickMs, key: b.key }));
    toPage('decode', { path: files.indexed, config: dc.config, description: dc.description, format: dc.format, blocks, times, compareWith: R.clip.indexed.play.seekOk ? 'indexed' : 'as-cut' });
    R.clip.webcodecs = await waitFor('decode-result', 60000);
  }

  function finish(code) {
    if (finishing) return;
    finishing = true;
    clearTimeout(watchdog);
    for (const g of gpuRuns) g.kill();
    if (videoFd !== null) { try { fs.closeSync(videoFd); } catch { /* already closed */ } videoFd = null; }
    for (const w of [motionWin, win]) if (w && !w.isDestroyed()) w.destroy();
    // Before the report, so it can say what is left: the capture of the
    // desktop goes, whatever happened above, unless --keep asked for it.
    for (const file of written) {
      const pageFile = file === files.pageHtml || file === files.pageJs;
      if (opts.keep && !pageFile) continue;
      try { fs.rmSync(file, { force: true }); } catch (e) { R.problems.push('could not delete ' + path.basename(file) + ': ' + e.message); }
    }
    try { fs.rmSync(path.join(outDir, MARKER), { force: true }); } catch { /* a later run sweeps it */ }
    let left = [];
    try { left = fs.readdirSync(outDir).filter((n) => n !== 'report.json' && n !== 'report.md'); } catch { /* the folder was never made */ }
    R.files.left = left.concat(['report.json', 'report.md']);
    R.finishedAt = new Date().toISOString();
    try { R.bars = bars(R); } catch (e) { R.problems.push('the bars could not be judged: ' + e.message); }
    let md;
    try { md = markdown(R); } catch (e) { md = '# Recorder spike\n\nThe report could not be drawn: ' + e.message + '\n'; R.problems.push('markdown: ' + e.stack); }
    try {
      fs.mkdirSync(outDir, { recursive: true });
      fs.writeFileSync(path.join(outDir, 'report.json'), JSON.stringify(R, null, 2));
      fs.writeFileSync(path.join(outDir, 'report.md'), md);
    } catch (e) { console.error('could not write the report: ' + e.message); }
    try { process.stdout.write(md + '\n'); } catch { /* report.md has it */ }
    app.exit(code);
  }

  function fail(err) {
    if (finishing) return;
    R.failed = String((err && err.stack) || err);
    finish(1);
  }

  process.on('uncaughtException', fail);
  process.on('unhandledRejection', fail);
  process.on('SIGINT', () => fail(new Error('interrupted')));
  app.whenReady().then(run).catch(fail);
}

// ---------------------------------------------------------------------------
// The report
// ---------------------------------------------------------------------------

function bars(R) {
  const B = [];
  const L = R.webm && R.webm.layout;
  B.push({
    bar: 'Clusters that start on a keyframe',
    need: 'at least 99%',
    got: L ? pct(L.keyframeShare) + ' (' + L.keyframeFirst + ' of ' + L.clusters + ')' : 'not measured',
    pass: L ? L.keyframeShare >= KEYFRAME_SHARE_BAR : false,
  });
  for (const [key, how] of [['asCut', 'cut as is (clip.webm)'], ['indexed', 'with Duration and Cues written (clip-indexed.webm)']]) {
    const p = R.clip && R.clip[key] && R.clip[key].play;
    const s = p && p.seek;
    let got = 'not run';
    if (p && !s) got = 'no metadata: ' + (p.error || (p.metadata && p.metadata.why) || (p.mediaError && p.mediaError.message) || 'loadedmetadata never fired');
    else if (s && s.fired) got = 'seeked fired after ' + s.ms + ' ms at ' + r3(s.currentTime) + ' s';
    else if (s) got = 'seeked never fired (' + (s.why || 'no reason given') + '), currentTime ' + r3(s.currentTime);
    B.push({ bar: 'The clip seeks, ' + how, need: 'seeked fires for ' + SEEK_TO_S + '.0 s and lands within ' + SEEK_TOLERANCE_S + ' s', got, pass: !!(p && p.seekOk) });
  }
  const g = R.capture && R.capture.grabs;
  const clipFrames = (R.clip && R.clip.indexed && R.clip.indexed.play && R.clip.indexed.play.frames) || [];
  const darkClip = clipFrames.filter((x) => x.lum === null || x.lum < BLACK_LUMA).length;
  B.push({
    bar: 'No black frames (this run\'s screen)',
    need: 'no live grab under mean 4 of 255, and the clip\'s frames at 1, 5 and 9 s drawn and not black',
    got: g ? g.nearBlack + ' of ' + g.count + ' grabs black (darkest mean ' + (g.luma.n ? g.luma.min : 'n/a') + '); clip frames black or not drawn: ' + darkClip + ' of ' + clipFrames.length : 'no grabs',
    pass: !!(g && g.count && g.nearBlack === 0 && clipFrames.length && darkClip === 0),
  });
  B.push({
    bar: 'Live frame grab p90, grab to JPEG',
    need: 'under ' + GRAB_P90_BAR_MS + ' ms',
    got: g && g.totalMs.n ? g.totalMs.p90 + ' ms (p50 ' + g.totalMs.p50 + ', max ' + g.totalMs.max + ')' : 'no grabs',
    pass: !!(g && g.totalMs.n && g.totalMs.p90 < GRAB_P90_BAR_MS),
  });
  B.push({ bar: 'FPS loss in the game', need: 'at most 5%, average and 1% lows', got: 'needs the game: see "Not measurable here"', pass: null });
  return B;
}

function markdown(R) {
  const L = [];
  const add = (...lines) => { for (const l of lines) L.push(l); };
  const v = (x, unit) => (x === null || x === undefined || (typeof x === 'number' && !Number.isFinite(x)) ? 'n/a' : String(x) + (unit || ''));
  const q = (s, unit) => (s && s.n ? 'p50 ' + v(s.p50, unit) + ', p90 ' + v(s.p90, unit) + ', max ' + v(s.max, unit) : 'n/a');
  const m = (s, unit) => (s && s.n ? 'mean ' + v(s.mean, unit) + ', p95 ' + v(s.p95, unit) + ', max ' + v(s.max, unit) : 'n/a');
  const yn = (b) => (b === null || b === undefined ? 'n/a' : b ? 'yes' : 'no');
  const cell = (x) => String(x).split('|').join('/');

  const a = R.args;
  add('# Recorder spike, 8.3 item 1', '');
  add(R.startedAt + '. ' + a.seconds + ' s at ' + a.res + 'p, asked for ' + a.fps + ' fps, codec ' + a.codec + (a.motion ? ', with the motion window' : '') + (a.keep ? ', files kept' : ', captured files deleted') + '.');
  if (R.failed) add('', '**The run did not complete:** ' + cell(R.failed.split('\n')[0]));
  const judged = (R.bars || []).filter((b) => b.pass !== null);
  add('', 'Bars measured here: ' + judged.filter((b) => b.pass).length + ' pass, ' + judged.filter((b) => !b.pass).length + ' fail, of ' + judged.length + '.', '');
  const fps = R.webm && R.webm.layout && R.webm.layout.framesPerSecond;
  if (typeof fps === 'number' && fps < 20) {
    add('**The screen barely changed:** ' + fps + ' frames a second were recorded, because the capturer delivers a frame only when something on screen changed. The frame rate, the encoder load and the drift say little about 30 fps here; run it with --motion on a desk, or in the game.', '');
  }

  add('## Pass bars', '', '| Bar | Needs | Measured | Result |', '|---|---|---|---|');
  for (const b of R.bars || []) add('| ' + [b.bar, b.need, b.got, b.pass === null ? 'NOT MEASURED' : b.pass ? 'PASS' : 'FAIL'].map(cell).join(' | ') + ' |');
  add('');

  add('## Machine', '');
  if (R.machine) add('- CPU: ' + R.machine.cpu + ', ' + R.machine.logicalCores + ' logical cores, ' + R.machine.ramGB + ' GB RAM', '- OS: ' + R.machine.os, '- Electron ' + R.machine.electron + ', Chromium ' + R.machine.chromium);
  if (R.gpu) {
    for (const d of R.gpu.devices || []) add('- GPU: ' + v(d.name) + ' (' + d.vendorId + ':' + d.deviceId + ', driver ' + v(d.driverVersion) + ')');
    if (R.gpu.renderer) add('- Renderer: ' + R.gpu.renderer);
    const fs2 = R.gpu.featureStatus || {};
    add('- GPU process: ' + yn(R.gpu.gpuProcess) + '; Chromium feature status: video_encode ' + v(fs2.video_encode) + ', video_decode ' + v(fs2.video_decode) + ', gpu_compositing ' + v(fs2.gpu_compositing));
  }
  if (R.display) add('- Primary display: ' + R.display.physical.width + 'x' + R.display.physical.height + ' physical, scale ' + R.display.scaleFactor + ', ' + v(R.display.refreshHz, ' Hz') + ', ' + R.display.displays + ' display(s)');
  add('');

  add('## Capture', '');
  const c = R.capture || {};
  if (c.source) add('- Source: ' + c.source.id + ' "' + c.source.name + '", display_id ' + c.source.displayId + (c.source.matchedPrimary ? ', matched to the primary display' : ', NOT matched to the primary display, the first screen was used') + ' (' + c.source.screens + ' screen(s))');
  if (R.page) {
    add('- Hidden page: visibilityState ' + R.page.visibilityState + ', requestAnimationFrame fires: ' + yn(R.page.rafFires));
    add('- APIs in the page: ' + Object.keys(R.page.api || {}).map((k) => k + ' ' + yn(R.page.api[k])).join(', '));
  }
  if (c.stream) {
    add('- Stream: ' + c.stream.via + ', opened in ' + c.stream.getUserMediaMs + ' ms; settings ' + JSON.stringify(c.stream.settings));
    for (const n of c.stream.notes || []) add('- Note: ' + n);
  }
  if (R.page && R.page.isTypeSupported) {
    add('', '| MediaRecorder type | isTypeSupported |', '|---|---|');
    for (const [t, ok] of Object.entries(R.page.isTypeSupported)) add('| ' + t + ' | ' + yn(ok) + ' |');
    add('');
  }
  if (R.page && R.page.canPlayType) {
    const cp = R.page.canPlayType;
    const webmAvc = cp['video/webm; codecs="avc1.42E01E"'];
    const mkvAvc = cp['video/x-matroska; codecs="avc1.42E01E"'];
    add('- <video> canPlayType: ' + Object.entries(cp).map(([t, ans]) => cell(t) + ' ' + ans).join('; ') + '.' + (webmAvc === 'no' && mkvAvc !== 'no' ? ' An h264 clip has to be served as video/x-matroska, never as video/webm.' : ''));
  }
  if (c.recorder) {
    add('- Asked for ' + c.mimeRequested + ' (' + c.codec + '). The recorder reported ' + v(c.recorder.mimeType) + ' at start and ' + v(c.recorder.mimeTypeAfterStop) + ' after stop, ' + v(c.recorder.videoBitsPerSecond) + ' bps' + (c.recorder.error ? '; error: ' + c.recorder.error : ''));
  }
  if (c.keyframeOption) add('- videoKeyFrameIntervalDuration 1000: read by this build ' + yn(c.keyframeOption.readByThisBuild) + '; keyframe spacing in the file p50 ' + v(c.keyframeOption.keyframeIntervalP50Ms, ' ms') + ', so honoured: ' + yn(c.keyframeOption.honoured));
  const enc = R.cost && R.cost.capture && R.cost.capture.gpuEngines && R.cost.capture.gpuEngines.engines && R.cost.capture.gpuEngines.engines.VideoEncode;
  const enc0 = R.cost && R.cost.baseline && R.cost.baseline.gpuEngines && R.cost.baseline.gpuEngines.engines && R.cost.baseline.gpuEngines.engines.VideoEncode;
  const tab = R.cost && R.cost.capture && R.cost.capture.cpu.byProcessType.Tab;
  if (enc || tab) {
    add('- Which encoder ran: this app on the GPU\'s Video Encode engine, mean ' + v(enc0 && enc0.ours.mean, '%') + ' in the baseline and ' + v(enc && enc.ours.mean, '%') + ' (max ' + v(enc && enc.ours.max, '%') + ') during the capture; the page process at a mean ' + v(tab && tab.mean, '%') + ' of one core. A hardware encoder shows as the first rising with the frame rate, a software one (OpenH264, libvpx, which run in the page process) as the second.');
  }
  if (R.page && R.page.webcodecsEncoder) {
    add('', 'Can WebCodecs open an encoder for the codec (prefer-hardware is a hint of a hardware encoder; MediaRecorder is a separate path):', '');
    add('| Asked | Answer |', '|---|---|');
    for (const [k, ok] of Object.entries(R.page.webcodecsEncoder)) add('| VideoEncoder ' + k + ' | ' + (typeof ok === 'boolean' ? yn(ok) : cell(ok)) + ' |');
    add('');
  }
  if (c.trackStats && c.trackStats.during) {
    const d = c.trackStats.during;
    add('- The capture track during the run (MediaStreamTrack stats): ' + v(d.delivered) + ' frames delivered, ' + v(d.discarded) + ' discarded, ' + v(d.total) + ' in all');
  }
  add('');

  add('## Recording', '');
  const rec = R.recording;
  if (rec) {
    add('- ' + rec.bytes + ' bytes in ' + rec.chunks + ' chunks over ' + rec.recordedForS + ' s, ' + rec.averageMbps + ' Mbps on average');
    add('- Chunk size KB: ' + q(rec.chunkKB) + '; interval ms: ' + q(rec.chunkIntervalMs) + '; first chunk ' + v(rec.firstChunkAfterStartMs, ' ms') + ' after start; page to main ' + q(rec.deliveryToMainMs, ' ms'));
  }
  const w = R.webm;
  if (w) {
    add('', '### The file, read whole', '');
    add('- DocType ' + v(w.docType) + ' v' + v(w.docTypeVersion) + '; Segment size ' + (w.segment ? (w.segment.sizeKnown ? 'known (' + w.segment.size + ')' : 'unknown') : 'n/a') + '; SeekHead ' + yn(w.seekHead));
    add('- Level 1 elements: ' + Object.entries(w.level1 || {}).map(([k, n]) => k + ' ' + n).join(', '));
    add('- Info: TimecodeScale ' + w.info.timecodeScale + ' ns; Duration present ' + yn(w.info.durationPresent) + (w.info.durationPresent ? ' (' + w.info.durationMs + ' ms)' : '') + '; MuxingApp ' + v(w.info.muxingApp) + ', WritingApp ' + v(w.info.writingApp));
    for (const t of w.tracks || []) add('- Track ' + t.number + ': type ' + t.type + ', CodecID ' + v(t.codecId) + ', CodecPrivate ' + (t.codecPrivateBytes ? t.codecPrivateBytes + ' bytes' + (t.codecPrivateIsAvcC ? ' (an avcC record)' : '') : 'absent') + ', ' + v(t.pixelWidth) + 'x' + v(t.pixelHeight));
    add('- Cues present: ' + yn(w.cues && w.cues.present) + (w.cues && w.cues.present ? ' (' + w.cues.points + ' points)' : ''));
    const lay = w.layout;
    if (lay) {
      add('- Clusters: ' + lay.clusters + ' with video (' + lay.emptyClusters + ' empty), ' + lay.clustersOfKnownSize + ' of known size; starting on a keyframe: ' + lay.keyframeFirst + ' (' + pct(lay.keyframeShare) + ')');
      add('- Cluster duration ms: ' + q(lay.clusterMs));
      add('- Video blocks: ' + lay.videoBlocks + ' over ' + lay.spanMs + ' ms, ' + v(lay.framesPerSecond) + ' frames a second against ' + FPS + '; frame interval ms ' + q(lay.frameIntervalMs) + '; gaps over 50 ms: ' + lay.gapsOver50ms + (lay.laced ? '; laced blocks: ' + lay.laced : ''));
      add('- Keyframes: ' + lay.keyframes + ', spacing ms ' + q(lay.keyframeIntervalMs));
      if (lay.clusterDrift) add('- Each cluster\'s timecode against the wall clock of the chunk that carried it, the first chunk\'s wall time being 0: ' + q(lay.clusterDrift, ' ms') + ', min ' + v(lay.clusterDrift.min, ' ms') + '. It walks ' + v(lay.clusterDrift.slopeMsPerMinute) + ' ms a minute (median of pairwise slopes). A steady offset is only where the timeslice falls against the keyframes; a walk would be drift.');
      if (lay.newestBlockDrift) add('- The newest block in each chunk against that chunk\'s wall clock, relative to the first chunk: ' + v(lay.newestBlockDrift.atEndMs) + ' ms by the end, range ' + v(lay.newestBlockDrift.min) + ' to ' + v(lay.newestBlockDrift.max) + ' ms, walking ' + v(lay.newestBlockDrift.slopeMsPerMinute) + ' ms a minute. This one is good to a frame interval.' + (lay.spanMs < 120000 ? ' On a run under 2 minutes a few ms of jitter reads as tens of ms a minute; a 5 minute run says more.' : ''));
    }
    const h = w.h264;
    if (h) add('- H.264 in the blocks: ' + (h.format === 'annexb' ? 'Annex B (start codes)' : 'length prefixed (AVC)') + '; codec ' + v((h.avcC && h.avcC.codec) || h.codecFromStream) + '; keyframes carrying SPS and PPS: ' + h.keyframesWithSpsPps + ' of ' + h.keyframes + '; first keyframe NAL types ' + JSON.stringify(h.firstKeyframeNalTypes));
    for (const n of w.notes || []) add('- Note: ' + n);
  }
  add('');

  add('## Live frame grab', '');
  const g = c.grabs;
  if (g) {
    add('- Method: ' + v(g.method) + (g.attemptsBeforeIt && g.attemptsBeforeIt.length ? ' (after: ' + g.attemptsBeforeIt.join('; ') + ')' : ''));
    add('- ' + g.count + ' grabs. Grab to JPEG ms: ' + q(g.totalMs) + '. Of which waiting for a frame ' + q(g.waitMs) + ', drawing ' + q(g.drawMs) + ', JPEG ' + q(g.encodeMs) + '; the black check after it ' + q(g.blackCheckMs));
    add('- JPEG KB: ' + q(g.jpegKB) + '; age of the frame grabbed ms: ' + q(g.frameAgeMs));
    add('- Brightness (mean of 255): ' + q(g.luma) + ', min ' + v(g.luma.min) + '; near black (under ' + BLACK_LUMA + '): ' + g.nearBlack);
    add('- Frames the grab path was handed: ' + v(g.deliveredFrames) + ', ' + v(g.deliveredPerSecond) + ' a second; first frame ' + JSON.stringify(g.firstFrame));
    if (g.readError) add('- Read error: ' + g.readError);
  }
  add('');

  add('## Cost', '');
  const b0 = R.cost && R.cost.baseline;
  const b1 = R.cost && R.cost.capture;
  if (b0 || b1) {
    add('| | Baseline (' + v(b0 && b0.cpu.seconds) + ' s) | Capture (' + v(b1 && b1.cpu.seconds) + ' s) |', '|---|---|---|');
    const row = (label, f) => add('| ' + label + ' | ' + (b0 ? f(b0) : 'n/a') + ' | ' + (b1 ? f(b1) : 'n/a') + ' |');
    row('This app\'s CPU, % of one core', (p) => m(p.cpu.appCpuPercentOfOneCore));
    row('This app\'s CPU, % of the machine', (p) => m(p.cpu.appCpuPercentOfMachine));
    const types = new Set([].concat(b0 ? Object.keys(b0.cpu.byProcessType) : [], b1 ? Object.keys(b1.cpu.byProcessType) : []));
    for (const t of types) row('&nbsp;&nbsp;' + t + ' process(es), % of one core', (p) => m(p.cpu.byProcessType[t]));
    row('Machine CPU, all processes, %', (p) => m(p.cpu.systemCpuPercent));
    row('This app\'s working set, MB', (p) => m(p.cpu.workingSetMB));
    row('This app\'s private bytes, MB', (p) => m(p.cpu.privateMB));
    for (const eng of ['VideoEncode', '3D']) {
      row('GPU ' + eng + ' engine, this app, %', (p) => (p.gpuEngines && p.gpuEngines.engines && p.gpuEngines.engines[eng] ? m(p.gpuEngines.engines[eng].ours) : 'n/a: ' + cell((p.gpuEngines && p.gpuEngines.error) || 'no counter')));
      row('GPU ' + eng + ' engine, every process, %', (p) => (p.gpuEngines && p.gpuEngines.engines && p.gpuEngines.engines[eng] ? m(p.gpuEngines.engines[eng].all) : 'n/a'));
    }
    add('');
    const names = (R.cost && R.cost.otherProcessNames) || {};
    const others = [];
    for (const [phase, p] of [['baseline', b0], ['capture', b1]]) {
      for (const o of (p && p.gpuEngines && p.gpuEngines.busyOthers) || []) others.push((names[o.pid] || 'pid ' + o.pid) + ' (pid ' + o.pid + ') on ' + o.engine + ' at a mean ' + o.mean + '% in the ' + phase);
    }
    if (others.length) add('- Other processes busy on these GPU engines, which the game shares too: ' + others.join('; '));
    if (R.systemMemory) add('- System memory: ' + R.systemMemory.totalMB + ' MB, free ' + R.systemMemory.freeMBBefore + ' MB before and ' + v(R.systemMemory.freeMBAfter) + ' MB after the capture');
    add('- CPU percentages are app.getAppMetrics() percentCPUUsage, where 100 is one whole core. The GPU engines are the Windows counters Task Manager draws, summed over this app\'s processes, and over every process.');
    if (R.args.motion) add('- The --motion window\'s page process is left out of these figures. Its drawing lands in the shared GPU process, which cannot be split, so the GPU process and the 3D engine read a little high.');
  }
  add('');

  add('## The clip', '');
  const cl = R.clip || {};
  if (cl.wanted) {
    add('- Wanted ' + cl.wanted.fromS + ' s to ' + cl.wanted.toS + ' s (8 s before ' + cl.wanted.aroundS + ' s to 2 s after). Cut from ' + v(cl.cut.fromS) + ' s, ' + v(cl.cut.startsEarlyByS) + ' s early, so the clip opens on a keyframe; ' + cl.cut.clusters + ' clusters (' + cl.cut.clusterIndexes.join(' to ') + ').');
    add('', '| | clip.webm, as cut | clip-indexed.webm, Duration and Cues |', '|---|---|---|');
    const both = (label, f) => add('| ' + label + ' | ' + cell(f(cl.asCut)) + ' | ' + cell(f(cl.indexed)) + ' |');
    both('Bytes', (x) => x.structure.bytes);
    both('In the file: Segment size, Duration, Cues', (x) => (x.structure.segmentSizeKnown ? 'known' : 'unknown') + ', ' + v(x.structure.durationMs, ' ms') + ', ' + x.structure.cuePoints + ' cue points');
    both('In the file: clusters, starting on a keyframe, first timecode', (x) => x.structure.clusters + ', ' + x.structure.keyframeFirst + ', ' + v(x.structure.firstTimecodeMs, ' ms'));
    both('loadedmetadata', (x) => (x.play && x.play.metadata ? (x.play.metadata.fired ? 'after ' + x.play.metadata.ms + ' ms' : 'no: ' + x.play.metadata.why) : v(x.play && x.play.error)));
    both('duration the <video> reports', (x) => (x.play ? v(x.play.duration) + (x.play.durationAfter !== undefined && x.play.durationAfter !== x.play.duration ? ' (then ' + v(x.play.durationAfter) + ')' : '') : 'n/a'));
    both('seekable', (x) => (x.play ? JSON.stringify(x.play.seekable) : 'n/a'));
    both('seek to ' + SEEK_TO_S + '.0 s', (x) => (x.play && x.play.seek ? (x.play.seek.fired ? 'seeked after ' + x.play.seek.ms + ' ms, at ' + r3(x.play.seek.currentTime) + ' s' : 'no seeked: ' + x.play.seek.why + ', at ' + r3(x.play.seek.currentTime) + ' s') : 'n/a'));
    both('frames at 1, 5, 9 s: brightness', (x) => (x.play && x.play.frames ? x.play.frames.map((f) => f.t + ' s ' + (f.lum === null ? (f.fired ? 'not drawn (readyState ' + f.readyState + ')' : 'no seek') : f.lum)).join('; ') : 'n/a'));
    both('plays (1 s from 3 s)', (x) => (x.play && x.play.play ? (x.play.play.error ? x.play.play.error : 'from ' + r3(x.play.play.from) + ' to ' + r3(x.play.play.to) + ' s, advanced ' + yn(x.play.play.advanced)) : 'n/a'));
    both('media error', (x) => (x.play && x.play.mediaError ? x.play.mediaError.code + ' ' + x.play.mediaError.message : 'none'));
    add('');
  }
  const wc = cl.webcodecs;
  if (wc) {
    if (wc.error && !wc.frames) add('- WebCodecs: ' + wc.error);
    else {
      add('- WebCodecs VideoDecoder: ' + v(wc.codec) + ', ' + (wc.description ? 'given the avcC as description' : 'no description (' + v(wc.format) + ')') + '; supported ' + yn(wc.supported) + ', a hardware decoder available ' + yn(wc.hardwareDecoderAvailable));
      add('- ' + v(wc.frames) + ' frames out of ' + wc.blocks + ' blocks in ' + v(wc.ms, ' ms') + ' (' + v(wc.fps) + ' frames a second; first frame after ' + v(wc.firstOutMs, ' ms') + ')' + (wc.decodeError ? '; error: ' + wc.decodeError : ''));
      for (const tg of wc.targets || []) add('- At ' + tg.t + ' s: frame at ' + v(tg.frameAtS) + ' s, brightness ' + v(tg.lum) + ', against the <video> frame there: ' + (tg.psnrVsVideoDb === null ? 'n/a' : tg.psnrVsVideoDb === 'identical' ? 'identical' : tg.psnrVsVideoDb + ' dB PSNR'));
    }
  }
  add('');

  add('## Not measurable here', '');
  add('- **FPS loss in the game** (the bar: at most 5%, for the FPS average and for the 1% lows). Only the game shows it. The procedure is in the header of scripts/spike-recorder.js: CapFrameX, PresentMon or FrameView, one repeatable routine in The Range, three runs off and three on, in Fullscreen and in Windowed Fullscreen, at 720p and 1080p.');
  add('- **The GPU Video Encode engine, by eye.** Task Manager, Performance, GPU, set an engine graph to "Video Encode". The Cost table reads the same counters for this run\'s processes; Task Manager is the check that they were read right.');
  add('- **No black under Fullscreen Optimizations.** This run saw whatever was on this screen. Run it with Valorant in Fullscreen for the bar that matters.');
  add('- **Read model agreement on stream frames against GDI frames.** That needs the read model, and this spike calls no model. It is the paired bench before the read switches source (8.3 item 3).');
  add('');

  if (R.problems.length || R.console.length) {
    add('## Problems', '');
    for (const p of R.problems) add('- ' + p);
    for (const p of R.console) add('- console ' + p);
    add('');
  }
  add('## Files left', '', R.files.left.join(', ') + (R.files.samples.length ? '. Samples: ' + R.files.samples.join(', ') : ''), '');
  return L.join('\n');
}

// ---------------------------------------------------------------------------
// Entry
// ---------------------------------------------------------------------------

// Under plain node, or under Electron with ELECTRON_RUN_AS_NODE set,
// require('electron') is the binary's path rather than the API: relaunch the
// real thing with the variable removed, then print the report, because an
// Electron main process on Windows does not reliably flush a piped stdout.
function launch() {
  const argv = process.argv.slice(2);
  const opts = parseArgs(argv);
  if (opts.problems.length) { console.error(opts.problems.join('\n')); process.exit(2); }
  const out = path.resolve(opts.out || defaultOutDir());
  const env = Object.assign({}, process.env, { OCCLARA_SPIKE_OUT: out });
  delete env.ELECTRON_RUN_AS_NODE;
  console.log('Recorder spike: ' + BASELINE_S + ' s of baseline, then ' + opts.seconds + ' s of capture, then the analysis. Report: ' + out);
  // Ctrl+C reaches the Electron child too, which deletes its capture and
  // writes its report; this side waits for that and prints it.
  process.on('SIGINT', () => {});
  const r = spawnSync(electron, [__filename].concat(argv), { env, stdio: ['ignore', 'ignore', 'inherit'] });
  let md = null;
  try { md = fs.readFileSync(path.join(out, 'report.md'), 'utf8'); } catch { /* said below */ }
  if (md) process.stdout.write(md + '\n');
  else console.error('No report was written to ' + out + ' (exit ' + r.status + ').');
  process.exit(r.status === null ? 1 : r.status);
}

if (typeof electron === 'string') launch();
else electronMain();
