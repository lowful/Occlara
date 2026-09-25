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

// PENDING THE BENCH. Replaced with the measured winner and the reason.
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

const clip = (v, n) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, n);

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
    reads: (Array.isArray(r && r.reads) ? r.reads : []).slice(0, 3).map((t) => clip(t, 220)).filter(Boolean),
  })).filter((r) => r.n > 0);
  const patterns = (Array.isArray(b.patterns) ? b.patterns : []).slice(0, 8).map((p) => ({
    key: clip(p && p.key, 20),
    text: clip(p && p.text, 180),
  })).filter((p) => p.text);
  const ctx = b.context || {};
  const final = b.final || {};
  return {
    rounds,
    patterns,
    tips: (Array.isArray(b.tips) ? b.tips : []).slice(0, 30).map((t) => clip(t, 220)),
    notes: (Array.isArray(b.notes) ? b.notes : []).slice(0, 20).map((t) => clip(t, 90)),
    context: {
      agent: typeof ctx.agent === 'string' ? clip(ctx.agent, 20) : null,
      map: typeof ctx.map === 'string' ? clip(ctx.map, 20) : null,
      advancedTips: ctx.advancedTips === true,
    },
    final: {
      team: Number.isInteger(final.team) ? final.team : null,
      enemy: Number.isInteger(final.enemy) ? final.enemy : null,
      result: ['Victory', 'Defeat', 'Draw'].includes(final.result) ? final.result : null,
    },
    variant: ['A', 'B', 'C'].includes(b.variant) ? b.variant : DEFAULT_VARIANT,
  };
}

/** The side the player won less on, when both sides have three decided rounds. */
function weakSide(rounds) {
  const rate = (side) => {
    const d = rounds.filter((r) => r.side === side && r.result);
    return d.length >= 3 ? d.filter((r) => r.result === 'won').length / d.length : null;
  };
  const a = rate('attacking');
  const d = rate('defending');
  if (a === null || d === null || a === d) return null;
  return a < d ? 'attack' : 'defense';
}

/**
 * The sourced notes worth reading before the next match.
 *
 * Only notes carrying source.coach, so everything listed can be attributed to a
 * named coach. Weapon notes are left out because the gun changes round to round
 * and a review cannot know which one to study. The agent, role and map filters
 * are the same exclusions retrieve() applies, so a Sova note never reaches a
 * Jett.
 */
function study(input, limit = 3) {
  const { context, patterns, rounds } = input;
  const s = knowledge.situationOf({ agent: context.agent, map: context.map });
  const wanted = new Set();
  for (const p of patterns) for (const t of PATTERN_TOPICS[p.key] || []) wanted.add(t);
  const weak = weakSide(rounds);

  const scored = [];
  for (const note of knowledge.all()) {
    const src = note.source;
    if (!src || !src.coach) continue;
    if (note.weapons) continue;
    if (note.agents && (!s.agent || !note.agents.some((a) => a.toLowerCase() === s.agent.toLowerCase()))) continue;
    if (note.roles && (!s.role || !note.roles.includes(s.role))) continue;
    if (note.maps && (!s.map || !note.maps.some((m) => m.toLowerCase() === s.map))) continue;
    let score = note.weight || 1;
    if (note.agents) score += 4;
    if (note.maps) score += 3;
    if (note.roles) score += 2;
    if (src.topic && wanted.has(src.topic)) score += 5;
    if (note.side && weak && note.side === weak) score += 2;
    if (note.side && weak && note.side !== weak) score -= 2;
    scored.push({ text: note.text, coach: src.coach, topic: src.topic || null, score });
  }
  scored.sort((a, b) => b.score - a.score);
  // One per topic, so three notes are three different things to work on.
  const out = [];
  const topics = new Set();
  for (const n of scored) {
    if (out.length >= limit) break;
    if (n.topic && topics.has(n.topic)) continue;
    topics.add(n.topic);
    out.push({ text: n.text, coach: n.coach });
  }
  return out;
}

function roundLine(r) {
  const bits = [`R${r.n}`];
  bits.push([r.side === 'attacking' ? 'attack' : r.side === 'defending' ? 'defence' : 'side unread',
    r.result || 'result unread'].join(', '));
  const facts = [];
  if (r.died) {
    facts.push(`died${r.deathSpot ? ' at ' + r.deathSpot : ''}${r.timing ? ', ' + r.timing + ' in the round' : ''}`);
    if (r.ultReady) facts.push('ultimate was ready when they died');
  }
  if (r.planted) facts.push(`spike planted${r.plantSpot ? ' at ' + r.plantSpot : ''}`);
  let line = `${bits.join(' ')}${facts.length ? '. ' + facts.join('; ') : ''}.`;
  if (r.reads.length) line += ` Coach read: ${r.reads.map((t) => `"${t}"`).join(' ')}`;
  return line;
}

const GROUNDING = 'GROUNDING RULES. The ledger was built by watching the screen every ten seconds or so, '
  + 'so a round with no death listed may simply not have been seen, never call it clean. '
  + 'A coach read is what the coach SAID at the time, not proof of what the player did. '
  + 'Kills, damage, utility usage, economy and how many players were alive are not in the ledger, so never '
  + 'state them, and never call a situation a man advantage or a clutch. '
  + 'Never tell the player to use their ultimate unless that round says the ultimate was ready. '
  + 'Never do arithmetic on the score, use it exactly as given. '
  + 'Write round numbers as digits and never list more than four of them in one sentence. '
  + 'Only name places that appear in the ledger. Do not use dashes. No markdown, no lists, no bold.';

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

function promptRounds(input, withKnowledge) {
  const { context, final, rounds, patterns } = input;
  const who = [context.agent ? `playing ${context.agent}` : 'agent unread', context.map ? `on ${context.map}` : 'map unread'].join(' ');
  const score = final.team !== null && final.enemy !== null
    ? `The score the coach last read was ${final.team} to ${final.enemy}${final.result ? `, a ${final.result.toLowerCase()}` : ''}.`
    : 'The final score was not read.';

  let knowledgeBlock = '';
  if (withKnowledge) {
    const notes = [];
    const seen = new Set();
    const add = (t) => { if (t && !seen.has(t)) { seen.add(t); notes.push(t); } };
    for (const n of study(input, 4)) add(n.text);
    for (const t of knowledge.retrieve({ agent: context.agent, map: context.map }, 6,
      { advanced: context.advancedTips })) add(t);
    if (notes.length) {
      knowledgeBlock = '\n\nCOACHING KNOWLEDGE (from pro VOD reviews and verified habits). Use one to explain WHY a '
        + 'round went wrong only when that round\'s facts actually match it, and never quote it word for word:\n'
        + notes.slice(0, 8).map((t) => '- ' + t).join('\n');
    }
  }

  return `You are reviewing one finished Valorant match for the player, ${who}. ${score}\n\n`
    + `ROUND LEDGER:\n${rounds.map(roundLine).join('\n')}\n\n`
    + `COMPUTED PATTERNS (arithmetic over the ledger, these are true):\n`
    + (patterns.length ? patterns.map((p) => '- ' + p.text).join('\n') : '- none cleared the bar in this match')
    + knowledgeBlock
    + '\n\nWrite exactly this, each label at the start of its own line:\n'
    + 'SUMMARY: three sentences on one line, under 70 words. First, what decided this match for the player, drawn '
    + 'from the patterns. Second, the most repeated mistake, naming up to four rounds it happened in. Third, what '
    + 'went right if the ledger shows it, otherwise the habit the coach kept pushing.\n'
    + `Then up to ${MAX_ROUND_LINES} round lines, only for rounds with a death or a coach read, choosing the rounds that `
    + 'teach the most, in round order:\n'
    + 'R<number>: at most two sentences and 45 words on WHY that round went the way it did and what the better play '
    + 'was. Explain the reason, do not just repeat the coach read in the past tense.\n'
    + 'FOCUS: one concrete habit for the next match, tied to the pattern it fixes, that a player can actually do.\n\n'
    + GROUNDING;
}

function buildPrompt(input) {
  if (input.variant === 'A') return promptA(input);
  return promptRounds(input, input.variant === 'C');
}

/**
 * The model's reply, parsed. Tolerant of markdown bold around the labels and of
 * the summary running onto a second line; strict about round numbers, which
 * must be rounds the ledger actually sent.
 */
function parse(text, input) {
  const out = { summary: null, rounds: {}, focus: null };
  const valid = new Set(input.rounds.map((r) => r.n));
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
  return out;
}

module.exports = { normalise, buildPrompt, parse, study, weakSide, roundLine,
  DEFAULT_VARIANT, MAX_ROUND_LINES, PATTERN_TOPICS };
