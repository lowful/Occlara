'use strict';

/**
 * ASK COACH V2 (8.5.0): the prompt built from a match's facts, and the reply
 * held to them.
 *
 * Ask Coach before 8.5 was a 2,400 character block of the review's own
 * sentences, five playbook notes chosen by agent alone, a tips block from a
 * product that had stopped giving tips, and "name real numbers" with no table
 * to take them from. It could not tell a round in order, named no match, and
 * every number it said about the game came from the model's memory.
 *
 * Now the client sends the match as structured facts (src/shared/
 * chat-context.js build, `context.v: 2`), this file bounds every field
 * (normalise), renders them in the order the spec fixes (buildPrompt: the
 * static rules and the primer's core first, for the providers' prefix cache,
 * then THE PLAYER, THE MATCH with its round ledger, the slices, the coaching
 * notes, the coach's earlier words, the conversation and the reply line), and
 * checks every sentence of the reply against the same facts (parseReply, over
 * fact-gates.js). The route (routes/coach.js chatV2) decides who is served
 * this, which model answers, the time budget, the cap and the retry.
 *
 *   normalise(context)                 the v2 context, bounded and gated
 *   buildPrompt(input, messages, opts) the prompt, a string; opts.variant
 *                                      'v2-noprimer' leaves the primer out
 *                                      (bench:chat's control)
 *   parseReply(raw, input, opts)       { reply, retry, reasons, dropped,
 *                                      logged, kept, sentences }; opts.messages
 *                                      for the echo of a typed name,
 *                                      opts.nameSet (or opts.names) the
 *                                      match's own names as has(text)
 *   retryPrompt(prompt, reasons)       the prompt again, with what was wrong
 *
 * WHAT THE PROMPT NEVER HOLDS: a card's screen reads (they held a teammate's
 * in game name on the Sunset review), the engine's match memory, anything of
 * a session in progress, a player's name or tag, or a free text sentence
 * that blames the buy phase, names a killer Riot's record does not, or names
 * someone. Free text is the review's own sentences, so a sentence that fails
 * is dropped before the model sees it: the Sunset 8.3.0 summary ("Standing
 * idle in spawn during buy phase was the repeated mistake") arrives as
 * nothing.
 *
 * No require from src/: check:server forbids it.
 */

const gates = require('./fact-gates');
const chatClips = require('./chat-clips');
const { promptName, PROMPT_NAMES } = require('./languages');

let DATA = {};
try { DATA = require('../valorant-data.generated.json'); } catch { DATA = {}; }

// Lazily, each one optional: a module from another builder that is not
// deployed yet costs its part of the prompt, never the answer.
const optional = (name) => {
  try { return require(name); } catch { return null; }
};
const primerMod = () => optional('./game-primer');
const knowledgeMod = () => optional('./knowledge');
const reviewMod = () => optional('./match-review');
const forensicsMod = () => optional('./death-forensics');
const casesMod = () => optional('./cases');
const abilityFactsMod = () => optional('./ability-facts');
const coherenceMod = () => optional('./coherence');
const recordMod = () => optional('./record-claims');
const KIT_HEAD = "THE KITS, what each ability does in the game's own words, the player's agent first. Say nothing of an ability that its line does not say, and name each by its name, never by its key:";

const lower = (s) => String(s == null ? '' : s).toLowerCase();
const fin = (v) => typeof v === 'number' && Number.isFinite(v);
const int = (v, lo, hi) => (Number.isInteger(v) && v >= lo && v <= hi ? v : null);
const num = (v, lo, hi) => (fin(v) && v >= lo && v <= hi ? v : null);
// An en or em dash, built from its code: the character is never typed (CLAUDE.md).
const DASH = new RegExp('[' + String.fromCharCode(0x2013, 0x2014) + ']', 'g');
const clip = (v, n) => String(v == null ? '' : v).replace(DASH, ', ').replace(/\s+/g, ' ').trim().slice(0, n);
const bool = (v) => v === true;
const tri = (v) => (typeof v === 'boolean' ? v : null);
const list = (v, n) => (Array.isArray(v) ? v.slice(0, n) : []);
const withArticle = (w) => `${/^[aeiou]/i.test(String(w)) ? 'an' : 'a'} ${w}`;

// ── The game's own names ───────────────────────────────────────────────────

const AGENTS = Object.keys(DATA.agents || {});
const GUNS = Object.keys(DATA.weapons || {}).map((k) => k.charAt(0).toUpperCase() + k.slice(1));
const MAPS = (Array.isArray(DATA.maps) ? DATA.maps : []).map(String);
const agentOf = (a) => AGENTS.find((x) => lower(x) === lower(a)) || null;
const gunOf = (g) => GUNS.find((x) => lower(x) === lower(String(g || '').trim())) || null;
const mapOf = (m) => MAPS.find((x) => lower(x) === lower(String(m || '').trim())) || null;
const roleOf = (a) => {
  const x = (DATA.agents || {})[agentOf(a) || ''];
  return x && typeof x.role === 'string' ? x.role : null;
};
const kitOf = (a) => {
  const x = (DATA.agents || {})[agentOf(a) || ''];
  return x && Array.isArray(x.abilities) ? x.abilities.map(lower) : [];
};
const LANGS = new Set(Object.keys(PROMPT_NAMES));
const MODES = ['Competitive', 'Unrated', 'Swiftplay', 'Premier', 'Standard', 'Spike Rush', 'Deathmatch', 'Team Deathmatch',
  'Escalation', 'Replication', 'Custom', 'New Map', 'Snowball Fight'];
// The four rank bands (knowledge.js RANK_BANDS, which test:chatgates holds
// this copy to), and how the player's facts say each one.
const RANK_BANDS = ['iron_bronze', 'silver_gold', 'plat_diamond', 'asc_plus'];
const BAND_WORDS = {
  iron_bronze: ['Iron or Bronze', 'basic habit'],
  silver_gold: ['Silver or Gold', 'basic habit'],
  plat_diamond: ['Platinum or Diamond', 'decision'],
  asc_plus: ['Ascendant or above', 'timing or utility change, with what it risks,'],
};
const RANK_WORDS = /^(?:Unranked|(?:Iron|Bronze|Silver|Gold|Platinum|Diamond|Ascendant|Immortal) [1-3]|Radiant)$/;
const SIDES = new Set(['attacking', 'defending']);
const FIGHTS = new Set(['right', 'wrong-spot', 'wrong-time', 'not-needed', 'unclear']);
const CHANGES = new Set(['aim', 'position', 'timing', 'decision', 'utility', 'team', 'none']);
const AGAINST = new Set(['ACS', 'Damage per round', 'K/D', 'Headshot %']);
const causes = () => {
  const f = forensicsMod();
  return (f && f.CAUSES) || {};
};
const DAY = /^\d{1,2} [A-Z][a-z]{2}$/;
// The rounds of a question told in full at most (askedRounds).
const MAX_ASKED_ROUNDS = 3;

// ── Free text, gated before the model sees it ──────────────────────────────

/*
 * A SENTENCE OF THE REVIEW'S OWN IS DROPPED BEFORE THE MODEL SEES IT when it
 * blames the buy phase, the spawn or a menu (match-review.js BUY_BLAME, the
 * review's rule), names a killer the round's Riot record does not
 * (death-forensics.js wrongKiller), or names a player (a Riot ID, a handle's
 * shape, the capital rule of name-gate.js). What is left is clipped.
 */
/*
 * THE MATCH'S OWN NAMES, while its context is normalised (riot-rounds.js
 * nameSetOf, this server's only, by the match's Riot id): a review saved
 * before the look's name gate (8.5.0) can carry a name the capital rule does
 * not see, in lower case, and the set does (the verifier's probe, 15 Oct).
 * Set and cleared around normalise, which is synchronous.
 */
let namesNow = null;
function matchNames(raw) {
  const id = raw && typeof raw === 'object' ? String(raw.matchId || '') : '';
  if (!/^[A-Za-z0-9-]{8,80}$/.test(id)) return null;
  const rr = optional('./riot-rounds');
  try { return rr && typeof rr.nameSetOf === 'function' ? rr.nameSetOf(id) : null; } catch { return null; }
}

function gateText(text, ctx, n) {
  const t = clip(text, 900);
  if (!t) return null;
  const rev = reviewMod();
  const fx = forensicsMod();
  const ng = optional('./name-gate');
  const BUY = rev && rev.BUY_BLAME ? rev.BUY_BLAME : /\b(buy|buying|bought|spawn|menu|menus|scoreboard)\b/i;
  const kept = gates.sentencesOf(t).filter((s) => {
    if (gates.shapeOf(s)) return false;
    if (BUY.test(s)) return false;
    if (namesNow && typeof namesNow.has === 'function' && namesNow.has(s)) return false;
    // The game's own capitals are no names ("your ACS of 382", "a 1.48 K/D"),
    // as the review route reads them (fact-gates.js lowerGameWords).
    if (ng && typeof ng.namesSomeone === 'function' && ng.namesSomeone(gates.lowerGameWords(s), { language: ctx.language || 'en' })) return false;
    if (fx && typeof fx.wrongKiller === 'function' && (ctx.killer || ctx.screen)
        && fx.wrongKiller(s, ctx.killer || null, ctx.screen ? 'screen' : 'riot', { language: ctx.language || 'en', agent: ctx.agent })) return false;
    return true;
  });
  const out = kept.join(' ').trim().slice(0, n);
  return out || null;
}

// ── normalise ──────────────────────────────────────────────────────────────

function entryOf(e, language) {
  if (!e || typeof e !== 'object') return null;
  const title = clip(e.title, 90);
  if (!title || gates.shapeOf(title)) return null;
  return {
    key: clip(e.key, 40) || null,
    title,
    detail: gateText(e.detail, { language }, 260),
    rounds: list(e.rounds, 24).filter((x) => int(x, 1, 40) !== null),
    count: int(e.count, 0, 40),
    fix: gateText(e.fix, { language }, 200),
  };
}

function feedOf(feed) {
  return list(feed, 24).map((k) => {
    if (!k || typeof k !== 'object') return null;
    const side = (v) => (v === 'me' || v === 'mate' || v === 'enemy' ? v : null);
    const s = num(k.s, 0, 300) !== null ? k.s : (num(k.ms, 0, 300000) !== null ? k.ms / 1000 : null);
    return { s: s === null ? null : Math.round(s * 10) / 10, by: side(k.by), on: side(k.on),
      ka: agentOf(k.ka), va: agentOf(k.va), w: gunOf(k.w) };
  }).filter((k) => k && k.on);
}

const RECORD_BUYS = new Set(['pistol', 'eco', 'force', 'half', 'full']);
const CHAT_BUY = { pistol: 'pistol round', eco: 'eco', force: 'force buy', half: 'half buy', full: 'full buy' };
/** A place of the map as the game data names it (a callout, its common name, an area, "A site"), or null. */
function placeOn(map, s) {
  const g = map ? (DATA.mapGeometry || {})[lower(map)] : null;
  const t = typeof s === 'string' ? lower(s.trim()) : '';
  if (!g || !Array.isArray(g.callouts) || !t) return null;
  for (const c of g.callouts) {
    const names = [c && c.n, c && c.a, c && /^[abc]$/i.test(String(c.s || '')) ? `${String(c.s).toUpperCase()} site` : c && c.s];
    const hit = names.find((x) => typeof x === 'string' && x && lower(x) === t);
    if (hit) return hit;
  }
  return null;
}
function recordOf(rr, m) {
  const out = {};
  const place = (s) => placeOn(m.map, s);
  if (place(rr.place)) out.place = place(rr.place);
  const kills = list(rr.killPlaces, 5).map(place).filter(Boolean);
  if (kills.length) out.killPlaces = kills;
  if (RECORD_BUYS.has(rr.buy)) out.buy = rr.buy;
  if (rr.mate === 'close' || rr.mate === 'far') out.mate = rr.mate;
  const ag = (DATA.agents || {})[agentOf(m.agent) || ''];
  const kit = ag && Array.isArray(ag.kit) ? ag.kit.map((k) => k && k.name).filter((k) => typeof k === 'string' && k) : [];
  const casts = list(rr.casts, 4).map((x) => {
    const name = x && typeof x.name === 'string' ? kit.find((k) => lower(k) === lower(x.name.trim())) : null;
    return name && int(x.n, 0, 20) !== null ? { name, n: x.n } : null;
  }).filter(Boolean);
  if (casts.length) out.casts = casts;
  if (rr.afk === true) out.afk = true;
  return out;
}

function cardOf(c, m) {
  if (!c || typeof c !== 'object') return null;
  const n = int(c.n, 1, 40);
  if (n === null) return null;
  const rr = c.riot && typeof c.riot === 'object' ? c.riot : null;
  const riot = rr ? {
    sec: num(rr.sec, 0, 300),
    killer: agentOf(rr.killer),
    weapon: gunOf(rr.weapon),
    firstDeath: bool(rr.firstDeath),
    firstKill: bool(rr.firstKill),
    kills: int(rr.kills, 0, 5),
    traded: tri(rr.traded),
    trades: int(rr.trades, 0, 5),
    alive: rr.alive && int(rr.alive.mates, 1, 5) !== null && int(rr.alive.enemies, 0, 5) !== null
      ? { mates: rr.alive.mates, enemies: rr.alive.enemies } : null,
    clutch: rr.clutch && int(rr.clutch.vs, 1, 5) !== null ? { vs: rr.clutch.vs, won: tri(rr.clutch.won) } : null,
    afterPlant: bool(rr.afterPlant),
    plantSite: /^[ABC]$/.test(String(rr.plantSite || '')) ? rr.plantSite : null,
    plantSec: num(rr.plantSec, 0, 300),
    feed: feedOf(rr.feed),
    // The round record beyond the feed (8.8, chat-context.js cardOf), each
    // left out when the client sent none: a place only as a callout of this
    // match's map, the buy and the distance only as their words, the casts
    // only as this agent's kit names with whole counts.
    ...recordOf(rr, m),
  } : null;
  const d = c.derived && typeof c.derived === 'object' ? c.derived : {};
  const derived = { sinceOwnKill: num(d.sinceOwnKill, 0, 300), afterPlantSec: num(d.afterPlantSec, 0, 300), spikeLeft: num(d.spikeLeft, 0, 60) };
  const sc = c.screen && typeof c.screen === 'object' ? c.screen : null;
  const callouts = gates.CALLOUTS(m.map);
  const screen = sc ? {
    // A spot that is not a callout of this map is no place to tell.
    spot: sc.spot && (!m.map || callouts.some((x) => lower(x) === lower(sc.spot))) ? clip(sc.spot, 40) : null,
    ult: sc.ult === 'ready' ? 'ready' : null,
    lookDigits: list(sc.lookDigits, 8).map((x) => (x && num(x.value, 0, 10000) !== null
      ? { value: x.value, unit: /^[a-z %]{1,12}$/i.test(String(x.unit || '')) ? lower(x.unit) : null } : null)).filter(Boolean),
  } : null;
  const lk = c.look && typeof c.look === 'object' ? c.look : null;
  let look = null;
  if (lk) {
    const killerCtx = { killer: riot && riot.killer, screen: lk.source === 'screen' || !c.verified, agent: m.agent, language: m.language };
    let cause = typeof lk.cause === 'string' && Object.prototype.hasOwnProperty.call(causes(), lk.cause) ? lk.cause : null;
    const what = gateText(lk.what, killerCtx, 260);
    const better = gateText(lk.better, killerCtx, 260);
    // A saved lost-duel whose better play moves the player is given without
    // its label (spec 8.3), whatever the client sent: the chat then teaches
    // what the look saw and never calls the fight fair.
    if (cause === 'lost-duel' && gates.phraseHit(better, kitOf(m.agent))) cause = null;
    look = {
      cause,
      fight: FIGHTS.has(lk.fight) ? lk.fight : null,
      change: CHANGES.has(lk.change) ? lk.change : null,
      what: cause === 'unclear' ? null : what,
      better: cause === 'unclear' ? null : better,
      source: lk.source === 'screen' ? 'screen' : 'riot',
    };
  }
  return {
    n,
    side: SIDES.has(c.side) ? c.side : null,
    result: c.result === 'won' || c.result === 'lost' ? c.result : null,
    died: bool(c.died),
    verified: bool(c.verified),
    watched: c.watched !== false,
    pistol: bool(c.pistol),
    planted: bool(c.planted),
    riot,
    derived,
    screen,
    look,
    why: gateText(c.why, { killer: riot && riot.killer, screen: !c.verified, agent: m.agent, language: m.language }, 320),
  };
}

function compsOf(c) {
  if (!c || typeof c !== 'object') return null;
  const team = (xs) => list(xs, 5).map((x) => {
    const agent = agentOf(x && x.agent);
    return agent ? { agent, role: roleOf(agent) } : null;
  }).filter(Boolean);
  const us = team(c.us);
  const them = team(c.them);
  return us.length || them.length ? { us, them } : null;
}

function valorantMatchOf(raw, language) {
  if (!raw || typeof raw !== 'object') return null;
  const m = {
    kind: 'valorant',
    id: clip(raw.id, 60) || null,
    matchId: /^[A-Za-z0-9-]{8,80}$/.test(String(raw.matchId || '')) ? raw.matchId : null,
    at: num(raw.at, 1e12, 1e13),
    day: DAY.test(String(raw.day || '')) ? raw.day : null,
    source: raw.source === 'riot' ? 'riot' : 'watched',
    verified: bool(raw.verified),
    endedEarly: bool(raw.endedEarly),
    map: mapOf(raw.map),
    agent: agentOf(raw.agent),
    mode: MODES.find((x) => lower(x) === lower(raw.mode)) || null,
    result: ['Victory', 'Defeat', 'Draw'].includes(raw.result) ? raw.result : null,
    score: /^\d{1,2}-\d{1,2}$/.test(String(raw.score || '')) ? raw.score : null,
    rounds: int(raw.rounds, 1, 40),
    language,
  };
  m.watched = list(raw.watched, 40).filter((n) => int(n, 1, 40) !== null);
  m.comps = compsOf(raw.comps);
  const sl = raw.scoreline && typeof raw.scoreline === 'object' ? raw.scoreline : null;
  m.scoreline = sl ? {
    kills: int(sl.kills, 0, 80), deaths: int(sl.deaths, 0, 80), assists: int(sl.assists, 0, 80),
    acs: int(sl.acs, 0, 1000), adr: int(sl.adr, 0, 1000), hs: num(sl.hs, 0, 100), mvp: sl.mvp === 'match' || sl.mvp === 'team' ? sl.mvp : null,
  } : null;
  m.against = list(raw.against, 6).map((a) => (a && AGAINST.has(a.label) && num(a.value, 0, 1000) !== null && num(a.baseline, 0, 1000) !== null
    ? { label: a.label, value: a.value, baseline: a.baseline, games: int(a.games, 1, 100) } : null)).filter(Boolean);
  const gr = raw.grade && typeof raw.grade === 'object' ? raw.grade : null;
  m.grade = gr && int(gr.score, 0, 100) !== null ? {
    score: gr.score, letter: /^[SABCD]$/.test(String(gr.letter || '')) ? gr.letter : null, provisional: bool(gr.provisional),
    categories: list(gr.categories, 6).map((c) => (c && clip(c.label, 24) ? {
      key: clip(c.key, 20), label: clip(c.label, 24), score: int(c.score, 0, 100),
      evidence: list(c.evidence, 6).map((e) => clip(e, 160)).filter((e) => e && !gates.shapeOf(e)),
    } : null)).filter(Boolean),
  } : null;
  const ls = raw.lists && typeof raw.lists === 'object' ? raw.lists : {};
  m.lists = {};
  for (const k of ['mistakes', 'strengths', 'missed', 'facts']) m.lists[k] = list(ls[k], 8).map((e) => entryOf(e, language)).filter(Boolean);
  m.patterns = list(raw.patterns, 10).map((p) => (p && gateText(p.text, { language }, 220) ? { key: clip(p.key, 20), text: gateText(p.text, { language }, 220) } : null)).filter(Boolean);
  m.cards = list(raw.cards, 40).map((c) => cardOf(c, m)).filter(Boolean).sort((a, b) => a.n - b.n);
  if (!m.rounds) m.rounds = m.cards.length || null;
  // THE SPIKE'S TIME LEFT AT A DEATH AFTER THE PLANT is the primer's timer,
  // stated and confirmed (game-rules.json spike.timer), less the seconds since
  // the plant: computed here, never sent, and none while the timer is withheld.
  const timer = stated('spike.timer', modeKey(m), m.at);
  for (const c of m.cards) {
    if (timer !== null && fin(c.derived.afterPlantSec) && c.derived.spikeLeft === null && c.derived.afterPlantSec <= timer) {
      c.derived.spikeLeft = Math.round((timer - c.derived.afterPlantSec) * 10) / 10;
    }
  }
  const co = raw.coach && typeof raw.coach === 'object' ? raw.coach : {};
  m.coach = { summary: gateText(co.summary, { language }, 700), focus: gateText(co.focus, { language }, 300) };
  m.verification = gateText(raw.verification, { language }, 400);
  m.dossier = null;
  return m;
}

function lolMatchOf(raw, language) {
  if (!raw || typeof raw !== 'object') return null;
  const sl = raw.scoreline && typeof raw.scoreline === 'object' ? raw.scoreline : {};
  const name = (v, n) => (/^[A-Za-z' .&]{1,30}$/.test(String(v || '')) ? clip(v, n) : null);
  const gr = raw.grade && typeof raw.grade === 'object' ? raw.grade : null;
  const ls = raw.lists && typeof raw.lists === 'object' ? raw.lists : {};
  const lists = {};
  for (const k of ['mistakes', 'strengths', 'missed']) lists[k] = list(ls[k], 8).map((e) => entryOf(e, language)).filter(Boolean);
  return {
    kind: 'lol',
    id: clip(raw.id, 60) || null,
    at: num(raw.at, 1e12, 1e13),
    day: DAY.test(String(raw.day || '')) ? raw.day : null,
    champion: name(raw.champion, 30),
    role: name(raw.role, 20),
    mode: name(raw.mode, 30),
    durationSec: num(raw.durationSec, 0, 6 * 3600),
    result: ['Victory', 'Defeat'].includes(raw.result) ? raw.result : null,
    scoreline: {
      kills: int(sl.kills, 0, 80), deaths: int(sl.deaths, 0, 80), assists: int(sl.assists, 0, 80),
      cs: int(sl.cs, 0, 2000), csAt10: int(sl.csAt10, 0, 300), ward: int(sl.ward, 0, 400), level: int(sl.level, 1, 18),
    },
    grade: gr && int(gr.score, 0, 100) !== null ? {
      score: gr.score, letter: /^[SABCD]$/.test(String(gr.letter || '')) ? gr.letter : null, provisional: bool(gr.provisional),
      categories: list(gr.categories, 6).map((c) => (c && clip(c.label, 24) ? { key: clip(c.key, 20), label: clip(c.label, 24),
        score: int(c.score, 0, 100), evidence: list(c.evidence, 6).map((e) => clip(e, 160)).filter(Boolean) } : null)).filter(Boolean),
    } : null,
    lists,
    deaths: list(raw.deaths, 30).map((d) => (d && num(d.atSec, 0, 6 * 3600) !== null
      ? { n: int(d.n, 1, 60), atSec: Math.round(d.atSec), fact: clip(d.fact, 120) } : null)).filter(Boolean),
    facts: list(raw.facts, 12).map((x) => clip(x, 200)).filter((x) => x && !gates.shapeOf(x)),
  };
}

function rowOf(r) {
  if (!r || typeof r !== 'object' || !clip(r.label, 24)) return null;
  return {
    label: clip(r.label, 24), matches: int(r.matches, 0, 400),
    won: int(r.won, 0, 400), lost: int(r.lost, 0, 400), known: int(r.known, 0, 400),
    winRate: num(r.winRate, 0, 100), grade: int(r.grade, 0, 100), letter: /^[SABCD]$/.test(String(r.letter || '')) ? r.letter : null,
    kd: num(r.kd, 0, 20), acs: int(r.acs, 0, 1000), adr: int(r.adr, 0, 1000), hs: num(r.hs, 0, 100),
  };
}

function playerOf(raw, language) {
  const p = raw && typeof raw === 'object' ? raw : {};
  const tr = p.tracker && typeof p.tracker === 'object' ? p.tracker : null;
  return {
    patterns: list(p.patterns, 6).map((x) => (x && clip(x.title, 90) && !gates.shapeOf(x.title) ? {
      key: clip(x.key, 40), title: clip(x.title, 90), matches: int(x.matches, 0, 40), of: int(x.of, 0, 40),
      trend: ['rising', 'falling', 'steady'].includes(x.trend) ? x.trend : null,
    } : null)).filter(Boolean),
    agentRow: rowOf(p.agentRow),
    mapRow: rowOf(p.mapRow),
    tracker: tr ? {
      queue: ['competitive', 'unrated'].includes(tr.queue) ? tr.queue : null,
      rank: RANK_WORDS.test(String(tr.rank || '')) ? tr.rank : null,
      peak: RANK_WORDS.test(String(tr.peak || '')) ? tr.peak : null,
      matches: int(tr.matches, 0, 500), kd: num(tr.kd, 0, 20), winRate: num(tr.winRate, 0, 100), hs: num(tr.hs, 0, 100),
      acs: int(tr.acs, 0, 1000), adr: int(tr.adr, 0, 1000), kpr: num(tr.kpr, 0, 5), dpr: num(tr.dpr, 0, 5), apr: num(tr.apr, 0, 5),
      agents: list(tr.agents, 3).map((a) => (a && agentOf(a.agent) ? { agent: agentOf(a.agent), matches: int(a.matches, 0, 500),
        winRate: num(a.winRate, 0, 100), kd: num(a.kd, 0, 20), acs: int(a.acs, 0, 1000) } : null)).filter(Boolean),
    } : null,
    recent: list(p.recent, 10).map((r) => (r && typeof r === 'object' ? {
      at: num(r.at, 1e12, 1e13), day: DAY.test(String(r.day || '')) ? r.day : null,
      map: mapOf(r.map), agent: agentOf(r.agent) || (language && /^[A-Za-z' .&]{1,30}$/.test(String(r.agent || '')) ? clip(r.agent, 30) : null),
      mode: MODES.find((x) => lower(x) === lower(r.mode)) || null,
      result: ['Victory', 'Defeat', 'Draw'].includes(r.result) ? r.result : null,
      score: /^\d{1,2}-\d{1,2}$/.test(String(r.score || '')) ? r.score : null,
      grade: int(r.grade, 0, 100),
    } : null)).filter(Boolean),
  };
}

/**
 * The v2 context, bounded and gated, whatever a client sent. Agents, guns
 * and maps against the game data, callouts against the map's list, cause
 * keys against CAUSES, fight and change against their lists, numbers in
 * range, lists clipped, free text gated (gateText). Never throws on a shape.
 */
function normalise(context) {
  const c = context && typeof context === 'object' ? context : {};
  const game = c.game === 'lol' ? 'lol' : 'valorant';
  const language = LANGS.has(c.language) ? c.language : 'en';
  let match;
  namesNow = game === 'lol' ? null : matchNames(c.match);
  try {
    match = game === 'lol' ? lolMatchOf(c.match, language) : valorantMatchOf(c.match, language);
  } finally {
    namesNow = null;
  }
  const a = c.ask && typeof c.ask === 'object' ? c.ask : {};
  const sw = a.switchedFrom && typeof a.switchedFrom === 'object' ? a.switchedFrom : null;
  const asked = int(a.round, 1, 40);
  const inMatch = (n) => n !== null && !!match && match.kind === 'valorant' && match.cards.some((x) => x.n === n);
  // THE ROUNDS WITH A CLIP ON THE PC (chat-clips.js): round numbers alone, each
  // a death of this match's own cards, never a path, a URL or a name.
  if (match && match.kind === 'valorant') {
    const raw = c.match && typeof c.match === 'object' ? c.match.clips : null;
    match.clips = chatClips.roundsOf(list(raw, 40)).filter((n) => match.cards.some((x) => x.n === n && x.died)).sort((p, q) => p - q);
  }
  return {
    v: 2,
    game,
    language,
    advanced: c.advanced === true,
    // The player's rank band (8.8, src/shared/rank-band.js), untrusted: one of
    // the four keys or left out, so a client that sends none is read as before.
    ...(RANK_BANDS.includes(c.rankBand) ? { rankBand: c.rankBand } : {}),
    match,
    player: playerOf(c.player, language),
    ask: {
      round: inMatch(asked) ? asked : null,
      // Every round the question names, from a client that reads them (chat-context.js roundsOf).
      rounds: [...new Set(list(a.rounds, MAX_ASKED_ROUNDS * 2).map((n) => int(n, 1, 40)).filter(inMatch))].slice(0, MAX_ASKED_ROUNDS),
      switchedFrom: sw ? { map: mapOf(sw.map), agent: agentOf(sw.agent), result: ['Victory', 'Defeat', 'Draw'].includes(sw.result) ? sw.result : null,
        score: /^\d{1,2}-\d{1,2}$/.test(String(sw.score || '')) ? sw.score : null, day: DAY.test(String(sw.day || '')) ? sw.day : null } : null,
    },
  };
}

// ── The facts the gates read ───────────────────────────────────────────────

const REGULATION = { standard: 24, swiftplay: 8 };
const TO_WIN = { standard: 13, swiftplay: 5 };
const modeKey = (m) => (/swift/i.test(String((m && m.mode) || '')) ? 'swiftplay' : 'standard');

/** The numbers standing through a round: 5 against 5, then after each kill. */
function standingsOf(card) {
  const out = [[5, 5]];
  const r = card.riot || {};
  let m = 5;
  let e = 5;
  for (const k of r.feed || []) {
    if (k.on === 'me' || k.on === 'mate') m -= 1;
    else if (k.on === 'enemy') e -= 1;
    if (m >= 0 && e >= 0) out.push([m, e]);
  }
  if (r.alive) out.push([r.alive.mates, r.alive.enemies]);
  return out;
}

/*
 * THE NUMBERS STANDING AT THE PLAYER'S DEATH AND RIGHT AFTER IT (bench:chat,
 * 23 Oct): from the kill feed where it holds the death, else from Riot's count
 * at it (`alive`, the player among the mates), the one after it a mate fewer.
 * A standing the death is said to leave is held to `after` (fact-gates.js
 * leftByDeath): the Abyss swiftplay's round 2 died 4 against 5 and left 3
 * against 5, and "leaving your team 4 against 5" passed as a standing it had.
 * `after` joins no list of the round's standings: "Tejo killed you while it
 * was 3 against 5" still drops there, where no feed is kept.
 */
function deathStandingsOf(card) {
  const none = { at: null, after: null };
  if (!card || !card.died) return none;
  const r = card.riot || {};
  let m = 5;
  let e = 5;
  for (const k of r.feed || []) {
    if (k.on === 'me') return { at: [m, e], after: [m - 1, e] };
    if (k.on === 'mate') m -= 1;
    else if (k.on === 'enemy') e -= 1;
  }
  return r.alive ? { at: [r.alive.mates, r.alive.enemies], after: [r.alive.mates - 1, r.alive.enemies] } : none;
}

/*
 * THE PRIMER'S PROVENANCE AS THE GATES READ IT: each number's subject, the
 * attribute it is of, its part, band and armour, and how it is shown. The
 * primer (game-primer.js) names attributes as its text says them ("head
 * damage", "hits to kill"); the gates read one word each.
 */
const ATTRIBUTE = {
  'head damage': ['head', 'head'], 'body damage': ['body', 'body'], 'leg damage': ['legs', 'legs'], 'legs damage': ['legs', 'legs'],
  'hits to kill': ['hits'], 'pellets to kill': ['hits'], 'time to kill': ['seconds'],
  'price': ['price'], 'credits': ['credits'], 'credits given up': ['credits'],
  'seconds': ['seconds'], 'seconds left': ['seconds'], 'draw time': ['seconds'], 'reload': ['seconds'], 'fire interval': ['seconds'],
  'points': ['points'], 'fire rate': ['rate'], 'magazine': ['magazine'],
  'range start': ['metres'], 'range end': ['metres'], 'metres': ['metres'], 'air burst distance': ['metres'],
  'health': ['health'], 'effective health': ['health'], 'capacity': ['armor'], 'pool': ['armor'],
  'share absorbed': ['percent'], 'run speed': ['percent'],
  'rounds': ['rounds'], 'rounds to win': ['rounds'], 'lead': ['rounds'], 'round': ['round'], 'score': ['score'],
  'pellets': ['pellets'], 'air burst pellets': ['pellets'], 'alt fire pellets': ['pellets'], 'aimed burst': ['count'],
  'count': ['count'], 'count with falloff': ['count'], 'losses in a row a save pays for': ['count'], 'kills': ['kills'],
  'ability description': ['any'], 'role description': ['any'],
};
const SUBJECT_WORDS = {
  win: ['win', 'won', 'winning'], loss: ['loss', 'lose', 'lost', 'losing'], kill: ['kill', 'kills'], plant: ['plant', 'planting', 'planted'],
  defuse: ['defuse', 'defusing'], spike: ['spike'], timer: ['timer', 'detonat', 'explod'], cap: ['cap', 'hold more', 'most you can hold'],
  start: ['start', 'begin'], surviving: ['surviv', 'stay alive', 'stays alive'], save: ['save', 'saving'], overtime: ['overtime'],
  beeps: ['beep'], ultimate: ['ult'], health: ['health', 'hp'], eco: ['eco'], buy: ['buy'], phase: ['buy phase'], pistol: ['pistol'],
  half: ['half', 'swap', 'sides'], match: ['first to', 'win the match', 'match'], unrated: ['unrated'], swiftplay: ['swiftplay'],
  deciding: ['deciding', 'decider'], cost: ['cost', 'costs'], round: ['round'],
};
const GENERIC = new Set(['a', 'an', 'the', 'of', 'in', 'after', 'and', 'second', 'third', 'row', 'later', 'rounds', 'credits', 'no', 'armour']);

function wordsFor(subject) {
  const ws = lower(subject).split(/[^a-z]+/).filter((w) => w && !GENERIC.has(w));
  const pick = ws.length > 1 ? ws.filter((w) => w !== 'round') : ws;
  const out = new Set();
  for (const w of pick) for (const x of SUBJECT_WORDS[w] || [w]) out.add(x);
  return [...out];
}

// The attributes the gates read (fact-gates.js), which the primer's
// provenance uses itself; the verbose names above are an older shape's.
const CANON = new Set(['hits', 'head', 'body', 'legs', 'damage', 'price', 'credits', 'seconds', 'rate', 'magazine', 'pellets',
  'health', 'percent', 'points', 'metres', 'kills', 'armor', 'rounds', 'round', 'score', 'count', 'losses', 'degrees', 'any']);
const KINDS = new Set(['gun', 'gear', 'agent', 'ability', 'rule', 'role']);

function normEntry(e) {
  if (!e || typeof e !== 'object' || !fin(e.value)) return null;
  let attribute = lower(e.attribute);
  let part = e.part ? (lower(e.part) === 'leg' ? 'legs' : lower(e.part)) : null;
  if (!CANON.has(attribute)) {
    const map = ATTRIBUTE[attribute];
    if (map) { attribute = map[0]; part = map[1] || part; }
    else if (!attribute && (e.subjectKind === 'ability' || e.subjectKind === 'role')) attribute = 'any';
    else return null;
  }
  const subject = e.subject ? String(e.subject) : null;
  const shownNum = fin(e.shown) ? e.shown : Number(String(e.shown == null ? '' : e.shown).replace('%', ''));
  const kind = KINDS.has(e.subjectKind) ? e.subjectKind
    : gunOf(subject) ? 'gun' : (DATA.gear || {})[subject] ? 'gear' : agentOf(subject) ? 'agent' : attribute === 'any' ? 'ability' : 'rule';
  const out = {
    subject: kind === 'gun' ? (gunOf(subject) || subject) : subject,
    subjectKind: kind,
    attribute,
    part,
    armor: e.armor == null ? null : (lower(e.armor) === 'no armour' || lower(e.armor) === 'none' ? 'none' : String(e.armor)),
    band: e.band && fin(e.band.from) && fin(e.band.to) ? { from: e.band.from, to: e.band.to } : null,
    // A share is said as a percentage: 66, never 0.66.
    value: attribute === 'percent' && fin(shownNum) ? shownNum : e.value,
    shown: fin(shownNum) ? shownNum : null,
    words: Array.isArray(e.words) && e.words.length ? e.words.map(String) : (kind === 'rule' && subject ? wordsFor(subject) : []),
  };
  if (out.attribute === 'metres' && !out.band) out.band = { from: out.value, to: out.value };
  return out;
}

const primerCache = new Map();
const PRIMER_TTL_MS = 10 * 60 * 1000;

/** The primer's numbers for a mode and a match's date, normalised, or [] with no primer. */
function primerFacts(mode, at) {
  const p = primerMod();
  if (!p || typeof p.provenance !== 'function') return [];
  const day = fin(at) ? Math.floor(at / 86400000) : 'now';
  const key = `${mode}|${day}|${p.patch || ''}`;
  const hit = primerCache.get(key);
  if (hit && Date.now() - hit.at < PRIMER_TTL_MS) return hit.facts;
  let raw = [];
  try { raw = p.provenance(mode, fin(at) ? { matchAt: at } : {}) || []; } catch { raw = []; }
  const facts = [];
  for (const e of raw) {
    const n = normEntry(e);
    if (!n) continue;
    facts.push(n);
    // The older shape's effective health and capacity are damage too; the
    // primer's own entries say so with an `also` of their own.
    if (lower(e.attribute) === 'effective health' || lower(e.attribute) === 'capacity') facts.push({ ...n, attribute: 'damage', part: null });
    if (n.attribute === 'any') for (const a of ['seconds', 'metres', 'kills', 'points', 'credits', 'percent', 'damage', 'health', 'count', 'rounds', 'hits']) facts.push({ ...n, attribute: a });
  }
  primerCache.set(key, { at: Date.now(), facts });
  while (primerCache.size > 20) primerCache.delete(primerCache.keys().next().value);
  return facts;
}

/** A stated rule's value as the primer may print it now, or null (the spike's timer, for the time left). */
function stated(id, mode, at) {
  const p = primerMod();
  if (!p || typeof p.stated !== 'function') return null;
  try {
    const v = p.stated(id, { mode, ...(fin(at) ? { matchAt: at } : {}) });
    return fin(v) ? v : null;
  } catch { return null; }
}

// Words never taken for a name the player typed: the game's, the app's, the calendar's.
const ECHO_SKIP = (() => {
  const out = new Set(['i', "i'm", "i've", "i'd", "i'll", 'ok', 'okay', 'gg', 'riot', 'valorant', 'occlara', 'ask', 'coach', 'home',
    'matches', 'stats', 'settings', 'review', 'deathmatch', 'range', 'mvp', 'acs', 'adr', 'kd', 'hs', 'rr', 'elo', 'op', 'ult',
    'january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december',
    'jan', 'feb', 'mar', 'apr', 'jun', 'jul', 'aug', 'sep', 'sept', 'oct', 'nov', 'dec',
    'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday', 'today', 'yesterday', 'tonight']);
  const ng = optional('./name-gate');
  const add = (s) => { for (const w of lower(s).split(/[^a-z0-9'/]+/)) if (w) out.add(w.replace(/'s$/, '')); };
  if (ng) { add(ng.PLAIN_WORDS); add(ng.GAME_WORDS); }
  for (const [agent, a] of Object.entries(DATA.agents || {})) {
    add(agent);
    for (const ab of (a && a.abilities) || []) add(ab);
    for (const k of (a && a.kit) || []) add(k && k.name);
  }
  for (const w of Object.keys(DATA.weapons || {})) add(w);
  for (const g of Object.keys(DATA.gear || {})) add(g);
  for (const m of MAPS) add(m);
  for (const w of Object.keys(DATA.mapCallouts || {})) add(w);
  for (const g of Object.values(DATA.mapGeometry || {})) for (const c of (g && g.callouts) || []) add(c && c.n);
  for (const titles of Object.values(gates.CAUSE_TITLES)) for (const t of titles) add(t);
  for (const m of MODES) add(m);
  return out;
})();

/*
 * AN ECHO OF A NAME THE PLAYER TYPED: every capitalised word of the player's
 * own messages that is no word of the game's or the calendar's and was not
 * the first word of its sentence. "My teammate Tessik kept baiting me" makes
 * Tessik one, and a reply that says it again drops that sentence.
 */
/*
 * THE COACH'S OWN WORDS NAME NOBODY: every word of the rules this file writes
 * and of the causes' definitions. Built on first use, since the rules are
 * declared below. With the game's capitals (fact-gates.js lowerGameWords),
 * they keep a word the player capitalised from counting as a name they typed:
 * "Why is my K/D bad?", "What happened in Overtime?" and "How do I play
 * Attack better?" had every sentence of the answer saying K/D, Overtime or
 * Attack dropped as an echo (the verifier's probe, 15 Oct).
 */
let ruleWordsMemo = null;
function ruleWords() {
  if (ruleWordsMemo) return ruleWordsMemo;
  const out = new Set();
  for (const text of [VALORANT_RULES, LEAGUE_RULES, RIOT_ONLY, NO_MATCH, HONEST_LINE, ...Object.values(causes())]) {
    for (const w of lower(text).split(/[^a-z0-9'/]+/)) if (w) out.add(w.replace(/'s$/, ''));
  }
  ruleWordsMemo = out;
  return out;
}
const gameWord = (t) => ECHO_SKIP.has(lower(t)) || ruleWords().has(lower(t)) || gates.lowerGameWords(t) === lower(t);

function echoOf(messages) {
  const out = new Set();
  for (const m of Array.isArray(messages) ? messages : []) {
    if (!m || m.role === 'assistant') continue;
    for (const sentence of gates.sentencesOf(String(m.content || ''))) {
      const toks = sentence.split(/[^\p{L}\p{N}'/]+/u).filter(Boolean);
      for (let i = 1; i < toks.length; i++) {
        const t = toks[i].replace(/'s$/, '');
        if (!/^\p{Lu}/u.test(t) || t.length < 2) continue;
        if (gameWord(t) || /^\d/.test(t) || /^R\d+$/.test(t)) continue;
        out.add(t);
      }
    }
  }
  return out;
}

/*
 * THE ROUNDS A QUESTION IS ABOUT, EACH TOLD IN FULL (bench:chat, 15 Oct). The
 * client sent the one round its question named (chat-context.js roundOf),
 * and "How do I win more Sheriff duels like rounds 5 and 6?" named none to it:
 * neither round reached the model in full, round 6 went as one line with no
 * look in it, and both wrong facts the person's read found were round 6's
 * ("Round 6 was also on attack, but it was not a confirmed Sheriff duel",
 * where its look has the player fighting Chamber from B Tree with a Sheriff).
 * So the question's own words are read here as the gates read a sentence
 * (fact-gates.js roundsNamed: "rounds 5 and 6", "rounds 5 to 7", "R5", "the
 * attack pistol round"), beside the client's round and its list, and every
 * one the match has is told in full, MAX_ASKED_ROUNDS at most, the client's
 * first. One round asked is the gates' asked round (`oneRound`); with two or
 * more, a sentence naming no round is about none of them.
 */
function askedRounds(input, messages) {
  const inp = input || {};
  const m = inp.match;
  if (!m || m.kind !== 'valorant' || !Array.isArray(m.cards) || !m.cards.length) return [];
  const has = new Set(m.cards.map((c) => c.n));
  const out = [];
  const add = (n) => { if (Number.isInteger(n) && has.has(n) && !out.includes(n)) out.push(n); };
  const a = inp.ask || {};
  add(a.round);
  for (const n of Array.isArray(a.rounds) ? a.rounds : []) add(n);
  const lastAsk = [...(Array.isArray(messages) ? messages : [])].reverse().find((x) => x && x.role !== 'assistant');
  const q = String((lastAsk && lastAsk.content) || '');
  if (q) {
    const light = { rounds: new Map(m.cards.map((c) => [c.n, { n: c.n, pistol: c.pistol, side: c.side }])), overtimeFrom: REGULATION[modeKey(m)] + 1 };
    for (const n of gates.roundsNamed(q, light)) add(n);
  }
  return out.slice(0, MAX_ASKED_ROUNDS);
}

const factsCache = new WeakMap();

/**
 * Everything the gates check a reply against, from the normalised context and
 * the conversation. The same input gives the same facts, so the prompt and
 * the gates read one account of the match.
 */
/*
 * ALIVE AT THE PLANT (the blind audit of 8.7.8). Two Sunset answers made "won
 * 0 of 9 after they planted" the player's own retake failure, where he died
 * before the plant in 5 of those 9. Where the player died before the plant in
 * half or more of a side's planted rounds, the prompt says so in a counted
 * line (record-claims.js plantLines), and the record gate drops a sentence
 * that still blames the player for it (checkTeamBlame). None for League.
 */
function plantLinesOf(f) {
  const rc = recordMod();
  if (!rc || typeof rc.plantLines !== 'function' || !f || f.game === 'lol') return [];
  try { return rc.plantLines(rc.contextOfChat(f)); } catch { return []; }
}

function factsOf(input, messages, opts) {
  const memo = input && typeof input === 'object' ? factsCache.get(input) : null;
  if (memo && memo.messages === messages) return memo.facts;
  const inp = input || {};
  const m = inp.match || null;
  const valorant = inp.game !== 'lol';
  const mode = valorant ? modeKey(m) : null;
  const lastAsk = [...(Array.isArray(messages) ? messages : [])].reverse().find((x) => x && x.role !== 'assistant');
  const asked = String((lastAsk && lastAsk.content) || '');
  const askedList = askedRounds(inp, messages);
  const final = m && /^(\d{1,2})-(\d{1,2})$/.exec(String(m.score || ''));
  const f = {
    game: valorant ? 'valorant' : 'lol',
    language: inp.language || 'en',
    matchId: m && m.matchId ? m.matchId : null,
    map: m && m.map ? m.map : null,
    agent: m && m.agent ? m.agent : null,
    // The match's mode, for the standing reader of ability-facts.js (a deathmatch is no five a side).
    mode: m && typeof m.mode === 'string' ? m.mode : null,
    askedAgents: gates.agentsIn(asked).map((a) => a.name),
    source: m ? m.source : null,
    verified: !!(m && m.verified),
    rounds: new Map(),
    // The match's own result and final score, which a claim of the match is
    // held to and never a round's (fact-gates.js claimsOf).
    matchResult: m ? ({ Victory: 'won', Defeat: 'lost', Draw: 'drew' })[m.result] || null : null,
    finalScore: final ? [Number(final[1]), Number(final[2])] : null,
    asked: askedList[0] || null,
    askedRounds: askedList,
    oneRound: askedList.length === 1,
    overtimeFrom: valorant ? REGULATION[mode] + 1 : null,
    numbers: [],
    counted: { pairs: new Set(), counts: new Set(), titles: [], roundSets: [], texts: [] },
    scores: [],
    days: [],
    primer: valorant ? primerFacts(mode, m && m.at) : [],
    echo: echoOf(messages),
    armor: null,
    // The agents each team had, from Riot's comps and every kill feed: whose
    // side a teammate or an enemy named alone against N is (fact-gates.js clutchOwner).
    sides: { mates: new Set(), enemies: new Set() },
  };
  const addNum = (attr, value, round) => { if (fin(value)) f.numbers.push({ attr, value, round: round == null ? null : round }); };
  // A counted text's numbers, each with its unit when it has one ("the first
  // 30 seconds" is seconds), else as a count, which stands for no time,
  // distance or game number (fact-gates.js matchHas).
  const harvest = (text) => {
    if (!text) return;
    // With its quotes straightened, as the gates read the sentence that quotes it.
    const t = gates.digitsOf(gates.straighten(String(text)));
    // The text itself too, for a sentence that quotes it (fact-gates.js quotesCounted).
    f.counted.texts.push(lower(t).replace(/\s+/g, ' '));
    const rev = reviewMod();
    if (rev && typeof rev.countPairs === 'function') for (const p of rev.countPairs(t)) f.counted.pairs.add(p);
    for (const x of t.matchAll(/\d+(?:\.\d+)?/g)) {
      const v = Number(x[0]);
      f.counted.counts.add(v);
      const attr = gates.attributeOf(t, x.index, x[0].length);
      addNum(attr && !/\?$/.test(attr) ? attr : '*', v, null);
    }
  };
  const day = (at) => {
    if (!fin(at)) return;
    const d = new Date(at);
    // The player's own day can be either side of the server's.
    for (const off of [-1, 0, 1]) f.days.push(new Date(at + off * 86400000).getUTCDate());
    f.days.push(d.getUTCDate());
  };
  const dayOf = (label) => { const x = /^(\d{1,2}) /.exec(String(label || '')); if (x) f.days.push(Number(x[1])); };
  const score = (s) => { const x = /^(\d{1,2})-(\d{1,2})$/.exec(String(s || '')); if (x) f.scores.push([Number(x[1]), Number(x[2])]); };

  for (const e of f.primer) if (e.attribute === 'score') f.scores.push([e.value, e.value]);

  if (m && m.kind === 'valorant') {
    score(m.score);
    day(m.at);
    dayOf(m.day);
    addNum('rounds', m.rounds);
    addNum('rounds', m.watched.length);
    const won = m.cards.filter((c) => c.result === 'won').length;
    const lost = m.cards.filter((c) => c.result === 'lost').length;
    addNum('rounds', won);
    addNum('rounds', lost);
    addNum('deaths', m.cards.filter((c) => c.died).length);
    const sl = m.scoreline || {};
    addNum('kills', sl.kills); addNum('deaths', sl.deaths); addNum('assists', sl.assists);
    // The deaths as "you died 21 times" says them (fact-gates.js gateCount).
    if (fin(sl.deaths)) f.counted.died = sl.deaths;
    addNum('acs', sl.acs); addNum('adr', sl.adr); addNum('percent', sl.hs);
    if (fin(sl.kills) && fin(sl.deaths) && sl.deaths > 0) addNum('kd', Math.round((sl.kills / sl.deaths) * 100) / 100);
    for (const a of m.against) {
      const attr = a.label === 'ACS' ? 'acs' : a.label === 'K/D' ? 'kd' : a.label === 'Headshot %' ? 'percent' : 'adr';
      addNum(attr, a.value); addNum(attr, a.baseline); addNum('matches', a.games);
    }
    if (m.grade) {
      addNum('grade', m.grade.score);
      for (const c of m.grade.categories) { addNum('grade', c.score); for (const e of c.evidence) harvest(e); }
    }
    for (const k of ['mistakes', 'strengths', 'missed', 'facts']) {
      for (const e of m.lists[k]) {
        harvest(e.detail); harvest(e.title);
        if (fin(e.count)) { f.counted.counts.add(e.count); addNum('*', e.count); }
        if (e.rounds.length) f.counted.roundSets.push(e.rounds);
        f.counted.titles.push(lower(gates.straighten(e.title)));
      }
    }
    for (const p of m.patterns) harvest(p.text);
    if (m.comps) {
      for (const x of m.comps.us) f.sides.mates.add(x.agent);
      for (const x of m.comps.them) f.sides.enemies.add(x.agent);
    }
    for (const c of m.cards) {
      for (const k of (c.riot && c.riot.feed) || []) {
        if (k.by === 'mate' && k.ka) f.sides.mates.add(k.ka);
        if (k.on === 'mate' && k.va) f.sides.mates.add(k.va);
        if (k.by === 'enemy' && k.ka) f.sides.enemies.add(k.ka);
        if (k.on === 'enemy' && k.va) f.sides.enemies.add(k.va);
      }
    }
    // Who killed the player how often, from the cards: "Skye killed you 7 times".
    const killers = new Map();
    for (const c of m.cards) if (c.riot && c.riot.killer) killers.set(c.riot.killer, (killers.get(c.riot.killer) || 0) + 1);
    for (const v of killers.values()) f.counted.counts.add(v);
    // The teammates the player traded across the match, the cards' own sum:
    // "you traded a teammate 4 times" was a count nobody stated (the round 3 audit).
    const tradedMates = m.cards.reduce((n, c) => n + (c.riot && fin(c.riot.trades) ? c.riot.trades : 0), 0);
    if (tradedMates > 0) { f.counted.counts.add(tradedMates); f.counted.tradedMates = tradedMates; }

    // The rounds, in order, with the running score before each.
    let team = 0;
    let enemy = 0;
    let known = true;
    const toWin = TO_WIN[mode];
    const reg = REGULATION[mode];
    for (const c of m.cards) {
      const r = c.riot || null;
      const before = [team, enemy];
      const matchPoint = known && (c.n <= reg ? (team === toWin - 1 || enemy === toWin - 1) : Math.abs(team - enemy) === 1);
      const feed = r && r.feed && r.feed.length ? r.feed : null;
      const times = [];
      if (feed) for (const k of feed) if (fin(k.s)) times.push(k.s);
      if (r && fin(r.sec)) times.push(r.sec);
      if (r && fin(r.plantSec)) times.push(r.plantSec);
      for (const v of Object.values(c.derived || {})) if (fin(v)) times.push(v);
      const weapons = { mine: new Set(), theirs: new Set(), mates: new Set(), all: new Set() };
      if (r && r.weapon) { weapons.theirs.add(r.weapon); weapons.all.add(r.weapon); }
      for (const k of feed || []) {
        if (!k.w) continue;
        weapons.all.add(k.w);
        if (k.by === 'me') weapons.mine.add(k.w);
        else if (k.by === 'enemy') weapons.theirs.add(k.w);
        else if (k.by === 'mate') weapons.mates.add(k.w);
      }
      // A gun the look names is the player's unless the look says whose it
      // was: "before his Classic killed you" is the killer's (fact-gates.js gunOwner).
      const lookText = `${(c.look && c.look.what) || ''} ${(c.look && c.look.better) || ''}`;
      for (const g of gates.gunsIn(lookText)) {
        if (gates.gunOwner(lookText, g) === 'theirs') weapons.theirs.add(g.name); else weapons.mine.add(g.name);
        weapons.all.add(g.name);
      }
      const death = deathStandingsOf(c);
      f.rounds.set(c.n, {
        n: c.n, side: c.side, result: c.result, died: c.died, verified: c.verified, watched: c.watched,
        pistol: c.pistol, matchPoint,
        planted: !!(r && (r.plantSite || fin(r.plantSec) || r.afterPlant)) || !!(c.planted),
        afterPlant: !!(r && r.afterPlant), firstDeath: !!(r && r.firstDeath), firstKill: !!(r && r.firstKill),
        kills: r ? r.kills : null, traded: r ? r.traded : null, trades: r ? r.trades : null, clutch: r ? r.clutch : null,
        killer: r ? r.killer : null, killerWeapon: r ? r.weapon : null, sec: r ? r.sec : null,
        plantSec: r ? r.plantSec : null, plantSite: r ? r.plantSite : null,
        feed, times, standings: standingsOf(c), weapons, atDeath: death.at, after: death.after,
        // The screen's spot of the death, for the order of events (record-claims.js checkOrder).
        spot: (c.screen && c.screen.spot) || null,
        look: c.look ? { cause: c.look.cause, what: c.look.what, better: c.look.better, fair: c.look.cause === 'lost-duel' } : null,
        lookDigits: (c.screen && c.screen.lookDigits) || [],
        before,
        // The round record beyond the feed (8.8, recordOf), for the record
        // gates (record-claims.js checkRecord) and the economy gate, each
        // only where the card has it.
        ...(r && r.place ? { place: r.place } : {}),
        ...(r && r.buy ? { buy: r.buy } : {}),
        ...(r && r.mate ? { mate: r.mate } : {}),
        ...(r && r.casts ? { casts: r.casts } : {}),
        ...(r && r.afk ? { afk: true } : {}),
      });
      if (r && fin(r.kills)) addNum('kills', r.kills, c.n);
      if (r && fin(r.trades)) addNum('times', r.trades, c.n);
      // The casts of the round (8.8, recordOf), so a reply may say them back.
      for (const x of (r && r.casts) || []) addNum('times', x.n, c.n);
      if (r && r.clutch) addNum('players', r.clutch.vs, c.n);
      if (c.result === 'won') team += 1;
      else if (c.result === 'lost') enemy += 1;
      else known = false;
      if (known) f.scores.push([team, enemy]);
    }
    // Whether the player was alive at the plant (record-claims.js plantLines,
    // the blind audit of 8.7.8): the line the prompt carries, its numbers
    // counted, so a reply may say them back.
    f.plantLines = plantLinesOf(f);
    for (const line of f.plantLines) harvest(line);
  }
  if (m && m.kind === 'lol') {
    day(m.at); dayOf(m.day);
    const sl = m.scoreline || {};
    for (const [k, attr] of [['kills', 'kills'], ['deaths', 'deaths'], ['assists', 'assists'], ['cs', 'cs'], ['csAt10', 'cs'], ['ward', 'vision']]) addNum(attr, sl[k]);
    // "You died 4 times" is the scoreline's 4 deaths, and was dropped as a
    // repeat nobody counted (the verifier's probe, 15 Oct; fact-gates.js gateCount).
    if (fin(sl.deaths)) f.counted.died = sl.deaths;
    addNum('*', sl.level);
    // A game's minutes are what the number gate reads "minutes" as (fact-gates.js AFTER_UNITS).
    if (fin(m.durationSec)) {
      addNum('*', Math.round(m.durationSec / 60)); addNum('seconds', m.durationSec);
      addNum('practice', Math.round(m.durationSec / 60)); addNum('practice', Math.floor(m.durationSec / 60));
    }
    if (m.grade) { addNum('grade', m.grade.score); for (const c of m.grade.categories) { addNum('grade', c.score); for (const e of c.evidence) harvest(e); } }
    for (const k of ['mistakes', 'strengths', 'missed']) for (const e of m.lists[k]) { harvest(e.detail); harvest(e.title); f.counted.titles.push(lower(gates.straighten(e.title))); }
    // Each death by the game's clock as the prompt writes it, "12 minutes 34
    // seconds in": both of its numbers, which the gate dropped as tied to nothing.
    for (const d of m.deaths) {
      addNum('*', Math.floor(d.atSec / 60)); addNum('*', d.atSec % 60); harvest(d.fact);
      addNum('practice', Math.floor(d.atSec / 60)); addNum('seconds', d.atSec % 60); addNum('seconds', d.atSec);
    }
    for (const x of m.facts) harvest(x);
  }
  const pl = inp.player || {};
  for (const p of pl.patterns || []) {
    addNum('matches', p.matches); addNum('matches', p.of); f.counted.titles.push(lower(gates.straighten(p.title)));
    // "In 5 of 6 matches", THE PLAYER's line, is a pair the reply may say back
    // ("5 of your last 6 matches", fact-gates.js pairWords): it was no pair the
    // count gate knew, and four honest lines of the round 3 audit opened on it.
    if (fin(p.matches) && fin(p.of)) { f.counted.pairs.add(`${p.matches}/${p.of}`); f.counted.counts.add(p.matches); }
  }
  for (const row of [pl.agentRow, pl.mapRow]) {
    if (!row) continue;
    addNum('matches', row.matches); addNum('*', row.won); addNum('*', row.lost); addNum('*', row.known);
    addNum('percent', row.winRate); addNum('grade', row.grade); addNum('kd', row.kd); addNum('acs', row.acs);
    addNum('adr', row.adr); addNum('percent', row.hs);
  }
  const tr = pl.tracker;
  if (tr) {
    addNum('matches', tr.matches); addNum('kd', tr.kd); addNum('percent', tr.winRate); addNum('percent', tr.hs);
    addNum('acs', tr.acs); addNum('adr', tr.adr);
    addNum('kills', tr.kpr); addNum('deaths', tr.dpr); addNum('assists', tr.apr);
    for (const a of tr.agents) { addNum('matches', a.matches); addNum('percent', a.winRate); addNum('kd', a.kd); addNum('acs', a.acs); }
  }
  for (const r of pl.recent || []) { score(r.score); addNum('grade', r.grade); day(r.at); dayOf(r.day); }
  /*
   * WHAT THE LIBRARY HOLDS ACROSS MATCHES (fact-gates.js gateLibrary, the
   * re-audit of 8.7.7): the patterns' pairs ("5 of 6"), and every average of
   * the player's own, the against line's baselines, the library's rows, the
   * tracker's numbers and a counted line that names an average ("your Duelist
   * average is 397"). A cross match number is one of these or it goes. And
   * this match's headshot rate against the player's own average, for the aim
   * gate's praise (gateAim).
   */
  const lib = { pairs: new Set(), averages: new Set() };
  const avg = (v) => { if (fin(v)) { lib.averages.add(v); lib.averages.add(Math.round(v)); } };
  for (const p of pl.patterns || []) if (fin(p.matches) && fin(p.of)) lib.pairs.add(`${p.matches}/${p.of}`);
  if (m && m.kind === 'valorant') for (const a of m.against || []) avg(a.baseline);
  for (const row of [pl.agentRow, pl.mapRow]) if (row) for (const k of ['winRate', 'grade', 'kd', 'acs', 'adr', 'hs']) avg(row[k]);
  if (tr) for (const k of ['kd', 'winRate', 'hs', 'acs', 'adr', 'kpr', 'dpr', 'apr']) avg(tr[k]);
  for (const t of f.counted.texts) for (const x of t.matchAll(/\baverage\s+(?:is\s+|of\s+|was\s+)?(\d+(?:\.\d+)?)/g)) avg(Number(x[1]));
  f.library = lib;
  const hsLine = m && m.kind === 'valorant' ? (m.against || []).find((a) => a.label === 'Headshot %') : null;
  f.aim = hsLine ? { hs: hsLine.value, baseline: hsLine.baseline, games: hsLine.games || null }
    : (m && m.kind === 'valorant' && m.scoreline && fin(m.scoreline.hs) ? { hs: m.scoreline.hs, baseline: null, games: null } : null);
  if (inp.ask && inp.ask.switchedFrom) { score(inp.ask.switchedFrom.score); dayOf(inp.ask.switchedFrom.day); }
  f.days = [...new Set(f.days)];
  if (opts && opts.armor) f.armor = opts.armor;
  if (input && typeof input === 'object') factsCache.set(input, { messages, facts: f });
  return f;
}

// ── Rendering ──────────────────────────────────────────────────────────────

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const dayLabel = (at, label) => label || (fin(at) ? `${new Date(at).getUTCDate()} ${MONTHS[new Date(at).getUTCMonth()]}` : null);
const sideWord = (s) => (s === 'attacking' ? 'attack' : s === 'defending' ? 'defence' : 'side unknown');
const resultWord = (r) => (r === 'Victory' ? 'won' : r === 'Defeat' ? 'lost' : r === 'Draw' ? 'drew' : null);
const scoreWords = (s) => (s ? s.replace('-', ' to ') : null);
const roundsText = (ns) => {
  if (!ns.length) return '';
  if (ns.length === 1) return `round ${ns[0]}`;
  const shown = ns.slice(0, 8);
  const rest = ns.length - shown.length;
  return rest > 0 ? `rounds ${shown.join(', ')} and ${rest} more` : `rounds ${shown.slice(0, -1).join(', ')} and ${shown[shown.length - 1]}`;
};

/** "Fracture, Jett, won 5 to 1, 13 Oct": how the reply names the match. */
function matchName(m) {
  if (!m) return null;
  if (m.kind === 'lol') return [m.champion, m.role, m.mode, m.result === 'Victory' ? 'won' : m.result === 'Defeat' ? 'lost' : null, dayLabel(m.at, m.day)].filter(Boolean).join(', ');
  const res = resultWord(m.result);
  return [m.map, m.agent, res && m.score ? `${res} ${scoreWords(m.score)}` : (m.score ? `at ${scoreWords(m.score)}` : res), dayLabel(m.at, m.day)]
    .filter(Boolean).join(', ');
}

/*
 * THE STATIC RULES, WORD FOR WORD (spec 8.5), then the primer's core for the
 * match's mode: the prefix every question of that mode shares, first in the
 * prompt so a provider's prefix cache can serve it.
 */
const VALORANT_RULES = `You are Occlara's Valorant coach, talking with the player after a match to help them learn from it. You are never told about a match being played right now, and you never give advice for one.

WHAT YOU ARE GIVEN, AND HOW FAR TO TRUST IT
- VALORANT FACTS: the game's rules and numbers as the game is now, exact. Every number you say about the game itself (damage, hits or time to kill, prices, credits, timers, ranges, ultimate points) must be one of these. If an answer needs a game number that is not there, say you do not have it. A match played before a patch can differ, and a number left out for this match is one a patch has changed since.
- RIOT'S RECORD: what happened in the match, exact: who won each round, every kill with its time, the agents and the gun, the plant, both team comps. It wins over everything else.
- READ OFF THE SCREEN: where the player was and what the HUD showed, including numbers a look read off the HUD. It can be wrong, and Riot's record wins where they disagree.
- COUNTED: the grade, its categories and their evidence, the counted mistakes, strengths and misses, the patterns across matches and the breakdown. Code counted them from the record, so they are true. Quote their numbers exactly, and never compute a new grade, score, percentage or count.
- THE COACH'S LOOK at a death: what the frames showed, the better play, and, when it has one, a label from a closed list. Quote a label and explain it by its definition. Never give a death a label it does not have, and never label a death the coach did not look at or one given to you without a label: tell what the look saw and teach its better play. If a better play moves the player, teach that, and never call the fight fair.
- THE COACH'S EARLIER WORDS: the review's summary, focus and round lines, written by a model from the same facts. Use them only where the facts agree.
- COACHING NOTES: habits to draw on where the facts match. Never quote one word for word, and never say where any advice comes from.

WHAT YOU MUST NOT SAY
- Nothing the facts do not hold. This match's record does not hold what anyone bought, the credits, the damage dealt and taken, or the utility used: if asked, say so and teach the rule instead.
- A save question: say first that the record does not hold what anyone bought, then teach the rule once, in one sentence: on attack a save means staying alive and out of fights until the spike goes off or the clock runs out, on defence it means not retaking a planted spike, and a player who has already died in the round made no save decision. Then move to the fight that killed them.
- No ranking of agents, no meta, no pick or win rates for the current patch: you do not have them. Answer from the kit, the player's own numbers and the facts.
- No player names, ever, even one the player typed: say your teammate, or the agent. No coach, player, team, video or other source for any advice.
- Only Valorant and the player's play.
- Nothing about the app, a future review, a page or a feature: never recommend one, and never say a review will check something. Teach the game alone.
- No number across the player's other matches but as the counted lines across matches and the against line give it, said as they say it ("in 5 of your last 6 matches", "your own average of 38%"), and no season, act or episode. A pattern of this match is this match's, never one across matches.

HOW TO ANSWER
- Answer the question in your first sentence, and answer the question that was asked. A question about aim, practice, an agent, the mental side, comms or the economy is answered about that, and a counted mistake comes in only where it bears on it. Never turn every answer into the same habit. If the question rests on something the facts contradict (a round called lost that was won, a death that did not happen), say so first, plainly, then answer what they meant.
- A general question (the biggest mistake, how to improve or climb, what to practise, how to warm up) needs no single round: answer it from the counted mistakes, the patterns across matches, the player's own numbers and their rank, with the one lever that matters most at that level. Never answer it with only that you cannot tell.
- About a round, a death or a play: tell it in order from the record (the side and the kind of round, the opening, the plant, the death with the numbers standing, how it ended), then the decision that decided it for the player, judged by what they could see at that moment, then what to do instead, written as the real situation to notice and the real move to make in it, concretely enough to do next round, and why it works in game terms: the guns and the range, the numbers standing, the clock and the spike, the kit. Rule out the larger causes before the shot: whether the fight needed taking, whether anyone could trade it, whether the player had information or utility first. When a death had both a decision and a shot that went wrong, name the decision first, then the one mechanic, in one sentence. Call a death lost on the shot only where the coach's look called the fight fair and lost on the shot.
- A fair fight is one taken from where it should be taken, at a range the gun can fight. Whether a teammate could trade it is a separate question.
- A death a teammate traded is not a mistake by itself, so never call the trade the problem. In a round the team lost, still judge whether the fight was needed, and never praise a death as a good or sound choice.
- About an agent: the player's own numbers on it first, then how its kit answers the problem, each ability by its name as the kit gives it, never by a key letter. Say what an ability does only as the kit says it. Name an enemy ability as what killed the player only where Riot's record gives that ability as the killing weapon.
- Asked for a game number the VALORANT FACTS hold (hits to kill, damage, a price, a timer), give it in your first sentence in the facts' own words, with the range band and the armour they name, then stop. Add nothing about the match unless asked.
- Name at most one ability in an answer about a round, and only when it changes the decision in that round. Do not list the kit, and do not offer the same ability in every answer.
- Never mention an ultimate orb, a health number, who carried the spike or how many players were alive unless the facts of that round state it.
- About improving: THE LEVER when it is given, else the largest counted mistake or pattern, with its count exactly as given, then one habit that answers it, written as the moment to notice and the move to make, then one drill to build it and what the player should see in their next match if it worked. One habit only: if several things are counted, say the others can wait. A habit or a drill carries no count or timer of your own, because every number you say must be one of the facts. When THE LEVER is given, lead with it, and name trading at most once, as a second point, unless THE LEVER is trading.
- Quote a counted line's numbers as given, the deaths nobody traded included: that count leaves out a death as the last one alive, which nobody could trade, so never count the rounds yourself into a total of your own.
- When you say what can wait, name it ("the trade check can wait"), never a stock closer such as "the other things can wait", "the rest can wait", "everything else can wait" or "nothing else needs fixing first", and vary how you close. Never make the team's record after the plant the player's own mistake in rounds the facts say they died before the plant, and never say the player beat or killed an agent in a round Riot's record does not have them killing.
- A practice drill must be one the player can do: Deathmatch and the Range have no teammates, so a team habit is practised in a match, with what to do when nobody answers the call, and Deathmatch has no abilities and neither mode has this match's enemy agents, so an agent's kit or a matchup is never practised in Deathmatch.
- When something went right, say what the player did and why it worked in game terms, from the record: a trade they made, a fight they took beside a teammate, a round they saved or won on the clock. Never praise a scoreboard number, never open with praise as a cushion, and never call the player unlucky or blame a teammate.
- Asked about their aim, answer from the deaths and the player's headshot rate against their own average. Where the coach's look called fights fair and lost on the shot, say so and give one aim habit. Where the deaths show the position, the timing, the numbers or nobody able to trade, name that first, then still give one aim habit sized to their rank. Where the coach looked at no death, say the look cannot tell whether the fights were lost on the shot. Never say aim is not the problem, or that aim can wait, unless the coach's looks called those deaths something else. Never praise the aim where the headshot rate is under their own average, and never call a fight the look called fair one that should not have been taken.
- Before advice about a round, read its side and whether the spike was down when the player died: on attack with no spike down the defenders never have to come to you, so waiting for them is no plan, and on defence with the spike down the defenders must retake.
- If the facts about the player give a rank, size the advice to it and never say it back. Below Platinum, one basic habit (stopping before the shot, crosshair height, information before a peek, one angle at a time). Platinum to Diamond, the decision before the fight (predictability, playing the team's plan, when to take space). Ascendant and up, no basics, the specific timing or utility change and what it risks. An answer for a higher rank is never the one a lower rank would get for the same facts in longer words.
- Name the match the first time you refer to it: the map, the agent and the result.
- Write times as seconds into the round, "8 s in", never as a clock such as 0:08, which reads as the time left.
- Speak to the player as you. Short paragraphs of plain text: no lists, no headings, no markdown. About 250 words, up to 400 when you walk through a round. Commas and periods, never dashes.
- Write for a player who does not know coaching words: say a teammate close enough to kill your killer, not trading distance, say the smoke, the flash or the drone by name, not utility, say take one piece of space and stop, not checkpoints, and never write impact, tempo, map control, situational awareness or utility potential.`;

const RIOT_ONLY = "This match was graded from Riot's record alone: there is no look and no counted mistake. Explain the facts, and when you suggest a change, say it is your reading of them.";
const NO_MATCH = 'The player has no match in front of you: answer from the game facts, and never describe their play.';

/*
 * LEAGUE IS ITS COMPUTED REVIEW AND NOTHING ELSE. No primer and no dossier:
 * the review is computed from the game client's own record and never
 * generated, and the rules say to answer from those facts alone, which the
 * number gate holds every number to.
 */
const LEAGUE_RULES = `You are Occlara's League of Legends coach, talking with the player after a game to help them learn from it. You are never told about a game being played right now, and you never give advice for one.

WHAT YOU ARE GIVEN
- THE GAME: what the game client recorded of it, and what code counted from that record: the grade, its categories and their evidence, the mistakes, strengths and misses, and every death by the game's clock. It is exact. Answer only from it: every number you say must be one of these, and if an answer needs one that is not there, say you do not have it.

WHAT YOU MUST NOT SAY
- Nothing the facts do not hold, nothing about where a fight happened or why, which the record does not show, and nothing from another game.
- No ranking of champions, no meta, no pick or win rates for the current patch.
- No player names, ever, even one the player typed. No coach, player, team, video or other source for any advice.

HOW TO ANSWER
- Answer the question in your first sentence. If it rests on something the facts contradict, say so first, plainly.
- About improving: the largest counted mistake with its count exactly as given, the habit that answers it, and one drill to build it.
- Name the game the first time you refer to it: the champion, the mode and the result.
- Speak to the player as you. Short paragraphs of plain text: no lists, no headings, no markdown. About 250 words. Commas and periods, never dashes.`;

/** The language line, outside English. */
function languageLine(language) {
  const name = promptName(language);
  return name === 'English' ? '' : `Write the whole reply in ${name}. Keep agent, ability, weapon and map names exactly as the game prints them.`;
}

/*
 * THE GUN TABLE GOES TO THE SLICES BY DEFAULT (bench:chat, 15 Oct). Spec 8.8's
 * switch: where the provider serves no part of the prompt from its cache, the
 * gun table leaves the core, which every question repeats, for a slice of the
 * guns the question names, the asked rounds' and every gun that killed the
 * player in the match, about 1,300 tokens a question less, the roster of the
 * agents on their keys kept in the core. Sol reported 0 cached tokens on every
 * call of the run, so it is what v2 does unless CHAT_PRIMER_GUNS=core puts the
 * table back ('table' says the same; 'slices' is the default it names).
 */
const gunsInCore = () => /^(?:core|table)$/i.test(String(process.env.CHAT_PRIMER_GUNS || '').trim());

function primerCore(input, variant) {
  if (input.game === 'lol' || variant === 'v2-noprimer') return '';
  const p = primerMod();
  if (!p || typeof p.core !== 'function') return '';
  const m = input.match;
  try {
    // The gun table moved to slices keeps the roster in the core (game-primer.js renderCore).
    const guns = gunsInCore();
    return String(p.core(modeKey(m), { ...(m && fin(m.at) ? { matchAt: m.at } : {}), guns, ...(guns ? {} : { roster: true }) }) || '').trim();
  } catch { return ''; }
}

/*
 * THE LEVER ONLY BELOW PLATINUM (the blind audit of 8.7.8 against 8.7.7, Nov
 * 2026). At Platinum to Diamond and Ascendant and up the lever by band picked
 * a lever the record did not support and the model invented evidence for it,
 * so Ask Coach there asked about improving is 8.7.7's: no LEVER line
 * (leverLine), and the improving rule as 8.7.7 wrote it. Every gate of 8.7.8
 * stays for every band, since a gate only drops false text. Iron to Gold and a
 * client that sends no band keep 8.7.8's prompt.
 */
const LEVER_BANDS = ['iron_bronze', 'silver_gold'];
const IMPROVING_RULE = "- About improving: THE LEVER when it is given, else the largest counted mistake or pattern, with its count exactly as given, then one habit that answers it, written as the moment to notice and the move to make, then one drill to build it and what the player should see in their next match if it worked. One habit only: if several things are counted, say the others can wait. A habit or a drill carries no count or timer of your own, because every number you say must be one of the facts. When THE LEVER is given, lead with it, and name trading at most once, as a second point, unless THE LEVER is trading.";
const IMPROVING_RULE_877 = '- About improving: the largest counted mistake or pattern with its count exactly as given, then one habit that answers it, written as the moment to notice and the move to make, then one drill to build it and what the player should see in their next match if it worked. One habit only: if several things are counted, say the others can wait. A habit or a drill carries no count or timer of your own, because every number you say must be one of the facts.';
/** The Valorant rules for a band: 8.7.7's improving rule above Gold, else VALORANT_RULES. */
function rulesFor(input) {
  const band = input && input.rankBand;
  if (!RANK_BANDS.includes(band) || LEVER_BANDS.includes(band)) return VALORANT_RULES;
  return VALORANT_RULES.replace(IMPROVING_RULE, IMPROVING_RULE_877);
}

function staticPrefix(input, variant) {
  if (input.game === 'lol') return LEAGUE_RULES;
  const core = primerCore(input, variant);
  const rules = rulesFor(input);
  return core ? `${rules}\n\n${core}` : `${rules}\n\nVALORANT FACTS: none are available for this question, so state no game number at all.`;
}

function renderPlayer(input, trim) {
  const p = input.player || {};
  const lines = [];
  const game = input.game === 'lol' ? 'League' : 'Valorant';
  for (const x of (p.patterns || []).slice(0, trim ? 3 : 6)) {
    // With the words to say it in, so a true cross match number reaches the
    // player as the library holds it (fact-gates.js gateLibrary, the re-audit of 8.7.7).
    lines.push(`- Across their last recorded ${game} matches (counted): "${x.title}" in ${x.matches} of ${x.of} matches${x.trend ? `, ${x.trend}` : ''}. Said to the player: in ${x.matches} of your last ${x.of} matches.`);
  }
  const row = (r, what) => {
    if (!r) return;
    const bits = [`${r.matches} matches in the library`];
    if (fin(r.known) && r.known) bits.push(`won ${r.won} of the ${r.known} with a result`);
    if (fin(r.grade)) bits.push(`average grade ${r.grade}${r.letter ? ` ${r.letter}` : ''}`);
    if (fin(r.kd)) bits.push(`K/D ${r.kd}`);
    if (fin(r.acs)) bits.push(`ACS ${r.acs}`);
    if (fin(r.adr)) bits.push(`ADR ${r.adr}`);
    if (fin(r.hs)) bits.push(`headshot ${r.hs}%`);
    lines.push(`- On ${what} ${r.label} (counted from the library): ${bits.join(', ')}.`);
  };
  row(p.agentRow, 'the agent');
  row(p.mapRow, 'the map');
  const t = p.tracker;
  if (t) {
    const bits = [];
    if (t.rank) bits.push(`rank ${t.rank}`);
    if (t.peak) bits.push(`peak ${t.peak}`);
    if (fin(t.kd)) bits.push(`K/D ${t.kd}`);
    if (fin(t.winRate)) bits.push(`win rate ${t.winRate}%`);
    if (fin(t.hs)) bits.push(`headshot ${t.hs}%`);
    if (fin(t.acs)) bits.push(`ACS ${t.acs}`);
    if (fin(t.adr)) bits.push(`ADR ${t.adr}`);
    if (fin(t.kpr) && fin(t.dpr)) bits.push(`per round ${t.kpr} kills, ${t.dpr} deaths${fin(t.apr) ? `, ${t.apr} assists` : ''}`);
    const ag = t.agents.map((a) => `${a.agent} ${a.matches} matches${fin(a.winRate) ? `, ${a.winRate}% won` : ''}${fin(a.kd) ? `, K/D ${a.kd}` : ''}`).join('; ');
    if (bits.length) {
      lines.push(`- Riot's tracker profile, over their last ${fin(t.matches) ? `${t.matches} ` : ''}${t.queue || 'competitive'} matches, not this match's numbers: ${bits.join(', ')}.${ag ? ` Most played: ${ag}.` : ''}`);
    }
  }
  // Only when the client sent a band (8.8): none leaves this block as it was.
  const band = input.game === 'lol' ? null : BAND_WORDS[input.rankBand];
  if (band) {
    lines.push(`- Their rank band: ${band[0]}. Fit the advice to that level and name the one ${band[1]} that matters most there, and never prescribe a high rank micro decision to a lower band. Never say their rank or band back to them, just give advice that fits it.`);
  }
  const recent = (p.recent || []).slice(0, trim ? 3 : 8).map((r) => [dayLabel(r.at, r.day), r.map, r.agent, r.result && r.score ? `${resultWord(r.result)} ${scoreWords(r.score)}` : resultWord(r.result),
    r.mode, fin(r.grade) ? `grade ${r.grade}` : null].filter(Boolean).join(', '));
  if (recent.length) lines.push(`- Their recent matches in the library, newest first: ${recent.join('; ')}.`);
  return lines.length ? `THE PLAYER (their own numbers)\n${lines.join('\n')}` : 'THE PLAYER\n- Nothing counted yet.';
}

function cardLine(c, m) {
  const r = c.riot;
  const bits = [`R${c.n} ${sideWord(c.side)}${c.pistol ? ', pistol round' : ''}, ${c.result || 'result unknown'}.`];
  if (!c.watched && m.source !== 'riot') bits.push('Not watched by the coach.');
  if (c.died) {
    let d = r && fin(r.sec) ? `Died ${Math.round(r.sec)} s in` : 'Died';
    if (r && r.killer) d += ` to ${r.killer}${r.weapon ? ` with ${withArticle(r.weapon)}` : ''}`;
    if (r && r.alive) d += `, ${r.alive.mates} against ${r.alive.enemies} standing`;
    if (r && r.firstDeath) d += ', the first death of the round';
    if (r && r.traded === true) d += ', traded by a teammate';
    // The last one alive had nobody to trade them, and the counted line of
    // deaths nobody traded leaves such a death out (insights.js diedAlone):
    // said so here, so the cards and the count tell the same number.
    if (r && r.traded === false) d += r.alive && r.alive.mates <= 1 ? ', not traded, as the last one alive with no teammate left to trade it' : ', not traded';
    // Riot's place of the death and the nearest teammate then (8.8, recordOf).
    if (r && r.place) d += `, at ${r.place}`;
    if (r && r.mate) d += r.mate === 'close' ? ', with a teammate close by' : ', with no teammate close by';
    if (r && r.afterPlant) d += ', after the plant';
    bits.push(`${d}.`);
  } else if (c.verified) {
    bits.push('Survived.');
  }
  if (r && r.killPlaces) bits.push(`Kills where the enemy fell: ${r.killPlaces.join(', ')}.`);
  if (r && r.buy) bits.push(`Team economy: ${CHAT_BUY[r.buy]}.`);
  if (r && r.casts) {
    const used = r.casts.filter((x) => x.n > 0);
    bits.push(used.length ? `Abilities used: ${used.map((x) => `${x.name} ${x.n === 1 ? 'once' : x.n === 2 ? 'twice' : `${x.n} times`}`).join(', ')}.` : 'No ability used.');
  }
  if (r && r.afk) bits.push('Riot marks the player as sitting this round out, so nothing in it is their mistake.');
  if (r && fin(r.kills) && r.kills > 0) bits.push(`${r.kills} kill${r.kills === 1 ? '' : 's'}${r.firstKill ? ', the first kill of the round' : ''}.`);
  if (r && fin(r.trades) && r.trades > 0) bits.push(`Traded a teammate ${r.trades === 1 ? 'once' : `${r.trades} times`}.`);
  if (r && r.clutch) bits.push(`Last one standing against ${r.clutch.vs}${r.clutch.won === true ? ', and won it' : r.clutch.won === false ? ', lost it' : ''}.`);
  if (r && (r.plantSite || fin(r.plantSec))) bits.push(`Spike planted${r.plantSite ? ` at ${r.plantSite}` : ''}${fin(r.plantSec) ? ` ${Math.round(r.plantSec)} s in` : ''}.`);
  if (c.look) bits.push(c.look.cause ? `Coach's look: ${gates.CAUSE_TITLES[c.look.cause] ? gates.CAUSE_TITLES[c.look.cause][0] : c.look.cause}.` : "Coach's look: given without a label.");
  return bits.join(' ');
}

/*
 * THE ROUND IN ORDER, as Riot's kill feed has it: who killed whom, by agent
 * and side, with what, in seconds into the round, the plant among them, and
 * the numbers standing after each. A kill the feed names no agent for (a
 * review saved before 8.5.0, or a server from before) says "a teammate" or
 * "an enemy". Never a name.
 */
function feedLines(c, m) {
  const r = c.riot;
  if (!r || !r.feed || !r.feed.length) return null;
  const who = (side, agent) => {
    if (side === 'me') return `you${m.agent ? ` (${m.agent})` : ''}`;
    if (side === 'mate') return agent ? `your teammate's ${agent}` : 'a teammate';
    if (side === 'enemy') return agent ? `their ${agent}` : 'an enemy';
    return 'a player';
  };
  const events = r.feed.map((k) => ({ s: k.s, k }));
  if (fin(r.plantSec)) events.push({ s: r.plantSec, plant: true });
  events.sort((a, b) => (a.s == null ? 999 : a.s) - (b.s == null ? 999 : b.s));
  let mates = 5;
  let enemies = 5;
  const out = [];
  for (const e of events) {
    const at = fin(e.s) ? `${Math.round(e.s)} s in` : 'at a time Riot did not record';
    if (e.plant) { out.push(`${at}, the spike went down${r.plantSite ? ` at ${r.plantSite}` : ''}`); continue; }
    const k = e.k;
    if (k.on === 'me' || k.on === 'mate') mates -= 1; else if (k.on === 'enemy') enemies -= 1;
    const victim = k.on === 'me' ? 'you' : who(k.on, k.va);
    const gun = k.w ? ` with ${withArticle(k.w)}` : '';
    const same = !k.by || (k.by === k.on && k.on !== 'me') || (k.by === 'mate' && k.on === 'me');
    const said = same ? `${victim} died` : `${who(k.by, k.ka)} killed ${victim}${gun}`;
    out.push(`${at}, ${said} (then ${Math.max(0, mates)} against ${Math.max(0, enemies)})`);
  }
  return `Kills in order, from Riot's record: ${out.join('; ')}.`;
}

function lookLines(c) {
  const lk = c.look;
  if (!lk) return null;
  const timing = lk.source === 'screen' ? " Its frames were timed from the coach's read of the screen, not Riot's record." : '';
  if (lk.cause === 'unclear') return `The coach looked at this death and its frames did not show the fight, so it has nothing it saw to teach.${timing}`;
  const saw = [lk.what ? `it saw: ${lk.what}` : null, lk.better ? `its better play: ${lk.better}` : null].filter(Boolean).join(' And ');
  if (!lk.cause) {
    return `The coach's look at this death, ${saw || 'with no sentences kept'}. It is given to you without a label: tell what the look saw and teach its better play, and never call the fight fair.${timing}`;
  }
  const def = (causes()[lk.cause] || '').trim();
  const title = gates.CAUSE_TITLES[lk.cause] ? gates.CAUSE_TITLES[lk.cause][0] : lk.cause;
  return `The coach's look at this death, ${saw || 'with no sentences kept'}. Its label: ${title}${def ? `, which means ${def}` : ''}.${timing}`;
}

/*
 * HOW TO USE THE ROUND RECORD (8.8, recordOf), in the match's own part, one
 * sentence for each kind of fact its round lines carry: the record holds the
 * economy and the abilities only where a line gives them (the rules' "does
 * not hold" is about every other round), the place and the teammate's
 * distance are the evidence for a trade or a spacing point, the economy
 * changes the lesson, and a round Riot says the player sat out is never
 * criticised. A match whose cards carry none of them has no line, and its
 * part is as before, byte for byte.
 */
const RECORD_USE = {
  held: "Where a round line gives the team economy or the abilities used, Riot's record holds them for that round and no other, so say them only there and as the line gives them.",
  mate: 'Where a line says where the player died and whether a teammate was close, that is the evidence for a trade or a spacing point: with no teammate close the lesson is where they stood, and with one close and nobody trading it is when they took the fight.',
  buy: 'The team economy changes what a death teaches: a death on an eco or a pistol round costs little and is no mistake the way one on a full buy is.',
  casts: "A point about the player's abilities needs a round that lists the abilities used, and a round saying no ability used is the evidence for one.",
  afk: 'Never criticise a round Riot marks the player as sitting out.',
};
function recordUseLine(m) {
  const rs = ((m && m.cards) || []).map((c) => c && c.riot).filter(Boolean);
  const has = (k) => rs.some((r) => r[k]);
  const parts = [
    has('buy') || has('casts') ? RECORD_USE.held : null,
    has('mate') ? RECORD_USE.mate : null,
    has('buy') ? RECORD_USE.buy : null,
    has('casts') ? RECORD_USE.casts : null,
    has('afk') ? RECORD_USE.afk : null,
  ].filter(Boolean);
  return parts.length ? `THE ROUND RECORD\n${parts.join(' ')}` : '';
}

/*
 * RIOT'S ROUND RECORD AS RETRIEVAL SIGNALS (8.8, knowledge.js recordSignals):
 * the cards' buy, teammate distance, place, casts and AFK as the rows the
 * signals are read from, the asked round alone (its one death enough) or the
 * whole match. Null where no card carries any, and the notes and the cases
 * are chosen as before.
 */
function recordSignalsFor(k, cards, one) {
  if (!k || typeof k.recordSignals !== 'function') return null;
  const rows = (cards || []).filter((c) => c && c.riot && (c.riot.buy || c.riot.mate || c.riot.place || c.riot.casts || c.riot.afk)).map((c) => {
    const r = c.riot;
    const after = !!(r.afterPlant || (fin(r.plantSec) && fin(r.sec) && r.sec > r.plantSec));
    return { n: c.n, died: !!c.died, result: c.result, buy: r.buy || null, mate: r.mate || null, traded: r.traded,
      lastAlive: !!(r.alive && r.alive.mates <= 1), place: r.place || null, early: !!(c.died && fin(r.sec) && r.sec <= 30 && !after),
      casts: r.casts || null, afk: r.afk === true };
  });
  return rows.length ? k.recordSignals(rows, one ? { min: 1 } : {}) : null;
}

function renderMatch(input, facts, trim) {
  const m = input.match;
  if (!m) return `THE MATCH\n${NO_MATCH}`;
  if (m.kind === 'lol') {
    const lines = [`THE GAME (${matchName(m)})`];
    const sl = m.scoreline;
    lines.push(`- Scoreline: ${[fin(sl.kills) ? `${sl.kills} kills` : null, fin(sl.deaths) ? `${sl.deaths} deaths` : null, fin(sl.assists) ? `${sl.assists} assists` : null,
      fin(sl.cs) ? `${sl.cs} CS` : null, fin(sl.csAt10) ? `${sl.csAt10} CS at 10 minutes` : null, fin(sl.ward) ? `vision score ${sl.ward}` : null, fin(sl.level) ? `level ${sl.level}` : null]
      .filter(Boolean).join(', ')}.`);
    if (m.grade) lines.push(`- Grade (counted): ${m.grade.score}${m.grade.letter ? ` ${m.grade.letter}` : ''}. ${m.grade.categories.map((c) => `${c.label} ${fin(c.score) ? c.score : 'not measured'}${c.evidence.length ? `: ${c.evidence.join('; ')}` : ''}`).join('. ')}.`);
    for (const [k, head] of [['mistakes', 'Mistakes'], ['strengths', 'Went well'], ['missed', 'Missed']]) {
      for (const e of m.lists[k]) lines.push(`- ${head} (counted): ${e.title}${e.detail ? `: ${e.detail}` : ''}${e.fix ? ` Fix: ${e.fix}` : ''}`);
    }
    if (m.deaths.length) lines.push(`- Every death by the game's clock: ${m.deaths.map((d) => `${Math.floor(d.atSec / 60)} minutes ${d.atSec % 60} seconds in, ${d.fact}`).join('; ')}`);
    for (const x of m.facts) lines.push(`- ${x}`);
    return lines.join('\n');
  }
  const lines = [];
  lines.push(`THE MATCH (${matchName(m) || 'a match'}${m.mode ? `, ${m.mode}` : ''}${m.rounds ? `, ${m.rounds} rounds` : ''})`);
  if (m.source === 'riot') lines.push(RIOT_ONLY);
  if (m.endedEarly) lines.push("The coach thought this match was over before it was, and it went on: Riot's record has all of it.");
  if (m.verification) lines.push(m.verification);
  else if (!m.verified) lines.push("Not checked against Riot's record: the rounds are what the screen read, and a round can be a round off.");
  if (m.comps) {
    const team = (xs) => xs.map((x) => `${x.agent}${x.role ? ` (${x.role})` : ''}`).join(', ');
    lines.push(`TEAMS, from Riot's record: yours ${team(m.comps.us) || 'unknown'}; theirs ${team(m.comps.them) || 'unknown'}.`);
  }
  const counted = [];
  const sl = m.scoreline;
  if (sl && fin(sl.kills)) {
    counted.push(`- Scoreboard (Riot's): ${sl.kills} kills, ${sl.deaths} deaths, ${sl.assists} assists${fin(sl.acs) ? `, ACS ${sl.acs}` : ''}${fin(sl.adr) ? `, ADR ${sl.adr}` : ''}${fin(sl.hs) ? `, headshot ${sl.hs}%` : ''}${sl.mvp === 'match' ? ', match MVP' : sl.mvp === 'team' ? ', team MVP' : ''}.`);
  }
  if (m.against.length) counted.push(`- Against their own average in the role: ${m.against.map((a) => `${a.label} ${a.value} against ${a.baseline}${a.games ? ` over ${a.games} matches` : ''}`).join('; ')}.`);
  // The headshot rate as a finished sentence: the aim answers' one cross match
  // number, said as the library holds it (gateLibrary, gateAim's praise).
  const hsAgainst = m.against.find((a) => a.label === 'Headshot %');
  if (hsAgainst) counted.push(`- Said to the player: your headshot rate this match was ${hsAgainst.value}%, against your own average of ${hsAgainst.baseline}%${hsAgainst.games ? ` over your last ${hsAgainst.games} matches` : ''}.`);
  if (m.grade) {
    counted.push(`- Grade: ${m.grade.score}${m.grade.letter ? ` ${m.grade.letter}` : ''}${m.grade.provisional ? ' (provisional)' : ''}. ${m.grade.categories.map((c) => `${c.label} ${fin(c.score) ? c.score : 'not measured'}${c.evidence.length ? ` (${c.evidence.join('; ')})` : ''}`).join('. ')}.`);
  }
  const entry = (head, e) => `- ${head}: ${e.title}${e.rounds.length ? `, ${roundsText(e.rounds)}` : ''}${e.detail ? `. ${e.detail}` : ''}${e.fix ? ` Fix: ${e.fix}` : ''}`;
  for (const e of m.lists.mistakes) counted.push(entry('Repeated mistake', e));
  for (const e of m.lists.strengths) counted.push(entry('Went well', e));
  for (const e of m.lists.missed) counted.push(entry('Missed', e));
  for (const e of m.lists.facts) counted.push(entry("What Riot's record shows", e));
  for (const p of m.patterns) counted.push(`- Pattern: ${p.text}`);
  for (const line of (facts && facts.plantLines) || []) counted.push(`- Alive at the plant: ${line}`);
  if (counted.length) lines.push(`COUNTED (code counted these from the record, so they are true; quote their numbers exactly)\n${counted.join('\n')}`);

  // EVERY ROUND A LINE, the asked ones too, so the match's part of the prompt
  // is the same for every question of it (buildParts); the rounds a question
  // is about are told in full after it (renderAsked).
  const ledger = m.cards.map((c) => (trim ? cardLine(c, m).replace(/ Coach's look: [^.]*\./, '') : cardLine(c, m)));
  if (ledger.length) lines.push(`ROUNDS (Riot's record unless marked; times are seconds into the round)\n${ledger.join('\n')}`);
  const use = recordUseLine(m);
  if (use) lines.push(use);
  const clips = renderClips(m);
  if (clips) lines.push(clips);
  return lines.join('\n');
}

/*
 * THE PLAYER'S CLIPS (chat-clips.js): which deaths of this match the player
 * can watch, and how to put one under the paragraph about it. Nothing at all
 * when no round has a clip, so a match without one is told as before, byte
 * for byte.
 */
function renderClips(m) {
  const rounds = m && Array.isArray(m.clips) ? m.clips : [];
  if (!rounds.length) return '';
  const one = rounds[0];
  return `CLIPS\nThe player has a recorded clip of their death in ${roundsText(rounds)}. When a death in one of these rounds is a main example in your answer, name the round by its number in that paragraph and end the paragraph with [clip:r${one}] for round ${one}, so the clip plays under your words. At most ${chatClips.MAX_CLIPS} clips in a reply, one a round, only for the rounds listed here, and never mention the marker or the clip's file.`;
}

/**
 * The rounds a question is about, each in full (askedRounds): its line, the
 * kill feed in order with the plant among it, the numbers computed from it,
 * what the screen read and the coach's look, and, when the match's part left
 * the coach's earlier lines of its rounds out (`withWhy`), its own.
 */
function renderAsked(input, rounds, withWhy) {
  const m = input.match;
  if (!m || m.kind !== 'valorant') return '';
  const out = [];
  for (const n of rounds || []) {
    const c = m.cards.find((x) => x.n === n);
    if (!c) continue;
    const full = [`ROUND ${c.n} IN FULL`, cardLine(c, m)];
    const feed = feedLines(c, m);
    if (feed) full.push(feed);
    else if (c.verified) full.push("Riot's kill feed of this round is not in the record the app holds, so tell only the facts above.");
    const d = c.derived || {};
    const dd = [];
    if (fin(d.sinceOwnKill)) dd.push(`${d.sinceOwnKill} s after your last kill`);
    if (fin(d.afterPlantSec)) dd.push(`${d.afterPlantSec} s after the plant`);
    if (fin(d.spikeLeft)) dd.push(`with ${d.spikeLeft} s left on the spike`);
    if (dd.length) full.push(`Computed from the record: the death came ${dd.join(', ')}.`);
    const sc = c.screen;
    if (sc && (sc.spot || sc.ult || sc.lookDigits.length)) {
      const bits = [];
      if (sc.spot) bits.push(`the death at ${sc.spot}`);
      if (sc.ult) bits.push('the ultimate ready at the death');
      if (sc.lookDigits.length) bits.push(`the look read ${sc.lookDigits.map((x) => `${x.value}${x.unit ? ` ${x.unit}` : ''}`).join(', ')} off the HUD`);
      full.push(`Read off the screen (it can be wrong, and Riot's record wins): ${bits.join(', ')}.`);
    }
    const look = lookLines(c);
    if (look) full.push(look);
    if (withWhy && c.why) full.push(`The coach's earlier line for it (written by a model from the same facts; use it only where the facts agree): ${c.why}`);
    out.push(full.join('\n'));
  }
  return out.join('\n\n');
}

/** The coach's earlier words: the summary, the focus and every round's line, or with `trim` the first two alone. */
function renderEarlier(input, trim) {
  const m = input.match;
  if (!m || m.kind !== 'valorant') return '';
  const lines = [];
  if (m.coach.summary) lines.push(`Summary: ${m.coach.summary}`);
  if (m.coach.focus) lines.push(`Focus: ${m.coach.focus}`);
  for (const c of m.cards) {
    if (!c.why || trim) continue;
    lines.push(`R${c.n}: ${c.why}`);
  }
  return lines.length ? `THE COACH'S EARLIER WORDS (written by a model from the same facts; use them only where the facts agree)\n${lines.join('\n')}` : '';
}

// ── Slices and notes ───────────────────────────────────────────────────────

function renderSlices(input, facts, messages) {
  if (input.game === 'lol') return '';
  const p = primerMod();
  if (!p) return '';
  const m = input.match;
  const mode = modeKey(m);
  const o = { mode, ...(m && fin(m.at) ? { matchAt: m.at } : {}) };
  const agents = new Set();
  if (m && m.agent) agents.add(m.agent);
  for (const a of facts.askedAgents) agents.add(a);
  // Every round the question is about: its killer and the agents in its feed who killed the player.
  const asked = m ? (facts.askedRounds || []).map((n) => m.cards.find((c) => c.n === n)).filter(Boolean) : [];
  for (const c of asked) {
    if (!c.riot) continue;
    if (c.riot.killer) agents.add(c.riot.killer);
    for (const k of c.riot.feed || []) if (k.on === 'me' && k.ka) agents.add(k.ka);
  }
  // With no round asked, the agents who killed the player most (two at most):
  // an answer about the match names their kit too (the re-audit of 8.7.7).
  if (m && !asked.length) {
    const killers = new Map();
    for (const c of m.cards || []) if (c.riot && c.riot.killer) killers.set(c.riot.killer, (killers.get(c.riot.killer) || 0) + 1);
    for (const [a] of [...killers.entries()].sort((x, y) => y[1] - x[1]).slice(0, 2)) agents.add(a);
  }
  const out = [];
  /*
   * THE KITS IN ONE SHORT BLOCK (ability-facts.js kitBlock, stream D of the
   * re-audit): each ability a finished line in the game's own words, the
   * player's agent first, then the agent asked about and the killers. The
   * model had ability names with markup and invented what they do: "Undercut
   * checks the angle", "Neural Theft is a single still". Without the module the
   * primer's kits, as before.
   */
  const af = abilityFactsMod();
  const block = af && typeof af.kitBlock === 'function'
    ? (() => { try { return String(af.kitBlock([...agents].slice(0, 4), { head: KIT_HEAD }) || '').trim(); } catch { return ''; } })() : '';
  if (block) out.push(block);
  else {
    for (const a of [...agents].slice(0, 4)) {
      try { const t = typeof p.kit === 'function' ? String(p.kit(a, o) || '').trim() : ''; if (t) out.push(t); } catch { /* a kit the primer cannot render is left out */ }
    }
  }
  if (!gunsInCore()) {
    // The guns the question names, every gun of the asked rounds' feeds, and
    // every gun that killed the player in the match (gunsInCore).
    const lastAsk = [...(messages || [])].reverse().find((x) => x && x.role !== 'assistant');
    const guns = new Set(gates.gunsIn(String((lastAsk && lastAsk.content) || '')).map((g) => g.name));
    for (const c of asked) {
      if (!c.riot) continue;
      if (c.riot.weapon) guns.add(c.riot.weapon);
      for (const k of c.riot.feed || []) if (k.w) guns.add(k.w);
    }
    for (const c of (m && m.cards) || []) if (c.riot && c.riot.weapon) guns.add(c.riot.weapon);
    try { const t = typeof p.guns === 'function' ? String(p.guns([...guns], o) || '').trim() : ''; if (t) out.push(t); } catch { /* none */ }
  }
  return out.join('\n\n');
}

/*
 * THE ENEMY TEAM'S AGENTS (8.8): the match's comp from Riot's record
 * (`comps.them`) and the agents Riot says killed the player, agents only,
 * each one the game data knows, for a client the route marks (`byEnemy`, the
 * version gate). None for a client before it, so its notes are as today.
 */
function enemiesOf(input) {
  if (!input || input.byEnemy !== true || !input.match || input.match.kind !== 'valorant') return [];
  const k = knowledgeMod();
  if (!k || typeof k.enemiesOf !== 'function') return [];
  const m = input.match;
  const list = ((m.comps && m.comps.them) || []).map((x) => x && x.agent);
  for (const c of m.cards || []) if (c && c.riot && c.riot.killer) list.push(c.riot.killer);
  return k.enemiesOf(list);
}

/*
 * WORKED CASES (8.8, cases.js): at most two, only where the question's
 * situation matches one. The asked round when there is one (its side, the
 * plant, the clutch, its second, the pistol, the look's cause), else every
 * round of the match, the counted causes and the patterns of the match and
 * across matches, the question's own words in English, the enemy agents,
 * the band and Advanced coaching. None, and the prompt is today's.
 */
function casesFor(input, messages) {
  if (!input || input.game === 'lol') return [];
  const cm = casesMod();
  if (!cm || typeof cm.pick !== 'function') return [];
  const m = input.match && input.match.kind === 'valorant' ? input.match : null;
  const sides = new Set();
  const phases = new Set();
  const economies = new Set();
  const causes = new Set();
  const patterns = new Set();
  const causeOf = (key) => { const c = /^cause:(.+)$/.exec(key || ''); if (c) causes.add(c[1]); };
  for (const p of (m && m.patterns) || []) if (p && p.key) patterns.add(p.key);
  for (const e of (m && m.lists && m.lists.mistakes) || []) causeOf(e && e.key);
  for (const p of (input.player && input.player.patterns) || []) { if (p && p.key) patterns.add(p.key); causeOf(p && p.key); }
  const first = askedRounds(input, messages)[0];
  const asked = m && first ? m.cards.find((c) => c.n === first) : null;
  // The asked round's phases are exact; over the whole match a phase counts
  // only where the deaths gather (cases.js concentrated).
  const perPhase = new Map();
  const phase = (p) => perPhase.set(p, (perPhase.get(p) || 0) + 1);
  let deaths = 0;
  for (const c of asked ? [asked] : (m ? m.cards : [])) {
    const side = c.side === 'attacking' ? 'attack' : c.side === 'defending' ? 'defense' : null;
    if (side) sides.add(side);
    if (!c.died) continue;
    deaths++;
    if (c.look && c.look.cause) causes.add(c.look.cause);
    const r = c.riot || {};
    if (r.afterPlant || (fin(r.plantSec) && fin(r.sec) && r.sec > r.plantSec)) phase(side === 'defense' ? 'retake' : 'postplant');
    if (r.clutch) phase('clutch');
    if (fin(r.sec) && !(fin(r.plantSec) && r.sec > r.plantSec)) {
      if (r.sec <= 30) phase('early');
      else if (r.sec <= 70) { phase('mid'); if (side === 'attack') phase('execute'); } else phase('late');
    }
    if (c.pistol) economies.add('pistol');
    const prev = m.cards.find((x) => x.n === c.n - 1);
    if (prev && prev.pistol && prev.result === 'won') economies.add('antieco');
    if (prev && prev.pistol && prev.result === 'lost') economies.add('lostpistol');
  }
  if (asked) for (const p of perPhase.keys()) phases.add(p);
  else for (const p of (typeof cm.concentrated === 'function' ? cm.concentrated(perPhase, deaths) : [...perPhase.keys()])) phases.add(p);
  // Riot's round record (8.8, recordSignalsFor): deaths on an eco and lone
  // deaths, the asked round's own or the match's. None, nothing added.
  const sig = m ? recordSignalsFor(knowledgeMod(), asked ? [asked] : m.cards, !!asked) : null;
  if (sig) {
    for (const e of sig.caseEconomies) economies.add(e);
    for (const c of sig.causes) causes.add(c);
  }
  if (input.language === 'en') {
    const lastAsk = [...(messages || [])].reverse().find((x) => x && x.role !== 'assistant');
    const q = lower(lastAsk && lastAsk.content);
    if (/\bretake/.test(q)) { phases.add('retake'); sides.add('defense'); }
    if (/\bpost ?plant|after the plant\b/.test(q)) phases.add('postplant');
    if (/\bclutch\b/.test(q)) phases.add('clutch');
    if (/\bpistol\b/.test(q)) economies.add('pistol');
    // An aim question is a duel lost on the shot (questionTopics, the round 3 audit).
    if (questionTopics(input, messages).keys.has('aim')) causes.add('lost-duel');
  }
  try {
    // The seed (cases.js VARIETY): Riot's match id, else the review's own id,
    // else the match's facts, so every question about one match draws the
    // same cases.
    const seed = m ? String(m.matchId || m.id || [m.map, m.agent, m.score, m.at,
      ...(m.cards || []).map((c) => [c.n, c.side, c.result, c.died ? 1 : 0].join(':'))].join('|')) : null;
    return cm.pick({ agent: m && m.agent, map: m && m.map, sides, phases, economies, causes, patterns,
      enemies: enemiesOf(input), rankBand: input.rankBand, advanced: input.advanced === true, seed }, cm.MAX_CASES) || [];
  } catch { return []; }
}

/*
 * WHAT A QUESTION IS ABOUT, IN ITS OWN WORDS (the round 3 audit, Nov 2026).
 * pickNotes read only the counted patterns and causes and five question words
 * (retake, post plant, eco, pistol, clutch), so an aim, practice or climbing
 * question got the trade notes every other answer got, and the aim notes,
 * tagged for a lost duel the coach looked at, reached no aim question on a
 * match with no look. Each topic here has the question's words (`ask`) and the
 * words of a note that answers it (`note`, over its text and its topic), read
 * in English only. A general question (the biggest mistake, how to improve or
 * climb, what to practise) also takes the band's own fundamentals.
 */
const QUESTION_TOPICS = [
  { key: 'aim', ask: /\baim(?:ing)?\b|\bcrosshair|\bhead ?shots?\b|\bhs\b|\bflick|\bspray|\brecoil|\bmechanic|\bgunplay|\bmiss(?:ing)? (?:my )?shots/i,
    note: /\bcrosshair|\bhead height|\bhead ?shots?\b|\baim\b|\bfirst (?:shot|bullet)|\bstop(?:ping)? before|\bbursts?\b|\bspray|\bone taps?\b|\bshooting error|\bcounter.?strafe/i },
  { key: 'practice', ask: /\bpractic|\bpractis|\bdrills?\b|\baim ?trainers?\b|\bwarm(?:ing)? ?ups?\b|\btrain(?:ing)?\b|\broutine|\bdeathmatch|\bthe range\b|\bbefore my next (?:game|match)/i,
    note: /\bdeathmatch|\bthe range\b|\bpractic|\bpractis|\bdrills?\b|\bwarm ?up|\broutine|\baim trainer/i },
  { key: 'climb', ask: /\bclimb|\brank ?up|\branked\b|\bmy rank\b|\bimprove|\bget better|\bhard ?stuck|\bstuck\b|\bholding me back|\bnext rank|\bdemot|\bpromot|\belo\b|\bmmr\b/i,
    note: /\bclimb|\brank\b|\bwin rate|\bconsisten|\bone habit|\bnew habits?|\bagent pool|\bsmall pool|\b(?:Iron|Bronze|Silver|Gold|Platinum|Diamond|Ascendant|Immortal)\b/i },
  { key: 'mental', ask: /\bmental|\btilt|\bfrustrat|\bangry|\bconfiden|\bnervous|\bcalm\b|\btoxic|\blos(?:s|ing) streak|\blosing a lot|\bfocus(?:ed)? (?:in|during)/i,
    note: /\btilt|\bmute\b|\bcalm\b|\btoxic|\bafter a lost round|\bloss limit|\bstreak/i },
  { key: 'comms', ask: /\bcomms?\b|\bcommunicat|\bcall ?outs?\b|\bcalling\b|\btalk(?:ing)?\b|\bmic\b|\bigl\b|\bsolo ?queue|\bteam (?:won't|will not|doesn't|does not) (?:follow|talk)/i,
    note: /\bcalls?\b|\bcomms?\b|\bannounce|\bsilence|\btell your team|\bwhen your team will not follow/i },
  { key: 'economy', ask: /\beco\b|\beconomy|\bbuy(?:ing|s)?\b|\bsav(?:e|ing)\b|\bcredits?\b|\bforce\b|\bloss bonus|\bmoney/i,
    note: /\bbuy|\bsave\b|\bsaving|\beco\b|\bcredits?\b|\bloss bonus|\bforce\b|\bfull buy|\bhalf buy/i },
  { key: 'ult', ask: /\bults?\b|\bultimates?\b/i, note: /\bultimates?\b|\bults?\b|\borbs?\b/i },
];
const FUNDAMENTAL_TOPICS = QUESTION_TOPICS.filter((t) => ['aim', 'practice', 'climb'].includes(t.key));
const GENERAL_ASK =/\bbiggest\b|\bmain (?:mistake|problem|issue|weakness)|\bimprove|\bclimb|\brank ?up|\bmy rank\b|\bpractic|\bpractis|\bholding me back|\bwhat should i (?:do|work on|focus|fix)|\bget better|\bwork on\b/i;

/** The question's topics ({ keys, general, agents }), from the player's last message, in English only. */
function questionTopics(input, messages) {
  const none = { keys: new Set(), general: false, agents: [] };
  if (!input || input.language !== 'en') return none;
  const lastAsk = [...(Array.isArray(messages) ? messages : [])].reverse().find((x) => x && x.role !== 'assistant');
  const q = String((lastAsk && lastAsk.content) || '');
  if (!q.trim()) return none;
  const keys = new Set(QUESTION_TOPICS.filter((t) => t.ask.test(q)).map((t) => t.key));
  return { keys, general: GENERAL_ASK.test(q), agents: [...new Set(gates.agentsIn(q).map((a) => a.name))] };
}

/*
 * THE LEVER (the re-audit of 8.7.7, Nov 2026). "How do I improve at my rank"
 * opened on the trade habit 9 times in 10, Iron and Ascendant alike, and the
 * biggest mistake and what to practise 8 and 6 times: the untraded line is
 * counted in almost every match, so it was always the largest count. A general
 * question now names one lever chosen in code from this match's own counted
 * facts, weighed by what decides rounds at the player's band, a finished line
 * in the counted words with its numbers. Above Gold the trade check leads only
 * when nothing else is counted. Near ties go by a seed of the match and the
 * question's kind, as the worked cases' variety does (cases.js VARIETY), so
 * the biggest mistake, the climb and the practice of one match need not all
 * name the same one.
 *
 * Only for a client that sends a band (8.8): with none the prompt is today's.
 */
const LEVER_WEIGHTS = {
  iron_bronze: { early: 1.3, aim: 1.2, trade: 1.1, cause: 1.0, firstDeath: 1.0, lostAdv: 0.9, killer: 0.8, retake: 0.6, postplant: 0.6 },
  silver_gold: { trade: 1.15, early: 1.15, lostAdv: 1.0, aim: 1.0, cause: 1.0, firstDeath: 1.0, killer: 0.9, retake: 0.7, postplant: 0.7 },
  plat_diamond: { lostAdv: 1.3, cause: 1.3, retake: 1.2, postplant: 1.2, firstDeath: 1.1, killer: 1.1, early: 0.9, aim: 0.9, trade: 0.6 },
  asc_plus: { retake: 1.4, postplant: 1.4, lostAdv: 1.3, cause: 1.3, killer: 1.2, firstDeath: 1.1, early: 0.8, aim: 0.8, trade: 0.5 },
};
const PRACTICE_WEIGHTS = { aim: 1.25, cause: 1.15, early: 1.1 };
const LEVER_TIE = 0.85;
const BIGGEST_ASK = /\bbiggest\b|\bmain (?:mistake|problem|issue|weakness)|\bworst\b/i;
const seedPick = (seed, n) => {
  let h = 2166136261;
  for (const ch of String(seed)) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619) >>> 0; }
  return n > 0 ? h % n : 0;
};

/** The counted levers of a match, each { key, kind, strength, line }. */
function leversOf(m) {
  if (!m || m.kind !== 'valorant') return [];
  const deaths = m.cards.filter((c) => c.died).length;
  const rounds = m.cards.length;
  if (!deaths || !rounds) return [];
  const out = [];
  // The counted detail says it whole ("14 of your 16 deaths went unanswered: ..."), else the title.
  const line = (e) => String(e.detail || e.title || '').replace(/\s+/g, ' ').trim();
  for (const e of m.lists.mistakes) {
    const n = fin(e.count) ? e.count : e.rounds.length;
    if (!n) continue;
    const cause = /^cause:(.+)$/.exec(e.key || '');
    const kind = e.key === 'untraded' ? 'trade' : e.key === 'early' ? 'early' : e.key === 'lost-advantage' ? 'lostAdv'
      : e.key === 'same-killer' ? 'killer' : cause ? 'cause' : null;
    if (!kind) continue;
    // A death the coach looked at weighs more than one counted from the record alone.
    out.push({ key: e.key, kind, strength: Math.min(1, (n / deaths) * (kind === 'lostAdv' ? 1.6 : kind === 'cause' ? 1.4 : 1)), line: line(e) });
  }
  const have = new Set(out.map((x) => x.kind));
  for (const p of m.patterns) {
    if (p.key === 'early' && !have.has('early')) {
      const x = /^(\d+) of your (\d+) deaths/.exec(p.text);
      if (x && Number(x[1]) >= 2) out.push({ key: 'early', kind: 'early', strength: Number(x[1]) / Math.max(1, Number(x[2])), line: p.text });
    }
    if (p.key === 'retake' || p.key === 'postplant') {
      const x = /won (\d+) of (\d+) rounds/.exec(p.text);
      if (!x) continue;
      const won = Number(x[1]);
      const of = Number(x[2]);
      if (of >= 3 && won / of < 0.5) out.push({ key: p.key, kind: p.key, strength: (1 - won / of) * Math.min(1, of / 5), line: p.text });
    }
  }
  // The first death of the round, as the grade's own evidence counts it.
  if (m.grade) {
    for (const c of m.grade.categories) {
      for (const ev of c.evidence) {
        const x = /first to die in (\d+) of (\d+) rounds/.exec(ev);
        if (x && Number(x[1]) >= 2 && Number(x[1]) / Number(x[2]) >= 0.2) {
          out.push({ key: 'first-death', kind: 'firstDeath', strength: Math.min(1, (Number(x[1]) / Number(x[2])) * 2), line: `${ev.charAt(0).toUpperCase()}${ev.slice(1)}` });
        }
      }
    }
  }
  // The aim, from the headshot rate against the player's own average, a lost duel the coach looked at weighing it.
  const hs = m.against.find((a) => a.label === 'Headshot %');
  if (hs && fin(hs.value) && fin(hs.baseline) && hs.baseline - hs.value >= 8) {
    const duels = m.cards.filter((c) => c.died && c.look && c.look.cause === 'lost-duel').length;
    out.push({ key: 'aim', kind: 'aim', strength: Math.min(1, (hs.baseline - hs.value) / hs.baseline + duels * 0.15),
      line: `Your headshot rate this match was ${hs.value}%, against your own average of ${hs.baseline}%${duels ? `, and the coach's look called ${duels === 1 ? 'one death' : `${duels} deaths`} a fair fight lost on the shot` : ''}` });
  }
  return out;
}

/** THE LEVER line for a general question, or '' (no band, no English, no general question, an aim question, nothing counted). */
function leverLine(input, messages) {
  // Iron to Gold only: above Gold, 8.7.7's prompt (LEVER_BANDS, the blind audit of 8.7.8).
  if (!input || input.game === 'lol' || !LEVER_BANDS.includes(input.rankBand)) return '';
  const m = input.match;
  if (!m || m.kind !== 'valorant') return '';
  const qt = questionTopics(input, messages);
  if (!qt.general || qt.keys.has('aim') || qt.agents.length) return '';
  const lastAsk = [...(Array.isArray(messages) ? messages : [])].reverse().find((x) => x && x.role !== 'assistant');
  const q = String((lastAsk && lastAsk.content) || '');
  const kind = BIGGEST_ASK.test(q) ? 'biggest' : qt.keys.has('practice') ? 'practice' : 'climb';
  const levers = leversOf(m);
  if (!levers.length) return '';
  const w = LEVER_WEIGHTS[input.rankBand];
  const scored = levers.map((l) => ({ ...l, score: l.strength * (w[l.kind] || 1) * (kind === 'practice' ? PRACTICE_WEIGHTS[l.kind] || 1 : 1) }))
    .sort((a, b) => b.score - a.score || (a.key < b.key ? -1 : 1));
  const high = input.rankBand === 'plat_diamond' || input.rankBand === 'asc_plus';
  // Above Gold the trade check is the lever only when nothing else is counted.
  const pool = high && scored.length > 1 ? scored.filter((l) => l.kind !== 'trade') : scored;
  const top = pool[0];
  const ties = pool.filter((l) => l.score >= top.score * LEVER_TIE);
  const seed = `${m.matchId || m.id || [m.map, m.agent, m.score, m.at].join('|')}|${kind}`;
  const pick = ties[seedPick(seed, ties.length)] || top;
  const said = pick.line.replace(/[.\s]+$/, '');
  const trade = pick.kind === 'trade' ? '' : ' Name trading at most once, as a second point, if at all.';
  return `THE LEVER for this question, chosen in code from this match's counted facts for the player's level: ${said}. Lead with it and its numbers as given, build the one habit and the drill on it, and say the others can wait.${trade}`;
}

/*
 * EIGHT NOTES AT MOST: three by the topics the counted mistakes and the
 * patterns point to (match-review.js PATTERN_TOPICS, and CAUSE_TOPICS for a
 * cause), and five from retrieve() with the asked round as the situation,
 * Advanced coaching honoured. None of the review's own study notes, which the
 * player has read already. Question words map to flags in English only.
 */
function pickNotes(input, messages) {
  if (input.game === 'lol') return [];
  const k = knowledgeMod();
  if (!k || typeof k.retrieve !== 'function' || typeof k.all !== 'function') return [];
  const rev = reviewMod() || {};
  const m = input.match;
  const advanced = input.advanced === true;
  const agent = m && m.agent ? m.agent : null;
  const map = m && m.map ? m.map : null;
  const own = new Set();
  if (m && typeof rev.study === 'function') {
    try {
      const rounds = m.cards.map((c) => ({ n: c.n, side: c.side, result: c.result, died: c.died, cause: c.look ? c.look.cause : null }));
      // The review's own list as either kind of client was given it: by cause
      // since 8.5.0 (match-review.js CAUSE_TOPICS), without before it.
      for (const byCause of [false, true]) {
        for (const n of rev.study({ context: { agent, map, advancedTips: advanced, ...(input.rankBand ? { rankBand: input.rankBand } : {}),
          ...(enemiesOf(input).length ? { enemyAgents: enemiesOf(input) } : {}) }, patterns: m.patterns, rounds,
          mistakes: m.lists.mistakes, byCause }, 3)) own.add(n.text);
      }
    } catch { /* no study list to leave out */ }
  }
  const wanted = new Set();
  const PT = rev.PATTERN_TOPICS || {};
  const CT = rev.CAUSE_TOPICS || {};
  for (const p of (m && m.patterns) || []) for (const t of PT[p.key] || []) wanted.add(t);
  for (const e of (m && m.lists.mistakes) || []) {
    const cause = /^cause:(.+)$/.exec(e.key || '');
    if (cause) for (const t of CT[cause[1]] || []) wanted.add(t);
  }
  for (const c of (m && m.cards) || []) if (c.look && c.look.cause) for (const t of CT[c.look.cause] || []) wanted.add(t);
  for (const p of (input.player && input.player.patterns) || []) {
    const cause = /^cause:(.+)$/.exec(p.key || '');
    if (cause) for (const t of CT[cause[1]] || []) wanted.add(t);
    for (const t of PT[p.key] || []) wanted.add(t);
  }
  // Riot's round record (8.8, match-review.js signalTopics): the match's
  // repeated callout, lone deaths, deaths with no ability used and the
  // team's economy want their notes as a pattern does. None, nothing added.
  const matchSig = m ? recordSignalsFor(k, m.cards, false) : null;
  if (matchSig && typeof rev.signalTopics === 'function') for (const t of rev.signalTopics(matchSig)) wanted.add(t);
  const s = typeof k.situationOf === 'function' ? k.situationOf({ agent, map }) : { agent, role: null, map: lower(map) };
  // The enemy team's agents (8.8, knowledge.js enemyFit): a note for them
  // only against them, and none at all for a client before it.
  const enemies = enemiesOf(input);
  const fitVs = (note) => (typeof k.enemyFit === 'function' ? k.enemyFit(note, enemies)
    : (note && (note.enemyAgents || note.enemyWithout) ? null : 0));
  const out = [];
  const seen = new Set(own);
  /*
   * THE QUESTION'S OWN NOTES FIRST (questionTopics, the round 3 audit): up to
   * three that answer what was asked (aim, practice, climbing, the mental side,
   * comms, the economy, ultimates, the agent it names, the player's own or the
   * enemy's), whatever cause they are tagged for, since a cause is the
   * situation the note was written for and the question names its own; and for
   * a general question two of the band's own fundamentals. Every other rule a
   * note keeps holds: Advanced coaching, the band (a note above it never), the
   * enemy team, the player's agent, role and map. A question with none of these
   * words is today's notes, byte for byte.
   */
  const qt = questionTopics(input, messages);
  const ownRole = s.role || null;
  const fitsPlayer = (note) => {
    if (!note || !note.text || seen.has(note.text) || note.weapons) return false;
    if (note.tier === 'advanced' && !advanced) return false;
    if (fitVs(note) === null) return false;
    // A note for an agent is the player's own agent's, asked about or not.
    if (note.agents && !(s.agent && note.agents.some((a) => lower(a) === lower(s.agent)))) return false;
    if (note.roles && (!ownRole || !note.roles.includes(ownRole))) return false;
    if (note.maps && (!s.map || !note.maps.some((x) => lower(x) === s.map))) return false;
    if (input.rankBand && typeof k.rankAdjust === 'function' && k.rankAdjust(note, input.rankBand, false) === null) return false;
    return true;
  };
  const rankScore = (note) => (input.rankBand && typeof k.rankAdjust === 'function' ? k.rankAdjust(note, input.rankBand, false) || 0 : 0);
  const asks = [];
  if (qt.keys.size || qt.agents.length) {
    const topicsOf = QUESTION_TOPICS.filter((t) => qt.keys.has(t.key));
    for (const note of k.all()) {
      const words = `${note && note.text} ${(note && note.source && note.source.topic) || ''}`;
      let hits = topicsOf.filter((t) => t.note.test(words)).length;
      let agentHit = 0;
      for (const a of qt.agents) {
        const ownAgent = s.agent && lower(a) === lower(s.agent);
        if (ownAgent && note.agents && note.agents.some((x) => lower(x) === lower(a))) agentHit = 2;
        else if (!ownAgent && note.enemyAgents && note.enemyAgents.some((x) => lower(x) === lower(a))) agentHit = 2;
        else if (!ownAgent && !note.agents && new RegExp(`(?<![A-Za-z0-9])${a.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}(?![A-Za-z0-9])`).test(String(note.text || ''))) agentHit = Math.max(agentHit, 1);
      }
      if (!hits && !agentHit) continue;
      if (!fitsPlayer(note)) continue;
      asks.push({ text: note.text, topic: (note.source && note.source.topic) || note.text,
        score: (note.weight || 1) + hits * 2 + agentHit * 3 + rankScore(note) + (fitVs(note) || 0) });
    }
    asks.sort((a, b) => b.score - a.score);
    const tops = new Set();
    for (const n of asks) {
      if (out.length >= 3) break;
      if (tops.has(n.topic) || seen.has(n.text)) continue;
      tops.add(n.topic);
      out.push(n.text);
      seen.add(n.text);
    }
  }
  if (qt.general && input.rankBand) {
    const band = [];
    for (const note of k.all()) {
      if (!Array.isArray(note.ranks) || !note.ranks.includes(input.rankBand) || note.ranks.length > 2) continue;
      if (note.agents || note.maps || note.roles || note.enemyAgents || note.enemyWithout || note.cause) continue;
      // A fundamental of improving: what climbing, practice or aim is at the band.
      const words = `${note.text} ${(note.source && note.source.topic) || ''}`;
      if (!FUNDAMENTAL_TOPICS.some((t) => t.note.test(words))) continue;
      if (!fitsPlayer(note)) continue;
      band.push({ text: note.text, score: (note.weight || 1) + rankScore(note) });
    }
    band.sort((a, b) => b.score - a.score);
    for (const n of band.slice(0, 2)) { if (!seen.has(n.text)) { out.push(n.text); seen.add(n.text); } }
  }
  // A question about something else keeps one note of the counted patterns,
  // so the answer is about what was asked (the audit's "one habit everywhere").
  const topicalMax = out.length && !qt.general ? 1 : 3;
  const topical = [];
  for (const note of k.all()) {
    const src = note && note.source;
    if (!src || !src.topic || !wanted.has(src.topic) || seen.has(note.text)) continue;
    const versus = fitVs(note);
    if (versus === null) continue;
    if (note.tier === 'advanced' && !advanced) continue;
    if (note.weapons) continue;
    if (note.agents && (!s.agent || !note.agents.some((a) => lower(a) === lower(s.agent)))) continue;
    if (note.roles && (!s.role || !note.roles.includes(s.role))) continue;
    if (note.maps && (!s.map || !note.maps.some((x) => lower(x) === s.map))) continue;
    // The rank band (8.8, knowledge.js rankAdjust): every note here is one the
    // player's own patterns point to, which is the data showing it, so a note
    // for lower bands is not demoted, only one above the band is left out.
    const ranked = input.rankBand && typeof k.rankAdjust === 'function' ? k.rankAdjust(note, input.rankBand, true) : 0;
    if (ranked === null) continue;
    topical.push({ text: note.text, topic: src.topic, score: (note.weight || 1) + (note.agents ? 4 : 0) + (note.maps ? 3 : 0) + (note.roles ? 2 : 0) + ranked + versus });
  }
  topical.sort((a, b) => b.score - a.score);
  const topics = new Set();
  const topicalStart = out.length;
  for (const n of topical) {
    if (out.length - topicalStart >= topicalMax || out.length >= 6) break;
    if (topics.has(n.topic)) continue;
    topics.add(n.topic);
    out.push(n.text);
    seen.add(n.text);
  }
  // The asked round as the situation (the first of them), and the question's own words.
  const ctx = { agent, map, ...(input.rankBand ? { rankBand: input.rankBand } : {}),
    ...(enemies.length ? { enemyAgents: enemies } : {}) };
  const first = askedRounds(input, messages)[0];
  const asked = m && first ? m.cards.find((c) => c.n === first) : null;
  if (asked) {
    ctx.side = asked.side;
    ctx.roundNumber = asked.pistol ? 1 : asked.n;
    // The death the coach looked at in this round, so notes for its cause are served.
    if (asked.look && typeof asked.look.cause === 'string') ctx.cause = asked.look.cause;
    const r = asked.riot || {};
    if (r.afterPlant || (asked.died && fin(r.plantSec) && fin(r.sec) && r.sec > r.plantSec)) ctx.phase = 'postplant';
    if (r.clutch) { ctx.teammatesAlive = 0; ctx.playerAlive = true; }
    const prev = m.cards.find((c) => c.n === asked.n - 1);
    if (asked.died && prev && prev.died) ctx.consecutiveDeaths = 2;
    const before = m.cards.filter((c) => c.n < asked.n);
    ctx.teamScore = before.filter((c) => c.result === 'won').length;
    ctx.enemyScore = before.filter((c) => c.result === 'lost').length;
  }
  if (input.language === 'en') {
    const lastAsk = [...(messages || [])].reverse().find((x) => x && x.role !== 'assistant');
    const q = lower(lastAsk && lastAsk.content);
    if (/\bretake/.test(q)) { ctx.phase = 'postplant'; ctx.side = 'defending'; }
    if (/\bpost ?plant|after the plant\b/.test(q)) ctx.phase = 'postplant';
    if (/\beco\b|\bsave\b|\bsaving\b/.test(q)) { ctx.phase = 'buy'; ctx.playerCredits = 1000; }
    if (/\bpistol\b/.test(q)) ctx.roundNumber = 1;
    if (/\bclutch\b/.test(q)) { ctx.teammatesAlive = 0; ctx.playerAlive = true; }
    // An aim question is the situation of a duel lost on the shot, so the aim
    // notes tagged for one are retrieved with no look at all (the round 3 audit).
    if (qt.keys.has('aim') && !ctx.cause) ctx.cause = 'lost-duel';
  }
  // Riot's round record (8.8): the asked round's own signals (one death is
  // enough there), else the match's, as the economy flags, the causes and
  // the callouts of the lone deaths retrieve() reads. None, the context as before.
  const sig = asked ? recordSignalsFor(k, [asked], true) : matchSig;
  if (sig) {
    if (sig.economy.length) ctx.economy = sig.economy;
    if (sig.causes.length) ctx.causes = sig.causes;
    if (sig.places.length) ctx.places = sig.places;
  }
  let got = [];
  try { got = k.retrieve(ctx, 12, { advanced }) || []; } catch { got = []; }
  for (const t of got) {
    if (out.length >= 8) break;
    if (seen.has(t)) continue;
    seen.add(t);
    out.push(t);
  }
  return out.slice(0, 8);
}

function renderConversation(messages) {
  const ms = (Array.isArray(messages) ? messages : []).slice(-8);
  if (!ms.length) return '';
  return `THE CONVERSATION, the player's newest message last\n${ms.map((x) => (x.role === 'assistant'
    ? `Coach: ${clip(x.content, 2400)}` : `Player: ${clip(x.content, 1200)}`)).join('\n')}`;
}

/*
 * THE PROMPT IN THREE PARTS, THE STABLE ONES FIRST (bench:chat, 15 Oct). Sol
 * reported 0 cached tokens on every call of the bench, every prompt token
 * billed at its cache write price, though consecutive questions shared 19,000
 * to 24,000 characters from the start: the provider wrote the whole prompt,
 * one block, and never read a part of it back, and where two questions of a
 * match parted was the round ledger, which left out the round asked. So the
 * prompt is three parts, each the same byte for byte wherever it can be:
 *   1. the static prefix, the rules and the primer's core for the mode, the
 *      same for every match of the mode on the patch;
 *   2. the match's own facts, THE PLAYER, THE MATCH with every round a line,
 *      and the coach's earlier words, the same for every question of the match;
 *   3. the question's: the move to this match when the question made one, the
 *      rounds it is about in full (askedRounds), the slices, the coaching
 *      notes, the conversation, the language line and the reply line.
 * buildParts gives the three, each of the first two ending in its blank line,
 * and buildPrompt is them joined; the route sends the first two as blocks a
 * provider may cache (coach.js chatV2, chatCall's `parts`).
 *
 * THE BUDGET. Everything after the static prefix stays under
 * DYNAMIC_MAX_CHARS, about 4,700 tokens: a 20 round match with its feed, three
 * rounds in full, eight notes and eight messages fits. The match's part keeps
 * under MATCH_MAX_CHARS by its own length alone, so that a long conversation
 * never moves it: the coach's earlier round lines out (the rounds asked then
 * carry their own), then the rounds' looks out of their lines, then THE
 * PLAYER's lists to three. The question's part takes the rest: the
 * conversation to its last four messages, the notes to five, then the
 * conversation to two and the notes to three. The rounds asked always stay in
 * full.
 */
const DYNAMIC_MAX_CHARS = 19000;
const MATCH_MAX_CHARS = 11000;

/**
 * The prompt in its three parts: { parts: [static prefix, the match's, the
 * question's] }, joined the prompt buildPrompt gives. `opts.variant`
 * 'v2-noprimer' leaves the primer's core out (bench:chat's control); the gates
 * check its numbers the same.
 */
function buildParts(input, messages, opts) {
  const inp = input && input.v === 2 ? input : normalise(input);
  const msgs = Array.isArray(messages) ? messages : [];
  const variant = opts && opts.variant;
  const facts = factsOf(inp, msgs);
  const head = staticPrefix(inp, variant);
  const ofMatch = (lvl) => [renderPlayer(inp, lvl >= 3), renderMatch(inp, facts, lvl >= 2), renderEarlier(inp, lvl >= 1)]
    .filter(Boolean).join('\n\n');
  let matchLvl = 0;
  let match = ofMatch(0);
  while (matchLvl < 3 && match.length > MATCH_MAX_CHARS) match = ofMatch(++matchLvl);
  const notes = pickNotes(inp, msgs);
  const lever = leverLine(inp, msgs);
  const rounds = facts.askedRounds || [];
  const sw = inp.ask && inp.ask.switchedFrom;
  const reply = ['Reply as the coach to the player\'s last message.', languageLine(inp.language)].filter(Boolean).join(' ');
  const ofQuestion = (lvl, ns = notes, cs = []) => {
    const kept = lvl >= 3 ? ns.slice(0, 3) : lvl >= 2 ? ns.slice(0, 5) : ns;
    const cm = cs.length ? casesMod() : null;
    return [
      sw ? `The player's question named this match, so the conversation moved to it from ${[sw.map, sw.agent].filter(Boolean).join(', ') || 'another match'}: open by naming this one.` : '',
      renderAsked(inp, rounds, matchLvl >= 1),
      renderSlices(inp, facts, msgs),
      lever,
      kept.length ? `COACHING NOTES\n${kept.map((t) => `- ${t}`).join('\n')}` : '',
      cm ? cm.block(cs) : '',
      renderConversation(lvl >= 3 ? msgs.slice(-2) : lvl >= 1 ? msgs.slice(-4) : msgs),
      reply,
    ].filter(Boolean).join('\n\n');
  };
  const room = DYNAMIC_MAX_CHARS - match.length - 2;
  const fitted = (ns, cs) => {
    let q = ofQuestion(0, ns, cs);
    for (let lvl = 1; lvl <= 3 && q.length > room; lvl++) q = ofQuestion(lvl, ns, cs);
    return q;
  };
  const question = fitted(notes, []);
  const today = { parts: [`${head}\n\n`, `${match}\n\n`, question] };
  /*
   * WORKED CASES TAKE THE PLACE OF THE LOWEST NOTES (8.8), as in the review
   * (match-review.js withinBudget): the prompt with them grows by
   * CASE_GROWTH at most and keeps under the dynamic budget, the last notes
   * going one at a time down to three, then the second case, else today's.
   */
  const worked = casesFor(inp, msgs);
  if (!worked.length) return today;
  const cap = Math.floor(today.parts.join('').length * (1 + CASE_GROWTH));
  for (const cs of [worked, worked.slice(0, 1)]) {
    const ns = notes.slice();
    for (;;) {
      const q = fitted(ns, cs);
      if (q.length <= room && head.length + match.length + 4 + q.length <= cap) return { parts: [`${head}\n\n`, `${match}\n\n`, q] };
      if (ns.length <= 3) break;
      ns.pop();
    }
  }
  return today;
}
const CASE_GROWTH = 0.10;

/** The prompt, a string: buildParts' three parts joined. */
function buildPrompt(input, messages, opts) {
  return buildParts(input, messages, opts).parts.join('');
}

// ── The reply ──────────────────────────────────────────────────────────────

const HONEST_LINE = "I couldn't give you an answer I can stand behind for that one. Ask me about a round, a death or your agent in this match.";
const DASHES = new RegExp('\\s*[' + String.fromCharCode(0x2013, 0x2014) + ']\\s*', 'g');
const MAX_CHARS = 4000;
const NOT_AN_ANSWER = /\b(?:as an ai|i cannot assist|i can.?t help with|language model|i am unable to)\b/i;

/** The model's text as paragraphs of plain sentences: no thinking, no markdown, no list marks, no dashes. */
function cleanReply(raw) {
  let t = String(raw || '').replace(/\r\n?/g, '\n');
  t = t.replace(/<think>[\s\S]*?<\/think>/gi, ' ').replace(/```[\s\S]*?```/g, ' ');
  const paras = [];
  let current = [];
  for (const line of t.split('\n')) {
    const l = line.trim();
    if (!l) { if (current.length) { paras.push(current.join(' ')); current = []; } continue; }
    const item = /^(?:[-*•]|\d{1,2}[.)])\s+(.*)$/.exec(l);
    const heading = /^#{1,6}\s+(.*)$/.exec(l);
    let s = (item ? item[1] : heading ? heading[1] : l).replace(/\*\*|__|`/g, '').trim();
    if ((item || heading) && s && !/[.!?:]$/.test(s)) s += '.';
    if (heading) { if (current.length) { paras.push(current.join(' ')); current = []; } }
    current.push(s);
  }
  if (current.length) paras.push(current.join(' '));
  return paras.map((p) => p.replace(DASHES, ', ').replace(/\s+-\s+/g, ', ').replace(/\s{2,}/g, ' ').trim()).filter(Boolean);
}

/*
 * A BARE YES OR NO GOES WITH THE SENTENCE THAT SAID WHY (bench:chat, 15 Oct).
 * "Should I have saved my gun in round 4?" was answered "Yes." and nothing
 * more of it: the economy gate rightly dropped the save claim after it, and
 * the verdict, which makes the same claim in one word, went out alone, read
 * by the person as an economy claim. A bare verdict whose next sentence was
 * dropped is dropped too, and as the reply's first sentence it asks for the
 * reply again.
 */
const VERDICT = /^(?:yes|yeah|yep|no|nope|nah|correct|right|exactly|absolutely|definitely|not really|not quite|s[ií]|oui|non|ja|nein|sim|n[ãa]o)(?:,?\s+(?:it|that|you|they|he|she|we)\s+(?:was|were|did|is|are|should|had|could|would)(?:n't|\s+not)?(?:\s+have)?)?\s*[.!]?$/i;
const VERDICT_REASON = 'your reply answered yes or no, and the sentence that said why could not be shown; answer with the fact itself, in a full sentence';

/*
 * A SENTENCE THAT LEANS ON A DROPPED ONE GOES WITH IT (bench:chat, 23 Oct).
 * The reply closes up around a dropped sentence, so the next is read against
 * whatever then stands before it: on the Sunset round 1, with the player's
 * death dropped, "Skye traded KAY/O one second later" followed Phoenix's death
 * at 24 s and told a trade at 25 s where Riot has 27 s, a wrong fact no
 * sentence of the model's said. A sentence that leans on the one before it for
 * its time or its subject (fact-gates.js leansOn) is dropped when that one is,
 * in reading order, paragraphs or not, and so is the next if it leans on it.
 *
 * Dropped, not asked for again, because: a sentence is never repaired, and a
 * bare verdict already goes with the sentence that said why (VERDICT), so the
 * gates hold one rule, that what reads wrong as shown is not shown; asking
 * again costs a second call, on the run of 23 Oct 2.8 s and $0.006 more an
 * answer on average (the eight questions asked again in one run and not in
 * another), where retries were already the one rate past its bar (12.2% of
 * answers against 10%), and the second reply can lean the same way; and a
 * reply the extra drop leaves without its answer is still asked for again,
 * as any is whose first sentence went or that keeps fewer than two.
 */
const LEANS_REASON = 'a sentence of your reply leaned on the one before it, which could not be shown; give each event its own time into the round, and name the agent rather than he, she, that or it';
const ORPHAN_REASON = 'a sentence of your reply pointed at something no sentence shown before it named; name the agent, the ability or the rounds in the sentence itself';
// The sentences a reply must keep to be shown when its retry fails too (parseReply `fallback`).
const FALLBACK_KEPT = 3;

/**
 * Every sentence of a reply's paragraphs through the gates, in order: { p
 * (its paragraph), s, drop, logged }, a standing the death told in the
 * sentence before left held to the one after it (gateLeftAcross), a sentence
 * that leans on a dropped one dropped with it in English (LEANS_REASON), and
 * a bare verdict whose next sentence was dropped dropped with it (VERDICT).
 * parseReply's reading of a reply, and bench:chat's.
 */
function gateReply(paras, facts, nameOpts) {
  const rows = [];
  (Array.isArray(paras) ? paras : []).forEach((p, i) => {
    for (const s of gates.sentencesOf(p)) {
      const res = gates.check(s, facts, nameOpts);
      rows.push({ p: i, s, drop: res.drop, logged: res.logged });
    }
  });
  // The death in one sentence, the standing it left in the next ("Tejo killed
  // you 13 s in. That left your team 4 against 5."): held to the one after it
  // (fact-gates.js gateLeftAcross, the verifier's probe of 23 Oct).
  for (let i = 1; i < rows.length; i++) {
    if (rows[i].drop || rows[i - 1].drop) continue;
    const across = gates.gateLeftAcross(rows[i - 1].s, rows[i].s, facts);
    if (across) { rows[i].drop = across; rows[i].logged = []; }
  }
  // leansOn reads English words, so only an English reply leans by them: a
  // Spanish "He visto" (I have seen) or a Turkish "Her raundda" (in every
  // round) is no pronoun standing for a dropped sentence (the verifier's probe).
  const english = ((facts && facts.language) || 'en') === 'en';
  for (let i = 1; english && i < rows.length; i++) {
    if (rows[i - 1].drop && !rows[i].drop && gates.leansOn(rows[i].s)) {
      rows[i].drop = { gate: 'leans', reason: LEANS_REASON };
      rows[i].logged = [];
    }
  }
  for (let i = 0; i + 1 < rows.length; i++) {
    if (!rows[i].drop && rows[i + 1].drop && VERDICT.test(gates.straighten(rows[i].s).trim())) {
      rows[i].drop = { gate: 'verdict', reason: VERDICT_REASON };
      rows[i].logged = [];
    }
  }
  /*
   * WHAT LEANS ON NOTHING KEPT (coherence.js checkOrphans, the re-audit of
   * 8.7.7): "Fight her with a teammate or after a flash" with the Reyna
   * sentence before it dropped, "You did plenty right." with its list gone,
   * "with it up" without its Double Tap. Read over the reply as it will be
   * shown, in English, the agent the question names standing as one a he or a
   * she may mean. Dropped, never retried, as a sentence that leans is.
   */
  /*
   * WHAT RIOT'S RECORD MAKES CERTAIN (record-claims.js checkRows, the blind
   * audit of 8.7.8): "You beat him twice, in rounds 14 and 16" where Omen
   * killed the player in both, "Omen got you in most of them" of one early
   * death in five, "before your team had even touched B" of a death at B
   * Site, the team's retake record made the player's own where he died before
   * the plant, and a Deathmatch drill about an enemy agent (gate `mode`).
   * Read in reading order, a he or a she as the agent before it, after every
   * gate before and before the orphan pass, so what leaned on it goes too.
   */
  const rc = english && (!facts || facts.game !== 'lol') ? recordMod() : null;
  if (rc && typeof rc.checkRows === 'function') {
    let found = [];
    try { found = rc.checkRows(rows.map((r) => ({ s: gates.straighten(r.s), dropped: !!r.drop, p: r.p })), rc.contextOfChat(facts)); } catch { found = []; }
    for (const o of found) {
      if (!rows[o.index] || rows[o.index].drop) continue;
      rows[o.index].drop = { gate: o.kind === 'drill' ? 'mode' : 'record', reason: o.reason };
      rows[o.index].logged = [];
    }
    leanPass(rows, english);
  }
  const co = english ? coherenceMod() : null;
  if (co && typeof co.checkOrphans === 'function') {
    let found = [];
    try { found = co.checkOrphans(rows.map((r) => ({ s: r.s, dropped: !!r.drop, p: r.p })), { agents: (facts && facts.askedAgents) || [] }); } catch { found = []; }
    for (const o of found) {
      if (!rows[o.index] || rows[o.index].drop) continue;
      rows[o.index].drop = { gate: 'orphan', reason: ORPHAN_REASON };
      rows[o.index].logged = [];
    }
    // What leaned on a sentence the orphan pass dropped ("That is the moment
    // to notice" after "If nobody can see that angle") goes with it.
    if (found.length) leanPass(rows, english);
  }
  /*
   * THE STOCK CLOSER AND THE SEAMS (coherence.js fillerOf, repairSeams, the
   * blind audit of 8.7.8): "and the other things can wait" cut off the
   * sentence it ends, a sentence that is only that dropped (gate `filler`), a
   * You glued inside a sentence written you, and a sentence ending on a
   * conjunction dropped (gate `seam`). Quiet drops: a reply's first
   * sentence going this way never asks for the reply again.
   */
  if (co && typeof co.fillerOf === 'function' && typeof co.repairSeams === 'function') {
    for (const r of rows) {
      if (r.drop) continue;
      let s = r.s;
      const filler = co.fillerOf(s);
      if (filler === '') { r.drop = { gate: 'filler', reason: FILLER_REASON, quiet: true }; r.logged = []; continue; }
      if (filler) s = filler;
      const seamed = co.repairSeams(s);
      if (seamed === null) { r.drop = { gate: 'seam', reason: ORPHAN_REASON, quiet: true }; r.logged = []; continue; }
      r.s = seamed;
    }
  }
  return rows;
}

/** A kept sentence that leans on a dropped one goes with it (leansOn), in English, run again after a later pass dropped more. */
function leanPass(rows, english) {
  for (let i = 1; english && i < rows.length; i++) {
    if (rows[i - 1].drop && !rows[i].drop && gates.leansOn(rows[i].s)) {
      rows[i].drop = { gate: 'leans', reason: LEANS_REASON };
      rows[i].logged = [];
    }
  }
}
const FILLER_REASON = 'your reply closed on a stock line that the other things can wait; name what waits, or leave it out';

/**
 * The reply, every sentence through the gates (gateReply, over fact-gates.js
 * check). A sentence that fails is dropped, never repaired. The reply is
 * asked for again (retry) when its first sentence was dropped, or fewer than
 * two survive, with the reasons named for the model; `dropped` counts by
 * gate, `logged` what the name rule in log mode would have dropped.
 * Production logs counts only, never text.
 *
 * @param opts.messages  the conversation, for the echo of a name the player typed
 * @param opts.nameSet   the match's own names, has(text) (opts.names the same)
 */
function parseReply(raw, input, opts) {
  const o = opts || {};
  const inp = input && input.v === 2 ? input : normalise(input);
  const facts = factsOf(inp, o.messages || []);
  const nameOpts = { nameSet: o.nameSet || o.names || null, isName: o.isName };
  const out = { reply: '', retry: false, reasons: [], dropped: {}, logged: {}, sentences: 0, kept: 0, firstDropped: false, clipAsks: [] };
  // Every clip marker out before a gate reads a word (chat-clips.js extract).
  const marked = chatClips.extract(raw, inp.match && inp.match.clips);
  const paras = cleanReply(marked.text);
  if (!paras.length) {
    out.retry = true;
    out.reasons.push('your reply was empty');
    return out;
  }
  const whole = paras.join(' ');
  if (NOT_AN_ANSWER.test(whole) || /^\s*[{[]/.test(whole)) {
    out.retry = true;
    out.reasons.push('your reply was not an answer to the player; answer as their coach in plain sentences');
    return out;
  }
  const kept = [];
  gateReply(paras, facts, nameOpts).forEach((row, i) => {
    out.sentences += 1;
    for (const l of row.logged || []) out.logged[l] = (out.logged[l] || 0) + 1;
    if (row.drop) {
      out.dropped[row.drop.gate] = (out.dropped[row.drop.gate] || 0) + 1;
      if (!out.reasons.includes(row.drop.reason)) out.reasons.push(row.drop.reason);
      if (i === 0 && !row.drop.quiet) out.firstDropped = true;
    } else {
      (kept[row.p] = kept[row.p] || []).push(row.s);
      out.kept += 1;
    }
  });
  let reply = kept.filter(Boolean).map((ks) => ks.join(' ')).join('\n\n');
  if (reply.length > MAX_CHARS) {
    const head = reply.slice(0, MAX_CHARS);
    const stop = Math.max(head.lastIndexOf('. '), head.lastIndexOf('.\n'), head.lastIndexOf('? '), head.lastIndexOf('! '));
    reply = (stop > MAX_CHARS / 2 ? head.slice(0, stop + 1) : head).trim();
  }
  out.reply = reply;
  // A clip goes with a paragraph of which a sentence was kept (chat-clips.js place).
  const shown = kept.filter(Boolean).length;
  out.clipAsks = chatClips.asksOf(marked, cleanReply).filter((a) => kept[a.para] && kept[a.para].length)
    .map((a) => ({ round: a.round, para: kept.slice(0, a.para).filter(Boolean).length, of: shown, kept: kept[a.para].map((s) => s.trim()) }));
  out.retry = out.firstDropped || out.kept < 2;
  /*
   * THE FALLBACK (the round 3 audit, Nov 2026). Eight of sixty answers, the
   * plainest questions among them (the biggest mistake, how to climb, what to
   * practise), were the honest line because the first sentence of the reply
   * and of its retry was dropped, though the retry kept 16 of 17. Every
   * sentence kept passed every gate: a reply that keeps FALLBACK_KEPT or more
   * is still an answer, and the route shows it when the retry fails again
   * (coach.js chatV2), rather than nothing. Fewer is the honest line, as before.
   */
  out.fallback = out.kept >= FALLBACK_KEPT;
  if (out.retry && out.kept < 2 && !out.reasons.length) out.reasons.push('your reply was too short to answer the question; answer it in full');
  out.reasons = out.reasons.slice(0, 6);
  return out;
}

/** The prompt again, with what was wrong named in the model's own terms. */
function retryPrompt(prompt, reasons) {
  const said = (Array.isArray(reasons) ? reasons : []).slice(0, 6)
    .map((r) => String(r || '').trim()).filter(Boolean)
    .map((r) => `${r.charAt(0).toUpperCase()}${r.slice(1)}${/[.!?]$/.test(r) ? '' : '.'}`);
  return `${String(prompt || '')}\n\nYOUR LAST REPLY COULD NOT BE SHOWN TO THE PLAYER.${said.length ? ` ${said.join(' ')}` : ''} Write the reply again from the facts above alone: answer the question in your first sentence, leave out anything the facts do not hold, and keep to short paragraphs of plain text.`;
}

/** buildParts' parts again for the retry: the stable ones as they were, the reasons after the question's, so joined it is retryPrompt's. */
function retryParts(parts, reasons) {
  const ps = Array.isArray(parts) ? parts.map(String) : [];
  if (!ps.length) return [retryPrompt('', reasons)];
  return [...ps.slice(0, -1), retryPrompt(ps[ps.length - 1], reasons)];
}

module.exports = {
  normalise, buildPrompt, buildParts, parseReply, retryPrompt, retryParts, HONEST_LINE,
  // The parts, for the tests and bench:chat.
  factsOf, cleanReply, gateReply, askedRounds, matchName, pickNotes, casesFor, enemiesOf, CASE_GROWTH, primerFacts, normEntry, echoOf, gateText, stated, standingsOf, deathStandingsOf, LEANS_REASON,
  renderPlayer, renderMatch, renderAsked, renderEarlier, renderSlices, staticPrefix, languageLine, gunsInCore,
  VALORANT_RULES, LEAGUE_RULES, RIOT_ONLY, NO_MATCH, DYNAMIC_MAX_CHARS, MATCH_MAX_CHARS, MAX_CHARS, MAX_ASKED_ROUNDS, VERDICT, VERDICT_REASON,
  FALLBACK_KEPT, questionTopics, QUESTION_TOPICS,
  // The re-audit of 8.7.7 (Nov 2026), each asserted in test:chatgates.
  leverLine, leversOf, LEVER_WEIGHTS, ORPHAN_REASON, KIT_HEAD,
  // The blind audit of 8.7.8 (Nov 2026): the lever below Platinum only.
  LEVER_BANDS, IMPROVING_RULE, IMPROVING_RULE_877, rulesFor,
  RANK_BANDS,
};
