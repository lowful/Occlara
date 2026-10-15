'use strict';

/**
 * NO PLAYER'S NAME LEAVES THE SERVER IN A SENTENCE A MODEL WROTE (8.5.0).
 *
 * The models copy the name tags they see. The live read wrote a teammate's in
 * game name and an enemy's into its notes on the player's own Sunset match
 * ("teammate ... ahead", "player watching ... walk through B Site"; the names
 * here and in the tests are invented), and a look at a death sees the same
 * frames: KILLED BY and a name, a teammate's card, the kill feed. A sentence
 * the server sends back is saved in the review, shown, and handed to the
 * review model and Ask Coach, so a name in it has left. The client's read
 * notes have had a gate since 8.3.1
 * (valorant-rounds.js namesSomeone); this is its copy for what the server's
 * own models write, the death look first (death-forensics.js parse), for
 * every client.
 *
 * THE CLIENT'S RULE, WITH THREE CHANGES. A capitalised word none of the
 * game's lists know is a name: an agent, an ability, a weapon, a map, a
 * callout and the plain words of play are not people. Run as it is over the
 * 122 look sentences and round lines on record it called 66 of them names,
 * sentence first words above all ("Stay", 16, "Hold", 14, "Take", 8), so:
 *   - each sentence's first word is exempt, a coach's sentence opening on a
 *     verb (a sentence ends at a full stop, a question, an exclamation mark
 *     or a colon, never at a semicolon, "vs." or the death screen's "BY:");
 *   - a word straight after "teammate" or "ally" counts only when it is
 *     capitalised, where the client counts any word there ("teammate can",
 *     "teammates so" were 13 of the 21 left), which with the first rule leaves
 *     the capital rule itself;
 *   - the game's own words grow: the ability keys C, Q, E and X ("Press Q to
 *     Updraft"), the modes, Deathmatch and the Range among them, the ranks,
 *     the two sides, and Riot, Valorant and Occlara.
 * Over the same 122: none called a name, while "You were killed by Morvane
 * with a Vandal." and "Your teammate Tessik was ahead of you." are.
 *
 * IN ENGLISH. The rule reads capitals, and German writes every noun with one
 * ("Du bist durch Jetts Schuss gefallen"), while Polish and Turkish put a case
 * ending on an agent's own name ("Jetta", "Jett'in"): it was measured on
 * English sentences only, and in another language it would drop sentences
 * for being written in it. There, the shapes below and the match's own names
 * still hold.
 *
 * WHAT ALWAYS COUNTS, IN ANY LANGUAGE, first word included:
 *   - a Riot ID, a handle and a tag ("Morvane#EUW");
 *   - a handle's shape: an underscore inside a word ("big_boss"), or letters
 *     and digits mixed in one word of four or more ("xXmorvane99Xx") that is no
 *     game form (R5, 4v3, 1v1, 30s, 100hp, MB4);
 *   - THE MATCH'S OWN NAMES, when the client sent the match id (8.5.0 and
 *     later) and this server holds them: any word of any player's name or
 *     tag, in any case (opts.names, below).
 *
 * THE MATCH'S NAMES NEVER LEAVE THIS PROCESS. Riot's record of a match names
 * every player in it, and the round record's parse for /api/coach/match-rounds
 * keeps each word of them only as an HMAC under a key made at boot, by match
 * id, for a day (riot-rounds.js nameSetOf). The route hands the set it
 * gives to this gate as `names`, something that answers has(text) and holds
 * nothing it could print, and this gate asks it nothing else: no name of a
 * match is in a reply, a log line or a file, and after a restart only the
 * rule and the shapes run.
 *
 * WHAT IT RETURNS IS THE MODEL'S OWN WORD, for the caller to drop the sentence
 * by, or MATCH_NAME for a word of the match's own: never log it. The look logs
 * that a name was dropped, never which.
 *
 * Plain Node, no request in it: test:forensics drives it.
 */

let DATA = {};
try { DATA = require('../valorant-data.generated.json'); } catch { DATA = {}; }

/*
 * The client's plain words, word for word (src/shared/valorant-rounds.js
 * PLAIN_WORDS). check:server forbids requiring that file from here, so the
 * list lives twice, and test:forensics holds the two equal.
 */
const PLAIN_WORDS = `a an the and or but of by for to in on at into onto from with without within near nearby
  next behind beside inside outside under over above below across around past through toward towards ahead
  close far back front side left right center centre middle upper lower top bottom corner is are was were be
  been has have had who that which while still only just also already then now there here not no one two three
  four five six seven eight nine ten first second third last own player players player's you your we our they
  their them he she his her it its teammate teammates ally allies enemy enemies team mate mates
  holding holds held standing stands crouching crouched moving moves running runs walking walks peeking peeks
  aiming aims firing fires shooting shoots looking looks checking checks rotating rotates pushing pushes
  entering enters retaking retakes waiting waits hiding jumping using uses reloading reloads scoped scoping
  watching watches covering covers trading trades fighting fights planting plants defusing defuses lurking
  clearing clears swinging swings jiggling falling dropping following follows going goes coming comes
  grouped stacked stacking clustered spread spotted pinged calling marked visible alive alone together low
  high full empty half fast slow quick quickly slowly up down out off open closed opened
  hp health shield armor armour number numbers icon icons bar ult ultimate orbs orb ready charging charged
  signature ability abilities dash smoke smokes flash flashes wall walls utility util spike planted plant
  defuse defuser carried carrier carrying dropped knife gun weapon weapons pistol rifle sniper sidearm primary
  secondary op minimap map round rounds clock timer kill kills killed assist assists trade traded shot shots
  hit hits damage frag frags fight fights duel duels angle angles corner corners crosshair scope view camera
  screen hud prompt card name names live ace won lost kayo heaven hell default box boxes crate crates pit logs
  lane steps cover`;

/*
 * The game's own words the client's list lacks, which a look says and a read
 * note never did: the ability keys, the modes, the ranks, the roles, the two
 * sides, and the game and the app.
 */
const GAME_WORDS = `c q e x competitive unrated swiftplay spike rush deathmatch team premier escalation replication range
  iron bronze silver gold platinum diamond ascendant immortal radiant
  duelist duelists initiator initiators controller controllers sentinel sentinels
  attacker attackers attacking defender defenders defending riot valorant occlara vs`;

/** Every word of `s`, lower case, as the client splits a note. */
function wordsOf(s) {
  const out = [];
  for (const w of String(s || '').toLowerCase().split(/[^a-z0-9'/]+/)) if (w) out.push(w.replace(/'s$/, ''));
  return out;
}

/** The game's own words and the plain words of play: what is never a name. */
const NAMED = (() => {
  const out = new Set();
  const add = (s) => { for (const w of wordsOf(s)) out.add(w); };
  add(PLAIN_WORDS);
  add(GAME_WORDS);
  for (const [agent, a] of Object.entries(DATA.agents || {})) {
    add(agent);
    for (const ability of (a && a.abilities) || []) add(ability);
  }
  for (const w of Object.keys(DATA.weapons || {})) add(w);
  for (const m of DATA.maps || []) add(m);
  for (const w of Object.keys(DATA.mapCallouts || {})) add(w);
  for (const g of Object.values(DATA.mapGeometry || {})) for (const c of (g && g.callouts) || []) add(c && c.n);
  return out;
})();

// A Riot ID, the handle and its tag, as the server's sanitize() knows it. A
// round's number is not one: "round #12" is how a player asks about it.
const RIOT_ID = /\b[A-Za-z0-9_.]{3,16}\s?#\s?[A-Za-z0-9]{2,5}\b/g;
const ROUND_NUMBER = /^rounds?\s?#\s?\d+$/i;
// An underscore inside a word: a handle, never English.
const UNDERSCORE = /[A-Za-z0-9]_[A-Za-z0-9]/;
// The game's own forms with letters and digits in one word: 1v1, 4v3 and
// 1v1s, R5, 30s and 15m, 100hp, 60fps, MB4, 1st, x2, 4k, 50ms.
const GAME_FORM = /^(?:\d+v\d+s?|r\d+|\d+(?:s|ms|m|hp|k|x|st|nd|rd|th|fps)|mb\d+|x\d+)$/i;

/** The word in `text` shaped like a handle, or null. */
function handleShape(text) {
  for (const m of String(text || '').matchAll(RIOT_ID)) if (!ROUND_NUMBER.test(m[0])) return m[0];
  for (const t of String(text || '').split(/[^A-Za-z0-9_]+/)) {
    if (!t) continue;
    if (UNDERSCORE.test(t)) return t;
    if (t.length >= 4 && /[A-Za-z]/.test(t) && /\d/.test(t) && !GAME_FORM.test(t)) return t;
  }
  return null;
}

// ── The gate ────────────────────────────────────────────────────────────────

/*
 * A text's sentences, each to be read with its own first word exempt. A
 * sentence ends at a full stop, a question or an exclamation mark, and at a
 * colon ("One thing to fix: Trade your entry." opens on its verb again), but
 * never at a semicolon, after "vs." or at the colon of "by:" or "to:": the
 * death screen copied as "KILLED BY: Zorbo", "you pushed alone; Klumpf held
 * it" and "lost the 1v1 vs. Zorbo" made the name a first word, exempt. None of
 * the 122 sentences on record turns on it.
 */
function sentencesOf(text) {
  return String(text || '').split(/(?<=[.!?:])(?<!\bvs\.)(?<!\b(?:by|to):)\s+/i).filter((s) => s.trim());
}

/*
 * THE GAME'S OWN NAMES OF MORE THAN ONE WORD, and what its HUD prints in
 * capitals, which a look reads off its frames: the death screen's COMBAT
 * REPORT and SWITCH PLAYER, SPECTATING, the armour by the shop's names (Light
 * Armor, Heavy Armor, Regen Shield, and the Light and Heavy Shields before
 * them), a headshot and the round's banners. They reach the capital rule in
 * lower case, as the review's do in coach.js (REVIEW_WORDS), so "The COMBAT
 * REPORT shows you dealt no damage." keeps its sentence; a word of them alone,
 * "Light" or "Report", is read as it stands.
 */
const GAME_PHRASES = /\b(?:combat report|switch player|spectators?|spectating|(?:light|heavy|regen) (?:armou?r|shields?)|headshots?|clutch|thrifty|flawless)\b/gi;

// What namesSomeone gives for a word of the match's own: the set never says which.
const MATCH_NAME = 'a name of this match';

// What an admin bench is sent in place of a sentence of a model's own text
// that carries a word of the match's name set (coach.js rawForBench), and
// what bench:chat counts as a name there: the bench scores raw replies, and
// even a bench's reply carries no player's name.
const WITHHELD = '(withheld: a sentence naming a player of this match)';

/**
 * The word in `text` that is a person's name, MATCH_NAME, or null. Never log it.
 *
 * @param opts.names     the match's name set as the route has it (riot-rounds.js
 *                       nameSetOf): has(text) says whether any word of it is a
 *                       word of a player's name or tag in that match; null for none
 * @param opts.language  the text's language; the capital rule is English's alone
 */
function namesSomeone(text, opts = {}) {
  const t = String(text || '');
  if (!t.trim()) return null;
  const shaped = handleShape(t);
  if (shaped) return shaped;
  const names = opts && opts.names;
  if (names && typeof names.has === 'function' && names.has(t)) return MATCH_NAME;
  if (opts && opts.language && opts.language !== 'en') return null;
  for (const sentence of sentencesOf(t.replace(GAME_PHRASES, (w) => w.toLowerCase()))) {
    const toks = sentence.split(/[^A-Za-z0-9'/]+/).filter(Boolean);
    // The first word is exempt: a coach's sentence opens on a verb.
    for (let i = 1; i < toks.length; i++) {
      const tok = toks[i];
      const w = tok.toLowerCase().replace(/'s$/, '');
      // The game's own forms are no name either: R5, MB4, 1v1.
      if (NAMED.has(w) || /^\d+$/.test(w) || GAME_FORM.test(w)) continue;
      // Capitalised, and no word of the game's: a name. After "teammate" or
      // "ally" the same rule, where the client counts any word there.
      if (/[A-Z]/.test(tok)) return tok;
    }
  }
  return null;
}

module.exports = { namesSomeone, handleShape, sentencesOf, MATCH_NAME, WITHHELD, PLAIN_WORDS, GAME_WORDS, GAME_PHRASES };
