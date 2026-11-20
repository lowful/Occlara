#!/usr/bin/env node
'use strict';

/**
 * Pull the guns' kill feed icons and the agents' ability icons from
 * valorant-api.com into assets/, and write the index the app reads them by,
 * the way npm run sync:agenticons bundles the agents' icons beside them. A
 * page draws them with no network (img-src 'self').
 *
 *   assets/valorant/weapons/<Name>.png         each gun's killStreamIcon (the
 *                                              white silhouette the game's kill
 *                                              feed draws), else its displayIcon;
 *                                              the knife is Melee
 *   assets/valorant/abilities/<Agent>-<Slot>.png
 *                                              each playable agent's four
 *                                              abilities (Ability1, Ability2,
 *                                              Grenade, Ultimate), white on
 *                                              transparent
 *   src/shared/valorant-kit-icons.generated.json
 *                                              { weapons: { name: file },
 *                                                abilities: { agent: [{ slot, key,
 *                                                name, file }] } }
 *
 * THE NAMES ARE THE GENERATED DATA'S. A file is named by the gun's display
 * name or the agent's key in valorant-data.generated.json with every
 * character but a letter or a digit dropped (valorant-icons.js fileOf, KAY/O
 * is KAYO), and an ability by its SLOT, not its name, so a renamed ability
 * keeps its file. Only an agent the data knows is written: run
 * npm run sync:valorant first. The passive is not an ability a player casts
 * and most have no icon, so it is left out.
 *
 * The API serves them small (guns 384 by 96, abilities 128 by 128, a few KB
 * each), so they are written as they come. FAILS CLOSED: fewer than 15 guns,
 * fewer than 20 agents, an agent missing one of its four icons, or an icon
 * that will not download, and nothing is written. Only bytes that differ are
 * written, so a rerun on the same patch changes nothing in git.
 *
 *   npm run sync:kiticons   (npm run sync:weaponicons runs the same)
 */

const fs = require('fs');
const path = require('path');
const { fileOf } = require(path.join(__dirname, '..', 'src', 'shared', 'valorant-icons.js'));
const data = require(path.join(__dirname, '..', 'src', 'shared', 'valorant-data.generated.json'));

const WEAPONS_API = 'https://valorant-api.com/v1/weapons';
const AGENTS_API = 'https://valorant-api.com/v1/agents?isPlayableCharacter=true';
const ROOT = path.join(__dirname, '..');
const WEAPONS_OUT = path.join(ROOT, 'assets', 'valorant', 'weapons');
const ABILITIES_OUT = path.join(ROOT, 'assets', 'valorant', 'abilities');
const INDEX = path.join(ROOT, 'src', 'shared', 'valorant-kit-icons.generated.json');
const UA = { 'user-agent': 'Mozilla/5.0 (compatible; Occlara kit icon sync)' };
const SLOTS = ['Ability1', 'Ability2', 'Grenade', 'Ultimate'];
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47]);

async function json(url) {
  const r = await fetch(url, { headers: UA });
  if (!r.ok) throw new Error(`${url} returned HTTP ${r.status}. Nothing written.`);
  const body = await r.json();
  return Array.isArray(body && body.data) ? body.data : [];
}

async function png(url) {
  const got = await fetch(url, { headers: UA });
  if (!got.ok) throw new Error(`${url} returned HTTP ${got.status}. Nothing written.`);
  const buf = Buffer.from(await got.arrayBuffer());
  if (!buf.subarray(0, 4).equals(PNG)) throw new Error(`${url} is not a PNG. Nothing written.`);
  return buf;
}

const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');

async function main() {
  const files = [];

  // The guns.
  const guns = (await json(WEAPONS_API)).filter((w) => w && w.displayName && (w.killStreamIcon || w.displayIcon));
  if (guns.length < 15) throw new Error(`only ${guns.length} guns, the shape has changed. Nothing written.`);
  const weapons = {};
  for (const g of guns) {
    const file = fileOf(g.displayName);
    if (!file) throw new Error(`no file name for ${g.displayName}. Nothing written.`);
    files.push({ to: path.join(WEAPONS_OUT, `${file}.png`), buf: await png(g.killStreamIcon || g.displayIcon) });
    weapons[g.displayName] = `${file}.png`;
  }

  // The agents' four abilities, for the agents the game data knows.
  const known = new Map(Object.keys(data.agents || {}).map((a) => [norm(a), a]));
  const agents = (await json(AGENTS_API)).filter((a) => a && a.displayName && Array.isArray(a.abilities));
  if (agents.length < 20) throw new Error(`only ${agents.length} agents, the shape has changed. Nothing written.`);
  const abilities = {};
  const unknown = [];
  for (const a of agents) {
    const key = known.get(norm(a.displayName));
    if (!key) { unknown.push(a.displayName); continue; }
    const kit = (data.agents[key] && Array.isArray(data.agents[key].kit)) ? data.agents[key].kit : [];
    const list = [];
    for (const slot of SLOTS) {
      const ab = a.abilities.find((x) => x && x.slot === slot);
      if (!ab || !ab.displayName || !ab.displayIcon) throw new Error(`${a.displayName} has no ${slot} icon. Nothing written.`);
      const file = `${fileOf(key)}-${slot}.png`;
      files.push({ to: path.join(ABILITIES_OUT, file), buf: await png(ab.displayIcon) });
      const k = kit.find((x) => x && x.slot === slot);
      list.push({ slot, key: (k && k.key) || null, name: ab.displayName, file });
    }
    abilities[key] = list;
  }

  fs.mkdirSync(WEAPONS_OUT, { recursive: true });
  fs.mkdirSync(ABILITIES_OUT, { recursive: true });
  let wrote = 0;
  for (const f of files) {
    const had = fs.existsSync(f.to) ? fs.readFileSync(f.to) : null;
    if (had && had.equals(f.buf)) continue;
    fs.writeFileSync(f.to, f.buf);
    wrote++;
  }
  const sorted = (o) => Object.fromEntries(Object.keys(o).sort().map((k) => [k, o[k]]));
  const index = JSON.stringify({ weapons: sorted(weapons), abilities: sorted(abilities) }, null, 2) + '\n';
  const hadIndex = fs.existsSync(INDEX) ? fs.readFileSync(INDEX, 'utf8') : null;
  if (hadIndex !== index) { fs.writeFileSync(INDEX, index); wrote++; }
  const n = Object.keys(abilities).length;
  console.log(`[kit-icons] ${guns.length} guns, ${n} agents, ${n * SLOTS.length} abilities, ${wrote} files written`);
  if (unknown.length) console.log(`[kit-icons] not in the game data, skipped (run npm run sync:valorant): ${unknown.join(', ')}`);
}

main().catch((e) => {
  console.error(`[kit-icons] ${e.message}`);
  process.exit(1);
});
