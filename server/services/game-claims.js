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
const ANY_RANGE = /\b(?:at|from) (?:any|every|all) (?:ranges?|distances?)\b|\banywhere on the map\b|\bfrom anywhere\b|\b(?:no matter|regardless of) (?:the )?(?:range|distance)\b/i;
// Long range said without a number (the coach bench 11): "kills at range", "from a
// distance", "on a long line where ... kills you" (the clause before the claim counts).
const LONG_RANGE = /\b(?:at|from) (?:long |far )?range\b|\b(?:at|from) (?:a |long )?distance\b|\blong[- ]range\b|\bon (?:a|the|any|that|this) long (?:line|angle|sightline|lane)s?\b|\bacross the (?:map|site)\b|\bpast \d{2} ?m\b/i;
const NEAR_RANGE = /\bup close\b|\bclose[- ]range\b|\bclose quarters\b|\bpoint[- ]blank\b|\b(?:at|in) close\b/i;
const NEGATED = /\b(?:not|never|no longer|cannot|can't|won't|doesn't|does not|isn't|fails? to)\b[^.;]{0,20}$/i;
// Between a gun and the claim it owns: "Marshal's one-shot", "Marshal one-shots", "Marshal can one-shot".
const GUN_BEFORE_CLAIM = /^(?:'s)?\s+(?:[A-Za-z]+\s+){0,2}$/;
/*
 * THE GUN INSIDE THE CLAIM (the coach bench 10, Nov 2026): "a Sheriff or a
 * Marshal head hit kills you at any range" put the guns between the article
 * and the hit, which ONE_SHOT never read, so a Sheriff head hit, which does
 * not kill Heavy Armor past 30 m, went out at any range. Every gun the claim
 * names is held to the table, each on its own.
 */
const GUN_ALT = GUN_NAMES.map(esc).join('|') || 'NO_GUN';
const ONE_SHOT_GUN = new RegExp(`\\b(?:a|an|one|a single|any)\\s+(?:clean\\s+)?((?:${GUN_ALT})(?:'s)?(?:\\s+(?:or|and)\\s+(?:(?:a|an)\\s+)?(?:${GUN_ALT})(?:'s)?)*)\\s+(?:clean\\s+)?(?:(?:(?:body|chest|torso|head)\\s+)?(?:shot|hit|bullet|tap)|headshot|bodyshot)\\b[^.;]{0,30}?\\b(?:kills|is a kill|drops|finishes|ends)\\b`, 'i');
// The claim's victim is the player: "kills you". An eco the enemy is on then says nothing of the player's armour.
const KILLS_YOU = /\b(?:kills|drops|finishes|ends)\s+you\b/i;
// The claim's own distance in metres ("only inside 10 metres"): a number the number gate holds.
const RANGE_STATED = /\b(?:inside|within|out to|up to|under|below|past|beyond|over|from)\s+\d+\s*(?:m|metres|meters)\b/i;
const ENEMY_ECO = /\b(?:they(?:'re|\s+are|\s+were)|the\s+enem(?:y|ies)\s+(?:is|are|was|were)|their\s+team\s+(?:is|was))\s+(?:(?:on|playing)\s+)?(?:an?\s+)?eco\b|\btheir\s+eco\b/gi;

/**
 * A one hit kill the damage table does not give. primer: optional, the chat
 * facts' primer entries (attribute 'hits' by part, band and armour), so a
 * match before a patch is held to its own numbers; else the game data.
 */
function checkOneShot(sentence, primer) {
  const t = String(sentence || '');
  const g = ONE_SHOT_GUN.exec(t);
  const k = g || ONE_SHOT.exec(t);
  if (!k) return null;
  if (NEGATED.test(t.slice(Math.max(0, k.index - 40), k.index))) return null;
  // An eco the enemy is on is no armour of the player a "kills you" claim is about (the coach bench 10).
  if (ARMOUR_QUALIFIED.test(KILLS_YOU.test(t.slice(k.index, k.index + k[0].length + 6)) ? t.replace(ENEMY_ECO, ' ') : t)) return null;
  let guns = [...new Set([...t.matchAll(GUN_RE)].map((m) => m[1]))];
  if (g) {
    // The guns the claim itself names, each its subject.
    guns = [...new Set([...g[1].matchAll(GUN_RE)].map((m) => m[1]))];
  } else if (guns.length > 1) {
    // TWO GUNS, THE CLAIM'S OWN (the coach bench 9, Nov 2026): "a Spectre ...
    // where the Marshal's one-shot body hit at any range" named two guns and
    // judged nothing. The gun right before the claim, its possessive or with at
    // most two words between, is the claim's subject.
    const before = [...t.matchAll(GUN_RE)].filter((m) => m.index + m[0].length <= k.index).pop();
    guns = before && GUN_BEFORE_CLAIM.test(t.slice(before.index + before[0].length, k.index)) ? [before[1]] : [];
  }
  if (!guns.length || (!g && guns.length !== 1)) return null;
  const near = t.slice(Math.max(0, k.index - 30), k.index + k[0].length + 30);
  const part = PART_BODY.test(near) ? 'body' : PART_HEAD.test(near) ? 'head' : null;
  if (!part) return null; // "the Outlaw one-shots you" names no part and judges nothing
  // A gun inside the claim is held to the range its own clause says: "a Bandit head
  // hit kills through Heavy Armor only inside 10 metres, but ... a Marshal head hit
  // at any range" gives the Bandit its own distance, which the number gate holds.
  let scope = t;
  if (g) {
    const rest = t.slice(k.index + k[0].length);
    const cut = rest.search(/[,;]|\bbut\b/i);
    scope = t.slice(k.index, k.index + k[0].length + (cut < 0 ? rest.length : cut));
    if (RANGE_STATED.test(scope)) return null;
    // The claim's own clause back to the last comma or semicolon: "on a long
    // line where a Sheriff or a Marshal head hit kills you" (the coach bench 11).
    const head = t.slice(0, k.index);
    const from = Math.max(head.lastIndexOf(','), head.lastIndexOf(';'), head.lastIndexOf('.')) + 1;
    scope = t.slice(from, k.index) + scope;
  }
  const any = ANY_RANGE.test(scope);
  const long = !any && LONG_RANGE.test(scope) && !NEAR_RANGE.test(scope);
  for (const gun of guns) {
    const w = W[gun.toLowerCase()];
    if (!w || w.pellets || !Array.isArray(w.ranges) || !w.ranges.length) continue;
    const bands = any ? w.ranges : long ? [w.ranges[w.ranges.length - 1]] : [w.ranges[0]];
    const heavyHits = (b) => {
      const e = Array.isArray(primer) ? primer.find((x) => x && x.subjectKind === 'gun' && x.subject === gun && x.attribute === 'hits'
        && x.part === part && x.armor === 'Heavy Armor' && x.band && x.band.from === b.from && x.band.to === b.to && Number.isFinite(x.value)) : null;
      return e ? e.value : hitsToKill(b[part], HEAVY);
    };
    const short = bands.map((b) => ({ b, hits: heavyHits(b) })).filter((x) => x.hits > 1);
    if (!short.length) continue;
    const { b, hits } = short[0];
    return `your reply said one ${part} hit of the ${gun} kills${any ? ' at any range' : ''}, where its ${part} hit does ${Math.floor(b[part])} from ${b.from} to ${b.to} m and Heavy Armor from full health takes ${hits}; say the hits to kill with the armour the facts name`;
  }
  return null;
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

/*
 * A MOVING SHOT SAID TO BE ACCURATE (the coach bench 10, Nov 2026): "the rifle
 * forgives a moving first bullet at close range" told no firing while moving,
 * so MOVE_FIRE never read it, and it said what the primer's own line refutes:
 * moving widens every gun, rifles too. A shot on the move said to be
 * forgiven, accurate or fine goes; a negation before it and a shotgun named
 * pass.
 */
const MOVE_ACCURATE = /\b(?:forgives?|forgiving|forgiven)\b[^.;]{0,25}?\b(?:moving|running|strafing|walking|jumping)\b(?:\s+[a-z]+){0,2}?\s+(?:shots?|bullets?|taps?|spray|fire)\b|\b(?:moving|running|strafing|walking|jumping)\s+(?:(?:first|single|opening)\s+)?(?:shots?|bullets?|taps?)\s+(?:is|are|stays?|remains?)\s+(?:still\s+)?(?:accurate|precise|fine|reliable|forgiven)\b|\baccurate\s+(?:while|when|on)\s+(?:moving|running|strafing|walking|jumping|the move)\b/i;
const MOVE_ACCURATE_REASON = 'your reply said a shot fired on the move is accurate or forgiven, where moving widens every gun, rifles included; teach stopping before the shot';

function checkMoveFire(sentence) {
  const t = String(sentence || '');
  const a = MOVE_ACCURATE.exec(t);
  if (a && !MOVE_FIRE_OK.test(t.slice(Math.max(0, a.index - 40), a.index)) && !SHOTGUN.test(t)) return MOVE_ACCURATE_REASON;
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

// ── The clock and the spike the player did not describe (the coach bench 10) ──

/*
 * WHO THE CLOCK PRESSES BEFORE THE PLANT (Nov 2026, the coach bench 10): "let
 * the clock and the spike force the defence to show themselves" to an
 * attacker before any plant, where the clock runs against the attack until the
 * spike is down. A sentence putting the clock on the defence goes where the
 * sentence itself says before the plant, or where the player's account is an
 * attack with no plant in it (state { side, planted }); "them" and "the enemy"
 * are the defence only on attack. One set after the plant, a negation and a
 * hypothetical stay.
 */
const CLOCK_PRESSES = /\b(?:the\s+)?(?:clock|timer|round\s+timer|round\s+clock|time)\b(?:\s+and\s+the\s+spike)?\s+(?:will\s+|to\s+|can\s+|should\s+|does\s+)?(?:force|forces|forcing|pressure|pressures|pressuring|make|makes|making|push|pushes|pushing|drag|drags|dragging)\s+(the\s+defen[cs]e|(?:the\s+)?defenders?|the\s+defending\s+team|them|the\s+enemy|the\s+enemies|enemies)\b|\b(the\s+defen[cs]e|the\s+defenders?)\s+(?:is|are|will\s+be)\s+(?:on|against|racing)\s+the\s+clock\b/i;
const CLOCK_AFTER_PLANT = /\bafter\s+(?:the|your|their|a)\s+plant\b|\bafter\s+(?:you|they|your\s+team)\s+plant(?:ed)?\b|\bonce\s+(?:the\s+spike|it)\s+(?:is|was|goes|went)\s+(?:down|planted)\b|\bpost[ -]?plant\b|\bdefus\w*|\bthe\s+planted\s+spike\b|\bspike\s+(?:is|was)\s+(?:down|planted)\b|\bwith\s+the\s+spike\s+(?:down|planted)\b/i;
const CLOCK_BEFORE_PLANT = /\bbefore\s+(?:any|a|the)\s+plant\b|\bbefore\s+(?:you|they|your\s+team|the\s+attackers|the\s+team)\s+plant\b|\bspike\s+(?:is|was)\s+not\s+(?:yet\s+)?(?:down|planted)\b|\bwithout\s+the\s+spike\s+(?:down|planted)\b|\bwith\s+the\s+spike\s+not\s+(?:yet\s+)?(?:down|planted)\b|\bno\s+plant\b|\bunplanted\b/i;
const CLOCK_HYPO = /\b(?:if|once|when|whenever|unless|until)\b[^.;]{0,40}$/i;
function checkClockBeforePlant(sentence, state) {
  const t = String(sentence || '');
  const m = CLOCK_PRESSES.exec(t);
  if (!m) return null;
  if (NEGATED.test(t.slice(Math.max(0, m.index - 40), m.index)) || CLOCK_HYPO.test(t.slice(0, m.index))) return null;
  const before = CLOCK_BEFORE_PLANT.test(t);
  if (!before && CLOCK_AFTER_PLANT.test(t)) return null;
  const whom = String(m[1] || m[2] || '');
  const named = /defen|defending/i.test(whom);
  const attackNoPlant = !!(state && state.side === 'attack' && state.planted === false);
  if (!(before && named) && !attackNoPlant) return null;
  return 'your reply put the clock on the defence before the plant, where it runs against the attackers until the spike is down; say the move that takes the space or the site';
}

/*
 * THE SPIKE DOWN NOBODY SAID (Nov 2026, the coach bench 10): "late in a lost A
 * take, so the spike was down" of a round the player told with no plant. The
 * spike said to have been down or planted, as a fact of the player's round,
 * goes where their account says nothing of a plant (planted false, no match).
 * A hypothetical and a negation stay.
 */
const SPIKE_WAS_DOWN = /\b(?:the\s+)?spike\s+(?:was|had\s+been)\s+(?:already\s+)?(?:down|planted)\b|\b(?:they|the\s+attackers|the\s+enemy|the\s+enemies|your\s+team|you)\s+had\s+(?:already\s+)?planted\b/i;
function checkSpikePremise(sentence, planted) {
  if (planted !== false) return null;
  const t = String(sentence || '');
  const m = SPIKE_WAS_DOWN.exec(t);
  if (!m) return null;
  if (PISTOL_HYPO.test(t.slice(0, m.index)) || NEGATED.test(t.slice(Math.max(0, m.index - 30), m.index))) return null;
  return 'your reply said the spike was down in the player\'s round, which they never said; never add a premise of your own, and answer the round as they told it';
}

// ── The enemy's next site, predicted (the coach bench 11) ──────────────────

/*
 * NO NEXT SITE CALLED FROM A PATTERN (Nov 2026, the coach bench 11, the owner's
 * 88% rule). Told a team had lost B twice, the coach said "move toward B" in
 * two of three runs and "lean A" in the third, the same notes served; the
 * moments that ask where the enemy goes next came out right 4 times in 6. A
 * site the enemy is said to hit next ("expect them at A", "they will go
 * somewhere else", "the next call comes elsewhere", "the site they have not
 * touched is the one to expect", "expect it again"), and the player told to
 * lean, shift or move toward a site on the strength of earlier rounds ("the
 * change was to move toward B"), go. What to look for and how to get the
 * information stays: a sentence that waits on a sound, a sighting, a call or
 * a piece of utility ("if you hear them on B, rotate toward B"), a negation
 * ("do not guess which site they hit next") and a live read inside a round on
 * attack ("expect the defence to stack the site you have been loud on") stay.
 */
// A site letter is marked first, case sensitive (SITE_MARK), so "where they expect a peeker" names no site.
const SITE_MARK = /(?<![\w'§])([ABC])(?![\w'])/g;
const NEXT_SITE_REF = String.raw`(?:§[ABC](?:\s+site)?\b(?!\s+(?:main|long|short|link|lobby|heaven|hell|elbow|tower|halls?|garage|window|ramp|rafters|door|doors|default|exit|entrance|stairs|bath|hookah|showers?|hall|back|front)\b)|the\s+other\s+site|a\s+different\s+site|another\s+site|the\s+(?:site|one)\s+they\s+(?:have(?:n't|\s+not)|did(?:n't|\s+not)|never)\s+(?:yet\s+)?(?:touched|tried|tested|hit|gone|been)|somewhere\s+else|elsewhere|something\s+(?:different|else))`;
const NEXT_SITE_SUBJ = String.raw`(?:they|the\s+attackers|the\s+enem(?:y|ies)|that\s+team|the\s+other\s+team|a\s+team\s+that\s+[^.;,]{0,40}?)`;
const NEXT_SITE = [
  // "expect them at a different site", "expect the next hit on A", "expect the site they have not tried"
  new RegExp(String.raw`\b(?:expect|anticipate|predict)(?:ing)?\s+(?:(?:them|the\s+attackers|the\s+enem(?:y|ies)|that\s+team|the\s+(?:next\s+)?(?:hit|push|execute|attack|call)|it|their\s+(?:next\s+)?(?:hit|push|execute|call))\s+(?:to\s+(?:hit|go|come|run|push|try|be)\s+)?(?:(?:at|on|to|toward|towards|into|through|from)\s+)?)?${NEXT_SITE_REF}`, 'i'),
  // "expect it again", "expect the same rush again"
  /\bexpect(?:ing)?\s+(?:it|them|the\s+same\s+(?:hit|rush|push|execute|site))\s+(?:to\s+come\s+)?again\b/i,
  // "the site they have not touched is the one to expect", "B was the read"
  new RegExp(String.raw`${NEXT_SITE_REF}\s+(?:is|was|would\s+be)\s+(?:the\s+(?:one|site|place)\s+to\s+(?:expect|lean\s+(?:toward|towards|to)|set\s+up\s+for|stack)|the\s+read|where\s+(?:the\s+(?:next\s+)?hit|they)\s+(?:comes?|goes?|will))\b`, 'i'),
  // "they will go somewhere else", "that team usually calls something different next round"
  new RegExp(String.raw`\b${NEXT_SITE_SUBJ}\s*(?:'ll|\s+will|\s+would|\s+are\s+going\s+to|\s+is\s+going\s+to|\s+are\s+likely\s+to|\s+is\s+likely\s+to|\s+(?:almost\s+always|usually|often|probably|likely|tends?\s+to))\s+(?:(?:probably|likely|usually)\s+)?(?:hit|hits|go|goes|come|comes|run|runs|push|pushes|execute|try|tries|switch|switches|head|heads|call|calls|move|moves)\s+(?:(?:to|at|on|into|toward|towards|for|through)\s+)?${NEXT_SITE_REF}`, 'i'),
  new RegExp(String.raw`\b${NEXT_SITE_SUBJ}\s+(?:calls?|goes|hits|comes|runs|switches)\s+(?:(?:to|at|on)\s+)?${NEXT_SITE_REF}\s+(?:next|the\s+next|this)\s+round\b`, 'i'),
  // "the next call comes somewhere else", "the next hit will be at A"
  new RegExp(String.raw`\bthe\s+next\s+(?:call|hit|push|execute|attack)\s+(?:\w+\s+){0,3}?(?:comes?|goes|lands?|is|will\s+(?:be|come|go|land))\s+(?:\w+\s+){0,2}?(?:(?:at|on|to|from|in)\s+)?(?:${NEXT_SITE_REF}|back\s+to\s+what\s+worked)`, 'i'),
];
// The player leaning toward a site, as the answer to the enemy's earlier rounds.
const LEAN_SITE = new RegExp(String.raw`\b(?:lean(?:s|ed|ing)?|shift(?:s|ed|ing)?|mov(?:e|es|ed|ing)|stack(?:s|ed|ing)?|start(?:s|ed|ing)?|set(?:ting)?\s+up|play(?:s|ed|ing)?|rotat(?:e|es|ed|ing)|weight)\s+(?:\w+\s+){0,3}?(?:toward|towards|closer\s+to|over\s+to)\s+${NEXT_SITE_REF}`, 'i');
const LEAN_PATTERN = /\b(?:next\s+round|round\s+(?:two|three|four|five|six|\d{1,2})|the\s+round\s+after|after\s+(?:two|three|they|the\s+attackers|a\s+(?:failed|lost|won))|twice|in\s+a\s+row|the\s+change|changed?|setup|their\s+pattern|what\s+they\s+(?:did|showed|have\s+shown)|lost\s+(?:both|twice|there)|failed)\b/i;
// A move that waits on what the player hears, sees or is told is information, not a guess.
const NEXT_SITE_LIVE = /\b(?:if|when|once|until|unless|as\s+soon\s+as|the\s+moment)\b[^.;]{0,60}\b(?:hear|hears|heard|see|sees|saw|seen|spot|spots|spotted|info|information|contact|call|calls|called|sound|sounds|steps|footsteps|drone|dart|alarm|trip|tripwire|camera|shows?|showed|lurk|lurking|utility|points?)\b/i;
const NEXT_SITE_NEG = /\b(?:do\s+not|don't|never|cannot|can't|no\s+way\s+to|without|instead\s+of|rather\s+than|not)\s+(?:\w+\s+){0,2}?(?:guess|guessing|assume|assuming|know|predict|predicting|bet|betting|expect|expecting|tell|lean|leaning|stack|stacking|move|moving|shift|shifting)\b/i;
function checkNextSite(sentence) {
  const t = String(sentence || '').replace(SITE_MARK, '§$1');
  const hit = NEXT_SITE.map((re) => re.exec(t)).find(Boolean)
    || (LEAN_PATTERN.test(t) ? LEAN_SITE.exec(t) : null);
  if (!hit) return null;
  const head = t.slice(0, hit.index);
  if (NEXT_SITE_LIVE.test(t) || NEXT_SITE_NEG.test(head.slice(-40))) return null;
  return 'your reply told the player which site the enemy will hit next, or to lean toward a site because of earlier rounds, which is a guess; say what to look for, how to get the information early, and where to start so the first rotation reaches either site';
}

// ── A thrown or shot ability told as guided (the coach bench 11) ──────────

/*
 * NO GUIDED RECON BOLT (Nov 2026, the coach bench 11, KVOVQ6jiQw8-5): "fire
 * one Outlaw shot at the player guiding it" of a Sova Recon Bolt, which is
 * shot and flies on its own. What can be steered or controlled is the game
 * data's own (STEERED: "steer towards your crosshair", "take control",
 * "control it", "curve"): Guiding Light, Trailblazer, Prowler, Owl Drone,
 * Spycam, Thrash, Stealth Drone, High Tide, Blaze, Suspension, Curveball,
 * Cloudburst. A guide, steer or pilot verb in a sentence that names an
 * ability outside that set, or the player's words for the bolt (a recon dart,
 * a recon arrow), goes; so does one whose "it" is the only ability the
 * question named, when that is no steered one (askedFixed). A steered
 * ability named in the same sentence, and a negation, stay.
 */
const STEERED = new Set(Object.values(DATA.agents || {}).flatMap((a) => (a && a.kit) || [])
  .filter((k) => k && k.name && /\bsteer|\btake control\b|\bcontrol it\b|\bcurve (?:left|right)\b/i.test(String(k.description || '').replace(/<[^>]+>/g, '')))
  .map((k) => String(k.name).toLowerCase()));
const FIXED_NAMES = Object.values(DATA.agents || {}).flatMap((a) => (a && a.kit) || [])
  .filter((k) => k && k.name && ['C', 'Q', 'E', 'X'].includes(k.key) && !STEERED.has(String(k.name).toLowerCase())).map((k) => String(k.name));
const STEERED_RE = new RegExp(`\\b(?:${[...STEERED].map(esc).join('|') || 'NO_ABILITY'})\\b|\\b(?:bird|birds|dog|prowlers?|owl|camera|cam)\\b|(?<!\\brecon\\s)\\bdrones?\\b`, 'i');
const FIXED_RE = new RegExp(`\\b(?:${FIXED_NAMES.map(esc).join('|') || 'NO_ABILITY'})\\b|\\brecon\\s+(?:dart|arrow|bolt)s?\\b|\\b(?:the|a|their|his|her|that)\\s+(?:dart|arrow|bolt)\\b`, 'i');
const GUIDE = /\b(?:guid(?:e|es|ed|ing)(?!\s+light)|steer(?:s|ed|ing)?|pilot(?:s|ed|ing)?|controll(?:ed|ing)|remote[- ]control(?:led|ling)?)\b/i;
const GUIDE_IT = /\b(?:guid(?:e|es|ed|ing)(?!\s+light)|steer(?:s|ed|ing)?|pilot(?:s|ed|ing)?|controll(?:ed|ing))\s+(?:it|the\s+(?:dart|arrow|bolt))\b/i;
const GUIDE_NEG = /\b(?:not|never|cannot|can't|no one|nobody|nothing)\b[^.;]{0,20}$/i;
/** A fixed ability named in the question and no steered one: the "it" of an answer is that one. */
function askedFixed(text) {
  const t = String(text || '');
  return FIXED_RE.test(t) && !STEERED_RE.test(t);
}
function checkGuided(sentence, fixedAsked) {
  const t = String(sentence || '');
  const g = GUIDE.exec(t);
  if (!g || GUIDE_NEG.test(t.slice(Math.max(0, g.index - 30), g.index)) || STEERED_RE.test(t)) return null;
  const named = FIXED_RE.exec(t);
  if (!named && !(fixedAsked && GUIDE_IT.test(t))) return null;
  return `your reply said ${named ? `the ${named[0].replace(/^(?:the|a|their|his|her|that)\s+/i, '')}` : 'that ability'} is guided or steered, which the game data does not give it: it flies on its own once it is shot or thrown; say what the player can do about it, shoot it early or stay out of its line`;
}

// ── Utility told for the other side's job (the coach bench 11) ────────────

/*
 * THE SIDE'S OWN JOB (Nov 2026, the coach bench 11, _BagmBAjtsc-5): a defender
 * told to keep a Nanoswarm "for the post plant, where it can sit on the spike
 * and force a defuser off it", where on defence the defuser is his own team.
 * Told to the side the player said (facts.said.side): a defender stopping or
 * forcing off a defuse, an attacker stopping or denying a plant. The enemy as
 * the subject ("their Killjoy will swarm your defuse") and a negation stay.
 */
const DENY_DEFUSE = /\b(?:forc(?:e|es|ed|ing)|push(?:es|ed|ing)?|den(?:y|ies|ied|ying)|stop(?:s|ped|ping)?|punish(?:es|ed|ing)?|delay(?:s|ed|ing)?|interrupt(?:s|ed|ing)?|break(?:s|ing)?|deter(?:s|red|ring)?)\s+(?:a\s+|the\s+|any\s+|their\s+)?(?:defuser|defusers|defuse|defusal)\b|\b(?:a|the|their)\s+defusers?\s+off\b|\b(?:set|sets|setting)\s+(?:it\s+|one\s+)?off\s+when\s+the\s+defuse\s+starts\b/i;
const DENY_PLANT = /\b(?:stop(?:s|ped|ping)?|den(?:y|ies|ied|ying)|delay(?:s|ed|ing)?|interrupt(?:s|ed|ing)?|punish(?:es|ed|ing)?|break(?:s|ing)?)\s+(?:a\s+|the\s+|any\s+|their\s+)?(?:plant|planter|planters)\b/i;
const ENEMY_DOES = /\b(?:they|they'll|their|the\s+enemy|the\s+enemies|enemies|the\s+attackers|the\s+defenders|an?\s+attacker|an?\s+defender|the\s+other\s+team)\b[^.;]{0,40}$/i;
function checkSideUse(sentence, side) {
  if (side !== 'defense' && side !== 'attack') return null;
  const t = String(sentence || '');
  const m = (side === 'defense' ? DENY_DEFUSE : DENY_PLANT).exec(t);
  if (!m) return null;
  const head = t.slice(Math.max(0, m.index - 50), m.index);
  if (ENEMY_DOES.test(head) || NEGATED.test(head.slice(-30))) return null;
  return side === 'defense'
    ? 'your reply told a defender to stop or force off a defuse, which on defence is his own team\'s; on defence the utility kept for after the plant clears an attacker off a post plant spot for the retake'
    : 'your reply told an attacker to stop or deny a plant, which on attack is his own team\'s; on attack the utility kept for the post plant stops the defuse';
}

// ── Praise for what the player says they did not do (the coach bench 11) ──

/*
 * THE ACTION NOBODY TOOK (Nov 2026, the coach bench 11, FD8OFhwHF5M-2): "I
 * stood there with my knife out instead of reloading", answered "reloading
 * while the Omen covered you was the right call". The player's own account
 * names what they did not do ("instead of reloading", "did not reload",
 * "never reloaded", "forgot to reload", "without reloading"); a sentence that
 * praises that action as done ("reloading ... was the right call", "you were
 * right to reload") goes. Advice to do it ("reload while he covers you") stays.
 */
const NOT_DONE = /\b(?:instead\s+of|rather\s+than|without)\s+([a-z]{3,}ing)\b|\b(?:did\s+not|didn't|never|forgot\s+to|failed\s+to|did\s+not\s+even)\s+([a-z]{3,})\b/gi;
const PRAISED = /\b([a-z]{3,}ing)\b[^.;]{0,60}?\b(?:was|were)\s+(?:(?:also|still|exactly|absolutely)\s+)?(?:the\s+right\s+(?:call|move|play|thing|choice|idea)|right|fine|correct|good|smart|a\s+good\s+(?:call|habit|choice|idea))\b|\byou\s+(?:were|was)\s+right\s+to\s+([a-z]{3,})\b|\byou\s+did\s+(?:the\s+right\s+thing|well)\s+(?:by\s+)?([a-z]{3,}ing)\b/i;
const NOT_VERB = new Set(['have', 'know', 'see', 'get', 'want', 'think', 'say', 'mean', 'need', 'make', 'go', 'do', 'be', 'even', 'really', 'just', 'any', 'anything', 'something', 'thing', 'nothing', 'everything', 'during', 'morning', 'evening', 'being', 'having', 'doing']);
function verbStem(w) {
  let s = String(w || '').toLowerCase().replace(/(?:ing|ed)$/, '');
  if (/([b-df-hj-np-tv-z])\1$/.test(s)) s = s.slice(0, -1);
  return s.replace(/e$/, '');
}
/** The actions the player's account says they did not take, as stems. */
function notDoneOf(text) {
  const out = new Set();
  for (const m of String(text || '').matchAll(NOT_DONE)) {
    const w = (m[1] || m[2] || '').toLowerCase();
    if (!w || NOT_VERB.has(w)) continue;
    const st = verbStem(w);
    if (st.length >= 3) out.add(st);
  }
  return [...out];
}
function checkActionPremise(sentence, notDone) {
  if (!Array.isArray(notDone) || !notDone.length) return null;
  const t = String(sentence || '');
  const m = PRAISED.exec(t);
  if (!m) return null;
  const w = m[1] || m[2] || m[3];
  const st = verbStem(w);
  if (!notDone.includes(st) || NEGATED.test(t.slice(Math.max(0, m.index - 30), m.index))) return null;
  return `your reply praised the player for ${w.toLowerCase()}, which they said they did not do; answer the round as they told it, and say what to do instead`;
}

/*
 * THE SHORT BLIND SAID TO HAVE WORKED (Nov 2026, the coach bench 11,
 * BfumSarDJKw-3, the second bench running): "I popped it short, in front of
 * her, so the blind was short", answered "The blind did work". With the
 * right note served the answer still turned the account round. Where the
 * player says the flash popped short or the blind was short (shortBlindSaid),
 * a sentence saying their blind worked or was full goes; the general rule ("a
 * bird that pops on them gives the full blind") stays.
 */
const SHORT_BLIND_SAID = /\b(?:popped|pop|popping|went\s+off|exploded|burst)\s+(?:it\s+|the\s+\w+\s+)?(?:too\s+)?(?:short|early)\b|\b(?:the\s+)?(?:blind|flash)\s+was\s+(?:too\s+|very\s+)?short\b|\bshort\s+(?:blind|flash)\b/i;
const BLIND_WORKED = /\b(?:the|your)\s+(?:blind|flash|bird|flashbang)\s+(?:did|had)\s+work(?:ed)?\b|\b(?:the|your)\s+(?:blind|flash)\s+(?:was|landed\s+as)\s+(?:a\s+)?(?:full|complete|good|clean|long)\b|\byou\s+(?:did\s+)?blind(?:ed)?\s+(?:her|him|them|the\s+\w+)\s+fully\b|\b(?:she|he|they)\s+(?:was|were)\s+fully\s+blind(?:ed)?\b/i;
function shortBlindSaid(text) { return SHORT_BLIND_SAID.test(String(text || '')); }
function checkBlindPremise(sentence, shortSaid) {
  if (!shortSaid) return null;
  const t = String(sentence || '');
  const m = BLIND_WORKED.exec(t);
  if (!m || NEGATED.test(t.slice(Math.max(0, m.index - 30), m.index))) return null;
  return 'your reply said the player\'s blind worked or was full, where they said it popped short and the blind was short; answer the round as they told it';
}

module.exports = {
  checkBlindPremise, shortBlindSaid, SHORT_BLIND_SAID, BLIND_WORKED,
  checkActionPremise, notDoneOf, NOT_DONE, PRAISED,
  checkSideUse, DENY_DEFUSE, DENY_PLANT,
  checkGuided, askedFixed, STEERED, FIXED_RE, STEERED_RE, GUIDE,
  checkNextSite, NEXT_SITE, LEAN_SITE, LEAN_PATTERN, NEXT_SITE_LIVE, NEXT_SITE_NEG,
  checkClockBeforePlant, CLOCK_PRESSES, CLOCK_AFTER_PLANT, CLOCK_BEFORE_PLANT, checkSpikePremise, SPIKE_WAS_DOWN, ONE_SHOT_GUN, MOVE_ACCURATE,
  economyClaim, ECON_CLAIM, ECON_OUT_SAID, BUY_FOR, BUY_SUBJECT, BUY_TIME_BEFORE, AFFORD_TO, ROUND_KIND_LABEL, checkPistolPremise, pistolSaid, WON_PISTOL, LOST_PISTOL, PISTOL_HYPO, SAID_WON, SAID_LOST,
  checkMapHabit, MAP_HABIT, GUN_BEFORE_CLAIM, notePistolConflict, NOTE_WON_PISTOL, NOTE_LOST_PISTOL,
  checkOneShot, checkMoveFire, soloDrillFrame, teamDrill, pronounDrill, PRONOUN_DRILL, TEAM_HABIT, stripDisclaimer, checkUnobserved, checkBullets, hitsToKill,
  ONE_SHOT, ARMOUR_QUALIFIED, ANY_RANGE, LONG_RANGE, NEGATED, MOVE_FIRE, MOVE_FIRE_OK, MOVE_FIRE_PAST, MOVE_FIRE_COST, NAMED_ERROR, BULLET_NEGATED,
  SOLO_MODE, MODE_AWAY, TEAM_WORDS, MATCH_FRAME, DISCLAIMER, NO_TEAM_SAID, UNOBSERVED, HYPO, BULLET_CLAIM, BLOCKS,
};
