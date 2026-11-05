'use strict';

/**
 * Pull each Valorant agent's icon from valorant-api.com into
 * assets/valorant/agents/<Key>.png, 256 by 256, the way npm run sync:lol
 * bundles League's champion icons.
 *
 * WHY BUNDLED. The Verdict's share image draws the player's agent on a canvas
 * and saves it as a PNG (renderer/shared/verdict-card.js). An image off the
 * network would need a CSP change, would not draw offline, and a cross origin
 * picture taints the canvas so the PNG could not be saved at all. A file in
 * assets/ ships in the installer (package.json files) and loads as 'self'.
 *
 * WHY 256. The API serves each icon at 1024 by 1024, about 420 KB, 13 MB for
 * the roster. The share image draws one at most about 100 pixels across, so
 * the script scales each to 256 with Electron's own nativeImage (no other
 * tool), about 2 MB for the roster. Run under plain Node it starts itself
 * again in Electron, with ELECTRON_RUN_AS_NODE removed (this shell exports it,
 * and Electron run as Node has no nativeImage).
 *
 * THE NAMES ARE THE GENERATED DATA'S. Only an agent valorant-data.generated.json
 * knows is written, under its key with every character but a letter or a
 * digit dropped (KAY/O is KAYO.png), which is what shared/agent-icons.js
 * asks for. An agent the API has and the data does not is reported, not
 * written: run npm run sync:valorant first.
 *
 * Only bytes that differ are written, so a rerun on the same patch changes
 * nothing in git.
 *
 *   npm run sync:agenticons
 */

const fs = require('fs');
const path = require('path');

const SIZE = 256;

if (!process.versions.electron || process.env.ELECTRON_RUN_AS_NODE) {
  // Plain Node: start this file again in Electron, whose nativeImage scales.
  const { spawnSync } = require('child_process');
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const electron = require('electron');
  const run = spawnSync(String(electron), [__filename], { env, stdio: 'inherit' });
  process.exit(typeof run.status === 'number' ? run.status : 1);
}

const { app, nativeImage } = require('electron');
const { iconKey } = require('../src/shared/agent-icons');

const API = 'https://valorant-api.com/v1/agents?isPlayableCharacter=true';
const OUT = path.join(__dirname, '..', 'assets', 'valorant', 'agents');
const DATA = require('../src/shared/valorant-data.generated.json');
const UA = { 'user-agent': 'Mozilla/5.0 (compatible; Occlara agent icon sync)' };

async function main() {
  const r = await fetch(API, { headers: UA });
  if (!r.ok) throw new Error(`${API} returned HTTP ${r.status}`);
  const body = await r.json();
  const list = Array.isArray(body && body.data) ? body.data : [];
  const known = new Map(Object.keys(DATA.agents || {}).map((n) => [iconKey(n), n]));
  if (list.length < 10 || !known.size) throw new Error(`only ${list.length} agents returned, the shape has changed. Nothing written.`);
  fs.mkdirSync(OUT, { recursive: true });
  let wrote = 0;
  let same = 0;
  const missing = [];
  const unknown = [];
  for (const a of list) {
    const key = iconKey(a.displayName);
    if (!key || !known.has(key)) { unknown.push(a.displayName); continue; }
    if (!a.displayIcon) { missing.push(a.displayName); continue; }
    const res = await fetch(a.displayIcon, { headers: UA });
    if (!res.ok) { missing.push(a.displayName); continue; }
    const img = nativeImage.createFromBuffer(Buffer.from(await res.arrayBuffer()));
    if (img.isEmpty()) { missing.push(a.displayName); continue; }
    const buf = img.resize({ width: SIZE, height: SIZE, quality: 'best' }).toPNG();
    const dest = path.join(OUT, `${key}.png`);
    if (fs.existsSync(dest) && fs.readFileSync(dest).equals(buf)) { same++; continue; }
    fs.writeFileSync(dest, buf);
    wrote++;
  }
  const have = new Set(fs.readdirSync(OUT).map((f) => f.replace(/\.png$/, '')));
  const without = [...known.keys()].filter((k) => !have.has(k)).map((k) => known.get(k));
  console.log(`[agents] ${wrote} written, ${same} unchanged`);
  if (unknown.length) console.log(`[agents] not in the generated data, skipped: ${unknown.join(', ')}`);
  if (missing.length) console.log(`[agents] no icon fetched: ${missing.join(', ')}`);
  if (without.length) {
    console.log(`[agents] FAIL, the data knows agents with no icon: ${without.join(', ')}`);
    return 1;
  }
  return 0;
}

app.whenReady()
  .then(main)
  .then((code) => app.exit(code))
  .catch((e) => { console.error(`[agents] ${e.message}`); app.exit(1); });
