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
// What the game itself makes certain (round 8): one shots, firing on the
// move, a solo drill's frame, what only a look could see. Pure, no cycle.
const claims = require('./game-claims');
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
  // "the look called lost on the shot" (the blind audit of round 8, stream C, Pearl Iron).
  'lost-duel': ['lost the duel', 'lost duel', 'lost-duel', 'lost on the shot'],
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
// And what the player's death left (bench:chat, 23 Oct): "Your death left your
// team 4 against 5" is the standing a death left, which leftByDeath holds to
// the one after it, and it was read as about no round. So is "Your death 13 s
// in made it 4 against 5", its time between (the verifier's probe, 23 Oct).
const PAST_ABOUT_YOU = /\b(?:you|your team|your teammates?)\s+(?:were|was|had|did|didn't|got|went|took|died|peeked|stayed|held|pushed|played|lost|won|made|stood|walked|ran|swung|killed|traded|used|missed|fired|shot|tried|kept|moved|opened|survived|planted|defused|rotated|fell|left|came|saw|hit|gave|chose|decided|bought|saved|forced|spent|dealt|purchased)\b|\byou\s+(?:fought|drew|faced|challenged|contested|engaged|entered|waited|reloaded|threw)\b|\b(?:killed|shot|got|caught|picked|beat|dropped|finished|traded) you\b|\btrad(?:e|ed|ing) your death\b|\byour\s+(?:death|kills?|duel|fight|trade|plant)\s+(?:(?:at\s+)?\d+(?:\.\d+)?\s*(?:s|secs?|seconds?)\s+(?:in|into(?:\s+the\s+round)?)\s+)?(?:was|were|went|came|had|happened|didn't|wasn't|left|made|brought|put|dropped)\b/i;

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
  // nameSpared (/api/admin/chat): a sentence the soft half spared, counted
  // once here, the one place Coach v2 asks (round 8 review).
  if (names && typeof names.spares === 'function') names.spares(text);
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

/*
 * WHAT A LOOK FOUND, OF A ROUND NOBODY LOOKED AT (the blind audit of round 8,
 * stream C, Pearl 1 to 5 Iron, the Cypher answer): "the coach saw", "the look
 * found", "the coach looked at round 3" of a round with no look is a claim
 * about a look that never was. Judged in the round's own clause (scopeOf),
 * never under a negation ("the coach did not look at round 3").
 */
// "The coach found that Cypher killed you twice" is the record's fact, not a
// look's: a bare "the coach" says what a look found only by its look verbs
// (saw, called, looked at, reviewed round 3), or by "found", "says" or
// "reads" with a look's own words in its clause (LOOK_WORDS, the stream C review).
const LOOK_SEEN = /\b(?:(?:the\s+(?:coach's\s+)?looks?|its\s+look)\s+(?:(?:also|only|then)\s+)?(?:saw|sees|found|finds|showed|shows|caught|called|calls|said|says|read|reads|labell?ed|looked\s+(?:at|into))|the\s+coach\s+(?:(?:also|only|then)\s+)?(?:saw|sees|caught|called|calls|labell?ed|looked\s+(?:at|into)|(?:reviewed|examined|checked|studied)\s+(?:round|it\b|that\s+(?:death|round)|the\s+(?:death|round))))\b/i;
const LOOK_SEEN_SOFT = /\bthe\s+coach\s+(?:(?:also|only|then)\s+)?(?:found|finds|showed|shows|said|says|read|reads)\b/i;
const LOOK_WORDS = /\b(?:crosshair|position(?:ed)?|peek(?:s|ed|ing)?|angle|cover|utility|duels?|fights?|swing|swung|exposed|repeek(?:ed)?|overextend(?:ed)?|dry|frame|screen)\b/i;
function lookSeenAt(s) {
  const t = String(s || '');
  const strict = LOOK_SEEN.exec(t);
  if (strict) return strict;
  const soft = LOOK_SEEN_SOFT.exec(t);
  if (!soft) return null;
  const rest = t.slice(soft.index + soft[0].length).split(/[.;]/)[0];
  return LOOK_WORDS.test(rest) || labelsIn(rest).length ? soft : null;
}
function gateLabel(s, facts, rs) {
  const f = facts || {};
  if (f.language !== 'en' || !(f.rounds instanceof Map)) return null;
  const labels = labelsIn(s);
  const fair = FAIR.test(String(s || '')) && !NOT_FAIR.test(String(s || '')) && !isHypothetical(s);
  const seen = lookSeenAt(s);
  const lookSaid = !!seen && !negatedAt(String(s || ''), seen.index + seen[0].length) && !isHypothetical(s);
  if (!labels.length && !fair && !lookSaid) return null;
  const named = roundsNamed(s, f);
  const rounds = named.length ? named : (rs && rs.implied ? rs.rounds : (f.asked && f.oneRound ? [f.asked] : []));
  for (const n of rounds) {
    const r = f.rounds.get(n);
    if (!r) continue;
    if (lookSaid && !r.look && (named.length < 2 || lookSeenAt(scopeOf(String(s || ''), n)))) {
      return drop('label', `your reply said what the coach's look found in round ${n}, which the coach did not look at; say what a look found only of a round it looked at`);
    }
    if (!labels.length && !fair) continue;
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
 * A LABEL SAID OF THE ROUNDS BEFORE IT (the blind audit of round 8, stream C,
 * Pearl 1 to 5 Iron): "In round 3 you died at B Screen ..., and in round 5 at
 * Mid Doors ... Both were fair fights the look called lost on the shot."
 * Round 3 had no look. A sentence naming no round that opens on a word for
 * the rounds just told (both, each, all of them, they, those, these, neither)
 * is held, by gateLabel, to the two or more rounds the kept sentence before
 * it named, in its paragraph (chat-prompt.js gateReply). So is one whose
 * look or coach says it of them as its object ("The look called both of them
 * lost duels", "The coach's look found you lost both duels", the stream C
 * review, LOOK_ANAPHOR).
 */
const ROUNDS_ANAPHOR = /^\s*(?:both(?:\s+of\s+them|\s+times|\s+deaths|\s+fights|\s+rounds)?|each(?:\s+time|\s+one|\s+of\s+them)?|all\s+(?:of\s+them|two|three|four|five)|they|those|these|neither|in\s+(?:both|each|all)(?:\s+of\s+them)?|the\s+two)\b/i;
const LOOK_ANAPHOR = /\b(?:the\s+(?:coach's\s+)?looks?|the\s+coach|its\s+look)\s+(?:(?:also|only|then)\s+)?(?:saw|sees|found|finds|called|calls|labell?ed|read|reads|said|says|showed|shows|reviewed|examined|checked|looked\s+at)\s+(?:[a-z']+\s+){0,3}?(?:both|each|all\s+of\s+them|all\s+(?:two|three|four|five)|neither|them|those|these|the\s+two)\b/i;
function gateLabelAcross(prev, sentence, facts) {
  const f = facts || {};
  if (f.language !== 'en' || !(f.rounds instanceof Map)) return null;
  const s = straighten(sentence);
  if (!(ROUNDS_ANAPHOR.test(s) || LOOK_ANAPHOR.test(s)) || roundsNamed(s, f).length) return null;
  const rounds = roundsNamed(straighten(prev), f);
  if (rounds.length < 2) return null;
  return gateLabel(s, f, { round: true, rounds, implied: true });
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
// "You clutched round 1" and "you were clutching against three" are the
// player's clutch too, which the bare word missed (the verifier's probe, 23 Oct).
const CLUTCH = /\b(?:clutch(?:ed|es|ing)?|last one (?:alive|standing)|alone against)\b/i;
const AFTER_PLANT = /\b(?:after the plant|post[ -]plant|the spike (?:was|went) (?:down|planted)|spike down|once the spike was down|after (?:the spike|it) went down)\b/i;
// "where you were the first contact" (round 8, Pearl Iron) is the player's first death; "take first contact" is advice and no claim.
const FIRST_DEATH = /\b(?:first death|died first|first to die|first one to die|opening death|first player down|first one down|(?<=\byou\s+were\s+the\s+)first contact)\b/i;
const OPENING_KILL = /\b(?:first kill|opening kill|first blood|opened the round|entry kill)\b/i;
const MATCH_POINT = /\bmatch point\b/i;
const PISTOL_CLAIM = /\bpistol round\b/i;
const ATTACK_SIDE = /\b(?:on attack|attacking|as an attacker|on the attacking side)\b/i;
const DEFENCE_SIDE = /\b(?:on defen[cs]e|defending|as a defender|on the defending side)\b/i;
const ABOUT_THEM = /\b(?:their|the enemy|the enemies|the other team)\b/i;
const THEIRS_FIRST = /\b(?:they|them|their|the enemy|the enemies|the other team|the defenders|the attackers)\b/i;

/*
 * WHOSE A CLUTCH IS (bench:chat, 23 Oct). "KAY/O then killed you with a
 * Sheriff at 26 s in, leaving Skye alone against three", true of the Sunset
 * round 1 asked about, was read as a clutch of the player's, whom the record
 * has dead and in no clutch, and dropped, in two runs of three. With it went
 * the only sentence telling the player's own death, and the next one, "Skye
 * traded KAY/O a second later", then followed Phoenix's death at 24 s and read
 * as a trade at 25 s where Riot has 27 s: two of the four wrong facts the
 * panel found were the gates' own. A teammate named alone against N is that
 * teammate's situation, never the player's clutch: the numbers standing 1
 * against N, held to the record as any standing is (standingClaims). An enemy
 * alone against N is N against 1. Whose it is, is the word nearest before it
 * past the words that only carry it ("leaving", "was", "your last"): "you" is
 * the player; an agent after "their" is the enemy's and after "your" a
 * teammate's; the player's own agent is the player; any other agent is the
 * side the match's teams and kill feeds place it on (facts.sides), or either
 * side's when they place it on both or neither; "teammate" is a teammate's;
 * "you and Skye" is two of the player's side ('us', 2 against N). Anything
 * else is read as the player's, as before.
 *
 * The verifier's probe (23 Oct): "KAY/O killed you at 26 s in, and Skye was
 * left alone against three" was read as the player's clutch, the clause's own
 * "and" taken for "Skye and Phoenix", two other players; that reading needs a
 * player before the "and". And the words that carry a clutch to its owner
 * include what it was to be or do: "leaving Skye to clutch against three",
 * "Skye had to clutch", "Skye tried to clutch", "Skye won the clutch" are
 * Skye's, each read as the player's.
 */
const OWNER_CARRIES = new Set(['leaving', 'left', 'leaves', 'leave', 'was', 'were', 'is', 'be', 'being', 'been', 'stood', 'remained',
  'stayed', 'ended', 'up', 'all', 'completely', 'now', 'then', 'still', 'the', 'as', 'a', 'an', 'last', 'only', 'lone', 'single',
  'remaining', 'in', 'one', 'to', 'had', 'has', 'have', 'tried', 'try', 'trying', 'attempted', 'forced', 'needed', 'went', 'into',
  'won', 'lost', 'played', 'playing', 'took']);
const OWNER_TOKEN = /[A-Za-z0-9/']+/g;
/** 'me', 'us', 'mate', 'enemy' or 'someone': whose the clutch word at `at` is, by the words just before it. */
function clutchOwner(text, at, facts) {
  const f = facts || {};
  const toks = [...String(text || '').slice(Math.max(0, at - 80), at).matchAll(OWNER_TOKEN)].map((m) => m[0]);
  const person = (tok) => { const x = lower(tok || '').replace(/'s$/, ''); return x === 'you' || /^(?:teammates?|ally)$/.test(x) || AGENTS.some((a) => lower(a) === x); };
  for (let i = toks.length - 1, seen = 0; i >= 0 && seen < 6; i--, seen++) {
    const w = lower(toks[i]).replace(/'s$/, '');
    const before = i > 0 ? lower(toks[i - 1]) : '';
    // "You and Skye", "Skye and you": two of the player's side.
    const pair = before === 'and' && i >= 2 && person(toks[i - 2]) && (w === 'you' || lower(toks[i - 2]) === 'you');
    if (w === 'you' || w === 'yourself') return pair ? 'us' : 'me';
    const agent = AGENTS.find((a) => lower(a) === w);
    const mateWord = /^(?:teammates?|ally|allies)$/.test(w);
    if (agent || mateWord) {
      if (pair) return 'us';
      // Two other players ("Skye and Phoenix"): read as before. A clause's own
      // "and" ("you died, and Skye was left alone") joins no two players.
      if ((before === 'and' || before === 'or') && i >= 2 && person(toks[i - 2])) return 'me';
      if (/^(?:their|enemy|enemy's)$/.test(before)) return 'enemy';
      if (mateWord || before === 'your' || before === "teammate's" || lower(toks[i + 1] || '') === 'teammate') return 'mate';
      if (f.agent && lower(agent) === lower(f.agent)) return 'me';
      const sides = f.sides || {};
      const mate = !!(sides.mates && sides.mates.has(agent));
      const enemy = !!(sides.enemies && sides.enemies.has(agent));
      return mate && !enemy ? 'mate' : enemy && !mate ? 'enemy' : 'someone';
    }
    if (/^(?:enem(?:y|ies)|opponents?)$/.test(w)) return 'enemy';
    if (!OWNER_CARRIES.has(w) && !/^\d+v\d+s?$/.test(w)) return 'me';
  }
  return 'me';
}

/*
 * THE NUMBERS STANDING, EVERY WAY A SENTENCE SAYS THEM (bench:chat, 23 Oct):
 * in digits ("4 against 5"), in words ("three against five", which no gate
 * read, so a wrong one passed whatever it said) and as a teammate or an enemy
 * alone against N (clutchOwner). Each with where it stands, for the death it
 * may be said to leave (leftByDeath) and for the number gate, which leaves a
 * standing's numbers to this gate. Words only with "against" or "versus", and
 * never one against one: "a one on one duel" and "a one against one duel" are
 * a duel, no standing.
 */
const SMALL_NUMBERS = { one: 1, two: 2, three: 3, four: 4, five: 5 };
const smallOf = (w) => (/^[1-5]$/.test(String(w)) ? Number(w) : SMALL_NUMBERS[lower(w)] || null);
const STANDING_WORDS = /\b(?!one\s+(?:against|versus)\s+one\b)(one|two|three|four|five)\s+(?:against|versus)\s+(one|two|three|four|five)\b/gi;
const ALONE_AGAINST = /\balone\s+against\s+([1-5]|one|two|three|four|five)\b/gi;
/** Every standing a sentence says, in order: { a, b, at, end, either, owner }, the player's side first (a). */
function standingClaims(text, facts) {
  const t = String(text || '');
  const either = THEIRS_FIRST.test(t);
  const out = [];
  for (const m of t.matchAll(new RegExp(STANDING.source, 'gi'))) out.push({ a: Number(m[1]), b: Number(m[2]), at: m.index, end: m.index + m[0].length, either, owner: null });
  for (const m of t.matchAll(new RegExp(STANDING_WORDS.source, 'gi'))) out.push({ a: smallOf(m[1]), b: smallOf(m[2]), at: m.index, end: m.index + m[0].length, either, owner: null });
  for (const m of t.matchAll(new RegExp(ALONE_AGAINST.source, 'gi'))) {
    const owner = clutchOwner(t, m.index, facts);
    // The player alone is the clutch claim's (gateStanding), as it always was.
    if (owner === 'me') continue;
    const n = smallOf(m[1]);
    const at = m.index;
    const end = m.index + m[0].length;
    out.push(owner === 'enemy' ? { a: n, b: 1, at, end, either: false, owner }
      : owner === 'us' ? { a: 2, b: n, at, end, either: false, owner }
        : { a: 1, b: n, at, end, either: owner === 'someone', owner });
  }
  return out.sort((x, y) => x.at - y.at);
}

/*
 * A STANDING LEFT BY THE PLAYER'S DEATH IS THE ONE AFTER IT (bench:chat, 23
 * Oct). "Tejo killed you 13 s in, leaving your team 4 against 5", on the Abyss
 * swiftplay's round 2, gave the standing AT the death as the one it left, which
 * was 3 against 5, in two runs of three; the gate passed it because 4 against 5
 * is a standing the round had. A standing said to be left by, after or because
 * of the player's death is held to the standing right after it (the round's
 * `after`, chat-prompt.js factsOf), never to the round's standings as a whole:
 * a word that leaves it ("leaving", "left", "making it", "bringing it back to",
 * "putting", "down to") at most four words before it, with the player's death
 * the last thing the sentence told before that word ("Tejo killed you 13 s in,
 * leaving"), or the death after "after", "once", "following" or "because of"
 * ("After you died, your team was 3 against 5"). Another kill, death or trade
 * told between the two makes the standing that event's, held to the round's
 * standings as before: in "KAY/O killed you, and Skye traded KAY/O a second
 * later, leaving Skye alone against two" the trade left it. So does a clause
 * of its own between them: in "Viper killed you at 17 s in, and your
 * teammates later brought it to three against two" the teammates did.
 *
 * THE VERIFIER'S PROBE OF IT (23 Oct), each case pinned in test:chatgates:
 *   - A leaving verb of its own clause ("left", "made", "brought") is the
 *     death's when its subject is: none ("Tejo killed you 13 s in and left
 *     your team 4 against 5"), one standing for the death ("and that left",
 *     "; that left", "which left") or the team it left ("and your team was
 *     left 4 against 5"). The clause guard had passed all three, the run's
 *     own wrong standing in other words. A subject of its own ("and your
 *     teammates later brought it", "; your teammates brought it") is that
 *     subject's, as before, and the semicolon no longer hides one. Nor does
 *     a clause of its own with no "and" to mark it: in "After Viper killed
 *     you, your teammates pushed on, bringing it to 3 against 2" the push
 *     brought it, and the leaving word's rule had dropped it as the death's.
 *   - "Then", "after which", "after that" and "afterwards" carry the death on
 *     as a leaving word does: "Nobody traded your death, and your team was
 *     then three against five" (the run's own) told the standing after it.
 *     An event in the words after one ("then your team retook at 3 against
 *     5") or a time of its own after the standing ("after Sage fell") makes
 *     it that event's.
 *   - An after phrase that gives the death its own standing is the standing
 *     at it: "After you died at 4 against 5, your team could not retake" and
 *     "Once you went down in a 4 against 5" had been held to the one after.
 *   - The death after the standing is the one after it: "Your team played
 *     four against five after you died" (bench:chat, 15 Oct) passed. And
 *     "With you dead" or "Without you there" says after the death too.
 *   - "Got you" is the player's death only where nothing it got them follows:
 *     "Your Bandit got you the first kill, leaving it 5 against 4" is no death.
 */
const LEFT_BY = /\b(?:leaving|(?<!\bthe\s)left|leaves|making|made|makes|bringing|brought|brings|putting|put|puts|dropping|dropped|drops|cutting|down to)\b/gi;
// The words that carry the death on to what came right after it.
const CARRIES_ON = /\b(?:then|after which|after that|afterwards?)\b/gi;
const LEAVES_OR_CARRIES = new RegExp(`${LEFT_BY.source}|${CARRIES_ON.source}`, 'gi');
// A leaving word that is the verb of a clause of its own, or carries the death on: its subject decides whose the standing is.
const LEFT_FINITE = /^(?:left|leaves|made|makes|brought|brings|put|puts|dropped|drops|down to|then|after which|after that|afterwards?)$/i;
const GOT_YOU_SOMETHING = '(?!\\s+you\\s+(?:a|an|the|one|two|three|four|five|some|your|their|into|onto|out|back|through|up|free|space|time|info|value|kills?|the\\s+first)\\b)';
const PLAYER_DEATH = new RegExp(`\\byou(?:'d)?\\s+(?:[a-z']+\\s+){0,2}?(?:died|were killed|got killed|went down|fell(?!\\s+back))\\b|\\b(?:killed|shot|caught|picked|got${GOT_YOU_SOMETHING}|dropped|finished|beat|took out|picked off) you\\b|\\byour (?:own )?death\\b|\\byou were the first (?:death|one down|player down|to die)\\b`, 'gi');
// The player's death as an after phrase names it.
const DEATH_FORMS = `you(?:'d)?\\s+(?:[a-z']+\\s+){0,2}?(?:died|were killed|got killed|went down|fell(?!\\s+back))|your (?:own )?death|(?:(?:their|the enemy|an enemy|the)\\s+)?(?:${AGENT_ALT})(?:'s [A-Za-z]+)?\\s+(?:killed|shot|got${GOT_YOU_SOMETHING}|caught|picked off|picked|beat|dropped|took out|finished) you`;
// And with the player dead: "With you dead, your team was 3 against 5", "Without you there".
const AFTER_DEATH = new RegExp(`\\b(?:after|once|following|because(?:\\s+of)?)\\s+(?:${DEATH_FORMS})\\b|\\bwith you (?:dead|gone|out of the round)\\b|\\bwithout you\\b(?!\\s+[a-z]+ing\\b)`, 'gi');
// The death named after the standing it left: "four against five after you died".
const AFTER_DEATH_NEXT = new RegExp(`^\\s*(?:(?:standing|left)\\s+)?(?:(?:right|just|straight|immediately|shortly|soon)\\s+)?(?:after|once|following)\\s+(?:${DEATH_FORMS})\\b`, 'i');
// What gives the death its own standing inside an after phrase: "After you died at 4 against 5", "Once you went down in a 4 against 5".
const AT_THE_DEATH = /^\s*(?:(?:at\s+)?\d+(?:\.\d+)?\s*(?:s|secs?|seconds?)\s+(?:in|into(?:\s+the\s+round)?)\s+)?(?:at|in|with|while|during|on|when)\b(?:\s+[a-z'/]+){0,3}\s*$/i;
// A time of the standing's own after it, which makes it that event's: "then your team was 2 against 5 after Sage fell".
const DATED_LATER = /^\s*,?\s*(?:(?:right|just|shortly|soon)\s+)?(?:after|when|once|following|by the time|until)\b/i;
const EVENT_BETWEEN = /\b(?:killed|kills|died|dies|traded|trades|answered|avenged|eliminated|planted|plants|defused|fell|went down|took out|picked off|retook)\b|\b(?:[A-Za-z/]+'s|teammate's|another|a second|a third|the next)\s+(?:death|kill|trade)\b|\bthe spike\b/i;
const CLAUSE_BETWEEN = /\b(?:and|but|then|before|until|while|whereas)\b/i;
// Where a clause of its own may open between the death and a leaving verb, and the subject that verb then has when the death left the standing.
const CLAUSE_MARK = /[,;:]|\.(?!\d)|\b(?:and|but|so)\b/gi;
const DEATH_SUBJECT = /^\s*(?:(?:that|this|it|which)\s+)?(?:(?:then|also|just|only|immediately|instantly|quickly|still|in turn)\s+)*(?:(?:your team|the team|your side|your teammates|you|they)\s+(?:was|were|got)\s+(?:(?:then|also|just|only|immediately|instantly|quickly|still|now)\s+)*)?$/i;
const OTHER_TIME = /\b(?:before|until|while|whereas)\b/i;
// A clause of its own between the death and a leaving word, a subject and its verb after a clause mark: what
// it did is its own ("After Viper killed you, your teammates pushed on, bringing it to 3 against 2").
const NEW_CLAUSE = new RegExp(`(?:[,;:]|\\b(?:and|but|so|then|while|as|when|whereas)\\b)\\s*(?:(?:then|later|also|still|quickly)\\s+)?(?:(?:your|their|the|a|an|his|her|our|one|two|both)\\s+)?(?:teammates?|team|side|enemies|enemy|opponents?|allies|ally|he|she|they|we|(?:${AGENT_ALT})(?![A-Za-z0-9]))\\s+(?:(?:then|later|also|still|quickly|soon|just)\\s+)?(?:[a-z]+ed|was|were|is|are|had|has|did|went|came|got|took|made|ran|held|fought|swung|stood|kept|lost|won|left|brought|put|threw|saw|gave|hit|shot|stayed|tried)\\b`, 'i');
/** The words between the player's death, the last thing told before `at`, and `at`; null with no death there, or another event after it. */
function sinceDeath(t, at) {
  const head = t.slice(0, at);
  let last = null;
  for (const m of head.matchAll(new RegExp(PLAYER_DEATH.source, 'gi'))) last = m;
  if (!last) return null;
  const between = head.slice(last.index + last[0].length);
  return EVENT_BETWEEN.test(between) ? null : between;
}
/**
 * Whether a leaving word, `between` the death and it, is the death's: of the death's own clause, or the verb
 * of one whose subject is the death's (DEATH_SUBJECT); never with a clause of its own between (NEW_CLAUSE).
 */
function deathsWord(word, between) {
  if (!LEFT_FINITE.test(word)) return !CLAUSE_BETWEEN.test(between) && !NEW_CLAUSE.test(between);
  if (OTHER_TIME.test(between)) return false;
  let mark = null;
  for (const m of between.matchAll(new RegExp(CLAUSE_MARK.source, 'gi'))) mark = m;
  if (!mark) return true;
  const subject = between.slice(mark.index + mark[0].length);
  // "Your team then was 3 against 5": the team before a word that carries the death on.
  const team = isCarry(word) && /^\s*(?:your team|the team|your side|your teammates|you|they|it)\s*$/i.test(subject);
  return (DEATH_SUBJECT.test(subject) || team) && !NEW_CLAUSE.test(between.slice(0, mark.index));
}
const isCarry = (word) => new RegExp(`^(?:${CARRIES_ON.source})$`, 'i').test(word);
/** Whether the standing at [at, end) is said to be left by, after or because of the player's death. */
function leftByDeath(text, at, end) {
  const t = straighten(text);
  const from = Math.max(0, at - 60);
  let left = null;
  for (const m of t.slice(from, at).matchAll(new RegExp(LEAVES_OR_CARRIES.source, 'gi'))) left = m;
  if (left) {
    const where = from + left.index;
    const carries = isCarry(left[0]);
    let gap = t.slice(where + left[0].length, at);
    // "After that, your team was 3 against 5": a comma after a word that carries the death on.
    if (carries) gap = gap.replace(/^\s*,/, ' ');
    if (!/[,;:]/.test(gap) && gap.split(/\s+/).filter(Boolean).length <= 4 && !EVENT_BETWEEN.test(gap)) {
      const between = sinceDeath(t, where);
      const deaths = between !== null && deathsWord(left[0], between)
        && !(carries && Number.isInteger(end) && DATED_LATER.test(t.slice(end)) && !AFTER_DEATH_NEXT.test(t.slice(end)));
      if (deaths) return true;
      // A leaving word ties the standing to what came after the player's death told before it:
      // another event or clause there, and no after phrase makes it the death's ("After Viper
      // killed you, your teammates pushed on, bringing it to 3 against 2"). A word that only
      // carries on, or one with no such death before it ("Without you, your team was left"),
      // leaves it to the after phrase.
      if (!carries && new RegExp(PLAYER_DEATH.source, 'i').test(t.slice(0, where))) return false;
    }
  }
  const head = t.slice(0, at);
  let after = null;
  for (const m of head.matchAll(new RegExp(AFTER_DEATH.source, 'gi'))) after = m;
  if (after) {
    const between = head.slice(after.index + after[0].length);
    if (!EVENT_BETWEEN.test(between) && !CLAUSE_BETWEEN.test(between) && !AT_THE_DEATH.test(between)) return true;
  }
  return Number.isInteger(end) && AFTER_DEATH_NEXT.test(t.slice(end, end + 100));
}

/*
 * THE DEATH IN ONE SENTENCE, WHAT IT LEFT IN THE NEXT (the verifier's probe,
 * 23 Oct). "Tejo killed you 13 s in. That left your team 4 against 5." told
 * the run's wrong standing in two sentences, and the second was read as about
 * no round, so nothing held it. A sentence that opens on what the one before
 * it told and leaves a standing ("That left", "This made it", "It brought it
 * to", "Your team was left") or carries it on ("Then", "After that") holds
 * the standing the player's death left, when the sentence before it told that
 * death last, with no standing or event of its own after it (chat-prompt.js
 * gateReply), and leftByDeath reads the two as one.
 */
const LEFT_OPENER = /^(?:(?:and|so)\s*,?\s+)?(?:(?:that|this|it|which)\s+(?:(?:then|also|in turn)\s+)?(?:left|leaves|made|makes|brought|brings|put|puts|dropped|drops)\b|(?:your team|the team|your side|your teammates)\s+(?:was|were)\s+(?:then\s+)?(?:left|down to)\b|(?:then|after that|after this|afterwards?)\b)/i;
/** gateStanding's death rule across two sentences: the reason a standing the death before it left is not the one after it, or null. */
function gateLeftAcross(prev, sentence, facts) {
  const f = facts || {};
  if (f.language !== 'en' || !(f.rounds instanceof Map)) return null;
  const s = straighten(sentence).trim();
  if (!LEFT_OPENER.test(s) || isHypothetical(s) || isInstruction(s)) return null;
  const p = straighten(prev).trim();
  const rs = roundSentence(p, f);
  const rest = sinceDeath(p, p.length);
  if (!rs.round || rest === null || standingClaims(rest, f).length) return null;
  const joined = `${p} ${s}`;
  const off = p.length + 1;
  for (const n of rs.rounds) {
    const r = f.rounds.get(n);
    if (!r || !r.died || !Array.isArray(r.after)) continue;
    for (const c of standingClaims(s, f)) {
      const is = ([m, e]) => (m === c.a && e === c.b) || (c.either && m === c.b && e === c.a);
      if (!leftByDeath(joined, off + c.at, off + c.end) || is(r.after)) continue;
      const atDeath = Array.isArray(r.atDeath) ? `${r.atDeath[0]} against ${r.atDeath[1]} at the death and ` : '';
      return drop('timeline', `your reply said the player's death left ${c.a} against ${c.b} standing in round ${n}, where Riot's record has ${atDeath}${r.after[0]} against ${r.after[1]} after it`);
    }
  }
  return null;
}

/** Whether a negation governs the words at `at`: within two words before them, no comma between (NEG_BEFORE). */
const negatedAt = (t, at) => NEG_BEFORE.test(String(t || '').slice(Math.max(0, at - 48), at));

/*
 * WHOSE A FIRST DEATH OR A FIRST KILL IS (review audit, 8.7.2). Riot's
 * firstDeath and firstKill are the player's, so only the player's is held to
 * them. Round 5 of the probe, where the enemy Jett killed the player's Sova
 * first and then the player, dropped three true sentences: "your Sova died
 * first", "their Jett got the first kill on your Sova", "the enemy Jett
 * opened the round by killing your Sova". The owner is read as a clutch's is
 * (clutchOwner), past the words that only carry it to the claim ("got the",
 * "had the", "made the"); anything else stays the player's, as before. An
 * enemy's first kill ON THE PLAYER ("their Jett got the first kill on you",
 * "opened the round by killing you") is the player's first death, and held to
 * that.
 */
const FIRST_CARRIES = new Set(['got', 'get', 'gets', 'getting', 'had', 'made', 'make', 'scored', 'secured', 'took', 'take']);
function firstOwner(t, at, facts) {
  // Drop the carrying words first, so clutchOwner reads the player before them.
  let head = String(t).slice(0, at);
  for (let m = /([A-Za-z']+)\s*$/.exec(head); m && (FIRST_CARRIES.has(lower(m[1])) || /^(?:the|a|an)$/i.test(m[1]));
    m = /([A-Za-z']+)\s*$/.exec(head)) head = head.slice(0, m.index);
  return clutchOwner(head, head.length, facts);
}
const ON_YOU = /^[^.;!?]{0,20}?\b(?:on|against|by killing)\s+you\b(?!r)/i;

/*
 * A TEAMMATE TRADING OR AVENGING THE PLAYER, as a chat says it: "your Sova
 * traded your death", "a teammate avenged you". WAS_TRADED (the review's words,
 * held equal to match-review.js) and TRADED_YOU read "was traded" and "a
 * teammate traded you" only, so both were kept on a round Riot has untraded.
 * Never under a negation (negatedAt).
 */
const MATE_TRADED_YOU = new RegExp(`\\b(?:${AGENT_ALT}|teammates?|ally|allies)\\s+(?:quickly\\s+|instantly\\s+|then\\s+|immediately\\s+)?(?:traded|avenged)\\s+(?:you\\b(?!r)|your death\\b)|\\bavenged you\\b(?!r)`, 'i');
/* The player's own plant, which AFTER_PLANT did not read: "you planted the spike on A" passed on a round with no plant. */
// "No teammate traded you", "nobody avenged you": the negation before the
// teammate, which NEG_BEFORE does not read, within two words, no comma between.
const NO_ONE_BEFORE = /\b(?:no|nobody|no one|none|neither|nor|without|never|not)\s+(?:[a-z']+\s+){0,2}$/i;
const mateTradedClaim = (t) => {
  const m = MATE_TRADED_YOU.exec(t);
  return !!m && !negatedAt(t, m.index) && !NO_ONE_BEFORE.test(t.slice(Math.max(0, m.index - 48), m.index));
};
const YOU_PLANTED = /\byou\s+(?:planted|got the plant|got the spike down|got the plant down)\b/i;

/*
 * EACH ROUND'S CLAIMS IN ITS OWN CLAUSE (round 8, the Pearl Silver Cypher
 * answer of round 7). "In round 3 you died 13 s in at B Screen to his Phantom
 * on a full buy, and in round 5, the pistol round, you died 9 s in at Mid
 * Doors to his Classic." is true, and went: the pistol round of round 5 was
 * held against round 3, and three true sentences went after it. In a sentence
 * that names two rounds or more, a round's scope runs from its mention to the
 * next one, and what comes before the first mention is shared by all. A list,
 * "rounds 3 and 5" or "round 3 and round 5 were both", holds what follows it
 * to every round of it: a mention followed only by a joining word joins the
 * next. A sentence naming one round, or none, is read whole, as before.
 */
const ROUND_MENTION = /\brounds?\s+#?(\d{1,2})\b((?:\s*(?:,\s*(?:and\s+|or\s+)?|and\s+|or\s+|to\s+|through\s+)\s*\d{1,2}\b)*)/gi;
const JOIN_ONLY = /^[\s,]*(?:and|or|&|then|plus|as well as)?[\s,]*(?:in|on|at)?\s*$/i;
function scopeOf(t, n) {
  const text = String(t || '');
  const ms = [...text.matchAll(ROUND_MENTION)];
  if (ms.length < 2) return text;
  const groups = [];
  let open = null;
  ms.forEach((m, i) => {
    const nums = [Number(m[1]), ...String(m[2] || '').match(/\d{1,2}/g) || []].map(Number);
    const end = i + 1 < ms.length ? ms[i + 1].index : text.length;
    const between = text.slice(m.index + m[0].length, end);
    if (!open) open = { from: m.index, nums: [] };
    open.nums.push(...nums);
    // A mention with only a joining word after it is one item of a list.
    if (i + 1 < ms.length && JOIN_ONLY.test(between)) return;
    // A mention that says nothing after it ("and so was round 5.") takes its
    // claim from before: such a round is read whole.
    groups.push({ from: open.from, to: end, nums: open.nums, bare: !/[a-z]{2,}/i.test(between) });
    open = null;
  });
  const own = groups.filter((g) => g.nums.includes(n));
  if (!own.length || own.some((g) => g.bare)) return text;
  return [text.slice(0, ms[0].index), ...own.map((g) => text.slice(g.from, g.to))].join(' ').replace(/\s+/g, ' ').trim();
}

function gateStanding(s, facts, rs) {
  const f = facts || {};
  if (!rs || !rs.round || f.language !== 'en' || !(f.rounds instanceof Map)) return null;
  const whole = String(s || '');
  for (const n of rs.rounds) {
    const r = f.rounds.get(n);
    if (!r) continue;
    const t = rs.rounds.length > 1 ? scopeOf(whole, n) : whole;
    const neg = NEGATION.test(t);
    const say = (what) => drop('timeline', `your reply said ${what} in round ${n}, which the record of it does not have`);
    const states = r.standings || [];
    // Every standing the sentence says (standingClaims), the player's side
    // first, as the record and the prompt say it ("4 against 3 standing"):
    // "you were down 3 against 4" on a round the player died 4 against 3 in
    // passed with the numbers turned round. Only a sentence about their side
    // may count theirs first. One the player's death left is the standing
    // right after it (leftByDeath); any other is one the round had.
    for (const c of standingClaims(t, f)) {
      const is = ([m, e]) => (m === c.a && e === c.b) || (c.either && m === c.b && e === c.a);
      if (r.died && Array.isArray(r.after) && leftByDeath(t, c.at, c.end)) {
        if (!is(r.after)) {
          const atDeath = Array.isArray(r.atDeath) ? `${r.atDeath[0]} against ${r.atDeath[1]} at the death and ` : '';
          return drop('timeline', `your reply said the player's death left ${c.a} against ${c.b} standing in round ${n}, where Riot's record has ${atDeath}${r.after[0]} against ${r.after[1]} after it`);
        }
      } else if (!states.some(is)) return say(`${c.a} against ${c.b} standing`);
    }
    if (ADVANTAGE.test(t) && !neg && !states.some(([m, e]) => m > e)) return say('a man advantage');
    if (DISADVANTAGE.test(t) && !neg && !states.some(([m, e]) => m < e)) return say('a man disadvantage');
    // A clutch is the player's only where the sentence says it is (clutchOwner).
    const clutch = [...t.matchAll(new RegExp(CLUTCH.source, 'gi'))].some((m) => clutchOwner(t, m.index, f) === 'me');
    if (clutch && !neg && !r.clutch) return say('a clutch');
    if (AFTER_PLANT.test(t) && !neg && !r.planted) return say('a plant');
    // Only the negation that governs it turns a first death or a first kill
    // round: in "you opened the round strong, but the team could not hold the
    // site" (bench:chat, 15 Oct) the "not" is the team's, and a round the player
    // opened with the first kill was dropped as one they never opened.
    // Only the player's own (firstOwner): a teammate's first death or an
    // enemy's first kill is no claim about the player, and an enemy's first
    // kill on the player is the player's first death.
    if (r.verified) {
      for (const fd of t.matchAll(new RegExp(FIRST_DEATH.source, 'gi'))) {
        if (firstOwner(t, fd.index, f) !== 'me') continue;
        const no = negatedAt(t, fd.index);
        if (no ? r.firstDeath : !r.firstDeath) return say(no ? 'no first death' : 'the first death');
      }
      for (const ok of t.matchAll(new RegExp(OPENING_KILL.source, 'gi'))) {
        const owner = firstOwner(t, ok.index, f);
        const no = negatedAt(t, ok.index);
        if (owner === 'enemy' && ON_YOU.test(t.slice(ok.index + ok[0].length))) {
          if (no ? r.firstDeath : !r.firstDeath) return say(no ? 'no first death' : 'the first death');
          continue;
        }
        if (owner !== 'me') continue;
        if (no ? r.firstKill : !r.firstKill) return say(no ? 'no first kill' : 'the first kill');
      }
    }
    const planted = YOU_PLANTED.exec(t);
    if (planted && !negatedAt(t, planted.index) && !r.planted) return say('a plant');
    if (MATCH_POINT.test(t) && !neg && !r.matchPoint) return say('match point');
    if (PISTOL_CLAIM.test(t) && !neg && !r.pistol) return say('a pistol round');
    if (ATTACK_SIDE.test(t) && r.side === 'defending' && !ABOUT_THEM.test(t)) return say('attack');
    if (DEFENCE_SIDE.test(t) && r.side === 'attacking' && !ABOUT_THEM.test(t)) return say('defence');
    if (r.traded === true && NOT_TRADED.test(t)) return drop('timeline', `your reply said round ${n}'s death was not traded, and Riot's record has it traded`);
    if (r.traded === false && (WAS_TRADED.test(t) || TRADED_YOU.test(t) || mateTradedClaim(t))) return drop('timeline', `your reply said round ${n}'s death was traded, and Riot's record has it not traded`);
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

/** The round a sentence last named on its own before `at` ("in round 2"), or null after a list ("rounds 2, 4 and 5") or none. */
const ONE_ROUND = /\b(rounds?)\s+#?(\d{1,2})\b((?:\s*(?:,\s*(?:and\s+|or\s+)?|and\s+|or\s+|to\s+|through\s+|-)\s*\d{1,2}\b)*)/gi;
function singleRoundBefore(t, at) {
  let last = null;
  for (const m of String(t || '').slice(0, at).matchAll(ONE_ROUND)) last = /^round$/i.test(m[1]) && !m[3] ? Number(m[2]) : null;
  return last;
}
function gateWeapon(s, facts, rs) {
  const f = facts || {};
  if (!rs || !rs.round || !(f.rounds instanceof Map)) return null;
  const t = String(s || '');
  for (const g of gunsIn(t)) {
    const owner = gunOwner(t, g);
    const mine = owner === 'mine';
    const theirs = owner === 'theirs';
    // The gun is the round's the sentence last named alone before it: "the
    // first kill in rounds 2, 4 and 5, but in round 2 you died to a Sheriff"
    // gave round 4 the Sheriff (the round 3 audit). A list of rounds before
    // it, or none, holds the gun to every round named, as before.
    const own = singleRoundBefore(t, g.at);
    const held = own !== null && rs.rounds.includes(own) ? [own] : rs.rounds;
    for (const n of held) {
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
const RECORD_BUY_KINDS = new Set(['pistol', 'eco', 'force', 'half', 'full']);
const BUY_KIND_WORD = /^(?:ecos?|force[ -]buy|forced?|full[ -]buy|half[ -]buy|loadout)$/i;
function gateEconomy(s, facts, rs) {
  const f = facts || {};
  if (!rs || !rs.round || f.language !== 'en' || !(f.rounds instanceof Map)) return null;
  if (ECON_REFUSAL.test(String(s || ''))) return null;
  const all = [...String(s || '').matchAll(new RegExp(ECONOMY.source, 'gi'))].map((m) => m[1]);
  if (!all.length) return null;
  for (const n of rs.rounds) {
    // Each round's words in its own clause (scopeOf, round 8).
    const raw = rs.rounds.length > 1 ? [...scopeOf(s, n).matchAll(new RegExp(ECONOMY.source, 'gi'))].map((m) => m[1]) : all;
    const words = raw.map(econStem);
    const r = f.rounds.get(n);
    const said = r && r.look ? `${r.look.what || ''} ${r.look.better || ''}` : '';
    const stems = new Set([...said.matchAll(new RegExp(ECONOMY.source, 'gi'))].map((m) => econStem(m[1])));
    // THE TEAM'S BUY FROM RIOT'S RECORD (8.8, chat-prompt.js recordOf): a
    // round whose line gives it holds what kind of round the team played, so
    // its kind words are the record's there (an eco, a full buy, a forced
    // loadout), and a save of an eco round. Which kind is said is
    // record-claims.js checkRecord's. What anyone bought, the credits, the
    // armour and the damage are still held by nothing.
    const kind = !!(r && RECORD_BUY_KINDS.has(r.buy));
    for (let i = 0; i < words.length; i++) {
      const w = words[i];
      if (kind && (BUY_KIND_WORD.test(raw[i]) || (w === 'save' && r.buy === 'eco'))) continue;
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
/*
 * "5 OF YOUR LAST 6 MATCHES" IS THE PAIR 5 OF 6 (the round 3 audit, Nov 2026).
 * THE PLAYER's patterns read "in 5 of 6 matches", and the model says it as "5
 * of your last 6 matches": the count reader saw no pair in it, the number gate
 * found the 5 tied to nothing, and the first sentence of four honest lines
 * went with it. The words between "of" and the second number are dropped
 * here, so the pair is checked as the pair it is: 4 of your last 6 is still
 * no count the facts state.
 */
const PAIR_FILLER = /\b(\d+)(\s+(?:out\s+)?of\s+)(?:the|your|their|those|these)\s+(?:(?:last|recent|recorded|past|previous|latest|most recent)\s+){1,2}(\d+)\b/gi;
const pairWords = (t) => String(t || '').replace(PAIR_FILLER, '$1$2$3');
const PEEK_TWICE = /\b(?:re-?)?peek(?:ed|ing|s)?\b[^.;]{0,48}\btwice\b/i;
/** Whether "peeked ... twice" is said of rounds whose looks are all repeeks (the named ones, else the one asked). */
function repeekTwice(t, f) {
  if (!PEEK_TWICE.test(String(t || '')) || !(f && f.rounds instanceof Map)) return false;
  const named = roundsNamed(t, f);
  const rs = named.length ? named : (f.asked && f.oneRound ? [f.asked] : []);
  return rs.length > 0 && rs.every((n) => { const r = f.rounds.get(n); return !!(r && r.look && r.look.cause === 'repeek'); });
}
// "Worth keeping" is no repeat of the player's: what went right, to keep.
const KEEPING_WORTH = /\b(?:worth|is|are)\s+keeping\b|\b(?:the part|the thing|the habit|what|something)\s+to\s+keep\b/gi;
// "You traded a teammate 4 times", the cards' own sum (chat-prompt.js factsOf `tradedMates`).
const TRADED_MATES_TIMES = /\byou\s+(?:also\s+)?traded\s+(?:a\s+)?teammates?\s+(\d+)\s+times\b/i;
function gateCount(s, facts) {
  const f = facts || {};
  if (f.language !== 'en') return null;
  const t = String(s || '');
  const counted = f.counted || {};
  const pairsOk = counted.pairs || new Set();
  const countsOk = counted.counts || new Set();
  let pairs = [];
  try { pairs = review().countPairs(pairWords(digitsOf(t))); } catch { pairs = []; }
  for (const p of pairs) {
    if (!pairsOk.has(p)) return drop('count', `your reply said ${p.replace('/', ' of ')}, which no count in the facts states`);
  }
  const dt = digitsOf(t);
  // "You died 21 times" with the scoreline's 21 deaths is the scoreline, no
  // count or repeat of its own: the plainest true sentence of a match was
  // dropped (the verifier's probe, 15 Oct). chat-prompt.js factsOf gives `died`.
  const scoreDeaths = fin(counted.died) ? new RegExp(`\\byou\\s+(?:only\\s+)?died\\s+${counted.died}\\s+times\\b`, 'gi') : null;
  let repeatText = (scoreDeaths ? dt.replace(scoreDeaths, 'you died') : dt).replace(KEEPING_WORTH, 'worth it');
  // "You peeked the same angle twice" of a round whose look is a repeek is the
  // label in words, as "again" is (repeekSaid): it was read as "2 times" no
  // count states (the round 3 audit).
  if (repeekTwice(t, f)) repeatText = repeatText.replace(/\b2 times\b/, 'again');
  for (const re of [TIMES, IN_ROUNDS]) {
    for (const m of repeatText.matchAll(new RegExp(re.source, 'gi'))) {
      if (!countsOk.has(Number(m[1]))) return drop('count', `your reply said ${m[0]}, which no count in the facts states`);
    }
  }
  let REPEAT;
  try { REPEAT = review().REPEAT_WORDS; } catch { REPEAT = /\b(?:repeatedly|again and again|kept|every round|each round|over and over|always|constantly)\b/i; }
  if (!isInstruction(t) && !isHypothetical(t) && REPEAT.test(repeatText) && PAST_YOU.test(t) && !quotesCounted(dt, counted)) {
    const named = roundsNamed(t, f);
    const traded = TRADED_MATES_TIMES.exec(repeatText);
    const ok = pairs.some((p) => pairsOk.has(p))
      || (traded && fin(counted.tradedMates) && Number(traded[1]) === counted.tradedMates)
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
  if (!(PEEK_AGAIN.test(t) || PEEK_TWICE.test(t)) || !rounds.length || !(f.rounds instanceof Map)) return false;
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
  // "from 20 to 50 m", the aim facts' own words (round 8, chat-prompt.js gunLineOf): the band that starts there.
  const ft = /\bfrom\s+(\d+)\s+to\s+(\d+)\s*(?:m|metres?|meters?)\b/i.exec(t);
  if (ft) return Number(ft[1]) > 0 ? { from: Number(ft[1]) } : { upTo: Number(ft[2]) };
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
  // The part named right after the number first: "two head hits but needs
  // four body hits" read the 4 as head hits (the round 3 audit).
  const own = /^\s*(?:more\s+|clean\s+)?(head|body|legs?)\b/i.exec(String(ctx.after || ''));
  const part = (own && partOf(own[1])) || partOf(ctx.clause) || partOf(ctx.sentence);
  let armor = null;
  for (const [re, a] of ARMOR_NAMED) if (re.test(ctx.sentence)) { armor = a; break; }
  if (!armor && ctx.armor) armor = ctx.armor;
  // The clause's own band first: "1 head hit from 0 to 20 m, and 2 from 20 to 50 m" names two (round 8).
  const band = bandNamed(String(ctx.clause || '')) || bandNamed(ctx.sentence);
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
// The round 3 audit's number readers (Nov 2026), each asserted in test:chatgates.
const CLUTCH_AGAINST_BEFORE = /\b(?:last (?:one|player|man|teammate|person) (?:standing|alive|left)|last alive)\s+(?:against|versus|vs\.?)\s*$/i;
const OF_YOUR_NOUN = /^\s+(?:out\s+)?of\s+(?:the|your|their|those|these)\s+(?:own\s+)?(deaths|kills|assists|rounds|matches|games)\b/i;
const OF_TOTAL_BEFORE = /\bof\s+(?:the|your|their|those|these)\s+(\d+)\s+(deaths|kills|assists|rounds|matches|games)\s*,\s*$/i;
const SMALL_ADVICE_AFTER = /^\s*(?:more\s+|extra\s+|quick\s+|short\s+|single\s+)?(?:shots?|bullets?|taps?|bursts?|peeks?|looks?|fights?|duels?|angles?|steps?|corners?|lanes?|spots?|habits?|things?|pieces?)\b/i;
// "If you have an escape, take one more shot": advice after a condition.
const LEAD_CONDITION = /^(?:if|when|once|whenever|as soon as|after|before|until)\b[^,]{1,80},\s*(.+)$/i;
const leadInstruction = (raw) => {
  const m = LEAD_CONDITION.exec(String(raw || '').trim());
  return !!(m && IMPERATIVE.test(m[1].trim()));
};
/** Whether "N of your <noun>" is a total of the facts, or a counted pair of one. */
function shareOk(f, attr, value) {
  const totals = new Set((f.numbers || []).filter((x) => x.attr === attr && x.round == null && fin(x.value)).map((x) => x.value));
  if (totals.has(value)) return true;
  const pairs = (f.counted && f.counted.pairs) || new Set();
  for (const p of pairs) {
    const [a, b] = String(p).split('/').map(Number);
    if (a === value && totals.has(b)) return true;
  }
  return false;
}

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
  const english = (f.language || 'en') === 'en';
  // "5 of your last 6 matches" read as the pair it is (pairWords, the count gate's).
  let t = english ? pairWords(digitsOf(raw)) : digitsOf(raw);
  // "Peeked the same angle twice" of a repeek is the label, no count (repeekTwice).
  if (english && repeekTwice(raw, f)) t = t.replace(/\b2 times\b/, 'again');
  const rounds = rs && rs.rounds ? rs.rounds : (f.asked && f.oneRound ? [f.asked] : []);
  const instruction = isInstruction(raw) || isHypothetical(raw);
  const instructive = instruction || (english && leadInstruction(raw));
  const fail = (said) => drop('number', `your reply said ${said}, which the facts do not hold`);
  // A standing's numbers are the standing gate's: "leaving Reyna alone against
  // 2" lost its 2 here as a number tied to nothing (standingClaims).
  const standing = english ? standingClaims(t, f).map((c) => [c.at, c.end]) : [];
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
        || /^v\d/i.test(after) || /\dv$/i.test(before) || standing.some(([from, to]) => at >= from && at < to)) continue;
    // "The last one standing against 2" is a clutch, held to a round's clutch
    // in Riot's record (the named rounds' when the sentence names any). It was
    // a number tied to nothing, and with it went a true "you won round 2 as the
    // last one standing against 2" (the round 3 audit). A general rule ("when
    // you are the last one alive against 2, ...") claims no round.
    if (english && CLUTCH_AGAINST_BEFORE.test(before)) {
      if (instruction && !(rs && rs.round)) continue;
      const pool = f.rounds instanceof Map ? (rs && rs.round && rounds.length ? rounds : [...f.rounds.keys()]) : [];
      if (pool.some((n) => { const r = f.rounds.get(n); return !!(r && r.clutch && r.clutch.vs === value); })) continue;
      return fail(`the last one standing against ${value}, which no round's clutch in Riot's record has`);
    }
    // "Against your usual 32": the player's own average as the against line
    // and the library hold it (facts.library.averages, the re-audit of 8.7.7),
    // a true number dropped as tied to nothing. One the library lacks goes on
    // to every check below.
    if (english && f.library && f.library.averages && AVG_BEFORE.test(before) && f.library.averages.has(value)) continue;
    if (/^\s*(?:out\s+)?of\s+(?:the\s+|your\s+|their\s+)?\d/i.test(after) || /\b\d+\s+(?:out\s+)?of\s+(?:the\s+|your\s+|their\s+)?$/i.test(before)) continue;
    // "All 5 of your deaths": a share of a total, held to the total itself or
    // to a pair the counted lines state ("3 of your 5 deaths" lets "3 of your
    // deaths" stand). It was a number tied to nothing, and the first sentence
    // of four honest lines went with it (the round 3 audit). "4 of your
    // deaths" of a player with 5, of whom no count says 4, still goes.
    // "Of your 16 deaths, 14 went unanswered": the counted "14 of your 16
    // deaths" said the other way round, held to the pair (the round 3 audit).
    const ofTotal = english ? OF_TOTAL_BEFORE.exec(before) : null;
    if (ofTotal) {
      if (((f.counted && f.counted.pairs) || new Set()).has(`${value}/${Number(ofTotal[1])}`)) continue;
      return fail(`${value} of ${ofTotal[1]} ${ofTotal[2]}, which no count in the facts states`);
    }
    const share = english ? OF_YOUR_NOUN.exec(after) : null;
    if (share) {
      const attr = /^death/i.test(share[1]) ? 'deaths' : /^kill/i.test(share[1]) ? 'kills' : /^assist/i.test(share[1]) ? 'assists'
        : /^round/i.test(share[1]) ? 'rounds' : 'matches';
      if (shareOk(f, attr, value)) continue;
      return fail(`${value} of your ${share[1]}, which is no total or counted share of them in the facts`);
    }
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
    let subjects = subjectsNear(t, ctx.clause);
    if (attr === 'damage?') attr = subjects.some((x) => x.kind === 'gun') || /\b(?:head|body|legs?)\b/i.test(ctx.clause) ? 'damage' : null;
    // THE GUN THE PLAYER ASKED ABOUT IS THE SUBJECT OF A HIT WITH NONE NAMED
    // (bench:chat, 9 Nov): "Each body hit deals 40 damage ... through Heavy
    // Armor", the second sentence of a Vandal answer, was held to the Heavy
    // Armor, which deals no damage, and the true answer went to the honest
    // line. The armour a hit goes through is its target, not its source.
    const askedGun = Array.isArray(f.askedGuns) && f.askedGuns.length === 1 ? f.askedGuns[0] : null;
    if (askedGun && !subjects.some((x) => x.kind === 'gun') && /\b(?:hits?|shots?|damage|bullets?|taps?)\b/i.test(ctx.clause)) {
      subjects = [{ kind: 'gun', name: askedGun }, ...subjects.filter((x) => !(x.kind === 'gear' && /armou?r|shield/i.test(x.name)))];
    }
    // "Brings the total to 160": a gun's own hit damage times a count of
    // hits, the sum a hits to kill answer shows its working with (the same run).
    if (!attr && /\btotal\b/i.test(ctx.clause)) {
      const guns = new Set(subjects.filter((x) => x.kind === 'gun').map((x) => lower(x.name)));
      const per = (f.primer || []).filter((e) => e.subjectKind === 'gun' && guns.has(lower(e.subject)) && ['head', 'body', 'legs'].includes(e.attribute) && fin(e.value));
      if (per.some((e) => [2, 3, 4, 5, 6, 7, 8].some((k) => near(e.value * k, value, 1e-6)))) continue;
    }
    if (attr === 'percent?') attr = null;
    if (attr === 'times' && /\b(?:hit|hits|shot|shoot|tap|taps|bullet)\b/i.test(ctx.clause)) attr = 'hits';
    // "You died 4 times" is a count of deaths, the scoreline's.
    else if (attr === 'times' && /\b(?:died|were killed|got killed)\s+$/i.test(before)) attr = 'deaths';
    if (attr === 'rounds' && subjects.some((x) => x.kind === 'gun') && /\b(?:magazine|mag|clip)\b/i.test(t)) attr = 'magazine';
    // "Take one more shot and leave": a single shot, peek or fight in advice,
    // no gun named and nothing about what kills, claims no game number. It was
    // dropped as a hit count tied to nothing, inside an "if you have an
    // escape, take one more shot" too (the round 3 audit). "Two shots kill"
    // and a gun's own hits are still the primer's to hold.
    if (instructive && value <= 3 && SMALL_ADVICE_AFTER.test(after) && !subjects.some((x) => x.kind === 'gun')
        && !/\b(?:kills?|killing|die|dies|damage|armou?r|health|hp)\b/i.test(ctx.clause)) continue;
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

// ── The round 3 audit's gates (Nov 2026) ───────────────────────────────────

/*
 * THE RULES' OWN TEMPLATE IS NO ANSWER. The rules once asked for the fix "as
 * when this happens, do that", and players were shown "When this happens, do
 * that." word for word. A sentence carrying the template's words is dropped.
 */
const TEMPLATE_WORDS = /\bwhen this happens,?\s+(?:you\s+)?do that\b|\bas when this happens\b|\bthe moment to notice and the move to make\b|\bthe situation to notice and the move to make\b/i;
function gateTemplate(s) {
  return TEMPLATE_WORDS.test(String(s || ''))
    ? drop('template', "your reply wrote the instruction's own template words, such as when this happens, do that; say the real moment and the real move instead")
    : null;
}

/*
 * AIM IS NEVER WAVED AWAY WITHOUT THE LOOKS TO SAY SO. Ten of ten aim
 * questions were answered "your aim is not the problem", three with no look at
 * any death, one against its own two lost duels. Saying aim is not the
 * problem, or can wait, stands only where the coach looked: of the rounds the
 * sentence names, each one looked at and none a lost duel, else of the match,
 * at least two deaths looked at, half of them or more, and none a lost duel.
 */
const AIM_DISMISSED = [
  /\baim\s+(?:is|was)(?:n't|\s+not)\s+(?:really\s+|actually\s+)?(?:the|your|what|a|an|why)\b[^.;:]{0,40}?\b(?:problem|issue|fix|cost|costing|cause|reason|matters?|thing|holding)\b/i,
  /\baim\s+(?:(?:work|question|training|practice)\s+)?can\s+wait\b/i,
  /\bnot\s+(?:about\s+)?(?:your\s+)?aim\b(?!\s+(?:alone|only|first)\b)/i,
  /\bnot\s+(?:an?\s+)?(?:lost\s+)?aim\s+(?:duel|problem|issue)\b/i,
  /\baim\s+(?:is|was|looks|looked)\s+fine\b/i,
  /\bnothing\s+(?:here\s+)?(?:says|saying|shows|showing)\s+(?:that\s+)?your\s+aim\b/i,
  // The re-audit of 8.7.7: the same dismissal in other words, each said
  // against a look that had called the deaths lost duels.
  /\bnot\s+(?:really\s+|mostly\s+|actually\s+)?lost\s+on\s+the\s+(?:shot|aim)\b/i,
  /\b(?:mechanics|the\s+shot|your\s+shot|shooting|gunplay|the\s+shooting)\s+(?:is|are|was|were)(?:n't|\s+not)\s+(?:really\s+|actually\s+)?(?:the|your|what|why)\b[^.;:]{0,40}?\b(?:problem|issue|cost|costing|cause|reason|holding|matters?)\b/i,
  // A window of 140: the live Sunset answer put 87 characters ("25%, against
  // 36% across your recent matches, so there is room there, ") between the two.
  /\b(?:aim|headshots?|head ?shot rate|the shot|mechanics)\b[^.;]{0,140}\bbut\s+(?:it|that|this)(?:'s|\s+is|\s+was)(?:n't|\s+not)\s+what\s+(?:cost|lost|is\s+costing|was\s+costing|decided)\b/i,
  /\bnot\s+that\s+you(?:'re|\s+are|\s+were)\s+losing\s+(?:the\s+|your\s+)?(?:duels|fights|gunfights)\b/i,
];
// "Your aim is already carrying you": praise the headshot rate has to bear out.
const AIM_PRAISED = /\b(?:your\s+)?aim\b(?:\s+and\s+your\s+[a-z ]{1,30}?)?\s+(?:is|are|was|were|has\s+been)\s+(?:already\s+|clearly\s+|really\s+)?(?:carrying|good|great|strong|solid|fine|working|winning|on point)\b|\byour\s+(?:shooting|gunplay|mechanics)\s+(?:is|are|was|were)\s+(?:already\s+)?(?:carrying|good|great|strong|solid)\b/i;
// "A fight you should not have taken": said of fights the look called fair.
const AVOIDABLE = /\b(?:should(?:n't|\s+not)\s+have\s+(?:taken|fought|been\s+taken)|did(?:n't|\s+not)\s+need\s+(?:to\s+take|taking|to\s+be\s+taken)|was(?:n't|\s+not)\s+(?:a\s+fight\s+)?worth\s+taking|not\s+worth\s+taking)\b/i;
const AIM_REASON = 'your reply said aim is not the problem, which the coach\'s looks do not show; answer from the deaths and the headshot rate against the player\'s own average, and still give one aim habit';
function gateAim(s, facts, rs) {
  const f = facts || {};
  if ((f.language || 'en') !== 'en' || f.game === 'lol') return null;
  const t = String(s || '');
  // A look that could not tell ('unclear') called the death nothing: it is no
  // look that says aim was not the problem (the Sunset 2 to 5, four unclear
  // looks, "it is not what cost you the rounds", the re-audit of 8.7.7).
  const looked = (r) => !!(r && r.died && r.look && r.look.cause && r.look.cause !== 'unclear');
  const ns = rs && rs.round ? rs.rounds : (f.oneRound && f.asked ? [f.asked] : []);
  const named = f.rounds instanceof Map ? ns.map((n) => f.rounds.get(n)).filter(Boolean) : [];
  /*
   * PRAISE THE NUMBERS DO NOT BEAR OUT. "Your aim and your opening kills are
   * already carrying you" at 22% headshots against the player's own 38%:
   * praise of the aim stands only where this match's headshot rate is at or
   * above their own average (facts.aim, the against line), never with no
   * average to hold it to.
   */
  if (AIM_PRAISED.test(t) && !negatedAt(t, t.search(AIM_PRAISED))) {
    const a = f.aim || null;
    if (!a || !fin(a.hs) || !fin(a.baseline) || a.hs < a.baseline) {
      return drop('aim', 'your reply praised the aim, which the headshot rate against the player\'s own average does not bear out; give the two numbers as they are');
    }
  }
  /*
   * A FIGHT THE LOOK CALLED FAIR WAS NO FIGHT TO SKIP. "No amount of crosshair
   * work fixes a fight you should not have taken" on the Pearl, whose two
   * looked deaths were fair fights lost on the shot: of the rounds named, or
   * of the match when none is, every death the coach could tell about a lost
   * duel, two at least, and the sentence says the fight was not to be taken.
   */
  // "A fair fight you lost rather than a fight you shouldn't have taken" says the look's own reading.
  const avoid = AVOIDABLE.exec(t);
  const ratherThan = avoid && /\b(?:rather than|instead of|not|never|no)\s+(?:(?:a|an|the|one)\s+)?(?:[a-z]+\s+){0,3}$/i.test(t.slice(Math.max(0, avoid.index - 40), avoid.index));
  if (avoid && !ratherThan && f.rounds instanceof Map) {
    // The rounds it names even where it reads as no claim about the round itself ("round 12 was a fight you should not have taken").
    let own = named;
    if (!own.length) { try { own = roundsNamed(t, f).map((n) => f.rounds.get(n)).filter(Boolean); } catch { own = []; } }
    const pool = own.length ? own : [...f.rounds.values()].filter(looked);
    const fair = pool.filter((r) => looked(r) && r.look.cause === 'lost-duel');
    if (fair.length && fair.length === pool.length && (own.length || fair.length >= 2)) {
      return drop('aim', 'your reply said a fight should not have been taken where the coach\'s look called it a fair fight lost on the shot; say what the look said, and give one aim habit');
    }
  }
  if (!AIM_DISMISSED.some((re) => re.test(t))) return null;
  if (!(f.rounds instanceof Map)) return drop('aim', AIM_REASON);
  // The rounds the sentence names, else the one round asked about: "Aim was
  // not the issue here, the position was" in an answer about a repeek round
  // is said of that round, never of the match (the round 3 verification).
  if (named.length) {
    if (named.every((r) => looked(r) && r.look.cause !== 'lost-duel')) return null;
    return drop('aim', AIM_REASON);
  }
  const deaths = [...f.rounds.values()].filter((r) => r.died);
  const seen = deaths.filter(looked);
  if (seen.length >= 2 && seen.length * 2 >= deaths.length && !seen.some((r) => r.look.cause === 'lost-duel')) return null;
  return drop('aim', AIM_REASON);
}

/*
 * THE KIT AS THE GAME DATA HAS IT, AND THE STATE AS RIOT'S RECORD HAS IT
 * (ability-facts.js, stream D of the round 3 audit). "Her Turret (E) and
 * Alarmbot (C)" on a Killjoy whose Alarmbot is Q, "the alarmbot reveals and
 * slows", Paranoia "vision blocking": a key, an ultimate, an effect or an owner
 * the data contradicts. And a standing "N against M" a round's record never
 * had, or a health number nothing in the facts states. The sentence goes, the
 * answer stays. A module that is not deployed checks nothing.
 */
let abilityFactsMod;
function abilityFacts() {
  if (abilityFactsMod === undefined) {
    try { abilityFactsMod = require('./ability-facts'); } catch { abilityFactsMod = null; }
  }
  return abilityFactsMod;
}
function gateKit(s, facts, rs) {
  const f = facts || {};
  if ((f.language || 'en') !== 'en' || f.game === 'lol') return null;
  const af = abilityFacts();
  if (!af || typeof af.checkText !== 'function') return null;
  const t = String(s || '');
  let claims = [];
  // "His ultimate is a single still" in an answer about Cypher: the agent a his
  // or her ultimate stands for, the enemy asked about, else the asked round's
  // killer (ability-facts.js ultimateClaims, the re-audit of 8.7.7).
  const ultOf = (f.askedAgents || []).find((a) => a && a !== f.agent)
    || (() => { const r = f.rounds instanceof Map && f.oneRound && f.asked ? f.rounds.get(f.asked) : null; return r && r.killer ? r.killer : null; })();
  try { claims = af.checkText(t, { agents: [f.agent, ...(f.askedAgents || [])].filter(Boolean), ...(ultOf ? { ultOf } : {}) }) || []; } catch { claims = []; }
  const c = claims[0];
  if (c) {
    const why = c.kind === 'key' ? `${c.ability} is ${c.agent}'s ${c.truth}, never ${c.said}`
      : c.kind === 'ultimate' ? `${c.ability} is no ultimate, it is ${c.agent}'s ${c.truth}`
        : c.kind === 'owner' ? `${c.ability} is ${c.agent}'s, never ${c.said}'s`
          : `the game's own description of ${c.ability} never says it ${c.said}`;
    return drop('kit', `your reply got an ability wrong: ${why}; name abilities by their name as the kit gives them, never by a key letter, and say only what the kit says they do`);
  }
  if (typeof af.checkState !== 'function' || !(f.rounds instanceof Map)) return null;
  const round = rs && rs.round && rs.rounds.length === 1 ? rs.rounds[0] : (f.oneRound ? f.asked : null);
  const hp = [];
  for (const r of f.rounds.values()) for (const d of r.lookDigits || []) if (d && (!d.unit || /^(?:hp|health)$/i.test(d.unit))) hp.push(d.value);
  let state = [];
  try {
    state = af.checkState(t, { rounds: f.rounds, round, mode: f.mode || null,
      texts: (f.counted && f.counted.texts) || [], hp }) || [];
  } catch { state = []; }
  // A standing inside five a side is the timeline gate's, which reads whose it
  // is, what a death left and what a sentence after a told standing carries on
  // (gateStanding, gateLeftAcross): "Then it was 2 against 5" after the told
  // death stays there, where the plainer reader here, which holds the round's
  // list alone, dropped it. Here: a health number, and a standing past five a side.
  const x = state.find((c) => c && (c.kind === 'hp' || c.record === 'five a side'));
  if (!x) return null;
  return x.kind === 'hp'
    ? drop('kit', `your reply gave a health number (${x.said}) nothing in the facts states; never say a health number the facts do not hold`)
    : drop('kit', `your reply said ${x.said}${x.round ? ` in round ${x.round}` : ''}, which Riot's record of the standing does not have`);
}

/*
 * A DRILL MUST BE ONE THE MODE ALLOWS. "Run deathmatch with one rule: only peek
 * where a teammate can see the angle" asks for teammates a Deathmatch and the
 * Range never have. Team Deathmatch has a team, and a sentence saying there is
 * nobody there is the rule itself.
 */
// The Range with its capital, the mode's name: "stay within the range where a
// teammate can trade you" is a distance, no drill (the round 3 verification).
const SOLO_MODE = /(?<![Tt]eam\s)(?<![A-Za-z])(?:[Dd]eath ?[Mm]atch|DEATHMATCH|the Range|in Range|[Rr]ange practice|[Aa]im trainer)(?![A-Za-z])/;
// And a teammate in other words (the blind audit of 8.7.8): "treat every fight
// as one you must have a second person for", "ask whether anyone could follow
// that fight", both told for Deathmatch.
// Since round 8 the shared one of game-claims.js, a teammate backing you up added.
const TEAM_WORDS = claims.TEAM_WORDS;
// And the drill sent away from the mode (the blind audit of 8.7.8): "Practise
// it in your next match rather than in Deathmatch, because it needs teammates"
// is the rule itself, and was dropped five times over the 8.7.7 replies.
const NO_TEAM = /\b(?:no|without|never|not|nobody|no one)\b[^.;:]{0,30}\b(?:teammates?|team|allies|ally|trade|anyone)\b|\bon your own\b|\balone\b|\bin (?:a |your )?(?:match|matches|unrated|competitive|swiftplay)\b|\bin (?:a |your )?(?:next |own )?(?:ranked |unrated |competitive |swiftplay )?(?:match|matches|game|games)\b|\b(?:rather than|instead of|not|never)\s+(?:in\s+)?(?:a\s+|the\s+|your\s+)?(?:[Dd]eath ?[Mm]atch|Range)\b/i;
function gateMode(s, facts) {
  const f = facts || {};
  if ((f.language || 'en') !== 'en' || f.game === 'lol') return null;
  const t = String(s || '');
  // A disclaimer ("where there are no teammates") is read out first (round
  // 8): it named the limitation and then gave the team drill anyway. The
  // rule itself still passes: a "do not", a match, alone, after it.
  const u = claims.stripDisclaimer(t);
  // The wider absence words only where a disclaimer was read out, where the
  // old NO_TEAM read "no teammates" in it and let the sentence stand.
  if (!SOLO_MODE.test(t) || !TEAM_WORDS.test(u) || NO_TEAM.test(u) || (u !== t && claims.NO_TEAM_SAID.test(u))) return null;
  return drop('mode', 'your reply gave a drill for Deathmatch or the Range that needs teammates, which those modes never have; give a drill the player can do alone, and practise a team habit in a match');
}

/*
 * AN ENEMY ABILITY KILLED THE PLAYER ONLY WHERE RIOT'S RECORD SAYS SO. On the
 * Sunset loss Killjoy's four kills were a Bandit, a Bandit, a Classic and a
 * Marshal, and the answer blamed her turret and swarms. A sentence saying an
 * ability killed the player, in a round whose killer was that agent with a gun
 * (the named round, else every round that agent killed the player in), goes.
 */
const KILL_AFTER_ABILITY = /^\s*(?:\(\s*[CQEX]\s*\)\s*)?(?:that\s+)?(?:killed|got|shot|caught|finished|took out|picked off|did the damage that killed)\s+you\b/i;
const KILL_BEFORE_ABILITY = /\b(?:killed you|got you|you died|you were killed|you got killed|you fell)\s+(?:to|by|with|from|through|in|on|off)\s+(?:(?:her|his|their|the|an?|enemy|that|this)\s+)?(?:[A-Za-z/]+'s\s+)?$/i;
function gateAbilityKill(s, facts, rs) {
  const f = facts || {};
  if ((f.language || 'en') !== 'en' || f.game === 'lol' || !(f.rounds instanceof Map)) return null;
  const t = String(s || '');
  if (isHypothetical(t)) return null;
  const gunSet = new Set(GUNS.map(lower));
  for (const ab of abilitiesIn(t)) {
    // As the game prints it, with its capital: "flash" or "trap" is a word too.
    if (!/^[A-Z]/.test(t.slice(ab.at, ab.end))) continue;
    if (!KILL_AFTER_ABILITY.test(t.slice(ab.end)) && !KILL_BEFORE_ABILITY.test(t.slice(Math.max(0, ab.at - 60), ab.at))) continue;
    const own = singleRoundBefore(t, ab.at);
    const pool = own !== null && f.rounds.has(own) ? [own] : (rs && rs.round && rs.rounds.length ? rs.rounds : [...f.rounds.keys()]);
    const byAgent = pool.map((n) => f.rounds.get(n)).filter((r) => r && r.died && r.killer === ab.agent && r.killerWeapon);
    if (!byAgent.length) continue;
    if (byAgent.every((r) => gunSet.has(lower(r.killerWeapon)))) {
      return drop('ability-kill', `your reply said ${ab.agent}'s ${t.slice(ab.at, ab.end)} killed the player, where Riot's record has ${ab.agent} killing them with a gun; name an ability as what killed the player only where the record does`);
    }
  }
  /*
   * THE KIT IN GENERAL WORDS (the blind audit of 8.7.9): "Against Astra, the
   * thing that kills you is her star setup", where Astra's one kill on the
   * player was a Sheriff repeek. "What kills you is her utility", "her stars
   * killed you": the agent the sentence names before it, else the one the
   * question asked about, held to every death Riot gives that agent.
   */
  const kit = KIT_KILLS_YOU.exec(t) || KIT_KILLED_YOU.exec(t);
  if (kit) {
    const named = agentsIn(t.slice(0, kit.index)).map((a) => a.name);
    const agent = named.length ? named[named.length - 1] : (f.askedAgents && f.askedAgents.length === 1 ? f.askedAgents[0] : null);
    const byAgent = agent ? [...f.rounds.values()].filter((r) => r && r.died && r.killer === agent && r.killerWeapon) : [];
    if (byAgent.length && byAgent.every((r) => gunSet.has(lower(r.killerWeapon)))) {
      return drop('ability-kill', `your reply put the player's deaths to ${agent} on ${agent}'s abilities, where Riot's record has ${agent} killing them with a gun every time; name an ability as what killed the player only where the record does`);
    }
  }
  return null;
}
const KIT_NOUNS = '(?:stars?|star\\s+setups?|setups?|utility|util|kit|abilit(?:y|ies)|ultimates?|ult|traps?|turrets?|bots?|walls?|mollies|molly|smokes?|flash(?:es)?|stuns?|drones?|darts?|pulls?)';
const KIT_KILLS_YOU = new RegExp(`\\b(?:the\\s+thing|what|the\\s+part|the\\s+one\\s+thing)\\s+(?:that\\s+)?(?:kills|killed|kill|is\\s+killing)\\s+you\\s+(?:is|was|are|were)\\s+(?:her|his|their|the\\s+enemy's)\\s+(?:[a-z]+\\s+){0,2}?${KIT_NOUNS}\\b`, 'i');
const KIT_KILLED_YOU = new RegExp(`\\b(?:her|his|their)\\s+(?:[a-z]+\\s+){0,1}?${KIT_NOUNS}\\s+(?:killed|kills|got|finished|took\\s+out)\\s+you\\b`, 'i');

// ── What a sentence leans on ───────────────────────────────────────────────

/*
 * A SENTENCE THAT LEANS ON THE ONE BEFORE IT, for its time or its subject
 * (bench:chat, 23 Oct). A sentence is dropped whole, never repaired, and the
 * reply closes up around it, so the one after it is read against whatever
 * now stands before it. On the Sunset round 1, "Skye traded KAY/O one second
 * later" lost the player's death it was timed from and read as a trade at 25
 * s, where Riot has 27 s; on Split, "She killed you 5 times" lost the Reyna
 * it was about and read as Skye, the last agent named; "That was the first
 * death", "That is the habit to carry" and "It was not traded" lost what
 * they pointed at. chat-prompt.js gateReply drops such a sentence with the
 * one it leans on. It leans:
 *   - for its time, when it times its event from the one before ("one second
 *     later", "moments later", "right after", "at the same time") with no
 *     time or event in an earlier clause of its own to time it from. "Then"
 *     and "later" alone order it, which stays true whatever stands before;
 *     "within five seconds" is a trade's window, never a time;
 *   - for its subject, when it opens on a pronoun for a player (he, she, his,
 *     her, its), or on that, this or it with a verb, standing for what the
 *     sentence before told. "It was a defence round" is the round's, and
 *     "That round" or "This match" names what it means;
 *   - for what it answers, when a trade of a killer it names ("Skye traded
 *     KAY/O", "Phoenix answered") comes with no kill or death of its own
 *     before it: the death it answers is the sentence before's. "You were the
 *     first death, and nobody traded it" answers its own.
 */
const LEAN_OFFSET = '(?:(?:a|an|one|two|three|four|five|a few)\\s+(?:secs?|seconds?)|\\d+(?:\\.\\d+)?\\s*(?:s|secs?|seconds?)|(?:a\\s+)?(?:moment|beat|split second|instant)|moments|seconds|right|just|immediately|shortly|soon|straight)';
const LEANS_TIME = new RegExp(`\\b${LEAN_OFFSET}\\s+(?:later\\b|afterwards?\\b|after(?=\\s*(?:[,.;:!?]|$|that\\b|this\\b)))|\\b(?:at|in)\\s+the\\s+same\\s+(?:time|moment|second|instant)\\b`, 'i');
const LEANS_SUBJECT = /^(?:(?:and|but|so|then|still|yet|also)\s*,?\s+)?(?:(?:he|she)\b|(?:his|her|its)\s+[a-z]|(?:that|this|it)(?:'s\b|\s+(?:was|is|were|are|wasn't|isn't|had|has|left|leaves|gave|gives|meant|means|made|makes|put|puts|cost|costs|let|lets|happened|came|comes|went|brought|turned|decided|matters|mattered|changed|showed|shows|explains|explained|would|will|should|could|can|did|does|didn't|doesn't|counts|counted|ended|opened|forced|helped|allowed|created|got|took|says|said|tells|told)\b))/i;
const IT_IS_THE_ROUND = /^(?:(?:and|but|so)\s*,?\s+)?it(?:'s|\s+(?:was|is))\s+(?:(?:a|an|the|your|their)\s+)?(?:[a-z]+\s+){0,2}(?:round|match|game|half)\b/i;
const LEANS_TRADE = new RegExp(`\\b(?:traded|avenged)\\s+(?:(?:their|the enemy|an enemy|the)\\s+)?(?:${AGENT_ALT})(?![A-Za-z0-9])|\\banswered\\b(?!\\s+(?:you|your)\\b)`, 'i');
const LEAN_ANCHOR = /\b\d+(?:\.\d+)?\s*(?:s|secs?|seconds?)\s+(?:in|into)\b|\b(?:killed|died|traded|shot|planted|defused|eliminated|fell|answered|avenged|took out|picked off)\b|\b(?:deaths?|kills?)\b/i;
/** 'time', 'subject' or null: what a sentence takes from the one before it, and reads wrong without. */
function leansOn(sentence) {
  const t = straighten(sentence).trim();
  const time = LEANS_TIME.exec(t);
  if (time) {
    // Timed from an earlier clause of its own ("KAY/O killed you at 26 s in, and Skye traded KAY/O a second later") is anchored.
    const head = t.slice(0, time.index);
    let cut = 0;
    for (const m of head.matchAll(CLAUSE_START)) cut = m.index;
    if (!LEAN_ANCHOR.test(head.slice(0, cut))) return 'time';
  }
  if (LEANS_SUBJECT.test(t) && !IT_IS_THE_ROUND.test(t)) return 'subject';
  const trade = LEANS_TRADE.exec(t);
  if (trade && !LEAN_ANCHOR.test(t.slice(0, trade.index))) return 'subject';
  return null;
}

// ── The re-audit of 8.7.7 (Nov 2026) ───────────────────────────────────────

let coherenceMod;
function coherence() {
  if (coherenceMod === undefined) {
    try { coherenceMod = require('./coherence'); } catch { coherenceMod = null; }
  }
  return coherenceMod;
}

/*
 * NO TALK OF THE PRODUCT (coherence.js checkProduct). "So your next review can
 * check whether the fight had an answer": the coach teaches the game and never
 * recommends a feature, a page or a future review.
 */
function gateProduct(s, facts) {
  const f = facts || {};
  if ((f.language || 'en') !== 'en') return null;
  const c = coherence();
  if (!c || typeof c.checkProduct !== 'function') return null;
  return c.checkProduct([String(s || '')]).length
    ? drop('product', 'your reply talked about the app, a future review or a feature of it; teach the game alone, and never recommend a feature')
    : null;
}

/*
 * NO MATCH, NO RECORD (the coach bench, Nov 2026). Asked cold, with no match
 * attached, three answers of 72 cited a record that does not exist: "The
 * record for that round has you dying on site", what "the record" for the
 * Skye game holds, "the record doesn't hold a drone on C". A player reads that
 * as Occlara claiming to have seen their match. With no match (facts.noMatch)
 * a sentence that says a record, Riot's, the match's, the round's, shows,
 * holds, has or lacks anything, or that cites one ("in the record",
 * "according to the record"), goes. "I don't have the record of that match"
 * and "there is no record" claim nothing and stay. English only, and nothing
 * at all where a match is attached.
 */
const RECORD_NOUN = String.raw`(?:riot's|the|this|that|your)\s+(?:(?:match|round|game)(?:'s)?\s+)?record`;
const NO_RECORD_SAID = new RegExp(String.raw`\b${RECORD_NOUN}(?:'s\b|\b(?:\s+(?:for|of|from)\s+[^.,;:!?]{1,40}?)?\s+(?:has|had|have|shows?|showed|shown|holds?|held|says?|said|gives?|gave|puts?|lists?|tells?|told|confirms?|does|did|doesn't|didn't|isn't|wasn't|is|was|can|cannot|can't|will|would)\b)|\b(?:in|from|on|per|by)\s+${RECORD_NOUN}\b|\baccording\s+to\s+${RECORD_NOUN}\b`, 'i');
function gateNoRecord(s, facts) {
  const f = facts || {};
  if (!f.noMatch || (f.language || 'en') !== 'en') return null;
  return NO_RECORD_SAID.test(String(s || ''))
    ? drop('no-record', 'no match is attached to this question, so there is no record of it: never say a record shows, holds or has anything, and teach from what the player described')
    : null;
}

/*
 * A NUMBER ACROSS MATCHES IS THE LIBRARY'S OR NONE. Eleven answers of the
 * re-audit quoted "5 of your last 6", "your average of 32 percent", the same
 * player given 32% in one answer and another number in the next. A sentence
 * about the player's other matches (the last N, recent, across, their own
 * average, on average) holds each "N of M matches" to a pattern's pair, and
 * each average to the against line, the library's rows and the tracker
 * (facts.library); a season, an act or an episode is no fact the coach is
 * given; and this match's rounds said to be across matches ("the biggest
 * pattern across your recent matches is dying in the first 30 seconds, in
 * rounds 1, 3, 4, 5 and 6", a pattern of this match alone) go.
 */
const CROSS_MATCH = /\b(?:of|in)\s+(?:your|the|their)\s+(?:(?:last|recent|past|previous|latest|recorded|other)\s+){1,2}(?:\d+\s+|few\s+|several\s+)?(?:(?:recent|recorded)\s+)?(?:matches|games)\b|\bacross\s+(?:(?:your|their|the|all|my)\s+)?(?:(?:last|recent|past|previous|other|recorded)\s+){0,2}(?:\d+\s+)?(?:(?:recent|recorded)\s+)?(?:matches|games)\b|\b(?:your|their)\s+(?:own\s+)?(?:usual|normal|typical|overall|average|regular)\b|\b(?:your|their)\s+own\s+\d|\bon average\b|\b(?:recent|last|past)\s+(?:\d+\s+)?(?:matches|games)\b/i;
const SEASON = /\b(?:this|last|the|your|their)\s+(?:season|act|episode)\b|\bseason(?:'s)?\s+(?:average|stats?|numbers?|rank)\b/i;
const LIB_PAIR = /\b(\d+)\s+(?:out\s+)?of\s+(?:(?:your|the|their|those|these)\s+)?(?:(?:last|recent|past|previous|recorded|latest)\s+){0,2}(\d+)\s+(?:(?:recent|recorded|other)\s+)?(?:matches|games)\b/gi;
const AVG_BEFORE = /\b(?:(?:your|their)\s+(?:own\s+)?(?:usual|normal|typical|overall|average|regular)(?:\s+headshot\s+rate)?\s+(?:of\s+|is\s+|was\s+|at\s+|around\s+)?|(?:your|their)\s+own\s+)$/i;
const AVG_AFTER = /^\s*(?:%|percent)?\s+(?:average|on average)\b/i;
const THIS_MATCH = /\b(?:this|that|the)\s+(?:match|game)\b|\bhere\b|\bin it\b/i;
const ROUND_LIST = /\brounds?\s+\d/i;
function gateLibrary(s, facts) {
  const f = facts || {};
  if ((f.language || 'en') !== 'en' || f.game === 'lol') return null;
  const raw = String(s || '');
  const t = digitsOf(raw);
  const season = SEASON.exec(t);
  if (season && !negatedAt(t, season.index) && !ECON_REFUSAL.test(t)) {
    return drop('library', 'your reply named a season, an act or an episode, which the facts hold nothing of; say the numbers of this match and of the matches the facts count');
  }
  if (!CROSS_MATCH.test(t)) return null;
  const lib = f.library || { pairs: new Set(), averages: new Set() };
  for (const m of t.matchAll(LIB_PAIR)) {
    if (!lib.pairs.has(`${m[1]}/${m[2]}`)) {
      return drop('library', `your reply said ${m[1]} of ${m[2]} matches, which no pattern across the player's matches counts; quote the patterns' own numbers or say none`);
    }
  }
  for (const m of t.matchAll(NUMBER)) {
    const value = Number(m[1]);
    const before = t.slice(Math.max(0, m.index - 40), m.index);
    const after = t.slice(m.index + m[1].length, m.index + m[1].length + 20);
    if (!AVG_BEFORE.test(before) && !AVG_AFTER.test(after)) continue;
    if (!lib.averages.has(value)) {
      return drop('library', `your reply gave ${value} as the player's own average, which the facts across their matches do not hold`);
    }
  }
  // This match's rounds told as a pattern across matches.
  const mapNamed = f.map && new RegExp(`(?<![A-Za-z])${esc(f.map)}(?![A-Za-z])`, 'i').test(t);
  if (ROUND_LIST.test(t) && !THIS_MATCH.test(t) && !mapNamed && !new RegExp(LIB_PAIR.source, 'i').test(t)
      && /\bacross\b|\b(?:recent|last|past)\s+(?:\d+\s+)?(?:matches|games)\b/i.test(t)) {
    return drop('library', 'your reply told this match\'s rounds as a pattern across the player\'s matches; say which match they are from');
  }
  return null;
}

/*
 * THE SIDE AND THE SPIKE (coherence.js checkRoundState). "Let the enemy come to
 * you" to an attacker with no spike down, in a round Riot has as an attack the
 * player died in before any plant: the defenders never have to come. Of the
 * round the sentence names, else of the one round asked about; a sentence of
 * no round is held only to the side it names itself ("on attack, let them come
 * to you" with no plant in it).
 */
const PLANT_SAID = /\b(?:after\s+the\s+plant|post[ -]?plant|(?:the\s+)?spike\s+(?:is\s+|was\s+)?(?:down|planted)|once\s+(?:the\s+spike|it)\s+(?:is|was|goes|went)\s+down|planted)\b/i;
function gateRoundState(s, facts, rs) {
  const f = facts || {};
  if ((f.language || 'en') !== 'en' || f.game === 'lol') return null;
  const c = coherence();
  if (!c || typeof c.checkRoundState !== 'function') return null;
  const t = String(s || '');
  const n = rs && rs.round ? (rs.rounds.length === 1 ? rs.rounds[0] : null) : (f.oneRound && f.asked ? f.asked : null);
  const r = n != null && f.rounds instanceof Map ? f.rounds.get(n) : null;
  if (r) {
    const why = c.checkRoundState(t, { side: r.side, planted: r.planted, plantSec: r.plantSec, sec: r.sec, died: r.died, afterPlant: r.afterPlant });
    return why ? drop('state', `your reply got round ${n}'s situation wrong: ${why}`) : null;
  }
  if (rs && rs.round) return null;
  const said = ATTACK_SIDE.test(t) && !DEFENCE_SIDE.test(t) ? 'attacking' : DEFENCE_SIDE.test(t) && !ATTACK_SIDE.test(t) ? 'defending' : null;
  if (!said) return null;
  const planted = PLANT_SAID.test(t);
  // The sentence's own words are the round: the spike down where it says so.
  const why = c.checkRoundState(t, { side: said, planted, afterPlant: planted, died: true });
  return why ? drop('state', `your reply got the situation wrong: ${why}`) : null;
}

/*
 * A HABIT OF DYING FIRST THE RECORD DOES NOT SHOW. "On defence, you are taking
 * the first fight of the round yourself" on the Sunset loss, where the player
 * was the first death in 2 of 17 rounds (two judges). Said of the match, with
 * no round named, the habit of dying first or taking the first fight stands
 * only where Riot's record has the player the first death in a quarter of the
 * rounds or more. A round named is the timeline gate's.
 */
const FIRST_HABIT = /\byou(?:'re|\s+are|\s+were|\s+keep|\s+kept|\s+tend\s+to\s+be|\s+often|\s+usually)\s+(?:(?:often|usually|always|constantly|repeatedly|still)\s+)?(?:taking\s+the\s+first\s+(?:fight|duel|contact|gunfight)|(?:the\s+)?first\s+(?:to\s+die|death|one\s+down|player\s+down)|dying\s+first|die\s+first)\b/i;
function gateFirstHabit(s, facts, rs) {
  const f = facts || {};
  if ((f.language || 'en') !== 'en' || f.game === 'lol' || !(f.rounds instanceof Map) || !f.rounds.size) return null;
  const t = String(s || '');
  if ((rs && rs.round) || !FIRST_HABIT.test(t) || negatedAt(t, t.search(FIRST_HABIT))) return null;
  try { if (roundsNamed(t, f).length) return null; } catch { /* none named */ }
  const all = [...f.rounds.values()];
  const first = all.filter((r) => r.firstDeath).length;
  if (first * 4 >= all.length) return null;
  return drop('habit', `your reply said the player keeps dying first or taking the first fight, where Riot's record has them the first death in ${first} of ${all.length} rounds; say what the record shows`);
}

// ── The blind audit of 8.7.9 (Nov 2026) ───────────────────────────────────

/*
 * THE COSTLIEST FIRST (facts.costRank, from Platinum only). At Ascendant the
 * Fracture answers named the round 2 repeek, a won round, the team 5 against
 * 1 and the death traded, as "your biggest mistake" over round 5, the only
 * lost round, untraded after the plant. A sentence calling one round of a
 * won round the biggest, the main or the costliest mistake, or the one to fix
 * first, goes where a death in a lost round ranks above it.
 */
const BIGGEST_SAID = /\b(?:your|the|this\s+match's)\s+(?:single\s+)?(?:biggest|main|costliest|most\s+costly|worst|largest|real|first)\s+(?:mistake|problem|error|leak|lever|issue)\b|\bthe\s+(?:one|mistake|death|round)\s+to\s+fix\s+first\b|\bthe\s+(?:mistake|death|round)\s+that\s+cost\s+you\s+(?:the\s+)?most\b/i;
function gatePriority(s, facts, rs) {
  const f = facts || {};
  if ((f.language || 'en') !== 'en' || !Array.isArray(f.costRank) || !f.costRank.length || !(f.rounds instanceof Map)) return null;
  const t = String(s || '');
  if (!BIGGEST_SAID.test(t) || isHypothetical(t) || negatedAt(t, t.search(BIGGEST_SAID))) return null;
  let named = [];
  try { named = roundsNamed(t, f); } catch { named = []; }
  if (named.length !== 1) return null;
  const top = f.costRank[0];
  const here = f.costRank.find((x) => x.n === named[0]);
  if (!here || here.result !== 'won' || top.result !== 'lost' || top.n === here.n) return null;
  return drop('priority', `your reply made round ${here.n}, a round your team won, the biggest mistake, where round ${top.n} cost more: a death in a lost round. Name the costliest round first, as THE COSTLIEST DEATHS ranks them`);
}

/*
 * A COUNT OF THE COUNTED MISTAKES (the blind audit of 8.7.9): "this match's
 * one counted decision mistake" where code counted none. A number of counted
 * mistakes (or misses) is the counted list's length, or the sentence goes.
 */
const COUNTED_HOW_MANY = /\b(?:(?:this\s+match's|your|the)\s+)?(one|a\s+single|two|three|four|five|only|only\s+one|no)\s+counted\s+(?:decision\s+|repeated\s+|real\s+|big\s+)?(mistakes?|misses?)\b/i;
const COUNT_WORD = { one: 1, 'a single': 1, two: 2, three: 3, four: 4, five: 5, only: 1, 'only one': 1, no: 0 };
function gateCounted(s, facts) {
  const f = facts || {};
  const c = f.counted || {};
  if ((f.language || 'en') !== 'en' || !Number.isInteger(c.mistakeCount)) return null;
  const m = COUNTED_HOW_MANY.exec(String(s || ''));
  if (!m) return null;
  const said = COUNT_WORD[lower(m[1]).replace(/\s+/g, ' ')];
  const miss = /^miss/i.test(m[2]);
  const has = miss ? c.missedCount : c.mistakeCount;
  if (!Number.isInteger(has) || said === undefined || said === has) return null;
  return drop('count', `your reply said the match had ${said} counted ${miss ? 'miss' : 'mistake'}${said === 1 ? '' : 'es'}, where code counted ${has}; quote the counted lines as given`);
}

/*
 * THE PLAYER'S OWN AGENT IS NO ENEMY (the blind audit of 8.7.9): "14 of your
 * 16 deaths on Split against Jett" to the Jett, whose enemies had no Jett.
 * "Against X", "their X" and "the enemy X" of the player's own agent, where
 * Riot's comp of the enemy team is known and has none, goes. "As Jett against
 * Reyna" names the enemy right.
 */
function gateOwnAgent(s, facts) {
  const f = facts || {};
  const own = f.agent;
  const enemies = f.sides && f.sides.enemies instanceof Set ? f.sides.enemies : null;
  if ((f.language || 'en') !== 'en' || !own || !enemies || enemies.size < 5 || enemies.has(own)) return null;
  const re = new RegExp(`\\b(?:against|versus|vs\\.?|their|the\\s+enemy|an\\s+enemy|enemy)\\s+(?:a\\s+|an\\s+|the\\s+|their\\s+)?(${esc(own)})(?![A-Za-z0-9])`, 'i');
  const m = re.exec(String(s || ''));
  if (!m) return null;
  return drop('own-agent', `your reply named ${own}, the player's own agent, as an enemy, where the enemy team had no ${own}; the player played ${own}`);
}

/*
 * A HIT THAT KILLS AT A HEALTH THE GUN CANNOT REACH (the blind audit of
 * 8.7.9): "at 57 health any clean hit from Astra ends you" of a Sheriff,
 * whose body hit does 55 at its closest range. A health number with one hit
 * said to end it, a body hit or any clean hit, of a gun the sentence names,
 * goes where the primer's most damaging body hit of that gun is below the
 * health. A head hit is held to the head's number. Legs are never "clean".
 */
const HEALTH_AT = /\b(?:at|on|with|had|sitting\s+on|down\s+to)\s+(\d{1,3})\s*(?:health|hp)\b|\b(\d{1,3})\s*(?:health|hp)\s+(?:left|remaining)\b/i;
const ONE_HIT_KILLS = /\b(?:any|a|one|a\s+single|one\s+clean|any\s+clean|a\s+clean|a\s+single\s+clean)\s+(?:clean\s+)?(?:(body|head|chest|torso)\s+)?(?:hit|shot|bullet|tap)\b[^.;]{0,40}?\b(?:ends?|kills?|finish(?:es)?|drops?|takes?\s+you\s+out)\b|\b(?:one|a\s+single)\s+(?:(body|head)\s+)?(?:hit|shot|bullet|tap)\s+(?:away\s+from\s+death|from\s+dying)\b|\b(?:dies|die|died)\s+to\s+(?:one|a\s+single|any)\s+(?:(body|head)\s+)?(?:hit|shot|bullet|tap)\b/i;
function gateLethal(s, facts) {
  const f = facts || {};
  if ((f.language || 'en') !== 'en' || f.game === 'lol' || !Array.isArray(f.primer) || !f.primer.length) return null;
  const t = String(s || '');
  const h = HEALTH_AT.exec(t);
  const k = ONE_HIT_KILLS.exec(t);
  if (!h || !k || isHypothetical(t.slice(0, h.index))) return null;
  const health = Number(h[1] || h[2]);
  if (!(health > 0 && health <= 150)) return null;
  const part = /^head/i.test(k[1] || k[2] || k[3] || '') ? 'head' : 'body';
  const guns = gunsIn(t).map((g) => g.name);
  if (guns.length !== 1) return null;
  const hits = f.primer.filter((e) => e.subjectKind === 'gun' && e.subject === guns[0] && e.attribute === part && fin(e.value));
  if (!hits.length) return null;
  const most = Math.max(...hits.map((e) => e.value));
  if (most >= health) return null;
  return drop('lethal', `your reply said one ${part} hit of the ${guns[0]} kills at ${health} health, where its ${part} hit does at most ${Math.floor(most)}; say the hits to kill as the facts give them`);
}

/*
 * UTILITY THE TEAM DOES NOT HAVE (the blind audit of 8.7.9): "have a
 * teammate's flash, dart or drone clear the star spots" to a team of Chamber,
 * Clove, Jett, KAY/O and Reyna, none of whom has a dart or a drone. A dart,
 * a drone, a recon or a prowler asked of a teammate, or named as the player's
 * own, goes where Riot's comp of the player's team is known and no agent of
 * it has one in the game data's kit. A flash, a smoke or a stun is many
 * agents' and judges nothing.
 */
const UTILITY_OWNERS = (() => {
  const out = {};
  const words = { drone: /\bdrones?\b/i, dart: /\bdarts?\b/i, recon: /\brecon\b/i, prowler: /\bprowlers?\b/i };
  for (const [agent, a] of Object.entries(DATA.agents || {})) {
    for (const k of (a && a.kit) || []) {
      const text = `${(k && k.name) || ''} ${(k && (k.description || k.desc)) || ''}`;
      for (const [w, re] of Object.entries(words)) if (re.test(text)) (out[w] = out[w] || new Set()).add(agent);
    }
  }
  // Sova's Recon Bolt is "the dart" in every lobby.
  if (out.recon) for (const a of out.recon) (out.dart = out.dart || new Set()).add(a);
  return out;
})();
// "Ask a teammate for a drone", "wait for a teammate to drone the site" too (the stream C review).
const UTILITY_ASKED = /\b(?:a\s+teammate's|your\s+teammate's|your\s+team's|their\s+own|a\s+team\s?mate's|an?\s+ally's|your|the\s+team's|with\s+a|on\s+a|behind\s+a|after\s+a|ask\s+(?:a|your|the)\s+teammates?\s+for|(?:a|your)\s+teammates?\s+to)\s+(?:[a-z]+,?\s+(?:or\s+|and\s+)?){0,3}?(drones?|darts?|recon(?:\s+(?:bolt|dart))?|prowlers?)\b/gi;
// "a flash or a drone" and "flash/drone" are lists too (the stream C review).
const UTIL_LIST = /\b(?:flash|smoke|stun|molly|wall|drones?|darts?|recon(?:\s+(?:bolt|dart))?|prowlers?)(?:\s*,\s*|\s+(?:or|and)\s+|\s*\/\s*)(?:(?:a|an|their|your)\s+)?(?:(?:flash|smoke|stun|molly|wall|drones?|darts?|recon(?:\s+(?:bolt|dart))?|prowlers?)(?:\s*,\s*|\s+(?:or|and)\s+|\s*\/\s*)(?:(?:a|an|their|your)\s+)?)*(drones?|darts?|recon(?:\s+(?:bolt|dart))?|prowlers?)\b/gi;
const UTILITY_OURS = /\b(?:teammates?(?:'s)?|team\s?mates?(?:'s)?|ally(?:'s)?|allies|your\s+team(?:'s)?|your\s+(?:[a-z]+\s+){0,2}?(?:drones?|darts?|recon|prowlers?))\b/i;
function gateTeamUtility(s, facts) {
  const f = facts || {};
  const mates = f.sides && f.sides.mates instanceof Set ? f.sides.mates : null;
  if ((f.language || 'en') !== 'en' || f.game === 'lol' || !mates || mates.size < 5) return null;
  const t = String(s || '');
  const said = new Set();
  for (const m of t.matchAll(new RegExp(UTILITY_ASKED.source, 'gi'))) said.add(lower(m[1]).replace(/s$/, '').replace(/\s+(?:bolt|dart)$/, ''));
  for (const m of t.matchAll(new RegExp(UTIL_LIST.source, 'gi'))) for (const w of m[0].match(/drones?|darts?|recon|prowlers?/gi) || []) said.add(lower(w).replace(/s$/, ''));
  // "After a dart reveals you", "they push in on a drone": the enemy's, where
  // their known comp has one and nothing ties it to the player's side (verify round 6).
  const enemies = f.sides.enemies instanceof Set && f.sides.enemies.size >= 5 ? f.sides.enemies : null;
  const ours = UTILITY_OURS.test(t);
  for (const w of said) {
    const owners = UTILITY_OWNERS[w];
    if (!owners || !owners.size) continue;
    if (!ours && enemies && [...enemies].some((a) => owners.has(a))) continue;
    if (![...mates].some((a) => owners.has(a))) {
      return drop('team-utility', `your reply asked for a ${w}, which no agent on the player's team has (${[...mates].join(', ')}); name only utility the player's agent or a teammate in the comp has`);
    }
  }
  return null;
}

/*
 * THE MISSING UTILITY TAKEN OUT OF ITS LIST (the blind audit of round 8,
 * stream C: Pearl 1 to 5 Plat review, "enter on a teammate's flash or drone"
 * to Jett, Phoenix, Raze, Reyna and Yoru, who have flashes and no drone).
 * Where gateTeamUtility would drop a sentence and every utility it names
 * that the team lacks stands in a list with one it has, that one is taken out
 * of the list ("a teammate's flash or drone" is "a teammate's flash") and the
 * sentence kept: { rewrite }. A sentence still asking for what nobody has,
 * once the lists are cut, is { drop }. Null where the gate has nothing.
 */
const UTIL_ITEM = /^(?:flash|smoke|stun|molly|wall|drones?|darts?|recon(?:\s+(?:bolt|dart))?|prowlers?)$/i;
const UTIL_SEP = /(\s*,\s*(?:(?:or|and)\s+)?|\s+(?:or|and)\s+|\s*\/\s*)/i;
// An item's own article or owner in a list: "a flash or a drone", "your flash or their drone" (the stream C review).
const UTIL_ART = /^(?:a|an|their|your)\s+/i;
// The list is utility asked of the player's team: "a teammate's", "your", "ask ... for", "play off", "wait for".
const UTIL_TEAM_ASK = /\b(?:teammates?(?:'s)?|team\s?mates?(?:'s)?|an?\s+ally(?:'s)?|allies|your(?:\s+team(?:'s)?)?|ask(?:\s+\S+){0,3}\s+for|play(?:ing)?\s+off|wait(?:ing)?\s+for)\b/i;
const UTIL_TEAM_AFTER = /^\s*(?:from|by)\s+(?:a\s+|an\s+|your\s+|the\s+)?(?:teammates?|team|ally|allies)\b/i;
const UTIL_ENEMY_OWNER = /\b(?:their|the\s+enemy(?:'s)?|enemy|enemies|opponents?(?:'s)?|they|them)\b/i;
function teamUtilityFix(s, facts) {
  const first = gateTeamUtility(s, facts);
  if (!first) return null;
  const f = facts || {};
  const mates = f.sides.mates;
  const enemies = f.sides.enemies instanceof Set ? [...f.sides.enemies] : [];
  const has = (w) => {
    const key = lower(w).replace(UTIL_ART, '').replace(/\s+(?:bolt|dart)$/, '').replace(/s$/, '');
    const owners = UTILITY_OWNERS[key];
    // A utility the game data gives nobody (a flash, a smoke) is no claim here.
    return !owners || !owners.size || [...mates].some((a) => owners.has(a));
  };
  const text = String(s || '');
  const ITEM = 'flash|smoke|stun|molly|wall|drones?|darts?|recon(?:\\s+(?:bolt|dart))?|prowlers?';
  const re = new RegExp(`\\b(?:(?:a|an|your)\\s+)?(?:${ITEM})(?:${UTIL_SEP.source}(?:(?:a|an|their|your)\\s+)?(?:${ITEM}))+\\b`, 'gi');
  let changed = false;
  const out = text.replace(re, (list, ...rest) => {
    const at = rest[rest.length - 2];
    // Only the team's utility is cut: a list owned by an enemy agent or
    // "their" is left as it is, and the sentence goes (the stream C review).
    const before = text.slice(0, at);
    const clause = before.split(/[.;:!?]|,\s+(?:so|and|but|then|while)\s+/).pop();
    const near = clause.slice(-30);
    const enemyNear = UTIL_ENEMY_OWNER.test(near) || enemies.some((a) => new RegExp(`(?<![A-Za-z0-9])${a.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}(?![A-Za-z0-9])`, 'i').test(near));
    const teamAsk = UTIL_TEAM_ASK.test(clause) || UTIL_TEAM_AFTER.test(text.slice(at + list.length));
    if (!teamAsk || enemyNear) return list;
    const parts = list.split(new RegExp(UTIL_SEP.source, 'i')).filter((x, i) => i % 2 === 0).map((x) => x.trim()).filter((x) => UTIL_ITEM.test(x.replace(UTIL_ART, '')));
    const kept = parts.filter(has);
    if (kept.length === parts.length || !kept.length) return list;
    changed = true;
    const conj = /\sand\s/i.test(list) && !/\sor\s/i.test(list) ? 'and' : 'or';
    // The list's own first article stays, before the first kept item; the items' own go.
    const lead = (UTIL_ART.exec(parts[0]) || [''])[0];
    const items = kept.map((x) => x.replace(UTIL_ART, ''));
    const art = /^[aeiou]/i.test(items[0]) ? 'an' : 'a';
    const head = /^an?\s+$/i.test(lead) ? `${/^A/.test(lead) ? art[0].toUpperCase() + art.slice(1) : art} ` : lead;
    return head + (items.length === 1 ? items[0] : `${items.slice(0, -1).join(', ')} ${conj} ${items[items.length - 1]}`);
  });
  if (!changed) return { drop: first };
  const again = gateTeamUtility(out, facts);
  return again ? { drop: again } : { rewrite: out };
}

/*
 * THE STALE BUY HEDGE (the blind audit of 8.7.9): "The record does not hold
 * what either of you bought" over a match whose round lines give the team's
 * buy (8.8). A sentence saying the record does not hold the buy goes where
 * a round of the match has it; one about the enemy's buy alone, the credits
 * or the damage, which the record still does not hold, stays.
 */
const BUY_HEDGE_SAID = /\b(?:record|facts|data)\b[^.]{0,60}?\b(?:does not|doesn't|do not|don't|did not|didn't|never)\s+(?:hold|show|have|say|record|keep|include|tell)\b[^.]{0,40}?\b(?:what\s+(?:you|either\s+of\s+you|anyone|your\s+team|both\s+of\s+you|each\s+of\s+you)\s+(?:bought|had|carried)|the\s+(?:buys?|economy)|your\s+(?:buys?|economy))\b/i;
const BUY_HELD_SAID = /\b(?:team(?:'s)?\s+(?:buy|economy)|pistol\s+round|eco(?:\s+round)?|force\s+buy|half\s+buy|full\s+buy)\b|\b(?:yourself|personally|on\s+your\s+own|any\s+one\s+player|each\s+player|one\s+player)\b/i;
function gateStaleBuy(s, facts) {
  const f = facts || {};
  if ((f.language || 'en') !== 'en' || !(f.rounds instanceof Map)) return null;
  if (!BUY_HEDGE_SAID.test(String(s || ''))) return null;
  if (![...f.rounds.values()].some((r) => r && r.buy)) return null;
  // "The record does not hold what you bought yourself, only that your team
  // was on a half buy": the one player's buy beside the team's, as the rules
  // ask (chat-prompt.js BUY_HEDGE_RECORD, verify round 6).
  if (BUY_HELD_SAID.test(String(s || ''))) return null;
  return drop('economy', "your reply said the record does not hold the buy, where the round lines give the team's buy; say the team's buy where its round states it, and that no one player's buy is held");
}

/*
 * A ONE SHOT THE DAMAGE TABLE DOES NOT GIVE (round 8, round 7's Sunset Iron
 * answer): "the Outlaw's one-shot body at any range", whose body hit is 140
 * against Heavy Armor's 150. A one hit kill of a named part of one named gun
 * goes where Heavy Armor from full health takes more than one, held to the
 * primer's own hits for the match's patch (game-claims.js checkOneShot). A
 * sentence naming its armour, a negation or no part judges nothing.
 */
function gateOneShot(s, facts) {
  const f = facts || {};
  if ((f.language || 'en') !== 'en' || f.game === 'lol') return null;
  const why = claims.checkOneShot(s, Array.isArray(f.primer) ? f.primer : null);
  return why ? drop('oneshot', why) : null;
}

/*
 * FIRING WHILE MOVING TOLD AS THE PLAY (round 8, round 7's Pearl Iron aim
 * answer): "pair that with bursting and moving", beside the primer's own
 * "moving, jumping or spraying widens every gun" (game-claims.js checkMoveFire).
 */
function gateMoveFire(s, facts) {
  const f = facts || {};
  if ((f.language || 'en') !== 'en' || f.game === 'lol') return null;
  const why = claims.checkMoveFire(s);
  return why ? drop('move-fire', why) : null;
}

/*
 * BULLETS THROUGH A KIT (round 8, round 7's Corrode Silver review): the game's
 * text calls Contingency only "vision-blocking", and the model repeated it.
 * "Contingency is just a smoke, bullets go through it" goes, held to
 * kit-rules.json (game-claims.js checkBullets); "High Tide blocks bullets"
 * goes by the kit gate's bullets class (ability-facts.js).
 */
function gateBullets(s, facts) {
  const f = facts || {};
  if ((f.language || 'en') !== 'en' || f.game === 'lol') return null;
  const why = claims.checkBullets(s);
  return why ? drop('kit', why) : null;
}

/*
 * WHAT ONLY A LOOK COULD SEE (round 8, round 7's Corrode Plat aim answer):
 * "your crosshair sat too deep toward the wall" of a death whose look said
 * only "you held the gap and Fade appeared in it". Where the crosshair was,
 * or what the player saw, said as fact of the match, goes unless the look of
 * the round the sentence is about speaks of it, or, where no round is known,
 * any look of the match does (game-claims.js checkUnobserved).
 */
function gateUnseen(s, facts, rs) {
  const f = facts || {};
  if ((f.language || 'en') !== 'en' || f.game === 'lol') return null;
  const t = String(s || '');
  if (!claims.UNOBSERVED.test(t)) return null;
  const rounds = f.rounds instanceof Map ? f.rounds : new Map();
  // What the look saw, never its better play: "keep your crosshair at head height" is advice, no sight of where it sat.
  const lookOf = (r) => (r && r.look ? String(r.look.what || '') : '');
  const named = rs && Array.isArray(rs.rounds) && rs.rounds.length ? rs.rounds : (f.asked && f.oneRound ? [f.asked] : null);
  const text = named ? named.map((n) => lookOf(rounds.get(n))).join(' ') : [...rounds.values()].map(lookOf).join(' ');
  const why = claims.checkUnobserved(t, text);
  return why ? drop('unseen', why) : null;
}

/*
 * HOW MANY DEATHS THE COACH LOOKED AT (the blind audit of round 8, stream C:
 * Fracture 5 to 1 Ascendant, aim). "The coach looked at one of your deaths"
 * where it looked at all three. A number of deaths said to be looked at
 * ("the coach looked at one of your deaths", "I looked at two deaths", "the
 * coach only reviewed 2 of your 3 deaths"), or the looked at total of a
 * count ("1 of the 3 deaths the coach looked at"), is the match's own count
 * of deaths with a look, with its unclear looks or without them, or the
 * sentence goes. A deaths total said beside it ("2 of your 3 deaths") is
 * held to the deaths too.
 */
const LOOK_NUM = '(\\d{1,2}|one|a\\s+single|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|all\\s+(?:\\d{1,2}|two|three|four|five|six|seven|eight|nine|ten)|both)';
// "The coach had a look at one of your deaths", "the coach's look covered one" (the stream C review). Group 3 is a word before "deaths".
const LOOKED_AT = new RegExp(`\\b(?:the\\s+coach(?:'s\\s+looks?)?|I|we)\\s+(?:only\\s+|also\\s+)?(?:looked\\s+(?:closely\\s+)?(?:at|into)|reviewed|examined|studied|went\\s+through|checked|covered|(?:had|took)\\s+a\\s+(?:close\\s+)?look\\s+at)\\s+(?:only\\s+|just\\s+|exactly\\s+)?${LOOK_NUM}\\s+(?:(?:of\\s+)?(?:your|the|those|its)\\s+)?(?:(\\d{1,2}|two|three|four|five|six|seven|eight|nine|ten)\\s+)?(\\w+\\s+)?deaths?\\b`, 'i');
const LOOKED_TOTAL = new RegExp(`\\b${LOOK_NUM}\\s+of\\s+the\\s+(\\d{1,2}|two|three|four|five|six|seven|eight|nine|ten)\\s+deaths?\\s+(?:that\\s+)?(?:the\\s+coach|I|we)\\s+(?:looked\\s+at|reviewed|examined)\\b`, 'i');
// The passive and the noun: "one of your deaths was looked at by the coach", "one death got a look from the coach".
const LOOKED_BY = new RegExp(`\\b${LOOK_NUM}\\s+(?:of\\s+(?:your|the)\\s+(?:(\\d{1,2}|two|three|four|five|six|seven|eight|nine|ten)\\s+)?)?deaths?\\s+(?:(?:was|were|got|had\\s+been|has\\s+been|have\\s+been)\\s+(?:looked\\s+at|reviewed|examined|checked|studied)\\s+by|(?:got|had|received|drew)\\s+(?:a\\s+)?(?:look|review)\\s+(?:from|by))\\s+the\\s+coach\\b`, 'i');
// "Two of your deaths that ended in lost duels", "both deaths on defence", "one of your deaths to Sova": a part of the deaths, not all.
const LOOK_SUBSET = /^\s*(?:that|which|where|when|whose|against|during|in\s+(?:rounds?|the\s+(?:first|second)\s+half|[abc]\b)|on\s+(?:attack|defen[cs]e|offen[cs]e|[abc]\b|the\s+\w+\s+side|\w+\s+site|the\s+(?:pistol|eco))|from\s+(?:the|an?)\b|with\s+(?:the|an?)\b)\b/i;
const LOOK_SUBSET_AGENT = /^\s*(?:to|by|against)\s+(?:(?:their|the|an?)\s+)?[A-Z]/;
const LOOK_WORD_OK = /^(?:other|total|own|recorded)$/i;
const lookNum = (w) => {
  const x = lower(w).replace(/\s+/g, ' ').replace(/^all /, '');
  if (/^\d+$/.test(x)) return Number(x);
  if (x === 'a single') return 1;
  if (x === 'both') return 2;
  return NUMBER_WORDS[x] !== undefined ? NUMBER_WORDS[x] : null;
};
function gateLookCount(s, facts) {
  const f = facts || {};
  if ((f.language || 'en') !== 'en' || f.game === 'lol' || !(f.rounds instanceof Map) || !f.rounds.size) return null;
  const t = String(s || '');
  const rows = [...f.rounds.values()].filter((r) => r && r.died);
  const looked = rows.filter((r) => r.look);
  const counts = new Set([looked.length, looked.filter((r) => r.look.cause !== 'unclear').length]);
  const deaths = new Set([rows.length].concat(fin(f.counted && f.counted.died) ? [f.counted.died] : []));
  const a = LOOKED_AT.exec(t);
  const tailOf = (x) => t.slice(x.index + x[0].length);
  const subset = (x, word) => (!!word && !LOOK_WORD_OK.test(word.trim())) || LOOK_SUBSET.test(tailOf(x)) || LOOK_SUBSET_AGENT.test(tailOf(x));
  if (a && !negatedAt(t, a.index) && !isHypothetical(t.slice(0, a.index)) && !subset(a, a[3])) {
    const said = lookNum(a[1]);
    const total = a[2] ? lookNum(a[2]) : null;
    if (said !== null && !counts.has(said)) {
      return drop('looks', `your reply said the coach looked at ${said} of the player's deaths, where it looked at ${looked.length}; say how many deaths the coach looked at as the facts give it`);
    }
    if (total !== null && !deaths.has(total)) return drop('looks', `your reply gave the player ${total} deaths, where the match has ${rows.length}`);
  }
  const b = LOOKED_TOTAL.exec(t);
  if (b && !negatedAt(t, b.index)) {
    const total = lookNum(b[2]);
    if (total !== null && !counts.has(total)) {
      return drop('looks', `your reply said the coach looked at ${total} of the player's deaths, where it looked at ${looked.length}; say how many deaths the coach looked at as the facts give it`);
    }
  }
  const c = LOOKED_BY.exec(t);
  if (c && !negatedAt(t, c.index) && !isHypothetical(t.slice(0, c.index))) {
    const said = lookNum(c[1]);
    const total = c[2] ? lookNum(c[2]) : null;
    if (said !== null && !counts.has(said)) {
      return drop('looks', `your reply said the coach looked at ${said} of the player's deaths, where it looked at ${looked.length}; say how many deaths the coach looked at as the facts give it`);
    }
    if (total !== null && !deaths.has(total)) return drop('looks', `your reply gave the player ${total} deaths, where the match has ${rows.length}`);
  }
  return null;
}

// ── The coach bench 9 (Nov 2026) ──────────────────────────────────────────

/*
 * THE ECONOMY IS OUT OF SCOPE (the owner's rule after the coach bench 9): a
 * sentence with an economy claim or economy advice goes, whatever it says
 * (game-claims.js economyClaim). The team's kind of round where Riot's record
 * gives it for the round named ("round 4 was your team's full buy") is the
 * record's own fact and stays, as gateEconomy keeps it; the record gate holds
 * which kind. Valorant, English.
 */
const RECORD_KIND_WORDS = /\b(?:full|half|force)[ -]buy\b|\bforced\s+(?:a\s+)?buy\b/gi;
// The clause after a refusal's turn: "..., but the rule answers it: buy what they buy".
const ECON_REFUSAL_REST = /\b(?:but|however|still|instead|though)\b(.*)$/i;
function gateEconomyScope(s, facts, rs) {
  const f = facts || {};
  if ((f.language || 'en') !== 'en' || f.game === 'lol') return null;
  let t = String(s || '');
  const rounds = f.rounds instanceof Map ? f.rounds : new Map();
  if (rs && rs.round && rs.rounds.length && rs.rounds.every((n) => rounds.get(n) && RECORD_BUY_KINDS.has(rounds.get(n).buy))) {
    t = t.replace(RECORD_KIND_WORDS, 'kind');
  }
  // Saying the record does not hold a buy is no claim (ECON_REFUSAL); what follows a "but" after it still is.
  if (ECON_REFUSAL.test(t)) {
    const rest = ECON_REFUSAL_REST.exec(t);
    if (!rest) return null;
    t = rest[1];
  }
  const why = claims.economyClaim(t);
  return why ? drop('economy-scope', why) : null;
}

/*
 * A WON OR LOST PISTOL THE PLAYER DID NOT HAVE (the coach bench 9): held to
 * the match's pistol round where a match is attached, else to the player's own
 * words (facts.pistol, chat-prompt.js factsOf; game-claims.js checkPistolPremise).
 */
function gatePistolPremise(s, facts) {
  const f = facts || {};
  if ((f.language || 'en') !== 'en' || f.game === 'lol') return null;
  const why = claims.checkPistolPremise(s, f.pistol === 'won' || f.pistol === 'lost' ? f.pistol : null);
  return why ? drop('premise', why) : null;
}

/*
 * NO HABIT OF THE WHOLE MAP AS FACT (the coach bench 9): "on Haven, C is the
 * site a five-stack with no lurks reaches last" (game-claims.js checkMapHabit).
 */
function gateMapHabit(s, facts) {
  const f = facts || {};
  if ((f.language || 'en') !== 'en' || f.game === 'lol') return null;
  const why = claims.checkMapHabit(s);
  return why ? drop('map-habit', why) : null;
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
  // The round 3 audit's (Nov 2026): after every gate before, so a sentence
  // those dropped is counted as it always was.
  ['template', gateTemplate],
  ['aim', gateAim],
  ['kit', gateKit],
  ['mode', gateMode],
  ['ability-kill', gateAbilityKill],
  // The re-audit of 8.7.7 (Nov 2026), after every gate before.
  ['product', gateProduct],
  // The coach bench (Nov 2026): no record cited where no match is attached.
  ['no-record', gateNoRecord],
  ['library', gateLibrary],
  ['state', gateRoundState],
  ['habit', gateFirstHabit],
  // The blind audit of 8.7.9 (Nov 2026), after every gate before.
  ['priority', gatePriority],
  ['counted', gateCounted],
  ['own-agent', gateOwnAgent],
  ['lethal', gateLethal],
  ['team-utility', gateTeamUtility],
  ['stale-buy', gateStaleBuy],
  // Round 8 (Nov 2026), after every gate before.
  ['oneshot', gateOneShot],
  ['move-fire', gateMoveFire],
  ['bullets', gateBullets],
  ['unseen', gateUnseen],
  // The blind audit of round 8, stream C, after every gate before.
  ['looks', gateLookCount],
  // The coach bench 9 (Nov 2026), after every gate before.
  ['economy-scope', gateEconomyScope],
  ['premise', gatePistolPremise],
  ['map-habit', gateMapHabit],
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
  PHRASES, CAUSE_TITLES, CAUSE_WORDS, NOT_TRADED, WAS_TRADED, TRADE_AS_HARM, TRADED_YOU, MATE_TRADED_YOU, YOU_PLANTED, RIOT_ID, META, ATTRIBUTION,
  HYPOTHETICAL, IMPERATIVE, INSTRUCTION_WORDS, STANDING, CLOCK, ECONOMY, SPELLED, NUMBER_WORDS, LABELLING,
  KILLED_YOU, YOU_DIED_TO, YOU_KILLED, PAST_ABOUT_YOU, AFTER_UNITS, BEFORE_UNITS, ARMOR_NAMED,
  GUNS, AGENTS, MAPS, GEAR, KIT, CALLOUTS,
  // The verifier's additions of 15 Oct, each asserted in test:chatgates.
  lowerGameWords, GAME_CAPS, REVIEW_CAPS, CHAT_CAPS, AGENT_RANKED, TIER, RATE_RANKED, MOST_PICKED, PATCH_NOW, META_REFUSED,
  RESULT_NOUN_LOST, RESULT_NOUN_WON, YOUR_GUN_PAST, THEIRS_FIRST, ABS_TIME, DEATH_CLAIM, OTHER_EVENT, OWN_COUNT_BEFORE,
  ECON_REFUSAL, BUY_KIND_WORD, ROUND_TIMES, CHAMPION_RANKED, CHAMPION_META, quotesCounted,
  // The bench:chat run of 15 Oct, each asserted in test:chatgates.
  straighten, CURLY_SINGLE, CURLY_DOUBLE, claimsOf, matchClaims, ofTheMatch, gunOwner, playerUses,
  PISTOL_ROUND, PISTOL_DESCRIBED, PISTOL_SECOND_AFTER, ROUND_SECONDS, OBJECT_IS_ROUND, MATCH_AFTER, SCORE_AFTER, SCORE_BEFORE,
  MATCH_BEFORE, NAMED_WIN_BEFORE, MAP_AFTER, OBJECT_BEFORE, CLEFT_BEFORE, CLEFT_AFTER,
  GUN_MINE_BEFORE, GUN_THEIRS_BEFORE, GUN_WITH_BEFORE, YOU_KILLED_PASSIVE, TOWARD_SOMEONE, CLAUSE_START, PEEK_AGAIN, negatedAt,
  // The bench:chat run of 23 Oct, each asserted in test:chatgates.
  clutchOwner, standingClaims, leftByDeath, leansOn, STANDING_WORDS, ALONE_AGAINST, LEFT_BY, PLAYER_DEATH, AFTER_DEATH, EVENT_BETWEEN, CLAUSE_BETWEEN,
  scopeOf, ROUND_MENTION, LEANS_TIME, LEANS_SUBJECT, IT_IS_THE_ROUND, LEANS_TRADE, LEAN_ANCHOR, CLUTCH,
  // The verifier's probe of 23 Oct, each asserted in test:chatgates.
  gateLeftAcross, deathsWord, sinceDeath, CARRIES_ON, LEFT_FINITE, AFTER_DEATH_NEXT, AT_THE_DEATH, DATED_LATER, CLAUSE_MARK,
  DEATH_SUBJECT, OTHER_TIME, LEFT_OPENER, OWNER_CARRIES, NEW_CLAUSE,
  // The round 3 audit (Nov 2026), each asserted in test:chatgates.
  gateTemplate, gateAim, gateKit, gateMode, gateAbilityKill, pairWords, shareOk, singleRoundBefore, leadInstruction,
  OF_TOTAL_BEFORE, PEEK_TWICE, TRADED_MATES_TIMES, repeekTwice,
  PAIR_FILLER, KEEPING_WORTH, CLUTCH_AGAINST_BEFORE, OF_YOUR_NOUN, SMALL_ADVICE_AFTER, LEAD_CONDITION, ONE_ROUND,
  TEMPLATE_WORDS, AIM_DISMISSED, SOLO_MODE, TEAM_WORDS, NO_TEAM, KILL_AFTER_ABILITY, KILL_BEFORE_ABILITY,
  // The re-audit of 8.7.7 (Nov 2026), each asserted in test:chatgates.
  gateProduct, gateNoRecord, NO_RECORD_SAID, gateLibrary, gateRoundState, gateFirstHabit, FIRST_HABIT, AIM_PRAISED, AVOIDABLE, CROSS_MATCH, SEASON, LIB_PAIR, AVG_BEFORE, AVG_AFTER, THIS_MATCH, PLANT_SAID,
  // The blind audit of 8.7.9 (Nov 2026), each asserted in test:chatgates.
  gatePriority, gateCounted, gateOwnAgent, gateLethal, gateTeamUtility, gateStaleBuy,
  // Round 8 (Nov 2026), each asserted in test:chatgates and test:gameclaims.
  gateOneShot, gateMoveFire, gateUnseen, gateBullets,
  // The blind audit of round 8, stream C, each asserted in test:chatgates.
  gateLabelAcross, ROUNDS_ANAPHOR, LOOK_SEEN, gateLookCount, LOOKED_AT, LOOKED_TOTAL, teamUtilityFix, UTIL_ITEM, UTIL_SEP,
  // Its review.
  LOOK_SEEN_SOFT, LOOK_WORDS, lookSeenAt, LOOK_ANAPHOR, LOOKED_BY, LOOK_SUBSET, LOOK_SUBSET_AGENT, UTIL_ART, UTIL_TEAM_ASK, UTIL_TEAM_AFTER, UTIL_ENEMY_OWNER,
  // The coach bench 9 (Nov 2026), each asserted in test:chatgates.
  gateEconomyScope, gatePistolPremise, gateMapHabit, RECORD_KIND_WORDS,
  BIGGEST_SAID, COUNTED_HOW_MANY, HEALTH_AT, ONE_HIT_KILLS, UTILITY_OWNERS, UTILITY_ASKED, UTIL_LIST, BUY_HEDGE_SAID, UTILITY_OURS, BUY_HELD_SAID, KIT_KILLS_YOU, KIT_KILLED_YOU,
};
