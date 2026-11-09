'use strict';

/**
 * WHAT STATS DRAWS BEYOND THE OVERVIEW, read safely (Stats' "Your numbers",
 * "Maps" and "Acts").
 *
 * Every number here is already fetched: the profile's averages over its stored
 * matches and each act's wins come with the dashboard (index.js
 * getStatsDashboard `profile`, from /player-stats), and the maps are counted
 * from the match list the page already shows. No request of its own.
 *
 * The player's own numbers, maps and acts only: no name, no tag, no other
 * player. A field that is missing, not a number or out of its range is none,
 * and a section with nothing in it is left out by the page, never drawn as a
 * row of zeros. An older server sends no profile at all, which is none.
 *
 * A plain script that sets window.StatsProfile, as grade-view.js does, and a
 * module for Node, for test:statsprofile.
 */
(function () {
  const fin = (x) => typeof x === 'number' && Number.isFinite(x);
  const nonneg = (x) => (fin(x) && x >= 0 ? x : null);
  const pct = (x) => (fin(x) && x >= 0 && x <= 100 ? Math.round(x) : null);
  const count = (x) => (fin(x) && x >= 0 ? Math.round(x) : null);

  /**
   * The profile's averages: { matches, acs, kd, adr, kpr, dpr, apr, shots },
   * shots { head, body, legs } in percent or null. Null with no profile or
   * no match counted. A profile whose rounds were all zero has its per round
   * numbers as none, not as a row of zeros.
   */
  function numbers(p) {
    if (!p || typeof p !== 'object') return null;
    const matches = count(p.matches);
    if (!matches) return null;
    let acs = nonneg(p.acs), adr = nonneg(p.adr), kpr = nonneg(p.kpr), dpr = nonneg(p.dpr), apr = nonneg(p.apr);
    if (![acs, adr, kpr, dpr, apr].some((v) => v > 0)) acs = adr = kpr = dpr = apr = null;
    const head = pct(p.headshotPct), body = pct(p.bodyshotPct);
    // The server sends 0 and 0 when no shot was counted: that is no split.
    const shots = head != null && body != null && head + body > 0 && head + body <= 100
      ? { head, body, legs: 100 - head - body } : null;
    const kd = nonneg(p.kd);
    if (acs == null && kd == null && shots == null) return null;
    return { matches, acs, kd, adr, kpr, dpr, apr, shots };
  }

  /**
   * The match list counted by map, most played first: { map, played, won,
   * kd, acs }. A row without a map, or "Unknown", is left out; a draw is
   * played and not won.
   */
  function byMap(list) {
    const rows = new Map();
    for (const m of Array.isArray(list) ? list : []) {
      if (!m || typeof m !== 'object') continue;
      const name = typeof m.map === 'string' ? m.map.trim() : '';
      if (!name || /^unknown$/i.test(name)) continue;
      const r = rows.get(name) || { map: name, played: 0, won: 0, kills: 0, deaths: 0, acsSum: 0, acsN: 0, kdN: 0 };
      r.played++;
      if (m.result === 'Victory') r.won++;
      const k = count(m.kills), d = count(m.deaths);
      if (k != null && d != null) { r.kills += k; r.deaths += d; r.kdN++; }
      if (fin(m.acs) && m.acs > 0) { r.acsSum += m.acs; r.acsN++; }
      rows.set(name, r);
    }
    return [...rows.values()].map((r) => ({
      map: r.map,
      played: r.played,
      won: r.won,
      kd: r.kdN ? (r.deaths > 0 ? +(r.kills / r.deaths).toFixed(2) : r.kills) : null,
      acs: r.acsN ? Math.round(r.acsSum / r.acsN) : null,
    })).sort((a, b) => b.played - a.played || b.won - a.won || a.map.localeCompare(b.map));
  }

  /**
   * Top agents counted from the match list, for when Riot's profile sent none
   * (Stats' "Top agents"): { name, matches, pct, winRate, kd, acs }, the shape
   * the profile's topAgents has, most played first, five at most, as the server lists them. A row
   * without an agent, or "Unknown", is left out, and pct is the share of the
   * matches that named an agent. A number missing from every match is null.
   */
  function agents(list, most) {
    const rows = new Map();
    let named = 0;
    for (const m of Array.isArray(list) ? list : []) {
      if (!m || typeof m !== 'object') continue;
      const name = typeof m.agent === 'string' ? m.agent.trim() : '';
      if (!name || !/^[A-Za-z][A-Za-z0-9 /'.-]{0,23}$/.test(name) || /^unknown$/i.test(name)) continue;
      named++;
      const r = rows.get(name) || { name, matches: 0, won: 0, kills: 0, deaths: 0, kdN: 0, acsSum: 0, acsN: 0 };
      r.matches++;
      if (m.result === 'Victory') r.won++;
      const k = count(m.kills), d = count(m.deaths);
      if (k != null && d != null) { r.kills += k; r.deaths += d; r.kdN++; }
      if (fin(m.acs) && m.acs > 0) { r.acsSum += m.acs; r.acsN++; }
      rows.set(name, r);
    }
    return [...rows.values()].map((r) => ({
      name: r.name,
      matches: r.matches,
      pct: Math.round((r.matches / named) * 100),
      winRate: Math.round((r.won / r.matches) * 100),
      kd: r.kdN ? (r.deaths > 0 ? +(r.kills / r.deaths).toFixed(2) : r.kills) : null,
      acs: r.acsN ? Math.round(r.acsSum / r.acsN) : null,
    })).sort((a, b) => b.matches - a.matches || b.winRate - a.winRate || a.name.localeCompare(b.name))
      .slice(0, fin(most) && most > 0 ? most : 5);
  }

  /**
   * Each act Riot's record has, newest first: { season, rank, wins, games,
   * winRate }. The season as the rank line writes it (E9A3), a rank only as a
   * plain tier name, wins never above games.
   */
  function acts(list) {
    const out = [];
    for (const a of Array.isArray(list) ? list : []) {
      if (!a || typeof a !== 'object') continue;
      const season = typeof a.season === 'string' && /^[A-Za-z0-9 ]{1,12}$/.test(a.season.trim()) ? a.season.trim().toUpperCase() : null;
      if (!season) continue;
      const rank = typeof a.endTier === 'string' && /^[A-Za-z][A-Za-z0-9 ]{0,24}$/.test(a.endTier.trim()) ? a.endTier.trim() : null;
      const games = count(a.games);
      const wins = count(a.wins);
      const ok = games != null && games > 0 && wins != null && wins <= games;
      if (!rank && !ok) continue;
      out.push({ season, rank, wins: ok ? wins : null, games: ok ? games : null, winRate: ok ? Math.round((wins / games) * 100) : null });
    }
    return out.reverse();
  }

  const api = { numbers, byMap, agents, acts };
  if (typeof window !== 'undefined') window.StatsProfile = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
