'use strict';

/**
 * The rank history main keeps for Stats and Home (STATS_RANK_HISTORY): the
 * player's competitive games as Riot rated them, read through the server's
 * /api/coach/rank-history, which holds its answer five minutes, and held here
 * five minutes more per Riot ID.
 *
 * A MATCH JUST LINKED TO RIOT'S RECORD IS ONE RIOT HAS PUBLISHED (8.2.1). The
 * history both caches held was read as that match ended, when its review was
 * first saved and Home asked for the rank, before Riot had put the game in it.
 * Every save after that read it back, the verified one included, so Home
 * showed the match with no RR, or the game before's in the rank card, until
 * the next match. So a link (published()) has the next read go past both
 * caches: past this one, and the server's through refresh=1, which it honours
 * once in three minutes, as it does Stats' Refresh. The history held stays
 * only as what a read that fails falls back to, as it always was.
 *
 * Plain JS, no Electron, so test:homemodel runs it against a stand in server.
 */

const TTL_MS = 5 * 60 * 1000;
const TIMEOUT_MS = 15000;

class RankHistory {
  /**
   * @param get  (path, timeoutMs) => Promise<{ ok, data }>, the server
   * @param now  the clock, a test's own
   */
  constructor({ get, now }) {
    this.get = get;
    this.now = now || Date.now;
    this.cache = { at: 0, riotId: '', data: null, seq: 0 };
    // Links seen, and how many of them a read past both caches has followed.
    this.links = 0;
    this.followed = 0;
    // Reads started, in order. A read held up past a newer one never puts its
    // older answer over the newer one's: a plain read still out when a match
    // linked landed after the read past both caches, and put the history from
    // before Riot published back for every read after it.
    this.seq = 0;
  }

  /** Nothing held: recording stopped, or another Riot ID or game in Settings. */
  clear() {
    this.cache = { at: 0, riotId: '', data: null, seq: this.seq };
  }

  /** A review was just linked to Riot's record, so Riot has published a match. */
  published() {
    this.links++;
  }

  /** Whether a link came since the last read past both caches. */
  stale() {
    return this.links > this.followed;
  }

  /**
   * The history of `riotId`: the one held while it is under five minutes old,
   * unless the read is forced (Stats' Refresh) or a link came since it.
   */
  async read(riotId, force) {
    const id = String(riotId || '').trim();
    if (!id.includes('#')) return { error: 'no-riot-id' };
    const c = this.cache;
    if (!force && !this.stale() && c.data && c.riotId === id && this.now() - c.at < TTL_MS) return c.data;
    const past = !!force || this.stale();
    const upTo = this.links;
    const mine = ++this.seq;
    const held = () => (this.cache.riotId === id && this.cache.data) || null;
    try {
      const { ok, data } = await this.get('/api/coach/rank-history?username=' + encodeURIComponent(id)
        + (past ? '&refresh=1' : ''), TIMEOUT_MS);
      if (ok && data && !data.error) {
        // Held only when no read started after this one has answered first.
        if (mine > (this.cache.seq || 0)) this.cache = { at: this.now(), riotId: id, data, seq: mine };
        if (past) this.followed = Math.max(this.followed, upTo);
        return data;
      }
      return held() || data || { error: 'unavailable' };
    } catch {
      return held() || { error: 'unavailable' };
    }
  }
}

module.exports = { RankHistory, TTL_MS };
