'use strict';

/**
 * server/services/ability-facts.js: the kit table and the claims that
 * contradict it.
 *
 *   1. The table is the data's: every agent's four keyed abilities, Killjoy's
 *      Alarmbot on Q and Nanoswarm on C, Omen's Paranoia a blind and no wall.
 *   2. The false claims the round 3 audit caught in real answers are found:
 *      "Alarmbot (C)", "Nanoswarm (Q)", "the alarmbot reveals and slows",
 *      "Paranoia sends a vision-blocking shadow".
 *   3. True sentences are never flagged: the audit's own true kit lines, and
 *      at least 200 sentences generated from the data itself, every key,
 *      owner, ultimate and effect as the data has them.
 *   4. The same generated sentences with one thing made false (the key, the
 *      owner, the effect, the ultimate) are all flagged.
 *   5. The near misses: a C that is a site, a negation, an English word that
 *      is also a name, a verb whose subject is something else.
 *   6. checkState: standings held to a round's record only where the record
 *      has them, HP numbers no fact states, hypotheticals left alone.
 *   7. The source carries no backspace byte (CLAUDE.md, the shell regex hazard).
 *
 * Run: npm run test:abilityfacts
 */
const fs = require('fs');
const path = require('path');
const af = require('../server/services/ability-facts');

let failed = 0;
let passed = 0;
function ok(cond, what) {
  if (cond) passed++;
  else { failed++; console.log(`FAIL  ${what}`); }
}
const kinds = (t, o) => af.checkText(t, o).map((c) => `${c.kind}:${c.ability}:${c.said}`);

// ── 1. The table ──────────────────────────────────────────────────────────
const T = af.TABLE;
const DATA = require('../server/valorant-data.generated.json');
ok(Object.keys(T.agents).length === Object.keys(DATA.agents).length, 'every agent is in the table');
for (const [agent, kit] of Object.entries(T.agents)) {
  const keys = Object.values(kit).map((e) => e.key).sort().join('');
  ok(keys === 'CEQX', `${agent} has C, E, Q and X (${keys})`);
}
const kj = Object.fromEntries(Object.values(T.agents.Killjoy).map((e) => [e.name.toLowerCase(), e]));
ok(kj.alarmbot.key === 'Q' && kj.nanoswarm.key === 'C' && kj.turret.key === 'E' && kj.lockdown.key === 'X', 'Killjoy keys are the data\'s');
ok(kj.alarmbot.classes.includes('vulnerable') && !kj.alarmbot.classes.includes('slow'), 'Alarmbot applies vulnerable and does not slow');
const omen = Object.fromEntries(Object.values(T.agents.Omen).map((e) => [e.name.toLowerCase(), e]));
ok(omen.paranoia.classes.includes('blind') && !omen.paranoia.classes.includes('vision'), 'Paranoia blinds and is no wall');
ok(omen['dark cover'].classes.includes('vision'), 'Dark Cover is a smoke');
for (const [n, es] of T.byName) ok(es.length === 1, `ability name ${n} is one agent's`);

// ── 2. The audit's false claims ───────────────────────────────────────────
const AUDIT_FALSE = [
  ['Her Turret (E) and Alarmbot (C) are the two things that punish a Jett who moves first.', ['key:ALARMBOT:C']],
  ['The turret watches an angle and shoots when you cross it, and the alarmbot reveals and slows anyone who walks into its range.', ['effect:ALARMBOT:reveals', 'effect:ALARMBOT:slows']],
  ['Her Nanoswarm (Q) is the one that catches a Jett who dashes onto site and stops.', ['key:Nanoswarm:Q']],
  ['He is a Controller, and his kit is built to blind and to arrive where you are not looking: Paranoia sends a vision-blocking shadow through walls, Shrouded Step teleports him a short way, Dark Cover drops smokes.', ['effect:Paranoia:vision-blocking']],
];
for (const [t, want] of AUDIT_FALSE) {
  const got = kinds(t).sort();
  ok(JSON.stringify(got) === JSON.stringify([...want].sort()), `audit false claim found: ${t.slice(0, 60)} -> ${got.join(', ')}`);
}
ok(kinds('C Alarmbot goes on the flank.').includes('key:ALARMBOT:C'), 'a C before the name opening the sentence is a key');
ok(kinds('Her Alarmbot is her C, so clear it first.').includes('key:ALARMBOT:C'), '"Alarmbot is her C" is a key');
ok(kinds('Omen\'s Alarmbot is on the flank.').some((k) => k.startsWith('owner:ALARMBOT')), 'Omen credited with an Alarmbot');
ok(kinds('As Raze, your Trapwire is the tool.').some((k) => k.startsWith('owner:Trapwire')), '"As Raze, your Trapwire"');
ok(kinds('Her ultimate, Turret, wins the site.').some((k) => k.startsWith('ultimate:TURRET')), 'Turret called an ultimate');
ok(kinds('Alarmbot slows you.').includes('effect:ALARMBOT:slows'), '"Alarmbot slows"');
ok(kinds('Paranoia blocks your vision for a moment.').includes('effect:Paranoia:blocks your vision'), '"Paranoia blocks vision"');

// ── 3. The audit's own true kit lines ─────────────────────────────────────
const AUDIT_TRUE = [
  'Devour (Q) heals her off an orb, Dismiss (E) makes her intangible off an orb, and she only gets an orb from an enemy she damaged or killed.',
  'And when she pops Empress (X), she gets endless orbs and permanent overheal, so at that point you do not duel her at all.',
  'Every kill or damage she does on you leaves a Soul Orb, and Devour on Q turns that orb into health.',
  'Dismiss on E lets her leave a fight she is losing, so a duel you half win still ends with her alive.',
  'Leer on C blinds anyone looking at it, which punishes a player holding an angle alone with no one to call it out.',
  'His Trapwire C catches you crossing a doorway or a flank, and a caught player is a dead player.',
  'His Spycam E watches an angle and marks you, and his Cyber Cage Q blocks your view of him while he holds.',
  'As Raze, your Boom Bot C is free information.',
  'Her Gravity Well C pulls you to one spot and makes you take more damage there, her Nova Pulse Q stuns anyone caught in it, and her Nebula E drops a smoke she can place anywhere she has a Star.',
  'Astra places Stars in Astral Form and turns them into Nebula smokes on E, so the angle you are holding can be smoked off.',
  'She can also drop a Gravity Well on C to pull you out of cover and make you vulnerable, or a Nova Pulse on Q to concuss you.',
  'Your Undercut (Q) is the tool here, thrown through the wall before you swing, because it suppresses and makes him vulnerable.',
  'Her Lockdown (X) is a big circle you can walk out of, so if it goes up, leave the area rather than fight inside it.',
  'If the enemy keeps holding a site behind traps and cameras, consider Raze: Paint Shells and an armed Blast Pack can destroy destructible sentinel utility such as Cypher trapwires, Killjoy alarmbots and turrets.',
];
for (const t of AUDIT_TRUE) ok(kinds(t, { agents: ['Raze'] }).length === 0, `true audit line passes: ${t.slice(0, 60)} -> ${kinds(t).join(', ')}`);

// ── 4. Generated sentences, true and made false ───────────────────────────
const VERB = {
  slow: 'slows', blind: 'blinds', damage: 'damages', reveal: 'reveals', heal: 'heals', vision: 'blocks vision',
  concuss: 'concusses', suppress: 'suppresses', teleport: 'teleports', detain: 'detains', decay: 'decays',
  deafen: 'deafens', pull: 'pulls enemies', intangible: 'makes her intangible', vulnerable: 'makes enemies vulnerable',
};
const KEYS = ['C', 'Q', 'E', 'X'];
const agents = Object.keys(T.agents);
const trues = [];
const falses = [];
agents.forEach((agent, ai) => {
  const other = agents[(ai + 7) % agents.length];
  for (const e of Object.values(T.agents[agent])) {
    const wrongKey = KEYS[(KEYS.indexOf(e.key) + 1) % 4];
    trues.push(`${agent}'s ${e.name} (${e.key}) is strong on this map.`);
    falses.push([`${agent}'s ${e.name} (${wrongKey}) is strong on this map.`, 'key']);
    trues.push(`Watch for ${e.name} on ${e.key} when they push.`);
    trues.push(`${e.key} ${e.name} is the first thing ${agent} uses.`);
    falses.push([`${wrongKey} ${e.name} is the first thing ${agent} uses.`, 'key']);
    trues.push(`As ${agent}, your ${e.name} is the tool.`);
    falses.push([`${other}'s ${e.name} is coming.`, 'owner']);
    if (e.ultimate) {
      trues.push(`${agent}'s ultimate, ${e.name}, changes the round.`);
    } else {
      falses.push([`${agent}'s ultimate, ${e.name}, changes the round.`, 'ultimate']);
    }
    for (const c of e.classes) if (VERB[c]) trues.push(`The ${e.name} ${VERB[c]} quickly.`);
    const wrong = Object.keys(VERB).find((c) => !e.classes.includes(c)
      // the near synonyms are left out, so a made false effect is false for certain
      && !(c === 'blind' && e.classes.includes('vision'))
      && !(c === 'vision' && e.classes.includes('blind'))
      && !(c === 'damage' && e.classes.includes('decay')));
    if (wrong) falses.push([`The ${e.name} ${VERB[wrong]} quickly.`, 'effect']);
  }
});
ok(trues.length >= 200, `at least 200 true sentences (${trues.length})`);
let trueFlagged = 0;
for (const t of trues) {
  const got = af.checkText(t);
  if (got.length) { trueFlagged++; if (trueFlagged < 15) console.log(`  true flagged: ${t} -> ${got.map((c) => `${c.kind}:${c.said}`).join(', ')}`); }
}
ok(trueFlagged === 0, `no generated true sentence is flagged (${trueFlagged} were)`);
let falseMissed = 0;
for (const [t, kind] of falses) {
  if (!af.checkText(t).some((c) => c.kind === kind)) { falseMissed++; if (falseMissed < 15) console.log(`  false missed: ${t} (${kind})`); }
}
ok(falseMissed === 0, `every generated false sentence is flagged (${falseMissed} of ${falses.length} missed)`);

// ── 5. Near misses ────────────────────────────────────────────────────────
const NEAR = [
  'Throw your Nanoswarm C site default so the plant is denied.',
  'Put an Alarmbot on C and play off it.',
  "Killjoy's C turret watched you cross.",
  'The Alarmbot does not slow you, it makes you vulnerable.',
  'Go with the flow and run it back next round.',
  'A double tap to the head ends it.',
  'Throw Nanoswarm where the drone reveals them.',
  'Hold the angle with Paranoia ready, and when Sova reveals them, swing.',
  'Your team will run it back from the shadows of B main.',
  'Dismiss the idea that aim is the only problem.',
  'Alarmbot on C site catches the rotate.',
  'The Turret (E) shoots at anyone who crosses its line.',
];
for (const t of NEAR) ok(kinds(t).length === 0, `near miss passes: ${t} -> ${kinds(t).join(', ')}`);

// keyTied directly, on known strings.
ok(af.keyTied('Alarmbot (C) is up', 0, 8) === 'C', 'keyTied reads (C)');
ok(af.keyTied('Alarmbot C site', 0, 8) === null, 'keyTied leaves C site');
ok(af.keyTied('Devour on Q turns', 0, 6) === 'Q', 'keyTied reads on Q');
ok(af.keyTied('Q Alarmbot', 2, 10) === 'Q', 'keyTied reads a key before');
ok(af.keyTied('push to Q Alarmbot', 10, 18) === null, 'a key after a place word is no key');

// ── 6. checkState ─────────────────────────────────────────────────────────
const rounds = new Map([
  [3, { n: 3, standings: [[5, 5], [4, 5], [4, 4], [3, 4]], atDeath: [3, 4], after: [2, 4] }],
  [6, { n: 6, alive: { mates: 2, enemies: 2 } }],
]);
const facts = { rounds, mode: 'Competitive', patterns: ['stayed on the angle with 57 health'] };
const st = (t, f = facts) => af.checkState(t, f).map((c) => `${c.kind}:${c.said}`);
ok(st('In round 3 your team went 5 against 3 on B.').includes('standing:5 against 3'), 'a standing the round never had');
ok(st('In round 3 it was 4 against 4 when you swung.').length === 0, 'a standing the round had');
ok(st('In round 3 they were 4 against 3 after the trade.').length === 0, 'either side first');
ok(st('Round 3: you died at 3 against 4. Your team was then five against three.').includes('standing:five against three'), 'a round carried within the paragraph');
ok(st('If you are ever 4 against 2 in round 3, slow down.').length === 0, 'a hypothetical is left alone');
ok(st('In round 6 your team went 4 against 2.').length === 0, 'a round without standings judges nothing');
ok(st('Your team went 4 against 2 there.').length === 0, 'no round named, no asked round: nothing');
ok(st('Your team went 5 against 3 there.', { ...facts, round: 3 }).includes('standing:5 against 3'), 'the asked round is the default');
ok(st('In round 3 it was 6 against 5.').includes('standing:6 against 5'), 'six a side is never a standing');
ok(st('It was 6 against 5.', { mode: 'Deathmatch' }).length === 0, 'deathmatch is not five a side');
ok(st('In round 3 you won the 5v3.').some((c) => c === 'standing:5v3'), 'NvM read when a round is named');
ok(st('Practise your 1v1s in the range.').length === 0, 'NvM with no round is left alone');
ok(st('In round 3 you were left alone against 3.').includes('standing:alone against 3'), 'alone against 3 never happened');
ok(st('ROUND 6: When you are low on health, fall back, because another fight is especially risky at 11 HP.').includes('hp:at 11 HP'), 'the audit\'s invented 11 HP');
ok(st('In round 2 you stayed on the same spot at 57 health.').length === 0, 'an HP number the facts state');
ok(st('Their Jett was on 30 HP when you peeked.').includes('hp:on 30 HP'), 'an enemy HP no fact states');
ok(st('Fall back when you drop to 30 hp and let the team take it.').length === 0, 'generic player advice with no round is left alone');
ok(st('A Sheriff kills Light Armor with one head hit, so at 100 HP you are still in danger.').length === 0, 'game constants pass');
ok(st('If an enemy is at 40 health, swing.').length === 0, 'a hypothetical HP is left alone');
ok(af.checkState('Their Jett was on 30 HP.', null).length === 0, 'no facts, no HP claim');
ok(af.hpNumbersIn({ rounds: [{ look: { better: 'with 57 health' } }, { hp: 42 }] }).has(57), 'hpNumbersIn reads text');
ok(af.hpNumbersIn({ rounds: [{ hp: 42 }] }).has(42), 'hpNumbersIn reads an hp field');

// ── 7. No backspace byte in the source ────────────────────────────────────
for (const f of ['server/services/ability-facts.js', 'scripts/test-ability-facts.js']) {
  const buf = fs.readFileSync(path.join(__dirname, '..', f));
  ok(!buf.includes(8), `${f} carries no backspace byte`);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
