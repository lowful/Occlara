'use strict';

/**
 * THE MATCH RATING: a number from 0.0 to 10.0 that starts at 6.0 and moves by
 * what the player does, the way a football player's match rating does.
 *
 * EVERY MOVE IS A CHANGE IN THE CHANCE TO WIN THE ROUND. Each kill, death,
 * revive, plant, defuse and round end moves the chance of a team to win the
 * round it happened in (`winChance`, by players standing on each side, the
 * spike and its clock), and each player is credited the change their action
 * caused. A first kill at five against five moves it about a quarter, the
 * last kill of a five against one about two hundredths, a kill after the
 * spike went off nothing at all. A clutch and a multi kill are no bonus
 * written here: they are worth what the kills inside them moved. The names a
 * round is given ("Triple kill, won a 1v2") are labels only.
 *
 * STREAMING, ON PARTIAL INFORMATION. `createRating()` takes one event at a
 * time and answers the subject's value after it, so the same engine runs over
 * Riot's record after a match (`fromRecord`, `ratingOfReview`) and, later,
 * over what the screen reads live: an event carrying an `id` it has seen is
 * ignored, an event of a round older than the one being played is ignored,
 * and a `round` event for the round being played only updates its side. A
 * missing field degrades to a neutral value, never to a guess at a person
 * (docs/claude/rating.md says what each missing field costs).
 *
 * NEVER A NAME. A player is a key: 'me', or a side and an agent ('us:Jett',
 * 'them:Sova'), or a side alone ('us', 'them') when the agent is unknown, who
 * is counted in the numbers standing and credited nothing.
 *
 * Pure, deterministic, no I/O, no Electron.
 */

// Bump when any number below changes, so a saved rating says which maths made
// it and is never shown as if today's maths had (rating.md, "Versions").
const VERSION = 1;

/*
 * THE CHANCE TO WIN A ROUND, for the attackers, from `a` attackers and `d`
 * defenders standing and whether the spike is down. A logistic fitted by
 * maximum likelihood (scripts/rating-fit.js) on 116 rounds of Riot's record,
 * 907 states with both sides standing, both teams of every round:
 *
 *   logit P = B0 + B_MAN * (a - d) + B_SPIKE * planted
 *
 * Held out by match it scored best of the four candidates (log loss 0.506;
 * the ratio of players standing 0.508, players down 0.510, an extra term for
 * the opening state 0.507). B0 is the defenders' edge at equal numbers, which
 * the clock gives them: 39 percent for the attackers at equal numbers, where
 * the 116 opening states were won 43 percent of the time, within one standard
 * error (4.6 points), and a term of its own for the opening did worse held out.
 *
 * ATTACKERS WIPED AFTER THE PLANT still win if the defenders cannot reach the
 * spike and defuse it (7 s) in the time it has left: sigmoid((WIPED_T0 -
 * left) / WIPED_S) by the seconds left. The record has 20 such states, the
 * attackers winning 2, at 15.3 and 19.2 s left and losing every one with 20
 * s or more; the curve is centred on 12 s (the defuse and 5 s to reach it).
 * With no time to go by, the record's own share, WIPED_FLAT.
 */
const WP = Object.freeze({ B0: -0.45, B_MAN: 1.05, B_SPIKE: 1.02, WIPED_T0: 12, WIPED_S: 3, WIPED_FLAT: 0.1 });

/*
 * THE WEIGHTS, set on the calibration (rating.md, "Calibration"):
 *
 * LOSS_WEIGHT   every move against a player counts this share of itself. A
 *               duel lost is partly the killer's doing, and a football rating
 *               averages above its start for the same reason.
 * TRADE_BACK    a death a teammate traded gives this share back of what it
 *               cost above DEATH_FLOOR. The trader keeps the whole swing of
 *               the trade kill; the give back is added on its own.
 * DEATH_FLOOR   a death before the round is over costs at least this much of
 *               a round: the life is the gun, the shields and the
 *               information the next rounds pay for (rating.md, "The bottom
 *               of the scale").
 * TRADE_MS      the trade window, riot-rounds.js TRADE_MS.
 * REVIVE_MS     a gun kill by a player down this long or more is a revive
 *               (riot-rounds.js teamworkOf's rule); a molly or a grenade by a
 *               player already dead is not.
 * ASSIST_SHARE  each assister named on a kill takes this share of its swing
 *               from the killer, half at most in all.
 * PLANTER_SHARE a named planter or defuser takes this share of the swing and
 *               the rest is shared by the side's players alive at it.
 * RESULT        each player of the side that won a round gains this, each of
 *               the side that lost it loses it. Small on purpose.
 * DECIDED       a swing under this is "after the round was decided".
 * NEUTRAL_SWING a kill whose numbers standing cannot be known is worth the
 *               mean swing of a kill or death in calibration.
 */
const W = Object.freeze({
  LOSS_WEIGHT: 0.8, TRADE_BACK: 0.7, TRADE_MS: 5000, REVIVE_MS: 2000,
  ASSIST_SHARE: 0.15, ASSIST_MAX: 0.5, PLANTER_SHARE: 0.5, RESULT: 0.02, DECIDED: 0.01,
  NEUTRAL_SWING: 0.17, SPIKE_MS: 45000, DEATH_FLOOR: 0.12,
});

/*
 * THE DISPLAY. 6.0 plus a squash of the net swing scaled to a standard
 * length: up to 4 points above (10.0 only in the limit) and 3 below (a floor
 * of 3.0), each a tanh, so returns diminish near the ends.
 *
 * MATCH LENGTH. x = net * (REF + K) / (E + K) * min(1, E / rounds): E is the
 * queue's usual longest match (24 rounds; 9 for Swiftplay and Replication; 7
 * for Spike Rush), K twelve rounds of neutral play. Up to E rounds every
 * event weighs the same from the first round on, so a live value never leaps
 * because the match is young; past E the net is taken per round, so thirty
 * rounds of the same play rate exactly what twenty four did. A Swiftplay
 * counts its moves 36 / 21 = 1.71 times, which leaves its spread a little
 * under a full match's (rating.md, "Match length").
 */
const D = Object.freeze({ START: 6.0, UP: 4.0, DOWN: 3.0, A: 3.2, B: 2.6, REF: 24, K: 12 });
const LENGTHS = Object.freeze({ standard: 24, swiftplay: 9, spikerush: 7 });

/*
 * A GUN, for the revive rule: the game data's weapons and the knife. An
 * ability's kill (a molly, a grenade, an ultimate) by a player already dead
 * is no revive.
 */
let GUNS = new Set(['knife', 'melee']);
try {
  const data = require('./valorant-data.generated.json');
  GUNS = new Set([...GUNS, ...Object.keys(data.weapons || {}).map((w) => w.toLowerCase())]);
} catch { /* the knife alone */ }
const isGun = (w) => typeof w === 'string' && GUNS.has(w.trim().toLowerCase());

const sigmoid = (z) => 1 / (1 + Math.exp(-z));
const round1 = (v) => Math.round(v * 10) / 10;
const round3 = (v) => Math.round(v * 1000) / 1000;
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/**
 * The attackers' chance to win from a against d, the spike down or not, and
 * when it is down and the attackers are wiped, the seconds it has left.
 */
function winChance(a, d, planted, left) {
  if (d <= 0 && a <= 0) return planted ? 1 : 0.5;
  if (d <= 0) return 1;
  if (a <= 0) {
    if (!planted) return 0;
    return num(left) !== null ? (left <= 0 ? 1 : sigmoid((WP.WIPED_T0 - left) / WP.WIPED_S)) : WP.WIPED_FLAT;
  }
  return sigmoid(WP.B0 + WP.B_MAN * (a - d) + (planted ? WP.B_SPIKE : 0));
}

/** The usual longest match of a queue, in rounds. */
function lengthOf(queue) {
  const q = String(queue || '').toLowerCase();
  if (/swift|replication|onefa/.test(q)) return LENGTHS.swiftplay;
  if (/spike ?rush/.test(q)) return LENGTHS.spikerush;
  return LENGTHS.standard;
}

/** The shown value of a net swing over a number of rounds, one decimal. */
function display(net, rounds, longest) {
  const E = Math.max(1, longest || LENGTHS.standard);
  const n = Math.max(rounds || 0, 1);
  const x = net * ((D.REF + D.K) / (E + D.K)) * Math.min(1, E / n);
  const v = x >= 0 ? D.START + D.UP * Math.tanh(x / D.A) : D.START + D.DOWN * Math.tanh(x / D.B);
  return Math.min(10, Math.max(0, round1(v)));
}

/** A key's side, 'us' or 'them', or null. */
function sideOfKey(key) {
  if (key === 'me') return 'us';
  const m = typeof key === 'string' ? /^(us|them)(?::.+)?$/.exec(key) : null;
  return m ? m[1] : null;
}
/** A key's agent, or null for a side alone. */
function agentOfKey(key, meAgent) {
  if (key === 'me') return meAgent || null;
  const m = typeof key === 'string' ? /^(?:us|them):(.+)$/.exec(key) : null;
  return m ? m[1] : null;
}
/** A key that names one player: only those are credited. */
const named = (key) => key === 'me' || (typeof key === 'string' && /^(us|them):.+$/.test(key));
const other = (side) => (side === 'us' ? 'them' : side === 'them' ? 'us' : null);
const vs = (own, opp) => `${own}v${opp}`;
const MULTI = ['', '', 'Double kill', 'Triple kill', 'Quadra kill', 'Ace'];

/**
 * A NEW RATING. opts:
 *   subject   the key followed: 'me' by default, or any named key
 *   players   every key known to be in the match (the lobby), so a player is
 *             counted alive and gets the result term before their first kill
 *   queue     for the length rule; longest overrides it in rounds
 *   meAgent   the subject's agent, for the lobby list and the revive rule
 *
 * push(event) takes one event and answers the subject's move:
 *   { round, ms, kind, delta, value, swing, label }
 * delta is the change in the shown value, swing the subject's credit in
 * chance to win, label a plain line ("First kill, 5v5"), null when the event
 * was nothing of the subject's. An ignored event (a repeated id, an older
 * round) answers with `ignored` set and moves nothing.
 *
 * Events (rating.md, "The event shape"), each with an optional `id`:
 *   { kind: 'round', round, side: 'attacking' | 'defending' | null, satOut }
 *       side is the side of 'us', the subject's team when the subject is 'me'
 *   { kind: 'kill', round, ms, killer, victim, assists: [key], weapon, alive: { us, them }, traded }
 *       traded: Riot's own flag for a death whose killer has no key
 *   { kind: 'plant', round, ms, by }      by a key, or a side alone
 *   { kind: 'defuse', round, ms, by }
 *   { kind: 'end', round, won }           won: the subject's side, true, false or null
 */
function createRating(opts) {
  const o = opts || {};
  const subject = typeof o.subject === 'string' && named(o.subject) ? o.subject : 'me';
  const mySide = sideOfKey(subject);
  const longest = num(o.longest) || lengthOf(o.queue);
  const players = new Map(); // key -> { net }
  const timeline = [];
  const byRound = [];
  const credits = new Map(); // this event's credits by key
  const seen = new Set();
  let rnd = null;
  let roundsStarted = 0;
  let subjectRounds = 0;

  const ensure = (key) => {
    if (!named(key)) return null;
    if (!players.has(key)) players.set(key, { net: 0 });
    return players.get(key);
  };
  ensure(subject);
  for (const k of Array.isArray(o.players) ? o.players : []) ensure(k);

  const roundsOf = (key) => (key === subject ? subjectRounds : roundsStarted);
  const valueOf = (key) => display((players.get(key) || { net: 0 }).net, roundsOf(key), longest);
  const agentOf = (key) => agentOfKey(key, o.meAgent);
  // The subject's own number first: "2v3" with the subject's side on the left.
  const mine = (st) => (mySide === 'them' ? vs(st.them, st.us) : vs(st.us, st.them));

  function startRound(n, side, satOut) {
    rnd = {
      n, side: side === 'attacking' || side === 'defending' ? side : null,
      satOut: satOut === true, alive: { us: 5, them: 5 }, down: { us: new Map(), them: new Map() }, revived: new Set(),
      planted: false, plantMs: null, lastMs: null, decided: false, decidedFor: null, kills: 0, deaths: [], ended: false,
      startNet: (players.get(subject) || { net: 0 }).net, swing: 0,
      me: { kills: 0, firstKill: false, tradeKills: 0, plant: false, defuse: false, died: null, clutch: 0, revived: false, ultOut: false, teamKill: false },
    };
  }

  // The chance of 'us' to win the round now; `ms` gives the spike's clock.
  function chanceUs(ms) {
    const { us, them } = rnd.alive;
    if (rnd.decided) return rnd.decidedFor === 'us' ? 1 : rnd.decidedFor === 'them' ? 0 : null;
    const left = rnd.planted && rnd.plantMs !== null && num(ms) !== null ? (rnd.plantMs + W.SPIKE_MS - ms) / 1000 : null;
    if (rnd.side === 'attacking') return winChance(us, them, rnd.planted, left);
    if (rnd.side === 'defending') return 1 - winChance(them, us, rnd.planted, left);
    // No side known: the spike cannot be placed, the man advantage alone.
    if (us <= 0) return 0;
    if (them <= 0) return 1;
    return sigmoid(WP.B_MAN * (us - them));
  }

  // Credit a key. A move against it counts LOSS_WEIGHT of itself unless `raw`,
  // and the subject's round sat out moves nothing.
  function credit(key, amount, raw) {
    if (!named(key) || !amount) return 0;
    if (key === subject && rnd && rnd.satOut) return 0;
    const c = amount < 0 && !raw ? amount * W.LOSS_WEIGHT : amount;
    ensure(key).net += c;
    credits.set(key, (credits.get(key) || 0) + c);
    return c;
  }

  // The subject's answer to one event, kept on the timeline when it was the
  // subject's doing or the subject's round end.
  function record(kind, ev, label, before, involved) {
    const mineNow = credits.get(subject) || 0;
    const value = valueOf(subject);
    if (rnd) rnd.swing += mineNow;
    const out = { round: rnd ? rnd.n : null, ms: num(ev && ev.ms), kind, delta: round1(value - before), value, swing: round3(mineNow), label: involved ? label : null };
    if (involved && label && !(rnd && rnd.satOut)) timeline.push(out);
    credits.clear();
    return out;
  }

  // What a trade gives back of a death: TRADE_BACK of what it cost above the
  // floor, so a traded death still costs the life.
  const giveBack = (charged) => Math.max(0, Math.abs(charged) - W.DEATH_FLOOR * W.LOSS_WEIGHT) * W.TRADE_BACK;

  function decideByNumbers() {
    const { us, them } = rnd.alive;
    const usAttack = rnd.side === 'attacking';
    const usDefend = rnd.side === 'defending';
    if (us === 0 && !(rnd.planted && usAttack)) { rnd.decided = true; rnd.decidedFor = 'them'; }
    else if (them === 0 && !(rnd.planted && usDefend)) { rnd.decided = true; rnd.decidedFor = 'us'; }
  }

  // Back up: the change in the chance at the revive, to whoever made it, a
  // Sage of that side up and not the one revived, else the revived player
  // (Clove's own ultimate). Answers the reviver's key.
  function revive(side, key, ms) {
    const p0 = chanceUs(ms);
    rnd.down[side].delete(key);
    rnd.revived.add(key);
    rnd.alive[side] = Math.min(5, rnd.alive[side] + 1);
    const p1 = chanceUs(ms);
    const by = reviverOf(side, key);
    if (p0 !== null && p1 !== null) credit(by, side === 'us' ? p1 - p0 : p0 - p1);
    if (key === subject) { rnd.me.revived = true; rnd.me.died = null; }
    return by;
  }

  // Who brought a player back: Clove is her own (Not Dead Yet); anyone else a
  // Sage of that side who is up, the player themselves when they are that
  // Sage; with no Sage up, the revived player.
  function reviverOf(side, key) {
    if (agentOf(key) === 'Clove') return key;
    for (const k of players.keys()) {
      if (k !== key && sideOfKey(k) === side && agentOf(k) === 'Sage' && !rnd.down[side].has(k)) return k;
    }
    return key;
  }

  function kill(ev, before) {
    const killer = typeof ev.killer === 'string' ? ev.killer : null;
    const victim = typeof ev.victim === 'string' ? ev.victim : null;
    const ms = num(ev.ms);
    const kSide = sideOfKey(killer);
    const vSide = sideOfKey(victim);
    const self = !!(killer && victim && killer === victim);
    // An ultimate that ran out (Clove's Not Dead Yet with no kill): the player
    // was down all along, so nothing changes.
    if (self && named(victim) && rnd.down[vSide].has(victim) && !isGun(ev.weapon)) {
      if (victim === subject) rnd.me.ultOut = true;
      return record('kill', ev, victim === subject ? 'Your ultimate ran out, no kill' : null, before, victim === subject);
    }
    let reviveLabel = null;
    // A revive puts a player back: a gun kill by a player down REVIVE_MS or
    // more, or a second death of one.
    if (kSide && named(killer) && !self && rnd.down[kSide].has(killer)) {
      const at = rnd.down[kSide].get(killer);
      if (isGun(ev.weapon) && at !== null && ms !== null && ms - at >= W.REVIVE_MS) {
        const by = revive(kSide, killer, ms);
        if (by === subject) reviveLabel = killer === subject ? { own: true } : { who: agentOf(killer) || 'a teammate' };
      }
    }
    if (vSide && named(victim) && rnd.down[vSide].has(victim)) {
      const by = revive(vSide, victim, ms);
      if (by === subject) reviveLabel = victim === subject ? { own: true } : { who: agentOf(victim) || 'a teammate' };
    }
    // The screen may know the numbers standing better than the feed does.
    if (ev.alive && num(ev.alive.us) !== null && num(ev.alive.them) !== null) {
      rnd.alive = { us: Math.max(0, Math.min(5, ev.alive.us)), them: Math.max(0, Math.min(5, ev.alive.them)) };
    }
    const standing = { ...rnd.alive };
    const first = rnd.kills === 0;
    rnd.kills++;

    // The swing for the victim's side, negative. A round already decided (the
    // spike gone off, a side wiped) is over: nothing in it costs anything.
    const over = rnd.decided;
    let swing;
    if (rnd.decided) {
      swing = 0;
      if (vSide) rnd.alive[vSide] = Math.max(0, rnd.alive[vSide] - 1);
    } else if (!vSide) swing = -W.NEUTRAL_SWING;
    else {
      const p0 = chanceUs(ms);
      rnd.alive[vSide] = Math.max(0, rnd.alive[vSide] - 1);
      const p1 = chanceUs(ms);
      const dUs = p0 === null || p1 === null ? (vSide === 'us' ? -W.NEUTRAL_SWING : W.NEUTRAL_SWING) : p1 - p0;
      swing = vSide === 'us' ? dUs : -dUs;
    }
    if (vSide && named(victim)) rnd.down[vSide].set(victim, ms);
    const decided = Math.abs(swing) < W.DECIDED;
    const ownTeam = !!(kSide && vSide && kSide === vSide);
    const sideStand = (s) => (s === 'us' ? vs(standing.us, standing.them) : vs(standing.them, standing.us));

    let label = null;
    let involved = false;
    if (self || ownTeam) {
      // A fall, the spike, a teammate's molly: the one who did it carries it.
      // An ability that killed its own owner after a revive is the ultimate
      // running out.
      credit(self ? victim : killer, swing);
      const ultOut = self && rnd.revived.has(victim) && !isGun(ev.weapon);
      if (victim === subject) {
        involved = true;
        label = ultOut ? 'Your ultimate ran out' : self ? 'Died to yourself' : 'Killed by a teammate';
        if (ultOut) rnd.me.ultOut = true;
        rnd.me.died = { first, traded: false, last: (mySide === 'us' ? standing.us : standing.them) === 1, decided, how: ultOut ? 'ult' : self ? 'self' : 'team' };
      } else if (killer === subject) { involved = true; label = 'Killed a teammate'; rnd.me.teamKill = true; }
    } else {
      if (kSide) {
        const assists = (Array.isArray(ev.assists) ? ev.assists : []).filter((a) => named(a) && sideOfKey(a) === kSide && a !== killer);
        const share = Math.min(W.ASSIST_MAX, W.ASSIST_SHARE * assists.length);
        // A trade: the killer killed whoever had just killed one of theirs,
        // both named; of two deaths to the same killer, the latest. The
        // trader keeps the whole swing of the kill: a trade is a good play.
        // The give back is added on its own, so the lobby's total grows by
        // it, which the calibration holds the mean against.
        const avenged = named(victim) ? [...rnd.deaths].reverse().find((d) => !d.traded && named(d.killer) && d.killer === victim && d.side === kSide
          && d.ms !== null && ms !== null && ms >= d.ms && ms - d.ms <= W.TRADE_MS) : null;
        let back = 0;
        if (avenged) {
          avenged.traded = true;
          if (!avenged.decided && named(avenged.victim)) back = giveBack(avenged.charged);
        }
        const gain = -swing;
        credit(killer, gain * (1 - share));
        for (const a of assists) credit(a, gain * (share / assists.length));
        if (back) credit(avenged.victim, back, true);
        const own = kSide === 'us' ? standing.us : standing.them;
        if (killer === subject) {
          involved = true;
          rnd.me.kills++;
          if (first) rnd.me.firstKill = true;
          if (avenged) rnd.me.tradeKills++;
          label = decided ? 'Kill after the round was decided'
            : first ? `First kill, ${sideStand(kSide)}`
              : avenged ? `Traded a teammate, ${sideStand(kSide)}`
                : own === 1 ? `Kill as the last one up, ${sideStand(kSide)}`
                  : `Kill, ${sideStand(kSide)}`;
        } else if (assists.includes(subject)) {
          involved = true;
          label = decided ? 'Assist after the round was decided' : `Assist, ${sideStand(kSide)}`;
        } else if (avenged && avenged.victim === subject && back) {
          involved = true;
          label = 'Your death was traded, part of it given back';
        }
      }
      // The victim.
      if (named(victim)) {
        // A DEATH COSTS AT LEAST DEATH_FLOOR (rating.md, "The bottom of the
        // scale"): a life is the gun, the shields and the information the team
        // had, which the next rounds pay for, even when this one was gone.
        const charged = credit(victim, over ? swing : Math.min(swing, -W.DEATH_FLOOR));
        const own = vSide === 'us' ? standing.us : standing.them;
        const d = { victim, killer, side: vSide, ms, charged, traded: false, first, decided, last: own === 1, at: null };
        rnd.deaths.push(d);
        // Riot's own traded flag, where the feed cannot show the trade: a
        // killer with no key, or no times to see it by.
        if (victim === subject && (!named(killer) || ms === null) && ev.traded === true && !decided) {
          d.traded = true;
          credit(victim, giveBack(charged), true);
        }
        if (victim === subject) {
          involved = true;
          rnd.me.died = d;
          label = decided ? 'Died after the round was decided'
            : first ? `Died first, ${sideStand(vSide)}`
              : own === 1 ? `Died last, ${sideStand(vSide)}`
                : `Died, ${sideStand(vSide)}`;
        }
      }
    }
    // A revive the subject made or had: its own line, or after the event's,
    // joined by a comma (no semicolon in a player's text).
    if (!label && reviveLabel) { label = reviveLabel.own ? `Back in the round, ${mine(rnd.alive)}` : `Revived ${reviveLabel.who}, ${mine(rnd.alive)}`; involved = true; }
    else if (label && reviveLabel) label = `${label}, ${reviveLabel.own ? 'back in the round' : `after reviving ${reviveLabel.who}`}`;
    const out = record('kill', ev, label, before, involved);
    const d = rnd.deaths[rnd.deaths.length - 1];
    if (victim === subject && d && d.victim === subject && !d.at) d.at = out;
    // The subject the last one up on their side, against how many.
    if (!rnd.decided && !rnd.down[mySide].has(subject) && rnd.alive[mySide] === 1 && rnd.alive[other(mySide)] > 0) {
      rnd.me.clutch = Math.max(rnd.me.clutch, rnd.alive[other(mySide)]);
    }
    decideByNumbers();
    return out;
  }

  // The named players of a side still up.
  function aliveKeys(side) {
    const out = [];
    if (!side) return out;
    for (const k of players.keys()) if (sideOfKey(k) === side && !rnd.down[side].has(k)) out.push(k);
    return out;
  }

  // Share a gain among a side's players alive, a named one first taking `lead`.
  function share(side, gain, by, lead) {
    const n = Math.max(1, rnd.alive[side]);
    const keys = aliveKeys(side).slice(0, n);
    const first = named(by) && sideOfKey(by) === side ? by : null;
    if (first) credit(first, gain * lead);
    for (const k of keys) credit(k, gain * (first ? 1 - lead : 1) / n);
  }

  // The spike: a plant or a defuse moves the chance, the named one takes a
  // share, the rest goes to the side's players alive at it, the cost to the
  // other side's alive.
  function spike(kind, ev, before) {
    const by = typeof ev.by === 'string' ? ev.by : null;
    let side = sideOfKey(by);
    // The planting side attacks: a plant by a known side says the side, and
    // is believed over a side given before (only an attacker can plant).
    if (kind === 'plant' && side) rnd.side = side === 'us' ? 'attacking' : 'defending';
    if (!side && rnd.side) side = kind === 'plant' ? (rnd.side === 'attacking' ? 'us' : 'them') : (rnd.side === 'defending' ? 'us' : 'them');
    const ms = num(ev.ms);
    const p0 = chanceUs(ms);
    const standing = { ...rnd.alive };
    if (kind === 'plant') { rnd.planted = true; rnd.plantMs = ms; }
    else if (side) { rnd.decided = true; rnd.decidedFor = side; }
    const p1 = chanceUs(ms);
    if (by === subject) rnd.me[kind] = true;
    if (p0 === null || p1 === null || !side) return record(kind, ev, null, before, false);
    const gain = side === 'us' ? p1 - p0 : p0 - p1;
    share(side, gain, by, W.PLANTER_SHARE);
    share(other(side), -gain, null, 0);
    const ours = mySide === side;
    const alive = !rnd.down[mySide].has(subject);
    const label = kind === 'plant'
      ? (!ours ? `Spike planted against you, ${mine(standing)}` : by === subject ? `Planted the spike, ${mine(standing)}` : `Spike planted, ${mine(standing)}`)
      : (!ours ? `Spike defused against you, ${mine(standing)}` : by === subject ? `Defused the spike, ${mine(standing)}` : `Spike defused, ${mine(standing)}`);
    return record(kind, ev, label, before, alive || by === subject);
  }

  /*
   * THE ROUND'S NAME, a label only (it adds no points): what the subject did
   * in it, in the words players use. "Triple kill with the opening kill",
   * "2 kills, won a 1v3", "Opening kill and the plant", "Died first, not
   * traded", "Saved the last life".
   */
  function roundName(won) {
    if (rnd.satOut) return 'Sat out, not counted';
    const m = rnd.me;
    const alive = !rnd.down[mySide].has(subject);
    const clutchWon = won === true && m.clutch > 0;
    let main = null;
    if (m.kills) {
      if (clutchWon) main = `${m.kills === 1 ? '1 kill' : `${m.kills} kills`}, won a 1v${m.clutch}`;
      else if (m.kills >= 2) main = `${MULTI[Math.min(5, m.kills)]}${m.firstKill && m.kills < 5 ? ' with the opening kill' : ''}`;
      else main = m.firstKill ? 'Opening kill' : m.tradeKills ? 'Trade kill' : 'A kill';
    } else if (clutchWon) main = `Won a 1v${m.clutch}`;
    if (m.plant) main = main ? `${main} and the plant` : 'Planted the spike';
    if (m.defuse) main = main ? `${main} and the defuse` : 'Defused the spike';
    if (m.teamKill) main = main ? `${main} and killed a teammate` : 'Killed a teammate';
    // A death after the round was decided (the spike gone off, the last enemy
    // down) names nothing.
    const d = m.died && !m.died.decided ? m.died : null;
    let death = null;
    if (d && d.how === 'team') death = 'Killed by a teammate';
    else if (d && d.how === 'self') death = 'Died to yourself';
    else if (d && d.how === 'ult') death = 'Ultimate ran out';
    else if (d && !d.decided) {
      death = d.first ? `Died first, ${d.traded ? 'traded' : 'not traded'}`
        : d.last ? 'Died as the last one up' : `Died, ${d.traded ? 'traded' : 'not traded'}`;
    }
    // After kills a death says only whether it was traded, so the line stays short.
    if (main && death) {
      const tail = d.how ? death.charAt(0).toLowerCase() + death.slice(1) : `died${d.traded ? ', traded' : ''}`;
      return `${main}, then ${tail}`;
    }
    if (main) return main;
    if (death) return death;
    if (alive && won === true) return 'Round won, alive at the end';
    if (alive && won === false) return rnd.alive[mySide] === 1 ? 'Saved the last life' : 'Alive when the round was lost';
    if (d) return won === true ? 'Round won' : 'Round lost';
    return won === true ? 'Round won' : won === false ? 'Round lost' : null;
  }

  // The round's end: what was left of the chance goes to whoever was still up
  // (a defuse nobody named, the timer, the spike going off, a save), and the
  // small result term to everyone who played it.
  function end(ev, before0) {
    // The round counts now, at its end: the value only moves with an event,
    // and a round's own move is read at one scale (rating.md, "Match length").
    roundsStarted++;
    if (!rnd.satOut) subjectRounds++;
    const before = valueOf(subject);
    const won = ev.won === true ? mySide : ev.won === false ? other(mySide) : null;
    const meWon = ev.won === true ? true : ev.won === false ? false : null;
    let label = meWon === true ? 'Round won' : meWon === false ? 'Round lost' : null;
    if (won && !rnd.decided) {
      const p0 = chanceUs(rnd.lastMs);
      if (p0 !== null) {
        const left = won === 'us' ? 1 - p0 : p0;
        share(won, left, null, 0);
        share(other(won), -left, null, 0);
        const defendersWon = (rnd.side === 'defending') === (won === 'us');
        if (!rnd.down[mySide].has(subject) && left >= W.DECIDED && rnd.side) {
          label = rnd.planted && defendersWon ? (meWon ? 'Round won, spike defused' : 'Round lost to the defuse')
            : rnd.planted ? (meWon ? 'Round won, the spike went off' : 'Round lost, the spike went off')
              : meWon ? 'Round won, held to the timer' : 'Round lost, alive at the end';
        }
      }
    }
    rnd.decided = true; rnd.decidedFor = won;
    if (won) for (const k of players.keys()) credit(k, sideOfKey(k) === won ? W.RESULT : -W.RESULT);
    // The subject's deaths say whether they were traded, now the window is shut.
    for (const d of rnd.deaths) {
      if (d.victim !== subject || !d.at || !d.at.label || d.decided || d.last) continue;
      d.at.label = d.first ? `Died first, ${d.traded ? 'traded' : 'not traded'}` : `${d.at.label}, ${d.traded ? 'traded' : 'not traded'}`;
    }
    rnd.ended = true;
    const out = record('end', ev, label, before0, !!label);
    byRound.push({
      n: rnd.n, won: meWon, value: out.value, delta: round1(out.value - display(rnd.startNet, subjectRounds, longest)),
      swing: round3(rnd.swing), label: roundName(meWon), satOut: rnd.satOut,
    });
    return out;
  }

  const ignored = (ev, why) => {
    const value = valueOf(subject);
    return { round: rnd ? rnd.n : null, ms: num(ev.ms), kind: ev.kind, delta: 0, value, swing: 0, label: null, ignored: why };
  };

  /*
   * THE SPIKE WENT OFF, found by the first event after its time: what was
   * left of the chance is settled at that moment the way a round's end
   * settles it (the attackers still up gain it, the defenders still up lose
   * it), then the round is decided. Its own entry on the timeline.
   */
  function detonate() {
    const at = rnd.plantMs + W.SPIKE_MS;
    const before = valueOf(subject);
    const att = rnd.side === 'attacking' ? 'us' : rnd.side === 'defending' ? 'them' : null;
    if (!att) { rnd.decided = true; rnd.decidedFor = null; return; }
    // The chance at the last moment the engine knew of, before the clock ran
    // out: the round thrown or held since is what is settled now.
    const p0 = chanceUs(rnd.lastMs);
    rnd.decided = true; rnd.decidedFor = att;
    if (p0 === null) return;
    const left = att === 'us' ? 1 - p0 : p0;
    share(att, left, null, 0);
    share(other(att), -left, null, 0);
    const up = !rnd.down[mySide].has(subject);
    record('detonate', { ms: at }, mySide === att ? 'The spike went off' : 'The spike went off against you', before, up && left >= W.DECIDED);
  }

  function push(ev) {
    if (!ev || typeof ev !== 'object') return null;
    // The same event twice (a live feed re-sending) moves nothing the second time.
    if (ev.id !== undefined && ev.id !== null) {
      const id = String(ev.id);
      if (seen.has(id)) return ignored(ev, 'repeated');
      seen.add(id);
    }
    const n = num(ev.round);
    // A round older than the one being played is over: nothing changes it.
    if (rnd && n !== null && n < rnd.n) return ignored(ev, 'stale');
    const before = valueOf(subject);
    if (ev.kind === 'round') {
      // The round being played again: its side only, never a reset.
      if (rnd && (n === null || n === rnd.n)) {
        if (!rnd.side && (ev.side === 'attacking' || ev.side === 'defending')) rnd.side = ev.side;
        return ignored(ev, 'same round');
      }
      startRound(n !== null ? n : (rnd ? rnd.n + 1 : 1), ev.side, ev.satOut);
      credits.clear();
      const value = valueOf(subject);
      return { round: rnd.n, ms: null, kind: 'round', delta: round1(value - before), value, swing: 0, label: null };
    }
    // A round no 'round' event opened is opened by its first event.
    if (!rnd || (n !== null && n !== rnd.n)) startRound(n !== null ? n : (rnd ? rnd.n + 1 : 1), null, false);
    if (rnd.ended) return ignored(ev, 'round over');
    const atMs = num(ev.ms);
    if (atMs !== null && rnd.planted && rnd.plantMs !== null && !rnd.decided && atMs > rnd.plantMs + W.SPIKE_MS) detonate();
    let out = null;
    if (ev.kind === 'kill') out = kill(ev, valueOf(subject));
    else if (ev.kind === 'plant' || ev.kind === 'defuse') out = spike(ev.kind, ev, before);
    else if (ev.kind === 'end') out = end(ev, valueOf(subject));
    // The last moment the engine knows of, for the clock at the round's end.
    if (atMs !== null && rnd && !rnd.ended) rnd.lastMs = atMs;
    return out;
  }

  function snapshot() {
    return {
      version: VERSION,
      value: valueOf(subject),
      net: round3((players.get(subject) || { net: 0 }).net),
      rounds: subjectRounds,
      players: [...players.entries()].map(([key, p]) => ({
        key, side: sideOfKey(key), agent: agentOf(key), value: valueOf(key), net: round3(p.net),
      })),
      timeline: timeline.map((e) => ({ ...e })),
      byRound: byRound.map((e) => ({ ...e })),
    };
  }

  return { push, snapshot, value: () => valueOf(subject) };
}

/* ---------------------------------------------------------------- from Riot's record */

/** A feed end ('me', 'mate', 'enemy', with its agent) as a key. */
function keyOf(who, agent) {
  if (who === 'me') return 'me';
  const side = who === 'mate' ? 'us' : who === 'enemy' ? 'them' : null;
  if (!side) return null;
  return typeof agent === 'string' && agent ? `${side}:${agent}` : side;
}

/**
 * One round of Riot's record as events. A round: { n, side, won, satOut,
 * traded, plantMs, plantBy, defuseMs, defuseBy, feed: [{ ms, by, on, ka, va,
 * w, as }] }, the feed in riot-rounds.js parse's shape (a card's riot.feed),
 * `as` the assisters as [{ by, a }], plantBy and defuseBy a feed end
 * ({ by, a }), `traded` Riot's own flag for the player's death. Null for a
 * round with no feed: it cannot be rated.
 */
function eventsOfRound(r) {
  if (!r || !Array.isArray(r.feed)) return null;
  const endKey = (x) => (x && typeof x === 'object' ? keyOf(x.by, x.a) : null);
  // A kill with no time takes the time of the kill before it in the feed (0
  // before the first), so every item has a time and the order is one total
  // order: by time, then a plant before a kill and a defuse after, then the
  // feed's own order.
  let lastT = 0;
  const timed = r.feed.map((k, i) => ({ t: num(k && k.ms) !== null ? (lastT = k.ms) : lastT, rank: 1, i, e: {
    kind: 'kill', round: r.n, ms: num(k && k.ms), killer: keyOf(k && k.by, k && k.ka), victim: keyOf(k && k.on, k && k.va),
    weapon: k && typeof k.w === 'string' ? k.w : null,
    ...(k && Array.isArray(k.as) ? { assists: k.as.map(endKey).filter(Boolean) } : {}),
    ...(k && k.on === 'me' && typeof r.traded === 'boolean' ? { traded: r.traded } : {}),
  } }));
  const attackers = r.side === 'attacking' ? 'us' : r.side === 'defending' ? 'them' : null;
  if (num(r.plantMs) !== null) timed.push({ t: r.plantMs, rank: 0, i: -1, e: { kind: 'plant', round: r.n, ms: r.plantMs, by: endKey(r.plantBy) || attackers } });
  if (num(r.defuseMs) !== null) timed.push({ t: r.defuseMs, rank: 2, i: 1e6, e: { kind: 'defuse', round: r.n, ms: r.defuseMs, by: endKey(r.defuseBy) || other(attackers) } });
  timed.sort((a, b) => (a.t - b.t) || (a.rank - b.rank) || (a.i - b.i));
  // The round's end, timed where the record says when: the defuse, or the
  // spike going off when the attackers won a planted round with no defuse,
  // so what was left is settled by the spike's clock, never a flat share.
  const planted = num(r.plantMs) !== null;
  const attWon = typeof r.won === 'boolean' && attackers ? (attackers === 'us') === r.won : null;
  const endMs = num(r.defuseMs) !== null ? r.defuseMs : planted && attWon === true ? r.plantMs + W.SPIKE_MS + 1 : null;
  return [
    { kind: 'round', round: r.n, side: r.side === 'attacking' || r.side === 'defending' ? r.side : null, satOut: r.satOut === true },
    ...timed.map((x) => x.e),
    { kind: 'end', round: r.n, won: typeof r.won === 'boolean' ? r.won : null, ...(endMs !== null ? { ms: endMs } : {}) },
  ];
}

/** Every key a match's feeds name, for the lobby. */
function lobbyOf(rounds) {
  const keys = new Set(['me']);
  for (const r of rounds) for (const k of r.feed || []) {
    for (const key of [keyOf(k && k.by, k && k.ka), keyOf(k && k.on, k && k.va)]) if (named(key)) keys.add(key);
  }
  return [...keys];
}

/** Every kill of every round names both ends by agent, so all ten have a value. */
function allKeyed(rounds) {
  return rounds.every((r) => (r.feed || []).every((k) => k && (k.by === 'me' || typeof k.ka === 'string')
    && (k.on === 'me' || typeof k.va === 'string')));
}

/** The fewest rounds played the rating is given for. */
const MIN_ROUNDS = 3;

/**
 * A whole match from Riot's record: { rounds, queue, firstToFive, meAgent }.
 * Answers { rating, why }: the saved shape, or null and why not.
 */
function fromRecord(match) {
  const m = match || {};
  const rounds = (Array.isArray(m.rounds) ? m.rounds : []).filter(Boolean).slice().sort((a, b) => (a.n || 0) - (b.n || 0));
  if (!rounds.length) return { rating: null, why: 'no-record' };
  if (rounds.some((r) => !Array.isArray(r.feed))) return { rating: null, why: 'no-feed' };
  if (rounds.filter((r) => r.satOut !== true).length < MIN_ROUNDS) return { rating: null, why: 'too-short' };
  // First to five in nine rounds or fewer is a Swiftplay's length.
  const queue = m.queue || (rounds.length <= 9 && m.firstToFive ? 'swiftplay' : null);
  const keyed = allKeyed(rounds);
  const r = createRating({ queue, meAgent: m.meAgent || null, players: keyed ? lobbyOf(rounds) : ['me'] });
  for (const round of rounds) for (const e of eventsOfRound(round)) r.push(e);
  return { rating: saved(r.snapshot(), keyed), why: null };
}

/**
 * THE SAVED SHAPE, what a review keeps (rating.md, "What is saved"):
 *   { version, value, rounds,
 *     byRound: [{ n, won, value, delta, swing, label }],
 *     timeline: [{ round, ms, kind, delta, value, swing, label }],
 *     place: { n, of } or null, lobby: [{ side, agent, value, me }] or null }
 * The lobby is sides, agents and numbers, never a name, and only when every
 * kill named both ends by agent; otherwise place and lobby are null.
 */
function saved(snap, keyed) {
  const timeline = snap.timeline.filter((e) => e.label).map((e) => ({
    round: e.round, ms: e.ms, kind: e.kind, delta: e.delta, value: e.value, swing: e.swing, label: e.label,
  }));
  const byRound = snap.byRound.map((e) => ({ n: e.n, won: e.won, value: e.value, delta: e.delta, swing: e.swing, label: e.label }));
  let lobby = null;
  let place = null;
  if (keyed) {
    const list = snap.players.filter((p) => p.side && (p.key === 'me' || p.agent))
      .map((p) => ({ side: p.side, agent: p.agent, value: p.value, net: p.net, me: p.key === 'me' }))
      .sort((a, b) => (b.net - a.net) || (a.me ? -1 : b.me ? 1 : 0));
    const at = list.findIndex((p) => p.me);
    if (at >= 0 && list.length >= 2) place = { n: at + 1, of: list.length };
    lobby = list.map((p) => ({ side: p.side, agent: p.agent, value: p.value, me: p.me }));
  }
  return { version: VERSION, value: snap.value, rounds: snap.rounds, byRound, timeline, place, lobby };
}

/**
 * A review's rounds as Riot's record, from its cards' riot facts: what the
 * late link, the backfill, an import and an old review opened all read.
 */
function roundsOfReview(review) {
  const cards = review && Array.isArray(review.rounds) ? review.rounds : [];
  return cards.filter((c) => c && typeof c.n === 'number').map((c) => {
    const riot = c.riot && typeof c.riot === 'object' ? c.riot : null;
    return {
      n: c.n,
      side: c.sideKey === 'attacking' || c.sideKey === 'defending' ? c.sideKey : null,
      won: c.result === 'won' ? true : c.result === 'lost' ? false : null,
      satOut: !!(riot && (riot.afk === true || riot.inSpawn === true)),
      ...(riot && typeof riot.traded === 'boolean' ? { traded: riot.traded } : {}),
      plantMs: riot && num(riot.plantSec) !== null ? Math.round(riot.plantSec * 1000) : null,
      ...(riot && num(riot.defuseSec) !== null ? { defuseMs: Math.round(riot.defuseSec * 1000) } : {}),
      ...(riot && riot.plantBy && typeof riot.plantBy === 'object' ? { plantBy: riot.plantBy } : {}),
      ...(riot && riot.defuseBy && typeof riot.defuseBy === 'object' ? { defuseBy: riot.defuseBy } : {}),
      feed: riot && Array.isArray(riot.feed) ? riot.feed : null,
    };
  });
}

/*
 * A SAVED RATING AS IT MAY BE SHOWN: a damaged file never fails the review.
 * The value is a number clamped to 0 to 10, or there is no saved rating (it
 * is counted again from the cards); every row of the lobby, the rounds and
 * the timeline is kept only with its numbers finite and its words words.
 */
function cleanSaved(s) {
  if (!s || typeof s !== 'object' || typeof s.version !== 'number' || num(s.value) === null) return null;
  const clamp = (v) => Math.min(10, Math.max(0, round1(v)));
  const fin = (v) => num(v) !== null;
  const text = (v) => (typeof v === 'string' ? v.replace(/;/g, ',').slice(0, 120) : null);
  const timeline = (Array.isArray(s.timeline) ? s.timeline : []).filter((e) => e && fin(e.round) && fin(e.value) && fin(e.delta) && typeof e.label === 'string')
    .map((e) => ({ round: e.round, ms: fin(e.ms) ? e.ms : null, kind: String(e.kind || ''), delta: e.delta, value: clamp(e.value), swing: fin(e.swing) ? e.swing : 0, label: text(e.label) }));
  const byRound = Array.isArray(s.byRound) ? s.byRound.filter((e) => e && fin(e.n) && fin(e.value) && fin(e.delta))
    .map((e) => ({ n: e.n, won: typeof e.won === 'boolean' ? e.won : null, value: clamp(e.value), delta: e.delta, swing: fin(e.swing) ? e.swing : 0, label: text(e.label) })) : null;
  const lobby = Array.isArray(s.lobby) ? s.lobby.filter((p) => p && (p.side === 'us' || p.side === 'them') && fin(p.value))
    .map((p) => ({ side: p.side, agent: typeof p.agent === 'string' ? p.agent : null, value: clamp(p.value), me: p.me === true })) : null;
  // A lobby with a damaged row is no lobby, and no place: neither can be trusted.
  const whole = !!lobby && lobby.length === s.lobby.length && lobby.length >= 2;
  const place = whole && s.place && Number.isInteger(s.place.n) && Number.isInteger(s.place.of) && s.place.n >= 1 && s.place.n <= s.place.of ? { n: s.place.n, of: s.place.of } : null;
  return { version: s.version, value: clamp(s.value), rounds: Number.isInteger(s.rounds) ? s.rounds : 0, ...(byRound ? { byRound } : {}), timeline, place, lobby: whole ? lobby : null };
}

/** What would give a review a rating, in the player's words, by why. */
const WHY = Object.freeze({
  'no-record': "Rated only once Riot's record of the match is linked: the rating is counted from Riot's kill feed, round by round.",
  'no-feed': "Saved before Occlara kept Riot's kill feed for every round, so there is nothing to rate it from.",
  'too-short': 'Too few rounds played to rate.',
});

/**
 * A review's rating: the saved one when it has one, else counted from its
 * cards when they carry what the engine needs, else null with the line that
 * says what would give it one. Never writes, never touches the grade.
 */
function ratingOfReview(review) {
  if (!review || review.kind !== 'valorant') return { rating: null, why: 'not-valorant', note: null };
  const s = cleanSaved(review.rating);
  if (s) return { rating: s, why: null, note: null };
  const rounds = roundsOfReview(review);
  if (!rounds.length || !rounds.some((r) => r.feed)) {
    // Riot's record laid over it, but saved before the feed was kept (8.5.0).
    const linked = (review.rounds || []).some((c) => c && c.riot && typeof c.riot === 'object');
    const why = linked ? 'no-feed' : 'no-record';
    return { rating: null, why, note: WHY[why] };
  }
  const g = review.game && typeof review.game === 'object' ? review.game : {};
  const tops = typeof g.score === 'string' ? g.score.split('-').map(Number) : [];
  const out = fromRecord({
    rounds,
    queue: typeof g.mode === 'string' ? g.mode : null,
    firstToFive: tops.length === 2 && tops.every(Number.isFinite) && Math.max(...tops) === 5,
    meAgent: typeof g.agent === 'string' ? g.agent : null,
  });
  return { rating: out.rating, why: out.why, note: out.why ? WHY[out.why] : null };
}

/**
 * The k biggest round gains and losses of a saved rating, each the round's
 * move in the shown value, its swing breaking a tie, with its name. Sorted by
 * the number the page shows, so the list reads in order.
 */
function swings(rating, k) {
  const n = k || 3;
  const rs = rating && Array.isArray(rating.byRound) ? rating.byRound.filter((e) => e && e.label && !/^Sat out/.test(e.label)) : [];
  const key = (e) => e.delta * 1000 + (e.swing || 0);
  return {
    gains: rs.filter((e) => e.swing > 0 && e.delta > 0).sort((a, b) => (key(b) - key(a)) || (a.n - b.n)).slice(0, n),
    losses: rs.filter((e) => e.swing < 0 && e.delta < 0).sort((a, b) => (key(a) - key(b)) || (a.n - b.n)).slice(0, n),
  };
}

/** 1st, 2nd, 3rd, 11th. */
function ordinal(n) {
  const s = n % 100 >= 11 && n % 100 <= 13 ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' })[n % 10] || 'th';
  return `${n}${s}`;
}
/** "3rd of 10", or null. */
function placeLine(place) {
  return place && place.n > 0 && place.of > 0 ? `${ordinal(place.n)} of ${place.of}` : null;
}

/** "+0.3", "-0.2", "0.0": a move as the page writes it, one decimal. */
function signed(v) {
  const t = Math.round(v * 10);
  return t > 0 ? `+${(t / 10).toFixed(1)}` : t < 0 ? `-${(-t / 10).toFixed(1)}` : '0.0';
}

/*
 * THE TIER, as football ratings colour theirs: under 6.0 poor, 6.0 to 6.9
 * fair, 7.0 to 7.9 good, 8.0 to 8.9 very good, 9.0 and up excellent. The page
 * maps each to a token (rating.css); the number is always beside it.
 */
function tierOf(v) {
  return typeof v !== 'number' ? null : v >= 9 ? 'excellent' : v >= 8 ? 'great' : v >= 7 ? 'good' : v >= 6 ? 'fair' : 'poor';
}

/**
 * WHAT THE PAGE IS SENT (served by valorant-review.js, never on disk): the
 * number and its tier, a point a round, the three biggest round gains and
 * losses, the place in the lobby, the lobby by agent, the half, the running
 * score and every event for the replay. Sides, agents, rounds and numbers
 * only. With no rating, the line that says what would give one, or null
 * where nothing is said (League). A rating saved before rounds were kept is
 * drawn from its events.
 *   opts.rounds  the match's rounds, so the line runs to the last one
 *   opts.half    the round after which the sides swapped
 *   opts.results each round's result for the score, [{ n, won }]
 */
function viewOf(r, opts) {
  const o = opts || {};
  if (!r) return o.note ? { value: null, note: o.note } : null;
  const tl = Array.isArray(r.timeline) ? r.timeline : [];
  const kept = Array.isArray(r.byRound) ? r.byRound : null;
  const last = Math.max(num(o.rounds) || 0, r.rounds || 0, ...tl.map((e) => e.round || 0), ...(kept || []).map((e) => e.n || 0));
  const results = new Map((Array.isArray(o.results) ? o.results : []).map((x) => [x.n, x.won]));
  const after = new Map();
  for (const e of tl) after.set(e.round, e.value);
  const byN = new Map((kept || []).map((e) => [e.n, e]));
  const rounds = [];
  let v = D.START;
  let us = 0;
  let them = 0;
  for (let n = 1; n <= last; n++) {
    const e = byN.get(n);
    const before = v;
    if (e) v = e.value; else if (after.has(n)) v = after.get(n);
    const won = e && typeof e.won === 'boolean' ? e.won : results.has(n) ? results.get(n) : null;
    if (won === true) us++; else if (won === false) them++;
    rounds.push({ n, value: v, delta: signed(v - before), label: e ? e.label : null, won, score: `${us} : ${them}` });
  }
  const sw = swings(r, 3);
  const item = (e) => ({ round: e.n, label: e.label, delta: signed(e.delta), up: e.delta > 0 });
  return {
    version: r.version,
    value: r.value,
    shown: r.value.toFixed(1),
    tier: tierOf(r.value),
    place: placeLine(r.place),
    lobby: Array.isArray(r.lobby) ? r.lobby.map((p) => ({ side: p.side, agent: p.agent || null, value: p.value.toFixed(1), tier: tierOf(p.value), me: !!p.me })) : null,
    half: num(o.half) && o.half < last ? o.half : null,
    line: [{ n: 0, value: D.START }, ...rounds.map((x) => ({ n: x.n, value: x.value }))],
    rounds,
    gains: sw.gains.map(item),
    losses: sw.losses.map(item),
    marks: [...sw.gains, ...sw.losses].map((e) => ({ round: e.n, up: e.delta > 0 })),
    events: tl.map((e) => ({ round: e.round, kind: e.kind, label: e.label, value: e.value, delta: signed(e.delta), tier: tierOf(e.value) })),
    note: null,
  };
}

module.exports = {
  VERSION, WP, W, D, LENGTHS, MIN_ROUNDS, WHY,
  winChance, display, lengthOf, createRating, eventsOfRound, fromRecord, roundsOfReview, lobbyOf, allKeyed,
  ratingOfReview, swings, ordinal, placeLine, keyOf, viewOf, signed, tierOf, isGun, cleanSaved,
};
