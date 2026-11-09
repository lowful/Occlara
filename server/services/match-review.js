'use strict';

/**
 * The Valorant post-match review, the half the model writes.
 *
 * The client computes everything that is arithmetic (src/shared/valorant-review.js
 * builds the round ledger, the patterns and the scoreline) and sends it here.
 * The model writes three things on top of it, and only these:
 *
 *   SUMMARY   three sentences on what decided the match for this player
 *   R<n>:     why a round went the way it did, for the rounds that teach most
 *   FOCUS:    one habit for the next match, tied to the pattern it fixes
 *
 * A LINE FORMAT, NOT JSON. The STATE contract already taught this codebase that
 * a structured reply fails silently when the model drifts; a labelled line
 * either parses or is dropped on its own, and one bad round line never costs
 * the summary.
 *
 * VARIANTS exist for the bench (npm run bench:review), which sends the same real
 * ledger through each and prints them side by side:
 *
 *   A  the old review: the tip list and observed notes, three or four sentences
 *   B  round aware: the ledger and the computed patterns
 *   C  B plus sourced playbook notes to draw the WHY from
 *
 * DEFAULT_VARIANT is whichever won that bench, and the reason is recorded there.
 *
 * No require from src/: check:server forbids it, and server/ is deployed alone.
 */

const knowledge = require('./knowledge');
const cases = require('./cases');
const forensics = require('./death-forensics');
const { promptName } = require('./languages');
const { noSemicolons } = require('./plain-text');
const abilityFacts = require('./ability-facts');
const gameClaims = require('./game-claims');

// "a Vandal", "an Outlaw". The prompt's own grammar is what the model copies,
// and "with a Outlaw" came back in its sentences. So is "1 assist", which the
// prompt printed as "1 assists".
const withArticle = (w) => `${/^[aeiou]/i.test(String(w)) ? 'an' : 'a'} ${w}`;
const counts = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

/*
 * C, BY A SMALL MARGIN, AND THE MARGIN IS GROUNDING.
 *
 * Measured with npm run bench:review on two real matches (a 24 round overtime
 * on Abyss and a 7 round swiftplay), two runs each, over three rounds of prompt
 * fixes. Once the replies parsed, B and C were close:
 *
 *   unsupported claims   B 7, C 4 across the last eight replies each (a kill
 *                        count, an ultimate nobody read, "damage")
 *   restating the read   B 44%, C 46% word overlap with the coach's own line
 *   foreign places       0 and 0 after the grader stopped misreading "B. You"
 *
 * A wrong sentence is the expensive failure in a review, so the variant that
 * made fewer of them wins even though it restates a little more. A, the old
 * review, never names a round because it is never told one, which is the whole
 * reason this module exists.
 *
 * What moved the numbers was not the variant but the instruction: asking each
 * round line for "what the read does not say" took restating from about 55% to
 * about 45% in both. That is still high, and it is the next thing to work on.
 */
const DEFAULT_VARIANT = 'C';
const MAX_ROUND_LINES = 10;

// What each computed pattern is ABOUT, as the playbook's own topic names. The
// study list is picked from these, so a match full of early deaths is sent to
// the notes about taking space in checkpoints, not to a random good habit.
const PATTERN_TOPICS = {
  early: ['checkpoints', 'planning the peek', 'acceleration', 'early aggression', 'tempo', 'movement'],
  spot: ['starting positions', 'anti strat', 'giving ground', 'planning the peek'],
  ult: ['ult economy', 'ult range'],
  streak: ['tilt', 'simplicity', 'have a plan'],
  // Not 'man advantage': the first bench put that note on rounds where nobody
  // knew how many players were alive, and the ledger never knows that.
  postplant: ['post plant'],
  retake: ['retake shape', 'contest or retake'],
};

/*
 * WHAT A DEATH'S CAUSE SENDS THE PLAYER TO STUDY (8.5.0, beside the
 * patterns'). The coach's look labels a death from a closed list (death-
 * forensics.js CAUSES), and a label two looks of a match share is a counted
 * mistake (`cause:repeek`, insights.js), which the summary and the focus
 * already name: the study notes now follow it. Every topic here is one the
 * playbook's notes carry, and check:playbook fails one that none does.
 * lost-duel, a fair fight lost on the shot, studies the peek and the stop
 * before the aim (8.7.2, it had no topics and a match of lost duels was sent
 * nothing), and unclear nothing at all.
 */
const CAUSE_TOPICS = {
  'dry-peek': ['planning the peek', 'filling utility', 'paint the picture'],
  isolated: ['checkpoints'],
  repeek: ['giving ground', 'planning the peek', 'movement'],
  crossfire: ['planning the peek', 'paint the picture'],
  rotating: ['rotating into the unknown', 'anchor or rotate', 'rotating with util'],
  overextend: ['checkpoints', 'tempo'],
  exposed: ['post plant', 'retake shape'],
  // A fair fight lost on the shot has the peek and the stop to study before
  // the aim (8.7.2): the lost duel checklist, the stop, and the peek method.
  'lost-duel': ['Lost duel checklist', 'Stop before the first shot', 'peek method before aim'],
};

const clip = (v, n) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, n);

/*
 * A READ ABOUT THE BUY PHASE, A MENU OR THE SPECTATOR CAMERA IS NOT PLAY, and
 * never reaches the prompt. The client now keeps a round's reads from play
 * alone (src/shared/valorant-rounds.js, NOT_PLAY, which this mirrors by hand
 * because check:server forbids reaching into src/; test:valorantreview holds
 * the two equal). A client from before that sends the first three notes of
 * each round, which at a read a second are its buy phase: the player's Sunset
 * swiftplay sent "standing in A Lobby during buy phase" and "player holding
 * Classic in spawn during buy phase" as what happened in round 1, and the
 * summary's repeated mistake was standing in spawn during the buy phase.
 */
const NOT_PLAY = /\b(buy|buying|bought|barriers?|menus?|overlay|scoreboard|combat report|death recap|damage (?:taken|dealt)|(?:big|full|large) map|map (?:is )?open|surrender|vote|kill ?cam|death ?cam|killed by|dead|died|death|spectat\w*|switch player|team ace|banner|eliminated|round (?:won|lost|over)|match point|before swap|victory|defeat)\b/i;

const listOf = (v, n) => (Array.isArray(v) ? v : []).slice(0, n).map((e) => ({
  key: clip(e && e.key, 30),
  title: clip(e && e.title, 80),
  detail: clip(e && e.detail, 220),
  rounds: (Array.isArray(e && e.rounds) ? e.rounds : []).filter((x) => Number.isInteger(x) && x > 0 && x <= 40).slice(0, 12),
  count: e && Number.isInteger(e.count) && e.count >= 0 && e.count <= 40 ? e.count : null,
})).filter((e) => e.title);

/*
 * ONE PLACE FOR A DEATH (8.7.10). Where Riot's record places a death (the
 * round's `place`, recordSent), that is the only place the model sees for
 * it: the round line says it, and the screen's spot goes. An 8.7.9 client
 * already sends Riot's as deathSpot, and a client before 8.7.9 sends no
 * place, so its rounds are as before, byte for byte. In the round 3 audit 14
 * of 8.7.9's 87 place mentions still followed the screen's spot, which on the
 * player's Split was Riot's place of the death before it (an 8.0.1 ledger a
 * round behind, valorant-verify.js screenLagged).
 *
 * A counted line about one place, the spot pattern ("2 of your 16 deaths were
 * at B Site, in rounds 5, 8.") and the same spot mistake ("Dying at B Site"),
 * is counted on the client, and a client before 8.7.10 counted it on the
 * screen's spot. One whose rounds Riot's record places somewhere else is a
 * count of places the record contradicts, and is left out of the prompt
 * rather than recounted here: a round the record has no place for agrees.
 */
const placeKey = (s) => String(s || '').toLowerCase().replace(/[^a-z]/g, '');
function onePlace(r) {
  return r.died && r.place ? { ...r, deathSpot: clip(r.place, 40) } : r;
}
const SPOT_PATTERN = /\bdeaths were at (.+?), in rounds? (\d+(?:(?:, | and )\d+)*)\.?\s*$/i;
const SAME_SPOT_TITLE = /^Dying at (.+)$/;
/** The place and rounds of a spot pattern, or null for any other pattern. */
function spotPatternOf(p) {
  const m = p && p.key === 'spot' ? SPOT_PATTERN.exec(p.text) : null;
  return m ? { place: m[1], rounds: m[2].split(/, | and /).map(Number) } : null;
}
/** The place and rounds of a counted same spot mistake, or null for any other. */
function sameSpotOf(e) {
  const m = e && e.key === 'same-spot' ? SAME_SPOT_TITLE.exec(e.title) : null;
  return m ? { place: m[1], rounds: e.rounds } : null;
}
/** Whether no round of a place line has a place of Riot's other than the line's. */
function spotAgrees(line, rounds) {
  if (!line) return true;
  const byN = new Map((rounds || []).map((r) => [r.n, r]));
  return line.rounds.every((n) => {
    const r = byN.get(n);
    return !r || !r.place || placeKey(r.place) === placeKey(line.place);
  });
}

/** The request body, bounded and typed, whatever a client sent. */
function normalise(body) {
  const b = body || {};
  const rounds = (Array.isArray(b.rounds) ? b.rounds : []).slice(0, 40).map((r) => ({
    n: Number(r && r.n) | 0,
    side: r && (r.side === 'attacking' || r.side === 'defending') ? r.side : null,
    result: r && (r.result === 'won' || r.result === 'lost') ? r.result : null,
    died: !!(r && r.died),
    deathSpot: r && r.deathSpot ? clip(r.deathSpot, 40) : null,
    timing: r && ['early', 'mid', 'late'].includes(r.timing) ? r.timing : null,
    planted: !!(r && r.planted),
    plantSpot: r && r.plantSpot ? clip(r.plantSpot, 40) : null,
    ultReady: !!(r && r.ultReady),
    reads: (Array.isArray(r && r.reads) ? r.reads : []).slice(0, 3).map((t) => clip(t, 220))
      .filter((t) => t && !NOT_PLAY.test(t)),
    // Riot's record, when the client could link the match. Exact facts.
    verified: !!(r && r.verified),
    sec: r && Number.isFinite(r.sec) && r.sec >= 0 && r.sec < 300 ? Math.round(r.sec) : null,
    killer: r && r.killer ? clip(r.killer, 20) : null,
    weapon: r && r.weapon ? clip(r.weapon, 20) : null,
    firstDeath: !!(r && r.firstDeath),
    firstKill: !!(r && r.firstKill),
    kills: r && Number.isInteger(r.kills) && r.kills >= 0 && r.kills <= 10 ? r.kills : null,
    // From Riot's kill feed: whether a teammate answered the death, and how
    // many were standing on each side when it happened.
    traded: r && typeof r.traded === 'boolean' ? r.traded : null,
    alive: r && r.alive && Number.isInteger(r.alive.mates) && Number.isInteger(r.alive.enemies)
      && r.alive.mates >= 1 && r.alive.mates <= 5 && r.alive.enemies >= 1 && r.alive.enemies <= 5
      ? { mates: r.alive.mates, enemies: r.alive.enemies } : null,
    // The coach's look at the frame before the death (death-forensics.js).
    cause: r && typeof r.cause === 'string' && forensics.CAUSES[r.cause] && r.cause !== 'unclear' ? r.cause : null,
    seen: r && r.seen ? clip(r.seen, 240) : null,
    // The numbers standing through the round, from Riot's kill feed (round
    // 3, valorant-review.js standingsOf), read by the state gate in parse()
    // and never by the prompt. Left out when the client sent none.
    ...(r && r.verified && standingsList(r.standings) ? { standings: standingsList(r.standings) } : {}),
    // The round record beyond the feed (8.8, valorant-review.js requestBody),
    // each left out when the client sent none, so a round from a client
    // before it is normalised as before, byte for byte.
    ...(r && r.verified ? recordSent(r, b.context && b.context.map) : {}),
    // The plant's time from Riot's record and Riot's afterPlant beside it
    // (the blind audit of round 7, valorant-review.js requestBody), for the
    // post plant gate alone (record-claims.js checkPostPlant). Only in a
    // planted round Riot verified, and left out when the client sent none,
    // so a round from a client before it is normalised as before.
    ...(r && r.verified && r.planted && Number.isFinite(r.plantSec) && r.plantSec >= 0 && r.plantSec < 300
      ? { plantSec: Math.round(r.plantSec * 10) / 10, ...(typeof r.afterPlant === 'boolean' ? { afterPlant: r.afterPlant } : {}) } : {}),
  })).filter((r) => r.n > 0).map(onePlace);
  // EIGHT, AND THE TEAM'S OWN TWO (8.8): the buys line is the last pattern a
  // client writes and the sides one of the last, so in a match with nine or
  // more the eight cut them and the line reached the page but never the
  // review or Ask Coach. Either past the eighth is kept, ten at most.
  const sentPatterns = Array.isArray(b.patterns) ? b.patterns : [];
  const patterns = sentPatterns.slice(0, 8).concat(sentPatterns.slice(8, 16).filter((p) => p && PAST_CUT.has(p.key))).slice(0, 10).map((p) => ({
    key: clip(p && p.key, 20),
    text: clip(p && p.text, 180),
  })).filter((p) => p.text && spotAgrees(spotPatternOf(p), rounds));
  const ctx = b.context || {};
  const final = b.final || {};
  return {
    rounds,
    patterns,
    // What the review counted (insights.js on the client), most serious first:
    // the summary's repeated mistake is the first of these, never one the model
    // finds for itself. Null from a client from before 8.3.1, which counts the
    // same lists on its own page and sends neither: "none cleared the bar"
    // would be a falsehood told to the model as true (promptRounds).
    mistakes: Array.isArray(b.mistakes) ? listOf(b.mistakes, 4).filter((m) => spotAgrees(sameSpotOf(m), rounds)) : null,
    strengths: Array.isArray(b.strengths) ? listOf(b.strengths, 4) : null,
    tips: (Array.isArray(b.tips) ? b.tips : []).slice(0, 30).map((t) => clip(t, 220)),
    notes: (Array.isArray(b.notes) ? b.notes : []).slice(0, 20).map((t) => clip(t, 90)),
    context: {
      agent: typeof ctx.agent === 'string' ? clip(ctx.agent, 20) : null,
      map: typeof ctx.map === 'string' ? clip(ctx.map, 20) : null,
      advancedTips: ctx.advancedTips === true,
      language: typeof ctx.language === 'string' ? clip(ctx.language, 8) : 'en',
      // The player's rank band (8.8, src/shared/rank-band.js), untrusted: one
      // of the four keys or left out, so a client that sends none is read as
      // before, byte for byte.
      ...(knowledge.validBand(ctx.rankBand) ? { rankBand: ctx.rankBand } : {}),
      // The enemy team's agents (8.8, Riot's comp on the client), agents
      // only and each one the game data knows, or left out, so a client that
      // sends none is read as before, byte for byte.
      ...(knowledge.enemiesOf(ctx.enemyAgents).length ? { enemyAgents: knowledge.enemiesOf(ctx.enemyAgents) } : {}),
    },
    final: {
      team: Number.isInteger(final.team) ? final.team : null,
      enemy: Number.isInteger(final.enemy) ? final.enemy : null,
      result: ['Victory', 'Defeat', 'Draw'].includes(final.result) ? final.result : null,
      verified: final.verified === true,
      scoreline: (() => {
        const s = final.scoreline || {};
        const n = (v, max) => (Number.isFinite(v) && v >= 0 && v <= max ? Math.round(v) : null);
        const out = { kills: n(s.kills, 99), deaths: n(s.deaths, 99), assists: n(s.assists, 99),
          acs: n(s.acs, 999), mvp: s.mvp === 'match' || s.mvp === 'team' ? s.mvp : null,
          // The headshot rate (round 3), only where the client sent one: the
          // aim evidence reads it, and a scoreline without it is as before.
          ...(n(s.headshotPct, 100) !== null ? { hs: n(s.headshotPct, 100) } : {}) };
        return out.kills !== null && out.deaths !== null ? out : null;
      })(),
    },
    variant: ['A', 'B', 'C'].includes(b.variant) ? b.variant : DEFAULT_VARIANT,
    // THE ROUND 3 CLIENT (valorant-review.js requestBody sends `swing`, an
    // array, every time): the match's swing as finished lines, and the mark
    // that the round 3 prompt rules and study list apply. A client before it
    // sends no `swing` and is reviewed as before, byte for byte.
    swing: Array.isArray(b.swing) ? b.swing.filter((t) => typeof t === 'string').slice(0, 3)
      .map((t) => noSemicolons(clip(t, 200))).filter((t) => t && !DASH.test(t)) : null,
    // THE ROUND 4 CLIENT (valorant-review.js requestBody sends `counts`, an
    // object, every time): what its card counted, and the mark that the round
    // 4 prompt rules apply. A client before it sends none and is reviewed as
    // before, byte for byte. The numbers the prompt quotes are this server's
    // own, from the rounds (matchCounts), never these.
    counts: b.counts && typeof b.counts === 'object' && !Array.isArray(b.counts) ? countsSent(b.counts) : null,
    // The counted mistakes the player's library finds again across their
    // recent matches (round 4), keys only. Missing is none repeated.
    recurring: Array.isArray(b.recurring) ? [...new Set(b.recurring.filter((k) => typeof k === 'string' && /^[a-z][a-z:-]{0,29}$/.test(k)))].slice(0, 8) : null,
  };
}

/*
 * THE ROUND RECORD A CLIENT OF 8.8 SENDS (valorant-review.js requestBody):
 * the team's buy by its word, the nearest teammate at the death as close or
 * far, the player's casts as kit names (an ability of the game data's, a
 * kit name and nothing else) with whole counts, and a round Riot says the
 * player sat out. Anything else is left out.
 */
const BUY_SENT = new Set(['pistol', 'eco', 'force', 'half', 'full']);
const KIT_NAMES = (() => {
  const out = new Map();
  let agents = {};
  try { agents = require('../valorant-data.generated.json').agents || {}; } catch { agents = {}; }
  for (const a of Object.values(agents)) {
    for (const k of (a && Array.isArray(a.kit) ? a.kit : [])) if (k && typeof k.name === 'string' && k.name) out.set(k.name.toLowerCase(), k.name);
  }
  return out;
})();
// The team's buy in a round line, in words the review's gate passes (BUY_BLAME drops any "buy").
const RECORD_BUY = { pistol: 'a pistol round', eco: 'an eco', force: 'a forced loadout', half: 'a half loadout', full: 'a full loadout' };
function recordSent(r, map) {
  const out = {};
  // Riot's callout of the death (8.8, valorant-review.js requestBody's
  // `place`), only as a place of this match's map, for the retrieval signals
  // (recordSignals), and the round line's deathSpot since 8.7.10 (onePlace).
  const place = r.died && typeof map === 'string' ? knowledge.placeOf(map, r.place) : null;
  if (place) out.place = place;
  // Where the player's kills fell (round 7, valorant-review.js requestBody),
  // so the screen's spot is never the death's place when it lies in another
  // region than every kill (placesKept, only where Riot has no place for the
  // death). Since round 8 kept whenever sent, a placed death and a round
  // survived too, so the round line says the kills' places apart from the
  // death's and the kill place gate reads them (record-claims.js
  // checkKillPlace): Sunset 4 to 13 round 7 gave the kill the death's place.
  if (typeof map === 'string' && Array.isArray(r.killPlaces)) {
    const kp = [...new Set(r.killPlaces.slice(0, 5).map((p) => knowledge.placeOf(map, p)).filter(Boolean))];
    if (kp.length) out.killPlaces = kp;
  }
  if (BUY_SENT.has(r.buy)) out.buy = r.buy;
  if (r.died && (r.mate === 'close' || r.mate === 'far')) out.mate = r.mate;
  const casts = (Array.isArray(r.casts) ? r.casts : []).slice(0, 4)
    .map((c) => (c && Number.isInteger(c.n) && c.n >= 0 && c.n <= 20 && typeof c.name === 'string' && KIT_NAMES.get(c.name.trim().toLowerCase())
      ? { name: KIT_NAMES.get(c.name.trim().toLowerCase()), n: c.n } : null)).filter(Boolean);
  if (casts.length) out.casts = casts;
  if (r.afk === true) out.afk = true;
  return out;
}

/** The counts a round 4 client sent, small integers only. */
function countsSent(c) {
  const out = {};
  for (const k of ['deaths', 'known', 'untraded', 'alone', 'tradeable', 'untradedMate']) {
    if (Number.isInteger(c[k]) && c[k] >= 0 && c[k] <= 60) out[k] = c[k];
  }
  return out;
}

/** The pattern keys kept past the eighth (normalise). */
const PAST_CUT = new Set(['buys', 'sides']);

const DASH = new RegExp(`[${String.fromCharCode(0x2013)}${String.fromCharCode(0x2014)}]`);

/** The standings a client sent for a round, [[mates, enemies], ...], or null. */
function standingsList(v) {
  if (!Array.isArray(v) || !v.length) return null;
  const out = v.slice(0, 12).filter((p) => Array.isArray(p) && p.length === 2
    && Number.isInteger(p[0]) && Number.isInteger(p[1]) && p[0] >= 0 && p[0] <= 5 && p[1] >= 0 && p[1] <= 5)
    .map((p) => [p[0], p[1]]);
  return out.length ? out : null;
}

/** Whether a review is from a client of the round 3 rules (normalise's `swing`). */
const round3 = (input) => !!(input && Array.isArray(input.swing));
/** Whether a review is from a client of the round 4 rules (normalise's `counts`), always one of round 3 too. */
const round4 = (input) => !!(input && round3(input) && input.counts);

/**
 * The side the player won less on, when both sides have three decided rounds
 * AND THE GAP IS TWO ROUNDS, the rule the review's sides pattern names a
 * stronger side by (valorant-review.js patterns, mirrored here since the
 * server reaches into no src/ file; test:valorantreview holds the two equal).
 * On any gap at all, the player's Sunset swiftplay, 1 of 4 on attack against
 * 1 of 3 on defence, had its study notes leaning to attack under a pattern
 * saying neither side was clearly stronger.
 */
function weakSide(rounds) {
  const decided = (side) => rounds.filter((r) => r.side === side && r.result);
  const atk = decided('attacking');
  const def = decided('defending');
  if (atk.length < 3 || def.length < 3) return null;
  const a = atk.filter((r) => r.result === 'won').length / atk.length;
  const d = def.filter((r) => r.result === 'won').length / def.length;
  // The rates' gap over a side of average length, in rounds.
  if ((Math.abs(a - d) * (atk.length + def.length)) / 2 < 2) return null;
  return a < d ? 'attack' : 'defense';
}

/*
 * THE ENEMY TEAM'S AGENTS (8.8, knowledge.js enemyFit): the comp a client of
 * this release sends (context.enemyAgents), and, for a client the route marks
 * (`input.byEnemy`, the version gate), the agents Riot's record says killed
 * the player, which are on the enemy team by definition and which every
 * linked review already sends. Agents only, never a name. A client before it
 * sends neither, and its notes and cases are chosen as before.
 */
function enemiesOf(input) {
  const ctx = (input && input.context) || {};
  const list = [...(ctx.enemyAgents || [])];
  if (input && input.byEnemy === true) {
    for (const r of input.rounds || []) if (r && r.verified && r.killer) list.push(r.killer);
  }
  return knowledge.enemiesOf(list);
}

/*
 * THE GUNS THAT KILLED THE PLAYER (round 3, knowledge.js enemyWeaponsOf):
 * Riot's record names the weapon of every verified death, and a note tagged
 * `enemyWeapons` (the enemy Operator holding a lane) is served only when one
 * of them is there. For a client the route marks (`byEnemy`), the same gate as
 * the killers; one before it has none, and no such note.
 */
function enemyWeaponsOf(input) {
  if (!input || input.byEnemy !== true) return [];
  return knowledge.enemyWeaponsOf((input.rounds || []).filter((r) => r && r.verified && r.died && r.weapon).map((r) => r.weapon));
}

/*
 * RIOT'S ROUND RECORD AS SIGNALS (8.8, knowledge.js recordSignals): the
 * team's buy, the nearest teammate at the death, Riot's callout of it and the
 * casts of each verified round a client of 8.8 sends (recordSent), as the
 * rows the signals are read from. A review whose rounds carry none of them
 * has no signal, and its notes, study list and cases are chosen as before.
 */
function recordSignalsOf(input) {
  const rows = (input && input.rounds || []).filter((r) => r && r.verified
    && (r.buy || r.mate || r.place || r.casts || r.afk)).map((r) => ({
    n: r.n, died: r.died, result: r.result, buy: r.buy || null, mate: r.mate || null, traded: r.traded,
    lastAlive: !!(r.alive && r.alive.mates <= 1), place: r.place || null, early: r.timing === 'early',
    casts: r.casts || null, afk: r.afk === true,
  }));
  return rows.length ? knowledge.recordSignals(rows) : null;
}

/*
 * WHAT THE RECORD'S SIGNALS SEND THE PLAYER TO STUDY (8.8), as the patterns'
 * and the causes' topics do: a callout died at again and again, the starting
 * spot notes (the spot pattern's own topics, PATTERN_TOPICS.spot, which the
 * client counts on the screen's places only); lone deaths, the isolated
 * cause's; deaths with no ability used, the dry peek's; and the team's
 * economy, the playbook's own notes for playing a save round and the force
 * loop. A full loadout lost has no imported note to study, and is served by
 * retrieve() through its `fullbuy` flag.
 */
const ECONOMY_TOPICS = { eco: ['save round plan', 'pickup and live'], forcebuy: ['the force loop'] };
function signalTopics(sig) {
  const out = new Set();
  if (!sig) return out;
  if (sig.repeatPlace) for (const t of PATTERN_TOPICS.spot) out.add(t);
  for (const c of sig.causes) for (const t of CAUSE_TOPICS[c] || []) out.add(t);
  for (const e of sig.economy) for (const t of ECONOMY_TOPICS[e] || []) out.add(t);
  return out;
}

/*
 * WHAT IS USUAL AT A LEVEL (round 3): a rough headshot rate for each band,
 * the line below which a match's rate is aim evidence. The audit's ten aim
 * questions were all answered "aim is not the problem", because aim could be
 * named only where a look called a fight fair and lost on the shot, and most
 * deaths have no look. A rate well below the band's is the player's own
 * number saying it. No band, the lowest band's line.
 */
const HS_USUAL = { iron_bronze: 14, silver_gold: 17, plat_diamond: 20, asc_plus: 23 };
const HS_BELOW = 5;

/** The aim evidence of a match: { low, hs, lostDuels }, or null where there is none. */
function aimEvidence(input) {
  const hs = input && input.final && input.final.scoreline && Number.isFinite(input.final.scoreline.hs) ? input.final.scoreline.hs : null;
  const band = knowledge.validBand(input && input.context && input.context.rankBand);
  const usual = HS_USUAL[band || 'iron_bronze'];
  const low = hs !== null && hs <= usual - HS_BELOW;
  const lostDuels = (input && input.rounds || []).filter((r) => r && r.cause === 'lost-duel').length;
  if (!low && !lostDuels) return null;
  return { low, hs, lostDuels };
}

/*
 * THE FOCUS LEVER (round 3), chosen in code. The FOCUS had to fix the first
 * counted mistake, and deaths nobody traded lead the list by weight in almost
 * every match: the trade habit was the focus of 20 of 24 reviews, at every
 * level, for entry duelists whose job is to go first. Now it may be the focus
 * only where those deaths really dominate (seven in ten, five at least) and
 * the player is Iron to Gold, or the level is unknown, or they are eight in
 * ten of the deaths, the player's own record showing it over and over.
 * Otherwise the prompt is told to choose the next biggest lever.
 */
function focusLever(input) {
  const untraded = (input.mistakes || []).find((m) => m && m.key === 'untraded');
  const band = knowledge.validBand(input.context && input.context.rankBand);
  const role = knowledge.roleOf(input.context && input.context.agent);
  let tradeOk = false;
  if (untraded) {
    const pair = countPairs(untraded.detail)[0];
    const [x, n] = pair ? pair.split('/').map(Number) : [untraded.count || 0, 0];
    const dominate = x >= 5 && n > 0 && x * 10 >= n * 7;
    const repeated = x >= 5 && n > 0 && x * 10 >= n * 8;
    tradeOk = dominate && (!band || band === 'iron_bronze' || band === 'silver_gold' || repeated);
  }
  return { untraded: !!untraded, tradeOk, entry: role === 'duelist' };
}

function leverRule(input, noTrade) {
  const lever = noTrade ? { ...focusLever(input), tradeOk: false } : focusLever(input);
  const entry = lever.entry
    ? ' The player plays a duelist, whose job is to go in first, so where the lesson is about who followed them in, teach their part of '
      + 'the entry, going in on a teammate\'s flash, drone or smoke or saying which teammate follows, never waiting for the team.'
    : '';
  if (lever.tradeOk) {
    return 'FOCUS LEVER: the deaths nobody traded dominate this match, so the habit of checking a teammate is close enough to kill '
      + 'your killer may be the focus, unless a swing fact above cost more rounds.' + entry;
  }
  return 'FOCUS LEVER: choose the one lever that would win this player the most rounds at their level, from the swing facts and '
    + 'the counted mistakes, and say why it matters.'
    + (lever.untraded ? ' Never make checking that a teammate can trade you the focus in this match: it is not what decides rounds '
      + 'here, so take the next biggest lever instead.' : '')
    + entry;
}

/*
 * ── ROUND 4 (Nov 2026): one block of numbers, a lever by level ─────────────
 *
 * From the live re-audit of 8.7.7 (the same 84 items): the trade habit opened
 * 9 of 10 "how do I improve" answers at every rank, Ascendant reviews got
 * worse (useful 2.25 to 2.17, 20 of 24 weak), four reviews said "13 of your
 * 15 deaths went unanswered" beside facts saying 16 deaths and 14 untraded,
 * a gate's drop left "Fight her with a teammate" with no her, a focus said
 * "so your next review can check", and an attacker with no plant was told to
 * let the enemy come to them. A client of the round 4 rules (round4,
 * normalise's `counts`) gets every rule below; one before it is reviewed
 * exactly as before.
 *
 * THE COUNTS, from this match's verified rounds by the card's own rule
 * (insights.js valorant: a death as the last one alive is no death a
 * teammate could trade). The card's 13 of 15 and the record's 14 of 16 are
 * both true, of different deaths, so the block says both and what separates
 * them, and the summary and the round lines may quote no other number.
 */
function matchCounts(input) {
  // A round Riot says the player sat out (8.8, normalise's afk, sent for
  // Riot's AFK and its stayed in spawn alike) is in no count: the block said
  // "14 of your 16 deaths" where the counted mistakes, which leave it out
  // since 8.7.9, said 12 of 14. The client's countsOf does the same.
  const v = ((input && input.rounds) || []).filter((r) => r && r.verified && !r.afk);
  const deaths = v.filter((r) => r.died);
  const known = deaths.filter((r) => typeof r.traded === 'boolean');
  const alone = (r) => !!(r.alive && r.alive.mates <= 1);
  const tradeable = known.filter((r) => !alone(r));
  return {
    rounds: v.length,
    deaths: deaths.length,
    known: known.length,
    untraded: known.filter((r) => r.traded === false).length,
    alone: known.filter(alone).length,
    tradeable: tradeable.length,
    untradedMate: tradeable.filter((r) => r.traded === false).length,
  };
}

/** The side and site records and the repeat killer of a match, from its verified rounds, as finished lines with their kinds. */
function matchFacts(input) {
  const v = ((input && input.rounds) || []).filter((r) => r && r.verified && r.side && r.result);
  const out = {};
  const won = (rs) => rs.filter((r) => r.result === 'won').length;
  const atk = v.filter((r) => r.side === 'attacking');
  const def = v.filter((r) => r.side === 'defending');
  const weak = weakSide(v);
  if (weak) {
    out.side = { weak, text: `You won ${won(atk)} of ${atk.length} rounds on attack and ${won(def)} of ${def.length} on defence.` };
  }
  const postAtk = atk.filter((r) => r.planted);
  if (postAtk.length >= 3 && won(postAtk) * 2 <= postAtk.length) {
    out.postplant = { text: `Once the spike was down on attack, your team won ${won(postAtk)} of ${postAtk.length} rounds.` };
  }
  const postDef = def.filter((r) => r.planted);
  if (postDef.length >= 3 && won(postDef) * 3 <= postDef.length) {
    out.retake = { text: `Once they planted on defence, your team won ${won(postDef)} of ${postDef.length} rounds.` };
  }
  // The player's own deaths, never in a round they sat out (8.8, as matchCounts).
  const deaths = v.filter((r) => r.died && !r.afk);
  const by = new Map();
  for (const r of deaths) if (r.killer) by.set(r.killer, (by.get(r.killer) || 0) + 1);
  const top = [...by.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0];
  if (top && top[1] >= 4 && top[1] * 10 >= deaths.length * 3 && knowledge.enemiesOf([top[0]]).length) {
    out.killer = { agent: knowledge.enemiesOf([top[0]])[0], text: `${knowledge.enemiesOf([top[0]])[0]} killed you ${top[1]} times, more than anyone else.` };
  }
  const early = deaths.filter((r) => r.sec !== null && r.sec <= 30 && !r.planted);
  if (early.length >= 4 && early.length * 10 >= deaths.length * 4) {
    out.tempo = { text: `${early.length} of your ${deaths.length} deaths came in the first 30 seconds of the round, before any plant.` };
  }
  return out;
}

/** The rounds Riot says the player sat out (8.8), in order. */
function satOutRounds(input) {
  return ((input && input.rounds) || []).filter((r) => r && r.verified && r.afk).map((r) => r.n).sort((a, b) => a - b);
}

/** The line that says which rounds the counts leave out, or null. */
function satOutLine(input) {
  const ns = satOutRounds(input);
  if (!ns.length) return null;
  const list = ns.length === 1 ? `round ${ns[0]}` : `rounds ${ns.slice(0, -1).join(', ')} and ${ns[ns.length - 1]}`;
  return `Riot marks you as sitting out ${list}, so ${ns.length === 1 ? 'it is' : 'they are'} left out of these counts.`;
}

/*
 * A ROUND THE PLAYER SAT OUT IS JUDGED NOWHERE (8.8). lineWorthy gives it no
 * line, and a summary or focus sentence that names it goes, unless the
 * sentence is the one that says it was sat out. Only the prompt asked the
 * model not to criticise it before, and code wins over the model. English
 * only, every client: a round named by number after "round", or as R7.
 */
// A run of rounds, "rounds 5 to 14", is the team's record (the run of lost
// rounds), not a judgement of one round in it, so it names none of them here.
// Replayed with each round of the 24 round 7 reviews forced AFK, it was the
// only kind of sentence the gate dropped that judged no round.
const SAT_OUT_RANGE = /\brounds?\s+\d{1,2}\s+(?:to|through)\s+\d{1,2}\b/gi;
const SAT_OUT_SAID = /\b(?:AFK|away from (?:the )?keyboard|sat (?:it |that round |this round )?out|sitting (?:it |that round |this round )?out|(?:stayed|in) (?:the |your )?spawn)\b/i;
function satOutGate(out, input) {
  if (promptName(input.context && input.context.language) !== 'English') return;
  const ns = new Set(satOutRounds(input));
  if (!ns.size) return;
  for (const n of Object.keys(out.rounds)) {
    if (!ns.has(Number(n))) continue;
    delete out.rounds[n];
    out.dropped.push({ n: Number(n), said: 'sat out round', riot: 'afk' });
  }
  for (const field of ['summary', 'focus']) {
    if (!out[field]) continue;
    const ss = splitSentences(out[field]).map((s) => s.trim()).filter(Boolean);
    const named = (s) => namedRounds(String(roundLabels(s)).replace(SAT_OUT_RANGE, ' ')).some((n) => ns.has(n));
    const kept = ss.filter((s) => !named(s) || SAT_OUT_SAID.test(s));
    if (kept.length === ss.length) continue;
    out.dropped.push({ n: null, said: `${field} sat out round`, riot: 'afk' });
    out[field] = kept.join(' ').trim() || null;
  }
}

/** The SWING AND COUNTS block's lines: the swing, the counts, the records, each once, in that order. */
function countLines(input) {
  const c = matchCounts(input);
  const lines = [...(input.swing || [])];
  const add = (t) => { if (t && !lines.includes(t)) lines.push(t); };
  if (c.deaths) add(`You died ${c.deaths} ${c.deaths === 1 ? 'time' : 'times'} in ${c.rounds} rounds.`);
  const out = satOutLine(input);
  if (out) add(out);
  if (c.known) add(`${c.untraded} of your ${c.known} deaths were not traded by a teammate within five seconds.`);
  if (c.alone && c.tradeable && c.tradeable < c.known) {
    add(`${c.alone} of those deaths came as the last player alive, when nobody was left to trade, so ${c.untradedMate} of your `
      + `${c.tradeable} deaths with a teammate alive to trade went unanswered.`);
  }
  const f = matchFacts(input);
  for (const k of ['side', 'postplant', 'retake', 'killer', 'tempo']) if (f[k]) add(f[k].text);
  return lines.slice(0, 9);
}

/*
 * THE CARD'S UNTRADED COUNT IN THE RECORD'S WORDS: "13 of your 15 deaths went
 * unanswered" leaves out the death as the last one alive, and a player who
 * died 16 times reads it as a wrong count. Where the two differ, the count
 * names the deaths it is of. Only that exact shape, only with these numbers.
 */
const QUALIFIED = 'with a teammate alive to trade';
const HAS_QUALIFIER = /\b(?:teammates? alive|last (?:player|one) (?:alive|standing)|could have been traded|a teammate could trade)\b/i;
function qualifyCount(text, input) {
  if (!text || !round4(input)) return text;
  const c = matchCounts(input);
  if (!(c.alone && c.tradeable && c.tradeable < c.known)) return text;
  const pair = new RegExp(`(?<![0-9])${c.untradedMate}\\s+(?:out\\s+)?of\\s+(?:your\\s+|the\\s+)?${c.tradeable}(?:\\s+deaths)?(?![0-9])`, 'g');
  return splitSentences(text).map((s) => (HAS_QUALIFIER.test(s) ? s
    : s.replace(pair, `${c.untradedMate} of your ${c.tradeable} deaths ${QUALIFIED}`))).join('').replace(/\s+/g, ' ').trim();
}

/** The counted mistakes as the round 4 prompt lists them: the untraded count named for the deaths it is of. */
function mistakesShown(input) {
  if (!input.mistakes || !round4(input)) return input.mistakes;
  return input.mistakes.map((m) => (m.key === 'untraded' ? { ...m, detail: qualifyCount(m.detail, input) } : m));
}

/** Every "N of M" the round 4 summary and round lines may quote: the block's, the counted mistakes' and the ledger's (round 8). */
function allowedPairs(input) {
  return new Set(countLines(input).flatMap((t) => countPairs(t))
    .concat((mistakesShown(input) || []).flatMap((m) => countPairs(m.detail)))
    .concat(countPairs(ledgerOf(input))));
}

/*
 * THE TRADES AND THE DISTANCE IN THE REVIEW (round 8, record-claims.js
 * tradeLedger): the player's deaths split by Riot's nearest teammate and the
 * trade, every count with its rounds, the match's and the early deaths', from
 * the verified rounds the client already sends, so every client gets it. A
 * round sat out is in none of it. '' where fewer than two deaths have a
 * trade known, and the prompt is as before.
 */
const LEDGER_HEAD_REVIEW = "THE TRADES AND THE DISTANCE (counted in code from Riot's record, the only counts of trades or of a teammate close the summary and the round lines may give, exactly as written here)";
function ledgerOf(input) {
  if (recordClaims === undefined) recordClaims = shared('./record-claims');
  const rc = recordClaims;
  if (!rc || typeof rc.tradeLedger !== 'function' || !input) return '';
  try { return rc.tradeLedger(rc.contextOfReview(input), { head: LEDGER_HEAD_REVIEW }) || ''; } catch { return ''; }
}

/*
 * THE LEVER BY LEVEL (round 4). Round 3 let the trade habit be the focus
 * only where those deaths dominate, and it still opened 13 of 24 reviews and
 * 9 of 10 answers at every rank. From Platinum it is the focus now only where
 * the player's library finds it again across recent matches (`recurring`,
 * sent by the client) AND this match's untraded deaths decided rounds (four
 * at least, and half the rounds lost with a death in them). Otherwise each
 * level is given its own kind of lever, from this match's numbers:
 *
 *   Iron, Bronze   the basic habit: the trade, the first fight's timing
 *   Silver, Gold   the matchup, then the trade, the first death
 *   Plat, Diamond  a decision: the post plant, the retake, the advantage
 *   Ascendant up   the side or site gap, the tempo, a repeated decision
 *
 * The first kind this match has a fact for is the lever; none, and the round
 * 3 rule stands. No band is the round 3 rule, as before.
 */
const LEVER_ORDER = {
  iron_bronze: ['trade', 'tempo', 'first-death', 'killer'],
  silver_gold: ['killer', 'trade', 'first-death', 'tempo', 'postplant', 'retake'],
  plat_diamond: ['postplant', 'retake', 'advantage', 'killer', 'decision', 'side', 'first-death', 'tempo', 'trade'],
  asc_plus: ['side', 'tempo', 'decision', 'advantage', 'postplant', 'retake', 'killer', 'first-death', 'trade'],
};
const HIGH_BANDS = new Set(['plat_diamond', 'asc_plus']);

function leverOf(input) {
  if (!round4(input)) return null;
  const band = knowledge.validBand(input.context && input.context.rankBand);
  if (!band) return null;
  const mistakes = input.mistakes || [];
  const has = (key) => mistakes.find((m) => m && m.key === key) || null;
  const facts = matchFacts(input);
  const untraded = has('untraded');
  let tradeOk = false;
  if (untraded) {
    if (HIGH_BANDS.has(band)) {
      const lost = (input.rounds || []).filter((r) => r.verified && r.result === 'lost' && r.died);
      const decided = lost.filter((r) => r.traded === false && !(r.alive && r.alive.mates <= 1)).length;
      tradeOk = (input.recurring || []).includes('untraded') && decided >= 4 && decided * 2 >= lost.length;
    } else tradeOk = focusLever(input).tradeOk;
  }
  const decision = mistakes.find((m) => m && /^cause:/.test(m.key || '') && m.key !== 'cause:unclear' && forensics.CAUSES[m.key.slice(6)]) || null;
  const found = {
    trade: tradeOk ? { text: qualifyCount(untraded.detail, input) } : null,
    'first-death': has('first-death') ? { text: has('first-death').detail } : null,
    advantage: has('lost-advantage') ? { text: has('lost-advantage').detail } : null,
    decision: decision ? { text: decision.detail, cause: decision.key.slice(6) } : null,
    ...facts,
  };
  // From Platinum, a trade habit the library finds again and this match
  // decided on leads: it is the player's own record over and over.
  const order = HIGH_BANDS.has(band) && tradeOk ? ['trade', ...LEVER_ORDER[band]] : LEVER_ORDER[band];
  for (const kind of order) if (found[kind]) return { kind, band, ...found[kind] };
  return null;
}

const LEVER_TEACH = {
  trade: 'the habit of checking a teammate is close enough to kill your killer before the fight',
  'first-death': 'taking first contact only on a teammate\'s flash, drone or smoke, or with one following close',
  advantage: 'playing a numbers advantage: the fight the round did not need, and holding what the team has',
  decision: 'the decision the coach\'s look saw more than once, and what to do instead',
  postplant: 'where the team plays after the plant and who watches the spike, with the clock',
  retake: 'the retake: when to save, when to group, and the way back onto the site',
  side: 'what to change on the weaker side, with its numbers',
  killer: 'that agent: where they play, what their abilities do as their lines under WHAT THE ABILITIES DO say, and the fight to take against them',
  tempo: 'the timing of the first fight: when to take it and when to let the team\'s first contact or utility go first',
};

function leverRule4(input, lever) {
  const untraded = (input.mistakes || []).some((m) => m && m.key === 'untraded');
  const entry = focusLever(input).entry && (lever.kind === 'trade' || lever.kind === 'first-death')
    ? ' The player plays a duelist, whose job is to go in first, so teach their part of the entry, going in on a teammate\'s flash, '
      + 'drone or smoke or saying which teammate follows, never waiting for the team.' : '';
  return `FOCUS LEVER: ${lever.text} Make the FOCUS about ${LEVER_TEACH[lever.kind]}, and say why it wins rounds here.`
    + (lever.kind !== 'trade' && untraded ? ' Never make checking that a teammate can trade you the focus in this match: it is not '
      + 'what decides rounds at this level here.' : '')
    + entry;
}

/*
 * THE DEPTH OF A HIGH LEVEL REVIEW (round 4): the judges at Platinum and up
 * asked for the match's own numbers and a trade off, and got "check a
 * teammate is close" in four lines. One fundamentals habit at most, and
 * parse() holds it (fundamentalsCap).
 */
function depthRule(band) {
  if (!HIGH_BANDS.has(knowledge.validBand(band))) return '';
  return 'DEPTH: at this level reason from this match\'s own numbers in the SWING AND COUNTS block, the side split, the post plant '
    + 'and retake record, the repeat killer or gun, and in the focus and at least one round line say the trade off, what the play '
    + 'gains and what it costs. Name at most one fundamentals habit in the whole review, such as a teammate close enough to kill '
    + 'your killer, stopping before the shot or one angle at a time, and only where the rounds show it missing.\n\n';
}

/*
 * WHAT THE ABILITIES DO (round 4, ability-facts.js kitLines, the look's
 * block): the player's agent and the two agents who killed them most, in the
 * game's own words. The review had only the names and wrote "Undercut checks
 * the angle" after the look did. '' when no agent is known.
 */
function kitAgents(input) {
  const by = new Map();
  for (const r of input.rounds || []) if (r && r.verified && r.died && r.killer) by.set(r.killer, (by.get(r.killer) || 0) + 1);
  const killers = [...by.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 2).map((e) => e[0]);
  return [input.context && input.context.agent, ...knowledge.enemiesOf(killers)].filter(Boolean);
}
function kitBlockOf(input) {
  if (typeof abilityFacts.kitLines !== 'function') return '';
  let lines = [];
  try { lines = abilityFacts.kitLines(kitAgents(input)) || []; } catch { lines = []; }
  lines = lines.map((t) => noSemicolons(t)).filter((t) => t && !DASH.test(t));
  if (!lines.length) return '';
  return `\n\nWHAT THE ABILITIES DO, in the game's own words. Say of an ability only what its line says:\n${lines.map((t) => '- ' + t).join('\n')}`;
}

/*
 * THE STUDY LIST AND THE CASES FOLLOW THE SWING (round 4): a post plant the
 * team kept losing sends the player to the post plant notes, a retake that
 * collapsed to the retake notes, a run of early deaths to the first fight's
 * notes, and the agent who killed them most to the notes that answer that
 * agent. The match's own facts, so another match is sent elsewhere.
 */
const SWING_TOPIC_KINDS = { postplant: 'postplant', retake: 'retake', tempo: 'early' };
const SWING_BONUS = 3;
// A swing topic's weight: wanted (+5) and the swing's own (SWING_BONUS).
const MATCHUP_BONUS = 8;
function swingTopics(input) {
  const out = new Set();
  if (!round4(input)) return out;
  const f = matchFacts(input);
  for (const [kind, pattern] of Object.entries(SWING_TOPIC_KINDS)) if (f[kind]) for (const t of PATTERN_TOPICS[pattern]) out.add(t);
  if ((input.swing || []).some((t) => /\brounds in a row\b/.test(t))) for (const t of PATTERN_TOPICS.streak) out.add(t);
  return out;
}

/** What retrieve() is told of the lever's moment (round 4): the post plant, the retake, the weaker side. {} otherwise. */
function leverSituation(input) {
  const lever = leverOf(input);
  if (!lever) return {};
  if (lever.kind === 'postplant') return { phase: 'postplant', side: 'attack' };
  if (lever.kind === 'retake') return { phase: 'postplant', side: 'defense' };
  if (lever.kind === 'side') return { side: lever.weak };
  return {};
}

/** The review's case situation (cases.fromReview), with the swing's phases and the repeat killer first for a round 4 client. */
function caseSituation(input, enemies) {
  const x = cases.fromReview(input, enemies);
  // Riot's round record (8.8): deaths on an eco and lone deaths are the
  // match's, as a look's cause is. No record, the situation as before.
  const sig = recordSignalsOf(input);
  if (sig) {
    for (const e of sig.caseEconomies) x.economies.add(e);
    for (const c of sig.causes) x.causes.add(c);
    // A cause the record rules out (round 8): no isolation case where the
    // deaths nobody traded had a teammate close and none far.
    if (Array.isArray(sig.ruledOut) && sig.ruledOut.length) {
      x.ruledOut = sig.ruledOut.slice();
      for (const c of sig.ruledOut) x.causes.delete(c);
    }
  }
  if (!round4(input)) return x;
  const f = matchFacts(input);
  if (f.postplant) { x.phases.add('postplant'); if (!x.patterns.includes('postplant')) x.patterns.push('postplant'); }
  if (f.retake) { x.phases.add('retake'); if (!x.patterns.includes('retake')) x.patterns.push('retake'); }
  if (f.killer && x.enemies.includes(f.killer.agent)) x.enemies = [f.killer.agent, ...x.enemies.filter((a) => a !== f.killer.agent)];
  return x;
}

/*
 * THE STUDY LIST TURNS BY THE MATCH (round 3): up to STUDY_VARIETY points
 * from a hash of the note and the match's seed (cases.reviewSeed, the body
 * has no match id), so near ties go another way in another match and the
 * same way every time for one match. The hash is FNV with a final mix:
 * without it two notes differing in their last words drew nearly the same.
 */
const STUDY_VARIETY = 2.5;
function spread(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b) >>> 0;
  h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35) >>> 0;
  h ^= h >>> 16;
  return (h >>> 0) / 0x100000000;
}

/*
 * A STUDY NOTE THE REVIEW'S OWN ADVICE CONTRADICTS IS LEFT OUT (round 3),
 * only where it is certain: the audit served "As a duelist after the plant,
 * show presence deep on their side" beside the review's own round line to
 * hold the spike from cover near a teammate. A pair is a note about the
 * moment after the plant that sends the player forward, and a round line or
 * focus about the spike that holds them back. Nothing else is judged.
 */
const CONTRADICTS = [
  {
    about: /\b(?:after the plant|post plant|once the spike|spike is (?:down|planted))\b/i,
    note: /\b(?:presence deep|deep on their side|push (?:forward|up)|go forward|play forward|hunt (?:them|for)|chase)\b/i,
    line: /\b(?:hold (?:the spike |it |the plant )?(?:from|behind) cover|play (?:off|near|around) the spike|(?:stay|stand|hold|play) (?:near|with|beside|close to) (?:a|your) teammate|fall back|let them come|make them come)\b/i,
    lineAbout: /\b(?:spike|plant|planted)\b/i,
  },
];
function contradicted(note, topic, lines) {
  return CONTRADICTS.some((c) => (c.about.test(note.text) || c.about.test(topic)) && c.note.test(note.text)
    && lines.some((l) => c.lineAbout.test(l) && c.line.test(l)));
}

// retrieve() counts its reserve out of the eight notes it serves
// (knowledge.ADVANCED_SLOTS, knowledge.STREAK_CORE_SLOTS).
const RESERVE_OF = 8;

/**
 * The notes worth reading before the next match.
 *
 * Only the imported notes, the ones carrying a source.topic, because the topic
 * is what a pattern sends the player to (PATTERN_TOPICS). Weapon notes are left
 * out because the gun changes round to round and a review cannot know which one
 * to study. The agent, role and map filters are the same exclusions retrieve()
 * applies, so a Sova note never reaches a Jett.
 *
 * A NOTE GOES OUT AS ITS TEXT AND NOTHING ELSE. Where it came from is never
 * said, on the study card or anywhere else in the app (check:attribution).
 *
 * ADVANCED COACHING SHAPES THIS LIST as it shapes retrieve()'s. Off, it is core
 * notes only: a player who never asked for damage breakpoints is not handed one
 * as homework. On, it is retrieve()'s reserve at study's scale: advanced notes
 * get the share of the slots they get there, six of eight, rounded down so a
 * core note always survives, and a match lost in a run of rounds (the streak
 * pattern) gives core the majority back, as a death streak does there.
 *
 * BY CAUSE TOO, FOR A CLIENT OF 8.5.0 OR LATER (`input.byCause`, which the
 * route sets by the version gate, clientAtLeast): a counted `cause:` mistake's
 * topics weigh as a pattern's (+5), and a single death the coach looked at
 * gives its cause's topics +2 (CAUSE_TOPICS). A client before 8.5.0 is listed
 * its notes as today, byte for byte.
 */
/*
 * THE STUDY LIST FROM PLATINUM FOLLOWS WHAT THE DEATHS COST (the blind audit
 * of 8.7.9): the diamond and immortal judges read the same three or four
 * notes pasted across different matches. The costliest death sends the player
 * to its moment, the second to its own at half the weight: after the plant on
 * attack to the post plant, on defence to the retake, an advantage given back
 * to playing the numbers, a death that left the team a player down as the
 * first contact, an untraded one to playing off a teammate, the look's cause
 * to its topics. Topic -> weight, empty below Platinum or for a client before
 * round 4.
 */
const COST_BONUS = 6;
const COST_TOPICS = {
  postplant: ['post plant', 'post plant layers', 'the spike tells you the time'],
  retake: ['retake shape', 'contest or retake'],
  even: ['man advantage', 'alive count sets risk', 'keep the won space', 'two versus one as a pair'],
  // The commonest costly death, the round's first, a player down: its topics
  // by side and at a third of the weight, so it never fills the list alone
  // (it sent every duelist to the same entry note).
  downAttack: ['do not entry into a stack', 'a timing peek is short', 'entry is a four on five'],
  downDefence: ['early aggression needs a purpose', 'who may push early on defense', 'one information play on defence'],
  untraded: ['Offset from your teammate', 'Peek off a teammate contact'],
};
function costTopics(input) {
  const out = new Map();
  const c = costOf(input);
  if (!c || !c.ranked.length) return out;
  const byN = new Map((input.rounds || []).map((r) => [r.n, r]));
  const put = (ts, w) => { for (const t of ts) if (!out.has(t) || out.get(t) < w) out.set(t, w); };
  c.ranked.slice(0, 2).forEach((x, i) => {
    const w = i === 0 ? COST_BONUS : COST_BONUS / 2;
    if (x.plant === 'after') put(x.side === 'defence' ? COST_TOPICS.retake : COST_TOPICS.postplant, w);
    if (x.even) put(COST_TOPICS.even, w);
    if (x.down) put(x.side === 'defence' ? COST_TOPICS.downDefence : COST_TOPICS.downAttack, w / 3);
    if (x.untraded && !x.down) put(COST_TOPICS.untraded, w / 2);
    const r = byN.get(x.n);
    if (r && r.cause) put(CAUSE_TOPICS[r.cause] || [], w);
  });
  return out;
}
/** The costliest deaths' killers, for the notes that answer them (+COST_BONUS / 2 in study). */
function costKillers(input) {
  const c = costOf(input);
  if (!c || !c.ranked.length) return new Set();
  const byN = new Map((input.rounds || []).map((r) => [r.n, r]));
  return new Set(c.ranked.slice(0, 2).map((x) => byN.get(x.n)).filter((r) => r && r.killer).map((r) => r.killer));
}
/*
 * A NOTE THE REVIEW ALREADY SAYS: three in five of its content words are one
 * round line's or the focus's, five at least.
 */
const STUDY_STOP = new Set(['that', 'this', 'with', 'your', 'from', 'when', 'then', 'they', 'them', 'their', 'there', 'what', 'have', 'into',
  'before', 'after', 'because', 'rather', 'than', 'until', 'while', 'where', 'which', 'would', 'could', 'should', 'only', 'just', 'also',
  'even', 'every', 'each', 'more', 'most', 'some', 'like', 'take', 'make', 'over', 'away', 'back', 'about', 'other', 'once', 'next']);
const contentWords = (t) => new Set(String(t || '').toLowerCase().replace(/[^a-z' ]/g, ' ').split(/\s+/).filter((w) => w.length >= 4 && !STUDY_STOP.has(w)));
function repeats(note, lines) {
  const a = contentWords(note);
  if (a.size < 5) return false;
  return lines.some((l) => {
    const b = contentWords(l);
    let shared = 0;
    for (const w of a) if (b.has(w)) shared += 1;
    return shared >= 5 && shared * 5 >= Math.min(a.size, b.size) * 3;
  });
}

function study(input, limit = 3, opts = {}) {
  const { context, patterns, rounds } = input;
  const s = knowledge.situationOf({ agent: context.agent, map: context.map });
  const wanted = new Set();
  for (const p of patterns) for (const t of PATTERN_TOPICS[p.key] || []) wanted.add(t);
  // ROUND 3, for a client of the round 3 rules alone (round3, normalise's
  // `swing`): aim evidence (a headshot rate well below the level's, or a
  // look's lost duel) sends the player to the aim notes as a counted lost
  // duel does, the notes turn by the match's seed, and a note the review's
  // own round advice contradicts is left out (opts.lines). A client before it
  // is listed its notes as before, byte for byte.
  const r3 = round3(input);
  if (r3 && aimEvidence(input) && aimEvidence(input).low) for (const t of CAUSE_TOPICS['lost-duel']) wanted.add(t);
  const seed = r3 ? cases.reviewSeed(input) : null;
  // ROUND 4, for a client of its rules alone (round4): the swing's topics
  // are wanted and weigh SWING_BONUS more, the agent who killed the player
  // most brings the notes that answer that agent, and from Platinum, with a
  // lever that is not the trade, a trade note weighs less. A client before
  // it is listed its notes as before, byte for byte.
  const r4 = round4(input);
  const swingWanted = swingTopics(input);
  for (const t of swingWanted) wanted.add(t);
  const r4facts = r4 ? matchFacts(input) : {};
  const matchup = r4facts.killer ? r4facts.killer.agent : null;
  const lever4 = r4 ? leverOf(input) : null;
  // FROM PLATINUM, THE COSTLIEST DEATHS CHOOSE TOO (costTopics, the blind
  // audit of 8.7.9): the topics of the two deaths that cost the most weigh
  // COST_BONUS and half of it, and a note that says again what a round line or
  // the focus already says is left out (repeats). Below Platinum, as before.
  const costWeights = costTopics(input);
  for (const [t, w] of costWeights) if (w >= COST_BONUS / 2) wanted.add(t);
  const costBy = costKillers(input);
  // Riot's round record (8.8, signalTopics): a callout died at again and
  // again, lone deaths, deaths with no ability used and the team's economy
  // want their notes as a pattern does. No record, no topic.
  for (const t of signalTopics(recordSignalsOf(input))) wanted.add(t);
  const looked = new Set();
  if (input.byCause === true) {
    for (const m of input.mistakes || []) {
      const c = /^cause:(.+)$/.exec(String((m && m.key) || ''));
      if (c) for (const t of CAUSE_TOPICS[c[1]] || []) wanted.add(t);
    }
    for (const r of rounds || []) if (r && r.cause) for (const t of CAUSE_TOPICS[r.cause] || []) looked.add(t);
  }
  const weak = weakSide(rounds);
  const advancedOn = context.advancedTips === true;
  // THE RANK BAND (8.8, knowledge.js rankAdjust): a note above the player's
  // band is never homework, one narrowed to it is +2, one for lower bands only
  // is -3 unless this match points to it (its topic is wanted or looked at,
  // or it answers a cause of these deaths). No band changes nothing.
  const band = knowledge.validBand(context.rankBand);
  const causesHere = new Set();
  if (band) {
    for (const m of input.mistakes || []) {
      const c = /^cause:(.+)$/.exec(String((m && m.key) || ''));
      if (c) causesHere.add(c[1]);
    }
    for (const r of rounds || []) if (r && r.cause) causesHere.add(r.cause);
  }

  // A note for the enemy's agents (8.8) only against them, never blind, and
  // one for the enemy's gun (round 3) only where Riot says it killed them.
  const enemies = enemiesOf(input);
  const guns = enemyWeaponsOf(input);
  const advice = r3 && Array.isArray(opts.lines) ? opts.lines.filter((t) => typeof t === 'string' && t) : [];

  const scored = [];
  for (const note of knowledge.all()) {
    const src = note.source;
    if (!src || typeof src.topic !== 'string' || !src.topic) continue;
    if (note.weapons) continue;
    const versus = knowledge.enemyFit(note, enemies, guns);
    if (versus === null) continue;
    if (advice.length && contradicted(note, src.topic, advice)) continue;
    if (costWeights.size && advice.length && repeats(note.text, advice)) continue;
    if (note.agents && (!s.agent || !note.agents.some((a) => a.toLowerCase() === s.agent.toLowerCase()))) continue;
    if (note.roles && (!s.role || !note.roles.includes(s.role))) continue;
    if (note.maps && (!s.map || !note.maps.some((m) => m.toLowerCase() === s.map))) continue;
    const advanced = note.tier === 'advanced';
    if (advanced && !advancedOn) continue;
    const ranked = band ? knowledge.rankAdjust(note, band, wanted.has(src.topic) || looked.has(src.topic)
      || (Array.isArray(note.cause) && note.cause.some((c) => causesHere.has(c)))) : 0;
    if (ranked === null) continue;
    let score = note.weight || 1;
    score += ranked;
    score += versus;
    // A role note carries its role's agent list so retrieve() reaches it
    // (docs/claude/playbook.md), but to the study list it is still a role
    // note (8.7.2): counted as both, the two checkpoints notes outscored every
    // pattern and every cause, and a player read the same homework in 7 of 8
    // reviews. An agent's own note keeps its +4.
    if (note.agents && !note.roles) score += 4;
    else if (note.roles) score += 2;
    if (note.maps) score += 3;
    if (wanted.has(src.topic)) score += 5;
    else if (looked.has(src.topic)) score += 2;
    if (note.side && weak && note.side === weak) score += 2;
    if (note.side && weak && note.side !== weak) score -= 2;
    // The match's own turn of near ties (round 3), as the cases have: 21
    // notes filled all 72 study slots of the audit's 24 reviews, one of them
    // in 13 of the 18 above Iron. The same match always gets the same list.
    if (seed) score += STUDY_VARIETY * spread(`${note.text}|${seed}`);
    if (r4) {
      if (swingWanted.has(src.topic)) score += SWING_BONUS;
      const answers = [...(note.enemyAgents || []), ...(note.enemyHint || [])];
      if (matchup && answers.includes(matchup)) score += MATCHUP_BONUS;
      if (lever4 && lever4.kind !== 'trade' && HIGH_BANDS.has(band) && TRADE_NOTE.test(note.text)) score -= 2;
      if (costWeights.has(src.topic)) score += costWeights.get(src.topic);
      if (costBy.size && answers.some((a) => costBy.has(a))) score += COST_BONUS / 2;
    }
    scored.push({ text: note.text, topic: src.topic, advanced, score, fit: ranked === knowledge.RANK_FIT });
  }
  scored.sort((a, b) => b.score - a.score);

  // One per topic, so three notes are three different things to work on.
  const out = [];
  const topics = new Set();
  const take = (pool, upTo) => {
    for (const n of pool) {
      if (out.length >= upTo) return;
      if (topics.has(n.topic)) continue;
      topics.add(n.topic);
      out.push(n);
    }
  };
  if (!advancedOn) {
    take(scored, limit);
  } else {
    const streak = patterns.some((p) => p.key === 'streak');
    // With a band, the band's share (knowledge.advancedSlots), the streak
    // taking the smaller, and the band's own advanced notes first. No band is
    // today's list byte for byte.
    const streakShare = RESERVE_OF - knowledge.STREAK_CORE_SLOTS;
    const share = band ? Math.min(knowledge.advancedSlots(band), streak ? streakShare : RESERVE_OF)
      : streak ? streakShare : knowledge.ADVANCED_SLOTS;
    const advWant = Math.max(0, Math.min(limit - 1, Math.floor((limit * share) / RESERVE_OF)));
    const adv = band ? knowledge.bandFirst(scored.filter((n) => n.advanced)) : scored.filter((n) => n.advanced);
    take(adv, advWant);
    take(scored.filter((n) => !n.advanced), limit);
    // Short on core notes for this player: topped back up from advanced
    // rather than listing fewer, as retrieve() does.
    take(adv, limit);
  }
  out.sort((a, b) => b.score - a.score);
  return out.map((n) => ({ text: n.text }));
}

/*
 * ONLY RIOT'S PLACE IN A ROUND IT PLACES (round 7, the blind audit of round
 * 6). The round line said Riot's place since 8.7.10, but the screen's reads
 * and the look's own words still named the screen's: Pearl round 4 "holding
 * Mid Shops" (Riot B Link), round 5 the look's "in Mid Plaza" (Riot Mid
 * Doors), Corrode rounds 10 and 11 "holding Mid Stairs" (Riot Mid Bottom),
 * and the reviews put the death there. Where Riot places the death, a read
 * or the look's words naming another place of the map are not sent (an area
 * holding Riot's callout agrees, knowledge.js samePlace). Where Riot has no
 * place for the death but places the player's kills (Sunset 2 to 5 round 6,
 * the screen's A Site and A Elbow, the kills at Mid Tiles), the screen's
 * spot and a read in no region of a kill are not sent either. A round
 * without either, every client before it, is as before.
 */
function placesKept(r, map) {
  const keep = { deathSpot: r.deathSpot, reads: r.reads, seen: r.seen };
  if (!r.died || typeof map !== 'string' || !map) return keep;
  let agrees = null;
  if (r.place) agrees = (p) => knowledge.samePlace(map, p, r.place);
  else if (Array.isArray(r.killPlaces) && r.killPlaces.length) {
    const regions = new Set(r.killPlaces.map((p) => knowledge.placeRegion(map, p)).filter(Boolean));
    if (regions.size) agrees = (p) => regions.has(knowledge.placeRegion(map, p));
  }
  if (!agrees) return keep;
  const fits = (t) => knowledge.placesNamed(map, t).every(agrees);
  return {
    deathSpot: r.place || !r.deathSpot || fits(r.deathSpot) ? r.deathSpot : null,
    reads: r.reads.filter(fits),
    seen: r.seen && !fits(r.seen) ? null : r.seen,
  };
}

/*
 * THE NUMBERS STANDING AND WHAT THE DEATH LEFT (round 8, the blind audit of
 * round 7). "4 of their team standing against 5" read as the opening fight
 * and as the team after the death: Pearl round 4 became "the first one into
 * a spot ... your death left four players ... a man down", where a teammate
 * was already down and the death left 3 against 5. Said as what it was, the
 * player counted, and what the death left, and a death that was not the
 * first says how many teammates were already down.
 */
function standingWords(r) {
  const m = r.alive.mates;
  const e = r.alive.enemies;
  if (m <= 1) return `the last of their team alive, 1 against ${e}, when they died`;
  const before = !r.firstDeath && m < 5 ? `, not the first death: ${5 - m} teammate${5 - m === 1 ? '' : 's'} already down` : '';
  return `their team ${m} against ${e} as they died, the player counted${before}, leaving ${m - 1} against ${e}`;
}
/*
 * THE PLANT, WITH RIOT'S TIME (round 8). "Spike planted" alone, beside screen
 * reads of "holding A Site while ally plants", gave Fracture round 5 "As your
 * teammate plants, hold from cover", where Riot has the death after the
 * spike went down. Where normalise kept Riot's plant second, the line says
 * it and which side of it the death fell, by Riot's afterPlant (and the
 * death's second beside it for a death before).
 */
function plantWords(r) {
  let w = `spike planted${r.plantSpot ? ' at ' + r.plantSpot : ''}`;
  if (!r.verified || !Number.isFinite(r.plantSec)) return w;
  w += ` ${r.plantSec} seconds into the round`;
  if (!r.died) return w;
  if (r.afterPlant === true) return `${w}, before the death, so the player died with the spike down`;
  if (r.afterPlant === false && Number.isFinite(r.sec) && r.sec + 0.5 <= r.plantSec) return `${w}, after the death, so the player died before the plant`;
  return w;
}
/*
 * THE SCREEN'S READS HELD TO THE PLANT'S PHASE (round 8). A read of the
 * plant under way ("holding A Site while ally plants") is not sent for a death
 * Riot has after the plant, nor a read of the spike down for a death Riot has
 * before it. A round without Riot's plant time keeps its reads.
 */
const READ_DURING_PLANT = /\b(?:being\s+planted|is\s+planting|(?:while|as)\s+(?:an?\s+|the\s+)?(?:ally|allies|teammates?)\s+(?:is\s+|are\s+)?plant(?:s|ing)?)\b/i;
const READ_SPIKE_DOWN = /\b(?:spike\s+planted|planted\s+spike|post[- ]?plant)\b/i;
function phaseKept(reads, r) {
  if (!r || !r.verified || !r.died || !Number.isFinite(r.plantSec) || !Array.isArray(reads)) return reads;
  if (r.afterPlant === true) return reads.filter((t) => !READ_DURING_PLANT.test(t));
  if (r.afterPlant === false && Number.isFinite(r.sec) && r.sec + 0.5 <= r.plantSec) return reads.filter((t) => !READ_SPIKE_DOWN.test(t));
  return reads;
}

function roundLine(r0, opts) {
  const r1 = opts && opts.map ? { ...r0, ...placesKept(r0, opts.map) } : r0;
  const r = { ...r1, reads: phaseKept(r1.reads, r1) };
  const bits = [`R${r.n}`];
  bits.push([r.side === 'attacking' ? 'attack' : r.side === 'defending' ? 'defence' : 'side unread',
    r.result || 'result unread'].join(', '));
  const facts = [];
  if (r.verified && r.afk) {
    // A round the player sat out (8.8): Riot's flag first, then only what
    // happened, no first death, odds, trade, ultimate or look to judge it by.
    facts.push('Riot marks the player as sitting this round out, so nothing in it is their mistake');
    if (r.died) facts.push(`died${r.sec !== null ? ` ${r.sec} seconds into the round` : ''}${r.killer ? `, killed by ${r.killer}` : ''}`);
  } else if (r.verified) {
    // Riot's record: exact, so stated exactly.
    if (r.died) {
      let d = `died${r.deathSpot ? ' at ' + r.deathSpot : ''}`;
      if (r.sec !== null) d += ` ${r.sec} seconds into the round`;
      if (r.killer) d += `, killed by ${r.killer}${r.weapon ? ' with ' + withArticle(r.weapon) : ''}`;
      facts.push(d);
      if (r.firstDeath) facts.push('first player to die that round');
      // A client before round 4 (no `counts`) keeps the old words, byte for byte.
      if (r.alive) facts.push(opts && opts.plant ? standingWords(r) : `${r.alive.mates} of their team standing against ${r.alive.enemies} when they died`);
      if (r.traded === true) facts.push('a teammate traded the death');
      if (r.traded === false) facts.push('nobody traded the death');
      if (r.ultReady) facts.push('ultimate was ready when they died');
      if (r.cause) facts.push(`the coach looked at the frame before the death: ${forensics.CAUSES[r.cause]}${r.seen ? ` (${r.seen.replace(/\.$/, '')})` : ''}`);
    } else {
      facts.push('survived the round');
    }
    if (r.kills !== null) facts.push(`${r.kills} kill${r.kills === 1 ? '' : 's'}`);
    if (r.firstKill) facts.push('got the first kill of the round');
    // Where the player's kills fell, apart from where they died (round 8:
    // Sunset 4 to 13 round 7 gave the first kill the death's A Alley, where
    // Riot has the kill at A Elbow, with only the death's place in the line).
    if (Array.isArray(r.killPlaces) && r.killPlaces.length) facts.push(`the player's kills fell at ${[...new Set(r.killPlaces)].join(', ')}`);
    // The round record beyond the feed (8.8, recordSent), only where sent.
    if (r.mate) facts.push(r.mate === 'close' ? 'a teammate stood close when they died' : 'no teammate stood close when they died');
    if (r.buy) facts.push(`the team played it on ${RECORD_BUY[r.buy]}`);
    if (r.casts) {
      const used = r.casts.filter((c) => c.n > 0);
      facts.push(used.length ? `abilities used: ${used.map((c) => `${c.name} ${c.n === 1 ? 'once' : c.n === 2 ? 'twice' : `${c.n} times`}`).join(', ')}`
        : 'no ability used');
    }
  } else if (r.died) {
    facts.push(`died${r.deathSpot ? ' at ' + r.deathSpot : ''}${r.timing ? ', ' + r.timing + ' in the round' : ''}`);
    if (r.ultReady) facts.push('ultimate was ready when they died');
  }
  if (r.planted) facts.push(plantWords(r));
  // Round 4: Riot's record says whether the spike went down, so a round with
  // none says so, and advice that needs a plant is never given for it.
  else if (opts && opts.plant && r.verified) facts.push('spike not planted');
  // The enemy's side said by its noun (round 8: Corrode 3 to 13 round 1 told
  // an attacker to "make the attacker expose themselves").
  if (opts && opts.plant && r.verified && !r.afk && (r.side === 'attacking' || r.side === 'defending')) facts.push(`the enemy were the ${r.side === 'attacking' ? 'defenders' : 'attackers'}`);
  // A won round given a line (round 8, wonPicks).
  if (opts && opts.risk) facts.push('your team won it anyway, so say what the death risked, never that it lost the round');
  let line =`${bits.join(' ')}${facts.length ? '. ' + facts.join('; ') : ''}.`;
  // The last of what the screen showed the player doing in play, before the
  // death where there was one. Only play reaches here (normalise).
  if (r.reads.length) line += ` Seen in play: ${r.reads.map((t) => `"${t}"`).join(' ')}`;
  return line;
}

const GROUNDING = 'GROUNDING RULES. The ledger was built by reading the screen about once a second, and a death '
  + 'can still be missed, so never call a round clean unless it says survived the round. '
  + 'What was seen in play is what the screen showed the player doing, not proof of why a round went the way it did. '
  + 'Nothing done in the buy phase is a mistake: every player waits in spawn with a pistol and opens the buy menu, '
  + 'the scoreboard or the combat report then, so never mention the buy phase, the spawn, a menu or the scoreboard. '
  + 'Damage, utility usage and economy are not in the ledger, so never state them. How many players were '
  + 'standing is known only where a round states it, so call a situation a man advantage or a clutch only there. '
  + 'Kills may be stated only where the ledger gives a kill count for that round. '
  + 'Never tell the player to use their ultimate unless that round says the ultimate was ready. '
  + 'Never do arithmetic on the score, use it exactly as given. '
  + 'Quote a pattern\'s numbers exactly or not at all, and never merge two patterns into one number. '
  + 'Speak to the player as you, never as the player. '
  + 'In the SUMMARY write no counts or fractions such as 6 of 12 except the first counted mistake\'s own count, '
  + 'exactly as given; the computed patterns show every other number beside it. The final score and round numbers are fine. '
  + 'Write round numbers as digits and never list more than four of them in one sentence. '
  + 'Start from the player\'s own choice: never blame teammates, luck, the enemy\'s aim, the lobby or the map, and never '
  + 'tell the player they were unlucky. When a death was a traded entry, a fair fight or a sound take, say so plainly '
  + 'instead of inventing a mistake. '
  + 'Write for a player who does not know coaching words: say a teammate close enough to kill your killer, not '
  + 'trading distance, say the smoke, the flash or the drone by name, not utility, say take one piece of space and '
  + 'stop, not checkpoints, and never write impact, tempo, map control, situational awareness or utility potential. '
  + 'Only name places that appear in the ledger. Do not use dashes and never use semicolons. No markdown, no lists, no bold.';

/** The old review, kept as variant A so the bench has a baseline. */
function promptA(input) {
  const notesBlock = input.notes.length
    ? '\n\nOBSERVED FACTS (what the player was actually SEEN doing on screen, this is the honest record):\n'
      + input.notes.map((n) => '- ' + n).join('\n')
    : '';
  const tips = input.tips.length ? input.tips : input.rounds.flatMap((r) => r.reads);
  return `Here are the coaching tips shown to a Valorant player during one match:\n${tips.join('\n')}${notesBlock}\n\n`
    + 'Write a 3-sentence match review. Sentence 1: the area the coaching pushed most, framed as what to keep '
    + 'building on. Sentence 2: the most repeated correction, that is their most common issue. Sentence 3: the '
    + 'single focus for next match, stated as a concrete habit or drill they can actually do, not a vague goal.\n\n'
    + 'CRITICAL GROUNDING RULE: the tips are only the advice that was SHOWN, they do NOT prove the player did or '
    + 'failed to do anything. Never fabricate plays, kills, or moments. Do not use dashes. End each sentence with a period.';
}

function promptRounds(input, withKnowledge, opts) {
  const { context, final, rounds, patterns } = input;
  const who = [context.agent ? `playing ${context.agent}` : 'agent unread', context.map ? `on ${context.map}` : 'map unread'].join(' ');
  const score = final.team !== null && final.enemy !== null
    ? `${final.verified ? 'Riot\'s final score was' : 'The score the coach last read was'} ${final.team} to ${final.enemy}${final.result ? `, a ${final.result.toLowerCase()}` : ''}.`
      + (final.scoreline ? ` Riot's scoreboard for the player: ${counts(final.scoreline.kills, 'kill')}, `
        + `${counts(final.scoreline.deaths, 'death')}, ${final.scoreline.assists === null ? 'unknown assists'
          : counts(final.scoreline.assists, 'assist')}`
        + `${final.scoreline.acs !== null ? `, combat score ${final.scoreline.acs} a round` : ''}`
        + `${final.scoreline.mvp === 'match' ? ', match MVP' : final.scoreline.mvp === 'team' ? ', team MVP' : ''}. `
        + 'Weigh the deaths against this: a player who dies first but wins the fights around it is paying for '
        + 'their impact, not failing.' : '')
    : 'The final score was not read.';

  const r3 = round3(input);
  let notes = [];
  let worked = [];
  if (withKnowledge) {
    const enemies = enemiesOf(input);
    const guns = enemyWeaponsOf(input);
    const seen = new Set();
    const add = (t) => { if (t && !seen.has(t)) { seen.add(t); notes.push(t); } };
    for (const n of study(input, 4)) add(n.text);
    // The causes of the deaths the coach looked at (8.5.0 clients and later,
    // the same gate as study()): notes tagged for a cause are served by it.
    const causes = [];
    if (input.byCause === true) {
      for (const m of input.mistakes || []) {
        const c = /^cause:(.+)$/.exec(String((m && m.key) || ''));
        if (c) causes.push(c[1]);
      }
      for (const r of rounds || []) if (r && r.cause) causes.push(r.cause);
    }
    // Aim evidence brings the lost duel notes as a look's lost duel does
    // (round 3): with no look, an aim problem had no aim note at all.
    if (r3 && aimEvidence(input) && aimEvidence(input).low && !causes.includes('lost-duel')) causes.push('lost-duel');
    // Riot's round record (8.8, recordSignalsOf): the economy flags the
    // team's buys show, a lone death's or a quiet death's cause, and the
    // callouts of the lone deaths for the map's notes naming them. None, and
    // the context is as before.
    const sig = recordSignalsOf(input);
    if (sig) for (const c of sig.causes) if (!causes.includes(c)) causes.push(c);
    for (const t of knowledge.retrieve({ agent: context.agent, map: context.map, causes,
      ...(sig && sig.economy.length ? { economy: sig.economy } : {}),
      ...(sig && sig.places.length ? { places: sig.places } : {}),
      ...(context.rankBand ? { rankBand: context.rankBand } : {}),
      ...(enemies.length ? { enemyAgents: enemies } : {}),
      ...(guns.length ? { enemyWeapons: guns } : {}),
      ...leverSituation(input) }, 6,
      { advanced: context.advancedTips })) add(t);
    notes = notes.slice(0, 8);
    // The note answering the team's economy (8.8, knowledge.js recordSlot)
    // moves inside the floor the cases' budget never cuts (withinBudget,
    // NOTES_FLOOR): last of the list, it was the first note to go.
    if (sig && sig.economy.length) {
      const econ = new Set(sig.economy);
      const at = notes.findIndex((t) => { const n = knowledge.all().find((x) => x.text === t); return !!(n && n.situations && n.situations.some((f) => econ.has(f))); });
      if (at >= NOTES_FLOOR) notes.splice(NOTES_FLOOR - 1, 0, notes.splice(at, 1)[0]);
    }
    // Worked cases (8.8, cases.js), only where this match's situation matches one.
    // opts.cases false is the prompt without them, today's, for the tests and the benches.
    worked = opts && opts.cases === false ? [] : cases.pick(caseSituation(input, enemies), cases.MAX_CASES);
  }
  // Never where it comes from: the review speaks these notes in its own
  // voice and names no coach, player, team or video behind them.
  const knowledgeOf = (ns, cs) => (ns.length
    ? '\n\nCOACHING KNOWLEDGE (verified habits). Use one to explain WHY a round went wrong '
      + `only when that round's facts actually match it, and prefer the one that answers ${r3 ? 'the FOCUS lever' : 'the first counted mistake'}. `
      + 'Put it in the player\'s own situation and give its reason in your own words. Never quote it word for word, and never say where '
      + 'it comes from: no coach, player, team or video is ever named as its source:\n'
      + ns.map((t) => '- ' + t).join('\n') : '')
    + (cs.length ? '\n\n' + cases.block(cs) : '');

  const verified = rounds.some((r) => r.verified);
  const ledgerNote = verified
    ? 'ROUND LEDGER, checked against Riot\'s record of the match. Deaths, the seconds, the killer, kills, '
      + 'first deaths and round results are Riot\'s and exact. Death locations and what was seen in play come from the '
      + 'screen. A read that named a different killer than Riot was removed:'
    : 'ROUND LEDGER:';
  const counted = (list) => list.map((e) => `- ${e.title}${e.rounds.length ? ` (${roundsText(e.rounds)})` : ''}: ${e.detail}`).join('\n');
  // A client from before 8.3.1 sends no counted lists (normalise), so it gets
  // no block, never one saying nothing was counted.
  const block = (head, list) => (list
    ? `\n\n${head}\n${list.length ? counted(list) : '- none cleared the bar in this match'}` : '');
  const picks = linePicks(input);
  const r4 = round4(input);
  // A won round picked for a line (wonPicks) says so in its facts.
  const risk = new Set(wonPicks(rounds, { won: r4 }));
  const assemble = (knowledgeBlock) => `You are reviewing one finished Valorant match for the player, ${who}. ${score}\n\n`
    + `${ledgerNote}\n${(r4 ? rounds.map((r) => roundLine(r, { plant: true, map: context.map, risk: risk.has(r.n) })) : rounds.map((r) => roundLine(r, { map: context.map }))).join('\n')}\n\n`
    + `COMPUTED PATTERNS (arithmetic over the ledger, these are true):\n`
    + (patterns.length ? patterns.map((p) => '- ' + p.text).join('\n') : '- none cleared the bar in this match')
    + block('COUNTED MISTAKES (counted from the rounds above, most serious first, these are true):', mistakesShown(input))
    + block('COUNTED STRENGTHS (counted the same way, these are true):', input.strengths)
    + knowledgeBlock
    // A client of the round 3 rules gets them (round3Write); one before it
    // gets these instructions byte for byte.
    + (r3 ? round3Write(input, picks) : '\n\nWrite exactly this, each label at the start of its own line:\n'
    + 'SUMMARY: three sentences on one line, under 70 words. First, starting with You won or You lost and the score '
    + 'if the score says so, what decided it for the player, drawn from the counted mistakes, the strengths and the patterns. '
    + 'Second, the first counted mistake in your own words, with its count exactly as given and up to four of its '
    + 'rounds, and in a few words why it cost them (nobody could trade it, the team was ahead, the clock); if no '
    + 'mistake was counted, what cost the most rounds by the round facts, never called a repeated '
    + 'mistake. Name no second mistake. Third, what went right, from the counted strengths if there are any, otherwise '
    + 'from the round facts, as a habit worth repeating and why it works, never as a scoreboard number.\n'
    + (picks.length
      ? `Then one round line for each of these rounds, in this order: ${picks.map((n) => 'R' + n).join(', ')}.\n`
        + 'R<number>: one sentence, at most 30 words, written as when this happens, do that, because of the one fact '
        + 'that makes it the lesson (the numbers standing when you died, that nobody could trade you, the plant). Teach the '
        + 'choice the player could make with what they could see at that moment, never what only the replay shows. Explain '
        + 'a death by the situation, the timing, the numbers or the trade first, and blame aim, reflexes or luck only where '
        + 'the coach\'s look called the fight fair and lost on the shot. The player '
        + 'sees that round\'s facts right beside your line, so never restate them: no killer, weapon, seconds or place '
        + 'unless the lesson needs that one. What was seen in play is the last the screen showed of the player before the '
        + 'death; use it only where it agrees with the facts. If the facts give you no lesson, leave that round out. '
        + 'Each line teaches the choice that round\'s facts single out, so no two lines teach the same thing in the '
        + 'same words: a defence death is about where you held and when to give ground, an attack death about who '
        + 'followed you in, a death after the plant about holding the spike from cover and the clock, a death with '
        + 'your team ahead about not needing the fight. Say that nobody traded you in at most one line, the one where '
        + 'it is the lesson, because the counted mistake already says it for the match.\n'
      : 'Write no round lines: no round was lost to a death.\n')
    + 'FOCUS: one concrete habit for the next match that fixes the first counted mistake, written as the moment to '
    + 'notice and the move to make (when you are about to swing, do this first), something a player can do in a round '
    + 'and see in their next review. One habit only, never two joined by and. Never a prohibition on its own (do not '
    + 'over peek) and never an attitude (be patient, stay aware, play smarter): say what to do instead. Being traded means a teammate killed your killer within five seconds, which is good: never call it '
    + 'the problem.\n\n'
    + rankRule(context.rankBand)
    + GROUNDING)
    + languageRule(context.language);
  const today = assemble(knowledgeOf(notes, []));
  if (!worked.length) return today;
  return withinBudget(today, notes, worked, (ns, cs) => assemble(knowledgeOf(ns, cs)));
}

/*
 * THE CASES TAKE THE PLACE OF THE LOWEST NOTES (8.8). A review with worked
 * cases may grow by CASE_GROWTH of today's prompt at most: past it the lowest
 * scoring notes (the last of the list, retrieve()'s order) go one at a time,
 * down to NOTES_FLOOR, then the second case, and a prompt that still does not
 * fit is today's, with no cases. Without a case it is today's byte for byte.
 */
const CASE_GROWTH = 0.10;
const NOTES_FLOOR = 3;
function withinBudget(today, notes, worked, build) {
  const cap = Math.floor(today.length * (1 + CASE_GROWTH));
  for (const cs of [worked, worked.slice(0, 1)]) {
    const ns = notes.slice();
    for (;;) {
      const p = build(ns, cs);
      if (p.length <= cap) return p;
      if (ns.length <= NOTES_FLOOR) break;
      ns.pop();
    }
  }
  return today;
}

/*
 * THE PLAYER'S LEVEL (8.8), only when a client sends a band: a review for a
 * client that sends none is today's prompt byte for byte. The same ladder as
 * Ask Coach's rule (chat-prompt.js VALORANT_RULES): below Platinum one basic
 * habit, Platinum and Diamond one decision, Ascendant and up the specific
 * timing or utility change. No dashes, no semicolons, no numbers (the number
 * gate would drop a fix that carried one).
 */
const RANK_WORDS = {
  iron_bronze: ['Iron or Bronze', 'the one basic habit that matters most there, such as crosshair height, stopping before the shot or one angle at a time'],
  silver_gold: ['Silver or Gold', 'the one basic habit that matters most there, such as staying where a teammate can trade you, information before a peek or one angle at a time'],
  plat_diamond: ['Platinum or Diamond', 'the one decision that matters most there, such as being predictable, taking a fight the round did not need or playing the team plan'],
  asc_plus: ['Ascendant or above', 'the specific timing, utility or read that matters there and what it risks, and no basic they already have unless the rounds show it missing'],
};

function rankRule(band) {
  const w = RANK_WORDS[knowledge.validBand(band)];
  if (!w) return '';
  return `PLAYER LEVEL: the player is ranked ${w[0]}. Fit the round lines and the focus to that level and teach ${w[1]}. `
    + 'Never prescribe a high rank micro decision to a player below it, and never say the rank back to the player.\n\n';
}

/*
 * ROUND 3 (Nov 2026): the review's instructions for a client of the round 3
 * rules (round3, normalise's `swing`), from an audit of 84 real outputs by six
 * judges at six ranks. One habit taught everywhere (the FOCUS had to fix the
 * first counted mistake), aim refused without a look, traded deaths praised
 * in lost rounds, the template's own words reaching players ("as when this
 * happens, do that"), invented orbs, health and spike carriers, ability keys
 * swapped, guns blamed on utility, drills nobody could do alone, and Platinum
 * and Ascendant given the Iron line in longer words. Each is a sentence below,
 * and each that code can hold is held in parse() as well. No dashes, no
 * semicolons, no number in a fix.
 */
const RANK_WORDS3 = {
  iron_bronze: ['Iron or Bronze', 'one basic habit and the first thing to check',
    'Stop moving before you shoot, because a moving shot goes wide.'],
  silver_gold: ['Silver or Gold', 'the one habit that matters most and where it applies, such as stopping before the shot, crosshair height, information before a peek or one angle at a time',
    'Clear the close corner before you look at the site, because that is where a defender waits.'],
  plat_diamond: ['Platinum or Diamond', 'the decision and its timing, with the reason',
    'With your team ahead after the first kill, hold the cross and let them come to you, because they have to take the space back.'],
  asc_plus: ['Ascendant or above', 'the read, the tempo and the trade off, what the play gains and what it risks, and no basic they already have unless the rounds show it missing',
    'They stacked B after two hits there, so a fast A take beats the slow default, at the cost of not knowing where mid is.'],
};

function rankRule3(band) {
  const w = RANK_WORDS3[knowledge.validBand(band)];
  if (!w) return '';
  return `PLAYER LEVEL: the player is ranked ${w[0]}. Round lines differ in kind by level, and at this level each one names `
    + `${w[1]}, as in this example, which shows the kind and is never to be copied: ${w[2]} Fit the focus to the level too. `
    + 'A line for this level must never be the one a lower ranked player would be given for the same round. '
    + 'Never prescribe a high rank micro decision to a player below it, and never say the rank back to the player.\n\n';
}

const GROUNDING3_SWAPS = [
  ['In the SUMMARY write no counts or fractions such as 6 of 12 except the first counted mistake\'s own count, exactly as given;',
    'In the SUMMARY write no counts or fractions such as 6 of 12 except the counted mistake\'s own count and a swing fact\'s numbers, exactly as given;'],
  ['When a death was a traded entry, a fair fight or a sound take, say so plainly instead of inventing a mistake. ',
    'When a death was a fair fight, or a traded entry in a round your team won, say so plainly instead of inventing a mistake. '],
  ['Only name places that appear in the ledger. ',
    'Mention an ultimate orb, a health number, who carried the spike or how many players were standing only where the facts '
      + 'state it, and never invent an object or a state they do not give. Only name places that appear in the ledger. '],
];
const GROUNDING3 = GROUNDING3_SWAPS.reduce((g, [from, to]) => g.replace(from, to), GROUNDING);

function round3Write(input, picks, parts) {
  if (!parts && round4(input)) return round4Write(input, picks);
  const swing = parts ? parts.swing : input.swing.length
    ? `\n\nSWING FACTS (computed from Riot's record of this match, the biggest first, these are true):\n${input.swing.map((t) => '- ' + t).join('\n')}`
    : '';
  const aim = aimEvidence(input);
  const aimSaid = [];
  if (aim && aim.low) aimSaid.push(`the player's headshot rate this match was ${aim.hs} percent, well below what is usual at their level, so a fair fight lost on the shot may be named as aim`);
  if (aim && aim.lostDuels) aimSaid.push('the coach\'s look called a death a fair fight lost on the shot, so aim may be named in that round');
  const aimLine = `\n\nAIM EVIDENCE: ${aimSaid.length ? aimSaid.join(', and ') : 'none in this match, so never say whether aim was or was not the problem'}.`;
  return swing + aimLine + (parts ? parts.kit : '') + '\n\n' + (parts ? parts.lever : leverRule(input))
    + '\n\nWrite exactly this, each label at the start of its own line:\n'
    + 'SUMMARY: three sentences on one line, under 70 words. First, starting with You won or You lost and the score '
    + 'if the score says so, what decided it for the player, drawn from the swing facts, the counted mistakes, the strengths and the patterns, '
    + 'and where a swing fact is listed, the first one with its numbers exactly as given. '
    + 'Second, the lever the FOCUS fixes, in your own words: a counted mistake with its count exactly as given and up to four of its '
    + 'rounds, or a swing fact with its numbers exactly as given, and in a few words why it cost them (nobody could trade it, the team '
    + 'was ahead, the clock, the plant). If nothing was counted and no swing fact is listed, what cost the most rounds by the round '
    + 'facts, never called a repeated mistake. Call a swing fact what it cost, never a mistake. Name no second mistake. '
    + 'Third, what went right, from the counted strengths if there are any, otherwise '
    + 'from the round facts, as a habit worth repeating and why it works, never as a scoreboard number.\n'
    + (picks.length
      ? `Then one round line for each of these rounds, in this order: ${picks.map((n) => 'R' + n).join(', ')}.\n`
        + 'R<number>: one sentence, at most 30 words, in plain words: what to do in that spot next time and the one fact that makes '
        + 'it the lesson (the numbers standing when you died, that nobody could trade you, the plant, the gun that killed you). Write it as '
        + 'your own advice, never as a template, and never use the words when this happens or do that. Teach the '
        + 'choice the player could make with what they could see at that moment, never what only the replay shows. Explain '
        + 'a death by the situation, the timing, the numbers or the trade first. Name aim, the crosshair or a missed shot only where '
        + 'the coach\'s look called the fight fair and lost on the shot or the AIM EVIDENCE supports it, and where a death has both a '
        + 'decision and a mechanic problem, name the decision and then the one mechanic. Where nothing supports aim, never say aim was '
        + 'or was not the problem. A death a teammate traded within five seconds is not a mistake by itself, so never call the trade the '
        + 'problem, but judge the round, not the trade: in a round your team won, or where the trade gave your team the numbers, the '
        + 'traded entry was the right play, and in a round your team lost the fight can still have been the wrong one, so never praise '
        + 'a death in a lost round as a good or sound choice. Read the killing weapon before you blame anything: a death to a gun is a '
        + 'gun fight, so never blame an enemy ability for it, and name an ability by its name, never by its key letter. '
        + 'The player sees that round\'s facts right beside your line, so never restate them: no killer, weapon, seconds or place '
        + 'unless the lesson needs that one. What was seen in play is the last the screen showed of the player before the '
        + 'death, and use it only where it agrees with the facts. If the facts give you no lesson, leave that round out. '
        + 'Each line teaches the choice that round\'s facts single out, so no two lines teach the same thing in the '
        + 'same words: a defence death is about where you held and when to give ground, an attack death about who '
        + 'followed you in, a death after the plant about holding the spike from cover and the clock, a death with '
        + 'your team ahead about not needing the fight. Say that nobody traded you in at most one line, the one where '
        + 'it is the lesson, because the counted mistake already says it for the match.\n'
      : 'Write no round lines: no round was lost to a death.\n')
    + 'FOCUS: one concrete habit for the next match, for the FOCUS LEVER, naming the situation to notice and what to do in it, '
    + 'in plain words, something a player can do in a round and see in their next review. One habit only, never two joined by and. '
    + 'Never a prohibition on its own (do not over peek) and never an attitude (be patient, stay aware, play smarter): say what to '
    + 'do instead. It is done in a real match: Deathmatch and the Range have no teammates, so never set a drill there that needs one.\n\n'
    + rankRule3(input.context.rankBand)
    + GROUNDING3;
}

/*
 * THE ROUND 4 INSTRUCTIONS are the round 3 ones with these sentences
 * changed (round4Write, each swap must apply: test:valorantreview holds it,
 * since a swap that silently misses is a rule that is not there), the one
 * SWING AND COUNTS block in place of the swing facts, the kit, the lever by
 * level, and the depth rule from Platinum.
 */
const ROUND4_SWAPS = [
  ['and where a swing fact is listed, the first one with its numbers exactly as given. ',
    'and the first line of the SWING AND COUNTS block with its numbers exactly as written there. '],
  ['or a swing fact with its numbers exactly as given, ',
    'or a line of the SWING AND COUNTS block with its numbers exactly as written, '],
  ['name an ability by its name, never by its key letter. ',
    'name an ability by its name, never by its key letter.{KIT} Each round\'s facts say the side and whether the spike was planted: '
      + 'on attack before a plant the clock is the defenders\' and the site has to be taken, so in a round with no plant never tell an '
      + 'attacker to let the enemy come to them or to play for time, and never give advice that needs a planted spike, a defuse or a '
      + 'retake in a round where the spike was not planted. Quote a number of rounds or deaths only from the SWING AND COUNTS block. '],
  ['in plain words, something a player can do in a round and see in their next review. ',
    'in plain words, something a player can do in a round. '],
  ['so never set a drill there that needs one.\n\n',
    'so never set a drill there that needs one. Never mention this review, a next review, the app or what it can check, and never '
      + 'suggest anything but playing, in a match, in Deathmatch or in the Range.\n\n'],
];
/*
 * THE SWING LINE IS THE SERVER'S (round 8, the Ascendant Fracture review). Told
 * to quote the SWING AND COUNTS block's first line inside sentence one, the
 * model glued a won score to a count of deaths: "You won 5 to 1, opening
 * fights and winning key duels despite this: you died 3 times in 6 rounds."
 * In an English review sentence one is now the score and what decided it, and
 * parse puts the block's first line after it, verbatim (swingInto). A review
 * in another language keeps the old rule, since the line is English.
 */
const SWING_SWAP_EN = 'and never a line of the SWING AND COUNTS block: its first line is put after this sentence for you, word for word, as the second sentence. ';
const GROUNDING4_SWAPS = [
  ['In the SUMMARY write no counts or fractions such as 6 of 12 except the counted mistake\'s own count and a swing fact\'s numbers, exactly as given;',
    'In the SUMMARY and the round lines write no counts or fractions such as 6 of 12 except the numbers of the SWING AND COUNTS block and the counted mistake\'s own count, exactly as written there;'],
  ['Speak to the player as you, never as the player. ',
    'Only this match is in front of you, so never quote a number from other matches, an average or what is usual for the player. '
      + 'Speak to the player as you, never as the player. '],
];
const GROUNDING4 = GROUNDING4_SWAPS.reduce((g, [from, to]) => g.replace(from, to), GROUNDING3);

function round4Write(input, picks) {
  const lines = countLines(input);
  const swing = lines.length
    ? '\n\nSWING AND COUNTS (computed from Riot\'s record of this match, the biggest swing first, these are true, and the only '
      + `numbers of rounds or deaths the summary and the round lines may quote, exactly as written here):\n${lines.map((t) => '- ' + t).join('\n')}`
    : '';
  const kit = kitBlockOf(input);
  const lever = leverOf(input);
  // No fact for any kind: the round 3 rule, the trade never the focus from Platinum.
  const high = HIGH_BANDS.has(knowledge.validBand(input.context.rankBand));
  // From Platinum, the deaths ranked by what each cost (costLineOf, the blind audit of 8.7.9).
  const cost = high ? costLineOf(input) : '';
  // The trades and the distance, counted in code (round 8, ledgerOf), every band.
  const ledger = ledgerOf(input);
  const swingAll = [swing, ledger ? `\n\n${ledger}` : '', cost ? `\n\n${cost}` : ''].join('');
  let text = round3Write(input, picks, { swing: swingAll, kit, lever: lever ? leverRule4(input, lever) : leverRule(input, high) });
  // The SWING line is the server's in an English review (swingInto, round 8).
  const english = promptName(input.context && input.context.language) === 'English';
  for (const [from, to] of ROUND4_SWAPS) {
    const into = english && to === ROUND4_SWAPS[0][1] ? SWING_SWAP_EN : to;
    text = text.replace(from, into.replace('{KIT}', kit ? ' Say of an ability only what its line under WHAT THE ABILITIES DO says.' : ''));
  }
  if (text.endsWith(GROUNDING3)) text = text.slice(0, -GROUNDING3.length) + depthRule(input.context.rankBand) + GROUNDING4;
  return text;
}

/** "rounds 2, 3, 6 and 7", "round 4". */
function roundsText(ns) {
  if (ns.length === 1) return `round ${ns[0]}`;
  return `rounds ${ns.slice(0, -1).join(', ')} and ${ns[ns.length - 1]}`;
}

/**
 * The player's language, for everything the player reads. The labels stay
 * English because parse() reads them, and callouts and agent names stay exactly
 * as the game prints them because that is what is on the player's screen.
 */
function languageRule(code) {
  if (!code || code === 'en') return '';
  const name = promptName(code);
  return `\n\nWRITE IN ${name.toUpperCase()}. Everything after SUMMARY:, after each R<number>: and after FOCUS: `
    + `must be natural ${name}. Keep the labels SUMMARY:, R<number>: and FOCUS: in English, write round numbers `
    + 'as digits, and keep map callouts and agent names exactly as the game prints them.';
}

/*
 * A MATCH WHOSE ROUNDS CARRY RIOT'S BUY OR CASTS (8.8, recordSent) is told
 * the economy and the utility where a round states them, in place of the
 * rule that they are never known. Any other match's prompt is as before,
 * byte for byte.
 */
const NO_ECONOMY = 'Damage, utility usage and economy are not in the ledger, so never state them. ';
const SOME_ECONOMY = 'Damage is not in the ledger, so never state it. The team\'s economy and the player\'s abilities used '
  + 'are known only where a round states them, so state them only there, exactly as given. ';
function buildPrompt(input, opts) {
  if (input.variant === 'A') return promptA(input);
  const text = promptRounds(input, input.variant === 'C', opts);
  const rs = input.rounds || [];
  const record = rs.some((r) => r && (r.buy || r.casts));
  const use = recordUse(rs);
  if (typeof text !== 'string' || (!record && !use)) return text;
  return text.replace(NO_ECONOMY, (record ? SOME_ECONOMY : NO_ECONOMY) + use);
}

/*
 * HOW TO USE THE ROUND RECORD (8.8), one sentence for each kind of fact the
 * rounds carry and none for a kind they do not, beside the grounding rule on
 * the economy: the teammate's distance is the evidence for a trade or a
 * spacing point, the team's economy changes what a death teaches, the
 * abilities used back a point about utility, and a round Riot says the
 * player sat out is never criticised. Worded without "buy", which the
 * review's gate drops (BUY_BLAME). No such fact, no sentence: the prompt is
 * as before, byte for byte.
 */
const RECORD_USE = {
  mate: 'Where a round says whether a teammate stood close when the player died, that is the evidence for a trade or a spacing point: with no teammate close the lesson is where the player stood, and with one close and nobody trading it is when they took the fight. ',
  buy: 'The team\'s economy changes what a death teaches: a death on an eco is no mistake the way one on a full loadout is, so never count a death on an eco against the player as one on a full loadout, and a pistol round is a full fight for the round and the economy after it. Never say a death cost the team little or nothing. ',
  casts: 'Make a point about the player\'s abilities only for a round that lists the abilities used, and a round saying no ability used is the evidence for one. ',
  afk: 'Never criticise a round Riot marks the player as sitting out. ',
};
function recordUse(rounds) {
  const rs = (rounds || []).filter((r) => r && r.verified);
  return [
    rs.some((r) => r.mate) ? RECORD_USE.mate : '',
    rs.some((r) => r.buy) ? RECORD_USE.buy : '',
    rs.some((r) => r.casts) ? RECORD_USE.casts : '',
    rs.some((r) => r.afk) ? RECORD_USE.afk : '',
  ].join('');
}

/**
 * The model's reply, parsed. Tolerant of markdown bold around the labels and of
 * the summary running onto a second line; strict about round numbers, which
 * must be rounds the ledger actually sent.
 */
/**
 * A round worth a line at all: one the player died in and did not win, or one
 * the coach looked at. A line explains a death. On the player's Sunset
 * swiftplay every round had a read, so every round got a line, and the four
 * kill round won on attack was told "Opening menus in spawn delays your
 * movement": a won round with no death has nothing to explain.
 */
function lineWorthy(r) {
  // Never a round Riot says the player sat out (8.8): teachable picked the
  // AFK round on the real Split for a coaching line.
  if (r.afk) return false;
  return (r.died || !!r.cause) && r.result !== 'won';
}

/**
 * The rounds worth a line, chosen HERE rather than by the model.
 *
 * Asked to "choose the rounds that teach the most, in round order", the model
 * took the first ten: on the real 24 round Abyss match it explained rounds 2 to
 * 11 and never reached the second half. So the choice is arithmetic, among
 * the rounds worth a line (lineWorthy). A lost round outranks one with no
 * result read, a first death or an early death outranks a late one, and a
 * round with play seen before the death outranks a silent one. Ties go to
 * spreading the picks across the match.
 */
const lineScore = (r) => (r.result === 'lost' ? 3 : 0) + (r.firstDeath ? 3 : 0) + (r.died ? 2 : 0)
  + (r.verified && r.sec !== null && r.sec <= 30 ? 1 : 0) + (r.reads.length ? 1 : 0);
/*
 * A WON ROUND GETS A LINE WHEN TOO FEW LOST ONES DO (round 8, the coaching
 * sweep of round 7). Fracture 5 to 1 had one round worth a line, round 5, and
 * the Plat review lost it to a gate and showed none; round 2's repeek at 57
 * HP, the clearest lesson of the match, was in a round the team won, so no
 * line could teach it. With fewer than two rounds worth a line, a death in a
 * won round Riot verified that the coach looked at or that was the first of
 * the round may have one too, two at most, each scored below any lost round
 * (1, a look 2, a first death 2), and its facts say the team won it anyway,
 * so the line says what the death risked, never that it lost the round.
 * Opt in (opts.won): a round 4 client's review. Every other caller is as
 * before.
 */
const WON_LINES = 2;
function wonWorthy(r) {
  return !!(r && !r.afk && r.verified && r.result === 'won' && r.died && (r.cause || r.firstDeath));
}
function wonPicks(rounds, opts) {
  if (!(opts && opts.won) || (rounds || []).filter(lineWorthy).length >= 2) return [];
  return rounds.filter(wonWorthy)
    .map((r) => ({ n: r.n, score: 1 + (r.cause ? 2 : 0) + (r.firstDeath ? 2 : 0) }))
    .sort((a, b) => b.score - a.score || a.n - b.n)
    .slice(0, WON_LINES)
    .map((x) => x.n);
}
/** The rounds a review gives a line, a round 4 client's won ones too (wonPicks). */
function linePicks(input) {
  return teachable(input.rounds, MAX_ROUND_LINES, { won: round4(input) });
}
function teachable(rounds, limit = MAX_ROUND_LINES, opts) {
  const won = wonPicks(rounds, opts);
  const scored = rounds
    .filter(lineWorthy)
    .map((r) => ({ n: r.n, score: lineScore(r) }))
    .concat(rounds.filter((r) => won.includes(r.n)).map((r) => ({ n: r.n, score: -5 + 1 + (r.cause ? 2 : 0) + (r.firstDeath ? 2 : 0) })));
  const picked = [];
  const byScore = scored.slice().sort((a, b) => b.score - a.score || a.n - b.n);
  // Two passes: the best round in each third of the match first, then the rest
  // by score, so a long match is never reviewed from its opening alone.
  const last = rounds.length ? Math.max(...rounds.map((r) => r.n)) : 0;
  for (let third = 0; third < 3; third++) {
    const lo = Math.floor((last * third) / 3);
    const hi = Math.floor((last * (third + 1)) / 3);
    const best = byScore.find((r) => r.n > lo && r.n <= hi && !picked.includes(r.n));
    if (best && picked.length < limit) picked.push(best.n);
  }
  for (const r of byScore) {
    if (picked.length >= limit) break;
    if (!picked.includes(r.n)) picked.push(r.n);
  }
  return picked.sort((a, b) => a - b);
}

let AGENT_NAMES = [];
try {
  AGENT_NAMES = Object.keys(require('../valorant-data.generated.json').agents || {});
} catch {
  AGENT_NAMES = [];
}

/**
 * The agent a sentence says killed or caught the player, or null.
 *
 * Plain string search over a fixed list of phrasings, because this is a truth
 * gate and a regex here is one heredoc away from matching nothing. Measured on
 * the real Abyss review: "Peeking A vent alone against Viper" in a round Riot
 * says Phoenix won.
 */
function namesKiller(text) {
  const t = String(text || '').toLowerCase();
  for (const agent of AGENT_NAMES) {
    const a = agent.toLowerCase();
    const says = [`died to ${a}`, `killed by ${a}`, `${a} killed you`, `${a} caught you`, `${a} catches you`,
      `${a} picks you`, `${a} picked you`, `gives ${a} an easy`, `against ${a}`, `${a} kills you`];
    if (says.some((p) => t.includes(p))) return agent;
  }
  return null;
}

// "6 of 12", "six of twelve", "3 out of 5": a count the patterns already show.
const COUNT_PHRASE = /\b(\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty)\s+(?:out\s+)?of\s+(?:the\s+|your\s+)?(\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|twenty\s+\w+)\b/i;

function splitSentences(text) {
  return String(text || '').match(/[^.!?]+[.!?]+|[^.!?]+$/g) || [];
}

/*
 * NOTHING IN THE BUY PHASE IS A MISTAKE, and code says so. Everyone stands in
 * spawn holding a pistol, with the buy menu, the scoreboard or the combat
 * report open, until the barriers drop. The player's Sunset swiftplay was
 * reviewed from buy phase reads, and the model wrote, over a match lost on
 * untraded deaths: "Standing idle in spawn during buy phase was the
 * repeated mistake occurring in rounds 1, 2, 3 and 4", "Holding
 * a pistol in spawn prevents you from reacting quickly to enemy pushes" over
 * a Vandal fight in mid, "Opening menus in spawn delays your movement" over
 * the four kill round, and the focus "Move to your first piece of cover
 * immediately upon round start to avoid standing still in spawn". The prompt
 * now says never to; a round line, a summary sentence or a focus sentence
 * that still names the buy phase, the spawn, a menu, the scoreboard or the
 * barriers is dropped. Its words are English, as the killer gate's are.
 */
const BUY_BLAME = /\b(buy|buys|buying|bought|spawn|spawns|menu|menus|scoreboard|interface|interfaces|overlay|overlays|combat report|barrier|barriers)\b/i;

// A summary sentence that names a repeated mistake.
const MISTAKE_WORDS = /\b(mistake|mistakes|repeated|repeating)\b/i;

/*
 * WHAT SAYS A MISTAKE CAME BACK (8.4.1): the words for it, "most rounds", or
 * a count of times. With nothing counted, a sentence naming a mistake goes
 * only when it says this or names two rounds: before, any sentence saying
 * "mistake" went, and the player's Fracture swiftplay, nothing counted, lost
 * the summary's middle sentence, "Your one costly mistake came in round 5,
 * dying after the plant with your team up 4 against 3.", the round the match
 * was lost in and the one thing the summary had to say. And the words for how
 * often: "your most common mistake", "you often made the mistake" claim one
 * the review never counted as surely as "repeated" does.
 */
const REPEAT_WORDS = /\b(?:repeated(?:ly)?|repeating|repeats?|again|kept|keeps?|keeping|every|each time|each round|most rounds|many rounds|multiple rounds|several rounds|over and over|recurring|consistently|habit(?:s|ual|ually)?|same mistake|twice|(?:\d+|two|three|four|five|six|seven|eight|nine|ten) times|common(?:ly)?|frequent(?:ly)?|often|usual(?:ly)?|typical(?:ly)?|always|constantly|throughout|tend(?:s|ed)? to|tendency|patterns?)\b/i;

/** "4 of your 5" and "four of five", as "4/5", every one in the text. */
function countPairs(text) {
  const num = (w) => {
    const parts = String(w).toLowerCase().split(/\s+/);
    const one = (p) => (/^\d+$/.test(p) ? Number(p) : NUMBER_WORDS[p]);
    return parts.length === 2 ? (one(parts[0]) || 0) + (one(parts[1]) || 0) : one(parts[0]);
  };
  const out = [];
  const re = new RegExp(COUNT_PHRASE.source, 'gi');
  let m;
  while ((m = re.exec(String(text || ''))) !== null) out.push(`${num(m[1])}/${num(m[2])}`);
  return out;
}

/** The round numbers a sentence names after "round" or "rounds", a run of them, "1 to 3" included. */
function namedRounds(text) {
  const out = [];
  let run = false;
  let range = false;
  const words = String(roundDigits(text) || '').split(/\s+/);
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    const bare = w.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (bare === 'round' || bare === 'rounds') { run = true; range = false; continue; }
    if (!run) continue;
    // A TIME IS NO ROUND (the blind audit of 8.7.9): "Round 4, 17 s in at B
    // site" named round 17 too, and "in round 2, 31 s in" round 31, so the
    // killer gate held a true sentence to Sage's round 17 and the round gate
    // dropped one naming a round the match does not have.
    if (/^\d+$/.test(bare) && /^(?:s|secs?|seconds?)$/.test(String(words[i + 1] || '').toLowerCase().replace(/[^a-z]/g, ''))) { run = false; continue; }
    if (/^\d+$/.test(bare)) {
      const n = Number(bare);
      const from = range && out.length ? out[out.length - 1] + 1 : n;
      for (let k = from; k <= n; k++) out.push(k);
      range = false;
      if (/[.;:!?]$/.test(w)) run = false;
      continue;
    }
    if (bare === 'and' || bare === 'or') continue;
    if (bare === 'to' || bare === 'through') { range = true; continue; }
    run = false;
  }
  return out;
}

function parse(text, input, opts = {}) {
  const out = { summary: null, rounds: {}, focus: null, dropped: [], blamed: [] };
  // Only a round worth a line can have one (lineWorthy): a won round with no
  // death is never explained, whatever the model writes.
  const valid = new Set(input.rounds.filter(lineWorthy).map((r) => r.n).concat(wonPicks(input.rounds, { won: round4(input) })));
  let current = null;
  // LABELS ARE SPLIT ONTO THEIR OWN LINES FIRST. The first live bench got every
  // reply back as ONE line, because textInfer's sanitize() collapses newlines,
  // so all ten round explanations were parsed as part of the summary and the
  // review had no rounds at all. The route now asks for the raw text, and this
  // stays so a model that runs its labels together still parses.
  const lines = String(text || '')
    .replace(/\s+(R\s?\d{1,2}\s*:)/g, '\n$1')
    .replace(/\s+(FOCUS\s*:)/gi, '\n$1')
    .split('\n');
  for (const raw of lines) {
    const line = raw.replace(/\*\*/g, '').trim();
    if (!line) continue;
    const label = /^(SUMMARY|FOCUS|R\s?(\d{1,2}))\s*[:.]\s*(.*)$/i.exec(line);
    if (label) {
      const body = label[3].trim();
      if (/^summary$/i.test(label[1])) { out.summary = body; current = 'summary'; continue; }
      if (/^focus$/i.test(label[1])) { out.focus = body; current = 'focus'; continue; }
      const n = Number(label[2]);
      if (valid.has(n) && body && Object.keys(out.rounds).length < MAX_ROUND_LINES) {
        out.rounds[n] = body;
        current = n;
      } else current = null;
      continue;
    }
    // A continuation line belongs to whatever label came last.
    if (current === 'summary') out.summary = `${out.summary || ''} ${line}`.trim();
    else if (current === 'focus') out.focus = `${out.focus || ''} ${line}`.trim();
    else if (typeof current === 'number') out.rounds[current] = `${out.rounds[current]} ${line}`.trim();
  }
  // Variant A has no labels at all: the whole reply is the summary.
  if (input.variant === 'A' && !out.summary) out.summary = String(text || '').trim() || null;

  // R<n> IS THE LEDGER'S LABEL, NEVER PROSE (roundLabels), written out before
  // any gate below reads a sentence's rounds. In an English review only: the
  // words it writes are English, and a review in the player's own language
  // keeps the label, which reads in any of them (languageRule).
  if (promptName(input.context && input.context.language) === 'English') {
    if (out.summary) out.summary = roundLabels(out.summary);
    if (out.focus) out.focus = roundLabels(out.focus);
    for (const n of Object.keys(out.rounds)) out.rounds[n] = roundLabels(out.rounds[n]);
  }
  // NEVER A SEMICOLON in what the player reads (owner rule, 8.7): the prompt says so,
  // and the model is not trusted to obey it.
  if (out.summary) out.summary = noSemicolons(out.summary);
  if (out.focus) out.focus = noSemicolons(out.focus);
  for (const n of Object.keys(out.rounds)) out.rounds[n] = noSemicolons(out.rounds[n]);

  // ROUND 4: the untraded count named for the deaths it is of (qualifyCount,
  // a round 4 client only), and for every client a clause about the review
  // or the app cut off a sentence that stands without it ("so your next
  // review can check whether..."), the sentence going whole where it cannot.
  if (out.summary) out.summary = productTrim(qualifyCount(out.summary, input), out);
  if (out.focus) out.focus = productTrim(qualifyCount(out.focus, input), out);
  for (const n of Object.keys(out.rounds)) out.rounds[n] = qualifyCount(out.rounds[n], input);
  // What each field said before any gate, for the coherence pass (cohere).
  const said = { summary: out.summary, focus: out.focus };

  // NO PLAYER NAMED, FIRST (round 8). The route's name pass (coach.js
  // withoutNames, handed in as opts.withoutNames) runs here, before every
  // other gate and after `said`, so the coherence and structural passes read
  // a name drop as they read any other: the Plat Fracture review lost its
  // focus's lead to the name gate after parse, and the tradeoff tail "You give
  // up a quick kill attempt..." was served as the whole focus. A summary or
  // focus sentence naming someone goes alone, a round line whole. Logged by
  // place and kind only (said 'name'), never the word.
  const unnamed = opts && typeof opts.withoutNames === 'function' ? opts.withoutNames : null;
  // Each field's sentences the name pass took, for the coherence pass: a
  // connective after one loses the connective, not its sentence (cohere).
  const byName = { summary: new Set(), focus: new Set() };
  if (unnamed) {
    for (const field of ['summary', 'focus']) {
      if (!out[field]) continue;
      let g = null;
      try { g = unnamed(out[field]); } catch { g = null; }
      if (g && g.dropped) {
        const left = new Set(splitSentences(g.text || '').map((s) => s.trim().slice(0, 24)));
        for (const s of splitSentences(out[field]).map((x) => x.trim()).filter(Boolean)) if (!left.has(s.slice(0, 24))) byName[field].add(s.slice(0, 24));
        out[field] = g.text || null;
        out.dropped.push({ n: null, said: `${field} name`, riot: null });
      }
    }
    for (const n of Object.keys(out.rounds)) {
      let g = null;
      try { g = unnamed(out.rounds[n]); } catch { g = null; }
      if (g && g.dropped) {
        delete out.rounds[n];
        out.dropped.push({ n: Number(n), said: 'name', riot: null });
      }
    }
  }

  // NO COUNTS IN THE SUMMARY. The prompt said to quote a pattern's numbers
  // exactly or not at all, and the model still wrote "six of twelve attack
  // rounds after spike plant" on the real Abyss match, merging 6 of 12 on
  // attack with 6 of 10 after the plant. The computed patterns sit directly
  // above the summary in the window, so a count here adds nothing and risks a
  // wrong one. A sentence carrying one is dropped, unless it is a counted
  // mistake's own ("4 of your 5 deaths went unanswered"), which the summary
  // is asked to quote.
  //
  // AND A REPEATED MISTAKE IS ONE THE REVIEW COUNTED. A sentence calling
  // something the repeated mistake must name its rounds, and they must all be
  // one counted mistake's: "rounds 1, 2, 3 and 4" were no counted mistake's
  // rounds on that Sunset match. With no mistake counted there is none to name,
  // and only a claim that one came back goes (REPEAT_WORDS, or two rounds): one
  // mistake in one round is what the prompt asks the second sentence for then.
  if (out.summary) {
    // A swing fact's numbers (round 3) are the summary's to quote, as given.
    // A round 4 client's: only the SWING AND COUNTS block's and the counted
    // mistakes' (allowedPairs), the same numbers the prompt gave.
    const allowed = round4(input) ? allowedPairs(input) : new Set((input.mistakes || []).flatMap((m) => countPairs(m.detail))
      .concat((input.swing || []).flatMap((t) => countPairs(t))));
    const counted = (input.mistakes || []).filter((m) => m.rounds.length);
    const kept = splitSentences(out.summary).map((s) => s.trim()).filter((s) => {
      if (!s) return false;
      if (countPairs(s).some((p) => !allowed.has(p))) return false;
      const blame = BUY_BLAME.exec(s);
      if (blame) { out.blamed.push({ n: null, said: blame[0] }); return false; }
      if (MISTAKE_WORDS.test(s)) {
        const ns = namedRounds(s);
        if (counted.length) {
          if (!ns.length || !counted.some((m) => ns.every((n) => m.rounds.includes(n)))) return false;
        } else if (REPEAT_WORDS.test(s) || ns.length > 1) return false;
      }
      return true;
    });
    out.summary = kept.join(' ').trim() || null;
  }

  // NO LINE BLAMES THE BUY PHASE (BUY_BLAME): a round line that does is built
  // on a frame from before the round began, and goes whole.
  for (const [n, why] of Object.entries(out.rounds)) {
    const blame = BUY_BLAME.exec(why);
    if (blame) {
      delete out.rounds[n];
      out.blamed.push({ n: Number(n), said: blame[0] });
    }
  }
  if (out.focus) {
    const kept = splitSentences(out.focus).map((s) => s.trim()).filter((s) => s && !BUY_BLAME.test(s));
    if (kept.length < splitSentences(out.focus).filter((s) => s.trim()).length) out.blamed.push({ n: null, said: 'focus' });
    out.focus = kept.join(' ').trim() || null;
  }

  // THE KILLER GATE. In a round Riot verified, a line naming any other agent
  // as the one who killed or caught the player is wrong, and it is dropped
  // rather than shown next to the fact line that contradicts it. Code wins
  // over the model here for the reason it does everywhere in this product.
  for (const r of input.rounds) {
    const why = out.rounds[r.n];
    if (!why || !r.verified || !r.killer) continue;
    const named = namesKiller(why);
    if (named && named.toLowerCase() !== r.killer.toLowerCase()) {
      delete out.rounds[r.n];
      out.dropped.push({ n: r.n, said: named, riot: r.killer });
    }
  }

  // THE TRADE GATE. Live on the player's Sunset match the review model wrote
  // "No one traded the death" for round 1, which Riot's record has traded, on
  // the card beside the fact that says so. A line that contradicts the round's
  // trade, either way, is wrong where the player can see it is, and goes.
  // AND A LINE THAT ONLY RESTATES THE FACTS goes too: asked to explain a death
  // from its facts, the same model wrote every round as "You died at Mid Bottom
  // after twenty six seconds from KAY/O's Sheriff while two teammates stood
  // against three enemies", the fact line again in other words. Three of the
  // round's own facts in one line is that.
  for (const r of input.rounds) {
    const why = out.rounds[r.n];
    if (!why) continue;
    // And "hesitating at the corner gets you traded", from the same model after
    // the prompt said what a trade is: being traded is your killer dying
    // within five seconds, never the harm a line warns of.
    const contradicts = (r.traded === true && NOT_TRADED.test(why)) || (r.traded === false && WAS_TRADED.test(why))
      || TRADE_AS_HARM.test(why);
    if (contradicts) {
      delete out.rounds[r.n];
      out.dropped.push({ n: r.n, said: r.traded ? 'not traded' : 'traded', riot: r.traded ? 'traded' : 'not traded' });
      continue;
    }
    if (factsRestated(why, r) >= 3) {
      delete out.rounds[r.n];
      out.dropped.push({ n: r.n, said: 'the facts again', riot: null });
    }
  }
  // THE ROUND 3 GATES (claimGates): a line the record or the kit table
  // contradicts goes whole, a summary or focus sentence goes alone, never the
  // review. For every client: each drops only what is false or leaked.
  claimGates(out, input);
  // WHAT RIOT'S RECORD MAKES CERTAIN (record-claims.js, the blind audit of
  // 8.7.8): a kill, a killer's share, the order of events, the side, the
  // result, the team's record after the plant blamed on a player who died
  // before it, and a Deathmatch drill about an enemy agent. Every client.
  recordGates(out, input);
  // A round Riot says the player sat out is judged nowhere (8.8).
  satOutGate(out, input);

  // ROUND 4: a round line quoting a count the SWING AND COUNTS block does
  // not hold goes whole, as a summary sentence does, and from Platinum one
  // fundamentals habit at most (fundamentalsCap). A round 4 client only.
  if (round4(input)) {
    const allowed = allowedPairs(input);
    for (const n of Object.keys(out.rounds)) {
      if (countPairs(out.rounds[n]).some((p) => !allowed.has(p))) {
        delete out.rounds[n];
        out.dropped.push({ n: Number(n), said: 'count', riot: null });
      }
    }
    fundamentalsCap(out, input);
  }

  // "Riot lost 2 to 5", the record named as the one who played: the summary
  // starts with the player's own result, and a sentence that does not is no
  // sentence of theirs.
  if (out.summary) {
    const kept = splitSentences(out.summary).map((s) => s.trim()).filter((s) => s && !/^Riot\s+(?:won|lost)\b/i.test(s));
    out.summary = kept.join(' ').trim() || null;
  }
  // THE COHERENCE PASS (round 4, every client): what stays after a drop must
  // still read. A sentence that leans on a dropped one goes with it.
  for (const field of ['summary', 'focus']) {
    if (!out[field]) continue;
    const c = cohere(said[field], out[field], byName[field]);
    if (c.gone) out.dropped.push({ n: null, said: `${field} orphan`, riot: null });
    out[field] = c.text;
  }
  seamGates(out, input);
  structureGates(out, input, said);
  focusGate(out, input);
  return out;
}

/*
 * THE FOCUS STILL INSTRUCTS AFTER THE GATES (round 8, coherence.js instructs):
 * a focus with no sentence that says what to do, the Plat Fracture review's
 * "You give up a quick kill attempt to keep the advantage while the clock
 * runs.", goes (said 'focus no instruction'), and the review floor asks for
 * it again or computes one (floorOf). Of 123 review focuses served in rounds
 * 1 to 7 it was the only one that fails. English only.
 */
function focusGate(out, input) {
  if (!out.focus || promptName(input.context && input.context.language) !== 'English') return;
  if (coherenceShared === undefined) coherenceShared = shared('./coherence');
  const co = coherenceShared;
  if (!co || typeof co.instructs !== 'function' || co.instructs(out.focus)) return;
  out.focus = null;
  out.dropped.push({ n: null, said: 'focus no instruction', riot: null });
}

/*
 * THE SWING LINE, PUT IN BY CODE (round 8, SWING_SWAP_EN): the SWING AND
 * COUNTS block's first line, word for word, as the summary's second sentence,
 * unless a sentence of it already gives that line's numbers in order. A
 * round 4 client's English review with a summary only. The route's, after
 * parse and the floor: parse stays the gates' alone.
 */
function swingInto(out, input) {
  if (!out.summary || !round4(input) || promptName(input.context && input.context.language) !== 'English') return;
  const line = countLines(input)[0];
  if (!line) return;
  const nums = (t) => (String(t).match(/\d+/g) || []).join(' ');
  const want = nums(line);
  const ss = splitSentences(out.summary).map((s) => s.trim()).filter(Boolean);
  const has = (s) => (want ? ` ${nums(s)} `.includes(` ${want} `) : false);
  // Its words anywhere in the summary are it too ("and your team had no controller: Jett, ...").
  const bare = (t) => String(t).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  if (ss.some(has) || bare(out.summary).includes(bare(line))) return;
  ss.splice(1, 0, line);
  out.summary = ss.join(' ');
}

/*
 * ── THE REVIEW FLOOR (round 8, the blind audit of round 7) ─────────────────
 *
 * The Plat Fracture 5 to 1 review was served with no ROUND line, round 5 the
 * one round worth one, and the focus "You give up a quick kill attempt to keep
 * the advantage while the clock runs.", its instruction cut by the name gate.
 * Chat asked again for a reply its gates emptied; the review never did. Now a
 * review shows at least one ROUND line where a round is worth one (linePicks)
 * and a focus that says what to do (coherence.js instructs, focusGate). The
 * route asks once more with the reasons in plain words (floorNote), takes
 * from the second reply only what the first could not show (floorMerge), and
 * what is still missing is computed here (floorFill): one line from the
 * round's own facts, for the costliest death (record-claims.js costRank where
 * the review ranks them, else the best scored), and the focus from that
 * line's instruction. Both run back through parse, every gate and the name
 * pass with them, and a line any gate drops is never shown.
 */
function floorFails(out, input) {
  const fails = [];
  // Variant A, the bench's baseline (8.8 review): its prompt asks for three
  // unlabelled sentences, so it never has a round line or a focus. Floored, it
  // made a second call on every baseline review and stopped being the old one.
  if (input && input.variant === 'A') return fails;
  if (linePicks(input).length && !Object.keys(out.rounds || {}).length) fails.push('rounds');
  if (!out.focus) fails.push('focus');
  return fails;
}

const FLOOR_SAYS = {
  name: 'a line used a word that is part of a player\'s name in this match, so write each line again in different words',
  record: 'a line said something Riot\'s record of the match contradicts, so say only what the round facts give',
  lean: 'a sentence leaned on one that could not be shown, so make each sentence stand on its own',
  focus: 'the FOCUS did not say what to do, so open it on what the player should do and in which situation',
  rounds: 'no ROUND line could be shown, so write one line for each round listed, R<number>: and the lesson',
  other: 'a line broke one of the rules above, so follow them exactly',
};
/** The kind of a dropped or blamed entry, for the logs, the response's counts and the floor's reasons: never its text. */
function dropKind(d) {
  const said = String((d && d.said) || '');
  if (/(?:^| )name$/.test(said)) return 'name';
  if (/^(?:(?:summary|focus) )?record\b/.test(said)) return 'record';
  if (said === 'traded' || said === 'not traded') return 'trade';
  if (AGENT_NAMES.includes(said)) return 'killer';
  if (said === 'focus no instruction') return 'focus';
  const m = /^(?:summary|focus) (.+)$/.exec(said);
  return (m ? m[1] : said).split(' ')[0] || 'other';
}
function floorNote(out, fails) {
  const kinds = new Set((out.dropped || []).map(dropKind));
  const says = [];
  if (kinds.has('name')) says.push(FLOOR_SAYS.name);
  if (['record', 'trade', 'killer', 'count'].some((k) => kinds.has(k))) says.push(FLOOR_SAYS.record);
  if (['orphan', 'garble', 'seam'].some((k) => kinds.has(k))) says.push(FLOOR_SAYS.lean);
  if (fails.includes('focus')) says.push(FLOOR_SAYS.focus);
  if (fails.includes('rounds')) says.push(FLOOR_SAYS.rounds);
  if (!says.length) says.push(FLOOR_SAYS.other);
  return `\n\nYOUR LAST REPLY COULD NOT BE SHOWN IN FULL: ${says.join(', and ')}. Write the whole reply again, every label in it.`;
}
/** The first reply's fields that passed, the retry's where the first had none. */
function floorMerge(first, second) {
  if (!second) return first;
  const out = { ...first, rounds: { ...first.rounds }, dropped: [...first.dropped], blamed: [...first.blamed] };
  if (!Object.keys(out.rounds).length && second.rounds) out.rounds = { ...second.rounds };
  if (!out.focus && second.focus) out.focus = second.focus;
  if (!out.summary && second.summary) out.summary = second.summary;
  return out;
}

/*
 * ONE LINE FROM THE ROUND'S OWN FACTS, by its situation, the same lessons the
 * round rule names: after the plant on attack, after their plant on defence,
 * a defence with the team ahead, an untraded death with the nearest teammate
 * far or close, a first death on attack, and the side's own lesson. Each says
 * what to do, then why, and names no player, no killer and no time.
 */
function floorLine(r) {
  if (!r || !r.died) return null;
  const a = r.alive || null;
  const ahead = !!(a && a.mates > a.enemies);
  const attack = r.side === 'attacking';
  const defence = r.side === 'defending';
  if (!attack && !defence) return null;
  if (attack && r.afterPlant === true) {
    return `After the plant${ahead ? ` with your team up ${a.mates} against ${a.enemies}` : ''}, hold the spike from cover and make the defenders come to you, because the clock is theirs to beat and a second duel can give the round back.`;
  }
  if (defence && r.afterPlant === true) {
    return 'With the spike down, wait for a teammate before you take the fight for the defuse, because a retake played alone is one duel against a site that is already set.';
  }
  if (defence && ahead) {
    return `With your team up ${a.mates} against ${a.enemies}, hold your angle from cover and let them come to you, because they have to take the space back and you do not need the fight.`;
  }
  if (r.traded === false && r.mate === 'far') {
    return 'Take that fight only where a teammate can see the same enemy, because nobody was close enough to kill your killer.';
  }
  if (r.traded === false && r.mate === 'close') {
    return 'Wait until the teammate beside you is ready to swing with you, because a teammate stood close and the fight still went unanswered.';
  }
  if (attack && r.firstDeath) {
    return 'On the entry, go in on a teammate\'s flash, drone or smoke and say who follows you, because the first death leaves your team a player down before the site is taken.';
  }
  if (defence) {
    return 'On defence, play the first contact from cover and give ground to your team after it, because a defender who falls back alive keeps the numbers for the next fight.';
  }
  return 'On attack, take the next fight with a teammate set to swing right behind you, because one fight at a time with a trade ready keeps the numbers on your side.';
}
const floorFocusOf = (line) => (line ? line.replace(/,\s+because[\s\S]*$/, '.') : null);

/** The rounds the floor may compute a line for, costliest first. */
function floorOrder(input) {
  const picks = linePicks(input);
  const byN = new Map(input.rounds.map((r) => [r.n, r]));
  const lost = picks.filter((n) => lineWorthy(byN.get(n)));
  const won = picks.filter((n) => !lost.includes(n));
  const scored = (ns) => ns.slice().sort((x, y) => lineScore(byN.get(y)) - lineScore(byN.get(x)) || x - y);
  let order = scored(lost).concat(scored(won));
  const cost = costOf(input);
  if (cost && Array.isArray(cost.ranked)) {
    const ranked = cost.ranked.map((x) => x && x.n).filter((n) => picks.includes(n));
    order = ranked.concat(order.filter((n) => !ranked.includes(n)));
  }
  // A died round worth no pick still gives a focus when there is no pick.
  if (!order.length) order = input.rounds.filter((r) => r.died && !r.afk && r.verified).map((r) => r.n);
  return order.map((n) => byN.get(n)).filter(Boolean);
}

/**
 * What is still missing after the retry, computed: a ROUND line where one is
 * needed, the focus where none instructs. Each through parse (opts.withoutNames
 * the route's name pass), so a computed line no gate keeps is never shown.
 * Returns the fields it filled, ['rounds', 'focus'] or fewer.
 */
function floorFill(out, input, opts = {}) {
  const fails = floorFails(out, input);
  const filled = [];
  // The computed lines are English: a review in another language is asked again, never filled.
  if (!fails.length || promptName(input.context && input.context.language) !== 'English') return filled;
  const needRound = fails.includes('rounds');
  const needFocus = fails.includes('focus');
  const picks = new Set(linePicks(input));
  for (const r of floorOrder(input)) {
    const line = floorLine(r);
    if (!line) continue;
    const focus = floorFocusOf(line);
    const text = [picks.has(r.n) && needRound && !filled.includes('rounds') ? `R${r.n}: ${line}` : '', needFocus && !filled.includes('focus') ? `FOCUS: ${focus}` : ''].filter(Boolean).join('\n');
    if (!text) break;
    const got = parse(text, input, { withoutNames: opts.withoutNames });
    if (needRound && !filled.includes('rounds') && got.rounds[r.n]) { out.rounds = { ...out.rounds, [r.n]: got.rounds[r.n] }; filled.push('rounds'); }
    if (needFocus && !filled.includes('focus') && got.focus) { out.focus = got.focus; filled.push('focus'); }
    if ((!needRound || filled.includes('rounds')) && (!needFocus || filled.includes('focus'))) break;
  }
  return filled;
}

/*
 * THE STRUCTURAL PASS, LAST (coherence.js checkStructure, the blind audit of
 * round 6): in the summary and the focus, a lead whose sentence a gate cut
 * and a sentence that only refers back to a cut one go, read against what the
 * field said before any gate; a garbled sentence goes from any field, a round
 * line whole. English only, every client.
 */
function structureGates(out, input, said) {
  if (promptName(input.context && input.context.language) !== 'English') return;
  if (coherenceShared === undefined) coherenceShared = shared('./coherence');
  const co = coherenceShared;
  if (!co || typeof co.checkStructure !== 'function') return;
  const key = (s) => s.slice(0, 24);
  for (const field of ['summary', 'focus']) {
    if (!out[field]) continue;
    const kept = splitSentences(out[field]).map((s) => s.trim()).filter(Boolean);
    const orig = splitSentences((said && said[field]) || '').map((s) => s.trim()).filter(Boolean);
    const keptKeys = new Set(kept.map(key));
    // The field as it was said, each sentence a gate cut marked; a kept one
    // the gates rewrote (no sentence said starts as it does) read in its place.
    const rows = [];
    const used = new Set();
    for (const s of orig) {
      const k = key(s);
      if (keptKeys.has(k) && !used.has(k)) { used.add(k); rows.push({ s: kept.find((x) => key(x) === k), dropped: false, p: 0 }); } else rows.push({ s, dropped: true, p: 0 });
    }
    for (const s of kept) if (!used.has(key(s))) rows.push({ s, dropped: false, p: 0 });
    let found = [];
    try { found = co.checkStructure(rows); } catch { found = []; }
    const gone = new Set(found.map((f) => rows[f.index].s));
    for (const f of found) out.dropped.push({ n: null, said: `${field} ${f.kind === 'garble' ? 'garble' : 'orphan'}`, riot: null });
    // A connective after a cut (coherence.js repairConnective, round 8): "So"
    // struck where what it concluded from went, "That is why" gone with it.
    const fix = new Map();
    if (typeof co.repairConnective === 'function') {
      let conn = [];
      try { conn = co.repairConnective(rows.map((r) => ({ s: r.s, dropped: r.dropped || gone.has(r.s), p: 0 }))); } catch { conn = []; }
      for (const c of conn) {
        if (c.kind === 'back') { gone.add(rows[c.index].s); out.dropped.push({ n: null, said: `${field} orphan`, riot: null }); } else fix.set(rows[c.index].s, c.s);
      }
    }
    if (!gone.size && !fix.size) continue;
    out[field] = kept.filter((s) => !gone.has(s)).map((s) => fix.get(s) || s).join(' ').trim() || null;
  }
  for (const n of Object.keys(out.rounds)) {
    const ss = splitSentences(out.rounds[n]).map((s) => s.trim()).filter(Boolean);
    if (ss.some((s) => co.garbleOf(s))) {
      delete out.rounds[n];
      out.dropped.push({ n: Number(n), said: 'garble', riot: null });
      continue;
    }
    // A round line opening "So, ..." reads as its clause (repairConnective).
    if (typeof co.repairConnective === 'function' && ss.length) {
      let conn = [];
      try { conn = co.repairConnective([{ s: ss[0], dropped: false }]); } catch { conn = []; }
      if (conn.length && conn[0].kind === 'strip') out.rounds[n] = [conn[0].s, ...ss.slice(1)].join(' ');
    }
  }
}

let recordClaims;
let coherenceShared;
const shared = (name) => { try { return require(name); } catch { return null; } };

/*
 * WHAT EACH DEATH COST, FROM PLATINUM (record-claims.js costRank, the blind
 * audit of 8.7.9): the review's prompt gets the finished line, and the study
 * list the costliest deaths' topics. A round 4 client at Platinum or above
 * only; '' and [] otherwise, so every other review is as before.
 */
function costOf(input) {
  if (!round4(input) || !HIGH_BANDS.has(knowledge.validBand(input.context && input.context.rankBand))) return null;
  if (recordClaims === undefined) recordClaims = shared('./record-claims');
  const rc = recordClaims;
  if (!rc || typeof rc.costRank !== 'function') return null;
  try {
    const ctx = rc.contextOfReview(input);
    const ranked = rc.costRank(ctx);
    const f = input.final || {};
    const total = Number.isInteger(f.team) && Number.isInteger(f.enemy) ? f.team + f.enemy : null;
    const buys = new Map((input.rounds || []).filter((r) => r.buy).map((r) => [r.n, r.buy]));
    return { ranked, line: costReasonLine(ranked, total, { buyOf: (n) => buys.get(n) }) || rc.costLine(ctx) };
  } catch { return null; }
}

/*
 * WHY A DEATH COST, AS FINISHED FACTS (round 7, the blind audit of round 6).
 * The costliest deaths line ranked the deaths in code but left the model to
 * say why, and it invented: Fracture's round 5 became "the last round of the
 * match" in a match of 6. The line is costRank's own, every reason a fact
 * code computed (the round lost or won, the numbers the death left, before
 * or after the plant, traded or not, the first death), and each round now
 * says where it sat in the match ("round 5 of the 6 the match had, not its
 * last"), with the rule to state those reasons and no other. Shared by Ask
 * Coach (chat-prompt.js). '' with fewer than two deaths ranked, or with no
 * total known (the caller keeps record-claims.js costLine then).
 */
const COST_RULE = ' Why each of these deaths cost is said here in full: state only these reasons, in these words, and never give another one. '
  + 'A round is the last round, a pistol round, match point or a deciding round only where this line says so.';
function costReasonLine(ranked, total, opts = {}) {
  const limit = Number.isInteger(opts.limit) ? opts.limit : 3;
  const buyOf = typeof opts.buyOf === 'function' ? opts.buyOf : () => null;
  if (!Array.isArray(ranked) || ranked.length < 2 || !Number.isInteger(total) || total < 1 || total > 40) return '';
  if (ranked.some((x) => !x || !Number.isInteger(x.n) || x.n > total || !Array.isArray(x.words))) return '';
  const top = ranked.slice(0, limit);
  const lostAny = ranked.some((x) => x.result === 'lost');
  const where = (n) => (n === total ? `round ${n} of the ${total} the match had, its last round`
    : n === 1 ? `the first of the ${total} rounds the match had` : `round ${n} of the ${total} the match had, not its last`);
  return 'THE COSTLIEST DEATHS, ranked in code from Riot\'s record by what each cost (a lost round above a won one, then the numbers the death left, after the plant above before, not traded above traded): '
    + top.map((x, i) => `${['First', 'Second', 'Third'][i] || 'Then'}, round ${x.n}, ${x.words.concat(RECORD_BUY[buyOf(x.n)] ? [`the team on ${RECORD_BUY[buyOf(x.n)]}`] : [], where(x.n)).join(', ')}`).join('. ')
    + '. When you name a death or a round as the mistake, the lever or what to fix first, name the costliest first'
    + (lostAny ? ', and never rank a death in a round your team won above one in a round it lost' : '')
    + '.' + COST_RULE;
}
function costLineOf(input) {
  const c = costOf(input);
  return c && c.line ? c.line : '';
}

/*
 * THE TRUE SENTENCES OF A LINE THE RECORD CUT (8.8 review). A round line went
 * whole for one sentence the record contradicts, and the floor put its
 * computed line in place: the Fracture Iron R5 "As your teammate plants, hold
 * from cover ... You lost a fair fight on the shot." lost the true second
 * sentence with the false first. The line's other sentences are kept where
 * none leans on the cut one (a pointer, "That ...", "So ..." after it), and
 * where what is left gives no instruction the round's computed line
 * (floorLine) leads it, so the line still says what to do. Every later gate
 * still reads the line. Null when nothing is fit to keep.
 */
const LEANS_BACK = /^(?:that|this|it|which|then|so|these|those|there)\b/i;
function lineRest(ss, drops, rewrites, r) {
  if (coherenceShared === undefined) coherenceShared = shared('./coherence');
  const co = coherenceShared;
  if (!co || typeof co.instructs !== 'function' || typeof co.isPointer !== 'function') return null;
  const gone = new Set(drops.map((f) => f.index));
  const rest = [];
  for (let i = 0; i < ss.length; i++) {
    if (gone.has(i)) continue;
    const s = rewrites.get(i) || ss[i];
    if (co.isPointer(s) || (gone.has(i - 1) && LEANS_BACK.test(s.trim()))) return null;
    rest.push(s);
  }
  if (!rest.length) return null;
  const text = rest.join(' ');
  if (co.instructs(text)) return text;
  const lead = floorLine(r);
  return lead ? `${lead} ${text}` : null;
}

/** The record gates over a parsed review (record-claims.js checkRows): a round line goes whole, a summary or focus sentence alone. English only. */
function recordGates(out, input) {
  if (promptName(input.context && input.context.language) !== 'English') return;
  if (recordClaims === undefined) recordClaims = shared('./record-claims');
  const rc = recordClaims;
  if (!rc || typeof rc.checkRows !== 'function') return;
  const ctx = rc.contextOfReview(input);
  if (!ctx.rounds.size) return;
  // A hit with a rewrite (round 8, checkAlone: "nobody could trade you" of a
  // death with a teammate close and no trade) keeps the sentence in the
  // record's words; every other hit drops it.
  const split = (found) => ({ drops: found.filter((f) => f.reason), rewrites: new Map(found.filter((f) => !f.reason && f.rewrite).map((f) => [f.index, f.rewrite])) });
  for (const n of Object.keys(out.rounds)) {
    const ss = splitSentences(out.rounds[n]).map((s) => s.trim()).filter(Boolean);
    const { drops, rewrites } = split(rc.checkRows(ss.map((s) => ({ s, p: 0 })), ctx, { round: Number(n) }));
    if (drops.length) {
      delete out.rounds[n];
      out.dropped.push({ n: Number(n), said: `record ${drops[0].kind}`, riot: null });
      const rest = lineRest(ss, drops, rewrites, (input.rounds || []).find((r) => r.n === Number(n)) || null);
      if (rest) out.rounds[n] = rest;
    } else if (rewrites.size) out.rounds[n] = ss.map((s, i) => rewrites.get(i) || s).join(' ');
  }
  for (const field of ['summary', 'focus']) {
    if (!out[field]) continue;
    const ss = splitSentences(out[field]).map((s) => s.trim()).filter(Boolean);
    const { drops, rewrites } = split(rc.checkRows(ss.map((s) => ({ s, p: 0 })), ctx));
    if (!drops.length && !rewrites.size) continue;
    const gone = new Set(drops.map((f) => f.index));
    for (const f of drops) out.dropped.push({ n: null, said: `${field} record ${f.kind}`, riot: null });
    out[field] = ss.map((s, i) => rewrites.get(i) || s).filter((_, i) => !gone.has(i)).join(' ').trim() || null;
  }
}

/*
 * THE SEAMS (coherence.js repairSeams, the blind audit of 8.7.8): a swing fact
 * glued on with its capital, "even as You died 3 times in 6 rounds", "both
 * sides: You lost 10 rounds in a row", "and You died 5 times", written you; a
 * sentence a cut left ending on a conjunction goes, a round line whole. Last,
 * after every gate, so what is shown reads. English only, every client.
 */
function seamGates(out, input) {
  if (promptName(input.context && input.context.language) !== 'English') return;
  if (coherenceShared === undefined) coherenceShared = shared('./coherence');
  const co = coherenceShared;
  if (!co || typeof co.repairSeams !== 'function') return;
  const mend = (text) => {
    const ss = splitSentences(text).map((s) => s.trim()).filter(Boolean);
    // The SWING line glued on with "despite this:" is split first (round 8, splitSwingSeam).
    const kept = ss.map((s) => co.repairSeams(typeof co.splitSwingSeam === 'function' ? co.splitSwingSeam(s) || s : s));
    // A text nothing was repaired in is kept as it was, its spacing too.
    if (kept.every((s, i) => s === ss[i])) return { text, cut: false };
    return { text: kept.filter(Boolean).join(' ').trim() || null, cut: kept.some((s) => s === null) };
  };
  for (const field of ['summary', 'focus']) {
    if (!out[field]) continue;
    const m = mend(out[field]);
    if (m.cut) out.dropped.push({ n: null, said: `${field} seam`, riot: null });
    out[field] = m.text;
  }
  for (const n of Object.keys(out.rounds)) {
    const m = mend(out.rounds[n]);
    if (m.cut || !m.text) {
      delete out.rounds[n];
      out.dropped.push({ n: Number(n), said: 'seam', riot: null });
    } else out.rounds[n] = m.text;
  }
}

/*
 * ── THE ROUND 4 GATES (Nov 2026) ───────────────────────────────────────────
 *
 * From the live re-audit of 8.7.7, each certain before it drops anything:
 *
 *   product   the review talking about itself or the app: "so your next
 *             review can check whether the fight had an answer"
 *   library   a number from other matches nothing in a review states: "5 of
 *             your last 6 matches", "your average of 32%"
 *   state     advice the round's own record contradicts: an attacker with no
 *             plant told to let the enemy come, advice that needs a planted
 *             spike in a round with none
 *   orphan    a sentence leaning on one a gate dropped: "Fight her with a
 *             teammate" after the sentence naming her went
 *   count     a round line's count the SWING AND COUNTS block does not hold
 *   fundamentals  from Platinum, a second line teaching the trade habit
 *
 * English words, as the killer gate's.
 */
const PRODUCT_TALK = /\b(?:(?:your|the|this|next|a|each|every|future|later)\s+(?:next\s+|later\s+|future\s+)?reviews?|Occlara|the app|this app|the coach (?:can|will|could|would)|(?:I|we)(?:'ll| will) (?:check|track|watch|remind|look)|(?:the|your) AI log|(?:the|your) match library)\b/i;
// The clause openers a product clause can be cut at, the sentence before it standing alone.
const CLAUSE_CUT = /(?:,\s*(?:so|and|which|then|to)\s|\s(?:so that|so|and then|to see|and see)\s)/gi;
// "your usual spot" is this match's place, never a number from others.
const CROSS_MATCH = /\bof your last (?:\d+|two|three|four|five|six|seven|eight|nine|ten) (?:matches|games)\b|\byour average\b|\byour (?:usual|normal) (?:rate|number|score|headshot|percentage)\b|\b(?:above|below|under|over) your (?:usual|normal)\b|\b(?:in|across|over|from) (?:your|the) (?:last|recent|previous|past) (?:\d+ |few |several )?(?:matches|games)\b|\b(?:most|many|all) of your (?:recent |last |past )?(?:matches|games)\b|\bin (?:every|each) (?:of your )?match(?:es)?\b/i;
const COME_TO_YOU = /\b(?:let|make|letting|making|have|force|forcing)\s+(?:the\s+)?(?:enemy|enemies|defenders?|attackers?|them|him|her|the other team|opponents?)\s+(?:\w+\s+)?(?:come|walk|push|swing)\s+(?:to|into|onto|at)\s+you\b|\bwait(?:ing)? for (?:them|the enemy|the enemies|the defenders?|him|her) to (?:come|push|swing)\b/i;
const CLOCK_YOURS = /\b(?:the clock|time) (?:is|was) (?:on )?(?:your|our) side\b|\bplay(?:ing)? (?:for|out) the (?:clock|time)\b|\b(?:use|using) the clock\b|\brun(?:ning)? (?:down )?the clock\b|\blet(?:ting)? (?:the clock|time) (?:work|run) for you\b|\bthe clock (?:works|is working) for you\b/i;
const SPIKE_NEEDED = /\b(?:after (?:the|your|their|a) plant|after (?:you|they|your team) plant(?:ed)?|once (?:the spike|it) (?:is|was|goes) (?:down|planted)|post plant|(?:hold|holding|guard|guarding|watch|watching|play|playing) (?:the|their|your) (?:spike|plant)|(?:off|near|around|over|onto) the spike|defus(?:e|ed|es|ing|al)|the planted spike|spike (?:is|was) (?:down|planted))\b/i;
// A drill avoided is no drill: "practise it in your next match rather than in Deathmatch".
const DRILL_AVOIDED = /\b(?:rather than|instead of|not|never|outside(?: of)?)\s+(?:in\s+|at\s+|on\s+|from\s+)?(?:a\s+|the\s+)?(?:[Dd]eath ?[Mm]atch|Range)\b/;
// "whether anyone could help you": a teammate in other words.
const DRILL_HELP = /\b(?:anyone|someone|somebody|nobody|no one) (?:could|can|is able to|would|will) (?:help|follow|see|trade|swing|answer)\b|\ba second (?:player|person)\b|\bfollows? you in\b|\bclose enough to (?:kill|trade|shoot|follow)\b/i;
// A study note about the trade habit (study, round 4).
const TRADE_NOTE = /\b(?:trade|traded|trading|tradeable|close enough to (?:kill|shoot|swing|follow))\b/i;
// A line teaching the trade habit (fundamentalsCap).
// The habit taught, never the fact said: "nobody could trade you" is the
// round's fact, and "the same angle" alone is a repeek.
const TRADE_HABIT = /\bclose enough to (?:kill|trade|shoot|follow|swing)\b|\b(?:a|your|the nearest) teammate (?:is |was )?(?:close|nearby|near)\b|\bnear a teammate\b|\bteammate who (?:can|could|will) (?:kill|trade|answer|swing)\b|\bsomeone can (?:see|trade)\b|\b(?:name|call|say|tell)\s+(?:the\s+|a\s+|which\s+|who\s+|your\s+)?(?:teammate|player)?\s*(?:will\s+|who will\s+|is\s+)?follow|\bwho (?:will )?follows?\b|\bfollow(?:s|ing)? you (?:in|into|closely|close)\b|\b(?:see|watch|swing) the same angle\b/i;

/** A text with a clause about the review or the app cut off where the rest stands alone, or null where it cannot. */
function productCut(s) {
  const m = PRODUCT_TALK.exec(s);
  if (!m) return s;
  let cut = -1;
  for (const c of s.slice(0, m.index).matchAll(CLAUSE_CUT)) cut = c.index;
  if (cut < 0) return null;
  const head = s.slice(0, cut).trim().replace(/[,\s]+$/, '');
  if (head.split(/\s+/).length < 5 || PRODUCT_TALK.test(head)) return null;
  return `${head}.`;
}

function productTrim(text, out) {
  if (!text) return text;
  const kept = [];
  for (const raw of splitSentences(text)) {
    const s = raw.trim();
    if (!s) continue;
    const c = productCut(s);
    if (c !== s) out.dropped.push({ n: null, said: c ? 'product clause' : 'product', riot: null });
    if (c) kept.push(c);
  }
  return kept.join(' ').trim() || null;
}

/*
 * WHO IS ON THE CLOCK (8.7.10). Before a plant the attackers have to take a
 * site in time, after it the defenders have to reach the spike in time. The
 * Corrode review's round 1, an attack round lost after the plant, said "After
 * the plant, hold the spike from cover ..., so the attackers have to move
 * against the clock": the side was Riot's and right, and the line turned the
 * clock around. A sentence that sets itself after the plant (SPIKE_NEEDED)
 * and puts the attackers on the clock, or one in a round Riot's record says
 * was never planted that puts the defenders on it, is the round state wrong.
 */
const CLOCK_ON = /\b(?:(?:make|makes|making|force|forces|forcing|so|leave|leaving|let|letting)\s+the\s+(attackers?|defenders?)\s+(?:have to\s+|must\s+|need to\s+)?(?:spend|burn|use up|waste)\s+(?:time|the clock|seconds)|the\s+(attackers?|defenders?)\s+(?:have|has|had|must|need|needs)\s+to\s+(?:move|play|beat|race|work|rush|hurry|act)\s+against\s+the\s+clock|the\s+(attackers?|defenders?)\s+(?:are|is|were|was)\s+(?:on|against|racing)\s+the\s+clock)\b/i;
// record-claims.js PRE_PLANT, the same words.
const CLOCK_PRE_PLANT = /\b(?:until|before)\s+(?:(?:they|the\s+attackers|you|your\s+team|the\s+team)\s+)?(?:plant(?:s|ed)?|get\s+the\s+plant|the\s+plant|a\s+plant|any\s+plant|the\s+spike\s+(?:is|goes)\s+down)\b/i;
function clockWrong(text, r) {
  for (const s of splitSentences(String(text || ''))) {
    const m = CLOCK_ON.exec(s);
    if (!m) continue;
    const who = String(m[1] || m[2] || m[3]).toLowerCase().startsWith('attack') ? 'attackers' : 'defenders';
    // A sentence telling both phases, the attackers on the clock until they
    // plant and the defenders after, is the rule itself (verify round 6).
    if (SPIKE_NEEDED.test(s) && who === 'attackers' && !CLOCK_PRE_PLANT.test(s)) return true;
    if (r && r.verified && !r.planted && !SPIKE_NEEDED.test(s) && who === 'defenders') return true;
  }
  return false;
}

/** The round state a line's advice contradicts, or null: certain only on a round Riot's record holds. */
function stateWrong(text, r) {
  if (clockWrong(text, r)) return 'round state';
  if (!r || !r.verified || r.planted) return null;
  if (r.side === 'attacking' && (COME_TO_YOU.test(text) || CLOCK_YOURS.test(text))) return 'round state';
  if (SPIKE_NEEDED.test(text)) return 'no plant';
  return null;
}

/** From Platinum, the trade habit in one place at most: the focus first, else the first round line. */
function fundamentalsCap(out, input) {
  if (!HIGH_BANDS.has(knowledge.validBand(input.context && input.context.rankBand))) return;
  let used = !!(out.focus && TRADE_HABIT.test(out.focus));
  for (const n of Object.keys(out.rounds).map(Number).sort((a, b) => a - b)) {
    if (!TRADE_HABIT.test(out.rounds[n])) continue;
    if (!used) { used = true; continue; }
    delete out.rounds[n];
    out.dropped.push({ n, said: 'fundamentals', riot: null });
  }
}

/*
 * A SENTENCE THAT LEANS ON A DROPPED ONE. After a gate dropped a sentence,
 * the next one going on from it ("It", "This", "They", "Her" opening it)
 * goes too, and anywhere in the field a "she", "her", "he", "him" or "his"
 * with no agent, enemy or teammate named before it or in it has nothing to
 * point to. A field nothing was dropped from keeps its openers.
 */
const LEANS = /^(?:It|Its|This|That|These|Those|They|Them|Their|He|She|His|Her|Him|Hers|Which|So|Then|Also)\b/;
const THIRD = /\b(?:she|her|hers|he|him|his)\b/i;
// Who a "her" can point to: an agent (abilityFacts.agentsIn) or one of these.
// Not "a teammate", which the advice itself names: "Fight her with a teammate".
const NAMES_SOMEONE = /\b(?:enemy|enemies|opponents?|defenders?|attackers?|killers?|duelists?|sentinels?|controllers?|initiators?|lurkers?|anchors?|snipers?|Operators?)\b/i;
/*
 * A connective that only joins two pieces of advice. After a sentence the NAME
 * pass took (byName, round 8 review), "Also, use your smoke before you swing
 * wide on A." stands on its own, so it keeps as "Use your smoke before you
 * swing wide on A."; before round 8 the name pass ran after this one and kept
 * it, and moved into parse it emptied the focus. After any other gate's drop
 * the sentence still goes whole, since its claim may rest on the false one, and
 * a referential opener (It, This, They, Her) goes after any drop.
 */
const CONNECTIVE = /^(?:So|Then|Also),?\s+(?=\S)/;
function cohere(before, now, byName) {
  if (!now) return { text: now, gone: false };
  const orig = splitSentences(before).map((s) => s.trim()).filter(Boolean);
  const kept = splitSentences(now).map((s) => s.trim()).filter(Boolean);
  const key = (s) => s.slice(0, 24);
  const keptKeys = new Set(kept.map(key));
  const someone = (s) => NAMES_SOMEONE.test(s) || abilityFacts.agentsIn(s).length > 0;
  const out = [];
  let gone = false;
  for (const s of kept) {
    const at = orig.findIndex((o) => key(o) === key(s));
    const afterDrop = at > 0 && !keptKeys.has(key(orig[at - 1]));
    const leans = afterDrop && LEANS.test(s);
    const dangling = THIRD.test(s) && !someone(s) && !out.some(someone) && orig.length > kept.length;
    const joinsOnly = leans && !dangling && byName && byName.has(key(orig[at - 1])) && CONNECTIVE.test(s);
    if (joinsOnly) {
      const rest = s.replace(CONNECTIVE, '');
      out.push(rest.charAt(0).toUpperCase() + rest.slice(1));
      continue;
    }
    if (leans || dangling) { gone = true; keptKeys.delete(key(s)); continue; }
    out.push(s);
  }
  return { text: out.join(' ').trim() || null, gone };
}

// What a line says of a round's trade (TRADE GATE in parse). English, as the
// killer gate's words are.
const NOT_TRADED = /\b(?:no one|nobody|no teammate|no ally|not|never)\s+(?:was\s+|were\s+|got\s+|could\s+|did\s+)?(?:able to\s+)?trad(?:e|ed|ing)\b|\buntraded\b|\bunanswered\b|\bwithout (?:a |any )?trade\b/i;
const WAS_TRADED = /\b(?:you were|you got|was|got|were) traded\b|\btraded by (?:a |your )?teammate\b/i;
const TRADE_AS_HARM = /\bget(?:s|ting)? you traded\b|\b(?:leads? to|ends? in|means) (?:you )?(?:being|getting) traded\b/i;

/*
 * ── THE ROUND 3 GATES (Nov 2026) ───────────────────────────────────────────
 *
 * From the audit's 24 real reviews, each a thing a player read beside the
 * fact line that contradicts it, and each certain before it drops anything:
 *
 *   template   the prompt's own words, "as when this happens, do that"
 *   kit        an ability's key, owner, ultimate or effect the game data
 *              contradicts (ability-facts.js checkText): "Alarmbot (C)",
 *              "the alarmbot slows"
 *   state      an "N against M" the round's kill feed never stood at, a
 *              health number nothing states (ability-facts.js checkState):
 *              "especially risky at 11 HP", in all four bands of Pearl
 *   orb        an ultimate orb, which nothing in the ledger ever states:
 *              "When you go for the orb", Split round 6 in all four bands
 *   carrier    who held the spike, which nothing states: "you have the spike"
 *   utility    an enemy ability blamed for a death Riot's record says a gun
 *              made
 *   praise     a death in a lost round called a sound or good choice
 *   aim        "aim is not the problem" where nothing says so
 *   drill      a Deathmatch or Range drill that needs a teammate
 *
 * A round line goes whole, a summary or focus sentence goes alone, and each
 * is logged in out.dropped by its kind. English words, as the killer gate's.
 */
const TEMPLATE_LEAK = /\bwhen this happens\b|\bthen do that\b|(?:^|[,.;:]\s*)do that\b|\bthe move to make\b|\bthe moment to notice\b/i;
const ORB = /\borbs?\b/gi;
// The kit's own orbs, and Reyna's soul orbs, are real: "Slow Orb", "Soul Orb".
const KIT_ORB = /\b(?:soul|slow|healing|barrier|flare)\s+$/i;
const SPIKE_CARRY = /\byou (?:have|had|have got|were carrying|are carrying|carry|carried|picked up|dropped) the spike\b|\bspike carrier\b|\bcarrying the spike\b|\bthe spike on you\b|\bdropped spike\b/i;
// The death praised, never the fight described: "a sound fight lost on the
// shot" is the look's own reading of a lost duel, and stays.
const PRAISE = /\b(?:was|is|made (?:it|this)|making (?:it|this)) (?:a |an )?(?:sound|good|smart|correct|fine|great|right)(?: \w+)? (?:choice|call|play|entry|take|decision)\b/i;
const AIM_DENIED = /\baim (?:is not|was not|isn't|wasn't) (?:the |your )?(?:main |real |first |biggest )?(?:problem|issue|thing to fix)\b|\baim (?:is not|was not|isn't|wasn't) what\b|\bnot (?:an |a |your )?aim (?:problem|issue|duel)\b|\bnot a lost aim duel\b|\baim (?:is|was) fine\b|\bnot (?:about|down to) (?:your )?aim\b/i;
// The Range with its capital, the mode's name: "play in range of your
// teammates" is a distance, no drill, and Team Deathmatch has a team (the
// round 3 verification).
const DRILL_PLACE = /(?<![Tt]eam\s)(?<![A-Za-z])(?:[Dd]eath ?[Mm]atch|DEATHMATCH|the Range|in Range)(?![A-Za-z])/;
const DRILL_TEAM = /\b(?:teammates?|trade|traded|trading|your team|comms|duo|squad)\b/i;
const escRe = (s) => String(s).replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');

/** Whether the match says nothing about aim either way, so a denial of it is unsupported. */
function aimDenialOk(input, r) {
  if (r) return !!r.cause && r.cause !== 'lost-duel';
  const aim = aimEvidence(input);
  if (aim) return false;
  const deaths = (input.rounds || []).filter((x) => x.died);
  return deaths.length > 0 && deaths.every((x) => x.cause && x.cause !== 'lost-duel');
}

/** An orb named in a text that is no kit's orb, or null. */
function fabricatedOrb(text, input, r) {
  const reyna = (a) => String(a || '').toLowerCase() === 'reyna';
  if (reyna(input.context && input.context.agent) || (r && reyna(r.killer))) return null;
  for (const m of String(text || '').matchAll(ORB)) {
    if (!KIT_ORB.test(String(text).slice(0, m.index))) return m[0];
  }
  return null;
}

/** Whether a line blames one of the killer's abilities for a death Riot says a gun made. */
function utilityBlamed(text, r) {
  if (!r || !r.verified || !r.died || !r.killer || !r.weapon) return false;
  if (!knowledge.enemyWeaponsOf([r.weapon]).length) return false;
  const kit = abilityFacts.TABLE.agents[Object.keys(abilityFacts.TABLE.agents).find((a) => a.toLowerCase() === r.killer.toLowerCase())];
  if (!kit) return false;
  for (const e of Object.values(kit)) {
    const name = escRe(e.name);
    const by = new RegExp(`\\b(?:died to|dying to|death to|killed by|lost to|fell to)\\s+(?:(?:his|her|their|the|an?|that|this|${escRe(r.killer)}'s)\\s+)?${name}\\b`, 'i');
    const did = new RegExp(`\\b${name}\\s+(?:killed|kills|finished|finishes)\\s+you\\b`, 'i');
    if (by.test(text) || did.test(text)) return true;
  }
  return false;
}

/** What makes a text false or leaked, by kind, or null. r is its round, where it has one. */
function claimOf(text, input, r) {
  const t = String(text || '');
  if (TEMPLATE_LEAK.test(t)) return 'template';
  const agents = input.context && input.context.agent ? [input.context.agent] : undefined;
  // "His ultimate" in a round line is the round's killer's (round 4).
  if (abilityFacts.checkText(t, { agents, ...(r && r.verified && r.killer ? { ultOf: r.killer } : {}) }).length) return 'kit';
  // Round 4, every client: the review or the app, another match's number,
  // and advice the round's own record contradicts.
  if (PRODUCT_TALK.test(t)) return 'product';
  if (CROSS_MATCH.test(t)) return 'library';
  const wrong = stateWrong(t, r);
  if (wrong) return wrong;
  const facts = { rounds: (input.rounds || []).map((x) => ({ n: x.n, ...(x.standings ? { standings: x.standings } : {}), ...(x.alive ? { alive: x.alive } : {}) })),
    ...(r ? { round: r.n } : {}) };
  if (abilityFacts.checkState(r ? `ROUND ${r.n}: ${t}` : t, facts).length) return 'state';
  if (fabricatedOrb(t, input, r)) return 'orb';
  if (SPIKE_CARRY.test(t)) return 'carrier';
  if (r && utilityBlamed(t, r)) return 'utility';
  if (r && r.result === 'lost' && r.died && PRAISE.test(t)) return 'praise';
  if (AIM_DENIED.test(t) && !aimDenialOk(input, r)) return 'aim';
  if (DRILL_PLACE.test(t) && (DRILL_TEAM.test(t) || DRILL_HELP.test(t)) && !DRILL_AVOIDED.test(t)) return 'drill';
  // Round 8 (game-claims.js): the shared team words read past a disclaimer,
  // a one shot the damage table does not give, firing on the move, a kit's
  // bullets, and where the crosshair sat or what the player saw with no look
  // of the round saying it (every look of the match for the summary and focus).
  if (gameClaims.teamDrill(t)) return 'drill';
  if (gameClaims.checkOneShot(t)) return 'lethal';
  if (gameClaims.checkMoveFire(t) || gameClaims.checkBullets(t)) return 'kit';
  const looks = r ? String(r.seen || '') : (input.rounds || []).map((x) => String((x && x.seen) || '')).join(' ');
  if (gameClaims.checkUnobserved(t, looks)) return 'unseen';
  return null;
}

function claimGates(out, input) {
  const byN = new Map((input.rounds || []).map((r) => [r.n, r]));
  for (const n of Object.keys(out.rounds)) {
    const kind = claimOf(out.rounds[n], input, byN.get(Number(n)) || null);
    if (kind) {
      delete out.rounds[n];
      out.dropped.push({ n: Number(n), said: kind, riot: null });
    }
  }
  for (const field of ['summary', 'focus']) {
    if (!out[field]) continue;
    const sentences = splitSentences(out[field]).map((s) => s.trim());
    // A Deathmatch drill's frame read across the field's sentences (round 8).
    const framed = new Set(gameClaims.soloDrillFrame(sentences.map((s) => ({ p: 0, s }))).map((o) => o.index));
    const kept = sentences.filter((s, i) => {
      if (!s) return false;
      const kind = claimOf(s, input, null) || (framed.has(i) ? 'drill' : null);
      if (kind) out.dropped.push({ n: null, said: `${field} ${kind}`, riot: null });
      return !kind;
    });
    out[field] = kept.join(' ').trim() || null;
  }
}

/** How many of the round's own facts a line names: the killer, the weapon, the place, the seconds, the numbers. */
function factsRestated(why, r) {
  const text = String(why || '');
  const has = (word) => !!word && new RegExp(`(^|[^A-Za-z0-9])${String(word).replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}($|[^A-Za-z0-9])`, 'i').test(text);
  let n = 0;
  if (has(r.killer)) n += 1;
  if (has(r.weapon)) n += 1;
  if (r.deathSpot && has(r.deathSpot)) n += 1;
  if (/\b(?:\d+|[a-z]+(?:[ ][a-z]+)?)\s+seconds?\b/i.test(text) && /\bseconds?\b/i.test(text)) n += 1;
  if (/\b(?:\d|one|two|three|four|five)\s+(?:teammates?\s+|allies\s+)?(?:stood\s+|standing\s+)?(?:against|versus|vs\.?)\s+(?:\d|one|two|three|four|five)\b/i.test(text)) n += 1;
  return n;
}

const NUMBER_WORDS = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16,
  seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20,
};
const CONNECTORS = new Set(['and', 'to', 'through', 'or']);

/**
 * "rounds two, six, seven and fourteen" becomes "rounds 2, 6, 7 and 14".
 *
 * The prompt asks for digits and the model ignores it about half the time,
 * measured on the bench, and a list of spelled numbers is the least readable
 * sentence in the review. Deterministic, so it is a fix rather than a request.
 * Only the run of numbers straight after "round" or "rounds" is touched, so
 * "one teammate" elsewhere in a sentence is left alone.
 */
function roundDigits(text) {
  if (!text) return text;
  const toks = String(text).split(/(\s+)/);
  let inRun = false;
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i];
    if (/^\s+$/.test(t)) continue;
    const bare = t.toLowerCase().replace(/[^a-z]/g, '');
    const trail = t.slice(t.replace(/[^A-Za-z]+$/, '').length);
    if (bare === 'round' || bare === 'rounds') { inRun = true; continue; }
    if (!inRun) continue;
    if (bare in NUMBER_WORDS) {
      let value = NUMBER_WORDS[bare];
      // "twenty two": fold the next word in when it is a single digit.
      let j = i + 1;
      while (j < toks.length && /^\s+$/.test(toks[j])) j++;
      const next = j < toks.length ? toks[j].toLowerCase().replace(/[^a-z]/g, '') : '';
      if (value === 20 && next in NUMBER_WORDS && NUMBER_WORDS[next] < 10 && !/[^A-Za-z]$/.test(t)) {
        value += NUMBER_WORDS[next];
        const nextTrail = toks[j].slice(toks[j].replace(/[^A-Za-z]+$/, '').length);
        toks[i] = String(value) + nextTrail;
        for (let k = i + 1; k <= j; k++) toks[k] = '';
        i = j;
        continue;
      }
      toks[i] = String(value) + trail;
      continue;
    }
    if (/^\d+$/.test(bare.replace(/[^0-9]/g, '')) && /^\d/.test(t)) continue;
    if (CONNECTORS.has(bare)) continue;
    inRun = false;
  }
  // COMMAS BETWEEN BARE ROUND NUMBERS. The model wrote "rounds 3 4 6 and 9" on
  // the real Abyss match; a list of four numbers with no commas reads as one
  // number. A bare number followed directly by another gets a comma.
  const words = toks.join('').split(/(\s+)/);
  const isNum = (w) => w !== undefined && /^\d+$/.test(w);
  let run = false;
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    if (/^\s+$/.test(w)) continue;
    const bare = w.toLowerCase().replace(/[^a-z]/g, '');
    if (bare === 'round' || bare === 'rounds') { run = true; continue; }
    if (!run) continue;
    if (isNum(w)) {
      let j = i + 1;
      while (j < words.length && /^\s+$/.test(words[j])) j++;
      if (isNum(words[j]) || isNum((words[j] || '').replace(/[.,;:!?]+$/, ''))) words[i] = w + ',';
      continue;
    }
    if (/^\d+[,.;:!?]$/.test(w) || CONNECTORS.has(bare)) continue;
    run = false;
  }
  return words.join('');
}

/*
 * "R1, R3 AND R4" IS THE LEDGER'S LABEL, NEVER PROSE (8.4.1). The prompt names
 * each round R1, R2 (roundLine, the round lines asked for), and the model
 * copied it: the player's Fracture swiftplay summary said "You also traded
 * teammates and survived R1, R3 and R4." where the rest of the page says
 * rounds. roundDigits() turns spelled numbers after "round" into digits and
 * never saw these, and the summary's gates find a sentence's rounds by the
 * word "round" (namedRounds). So a run of them is written out, "rounds 1, 3
 * and 4", "round 5", "Round 5" opening a sentence, "R1 to R3" and "R1-R3" as
 * "rounds 1 to 3"; one already after "round" or "rounds" keeps that word,
 * made to agree with the count. Only a capital R, a word of its own, one or
 * two digits: "AR15", "R2D2" and "R100" are left alone.
 */
const ROUND_LABELS = /(\b[Rr]ounds?\s+)?\bR(\d{1,2})\b((?:(?:\s*,\s*(?:(?:and|or)\s+)?|\s*&\s*|\s*-\s*|\s+(?:and|or|to|through)\s+)R\d{1,2}\b)*)/g;

function roundLabels(text) {
  if (!text) return text;
  return String(text).replace(ROUND_LABELS, (run, said, first, rest, at, whole) => {
    const count = 1 + (rest.match(/R\d/g) || []).length;
    const word = count === 1 ? 'round' : 'rounds';
    const before = whole.slice(0, at).trim();
    const opens = said ? said[0] === 'R' : !before || /[.!?]$/.test(before);
    const tail = rest.replace(/\s*-\s*R/g, ' to R').replace(/R(\d{1,2})/g, '$1');
    return `${opens ? 'R' + word.slice(1) : word} ${first}${tail}`;
  });
}

module.exports = { floorFails, floorNote, floorMerge, floorFill, floorLine, floorOrder, dropKind, FLOOR_SAYS, linePicks, wonPicks, wonWorthy, WON_LINES, focusGate, swingInto, SWING_SWAP_EN,
  normalise, buildPrompt, parse, study, weakSide, roundLine, standingWords, plantWords, phaseKept, READ_DURING_PLANT, READ_SPIKE_DOWN, roundDigits, roundLabels, teachable, lineWorthy,
  namesKiller, namedRounds, countPairs, NOT_PLAY, BUY_BLAME, REPEAT_WORDS, ROUND_LABELS, DEFAULT_VARIANT, MAX_ROUND_LINES, PATTERN_TOPICS,
  CAUSE_TOPICS, rankRule, enemiesOf, withinBudget, CASE_GROWTH, NOTES_FLOOR,
  round3, rankRule3, RANK_WORDS3, GROUNDING, GROUNDING3, GROUNDING3_SWAPS, aimEvidence, HS_USUAL, HS_BELOW, focusLever, leverRule,
  enemyWeaponsOf, claimOf, claimGates, TEMPLATE_LEAK, SPIKE_CARRY, PRAISE, AIM_DENIED, STUDY_VARIETY, spread, contradicted, CONTRADICTS,
  round4, matchCounts, matchFacts, countLines, qualifyCount, mistakesShown, allowedPairs, leverOf, leverRule4, LEVER_ORDER, HIGH_BANDS,
  depthRule, kitBlockOf, kitAgents, swingTopics, caseSituation, leverSituation, cohere, productCut, stateWrong, fundamentalsCap, structureGates,
  ROUND4_SWAPS, GROUNDING4, GROUNDING4_SWAPS, PRODUCT_TALK, CROSS_MATCH, TRADE_HABIT,
  recordSignalsOf, signalTopics, ECONOMY_TOPICS, recordUse, RECORD_USE, NO_ECONOMY, SOME_ECONOMY,
  onePlace, spotAgrees, spotPatternOf, sameSpotOf, clockWrong, CLOCK_ON,
  // The blind audit of 8.7.9, stream B: what each death cost, from Platinum.
  costOf, costLineOf, costTopics, COST_TOPICS, COST_BONUS, repeats, costReasonLine, COST_RULE, placesKept,
  // Round 8: the trades and the distance, counted in code.
  ledgerOf, LEDGER_HEAD_REVIEW,
  // 8.8: the rounds the player sat out, and the team's two patterns past the cut.
  satOutRounds, satOutLine, satOutGate, SAT_OUT_SAID, SAT_OUT_RANGE, PAST_CUT };
