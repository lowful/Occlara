'use strict';

/**
 * Police the Rivals knowledge the way check-playbook.js polices the Valorant one.
 *
 * WHY THIS EXISTS. The Valorant side has had a checker for a long time: 357
 * playbook notes, and no note may name an agent, map, ability or callout that
 * does not exist. The Rivals side had nothing, so a typo'd hero name or an
 * ability that was renamed in a patch would ship silently and surface only as a
 * slightly odd sentence, which is unfalsifiable.
 *
 * The case that motivated it is concrete. Dexerto and TheGamer both name The
 * Thing's anti-dive ability "Earthbound". That string appears on NONE of the 54
 * official hero pages; the ability is "Yancy Street Charge". Two reputable
 * outlets carrying the same wrong name is exactly how a wrong name gets into a
 * product, and the counter table quotes ability names directly at players.
 *
 * What it asserts:
 *   every hero named anywhere resolves against the roster
 *   no rule reasons about a hero that is still unclassified
 *   every ability named in the counter table exists in the generated data
 *   every quoted effect still appears in that ability's own text
 *   the roster count still matches the META snapshot
 *   no em or en dashes
 *
 * Offline. It reads files and nothing else, so it runs in npm test.
 */

const path = require('path');

const heroes = require(path.join(__dirname, '..', 'server', 'services', 'rivals-heroes.js'));
const knowledge = require(path.join(__dirname, '..', 'server', 'services', 'rivals-knowledge.js'));
const counters = require(path.join(__dirname, '..', 'server', 'services', 'rivals-counters.js'));

let generated = null;
try {
  generated = require(path.join(__dirname, '..', 'server', 'rivals-data.generated.json'));
} catch { /* checked below */ }

const problems = [];
const note = (what) => problems.push(what);

const norm = (s) => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();

// ── The roster is the vocabulary ────────────────────────────────────────────
// Multi role heroes (Deadpool) are classified per role, so they count here.
const CLASSIFIED = new Set([...Object.keys(heroes.HEROES), ...Object.keys(heroes.ROLE_FORMS || {})]);
const PENDING = new Set(heroes.PENDING.map(norm));
const ON_ROSTER = new Set([...CLASSIFIED, ...PENDING]);

let checked = 0;

/*
 * The counter table is the highest risk surface here, because it is the only
 * place the coach quotes a specific ability BY NAME to a player. A wrong name
 * there is not a degraded tip, it is a confidently false statement about the
 * game.
 */
for (const rule of counters.MOBILITY_LOCKOUT || []) {
  checked++;
  const hero = norm(rule.hero);

  if (!ON_ROSTER.has(hero)) {
    note(`counter table names "${rule.hero}", who is not on the roster at all`);
    continue;
  }
  if (!CLASSIFIED.has(hero)) {
    // A rule about an unclassified hero can never fire, because traits()
    // returns null and every rule treats that as silence. Dead knowledge that
    // looks live is worse than an obvious gap.
    note(`counter table reasons about "${rule.hero}", who is still in PENDING, `
      + `so the rule can never fire`);
    continue;
  }

  if (!generated) continue;               // reported once, below
  const rec = (generated.heroes || []).find((h) => norm(h.name) === hero);
  if (!rec) {
    note(`counter table names "${rule.hero}", who is missing from the generated data`);
    continue;
  }
  const ability = (rec.abilities || []).find((a) => norm(a.name) === norm(rule.ability));
  if (!ability) {
    note(`"${rule.hero}" has no ability called "${rule.ability}" in the generated data. `
      + `Known: ${(rec.abilities || []).map((a) => a.name).slice(0, 6).join(', ')}`);
    continue;
  }
  if (rule.quote && !norm(ability.text).includes(norm(rule.quote))) {
    note(`"${rule.ability}" no longer says "${rule.quote}". It now reads: `
      + `"${String(ability.text).slice(0, 120)}"`);
  }
}

if (!generated) {
  note('server/rivals-data.generated.json is missing. Run npm run sync:rivals.');
}

// ── Every hero the META block names must exist ──────────────────────────────
for (const name of knowledge.META.strong || []) {
  checked++;
  if (!ON_ROSTER.has(norm(name))) {
    note(`META.strong names "${name}", who is not on the roster`);
  }
}

// ── The roster count is an invariant, not a comment ─────────────────────────
const total = CLASSIFIED.size + heroes.PENDING.length;
checked++;
if (total !== knowledge.META.heroCount) {
  note(`roster is ${CLASSIFIED.size} classified + ${heroes.PENDING.length} pending = ${total}, `
    + `but META.heroCount says ${knowledge.META.heroCount}`);
}

// ── The generated data should cover the roster ──────────────────────────────
if (generated) {
  checked++;
  const known = new Set((generated.heroes || []).map((h) => norm(h.name)));
  const missing = [...ON_ROSTER].filter((n) => !known.has(n));
  if (missing.length) {
    note(`${missing.length} roster hero(es) missing from the generated data: ${missing.join(', ')}`);
  }
  const extra = [...known].filter((n) => !ON_ROSTER.has(n));
  if (extra.length) {
    // The sync found heroes the table has never heard of, which is what a new
    // season looks like. Not fatal, and worth saying out loud.
    console.log(`  note: the sync knows ${extra.length} hero(es) the table does not: ${extra.join(', ')}`);
  }
}

// ── The balance post, if one has been synced ────────────────────────────────
/*
 * The balance data names heroes, and a hero the roster does not know is the
 * same defect here as anywhere else: it means the parser picked up a heading,
 * a caption or a section title and recorded it as a hero. That produces a
 * confident sentence about a character who does not exist, which is the exact
 * failure this whole file exists to prevent.
 *
 * It is optional. The file is generated and someone checking out the repo
 * before running the sync should not see a failure for it.
 */
let balance = null;
try {
  balance = require(path.join(__dirname, '..', 'server', 'rivals-balance.generated.json'));
} catch { /* not synced yet, which is fine */ }

if (balance) {
  const seen = new Set();
  for (const h of balance.heroes || []) {
    checked++;
    if (!ON_ROSTER.has(norm(h.hero))) {
      note(`the balance post names "${h.printedAs || h.hero}", who is not on the roster`);
      continue;
    }
    // A hero section with no changes means the parser found a name and then
    // lost the bullets under it, which would render as "your hero changed"
    // above an empty list.
    if (!Array.isArray(h.changes) || !h.changes.length) {
      note(`"${h.printedAs || h.hero}" has a balance section with no changes in it`);
    }
    if (!h.summary) {
      note(`"${h.printedAs || h.hero}" has no summary line, so the review has nothing to quote`);
    }
    const key = `${norm(h.hero)}/${h.role}`;
    if (seen.has(key)) note(`"${h.printedAs || h.hero}" appears twice for the same role`);
    seen.add(key);
  }

  checked++;
  if (!/^\d{8}$/.test(String(balance.version || ''))) {
    note(`the balance post version is "${balance.version}", expected 8 digits`);
  }
  checked++;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(balance.published || ''))) {
    note(`the balance post publish date is "${balance.published}", expected YYYY-MM-DD`);
  }

  // The client copy is what the review actually reads, so a section lost
  // between the two files is a section the player never sees.
  let client = null;
  try {
    client = require(path.join(__dirname, '..', 'src', 'shared', 'rivals-balance.generated.json'));
  } catch { /* reported below */ }
  checked++;
  if (!client) {
    note('src/shared/rivals-balance.generated.json is missing. Run npm run sync:rivalsbalance.');
  } else {
    const sections = Object.values(client.heroes || {}).reduce((n, a) => n + (a || []).length, 0);
    if (sections !== (balance.heroes || []).length) {
      note(`the client balance copy has ${sections} hero section(s) and the server copy has `
        + `${(balance.heroes || []).length}. Deadpool is tri-role, so a one-to-one map loses two.`);
    }
    if (client.version !== balance.version) {
      note(`the two balance copies disagree on version: ${balance.version} and ${client.version}`);
    }
  }
}

// ── House style ─────────────────────────────────────────────────────────────
const DASHES = /[—–]/;
for (const [label, text] of [
  ['fundamentals()', knowledge.fundamentals()],
  ['block()', knowledge.block()],
  ['META.note', knowledge.META.note],
  ...(counters.MOBILITY_LOCKOUT || []).map((l) => [`counter "${l.ability}"`, `${l.does} ${l.why || ''}`]),
]) {
  checked++;
  if (DASHES.test(String(text || ''))) note(`${label} contains an em or en dash`);
}

console.log(`checked ${checked} Rivals knowledge item(s)`);
if (problems.length) {
  console.log('');
  for (const p of problems) console.log('  ' + p);
  console.log(`\nFAIL: ${problems.length} problem(s) in the Rivals knowledge`);
  process.exit(1);
}
console.log('PASS: every hero and ability named is one the game actually has');
