'use strict';

/**
 * FIGHT IT AGAIN (Nov 2026): which of the player's own deaths, from saved
 * Valorant reviews, the Trainer can replay, and what each replay is made of.
 * Pure: no DOM, no Electron, no file. Main requires it (trainer-store.js, the
 * review's view in index.js present()), the tests require it, and the Trainer
 * page could load it as a classic script (window.OcclaraTrainerReplay), as it
 * does trainer-math.js.
 *
 * NEVER INVENTED. A replay is built only from what a saved review already
 * holds about a death: Riot's record on the round's card (`riot`: the second,
 * the killer's agent, the gun, after the plant or not, the kill feed, the
 * killer's distance in metres where the record measured it, `dist`), the
 * round's side, the coach's look (`forensics.cause`), the review's own counted
 * mistakes and the player's flag. Every value nothing says is null, never a
 * guess, and a death that holds nothing beyond "died" is no replay.
 *
 * NOTHING OF ANYONE ELSE. No Riot ID, no player name, no position: the killer
 * is named only by an agent the game data knows, and only the distance between
 * the two ends of the kill is kept, as one number.
 *
 * In Node the game data (agents and their kit names) and death-causes.js's
 * recordCause are read once; on a page without `require` they are not, so the
 * page reads replays main built rather than building its own.
 */
(function (root, factory) {
  let deps = {};
  if (typeof module === 'object' && module.exports && typeof require === 'function') {
    try { deps.data = require('./valorant-data.generated.json'); } catch { deps.data = null; }
    try { deps.causes = require('./death-causes'); } catch { deps.causes = null; }
  }
  const api = factory(deps);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.OcclaraTrainerReplay = api;
})(typeof self !== 'undefined' ? self : this, function (deps) {
  const DATA = (deps && deps.data) || null;
  const CAUSES = (deps && deps.causes) || null;

  /** The shared scenario id every replay run is saved under, so they chart together. */
  const SCENARIO = 'replay';
  /** How many replays replaysOf hands back unless asked for another number. */
  const MAX_DEFAULT = 30;

  /*
   * EVERY VALORANT WEAPON TO ITS CLASS, by the name Riot's record and the game
   * data use, lower case. test:trainerreplay holds that every weapon in
   * valorant-data.generated.json has one. The Shorty is a sidearm in the game's
   * buy menu and a shotgun in the hand, so it is a shotgun here: what a replay
   * needs is the range it kills from.
   */
  const WEAPON_CLASS = {
    vandal: 'rifle', phantom: 'rifle', bulldog: 'rifle', guardian: 'rifle', warden: 'rifle',
    operator: 'sniper', marshal: 'sniper', outlaw: 'sniper',
    spectre: 'smg', stinger: 'smg',
    judge: 'shotgun', bucky: 'shotgun', shorty: 'shotgun',
    classic: 'pistol', ghost: 'pistol', sheriff: 'pistol', frenzy: 'pistol', bandit: 'pistol',
    odin: 'heavy', ares: 'heavy',
    melee: 'melee', knife: 'melee',
  };
  const CLASSES = ['rifle', 'sniper', 'smg', 'shotgun', 'pistol', 'heavy', 'melee', 'ability'];

  // Every agent's kit names (Headhunter, Tour De Force, Blade Storm...), which
  // Riot's record names as the "weapon" of a kill made with an ability.
  const KIT = new Set();
  const AGENTS = new Map();
  if (DATA && DATA.agents && typeof DATA.agents === 'object') {
    for (const [name, a] of Object.entries(DATA.agents)) {
      AGENTS.set(name.toLowerCase(), name);
      for (const k of (a && Array.isArray(a.kit) ? a.kit : [])) if (k && typeof k.name === 'string' && k.name) KIT.add(k.name.toLowerCase());
    }
  }

  /** A weapon's class by name: one of CLASSES, or null for no name or one nothing knows. */
  function weaponClass(name) {
    const t = typeof name === 'string' ? name.trim().toLowerCase() : '';
    if (!t) return null;
    if (WEAPON_CLASS[t]) return WEAPON_CLASS[t];
    return KIT.has(t) ? 'ability' : null;
  }

  /** The killer's agent as the game data spells it, or null: never a name the data does not know. */
  function agentOf(s) {
    const t = typeof s === 'string' ? s.trim().toLowerCase() : '';
    return (t && AGENTS.get(t)) || null;
  }

  /*
   * THE RANGE. From the killer's distance: under 10 m close, 10 to 25 m mid,
   * over 25 m long. With no distance, from the gun's class: a sniper kills
   * long; an SMG, a shotgun or the knife close; anything else, and no gun
   * known, mid.
   */
  const CLOSE_UNDER = 10;
  const LONG_OVER = 25;
  const RANGE_OF_CLASS = { sniper: 'long', smg: 'close', shotgun: 'close', melee: 'close' };
  function rangeOf(dist, cls) {
    if (typeof dist === 'number' && Number.isFinite(dist)) return dist < CLOSE_UNDER ? 'close' : dist > LONG_OVER ? 'long' : 'mid';
    return RANGE_OF_CLASS[cls] || 'mid';
  }

  /*
   * THE SITUATION a replay sets up, by the cause the coach's look gave the
   * death (death-causes.js CAUSES) or, with no look that says, the review's own
   * counted mistakes (insights.js keys) and the round's facts:
   *
   *   peek    the player went looking: a dry peek, a repeek, the first death
   *           of the round on attack, an overextend
   *   hold    the player was holding and was swung on: a crossfire, the same
   *           spot again, exposed on the spike, an early death
   *   rotate  moving or alone: rotating, isolated (caught alone), untraded
   *   duel    a fight: a lost duel, the same killer again, one against one,
   *           no escape, unclear, and any key this table does not name
   */
  const SITUATIONS = {
    'dry-peek': 'peek', 'repeek': 'peek', 'overextend': 'peek', 'first-death': 'peek',
    'crossfire': 'hold', 'same-spot': 'hold', 'exposed': 'hold', 'early': 'hold',
    'rotating': 'rotate', 'isolated': 'rotate', 'caught-alone': 'rotate', 'untraded': 'rotate',
    'lost-duel': 'duel', 'same-killer': 'duel', 'one-v-one': 'duel', 'no-escape': 'duel', 'unclear': 'duel',
  };
  const SITUATION_KINDS = ['peek', 'hold', 'rotate', 'duel'];
  /** A key's situation: SITUATIONS, or 'duel' for anything else. */
  function situationOf(key) {
    return (typeof key === 'string' && Object.prototype.hasOwnProperty.call(SITUATIONS, key)) ? SITUATIONS[key] : 'duel';
  }

  /*
   * WHICH FACT DECIDES, with no look: the most specific first, since nearly
   * every death is untraded and that says the least. The review's counted
   * lists decide same spot and same killer (insights.js holds their
   * thresholds); the card decides the rest.
   */
  const FACT_ORDER = ['first-death', 'same-spot', 'early', 'one-v-one', 'same-killer', 'caught-alone', 'untraded'];

  const fin = (v) => typeof v === 'number' && Number.isFinite(v);
  const sideOf = (c) => {
    const k = c && (c.sideKey || c.side);
    if (k === 'attacking' || k === 'Attack') return 'attack';
    if (k === 'defending' || k === 'Defence') return 'defence';
    return null;
  };
  const satOut = (c) => !!(c && (c.afk === true || c.inSpawn === true || (c.riot && (c.riot.afk === true || c.riot.inSpawn === true))));

  /** The rounds each of the review's counted mistakes names, by key. */
  function countedRounds(review) {
    const out = new Map();
    const list = review && review.insights && Array.isArray(review.insights.mistakes) ? review.insights.mistakes : [];
    for (const m of list) {
      if (!m || typeof m.key !== 'string' || !Array.isArray(m.rounds)) continue;
      out.set(m.key, new Set(m.rounds.filter((n) => Number.isInteger(n))));
    }
    return out;
  }

  /** The look's cause, as Riot's record has it (recordCause) where that code is at hand, or null. */
  function causeOf(c) {
    const look = c && c.forensics && typeof c.forensics === 'object' && typeof c.forensics.cause === 'string' ? c.forensics : null;
    if (!look) return null;
    let cause = look.cause;
    if (CAUSES && typeof CAUSES.recordCause === 'function') {
      try { const r = CAUSES.recordCause(look, c); if (r && typeof r.cause === 'string') cause = r.cause; } catch { /* the look as saved */ }
    }
    return CAUSES && CAUSES.CAUSES && !CAUSES.CAUSES[cause] ? null : cause;
  }

  /** The fact key that decides a death with no look, or null. */
  function factKeyOf(c, side, counted) {
    const rr = c.riot || {};
    const has = (k) => counted.has(k) && counted.get(k).has(c.n);
    const facts = {
      'first-death': rr.firstDeath === true && side === 'attack',
      'same-spot': has('same-spot'),
      'early': c.early === true,
      'one-v-one': !!(rr.clutch && rr.clutch.vs === 1),
      'same-killer': has('same-killer'),
      'caught-alone': has('caught-alone'),
      'untraded': rr.traded === false && !(rr.alive && fin(rr.alive.mates) && rr.alive.mates <= 1),
    };
    return FACT_ORDER.find((k) => facts[k]) || null;
  }

  /*
   * HOW MANY ENEMIES WERE IN THE FIGHT, 1 to 3: the one who killed the player,
   * and each other enemy the player killed in the FIGHT_MS before the death
   * (Riot's kill feed: an enemy the player killed that close was fighting
   * them), and at least two for a crossfire, which is two enemies by its
   * definition. 1 when nothing says more.
   */
  const FIGHT_MS = 3000;
  function enemiesOf(c, cause) {
    const feed = c.riot && Array.isArray(c.riot.feed) ? c.riot.feed.filter((e) => e && fin(e.ms)) : [];
    const death = feed.find((e) => e.on === 'me' && e.by === 'enemy');
    let n = 1;
    if (death) {
      const kills = feed.filter((e) => e.by === 'me' && e.on === 'enemy' && e.ms <= death.ms && death.ms - e.ms <= FIGHT_MS);
      n += kills.length;
    }
    if (cause === 'crossfire') n = Math.max(n, 2);
    return Math.min(3, n);
  }

  /** The player's flag on this round (review.deathFlags, or the card's view), with a death Riot confirms. */
  function flaggedOf(review, c) {
    if (c.flag && typeof c.flag === 'object' && !c.flag.noDeath) return true;
    const list = review && review.deathFlags && Array.isArray(review.deathFlags.rounds) ? review.deathFlags.rounds : [];
    return list.some((f) => f && f.n === c.n && !f.noDeath);
  }

  const ARTICLE = { rifle: 'a rifle', sniper: 'a sniper', smg: 'an SMG', shotgun: 'a shotgun', pistol: 'a pistol',
    heavy: 'a machine gun', melee: 'a knife', ability: 'an ability' };

  /** One plain sentence in the player's words, from the known facts only. */
  function lineOf(f) {
    let head = 'Killed';
    if (f.killer) head += ` by ${f.killer}${f.cls ? ` with ${ARTICLE[f.cls]}` : ''}`;
    else if (f.cls) head += ` by ${ARTICLE[f.cls]}`;
    const parts = [head];
    if (fin(f.dist)) parts[0] += f.dist < 5 ? ' up close' : ` from ${Math.round(f.dist)} metres`;
    if (f.afterPlant === true) parts.push('after the plant');
    else if (fin(f.sec) && f.sec >= 1) parts.push(`${Math.round(f.sec)} ${Math.round(f.sec) === 1 ? 'second' : 'seconds'} into the round`);
    if (f.side) parts.push(`on ${f.side}`);
    return `${parts.join(', ')}.`;
  }

  // A review id as review-store.js makes one (newId), and a replay's own ids.
  const REVIEW_ID_RE = /^[a-z]+-\d{10,}-[a-z0-9]{4,}$/;
  const OPEN_RE = /^replay:([a-z]+-\d{10,}-[a-z0-9]{4,}):(\d{1,3})$/;

  /** "replay:<reviewId>:<round>" as { reviewId, round, id }, or null. */
  function parseOpen(s) {
    const m = typeof s === 'string' ? OPEN_RE.exec(s) : null;
    if (!m) return null;
    const round = Number(m[2]);
    return round > 0 ? { reviewId: m[1], round, id: `${m[1]}:${round}` } : null;
  }

  /** What TRAINER_OPEN takes for a replay id ("<reviewId>:<round>"). */
  const openId = (id) => `replay:${id}`;

  /**
   * One death of a saved review as a replay, or null when it is none: not a
   * Valorant review, a locked one, no id, no such round, the player did not
   * die in it or sat it out, or nothing is known of the death beyond it.
   *
   * @param review  a saved Valorant review ({ id, at, kind, game, rounds, insights, deathFlags })
   * @param round   the round's number, or its card
   * @returns {null | { id, reviewId, round, at, map, agent, title, line, spec: {
   *   dist, range, killerWeapon, side, afterPlant, cause, situation, enemies, flagged } }}
   */
  function replayOf(review, round) {
    if (!review || typeof review !== 'object' || review.kind !== 'valorant' || review.locked === true) return null;
    if (typeof review.id !== 'string' || !REVIEW_ID_RE.test(review.id)) return null;
    const rounds = Array.isArray(review.rounds) ? review.rounds : [];
    const n = round && typeof round === 'object' ? round.n : round;
    if (!Number.isInteger(n) || n <= 0) return null;
    const c = rounds.find((x) => x && x.n === n);
    if (!c || c.died !== true || satOut(c)) return null;

    const rr = c.riot && typeof c.riot === 'object' ? c.riot : null;
    const dist = rr && fin(rr.dist) && rr.dist >= 0 ? Math.round(rr.dist * 10) / 10 : null;
    const cls = rr ? weaponClass(rr.weapon) : null;
    const killer = rr ? agentOf(rr.killer) : null;
    const sec = rr && fin(rr.sec) && rr.sec >= 0 ? rr.sec : null;
    const cause = causeOf(c);
    const knownCause = cause && cause !== 'unclear' ? cause : null;
    // Nothing beyond "died": no distance, no gun, no second, no killer, no cause.
    if (dist === null && !cls && sec === null && !killer && !knownCause) return null;

    const side = sideOf(c);
    const afterPlant = rr ? rr.afterPlant === true : null;
    const counted = countedRounds(review);
    const decides = knownCause || factKeyOf(c, side, counted);
    const at = fin(review.at) ? review.at : null;
    const game = review.game && typeof review.game === 'object' ? review.game : {};
    const id = `${review.id}:${n}`;
    return {
      id,
      reviewId: review.id,
      round: n,
      at,
      map: typeof game.map === 'string' && game.map ? game.map : null,
      agent: agentOf(game.agent),
      title: `Round ${n}`,
      line: lineOf({ killer, cls, dist, afterPlant, sec, side }),
      spec: {
        dist,
        range: rangeOf(dist, cls),
        killerWeapon: cls,
        side,
        afterPlant,
        cause,
        situation: situationOf(decides),
        enemies: enemiesOf(c, cause),
        flagged: flaggedOf(review, c),
      },
    };
  }

  /**
   * The cards a review's page paints, each death the Trainer can replay with
   * its replay's id as `replay` (what the row's Fight it again sends), every
   * other card as it was. Main runs it (index.js present), never mid match.
   *
   * @param review  the saved review, with its id
   * @param cards   the cards to paint (the served review's rounds)
   */
  function markRounds(review, cards) {
    if (!Array.isArray(cards)) return cards;
    return cards.map((c) => {
      if (!c || typeof c !== 'object' || c.died !== true) return c;
      let x = null;
      try { x = replayOf(review, c.n); } catch { x = null; }
      return x ? { ...c, replay: x.id } : c;
    });
  }

  /** A library entry ({ id, at, review }) or a review, as the review with its id and time. */
  function reviewOf(x) {
    if (!x || typeof x !== 'object') return null;
    if (x.review && typeof x.review === 'object') {
      return { ...x.review, id: x.review.id || x.id, at: fin(x.review.at) ? x.review.at : x.at };
    }
    return x;
  }

  /**
   * The replayable deaths of saved reviews: newest match first, the player's
   * flagged deaths first within a match, then by round, at most `opts.max`
   * (MAX_DEFAULT).
   *
   * @param reviews  saved reviews, or library entries { id, at, review }
   * @param opts     { max }
   */
  function replaysOf(reviews, opts) {
    const max = opts && Number.isInteger(opts.max) && opts.max > 0 ? Math.min(opts.max, 500) : MAX_DEFAULT;
    const list = (Array.isArray(reviews) ? reviews : []).map(reviewOf).filter(Boolean)
      .sort((a, b) => (fin(b.at) ? b.at : 0) - (fin(a.at) ? a.at : 0));
    const out = [];
    const seen = new Set();
    for (const r of list) {
      if (seen.has(r.id)) continue;
      seen.add(r.id);
      const mine = (Array.isArray(r.rounds) ? r.rounds : []).map((c) => replayOf(r, c)).filter(Boolean)
        .sort((a, b) => (b.spec.flagged - a.spec.flagged) || (a.round - b.round));
      for (const x of mine) {
        if (out.length >= max) return out;
        out.push(x);
      }
    }
    return out;
  }

  return {
    SCENARIO, MAX_DEFAULT, WEAPON_CLASS, CLASSES, SITUATIONS, SITUATION_KINDS, FACT_ORDER, CLOSE_UNDER, LONG_OVER, FIGHT_MS,
    weaponClass, rangeOf, situationOf, replayOf, replaysOf, markRounds, parseOpen, openId,
  };
});
