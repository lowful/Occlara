'use strict';

/**
 * Screen capture in a Worker Thread + child process, entirely OFF the main and
 * render threads and off the game's render path, so it never causes an in-game
 * hitch. The capture itself is a GDI copy of the screen, taken by the ffmpeg
 * that ships with the app (gdigrab, 8.16.1; gdi-grab.js). It was a PowerShell
 * script first, which matched Windows Defender's PowerShell Empire
 * "Get-Screenshot" signature, then a small helper exe of our own
 * (OcclaraCapture.exe), which Bitdefender quarantined as Trojan.GenericKD: a
 * tiny unsigned file whose whole job is copying the screen. The helper is no
 * longer in the installer and is used only where it still exists; PowerShell
 * only when neither file does (capture-worker.js).
 *
 * WHILE THE MATCH IS RECORDED (8.3) the frame comes from the recording
 * instead: the recorder (services/recorder.js) hands its stream in through
 * useStream once a comparison with GDI has shown the stream sees the game,
 * and takes it back the moment recording stops. The helper is then not
 * launched for every read, which was a process start a second. A read the
 * stream cannot serve (no fresh frame, a page that did not answer) is taken
 * by the helper, so the read never waits on the recorder.
 *
 * Returns a base64 JPEG at the requested quality profile.
 */
const { Worker } = require('worker_threads');
const path = require('path');
const fs   = require('fs');
const { CAPTURE } = require('../../shared/config');
const { geometry } = require('./gdi-grab');

let worker  = null;
// Every capture the helper is asked for, by id: the read's and the
// recorder's comparison can be out at once, and each answer goes to its own.
const waiting = new Map();
let nextId = 1;
let stream = null;        // the recorder's { grab(profile) }, while it serves the read
let lastSource = null;    // 'stream' | 'gdi', where the last frame served came from
let lastVia = null;       // 'ffmpeg' | 'helper' | 'powershell', who took the last GDI frame
let fake = false;         // unpackaged checks only: no screen is ever captured

// The old helper, where it still exists: not shipped since 8.16.1, so in an
// install only what an interrupted update left behind. Dev: native/.
function resolveHelperExe() {
  const candidates = [
    path.join(process.resourcesPath || '', 'OcclaraCapture.exe'),
    path.join(__dirname, '..', '..', '..', 'native', 'OcclaraCapture.exe'),
    // The pre-rename name, still tried last. An interrupted update can leave
    // the old helper in resources, and falling back to powershell capture there
    // would trip the Defender signature this exe exists to avoid.
    path.join(process.resourcesPath || '', 'GhostCoachCapture.exe'),
    path.join(__dirname, '..', '..', '..', 'native', 'GhostCoachCapture.exe'),
  ];
  for (const c of candidates) { try { if (fs.existsSync(c)) return c; } catch {} }
  return null;
}

// The ffmpeg beside the app when installed, the dev dependency in the repo
// (import-video.js ffmpegPath, the same file the importer and the clips use).
function resolveFfmpegExe() {
  let p = null;
  try {
    const { app } = require('electron');
    p = require('./import-video').ffmpegPath({ packaged: !!(app && app.isPackaged), resourcesPath: process.resourcesPath || '' });
  } catch { p = null; }
  try { return p && fs.existsSync(p) ? p : null; } catch { return null; }
}

// The primary display in physical pixels, asked for each frame: a monitor
// plugged in mid session changes what "desktop" is to gdigrab.
function primaryGeometry() {
  try { return geometry(require('electron').screen); } catch { return null; }
}

function failAll(err) {
  for (const [id, p] of [...waiting]) { waiting.delete(id); clearTimeout(p.timer); p.reject(err); }
}

function getWorker() {
  if (worker) return worker;
  worker = new Worker(path.join(__dirname, 'capture-worker.js'), {
    workerData: { helperExe: resolveHelperExe(), ffmpegExe: resolveFfmpegExe() },
  });

  worker.on('message', (msg) => {
    // Who took the frame, to the debug log whenever it changes (never to the
    // screen): ffmpeg, or the old helper or PowerShell with what ffmpeg said.
    if (msg && msg.success && msg.via && msg.via !== lastVia) {
      lastVia = msg.via;
      console.log(`[capture] the GDI frame is taken by ${msg.via}${msg.why ? `, ffmpeg failed: ${String(msg.why).slice(0, 200)}` : ''}`);
    }
    const p = msg && waiting.get(msg.id);
    if (!p) return;   // timed out already
    waiting.delete(msg.id);
    clearTimeout(p.timer);
    if (msg.success) p.resolve(msg.data);
    else             p.reject(new Error(msg.error || 'Capture failed'));
  });
  worker.on('error', (err) => {
    failAll(err);
    worker = null; // respawn on next call
  });
  worker.on('exit', (code) => {
    failAll(new Error(`Capture worker exited (${code})`));
    worker = null;
  });

  return worker;
}

function profileFor(quality) {
  return (CAPTURE.profiles && CAPTURE.profiles[quality]) || CAPTURE.profiles.standard;
}

/**
 * Never the screen: a flat mid grey frame of the profile's size, made with
 * Electron's own JPEG encoder, for a check that must show the GDI path was
 * taken without capturing the desktop (OCCLARA_FAKE_CAPTURE, set by index.js
 * in unpackaged builds only).
 */
let fakeFrame = null;
function fakeGdiFrame(prof) {
  const key = `${prof.targetW}x${prof.targetH}x${prof.jpegQuality}`;
  if (fakeFrame && fakeFrame.key === key) return fakeFrame.b64;
  const { nativeImage } = require('electron');
  const px = Buffer.alloc(prof.targetW * prof.targetH * 4);
  for (let i = 0; i < px.length; i += 4) { px[i] = 128; px[i + 1] = 128; px[i + 2] = 128; px[i + 3] = 255; }
  const b64 = nativeImage.createFromBitmap(px, { width: prof.targetW, height: prof.targetH }).toJPEG(prof.jpegQuality).toString('base64');
  fakeFrame = { key, b64 };
  return b64;
}

/** One frame from the GDI helper, whatever the recorder is doing. */
function captureGdi(quality) {
  const prof = profileFor(quality);
  if (fake) return Promise.resolve(fakeGdiFrame(prof));
  return new Promise((resolve, reject) => {
    const id = nextId++;
    const w = getWorker();
    const timer = setTimeout(() => {
      if (waiting.delete(id)) reject(new Error('Capture timeout'));
    }, CAPTURE.timeoutMs);
    waiting.set(id, { resolve, reject, timer });
    w.postMessage({ id, quality: quality || 'standard', geom: primaryGeometry() });
  });
}

/** The read's frame: from the recording while it serves one, else from the GDI helper. */
async function captureScreenshot(quality) {
  const s = stream;
  if (s) {
    let shot = null;
    try { shot = await s.grab(profileFor(quality)); } catch { shot = null; }
    if (shot) { lastSource = 'stream'; return shot; }
  }
  const shot = await captureGdi(quality);
  lastSource = 'gdi';
  return shot;
}

/** The recorder hands its stream in ({ grab(profile) }), or null to take it back. */
function useStream(s) { stream = s && typeof s.grab === 'function' ? s : null; }

/** Where the last frame served came from: 'stream', 'gdi', or null before any. */
function source() { return lastSource; }

/** Unpackaged checks only (index.js): the GDI path then never touches the screen. */
function setFake(on) { fake = !!on; }

function disposeWorker() {
  if (worker) { worker.terminate().catch(() => {}); worker = null; }
  failAll(new Error('Capture stopped'));
  stream = null;
}

module.exports = { captureScreenshot, captureGdi, useStream, source, setFake, disposeWorker };
