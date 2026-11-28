'use strict';

/**
 * HOW A NUMBER AND A TITLE ARE SHOWN (9.1, the owner's items 16 and 1). One
 * file, so every surface says the same thing the same way:
 *
 *   ONE SCORE, NO LETTERS (item 16). The grade is shown as its number out of
 *   100 and nothing else: no A, B, C, D or S anywhere a player looks. The
 *   letter still exists inside (grade.js letter(), progress.js runs), for the
 *   logic that needs a band, never to be drawn. The match rating is kept from
 *   3.0 to 10.0 inside (rating.js) and shown on the same 100 scale as the
 *   grade: the value times ten, rounded, so 8.3 is 83 and a move of +0.6 is
 *   +6. A move between two shown values is the difference of the two shown
 *   numbers (ratingMove), so "83, +6" never disagrees with the 77 before it.
 *
 *   THE TWO NAMES. "Grade" is how well you played, by the coach's read of the
 *   match; "Match rating" is how much you moved your team's chance to win.
 *   NAMES holds each name and its one line tooltip, and every surface that
 *   names either uses these words.
 *
 *   A TITLE INSIDE A SENTENCE (item 1). A mistake's title is written as a
 *   heading ("Dying in the first 30 seconds"); put after a word it reads
 *   "without dying in the first 30 seconds", its first letter lower case.
 *   Agent and map names, an acronym, a word with a digit, a callout's site
 *   letter ("B Main") and a few of the game's own names keep their capital.
 *
 * A plain file in both worlds, like killfeed.js: required in main, shared
 * modules and the tests, and loaded by a page as
 *   <script src="../../shared/display.js"></script>
 * which sets window.OcclaraDisplay. In a page it knows the agents only from
 * AGENTS below (test:display holds that list to valorant-data's).
 */
(function (root, make) {
  const api = make();
  if (typeof module === 'object' && module && module.exports) module.exports = api;
  else root.OcclaraDisplay = api;
})(typeof self !== 'undefined' ? self : this, function () {
  const fin = (v) => typeof v === 'number' && Number.isFinite(v);

  /*
   * THE TWO NAMES and what each measures, the tooltip of each wherever it is
   * named. Sentence case, no dashes.
   */
  const NAMES = {
    grade: {
      name: 'Grade',
      tip: "How well you played this match, out of 100, by the coach's read of your survival, impact, teamplay and decisions.",
    },
    rating: {
      name: 'Match rating',
      tip: "How much you moved your team's chance to win each round, out of 100. 60 is an even match.",
    },
  };

  // ── The grade ────────────────────────────────────────────────────────────

  /** A grade's number as shown: "84", or '' with no grade. Takes a score or { score }. */
  function grade(g) {
    const s = g && typeof g === 'object' ? g.score : g;
    return fin(s) ? String(Math.round(Math.max(0, Math.min(100, s)))) : '';
  }

  /** A grade said in words: "Grade 84", "Grade 84, provisional", or ''. */
  function gradeWords(g) {
    const n = grade(g);
    if (!n) return '';
    const prov = g && typeof g === 'object' && g.provisional;
    return `${NAMES.grade.name} ${n}${prov ? ', provisional' : ''}`;
  }

  /** A change in the grade: "+19", "-12", "0", or '' with no number. */
  function gradeDelta(d) {
    if (!fin(d)) return '';
    const t = Math.round(d);
    return t > 0 ? `+${t}` : t < 0 ? `-${-t}` : '0';
  }

  // ── The match rating ─────────────────────────────────────────────────────

  /** The rating on the 100 scale, a whole number: 8.3 is 83, or null with none. */
  function ratingPoints(v) {
    return fin(v) ? Math.round(v * 10) : null;
  }

  /** The rating as shown: "83", or '' with none. */
  function rating(v) {
    const p = ratingPoints(v);
    return p === null ? '' : String(p);
  }

  /** A move in the rating (in the rating's own units) as shown: +0.6 is "+6", -0.04 is "0". */
  function ratingDelta(d) {
    if (!fin(d)) return '';
    const t = Math.round(d * 10);
    return t > 0 ? `+${t}` : t < 0 ? `-${-t}` : '0';
  }

  /**
   * The move from one value to the next as shown: the difference of the two
   * shown numbers, so a list of values and their moves always adds up.
   */
  function ratingMove(after, before) {
    if (!fin(after) || !fin(before)) return '';
    const t = ratingPoints(after) - ratingPoints(before);
    return t > 0 ? `+${t}` : t < 0 ? `-${-t}` : '0';
  }

  /** Whether a shown move goes up, down, or nowhere: 'up' | 'down' | null. */
  function moveWay(text) {
    const s = String(text == null ? '' : text).trim();
    if (!/^[+-]\d/.test(s) || /^[+-]0+(?:\.0+)?$/.test(s)) return null;
    return s[0] === '+' ? 'up' : 'down';
  }

  /** A rating said in words: "Match rating 83", or ''. */
  function ratingWords(v) {
    const n = rating(v);
    return n ? `${NAMES.rating.name} ${n}` : '';
  }

  // ── A title inside a sentence ────────────────────────────────────────────

  // Every Valorant agent, for a page, which cannot read valorant-data. In main
  // the generated data is read as well, so an agent added there is known there
  // at once, and test:display fails until this list has it too.
  const AGENTS = ['Astra', 'Breach', 'Brimstone', 'Chamber', 'Clove', 'Cypher', 'Deadlock', 'Fade', 'Gekko', 'Harbor', 'Hush',
    'Iso', 'Jett', 'KAY/O', 'Killjoy', 'Miks', 'Neon', 'Omen', 'Phoenix', 'Raze', 'Reyna', 'Sage', 'Skye', 'Sova', 'Tejo',
    'Veto', 'Viper', 'Vyse', 'Waylay', 'Yoru'];
  const MAPS = ['Abyss', 'Ascent', 'Bind', 'Breeze', 'Corrode', 'Fracture', 'Haven', 'Icebox', 'Lotus', 'Pearl', 'Split',
    'Summit', 'Sunset'];
  // The game's own names, and the two words that are always written so.
  const OWN = ['I', 'Riot', 'Occlara', 'Valorant', 'League', 'Spike', 'Deathmatch', 'Swiftplay', 'Competitive', 'Unrated',
    'Range', 'Baron', 'Dragon', 'Herald', 'Nexus', 'Elder', 'Rift'];
  // A callout's site letter is a name ("B Main", "A site"): the article "A"
  // before a plain word is not.
  const SITE_WORDS = /^(?:site|main|long|short|link|lobby|heaven|hell|hall|halls|elbow|ramp|tree|tower|door|doors|garage|window|rafters|default|plat|platform|stairs|back|front|exit|cubby|pocket|nest|top|bottom|connector|haven)$/i;

  let names = null;
  function known() {
    if (names) return names;
    names = new Set([...AGENTS, ...MAPS, ...OWN].map((w) => w.toLowerCase()));
    // In main and the tests, every agent and map the game data knows, and
    // League's champions.
    if (typeof require === 'function') {
      try {
        const d = require('./valorant-data.generated.json');
        for (const a of Object.keys(d.agents || {})) names.add(a.toLowerCase());
        for (const m of d.maps || []) names.add(String(m).toLowerCase());
      } catch (e) { /* the lists above */ }
      try {
        const l = require('./lol-data.generated.json');
        const champs = l && (l.champions || l.champs);
        const list = Array.isArray(champs) ? champs.map((c) => (c && (c.name || c.id)) || c) : Object.keys(champs || {});
        for (const c of list) if (typeof c === 'string') names.add(c.toLowerCase());
      } catch (e) { /* none */ }
    }
    return names;
  }

  /** More names a caller knows (a page with the agents it was sent): kept capitalised from now. */
  function addNames(list) {
    const k = known();
    for (const n of Array.isArray(list) ? list : []) if (typeof n === 'string' && n.trim()) k.add(n.trim().toLowerCase());
  }

  /**
   * A title put inside a sentence: its first letter lower case unless its
   * first word is a name. "Dying in the first 30 seconds" becomes "dying in
   * the first 30 seconds"; "Reyna kept winning", "B Main" and "KAY/O kept
   * winning" stay as they are. Anything not a string is ''.
   */
  function inSentence(title) {
    const t = typeof title === 'string' ? title.trim() : '';
    if (!t) return '';
    const m = /^([^\s,.:;!?]+)(\s+(\S+))?/.exec(t);
    const first = m ? m[1] : t;
    const next = m && m[3] ? m[3] : '';
    // Not a capital to begin with, or a digit, or an acronym (two capitals or
    // more, "KAST", "KAY/O", "3K"): left as it is.
    if (!/^[A-Z]/.test(first)) return t;
    if (/\d/.test(first) || /^[A-Z][A-Z/'’-]*[A-Z]$/.test(first.replace(/['’]s$/, ''))) return t;
    // A name: an agent, a map, a champion, the game's own words, possessive too.
    const bare = first.replace(/['’]s$/, '').toLowerCase();
    if (known().has(bare) || known().has(first.toLowerCase())) return t;
    // A site letter before a callout word or another name ("A Main", "B site").
    if (/^[ABC]$/.test(first) && next && (SITE_WORDS.test(next.replace(/[^A-Za-z]/g, '')) || /^[A-Z]/.test(next))) return t;
    return first[0].toLowerCase() + t.slice(1);
  }

  return {
    NAMES, grade, gradeWords, gradeDelta,
    ratingPoints, rating, ratingDelta, ratingMove, moveWay, ratingWords,
    inSentence, addNames, AGENTS, MAPS,
  };
});
