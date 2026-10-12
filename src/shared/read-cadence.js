'use strict';

/**
 * HOW OFTEN THE GAME IS READ, PHASE BY PHASE (8.3.2).
 *
 * The live read is 97 to 99% of what the AI costs, and it went out every gap
 * from Start to Stop, menus included. On the player's Sunset swiftplay, read
 * once a second by 8.3.0 (759 reads in 12.8 minutes, the menus between Start
 * and Stop counted), the buy phase was 29% of the reads, the player dead or
 * spectating 23%, menus, agent select and loading 12%, a menu inside the match
 * (the shop, the big map) 8%, the end screen 3%: the live round the review is
 * built from was a quarter of them.
 *
 * So the engine's own gap (coaching-engine.js tick(): auto's tier, or the
 * speed pinned in Settings) is a FLOOR, and this says how far above it a phase
 * may read. Every answer is decided on state already applied, never on a read
 * still in flight, and is the floor whenever that state is in doubt:
 *
 *   stale        nothing applied for the phase's gap and 4 s more (a pause,
 *                an outage, a 12 s hung read, a 429): the floor
 *   menus        out of a match, every 5 s after two LOBBY replies in a row,
 *                every 10 s once the run reaches 3 minutes. Only the next
 *                match's first game read needs them, and a slower menu read
 *                only delays it, inside round 1's 45 s buy phase
 *   the shop     two LOBBY replies in the ledger's own buy phase, its timer
 *                more than 5 s from running out: every 3 s; the floor from 5 s
 *                before the barriers drop to 15 s after
 *   in a match   any other LOBBY (the big map, Escape, an alt tab): ten
 *                replies at the floor, then every 3 s, every 5 s once the run
 *                reaches 45 s (the end screen, which the menu path ends by
 *                time, not by reads)
 *   buy phase    asleep on a timer two reads agree on: a read every 5 s, the
 *                shop's included, until 4 s before the barriers drop, and only
 *                while the engine's own combat report window (buyUntil) still
 *                reaches that point
 *   dead        the floor for 5 s after the death and while it is on trial,
 *                then every 3 s until a buy read or an alive read; the floor
 *                at match point, while a score step or a final waits for its
 *                second read, and on a tell that is not the death or
 *                spectator screen
 *   mode         rounds 4 and 5 read whole while the mode is unknown, and the
 *                buy phases of rounds 4 to 9 never asleep or slowed
 *   play         the live round, the post plant, the banner alive: the floor
 *
 * Replayed through the real engine at a read a second, each session with the
 * menus it had between Start and Stop and the read latency drawn, this sends
 * 37.1% fewer reads on the Sunset match (760 to 478), 37.2% on the Abyss
 * swiftplay and 35.2% on the Split: an hour from $2.36 to $1.52 at DeepSeek's
 * own price, $0.92 to $0.60 at OpenRouter's spread. Every death registers on
 * the same frame, every round keeps its result and its reads, the mode locks
 * on the same read and the looks pick the same frames (npm run
 * test:readpolicy, which holds each difference to the ones measured and
 * accepted).
 *
 * WHY EACH LIMIT IS WHERE IT IS, the cost audit's simpler rule measured against
 * it (menus every 5 s after two LOBBY replies, the buy phase every 3 s until
 * one read's timer reads 0:05, dead every 3 s from 5 s after the death):
 *
 *   - It skipped every clocked buy read after a LOBBY, so the engine's
 *     combat report guard (buyUntil) was never set: the Abyss swiftplay's
 *     round 2 combat report, read in its buy phase, registered a death in
 *     every draw. A buy phase sleeps here only on a timer TWO reads agree on,
 *     both set by the ledger from the clock printed on their own frame, at
 *     least 1.8 s apart and showing different seconds (a still number misread
 *     twice is one read, the ledger's own rule), and the shop slows only on
 *     the ledger's buy phase, never on one LOBBY.
 *   - Sunset round 5's "buy 0:39", read off the ammo counter in the post
 *     plant, is a misread to the ledger (buyVerdict): it sets no buy end, and
 *     nothing sleeps on it. A sleep wakes at once on a post plant, a planted
 *     spike, the player held dead, an active read whose clock is not that buy
 *     timer's (none, over 0:45, or more than 3 s off), or a buy timer more
 *     than 3 s off.
 *   - A buy read with no clock of its own cut the combat report guard's
 *     window to 2 s (coaching-engine.js buyUntil; since 8.3.2 only a window
 *     the ledger's own buy phase does not end with, buyWindow). Read every
 *     second, the clocked read after it puts the window back; asleep, the
 *     read 5 s later can be the combat report, and it registered as the
 *     round's death in its buy phase, which emptied that round's notes. So
 *     the sleep holds only while that window reaches its own end (`covered`,
 *     in want below).
 *   - It lost Sunset round 7's plant site and locked the Split's mode 12 s
 *     late. Round 5's buy phase tells the mode in printed numbers (its
 *     credits, a pistol round's timer, two reads of either), round 4's score
 *     step takes two agreeing reads to put the ledger there, and the side
 *     swap fallback counts four buy reads in a row in rounds 5 to 8: without
 *     the mode window the Split locks standard 10 s later.
 *   - Dying, the frame just after the death is the one Riot's look wants,
 *     and a weak tell's death is judged by the very next read. At match point
 *     the round's end is the match's (the 20 s of reads at a final score, the
 *     end screen read twice for a swiftplay one), and without it Sunset round
 *     7's plant site was lost again.
 *
 * Pure module, no Electron and no clock of its own, so a test drives it read
 * by read.
 */

const { clockSeconds, isBuyPhase, BUY_MAX_LEFT } = require('./valorant-rounds');
const { isFinalScore } = require('./match-end');
const spectate = require('./spectate-tells');

// What only the death screen prints (coaching-engine.js DEATH_SCREEN).
const DEATH_SCREEN = /killed by|combat report|switch player|kill ?cam|death ?recap/i;

const RULES = Object.freeze({
  // A slow phase holds only while the state it was decided on is this fresh,
  // past its own gap.
  staleMs: 4000,
  menus: Object.freeze({ after: 2, gapMs: 5000 }),
  idle: Object.freeze({ afterMs: 3 * 60 * 1000, gapMs: 10000 }),
  shop: Object.freeze({ after: 2, gapMs: 3000, wakeMs: 5000, fullMs: 15000 }),
  lobby: Object.freeze({ full: 10, gapMs: 3000, lateMs: 45000, lateGapMs: 5000 }),
  buy: Object.freeze({ gapMs: 5000, wakeMs: 4000, agreeMs: 2000, spanMs: 1800, offMs: 3000, keepMs: 45000 }),
  dead: Object.freeze({ fullMs: 5000, gapMs: 3000 }),
  // Score sums: round 4 is a sum of 3. The window reads rounds 4 and 5 whole,
  // the buy rule keeps the buy phases of rounds 4 to 9 awake.
  mode: Object.freeze({ window: Object.freeze([3, 4]), buy: Object.freeze([3, 8]) }),
});

const full = (why) => ({ ms: 0, why });

/**
 * One round from a score that can end the match, in any mode the lock still
 * allows: a team on 12 in a standard or unknown match, on 4 in a swiftplay or
 * unknown one, or one round from any final score.
 */
function matchPoint(team, enemy, mode) {
  const t = team | 0;
  const e = enemy | 0;
  const hi = Math.max(t, e);
  if (mode !== 'standard' && hi >= 4) return true;
  if (mode !== 'swiftplay' && hi >= 12) return true;
  const m = mode || 'standard';
  return isFinalScore(t + 1, e, m) || isFinalScore(t, e + 1, m);
}

class ReadCadence {
  constructor() { this.reset(); }

  reset() {
    this.appliedAt = null;   // when the last applied read was captured
    this.lobbyN = 0;         // LOBBY replies in a row
    this.lobbySince = null;  // when the first of them was captured
    this.tell = '';          // the last game read's aliveTell
    this.printed = null;     // the score sum the last read printed, before the guards
    this.buyEnds = [];       // { at, end, text } each frame that set the ledger's buy end from its own clock
    this.buyEnd = null;      // the end two of them agreed on: the buy phase asleep until it
  }

  /**
   * After the engine applied one read.
   *
   * @param s     the engine's state after it (coaching-engine.js cadenceState)
   * @param read  { at, lobby } and, for a game read, its own phase, clock,
   *              aliveTell and spike as the guards left them, and the score
   *              it printed before them (team, enemy)
   */
  applied(s, read) {
    const st = s || {};
    const r = read || {};
    const at = Number.isFinite(r.at) ? r.at : null;
    this.appliedAt = at;
    if (r.lobby) {
      if (!this.lobbyN) this.lobbySince = at;
      this.lobbyN++;
      return;
    }
    this.lobbyN = 0;
    this.lobbySince = null;
    this.tell = r.aliveTell ? String(r.aliveTell) : '';
    // The score the read printed, which a step's first read carries before the
    // guards have taken it: round 4's buy phase began on the Sunset match with
    // the context still a round behind.
    if (typeof r.team === 'number' && typeof r.enemy === 'number') this.printed = r.team + r.enemy;

    // THE BUY PHASE, CONFIRMED. Only a frame whose own clock set the ledger's
    // buy end counts, and two of them agreeing put it to sleep.
    const B = RULES.buy;
    const own = clockSeconds(r.clock);
    const end = Number.isFinite(st.buyEndsAt) ? st.buyEndsAt : null;
    if (end !== null && own !== null && at !== null && Math.abs(end - (at + own * 1000)) < 1) {
      const text = String(r.clock).trim();
      this.buyEnds.push({ at, end, text });
      this.buyEnds = this.buyEnds.filter((x) => at - x.at <= B.keepMs).slice(-6);
      const prev = this.buyEnds.slice(0, -1).reverse()
        .find((x) => Math.abs(x.end - end) <= B.agreeMs && x.text !== text && at - x.at >= B.spanMs);
      if (prev) this.buyEnd = Math.max(prev.end, end);
    }
    // AND WOKEN by anything that is not that buy phase counting down.
    if (this.buyEnd !== null) {
      const timer = own !== null && own <= BUY_MAX_LEFT && at !== null && Math.abs(at + own * 1000 - this.buyEnd) <= B.offMs;
      const wake = st.phase === 'postplant' || r.phase === 'postplant' || r.spike === 'planted'
        || st.phase === 'dead' || st.alive === false
        || (r.phase === 'active' && !timer)
        || (r.phase === 'buy' && own !== null && !timer);
      if (wake) {
        this.buyEnd = null;
        this.buyEnds = [];
      }
    }
  }

  /**
   * The least gap before the next read, at `now`: { ms, why }, never under
   * `base`, the engine's own gap.
   */
  gap(s, now, base) {
    const floor = Number.isFinite(base) && base > 0 ? base : 1000;
    const want = this.want(s || {}, now);
    if (want.ms <= floor) return { ms: floor, why: want.why };
    if (this.appliedAt !== null && now - this.appliedAt > want.ms + RULES.staleMs) return { ms: floor, why: 'stale' };
    return want;
  }

  /** What the phase asks for, before the floor and the stale rule. */
  want(s, now) {
    // A match the watch ended may be resuming: its game reads are the floor.
    if (s.ended && !s.inLobby) return full('ended');
    const inMatch = !s.ended && (s.rounds > 0 || !s.inLobby);
    // The context's score or the one the last read printed: either opens a
    // window, so one misread score can open it early but never close it.
    const sums = [(s.team | 0) + (s.enemy | 0)];
    if (typeof this.printed === 'number') sums.push(this.printed);
    const within = (range) => !s.mode && sums.some((sum) => sum >= range[0] && sum <= range[1]);
    // ROUNDS 4 AND 5, while the mode is unknown: every phase.
    if (inMatch && within(RULES.mode.window)) return full('mode');
    const modeOpen = within(RULES.mode.buy);

    // ── the buy phase, asleep ──────────────────────────────────────────────
    const B = RULES.buy;
    const buying = s.inLobby || isBuyPhase(s.phase, s.clock) || s.phase === 'buy';
    // AND ONLY WHILE THE ENGINE'S OWN BUY WINDOW COVERS THE SLEEP. A dead read
    // is the combat report of the round before while a buy timer read is
    // running (coaching-engine.js buyUntil), and a buy read with no clock of
    // its own cut that window to two seconds (since 8.3.2 only one the
    // ledger's buy phase does not end with, buyWindow). Read every second, the clocked
    // read after it put the window back; asleep, the read five seconds later
    // was the combat report, and it registered as a death in the buy phase,
    // which then took the round's real death's place in the ledger. Measured
    // through the real engine on 1,500 random buy phases (a buy read without
    // its clock 6% and 15% of the time, the combat report in 80% of them):
    // reading everything registered 26 and 61 such deaths, the sleep without
    // this 16 to 30 and 42 to 55, with it 12 to 20 and 26 to 47, for 0.3 to
    // 1.8% more reads. A caller that does not say (`buyUntil` absent) is
    // taken as covered.
    const covered = !Number.isFinite(s.buyUntil) || (this.buyEnd !== null && s.buyUntil >= this.buyEnd - B.wakeMs);
    if (this.buyEnd !== null && now < this.buyEnd - B.wakeMs && buying && covered) {
      if (modeOpen) return full('mode');
      return { ms: B.gapMs, why: 'buy' };
    }

    // ── LOBBY ──────────────────────────────────────────────────────────────
    if (s.inLobby) {
      const run = this.lobbySince === null ? 0 : now - this.lobbySince;
      if (run >= RULES.idle.afterMs) return { ms: RULES.idle.gapMs, why: 'idle' };
      if (!inMatch) {
        return this.lobbyN >= RULES.menus.after ? { ms: RULES.menus.gapMs, why: 'menus' } : full('menus');
      }
      // The shop, on the ledger's own buy phase.
      const S = RULES.shop;
      const drop = s.bought && Number.isFinite(s.buyEndsAt) ? s.buyEndsAt : null;
      if (drop !== null && now < drop - S.wakeMs) {
        if (modeOpen) return full('mode');
        return this.lobbyN >= S.after ? { ms: S.gapMs, why: 'shop' } : full('shop');
      }
      // Around the barriers dropping, whatever the screen says.
      if (drop !== null && now < drop + S.fullMs) return full('barriers');
      const L = RULES.lobby;
      if (this.lobbyN >= L.full) {
        return run >= L.lateMs ? { ms: L.lateGapMs, why: 'end screen' } : { ms: L.gapMs, why: 'lobby' };
      }
      return full('lobby');
    }

    // ── dead or spectating ─────────────────────────────────────────────────
    if ((s.alive === false || s.phase === 'dead') && s.lastDeathAt > 0) {
      const D = RULES.dead;
      if (now - s.lastDeathAt < D.fullMs) return full('death');
      if (s.onTrial) return full('trial');
      if (matchPoint(s.team, s.enemy, s.mode)) return full('match point');
      if (s.unsettled) return full('unsettled');
      if (!(spectate.tellSaysSpectating(this.tell) || DEATH_SCREEN.test(this.tell))) return full('tell');
      return { ms: D.gapMs, why: 'dead' };
    }
    return full('play');
  }
}

module.exports = { ReadCadence, RULES, matchPoint, DEATH_SCREEN };
