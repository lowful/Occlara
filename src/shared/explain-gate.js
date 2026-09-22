'use strict';

/**
 * WHEN it is safe to put a paragraph on screen over a live match.
 *
 * The live tip is one sentence because it is read mid fight. The explanation
 * behind it is several, and several sentences is not something a player can
 * read while holding an angle. A feature that offered depth at the wrong moment
 * would cost more rounds than the depth wins, so the moment is gated rather
 * than left to the player's judgement in the middle of a duel.
 *
 * TWO MOMENTS QUALIFY, and they are the two where there is genuinely nothing
 * else to do with your eyes:
 *
 *   buy phase    barriers up, nobody can shoot you, and the player is already
 *                reading the shop
 *   dead         spectating a teammate, which is the moment a player is most
 *                willing to read and least able to act
 *
 * Pulled out of the controller so it can be tested without booting the app. The
 * gate is the safety property of this whole feature, and a safety property that
 * only exists inside an Electron main process is one nobody checks.
 */

/**
 * @param {object} ctx  the engine's matchContext
 * @returns {{ok: boolean, why: string|null}}
 */
function explainAllowed(ctx) {
  const c = ctx || {};

  // DEAD IS READ THE SAME WAY THE REST OF THE ENGINE READS IT. isSpectating()
  // is playerAlive === false OR phase === 'dead', because the two disagree on
  // real frames often enough that either alone misses cases.
  const dead = c.playerAlive === false || c.phase === 'dead';
  if (dead) return { ok: true, why: null };

  if (c.phase === 'buy') return { ok: true, why: null };

  // UNKNOWN IS A REFUSAL, unlike most gates in this codebase. Elsewhere an
  // unreadable field means "say nothing about it" and coaching continues. Here
  // the cost of being wrong is asymmetric: refusing when the player was safe
  // costs them one keypress, and allowing when they were mid duel costs the
  // round. So anything that is not provably safe is declined.
  return {
    ok: false,
    why: 'Ask again in the buy phase or after you die, reading this mid round gets you killed.',
  };
}

module.exports = { explainAllowed };
