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
 * text says that the table contradicts. The review and Ask Coach gates read
 * it (match-review.js, fact-gates.js gateKit), and so does the death look
 * (death-forensics.js kitWrong and kitBlockFor), since the 8.7.7 re-audit
 * found the look the source of the kit errors the others repeated: "use
 * undercut to check the angle", "the Boom Bot can set the wire off", Neural
 * Theft "a single still".
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
 *     negation in it ("does not slow") silences it. Since the re-audit the
 *     claims include giving information ("checks the angle", "gives you
 *     info"), clearing an angle (an ability has to show or hurt for it),
 *     setting off or finding a trap (none does), and a reload; read too in
 *     the base form after "can" or "to", after "use the <ability> to", and
 *     on an "it" opening a clause of its own in a sentence about that one
 *     ability ("Send your Boom Bot ahead: it can set the wire off").
 *   - count: a reveal count the data has otherwise, "Neural Theft is a
 *     single still" of a cast that snapshots twice.
 *   - an ultimate by its place: "Cypher's ultimate", or "his ultimate" when
 *     opts.ultOf names whose (the killer of a death), is held to that X.
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
// The kit facts the game's text leaves out (round 8): Contingency blocks
// bullets, High Tide does not. Sourced, by agent and ability (kit-rules.json).
const KIT_RULES = (() => { try { return require('../data/kit-rules.json').abilities || {}; } catch { return {}; } })();

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
  // Gives information: it shows, marks, chases or sounds where an enemy is.
  // Undercut, which only suppresses and makes vulnerable, never "checks the angle".
  info: /\b(?:reveal(?:s|ing|ed)?|mark(?:s|ing)?|snapshots?|chases|sees|detected|audio cue|tracked)\b|\btriggers (?:on|when)\b|\bshoots at enemies\b/i,
  // Nothing in the data sets off or finds another agent's trap: "the Boom Bot trips the
  // wires" and "use the Boom Bot to find tripwires" are no kit.
  trigger: /\btriggers? (?:enemy )?(?:traps|trapwires|wires)\b/i,
  // A reload of its own, read with its case: "RELOAD to toggle view" is a key the player presses.
  reload: /\b[Rr]eload(?:s|ing)?\b/,
};

/*
 * WHAT A CLAIM NEEDS OF THE DESCRIPTION: any one of these classes. A claim not
 * named here needs its own class. To clear an angle an ability has to show or
 * hurt whoever holds it.
 */
const SATISFIED_BY = {
  info: ['info', 'reveal'],
  clear: ['info', 'reveal', 'damage', 'blind', 'concuss', 'decay', 'pull', 'detain'],
};
const satisfies = (cls, classes) => (SATISFIED_BY[cls] || [cls]).some((c) => classes.includes(c));

const WIRES = '(?:the |their |his |her |a |any |enemy |enemies\' |cypher\'s |every )?(?:trip ?wires?|tripwires?|trapwires?|wires?|traps?)';

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
  info: /\b(?:checks|scouts|spots|detects|finds (?:you|them|him|her|enemies|the enemy|anyone|someone|players|who)|tells you (?:where|who|if|whether)|shows you (?:where|who|if|whether|them|enemies|the enemy)|gives (?:you )?(?:info|information|intel))\b/i,
  clear: /\bclears\b/i,
  trigger: new RegExp(`\\b(?:triggers|trips|sets off|pops|finds|spots|detects|reveals) ${WIRES}(?![A-Za-z])|\\bsets (?:the |a )?(?:trip ?)?wires? off\\b`, 'i'),
  reload: /\b(?:reloads|has to reload|needs to reload|must reload)\b/i,
  // Stopping bullets (round 8, kit-rules.json): judged only of an ability the
  // kit rules say lets bullets through ("High Tide blocks bullets"); one they
  // do not list is never judged on it (supported).
  bullets: /\b(?:blocks|stops|absorbs|eats) (?:the |enemy |their |all )?(?:bullets|shots|gunfire)\b|\bis bullet ?proof\b/i,
  // Moving of its own, judged only of an ability that stays where it is put
  // (STATIONARY): "so the turret has to come to you" of a Killjoy Turret.
  // Not "has to move" or "relocates": a Killjoy is told to move her Turret, and
  // not "comes down": a smoke fades. "Has to come to you" is the claim.
  move: /\b(?:moves|walks|rolls|travels|roams|patrols|advances|wanders|chases|hunts|follows (?:you|them|him|her|enemies|the enemy|anyone|players)|comes (?:to (?:you|them|him|her|the enemy|enemies)|toward|towards)|goes (?:to|toward|towards|after) (?:you|them|him|her|enemies|the enemy)|(?:has|needs) to (?:come|walk|travel|roll) (?:to|toward|towards|after|at)|pushes (?:up|forward|in|onto))\b/i,
};

/*
 * THE SAME CLAIMS IN THE BASE FORM, read only after "can", "will" or "to" on
 * the ability's own clause ("Boom Bot can trip the wires") or after "use the
 * <ability> to" ("use undercut to check the angle", the look's own line).
 */
const BASE_VERBS = {
  info: /^(?:check|scout|spot|detect|find (?:you|them|him|her|enemies|the enemy|anyone|someone|players|who)|see (?:who|where|if|whether|enemies|them|anyone)|get (?:info|information|intel)|gather (?:info|information|intel)|tell you (?:where|who|if|whether)|show you (?:where|who|if|whether|them|enemies|the enemy)|give (?:you )?(?:info|information|intel))\b/i,
  clear: /^clear\b/i,
  trigger: new RegExp(`^(?:trip|trigger|set off|pop|find|spot|detect|reveal) ${WIRES}(?![A-Za-z])|^set (?:the |a )?(?:trip ?)?wires? off\\b`, 'i'),
  slow: /^slow\b/i,
  blind: /^(?:blind|nearsight|flash (?:you|them|him|her|enemies|anyone|everyone|players|the))\b/i,
  vision: /^(?:smoke (?:off|the|an?)|block (?:the |their |his |her |enemy |your )?(?:vision|view|sight|line of sight))\b/i,
  heal: /^heal\b/i,
  reveal: /^(?:reveal|mark (?:you|them|him|her|enemies|anyone|everyone|players))\b/i,
  concuss: /^(?:concuss|stun|daze)\b/i,
  reload: /^reload\b/i,
  move: /^(?:move (?:up|forward|with|toward|towards|to (?:you|them|him|her|the enemy|enemies))|walk|roll|travel|roam|patrol|advance|wander|chase|hunt|follow (?:you|them|him|her|enemies|the enemy|anyone|players)|come (?:to (?:you|them|him|her|the enemy|enemies)|toward|towards)|push (?:up|forward|in|onto))\b/i,
};

/*
 * WHAT STAYS WHERE IT IS PUT (round 4). The data's "FIRE to place" and its
 * smokes set on a map: nothing in them walks, rolls or comes to anyone. Only
 * these are held to a movement claim, so "the Boom Bot chases" and "High Tide
 * moves" stand. By agent and name, each one checked against the data by
 * scripts/test-ability-facts.js.
 */
const STATIONARY = new Set([
  'Killjoy/Turret', 'Killjoy/Nanoswarm', 'Killjoy/Lockdown',
  'Cypher/Trapwire', 'Cypher/Spycam', 'Cypher/Cyber Cage',
  'Deadlock/Sonic Sensor', 'Deadlock/Barrier Mesh', 'Chamber/Trademark', 'Chamber/Rendezvous',
  'Sage/Barrier Orb', 'Viper/Toxic Screen', 'Brimstone/Sky Smoke', 'Omen/Dark Cover',
  'Clove/Ruse', 'Astra/Nebula', 'Vyse/Shear', 'Vyse/Arc Rose', 'Veto/Interceptor', 'Veto/Crosscut',
]);
// Read in lower case: the data prints some names in capitals ("TURRET").
const STATIONARY_LOWER = new Set([...STATIONARY].map(lower));
const isStationary = (e) => !!e && STATIONARY_LOWER.has(lower(`${e.agent}/${e.name}`));
/** Whether the data supports a claim of this class of the entry: a movement claim only fails a stationary ability. */
const supported = (cls, e) => (cls === 'move' ? !isStationary(e) : cls === 'bullets' ? e.bullets !== false : satisfies(cls, e.classes));

/*
 * THE GENERIC NOUN (round 4): "the camera", "the wall", "the smoke", "the
 * trip wire", "the alarm bot", read as an ability only where exactly one
 * ability of exactly one agent fits it, among the agents the text is about
 * (opts.agents) and the agents the sentence names. Two fits, or none, and the
 * noun is nobody's. Held only to the movement claim: a generic noun is read
 * for "the turret has to come to you", never for every verb a name is.
 */
const GENERIC = [
  { re: /(?<![A-Za-z0-9'-])(?:spy ?cams?|cameras?|cams?)(?![A-Za-z0-9-])/gi, fits: (e) => e.name === 'Spycam' },
  { re: /(?<![A-Za-z0-9'-])(?:trip ?wires?|wires?)(?![A-Za-z0-9-])/gi, fits: (e) => e.name === 'Trapwire' },
  { re: /(?<![A-Za-z0-9'-])(?:alarm ?bots?)(?![A-Za-z0-9-])/gi, fits: (e) => lower(e.name) === 'alarmbot' },
  { re: /(?<![A-Za-z0-9'-])(?:turrets?)(?![A-Za-z0-9-])/gi, fits: (e) => lower(e.name) === 'turret' },
  { re: /(?<![A-Za-z0-9'-])(?:boom ?bots?)(?![A-Za-z0-9-])/gi, fits: (e) => e.name === 'Boom Bot' },
  { re: /(?<![A-Za-z0-9'-])(?:walls?)(?![A-Za-z0-9-])/gi, fits: (e) => /\bwalls?\b/i.test(e.description.replace(/\bthrough a wall\b/gi, '')) },
  { re: /(?<![A-Za-z0-9'-])(?:smokes?)(?![A-Za-z0-9-])/gi, fits: (e) => /\bsmokes?\b/i.test(e.description) },
];
// The words that open a use: "use", "throw your", "send the", "after you've used".
const USE_BEFORE = /(?<![A-Za-z])(?:use|uses|used|using|throw|throws|throwing|send|sends|sending|fire|cast|pop|popping|drop|let)\s+(?:your|the|an?|her|his|their|my)?\s*$/i;
// After the name, to the verb: an optional key, a few words of where, then "to".
const USE_AFTER = /^\s*(?:\(\s*[CQEX]\s*\)|[CQEX](?![A-Za-z]))?\s*(?:(?:first|ahead|forward|in|out|through the wall|through a wall|in front|ahead of you)\s+)?(?:(?:into|through|at|onto|around|over|past) (?:[a-z']+\s+){1,4})?to\s+/i;

/*
 * HOW MANY TIMES AN ABILITY REVEALS, where the data counts it: Neural Theft
 * "snapshot living enemies twice", so "his ultimate is a single still" is wrong.
 */
const REVEAL_COUNT = /\b(?:snapshot|reveal)\w*\b[^.]*?\b(once|twice|three times)\b/i;
const COUNT_WORDS = { once: 1, twice: 2, 'three times': 3 };
const COUNT_CLAIMS = [
  // A bare "once" is a conjunction as often ("once Neural Theft goes off"): only a reveal's own once.
  [1, /\b(?:only once|just once|(?:reveals|snapshots|pings|scans|marks|shows)(?: [a-z]+){0,3} once|a single (?:still|snapshot|reveal|ping|scan|picture|photo)|one (?:still|snapshot|reveal|ping|scan|picture|photo))\b/i],
  [2, /\b(?:twice|two (?:stills|snapshots|reveals|pings|scans|pictures|photos))\b/i],
  [3, /\b(?:three times|three (?:stills|snapshots|reveals|pings|scans|pictures|photos))\b/i],
];

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
  // The death look writes these in lower case ("use undercut to check the angle").
  'undercut', 'neural theft', 'shrouded step', 'dark cover', 'fault line', 'guiding light',
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
      const counted = REVEAL_COUNT.exec(desc);
      // Bullets are judged by entry.bullets (supported), never as a class of
      // the description: the game's text never says it.
      const rule = KIT_RULES[`${agent}/${norm(k.name)}`] || null;
      const entry = { agent, name: norm(k.name), key: k.key, ultimate: k.key === 'X', classes, description: desc,
        bullets: rule && typeof rule.bullets === 'boolean' ? rule.bullets : null,
        extra: rule && typeof rule.extra === 'string' ? rule.extra : null,
        revealCount: counted ? COUNT_WORDS[lower(counted[1])] : null,
        // Credits and charges where the data carries them (it does not today): never invented.
        cost: Number.isFinite(k.cost) ? k.cost : null, charges: Number.isFinite(k.charges) ? k.charges : null };
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
    // Any name in lower case right after a use ("use undercut to"): a word of English is never used so.
    const used = USE_BEFORE.test(t.slice(0, m.index)) && USE_AFTER.test(t.slice(m.index + said.length));
    if (allLower && !LOWER_OK.has(l) && !LOWER_OK.has(lower(entries[0].name)) && !used) continue;
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
  // The base form after a modal on the ability's own clause: "Boom Bot can trip the wires".
  const modal = /^(?:\s*(?:\(\s*[CQEX]\s*\)|[CQEX](?![A-Za-z])|also|just|only|then|still|really|actually))*\s*(?:can|will|could|would|should|might|is there to|is used to|lets you)\s+(?:also\s+|then\s+|still\s+)?/i.exec(clause);
  // "The wall lets you push up": a move after "lets you" or "is used to" is the player's.
  const players = modal && /lets you|is used to|is there to/i.test(modal[0]);
  if (modal) out.push(...baseClaims(clause.slice(modal[0].length)).filter((c) => !(players && c.cls === 'move')));
  return out;
}

/** The claims of a base form verb phrase, "check the angle", "trip the wires". */
function baseClaims(rest) {
  const out = [];
  for (const [cls, re] of Object.entries(BASE_VERBS)) {
    const m = re.exec(rest);
    if (m) out.push({ cls, verb: m[0] });
  }
  return out;
}

/** What "use the <ability> to ..." claims it does, or [] (the look's "use undercut to check the angle"). */
function useClaims(t, ab) {
  const before = t.slice(0, ab.at);
  if (!USE_BEFORE.test(before)) return [];
  // "Do not use it to", "never use": a negation just before the use silences it.
  if (NEGATION.test(before.slice(-30))) return [];
  const after = t.slice(ab.end);
  const m = USE_AFTER.exec(after);
  if (!m) return [];
  let rest = after.slice(m[0].length);
  const stop = CLAUSE_STOP.exec(rest);
  if (stop) rest = rest.slice(0, stop.index);
  // "Use the wall to push up": whoever moves after a use is the player, never the ability.
  return baseClaims(rest).filter((c) => c.cls !== 'move');
}

/** The reveal count a sentence gives an ability that the data counts otherwise, or null. */
function countClaim(t, e) {
  if (!e || !e.revealCount) return null;
  let said = null;
  for (const [n, re] of COUNT_CLAIMS) {
    const m = re.exec(t);
    if (!m) continue;
    // The true count said anywhere in the sentence: it is being set right, never wrong.
    if (n === e.revealCount) return null;
    if (NEGATION.test(t.slice(Math.max(0, m.index - 25), m.index))) continue;
    if (!said) said = m[0];
  }
  return said;
}

// "His ultimate", "her ult", "the enemy's ultimate": an agent's X without its name.
const ULT_REF = /\b(?:his|her|their|its|the enemy's|the enemy)\s+(?:ult|ultimate)\b/gi;

/** The agent's ultimate entry, or null. */
function ultimateOf(agent) {
  const kit = TABLE.agents[canonAgent(agent) || ''];
  return kit ? Object.values(kit).find((x) => x.ultimate) || null : null;
}

/*
 * AN ULTIMATE BY ITS PLACE, NOT ITS NAME: "Cypher's ultimate is a single
 * still", or "his ultimate" in a text about one enemy (opts.ultOf, the killer
 * of a death, the agent asked about). Its count and what its own clause says
 * it does are held to that agent's X. Never when the sentence names the
 * ultimate too (the name is read above), nor with no agent to tie it to.
 */
function ultimateClaims(t, abs, ags, opts, claims) {
  const refs = [];
  for (const m of t.matchAll(ULT_REF)) refs.push({ at: m.index, end: m.index + m[0].length, agent: opts && opts.ultOf ? canonAgent(opts.ultOf) : null });
  for (const a of ags) {
    const m = /^(?:'s)?\s+(?:ult|ultimate)\b/i.exec(t.slice(a.end));
    if (m) refs.push({ at: a.at, end: a.end + m[0].length, agent: a.name });
  }
  if (refs.length !== 1) return;
  const ref = refs[0];
  const e = ultimateOf(ref.agent);
  if (!e || abs.some((x) => x.entries.some((y) => y.agent === e.agent && y.ultimate))) return;
  const push = (kind, said, truth) => claims.push({ kind, ability: e.name, agent: e.agent, said, truth, sentence: t.trim() });
  const nextName = Math.min(...abs.filter((x) => x.at > ref.end).map((x) => x.at), ...ags.filter((x) => x.at > ref.end).map((x) => x.at), t.length);
  for (const c of effectClaims(t, ref, nextName)) {
    if (!supported(c.cls, e)) push('effect', c.verb, c.cls === 'move' ? 'stays where it is placed' : e.classes.join(', ') || 'none named');
  }
  if (!abs.length) {
    const c = countClaim(t, e);
    if (c) push('count', c, e.revealCount === 2 ? 'twice' : e.revealCount === 3 ? 'three times' : 'once');
  }
}

/** The generic nouns of a sentence read as one ability each (GENERIC), never inside a name already read. */
function genericsIn(t, abs, ags, opts) {
  const about = new Set([...(Array.isArray(opts && opts.agents) ? opts.agents : []).map(canonAgent), ...ags.map((a) => a.name)].filter(Boolean));
  if (!about.size) return [];
  const out = [];
  for (const g of GENERIC) {
    const fits = [];
    for (const a of about) for (const e of Object.values(TABLE.agents[a] || {})) if (g.fits(e)) fits.push(e);
    if (fits.length !== 1) continue;
    for (const m of t.matchAll(new RegExp(g.re.source, 'gi'))) {
      const at = m.index;
      const end = at + m[0].length;
      if (abs.some((x) => at < x.end && end > x.at) || out.some((x) => at < x.end && end > x.at)) continue;
      out.push({ said: m[0], at, end, entry: fits[0] });
    }
  }
  return out.sort((x, y) => x.at - y.at);
}

/** A generic noun's movement claim against a stationary ability: "so the turret has to come to you". */
function genericClaims(t, abs, ags, opts, claims) {
  const gens = genericsIn(t, abs, ags, opts);
  for (const g of gens) {
    const e = g.entry;
    if (!isStationary(e)) continue;
    const nextName = Math.min(...abs.filter((x) => x.at > g.at).map((x) => x.at), ...gens.filter((x) => x.at > g.at).map((x) => x.at),
      ...ags.filter((x) => x.at > g.end).map((x) => x.at), t.length);
    const c = effectClaims(t, g, nextName).find((x) => x.cls === 'move');
    if (c) claims.push({ kind: 'effect', ability: e.name, agent: e.agent, said: c.verb, truth: 'stays where it is placed', sentence: t.trim() });
  }
}

// ── checkText ─────────────────────────────────────────────────────────────

/**
 * The claims in a text that contradict the kit table.
 *   opts.agents: optional, the agents the text is about (the player's, the
 *   asked one). Only "As <agent>, your <ability>" reads it, as the agent the
 *   ability is credited to.
 *   opts.ultOf: optional, the agent "his ultimate" and "her ult" mean (the
 *   killer of a look's death, the enemy an answer is about). Without it such
 *   a sentence is judged only when it names the agent.
 * Returns [{ kind: 'key'|'ultimate'|'effect'|'count'|'owner', ability, agent, said, truth, sentence }].
 */
function checkText(text, opts = {}) {
  const claims = [];
  for (const s of sentencesOf(text)) {
    const t = s.text;
    const abs = abilitiesIn(t);
    const ags = agentsIn(t);
    ultimateClaims(t, abs, ags, opts, claims);
    genericClaims(t, abs, ags, opts, claims);
    if (!abs.length) continue;
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
      const seenVerb = new Set();
      // "it" opening a clause of its own after the name, in a sentence that names this
      // ability alone and no agent after it: "Send your Boom Bot ahead: it can set the wire off".
      const its = [];
      if (abs.length === 1 && !ags.some((x) => x.at > ab.end)) {
        for (const m of t.slice(ab.end).matchAll(/(?:[,:]\s+|\band\s+|\bso (?:that )?)(?:then\s+)?it\s+(?=[a-z])/g)) {
          its.push(...effectClaims(t, { end: ab.end + m.index + m[0].length }, t.length));
        }
      }
      for (const c of [...effectClaims(t, ab, nextName), ...useClaims(t, ab), ...its]) {
        if (supported(c.cls, e) || seenVerb.has(c.verb)) continue;
        seenVerb.add(c.verb);
        push('effect', c.verb, c.cls === 'move' ? 'stays where it is placed' : e.classes.join(', ') || 'none named');
      }
      // A count of reveals the data has otherwise, in a sentence about this ability alone.
      if (abs.length === 1) {
        const c = countClaim(t, e);
        if (c) push('count', c, `${e.revealCount === 2 ? 'twice' : e.revealCount === 3 ? 'three times' : 'once'}`);
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

// ── kitLine ───────────────────────────────────────────────────────────────

/*
 * THE KIT AS ONE FINISHED LINE PER ABILITY, for a prompt: its name, whose key
 * it is, and what it does in the data's own words, with the credits and
 * charges where the data carries them (it does not today, so none is
 * written, never one made up). The round 3 re-audit found the model handed
 * ability names with no function, and inventing one: "Undercut checks the
 * angle", "Neural Theft is a single still", "the Boom Bot trips the wires".
 *
 * The data's words, trimmed of what only says which button to press: the
 * opening "EQUIP an Undercut.", a "HOLD FIRE to steer", "RELOAD to toggle
 * view". A sentence that says what the ability does stays whole. Every word
 * but an agent's or an ability's name is in lower case, so a word the model
 * copies from it is never read as a player's name (name-gate.js), and the
 * line carries no dash and no semicolon.
 */
const INPUT_ONLY = /^(?:(?:equip|enter) (?:an? |the )?[a-z'/ -]+|(?:hold |alt )?(?:fire|alt fire|reactivate|reload|release|interact|hold activate|hold fire\/alt fire|hold alt fire)(?: or press fire again)? to (?:throw|lob|place|launch|shoot|steer towards your crosshair|increase (?:distance|the bolt's velocity)|adjust distance|toggle view|drop early|stop early|cancel(?: targeting| the cloud| early)?|aim down sights|curve (?:left|right)|control it|exit early|detonate|add up to two bounces|stop the wall early|set(?: smoke)? locations|prepare it instead|direct it towards your crosshair|end the channel early|activate)|while equipped, reactivate to (?:flip the direction|pivot the wall) or hold alt fire to rotate|fire to set, pivot and fire again to [a-z ]+|fire to curve left, alt fire to curve right|alt fire to lob|alt fire to self-cast(?: with no refresh)?|alt fire to equip [a-z ]+)$/;

// The two dashes and a semicolon, built from their codes (CLAUDE.md: never the character itself).
const DASHES = new RegExp(`[${String.fromCharCode(0x2013)}${String.fromCharCode(0x2014)};]`, 'g');
const titleCase = (s) => (s === s.toUpperCase() && !/\//.test(s) ? s.toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase()) : s);

// Every agent's name, longest first, to give it back its case inside a line.
const AGENT_NAMES_RE = new RegExp(`(?<![A-Za-z0-9])(${AGENTS.map(esc).sort((x, y) => y.length - x.length).join('|')})(?![A-Za-z0-9])`, 'gi');

/**
 * One ability's description as prose: the input only sentences out, every
 * word lower case but the agents' names and the names of this agent's own
 * abilities, each sentence opening with its capital.
 */
function prose(e) {
  const sentences = String(e.description || '').replace(/\s+/g, ' ').replace(APOS, "'").split(/(?<=\.)\s+/).filter((x) => x.trim());
  const kept = sentences.filter((x) => !INPUT_ONLY.test(lower(x.trim()).replace(/\.$/, '')));
  let text = lower((kept.length ? kept : sentences).join(' '));
  const own = Object.values(TABLE.agents[e.agent] || {}).map((x) => x.name).sort((x, y) => y.length - x.length);
  if (own.length) {
    text = text.replace(new RegExp(`(?<![A-Za-z0-9])(${own.map((x) => esc(lower(x))).join('|')})(?![A-Za-z0-9])`, 'g'),
      (m) => titleCase(own.find((x) => lower(x) === m)));
  }
  text = text.replace(AGENT_NAMES_RE, (m) => canonAgent(m) || m);
  return text.replace(/(^|[.!?]\s+)([a-z])/g, (m, a, c) => a + c.toUpperCase())
    .replace(DASHES, ',').replace(/\s+-\s+/g, ', ');
}

/** The agent's entry of an ability by name (any case), or null. */
function entryOf(agent, ability) {
  const kit = TABLE.agents[canonAgent(agent) || ''];
  if (!kit) return null;
  return kit[lower(norm(ability))] || Object.values(kit).find((e) => aliasesOf(e.name).some((a) => lower(a) === lower(norm(ability)))) || null;
}

/** One finished line for one ability, or null. "Undercut (Iso's Q): Fire to send it forward. Applies suppress and vulnerable to all players." */
function abilityLine(agent, ability) {
  const e = typeof ability === 'object' && ability ? ability : entryOf(agent, ability);
  if (!e) return null;
  // The name as the line prints it, "ALARMBOT" as Alarmbot, "FRAG/ment" as the game prints it.
  const name = titleCase(e.name);
  const body = prose(e);
  const extra = [
    e.cost != null ? `${e.cost} credits` : null,
    e.charges != null ? `${e.charges} ${e.charges === 1 ? 'charge' : 'charges'}` : null,
  ].filter(Boolean);
  return `${name} (${e.agent}'s ${e.key}${e.ultimate ? ', ultimate' : ''}): ${body}${e.extra ? ` ${e.extra}` : ''}${extra.length ? ` ${extra.join(', ')}.` : ''}`;
}

/** The agent's four lines, C, Q, E and X, or [] for an agent the data does not know. */
function kitLine(agent) {
  const kit = TABLE.agents[canonAgent(agent) || ''];
  if (!kit) return [];
  return ['C', 'Q', 'E', 'X'].map((k) => Object.values(kit).find((e) => e.key === k)).filter(Boolean).map((e) => abilityLine(e.agent, e));
}

/** The lines of every agent named, each agent once, in the order given. */
function kitLines(agents) {
  const seen = new Set();
  const out = [];
  for (const a of Array.isArray(agents) ? agents : [agents]) {
    const c = canonAgent(a);
    if (!c || seen.has(c)) continue;
    seen.add(c);
    out.push(...kitLine(c));
  }
  return out;
}

/**
 * The lines under one heading, for a prompt, or '' when no agent is known.
 * opts.head: the heading, default "What each ability does, in the game's own
 * words. Say nothing of an ability that its line does not say:".
 */
function kitBlock(agents, opts = {}) {
  const lines = kitLines(agents);
  if (!lines.length) return '';
  const head = opts.head || "What each ability does, in the game's own words. Say nothing of an ability that its line does not say:";
  return `${head}\n${lines.join('\n')}`;
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

module.exports = { checkText, checkState, abilitiesIn, agentsIn, buildTable, TABLE, DESC_CLASSES, CLAIM_VERBS, BASE_VERBS, keyTied, sentencesOf, hpNumbersIn,
  kitLine, kitLines, kitBlock, abilityLine, STATIONARY, isStationary, genericsIn };
