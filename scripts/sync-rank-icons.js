'use strict';

/**
 * Pull Valorant's competitive tier icons from valorant-api.com into
 * assets/ranks/<slug>.webp, SIZE pixels square (9.1, the owner's item 10: the
 * rank card on Home and on Stats shows the player's real rank icon, the right
 * tier and division, beside the rank).
 *
 * WHY BUNDLED. The renderer CSP is img-src 'self' data:, so a picture off the
 * network would need a CSP change and would not draw offline. A file in
 * assets/ ships in the installer (package.json files) and loads as 'self'.
 *
 * WHICH SET. valorant-api.com lists one tier table per era of the ladder
 * (before Ascendant, after it); the newest is the one the game uses now, and
 * it must name every tier src/shared/rank-tiers.js knows, by Riot's tier
 * number (3 is Iron 1, 27 is Radiant, 0 is Unranked), or nothing is written.
 *
 * WHY WEBP BY THE BUNDLED FFMPEG. It keeps the transparency, is a fraction of
 * the PNG, and ffmpeg-static is already a dependency (plain node, no
 * Electron). SIZE is twice the largest the app draws one (64px), so it is
 * sharp at 2x. Written to a file, never a pipe: ffmpeg's WebP muxer writes
 * the RIFF size by seeking back, a pipe leaves it 0, and Chromium refuses the
 * picture (docs/claude/ui.md, the agent portraits' trap).
 *
 * NEVER IN THE TRAINER. Riot's art, fine on the player's own rank (Valorant
 * art in the app is the owner's call), and never used by the Trainer, which
 * ships nothing of Riot's (trainer.md).
 *
 * Only bytes that differ are written, so a rerun on the same patch changes
 * nothing in git.
 *
 *   npm run sync:rankicons
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const ffmpeg = require('ffmpeg-static');
const { TIERS, SLUGS } = require('../src/shared/rank-tiers');

const API = 'https://valorant-api.com/v1/competitivetiers';
const OUT = path.join(__dirname, '..', 'assets', 'ranks');
const UA = { 'user-agent': 'Mozilla/5.0 (compatible; Occlara rank icon sync)' };
const SIZE = 128;
const QUALITY = 92;
const BUDGET = 1024 * 1024;

function run(args, input) {
  const r = spawnSync(ffmpeg, args, { input, maxBuffer: 64 * 1024 * 1024, windowsHide: true });
  if (r.status !== 0) throw new Error(`ffmpeg failed: ${String(r.stderr || '').trim().split('\n').pop()}`);
  return r.stdout;
}

/** One icon PNG as a SIZE pixel square WebP with its alpha. */
function iconWebp(png) {
  if (png.length < 24 || png.readUInt32BE(12) !== 0x49484452) throw new Error('not a PNG');
  const tmp = path.join(os.tmpdir(), `occlara-rank-${process.pid}-${Date.now()}.webp`);
  try {
    run(['-v', 'error', '-y', '-i', 'pipe:0',
      '-vf', `scale=${SIZE}:${SIZE}:flags=lanczos,format=yuva420p`,
      '-c:v', 'libwebp', '-quality', String(QUALITY), '-compression_level', '6', '-preset', 'icon',
      '-frames:v', '1', tmp], png);
    const out = fs.readFileSync(tmp);
    if (out.length < 16 || out.readUInt32LE(4) + 8 !== out.length) throw new Error('the WebP\'s RIFF size is not its length');
    return out;
  } finally {
    try { fs.unlinkSync(tmp); } catch (e) { /* not written */ }
  }
}

/** The slug of an API tier name ("DIAMOND 1", "RADIANT", "UNRANKED"). */
const slugOfApi = (name) => String(name || '').trim().toLowerCase().replace(/\s+/g, '-');

async function main() {
  const r = await fetch(API, { headers: UA });
  if (!r.ok) throw new Error(`${API} returned HTTP ${r.status}`);
  const body = await r.json();
  const sets = Array.isArray(body && body.data) ? body.data : [];
  // The newest table: the last listed that names every tier the ladder knows.
  const want = new Map(TIERS.map((t, i) => [i + 3, t.toLowerCase().replace(' ', '-')]));
  want.set(0, 'unranked');
  const fits = (set) => set && Array.isArray(set.tiers) && [...want].every(([n, slug]) => {
    const t = set.tiers.find((x) => x && x.tier === n);
    return t && slugOfApi(t.tierName) === slug && typeof t.largeIcon === 'string' && t.largeIcon;
  });
  const set = sets.slice().reverse().find(fits);
  if (!set) throw new Error(`no tier table names all ${want.size} tiers the ladder knows, the shape has changed. Nothing written.`);
  fs.mkdirSync(OUT, { recursive: true });
  let wrote = 0, same = 0, total = 0;
  for (const [n, slug] of want) {
    const t = set.tiers.find((x) => x && x.tier === n);
    const res = await fetch(t.largeIcon, { headers: UA });
    if (!res.ok) throw new Error(`${slug}: HTTP ${res.status}`);
    const buf = iconWebp(Buffer.from(await res.arrayBuffer()));
    total += buf.length;
    const dest = path.join(OUT, `${slug}.webp`);
    if (fs.existsSync(dest) && fs.readFileSync(dest).equals(buf)) { same++; continue; }
    fs.writeFileSync(dest, buf);
    wrote++;
  }
  const stray = fs.readdirSync(OUT).filter((f) => !SLUGS.includes(f.replace(/\.webp$/, '')));
  console.log(`[ranks] ${set.assetObjectName || set.uuid}: ${wrote} written, ${same} unchanged, ${want.size} in all, ${(total / 1024).toFixed(0)} KB`);
  let code = 0;
  if (stray.length) { console.log(`[ranks] FAIL, files the ladder does not know: ${stray.join(', ')}`); code = 1; }
  if (total > BUDGET) { console.log(`[ranks] FAIL, ${(total / 1024).toFixed(0)} KB is over the ${BUDGET / 1024} KB budget`); code = 1; }
  return code;
}

main()
  .then((code) => process.exit(code))
  .catch((e) => { console.error(`[ranks] ${e.message}`); process.exit(1); });
