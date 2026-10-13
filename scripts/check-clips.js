'use strict';

/**
 * The clips of a review's moments (8.3), booted for real: the real index.js,
 * its recorder recording, the look from the screen cutting a clip out of the
 * recording and keeping it beside the review, the occlara-clip scheme serving
 * it by range, and the review page playing it in "Where you died, and how".
 *
 * NEVER THE DESKTOP. Three clips, none of a screen:
 *   1. one cut live by the real recorder, recording frames its page draws
 *      itself (OCCLARA_FAKE_CAPTURE=1, as check:recorder), out of the match
 *      the stand in engine ends
 *   2. one cut from scripts/fixtures/recording-canvas.mkv (Chromium's own
 *      recording of a canvas, make-recording-fixture.js), seeded beside a
 *      saved review, so its length and its frames are known exactly
 *   3. one cut live, the same way, out of a League game
 *
 * Held here:
 *   the live one: a death the screen saw 13 s into the recording; the look
 *     (a stand in answers the server's part) cuts its clip, 11 s before the
 *     death to 4 s after, while the match's recording is still held, saves it
 *     beside the review as r2-clip.mkv and names it on the card, and the
 *     review on screen repaints with it, nothing of it loaded yet
 *   and the look sees the recording (8.3.1): it is sent five stills of that
 *     clip, decoded in the frames page, 1280x720, at the screen's seconds
 *     before its read of the death, kept beside the review, never the grey
 *     frames the AI log holds; each still the clip's own frame at its second
 *     (a <video> seeked there, once nothing records), not one a second either
 *     side; and with Off chosen, the look is sent the AI log's two frames
 *   Clear clips while that review is still being improved: its clip goes, the
 *     version saved after (the link giving up) still says it was cleared, the
 *     page says so with its frames kept, and the hold is let go once the
 *     review's work is done
 *   Off chosen, written to the config with the recorder not told (its own
 *     guard lets go of what it holds when it is): the next match is looked at
 *     and no clip is cut of it, nor of a League game that ends then, though
 *     the recording holds both deaths (index.js cutLookClips, clipLolDeaths),
 *     and a clip an earlier look kept of that match goes
 *   the seeded one: its moment paints a <video> from occlara-clip, its frame
 *     the poster; played from the page's button it loads with the clip's own
 *     length and advances, a click on the picture pauses it, and a seek
 *     presents the frame at that time (requestVideoFrameCallback)
 *   the scheme, through net.fetch: a range is 206 with its Content-Range and
 *     video/x-matroska, the bytes those of the file; a frame, a clip not
 *     there, an id that is not a review's are 404
 *   a League session is recorded too, and a death the game stamps at 0:13 of
 *     its own clock is found in the recording by the polls' wall clock, cut
 *     11 s before to 4 s after as d1-clip.mkv, named in the review's deaths,
 *     its hold let go; "Your deaths" on screen repaints with it, and it plays
 *   Clear clips from Settings' channel: every clip goes, the review on screen
 *     says so, and each saved review does
 *   a recording looked at in rounds 2, 14, 17 and 19, a clip of each, graded
 *     from Riot's record by the real backfill (its save in index.js), Riot
 *     saying round 17's death never happened: the clips its cards name stay,
 *     and round 17's goes with its look
 *
 * NOTHING PLAYS WHILE THE CHECK RECORDS. The generated frames are drawn on a
 * canvas in the recorder's hidden page, and measured here that alone held the
 * GPU process at 50 to 80% of a core (the spike measured the whole app at
 * about 21% of one capturing the real screen in full motion). With a clip
 * seeked in the review page the recorder page froze for 4 to 19 s in 10 of 12
 * runs, and in none of 4 without one. So the recording is stopped before any
 * clip plays. A player who watches a clip between matches while recording is
 * the game test's to measure.
 *
 * The engine that would call the server is a stand in that hands the AI log
 * the frames of one death, as the real one writes them; League's recorder is
 * a stand in that hands over a game's record at its end; the api client is a
 * stand in that answers the look and keeps nothing. No model, no network, no
 * screen.
 *
 * Results travel through a FILE, not stdout: an Electron main process on
 * Windows does not reliably flush a piped stdout.
 *
 * Run: npm run check:clips
 */

const path = require('path');
const fs = require('fs');
const os = require('os');

const REPO = path.join(__dirname, '..');
const OUT = path.join(os.tmpdir(), 'occlara-clips-check.json');
const INDEX = path.join(REPO, 'src', 'main', 'index.js');
const FIXTURE = path.join(__dirname, 'fixtures', 'recording-canvas.mkv');

if (!process.versions.electron) {
  const { spawnSync } = require('child_process');
  const electron = require('electron');
  try { fs.unlinkSync(OUT); } catch { /* nothing to clear */ }
  const env = Object.assign({}, process.env, {
    OCCLARA_CLIPS_OUT: OUT,
    OCCLARA_FAKE_CAPTURE: '1',
    // The link's tries take about eight seconds with no match to find, so the
    // review is still being improved while its clip is cleared, and its work
    // is done (its recording let go) within the check.
    OCCLARA_DEV_LINK_SCALE: '0.01',
  });
  delete env.OCCLARA_DEV_RECORDER_MIN_FPS;
  delete env.OCCLARA_DEV_RECORDER_BUSY_MS;
  delete env.OCCLARA_DEV_RECORDER_PAGE_MS;
  // This shell exports ELECTRON_RUN_AS_NODE=1, which makes the Electron binary
  // run as plain node and the app dies with a misleading error.
  delete env.ELECTRON_RUN_AS_NODE;
  const r = spawnSync(electron, [__filename], { env, timeout: 240000 });
  let rec = null;
  try { rec = JSON.parse(fs.readFileSync(OUT, 'utf8')); } catch { /* reported below */ }
  if (!rec) { console.error('FAIL: the check wrote no result (exit ' + r.status + ')'); process.exit(1); }
  for (const l of rec.lines) console.log((l.ok ? 'ok    ' : 'FAIL  ') + l.what);
  if (rec.fatal) console.log('FAIL  ' + rec.fatal);
  const bad = rec.lines.filter((l) => !l.ok).length + (rec.fatal ? 1 : 0);
  if (bad) { console.error(`\nFAIL: ${bad} of ${rec.lines.length} clip checks failed`); process.exit(1); }
  console.log(`\nPASS: all ${rec.lines.length} checks: a death recorded live is clipped beside its review while its recording is held, a clip cleared stays said to be, nothing is clipped once Off is chosen, a review's moment plays its clip through occlara-clip and seeks to its frame, a League death is clipped by the game's own clock and plays, and a late link keeps only the clips its cards name`);
  process.exit(0);
}

const Module = require('module');
const { EventEmitter } = require('events');
const { app, ipcMain, nativeImage, net } = require('electron');
require('./fixtures/electron-version');
const C = require(path.join(REPO, 'src/shared/channels'));
const webm = require(path.join(REPO, 'src/shared/webm'));
const clipsModule = require(path.join(REPO, 'src/shared/clips'));
const valorantReview = require(path.join(REPO, 'src/shared/valorant-review'));
const recorderModule = require(path.join(REPO, 'src/main/services/recorder'));
const { ReviewStore, newId } = require(path.join(REPO, 'src/main/services/review-store'));
const surfaces = require('./fixtures/surfaces');
const { replay, load } = require('./fixtures/replay-match');
const played = replay(load('valorant-match-abyss-13-11.json').frames, 'standard');

const lines = [];
const ok = (cond, what) => { lines.push({ ok: !!cond, what }); return !!cond; };
let reported = false;
function report(fatal) {
  if (reported) return;
  reported = true;
  try { fs.writeFileSync(process.env.OCCLARA_CLIPS_OUT || OUT, JSON.stringify({ lines, fatal: fatal || null })); }
  catch { /* exit code still carries it */ }
  app.exit(fatal || lines.some((l) => !l.ok) ? 1 : 0);
}

// ── The engines and the network, as stand ins ──────────────────────────────
const engines = [];
// League's recorder, standing in for the one that polls the game client: it
// is live while the check says a game is on, and hands over the record a game
// leaves, as the real one does at its end.
class StandInLol extends EventEmitter {
  constructor() {
    super();
    this.live = false;
    this.liveSince = null;
    engines.push(this);
  }
  start() { this.emit('status', { running: true, watching: true, game: 'lol' }); }
  stop() { this.live = false; }
}
class StandInValorant extends EventEmitter {
  constructor(opts) {
    super();
    this.capture = opts.captureFunction;
    this.diagnostics = opts.diagnostics;
    this.endWatch = { ended: false };
    this.rounds = 0;
    this.ledger = { size: () => this.rounds, current: () => 2 };
    this.inLobby = true;
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
// The account graded from Riot's record in step 5, and its one match, answered
// only once that step begins: before it, every review's link finds nothing.
let graded = null;
// Every look sent, as the server would read it.
const looksSent = [];
const stubApi = {
  post: async (p, body) => {
    // The look at a death: one cause for each death it is sent.
    if (body && Array.isArray(body.deaths)) {
      looksSent.push(body);
      return { ok: true, status: 200, data: { deaths: body.deaths.map((d) => ({ n: d.n, cause: 'isolated', what: 'You held the site alone.', better: 'Hold it with a teammate.' })) } };
    }
    return { ok: true, status: 200, data: {} };
  },
  get: async (p) => {
    if (graded && p.startsWith('/api/coach/recent-matches')) return { ok: true, status: 200, data: { matches: [graded.row] } };
    if (graded && p.startsWith('/api/coach/match-rounds') && p.includes(`matchId=${graded.row.matchId}&`)) return { ok: true, status: 200, data: graded.riot };
    return { ok: false, status: 0, data: {} };
  },
};
const same = (a, b) => path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();
const realLoad = Module._load;
Module._load = function patched(request, parent, isMain) {
  if (parent && parent.filename && same(parent.filename, INDEX)) {
    if (request === './services/coaching-engine') return StandInValorant;
    if (request === './services/api-client') return stubApi;
    // The real wallAt, beside the stand in recorder.
    if (request === './services/lol-recorder') return { ...realLoad(request, parent, isMain), LolRecorder: StandInLol };
  }
  return realLoad(request, parent, isMain);
};

// ── A throwaway profile ─────────────────────────────────────────────────────
const ud = path.join(os.tmpdir(), 'occlara-check-clips');
fs.rmSync(ud, { recursive: true, force: true });
fs.mkdirSync(ud, { recursive: true });
fs.writeFileSync(path.join(ud, 'occlara-config.json'), JSON.stringify({
  game: 'valorant', onboardingCompleted: true, licenseKey: 'CHECK-CLIPS', language: 'en', riotId: '',
  recordingMode: 'auto', recordingRes: '720', aiLog: true, clipCapGB: 10,
}, null, 2));
const REVIEWS = path.join(ud, 'reviews');
const fixture = webm.indexFile(FIXTURE, { keepBytes: true });
const SEED_FROM = 2000;
const SEED_TO = 8000;
const seedPlan = webm.planClip(fixture.clusters, SEED_FROM, SEED_TO);
const seedClip = webm.cutClip({ init: fixture.init, clusters: fixture.clusters, from: SEED_FROM, to: SEED_TO });
const SEED_AT = Date.now() - 3 * 3600000;
const SEED_ID = newId('valorant', SEED_AT);
// 15 s asked, in whole Clusters of up to a second and a half each side.
const CLIP_MAX_S = 18.5;
// How long after a League game's end its deaths are cut (index.js LOL_CLIP_SETTLE_MS).
const LOL_SETTLE_MS = 6000;

/**
 * In a page, serialized into executeJavaScript: each still against the clip's
 * own frame at its second, and the frames a second before and after it, drawn
 * at the stills' size. The mean difference of each, of 255.
 */
async function stillsAgainstClip(job) {
  const fromB64 = (s) => { const bin = atob(s); const out = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i); return out; };
  const W = 1280;
  const H = 720;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d', { willReadFrequently: true });
  const px = () => g.getImageData(0, 0, W, H).data;
  const wait = (v, name, ms) => new Promise((resolve) => {
    const t = setTimeout(() => { v.removeEventListener(name, on); resolve(false); }, ms);
    const on = () => { clearTimeout(t); v.removeEventListener(name, on); resolve(true); };
    v.addEventListener(name, on);
  });
  const v = document.createElement('video');
  v.muted = true;
  v.preload = 'auto';
  document.body.appendChild(v);
  const url = URL.createObjectURL(new Blob([fromB64(job.clip)], { type: 'video/x-matroska' }));
  const loaded = wait(v, 'loadeddata', 8000);
  v.src = url;
  if (!(await loaded)) return { error: 'the clip did not load' };
  // The canvas is cleared before each frame of the clip is drawn on it, so a
  // video with no frame to draw compares as black, never as the still that
  // was drawn there a moment before.
  const frameAt = async (t) => {
    const s = wait(v, 'seeked', 5000);
    v.currentTime = Math.max(0, t);
    await s;
    g.fillStyle = '#000';
    g.fillRect(0, 0, W, H);
    g.drawImage(v, 0, 0, W, H);
    return px();
  };
  const diff = (a, b) => {
    let d = 0;
    for (let i = 0; i < a.length; i += 4) d += Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]);
    return Math.round((d / ((a.length / 4) * 3)) * 100) / 100;
  };
  // ONE SEEK FIRST, NOT MEASURED. The first seek after the clip loaded drew a
  // frame of 92 against the still in one run of three, where the frames a
  // second either side of it were 24.75 and 23.64 as in the runs it passed:
  // the still was the clip's frame and the element had not presented it yet.
  await frameAt(0.5);
  const out = [];
  for (const s of job.stills) {
    const bmp = await createImageBitmap(new Blob([fromB64(s.jpeg)], { type: 'image/jpeg' }));
    g.drawImage(bmp, 0, 0, W, H);
    const still = px();
    // Five ms into the frame: a still's second is its frame's own, to the
    // hundredth. Seeked again once when it does not match, since a paused
    // element in a page nobody sees presents a seek's frame when it pleases;
    // a still that is another frame matches on neither.
    let own = diff(still, await frameAt(s.t + 0.005));
    if (own >= 4) own = diff(still, await frameAt(s.t + 0.005));
    const early = diff(still, await frameAt(s.t - 1 + 0.005));
    const late = diff(still, await frameAt(s.t + 1 + 0.005));
    out.push({ at: s.at, own, early, late });
  }
  URL.revokeObjectURL(url);
  return { out };
}

setTimeout(async () => {
  const registry = require(path.join(REPO, 'src/main/windows/registry'));
  const mainWindow = require(path.join(REPO, 'src/main/windows/main-window'));
  const capture = require(path.join(REPO, 'src/main/services/capture'));
  const store = require(path.join(REPO, 'src/main/services/store'));
  const invoke = (ch, ...args) => ipcMain._invokeHandlers.get(ch)({}, ...args);
  const send = (ch, ...args) => ipcMain.emit(ch, { sender: null }, ...args);
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  async function until(fn, ms, every) {
    const end = Date.now() + ms;
    for (;;) {
      let v = null;
      try { v = await fn(); } catch { v = null; }
      if (v) return v;
      if (Date.now() > end) return null;
      await wait(every || 150);
    }
  }
  const inPage = (code) => {
    const w = surfaces.find('/review/');
    return w ? w.webContents.executeJavaScript(code, true) : Promise.resolve(null);
  };
  /** The player in one moment (#moment-2, #death-1) as the page painted it, before anything is played. */
  const playerOf = (box) => inPage(`(() => {
    const v = document.querySelector('${box} video.v-clip-video');
    return v ? { src: v.getAttribute('src'), poster: v.getAttribute('poster'), preload: v.getAttribute('preload'), muted: v.muted,
      loop: v.loop, inline: v.playsInline, readyState: v.readyState } : null;
  })()`);
  /**
   * The moment's player played, paused and seeked, as a player would: scrolled
   * to first (out of view, the page pauses it), played from its button, a
   * click on the picture, then a seek with the frame it presents.
   */
  const playIn = (box, seekTo) => inPage(`(async () => {
    const v = document.querySelector('${box} video.v-clip-video');
    if (!v) return { found: false };
    document.querySelector('${box}').scrollIntoView({ block: 'center' });
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    await new Promise((r) => setTimeout(r, 300));
    const wait = (name, ms) => new Promise((res) => {
      let t = null;
      const on = () => { clearTimeout(t); v.removeEventListener(name, on); res(true); };
      v.addEventListener(name, on);
      t = setTimeout(() => { v.removeEventListener(name, on); res(false); }, ms);
    });
    const fig = document.querySelector('${box} .v-clip');
    const btn = document.querySelector('${box} .v-clip-play');
    const out = { found: true };
    const playing = wait('playing', 8000);
    btn.click();
    out.playing = await playing;
    const t0 = v.currentTime;
    await new Promise((r) => setTimeout(r, 1500));
    out.advanced = Math.round((v.currentTime - t0) * 1000) / 1000;
    out.duration = v.duration;
    out.error = v.error ? v.error.code + ' ' + v.error.message : null;
    out.figPlaying = fig.classList.contains('playing');
    out.label = btn.getAttribute('aria-label');
    v.click();
    await new Promise((r) => setTimeout(r, 200));
    out.paused = v.paused;
    out.figPaused = !fig.classList.contains('playing');
    const frame = new Promise((res) => {
      if (typeof v.requestVideoFrameCallback !== 'function') { res(null); return; }
      const t = setTimeout(() => res(null), 6000);
      v.requestVideoFrameCallback((_now, meta) => { clearTimeout(t); res(meta.mediaTime); });
    });
    const seeked = wait('seeked', 8000);
    v.currentTime = ${Number(seekTo)};
    out.seeked = await seeked;
    out.mediaTime = await frame;
    out.currentTime = v.currentTime;
    return out;
  })()`);
  /** A recording in progress, once its page has handed over its first frames. */
  const recording = () => until(() => {
    const r = recorderModule.current();
    return r && r.state === 'recording' && r.seg && r.seg.zero() !== null ? r : null;
  }, 20000);
  /** How long a clip on disk runs, read back off its own Clusters. */
  const lengthOf = (file) => {
    const rd = webm.createReader();
    rd.push(fs.readFileSync(file));
    rd.end();
    const cs = rd.clusters;
    return { rd, cs, len: cs.length ? (cs[cs.length - 1].last - cs[0].first) / 1000 : 0, frames: cs.reduce((n, c) => n + c.frames, 0) };
  };

  try {
    const win = mainWindow.create();
    win.show();

    // ── 1. A death recorded live, clipped by the look ──────────────────────
    send(C.COACH_START);
    const v = engines[engines.length - 1];
    if (!ok(v instanceof StandInValorant && (await invoke(C.STATE_GET)).isCoaching, 'Valorant starts recording')) return report();
    const rec = await recording();
    if (!ok(rec, 'the recorder records the frames its page draws')) return report();
    // Every cut asked of the recorder, counted, so a step can say none was.
    const cuts = [];
    const realCut = rec.cutClip;
    rec.cutClip = function counted(...args) { cuts.push(args[2]); return realCut.apply(this, args); };
    const zero = rec.seg.zero();
    // The AI log's frames of one death, as the engine writes them: the frame
    // before it, 12 s into the recording, and the one the screen registered
    // it on, a second later. The grey GDI frame stands in for the picture.
    const grey = await capture.captureGdi('standard');
    v.inLobby = false;
    v.rounds = 2;
    const died = zero + 13000;
    v.diagnostics({ at: died - 1000, image: grey, state: { phase: 'active', playerAlive: true }, died: false, round: 2, match: v.matchStartedAt });
    v.diagnostics({ at: died, image: grey, state: { phase: 'active', playerAlive: false }, died: true, round: 2, match: v.matchStartedAt });
    // The recording runs past 4 s after the death, and two chunks more.
    await until(() => Date.now() > died + 7500, 30000);
    const snap = { rounds: played.rounds.map((r) => ({ ...r })), tips: [], notes: [], context: { ...played.context, agent: 'Jett', language: 'en' },
      startedAt: v.matchStartedAt - 1000, endedAt: Date.now(), endedBy: 'score' };
    v.endWatch.ended = true;
    v.inLobby = true;
    v.emit('match-ended', snap);
    const holdsAtEnd = rec.holds.length;
    v.emit('match-review', 'A read.', { ...snap, ai: { summary: 'The coach read the match.', rounds: {}, focus: null } });
    const liveId = await until(() => {
      const rows = new ReviewStore(REVIEWS).list('valorant');
      return rows[0] ? rows[0].id : null;
    }, 8000);
    if (!ok(liveId, 'the match ended: its review is saved')) return report();
    const clipFile = path.join(REVIEWS, liveId, 'r2-clip.mkv');
    const kept = await until(() => fs.existsSync(clipFile) && fs.statSync(clipFile).size > 0, 15000, 20);
    // Cut while the match's recording was still held: the link gives up
    // seconds after the look, and only then is the hold let go.
    const heldAtClip = recorderModule.current().holds.length;
    const savedRound = () => {
      const e = new ReviewStore(REVIEWS).get(liveId);
      return e && (e.review.rounds || []).find((c) => c.n === 2);
    };
    const named = await until(() => { const c = savedRound(); return c && c.forensics && c.forensics.clip === 'r2-clip.mkv' ? c : null; }, 10000);
    ok(kept && named, `the look's clip is kept beside the review as r2-clip.mkv and named on round 2's card (${kept ? fs.statSync(clipFile).size : 0} bytes)`);
    if (kept) {
      const { rd, cs, len, frames } = lengthOf(clipFile);
      const head = webm.parseInit(rd.init || Buffer.alloc(0));
      ok(!rd.error && cs.length >= 10 && cs[0].timecode === 0 && cs.every((c) => c.keyframe === true) && head && head.info.some((k) => k.id === 0x4489),
        `it reads as a clip: ${cs.length} Clusters from 0, each on a keyframe, with a Duration${rd.error ? ': ' + rd.error : ''}`);
      // 11 s before the death (the recording began 13 s before it) to 4 s
      // after, in whole Clusters: it opens on the keyframe at or before its
      // first second and runs to the end of the Cluster its last second is
      // in. A Cluster is about a second, and measured up to a second and a
      // half when frames came unevenly, so 15 s comes out 15 to 18.
      ok(len >= 14 && len <= CLIP_MAX_S, `the seconds asked for, 11 before the death to 4 after it: ${len.toFixed(2)} s, ${frames} frames (${Math.round(frames / Math.max(1, len))} a second)`);
    }
    ok(holdsAtEnd === 1 && heldAtClip === 1, `the match's recording was held from its end, and still was when its clip was cut (${holdsAtEnd}, then ${heldAtClip} hold)`);

    // ── 1a. The look saw the recording (8.3.1) ─────────────────────────────
    // The clip was cut before the look was sent, and the look sent stills of
    // it, decoded in the frames page, at the screen's seconds before its read
    // of the death, never the two grey frames the AI log holds.
    const sentLive = looksSent.find((b) => b.source === 'screen' && b.deaths.some((d) => d.n === 2 && d.framesFrom === 'recording')) || null;
    const d2 = sentLive && sentLive.deaths.find((d) => d.n === 2);
    const asked = clipsModule.LOOK_AT.screen;
    const inTime = d2 && Array.isArray(d2.frameAt) ? d2.frameAt.map((at, i) => ({ at, jpeg: d2.frames[i] })).sort((a, b) => a.at - b.at) : [];
    const sizes = inTime.map((s) => nativeImage.createFromBuffer(Buffer.from(s.jpeg, 'base64')).getSize());
    ok(d2 && inTime.length === 5 && inTime.every((s, k) => s.at <= asked[k] + 0.006 && asked[k] - s.at < 0.1)
      && sizes.every((z) => z.width === 1280 && z.height === 720),
    `the look was sent five stills of the clip from the recording, the frame on screen at each of ${asked.join(', ')} s from the screen's read of the death: ${inTime.map((s) => s.at).join(', ')} s, each 1280x720`);
    ok(d2 && sentLive.deaths.length === 1 && d2.frames.length === 5 && !d2.frames.includes(grey),
      'and not the grey frames the AI log holds of it');
    const stillNames = inTime.map((s, k) => clipsModule.stillName(2, k + 1, s.at));
    const keptStills = stillNames.map((n) => new ReviewStore(REVIEWS).frame(liveId, n));
    ok(keptStills.every((b, k) => b && b === inTime[k].jpeg),
      `each kept beside the review as the library keeps frames (${stillNames.join(', ')})`);
    // What the stills are checked against, once nothing records any more: the
    // clip itself and where its own 0 is on the wall clock.
    const seg = rec.segments.find((g) => g.zero() !== null && g.clusters().length) || rec.seg;
    const segZero = seg.zero();
    const segPlan = webm.planClip(seg.clusters(), died - 11000 - segZero, died + 4000 - segZero);
    const stillCheck = kept && segPlan ? {
      clip: fs.readFileSync(clipFile).toString('base64'),
      stills: inTime.map((s) => ({ t: (died + s.at * 1000 - (segZero + segPlan.start)) / 1000, at: s.at, jpeg: s.jpeg })),
    } : null;
    const livePlayer = await until(async () => {
      const p = await playerOf('#moment-2');
      return p && p.src && p.src.includes(liveId) ? p : null;
    }, 15000);
    ok(livePlayer && livePlayer.src === `occlara-clip://review/${liveId}/r2-clip.mkv` && livePlayer.poster && livePlayer.poster.startsWith('data:image/jpeg;base64,'),
      `the review on screen repainted with the clip in its moment, its frame the poster (${livePlayer && livePlayer.src})`);
    // Nothing loaded until it is played, here while the next match is recorded.
    ok(livePlayer && livePlayer.preload === 'none' && livePlayer.readyState === 0, `and nothing of it loaded yet (preload ${livePlayer && livePlayer.preload}, readyState ${livePlayer && livePlayer.readyState})`);
    // Its five stills under it, each labelled by its seconds from the screen's
    // read of the death: the card keeps every frame the look was sent, with
    // frameAt (valorant-review.js lookFrames), where it kept two.
    const liveShots = await inPage(`(() => [...document.querySelectorAll('#moment-2 .v-shot')]
      .map((s) => (s.querySelector('img') ? s.querySelector('figcaption').textContent : null)))()`);
    ok(Array.isArray(liveShots) && liveShots.length === 5 && liveShots.every(Boolean) && liveShots[0] === '4.5 s before'
      && liveShots.slice(1, 3).every((t) => / s before$/.test(t)),
    `and the five stills it was sent under it, each labelled by its seconds (${liveShots && liveShots.join(', ')})`);

    // Cleared while that review is still being improved. A Riot ID given now
    // makes the link's last try save the review once more, saying Riot's
    // record was not found: that version still says the clip was cleared.
    const clearedLive = await invoke(C.CLIPS_CLEAR);
    store.set('riotId', 'Check#EUW');
    ok(clearedLive && clearedLive.clips === 0 && !fs.existsSync(clipFile), 'Clear clips while the review is still being improved: its clip is gone');
    const later = await until(() => {
      const e = new ReviewStore(REVIEWS).get(liveId);
      return e && (e.review.refused || []).some((l) => /record of this match was not found/.test(l)) ? e : null;
    }, 20000);
    ok(later && later.review.clipsCleared && later.review.clipsCleared.reason === 'cleared',
      `and the version the link saved after it, giving up, still says the clip was cleared (${later ? JSON.stringify(later.review.clipsCleared) : 'never saved'})`);
    const goneLive = await until(async () => (await inPage(`(() => {
      const m = document.getElementById('moment-2');
      const g = m && !m.querySelector('video') && m.querySelector('.v-clip-gone');
      return g ? g.textContent + '|' + m.querySelectorAll('.v-shot img').length : null;
    })()`)) || null, 8000);
    ok(goneLive === 'Its clip was cleared in Settings. The frames and facts stay.|5', `the page says so, its five stills kept (${goneLive})`);
    ok(await until(() => (recorderModule.current().holds.length === 0 ? true : null), 20000),
      'and the hold is let go once the review\'s work is done');
    store.set('riotId', '');

    // ── 1b. Off chosen: the next match's look cuts nothing ─────────────────
    // Set in the config alone, the recorder not told. Told (prefsChanged), it
    // lets go of every recording it holds, the first guard; what is held here
    // is the second, in index.js, so the recording still holds the death.
    const cutsBefore = cuts.length;
    store.set('recordingMode', 'off');
    v.matchStartedAt = Date.now();
    const died2 = Date.now() + 1500;
    v.diagnostics({ at: died2 - 1000, image: grey, state: { phase: 'active', playerAlive: true }, died: false, round: 2, match: v.matchStartedAt });
    v.diagnostics({ at: died2, image: grey, state: { phase: 'active', playerAlive: false }, died: true, round: 2, match: v.matchStartedAt });
    await until(() => Date.now() > died2 + 7500, 30000);
    const snap2 = { rounds: played.rounds.map((r) => ({ ...r })), tips: [], notes: [], context: { ...played.context, agent: 'Jett', language: 'en' },
      startedAt: v.matchStartedAt - 1000, endedAt: Date.now(), endedBy: 'score' };
    v.emit('match-ended', snap2);
    const offId = await until(() => (new ReviewStore(REVIEWS).list('valorant').find((r) => r.id !== liveId) || {}).id || null, 8000);
    // And a clip an earlier look kept beside it (the screen's, cut while it
    // was still Auto, of a round this look does not choose): the look that
    // lands after Off is the review's last, and its cards name no clip.
    const earlier = offId ? new ReviewStore(REVIEWS).saveClip(offId, 'r5-clip.mkv', seedClip) : 0;
    v.emit('match-review', 'A read.', { ...snap2, ai: { summary: 'The coach read the match.', rounds: {}, focus: null } });
    const offCard = offId ? await until(() => {
      const e = new ReviewStore(REVIEWS).get(offId);
      const c = e && (e.review.rounds || []).find((x) => x.n === 2);
      return c && c.forensics ? c : null;
    }, 15000) : null;
    // A cut, had there been one, comes before the card is saved with its look.
    ok(offCard && offCard.forensics.cause === 'isolated' && !offCard.forensics.clip && !fs.existsSync(path.join(REVIEWS, offId, 'r2-clip.mkv'))
      && cuts.length === cutsBefore && rec.state === 'recording',
    `Off chosen, the recorder not told: the next match is looked at and no clip is cut, though the recording holds its death (${cuts.length - cutsBefore} cut)`);
    const offLeft = offId ? new ReviewStore(REVIEWS).clipsOf(offId).map((c) => c.name) : null;
    ok(earlier > 0 && offLeft && !offLeft.length,
      `and a clip an earlier look kept goes with it, the cards of the look after Off naming none (${offLeft ? offLeft.join(', ') || 'none left' : 'no review'})`);
    const sentOff = looksSent[looksSent.length - 1];
    ok(sentOff && sentOff !== sentLive && sentOff.deaths.length === 1 && sentOff.deaths[0].frames.length === 2
      && sentOff.deaths[0].frames.every((f) => f === grey) && !sentOff.deaths[0].frameAt && !sentOff.deaths[0].framesFrom,
    'with no clip, the look is sent the two frames the AI log holds, as before');
    store.set('recordingMode', 'auto');
    send(C.COACH_STOP);
    ok(await until(() => !registry.get('recorder'), 12000), 'recording stopped before any clip plays');

    // ── 1c. Each still is the clip's frame at its second ───────────────────
    // Held against the clip itself, seeked in a <video> to the same second,
    // with nothing recording any more: the still of 3 s before the read is the
    // clip's frame there, and not the frame a second either side, where the
    // generated picture has moved on (its colour turns 25 degrees a second,
    // its ball crosses 333 pixels).
    if (stillCheck) {
      const { BrowserWindow } = require('electron');
      const page = new BrowserWindow({ show: false, width: 640, height: 360, skipTaskbar: true, focusable: false,
        webPreferences: { backgroundThrottling: false, contextIsolation: true, nodeIntegration: false, sandbox: true } });
      await page.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent('<!doctype html><meta charset="utf-8"><body style="margin:0;background:#000"></body>'));
      const got = await page.webContents.executeJavaScript('(' + String(stillsAgainstClip) + ')(' + JSON.stringify(stillCheck) + ')', true);
      page.destroy();
      const rows = (got && got.out) || [];
      ok(rows.length === 5 && rows.every((r) => r.own < 4 && r.own * 3 < Math.min(r.early, r.late)),
        `each still is the clip's frame at its own second, not one a second either side: ${rows.map((r) => `${r.at} s ${r.own} against ${r.early} and ${r.late}`).join('; ')}${got && got.error ? ` (${got.error})` : ''}`);
    } else {
      ok(false, 'the clip and its 0 on the wall clock were there to hold the stills against');
    }

    // ── 2. A saved review, its clip cut from the canvas fixture ────────────
    const rounds = played.rounds.map((r) => ({ ...r }));
    const two = rounds.find((r) => r.n === 2);
    const frameB64 = nativeImage.createFromBitmap(Buffer.alloc(64 * 36 * 4, 90), { width: 64, height: 36 }).toJPEG(80).toString('base64');
    two.forensics = { cause: 'dry-peek', what: 'You swung wide.', better: 'Wait for the flash.', frames: ['r2-before.jpg'], source: 'screen', at: SEED_AT - 600000, clip: 'r2-clip.mkv' };
    const built = valorantReview.build({ rounds, context: { ...played.context, agent: 'Jett' }, endedBy: 'score', ai: {}, role: 'Duelist', history: [] });
    const library = new ReviewStore(REVIEWS);
    library.save({ id: SEED_ID, game: 'valorant', at: SEED_AT, review: { ...built, id: SEED_ID, at: SEED_AT, kind: 'valorant' }, frames: { 'r2-before.jpg': frameB64 } });
    ok(library.saveClip(SEED_ID, 'r2-clip.mkv', seedClip) === seedClip.length,
      `a clip of the canvas fixture, ${SEED_FROM} to ${SEED_TO} ms, kept beside a saved review (${seedClip.length} bytes, never a screen)`);
    send(C.REVIEW_OPEN, SEED_ID);
    const seeded = await until(async () => {
      const p = await playerOf('#moment-2');
      return p && p.src && p.src.includes(SEED_ID) ? p : null;
    }, 15000);
    ok(seeded && seeded.src === `occlara-clip://review/${SEED_ID}/r2-clip.mkv` && seeded.poster === `data:image/jpeg;base64,${frameB64}`,
      'opened from the library, its moment plays it from occlara-clip://review/<id>/r2-clip.mkv, the frame the coach looked at its poster');
    ok(seeded && seeded.muted === true && seeded.loop === true && seeded.inline === true && seeded.preload === 'none', 'muted, looping, inline, nothing loaded until played');
    // A repaint landing just after the page opened replaces its player; the
    // page is let settle before it is played.
    await wait(1200);
    const seekTo = 2.4;
    const p = await playIn('#moment-2', seekTo);
    const clipLen = (seedPlan.end - seedPlan.start) / 1000;
    ok(p && !p.error && Number.isFinite(p.duration) && Math.abs(p.duration - clipLen) < 0.05,
      `played, it loads through the scheme with the clip's own length: ${p && p.duration} s against ${clipLen.toFixed(3)} s${p && p.error ? ', error ' + p.error : ''}`);
    ok(p && p.playing && p.advanced > 0.5 && p.figPlaying && p.label === 'Pause the clip',
      `the page's button plays it: ${p && p.advanced} s on after 1.5 s, and it says pause`);
    ok(p && p.paused && p.figPaused, 'a click on the picture pauses it');
    ok(p && p.seeked && typeof p.mediaTime === 'number' && p.mediaTime <= seekTo + 0.001 && seekTo - p.mediaTime < 0.08 && Math.abs(p.currentTime - seekTo) < 0.001,
      `a seek to ${seekTo} s lands and presents the frame there: the frame at ${p && p.mediaTime} s (a frame is about 33 ms)`);

    // The scheme itself, through net.fetch, which goes through protocol.handle.
    const url = `occlara-clip://review/${SEED_ID}/r2-clip.mkv`;
    const r1 = await net.fetch(url, { headers: { Range: 'bytes=100-1123' } });
    const b1 = Buffer.from(await r1.arrayBuffer());
    ok(r1.status === 206 && r1.headers.get('content-range') === `bytes 100-1123/${seedClip.length}` && r1.headers.get('content-type') === 'video/x-matroska'
      && r1.headers.get('accept-ranges') === 'bytes' && b1.equals(seedClip.subarray(100, 1124)),
    `a range through the scheme: ${r1.status}, ${r1.headers.get('content-range')}, ${r1.headers.get('content-type')}, the file's own bytes`);
    const statuses = [];
    for (const u of [`occlara-clip://review/${SEED_ID}/r2-before.jpg`, `occlara-clip://review/${liveId}/r2-clip.mkv`,
      'occlara-clip://review/valorant-1-x/r2-clip.mkv', `occlara-clip://review/${SEED_ID}/x/r2-clip.mkv`]) {
      statuses.push((await net.fetch(u)).status);
    }
    ok(statuses.every((s) => s === 404), `a frame, a clip cleared, an id that is not a review's, a longer path: ${statuses.join(', ')}`);

    // ── 3. A League game, its death clipped by the game's own clock ────────
    store.set('game', 'lol');
    send(C.COACH_START);
    const lolEngine = engines[engines.length - 1];
    if (!ok(lolEngine instanceof StandInLol, 'League starts recording too')) return report();
    const lrec = await recording();
    if (!ok(lrec, 'the recorder records a League session')) return report();
    const lzero = lrec.seg.zero();
    lolEngine.live = true;
    lolEngine.liveSince = lzero;
    // The game's clock as the polls read it, every two seconds, and a death
    // the game stamps 13 s in.
    const timeline = [];
    for (let t = 0; t <= 20; t += 2) timeline.push({ t, wall: lzero + t * 1000 });
    await until(() => Date.now() > lzero + 20000, 30000);
    lolEngine.live = false;
    const ME = 'Check#EUW';
    const gameDiedAt = (sec) => ({
      me: ME, allies: ['Ally#EUW'], champion: 'Ahri', role: 'Middle', band: null, map: 'Map11', mode: 'CLASSIC',
      stats: { gameTimeSec: 20, csAt10: null, deathsBy15: 1, wardScore: 2, deathsAhead: null, goldHeldSec: null },
      final: { t: 20, cs: 12, kills: 0, deaths: 1, assists: 0, ward: 2, level: 3, items: [] }, at10: null, at15: null,
      events: [{ EventID: 1, EventName: 'ChampionKill', EventTime: sec, KillerName: 'Foe#EUW', VictimName: ME }],
      startedAt: lzero, timeline,
    });
    // Off chosen first, in the config alone as in 1b: a game that ends then
    // keeps no clip, past the seconds index.js lets the recording settle for.
    const lolCutsBefore = cuts.length;
    store.set('recordingMode', 'off');
    lolEngine.emit('game', gameDiedAt(8));
    const offLolId = await until(() => (new ReviewStore(REVIEWS).list('lol')[0] || {}).id || null, 8000);
    await wait(LOL_SETTLE_MS + 2500);
    const offLol = offLolId ? new ReviewStore(REVIEWS).get(offLolId) : null;
    const offDeath = offLol && (offLol.review.deathList || [])[0];
    ok(offDeath && offDeath.at === '0:08' && !offDeath.clip && !fs.existsSync(path.join(REVIEWS, offLolId, 'd1-clip.mkv'))
      && cuts.length === lolCutsBefore,
    `Off chosen, the recorder not told: a League game's death at 0:08, inside the recording, is not clipped (${cuts.length - lolCutsBefore} cut)`);
    store.set('recordingMode', 'auto');
    lolEngine.emit('game', gameDiedAt(13));
    const lolId = await until(() => (new ReviewStore(REVIEWS).list('lol').find((r) => r.id !== offLolId) || {}).id || null, 8000);
    if (!ok(lolId, 'the game ended: its review is saved')) return report();
    const lolClip = path.join(REVIEWS, lolId, 'd1-clip.mkv');
    const lolKept = await until(() => fs.existsSync(lolClip) && fs.statSync(lolClip).size > 0, 20000);
    const lolNamed = await until(() => {
      const e = new ReviewStore(REVIEWS).get(lolId);
      const d = e && (e.review.deathList || [])[0];
      return d && d.clip === 'd1-clip.mkv' ? d : null;
    }, 8000);
    const lolLen = lolKept ? lengthOf(lolClip).len : 0;
    ok(lolKept && lolNamed && lolNamed.at === '0:13' && lolLen >= 14 && lolLen <= CLIP_MAX_S,
      `the death at 0:13 of the game's clock, found in the recording by the wall clock: d1-clip.mkv kept and named, ${lolLen.toFixed(2)} s, 11 before to 4 after`);
    ok(await until(() => (recorderModule.current().holds.length === 0 ? true : null), 10000), 'and the hold its cut needed let go');
    const lolPlayer = await until(async () => {
      const shown = await inPage(`!document.getElementById('r-deaths-wrap').hidden`);
      const pl = shown ? await playerOf('#death-1') : null;
      return pl && pl.src ? pl : null;
    }, 10000);
    ok(lolPlayer && lolPlayer.src === `occlara-clip://review/${lolId}/d1-clip.mkv`, `the League review on screen repaints "Your deaths" with it (${lolPlayer && lolPlayer.src})`);
    send(C.COACH_STOP);
    await until(() => !registry.get('recorder'), 12000);
    const lp = await playIn('#death-1', 5);
    ok(lp && !lp.error && Number.isFinite(lp.duration) && Math.abs(lp.duration - lolLen) < 0.2 && lp.playing && lp.advanced > 0.5 && lp.seeked,
      `and it plays, a clip recorded live: ${lp && lp.duration} s long, ${lp && lp.advanced} s on after 1.5 s, seeked${lp && lp.error ? ', error ' + lp.error : ''}`);

    // ── 4. Clear clips, from Settings' channel ─────────────────────────────
    const before = await invoke(C.CLIPS_USAGE);
    ok(before && before.clips === 2 && before.bytes > seedClip.length && before.capGB === 10,
      `Settings is told what the clips take: ${before && before.clips} clips, ${before && Math.round(before.bytes / 1024)} KB of ${before && before.capGB} GB`);
    const after = await invoke(C.CLIPS_CLEAR);
    ok(after && after.clips === 0 && after.bytes === 0 && !fs.existsSync(lolClip) && !fs.existsSync(path.join(REVIEWS, SEED_ID, 'r2-clip.mkv')),
      'Clear clips: every clip gone from disk');
    const goneLol = await until(async () => (await inPage(`(() => {
      const d = document.getElementById('death-1');
      const g = d && !d.querySelector('video') && d.querySelector('.v-clip-gone');
      return g ? g.textContent : null;
    })()`)) || null, 8000);
    ok(goneLol === 'Its clip was cleared in Settings. Its facts stay.', `the review on screen says so (${goneLol})`);
    const marked = new ReviewStore(REVIEWS);
    ok(['cleared', 'cleared', 'cleared'].every((w, i) => {
      const e = marked.get([liveId, SEED_ID, lolId][i]);
      return e && e.review.clipsCleared && e.review.clipsCleared.reason === w;
    // The live review's frames are the stills its look took from the recording.
    }) && marked.frame(SEED_ID, 'r2-before.jpg') && marked.frame(liveId, 'r2-rec1-before.jpg'),
    'and each saved review says its clip was cleared, its frames kept');

    // ── 5. A late link drops a look Riot contradicts, and its clip with it ─
    // A recording looked at from the screen in rounds 2, 14, 17 and 19, a clip
    // of each beside it, that never linked, graded from Riot's record by the
    // real backfill and its save ("Grade my recent matches"): Riot says the
    // round 17 death never happened, the upgrade drops that look, and the clip
    // of it goes too.
    const W_START = Date.now() - 30 * 3600000;
    const wsnap = { ...played, startedAt: W_START, endedAt: W_START + 24 * 100000 + 60000,
      context: { ...played.context, map: 'Abyss', agent: 'Jett', agentConfirmed: true, teamScore: 13, enemyScore: 11 } };
    const LOOKED = [2, 14, 17, 19];
    const wrows = wsnap.rounds.map((r) => (LOOKED.includes(r.n) ? { ...r, forensics: { cause: 'isolated', what: 'You held the site alone.',
      better: 'Hold it with a teammate.', frames: [`r${r.n}-before.jpg`], source: 'screen', at: W_START + r.n * 100000, clip: `r${r.n}-clip.mkv` } } : r));
    const watched = valorantReview.build({ rounds: wrows, context: wsnap.context, endedBy: 'score', ai: {}, role: 'Duelist', history: [] });
    watched.ledger = valorantReview.ledgerOf({ ...wsnap, rounds: wrows });
    const W_ID = newId('valorant', wsnap.endedAt);
    Object.assign(watched, { id: W_ID, at: wsnap.endedAt, kind: 'valorant' });
    library.save({ id: W_ID, game: 'valorant', at: watched.at, review: watched,
      frames: Object.fromEntries(LOOKED.map((n) => [`r${n}-before.jpg`, frameB64])) });
    for (const n of LOOKED) library.saveClip(W_ID, `r${n}-clip.mkv`, seedClip);
    graded = {
      row: { matchId: 'abyss-1', map: 'Abyss', agent: 'Jett', mode: 'Competitive', result: 'Victory', score: '13-11',
        kills: 31, deaths: 21, assists: 4, kd: 1.48, acs: 382, adr: 243, headshotPct: 25, startedAt: W_START + 60000 },
      riot: { ...load('riot-abyss-13-11.json'), matchId: 'abyss-1', queue: 'competitive' },
    };
    store.set('riotId', 'Me#EUW');
    const heldBefore = (await invoke(C.CLIPS_USAGE)).clips;
    await invoke(C.BACKFILL_START);
    const upgraded = await until(() => {
      const e = new ReviewStore(REVIEWS).get(W_ID);
      return e && e.review.verified && e.review.matchId === 'abyss-1' ? e.review : null;
    }, 30000);
    const onDisk = new ReviewStore(REVIEWS).clipsOf(W_ID).map((c) => c.name).join(', ');
    const namedNow = upgraded ? upgraded.rounds.filter((c) => c.forensics && c.forensics.clip).map((c) => c.forensics.clip).join(', ') : '';
    const heldAfter = (await invoke(C.CLIPS_USAGE)).clips;
    ok(upgraded && upgraded.lateLinked && namedNow === 'r2-clip.mkv, r14-clip.mkv, r19-clip.mkv' && onDisk === 'r14-clip.mkv, r19-clip.mkv, r2-clip.mkv'
      && heldBefore === 4 && heldAfter === 3,
    `graded from Riot's record in place, its cards name the clips of the deaths Riot confirms and only those stay: ${onDisk || 'none'} `
      + `(${heldBefore} clips, then ${heldAfter}${upgraded ? '' : ', never upgraded'})`);
    report(null);
  } catch (e) {
    report('threw: ' + ((e && e.stack) || e));
  }
}, 6500);

app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');
app.on('window-all-closed', () => { /* the run above decides when we exit */ });
process.on('uncaughtException', (e) => report('the check threw: ' + String((e && e.stack) || e)));
process.on('unhandledRejection', (e) => report('the check threw: ' + String((e && e.stack) || e)));
process.env.OCCLARA_DEV_USERDATA = ud;

require(INDEX);
