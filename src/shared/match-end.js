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
 * Too early is the expensive one, so every path here waits for a second piece of
 * evidence before it fires.
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
 *    A final score is then CONFIRMED by a second frame showing it, or by the
 *    next frame being a menu. One misread digit (12 to 10 read as 13 to 10 is a
 *    normal one round step and passes the continuity guard) must not open a
 *    window in the middle of round 23.
 *
 * 2. THE MENU. Every mode ends in a menu, including the ones with no score to
 *    read (spike rush, deathmatch, a draw vote, a surrender). Several menu frames
 *    in a row, most of a minute since the last gameplay, and enough rounds
 *    recorded to be worth reviewing. The time floor is what stops an alt tab
 *    during a buy phase from ending the match.
 *
 * AFTER THE END the watch ignores gameplay until a new match shows itself, so
 * the end-of-match screen, which still shows the final score and a HUD, is not
 * recorded as the first round of the next match.
 *
 * Pure module, so the tests drive it with real logged sessions.
 */

const LOBBY_FRAMES = 3;
const LOBBY_MS = 45000;
const MIN_ROUNDS = 3;

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
    this.reset();
  }

  reset() {
    this.lobbyStreak = 0;
    this.lastPlayAt = null;     // when gameplay was last seen, null before any
    this.pendingFinal = null;   // { team, enemy } read once, awaiting confirmation
    this.ended = null;          // { reason, sum } once the match is over
  }

  end(reason, sum) {
    this.ended = { reason, sum };
    this.pendingFinal = null;
    this.lobbyStreak = 0;
    return { kind: 'end', reason };
  }

  /**
   * A gameplay frame, after the engine's guards have settled the score.
   * @returns {{kind:'end',reason}|{kind:'ignore'}|{kind:'new-match'}|null}
   */
  play({ team, enemy, mode, at }) {
    const now = typeof at === 'number' ? at : Date.now();
    const sum = (team | 0) + (enemy | 0);

    if (this.ended) {
      // A score END is followed by an end screen still showing that score, so
      // only a LOWER score is a new match. A MENU end has no score to compare,
      // and any gameplay after the menu is the next thing being played.
      if (this.ended.reason === 'lobby' || sum < this.ended.sum) {
        this.ended = null;
        this.lastPlayAt = now;
        this.lobbyStreak = 0;
        return { kind: 'new-match' };
      }
      return { kind: 'ignore' };
    }

    this.lobbyStreak = 0;
    this.lastPlayAt = now;

    if (isFinalScore(team, enemy, mode)) {
      const p = this.pendingFinal;
      if (p && p.team === team && p.enemy === enemy) return this.end('score', sum);
      this.pendingFinal = { team, enemy };
    } else {
      // The final read was a misread: play went on at a score that is not final.
      this.pendingFinal = null;
    }
    return null;
  }

  /**
   * A menu, lobby or loading frame.
   * @param rounds  rounds recorded in this match so far
   */
  lobby({ at, rounds }) {
    if (this.ended) return { kind: 'ignore' };
    const now = typeof at === 'number' ? at : Date.now();
    this.lobbyStreak++;

    if (this.pendingFinal) {
      const { team, enemy } = this.pendingFinal;
      return this.end('score', team + enemy);
    }
    if (this.lobbyStreak >= this.lobbyFrames
        && this.lastPlayAt !== null && now - this.lastPlayAt >= this.lobbyMs
        && (rounds | 0) >= this.minRounds) {
      return this.end('lobby', 0);
    }
    return null;
  }
}

module.exports = { MatchEndWatch, isFinalScore, LOBBY_FRAMES, LOBBY_MS, MIN_ROUNDS };
