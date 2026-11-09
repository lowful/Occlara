'use strict';

/**
 * A ROUND THE PLAYER SAT OUT (8.8): Riot's was_afk or stayed_in_spawn for the
 * player (server/services/riot-rounds.js), carried by reconcile as `afk` and
 * `inSpawn` on the reconciled row, and as `riot.afk` / `riot.inSpawn` on a
 * saved round card. Nothing in such a round is the player's doing, so the
 * grade, the lists, the page's patterns, the counts sent to the coach, the
 * Moments page and the paid death look all leave it out. One test, written
 * once, so no surface can drift from the others. Only `true` counts: a
 * forged or garbled flag is no flag.
 */
function satOut(r) {
  return !!(r && (r.afk === true || r.inSpawn === true));
}

/** The same test on a saved round card, whose Riot facts sit under `riot`. */
function cardSatOut(card) {
  return !!(card && (satOut(card) || satOut(card.riot)));
}

/** The note that says a round was left out, in the player's words. */
function satOutNote(rounds) {
  const rs = (Array.isArray(rounds) ? rounds : []).filter(satOut);
  if (!rs.length) return null;
  const afk = rs.filter((r) => r.afk === true).map((r) => r.n);
  const spawn = rs.filter((r) => r.afk !== true).map((r) => r.n);
  const list = (ns) => (ns.length === 1 ? `round ${ns[0]}` : `rounds ${ns.slice(0, -1).join(', ')} and ${ns[ns.length - 1]}`);
  const parts = [];
  if (afk.length) parts.push(`${list(afk)}, Riot marked you AFK`);
  if (spawn.length) parts.push(`${list(spawn)}, Riot has you in spawn all round`);
  return `Left out of every count: ${parts.join('; ')}.`;
}

module.exports = { satOut, cardSatOut, satOutNote };
