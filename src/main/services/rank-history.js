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
 * AN OUTAGE KEEPS THE LAST GOOD HISTORY (8.7.9). An answer with no points
 * never replaces a held one that has points for the same Riot ID, and a read
 * that fails returns what is held. With a `disk` the last good history is
 * also kept in userData, so a restart during a HenrikDev outage still shows
 * RR: the record is { v, key, at, data }, `key` a sha256 of the Riot ID, so
 * no Riot ID is stored in plain text, and `data` keeps only each point's
 * numbers, tier and match id, and the current one, so no name and no puuid.
 * It is read lazily, the first time held() or a failed read needs it, and
 * used only when its key is this Riot ID's.
 *
 * Plain JS, no Electron, so test:homemodel runs it against a stand in server.
 */

const crypto = require('crypto');

const TTL_MS = 5 * 60 * 1000;
const TIMEOUT_MS = 15000;

/** The on disk key for a Riot ID: a hash, never the Riot ID itself. */
function diskKey(riotId) {
  return crypto.createHash('sha256').update('occlara-rank|' + String(riotId || '').trim().toLowerCase()).digest('hex');
}

const POINT_FIELDS = ['date', 'elo', 'change', 'tier', 'matchId', 'refunded', 'derankProtected'];
/** A point cut to the fields the app reads, so nothing else reaches the disk. */
function slimPoint(p) {
  if (!p || typeof p !== 'object') return null;
  const o = {};
  for (const k of POINT_FIELDS) if (p[k] !== undefined) o[k] = p[k];
  return o;
}
/** The history cut for the disk: the points and current, no other field. */
function slimHistory(data) {
  const points = (Array.isArray(data && data.points) ? data.points : []).map(slimPoint).filter(Boolean);
  return { points, current: data && data.current ? slimPoint(data.current) : (points.length ? points[points.length - 1] : null) };
}
const hasPoints = (d) => !!(d && Array.isArray(d.points) && d.points.length);

class RankHistory {
  /**
   * @param get  (path, timeoutMs) => Promise<{ ok, data }>, the server
   * @param now  the clock, a test's own
   * @param disk optional { load() => object|null, save(object) }, the last
   *             good history kept across restarts (userData)
   */
  constructor({ get, now, disk }) {
    this.get = get;
    this.now = now || Date.now;
    this.disk = disk || null;
    this.diskRead = false;
    this.diskRecord = null;
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

  /** The disk copy for `id`, read once, or null for another Riot ID or none. */
  fromDisk(id) {
    if (!this.disk) return null;
    if (!this.diskRead) {
      this.diskRead = true;
      try {
        const r = this.disk.load();
        this.diskRecord = r && r.v === 1 && typeof r.key === 'string' && hasPoints(r.data) ? r : null;
      } catch { this.diskRecord = null; }
    }
    const r = this.diskRecord;
    return r && id && r.key === diskKey(id) ? r.data : null;
  }

  /** Keep a good history with points on disk, cut to its numbers. */
  toDisk(id, data) {
    if (!this.disk || !hasPoints(data)) return;
    const rec = { v: 1, key: diskKey(id), at: this.now(), data: slimHistory(data) };
    this.diskRead = true;
    this.diskRecord = rec;
    try { this.disk.save(rec); } catch {}
  }

  /** Nothing held: recording stopped, or another Riot ID or game in Settings.
   *  Memory only: the disk copy is keyed by Riot ID and stays for a restart. */
  clear() {
    this.cache = { at: 0, riotId: '', data: null, seq: this.seq };
  }

  /** A review was just linked to Riot's record, so Riot has published a match. */
  published() {
    this.links++;
  }

  /**
   * The history held for `riotId`, whatever its age, with no read: what the
   * rank band sent with a review is derived from (src/shared/rank-band.js).
   * Null for another Riot ID or nothing held.
   */
  held(riotId) {
    const id = String(riotId || '').trim();
    if (!id) return null;
    if (this.cache.riotId === id && this.cache.data) return this.cache.data;
    return this.fromDisk(id);
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
    const held = () => (this.cache.riotId === id && this.cache.data) || this.fromDisk(id) || null;
    try {
      const { ok, data } = await this.get('/api/coach/rank-history?username=' + encodeURIComponent(id)
        + (past ? '&refresh=1' : ''), TIMEOUT_MS);
      if (ok && data && !data.error) {
        // An answer with no points never puts away a held one with points.
        const before = held();
        if (!hasPoints(data) && hasPoints(before)) return before;
        // Held only when no read started after this one has answered first.
        if (mine > (this.cache.seq || 0)) {
          this.cache = { at: this.now(), riotId: id, data, seq: mine };
          this.toDisk(id, data);
        }
        if (past) this.followed = Math.max(this.followed, upTo);
        return data;
      }
      return held() || data || { error: 'unavailable' };
    } catch {
      return held() || { error: 'unavailable' };
    }
  }
}

module.exports = { RankHistory, TTL_MS, diskKey, slimHistory };
