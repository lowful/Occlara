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
const forensics = require('./death-forensics');
const { promptName } = require('./languages');

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
    // What the review counted (insights.js on the client), most serious first:
    // the summary's repeated mistake is the first of these, never one the model
    // finds for itself. Null from a client from before 8.3.1, which counts the
    // same lists on its own page and sends neither: "none cleared the bar"
    // would be a falsehood told to the model as true (promptRounds).
    mistakes: Array.isArray(b.mistakes) ? listOf(b.mistakes, 4) : null,
    strengths: Array.isArray(b.strengths) ? listOf(b.strengths, 4) : null,
    tips: (Array.isArray(b.tips) ? b.tips : []).slice(0, 30).map((t) => clip(t, 220)),
    notes: (Array.isArray(b.notes) ? b.notes : []).slice(0, 20).map((t) => clip(t, 90)),
    context: {
      agent: typeof ctx.agent === 'string' ? clip(ctx.agent, 20) : null,
      map: typeof ctx.map === 'string' ? clip(ctx.map, 20) : null,
      advancedTips: ctx.advancedTips === true,
      language: typeof ctx.language === 'string' ? clip(ctx.language, 8) : 'en',
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
 */
function study(input, limit = 3) {
  const { context, patterns, rounds } = input;
  const s = knowledge.situationOf({ agent: context.agent, map: context.map });
  const wanted = new Set();
  for (const p of patterns) for (const t of PATTERN_TOPICS[p.key] || []) wanted.add(t);
  const weak = weakSide(rounds);
  const advancedOn = context.advancedTips === true;

  const scored = [];
  for (const note of knowledge.all()) {
    const src = note.source;
    if (!src || typeof src.topic !== 'string' || !src.topic) continue;
    if (note.weapons) continue;
    if (note.agents && (!s.agent || !note.agents.some((a) => a.toLowerCase() === s.agent.toLowerCase()))) continue;
    if (note.roles && (!s.role || !note.roles.includes(s.role))) continue;
    if (note.maps && (!s.map || !note.maps.some((m) => m.toLowerCase() === s.map))) continue;
    const advanced = note.tier === 'advanced';
    if (advanced && !advancedOn) continue;
    let score = note.weight || 1;
    if (note.agents) score += 4;
    if (note.maps) score += 3;
    if (note.roles) score += 2;
    if (wanted.has(src.topic)) score += 5;
    if (note.side && weak && note.side === weak) score += 2;
    if (note.side && weak && note.side !== weak) score -= 2;
    scored.push({ text: note.text, topic: src.topic, advanced, score });
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
    const share = streak ? RESERVE_OF - knowledge.STREAK_CORE_SLOTS : knowledge.ADVANCED_SLOTS;
    const advWant = Math.max(0, Math.min(limit - 1, Math.floor((limit * share) / RESERVE_OF)));
    const adv = scored.filter((n) => n.advanced);
    take(adv, advWant);
    take(scored.filter((n) => !n.advanced), limit);
    // Short on core notes for this player: topped back up from advanced
    // rather than listing fewer, as retrieve() does.
    take(adv, limit);
  }
  out.sort((a, b) => b.score - a.score);
  return out.map((n) => ({ text: n.text }));
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
      if (r.killer) d += `, killed by ${r.killer}${r.weapon ? ' with ' + withArticle(r.weapon) : ''}`;
      facts.push(d);
      if (r.firstDeath) facts.push('first player to die that round');
      if (r.alive) facts.push(`${r.alive.mates} of their team standing against ${r.alive.enemies} when they died`);
      if (r.traded === true) facts.push('a teammate traded the death');
      if (r.traded === false) facts.push('nobody traded the death');
      if (r.ultReady) facts.push('ultimate was ready when they died');
      if (r.cause) facts.push(`the coach looked at the frame before the death: ${forensics.CAUSES[r.cause]}${r.seen ? ` (${r.seen.replace(/\.$/, '')})` : ''}`);
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
      + (final.scoreline ? ` Riot's scoreboard for the player: ${counts(final.scoreline.kills, 'kill')}, `
        + `${counts(final.scoreline.deaths, 'death')}, ${final.scoreline.assists === null ? 'unknown assists'
          : counts(final.scoreline.assists, 'assist')}`
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
      // Never where it comes from: the review speaks these notes in its own
      // voice and names no coach, player, team or video behind them.
      knowledgeBlock = '\n\nCOACHING KNOWLEDGE (verified habits). Use one to explain WHY a round went wrong '
        + 'only when that round\'s facts actually match it. Never quote it word for word, and never say where '
        + 'it comes from: no coach, player, team or video is ever named as its source:\n'
        + notes.slice(0, 8).map((t) => '- ' + t).join('\n');
    }
  }

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
  const picks = teachable(rounds);
  return `You are reviewing one finished Valorant match for the player, ${who}. ${score}\n\n`
    + `${ledgerNote}\n${rounds.map(roundLine).join('\n')}\n\n`
    + `COMPUTED PATTERNS (arithmetic over the ledger, these are true):\n`
    + (patterns.length ? patterns.map((p) => '- ' + p.text).join('\n') : '- none cleared the bar in this match')
    + block('COUNTED MISTAKES (counted from the rounds above, most serious first, these are true):', input.mistakes)
    + block('COUNTED STRENGTHS (counted the same way, these are true):', input.strengths)
    + knowledgeBlock
    + '\n\nWrite exactly this, each label at the start of its own line:\n'
    + 'SUMMARY: three sentences on one line, under 70 words. First, starting with You won or You lost and the score '
    + 'if the score says so, what decided it for the player, drawn from the counted mistakes, the strengths and the patterns. '
    + 'Second, the first counted mistake in your own words, with its count exactly as given and up to four of its '
    + 'rounds; if no mistake was counted, what cost the most rounds by the round facts, never called a repeated '
    + 'mistake. Third, what went right, from the counted strengths if there are any, otherwise from the round facts.\n'
    + (picks.length
      ? `Then one round line for each of these rounds, in this order: ${picks.map((n) => 'R' + n).join(', ')}.\n`
        + 'R<number>: one sentence, at most 30 words, on what to do differently next time in that round, with the one fact '
        + 'that makes it the lesson (the numbers standing when you died, that nobody could trade you, the plant). The player '
        + 'sees that round\'s facts right beside your line, so never restate them: no killer, weapon, seconds or place '
        + 'unless the lesson needs that one. What was seen in play is the last the screen showed of the player before the '
        + 'death; use it only where it agrees with the facts. If the facts give you no lesson, leave that round out.\n'
      : 'Write no round lines: no round was lost to a death.\n')
    + 'FOCUS: one concrete habit for the next match that fixes the first counted mistake, something a player can do '
    + 'in a round. Being traded means a teammate killed your killer within five seconds, which is good: never call it '
    + 'the problem.\n\n'
    + GROUNDING
    + languageRule(context.language);
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
 * A round worth a line at all: one the player died in and did not win, or one
 * the coach looked at. A line explains a death. On the player's Sunset
 * swiftplay every round had a read, so every round got a line, and the four
 * kill round won on attack was told "Opening menus in spawn delays your
 * movement": a won round with no death has nothing to explain.
 */
function lineWorthy(r) {
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
function teachable(rounds, limit = MAX_ROUND_LINES) {
  const scored = rounds
    .filter(lineWorthy)
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
  for (const w of String(roundDigits(text) || '').split(/\s+/)) {
    const bare = w.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (bare === 'round' || bare === 'rounds') { run = true; range = false; continue; }
    if (!run) continue;
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

function parse(text, input) {
  const out = { summary: null, rounds: {}, focus: null, dropped: [], blamed: [] };
  // Only a round worth a line can have one (lineWorthy): a won round with no
  // death is never explained, whatever the model writes.
  const valid = new Set(input.rounds.filter(lineWorthy).map((r) => r.n));
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
    const allowed = new Set((input.mistakes || []).flatMap((m) => countPairs(m.detail)));
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
  // "Riot lost 2 to 5", the record named as the one who played: the summary
  // starts with the player's own result, and a sentence that does not is no
  // sentence of theirs.
  if (out.summary) {
    const kept = splitSentences(out.summary).map((s) => s.trim()).filter((s) => s && !/^Riot\s+(?:won|lost)\b/i.test(s));
    out.summary = kept.join(' ').trim() || null;
  }
  return out;
}

// What a line says of a round's trade (TRADE GATE in parse). English, as the
// killer gate's words are.
const NOT_TRADED = /\b(?:no one|nobody|no teammate|no ally|not|never)\s+(?:was\s+|were\s+|got\s+|could\s+|did\s+)?(?:able to\s+)?trad(?:e|ed|ing)\b|\buntraded\b|\bunanswered\b|\bwithout (?:a |any )?trade\b/i;
const WAS_TRADED = /\b(?:you were|you got|was|got|were) traded\b|\btraded by (?:a |your )?teammate\b/i;
const TRADE_AS_HARM = /\bget(?:s|ting)? you traded\b|\b(?:leads? to|ends? in|means) (?:you )?(?:being|getting) traded\b/i;

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

module.exports = { normalise, buildPrompt, parse, study, weakSide, roundLine, roundDigits, roundLabels, teachable, lineWorthy,
  namesKiller, namedRounds, countPairs, NOT_PLAY, BUY_BLAME, REPEAT_WORDS, ROUND_LABELS, DEFAULT_VARIANT, MAX_ROUND_LINES, PATTERN_TOPICS };
