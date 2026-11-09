'use strict';

/**
 * WHAT THE GAME ITSELF MAKES CERTAIN (round 8, the root cause study of round
 * 7's game and kit cluster). Pure, English only, no I/O after load. Each check
 * reads one sentence (or a reply's rows) and answers a reason, or null.
 *
 *   checkOneShot   "the Outlaw's one-shot body at any range": a one hit kill
 *                  of a named part of a named gun, held to the damage table
 *                  with Heavy Armor from full health (100 health + 50, the
 *                  absorption simulated as the primer does). A sentence that
 *                  names the armour it holds for, a negation, no part or two
 *                  guns judge nothing.
 *   checkMoveFire  "bursting and moving": firing while moving told as the
 *                  play, where moving widens every gun (the primer's own
 *                  line). Moving between bursts, a negation, a shotgun, and
 *                  the habit named as the error ("and stop instead") pass.
 *   soloDrillFrame a Deathmatch or Range drill carried through its paragraph:
 *                  "play Deathmatch ... Before every engagement, ask whether
 *                  you have a teammate nearby". A match phrase ends the frame.
 *   teamDrill      one sentence: a Deathmatch or Range drill that needs a
 *                  team, read past a disclaimer ("where there are no
 *                  teammates: ask whether a teammate could trade you").
 *   checkUnobserved "your crosshair sat too deep": where the crosshair was, or
 *                  what the player saw, said as fact of the match, which only
 *                  a look could see. Passes a hypothetical and a look that
 *                  says it.
 *   checkBullets   "Contingency is just a smoke, bullets go through it": an
 *                  ability's bullet blocking held to kit-rules.json.
 *
 * Every regex here is written with a file tool and asserted both ways in
 * scripts/test-game-claims.js (CLAUDE.md, the shell regex hazard).
 */

const DATA = require('../valorant-data.generated.json');
const RULES = (() => { try { return require('../data/game-rules.json').facts || {}; } catch { return {}; } })();
const KIT_RULES = (() => { try { return require('../data/kit-rules.json').abilities || {}; } catch { return {}; } })();

const W = DATA.weapons || {};
const G = DATA.gear || {};
const titleOf = (k) => String(k).charAt(0).toUpperCase() + String(k).slice(1);
const esc = (s) => String(s).replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
const GUN_NAMES = Object.keys(W).map(titleOf);
const GUN_RE = new RegExp(`(?<![A-Za-z])(${GUN_NAMES.map(esc).join('|') || 'NO_GUN'})(?![A-Za-z])`, 'g');
const HEALTH = RULES.health && Number.isFinite(RULES.health.value) ? RULES.health.value : 100;
const HEAVY = G['Heavy Armor'] || { absorbed: 0.66, capacity: 50 };

/** Hits from full health with an armour, simulated hit by hit as game-primer.js does. */
function hitsToKill(dmg, armor) {
  if (!(dmg > 0)) return null;
  let hp = HEALTH;
  let ar = armor ? armor.capacity || 0 : 0;
  const ab = armor ? armor.absorbed || 0 : 0;
  for (let k = 1; k <= 400; k++) {
    const a = Math.min(ab * dmg, ar);
    ar -= a;
    hp -= dmg - a;
    if (hp <= 1e-9) return k;
  }
  return null;
}

// ── One shot claims ───────────────────────────────────────────────────────

const ONE_SHOT = /\bone[- ]?(?:shots?|shotting|taps?|tapping|tapped)\b|\b(?:a|one|a single|any)\s+(?:clean\s+)?(?:(?:body|chest|torso|head)\s+)?(?:shot|hit|bullet|tap)\b[^.;]{0,30}?\b(?:kills|is a kill|drops|finishes|ends)\b/i;
const PART_BODY = /\b(?:body|chest|torso|bodyshots?)\b/i;
const PART_HEAD = /\b(?:head|heads|headshots?)\b/i;
// The armour named, as the facts' own words name it: the claim held for it.
const ARMOUR_QUALIFIED = /\b(?:no|without|light|half|low|broken|cracked|damaged|weakened|chipped|full)\s+(?:armou?r|shields?|health|hp)\b|\bunarmou?red\b|\bon (?:an )?eco\b|\bpistol round\b|\bLight Armor\b|\balready (?:hit|tagged|damaged|weak)\b|\b(?:tagged|chipped|damaged|weakened)\s+(?:enemy|enemies|player|players|target|opponent)s?\b|\bheavy (?:armou?r|shields?)\b[^.;]{0,30}\b(?:two|2|second)\b/i;
const ANY_RANGE = /\b(?:at|from) (?:any|every|all) ranges?\b|\banywhere on the map\b|\bfrom anywhere\b|\bat any distance\b/i;
const LONG_RANGE = /\b(?:at|from) (?:long|far) range\b|\bacross the (?:map|site)\b|\bpast \d{2} ?m\b/i;
const NEGATED = /\b(?:not|never|no longer|cannot|can't|won't|doesn't|does not|isn't|fails? to)\b[^.;]{0,20}$/i;
// Between a gun and the claim it owns: "Marshal's one-shot", "Marshal one-shots", "Marshal can one-shot".
const GUN_BEFORE_CLAIM = /^(?:'s)?\s+(?:[A-Za-z]+\s+){0,2}$/;

/**
 * A one hit kill the damage table does not give. primer: optional, the chat
 * facts' primer entries (attribute 'hits' by part, band and armour), so a
 * match before a patch is held to its own numbers; else the game data.
 */
function checkOneShot(sentence, primer) {
  const t = String(sentence || '');
  const k = ONE_SHOT.exec(t);
  if (!k) return null;
  if (NEGATED.test(t.slice(Math.max(0, k.index - 40), k.index))) return null;
  if (ARMOUR_QUALIFIED.test(t)) return null;
  let guns = [...new Set([...t.matchAll(GUN_RE)].map((m) => m[1]))];
  // TWO GUNS, THE CLAIM'S OWN (the coach bench 9, Nov 2026): "a Spectre ...
  // where the Marshal's one-shot body hit at any range" named two guns and
  // judged nothing. The gun right before the claim, its possessive or with at
  // most two words between, is the claim's subject.
  if (guns.length > 1) {
    const before = [...t.matchAll(GUN_RE)].filter((m) => m.index + m[0].length <= k.index).pop();
    guns = before && GUN_BEFORE_CLAIM.test(t.slice(before.index + before[0].length, k.index)) ? [before[1]] : [];
  }
  if (guns.length !== 1) return null;
  const w = W[guns[0].toLowerCase()];
  if (!w || w.pellets || !Array.isArray(w.ranges) || !w.ranges.length) return null;
  const near = t.slice(Math.max(0, k.index - 30), k.index + k[0].length + 30);
  const part = PART_BODY.test(near) ? 'body' : PART_HEAD.test(near) ? 'head' : null;
  if (!part) return null; // "the Outlaw one-shots you" names no part and judges nothing
  const any = ANY_RANGE.test(t);
  const bands = any ? w.ranges : LONG_RANGE.test(t) ? [w.ranges[w.ranges.length - 1]] : [w.ranges[0]];
  const heavyHits = (b) => {
    const e = Array.isArray(primer) ? primer.find((x) => x && x.subjectKind === 'gun' && x.subject === guns[0] && x.attribute === 'hits'
      && x.part === part && x.armor === 'Heavy Armor' && x.band && x.band.from === b.from && x.band.to === b.to && Number.isFinite(x.value)) : null;
    return e ? e.value : hitsToKill(b[part], HEAVY);
  };
  const short = bands.map((b) => ({ b, hits: heavyHits(b) })).filter((x) => x.hits > 1);
  if (!short.length) return null;
  const { b, hits } = short[0];
  return `your reply said one ${part} hit of the ${guns[0]} kills${any ? ' at any range' : ''}, where its ${part} hit does ${Math.floor(b[part])} from ${b.from} to ${b.to} m and Heavy Armor from full health takes ${hits}; say the hits to kill with the armour the facts name`;
}

// ── Firing while moving ───────────────────────────────────────────────────

const MOVE_FIRE = /\b(?:burst(?:ing)?|shoot(?:ing)?|fir(?:e|ing)|spray(?:ing)?|tapp?(?:ing)?)\s+(?:and|while)\s+(?:(?:still|you(?:'re| are)?)\s+)?(?:moving|strafing|running|walking|jumping)\b|\b(?:moving|strafing|running|walking)\s+(?:and|while)\s+(?:you\s+)?(?:burst(?:ing)?|shoot(?:ing)?|fir(?:e|ing)|spray(?:ing)?)\b|\brun(?:ning)?[- ]and[- ]gun(?:ning)?\b|\b(?:shoot|fire|spray|burst)(?:ing)?\s+on the move\b|\bburst,\s*move,\s*burst\b/i;
const MOVE_FIRE_OK = /\b(?:never|don't|do not|stop|stops|stopping|instead of|rather than|not|avoid|no)\b[^.;]{0,25}$/i;
const BETWEEN = /\bbetween (?:bursts|shots|taps)\b/i;
const SHOTGUN = /\b(?:Judge|Bucky|Shorty)\b/;
const NAMED_ERROR = /\b(?:stop|stopped|instead|anyway|mistake|cost you|missed|went wide|goes wide)\b/i;

/*
 * THE HABIT DIAGNOSED, NOT TAUGHT (8.8 review). "You were running while
 * shooting, so your bullets went everywhere", "Most of your duels were lost
 * shooting while moving" and "Firing while moving is inaccurate" were dropped
 * as if they told the player to do it. A past tense lead right before the
 * phrase, or a word naming what it costs anywhere in the sentence, is the
 * diagnosis. "Try shooting while moving to dodge" names no cost and stays.
 */
const MOVE_FIRE_PAST = /\b(?:you were|you kept|you kept on|were|was|kept|got caught|lost(?: \w+){0,3})\s+$/i;
const MOVE_FIRE_COST = /\b(?:inaccurate|inaccuracy|throws? off|threw off|everywhere|wide|counter-?strafe|counter-?strafing|lost|losing|deaths?|died|spread|widens?)\b/i;

function checkMoveFire(sentence) {
  const t = String(sentence || '');
  const m = MOVE_FIRE.exec(t);
  if (!m) return null;
  if (MOVE_FIRE_OK.test(t.slice(Math.max(0, m.index - 40), m.index)) || BETWEEN.test(t) || SHOTGUN.test(t)) return null;
  if (MOVE_FIRE_PAST.test(t.slice(Math.max(0, m.index - 40), m.index)) || MOVE_FIRE_COST.test(t)) return null;
  // The habit named as the error ("you kept firing while moving and missed, stop instead").
  if (NAMED_ERROR.test(t.slice(m.index + m[0].length))) return null;
  return 'your reply told the player to fire while moving, where moving widens every gun; teach moving between bursts and stopping before each one';
}

// ── A Deathmatch or Range drill that needs a team ─────────────────────────

const SOLO_MODE = /(?<![Tt]eam\s)(?<![A-Za-z])(?:[Dd]eath ?[Mm]atch|DEATHMATCH|the Range|in Range|[Rr]ange practice|[Aa]im trainer)(?![A-Za-z])/;
// Case spelled out, no 'i' (8.8 review): with it "Range" matched "the range
// you died from", a distance, as the practice mode.
const MODE_AWAY = /\b(?:[Rr]ather than|[Ii]nstead of|[Nn]ot|[Nn]ever|[Oo]utside)\s+(?:of\s+)?(?:in\s+)?(?:a\s+|the\s+|your\s+)?(?:[Dd]eath ?[Mm]atch|DEATHMATCH|Range)\b/;
// fact-gates.js TEAM_WORDS, and a teammate backing you up (round 8).
const TEAM_WORDS = /\b(?:teammates?|team ?mates?|allies|ally|your team|trade(?:s|d)?|trading|comms|call(?:s|ed)? out|duo|second (?:person|player)|(?:anyone|someone|somebody) (?:else )?(?:could|can|would|will|is able to) (?:help|follow|trade|answer|back|cover|swing)|back(?:s|ed)? you up)\b/i;
// What moves the drill to a match, and so ends the frame.
// "the" and "once the match starts" (8.8 review): "In the match itself, swing
// right after your teammate" after a warm up was read inside the drill.
const MATCH_FRAME = /\b(?:in|during|for) (?:a |the |your )?(?:next |own |real )?(?:ranked |unrated |competitive |swiftplay )?(?:match|matches|game|games)\b|\bin ranked\b|\bin your next\b|\bonce (?:the |a |your )?(?:match|game)(?:es|s)? (?:starts|begins|is live|goes live)\b|\bin[- ]game\b/i;
// The mode's limitation said, which does not license a team rule after it.
const DISCLAIMER = /\b(?:where|since|as|because)\s+(?:there (?:are|is)|you have|it has|it needs|this needs|that needs|the mode has)\s+no\s+(?:teammates?|team|allies)\b[^,:;]*[,:;]?|\b(?:[Dd]eath ?[Mm]atch|Range|[Ii]t)\s+(?:has|have|gives)\s+no\s+(?:teammates?|team|allies)\b[^,:;]*[,:;]?/g;
// The team named as absent or as the match's: the rule itself.
const NO_TEAM_SAID = /\b(?:no|without|never|not|nobody|no one|don't|do not|can't|cannot|won't|isn't|aren't)\b[^.;:]{0,30}\b(?:teammates?|team|allies|ally|trades?|trading|anyone)\b|\bon your own\b|\balone\b|\bin (?:a |the |your )?(?:next|own |real )?(?:ranked |unrated |competitive |swiftplay )?(?:match|matches|game|games)\b|\bin ranked\b/i;
const stripDisclaimer = (s) => String(s || '').replace(DISCLAIMER, ' ');

/** Whether a sentence with the solo mode in it asks for a team, read past a disclaimer. */
function teamDrill(sentence) {
  const t = String(sentence || '');
  if (!SOLO_MODE.test(t) || MODE_AWAY.test(t)) return false;
  const u = stripDisclaimer(t);
  return TEAM_WORDS.test(u) && !NO_TEAM_SAID.test(u);
}

/** A team rule in a sentence that sits inside a solo drill's frame. */
function framedTeam(sentence) {
  const u = stripDisclaimer(sentence);
  return TEAM_WORDS.test(u) && !NO_TEAM_SAID.test(u) && !MODE_AWAY.test(u);
}

/**
 * Rows of a reply [{ p, s, dropped }] in reading order. Returns [{ index,
 * kind: 'drill' }] for each kept sentence inside a Deathmatch or Range frame
 * that asks for a team. A frame opens at a sentence naming the mode (not one
 * sending the drill away from it) and runs to the end of its paragraph or to
 * a sentence that moves the drill to a match.
 */
function soloDrillFrame(rows) {
  const out = [];
  let para = null;
  let frame = false;
  (Array.isArray(rows) ? rows : []).forEach((r, i) => {
    if (!r) return;
    if (r.p !== para) { para = r.p; frame = false; }
    const s = String(r.s || '');
    if (SOLO_MODE.test(s) && !MODE_AWAY.test(s)) {
      const inMatch = MATCH_FRAME.test(s);
      if (!r.dropped && !inMatch && teamDrill(s)) out.push({ index: i, kind: 'drill' });
      frame = !inMatch;
      return;
    }
    if (MATCH_FRAME.test(s)) { frame = false; return; }
    if (frame && !r.dropped && framedTeam(s)) out.push({ index: i, kind: 'drill' });
  });
  return out;
}

/*
 * A drill of "that" in Deathmatch or the Range right after a team habit
 * (round 8, Split Asc aim): "If nobody is, hold the angle from cover instead
 * of swinging alone." then "Practise that in Deathmatch, where you have no
 * teammates". The pronoun points at the team habit, which the mode cannot
 * train; the disclaimer does not change what it points at.
 */
// No 'i' flag (8.8 review): with it "the range you died from" was the Range.
const PRONOUN_DRILL = /\b(?:[Pp]racti[cs]e|PRACTI[CS]E|[Dd]rill|[Bb]uild|[Tt]rain)\s+(?:that|this|it)\b[^.]{0,30}(?:[Dd]eath ?[Mm]atch|DEATHMATCH|the Range)\b/;
const TEAM_HABIT = /\b(?:teammates?|nobody|alone|trad(?:e|ed|es|ing))\b/i;
function pronounDrill(sentence, before) {
  const t = String(sentence || '');
  if (!PRONOUN_DRILL.test(t) || MODE_AWAY.test(t)) return false;
  return TEAM_HABIT.test(String(before || ''));
}

// ── What only a look could see ────────────────────────────────────────────

const UNOBSERVED = /\byour crosshair (?:sat|was|stayed|rested|ended up|drifted|hung|was sitting|was placed|was parked|was set|was buried|was too|went|lagged)\b|\byou (?:had|kept|left|placed|put|parked|set|buried|held) your crosshair\b|\byour (?:aim|crosshair placement) (?:was|sat|stayed) (?:too |a bit |slightly )?(?:low|high|deep|wide|off|late|behind)\b|\byou (?:never saw|didn't see|did not see|saw|noticed|spotted) (?:them|him|her|the enemy|their \w+)\b(?! (?:on|in) the (?:minimap|kill ?feed|map))/i;
// "Keep your crosshair where you saw him" is a place, no claim (the notes scan).
const HYPO = /\b(?:if|when|whenever|unless|before|after|as soon as|whether|ask|so|imagine|suppose|say|where|wherever)\b[^.;]{0,40}$/i;
const LOOK_CROSSHAIR = /\bcrosshair\b/i;
const LOOK_SIGHT = /\b(?:saw|see|seen|spotted|noticed|looked|watched|visible|never had eyes)\b/i;

/**
 * Where the crosshair sat or what the player saw, said as fact of the match.
 * lookText: the look's own words for the round the sentence is about (or
 * every look of the match where the round is unknown); the claim passes where
 * they speak of the crosshair, for a crosshair claim, or of seeing, for a
 * sight claim.
 */
function checkUnobserved(sentence, lookText) {
  const t = String(sentence || '');
  const m = UNOBSERVED.exec(t);
  if (!m) return null;
  if (HYPO.test(t.slice(0, m.index))) return null;
  const lw = String(lookText || '');
  if (LOOK_CROSSHAIR.test(m[0]) ? LOOK_CROSSHAIR.test(lw) : LOOK_SIGHT.test(lw)) return null;
  return "your reply said where the player's crosshair was or what the player saw, which no look of that death states; teach the placement as what to do next time";
}

// ── Bullets through a kit ─────────────────────────────────────────────────

const BLOCKS = Object.fromEntries(Object.entries(KIT_RULES).filter(([, v]) => v && typeof v.bullets === 'boolean').map(([k, v]) => [k.split('/').pop(), v.bullets]));
const BULLET_CLAIM = /\b(?:blocks?|stops?|absorbs?|eats?)\s+(?:the |enemy |their |all )?(?:bullets|shots|gunfire)\b|\bbullet ?proof\b|\b(?:shoot|shoots|shot|spray|sprays|fire|fires) (?:right )?through\b|\bbullets (?:go|pass|get|went|still go) (?:right )?through\b|\bonly (?:blocks?|stops?) (?:vision|sight)\b|\bjust a (?:smoke|vision block(?:er)?|moving smoke)\b|\bdoes(?: not|n't) (?:block|stop) (?:bullets|shots)\b/i;

/*
 * THE NAME AS A WORD, THE NEGATION READ, EVERY CLAIM IN THE CLIP (8.8 review).
 * A bare indexOf found 'Cove' inside 'Dark Cover' and 'Cover', so Omen's smoke
 * was judged as Harbor's wall; "will not stop bullets" was read as "stops
 * bullets" because the negation sat outside the match; and in "is not just a
 * smoke, it blocks bullets" only the first claim was read. Now the longest
 * names are found first, as whole words, a shorter one inside a longer one's
 * span is skipped, a negation in the words right before a claim flips it, and
 * the sentence is dropped only when no claim about the ability agrees with
 * kit-rules.json.
 */
const BLOCK_NAMES = Object.keys(BLOCKS).sort((a, b) => b.length - a.length);
const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const BULLET_NEGATED = /(?:\bnot|n't|\bnever|\bcannot|\bno longer)\s+(?:\w+\s+){0,2}$/i;
const SAYS_NOT = /through|only|just a|does(?: not|n't)/i;

/** An ability's bullet blocking said against kit-rules.json, or null. */
function checkBullets(sentence) {
  const t = String(sentence || '');
  const spans = [];
  for (const name of BLOCK_NAMES) {
    const blocks = BLOCKS[name];
    const re = new RegExp(`(?<![A-Za-z])${escRe(name)}(?![A-Za-z])`, 'g');
    let n;
    while ((n = re.exec(t)) !== null) {
      const at = n.index;
      if (spans.some(([a, b]) => at >= a && at < b)) continue;
      spans.push([at, at + name.length]);
      const c = t.slice(at, at + name.length + 60).split(/[.;]|,\s*(?:while|but|and|so)\b/)[0];
      const claims = [];
      const g = new RegExp(BULLET_CLAIM.source, 'gi');
      let m;
      while ((m = g.exec(c)) !== null) {
        let says = !SAYS_NOT.test(m[0]);
        if (!/does(?: not|n't)/i.test(m[0]) && BULLET_NEGATED.test(c.slice(0, m.index))) says = !says;
        claims.push(says);
      }
      if (!claims.length || claims.includes(blocks)) continue;
      const saysBlocks = claims[0];
      return `your reply said ${name} ${saysBlocks ? 'blocks' : 'does not block'} bullets, where it ${blocks ? 'does' : 'does not'}`;
    }
  }
  return null;
}

// ── Economy is out of scope (the owner's rule, the coach bench 9) ─────────

/*
 * THE COACH DOES NOT COACH THE ECONOMY (Nov 2026, the owner's rule after the
 * coach bench 9). Loss pay, buys, saves and credits could not be told right
 * consistently ("the enemy is on their smallest loss pay" after two straight
 * losses, "buy, eco, buy, buy"), so an economy claim or economy advice goes,
 * whatever it says. A round named by its kind as the player told it ("on an
 * eco", "their bonus", "the pistol round") is a label, no claim, and stays;
 * so do the guns' own facts (Heavy Armor in a hit count) and a sentence
 * saying the coach does not cover the economy. When in doubt, it goes.
 */
const ECON_CLAIM = new RegExp([
  String.raw`\bcredits?\b|\bcreds\b|\bloss (?:bonus|pay|money|streak bonus)\b|\bbonus (?:pay|money)\b|\becon(?:omy|omies|omic|omics)\b`,
  String.raw`\b(?:afford|affords|afforded|affording)\b`,
  // "buys the team time" and "buy yourself a second" are time, and the buy phase is a phase.
  String.raw`\b(?:buy|buys|buying|bought)\b(?!\s+(?:(?:you|yourself|your team|your teammates|the team|them|him|her|us)\s+)?(?:some\s+|a\s+few\s+|the\s+|more\s+|enough\s+|a\s+)?(?:time|space|seconds?|room)\b)(?!\s*(?:-\s*)?phase\b)`,
  String.raw`\bforce[ -]?buy\w*|\bforce rounds?\b|\bforc(?:e|ed|ing)\s+(?:(?:this|next|that|the|a)\s+)?round\b`,
  String.raw`\bsave rounds?\b|\bsav(?:e|es|ed|ing)\s+(?:(?:your|the|their|our|a|this|that)\s+)?(?:money|credits?|creds|guns?|rifles?|weapons?|loadout|Operator|Vandal|Phantom|Marshal|Outlaw|Guardian|Spectre|Odin|Ares|Judge|Bulldog)\b`,
  String.raw`\b(?:should(?:\s+have)?|to|you|we|team|they|everyone|players?)\s+(?:all\s+|also\s+|just\s+)?sav(?:e|ed|ing)\b(?=\s*(?:[.,;:]|$|with\b|this round\b|that round\b|the round\b|for the next\b|and\b))`,
  String.raw`\bsaving\b(?=\s*(?:[.,;:]|$|with\b|while\b|this round\b))`,
  String.raw`\bspen(?:d|ds|ding|t)\s+(?:(?:all|your|the|their|that|this|some|more|less|no|any)\s+)?(?:money|credits?|creds|buffer|cash|bank)\b`,
  String.raw`\b(?:full|half|light)[ -]buy\b|\bbank(?:ed|ing)\b`,
].join('|'), 'i');
// The coach saying it does not cover the economy, or that it cannot tell one: no claim.
const ECON_OUT_SAID = /\b(?:don't|do not|doesn't|does not|can't|cannot|won't|will not|not)\s+(?:\w+\s+){0,2}(?:cover|coach|advise on|answer|give advice on|talk about|go into|judge)\b[^.]{0,60}\b(?:econom\w*|buy\w*|credits?|sav(?:e|es|ed|ing))\b|\b(?:econom\w*|buy\w*)\b[^.]{0,40}\b(?:is|are)\s+(?:outside|out of|beyond)\s+(?:what|my|the)\b/i;

/*
 * What reads as money and is not (replayed over the bench's 657 answer
 * sentences): "your flash buys you the close fight", "the seconds you buy for
 * the rotators", "it bought you no information", "you cannot afford to be seen
 * first", and the enemy's round named as the situation ("against an eco or
 * half buy"). Each is taken out before ECON_CLAIM reads the sentence.
 */
// A buy whose object is a person it buys something for, or time, space, a fight, an angle: no money.
const BUY_FOR = /\b(?:buy|buys|buying|bought)(?=\s+(?:(?:you|yourself|your team|your teammates|the team|them|us|him|her|is|are|a|an|the|some|more|enough|one|two|a few|each|first|that|this)\s+){0,2}(?:time|space|seconds?|room|info|information|angles?|fights?|duels?|blind|delay|steps?|chance|opening|window|moment)\b)|\b(?:buy|buys|buying|bought)(?=\s+(?:you|yourself|your team|your teammates|the team|them|us|him|her)\b)/gi;
// Utility or a play as the subject of a buy: "the ult buys nothing", "a turret that bought nothing".
const BUY_SUBJECT = /\b(?:flash(?:es)?|smokes?|ult(?:imate)?s?|utility|wall|trap|turret|dart|drone|molly|stun|hold|peek|swing|death|trade)\s+(?:\w+\s+)?(?:buys|bought|will buy|can buy)\b/gi;
// The seconds or the space a player buys: "the seconds you buy for the rotators".
const BUY_TIME_BEFORE = /\b(?:seconds|time|space)\s+(?:that\s+|which\s+)?(?:you|your team|they|it)\s+(?:can\s+)?(?:buy|bought)\b/gi;
const AFFORD_TO = /\b(?:afford|affords|afforded|affording)\s+to\s+(?!buy\b|spend\b|force\b|save\b|full)/gi;
// The enemy's kind of round named as what a play is against ("against an eco or half buy").
const ROUND_KIND_LABEL = /\b(?:against|versus|vs\.?)\s+(?:an?|their|the)\s+(?:(?:eco|bonus)\s+or\s+(?:an?\s+)?)?(?:full|half|force)[ -]buy(?:\s+rounds?)?\b/gi;

/** An economy claim or economy advice, or null. */
function economyClaim(sentence) {
  let t = String(sentence || '');
  if (ECON_OUT_SAID.test(t)) return null;
  t = t.replace(ROUND_KIND_LABEL, ' roundkind ').replace(BUY_SUBJECT, ' gets').replace(BUY_TIME_BEFORE, ' time gotten')
    .replace(BUY_FOR, 'gets').replace(AFFORD_TO, 'dare to ');
  const m = ECON_CLAIM.exec(t);
  return m ? `your reply talked about the economy ("${m[0]}"), which this coach does not cover: leave buys, saves, credits and the loss bonus out and coach the play` : null;
}

// ── A won or lost pistol said as the player's own (the coach bench 9) ─────

/*
 * THE PISTOL ROUND AS THE PLAYER HAD IT (Nov 2026, the coach bench 9). With no
 * match, "You're in the round after a won pistol on defence" answered "round
 * two after pistol, most of my team saving", and "positioning after winning a
 * pistol round" answered "We lost pistol on C". A won (or lost) pistol said as
 * the player's goes where the facts say the other result, and with nothing
 * saying either, where it is said as a fact of the player's round. A general
 * rule ("when you win a pistol round") and a hypothetical judge nothing.
 */
const WON_PISTOL = /\b(?:after|following|since|off|on the back of)\s+(?:(?:a|the|your|that)\s+)?(?:won|winning)\s+(?:(?:a|the|your)\s+)?pistol(?:\s+round)?\b|\b(?:after|since|because|now that|having)\s+(?:you|your team|we)\s+(?:have\s+|had\s+|just\s+)?won\s+(?:the\s+|a\s+|your\s+)?pistol\b|\b(?:you|your team|we)\s+(?:won|took)\s+(?:the\s+|your\s+|that\s+)?pistol\b|\b(?:a|the|your)\s+won\s+pistol\b|\bwinning\s+(?:a|the|your)\s+pistol\s+round\b|\bthe\s+pistol\s+win\b/i;
const LOST_PISTOL = /\b(?:after|following|since|off)\s+(?:(?:a|the|your|that)\s+)?(?:lost|losing)\s+(?:(?:a|the|your)\s+)?pistol(?:\s+round)?\b|\b(?:after|since|because|now that|having)\s+(?:you|your team|we)\s+(?:have\s+|had\s+|just\s+)?lost\s+(?:the\s+|a\s+|your\s+)?pistol\b|\b(?:you|your team|we)\s+lost\s+(?:the\s+|your\s+|that\s+)?pistol\b|\b(?:a|the|your)\s+lost\s+pistol\b|\blosing\s+(?:a|the|your)\s+pistol\s+round\b|\bthe\s+pistol\s+loss\b/i;
const PISTOL_HYPO = /\b(?:if|when|whenever|once|unless|whether|suppose|had)\b[^.;]{0,30}$/i;
// What the player's own words say of their pistol: 'won', 'lost' or null (both, or neither).
const SAID_WON = /\b(?:we|i|my team|our team|us)\s+(?:won|took)\s+(?:the\s+|our\s+|that\s+)?pistol\b|\b(?:won|winning)\s+(?:the\s+|a\s+|our\s+)?pistol\b|\b(?:they|the enemy|the enemies|the other team|the attackers|the defenders)\s+lost\s+(?:the\s+)?pistol\b|\bpistol (?:round )?win\b/i;
const SAID_LOST = /\b(?:we|i|my team|our team)\s+(?:lost|dropped)\s+(?:the\s+|our\s+|that\s+)?pistol\b|\b(?:lost|losing)\s+(?:the\s+|a\s+|our\s+)?pistol\b|\b(?:they|the enemy|the enemies|the other team|the attackers|the defenders)\s+(?:won|took)\s+(?:the\s+)?pistol\b|\bpistol (?:round )?loss\b/i;
function pistolSaid(text) {
  const t = String(text || '');
  // The enemy's loss is the player's win, read first so "they lost pistol" is no loss of ours.
  const won = SAID_WON.test(t);
  const lost = SAID_LOST.test(t.replace(/\b(?:they|the enemy|the enemies|the other team|the attackers|the defenders)\s+lost\s+(?:the\s+)?pistol\b/gi, ' '));
  return won === lost ? null : won ? 'won' : 'lost';
}

/**
 * A pistol result said as the player's against what is known of it.
 * known: 'won' | 'lost' | null, from the match's record or the player's words.
 */
function checkPistolPremise(sentence, known) {
  const t = String(sentence || '');
  for (const [re, said, other] of [[WON_PISTOL, 'won', 'lost'], [LOST_PISTOL, 'lost', 'won']]) {
    const m = re.exec(t);
    if (!m) continue;
    if (PISTOL_HYPO.test(t.slice(0, m.index)) || NEGATED.test(t.slice(Math.max(0, m.index - 30), m.index))) continue;
    if (known === said) continue;
    return known === other
      ? `your reply said the player's team ${said} the pistol round, where they ${other} it; answer from the round as it was`
      : `your reply said the player's team ${said} the pistol round, which nothing the player said or the facts hold; never add a premise of your own`;
  }
  return null;
}

/*
 * A NOTE WRITTEN FOR THE OTHER PISTOL RESULT (the coach bench 9): "After you
 * win the pistol round, treat the next round as one you must convert" was
 * served to "We lost pistol on C" and the answer took its premise. A note is a
 * rule, so its present tense ("after you win the pistol") is its situation:
 * it fits only a player whose pistol went that way, or one nobody knows.
 */
const NOTE_WON_PISTOL = /\b(?:after|following|once|when)\s+(?:you\s+|your\s+team\s+|we\s+|a\s+team\s+)?(?:win|wins|won|winning)\s+(?:the\s+|a\s+|your\s+)?pistol\b|\b(?:a|the|your)\s+won\s+pistol\b|\bpistol\s+(?:round\s+)?win\b|\byou\s+won\s+(?:the\s+)?pistol\b/i;
const NOTE_LOST_PISTOL = /\b(?:after|following|once|when)\s+(?:you\s+|your\s+team\s+|we\s+|a\s+team\s+)?(?:lose|loses|lost|losing)\s+(?:the\s+|a\s+|your\s+)?pistol\b|\b(?:a|the|your)\s+lost\s+pistol\b|\bpistol\s+(?:round\s+)?loss\b|\byou\s+lost\s+(?:the\s+)?pistol\b/i;
/** Whether a note's situation is the pistol result the player did not have. */
function notePistolConflict(text, known) {
  const t = String(text || '');
  if (known === 'lost') return NOTE_WON_PISTOL.test(t);
  if (known === 'won') return NOTE_LOST_PISTOL.test(t);
  return false;
}

// ── A habit of the whole map said as fact (the coach bench 9) ─────────────

/*
 * NO MAP-WIDE HABIT AS FACT (Nov 2026, the coach bench 9): "on Haven, C is
 * the site a five-stack with no lurks reaches last", invented. A site said to
 * be the one teams reach, hit or take first or last, or teams in general said
 * to always, usually or never go somewhere, goes. Advice to the player ("C is
 * the site you should rotate to first") and this enemy's own habit ("they
 * always hit B") are not about the map, and stay.
 */
const MAP_HABIT = /\b(?:[ABC](?:\s+(?:site|main|long|short|link|lobby))?|the\s+(?:[ABC]\s+)?site)\s+is\s+(?:usually\s+|always\s+|often\s+)?(?:the|a)\s+(?:site|one|place|side)\b([^.;]{0,60}?)\b(?:first|last|most|least|always|never|usually|rarely|seldom)\b|\b(?:teams|most teams|attackers|defenders|a five[- ]stack|five[- ]stacks|stacks|everyone|most players|players)\s+(?:on\s+\w+\s+)?(?:almost\s+)?(?:always|usually|never|rarely|seldom|tend to|mostly|typically)\s+(?:go|hit|take|push|reach|rotate|attack|stack|play|default|run)\b/i;
function checkMapHabit(sentence) {
  const t = String(sentence || '');
  const m = MAP_HABIT.exec(t);
  if (!m) return null;
  // Advice to the player, or a hypothetical, is no claim about the map.
  if (m[1] !== undefined && /\b(?:you|your)\b/i.test(m[1])) return null;
  if (PISTOL_HYPO.test(t.slice(0, m.index)) || NEGATED.test(t.slice(Math.max(0, m.index - 30), m.index))) return null;
  return 'your reply stated where teams in general go on this map as a fact, which no fact you hold says; read the enemy only from what the player saw them do';
}

module.exports = {
  economyClaim, ECON_CLAIM, ECON_OUT_SAID, BUY_FOR, BUY_SUBJECT, BUY_TIME_BEFORE, AFFORD_TO, ROUND_KIND_LABEL, checkPistolPremise, pistolSaid, WON_PISTOL, LOST_PISTOL, PISTOL_HYPO, SAID_WON, SAID_LOST,
  checkMapHabit, MAP_HABIT, GUN_BEFORE_CLAIM, notePistolConflict, NOTE_WON_PISTOL, NOTE_LOST_PISTOL,
  checkOneShot, checkMoveFire, soloDrillFrame, teamDrill, pronounDrill, PRONOUN_DRILL, TEAM_HABIT, stripDisclaimer, checkUnobserved, checkBullets, hitsToKill,
  ONE_SHOT, ARMOUR_QUALIFIED, ANY_RANGE, LONG_RANGE, NEGATED, MOVE_FIRE, MOVE_FIRE_OK, MOVE_FIRE_PAST, MOVE_FIRE_COST, NAMED_ERROR, BULLET_NEGATED,
  SOLO_MODE, MODE_AWAY, TEAM_WORDS, MATCH_FRAME, DISCLAIMER, NO_TEAM_SAID, UNOBSERVED, HYPO, BULLET_CLAIM, BLOCKS,
};
