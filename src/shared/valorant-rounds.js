'use strict';

/**
 * The round ledger: what the coach saw in each round of one Valorant match.
 *
 * WHY THIS EXISTS. Live Valorant tips are closed (see games.js), so everything
 * the coach reads during a match now lands in the post-match review instead of
 * on the player's screen. The old review was four sentences written from a flat
 * list of tips, which cannot say WHICH round anything happened in. A review is
 * only checkable against the player's memory if it is anchored to rounds, and
 * "round 7, defence, died at A Site 20 seconds in" is something a player can
 * check where "you peeked alone a lot" is not.
 *
 * IT IS FED THE ENGINE'S GUARDED CONTEXT, never the raw model read. The raw read
 * announces deaths during buy phases, flips the side mid round and reads the
 * spectated teammate's health as the player's own. Every one of those is
 * already corrected by a guard in coaching-engine.js, and a ledger that
 * re-derived facts from the raw read would reintroduce all of them in the one
 * place a wrong sentence costs most.
 *
 * THE ROUND NUMBER COMES FROM THE SCORE, for the reason the engine gives: the
 * HUD prints two scores and never prints "round 6". Round = team + enemy + 1.
 *
 * Pure module, no Electron, so the tests replay real logged sessions through it.
 */

const MAX_READS_PER_ROUND = 3;
const MAX_LOCS_PER_ROUND = 4;
// The round timer starts at 1:40 once the barriers drop. A death with this much
// or more left on the clock, before any plant, came in the first 30 seconds.
const ROUND_SECONDS = 100;
const EARLY_DEATH_LEFT = 70;
// An active frame with less than this left is a round end banner, not play.
const MID_ROUND_LEFT = 15;

/** "1:05" -> 65, anything unreadable -> null. */
function clockSeconds(clock) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(clock || '').trim());
  if (!m) return null;
  const s = Number(m[1]) * 60 + Number(m[2]);
  return s >= 0 && s <= ROUND_SECONDS ? s : null;
}

function cleanSpot(v) {
  const s = String(v || '').trim();
  if (!s || s.length > 40) return null;
  return s;
}

// A SPAWN IS WHERE ROUNDS BEGIN, NOT WHERE DEATHS HAPPEN, the same rule the
// engine's death spot gate applies. On the real 24 round match five deaths were
// pinned to "Defender Side Spawn" or "Attacker Side Spawn", every one of them a
// spectator camera or a round end banner read, and together they dragged the
// genuine 6 of 22 at A Site under the pattern bar.
const SPAWN = /(side|spawn)$/i;

function deathSpotOf(v) {
  const s = cleanSpot(v);
  return s && !SPAWN.test(s) ? s : null;
}

/** Two reads of the same moment, reworded. Word overlap, no regex. */
function sameRead(a, b) {
  const words = (t) => new Set(String(t).toLowerCase().split(/[^a-z0-9']+/).filter((w) => w.length > 2));
  const A = words(a);
  const B = words(b);
  if (!A.size || !B.size) return false;
  let shared = 0;
  for (const w of A) if (B.has(w)) shared++;
  return shared / Math.min(A.size, B.size) >= 0.7;
}

const PLAY_PHASES = new Set(['active', 'postplant']);

class RoundLedger {
  constructor() {
    this.rounds = new Map();   // round number -> entry
    this.last = null;          // { team, enemy } of the previous frame
    this.base = 0;             // team + enemy + 1 at the last score read
    this.offset = 0;           // rounds begun since then, told by a buy phase
    this.lastDeathRound = null;
  }

  entry(n) {
    if (!this.rounds.has(n)) {
      this.rounds.set(n, {
        n,
        sides: {},            // side -> frame count, majority wins
        result: null,         // 'won' | 'lost' | null (not seen, or order unknown)
        died: false,
        deathSpot: null,
        deathClock: null,     // seconds left on the round timer at death, when read
        deathPhase: null,
        ultAtDeath: null,     // the last ult read while alive, before the death
        ultSeen: null,        // 'ready' once a ready read landed this round
        planted: false,
        plantSpot: null,
        locs: [],             // distinct locations, in the order first seen
        reads: [],            // the coach's reads for this round, deduplicated
        bought: false,        // a buy phase frame landed in this round
        played: false,        // an active or post-plant frame landed in this round
        frames: 0,
        firstAt: null,
        lastAt: null,
      });
    }
    return this.rounds.get(n);
  }

  /**
   * One analysed gameplay frame.
   *
   * @param f.team, f.enemy   the guarded score (numbers)
   * @param f.side            'attacking' | 'defending' | null
   * @param f.phase           guarded phase
   * @param f.died            TRUE ONLY on the frame the engine registered a death
   * @param f.deathSpot       where it pinned that death
   * @param f.clock           round timer string
   * @param f.ult             'ready' | 'charging' | null, player owned only
   * @param f.spike, f.spikeSpot, f.loc
   * @param f.tip             { text, source, death } shown this cycle, or null
   */
  observe(f) {
    if (!f || typeof f.team !== 'number' || typeof f.enemy !== 'number') return;
    const team = f.team | 0;
    const enemy = f.enemy | 0;

    // Score moved: the rounds in between are over, and their results follow
    // from which side's number went up. A jump of more than one round (frames
    // missed during a round end) is still exact when only one side moved; when
    // both moved at once the order is unknowable, so those rounds get no result
    // rather than a guessed one.
    let scoreMoved = false;
    if (this.last && (team !== this.last.team || enemy !== this.last.enemy)) {
      const dt = team - this.last.team;
      const de = enemy - this.last.enemy;
      if (dt >= 0 && de >= 0) {
        scoreMoved = true;
        const first = this.last.team + this.last.enemy + 1;
        const count = dt + de;
        for (let i = 0; i < count; i++) {
          const r = this.entry(first + i);
          if (dt && !de) r.result = 'won';
          else if (de && !dt) r.result = 'lost';
        }
      }
    }
    this.last = { team, enemy };

    /*
     * THE SCORE LAGS THE ROUND, and in both directions. Measured on a real 24
     * round session, where a quarter of frames carried no readable score:
     *
     *   late   the next buy phase starts while the score still reads the old
     *          number, so a death early in round 13 was filed under round 12,
     *          which already had one, and was dropped. Round 13 then claimed a
     *          round the player had died in.
     *   early  the round end banner prints the NEW score while the player is
     *          still spectating the old round, so a death at the end of round 6
     *          registered as round 7, and round 7's real death was dropped.
     *
     * A buy phase after play has started is a new round whatever the score
     * says, so it advances by one until the score catches up. And a death
     * before the new round has had a buy phase or any play happened in the
     * round that just ended.
     *
     * "Play" needs a MID ROUND clock. The round end banner is an active phase
     * frame with 0:01 on the clock, and counting it as play made the very next
     * buy phase advance a round that had not started, which then cascaded: every
     * round after it shifted by one. And the flags are kept SINCE THE LAST
     * BOUNDARY rather than on the round entry, so one wrong advance cannot
     * poison the entry the next score read lands on.
     */
    const base = team + enemy + 1;
    if (base > this.base) {
      this.base = base;
      this.offset = 0;
      this.since = { bought: false, played: false, frames: 0 };
    }
    if (!this.since) this.since = { bought: false, played: false, frames: 0 };
    if (f.phase === 'buy' && this.since.played && this.offset < 1) {
      this.offset++;
      this.since = { bought: false, played: false, frames: 0 };
    }
    const n = this.base + this.offset;
    const r = this.entry(n);
    r.frames++;
    r.firstAt = r.firstAt || f.at || null;
    r.lastAt = f.at || r.lastAt;
    const clockLeft = clockSeconds(f.clock);
    const midRound = PLAY_PHASES.has(f.phase)
      && (this.since.bought || (clockLeft !== null && clockLeft >= MID_ROUND_LEFT));
    const fresh = !this.since.bought && !this.since.played;
    this.since.frames++;
    if (f.phase === 'buy') { r.bought = true; this.since.bought = true; }
    if (midRound) { r.played = true; this.since.played = true; }

    if (f.side === 'attacking' || f.side === 'defending') {
      r.sides[f.side] = (r.sides[f.side] || 0) + 1;
    }
    const loc = cleanSpot(f.loc);
    if (loc && !r.locs.some((l) => l.toLowerCase() === loc.toLowerCase())
        && r.locs.length < MAX_LOCS_PER_ROUND) {
      r.locs.push(loc);
    }
    if (f.spike === 'planted') {
      r.planted = true;
      r.plantSpot = r.plantSpot || cleanSpot(f.spikeSpot);
    }
    // The ult icon belongs to the spectated teammate once the player is dead,
    // so only a read taken while alive and before the death counts.
    if (!r.died && f.alive !== false && (f.ult === 'ready' || f.ult === 'charging')) {
      r.ultAtDeath = f.ult;
      if (f.ult === 'ready') r.ultSeen = 'ready';
    }

    if (f.died) {
      const prev = this.rounds.get(n - 1);
      const endOfLast = fresh && f.phase !== 'buy' && !midRound && prev && !prev.died
        && (scoreMoved || this.since.frames <= 2);
      const target = endOfLast ? prev : r;
      // One death per round. The engine already debounces a flapping read, and
      // a second registration in the same round is a misread, not a second life.
      if (!target.died) {
        target.died = true;
        target.deathSpot = deathSpotOf(f.deathSpot) || deathSpotOf(loc);
        // TIMING ONLY WHEN THE ROUND WAS SEEN IN PLAY. The clock on a round end
        // banner is the banner's, and a buy timer is not a round timer, so a
        // death moved back a round, or one with no mid round frame before it,
        // keeps no timing at all. The review turns what survives into a coarse
        // bucket, because a frame every ten seconds cannot place a death to
        // the second and a review that pretends to is lying about precision.
        const timed = !endOfLast && this.since.played
          && clockLeft !== null && clockLeft >= 5 && clockLeft < ROUND_SECONDS;
        target.deathClock = timed ? clockLeft : null;
        target.deathPhase = endOfLast ? null : (f.phase || null);
        this.lastDeathRound = target.n;
      }
    }

    // A death review is ABOUT the round the player died in, and it usually
    // lands in the next buy phase, so it is filed where the death was.
    const t = f.tip;
    if (t && t.text && t.source === 'ai') {
      const home = t.death && this.lastDeathRound && this.rounds.get(this.lastDeathRound)
        ? this.rounds.get(this.lastDeathRound) : r;
      const text = String(t.text).trim();
      if (!home.reads.some((x) => sameRead(x.text, text)) && home.reads.length < MAX_READS_PER_ROUND) {
        home.reads.push({ text, death: !!t.death });
      }
    }
  }

  /**
   * Rounds in order, each with its majority side resolved.
   *
   * @param lastRound  drop anything past it. A final score of 13 to 11 means
   *   24 rounds, and the frame that READ that score opened a round 25 that was
   *   never played. Leaving it in paints an empty round at the end of every
   *   match that ended on a score read.
   */
  list(lastRound) {
    return [...this.rounds.values()]
      .filter((r) => !lastRound || r.n <= lastRound)
      .sort((a, b) => a.n - b.n)
      .map((r) => {
        const entries = Object.entries(r.sides).sort((a, b) => b[1] - a[1]);
        const side = entries.length ? entries[0][0] : null;
        const early = r.died && r.deathClock !== null && r.deathPhase !== 'postplant'
          && !r.planted && r.deathClock >= EARLY_DEATH_LEFT;
        return {
          n: r.n, side, result: r.result, died: r.died, deathSpot: r.deathSpot,
          deathClock: r.deathClock, early, ultAtDeath: r.died ? r.ultAtDeath : null,
          ultSeen: r.ultSeen, planted: r.planted, plantSpot: r.plantSpot,
          locs: r.locs.slice(), reads: r.reads.slice(), frames: r.frames,
        };
      });
  }

  size() { return this.rounds.size; }
}

module.exports = { RoundLedger, clockSeconds, EARLY_DEATH_LEFT, ROUND_SECONDS };
