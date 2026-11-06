'use strict';

/**
 * Check the worked cases (server/data/cases.json, 8.8) the way check:playbook
 * checks the notes: a case is prose fed to the coach as true, and a wrong tag
 * does not crash anything, it just makes the case unreachable or puts it in
 * front of the wrong player.
 *
 * Checked:
 *   - the shape: id (unique), title, the situation's eight keys, signal,
 *     decision, why, mistakeToAvoid, ranks, minBand, patchSensitive, source
 *   - every tag value is one cases.js can match: phase, side, role, agent and
 *     enemyAgents (the game data's agents), map (the game data's maps), site,
 *     economy, cause (death-forensics.js CAUSES), patterns (PATTERN_TOPICS)
 *   - ranks are the four bands, each once, minBand is the lowest of them and
 *     tier is advanced exactly when minBand is Platinum or above
 *   - every case is reachable: it carries an anchor cases.js serves on, and
 *     is served in the situation its own tags describe, except the cases for
 *     any agent with one kind of anchor, which cases.js holds back by design
 *     (listed, at most HELD_BACK_MAX)
 *   - no em or en dashes, no curly quotes, NO SEMICOLONS in player facing text
 *   - NO NAMES: a capitalised word inside a sentence must be a word of the
 *     game's own (an agent, an ability, a map, a callout, a gun), a rank, a
 *     role or one of the few plain words below. A coach, a streamer, a team or
 *     a channel is none of those. check:attribution scans this file as well.
 *   - an ability a case names belongs to its agent, an enemy agent it is
 *     tagged for, or an agent the case names; a callout belongs to its map
 *   - the source holds kind and topic (and declared claims), never who
 *   - every declared claim, a gun's hits or field or a game rule
 *     (`{ rule, value }`), computed against the primer (game-primer.js
 *     noteClaims), and a case that declares source.numbers has every digit
 *     in its text covered by one
 *
 * CHECK_CASES_PLANT names a file of cases to add, which a run must fail on,
 * so a check that stops checking is seen (test:advancedtips plants them).
 *
 * Run: npm run check:cases
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const data = require(path.join(ROOT, 'server', 'valorant-data.generated.json'));
const { noteClaims } = require(path.join(ROOT, 'server', 'services', 'game-primer.js'));
const knowledge = require(path.join(ROOT, 'server', 'services', 'knowledge.js'));
const review = require(path.join(ROOT, 'server', 'services', 'match-review.js'));
const forensics = require(path.join(ROOT, 'server', 'services', 'death-forensics.js'));
const casesMod = require(path.join(ROOT, 'server', 'services', 'cases.js'));

const FILE = path.join(ROOT, 'server', 'data', 'cases.json');
const AGENTS = Object.keys(data.agents || {});
const MAPS = data.maps || [];
const BANDS = knowledge.RANK_BANDS;

const VALID = {
  phase: new Set(['buy', 'early', 'mid', 'execute', 'postplant', 'retake', 'clutch', 'late', 'between']),
  side: new Set(['attack', 'defense']),
  role: new Set(['duelist', 'controller', 'initiator', 'sentinel']),
  site: new Set(['A', 'B', 'C', 'mid']),
  economy: new Set(['full', 'eco', 'antieco', 'pistol', 'bonus', 'lostpistol']),
  cause: new Set(Object.keys(forensics.CAUSES || {}).filter((c) => c !== 'unclear')),
  patterns: new Set(Object.keys(review.PATTERN_TOPICS || {})),
};
// The phases and economies a review or a question can show (cases.js fromReview, chat-prompt.js casesFor).
const SEEN_PHASES = new Set(['early', 'mid', 'execute', 'postplant', 'retake', 'clutch', 'late']);
const SEEN_ECONOMIES = new Set(['pistol', 'antieco', 'lostpistol']);
const SITUATION_KEYS = ['phase', 'side', 'role', 'agent', 'enemyAgents', 'map', 'site', 'economy'];
const TEXT_KEYS = ['title', 'signal', 'decision', 'why', 'mistakeToAvoid'];
const SOURCE_KEYS = new Set(['kind', 'topic', 'numbers', 'claims']);

// The game's own words, lower case: agents, abilities, maps, callouts, guns, gear.
const GAME = new Set();
const addWords = (s) => { for (const w of String(s || '').split(/[^A-Za-z/]+/)) if (w) GAME.add(w.toLowerCase()); };
for (const [a, x] of Object.entries(data.agents || {})) {
  addWords(a);
  for (const k of x.kit || []) addWords(k.name);
  for (const ab of x.abilities || []) addWords(ab);
}
for (const m of MAPS) addWords(m);
for (const c of Object.keys(data.mapCallouts || {})) addWords(c);
for (const g of Object.values(data.mapGeometry || {})) for (const c of (g && g.callouts) || []) addWords(c.n);
for (const w of Object.keys(data.weapons || {})) addWords(w);
for (const g of Object.keys(data.gear || {})) addWords(g);
// Ranks, roles, the settings path to the shooting error graph, and plain words
// the coaching voice capitalises.
for (const w of ['iron', 'bronze', 'silver', 'gold', 'platinum', 'diamond', 'ascendant', 'immortal', 'radiant',
  'duelist', 'controller', 'initiator', 'sentinel', 'settings', 'video', 'stats', 'shooting', 'error',
  'ct', 'hp', 'kda', 'smgs', 'i', 'a', 'b', 'c', 'heaven', 'hell', 'main', 'long', 'short', 'tower', 'elbow',
  'site', 'mid', 'spawn', 'operator', 'spike']) GAME.add(w);

// Ability (as the game spells it) -> owners, as check:playbook builds it.
const ABILITY_OWNERS = new Map();
for (const [agent, info] of Object.entries(data.agents || {})) {
  for (const k of info.kit || []) {
    // As the game spells it: "Drift" and "Focus" are kit names, "players drift" is English.
    const key = String(k.name || '');
    if (key.length < 4) continue;
    if (!ABILITY_OWNERS.has(key)) ABILITY_OWNERS.set(key, new Set());
    ABILITY_OWNERS.get(key).add(agent.toLowerCase());
  }
}
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
const wordIn = (w, text) => new RegExp(`(^|[^A-Za-z/])${esc(w)}($|[^A-Za-z/])`, 'i').test(text);
const exactIn = (w, text) => new RegExp(`(^|[^A-Za-z/])${esc(w)}($|[^A-Za-z/])`).test(text);

const DASHES = new RegExp('[' + String.fromCharCode(0x2013, 0x2014) + ']');
const CURLY = new RegExp('[' + String.fromCharCode(0x2018, 0x2019, 0x201C, 0x201D) + ']');

/** The situation a case's own tags describe, at its lowest band, Advanced coaching on. */
function situationFor(c) {
  const s = c.situation || {};
  const agent = s.agent || (s.role ? AGENTS.find((a) => knowledge.roleOf(a) === s.role) : null);
  const enemies = Array.isArray(s.enemyWithout) ? AGENTS.filter((a) => !s.enemyWithout.includes(a)).slice(0, 5) : (s.enemyAgents || []).slice(0, 1);
  return { agent, map: s.map, sides: s.side ? [s.side] : ['attack', 'defense'], phases: s.phase ? [s.phase] : [],
    economies: s.economy ? [s.economy] : [], causes: c.cause || [], patterns: c.patterns || [], enemies,
    rankBand: c.minBand, advanced: true };
}

/** Every problem with a list of cases: [{ id, msg }]. */
/** A case for any agent with fewer than two kinds of anchor a review shows. */
function heldBack(c) {
  const s = c.situation || {};
  if (s.agent || s.role) return false;
  const kinds = [Array.isArray(c.cause) && c.cause.length, Array.isArray(c.patterns) && c.patterns.length,
    (Array.isArray(s.enemyAgents) && s.enemyAgents.length) || (Array.isArray(s.enemyWithout) && s.enemyWithout.length),
    SEEN_ECONOMIES.has(s.economy), SEEN_PHASES.has(s.phase)].filter(Boolean).length;
  return kinds < 2;
}
// The cases held back when the stricter match came in (8.8, measured): 42 of
// 157, most of them a mid or late round read no review can see.
const HELD_BACK_MAX = 42;
const HELD = [];

function check(list) {
  const problems = [];
  HELD.length = 0;
  const fail = (c, msg) => problems.push({ id: (c && c.id) || '?', msg });
  if (!Array.isArray(list)) return [{ id: '-', msg: 'cases.json is not an array' }];
  const ids = new Set();
  const texts = new Set();
  for (const c of list) {
    if (!c || typeof c !== 'object') { fail(c, 'an entry that is not an object'); continue; }
    if (typeof c.id !== 'string' || !c.id) fail(c, 'no id');
    else if (ids.has(c.id)) fail(c, 'duplicate id');
    else ids.add(c.id);
    for (const k of TEXT_KEYS) {
      const t = c[k];
      if (typeof t !== 'string' || !t.trim()) { fail(c, `${k} is empty`); continue; }
      if (DASHES.test(t)) fail(c, `${k} contains an em or en dash`);
      if (CURLY.test(t)) fail(c, `${k} contains a curly quote`);
      if (t.includes(';')) fail(c, `${k} contains a semicolon, which no player facing text may`);
      // No names: a capitalised word inside a sentence is a word of the game's own.
      const toks = t.split(/\s+/);
      toks.forEach((tok, i) => {
        const w = tok.replace(/^[("']+|[)"',.!?:]+$/g, '').replace(/'s$/, '');
        if (!/^[A-Z]/.test(w)) return;
        if (i === 0 || /[.!?:]$/.test(toks[i - 1])) return;
        const parts = w.split('/');
        const known = (x) => GAME.has(x.toLowerCase()) || GAME.has(x.toLowerCase().replace(/s$/, ''));
        if (parts.every(known) || known(w)) return;
        fail(c, `${k} capitalises "${w}", which is no word of the game, a rank or a role: a name may never reach a case`);
      });
    }
    const key = TEXT_KEYS.slice(1).map((k) => c[k]).join(' ').toLowerCase();
    if (texts.has(key)) fail(c, 'duplicate case text');
    texts.add(key);

    const s = c.situation;
    if (!s || typeof s !== 'object') { fail(c, 'no situation'); continue; }
    for (const k of SITUATION_KEYS) if (!(k in s)) fail(c, `situation has no ${k} (null when any)`);
    for (const k of ['phase', 'side', 'role', 'site', 'economy']) {
      if (s[k] !== null && s[k] !== undefined && !VALID[k].has(s[k])) fail(c, `situation.${k} "${s[k]}" is not one cases.js matches, so the case is unreachable`);
    }
    if (s.agent !== null && s.agent !== undefined && !AGENTS.includes(s.agent)) fail(c, `unknown agent "${s.agent}"`);
    if (s.agent && s.role && String(data.agents[s.agent] && data.agents[s.agent].role).toLowerCase() !== s.role) fail(c, `role ${s.role} is not ${s.agent}'s`);
    if (s.map !== null && s.map !== undefined && !MAPS.includes(s.map)) fail(c, `unknown map "${s.map}"`);
    for (const k of ['enemyAgents', 'enemyWithout']) {
      if (s[k] === undefined && k === 'enemyWithout') continue;
      if (!Array.isArray(s[k])) { fail(c, `situation.${k} must be an array`); continue; }
      for (const a of s[k]) if (!AGENTS.includes(a)) fail(c, `${k} names unknown agent "${a}"`);
      if (new Set(s[k]).size !== s[k].length) fail(c, `${k} lists an agent twice`);
    }
    if (Array.isArray(s.enemyWithout) && !s.enemyWithout.length) fail(c, 'enemyWithout is an empty array');
    for (const k of ['cause', 'patterns']) {
      if (c[k] === undefined) continue;
      if (!Array.isArray(c[k]) || !c[k].length) { fail(c, `${k} must be a non empty array`); continue; }
      for (const v of c[k]) if (!VALID[k].has(v)) fail(c, `${k} "${v}" is not one cases.js matches, so the tag is dead`);
    }

    // The rank bands.
    if (!Array.isArray(c.ranks) || !c.ranks.length) fail(c, 'ranks must list at least one band');
    else {
      for (const r of c.ranks) if (!BANDS.includes(r)) fail(c, `rank band "${r}" is not one of ${BANDS.join(', ')}`);
      if (new Set(c.ranks).size !== c.ranks.length) fail(c, 'lists a rank band twice');
      const low = BANDS[Math.min(...c.ranks.map((r) => BANDS.indexOf(r)).filter((i) => i >= 0))];
      if (c.minBand !== low) fail(c, `minBand ${c.minBand} is not the lowest of its ranks (${low})`);
      const advanced = BANDS.indexOf(low) >= 2;
      if ((c.tier === 'advanced') !== advanced) fail(c, `tier ${c.tier} disagrees with minBand ${low} (advanced from Platinum up)`);
    }
    if (typeof c.patchSensitive !== 'boolean') fail(c, 'patchSensitive must be true or false');
    if (c.weight !== undefined && (!Number.isInteger(c.weight) || c.weight < 1 || c.weight > 3)) fail(c, `weight ${c.weight} is outside 1 to 3`);

    // Reachable: an anchor cases.js serves on.
    const anchored = (Array.isArray(c.cause) && c.cause.length) || (Array.isArray(c.patterns) && c.patterns.length)
      || s.agent || (Array.isArray(s.enemyAgents) && s.enemyAgents.length) || (Array.isArray(s.enemyWithout) && s.enemyWithout.length)
      || SEEN_PHASES.has(s.phase) || SEEN_ECONOMIES.has(s.economy);
    if (!anchored) fail(c, 'carries no anchor cases.js serves on (a cause, a pattern, an agent, an enemy agent, a phase or an economy a review shows), so it is unreachable');
    // Held back by design (cases.js situational): a case for any agent whose
    // tags give one kind of anchor a review shows, most often the clock alone,
    // is never served, since every review has deaths early and mid round.
    // Listed, never failed, and held to HELD_BACK_MAX so the list cannot grow
    // unseen.
    else if (heldBack(c)) HELD.push(c.id);
    // And reachable in fact: cases.js serves it in the situation its own tags
    // describe, at its own band, which also holds it to MIN_SCORE.
    else if (Array.isArray(c.ranks) && !casesMod.scored(situationFor(c), [c]).length) {
      fail(c, `is never served even in the situation its own tags describe (under cases.js MIN_SCORE ${casesMod.MIN_SCORE}), so it is unreachable`);
    }

    // Abilities belong to an agent the case is about; callouts to its map.
    const all = TEXT_KEYS.map((k) => c[k] || '').join(' ');
    const allowed = new Set([s.agent, ...(s.enemyAgents || []), ...(s.enemyWithout || [])].filter(Boolean).map((a) => a.toLowerCase()));
    for (const a of AGENTS) if (wordIn(a, all)) allowed.add(a.toLowerCase());
    for (const [ability, owners] of ABILITY_OWNERS) {
      if (!exactIn(ability, all)) continue;
      if ([...owners].some((o) => allowed.has(o))) continue;
      fail(c, `names "${ability}", which belongs to ${[...owners].join('/')}, an agent the case is not about`);
    }
    if (s.map) {
      const geo = (data.mapGeometry || {})[s.map.toLowerCase()];
      const own = new Set(((geo && geo.callouts) || []).map((x) => String(x.n).toLowerCase()));
      for (const g of Object.values(data.mapGeometry || {})) {
        for (const x of (g && g.callouts) || []) {
          const n = String(x.n || '');
          if (n.split(' ').length < 2 || own.has(n.toLowerCase())) continue;
          if (wordIn(n, all)) fail(c, `names callout "${n}", which is not on ${s.map}`);
        }
      }
    }

    // The source: what it is about, never who.
    const src = c.source;
    if (!src || typeof src !== 'object' || typeof src.topic !== 'string' || !src.topic.trim() || typeof src.kind !== 'string') {
      fail(c, 'source must hold a kind and a topic');
    } else {
      for (const k of Object.keys(src)) if (!SOURCE_KEYS.has(k)) fail(c, `source carries "${k}", and a source holds only kind, topic, numbers and claims`);
    }
    if (Object.prototype.hasOwnProperty.call(c, 'coach')) fail(c, 'carries a coach key, and the app never says where a case came from');
    const claimed = noteClaims({ source: src || {} });
    for (const p of claimed.problems) fail(c, p);
    if (src && src.numbers) {
      const legal = new Set(claimed.values.map(Number));
      for (const n of (all.match(/\d+(?:\.\d+)?/g) || []).map(Number)) {
        if (!legal.has(n)) fail(c, `states ${n}, which no claim it declares in source.claims covers`);
      }
    }
  }
  return problems;
}

if (require.main === module) {
  let list;
  try {
    list = JSON.parse(fs.readFileSync(FILE, 'utf8'));
  } catch (e) {
    console.log(`FAIL: server/data/cases.json will not parse: ${e.message}`);
    process.exit(1);
  }
  if (process.env.CHECK_CASES_PLANT) list = list.concat(JSON.parse(fs.readFileSync(process.env.CHECK_CASES_PLANT, 'utf8')));
  const problems = check(list);
  // The loader takes every case of the file, so none is silently dropped.
  if (!process.env.CHECK_CASES_PLANT && casesMod.size() !== list.length) problems.push({ id: '-', msg: `cases.js loads ${casesMod.size()} of the file's ${list.length} cases` });
  if (HELD.length > HELD_BACK_MAX) problems.push({ id: '-', msg: `${HELD.length} cases are held back for want of a second anchor, more than HELD_BACK_MAX ${HELD_BACK_MAX}: tag what they answer (a cause, a pattern, an enemy agent, an economy) or raise the limit knowingly` });
  console.log(`checked ${list.length} worked cases, ${HELD.length} held back for want of a second anchor (${HELD.join(', ')})`);
  if (!problems.length) {
    console.log('PASS: shape, tags, bands, anchors, abilities, callouts, claims, no dashes, no semicolons and no names');
    process.exit(0);
  }
  console.log(`\nFAIL: ${problems.length} problem(s)`);
  for (const p of problems) console.log(`  - ${p.id}: ${p.msg}`);
  process.exit(1);
}

module.exports = { check, VALID, heldBack, HELD, HELD_BACK_MAX };
