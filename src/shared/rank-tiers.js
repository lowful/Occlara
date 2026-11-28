'use strict';

/**
 * VALORANT'S COMPETITIVE TIERS, IN ORDER (9.1, the owner's item 10): the
 * names Riot and HenrikDev print ("Diamond 1", "Ascendant 3", "Radiant"),
 * where each sits on the ladder, the tier after it, whether its RR runs in
 * steps of 100, and the bundled icon that draws it
 * (assets/ranks/<slug>.webp, npm run sync:rankicons).
 *
 * THE LADDER. Iron 1 is place 0 and Radiant place 24, Riot's tier number
 * less 3 (tiers 1 and 2 are unused, 0 is Unranked). Below Immortal a tier is
 * 100 RR and 100 takes the player up; from Immortal 1 the RR is not capped at
 * 100 and the next rank follows the region's leaderboard, so there is no
 * fixed step to show.
 *
 * ONLY WHAT THE GAME SHOWS. The rank history's `elo` is a place times 100
 * plus the RR (server/services/henrik-rank.js), never printed: rrOf() hands
 * back the RR alone, the number the game itself shows beside the rank.
 *
 * Pure, plain JS: the Home and Stats preloads require it, and
 * test:rankicons holds every tier to its file.
 */

const TIERS = Object.freeze([
  'Iron 1', 'Iron 2', 'Iron 3',
  'Bronze 1', 'Bronze 2', 'Bronze 3',
  'Silver 1', 'Silver 2', 'Silver 3',
  'Gold 1', 'Gold 2', 'Gold 3',
  'Platinum 1', 'Platinum 2', 'Platinum 3',
  'Diamond 1', 'Diamond 2', 'Diamond 3',
  'Ascendant 1', 'Ascendant 2', 'Ascendant 3',
  'Immortal 1', 'Immortal 2', 'Immortal 3',
  'Radiant',
]);
const UNRANKED = 'Unranked';
// The first tier whose RR is not capped at 100.
const UNCAPPED_FROM = TIERS.indexOf('Immortal 1');

/** "diamond-1" for "Diamond 1" (any case, any spacing, "Diamond1" too), or null for a name the ladder does not know. */
function slugOf(name) {
  const s = String(name == null ? '' : name).trim().toLowerCase().replace(/\s+/g, ' ');
  if (!s) return null;
  if (/^(unranked|unrated)$/.test(s)) return 'unranked';
  const m = /^([a-z]+) ?([1-3])?$/.exec(s);
  if (!m) return null;
  const slug = m[2] ? `${m[1]}-${m[2]}` : m[1];
  return TIERS.some((t) => t.toLowerCase().replace(' ', '-') === slug) ? slug : null;
}

/** Its place on the ladder, Iron 1 at 0 to Radiant at 24, or null (Unranked included). */
function placeOf(name) {
  const slug = slugOf(name);
  if (!slug || slug === 'unranked') return null;
  const i = TIERS.findIndex((t) => t.toLowerCase().replace(' ', '-') === slug);
  return i >= 0 ? i : null;
}

/** The tier's own name as the ladder writes it ("Diamond 1"), or null. */
function nameOf(name) {
  const i = placeOf(name);
  return i === null ? null : TIERS[i];
}

/** The tier after it ("Diamond 2" after "Diamond 1", "Immortal 1" after "Ascendant 3"), or null at Radiant or for a name not known. */
function nextOf(name) {
  const i = placeOf(name);
  return i === null || i >= TIERS.length - 1 ? null : TIERS[i + 1];
}

/** True below Immortal, where a tier is 100 RR and 100 takes the player up. */
function capped(name) {
  const i = placeOf(name);
  return i !== null && i < UNCAPPED_FROM;
}

/**
 * The RR the game shows beside the rank, from a rank history point's elo
 * (place times 100 plus the RR): 0 to 99 below Immortal, and from Immortal 1
 * the RR above the tier's base, uncapped. Null when the elo does not fit the
 * tier it names, which is never shown as a guess.
 */
function rrOf(name, elo) {
  const i = placeOf(name);
  if (i === null || typeof elo !== 'number' || !Number.isFinite(elo)) return null;
  const rr = Math.round(elo) - i * 100;
  if (!Number.isInteger(rr) || rr < 0) return null;
  if (i < UNCAPPED_FROM) return rr < 100 ? rr : null;
  return rr <= 5000 ? rr : null;
}

/** The bundled icon's path under assets/ ("ranks/diamond-1.webp"), or null for a name not known. */
function iconFile(name) {
  const slug = slugOf(name);
  return slug ? `ranks/${slug}.webp` : null;
}

/** Every icon the app bundles, by slug: the 25 tiers and Unranked. */
const SLUGS = Object.freeze([...TIERS.map((t) => t.toLowerCase().replace(' ', '-')), 'unranked']);

module.exports = { TIERS, UNRANKED, SLUGS, slugOf, placeOf, nameOf, nextOf, capped, rrOf, iconFile };
