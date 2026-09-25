'use strict';

/**
 * Live Rivals tips: the moment gate, the hero table and the switch call.
 *
 * The assertions that matter most here are the NEGATIVE ones. This feature
 * tells a player to abandon the hero they chose, so being wrong is expensive in
 * a way that being quiet is not, and almost every rule in it exists to stop it
 * speaking rather than to make it speak.
 */
const moments = require('../src/shared/rivals-moments');
const heroes = require('../server/services/rivals-heroes');
const counters = require('../server/services/rivals-counters');

let failures = 0;
function check(name, cond, detail) {
  if (cond) { console.log('  ok    ' + name); return; }
  console.log('  FAIL  ' + name + (detail ? '  ' + detail : ''));
  failures++;
}

// ── The hero table ──────────────────────────────────────────────────────────
console.log('[rivals] hero traits');
{
  const ROLES = ['Vanguard', 'Duelist', 'Strategist'];
  const AIMS = ['hitscan', 'projectile', 'melee'];
  const AIRS = ['flight', 'leap', 'ground'];
  const ARCHES = ['dive', 'poke', 'brawl'];
  /*
   * ROLE AND ARCHETYPE ARE REQUIRED. AIM AND AIR MAY BE null.
   *
   * The table calls itself deliberately partial, and this check used to make
   * that impossible: adding a hero meant supplying all four fields, so
   * classifying an archetype forced a guess about aim as the price. Hitscan
   * versus projectile is not printed on the official hero pages and could not be
   * sourced, and the rule that reads it (flight-into-hitscan) already treats an
   * unknown value as silence.
   *
   * So null means "not known", an invented value would mean "known and wrong",
   * and the first of those is the one this repo is built to prefer. A WRONG
   * value is still a failure: null is allowed, "sniper" is not.
   */
  const okOrNull = (list, v) => v == null || list.includes(v);
  const bad = Object.entries(heroes.HEROES).filter(([, h]) =>
    !ROLES.includes(h.role) || !ARCHES.includes(h.arch)
    || !okOrNull(AIMS, h.aim) || !okOrNull(AIRS, h.air));
  check('every entry uses the known vocabulary', bad.length === 0, bad.map(([n]) => n).join(', '));

  const partial = Object.entries(heroes.HEROES).filter(([, h]) => h.aim == null || h.air == null);
  check('a partial entry is allowed and still carries role and archetype',
    partial.every(([, h]) => ROLES.includes(h.role) && ARCHES.includes(h.arch)),
    partial.map(([n]) => n).join(', '));

  check('lookup works', heroes.traits('Iron Man').air === 'flight');
  check('lookup is case and space insensitive', heroes.traits('  iron   man ').air === 'flight');
  check('aliases resolve', heroes.traits('Bucky').name === 'winter soldier');
  check('alias: Jeff', heroes.traits('Jeff').name === 'jeff the land shark');

  // THE IMPORTANT ONE. A hero we cannot vouch for must come back null so every
  // rule downstream stays quiet about it.
  check('an unknown hero returns null', heroes.traits('Some New Season 12 Hero') === null);
  check('empty input returns null', heroes.traits('') === null && heroes.traits(undefined) === null);

  const aliasTargetsExist = Object.values(heroes.ALIASES).every((v) => heroes.HEROES[v]);
  check('every alias points at a real entry', aliasTargetsExist);

  // PENDING is the roster we know exists but have not classified. It must not
  // overlap HEROES, or a hero would look both known and unknown, and every
  // entry in it must still resolve to null so the silence rule holds.
  const overlap = heroes.PENDING.filter((n) => heroes.HEROES[heroes.normalise(n)]);
  check('pending never overlaps classified', overlap.length === 0, overlap.join(', '));
  const leaky = heroes.PENDING.filter((n) => heroes.traits(n) !== null);
  check('every pending hero still returns null', leaky.length === 0, leaky.join(', '));

  // A multi role hero is silent until the caller proves which role. Deadpool's
  // Vanguard and Duelist kits are different archetypes, so a guess at the role
  // is a guess at the archetype.
  check('Deadpool with no role returns null', heroes.traits('Deadpool') === null);
  check('Deadpool as a Duelist is a dive hero', (heroes.traits('Deadpool', 'Duelist') || {}).arch === 'dive');
  check('Deadpool as a Strategist is a brawl hero',
    (heroes.traits('Deadpool', 'Strategist') || {}).arch === 'brawl'
    && heroes.traits('Deadpool', 'Strategist').role === 'Strategist');
  check('Deadpool is on the roster either way', heroes.onRoster('deadpool') === 'deadpool');
  const forms = Object.values(heroes.ROLE_FORMS).every((f) => Object.entries(f)
    .every(([role, t]) => ROLES.includes(role) && ARCHES.includes(t.arch)));
  check('every role form has a real role and archetype', forms);

  // The two lists together are the roster. META says 53 for Season 9.5, and if
  // that stops matching then one of the two is out of date, which is exactly
  // the drift this split exists to make visible.
  const total = Object.keys(heroes.HEROES).length + Object.keys(heroes.ROLE_FORMS).length
    + heroes.PENDING.length;
  const meta = require('../server/services/rivals-knowledge').META.heroCount;
  check('classified plus pending equals the known roster', total === meta,
    total + ' vs META ' + meta);
}

// ── The switch call ─────────────────────────────────────────────────────────
console.log('\n[rivals] switch advice');
{
  // The case the whole feature was asked for: flying into hitscan.
  const flying = counters.switchAdvice({
    mine: 'Iron Man',
    enemies: ['The Punisher', 'Black Widow', 'Groot'],
    score: { kills: 1, deaths: 4 },
  });
  check('flying into two hitscan fires', !!flying && flying.reason === 'flight-into-hitscan',
    JSON.stringify(flying));
  check('the tip names the threats', !!flying && /Punisher/.test(flying.text) && /Black Widow/.test(flying.text),
    flying && flying.text);

  // One hitscan is the normal state of a match.
  check('ONE hitscan does not fire', counters.switchAdvice({
    mine: 'Iron Man', enemies: ['The Punisher', 'Groot'], score: { kills: 1, deaths: 4 },
  }) === null);

  // Doing well beats theory.
  check('winning suppresses the call', counters.switchAdvice({
    mine: 'Iron Man', enemies: ['The Punisher', 'Black Widow'], score: { kills: 9, deaths: 2 },
  }) === null);

  // A grounded hero is not flying into anything.
  check('a grounded hero gets no flight call', counters.switchAdvice({
    mine: 'The Punisher', enemies: ['Black Widow', 'Hela'], score: { kills: 0, deaths: 3 },
  }) === null);

  // Unknown heroes are simply not counted.
  check('unknown enemies do not count toward the pattern', counters.switchAdvice({
    mine: 'Iron Man', enemies: ['Nobody', 'Someone Else', 'The Punisher'], score: { kills: 0, deaths: 3 },
  }) === null);
  check('an unknown OWN hero says nothing', counters.switchAdvice({
    mine: 'Unreleased Hero', enemies: ['The Punisher', 'Black Widow'], score: { kills: 0, deaths: 5 },
  }) === null);
  check('no enemies says nothing', counters.switchAdvice({ mine: 'Iron Man', enemies: [] }) === null);

  // Archetype rules.
  //
  // The Thing was swapped out of this comp deliberately. He is a named mobility
  // lockout now, and that rule runs first, so leaving him here tested the
  // lockout while claiming to test the archetype. Groot, Thor and Luna Snow are
  // a brawl comp with nothing that switches a dash off.
  const dive = counters.switchAdvice({
    mine: 'Spider-Man', enemies: ['Groot', 'Thor', 'Luna Snow'], score: { kills: 0, deaths: 3 },
  });
  check('diving into a brawl comp fires', !!dive && dive.reason === 'dive-into-brawl', JSON.stringify(dive));

  /*
   * ── The named mechanical counter ────────────────────────────────────────
   *
   * The example the whole feature was requested around: The Thing ends a Black
   * Panther dive because Yancy Street Charge leaves a zone that prevents
   * mobility abilities, and Panther's escape IS a mobility ability.
   *
   * It outranks the archetype rules on purpose. "Dive loses to brawl" is true
   * and general; naming the ability is something a player can go and look up.
   */
  const lock = counters.switchAdvice({
    mine: 'Black Panther', enemies: ['The Thing', 'Luna Snow'], score: { kills: 1, deaths: 5 },
  });
  check('a mobility lockout on the field beats the archetype rule',
    !!lock && lock.reason === 'mobility-lockout', JSON.stringify(lock));
  check('and it names the ability rather than the matchup',
    !!lock && /Yancy Street Charge/.test(lock.text), lock && lock.text);
  check('ONE lockout hero is enough, unlike the pattern rules',
    !!counters.switchAdvice({ mine: 'Spider-Man', enemies: ['Peni Parker'], score: { kills: 0, deaths: 4 } }));
  check('a poke hero hears nothing about it, they were not leaving anyway',
    counters.switchAdvice({ mine: 'Hela', enemies: ['The Thing', 'Luna Snow'], score: { kills: 0, deaths: 4 } }) === null);
  check('and neither does a diver with no lockout on the field',
    counters.switchAdvice({ mine: 'Black Panther', enemies: ['Luna Snow', 'Magneto'], score: { kills: 0, deaths: 4 } }) === null);
  check('every lockout tip fits the 22 word tip contract',
    counters.MOBILITY_LOCKOUT.every((l) => {
      const r = counters.switchAdvice({ mine: 'Black Panther', enemies: [l.hero, 'Luna Snow'], score: { kills: 0, deaths: 4 } });
      return r && r.text.split(/\s+/).length <= 22;
    }));
  check('and every hero it names is one the table actually knows',
    counters.MOBILITY_LOCKOUT.every((l) => heroes.traits(l.hero) !== null),
    counters.MOBILITY_LOCKOUT.filter((l) => !heroes.traits(l.hero)).map((l) => l.hero).join(', '));

  const poke = counters.switchAdvice({
    mine: 'Hawkeye', enemies: ['Spider-Man', 'Black Panther', 'Magik'], score: { kills: 1, deaths: 4 },
  });
  check('poking into a dive comp fires', !!poke && poke.reason === 'poke-into-dive', JSON.stringify(poke));
}

// ── Once per match ──────────────────────────────────────────────────────────
console.log('\n[rivals] the switch gate');
{
  const gate = counters.createSwitchGate();
  const p = { mine: 'Iron Man', enemies: ['The Punisher', 'Black Widow'], score: { kills: 0, deaths: 4 } };
  check('first call is advised', gate.advise(p) !== null);
  check('the same reason is never repeated', gate.advise(p) === null);
  gate.reset();
  check('a new match says it again', gate.advise(p) !== null);
}

// ── The moment gate ─────────────────────────────────────────────────────────
console.log('\n[rivals] moments');
{
  check('death is recognised', moments.momentFrom('RESPAWNING IN 5') === 'death');
  check('kill cam is a death', moments.momentFrom('kill cam') === 'death');
  check('team wipe is recognised', moments.momentFrom('TEAM WIPE!') === 'teamWipe');
  check('objective is recognised', moments.momentFrom('Point captured') === 'objective');
  check('round start is recognised', moments.momentFrom('Round 2') === 'roundStart');

  // Mid fight is NOT a moment, which is the entire point of the file.
  check('an ordinary fight frame is not a moment',
    moments.momentFrom('Iron Man is shooting at Groot near the payload') === null,
    JSON.stringify(moments.momentFrom('Iron Man is shooting at Groot near the payload')));
  check('empty text is not a moment', moments.momentFrom('') === null);

  // Priority: a death and a team wipe are the same instant.
  check('death outranks team wipe in one frame',
    moments.momentFrom('TEAM WIPE, respawning in 4') === 'death');
}

// ── The budget ──────────────────────────────────────────────────────────────
console.log('\n[rivals] the tip budget');
{
  const g = moments.createMomentGate({ maxPerMatch: 2, minGapMs: 1000 });
  let t = 0;
  check('closed until a moment opens', g.allows(t) === false);

  g.observe('respawning in 5', t);
  check('open right after a death', g.allows(t) === true);
  g.note(t);
  check('one tip per moment', g.allows(t) === false);

  t += 500;
  g.observe('point captured', t);
  check('too soon after the last tip', g.allows(t) === false, 'gap not enforced');

  t += 1200;
  g.observe('TEAM WIPE', t);
  check('allowed once the gap has passed', g.allows(t) === true);
  g.note(t);

  t += 5000;
  g.observe('respawning in 5', t);
  check('the per match budget is final', g.allows(t) === false, JSON.stringify(g.state));

  // A window that has expired does not still count as open.
  const g2 = moments.createMomentGate({ minGapMs: 0 });
  g2.observe('respawning in 5', 0);
  check('the window expires', g2.allows(moments.MOMENTS.death.windowMs + 1) === false);
}

/*
 * ── Reading the /identify reply ─────────────────────────────────────────────
 *
 * The first real scoreboard ever graded returned an EMPTY roster, and the
 * grader called it 100% precision and passed. The model had answered fine; it
 * simply wrote "Venom | enemy" where the prompt asked for "HERO: Venom | enemy",
 * and the parser required the prefix, so every line was discarded.
 *
 * That failure is silent by construction: an empty roster is indistinguishable
 * from a frame with no heroes in it. These cases exist so it cannot happen
 * twice, in both directions, because a parser loose enough to accept prose would
 * be a worse bug than the one it replaced.
 */
console.log('\nreading the identify reply:');
for (const [raw, want, why] of [
  ['HERO: Venom | enemy',              1, 'the documented shape'],
  ['Venom | enemy',                    1, 'the shape the model actually returns'],
  ['Venom | enemy\nStorm | mine',      2, 'several bare lines'],
  ['Jeff the Land Shark | ally',       1, 'a name with spaces survives'],
  ['HERO: Luna Snow | unknown',        1, 'an honest abstention still parses'],
  ['I think that might be Venom',      0, 'prose is refused'],
  ['Venom',                            0, 'a name with no side is refused'],
  ['Venom | sideways',                 0, 'an invented side is refused'],
  ['',                                 0, 'nothing in, nothing out'],
]) {
  check('  ' + why, heroes.parseRoster(raw).length === want,
    'got ' + heroes.parseRoster(raw).length + ', want ' + want);
}
check('  the side survives the parse',
  heroes.parseRoster('Magneto | enemy')[0].side === 'enemy');
check('  the name is trimmed, not padded',
  heroes.parseRoster('  Magneto   |  enemy ')[0].name === 'Magneto');

/*
 * THE SHAPE THAT ACTUALLY ARRIVES. sanitize() in coach.js collapses every run of
 * whitespace into one space, newlines included, because it was written for tips
 * where that is correct. So by the time /identify sees the reply it is a single
 * line. This string is verbatim from the live server on a real scoreboard, and
 * it is the case that returned an empty roster and a false PASS.
 */
{
  const asItArrives = 'Hulk | mine Storm | mine Moon Knight | mine Shark | mine '
    + 'Adam Warlock | mine Venom | enemy Cherry | enemy Magik | enemy Pyro | enemy '
    + 'Adam Warlock | enemy X-23 | enemy';
  const got = heroes.parseRoster(asItArrives);
  check('  a whole reply collapsed onto one line still parses', got.length === 11,
    'got ' + got.length + ', want 11');
  check('  and the sides survive the collapse',
    got[0] && got[0].side === 'mine' && got[5] && got[5].side === 'enemy');
  check('  parsing twice gives the same answer, no lastIndex leak',
    heroes.parseRoster(asItArrives).length === got.length);
}

/*
 * THE PREFIX MUST BE EATEN ON EVERY ENTRY, NOT JUST THE FIRST.
 *
 * When the model does use "HERO:" and sanitize() has flattened the newlines, a
 * merely optional prefix inside the scan is consumed on the first match and
 * swallowed into the NAME on every one after it: the roster parsed as
 * "Iron Man", "HERO: The Thing", "HERO: Luna Snow". Those are names no hero
 * table will ever hold, so they were scored as inventions and the measured
 * precision came out well below the real one. A parser bug reading as a model
 * failure is the worst kind, because the fix gets aimed at the wrong thing.
 */
{
  const prefixed = 'HERO: Iron Man | ally HERO: The Thing | ally HERO: Luna Snow | enemy';
  const names = heroes.parseRoster(prefixed).map((h) => h.name);
  check('  every prefixed entry keeps its name clean, not just the first',
    JSON.stringify(names) === JSON.stringify(['Iron Man', 'The Thing', 'Luna Snow']),
    'got ' + JSON.stringify(names));
  check('  and a prefixed name still resolves through the hero table',
    heroes.traits(heroes.parseRoster('HERO: Venom | enemy HERO: Storm | ally')[1].name) !== null);
}

if (failures) {
  console.log('\nFAIL: ' + failures + ' live-Rivals check(s) failed');
  process.exit(1);
}
console.log('\nPASS: it speaks only at readable moments, and only about heroes it knows');
