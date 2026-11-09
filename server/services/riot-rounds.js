'use strict';

/**
 * Riot's round by round record of one match, for one player.
 *
 * WHY THIS EXISTS. The post-match review is built from the screen, and the
 * screen is wrong in ways that only show up against Riot's own record. Checked
 * against it, the real 24 round Abyss match in scripts/fixtures read 22 deaths
 * where Riot has 21, invented the extra one in round 17, and put 6 deaths in
 * the first 30 seconds where Riot puts 19 of 21 there. The timing error is the
 * spectator trap: after a death the HUD shows a teammate alive at 100 health,
 * so the coach believes the player lived another half a minute.
 *
 * Riot knows every kill to the millisecond. When the match can be linked, the
 * review uses this, and the screen only fills in what Riot does not record.
 *
 * Takes a HenrikDev v4 match payload (`data`), returns a plain object, never
 * throws. Every field read goes through a fallback, because the v4 shape has
 * moved before (players as an array or as { all_players }, teams as an array
 * or keyed by colour) and a wrong field must degrade to null, not to a wrong
 * number.
 *
 * NO PLAYER'S NAME, TAG OR ID EVER LEAVES THIS FILE. The reply names the other
 * nine by agent and side alone: the feed, the killer, both comps. Their names
 * and tags go into one place only, the match's name set (noteNames), hashed
 * with a key made at this boot, which the name gates of the look, the review
 * and Ask Coach read for that match and nothing ever writes out.
 */

const crypto = require('crypto');

const lower = (s) => String(s || '').toLowerCase();
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

// The game data, server/'s own copy (sync:valorant writes it beside
// src/shared's): each agent's role for the comps, and the game's words, which
// a name set skips.
let DATA = {};
try { DATA = require('../valorant-data.generated.json'); } catch { DATA = {}; }

function playersOf(d) {
  if (Array.isArray(d && d.players)) return d.players;
  if (d && d.players && Array.isArray(d.players.all_players)) return d.players.all_players;
  return [];
}

function killsOf(d) {
  if (Array.isArray(d && d.kills)) return d.kills;
  const out = [];
  (Array.isArray(d && d.rounds) ? d.rounds : []).forEach((r, i) => {
    for (const s of (Array.isArray(r.player_stats) ? r.player_stats : (Array.isArray(r.stats) ? r.stats : []))) {
      for (const k of (Array.isArray(s.kill_events) ? s.kill_events : [])) out.push({ round: i, ...k });
    }
  });
  return out;
}

const teamOfPlayer = (p) => lower(p && (p.team_id || p.team));
const idOf = (x) => x && (x.puuid || [x.name, x.tag].filter(Boolean).join('#').toLowerCase()) || null;
const agentOfPlayer = (p) => (p && ((p.agent && p.agent.name) || (typeof p.character === 'string' ? p.character
  : p.character && p.character.name))) || null;

/** An agent's role as the game data has it, or null. */
function roleOf(agent) {
  const a = typeof agent === 'string' && DATA.agents ? DATA.agents[agent] : null;
  return (a && typeof a.role === 'string' && a.role) || null;
}

/**
 * BOTH TEAM COMPS (8.5.0): agents and roles only, each side sorted by agent,
 * so nothing in it says which player was which. A player whose agent the
 * payload does not name is left out rather than guessed.
 */
function compsOf(players, myTeam) {
  const side = (ours) => players
    .filter((p) => { const t = teamOfPlayer(p); return !!t && (ours ? t === myTeam : t !== myTeam); })
    .map(agentOfPlayer).filter((a) => typeof a === 'string' && a)
    .map((agent) => ({ agent, role: roleOf(agent) }))
    .sort((a, b) => a.agent.localeCompare(b.agent));
  return { us: side(true), them: side(false) };
}

/**
 * Each end of a kill by agent (8.5.0, the feed's ka and va): the roster's
 * agent for the puuid or the name and tag the event names. A player the
 * roster does not have is no agent, never a name.
 */
function agentFinder(players) {
  const by = new Map();
  for (const p of players) {
    const agent = agentOfPlayer(p);
    if (typeof agent !== 'string' || !agent) continue;
    if (p.puuid) by.set(`p:${p.puuid}`, agent);
    const id = [p.name, p.tag].filter(Boolean).join('#').toLowerCase();
    if (id) by.set(`n:${id}`, agent);
  }
  return (x) => {
    if (!x || typeof x !== 'object') return null;
    const id = [x.name, x.tag].filter(Boolean).join('#').toLowerCase();
    return (x.puuid && by.get(`p:${x.puuid}`)) || (id && by.get(`n:${id}`)) || null;
  };
}

/*
 * THE PAYLOAD'S SHAPE, ONE LEVEL DEEPER (8.5.0), key names only, never a
 * value: the round's per player stats, their economy, damage events and
 * ability casts, the plant and the defuse, a kill's weapon, location and the
 * players' locations at it, a player's economy and stats, the metadata and a
 * team. The only live evidence of what HenrikDev's v4 record holds below the
 * top level was four key lists; a client from 8.5.0 writes these to its debug
 * log on each link, so the next linked match shows the live keys with no call
 * of its own. A key that is not a plain field name, or that is a word of a
 * player's name or tag, is left out, so no name can ride along as a key.
 */
const KEY_NAME = /^[A-Za-z_][A-Za-z0-9_]{0,47}$/;
function keysOf(o, skip) {
  if (!o || typeof o !== 'object' || Array.isArray(o)) return null;
  return Object.keys(o).filter((k) => KEY_NAME.test(k) && !skip.has(k.toLowerCase())).slice(0, 80);
}
function deeperShape(d, players, rounds) {
  const skip = new Set();
  for (const p of players) {
    for (const v of [p && p.name, p && p.tag, p && p.puuid]) {
      const s = lower(v).trim();
      if (!s) continue;
      skip.add(s);
      for (const w of s.split(/[^\p{L}\p{N}]+/u)) if (w) skip.add(w);
    }
  }
  const first = (a) => (Array.isArray(a) && a.length ? a[0] : null);
  const r0 = first(rounds);
  const stats0 = r0 ? (first(r0.stats) || first(r0.player_stats)) : null;
  const k0 = first(killsOf(d));
  const planted = rounds.find((r) => r && (r.plant || r.plant_events));
  const defused = rounds.find((r) => r && (r.defuse || r.defuse_events));
  const p0 = first(players);
  const team0 = Array.isArray(d && d.teams) ? first(d.teams)
    : (d && d.teams && typeof d.teams === 'object' ? Object.values(d.teams)[0] : null);
  return {
    'rounds[0].stats[0]': keysOf(stats0, skip),
    'rounds[0].stats[0].economy': keysOf(stats0 && stats0.economy, skip),
    'rounds[0].stats[0].damage_events[0]': keysOf(stats0 && first(stats0.damage_events), skip),
    'rounds[0].stats[0].ability_casts': keysOf(stats0 && stats0.ability_casts, skip),
    'rounds[].plant': keysOf(planted && (planted.plant || planted.plant_events), skip),
    'rounds[].defuse': keysOf(defused && (defused.defuse || defused.defuse_events), skip),
    'kills[0].weapon': keysOf(k0 && k0.weapon, skip),
    'kills[0].location': keysOf(k0 && k0.location, skip),
    'kills[0].player_locations[0]': keysOf(k0 && first(k0.player_locations), skip),
    'players[0].economy': keysOf(p0 && p0.economy, skip),
    'players[0].stats': keysOf(p0 && p0.stats, skip),
    metadata: keysOf(d && d.metadata, skip),
    'teams[0]': keysOf(team0, skip),
  };
}

/*
 * THE MATCH'S NAME SET, ON THE SERVER ONLY (8.5.0). Every word of every
 * player's name and tag in a match this server fetched, lower case, skipping
 * the game's own words and plain English (a player called "Phantom" or
 * "Hold" names nobody a review could be told apart from), digits alone and
 * anything under three letters. Each word is hashed with a key made at this
 * boot (crypto.randomBytes), kept by match id for a day, 500 matches at most.
 * Only nameSetOf hands it out, to the name gates of the look, the review and
 * Ask Coach for that match, as something that answers has(text) and holds
 * nothing it could print: no reply, log line or file ever carries it. A
 * restart loses it, and then only the gates' own heuristic runs.
 */
const NAME_KEY = crypto.randomBytes(32);
const NAME_SET_MS = 24 * 60 * 60 * 1000;
const NAME_SETS_MAX = 500;
const nameSets = new Map();   // match id -> { at, hashes }
const PLAIN_WORDS = `the and for are but not you your yours all any can had has have her him his how its may new now
  off old one our out own see she too two use was way who why yes yet did get got let put say set saw ran run win won
  lost lose loss team mate mates enemy enemies player players round rounds match game games play played playing
  good great best better bad worse worst fast slow quick high low long short left right back front side top bottom
  over under into onto from with without this that these those there here then than when where what which while
  about after again against also always another around because before being below between both down during each
  even every first last next only other same some such through until very well were will would could should
  just like make made more most much must need never once open close closed hold held take took gave give come
  came went going gone keep kept stay stayed wait push peek peeked trade traded shot shots kill kills killed dead
  died death alive spike site sites plant planted defuse defused attack attacking defence defense defending
  ace clutch eco force save buy bought full half pistol rifle sniper knife gun guns smoke flash wall util utility
  ultimate ability abilities agent agents duelist initiator controller sentinel competitive unrated swiftplay
  premier deathmatch escalation replication range spike rush custom radiant immortal ascendant diamond
  platinum gold silver bronze iron unranked riot valorant occlara mid main lobby heaven hell long short
  pro noob king queen lord god boss love life time night day dark light fire ice blue red green black white
  happy lucky little big real true free hope dream angel devil ghost shadow star moon sun sky rain snow wolf
  cat dog fox bear tiger lion dragon eagle hawk shark snake`;
// The name gate's own words, the plain words of play and the game's
// (name-gate.js PLAIN_WORDS, GAME_WORDS), which it never takes for a name: a
// word the gate passes in any sentence is no word of a name to the set
// either. Without them a player called "Behind Cover" with the tag "Angle"
// took every look line saying "fall back behind cover" or "staying on the
// angle" with them. A deploy without the gate skips only the words above.
let GATE_WORDS = '';
let gateSentences = null;
try {
  const gate = require('./name-gate');
  GATE_WORDS = `${gate.PLAIN_WORDS || ''} ${gate.GAME_WORDS || ''}`;
  if (typeof gate.sentencesOf === 'function') gateSentences = gate.sentencesOf;
} catch { GATE_WORDS = ''; }
const NOT_A_NAME = (() => {
  const out = new Set();
  const add = (s) => { for (const w of lower(s).split(/[^\p{L}\p{N}]+/u)) if (w) out.add(w); };
  add(PLAIN_WORDS);
  add(GATE_WORDS);
  for (const w of Object.keys(DATA.gear || {})) add(w);
  for (const [agent, a] of Object.entries(DATA.agents || {})) {
    add(agent);
    for (const ability of (a && a.abilities) || []) add(ability);
  }
  for (const w of Object.keys(DATA.weapons || {})) add(w);
  for (const m of DATA.maps || []) add(m);
  for (const w of Object.keys(DATA.mapCallouts || {})) add(w);
  for (const g of Object.values(DATA.mapGeometry || {})) for (const c of (g && g.callouts) || []) add(c && c.n);
  return out;
})();
const wordsOf = (s) => lower(s).split(/[^\p{L}\p{N}]+/u).filter((w) => w.length >= 3 && !/^\d+$/.test(w));
const hashWord = (w) => crypto.createHmac('sha256', NAME_KEY).update(w).digest('base64').slice(0, 22);
const matchKey = (id) => lower(id).trim().slice(0, 64);

/*
 * THE COACH'S OWN WORDS, A NAME ONLY WHERE ONE READS AS A NAME (round 8). The
 * Plat Fracture review lost its summary's third sentence, its focus's lead
 * and its only round line, R5, to this set, and both Fracture aim chats their
 * first sentences: a word of a player's name or tag there was a word every
 * coach says (the evidence points to "aim", which the prompt's AIM EVIDENCE
 * line invites in R5), and the set took it in any case, anywhere. Every
 * lower case word of three letters or more in the playbook and the worked
 * cases (data/playbook.json, data/cases.json, about 2,900 of them) is the
 * coach's vocabulary. A word of a name that is one of them goes into the
 * match's SOFT half, and counts only where it reads as a name: capitalised
 * past its sentence's first word ("Your teammate Aim was on B."), the name
 * gate's own capital rule. Not after "teammate" in lower case: replayed over
 * all 84 round 7 outputs with every coaching word taken for a word of a name,
 * that rule dropped 29 true sentences ("near a teammate instead", "a teammate
 * killing your killer"), the capital rule none (name-gate.js says the same of
 * "teammate can"). "Your aim is fine." and "Aim for the head." keep, and so
 * does "killed by aim" in lower case: the models copy a name with its
 * capitals. Every other word of a name is HARD and counts
 * in any case, anywhere, first word included, as before: "morvane" still
 * goes in lower case. The words above (NOT_A_NAME) are still no word of a
 * name at all. A spared hit is counted (nameSetCounts), never which word.
 */
/** Whether a word is the coach's own vocabulary (COACH_VOCAB's rule: lower case letters, three or more). */
const isVocabWord = (w) => typeof w === 'string' && w.length >= 3 && /^\p{Ll}+$/u.test(w);
const COACH_VOCAB = (() => {
  const out = new Set();
  const walk = (v, depth) => {
    if (depth > 6 || v == null) return;
    if (typeof v === 'string') {
      for (const t of v.split(/[^\p{L}\p{N}]+/u)) if (isVocabWord(t)) out.add(t);
    } else if (Array.isArray(v)) for (const x of v) walk(x, depth + 1);
    else if (typeof v === 'object') for (const x of Object.values(v)) walk(x, depth + 1);
  };
  for (const file of ['../data/playbook.json', '../data/cases.json']) {
    try { walk(require(file), 0); } catch { /* a deploy without it keeps every word hard */ }
  }
  return out;
})();
const counted = { spared: 0 };

/*
 * A SOFT WORD OPENING ITS SENTENCE AS ITS SUBJECT (round 8 review). The first
 * word is exempt because a coach's sentence opens on a verb ("Aim for the
 * head.", "Lurk late only with a teammate near."), but a name opens a killer
 * line as its subject, and before round 8 the hard set caught "Lurk caught you
 * on A Main." in any position. So a capitalised soft word that opens its
 * sentence still counts when the word after it is what a person did or was:
 * "Lurk was ahead of you.", "Flank killed you twice.", "Aim held the angle you
 * swung." after a colon, "1. Lurk held Heaven." after a list number, and
 * "Lurk's Operator" (the possessive's "s"). An imperative opener is followed
 * by no such word, so it keeps. Lower case only: "Aim Lab" and "Lurk Late"
 * read as no subject.
 */
const SUBJECT_VERBS = new Set(`s was is were has had killed kills caught catches held holds pushed pushes swung swings
  peeked peeks waited waits traded trades shot shoots beat beats won wins flanked flanks lurked lurks came comes
  ran runs rotated rotates played plays carried carries stayed stays entered enters opened opens sat sits saw sees
  spotted spots kept keeps picked picks knifed finished finishes outaimed outplayed got gets took takes hit hits
  tapped found finds sniped snipes threw throws dropped drops planted plants defused defuses lost loses
  anchored anchors rushed rushes cleared clears baited baits refragged`.split(/\s+/).filter(Boolean));
/** A word written with a capital letter. */
const isCapital = (tok) => /\p{Lu}/u.test(String(tok || ''));
// The pronouns and determiners a coach's own sentence opens on as its subject:
// replayed over all 84 round 7 outputs with every coaching word taken for a
// word of a name, "Nobody traded it, and you left 2 against 5." was the one
// true sentence the subject rule dropped.
const NOT_A_SUBJECT = new Set(`nobody nothing someone somebody something anyone anybody anything everyone everybody
  everything none each both either neither another other others this these those what who whom whose which whoever
  whatever where when why how there here many most some few several all any every one`.split(/\s+/).filter(Boolean));
/** Whether the word after a sentence's first word makes that word the subject, a person. */
const namesTheSubject = (next, first) => typeof next === 'string' && SUBJECT_VERBS.has(next)
  && !NOT_A_SUBJECT.has(String(first || '').toLowerCase());

/** The text's sentences, each a list of its words as written. */
function tokensBySentence(text) {
  const t = String(text || '');
  const sentences = gateSentences ? gateSentences(t) : t.split(/(?<=[.!?:])\s+/);
  return sentences.map((s) => String(s).split(/[^\p{L}\p{N}]+/u).filter(Boolean));
}

/** Every player's name and tag words of this payload into its match's name set. Returns nothing, says nothing. */
function noteNames(matchId, d) {
  const id = matchKey(matchId);
  if (!id) return;
  const hashes = new Set();
  const soft = new Set();
  for (const p of playersOf(d)) {
    for (const w of [...wordsOf(p && p.name), ...wordsOf(p && p.tag)]) {
      if (NOT_A_NAME.has(w)) continue;
      (COACH_VOCAB.has(w) ? soft : hashes).add(hashWord(w));
    }
  }
  if (!hashes.size && !soft.size) return;
  if (nameSets.has(id)) nameSets.delete(id);
  nameSets.set(id, { at: Date.now(), hashes, soft });
  while (nameSets.size > NAME_SETS_MAX) nameSets.delete(nameSets.keys().next().value);
}

/**
 * The match's name set, or null when this server holds none for it (never
 * fetched, a day old, or lost to a restart). It answers has(text): whether any
 * word of the text, a word or a whole sentence, is a word of a player's name
 * or tag in that match: a hard word in any case, a coaching word (the soft
 * half, COACH_VOCAB) only capitalised past its sentence's first word. It
 * holds nothing it could print.
 */
function nameSetOf(matchId) {
  const id = matchKey(matchId);
  const e = id ? nameSets.get(id) : null;
  if (!e) return null;
  if (Date.now() - e.at > NAME_SET_MS) { nameSets.delete(id); return null; }
  const soft = e.soft || new Set();
  // 'hit' when a word of the text is a word of a name where it reads as one,
  // 'spared' when only the soft half's words are in it and none reads as one.
  const look = (text) => {
    if (wordsOf(text).some((w) => e.hashes.has(hashWord(w)))) return 'hit';
    if (!soft.size) return null;
    let spared = false;
    for (const toks of tokensBySentence(text)) {
      for (let i = 0; i < toks.length; i++) {
        const w = lower(toks[i]);
        if (w.length < 3 || /^\d+$/.test(w) || !soft.has(hashWord(w))) continue;
        if (isCapital(toks[i]) && (i > 0 || namesTheSubject(toks[i + 1], toks[i]))) return 'hit';
        spared = true;
      }
    }
    return spared ? 'spared' : null;
  };
  const has = (text) => look(text) === 'hit';
  // Counted once by the caller for each text it serves (coach.js withoutNames),
  // never by has(), which a gate may ask twice of the same sentence.
  const spares = (text) => {
    if (look(text) !== 'spared') return false;
    counted.spared++;
    return true;
  };
  return Object.freeze({ has, spares });
}

/** How many texts the soft half spared since boot: a count, never a word. */
function nameSetCounts() { return { spared: counted.spared }; }

/** Who won a round, as a lowercase team id, whatever the field is called. */
function winnerOf(r) {
  return lower(r && (r.winning_team || r.winningTeam || (r.result && r.result.winning_team)));
}

/** Attackers for a round. Red attacks the first half in every mode. */
function attackersOf(n, halfLength) {
  if (!halfLength) return null;
  if (n <= halfLength) return 'red';
  if (n <= halfLength * 2) return 'blue';
  // Overtime and sudden death swap every round, starting with red.
  return (n - halfLength * 2) % 2 === 1 ? 'red' : 'blue';
}

/**
 * A trade is a kill on the player who just killed a teammate. Five seconds is
 * generous against the two to three coaches usually quote, on purpose: the
 * review would rather call a slow trade a trade than accuse a player of
 * dying alone when a teammate did answer.
 */
const TRADE_MS = 5000;

/**
 * The least time from a player's death to a gun kill of theirs that is read
 * as a revive. Sage's resurrection and Clove's ultimate take seconds; a
 * mutual kill lands within a tick or two of the shooter's own death.
 */
const REVIVE_MS = 2000;

/**
 * What the kill feed says about teamwork in one round, from the player's side.
 *
 *   traded       the player died and a teammate killed the killer within TRADE_MS
 *   trades       kills by the player on someone who had just killed a teammate
 *   aliveAtDeath { mates, enemies } standing just before the player died,
 *                the player included in mates, so 5 and 5 is the opening duel
 *   clutch       { vs, won: null } when the player was the last one standing
 *                on their team with enemies alive; won is filled by the caller
 *
 * Null wherever the feed cannot say, never a guess: a feed with an unplaceable
 * name counts nobody.
 */
function teamworkOf(feed, deathMs) {
  const out = { traded: null, trades: 0, aliveAtDeath: null, clutch: null };
  if (!feed.length || feed.some((k) => !k.by || !k.on)) return out;
  // The player's own kills that answered a teammate's death.
  for (const k of feed) {
    if (k.by !== 'me' || k.on !== 'enemy' || k.ms === null) continue;
    const avenged = feed.some((p) => p.on === 'mate' && p.killer && p.killer === k.victim
      && p.ms !== null && p.ms <= k.ms && k.ms - p.ms <= TRADE_MS);
    if (avenged) out.trades++;
  }
  // Numbers standing, walked through the feed in order, by who is down on
  // each side. A REVIVE PUTS A PLAYER BACK (read-1): Sage's resurrection and
  // Clove's ultimate bring one back, and the feed then shows that player
  // killing or dying a second time. Counted by category alone, a revived
  // teammate's two kills left the player "last one standing against 4" and
  // the grade 4 Decisions points richer. So a kill BY a player who is down,
  // or ON a player already down, takes them off the down list first. A kill
  // with no id for an end counts that end as one more down, as before.
  // A KILL BY A DOWN PLAYER IS NOT ALWAYS A REVIVE: a molly or a grenade
  // thrown before dying kills after it, and a mutual kill can land a few ms
  // after the shooter's own death in the feed. Read as a revive, either one
  // withdrew a real clutch. So only a gun kill (a weapon by name) at least
  // REVIVE_MS after that player's death, both times known, is a revive.
  const down = { mate: new Map(), enemy: new Map() };
  const sideOf = (who) => (who === 'me' || who === 'mate' ? 'mate' : who === 'enemy' ? 'enemy' : null);
  const keyOf = (who, id) => (who === 'me' ? 'me' : id || Symbol('unknown'));
  const revivedBy = (side, key, k) => {
    if (!down[side].has(key)) return false;
    const diedAt = down[side].get(key);
    return !!k.w && diedAt !== null && k.ms !== null && k.ms - diedAt >= REVIVE_MS;
  };
  let clutchAt = null;
  for (const k of feed) {
    let revivedMate = false;
    const bySide = sideOf(k.by); const onSide = sideOf(k.on);
    const byKey = keyOf(k.by, k.killer); const onKey = keyOf(k.on, k.victim);
    if (bySide && revivedBy(bySide, byKey, k) && down[bySide].delete(byKey) && k.by === 'mate') revivedMate = true;
    if (onSide && down[onSide].delete(onKey) && onSide === 'mate' && k.on === 'mate') revivedMate = true;
    // A clutch is withdrawn once a revived teammate turns up after it: the
    // player was never alone.
    if (revivedMate && clutchAt) clutchAt = null;
    const mates = 5 - down.mate.size; const enemies = 5 - down.enemy.size;
    if (deathMs !== null && k.on === 'me' && k.ms === deathMs) {
      out.aliveAtDeath = { mates, enemies };
    }
    if (onSide) down[onSide].set(onKey, typeof k.ms === 'number' ? k.ms : null);
    const matesAfter = 5 - down.mate.size; const enemiesAfter = 5 - down.enemy.size;
    // The player is the last one up on their side, with somebody left to beat.
    if (clutchAt === null && matesAfter === 1 && enemiesAfter > 0 && !feed.some((p) => p.on === 'me' && p.ms <= k.ms)) {
      clutchAt = { vs: enemiesAfter, won: null };
    }
  }
  out.clutch = clutchAt;
  if (deathMs !== null) {
    const death = feed.find((k) => k.on === 'me' && k.ms === deathMs);
    out.traded = !!(death && death.killer && feed.some((k) => k.by === 'mate' && k.victim === death.killer
      && k.ms !== null && k.ms >= deathMs && k.ms - deathMs <= TRADE_MS));
  }
  return out;
}

/** When Riot says the match started, in ms, or null. */
function startedAtOf(d) {
  const m = (d && d.metadata) || {};
  const t = m.started_at ? Date.parse(m.started_at)
    : (typeof m.game_start === 'number' ? m.game_start * 1000 : NaN);
  return Number.isFinite(t) ? t : null;
}

/** How long the match ran, in ms, or null. */
function lengthOf(d) {
  const m = (d && d.metadata) || {};
  return typeof m.game_length_in_ms === 'number' && m.game_length_in_ms > 0 ? m.game_length_in_ms : null;
}

/**
 * The site the spike went down on, 'A', 'B' or 'C', or null (8.3.1). It was
 * read here and never sent, so the review kept the screen's: on the player's
 * Sunset swiftplay round 5 was "Spike planted at B Boba", a frame of round
 * 4's plant the ledger had filed a round ahead, where the spike went down on A.
 */
function plantSiteOf(plant) {
  const m = /^([abc])(?![a-z])/i.exec(String((plant && (plant.site || plant.plant_site)) || '').trim());
  return m ? m[1].toUpperCase() : null;
}

/*
 * THE WEAPON IS RIOT'S NAME FOR IT, NEVER ITS TYPE (8.4.1). HenrikDev's kill
 * carries weapon { id, name, type }, and a kill whose item it cannot name has
 * no name and a type of "Weapon" or "Ability": the player's Fracture round 6,
 * most likely Chamber's Headhunter, read "to Chamber with a Weapon" on the
 * card, in the strip and in both prompts. With no name there is no weapon,
 * and the line is "to Chamber". Riot's damage types and ability slots are the
 * words that name none ("Melee" is the knife's own name, and stays); the
 * client's copy of the list is valorant-verify.js's, held equal to this one
 * by test:valorantreview, because a server from before keeps sending them.
 */
const NOT_A_WEAPON = ['weapon', 'ability', 'bomb', 'fall', 'invalid', 'ultimate', 'primary', 'ability1', 'ability2',
  'grenadeability', 'passive'];

/** A kill's weapon by name, or null: never its type, never a word that names no weapon. */
function weaponOf(k) {
  const named = (k && k.weapon && typeof k.weapon === 'object' ? k.weapon.name : null) || (k && k.damage_weapon_name) || null;
  const s = typeof named === 'string' ? named.trim() : '';
  return s && !NOT_A_WEAPON.includes(s.toLowerCase().replace(/\s+/g, '')) ? s : null;
}

/*
 * WHAT THE KILLER DEALT THE PLAYER IN THE ROUND (8.7, the review's killer
 * card). HenrikDev's round keeps each player's damage events, the damage that
 * player dealt each target with its head, body and leg hits (v4: stats[].
 * damage_events[] { player, damage, headshots, bodyshots, legshots }; v2:
 * player_stats[] with receiver_puuid). The killer's events on the player,
 * summed: numbers only, never a name. Null where the round has no events for
 * the killer, or none on the player, so a card never shows a guess.
 */
function killerDamageOf(round, killer, isMe) {
  const kid = idOf(killer);
  if (!round || !kid) return null;
  const stats = Array.isArray(round.stats) ? round.stats : Array.isArray(round.player_stats) ? round.player_stats : [];
  const mine = stats.find((s) => s && idOf(s.player || (s.player_puuid ? { puuid: s.player_puuid } : null)) === kid);
  const events = mine && Array.isArray(mine.damage_events) ? mine.damage_events : [];
  let damage = 0; let head = 0; let body = 0; let legs = 0; let hit = false;
  for (const e of events) {
    const to = e && (e.player || e.receiver || (e.receiver_puuid ? { puuid: e.receiver_puuid } : null));
    if (!to || !isMe(to)) continue;
    const dmg = num(e.damage);
    if (dmg === null || dmg < 0) continue;
    hit = true;
    damage += dmg;
    head += num(e.headshots) || 0;
    body += num(e.bodyshots) || 0;
    legs += num(e.legshots) || 0;
  }
  return hit && damage > 0 ? { damage: Math.round(damage), head, body, legs } : null;
}

/*
 * WHAT ELSE RIOT'S ROUND RECORDS (8.8): where a death happened, the team's
 * buy, how near the closest teammate stood, the player's ability casts and
 * the AFK flags. HenrikDev's v4 record sent all of it on every link and the
 * shape log was the only reader (deeperShape). Each is computed here by a
 * written rule, numbers and the game's own words only, never a name, and each
 * is left out of the round when the record lacks it, so a record without the
 * data, and a client from before, get exactly the rounds they always did.
 */
let locator = null;
try { locator = require('./callout-locator'); } catch { locator = null; }
let toMinimap = null;
try { toMinimap = require('./valorant-extract').worldToMinimap; } catch { toMinimap = null; }

/** A round's per player stats, whichever shape the record has. */
const statsOfRound = (round) => (round && Array.isArray(round.stats) ? round.stats
  : round && Array.isArray(round.player_stats) ? round.player_stats : []);
/** The player a stats row is of, as an id the roster can place: v4's player, or v2's puuid and team. */
const playerOfStat = (s) => (s && s.player && typeof s.player === 'object' ? s.player
  : s && s.player_puuid ? { puuid: s.player_puuid, team: s.player_team } : null);

/**
 * WHERE ON THE MAP a world position is, as the callout the game's own data
 * names there (callout-locator.js resolveSpot, through valorant-extract.js
 * worldToMinimap and the map's transform, the conversion the sync keeps for
 * exactly this). Null for a map with no geometry, a position missing or not
 * a number, or a point too far from every callout: a guess is never a place.
 */
function spotOf(map, loc) {
  if (!locator || !toMinimap || typeof map !== 'string' || !loc || typeof loc !== 'object') return null;
  const geo = DATA.mapGeometry ? DATA.mapGeometry[lower(map).trim()] : null;
  const t = geo && geo.transform;
  const x = num(loc.x);
  const y = num(loc.y);
  if (!t || x === null || y === null) return null;
  const p = toMinimap({ x, y }, t);
  if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) return null;
  const hit = locator.resolveSpot(map, p.x, p.y);
  return hit && typeof hit.spot === 'string' && hit.spot ? hit.spot : null;
}

/*
 * THE TEAM'S BUY, from each teammate's economy at the round's start
 * (rounds[].stats[].economy: loadout_value, the worth of what they carried
 * into the round, and remaining, the credits left after buying). Per player
 * averages over the team, so a row the record lacks does not read as a
 * cheaper buy:
 *
 *   pistol   the first round of each half, whatever was carried
 *   eco      a loadout under ECO_MAX a player (under 5000 for the team)
 *   full     a loadout of FULL_MIN a player or more: a Vandal or Phantom
 *            (2900) and heavy shields (1000) each
 *   force    between the two, with under FORCE_LEFT_MAX a player left: the
 *            team spent what it had on a partial buy
 *   half     between the two with more left: a partial buy that kept money
 *            for the next round
 *
 * Only in a queue with a buy economy and known halves (attackersOf's), and
 * only with at least MIN_PLAYERS teammates' numbers; else null.
 *
 * THREE RULES BY THE GUNS CARRIED (economy.weapon, Nov 2026), checked on the
 * owner's six audit matches through the live server. The averages alone read
 * a team of rifles with light shields (2900 + 400 = 3300 a player) as a force
 * or a half buy: Split round 18 ("half", four teammates killing with a Vandal
 * or a Phantom) and Sunset round 8 ("half", three rifles). And
 * the round after a won pistol, where the team buys SMGs with money to spare,
 * read "force" (Split rounds 2 and 14, Fracture round 2, Sunset round 6), so
 * the review praised "3 of 3 forced rounds won" for three bonus rounds.
 *
 *   full     also when all but one of the team's rows (never fewer than
 *            MIN_PLAYERS) carry a gun of RIFLE_COST or more
 *            by the game data (Vandal, Phantom, Guardian, Bulldog, Outlaw,
 *            Operator, Odin), whatever the shields
 *   full     also when MIN_PLAYERS rows carry such a gun and the team's
 *            loadout is RIFLE_CORE_LOAD a player or more (8.8): a rifle and
 *            light shields each on average, so the two without a rifle
 *            carry close to one's worth, not a save
 *   eco      also when every row's gun is known and is a sidearm: a save
 *            round, whatever shields were bought with it
 *   half     never force right after the team won that half's pistol round:
 *            a partial buy then is the bonus round, not money the team lacked
 *
 * A gun the record does not name, or a name the game data does not know,
 * counts as no rifle and no sidearm, so a record without economy.weapon reads
 * exactly as before.
 *
 * NOT CONFIRMED (8.8): Split round 5 still reads "force" and Corrode round 7
 * "half" on the live server, which the comment here once listed as fixed.
 * The kill feed has three teammates killing with a rifle in each, but the
 * kill feed is not what was carried (a rifle picked up kills with it too),
 * and no copy of either round's economy rows is kept offline to say what
 * the other two carried. Split round 5 comes after a lost full buy, where
 * three rifles and two lighter guns with little left is a force. Each now
 * reads full only if the core rule above holds for it.
 */
const BUY = Object.freeze({ ECO_MAX: 1000, FULL_MIN: 3900, FORCE_LEFT_MAX: 1000, MIN_PLAYERS: 3, RIFLE_COST: 2000, RIFLE_CORE_LOAD: 3300 });
const BUY_KINDS = Object.freeze(['pistol', 'eco', 'force', 'half', 'full']);
/** A carried gun by the game data: 'rifle' (RIFLE_COST or more), 'sidearm', 'other', or null when unknown. */
function gunClass(w) {
  const name = w && typeof w === 'object' ? w.name : w;
  const g = typeof name === 'string' && DATA.weapons ? DATA.weapons[lower(name).trim()] : null;
  if (!g) return null;
  if (/^sidearm/i.test(String(g.category || ''))) return 'sidearm';
  return typeof g.cost === 'number' && g.cost >= BUY.RIFLE_COST ? 'rifle' : 'other';
}
function buyOf(round, n, halfLength, isOurs, opts) {
  if (!halfLength) return null;
  const loads = [];
  const lefts = [];
  const guns = [];
  for (const s of statsOfRound(round)) {
    const who = playerOfStat(s);
    if (!who || !isOurs(who)) continue;
    const e = s && s.economy && typeof s.economy === 'object' ? s.economy : null;
    const lv = num(e && (e.loadout_value != null ? e.loadout_value : e.loadout));
    if (lv === null || lv < 0) continue;
    loads.push(lv);
    guns.push(gunClass(e.weapon));
    const rem = num(e.remaining);
    if (rem !== null && rem >= 0) lefts.push(rem);
  }
  if (loads.length < BUY.MIN_PLAYERS) return null;
  if (n === 1 || n === halfLength + 1) return 'pistol';
  const avg = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
  const load = avg(loads);
  const rifles = guns.filter((g) => g === 'rifle').length;
  if (rifles >= Math.max(BUY.MIN_PLAYERS, loads.length - 1)) return 'full';
  if (rifles >= BUY.MIN_PLAYERS && load >= BUY.RIFLE_CORE_LOAD) return 'full';
  if (guns.every((g) => g === 'sidearm')) return 'eco';
  if (load < BUY.ECO_MAX) return 'eco';
  if (load >= BUY.FULL_MIN) return 'full';
  if (lefts.length < BUY.MIN_PLAYERS) return null;
  if (opts && opts.afterPistolWin) return 'half';
  return avg(lefts) < BUY.FORCE_LEFT_MAX ? 'force' : 'half';
}

/*
 * HOW NEAR THE CLOSEST TEAMMATE WAS AT THE DEATH, from the kill's
 * player_locations (every player alive at that moment, v4; v2's
 * player_locations_on_kill) against where the player fell (the kill's
 * location): the nearest teammate alive, flat distance in the map's own
 * units, within MATE_CLOSE_UNITS 'close', else 'far'. Null where the record
 * places no teammate or not the player, so nobody alive to trade is no
 * distance. The unit is the engine's and no source states it, so no metres
 * are ever said: if it is Unreal's centimetre, the line is 15 m, two seconds
 * of running, inside the five second trade window (TRADE_MS).
 */
const MATE_CLOSE_UNITS = 1500;
function mateNearOf(death, isMate) {
  if (!death || !death.loc || !Array.isArray(death.around)) return null;
  const ax = num(death.loc.x);
  const ay = num(death.loc.y);
  if (ax === null || ay === null) return null;
  let best = null;
  for (const p of death.around) {
    const who = p && (p.player && typeof p.player === 'object' ? p.player
      : p && p.player_puuid ? { puuid: p.player_puuid, team: p.player_team } : null);
    if (!who || !isMate(who)) continue;
    const x = num(p.location && p.location.x);
    const y = num(p.location && p.location.y);
    if (x === null || y === null) continue;
    const d = Math.hypot(x - ax, y - ay);
    if (best === null || d < best) best = d;
  }
  return best === null ? null : best <= MATE_CLOSE_UNITS ? 'close' : 'far';
}

/*
 * THE PLAYER'S ABILITY CASTS IN THE ROUND, by the kit's key: C the grenade
 * slot, Q ability 1, E ability 2, X the ultimate (valorant-api's slots, the
 * kit's `key` in the game data). v4 names them ability_1, ability_2, grenade
 * and ultimate, v2 c_cast, q_cast, e_cast and x_cast. Whole counts up to 20
 * only; null when the record holds none.
 */
const CAST_KEYS = [['C', ['grenade', 'c_cast', 'c_casts']], ['Q', ['ability_1', 'ability1', 'q_cast', 'q_casts']],
  ['E', ['ability_2', 'ability2', 'e_cast', 'e_casts']], ['X', ['ultimate', 'x_cast', 'x_casts']]];
function castsOf(stat) {
  const a = stat && stat.ability_casts && typeof stat.ability_casts === 'object' ? stat.ability_casts : null;
  if (!a) return null;
  const out = {};
  for (const [slot, keys] of CAST_KEYS) {
    const k = keys.find((x) => Number.isInteger(a[x]) && a[x] >= 0 && a[x] <= 20);
    if (k !== undefined) out[slot] = a[k];
  }
  return Object.keys(out).length ? out : null;
}

/**
 * @param d     the v4 `data` object
 * @param name  Riot name
 * @param tag   Riot tag
 */
function parse(d, name, tag) {
  const players = playersOf(d);
  const me = players.find((p) => lower(p.name) === lower(name) && lower(p.tag) === lower(tag));
  const shape = {
    top: d ? Object.keys(d) : [],
    round0: d && Array.isArray(d.rounds) && d.rounds[0] ? Object.keys(d.rounds[0]) : null,
    kill0: killsOf(d)[0] ? Object.keys(killsOf(d)[0]) : null,
    player0: players[0] ? Object.keys(players[0]) : null,
    ...deeperShape(d, players, d && Array.isArray(d.rounds) ? d.rounds : []),
  };
  if (!me) return { error: 'That Riot ID is not in this match.', shape };

  const myTeam = teamOfPlayer(me);
  const myId = idOf(me);
  const agentById = new Map(players.map((p) => [idOf(p), agentOfPlayer(p)]));
  const agentOf = agentFinder(players);
  const isMe = (x) => !!x && (idOf(x) === myId
    || (lower(x.name) === lower(name) && lower(x.tag) === lower(tag)));

  const rounds = Array.isArray(d.rounds) ? d.rounds : [];
  const queue = lower(d.metadata && (d.metadata.queue && (d.metadata.queue.id || d.metadata.queue.name)
    || d.metadata.mode));
  // RIOT'S SIDE ONLY WHERE THE QUEUE'S HALVES ARE KNOWN (stale F2). Riot's
  // side beats the screen's (valorant-verify.js), so a queue given halves it
  // does not play labels the player's rounds wrong: Replication is first to 5
  // (halves of four), a New Map queue plays whichever format its patch says
  // (Summit Only, 13.00: "the Swiftplay mode format"), so it is read off the
  // score, and Retake swaps every round. Any queue not named here gives no
  // side, and the screen's ATTACKING or DEFENDING stands.
  const teamWins = (Array.isArray(d.teams) ? d.teams : Object.values((d && d.teams) || {}))
    .map((t) => (t && t.rounds && (t.rounds.won != null ? t.rounds.won : t.rounds.win)) ?? (t && t.rounds_won))
    .map((v) => (typeof v === 'number' ? v : null));
  // Someone reached five within nine rounds: first to five, a swiftplay format.
  const firstToFive = rounds.length > 0 && rounds.length <= 9 && teamWins.length === 2 && teamWins.every((v) => v !== null)
    && Math.max(...teamWins) === 5;
  const standardHalf = rounds.length ? 12 : null;
  const halfLength = /swift/.test(queue) ? 4 : /spike ?rush/.test(queue) ? 3
    : /^(onefa|replication)$/.test(queue) ? 4
    : /^new ?map$/.test(queue) ? (firstToFive ? 4 : standardHalf)
    : (!queue || /competitive|unrated|premier|custom|standard/.test(queue)) ? standardHalf
    : null;

  const kills = killsOf(d).map((k) => ({
    // Riot counts rounds from 0. The existing match-deaths route and the 24
    // round fixture both confirm it: round 1 has no death, exactly as the
    // frames show the player alive at 100 health when it ended.
    n: typeof k.round === 'number' ? k.round + 1 : null,
    ms: typeof k.time_in_round_in_ms === 'number' ? k.time_in_round_in_ms
      : (typeof k.kill_time_in_round === 'number' ? k.kill_time_in_round : null),
    killer: k.killer || (k.killer_puuid ? { puuid: k.killer_puuid } : null),
    victim: k.victim || (k.victim_puuid ? { puuid: k.victim_puuid } : null),
    weapon: weaponOf(k),
    // Where the victim fell and everyone alive then (8.8), for the place and
    // the teammate's distance only: read here, never sent as they are.
    loc: (k.location && typeof k.location === 'object' ? k.location : null)
      || (k.victim_death_location && typeof k.victim_death_location === 'object' ? k.victim_death_location : null),
    around: Array.isArray(k.player_locations) ? k.player_locations
      : Array.isArray(k.player_locations_on_kill) ? k.player_locations_on_kill : null,
  })).filter((k) => k.n);

  // Which side a player in the kill feed is on, relative to the player. Kill
  // events name players by puuid, name and tag, or both, so the team is looked
  // up from the roster rather than trusted from the event.
  const teamById = new Map(players.map((p) => [idOf(p), teamOfPlayer(p)]));
  const whoIs = (x) => {
    if (!x) return null;
    if (isMe(x)) return 'me';
    const t = lower(x.team) || teamById.get(idOf(x)) || null;
    if (!t) return null;
    return t === myTeam ? 'mate' : 'enemy';
  };

  // The round record beyond the feed (8.8): the map the places are on, and
  // whether the queue has a buy economy (Spike Rush and Replication hand out
  // their loadouts, and a queue with no known halves has no pistol rounds).
  const mapName = (d.metadata && d.metadata.map && (typeof d.metadata.map === 'string' ? d.metadata.map : d.metadata.map.name)) || null;
  const econHalf = halfLength && !/spike ?rush|replication|onefa/.test(queue) ? halfLength : null;
  const isOurs = (x) => { const w = whoIs(x); return w === 'me' || w === 'mate'; };
  const isMate = (x) => whoIs(x) === 'mate';

  const perRound = rounds.map((r, i) => {
    const n = i + 1;
    const inRound = kills.filter((k) => k.n === n).sort((a, b) => (a.ms || 0) - (b.ms || 0));
    const death = inRound.find((k) => isMe(k.victim)) || null;
    const myStat = statsOfRound(r).find((s) => isMe(playerOfStat(s))) || null;
    const deathAt = death ? spotOf(mapName, death.loc) : null;
    // Enemies only: a teammate the player killed by accident is no kill to place.
    const killsAt = inRound.filter((k) => isMe(k.killer) && whoIs(k.victim) === 'enemy').map((k) => spotOf(mapName, k.loc)).filter(Boolean);
    // The round after this half's pistol round, when the team won it: a bonus round.
    const afterPistolWin = !!econHalf && (n === 2 || n === econHalf + 2) && winnerOf(rounds[i - 1]) === myTeam;
    const buy = econHalf ? buyOf(r, n, econHalf, isOurs, { afterPistolWin }) : null;
    const mateNear = death ? mateNearOf(death, isMate) : null;
    const casts = castsOf(myStat);
    const winner = winnerOf(r);
    const attackers = attackersOf(n, halfLength);
    const plant = r.plant || r.plant_events || null;
    const plantMs = plant && (typeof plant.round_time_in_ms === 'number' ? plant.round_time_in_ms
      : typeof plant.plant_time_in_round === 'number' ? plant.plant_time_in_round : null);
    const feed = inRound.map((k) => ({ ms: k.ms, by: whoIs(k.killer), on: whoIs(k.victim),
      killer: idOf(k.killer), victim: idOf(k.victim), ka: agentOf(k.killer), va: agentOf(k.victim), w: k.weapon }));
    const teamwork = teamworkOf(feed, death ? death.ms : null);
    return {
      n,
      won: winner ? winner === myTeam : null,
      side: attackers ? (attackers === myTeam ? 'attacking' : 'defending') : null,
      kills: inRound.filter((k) => isMe(k.killer)).length,
      died: !!death,
      deathMs: death ? death.ms : null,
      killerAgent: death && death.killer ? (agentById.get(idOf(death.killer)) || null) : null,
      weapon: death ? death.weapon : null,
      // The killer's damage on the player this round (8.7, killerDamageOf).
      killerDamage: death && death.killer && !isMe(death.killer) ? killerDamageOf(r, death.killer, isMe) : null,
      // The first death of the round belongs to one of ten players, and being
      // it on repeat is the most specific thing a review can say about entries.
      firstDeath: !!(inRound[0] && isMe(inRound[0].victim)),
      firstKill: !!(inRound[0] && isMe(inRound[0].killer)),
      planted: !!(plant && (plant.site || plant.plant_site || plantMs !== null)),
      plantMs,
      plantSite: plantSiteOf(plant),
      // A death after the spike went down is a post-plant death, never "early".
      afterPlant: !!(death && plantMs !== null && death.ms !== null && death.ms > plantMs),
      ...teamwork,
      clutch: teamwork.clutch ? { ...teamwork.clutch, won: winner ? winner === myTeam : null } : null,
      // The kill feed with every name taken out: when, and which side each end
      // was on. Enough for the review to reason about trades, and nothing that
      // identifies the other nine players. Since 8.5.0 each kill also says
      // both ends by agent and its gun by name (ka, va, w: weaponOf, never its
      // type), so Ask Coach can tell a round in order; still no name, tag or id.
      feed: feed.map((k) => ({ ms: k.ms, by: k.by, on: k.on, ka: k.ka, va: k.va, w: k.w })),
      // The round record beyond the feed (8.8), each only where the record
      // had it: the callout the player died at and those of the enemies they
      // killed, the team's buy, the nearest teammate's distance at the death
      // in a word, the player's casts by key, and Riot's AFK flags.
      ...(deathAt ? { deathAt } : {}),
      ...(killsAt.length ? { killsAt } : {}),
      ...(buy ? { buy } : {}),
      ...(mateNear ? { mateNear } : {}),
      ...(casts ? { casts } : {}),
      ...(myStat && myStat.was_afk === true ? { afk: true } : {}),
      ...(myStat && myStat.stayed_in_spawn === true ? { inSpawn: true } : {}),
    };
  });

  const st = me.stats || {};
  const teams = Array.isArray(d.teams) ? d.teams : (d.teams && typeof d.teams === 'object'
    ? Object.entries(d.teams).map(([id, t]) => ({ team_id: id, ...t })) : []);
  const roundsWon = (t) => {
    const r = t && t.rounds;
    const v = r && (r.won != null ? r.won : r.win);
    return typeof v === 'number' ? v : (t && typeof t.rounds_won === 'number' ? t.rounds_won : null);
  };
  const mine = teams.find((t) => lower(t.team_id) === myTeam);
  const theirs = teams.find((t) => lower(t.team_id) !== myTeam);
  const my = roundsWon(mine);
  const their = roundsWon(theirs);

  return {
    map: (d.metadata && d.metadata.map && (d.metadata.map.name || d.metadata.map)) || null,
    queue: queue || null,
    rounds: rounds.length,
    me: {
      agent: agentOfPlayer(me),
      kills: typeof st.kills === 'number' ? st.kills : null,
      deaths: typeof st.deaths === 'number' ? st.deaths : null,
      assists: typeof st.assists === 'number' ? st.assists : null,
      // Combat score and damage, for ACS and ADR over Riot's own round count.
      score: typeof st.score === 'number' ? st.score : null,
      damage: num(st.damage && (st.damage.dealt != null ? st.damage.dealt : st.damage.made))
        ?? num(me.damage_made),
      headshots: num(st.headshots), bodyshots: num(st.bodyshots), legshots: num(st.legshots),
    },
    score: my !== null && their !== null ? `${my}-${their}` : null,
    result: my !== null && their !== null ? (my > their ? 'Victory' : my < their ? 'Defeat' : 'Draw') : null,
    // When the match started and how long it ran, so a match graded after the
    // fact is filed where it was played (src/shared/riot-review.js).
    startedAt: startedAtOf(d),
    lengthMs: lengthOf(d),
    // Both team comps (8.5.0): agents and roles, sorted by agent.
    comps: compsOf(players, myTeam),
    perRound,
    shape,
  };
}

module.exports = { parse, attackersOf, killsOf, playersOf, teamworkOf, plantSiteOf, weaponOf, killerDamageOf, NOT_A_WEAPON, TRADE_MS,
  compsOf, roleOf, noteNames, nameSetOf, nameSetCounts, COACH_VOCAB, SUBJECT_VERBS, isCapital, isVocabWord, namesTheSubject, NAME_SET_MS, NAME_SETS_MAX,
  spotOf, buyOf, mateNearOf, castsOf, BUY, BUY_KINDS, MATE_CLOSE_UNITS };
