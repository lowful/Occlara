'use strict';

/*
 * COHERENCE AFTER THE GATES, SHARED BY ASK COACH AND THE REVIEW (the round 3
 * re-audit of 8.7.7, Nov 2026). The gates drop a false sentence and keep the
 * rest, and what was kept could lean on what went: "Fight her with a teammate
 * or after a flash, never one on one." stood with the Reyna sentence before it
 * dropped, read by five judges as broken text; "You did plenty right." ended a
 * paragraph whose list had gone; "Take your peeks one step from cover with it
 * up" had lost its Double Tap. And the coach talked about the product to the
 * player: "so your next review can check whether the fight had an answer".
 *
 * Three readers, each over plain English text, none of them a repair: what
 * they find is dropped by the caller, never rewritten.
 *
 *   checkOrphans(text | sentences | rows, opts) the kept sentences that lean on
 *       nothing: a he, she, him or her with no agent before it who could be
 *       meant, a lead in ("You did plenty right.", "Here is how:") whose
 *       promise went, "with it up" or "those rounds" after a dropped sentence.
 *   checkProduct(text | sentences) the sentences that talk about the app, a
 *       future review, a page or a feature of it.
 *   checkRoundState(sentence, round) the reason a sentence about one round
 *       gets its side or the spike wrong ("let the enemy come to you" on
 *       attack with no spike down), else null.
 *
 * No require from src/ (check:server), and nothing but the game data's agent
 * list, so the review side may load it as it is.
 */

let DATA = {};
try { DATA = require('../valorant-data.generated.json'); } catch { DATA = {}; }

const esc = (s) => String(s).replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
const lower = (s) => String(s == null ? '' : s).toLowerCase();
const SINGLE_CURLY = new RegExp('[' + String.fromCharCode(0x2018, 0x2019, 0x02BC) + ']', 'g');
const DOUBLE_CURLY = new RegExp('[' + String.fromCharCode(0x201C, 0x201D) + ']', 'g');
const straight = (s) => String(s == null ? '' : s).replace(SINGLE_CURLY, "'").replace(DOUBLE_CURLY, '"');

const AGENTS = Object.keys(DATA.agents || {});
const AGENT_ALT = AGENTS.map(esc).sort((a, b) => b.length - a.length).join('|') || 'NO_AGENT';
const AGENT_RE = new RegExp(`(?<![A-Za-z0-9])(${AGENT_ALT})(?![A-Za-z0-9])`, 'g');

/*
 * WHO A HE OR A SHE CAN BE. The agents as the game presents them; one the
 * list does not name (KAY/O, Clove, an agent added after this was written)
 * can be either, so it never makes a pronoun an orphan.
 */
const FEMALE = new Set(['Astra', 'Deadlock', 'Fade', 'Jett', 'Killjoy', 'Neon', 'Raze', 'Reyna', 'Sage', 'Skye', 'Viper', 'Vyse', 'Waylay']);
const MALE = new Set(['Breach', 'Brimstone', 'Chamber', 'Cypher', 'Gekko', 'Harbor', 'Iso', 'Omen', 'Phoenix', 'Sova', 'Tejo', 'Yoru']);
// A person a pronoun may stand for that is no agent by name: the enemy, the
// killer, a teammate. Read in the sentence itself and the kept one right
// before it, never further back: "Fight her with a teammate" with no agent
// named anywhere stood on a teammate six sentences earlier.
const PERSON_NOUN = /\b(?:enemy|enemies|killer|opponent|opponents|duelist|sentinel|controller|initiator|defender|attacker|lurker|anchor|teammates?|ally|allies|player)\b/i;
const HE = /\b(?:he|him|his|himself)\b/i;
const SHE = /\b(?:she|her|hers|herself)\b/i;

/** The sentences of a text: split after . ! ? before a capital or a digit, decimals kept whole. */
function sentencesOf(text) {
  const t = String(text == null ? '' : text).replace(/\s+/g, ' ').trim();
  if (!t) return [];
  return t.split(/(?<=[.!?])\s+(?=["'(]?[A-Z0-9])/).map((s) => s.trim()).filter(Boolean);
}

function rowsOf(input) {
  if (Array.isArray(input)) {
    return input.map((x) => (x && typeof x === 'object'
      ? { s: String(x.s == null ? x.text || '' : x.s), dropped: !!(x.dropped || x.drop), p: x.p == null ? null : x.p }
      : { s: String(x == null ? '' : x), dropped: false, p: null }));
  }
  // A text: each paragraph its own, so a lead in that ends one is read as ending it.
  const rows = [];
  String(input == null ? '' : input).split(/\n\s*\n/).forEach((para, p) => { for (const s of sentencesOf(para)) rows.push({ s, dropped: false, p }); });
  return rows;
}

/** The agents a text names, each canonical. */
function agentsNamed(text) {
  const out = new Set();
  for (const m of String(text || '').matchAll(AGENT_RE)) out.add(m[1]);
  return out;
}

/*
 * A LEAD IN: a short sentence that promises what comes next. With what it
 * promised dropped, or with nothing after it in its paragraph, it says
 * nothing: "You did plenty right." with the list of what went right gone.
 */
const LEAD_IN = /^(?:(?:but|and|so|still)\s*,?\s+)?(?:you did (?:plenty|a lot|some things|several things|a few things|things|well|good things)(?: right| well)?|here(?:'s| is) (?:how|why|what|the (?:fix|habit|drill|plan|good news|part|thing|round|problem|pattern))|(?:there (?:are|were|is|was) )?(?:two|three|a few|several|one) (?:things?|habits?|parts?|points?|reasons?)(?: (?:to|you|that|worth)[a-z ]*)?|the (?:fix|habit|drill|plan|lesson|answer|good news|positive) is (?:simple|this|clear|one thing)|(?:that|this) is (?:how|why|what)|(?:the )?(?:good|positive) (?:news|side)(?: first)?|what went (?:right|well)|on the (?:plus|bright) side|because you(?:'re| are) (?:on |playing )?[A-Z][A-Za-z/]+, you can [^.]{0,80})[.!:]?$/i;
const ENDS_COLON = /:\s*$/;
// "with it up", "pop it", "use it": an it bound to a thing named before.
const IT_OBJECT = /\b(?:with|use|using|pop|popping|keep|keeping|save|saving|throw|throwing|place|placing|activate|activating|put|putting|hold|holding)\s+it\s+(?:up|down|out|ready|first|early|back|before|when|until|for|on|so|and|,|\.)/i;
// "those rounds", "these deaths": the rounds of a sentence that went.
const THOSE = /^(?:(?:and|but|so|look at what|in)\s+)?(?:[a-z]+\s+){0,3}?(?:those|these)\s+(?:rounds|deaths|fights|kills|duels|ones|are|were|two|three|four|five|six)\b/i;
const OWN_LIST = /\b(?:rounds?,?\s+\d|\d+\s+(?:of|deaths|kills|rounds))\b/i;

/**
 * The sentences that lean on nothing kept. Input: a text, sentences (all
 * kept), or rows { s, dropped } in reading order (the gates' own, the dropped
 * among them). opts.agents: names a pronoun may stand for though no kept
 * sentence names them (the agent an answer is about, the player's own).
 * Returns [{ index, sentence, kind }], index into the rows, kind 'pronoun',
 * 'lead-in', 'it' or 'those'. English only: the caller passes no other.
 */
function checkOrphans(input, opts = {}) {
  const rows = rowsOf(input);
  const out = [];
  const extra = new Set((Array.isArray(opts.agents) ? opts.agents : []).filter(Boolean));
  const isDropped = (i) => !!(rows[i] && (rows[i].dropped || out.some((o) => o.index === i)));
  // Several passes: a sentence dropped here may orphan the one after it.
  for (let pass = 0; pass < 3; pass++) {
    let found = false;
    const seenAgents = new Set(extra);
    let person = false;
    for (let i = 0; i < rows.length; i++) {
      if (isDropped(i)) continue;
      const s = straight(rows[i].s).trim();
      const add = (kind) => { out.push({ index: i, sentence: rows[i].s, kind }); found = true; };
      // The previous sentence in reading order, kept or not.
      const prevDropped = i > 0 && isDropped(i - 1);
      // The next kept sentence of the same paragraph, and whether the one right after went.
      let nextKept = -1;
      for (let j = i + 1; j < rows.length; j++) if (!isDropped(j)) { nextKept = j; break; }
      const nextDropped = i + 1 < rows.length && isDropped(i + 1);
      const samePara = (j) => j >= 0 && (rows[i].p == null || rows[j].p == null || rows[j].p === rows[i].p);
      const lastOfPara = nextKept < 0 || !samePara(nextKept);

      // Who the sentence itself names comes before its own pronouns: "Reyna
      // heals when she kills" needs nothing before it.
      const here = agentsNamed(s);
      const head = s.replace(/\b(?:he|him|his|himself|she|her|hers|herself)\b[\s\S]*$/i, '');
      const before = new Set([...seenAgents, ...agentsNamed(head)]);
      const personHere = person || PERSON_NOUN.test(head);
      const could = (set) => [...before].some((a) => set.has(a) || (!FEMALE.has(a) && !MALE.has(a)));
      if (SHE.test(s) && !could(FEMALE) && !personHere) { add('pronoun'); continue; }
      if (HE.test(s) && !could(MALE) && !personHere) { add('pronoun'); continue; }

      const lead = LEAD_IN.test(s) && s.split(/\s+/).length <= 16;
      if ((lead || ENDS_COLON.test(s)) && (nextDropped || lastOfPara)) { add('lead-in'); continue; }
      if (prevDropped && IT_OBJECT.test(s) && !here.size) { add('it'); continue; }
      if (prevDropped && THOSE.test(s) && !OWN_LIST.test(s)) { add('those'); continue; }

      for (const a of here) seenAgents.add(a);
      // The person this one names, or the one its own kept pronoun still means, carries to the next.
      person = PERSON_NOUN.test(s) || (personHere && (HE.test(s) || SHE.test(s)));
    }
    if (!found) break;
  }
  return out.sort((a, b) => a.index - b.index);
}

/*
 * NO TALK OF THE PRODUCT. The coach teaches the game; it never recommends a
 * feature, a page or a future review, and never names the app. "So your next
 * review can check whether the fight had an answer", "the app will track it",
 * "turn on Advanced coaching", "open the Moments page".
 */
const PRODUCT = [
  /\b(?:your|the|a|my|our)\s+(?:next|following|upcoming|future)\s+(?:reviews?|match reviews?|grades?|report)\b/i,
  /\b(?:this|the|our)\s+app\b/i,
  /(?<![A-Za-z])Occlara(?![A-Za-z])/,
  /(?<![A-Za-z])Ask Coach(?![A-Za-z])/,
  /\b(?:the\s+)?Moments\s+page\b/i,
  /\b(?:in|open|check|from|under|go to)\s+(?:the\s+|your\s+)?(?:Settings|Profile|match library|library|Moments)(?![A-Za-z])/,
  /\bAdvanced coaching\b/i,
  /\bupgrade\s+(?:your|to)\b/i,
  /\b(?:the|your|this)\s+(?:review|coach|app|tool)\s+(?:can|will|could|would)\s+(?:then\s+)?(?:check|track|see|tell|show|count|measure|flag|catch|grade)\b/i,
  /\b(?:i|we)(?:'ll|\s+will|\s+can)\s+(?:then\s+)?(?:check|track|watch|flag|measure|count|grade)\b[^.]{0,50}\b(?:next|future|reviews?|later)\b/i,
  // The review cited as a source that sees and says (round 4): "the repeeks the
  // review saw", "The fix the review gives", "this review shows". The player's
  // own "review your VOD" has no article before it, and "in this review" with
  // no such verb after it is no citation.
  /\b(?:the|your|this|that)\s+(?:match\s+)?review\s+(?:also\s+|already\s+|just\s+)?(?:saw|sees|see|gave|gives|give|says|said|shows|showed|show|counts|counted|count|found|finds|find|flagged|flags|caught|catches|noticed|notices|spotted|spots|lists|listed|names|named|mentions|mentioned|points out|pointed out|picked up|tracked|tracks|recorded|records)\b/i,
  /\baccording to\s+(?:the|your|this|that)\s+(?:match\s+)?review\b/i,
];

/**
 * The sentences that talk about the product. Input: a text or sentences.
 * Returns [{ index, sentence, said }].
 */
function checkProduct(input) {
  const rows = Array.isArray(input) ? input.map((x) => String(x && typeof x === 'object' ? x.s || x.text || '' : x == null ? '' : x)) : sentencesOf(input);
  const out = [];
  rows.forEach((s, index) => {
    const t = straight(s);
    for (const re of PRODUCT) {
      const m = re.exec(t);
      if (m) { out.push({ index, sentence: s, said: m[0] }); break; }
    }
  });
  return out;
}

/*
 * THE SIDE AND THE SPIKE OF THE ROUND A SENTENCE IS ABOUT. On attack with no
 * spike down the defenders never have to come: "let the enemy come to you"
 * told an attacker to wait out a clock that was running against them. After a
 * plant on defence the defenders must retake: waiting for them is the
 * attackers' play. And an attacker never retakes, a defender never holds the
 * spike or plays the post plant.
 */
const WAIT_FOR_THEM = /\b(?:let|make|force)\s+(?:the\s+enemy|the\s+enemies|them|the\s+defenders|the\s+attackers|their\s+team|the\s+other\s+team|him|her)\s+(?:come|push|walk|swing|run)\s+(?:to|into|at|on(?:to)?)\s+you\b|\bwait\s+for\s+(?:them|the\s+enemy|the\s+enemies|the\s+defenders|the\s+attackers)\s+to\s+(?:come|push|peek|swing)\b|\bplay\s+(?:for|off)\s+(?:the|their)\s+(?:mistakes?|push|peek)\b/i;
// "It also keeps you alive for the retake fight" on the Fracture attack after
// the plant is the attackers' side of the defenders' retake, as "save your
// smoke for the retake" is: a bare "for the retake" names no retake of the
// player's own. Going, pushing or grouping up for it does.
const YOU_RETAKE = /\b(?:you|your\s+team|you\s+and\s+your\s+team)\s+(?:should\s+|could\s+|had\s+to\s+|needed\s+to\s+|have\s+to\s+|need\s+to\s+)?(?:retake|retook|retaking)\b|\bplay\s+(?:for|off)\s+(?:the\s+)?retake\b|\b(?:go|goes|going|went|push|pushing|commit|committing|group\s+up|grouping\s+up|regroup|regrouping|lead|leading|join|joining)\s+(?:for|on|into)\s+the\s+retake\b(?!\s+(?:they|their|the\s+enemy))/i;
const YOU_HOLD_SPIKE = /\b(?:play|hold|guard|protect|sit\s+on|watch)\s+(?:the\s+)?(?:spike|post[ -]?plant)\b|\byour\s+post[ -]?plant\b/i;
const THEIR = /\b(?:their|the\s+enemy's|the\s+enemies'|against\s+(?:the|a|their))\s+(?:retake|post[ -]?plant)\b/i;
const sideOf = (s) => (/^att/i.test(String(s || '')) ? 'attack' : /^def/i.test(String(s || '')) ? 'defence' : null);

/**
 * Why a sentence about one round gets its state wrong, or null.
 * round: { side ('attacking'|'defending'|'attack'|'defence'), planted, plantSec, sec (the death), died, afterPlant }.
 */
function checkRoundState(sentence, round) {
  if (!round) return null;
  const t = straight(sentence);
  const side = sideOf(round.side);
  if (!side) return null;
  const fin = (v) => typeof v === 'number' && Number.isFinite(v);
  const planted = !!(round.planted || round.afterPlant || fin(round.plantSec));
  // Whether the spike was down when the player died, only where the record
  // says so: Riot's afterPlant, or both times known. A plant with no time and
  // no afterPlant leaves it unknown, and an unknown judges nothing.
  const known = fin(round.sec) && fin(round.plantSec);
  const downAtDeath = !!round.afterPlant || (known && round.sec >= round.plantSec);
  const upAtDeath = !planted || (known && round.sec < round.plantSec);
  if (side === 'attack') {
    if ((round.died ? upAtDeath && !round.afterPlant : !planted) && WAIT_FOR_THEM.test(t)) {
      return 'on attack with the spike not down the defenders never have to come to you; say the move that takes space or the spike to a site';
    }
    if (YOU_RETAKE.test(t) && !THEIR.test(t)) return 'the round was an attack, and attackers never retake; say the attack\'s move';
  } else {
    if (round.died && downAtDeath && WAIT_FOR_THEM.test(t)) {
      return 'on defence with the spike down the defenders must retake it, so waiting for the attackers to come is their play, not yours';
    }
    if (YOU_HOLD_SPIKE.test(t) && !THEIR.test(t)) return 'the round was a defence, and defenders never hold the spike or play the post plant; say the defence\'s move';
  }
  return null;
}

module.exports = {
  checkOrphans, checkProduct, checkRoundState, sentencesOf, agentsNamed,
  FEMALE, MALE, PERSON_NOUN, LEAD_IN, ENDS_COLON, IT_OBJECT, THOSE, PRODUCT, WAIT_FOR_THEM, YOU_RETAKE, YOU_HOLD_SPIKE, THEIR,
};
