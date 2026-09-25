'use strict';

/**
 * Turn one Marvel Rivals end-of-match scoreboard into a review.
 *
 * DETERMINISTIC, for the reason lol-review.js states at its top and which
 * applies here word for word: a review is exactly where a confident wrong
 * sentence costs most, because the game is over and the player is reading a
 * summary of something they half remember. So the model is not involved. Every
 * line below is computed from a number that was printed on the screen.
 *
 * WHAT IT IS ALLOWED TO KNOW, and it is a short list:
 *
 *   the player's own row      kills, deaths, assists, damage, damage blocked,
 *                             healing, accuracy, all printed in columns
 *   the result                victory or defeat, printed
 *   the map and mode          printed
 *   the player's hero         from HERO SELECT, where the game prints the name,
 *                             never from a portrait
 *
 * WHAT IT REFUSES TO SAY, and every one of these is a line an automated review
 * wants to write and has not earned:
 *
 *   who the enemy team were. Naming heroes off scoreboard portraits graded 17
 *   to 42% precision against a 90% gate, so the enemy roster is not knowledge
 *   this app has. Without it there is no matchup, no counter call and no "you
 *   picked wrong into that comp".
 *
 *   anything about positioning, timing, or how a fight went. One frame at the
 *   end of a match contains no fights.
 *
 *   whether the scoreline was good IN THE ABSTRACT. It now compares against the
 *   player's own recent average, once there are enough matches, because that is
 *   a baseline it actually has. It still does not compare them to anybody else,
 *   and it still refuses to call a match good or bad: a delta is a direction of
 *   travel, not a verdict.
 *
 *   the archetype's verdict on the match. Knowing Black Panther is a dive hero
 *   does not tell you whether this Black Panther dived well.
 *
 * The one judgement it does make is the healing check, and it makes it because
 * the data is not close: measured across twelve real rows, Strategists healed
 * 13,068 to 33,213 and everybody else 0 to 567. See rivals-comp.js.
 */

const comp = require('./rivals-comp');

let TRAITS = {};
try {
  TRAITS = require('./rivals-abilities.generated.json').traits || {};
} catch {
  // No data means no hero knowledge, which costs the archetype line and nothing
  // else. Every read below treats a missing hero as unknown.
  TRAITS = {};
}

let BALANCE = null;
try {
  BALANCE = require('./rivals-balance.generated.json');
} catch {
  // No balance data costs the patch note and nothing else.
  BALANCE = null;
}

/**
 * How recently a balance post still counts as news.
 *
 * A review that opens "your hero changed in the latest patch" about a patch
 * from six months ago is furniture, not information. Thirty days is a little
 * over one patch cycle, so a player sees the note for the patch they are
 * actually playing and stops seeing it once it is simply how the hero works.
 *
 * The published date is rendered either way, so the player is never asked to
 * take "recently" on trust.
 */
const PATCH_FRESH_DAYS = 30;

const num = (v) => {
  const n = typeof v === 'string' ? Number(v.replace(/[,\s]/g, '')) : v;
  return typeof n === 'number' && isFinite(n) ? n : null;
};
const str = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null);
const norm = (s) => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();

/**
 * The mode as the game printed it, tidied, or null.
 *
 * NOT VALIDATED AGAINST A LIST, and the absence of that list is deliberate
 * rather than unfinished work. marvelrivals.com publishes no game modes page:
 * /gamemodes/ and /gameinfo/ both 404, and the homepage yields only the word
 * Convoy, in a paragraph about a map. So any mode table here would be written
 * from memory and presented as fact, which is the exact shape of the mistake
 * the counter table's header records: Dexerto and TheGamer both confidently
 * named an ability that appears on none of the 54 official pages.
 *
 * And the read does not need one. The mode is PRINTED TEXT in the corner of the
 * screen, which is the category of read that works. Checking a printed label
 * against an unsourced list would substitute a guess for the game's own words
 * and would drop a real mode the moment one is added. The review only displays
 * this field, it never branches on it, so a wrong mode costs one wrong word and
 * a dropped mode costs a true one.
 *
 * What IS checked is shape: a mode is a short label, not a sentence. A model
 * that answers with the objective text instead of the mode name gets dropped,
 * because that is a misread rather than a mode this code has not heard of.
 */
const MODE_MAX_WORDS = 3;
const MODE_MAX_CHARS = 28;

function modeName(raw) {
  const v = str(raw);
  if (!v) return null;
  if (v.length > MODE_MAX_CHARS) return null;
  if (v.split(/\s+/).length > MODE_MAX_WORDS) return null;
  // The game prints modes in capitals. Title case reads better beside a map
  // name and a result, and loses nothing.
  return v.replace(/\S+/g, (w) => (/[a-z]/.test(w) ? w : w[0] + w.slice(1).toLowerCase()));
}

/**
 * Did this hero change in the latest balance post, and what did NetEase say
 * about it.
 *
 * QUOTED, NEVER JUDGED. This does not report a buff or a nerf, because deciding
 * which one a change is requires inference and the inference is not safe:
 * "reduce cooldown" is a buff and "reduce damage" is a nerf, and the verb is
 * identical. NetEase already writes a one line characterisation per hero, in
 * their own words, so there is a sourced sentence available and nothing to
 * infer. The review quotes that and stops.
 *
 * It also never counts as a reason for anything. A hero changing is a fact
 * worth knowing after a match; it is not an explanation of how the match went,
 * and the review has no way to tell whether the change mattered.
 *
 * Deadpool maps to THREE sections because he is officially tri-role, so this
 * takes the one matching the role in play and otherwise declines to choose.
 */
function patchNote(hero, role, now = Date.now()) {
  if (!BALANCE || !hero) return null;
  const list = (BALANCE.heroes || {})[norm(hero)];
  if (!Array.isArray(list) || !list.length) return null;

  const published = Date.parse(BALANCE.published + 'T00:00:00Z');
  if (!isFinite(published)) return null;
  const ageDays = (now - published) / 86400000;
  if (ageDays > PATCH_FRESH_DAYS || ageDays < 0) return null;

  // One section, or the one matching the role actually played. With several
  // sections and no role to pick by, saying nothing beats picking the wrong
  // half of a tri-role hero's changes.
  let entry = list[0];
  if (list.length > 1) {
    entry = list.find((e) => e.role === role) || null;
    if (!entry) return null;
  }

  return {
    version: BALANCE.version,
    published: BALANCE.published,
    summary: entry.summary || null,
    count: entry.count,
    source: BALANCE.source,
  };
}

/**
 * How many past matches the baseline draws on, and the floor below which there
 * is no baseline at all.
 *
 * The same numbers lol-targets.js uses, and for the same reason recorded in
 * lol-grader.js: null is not a failure, it routes to "still learning you",
 * which is honest, where a delta computed from two matches is not.
 */
const RIVALS_BASELINE_GAMES = 10;
const RIVALS_MIN_BASELINE = 3;

/**
 * The metrics worth comparing, and WHAT EACH ONE IS COMPARABLE AGAINST.
 *
 * The scope is the whole design here. A global average across every match is
 * arithmetic that means nothing:
 *
 *   role   kills, deaths, assists, damage, blocked and healing are role shaped.
 *          A Strategist's kills and a Duelist's kills are different quantities,
 *          and a Vanguard dies more than a Strategist by design rather than by
 *          mistake. Comparing across roles manufactures a trend out of the
 *          player switching role.
 *
 *   hero   accuracy only. rivals-knowledge.js already states why: a projectile
 *          hero is naturally lower than a hitscan hero at identical skill, so
 *          the number only means something against the same hero. It says "if
 *          you cannot tell which the hero is, do not coach the accuracy", and
 *          comparing Hela's accuracy to Jeff's is that mistake with extra steps.
 *
 * `lowerIsBetter` exists for deaths alone and is not cosmetic: without it the
 * review congratulates a player for dying more than usual.
 */
const METRICS = [
  { id: 'kills',    label: 'Kills',    scope: 'role' },
  { id: 'deaths',   label: 'Deaths',   scope: 'role', lowerIsBetter: true },
  { id: 'assists',  label: 'Assists',  scope: 'role' },
  { id: 'damage',   label: 'Damage',   scope: 'role' },
  { id: 'healing',  label: 'Healing',  scope: 'role' },
  { id: 'blocked',  label: 'Blocked',  scope: 'role' },
  { id: 'accuracy', label: 'Accuracy', scope: 'hero' },
];

/**
 * This match against the player's own recent average.
 *
 * Returns only the metrics that HAVE a baseline. A metric with two prior
 * matches behind it is left out rather than shown with a shaky number, and the
 * caller reports how many matches the comparison rests on so the player can
 * weigh it themselves.
 */
function compareToHistory(history, row, role, hero) {
  const past = Array.isArray(history) ? history.slice(-RIVALS_BASELINE_GAMES) : [];
  const out = [];

  for (const m of METRICS) {
    const value = num(row[m.id]);
    if (value === null) continue;

    const peers = past.filter((h) => {
      if (!h || typeof h !== 'object') return false;
      if (m.scope === 'hero') return hero && norm(h.hero) === norm(hero);
      return role && h.role === role;
    }).map((h) => num((h.scoreline || {})[m.id])).filter((v) => v !== null);

    if (peers.length < RIVALS_MIN_BASELINE) continue;

    const mean = peers.reduce((a, b) => a + b, 0) / peers.length;
    // A COLUMN THAT IS ZERO AND ALWAYS HAS BEEN carries no information, and
    // rendering it costs a row that says nothing: "Blocked 0 (average 0)" on a
    // Strategist, every single match. This is not the same as dropping a metric
    // for being unflattering. A zero against a non-zero average is exactly the
    // row worth showing, and it still renders.
    if (value === 0 && mean === 0) continue;
    const baseline = Math.round(mean * 100) / 100;
    const delta = Math.round((value - baseline) * 100) / 100;
    // "Better" is the player's direction of travel, not a verdict on the match.
    const better = delta === 0 ? null : (m.lowerIsBetter ? delta < 0 : delta > 0);

    out.push({
      id: m.id, label: m.label, scope: m.scope,
      value, baseline, delta, better, games: peers.length,
    });
  }
  return out;
}

/** What an archetype is FOR. Durable knowledge: it does not expire with a patch. */
const ARCH_PURPOSE = {
  dive: 'reaching an isolated target and leaving before the rest of the team can answer',
  poke: 'winning ground at range before a fight starts, from an angle they have to walk into',
  brawl: 'holding a space with the team close enough to trade for each other',
};

/** Traits for a hero, matched case insensitively, or null. */
function traitsOf(hero) {
  const want = norm(hero);
  if (!want) return null;
  for (const name of Object.keys(TRAITS)) {
    if (norm(name) === want) return TRAITS[name] ? { name, ...TRAITS[name] } : null;
  }
  return null;
}

/**
 * Is this a real hero name, whether or not anything is known about it.
 *
 * THE SAME SPLIT the server draws between onRoster() and known(), and it is
 * needed again here for the same reason. A hero can be on the roster with no
 * archetype this review may use: next season's arrival before it is classified,
 * or Deadpool, who is tri-role and only gets one once his role is proven. A
 * player on Deadpool IS on Deadpool. Dropping the name because
 * the archetype is unknown throws away a true fact and opens the review with a
 * blank where the player knows exactly what they played, which reads as the app
 * being broken rather than as the app being careful.
 *
 * So the name is reported and the archetype is not, which is the honest split.
 */
function onRoster(hero) {
  const want = norm(hero);
  if (!want) return null;
  for (const name of Object.keys(TRAITS)) {
    if (norm(name) === want) return name;
  }
  return null;
}

/**
 * Which hero the player actually FINISHED on, and how sure we are.
 *
 * THE COMPLICATION THAT MAKES THIS A FUNCTION. Marvel Rivals lets you switch
 * hero mid match, at any respawn, and switching is a normal thing to do rather
 * than an edge case: the whole switch call this app wants to make one day is
 * built on it being normal. So a hero name read at hero select is a hero the
 * player STARTED on, and the scoreboard at the end may belong to somebody else.
 *
 * Nothing on the scoreboard names the hero readably, so this cannot be resolved
 * by looking. What CAN be done is detecting the contradiction: if the hero read
 * at draft is not a Strategist and the healing column proves a Strategist, the
 * player is not on that hero any more. In that case the name is dropped rather
 * than carried, because a review that opens by naming the wrong hero has lost
 * the player before the second line.
 *
 * The reverse contradiction is not detectable. A Duelist who switched to another
 * Duelist leaves no trace in any column, so `certain` is never true and the
 * caller is told so.
 */
function whichHero(hero, row) {
  const name = onRoster(hero);
  if (!name) return { hero: null, traits: null, stale: false, why: 'no hero was read' };

  const t = traitsOf(hero);
  // On the roster but unclassified. The name is a fact and the archetype is not,
  // and the contradiction check below needs a role it does not have, so it is
  // skipped rather than guessed at.
  if (!t) return { hero: name, traits: null, stale: false, why: null };

  const proven = comp.roleFromStats(row);

  // A MULTI ROLE HERO (Deadpool) gets the form for the role the scoreboard
  // PROVES, and nothing otherwise. Only the healing column proves a role, so in
  // practice that is his Strategist form. The role icon read is not enough:
  // his Vanguard and Duelist kits are different archetypes, and the icon is the
  // read that came back wrong at hero select.
  if (t.byRole) {
    const form = proven && t.byRole[proven];
    return form
      ? { hero: name, traits: { name, ...form }, stale: false, why: null }
      : { hero: name, traits: null, stale: false, why: null };
  }
  if (proven === 'Strategist' && t.role !== 'Strategist') {
    return { hero: null, traits: null, stale: true,
      why: `the healing column proves a Strategist and ${t.name} is a ${t.role}, `
        + 'so the hero was switched during the match' };
  }
  return { hero: t.name, traits: t, stale: false, why: null };
}

/**
 * Did the player do the thing their role is for?
 *
 * ONE CHECK, deliberately. The healing gap is an order of magnitude and needs no
 * threshold tuning. Damage blocked does NOT separate Vanguard from Duelist, the
 * real rows overlap, and any rule drawn through that overlap is a coin flip
 * wearing a number, so no such rule is written here.
 */
function roleShape(role, row) {
  const healing = num((row || {}).healing);
  if (role !== 'Strategist' || healing === null) return null;

  if (healing >= comp.HEALING_PROVES_STRATEGIST) {
    return { ok: true, metric: 'healing', value: healing,
      text: `You healed ${healing.toLocaleString()}, which is what the role is for.` };
  }
  return { ok: false, metric: 'healing', value: healing,
    text: `You played a Strategist and healed ${healing.toLocaleString()}. `
      + 'That is the one number the role is measured by, and it did not happen.' };
}

/**
 * The record to append to rivalsHistory after a review.
 *
 * Built from the REVIEW rather than from the raw frame, so whatever the review
 * refused to believe never enters the baseline either. A hero dropped for
 * contradicting the healing column does not get recorded as that hero, and a
 * role that was never verified is stored as whatever the review settled on.
 * One source of truth, and the history cannot disagree with the screen the
 * player was shown.
 */
function historyEntry(review, at = Date.now()) {
  if (!review || review.empty) return null;
  const g = review.game || {};
  return {
    at,
    hero: g.hero || null,
    role: g.role || null,
    mode: g.mode || null,
    map: g.map || null,
    result: g.result || null,
    scoreline: review.scoreline || {},
  };
}

/**
 * @param {object} p
 * @param {string} [p.hero]     the hero read at hero select, or null
 * @param {object} [p.state]    the scoreboard STATE from /api/rivals/review
 * @param {Array}  [p.history]  past rivalsHistory entries, oldest first
 * @returns {object} a review, or one carrying `empty: true` when the frame said nothing
 */
function buildReview(p) {
  const state = (p && p.state) || {};
  const row = state.me || {};

  const kills = num(row.kills);
  const deaths = num(row.deaths);
  const assists = num(row.assists);

  // A scoreboard with no scoreline is not a scoreboard. Saying so beats
  // rendering a review made of nulls, which reads as a bug rather than a gap.
  if (kills === null && deaths === null && assists === null) {
    return { kind: 'rivals', empty: true, why: 'no scoreline was read off the frame' };
  }

  const picked = whichHero(p && p.hero, row);

  // ROLE, from the three sources in order of how much they prove.
  //
  //   1. the hero, when it is known and not contradicted. A printed name
  //      resolved against a hand checked table is the strongest thing here.
  //   2. the healing column, which proves Strategist absolutely.
  //   3. the model's read of the role icon, passed through UNVERIFIED.
  //
  // verifyRole already encodes 2 against 3. The hero outranks both.
  const verified = comp.verifyRole(row.role, row);
  const role = picked.traits ? picked.traits.role : verified.role;
  const roleSource = picked.traits ? 'hero' : (verified.verified ? 'healing' : 'unverified');

  const arch = picked.traits ? picked.traits.arch : null;

  return {
    // An explicit discriminator, because the review window renders League
    // reviews too and the two shapes are only distinguishable by which optional
    // fields happen to be present. Sniffing that is the kind of check that
    // works until a League review legitimately has no lesson attached.
    kind: 'rivals',
    empty: false,
    game: {
      hero: picked.hero,
      role,
      roleSource,
      map: str(state.map),
      mode: modeName(state.mode),
      result: str(state.result),
      mvp: str(state.mvp),
    },
    scoreline: {
      kills, deaths, assists,
      damage: num(row.damage),
      blocked: num(row.blocked),
      healing: num(row.healing),
      accuracy: num(row.accuracy),
    },
    // What the hero is FOR. Always true, never a verdict on this match.
    archetype: arch ? { name: arch, purpose: ARCH_PURPOSE[arch] || null } : null,
    shape: roleShape(role, row),
    // What NetEase changed about this hero in the current patch, in their
    // words. Null when the hero is unknown, when nothing changed, or when the
    // patch is no longer news.
    patch: patchNote(picked.hero, role),
    // This match against the player's own recent average, scoped so the
    // comparison means something. Empty until there are enough matches, which
    // the caller reports as "still learning you" rather than as a gap.
    against: compareToHistory(p && p.history, row, role, picked.hero),
    historyCount: Array.isArray(p && p.history) ? p.history.length : 0,
    // Said out loud rather than left as an absence, because a player who can see
    // the enemy team on their own screen will otherwise assume the coach saw it
    // too and chose to say nothing.
    refused: refusals(picked),
  };
}

/** What this review knows it cannot say, in the player's words. */
function refusals(picked) {
  const out = [
    'who the enemy team were, because heroes cannot be read off portraits reliably',
    'how any individual fight went, because only the final scoreboard was captured',
  ];
  if (picked.stale) out.push(picked.why);
  else if (!picked.hero) out.push('which hero you played, because hero select was not captured');
  else out.push(`whether you switched off ${picked.hero} later, which the scoreboard does not show`);
  return out;
}

module.exports = { buildReview, whichHero, roleShape, traitsOf, modeName, patchNote,
  compareToHistory, historyEntry, PATCH_FRESH_DAYS, ARCH_PURPOSE,
  RIVALS_BASELINE_GAMES, RIVALS_MIN_BASELINE, METRICS };
