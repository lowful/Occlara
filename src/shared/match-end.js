'use strict';

/**
 * When is a Valorant match over?
 *
 * Nothing answered this before, because nothing needed to: the review fired when
 * the player pressed stop. Now that live tips are closed the review IS the
 * product, so it has to arrive on its own when the match ends, and it has to be
 * right about that in both directions:
 *
 *   too late   the player has already queued again and never sees it
 *   too early  a window opens over a match that is still being played, which
 *              is the one thing this whole mode exists to prevent
 *
 * Too early is the expensive one, so every path here waits for evidence that the
 * game has actually stopped before it fires.
 *
 * TWO WAYS TO KNOW.
 *
 * 1. THE SCORE. A score is final only when no mode could continue from it. A 13
 *    with the loser on 11 or less ends any standard match. Overtime needs a lead
 *    of exactly two from 12 all. Swiftplay ends at 5, but only once the mode is
 *    locked, because a standard match passes through 5 to 3 on the way. 13 to 12
 *    is deliberately NOT final: unrated ends there on sudden death and
 *    competitive goes to overtime, and nothing on the HUD says which.
 *
 *    A final score is then CONFIRMED by the game stopping: the next frame being
 *    a menu (the end of match screen reads as one), or twenty seconds of frames
 *    at that score with no buy phase and no running round clock. A buy phase or
 *    a clock that is still counting down means another round is being played,
 *    so the score was not final after all.
 *
 *    "A second read" used to be enough, and stopped being enough when reads went
 *    from one every twelve seconds to one a second. Two reads a second apart are
 *    the same moment read twice: a real session had swiftplay wrongly locked
 *    from a misread side, read 3 to 5 twice in two seconds at the end of round 8
 *    of a competitive match, and opened the review over round 9.
 *
 *    A SWIFTPLAY final needs the menu, twice. Its mode is the weakest fact the
 *    engine has (Valorant prints it only on screens that read as menus), and 5
 *    to 3 is an ordinary score in a standard match, so time alone never ends one.
 *
 * 2. THE MENU. Every mode ends in a menu, including the ones with no score to
 *    read (spike rush, deathmatch, a draw vote, a surrender). Several menu frames
 *    in a row, most of a minute since the last gameplay, and enough rounds
 *    recorded to be worth reviewing. The time floor is what stops an alt tab
 *    during a buy phase from ending the match.
 *
 * AFTER THE END the watch ignores gameplay until a new match shows itself, so
 * the end-of-match screen, which still shows the final score and a HUD, is not
 * recorded as the first round of the next match. A new match needs a score READ
 * on its own frame and lower than the end: the engine holds the last score when
 * a frame has none, and a new ledger started on the old match's held score files
 * every round of the new match under round 25.
 *
 * AND IF IT WAS NOT THE END, the same match RESUMES. Gameplay that carries on
 * from the ended score (a buy phase at it, or a higher score), read twice within
 * five minutes on the same map, is the match continuing: a misread end, or a
 * crash and reconnect after the menu path fired. Without this the rest of the
 * match was ignored as the end screen, and stopping reviewed nothing at all.
 *
 * Pure module, so the tests drive it with real logged sessions.
 */

const { clockSeconds, isBuyPhase, BUY_MAX_LEFT } = require('./valorant-rounds');

const LOBBY_FRAMES = 3;
const LOBBY_MS = 45000;
const MIN_ROUNDS = 3;
// Measured on the logged sessions: after a round's score is first read, the next
// buy phase showed within 15 seconds at a read a second, and within 48 at the old
// read every ten. Twenty seconds and three frames sit past the first; the second
// is what the running clock check is for.
const SETTLE_MS = 20000;
const SETTLE_FRAMES = 3;
const SWIFT_MENU_FRAMES = 2;
const RESUME_FRAMES = 2;
const RESUME_MS = 5 * 60 * 1000;
const RESUME_ROUNDS = 3;
// Below this a clock may be a round end banner's, frozen where the round ended.
const LIVE_CLOCK_LEFT = 15;
const CLOCK_PHASES = new Set(['active', 'postplant', 'dead']);

/** A score no mode could continue from. */
function isFinalScore(team, enemy, mode) {
  if (typeof team !== 'number' || typeof enemy !== 'number') return false;
  const hi = Math.max(team, enemy);
  const lo = Math.min(team, enemy);
  if (mode === 'swiftplay') return hi === 5 && lo <= 4;
  if (hi === 13 && lo <= 11) return true;
  if (lo >= 12 && hi - lo === 2) return true;   // overtime, won by two
  return false;
}

class MatchEndWatch {
  constructor(opts = {}) {
    this.lobbyFrames = opts.lobbyFrames || LOBBY_FRAMES;
    this.lobbyMs = opts.lobbyMs || LOBBY_MS;
    this.minRounds = opts.minRounds || MIN_ROUNDS;
    this.settleMs = opts.settleMs || SETTLE_MS;
    this.reset();
  }

  reset() {
    this.lobbyStreak = 0;
    this.lastPlayAt = null;     // when gameplay was last seen, null before any
    this.last = null;           // { team, enemy, map } of the last gameplay frame
    this.pendingFinal = null;   // a final score read, waiting for the game to stop
    this.ended = null;          // { reason, team, enemy, sum, map, at } once over
    this.resumeStreak = 0;
  }

  end(reason, at) {
    const l = this.last || { team: 0, enemy: 0, map: null };
    const p = this.pendingFinal;
    const team = reason === 'score' && p ? p.team : l.team;
    const enemy = reason === 'score' && p ? p.enemy : l.enemy;
    this.ended = { reason, team, enemy, sum: team + enemy, map: l.map || null, at };
    this.pendingFinal = null;
    this.lobbyStreak = 0;
    this.resumeStreak = 0;
    return { kind: 'end', reason };
  }

  /**
   * Is this frame the ended match carrying on? See RESUME in the header.
   * A frame without a score read of its own never counts: its score is the
   * engine's held copy of the end, which proves nothing.
   */
  continues(f) {
    const e = this.ended;
    if (!e || !f.scoreRead || f.at - e.at > RESUME_MS) return false;
    if (f.team < e.team || f.enemy < e.enemy) return false;
    const sum = f.team + f.enemy;
    if (sum - e.sum > RESUME_ROUNDS) return false;
    if (e.map && f.map && e.map !== f.map) return false;
    if (e.reason === 'score') return sum > e.sum || isBuyPhase(f.phase, f.clock);
    // A menu end has no final score, so only play at or past where it stopped.
    return e.sum > 0 && (sum > e.sum || isBuyPhase(f.phase, f.clock));
  }

  /**
   * A gameplay frame, after the engine's guards have settled the score.
   *
   * @param f.team, f.enemy  the guarded score
   * @param f.mode           the locked game mode, or null
   * @param f.phase, f.clock this frame's phase and round timer
   * @param f.map            the locked map, or null
   * @param f.scoreRead      false when this frame had no score of its own and
   *                         team/enemy are the engine's held copy. Default true.
   * @returns {{kind:'end',reason}|{kind:'ignore'}|{kind:'new-match'}|{kind:'resume',from}|null}
   */
  play(f) {
    const at = typeof f.at === 'number' ? f.at : Date.now();
    const team = f.team | 0;
    const enemy = f.enemy | 0;
    const sum = team + enemy;
    const frame = { team, enemy, phase: f.phase || null, clock: f.clock || null, map: f.map || null,
      scoreRead: f.scoreRead !== false, at };

    if (this.ended) {
      if (this.continues(frame)) {
        this.resumeStreak++;
        if (this.resumeStreak < RESUME_FRAMES) return { kind: 'ignore' };
        const from = this.ended.reason;
        this.ended = null;
        this.resumeStreak = 0;
        this.lobbyStreak = 0;
        this.lastPlayAt = at;
        this.last = { team, enemy, map: frame.map };
        return { kind: 'resume', from };
      }
      this.resumeStreak = 0;
      if (frame.scoreRead && (this.ended.reason === 'lobby' || sum < this.ended.sum)) {
        this.ended = null;
        this.lastPlayAt = at;
        this.lobbyStreak = 0;
        this.last = { team, enemy, map: frame.map };
        return { kind: 'new-match' };
      }
      return { kind: 'ignore' };
    }

    this.lobbyStreak = 0;
    this.lastPlayAt = at;
    this.last = { team, enemy, map: frame.map };

    if (!isFinalScore(team, enemy, f.mode)) {
      // Play went on at a score that is not final: any pending one was a misread.
      this.pendingFinal = null;
      return null;
    }
    // A buy phase at a "final" score is the next round being bought.
    if (isBuyPhase(frame.phase, frame.clock)) {
      this.pendingFinal = null;
      return null;
    }
    let p = this.pendingFinal;
    if (!p || p.team !== team || p.enemy !== enemy) {
      p = this.pendingFinal = {
        team, enemy, at, frames: 0, clock: null,
        // 5 to 3 is only final because the mode says swiftplay. 13 to 3 would be
        // final in either, so it is held to the standard bar.
        swift: !isFinalScore(team, enemy, 'standard'),
      };
    }
    p.frames++;
    // A round clock still counting down is a round still being played. One
    // frozen clock is a banner; two different ones above the banner range are not.
    const left = CLOCK_PHASES.has(frame.phase) ? clockSeconds(frame.clock) : null;
    if (left !== null && left >= LIVE_CLOCK_LEFT) {
      if (p.clock !== null && Math.abs(p.clock - left) >= 2) {
        this.pendingFinal = null;
        return null;
      }
      if (p.clock === null) p.clock = left;
    }
    if (!p.swift && p.frames >= SETTLE_FRAMES && at - p.at >= this.settleMs) return this.end('score', at);
    return null;
  }

  /**
   * A menu, lobby or loading frame.
   * @param rounds  rounds recorded in this match so far
   */
  lobby({ at, rounds }) {
    const now = typeof at === 'number' ? at : Date.now();
    if (this.ended) {
      this.resumeStreak = 0;
      return { kind: 'ignore' };
    }
    this.lobbyStreak++;

    const p = this.pendingFinal;
    if (p && this.lobbyStreak >= (p.swift ? SWIFT_MENU_FRAMES : 1)) return this.end('score', now);
    if (this.lobbyStreak >= this.lobbyFrames
        && this.lastPlayAt !== null && now - this.lastPlayAt >= this.lobbyMs
        && (rounds | 0) >= this.minRounds) {
      return this.end('lobby', now);
    }
    return null;
  }
}

module.exports = {
  MatchEndWatch, isFinalScore, isBuyPhase,
  LOBBY_FRAMES, LOBBY_MS, MIN_ROUNDS, SETTLE_MS, SETTLE_FRAMES, RESUME_MS, BUY_MAX_LEFT,
};
