'use strict';

/**
 * Which part of the game a patch note line is about, by topic.
 *
 * The primer's stated facts (server/data/game-rules.json) carry topic tags, and
 * a line of Riot's patch notes tagged with one of a fact's topics withholds
 * that fact: from every prompt when the line is in the synced patch's notes
 * and the fact was verified on an earlier patch, and from a past match's
 * prompts when the line is in a patch released after that match. So these
 * patterns decide which facts a patch can quietly change, and a pattern that
 * matches nothing turns the whole gate into a green light.
 *
 * NARROW ON PURPOSE. "seconds" alone would tag every ability duration line as
 * the round timer, "half" every "half a second", "orbs" Reyna's Soul Orbs, and
 * "shield" Iso's Double Tap: each would withhold facts no patch touched. A
 * missed tag is the costlier error, though, since it lets a changed fact
 * through, so where a topic has a plain word for it (spike, credits, armor,
 * overtime) the plain word is kept.
 *
 * Every pattern has a positive and a negative line below, and check:primer
 * asserts each before it trusts any of them. Written with a file editing tool,
 * never through a shell heredoc (CLAUDE.md, Conventions).
 */

const TOPICS = {
  economy: /\b(?:credits?|creds|loss bonus|loss streak|economy|kill reward|round reward|win bonus)\b/i,
  armor: /\b(?:armou?r|regen shield|light shields?|heavy shields?)\b/i,
  // "Spike Rush" is a mode, never the spike's timings; a plant's time is the
  // spike's whatever heading it sits under ("Plant time: 4s >>> 3.5s").
  spike: /\b(?:spike(?! ?rush)|defuse|defuses|defused|defusing|defuser|detonat\w*|plant(?:ing)? (?:time|speed|duration))\b/i,
  timers: /\b(?:round timer|round time|round length|round duration|buy phase|buy timer|buy time|barriers?)\b/i,
  format: /\b(?:overtime|sudden death|halftime|half time|side swap|swap sides|switch sides|rounds to win|first to \d+|win by two|best of \d+)\b/i,
  ultimate: /\b(?:ultimate points?|ult points?|ultimate orbs?|ult orbs?)\b/i,
  swiftplay: /\bswift ?play\b/i,
  health: /\b(?:max(?:imum)? health|base health|health pool|starting health|max hp)\b/i,
};

// A line each pattern must tag, and one it must not. The negatives are the
// false alarms the narrowing above exists to avoid.
const EXAMPLES = {
  economy: ['Loss bonus credits increased from 1900 to 2000', 'Vandal fire rate reduced from 9.75 to 9.5'],
  armor: ['Heavy Armor now absorbs 70% of damage', "Iso's Double Tap shield now lasts longer"],
  spike: ['Spike defuse time reduced', 'Wingman can now plant faster when Gekko holds the angle'],
  timers: ['Buy phase timer reduced to 25 seconds', 'Tailwind duration reduced to 7 seconds'],
  format: ['Overtime now ends after one set', 'Reduced the half a second delay on Updraft'],
  ultimate: ['Ultimate orbs now give 2 points', 'Tour De Force ultimate cost 8 >>> 9'],
  swiftplay: ['Swiftplay credits adjusted', 'Spike Rush returns this act'],
  health: ['Maximum health is now 110', 'Devour heals 100 HP over time'],
};

// More lines each pattern must tag (true) or must not (false): the shapes Riot
// writes a change in, a heading and the short line under it, and the near
// misses the narrowing keeps out.
const CASES = [
  ['armor', 'Regen Shield', true],
  ['armor', 'Damage Absorption: 25 HP', false],
  ['spike', 'Spike', true],
  ['spike', 'Plant time: 4s >>> 3.5s', true],
  ['spike', 'Spike can no longer be defused while the defuser is stunned', true],
  ['spike', 'Half-defused progress is now kept for the whole round', true],
  ['spike', 'Spike Rush', false],
  ['spike', 'Spike Rush returns this act', false],
  ['spike', 'Spike Rush: the spike now detonates sooner', true],
  ['spike', 'Wingman can now plant faster when Gekko holds the angle', false],
  ['timers', 'Buy time reduced to 25 seconds', true],
  ['timers', 'Round length reduced to 90 seconds', true],
  ['timers', 'Tailwind duration reduced to 7 seconds', false],
  ['economy', 'Economy', true],
  ['economy', 'Loss bonus: 1,900 >>> 2,000', true],
];

/** The topics a line carries, plus every agent, weapon or map it names. */
function tagsOf(line, names) {
  const text = String(line || '');
  const out = new Set(Object.entries(TOPICS).filter(([, re]) => re.test(text)).map(([k]) => k));
  for (const n of names || []) if (n) out.add(String(n));
  return out;
}

/** Every pattern against its own two lines and its cases: [] when all hold, else what failed. */
function selfCheck() {
  const bad = [];
  for (const [k, re] of Object.entries(TOPICS)) {
    const [pos, neg] = EXAMPLES[k] || [];
    if (!pos || !re.test(pos)) bad.push(`${k} does not tag its positive line`);
    if (!neg || re.test(neg)) bad.push(`${k} tags its negative line`);
  }
  for (const [k, line, want] of CASES) {
    if (!TOPICS[k]) { bad.push(`a case names no topic ${k}`); continue; }
    if (TOPICS[k].test(line) !== want) bad.push(`${k} ${want ? 'does not tag' : 'tags'} "${line}"`);
  }
  return bad;
}

module.exports = { TOPICS, EXAMPLES, CASES, tagsOf, selfCheck };
