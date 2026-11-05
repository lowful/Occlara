#!/usr/bin/env node
'use strict';

/**
 * Pull each gun's kill feed icon from valorant-api.com into
 * assets/valorant/weapons/<Name>.png, the white silhouette the game's own kill
 * feed draws, the way npm run sync:agenticons bundles the agents' icons beside
 * them. The review's killer card draws them (valorant-icons.js weaponIcon,
 * review.js killerCardEl), so a review opens with no network (img-src 'self').
 *
 * The file name is the gun's display name with every character but a letter
 * or a digit dropped (valorant-icons.js fileOf); the knife is Melee. The API
 * serves them small (384 by 96, a few KB each), so they are written as they
 * come. FAILS CLOSED: fewer than 15 guns, or an icon that will not download,
 * and nothing is written. Only bytes that differ are written, so a rerun on
 * the same patch changes nothing in git.
 *
 *   npm run sync:weaponicons
 */

const fs = require('fs');
const path = require('path');
const { fileOf } = require(path.join(__dirname, '..', 'src', 'shared', 'valorant-icons.js'));

const API = 'https://valorant-api.com/v1/weapons';
const OUT = path.join(__dirname, '..', 'assets', 'valorant', 'weapons');
const UA = { 'user-agent': 'Mozilla/5.0 (compatible; Occlara weapon icon sync)' };

async function main() {
  const r = await fetch(API, { headers: UA });
  if (!r.ok) throw new Error(`${API} returned HTTP ${r.status}`);
  const body = await r.json();
  const guns = (Array.isArray(body && body.data) ? body.data : [])
    .filter((w) => w && w.displayName && w.killStreamIcon);
  if (guns.length < 15) throw new Error(`only ${guns.length} guns, the shape has changed. Nothing written.`);
  const files = [];
  for (const g of guns) {
    const file = fileOf(g.displayName);
    if (!file) throw new Error(`no file name for ${g.displayName}. Nothing written.`);
    const got = await fetch(g.killStreamIcon, { headers: UA });
    if (!got.ok) throw new Error(`${g.killStreamIcon} returned HTTP ${got.status}. Nothing written.`);
    files.push({ to: path.join(OUT, `${file}.png`), buf: Buffer.from(await got.arrayBuffer()) });
  }
  fs.mkdirSync(OUT, { recursive: true });
  let wrote = 0;
  for (const f of files) {
    const had = fs.existsSync(f.to) ? fs.readFileSync(f.to) : null;
    if (had && had.equals(f.buf)) continue;
    fs.writeFileSync(f.to, f.buf);
    wrote++;
  }
  console.log(`[weapon-icons] ${guns.length} guns, ${wrote} written to assets/valorant/weapons`);
}

main().catch((e) => {
  console.error(`[weapon-icons] ${e.message}`);
  process.exit(1);
});
