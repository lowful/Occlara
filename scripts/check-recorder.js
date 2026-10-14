'use strict';

/**
 * The match recorder, booted for real (8.3): the real index.js, its real
 * recorder window and page, the real webm.js paging what it records to disk,
 * and the real capture.js handing the read its frame.
 *
 * NEVER THE DESKTOP. OCCLARA_FAKE_CAPTURE makes the page record frames it
 * draws itself on a canvas, written to a track generator, instead of the
 * screen, and makes every GDI frame a flat grey one made with Electron's own
 * encoder, so nothing here touches the screen. The canvas is the busy picture
 * (=busy, blocks that move every frame, which the encoder spends its whole
 * budget on), drawn 60 times a second (OCCLARA_DEV_FAKE_FPS) as a capture
 * asked for 60 delivers it. Everything else is what ships: the hidden window,
 * its preload and its strict page, the hardware H.264 gate, MediaRecorder fed
 * thirty frames a second by the grid, the processors on the capture track and
 * its clone, the comparison with GDI, the health rules.
 *
 *   1. Whatever a run left in userData/recording is swept at launch, and the
 *      session's counts a quit left unsent (recordingReportPending) are sent
 *      once, and let go once taken.
 *   2. Valorant recording: the page (never shown, never throttled) records
 *      about 10 s in pages of 4 s (OCCLARA_DEV_RECORDER_PAGE_MS), the read's
 *      1 s frame comes from the stream once the comparison has passed (a JPEG
 *      of the canvas, never the grey GDI frame), the hardware gate says yes to
 *      H.264 and no to VP9 on this PC, the page holds no frame open but the
 *      newest, the AI log opened meanwhile is out of the recording, and Stop
 *      stops it cleanly: the page gone, every chunk the page said it handed
 *      over written, the pages read back as whole Clusters on keyframes, the
 *      session's counts posted (to a stand in, never the network) as
 *      'recorded', ten fields, kept until the post is taken. And 8.4.2's:
 *      the 60 a second delivered recorded at 30 at most, on disk, in a clip
 *      cut from it and in what the page and Settings say, at the bitrate
 *      asked (within BITRATE_BAND of it, where 60 a second wrote twice it),
 *      no frame left open and no track live once the page tore its tracks
 *      down, and the recording's 0 on the wall clock the moment the page
 *      handed over its first frame, the chunks' own reckoning within 50 ms
 *      after it and every frame handed over recorded, and the page's wall
 *      and monotonic clocks read together, a reading kept every five seconds
 *      for the clips to follow the one against the other.
 *   3. Forced busy: a frame floor of 1000 a second held for 3 s
 *      (OCCLARA_DEV_RECORDER_MIN_FPS, _BUSY_MS) in a match in progress, so the
 *      real rule fires: the reads go back to the GDI helper (the grey frame),
 *      the notice is on the window's notice line in the spec's words, the main window
 *      is out of the recording while sealed, one strike is kept, and the
 *      session ends as 'busy'.
 *   4. A game the capture cannot see: the canvas drawn black against a grey
 *      GDI frame, so the stream reads black twice: recording stops for the
 *      session, the reads stay on GDI, and the notice says Windowed Fullscreen.
 *      Then the primary display changing while recording: the old page stops
 *      with every chunk on disk and nothing open, and a new page records 30 a
 *      second of the 60 delivered, built again.
 *   5. A match's end holds its recording, and a resume lets the hold go with
 *      the withdrawn review. The displays changing reach the recorder with
 *      the primary display's id. Windows ending its session ('session-end' on
 *      the main window) ends the recording in the same call: every recording
 *      deleted, its counts kept for the next launch and none posted into the
 *      exit, the AI log back in captures.
 *   6. An update's restart, before-quit with no cleanupAndQuit, ends it the
 *      same way. Quitting as the tray does deletes every recording still
 *      kept, and keeps its session's counts for the next launch: nothing is
 *      posted on the way out, where it could be taken and its answer lost.
 *
 * The engine that would call the server is a stand in that hands the check its
 * captureFunction, as the real one is handed it; the api client is a stand in
 * that keeps what it is sent. No model, no network, no screen.
 *
 * Results travel through a FILE, not stdout: an Electron main process on Windows
 * does not reliably flush a piped stdout.
 *
 * Run: npm run check:recorder
 */

const path = require('path');
const fs = require('fs');
const os = require('os');

const REPO = path.join(__dirname, '..');
const OUT = path.join(os.tmpdir(), 'occlara-recorder-check.json');
// Every session report the stand in is sent, a line each, written as it is
// sent: the last one is sent by the quit, after the result file is written.
const POSTS = path.join(os.tmpdir(), 'occlara-recorder-check-posts.jsonl');
const INDEX = path.join(REPO, 'src', 'main', 'index.js');
const BUSY_TEXT = 'Recording stopped for this session: your PC was busy. The coach still reads your screen up to once a second.';
// Longer than the recorder waits on a stop (STOP_TIMEOUT_MS, 10 s).
const STOP_WAIT_MS = 14000;
const BLACK_TEXT = 'Recording needs Windowed Fullscreen in this game. The coach still reads your screen up to once a second.';
// The generated picture's frames a second, as a capture asked for 60 delivers
// them, and what the recording keeps of them (8.4.2).
const FAKE_FPS = 60;
const RECORD_FPS = 30;
// The bitrate a recording may run at against the one asked: what the encoder
// overshoots by on the busy picture at 30 a second. Handed 60 a second, it ran
// at twice the asked (6.09 Mbps against 3 at 720p, measured before 8.4.2).
const BITRATE_BAND = 1.4;

if (!process.versions.electron) {
  const { spawnSync } = require('child_process');
  const electron = require('electron');
  try { fs.unlinkSync(OUT); } catch { /* nothing to clear */ }
  try { fs.unlinkSync(POSTS); } catch { /* nothing to clear */ }
  const env = Object.assign({}, process.env, {
    OCCLARA_RECORDER_OUT: OUT,
    OCCLARA_RECORDER_POSTS: POSTS,
    // A picture the encoder spends its whole budget on, drawn 60 times a
    // second as a capture asked for 60 delivers it (8.4.2).
    OCCLARA_FAKE_CAPTURE: 'busy',
    OCCLARA_DEV_FAKE_FPS: String(FAKE_FPS),
    OCCLARA_DEV_RECORDER_PAGE_MS: '4000',
  });
  delete env.OCCLARA_DEV_RECORDER_MIN_FPS;
  delete env.OCCLARA_DEV_RECORDER_BUSY_MS;
  // This shell exports ELECTRON_RUN_AS_NODE=1, which makes the Electron binary
  // run as plain node and the app dies with a misleading error.
  delete env.ELECTRON_RUN_AS_NODE;
  const r = spawnSync(electron, [__filename], { env, timeout: 180000 });
  let rec = null;
  try { rec = JSON.parse(fs.readFileSync(OUT, 'utf8')); } catch { /* reported below */ }
  if (!rec) { console.error('FAIL: the check wrote no result (exit ' + r.status + ')'); process.exit(1); }
  // Quit: nothing of the screen is left behind, held or not.
  let left = [];
  try { left = fs.readdirSync(path.join(os.tmpdir(), 'occlara-check-recorder', 'recording')); } catch { left = []; }
  rec.lines.push({ ok: !rec.fatal && !left.length, what: `quitting deleted every recording (${left.length ? left.join(', ') + ' left' : 'nothing left'})` });
  // And the session it ended counted once: a quit used to send nothing, then
  // posted into the exit as well as keeping it, so a post that reached the
  // server and lost its answer was sent again by the next launch. Now it is
  // kept in the config for the next launch (step 1 posts what one kept), and
  // nothing is posted on the way out.
  let sent = [];
  try { sent = fs.readFileSync(POSTS, 'utf8').trim().split('\n').map((l) => JSON.parse(l)); } catch { sent = []; }
  let pending = null;
  try { pending = JSON.parse(fs.readFileSync(path.join(os.tmpdir(), 'occlara-check-recorder', 'occlara-config.json'), 'utf8')).recordingReportPending; } catch { pending = null; }
  const kept = pending && pending.block;
  rec.lines.push({ ok: !rec.fatal && sent.length === rec.reportsBeforeQuit && kept && pending.at !== rec.pendingBeforeQuit
    && kept.outcome === 'recorded' && kept.game === 'valorant' && kept.minutes > 0,
    what: `quitting mid recording kept its session's counts for the next launch, none posted into the exit: ${JSON.stringify(kept)} (${sent.length - rec.reportsBeforeQuit} posted on the way out)` });
  for (const l of rec.lines) console.log((l.ok ? 'ok    ' : 'FAIL  ') + l.what);
  if (rec.fatal) console.log('FAIL  ' + rec.fatal);
  const bad = rec.lines.filter((l) => !l.ok).length + (rec.fatal ? 1 : 0);
  if (bad) { console.error(`\nFAIL: ${bad} of ${rec.lines.length} recorder checks failed`); process.exit(1); }
  console.log(`\nPASS: all ${rec.lines.length} checks: the real recorder records generated frames into pages, 30 a second of the 60 drawn at the bitrate asked, serves the read its frame, stops cleanly with every chunk the page sent and nothing left open, falls back to GDI with its notice when busy, stops when the capture reads black, starts again whole on a display change, ends at once when Windows ends its session or any quit comes, and its counts reach the server once however the session ended`);
  process.exit(0);
}

const Module = require('module');
const { EventEmitter } = require('events');
const { app, ipcMain, nativeImage, screen } = require('electron');
const C = require(path.join(REPO, 'src/shared/channels'));
const webm = require(path.join(REPO, 'src/shared/webm'));
const recorderModule = require(path.join(REPO, 'src/main/services/recorder'));
const { replay, load } = require('./fixtures/replay-match');
// The real Abyss match, as the engine's snapshot of it, for a match end.
const played = replay(load('valorant-match-abyss-13-11.json').frames, 'standard');

const lines = [];
const ok = (cond, what) => { lines.push({ ok: !!cond, what }); return !!cond; };
let reported = false;
// The last step quits the app the way the tray does (APP_QUIT, cleanupAndQuit)
// rather than exiting, so the parent can see what quitting left on disk.
let quitAfterReport = false;
let reportsBeforeQuit = null;
let pendingBeforeQuit = null;
function report(fatal) {
  if (reported) return;
  reported = true;
  try { fs.writeFileSync(process.env.OCCLARA_RECORDER_OUT || OUT, JSON.stringify({ lines, fatal: fatal || null, reportsBeforeQuit, pendingBeforeQuit })); }
  catch { /* exit code still carries it */ }
  const code = fatal || lines.some((l) => !l.ok) ? 1 : 0;
  if (!quitAfterReport || code) { app.exit(code); return; }
  setTimeout(() => app.exit(0), 15000);
  ipcMain.emit(C.APP_QUIT, { sender: null });
}

// ── The engine and the network, as stand ins ────────────────────────────────
const engines = [];
class StandInValorant extends EventEmitter {
  constructor(opts) {
    super();
    this.capture = opts.captureFunction;
    this.endWatch = { ended: false };
    this.rounds = 0;
    this.ledger = { size: () => this.rounds };
    this.inLobby = true;
    // Reads applied: the recorder judges a match only once one has landed.
    this.analyzedFrames = 0;
    this.matchStartedAt = Date.now();
    engines.push(this);
  }
  start() { this.emit('status', 'coaching'); }
  stop() { this.emit('status', 'stopped'); }
  setAgent() { return { ok: true }; }
  confirmAgent() {}
  pause() {}
  resume() {}
  setCaptureSpeed() {}
}
const posts = [];
const stubApi = {
  post: async (p, body) => {
    posts.push({ path: p, body });
    if (p === '/api/coach/session-report' && process.env.OCCLARA_RECORDER_POSTS) {
      try { fs.appendFileSync(process.env.OCCLARA_RECORDER_POSTS, JSON.stringify(body) + '\n'); } catch { /* said by the parent */ }
    }
    return { ok: true, status: 200, data: {} };
  },
  get: async () => ({ ok: false, status: 0, data: {} }),
};
const same = (a, b) => path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();
const realLoad = Module._load;
Module._load = function patched(request, parent, isMain) {
  if (parent && parent.filename && same(parent.filename, INDEX)) {
    if (request === './services/coaching-engine') return StandInValorant;
    if (request === './services/api-client') return stubApi;
  }
  return realLoad(request, parent, isMain);
};

// ── A throwaway profile, with a recording a crashed run left in it ─────────
const ud = path.join(os.tmpdir(), 'occlara-check-recorder');
fs.rmSync(ud, { recursive: true, force: true });
fs.mkdirSync(ud, { recursive: true });
// And the counts of a session a quit ended before its post was taken.
const PENDING = {
  at: Date.now() - 3600000, n: 1,
  block: { version: '8.3.0', game: 'valorant', mode: 'auto', res: '720', outcome: 'busy', minutes: 3.5, fpsP50: 9, recorderCpuP50: 4, systemCpuP90: 97, encoderOk: true },
};
fs.writeFileSync(path.join(ud, 'occlara-config.json'), JSON.stringify({
  game: 'valorant', onboardingCompleted: true, licenseKey: 'CHECK-RECORDER', language: 'en',
  recordingMode: 'auto', recordingRes: '720', aiLog: false, recordingReportPending: PENDING,
}, null, 2));
const ROOT = path.join(ud, 'recording');
const LEFT = path.join(ROOT, 'rec-2026-10-09T20-00-00-000Z');
fs.mkdirSync(LEFT, { recursive: true });
fs.writeFileSync(path.join(LEFT, 'page-00000.mkv'), Buffer.from('a crashed run\'s recording'));
process.env.OCCLARA_DEV_USERDATA = ud;

app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');
app.on('window-all-closed', () => { /* the run below decides when we exit */ });
process.on('uncaughtException', (e) => report('the check threw: ' + String((e && e.stack) || e)));
process.on('unhandledRejection', (e) => report('the check threw: ' + String((e && e.stack) || e)));

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms) {
  const end = Date.now() + ms;
  for (;;) {
    let v = null;
    try { v = await fn(); } catch { v = null; }
    if (v) return v;
    if (Date.now() > end) return null;
    await wait(150);
  }
}
const quantile = (xs, q) => { const v = xs.slice().sort((a, b) => a - b); return v.length ? v[Math.min(v.length - 1, Math.ceil(q * v.length) - 1)] : null; };
const r1 = (x) => (Number.isFinite(x) ? Math.round(x * 10) / 10 : null);

/** A JPEG's size and mean brightness, decoded by Electron, never shown. */
function look(b64) {
  const img = nativeImage.createFromBuffer(Buffer.from(b64, 'base64'));
  const size = img.getSize();
  const px = img.resize({ width: 64, height: 36 }).toBitmap();
  let sum = 0;
  for (let i = 0; i < px.length; i += 4) sum += 0.114 * px[i] + 0.587 * px[i + 1] + 0.299 * px[i + 2];
  return { width: size.width, height: size.height, luma: r1(sum / (px.length / 4)) };
}

/** Every recording folder now on disk, its init segment and pages read back. */
function onDisk() {
  const out = [];
  let names = [];
  try { names = fs.readdirSync(ROOT); } catch { names = []; }
  for (const n of names) {
    const dir = path.join(ROOT, n);
    const files = fs.readdirSync(dir).sort();
    const init = files.includes('init.mkv') ? fs.readFileSync(path.join(dir, 'init.mkv')) : null;
    const pages = files.filter((f) => /^page-\d{5}\.mkv$/.test(f)).map((f) => ({ name: f, bytes: fs.readFileSync(path.join(dir, f)) }));
    out.push({ name: n, files, init, pages });
  }
  return out;
}

setTimeout(async () => {
  const capture = require(path.join(REPO, 'src/main/services/capture'));
  const store = require(path.join(REPO, 'src/main/services/store'));
  const registry = require(path.join(REPO, 'src/main/windows/registry'));
  const mainWindow = require(path.join(REPO, 'src/main/windows/main-window'));
  const aiLogWindow = require(path.join(REPO, 'src/main/windows/ailog-window'));
  const invoke = (ch, ...args) => ipcMain._invokeHandlers.get(ch)({}, ...args);
  const send = (ch, ...args) => ipcMain.emit(ch, { sender: null }, ...args);
  const recWin = () => registry.get('recorder');
  // The recorder's window once its page has loaded.
  const recPage = () => {
    const w = recWin();
    return w && /\/renderer\/recorder\/index\.html$/.test(w.webContents.getURL()) ? w : null;
  };
  const latest = () => engines[engines.length - 1];
  const reportsTo = () => posts.filter((p) => p.path === '/api/coach/session-report').map((p) => p.body);
  try {
    // 1. The sweep.
    ok(!fs.existsSync(LEFT), 'the recording a crashed run left in userData/recording is swept at launch');
    // The counts a quit left unsent: sent at launch, once, and let go once taken.
    const pendingSent = await until(() => reportsTo()[0], 4000);
    ok(pendingSent && JSON.stringify(pendingSent) === JSON.stringify(PENDING.block) && reportsTo().length === 1
      && await until(() => store.get('recordingReportPending') === null, 4000),
    `the counts a quit left unsent are sent at launch, once, and let go once taken: ${JSON.stringify(pendingSent)}`);

    const win = mainWindow.create();
    win.show();
    const grey = await capture.captureGdi('standard');
    const greyLook = look(grey);
    ok(greyLook.width === 1280 && greyLook.height === 720 && Math.abs(greyLook.luma - 128) < 3,
      `the GDI frame here is the flat grey one (1280x720, brightness ${greyLook.luma}), never the screen`);

    // 2. Recording, serving, stopping.
    send(C.COACH_START);
    const v = latest();
    if (!ok(v instanceof StandInValorant && (await invoke(C.STATE_GET)).isCoaching, 'Valorant starts recording')) return report();
    const started = Date.now();
    const page = await until(() => recPage(), 8000);
    ok(page && !page.isVisible() && !page.isFocusable(), 'the recorder page opens in a window that is never shown, and cannot take the focus');
    ok(page && page.webContents.getBackgroundThrottling() === false, 'and Chromium never slows its timers, though nobody can see it');
    const pid = page ? page.webContents.getOSProcessId() : null;
    // The read takes its frame from the GDI helper until the comparison
    // passes, then from the stream.
    const grabTimes = [];
    let frame = null;
    const served = await until(async () => {
      const t0 = Date.now();
      const shot = await v.capture();
      grabTimes.push(Date.now() - t0);
      if (capture.source() === 'stream') { frame = shot; return true; }
      return false;
    }, 15000);
    ok(served, `the read's frame comes from the stream ${((Date.now() - started) / 1000).toFixed(1)} s after Start, once compared with GDI`);
    const f = frame ? look(frame) : {};
    ok(frame && frame !== grey && f.width === 1280 && f.height === 720 && f.luma > 20,
      `and it is a 1280x720 JPEG of the canvas (brightness ${f.luma}), not the grey GDI frame`);
    // The gate the page asked before it recorded tells the GPU's encoder
    // apart on this PC: yes for H.264, no for VP9 (which the spike measured
    // taking a whole core in software).
    const rec0 = recorderModule.current();
    const askGate = (codec) => rec0.request(rec0.page, { type: 'gate', codec, width: 1280, height: 720, bitrate: 3e6 }, 4000);
    const h264 = await askGate('avc1.42E01F');
    const vp9 = await askGate('vp09.00.31.08');
    ok(h264 && h264.supported === true && vp9 && vp9.supported === false,
      `the hardware gate: H.264 ${h264 && h264.supported ? 'yes' : 'no'}, VP9 ${vp9 && vp9.supported ? 'yes' : 'no'}`);
    // The AI log opened while recording is out of the recording.
    // Windows reports a window's protection once it is on screen.
    aiLogWindow.open();
    const log = await until(() => { const w = registry.get('ailog'); return w && w.isVisible() ? w : null; }, 6000);
    ok(log && log.isContentProtected(), 'the AI log opened while recording is out of the recording (content protection on)');
    // About 10 s of it, measured.
    const cpu = [];
    const mem = [];
    const cores = os.cpus().length || 1;
    app.getAppMetrics();
    const reads = [];
    const framesOpen = [];
    const tracks = [];
    // What the capture delivered and what the recording kept, each second.
    const delivered = [];
    const kept = [];
    while (Date.now() - started < 11000) {
      await wait(1000);
      const m = app.getAppMetrics().find((x) => x.pid === pid);
      if (m) { cpu.push(m.cpu.percentCPUUsage * cores); mem.push(Math.round((m.memory.privateBytes || m.memory.workingSetSize) / 1024)); }
      const t0 = Date.now();
      await v.capture();
      reads.push({ ms: Date.now() - t0, source: capture.source() });
      const hl = recorderModule.current().health;
      if (hl && Number.isFinite(hl.framesOpen)) framesOpen.push(hl.framesOpen);
      if (hl && hl.track) tracks.push(hl.track);
      if (hl && hl.changing && Number.isFinite(hl.fps) && Number.isFinite(hl.recordedFps)) { delivered.push(hl.fps); kept.push(hl.recordedFps); }
    }
    // The track's own settings, each second, for the minute line (8.4.1): a
    // generated track reports no size of its own, so the canvas's.
    ok(tracks.length >= 5 && tracks.every((t) => t.width === 1280 && t.height === 720 && (t.frameRate === null || Number.isFinite(t.frameRate))),
      `the page reports the track's own settings each second: ${JSON.stringify(tracks[tracks.length - 1] || null)}`);
    ok(reads.length >= 5 && reads.every((x) => x.source === 'stream'), `every read while recording came from the stream (${reads.length})`);
    // What Settings paints from: the state, with the track's own size in it.
    const live = (await invoke(C.STATE_GET)).recording.live;
    ok(live && live.res === '720' && live.width === 1280 && live.height === 720,
      `Settings is told the size the track is with the state, not only the setting: ${JSON.stringify(live)}`);
    // A frame never closed is a capture buffer never given back.
    ok(framesOpen.length >= 5 && Math.max(...framesOpen) <= 2, `the page holds at most the newest frame open (a clone besides, for a moment): ${framesOpen.join(', ')}`);
    // THIRTY A SECOND OF IT (8.4.2): the picture drawn 60 times a second, as a
    // capture asked for 60 delivers it, and the recording keeps 30.
    ok(kept.length >= 5 && quantile(delivered, 0.5) >= FAKE_FPS * 0.75 && quantile(kept, 0.5) >= RECORD_FPS - 3 && Math.max(...kept) <= RECORD_FPS + 2,
      `the page says what the capture delivered and what was recorded: p50 ${quantile(delivered, 0.5)} delivered, ${quantile(kept, 0.5)} recorded, at most ${Math.max(...kept)} (${kept.join(', ')})`);
    ok(live && live.fps === RECORD_FPS, `Settings says "about ${live && live.fps} fps", the frames recorded, not the ${quantile(delivered, 0.5)} delivered`);
    // A match ends: its recording is held with its AI log frames, from the
    // match's start through the five minutes it could still resume in; it
    // resumes after all, and the hold is let go with the review withdrawn.
    const holdsNow = () => (recorderModule.current() ? recorderModule.current().holds.slice() : []);
    const snap = { rounds: played.rounds, tips: [], notes: [], context: { ...played.context, agent: 'Jett', language: 'en' },
      startedAt: Date.now() - 40 * 60000, endedAt: Date.now(), endedBy: 'score' };
    v.endWatch.ended = true;
    v.emit('match-ended', snap);
    const held = holdsNow();
    ok(held.length === 1 && held[0].from === snap.startedAt - 5000 && held[0].to === snap.endedAt + 5 * 60000
      && Math.abs(held[0].until - Date.now() - 60 * 60000) < 5000,
    `the match ended: its recording held from its start to five minutes past its end, for an hour at most (${held.length} hold)`);
    v.endWatch.ended = false;
    v.emit('match-resumed', { startedAt: snap.startedAt, from: 'score' });
    ok(holdsNow().length === 0, 'it resumed: the review withdrawn, and the hold let go with it');
    v.inLobby = true;
    const during = onDisk();
    send(C.COACH_STOP);
    const gone = await until(() => !recWin(), 12000);
    ok(gone, 'Stop: the recorder page is gone');
    const after = onDisk();
    const rec = after.find((d) => d.init && d.pages.length);
    let clusters = [];
    let readErr = null;
    if (rec) {
      const r = webm.createReader();
      r.push(Buffer.concat([rec.init].concat(rec.pages.map((p) => p.bytes))));
      r.end();
      clusters = r.clusters;
      readErr = r.error;
      for (const p of rec.pages) {
        const one = webm.createReader();
        one.push(Buffer.concat([rec.init, p.bytes]));
        one.end();
        if (one.error || !one.clusters.length || one.clusters.some((c) => c.keyframe !== true)) readErr = readErr || `${p.name} does not read alone`;
      }
    }
    const frames = clusters.reduce((n, c) => n + c.frames, 0);
    const lastC = clusters[clusters.length - 1];
    const spanS = lastC ? (lastC.last - clusters[0].first) / 1000 : 0;
    const bytes = rec ? rec.init.length + rec.pages.reduce((n, p) => n + p.bytes.length, 0) : 0;
    ok(rec && rec.pages.length >= 2 && !readErr && clusters.length >= 8 && clusters.every((c) => c.keyframe === true),
      `paged into ${rec ? rec.pages.length : 0} pages of 4 s beside one init.mkv, read back as ${clusters.length} whole Clusters each on a keyframe${readErr ? ': ' + readErr : ''}`);
    const fpsOnDisk = frames / Math.max(1, spanS);
    ok(spanS >= 8 && fpsOnDisk >= RECORD_FPS - 6 && fpsOnDisk <= RECORD_FPS + 0.5,
      `${frames} frames over ${r1(spanS)} s on disk, ${r1(fpsOnDisk)} a second: a picture drawn ${FAKE_FPS} a second recorded at ${RECORD_FPS} at most`);
    const pagesBefore = during.reduce((n, d) => n + d.pages.length, 0);
    ok(after.reduce((n, d) => n + d.pages.length, 0) >= pagesBefore, 'stopped cleanly: no page went at Stop');
    // Every chunk the page said, as it stopped, that it had handed over came,
    // and every byte of them is on disk: a chunk lost between Stop and its
    // answer (MediaRecorder's last) would be the last second of a match.
    const stoppedSeg = recorderModule.current().segments.find((g) => !g.active && g.pageChunks !== null);
    const onDiskBytes = rec ? rec.init.length + rec.pages.reduce((n, p) => n + p.bytes.length, 0) : 0;
    ok(stoppedSeg && stoppedSeg.pageChunks > 0 && stoppedSeg.chunks === stoppedSeg.pageChunks && !stoppedSeg.error
      && stoppedSeg.reader.bytes === onDiskBytes,
    `stopped cleanly: the page said it handed over ${stoppedSeg ? stoppedSeg.pageChunks : '?'} chunks, ${stoppedSeg ? stoppedSeg.chunks : '?'} came, `
      + `and all ${stoppedSeg ? stoppedSeg.reader.bytes : '?'} bytes of them are on disk (${onDiskBytes})`);
    // At the bitrate asked: the encoder gives each frame a thirtieth of a
    // second's bits, so handed 60 a second it wrote twice the asked.
    const asked = stoppedSeg ? stoppedSeg.bitrate : null;
    const mbps = bytes * 8 / 1e6 / Math.max(1, spanS);
    const perMinute = (b) => r1(b / 1048576 * 60);
    ok(asked > 0 && mbps <= (asked / 1e6) * BITRATE_BAND,
      `${r1(mbps)} Mbps written, ${perMinute(bytes / Math.max(1, spanS))} MB a minute, against the ${r1(asked / 1e6)} Mbps asked (${perMinute(asked / 8)} MB a minute): within ${BITRATE_BAND} times it`);
    // Nothing left open once the page tore its tracks down, and none of them
    // live: the capture, its clone, the generator the grid wrote.
    ok(stoppedSeg && stoppedSeg.pageFramesOpen === 0 && stoppedSeg.pageTracksLive === 0 && stoppedSeg.pageRecorded >= frames,
      `and once its tracks were torn down, ${stoppedSeg ? stoppedSeg.pageFramesOpen : '?'} frames left open, ${stoppedSeg ? stoppedSeg.pageTracksLive : '?'} tracks live,`
        + ` ${stoppedSeg ? stoppedSeg.pageRecorded : '?'} frames recorded`);
    // A clip cut out of it as a review's moment is (Recorder.cutClip), 11 s
    // before a moment to 4 s after: at the 30 a second recorded, where the
    // player's match's clips came out at 56.5, 55.6 and 32 a second.
    const zClip = stoppedSeg ? stoppedSeg.zero() : null;
    const cut = zClip !== null ? recorderModule.current().cutClip(zClip + 1000, zClip + 9000, zClip + 6000) : null;
    let clipFps = null;
    let clipLen = 0;
    if (cut) {
      const rd = webm.createReader();
      rd.push(cut.bytes);
      rd.end();
      const cs = rd.clusters;
      clipLen = cs.length ? (cs[cs.length - 1].last - cs[0].first) / 1000 : 0;
      clipFps = cs.reduce((n, c) => n + c.frames, 0) / Math.max(1, clipLen);
    }
    ok(cut && clipLen >= 6 && clipFps >= RECORD_FPS - 6 && clipFps <= RECORD_FPS + 0.5,
      `a clip cut from it as a review's moment is: ${r1(clipLen)} s at ${r1(clipFps)} frames a second, the ${RECORD_FPS} recorded of the ${FAKE_FPS} drawn`);
    // THE WALL CLOCK ON THE NEW TRACK. MediaRecorder stamps a generator's
    // frame when it is written, so the recording's 0 is the moment the page
    // handed it its first frame, which the page says, and that is the 0 taken
    // (Segment.zero); the 0 the chunks reckon alone (Segment.chunksZero) is
    // held to it, as the fixture's is held to its first frame, and the
    // recording holds every frame the page handed over, the first included.
    const first = stoppedSeg && Number.isFinite(stoppedSeg.firstWall) ? stoppedSeg.firstWall : null;
    const byChunks = stoppedSeg ? stoppedSeg.chunksZero() : null;
    ok(first !== null && stoppedSeg.zero() === first && byChunks - first >= -2 && byChunks - first <= 50
      && Math.abs(stoppedSeg.pageRecorded - frames) <= 2,
    `the recording's 0 is the moment its first frame was handed over, the chunks putting it ${first === null ? '(no first frame said)' : byChunks - first} ms after (within 50),`
      + ` and the recording holds ${frames} of the ${stoppedSeg ? stoppedSeg.pageRecorded : '?'} frames handed over`);
    // AND IT DRIFTS (8.4.2): the real page reads its wall clock and its
    // monotonic one together in each second's report, and main keeps a
    // reading every five seconds, by which a clip is cut where its moment is
    // as Windows moves the wall clock (Segment.zeroAt).
    const readings = stoppedSeg && Array.isArray(stoppedSeg.clock) ? stoppedSeg.clock : [];
    const parted = readings.length ? readings[readings.length - 1].off - readings[0].off : null;
    ok(readings.length >= 2 && readings.every((x, i) => i === 0 || x.wall - readings[i - 1].wall >= 5000) && Math.abs(parted) < 50,
      `the page's two clocks read together, a reading kept every five seconds (${readings.length} in ${r1(spanS)} s, parted by ${parted === null ? '?' : r1(parted)} ms)`);
    const r0 = await until(() => reportsTo()[1], 6000);
    const appVersion = require(path.join(REPO, 'package.json')).version;
    ok(r0 && r0.outcome === 'recorded' && r0.game === 'valorant' && r0.mode === 'auto' && r0.res === '720' && r0.encoderOk === true && r0.minutes > 0
      && r0.version === appVersion && Object.keys(r0).length === 10, `the session's counts posted, the ten fields: ${JSON.stringify(r0)}`);
    ok(await until(() => store.get('recordingReportPending') === null, 4000), 'kept until the server took them, then let go');
    ok(log && !log.isDestroyed() && !log.isContentProtected(), 'with recording stopped, the AI log is back in captures');
    if (log && !log.isDestroyed()) log.destroy();
    const after1 = await capture.captureScreenshot('standard');
    ok(capture.source() === 'gdi' && after1 === grey, 'and the read is back on the GDI helper');

    // 3. Forced busy, in a match.
    process.env.OCCLARA_DEV_RECORDER_MIN_FPS = '1000';
    process.env.OCCLARA_DEV_RECORDER_BUSY_MS = '3000';
    send(C.COACH_START);
    const b = latest();
    if (!ok(b instanceof StandInValorant && b !== v, 'recording again')) return report();
    const servedB = await until(async () => { await b.capture(); return capture.source() === 'stream'; }, 15000);
    ok(servedB, 'served from the stream again');
    // Start pressed and no read landed yet (the server down, the credits
    // out): not a menu, so the seal's test says a match is in progress and
    // the window seals, out of the recording. The recorder does not judge it.
    b.inLobby = false;
    const shell = await invoke(C.SHELL_GET);
    ok(shell.sealed && mainWindow.get().isContentProtected(), 'a match in progress: the main window sealed, and out of the recording');
    const judgedEarly = await until(async () => {
      const st = await invoke(C.STATE_GET);
      return st.notice && st.notice.text === BUSY_TEXT ? true : null;
    }, 6000);
    ok(!judgedEarly && recorderModule.current().state === 'recording',
      'no read landed yet: 6 s at a floor of 1000 frames a second, and never judged, still recording');
    // Its first reads land, a round is filed: judged.
    b.rounds = 1;
    b.analyzedFrames = 5;
    const t0 = Date.now();
    const noticed = await until(async () => {
      const st = await invoke(C.STATE_GET);
      return st.notice && st.notice.text === BUSY_TEXT ? st.notice : null;
    }, 20000);
    ok(noticed && noticed.kind === 'recorder', `busy for 3 s in a match: the notice, in the spec's words, ${((Date.now() - t0) / 1000).toFixed(1)} s later`);
    // A stop is waited on for up to 10 s (recorder.js STOP_TIMEOUT_MS): the
    // page hands over its last chunks first. Waited 8, a slow one read as lost.
    ok(await until(() => !recWin(), STOP_WAIT_MS), 'the recording stopped for the session: its page gone');
    const readsB = [];
    for (let i = 0; i < 3; i++) { const shot = await b.capture(); readsB.push(capture.source() === 'gdi' && shot === grey); await wait(300); }
    ok(readsB.every(Boolean), 'and the reads go on, from the GDI helper (the grey frame), at once');
    ok((store.get('recordingStrikes') || []).length === 1 && store.get('recordingMode') === 'auto', 'one busy session kept, Auto still on');
    send(C.COACH_STOP);
    const rB = await until(() => reportsTo()[2], 6000);
    ok(rB && rB.outcome === 'busy', `the session's counts say busy: ${JSON.stringify(rB)}`);
    const unsealed = await invoke(C.SHELL_GET);
    ok(!unsealed.sealed && !mainWindow.get().isContentProtected(), 'stopped: the seal lifts, and the main window is back in captures');

    // 4. The capture cannot see this game.
    delete process.env.OCCLARA_DEV_RECORDER_MIN_FPS;
    delete process.env.OCCLARA_DEV_RECORDER_BUSY_MS;
    process.env.OCCLARA_FAKE_CAPTURE = 'black';
    send(C.COACH_START);
    const k = latest();
    const t1 = Date.now();
    const blackNotice = await until(async () => {
      const st = await invoke(C.STATE_GET);
      return st.notice && st.notice.text === BLACK_TEXT ? st.notice : null;
    }, 25000);
    ok(blackNotice, `the stream black twice against a grey GDI frame: the Windowed Fullscreen notice, ${((Date.now() - t1) / 1000).toFixed(1)} s after Start`);
    ok(await until(() => !recWin(), STOP_WAIT_MS), 'recording stopped for the session');
    const shotK = await k.capture();
    ok(capture.source() === 'gdi' && shotK === grey, 'the reads stayed on the GDI helper');
    send(C.COACH_STOP);
    const rK = await until(() => reportsTo()[3], 6000);
    ok(rK && rK.outcome === 'black', `the session's counts say black: ${JSON.stringify(rK)}`);

    // What the log said about the track: the canvas keeps its own shape.
    let logText = '';
    try { logText = fs.readFileSync(path.join(ud, 'debug.log'), 'utf8'); } catch { /* said below */ }
    const shape = /\[recorder\] recording (\d+)x(\d+) of a 1920x1080 display \(its own shape\)/.exec(logText);
    ok(shape && shape[1] === '1280' && shape[2] === '720', `the track came back ${shape ? shape[1] + 'x' + shape[2] : 'unknown'}, the display's own shape`);
    // And the bitrate MediaRecorder took beside the one asked (8.4.1).
    const TOOK = /\[recorder\] recording \d+x\d+ of a [^\n]*; the track's own settings [^\n,]+, MediaRecorder at ([\d.]+) Mbps/;
    const tookSample = TOOK.test("[recorder] recording 1280x720 of a 1920x1080 display (its own shape), asked 1280x720 at up to 60 fps, recorded at up to 30, 3 Mbps, x; the track's own settings 60 fps, MediaRecorder at 3 Mbps")
      && !TOOK.test("[recorder] recording 1280x720 of a 1920x1080 display (its own shape), asked 1280x720 at up to 60 fps, recorded at up to 30, 3 Mbps, x; the track's own settings 60 fps, MediaRecorder at a bitrate it did not say");
    const took = TOOK.exec(logText);
    ok(tookSample && took && Number(took[1]) > 0, `the start line says the bitrate MediaRecorder took: ${took ? took[1] + ' Mbps, 3 asked' : 'not said'}`);
    ok(cpu.length >= 5, `measured while recording: the recorder page's CPU p50 ${r1(quantile(cpu, 0.5))}%, p90 ${r1(quantile(cpu, 0.9))}% of one core;`
      + ` its private memory ${mem[0]} MB at first, ${mem[mem.length - 1]} MB after ${mem.length} s;`
      + ` a read's frame from the stream p50 ${quantile(reads.map((x) => x.ms), 0.5)} ms, p90 ${quantile(reads.map((x) => x.ms), 0.9)} ms`);
    // 4b. The primary display changes while recording (8.4.2): the recording
    // stops and a new page records the new primary one, its thirty a second
    // built again with it, the old one ending with every chunk on disk and
    // nothing open. The generated picture has no display of its own, so the
    // recording is told it opened on another.
    process.env.OCCLARA_FAKE_CAPTURE = 'busy';
    send(C.COACH_START);
    const onSeg = () => { const r = recorderModule.current(); return r.state === 'recording' && r.seg && r.seg.pages.length ? r.seg : null; };
    const segA = await until(onSeg, 15000);
    const winA = recWin();
    await wait(2500);
    let moved = false;
    if (segA) { segA.displayId = 'the display it opened on'; moved = recorderModule.current().displaysChanged(screen.getPrimaryDisplay().id); }
    const segB = await until(() => { const g = onSeg(); return g && g !== segA ? g : null; }, 15000);
    const dirA = segA ? onDisk().find((d) => path.join(ROOT, d.name) === segA.dir) : null;
    const bytesA = dirA && dirA.init ? dirA.init.length + dirA.pages.reduce((n, p) => n + p.bytes.length, 0) : 0;
    ok(moved && segB && winA && winA.isDestroyed() && recWin() && recWin() !== winA,
      'the primary display changed while recording: the old page stopped and closed, and a new page records');
    ok(segA && !segA.active && segA.pageChunks > 0 && segA.chunks === segA.pageChunks && segA.reader.bytes === bytesA && segA.pageFramesOpen === 0 && segA.pageTracksLive === 0,
      `the old recording ended with all ${segA ? segA.chunks : '?'} chunks and ${bytesA} bytes on disk, ${segA ? segA.pageFramesOpen : '?'} frames left open, ${segA ? segA.pageTracksLive : '?'} tracks live`);
    await wait(4500);
    const hB = recorderModule.current().health;
    ok(hB && hB.recordedFps <= RECORD_FPS + 2 && hB.recordedFps >= RECORD_FPS - 6 && hB.fps >= FAKE_FPS * 0.75 && hB.framesOpen <= 2,
      `and the new one records ${hB && hB.recordedFps} a second of the ${hB && hB.fps} delivered, ${hB && hB.framesOpen} frames open: built again`);
    send(C.COACH_STOP);
    ok(await until(() => !recWin(), STOP_WAIT_MS), 'stopped: its page gone too');

    // 5. The displays changing reach the recorder, with the primary
    // display's id (index.js follows screen's three events).
    process.env.OCCLARA_FAKE_CAPTURE = '1';
    const recNow = recorderModule.current();
    const told = [];
    const displaysChanged = recNow.displaysChanged.bind(recNow);
    recNow.displaysChanged = (id) => { told.push(id); return displaysChanged(id); };
    for (const ev of ['display-added', 'display-removed', 'display-metrics-changed']) screen.emit(ev, {}, screen.getPrimaryDisplay(), ['bounds']);
    recNow.displaysChanged = displaysChanged;
    const primaryId = screen.getPrimaryDisplay().id;
    ok(told.length === 3 && told.every((id) => id === primaryId), `a display added, removed or changed: the recorder told the primary display's id each time (${told.join(', ')})`);

    // Windows ends its session (a shutdown, a restart, a logoff) with a
    // recording on disk and one being made: all of it ends in the call.
    ok(onDisk().some((d) => d.pages.length), 'the first recording is still on disk (under two minutes old)');
    send(C.COACH_START);
    const ending = latest();
    const writing = () => { const r = recorderModule.current(); return r.state === 'recording' && r.seg && r.seg.pages.length ? true : null; };
    const recording = await until(writing, 15000);
    aiLogWindow.open();
    const log2 = await until(() => { const w = registry.get('ailog'); return w && w.isVisible() ? w : null; }, 6000);
    ok(recording && ending instanceof StandInValorant && log2 && log2.isContentProtected(), 'recording again, the AI log out of the recording');
    await wait(1500);
    const sentBefore = reportsTo().length;
    mainWindow.get().emit('session-end');
    // Nothing awaited: Windows can end the process as soon as the handler returns.
    const rS = recorderModule.current();
    const pendingNow = store.get('recordingReportPending');
    ok(rS.state === 'idle' && !rS.segments.length && !onDisk().length, `Windows ending its session: every recording deleted in the call (${onDisk().map((d) => d.name).join(', ') || 'nothing left'})`);
    // Kept and NOT posted: the process ends next, and a post raced with that
    // can reach the server and lose its answer, so the next launch (step 1)
    // would send the same session again.
    ok(pendingNow && pendingNow.block && pendingNow.block.outcome === 'recorded' && pendingNow.block.game === 'valorant' && reportsTo().length === sentBefore,
      `its counts kept for the next launch, and none posted into the exit: ${JSON.stringify(pendingNow && pendingNow.block)}`);
    ok(log2 && !log2.isDestroyed() && !log2.isContentProtected(), 'and the AI log back in captures');
    if (log2 && !log2.isDestroyed()) log2.destroy();
    ok(await until(() => !recWin(), STOP_WAIT_MS), 'the recorder page gone');
    const keptS = store.get('recordingReportPending');
    ok(reportsTo().length === sentBefore && keptS && pendingNow && keptS.at === pendingNow.at && keptS.n === pendingNow.n,
      `and its counts still only kept once the recorder is done (${reportsTo().length - sentBefore} posted)`);
    send(C.COACH_STOP);

    // 6. A quit that is not the tray's: an update's "Restart now" (updater.js
    // quitAndInstall) quits with no cleanupAndQuit, and before-quit is all
    // there is. The recording ends in that call as at any quit.
    send(C.COACH_START);
    ok(await until(writing, 15000) && onDisk().some((d) => d.pages.length), 'recording again, a page of it on disk');
    await wait(1500);
    const sentBeforeUpdate = reportsTo().length;
    app.emit('before-quit', { preventDefault() {} });
    const rU = recorderModule.current();
    const keptU = store.get('recordingReportPending');
    ok(rU.state === 'idle' && !rU.segments.length && !onDisk().length && keptU && keptU.block && keptU.block.outcome === 'recorded'
      && keptS && keptU.at !== keptS.at && reportsTo().length === sentBeforeUpdate,
    `an update's restart (before-quit alone): every recording deleted in the call, its session's counts kept for the next launch, none posted: ${JSON.stringify(keptU && keptU.block)}`);
    ok(await until(() => !recWin(), STOP_WAIT_MS), 'and its recorder page gone');
    send(C.COACH_STOP);

    // 7. Quitting as the tray does, mid recording: the parent looks once the
    // app has gone, at the disk, at what the stand in was sent and at what
    // the config kept for the next launch.
    send(C.COACH_START);
    ok(await until(writing, 15000) && onDisk().some((d) => d.pages.length), 'recording again before the quit, a page of it on disk');
    await wait(1500);
    reportsBeforeQuit = reportsTo().length;
    pendingBeforeQuit = (store.get('recordingReportPending') || {}).at || null;
    quitAfterReport = true;
    report(null);
  } catch (e) {
    report('threw: ' + ((e && e.stack) || e));
  }
}, 6500);

require(INDEX);
