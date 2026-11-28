'use strict';

/**
 * WHERE AN AGENT'S FULL PORTRAIT IS, under assets/ (Orbit, Nov 2026): the
 * player's agent standing in front of the moon on Home's hero and the review's.
 * Pure, no Electron, no DOM and no file system: it names a path the page loads
 * as 'self', and a page falls back to the head icon (agent-icons.js iconOf)
 * when the picture fails to load.
 *
 *   Valorant  agents-full/<Key>.webp   written by npm run sync:agentportraits
 *
 * Only a name the generated data knows gets a path, so a misread or a free
 * string never asks for a file, and a string with a '#' (a Riot ID) is never
 * looked up at all. League has no portraits: null.
 *
 * Riot's art, for the player's own reviews and Home. The Trainer never uses it
 * (trainer.md: nothing of Riot's ships in the Trainer); test:agentportraits
 * holds that.
 */

const valorant = require('./valorant-data.generated.json');
const { iconKey } = require('./agent-icons');

const AGENTS = new Map(Object.keys(valorant.agents || {}).map((n) => [iconKey(n).toLowerCase(), iconKey(n)]));

/** The full portrait of a Valorant agent, relative to assets/, or null. */
function portraitOf(name) {
  if (typeof name !== 'string' || !name.trim() || name.includes('#')) return null;
  const key = AGENTS.get(iconKey(name).toLowerCase());
  return key ? `agents-full/${key}.webp` : null;
}

/** The portrait for a head icon's path (valorant/agents/<Key>.png), or null: the review knows its agent by its icon. */
function portraitOfIcon(icon) {
  const m = /^valorant\/agents\/([A-Za-z0-9]+)\.png$/.exec(String(icon || ''));
  return m ? portraitOf(m[1]) : null;
}

module.exports = { portraitOf, portraitOfIcon };
