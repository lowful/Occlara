'use strict';

/**
 * THE PLAYER'S RANK BAND, the one rank fact the coach is sent (8.8).
 *
 * The review, the look at a death and Ask Coach size their advice to the
 * player's level: a Gold player is not handed an Immortal's micro decision,
 * and an Immortal is not told to keep their crosshair at head height. The
 * server is told a band and nothing else, never a tier name, never a Riot ID:
 *
 *   iron_bronze   Iron and Bronze
 *   silver_gold   Silver and Gold
 *   plat_diamond  Platinum and Diamond
 *   asc_plus      Ascendant, Immortal and Radiant
 *
 * WHERE IT COMES FROM. What main already holds for the Riot ID in Settings:
 * the rank history's newest rated game (Stats' rank card), then the tracker
 * profile's current rank, then its peak. The history leads because it is the
 * newest: a promotion shows there a game before the profile catches up. The
 * peak is the fallback for a player unrated this act, whose level did not go
 * away with the reset. Anything else, Unranked, Unrated, a word this file
 * does not know, is no band, and no band is today's review byte for byte.
 *
 * Plain JS, no Electron, so test:rankband runs it alone. The server keeps the
 * same four keys (knowledge.js RANK_BANDS) and treats the field as untrusted.
 */

const BANDS = ['iron_bronze', 'silver_gold', 'plat_diamond', 'asc_plus'];

const BAND_OF_TIER = {
  iron: 'iron_bronze', bronze: 'iron_bronze',
  silver: 'silver_gold', gold: 'silver_gold',
  platinum: 'plat_diamond', plat: 'plat_diamond', diamond: 'plat_diamond',
  ascendant: 'asc_plus', immortal: 'asc_plus', radiant: 'asc_plus',
};

// A tier as Riot and HenrikDev print it: "Gold 2", "Immortal 3", "Radiant".
// Anchored, so "Goldfish" or "Silver Surfer" is no tier.
const TIER = /^(iron|bronze|silver|gold|platinum|plat|diamond|ascendant|immortal|radiant)(?:\s+[1-3])?$/i;

/** The band of one tier name, or null for anything that is not one. */
function bandOfTier(name) {
  if (typeof name !== 'string') return null;
  const m = TIER.exec(name.trim());
  return m ? BAND_OF_TIER[m[1].toLowerCase()] : null;
}

/**
 * The band to send, or null when nothing names one.
 *
 * @param src.current  the rank history's newest rated tier (current.tier)
 * @param src.rank     the tracker profile's current rank
 * @param src.peak     the tracker profile's peak rank
 */
function rankBand(src) {
  const s = src && typeof src === 'object' ? src : {};
  return bandOfTier(s.current) || bandOfTier(s.rank) || bandOfTier(s.peak) || null;
}

/*
 * THE PEAK AND THE TREND (8.7.9). The peak is the profile's (MMR v3's peak
 * since 8.7.9, v2's highest_rank before) and, without one, the best rated
 * tier in the rank history, the Profile page's own rule, so a player whose
 * profile could not be read is still banded by the games main holds. The
 * trend (riot-rank.js rankTrend: 'up', 'down', 'flat' or null) is carried
 * beside the band for the pages and the tests, and DOES NOT MOVE IT: a band
 * is the level the advice is sized to, and a few games of RR either way are
 * no reason to send a Gold player an Immortal's read. So rankBand's answer
 * for the same current, rank and peak is today's, byte for byte.
 */
const LADDER = ['iron', 'bronze', 'silver', 'gold', 'platinum', 'diamond', 'ascendant', 'immortal', 'radiant'];
function tierIndex(name) {
  if (!bandOfTier(name)) return null;
  const t = name.trim().toLowerCase();
  const i = LADDER.findIndex((n) => t.startsWith(n === 'platinum' ? 'plat' : n));
  const div = parseInt(t.replace(/[^\d]/g, ''), 10);
  return i * 3 + (Number.isFinite(div) ? div : 2);
}

/** The best rated tier among the rank history's points, or null. */
function historyPeak(history) {
  const points = history && !history.error && Array.isArray(history.points) ? history.points : [];
  let best = null;
  for (const p of points) {
    const i = p ? tierIndex(p.tier) : null;
    if (i !== null && (best === null || i >= best.i)) best = { i, tier: p.tier.trim() };
  }
  return best ? best.tier : null;
}

/**
 * What the rank band reads, all of it: { band, peak, trend }.
 *
 * @param src.current  the rank history's newest rated tier
 * @param src.rank     the tracker profile's current rank
 * @param src.peak     the tracker profile's peak rank
 * @param src.history  the rank history itself, for the peak without a profile
 * @param src.trend    riot-rank.js rankTrend of that history
 */
function rankContext(src) {
  const s = src && typeof src === 'object' ? src : {};
  const peak = bandOfTier(s.peak) ? s.peak.trim() : historyPeak(s.history);
  const trend = s.trend === 'up' || s.trend === 'down' || s.trend === 'flat' ? s.trend : null;
  return { band: rankBand({ current: s.current, rank: s.rank, peak }), peak: peak || null, trend };
}

/** A band only when it is one of the four keys, else null. */
function validBand(x) {
  return typeof x === 'string' && BANDS.includes(x) ? x : null;
}

module.exports = { BANDS, bandOfTier, rankBand, rankContext, historyPeak, validBand };
