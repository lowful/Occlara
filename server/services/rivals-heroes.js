'use strict';

/**
 * Marvel Rivals hero traits, hand authored.
 *
 * WHY THIS IS NOT FETCHED. There is no official Marvel Rivals developer API.
 * Every tracker derives its data by scraping, community submission, or network
 * monitoring, and that last one is a thing this product can never do. The one
 * usable community dataset (Causalzap/rivalsvictory-assets) carries 40 heroes
 * against the 53 this app's own META block knows for Season 9.5, has no licence
 * at all, and classifies nothing about aim or mobility. It would be a
 * downgrade. marvelrivalsapi.com has been 502 for the whole of this work.
 *
 * So the traits live here, and the important part is what happens when a hero
 * is missing.
 *
 * ABSENCE MEANS SILENCE, NEVER A GUESS. A hero not in this table produces no
 * counter advice at all. Telling a player to switch off a flyer who is not
 * flying is worse than saying nothing, and the roster grows by roughly a hero
 * a season, so the table is always going to be behind at some point. That is
 * fine as long as being behind costs coverage rather than correctness. This is
 * the same rule the Valorant side follows: the coach reports what it can
 * verify and never infers.
 *
 * Fields:
 *   role   Vanguard | Duelist | Strategist, as the game names them
 *   aim    hitscan | projectile | melee, what the primary fire actually is
 *   air    flight | leap | ground, sustained flight vs a jump vs neither
 *   arch   dive | poke | brawl, which of the three archetypes it plays into
 *
 * Deliberately PARTIAL. Every entry here is one I am confident about; heroes I
 * am unsure of are omitted rather than guessed, which is exactly what the
 * fail-safe above is for. Extending it is a data task, and
 * `npm run test:rivalsheroes` asserts the shape of anything added.
 */

const HEROES = {
  // ── Vanguards ────────────────────────────────────────────────────────────
  'hulk':             { role: 'Vanguard',   aim: 'melee',      air: 'leap',   arch: 'dive'  },
  'doctor strange':   { role: 'Vanguard',   aim: 'projectile', air: 'flight', arch: 'brawl' },
  'groot':            { role: 'Vanguard',   aim: 'projectile', air: 'ground', arch: 'brawl' },
  'magneto':          { role: 'Vanguard',   aim: 'projectile', air: 'ground', arch: 'poke'  },
  'peni parker':      { role: 'Vanguard',   aim: 'projectile', air: 'ground', arch: 'brawl' },
  'venom':            { role: 'Vanguard',   aim: 'melee',      air: 'leap',   arch: 'dive'  },
  'thor':             { role: 'Vanguard',   aim: 'melee',      air: 'leap',   arch: 'brawl' },
  'captain america':  { role: 'Vanguard',   aim: 'melee',      air: 'leap',   arch: 'dive'  },
  'the thing':        { role: 'Vanguard',   aim: 'melee',      air: 'ground', arch: 'brawl' },
  'emma frost':       { role: 'Vanguard',   aim: 'projectile', air: 'ground', arch: 'brawl' },

  // ── Duelists ─────────────────────────────────────────────────────────────
  'iron man':         { role: 'Duelist',    aim: 'projectile', air: 'flight', arch: 'poke'  },
  'storm':            { role: 'Duelist',    aim: 'projectile', air: 'flight', arch: 'poke'  },
  'human torch':      { role: 'Duelist',    aim: 'projectile', air: 'flight', arch: 'poke'  },
  'the punisher':     { role: 'Duelist',    aim: 'hitscan',    air: 'ground', arch: 'poke'  },
  'black widow':      { role: 'Duelist',    aim: 'hitscan',    air: 'ground', arch: 'poke'  },
  'hela':             { role: 'Duelist',    aim: 'hitscan',    air: 'ground', arch: 'poke'  },
  'star-lord':        { role: 'Duelist',    aim: 'hitscan',    air: 'leap',   arch: 'dive'  },
  'hawkeye':          { role: 'Duelist',    aim: 'projectile', air: 'ground', arch: 'poke'  },
  'squirrel girl':    { role: 'Duelist',    aim: 'projectile', air: 'ground', arch: 'poke'  },
  'moon knight':      { role: 'Duelist',    aim: 'projectile', air: 'ground', arch: 'poke'  },
  'scarlet witch':    { role: 'Duelist',    aim: 'projectile', air: 'flight', arch: 'brawl' },
  // POKE, on the player's own call. The community genuinely splits on this one:
  // Bionic Hook and Tainted Voltage are anti-dive tools, which reads as brawl,
  // but his damage pattern is chip from range. Someone who plays the game said
  // poke, and that outranks a coin flip between two defensible reads.
  'winter soldier':   { role: 'Duelist',    aim: 'projectile', air: 'ground', arch: 'poke'  },
  'namor':            { role: 'Duelist',    aim: 'projectile', air: 'ground', arch: 'poke'  },
  'spider-man':       { role: 'Duelist',    aim: 'melee',      air: 'leap',   arch: 'dive'  },
  'black panther':    { role: 'Duelist',    aim: 'melee',      air: 'leap',   arch: 'dive'  },
  'magik':            { role: 'Duelist',    aim: 'melee',      air: 'leap',   arch: 'dive'  },
  'wolverine':        { role: 'Duelist',    aim: 'melee',      air: 'leap',   arch: 'dive'  },
  'iron fist':        { role: 'Duelist',    aim: 'melee',      air: 'leap',   arch: 'dive'  },
  'psylocke':         { role: 'Duelist',    aim: 'melee',      air: 'leap',   arch: 'dive'  },
  'mister fantastic': { role: 'Duelist',    aim: 'melee',      air: 'ground', arch: 'brawl' },
  'phoenix':          { role: 'Duelist',    aim: 'projectile', air: 'flight', arch: 'poke'  },

  // ── Strategists ──────────────────────────────────────────────────────────
  'luna snow':        { role: 'Strategist', aim: 'projectile', air: 'ground', arch: 'brawl' },
  'mantis':           { role: 'Strategist', aim: 'projectile', air: 'ground', arch: 'poke'  },
  'rocket raccoon':   { role: 'Strategist', aim: 'projectile', air: 'ground', arch: 'brawl' },
  'jeff the land shark': { role: 'Strategist', aim: 'projectile', air: 'ground', arch: 'brawl' },
  'cloak & dagger':   { role: 'Strategist', aim: 'projectile', air: 'ground', arch: 'brawl' },
  'adam warlock':     { role: 'Strategist', aim: 'projectile', air: 'ground', arch: 'poke'  },
  'loki':             { role: 'Strategist', aim: 'projectile', air: 'ground', arch: 'poke'  },
  'invisible woman':  { role: 'Strategist', aim: 'projectile', air: 'ground', arch: 'poke'  },
  'ultron':           { role: 'Strategist', aim: 'projectile', air: 'flight', arch: 'poke'  },
  // ── Classified 18 Sep 2026, from the request's own ground truth and the
  //    Season 10 research. aim is null throughout: hitscan versus projectile is
  //    not printed on the official hero pages and was not sourceable, and a
  //    guess there would be worse than the gap, since the one rule that reads it
  //    treats unknown as silence.
  'black cat':        { role: 'Duelist',   aim: null, air: 'leap',   arch: 'dive'  },
  'daredevil':        { role: 'Duelist',   aim: null, air: 'leap',   arch: 'dive'  },
  'rogue':            { role: 'Vanguard',  aim: null, air: 'flight', arch: 'dive'  },
  'angela':           { role: 'Vanguard',  aim: null, air: 'flight', arch: 'dive'  },
  'cyclops':          { role: 'Duelist',   aim: null, air: 'ground', arch: 'poke'  },
  'gambit':           { role: 'Strategist', aim: null, air: 'ground', arch: 'poke' },
  'elsa bloodstone':  { role: 'Duelist',   aim: null, air: 'ground', arch: 'poke'  },
  'blade':            { role: 'Duelist',   aim: null, air: 'ground', arch: 'brawl' },
  'devil dinosaur':   { role: 'Vanguard',  aim: null, air: 'leap',   arch: 'brawl' },
  // ── Classified 25 Sep 2026 from the OFFICIAL KIT TEXT on marvelrivals.com,
  //    as synced into rivals-data.generated.json, because no community read had
  //    settled. Role is printed. air and aim are filled only where the kit text
  //    says it outright, quoted beside each, and left null where it does not.
  //    arch is a reading of the kit, the same vocabulary the rest of this table
  //    uses: it describes what the kit is built to do, never how good it is.
  //
  //    Gorr: primary is "a 4-strike rapid combo with All-Black the Necrosword"
  //    (melee), Living Abyss "surge forward as an Invincible symbiote mass" and
  //    Shadow Harvest "warp to a selected Black Berserker" (a warp, which this
  //    table files as leap, as it does Magik's portals). A melee Duelist whose
  //    tools are for arriving on a target is dive.
  'gorr the god butcher': { role: 'Duelist', aim: 'melee', air: 'leap', arch: 'dive' },
  //    Jubilee: "explosive light blasts" do not say hitscan or projectile, so
  //    aim is null. Sparking Sprint raises jump height but gives no flight, so
  //    ground. Blooming Ball heals "allies in its radius" and Firework Finale
  //    orbits her and "heals allies" in a field, which is healing that works
  //    when the team stands together: brawl.
  'jubilee':          { role: 'Strategist', aim: null, air: 'ground', arch: 'brawl' },
  //    The Hood: "shoot forward dual-wielded pistols" does not settle aim, so
  //    null. Void Walk is "free-flight", filed as flight exactly as Doctor
  //    Strange's levitation is. Mantle of Oblivion is "a spherical barrier" and
  //    the rifles lifesteal at close range: a front line that holds space, brawl.
  'the hood':         { role: 'Vanguard',  aim: null, air: 'flight', arch: 'brawl' },
  //    White Fox: "fire a Fox Marble forward that bounces off terrain or heroes,
  //    then homes in" is a projectile by any reading. Spirit Sanctuary
  //    "teleport to a chosen ally" is a warp, so leap. She teleports TO her team
  //    and heals the area on arrival, which is staying together: brawl.
  'white fox':        { role: 'Strategist', aim: 'projectile', air: 'leap', arch: 'brawl' },
};

/**
 * Heroes with more than one role, one set of traits per role.
 *
 * DEADPOOL IS OFFICIALLY TRI-ROLE, data-tag="VANGUARD DUELIST STRATEGIST", and
 * his kit really does change shape with it, which is why he sat unclassified:
 * one archetype cannot describe him. Per role, it can. The Vanguard kit is
 * "Nobody lays a finger on my teammates" with a taunt and a shield bubble, the
 * Strategist kit is the same shape with healing, and the Duelist kit is
 * "Slash, dash, repeat", up to three chained dashes. All three double jump and
 * wall jump (Bunny Bounce, Bunny Hop, Healing Hop), so leap throughout.
 *
 * traits() returns a form ONLY WHEN THE ROLE IS KNOWN. Without it Deadpool is
 * still silent, which keeps the absence rule intact: a caller has to prove the
 * role before it may reason about him.
 */
const ROLE_FORMS = {
  'deadpool': {
    Vanguard:   { aim: null, air: 'leap', arch: 'brawl' },
    Duelist:    { aim: null, air: 'leap', arch: 'dive'  },
    Strategist: { aim: null, air: 'leap', arch: 'brawl' },
  },
};

/**
 * On the roster, but NOT yet classified.
 *
 * These heroes exist in the game and are absent from HEROES above, which means
 * every rule downstream stays silent about them. Listing them explicitly is the
 * difference between "we know this gap is here" and a table that quietly rots a
 * hero behind every season.
 *
 * The names come from the public hero list; the traits do not, because no
 * source publishes whether a hero is hitscan or can fly. Anyone who plays these
 * can move one up into HEROES by filling in four fields, and
 * `npm run test:rivalslive` will check the shape.
 *
 * NO SCRAPER SHIPS FOR THIS. rivalsdata.com serves 403 to a self-identifying
 * bot, and getting past that would mean pretending to be a browser. tracker.gg
 * disallows /marvel-rivals/matches/* and /*\/profile/* outright in robots.txt.
 * Both have said no in their own way, so this list is maintained by hand.
 */
const PENDING = [
  // Empty since 25 Sep 2026: Gorr, Jubilee, The Hood and White Fox were
  // classified from their official kits, and Deadpool moved to ROLE_FORMS. The
  // list stays, because the next season's hero lands here first, and a hero on
  // the roster with no entry anywhere is exactly the rot this list prevents.
];

/** Spellings the kill feed and scoreboard actually use. */
const ALIASES = {
  'punisher': 'the punisher',
  'jeff': 'jeff the land shark',
  'cloak and dagger': 'cloak & dagger',
  'dr strange': 'doctor strange',
  'strange': 'doctor strange',
  'bucky': 'winter soldier',
  'starlord': 'star-lord',
  'star lord': 'star-lord',
  'spiderman': 'spider-man',
  'rocket': 'rocket raccoon',
  'cap': 'captain america',
};

function normalise(name) {
  return String(name || '').toLowerCase().replace(/\s+/g, ' ').trim();
}

/** Traits for a hero, or null when it is not one we can vouch for. */
/*
 * The fetched half, keyed by lowercase name.
 *
 * Health, movement speed and the ability list come from the game's own site via
 * npm run sync:rivals. They are facts with a source, so they are never hand
 * written here, and a missing file costs the extra detail without costing the
 * archetype knowledge this module exists for.
 */
const GENERATED = (() => {
  try {
    const d = require('../rivals-data.generated.json');
    const by = {};
    for (const h of d.heroes || []) by[normalise(h.name)] = h;
    return by;
  } catch (e) {
    console.log('[rivals] generated hero data unavailable:', e.message);
    return {};
  }
})();

/**
 * Everything known about a hero, or null.
 *
 * TWO HALVES, joined here. The hand written half is archetype, aim and air,
 * which are community vocabulary that appears nowhere official. The fetched half
 * is health, speed and abilities, which are printed on the game's own hero
 * pages. Neither half can fill in for the other, and the join is the only place
 * that needs to know they are separate.
 *
 * ABSENCE STILL MEANS SILENCE. A hero with no hand written entry returns null
 * even when the sync knows its health, because an unclassified hero is one the
 * coach cannot reason about, and half a record invites exactly the guess this
 * module exists to refuse.
 */
/**
 * @param role  for a multi role hero, the role the caller has PROVEN. Ignored
 *              for everyone else. Without it a multi role hero returns null.
 */
function traits(name, role) {
  const n = normalise(name);
  if (!n) return null;
  const key = ALIASES[n] || n;
  let h = HEROES[key];
  if (!h && ROLE_FORMS[key] && ROLE_FORMS[key][role]) h = { role, ...ROLE_FORMS[key][role] };
  if (!h) return null;

  const g = GENERATED[key];
  const out = Object.assign({ name: key }, h);
  if (g) {
    if (g.health) {
      out.hp = g.health.base;                 // what one burst has to beat
      out.hpShield = g.health.shield || 0;    // regenerates out of combat
      out.hpTotal = g.health.total;
      // THE SQUISHY TEST, and it is exact rather than a feel. Official health is
      // trimodal: Strategists and most Duelists sit at 250 to 300, dive Duelists
      // at 150 plus a regenerating shield, Vanguards at 500 and up. So a target
      // worth diving is one whose BASE pool dies to a burst and who is not a
      // front liner. The shield is excluded on purpose: it refills out of
      // combat, which makes it a reason the diver survives rather than a reason
      // the target does.
      out.squishy = g.health.base <= 300 && h.role !== 'Vanguard';
    }
    if (g.speed) out.speed = g.speed;
    if (g.abilities && g.abilities.length) out.abilities = g.abilities;
  }
  return out;
}

function known(name) { return traits(name) !== null; }

/**
 * Is this string a real hero name, and what is its canonical form.
 *
 * DELIBERATELY NOT known(). That asks "can the coach reason about this hero",
 * and answers no for anything in PENDING, and for Deadpool until his role is
 * proven. This asks "did the model read a name
 * this game actually has", which is a different and weaker question, and the
 * right one for recording what the player picked. A player on Deadpool IS on
 * Deadpool; no rule can fire on him, and every rule downstream already returns
 * null on an unclassified hero, so carrying the true name costs nothing and
 * throwing it away loses a fact.
 *
 * Everything outside the roster is refused, which is the same closed-set move
 * the identify prompt makes: the model answered Mephisto and Doctor Doom when
 * nothing stopped it.
 */
const ROSTER_NAMES = new Set([...Object.keys(HEROES), ...Object.keys(ROLE_FORMS), ...PENDING.map(normalise)]);

/** Every hero name the game has, classified or not, in display case where known. */
function rosterKeys() { return [...ROSTER_NAMES]; }

function onRoster(name) {
  const n = normalise(name);
  if (!n) return null;
  const key = ALIASES[n] || n;
  return ROSTER_NAMES.has(key) ? key : null;
}

// Named constants rather than inline literals, because these two have already
// been destroyed twice by being written through a shell heredoc, where \r?\n
// collapses into a real newline and the file stops parsing. Keeping them here
// means there is one place to check.
/*
 * THERE ARE NO LINES BY THE TIME THIS RUNS, which is why this scans rather than
 * splits.
 *
 * The reply is asked for as one hero per line, "HERO: <name> | <side>", and the
 * model obliges. Then sanitize() in coach.js collapses every run of whitespace
 * into a single space, newlines included, because it was written for TIPS, where
 * a tip is one sentence and collapsing is exactly right. By the time /identify
 * gets the text it is a single line reading
 * "Hulk | mine Storm | mine Moon Knight | mine ...".
 *
 * The old parser split on /\r?\n/ and anchored each hero to the start and end of
 * a line, so it found one line, failed to match it, and returned an empty
 * roster. That is invisible from outside: an empty roster looks exactly like a
 * frame with no heroes in it, and it scored 100% precision in the grader,
 * because nothing wrong was reported.
 *
 * sanitize() is shared with the Valorant tip pipeline and this file is not
 * allowed to be a reason to edit it, so the fix belongs here. Scanning for the
 * "<name> | <side>" shape wherever it appears survives either format, and the
 * "HERO:" prefix is optional because the model drops it in practice.
 *
 * This regex does NOT decide what a hero is. traits() does, and an unrecognised
 * name produces silence.
 */
const RE_HERO_SCAN = /([^|\n]{1,40}?)\s*\|\s*(mine|ally|enemy|unknown)\b/gi;

/*
 * "HERO:" BECOMES THE LINE BREAK IT WAS STANDING IN FOR.
 *
 * Making the prefix optional inside the scan was not enough and produced a
 * subtler wrong answer than leaving it required. Scanning left to right, the
 * match after the first one begins at the space before "HERO:", the optional
 * group matches empty there, and the name capture swallows the prefix: the
 * roster came back as "iron man", "hero: the thing", "hero: luna snow". Every
 * entry but the first was a name no hero table will ever contain, so the grader
 * scored them as inventions and reported precision far below the truth.
 *
 * Replacing the marker with a newline first restores the structure sanitize()
 * flattened, and costs nothing when the model omits it.
 */
const RE_HERO_MARK = /\bHERO\s*:/gi;

/**
 * Parse the /identify reply into a roster.
 *
 * Lives here rather than in the route so it can be tested with no environment,
 * and because dropping a malformed line is a hero-knowledge decision: a line
 * that does not parse is a hero we cannot vouch for, which is the same rule
 * traits() follows.
 */
function parseRoster(raw) {
  const out = [];
  // A fresh regex per call: /g carries lastIndex, and a shared instance would
  // start the second call wherever the first one stopped.
  const text = String(raw || '').replace(RE_HERO_MARK, '\n');
  const re = new RegExp(RE_HERO_SCAN.source, 'gi');
  let m;
  while ((m = re.exec(text)) !== null) {
    const name = m[1].trim();
    if (name) out.push({ name, side: m[2].toLowerCase() });
  }
  return out;
}

module.exports = { HEROES, ROLE_FORMS, ALIASES, PENDING, traits, known, onRoster, rosterKeys, normalise, parseRoster };
