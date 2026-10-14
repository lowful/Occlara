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

let DATA = {};
try {
  DATA = require('./valorant-data.generated.json');
} catch {
  DATA = {};
}

const MAX_READS_PER_ROUND = 3;
const MAX_LOCS_PER_ROUND = 4;
// The round timer starts at 1:40 once the barriers drop. A death with this much
// or more left on the clock, before any plant, came in the first 30 seconds.
const ROUND_SECONDS = 100;
const EARLY_DEATH_LEFT = 70;
// An active frame with less than this left is a round end banner, not play.
const MID_ROUND_LEFT = 15;
// The longest buy phase is a pistol round's 45 seconds; every other one is 30.
const BUY_MAX_LEFT = 45;
const BUY_SECONDS = 30;
// Two buy timers that put the start of their buy phase this close together are
// one buy phase read twice.
const BUY_AGREE_MS = 2000;
// A buy phase whose clock says it began this long after the last frame that
// could only be play needs no second read to be believed.
const BUY_CLEAR_MS = 3000;
// How far before the last frame of play the round 5 check (beganAfterPlay)
// still takes a buy timer's start as after it: the clock shows whole seconds,
// so a timer began up to a second after the start its clock gives, and the
// round end countdown's 0:00, which a frame can carry as play, runs out as the
// buy timer starts. On the player's Sunset swiftplay that frame, carrying the
// countdown's "postplant", came 0.1 s before the start round 5's 0:43 gave.
const PLAY_SLACK_MS = 2000;
// The ultimate read ready while alive, on reads this far apart at least,
// before a death can be said to have held it (see the ultimate, below).
const ULT_HELD_MS = 6000;

/** "1:05" -> 65, anything unreadable -> null. */
function clockSeconds(clock) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(clock || '').trim());
  if (!m) return null;
  const s = Number(m[1]) * 60 + Number(m[2]);
  return s >= 0 && s <= ROUND_SECONDS ? s : null;
}

/**
 * Barriers up with a BUY timer on the clock. A "buy" read with more than 45
 * seconds left is the round timer, so it is play misread as a buy phase: on a
 * real session the model said "buy" at 1:34 of round 5, which advanced the
 * ledger a round that had not started.
 */
function isBuyPhase(phase, clock) {
  if (phase !== 'buy') return false;
  const left = clockSeconds(clock);
  return left === null || left <= BUY_MAX_LEFT;
}

/**
 * When a buy timer reading `left` seconds at `at` began, at the earliest: a
 * 45 second buy phase (a pistol round's) runs past 0:30, a 30 second one never
 * does. buyVerdict and the engine's round 5 check take the same start.
 */
function buyStartOf(at, left) {
  return at - ((left > BUY_SECONDS ? BUY_MAX_LEFT : BUY_SECONDS) - left) * 1000;
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

/*
 * WHAT A READ OF THE PLAYER'S OWN PLAY IS NOT.
 *
 * A round card's reads, and the round lines the model writes from them, are
 * meant to say what the player was doing when the round turned. On the
 * player's own Sunset swiftplay (8.3.0, a read a second) every read on every
 * card was the BUY PHASE: the ledger kept the first three notes of a round,
 * and at a read a second the first thirty are the buy phase. So the cards said
 * "standing in A Lobby during buy phase" and "player holding Classic in spawn
 * during buy phase", and the review was written from them: "Standing idle in
 * spawn during buy phase was the repeated mistake", and "Opening menus in
 * spawn delays your movement" over the four kill round. Everyone stands in
 * spawn with a pistol in the buy phase; it is never what decided a round.
 *
 * The frame's own state decides most of it: a read is kept from a frame in
 * play, with the player alive (observe, below). This is what the state cannot
 * tell. The model wrote "during buy phase" on frames it read as active with
 * the round clock running (8 of them in that match, at 1:36 down to 1:15),
 * and the combat report, the scoreboard, a surrender vote and the spectator
 * camera on frames whose alive flag the engine still held, the death screen
 * the second after a death included ("dead, combat report open while spike is
 * planted on A").
 */
const NOT_PLAY = /\b(buy|buying|bought|barriers?|menus?|overlay|scoreboard|combat report|death recap|damage (?:taken|dealt)|(?:big|full|large) map|map (?:is )?open|surrender|vote|kill ?cam|death ?cam|killed by|dead|died|death|spectat\w*|switch player|team ace|banner|eliminated|round (?:won|lost|over)|match point|before swap|victory|defeat)\b/i;

/** The words that make a note something other than the player's own play, or null. */
function notPlay(text) {
  const m = NOT_PLAY.exec(String(text || ''));
  return m ? m[0] : null;
}

/*
 * NO READ NAMES A PERSON. The model copies the name tags it sees: "teammate
 * Siyho ahead", "player watching Slycho walk through B Site", "teammate Jax
 * runs up the steps" are three of that match's reads, and the review is saved,
 * shown, and sent to the review model. The game's own names are fine: an
 * agent, a weapon, a callout, an ability, and the words its HUD prints. So a
 * capitalised word none of those lists know is a name, and so is any word
 * straight after "teammate" or "ally" that is not one of them or plain words.
 */
const PLAIN_WORDS = `a an the and or but of by for to in on at into onto from with without within near nearby
  next behind beside inside outside under over above below across around past through toward towards ahead
  close far back front side left right center centre middle upper lower top bottom corner is are was were be
  been has have had who that which while still only just also already then now there here not no one two three
  four five six seven eight nine ten first second third last own player players player's you your we our they
  their them he she his her it its teammate teammates ally allies enemy enemies team mate mates
  holding holds held standing stands crouching crouched moving moves running runs walking walks peeking peeks
  aiming aims firing fires shooting shoots looking looks checking checks rotating rotates pushing pushes
  entering enters retaking retakes waiting waits hiding jumping using uses reloading reloads scoped scoping
  watching watches covering covers trading trades fighting fights planting plants defusing defuses lurking
  clearing clears swinging swings jiggling falling dropping following follows going goes coming comes
  grouped stacked stacking clustered spread spotted pinged calling marked visible alive alone together low
  high full empty half fast slow quick quickly slowly up down out off open closed opened
  hp health shield armor armour number numbers icon icons bar ult ultimate orbs orb ready charging charged
  signature ability abilities dash smoke smokes flash flashes wall walls utility util spike planted plant
  defuse defuser carried carrier carrying dropped knife gun weapon weapons pistol rifle sniper sidearm primary
  secondary op minimap map round rounds clock timer kill kills killed assist assists trade traded shot shots
  hit hits damage frag frags fight fights duel duels angle angles corner corners crosshair scope view camera
  screen hud prompt card name names live ace won lost kayo heaven hell default box boxes crate crates pit logs
  lane steps cover`;

const NAMED = (() => {
  const out = new Set();
  const add = (s) => {
    for (const w of String(s || '').toLowerCase().split(/[^a-z0-9'/]+/)) if (w) out.add(w.replace(/'s$/, ''));
  };
  add(PLAIN_WORDS);
  for (const [agent, a] of Object.entries(DATA.agents || {})) {
    add(agent);
    for (const ability of (a && a.abilities) || []) add(ability);
  }
  for (const w of Object.keys(DATA.weapons || {})) add(w);
  for (const m of DATA.maps || []) add(m);
  for (const w of Object.keys(DATA.mapCallouts || {})) add(w);
  for (const g of Object.values(DATA.mapGeometry || {})) for (const c of (g && g.callouts) || []) add(c && c.n);
  return out;
})();
const PERSON_BEFORE = new Set(['teammate', 'teammates', 'ally', 'allies']);

/** The word in a note that is a person's name, or null. */
function namesSomeone(text) {
  const toks = String(text || '').split(/[^A-Za-z0-9'/]+/).filter(Boolean);
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i];
    const w = t.toLowerCase().replace(/'s$/, '');
    if (NAMED.has(w) || /^\d+$/.test(w)) continue;
    if (/[A-Z]/.test(t)) return t;
    if (i > 0 && PERSON_BEFORE.has(toks[i - 1].toLowerCase())) return t;
  }
  return null;
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
        afterPlant: false,    // a plant was seen in this round before the death
        ultAtDeath: null,     // the ultimate as it stood while alive, at the death
        ultSeen: null,        // 'ready' once a ready read was confirmed this round
        ult: null,            // 'ready' | 'charging' | null, as it stands while alive
        ultRun: null,         // { n, from } ready reads in a row while alive, unconfirmed
        planted: false,
        plantSpot: null,
        locs: [],             // distinct locations, in the order first seen
        reads: [],            // the old live tips shown this round, deduplicated
        notes: [],            // what the coach saw the player do in play, the latest last
        notesAtDeath: null,   // those notes as they stood at the death
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
    const clockLeft = clockSeconds(f.clock);
    // A buy read with the round timer on it is the round being played. And the
    // other way round: once a buy timer has been read, the buy phase lasts until
    // it runs out, so an "active" read before then with a buy timer's clock is
    // the buy phase misread. At a read a second both happened every few rounds,
    // and each one advanced the ledger a round that had not started.
    const at = typeof f.at === 'number' ? f.at : null;
    // THE CLOCK THIS FRAME READ, which is not always the clock it carries: the
    // engine holds the last clock it read when a read has none, so a post plant
    // frame with no timer on it arrives with the "0:39" a misread put there
    // three frames before. A clock that has not moved in a second and a half
    // was not read now. It still dates a death (the last clock before it is
    // the best there is); it no longer starts or extends a buy phase.
    const clockText = String(f.clock || '').trim();
    if (clockText && (!this.clockSeen || this.clockSeen.text !== clockText)) this.clockSeen = { text: clockText, at };
    const clockRead = clockText && at !== null && this.clockSeen && this.clockSeen.at !== null
      && at - this.clockSeen.at >= 1500 ? null : clockLeft;
    // And a "buy" read whose clock carries on the round clock seen a moment
    // ago is that round still counting down: at 0:30, two seconds after an
    // active 0:32, it moved the ledger to round 10 in the middle of round 9.
    // The chain is anchored on what cannot be a buy timer (an active clock over
    // 45 seconds, or a post plant spike timer), so a buy phase misread as
    // active never starts one.
    const lp = this.lastPlayClock;
    const carriesOn = (left) => !!lp && at !== null && left !== null && at - lp.at < 15000
      && Math.abs(lp.left - (at - lp.at) / 1000 - left) <= 3;
    let phase = f.phase;
    if (phase === 'buy' && !isBuyPhase(f.phase, f.clock)) {
      // More than 45 seconds on a "buy" read: the round timer once the round
      // has had its buy phase, or when it carries on the round clock. At a
      // fresh boundary it is neither: a real session's first frame read "buy
      // 0:57" for a 45 second pistol buy timer, and as play it moved the
      // ledger a round early and gave round 1's death to round 2.
      phase = this.since.bought || carriesOn(clockLeft) ? 'active' : null;
    } else if (phase === 'buy' && carriesOn(clockLeft)) {
      phase = lp.phase;
    }
    // Only "active": a post plant frame is never the buy phase, and its spike
    // timer reads like a buy timer.
    if (phase === 'active' && at !== null && this.buyEndsAt && at < this.buyEndsAt - 1000
        && (clockLeft === null || clockLeft <= BUY_MAX_LEFT)) {
      phase = 'buy';
    }
    // A buy read once play has been seen is the next round's buy phase only
    // when it can be one (buyVerdict); otherwise it is play misread, and it
    // neither advances a round nor starts a buy timer.
    let advance = false;
    if (phase === 'buy' && this.since.played) {
      const verdict = this.buyVerdict(at, clockRead, clockText);
      if (verdict === 'new') advance = true;
      else if (verdict === 'misread') {
        phase = null;
        // And the number it read is no round clock, so a death on the frames
        // that still carry it keeps no timing: on a real swiftplay a "buy 0:29"
        // read during a post plant was carried for nine seconds onto the frame
        // that registered the death, which then read 71 seconds into a round
        // Riot has the death 51 seconds into.
        if (clockRead !== null && this.clockSeen) this.clockSeen.misread = true;
      }
    }
    if (phase === 'buy' && at !== null && clockRead !== null && clockRead <= BUY_MAX_LEFT) {
      this.buyEndsAt = at + clockRead * 1000;
    }
    // The chain is anchored on a clock read on the frame: a post plant frame
    // carrying the "0:39" a misread left anchored it there, and the real buy
    // timer seven seconds later then "carried on" that clock and was taken for
    // the round still being played.
    const anchored = at !== null && clockRead !== null
      && ((phase === 'active' && (clockRead > BUY_MAX_LEFT || carriesOn(clockRead))) || phase === 'postplant');
    if (anchored) this.lastPlayClock = { at, left: clockRead, phase };
    // The last frame that can only be play: the round timer read on it, or
    // the spike down, with or without a clock (Valorant prints no spike timer,
    // so most post plant frames carry none). A buy phase begins after it.
    if (at !== null && (anchored || phase === 'postplant')) this.lastPlayAt = at;
    if (advance && this.offset < 1) {
      this.offset++;
      this.since = { bought: false, played: false, frames: 0 };
      this.buyCandidate = null;
    }
    const n = this.base + this.offset;
    const r = this.entry(n);
    r.frames++;
    r.firstAt = r.firstAt || f.at || null;
    r.lastAt = f.at || r.lastAt;
    const midRound = PLAY_PHASES.has(phase)
      && (this.since.bought || (clockLeft !== null && clockLeft >= MID_ROUND_LEFT));
    const fresh = !this.since.bought && !this.since.played;
    this.since.frames++;
    if (phase === 'buy') { r.bought = true; this.since.bought = true; }
    if (midRound) { r.played = true; this.since.played = true; }

    if (f.side === 'attacking' || f.side === 'defending') {
      r.sides[f.side] = (r.sides[f.side] || 0) + 1;
    }
    const loc = cleanSpot(f.loc);
    if (loc && !r.locs.some((l) => l.toLowerCase() === loc.toLowerCase())
        && r.locs.length < MAX_LOCS_PER_ROUND) {
      r.locs.push(loc);
    }
    // A PLANT BELONGS TO THE ROUND IT WAS SEEN IN, which is not always the
    // round the frame is filed under. The round end banner prints the new
    // score while the spike is still down, and the engine's context keeps
    // "planted" until the next buy phase clears it, so every banner frame after
    // a plant used to plant the NEXT round too. Replayed: round 6 planted at B
    // Site and won gave round 7 a B Site plant it never had, which took the
    // early flag and the timing bucket off its death and counted it as a post
    // plant round. And on the real Abyss session the round 17 banner, already
    // reading 10 to 7, was round 18's only plant.
    //
    // So a plant read before the new round has had a buy phase or any play is
    // the round that just ended, the rule a death on the banner follows. No
    // spike is down in a buy phase, so a buy frame plants nothing.
    if (f.spike === 'planted' && phase !== 'buy') {
      const prev = this.rounds.get(n - 1);
      const home = this.since.bought || this.since.played || !prev ? r : prev;
      home.planted = true;
      home.plantSpot = home.plantSpot || cleanSpot(f.spikeSpot);
    }
    // THE ULTIMATE, as it stood while the player was alive. The icon belongs
    // to the spectated teammate once the player is dead, so only a read taken
    // alive counts, and a READY needs two of them. The engine keeps the last
    // ult it read when a read leaves the field empty, so one misread carries:
    // on the player's Sunset match one frame read "ready" with 3 of 8 pips lit,
    // the frame after it was empty, and the false death two frames later was
    // filed as "died holding your ultimate" in the review, its patterns, the
    // missed list and the grade's Decisions. With the frame's own read (ultRead,
    // when the engine sends it) two ready reads in a row while alive confirm
    // it. With only the held value, ready over ULT_HELD_MS does: in round 5 of
    // that match, its ultimate at 3 of 8 pips, two misread "ready" reads were
    // held alive for 5.1 and 3 seconds, the first until a "charging" read, the
    // second until the round ended.
    const alive = f.alive !== false && phase !== 'dead';
    const exact = Object.prototype.hasOwnProperty.call(f, 'ultRead');
    const own = exact ? f.ultRead : f.ult;
    if (alive && own === 'charging') {
      r.ult = 'charging';
      r.ultRun = null;
    } else if (alive && own === 'ready') {
      const run = r.ultRun || (r.ultRun = { n: 0, from: at });
      run.n++;
      const span = at !== null && run.from !== null ? at - run.from : null;
      if (run.n >= 2 && (exact || span === null || span >= ULT_HELD_MS)) {
        r.ult = 'ready';
        r.ultSeen = 'ready';
      }
    }

    if (f.died) {
      const prev = this.rounds.get(n - 1);
      const endOfLast = fresh && phase !== 'buy' && !midRound && prev && !prev.died
        && (scoreMoved || this.since.frames <= 2);
      const target = endOfLast ? prev : r;
      // One death per round. The engine already debounces a flapping read, and
      // a second registration in the same round is a misread, not a second life.
      //
      // NOT THE LATER ONE EITHER, though the player was read alive between
      // them. Taking the later one was tried, for the player's Sunset match,
      // where a "Spectating 1" counter registered a death at 100 health and the
      // round's real death was refused for it, and measured: there the round
      // boundary was the fault (buyVerdict), and on the real Abyss session
      // round 23 the reads between were the spectator camera, alive at 1:09 and
      // 1:00 after a death Riot has 12 seconds in, so the later registration
      // moved the death 36 seconds late and to the teammate's spot.
      if (!target.died) {
        target.died = true;
        target.deathSpot = deathSpotOf(f.deathSpot) || deathSpotOf(loc);
        // TIMING ONLY WHEN THE ROUND WAS SEEN IN PLAY. The clock on a round end
        // banner is the banner's, and a buy timer is not a round timer, so a
        // death moved back a round, or one with no mid round frame before it,
        // keeps no timing at all. The review turns what survives into a coarse
        // bucket, because a frame every ten seconds cannot place a death to
        // the second and a review that pretends to is lying about precision.
        const misread = !!(this.clockSeen && this.clockSeen.misread && this.clockSeen.text === clockText);
        const timed = !endOfLast && this.since.played && !misread
          && clockLeft !== null && clockLeft >= 5 && clockLeft < ROUND_SECONDS;
        target.deathClock = timed ? clockLeft : null;
        target.deathPhase = endOfLast ? null : (phase || null);
        target.ultAtDeath = target.ult;
        target.afterPlant = target.planted;
        target.notesAtDeath = target.notes.slice();
        this.lastDeathRound = target.n;
      }
    }

    // What counts as play for what the coach saw: a frame mid round, the
    // player alive, and not the round end banner, an active frame with under
    // fifteen seconds on the clock.
    const play = midRound && alive && !(phase === 'active' && clockLeft !== null && clockLeft < MID_ROUND_LEFT);

    // WHAT THE COACH SAW this frame, a fact about the player ("holding A Main
    // alone"). Live tips used to fill these lines; the reader writes no tips.
    //
    // ONLY PLAY, AND THE LAST OF IT. A note is kept from a frame in play with
    // the player alive (above), and never one that is about the buy phase, a
    // menu, the scoreboard, the combat report, the spectator camera or a
    // banner (notPlay), or that names a person (namesSomeone). And the round
    // keeps the LAST three, frozen at the death, because what the player was
    // doing when the round turned is what explains it: the first three of a
    // round read a second are its buy phase. Replayed, that Sunset match's
    // round 6 reads "holding Mid Courtyard, enemy spotted mid", "holding Mid
    // Courtyard alone with knife out" and "player holding Mid Courtyard with
    // low HP", the last a tenth of a second before the death, where its card
    // had three reads of round 5's post plant.
    if (f.note && play) {
      const text = String(f.note).trim();
      if (text && !notPlay(text) && !namesSomeone(text)) {
        r.notes = r.notes.filter((x) => !sameRead(x.text, text));
        r.notes.push({ text, death: false, seen: true });
        if (r.notes.length > MAX_READS_PER_ROUND) r.notes.shift();
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
   * A "buy" read once play has been seen since the last boundary: the next
   * round's buy phase ('new'), the buy phase already counting down read again
   * ('running'), or play misread as a buy phase ('misread').
   *
   * MEASURED ON THE PLAYER'S SUNSET SWIFTPLAY, where the ledger ran a round
   * ahead twice and filed round 4 and half of round 5 under the wrong numbers:
   *
   *   running  in round 4's buy phase a play read inside the buy timer set
   *            "played", and the next buy read, "0:07", advanced the round,
   *            though its clock carried on the "0:17" read ten seconds before
   *            it: both ran out at the same second.
   *   misread  in round 5's post plant a frame read "buy 0:39" off the ammo
   *            counter, "13 | 39", a second after a post plant read, and
   *            advanced the round. Its spike, its death and its reads went to
   *            round 6, and round 6's real death was refused for it.
   *
   * So a buy phase never begins inside a buy timer already accepted, and a new
   * one needs a clock that puts its start AFTER the last frame that could only
   * be play (lastPlayAt): a buy timer of 0:39 read at t began at t - 6 s (45 s
   * buy phases run past 0:30, 30 s ones never do). A start more than
   * BUY_CLEAR_MS after that frame is believed at once; one closer than that
   * needs a second read that agrees on it within BUY_AGREE_MS, the two
   * agreeing reads every other jump here needs, because a misread buy timer
   * lands on any number and the post plant's last read can be a second
   * before it. In that post plant four misread timers in a row put their
   * starts 3 to 14 seconds BEFORE the last post plant read, and the fifth
   * 0.08 seconds after it, alone. A buy read with no clock never begins one:
   * in that match ten of the twelve were frames in play, the last of them 18
   * seconds after the last post plant read, and the read after each of the
   * two real ones had its timer.
   *
   * THE SECOND READ IS ANOTHER SECOND OF THE TIMER, never the first read again
   * (`text`, the clock as the frame carries it). A buy timer runs, so a read
   * that confirms one shows a later second. The same clock is one read: the
   * engine's held copy of it on a frame whose read left the timer empty (in
   * that post plant the frame after the first "buy 0:39" read buy with no
   * timer, and arrived carrying 0:39), or one still number misread twice, an
   * ammo counter that has not moved. Taken for two, a misread followed by its
   * copy a second later began round 6 in round 5's post plant again.
   */
  buyVerdict(at, left, text) {
    if (at === null) return 'new';
    if (this.buyEndsAt && at < this.buyEndsAt + 1000) return 'running';
    if (left === null) return 'misread';
    const start = buyStartOf(at, left);
    const last = typeof this.lastPlayAt === 'number' ? this.lastPlayAt : -Infinity;
    if (start <= last) {
      this.buyCandidate = null;
      return 'misread';
    }
    if (start - last >= BUY_CLEAR_MS) return 'new';
    const c = this.buyCandidate;
    if (c && c.text === text) return 'misread';
    if (c && Math.abs(c.start - start) <= BUY_AGREE_MS) return 'new';
    this.buyCandidate = { start, text };
    return 'misread';
  }

  /**
   * Whether a buy timer reading `left` seconds at `at` began after the last
   * frame that could only be play: buyVerdict's start, and nothing it keeps.
   * A read with no clock of its own says nothing (false). The engine counts
   * round 5's money and its pistol timer only from such a read
   * (coaching-engine.js, THE BUY PHASE OF ROUND 5).
   *
   * TO WITHIN PLAY_SLACK_MS, where buyVerdict has none. Its exact test was a
   * coin toss at the start of a buy phase: the round end countdown's frames
   * carry the "postplant" of a read on it, so its 0:00 is the last frame of
   * play, the second before the timer starts, and a real buy timer's start, to
   * the second its clock shows, falls on either side of that frame by tenths.
   * On the player's Sunset swiftplay round 5's 0:43 was taken by 0.1 s; read
   * 0.1 s earlier it counted for nothing, the 0:33 was the one pistol timer
   * left, and the side swap, the model's inference, locked swiftplay 20 s
   * later. In a standard match the same refusal leaves the economy nothing to
   * hold the swap fallback back with (test:sessionreplay). The countdown
   * itself began, by its clock, half a minute before the buy phase, and stays
   * refused.
   */
  beganAfterPlay(at, left) {
    if (typeof at !== 'number' || typeof left !== 'number') return false;
    const last = typeof this.lastPlayAt === 'number' ? this.lastPlayAt : -Infinity;
    return buyStartOf(at, left) > last - PLAY_SLACK_MS;
  }

  /**
   * The engine took back a score step that was a misread (coaching-engine.js,
   * lastStep): the round the step "ended" is still being played. Undo what the
   * step did here, or its frames stay filed one round late and that round's
   * death pushes out the next round's real one: the result it gave that round
   * goes, and every round the step opened is folded back into it.
   *
   * @param from  { team, enemy } the score before the step
   */
  rollback(from) {
    if (!from || typeof from.team !== 'number' || typeof from.enemy !== 'number') return;
    const round = from.team + from.enemy + 1;
    const into = this.entry(round);
    into.result = null;
    for (const [n, e] of [...this.rounds.entries()].sort((a, b) => a[0] - b[0])) {
      if (n <= round) continue;
      into.frames += e.frames;
      into.firstAt = into.firstAt || e.firstAt;
      into.lastAt = e.lastAt || into.lastAt;
      for (const [side, c] of Object.entries(e.sides)) into.sides[side] = (into.sides[side] || 0) + c;
      if (e.died && !into.died) {
        into.died = true;
        into.deathSpot = e.deathSpot;
        into.deathClock = e.deathClock;
        into.deathPhase = e.deathPhase;
        into.ultAtDeath = e.ultAtDeath;
        into.afterPlant = e.afterPlant || into.planted;
        // What the coach saw before that death: this round's play, then the
        // folded round's up to it, the latest three.
        into.notesAtDeath = [...into.notes, ...(e.notesAtDeath || [])].slice(-MAX_READS_PER_ROUND);
      }
      if (e.ultSeen) into.ultSeen = e.ultSeen;
      if (e.ult) { into.ult = e.ult; into.ultRun = e.ultRun; }
      if (e.planted && !into.planted) { into.planted = true; into.plantSpot = e.plantSpot; }
      for (const l of e.locs) {
        if (into.locs.length < MAX_LOCS_PER_ROUND && !into.locs.some((x) => x.toLowerCase() === l.toLowerCase())) into.locs.push(l);
      }
      for (const r of e.reads) {
        if (into.reads.length < MAX_READS_PER_ROUND && !into.reads.some((x) => sameRead(x.text, r.text))) into.reads.push(r);
      }
      for (const x of e.notes) {
        into.notes = into.notes.filter((y) => !sameRead(y.text, x.text));
        into.notes.push(x);
      }
      into.notes = into.notes.slice(-MAX_READS_PER_ROUND);
      into.bought = into.bought || e.bought;
      into.played = into.played || e.played;
      this.rounds.delete(n);
    }
    this.last = { team: from.team, enemy: from.enemy };
    this.base = round;
    this.offset = 0;
    // Still inside that round: the next buy phase is the next round.
    this.since = { bought: into.bought, played: into.played, frames: into.frames };
    if (this.lastDeathRound && this.lastDeathRound > round) this.lastDeathRound = round;
  }

  /**
   * Rounds in order, each with its majority side resolved.
   *
   * @param lastRound  drop anything past it. A final score of 13 to 11 means
   *   24 rounds, and the frame that READ that score opened a round 25 that was
   *   never played. Leaving it in paints an empty round at the end of every
   *   match that ended on a score read.
   *
   * AND THE SAME ROUND GOES WHATEVER ENDED THE MATCH. Only a score end knows
   * its last round, so a match ended on the menu or by Stop kept the round the
   * final banner opened: an unrated 13 to 12, deliberately not a final score,
   * was reviewed as 26 rounds with an empty 26th cell in the strip and its
   * survival worked out over 26. A last round that was never bought, never
   * played and has no death, plant or result is not a round the player played.
   */
  list(lastRound) {
    const kept = [...this.rounds.values()]
      .filter((r) => !lastRound || r.n <= lastRound)
      .sort((a, b) => a.n - b.n);
    const unplayed = (r) => !r.bought && !r.played && !r.died && !r.planted && !r.result;
    while (kept.length && unplayed(kept[kept.length - 1])) kept.pop();
    return kept
      .map((r) => {
        const entries = Object.entries(r.sides).sort((a, b) => b[1] - a[1]);
        const side = entries.length ? entries[0][0] : null;
        const early = r.died && r.deathClock !== null && r.deathPhase !== 'postplant'
          && !r.planted && r.deathClock >= EARLY_DEATH_LEFT;
        // The old live tips first, which only a match from the tip era has,
        // then what the coach saw in play: up to the death in a round the
        // player died in, to the end of the round otherwise.
        const seen = r.died ? (r.notesAtDeath || []) : r.notes;
        return {
          n: r.n, side, result: r.result, died: r.died, deathSpot: r.deathSpot,
          deathClock: r.deathClock, early, ultAtDeath: r.died ? r.ultAtDeath : null,
          // Whether a plant was seen before the death, the screen's half of
          // Riot's afterPlant: a round the player died in before the spike went
          // down is not a post plant or a retake they played.
          afterPlant: r.died ? !!r.afterPlant : false,
          ultSeen: r.ultSeen, planted: r.planted, plantSpot: r.plantSpot,
          locs: r.locs.slice(), reads: [...r.reads, ...seen].slice(0, MAX_READS_PER_ROUND), frames: r.frames,
        };
      });
  }

  size() { return this.rounds.size; }

  /** The round the last frame was filed under, or null before the first. */
  current() { return this.base ? this.base + this.offset : null; }
}

module.exports = { RoundLedger, clockSeconds, isBuyPhase, notPlay, namesSomeone, NOT_PLAY,
  EARLY_DEATH_LEFT, ROUND_SECONDS, BUY_MAX_LEFT, MID_ROUND_LEFT };
