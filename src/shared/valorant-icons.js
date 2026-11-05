'use strict';

/*
 * VALORANT'S AGENT AND GUN ICONS FOR THE REVIEW'S KILLER CARD (8.7). The
 * agents' are agent-icons.js's (npm run sync:agenticons), the guns' kill feed
 * icons npm run sync:weaponicons writes under assets/valorant/weapons/, so a
 * page draws both with no network (img-src 'self'). This module only names
 * the file: a page resolves it against assets/ (`../../../assets/` + the
 * path, from src/renderer/<page>/).
 *
 * An icon is named only for an agent or gun the game data knows, in its own
 * spelling, so a word from anywhere else (a misread, a name) never becomes a
 * path. A page hides an icon that does not load: an agent or gun newer than
 * the last icon sync keeps its name and loses only the picture.
 */

const data = require('./valorant-data.generated.json');
const { iconOf } = require('./agent-icons');

/** The file name for a display name: letters and digits only, so KAY/O is KAYO. */
function fileOf(name) {
  const s = String(name || '').replace(/[^A-Za-z0-9]/g, '');
  return s || null;
}

const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
const AGENTS = new Map(Object.keys(data.agents || {}).map((a) => [norm(a), a]));
// The guns by the game data's own keys (lower case), and the knife, which the
// data's gun list leaves out and Riot's kill feed calls Melee.
const WEAPONS = new Map([...Object.keys(data.weapons || {}), 'melee']
  .map((w) => [norm(w), w.charAt(0).toUpperCase() + w.slice(1)]));

/** An agent the game data knows, in its own spelling, or null. */
function agentName(name) {
  return AGENTS.get(norm(name)) || null;
}

/** A gun the game data knows, in its display spelling, or null. */
function weaponName(name) {
  return WEAPONS.get(norm(name)) || null;
}

/** The agent's icon under assets/, or null for a word that is no agent. */
function agentIcon(name) {
  const a = agentName(name);
  return a ? iconOf('valorant', a) : null;
}

/** The gun's kill feed icon under assets/, or null for a word that is no gun. */
function weaponIcon(name) {
  const w = weaponName(name);
  return w ? `valorant/weapons/${fileOf(w)}.png` : null;
}

module.exports = { fileOf, agentName, weaponName, agentIcon, weaponIcon };
