'use strict';

/**
 * Pull each Valorant map's splash from valorant-api.com into
 * assets/valorant/maps/<Name>.jpg, 1280 wide, the way sync-agent-icons.js
 * bundles the agents (Progress v3: the last match card, the review's header
 * and the Recording screen draw the map behind a dark scrim).
 *
 * WHY BUNDLED. The renderer CSP is img-src 'self' data:, so a picture off the
 * network would need a CSP change and would not draw offline. A file in
 * assets/ ships in the installer (package.json files) and loads as 'self'.
 *
 * WHY JPEG AT 1280. The API serves each splash at 1920 by 1080 as a PNG of
 * 2 to 4 MB. It is only ever drawn dimmed behind a scrim, at most about 800
 * pixels across, so Electron's own nativeImage scales it to 1280 and writes a
 * JPEG of quality 78 (nativeImage writes no WebP), about 150 KB a map. Run
 * under plain Node it starts itself again in Electron, with
 * ELECTRON_RUN_AS_NODE removed (this shell exports it).
 *
 * THE NAMES ARE THE GENERATED DATA'S. Only a map valorant-data.generated.json
 * lists is written, under its name with every character but a letter or a
 * digit dropped, which is what shared/agent-icons.js mapArtOf asks for. The
 * range and the team deathmatch arenas are skipped.
 *
 * Only bytes that differ are written, so a rerun on the same patch changes
 * nothing in git.
 *
 *   npm run sync:mapart
 */

const fs = require('fs');
const path = require('path');

const WIDTH = 1280;
const QUALITY = 78;

if (!process.versions.electron || process.env.ELECTRON_RUN_AS_NODE) {
  const { spawnSync } = require('child_process');
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const electron = require('electron');
  const run = spawnSync(String(electron), [__filename], { env, stdio: 'inherit' });
  process.exit(typeof run.status === 'number' ? run.status : 1);
}

const { app, nativeImage } = require('electron');
const { iconKey } = require('../src/shared/agent-icons');

const API = 'https://valorant-api.com/v1/maps';
const OUT = path.join(__dirname, '..', 'assets', 'valorant', 'maps');
const DATA = require('../src/shared/valorant-data.generated.json');
const UA = { 'user-agent': 'Mozilla/5.0 (compatible; Occlara map art sync)' };

async function main() {
  const r = await fetch(API, { headers: UA });
  if (!r.ok) throw new Error(`${API} returned HTTP ${r.status}`);
  const body = await r.json();
  const list = Array.isArray(body && body.data) ? body.data : [];
  const known = new Map((DATA.maps || []).map((n) => [iconKey(n), n]));
  if (list.length < 8 || !known.size) throw new Error(`only ${list.length} maps returned, the shape has changed. Nothing written.`);
  fs.mkdirSync(OUT, { recursive: true });
  let wrote = 0;
  let same = 0;
  const missing = [];
  const seen = new Set();
  for (const m of list) {
    const key = iconKey(m.displayName);
    if (!key || !known.has(key) || seen.has(key)) continue;
    if (!m.splash) { missing.push(m.displayName); continue; }
    const res = await fetch(m.splash, { headers: UA });
    if (!res.ok) { missing.push(m.displayName); continue; }
    const img = nativeImage.createFromBuffer(Buffer.from(await res.arrayBuffer()));
    if (img.isEmpty()) { missing.push(m.displayName); continue; }
    seen.add(key);
    const buf = img.resize({ width: WIDTH, quality: 'best' }).toJPEG(QUALITY);
    const dest = path.join(OUT, `${key}.jpg`);
    if (fs.existsSync(dest) && fs.readFileSync(dest).equals(buf)) { same++; continue; }
    fs.writeFileSync(dest, buf);
    wrote++;
  }
  const without = [...known.keys()].filter((k) => !seen.has(k)).map((k) => known.get(k));
  console.log(`[maps] ${wrote} written, ${same} unchanged`);
  if (missing.length) console.log(`[maps] no splash fetched: ${missing.join(', ')}`);
  if (without.length) {
    console.log(`[maps] FAIL, the data knows maps with no art: ${without.join(', ')}`);
    return 1;
  }
  return 0;
}

app.whenReady()
  .then(main)
  .then((code) => app.exit(code))
  .catch((e) => { console.error(`[maps] ${e.message}`); app.exit(1); });
