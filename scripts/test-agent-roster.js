'use strict';

/**
 * Every agent in the game resolves on the server: detection, the detection
 * prompt, and the playbook's role map.
 *
 * THE BUG. detect-agent's list and the playbook's agent to role table were
 * typed by hand and both stopped before Veto and Miks. detectAgentName('Veto')
 * and detectAgentName('Miks') returned null, so those players never got an
 * agent lock: the client asked again every 30 seconds for the whole session, a
 * paid vision call each time, with the live read paused for the length of each
 * one. And with no role, every role tagged playbook note was unreachable for
 * them, so their reviews drew on none.
 *
 * Both now come from server/valorant-data.generated.json. This checks them
 * against the CLIENT's copy, src/shared/valorant-data.generated.json, because
 * that is the roster a player can actually pick from: an agent the client
 * knows and the server does not is this bug coming back.
 *
 * Run: npm run test:agentroster
 */

const path = require('path');

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost:54321';
process.env.SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || 'test-key-not-used';

let fails = 0;
let checks = 0;
const ok = (cond, what) => {
  checks++;
  if (!cond) { fails++; console.log(`FAIL  ${what}`); } else console.log(`ok    ${what}`);
};

const ROOT = path.join(__dirname, '..');
const clientAgents = require(path.join(ROOT, 'src', 'shared', 'valorant-data.generated.json')).agents || {};
const serverAgents = require(path.join(ROOT, 'server', 'valorant-data.generated.json')).agents || {};
const coach = require(path.join(ROOT, 'server', 'routes', 'coach.js'));
const knowledge = require(path.join(ROOT, 'server', 'services', 'knowledge.js'));
const { detectAgentName } = coach;
const { DETECTABLE_AGENTS, AGENT_KIT_LINES, ICON_HINTS, hintFits } = coach.__test;

const names = Object.keys(clientAgents);
ok(names.length >= 29, `the client knows ${names.length} agents`);
ok(names.includes('Veto') && names.includes('Miks'), 'Veto and Miks among them');

for (const name of names) {
  const role = String(clientAgents[name].role || '').toLowerCase();
  const line = AGENT_KIT_LINES.split('\n').find((l) => l === name || l.startsWith(`${name}:`)) || '';
  const kit = line.includes(':') ? line.slice(line.indexOf(':') + 1).split(',').map((s) => s.trim()).filter(Boolean) : [];
  const fine = serverAgents[name]
    && DETECTABLE_AGENTS.includes(name)
    && detectAgentName(name) === name
    && detectAgentName(name.toUpperCase()) === name
    && detectAgentName(`${name}.`) === name
    && knowledge.roleOf(name) === role
    && knowledge.situationOf({ agent: name }).role === role
    && kit.length >= 4;
  ok(fine, `${name}: detected, role ${role || 'none'} in the playbook, ${kit.length} abilities in the prompt`);
}

// The two that were missing, spelled out.
ok(detectAgentName('Veto') === 'Veto' && detectAgentName('Miks') === 'Miks', 'Veto and Miks are detected');
ok(knowledge.roleOf('Veto') === 'sentinel' && knowledge.roleOf('Miks') === 'controller',
  'Veto is a sentinel and Miks a controller to the playbook');
ok(/^Veto: .*Interceptor/m.test(AGENT_KIT_LINES) && /^Miks: .*Bassquake/m.test(AGENT_KIT_LINES),
  'and the detection prompt gives both their real kit, not a bare name');
ok(/^Tejo: .*Guided Salvo/m.test(AGENT_KIT_LINES) && /^Vyse: .*Steel Garden/m.test(AGENT_KIT_LINES)
  && /^Waylay: .*Convergent Paths/m.test(AGENT_KIT_LINES),
  'Tejo, Vyse and Waylay, which the old prompt named with no kit, get theirs');

// The hand written icon hints are only used while they match the real kit.
ok(/^Harbor: .*Storm Surge/m.test(AGENT_KIT_LINES) && !/Cascade/.test(AGENT_KIT_LINES),
  "Harbor's line names Storm Surge, not the Cascade a rework removed");
for (const name of Object.keys(ICON_HINTS)) {
  ok(hintFits(name), `${name}'s hand written icon hint still names every ability the data lists`);
}

// Role notes now reach a role that used to have none. A role note is one
// tagged with the role and written for the whole role: either it names no
// agent, or (docs/claude/playbook.md, since the 2026-11 audit) it carries the
// role's roster as its agent list. A note for one agent's kit (Miks's own
// M Pulse note) is not a role note, and a note narrowed to the agents whose
// kit it describes (the smoke you can pull back: Astra and Viper) rightly
// leaves Miks out.
{
  const roleNotes = knowledge.all().filter((n) => Array.isArray(n.roles) && n.roles.includes('controller')
    && (!n.agents || (n.agents.length > 1 && n.agents.includes('Miks'))));
  let reached = 0;
  for (let i = 0; i < 20; i++) {
    const got = new Set(knowledge.retrieve({ agent: 'Miks', map: 'Ascent' }, 8));
    if (roleNotes.some((n) => got.has(n.text))) reached++;
  }
  ok(roleNotes.length > 0 && reached > 0,
    `controller role notes reach a Miks review (${reached} of 20 retrievals, from ${roleNotes.length} notes)`);

  // THE RANK BAND (8.8) keeps the agent and role filters: with a band, every
  // agent still gets only its own notes and its role's, never another agent's
  // kit, and the role notes still reach it.
  const roster = Object.keys(require(path.join(ROOT, 'server', 'valorant-data.generated.json')).agents || {});
  let foreign = 0;
  let roleless = 0;
  for (const agent of roster) {
    const role = knowledge.roleOf(agent);
    for (const band of knowledge.RANK_BANDS) {
      const got = knowledge.retrieve({ agent, map: 'Ascent', rankBand: band }, 2000);
      for (const t of got) {
        const n = knowledge.all().find((x) => x.text === t);
        if (n.agents && !n.agents.some((a) => a.toLowerCase() === agent.toLowerCase())) foreign++;
        if (n.roles && !n.roles.includes(role)) foreign++;
      }
      if (role && !got.some((t) => { const n = knowledge.all().find((x) => x.text === t); return n.roles && n.roles.includes(role); })) roleless++;
    }
  }
  ok(roster.length >= 28 && foreign === 0, `with any rank band no agent is served another agent's or role's note (${roster.length} agents, ${foreign} foreign)`);
  ok(roleless === 0, `and every agent with a role still reaches its role notes at every band (${roleless} missing)`);
}

// THE ENEMY TEAM (8.8): every agent of the roster reads as an enemy agent, the
// notes and cases name only agents of it, and with any one agent as the whole
// enemy list no note or case for another enemy is served.
{
  const roster = Object.keys(serverAgents);
  ok(JSON.stringify(knowledge.enemiesOf(roster.slice(0, 5))) === JSON.stringify(roster.slice(0, 5))
    && roster.every((a) => knowledge.enemiesOf([a.toUpperCase()])[0] === a),
  `every agent of the game data reads as an enemy agent, in any case (${roster.length})`);
  const cases = require(path.join(ROOT, 'server', 'services', 'cases.js'));
  const tagged = [...knowledge.all().flatMap((n) => [...(n.enemyAgents || []), ...(n.enemyWithout || [])]),
    ...cases.all().flatMap((c) => [...c.situation.enemyAgents, ...(c.situation.enemyWithout || [])])];
  ok(tagged.length > 20 && tagged.every((a) => roster.includes(a) && Object.keys(clientAgents).includes(a)),
    `every enemy agent a note or a case names is one the server and the client roster know (${new Set(tagged).size} agents)`);
  let wrong = 0;
  for (const enemy of roster) {
    for (const t of knowledge.retrieve({ enemyAgents: [enemy], rankBand: 'asc_plus' }, 2000)) {
      const n = knowledge.all().find((x) => x.text === t);
      if (n.enemyAgents && !n.enemyAgents.includes(enemy)) wrong++;
      if (n.enemyWithout) wrong++;
    }
    const sit = { enemies: [enemy], sides: ['attack', 'defense'], advanced: true, phases: ['early', 'mid', 'execute', 'postplant', 'retake', 'late'] };
    for (const { c } of cases.scored(sit)) {
      if (c.situation.enemyAgents.length && !c.situation.enemyAgents.includes(enemy)) wrong++;
      if (c.situation.enemyWithout) wrong++;
    }
  }
  ok(wrong === 0, `with one agent as the enemy, no note or case for another enemy, and no comp read that needs five (${wrong})`);
}

// The refusals still hold with the longer roster.
ok(detectAgentName('The icons are not visible at this moment') === null, 'prose naming no agent is still refused');
ok(detectAgentName('Veto or Miks') === null, 'and two agents named is still no answer');

console.log(`\n${fails ? fails + ' of ' + checks + ' failed' : 'all ' + checks + ' agent roster checks passed'}`);
process.exit(fails ? 1 : 0);
