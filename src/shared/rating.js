'use strict';

/**
 * THE MATCH RATING: a number from 0.0 to 10.0 that starts at 6.0 and moves by
 * what the player does, the way a football player's match rating does.
 *
 * EVERY MOVE IS A CHANGE IN THE CHANCE TO WIN THE ROUND. Each kill, death,
 * plant, defuse and round end moves the chance of the player's team to win the
 * round it happened in (`winChance`, by players alive on each side and the
 * spike), and the player is credited the change their action caused. A first
 * kill at five against five moves it about a quarter, the fifth kill of a
 * five against one about two hundredths, a kill after the spike went off
 * nothing at all. A clutch and a multi kill are no bonus written here: they
 * are worth what the kills inside them moved.
 *
 * STREAMING, ON PARTIAL INFORMATION. `createRating()` takes one event at a
 * time and answers the subject's value after it, so the same engine runs over
 * Riot's record after a match (`fromRecord`, `ratingOfReview`) and, later,
 * over what the screen reads live. A field that is missing degrades to a
 * neutral value, never to a guess at a person (docs/claude/rating.md says what
 * each missing field costs).
 *
 * NEVER A NAME. A player is a key: 'me', or a side and an agent ('us:Jett',
 * 'them:Sova'), or a side alone ('us', 'them') when the agent is unknown, who
 * is then counted in the numbers standing and credited nothing.
 *
 * Pure, deterministic, no I/O, no Electron.
 */

// Bump when any number below changes, so a saved rating says which maths made
// it and is never shown as if today's maths had (rating.md, "Versions").
const VERSION = 1;

/*
 * THE CHANCE TO WIN A ROUND, for the attackers, from `a` attackers and `d`
 * defenders standing and whether the spike is down. A logistic on the man
 * advantage and the spike, fitted by maximum likelihood on 116 rounds of
 * Riot's record (940 states, both teams of every round: the repo's two
 * fixtures with a kill feed and the owner's five saved reviews with one):
 *
 *   logit P = B0 + B_MAN * (a - d) + B_RATIO * ln(a / d) + B_SPIKE * planted
 *
 * The difference and the ratio together fitted best (log loss 0.494, the
 * difference alone 0.495, the ratio alone 0.501), and the ratio is what makes
 * a man up in a two against two worth more than one in a five against five,
 * as the record has it (2v1 won 75 percent, 5v4 62 percent). B0
 * is the defenders' edge at equal numbers with the spike up, which the clock
 * gives them. With no attacker left and the spike down the defenders still
 * have to defuse: half the time against one defender, then 0.3 times as
 * likely for each more (26 such states; rating.md, "The table").
 */
const WP = Object.freeze({ B0: -0.43, B_MAN: 0.82, B_RATIO: 0.60, B_SPIKE: 0.98, ZERO_ATT_ONE: 0.5, ZERO_ATT_DECAY: 0.3 });

/*
 * THE WEIGHTS, set on the calibration (rating.md, "Calibration"):
 *
 * LOSS_WEIGHT   every move against a player counts this share of itself. A
 *               duel lost is partly the killer's doing, and a football rating
 *               averages above its start for the same reason. With the trades
 *               given back it puts the calibration lobby's mean at 6.6 where
 *               an even 1.0 put it at 6.3 (0.75 gave 6.9).
 * TRADE_BACK    a death a teammate traded gives this share of its cost back,
 *               at the trade: the trade recovered the chance.
 * TRADE_MS      the trade window, riot-rounds.js TRADE_MS.
 * ASSIST_SHARE  each assister named on a kill takes this share of its swing
 *               from the killer, half at most in all. Riot's feed as the
 *               client keeps it names no assister yet, so today every kill is
 *               its killer's alone.
 * PLANTER_SHARE a named planter or defuser takes this share of the swing and
 *               the rest is shared by the side's players alive at it; with no
 *               one named it is all shared.
 * RESULT        each player of the side that won a round gains this, each of
 *               the side that lost it loses it. Small on purpose: the result
 *               is already inside the swings, which sum to it.
 * DECIDED       a swing under this is "after the round was decided".
 * NEUTRAL_SWING a kill whose numbers standing cannot be known (a side
 *               missing) is worth the mean swing of a kill or death in calibration (0.17,
 *               over the player's 209 on the seven matches).
 */
const W = Object.freeze({
  LOSS_WEIGHT: 0.9, TRADE_BACK: 0.5, TRADE_MS: 5000, REVIVE_MS: 2000,
  ASSIST_SHARE: 0.15, ASSIST_MAX: 0.5, PLANTER_SHARE: 0.5, RESULT: 0.02, DECIDED: 0.01,
  NEUTRAL_SWING: 0.17, SPIKE_MS: 45000,
});

/*
 * THE DISPLAY. 6.0 plus a squash of the player's net swing scaled to a
 * standard length: up to 4 points above (10.0 only in the limit, so it is
 * rare) and 3 below (a floor of 3.0), each a tanh, so returns diminish near
 * the ends.
 *
 * MATCH LENGTH. The net is scaled by (REF + K) / (max(rounds, E) + K): E is
 * the queue's usual longest match (24 rounds, 9 for Swiftplay, 7 for Spike
 * Rush), K twelve rounds of neutral play. Up to E rounds every event weighs
 * the same from the first round on, so a live value never leaps because the
 * match is young; past E, overtime, every move is diluted a little, so thirty
 * rounds of trading do not inflate. A Swiftplay counts its moves 36 / 21 =
 * 1.71 times, which leaves its spread a little under a full match's instead
 * of four times it, as a per round average would (rating.md, "Match length").
 */
const D = Object.freeze({ START: 6.0, UP: 4.0, DOWN: 3.0, A: 3.2, B: 2.6, REF: 24, K: 12 });
const LENGTHS = Object.freeze({ standard: 24, swiftplay: 9, spikerush: 7 });

const sigmoid = (z) => 1 / (1 + Math.exp(-z));
const round1 = (v) => Math.round(v * 10) / 10;
const round3 = (v) => Math.round(v * 1000) / 1000;
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** The attackers' chance to win from a against d, the spike down or not. */
function winChance(a, d, planted) {
  if (d <= 0 && a <= 0) return planted ? 1 : 0.5;
  if (d <= 0) return 1;
  if (a <= 0) return planted ? WP.ZERO_ATT_ONE * Math.pow(WP.ZERO_ATT_DECAY, d - 1) : 0;
  return sigmoid(WP.B0 + WP.B_MAN * (a - d) + WP.B_RATIO * Math.log(a / d) + (planted ? WP.B_SPIKE : 0));
}

/** The usual longest match of a queue, in rounds. */
function lengthOf(queue) {
  const q = String(queue || '').toLowerCase();
  if (/swift/.test(q)) return LENGTHS.swiftplay;
  if (/spike ?rush/.test(q)) return LENGTHS.spikerush;
  return LENGTHS.standard;
}

/** The shown value of a net swing over a number of rounds, one decimal. */
function display(net, rounds, longest) {
  const E = Math.max(1, longest || LENGTHS.standard);
  const x = net * (D.REF + D.K) / (Math.max(rounds || 0, E) + D.K);
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

/**
 * A NEW RATING. opts:
 *   subject   the key followed, 'me' by default
 *   players   every key known to be in the match (the lobby), so a player is
 *             counted alive and gets the result term before their first kill
 *   queue     for the length rule; longest overrides it in rounds
 *   meAgent   the subject's agent, for the lobby list
 *
 * push(event) takes one event and answers the subject's move:
 *   { round, ms, kind, delta, value, swing, label }
 * delta is the change in the shown value, swing the subject's credit in
 * chance to win, label a plain line ("First kill, 5v5"), null when the event
 * was nothing of the subject's. A death's label gains ", traded" or ", not
 * traded" at the round's end, once the trade window is shut.
 *
 * Events (rating.md, "The event shape"):
 *   { kind: 'round', round, side: 'attacking' | 'defending' | null, satOut }
 *   { kind: 'kill', round, ms, killer, victim, assists: [key], weapon, alive: { us, them } }
 *   { kind: 'plant', round, ms, by }      by a key, or a side alone
 *   { kind: 'defuse', round, ms, by }
 *   { kind: 'end', round, won }           won: the subject's side, true, false or null
 */
function createRating(opts) {
  const o = opts || {};
  const subject = typeof o.subject === 'string' && named(o.subject) ? o.subject : 'me';
  const longest = num(o.longest) || lengthOf(o.queue);
  const players = new Map(); // key -> { net }
  const timeline = [];
  const credits = new Map(); // this event's credits by key
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

  function startRound(n, side, satOut) {
    rnd = {
      n, side: side === 'attacking' || side === 'defending' ? side : null,
      satOut: satOut === true, alive: { us: 5, them: 5 }, down: { us: new Map(), them: new Map() },
      planted: false, plantMs: null, decided: false, decidedFor: null, kills: 0, deaths: [], ended: false,
    };
    roundsStarted++;
    if (!rnd.satOut) subjectRounds++;
  }

  // The chance of the subject's side ('us') to win the round now.
  function chanceUs() {
    const { us, them } = rnd.alive;
    if (rnd.decided) return rnd.decidedFor === 'us' ? 1 : rnd.decidedFor === 'them' ? 0 : null;
    if (rnd.side === 'attacking') return winChance(us, them, rnd.planted);
    if (rnd.side === 'defending') return 1 - winChance(them, us, rnd.planted);
    // No side known: the spike cannot be placed, the man advantage alone.
    if (us <= 0) return 0;
    if (them <= 0) return 1;
    return sigmoid(WP.B_MAN * (us - them) + WP.B_RATIO * Math.log(us / them));
  }

  // Credit a key. A move against it counts LOSS_WEIGHT of itself, and the
  // subject's round sat out moves nothing.
  function credit(key, amount) {
    if (!named(key) || !amount) return;
    if (key === subject && rnd && rnd.satOut) return;
    const c = amount < 0 ? amount * W.LOSS_WEIGHT : amount;
    ensure(key).net += c;
    credits.set(key, (credits.get(key) || 0) + c);
  }

  // The subject's answer to one event; kept on the timeline when it was the
  // subject's doing or the subject's round end.
  function record(kind, ev, label, before, involved) {
    const mine = credits.get(subject) || 0;
    const value = valueOf(subject);
    const out = { round: rnd ? rnd.n : null, ms: num(ev && ev.ms), kind, delta: round1(value - before), value, swing: round3(mine), label: involved ? label : null };
    if (involved && label && !(rnd && rnd.satOut)) timeline.push(out);
    credits.clear();
    return out;
  }

  function decideByNumbers() {
    const { us, them } = rnd.alive;
    const usDefend = rnd.side === 'defending';
    const usAttack = rnd.side === 'attacking';
    if (us === 0 && !(rnd.planted && usAttack)) { rnd.decided = true; rnd.decidedFor = 'them'; }
    else if (them === 0 && !(rnd.planted && usDefend)) { rnd.decided = true; rnd.decidedFor = 'us'; }
  }

  function kill(ev, before) {
    const killer = typeof ev.killer === 'string' ? ev.killer : null;
    const victim = typeof ev.victim === 'string' ? ev.victim : null;
    const ms = num(ev.ms);
    const kSide = sideOfKey(killer);
    const vSide = sideOfKey(victim);
    // The spike's time is up: nothing after it changes the round.
    if (rnd.planted && rnd.plantMs !== null && ms !== null && ms > rnd.plantMs + W.SPIKE_MS && !rnd.decided) {
      rnd.decided = true;
      rnd.decidedFor = rnd.side === 'attacking' ? 'us' : rnd.side === 'defending' ? 'them' : null;
    }
    // A revive puts a player back (riot-rounds.js teamworkOf's rule): a gun
    // kill by a player down REVIVE_MS or more, or a second death of one.
    if (kSide && named(killer) && rnd.down[kSide].has(killer)) {
      const at = rnd.down[kSide].get(killer);
      if (ev.weapon && at !== null && ms !== null && ms - at >= W.REVIVE_MS) { rnd.down[kSide].delete(killer); rnd.alive[kSide] = Math.min(5, rnd.alive[kSide] + 1); }
    }
    if (vSide && named(victim) && rnd.down[vSide].has(victim)) { rnd.down[vSide].delete(victim); rnd.alive[vSide] = Math.min(5, rnd.alive[vSide] + 1); }
    // The screen may know the numbers standing better than the feed does.
    if (ev.alive && num(ev.alive.us) !== null && num(ev.alive.them) !== null) {
      rnd.alive = { us: Math.max(0, Math.min(5, ev.alive.us)), them: Math.max(0, Math.min(5, ev.alive.them)) };
    }
    const standing = { ...rnd.alive };
    const first = rnd.kills === 0;
    rnd.kills++;

    // The swing for the victim's side, negative.
    let swing;
    if (!vSide) {
      swing = -W.NEUTRAL_SWING;
    } else {
      const p0 = chanceUs();
      rnd.alive[vSide] = Math.max(0, rnd.alive[vSide] - 1);
      if (named(victim)) rnd.down[vSide].set(victim, ms);
      const p1 = chanceUs();
      const dUs = p0 === null || p1 === null ? (vSide === 'us' ? -W.NEUTRAL_SWING : W.NEUTRAL_SWING) : p1 - p0;
      swing = vSide === 'us' ? dUs : -dUs;
    }
    const decided = Math.abs(swing) < W.DECIDED;
    const ownTeam = !!(kSide && vSide && kSide === vSide);
    const self = !!(killer && victim && killer === victim);
    const sideOf = (s) => (s === 'us' ? vs(standing.us, standing.them) : vs(standing.them, standing.us));

    let label = null;
    let involved = false;
    if (self || ownTeam) {
      // A fall, the spike, a teammate's molly: the one who did it carries it.
      credit(self ? victim : killer, swing);
      if (victim === subject) { label = self ? 'Died to themselves' : 'Killed by a teammate'; involved = true; }
      else if (killer === subject) { label = 'Killed a teammate'; involved = true; }
    } else {
      // The killer, and each assister's share.
      if (kSide) {
        const assists = (Array.isArray(ev.assists) ? ev.assists : []).filter((a) => named(a) && sideOfKey(a) === kSide && a !== killer);
        const share = Math.min(W.ASSIST_MAX, W.ASSIST_SHARE * assists.length);
        credit(killer, -swing * (1 - share));
        for (const a of assists) credit(a, -swing * (share / assists.length));
        const own = kSide === 'us' ? standing.us : standing.them;
        // A trade: the killer killed whoever had just killed one of theirs.
        const avenged = rnd.deaths.find((d) => !d.traded && d.killer && d.killer === victim && d.side === kSide
          && d.ms !== null && ms !== null && ms >= d.ms && ms - d.ms <= W.TRADE_MS);
        if (avenged) {
          avenged.traded = true;
          if (!avenged.decided) credit(avenged.victim, Math.abs(avenged.cost) * W.TRADE_BACK);
        }
        if (killer === subject) {
          involved = true;
          label = decided ? 'Kill after the round was decided'
            : first ? `First kill, ${sideOf(kSide)}`
              : avenged ? `Traded a teammate, ${sideOf(kSide)}`
                : own === 1 ? `Kill as the last one up, ${sideOf(kSide)}`
                  : `Kill, ${sideOf(kSide)}`;
        } else if (assists.includes(subject)) {
          involved = true;
          label = decided ? 'Assist after the round was decided' : `Assist, ${sideOf(kSide)}`;
        } else if (avenged && avenged.victim === subject && !avenged.decided) {
          involved = true;
          label = 'Your death was traded, half of it given back';
        }
      }
      // The victim.
      if (named(victim)) {
        credit(victim, swing);
        const own = vSide === 'us' ? standing.us : standing.them;
        rnd.deaths.push({ victim, killer, side: vSide, ms, cost: swing, traded: false, first, decided, last: own === 1, at: null });
        if (victim === subject) {
          involved = true;
          label = decided ? 'Died after the round was decided'
            : first ? `Died first, ${sideOf(vSide)}`
              : own === 1 ? `Died last, ${sideOf(vSide)}`
                : `Died, ${sideOf(vSide)}`;
        }
      }
    }
    const out = record('kill', ev, label, before, involved);
    const d = rnd.deaths[rnd.deaths.length - 1];
    if (victim === subject && d && d.victim === subject && !d.at) d.at = out;
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

  // Share a gain among a side's players alive (the gain's own sign), a named
  // one first taking `lead` of it.
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
    // The planting side attacks: a plant says the side when nothing else did.
    if (kind === 'plant' && !rnd.side && side) rnd.side = side === 'us' ? 'attacking' : 'defending';
    if (!side && rnd.side) side = kind === 'plant' ? (rnd.side === 'attacking' ? 'us' : 'them') : (rnd.side === 'defending' ? 'us' : 'them');
    const p0 = chanceUs();
    const standing = { ...rnd.alive };
    if (kind === 'plant') { rnd.planted = true; rnd.plantMs = num(ev.ms); }
    else if (side) { rnd.decided = true; rnd.decidedFor = side; }
    const p1 = chanceUs();
    if (p0 === null || p1 === null || !side) return record(kind, ev, null, before, false);
    const gain = side === 'us' ? p1 - p0 : p0 - p1;
    share(side, gain, by, W.PLANTER_SHARE);
    share(other(side), -gain, null, 0);
    const mineSide = sideOfKey(subject) === side;
    const st = side === 'us' ? vs(standing.us, standing.them) : vs(standing.them, standing.us);
    const alive = !rnd.down.us.has(subject);
    const label = kind === 'plant'
      ? (!mineSide ? `Spike planted against you, ${vs(standing.us, standing.them)}` : by === subject ? `Planted the spike, ${st}` : `Spike planted, ${st}`)
      : (!mineSide ? `Spike defused against you, ${vs(standing.us, standing.them)}` : by === subject ? `Defused the spike, ${st}` : `Spike defused, ${st}`);
    return record(kind, ev, label, before, alive || by === subject);
  }

  // The round's end: what was left of the chance goes to whoever was still up
  // (a defuse nobody named, the timer, the spike going off, a save), and the
  // small result term to everyone who played it.
  function end(ev, before) {
    const won = ev.won === true ? 'us' : ev.won === false ? 'them' : null;
    let label = won === 'us' ? 'Round won' : won === 'them' ? 'Round lost' : null;
    if (won && !rnd.decided) {
      const p0 = chanceUs();
      if (p0 !== null) {
        const left = won === 'us' ? 1 - p0 : p0;
        share(won, left, null, 0);
        share(other(won), -left, null, 0);
        const usWon = won === 'us';
        const theyDefended = (rnd.side === 'defending') === usWon;
        if (!rnd.down.us.has(subject) && left >= W.DECIDED && rnd.side) {
          label = rnd.planted && theyDefended ? (usWon ? 'Round won, spike defused' : 'Round lost to the defuse')
            : rnd.planted ? (usWon ? 'Round won, the spike went off' : 'Round lost, the spike went off')
              : usWon ? 'Round won, held to the timer' : 'Round lost, alive at the end';
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
    return record('end', ev, label, before, !!label);
  }

  function push(ev) {
    if (!ev || typeof ev !== 'object') return null;
    const before = valueOf(subject);
    if (ev.kind === 'round') {
      startRound(num(ev.round) !== null ? ev.round : (rnd ? rnd.n + 1 : 1), ev.side, ev.satOut);
      credits.clear();
      const value = valueOf(subject);
      return { round: rnd.n, ms: null, kind: 'round', delta: round1(value - before), value, swing: 0, label: null };
    }
    // A round no 'round' event opened is opened by its first event.
    const n = num(ev.round);
    if (!rnd || (n !== null && n !== rnd.n)) startRound(n !== null ? n : (rnd ? rnd.n + 1 : 1), null, false);
    if (rnd.ended) return record(ev.kind, ev, null, before, false);
    if (ev.kind === 'kill') return kill(ev, before);
    if (ev.kind === 'plant' || ev.kind === 'defuse') return spike(ev.kind, ev, before);
    if (ev.kind === 'end') return end(ev, before);
    return null;
  }

  function snapshot() {
    return {
      version: VERSION,
      value: valueOf(subject),
      net: round3((players.get(subject) || { net: 0 }).net),
      rounds: subjectRounds,
      players: [...players.entries()].map(([key, p]) => ({
        key, side: sideOfKey(key), agent: agentOfKey(key, o.meAgent), value: valueOf(key), net: round3(p.net),
      })),
      timeline: timeline.map((e) => ({ ...e })),
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
 * plantMs, plantBy, defuseMs, defuseBy, feed: [{ ms, by, on, ka, va, w, as }] },
 * the feed in riot-rounds.js parse's shape (a card's riot.feed), `as` the
 * assisters as [{ by, a }] where a record names them, plantBy and defuseBy a
 * feed end ({ by, a }). Null for a round with no feed: it cannot be rated.
 */
function eventsOfRound(r) {
  if (!r || !Array.isArray(r.feed)) return null;
  const end = (x) => (x && typeof x === 'object' ? keyOf(x.by, x.a) : null);
  const timed = r.feed.map((k, i) => ({ t: num(k && k.ms), i, e: {
    kind: 'kill', round: r.n, ms: num(k && k.ms), killer: keyOf(k && k.by, k && k.ka), victim: keyOf(k && k.on, k && k.va),
    weapon: k && typeof k.w === 'string' ? k.w : null,
    ...(k && Array.isArray(k.as) ? { assists: k.as.map(end).filter(Boolean) } : {}),
  } }));
  const attackers = r.side === 'attacking' ? 'us' : r.side === 'defending' ? 'them' : null;
  if (num(r.plantMs) !== null) timed.push({ t: r.plantMs, i: -1, e: { kind: 'plant', round: r.n, ms: r.plantMs, by: end(r.plantBy) || attackers } });
  if (num(r.defuseMs) !== null) timed.push({ t: r.defuseMs, i: 1e6, e: { kind: 'defuse', round: r.n, ms: r.defuseMs, by: end(r.defuseBy) || other(attackers) } });
  // In time order, the feed's own order breaking ties and placing a kill with
  // no time, and a plant before a kill on the same ms.
  timed.sort((a, b) => (a.t === null || b.t === null ? a.i - b.i : (a.t - b.t) || (a.i - b.i)));
  return [
    { kind: 'round', round: r.n, side: r.side === 'attacking' || r.side === 'defending' ? r.side : null, satOut: r.satOut === true },
    ...timed.map((x) => x.e),
    { kind: 'end', round: r.n, won: typeof r.won === 'boolean' ? r.won : null },
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
 *     timeline: [{ round, ms, kind, delta, value, swing, label }],
 *     place: { n, of } or null, lobby: [{ side, agent, value, me }] or null }
 * The lobby is sides, agents and numbers, never a name, and only when every
 * kill named both ends by agent; otherwise place and lobby are null.
 */
function saved(snap, keyed) {
  const timeline = snap.timeline.filter((e) => e.label).map((e) => ({
    round: e.round, ms: e.ms, kind: e.kind, delta: e.delta, value: e.value, swing: e.swing, label: e.label,
  }));
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
  return { version: VERSION, value: snap.value, rounds: snap.rounds, timeline, place, lobby };
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
      plantMs: riot && num(riot.plantSec) !== null ? Math.round(riot.plantSec * 1000) : null,
      ...(riot && num(riot.defuseSec) !== null ? { defuseMs: Math.round(riot.defuseSec * 1000) } : {}),
      ...(riot && riot.plantBy && typeof riot.plantBy === 'object' ? { plantBy: riot.plantBy } : {}),
      ...(riot && riot.defuseBy && typeof riot.defuseBy === 'object' ? { defuseBy: riot.defuseBy } : {}),
      feed: riot && Array.isArray(riot.feed) ? riot.feed : null,
    };
  });
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
  const s = review.rating;
  if (s && typeof s === 'object' && typeof s.version === 'number' && typeof s.value === 'number') return { rating: s, why: null, note: null };
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

/** The k biggest gains and losses of a saved rating by swing, each with its label and round. */
function swings(rating, k) {
  const n = k || 3;
  const tl = rating && Array.isArray(rating.timeline) ? rating.timeline : [];
  const by = (e) => (typeof e.swing === 'number' ? e.swing : e.delta);
  return {
    gains: tl.filter((e) => by(e) > 0).sort((a, b) => (by(b) - by(a)) || (a.round - b.round)).slice(0, n),
    losses: tl.filter((e) => by(e) < 0).sort((a, b) => (by(a) - by(b)) || (a.round - b.round)).slice(0, n),
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

/**
 * WHAT THE PAGE IS SENT (served by valorant-review.js, never on disk): the
 * number, the line across the match by round, the three biggest gains and
 * losses, the place in the lobby, the lobby by agent, and every event for the
 * replay. Sides, agents, rounds and numbers only. With no rating, the line
 * that says what would give one, or null where nothing is said (League).
 *   opts.rounds  the match's rounds, so the line runs to the last one
 */
function viewOf(r, opts) {
  const o = opts || {};
  if (!r) return o.note ? { value: null, note: o.note } : null;
  const tl = Array.isArray(r.timeline) ? r.timeline : [];
  const last = Math.max(num(o.rounds) || 0, r.rounds || 0, ...tl.map((e) => e.round || 0));
  const after = new Map();
  for (const e of tl) after.set(e.round, e.value);
  const line = [{ n: 0, value: D.START }];
  let v = D.START;
  for (let n = 1; n <= last; n++) { if (after.has(n)) v = after.get(n); line.push({ n, value: v }); }
  const sw = swings(r, 3);
  const item = (e) => ({ round: e.round, label: e.label, delta: signed(typeof e.swing === 'number' ? deltaOf(e) : e.delta), up: (e.swing || e.delta) > 0 });
  return {
    version: r.version,
    value: r.value,
    shown: r.value.toFixed(1),
    place: placeLine(r.place),
    lobby: Array.isArray(r.lobby) ? r.lobby.map((p) => ({ side: p.side, agent: p.agent || null, value: p.value.toFixed(1), me: !!p.me })) : null,
    line,
    gains: sw.gains.map(item),
    losses: sw.losses.map(item),
    marks: [...sw.gains, ...sw.losses].map((e) => ({ round: e.round, up: (e.swing || e.delta) > 0 })),
    events: tl.map((e) => ({ round: e.round, kind: e.kind, label: e.label, value: e.value, delta: signed(e.delta) })),
    note: null,
  };
}
// A big move's size in the shown value: its delta when it moved a tenth,
// else the swing on the display's own scale near 6.0, so a list never says
// "+0.0" for a move it ranks among the biggest.
function deltaOf(e) {
  if (Math.abs(e.delta) >= 0.1) return e.delta;
  return (e.swing > 0 ? D.UP / D.A : D.DOWN / D.B) * e.swing;
}

module.exports = {
  VERSION, WP, W, D, LENGTHS, MIN_ROUNDS, WHY,
  winChance, display, lengthOf, createRating, eventsOfRound, fromRecord, roundsOfReview, lobbyOf, allKeyed,
  ratingOfReview, swings, ordinal, placeLine, keyOf, viewOf, signed,
};
