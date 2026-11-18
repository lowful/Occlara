'use strict';

/**
 * AN IMPORTED RECORDING'S CLIP PLAYS, AND ITS FRAMES DECODE (8.12). test:importvideo
 * holds the bytes; only Chromium can say a player takes them. A test video with
 * B frames is cut by import-video.js, then played in a hidden <video> as
 * video/x-matroska, seeked, and decoded by WebCodecs with no description, as
 * the frames page decodes a recording's clips. Skipped without an ffmpeg.
 *
 * Results travel through a file: an Electron main process on Windows does not
 * reliably flush a piped stdout.
 *
 * Run: npm run check:importclip
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const OUT = path.join(os.tmpdir(), 'occlara-import-clip-check.json');

if (!process.versions.electron) {
  const electron = require('electron');
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  try { fs.unlinkSync(OUT); } catch {}
  spawnSync(electron, [__filename], { env, timeout: 90000 });
  let r = null;
  try { r = JSON.parse(fs.readFileSync(OUT, 'utf8')); } catch {}
  if (!r) { console.log('FAIL: the check never reported'); process.exit(1); }
  for (const l of r.lines) console.log(`${l.ok ? 'ok   ' : 'FAIL '} ${l.what}`);
  process.exit(r.lines.every((l) => l.ok) ? 0 : 1);
}

const { app, BrowserWindow } = require('electron');
const imp = require('../src/main/services/import-video');
const clipFrames = require('../src/shared/clip-frames');

const lines = [];
const ok = (cond, what) => lines.push({ ok: !!cond, what });
const finish = () => { fs.writeFileSync(OUT, JSON.stringify({ lines })); app.exit(0); };

app.whenReady().then(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'occlara-import-clip-'));
  try {
    const ffmpeg = imp.ffmpegPath({ packaged: false });
    if (!ffmpeg || !fs.existsSync(ffmpeg)) { ok(true, 'skipped: no ffmpeg here'); return; }
    const video = path.join(dir, 'source.mp4');
    const made = spawnSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=s=1920x1080:r=60:d=20',
      '-c:v', 'libx264', '-preset', 'ultrafast', '-bf', '3', '-g', '120', '-pix_fmt', 'yuv420p', video]);
    ok(made.status === 0, 'a source video with B frames is made');
    const bytes = await imp.cutVideoClip(video, 5, 10, { ffmpeg, tmpDir: dir });
    const clip = clipFrames.indexClip(bytes);
    const job = { codec: clip.codec, width: clip.width, height: clip.height,
      frames: clip.frames.slice(0, 40).map((f) => ({ key: f.key, ms: f.ms, data: bytes.subarray(f.start, f.end).toString('base64') })) };
    const win = new BrowserWindow({ show: false, webPreferences: { offscreen: false, backgroundThrottling: false } });
    const page = path.join(dir, 'page.html');
    fs.writeFileSync(page, '<!doctype html><title>clip</title>');
    await win.loadFile(page);
    const r = await win.webContents.executeJavaScript(`(async () => {
      const b64 = ${JSON.stringify(bytes.toString('base64'))};
      const raw = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const v = document.createElement('video');
      v.muted = true;
      v.src = URL.createObjectURL(new Blob([raw], { type: 'video/x-matroska' }));
      const on = (el, ev, ms) => new Promise((res, rej) => { el.addEventListener(ev, res, { once: true });
        el.addEventListener('error', () => rej(new Error('media error ' + (el.error && el.error.message))), { once: true });
        setTimeout(() => rej(new Error('timeout on ' + ev)), ms); });
      const out = {};
      try {
        await on(v, 'loadeddata', 15000);
        out.duration = v.duration; out.w = v.videoWidth; out.h = v.videoHeight;
        const c = document.createElement('canvas'); c.width = 64; c.height = 36;
        v.currentTime = 2.5; await on(v, 'seeked', 15000);
        const g = c.getContext('2d'); g.drawImage(v, 0, 0, 64, 36);
        const px = g.getImageData(0, 0, 64, 36).data; let sum = 0; for (let i = 0; i < px.length; i += 4) sum += px[i] + px[i + 1] + px[i + 2];
        out.bright = sum / (px.length / 4) / 3;
      } catch (e) { out.playError = e.message; }
      const job = ${JSON.stringify(job)};
      try {
        let n = 0; let err = null;
        const d = new VideoDecoder({ output: (f) => { n++; f.close(); }, error: (e) => { err = e.message; } });
        d.configure({ codec: job.codec, codedWidth: job.width, codedHeight: job.height, optimizeForLatency: true });
        for (const f of job.frames) d.decode(new EncodedVideoChunk({ type: f.key ? 'key' : 'delta', timestamp: Math.round(f.ms * 1000),
          data: Uint8Array.from(atob(f.data), (c) => c.charCodeAt(0)) }));
        await d.flush(); d.close();
        out.decoded = n; out.decodeError = err;
      } catch (e) { out.decodeError = e.message; }
      return out;
    })()`);
    ok(!r.playError, `the <video> loads and seeks it${r.playError ? `: ${r.playError}` : ''}`);
    ok(Math.abs(r.duration - 5) < 0.2 && r.w === 1280 && r.h === 720, `it is 5 s at 1280x720 (${r.duration}, ${r.w}x${r.h})`);
    ok(r.bright > 10, `the frame after the seek is a picture (brightness ${Math.round(r.bright || 0)})`);
    ok(!r.decodeError && r.decoded === job.frames.length, `WebCodecs decodes its frames with no description (${r.decoded} of ${job.frames.length}${r.decodeError ? `, ${r.decodeError}` : ''})`);
  } catch (e) {
    ok(false, `the check crashed: ${e.message}`);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
    finish();
  }
});
