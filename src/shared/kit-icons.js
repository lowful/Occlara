'use strict';

/*
 * WHAT KILLED THE PLAYER, AS AN ICON (Nov 2026). Riot's record names a kill's
 * weapon by name (riot-rounds.js weaponOf): a gun ("Vandal"), the knife
 * ("Melee"), or an agent's ability when the kill was one ("Headhunter",
 * "Blade Storm"). This turns that name into the bundled icon a page draws,
 * by the index npm run sync:kiticons writes (valorant-kit-icons.generated.json):
 *
 *   { kind: 'weapon' | 'ability', file, label }
 *
 * `file` is the icon under assets/ (valorant/weapons/Vandal.png,
 * valorant/abilities/Chamber-Ultimate.png), always a file the index names,
 * never a path built from the word handed in; `label` is the gun's or the
 * ability's own spelling. A word the index does not know is null: a misread,
 * a type ("Ability"), a name. Pure, and it never throws.
 *
 * An ability is matched in the killer's own kit alone when the agent is one
 * the index knows, so a name two kits ever share goes to the right one and a
 * record that pairs an agent with another's ability shows no icon; without
 * the agent, a name more than one kit holds is null rather than a guess.
 */

const index = require('./valorant-kit-icons.generated.json');

const norm = (s) => (typeof s === 'string' ? s.toLowerCase().replace(/[^a-z0-9]/g, '') : '');
const FILE = /^[A-Za-z0-9-]+\.png$/;

const WEAPONS = new Map();
for (const [name, file] of Object.entries((index && index.weapons) || {})) {
  if (typeof file === 'string' && FILE.test(file)) WEAPONS.set(norm(name), { kind: 'weapon', file: `valorant/weapons/${file}`, label: name });
}

// ability name -> [{ agent, icon }], and the agents the index has a kit for
const ABILITIES = new Map();
const KITS = new Set();
for (const [agent, kit] of Object.entries((index && index.abilities) || {})) {
  if (norm(agent)) KITS.add(norm(agent));
  for (const a of Array.isArray(kit) ? kit : []) {
    if (!a || typeof a.name !== 'string' || typeof a.file !== 'string' || !FILE.test(a.file)) continue;
    const k = norm(a.name);
    if (!k) continue;
    if (!ABILITIES.has(k)) ABILITIES.set(k, []);
    ABILITIES.get(k).push({ agent: norm(agent), icon: { kind: 'ability', file: `valorant/abilities/${a.file}`, label: a.name } });
  }
}

/**
 * @param name   the weapon as Riot's record names it
 * @param agent  optional, the killer's agent, to pick the ability in its kit
 * @returns { kind, file, label } or null
 */
function killIcon(name, agent) {
  const k = norm(name);
  if (!k) return null;
  const gun = WEAPONS.get(k);
  if (gun) return { ...gun };
  const hits = ABILITIES.get(k);
  if (!hits || !hits.length) return null;
  // A killer the index knows: its own kit or nothing, never another agent's icon.
  if (KITS.has(norm(agent))) {
    const own = hits.find((h) => h.agent === norm(agent));
    return own ? { ...own.icon } : null;
  }
  return hits.length === 1 ? { ...hits[0].icon } : null;
}

module.exports = { killIcon };
