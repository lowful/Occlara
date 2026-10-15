'use strict';

/**
 * check:primer. The Valorant primer states game numbers to the models as
 * exact, so every number in it must have a source, and this fails the build
 * on one that has none.
 *
 * Offline: it reads the generated data, server/data/game-rules.json, the patch
 * history, the client constants the primer mirrors and the AI log fixtures,
 * and fakes valorant-api for the live check. Nothing is fetched and nothing is
 * spent.
 *
 * What it holds:
 *   1. the generated data: both copies identical, and the extraction (the
 *      sync's and the live check's one code) giving exactly this file back from
 *      data shaped as the API sends it, and failing closed where it must;
 *   2. provenance: every digit in every render inside a number the renderer
 *      recorded, with its subject, attribute, source and tier, no spelled
 *      number in the primer's own words, every synced input a key of the data;
 *   3. only confirmed stated facts render, and exactly the player's decision is
 *      confirmed (the standard economy, the spike, ultimate points; Swiftplay's
 *      economy held in words);
 *   4. the arithmetic, recomputed independently: the armour rule (simulation
 *      against the closed form for every gun, band, part and armour), every
 *      hits to kill, every time to kill per gun, damage as the game shows it;
 *   5. mutation: a changed number changes or removes the sentence it guards;
 *   6. the mirrors held equal to the code they mirror, and canaries on the
 *      real AI log fixtures;
 *   7. size, no dashes, no source name, no patch number;
 *   8. the live version check, on a faked valorant-api;
 *   9. the patch history and both patch gates;
 *  10. where the primer goes: never the live read, never League, never src/.
 *
 * Every regex here and in the modules it checks has a positive and a negative.
 *
 * Run: npm run check:primer
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const P = (...p) => path.join(ROOT, ...p);
const primerMod = require(P('server', 'services', 'game-primer.js'));
const extractor = require(P('server', 'services', 'valorant-extract.js'));
const topics = require(P('server', 'services', 'patch-topics.js'));
const patchSync = require(P('scripts', 'sync-patch-notes.js'));
const DATA = require(P('server', 'valorant-data.generated.json'));
const RULES = require(P('server', 'data', 'game-rules.json'));
const PATCHES = require(P('server', 'patch-notes.generated.json'));

let fails = 0;
let checks = 0;
const ok = (cond, what, detail) => {
  checks++;
  if (!cond) { fails++; console.log(`FAIL  ${what}${detail ? `\n        ${detail}` : ''}`); } else console.log(`ok    ${what}`);
};
const clone = (x) => JSON.parse(JSON.stringify(x));
const titleOf = (k) => k.charAt(0).toUpperCase() + k.slice(1);
const quiet = () => {};
const HOUR = 3600 * 1000;

// ── 1. the generated data and the extraction ────────────────────────────────
console.log('the generated data and the extraction:');
{
  const a = fs.readFileSync(P('server', 'valorant-data.generated.json'), 'utf8');
  const b = fs.readFileSync(P('src', 'shared', 'valorant-data.generated.json'), 'utf8');
  ok(a === b, 'server/ and src/shared copies of the generated data are identical');
  ok(!!DATA.patch && !!DATA.version && DATA.gear && DATA.modes && DATA.roles, `the data carries the patch (${DATA.patch}), gear, modes and roles`);
}

/** The API's own shape, rebuilt from the generated file, for the round trip. */
function rawFromGenerated(d) {
  const weapons = Object.entries(d.weapons).map(([k, w]) => ({
    displayName: titleOf(k),
    shopData: { cost: w.cost || 0, categoryText: w.category },
    weaponStats: {
      fireRate: w.fireRate, magazineSize: w.magazine, reloadTimeSeconds: w.reload, equipTimeSeconds: w.equip,
      runSpeedMultiplier: w.runSpeed, firstBulletAccuracy: w.spread.hip === null ? -1 : w.spread.hip,
      shotgunPelletCount: w.pellets || 1,
      wallPenetration: w.penetration ? `EWallPenetrationDisplayType::${w.penetration}` : null,
      feature: w.feature ? `EWeaponStatsFeature::${w.feature}` : null,
      altFireType: w.altFire ? `EWeaponAltFireDisplayType::${w.altFire}` : null,
      adsStats: (w.spread.ads !== null || w.adsBurst) ? { burstCount: w.adsBurst || 1, firstBulletAccuracy: w.spread.ads === null ? -1 : w.spread.ads } : null,
      altShotgunStats: w.altPellets ? { shotgunPelletCount: w.altPellets } : null,
      airBurstStats: w.airBurst ? { shotgunPelletCount: w.airBurst.pellets, burstDistance: w.airBurst.distance } : null,
      damageRanges: w.ranges.map((r) => ({ rangeStartMeters: r.from, rangeEndMeters: r.to, headDamage: r.head, bodyDamage: r.body, legDamage: r.leg })),
    },
  }));
  weapons.push({ displayName: 'Melee', shopData: null, weaponStats: null });
  const gear = Object.entries(d.gear).map(([name, g]) => ({
    displayName: name,
    description: g.capacity ? `Absorbs ${Math.round(g.absorbed * 100)}% of total damage taken. Breaks after it has absorbed ${g.capacity} damage.`
      : `Absorbs ${Math.round(g.absorbed * 100)}% of total damage taken. Regenerates after it has absorbed damage.`,
    details: [{ name: 'DAMAGE ABSORBED', value: `${Math.round(g.absorbed * 100)}%` }, ...(g.pool ? [{ name: 'REGENERATION POOL', value: String(g.pool) }] : [])],
    shopData: { cost: g.cost },
  }));
  const agents = Object.entries(d.agents).map(([name, a]) => {
    // The used abilities in the order the API sent them, then the passive.
    const byName = new Map(a.kit.map((k) => [k.name.toLowerCase(), k]));
    const used = a.abilities.map((n) => byName.get(n)).filter(Boolean);
    const rest = a.kit.filter((k) => !used.includes(k));
    return { displayName: name, role: { displayName: a.role, description: d.roles[a.role] },
      abilities: [...used, ...rest].map((k) => ({ slot: k.slot, displayName: k.name, description: k.description })) };
  });
  const gamemodes = [
    { displayName: 'Standard', description: d.modes.standard.description, roundsPerHalf: -1 },
    { displayName: 'Swiftplay', description: d.modes.swiftplay.description, roundsPerHalf: d.modes.swiftplay.roundsPerHalf,
      gameRuleBoolOverrides: [{ ruleName: 'EGameRuleBoolName::IsOvertimeWinByTwo', state: d.modes.swiftplay.overtimeWinByTwo }] },
  ];
  const version = { branch: `release-${d.patch}`, version: d.version, buildDate: d.buildDate };
  return { agents, weapons, gear, gamemodes, version };
}

const RAW = rawFromGenerated(DATA);
{
  let built = null;
  try { built = extractor.extract(clone(RAW)); } catch (e) { console.log('      ', e.message); }
  ok(!!built, 'the extraction reads data shaped as valorant-api sends it');
  if (built) {
    for (const k of ['agents', 'roles', 'weapons', 'gear', 'modes', 'patch', 'version', 'buildDate']) {
      ok(JSON.stringify(built[k]) === JSON.stringify(DATA[k]), `and gives back the generated ${k} exactly`);
    }
  }
  const throwsWith = (mutate, words, what) => {
    const raw = clone(RAW);
    mutate(raw);
    let msg = '';
    try { extractor.extract(raw); } catch (e) { msg = e.message; }
    ok(msg.includes(words), `fails closed: ${what}`, msg ? `said: ${msg.slice(0, 160)}` : 'it did not throw');
  };
  throwsWith((r) => { r.gear = r.gear.filter((g) => g.displayName !== 'Heavy Armor'); }, 'Heavy Armor is missing', 'a missing armour');
  throwsWith((r) => { r.gear[0].description = 'Absorbs damage.'; }, 'has no capacity', 'an armour whose text gives no capacity');
  throwsWith((r) => { r.gear.push({ ...clone(r.gear[0]), displayName: 'Mega Armor' }); }, 'gear Mega Armor is one the primer does not know', 'a gear item the renderer does not know');
  throwsWith((r) => { r.weapons.push({ ...clone(r.weapons[0]), displayName: 'Blaster' }); }, 'weapon Blaster is one the primer does not know', 'a gun the renderer does not know');
  throwsWith((r) => { const j = r.agents.find((a) => a.displayName === 'Jett'); j.abilities = j.abilities.filter((x) => x.slot !== 'Ultimate'); }, 'agent Jett has no Ultimate ability', 'an agent missing a used slot');
  throwsWith((r) => { const j = r.agents.find((a) => a.displayName === 'Jett'); j.abilities.find((x) => x.slot === 'Grenade').description = ''; }, "Cloudburst has no description", 'an ability with no description');
  throwsWith((r) => { r.agents[0].role.description = ''; }, 'has no description', 'a role with no description');
  throwsWith((r) => { r.weapons = r.weapons.slice(0, 14); }, 'only 14 weapons', 'fewer than 15 guns');
  throwsWith((r) => { const s = r.weapons.find((w) => w.displayName === 'Vandal').weaponStats; s.fireRateRenamed = s.fireRate; delete s.fireRate; }, 'Vandal has no fire rate', 'a renamed field');
  throwsWith((r) => { r.version = { branch: 'main' }; }, 'could not read a patch number', 'a version with no patch');
}

// ── 2. provenance ───────────────────────────────────────────────────────────
console.log('\nevery number has a source:');
const primer = primerMod.create();
const renders = [
  ['core standard', primer.renderCore('standard')],
  ['core swiftplay', primer.renderCore('swiftplay')],
  ['core standard without guns', primer.renderCore('standard', { guns: false })],
  ['guns slice', primer.renderGuns(['Bandit', 'sheriff', 'Vandal', 'judge', 'operator', 'bucky'])],
  ['duel slice', primer.renderDuel({ round: 5, pistol: true, side: 'attacking', afterPlant: true, metres: 14, me: { gun: 'bandit', armor: null }, them: { gun: 'sheriff', armor: 'Light Armor' } })],
  ['duel slice, no distance', primer.renderDuel({ me: { gun: 'spectre', armor: 'Light Armor' }, them: { gun: 'vandal', armor: 'Heavy Armor' }, side: 'defending', afterPlant: true })],
  ['comps slice', primer.renderComps(['Jett', 'Sova', 'Omen', 'Killjoy', 'Reyna'], ['Jett', 'Chamber', 'Astra', 'Raze', 'Neon'])],
  ['duel slice, shotguns', primer.renderDuel({ metres: 5, me: { gun: 'vandal', armor: 'Heavy Armor' }, them: { gun: 'judge', armor: 'Light Armor' } })],
  ['duel slice, a Regen Shield', primer.renderDuel({ me: { gun: 'vandal', armor: 'Light Armor' }, them: { gun: 'phantom', armor: 'Regen Shield' } })],
  ['comps slice, one unknown', primer.renderComps(['Jett', 'Sova', 'Omen', 'Killjoy', 'Agent9'], ['Jett', 'xXSlayer99Xx', 'Astra', 'Raze', 'Neon'])],
  ...Object.keys(DATA.agents).map((n) => [`kit ${n}`, primer.renderKit(n)]),
];
const synced = primerMod.flatten(DATA);
const NUMBER_RUN = /\d+(?:\.\d+)?/g;
{
  let problems = [];
  let uncovered = [];
  let incomplete = [];
  let badDeps = [];
  let misplaced = [];
  for (const [name, r] of renders) {
    for (const p of r.problems) problems.push(`${name}: ${p}`);
    const spans = r.provenance.map((e) => [e.at, e.at + e.text.length]);
    for (const e of r.provenance) {
      if (r.text.slice(e.at, e.at + e.text.length) !== e.text) misplaced.push(`${name}: "${e.text}" at ${e.at}`);
      if (!e.subject || !e.attribute || !e.source || !e.tier) incomplete.push(`${name}: ${JSON.stringify(e).slice(0, 140)}`);
      for (const d of e.deps || []) {
        if (/^[wgarm]:/.test(d) && !d.endsWith(':') && !synced.has(d)) badDeps.push(`${name}: ${d}`);
        if (d.startsWith('s:') && !RULES.facts[d.slice(2)]) badDeps.push(`${name}: ${d}`);
      }
    }
    let m;
    NUMBER_RUN.lastIndex = 0;
    while ((m = NUMBER_RUN.exec(r.text)) !== null) {
      const at = m.index; const end = at + m[0].length;
      if (!spans.some(([s, t]) => at >= s && end <= t)) uncovered.push(`${name}: "${r.text.slice(Math.max(0, at - 30), end + 10)}"`);
    }
  }
  ok(!problems.length, 'no digit and no spelled number in any render outside a recorded number', problems.slice(0, 5).join(' | '));
  ok(!uncovered.length, 'every number in every render is inside a recorded number', uncovered.slice(0, 5).join(' | '));
  ok(!misplaced.length, 'every recorded number sits in the text where its record says', misplaced.slice(0, 5).join(' | '));
  ok(!incomplete.length, 'every recorded number has its subject, attribute, source and tier', incomplete.slice(0, 3).join(' | '));
  ok(!badDeps.length, 'every input a number was computed from is a key of the generated data or a stated fact', badDeps.slice(0, 5).join(' | '));
  // The renderer's self check is live: a name with a digit in it, planted in
  // a copy of the data, reaches the text outside n() and must be caught.
  const planted = clone(DATA);
  planted.agents.Agent7 = { ...clone(planted.agents.Jett) };
  const caught = primerMod.create({ data: planted }).renderCore('standard').problems;
  ok(caught.some((p) => p.includes('Agent7')), 'and the self check catches a planted digit outside n() (the control)');
}
{
  const prov = primer.provenance('standard');
  const KNOWN = new Set(['hits', 'head', 'body', 'legs', 'price', 'credits', 'seconds', 'rate', 'magazine', 'rounds', 'pellets', 'health', 'percent',
    'points', 'metres', 'kills', 'damage', 'armor', 'count', 'degrees', 'score', 'round', 'losses', 'charges']);
  const odd = [...new Set(prov.map((e) => e.attribute))].filter((a) => !KNOWN.has(a));
  ok(!odd.length, 'every attribute is one the number gate reads', odd.join(', '));
  ok(prov.every((e) => !e.part || ['head', 'body', 'legs'].includes(e.part)), 'parts are head, body or legs');
  ok(prov.every((e) => e.armor === null || ['none', 'Light Armor', 'Heavy Armor'].includes(e.armor)), 'armour is none, Light Armor or Heavy Armor');
  ok(prov.every((e) => ['gun', 'gear', 'agent', 'ability', 'rule', 'role'].includes(e.subjectKind)), 'every number has a subject kind');
  ok(prov.filter((e) => e.subjectKind === 'rule' && e.tier !== 'definition').every((e) => Array.isArray(e.words) && e.words.length),
    'every rule number carries the words a sentence ties it by');
  const sh = prov.filter((e) => e.subject === 'Sheriff' && e.attribute === 'head' && e.band && e.band.from === 0);
  ok(sh.length === 1 && sh[0].value === 159.5 && sh[0].shown === 159 && sh[0].text === '159',
    'the Sheriff head hit to 30 m is kept as 159.5 and shown 159', JSON.stringify(sh));
  const two = prov.find((e) => e.subject === 'Sheriff' && e.attribute === 'hits' && e.part === 'body' && e.armor === 'none' && e.band.from === 0);
  const twoH = prov.find((e) => e.subject === 'Sheriff' && e.attribute === 'hits' && e.part === 'body' && e.armor === 'Heavy Armor' && e.band.from === 0);
  ok(two && two.value === 2 && twoH && twoH.value === 3, 'a Sheriff kills no armour in 2 body hits and Heavy Armor in 3, to 30 m');
  const kitTwo = primer.provenance('standard').find((e) => e.subject === 'Tailwind' && e.text === 'two');
  ok(kitTwo && kitTwo.value === 2 && kitTwo.attribute === 'kills' && kitTwo.agent === 'Jett', "a spelled number in the game's own text is a recorded number too (Tailwind, every two kills)");
}

// ── 3. only confirmed facts ─────────────────────────────────────────────────
console.log('\nonly confirmed stated facts render:');
{
  const KINDS = new Set(['riot-notes', 'measured', 'occlara', 'wiki']);
  const bad = [];
  for (const [id, f] of Object.entries(RULES.facts)) {
    if (!KINDS.has(f.kind)) bad.push(`${id}: kind ${f.kind}`);
    if (!f.source || typeof f.source !== 'string') bad.push(`${id}: no source`);
    if (!f.check) bad.push(`${id}: no check`);
    if (!/^\d+\.\d+$/.test(String(f.verifiedPatch || ''))) bad.push(`${id}: no verifiedPatch`);
    if (!Array.isArray(f.tags)) bad.push(`${id}: tags not an array`);
    if (f.confirmed !== null && !(f.confirmed && f.confirmed.by && f.confirmed.on && f.confirmed.how)) bad.push(`${id}: confirmed is neither null nor { by, on, how }`);
    if (f.kind === 'wiki' && f.confirmed && f.confirmed.how !== 'player-2026-10-15') bad.push(`${id}: a wiki fact confirmed by something other than the player`);
    if (f.kind !== 'occlara' && !f.tags.length) bad.push(`${id}: a game fact with no topic, which no patch could ever withhold`);
    for (const t of f.tags) if (!topics.TOPICS[t]) bad.push(`${id}: tag ${t} has no topic pattern`);
  }
  ok(!bad.length, 'every stated fact has a kind, a source, a check, a patch, topic tags with patterns, and a confirmation or null', bad.slice(0, 5).join(' | '));
  ok(!!RULES.confirmations && !!RULES.confirmations['player-2026-10-15'], "the player's confirmation is recorded with what it covers");
  const DECIDED = ['credits.start', 'credits.win', 'credits.loss', 'credits.kill', 'credits.plant', 'credits.overtime',
    'spike.plant', 'spike.defuse', 'spike.checkpoint', 'spike.timer', 'spike.beeps', 'ult.perEvent'];
  const wikiConfirmed = Object.entries(RULES.facts).filter(([, f]) => f.kind === 'wiki' && f.confirmed).map(([id]) => id).sort();
  ok(JSON.stringify(wikiConfirmed) === JSON.stringify(DECIDED.slice().sort()), "exactly the player's decided wiki numbers are confirmed",
    `confirmed: ${wikiConfirmed.join(', ')}`);
  const held = Object.entries(RULES.facts).filter(([, f]) => !f.confirmed).map(([id]) => id).sort();
  ok(held.length && held.every((id) => id.startsWith('swift.')), `and only Swiftplay's are held (${held.join(', ')})`);
  const all = [...primer.provenance('standard'), ...primer.provenance('swiftplay')];
  const unconfirmed = all.filter((e) => e.tier === 'stated' && !RULES.facts[e.source.replace(/^game-rules ([^ ]+).*$/, '$1')].confirmed);
  ok(!unconfirmed.length, 'no stated number renders without its confirmation', unconfirmed.slice(0, 3).map((e) => e.source).join(', '));
  const swift = primer.renderCore('swiftplay').text;
  const swiftCredits = swift.slice(swift.indexOf('CREDITS IN SWIFTPLAY'), swift.indexOf('DAMAGE AND ARMOUR'));
  ok(swiftCredits.length > 0 && !/\b(?:3000|2400|4250)\b/.test(swiftCredits) && /pays more after a won first round/.test(swiftCredits) && /fixed amount/.test(swiftCredits),
    "Swiftplay's economy is said in words, with none of its numbers", swiftCredits.slice(0, 200));
  ok(!primer.provenance('swiftplay').some((e) => /^game-rules swift\./.test(e.source || '')), 'and no Swiftplay economy number is in its provenance');
  // A pay rule is a stated fact's, never read into the mode's "same core rules".
  const rk = clone(RULES);
  for (const id of ['credits.kill', 'credits.plant']) rk.facts[id].modes = ['standard', 'swiftplay'];
  ok(!/Kills and a plant add credits/.test(swiftCredits) && /Kills and a plant add credits/.test(primerMod.create({ rules: rk }).renderCore('swiftplay').text),
    "and Swiftplay's credits say kills and a plant pay only once those pays are stated and confirmed for Swiftplay");
  ok(/starts each half with some ultimate points/.test(swift), "and Swiftplay's ultimate start in words too");
  // A fact unconfirmed in a copy of the rules falls to its words.
  const rules = clone(RULES);
  rules.facts['credits.win'].confirmed = null;
  const words = primerMod.create({ rules }).renderCore('standard').text;
  ok(!/A win pays 3000/.test(words) && /A win pays more than a loss\./.test(words), 'a win pay unconfirmed in a copy is said in words, not as 3000');
}

// ── 4. the arithmetic, recomputed ───────────────────────────────────────────
console.log('\nthe arithmetic, recomputed independently:');
const HP = RULES.facts.health.value;
const ARM = { none: null, 'Light Armor': { a: DATA.gear['Light Armor'].absorbed, c: DATA.gear['Light Armor'].capacity },
  'Heavy Armor': { a: DATA.gear['Heavy Armor'].absorbed, c: DATA.gear['Heavy Armor'].capacity } };
function hits(dmg, arm) {
  let hp = HP; let ar = arm ? arm.c : 0;
  for (let k = 1; k < 500; k++) { const take = arm ? Math.min(arm.a * dmg, ar) : 0; ar -= take; hp -= dmg - take; if (hp <= 1e-9) return k; }
  return null;
}
{
  let mismatches = [];
  for (const [k, w] of Object.entries(DATA.weapons)) {
    for (const b of w.ranges) {
      for (const part of ['head', 'body', 'leg']) {
        const closed = ['none', 'Light Armor', 'Heavy Armor'].map((n) => Math.ceil((HP + (ARM[n] ? ARM[n].c : 0)) / b[part] - 1e-9));
        const sim = ['none', 'Light Armor', 'Heavy Armor'].map((n) => hits(b[part], ARM[n]));
        if (closed.join() !== sim.join()) mismatches.push(`${k} ${part} ${b.from}-${b.to}`);
        const regen = { a: DATA.gear['Regen Shield'].absorbed, c: RULES.facts['armor.regen.capacity'].value };
        if (hits(b[part], regen) !== sim[1]) mismatches.push(`${k} ${part} regen`);
      }
    }
  }
  ok(!mismatches.length, 'the armour rule: simulation equals the closed form for every gun, band, part and armour, and a full Regen Shield equals Light Armor', mismatches.slice(0, 5).join(', '));
  ok(primer.armourRuleHolds(), "and the primer's own check agrees");
  const prov = [...primer.provenance('standard'), ...primer.renderDuel({ me: { gun: 'spectre', armor: 'Light Armor' }, them: { gun: 'vandal', armor: 'Heavy Armor' } }).provenance];
  const wrongHits = [];
  const wrongTtk = [];
  const wrongShown = [];
  const ttkGuns = new Set();
  for (const e of prov) {
    if (e.subjectKind !== 'gun') continue;
    const w = DATA.weapons[e.subject.toLowerCase()];
    const band = e.band ? w.ranges.find((b) => b.from === e.band.from && b.to === e.band.to) : null;
    const part = e.part === 'legs' ? 'leg' : e.part;
    if (e.attribute === 'hits') {
      if (hits(band[part], ARM[e.armor]) !== e.value) wrongHits.push(`${e.subject} ${e.part} ${e.armor} ${e.value}`);
    }
    if (e.detail === 'time to kill') {
      ttkGuns.add(e.subject);
      const want = (hits(band.body, ARM[e.armor]) - 1) / w.fireRate;
      if (Math.abs(want - e.value) > 1e-9 || e.shown !== Math.round(want * 100) / 100) wrongTtk.push(`${e.subject} ${e.armor} ${e.value} shown ${e.shown}`);
    }
    if (['head', 'body', 'legs'].includes(e.attribute) && e.detail === 'damage') {
      if (e.value !== band[part] || e.shown !== Math.floor(band[part] + 1e-9)) wrongShown.push(`${e.subject} ${e.attribute} ${e.value} shown ${e.shown}`);
    }
  }
  ok(!wrongHits.length, 'every hits to kill the primer prints is the simulation\'s', wrongHits.slice(0, 5).join(', '));
  ok(!wrongTtk.length, 'every time to kill is (hits - 1) / fire rate for its gun, shown to the hundredth', wrongTtk.slice(0, 5).join(', '));
  const nonShotguns = Object.entries(DATA.weapons).filter(([, w]) => !w.pellets && w.ranges.some((b) => ['none', 'Light Armor', 'Heavy Armor'].some((n) => hits(b.body, ARM[n]) > 1))).map(([k]) => titleOf(k));
  ok(nonShotguns.every((g) => ttkGuns.has(g)), `time to kill is printed for every gun whose body hits race (${nonShotguns.length})`, nonShotguns.filter((g) => !ttkGuns.has(g)).join(', '));
  ok(!wrongShown.length, 'damage is shown as the game shows it, the whole number below, and kept exact', wrongShown.slice(0, 5).join(', '));
  const spectre = prov.find((e) => e.subject === 'Spectre' && e.detail === 'time to kill' && e.armor === 'Heavy Armor' && e.band.from === 0);
  const vandal = prov.find((e) => e.subject === 'Vandal' && e.detail === 'time to kill' && e.armor === 'Heavy Armor');
  ok(spectre && spectre.shown === 0.38 && vandal && vandal.shown === 0.31, "the spec's own case: a Spectre's 6 body hits on Heavy Armor take 0.38 s, a Vandal's 4 take 0.31 s");
}

// ── 5. mutation ─────────────────────────────────────────────────────────────
console.log('\na changed number changes or removes the sentence it guards:');
{
  const base = primer.renderCore('standard').text;
  ok(/no Spectre head hit kills even without armour/.test(base), 'the Spectre head clause is there on the real data');
  const d = clone(DATA);
  d.weapons.spectre.ranges[0].head = 110;
  const mutated = primerMod.create({ data: d }).renderCore('standard').text;
  ok(!/no Spectre head hit kills/.test(mutated) && /so it wants the close fight/.test(mutated), 'a Spectre head hit of 110 removes "no Spectre head hit kills"');
  const d2 = clone(DATA);
  d2.weapons.phantom.ranges[1].head = 160;
  ok(!/Past 20 m a Phantom head hit no longer kills/.test(primerMod.create({ data: d2 }).renderCore('standard').text), 'a Phantom far head hit that kills removes the Phantom sentence');
  const d3 = clone(DATA);
  d3.weapons.classic.equip = 3;
  ok(!/longer than any sidearm takes to draw/.test(primerMod.create({ data: d3 }).renderCore('standard').text), 'a sidearm slower to draw than a rifle reload removes the sidearm advice');
  // Swiftplay's round 3 pay, confirmed in a copy so the guarded sentence can be seen at all.
  const r = clone(RULES);
  for (const id of Object.keys(r.facts)) if (id.startsWith('swift.')) r.facts[id].confirmed = { by: 'test', on: '2026-10-15', how: 'a copy' };
  const swiftOn = primerMod.create({ rules: r }).renderCore('swiftplay').text;
  ok(/each pay 4250 whatever happened/.test(swiftOn) && /That pay alone covers a full buy/.test(swiftOn), 'with Swiftplay confirmed in a copy, 4250 prints and covers a full buy');
  r.facts['swift.round34'].value = 3000;
  const swiftLow = primerMod.create({ rules: r }).renderCore('swiftplay').text;
  ok(/each pay 3000/.test(swiftLow) && !/That pay alone covers a full buy/.test(swiftLow), 'set to 3000, the full buy sentence goes');
  const d4 = clone(DATA);
  d4.gear['Heavy Armor'].capacity = 60;
  const heavier = primerMod.create({ data: d4 }).renderCore('standard').text;
  ok(/150 with Heavy Armor/.test(base) && /160 with Heavy Armor/.test(heavier), 'a Heavy Armor of 60 makes Heavy Armor 160 total damage, computed');
  const d5 = clone(DATA);
  d5.weapons.vandal.cost = 3000;
  const dearer = primerMod.create({ data: d5 }).renderCore('standard').text;
  ok(/A full buy is a rifle \(Vandal\) with Heavy Armor, 4000/.test(dearer), 'a Vandal at 3000 makes it the only full rifle and the full buy 4000');
}

// ── 5b. the slices count only what they can ────────────────────────────────
console.log('\nthe slices count only what they can:');
{
  // A shotgun kills with one shell or not at all: its pellets are no race of
  // shots at the fire rate, and its shell is no body count to set against a
  // rifle's (counted as shots, a Judge at 5 m read as 2.29 s to kill Heavy Armor).
  const sg = primer.renderDuel({ metres: 5, me: { gun: 'vandal', armor: 'Heavy Armor' }, them: { gun: 'judge', armor: 'Light Armor' } });
  const judge = DATA.weapons.judge;
  const need = hits(judge.ranges[0].body, ARM['Heavy Armor']);
  const pe = sg.provenance.find((e) => e.subject === 'Judge' && e.detail === 'pellets to kill');
  ok(sg.text.includes(`Their Judge on you (bought: Heavy Armor): a shell kills with ${need} of its ${judge.pellets} body pellets.`)
    && pe && pe.value === need && pe.armor === 'Heavy Armor' && pe.part === 'body' && pe.deps.includes('w:judge:pellets'),
  `a Judge at 5 m on Heavy Armor kills with ${need} of its ${judge.pellets} pellets, one shell, with its provenance`, sg.text);
  ok(!/Judge on you[^.]*\bhits \(/.test(sg.text) && !/On the guns alone/.test(sg.text) && !sg.provenance.some((e) => e.subject === 'Judge' && e.detail === 'time to kill'),
    'and no time to kill and no verdict for it: a shell is not a count of body hits');
  const far = primer.renderDuel({ metres: 20, me: { gun: 'judge', armor: null }, them: { gun: 'vandal', armor: 'Heavy Armor' } }).text;
  ok(/Your Judge on them \(bought: Heavy Armor\): a shell does not kill from full health even with every pellet\./.test(far) && /Their Vandal on you/.test(far),
    'past its range a shell that cannot kill says so');
  const rifles = primer.renderDuel({ me: { gun: 'vandal', armor: 'Light Armor' }, them: { gun: 'phantom', armor: 'Heavy Armor' } }).text;
  ok(/On the guns alone/.test(rifles), 'two guns that fire one shot at a time still get their verdict');
  // The Regen Shield is counted as itself, and named so in the provenance.
  const rs = primer.renderDuel({ me: { gun: 'vandal', armor: 'Light Armor' }, them: { gun: 'phantom', armor: 'Regen Shield' } });
  const vb = rs.provenance.find((e) => e.subject === 'Vandal' && e.attribute === 'hits' && e.part === 'body');
  const regen = { a: DATA.gear['Regen Shield'].absorbed, c: RULES.facts['armor.regen.capacity'].value };
  ok(/Your Vandal on them \(bought: Regen Shield\)/.test(rs.text) && vb && vb.armor === 'Regen Shield' && vb.value === hits(DATA.weapons.vandal.ranges[0].body, regen)
    && vb.deps.includes('s:armor.regen.capacity') && vb.deps.includes('g:Regen Shield:absorbed'),
  "a Regen Shield bought is counted through its own absorption and named in the provenance, never as no armour", JSON.stringify(vb));
  ok(!/Vandal on them/.test(primer.renderDuel({ me: { gun: 'vandal', armor: null }, them: { gun: 'phantom', armor: 'Heavy Shields' } }).text),
    'an armour the game data does not name is no duel to count, never counted as none');
  // A team list prints only the agents the game data knows.
  const cu = primer.renderComps(['Jett', 'Sova', 'Omen', 'Killjoy', 'Agent9'], ['Jett', 'xXSlayer99Xx', 'Astra', 'Raze', 'Neon']);
  ok(!/xXSlayer99Xx|Agent9/.test(cu.text) && /Killjoy \(Sentinel\) and 1 agent the game data does not list yet\./.test(cu.text) && !cu.problems.length,
    'a name in a team list is counted and never printed', cu.text);
  ok(!/Theirs had no/.test(cu.text) && /Theirs had no initiator\./.test(primer.renderComps(['Jett'], ['Jett', 'Chamber', 'Astra', 'Raze', 'Neon']).text),
    'and a team with an agent nobody knows is never said to lack a role, which a team of known agents is');
  const asRecord = primer.renderComps([{ agent: 'Jett', role: 'Controller' }, { agent: 'Sova', role: 'Initiator' }], [{ agent: 'xXSlayer99Xx', role: 'Duelist' }]).text;
  ok(/Yours: Jett \(Duelist\), Sova \(Initiator\)\./.test(asRecord) && /Theirs: 1 agent the game data does not list yet\./.test(asRecord) && !/xXSlayer99Xx/.test(asRecord),
    "the record's own { agent, role } reads the same, the role always the synced one", asRecord);
  // The guns slice's effective health holds to the core's rule.
  const d6 = clone(DATA);
  d6.gear['Light Armor'].absorbed = 0.1;
  const p6 = primerMod.create({ data: d6 });
  ok(!p6.armourRuleHolds() && !/125 with Light Armor/.test(p6.guns(['vandal'])) && /125 with Light Armor/.test(primer.guns(['vandal'])),
    'the guns slice says health plus capacity only while the armour is used up first, as the core does');
  ok(!/125 with Light Armor/.test(primer.guns(['vandal'], { withhold: ['g:Light Armor:absorbed'] })),
    'and a withheld armour share takes that line with it');
}

// ── 6. mirrors and canaries ─────────────────────────────────────────────────
console.log('\nthe mirrors, held equal to the code, and the canaries:');
{
  const vr = require(P('src', 'shared', 'valorant-rounds.js'));
  const me = require(P('src', 'shared', 'match-end.js'));
  const rr = require(P('server', 'services', 'riot-rounds.js'));
  const F = RULES.facts;
  ok(F['round.seconds'].value === vr.ROUND_SECONDS, `the round's ${F['round.seconds'].value} s is valorant-rounds.js ROUND_SECONDS`);
  ok(F['buy.pistolSeconds'].value === vr.BUY_MAX_LEFT, `the pistol buy's ${F['buy.pistolSeconds'].value} s is BUY_MAX_LEFT`);
  ok(F['rule.earlySeconds'].value === vr.ROUND_SECONDS - vr.EARLY_DEATH_LEFT, 'the early death is ROUND_SECONDS - EARLY_DEATH_LEFT');
  ok(F['rule.tradeSeconds'].value === rr.TRADE_MS / 1000 && primer.valueOf('rule.tradeSeconds') === rr.TRADE_MS / 1000, 'the trade is TRADE_MS, imported');
  // Patterns that read a number out of the code: each must match once, and
  // must read the number (a copy with the number changed reads the change).
  for (const [id, f] of Object.entries(F)) {
    if (!f.mirror || !f.mirror.pattern) continue;
    const src = fs.readFileSync(P(f.mirror.file), 'utf8');
    const re = new RegExp(f.mirror.pattern, 'g');
    const hits = [...src.matchAll(re)];
    ok(hits.length === 1 && Number(hits[0][1]) === f.value, `${id} is ${f.value} in ${f.mirror.file}`, `read ${hits.map((h) => h[1]).join(', ') || 'nothing'}`);
    if (hits.length === 1) {
      const changed = src.replace(hits[0][0], hits[0][0].replace(hits[0][1], String(f.value + 7)));
      const again = [...changed.matchAll(new RegExp(f.mirror.pattern, 'g'))];
      ok(again.length === 1 && Number(again[0][1]) === f.value + 7, `and its pattern reads the number, not just the line (${id})`);
    }
  }
  const rrSrc = fs.readFileSync(P('server', 'services', 'riot-rounds.js'), 'utf8');
  const swiftHalf = [...rrSrc.matchAll(/\/swift\/\.test\(queue\) \? (\d+)/g)];
  ok(swiftHalf.length === 1 && Number(swiftHalf[0][1]) === DATA.modes.swiftplay.roundsPerHalf, `Swiftplay's synced half of ${DATA.modes.swiftplay.roundsPerHalf} is riot-rounds.js's`);
  ok(!/\/swift\/\.test\(queue\) \? (\d+)/.test('const halfLength = /spike ?rush/.test(queue) ? 3 : 12;'), 'and that pattern reads no other mode (negative)');
  const half = F['format.standard.half'].value; const lead = F['format.overtime.lead'].value;
  const win = DATA.modes.standard.win; const swiftWin = DATA.modes.swiftplay.win;
  ok(me.isFinalScore(win, half - 1) && !me.isFinalScore(win - 1, half - 1), `first to ${win}: match-end.js ends ${win} to ${half - 1}, not ${win - 1} to ${half - 1}`);
  ok(me.isFinalScore(half + lead, half) && !me.isFinalScore(half + lead - 1, half), `overtime from ${half} all is won by a lead of ${lead} (match-end.js)`);
  ok(!me.isFinalScore(half + 1, half), `${half + 1} to ${half} is not final for the watch, since Unrated ends there and Competitive does not`);
  ok(me.isFinalScore(swiftWin, swiftWin - 1, 'swiftplay') && !me.isFinalScore(swiftWin, swiftWin - 1), `Swiftplay ends at ${swiftWin} to ${swiftWin - 1}, only once the mode is known`);
  // The canaries, on the five real AI log sessions.
  const PLAY = new Set(['active', 'postplant', 'dead']);
  const sessions = fs.readdirSync(P('scripts', 'fixtures')).filter((f) => /^valorant-session-.*\.json$/.test(f));
  let hpOk = 0; let startOk = 0; let startSeen = 0;
  const bad = [];
  for (const f of sessions) {
    const fr = JSON.parse(fs.readFileSync(P('scripts', 'fixtures', f), 'utf8')).frames || [];
    const hp = Math.max(...fr.filter((x) => x.playerAlive !== false && typeof x.playerHp === 'number').map((x) => x.playerHp));
    if (hp === F.health.value) hpOk++; else bad.push(`${f} health tops out at ${hp}`);
    let first = null;
    for (const x of fr) { if (PLAY.has(x.phase)) break; if (x.phase === 'buy' && x.playerCredits != null) { first = x; break; } }
    if (first) { startSeen++; if (first.playerCredits === F['credits.start'].value) startOk++; else bad.push(`${f} round 1 buy read ${first.playerCredits}`); }
  }
  ok(sessions.length === 5 && hpOk === 5, `health tops out at ${F.health.value} in all ${sessions.length} AI log sessions`, bad.join('; '));
  ok(startSeen >= 4 && startOk === startSeen, `the first round 1 buy read shows ${F['credits.start'].value} in all ${startSeen} sessions that read one`, bad.join('; '));
}

// ── 7. size, dashes, sources, the patch ─────────────────────────────────────
console.log('\nsize, dashes, sources:');
{
  const size = primer.size();
  ok(size.standard.chars < 17000 && size.swiftplay.chars < 17000,
    `the Ask Coach core stays under 17,000 characters (standard ${size.standard.chars}, swiftplay ${size.swiftplay.chars}, about ${size.standard.tokLow} to ${size.standard.tokHigh} tokens)`);
  const DASH = new RegExp('[' + String.fromCharCode(0x2013, 0x2014) + ']');
  ok(DASH.test(`a ${String.fromCharCode(0x2014)} b`) && !DASH.test('a, b'), 'the dash pattern catches a dash and passes a comma (control)');
  const SOURCE = /\b(?:wiki|weird gloop|valorant-api|patch notes?|riot|occlara)\b/i;
  ok(SOURCE.test('per the VALORANT Wiki') && !SOURCE.test('a rifle with Heavy Armor'), 'the source name pattern catches a source and passes plain text (control)');
  const patchWords = /\bpatch \d|\bversion \d/i;
  for (const [name, r] of renders) {
    if (DASH.test(r.text)) ok(false, `${name} has no em or en dash`);
    if (SOURCE.test(r.text)) ok(false, `${name} names no source`, (r.text.match(SOURCE) || [])[0]);
    if (r.text.includes(DATA.patch) || r.text.includes(String(DATA.version)) || patchWords.test(r.text)) ok(false, `${name} mentions no patch number`);
  }
  ok(true, `no dash, no source name and no patch number in any of ${renders.length} renders`);
  const CURLY = new RegExp('[' + String.fromCharCode(0x2018, 0x2019, 0x201c, 0x201d) + ']');
  const curlyData = Object.values(DATA.agents).some((a) => a.kit.some((k) => CURLY.test(k.description)));
  ok(curlyData && renders.every(([, r]) => !CURLY.test(r.text)), "Riot's curly quotes, in the synced kits, print straight in every render");
  const head = primer.renderCore('standard').text.split('\n').slice(0, 2).join(' ');
  ok(head.includes("These are the game's numbers as it is now. A match played before a patch can differ, and a number a patch has changed since that match is left out for it."),
    'the header says the numbers are the game as it is now, word for word');
  const fair = primer.renderCore('standard').text;
  ok(fair.includes('A duel is fair when the player took it from a position they should hold, at a range their gun can fight, without stepping into a second enemy; lost from there, only the shot decided it.')
    && fair.includes('Whether a teammate could trade it is a separate question, and a Duelist\'s entry with the team close behind is the role\'s job.'),
  'the fairness rule is the spec\'s, word for word');
}

// ── 7b. the playbook's own numbers ──────────────────────────────────────────
console.log("\nthe playbook's numbers, through check:playbook:");
{
  const read = (t) => primerMod.spelledNumbers(t).map((s) => s.value);
  ok(JSON.stringify(read('two taps a full shield')) === '[2]' && JSON.stringify(read('one body and one pistol shot')) === '[1,1]'
    && JSON.stringify(read('costs you a fifth bullet')) === '[5]', 'spelled numbers are read: "two taps", "one body and one pistol shot", "a fifth bullet"');
  ok(!read('so it wins the close fight and loses every long one').length && !read('without stepping into a second enemy').length
    && !read('if the first shot lands').length, 'and the pronoun "one", "a second enemy" and "the first shot" are not numbers');
  const okClaims = primerMod.noteClaims({ source: { claims: [{ weapon: 'guardian', part: 'body', armor: 'heavy', hits: 3 }, { weapon: 'outlaw', field: 'magazine', value: 2 },
    { weapon: 'phantom', part: 'body', armor: 'heavy', band: 'far', hits: 5 }] } });
  ok(!okClaims.problems.length && okClaims.values.join() === '3,2,5', 'true claims pass and cover their numbers');
  const bad = primerMod.noteClaims({ source: { claims: [{ weapon: 'guardian', part: 'body', armor: 'heavy', hits: 2 }, { weapon: 'phantom', part: 'body', armor: 'heavy', hits: 5 }] } });
  ok(bad.problems.length === 2 && /computed, it is 3/.test(bad.problems[0]) && /computed, it is 4 or 5/.test(bad.problems[1]),
    'a false claim is caught: the Guardian needs 3 body hits through Heavy Armor, the Phantom 4 near and 5 far', bad.problems.join(' | '));
  const { spawnSync } = require('child_process');
  const os = require('os');
  const run = (env) => spawnSync(process.execPath, [P('scripts', 'check-playbook.js')], { cwd: ROOT, encoding: 'utf8', env: { ...process.env, ...env } });
  const clean = run({ CHECK_PLAYBOOK_PLANT: '' });
  ok(clean.status === 0, 'check:playbook passes on the corpus as it is', (clean.stdout || '').split('\n').filter((l) => /FAIL|-/.test(l)).slice(0, 4).join(' | '));
  // The two notes as 8.4 shipped them, word for word, and a false claim.
  const plantFile = path.join(os.tmpdir(), `check-primer-plant-${process.pid}.json`);
  fs.writeFileSync(plantFile, JSON.stringify([
    { tier: 'advanced', text: 'Your rifle does 65 to the body at any range and two taps a full shield, so it punishes a long hold on a half buy.',
      weapons: ['guardian'], weight: 2, source: { kind: 'computed', topic: 'guardian flat', numbers: 'valorant-api.com damage table' } },
    { tier: 'advanced', text: 'Your sniper does 101 to the body at every range, so one body and one pistol shot is a kill and you do not need the head.',
      weapons: ['marshal'], weight: 2, source: { kind: 'computed', topic: 'marshal flat', numbers: 'valorant-api.com damage table' } },
    { tier: 'advanced', text: 'Your rifle does 65 to the body at any range, so 2 body hits kill through Heavy Armor.',
      weapons: ['guardian'], weight: 2, source: { kind: 'computed', topic: 'guardian flat', numbers: 'valorant-api.com damage table',
        claims: [{ weapon: 'guardian', part: 'body', armor: 'heavy', hits: 2 }] } },
  ]));
  const planted = run({ CHECK_PLAYBOOK_PLANT: plantFile });
  try { fs.unlinkSync(plantFile); } catch {}
  const out = planted.stdout || '';
  ok(planted.status === 1 && /says "two" \(2\)/.test(out) && /says "one" \(1\)/.test(out) && /claims 2 body hits kill Heavy Armor with the guardian; computed, it is 3/.test(out),
    'and fails the old Guardian and Marshal notes word for word, and a false claim', out.split('\n').filter((l) => /says|claims/.test(l)).slice(0, 4).join(' | '));
}

// ── 8. the live version check ───────────────────────────────────────────────
console.log('\nthe live version check, on a faked valorant-api:');
function fakeApi(raw, opts = {}) {
  return async (url) => {
    if (opts.down) throw new Error('fetch failed');
    const key = Object.entries(extractor.ENDPOINTS).find(([, u]) => u === url);
    if (!key) throw new Error(`unknown endpoint ${url}`);
    if (opts.failOn && opts.failOn === key[0]) throw new Error('HTTP 503');
    return clone(raw[key[0]]);
  };
}
(async () => {
  let t = Date.parse('2026-10-15T00:00:00Z');
  const now = () => t;
  const logs = [];
  const log = (s) => logs.push(s);
  {
    const p = primerMod.create({ now });
    const st = await p.checkLive({ fetchJson: fakeApi(RAW), now, log });
    ok(st.withheld.length === 0 && st.live.version === DATA.version && st.synced.version === DATA.version, 'the same live version withholds nothing');
    ok(p.core('standard') === primer.core('standard'), 'and the core is exactly the synced render');
    ok(st.synced && st.live && Array.isArray(st.withheld), 'liveStatus() gives { synced, live, withheld } for /api/admin');
  }
  {
    // A new patch where only the Sheriff's head hit to 30 m moved.
    const p = primerMod.create({ now });
    const raw = clone(RAW);
    raw.version = { ...raw.version, branch: 'release-13.09', version: '13.09.00.1' };
    raw.weapons.find((w) => w.displayName === 'Sheriff').weaponStats.damageRanges[0].headDamage = 160;
    logs.length = 0;
    const st = await p.checkLive({ fetchJson: fakeApi(raw), now, log });
    ok(JSON.stringify(st.withheld) === JSON.stringify(['w:sheriff:b0.head']), 'a changed Sheriff head hit is the one number withheld', JSON.stringify(st.withheld));
    const r = p.renderCore('standard');
    const line = r.text.split('\n').find((l) => l.startsWith('- Sheriff.')) || '';
    ok(!/Head\/body/.test(line) && !/Hits to kill/.test(line) && /shots a second/.test(line) && /Price 800/.test(line),
      'the Sheriff\'s damage and hits sentences go, its price and fire rate stay', line);
    ok(!/A Sheriff kills Heavy Armor with a single head hit/.test(r.text), 'and so does the matchup computed from it');
    ok(!r.provenance.some((e) => e.subject === 'Sheriff' && (e.attribute === 'head' || (e.attribute === 'hits' && e.part === 'head')) && e.band && e.band.from === 0),
      'and no number computed from it is left in the provenance');
    ok(/A Spectre needs 6 body hits/.test(r.text) && /- Vandal\. Price 2900\. Head\/body 160\/40/.test(r.text), 'every other gun is untouched');
    ok(logs.length === 1 && logs[0].includes('w:sheriff:b0.head') && logs[0].includes('13.09.00.1'), 'one log line names what is withheld', logs.join(' | '));
    await p.checkLive({ fetchJson: fakeApi(raw), now, log });
    ok(logs.length === 1, 'and it is not said again while nothing changes');
  }
  {
    // An outage: nothing answers. For a day the synced numbers stand.
    t = Date.parse('2026-10-15T00:00:00Z');
    const p = primerMod.create({ now });
    await p.checkLive({ fetchJson: fakeApi(RAW, { down: true }), now, log: quiet });
    ok(p.liveStatus().withheld.length === 0 && /- Vandal\./.test(p.core('standard')), 'an outage withholds nothing at first');
    t += 23 * HOUR;
    ok(/- Vandal\./.test(p.core('standard')), 'nor after 23 hours');
    t += 2 * HOUR;
    await p.checkLive({ fetchJson: fakeApi(RAW, { down: true }), now, log: quiet });
    const text = p.core('standard');
    const st = p.liveStatus();
    ok(!/- Vandal\./.test(text) && !/^GUNS/m.test(text) && !/^AGENTS/m.test(text) && st.live.stale && st.withheld.includes('w:'),
      'after 24 hours with no successful check the gun table and the kits are withheld');
    ok(p.kit('Jett') === '' && /CREDITS IN COMPETITIVE AND UNRATED/.test(text) && /A defuse takes 7 seconds/.test(text), 'kits too, while the stated facts stay');
    await p.checkLive({ fetchJson: fakeApi(RAW), now, log: quiet });
    ok(p.liveStatus().withheld.length === 0 && /- Vandal\./.test(p.core('standard')), 'a successful check brings them back');
  }
  {
    // The live patch differs and its data will not extract (a missing armour).
    t = Date.parse('2026-10-15T00:00:00Z');
    const p = primerMod.create({ now });
    const raw = clone(RAW);
    raw.version = { ...raw.version, branch: 'release-13.09', version: '13.09.00.2' };
    raw.gear = raw.gear.filter((g) => g.displayName !== 'Heavy Armor');
    const st = await p.checkLive({ fetchJson: fakeApi(raw), now, log: quiet });
    ok(st.live.failed && st.withheld.includes('w:') && st.withheld.includes('a:') && /extraction/.test(st.live.reason),
      'a failed extraction of a differing patch withholds the gun table and the kits at once', st.live.reason);
    ok(!/- Sheriff\./.test(p.core('standard')) && p.kit('Jett') === '', 'and they are gone from the text');
    const p2 = primerMod.create({ now });
    const st2 = await p2.checkLive({ fetchJson: fakeApi(raw, { failOn: 'weapons' }), now, log: quiet });
    ok(st2.live.failed && st2.withheld.includes('g:') && /fetched/.test(st2.live.reason), 'so does a failed fetch of a differing patch');
  }
  {
    // startLiveCheck runs at once, is idempotent, and holds no process open.
    const p = primerMod.create({ now });
    let calls = 0;
    const counting = async (url) => { calls++; return fakeApi(RAW)(url); };
    const stop = p.startLiveCheck({ fetchJson: counting, log: quiet, intervalMs: 3600 * 1000 });
    p.startLiveCheck({ fetchJson: counting, log: quiet });
    await new Promise((r) => setTimeout(r, 20));
    ok(calls === 1 && p.liveStatus().running, 'startLiveCheck checks once at once, and a second call starts nothing');
    stop();
    ok(!p.liveStatus().running, 'and stops');
  }
  {
    // WHERE IT RUNS (server.js, once listening): on Railway, which names its
    // environment on every deploy, and nowhere else unless asked; off wins
    // anywhere. The checks and tests that boot server.js and CI never call
    // valorant-api.com, and Railway's server is never left unchecked, which
    // after a day would withhold the gun table and the kits.
    const w = primerMod.liveCheckWanted;
    ok(w({ RAILWAY_ENVIRONMENT_NAME: 'production' }) && w({ RAILWAY_ENVIRONMENT: 'production' }) && w({ PRIMER_LIVE_CHECK: 'on' })
      && !w({}) && !w({ PATH: 'x', NODE_ENV: 'production' }) && !w({ RAILWAY_ENVIRONMENT_NAME: 'production', PRIMER_LIVE_CHECK: 'off' })
      && !w({ PRIMER_LIVE_CHECK: 'OFF', RAILWAY_ENVIRONMENT: 'x' }) && !w(undefined),
    'the live check runs on Railway and wherever PRIMER_LIVE_CHECK=on, never elsewhere, and PRIMER_LIVE_CHECK=off stops it anywhere');
    const serverSrc = fs.readFileSync(path.join(__dirname, '..', 'server', 'server.js'), 'utf8');
    const listen = serverSrc.slice(serverSrc.indexOf('app.listen('));
    ok(/require\('\.\/services\/game-primer'\)/.test(listen) && /liveCheckWanted\(process\.env\)\) primer\.startLiveCheck\(\)/.test(listen),
      'and server.js starts it once listening, by liveCheckWanted, never at require time');
  }

  // ── 9. the patch history and the two gates ────────────────────────────────
  console.log('\nthe patch history and the gates:');
  ok(!topics.selfCheck().length, 'every topic pattern tags its positive line and not its negative', topics.selfCheck().join('; '));
  ok(topics.CASES.length >= 15 && topics.tagsOf('Regen Shield').has('armor') && topics.tagsOf('Plant time: 4s >>> 3.5s').has('spike')
    && !topics.tagsOf('Spike Rush returns this act').has('spike') && topics.tagsOf('Buy time reduced to 25 seconds').has('timers'),
  'and its cases: a heading names its topic, a plant time is the spike\'s, Spike Rush is a mode, a buy time is a timer');
  {
    const h = PATCHES.history || [];
    ok(h.length >= 1 && h[0].patch === DATA.patch, `the history holds the synced patch ${DATA.patch}`);
    ok(PATCHES.patch === DATA.patch && Array.isArray(PATCHES.changes), "and the top level patch-context.js reads is the synced patch's");
    ok(!Object.keys(primer.statedGate()).length, 'the stated facts gate holds nothing back on the synced patch (every fact verified on it)');
    const DAY = 24 * HOUR;
    // The synced patch begins on its notes' own date, which the history keeps,
    // not on the client's build date: 13.08 was built on 1 Oct and its notes
    // came out on 13 Oct, and a match of 4 Oct was played on the patch before.
    const since = Date.parse((h[0] && h[0].date) || DATA.buildDate);
    ok(primer.patchesAfter(since + 3 * DAY) && primer.patchesAfter(since + 3 * DAY).length === 0, 'a match days after the synced patch\'s notes is on it: nothing withheld');
    ok(primer.patchesAfter(since + DAY) === null || primer.patchesAfter(since + DAY).length >= 1, 'a match a day after them counts as both patches');
    const before = h.length >= 2 && h[0].date ? primer.patchesAfter(Date.parse(h[0].date) - 3 * DAY) : null;
    // null where a patch between is missing from the history (13.07 has no
    // notes in it), which withholds everything a patch can touch: either way
    // nothing the synced patch changed is stated for that match.
    ok(h.length < 2 || !h[0].date || before === null || (Array.isArray(before) && before.length >= 1),
      'and a match days before them is on a patch before: the synced patch counts as after it, its facts withheld', JSON.stringify(before));
  }
  {
    // A synthetic history: 13.08 whole (an economy line and a Vandal line), 13.07 before it.
    const lines = [
      { line: 'Loss bonus credits for a third round lost in a row reduced', names: [] },
      { line: 'Vandal first shot spread increased slightly', names: ['Vandal'] },
      { line: 'Fixed a bug where the menu flickered', names: [] },
    ];
    const hist = {
      ...PATCHES,
      history: [
        { patch: '13.08', date: '2026-10-01T20:00:00Z', notesFound: true, linesKept: 'all', capped: false, lines },
        { patch: '13.07', date: '2026-09-17T20:00:00Z', notesFound: true, linesKept: 'all', capped: false, lines: [] },
      ],
    };
    const p = primerMod.create({ patches: hist });
    const sep20 = Date.parse('2026-09-20T12:00:00Z');
    const gate = p.matchGate(sep20);
    ok(gate.includes('s:credits.loss') && gate.includes('s:credits.win') && gate.includes('w:vandal:') && !gate.includes('s:spike.defuse') && !gate.includes('s:'),
      'a match before 13.08 loses the economy facts and the Vandal 13.08 touched, and keeps the spike', gate.join(', '));
    const text = p.core('standard', { matchAt: sep20 });
    ok(!/A loss pays 1900/.test(text) && /A run of losses pays more each round/.test(text) && !/- Vandal\./.test(text) && /A defuse takes 7 seconds/.test(text) && /- Phantom\./.test(text),
      'its core says the economy in words, has no Vandal line, and keeps the spike and every other gun');
    const oct2 = Date.parse('2026-10-02T12:00:00Z');
    ok(JSON.stringify(p.matchGate(oct2)) === JSON.stringify(gate), 'a match within 48 hours after 13.08 counts as both patches');
    ok(p.matchGate(Date.parse('2026-10-05T00:00:00Z')).length === 0, 'a match on 13.08 loses nothing');
    const sep1 = Date.parse('2026-09-01T00:00:00Z');
    // Every stated fact a patch can touch is one with a topic; Occlara's own
    // rules carry none and stay, as the deploy gate keeps them.
    const TOUCHABLE = Object.keys(RULES.facts).filter((id) => RULES.facts[id].tags.length).map((id) => `s:${id}`).sort();
    const OWN = Object.keys(RULES.facts).filter((id) => !RULES.facts[id].tags.length);
    ok(OWN.length >= 3 && OWN.every((id) => RULES.facts[id].kind === 'occlara'), `Occlara's own rules are the facts with no topic (${OWN.join(', ')})`);
    ok(JSON.stringify(p.matchGate(sep1)) === JSON.stringify(TOUCHABLE), 'a match older than the history loses every stated fact a patch can touch');
    const old = p.core('standard', { matchAt: sep1 });
    ok(!/A defuse takes 7 seconds/.test(old) && /A defuse keeps its progress once it passes the halfway mark/.test(old) && /- Vandal\./.test(old),
      'said in words, while the synced guns stay (as the game is now)');
    ok(/within 5 seconds/.test(old) && /within the first 30 seconds/.test(old) && /is 3 kills or more/.test(old),
      "and Occlara's own rules, the trade, the early death and the multi kill, stay for it: the review it was graded by says them");
    const named = { ...hist, history: [{ ...hist.history[0], linesKept: 'named' }, hist.history[1]] };
    const gNamed = primerMod.create({ patches: named }).matchGate(sep20);
    ok(TOUCHABLE.every((k) => gNamed.includes(k)) && !gNamed.some((k) => OWN.includes(k.slice(2))),
      'notes of a later patch kept only in part withhold every stated fact a patch can touch');
    // The stated facts gate: facts verified on 13.07, synced on 13.08.
    const rules = clone(RULES);
    for (const f of Object.values(rules.facts)) f.verifiedPatch = '13.07';
    const g1 = primerMod.create({ rules, patches: hist }).statedGate();
    ok(g1['credits.loss'] && g1['credits.win'] && !g1['spike.defuse'] && !g1['rule.tradeSeconds'],
      'facts verified on 13.07 are held where 13.08 tags their topic, and only there', Object.keys(g1).join(', '));
    ok(!/A win pays 3000/.test(primerMod.create({ rules, patches: hist }).core('standard')), 'and the held ones are said in words');
    const g2 = primerMod.create({ rules, patches: { ...hist, history: [{ ...hist.history[0], lines: [] }, hist.history[1]] } }).statedGate();
    ok(!Object.keys(g2).length, 'with 13.08 found whole and no line on their topics they pass');
    const g3 = primerMod.create({ rules, patches: named }).statedGate();
    ok(g3['credits.win'] && g3['spike.defuse'], 'with 13.08 kept only in part every tagged fact is held');
    const g4 = primerMod.create({ rules, patches: { ...hist, history: [hist.history[1]] } }).statedGate();
    ok(g4['spike.defuse'] && /not in the history/.test(g4['spike.defuse']), 'with no notes for the synced patch at all every tagged fact is held');
    // A hole: 13.07 missing between 13.08 and 13.06.
    const holed = { ...hist, history: [hist.history[0], { patch: '13.06', date: '2026-09-03T20:00:00Z', notesFound: true, linesKept: 'all', capped: false, lines: [] }] };
    const ph = primerMod.create({ patches: holed });
    ok(ph.patchesAfter(Date.parse('2026-09-10T00:00:00Z')) === null && JSON.stringify(ph.matchGate(Date.parse('2026-09-10T00:00:00Z'))) === JSON.stringify(TOUCHABLE),
      'a hole in the history above a match is a patch nobody read: every stated fact a patch can touch is withheld');
    const rules6 = clone(RULES);
    for (const f of Object.values(rules6.facts)) f.verifiedPatch = '13.06';
    const g5 = primerMod.create({ rules: rules6, patches: { ...holed, history: [{ ...hist.history[0], lines: [] }, holed.history[1]] } }).statedGate();
    ok(g5['spike.defuse'] && /between 13\.06 and 13\.08/.test(g5['spike.defuse']), 'and facts verified on 13.06 are held when 13.07 is missing, though 13.08 is clean');
    // Riot's own patch for the match (Phase D's game_version).
    ok(JSON.stringify(p.patchesAfterPatch('13.07')) === '["13.08"]' && JSON.stringify(p.matchGate(undefined, '13.07')) === JSON.stringify(gate),
      "a match placed by Riot's patch, 13.07, loses what 13.08 touched, as one placed by its date");
    ok(JSON.stringify(p.patchesAfterPatch('13.08')) === '[]' && p.patchesAfterPatch('13.05') === null,
      'on the synced patch it loses nothing, and from a patch the history does not reach it is unknown');
    const gap = primerMod.create({ patches: { ...hist, history: [hist.history[0], { ...hist.history[1], patch: '13.05' }] } });
    ok(gap.patchesAfterPatch('13.05') === null, "a match on 13.05 with 13.06 and 13.07 missing is unknown, though 13.05 itself is kept");
    // Across a major only its X.00 follows the last major's patch: 14.01 over
    // 13.08 is 14.00 missing, and 14.00 is where the systems change.
    const d14 = clone(DATA); d14.patch = '14.01'; d14.version = '14.01.00.1'; d14.buildDate = '2026-11-20T00:00:00Z';
    const e = (patch, date) => ({ patch, date, notesFound: true, linesKept: 'all', capped: false, lines: [] });
    const no14 = { ...hist, history: [e('14.01', '2026-11-20T00:00:00Z'), e('13.08', '2026-10-01T20:00:00Z')] };
    const with14 = { ...hist, history: [e('14.01', '2026-11-20T00:00:00Z'), e('14.00', '2026-11-05T00:00:00Z'), e('13.08', '2026-10-01T20:00:00Z')] };
    const oct10 = Date.parse('2026-10-10T00:00:00Z');
    const pNo = primerMod.create({ data: d14, patches: no14 });
    const pWith = primerMod.create({ data: d14, patches: with14 });
    ok(pNo.patchesAfter(oct10) === null && JSON.stringify(pWith.patchesAfter(oct10)) === '["14.01","14.00"]',
      'across a major, 14.01 straight over 13.08 is a hole (14.00 missing), and 14.01, 14.00, 13.08 is none');
    ok(pNo.statedGate()['spike.defuse'] && !Object.keys(pWith.statedGate()).length && pNo.patchesAfterPatch('13.08') === null,
      'so facts verified on 13.08 are held on a synced 14.01 until 14.00 is read, and a match on 13.08 is unknown');
  }
  {
    const both = primer.renderCore('standard', { guns: false, roster: true }).text;
    const none = primer.renderCore('standard', { guns: false }).text;
    ok(/^AGENTS/m.test(both) && !/^GUNS/m.test(both) && !/^AGENTS/m.test(none) && !/^GUNS/m.test(none),
      'the gun table can go to slices with the roster kept, and the review drops both');
  }
  {
    // The patch sync's own pieces, offline.
    const old = { patch: '13.08', buildDate: '2026-10-01T20:58:39Z', notesFound: true, source: 'x', changes: [{ type: 'weapon', names: ['Warden'], line: 'Fix for Warden scope reticle misalignment' }] };
    const up = patchSync.upgrade(old);
    ok(up.history.length === 1 && up.history[0].linesKept === 'named' && up.history[0].lines[0].names[0] === 'Warden' && up.patch === '13.08' && up.changes === old.changes,
      'upgrade keeps the old fields and makes the patch a history entry, named lines only');
    const merged = patchSync.mergeHistory(Array.from({ length: 12 }, (_, i) => ({ patch: `13.${String(i + 1).padStart(2, '0')}`, lines: [] })),
      [{ patch: '13.13', lines: [1] }, { patch: '13.05', lines: [2] }]);
    ok(merged.length === 12 && merged[0].patch === '13.13' && !merged.some((e) => e.patch === '13.01') && merged.find((e) => e.patch === '13.05').lines[0] === 2,
      'mergeHistory keeps the newest 12 and replaces a patch fetched again');
    const page = '<html><head><meta name="description" content="The definitive source on all updates coming to the game.">'
      + '<script type="application/ld+json">{"datePublished":"2026-09-30T17:00:00.000Z"}</script></head><body>'
      + '<ul><li>Loss bonus credits for the second round lost in a row increased</li><li>Vandal fire rate reduced from 9.75 to 9.5</li><li>Iso</li></ul>'
      + '<a href="/en-us/news/game-updates/valorant-patch-notes-13-07/">x</a><a href="/en-us/news/game-updates/valorant-patch-notes-12-11/">y</a></body></html>';
    const notes = patchSync.notesFromHtml(page, { agents: ['Iso'], weapons: ['Vandal'], maps: [] });
    ok(notes.lines.length === 4 && notes.lines[0].names.length === 0 && notes.changes.length === 1 && notes.changes[0].names[0] === 'Vandal',
      'every line goes to the history, a line naming nothing included; only named ones to the old changes');
    ok(notes.lines.some((l) => l.line === 'Iso' && l.names[0] === 'Iso') && notes.substantive === 2,
      'a bare heading goes to the history too ("Iso", which names the agent), and only lines of five words or more count as notes read');
    // Riot writes a change as a heading and short lines under it, and only the
    // heading names its topic: 9.10's Regen Shield was "Regen Shield" over
    // "Damage Absorption: 25 HP". The history keeps both, and a long paragraph,
    // where the prompt's changes keep the five word to 240 character lines.
    const essay = 'We heard your feedback about rounds that felt unwinnable after a lost pistol round, so the credits a team receives '
      + 'after losing a round go up, which should make the second round of each half more competitive and give the losing team a real buy.';
    const riot = '<html><head><script type="application/ld+json">{"datePublished":"2026-10-14T17:00:00.000Z"}</script></head><body>'
      + '<h2>GAMEPLAY SYSTEMS UPDATES</h2><ul><li><strong>Regen Shield</strong><ul><li>Damage Absorption: 25 HP >>> 30 HP</li></ul></li></ul>'
      + '<h3>Spike</h3><ul><li>Plant time: 4s >>> 3.5s</li></ul><p>' + essay + '</p>'
      + '<ul><li>Vandal fire rate reduced from 9.75 to 9.5</li></ul></body></html>';
    const rn = patchSync.notesFromHtml(riot, { agents: [], weapons: ['Vandal'], maps: [] });
    const has = (s) => rn.lines.some((l) => l.line === s);
    ok(has('Regen Shield') && has('Damage Absorption: 25 HP >>> 30 HP') && has('Spike') && has('Plant time: 4s >>> 3.5s') && has(essay) && essay.length > 240,
      'the history keeps the short lines under a heading, the heading, and a paragraph past 240 characters', JSON.stringify(rn.lines.map((l) => l.line)).slice(0, 300));
    ok(rn.changes.length === 1 && rn.changes[0].line === 'Vandal fire rate reduced from 9.75 to 9.5', "while the prompt's changes keep only what they always kept");
    const chrome = patchSync.notesFromHtml('<html><body><ul><li>Sign in</li><li>Play free</li><li>Spike Rush</li></ul></body></html>', { agents: [], weapons: [], maps: [] });
    ok(chrome.lines.length === 3 && chrome.substantive === 0, 'a page of nothing but short chrome is no notes read (substantive 0)');
    const eChrome = patchSync.historyEntry('13.09', chrome, 'u', '2026-10-14T17:00:00Z', 'article');
    const eRiot = patchSync.historyEntry('13.09', rn, 'u', rn.date, 'article');
    ok(!eChrome.notesFound && eRiot.notesFound && eRiot.linesKept === 'all' && eRiot.lines === rn.lines && eRiot.date === rn.date
      && !patchSync.historyEntry('13.07', null, null, null, null).notesFound,
    'and its history entry says no notes found, so the gates withhold what that patch could touch; a page with notes, or none at all, is entered as it was read');
    // Those lines as the synced patch's notes, facts verified on the patch before.
    const d9 = clone(DATA); d9.patch = '13.09'; d9.version = '13.09.00.1';
    const h9 = { ...PATCHES, history: [{ patch: '13.09', date: '2026-10-14T17:00:00Z', notesFound: rn.substantive > 0, linesKept: 'all', capped: false, lines: rn.lines },
      { ...PATCHES.history[0], linesKept: 'all' }] };
    const g9 = primerMod.create({ data: d9, patches: h9 }).statedGate();
    ok(g9['armor.regen.capacity'] && g9['spike.plant'] && g9['spike.defuse'] && g9['credits.win'] && !g9['round.seconds'] && !g9.health,
      "so a 13.09 that moved the shield, the plant and the pay withholds the shield's 25, the spike and the economy, and nothing it did not touch", Object.keys(g9).join(', '));
    ok(notes.date === '2026-09-30T17:00:00.000Z' && patchSync.dateOf('<p>no date here</p>') === null, 'the article date is read, and none is invented');
    ok(JSON.stringify(patchSync.slugsFromIndex(page)) === JSON.stringify(['13.07', '12.11']) && patchSync.slugsFromIndex('<a href="/x/">').length === 0,
      "the index's patches are read newest first, and a page with none gives none");
  }

  // ── 10. where it goes ─────────────────────────────────────────────────────
  console.log('\nwhere the primer goes, and never:');
  {
    const files = [];
    const walk = (dir) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
        const f = path.join(dir, e.name);
        if (e.isDirectory()) walk(f); else if (/\.js$/.test(e.name)) files.push(f);
      }
    };
    walk(P('server'));
    walk(P('src'));
    const RE = /require\(\s*['"][^'"]*game-primer(?:\.js)?['"]\s*\)/;
    ok(RE.test("const p = require('./game-primer');") && !RE.test("const p = require('./knowledge');"), 'the require pattern finds a require of the primer and nothing else (control)');
    const users = files.filter((f) => RE.test(fs.readFileSync(f, 'utf8'))).map((f) => path.relative(ROOT, f).replace(/\\/g, '/'));
    ok(!users.some((f) => f.startsWith('src/')), 'no client file requires it', users.join(', '));
    ok(!users.includes('server/services/read-prompt.js'), 'the live read\'s prompt never requires it');
    const coach = fs.readFileSync(P('server', 'routes', 'coach.js'), 'utf8');
    const readRoute = coach.slice(coach.indexOf("router.post('/read'"), coach.indexOf("router.post('/read'") + 4000);
    ok(coach.indexOf("router.post('/read'") > 0 && !/game-primer|primer\./.test(readRoute), 'nor does the live read\'s route use it');
    ok(!users.some((f) => /\blol\b|league/i.test(f)), 'nor anything of League');
    console.log(`      required by: ${users.join(', ') || 'nothing yet'}`);
  }

  console.log(`\n${fails ? `FAIL: ${fails} of ${checks} checks failed` : `PASS: all ${checks} primer checks passed`}`);
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.log(`FAIL  check:primer crashed: ${e.stack}`); process.exit(1); });
