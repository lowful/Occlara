'use strict';

/**
 * WORKED CASES (8.8): a situation, the signal that shows it, the decision a
 * high level coach makes there, why, and the mistake to avoid, kept in
 * server/data/cases.json and given to the review and to Ask Coach beside the
 * playbook's notes. A note is a habit; a case is one decision worked through,
 * which is what the model reasons from when the player's own round looks
 * like it.
 *
 * Where they came from is never said, as for the notes: a case holds
 * source.kind and source.topic, never who (check:cases, check:attribution).
 *
 * A CASE IS SERVED ONLY WHEN THE PLAYER'S SITUATION MATCHES IT, never as
 * filler: a real situational match (situational(), below: who the player is
 * and what happened to them, never one anchor alone) and a score of
 * MIN_SCORE. A review or a question with no match gets no block, and its
 * prompt is today's byte for byte.
 *
 * The same filters as the notes, so a case never reaches a player a note
 * would not:
 *   - an agent, role or map case is excluded for another agent, role or map,
 *     a side case for a player who never played that side;
 *   - enemyAgents (knowledge.js enemyFit): eligible only when one of them was
 *     on the enemy team, never served blind; enemyWithout needs the whole comp;
 *   - the rank band exactly as notes (knowledge.js rankAdjust): above the
 *     band excluded, below the band only when the player's data shows the
 *     fundamental missing (a cause or a pattern the case answers);
 *   - Advanced coaching off leaves out the advanced ones (lowest band
 *     Platinum or above), as study() does.
 * At most MAX_CASES, best first, never two teaching the same thing, near ties
 * turned by the match's seed (VARIETY) and then by id, so the same match gets
 * the same cases every time and another match may get others.
 *
 * Run: npm run check:cases (the file), npm run test:advancedtips (retrieval).
 */

const fs = require('fs');
const path = require('path');
const knowledge = require('./knowledge');

const MAX_CASES = 2;
const MIN_SCORE = 6;
// Economy words a review or a question can actually show: from the round
// number, and since 8.8 'eco' from Riot's record of the team's buy, which
// only a death on one adds (match-review.js caseSituation, chat-prompt.js
// casesFor). Not 'full', the background of most cases, nor 'bonus'.
const ECONOMIES_SEEN = new Set(['pistol', 'antieco', 'lostpistol', 'eco']);

let CASES = [];
try {
  const p = path.join(__dirname, '..', 'data', 'cases.json');
  if (fs.existsSync(p)) {
    const parsed = JSON.parse(fs.readFileSync(p, 'utf8'));
    if (Array.isArray(parsed)) {
      CASES = parsed.filter((c) => c && typeof c.id === 'string' && c.situation && typeof c.situation === 'object'
        && ['signal', 'decision', 'why', 'mistakeToAvoid'].every((k) => typeof c[k] === 'string' && c[k]));
    }
    console.log('[cases] merged', CASES.length, 'worked cases from data/cases.json');
  }
} catch (e) {
  console.error('[cases] cases.json ignored:', e.message);
}

const lower = (x) => String(x || '').toLowerCase();
const ISOLATION = knowledge.ISOLATION_LESSON || null;
const setOf = (xs) => new Set([].concat(xs || []).filter((x) => typeof x === 'string' && x).map(lower));

/**
 * The player's situation, bounded: { agent, map, sides, phases, economies,
 * causes, patterns, enemies, rankBand, advanced }. Lists or Sets of strings.
 */
function situation(x) {
  const s = x || {};
  const agent = typeof s.agent === 'string' && s.agent ? s.agent : null;
  return {
    agent,
    role: agent ? knowledge.roleOf(agent) : null,
    map: typeof s.map === 'string' && s.map ? lower(s.map) : null,
    sides: setOf(s.sides && [...s.sides]),
    phases: setOf(s.phases && [...s.phases]),
    economies: setOf(s.economies && [...s.economies]),
    causes: setOf(s.causes && [...s.causes]),
    patterns: setOf(s.patterns && [...s.patterns]),
    enemies: knowledge.enemiesOf(s.enemies && [...s.enemies]),
    rankBand: knowledge.validBand(s.rankBand),
    advanced: s.advanced === true,
    seed: typeof s.seed === 'string' && s.seed ? s.seed.slice(0, 200) : null,
    // Causes Riot's record rules out (round 8, knowledge.js recordSignals): 'isolated' for a teammate close.
    ruledOut: setOf(s.ruledOut && [...s.ruledOut]),
  };
}

/*
 * A REAL SITUATIONAL MATCH (8.8, after the first measure: every one of 20
 * reviews and 100 questions got a block, almost always the same two cases,
 * because an agent or a phase alone reached MIN_SCORE). A case is served when
 * it matches WHO the player is AND WHAT happened to them:
 *   - a case for an agent or a role (the filters already hold it to the
 *     player's): one of a phase their deaths happened in, a cause of their
 *     deaths, an economy round they died in, an enemy agent it names, or a
 *     pattern of the match (a phase that repeated, counted);
 *   - a case for any agent has no who to match, so it needs two different
 *     kinds of what, and not the clock twice: two of a cause, a pattern, an
 *     enemy agent, an economy round and a phase.
 * An agent alone, a phase alone or a cause alone serves nothing, and a case
 * for any agent tagged only with a phase is held back (check:cases lists
 * them): every review has deaths early and mid round.
 */
function situational(h) {
  if (h.agentHit || h.roleHit) return h.phaseHit || h.causeHit || h.econHit || h.enemyHit || h.patternHit;
  return [h.causeHit, h.patternHit, h.enemyHit, h.econHit, h.phaseHit].filter(Boolean).length >= 2;
}

/*
 * THE MATCH'S VARIETY. The same context always drew the same pair, ties by
 * id, so a player read the same two cases review after review. With a seed
 * (the match: Ask Coach's match id, the review's own rounds) each eligible
 * case gets up to VARIETY more, from a hash of the seed and its id: stable
 * within one match, a different near tie in another. No seed, no change.
 */
const VARIETY = 2;
function unit(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h / 0x100000000;
}

/*
 * THE PHASES OF A WHOLE MATCH. Every phase any death happened in made every
 * phase case eligible: seven deaths in a swiftplay covered early, mid,
 * execute, post plant and retake. Over a whole match a phase counts only
 * where the deaths gather, at least PHASE_MIN of them and a third of all.
 * One asked round (Ask Coach) keeps its own phase, which is exact.
 */
const PHASE_MIN = 2;
function concentrated(perPhase, deaths) {
  return [...perPhase].filter(([, n]) => n >= PHASE_MIN && n * 3 >= deaths).map(([p]) => p);
}

/** What a case teaches: its causes, its patterns and its phase. */
function lessonsOf(c) {
  const at = c.situation || {};
  return [
    ...(Array.isArray(c.cause) ? c.cause.map((k) => `cause:${k}`) : []),
    ...(Array.isArray(c.patterns) ? c.patterns.map((k) => `pattern:${k}`) : []),
    ...(at.phase ? [`phase:${at.phase}`] : []),
  ];
}

/** Each eligible case with its score, best first: [{ c, score }]. */
function scored(x, pool) {
  const s = situation(x);
  const out = [];
  for (const c of pool || CASES) {
    const at = c.situation || {};
    if (c.tier === 'advanced' && !s.advanced) continue;
    if (at.agent && (!s.agent || lower(at.agent) !== lower(s.agent))) continue;
    if (at.role && (!s.role || at.role !== s.role)) continue;
    if (at.map && (!s.map || lower(at.map) !== s.map)) continue;
    if (at.side && !s.sides.has(at.side)) continue;
    // Never a case that sends the player through mid on a map with none (knowledge.js reliesOnMid).
    if (typeof knowledge.reliesOnMid === 'function'
      && [c.signal, c.decision, c.why, c.mistakeToAvoid].some((t) => knowledge.reliesOnMid(t, s.map))) continue;
    // A cause the record rules out, by its tag or by its words (round 8):
    // "Rushing the isolated Chamber alone" for a death with a teammate close.
    if (s.ruledOut.size && Array.isArray(c.cause) && c.cause.some((k) => s.ruledOut.has(k))) continue;
    if (s.ruledOut.has('isolated') && ISOLATION && ISOLATION.test(`${c.signal || ''} ${c.decision || ''} ${c.mistakeToAvoid || ''} ${c.why || ''}`)) continue;
    const versus = knowledge.enemyFit({ enemyAgents: at.enemyAgents, enemyWithout: at.enemyWithout }, s.enemies);
    if (versus === null) continue;
    const causeHit = Array.isArray(c.cause) && c.cause.some((k) => s.causes.has(k));
    const patternHit = Array.isArray(c.patterns) && c.patterns.some((k) => s.patterns.has(k));
    const ranked = s.rankBand ? knowledge.rankAdjust(c, s.rankBand, causeHit || patternHit) : 0;
    if (ranked === null) continue;
    const agentHit = !!at.agent;
    const roleHit = !!at.role;
    const enemyHit = versus > 0;
    const phaseHit = !!at.phase && s.phases.has(at.phase);
    const econHit = !!at.economy && ECONOMIES_SEEN.has(at.economy) && s.economies.has(at.economy);
    if (!situational({ agentHit, roleHit, causeHit, patternHit, enemyHit, phaseHit, econHit })) continue;
    let score = c.weight || 2;
    if (causeHit) score += 5;
    if (patternHit) score += 4;
    if (agentHit) score += 4;
    if (enemyHit) score += versus + 1;
    if (phaseHit) score += 2;
    if (econHit) score += 2;
    if (at.role) score += 2;
    if (at.map) score += 3;
    if (at.side) score += 1;
    score += ranked;
    if (score < MIN_SCORE) continue;
    // The match's own variety (seeded, so one match always gets the same
    // cases): a near tie goes a different way in a different match.
    if (s.seed) score += VARIETY * unit(`${s.seed}|${c.id}`);
    // What in the player's data it matched, so two cases are two lessons.
    const anchors = [
      ...(causeHit ? c.cause.filter((k) => s.causes.has(k)).map((k) => `cause:${k}`) : []),
      ...(patternHit ? c.patterns.filter((k) => s.patterns.has(k)).map((k) => `pattern:${k}`) : []),
      ...(agentHit ? ['agent'] : []),
      ...(enemyHit ? ['enemy'] : []),
      ...(phaseHit ? [`phase:${at.phase}`] : []),
      ...(econHit ? [`economy:${at.economy}`] : []),
    ];
    out.push({ c, score, anchors });
  }
  out.sort((a, b) => b.score - a.score || (a.c.id < b.c.id ? -1 : 1));
  return out;
}

/**
 * At most `limit` (MAX_CASES) cases for the situation, best first, and a
 * second only when it matches something the first did not AND teaches
 * something else: no cause, pattern or phase of the first (lessonsOf). Two
 * lost duel cases, or two post plant ones, are one lesson told twice.
 */
function pick(x, limit = MAX_CASES, pool) {
  const want = Math.max(0, Math.min(MAX_CASES, limit));
  const out = [];
  const covered = new Set();
  const taught = new Set();
  for (const n of scored(x, pool)) {
    if (out.length >= want) break;
    if (out.length && n.anchors.every((a) => covered.has(a))) continue;
    const lessons = lessonsOf(n.c);
    if (out.length && lessons.some((l) => taught.has(l))) continue;
    out.push(n.c);
    for (const a of n.anchors) covered.add(a);
    for (const l of lessons) taught.add(l);
  }
  return out;
}

/** One case as the prompt line: what shows it, the decision, why, the mistake. */
function line(c) {
  return `- ${c.signal} ${c.decision} Why: ${c.why} The mistake to avoid: ${c.mistakeToAvoid}`;
}

const HEAD = 'WORKED CASES from high level coaching: when the player\'s situation matches, reason from the case, '
  + 'never copy it word for word, never name it as a case, and never say where it comes from:';

/** The prompt block for the cases, or '' for none. */
function block(list) {
  return list && list.length ? `${HEAD}\n${list.map(line).join('\n')}` : '';
}

/**
 * The review's situation (match-review.js normalise's input): the player's
 * agent and map, the sides played, the phases and the pistol rounds of the
 * deaths, the causes the coach looked at and counted, the computed patterns,
 * the enemy agents, the band and the toggle.
 */
function fromReview(input, enemies) {
  const { context = {}, rounds = [], patterns = [], mistakes } = input || {};
  const sides = new Set();
  const phases = new Set();
  const economies = new Set();
  const causes = new Set();
  const byN = new Map(rounds.map((r) => [r.n, r]));
  const perPhase = new Map();
  const phase = (p) => perPhase.set(p, (perPhase.get(p) || 0) + 1);
  let deaths = 0;
  for (const r of rounds) {
    const side = r.side === 'attacking' ? 'attack' : r.side === 'defending' ? 'defense' : null;
    if (side) sides.add(side);
    if (!r.died) continue;
    deaths++;
    if (r.planted) phase(side === 'defense' ? 'retake' : 'postplant');
    if (r.alive && r.alive.mates === 1) phase('clutch');
    if (r.timing === 'early') phase('early');
    if (r.timing === 'mid') { phase('mid'); if (side === 'attack' && !r.planted) phase('execute'); }
    if (r.timing === 'late' && !r.planted) phase('late');
    if (r.n === 1 || r.n === 13) economies.add('pistol');
    if (r.n === 2 || r.n === 14) {
      const before = byN.get(r.n - 1);
      if (before && before.result === 'won') economies.add('antieco');
      if (before && before.result === 'lost') economies.add('lostpistol');
    }
    if (r.cause) causes.add(r.cause);
  }
  // A phase is the match's only where its deaths gather (concentrated()):
  // one early death among twenty is every match.
  for (const p of concentrated(perPhase, deaths)) phases.add(p);
  for (const m of mistakes || []) {
    const c = /^cause:(.+)$/.exec(String((m && m.key) || ''));
    if (c) causes.add(c[1]);
  }
  return {
    agent: context.agent, map: context.map, sides, phases, economies, causes,
    patterns: patterns.map((p) => p && p.key).filter(Boolean),
    enemies: enemies || [],
    rankBand: context.rankBand,
    advanced: context.advancedTips === true,
    seed: reviewSeed(input),
  };
}

/*
 * The review's seed: the review body carries no match id, so the match's own
 * facts stand in for one, the map, the agent, the final score and each round's
 * side, result, death, timing, second and killer. The same match is the same
 * seed every time it is reviewed, and two matches share one only by having
 * been played identically.
 */
function reviewSeed(input) {
  const { context = {}, rounds = [], final = {} } = input || {};
  if (!rounds.length) return null;
  return [context.map, context.agent, final.team, final.enemy,
    ...rounds.map((r) => [r.n, r.side, r.result, r.died ? 1 : 0, r.timing, r.sec, r.killer].join(':'))].join('|');
}

module.exports = { pick, scored, block, line, situation, fromReview, all: () => CASES, size: () => CASES.length,
  situational, lessonsOf, reviewSeed, unit, concentrated, MAX_CASES, MIN_SCORE, VARIETY, PHASE_MIN, HEAD };
