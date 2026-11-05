'use strict';

/**
 * WHERE A CHARACTER'S ICON IS, under assets/ (8.7.x, the Verdict's share
 * image). Pure, no Electron, no DOM and no file system: it names a path the
 * page loads as 'self', and a picture that fails to load is left out there.
 *
 *   Valorant  valorant/agents/<Key>.png   written by npm run sync:agenticons
 *   League    lol/champions/<Id>.png      written by npm run sync:lol
 *
 * Only a name the generated data knows gets a path, so a misread or a free
 * string never asks for a file, and a string with a '#' (a Riot ID) is never
 * looked up at all.
 */

const valorant = require('./valorant-data.generated.json');
const champions = require('./lol-champions');

/** An agent's file key: its name with every character but a letter or a digit dropped (KAY/O is KAYO). */
const iconKey = (name) => String(name || '').replace(/[^A-Za-z0-9]/g, '');

const AGENTS = new Map(Object.keys(valorant.agents || {}).map((n) => [iconKey(n).toLowerCase(), iconKey(n)]));

/**
 * The icon of the character the player used, relative to assets/, or null.
 * @param game 'valorant' or 'lol'
 * @param name the agent or the champion as the review names it
 */
function iconOf(game, name) {
  if (typeof name !== 'string' || !name.trim() || name.includes('#')) return null;
  if (game === 'valorant') {
    const key = AGENTS.get(iconKey(name).toLowerCase());
    return key ? `valorant/agents/${key}.png` : null;
  }
  if (game === 'lol') {
    const c = champions.champion(name);
    return c && typeof c.icon === 'string' && c.icon.startsWith('lol/champions/') ? c.icon : null;
  }
  return null;
}

module.exports = { iconOf, iconKey };
