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
 *   checkRows        all of them over a reply's sentences in reading order,
 *                    a he or a she read as the agent the sentences before
 *                    named, a sentence of no round as the round its
 *                    paragraph is about.
 *
 * English words: the callers pass English text only. Every regex here was
 * written with a file editing tool and is asserted in test:chatgates on a
 * sentence of the audit (caught) and a true variant (kept). No require from
 * src/ (check:server), and nothing but the game data and coherence.js.
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
    afterPlant: x.afterPlant === true ? true : null,
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
  };
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
      rounds.set(r.n, row({ ...r, victims, spot: r.spot || null }));
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
    // The rounds the match went to, from its final score (checkOrdinal, wholeMatch).
    total: Array.isArray(f.finalScore) && f.finalScore.every(fin) ? f.finalScore[0] + f.finalScore[1] : null,
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
    // The rounds the match went to, from its final score (checkOrdinal, wholeMatch).
    total: inp.final && fin(inp.final.team) && fin(inp.final.enemy) ? inp.final.team + inp.final.enemy : null,
  };
}

/** Whether the player was certainly dead before the spike went down, in a round with a plant. */
function deadBeforePlant(r, ctx) {
  if (!r || !r.planted || !r.died || r.afterPlant) return false;
  if (fin(r.sec) && fin(r.plantSec)) return r.sec < r.plantSec;
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
    else if (untraded) words.push('nobody traded it');
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
  for (const c of (g && Array.isArray(g.callouts) ? g.callouts : [])) {
    const side = SITE_SIDES.has(String((c && c.s) || '').toLowerCase()) ? String(c.s).toLowerCase() : null;
    for (const n of [c && c.n, c && c.a]) if (typeof n === 'string' && n) names.set(n.toLowerCase(), side);
    if (side) names.set(`${side} site`, side);
  }
  const list = [...names.keys()].sort((a, b) => b.length - a.length);
  const out = { sideOf: names, alt: list.length ? list.map(esc).join('|') : null };
  PLACES_OF.set(key, out);
  return out;
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
      const m = new RegExp(`${DEATH_AT_HEAD}(${pl.alt})(?![A-Za-z0-9])`, 'i').exec(t);
      const said = m ? pl.sideOf.get(m[1].toLowerCase()) : null;
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
// What each round of the set must have been for the claim, and what makes it certainly not.
const MULTI_CLAIMS = [
  // Nobody near: a distance, and a traded death had someone near enough.
  ['alone', /\bon\s+your\s+own\b|\bby\s+yourself\b|\b(?:you\s+were|while\s+you\s+were|while)\s+(?:all\s+)?alone\b|\bisolated\b|\b(?:with\s+)?(?:no\s+teammate|nobody|no\s+one|none\s+of\s+your\s+teammates)\s+(?:(?:was|were|stood)\s+)?(?:close(?:\s+by)?|near(?:by)?|anywhere\s+near)\b(?!\s+enough)|\byour\s+teammates?\s+(?:was|were)\s+(?:all\s+)?(?:too\s+)?far\b/i,
    (r) => (r.mate === 'close' || r.traded === true ? 'no' : r.mate === 'far' ? 'yes' : null)],
  // "Nobody close enough to kill her back" is the trade, judged by a trade only.
  ['answer', /\b(?:no\s+teammate|nobody|no\s+one)\s+(?:(?:was|were|stood)\s+)?close\s+enough\s+to\s+(?:answer|trade|kill|swing|punish|shoot|help|refrag)\b/i,
    (r) => (r.traded === true ? 'no' : r.traded === false ? 'yes' : null)],
  ['close', /\b(?:(?:a|your|one)\s+teammates?\s+(?:was|were|stood|had\s+been)\s+(?:right\s+)?(?:close(?:\s+by)?|near(?:by)?|next\s+to\s+you|beside\s+you)|with\s+a\s+teammate\s+(?:right\s+)?(?:close(?:\s+by)?|near(?:by)?|next\s+to\s+you|beside\s+you))\b(?!\s+enough)/i,
    (r) => (r.mate === 'far' && r.traded !== true ? 'no' : r.mate === 'close' || r.traded === true ? 'yes' : null)],
  // Early: certainly not after the plant, nor a minute in; the first 30 seconds not past 30.
  ['early', /\b(?:you\s+died|died|deaths?\s+came|you\s+went\s+down|you\s+fell)\s+(?:very\s+|too\s+)?early\b|\bearly\s+deaths?\b|\bin\s+the\s+first\s+(?:30|thirty)\s+seconds\b/i,
    (r, t) => {
      if (!r.died) return null;
      const after = r.afterPlant === true || (fin(r.sec) && fin(r.plantSec) && r.sec >= r.plantSec);
      const limit = /\bfirst\s+(?:30|thirty)\s+seconds\b/i.test(t) ? 30 : 60;
      if (after || (fin(r.sec) && r.sec > limit)) return 'no';
      return fin(r.sec) ? 'yes' : null;
    }],
  ['untraded', /\b(?:went\s+)?(?:untraded|unanswered)\b|\b(?:nobody|no\s+one|no\s+teammate)\s+(?:ever\s+)?traded\b|\bwithout\s+(?:a\s+)?trade\b/i,
    (r) => (r.traded === true ? 'no' : r.traded === false ? 'yes' : null)],
  ['traded', /\b(?:were|was|got|been)\s+traded\b|\ba\s+teammate\s+traded\b|\bthe\s+trade\s+came\b/i,
    (r) => (r.traded === false ? 'no' : r.traded === true ? 'yes' : null)],
];
// "Five of those six", "all four of your deaths", "none of them", "most of your deaths", "only one of the five".
const QUANT = new RegExp(`\\b(only\\s+|just\\s+)?(${NUM}|all|both|none|most|each|every\\s+one|neither)(?:\\s+(${NUM}))?\\s+of\\s+(?:(those|these|them|the|your)\\s+)?(?:(${NUM})\\s+)?(deaths|rounds|times|fights|duels|ones|kills|early\\s+deaths)?`, 'i');
// "rounds 2, 10 and 12 all came", "all four came", "both came": a list's own all.
const LIST_ALL = new RegExp(`\\b(?:all|both|each)(?:\\s+(?:${NUM}))?\\s+(?:of\\s+them\\s+)?(?:came|were|happened|went|died|had|ended|started)\\b`, 'i');
const SOFT_QUANT = /\b(?:often|sometimes|usually|mostly|several|some|a\s+few|many|a\s+lot\s+of|twice|mainly|largely|typically|regularly|repeatedly|at\s+times|more\s+than\s+once)\b/i;
const LIST_QUANT = new RegExp(`\\b(only\\s+|just\\s+)?(${NUM}|none|most|neither)\\s+of\\s+(?:them|those|these)\\b`, 'i');
// Every death of the match: "every time you died", "each of your deaths", "all your deaths".
const ALL_DEATHS = /\b(?:every|each)\s+time\s+you\s+died\b|\b(?:every|each)\s+(?:one\s+of\s+your\s+|of\s+your\s+)?deaths?\b|\ball\s+(?:of\s+)?your\s+deaths\b|\bwhenever\s+you\s+died\b/i;
const MOST_DEATHS = /\b(?:most|the\s+majority|nearly\s+all|almost\s+all)\s+of\s+your\s+deaths\b/i;
/** The rounds the record has, 1 to the last, none missing: the only ledger "your deaths" can be counted over. */
function wholeMatch(ctx) {
  const ns = [...ctx.rounds.keys()].sort((a, b) => a - b);
  return ns.length > 0 && ns[0] === 1 && ns[ns.length - 1] === ns.length && (!fin(ctx.total) || ctx.total === ns.length);
}
const deathsOf = (ctx) => [...ctx.rounds.values()].filter((r) => r.died).map((r) => r.n);
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
function checkMulti(sentence, ctx, st) {
  const t = straight(sentence);
  if (!ctx || !ctx.rounds.size || OPENS_IF.test(t) || MULTI_HYPO.test(t)) return null;
  for (const [kind, re, judge] of MULTI_CLAIMS) {
    const m = re.exec(t);
    if (!m) continue;
    // The enemy's (their deaths) and a plan judge nothing.
    const clause = clauseAt(t, m.index);
    if (/\b(?:they|their|enemy|enemies|opponents?)\s+(?:died|deaths?)\b/i.test(clause)) continue;
    const runs = [...t.matchAll(ROUND_RUN)];
    let set = null;
    let want = null;   // { n } a count, 'all', 'none', 'most'
    let only = false;
    // "Often when you were alone" claims some of them, which no count can make false.
    if (SOFT_QUANT.test(clause)) continue;
    const own = roundsIn(clause);
    // The quantifier of the claim's own clause only: "13 of your 14 deaths
    // went unanswered, and you died in the first 30 seconds 8 times" counts
    // no early death 13 times (the sweep over 8.7.7).
    const q = QUANT.exec(clause);
    if (q) {
      only = !!q[1];
      const w = q[2].toLowerCase().replace(/\s+/g, ' ');
      const of = numOf(q[5]) || numOf(q[3]);
      want = w === 'all' || w === 'both' || w === 'each' || w === 'every one' ? 'all' : w === 'none' || w === 'neither' ? 'none' : w === 'most' ? 'most' : { n: numOf(w) };
      const det = (q[4] || '').toLowerCase();
      if (det === 'those' || det === 'these' || det === 'them') {
        // The list of this sentence before the words, else the sentence before's.
        const before = roundsIn(t.slice(0, q.index));
        set = before.length >= 2 ? before : st && Array.isArray(st.lastSet) ? st.lastSet : null;
      } else if ((det === 'your' || det === 'the') && /^deaths$/i.test(q[6] || '')) {
        // Every death of the match: "5 of your last 6 matches" and "your early deaths" are none of it, nor "your deaths to Killjoy" (restricted).
        set = wholeMatch(ctx) && !restricted(clause.slice(q.index + q[0].length)) ? deathsOf(ctx) : null;
      } else if (own.length >= 2) set = own;
      // "Five of those six" of a list of five is no list of the sentence's.
      if (set && of && set.length !== of) set = null;
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
      if (list.length < 2) continue;
      set = list;
      const lq = LIST_QUANT.exec(t);
      if (lq) {
        only = !!lq[1];
        const w = lq[2].toLowerCase();
        want = w === 'none' || w === 'neither' ? 'none' : w === 'most' ? 'most' : { n: numOf(w) };
      } else want = 'all';
    }
    if (!set || set.length < 2 || !want) continue;
    const rows = set.map((n) => ctx.rounds.get(n)).filter(Boolean);
    if (rows.length !== set.length) continue;
    let yes = 0;
    let no = 0;
    let unknown = 0;
    for (const r of rows) {
      const v = judge(r, t);
      if (v === 'yes') yes += 1;
      else if (v === 'no') no += 1;
      else unknown += 1;
    }
    const possible = yes + unknown;
    let wrong = false;
    if (want === 'all') wrong = no > 0;
    else if (want === 'none') wrong = yes > 0;
    else if (want === 'most') wrong = possible * 2 <= rows.length;
    else if (want && want.n != null) wrong = possible < want.n || (only && yes > want.n);
    if (wrong) {
      const said = want === 'all' ? 'all' : want === 'none' ? 'none' : want === 'most' ? 'most' : `${want.n}`;
      const fact = { alone: 'nobody close', answer: 'nobody close enough to trade', close: 'a teammate close', early: 'an early death', untraded: 'untraded', traded: 'traded' }[kind];
      return `your reply said ${said} of rounds ${set.join(', ')} had ${fact}, where Riot's record allows it in ${possible} of those ${rows.length}; say each round as the record has it, or leave the count out`;
    }
  }
  return null;
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

const READERS = [
  ['kills', checkKills],
  ['share', checkKillerShare],
  ['order', checkOrder],
  ['blame', checkTeamBlame],
  ['drill', checkDrill],
  ['record', checkRecord],
  // The blind audit of 8.7.9, after every reader before.
  ['postplant', checkPostPlant],
  ['clock', checkClock],
  ['score', checkScore],
  // The blind audit of round 6: claims over several rounds, a cheap death, the last round.
  ['multi', checkMulti],
  ['lowcost', checkLowCost],
  ['ordinal', checkOrdinal],
];
const REVIEW_READERS = [...READERS, ['side', checkSide], ['result', checkResult]];

/** One sentence through every reader: { kind, reason } or null. st: { agents, round } from the sentences before. */
function checkSentence(sentence, ctx, st) {
  const readers = ctx && ctx.kind === 'review' ? REVIEW_READERS : READERS;
  for (const [kind, read] of readers) {
    let why = null;
    try { why = read(sentence, ctx, st || {}); } catch { why = null; }
    if (why) return { kind, reason: why };
  }
  return null;
}

/**
 * Rows { s, dropped, p } in reading order through every reader, the agents
 * and the round the kept sentences before named carried along (a paragraph's
 * round, where its kept sentences so far named exactly one; opts.round fixes
 * it, a review's round line). Returns [{ index, kind, reason }].
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
  (Array.isArray(rows) ? rows : []).forEach((x, index) => {
    const s = String(x && typeof x === 'object' ? x.s : x || '');
    const p = x && typeof x === 'object' ? x.p : null;
    if (p !== para) { para = p; paraRounds = new Set(); }
    if (x && x.dropped) return;
    const st = { agents, round: opts.round || (paraRounds.size === 1 ? [...paraRounds][0] : null), lastSet: lastIndex === index - 1 ? lastSet : null };
    const hit = checkSentence(s, ctx, st);
    if (hit) { out.push({ index, ...hit }); return; }
    for (const m of straight(s).matchAll(AGENT_RE)) { const a = canon(m[1]); if (a) agents.push(a); }
    const named = roundsIn(straight(s));
    for (const n of named) paraRounds.add(n);
    lastSet = named.length >= 2 ? named : null;
    lastIndex = index;
  });
  return out;
}

module.exports = {
  // The blind audit of round 6.
  checkMulti, checkLowCost, checkOrdinal, MULTI_CLAIMS, MULTI_HYPO, QUANT, LIST_ALL, LIST_QUANT, SOFT_QUANT, ALL_DEATHS, MOST_DEATHS, LOW_COST, LOW_BUY, ORDINAL_SAID, wholeMatch, SUBSET_AFTER, WHOLE_AFTER,
  contextOfChat, contextOfReview, beforePlantRounds, deadBeforePlant, aliveAtPlant, plantRecord, plantLines, roundsIn,
  checkKills, checkKillerShare, checkOrder, checkSide, checkResult, checkTeamBlame, checkDrill, checkSentence, checkRows,
  BEAT, MOST_OF, EARLY_SAID, BEFORE_SITE, DIED_BEFORE_PLANT, DIED_AFTER_PLANT, SAYS_ATTACK, SAYS_DEFENCE, SAYS_RESULT,
  PLANT_TALK, DEF_TALK, ATK_TALK, BLAME, ALIVE_SAID, ADVICE_OPEN, DEATHMATCH, RANGE, MODE_AVOIDED, TAKE_AGENT, BEFORE_ANY_PLANT, ROUND_RUN, OPENS_IF,
  RANGE_AGAINST, PLANT_MIN, CLAUSE_BREAK, clauseAt,
  checkRecord, placesOf, DEATH_AT_HEAD, HYPO, ENEMY_SUBJECT, BUY_CLAIM, BUY_ALLOWED, MATE_CLOSE_SAID, MATE_FAR_SAID, NO_ABILITY_ROUND,
  // The blind audit of 8.7.9.
  costRank, costLine, COST, COST_TOP, checkPostPlant, checkClock, checkScore, AFTER_PLANT_ADVICE, BEFORE_PLANT_SAID, ON_CLOCK, PHASE_DOWN, SCORE_SAID, PRE_PLANT,
};
