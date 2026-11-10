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
const LEAD_IN = /^(?:(?:but|and|so|still)\s*,?\s+)?(?:you did (?:plenty|a lot|some things|several things|a few things|things|well|good things)(?: right| well)?|here(?:'s| is) (?:how|why|what|the (?:fix|habit|drill|plan|good news|part|thing|round|problem|pattern))(?: in order| step by step| as it went)?|look at (?:when|where|how) (?:those|these|the|your) (?:deaths|kills|rounds|fights) (?:came|happened|went|started)|(?:there (?:are|were|is|was) )?(?:two|three|a few|several|one) (?:things?|habits?|parts?|points?|reasons?)(?: (?:to|you|that|worth)[a-z ]*)?|the (?:fix|habit|drill|plan|lesson|answer|good news|positive) is (?:simple|this|clear|one thing)|(?:that|this) is (?:how|why|what)|(?:the )?(?:good|positive) (?:news|side)(?: first)?|what went (?:right|well)|on the (?:plus|bright) side|because you(?:'re| are) (?:on |playing )?[A-Z][A-Za-z/]+, you can [^.]{0,80})[.!:]?$/i;
const ENDS_COLON = /:\s*$/;
// "with it up", "pop it", "use it": an it bound to a thing named before.
const IT_OBJECT = /\b(?:with|use|using|pop|popping|keep|keeping|save|saving|throw|throwing|place|placing|activate|activating|put|putting|hold|holding)\s+it\s+(?:up|down|out|ready|first|early|back|before|when|until|for|on|so|and|,|\.)/i;
// "those rounds", "these deaths": the rounds of a sentence that went.
// "Those came when you had support" with the kills it meant dropped (the blind audit of 8.7.9).
const THOSE = /^(?:(?:and|but|so|look at what|in)\s+)?(?:[a-z]+\s+){0,3}?(?:those|these)\s+(?:rounds|deaths|fights|kills|duels|ones|are|were|two|three|four|five|six|came|come|happened|cost|costs|showed|show|worked|work|went|won|lost)\b/i;
const OWN_LIST = /\b(?:rounds?,?\s+\d|\d+\s+(?:of|deaths|kills|rounds))\b/i;
// "Then", "after that": the next step of an order whose step before went.
// Its own round or second in its first clause anchors it.
const THEN_OPENER = /^(?:(?:and|but|so)\s+)?(?:then|after\s+that|from\s+there|by\s+then|after\s+this)\b/i;
const OWN_ANCHOR = /\bround\s+\d|\b\d+(?:\.\d+)?\s*s\s+in\b|\b\d+\s+seconds?\b/i;
// A step of advice, "Then take one piece of space, get behind cover", leans
// on no event told before it, and stays (the verification of stream A: an
// 8.7.6 answer lost it after a kit line was cut). Its verb comes straight
// after the opener, lower case, no subject and no past tense before it.
const THEN_STEP = /^(?:(?:[Aa]nd|[Bb]ut|[Ss]o)\s+)?(?:[Tt]hen|[Aa]fter\s+that|[Ff]rom\s+there|[Aa]fter\s+this),?\s+(?!(?:it|its|they|he|she|their|the|his|her|your|you|we|a|an|that|this|there|these|those|everything|nobody|no|none|both|all|one|two|three|four|five|came|went|got|was|were|had|did)\b)[a-z]+\b/;
// "that angle", "that fight": a thing the sentence before named.
const THAT_THING = /^(?:(?:if|when|once|and|but|so|then|because)\s+)?(?:[a-z']+\s+){0,5}?that\s+(?:same\s+)?(angle|angles|fight|duel|spot|position|corner|lane|peek|moment|habit|mistake|play|death|space|site|exchange|swing|push|setup)\b/i;
// A bare item of a list: "Round 14, 14 s in, to a Marshal."
const ITEM = /^Rounds?\s+\d{1,2},\s/;
const ITEM_VERB = /\b(?:you|your|he|she|they|it|was|were|is|are|had|has|killed|died|lost|won|got|came|went|took|traded|planted)\b/i;
/*
 * WHAT A CUT LEFT LEANING (the blind audit of 8.7.9), each only right after a
 * dropped sentence: "All three need a star already placed" with the sentence
 * naming the three abilities gone; "Same story in round 7 at B site with
 * Reyna." with the rounds it compared to gone; "The fights you choose are."
 * with "Your mechanics are not the problem" gone, a short sentence ending on
 * its verb; "You will not have one, so practise ..." with the teammate it
 * meant gone, a bare "one" standing for a noun. "All three of your deaths",
 * "the same angle" and "one more shot" carry their own nouns.
 */
const ALL_OF_THEM = /^(?:(?:and|but|so)\s*,?\s+)?(?:all|both|each|either|neither)(?:\s+(?:two|three|four|five|six))?(?:\s+of\s+(?:them|these|those))?\s+(?:need|needs|are|were|is|was|sit|sits|have|has|had|do|does|did|come|comes|came|work|works|worked|cost|costs|share|shared|depend|depends|rely|relies|go|goes|went|will|can|could|should|must|point|points|show|showed|happen|happened|end|ended|start|started|leave|left|punish|punishes|give|gives)\b/i;
const SAME_AGAIN = /^(?:(?:and|but|so)\s*,?\s+)?(?:the\s+)?same\s+(?:story|thing|again|here|pattern|problem|deal|mistake|situation|idea|picture|again)\b/i;
const ELLIPSIS_END = /\b(?:are|is|was|were|do|does|did|can|will|has|have|had|could|would|should)\s*[.!]$/i;
const ELLIPSIS_WHOLE = /\b(?:what|how|where|when|why|who|which|whatever|wherever|if)\b/i;
const BARE_ONE = /^(?:(?:and|but|so)\s*,?\s+)?(?:you|they|we|he|she)\s+(?:will|would|won't|do|did|don't|didn't|can|can't|could|may|might)?\s*(?:not\s+)?(?:have|get|find|need|see|use|take|keep)\s+one\b(?=\s*[,.;!?]|\s+(?:so|and|but|because|there|either|yet|then|anyway)\b)/i;

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
      // The blind audit of 8.7.8: "Then it flipped fast:" with the round's
      // opening gone, "If nobody can see that angle" with the angle's sentence
      // gone, and "Round 14, 14 s in, to a Marshal." with its list and its
      // lead in gone.
      if (prevDropped && THEN_OPENER.test(s) && !THEN_STEP.test(s) && !OWN_ANCHOR.test(s.split(/[,:]/)[0])) { add('then'); continue; }
      // "That angle" stands on a kept sentence before that named an angle.
      const that = prevDropped ? THAT_THING.exec(s) : null;
      if (that) {
        let pk = -1;
        for (let j = i - 1; j >= 0; j--) if (!isDropped(j)) { pk = j; break; }
        const noun = that[1].replace(/s$/, '');
        if (!(pk >= 0 && samePara(pk) && new RegExp(`\\b${noun}`, 'i').test(straight(rows[pk].s)))) { add('that'); continue; }
      }
      if (prevDropped && ITEM.test(s) && !ITEM_VERB.test(s)) { add('item'); continue; }
      if (prevDropped && ALL_OF_THEM.test(s)) { add('all'); continue; }
      if (prevDropped && SAME_AGAIN.test(s)) { add('same'); continue; }
      // "Here is what you can do." and "hold where you are" end on their verb with nothing left out (verify round 6).
      if (prevDropped && ELLIPSIS_END.test(s) && s.split(/\s+/).length <= 8 && !ELLIPSIS_WHOLE.test(s)) { add('ellipsis'); continue; }
      if (prevDropped && BARE_ONE.test(s)) { add('one'); continue; }

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

/*
 * THE SEAMS (the blind audit of 8.7.8). A review's summary glued a swing fact
 * on whole, its capital with it: "You won 5 to 1 by opening fights and getting
 * multiple kills, even as You died 3 times in 6 rounds", "the decisive stretch
 * coming on both sides: You lost 10 rounds in a row", "and You died 5 times in
 * 7 rounds". A You inside a sentence, after a lower case word, a comma or a
 * colon, is written you. And a sentence a cut left ending on a conjunction, an
 * article or a comma ("Hold the angle and.") goes whole, never shown cut.
 *
 * repairSeams(sentence) is the sentence repaired, or null where it must go.
 */
const MID_YOU = /([a-z0-9,:;)]\s+)(You(?:'re|'ve|'d|'ll|r|rs)?)(?![A-Za-z])/g;
// Lower case only, so a site ("then A.") is never read as an article.
const DANGLING_WORD = /\b(?:and|but|or|because|while|although|the|a|an|your|their)\s*[.!?]["')]?$/;
const DANGLING_MARK = /[,:;]\s*[.!?]["')]?$/;
function repairSeams(sentence) {
  const s = straight(sentence).trim();
  if (!s) return null;
  if (DANGLING_WORD.test(s) || DANGLING_MARK.test(s)) return null;
  const fixed = String(sentence).replace(MID_YOU, (m, pre, w) => pre + w.toLowerCase())
    .replace(/\s+([,.;:!?])/g, '$1').replace(/,\s*\./g, '.');
  return fixed;
}

/*
 * THE STOCK CLOSER (the blind audit of 8.7.8): "the other things can wait"
 * ended 28 of 60 answers, in the same words, after a lever the answer had
 * already made the one point. Filler where what waits is named by nothing:
 * "the other things", "the others", "the rest", "everything else", "the other
 * counted habits", and "nothing else needs fixing first". A sentence that is
 * only that goes; a clause of it ("That is the lever, and the other things can
 * wait.") is cut, the sentence ending where it stood alone. "Trading is the
 * second point and can wait" and "The early deaths and the untraded fights can
 * wait for now" name what waits, and stay.
 *
 * fillerOf(sentence) is null where there is none, '' where the sentence goes,
 * else the sentence without it.
 */
// "Your other counted habits" and "the other patterns" too (the verification
// of stream A: 6 of the 8.7.6 and 8.7.7 closers said them).
const FILLER_SUBJECT = '(?:(?:the|your)\\s+)?(?:others|rest|other\\s+(?:counted\\s+)?(?:things?|habits?|points?|mistakes?|patterns?|stuff|deaths?|issues?|problems?)(?:\\s+counted)?|everything\\s+else|anything\\s+else|all\\s+(?:the\\s+)?rest)';
const FILLER_TAIL = '(?:\\s+(?:too|for\\s+now|until\\s+later|for\\s+later|for\\s+another\\s+day))?';
const FILLER_WHOLE = new RegExp(`^(?:(?:and|so|but)\\s+)?${FILLER_SUBJECT}\\s+can\\s+(?:all\\s+)?wait${FILLER_TAIL}\\s*[.!]?$|^nothing\\s+else\\s+(?:needs|has)\\s+(?:fixing|to\\s+be\\s+fixed)(?:\\s+first)?\\s*[.!]?$`, 'i');
const FILLER_CLAUSE = new RegExp(`,?\\s+(?:and|so)\\s+(?:${FILLER_SUBJECT}\\s+can\\s+(?:all\\s+)?wait${FILLER_TAIL}|nothing\\s+else\\s+(?:needs|has)\\s+(?:fixing|to\\s+be\\s+fixed)(?:\\s+first)?)(?=\\s*[.!]?\\s*$)`, 'i');
/*
 * THE TRADE CHECK CAN WAIT (the blind audit of 8.7.9): the rule that asked the
 * model to name what waits gave "The trade check can wait." in 29 of 60
 * answers, read by every judge as the answer contradicting itself where the
 * trade check was its only habit, and "The trade check can wait here, since
 * your teammate was close" of a death nobody traded. A sentence whose
 * deferral is about trading goes whole ("The trade check on your own peeks
 * can wait, and so can the Reyna fights", "Trading is the second point and
 * can wait"); a trailing clause of it is cut ("Fix the stopping first, and the
 * trade check can wait." is "Fix the stopping first."). "The trade check
 * cannot wait" and "do not let the trade check wait" defer nothing.
 */
const TRADE_WAITS = '(?:(?:the|your|that|this)\\s+)?(?:trade\\s+checks?|trading|trade\\s+habit|trades?|untraded\\s+(?:deaths|fights)|unanswered\\s+deaths|deaths\\s+nobody\\s+(?:traded|answered)|spacing\\s+check)\\b';
// A subject list holding the trade ("The early deaths and the untraded fights can wait") goes whole too.
const TRADE_WAIT_WHOLE = new RegExp(`^(?:(?:and|so|but|then)\\s*,?\\s+)?(?:[^,.;!?]{0,60}?\\b(?:and|or|of)\\s+)?${TRADE_WAITS}[^,.;!?]{0,60}?\\bcan\\s+(?:all\\s+|also\\s+|still\\s+)?wait\\b`, 'i');
// A clause of its own, after a comma: "Fix the stopping first, and the trade check can wait."
const TRADE_WAIT_CLAUSE = new RegExp(`,\\s+(?:and|so|but|while)\\s+${TRADE_WAITS}[^,.;!?]{0,60}?\\bcan\\s+(?:all\\s+|also\\s+|still\\s+)?wait\\b[^.!?]*[.!?]?\\s*$`, 'i');
function fillerOf(sentence) {
  const s = straight(sentence).trim();
  if (FILLER_WHOLE.test(s)) return '';
  if (TRADE_WAIT_WHOLE.test(s)) return '';
  const tw = TRADE_WAIT_CLAUSE.exec(s);
  if (tw) {
    const head = String(sentence).trim().slice(0, tw.index).replace(/[,\s]+$/, '');
    if (head.split(/\s+/).length < 3) return '';
    return `${head}${/[.!?]$/.test(head) ? '' : '.'}`;
  }
  const m = FILLER_CLAUSE.exec(s);
  if (!m) return null;
  // Straightening keeps every index, so the cut is the sentence as written.
  const head = String(sentence).trim().slice(0, m.index).replace(/[,\s]+$/, '');
  if (head.split(/\s+/).length < 3) return '';
  return `${head}${/[.!?]$/.test(head) ? '' : '.'}`;
}

/*
 * THE STRUCTURAL PASS, AFTER EVERY GATE (the blind audit of round 6, Nov
 * 2026). Eight answers kept a sentence that pointed at what a gate then cut:
 * "But before you put it all on the mouse, look at where those fights
 * happened." with the early deaths it pointed at dropped (Pearl, Silver aim),
 * "Look at where she caught you." with the five Reyna deaths dropped (Split,
 * Ascendant), "Look at what the record shows around it." after the retake
 * sentence went (Sunset 4-13), and on the other side of a cut "If nobody is,
 * either move to where one is" with its condition dropped, "That post-plant
 * record is the team's" with the record never told, "The problem is what
 * happens next." with what came first gone. checkOrphans reads a lead in of
 * its list and a word that leans; this reads the shape:
 *
 *   lead   a kept sentence whose only content points at what follows ("look
 *          at", "here is", "consider", "notice", a colon at its end, a short
 *          sentence that says only that something follows), right before a
 *          dropped one, or ending its paragraph after a drop in it;
 *   back   a kept sentence right after a dropped one whose only content
 *          refers back to it: an elliptical "If nobody is," / "If not,", a
 *          "that record" or "this number" no kept sentence before it in its
 *          paragraph named, "the problem is what happens next";
 *   garble a sentence no gate cut that does not parse as English where a
 *          cut or a model left it: "Your gun is the Vandal or Phantom range
 *          game", a doubled word, two articles in a row.
 *
 * checkStructure(rows) reads rows { s, dropped, p } in reading order, again
 * until nothing more goes (a lead before a lead), and returns [{ index,
 * sentence, kind }]. A sentence that names a round, a number or an agent
 * carries its own content, and is never a lead. English only.
 */
const LEAD_VERB = '(?:look(?:\\s+again)?\\s+at|take\\s+a\\s+(?:look|second\\s+look)\\s+at|consider|notice|picture|think\\s+about|remember|check|see|watch)';
const LEAD_OBJECT = '(?:(?:where|when|how|what|which|why)\\b[^.!?:,]{0,60}|(?:the|those|these|your|its|that)\\s+(?:rounds?|deaths?|fights?|duels?|record|numbers?|pattern|places?|spots?|timing|order|moments?|kills?)\\b[^.!?:,]{0,40}|this|that|it)';
// The whole sentence is the pointer, or its last clause is, after a comma ("But before you put it all on the mouse, look at ...").
const POINT_WHOLE = new RegExp(`^(?:(?:but|and|so|now|first|then|still)\\s*,?\\s+)?(?:let's\\s+|let\\s+us\\s+|you\\s+can\\s+|it\\s+helps\\s+to\\s+)?${LEAD_VERB}\\s+${LEAD_OBJECT}\\s*[.!:]?$`, 'i');
const POINT_TAIL = new RegExp(`,\\s*(?:(?:but|and|so|now|first|then)\\s+)?${LEAD_VERB}\\s+${LEAD_OBJECT}\\s*[.!:]?$`, 'i');
// "Here is the pattern.", "This is what the record shows.", "The numbers tell the story."
const POINT_SAYS = /^(?:(?:but|and|so)\s*,?\s+)?(?:here(?:'s|\s+is|\s+are)\s+(?:what|how|why|where|the\s+(?:part|pattern|thing|catch|problem|rounds?|deaths?|record|numbers?|picture|story|breakdown))|(?:this|that)\s+is\s+(?:what|where|how|why)\s+(?:the\s+record|riot's\s+record|the\s+numbers?|it)\s+(?:shows?|says?|tells?)|(?:the|your)\s+(?:pattern|numbers?|record|rounds?|deaths?)\s+(?:is|are|tell|tells|show|shows|say|says)\s+(?:clear|it|this|the\s+story|why|more|the\s+rest)|(?:it|this)\s+(?:shows|showed)\s+(?:up\s+)?(?:clearly|again|here|in\s+the\s+record)|(?:the\s+|that\s+|this\s+|your\s+)?(?:[a-z']+\s+){0,4}changes\s+everything(?:\s+(?:here|now|in\s+this\s+spot))?)\s*[.!:]?$/i;
const HAS_CONTENT = /[0-9]|\bround\s+(?:one|two|three|four|five|six|seven|eight|nine|ten)\b/i;
// The other side of a cut: what only refers back.
const BACK_IF = /^(?:(?:and|but|so)\s*,?\s+)?if\s+(?:not|so|nobody\s+(?:is|was|can|does|did)|no\s+one\s+(?:is|was|can|does|did)|none\s+(?:is|are|was|were)|they\s+(?:are|were|can|do|did)(?:n't|\s+not)|you\s+(?:are|were|can|do|did)(?:n't|\s+not)|it\s+(?:is|was)(?:n't|\s+not)|there\s+(?:is|was)(?:n't|\s+not)(?:\s+one)?)\s*[,.]/i;
const BACK_THAT = /^(?:(?:and|but|so)\s*,?\s+)?(?:that|this|those|these)\s+(?:[a-z'-]+\s+){0,2}?(record|number|numbers|count|stat|stats|figure|figures|streak|run|trend|list|stretch|split|breakdown)\b/i;
const BACK_CONTRAST = /^(?:(?:but|so)\s*,?\s+)?(?:the\s+)?(?:real\s+)?(?:problem|issue|mistake|lever|fix)\s+(?:is|was)\b/i;
const CONTRAST_HEAD = /\b(?:(?:is|was)\s+not|isn't|wasn't)\s+(?:the|your)\s+(?:real\s+)?(?:problem|issue|mistake|lever)\b/i;
const BACK_NEXT = /^(?:(?:and|but|so)\s*,?\s+)?(?:the\s+)?(?:problem|issue|trouble|catch|question|mistake|difference)\s+(?:is|was)\s+what\s+(?:happens|happened|comes|came|you\s+do|you\s+did)\s+(?:next|after(?:\s+that)?|then)\s*[.!]?$/i;
/*
 * GARBLE. "Your gun is the Vandal or Phantom range game" (Fracture, Ascendant
 * aim, three judges): a sentence that makes the player's gun one of two, or a
 * game, says nothing about the match and reads as broken. A word doubled
 * ("the the", "you you") and two articles in a row ("a the", "the your") are
 * what a cut leaves; lower case only, so "the A site" is never read as one.
 */
// The game data's guns, keyed in lower case; the readers below ignore case.
const GUN_NAMES = Object.keys(DATA.weapons || {}).filter((w) => /^[a-z][a-z.]+$/i.test(w));
const GUN_ALT = (GUN_NAMES.length ? GUN_NAMES : ['Vandal', 'Phantom', 'Sheriff', 'Ghost', 'Classic', 'Spectre', 'Operator', 'Marshal', 'Guardian', 'Bulldog', 'Odin', 'Ares', 'Judge', 'Bucky', 'Stinger', 'Shorty', 'Frenzy', 'Outlaw']).map(esc).join('|');
const GUN_EITHER = new RegExp(`\\byour\\s+(?:gun|weapon|rifle|loadout)\\s+(?:is|was)\\s+(?:the\\s+|a\\s+|an\\s+)?(?:${GUN_ALT})\\s+or\\s+(?:the\\s+|a\\s+|an\\s+)?(?:${GUN_ALT})\\b`, 'i');
const GUN_GAME = new RegExp(`\\b(?:gun|weapon|rifle)\\s+(?:is|was)\\s+(?:the\\s+|a\\s+)?(?:${GUN_ALT})(?:\\s+or\\s+(?:the\\s+)?(?:${GUN_ALT}))?\\s+(?:[a-z-]+\\s+)?game\\b`, 'i');
// Never "that that" or "had had", which English allows.
const DOUBLED = /\b(the|a|an|to|of|you|your|and|in|at|on|with|is|was|for)\s+\1\b/;
const TWO_ARTICLES = /\b(?:the|a|an|your|their)\s+(?:the|a|an|your|their)\s+(?![A-Z])/;
/** Why a sentence is garbled, or null. */
function garbleOf(sentence) {
  const s = straight(sentence);
  if (GUN_EITHER.test(s)) return 'gun-either';
  if (GUN_GAME.test(s)) return 'gun-game';
  if (DOUBLED.test(s)) return 'doubled';
  if (TWO_ARTICLES.test(s)) return 'articles';
  return null;
}
/*
 * AN INSTRUCTION IS NO LEAD (the verify pass of round 7). "Before you swing,
 * check where your nearest teammate is." and "After the plant, look at where
 * your teammates are standing." read as a pointer and went with a cut after
 * them, the habit the answer was built on. A lead points at what the match
 * showed: its wh clause is about the past or the record ("where those fights
 * happened", "where she caught you", "what the record shows", "what happens
 * next"); a wh clause in the present with none of those, and "the places",
 * "your spots" or "the timing" as an object, is something to do.
 */
const LEAD_PAST = /\b(?:happened|caught|killed|died|went|came|fell|lost|won|was|were|did|had|got|showed|shows|says|said|tells|told|record|those|these|next)\b/i;
const INSTRUCTION = new RegExp(`${LEAD_VERB}\\s+(?:((?:where|when|how|what|which|why)\\b[^.!?:,]{0,60})|(?:the|your)\\s+(?:places?|spots?|timing|order)\\b)`, 'i');
function isInstruction(t) {
  const m = INSTRUCTION.exec(t);
  return !!m && (!m[1] || !LEAD_PAST.test(m[1]));
}
function isPointer(s) {
  const t = straight(s).trim();
  if (HAS_CONTENT.test(t) || agentsNamed(t).size) return false;
  if (isInstruction(t) && !POINT_SAYS.test(t)) return false;
  const words = t.split(/\s+/).length;
  if (words <= 14 && (POINT_WHOLE.test(t) || POINT_SAYS.test(t))) return true;
  // A clause that sets up only the pointer: "But before you put it all on the mouse, look at where those fights happened."
  if (words <= 20 && POINT_TAIL.test(t)) return true;
  return false;
}
function checkStructure(input) {
  const rows = rowsOf(input);
  const out = [];
  const gone = (i) => !!(rows[i] && (rows[i].dropped || out.some((o) => o.index === i)));
  const samePara = (i, j) => rows[i].p == null || rows[j].p == null || rows[i].p === rows[j].p;
  for (let pass = 0; pass < 4; pass++) {
    let found = false;
    const add = (i, kind) => { out.push({ index: i, sentence: rows[i].s, kind }); found = true; };
    for (let i = 0; i < rows.length; i++) {
      if (gone(i)) continue;
      const s = straight(rows[i].s).trim();
      const g = garbleOf(s);
      if (g) { add(i, 'garble'); continue; }
      const nextGone = i + 1 < rows.length && gone(i + 1) && samePara(i, i + 1);
      // The last kept of its paragraph, with a drop after it there.
      let lastKept = true;
      let dropAfter = false;
      for (let j = i + 1; j < rows.length && samePara(i, j); j++) {
        if (gone(j)) dropAfter = true;
        else { lastKept = false; break; }
      }
      const pointer = isPointer(s) || (ENDS_COLON.test(s) && s.split(/\s+/).length <= 12 && !HAS_CONTENT.test(s));
      if (pointer && (nextGone || (lastKept && dropAfter))) { add(i, 'lead'); continue; }
      const prevGone = i > 0 && gone(i - 1);
      if (!prevGone) continue;
      if (BACK_IF.test(s) || BACK_NEXT.test(s)) { add(i, 'back'); continue; }
      // The second half of a contrast whose first went: "The problem is
      // swinging when the trade is not there yet." after "so the aggression
      // itself is not the problem" was cut (Split, Ascendant, round 6).
      if (BACK_CONTRAST.test(s) && CONTRAST_HEAD.test(straight(rows[i - 1].s))) { add(i, 'back'); continue; }
      const that = BACK_THAT.exec(s);
      if (that) {
        const noun = that[1].replace(/s$/, '');
        let named = false;
        for (let j = i - 1; j >= 0 && samePara(i, j); j--) {
          if (!gone(j) && new RegExp(`\\b${esc(noun)}`, 'i').test(straight(rows[j].s))) { named = true; break; }
        }
        if (!named) { add(i, 'back'); continue; }
      }
    }
    if (!found) break;
  }
  return out.sort((a, b) => a.index - b.index);
}

/*
 * A CONNECTIVE AFTER A CUT (round 8, the blind audit of round 7). Two answers
 * opened what was shown on a conclusion whose premise a gate had cut: "So the
 * fix is not a new sensitivity or a longer warmup." (Fracture, Ascendant aim,
 * its first sentence lost to the name gate twice) and "So the first player
 * into a Cypher site is the one his setup is built to catch." (Pearl, Silver,
 * after three sentences went). The gates so far only drop; this one repairs,
 * the first that does, and only this: an adverbial "so", "thus", "hence",
 * "therefore", "as a result" or "because of that" leading a full clause, at
 * the head of what is shown or right after a dropped sentence, is struck and
 * the clause capitalised ("The fix is not a new sensitivity or a longer
 * warmup."). "So far", "so much", "so many", "so long", "so often" and "so
 * that" are no connective and stay. A demonstrative consequence, "That is why
 * ...", "This means ...", "Which is how ...", asserts a cause the cut sentence
 * held, and goes as an orphan.
 *
 * repairConnective(rows) reads rows { s, dropped } in reading order and
 * returns [{ index, kind: 'strip', s }] (the row's new text) and [{ index,
 * kind: 'back' }] (the row goes). A row is at the head when no kept row comes
 * before it; it follows a cut when the row right before it was dropped. A
 * strip applies to either, a back only after a cut (or at a head with a cut
 * before it), so a reply that opens "That is why" with nothing cut is read as
 * it was written.
 */
const CONNECTIVE_STRIP = /^(?:(?:and\s+)?so(?!\s+(?:far|much|many|long|often|that)\b)|thus|hence|therefore|as a result|because of (?:that|this))\s*,?\s+(?=[a-z])/i;
const CONNECTIVE_BACK = /^(?:that|this|which)(?:'s|\s+is|\s+was)\s+(?:why|how|the reason|what (?:cost|lost|decided))\b|^(?:that|this|which)\s+(?:means|meant|explains|is because)\b/i;
function repairConnective(input) {
  const rows = rowsOf(input);
  const out = [];
  let keptBefore = false;
  let cutBefore = false;
  for (let i = 0; i < rows.length; i++) {
    if (rows[i].dropped) { cutBefore = true; continue; }
    const s = straight(rows[i].s).trim();
    const head = !keptBefore;
    const afterCut = i > 0 && rows[i - 1].dropped;
    keptBefore = true;
    if ((afterCut || (head && cutBefore)) && CONNECTIVE_BACK.test(s)) { out.push({ index: i, kind: 'back' }); keptBefore = false; continue; }
    if (!(afterCut || head)) continue;
    const m = CONNECTIVE_STRIP.exec(s);
    if (!m) continue;
    // Straightening keeps every index, so the cut is the sentence as written.
    const rest = String(rows[i].s).trim().slice(m[0].length);
    if (rest.split(/\s+/).length < 3) continue;
    out.push({ index: i, kind: 'strip', s: rest.charAt(0).toUpperCase() + rest.slice(1) });
  }
  return out;
}

/*
 * A FOCUS INSTRUCTS (round 8, the blind audit of round 7). The Plat Fracture
 * review's focus was "You give up a quick kill attempt to keep the advantage
 * while the clock runs.", the tradeoff tail of a sentence the name gate cut,
 * read by three judges as weak and by one as a broken review. A focus is
 * something to do: some sentence of it opens on an imperative (FOCUS_DO's
 * verbs), straight away or after a lead clause ("After the plant, hold ...",
 * "When your team is ahead, stay ..."), and its first sentence is not only a
 * cost or a gain ("You give up ...", "It costs ...", TRADEOFF_ONLY). A floor,
 * not a quality gate: a focus that fails it is asked for again, then computed
 * (match-review.js floorOf). English only.
 */
const DO_VERBS = '(?:hold|play|stay|keep|take|wait|let|make|swing|peek|re-?peek|fall|back|trade|check|stop|use|throw|smoke|flash|drone|save|sit|stand|move|rotate|push|clear|call|say|tell|name|ask|go|step|reposition|jiggle|shoulder|pre-?aim|aim|shoot|burst|tap|crouch|count|look|watch|listen|give|set|put|pick|plant|defuse|retake|commit|drop|buy|reload|turn|walk|pull|track|place|delay|follow|fight|try|pause|leave|spend|pair|bring|start|open|choose|decide|treat|practi[sc]e|warm|line|time|wait|hit|enter|lead|trust|default|reset|glance|agree|communicate|ping|mark|hug|anchor|settle|position|find|stick|group|regroup|swap|switch|hide|survive|slow|rush|flank|lurk|support|guard|protect|scout|spot|isolate|contest|force|bait|re-?clear|re-?position|re-?take|ready|prepare|plan|close|cut|deny|pre-?fire|spray|strafe|counter-?strafe|duck|jump|dash|run|stack|split|join|wait|have|get|be|do(?!\\s+not\\b|n\\x27t)'
  // The review of round 8: the plain imperative and negative openers a correct
  // focus also opens on ("Focus on waiting ...", "Don't peek alone ...",
  // "Avoid dry peeking ...", "Only take fights ...", "Remember to check ...")
  // were no verb here, so the focus was nulled and asked for again.
  + '|focus|work|avoid|don\\x27t|do\\s+not|prioriti[sz]e|learn|remember|think|limit|reduce|value|respect|aim\\s+to|make\\s+sure)';
const FOCUS_OPENER = '(?:early|late|when|after|before|if|once|on|in|with|as|at|against|whenever|while|until|during|the\\s+moment|any\\s+round|every\\s+time|each\\s+time|each\\s+round|every\\s+round|next(?:\\s+(?:match|game|time|round|half))?|from\\s+now\\s+on|instead\\s+of|rather\\s+than|the\\s+next\\s+time|for\\s+the\\s+next\\s+match)';
const FOCUS_DO = new RegExp(`(?:^|[.!?]\\s+)(?:(?:${FOCUS_OPENER})\\b[^.!?]{0,160}?,\\s+)?(?:(?:always|first|just|simply|then|now|briefly|quickly|calmly|still|only|never)\\s+)?${DO_VERBS}\\b`, 'i');
const TRADEOFF_ONLY = /^(?:you|it|this|that|doing so|the trade-?off)\s+(?:give|gives|gave|lose|loses|trade|trades|cost|costs|gain|gains|buy|buys|risk|risks|spend|spends)\b(?:\s+up)?/i;
function instructs(text) {
  const t = straight(text).replace(/\s+/g, ' ').trim();
  if (!t) return false;
  const first = sentencesOf(t)[0] || t;
  if (TRADEOFF_ONLY.test(first) && !FOCUS_DO.test(first)) return false;
  return FOCUS_DO.test(t);
}

/*
 * THE SWING LINE GLUED ON (round 8, the Ascendant Fracture review): "You won 5
 * to 1, opening fights and winning key duels despite this: you died 3 times in
 * 6 rounds." The prompt told sentence one to carry the SWING AND COUNTS
 * block's first line, which in a won match is a count of deaths, and the model
 * joined the two with "despite this:", a this that points at nothing. MID_YOU
 * reads only a capital You. The seam is split where it began, the tail made
 * its own sentence, and a score head left with no main verb ("You won 5 to 1,
 * opening fights and winning key duels") reads "You won 5 to 1 by opening
 * fights and winning key duels". "Despite this, you held the site." (no colon)
 * and "The lever is simple: trade the first death." are no seam.
 */
const SWING_SEAM = /\b(?:despite|in spite of|because of|after|given|with|for all|even with)\s+(?:this|that|it|these|those)\s*:\s*(?=[a-z0-9])/i;
const WON_NO_VERB = /^(You (?:won|lost) \d+ to \d+),\s+([a-z]+ing\b[^.!?]*)$/;
function splitSwingSeam(sentence) {
  const s = String(sentence == null ? '' : sentence).trim();
  const m = SWING_SEAM.exec(straight(s));
  if (!m) return null;
  let head = s.slice(0, m.index).replace(/[,\s]+$/, '');
  if (head.split(/\s+/).length < 3) return null;
  const nv = WON_NO_VERB.exec(head);
  if (nv) head = `${nv[1]} by ${nv[2]}`;
  const tail = s.slice(m.index + m[0].length).trim();
  if (!tail) return null;
  return `${head}. ${tail.charAt(0).toUpperCase()}${tail.slice(1)}`;
}

module.exports = {
  repairConnective, CONNECTIVE_STRIP, CONNECTIVE_BACK, instructs, FOCUS_DO, TRADEOFF_ONLY, splitSwingSeam, SWING_SEAM, WON_NO_VERB,
  checkStructure, garbleOf, isPointer, isInstruction, INSTRUCTION, LEAD_PAST, POINT_WHOLE, POINT_TAIL, POINT_SAYS, BACK_IF, BACK_THAT, BACK_NEXT, GUN_EITHER, GUN_GAME, DOUBLED, TWO_ARTICLES,
  repairSeams, fillerOf, MID_YOU, DANGLING_WORD, DANGLING_MARK, FILLER_WHOLE, FILLER_CLAUSE, TRADE_WAIT_WHOLE, TRADE_WAIT_CLAUSE,
  ALL_OF_THEM, SAME_AGAIN, ELLIPSIS_END, ELLIPSIS_WHOLE, BARE_ONE, THEN_OPENER, THEN_STEP, OWN_ANCHOR, THAT_THING, ITEM, ITEM_VERB,
  checkOrphans, checkProduct, checkRoundState, sentencesOf, agentsNamed,
  FEMALE, MALE, PERSON_NOUN, LEAD_IN, ENDS_COLON, IT_OBJECT, THOSE, PRODUCT, WAIT_FOR_THEM, YOU_RETAKE, YOU_HOLD_SPIKE, THEIR,
};
