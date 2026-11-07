'use strict';

/**
 * RIOT'S RANK AS THE GAME SHOWS IT, AND RIOT'S OWN ACCOLADES (8.8.x).
 *
 * The words the pages say about what the server's richer HenrikDev reads
 * hand back (server/services/henrik-rank.js): the RR chip on a review and in
 * Matches, the rank tile's quiet line on Stats, the rank trend the rank band
 * is handed, and Riot's accolades in a review's "What went well".
 *
 * ONLY RR, AS THE GAME SHOWS IT. Riot's policy bans "MMR or ELO
 * calculators", so nothing here ever prints the history's `elo` (a tier
 * times 100 plus RR), estimates a hidden rating or names a number the game
 * does not show the player itself: a tier, an RR change, shields, a
 * leaderboard place, an act's wins. No player's name is ever read here; the
 * accolades are the player's own, filtered by puuid on the server.
 *
 * Plain JS, no Electron: the preloads require it, and test:rank-band and
 * test:homemodel run it alone. No sentence has a dash or a semicolon.
 */

const fin = (x) => typeof x === 'number' && Number.isFinite(x);
const GAME_RR = 60;
const UNRATED = /unrated|unranked/i;

/** "RR +18", "RR -15", "RR 0" for one game's RR change, or '' for anything else. */
function rrText(change) {
  if (!fin(change) || Math.abs(change) > GAME_RR) return '';
  const n = Math.round(change);
  return `RR ${n > 0 ? '+' : ''}${n}`;
}

/** The tone class a chip of `change` takes: gain, loss or even. */
function rrTone(change) {
  return !fin(change) ? '' : change > 0 ? 'gain' : change < 0 ? 'loss' : 'even';
}

/**
 * The chip for one match: { text, tone, title }, or null without one game's
 * RR. `point` is the rank history's point for that match, when it has one
 * (home-model.js pointForMatch), for the shield and the refund.
 */
function rrChip(change, point) {
  const text = rrText(change);
  if (!text) return null;
  const p = point && typeof point === 'object' ? point : {};
  const notes = ['RR from this match.'];
  if (p.derankProtected === true) notes.push('Rank protection kept your rank.');
  if (fin(p.refunded) && p.refunded > 0) notes.push(`${Math.round(p.refunded)} RR refunded.`);
  return { text, tone: rrTone(change), title: notes.join(' ') };
}

/**
 * Which way the rank has been going: 'up', 'down' or 'flat' over the newest
 * rated games' own RR (the last ten at most), or null below three of them.
 * A net of 30 RR or more either way is a direction, anything less is flat.
 */
function rankTrend(history) {
  const points = history && !history.error && Array.isArray(history.points) ? history.points : [];
  const games = points.filter((p) => p && fin(p.elo) && p.elo > 0 && typeof p.tier === 'string' && !UNRATED.test(p.tier)
    && fin(p.change) && Math.abs(p.change) <= GAME_RR).slice(-10);
  if (games.length < 3) return null;
  const net = games.reduce((s, p) => s + p.change, 0);
  return net >= 30 ? 'up' : net <= -30 ? 'down' : 'flat';
}

/**
 * The rank tile's quiet line on Stats: the RR in the tier, the peak with its
 * act, the shields, the leaderboard place and this act's wins, each only
 * when known. [] for a profile from an older server, which has no rankDetail.
 */
function rankLine(stats) {
  const st = stats && typeof stats === 'object' ? stats : {};
  const d = st.rankDetail && typeof st.rankDetail === 'object' ? st.rankDetail : null;
  const out = [];
  if (d && fin(d.rr) && d.rr >= 0 && d.rr <= 100 && typeof st.rank === 'string' && !UNRATED.test(st.rank)) out.push(`${Math.round(d.rr)} RR`);
  if (typeof st.peakRank === 'string' && st.peakRank.trim()) {
    const act = d && typeof d.peakSeason === 'string' && /^[A-Za-z0-9 ]{1,12}$/.test(d.peakSeason) ? ` in ${d.peakSeason.toUpperCase()}` : '';
    out.push(`Peak ${st.peakRank.trim()}${act}`);
  }
  if (d && fin(d.leaderboard) && d.leaderboard > 0) out.push(`#${Math.round(d.leaderboard)} on the leaderboard`);
  if (d && fin(d.shields) && d.shields > 0) out.push(`${d.shields} rank protection ${d.shields === 1 ? 'shield' : 'shields'}`);
  const act = d && Array.isArray(d.acts) && d.acts.length ? d.acts[d.acts.length - 1] : null;
  if (act && fin(act.wins) && fin(act.games) && act.games > 0) out.push(`${act.wins} wins in ${act.games} games this act`);
  if (d && fin(d.gamesNeeded) && d.gamesNeeded > 0) out.push(`${d.gamesNeeded} more ${d.gamesNeeded === 1 ? 'game' : 'games'} to a rank`);
  return out;
}

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

/**
 * One accolade as a "What went well" line: { title, detail }, or null for a
 * kind or a value that says nothing worth a line. Riot's own words, with the
 * act record said when Riot marks it.
 */
function accoladeLine(a) {
  if (!a || typeof a !== 'object' || !fin(a.value)) return null;
  const v = Math.round(a.value);
  const rec = a.actRecord === true;
  const best = rec ? ', your best in a match this act' : '';
  switch (a.type) {
    case 'top_frag': return { title: 'Top frag of the match', detail: "Riot's record names you the top fragger." };
    case 'aces': return v > 0 ? { title: v === 1 ? 'An ace' : plural(v, 'ace', 'aces'), detail: `Riot's record counts ${plural(v, 'ace', 'aces')}${best}.` } : null;
    case 'clutches': return v > 0 ? { title: plural(v, 'clutch won', 'clutches won'), detail: `Riot's record counts ${plural(v, 'clutch', 'clutches')}${best}.` } : null;
    case 'damage_per_round': return rec && v > 0 ? { title: `${v} damage a round`, detail: "Riot's record says it is your best in a match this act." } : null;
    case 'kills': return rec && v > 0 ? { title: plural(v, 'kill', 'kills'), detail: "Riot's record says it is your most in a match this act." } : null;
    case 'first_blood': return rec && v > 0 ? { title: plural(v, 'first blood', 'first bloods'), detail: "Riot's record says it is your most in a match this act." } : null;
    case 'headshot_percentage': {
      const pct = a.value > 0 && a.value <= 1 ? Math.round(a.value * 100) : v;
      return rec && pct > 0 && pct <= 100 ? { title: `${pct}% headshots`, detail: "Riot's record says it is your best in a match this act." } : null;
    }
    case 'trades': return rec && v > 0 ? { title: plural(v, 'trade', 'trades'), detail: "Riot's record says it is your most in a match this act." } : null;
    case 'assists': return rec && v > 0 ? { title: plural(v, 'assist', 'assists'), detail: "Riot's record says it is your most in a match this act." } : null;
    case 'plants': return rec && v > 0 ? { title: plural(v, 'plant', 'plants'), detail: "Riot's record says it is your most in a match this act." } : null;
    default: return null;
  }
}

/**
 * Riot's accolades for one match, as "What went well" lines, at most four:
 * the match found by its Riot match id in the profile's accolades
 * (stats.accolades.matches). [] without an id, a match or a line.
 */
function accoladeLines(accolades, matchId) {
  const id = typeof matchId === 'string' ? matchId.trim().toLowerCase() : '';
  const list = accolades && typeof accolades === 'object' && Array.isArray(accolades.matches) ? accolades.matches : [];
  const m = id ? list.find((x) => x && typeof x.matchId === 'string' && x.matchId.toLowerCase() === id) : null;
  if (!m || !Array.isArray(m.items)) return [];
  const seen = new Set();
  const out = [];
  for (const a of m.items) {
    const line = accoladeLine(a);
    if (!line || seen.has(line.title)) continue;
    seen.add(line.title);
    out.push(line);
  }
  return out.slice(0, 4);
}

/**
 * Stats' all time accolades line: aces and clutches, as Riot counts them on
 * the account, or '' without either.
 */
function accoladeTotals(accolades) {
  const all = accolades && typeof accolades === 'object' && Array.isArray(accolades.allTime) ? accolades.allTime : [];
  const count = (type) => { const a = all.find((x) => x && x.type === type); return a && fin(a.count) && a.count > 0 ? a.count : 0; };
  const parts = [];
  const aces = count('aces');
  const clutches = count('clutches');
  if (aces) parts.push(plural(aces, 'ace', 'aces'));
  if (clutches) parts.push(plural(clutches, 'clutch', 'clutches'));
  return parts.length ? `${parts.join(' and ')} in Riot's record` : '';
}

module.exports = { rrText, rrTone, rrChip, rankTrend, rankLine, accoladeLine, accoladeLines, accoladeTotals, GAME_RR };
