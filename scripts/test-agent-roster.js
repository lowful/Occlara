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

// Role notes now reach a role that used to have none.
{
  const roleNotes = knowledge.all().filter((n) => Array.isArray(n.roles) && n.roles.includes('controller') && !n.agents);
  let reached = 0;
  for (let i = 0; i < 20; i++) {
    const got = new Set(knowledge.retrieve({ agent: 'Miks', map: 'Ascent' }, 8));
    if (roleNotes.some((n) => got.has(n.text))) reached++;
  }
  ok(roleNotes.length > 0 && reached > 0,
    `controller role notes reach a Miks review (${reached} of 20 retrievals, from ${roleNotes.length} notes)`);
}

// The refusals still hold with the longer roster.
ok(detectAgentName('The icons are not visible at this moment') === null, 'prose naming no agent is still refused');
ok(detectAgentName('Veto or Miks') === null, 'and two agents named is still no answer');

console.log(`\n${fails ? fails + ' of ' + checks + ' failed' : 'all ' + checks + ' agent roster checks passed'}`);
process.exit(fails ? 1 : 0);
