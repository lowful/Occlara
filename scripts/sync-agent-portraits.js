'use strict';

/**
 * Pull each playable agent's full portrait from valorant-api.com into
 * assets/agents-full/<Agent>.webp, 720 pixels tall (Orbit, Nov 2026: Home's
 * hero and the review's hero show the player's agent standing in front of the
 * moon). The head icons beside it are sync-agent-icons.js's.
 *
 * WHY BUNDLED. The renderer CSP is img-src 'self' data:, so a picture off the
 * network would need a CSP change and would not draw offline. A file in
 * assets/ ships in the installer (package.json files) and loads as 'self'.
 *
 * WHY TRIMMED. The API serves each portrait on a canvas of about 2048 by 1860
 * with the figure somewhere in its middle and a lot of nothing round it. Each
 * is cut to its own drawn pixels (alpha over ALPHA_MIN) plus a small margin,
 * then scaled to HEIGHT, so every agent stands the same height on the page and
 * no file carries empty canvas.
 *
 * WHY WEBP BY THE BUNDLED FFMPEG. It keeps the transparency, is a fraction of
 * the PNG, and ffmpeg-static is already a dependency (no Electron needed, so
 * this runs under plain node). All of them together stay under BUDGET; the
 * run fails past it.
 *
 * THE NAMES ARE THE GENERATED DATA'S. Only an agent valorant-data.generated.json
 * lists is written, under its name with every character but a letter or a
 * digit dropped (KAY/O is KAYO), which is what shared/agent-portraits.js asks
 * for. The run fails if the data knows an agent with no portrait.
 *
 * NEVER IN THE TRAINER. These are Riot's art, fine in a review of the player's
 * own match (Valorant art in the app's reviews is the owner's call), and never
 * used by the Trainer, which ships nothing of Riot's (trainer.md).
 *
 * Only bytes that differ are written, so a rerun on the same patch changes
 * nothing in git.
 *
 *   npm run sync:agentportraits
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const ffmpeg = require('ffmpeg-static');
const { iconKey } = require('../src/shared/agent-icons');

const API = 'https://valorant-api.com/v1/agents?isPlayableCharacter=true';
const OUT = path.join(__dirname, '..', 'assets', 'agents-full');
const DATA = require('../src/shared/valorant-data.generated.json');
const UA = { 'user-agent': 'Mozilla/5.0 (compatible; Occlara agent portrait sync)' };
const HEIGHT = 720;
const QUALITY = 80;
const ALPHA_MIN = 10;
const MARGIN = 0.015;
const BUDGET = 4 * 1024 * 1024;

/** A PNG's own width and height, from its header. */
function pngSize(buf) {
  if (buf.length < 24 || buf.readUInt32BE(12) !== 0x49484452) return null;
  return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
}

function run(args, input) {
  const r = spawnSync(ffmpeg, args, { input, maxBuffer: 256 * 1024 * 1024, windowsHide: true });
  if (r.status !== 0) throw new Error(`ffmpeg failed: ${String(r.stderr || '').trim().split('\n').pop()}`);
  return r.stdout;
}

/** The box of the pixels actually drawn (alpha over ALPHA_MIN), or null for an empty canvas. */
function drawnBox(rgba, w, h) {
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) {
    const row = y * w * 4;
    for (let x = 0; x < w; x++) {
      if (rgba[row + x * 4 + 3] > ALPHA_MIN) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  return x1 < 0 ? null : { x0, y0, x1, y1 };
}

/** One portrait PNG cut to its figure and written as a WebP HEIGHT pixels tall. */
function portraitWebp(png) {
  const size = pngSize(png);
  if (!size) throw new Error('not a PNG');
  const rgba = run(['-v', 'error', '-i', 'pipe:0', '-f', 'rawvideo', '-pix_fmt', 'rgba', 'pipe:1'], png);
  if (rgba.length !== size.w * size.h * 4) throw new Error('the decoded size is not the header\'s');
  const box = drawnBox(rgba, size.w, size.h);
  if (!box) throw new Error('an empty canvas');
  const pad = Math.round((box.y1 - box.y0 + 1) * MARGIN);
  const x = Math.max(0, box.x0 - pad), y = Math.max(0, box.y0 - pad);
  const cw = Math.min(size.w, box.x1 + pad + 1) - x, ch = Math.min(size.h, box.y1 + pad + 1) - y;
  // TO A FILE, NEVER A PIPE: ffmpeg's WebP muxer writes the RIFF size last,
  // by seeking back, and cannot on a pipe, which leaves it 0. Chromium then
  // refuses the picture (onerror) while other decoders shrug it off.
  const tmp = path.join(os.tmpdir(), `occlara-portrait-${process.pid}-${Date.now()}.webp`);
  try {
    run(['-v', 'error', '-y', '-i', 'pipe:0',
      '-vf', `crop=${cw}:${ch}:${x}:${y},scale=-2:${HEIGHT}:flags=lanczos,format=yuva420p`,
      '-c:v', 'libwebp', '-quality', String(QUALITY), '-compression_level', '6', '-preset', 'picture',
      '-frames:v', '1', tmp], png);
    const out = fs.readFileSync(tmp);
    if (out.length < 16 || out.readUInt32LE(4) + 8 !== out.length) throw new Error('the WebP\'s RIFF size is not its length');
    return out;
  } finally {
    try { fs.unlinkSync(tmp); } catch (e) { /* not written */ }
  }
}

async function main() {
  const r = await fetch(API, { headers: UA });
  if (!r.ok) throw new Error(`${API} returned HTTP ${r.status}`);
  const body = await r.json();
  const list = Array.isArray(body && body.data) ? body.data : [];
  const known = new Map(Object.keys(DATA.agents || {}).map((n) => [iconKey(n), n]));
  if (list.length < 20 || !known.size) throw new Error(`only ${list.length} agents returned, the shape has changed. Nothing written.`);
  fs.mkdirSync(OUT, { recursive: true });
  let wrote = 0, same = 0, total = 0;
  const missing = [];
  const seen = new Set();
  const sizes = [];
  for (const a of list) {
    const key = iconKey(a && a.displayName);
    if (!key || !known.has(key) || seen.has(key)) continue;
    const url = a.fullPortrait || a.fullPortraitV2;
    if (!url) { missing.push(a.displayName); continue; }
    const res = await fetch(url, { headers: UA });
    if (!res.ok) { missing.push(a.displayName); continue; }
    let buf;
    try { buf = portraitWebp(Buffer.from(await res.arrayBuffer())); } catch (e) { missing.push(`${a.displayName} (${e.message})`); continue; }
    seen.add(key);
    total += buf.length;
    sizes.push(`${key} ${Math.round(buf.length / 1024)} KB`);
    const dest = path.join(OUT, `${key}.webp`);
    if (fs.existsSync(dest) && fs.readFileSync(dest).equals(buf)) { same++; continue; }
    fs.writeFileSync(dest, buf);
    wrote++;
  }
  const without = [...known.keys()].filter((k) => !seen.has(k)).map((k) => known.get(k));
  console.log(`[portraits] ${wrote} written, ${same} unchanged, ${seen.size} in all, ${(total / 1024 / 1024).toFixed(2)} MB`);
  console.log(`[portraits] ${sizes.join(', ')}`);
  if (missing.length) console.log(`[portraits] not fetched: ${missing.join(', ')}`);
  let code = 0;
  if (without.length) { console.log(`[portraits] FAIL, the data knows agents with no portrait: ${without.join(', ')}`); code = 1; }
  if (total > BUDGET) { console.log(`[portraits] FAIL, ${(total / 1024 / 1024).toFixed(2)} MB is over the ${BUDGET / 1024 / 1024} MB budget`); code = 1; }
  return code;
}

main()
  .then((code) => process.exit(code))
  .catch((e) => { console.error(`[portraits] ${e.message}`); process.exit(1); });
