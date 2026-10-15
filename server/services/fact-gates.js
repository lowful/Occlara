'use strict';

/**
 * WHAT A MODEL SAYS ABOUT A MATCH IS CHECKED ONE SENTENCE AT A TIME (8.5.0).
 *
 * Ask Coach v2 writes paragraphs about the player's own match, and a review
 * is where a confident wrong sentence costs most: the match is over and the
 * player can only check it against a half memory. So every sentence of a
 * reply passes these gates, and a sentence that fails one is dropped, never
 * repaired (chat-prompt.js parseReply). From Phase E the look and the review
 * read them too; until then they are Ask Coach's.
 *
 * Each gate takes one sentence and the facts the prompt was built from
 * (chat-prompt.js factsOf) and answers null, or { gate, reason }: the gate
 * that failed, for the counts the route returns and logs, and a reason in
 * plain words for the one retry (chat-prompt.js retryPrompt). A reason names
 * the claim, never a player: the name gates say only that a name was there.
 *
 * A ROUND SENTENCE names a round of this match, or, in a reply to a question
 * about one round, speaks in the past tense about the player. A hypothetical
 * ("if you had", "would have", "could have") or an instruction (an
 * imperative, "next time", "try") is never one: the result, the standing,
 * the killer, the weapon and the economy are checked on what a sentence says
 * happened, never on what it tells the player to do.
 *
 * ENGLISH WORDS, MOSTLY. The result, label, standing, attribution, meta, buy
 * blame and count gates read English words. Outside English the number gate
 * reads digits alone, by value and unit against every fact the prompt held;
 * the shapes of a name and the match's own names hold in any language; and
 * the map and ability gates read names the game prints the same in every
 * language.
 *
 * Every regex here was written with a file editing tool and is asserted in
 * scripts/test-chat-gates.js on a known positive and a known negative.
 *
 * No require from src/: check:server forbids it. Where a gate mirrors a
 * client list (the cause titles, the phrase lists) or another server file's
 * (the review's trade words) the tests hold the copies equal.
 */

let DATA = {};
try { DATA = require('../valorant-data.generated.json'); } catch { DATA = {}; }

const lower = (s) => String(s == null ? '' : s).toLowerCase();
const esc = (s) => String(s).replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');

/*
 * CURLY QUOTES ARE STRAIGHTENED BEFORE EVERY GATE (bench:chat, 15 Oct). GPT-6
 * Sol writes its apostrophe as U+2019, and every rule here spells "didn't",
 * "can't" and "Tejo's" with the straight one: on the Sunset swiftplay "You
 * didn't lose round 5", curly, read as a loss of the round it won and went,
 * the first sentence of a corrected premise, and on Split "I can't tell you
 * whether Jett is the best agent", curly, read as a ranking. check() hands
 * every gate the straightened sentence; the reply keeps it as the model wrote
 * it. Built from the codes, so no curly character is typed here.
 */
const CURLY_SINGLE = new RegExp(`[${String.fromCharCode(0x2018, 0x2019, 0x201a, 0x201b, 0x2032, 0x02bc)}]`, 'g');
const CURLY_DOUBLE = new RegExp(`[${String.fromCharCode(0x201c, 0x201d, 0x201e, 0x201f, 0x2033, 0x00ab, 0x00bb)}]`, 'g');
/** A text with its curly apostrophes and quotes made straight, for the gates to read. */
const straighten = (s) => String(s == null ? '' : s).replace(CURLY_SINGLE, "'").replace(CURLY_DOUBLE, '"');
const fin = (v) => typeof v === 'number' && Number.isFinite(v);
const near = (a, b, tol) => fin(a) && fin(b) && Math.abs(a - b) <= tol + 1e-9;

// Lazily, so a death-forensics.js or match-review.js that comes to require
// this file (Phase E) is no load cycle.
const forensics = () => require('./death-forensics');
const review = () => require('./match-review');
let nameGateMod;
function nameGate() {
  if (nameGateMod === undefined) {
    try { nameGateMod = require('./name-gate'); } catch { nameGateMod = null; }
  }
  return nameGateMod;
}

// ── The game's own words ───────────────────────────────────────────────────

const AGENTS = Object.keys(DATA.agents || {});
const GUNS = Object.keys(DATA.weapons || {}).map((k) => k.charAt(0).toUpperCase() + k.slice(1));
const GEAR = Object.keys(DATA.gear || {});
const MAPS = (Array.isArray(DATA.maps) ? DATA.maps : []).map(String);
function KIT(agent) {
  const a = (DATA.agents || {})[agent];
  return a && Array.isArray(a.abilities) ? a.abilities.map(lower) : [];
}
function CALLOUTS(map) {
  const g = (DATA.mapGeometry || {})[lower(map)];
  return g && Array.isArray(g.callouts) ? [...new Set(g.callouts.map((c) => c && c.n).filter(Boolean))] : [];
}
const AGENT_ALT = AGENTS.map(esc).sort((a, b) => b.length - a.length).join('|') || 'NO_AGENT';

/*
 * A GUN IS NAMED AS THE GAME PRINTS IT. "Classic", "Judge", "Ghost" and
 * "Guardian" are English words too ("a classic mistake", "judge the fight"),
 * so a gun is read with its capital, and in lower case only where the word is
 * nothing else.
 */
const PLAIN_GUNS = new Set(['vandal', 'phantom', 'sheriff', 'spectre', 'operator', 'odin', 'ares', 'bulldog', 'bucky']);
function gunsIn(text) {
  const out = [];
  const t = String(text || '');
  for (const g of GUNS) {
    const re = new RegExp(`\\b(${esc(g)}|${esc(lower(g))})s?\\b`, 'g');
    let m;
    while ((m = re.exec(t)) !== null) {
      if (m[1] === g || PLAIN_GUNS.has(lower(g))) out.push({ name: g, at: m.index, end: m.index + m[0].length });
    }
  }
  return out.sort((a, b) => a.at - b.at);
}

/** Agents a text names, as the game prints them (KAY/O included), with where. */
function agentsIn(text) {
  const out = [];
  const t = String(text || '');
  for (const a of AGENTS) {
    const re = new RegExp(`(^|[^A-Za-z0-9])(${esc(a)})(?![A-Za-z0-9])`, 'gi');
    let m;
    while ((m = re.exec(t)) !== null) out.push({ name: a, at: m.index + m[1].length, end: m.index + m[0].length });
  }
  return out.sort((x, y) => x.at - y.at);
}

/** Abilities a text names, by the lower case names the game data keeps, four letters or more. */
function abilitiesIn(text) {
  const out = [];
  const t = lower(text);
  for (const [agent, a] of Object.entries(DATA.agents || {})) {
    for (const ab of (a && a.abilities) || []) {
      if (String(ab).length < 4) continue;
      const re = new RegExp(`\\b${esc(lower(ab))}\\b`, 'g');
      let m;
      while ((m = re.exec(t)) !== null) out.push({ name: ab, agent, at: m.index, end: m.index + m[0].length });
    }
  }
  return out;
}

/*
 * THE CAUSES' WORDS, the client's own (src/shared/death-causes.js `title` and
 * `one`, and the review page's chips, review.js CAUSE_TITLE), mirrored here
 * and held equal by test:chatgates. A label is said in these words.
 */
const CAUSE_TITLES = {
  'dry-peek': ['Dry peek', 'Dry peeks'],
  'isolated': ['Caught alone'],
  'repeek': ['Repeek', 'Repeeks'],
  'crossfire': ['Crossfire', 'Walked into a crossfire', 'Walked into crossfires'],
  'rotating': ['Caught rotating'],
  'overextend': ['Overextended'],
  'exposed': ['Exposed on the spike'],
  'lost-duel': ['Lost the duel', 'Lost duels'],
  'unclear': ['Unclear', 'Frame unclear'],
};
// The same causes as a sentence says them after a labelling phrase, lower case.
const CAUSE_WORDS = {
  'dry-peek': ['dry peek', 'dry-peek'],
  'isolated': ['caught alone', 'isolated'],
  'repeek': ['repeek', 're-peek'],
  'crossfire': ['crossfire', 'walked into a crossfire'],
  'rotating': ['caught rotating', 'rotating'],
  'overextend': ['overextended', 'overextend', 'overextension'],
  'exposed': ['exposed on the spike', 'exposed'],
  'lost-duel': ['lost the duel', 'lost duel', 'lost-duel'],
  'unclear': ['unclear'],
};

/*
 * THE PHRASE LISTS (8.5.0, spec 6.5): what in a better play moves the player
 * away from the duel. They set no label anywhere. A saved lost-duel whose
 * better line trips one is given to Ask Coach without its label (here, in
 * chat-prompt.js normalise, and on the client in src/shared/chat-context.js,
 * held equal by test:chatcontext), and "fair fight" is said of a round only
 * where its look is lost-duel and its better line trips none. The utility
 * list is the player's own kit beside these words. The aim list is the one a
 * fair fight's better play may use.
 */
const PHRASES = {
  decision: /\b(let them come|let the clock|play for time|make them come to you|no need to|do not take the fight|don't take the fight|hold the spike)\b/i,
  team: /\b(teammates?|trade|swing with|with your team|together)\b/i,
  reset: /\b(fall back|step back|back behind cover|back into cover|reset|disengage|pull back|after your first shots|after the first exchange|after the first burst|instead of staying|stop firing and)\b/i,
  utility: /\b(smoke|flash|drone|recon|utility|information first)\b/i,
  aim: /\b(crosshair|aim|head level|counter ?strafe|tap|burst|first bullet|spray)\b/i,
};

/** The first list a better line trips, of decision, team, reset and utility (the kit included), or null. */
function phraseHit(better, abilities) {
  const b = String(better || '');
  if (!b) return null;
  for (const k of ['decision', 'team', 'reset', 'utility']) if (PHRASES[k].test(b)) return k;
  const t = lower(b);
  for (const ab of abilities || []) {
    if (ab && new RegExp(`\\b${esc(lower(ab))}\\b`).test(t)) return 'utility';
  }
  return null;
}

// ── Splitting ──────────────────────────────────────────────────────────────

/*
 * SENTENCES END ON . ! ? FOLLOWED BY A SPACE, never inside a number: "13.33
 * shots a second" stays whole. A paragraph is a run of lines with no blank
 * line between them.
 */
const SENTENCE_END = /(?<=[.!?])\s+(?=\S)/;
function sentencesOf(paragraph) {
  return String(paragraph || '').split(SENTENCE_END).map((s) => s.trim()).filter(Boolean);
}
function paragraphsOf(text) {
  return String(text || '').replace(/\r/g, '').split(/\n\s*\n+/)
    .map((p) => p.replace(/\s*\n\s*/g, ' ').trim()).filter(Boolean);
}

// ── Kinds of sentence ──────────────────────────────────────────────────────

const HYPOTHETICAL = /\b(?:if you(?:'d| had| were| hadn't| had not)|had you|would have|could have|should have|would've|could've|should've|might have|wouldn't have|couldn't have)\b/i;
// An instruction: an imperative first word, or the words of one.
const IMPERATIVE = /^(?:(?:in|on|during|after|before) (?:round \d{1,2}|that round|those rounds|a round like that|rounds like that|the post plant|the retake)[ ,]+)?(?:(?:so|then|instead|next|now|and|but|also|first|here)[ ,]+)*(?:try|take|hold|stay|use|play|peek|wait|fall|step|check|keep|watch|practise|practice|aim|stop|let|make|set|move|look|clear|swing|trade|plant|defuse|retake|rotate|save|buy|throw|smoke|flash|drone|spend|record|review|focus|ask|go|give|get|pick|push|reset|crouch|jiggle|shoulder|pre-aim|preaim|counter|walk|run|treat|start|learn|think|picture|count|listen|call|communicate|work|repeat|drill|warm|queue|change|reposition|avoid|don't|do|be|never|always|press|tap|burst|in deathmatch|in the range)\b/i;
const INSTRUCTION_WORDS = /\b(?:next time|try to|try and|make sure|you should|you want to|you need to|aim to|focus on|remember to|the fix is|practise|practice|drill|from now on|next round|next match)\b/i;

const isHypothetical = (s) => HYPOTHETICAL.test(String(s || ''));
const isInstruction = (s) => {
  const t = String(s || '').trim();
  return IMPERATIVE.test(t) || INSTRUCTION_WORDS.test(t);
};

// A round named: "round 5", "rounds 2, 5 and 6", "round #5", "R5", "the
// pistol round", "the first round", "the last round", "overtime".
// The word for a round in each language the app is written in too: a round a
// match does not have is no round of it in any of them.
const ROUND_WORD = /\b(?:rounds?|rondas?|runden?|rodadas?|manches?)\s*#?\s*(\d{1,2})\b/gi;
const R_LABEL = /\bR(\d{1,2})\b/g;
/*
 * A PISTOL ROUND NAMES A ROUND ONLY AS ONE: "the pistol round", "your attack
 * pistol round", "the second pistol round". Read wherever the words stood
 * (bench:chat, 15 Oct), "Round 5 was a pistol round your team won" on the
 * Sunset swiftplay named round 1 as well, which it lost, and Gemini's "round
 * 5 was your second pistol round and one of the two rounds you survived" had
 * the player survive round 1, where they died. So a determiner must open it, a
 * second or last pistol round (or the one after the swap) is the match's
 * second, and "round 5 was the pistol round" describes round 5, which the
 * timeline gate holds to its own pistol flag.
 */
const PISTOL_ROUND = /\b(the|your|my|this|that|our)\s+(?:(first|second|1st|2nd|opening|last)\s+)?(?:(attack|attacking|offensive|defence|defense|defending|defensive)\s+)?pistol\s+round\b/gi;
const PISTOL_DESCRIBED = /\b(?:rounds?\s*#?\s*\d{1,2}|it|this|that)\s+(?:was|is|were)\s+$/i;
const PISTOL_SECOND_AFTER = /^\s+(?:after|of|in)\s+(?:the\s+)?(?:swap|switch|side switch|half|halftime|second half)\b/i;
// And "rounds 5, 11 and 2 more", as the prompt's own lists end, names no round 2.
const ROUND_TIMES = /\brounds?\s+\d{1,2}\s+(?:times|x)\b|\band\s+\d{1,2}\s+more\b/gi;
// "Your teammate finished the round 33 s in" names no round 33: a time, which
// the round gate dropped as a round the match does not have (bench:chat).
const ROUND_SECONDS = /\brounds?\s+\d{1,3}(?=\s*(?:s|secs?|seconds?)\b)/gi;

/** The round numbers a sentence names, in any of its ways, given the match. */
function roundsNamed(s, facts) {
  // "The first kill of the round 8 times" names no round 8: it is the counted
  // line the prompt gives, quoted, and it was dropped as a claim about round
  // 8 (the verifier's probe, 15 Oct). Its digits are masked before reading,
  // and so are a time's after "the round".
  const text = String(s || '').replace(ROUND_TIMES, (w) => w.replace(/\d/g, '#'))
    .replace(ROUND_SECONDS, (w) => w.replace(/\d/g, '#'));
  const out = new Set();
  // The review's reader takes a run of numbers after the word "round", spelled
  // ones included, so "your second pistol round and one of the two rounds you
  // survived" named round 1 (bench:chat, 15 Oct, Gemini on the Sunset). A
  // pistol round is read below, as one, and "one of" counts nothing.
  const forReader = text.replace(new RegExp(PISTOL_ROUND.source, 'gi'), (w) => w.replace(/round\b/i, 'rnd'))
    .replace(/\b(and|or)\s+one\s+of\b/gi, '$1 #ne of');
  try {
    for (const n of review().namedRounds(forReader)) out.add(n);
  } catch { /* the review's reader, when it loads; the words below either way */ }
  let m;
  const re = new RegExp(ROUND_WORD.source, 'gi');
  while ((m = re.exec(text)) !== null) out.add(Number(m[1]));
  const rl = new RegExp(R_LABEL.source, 'g');
  while ((m = rl.exec(text)) !== null) out.add(Number(m[1]));
  const f = facts || {};
  if (f.rounds instanceof Map && f.rounds.size) {
    const all = [...f.rounds.keys()].sort((a, b) => a - b);
    if (/\bthe first round\b/i.test(text)) out.add(all[0]);
    if (/\bthe (?:last|final) round\b/i.test(text)) out.add(all[all.length - 1]);
    for (const p of text.matchAll(new RegExp(PISTOL_ROUND.source, 'gi'))) {
      if (PISTOL_DESCRIBED.test(text.slice(Math.max(0, p.index - 32), p.index))) continue;
      const side = p[3] ? (/^(?:att|off)/i.test(p[3]) ? 'attacking' : 'defending') : null;
      const second = /^(?:second|2nd|last)$/i.test(p[2] || '') || PISTOL_SECOND_AFTER.test(text.slice(p.index + p[0].length, p.index + p[0].length + 40));
      const pistols = all.filter((n) => f.rounds.get(n).pistol && (!side || f.rounds.get(n).side === side));
      // A side names its own pistol round; without one, the second is the match's second.
      const pick = second && !side ? pistols[1] : pistols[0];
      if (pick) out.add(pick);
    }
    if (/\bovertime\b/i.test(text) && f.overtimeFrom) {
      for (const n of all) if (n >= f.overtimeFrom) { out.add(n); break; }
    }
  }
  return [...out].filter((n) => Number.isInteger(n) && n > 0).sort((a, b) => a - b);
}

// Past tense about the player, for a reply to a question about one round.
// "Your death was not traded" is about the asked round as surely as "you
// died": bench:chat's stand in reply said it of a round Riot has traded, and
// it passed as a sentence about no round.
// And what was bought, saved or dealt ("you bought a Vandal", "you saved that
// round"), and a trade with the player as its object ("nobody traded you", "a
// teammate traded you"): the verifier's probes found each passing as a
// sentence about no round, so the economy and trade gates never read them.
// And how the player fought it (bench:chat, 15 Oct): "You fought Clove from
// beside cover with a Classic", in a reply about the Pearl round 1 asked
// about, gave the player the killer's gun and was read as about no round, so
// the weapon gate never saw it. Said of the player alone: "your teammates
// fought back, but the defenders won" is theirs to tell.
const PAST_ABOUT_YOU = /\b(?:you|your team|your teammates?)\s+(?:were|was|had|did|didn't|got|went|took|died|peeked|stayed|held|pushed|played|lost|won|made|stood|walked|ran|swung|killed|traded|used|missed|fired|shot|tried|kept|moved|opened|survived|planted|defused|rotated|fell|left|came|saw|hit|gave|chose|decided|bought|saved|forced|spent|dealt|purchased)\b|\byou\s+(?:fought|drew|faced|challenged|contested|engaged|entered|waited|reloaded|threw)\b|\b(?:killed|shot|got|caught|picked|beat|dropped|finished|traded) you\b|\btrad(?:e|ed|ing) your death\b|\byour\s+(?:death|kills?|duel|fight|trade|plant)\s+(?:was|were|went|came|had|happened|didn't|wasn't)\b/i;

/**
 * Whether a sentence is a round sentence, and of which rounds. A sentence that
 * names no round is one of the asked round when the question named one and it
 * speaks in the past tense about the player.
 */
function roundSentence(sentence, facts) {
  const s = straighten(sentence);
  if (isHypothetical(s) || isInstruction(s)) return { round: false, rounds: [] };
  const named = roundsNamed(s, facts);
  if (named.length) return { round: true, rounds: named };
  const f = facts || {};
  const t = s;
  // A counted line quoted is about the match, never the asked round alone.
  if (f.asked && f.oneRound && (PAST_ABOUT_YOU.test(t) || YOUR_GUN_PAST.test(t)) && !quotesCounted(digitsOf(t), f.counted)) {
    return { round: true, rounds: [f.asked], implied: true };
  }
  return { round: false, rounds: [] };
}
// The player's own gun in the past tense ("your Vandal lost to his Sheriff"):
// a claim about what the player held in the asked round, the weapon gate's.
const YOUR_GUN_PAST = new RegExp(`\\byour\\s+(?:${GUNS.map(esc).join('|') || 'NO_GUN'})s?\\s+(?:was|were|had|did|didn't|got|went|lost|won|missed|hit|shot|killed|took|fell|\\w+ed)\\b`, 'i');

const drop = (gate, reason) => ({ gate, reason });

// ── Names ──────────────────────────────────────────────────────────────────

/*
 * NAMES, ENFORCED. In any language: a Riot ID, a handle's shape, and the
 * match's own names when the server holds them (name-gate.js and
 * riot-rounds.js keep them as hashes only). And, in a language that
 * capitalises only names, an echo: a capitalised word the player typed that
 * is no word of the game's and was not the first word of their sentence
 * (chat-prompt.js echoOf). Never in German, which capitalises every noun.
 */
const RIOT_ID = /\b[A-Za-z0-9_.]{3,16}\s?#\s?[A-Za-z0-9]{2,5}\b/;
const ROUND_HASH = /\brounds?\s?#\s?\d{1,2}\b/gi;
const UNDERSCORE = /[A-Za-z0-9]_[A-Za-z0-9]/;
const GAME_FORM = /^(?:\d+v\d+s?|r\d+|\d+(?:s|ms|m|hp|k|x|st|nd|rd|th|fps)|mb\d+|x\d+)$/i;

function shapeOf(text) {
  const t = String(text || '');
  const ng = nameGate();
  if (ng && typeof ng.handleShape === 'function') return ng.handleShape(t);
  const id = RIOT_ID.exec(t.replace(new RegExp(ROUND_HASH.source, 'gi'), ''));
  if (id) return id[0];
  for (const tok of t.split(/[^A-Za-z0-9_]+/)) {
    if (!tok) continue;
    if (UNDERSCORE.test(tok)) return tok;
    if (tok.length >= 4 && /[A-Za-z]/.test(tok) && /\d/.test(tok) && !GAME_FORM.test(tok)) return tok;
  }
  return null;
}

const NAME_REASON = 'your reply named a player; never name a player, say your teammate or the agent';

/*
 * The match's own names, as the route holds them (riot-rounds.js nameSetOf):
 * something that answers has(text) and holds nothing it could print. Handed
 * in by the caller (opts.nameSet), else asked of riot-rounds.js by the
 * match's Riot id, so a route that passes none still has them while this
 * server holds them. Never a list of names.
 */
function nameSetFor(facts, opts) {
  const o = opts || {};
  if (o.nameSet && typeof o.nameSet.has === 'function') return o.nameSet;
  const f = facts || {};
  if (!f.matchId) return null;
  try {
    const rr = require('./riot-rounds');
    return typeof rr.nameSetOf === 'function' ? rr.nameSetOf(f.matchId) : null;
  } catch { return null; }
}

function gateNames(s, facts, _rs, opts) {
  const f = facts || {};
  const o = opts || {};
  const text = String(s || '');
  if (shapeOf(text)) return drop('name', NAME_REASON);
  const names = nameSetFor(f, o);
  if (names && names.has(text)) return drop('name', NAME_REASON);
  if (typeof o.isName === 'function' && o.isName(text)) return drop('name', NAME_REASON);
  if (f.echo && f.echo.size && f.language !== 'de') {
    for (const tok of String(s || '').split(/[^\p{L}\p{N}'/]+/u)) {
      const w = tok.replace(/'s$/, '');
      if (w && f.echo.has(w)) return drop('name', 'your reply repeated a name the player typed; never name a player, say your teammate or the agent');
    }
  }
  return null;
}

/*
 * THE GAME'S OWN CAPITALISED WORDS, which no capital rule takes for a name.
 * The first part is the review route's list, word for word (routes/coach.js
 * REVIEW_WORDS, out of this file's reach by check:server's rule, held equal by
 * test:chatgates); the second is the chat's own: the grade's categories, the
 * economy, the stat names a player types. The verifier's probes, 15 Oct: a
 * review sentence with "K/D", "ACS", "MVP", "Victory", "Attack" or "HS" in it
 * never reached the chat's prompt, read by the capital rule as naming
 * someone; a reply's "I" counted as a name in the rule's log, which bench:chat
 * reads to decide whether the rule enforces; and a player who typed "Why is
 * my K/D bad?" had every sentence of the answer saying "K/D" dropped as an
 * echo of a name they typed.
 */
const REVIEW_CAPS = 'MVP|ACS|ADR|KAST|KDA|K\\/D(?:\\/A)?|HS|KPR|DPR|APR|victory|defeat|draw|attack|defen[cs]e|overtime|thrifty|flawless|clutch|ace|combat report|switch player|spectators?|spectating|buy phase|match point|round ongoing|last round before swap|sudden death|eliminated|detonated|defused|planted|ultimate|I|(?:light|heavy|regen)\\s+(?:armou?r|shields?)|melee|headshots?|credits|ADS';
const CHAT_CAPS = 'economy|eco|grades?|survival|impact|teamplay|decisions|farming|vision|objectives|pistol|VODs?|RR|MMR|ELO|DM|TDM|IGL|FPS|GG|OK';
const GAME_CAPS = new RegExp(`\\b(?:${REVIEW_CAPS}|${CHAT_CAPS})\\b`, 'gi');
/** A text with the game's own capitalised words in lower case, for the capital rule to read. */
const lowerGameWords = (text) => String(text || '').replace(GAME_CAPS, (w) => w.toLowerCase());

/*
 * THE CAPITAL RULE (name-gate.js namesSomeone), counted and never dropped
 * until bench:chat shows it drops at most 2% of sentences and catches every
 * planted name (spec 8.13). It runs on a sentence the enforced gates passed,
 * so what it finds is the rule's own.
 */
function nameHeuristic(s, facts, opts) {
  const f = facts || {};
  const ng = nameGate();
  if (!ng || typeof ng.namesSomeone !== 'function') return null;
  return ng.namesSomeone(lowerGameWords(s), { names: nameSetFor(f, opts), language: f.language || 'en' }) ? 'name-log' : null;
}

// ── Sources and the meta ───────────────────────────────────────────────────

/*
 * NO SOURCE FOR ANY ADVICE. "According to", "as (a name) says", "(a name)'s
 * video", "pro player (a name)", "watch (a name)'s stream". The player's own
 * VODs are no source: "review your own VOD", "your VODs" and "record your
 * games" pass.
 */
// The name after each must be capitalised, and the words before it may open
// the sentence: "Pro players like Brimo peek wide" passed with "pro" in lower
// case alone (the verifier's probe, 15 Oct).
const ATTRIBUTION = [
  /\baccording to\b/i,
  /\b[Aa]s [A-Z][\w.]*(?: [A-Z][\w.]*)? (?:says|said|puts it|teaches|recommends|explains|likes to say)\b/,
  /\b[A-Z][\w.]*'s (?:videos?|streams?|guides?|vods?|VODs?|channel|course|tutorials?|coaching|clips?)\b/,
  /\b[Pp]ro (?:players?|coach(?:es)?|teams?|streamers?)\s+(?:like\s+)?[A-Z]/,
  /\b[Ww]atch [A-Z][\w.]*'s\b/,
  /\b(?:[Pp]ros|[Cc]oaches|[Ss]treamers) like [A-Z]/,
];
function gateAttribution(s, facts) {
  if (facts && facts.language && facts.language !== 'en') return null;
  const t = String(s || '');
  return ATTRIBUTION.some((re) => re.test(t)) ? drop('attribution', 'your reply named a source for its advice; name no coach, player, team or video') : null;
}

/*
 * NO META. There are no pick or win rates for the patch here, so a ranking of
 * agents or a word about the meta is a claim nobody can stand behind (the
 * player's decision of 15 Oct 2026). The player's own win rate is a fact.
 */
// "Jett is the best agent on Abyss right now" ranks as surely as a tier list:
// bench:chat's stand in reply passed the list above. "Your best agent by
// grade" is the player's own number, and stays.
const META = /\b(?:meta|metas|tier lists?|pick rates?|strongest picks?|best agents? (?:right now|currently|this patch|in the game)|top picks?|nerfed|buffed|overpowered)\b|\b(?:is|are|was|were)\s+(?:the|a)\s+(?:best|strongest|top)\s+(?:agents?|picks?|duelists?|controllers?|initiators?|sentinels?|choices?)\b/i;
/*
 * A RANKING IN OTHER WORDS (the verifier's probes, 15 Oct): one agent said to
 * be better or stronger than another, an agent's tier, the highest or lowest
 * win or pick rate, the most picked, and what is strong in the current patch.
 * "Neon is better than Jett right now" and "Jett has the highest win rate on
 * Abyss" passed every word above. The agent opens its clause, so "your K/D on
 * Jett is better than on Raze", the player's own number, is no ranking; and
 * "your highest win rate", the player's own, is none either.
 */
const AGENT_RANKED = new RegExp(`(?:^|[,;:]\\s*|\\b(?:and|but|so|because|while|honestly|right now)\\s+)(?:${AGENT_ALT})\\s+(?:is|are|was|were|looks?|seems?|feels?)\\s+(?:(?:much|far|way|a lot|a bit|clearly|just|simply|probably)\\s+)?(?:better|stronger|worse|weaker)\\s+(?:than|pick|choice)\\b`, 'i');
const TIER = /\b[SABCDF][+-]?[ -]tier\b/;
const RATE_RANKED = /\b(?:highest|best|top|lowest|worst)\s+(?:win|pick|play)\s*rates?\b/i;
const MOST_PICKED = /\bmost\s+(?:picked|popular|contested)\b/i;
const PATCH_NOW = /\b(?:in|on|for)\s+(?:the\s+|this\s+)?(?:current|latest|new)\s+patch\b|\bthis patch\b/i;
/*
 * A REFUSAL NAMES NO META. The rules tell the model it has no pick or win
 * rates for the patch and to say so, and "I don't have pick rates or a tier
 * list for the current patch" was dropped for the words it refused with,
 * the question's first sentence and so its retry, while the rankings above
 * passed. A meta word is a claim only when nothing in its own clause before
 * it refuses it: a negation, "rather than", "more than any", "chase".
 */
const META_REFUSED = /\b(?:no|not|don't|do not|doesn't|does not|can't|cannot|couldn't|could not|won't|will not|wouldn't|without|never|isn't|is not|aren't|are not|wasn't|weren't|rather than|instead of|more than any|over any|beyond any|chas(?:e|ing)|ignor(?:e|ing)|forget|regardless of)\b/i;
function clauseBefore(t, at) {
  const head = t.slice(0, at);
  const cut = Math.max(head.lastIndexOf(','), head.lastIndexOf(';'), head.lastIndexOf(':'), head.lastIndexOf(' but '), head.lastIndexOf(' so '));
  return head.slice(cut + 1);
}
/*
 * League names its champions by no list this server holds, so there a
 * capitalised name said to be better than another, or the best champion, is
 * the ranking ("Ahri is better than Zed right now" and "Ahri is the best
 * champion right now" passed, the verifier's probe, 15 Oct). "Your best
 * champion by grade" is the player's own.
 */
const CHAMPION_RANKED = /(?:^|[,;:]\s*|\b(?:and|but|so|because|while|honestly|right now)\s+)[A-Z][A-Za-z']+(?:\s[A-Z][A-Za-z']+)?\s+(?:is|are|was|were|looks?|seems?|feels?)\s+(?:(?:much|far|way|a lot|a bit|clearly|just|simply|probably)\s+)?(?:better|stronger|worse|weaker)\s+than\s+[A-Z]/;
const CHAMPION_META = /\b(?:best|strongest|top)\s+champions?\b|\b(?:is|are|was|were)\s+(?:the|a)\s+(?:best|strongest|top)\s+(?:junglers?|supports?|mid ?laners?|top ?laners?|adcs?|bot ?laners?|carries)\b/i;
function gateMeta(s, facts) {
  if (facts && facts.language && facts.language !== 'en') return null;
  const t = String(s || '');
  const lol = !!(facts && facts.game === 'lol');
  const said = drop('meta', lol ? 'your reply ranked champions or named a meta, which nothing here holds'
    : 'your reply ranked agents or named a meta, which nothing here holds');
  const refused = (m) => META_REFUSED.test(clauseBefore(t, m.index));
  const own = (m) => /\byour(?:\s+own)?\s+$/i.test(t.slice(0, m.index));
  for (const m of t.matchAll(new RegExp(META.source, 'gi'))) {
    if (!refused(m)) return said;
  }
  for (const re of [AGENT_RANKED, TIER, MOST_PICKED, PATCH_NOW, ...(lol ? [CHAMPION_RANKED] : [])]) {
    const m = re.exec(t);
    if (m && !refused(m)) return said;
  }
  for (const re of [RATE_RANKED, ...(lol ? [CHAMPION_META] : [])]) {
    const m = re.exec(t);
    if (m && !refused(m) && !own(m)) return said;
  }
  return null;
}

// ── The round: its result, its label, its standing, its killer ─────────────

const NEGATION = /\b(?:didn't|did not|never|wasn't|was not|weren't|were not|not|no longer|hadn't|had not|isn't|is not)\b/i;
// A negation that governs the verb after it: within two words, no comma between.
const NEG_BEFORE = /\b(?:didn't|did not|never|wasn't|was not|weren't|were not|not|no longer|hadn't|had not|isn't|is not|don't|do not|couldn't|could not|won't)\s+(?:[a-z']+\s+){0,2}$/i;
// What a round is won or lost by, never a fight inside it. "The first" is a
// fight ("you lost the first duel") only when no "round" follows it: "you
// lost the first round" on a match whose round 1 was won passed as no claim.
const NOT_THE_ROUND = '(?!\\s+(?:(?:the|a|an|your|that|this|their|every|each)\\s+)?(?:duels?|fights?|gunfights?|1v\\d|trades?|angles?|space|control|opening|first(?!\\s+round)|aim|spike|advantage|numbers?|lead|track|man|player|teammate|crosshair|info))';
// And a round's result said as a noun ("round 5 was a loss"), or taken
// ("they took round 5"): the false premise said back as fact, in other words.
const RESULT_NOUN_LOST = /\b(?:was|were)\s+(?:a|an)\s+(?:loss|defeat)\b(?!\s+for\s+(?:them|the enemy|their team|the other team))/gi;
const RESULT_NOUN_WON = /\b(?:was|were)\s+(?:a|an)\s+(?:win|victory)\b(?!\s+for\s+(?:them|the enemy|their team|the other team))/gi;
const RESULT_VERBS = [
  [new RegExp(`\\b(?:lost|lose|losing)\\b${NOT_THE_ROUND}`, 'gi'), 'lost', 'won'],
  [new RegExp(`\\b(?:won|win|winning)\\b${NOT_THE_ROUND}|\\btook (?:the|that|this) round\\b|\\btook round \\d{1,2}\\b`, 'gi'), 'won', 'lost'],
  [RESULT_NOUN_LOST, 'lost', 'won'],
  [RESULT_NOUN_WON, 'won', 'lost'],
  [/\byou(?:'d)?\s+(?:[a-z']+\s+){0,2}?(?:died|die|were killed|got killed|went down|were the first down)\b|\b(?:killed|shot|caught|picked) you\b|\byour death\b/gi, 'died', 'survived'],
  [/\byou(?:'d)?\s+(?:[a-z']+\s+){0,2}?(?:survived|stayed alive|lived through|made it out alive)\b/gi, 'survived', 'died'],
];
const THEY_BEFORE = /\b(?:they|the enemy|the enemies|the other team|their team)\s+(?:[a-z']+\s+){0,1}$/i;

/*
 * THE MATCH'S OWN RESULT IS NO ROUND'S (bench:chat, 15 Oct). The rules ask the
 * coach to name the match the first time, with its result, and Sol did it in
 * the sentence about the round: "In the Abyss match on Jett, which you won 13
 * to 11, round 22 was an attack you lost" had its "won" read as round 22's and
 * went. That reading dropped 20 of Sol's 456 sentences and caused 6 of its 9
 * retries and both its honest lines. A result is the match's when what it is
 * said of is the match: the final score after it ("which you won 13 to 11",
 * "a win, 5 to 1"), the match or the game after it ("you won the match") or
 * before it ("the Split match you won", "the match on Jett, which you won"),
 * the match's map after it ("you won Fracture"), "overall", or, said as the
 * noun "win", the final score, a map, an agent or a mode before it ("a 13 to
 * 11 win", "the Abyss Jett win", "a 5 to 1 Swiftplay win"). A round named
 * after the verb is the round's whatever else the sentence says ("in this
 * match you lost round 5"). A claim of the match is held to the match's own
 * result, and one the record contradicts drops ("you lost the match" on a
 * Victory); never to a round's.
 */
const OBJECT_IS_ROUND = /^\s+(?:(?:the|that|this|your|their)\s+)?(?:(?:first|last|final|pistol|opening|second|next)\s+)?(?:rounds?\b|r\d{1,2}\b)|^\s+it\b/i;
const MATCH_AFTER = /^\s+(?:(?:the|that|this|your|our)\s+)?(?:whole\s+|entire\s+)?(?:match|game|series)\b(?!\s*point)|^\s+overall\b|^\s+in the end\b/i;
const SCORE_AFTER = /^\s*,?\s*(?:it\s+|them\s+|by\s+)?(\d{1,2})\s*(?:to|-)\s*(\d{1,2})\b/i;
const SCORE_BEFORE = /\b(\d{1,2})\s*(?:to|-)\s*(\d{1,2})\s+(?:[A-Za-z]+\s+){0,2}$/;
const MATCH_BEFORE = /\b(?:match|game)\s+(?:that\s+|which\s+)?(?:you|your team|we)\s+(?:[a-z]+\s+){0,2}$|\b(?:match|game)\b(?:(?!\bround\b)[^.;:]){0,50}?\b(?:which|that)\s+(?:you|your team|we)\s+(?:[a-z]+\s+){0,2}$|\b(?:the|this|that|your)\s+(?:whole\s+)?(?:match|game)\s+$/i;
const MODE_NAMES = 'Competitive|Unrated|Swiftplay|Premier|Standard|Deathmatch|Spike Rush|Escalation|Replication|Custom';
const MAP_ALT = MAPS.map(esc).sort((a, b) => b.length - a.length).join('|') || 'NO_MAP';
const NAMED_WIN_BEFORE = new RegExp(`\\b(?:[Tt]he|[Aa]n?|[Yy]our|[Tt]his|[Tt]hat|[Tt]heir)\\s+(?:(?:${MAP_ALT}|${AGENT_ALT}|${MODE_NAMES}|match|game)[\\s,]+){1,3}$`);
const MAP_AFTER = new RegExp(`^\\s+(?:on\\s+)?(${MAP_ALT})\\b`);
/*
 * And what was won is no round when it stands before the verb: "reach the
 * space you won", "the duel you lost", and "What you lost was your opening
 * fight" (bench:chat, 15 Oct: two true sentences of Sol's, dropped as round 22
 * and round 5 won and lost).
 */
const OBJECT_BEFORE = /\b(?:the|that|this|your|their|an?|every|each)\s+(?:[a-z]+\s+)?(?:space|ground|angles?|duels?|fights?|gunfights?|trades?|position|advantage|info|information|control|opening|lead|numbers?|time)\s+(?:that\s+|which\s+)?(?:you|your team|we)\s+(?:had\s+|have\s+|just\s+|already\s+)?$/i;
const CLEFT_BEFORE = /\bwhat\s+(?:you|your team)\s+(?:[a-z]+\s+)?$/i;
const CLEFT_AFTER = /^\s+(?:was|were)\s+(?:(?:the|a|an|your|their|that|this)\s+)?(?:[a-z]+\s+)?(?:duels?|fights?|gunfights?|opening|trades?|space|angles?|position|advantage)\b/i;

/** Whether a won or lost at [at, end) is said of the match: true, false, or null for a map that is another match's. */
function ofTheMatch(t, at, end, f) {
  const after = t.slice(end, end + 48);
  const before = t.slice(Math.max(0, at - 72), at);
  const fs = f && Array.isArray(f.finalScore) ? f.finalScore : null;
  const final = (sc) => !!(sc && fs && ((Number(sc[1]) === fs[0] && Number(sc[2]) === fs[1]) || (Number(sc[1]) === fs[1] && Number(sc[2]) === fs[0])));
  if (final(SCORE_AFTER.exec(after))) return true;
  if (OBJECT_IS_ROUND.test(after)) return false;
  if (MATCH_AFTER.test(after)) return true;
  const map = MAP_AFTER.exec(after);
  if (map) return f && f.map && lower(map[1]) === lower(f.map) ? true : null;
  if (MATCH_BEFORE.test(before)) return true;
  if (/^win$/i.test(t.slice(at, end)) && (final(SCORE_BEFORE.exec(before)) || NAMED_WIN_BEFORE.test(before))) return true;
  return false;
}

/**
 * What a sentence says happened to the player or the team: won, lost, died,
 * survived, each { claim, match } with match true when it is said of the
 * match, not a round (ofTheMatch). A negation reverses the verb it governs
 * and no other ("You didn't lose round 5, you won it" is two claims of a
 * win), and what the other team did is the player's opposite ("they won round
 * 5" is a loss). What was won or lost before the verb ("the space you won")
 * is no claim at all.
 */
function claimsOf(s, facts) {
  const t = straighten(s);
  const out = [];
  for (const [re, claim, opposite] of RESULT_VERBS) {
    for (const m of t.matchAll(new RegExp(re.source, re.flags))) {
      const before = t.slice(Math.max(0, m.index - 48), m.index);
      const result = claim === 'won' || claim === 'lost';
      if (result && (OBJECT_BEFORE.test(before) || (CLEFT_BEFORE.test(before) && CLEFT_AFTER.test(t.slice(m.index + m[0].length))))) continue;
      const match = result ? ofTheMatch(t, m.index, m.index + m[0].length, facts) : false;
      if (match === null) continue;
      let c = NEG_BEFORE.test(before) ? opposite : claim;
      if (result && THEY_BEFORE.test(before.replace(NEG_BEFORE, ''))) c = c === 'won' ? 'lost' : 'won';
      out.push({ claim: c, match });
    }
  }
  return out;
}
/** The claims a sentence makes of a round (claimsOf, the match's own left out), as words. */
const resultClaims = (s, facts) => claimsOf(s, facts).filter((x) => !x.match).map((x) => x.claim);
/** The claims a sentence makes of the match itself. */
const matchClaims = (s, facts) => claimsOf(s, facts).filter((x) => x.match).map((x) => x.claim);

function gateRoundResult(s, facts, rs) {
  const f = facts || {};
  if (!(f.rounds instanceof Map) || !f.rounds.size) return null;
  const named = roundsNamed(s, f);
  const bad = named.filter((n) => !f.rounds.has(n));
  if (bad.length) return drop('round', `your reply named round ${bad[0]}, which this match does not have; it has ${f.rounds.size} rounds`);
  if (!rs || !rs.round || f.language !== 'en') return null;
  for (const claim of matchClaims(s, f)) {
    if ((f.matchResult === 'won' || f.matchResult === 'lost') && claim !== f.matchResult) {
      return drop('result', `your reply said the match was ${claim}, and the record has it ${f.matchResult}`);
    }
  }
  for (const claim of resultClaims(s, f)) {
    for (const n of rs.rounds) {
      const r = f.rounds.get(n);
      if (!r) continue;
      if ((claim === 'won' || claim === 'lost') && r.result && r.result !== claim) {
        return drop('result', `your reply said round ${n} was ${claim}, and the record has it ${r.result}`);
      }
      if (claim === 'died' && r.died === false && r.verified) return drop('result', `your reply said the player died in round ${n}, and Riot's record has them surviving it`);
      if (claim === 'survived' && r.died === true) return drop('result', `your reply said the player survived round ${n}, and the record has them dying in it`);
    }
  }
  return null;
}

// "the coach calls it", "the look calls it", "labelled", "was a dry peek".
const LABELLING = /\b(?:the (?:coach|look|coach's look|review) (?:calls?|called|labels?|labell?ed|marks?|marked|counts?|counted|names?|named)(?: it| this| that| the death| your death)?(?: as)?|labell?ed(?: as)?|was (?:a|an)|counts? as|counted as|called)\s+/gi;
const FAIR = /\bfair (?:fight|duel)s?\b/i;
const NOT_FAIR = /\b(?:not|wasn't|was not|never|no|isn't|is not|hardly) (?:a |an )?(?:really |truly )?fair\b|\bunfair\b/i;

/** The cause keys a sentence gives as a label: an exact chip title, or a cause's words after a labelling phrase. */
function labelsIn(s) {
  const t = String(s || '');
  const out = new Set();
  for (const [key, titles] of Object.entries(CAUSE_TITLES)) {
    for (const title of titles) {
      if (new RegExp(`(^|[^A-Za-z])${esc(title)}(?![A-Za-z])`).test(t)) out.add(key);
    }
  }
  let m;
  const lab = new RegExp(LABELLING.source, 'gi');
  while ((m = lab.exec(t)) !== null) {
    // "The coach calls round 6 a lost duel", "labelled round 3 as an
    // overextension": the round named between the phrase and the label is
    // no reason to read past the label (the verifier's probe, 15 Oct).
    const after = lower(t.slice(m.index + m[0].length, m.index + m[0].length + 64))
      .replace(/^["'“]+/, '')
      .replace(/^(?:in\s+)?(?:round|r)\s*#?\s*\d{1,2}(?:'s death)?\s+(?:as\s+)?/, '')
      .replace(/^(?:a|an|the)\s+/, '');
    for (const [key, words] of Object.entries(CAUSE_WORDS)) {
      if (words.some((w) => after.startsWith(w))) out.add(key);
    }
  }
  return [...out];
}

function gateLabel(s, facts, rs) {
  const f = facts || {};
  if (f.language !== 'en' || !(f.rounds instanceof Map)) return null;
  const labels = labelsIn(s);
  const fair = FAIR.test(String(s || '')) && !NOT_FAIR.test(String(s || '')) && !isHypothetical(s);
  if (!labels.length && !fair) return null;
  const named = roundsNamed(s, f);
  const rounds = named.length ? named : (rs && rs.implied ? rs.rounds : (f.asked && f.oneRound ? [f.asked] : []));
  for (const n of rounds) {
    const r = f.rounds.get(n);
    if (!r) continue;
    const cause = r.look && r.look.cause ? r.look.cause : null;
    for (const key of labels) {
      if (key !== cause) {
        return drop('label', cause
          ? `your reply gave round ${n} a label its look does not have; quote only its own label`
          : `your reply labelled round ${n}, which has no label; tell what the look saw and teach its better play`);
      }
    }
    if (fair && !(r.look && r.look.cause === 'lost-duel' && r.look.fair !== false)) {
      return drop('label', `your reply called round ${n} a fair fight, which its look does not say`);
    }
  }
  return null;
}

/*
 * THE REVIEW'S TRADE WORDS (match-review.js NOT_TRADED, WAS_TRADED and
 * TRADE_AS_HARM), copied because that file does not export them; the test
 * holds the copies equal to its source.
 */
const NOT_TRADED = /\b(?:no one|nobody|no teammate|no ally|not|never)\s+(?:was\s+|were\s+|got\s+|could\s+|did\s+)?(?:able to\s+)?trad(?:e|ed|ing)\b|\buntraded\b|\bunanswered\b|\bwithout (?:a |any )?trade\b/i;
const WAS_TRADED = /\b(?:you were|you got|was|got|were) traded\b|\btraded by (?:a |your )?teammate\b/i;
const TRADE_AS_HARM = /\bget(?:s|ting)? you traded\b|\b(?:leads? to|ends? in|means) (?:you )?(?:being|getting) traded\b/i;

// And as a chat says it, which the review's words do not cover: "a teammate traded you".
// Never under a negation (bench:chat, 15 Oct): "no teammate traded you", true
// of the Abyss round 3 asked about, read as "teammate traded you" and went,
// with it the only sentence left that named Cypher as the killer.
const TRADED_YOU = /(?<!\b(?:no|not|never|nor|without)\s+(?:a\s+|an\s+|your\s+|one\s+|single\s+)?|\b(?:nobody|no one|none|neither)\s+(?:on|of|from|in)\s+(?:your\s+|the\s+)?)\b(?:a |your )?(?:teammates?|ally|allies|team)\s+(?:quickly\s+|instantly\s+|then\s+)?traded you\b/i;

const STANDING = /\b([1-5])\s*(?:against|versus|vs\.?|v|on)\s*([1-5])\b/i;
const ADVANTAGE = /\b(?:a player up|up a player|(?:man|player|numbers) advantage|numbers up|up in numbers|ahead in numbers|outnumbered them)\b/i;
const DISADVANTAGE = /\b(?:a player down|down a player|you were outnumbered|behind in numbers|down in numbers)\b/i;
const CLUTCH = /\b(?:clutch|last one (?:alive|standing)|alone against)\b/i;
const AFTER_PLANT = /\b(?:after the plant|post[ -]plant|the spike (?:was|went) (?:down|planted)|spike down|once the spike was down|after (?:the spike|it) went down)\b/i;
const FIRST_DEATH = /\b(?:first death|died first|first to die|first one to die|opening death|first player down|first one down)\b/i;
const OPENING_KILL = /\b(?:first kill|opening kill|first blood|opened the round|entry kill)\b/i;
const MATCH_POINT = /\bmatch point\b/i;
const PISTOL_CLAIM = /\bpistol round\b/i;
const ATTACK_SIDE = /\b(?:on attack|attacking|as an attacker|on the attacking side)\b/i;
const DEFENCE_SIDE = /\b(?:on defen[cs]e|defending|as a defender|on the defending side)\b/i;
const ABOUT_THEM = /\b(?:their|the enemy|the enemies|the other team)\b/i;
const THEIRS_FIRST = /\b(?:they|them|their|the enemy|the enemies|the other team|the defenders|the attackers)\b/i;

/** Whether a negation governs the words at `at`: within two words before them, no comma between (NEG_BEFORE). */
const negatedAt = (t, at) => NEG_BEFORE.test(String(t || '').slice(Math.max(0, at - 48), at));

function gateStanding(s, facts, rs) {
  const f = facts || {};
  if (!rs || !rs.round || f.language !== 'en' || !(f.rounds instanceof Map)) return null;
  const t = String(s || '');
  const neg = NEGATION.test(t);
  for (const n of rs.rounds) {
    const r = f.rounds.get(n);
    if (!r) continue;
    const say = (what) => drop('timeline', `your reply said ${what} in round ${n}, which the record of it does not have`);
    const states = r.standings || [];
    const st = STANDING.exec(t);
    if (st) {
      const a = Number(st[1]);
      const b = Number(st[2]);
      // The player's side first, as the record and the prompt say it ("4
      // against 3 standing"): "you were down 3 against 4" on a round the
      // player died 4 against 3 in passed with the numbers turned round. Only
      // a sentence about their side may count theirs first.
      const either = THEIRS_FIRST.test(t);
      if (!states.some(([m, e]) => (m === a && e === b) || (either && m === b && e === a))) return say(`${a} against ${b} standing`);
    }
    if (ADVANTAGE.test(t) && !neg && !states.some(([m, e]) => m > e)) return say('a man advantage');
    if (DISADVANTAGE.test(t) && !neg && !states.some(([m, e]) => m < e)) return say('a man disadvantage');
    if (CLUTCH.test(t) && !neg && !r.clutch) return say('a clutch');
    if (AFTER_PLANT.test(t) && !neg && !r.planted) return say('a plant');
    // Only the negation that governs it turns a first death or a first kill
    // round: in "you opened the round strong, but the team could not hold the
    // site" (bench:chat, 15 Oct) the "not" is the team's, and a round the player
    // opened with the first kill was dropped as one they never opened.
    const fd = FIRST_DEATH.exec(t);
    if (fd && r.verified) {
      const no = negatedAt(t, fd.index);
      if (no ? r.firstDeath : !r.firstDeath) return say(no ? 'no first death' : 'the first death');
    }
    const ok = OPENING_KILL.exec(t);
    if (ok && r.verified) {
      const no = negatedAt(t, ok.index);
      if (no ? r.firstKill : !r.firstKill) return say(no ? 'no first kill' : 'the first kill');
    }
    if (MATCH_POINT.test(t) && !neg && !r.matchPoint) return say('match point');
    if (PISTOL_CLAIM.test(t) && !neg && !r.pistol) return say('a pistol round');
    if (ATTACK_SIDE.test(t) && r.side === 'defending' && !ABOUT_THEM.test(t)) return say('attack');
    if (DEFENCE_SIDE.test(t) && r.side === 'attacking' && !ABOUT_THEM.test(t)) return say('defence');
    if (r.traded === true && NOT_TRADED.test(t)) return drop('timeline', `your reply said round ${n}'s death was not traded, and Riot's record has it traded`);
    if (r.traded === false && (WAS_TRADED.test(t) || TRADED_YOU.test(t))) return drop('timeline', `your reply said round ${n}'s death was traded, and Riot's record has it not traded`);
    if (TRADE_AS_HARM.test(t)) return drop('timeline', 'your reply called being traded the harm; a trade is a teammate killing your killer');
  }
  return null;
}

/*
 * WHO KILLED THE PLAYER IS RIOT'S, and who the player killed is the feed's.
 * A round tells other kills too ("their Jett killed your Sova"), so only a
 * claim about the player's own death or the player's own kill is held to
 * the record: the round's Riot killer, and the feed's victims of the player.
 * A round the screen alone saw names no killer at all.
 */
const ARTICLE = '(?:their |the enemy |an enemy |enemy |the |a |an )?';
const KILLED_YOU = new RegExp(`(?:^|[^A-Za-z0-9])${ARTICLE}(${AGENT_ALT})(?:'s [A-Za-z]+)? (?:killed|shot|got|caught|picked off|picked|beat|dropped|took out|finished) you\\b`, 'i');
const YOU_DIED_TO = new RegExp(`\\byou (?:died to|were killed by|got killed by|fell to|lost (?:the|a|your) (?:duel|fight|gunfight) to|were shot by|got picked by|were picked by) ${ARTICLE}(${AGENT_ALT})(?![A-Za-z0-9])`, 'i');
const YOU_KILLED = new RegExp(`\\byou (?:killed|shot|got|picked off|picked|dropped|took out|finished|traded) ${ARTICLE}(${AGENT_ALT})(?![A-Za-z0-9])`, 'i');

function gateKiller(s, facts, rs) {
  const f = facts || {};
  if (!rs || !rs.round || !(f.rounds instanceof Map)) return null;
  const t = String(s || '');
  const claimed = KILLED_YOU.exec(t) || YOU_DIED_TO.exec(t);
  const victim = YOU_KILLED.exec(t);
  for (const n of rs.rounds) {
    const r = f.rounds.get(n);
    if (!r) continue;
    if (claimed) {
      const who = claimed[1];
      if (!r.verified) return drop('killer', `your reply named who killed the player in round ${n}, which only Riot's record says and this round does not have`);
      if (!r.killer || lower(r.killer) !== lower(who)) {
        return drop('killer', `your reply said ${who} killed the player in round ${n}${r.killer ? `, and Riot's record has ${r.killer}` : ''}`);
      }
    }
    if (victim) {
      const who = victim[1];
      const feed = r.feed || null;
      if (!feed || !feed.some((k) => k.by === 'me' && lower(k.va) === lower(who))) {
        return drop('killer', `your reply said the player killed ${who} in round ${n}, which Riot's record of the round does not show`);
      }
    }
  }
  return null;
}

/*
 * THE MAP AND THE KIT. A round sentence names only this map's callouts
 * (death-forensics.js wrongMap). Any sentence names only the player's own
 * abilities, an agent's the player asked about, or another agent's with its
 * owner named in the sentence ("Sova's Recon Bolt"): "Press Q to Updraft" is
 * a Jett's.
 */
function gateMapAndKit(s, facts, rs) {
  const f = facts || {};
  if (f.game !== 'valorant') return null;
  const t = String(s || '');
  if (rs && rs.round && f.map) {
    let map = null;
    try { map = forensics().wrongMap(t, f.map); } catch { map = null; }
    if (map) return drop('map', `your reply named ${map}, which is no callout on ${f.map}`);
  }
  if (f.agent) {
    const allowed = new Set([lower(f.agent), ...(f.askedAgents || []).map(lower)]);
    const named = new Set(agentsIn(t).map((a) => lower(a.name)));
    for (const ab of abilitiesIn(t)) {
      if (allowed.has(lower(ab.agent)) || named.has(lower(ab.agent))) continue;
      if (KIT(f.agent).includes(lower(ab.name))) continue;
      return drop('ability', `your reply gave the player ${ab.name}, which ${f.agent} does not have`);
    }
  }
  return null;
}

/*
 * A KILL'S GUN IS RIOT'S (the feed's w, the killer's weapon), and the
 * player's own only where the feed has their kill with it that round, or the
 * round's look names it.
 */
/*
 * WHOSE GUN A SENTENCE SAYS IT IS: the player's after "your", "you had", "you
 * held" and the like, or after "with a" or "using a" in a clause whose own
 * subject is the player ("You fought Clove from beside cover with a
 * Classic"), never one where the player is killed ("Clove killed you with a
 * Classic", "you were killed by Clove with a Classic") or fights toward
 * someone named ("you lost the duel to Clove with a Classic"); the enemy's
 * after "their", "his", "her" or a possessive; else nobody's in particular.
 * Read with "with a" alone as nobody's, that Pearl round 1 sentence gave the
 * player the killer's Classic (bench:chat, 15 Oct), the only Classic the
 * round's record has.
 */
const GUN_MINE_BEFORE = /\b(?:your|you had|you held|you were holding|you bought|you used|you drew|you pulled out|you carried|you picked up)\s+(?:a |an |the )?$/;
const GUN_THEIRS_BEFORE = /(?:\btheir|\bhis|\bher|\bthe enemy's|\benemy|\bkiller's|'s)\s+$/;
const GUN_WITH_BEFORE = /\b(?:with|using)\s+(?:a|an|the|your)\s+$/i;
const YOU_KILLED_PASSIVE = /^\s*you\s+(?:were|got)\s+(?:[a-z]+\s+)?(?:killed|shot|picked|caught|beaten|dropped|finished|traded|taken out)\b/i;
const TOWARD_SOMEONE = new RegExp(`\\b(?:to|by|against|from)\\s+(?:their\\s+|the enemy\\s+|an?\\s+|the\\s+)?(?:${AGENT_ALT}|enemy|enemies|them|him|her|defenders?|attackers?)(?![A-Za-z0-9])`, 'i');
// A clause ends at a comma or a semicolon, and at a word that starts another
// one: in "you got the first kill but Cypher took you down with a Phantom" the
// Phantom is Cypher's.
const CLAUSE_START = /[,;:]|\b(?:and|but|while|when|whereas|before|after|until|then|so|because|as)\s/gi;
function playerUses(t, at) {
  const head = t.slice(0, at);
  let cut = 0;
  for (const m of head.matchAll(CLAUSE_START)) cut = m.index + m[0].length;
  const clause = head.slice(cut).replace(/^\s*(?:then|so|later|first|now)\s+/i, '');
  return GUN_WITH_BEFORE.test(clause) && /^\s*you\b/i.test(clause) && !YOU_KILLED_PASSIVE.test(clause) && !TOWARD_SOMEONE.test(clause);
}
/** 'mine', 'theirs' or null: whose a gun gunsIn() found is, as the sentence says it. */
function gunOwner(text, g) {
  const t = straighten(text);
  const before = lower(t.slice(Math.max(0, g.at - 28), g.at));
  if (GUN_MINE_BEFORE.test(before) || playerUses(t, g.at)) return 'mine';
  if (GUN_THEIRS_BEFORE.test(before)) return 'theirs';
  return null;
}

function gateWeapon(s, facts, rs) {
  const f = facts || {};
  if (!rs || !rs.round || !(f.rounds instanceof Map)) return null;
  const t = String(s || '');
  for (const g of gunsIn(t)) {
    const owner = gunOwner(t, g);
    const mine = owner === 'mine';
    const theirs = owner === 'theirs';
    for (const n of rs.rounds) {
      const r = f.rounds.get(n);
      if (!r || !r.weapons) continue;
      const w = r.weapons;
      if (mine && !w.mine.has(g.name)) return drop('weapon', `your reply gave the player a ${g.name} in round ${n}, which the record does not show`);
      if (theirs && !w.theirs.has(g.name)) return drop('weapon', `your reply gave the enemy a ${g.name} in round ${n}, which Riot's record of the round does not show`);
      if (!mine && !theirs && !w.all.has(g.name)) return drop('weapon', `your reply named a ${g.name} in round ${n}, which Riot's record of the round does not have`);
    }
  }
  return null;
}

/*
 * NO BUY, CREDIT OR DAMAGE CLAIM ABOUT A ROUND OF THIS MATCH before Phase D:
 * the record does not hold what anyone bought or the damage either way. Only
 * the round's own look said so, in its sentences or the digits it read off
 * the HUD, and a sentence may say it as the look did.
 */
// The money words only where they are money: "you bought time", "you forced
// them back", "you saved your ultimate" and "you dealt with the Raze" are no
// buy (the verifier's probes, 15 Oct, once a sentence like them about the
// asked round came to be read as one about it).
const ECONOMY = /\b(buy(?!\s+(?:time|space|a second|seconds)\b)|buys|bought(?!\s+(?:time|space|a second|seconds)\b)|buying(?!\s+(?:time|space)\b)|credits?|creds|eco|ecos|force[ -]buy|forced?(?!\s+(?:them|him|her|the|a|an|your|their|out|back|into|it|you|that|this)\b)|full[ -]buy|half[ -]buy|saved(?!\s+(?:your|the|his|her|their|an?)\s+(?!money|credits?|creds|guns?|rifles?|weapons?|round|economy|loadout)[a-z])|saving(?!\s+(?:your|the|his|her|their|an?)\s+(?!money|credits?|creds|guns?|rifles?|weapons?|round|economy|loadout)[a-z])|loadout|armou?r|shields?|damage|dmg|dealt(?!\s+with\b))\b/gi;
function econStem(w) {
  const x = lower(w);
  if (/^(?:damage|dmg|dealt)$/.test(x)) return 'damage';
  if (/^(?:armou?r|shields?)$/.test(x)) return 'armor';
  if (/^(?:credits?|creds)$/.test(x)) return 'credits';
  if (/^(?:saved|saving)$/.test(x)) return 'save';
  return 'buy';
}
/*
 * SAYING THE RECORD DOES NOT HOLD IT IS THE ANSWER THE RULES ASK FOR, and no
 * claim: "I cannot tell you what you bought, because this match's record
 * does not hold it." "You didn't buy armour" is still a claim, and drops.
 */
// "I cannot confirm from the record what gun you carried or what you bought"
// is that answer too, and went as an economy claim (bench:chat, 15 Oct).
const ECON_REFUSAL = /\b(?:record|facts|data)\b[^.]{0,60}?\b(?:does not|doesn't|do not|don't|did not|didn't|never)\s+(?:hold|show|have|say|record|keep|include|tell)\b|\b(?:can't|cannot|can not|won't|will not|couldn't|could not)\s+(?:tell|say|guess|know|see|confirm|establish)\b|\bi\s+(?:do not|don't)\s+(?:have|know|see)\b/i;
function gateEconomy(s, facts, rs) {
  const f = facts || {};
  if (!rs || !rs.round || f.language !== 'en' || !(f.rounds instanceof Map)) return null;
  if (ECON_REFUSAL.test(String(s || ''))) return null;
  const words = [...String(s || '').matchAll(new RegExp(ECONOMY.source, 'gi'))].map((m) => econStem(m[1]));
  if (!words.length) return null;
  for (const n of rs.rounds) {
    const r = f.rounds.get(n);
    const said = r && r.look ? `${r.look.what || ''} ${r.look.better || ''}` : '';
    const stems = new Set([...said.matchAll(new RegExp(ECONOMY.source, 'gi'))].map((m) => econStem(m[1])));
    for (const w of words) {
      if (!stems.has(w)) return drop('economy', `your reply said what was bought or dealt in round ${n}, which this match's record does not hold`);
    }
  }
  return null;
}

/*
 * BUY BLAME. No round lost or death explained by the buy phase, the spawn, a
 * menu or the scoreboard (the review's own rule, match-review.js BUY_BLAME).
 * A rule about buying passes: "on a full buy, take a rifle" explains nothing.
 */
const PHASE_WORDS = /\bbuy(?:ing)? phase\b|\bspawn\b|\bmenus?\b|\bscoreboard\b|\bbarriers?\b|\bcombat report\b/i;
const BLAME_WORDS = /\b(?:because|so you|which is why|that's why|why you|cost you|led to|caused|lost|lose|died|death|killed|got you|punished)\b/i;
function gateBuyBlame(s, facts) {
  if (facts && facts.language && facts.language !== 'en') return null;
  const t = String(s || '');
  return PHASE_WORDS.test(t) && BLAME_WORDS.test(t)
    ? drop('buy-blame', 'your reply blamed the buy phase, the spawn or a menu for a death or a round; nothing in the buy phase is a mistake')
    : null;
}

/*
 * COUNTS AND REPEATS ONLY AS COUNTED. "N of M", "N times", "in N rounds" only
 * as a counted entry, a pattern or a fact states them, and a claim that the
 * player did something again and again only where a counted entry or a
 * pattern says so. Advice in the present ("check the minimap every round") is
 * no claim.
 */
const TIMES = /\b(\d+) times\b/gi;
/*
 * A COUNTED LINE QUOTED IS NO CLAIM OF ITS OWN: "You got the first kill of
 * the round 8 times" is the strength's own detail, which the prompt asks the
 * model to quote, and it was dropped as a repeat nobody counted (the
 * verifier's probe, 15 Oct). A sentence whose words, up to its end, stand in
 * a counted entry's or a pattern's text (chat-prompt.js factsOf counted.texts)
 * says what was counted.
 */
function quotesCounted(dt, counted) {
  const core = lower(dt).replace(/[.!?]+\s*$/, '').replace(/\s+/g, ' ').trim();
  if (core.length < 12) return false;
  return ((counted && counted.texts) || []).some((x) => x && x.includes(core));
}
const IN_ROUNDS = /\bin (\d+) (?:of (?:the |your )?)?rounds\b/gi;
const PAST_YOU = /\byou(?:'ve)?\s+(?:\w+ly\s+)?(?:\w+ed|were|was|had|did|kept|got|went|took|ran|held|fell|lost|won|died|stood|swung)\b/i;
function gateCount(s, facts) {
  const f = facts || {};
  if (f.language !== 'en') return null;
  const t = String(s || '');
  const counted = f.counted || {};
  const pairsOk = counted.pairs || new Set();
  const countsOk = counted.counts || new Set();
  let pairs = [];
  try { pairs = review().countPairs(digitsOf(t)); } catch { pairs = []; }
  for (const p of pairs) {
    if (!pairsOk.has(p)) return drop('count', `your reply said ${p.replace('/', ' of ')}, which no count in the facts states`);
  }
  const dt = digitsOf(t);
  // "You died 21 times" with the scoreline's 21 deaths is the scoreline, no
  // count or repeat of its own: the plainest true sentence of a match was
  // dropped (the verifier's probe, 15 Oct). chat-prompt.js factsOf gives `died`.
  const scoreDeaths = fin(counted.died) ? new RegExp(`\\byou\\s+(?:only\\s+)?died\\s+${counted.died}\\s+times\\b`, 'gi') : null;
  const repeatText = scoreDeaths ? dt.replace(scoreDeaths, 'you died') : dt;
  for (const re of [TIMES, IN_ROUNDS]) {
    for (const m of repeatText.matchAll(new RegExp(re.source, 'gi'))) {
      if (!countsOk.has(Number(m[1]))) return drop('count', `your reply said ${m[0]}, which no count in the facts states`);
    }
  }
  let REPEAT;
  try { REPEAT = review().REPEAT_WORDS; } catch { REPEAT = /\b(?:repeatedly|again and again|kept|every round|each round|over and over|always|constantly)\b/i; }
  if (!isInstruction(t) && !isHypothetical(t) && REPEAT.test(repeatText) && PAST_YOU.test(t) && !quotesCounted(dt, counted)) {
    const named = roundsNamed(t, f);
    const ok = pairs.some((p) => pairsOk.has(p))
      || (named.length >= 2 && (counted.roundSets || []).some((set) => named.every((n) => set.includes(n))))
      || (counted.titles || []).some((title) => title && lower(t).includes(title))
      || repeekSaid(t, repeatText, REPEAT, named.length ? named : (f.asked && f.oneRound ? [f.asked] : []), f);
    if (!ok) return drop('count', 'your reply said the player did something again and again, which no counted mistake or pattern says');
  }
  return null;
}
/*
 * A REPEEK IS ONE PEEK AGAIN, INSIDE ITS ROUND: "you peeked the same A Main
 * angle again after being seen" of a round whose look is labelled repeek is
 * that label in words, no repeat across the match (bench:chat, 15 Oct: Sol's
 * Fracture round 2 answer lost the sentence, and with it the support of its
 * "Yes."). Only "again", said with a peek, of rounds that are all repeeks.
 */
const PEEK_AGAIN = /\b(?:re-?)?peek(?:ed|ing|s)?\b[^.;]{0,48}\bagain\b/i;
function repeekSaid(t, repeatText, REPEAT, rounds, f) {
  if (!PEEK_AGAIN.test(t) || !rounds.length || !(f.rounds instanceof Map)) return false;
  const words = repeatText.match(new RegExp(REPEAT.source, 'gi')) || [];
  return words.every((w) => /^again$/i.test(w))
    && rounds.every((n) => { const r = f.rounds.get(n); return !!(r && r.look && r.look.cause === 'repeek'); });
}

/** A clock written m:ss, about the match, reads as the time left. */
const CLOCK = /\b\d{1,2}:\d{2}\b/;
function gateTimeFormat(s, facts, rs) {
  const f = facts || {};
  const about = (rs && rs.round) || (f.asked && !isInstruction(s) && !isHypothetical(s));
  return about && CLOCK.test(String(s || ''))
    ? drop('time', 'your reply wrote a time as a clock such as 0:08; write seconds into the round, such as 8 s in')
    : null;
}

// ── Numbers ────────────────────────────────────────────────────────────────

const NUMBER_WORDS = { zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18,
  nineteen: 19, twenty: 20, thirty: 30, forty: 40, fifty: 50 };
const UNIT_NOUNS = 'hits?|shots?|bullets?|taps?|headshots?|bodyshots?|seconds?|secs?|metres?|meters?|kills?|deaths?|assists?|rounds?|points?|credits?|players?|teammates?|allies|enemies|opponents|times|matches|games|pellets?|minutes?|sessions?|reps?';
const SPELLED = new RegExp(`\\b(${Object.keys(NUMBER_WORDS).join('|')})(?:[ -](one|two|three|four|five|six|seven|eight|nine))?((?:\\s+(?:more|clean|quick|straight|body|head|leg|extra|full|left))*\\s+(?:${UNIT_NOUNS}))\\b`, 'gi');
const ONE_TAP = /\b(?:a\s+)?one[ -]?taps?\b/gi;
const HEAD_SHOT = /\bhead ?shots?\b/gi;
const BODY_SHOT = /\bbody ?shots?\b/gi;
const LEG_SHOT = /\bleg ?shots?\b/gi;
const TWICE = /\btwice\b/gi;
const ONCE_HIT = /\b(hit|hits|shoot|shot|tap|taps|land|landed)(\s+(?:him|her|them|it|the enemy|someone))?\s+once\b/gi;

/**
 * Spelled numbers and hit words as digits ("two body shots" is "2 body
 * hits", "one tap" is "1 head hit", "twice" is "2 times"), and a thousand
 * written 3,900 as 3900. Only before a unit: "one burst", "one of your
 * teammates" and "once the spike is down" stay words.
 */
function digitsOf(sentence) {
  let t = String(sentence || '');
  t = t.replace(/(\d),(\d{3})\b/g, '$1$2');
  t = t.replace(ONE_TAP, '1 head hit');
  t = t.replace(SPELLED, (all, a, b, rest) => `${NUMBER_WORDS[lower(a)] + (b ? NUMBER_WORDS[lower(b)] : 0)}${rest}`);
  t = t.replace(HEAD_SHOT, (w) => (/s$/i.test(w) ? 'head hits' : 'head hit'));
  t = t.replace(BODY_SHOT, (w) => (/s$/i.test(w) ? 'body hits' : 'body hit'));
  t = t.replace(LEG_SHOT, (w) => (/s$/i.test(w) ? 'leg hits' : 'leg hit'));
  t = t.replace(TWICE, '2 times');
  t = t.replace(ONCE_HIT, (all, v, who) => `${v}${who || ''} 1 times`);
  return t;
}

// What a number is about: the words after it first, in this order, then the words before it.
const AFTER_UNITS = [
  [/^\s*(?:%|percent\b)/i, 'percent'],
  [/^\s*(?:shots? (?:a|per) second|rounds? (?:a|per) second|bullets? (?:a|per) second)\b/i, 'rate'],
  [/^\s*(?:-?round magazine|rounds? in (?:the|its|a) (?:magazine|mag)|bullets? in (?:the|its|a) (?:magazine|mag)|round mag)\b/i, 'magazine'],
  [/^\s*(?:s|secs?|seconds?)\b/i, 'seconds'],
  [/^\s*(?:m|metres?|meters?)\b/i, 'metres'],
  [/^\s*(?:credits?|creds)\b/i, 'credits'],
  [/^\s*(?:damage|dmg)\b/i, 'damage'],
  [/^\s*(?:to the|in the|on the)\s+(?:head|body|legs?|chest)\b/i, 'damage'],
  [/^\s*(?:head|body|leg)\s+(?:hits?|shots?|bullets?|taps?)\b/i, 'hits'],
  [/^\s*(?:hits?|shots?|bullets?|taps?)\b/i, 'hits'],
  [/^\s*(?:health|hp)\b/i, 'health'],
  [/^\s*(?:armou?r|shields?)\b/i, 'armor'],
  [/^\s*(?:ult(?:imate)?\s+)?points?\b/i, 'points'],
  [/^\s*pellets?\b/i, 'pellets'],
  [/^\s*degrees?\b/i, 'degrees'],
  [/^\s*kills?\b/i, 'kills'],
  [/^\s*deaths?\b/i, 'deaths'],
  [/^\s*assists?\b/i, 'assists'],
  [/^\s*rounds?\b/i, 'rounds'],
  [/^\s*(?:matches|games)\b/i, 'matches'],
  [/^\s*times\b/i, 'times'],
  [/^\s*(?:players?|teammates?|allies|enemies|opponents|attackers|defenders)\b/i, 'players'],
  [/^\s*(?:minutes?|hours?|days?|sessions?|reps?|repetitions?)\b/i, 'practice'],
  [/^\s*(?:acs|combat score)\b/i, 'acs'],
  // "a 1.48 K/D" (the verifier's probe, 15 Oct): the ratio after its number.
  [/^\s*(?:k\/d|kd)(?![a-z])/i, 'kd'],
  [/^\s*adr\b/i, 'adr'],
  // League's own: the creep score, the vision score and the level.
  [/^\s*(?:cs|creep score|minions?)\b/i, 'cs'],
  [/^\s*vision(?: score)?\b/i, 'vision'],
];
// A stat may name where it was before its number: "your K/D in this match was
// 1.48" was a number tied to nothing (the verifier's probe, 15 Oct).
const BEFORE_UNITS = [
  [/\b(?:k\/d|kd|k\/d ratio)(?: (?:in|on|for|over|across) (?:this|that|the|your) (?:match|game|half|map))?(?: of| was| is| at)?\s*$/i, 'kd'],
  [/\b(?:acs|combat score)(?: (?:in|on|for|over|across) (?:this|that|the|your) (?:match|game|half|map))?(?: of| was| is| at| a round of)?\s*$/i, 'acs'],
  [/\b(?:adr|damage a round|damage per round)(?: (?:in|on|for|over|across) (?:this|that|the|your) (?:match|game|half|map))?(?: of| was| is| at)?\s*$/i, 'adr'],
  [/\b(?:grade|graded|scored|score of|overall|survival|impact|teamplay|decisions|farming|vision|objectives)(?: (?:for|in|on|of|over) (?:this|that|the|your) (?:match|game|half|map))?(?: of| was| is| at| a| an)?\s*$/i, 'grade'],
  [/\b(?:costs?|price of|priced at|pays|paid|buys? for|worth)\s*$/i, 'credits'],
  [/\b(?:head|body|leg)\s+(?:hits?|shots?)\s+(?:do|does|deal|deals)\s*$/i, 'damage'],
  [/\b(?:deals?|does|did)\s*$/i, 'damage?'],
  [/\bfor\s*$/i, 'for?'],
  [/\b(?:win rate|winrate)(?: of| was| is| at)?\s*$/i, 'percent?'],
  [/\b(?:headshot|hs)(?: rate| percentage)?(?: of| was| is| at)?\s*$/i, 'percent?'],
];

const ARMOR_NAMED = [
  [/\b(?:no armou?r|unarmou?red|without armou?r|no shields?)\b/i, 'none'],
  [/\b(?:light armou?r|light shields?|half shields?)\b/i, 'Light Armor'],
  [/\b(?:heavy armou?r|heavy shields?|full shields?)\b/i, 'Heavy Armor'],
  [/\bregen shield\b/i, 'Regen Shield'],
];
const PART_NAMED = [[/\bhead\b/i, 'head'], [/\bbody\b|\bchest\b|\btorso\b/i, 'body'], [/\blegs?\b/i, 'legs']];
function partOf(text) {
  for (const [re, part] of PART_NAMED) if (re.test(String(text || ''))) return part;
  return null;
}
const RULE_SECONDS = /\b(?:spike|plant|plants|planting|defuse|defusing|detonat\w*|explod\w*|timer|beeps?|buy phase|barriers?|round lasts|trade window|within)\b/i;

/** Where a number sits: its clause, the words just after it and just before. */
function around(t, at, len) {
  const start = Math.max(t.lastIndexOf(',', at), t.lastIndexOf(';', at)) + 1;
  const ends = [',', ';'].map((c) => t.indexOf(c, at + len)).filter((i) => i >= 0);
  const end = ends.length ? Math.min(...ends) : t.length;
  return { clause: t.slice(start, end), after: t.slice(at + len, at + len + 48), before: t.slice(Math.max(0, at - 40), at) };
}

/** The attribute a number is about, or null when nothing ties it to one. */
function attributeOf(t, at, len) {
  const { after, before, clause } = around(t, at, len);
  for (const [re, attr] of AFTER_UNITS) if (re.test(after)) return attr;
  for (const [re, attr] of BEFORE_UNITS) {
    if (!re.test(before)) continue;
    if (attr === 'for?') {
      if (/\b(?:head|body|legs?|hits?|damage|shots?)\b/i.test(clause)) return 'damage';
      if (/\b(?:buy|bought|costs?|price|credits?|pays?)\b/i.test(clause)) return 'credits';
      return null;
    }
    return attr;
  }
  return null;
}

/** The game subjects of a number: its clause's, else its sentence's. */
function subjectsNear(t, clause) {
  const scope = (text) => [
    ...gunsIn(text).map((g) => ({ kind: 'gun', name: g.name })),
    ...GEAR.filter((g) => new RegExp(`\\b${esc(g)}\\b`, 'i').test(text)).map((g) => ({ kind: 'gear', name: g })),
    ...agentsIn(text).map((a) => ({ kind: 'agent', name: a.name })),
    ...abilitiesIn(text).map((a) => ({ kind: 'ability', name: a.name, agent: a.agent })),
  ];
  const inClause = scope(clause);
  return inClause.length ? inClause : scope(t);
}

/** Which band of a gun a sentence names: "inside 30 m", "past 30 m", "at 40 metres", "close", "long range". */
function bandNamed(t) {
  const m = /\b(?:inside|within|under|up to|closer than)\s+(\d+)\s*(?:m|metres?|meters?)\b/i.exec(t);
  if (m) return { upTo: Number(m[1]) };
  const p = /\b(?:past|beyond|over|farther than|further than|more than)\s+(\d+)\s*(?:m|metres?|meters?)\b/i.exec(t);
  if (p) return { from: Number(p[1]) };
  const a = /\bat\s+(\d+)\s*(?:m|metres?|meters?)\b/i.exec(t);
  if (a) return { at: Number(a[1]) };
  if (/\b(?:long range|at range|across (?:the|a) site|far away|from far)\b/i.test(t)) return { far: true };
  if (/\b(?:close range|up close|close quarters|point blank)\b/i.test(t)) return { near: true };
  return null;
}

/*
 * A HITS TO KILL CLAIM is checked at the band and armour it names, otherwise
 * at the closest band against every armour, unless the facts give the armour.
 * "Two body shots kill an unarmoured player with a Sheriff" holds; "two body
 * shots kill through Heavy Armor" does not, and neither does the bare "two
 * body shots kill", which is false against Light and Heavy.
 */
function hitsOk(prov, value, subjects, ctx) {
  const guns = subjects.filter((s) => s.kind === 'gun').map((s) => lower(s.name));
  if (!guns.length) return false;
  const part = partOf(ctx.clause) || partOf(ctx.sentence);
  let armor = null;
  for (const [re, a] of ARMOR_NAMED) if (re.test(ctx.sentence)) { armor = a; break; }
  if (!armor && ctx.armor) armor = ctx.armor;
  const band = bandNamed(ctx.sentence);
  for (const gun of guns) {
    const rows = prov.filter((e) => e.attribute === 'hits' && lower(e.subject) === gun);
    if (!rows.length) continue;
    const bands = [...new Map(rows.filter((e) => e.band).map((e) => [`${e.band.from}-${e.band.to}`, e.band])).values()]
      .sort((a, b) => a.from - b.from);
    let pick = bands[0] || null;
    if (band && bands.length) {
      if (band.upTo !== undefined) pick = bands.find((b) => band.upTo <= b.to + 1e-9) || bands[bands.length - 1];
      else if (band.from !== undefined) pick = bands.find((b) => b.from >= band.from - 1e-9) || bands[bands.length - 1];
      else if (band.at !== undefined) pick = bands.find((b) => band.at >= b.from && band.at < b.to) || bands[bands.length - 1];
      else if (band.far) pick = bands[bands.length - 1];
    }
    const inBand = rows.filter((e) => !pick || !e.band || (e.band.from === pick.from && e.band.to === pick.to));
    for (const p of part ? [part] : ['head', 'body', 'legs']) {
      const forPart = inBand.filter((e) => (e.part || 'body') === p);
      if (!forPart.length) continue;
      if (armor) {
        const row = forPart.find((e) => (e.armor || 'none') === armor);
        if (row && row.value === value) return true;
      } else {
        const vals = ['none', 'Light Armor', 'Heavy Armor'].map((a) => (forPart.find((e) => (e.armor || 'none') === a) || {}).value);
        if (vals.every((v) => v === value)) return true;
      }
    }
  }
  return false;
}

/** Whether a game number is one of the primer's, for this subject and attribute. */
function primerHas(facts, attr, value, subjects, ctx) {
  const prov = (facts && facts.primer) || [];
  if (!prov.length) return false;
  if (attr === 'hits') return hitsOk(prov, value, subjects, ctx);
  const names = new Set(subjects.map((s) => lower(s.name)));
  const clause = lower(ctx.clause);
  const sentence = lower(ctx.sentence);
  const valueOk = (e) => near(e.value, value, 1e-6) || near(e.shown, value, 1e-6)
    || (attr === 'damage' && fin(e.value) && Math.floor(e.value + 1e-9) === value);
  const subjectOk = (e) => {
    if (e.subject && names.has(lower(e.subject))) return true;
    if (e.subjectKind && e.subjectKind !== 'rule') return false;
    return (e.words || []).some((w) => w && (clause.includes(lower(w)) || sentence.includes(lower(w))));
  };
  if (attr === 'metres') {
    const bounds = prov.filter((e) => (e.band && (e.band.from === value || e.band.to === value)) || (e.attribute === 'metres' && near(e.value, value, 1e-6)));
    if (!bounds.length) return false;
    const guns = subjects.filter((s) => s.kind === 'gun');
    return !guns.length || bounds.some((e) => !e.subject || names.has(lower(e.subject)));
  }
  const wanted = attr === 'damage' ? ['head', 'body', 'legs', 'damage'] : attr === 'credits' ? ['credits', 'price'] : [attr];
  const part = attr === 'damage' ? (partOf(ctx.clause) || partOf(ctx.sentence)) : null;
  const hits = prov.filter((e) => wanted.includes(e.attribute) && valueOk(e) && (!part || e.attribute === 'damage' || e.attribute === part));
  if (!hits.length) return false;
  if (hits.some(subjectOk)) return true;
  // A rule's number the primer gave no words for: the attribute and value
  // alone, and only with no gun, gear, agent or ability in the sentence.
  return !subjects.length && hits.some((e) => (!e.subjectKind || e.subjectKind === 'rule') && !(e.words && e.words.length));
}

// What a counted number with no unit of its own ("in 4 rounds", "20 of your
// 21") may stand for: a count, never a time, a distance or a game number.
const COUNTS = new Set(['kills', 'deaths', 'assists', 'rounds', 'times', 'matches', 'players', 'percent', 'grade', 'count', 'acs', 'adr', 'kd']);

/** Whether a match number is one of the facts, for this attribute and round. */
function matchHas(facts, attr, value, rounds) {
  const f = facts || {};
  const tol = attr === 'seconds' ? 1 : (attr === 'kd' || attr === 'rate') ? 0.005 : 0;
  if ((f.numbers || []).some((x) => ((x.attr === attr && near(x.value, value, tol)) || (x.attr === '*' && COUNTS.has(attr) && x.value === value))
      && (!rounds.length || x.round == null || rounds.includes(x.round)))) return true;
  if (f.rounds instanceof Map) {
    for (const n of rounds.length ? rounds : [...f.rounds.keys()]) {
      const r = f.rounds.get(n);
      if (!r) continue;
      if (attr === 'seconds' && (r.times || []).some((sec) => near(sec, value, 1))) return true;
      if (attr === 'kills' && r.kills === value) return true;
      if (attr === 'players' && (r.standings || []).some(([m, e]) => m === value || e === value || m - 1 === value)) return true;
      if ((r.lookDigits || []).some((d) => d.value === value && (!d.unit || d.unit === attr))) return true;
    }
  }
  return false;
}

/** Every fact's value, for a number read outside English by its digits alone: the named rounds' when a round is named. */
function anyValue(facts, value, unit, rounds) {
  const f = facts || {};
  const only = Array.isArray(rounds) && rounds.length ? new Set(rounds) : null;
  const attr = unit === 's' ? 'seconds' : unit === 'm' ? 'metres' : unit === '%' ? 'percent' : null;
  if ((f.primer || []).some((e) => (!attr || e.attribute === attr || (attr === 'metres' && e.band))
      && (near(e.value, value, 1e-6) || near(e.shown, value, 1e-6) || (fin(e.value) && Math.floor(e.value + 1e-9) === value)
        || (e.band && (e.band.from === value || e.band.to === value))))) return true;
  if ((f.numbers || []).some((x) => (attr ? (x.attr === attr && near(x.value, value, attr === 'seconds' ? 1 : 0))
    : x.value === value))) return true;
  if (f.rounds instanceof Map) {
    if (!attr && f.rounds.has(value)) return true;
    for (const r of f.rounds.values()) {
      if (only && !only.has(r.n)) continue;
      if ((!attr || attr === 'seconds') && (r.times || []).some((sec) => near(sec, value, 1))) return true;
      if (!attr && (r.kills === value || (r.standings || []).some(([m, e]) => m === value || e === value))) return true;
      if ((r.lookDigits || []).some((d) => d.value === value)) return true;
    }
  }
  return (f.scores || []).some(([a, b]) => a === value || b === value) || (f.days || []).includes(value);
}

// A round's number, a standing, a score, a count pair, a date, an ordinal:
// another gate's, or no claim.
const SKIP_BEFORE = /\b(?:rounds?\s*#?|R)\s*$/i;
const ROUND_RUN = /\brounds?\s+(?:\d+\s*(?:,\s*(?:and\s+|or\s+)?|\s+and\s+|\s+or\s+|\s+to\s+|\s+through\s+|\s*-\s*))+$/i;
const MONTH_AFTER = /^\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\b/i;
const MONTH_BEFORE = /\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+$/i;
const NUMBER = /(?<![\d.:/#])(\d+(?:\.\d+)?)(?![\d:]|\.\d)/g;
// A time into the round ("18 s in", "18 seconds into the round"), a clause
// saying the player died, another event beside it, and the player's own count.
const ABS_TIME = /^\s*(?:s|secs?|seconds?)\s+(?:in|into)\b/i;
const DEATH_CLAIM = /\byou(?:'d)?\s+(?:[a-z']+\s+){0,2}?(?:died|were killed|got killed|went down)\b|\b(?:killed|shot|caught|picked|got|dropped|finished) you\b|\byour death\b/i;
const OTHER_EVENT = /\b(?:your\s+(?:[a-z]+\s+)?kills?|you\s+(?:killed|got\s+(?:[a-z]+\s+)?kills?|traded|planted|defused)|plant(?:ed|ing)?|spike|defus\w*|trad(?:e|ed|ing)|teammates?)\b/i;
const OWN_COUNT_BEFORE = /\byou(?:'d)?\s+(?:[\w']+\s+){0,4}$/i;

/**
 * EVERY NUMBER IS TIED TO WHAT IT IS ABOUT AND CHECKED AS THAT. A game number
 * (damage, hits to kill, a price, a timer, a range, a fire rate) against the
 * primer's provenance for its gun, gear, agent, ability or rule; a match
 * number (a time into the round, a kill count, the numbers standing, a
 * grade, a scoreline) against the match's facts, the derived numbers and the
 * round's look digits. A number tied to nothing is dropped, but for a
 * practice amount, a number of players or a short wait in an instruction,
 * which claims nothing about the game or the match.
 */
function gateNumbers(s, facts, rs) {
  const f = facts || {};
  const raw = String(s || '');
  const t = digitsOf(raw);
  const english = (f.language || 'en') === 'en';
  const rounds = rs && rs.rounds ? rs.rounds : (f.asked && f.oneRound ? [f.asked] : []);
  const instruction = isInstruction(raw) || isHypothetical(raw);
  const fail = (said) => drop('number', `your reply said ${said}, which the facts do not hold`);
  // A clock outside a round sentence, as its seconds (a round sentence's is the time gate's).
  for (const m of t.matchAll(/\b(\d{1,2}):(\d{2})\b/g)) {
    const secs = Number(m[1]) * 60 + Number(m[2]);
    if (!primerHas(f, 'seconds', secs, [], { clause: t, sentence: t }) && !matchHas(f, 'seconds', secs, rounds)) return fail(m[0]);
  }
  for (const m of t.matchAll(NUMBER)) {
    const value = Number(m[1]);
    const at = m.index;
    const len = m[1].length;
    const before = t.slice(Math.max(0, at - 30), at);
    const after = t.slice(at + len, at + len + 30);
    if (SKIP_BEFORE.test(before) || ROUND_RUN.test(t.slice(Math.max(0, at - 60), at))) continue;
    if (/^(?:st|nd|rd|th)\b/i.test(after)) continue;
    if (MONTH_AFTER.test(after) || MONTH_BEFORE.test(before)) {
      if ((f.days || []).includes(value)) continue;
      return fail(`a date on the ${value}th, which is no match's`);
    }
    if (/^\s*(?:against|versus|vs\.?|v|on)\s*[1-5]\b/i.test(after) || /\b[1-5]\s*(?:against|versus|vs\.?|v|on)\s*$/i.test(before)
        || /^v\d/i.test(after) || /\dv$/i.test(before)) continue;
    if (/^\s*(?:out\s+)?of\s+(?:the\s+|your\s+|their\s+)?\d/i.test(after) || /\b\d+\s+(?:out\s+)?of\s+(?:the\s+|your\s+|their\s+)?$/i.test(before)) continue;
    // "You went 31 and 21": the scoreline's kills and deaths, as the review
    // writes them, was two numbers tied to nothing (the verifier's probe).
    const went = /\bwent\s+$/i.test(before) ? /^\s+and\s+(\d+)\b/.exec(after) : null;
    const wentBefore = /\bwent\s+(\d+)\s+and\s+$/i.exec(before);
    if (went || wentBefore) {
      const k = went ? value : Number(wentBefore[1]);
      const d = went ? Number(went[1]) : value;
      const has = (attr, v) => (f.numbers || []).some((x) => x.attr === attr && x.value === v && x.round == null);
      if (has('kills', k) && has('deaths', d)) continue;
      return fail(`${k} kills and ${d} deaths, which is no scoreline of this match`);
    }
    const pair = /^\s*(?:to|-)\s*(\d{1,2})\b/.exec(after);
    const prev = /\b(\d{1,2})\s*(?:to|-)\s*$/.exec(before);
    if (pair || prev) {
      const a = pair ? value : Number(prev[1]);
      const b = pair ? Number(pair[1]) : value;
      if ((f.scores || []).some(([x, y]) => (x === a && y === b) || (x === b && y === a))) continue;
      const unitAfter = /^\s*(?:to|-)\s*\d+\s*(m|metres?|meters?|s|secs?|seconds?)\b/i.exec(after) || /^\s*(m|metres?|meters?|s|secs?|seconds?)\b/i.exec(after);
      if (unitAfter) {
        const unit = /^m/i.test(unitAfter[1]) ? 'metres' : 'seconds';
        const ctx = { ...around(t, at, len), sentence: t };
        if (primerHas(f, unit, value, subjectsNear(t, ctx.clause), ctx) || matchHas(f, unit, value, rounds)) continue;
        if (instruction) continue;
        return fail(`${value} ${unit}`);
      }
      if (!english) continue;
      return fail(`${a} to ${b}, which is no score of this match`);
    }
    if (!english) {
      const unit = /^\s*(s|m|%)(?![A-Za-z])/.exec(after);
      if (anyValue(f, value, unit ? unit[1] : null, rounds)) continue;
      return fail(m[1]);
    }
    let attr = attributeOf(t, at, len);
    const ctx = { ...around(t, at, len), sentence: t, armor: f.armor || null };
    const subjects = subjectsNear(t, ctx.clause);
    if (attr === 'damage?') attr = subjects.some((x) => x.kind === 'gun') || /\b(?:head|body|legs?)\b/i.test(ctx.clause) ? 'damage' : null;
    if (attr === 'percent?') attr = null;
    if (attr === 'times' && /\b(?:hit|hits|shot|shoot|tap|taps|bullet)\b/i.test(ctx.clause)) attr = 'hits';
    // "You died 4 times" is a count of deaths, the scoreline's.
    else if (attr === 'times' && /\b(?:died|were killed|got killed)\s+$/i.test(before)) attr = 'deaths';
    if (attr === 'rounds' && subjects.some((x) => x.kind === 'gun') && /\b(?:magazine|mag|clip)\b/i.test(t)) attr = 'magazine';
    if (!attr) {
      if (instruction && value <= 10 && /^\s*(?:more\s+)?(?:\w+\s+)?(?:deathmatch(?:es)?|games?|matches|reps?|rounds?)\b/i.test(after)) continue;
      return fail(`${m[1]} with nothing the facts tie it to`);
    }
    if (attr === 'practice' && instruction) continue;
    if (instruction && ((attr === 'players' && value <= 5) || (attr === 'kills' && value <= 5) || attr === 'metres'
        || (attr === 'seconds' && value <= 10 && !RULE_SECONDS.test(ctx.clause)))) continue;
    const ownRounds = rs && rs.round && !instruction && f.rounds instanceof Map
      ? rs.rounds.map((n) => f.rounds.get(n)).filter(Boolean) : [];
    // A DEATH'S TIME IS RIOT'S SECOND OF IT (the verifier's probe, 15 Oct):
    // "you died 25 s into the round" passed on a round the player died 18 s
    // into, for another kill's 25 s or a counted line's "first 30 seconds". A
    // time "N s in" in a clause that says the player died, and names no other
    // event, is the death's, within a second; a round Riot never timed gives
    // it none.
    if (attr === 'seconds' && ABS_TIME.test(after) && DEATH_CLAIM.test(ctx.clause) && !OTHER_EVENT.test(ctx.clause)) {
      const died = ownRounds.filter((r) => r.died);
      if (died.length) {
        if (died.some((r) => fin(r.sec) && near(r.sec, value, 1))) continue;
        return fail(`the player died ${m[1]} s into round ${died[0].n}, where ${fin(died[0].sec) ? `Riot's record has ${Math.round(died[0].sec)} s` : "Riot's record gives no time"}`);
      }
    }
    // A NAMED ROUND'S KILLS ARE THE PLAYER'S OWN THERE: "you got three kills
    // in round 3" passed on the player's two, for a 3 counted anywhere else.
    if (attr === 'kills' && rs && !rs.implied && OWN_COUNT_BEFORE.test(before)) {
      const counted = ownRounds.filter((r) => fin(r.kills));
      if (counted.length && counted.length === ownRounds.length) {
        if (counted.some((r) => r.kills === value)) continue;
        return fail(`${m[1]} kills in round ${counted[0].n}, where Riot's record has ${counted[0].kills}`);
      }
    }
    const game = ['damage', 'hits', 'rate', 'magazine', 'pellets', 'degrees'].includes(attr);
    const ok = game
      ? primerHas(f, attr, value, subjects, ctx) || (attr === 'damage' && matchHas(f, 'damage', value, rounds))
      : primerHas(f, attr, value, subjects, ctx) || matchHas(f, attr, value, rounds)
        || (['kills', 'deaths', 'assists', 'rounds', 'times', 'matches'].includes(attr) && !!(f.counted && f.counted.counts && f.counted.counts.has(value)));
    if (!ok) {
      const what = subjects.length ? ` for the ${subjects[0].name}` : '';
      const said = attr === 'damage' ? `${m[1]} ${partOf(ctx.clause) || ''} damage`.replace(/\s+/g, ' ') : `${m[1]} ${attr}`;
      return fail(`${said}${what}`);
    }
  }
  return null;
}

// ── All of them ────────────────────────────────────────────────────────────

/*
 * THE ORDER: names first, so a sentence with a name in it is counted as a
 * name whatever else is wrong with it, then sources and the meta, then the
 * round's facts, then the numbers.
 */
const GATES = [
  ['name', gateNames],
  ['attribution', gateAttribution],
  ['meta', gateMeta],
  ['round', gateRoundResult],
  ['label', gateLabel],
  ['killer', gateKiller],
  ['map-kit', gateMapAndKit],
  ['timeline', gateStanding],
  ['weapon', gateWeapon],
  ['buy-blame', gateBuyBlame],
  ['economy', gateEconomy],
  ['count', gateCount],
  ['time', gateTimeFormat],
  ['number', gateNumbers],
];

/**
 * One sentence through every gate.
 *
 * @param opts.nameSet  the match's own names, an object with has(text)
 * @param opts.isName   or a predicate (text) => boolean
 * @returns { drop: { gate, reason } | null, logged: ['name-log'] | [] }
 */
function check(sentence, facts, opts) {
  // Every gate reads the sentence with its quotes straightened (straighten).
  const s = straighten(sentence);
  const rs = roundSentence(s, facts);
  for (const [, gate] of GATES) {
    const out = gate(s, facts, rs, opts);
    if (out) return { drop: out, logged: [] };
  }
  const heur = nameHeuristic(s, facts, opts);
  return { drop: null, logged: heur ? [heur] : [] };
}

module.exports = {
  check, GATES,
  gateNames, nameHeuristic, gateAttribution, gateMeta, gateNumbers, gateRoundResult, gateLabel, gateKiller,
  gateMapAndKit, gateStanding, gateWeapon, gateEconomy, gateCount, gateBuyBlame, gateTimeFormat,
  roundSentence, roundsNamed, isHypothetical, isInstruction, sentencesOf, paragraphsOf, digitsOf, resultClaims,
  labelsIn, phraseHit, shapeOf, nameSetFor, gunsIn, agentsIn, abilitiesIn, partOf, bandNamed, attributeOf, hitsOk, primerHas, matchHas,
  PHRASES, CAUSE_TITLES, CAUSE_WORDS, NOT_TRADED, WAS_TRADED, TRADE_AS_HARM, TRADED_YOU, RIOT_ID, META, ATTRIBUTION,
  HYPOTHETICAL, IMPERATIVE, INSTRUCTION_WORDS, STANDING, CLOCK, ECONOMY, SPELLED, NUMBER_WORDS, LABELLING,
  KILLED_YOU, YOU_DIED_TO, YOU_KILLED, PAST_ABOUT_YOU, AFTER_UNITS, BEFORE_UNITS, ARMOR_NAMED,
  GUNS, AGENTS, MAPS, GEAR, KIT, CALLOUTS,
  // The verifier's additions of 15 Oct, each asserted in test:chatgates.
  lowerGameWords, GAME_CAPS, REVIEW_CAPS, AGENT_RANKED, TIER, RATE_RANKED, MOST_PICKED, PATCH_NOW, META_REFUSED,
  RESULT_NOUN_LOST, RESULT_NOUN_WON, YOUR_GUN_PAST, THEIRS_FIRST, ABS_TIME, DEATH_CLAIM, OTHER_EVENT, OWN_COUNT_BEFORE,
  ECON_REFUSAL, ROUND_TIMES, CHAMPION_RANKED, CHAMPION_META, quotesCounted,
  // The bench:chat run of 15 Oct, each asserted in test:chatgates.
  straighten, CURLY_SINGLE, CURLY_DOUBLE, claimsOf, matchClaims, ofTheMatch, gunOwner, playerUses,
  PISTOL_ROUND, PISTOL_DESCRIBED, PISTOL_SECOND_AFTER, ROUND_SECONDS, OBJECT_IS_ROUND, MATCH_AFTER, SCORE_AFTER, SCORE_BEFORE,
  MATCH_BEFORE, NAMED_WIN_BEFORE, MAP_AFTER, OBJECT_BEFORE, CLEFT_BEFORE, CLEFT_AFTER,
  GUN_MINE_BEFORE, GUN_THEIRS_BEFORE, GUN_WITH_BEFORE, YOU_KILLED_PASSIVE, TOWARD_SOMEONE, CLAUSE_START, PEEK_AGAIN, negatedAt,
};
