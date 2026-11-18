'use strict';

/**
 * IMPORT A RECORDING, the client's half (8.12, docs/claude/import.md), on a real
 * ffmpeg: probing, the frames of a video, a clip in the shape the clip player
 * and the stills decoder take, and a whole import through a real engine with a
 * fake server replaying a saved session. Skipped honestly when no ffmpeg is
 * installed here (OCCLARA_FFMPEG, or the ffmpeg-static dev dependency).
 *
 * Run: npm run test:importvideo
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const imp = require('../src/main/services/import-video');
const aiLogStore = require('../src/main/services/ai-log-store');
const webm = require('../src/shared/webm');
const clipFrames = require('../src/shared/clip-frames');
const usage = require('../src/shared/usage');
const { withClock } = require('../src/shared/virtual-clock');
const { CoachingEngine } = (() => {
  const m = require('../src/main/services/coaching-engine');
  return { CoachingEngine: m.CoachingEngine || m };
})();

let fails = 0;
let checks = 0;
const ok = (cond, what, detail) => {
  checks++;
  if (!cond) { fails++; console.log(`FAIL  ${what}${detail ? `\n      ${detail}` : ''}`); } else console.log(`ok    ${what}`);
};

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'occlara-import-test-'));
const quiet = async (fn) => {
  const log = console.log; const err = console.error;
  console.log = () => {}; console.error = () => {};
  try { return await fn(); } finally { console.log = log; console.error = err; }
};

(async () => {
  // ── Pure parts, with or without ffmpeg ─────────────────────────────────
  const line = '  Duration: 00:31:12.40, start: 0.000000, bitrate: 8000 kb/s\n  Stream #0:0[0x1](und): Video: h264 (High) (avc1 / 0x31637661), yuv420p(tv, bt709, progressive), 1920x1080 [SAR 1:1 DAR 16:9], 7800 kb/s, 60 fps\n';
  const p = imp.parseProbe(line);
  ok(p && Math.round(p.seconds) === 1872 && p.width === 1920 && p.height === 1080 && p.codec === 'h264', 'the probe reads an OBS mp4 line');
  ok(imp.parseProbe('  Duration: 00:03:00.00\n  Stream #0:0: Audio: aac, 48000 Hz') === null, 'and a file with no video is none');
  const split = new imp.JpegSplitter();
  const j = (n) => Buffer.from([0xFF, 0xD8, n, 0xFF, 0x00, n, 0xFF, 0xD9]);
  const whole = Buffer.concat([j(1), j(2), j(3)]);
  const got = [...split.push(whole.subarray(0, 5)), ...split.push(whole.subarray(5, 11)), ...split.push(whole.subarray(11))];
  ok(got.length === 3 && got[2][2] === 3, 'JPEGs split across chunks come out whole');
  ok((await imp.probe('x.txt', {})).error === 'type', 'a file of another type is refused before it is opened');

  // The prune keeps a running import's folder, with the live session's.
  const root = path.join(dir, 'log');
  for (const n of ['session-a', 'session-b', 'session-import-c']) {
    fs.mkdirSync(path.join(root, n), { recursive: true });
    fs.writeFileSync(path.join(root, n, 'log.json'), '{}');
  }
  aiLogStore.prune(root, 2, ['session-import-c', null]);
  ok(fs.existsSync(path.join(root, 'session-import-c')) && fs.readdirSync(root).length === 2, 'a running import is never pruned, and counts against the budget');

  // The plan's words.
  ok(usage.importCard({ tier: 'free', reason: 'plan' }).title === 'Imports come with Pro and Max', 'Free sees the lock');
  ok(usage.importCard({ tier: 'pro', allowed: true, importsLeft: 3, gamesLeft: 20, boughtGames: 0 }).line === '3 of 5 imports left this month. 20 games left, this import uses 1', 'Pro sees its count');
  const out = usage.importCard({ tier: 'pro', reason: 'imports', importsLeft: 0, gamesLeft: 20, boughtGames: 0 });
  ok(out.allowed === false && out.upgrade === 'max' && out.buy === true, 'Pro at 5 is offered Max or a game');
  ok(usage.importCard({ tier: 'max', allowed: true, importsLeft: null, gamesLeft: 1, boughtGames: 0 }).line === '1 game left, this import uses 1', 'Max sees only its games');
  ok(usage.importCard({ tier: 'max', reason: 'games', gamesLeft: 0 }).upgrade === null, 'Max with no game left is offered no plan above it');
  const words = JSON.stringify(['free', 'pro', 'max'].flatMap((tier) => ['plan', 'imports', 'games', null].map((reason) => usage.importCard({ tier, reason, gamesLeft: 1, importsLeft: 1 }))));
  ok(!new RegExp('[\\u2013\\u2014]').test(words), 'no dash in any of it');

  // ── With ffmpeg ─────────────────────────────────────────────────────────
  const ffmpeg = imp.ffmpegPath({ packaged: false });
  if (!ffmpeg || !fs.existsSync(ffmpeg)) {
    console.log('SKIP  no ffmpeg here: run npm install, or set OCCLARA_FFMPEG');
  } else {
    const video = path.join(dir, 'My Match.mp4');
    const made = spawnSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=s=1920x1080:r=60:d=75',
      '-c:v', 'libx264', '-preset', 'ultrafast', '-bf', '3', '-g', '120', '-pix_fmt', 'yuv420p', video]);
    ok(made.status === 0, 'a 75 second test video with B frames is made', String(made.stderr).slice(0, 300));
    const info = await imp.probe(video, { ffmpeg });
    {
      const logs = fs.mkdtempSync(path.join(os.tmpdir(), 'occlara-import-del-'));
      const own = 'session-import-2026-11-18T09-48-56-963Z';
      const live = 'session-2026-11-18T09-48-56-963Z';
      for (const d of [own, live]) { fs.mkdirSync(path.join(logs, d)); fs.writeFileSync(path.join(logs, d, 'log.json'), '[]'); }
      ok(aiLogStore.removeImported(logs, own) && !fs.existsSync(path.join(logs, own)), 'deleting an import takes its log folder');
      ok(!aiLogStore.removeImported(logs, live) && fs.existsSync(path.join(logs, live)), 'a live session log is never deleted that way');
      ok(!aiLogStore.removeImported(logs, '../session-import-1') && !aiLogStore.removeImported(logs, null), 'a path or nothing is refused');
      fs.rmSync(logs, { recursive: true, force: true });
    }
    ok(withClock(1794996745340.66, () => Date.now()) === 1794996745340, 'the virtual clock reads whole milliseconds, so a review id from it is valid');
    ok(info.ok && info.name === 'My Match.mp4' && Math.round(info.seconds) === 75 && info.width === 1920, 'probe reads the file, and keeps only its base name');
    let n = 0; let first = null;
    for await (const f of imp.videoFrames(video, { ffmpeg })) { if (!first) first = f; n++; if (n === 5) break; }
    ok(n === 5 && first.sec === 0 && first.jpeg[0] === 0xFF && first.jpeg[1] === 0xD8, 'frames come a second apart as JPEGs, and stopping early ends ffmpeg');
    const bytes = await imp.cutVideoClip(video, 10, 15, { ffmpeg, tmpDir: dir });
    const init = webm.parseInit(bytes);
    const clip = clipFrames.indexClip(bytes);
    ok(init && init.mime === 'video/x-matroska' && init.video.codec === 'V_MPEG4/ISO/AVC' && init.video.width === 1280, 'webm.parseInit takes the clip');
    ok(clip && clip.frames.length >= 149 && clip.frames.filter((f) => f.key).length === 5 && /^avc1\./.test(clip.codec), 'one keyframe a second, an SPS in each');
    ok(clip.frames.every((f) => bytes.readUInt32BE(f.start) === 1), 'every frame is Annex B, as the recorder writes');
    ok(clip.frames.every((f, i) => i === 0 || f.ms > clip.frames[i - 1].ms), 'in display order: no B frames');
    ok(bytes.indexOf(Buffer.from([0x63, 0xA2])) < 0 || bytes.indexOf(Buffer.from([0x63, 0xA2])) > bytes.indexOf(Buffer.from([0x1F, 0x43, 0xB6, 0x75])), 'with no CodecPrivate left in its tracks');
    ok(clipFrames.planFrames(clip, [1000, 2500]).picks.every((x) => x.frame !== null), 'and the stills planner finds frames in it');

    // ── A whole import, real engine, fake server ─────────────────────────
    const t0 = Date.parse('2026-11-17T10:00:00Z');
    const reply = (sec) => {
      // 0 to 9 menus; then a short match, a round each 8 seconds, won 13-1 in spirit
      // by the score the engine sees; then menus for good.
      if (sec < 10 || sec >= 60) return { lobby: true, context: {}, parsed: false };
      const k = Math.floor((sec - 10) / 8);
      return { lobby: false, parsed: true, context: { phase: 'active', map: 'Ascent', side: 'attack', teamScore: k, enemyScore: 0,
        roundNumber: k + 1, playerAlive: true, playerHp: 100, clock: '1:00', gameMode: 'standard' } };
    };
    const seen = { reads: 0, ctx: [], headers: [] };
    const posts = [];
    const pushed = [];
    let reviewed = null;
    const logRoot = path.join(dir, 'ai-log');
    fs.mkdirSync(logRoot, { recursive: true });
    const realApi = require('../src/main/services/api-client');
    const realPost = realApi.post;
    let sec429 = true;
    realApi.post = async (url, body, auth, _ms) => {
      const h = typeof auth === 'function' ? auth() : auth;
      if (url.endsWith('/read')) {
        seen.reads++;
        seen.headers.push(h && h['X-Occlara-Import']);
        if (sec429 && seen.reads === 3) { sec429 = false; return { ok: false, status: 429, data: { error: 'rate-limited' } }; }
        const b = Buffer.from(body.image, 'base64');
        ok.frameSec = (ok.frameSec || 0);
        const s = imageSec.get(b.length + ':' + b.subarray(-64).toString('hex'));
        return { ok: true, status: 200, data: reply(s) };
      }
      throw new Error(`unexpected post ${url}`);
    };
    const imageSec = new Map();
    for await (const f of imp.videoFrames(video, { ffmpeg })) imageSec.set(f.jpeg.length + ':' + f.jpeg.subarray(-64).toString('hex'), f.sec);
    const api = {
      get: async () => ({ ok: true, data: { allowed: true } }),
      post: async (url, body) => { posts.push({ url, body }); return { ok: true, status: 200, data: { ok: true } }; },
    };
    const realNow = Date.now;
    let liveTouched = false;
    const importer = imp.createImporter({
      ffmpeg, Engine: CoachingEngine, READ_PATH: '/api/coach/read',
      engineOptions: () => ({ experiments: () => ({}), recurring: () => [] }),
      logRoot, version: 'test', api, auth: () => ({ Authorization: 'Bearer x' }),
      busy: () => false, shouldPause: () => false,
      chooseFile: async () => video,
      idle: async () => true,
      riotMatches: async () => [{ matchId: 'older', startedAt: t0 - 86400000, map: 'Bind' },
        { matchId: 'near', startedAt: fs.statSync(video).mtimeMs - 80000, map: 'Ascent' },
        { matchId: 'near-taken', startedAt: fs.statSync(video).mtimeMs - 75000, map: 'Ascent', taken: true }],
      review: async ({ run, snap }) => { reviewed = { run, snap, records: run.log.hold(snap.startedAt, snap.endedAt).records.length }; return { id: 'valorant-1', matched: false }; },
      push: (s) => { pushed.push(s); if (s.path || JSON.stringify(s).includes(dir)) liveTouched = true; },
    });
    const chosen = await importer.pick();
    ok(chosen.state === 'choosing' && chosen.fileName === 'My Match.mp4' && chosen.nearest === 'near', 'the picker offers the file, and the closest match not already reviewed');
    ok(!JSON.stringify(chosen).includes(dir), 'no path reaches the page');
    await quiet(() => importer.start({ matchId: null }));
    for (let i = 0; i < 3000 && !['done', 'failed'].includes(importer.status().state); i++) await new Promise((r) => setTimeout(r, 100));
    realApi.post = realPost;
    const end = importer.status();
    ok(end.state === 'done' && end.reviewId === 'valorant-1', 'the import runs to a review', JSON.stringify(end));
    ok(Date.now === realNow, 'the clock is put back');
    ok(!liveTouched, 'nothing it pushes names a path');
    ok(posts[0] && posts[0].url === '/api/usage/import' && posts[posts.length - 1].url === '/api/usage/import/end' && posts[posts.length - 1].body.outcome === 'done', 'it claims first and reports done last');
    ok(seen.headers.every((h) => h === posts[0].body.job_id), 'every read carries its import id');
    ok(seen.reads > 20, `the frames were read through a 429 (${seen.reads} sends)`);
    if (reviewed) {
      ok(reviewed.snap.rounds.length >= imp.LIMITS.MIN_ROUNDS && reviewed.snap.stoppedLive === false, 'the review gets the match, never marked as stopped live');
      ok(reviewed.snap.context.map === 'Ascent' && reviewed.records > 10, 'with its map and its own log of frames');
      ok(reviewed.run.fileName === 'My Match.mp4', 'and only the base name');
      const c = await reviewed.run.cut(reviewed.snap.startedAt + 5000, reviewed.snap.startedAt + 8000, reviewed.snap.startedAt + 7000);
      ok(c && webm.parseInit(c.bytes) && c.startWall === reviewed.snap.startedAt + 5000, "its clips come out of the file, on the review's clock");
    }
    ok(withClock(5, () => Date.now()) === 5 && Date.now() !== 5, 'the virtual clock is only for its one call');
  }
  fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 });
  console.log(fails ? `\n${fails} of ${checks} import checks FAILED` : `\nall ${checks} import checks passed`);
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.log('FAIL  the test crashed:', e.stack || e); process.exit(1); });
