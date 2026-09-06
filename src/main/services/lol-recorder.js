'use strict';

/**
 * The League recorder. It watches a game and says NOTHING while it is running.
 *
 * WHY IT IS SILENT, and this is not a limitation to engineer around later.
 * Riot's League policy lists exactly one approved overlay category, "game
 * overlays that provide static data that is available prior to the game", and
 * bans two things that describe a live coaching tip precisely: products that
 * "provide any game-session-specific information that would be previously
 * unknown to the player", and "apps that dictate player decisions". Riot's
 * VALORANT policy names the legitimate alternative in the same breath: altering
 * behaviour "upon reflection, learning and coaching the player game over game".
 *
 * So this records, and the coaching happens afterwards. Nothing reaches the
 * overlay while the player is in champion select or on the Rift.
 *
 * WHAT IT READS. The Live Client Data API on 127.0.0.1:2999, which Riot
 * documents on the developer portal and which needs no API key. It is not the
 * LCU, which Riot classes as unsupported for third parties. It is not memory
 * reading, not file access and not input automation, so the founding promise
 * still holds: this client only ever sees what is already on the player's own
 * machine and screen.
 *
 * THE SCHEMA IS NOT VERIFIED AGAINST A LIVE GAME. No League client was running
 * when this was written, so field names come from Riot's published docs rather
 * than from a real payload. Everything is therefore read through num(), str()
 * and arr(), which treat absence as UNKNOWN. A field name that turns out wrong
 * produces "not measured", never a confident wrong number. The raw event list
 * is stored verbatim so a first real game can be inspected and the readers
 * corrected without having lost anything.
 */

const EventEmitter = require('events');
const https = require('https');

const HOST = '127.0.0.1';
const PORT = 2999;

/** Every 5s. The game is on the same machine, so this costs nothing, and it is
 *  fine enough to catch the 10:00 and 15:00 snapshots within a few seconds. */
const POLL_MS = 5000;

/** Snapshot marks, in seconds of game time. Both are standard coaching
 *  checkpoints: CS at 10 minutes and deaths before 15 minutes. */
const MARK_10 = 600;
const MARK_15 = 900;

/** After this many consecutive failures following a live game, the game is over. */
const GONE_STRIKES = 3;

const num = (v) => (typeof v === 'number' && isFinite(v) ? v : null);
const str = (v) => (typeof v === 'string' ? v : '');
const arr = (v) => (Array.isArray(v) ? v : []);

/**
 * The client serves HTTPS with a SELF SIGNED certificate, so a normal request
 * fails verification.
 *
 * This agent is scoped to these requests and nothing else. Setting
 * NODE_TLS_REJECT_UNAUTHORIZED=0, which is the answer most snippets give, would
 * disable certificate checking for the WHOLE process, including the licence
 * check and the coaching API. That would turn a local convenience into a real
 * security hole, so it is never done here.
 */
const agent = new https.Agent({ rejectUnauthorized: false, keepAlive: true });

function getJson(path, timeoutMs = 4000) {
  return new Promise((resolve) => {
    const req = https.request(
      { host: HOST, port: PORT, path, method: 'GET', agent, timeout: timeoutMs },
      (res) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (c) => { body += c; });
        res.on('end', () => {
          if (res.statusCode !== 200) return resolve(null);
          try { resolve(JSON.parse(body)); } catch { resolve(null); }
        });
      },
    );
    // No game running is the normal state, not an error. Every failure path
    // resolves null and the caller simply waits.
    req.on('error', () => resolve(null));
    req.on('timeout', () => { req.destroy(); resolve(null); });
    req.end();
  });
}

/** Is a game in progress right now? Cheap enough to call from the UI. */
async function probe() {
  const g = await getJson('/liveclientdata/gamestats');
  if (!g) return { running: false };
  return {
    running: true,
    gameMode: str(g.gameMode),
    mapName: str(g.mapName),
    gameTime: num(g.gameTime) || 0,
  };
}

class LolRecorder extends EventEmitter {
  /**
   * @param opts.role  the player's role, for grading
   * @param opts.band  their rank band, for grading
   * @param opts.log   line logger
   */
  constructor(opts) {
    super();
    const o = opts || {};
    this.getRole = o.getRole || (() => '');
    this.getBand = o.getBand || (() => null);
    this.log = o.log || (() => {});
    this.timer = null;
    this.reset();
  }

  reset() {
    this.live = false;        // a game is currently being recorded
    this.strikes = 0;
    this.me = '';
    this.allies = [];
    this.champion = '';
    this.events = [];
    this.seenEventIds = new Set();
    this.at10 = null;         // scores snapshot at MARK_10
    this.at15 = null;
    this.last = null;         // most recent scores snapshot
    this.lastGameTime = 0;
    this.mapName = '';
    this.gameMode = '';
  }

  start() {
    if (this.timer) return;
    this.timer = setInterval(() => this.tick().catch(() => {}), POLL_MS);
    this.log('[lol] recorder watching for a game, no tips will be shown');
    this.emit('status', { running: true, watching: true, game: 'lol' });
    this.tick().catch(() => {});
  }

  stop() {
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
    // A game abandoned part way is not graded: a partial record would produce
    // confident numbers about a game that did not finish.
    this.reset();
    this.emit('status', { running: false, watching: false, game: 'lol' });
    this.log('[lol] recorder stopped');
  }

  async tick() {
    const all = await getJson('/liveclientdata/allgamedata');

    if (!all) {
      if (!this.live) return;                 // no game, nothing to do, stay quiet
      this.strikes += 1;
      // The endpoint disappearing is how most games actually end: the client
      // tears it down before or instead of emitting a clean GameEnd.
      if (this.strikes >= GONE_STRIKES) this.finish('client-gone');
      return;
    }
    this.strikes = 0;

    const stats = all.gameData || {};
    const gameTime = num(stats.gameTime) || 0;
    const players = arr(all.allPlayers);
    const active = all.activePlayer || {};

    if (!this.live) {
      // Do not start recording off a stale endpoint from a previous game.
      if (!players.length) return;
      this.live = true;
      this.mapName = str(stats.mapName);
      this.gameMode = str(stats.gameMode);
      this.identify(active, players);
      this.log(`[lol] recording ${this.gameMode || 'a game'} as ${this.champion || 'unknown champion'}`);
      this.emit('status', { running: true, watching: true, recording: true, game: 'lol' });
    }

    this.lastGameTime = gameTime;
    this.collectEvents(all);

    const mine = this.mePlayer(players);
    if (mine) {
      const snap = this.snapshot(mine, gameTime);
      this.last = snap;
      if (!this.at10 && gameTime >= MARK_10) this.at10 = snap;
      if (!this.at15 && gameTime >= MARK_15) this.at15 = snap;
    }

    // A clean GameEnd is the other way a game finishes.
    if (this.events.some((e) => str(e.EventName) === 'GameEnd')) this.finish('game-end');
  }

  /**
   * Work out who the player is and who is on their side.
   *
   * Riot moved from summonerName to the riotId fields, and both appear in the
   * wild depending on patch and region, so every candidate is tried and the
   * first non-empty one wins. Getting this wrong would silently grade someone
   * else's game, so it is also recorded on the result for inspection.
   */
  identify(active, players) {
    this.me = str(active.riotId) || str(active.summonerName)
      || str((active.riotIdGameName && active.riotIdTagLine)
        ? active.riotIdGameName + '#' + active.riotIdTagLine : '');

    const key = (p) => str(p.riotId) || str(p.summonerName)
      || str((p.riotIdGameName && p.riotIdTagLine) ? p.riotIdGameName + '#' + p.riotIdTagLine : '');

    const mine = players.find((p) => key(p) === this.me);
    this.champion = mine ? str(mine.championName) : '';
    const team = mine ? str(mine.team) : '';
    this.allies = players
      .filter((p) => str(p.team) === team && key(p) !== this.me)
      .map(key)
      .filter(Boolean);
  }

  mePlayer(players) {
    const key = (p) => str(p.riotId) || str(p.summonerName)
      || str((p.riotIdGameName && p.riotIdTagLine) ? p.riotIdGameName + '#' + p.riotIdTagLine : '');
    return players.find((p) => key(p) === this.me) || null;
  }

  snapshot(p, gameTime) {
    const s = p.scores || {};
    return {
      t: gameTime,
      cs: num(s.creepScore),
      kills: num(s.kills),
      deaths: num(s.deaths),
      assists: num(s.assists),
      ward: num(s.wardScore),
      level: num(p.level),
      items: arr(p.items).map((i) => ({ id: num(i.itemID), name: str(i.displayName), slot: num(i.slot) })),
    };
  }

  /**
   * Accumulate events, de-duplicated by EventID.
   *
   * The endpoint returns the FULL list every poll rather than only new entries,
   * so appending blindly would multiply every kill by the number of polls and
   * turn a 4 death game into a 200 death one.
   */
  collectEvents(all) {
    const list = arr((all.events || {}).Events);
    for (const e of list) {
      if (!e || typeof e !== 'object') continue;
      const id = num(e.EventID);
      const k = id === null ? `${str(e.EventName)}@${num(e.EventTime)}` : `id:${id}`;
      if (this.seenEventIds.has(k)) continue;
      this.seenEventIds.add(k);
      this.events.push(e);
    }
  }

  /** Build the record the grader expects, then hand it over. */
  finish(reason) {
    if (!this.live) return;
    const record = this.toRecord();
    this.log(`[lol] game finished (${reason}), ${this.events.length} events recorded`);
    this.reset();
    this.emit('status', { running: true, watching: true, recording: false, game: 'lol' });
    this.emit('game', record);
  }

  /**
   * The shape lol-grader.gradeGame() expects.
   *
   * Anything not actually observed stays null so the grader reports "not
   * measured". A zero here would grade as a failure, which is the specific way
   * this kind of code lies.
   */
  toRecord() {
    const mineDeaths = this.events.filter((e) =>
      str(e.EventName) === 'ChampionKill' && str(e.VictimName) === this.me);

    return {
      me: this.me,
      allies: this.allies,
      champion: this.champion,
      role: this.getRole(),
      band: this.getBand(),
      map: this.mapName,
      mode: this.gameMode,
      stats: {
        gameTimeSec: this.lastGameTime || null,
        // Measured AT the ten minute mark, not extrapolated from the final
        // total, which would flatter anyone who farmed well late.
        csAt10: this.at10 ? this.at10.cs : null,
        deathsBy15: mineDeaths.filter((e) => (num(e.EventTime) || 0) <= MARK_15).length,
        wardScore: this.last ? this.last.ward : null,
        // Not derivable from this API. Left null ON PURPOSE so the grader says
        // "not measured" rather than scoring a zero.
        deathsAhead: null,
        goldHeldSec: null,
      },
      final: this.last,
      at10: this.at10,
      at15: this.at15,
      events: this.events,
      // Kept so a first real game can be inspected when a field name turns out
      // to be wrong for the current patch.
      recordedWith: { poll: POLL_MS, endpoint: `https://${HOST}:${PORT}` },
    };
  }
}

module.exports = { LolRecorder, probe, POLL_MS, MARK_10, MARK_15 };
