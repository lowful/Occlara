'use strict';
/**
 * npm run test:drilllibrary
 *
 * THE DRILL LIBRARY (src/shared/drill-library.json, 10 Nov 2026): the solo
 * drills the Practice page offers for the mistakes a review names. This holds
 * the file to its schema and to the game, and holds the coaching notes of the
 * same research (server/data/playbook.json, source kind 'guide') to the
 * places retrieval must serve them.
 *
 * 1. The shape: version 1, unique ids, a cause the app can name or 'general',
 *    a real place to practise, 5 to 20 minutes, the four bands, 3 to 6 steps,
 *    one goal with a number, one why, one check that names something Occlara
 *    measures. An optional demo (8.11) is the site's <id>.webm and <id>.webp
 *    under occlara.app/drills/, 6 to 12 seconds, kept as is by practice.js.
 * 2. Coverage: every cause the app can name, read from death-causes.js and
 *    from the Valorant mistakes and missed entries insights.js writes, has 3
 *    drills or more, and 'general' has 8 or more. A new cause added there
 *    fails here until it has its drills.
 * 3. The words: no em or en dash, no semicolon, nothing about the economy, no
 *    name (a capitalised word inside a sentence must be a word of the game or
 *    of its menus), and every sentence passes the game claim checks the
 *    playbook passes (a Range or Deathmatch drill never asks for a team, no
 *    moving shot told as the play).
 * 4. SERVED: the research notes reach the situations they were written for,
 *    in the review's retrieve() and study() and in Ask Coach, and none of
 *    them trips a gate of the coach's replies.
 */
const path = require('path');

let passed = 0;
let failed = 0;
const ok = (cond, what, detail) => {
  if (cond) { passed++; return; }
  failed++;
  console.log(`FAIL: ${what}${detail ? `\n      ${detail}` : ''}`);
};

const ROOT = path.join(__dirname, '..');
const lib = require(path.join(ROOT, 'src', 'shared', 'drill-library.json'));
const { CAUSES } = require(path.join(ROOT, 'src', 'shared', 'death-causes.js'));
const data = require(path.join(ROOT, 'src', 'shared', 'valorant-data.generated.json'));
const G = require(path.join(ROOT, 'server', 'services', 'game-claims.js'));

const DASHES = new RegExp('[' + String.fromCharCode(0x2013, 0x2014) + ']');
const WHERE = new Set(['range', 'deathmatch', 'custom', 'unrated']);
const BANDS = ['iron_bronze', 'silver_gold', 'plat_diamond', 'asc_plus'];
const FORBIDDEN = /\b(?:economy|economic|buy\w*|bought|save rounds?|saving|credits?|creds|loss bonus)\b/i;
// What Occlara counts in a review: a check must name one of them.
const MEASURED = /\b(?:traded|trades?|first 30 seconds|first to die|ultimate ready|headshot rate|repeeks?|dry peeks?|caught alone|crossfires?|caught rotating|overextended|exposed on the spike|no escape|lost duels?|same place|kept winning|gave back the advantage|one against one|post plants? won|retakes? won|ability used|lost rounds|repeated mistake|last one standing)\b/i;

// ── 1. The shape ────────────────────────────────────────────────────────────
console.log('the shape:');
ok(lib && lib.version === 1 && Array.isArray(lib.drills), 'version 1 with a drills array');
ok(Object.keys(lib).every((k) => ['version', 'note', 'drills'].includes(k)), 'no top level key but version, note and drills', Object.keys(lib).join());
const drills = Array.isArray(lib.drills) ? lib.drills : [];
ok(drills.length >= 40, `at least 40 drills (${drills.length})`);
const ids = new Set();
const KEYS = ['id', 'title', 'cause', 'where', 'minutes', 'bands', 'steps', 'goal', 'why', 'check'];
// Optional: `also`, the further causes a drill serves (Nov 2026, low-headshots on the aim drills),
// and `demo` (8.11), the owner's short video of the drill on the website.
const OPTIONAL = ['also', 'demo'];
// A DEMO (8.11) is what scripts/make-drill-demo.js writes and the site hosts:
// <id>.webm and <id>.webp under occlara.app/drills/, 6 to 12 seconds, and
// practice.js keeps it as it is (a demo it would drop is a typo here).
const practiceLib = require(path.join(ROOT, 'src', 'shared', 'practice.js'));
const demoProblem = (d) => {
  const m = d.demo;
  if (!m || typeof m !== 'object' || Array.isArray(m)) return 'not an object';
  const extra = Object.keys(m).filter((k) => !['src', 'poster', 'secs'].includes(k));
  if (extra.length) return `unknown keys ${extra.join()}`;
  if (m.src !== `${practiceLib.DEMO_BASE}${d.id}.webm`) return `src is not ${practiceLib.DEMO_BASE}${d.id}.webm`;
  if (m.poster !== `${practiceLib.DEMO_BASE}${d.id}.webp`) return `poster is not ${practiceLib.DEMO_BASE}${d.id}.webp`;
  if (!Number.isInteger(m.secs) || m.secs < 6 || m.secs > 12) return 'secs is not 6 to 12';
  const kept = practiceLib.demoOf(m);
  if (!kept || kept.src !== m.src || kept.poster !== m.poster || kept.secs !== m.secs) return 'practice.js would not keep it';
  return null;
};
{
  const good = { id: 'lost-duel-first-bullet', demo: { src: 'https://occlara.app/drills/lost-duel-first-bullet.webm', poster: 'https://occlara.app/drills/lost-duel-first-bullet.webp', secs: 8 } };
  ok(demoProblem(good) === null, 'a demo as the script writes it passes');
  ok(demoProblem({ ...good, demo: { ...good.demo, src: 'https://occlara.app/drills/other.webm' } }) && demoProblem({ ...good, demo: { ...good.demo, secs: 30 } })
    && demoProblem({ ...good, demo: { ...good.demo, poster: 'http://occlara.app/drills/lost-duel-first-bullet.webp' } }) && demoProblem({ ...good, demo: { ...good.demo, extra: 1 } }),
  'and one named for another drill, too long, over http or with another key fails');
}
// A FULL UNRATED MATCH (Nov 2026): a drill for a moment too rare for 8 rounds
// (the last one alive) is played over a whole match, and says so in a step.
const FULL_MATCH = /\bfull unrated match\b/;
ok(FULL_MATCH.test('Play a full unrated match, since the last one alive is too rare for 8 rounds.') && !FULL_MATCH.test('Play the first 8 rounds of an unrated match.'), 'the full match words both ways');
for (const d of drills) {
  const at = `drill ${d && d.id}`;
  const extra = Object.keys(d || {}).filter((k) => !KEYS.includes(k));
  ok(d && KEYS.every((k) => k in d) && extra.every((k) => OPTIONAL.includes(k)), `${at}: the ten fields, and also and demo at most`, Object.keys(d || {}).join());
  ok(!('also' in d) || (Array.isArray(d.also) && d.also.length >= 1 && d.also.every((c) => typeof c === 'string' && c !== d.cause) && new Set(d.also).size === d.also.length),
    `${at}: also is a list of further causes, none its own cause, none twice`, JSON.stringify(d.also));
  ok(!('demo' in d) || !demoProblem(d), `${at}: its demo is the site's <id>.webm and <id>.webp, 6 to 12 seconds`, 'demo' in d ? demoProblem(d) : '');
  ok(typeof d.id === 'string' && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(d.id) && !ids.has(d.id), `${at}: a unique lower case id`);
  ids.add(d.id);
  ok(typeof d.title === 'string' && d.title.length >= 8 && d.title.length <= 60, `${at}: a short title`);
  ok(WHERE.has(d.where), `${at}: where is range, deathmatch, custom or unrated`, d.where);
  const fullMatch = d.where === 'unrated' && (d.steps || []).some((s) => FULL_MATCH.test(s));
  ok(Number.isInteger(d.minutes) && d.minutes >= 5 && d.minutes <= (fullMatch ? 45 : 20), `${at}: 5 to 20 minutes, a full unrated match up to 45`, String(d.minutes));
  ok(Array.isArray(d.bands) && d.bands.every((b) => BANDS.includes(b)) && new Set(d.bands).size === d.bands.length && d.bands.length < 4,
    `${at}: bands are the four keys, none twice, and all four is written as none`, JSON.stringify(d.bands));
  ok(Array.isArray(d.steps) && d.steps.length >= 3 && d.steps.length <= 6 && d.steps.every((s) => typeof s === 'string' && s.length >= 10 && s.length <= 200),
    `${at}: 3 to 6 short steps`);
  ok(typeof d.goal === 'string' && /\d/.test(d.goal) && d.goal.length <= 130, `${at}: a goal with a number in it`, d.goal);
  ok(typeof d.why === 'string' && d.why.length >= 20 && d.why.length <= 200 && (d.why.match(/[.!?](?:\s|$)/g) || []).length === 1, `${at}: one sentence of why`, d.why);
  ok(typeof d.check === 'string' && MEASURED.test(d.check) && d.check.length <= 140, `${at}: a check that names something Occlara measures`, d.check);
  // The steps are imperative: no step opens on a pronoun or an article.
  ok((d.steps || []).every((s) => !/^(?:You|I|We|The|A|An|It|This)\b/.test(s)), `${at}: every step is an instruction`, (d.steps || []).join(' | '));
}

// ── 2. Coverage ─────────────────────────────────────────────────────────────
console.log('coverage:');
const fs = require('fs');
const insightsSrc = fs.readFileSync(path.join(ROOT, 'src', 'shared', 'insights.js'), 'utf8');
const between = (from, to) => {
  const a = insightsSrc.indexOf(from);
  const b = insightsSrc.indexOf(to, a + 1);
  return a >= 0 && b > a ? insightsSrc.slice(a, b) : '';
};
const named = new Set(Object.keys(CAUSES).filter((c) => c !== 'unclear'));
const sections = [between('// ── Mistakes', '// ── Strengths'), between('// ── Missed', 'function lol(')];
ok(sections.every((s) => s.length > 500), 'insights.js still has its Mistakes and Missed sections, which this test reads the keys from');
for (const s of sections) {
  for (const m of s.matchAll(/\bkey:\s*'([a-z0-9-]+)'/g)) named.add(m[1]);
}
ok(named.has('untraded') && named.has('first-death') && named.has('no-escape') && named.has('ult-held') && named.has('low-headshots'),
  'the parsed list holds known keys', [...named].join());
// A drill serves its cause and every cause in its `also`.
const causesOf = (d) => [d.cause, ...(Array.isArray(d.also) ? d.also : [])];
const byCause = new Map();
for (const d of drills) for (const c of causesOf(d)) byCause.set(c, (byCause.get(c) || 0) + 1);
for (const d of drills) ok(named.has(d.cause) || d.cause === 'general', `drill ${d.id}: its cause "${d.cause}" is one the app can name, or general`);
for (const d of drills) for (const c of d.also || []) ok(named.has(c), `drill ${d.id}: its further cause "${c}" is one the app can name`);
for (const c of named) ok((byCause.get(c) || 0) >= 3, `the cause "${c}" has at least 3 drills (${byCause.get(c) || 0})`);
ok(drills.filter((d) => d.cause === 'general').length >= 8, `at least 8 general drills (${drills.filter((d) => d.cause === 'general').length})`);
for (const c of [...named, 'general']) {
  const ds = drills.filter((d) => causesOf(d).includes(c));
  ok(ds.length < 3 || new Set(ds.map((d) => d.where)).size >= 2, `the drills for "${c}" use more than one place to practise`);
}
// Shots landing below the head reaches the aim drills, the Practice page's way (practice.js normaliseLibrary, drillsFor).
{
  const practice = require(path.join(ROOT, 'src', 'shared', 'practice.js'));
  const norm = practice.normaliseLibrary(lib);
  const hs = practice.drillsFor(norm, 'low-headshots', 'silver_gold', []).map((d) => d.id);
  ok(['lost-duel-counter-strafe', 'lost-duel-first-bullet', 'lost-duel-head-height-walk', 'lost-duel-shooting-error', 'general-stop-to-shoot'].every((id) => hs.includes(id)),
    `the Practice page offers the aim drills for low-headshots (${hs.join(', ')})`);
  ok(practice.drillsFor(norm, 'lost-duel', null, []).length === 4, 'and lost-duel keeps its own four');
}

// ── 3. The words ────────────────────────────────────────────────────────────
console.log('the words:');
// The words of the game: agents, their abilities, maps, guns, callouts, and the menus the drills name.
const GAME = new Set();
const addWords = (s) => { for (const w of String(s || '').split(/[^A-Za-z0-9']+/)) if (w) GAME.add(w.toLowerCase()); };
for (const [name, a] of Object.entries(data.agents || {})) {
  addWords(name);
  for (const ab of a.abilities || []) addWords(ab);
}
for (const m of Object.values(data.maps || {})) addWords(m);
for (const w of Object.keys(data.weapons || {})) addWords(w);
for (const list of Object.values(data.mapCallouts || {})) for (const c of (Array.isArray(list) ? list : [])) addWords(typeof c === 'string' ? c : c && c.name);
addWords('Range Deathmatch Settings Crosshair Movement Error Shooting Video Stats Allow Cheats Ghost Infinite Abilities Ammo Pause Match Timer End Game Phase Escape Change Agent'
  + ' Speed Medium Easy Hard Streak Eliminate Bots Strafe Bot Armor F2 F3 A B C Iron Bronze Silver Gold Platinum Diamond Ascendant Immortal Radiant');
const sentences = (s) => String(s).split(/(?<=[.!?:])\s+/).filter(Boolean);
for (const d of drills) {
  const parts = [d.title, ...(d.steps || []), d.goal, d.why, d.check];
  const all = parts.join(' ');
  ok(!DASHES.test(all), `drill ${d.id}: no em or en dash`);
  ok(!/;/.test(all), `drill ${d.id}: no semicolon`);
  ok(!FORBIDDEN.test(all), `drill ${d.id}: nothing about the economy`, (all.match(FORBIDDEN) || [])[0]);
  for (const p of parts) {
    for (const s of sentences(p)) {
      const inner = s.split(/\s+/).slice(1).map((w) => w.replace(/[^A-Za-z0-9']/g, '')).filter((w) => /^[A-Z]/.test(w));
      const strange = inner.filter((w) => !GAME.has(w.toLowerCase().replace(/'s$/, '')));
      ok(!strange.length, `drill ${d.id}: no name, only words of the game, in "${s}"`, strange.join());
      for (const [k, fn] of [['move-fire', G.checkMoveFire], ['oneshot', G.checkOneShot], ['bullets', G.checkBullets]]) {
        ok(!fn(s), `drill ${d.id}: the ${k} check passes "${s}"`);
      }
      ok(!G.teamDrill(s), `drill ${d.id}: a Range or Deathmatch sentence asks for no team, "${s}"`);
      ok(!G.economyClaim(s), `drill ${d.id}: no economy claim in "${s}"`);
    }
  }
  // A Range or Deathmatch drill is played with no team at all.
  if (d.where === 'range' || d.where === 'deathmatch') {
    ok(!/\b(?:teammates?|your team|trade|call)\b/i.test((d.steps || []).join(' ')), `drill ${d.id}: its steps need no teammate`);
  }
}
// The coaching audit (Nov 2026): what a drill asks must be doable as written.
const byId = new Map(drills.map((d) => [d.id, d]));
const GHOST_KEY = /\bset a key for Ghost in the Cheats tab\b/;
ok(GHOST_KEY.test('Start a custom game with Allow Cheats on, then set a key for Ghost in the Cheats tab and turn it on.'), 'the Ghost key words match a known positive');
for (const d of drills.filter((x) => /\bGhost\b/.test((x.steps || []).join(' ')))) {
  ok((d.steps || []).some((s) => GHOST_KEY.test(s)), `drill ${d.id}: Ghost is used, so a step sets its key in the Cheats tab first`);
}
const kit = byId.get('same-killer-learn-the-kit');
ok(kit && kit.steps.some((s) => /Escape, then Change Agent/.test(s)) && !kit.steps.some((s) => /\bF2\b/.test(s)), 'the Range agent switch is Escape, then Change Agent, not F2');
ok(drills.every((d) => !/\b\d+ m\b/.test([...(d.steps || []), d.goal].join(' '))), 'no accuracy target distance in metres, which could not be checked');
for (const id of ['isolated-who-swings', 'untraded-call-before-swing']) {
  const d = byId.get(id);
  ok(d && d.steps.filter((s) => /\bdo not (?:swing|take that fight)\b/.test(s)).every((s) => /^On attack, /.test(s))
    && d.steps.some((s) => /\bdo not (?:swing|take that fight)\b/.test(s)), `drill ${id}: a step that says not to fight says it of attack`);
}
const hold = byId.get('one-v-one-hold-or-hunt');
ok(hold && /every time you are the last one alive, across 1 full unrated match/i.test(hold.goal) && hold.steps.some((s) => FULL_MATCH.test(s)), 'hold or hunt is played over a full unrated match');

// The planted negatives: each check above must catch its own bad drill.
ok(FORBIDDEN.test('Buy a Spectre') && FORBIDDEN.test('play the save round') && FORBIDDEN.test('count your credits') && !FORBIDDEN.test('Play one Deathmatch.'), 'the economy words both ways');
ok(MEASURED.test('Fewer deaths nobody traded.') && MEASURED.test('A higher headshot rate.') && !MEASURED.test('You feel better.'), 'the measured words both ways');
ok(G.teamDrill('In Deathmatch, swing right after your teammate.') && !G.teamDrill('Play one Deathmatch.'), 'teamDrill both ways');
ok(DASHES.test('a' + String.fromCharCode(0x2014) + 'b') && !DASHES.test('a, b'), 'the dash check both ways');
ok(!GAME.has('zzname') && GAME.has('jett') && GAME.has('vandal') && GAME.has('ascent'), 'the game words hold agents, guns and maps and nothing else');

// ── 4. SERVED: the research notes ──────────────────────────────────────────
console.log('served:');
const knowledge = require(path.join(ROOT, 'server', 'services', 'knowledge.js'));
const review = require(path.join(ROOT, 'server', 'services', 'match-review.js'));
const cp = require(path.join(ROOT, 'server', 'services', 'chat-prompt.js'));
const chatContext = require(path.join(ROOT, 'src', 'shared', 'chat-context.js'));
const mine = knowledge.all().filter((n) => n && n.source && n.source.kind === 'guide' && n.when && n.why && [
  'defence holds the power', 'after your first kill on defence', 'holding from a spot you can leave', 'trading distance on attack',
  'trading on defence', 'the first mistake in the chain', 'starting positions', 'utility unused at death', 'rank priorities',
  'up in numbers on defence', 'practice the counted mistake'].includes(n.source.topic));
ok(mine.length === 14, `the 14 research notes are merged (${mine.length})`);
const topicOf = new Map(knowledge.all().map((n) => [n.text, n.source && n.source.topic]));
for (const n of mine) {
  ok(!DASHES.test(n.text) && !/;/.test(n.text), `note "${n.source.topic}": no dash, no semicolon`);
  ok(!G.economyClaim(n.text), `note "${n.source.topic}": no economy claim`);
  ok(!G.checkNextSite(n.text), `note "${n.source.topic}": calls no next site`);
  const said = { side: n.side || null, planted: n.phase === 'postplant' ? true : (n.phase === 'active' ? false : null) };
  ok(!G.checkSpikeSide(n.text, said), `note "${n.source.topic}": the spike side gate keeps it`, G.checkSpikeSide(n.text, said));
  ok(!G.checkClockBeforePlant(n.text, {}), `note "${n.source.topic}": the clock gate keeps it`);
}
// The defence note is the true side of the spike gate, and its turned form is not.
const power = mine.find((n) => n.source.topic === 'defence holds the power');
ok(power && /^On defence before the plant the attackers have to come to you/.test(power.text)
  && G.checkSpikeSide('On defence before the plant, nobody has to come to you.', { side: 'defense' }), 'THE POWER NOTE: they come to you before the plant, and the gate catches the turned form');
// One rank note for each band, narrowed to it alone.
const rankNotes = mine.filter((n) => n.source.topic === 'rank priorities');
ok(BANDS.every((b) => rankNotes.filter((n) => Array.isArray(n.ranks) && n.ranks.length === 1 && n.ranks[0] === b).length === 1), 'one rank priorities note per band, each for that band alone');

// retrieve() with the jitter seeded, so the counts are the same every run.
const realRandom = Math.random;
let seed = 7;
Math.random = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
const served = (ctx, topic, runs = 20) => {
  let n = 0;
  for (let i = 0; i < runs; i++) if (knowledge.retrieve(ctx, 8, { advanced: true }).some((t) => topicOf.get(t) === topic)) n++;
  return n;
};
for (const [ctx, topic, least] of [
  [{ side: 'defending', phase: 'active', cause: 'repeek', rankBand: 'silver_gold' }, 'after your first kill on defence', 18],
  [{ side: 'defending', phase: 'active', cause: 'repeek', rankBand: 'iron_bronze' }, 'holding from a spot you can leave', 18],
  [{ side: 'defending', phase: 'active', cause: 'dry-peek', rankBand: 'iron_bronze' }, 'defence holds the power', 18],
  [{ side: 'defending', phase: 'active', cause: 'overextend', rankBand: 'plat_diamond' }, 'defence holds the power', 18],
  [{ side: 'defending', phase: 'active', cause: 'isolated', rankBand: 'silver_gold' }, 'trading on defence', 18],
  [{ side: 'attacking', phase: 'active', cause: 'isolated', rankBand: 'silver_gold' }, 'trading distance on attack', 10],
  [{ phase: 'active', rankBand: 'iron_bronze' }, 'rank priorities', 10],
]) {
  const got = served(ctx, topic);
  ok(got >= least, `SERVED in the review: "${topic}" for ${JSON.stringify(ctx)} (${got} of 20)`);
}
// Never on the wrong side.
ok(served({ side: 'attacking', phase: 'active', cause: 'repeek', rankBand: 'silver_gold' }, 'after your first kill on defence') === 0
  && served({ side: 'defending', phase: 'active', cause: 'isolated', rankBand: 'silver_gold' }, 'trading distance on attack') === 0, 'NOT SERVED on the other side');
// The band: a rank note above the player's band never reaches them.
ok(served({ phase: 'active', rankBand: 'iron_bronze' }, 'rank priorities') > 0
  && knowledge.retrieve({ phase: 'active', rankBand: 'iron_bronze' }, 30, { advanced: true }).every((t) => !/^(?:In Platinum|From Ascendant)/.test(t)), 'NOT SERVED above the band');
Math.random = realRandom;

// study(): a match whose deaths gather at one place lists the note on what this enemy did last time.
const study = review.study({ context: { rankBand: 'silver_gold', advancedTips: true }, patterns: [{ key: 'spot' }], rounds: [], mistakes: [], byCause: true }, 4);
ok(study.some((n) => /^When you come back to a spot where this enemy already killed you/.test(n.text)), 'SERVED in study(): the spot pattern lists what this enemy did last time', study.map((n) => n.text.slice(0, 50)).join(' | '));

// Ask Coach with no match, as the server builds it.
const asked = (band, content) => {
  const ctx = chatContext.build(null, { rows: [] }, null, content, { game: 'valorant', language: 'en', advanced: true, switchedFrom: null, now: 0 });
  ctx.rankBand = band;
  return cp.pickNotes(cp.normalise(ctx), [{ role: 'user', content }]).map((t) => topicOf.get(t));
};
for (const [band, q, topic] of [
  ['iron_bronze', 'I am Iron 2. What should I fix first to climb?', 'rank priorities'],
  ['silver_gold', 'I am Gold 1 and hardstuck. What should I work on to climb?', 'rank priorities'],
  ['plat_diamond', 'I am Platinum 3. What is holding me back from climbing?', 'rank priorities'],
  ['asc_plus', 'I am Ascendant 1, what should I improve to climb further?', 'rank priorities'],
  ['silver_gold', 'I was on Sova on Bind, defense, round 6. I keep peeking out of B site early and dying. Should I just hold?', 'defence holds the power'],
]) {
  const got = asked(band, q);
  ok(got.includes(topic), `SERVED in Ask Coach: "${topic}" at ${band}`, JSON.stringify(got));
}
// Each band's own rank note, never another band's.
const ironGot = cp.pickNotes((() => { const c = chatContext.build(null, { rows: [] }, null, 'I am Iron 2. What should I fix first to climb?', { game: 'valorant', language: 'en', advanced: true, switchedFrom: null, now: 0 }); c.rankBand = 'iron_bronze'; return cp.normalise(c); })(),
  [{ role: 'user', content: 'I am Iron 2. What should I fix first to climb?' }]);
ok(ironGot.some((t) => /^In Iron and Bronze/.test(t)) && !ironGot.some((t) => /^(?:In Silver and Gold|In Platinum|From Ascendant)/.test(t)), 'the Iron player gets the Iron note and no other band\'s');

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
