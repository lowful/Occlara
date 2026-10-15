#!/usr/bin/env node
'use strict';

/**
 * Sync Occlara's Valorant game data from valorant-api.com (a mirror of the
 * game's own files, updated every patch). Regenerates the VERIFIABLE data that
 * used to be hand-maintained and drift out of date, agent roster + roles +
 * ability names, the map pool + which maps have three sites, and the distinctive
 * map callouts, into valorant-data.generated.json.
 *
 * And, since 8.5.0, what the Valorant primer (server/services/game-primer.js)
 * prints and computes from: every gun's head, body and leg damage by band, its
 * fire rate, magazine, reload, draw, running speed, first bullet spread, aimed
 * burst, pellets, alt fire and wall penetration; the armour (cost, the share of
 * each hit it takes, what it absorbs before it breaks, the Regen Shield's
 * pool); each agent's kit on its default keys in the game's own words; Riot's
 * description of each role; Standard's and Swiftplay's own rules; the live
 * patch; and each map's minimap transform.
 *
 * THE EXTRACTION IS server/services/valorant-extract.js, not this file, so the
 * server's live version check reads the live data with exactly the code that
 * wrote the synced copy. This script fetches, extracts, prints what changed and
 * writes. It FAILS CLOSED: fewer than 15 guns, a missing armour, an agent
 * missing a used slot or a description, a gun or gear item the primer does not
 * know, a field the API renamed, and nothing is written.
 *
 * What stays hand-authored (coaching flavor, not facts): the per-agent casual
 * tip, the generic ability kit categories, and community callout names the game
 * files do not use (Hookah, Showers). Those live in code and are merged on top.
 *
 * Run:  npm run sync:valorant
 *       npm run sync:valorant -- --out <dir>   writes both copies under <dir>
 *                                              instead, to compare before a write
 * Then run npm run check:primer (a changed number reaches no player before it
 * has), and commit the regenerated json files. The client (src/) and server
 * (server/) deploy separately, so an identical copy is written to each.
 */

const fs = require('fs');
const path = require('path');
const extract = require(path.join(__dirname, '..', 'server', 'services', 'valorant-extract.js'));

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`);
  const j = await res.json();
  if (!j || j.data === undefined || j.data === null) throw new Error(`${url} -> no data`);
  return j.data;
}

function diff(label, prev, next) {
  const lines = [];
  const pk = new Set(Object.keys(prev || {}));
  const nk = new Set(Object.keys(next || {}));
  for (const k of nk) if (!pk.has(k)) lines.push(`  + ${label} added: ${k}`);
  for (const k of pk) if (!nk.has(k)) lines.push(`  - ${label} removed: ${k}`);
  for (const k of nk) {
    if (pk.has(k) && JSON.stringify(prev[k]) !== JSON.stringify(next[k])) {
      lines.push(`  ~ ${label} changed: ${k}  ${JSON.stringify(prev[k])} -> ${JSON.stringify(next[k])}`);
    }
  }
  return lines;
}

async function main() {
  const outAt = process.argv.indexOf('--out');
  const outDir = outAt > 0 ? process.argv[outAt + 1] : null;
  if (outAt > 0 && !outDir) throw new Error('--out needs a directory');

  console.log('Fetching valorant-api.com ...');
  const names = Object.keys(extract.ENDPOINTS);
  const replies = await Promise.all(names.map((n) => fetchJson(extract.ENDPOINTS[n])));
  const raw = Object.fromEntries(names.map((n, i) => [n, replies[i]]));

  // Throws, naming every problem, when the data fails closed. Nothing written.
  const built = extract.extract(raw);

  const data = {
    generatedAt: new Date().toISOString(),
    source: 'valorant-api.com',
    ...built,
  };

  // Diff against the current client copy so per-patch changes are visible.
  const clientPath = path.join(__dirname, '..', 'src', 'shared', 'valorant-data.generated.json');
  let prev = {};
  try { prev = JSON.parse(fs.readFileSync(clientPath, 'utf8')); } catch {}
  const changes = [
    ...diff('patch', { patch: prev.patch, version: prev.version }, { patch: data.patch, version: data.version }),
    ...diff('agent', prev.agents, data.agents),
    ...diff('role', prev.roles, data.roles),
    ...diff('callout', prev.mapCallouts, data.mapCallouts),
    ...diff('map', Object.fromEntries((prev.maps || []).map((m) => [m, 1])), Object.fromEntries(data.maps.map((m) => [m, 1]))),
    // Damage changes every patch and the primer and playbook notes quote these
    // numbers, so a silent rebalance is exactly the drift worth printing.
    ...diff('weapon', prev.weapons, data.weapons),
    ...diff('gear', prev.gear, data.gear),
    ...diff('mode', prev.modes, data.modes),
  ];

  const json = JSON.stringify(data, null, 2) + '\n';
  const targets = outDir
    ? [path.join(outDir, 'src', 'shared', 'valorant-data.generated.json'), path.join(outDir, 'server', 'valorant-data.generated.json')]
    : [clientPath, path.join(__dirname, '..', 'server', 'valorant-data.generated.json')];
  for (const t of targets) {
    fs.mkdirSync(path.dirname(t), { recursive: true });
    fs.writeFileSync(t, json);
  }

  const geoTotal = Object.values(data.mapGeometry).reduce((s, g) => s + g.callouts.length, 0);
  console.log(`\nPatch ${data.patch} (${data.version}, built ${data.buildDate})`);
  console.log(`Agents: ${Object.keys(data.agents).length} | Maps: ${data.maps.length} (3-site: ${data.threeSiteMaps.join(', ')}) | Callouts: ${Object.keys(data.mapCallouts).length}`);
  console.log(`Minimap geometry: ${Object.keys(data.mapGeometry).length} maps, ${geoTotal} placed callouts`);
  const fallers = Object.values(data.weapons).filter((w) => w.fallsOff).length;
  console.log(`Weapons: ${Object.keys(data.weapons).length} with damage tables, ${fallers} with falloff`);
  console.log(`Gear: ${Object.keys(data.gear).join(', ')} | Modes: standard first to ${data.modes.standard.win}, `
    + `swiftplay first to ${data.modes.swiftplay.win} in halves of ${data.modes.swiftplay.roundsPerHalf}`);
  console.log(changes.length ? '\nChanges since last sync:\n' + changes.join('\n') : '\nNo changes since last sync.');
  console.log(`\nWrote:\n  ${targets.join('\n  ')}`);
  console.log('\nNext: npm run check:primer, then commit both copies.');
}

main().catch((e) => { console.error('sync failed:', e.message); process.exit(1); });
