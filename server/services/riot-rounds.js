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
try {
  const gate = require('./name-gate');
  GATE_WORDS = `${gate.PLAIN_WORDS || ''} ${gate.GAME_WORDS || ''}`;
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

/** Every player's name and tag words of this payload into its match's name set. Returns nothing, says nothing. */
function noteNames(matchId, d) {
  const id = matchKey(matchId);
  if (!id) return;
  const hashes = new Set();
  for (const p of playersOf(d)) {
    for (const w of [...wordsOf(p && p.name), ...wordsOf(p && p.tag)]) if (!NOT_A_NAME.has(w)) hashes.add(hashWord(w));
  }
  if (!hashes.size) return;
  if (nameSets.has(id)) nameSets.delete(id);
  nameSets.set(id, { at: Date.now(), hashes });
  while (nameSets.size > NAME_SETS_MAX) nameSets.delete(nameSets.keys().next().value);
}

/**
 * The match's name set, or null when this server holds none for it (never
 * fetched, a day old, or lost to a restart). It answers has(text): whether any
 * word of the text, a word or a whole sentence, is a word of a player's name
 * or tag in that match, in any case. It holds nothing it could print.
 */
function nameSetOf(matchId) {
  const id = matchKey(matchId);
  const e = id ? nameSets.get(id) : null;
  if (!e) return null;
  if (Date.now() - e.at > NAME_SET_MS) { nameSets.delete(id); return null; }
  const has = (text) => wordsOf(text).some((w) => e.hashes.has(hashWord(w)));
  return Object.freeze({ has });
}

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
  // Numbers standing, walked through the feed in order.
  let mates = 5; let enemies = 5; let clutchAt = null;
  for (const k of feed) {
    if (deathMs !== null && k.on === 'me' && k.ms === deathMs) {
      out.aliveAtDeath = { mates, enemies };
    }
    if (k.on === 'me' || k.on === 'mate') mates--;
    else if (k.on === 'enemy') enemies--;
    // The player is the last one up on their side, with somebody left to beat.
    if (clutchAt === null && mates === 1 && enemies > 0 && !feed.some((p) => p.on === 'me' && p.ms <= k.ms)) {
      clutchAt = { vs: enemies, won: null };
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
  const halfLength = /swift/.test(queue) ? 4 : /spike ?rush/.test(queue) ? 3 : (rounds.length ? 12 : null);

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

  const perRound = rounds.map((r, i) => {
    const n = i + 1;
    const inRound = kills.filter((k) => k.n === n).sort((a, b) => (a.ms || 0) - (b.ms || 0));
    const death = inRound.find((k) => isMe(k.victim)) || null;
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

module.exports = { parse, attackersOf, killsOf, playersOf, teamworkOf, plantSiteOf, weaponOf, NOT_A_WEAPON, TRADE_MS,
  compsOf, roleOf, noteNames, nameSetOf, NAME_SET_MS, NAME_SETS_MAX };
