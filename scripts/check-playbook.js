'use strict';

/**
 * Fact-check the Pro Playbook against the generated Valorant data.
 *
 * The playbook is the one place in this codebase where prose gets fed to the
 * coach as if it were true. A wrong ability or a callout from another map does
 * not crash anything, it just teaches the player something false in a confident
 * voice, which is the worst failure this app has. So every claim that CAN be
 * checked mechanically is checked here.
 *
 * Checked:
 *   - every agent named in an `agents` tag exists
 *   - every map named in a `maps` tag exists
 *   - an agent-tagged note may only name abilities its own agents actually have
 *   - a map-tagged note may only name callouts that exist on those maps
 *   - no em or en dashes, and no curly quotes (they break the tip sanitiser)
 *   - every tag VALUE is one retrieve() can actually match (see below)
 *   - weight is 1 to 3
 *   - no duplicate note text
 *   - every note merged from server/data/playbook.json carries a source
 *
 * Run: npm run check:playbook
 */

const fs = require('fs');
const path = require('path');

/*
 * THE SERVER COPY, not the client one.
 *
 * knowledge.js is a server module and its notes are injected into the server
 * prompt, so the server's generated data is what they must agree with. This
 * read the client copy at src/shared/, which is byte identical today and would
 * have validated the wrong file the moment the two diverged. A checker that
 * silently grades against the wrong ground truth is worse than no checker.
 */
const data = require(path.join(__dirname, '..', 'server', 'valorant-data.generated.json'));
const knowledge = require(path.join(__dirname, '..', 'server', 'services', 'knowledge.js'));

const AGENTS = data.agents || {};
const MAPS = (data.maps || []).map((m) => m.toLowerCase());
const CALLOUT_INDEX = data.mapCallouts || {};   // callout(lower) -> [map(lower)]

// Every ability in the game, mapped to the agents that own it. Used to catch a
// note that tells a Jett to use a Sova drone.
const ABILITY_OWNERS = new Map();
for (const [agent, info] of Object.entries(AGENTS)) {
  for (const ability of (info.abilities || [])) {
    const key = String(ability).toLowerCase();
    if (!ABILITY_OWNERS.has(key)) ABILITY_OWNERS.set(key, new Set());
    ABILITY_OWNERS.get(key).add(agent.toLowerCase());
  }
}

// Callouts worth checking: multi word ones, and single words distinctive enough
// that a false one would actually mislead. Bare "mid" or "site" are skipped
// because they are generic English here, not claims about a specific map.
const GENERIC = new Set(['mid', 'site', 'a', 'b', 'c', 'main', 'spawn', 'heaven', 'window', 'link', 'lobby', 'default']);

/*
 * ── THE TAG VOCABULARY, AND WHY A TYPO HERE IS INVISIBLE ────────────────────
 *
 * retrieve() excludes rather than warns:
 *
 *     if (note.phase && note.phase !== s.phase) continue;
 *
 * so `phase: 'postpant'` never equals any real phase and the note is DEAD. It
 * loads, it counts toward the total, check:playbook passed it, and it can never
 * reach a player. Nothing errors and nothing logs.
 *
 * Across 357 hand written notes that was survivable. It stops being survivable
 * the moment knowledge is imported in bulk from playbook.json, where a single
 * bad tag in a template silently kills every note that copied it.
 */
const VALID = {
  // 'core' is the default and need not be written. A note with no tier is core,
  // which is what keeps the 357 hand written ones working untouched.
  tier: new Set(['core', 'advanced']),
  side: new Set(['attack', 'defense']),
  phase: new Set(['buy', 'active', 'postplant', 'dead']),
  roles: new Set(['duelist', 'controller', 'initiator', 'sentinel']),
  // Eleven flags. 'clutch' is real and produced by situationOf, but is missing
  // from the schema docblock in knowledge.js, which is exactly how a valid tag
  // comes to look like a typo.
  situations: new Set(['pistol', 'eco', 'forcebuy', 'fullbuy', 'antieco', 'lostpistol',
    'deathstreak', 'winstreak', 'retake', 'early', 'clutch']),
};

const problems = [];
function fail(note, msg) {
  problems.push({ msg, text: String(note.text || '').slice(0, 100) });
}

/*
 * THE VOCABULARY ABOVE IS HAND WRITTEN, SO IT CAN DRIFT FROM THE CODE IT
 * DESCRIBES. This reads the flags situationOf actually adds and fails if the
 * two disagree, so adding a flag forces this list to be updated rather than
 * quietly leaving the new flag unvalidated.
 */
(function checkVocabularyIsCurrent() {
  const src = fs.readFileSync(path.join(__dirname, '..', 'server', 'services', 'knowledge.js'), 'utf8');
  const found = new Set();
  const re = /flags\.add\('([a-z]+)'\)/g;
  let m;
  while ((m = re.exec(src)) !== null) found.add(m[1]);
  if (!found.size) {
    problems.push({ msg: 'could not read any flags.add() out of knowledge.js, so the '
      + 'situations vocabulary below is unverified', text: '' });
    return;
  }
  for (const f of found) {
    if (!VALID.situations.has(f)) {
      problems.push({ msg: `situationOf produces the flag "${f}" but VALID.situations in this `
        + 'checker does not list it, so notes tagged with it are never validated', text: '' });
    }
  }
  for (const f of VALID.situations) {
    if (!found.has(f)) {
      problems.push({ msg: `this checker allows the situation "${f}" but situationOf never `
        + 'produces it, so any note tagged with it is unreachable', text: '' });
    }
  }
}());

const notes = knowledge.all ? knowledge.all() : null;
if (!notes) {
  console.error('knowledge.js does not expose all(); add it so the playbook can be checked.');
  process.exit(2);
}

/*
 * The merged file is read directly rather than through knowledge.all(), which
 * concatenates the two corpora and cannot say which note came from where. The
 * source requirement applies only to imported knowledge: the hand written 357
 * predate it and are attributed in the module docblock instead.
 */
let imported = [];
const IMPORT_PATH = path.join(__dirname, '..', 'server', 'data', 'playbook.json');
try {
  if (fs.existsSync(IMPORT_PATH)) {
    const parsed = JSON.parse(fs.readFileSync(IMPORT_PATH, 'utf8'));
    if (Array.isArray(parsed)) imported = parsed;
    else problems.push({ msg: 'server/data/playbook.json is not an array', text: '' });
  }
} catch (e) {
  problems.push({ msg: 'server/data/playbook.json will not parse: ' + e.message, text: '' });
}

/*
 * ATTRIBUTION IS CHECKED ON THE IMPORTED ARRAY DIRECTLY, and getting here took
 * two wrong turns worth recording.
 *
 * First attempt matched by TEXT against the merged corpus. A planted duplicate
 * of an existing hand written note then flagged THE ORIGINAL as unattributed,
 * because the original's text was in the set and the original has no source.
 * Right number of problems, wrong reason, wrong note.
 *
 * Second attempt matched by object IDENTITY. That silently checked nothing at
 * all: knowledge.js runs its own JSON.parse of the same file, so its objects
 * are different objects, every reference test failed, and the unattributed note
 * in the control simply stopped being reported. A check that quietly stops
 * checking is the worst of the three.
 *
 * So the imported array is validated on its own terms. Those notes still get
 * every other check through the merged corpus below; only attribution is scoped
 * to them, because the hand written 357 predate the requirement and are
 * attributed in the knowledge.js docblock instead.
 */
for (const note of imported) {
  if (!note || typeof note !== 'object') {
    problems.push({ msg: 'playbook.json contains an entry that is not an object', text: '' });
    continue;
  }
  const src = note.source;
  if (!src || typeof src !== 'object' || !src.coach) {
    fail(note, 'imported from playbook.json with no source.coach, so the claim is unattributable');
  }
}

for (const note of notes) {
  const text = String(note.text || '');

  if (/[–—]/.test(text)) fail(note, 'contains an em or en dash');
  if (/[‘’“”]/.test(text)) fail(note, 'contains a curly quote');
  if (!text.trim()) fail(note, 'empty text');

  for (const a of (note.agents || [])) {
    if (!Object.keys(AGENTS).some((k) => k.toLowerCase() === String(a).toLowerCase())) {
      fail(note, `unknown agent "${a}"`);
    }
  }
  for (const m of (note.maps || [])) {
    if (!MAPS.includes(String(m).toLowerCase())) fail(note, `unknown map "${m}"`);
  }

  // ── Tag values retrieve() can actually match ──────────────────────────────
  if (note.side !== undefined && !VALID.side.has(note.side)) {
    fail(note, `side "${note.side}" is not attack or defense, so this note can never be retrieved`);
  }
  if (note.phase !== undefined && !VALID.phase.has(note.phase)) {
    fail(note, `phase "${note.phase}" is not one retrieve() matches, so this note is unreachable`);
  }
  // A misspelled tier is not unreachable, it is worse: the note still serves,
  // but silently as core, so advanced mode quietly returns fundamentals and
  // looks like it is not working.
  if (note.tier !== undefined && !VALID.tier.has(note.tier)) {
    fail(note, `tier "${note.tier}" is not core or advanced, so this note silently counts as core`);
  }
  for (const s of (note.situations || [])) {
    if (!VALID.situations.has(s)) {
      fail(note, `situation "${s}" is never produced by situationOf, so this note is unreachable`);
    }
  }
  for (const r of (note.roles || [])) {
    if (!VALID.roles.has(r)) {
      fail(note, `role "${r}" is not a Valorant role, so this note is unreachable`);
    }
  }
  for (const key of ['agents', 'maps', 'situations', 'roles', 'weapons']) {
    if (note[key] !== undefined && !Array.isArray(note[key])) {
      fail(note, `${key} must be an array, got ${typeof note[key]}`);
    } else if (Array.isArray(note[key]) && !note[key].length) {
      // An empty array is not "no tag": retrieve() treats it as a tag that
      // matches nothing, so the note is silently dead.
      fail(note, `${key} is an empty array, which excludes the note from every situation`);
    }
  }

  if (note.weight !== undefined) {
    if (typeof note.weight !== 'number' || !Number.isInteger(note.weight)
        || note.weight < 1 || note.weight > 3) {
      fail(note, `weight ${JSON.stringify(note.weight)} is outside 1 to 3`);
    }
  }

  // An agent-tagged note must not tell that agent to use somebody else's kit.
  if (note.agents && note.agents.length) {
    const owned = new Set();
    for (const a of note.agents) {
      const info = AGENTS[Object.keys(AGENTS).find((k) => k.toLowerCase() === String(a).toLowerCase())];
      for (const ab of ((info && info.abilities) || [])) owned.add(String(ab).toLowerCase());
    }
    for (const [ability, owners] of ABILITY_OWNERS) {
      if (ability.length < 4) continue;
      // Whole words only. A plain substring test flagged "cover" as Harbor's
      // Cove three times over, which is the kind of false alarm that gets a
      // checker switched off.
      if (!new RegExp(`\\b${ability.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(text)) continue;
      if (owned.has(ability)) continue;
      const tagged = note.agents.map((a) => String(a).toLowerCase());
      if (tagged.some((t) => owners.has(t))) continue;
      fail(note, `names "${ability}" which belongs to ${[...owners].join('/')}, not ${note.agents.join('/')}`);
    }
  }

  // A map-tagged note must not name a callout from a different map.
  if (note.maps && note.maps.length) {
    const allowed = new Set();
    for (const m of note.maps) for (const c of calloutsForMap(String(m).toLowerCase())) allowed.add(c);
    for (const [callout, maps] of Object.entries(CALLOUT_INDEX)) {
      if (GENERIC.has(callout) || callout.length < 4) continue;
      if (!new RegExp(`\\b${callout.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(text)) continue;
      if (allowed.has(callout)) continue;
      const noteMaps = note.maps.map((m) => String(m).toLowerCase());
      if (maps.map((m) => String(m).toLowerCase()).some((m) => noteMaps.includes(m))) continue;
      fail(note, `names callout "${callout}" which is on ${maps.join('/')}, not ${note.maps.join('/')}`);
    }
  }
}

function calloutsForMap(mapLower) {
  const geo = (data.mapGeometry || {})[mapLower];
  const list = (geo && Array.isArray(geo.callouts)) ? geo.callouts : [];
  return new Set(list.map((c) => String(c.n || '').toLowerCase()).filter(Boolean));
}

/*
 * ── Numbers in weapon notes must match the real damage table ─────────────
 *
 * A weapon-tagged note that quotes damage or a falloff range is the most
 * checkable claim in the whole playbook and was, until now, the least checked.
 * Riot rebalances weapons, and a note saying a Bucky does 17 a pellet becomes
 * confidently wrong the patch that changes it, in a voice the player trusts.
 *
 * Every number in such a note must appear somewhere in that weapon's own table,
 * either as a body damage value or as a range bound. This cannot tell a correct
 * sentence from a wrong one built out of right numbers, but it does catch the
 * failure that actually happens: the table moves and the prose does not.
 *
 * Numbers must be DIGITS for this to work. That is also the house style, "force
 * fights inside 15 meters", and it is why the imported notes were rewritten
 * from spelled out numbers before this check went in.
 *
 * ONLY NOTES THAT CLAIM TO QUOTE THE TABLE ARE CHECKED, via source.numbers.
 * The first version checked every weapon-tagged note and immediately flagged
 * two hand written ones: "use it inside 5 meters only" and "the Frenzy melts
 * inside 10 meters". Both are correct tactical advice and neither is a claim
 * about the damage table, so 5 and 10 have no business being in it. A checker
 * that fails good notes gets switched off, so the note declares what it is
 * doing and only then gets held to it.
 *
 * THIS CHECK WAS DEAD ON ARRIVAL AND SAID NOTHING FOR IT. Written through a
 * shell heredoc, the word boundaries in its number regex collapsed into literal
 * backspace bytes, so the pattern required a 0x08 around every number, matched
 * nothing, and every note fell through the guard below. It printed PASS while
 * checking zero notes. Two planted controls both passed before the bytes were
 * inspected. See the heredoc warning in CLAUDE.md, and od -c the line rather
 * than trusting grep, which renders the corruption as a normal escape.
 */
const WEAPONS = data.weapons || {};
if (!Object.keys(WEAPONS).length) {
  problems.push({ msg: 'the generated data has no weapons block, so no weapon note can be '
    + 'verified. Run npm run sync:valorant.', text: '' });
}
for (const note of notes) {
  if (!Array.isArray(note.weapons) || !note.weapons.length) continue;
  // Only a note that says it is quoting the table is held to the table.
  if (!note.source || !note.source.numbers) continue;
  const text = String(note.text || '');
  const nums = (text.match(/\b\d+\b/g) || []).map(Number);
  if (!nums.length) continue;

  // The union of every legal number across the weapons this note is tagged
  // with. A note tagged for three shotguns may quote any of their figures.
  const legal = new Set();
  let known = false;
  for (const w of note.weapons) {
    const rec = WEAPONS[String(w).toLowerCase()];
    if (!rec) continue;
    known = true;
    for (const r of rec.ranges || []) { legal.add(r.from); legal.add(r.to); legal.add(r.body); }
    if (rec.cost) legal.add(rec.cost);
  }
  if (!known) continue;                 // tag is a substring matcher, not a name

  for (const n of nums) {
    if (!legal.has(n)) {
      fail(note, `quotes the number ${n}, which is not a damage value, a range bound or a `
        + `cost for ${note.weapons.join('/')} in the generated table`);
    }
  }
}

// ── Duplicates ──────────────────────────────────────────────────────────────
// retrieve() serves eight notes. Two copies of the same sentence take two of
// those eight slots and double that advice's odds of being the one the coach
// grounds on, which is how a corpus develops a favourite without anyone
// choosing one.
const seen = new Map();
const norm = (t) => String(t || '').toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim();
for (const note of notes) {
  const key = norm(note.text);
  if (!key) continue;
  if (seen.has(key)) {
    problems.push({ msg: 'duplicate note text, already present earlier in the corpus',
      text: String(note.text).slice(0, 100) });
  } else {
    seen.set(key, true);
  }
}

/*
 * ── Contradictions: TRIED, MEASURED, AND REMOVED ────────────────────────────
 *
 * The plan called for an advisory flagging notes that give opposing advice,
 * since retrieve() serves eight notes partly at random and two opposed ones can
 * reach the model in consecutive rounds. It was built with a small table of
 * opposing regex pairs and it did not survive its first real run.
 *
 * Both advisories it produced were false:
 *
 *   "send it" was meant to catch reckless aggression. It matched "send it for
 *   the plant", "send it before an entry" and "send it into the space you are
 *   about to take", which are Wingman, Boom Bot and Owl Drone, none of them
 *   about aggression at all.
 *
 *   "hold the angle" against "never stand still" matched a fake defuse note and
 *   a scoping note that refine each other rather than conflict.
 *
 * Nothing real was found, twice. An advisory that cries wolf on its first run
 * teaches everyone to skip that line of output, which costs more than the check
 * was ever going to earn.
 *
 * WHAT WOULD ACTUALLY WORK, if this is attempted again: two notes only conflict
 * if they can be RETRIEVED TOGETHER, so overlapping tag sets are the mechanical
 * half and are cheap to compute. The hard half is deciding that two English
 * sentences oppose each other, and a regex table is not that. Do not ship a
 * version that guesses.
 */

console.log(`checked ${notes.length} playbook notes`
  + (imported.length ? ` (${imported.length} imported from server/data/playbook.json)` : ''));

if (!problems.length) {
  console.log('PASS: tags, weights, attribution, and every agent, map, ability and callout check out');
  process.exit(0);
}
console.log(`\nFAIL: ${problems.length} problem(s)`);
for (const p of problems) console.log(`  - ${p.msg}` + (p.text ? `\n      "${p.text}"` : ''));
process.exit(1);
