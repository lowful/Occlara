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
    // Riot's record, when the client could link the match. Exact facts.
    verified: !!(r && r.verified),
    sec: r && Number.isFinite(r.sec) && r.sec >= 0 && r.sec < 300 ? Math.round(r.sec) : null,
    killer: r && r.killer ? clip(r.killer, 20) : null,
    weapon: r && r.weapon ? clip(r.weapon, 20) : null,
    firstDeath: !!(r && r.firstDeath),
    firstKill: !!(r && r.firstKill),
    kills: r && Number.isInteger(r.kills) && r.kills >= 0 && r.kills <= 10 ? r.kills : null,
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
      verified: final.verified === true,
      scoreline: (() => {
        const s = final.scoreline || {};
        const n = (v, max) => (Number.isFinite(v) && v >= 0 && v <= max ? Math.round(v) : null);
        const out = { kills: n(s.kills, 99), deaths: n(s.deaths, 99), assists: n(s.assists, 99),
          acs: n(s.acs, 999), mvp: s.mvp === 'match' || s.mvp === 'team' ? s.mvp : null };
        return out.kills !== null && out.deaths !== null ? out : null;
      })(),
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
  if (r.verified) {
    // Riot's record: exact, so stated exactly.
    if (r.died) {
      let d = `died${r.deathSpot ? ' at ' + r.deathSpot : ''}`;
      if (r.sec !== null) d += ` ${r.sec} seconds into the round`;
      if (r.killer) d += `, killed by ${r.killer}${r.weapon ? ' with a ' + r.weapon : ''}`;
      facts.push(d);
      if (r.firstDeath) facts.push('first player to die that round');
      if (r.ultReady) facts.push('ultimate was ready when they died');
    } else {
      facts.push('survived the round');
    }
    if (r.kills !== null) facts.push(`${r.kills} kill${r.kills === 1 ? '' : 's'}`);
    if (r.firstKill) facts.push('got the first kill of the round');
  } else if (r.died) {
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
  + 'Damage, utility usage, economy and how many players were alive are not in the ledger, so never state '
  + 'them, and never call a situation a man advantage or a clutch. Kills may be stated only where the ledger '
  + 'gives a kill count for that round. '
  + 'Never tell the player to use their ultimate unless that round says the ultimate was ready. '
  + 'Never do arithmetic on the score, use it exactly as given. '
  + 'Quote a pattern\'s numbers exactly or not at all, and never merge two patterns into one number. '
  + 'Speak to the player as you, never as the player. '
  + 'In the SUMMARY write no counts or fractions such as 6 of 12, the computed patterns show every number '
  + 'beside it. The final score and round numbers are fine. '
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
    ? `${final.verified ? 'Riot\'s final score was' : 'The score the coach last read was'} ${final.team} to ${final.enemy}${final.result ? `, a ${final.result.toLowerCase()}` : ''}.`
      + (final.scoreline ? ` Riot's scoreboard for the player: ${final.scoreline.kills} kills, `
        + `${final.scoreline.deaths} deaths, ${final.scoreline.assists === null ? 'unknown' : final.scoreline.assists} assists`
        + `${final.scoreline.acs !== null ? `, combat score ${final.scoreline.acs} a round` : ''}`
        + `${final.scoreline.mvp === 'match' ? ', match MVP' : final.scoreline.mvp === 'team' ? ', team MVP' : ''}. `
        + 'Weigh the deaths against this: a player who dies first but wins the fights around it is paying for '
        + 'their impact, not failing.' : '')
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

  const verified = rounds.some((r) => r.verified);
  const ledgerNote = verified
    ? 'ROUND LEDGER, checked against Riot\'s record of the match. Deaths, the seconds, the killer, kills, '
      + 'first deaths and round results are Riot\'s and exact. Death locations and coach reads come from the '
      + 'screen. A coach read that named a different killer than Riot was removed:'
    : 'ROUND LEDGER:';
  return `You are reviewing one finished Valorant match for the player, ${who}. ${score}\n\n`
    + `${ledgerNote}\n${rounds.map(roundLine).join('\n')}\n\n`
    + `COMPUTED PATTERNS (arithmetic over the ledger, these are true):\n`
    + (patterns.length ? patterns.map((p) => '- ' + p.text).join('\n') : '- none cleared the bar in this match')
    + knowledgeBlock
    + '\n\nWrite exactly this, each label at the start of its own line:\n'
    + 'SUMMARY: three sentences on one line, under 70 words. First, whether the match was won or lost if the score '
    + 'says so, and what decided it for the player, drawn from the patterns. Second, the most repeated mistake, '
    + 'naming up to four rounds it happened in. Third, what went right if the ledger shows it, otherwise the habit '
    + 'the coach kept pushing.\n'
    + `Then one round line for each of these rounds, in this order: ${teachable(rounds).map((n) => 'R' + n).join(', ')}.\n`
    + 'R<number>: at most two sentences and 45 words. The coach read already says WHAT happened, so your line must '
    + 'add what the read does not: the principle behind the mistake, or what to do differently next time, in your '
    + 'own words. If you would only be repeating the read, leave that round out.\n'
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
/**
 * The rounds worth a line, chosen HERE rather than by the model.
 *
 * Asked to "choose the rounds that teach the most, in round order", the model
 * took the first ten: on the real 24 round Abyss match it explained rounds 2 to
 * 11 and never reached the second half. So the choice is arithmetic. A lost
 * round outranks a won one, a first death or an early death outranks a late
 * one, and a round the coach said something about outranks a silent one. Ties
 * go to spreading the picks across the match.
 */
function teachable(rounds, limit = MAX_ROUND_LINES) {
  const scored = rounds
    .filter((r) => r.died || r.reads.length)
    .map((r) => ({
      n: r.n,
      score: (r.result === 'lost' ? 3 : 0) + (r.firstDeath ? 3 : 0) + (r.died ? 2 : 0)
        + (r.verified && r.sec !== null && r.sec <= 30 ? 1 : 0) + (r.reads.length ? 1 : 0),
    }));
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

function parse(text, input) {
  const out = { summary: null, rounds: {}, focus: null, dropped: [] };
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

  // NO COUNTS IN THE SUMMARY. The prompt said to quote a pattern's numbers
  // exactly or not at all, and the model still wrote "six of twelve attack
  // rounds after spike plant" on the real Abyss match, merging 6 of 12 on
  // attack with 6 of 10 after the plant. The computed patterns sit directly
  // above the summary in the window, so a count here adds nothing and risks a
  // wrong one. A sentence carrying one is dropped.
  if (out.summary) {
    const kept = splitSentences(out.summary).map((s) => s.trim()).filter((s) => s && !COUNT_PHRASE.test(s));
    out.summary = kept.join(' ').trim() || null;
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
  return out;
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
  return toks.join('');
}

module.exports = { normalise, buildPrompt, parse, study, weakSide, roundLine, roundDigits, teachable, namesKiller,
  DEFAULT_VARIANT, MAX_ROUND_LINES, PATTERN_TOPICS };
