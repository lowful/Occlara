'use strict';

/**
 * THE KIT AS THE GAME DATA HAS IT, AND THE CLAIMS THAT CONTRADICT IT.
 *
 * The round 3 audit (Nov 2026) caught the model swapping keys and effects in
 * answers that passed every gate: "Her Turret (E) and Alarmbot (C)" on a
 * Killjoy whose Alarmbot is Q and whose C is Nanoswarm, "the alarmbot reveals
 * and slows anyone" of a bot that applies vulnerable, "Paranoia sends a
 * vision-blocking shadow" of a cast that nearsights. This module is pure: it
 * reads server/valorant-data.generated.json once, builds agent -> ability ->
 * key and effect classes from the data's own descriptions, and answers what a
 * text says that the table contradicts. It is wired into no route here.
 *
 * CONSERVATIVE BY DESIGN. A claim is returned only where it is certain:
 *   - key: an ability name with a key tied to it, "Alarmbot (C)", "Alarmbot C",
 *     "Alarmbot on C", "C Alarmbot", where the data has another key. A bare
 *     letter followed by a callout word ("Nanoswarm C site") is no key.
 *   - ultimate: an ability called an ultimate ("Turret ultimate", "Turret is
 *     her ultimate") whose key is not X.
 *   - effect: an effect verb in the ability's own clause, right after its name
 *     ("Alarmbot slows", "Paranoia sends a vision-blocking shadow"), that the
 *     data's description does not support. The clause ends at a comma, a
 *     sentence end, a joining word or another agent or ability name, and a
 *     negation in it ("does not slow") silences it.
 *   - owner: an agent credited with another agent's ability, "Omen's Alarmbot",
 *     "Omen Alarmbot", "As Raze, your Trapwire".
 * Ability names that are English words as well ("Flow", "Dismiss", "Run it
 * Back", "Double Tap") are read only with their capital, the way the game
 * prints them. Passives are left out, since they have no key.
 *
 * checkState(text, facts) holds numbers to the match record: "N against M"
 * standings in a round whose record carries its standings, and HP numbers
 * nothing in the facts states. A missing field changes nothing: no standings
 * for a round means no standing claim about it is judged.
 *
 * Every regex here is written with a file tool and asserted on known strings
 * by scripts/test-ability-facts.js (CLAUDE.md, the shell regex hazard).
 */

const DATA = require('../valorant-data.generated.json');

const APOS = new RegExp(`[${String.fromCharCode(0x2018)}${String.fromCharCode(0x2019)}]`, 'g');
const norm = (s) => String(s == null ? '' : s).replace(APOS, "'");
const esc = (s) => String(s).replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
const lower = (s) => String(s == null ? '' : s).toLowerCase();
const strip = (s) => String(s || '').replace(/<[^>]*>/g, '');

// ── Effect classes ────────────────────────────────────────────────────────

/*
 * WHAT THE DATA SAYS AN ABILITY DOES, by the words of its own description.
 * Flash and nearsight are one class, blind, because a player says "blinds" of
 * both. A wall, a smoke and a vision-blocking cylinder are one class, vision.
 */
const DESC_CLASSES = {
  slow: /\bslow(?:s|ing|ly)?\b|\bhinder(?:s|ing)?\b/i,
  blind: /\b(?:flash(?:es|ing)?|blind(?:s|ing)?|nearsight(?:s|ing|ed)?)\b/i,
  damage: /\bdamag(?:e|es|ing)\b|\blethal\b|\bshoots? at\b/i,
  reveal: /\b(?:reveal(?:s|ing)?|mark(?:s|ing)?|snapshots?|tracked)\b/i,
  heal: /\bheal(?:s|ing)?\b|\boverheal\b/i,
  vision: /\bvision-blocking\b|\bsmokes?\b|\bwall\b/i,
  concuss: /\bconcuss(?:es|ing|ed)?\b/i,
  suppress: /\bsuppress(?:es|ing)?\b/i,
  teleport: /\bteleport(?:s|ing)?\b|\btravel to it\b/i,
  detain: /\bdetain(?:s|ing)?\b|\bcocoon\b/i,
  decay: /\bdecay(?:s|ing)?\b/i,
  deafen: /\bdeafen(?:s|ing)?\b/i,
  pull: /\bpull(?:s|ing)?\b/i,
  intangible: /\bintangible\b/i,
  vulnerable: /\bvulnerable\b/i,
};

/*
 * WHAT A SENTENCE CLAIMS AN ABILITY DOES, as a verb whose subject is the
 * ability: the third person form only, so "use it to slow them" (a base form)
 * and "the slow" (a noun) are no claim.
 */
const CLAIM_VERBS = {
  slow: /\bslows\b/i,
  blind: /\b(?:blinds|nearsights|flashes (?:you|them|him|her|enemies|anyone|everyone|players|the))\b/i,
  damage: /\b(?:damages|deals (?:\w+ )?damage|does (?:\w+ )?damage|burns (?:you|them|him|her|enemies|anyone))\b/i,
  reveal: /\b(?:reveals|marks (?:you|them|him|her|enemies|anyone|everyone|players))\b/i,
  heal: /\bheals\b/i,
  vision: /\bvision-blocking\b|\bblocks (?:your |their |the |his |her |enemy |enemies' )?(?:vision|view|sight|line of sight)\b/i,
  concuss: /\b(?:concusses|stuns|dazes)\b/i,
  suppress: /\bsuppresses\b/i,
  teleport: /\bteleports\b/i,
  detain: /\bdetains\b/i,
  decay: /\bdecays\b/i,
  deafen: /\bdeafens\b/i,
  pull: /\bpulls (?:you|them|him|her|enemies|anyone|everyone|players|in|the)\b/i,
  intangible: /\b(?:makes (?:her|him|them) intangible|becomes? intangible)\b/i,
  vulnerable: /\b(?:makes (?:you|them|him|her|enemies|anyone|everyone|players) vulnerable|applies vulnerable)\b/i,
};

// ── The table ─────────────────────────────────────────────────────────────

const KEYS = new Set(['C', 'Q', 'E', 'X']);

/*
 * Names read in lower case too, because they are no English word and players
 * and the model write them that way ("her turret or alarmbot"). Every other
 * name needs its capital.
 */
const LOWER_OK = new Set([
  'alarmbot', 'nanoswarm', 'trapwire', 'spycam', 'gravnet', 'razorvine', 'turret',
  'boom bot', 'blast pack', 'paint shells', 'recon bolt', 'shock bolt', 'owl drone',
  'cyber cage', 'slow orb', 'healing orb', 'barrier orb', 'toxic screen', 'poison cloud',
  'snake bite', 'sonic sensor', 'barrier mesh', 'stim beacon', 'sky smoke', 'gravity well',
  'nova pulse', 'mosh pit', 'stealth drone', 'trailblazer', 'cloudburst', 'updraft',
  'tailwind', 'blade storm', 'nanoswarm', 'neural theft', 'orbital strike', "viper's pit",
  "hunter's fury", 'relay bolt', 'curveball', 'flashpoint', 'aftershock', 'showstopper',
]);

function aliasesOf(name) {
  const n = norm(name);
  const out = new Set([n]);
  if (n.includes('/')) {
    out.add(n.replace(/\//g, ''));
    out.add(n.replace(/\//g, ' '));
  }
  if (n.includes('-')) out.add(n.replace(/-/g, ' '));
  return [...out];
}

function buildTable(data) {
  const agents = {};
  const byName = new Map(); // lower name -> [{ agent, name, key, classes }]
  for (const [agent, a] of Object.entries((data && data.agents) || {})) {
    const kit = {};
    for (const k of (a && a.kit) || []) {
      if (!k || !KEYS.has(k.key) || !k.name) continue;
      const desc = strip(k.description);
      const classes = Object.keys(DESC_CLASSES).filter((c) => DESC_CLASSES[c].test(desc));
      const entry = { agent, name: norm(k.name), key: k.key, ultimate: k.key === 'X', classes, description: desc };
      kit[lower(norm(k.name))] = entry;
      for (const al of aliasesOf(k.name)) {
        const l = lower(al);
        if (!byName.has(l)) byName.set(l, []);
        byName.get(l).push({ ...entry, alias: al });
      }
    }
    agents[agent] = kit;
  }
  return { agents, byName };
}

const TABLE = buildTable(DATA);
const AGENTS = Object.keys(TABLE.agents);
const AGENT_RE = new RegExp(`(?<![A-Za-z0-9])(${AGENTS.map(esc).concat(['Kayo', 'KAYO']).sort((x, y) => y.length - x.length).join('|')})(?![A-Za-z0-9])`, 'gi');
const canonAgent = (s) => {
  const l = lower(s);
  if (l === 'kayo') return 'KAY/O';
  return AGENTS.find((a) => lower(a) === l) || null;
};

// Every alias, longest first, so "Recon Bolt" is read before any shorter name inside it.
const NAME_LIST = [...TABLE.byName.keys()].sort((a, b) => b.length - a.length);
const NAME_RE = new RegExp(`(?<![A-Za-z0-9'/-])(${NAME_LIST.map(esc).join('|')})(?![A-Za-z0-9/-])`, 'gi');

/** The abilities a text names, with where, by the case rule above. */
function abilitiesIn(text) {
  const t = norm(text);
  const out = [];
  for (const m of t.matchAll(new RegExp(NAME_RE.source, 'gi'))) {
    const said = m[1];
    const l = lower(said);
    const entries = TABLE.byName.get(l);
    if (!entries) continue;
    const allLower = said === l;
    if (allLower && !LOWER_OK.has(l) && !LOWER_OK.has(lower(entries[0].name))) continue;
    if (!allLower && !/^[A-Z]/.test(said)) continue;
    out.push({ said, at: m.index, end: m.index + said.length, entries });
  }
  return out;
}

function agentsIn(text) {
  const t = norm(text);
  const out = [];
  for (const m of t.matchAll(new RegExp(AGENT_RE.source, 'gi'))) {
    if (!/^[A-Z]/.test(m[1])) continue;
    out.push({ name: canonAgent(m[1]), at: m.index, end: m.index + m[1].length });
  }
  return out;
}

// ── Splitting ─────────────────────────────────────────────────────────────

function sentencesOf(text) {
  const out = [];
  let base = 0;
  const t = norm(text);
  for (const line of t.split('\n')) {
    let start = 0;
    const re = /[.!?]+(?=\s|$)/g;
    let m;
    while ((m = re.exec(line)) !== null) {
      const end = m.index + m[0].length;
      const s = line.slice(start, end);
      if (s.trim()) out.push({ text: s, at: base + start });
      start = end;
    }
    if (line.slice(start).trim()) out.push({ text: line.slice(start), at: base + start });
    base += line.length + 1;
  }
  return out;
}

// ── Keys ──────────────────────────────────────────────────────────────────

// A word after a bare key that makes the letter a place, not a key: "Nanoswarm C site".
const CALLOUT_AFTER = /^(?:site|sites|long|short|main|mains|link|links|lobby|heaven|hell|hall|halls|door|doors|ramp|tower|stairs|rafters|garage|window|windows|default|plat|platform|elbow|back|front|cross|bath|baths|tree|pit|connector|spawn|box|boxes|cubby|nest|logs|market|street|bridge|tunnel|tube|ropes|pillar|pillars|exit|entrance|retake|hold|side|corner|mid|mound|gate|yard|courtyard|hookah|showers|attackers|defenders|player)\b/i;
// What may follow a bare key for it to read as the key: an end, a joining word, or a verb.
const KEY_FOLLOW_OK = /^(?:$|[,.;:)!?]|(?:is|and|or|to|can|will|which|that|for|so|also|then|first|here|now|again|ability|slot|key|button|you|your|it|them|him|her|on|in|at|when|if|before|after|while|but|would|could|should|does|did|has|had|was|lets|gives|makes|catches|watches|blocks)\b|[a-z]+(?:s|es)\b)/;
const C_FOLLOW_OK = /^(?:[,;:)]|(?:is|and|to|can|will|which|that|also|then|ability|slot|key|button|lets|gives|makes)\b|[a-z]+s\b)/;
const C_ON_FOLLOW_OK = /^(?:lets|gives|makes|blinds|slows|reveals|heals|pulls|stuns|concusses|suppresses|deals|damages|nearsights|detains|decays|deafens|turns|catches|marks|blocks|creates|drops|sends)\b/;
const C_HEAD_OK =/(?:^|[,;:(]|\band)\s*$/i;
const KEY_BEFORE_PLACE = /\b(?:on|at|to|from|toward|towards|into|onto|near|through|past|off|hold|holding|held|retake|retaking|push|pushing|in)\s+$/i;

/** The key a text ties to the ability at [at, end), or null. */
function keyTied(t, at, end) {
  const after = t.slice(end);
  let m = /^\s*\(\s*([CQEX])\s*\)/.exec(after);
  if (m) return m[1];
  // C is a site on three site maps as well, so a C read as a key needs a verb
  // or a joining word after it ("Leer on C blinds"): "Alarmbot on C" may be the site.
  const keyOk = (key, rest) => !CALLOUT_AFTER.test(rest)
    && (key === 'C' ? C_FOLLOW_OK.test(rest) : KEY_FOLLOW_OK.test(rest));
  m = /^\s*,?\s*(on|is(?:\s+(?:her|his|their|your|the))?|her|his|their|your|the)\s+([CQEX])(?![A-Za-z0-9'/-])/.exec(after);
  if (m) {
    const rest = after.slice(m[0].length).replace(/^\s+/, '');
    // "on C" is a place far more often than a key: only a verb of the ability's after it ("Leer on C blinds").
    if (m[1] === 'on' && m[2] === 'C' ? C_ON_FOLLOW_OK.test(rest) && !CALLOUT_AFTER.test(rest) : keyOk(m[2], rest)) return m[2];
  }
  m = /^\s+([CQEX])(?![A-Za-z0-9'/-])/.exec(after);
  if (m) {
    const rest = after.slice(m[0].length).replace(/^\s+/, '');
    if (keyOk(m[1], rest)) return m[1];
  }
  const before = t.slice(0, at);
  m = /(?<![A-Za-z0-9'/-])([CQEX])\s+$/.exec(before);
  if (m) {
    const head = before.slice(0, m.index);
    // "Killjoy's C turret" may be the turret on C site: a C before a name is a key only opening a clause.
    if (m[1] === 'C' ? C_HEAD_OK.test(head) : !KEY_BEFORE_PLACE.test(head)) return m[1];
  }
  return null;
}

// ── Effects ───────────────────────────────────────────────────────────────

const CLAUSE_STOP = /[,;:.!?]|\s(?:because|so|but|while|if|when|where|once|as|until|unless|before|after|then|which means|whereas|or else|than|who)\s|\s-\s/i;
const NEGATION = /\b(?:not|never|no|cannot|can't|won't|doesn't|don't|isn't|without|instead of|nor)\b|n't\b/i;
// What may open the ability's clause before its verb: a key tag and adverbs.
const LEAD_TAGS = /^(?:\s*(?:\(\s*[CQEX]\s*\)|on [CQEX](?![A-Za-z])|[CQEX](?![A-Za-z])|(?:also|just|only|then|instantly|immediately|still|will|can|that|which|both|first|again|briefly|quickly|always|usually|actually|really)(?![A-Za-z])))*\s*/;
// A subject of its own between the name and the verb makes the verb that subject's.
const NEW_SUBJECT = /\b(?:you|your|they|their|we|i|he|she|teammates?|team|someone|anyone|where|who|whom|the (?:drone|bot|turret|wall|smoke|flash))\b/i;

function effectClaims(t, ab, nextAt) {
  const window = t.slice(ab.end, nextAt);
  const stop = CLAUSE_STOP.exec(window);
  let clause = stop ? window.slice(0, stop.index) : window;
  // Ten words at most: past that, the verb belongs to something else.
  clause = clause.split(/\s+/).slice(0, 12).join(' ');
  if (NEGATION.test(clause)) return [];
  const out = [];
  for (const [cls, re] of Object.entries(CLAIM_VERBS)) {
    const m = re.exec(clause);
    if (!m) continue;
    // The verb comes first, after a key tag or an adverb, or after another verb
    // of the same subject ("reveals and slows", "sends a vision-blocking
    // shadow"), never after a new subject ("Nanoswarm where the drone reveals").
    const gap = clause.slice(0, m.index).replace(LEAD_TAGS, '');
    if (NEW_SUBJECT.test(gap)) continue;
    const words = gap.trim() ? gap.trim().split(/\s+/) : [];
    if (words.length > 6) continue;
    if (words.length && !/^[a-z]+s$/i.test(words[0])) continue;
    out.push({ cls, verb: m[0] });
  }
  return out;
}

// ── checkText ─────────────────────────────────────────────────────────────

/**
 * The claims in a text that contradict the kit table.
 *   opts.agents: optional, the agents the text is about (the player's, the
 *   asked one). Only "As <agent>, your <ability>" reads it, as the agent the
 *   ability is credited to.
 * Returns [{ kind: 'key'|'ultimate'|'effect'|'owner', ability, agent, said, truth, sentence }].
 */
function checkText(text, opts = {}) {
  const claims = [];
  for (const s of sentencesOf(text)) {
    const t = s.text;
    const abs = abilitiesIn(t);
    if (!abs.length) continue;
    const ags = agentsIn(t);
    for (let i = 0; i < abs.length; i++) {
      const ab = abs[i];
      // A name two agents share is nobody's in particular: no claim on it.
      if (ab.entries.length !== 1) continue;
      const e = ab.entries[0];
      const push = (kind, said, truth) => claims.push({ kind, ability: e.name, agent: e.agent, said, truth, sentence: t.trim() });

      const key = keyTied(t, ab.at, ab.end);
      if (key && key !== e.key) push('key', key, e.key);

      const after = t.slice(ab.end);
      const before = t.slice(0, ab.at);
      const ultSaid = /^\s*(?:\(\s*)?(?:ult|ultimate)\b/i.test(after)
        || /^\s*(?:is|was|as)\s+(?:her|his|their|your|the|an?)\s+(?:ult|ultimate)\b/i.test(after)
        || /\b(?:ult|ultimate)\s*,?\s+$/i.test(before);
      if (ultSaid && !e.ultimate && !NEGATION.test(before.slice(-25) + after.slice(0, 25))) push('ultimate', 'ultimate', e.key);

      const nextName = Math.min(
        ...abs.filter((x) => x.at > ab.at).map((x) => x.at),
        ...ags.filter((x) => x.at > ab.end).map((x) => x.at),
        t.length,
      );
      for (const c of effectClaims(t, ab, nextName)) {
        if (!e.classes.includes(c.cls)) push('effect', c.verb, e.classes.join(', ') || 'none named');
      }

      // An agent credited with it: "Omen's Alarmbot", "Omen Alarmbot".
      const own = new RegExp(`(?<![A-Za-z0-9])(${AGENTS.map(esc).join('|')}|Kayo)(?:'s)?\\s+$`, 'i').exec(before);
      if (own && /^[A-Z]/.test(own[1])) {
        const who = canonAgent(own[1]);
        if (who && who !== e.agent) push('owner', who, e.agent);
      }
      const as = /\bAs\s+([A-Z][A-Za-z/]+)\s*,\s*(?:use\s+)?your\s+$/.exec(before);
      if (as) {
        const who = canonAgent(as[1]);
        const about = Array.isArray(opts.agents) && opts.agents.length ? opts.agents.map(canonAgent) : null;
        if (who && who !== e.agent && (!about || about.includes(who))) push('owner', who, e.agent);
      }
    }
  }
  return claims;
}

// ── checkState ────────────────────────────────────────────────────────────

const SMALL = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, alone: 1 };
const num = (w) => (/^\d+$/.test(w) ? Number(w) : SMALL[lower(w)]);
const COUNT = '(\\d|one|two|three|four|five|six|seven)';
const STANDING_AGAINST = new RegExp(`(?<![A-Za-z0-9])${COUNT}\\s+(?:against|versus|vs\\.?)\\s+${COUNT}(?![A-Za-z0-9])`, 'gi');
const STANDING_V = /(?<![A-Za-z0-9])([1-7])v([1-7])(?![A-Za-z0-9])/gi;
const ALONE_AGAINST = new RegExp(`\\balone\\s+against\\s+${COUNT}(?![A-Za-z0-9])`, 'gi');
const HYPOTHETICAL = /\b(?:if|would|could|imagine|suppose|say you|whenever|someone|anyone|any player|a player)\b/i;
const ROUND_NAMED = /\bround\s+(\d{1,2})\b/gi;
const ROUNDS_LIST = /\brounds\s+\d/i;

function roundsOf(facts) {
  const out = new Map();
  const rs = facts && facts.rounds;
  if (!rs) return out;
  if (rs instanceof Map) {
    for (const [k, r] of rs) if (r) out.set(Number(r.n || r.round || k), r);
  } else if (Array.isArray(rs)) {
    rs.forEach((r, i) => { if (r) out.set(Number(r.n || r.round || i + 1), r); });
  }
  return out;
}

/** The standings a round's record holds, as [mates, enemies], or null where it holds no full list. */
function standingsOf(r) {
  if (!r || !Array.isArray(r.standings) || !r.standings.length) return null;
  const out = r.standings.filter((p) => Array.isArray(p) && p.length >= 2).map((p) => [Number(p[0]), Number(p[1])]);
  for (const p of [r.atDeath, r.after]) if (Array.isArray(p)) out.push([Number(p[0]), Number(p[1])]);
  if (r.alive && Number.isFinite(r.alive.mates)) out.push([r.alive.mates, r.alive.enemies]);
  if (r.clutch && Number.isFinite(r.clutch.vs)) out.push([1, r.clutch.vs]);
  return out.length ? out : null;
}

const FULL_HP = new Set([25, 50, 75, 100, 125, 150]);

function hpNumbersIn(facts) {
  const out = new Set();
  const seen = new Set();
  const walk = (v, key) => {
    if (v == null) return;
    if (typeof v === 'number') { if (/^(?:hp|health|hpLeft|health_left)$/i.test(key || '')) out.add(v); return; }
    if (typeof v === 'string') {
      for (const m of v.matchAll(/(\d{1,3})\s*(?:hp|health)\b/gi)) out.add(Number(m[1]));
      for (const m of v.matchAll(/\b(?:hp|health)\s*(?:of\s+|at\s+|:\s*)?(\d{1,3})\b/gi)) out.add(Number(m[1]));
      return;
    }
    if (typeof v !== 'object' || seen.has(v)) return;
    seen.add(v);
    if (v instanceof Map) { for (const [k, x] of v) walk(x, String(k)); return; }
    if (Array.isArray(v)) { v.forEach((x) => walk(x, key)); return; }
    for (const [k, x] of Object.entries(v)) walk(x, k);
  };
  walk(facts, '');
  return out;
}

const HP_CLAIM = /\b(?:at|with|on|to|had|having|has|only|just|left on|down to)\s+(\d{1,3})\s*(?:hp|health)\b(?!\s*(?:or (?:less|lower|below|under)|and (?:below|under)))/gi;
const ENEMY_NEAR = new RegExp(`(?:\\b(?:their|his|her|he|she|him|enemy|enemy's|them|they)\\b|(?<![A-Za-z0-9])(?:${AGENTS.map(esc).join('|')})(?![A-Za-z0-9]))`, 'i');
const PLAYER_NEAR = /\b(?:you|your|you're|you were)\b/i;

/**
 * The numbers in a text that contradict the record.
 *   facts.rounds: an array or Map of rounds, each with n and, where the record
 *   has them, standings [[mates, enemies], ...] (the player's side first),
 *   atDeath, after, alive { mates, enemies }, clutch { vs }.
 *   facts.round: the round the text is about when it names none (an asked
 *   round). facts.mode: a deathmatch mode is never held to five a side.
 * Returns [{ kind: 'standing'|'hp', round, said, record, sentence }].
 */
function checkState(text, facts) {
  const f = facts || {};
  const out = [];
  const rounds = roundsOf(f);
  const fiveASide = !/deathmatch/i.test(String(f.mode || ''));
  const hpKnown = hpNumbersIn(f);
  const t = norm(text);
  for (const para of t.split(/\n\s*\n/)) {
    let carry = null;
    for (const s of sentencesOf(para)) {
      const st = s.text;
      const named = [...st.matchAll(new RegExp(ROUND_NAMED.source, 'gi'))].map((m) => Number(m[1]));
      const several = ROUNDS_LIST.test(st) || new Set(named).size > 1;
      if (named.length && !several) carry = named[0];
      if (several) carry = null;
      const round = several ? null : named.length ? named[0] : (carry != null ? carry : (Number.isFinite(Number(f.round)) && f.round != null ? Number(f.round) : null));
      const hypo = HYPOTHETICAL.test(st);

      const claims = [];
      for (const m of st.matchAll(new RegExp(STANDING_AGAINST.source, 'gi'))) {
        // "alone against 2" is read below, as 1 against 2.
        if (/^alone$/i.test(m[1])) continue;
        claims.push({ a: num(m[1]), b: num(m[2]), at: m.index, said: m[0] });
      }
      for (const m of st.matchAll(new RegExp(ALONE_AGAINST.source, 'gi'))) claims.push({ a: 1, b: num(m[1]), at: m.index, said: m[0] });
      if (named.length && !several) {
        for (const m of st.matchAll(new RegExp(STANDING_V.source, 'gi'))) claims.push({ a: Number(m[1]), b: Number(m[2]), at: m.index, said: m[0] });
      }
      for (const c of claims) {
        if (!Number.isFinite(c.a) || !Number.isFinite(c.b)) continue;
        if (fiveASide && (c.a > 5 || c.b > 5)) {
          out.push({ kind: 'standing', round, said: c.said, record: 'five a side', sentence: st.trim() });
          continue;
        }
        if (hypo || round == null) continue;
        const states = standingsOf(rounds.get(round));
        if (!states) continue;
        const ok = states.some(([m, e]) => (m === c.a && e === c.b) || (m === c.b && e === c.a));
        if (!ok) out.push({ kind: 'standing', round, said: c.said, record: states.map(([m, e]) => `${m} against ${e}`), sentence: st.trim() });
      }

      if (!facts || hypo) continue;
      for (const m of st.matchAll(new RegExp(HP_CLAIM.source, 'gi'))) {
        const v = Number(m[1]);
        if (FULL_HP.has(v) || hpKnown.has(v) || v > 150) continue;
        const head = st.slice(Math.max(0, m.index - 60), m.index);
        const words = head.split(/\s+/).slice(-7).join(' ');
        const enemy = ENEMY_NEAR.test(words) && !/\byou(?:r)?\b/i.test(words.split(/\s+/).slice(-3).join(' '));
        const player = PLAYER_NEAR.test(words) || PLAYER_NEAR.test(st);
        // Certain only for an enemy's health, or the player's tied to a round of the match.
        if (enemy || (player && named.length && !several) || (player && /^\s*ROUND\s+\d+\s*:/i.test(st))) {
          out.push({ kind: 'hp', round, said: m[0], record: [...hpKnown].sort((x, y) => x - y), sentence: st.trim() });
        }
      }
    }
  }
  return out;
}

module.exports = { checkText, checkState, abilitiesIn, agentsIn, buildTable, TABLE, DESC_CLASSES, CLAIM_VERBS, keyTied, sentencesOf, hpNumbersIn };
