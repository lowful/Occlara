'use strict';

/**
 * WHAT THIS PC CAN RECORD WITH (8.3.1). The onboarding page that offers
 * Record gameplay or Frames only asks once, as it opens (PC_CHECK), and main
 * answers with what Node can tell: the GPU's name, the CPU's threads, the RAM,
 * the primary display in physical pixels, and the free space on the drive the
 * recordings are kept on (index.js keeps them in userData/recording).
 *
 * WITH THEM GO THE RECORDER'S OWN TWO ASKS. What the recorder's gate puts to
 * the GPU's encoder at 720p and at 1080p on this display, built by
 * recorder.js's fitSize, codecFor and bitrateFor, so the check asks exactly
 * what a session will: on a 16:9 display of 1920x1080 or more that is
 * 1280x720 at avc1.42E01F and 3 Mbps, and 1920x1080 at avc1.42E028 and 6
 * Mbps, at 30 fps, prefer-hardware. The page puts them to VideoEncoder
 * itself, since WebCodecs is a page's and not main's, and
 * src/renderer/onboarding/pc-rules.js turns the answers into a
 * recommendation.
 *
 * Measured on the PC 8.3 was built on (an RTX 5060, an i5-14400F, 32 GB, one
 * 1920x1080 display): getGPUInfo('basic') named the GPU in 22 ms where
 * 'complete' took 260, and the encoder said yes at both sizes and no to VP9.
 * With hardware acceleration off (the boot checks) it said no at both.
 *
 * Every fact is read on its own, and one that cannot be read is null: a PC
 * check that fails halfway still answers with the rest.
 */
const os = require('os');
const path = require('path');
const { fitSize, codecFor, bitrateFor, realFreeBytes } = require('./recorder');

// The software adapter Windows lists beside every real GPU, "Microsoft Basic
// Render Driver" (vendor 0x1414): never the GPU a recording is encoded on.
const SOFTWARE_VENDOR = 0x1414;
// getGPUInfo answers in milliseconds; one stuck behind a busy GPU process is
// not worth holding the page for.
const GPU_WAIT_MS = 3000;

/**
 * The GPU's name from getGPUInfo('basic'). The first real device is the one
 * Chromium draws and encodes on (its GPUInfo.gpu, the list's head; 'basic'
 * marks none of them active, 'complete' marks that one), so on a laptop with
 * two it names the one a recording would use.
 */
function gpuName(info) {
  const all = info && Array.isArray(info.gpuDevice) ? info.gpuDevice : [];
  const real = all.filter((d) => d && d.vendorId !== SOFTWARE_VENDOR
    && typeof d.deviceString === 'string' && d.deviceString.trim()
    && !/basic render driver/i.test(d.deviceString));
  const pick = real.find((d) => d.active) || real[0];
  return pick ? pick.deviceString.trim().slice(0, 80) : null;
}

/** A screen Display's size in physical pixels, as recorder-window.js primarySource() takes it. */
function physical(display) {
  if (!display || !display.size) return null;
  const k = Number(display.scaleFactor) > 0 ? Number(display.scaleFactor) : 1;
  const width = Math.round(display.size.width * k);
  const height = Math.round(display.size.height * k);
  return width > 0 && height > 0 ? { width, height } : null;
}

/** The recorder's gate asks at 720p and 1080p for a display (null: the boxes themselves). */
function asks(display) {
  return ['720', '1080'].map((res) => {
    const size = fitSize(display, res);
    return { res, width: size.width, height: size.height, codec: codecFor(size), bitrate: bitrateFor(size, res) };
  });
}

/** 'C:' for a folder on drive C, null where there are no drive letters. */
function driveOf(dir) {
  try {
    const r = path.parse(path.resolve(String(dir))).root.replace(/[\\/]+$/, '');
    return r || null;
  } catch { return null; }
}

/** p's answer, or null once ms have passed without one. */
function within(p, ms) {
  let timer = null;
  const late = new Promise((resolve) => { timer = setTimeout(() => resolve(null), ms); });
  return Promise.race([p, late]).finally(() => clearTimeout(timer));
}

/**
 * What this PC has, every fact on its own and null where it cannot be read.
 * deps, all optional, for the tests: { app, screen, os, freeBytes(dir), root,
 * gpuWaitMs, log }.
 */
async function gather(deps) {
  const d = deps || {};
  const electron = d.app && d.screen ? null : require('electron');
  const app = d.app || electron.app;
  const screen = d.screen || electron.screen;
  const o = d.os || os;
  const freeBytes = d.freeBytes || realFreeBytes;
  const log = d.log || ((...a) => console.log(...a));
  let root = d.root || null;
  if (!root) { try { root = path.join(app.getPath('userData'), 'recording'); } catch { root = null; } }

  const out = { ok: true, gpu: null, cpu: null, threads: null, ramBytes: null, display: null, freeBytes: null, drive: null, asks: [] };
  try { out.gpu = gpuName(await within(app.getGPUInfo('basic'), Number(d.gpuWaitMs) > 0 ? Number(d.gpuWaitMs) : GPU_WAIT_MS)); } catch { /* not known */ }
  try {
    const cpus = o.cpus();
    out.threads = Array.isArray(cpus) && cpus.length ? cpus.length : null;
    out.cpu = cpus && cpus[0] && cpus[0].model ? String(cpus[0].model).trim() : null;
  } catch { /* not known */ }
  try { const m = Number(o.totalmem()); out.ramBytes = m > 0 ? m : null; } catch { /* not known */ }
  try { out.display = physical(screen.getPrimaryDisplay()); } catch { /* not known */ }
  if (root) {
    try { const n = freeBytes(root); out.freeBytes = Number.isFinite(n) && n >= 0 ? n : null; } catch { /* not known */ }
    out.drive = driveOf(root);
  }
  out.asks = asks(out.display);
  const gib = (n) => (n === null ? '?' : (n / 1024 ** 3).toFixed(1));
  log(`[pc-check] ${out.gpu || 'GPU unknown'}, ${out.cpu || 'CPU unknown'} with ${out.threads || '?'} threads,`
    + ` ${gib(out.ramBytes)} GiB RAM, display ${out.display ? `${out.display.width}x${out.display.height}` : '?'},`
    + ` ${gib(out.freeBytes)} GiB free on ${out.drive || '?'};`
    + ` asks ${out.asks.map((a) => `${a.width}x${a.height} ${a.codec}`).join(', ')}`);
  return out;
}

module.exports = { gather, gpuName, physical, asks, driveOf, SOFTWARE_VENDOR, GPU_WAIT_MS };
