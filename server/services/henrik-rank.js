'use strict';

/**
 * HENRIKDEV'S RICHER RANK ENDPOINTS, PARSED DEFENSIVELY (8.8.x).
 *
 * Three answers, each read by puuid (the account lookup, /v2/account, gives
 * it with the region), and each a step up from the name based endpoints it
 * sits in front of, which stay as the fallbacks in coach.js:
 *
 *   MMR v3              /valorant/v3/by-puuid/mmr/{region}/pc/{puuid}
 *                       current tier and RR, the peak, each act's wins,
 *                       rank protection shields, leaderboard placement.
 *                       In front of /valorant/v2/mmr.
 *   stored MMR history  /valorant/v2/by-puuid/stored-mmr-history/{region}/pc/{puuid}
 *                       one row per rated game WITH ITS MATCH ID, so a saved
 *                       review is tied to its own RR change by id, not by
 *                       time. In front of /valorant/v1/mmr-history.
 *   accolades v1        /valorant/v1/by-puuid/accolades/{region}/pc/{puuid}
 *                       Riot's own records per match and act (top frag,
 *                       aces, clutches, best damage per round).
 *
 * WHAT NEVER LEAVES THIS FILE. `elo` is a tier times 100 plus RR, and Riot's
 * policy bans "MMR or ELO calculators": it is kept only as the rank journey's
 * plotting height, which the app never prints as a number. No name or tag is
 * kept from any answer (`account` is dropped whole), and the accolades of
 * every other player in a match are dropped by puuid before anything is
 * returned: only the player's own rows survive. Every field may be missing
 * or null; a shape that does not parse is null, never a throw.
 */

const isObj = (x) => !!x && typeof x === 'object' && !Array.isArray(x);
const int = (x) => (typeof x === 'number' && Number.isFinite(x) ? Math.round(x) : null);
const str = (x) => (typeof x === 'string' && x.trim() ? x.trim() : null);
const tierName = (t) => {
  if (!isObj(t)) return null;
  const name = str(t.name);
  // Tier 0 is Unrated, 1 and 2 are unused: no rank to show or band by.
  if (!name || /^unrated$|^unranked$|^unknown$/i.test(name)) return null;
  if (typeof t.id === 'number' && t.id < 3) return null;
  return name;
};
const seasonShort = (s) => (isObj(s) ? str(s.short) || str(s.id) : null);

/**
 * MMR v3. Null when the answer has no `data` object at all, so the caller
 * falls back to v2; otherwise every field it could read.
 */
function mmrV3(json) {
  const d = isObj(json) && isObj(json.data) ? json.data : null;
  if (!d) return null;
  const cur = isObj(d.current) ? d.current : {};
  const peak = isObj(d.peak) ? d.peak : null;
  const lb = isObj(cur.leaderboard_placement) ? cur.leaderboard_placement : null;
  const acts = (Array.isArray(d.seasonal) ? d.seasonal : []).filter(isObj).map((s) => ({
    season: seasonShort(s.season),
    wins: int(s.wins),
    games: int(s.games),
    endTier: tierName(s.end_tier),
  })).filter((a) => a.season && (a.games !== null || a.endTier));
  const rank = tierName(cur.tier);
  return {
    rank,
    rr: rank ? int(cur.rr) : null,
    lastChange: int(cur.last_change),
    gamesNeeded: int(cur.games_needed_for_rating),
    shields: int(cur.rank_protection_shields),
    leaderboard: lb && int(lb.rank) > 0 ? int(lb.rank) : null,
    peakRank: peak ? tierName(peak.tier) : null,
    peakSeason: peak ? seasonShort(peak.season) : null,
    // Newest act last, as the answer orders them; capped so a long account
    // history never bloats the profile every page is handed.
    acts: acts.slice(-6),
  };
}

/** A date as epoch ms, from a number (seconds or ms) or a string, or null. */
function dateOf(x) {
  if (typeof x === 'number' && Number.isFinite(x) && x > 0) return x < 1e12 ? x * 1000 : x;
  if (typeof x === 'string') { const t = Date.parse(x); return Number.isFinite(t) ? t : null; }
  return null;
}

/** Oldest first: by date when every point has one, else the answer reversed (newest first). */
function oldestFirst(points) {
  if (points.every((p) => typeof p.date === 'number')) return points.slice().sort((a, b) => a.date - b.date);
  return points.slice().reverse();
}

/**
 * Stored MMR history v2: the rank journey's points, oldest first, each with
 * its match id. Null when the answer has no `data` array, so the caller
 * falls back to v1.
 */
function storedHistoryV2(json, size) {
  const arr = isObj(json) && Array.isArray(json.data) ? json.data : null;
  if (!arr) return null;
  const points = arr.slice(0, size || 20).filter(isObj).map((e) => ({
    date: dateOf(e.date),
    elo: int(e.elo),
    change: int(e.last_change),
    tier: isObj(e.tier) ? str(e.tier.name) : null,
    matchId: str(e.match_id),
    refunded: int(e.refunded_rr) || 0,
    derankProtected: e.was_derank_protected === true,
  })).filter((p) => p.elo !== null);
  return oldestFirst(points);
}

/** v1 mmr-history, the fallback, as the route always read it, with the match id it also carries. */
function historyV1(json, size) {
  const arr = isObj(json) && Array.isArray(json.data) ? json.data : [];
  const points = arr.slice(0, size || 20).filter(isObj).map((e) => ({
    date: e.date_raw ? e.date_raw * 1000 : (Date.parse(e.date) || null),
    elo: e.elo != null ? e.elo : null,
    change: e.mmr_change_to_last_game != null ? e.mmr_change_to_last_game : null,
    tier: e.currenttierpatched || null,
    ...(str(e.match_id) ? { matchId: str(e.match_id) } : {}),
  })).filter((p) => p.elo != null);
  return points.reverse();
}

// The accolade kinds the app has words for (src/shared/riot-rank.js). Any
// other id HenrikDev adds later is dropped here rather than shown raw.
const ACCOLADES = new Set(['kills', 'first_blood', 'damage_per_round', 'clutches', 'aces', 'trades',
  'headshot_percentage', 'assists', 'top_frag', 'plants']);
const kindOf = (m) => {
  const k = str(m && (m.type || m.id));
  return k && ACCOLADES.has(k.toLowerCase()) ? k.toLowerCase() : null;
};
const num = (x) => (typeof x === 'number' && Number.isFinite(x) ? Math.round(x * 10) / 10 : null);

/**
 * Accolades v1, the player's own only. `puuid` is the player's: every other
 * player's row in a match is dropped, and a match without the player's row
 * is no match here. Null when the answer has no `data` object.
 */
function accoladesV1(json, puuid) {
  const d = isObj(json) && isObj(json.data) ? json.data : null;
  if (!d) return null;
  const me = String(puuid || '').toLowerCase();
  const matches = [];
  for (const m of Array.isArray(d.matches) ? d.matches : []) {
    if (!isObj(m) || !str(m.match_id)) continue;
    const mine = (Array.isArray(m.players) ? m.players : []).find((p) => isObj(p) && me && String(p.puuid || '').toLowerCase() === me);
    if (!mine) continue;
    const items = (Array.isArray(mine.accolades) ? mine.accolades : []).filter(isObj).map((a) => ({
      type: kindOf(a), value: num(a.value), actRecord: a.is_act_record === true,
    })).filter((a) => a.type && a.value !== null);
    if (items.length) matches.push({ matchId: str(m.match_id), startedAt: dateOf(m.started_at), items });
  }
  const sum = isObj(d.summary) ? d.summary : null;
  const allTime = (sum && Array.isArray(sum.all_time) ? sum.all_time : []).filter(isObj).map((a) => ({
    type: kindOf(a), count: int(a.count), best: num(a.best_value),
  })).filter((a) => a.type && a.count !== null);
  return { matches: matches.slice(0, 25), allTime };
}

module.exports = { mmrV3, storedHistoryV2, historyV1, accoladesV1, ACCOLADES, dateOf };
