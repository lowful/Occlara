'use strict';

/*
 * WHAT RIOT'S RECORD MAKES CERTAIN, SHARED BY ASK COACH AND THE REVIEW (the
 * blind audit of 8.7.8 against 8.7.7, Nov 2026). Four judges of five rated one
 * answer misleading for "You beat him twice, in rounds 14 and 16", where Omen
 * killed the player in both and the player killed Phoenix, Chamber, Reyna and
 * Fade there; "Omen was the one who got you in most of them" of five early
 * deaths Omen made one of; "before your team had even touched B" of a death AT
 * B Site; and two Sunset answers made "won 0 of 9 after the plant" the
 * player's failure where he had died before the plant in 5 of those 9.
 *
 * Each reader takes one sentence and a context built from the facts the
 * prompt was built from, and answers null or a reason. A sentence is judged
 * only where the record makes the claim certainly false: an unknown (no kill
 * feed, no plant time, an enemy Sage who could have revived the agent, Clove,
 * who revives herself) judges nothing.
 *
 *   checkKills       "you beat / killed / took out X in round N" where X is
 *                    no victim of the player's there, or X killed the player
 *                    there, or the player killed nobody.
 *   checkKillerShare "X got you in most of them": most, all or nearly all of
 *                    the deaths it names (the early ones where the sentence
 *                    says so) where X made half or fewer.
 *   checkOrder       "before your team touched B" of a round the player died
 *                    at B Site in (or after their own plant there); "you died
 *                    before the plant" of a death after it, and the other way.
 *   checkSide, checkResult  a round line's side or result the record gives
 *                    the other way (the review's; Ask Coach has its own).
 *   checkTeamBlame   the team's record after the plant (post plant on attack,
 *                    retake on defence) told as the player's own failing,
 *                    where the player died before the plant in half or more
 *                    of those rounds. plantLines says it to the prompt.
 *   checkDrill       a Deathmatch or Range drill about an enemy agent, or an
 *                    agent taken into Deathmatch, where abilities are off and
 *                    no enemy agent can be learnt.
 *   checkPostPlant, checkScore, checkClock (the blind audit of 8.7.9) advice
 *                    for after the plant of a death before it, a round's score
 *                    said wrong, and in Ask Coach the clock turned around.
 *   costRank, costLine  what each death cost, the line the prompts carry
 *                    from Platinum, and what the priority gate reads.
 *   checkMulti       (round 8) far, could not trade and untraded told
 *                    apart, "those six", "both times", "a couple of those
 *                    early rounds" and an agent's deaths resolved, a bare
 *                    count exact; checkAlone, alone said of a death with a
 *                    teammate close, "nobody could trade you" rewritten to
 *                    Riot's fact; checkClearest, the clearest one against
 *                    the cost ranking; tradeLedger, the counted split of the
 *                    deaths by trade and distance both prompts carry.
 *   checkRows        all of them over a reply's sentences in reading order,
 *                    a he or a she read as the agent the sentences before
 *                    named, a sentence of no round as the round its
 *                    paragraph is about.
 *
 * English words: the callers pass English text only. Every regex here was
 * written with a file editing tool and is asserted in test:chatgates on a
 * sentence of the audit (caught) and a true variant (kept). No require from
 * src/ (check:server), and nothing but the game data, coherence.js and,
 * lazily, knowledge.js's samePlace (checkDeathPlace).
 */

let DATA = {};
try { DATA = require('../valorant-data.generated.json'); } catch { DATA = {}; }
let CO = null;
try { CO = require('./coherence'); } catch { CO = null; }

const fin = (v) => typeof v === 'number' && Number.isFinite(v);
const esc = (s) => String(s).replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
const SINGLE_CURLY = new RegExp('[' + String.fromCharCode(0x2018, 0x2019, 0x02BC) + ']', 'g');
const DOUBLE_CURLY = new RegExp('[' + String.fromCharCode(0x201C, 0x201D) + ']', 'g');
const straight = (s) => String(s == null ? '' : s).replace(SINGLE_CURLY, "'").replace(DOUBLE_CURLY, '"');

const AGENTS = Object.keys(DATA.agents || {});
const AGENT_ALT = AGENTS.map(esc).sort((a, b) => b.length - a.length).join('|') || 'NO_AGENT';
const AGENT_RE = new RegExp(`(?<![A-Za-z0-9])(${AGENT_ALT})(?![A-Za-z0-9])`, 'g');
const canon = (name) => AGENTS.find((a) => a.toLowerCase() === String(name || '').toLowerCase()) || null;
const FEMALE = (CO && CO.FEMALE) || new Set();
const MALE = (CO && CO.MALE) || new Set();
// Who can come back in a round: Clove revives herself, and a Sage revives a teammate.
const SELF_REVIVE = new Set(['Clove']);
const REVIVER = 'Sage';

const sideOf = (s) => (/^att/i.test(String(s || '')) ? 'attack' : /^def/i.test(String(s || '')) ? 'defence' : null);

// ── The context ────────────────────────────────────────────────────────────

/*
 * THE DEATHS A PATTERN COUNTED BEFORE ANY PLANT. "8 of your 14 deaths came in
 * the first 30 seconds of the round, before any plant, in rounds 1, 5, 6, 7,
 * 8, 13, 14 and 16": code counted each by the round's phase at the death
 * (valorant-review.js patterns), the one source of a death before the plant
 * on a review saved before Riot's plant time was kept. "And 2 more" leaves
 * those two unknown.
 */
const BEFORE_ANY_PLANT = /before any plant,?\s+in\s+rounds?\s+([0-9][0-9,\s]*(?:and\s+[0-9]+)?)/gi;
function beforePlantRounds(texts) {
  const out = new Set();
  for (const t of Array.isArray(texts) ? texts : []) {
    for (const m of String(t || '').matchAll(BEFORE_ANY_PLANT)) {
      for (const d of m[1].matchAll(/[0-9]+/g)) out.add(Number(d[0]));
    }
  }
  return out;
}

function row(x) {
  return {
    n: x.n,
    side: sideOf(x.side),
    result: x.result === 'won' || x.result === 'lost' ? x.result : null,
    died: !!x.died,
    sec: fin(x.sec) ? x.sec : null,
    killer: canon(x.killer),
    kills: Number.isInteger(x.kills) ? x.kills : null,
    victims: Array.isArray(x.victims) ? x.victims : null,
    spot: typeof x.spot === 'string' && x.spot ? x.spot : null,
    planted: !!x.planted,
    plantSite: /^[ABC]$/.test(String(x.plantSite || '')) ? x.plantSite : null,
    plantSec: fin(x.plantSec) ? x.plantSec : null,
    // True only where the record says so: a client sends false for unknown too.
    // False is certain only beside Riot's plant time and the death's second
    // (the blind audit of round 7, Split round 10 at Plat): Riot's afterPlant
    // is its death's millisecond against its plant's, and false wherever it
    // lacked either, so a row without both keeps false as unknown, as before.
    afterPlant: x.afterPlant === true ? true
      : x.afterPlant === false && !!x.died && fin(x.plantSec) && fin(x.sec) ? false : null,
    // The round record beyond the feed (8.8), each only where it was sent:
    // Riot's callout of the death, the team's buy, the nearest teammate then
    // and the player's casts by kit name (checkRecord).
    place: typeof x.place === 'string' && x.place ? x.place : null,
    buy: ['pistol', 'eco', 'force', 'half', 'full'].includes(x.buy) ? x.buy : null,
    mate: x.mate === 'close' || x.mate === 'far' ? x.mate : null,
    // True only where the record says the death was traded (checkRecord's mate rule).
    traded: x.traded === true ? true : null,
    casts: Array.isArray(x.casts) ? x.casts.filter((c) => c && typeof c.name === 'string' && Number.isInteger(c.n)) : null,
    // For the cost of a death (costRank, the blind audit of 8.7.9): the
    // numbers standing at it, the player among the mates, untraded only where
    // the record says so, the first death of the round, and the score before.
    alive: aliveOf(x),
    untraded: x.traded === false,
    firstDeath: x.firstDeath === true,
    before: Array.isArray(x.before) && x.before.length === 2 && x.before.every(fin) ? [x.before[0], x.before[1]] : null,
    // A round Riot says the player sat out (8.8): in no count of the ledger (tradeLedger).
    afk: x.afk === true,
    // Round 8, the timeline and the state (checkFirst, checkKillPlace,
    // checkLater): whether the player got the round's first kill (false only
    // where the record says so), where Riot has the player's kills falling,
    // and from the kill feed the death's second and the player's kills
    // before it, in seconds into the round. Each null where not sent.
    firstKill: x.firstKill === true ? true : x.firstKill === false ? false : null,
    killPlaces: Array.isArray(x.killPlaces) && x.killPlaces.length ? x.killPlaces.filter((p) => typeof p === 'string' && p) : null,
    deathAt: fin(x.deathAt) ? x.deathAt : null,
    ownKills: Array.isArray(x.ownKills) && x.ownKills.every(fin) ? x.ownKills : null,
  };
}
/** From a kill feed: the death's second and the player's kills before it ({ deathAt, ownKills }, each null where unknown). */
function feedTimes(feed) {
  if (!Array.isArray(feed)) return { deathAt: null, ownKills: null };
  const d = feed.find((k) => k && k.on === 'me' && fin(k.s));
  if (!d) return { deathAt: null, ownKills: null };
  const mine = feed.filter((k) => k && k.by === 'me' && k.on === 'enemy');
  // A kill of the player's with no second leaves the list unknown.
  if (mine.some((k) => !fin(k.s))) return { deathAt: d.s, ownKills: null };
  return { deathAt: d.s, ownKills: mine.map((k) => k.s).filter((s) => s <= d.s).sort((a, b) => a - b) };
}
function aliveOf(x) {
  const a = x && x.alive;
  if (a && fin(a.mates) && fin(a.enemies)) return [a.mates, a.enemies];
  const at = x && x.atDeath;
  if (Array.isArray(at) && at.length === 2 && at.every(fin)) return [at[0], at[1]];
  return null;
}

/** The context of Ask Coach's facts (chat-prompt.js factsOf). */
function contextOfChat(facts) {
  const f = facts || {};
  const rounds = new Map();
  if (f.rounds instanceof Map) {
    for (const r of f.rounds.values()) {
      const feed = Array.isArray(r.feed) ? r.feed : null;
      const mine = feed ? feed.filter((k) => k && k.by === 'me' && k.on === 'enemy' && k.va).map((k) => canon(k.va)).filter(Boolean) : null;
      // The feed is the player's kills only where it holds as many as Riot's count.
      const victims = mine && mine.length && Number.isInteger(r.kills) && mine.length === r.kills ? mine : null;
      rounds.set(r.n, row({ ...r, victims, spot: r.spot || null, ...feedTimes(feed) }));
    }
  }
  const enemies = f.sides && f.sides.enemies instanceof Set ? new Set([...f.sides.enemies].map(canon).filter(Boolean)) : new Set();
  return {
    rounds,
    agent: canon(f.agent),
    enemies,
    // Both teams' five known: Riot's comps, else nothing about a revive is certain.
    enemiesKnown: enemies.size >= 5,
    early: beforePlantRounds(f.counted && f.counted.texts),
    asked: f.oneRound && f.asked ? f.asked : null,
    map: typeof f.map === 'string' && f.map ? f.map : null,
    kind: 'chat',
    // Round 8: the deaths in the first 30 seconds before any plant, counted
    // here from the rows (the set "those early rounds" names), the agents the
    // question names (whose deaths "those six" can be), and the cost ranking
    // from Platinum ("the clearest one was round N", checkClearest).
    earlyDeaths: earlyDeathsOf(rounds),
    askedAgents: (Array.isArray(f.askedAgents) ? f.askedAgents : []).map(canon).filter(Boolean),
    costRank: Array.isArray(f.costRank) && f.costRank.length ? f.costRank : null,
    // The rounds the match went to, from its final score (checkOrdinal, wholeMatch).
    total: Array.isArray(f.finalScore) && f.finalScore.every(fin) ? f.finalScore[0] + f.finalScore[1] : null,
    // The player's kills and deaths in the match (checkKillsDeaths, the blind audit of round 8, stream C).
    scoreline: f.scoreline && fin(f.scoreline.kills) && fin(f.scoreline.deaths) ? { kills: f.scoreline.kills, deaths: f.scoreline.deaths } : null,
    // The counted lines as the prompt gave them, lower case (checkCountList).
    countedTexts: f.counted && Array.isArray(f.counted.texts) ? f.counted.texts : [],
  };
}

/** The context of a review's input (match-review.js normalise). */
function contextOfReview(input) {
  const inp = input || {};
  const rounds = new Map();
  // The score before each round, while every round before it has a result.
  const before = new Map();
  let team = 0;
  let enemy = 0;
  let known = true;
  let next = 1;
  for (const r of [...(inp.rounds || [])].filter(Boolean).sort((a, b) => a.n - b.n)) {
    // A round missing from the ledger leaves every score after it unknown.
    if (r.n !== next) known = false;
    next = r.n + 1;
    if (known) before.set(r.n, [team, enemy]);
    if (r.result === 'won') team += 1;
    else if (r.result === 'lost') enemy += 1;
    else known = false;
  }
  for (const r of inp.rounds || []) {
    if (!r || !r.verified) continue;
    rounds.set(r.n, row({ ...r, spot: r.deathSpot || null, before: before.get(r.n) || null }));
  }
  const ctx = inp.context || {};
  const enemies = new Set((ctx.enemyAgents || []).map(canon).filter(Boolean));
  return {
    rounds,
    agent: canon(ctx.agent),
    enemies,
    enemiesKnown: enemies.size >= 5,
    early: beforePlantRounds((inp.patterns || []).map((p) => p && p.text).concat(inp.swing || [])),
    asked: null,
    map: typeof ctx.map === 'string' && ctx.map ? ctx.map : null,
    kind: 'review',
    earlyDeaths: earlyDeathsOf(rounds),
    askedAgents: [],
    costRank: null,
    // The rounds the match went to, from its final score (checkOrdinal, wholeMatch).
    total: inp.final && fin(inp.final.team) && fin(inp.final.enemy) ? inp.final.team + inp.final.enemy : null,
    // The player's kills and deaths in the match (checkKillsDeaths, the blind audit of round 8, stream C).
    scoreline: inp.final && inp.final.scoreline && fin(inp.final.scoreline.kills) && fin(inp.final.scoreline.deaths)
      ? { kills: inp.final.scoreline.kills, deaths: inp.final.scoreline.deaths } : null,
    // The counted lines the review was given, lower case (checkCountList).
    // The match's own memory and its biggest repeat (Nov 2026, match-memory.js), for a client built for chains.
    countedTexts: (inp.patterns || []).map((p) => p && p.text).concat(inp.swing || [], (inp.mistakes || []).map((m) => m && m.detail),
      (inp.memory || []).map((m) => m && m.text), inp.chainMain ? [inp.chainMain] : [])
      .filter((x) => typeof x === 'string' && x).map((x) => straight(x).toLowerCase()),
  };
}

/** Whether the player was certainly dead before the spike went down, in a round with a plant. */
function deadBeforePlant(r, ctx) {
  if (!r || !r.planted || !r.died || r.afterPlant) return false;
  // The death's second is Riot's millisecond rounded to the whole second, the
  // plant's to the tenth: 50 s against a plant at 50.2 s may be a death after
  // it, so without Riot's afterPlant false beside them the death is before
  // only with the half second the rounding can hide to spare.
  if (fin(r.sec) && fin(r.plantSec)) return r.afterPlant === false ? r.sec < r.plantSec : r.sec + 0.5 <= r.plantSec;
  return !!(ctx && ctx.early && ctx.early.has(r.n));
}
/** Whether the player was certainly alive when the spike went down. */
function aliveAtPlant(r) {
  if (!r || !r.planted) return false;
  if (!r.died || r.afterPlant) return true;
  return fin(r.sec) && fin(r.plantSec) && r.sec >= r.plantSec;
}

/** The team's record after the plant on one side, and the rounds the player was dead before it. */
function plantRecord(ctx, side) {
  const rows = [...((ctx && ctx.rounds) || new Map()).values()].filter((r) => r.side === side && r.planted && r.result);
  const dead = rows.filter((r) => deadBeforePlant(r, ctx)).map((r) => r.n).sort((a, b) => a - b);
  return {
    total: rows.length,
    won: rows.filter((r) => r.result === 'won').length,
    alive: rows.filter((r) => aliveAtPlant(r)).length,
    deadBefore: dead,
  };
}
const PLANT_MIN = 3;
const blamedUnfairly = (rec) => rec.total >= PLANT_MIN && rec.deadBefore.length * 2 >= rec.total;

const listText = (ns) => (ns.length === 1 ? `round ${ns[0]}` : `rounds ${ns.slice(0, -1).join(', ')} and ${ns[ns.length - 1]}`);

/*
 * THE FACT THE PROMPT CARRIES. Where the player died before the plant in half
 * or more of a side's planted rounds (three at least), one line saying so, its
 * numbers a pair the count gate knows ("5 of those 9"). No line otherwise, so
 * a match without one is told as before, byte for byte.
 */
function plantLines(ctx) {
  const out = [];
  const def = plantRecord(ctx, 'defence');
  if (blamedUnfairly(def)) {
    out.push(`Of the ${def.total} defence rounds they planted in, you died before the plant in ${def.deadBefore.length} of those ${def.total}, ${listText(def.deadBefore)}, so your team played those retakes without you: the team's record after their plant is not the player's own retake.`);
  }
  const atk = plantRecord(ctx, 'attack');
  if (blamedUnfairly(atk)) {
    out.push(`Of the ${atk.total} attack rounds with the spike down, you died before the plant in ${atk.deadBefore.length} of those ${atk.total}, ${listText(atk.deadBefore)}, so your team played those post plants without you: the team's record after the plant is not the player's own post plant.`);
  }
  return out;
}

/*
 * WHAT EACH DEATH COST (the blind audit of 8.7.9). At Ascendant the coach
 * ranked the traded repeek of a won round, the team 5 against 1, above the
 * only lost round, an untraded death after the plant at 4 against 3, and the
 * judges called it the wrong priority. The cost is code's, from Riot's
 * record: a lost round above any won one, then the numbers the death left
 * (down beats even, an advantage given back to even beats staying ahead),
 * after the plant above before, not traded above traded (never the last one
 * alive, whom nobody could trade), the round's first death a little more.
 * Only rounds with a death and a result. [{ n, score, side, result, words }],
 * costliest first, ties by the earlier round.
 */
const COST = { lost: 100, down: 3, even: 2, afterPlant: 2, untraded: 3, first: 1 };
function plantAt(r, ctx) {
  if (r.afterPlant || (fin(r.sec) && fin(r.plantSec) && r.sec >= r.plantSec)) return 'after';
  if (deadBeforePlant(r, ctx)) return 'before';
  return r.planted ? null : 'none';
}
function costRank(ctx) {
  const out = [];
  for (const r of ((ctx && ctx.rounds) || new Map()).values()) {
    if (!r || !r.died || !r.result) continue;
    const at = r.alive;
    const last = !!(at && at[0] <= 1);
    const after = at ? [at[0] - 1, at[1]] : null;
    const down = !!(after && !last && after[0] < after[1]);
    const even = !!(after && !last && after[0] === after[1] && at[0] > at[1]);
    const plant = plantAt(r, ctx);
    const untraded = r.untraded && !last;
    let score = r.result === 'lost' ? COST.lost : 0;
    if (down) score += COST.down;
    else if (even) score += COST.even;
    if (plant === 'after') score += COST.afterPlant;
    if (untraded) score += COST.untraded;
    if (r.firstDeath) score += COST.first;
    const words = [];
    words.push(`${r.side === 'attack' ? 'an attack' : r.side === 'defence' ? 'a defence' : 'a'} round your team ${r.result}`);
    if (plant === 'after') words.push('you died after the plant');
    else if (plant === 'before') words.push('you died before the plant');
    if (at) {
      words.push(last ? 'as the last one alive' : `${at[0]} against ${at[1]} when you died, leaving ${after[0]} against ${after[1]}${down ? ', a player down' : even ? ', the advantage given back' : ''}`);
    }
    if (r.traded === true) words.push('a teammate traded it');
    // With Riot's distance (round 8): "nobody traded it" alone read as nobody
    // near, and the Fracture answers made round 5 a lone death where Riot has
    // a teammate close. The words say which it was, where the record says.
    else if (untraded) words.push(r.mate === 'close' ? 'nobody traded it though a teammate was close' : r.mate === 'far' ? 'nobody traded it, with no teammate close' : 'nobody traded it');
    if (r.firstDeath) words.push('the first death of the round');
    out.push({ n: r.n, score, side: r.side, result: r.result, plant, down, even, untraded, first: r.firstDeath, words });
  }
  return out.sort((a, b) => b.score - a.score || a.n - b.n);
}
const COST_TOP = 3;
/** The finished line the high band prompts carry, or '' (fewer than two deaths, or no round to rank). */
function costLine(ctx, limit = COST_TOP) {
  const ranked = costRank(ctx);
  if (ranked.length < 2) return '';
  const top = ranked.slice(0, limit);
  const lostAny = ranked.some((x) => x.result === 'lost');
  return `THE COSTLIEST DEATHS, ranked in code from Riot's record by what each cost (a lost round above a won one, then the numbers the death left, after the plant above before, not traded above traded): `
    + top.map((x, i) => `${['First', 'Second', 'Third'][i] || 'Then'}, round ${x.n}, ${x.words.join(', ')}`).join('. ')
    + '. When you name a death or a round as the mistake, the lever or what to fix first, name the costliest first'
    + (lostAny ? ', and never rank a death in a round your team won above one in a round it lost' : '')
    + '.';
}

// ── The readers ────────────────────────────────────────────────────────────

/** The round numbers a sentence names after "round" or "rounds", a run of them. */
// A number of the run that is a time ("Round 4, 17 s in") is no round (the blind audit of 8.7.9).
const ROUND_RUN = /\brounds?\s+([0-9]{1,2}(?:(?:\s*,\s*(?:and\s+)?|\s+and\s+|\s+or\s+)[0-9]{1,2}(?![0-9]|\s*(?:s|secs?|seconds?)\b))*)/gi;
function roundsIn(text) {
  const out = [];
  for (const m of String(text || '').matchAll(ROUND_RUN)) for (const d of m[1].matchAll(/[0-9]+/g)) out.push(Number(d[0]));
  return [...new Set(out)];
}

const OPENS_IF = /^\s*(?:if|when|whenever|once|had|should|unless|next time)\b/i;

/*
 * THE PLAYER'S OWN KILLS. "You beat him twice, in rounds 14 and 16": a kill
 * of an agent in a named round, a he or a she read as the agent named before
 * it (st.agents). "You beat him to the angle" is no kill.
 */
const BEAT = new RegExp(`\\byou\\s+(?:also\\s+|only\\s+|then\\s+|finally\\s+|still\\s+)?(?:beat|killed|outgunned|outdueled|out-dueled|took\\s+out|picked\\s+off|won\\s+(?:the\\s+|your\\s+|both\\s+)?(?:duels?|fights?|gunfights?)\\s+(?:against|with|over))\\s+(?:(?:their|the\\s+enemy|the|an\\s+enemy|enemy)\\s+)?(${AGENT_ALT}|him|her)(?![A-Za-z0-9])(?!\\s+to\\b)`, 'gi');
function checkKills(sentence, ctx, st) {
  const t = straight(sentence);
  if (!ctx || !ctx.rounds.size || OPENS_IF.test(t)) return null;
  for (const m of t.matchAll(BEAT)) {
    let target = canon(m[1]);
    if (!target) target = pronounAgent(m[1], t.slice(0, m.index), ctx, st);
    if (!target || target === ctx.agent) continue;
    // The rounds of the kill's own clause: "You killed their Chamber in round
    // 5, and in round 6 Phoenix killed you" says nothing of a kill in round 6
    // (the verification of stream A). A sentence that names rounds in another
    // clause only is uncertain, and judges nothing.
    const clause = clauseAt(t, m.index);
    const named = roundsIn(clause);
    if (!named.length && roundsIn(t).length) continue;
    const rounds = named.length ? named : (st && st.round ? [st.round] : ctx.asked ? [ctx.asked] : []);
    for (const n of rounds) {
      const r = ctx.rounds.get(n);
      if (!r) continue;
      const revivable = SELF_REVIVE.has(target) || !ctx.enemiesKnown || ctx.enemies.has(REVIVER);
      const none = r.kills === 0;
      const notVictim = !!(r.victims && !r.victims.includes(target));
      const killedYou = r.died && r.killer === target && !revivable;
      if (none || notVictim || killedYou) {
        return `your reply said the player beat ${target} in round ${n}, where Riot's record has ${killedYou ? `${target} killing the player` : none ? 'the player with no kill' : `the player's kills there on ${r.victims.join(', ')}`}; say what the record shows`;
      }
    }
  }
  return null;
}

/*
 * THE CLAUSE A CLAIM STANDS IN: the sentence cut where a new clause starts,
 * ", and" / ", then" / ", but" and their kin, a semicolon, or an "and" or a
 * "but" before a new subject ("and Phoenix killed you", "and in round 6").
 * "You beat Reyna in round 5 and again in round 6" is one clause.
 */
const CLAUSE_BREAK = new RegExp(`[,;]\\s+(?:and|but|then|while|so|before|after|yet|though|although|until|when|where|which)\\b|;|\\s+(?:and|but)\\s+(?=(?:(?:their|the|an?|enemy)\\s+)?(?:${AGENT_ALT})\\s+(?!in\\b|on\\b|at\\b|and\\b|or\\b|twice\\b|both\\b|again\\b)[a-z]|(?:he|she|they|it|nobody|no\\s+one|your\\s+team|you\\s+(?:died|were|got|fell|lost))\\b|in\\s+rounds?\\s+[0-9])`, 'gi');
function clauseAt(text, at) {
  const t = String(text || '');
  let from = 0;
  let to = t.length;
  for (const b of t.matchAll(CLAUSE_BREAK)) {
    if (b.index + b[0].length <= at) from = b.index + b[0].length;
    else if (b.index > at) { to = b.index; break; }
  }
  return t.slice(from, to);
}

/** The agent a he or a she stands for: the sentence's own before it, else the last one before, of that gender or either, never the player's own. */
function pronounAgent(word, head, ctx, st) {
  const fits = (a) => a && a !== ctx.agent && ((/^her$/i.test(word) ? FEMALE.has(a) : MALE.has(a)) || (!FEMALE.has(a) && !MALE.has(a)));
  const own = [...String(head || '').matchAll(AGENT_RE)].map((x) => canon(x[1])).filter(fits);
  if (own.length) return own[own.length - 1];
  const before = (st && st.agents) || [];
  for (let i = before.length - 1; i >= 0; i--) if (fits(before[i])) return before[i];
  return null;
}

/*
 * WHO KILLED THE PLAYER MOST OF A SET OF DEATHS. "Five of your thirteen deaths
 * came in the first 30 seconds, and Omen was the one who got you in most of
 * them": Phoenix, Chamber, Phoenix, Omen and Fade. Of the early deaths where
 * the sentence says early, else of every death; certain only with two or more
 * deaths and every killer known.
 */
const MOST_OF = new RegExp(`(?<![A-Za-z0-9])(${AGENT_ALT}|he|she)(?![A-Za-z0-9])[^.;:]{0,40}?\\b(?:killed|got|caught|picked\\s+off|took\\s+out)\\s+you\\s+in\\s+(most|the\\s+majority|nearly\\s+all|almost\\s+all|all)\\s+(?:of\\s+)?(them|those|these|(?:your\\s+|the\\s+)?(?:early\\s+|first\\s+)?deaths)\\b`, 'i');
const EARLY_SAID = /\b(?:first\s+(?:30|thirty)\s+seconds|early|first\s+half\s+minute|opening\s+seconds)\b/i;
function checkKillerShare(sentence, ctx, st) {
  const t = straight(sentence);
  const m = MOST_OF.exec(t);
  if (!m || !ctx || !ctx.rounds.size || OPENS_IF.test(t)) return null;
  const target = canon(m[1]) || pronounAgent(/^she$/i.test(m[1]) ? 'her' : 'him', t.slice(0, m.index), ctx, st);
  if (!target) return null;
  const early = EARLY_SAID.test(t) || EARLY_SAID.test(m[3]);
  const deaths = [...ctx.rounds.values()].filter((r) => r.died && (!early
    || (fin(r.sec) && r.sec <= 30 && !r.afterPlant && !(fin(r.plantSec) && r.plantSec <= r.sec))));
  if (deaths.length < 2 || deaths.some((r) => !r.killer)) return null;
  const by = deaths.filter((r) => r.killer === target).length;
  const all = /all/i.test(m[2]) && !/nearly|almost/i.test(m[2]);
  const ok = all ? by === deaths.length : by * 2 > deaths.length;
  return ok ? null : `your reply said ${target} killed the player in ${m[2].replace(/\s+/g, ' ')} of ${early ? 'the early deaths' : 'their deaths'}, where Riot's record has ${target} in ${by} of ${deaths.length}; quote the counted line`;
}

/*
 * THE ORDER OF EVENTS. "Taking that fight alone at 12 s gave them a free
 * player up before your team had even touched B", of a death at B Site: the
 * player was the team on B. And a death told before the plant that came
 * after it, or after the plant that came before it.
 */
const BEFORE_SITE = /\bbefore\s+(?:your|the)\s+team\s+(?:had\s+)?(?:even\s+)?(?:touched|reached|got\s+(?:to|onto|on)|hit|entered|took|was\s+on|were\s+on|made\s+it\s+(?:to|onto)|set\s+foot\s+(?:on|in))\s+([ABC])(?:\s+[Ss]ite)?(?![A-Za-z])/;
const DEATH_VERB = '(?:you\\s+died|your\\s+death(?:\\s+came)?|killed\\s+you|you\\s+were\\s+killed|you\\s+got\\s+killed|you\\s+fell|you\\s+went\\s+down)';
const DIED_BEFORE_PLANT = new RegExp(`\\b${DEATH_VERB}\\b[^.;]{0,40}?\\bbefore\\s+(?:the|any|their|a)\\s+(?:plant|spike\\s+(?:went\\s+down|was\\s+(?:down|planted)))\\b`, 'i');
const DIED_AFTER_PLANT = new RegExp(`\\b${DEATH_VERB}\\b[^.;]{0,40}?\\b(?:after|once)\\s+(?:the\\s+plant|their\\s+plant|they\\s+planted|the\\s+spike\\s+(?:went|was)\\s+down)\\b`, 'i');
function roundOfSentence(t, ctx, st) {
  const named = roundsIn(t);
  if (named.length === 1) return named[0];
  if (named.length > 1) return null;
  return (st && st.round) || (ctx && ctx.asked) || null;
}
function checkOrder(sentence, ctx, st) {
  const t = straight(sentence);
  if (!ctx || !ctx.rounds.size || OPENS_IF.test(t)) return null;
  const n = roundOfSentence(t, ctx, st);
  const r = n != null ? ctx.rounds.get(n) : null;
  if (!r || !r.died) return null;
  const site = BEFORE_SITE.exec(t);
  if (site && /^[ABC]$/.test(site[1])) {
    const L = site[1];
    const atSite = r.spot === `${L} Site`;
    const theirPlant = r.side === 'attack' && r.plantSite === L && fin(r.plantSec) && fin(r.sec) && r.plantSec <= r.sec;
    if (atSite || theirPlant) {
      return `your reply said something came before your team reached ${L} in round ${n}, where the player ${atSite ? `died at ${L} Site` : `was alive on ${L} with the spike down`}; tell the round in the order the record has`;
    }
  }
  if (DIED_BEFORE_PLANT.test(t) && aliveAtPlant(r)) {
    return `your reply said the player died before the plant in round ${n}, where Riot's record has the death after it`;
  }
  if (DIED_AFTER_PLANT.test(t) && deadBeforePlant(r, ctx)) {
    return `your reply said the player died after the plant in round ${n}, where the record has the death before it`;
  }
  return null;
}

/*
 * A ROUND LINE'S SIDE AND RESULT (the review's: Ask Coach's timeline and
 * round gates read its own). "That was a defence round" of an attack, "you
 * won the round" of a loss.
 */
const SAYS_ATTACK = /\b(?:on\s+attack|an?\s+attack(?:ing)?\s+round|as\s+an\s+attacker|you\s+were\s+attacking|on\s+the\s+attacking\s+side)\b/i;
const SAYS_DEFENCE = /\b(?:on\s+defen[cs]e|an?\s+defen[cs]e\s+round|an?\s+defending\s+round|as\s+a\s+defender|you\s+were\s+defending|on\s+the\s+defending\s+side)\b/i;
function checkSide(sentence, ctx, st) {
  const t = straight(sentence);
  const n = roundOfSentence(t, ctx, st);
  const r = n != null && ctx ? ctx.rounds.get(n) : null;
  if (!r || !r.side) return null;
  const atk = SAYS_ATTACK.test(t);
  const def = SAYS_DEFENCE.test(t);
  if (atk === def) return null;
  if (atk && r.side === 'defence') return `your reply put round ${n} on attack, where Riot's record has it on defence`;
  if (def && r.side === 'attack') return `your reply put round ${n} on defence, where Riot's record has it on attack`;
  return null;
}
const SAYS_RESULT = /\b(?:you|your\s+team)\s+(won|lost)\s+(?:this|that|the)\s+round\b/i;
function checkResult(sentence, ctx, st) {
  const t = straight(sentence);
  const m = SAYS_RESULT.exec(t);
  if (!m || OPENS_IF.test(t)) return null;
  const n = roundOfSentence(t, ctx, st);
  const r = n != null && ctx ? ctx.rounds.get(n) : null;
  if (!r || !r.result) return null;
  const said = m[1].toLowerCase();
  return said !== r.result ? `your reply said the round was ${said} where Riot's record has round ${n} ${r.result}` : null;
}

/*
 * THE TEAM'S RECORD AFTER THE PLANT IS NOT THE PLAYER'S OWN. "Your biggest
 * mistake was how you played defence after the spike went down: you won 0 of
 * 9 defence rounds once they planted", where the player died before the plant
 * in 5 of those 9 (rounds 1, 5, 6, 7 and 8). A sentence that talks about the
 * retake or the post plant AND blames the player for it (the mistake, the
 * lever, what held them back, "you won 0 of") goes where the player died
 * before the plant in half or more of that side's planted rounds. The team's
 * record said as the team's ("your team won 0 of 9"), advice for the next
 * retake, and a sentence that says when the player was alive stay.
 */
const PLANT_TALK = /\b(?:retakes?|retaking|retook|after\s+(?:the|their|a)\s+plant|once\s+(?:they|the\s+spike|it)\s+(?:had\s+)?(?:planted|was\s+down|went\s+down|is\s+down|goes\s+down|got\s+planted)|(?:after|once|when)\s+the\s+spike\s+(?:went|was|is|goes|got)\s+(?:down|planted)|post[ -]?plants?|with\s+the\s+spike\s+down)\b/i;
const DEF_TALK = /\b(?:retak\w*|retook|they\s+planted|on\s+defen[cs]e|defending|defen[cs]e\s+rounds?|defen[cs]e\s+(?:after|once|when)|played\s+defen[cs]e)\b/i;
const ATK_TALK = /\b(?:post[ -]?plants?|on\s+attack|attacking|attack\s+rounds?|you\s+planted|your\s+team\s+planted|once\s+the\s+spike\s+was\s+down\s+on\s+attack)\b/i;
const BLAME = /\b(?:your|the)\s+(?:biggest\s+|main\s+|real\s+|costliest\s+|first\s+)?(?:mistake|problem|weakness|issue|lever|leak)\b|\b(?:held|holding|holds)\s+you\s+back\b|\b(?:cost|costing)\s+you\b|\bwhere\s+(?:the|your)\s+rounds?\s+(?:slipped|went|were\s+lost|got\s+away)\b|\byour\s+retakes?\b(?!\s+habit)|\bhow\s+you\s+(?:played|handled)\b|\b(?:the|your)\s+retakes?\s+(?:was|were|is|are)\s+(?:where|what|why|the)\b|\byou\s+(?:won|lost)\s+(?:[0-9]+|none|zero|no|every|all)\s+(?:of|out\s+of)\b/i;
const ALIVE_SAID = /\b(?:when|while|if|the\s+rounds?)\s+you\s+(?:were|are)\s+(?:still\s+)?alive\b|\bwithout\s+you\b|\byou\s+(?:were|had)\s+(?:already\s+)?(?:dead|died)\b|\byour\s+team(?:'s)?\s+(?:record|retakes?|post[ -]?plants?)\b|\bnot\s+(?:yours|your\s+own)\b/i;
const ADVICE_OPEN = /^\s*(?:when|if|once|before|next\s+time|in\s+your\s+next|to\s+practi[cs]e|practi[cs]e|for\s+practi[cs]e|group|wait|hold|play|go|take|use|say|call|stay|don't|do\s+not|never|always|try|fix|work\s+on)\b/i;
function checkTeamBlame(sentence, ctx) {
  const t = straight(sentence);
  if (!ctx || !ctx.rounds.size || !PLANT_TALK.test(t) || !BLAME.test(t) || ALIVE_SAID.test(t) || ADVICE_OPEN.test(t)) return null;
  const def = DEF_TALK.test(t);
  const atk = ATK_TALK.test(t);
  const side = def && !atk ? 'defence' : atk && !def ? 'attack' : null;
  if (!side) return null;
  const rec = plantRecord(ctx, side);
  if (!blamedUnfairly(rec)) return null;
  return `your reply made the team's record after the plant on ${side} the player's own failing, where the player died before the plant in ${rec.deadBefore.length} of those ${rec.total} rounds; say it is the team's record, and teach what the player can change`;
}

/*
 * A DRILL ABOUT AN AGENT IN A MODE WHERE IT CANNOT BE LEARNT. "Take Iso into
 * Deathmatch" to practise against their Omen: Deathmatch turns every ability
 * off, so the agent taken there changes nothing, and neither Deathmatch nor
 * the Range has an enemy Omen to learn. A sentence that says not to, or that
 * the mode has none, is the rule itself.
 */
const DEATHMATCH = /(?<![Tt]eam\s)(?<![A-Za-z])(?:[Dd]eath ?[Mm]atch|DEATHMATCH)(?![A-Za-z])/;
const RANGE = /(?<![A-Za-z])(?:the Range|in Range|[Rr]ange practice)(?![A-Za-z])/;
const MODE_AVOIDED = /\b(?:not|never|rather\s+than|instead\s+of|outside(?:\s+of)?|no\s+(?:place|way))\b[^.;]{0,24}(?:[Dd]eath ?[Mm]atch|Range)\b|\b(?:[Dd]eath ?[Mm]atch|Range)\s+(?:has|have|gives|offers)\s+no\b|\bno\s+(?:abilities|utility|teammates|enemy\s+agents?)\b/i;
const TAKE_AGENT = new RegExp(`\\b(?:take|bring|play|pick|lock\\s+in|queue)\\s+(?:your\\s+|as\\s+)?(${AGENT_ALT})\\s+(?:into|in|on|for)\\s+(?:a\\s+|some\\s+)?(?:[Dd]eath ?[Mm]atch)`, 'i');
function checkDrill(sentence, ctx) {
  const t = straight(sentence);
  const dm = DEATHMATCH.test(t);
  if ((!dm && !RANGE.test(t)) || MODE_AVOIDED.test(t)) return null;
  const take = TAKE_AGENT.exec(t);
  if (take) return `your reply had the player take ${canon(take[1]) || take[1]} into Deathmatch, where abilities are off; give a drill the mode allows`;
  // An enemy of the match's comp: in Deathmatch named at all, in the Range
  // only fought ("learn her Alarmbot by playing Killjoy in the Range" is a drill).
  const own = ctx && ctx.agent;
  const enemy = (a) => !!(a && a !== own && ctx && ctx.enemies.has(a));
  if (dm) {
    for (const m of t.matchAll(AGENT_RE)) {
      const a = canon(m[1]);
      if (enemy(a)) return `your reply gave a Deathmatch drill about ${a}, an agent with no abilities there and no enemy of the player's to learn; practise a matchup in a match`;
    }
    return null;
  }
  const fought = RANGE_AGAINST.exec(t);
  if (fought && enemy(canon(fought[1]))) return `your reply gave a Range drill against ${canon(fought[1])}, where the Range has bots and no enemy agent; practise a matchup in a match`;
  return null;
}
const RANGE_AGAINST = new RegExp(`\\b(?:against|fight(?:ing)?|beat(?:ing)?|track(?:ing)?|duel(?:ling)?)\\s+(?:their\\s+|the\\s+|an?\\s+|enemy\\s+)?(${AGENT_ALT})(?![A-Za-z0-9])`, 'i');

/*
 * THE ROUND RECORD BEYOND THE FEED (8.8): Riot's callout of the death, the
 * team's buy, the nearest teammate at the death and the player's casts, each
 * judged only where the round has it and only where the sentence says the
 * other thing certainly:
 *   place  "you died at B Main" of a death Riot places on another site's
 *          side (A, B or C each side): a callout of the same side, a mid
 *          callout or a spawn is near enough to be the parse's own fuzz, and
 *          a death Riot widened to "A site" (callout-locator.js) is never
 *          judged, since the word may stand for its Main or its Lobby;
 *   buy    "round 5 was an eco" of a full loadout, "on a full buy" of an
 *          eco, a pistol round of a round that was none: a force and a half
 *          are one kind here, the line between them being the money left;
 *   mate   "a teammate was close" of an untraded death with nobody close, "nobody
 *          was close" of one with a teammate close, never "close enough to
 *          trade", which is not a distance;
 *   casts  "you used Updraft" of a round with none of it, "you did not use
 *          Updraft" or "you used no abilities in that round" of one with
 *          some, never "no utility before the peek", which the round's count
 *          cannot tell.
 * The enemy's buy ("they were on an eco") and a plan ("if you are on an eco")
 * judge nothing.
 */
const SITE_SIDES = new Set(['a', 'b', 'c']);
const PLACES_OF = new Map();
/** The map's places, longest first: { re, side } with side the callout's site letter or null. */
function placesOf(map) {
  const key = String(map || '').toLowerCase();
  if (PLACES_OF.has(key)) return PLACES_OF.get(key);
  const g = (DATA.mapGeometry || {})[key];
  const names = new Map();
  // A callout's name and its other name as one place (checkKillPlace).
  const canonOf = new Map();
  for (const c of (g && Array.isArray(g.callouts) ? g.callouts : [])) {
    const side = SITE_SIDES.has(String((c && c.s) || '').toLowerCase()) ? String(c.s).toLowerCase() : null;
    const main = typeof (c && c.n) === 'string' && c.n ? c.n.toLowerCase() : null;
    for (const n of [c && c.n, c && c.a]) {
      if (typeof n !== 'string' || !n) continue;
      names.set(n.toLowerCase(), side);
      if (main && !canonOf.has(n.toLowerCase())) canonOf.set(n.toLowerCase(), main);
    }
    if (side) names.set(`${side} site`, side);
  }
  const list = [...names.keys()].sort((a, b) => b.length - a.length);
  const out = { sideOf: names, canonOf, alt: list.length ? list.map(esc).join('|') : null };
  PLACES_OF.set(key, out);
  return out;
}
/*
 * THE ARTICLE IS NO SITE (8.8 review, the "A site" trap again). placesOf's
 * names are lower case ("a site", "a main", "a lobby") and run under the 'i'
 * flag, so "a site retake", "a main angle" and "holding a site alone" read as
 * callouts of the A side. A place word that opens on a, b or c and a space is
 * a callout only where its letter is a capital in the text as written.
 */
const articleNotSite = (said) => /^[abc]\s/i.test(String(said || '')) && !/^[ABC]\s/.test(String(said || ''));
/** The first match of re (made global here) whose place group is no article. */
function placeMatch(source, t, group) {
  const re = new RegExp(source, 'gi');
  let m;
  while ((m = re.exec(t)) !== null) {
    if (!articleNotSite(m[group])) return m;
    re.lastIndex = m.index + 1;
  }
  return null;
}
const DEATH_AT_HEAD = '\\b(?:you\\s+died|your\\s+death(?:\\s+came)?|(?:killed|caught|picked\\s+off|took)\\s+you(?:\\s+out)?|you\\s+(?:were|got)\\s+(?:killed|caught|picked\\s+off|taken\\s+out)|you\\s+fell|you\\s+went\\s+down)\\b(?:\\s+[^\\s.;,]+){0,4}?\\s+(?:at|in|on|near|inside|from|holding|on\\s+the\\s+way\\s+to)\\s+(?:the\\s+)?';
const HYPO = /\b(?:if|next\s+time|should|would|could\s+have|make\s+sure|instead|always|every\s+time|whenever)\b/i;
const ENEMY_SUBJECT = /\b(?:they|them|their|enemy|enemies|opponents?|the\s+other\s+team)\b/i;
const BUY_CLAIM = /\b(?:on|in|with|during|was|were)\s+(?:an?\s+|the\s+|your\s+(?:team's\s+)?|a\s+team\s+)?(ecos?(?:\s+round)?|save\s+round|full(?:[ -]buy|\s+loadout)|force(?:[ -]buy|d\s+(?:loadout|round|buy))|half(?:[ -]buy|\s+loadout)|pistol\s+round)\b/i;
const BUY_ALLOWED = { eco: ['eco'], save: ['eco'], full: ['full'], force: ['force', 'half'], half: ['force', 'half'], pistol: ['pistol'] };
const MATE_CLOSE_SAID = /\b(?:(?:a|your|one)\s+teammates?\s+(?:was|were|stood|had\s+been)\s+(?:right\s+)?(?:close(?:\s+by)?|near(?:by)?|next\s+to\s+you|beside\s+you)|with\s+a\s+teammate\s+(?:right\s+)?(?:close(?:\s+by)?|near(?:by)?|next\s+to\s+you|beside\s+you))\b(?!\s+enough)/i;
const MATE_FAR_SAID = /\b(?:(?:no\s+teammate|nobody|no\s+one|none\s+of\s+your\s+teammates)\s+(?:(?:was|were|stood)\s+)?(?:close(?:\s+by)?|near(?:by)?|anywhere\s+near(?:\s+you)?|next\s+to\s+you)|with\s+(?:no\s+teammate|nobody|no\s+one)\s+(?:close(?:\s+by)?|near(?:by)?)|your\s+teammates?\s+(?:was|were)\s+(?:all\s+)?(?:too\s+)?far(?:\s+away)?)\b(?!\s+enough)/i;
const NO_ABILITY_ROUND = /\byou\s+(?:used\s+no\s+(?:abilities|ability|utility)|(?:did\s+not|didn't|never)\s+use\s+(?:a\s+single\s+|any\s+)?(?:abilities|ability|utility))(?=\s*(?:[.,;]|$)|\s+(?:in|all|that|this)\b(?!\s+(?:the\s+)?(?:fight|peek|duel|angle|swing|exchange)))/i;
const USED_VERB = '(?:used|threw|cast|placed|popped|put\\s+down|sent|fired)';
const UNUSED_VERB = '(?:did\\s+not|didn\'t|never)\\s+(?:use|throw|cast|place|pop|send|fire)';
function checkRecord(sentence, ctx, st) {
  const t = straight(sentence);
  if (!ctx || !ctx.rounds.size || OPENS_IF.test(t) || HYPO.test(t)) return null;
  const n = roundOfSentence(t, ctx, st);
  const r = n != null ? ctx.rounds.get(n) : null;
  if (!r) return null;
  // Where the player died: another site's side than Riot's callout.
  if (r.died && r.place && ctx.map) {
    const pl = placesOf(ctx.map);
    const fact = pl.sideOf.get(r.place.toLowerCase());
    // The client folds an exact site hit and a widened guess into one word
    // (valorant-verify.js placeName), so no site word is ever judged.
    const widened = /^[abc] site$/i.test(r.place);
    if (pl.alt && fact && !widened) {
      const m = placeMatch(`${DEATH_AT_HEAD}(${pl.alt})(?![A-Za-z0-9])`, t, 1);
      const said = m && !articleNotSite(m[1]) ? pl.sideOf.get(m[1].toLowerCase()) : null;
      if (said && said !== fact) return `your reply put the player's death in round ${n} at ${m[1]}, where Riot's record has it at ${r.place}; say the place the record has`;
    }
  }
  // The team's buy: another kind than the record's.
  if (r.buy) {
    const m = BUY_CLAIM.exec(t);
    // "On a full loadout your life is the round" opens on the rule, of any round.
    const rule = !!(m && /^\s*(?:on|in|with|during)\b/i.test(t.slice(0, m.index + 7)) && !t.slice(0, m.index).trim());
    if (m && !rule && !ENEMY_SUBJECT.test(clauseAt(t, m.index).slice(0, Math.max(0, m.index - clauseStart(t, m.index))))) {
      const w = m[1].toLowerCase();
      const kind = /^eco/.test(w) ? 'eco' : /^save/.test(w) ? 'save' : /^full/.test(w) ? 'full' : /^force/.test(w) ? 'force' : /^half/.test(w) ? 'half' : 'pistol';
      if (!BUY_ALLOWED[kind].includes(r.buy)) return `your reply called round ${n} ${m[1]}, where Riot's record has the team on ${r.buy === 'eco' ? 'an eco' : r.buy === 'pistol' ? 'a pistol round' : `a ${r.buy} loadout`}; say the economy the record has`;
    }
  }
  // The nearest teammate at the death. A traded death had a teammate near
  // enough to answer it, whatever the distance word, so "a teammate close
  // behind" of one is never judged by `far` (the Pearl audit, round 3:
  // traded, far, and "with a teammate close behind ... as happened here").
  if (r.died && r.mate) {
    if (r.mate === 'far' && r.traded !== true && MATE_CLOSE_SAID.test(t)) return `your reply had a teammate close when the player died in round ${n}, where Riot's record has nobody close`;
    if (r.mate === 'close' && MATE_FAR_SAID.test(t)) return `your reply had nobody close when the player died in round ${n}, where Riot's record has a teammate close`;
  }
  // The player's casts in the round.
  if (r.casts && r.casts.length) {
    if (NO_ABILITY_ROUND.test(t) && r.casts.some((c) => c.n > 0)) return `your reply said the player used no ability in round ${n}, where Riot's record has some used`;
    for (const c of r.casts) {
      const name = esc(c.name);
      if (c.n === 0 && new RegExp(`\\byou\\s+(?:also\\s+|then\\s+)?${USED_VERB}\\s+(?:your\\s+|a\\s+|an\\s+|the\\s+)?${name}(?![A-Za-z0-9])`, 'i').test(t)) {
        return `your reply said the player used ${c.name} in round ${n}, where Riot's record has it unused`;
      }
      if (c.n > 0 && new RegExp(`\\byou\\s+${UNUSED_VERB}\\s+(?:your\\s+|a\\s+|an\\s+|the\\s+|any\\s+)?${name}(?![A-Za-z0-9])`, 'i').test(t)) {
        return `your reply said the player did not use ${c.name} in round ${n}, where Riot's record has it used`;
      }
    }
  }
  return null;
}
/** Where the clause holding a point starts (clauseAt's cut). */
function clauseStart(text, at) {
  let from = 0;
  for (const b of String(text || '').matchAll(CLAUSE_BREAK)) if (b.index + b[0].length <= at) from = b.index + b[0].length;
  return from;
}

/*
 * ADVICE FOR AFTER THE PLANT, OF A DEATH BEFORE IT (the blind audit of 8.7.9).
 * "Enter B with a teammate following, then hold the planted spike from cover"
 * of Pearl round 3, where the player died 13 s in before any plant, three
 * reviews over; the Sunset round 1 the same. Round 5 gated the team's record
 * (checkTeamBlame); this is the round line and the sentence about one round:
 * holding, watching or playing the spike, the planted spike, a defuse, or
 * what to do once the spike is down, for a death the record has certainly
 * before the plant. A sentence that says the death came first ("you died
 * before the plant", "without you") or a plan for surviving to it ("if you
 * live to the plant") is the point itself, and stays. So does staying alive
 * for it ("staying alive keeps you available for the planted spike",
 * "preserves you for the planted spike", Pearl round 6 at Plat and Asc+, a
 * fall back before the plant told by what it is for), and playing for the
 * plant, which is the attack's plan before it (verify round 6).
 */
const AFTER_PLANT_ADVICE = /\b(?:hold(?:ing)?|guard(?:ing)?|watch(?:ing)?|protect(?:ing)?|sit(?:ting)?\s+on|play(?:ing)?\s+(?:off|around|near|over))\s+(?:the\s+|your\s+|their\s+)?(?:planted\s+)?(?:spike|plant)\b|\bthe\s+planted\s+spike\b|\bdefus(?:e|ing|al)\b|\b(?:after|once|when)\s+(?:the\s+plant|(?:you|your\s+team|they|the\s+team)\s+plant(?:ed|s)?|the\s+spike\s+(?:is|was|goes|went|gets|got)\s+(?:down|planted))\b|\bpost[ -]?plant\b|\bwith\s+the\s+spike\s+(?:down|planted)\b/i;
const BEFORE_PLANT_SAID = /\bbefore\s+(?:the|any|their|a)\s+(?:plant|spike)\b|\bwithout\s+you\b|\b(?:if|when|once)\s+you\s+(?:live|survive|make\s+it|are\s+(?:still\s+)?alive)\b|\b(?:your|the)\s+team(?:'s)?\s+(?:post[ -]?plant|retake|record)\b|\bnever\s+(?:got|reached|saw)\s+the\s+plant\b|\bstay(?:s|ing)?\s+alive\b|\bkeep(?:s|ing)?\s+you\s+(?:alive|available)\b|\bpreserv(?:e|es|ing)\s+(?:you|yourself|your\s+(?:life|chance))\b|\b(?:alive|available)\s+for\s+the\s+(?:retake|defuse|planted\s+spike|post[ -]?plant|plant)\b/i;
function checkPostPlant(sentence, ctx, st) {
  const t = straight(sentence);
  if (!ctx || !ctx.rounds.size || !AFTER_PLANT_ADVICE.test(t) || BEFORE_PLANT_SAID.test(t)) return null;
  const n = roundOfSentence(t, ctx, st);
  const r = n != null ? ctx.rounds.get(n) : null;
  if (!r || !deadBeforePlant(r, ctx)) return null;
  return `your reply gave advice for after the plant about round ${n}, where the player died before the plant; teach what they could change before it`;
}

/*
 * WHO IS ON THE CLOCK (the blind audit of 8.7.9). "After the plant, hold the
 * spike from cover, so the attackers have to move against the clock", to an
 * attacker on Corrode round 1, six judges: with the spike down the clock is
 * the defenders', with none it is the attackers'. A side named on the clock,
 * by the sentence's own phase (it says after the plant) else the round's (no
 * plant at all), the other way, goes. "The enemy" is the player's other side.
 * A sentence that tells both phases ("the attackers are on the clock until
 * they plant, and once the spike is down you are") is the rule itself, and
 * stays (PRE_PLANT, verify round 6).
 */
const PRE_PLANT = /\b(?:until|before)\s+(?:(?:they|the\s+attackers|you|your\s+team|the\s+team)\s+)?(?:plant(?:s|ed)?|get\s+the\s+plant|the\s+plant|a\s+plant|any\s+plant|the\s+spike\s+(?:is|goes)\s+down)\b/i;
const ON_CLOCK = /\b(?:the\s+)?(attackers|defenders|enemy|enemies|other\s+team)\s+(?:(?:have|has|had|must|need|needs|needed)\s+to\s+)?(?:[a-z]+\s+){0,3}?(?:against|on|beat|race|racing|fight(?:ing)?)\s+the\s+(?:clock|timer)\b/i;
const PHASE_DOWN = /\b(?:after|once|when)\s+(?:the\s+plant|(?:you|your\s+team|they|the\s+team)\s+plant(?:ed|s)?|the\s+spike\s+(?:is|was|goes|went|gets|got)\s+(?:down|planted))\b|\bpost[ -]?plant\b|\b(?:hold|guard|play\s+off|protect)\s+(?:the\s+)?(?:planted\s+)?spike\b|\bthe\s+planted\s+spike\b|\bwith\s+the\s+spike\s+(?:down|planted)\b/i;
function checkClock(sentence, ctx, st) {
  const t = straight(sentence);
  const m = ON_CLOCK.exec(t);
  // Ask Coach's: the review's round lines have their own (match-review.js clockWrong).
  if (!m || !ctx || ctx.kind !== 'chat' || !ctx.rounds.size) return null;
  const n = roundOfSentence(t, ctx, st);
  const r = n != null ? ctx.rounds.get(n) : null;
  if (!r || !r.side) return null;
  const phase = PHASE_DOWN.test(t) ? 'down' : !r.planted ? 'up' : null;
  if (!phase) return null;
  const onClock = phase === 'down' ? 'defence' : 'attack';
  const w = m[1].toLowerCase();
  const said = /^att/.test(w) ? 'attack' : /^def/.test(w) ? 'defence' : (r.side === 'attack' ? 'defence' : 'attack');
  if (said === onClock) return null;
  if (said === 'attack' && phase === 'down' && PRE_PLANT.test(t)) return null;
  return `your reply put the ${said === 'attack' ? 'attackers' : 'defenders'} on the clock in round ${n}, where ${phase === 'down' ? 'with the spike down the defenders' : 'with no spike down the attackers'} are the ones racing it`;
}

/*
 * THE SCORE OF A ROUND (the blind audit of 8.7.9): "the score was 5 against 4
 * in your favour" of Split round 3, which was the numbers alive at the death
 * with the score 2 to 0, and "the round ended 3 to 13" of a round mid match,
 * the match's final score. A score said of one round is the score before it
 * or after it, either order, or the sentence goes. A round of no known score
 * judges nothing.
 */
const SCORE_SAID = /\b(?:the\s+)?score\s+(?:was|stood\s+at|is|read|of|at)\s+(\d{1,2})\s*(?:against|to|-|versus|vs\.?)\s*(\d{1,2})\b|\bthe\s+round\s+(?:ended|finished|closed)\s+(\d{1,2})\s*(?:to|-)\s*(\d{1,2})\b/i;
function checkScore(sentence, ctx, st) {
  const t = straight(sentence);
  const m = SCORE_SAID.exec(t);
  if (!m || !ctx || !ctx.rounds.size || OPENS_IF.test(t)) return null;
  const n = roundOfSentence(t, ctx, st);
  const r = n != null ? ctx.rounds.get(n) : null;
  if (!r || !r.before || !r.result) return null;
  // "The final score was 13 to 7" after a round's sentence is the match's, said as the match's (verify round 6).
  if (!m[3] && /\bfinal\s+score\b/i.test(t)) return null;
  const a = Number(m[1] || m[3]);
  const b = Number(m[2] || m[4]);
  const after = r.result === 'won' ? [r.before[0] + 1, r.before[1]] : [r.before[0], r.before[1] + 1];
  const fits = (p) => (p[0] === a && p[1] === b) || (p[0] === b && p[1] === a);
  if (fits(after) || (!m[3] && fits(r.before))) return null;
  return `your reply said the score was ${a} to ${b} in round ${n}, where it was ${r.before[0]} to ${r.before[1]} before it and ${after[0]} to ${after[1]} after; a score is the rounds won so far, never the players alive or the match's final score`;
}

/*
 * CLAIMS OVER SEVERAL ROUNDS (the blind audit of round 6, Nov 2026). The
 * readers above judge a sentence about one round, and twelve of round 6's
 * fourteen misleading chat verdicts were a sentence summing several: "Five of
 * those six came while you were on your own" of Omen's six kills, where Riot
 * has a teammate close in three of them (rounds 1, 5 and 14); "your deaths in
 * rounds 2, 10 and 12 all came with no teammate close", round 2's teammate
 * close; "in rounds 1, 2, 13 and 14 you died early", round 2 at 42 s after the
 * plant. A claim (alone, a teammate close, early, traded, untraded) over a
 * set of rounds (a list the clause or the sentence names, "those six" of the
 * list the sentence before named, "your deaths" of every death) with its
 * quantifier (a number, all, none, most, an "only") goes where the rounds the
 * record leaves possible cannot make it true. An unknown round counts for the
 * claim, so only a claim certainly false is judged, and a set the words do
 * not pin down ("those six" after a sentence of five rounds) judges nothing.
 */
const NUM_WORDS = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16 };
const NUM = '(?:[0-9]{1,2}|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen)';
const numOf = (w) => (/^[0-9]+$/.test(String(w)) ? Number(w) : (NUM_WORDS[String(w || '').toLowerCase()] || null));
const lastAliveOf = (r) => !!(r && Array.isArray(r.alive) && r.alive[0] <= 1);

/*
 * THREE CLAIMS, TOLD APART (round 8, the blind audit of round 7). Twelve of
 * round 7's wrong chat claims were counts and distances, and the gate read
 * "not traded" and "nobody close" as one thing: "Three of those six deaths
 * had nobody close enough to trade" of Omen's six, where Riot has round 14
 * with a teammate close and untraded; "Cypher got you twice, and both times
 * nobody was close enough to trade you", both traded. Now:
 *   far       nobody near at the death: "no teammate close", "on your own",
 *             "holding the angle alone", "spots where nobody could see",
 *             "away from your teammate's reach". Riot's distance word
 *             decides first (Fracture round 2, traded and far: "no teammate
 *             was close" is Riot's own fact), then a teammate close or a
 *             trade makes it false.
 *   couldnt   nobody able to trade: "nobody close enough to trade",
 *             "nobody could trade you", "where nobody could answer". False of
 *             a traded death and of one with a teammate close (never the last
 *             one alive, whom nobody could trade).
 *   untraded  "untraded", "nobody traded", "was never traded", "nobody
 *             answered": false of a traded death only.
 * and close, early and traded as before. Each regex is asserted in
 * test:chatgates on a sentence of the audit and a true variant.
 */
const WHO = '(?:no\\s+teammate|nobody(?:\\s+on\\s+your\\s+team)?|no\\s+one(?:\\s+on\\s+your\\s+team)?|none\\s+of\\s+your\\s+teammates)';
const FAR_SAID = new RegExp([
  '\\bon\\s+your\\s+own\\b',
  '\\bby\\s+yourself\\b',
  '\\b(?:you\\s+were|while\\s+you\\s+were|while)\\s+(?:all\\s+)?alone\\b',
  '\\bisolated\\b',
  `\\b(?:with\\s+)?${WHO}\\s+(?:(?:was|were|stood)\\s+)?(?:close(?:\\s+by)?|near(?:by)?|anywhere\\s+near)\\b(?!\\s+enough)`,
  '\\byour\\s+teammates?\\s+(?:was|were)\\s+(?:all\\s+)?(?:too\\s+)?far\\b',
  '\\b(?:holding|held|took|taking|fought|fighting)\\s+(?:the\\s+|that\\s+|an\\s+|those\\s+|your\\s+)?(?:angle|fights?|duels?|space)\\s+(?:all\\s+)?alone\\b',
  `\\b(?:spots?|places?|angles?|positions?)\\s+where\\s+${WHO}\\s+could\\s+(?:see|reach|help|trade|answer)\\b`,
  "\\b(?:away\\s+from|out\\s+of)\\s+(?:your\\s+|a\\s+)?(?:teammates?'?s?|team's)\\s+reach\\b",
].join('|'), 'i');
const COULDNT_SAID = new RegExp([
  `\\b${WHO}\\s+(?:(?:was|were|stood)\\s+)?close\\s+enough\\s+to\\s+(?:answer|trade|kill|swing|punish|shoot|help|refrag)\\b`,
  `\\b${WHO}\\s+(?:could|was\\s+able\\s+to)\\s+(?:have\\s+)?(?:trade[d]?|answer(?:ed)?|refrag|kill\\s+(?:your|the)\\s+killer)\\b`,
  '\\b(?:was|were)\\s+no\\s+one\\s+(?:close\\s+enough|there)\\s+to\\s+(?:shoot|trade|answer|kill)\\b',
].join('|'), 'i');
const UNTRADED_SAID = /\b(?:went\s+)?(?:untraded|unanswered)\b|\b(?:nobody|no\s+one|no\s+teammate)\s+(?:ever\s+)?(?:traded|answered)\b|\b(?:was|were|got)\s+(?:never|not)\s+traded\b|\bnever\s+(?:got\s+)?traded\b|\bwithout\s+(?:a\s+)?trade\b/i;
const CLOSE_SAID = /\b(?:(?:a|your|one)\s+teammates?\s+(?:was|were|stood|had\s+been)\s+(?:right\s+)?(?:close(?:\s+by)?|near(?:by)?|next\s+to\s+you|beside\s+you)|with\s+a\s+teammate\s+(?:right\s+)?(?:close(?:\s+by)?|near(?:by)?|next\s+to\s+you|beside\s+you))\b(?!\s+enough)/i;
// "where you were the first contact", "when you were the first one down": the player's first death, said of the rounds named.
const FIRST_CONTACT = /\b(?:where|when)\s+you\s+were\s+the\s+first\s+(?:contact|death|one\s+(?:down|to\s+die)|player\s+down)\b|\byou\s+were\s+the\s+first\s+contact\b/i;
// What each round of the set must have been for the claim, and what makes it certainly not.
const MULTI_CLAIMS = [
  ['far', FAR_SAID, (r) => (r.mate === 'far' ? 'yes' : r.mate === 'close' || r.traded === true ? 'no' : null)],
  ['couldnt', COULDNT_SAID, (r) => (r.traded === true ? 'no' : r.mate === 'close' && !lastAliveOf(r) ? 'no' : r.untraded ? 'yes' : null)],
  ['close', CLOSE_SAID, (r) => (r.mate === 'far' && r.traded !== true ? 'no' : r.mate === 'close' || r.traded === true ? 'yes' : null)],
  // Early: certainly not after the plant, nor a minute in; the first 30 seconds not past 30.
  ['early', /\b(?:you\s+died|died|deaths?\s+came|you\s+went\s+down|you\s+fell)\s+(?:very\s+|too\s+)?early\b|\bearly\s+deaths?\b|\bin\s+the\s+first\s+(?:30|thirty)\s+seconds\b/i,
    (r, t) => {
      if (!r.died) return null;
      const after = r.afterPlant === true || (fin(r.sec) && fin(r.plantSec) && r.sec >= r.plantSec);
      const limit = /\bfirst\s+(?:30|thirty)\s+seconds\b/i.test(t) ? 30 : 60;
      if (after || (fin(r.sec) && r.sec > limit)) return 'no';
      return fin(r.sec) ? 'yes' : null;
    }],
  // The row's own untraded (Riot's traded false): before round 8 these read
  // r.traded === false, which a row never holds, so every round was unknown.
  ['untraded', UNTRADED_SAID, (r) => (r.traded === true ? 'no' : r.untraded ? 'yes' : null)],
  ['traded', /\b(?:were|was|got|been)\s+traded\b|\ba\s+teammate\s+traded\b|\bthe\s+trade\s+came\b/i,
    (r) => (r.untraded ? 'no' : r.traded === true ? 'yes' : null)],
  // The player as the round's first death (round 8, Pearl Iron "rounds 3 and 5, where you were the first contact", round 3 no first death).
  ['first', FIRST_CONTACT, (r) => (!r.died ? null : r.firstDeath ? 'yes' : fin(r.sec) ? 'no' : null)],
];
const JUDGES = Object.fromEntries(MULTI_CLAIMS.map(([k, , j]) => [k, j]));
const FACT_WORDS = { far: 'nobody close', couldnt: 'nobody close enough to trade', close: 'a teammate close', early: 'an early death', untraded: 'untraded', traded: 'traded', first: 'the player as the first death' };
// Two claims one quantifier holds together ("a teammate was close and nobody answered"), never two that cannot both be.
const CLASH = [['traded', 'untraded'], ['traded', 'couldnt'], ['close', 'far'], ['close', 'couldnt']];
const together = (ks) => ks.length >= 2 && !CLASH.some(([a, b]) => ks.includes(a) && ks.includes(b));
/** The claim kinds a text holds, a far that is only the couldnt's own words read as the couldnt. */
function kindsOf(text) {
  const t = String(text || '');
  const ks = MULTI_CLAIMS.filter(([, re]) => re.test(t)).map(([k]) => k);
  if (ks.includes('couldnt') && ks.includes('far') && !FAR_SAID.test(t.replace(new RegExp(COULDNT_SAID.source, 'gi'), ' '))) ks.splice(ks.indexOf('far'), 1);
  return ks;
}
/** One round under several claims at once: 'no' where any is, 'yes' where all are. */
function judgeAll(kinds, r, t) {
  const vs = kinds.map((k) => JUDGES[k](r, t));
  return vs.includes('no') ? 'no' : vs.every((v) => v === 'yes') ? 'yes' : null;
}

// "Five of those six", "all four of your deaths", "none of them", "a couple of those early rounds", "at least three of the six".
const QUANT = new RegExp(`\\b(only\\s+|just\\s+|at\\s+least\\s+|more\\s+than\\s+)?(${NUM}|all|both|none|most|each|every\\s+one|neither|a\\s+couple)(?:\\s+(${NUM}))?\\s+of\\s+(?:(those|these|them|the|your|his|her)\\s+)?(?:(early)\\s+)?(?:(${NUM})\\s+)?(deaths|rounds|times|fights|duels|ones|kills|early\\s+deaths)?`, 'i');
// "both times", "each time", "every time": the set the words before named, all of it.
const TIMES_Q = /\b(both|each|every)\s+times?\b/i;
// "rounds 2, 10 and 12 all came", "all four came", "both came": a list's own all.
const LIST_ALL = new RegExp(`\\b(?:all|both|each)(?:\\s+(?:${NUM}))?\\s+(?:of\\s+them\\s+)?(?:came|were|happened|went|died|had|ended|started)\\b`, 'i');
const SOFT_QUANT = /\b(?:often|sometimes|usually|mostly|several|some|a\s+few|many|a\s+lot\s+of|twice|mainly|largely|typically|regularly|repeatedly|at\s+times|more\s+than\s+once)\b/i;
const LIST_QUANT = new RegExp(`\\b(only\\s+|just\\s+)?(${NUM}|none|most|neither)\\s+of\\s+(?:them|those|these)\\b`, 'i');
// Every death of the match: "every time you died", "each of your deaths", "all your deaths".
const ALL_DEATHS = /\b(?:every|each)\s+time\s+you\s+died\b|\b(?:every|each)\s+(?:one\s+of\s+your\s+|of\s+your\s+)?deaths?\b|\ball\s+(?:of\s+)?your\s+deaths\b|\bwhenever\s+you\s+died\b/i;
const MOST_DEATHS = /\b(?:most|the\s+majority|nearly\s+all|almost\s+all)\s+of\s+your\s+deaths\b/i;
// "and two more you were the last one alive": those are out of the count's set.
const LAST_ALIVE_APART = new RegExp(`\\b(?:and\\s+)?(${NUM})\\s+more\\s+(?:where\\s+|when\\s+)?you\\s+were\\s+the\\s+last\\s+(?:one\\s+|player\\s+)?(?:alive|standing)\\b|\\b(?:besides|apart\\s+from|not\\s+counting)\\s+the\\s+(${NUM})\\s+(?:where|when)\\s+you\\s+were\\s+the\\s+last`, 'i');
// "in round 7 ... no teammate close, in round 11 ... with nobody near": one claim a round. A singular "round N" not opening a run ("round 1, 26 s in" is one round).
const PER_ROUND = /\bround\s+([0-9]{1,2})\b(?!\s*(?:,\s*(?:and\s+)?|\s+and\s+|\s+or\s+)[0-9]{1,2}(?![0-9]|\s*(?:s|secs?|seconds?)\b))/gi;
// A list split by counts: "twice with no teammate close and once with one close".
const SHARE = new RegExp(`\\b(twice|once|(${NUM})\\s+times)\\s+(?:with|where|when)\\b`, 'gi');
// A sentence whose rounds lean on the claim before it: "Rounds 2, 7, 10 and 12 all show it", "round 3, for example".
const POINTER = /\b(?:all|both|each)?\s*show(?:s|ed)?\s+(?:it|this|that)\b|\bthe\s+clearest\s+(?:one|example|case)\b|\bfor\s+example\b|\bis\s+(?:what|where)\s+(?:it|that)\s+happened\b|\bthat\s+is\s+what\s+happened\s+in\b|\blike\s+(?:in\s+)?rounds?\b/i;
// The claim's own part: a sentence cut where its advice starts (", so before you swing", ": stay close").
const ADVICE_CUT = /,\s+so\s+(?=(?:the\s+first\s+thing|before|stay|check|glance|wait|hold|look|make|keep|take|play|go)\b)|:\s+(?=(?:stay|check|glance|wait|hold|look|make|keep|take|play|go|before)\b)/i;
const claimPart = (t) => { const m = ADVICE_CUT.exec(t); return m ? t.slice(0, m.index) : t; };
/** The rounds the record has, 1 to the last, none missing: the only ledger "your deaths" can be counted over. */
function wholeMatch(ctx) {
  const ns = [...ctx.rounds.keys()].sort((a, b) => a - b);
  return ns.length > 0 && ns[0] === 1 && ns[ns.length - 1] === ns.length && (!fin(ctx.total) || ctx.total === ns.length);
}
const deathsOf = (ctx) => [...ctx.rounds.values()].filter((r) => r.died).map((r) => r.n);
/** The rounds an agent killed the player in, a round sat out left out. */
const killsBy = (ctx, agent) => [...ctx.rounds.values()].filter((r) => r.died && !r.afk && r.killer && r.killer === agent).map((r) => r.n).sort((a, b) => a - b);
/*
 * AN AGENT'S DEATHS NAMED BY COUNT: "Omen killed you six times", "Cypher got
 * you twice". The set "those six" or "both times" can stand for, only where
 * the record has that agent killing the player that many times.
 */
const AGENT_KILLS = new RegExp(`(?<![A-Za-z0-9])(${AGENT_ALT})(?![A-Za-z0-9])[^.;]{0,30}?\\b(?:killed|got|caught)\\s+you\\s+(?:(${NUM})\\s+times|(twice)|(once))\\b`, 'i');
// "Often when you were alone" is soft, never "Cypher got you twice", which is the set's own count (Pearl Iron, round 8).
const AGENT_KILLS_ALL = new RegExp(AGENT_KILLS.source, 'gi');
const softIn = (clause) => SOFT_QUANT.test(String(clause || '').replace(AGENT_KILLS_ALL, ' '));
function agentKillSet(text, ctx) {
  const m = AGENT_KILLS.exec(String(text || ''));
  if (!m || !ctx) return null;
  const a = canon(m[1]);
  const n = m[2] ? numOf(m[2]) : m[3] ? 2 : 1;
  const set = a ? killsBy(ctx, a) : [];
  return set.length === n && n >= 2 ? set : null;
}
/*
 * "Your deaths" qualified is some of them (the verify pass of round 7):
 * "Every time you died to Killjoy, nobody traded you" and "None of your
 * deaths on defence were traded" were true and went, judged over every death
 * of the match. A qualifier right after the words (to an agent, on a side, in
 * a part of the round, after the plant, early) leaves a set the words do not
 * pin down, which judges nothing; "in this match" is the whole match still.
 */
const SUBSET_AFTER = /^\s*(?:to|against|on|in|at|while|when|after|before|with|from|by|during|that|which|where|early|late|first|last)\b/i;
const WHOLE_AFTER = /^\s*(?:in|of|across|over)\s+(?:this|the|that)\s+(?:[a-z]+\s+)?(?:match|game)\b/i;
const restricted = (rest) => SUBSET_AFTER.test(rest) && !WHOLE_AFTER.test(rest);
// A plan judges nothing; "every time you died" is the claim's own set, so HYPO's every time is not read here.
const MULTI_HYPO = /\b(?:if|next\s+time|should|would|could\s+have|make\s+sure|instead)\b/i;

/** The quantifier of a clause: { at, want, only, atLeast, of, det, early, times } or null. */
function quantOf(clause) {
  const q = QUANT.exec(clause);
  if (q) {
    const lead = (q[1] || '').toLowerCase();
    const w = q[2].toLowerCase().replace(/\s+/g, ' ');
    const want = w === 'all' || w === 'both' || w === 'each' || w === 'every one' ? 'all' : w === 'none' || w === 'neither' ? 'none' : w === 'most' ? 'most' : w === 'a couple' ? { n: 2 } : { n: numOf(w) };
    return { at: q.index, len: q[0].length, want, only: /only|just/.test(lead), atLeast: /least|more/.test(lead) || w === 'a couple',
      of: numOf(q[6]) || numOf(q[3]) || (w === 'both' ? 2 : null), det: (q[4] || '').toLowerCase(), early: !!q[5], noun: (q[7] || '').toLowerCase(), times: false };
  }
  const tq = TIMES_Q.exec(clause);
  if (tq && !ALL_DEATHS.test(clause)) {
    const both = /^both$/i.test(tq[1]);
    return { at: tq.index, len: tq[0].length, want: 'all', only: false, atLeast: false, of: both ? 2 : null, det: 'those', early: false, noun: 'times', times: true };
  }
  return null;
}
/*
 * THE SET "THOSE SIX" NAMES (round 8): the rounds the sentence named before
 * the words, else for "those early" the counted early deaths, else the first
 * of these the size fits: the list of the sentence right before, an agent's
 * deaths this sentence or one before counted ("Omen killed you six times"),
 * the asked agent's, and the last list of the reply. With no size ("each
 * time") only the list right before or this sentence's agent.
 */
function anaphorSet(t, at, q, clause, ctx, st, here) {
  const before = roundsIn(t.slice(0, at));
  if (before.length >= 2) return before;
  if (q.early || /\b(?:those|these)\s+early\b/i.test(clause)) return Array.isArray(ctx.earlyDeaths) && ctx.earlyDeaths.length >= 2 ? ctx.earlyDeaths : null;
  const asked = (ctx.askedAgents || []).map((a) => killsBy(ctx, a)).filter((x) => x.length >= 2);
  const pool = [st.lastSet, here, st.agentSet, ...asked, st.replyList].filter((x) => Array.isArray(x) && x.length >= 2);
  if (q.of) return pool.find((x) => x.length === q.of) || null;
  if (q.times) return here || st.lastSet || null;
  return st.lastSet || null;
}
/** The set and the count a clause claims over: { set, want, only, atLeast } or null. */
function resolveSet(t, clause, from, ctx, st, here) {
  const runs = [...t.matchAll(ROUND_RUN)];
  const own = roundsIn(clause);
  let set = null;
  let want = null;
  let only = false;
  let atLeast = false;
  const q = quantOf(clause);
  if (q) {
    ({ want, only, atLeast } = q);
    if (['those', 'these', 'them', 'his', 'her'].includes(q.det)) set = anaphorSet(t, from + q.at, q, clause, ctx, st, here);
    else if ((q.det === 'your' || q.det === 'the') && /^deaths$/i.test(q.noun)) {
      // Every death of the match: "5 of your last 6 matches" and "your early deaths" are none of it, nor "your deaths to Killjoy" (restricted).
      set = wholeMatch(ctx) && !restricted(clause.slice(q.at + q.len)) ? deathsOf(ctx) : null;
    } else if (own.length >= 2) set = own;
    // "Five of those six" of a list of five is no list of the sentence's.
    if (set && q.of && set.length !== q.of) set = null;
    // "and two more you were the last one alive" takes those out, only where exactly that many are.
    const la = set ? LAST_ALIVE_APART.exec(t) : null;
    if (la) {
      const k = numOf(la[1] || la[2]);
      const rest = set.filter((n) => !lastAliveOf(ctx.rounds.get(n)));
      set = set.length - rest.length === k ? rest : null;
    }
  } else if (MOST_DEATHS.test(t)) {
    want = 'most';
    const md = MOST_DEATHS.exec(t);
    set = wholeMatch(ctx) && !restricted(t.slice(md.index + md[0].length)) ? deathsOf(ctx) : null;
  } else if (ALL_DEATHS.test(t)) {
    want = 'all';
    const ad = ALL_DEATHS.exec(t);
    set = wholeMatch(ctx) && !restricted(t.slice(ad.index + ad[0].length)) ? deathsOf(ctx) : null;
  } else {
    // A list the claim's clause names, else the sentence's one list.
    const list = own.length >= 2 ? own : !own.length && runs.length === 1 ? roundsIn(runs[0][0]) : [];
    if (list.length < 2) return null;
    set = list;
    const lq = LIST_QUANT.exec(t);
    if (lq) {
      only = !!lq[1];
      const w = lq[2].toLowerCase();
      want = w === 'none' || w === 'neither' ? 'none' : w === 'most' ? 'most' : { n: numOf(w) };
    } else want = 'all';
  }
  if (!set || set.length < 2 || !want) return null;
  return { set, want, only, atLeast };
}
/** The claim over its set judged: a reason where the record certainly makes it false, else null. */
function judgeSet(res, kinds, t, ctx) {
  const rows = res.set.map((n) => ctx.rounds.get(n)).filter(Boolean);
  if (rows.length !== res.set.length) return null;
  let yes = 0;
  let no = 0;
  let unknown = 0;
  for (const r of rows) {
    const v = judgeAll(kinds, r, t);
    if (v === 'yes') yes += 1;
    else if (v === 'no') no += 1;
    else unknown += 1;
  }
  const possible = yes + unknown;
  const { want } = res;
  let wrong = false;
  if (want === 'all') wrong = no > 0;
  else if (want === 'none') wrong = yes > 0;
  else if (want === 'most') wrong = possible * 2 <= rows.length;
  // A bare count is exact where nothing in the set is unknown (round 8:
  // "Three of those six he was never traded" of five), unless "at least",
  // "more than" or "a couple" lead it.
  else if (want && want.n != null) wrong = possible < want.n || (res.only && yes > want.n) || (!res.atLeast && unknown === 0 && yes !== want.n);
  if (!wrong) return null;
  const said = want === 'all' ? 'all' : want === 'none' ? 'none' : want === 'most' ? 'most' : `${want.n}`;
  const fact = kinds.map((k) => FACT_WORDS[k]).join(' and ');
  return `your reply said ${said} of rounds ${res.set.join(', ')} had ${fact}, where Riot's record allows it in ${possible} of those ${rows.length}${unknown ? '' : ` (it has it in ${yes})`}; say each round as the record has it, or leave the count out`;
}

function checkMulti(sentence, ctx, st0) {
  const st = st0 || {};
  const full = straight(sentence);
  if (!ctx || !ctx.rounds.size || OPENS_IF.test(full)) return null;
  // The claim's own part: advice after it ("so before you swing, glance")
  // judges nothing and makes no plan of the claim (round 8, Sunset).
  const t = claimPart(full);
  // "would have saved rounds 3 and 5, where you were the first contact": the
  // where clause is told as fact even inside a plan, so the rounds right
  // before it are judged as the player's first deaths (round 8, Pearl Iron).
  const fc = FIRST_CONTACT.exec(t);
  if (fc && /^\s*(?:where|when)\b/i.test(fc[0])) {
    const ns = roundsIn(t.slice(Math.max(0, fc.index - 40), fc.index));
    const wrong = ns.filter((n) => { const r = ctx.rounds.get(n); return r && JUDGES.first(r, t) === 'no'; });
    if (wrong.length) return `your reply had the player as the first death in round${wrong.length > 1 ? 's' : ''} ${wrong.join(', ')}, where Riot's record has someone else die first there; name only the rounds the record has the player die first in`;
  }
  if (MULTI_HYPO.test(t)) return null;
  const here = agentKillSet(t, ctx);
  // 1. One claim a round: each "in round N" part judged on its own round.
  const segs = [...t.matchAll(PER_ROUND)];
  if (segs.length >= 2) {
    for (let i = 0; i < segs.length; i++) {
      const seg = t.slice(segs[i].index, i + 1 < segs.length ? segs[i + 1].index : t.length);
      const ks = kindsOf(seg);
      const r = ctx.rounds.get(Number(segs[i][1]));
      if (!ks.length || !r || !r.died) continue;
      if (judgeAll(ks, r, seg) === 'no') return `your reply said round ${r.n} had ${ks.map((k) => FACT_WORDS[k]).join(' and ')}, where Riot's record has it ${r.traded === true ? 'traded' : r.untraded ? 'not traded' : 'with the trade unknown'}${r.mate ? `, the nearest teammate ${r.mate}` : ''}`;
    }
  }
  // 2. A list split by counts: each share judged as exactly that many of the list.
  const named = roundsIn(t);
  if (named.length >= 2 && segs.length < 2) {
    const shares = [...t.matchAll(SHARE)];
    const rs = named.map((n) => ctx.rounds.get(n)).filter((r) => r && r.died);
    for (let i = 0; i < shares.length && rs.length === named.length; i++) {
      const seg = t.slice(shares[i].index, i + 1 < shares.length ? shares[i + 1].index : t.length);
      const ks = kindsOf(seg);
      if (!ks.length) continue;
      const want = /^twice$/i.test(shares[i][1]) ? 2 : /^once$/i.test(shares[i][1]) ? 1 : numOf(shares[i][2]);
      let yes = 0;
      let unk = 0;
      for (const r of rs) { const v = judgeAll(ks, r, seg); if (v === 'yes') yes += 1; else if (v !== 'no') unk += 1; }
      if (yes + unk < want || (unk === 0 && yes !== want)) return `your reply said ${want} of rounds ${named.join(', ')} had ${ks.map((k) => FACT_WORDS[k]).join(' and ')}, where Riot's record has it in ${yes}`;
    }
  }
  // 3. Each claim over the set its clause names.
  const kinds = kindsOf(t);
  for (const [kind, re] of MULTI_CLAIMS) {
    if (!kinds.includes(kind)) continue;
    const m = re.exec(t);
    if (!m) continue;
    // The enemy's (their deaths) and a plan judge nothing.
    const clause = clauseAt(t, m.index);
    if (/\b(?:they|their|enemy|enemies|opponents?)\s+(?:died|deaths?)\b/i.test(clause)) continue;
    // "Often when you were alone" claims some of them, which no count can make false.
    if (softIn(clause)) continue;
    const res = resolveSet(t, clause, clauseStart(t, m.index), ctx, st, here);
    if (!res) continue;
    const why = judgeSet(res, [kind], t, ctx);
    if (why) return why;
  }
  // 4. Two claims under one quantifier, judged together: "in a couple of
  // those early rounds a teammate was close and nobody answered your death"
  // (Sunset, round 6 alone of four). Only a count of a set the words name, no
  // round of the sentence's own, so two clauses about two lists are never one.
  if (together(kinds) && !named.length && !softIn(t)) {
    const counts = [...t.matchAll(new RegExp(QUANT.source, 'gi'))].length + (TIMES_Q.test(t) && !ALL_DEATHS.test(t) ? 1 : 0);
    if (counts === 1) {
      const res = resolveSet(t, t, 0, ctx, st, here);
      const why = res ? judgeSet(res, kinds, t, ctx) : null;
      if (why) return why;
    }
  }
  // 5. A sentence that only points its rounds at the claim before it
  // ("Rounds 2, 7, 10 and 12 all show it"): each round judged by that claim.
  if (!kinds.length && named.length && Array.isArray(st.prevKinds) && st.prevKinds.length && POINTER.test(t)) {
    const groups = together(st.prevKinds) ? [st.prevKinds] : st.prevKinds.map((k) => [k]);
    for (const ks of groups) {
      const res = { set: named, want: 'all', only: false, atLeast: false };
      if (named.length === 1) {
        const r = ctx.rounds.get(named[0]);
        if (r && r.died && judgeAll(ks, r, t) === 'no') return `your reply gave round ${r.n} as an example of ${ks.map((k) => FACT_WORDS[k]).join(' and ')}, where Riot's record has it ${r.traded === true ? 'traded' : r.untraded ? 'not traded' : 'with the trade unknown'}${r.mate ? `, the nearest teammate ${r.mate}` : ''}; give as the example a round the claim is true of`;
        continue;
      }
      const why = judgeSet(res, ks, t, ctx);
      if (why) return why;
    }
  }
  return null;
}

/*
 * ALONE, SAID OF A ROUND WITH A TEAMMATE CLOSE (round 8, the blind audit of
 * round 7). "Nobody could trade you there because you were the one holding
 * the angle alone" of Corrode round 2, two sentences after the reply said a
 * teammate was close; "taking another duel away from your teammate's reach"
 * and "You held where nobody could answer your death" of Fracture round 5,
 * Riot's nearest teammate close and nobody trading. Untraded is not alone: a
 * sentence about one death that puts the player alone, out of reach or
 * where nobody could answer, of a round Riot has a teammate close in or the
 * death traded, goes, the reason naming the true fact. "Nobody could trade
 * you" of a round with a teammate close and no trade is Riot's fact said as
 * a capability, and is rewritten to "nobody traded you" and kept; so is
 * "dying where nobody could trade you" of the untraded deaths. The round is
 * the one the sentence names, else its paragraph's, else the asked round,
 * else (new) the reply's only round so far. Never the last one alive. A
 * conditional, a prediction and a rule in the present judge nothing; an
 * instruction is judged where it presupposes the fact ("rather than holding
 * alone") and does not itself say the teammate was close or the trade came.
 * A list right after an alone claim ("Rounds 2, 7, 10 and 12 all show it")
 * goes where one of its rounds had a teammate close or a trade. A habit with
 * no round ("You took fights alone") goes where the match's deaths nobody
 * traded had a teammate close in as many as not, three at least.
 */
const ALONE_SAID = new RegExp([
  "\\b(?:hold(?:ing|s)?|held|play(?:ing|ed|s)?|fight(?:ing|s)?|fought|t(?:ook|aking|ake|akes)|went|go(?:ing)?|push(?:ed|ing)?|peek(?:ed|ing)?|sw(?:ung|inging)|contest(?:ed|ing)?|enter(?:ed|ing)?|advanc(?:ed|ing)|st(?:ood|anding)|were|was|caught|died|dying)\\s+(?:[A-Za-z']+\\s+){0,4}?alone\\b(?!\\s+against)",
  '\\bon\\s+your\\s+own\\b',
  '\\bby\\s+yourself\\b',
  '\\bisolated\\b',
  "\\b(?:away\\s+from|beyond|out\\s+of|outside(?:\\s+of)?)\\s+(?:your\\s+|a\\s+|the\\s+)?(?:teammates?(?:'s?)?|team(?:'s)?)\\s+(?:reach|support|help|range|sight|cover)\\b",
  '\\bwhere\\s+(?:nobody|no\\s+one|no\\s+teammate|none\\s+of\\s+your\\s+teammates)\\s+(?:on\\s+your\\s+team\\s+)?(?:could|can|was\\s+able\\s+to)\\s+(?:answer|trade|see|help|swing|reach|cover|follow)\\b',
  '\\b(?:nobody|no\\s+one|no\\s+teammate)\\s+(?:on\\s+your\\s+team\\s+)?(?:could|was\\s+able\\s+to)\\s+(?:see\\s+the\\s+same|answer|cover|help)\\b',
  '\\b(?:no\\s+one|nobody|no\\s+teammate)\\s+(?:was\\s+)?(?:there|around)\\s+to\\s+(?:trade|answer|help|swing)\\b',
  '\\bwithout\\s+(?:a\\s+)?(?:teammate|anyone|support)\\s+(?:near(?:by)?|close(?:\\s+by)?|to\\s+trade)\\b',
].join('|'), 'i');
// "Nobody could trade you": the capability, true only of nobody close.
const COULD_TRADE = /\b(nobody|no\s+one|no\s+teammate)\s+could\s+(?:have\s+)?trade[d]?\s+you\b/i;
// Negations and the clutch: "you were not alone", "never alone", "alone against two", the last one alive.
const NOT_ALONE = /\b(?:not|never|weren't|wasn't)\s+(?:(?:really|actually|fully)\s+)?(?:alone|isolated|on\s+your\s+own)\b|\balone\s+against\b|\blast\s+(?:one|player)\s+(?:alive|standing)\b/i;
// An instruction: it opens on what to do. avoid to work on (8.8 review): "Avoid
// fights nobody could answer." was read as a claim and rewritten to "Avoid
// fights nobody answered.", advice turned into a past tense that says nothing.
const PLAN_OPEN = /^\s*(?:if|when|whenever|next\s+time|before|once|after\s+the\s+plant,?\s+(?:take|hold|check|look)|take|hold|check|look|give|fall|move|wait|stay|keep|play|pick|call|swing|let|do\s+not|don't|never|always|try|make|avoid|stop|focus|cut|limit|reduce|work\s+on)\b/i;
// "instead of / rather than ... alone": presupposes the player was alone, judged.
const PRESUPPOSED = /\b(?:instead\s+of|rather\s+than)\b[^.;]*?\b(?:alone|isolated|on\s+your\s+own|by\s+yourself)\b/i;
// "dying where nobody could trade you", "taking fights nobody could answer": the untraded deaths said as a capability.
const CAPABILITY = /\b((?:dying|died|deaths?|fights?|duels?)\s+(?:where\s+|that\s+)?)(nobody|no\s+one|no\s+teammate)\s+could\s+(trade|answer)\b/i;
// "you should see fewer deaths", "you will notice": a prediction, no claim.
const PREDICTION = /\byou\s+(?:should|will|would)\s+(?:see|notice|find|feel)\b/i;
// A claim about what happened is told in the past.
const ALONE_PAST = /\b(?:was|were|took|held|fought|went|gave|stood|died|left|got|came|stayed|swung|pushed|peeked|kept|cost|had|lost|played|walked|ran|moved|caught)\b/i;
// "all show it", "like that", "each time": a list leaning on the claim before.
const ANAPHOR = /\b(?:show(?:s|ed)?\s+(?:it|this|that)|like\s+(?:that|this)|the\s+same\s+(?:way|thing|story)|each\s+time|every\s+time|all\s+(?:went|came)\s+(?:that|this)\s+way)\b/i;
const TRADED_SAID = /\b(?:was|were|got)\s+traded\b|\ba\s+teammate\s+traded\b/i;
// The advice's alone as a fight's timing, or as a place held (checkAlone).
const SWING_ALONE = /\b(?:peek(?:s|ing)?|swing(?:s|ing)?|the\s+peek|the\s+swing|duel(?:s|ing)?|entr(?:y|ies)|going\s+in)\b/i;
const HELD_ALONE = /\b(?:hold(?:s|ing)?|held|position|angle|space|spot|site|anchor(?:ing)?|stand(?:ing)?|play(?:ing)?\s+(?:it|there))\b/i;
// A teammate said to be close enough to trade: true of a death Riot has close.
const MATE_COULD_SAID = /\b(?:a|your|one)\s+teammates?\s+(?:was|were|stood)\s+(?:right\s+)?close\s+enough\s+to\s+(?:trade|answer|kill|swing)\b/i;
const ALONE_REASON = (n, r) => `your reply had the player alone or out of a teammate's reach at the round ${n} death, where Riot's record has ${r.traded === true ? 'a teammate close who traded it' : 'a teammate close and nobody trading'}; say the fight came before that teammate could swing, never that the player was alone`;
function checkAlone(sentence, ctx, st0) {
  const st = st0 || {};
  const t = straight(sentence);
  if (!ctx || !ctx.rounds || !ctx.rounds.size) return null;
  const free = t.replace(new RegExp(NOT_ALONE.source, 'gi'), ' ');
  const named = roundsIn(t);
  // "Rounds 2, 7, 10 and 12 all show it" right after an alone claim: each round named is judged.
  if (st.prevAlone && named.length && ANAPHOR.test(t) && !ALONE_SAID.test(free)) {
    const wrong = named.filter((n) => { const r = ctx.rounds.get(n); return r && r.died && !lastAliveOf(r) && r.mate === 'close'; });
    if (wrong.length) return `your reply gave round${wrong.length > 1 ? 's' : ''} ${wrong.join(', ')} as a death with nobody near, where Riot's record has a teammate close${wrong.length > 1 ? ' in each' : ''}; name only the rounds the record has nobody close in`;
  }
  const capOnly = free.replace(CAPABILITY, ' ');
  const cap = CAPABILITY.test(t);
  const m = ALONE_SAID.exec(capOnly);
  const could = COULD_TRADE.exec(capOnly);
  const couldnt = COULDNT_SAID.exec(capOnly);
  if (!m && !could && !couldnt && !cap) return null;
  // A plan judges nothing, unless it presupposes the fact ("instead of holding alone").
  const conditional = OPENS_IF.test(t) || /^\s*(?:if|when|whenever|next\s+time|unless)\b/i.test(t) || PREDICTION.test(t);
  const plan = conditional || PLAN_OPEN.test(t);
  if (conditional || (plan && !PRESUPPOSED.test(t))) return null;
  // "With a teammate close, time it with them instead of taking it alone": the sentence says the true fact itself.
  if (PRESUPPOSED.test(t) && !could && (MATE_CLOSE_SAID.test(t) || TRADED_SAID.test(t))) return null;
  // "In round 6 nobody traded, so the fix is to swing with someone beside you
  // ... instead of taking the peek alone" (Sunset Iron, the round 8 replay):
  // the fact said is the true one, nobody traded, and the only alone is the
  // advice's "instead of" taking a peek or a swing alone, which is when the
  // fight came. "rather than holding alone", a place held, is a distance and
  // stays judged, as does a sentence with any other alone claim in it.
  const pre = PRESUPPOSED.exec(t);
  if (pre && SWING_ALONE.test(pre[0]) && !HELD_ALONE.test(pre[0]) && !could && !couldnt && UNTRADED_SAID.test(t)
    && !ALONE_SAID.test(capOnly.replace(PRESUPPOSED, ' '))) return null;
  // A claim is told in the past; a rule in the present ("the fight you refuse to start alone") is not one.
  if (!PRESUPPOSED.test(t) && !could && !couldnt && !cap && !ALONE_PAST.test(t)) return null;
  if (cap && !m && !could && !couldnt) {
    // No round named: the phrase is the untraded deaths' own, so it is their fact.
    const rows = named.map((k) => ctx.rounds.get(k)).filter((x) => x && x.died);
    if (!named.length || (rows.length === named.length && rows.every((x) => x.traded !== true))) {
      return { rewrite: t.replace(CAPABILITY, (w, head, who, verb) => `${head}${who} ${verb === 'answer' ? 'answered' : 'traded'}`) };
    }
    return null;
  }
  const n = named.length === 1 ? named[0] : named.length > 1 ? null : (st.round || ctx.asked || st.replyRound || null);
  const r = n != null ? ctx.rounds.get(n) : null;
  if (r && r.died && !lastAliveOf(r)) {
    // Riot's distance word only: a death traded with no teammate close ("Move
    // into A Link rather than taking the space alone", Corrode round 6) is
    // Riot's own far, so a trade with no distance known makes alone no less
    // possible, and only a teammate close makes it certainly false.
    // The sentence names the teammate close itself ("took the Jett's Sheriff
    // duel alone, when a teammate was close enough to trade you and nobody
    // did", Fracture Plat, the round 8 replay): "alone" is the duel taken by
    // the player, and the fact it gives is Riot's.
    if (m && r.mate === 'close' && (MATE_CLOSE_SAID.test(t) || MATE_COULD_SAID.test(t))) return null;
    if (m && r.mate === 'close') return ALONE_REASON(n, r);
    if (!m && r.traded === true && (could || couldnt)) return `your reply said nobody could trade the player in round ${n}, where Riot's record has the death traded`;
    if (!m && could && r.mate === 'close' && r.untraded) return { rewrite: t.replace(COULD_TRADE, (w, who) => `${who} traded you`) };
    if (!m && couldnt && r.mate === 'close' && r.untraded) return `your reply said nobody was close enough to trade the player in round ${n}, where Riot's record has a teammate close and nobody trading; say nobody traded it, and that the fight came before the teammate could swing`;
    return null;
  }
  // A habit over the match: no round anywhere, no quantifier (checkMulti's).
  if (n == null && !named.length && m && !plan && /\byou\b/i.test(t) && !QUANT.test(t) && !SOFT_QUANT.test(t)) {
    const deaths = [...ctx.rounds.values()].filter((x) => x.died && !x.afk && x.untraded && !lastAliveOf(x) && (x.mate === 'close' || x.mate === 'far'));
    const close = deaths.filter((x) => x.mate === 'close').map((x) => x.n);
    const far = deaths.filter((x) => x.mate === 'far').map((x) => x.n);
    if (deaths.length >= 3 && close.length >= far.length) {
      return `your reply said the player fought alone as a habit, where Riot's record has a teammate close at ${close.length} of the ${deaths.length} deaths nobody traded (${listText(close)}); there the fight came before the teammate could swing`;
    }
  }
  return null;
}

/*
 * THE CLEAREST ONE (round 8, the blind audit of round 7): "What cost you was
 * where you stood when you took the fight. The clearest one was round 2", a
 * round the team won and the death traded, where THE COSTLIEST DEATHS ranks
 * round 5 of a lost round first. A round called the clearest, the best or the
 * costliest example right after a sentence about what cost the player, from
 * Platinum where the ranking exists, is judged as the priority gate judges
 * "the biggest mistake" (fact-gates.js gatePriority).
 */
const CLEAREST = /\bthe\s+(?:clearest|best|biggest|costliest|worst|plainest|most\s+costly|most\s+obvious)\s+(?:one|example|case|instance|of\s+(?:them|those))\s+(?:was|is|came\s+in)\s+(?:in\s+)?round\s+([0-9]{1,2})\b/i;
// Round 8 (the timeline stage): "the one that cost you the most was round 2"
// says the cost itself, so it needs no sentence about cost before it.
const COST_MOST = /\b(?:the\s+(?:one|death|round)\s+that\s+cost\s+you\s+(?:the\s+)?most|what\s+cost\s+you\s+(?:the\s+)?most)\s+(?:was|is|came\s+in)\s+(?:in\s+)?round\s+([0-9]{1,2})\b/i;
const COST_TALK = /\bcost(?:s|ed|ing)?\s+you\b|\bholding\s+you\s+back\b|\buntraded\b|\bunanswered\b|\bnobody\s+traded\b|\bwhere\s+you\s+stood\b|\bbiggest\s+mistake\b/i;
function checkClearest(sentence, ctx, st) {
  const t = straight(sentence);
  const most = COST_MOST.exec(t);
  const m = most || CLEAREST.exec(t);
  if (!m || !ctx || !Array.isArray(ctx.costRank) || !ctx.costRank.length) return null;
  if (!most && !((st && st.recent) || []).some((x) => COST_TALK.test(x))) return null;
  const n = Number(m[1]);
  const top = ctx.costRank[0];
  const here = ctx.costRank.find((x) => x.n === n);
  if (!here || top.n === n || here.result !== 'won' || top.result !== 'lost') return null;
  return `your reply gave round ${n}, a round your team won, as the clearest example of what cost the player, where round ${top.n} cost more: a death in a lost round. Name the costliest round first, as THE COSTLIEST DEATHS ranks them`;
}

/*
 * THE TRADES AND THE DISTANCE, COUNTED IN CODE (round 8). The model was
 * never given the counts it said: three summaries counted "untraded" three
 * ways, the enemy block's "Nobody traded 3 of the 6" left out the last one
 * alive without saying so where Riot has 5 of 6, and no line crossed the
 * early deaths with the distance. One partition of the player's deaths from
 * the same rows the gate reads, every count with its rounds: traded; nobody
 * traded as the last one alive; nobody traded with a teammate close; nobody
 * traded with no teammate close; nobody traded with no distance in the
 * record; and not known. For the match, the early deaths (the first 30
 * seconds, before any plant) and each agent the question names. A round the
 * player sat out (8.8) is in none of them. No semicolon, so the review's
 * prompt rules hold of it. Fewer than two deaths with a trade known, no line.
 */
function earlyDeathsOf(rounds) {
  return [...((rounds && rounds.values && rounds.values()) || [])]
    .filter((r) => r.died && !r.afk && fin(r.sec) && r.sec <= 30 && r.afterPlant !== true && !(fin(r.plantSec) && r.plantSec <= r.sec))
    .map((r) => r.n).sort((a, b) => a - b);
}
function ledgerBins(rows) {
  const b = { traded: [], lastAlive: [], close: [], far: [], noDistance: [], unknown: [] };
  for (const r of rows || []) {
    if (!r) continue;
    if (r.traded === true) b.traded.push(r.n);
    else if (r.untraded && lastAliveOf(r)) b.lastAlive.push(r.n);
    else if (r.untraded && r.mate === 'close') b.close.push(r.n);
    else if (r.untraded && r.mate === 'far') b.far.push(r.n);
    else if (r.untraded) b.noDistance.push(r.n);
    else b.unknown.push(r.n);
  }
  return b;
}
/** One set's line: "Of your 6 deaths to Omen, a teammate traded 1 of the 6 (round 1). Nobody traded 5 of the 6: ...", or ''. */
function ledgerLine(rows, head) {
  const rs = (rows || []).filter((r) => r && r.died && !r.afk).sort((a, b) => a.n - b.n);
  const n = rs.length;
  const b = ledgerBins(rs);
  if (n < 2 || n - b.unknown.length < 2) return '';
  const of = (k) => (k === n ? (n === 2 ? 'both' : `all ${n}`) : `${k} of the ${n}`);
  const untraded = n - b.traded.length - b.unknown.length;
  const parts = [`${head}, ${b.traded.length ? `a teammate traded ${of(b.traded.length)} (${listText(b.traded)})` : 'a teammate traded none'}.`];
  if (untraded) {
    const sub = [];
    if (b.lastAlive.length) sub.push(`${b.lastAlive.length} as the last one alive, which nobody could trade (${listText(b.lastAlive)})`);
    if (b.close.length) sub.push(`${b.close.length} with a teammate close who did not trade it, a lesson about when you took the fight (${listText(b.close)})`);
    if (b.far.length) sub.push(`${b.far.length} with no teammate close, a lesson about where you stood (${listText(b.far)})`);
    if (b.noDistance.length) sub.push(`${b.noDistance.length} with no distance in Riot's record (${listText(b.noDistance)})`);
    const said = sub.length > 1 ? `${sub.slice(0, -1).join(', ')}, and ${sub[sub.length - 1]}` : sub[0];
    parts.push(`Nobody traded ${of(untraded)}: ${said}.`);
  }
  if (b.unknown.length) parts.push(`Riot's record does not say whether ${listText(b.unknown)} ${b.unknown.length === 1 ? 'was' : 'were'} traded.`);
  // The distance alone, traded or not, never the last one alive: "a teammate
  // was close in 3 of the 5" is Riot's nearest teammate, the far claim's own fact.
  const near = rs.filter((r) => !lastAliveOf(r) && r.mate === 'close').map((r) => r.n);
  const far = rs.filter((r) => !lastAliveOf(r) && r.mate === 'far').map((r) => r.n);
  if (near.length + far.length) {
    const said = [near.length ? `a teammate was close in ${of(near.length)} (${listText(near)})` : null, far.length ? `no teammate was close in ${of(far.length)} (${listText(far)})` : null].filter(Boolean).join(' and ');
    parts.push(`By distance alone, traded or not, ${said}.`);
  }
  return parts.join(' ');
}
const LEDGER_HEAD = "THE TRADES AND THE DISTANCE, counted in code from Riot's record (the only counts of trades or of a teammate close you may give)";
const LEDGER_RULE = 'Every count you give of deaths traded or not, or with a teammate close or not, is one of these, said with its rounds. A death nobody traded is not one with no teammate close, and a death a teammate traded or one with a teammate close never had nobody close enough to trade you.';
/** The block for a prompt: the match, the early deaths and each agent named, or ''. opts { agents, head } */
function tradeLedger(ctx, opts = {}) {
  if (!ctx || !ctx.rounds || !ctx.rounds.size) return '';
  const deaths = [...ctx.rounds.values()].filter((r) => r.died && !r.afk).sort((a, b) => a.n - b.n);
  const lines = [];
  const whole = ledgerLine(deaths, `Of your ${deaths.length} deaths in the match`);
  if (!whole) return '';
  lines.push(whole);
  const early = (ctx.earlyDeaths || []).map((k) => ctx.rounds.get(k)).filter(Boolean);
  if (early.length >= 2 && early.length < deaths.length) {
    const e = ledgerLine(early, `Of your ${early.length} early deaths (the first 30 seconds, before any plant, ${listText(early.map((r) => r.n))})`);
    if (e) lines.push(e);
  }
  const seen = new Set();
  for (const a0 of opts.agents || []) {
    const a = canon(a0);
    if (!a || seen.has(a) || a === ctx.agent) continue;
    seen.add(a);
    const ds = deaths.filter((r) => r.killer === a);
    const line = ds.length >= 2 ? ledgerLine(ds, `Of your ${ds.length} deaths to ${a}`) : '';
    if (line) lines.push(line);
  }
  return `${opts.head || LEDGER_HEAD}\n${lines.join('\n')}\n${LEDGER_RULE}`;
}

/*
 * A DEATH ON A PISTOL OR AN ECO "COSTS LITTLE" (the blind audit of round 6):
 * "Those hurt less than they look, because a death on a pistol or an eco costs
 * the team little" of Killjoy's four kills, the two pistol rounds and the eco
 * all lost. A pistol round lost shapes the rounds after it, so the judgement
 * stands only where every pistol death it is about came in a round the team
 * won. An eco is the save round, and a death on one losing little is the
 * game's own reading ("Round 2 was an eco, so that death cost little", held
 * true in test:valorantreview), so an eco alone judges nothing: the sentence
 * goes where it holds a pistol death of a round lost. The rounds are the
 * sentence's own, else the list of the sentence before, else every pistol
 * death of the match, and a death of no known buy judges nothing.
 */
const LOW_COST = /\bcost(?:s|ed)?\s+(?:the\s+team\s+|your\s+team\s+|you\s+|us\s+)?(?:very\s+|so\s+)?(?:little|nothing|almost\s+nothing|not\s+much|next\s+to\s+nothing)\b|\b(?:hurt|hurts|matter|matters|mattered|count|counts)\s+(?:much\s+|a\s+lot\s+|far\s+)?less\b|\b(?:don't|doesn't|didn't|do\s+not|does\s+not|did\s+not)\s+(?:really\s+)?(?:matter|hurt|cost\s+(?:you|the\s+team|your\s+team))\s+(?:much|a\s+lot)\b|\b(?:cheap|free|harmless)\s+deaths?\b|\bnot\s+(?:a\s+)?(?:big|real)\s+(?:loss|deal|cost)\b/i;
const LOW_BUY = /\b(pistol(?:\s+rounds?)?|ecos?(?:\s+rounds?)?|save\s+rounds?)\b/gi;
function checkLowCost(sentence, ctx, st) {
  const t = straight(sentence);
  const lc = LOW_COST.exec(t);
  if (!ctx || !ctx.rounds.size || OPENS_IF.test(t) || !lc) return null;
  // Of a death or a round, never "a miss costs you nothing" (the sweep over 8.7.7).
  if (!/\b(?:deaths?|dying|die|died|los(?:e|es|ing|t)|loss|rounds?|those|these|they)\b/i.test(clauseAt(t, lc.index))) return null;
  const kinds = new Set();
  for (const m of t.matchAll(LOW_BUY)) kinds.add(/^pistol/i.test(m[1]) ? 'pistol' : 'eco');
  if (!kinds.has('pistol')) return null;
  const named = roundsIn(t);
  const pool = named.length ? named : st && Array.isArray(st.lastSet) && st.lastSet.length ? st.lastSet : [...ctx.rounds.keys()];
  const rows = pool.map((n) => ctx.rounds.get(n)).filter((r) => r && r.died && r.buy === 'pistol' && r.result);
  const lost = rows.filter((r) => r.result === 'lost').map((r) => r.n);
  if (!lost.length) return null;
  return `your reply said a death on a pistol round costs little, where Riot's record has the team losing pistol round${lost.length > 1 ? 's' : ''} ${lost.join(' and ')}, and a lost pistol round shapes the economy of the rounds after it; say what the death cost`;
}

/*
 * THE LAST ROUND, THE FIRST ROUND (the blind audit of round 6): "Your costliest
 * mistake was the death in round 5, the last round of the match", of a match of
 * six rounds. A round called the match's last where the record has a round
 * after it, or its first where it is not round 1, goes. "The last round you
 * lost" is another claim, and is not read.
 */
const ORDINAL_SAID = /\bround\s+([0-9]{1,2}),?\s+(?:(?:which|that)\s+(?:was|is)\s+|(?:was|is)\s+)?the\s+(last|final|first|opening)\s+round(?:\s+of\s+the\s+(?:match|game))?(?=\s*[,.!?]|\s*$|\s+(?:and|but|so|where|when)\b)/i;
function checkOrdinal(sentence, ctx) {
  const t = straight(sentence);
  const m = ORDINAL_SAID.exec(t);
  if (!m || !ctx || !ctx.rounds.size) return null;
  const n = Number(m[1]);
  const w = m[2].toLowerCase();
  const last = Math.max(...ctx.rounds.keys(), fin(ctx.total) ? ctx.total : 0);
  if ((w === 'last' || w === 'final') && n < last) return `your reply called round ${n} the last round of the match, where the match went to round ${last}`;
  if ((w === 'first' || w === 'opening') && n !== 1) return `your reply called round ${n} the first round of the match, which was round 1`;
  return null;
}

/*
 * THE TIMELINE AND THE STATE (round 8, the blind audit of round 7). Seven
 * claims, each true of another moment or another number than the one it was
 * said of, each judged only where Riot's record makes it certainly false:
 *
 *   checkPlantPhase  "As your teammate plants, hold from cover" of Fracture
 *                    round 5, where the death came after the spike went
 *                    down, and "while your team was planting" of a death long
 *                    before it. Planting takes 4 s: a death from 4.5 s before
 *                    Riot's plant second to half a second after it fits.
 *   checkEnemyRole   "make the attacker expose themselves" to an attacker
 *                    (Corrode round 1): the one made to move is the enemy, so
 *                    the noun is the other side's. Only the noun a verb acts
 *                    on, or one coming at "you", in one round of known side.
 *   checkFirst       "rounds 3 and 5, where you were the first contact" of a
 *                    death 4 against 5: a teammate was already down. A first
 *                    fight word goes too where the enemy had lost one and the
 *                    record says the first kill was not the player's.
 *   checkLeftWords   "your death left four players ... a man down" of a death
 *                    4 against 5, which left 3 against 5, two down.
 *   checkLater       "the spike landed at B. Six seconds later you were dead"
 *                    where the death came 1.5 s after the plant: a gap is held
 *                    to its own anchor, the event it names, else the last
 *                    plant or kill of the player's told before it.
 *   checkKillPlace   "After the first kill at A Alley" of Sunset round 7,
 *                    where the kill fell at A Elbow and the player died at A
 *                    Alley: a kill's place held to Riot's kill places.
 * (The seventh, the example of a habit held to the cost rank, is
 * checkClearest above.)
 */
const TIME_WORDS = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, fifteen: 15, twenty: 20 };
const timeNum = (w) => (/^[0-9]+(?:\.[0-9]+)?$/.test(String(w)) ? Number(w) : (TIME_WORDS[String(w || '').toLowerCase()] ?? null));
/** The rounds a claim at `at` is about: its clause's own, else the sentence's single round, else the paragraph's. */
function claimRounds(t, at, ctx, st) {
  const own = roundsIn(clauseAt(t, at));
  if (own.length) return own;
  const named = roundsIn(t);
  if (named.length) return named;
  const n = (st && st.round) || (ctx && ctx.asked) || null;
  return n != null ? [n] : [];
}

const PLANT_DURING = /\b(?:as|while|whilst)\s+(?:your\s+|a\s+|the\s+|an\s+)?(?:teammates?|team|ally|allies|you)\s+(?:(?:is|are|was|were)\s+)?(?:plant(?:s|ed|ing)?|(?:start(?:s|ed|ing)?|go(?:es)?\s+for|get(?:s|ting)?)\s+the\s+plant)\b|\b(?:during|through)\s+the\s+plant\b(?!\s+(?:site|spot))|\bmid[- ]plant\b|\b(?:as|while)\s+the\s+spike\s+(?:is|was)\s+(?:being\s+planted|going\s+down)\b/i;
function checkPlantPhase(sentence, ctx, st) {
  const t = straight(sentence);
  const m = PLANT_DURING.exec(t);
  if (!m || !ctx || !ctx.rounds.size || (ctx.kind === 'chat' && OPENS_IF.test(t))) return null;
  for (const n of claimRounds(t, m.index, ctx, st)) {
    const r = ctx.rounds.get(n);
    const sec = r && (fin(r.deathAt) ? r.deathAt : r.sec);
    if (!r || !r.died || !fin(sec) || !fin(r.plantSec)) continue;
    if (r.afterPlant === true && sec > r.plantSec + 0.5) {
      // The gap only from the feed's second: a review's death second is whole.
      const gap = fin(r.deathAt) ? ` ${Math.round((sec - r.plantSec) * 10) / 10} s` : '';
      return `your reply put round ${n} during the plant, where Riot's record has the death${gap} after the spike went down; say it with the spike down`;
    }
    if (sec + 0.5 < r.plantSec - 4.5) return `your reply put round ${n} during the plant, where the player died ${Math.round(r.plantSec - sec)} s before the spike went down`;
  }
  return null;
}

const ENEMY_ROLE_OBJ = /\b(?:make|makes|making|force|forces|forcing|bait|baits|baiting|punish|punishes|punishing|catch|catches|catching|wait(?:ing)?\s+for|deny|denies|denying|outlast|out-?wait|starve|starving|pressure|pressuring)\s+(?:the|an?|their|any|every|each|that|this)\s+(attackers?|defenders?)\b(?!\s+(?:on|of)\s+your\s+(?:own\s+)?team)/i;
const ENEMY_ROLE_SUBJ = /\b(?:the|an?|their)\s+(attackers?|defenders?)\s+(?:(?:has|have|had|must|needs?|will|would|can|could)\s+(?:to\s+)?)?(?:come|comes|coming|push|pushes|pushing|peek|peeks|peeking|swing|swings|swinging|walk|walks|walking|rush|rushes|run|runs)\s+(?:(?:in|out|up|through)\s+)?(?:to|into|onto|at|on)\s+you\b/i;
const OTHER_HALF = /\b(?:next|second|other|the\s+other)\s+half\b|\bafter\s+the\s+(?:switch|swap)\b|\bwhen\s+(?:the\s+)?sides\s+(?:switch|swap)\b/i;
function checkEnemyRole(sentence, ctx, st) {
  const t = straight(sentence);
  const m = ENEMY_ROLE_OBJ.exec(t) || ENEMY_ROLE_SUBJ.exec(t);
  if (!m || !ctx || !ctx.rounds.size) return null;
  const ns = claimRounds(t, m.index, ctx, st);
  if (ns.length !== 1) return null;
  const r = ctx.rounds.get(ns[0]);
  const said = /^att/i.test(m[1]) ? 'attack' : 'defence';
  if (!r || !r.side || r.side !== said) return null;
  // The advice moved to the other half (8.8 review): "In round 5 you were
  // attacking, but next half on defence, make the attackers come to you."
  // The role noun after a mention of the player on the other side, or of the
  // next half, is that half's enemy.
  const tail = t.slice(0, m.index);
  if (OTHER_HALF.test(tail) || (r.side === 'attack' ? SAYS_DEFENCE : SAYS_ATTACK).test(tail)) return null;
  return `your reply made the ${m[1].toLowerCase()} the enemy in round ${ns[0]}, where the player was ${r.side === 'attack' ? 'attacking, so the enemy were the defenders' : 'defending, so the enemy were the attackers'}`;
}

const FIRST_SAID = /\byou\s+(?:were|are|became)\s+(?:the\s+)?(?:first\s+contact|first\s+(?:to\s+die|death|one\s+(?:in|down|to\s+die|into\s+(?:the\s+)?(?:site|fight|space))|player\s+(?:down|in|to\s+die))|the\s+one\s+who\s+took\s+(?:the\s+)?first\s+contact)\b|\byou\s+(?:took|made|opened)\s+(?:the\s+)?first\s+(?:contact|fight|duel|gunfight)\b|\byour\s+death\s+(?:was|came)\s+(?:the\s+)?first\b|\b(?:this|that|your|the)\s+first\s+death\b|\byou\s+were\s+the\s+first\s+one\s+into\b/i;
function checkFirst(sentence, ctx, st) {
  const t = straight(sentence);
  const m = FIRST_SAID.exec(t);
  if (!m || !ctx || !ctx.rounds.size || OPENS_IF.test(t)) return null;
  const contact = /contact|fight|duel|gunfight|into/i.test(m[0]);
  for (const n of claimRounds(t, m.index, ctx, st)) {
    const r = ctx.rounds.get(n);
    if (!r || !r.died || r.firstDeath || !r.alive) continue;
    const mateDown = r.alive[0] < 5;
    const fightBefore = contact && r.alive[1] < 5 && r.firstKill === false;
    if (!mateDown && !fightBefore) continue;
    const down = 5 - r.alive[0];
    return `your reply called the player the first ${contact ? 'contact' : 'death'} in round ${n}, where Riot's record has ${r.alive[0]} against ${r.alive[1]} standing when they died, so ${mateDown ? `${down} teammate${down === 1 ? '' : 's'} had already died` : 'a teammate had already fought and got the first kill'}`;
  }
  return null;
}

const LEFT_HEAD = /\b(?:your\s+death|you\s+dying|your\s+dying|(?:that|this|which)\s+death)\s+(?:then\s+|also\s+)?(?:left|leaves|leaving|put|puts|meant)\b|\b(?:killed|caught|got)\s+you\b[^.;]{0,40}?,?\s+leaving\b|\byou\s+(?:died|went\s+down|fell)\b[^.;]{0,40}?,?\s+leaving\b/i;
const LEFT_N = /\b(four|three|two|one|[1-4])\s+(?:players|teammates|of\s+(?:you|your\s+team))\b(?!\s+down\b)/i;
const LEFT_DOWN = /\b(?:(a|one)\s+(?:man|player)|(two|three|four)\s+(?:men|players))\s+down\b/i;
const LEFT_EVENT = /\b(?:killed|died|traded|fell|went\s+down|then)\b/i;
function checkLeftWords(sentence, ctx, st) {
  const t = straight(sentence);
  const h = LEFT_HEAD.exec(t);
  if (!h || !ctx || !ctx.rounds.size || OPENS_IF.test(t)) return null;
  const ns = claimRounds(t, h.index, ctx, st);
  if (ns.length !== 1) return null;
  const r = ctx.rounds.get(ns[0]);
  if (!r || !r.died || !r.alive) return null;
  const after = [r.alive[0] - 1, r.alive[1]];
  const rest = t.slice(h.index + h[0].length, h.index + h[0].length + 80);
  const n = LEFT_N.exec(rest);
  // Another death told between the player's and the count is another standing.
  if (n && !LEFT_EVENT.test(rest.slice(0, n.index)) && timeNum(n[1]) !== after[0]) {
    return `your reply said the death in round ${ns[0]} left ${n[1]} players, where it left ${after[0]} against ${after[1]}`;
  }
  const d = LEFT_DOWN.exec(rest);
  if (d && !LEFT_EVENT.test(rest.slice(0, d.index))) {
    const down = d[1] ? 1 : timeNum(d[2]);
    if (down !== after[1] - after[0]) return `your reply said the death in round ${ns[0]} left the team ${d[0]}, where it left ${after[0]} against ${after[1]}`;
  }
  return null;
}

const LATER = /\b([0-9]+(?:\.[0-9]+)?|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fifteen|twenty)\s*(?:s|secs?|seconds?)\s+(later|after\s+(?:the\s+plant|the\s+spike\s+(?:went|was)\s+down|it\s+went\s+down|your\s+(?:last\s+|second\s+|first\s+)?kill|that))\b/i;
const PLANT_EVENT = /\b(?:the\s+spike\s+(?:landed|went\s+down|was\s+down|was\s+planted|got\s+planted|hit\s+the\s+ground)|(?:after|at|on)\s+the\s+plant|(?:they|your\s+team|the\s+team|you)\s+planted)\b/gi;
const KILL_EVENT = /\byou\s+(?:\([A-Za-z/]+\)\s+)?(?:killed|got|took\s+out|picked\s+off|beat)\b|\byour\s+(?:last\s+|second\s+|first\s+)?kill\b/gi;
const DEATH_THEN = /\b(?:you\s+(?:were|was)\s+dead|you\s+died|(?:killed|shot|caught|got)\s+you|you\s+went\s+down|your\s+death)\b/i;
function lastEvent(text) {
  let best = null;
  for (const m of String(text || '').matchAll(PLANT_EVENT)) if (!best || m.index >= best.at) best = { at: m.index, kind: 'plant' };
  for (const m of String(text || '').matchAll(KILL_EVENT)) if (!best || m.index > best.at) best = { at: m.index, kind: 'kill' };
  return best;
}
function checkLater(sentence, ctx, st) {
  const t = straight(sentence);
  const m = LATER.exec(t);
  if (!m || !ctx || !ctx.rounds.size || !DEATH_THEN.test(t)) return null;
  const ns = claimRounds(t, m.index, ctx, st);
  if (ns.length !== 1) return null;
  const r = ctx.rounds.get(ns[0]);
  if (!r || !r.died || !fin(r.deathAt)) return null;
  const how = m[2].toLowerCase();
  let anchor = null;
  let which = 'last';
  if (/plant|spike|went\s+down/.test(how)) anchor = 'plant';
  else if (/kill/.test(how)) { anchor = 'kill'; which = /first/.test(how) ? 'first' : /second/.test(how) ? 'second' : 'last'; }
  else {
    // The last event told before it, in this sentence, else the kept one before.
    const recent = (st && st.recent) || [];
    const ev = lastEvent(t.slice(0, m.index)) || lastEvent(recent[recent.length - 1]);
    anchor = ev ? ev.kind : null;
  }
  const kills = r.ownKills || [];
  const at = anchor === 'plant' ? r.plantSec
    : anchor === 'kill' ? (which === 'first' ? kills[0] : which === 'second' ? kills[1] : kills[kills.length - 1]) : null;
  if (!fin(at) || at > r.deathAt) return null;
  const gap = r.deathAt - at;
  if (Math.abs(gap - timeNum(m[1])) <= 1) return null;
  return `your reply said the death in round ${ns[0]} came ${String(m[1]).toLowerCase()} s after the ${anchor === 'plant' ? 'plant' : `player's ${which} kill`}, where Riot's record has ${Math.round(gap * 10) / 10} s; give each gap from its own event, as the facts state it`;
}

const KILL_OWNER_BEFORE = /\b(?:teammate'?s?|ally'?s?|allies'|their|enemy'?s?|his|her|team'?s)\s+(?:[a-z]+\s+)?$/i;
function checkKillPlace(sentence, ctx, st) {
  const t = straight(sentence);
  if (!ctx || !ctx.rounds.size || !ctx.map) return null;
  const pl = placesOf(ctx.map);
  if (!pl.alt) return null;
  const re = new RegExp(`\\b(?:(first|opening|your|the|a|an|that|second|last)\\s+)?(?:kills?|picks?|frags?)\\s+(you\\s+(?:got|made|took)\\s+)?(?:at|in|on|from|inside)\\s+(?:the\\s+)?(${pl.alt})(?![A-Za-z0-9])`, 'i');
  const m = placeMatch(re.source, t, 3);
  if (!m || articleNotSite(m[3]) || KILL_OWNER_BEFORE.test(t.slice(Math.max(0, m.index - 24), m.index))) return null;
  const ns = claimRounds(t, m.index, ctx, st);
  if (ns.length !== 1) return null;
  const r = ctx.rounds.get(ns[0]);
  if (!r || !r.killPlaces) return null;
  // Only a kill certainly the player's: "your kill", "the kill you got", or
  // the round's first kill where the record gives the player it.
  const q = String(m[1] || '').toLowerCase();
  const mine = q === 'your' || !!m[2] || ((q === 'first' || q === 'opening') && r.firstKill === true);
  if (!mine) return null;
  const said = m[3].toLowerCase();
  const canonical = (p) => pl.canonOf.get(String(p).toLowerCase()) || String(p).toLowerCase();
  const bareSite = /^[abc] site$/.test(said);
  const hit = r.killPlaces.some((p) => canonical(p) === canonical(said) || (bareSite && pl.sideOf.get(String(p).toLowerCase()) === said[0]));
  if (hit) return null;
  const deathThere = r.place && canonical(r.place) === canonical(said);
  return `your reply put the player's kill in round ${ns[0]} at ${m[3]}, where Riot's record has the enemy falling at ${[...new Set(r.killPlaces)].join(', ')}${deathThere ? `, and ${r.place} is where the player died` : ''}; keep the kill's place and the death's apart`;
}

/*
 * THE DEATH'S PLACE IS RIOT'S (the blind audit of round 8, stream C: Corrode
 * 3 to 13 Iron, biggest mistake). "Round 10 shows it plainly: you moved into
 * the open at Mid Stairs at 27 s in, first death of the round, Phoenix killed
 * you with a Vandal", where Riot's record has the death at Mid Bottom: the
 * screen's spot and the look's words named Mid Stairs, and checkRecord judged
 * only a place on another site's side. A sentence about the player's death in
 * a round Riot places it in, that puts the player at one callout of the map
 * ("you moved into the open at X", "you died at X", "killed you in X") which
 * is not Riot's callout, nor an area holding it ("Mid" holds "Mid Bottom",
 * knowledge.js samePlace), nor a place of the player's kills in the round, is
 * kept with Riot's callout in its place ({ rewrite }). Judged only where the
 * player is the clause's subject before the place with no agent, pronoun,
 * teammate or kill between, the sentence names that one place for the player,
 * and Riot's place is a callout, never a bare site word (the client folds a
 * widened guess into one, valorant-verify.js placeName); a bare site word said
 * judges nothing either. A plan, an "if" or a "should" judges nothing.
 */
let KNOWLEDGE;
const knowledgeOf = () => {
  if (KNOWLEDGE === undefined) { try { KNOWLEDGE = require('./knowledge'); } catch { KNOWLEDGE = null; } }
  return KNOWLEDGE;
};
const PLACE_PREP = /(?:^|\s)(?:at|in|on|inside|into|onto|holding|near|by)\s+(?:the\s+)?$/i;
// A place as the player's verb's own object: "you peeked Mid Stairs", "you pushed Mid Stairs alone" (the stream C review).
const PLACE_VERB = /(?:^|\s)(?:peeked|pushed|swung|walked\s+up|walked\s+through|ran\s+up|ran\s+through|entered|took|contested|rushed|crossed)\s+(?:the\s+)?$/i;
const YOU_HEAD = /\byou\b(?!\s+(?:and|or)\b)/gi;
// "killed you", "caught you", "for you": the player as the object, never the clause's subject (the stream C review).
const YOU_OBJECT = /\b(?:killed|caught|shot|got|beat|took|picked\s+off|found|spotted|saw|hit|traded|punished|flanked|tagged|damaged|outgunned|outaimed|outdueled|left|let|forced|made|kept|cost|gave|for|with|to|at|against|behind|near|beside|than|who|whom)\s+$/i;
const PLACE_GAP_BREAK = new RegExp(`(?<![A-Za-z0-9])(?:${AGENT_ALT})(?![A-Za-z0-9])|\\b(?:he|she|they|them|him|her|his|their|enemy|enemies|teammates?|ally|allies|team|kills?|killed|killing|shot|traded|from|through|past|toward|towards|to|then|after|before)\\b`, 'i');
// Where the player was before the death, not where it came: "you started the round at X", "you spent 20 seconds in X".
const PLACE_EARLIER = /\b(?:started|starting|start|spent|spend|began|begin|opened|spawned|waited|set\s+up|came\s+from|left|rotated|rotating)\b/i;
// A later movement after the place: "at X and pushed down to Y", "in X before you died".
const PLACE_LATER = /^[^.;!?]{0,60}?\b(?:then|until|later|afterwards|before\s+(?:you\s+)?(?:died|dying|were\s+killed|got\s+killed|fell|went\s+down)|and\s+(?:then\s+)?(?:pushed|moved|walked|rotated|ran|went|swung|peeked|stepped|crossed|fell\s+back|dropped|headed))\b/i;
// The death's own verb right before the place, the words between it and the
// place as group 2, and a "who" or "that" before it (the Phoenix who killed
// you) as group 1. "Your round 10 death came at X" is one too.
const DEATH_PLACE_HEAD = /(\b(?:who|that|which|whom)\s+)?\b(?:you\s+died|your\s+(?:round\s+\d{1,2}\s+|first\s+|last\s+|only\s+)?death(?:\s+(?:came|was|happened))?|(?:killed|caught|picked\s+off|took)\s+you(?:\s+out)?|you\s+(?:were|got)\s+(?:killed|caught|picked\s+off|taken\s+out)|you\s+fell|you\s+went\s+down)\b((?:\s+[^\s.;,]+){0,4}?)\s+(?:at|in|on|near|inside|holding)\s+(?:the\s+)?$/i;
// "killed you while holding X", "caught you while he was in X": the place is the killer's.
const DEATH_GAP_BREAK = /\b(?:while|as|when|who|which|that|whom|was|were|is|are|sat|sitting|standing|waiting|playing|lurking|hiding|held|camping|watching)\b/i;
const DEATH_SAID = /\b(?:you\s+died|your\s+(?:round\s+\d{1,2}\s+|first\s+|last\s+|only\s+)?death|died|killed\s+you|(?:caught|picked\s+off|took|shot|got|beat)\s+you|first\s+death|you\s+(?:were|got)\s+(?:killed|caught|picked\s+off|taken\s+out)|you\s+fell|you\s+went\s+down)\b/i;
const placeShown = (p) => String(p).replace(/^([abc]) site$/i, (_s, l) => `${l.toUpperCase()} Site`);
function checkDeathPlace(sentence, ctx, st) {
  const t = straight(sentence);
  if (!ctx || !ctx.rounds.size || !ctx.map || OPENS_IF.test(t) || HYPO.test(t) || !DEATH_SAID.test(t)) return null;
  const n = roundOfSentence(t, ctx, st);
  const r = n != null ? ctx.rounds.get(n) : null;
  if (!r || !r.died || !r.place || /^[abc] site$/i.test(r.place)) return null;
  const pl = placesOf(ctx.map);
  if (!pl.alt) return null;
  const k = knowledgeOf();
  const same = (a, b) => {
    const x = String(a).toLowerCase();
    const y = String(b).toLowerCase();
    if (x === y || (pl.canonOf.get(x) || x) === (pl.canonOf.get(y) || y)) return true;
    return !!(k && typeof k.samePlace === 'function' && k.samePlace(ctx.map, x, y));
  };
  // Every place the player is put at, by the clause's own "you" before it.
  const said = [];
  const re = new RegExp(`(?<![A-Za-z0-9])(${pl.alt})(?![A-Za-z0-9])`, 'gi');
  let m;
  let riotNamed = false;
  while ((m = re.exec(t)) !== null) {
    if (articleNotSite(m[1])) continue;
    // Riot's own place said anywhere: the death is told there, and any other
    // place is where the player was before it ("you started at X and pushed
    // down to Mid Bottom, where Phoenix killed you").
    if (!/^[abc] site$/i.test(m[1]) && same(m[1], r.place)) { riotNamed = true; continue; }
    const from = clauseStart(t, m.index);
    const head = t.slice(from, m.index);
    const prep = PLACE_PREP.test(head);
    const verb = !prep && PLACE_VERB.test(head);
    if (!prep && !verb) continue;
    // The death's verb right before the place, with nothing of the killer's between.
    const dh = prep ? DEATH_PLACE_HEAD.exec(t.slice(Math.max(from, m.index - 80), m.index)) : null;
    const deathHead = !!dh && !dh[1] && !PLACE_GAP_BREAK.test(dh[2] || '') && !DEATH_GAP_BREAK.test(dh[2] || '');
    if (!deathHead) {
      // Else the clause's own "you" as its subject, before it.
      const yous = [...head.matchAll(YOU_HEAD)].filter((y) => !YOU_OBJECT.test(head.slice(0, y.index)));
      if (!yous.length) continue;
      const y = yous[yous.length - 1];
      const gap = head.slice(y.index + y[0].length).replace(prep ? PLACE_PREP : PLACE_VERB, ' ');
      if (gap.trim().split(/\s+/).filter(Boolean).length > 7 || PLACE_GAP_BREAK.test(gap) || PLACE_EARLIER.test(gap)) continue;
      if (PLACE_LATER.test(t.slice(m.index + m[0].length))) continue;
    }
    said.push({ at: m.index, text: m[1] });
  }
  if (riotNamed) return null;
  const distinct = [...new Set(said.map((x) => pl.canonOf.get(x.text.toLowerCase()) || x.text.toLowerCase()))];
  if (distinct.length !== 1) return null;
  const p = said[0].text;
  if (/^[abc] site$/i.test(p)) return null;
  if (same(p, r.place) || (r.killPlaces || []).some((q) => same(p, q))) return null;
  let out = t;
  for (const x of [...said].sort((a, b) => b.at - a.at)) out = out.slice(0, x.at) + placeShown(r.place) + out.slice(x.at + x.text.length);
  return { rewrite: out };
}

/*
 * KILLS AGAINST DEATHS, AS THE SCOREBOARD HAS THEM (the blind audit of round
 * 8, stream C: Split 13 to 7 Ascendant, improve at rank). "You took fights you
 * could not win cleanly, so you died more than you killed" of a match the
 * player went 17 and 16. A comparison of the player's kills and deaths in the
 * match ("died more than you killed", "more deaths than kills", "a negative
 * K/D", "a K/D under 1", and the other way round) the scoreline makes false
 * goes; where it is a clause after a comma ("..., so you died more than you
 * killed"), the clause is cut and the sentence kept ({ rewrite }). Never
 * under a negation, an "if" or a plan ("stop dying more than you kill"), nor
 * of a round named in the sentence (a round's kills are another count).
 */
const DEATHS_MORE = /\b(?:you\s+)?(?:died|die|dying|dies)\s+more\s+(?:often\s+|times\s+)?than\s+(?:you\s+(?:killed|kill|got\s+kills|traded|were\s+killing)|killing)\b|\bmore\s+deaths\s+than\s+(?:you\s+(?:got|had)\s+)?kills\b|\bfewer\s+kills\s+than\s+deaths\b|\b(?:killed|kill)\s+(?:less|fewer)(?:\s+often)?\s+than\s+you\s+(?:died|die)\b|\b(?:a\s+)?negative\s+(?:K\/D|KD|kill\s*[-/]?\s*death(?:\s+ratio)?)\b|\b(?:K\/D|KD)(?:\s+ratio)?\s+(?:was\s+|of\s+|is\s+|sat\s+|stayed\s+)?(?:below|under|less\s+than)\s+(?:1(?:\.0+)?|one|even)\b|\b(?:your\s+)?deaths\s+outnumbered\s+(?:your\s+)?kills\b|\b(?:went|finished|ended)\s+(?:the\s+(?:match|game)\s+)?(?:negative|in\s+the\s+negatives?)\b/i;
const KILLS_MORE = /\b(?:you\s+)?(?:killed|kill|killing)\s+more\s+(?:often\s+|times\s+)?than\s+(?:you\s+(?:died|die|were\s+dying)|dying)\b|\bmore\s+kills\s+than\s+(?:you\s+had\s+)?deaths\b|\bfewer\s+deaths\s+than\s+kills\b|\b(?:died|die)\s+(?:less|fewer)(?:\s+often)?\s+than\s+you\s+(?:killed|kill)\b|\b(?:a\s+)?positive\s+(?:K\/D|KD|kill\s*[-/]?\s*death(?:\s+ratio)?)\b|\b(?:K\/D|KD)(?:\s+ratio)?\s+(?:was\s+|of\s+|is\s+|sat\s+|stayed\s+)?(?:above|over|more\s+than)\s+(?:1(?:\.0+)?|one|even)\b|\b(?:your\s+)?kills\s+outnumbered\s+(?:your\s+)?deaths\b|\b(?:went|finished|ended)\s+(?:the\s+(?:match|game)\s+)?(?:positive|in\s+the\s+positives?)\b/i;
const KD_NEG = /\b(?:not|never|didn't|did\s+not|don't|do\s+not|no|stop|avoid|without|if|unless|when|whenever)\s+(?:\w+\s+){0,2}$/i;
// Another subject than the player: an agent, a teammate, the team, them (the stream C review).
const KD_OTHER = new RegExp(`(?<![A-Za-z0-9])(?:${AGENT_ALT})(?![A-Za-z0-9])|\\b(?:he|she|they|their|them|his|her|teammates?|team|enemy|enemies|opponents?|everyone|everybody)\\b`, 'i');
const GUN_ALT = (Array.isArray(DATA.weapons) ? DATA.weapons : Object.keys(DATA.weapons || {})).map(esc).join('|') || 'NO_GUN';
// A part of the match, not the whole: a half, a side, a gun, another match (the stream C review).
const KD_SCOPE = new RegExp(`\\b(?:first|second|other|1st|2nd)\\s+half\\b|\\b(?:on|in|during)\\s+(?:attack|defen[cs]e|offen[cs]e)\\b|\\b(?:attack|defen[cs]e|attacking|defending)\\s+(?:side|half|rounds?)\\b|\\b(?:with|on|using)\\s+(?:the\\s+|your\\s+|an?\\s+)?(?:${GUN_ALT})\\b|\\b(?:last|previous|earlier|other)\\s+(?:match|game)(?:es)?\\b|\\b(?:pistol|eco|bonus)\\s+rounds?\\b`, 'i');
const KD_CUT = /,\s*(?:so|and|which\s+(?:is\s+)?(?:why|how)|meaning|leaving|as)\s+[^,]*$/i;
function checkKillsDeaths(sentence, ctx) {
  const sl = ctx && ctx.scoreline;
  if (!sl || !fin(sl.kills) || !fin(sl.deaths)) return null;
  const t = straight(sentence);
  if (OPENS_IF.test(t) || roundsIn(t).length || KD_SCOPE.test(t)) return null;
  for (const [re, wrong, said] of [[DEATHS_MORE, sl.deaths <= sl.kills, 'more deaths than kills'], [KILLS_MORE, sl.kills <= sl.deaths, 'more kills than deaths']]) {
    const m = re.exec(t);
    if (!m || !wrong || KD_NEG.test(t.slice(Math.max(0, m.index - 40), m.index))) continue;
    // The player as the comparison's subject: "you died more", "your deaths
    // outnumbered", "you had more deaths than kills", never "their Reyna had".
    if (!/^you(?:r)?\b/i.test(m[0])) {
      const before = t.slice(clauseStart(t, m.index), m.index);
      const yous = [...before.matchAll(/\byou(?:r)?\b/gi)];
      if (!yous.length || KD_OTHER.test(before.slice(yous[yous.length - 1].index))) continue;
    }
    const reason = `your reply said the player had ${said} in the match, where the scoreboard has ${sl.kills} kills and ${sl.deaths} deaths; compare them only as the scoreline gives them`;
    // The comparison as a clause after a comma: cut, the sentence before it kept.
    const tail = KD_CUT.exec(t.slice(0, m.index + m[0].length));
    if (tail && t.slice(m.index + m[0].length).replace(/[.!?\s]+$/, '') === '') {
      const kept = t.slice(0, tail.index).replace(/[\s,;:]+$/, '');
      if (kept.split(/\s+/).length >= 4) return { rewrite: `${kept}.` };
    }
    return reason;
  }
  return null;
}

/*
 * A COUNT AND THE ROUNDS IT LISTS (the blind audit of round 8, stream C: the
 * Pearl 1 to 5 Ascendant review). "5 of your 5 deaths coming in the first 30
 * seconds, before any plant, in rounds 1, 3, 4 and 5", where the counted line
 * says rounds 1, 3, 4, 5 and 6. A count ("N of your M deaths", "N times",
 * "twice") with the rounds it happened in listed after it ("in rounds 1, 3,
 * 4 and 5", "rounds 3 to 6") must list as many rounds as it counts and, where
 * a counted line of the match gives that count with its rounds, those rounds:
 * the list is written as the counted line has it ({ rewrite }), and a count
 * whose list cannot agree with any counted line goes. "And 2 more",
 * "including", "such as", "for example" list some of them and judge nothing.
 */
const COUNT_WORDS = { once: 1, twice: 2, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12 };
// "All 5 of your deaths" as groups 6 and 7 (the stream C review).
const COUNT_HEAD = /\b(?:all\s+(\d{1,2}|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\s+of\s+(?:your|the|those)\s+([a-z]+)|(\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\s+of\s+(?:your|the|those|his|her|their|its)\s+(\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|sixteen|twenty)\s+([a-z]+)|(\d{1,2}|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\s+times|(once|twice))\b/gi;
// The list straight after a comma, a colon, a bracket or "in", "during" or
// "on", never "before round 5", "after round 10" or "by round 4" (the stream C review).
const LIST_AFTER = /^[^.;:]{0,90}?(?:,\s*(?:(?:in|during|on)\s+)?|\s+(?:in|during|on)\s+|\s*\(\s*(?:in\s+)?|:\s*(?:in\s+)?)(?:the\s+)?rounds?\s+([0-9]{1,2}(?:(?:\s*,\s*(?:and\s+)?|\s+and\s+|\s+(?:to|through)\s+)[0-9]{1,2}(?![0-9]|\s*(?:s|secs?|seconds?)\b))*)/i;
// "In rounds 1, 3, 4 and 5, all 5 of your deaths came early": the list before the count.
const LIST_BEFORE = /(\b(?:in|during|on|across)\s+(?:the\s+)?rounds?\s+)([0-9]{1,2}(?:(?:\s*,\s*(?:and\s+)?|\s+and\s+|\s+(?:to|through)\s+)[0-9]{1,2}(?![0-9]|\s*(?:s|secs?|seconds?)\b))*)\s*,\s*$/i;
// "starting in round 1", "from round 7 on": where a run begins, not the rounds counted.
const LIST_NOT_BEFORE = /\b(?:starting|beginning|from|since|by|until|till|before|after|through|up\s+to)\s+(?:(?:in|on|with)\s+)?(?:the\s+)?rounds?\s+$/i;
// What was counted, by kind, so a list is only ever written from a counted line about the same thing.
const COUNT_KINDS = [
  ['untraded', /\b(?:untraded|unanswered|unavenged|not\s+traded|no\s+trade|without\s+a\s+trade|nobody\s+traded)\b/i],
  ['traded', /\b(?:were|was|got)\s+traded\b|\btraded\s+back\b/i],
  ['early', /\b(?:first\s+\d{1,3}\s+(?:s|secs?|seconds?)|early|before\s+(?:any|the)\s+plant)\b/i],
  ['alone', /\b(?:alone|isolated|nobody\s+(?:close|near)|no\s+teammate\s+(?:close|near))\b/i],
  ['first', /\b(?:first\s+(?:to\s+die|death|blood)|died\s+first|opening\s+death)\b/i],
  ['postplant', /\b(?:after\s+the\s+plant|post[ -]?plant)\b/i],
  ['lost', /\blost\b/i],
  ['won', /\bwon\b/i],
];
const countKinds = (s) => new Set(COUNT_KINDS.filter(([, re]) => re.test(String(s || ''))).map(([k]) => k));
const ROUND_NUMS = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20 };
const ROUND_WORD_ALT = Object.keys(ROUND_NUMS).sort((a, b) => b.length - a.length).join('|');
const ROUND_WORD_RUN = new RegExp(`\\b(rounds?\\s+)((?:${ROUND_WORD_ALT})(?:(?:\\s*,\\s*(?:and\\s+)?|\\s+and\\s+|\\s+(?:to|through)\\s+)(?:${ROUND_WORD_ALT}))*)\\b`, 'gi');
const R_RUN = /\bR(\d{1,2})((?:(?:\s*,\s*(?:and\s+)?|\s+and\s+)R\d{1,2})+)\b/g;
/** A run of rounds as digits: "rounds one, three and four" and "R1, R3 and R4" are "rounds 1, 3 and 4". */
function foldRounds(text) {
  return String(text || '')
    .replace(R_RUN, (all) => `rounds ${all.replace(/\bR(\d{1,2})\b/g, '$1')}`)
    .replace(ROUND_WORD_RUN, (_all, head, run) => `${head}${run.replace(new RegExp(`\\b(?:${ROUND_WORD_ALT})\\b`, 'gi'), (w) => String(ROUND_NUMS[w.toLowerCase()]))}`);
}
const LIST_SOME = /\b(?:and\s+\d+\s+more|and\s+(?:two|three|four|five|six)\s+more|including|such\s+as|for\s+example|e\.g\.|like|among\s+them|among\s+others|most\s+clearly|notably)\b/i;
const COUNT_DEATH_BEFORE = /\b(?:died|die|killed\s+you|got\s+you|caught\s+you|first\s+to\s+die|first\s+death)\b[^.;]*$/i;
// A list in a clause of its own: "14 of your 16 deaths went unanswered, and in rounds 1, 3 and 4 no teammate was close" (Split Silver aim).
const COUNT_NEW_CLAUSE = /\b(?:and|but|while|whereas)\s+(?:you|your|they|their|he|she|his|her|a\s+teammate|nobody)\b|,\s*(?:and|but|while)\b|\b(?:and|but)\s+(?:(?:in|at|on|during)\s+)?(?:the\s+)?rounds?\s+$/i;
const countWord = (w) => (/^\d+$/.test(String(w)) ? Number(w) : COUNT_WORDS[String(w || '').toLowerCase()] ?? null);
function runRounds(run) {
  const out = [];
  const toks = String(run).split(/(\s*,\s*(?:and\s+)?|\s+and\s+|\s+(?:to|through)\s+)/i);
  for (let i = 0; i < toks.length; i += 2) {
    const v = Number(toks[i]);
    const sep = i > 0 ? toks[i - 1] : '';
    if (/to|through/i.test(sep) && out.length) {
      const from = out[out.length - 1];
      for (let k = from + 1; k <= v && k - from <= 30; k++) out.push(k);
    } else out.push(v);
  }
  return out;
}
const listWords = (ns) => (ns.length === 1 ? `round ${ns[0]}` : `rounds ${ns.slice(0, -1).join(', ')} and ${ns[ns.length - 1]}`);
function checkCountList(sentence, ctx) {
  const texts = ctx && Array.isArray(ctx.countedTexts) ? ctx.countedTexts : null;
  const t = foldRounds(straight(sentence));
  if (OPENS_IF.test(t)) return null;
  let out = t;
  let changed = false;
  for (const m of t.matchAll(COUNT_HEAD)) {
    // "Every one of your 5 deaths" counts 5, not 1 (the stream C review).
    const every = m[3] && /^one$/i.test(m[3]) && /\b(?:every|each|any)\s+$/i.test(t.slice(0, m.index));
    const said = countWord(every ? m[4] : (m[1] || m[3] || m[6] || m[7]));
    if (!said) continue;
    const noun = m[1] ? m[2] : m[5];
    const total = m[1] ? said : (m[3] ? countWord(m[4]) : null);
    // A death or a round happens once a round; a kill or a trade may not.
    if ((m[1] || m[3]) && !/^(?:deaths?|rounds?)$/i.test(noun)) continue;
    if (!m[1] && !m[3] && !COUNT_DEATH_BEFORE.test(t.slice(Math.max(0, m.index - 50), m.index))) continue;
    const after = t.slice(m.index + m[0].length);
    let runAt;
    let run;
    let between;
    const l = LIST_AFTER.exec(after);
    if (l) {
      // Another count before the list owns it.
      between = after.slice(0, l.index + l[0].length - l[1].length);
      if (new RegExp(COUNT_HEAD.source, 'i').test(between) || new RegExp(AGENT_RE.source).test(between) || COUNT_NEW_CLAUSE.test(between) || LIST_NOT_BEFORE.test(between)) continue;
      const tail = after.slice(l.index + l[0].length, l.index + l[0].length + 24);
      // "rounds 1, 5, 7 and 3 more": the run took the "and 3" of the tail. "From round 7 on".
      if (LIST_SOME.test(between) || LIST_SOME.test(tail) || /^\s*(?:and|or)\s+\d/i.test(tail) || /^\s*more\b/i.test(tail) || /^\s+(?:on|onwards?)\b/i.test(tail)) continue;
      runAt = m.index + m[0].length + l.index + l[0].length - l[1].length;
      run = l[1];
    } else {
      const lb = (m[1] || m[3]) ? LIST_BEFORE.exec(t.slice(0, m.index)) : null;
      if (!lb) continue;
      runAt = lb.index + lb[1].length;
      run = lb[2];
      between = after.replace(/[.!?]\s*$/, '');
    }
    const listed = runRounds(run);
    // One round named is where a count happened ("in the round 3 retake"), never its list.
    if (listed.length < 2) continue;
    // The counted line with this count, as many rounds listed, and the same thing counted.
    const pair = total != null ? `${said} of ${(m[0].match(/\bof\s+(your|the|those|his|her|their|its)\b/i) || [])[1] || 'your'} ${total} ${String(noun).toLowerCase()}`.toLowerCase() : null;
    const kinds = countKinds(between);
    let fact = null;
    for (const c of texts || []) {
      const x = String(c).toLowerCase();
      const at = pair ? x.indexOf(pair) : -1;
      if (at < 0) continue;
      const lc = LIST_AFTER.exec(x.slice(at + pair.length));
      if (!lc) continue;
      const ns = runRounds(lc[1]);
      if (ns.length !== said) continue;
      const theirs = countKinds(x.slice(at + pair.length, at + pair.length + lc.index + lc[0].length - lc[1].length));
      if (![...kinds].some((k) => theirs.has(k))) continue;
      if (fact && fact.join() !== ns.join()) { fact = null; break; }
      fact = ns;
    }
    if (fact && fact.join() !== listed.join()) {
      // "rounds" written before the run stays; only the numbers are the counted line's.
      const head = out.slice(0, runAt).replace(/\brounds?\s+$/i, '');
      out = `${head}${listWords(fact)}${out.slice(runAt + run.length)}`;
      changed = true;
      break;
    }
    if (!fact && listed.length !== said) {
      return `your reply counted ${said} and listed ${listed.length} round${listed.length === 1 ? '' : 's'} (${listed.join(', ')}); a count and the rounds it lists must agree, as the counted lines give them`;
    }
  }
  return changed ? { rewrite: out } : null;
}

/*
 * A LIST OF ROUNDS WITH NO COUNT, TOLD AS THE WHOLE SET (the stream C review's
 * open gap, Nov 2026). "Your early deaths came in rounds 1, 3, 4 and 5" where
 * the counted line says "5 of your 5 deaths came in the first 30 seconds,
 * before any plant, in rounds 1, 3, 4, 5 and 6": no count to hold the list
 * to, and the player reads round 6 as no early death. A list after "your" or
 * "the" deaths of one kind (early, untraded, traded, opening, "before any
 * plant", "nobody traded") and a verb is the whole set of that kind, and
 * where the match has that whole set (wholeSets: a counted line whose list
 * is as long as its count, or Riot's rows where every death's trade is known
 * and the rows are the whole match) a list missing some of its rounds is
 * written as the set ({ rewrite }). A list with a round outside the set, or
 * of two kinds, judges nothing (the other readers judge each round). Never
 * touched: "two of your early deaths", "including", "and 3 more", a part of
 * them ("your early deaths to Omen", "on defence"), a list in its own clause.
 */
const WHOLE_RUN = '([0-9]{1,2}(?:(?:\\s*,\\s*(?:and\\s+)?|\\s+and\\s+|\\s+(?:to|through)\\s+)[0-9]{1,2}(?![0-9]|\\s*(?:s|secs?|seconds?)\\b))*)';
const WHOLE_KIND = '(early|untraded|unanswered|unavenged|opening|traded)\\s+deaths|deaths\\s+(?:that\\s+(?:went|were|came)\\s+)?(untraded|unanswered|unavenged|nobody\\s+traded|no\\s+one\\s+traded|before\\s+(?:any|the)\\s+plant|in\\s+the\\s+first\\s+30\\s+seconds(?:\\s+of\\s+the\\s+round)?)';
// The verbs a whole list is told with, and a colon ("Your early deaths: rounds 1, 3 and 4").
const WHOLE_VERB = '(?:(?:were|was|came|happened|fell|landed|occurred|showed\\s+up|took\\s+place|turned\\s+up)\\s+(?:all\\s+)?(?:(?:in|on|during)\\s+)?(?:the\\s+)?|:\\s*)';
const WHOLE_LIST = new RegExp(`\\b(?:all\\s+(?:of\\s+)?|each\\s+of\\s+|every\\s+one\\s+of\\s+)?(?:your|the)\\s+(?:${WHOLE_KIND})\\s*(?:in\\s+(?:this|the)\\s+match\\s+)?(?:all\\s+)?${WHOLE_VERB}(rounds?\\s+)${WHOLE_RUN}`, 'gi');
// "Every early death came in rounds 1, 3 and 4": (kind, word, run).
const WHOLE_EVERY = new RegExp(`\\b(?:every|each)\\s+(early|untraded|unanswered|unavenged|opening|traded)\\s+death\\s*(?:in\\s+(?:this|the)\\s+match\\s+)?${WHOLE_VERB}(rounds?\\s+)${WHOLE_RUN}`, 'gi');
// "Rounds 1, 3 and 4 were your early deaths": (word, run, kind, kind).
const WHOLE_REVERSED = new RegExp(`\\b(rounds\\s+)${WHOLE_RUN}\\s+(?:were|are)\\s+(?:all\\s+)?(?:your|the)\\s+(?:${WHOLE_KIND})`, 'gi');
// Only a list that ends its clause is told as the whole set: the end of the
// sentence, or a new clause ("so slow down", "and each one left you short").
// Anything else after it ("then again in 15 and 18", "and 2 other rounds",
// "for instance", "this half", "too", "among four") may make it a part.
const WHOLE_CLEAN_TAIL = /^\s*(?:[.!?]|$|,\s*(?:so|which|because|since|each|every|and\s+(?:that|this|it|each|every))\b)/i;
// A negated or limited head is never the whole set: "Not all of", "Even your", "Only".
const WHOLE_NOT_BEFORE = /\b(?:not|never|nor|even|only|just|if|unless)\s+$/i;
// "The rounds where you died early were rounds 1, 3 and 4".
const WHOLE_ROUNDS = new RegExp(`\\bthe\\s+rounds\\s+(?:where|in\\s+which|when)\\s+you\\s+(died\\s+early|died\\s+first|were\\s+the\\s+first\\s+to\\s+die|died\\s+before\\s+(?:any|the)\\s+plant|died\\s+untraded)\\s+(?:were|are)\\s+(rounds?\\s+)?${WHOLE_RUN}`, 'gi');
// A part of the set, never the whole: "two of", "the worst of", "most".
const WHOLE_PART_BEFORE = /(?:\bof|[0-9]|\b(?:some|most|both|few|several|many|two|three|four|five|six|seven|eight|nine|ten|other|worst|costliest|clearest))\s+$/i;
// The list said of a part after it: "rounds 1 and 3 on defence", "to Omen".
const WHOLE_PART_AFTER = /^\s+(?:to|against|by|on|at|in|during|when|while|with|from|as)\b/i;
const FIRST_LINE = /\bfirst\s+player\s+to\s+die\s+in\s+(\d{1,2})\s+of\s+\d{1,2}\s+rounds?,\s*(?:in\s+)?rounds?\s+([0-9]{1,2}(?:(?:\s*,\s*(?:and\s+)?|\s+and\s+)[0-9]{1,2})*)/i;
const wholeKind = (w) => {
  const x = String(w || '').toLowerCase().replace(/\s+/g, ' ');
  if (/^(?:early|before (?:any|the) plant|in the first 30 seconds.*|died early|died before (?:any|the) plant)$/.test(x)) return 'early';
  if (/^(?:untraded|unanswered|unavenged|nobody traded|no one traded|died untraded)$/.test(x)) return 'untraded';
  if (x === 'traded') return 'traded';
  if (/^(?:opening|died first|were the first to die)$/.test(x)) return 'first';
  return null;
};
/** The whole set of each kind the match holds: Map kind => sorted rounds; a kind two sources give apart is left out. */
function wholeSets(ctx) {
  const found = new Map();
  const bad = new Set();
  const put = (k, ns) => {
    const v = [...new Set(ns)].sort((a, b) => a - b);
    if (found.has(k) && found.get(k).join() !== v.join()) bad.add(k);
    found.set(k, v);
  };
  for (const c of (ctx && Array.isArray(ctx.countedTexts) ? ctx.countedTexts : [])) {
    const x = foldRounds(straight(c)).toLowerCase();
    const f = FIRST_LINE.exec(x);
    if (f) {
      const ns = runRounds(f[2]);
      if (ns.length === Number(f[1])) put('first', ns);
    }
    for (const m of x.matchAll(new RegExp(COUNT_HEAD.source, 'gi'))) {
      if (!m[3] || !/^deaths?$/.test(m[5])) continue;
      const said = countWord(m[3]);
      const after = x.slice(m.index + m[0].length);
      const lc = LIST_AFTER.exec(after);
      if (!said || !lc) continue;
      const between = after.slice(0, lc.index + lc[0].length - lc[1].length);
      if (new RegExp(COUNT_HEAD.source, 'i').test(between) || LIST_SOME.test(between)) continue;
      const ns = runRounds(lc[1]);
      if (ns.length !== said) continue;
      for (const k of countKinds(between)) if (['early', 'untraded', 'traded', 'first'].includes(k)) put(k, ns);
    }
  }
  // Riot's rows, where they are the whole match and every death's trade is known.
  const rows = ctx && ctx.rounds ? [...ctx.rounds.values()] : [];
  const deaths = rows.filter((r) => r.died && !r.afk);
  if (rows.length && fin(ctx.total) && rows.length === ctx.total && deaths.length && deaths.every((r) => r.traded === true || r.untraded)) {
    put('untraded', deaths.filter((r) => r.untraded).map((r) => r.n));
    put('traded', deaths.filter((r) => r.traded === true).map((r) => r.n));
  }
  for (const k of bad) found.delete(k);
  return found;
}
function checkWholeList(sentence, ctx) {
  const t = foldRounds(straight(sentence));
  if (OPENS_IF.test(t) || !/\brounds?\s+[0-9]/i.test(t)) return null;
  let sets = null;
  // Each reader with where its kind, its "rounds" word and its run are.
  const shapes = [
    [WHOLE_LIST, (m) => [m[1] || m[2], m[3], m[4]]],
    [WHOLE_ROUNDS, (m) => [m[1], m[2], m[3]]],
    [WHOLE_EVERY, (m) => [m[1], m[2], m[3]]],
    [WHOLE_REVERSED, (m) => [m[3] || m[4], m[1], m[2]]],
  ];
  for (const [re, parts] of shapes) {
    for (const m of t.matchAll(new RegExp(re.source, 'gi'))) {
      const [kindWord, word, run] = parts(m);
      const kind = wholeKind(kindWord);
      if (!kind || !run) continue;
      const before = t.slice(Math.max(0, m.index - 24), m.index);
      if (WHOLE_PART_BEFORE.test(before) || WHOLE_NOT_BEFORE.test(before)) continue;
      // A negation earlier in the sentence ("Not all of your", "It is not true that").
      if (/\b(?:not|never|nor|isn't|aren't|wasn't|weren't|didn't|don't|doesn't)\b/i.test(t.slice(0, m.index + 12))) continue;
      const end = m.index + m[0].length;
      const rest = t.slice(end);
      const tail = rest.slice(0, 24);
      if (LIST_SOME.test(m[0]) || LIST_SOME.test(rest) || /^\s*,?\s*(?:and|or|plus)\s+(?:(?:the\s+)?rounds?\s+)?\d/i.test(tail) || /^\s*more\b/i.test(tail) || /^\s+onwards?\b/i.test(tail) || WHOLE_PART_AFTER.test(tail)) continue;
      if (!WHOLE_CLEAN_TAIL.test(rest)) continue;
      const listed = runRounds(run);
      if (listed.length < 2) continue;
      if (!sets) sets = wholeSets(ctx);
      const fact = sets.get(kind);
      if (!fact || fact.length <= listed.length) continue;
      if (!listed.every((n) => fact.includes(n))) continue;
      const runAt = m.index + m[0].lastIndexOf(run) - (word ? word.length : 0);
      const runEnd = m.index + m[0].lastIndexOf(run) + run.length;
      let words = listWords(fact);
      if (runAt === 0 || /[.!?]\s*$/.test(t.slice(0, runAt))) words = words[0].toUpperCase() + words.slice(1);
      return { rewrite: `${t.slice(0, runAt)}${words}${t.slice(runEnd)}` };
    }
  }
  return null;
}

/*
 * EARLIER IN THE MATCH, AS RIOT'S RECORD HAS IT (Nov 2026, the match's own
 * memory, death-chain.js and match-memory.js). The review and Ask Coach are
 * now handed what came before a death ("you died at Hookah in rounds 1 and 3
 * too"), and a reply that says it in its own words is held to the record of
 * the rounds before the one it is about:
 *
 *   "the third time you died at Hookah", "your third death at Hookah"   the
 *       deaths there before that round are exactly two
 *   "you had died at Hookah twice before"                               two
 *   "Chamber had killed you twice before", "the third time Chamber killed
 *       you"                                                            the same, by killer
 *   "you died at Hookah again", "Chamber killed you again"              one at least
 *
 * Only Riot's place counts (a whole site never: "A site" is the article trap),
 * and only a sentence whose round is known (the round line's, or the one it
 * names). A round before it the record does not place or has no killer for
 * leaves a count it could make true unjudged. A plan ("if you die at Hookah
 * again") judges nothing. A false claim drops the sentence.
 *
 * THE PLAN WORD COUNTS IN THE CLAIM'S OWN CLAUSE (Nov 2026). An if, should,
 * could, would, whenever or next time anywhere in the sentence used to let it
 * all go, so "Chamber killed you again in round 2, so you should hold a
 * different angle." kept a false again: the should is the next clause's
 * (clauseAt). Also read: "Chamber killed you for the third time", "a third
 * time", "For the third time, Chamber caught you", "you died to Chamber a
 * third time", "you died at Hookah a third time" (the deaths before exactly
 * two; never "in a row", "this half" or a side, which count other sets), and
 * "once again Chamber caught you", "caught you once again", "once again you
 * died at Hookah" (one at least).
 */
const EARLIER_ORD = { second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7, eighth: 8, '2nd': 2, '3rd': 3, '4th': 4, '5th': 5, '6th': 6, '7th': 7, '8th': 8 };
const EARLIER_ORD_ALT = 'second|third|fourth|fifth|sixth|seventh|eighth|2nd|3rd|4th|5th|6th|7th|8th';
const EARLIER_TIMES = `(once|twice|${NUM}\\s+times)`;
const EARLIER_DIED = '(?:died|were\\s+killed|got\\s+killed|fell|went\\s+down)';
const EARLIER_BEFORE = '(?:before|already|earlier(?:\\s+in\\s+the\\s+(?:match|game))?|in\\s+earlier\\s+rounds)';
// "for the third time", "a third time": its ordinal is the one group. Never
// followed by a set of its own ("in a row", "this half", "on defence").
const EARLIER_NTH = `(?:for\\s+(?:the|a)\\s+|a\\s+)(${EARLIER_ORD_ALT})\\s+time\\b(?!\\s+(?:in\\s+a\\s+row|running|straight|in\\s+succession|this\\s+(?:half|side|match|game)|in\\s+(?:this|the\\s+(?:first|second))\\s+half|on\\s+(?:defen[cs]e|attack)|since)\\b)`;
// The plan words, read in the clause that holds the claim.
const EARLIER_HYPO = /\b(?:if|next\s+time|should|would|could|whenever)\b/i;
// "Once again Chamber caught you" opens on once and is no plan.
const EARLIER_ONCE_AGAIN = /^\s*once\s+again\b/i;
const earlierCount = (w) => {
  const s = String(w || '').toLowerCase();
  if (s === 'once') return 1;
  if (s === 'twice') return 2;
  return numOf(s.replace(/\s+times$/, ''));
};
function checkEarlier(sentence, ctx, st) {
  const t = straight(sentence);
  if (!ctx || !ctx.rounds || !ctx.rounds.size || (OPENS_IF.test(t) && !EARLIER_ONCE_AGAIN.test(t))) return null;
  if (!/\b(?:again|before|already|earlier|time|death)\b/i.test(t)) return null;
  // A plan or a rule in the clause that holds the claim judges nothing.
  const plan = (m) => EARLIER_HYPO.test(clauseAt(t, m.index));
  const n = roundOfSentence(t, ctx, st);
  if (!n) return null;
  const pl = ctx.map ? placesOf(ctx.map) : null;
  const k = knowledgeOf();
  const samePlace = (a, b) => {
    const x = String(a).toLowerCase();
    const y = String(b).toLowerCase();
    if (x === y || (pl && (pl.canonOf.get(x) || x) === (pl.canonOf.get(y) || y))) return true;
    return !!(k && typeof k.samePlace === 'function' && k.samePlace(ctx.map, x, y));
  };
  // The deaths before round n by place or by killer: { at, unknown }.
  const before = (test, has) => {
    let at = 0;
    let unknown = 0;
    for (let i = 1; i < n; i++) {
      const r = ctx.rounds.get(i);
      if (!r) { unknown += 1; continue; }
      if (!r.died || r.afk) continue;
      if (!has(r)) { unknown += 1; continue; }
      if (test(r)) at += 1;
    }
    return { at, unknown };
  };
  const byPlace = (p) => before((r) => samePlace(r.place, p), (r) => !!r.place);
  const byKiller = (a) => before((r) => r.killer === a, (r) => !!r.killer);
  const wrong = (got, want, atLeast) => (atLeast ? got.at < want && !got.unknown : got.at !== want && (got.at > want || !got.unknown));
  const said = (what, got) => `your reply said what happened earlier in the match: ${what}, where Riot's record has ${got.at === 0 ? 'none' : got.at === 1 ? 'one' : got.at} before round ${n}; say what came before only as the record gives it`;
  const claims = [];
  const nth = (w) => EARLIER_ORD[String(w).toLowerCase()] - 1;
  if (pl && pl.alt) {
    const P = `(${pl.alt})(?![A-Za-z0-9])`;
    for (const m of t.matchAll(new RegExp(`\\b(?:the|your)\\s+(${EARLIER_ORD_ALT})\\s+(?:time\\s+(?:that\\s+)?you\\s+${EARLIER_DIED}|death)\\s+(?:at|in|on|near)\\s+(?:the\\s+)?${P}`, 'gi'))) {
      if (plan(m)) continue;
      claims.push({ place: m[2], want: nth(m[1]), what: `the ${m[1]} death at ${m[2]}` });
    }
    for (const m of t.matchAll(new RegExp(`\\byou\\s+(?:had\\s+)?(?:already\\s+)?(?:died|been\\s+killed|fallen|fell)\\s+(?:at|in|on|near)\\s+(?:the\\s+)?${P}\\s+${EARLIER_TIMES}\\s+${EARLIER_BEFORE}`, 'gi'))) {
      if (plan(m)) continue;
      claims.push({ place: m[1], want: earlierCount(m[2]), what: `${m[2]} at ${m[1]} before` });
    }
    // "you died at Hookah for the third time", "a third time".
    for (const m of t.matchAll(new RegExp(`\\byou\\s+${EARLIER_DIED}\\s+(?:at|in|on|near)\\s+(?:the\\s+)?${P}\\s+${EARLIER_NTH}`, 'gi'))) {
      if (plan(m)) continue;
      claims.push({ place: m[1], want: nth(m[2]), what: `the ${m[2]} death at ${m[1]}` });
    }
    for (const m of t.matchAll(new RegExp(`\\byou\\s+${EARLIER_DIED}\\s+(?:at|in|on|near)\\s+(?:the\\s+)?${P}\\s+(?:once\\s+)?again\\b|\\bagain\\s+at\\s+(?:the\\s+)?${P}|\\bonce\\s+again,?\\s+you\\s+${EARLIER_DIED}\\s+(?:at|in|on|near)\\s+(?:the\\s+)?${P}`, 'gi'))) {
      const p = m[1] || m[2] || m[3];
      if (/\bagain\s+at\b/i.test(m[0]) && !DEATH_SAID.test(t)) continue;
      if (plan(m)) continue;
      claims.push({ place: p, want: 1, atLeast: true, what: `a death at ${p} again` });
    }
  }
  const A = `(${AGENT_ALT})(?![A-Za-z0-9])`;
  const KILLED = '(?:killed|got|caught)';
  for (const m of t.matchAll(new RegExp(`(?<![A-Za-z0-9])${A}\\s+(?:had\\s+)?(?:already\\s+)?${KILLED}\\s+you\\s+${EARLIER_TIMES}\\s+${EARLIER_BEFORE}`, 'gi'))) {
    if (plan(m)) continue;
    claims.push({ agent: canon(m[1]), want: earlierCount(m[2]), what: `${m[1]} killing you ${m[2]} before` });
  }
  for (const m of t.matchAll(new RegExp(`\\bthe\\s+(${EARLIER_ORD_ALT})\\s+time\\s+(?:(?:that\\s+)?(?<![A-Za-z0-9])${A}\\s+${KILLED}\\s+you|you\\s+${EARLIER_DIED}\\s+to\\s+${A})`, 'gi'))) {
    if (plan(m)) continue;
    const a = m[2] || m[3];
    claims.push({ agent: canon(a), want: nth(m[1]), what: `the ${m[1]} time ${a} killed you` });
  }
  // "Chamber killed you for the third time", "a third time", "you died to Chamber a third time".
  for (const m of t.matchAll(new RegExp(`(?<![A-Za-z0-9])${A}\\s+${KILLED}\\s+you\\s+${EARLIER_NTH}|\\byou\\s+${EARLIER_DIED}\\s+to\\s+${A}\\s+${EARLIER_NTH}`, 'gi'))) {
    if (plan(m)) continue;
    const a = m[1] || m[3];
    const w = m[2] || m[4];
    claims.push({ agent: canon(a), want: nth(w), what: `the ${w} time ${a} killed you` });
  }
  // "For the third time, Chamber caught you".
  for (const m of t.matchAll(new RegExp(`\\bfor\\s+(?:the|a)\\s+(${EARLIER_ORD_ALT})\\s+time,?\\s+${A}\\s+${KILLED}\\s+you\\b`, 'gi'))) {
    if (plan(m)) continue;
    claims.push({ agent: canon(m[2]), want: nth(m[1]), what: `the ${m[1]} time ${m[2]} killed you` });
  }
  // "Chamber killed you again", "caught you once again", "Chamber again caught you", "once again Chamber caught you".
  for (const m of t.matchAll(new RegExp(`(?<![A-Za-z0-9])${A}\\s+${KILLED}\\s+you\\s+(?:once\\s+)?again\\b|(?<![A-Za-z0-9])${A}\\s+(?:once\\s+)?again\\s+${KILLED}\\s+you\\b|\\bonce\\s+again,?\\s+${A}\\s+${KILLED}\\s+you\\b`, 'gi'))) {
    if (plan(m)) continue;
    const a = m[1] || m[2] || m[3];
    claims.push({ agent: canon(a), want: 1, atLeast: true, what: `${a} killing you again` });
  }
  for (const c of claims) {
    if (c.place !== undefined) {
      if (articleNotSite(c.place) || /^[abc] site$/i.test(c.place) || c.want == null) continue;
      const got = byPlace(c.place);
      if (wrong(got, c.want, c.atLeast)) return said(c.what, got);
    } else if (c.agent && c.want != null) {
      const got = byKiller(c.agent);
      if (wrong(got, c.want, c.atLeast)) return said(c.what, got);
    }
  }
  return null;
}

const READERS = [
  ['kills', checkKills],
  ['share', checkKillerShare],
  ['order', checkOrder],
  ['blame', checkTeamBlame],
  ['drill', checkDrill],
  ['record', checkRecord],
  // The blind audit of round 8, stream C: the death put at another callout than Riot's, kept in Riot's.
  ['place', checkDeathPlace],
  // The blind audit of round 8, stream C: kills against deaths the scoreline makes false.
  ['kd', checkKillsDeaths],
  // The blind audit of round 8, stream C: a count and the rounds it lists.
  ['countlist', checkCountList],
  // The stream C review's open gap: a list with no count told as the whole set of its kind.
  ['wholelist', checkWholeList],
  // Round 8: alone or out of reach said of a death with a teammate close, and "nobody could trade you" said of the fact.
  ['alone', checkAlone],
  // The blind audit of 8.7.9, after every reader before.
  ['postplant', checkPostPlant],
  ['clock', checkClock],
  ['score', checkScore],
  // The blind audit of round 6: claims over several rounds, a cheap death, the last round.
  ['multi', checkMulti],
  ['lowcost', checkLowCost],
  ['ordinal', checkOrdinal],
  // Round 8: "the clearest one was round N" against the cost ranking.
  ['clearest', checkClearest],
  // Round 8, the timeline and the state (the blind audit of round 7).
  ['plantphase', checkPlantPhase],
  ['enemyrole', checkEnemyRole],
  ['first', checkFirst],
  ['leftwords', checkLeftWords],
  ['later', checkLater],
  ['killplace', checkKillPlace],
  // The match's own memory (Nov 2026): what a reply says came earlier in the match, held to the rounds before.
  ['earlier', checkEarlier],
];
const REVIEW_READERS = [...READERS, ['side', checkSide], ['result', checkResult]];

/**
 * One sentence through every reader: { kind, reason }, { kind, rewrite } or
 * null. st: { agents, round, ... } from the sentences before. A reader may
 * answer { rewrite } (checkAlone, round 8): the sentence said Riot's fact as
 * a capability and is kept in the record's words, read on by every reader
 * after it in those words, and dropped still where one of them finds it false.
 */
function checkSentence(sentence, ctx, st) {
  const readers = ctx && ctx.kind === 'review' ? REVIEW_READERS : READERS;
  let text = sentence;
  let rewrite = null;
  for (const [kind, read] of readers) {
    let why = null;
    try { why = read(text, ctx, st || {}); } catch { why = null; }
    if (!why) continue;
    if (typeof why === 'object') {
      if (typeof why.rewrite === 'string' && why.rewrite && why.rewrite !== text) { text = why.rewrite; rewrite = { kind, rewrite: why.rewrite }; }
      else if (why.reason) return { kind, reason: why.reason };
      continue;
    }
    return { kind, reason: why };
  }
  return rewrite;
}

/**
 * Rows { s, dropped, p } in reading order through every reader, the agents
 * and the round the kept sentences before named carried along (a paragraph's
 * round, where its kept sentences so far named exactly one; opts.round fixes
 * it, a review's round line). Round 8 carries more: the reply's last list of
 * two or more rounds, an agent's deaths a sentence counted ("Omen killed you
 * six times"), the claim of the kept sentence before (within two, in its
 * paragraph), whether the one right before said the player was alone, the
 * reply's only round so far, and the last two kept sentences. Returns
 * [{ index, kind, reason }] for a drop and [{ index, kind, rewrite }] for a
 * sentence kept in other words.
 */
function checkRows(rows, ctx, opts = {}) {
  const out = [];
  const agents = [];
  let para = null;
  let paraRounds = new Set();
  // The list the sentence right before named (checkMulti's "those six"),
  // only while that sentence was kept and stood right before this one.
  let lastSet = null;
  let lastIndex = -2;
  let replyList = null;
  let agentSet = null;
  let prevKinds = null;
  let prevKindsAt = -9;
  let aloneAt = -9;
  const replyRounds = new Set();
  const recent = [];
  let kept = 0;
  (Array.isArray(rows) ? rows : []).forEach((x, index) => {
    let s = String(x && typeof x === 'object' ? x.s : x || '');
    const p = x && typeof x === 'object' ? x.p : null;
    if (p !== para) { para = p; paraRounds = new Set(); prevKinds = null; }
    if (x && x.dropped) return;
    const st = {
      agents,
      round: opts.round || (paraRounds.size === 1 ? [...paraRounds][0] : null),
      lastSet: lastIndex === index - 1 ? lastSet : null,
      replyList,
      agentSet,
      prevKinds: prevKinds && kept - prevKindsAt < 2 ? prevKinds : null,
      prevAlone: aloneAt === index - 1,
      replyRound: opts.round || (replyRounds.size === 1 ? [...replyRounds][0] : null),
      recent: recent.slice(-2),
    };
    const hit = checkSentence(s, ctx, st);
    if (hit && hit.reason) { out.push({ index, ...hit }); return; }
    if (hit && hit.rewrite) { out.push({ index, ...hit }); s = hit.rewrite; }
    const t = straight(s);
    kept += 1;
    for (const m of t.matchAll(AGENT_RE)) { const a = canon(m[1]); if (a) agents.push(a); }
    const named = roundsIn(t);
    for (const n of named) { paraRounds.add(n); replyRounds.add(n); }
    lastSet = named.length >= 2 ? named : null;
    if (named.length >= 2) replyList = named;
    const ak = ctx && ctx.rounds ? agentKillSet(t, ctx) : null;
    if (ak) agentSet = ak;
    const ks = kindsOf(claimPart(t));
    if (ks.length) { prevKinds = ks; prevKindsAt = kept; }
    if (ALONE_SAID.test(t.replace(new RegExp(NOT_ALONE.source, 'gi'), ' '))) aloneAt = index;
    recent.push(t);
    lastIndex = index;
  });
  return out;
}

module.exports = {
  // The blind audit of round 6.
  checkMulti, checkLowCost, checkOrdinal, MULTI_CLAIMS, FIRST_CONTACT, MULTI_HYPO, QUANT, LIST_ALL, LIST_QUANT, SOFT_QUANT, ALL_DEATHS, MOST_DEATHS, LOW_COST, LOW_BUY, ORDINAL_SAID, wholeMatch, SUBSET_AFTER, WHOLE_AFTER,
  contextOfChat, contextOfReview, beforePlantRounds, deadBeforePlant, aliveAtPlant, plantRecord, plantLines, roundsIn,
  checkKills, checkKillerShare, checkOrder, checkSide, checkResult, checkTeamBlame, checkDrill, checkSentence, checkRows,
  BEAT, MOST_OF, EARLY_SAID, BEFORE_SITE, DIED_BEFORE_PLANT, DIED_AFTER_PLANT, SAYS_ATTACK, SAYS_DEFENCE, SAYS_RESULT,
  PLANT_TALK, DEF_TALK, ATK_TALK, BLAME, ALIVE_SAID, ADVICE_OPEN, DEATHMATCH, RANGE, MODE_AVOIDED, TAKE_AGENT, BEFORE_ANY_PLANT, ROUND_RUN, OPENS_IF,
  RANGE_AGAINST, PLANT_MIN, CLAUSE_BREAK, clauseAt,
  checkRecord, placesOf, articleNotSite, placeMatch, OTHER_HALF, MATE_COULD_SAID, SWING_ALONE, HELD_ALONE, DEATH_AT_HEAD, HYPO, ENEMY_SUBJECT, BUY_CLAIM, BUY_ALLOWED, MATE_CLOSE_SAID, MATE_FAR_SAID, NO_ABILITY_ROUND,
  // The blind audit of 8.7.9.
  costRank, costLine, COST, COST_TOP, checkPostPlant, checkClock, checkScore, AFTER_PLANT_ADVICE, BEFORE_PLANT_SAID, ON_CLOCK, PHASE_DOWN, SCORE_SAID, PRE_PLANT,
  // Round 8: counts over several rounds, alone said of a teammate close, the ledger.
  FAR_SAID, COULDNT_SAID, UNTRADED_SAID, CLOSE_SAID, kindsOf, judgeAll, together, quantOf, resolveSet, TIMES_Q, LAST_ALIVE_APART, PER_ROUND, SHARE, POINTER, ADVICE_CUT, claimPart,
  AGENT_KILLS, agentKillSet, killsBy, checkAlone, ALONE_SAID, COULD_TRADE, NOT_ALONE, PLAN_OPEN, PRESUPPOSED, CAPABILITY, PREDICTION, ALONE_PAST, ANAPHOR,
  checkClearest, CLEAREST, COST_MOST, COST_TALK, feedTimes,
  // Round 8, the timeline and the state.
  checkPlantPhase, checkEnemyRole, checkFirst, checkLeftWords, checkLater, checkKillPlace, claimRounds,
  // The blind audit of round 8, stream C.
  checkDeathPlace, PLACE_PREP, PLACE_GAP_BREAK, DEATH_SAID, YOU_HEAD,
  checkKillsDeaths, DEATHS_MORE, KILLS_MORE, KD_NEG, KD_CUT,
  checkCountList, COUNT_HEAD, LIST_AFTER, LIST_SOME, COUNT_DEATH_BEFORE, COUNT_NEW_CLAUSE, runRounds,
  // The match's own memory (Nov 2026).
  checkEarlier, EARLIER_ORD, EARLIER_TIMES,
  // Its review: who stands at the place, the scoreline's subject, the list's own words.
  PLACE_VERB, YOU_OBJECT, PLACE_EARLIER, PLACE_LATER, DEATH_PLACE_HEAD, DEATH_GAP_BREAK, KD_OTHER, KD_SCOPE, LIST_BEFORE, LIST_NOT_BEFORE, countKinds, foldRounds,
  // The stream C review's open gap: a list with no count, told as the whole set.
  checkWholeList, wholeSets, WHOLE_LIST, WHOLE_ROUNDS, WHOLE_EVERY, WHOLE_REVERSED, WHOLE_CLEAN_TAIL, WHOLE_NOT_BEFORE, WHOLE_PART_BEFORE, WHOLE_PART_AFTER, FIRST_LINE,
  PLANT_DURING, ENEMY_ROLE_OBJ, ENEMY_ROLE_SUBJ, FIRST_SAID, LEFT_HEAD, LEFT_N, LEFT_DOWN, LATER, PLANT_EVENT, KILL_EVENT, DEATH_THEN, KILL_OWNER_BEFORE, earlyDeathsOf, ledgerBins, ledgerLine, tradeLedger, LEDGER_HEAD, LEDGER_RULE, lastAliveOf,
};
