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
 *   8. The 8.7.7 re-audit's kit claims, the death look's own "use undercut to
 *      check the angle" among them, Neural Theft "a single still", the Boom
 *      Bot setting off wires, found, its true lines and near misses passed,
 *      and a use and a reveal count generated for every ability in the data.
 *   9. kitLine, kitLines and kitBlock: four lines an agent in the data's own
 *      words, nothing it does lost, no dash, no semicolon, no word a name.
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

// ── 8. The re-audit's kit claims, the death look's own among them ─────────
// Verbatim from the 8.7.7 re-audit's items (items-after.json, items.json):
// the look's better play, the chat answers that copied it, the Boom Bot and
// Neural Theft lines. The Neural Theft line names no ability: "his ultimate"
// is the asked agent's, given as ultOf.
const REAUDIT_FALSE = [
  ['Hold beside cover and use undercut to check the angle before moving into the open.', { agents: ['Iso'] }, 'effect:Undercut:check'],
  ['To fix this, hold beside cover and use Undercut to check the angle before moving into the open.', { agents: ['Iso'] }, 'effect:Undercut:check'],
  ["Track where their Omen likes to play each round, then fight him with a teammate who can see the same angle or after you've used Undercut to check it, never alone and never from the same spot twice.", { agents: ['Iso'] }, 'effect:Undercut:check'],
  ['Send your Boom Bot ahead of you through the entrance: it is free information and it clears the close corner a tripwire sits in, and it can set the wire off for you.', { agents: ['Raze'] }, 'effect:Boom Bot:set the wire off'],
  ['His ultimate, by contrast, is a single still.', { ultOf: 'Cypher' }, 'count:Neural Theft:a single still'],
  ['When his camera dart hits you, get behind cover first and pull it out after, because that dart keeps taking new pictures of wherever you stand until you remove it; his ultimate, by contrast, is a single still.', { ultOf: 'Cypher' }, 'count:Neural Theft:a single still'],
  ['The turret watches an angle and shoots when you cross it, and the alarmbot reveals and slows anyone who walks into its range.', {}, 'effect:ALARMBOT:slows'],
  ['He is a Controller, and his kit is built to blind and to arrive where you are not looking: Paranoia sends a vision-blocking shadow through walls, Shrouded Step teleports him a short way, Dark Cover drops smokes.', {}, 'effect:Paranoia:vision-blocking'],
  // The audit's typical phrasings, as the look and the chat write them.
  ['Undercut checks the angle for you.', {}, 'effect:Undercut:checks'],
  ['Use Undercut to scout the site before you swing.', {}, 'effect:Undercut:scout'],
  ['Your Undercut gives you information on who is holding.', {}, 'effect:Undercut:gives you information'],
  ['Undercut can clear the corner for you.', {}, 'effect:Undercut:clear'],
  ["Cypher's ultimate is a single still.", {}, 'count:Neural Theft:a single still'],
  ['Neural Theft reveals you once.', {}, 'count:Neural Theft:reveals you once'],
  ['Neural Theft is one snapshot, so move after it.', {}, 'count:Neural Theft:one snapshot'],
  ['The Boom Bot triggers trip wires before you walk in.', {}, 'effect:Boom Bot:triggers trip wires'],
  ['Send the Boom Bot to trip the wires first.', {}, 'effect:Boom Bot:trip the wires'],
  ['Use the Boom Bot to find tripwires.', {}, 'effect:Boom Bot:find tripwires'],
  ['Send your Boom Bot first so it trips the wires before you walk in.', {}, 'effect:Boom Bot:trips the wires'],
  ['The Alarmbot slows you.', {}, 'effect:ALARMBOT:slows'],
  ['An Alarmbot can slow you down in the doorway.', {}, 'effect:ALARMBOT:slow'],
  ['Paranoia blocks your vision for a moment.', {}, 'effect:Paranoia:blocks your vision'],
  ['Use Paranoia to smoke off the angle.', {}, 'effect:Paranoia:smoke off'],
  ['The Turret reloads after a burst.', {}, 'effect:TURRET:reloads'],
  ['Nanoswarm (Q) catches the plant.', {}, 'key:Nanoswarm:Q'],
  ['Use your Nanoswarm (Q) to deny the plant.', {}, 'key:Nanoswarm:Q'],
  ['Throw the Alarmbot (C) to check the flank.', {}, 'key:ALARMBOT:C'],
];
for (const [t, o, want] of REAUDIT_FALSE) ok(kinds(t, o).includes(want), `re-audit false claim found: ${t.slice(0, 60)} -> ${kinds(t, o).join(', ') || 'nothing'}`);
ok(kinds('His ultimate, by contrast, is a single still.').length === 0, '"his ultimate" with nobody to tie it to judges nothing');

const REAUDIT_TRUE = [
  // The re-audit's own lines the judges called right.
  'His Spycam marks you if it sees you, so before you commit to a lane, look up at the usual camera spots on the wall and shoot it, because a marked player gets pre-aimed.',
  'If an Alarmbot reaches you it makes you take extra damage and does not slow you, so shoot it if it is right beside you, otherwise step straight back out of the entrance.',
  'Her turret and Alarmbot watch a lane for her, so on attack do not walk into a site entrance first and alone.',
  'Send one piece of space at a time: step to the edge of the entrance, let the turret fire or the Alarmbot start moving, then shoot the turret from cover or step back out of the Alarmbot\'s reach and come in again with a teammate beside you.',
  'Paint Shells and an armed Blast Pack destroy destructible sentinel utility such as Cypher trapwires, Killjoy alarmbots and turrets, Deadlock sensors or Vyse razorvine, and the Boom Bot checks a close corner before a body has to.',
  'Every enemy she damages or kills leaves a Soul Orb, and Devour turns one into healing with the extra becoming overheal, while Dismiss turns one into a moment where she cannot be hit.',
  'When you do fight him, use Undercut first so he is suppressed and vulnerable, then take the duel with someone behind you.',
  'On Iso, Undercut thrown through the wall before you peek makes that first duel easier, but it does not replace having someone behind you.',
  // Near misses of the new claims.
  'Use your Recon Bolt to check the angle before you swing.',
  'Send your Boom Bot to check the close corner.',
  'Use Undercut to make him vulnerable before you swing.',
  'Neural Theft snapshots living enemies twice.',
  'Neural Theft reveals everyone twice, so a single still is not the end of it.',
  'Once Neural Theft goes off, move.',
  'Throw Paranoia through the smoke, and it nearsights anyone holding.',
  'Use Paranoia to blind the angle.',
  'Use Dark Cover to block their vision.',
  'Do not use Undercut to check the angle, it gives no information.',
  'Paint Shells clears the corner.',
  'Use Paint Shells to clear the corner.',
  'Use Owl Drone to clear the corner.',
  'Throw your Nanoswarm on the spike so it deals damage to the defuser.',
  'Place your Trapwire on the flank, and it reveals anyone who walks in.',
  'Use Cloudburst to smoke off the angle.',
  'Use Flashpoint to flash the site.',
  'Use Sky Smoke to block the line of sight.',
  'Trip wires you cannot see from open ground, so on attack let the Boom Bot go first into the close corners you would otherwise walk into blind.',
  'Use the flow of the round to decide, and use the range to warm up.',
  'Dismiss the idea that you need to check every angle alone.',
];
for (const t of REAUDIT_TRUE) ok(kinds(t, { agents: ['Iso'] }).length === 0, `re-audit true line passes: ${t.slice(0, 60)} -> ${kinds(t, { agents: ['Iso'] }).join(', ')}`);
ok(kinds('His ultimate reveals you twice, so move after the first.', { ultOf: 'Cypher' }).length === 0, 'the true count of "his ultimate" passes');
ok(kinds('Her ultimate catches everyone inside it.', { ultOf: 'Killjoy' }).length === 0, 'a claim no class reads passes');

// Generated from the data: a use for information, true where the ability shows
// or sounds where an enemy is, and false where it does not; a reveal count.
const INFO = (e) => e.classes.includes('info') || e.classes.includes('reveal');
let useTrue = 0;
let useFalse = 0;
let useBad = [];
for (const kit of Object.values(T.agents)) {
  for (const e of Object.values(kit)) {
    const t = `Use the ${e.name} to check the angle before you swing.`;
    const got = af.checkText(t).filter((c) => c.kind === 'effect');
    if (INFO(e)) { useTrue++; if (got.length) useBad.push(`true flagged: ${t}`); } else { useFalse++; if (!got.length) useBad.push(`false missed: ${t}`); }
    for (const c of e.classes) {
      const base = { slow: 'slow them', blind: 'blind the angle', heal: 'heal', concuss: 'stun them', reveal: 'reveal them' }[c];
      if (!base) continue;
      useTrue++;
      const u = `Use your ${e.name} to ${base} before the push.`;
      if (af.checkText(u).length) useBad.push(`true flagged: ${u}`);
    }
    if (e.revealCount) {
      const right = { 1: 'once', 2: 'twice', 3: 'three times' }[e.revealCount];
      if (af.checkText(`${e.name} reveals living enemies ${right}.`).length) useBad.push(`true count flagged: ${e.name}`);
      const wrong = e.revealCount === 1 ? 'a single snapshot' : 'a single still';
      if (!af.checkText(`${e.name} is ${wrong}.`).some((c) => c.kind === 'count')) useBad.push(`false count missed: ${e.name}`);
    }
  }
}
ok(!useBad.length, `generated uses: ${useTrue} true and ${useFalse} false, all as the data has them (${useBad.slice(0, 6).join(' / ')})`);
ok(useTrue + trues.length >= 300, `with the first set, at least 300 true sentences (${useTrue + trues.length})`);
ok(T.agents.Cypher['neural theft'].revealCount === 2 && Object.values(T.agents).every((k) => Object.values(k).every((e) => e.revealCount == null || e.name === 'Neural Theft')),
  'Neural Theft is the one ability the data counts reveals for, twice');

// ── 9. kitLine, kitLines, kitBlock ────────────────────────────────────────
const nameGate = require('../server/services/name-gate');
const DASH_OR_SEMI = new RegExp(`[${String.fromCharCode(0x2013)}${String.fromCharCode(0x2014)};]`);
let lineBad = [];
for (const agent of Object.keys(T.agents)) {
  const lines = af.kitLine(agent);
  if (lines.length !== 4) lineBad.push(`${agent} has ${lines.length} lines`);
  lines.forEach((l, i) => {
    const e = Object.values(T.agents[agent]).find((x) => x.key === 'CQEX'[i]);
    if (!new RegExp(`^[^(]+ \\(${agent.replace(/[/]/g, '\\/')}'s ${'CQEX'[i]}${i === 3 ? ', ultimate' : ''}\\): `).test(l)) lineBad.push(`shape: ${l}`);
    if (DASH_OR_SEMI.test(l) || /\s-\s/.test(l)) lineBad.push(`dash or semicolon: ${l}`);
    // What it does survives the trimming: every effect class of the description is in the line.
    const body = l.slice(l.indexOf('): ') + 3);
    const lost = e.classes.filter((c) => !af.DESC_CLASSES[c].test(body));
    if (lost.length) lineBad.push(`lost ${lost.join(',')}: ${l}`);
    // No word of it reads as a player's name (name-gate.js), so a copied word never drops a look.
    let person = null;
    try { person = nameGate.namesSomeone(body, { language: 'en' }); } catch (err) { person = String(err); }
    if (person) lineBad.push(`a name: ${l}`);
  });
}
ok(!lineBad.length, `every agent has four kit lines, C, Q, E, X, in the data's words, nothing lost, no name, no dash (${lineBad.slice(0, 5).join(' / ')})`);
ok(af.kitLine('Iso')[1] === "Undercut (Iso's Q): Fire to send it forward. Applies suppress and vulnerable to all players.", `Undercut's line (${af.kitLine('Iso')[1]})`);
ok(af.kitLine('Cypher')[3] === "Neural Theft (Cypher's X, ultimate): Activate on a targeted dead enemy. After a delay, snapshot living enemies twice.", `Neural Theft's line (${af.kitLine('Cypher')[3]})`);
ok(/^Alarmbot \(Killjoy's Q\): .*applying vulnerable/.test(af.kitLine('killjoy')[1]) && !/slow/i.test(af.kitLine('Killjoy')[1]), 'Alarmbot as the game prints it, vulnerable, no slow, any case of the agent');
ok(/^Boom Bot \(Raze's C\): .*Chases the first enemy it sees/.test(af.kitLine('Raze')[0]) && !/wire/i.test(af.kitLine('Raze')[0]), 'Boom Bot chases, and sets off no wire');
ok(/^Paranoia \(Omen's Q\): .*nearsight and deafens/.test(af.kitLine('Omen')[1]) && !/vision-blocking/.test(af.kitLine('Omen')[1]), 'Paranoia nearsights, no wall');
ok(af.kitLine('Nobody').length === 0 && af.kitLine(null).length === 0 && af.kitLine('KAYO').length === 4, 'an unknown agent has no lines, KAYO is KAY/O');
ok(af.abilityLine('Iso', 'undercut') === af.kitLine('Iso')[1] && af.abilityLine('Iso', 'Alarmbot') === null, 'abilityLine by name, never another agent\'s');
ok(af.kitLines(['Iso', 'iso', 'Nobody', 'Raze']).length === 8 && af.kitLines('Omen').length === 4 && af.kitLines([]).length === 0, 'kitLines: each agent once, unknown ones left out');
ok(af.kitBlock([]) === '' && af.kitBlock(['Iso']).split('\n').length === 5 && /^What each ability does/.test(af.kitBlock(['Iso']))
  && af.kitBlock(['Iso'], { head: 'Kit:' }).startsWith('Kit:\n'), 'kitBlock: a heading and the lines, or nothing');
// The lines are true by the gate's own reading: none of them is flagged.
ok(af.kitLines(Object.keys(T.agents)).every((l) => !af.checkText(l.slice(l.indexOf('): ') + 3)).length), 'no kit line is a false claim to checkText');

// ── 6b. Round 4: a stationary ability does not move, by name or generic noun ──
{
  // Every stationary entry is one the data has, placed or set, never sent.
  for (const k of af.STATIONARY) {
    const [agent, name] = k.split('/');
    const e = Object.values(T.agents[agent] || {}).find((x) => x.name.toLowerCase() === name.toLowerCase());
    ok(e && !/\bchases\b|\bsend(?:s)? (?:it )?forward\b(?! and place)|\bsteer\b/i.test(e.description), `${k} is in the data and nothing in it moves (${e ? e.description.slice(0, 50) : 'missing'})`);
  }
  const has = (t, o, said) => kinds(t, o).some((k) => k.startsWith('effect:') && k.endsWith(`:${said}`));
  const MOVE_FALSE = [
    ['Hold the flank with your turret, so the turret has to come to you.', { agents: ['Killjoy'] }, 'has to come to'],
    ['So the turret has to come to you.', {}, 'has to come to'],
    ['The Turret moves up with you.', {}, 'moves'],
    ['Her Turret chases the first enemy it sees.', {}, 'chases'],
    ['The turret can follow them around the corner.', { agents: ['Killjoy'] }, 'follow them'],
    ['Your camera can follow them.', { agents: ['Cypher'] }, 'follow them'],
    ['Your trip wire walks to them.', { agents: ['Cypher'] }, 'walks'],
    ['The wall moves forward with you.', { agents: ['Sage'] }, 'moves'],
    ['The smoke follows you onto site.', { agents: ['Omen'] }, 'follows you'],
    ['Cypher puts a camera on B and the camera comes to you.', {}, 'comes to you'],
  ];
  for (const [t, o, said] of MOVE_FALSE) ok(has(t, o, said), `a stationary ability that moves is caught: "${t}" (${kinds(t, o).join(', ')})`);
  const MOVE_TRUE = [
    ['Place the turret so enemies have to come to you.', { agents: ['Killjoy'] }],
    ['The Boom Bot chases the first enemy it sees.', {}],
    ['The alarm bot chases them when they come close.', { agents: ['Killjoy'] }],
    ['Alarmbot chases the first enemy it sees.', {}],
    ['The wall moves forward.', { agents: ['Harbor'] }],
    ['The wall moves forward.', { agents: ['Sage', 'Phoenix'] }],
    ['Your camera has to move to see them.', { agents: ['Sova'] }],
    ['Your turret needs to move to B next round.', { agents: ['Killjoy'] }],
    ['The wall lets you push up.', { agents: ['Sage'] }],
    ['Use the wall to push up.', { agents: ['Sage'] }],
    ['Wait until the smoke comes down, then push.', { agents: ['Omen'] }],
    ['The smoke comes after the flash.', { agents: ['Omen'] }],
    ['The smoke follows you.', { agents: ['Viper'] }],
    ['The turret does not move, so make them come to you.', { agents: ['Killjoy'] }],
    ['Your turret watches the flank while you move up.', { agents: ['Killjoy'] }],
    ['High Tide moves forward and slows them.', {}],
  ];
  for (const [t, o] of MOVE_TRUE) ok(!kinds(t, o).length, `a true or harmless sentence stands: "${t}" (${kinds(t, o).join(', ')})`);
  // The generic noun is one ability only with exactly one fit.
  const g = (t, o) => af.genericsIn(t, af.abilitiesIn(t), af.agentsIn(t), o).map((x) => `${x.entry.agent}/${x.entry.name}`);
  ok(g('the camera', { agents: ['Cypher', 'Killjoy'] }).join() === 'Cypher/Spycam' && !g('the camera', { agents: ['Killjoy'] }).length
    && !g('the camera', {}).length && !g('the wall', { agents: ['Harbor'] }).length && g('the wall', { agents: ['Sage'] }).join() === 'Sage/Barrier Orb',
  'a generic noun is read only where exactly one ability of the agents fits it');
}

// ── 10. Bullets, from kit-rules.json (round 8) ────────────────────────────
ok(/Contingency \(Iso's C\): .*indestructible vision-blocking wall\..* The wall also blocks bullets from both sides, and players and abilities pass through it\./.test(af.kitLine('Iso')[0]),
  `Contingency's line carries the bullets the game's text leaves out (${af.kitLine('Iso')[0]})`);
ok(af.checkText('High Tide blocks bullets, so push behind it.').some((c) => c.kind === 'effect' && c.ability === 'High Tide'), 'High Tide blocking bullets is a false claim');
ok(af.checkText('Toxic Screen stops bullets.').length === 1, 'Toxic Screen stopping bullets is a false claim');
ok(!af.checkText('Contingency blocks bullets as it moves forward.').length && !af.checkText('Barrier Orb blocks bullets.').length, 'Contingency and Barrier Orb blocking bullets stand');
ok(!af.checkText('Cosmic Divide blocks bullets.').length, 'an ability kit-rules does not list is never judged on bullets');
ok(!af.checkText('High Tide does not block bullets.').length, 'a negation stands');
ok(af.CLAIM_VERBS.bullets.test('blocks bullets') && af.CLAIM_VERBS.bullets.test('stops enemy shots') && !af.CLAIM_VERBS.bullets.test('blocks vision'), 'the bullets verb both ways');
ok(T.agents.Iso.contingency && T.agents.Iso.contingency.bullets === true && T.agents.Harbor['high tide'].bullets === false && T.agents.Jett.cloudburst.bullets === null,
  'the table carries bullets true, false or unknown');

// ── 7. No backspace byte in the source ────────────────────────────────────
for (const f of ['server/services/ability-facts.js', 'scripts/test-ability-facts.js']) {
  const buf = fs.readFileSync(path.join(__dirname, '..', f));
  ok(!buf.includes(8), `${f} carries no backspace byte`);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
