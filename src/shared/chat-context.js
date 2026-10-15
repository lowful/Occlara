'use strict';

/**
 * WHAT ASK COACH IS TOLD, DECIDED IN CODE (8.5.0).
 *
 * Ask Coach before 8.5 was handed the newest review as 2,400 characters of
 * its own sentences, with no match named and no round in it. Now the match is
 * one the player can see on the page's chip, and it is sent as the facts the
 * review was built from: every round with Riot's record of it, the kill feed
 * once the review has it, both team comps, the coach's looks, the counted
 * lists and the grade with its evidence, the player's own patterns and
 * numbers. The server (server/services/chat-prompt.js) bounds every field and
 * holds the reply to them (fact-gates.js).
 *
 *   held(row, rows, now)         a match a Stop may have left being played
 *   chatList(rows, game, now)    the ten newest of a game, held ones left out
 *   pickMatch(question, chosen, list)
 *                                which match a question is about: the seeded
 *                                or picked one, else the newest, and a map the
 *                                question names moves it only by the map rule
 *   roundOf(question, review)    the round a question names, or null
 *   build(review, library, tracker, question, opts)
 *                                the v2 context
 *   needsFill(review), applyRoundRecord(review, record, now)
 *                                the one time fill of an older review (8.10)
 *   oldText(game, at, review)    today's matchReview string, still sent, so a
 *                                server from before keeps working
 *
 * NEVER IN IT: a card's screen reads (`reads`, which on the Sunset review held
 * a teammate's in game name), the engine's match memory, the live ledger,
 * anything of a session in progress, a held match, the tracker's `_riotId` or
 * any field it does not list, and the match list's 0 to 100 `rating` (65 or 50
 * plus 12 times the K/D, which is not the grade and read as one).
 *
 * Pure: no Electron, no clock of its own, no file. Plain Node for
 * test:chatcontext.
 */

const DATA = require('./valorant-data.generated.json');
const { secondPistol } = require('./breakdown');
const { killFeedOf } = require('./valorant-verify');

// A match recording was stopped in the middle of may still be being played
// for this long: one stopped in round 2 can run another hour with overtime.
const HOLD_MS = 90 * 60 * 1000;
const LIST_SIZE = 10;

const lower = (s) => String(s == null ? '' : s).toLowerCase();
const fin = (v) => typeof v === 'number' && Number.isFinite(v);
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "13 Oct", by the player's own clock. */
function dayOf(at) {
  if (!fin(at)) return null;
  const d = new Date(at);
  return `${d.getDate()} ${MONTHS[d.getMonth()]}`;
}

// ── The hold ───────────────────────────────────────────────────────────────

/*
 * A HELD MATCH: one saved after a Stop in the middle of it (stoppedLive), not
 * checked against Riot's record, under 90 minutes ago, with no later review
 * saved since. Nothing can tell when that match ends, so Ask Coach does not
 * talk about it: it is never the default, never in the list, refused when
 * "Ask about this match" names it, and frame chat refuses its frames. Riot's
 * record linking it, a later match recorded, or 90 minutes lift it.
 */
function held(row, rows, now) {
  if (!row || !row.stoppedLive || row.verified) return false;
  const at = Number(row.at);
  if (!fin(at) || !fin(now) || now - at >= HOLD_MS) return false;
  return !(Array.isArray(rows) ? rows : []).some((o) => o && o.id !== row.id && Number(o.at) > at);
}

/** When a held match's hold lifts on time, or null. */
const holdEndsAt = (row) => (row && fin(Number(row.at)) ? Number(row.at) + HOLD_MS : null);

/** The ten newest reviews of a game, newest first, no held match among them. */
function chatList(rows, game, now) {
  const all = Array.isArray(rows) ? rows.filter(Boolean) : [];
  return all.filter((r) => (!game || r.game === game) && !held(r, all, now))
    .sort((a, b) => b.at - a.at).slice(0, LIST_SIZE);
}

// ── Which match ────────────────────────────────────────────────────────────

const MAPS = (Array.isArray(DATA.maps) ? DATA.maps : []).map(String);
const escRe = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/*
 * A MATCH WORD: the question is about a match, not about a map in general. "A
 * round, a death, a result, match, game, that time, last time" (spec 8.2), the
 * results in the past tense: "how do I win on Split" asks how to play it.
 */
const MATCH_WORDS = /\b(?:rounds?|R\d{1,2}|died|death|deaths|killed|lost|won|match|that time|last time|(?:that|last|my last|the last) game)\b/i;

/**
 * The map a question names by the map rule (spec 8.2), or null: written as a
 * proper noun after "on", "in", "at" or "my", in a question that also refers
 * to a match. "Why did I die in round 5 on Split" names Split; "how do I play
 * B on Split" names no match, and "how do we split B" no map.
 */
function mapNamed(question) {
  const q = String(question || '');
  if (!MATCH_WORDS.test(q)) return null;
  // The word before it may open the question ("On Split, why did I die in
  // round 5?" moved nothing, the verifier's probe, 15 Oct); the map keeps its capital.
  for (const m of MAPS) {
    if (new RegExp(`\\b(?:[Oo]n|[Ii]n|[Aa]t|[Mm]y)\\s+${escRe(m)}(?![A-Za-z])`).test(q)) return m;
  }
  return null;
}

/**
 * Which match a question is about.
 *
 * @param chosen  { id, how }: how 'seeded' (Ask about this match), 'picked'
 *                (from the chip), 'none' (No match, general questions), or
 *                null for the newest
 * @param list    chatList(): the ten newest of the game, held ones left out
 * @returns { id, moved, from, which: { map, count } | null, none: { map } | null }
 *          `which` when two or more of the ten are on the map the question
 *          names and the match chosen is not; `none` when none is
 */
function pickMatch(question, chosen, list) {
  const rows = Array.isArray(list) ? list : [];
  const c = chosen || {};
  const base = c.how === 'none' ? null
    : (c.id && rows.some((r) => r.id === c.id) ? c.id : (rows[0] ? rows[0].id : null));
  const out = { id: base, moved: false, from: null, which: null, none: null };
  const map = mapNamed(question);
  if (!map) return out;
  const current = rows.find((r) => r.id === base);
  if (current && lower(current.map) === lower(map)) return out;
  const on = rows.filter((r) => lower(r.map) === lower(map));
  if (on.length === 1) return { ...out, id: on[0].id, moved: true, from: base };
  if (on.length > 1) return { ...out, which: { map, count: on.length } };
  return { ...out, none: { map } };
}

// ── The round a question names ─────────────────────────────────────────────

const NUMBER_WORDS = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18,
  nineteen: 19, twenty: 20 };
// "round 5", "round #5", and the word for a round in each language the app is
// written in: ronda, Runde, rodada, manche.
const ROUND_DIGITS = /\b(?:round|ronda|runde|rodada|manche)\s*#?\s*(\d{1,2})\b/i;
const R_LABEL = /\bR(\d{1,2})\b/;
const ROUND_SPELLED = /\bround\s+(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty)(?:[ -](one|two|three|four))?\b/i;
const PISTOL = /\b(?:the\s+|my\s+)?(?:(attack|attacking|defence|defense|defending)\s+)?pistol(?:\s+round)?\b/i;
const PISTOL_SIDE_AFTER = /\bpistol(?:\s+round)?\s+(?:on|in)\s+(attack|defence|defense)\b/i;

/** The pistol rounds of a review: round 1 and the first round Riot's sides change, never overtime (breakdown.js). */
function pistolsOf(review) {
  const cards = (review && Array.isArray(review.rounds) ? review.rounds : []).filter(Boolean);
  const out = new Set();
  if (cards.some((c) => c.n === 1)) out.add(1);
  const second = secondPistol(cards.map((c) => ({ n: c.n, side: sideOf(c) })), review && review.halftimeAfter);
  if (second) out.add(second);
  return out;
}

const sideOf = (c) => (c && (c.sideKey === 'attacking' || c.sideKey === 'defending') ? c.sideKey
  : /^att/i.test(String((c && c.side) || '')) ? 'attacking' : /^def/i.test(String((c && c.side) || '')) ? 'defending' : null);

/**
 * The round a question names, read before the server scrubs a Riot ID out of
 * it ("round #12" reads as one): "round 5", "round five", "R5", "round #5",
 * "the pistol round" (the match's first, or the one on the side it names),
 * "the first round", "the last round", "overtime". Null when it names none, or
 * one the match does not have.
 */
function roundOf(question, review) {
  const q = String(question || '');
  const cards = (review && Array.isArray(review.rounds) ? review.rounds : []).filter(Boolean);
  const has = (n) => (Number.isInteger(n) && cards.some((c) => c.n === n) ? n : null);
  let m = ROUND_DIGITS.exec(q);
  if (m) return has(Number(m[1]));
  m = R_LABEL.exec(q);
  if (m) return has(Number(m[1]));
  m = ROUND_SPELLED.exec(q);
  if (m) return has(NUMBER_WORDS[lower(m[1])] + (m[2] ? NUMBER_WORDS[lower(m[2])] : 0));
  if (/\bthe first round\b/i.test(q)) return has(1);
  if (/\bthe (?:last|final) round\b/i.test(q)) return cards.length ? Math.max(...cards.map((c) => c.n)) : null;
  const p = PISTOL.exec(q);
  if (p) {
    const after = PISTOL_SIDE_AFTER.exec(q);
    const word = p[1] || (after && after[1]) || null;
    const side = word ? (/^att/i.test(word) ? 'attacking' : 'defending') : null;
    const pistols = [...pistolsOf(review)].sort((a, b) => a - b);
    const pick = side ? pistols.find((n) => sideOf(cards.find((c) => c.n === n)) === side) : pistols[0];
    return has(pick == null ? null : pick);
  }
  if (/\bovertime\b/i.test(q)) {
    const swift = /swift/i.test(String((review && review.game && review.game.mode) || ''));
    const from = swift ? 9 : 25;
    const ot = cards.map((c) => c.n).filter((n) => n >= from).sort((a, b) => a - b);
    return ot.length ? ot[0] : null;
  }
  return null;
}

// ── The phrase lists (the server's, fact-gates.js PHRASES, held equal) ──────

/*
 * WHAT IN A BETTER PLAY MOVES THE PLAYER AWAY FROM THE DUEL (spec 6.5). A
 * saved lost-duel whose better line trips one of these is sent WITHOUT its
 * label: its better play says the fight was not one to take from there, and
 * the chat must teach that and never call it fair. The server's copy in
 * server/services/fact-gates.js is held equal by test:chatcontext, since
 * check:clientboot forbids requiring it from here.
 */
const PHRASES = {
  decision: /\b(let them come|let the clock|play for time|make them come to you|no need to|do not take the fight|don't take the fight|hold the spike)\b/i,
  team: /\b(teammates?|trade|swing with|with your team|together)\b/i,
  reset: /\b(fall back|step back|back behind cover|back into cover|reset|disengage|pull back|after your first shots|after the first exchange|after the first burst|instead of staying|stop firing and)\b/i,
  utility: /\b(smoke|flash|drone|recon|utility|information first)\b/i,
  aim: /\b(crosshair|aim|head level|counter ?strafe|tap|burst|first bullet|spray)\b/i,
};

const kitOf = (agent) => {
  const a = (DATA.agents || {})[agent];
  return a && Array.isArray(a.abilities) ? a.abilities.map(lower) : [];
};

/** The first list a better line trips, of decision, team, reset and utility (the kit included), or null. */
function phraseHit(better, abilities) {
  const b = String(better || '');
  if (!b) return null;
  for (const k of ['decision', 'team', 'reset', 'utility']) if (PHRASES[k].test(b)) return k;
  const t = lower(b);
  for (const ab of abilities || []) if (ab && new RegExp(`\\b${escRe(lower(ab))}\\b`).test(t)) return 'utility';
  return null;
}

// ── The context ────────────────────────────────────────────────────────────

/*
 * THE NUMBERS A LOOK READ OFF THE HUD, with their units ("57 health", "105
 * damage"), as that round's screen facts. A look's own digits are what its
 * sentences say, and the chat may say them of that round.
 */
const LOOK_DIGIT = /\b(\d{1,4})\s*(health|hp|damage|dmg|shields?|armou?r|credits?|seconds?|metres?|meters?|kills?)\b/gi;
const UNIT = (u) => {
  const x = lower(u);
  if (/^(?:health|hp)$/.test(x)) return 'health';
  if (/^(?:damage|dmg)$/.test(x)) return 'damage';
  if (/^(?:shields?|armou?r)$/.test(x)) return 'armor';
  if (/^credits?$/.test(x)) return 'credits';
  if (/^seconds?$/.test(x)) return 'seconds';
  if (/^(?:metres?|meters?)$/.test(x)) return 'metres';
  return 'kills';
};
function lookDigits(text) {
  const out = [];
  for (const m of String(text || '').matchAll(new RegExp(LOOK_DIGIT.source, 'gi'))) out.push({ value: Number(m[1]), unit: UNIT(m[2]) });
  return out.slice(0, 8);
}

/** Riot's kill feed as a card keeps it, in seconds into the round: { s, by, on, ka, va, w }. */
function feedOf(feed) {
  return (Array.isArray(feed) ? feed : []).filter(Boolean).slice(0, 24).map((k) => ({
    s: fin(k.s) ? k.s : (fin(k.ms) ? Math.round(k.ms / 100) / 10 : null),
    by: k.by || null, on: k.on || null,
    ka: typeof k.ka === 'string' ? k.ka : null,
    va: typeof k.va === 'string' ? k.va : null,
    w: typeof k.w === 'string' ? k.w : null,
  }));
}

/** The site of a card's plant: Riot's, or the letter its facts line names. */
function plantSiteOf(card) {
  if (card && card.riot && /^[ABC]$/.test(String(card.riot.plantSite || ''))) return card.riot.plantSite;
  const line = (card && Array.isArray(card.facts) ? card.facts : []).find((f) => /^Spike planted at /.test(String(f)));
  const m = line ? /^Spike planted at ([ABC])(?![a-z])/.exec(line) : null;
  return m ? m[1] : null;
}

/*
 * NUMBERS AN EXPLANATION NEEDS, COMPUTED HERE (spec 8.3): the seconds from
 * the player's last kill to their death, and the seconds after the plant. The
 * spike's time left is the server's to compute, from the primer's stated
 * timer, so no game number is typed on the client.
 */
function derivedOf(card) {
  const r = card && card.riot;
  if (!r || !card.died) return null;
  const feed = feedOf(r.feed);
  const death = feed.find((k) => k.on === 'me');
  const at = death && fin(death.s) ? death.s : (fin(r.sec) ? r.sec : null);
  if (at === null) return null;
  const mine = feed.filter((k) => k.by === 'me' && k.on === 'enemy' && fin(k.s) && k.s <= at);
  const last = mine.length ? mine[mine.length - 1].s : null;
  const plant = fin(r.plantSec) ? r.plantSec : null;
  const out = {
    sinceOwnKill: last !== null ? Math.round((at - last) * 10) / 10 : null,
    afterPlantSec: r.afterPlant && plant !== null && at >= plant ? Math.round((at - plant) * 10) / 10 : null,
    spikeLeft: null,
  };
  return out.sinceOwnKill === null && out.afterPlantSec === null ? null : out;
}

/*
 * A CARD SAVED BEFORE 8.0.3 HAS NO RIOT FIELDS, only the sentences
 * roundFacts() wrote from them (valorant-review.js), and those are fixed
 * strings, so a verified one is read back here, as the breakdown and the late
 * link read them (breakdown.js, riot-review.js ledgerRows). Without it the
 * player's Abyss swiftplay went to Ask Coach with no killer, no second and no
 * trade in any round. test:chatcontext holds the reading equal to the fields
 * on the real match. What the sentences never held (the plant's time, the
 * feed, whether the death came after the plant) stays unsaid.
 */
const DEATH_LINE = /^Died(?: at ([^,]+?))?(?:,? (\d{1,3})s in)?(?:, to (.+?)(?: with an? (.+))?)?$/;
const ALIVE_LINE = /^(\d) against (\d) when you died$/;
const KILLS_LINE = /^(\d{1,2}) kills?$/;
const TRADES_LINE = /^Traded teammates (\d{1,2}) times$/;
const CLUTCH_LINE = /^Last one standing against (\d)(, and won it|, lost)?$/;

// A card of 8.0.0 or 8.0.1 carries no verified flag of its own: its review's says.
const verifiedCard = (c, review) => c.verified === true || (c.verified === undefined && !!(review && review.verified));

function oldFacts(c, review) {
  const facts = (Array.isArray(c.facts) ? c.facts : []).map((f) => String(f));
  if (!verifiedCard(c, review) || !facts.length) return null;
  const riot = { sec: null, killer: null, weapon: null, firstDeath: false, firstKill: false, kills: 0, traded: null,
    trades: 0, alive: null, clutch: null, afterPlant: false };
  let spot = null;
  for (const f of facts) {
    let m = null;
    if (c.died && (m = DEATH_LINE.exec(f))) {
      spot = m[1] || null;
      riot.sec = m[2] ? Number(m[2]) : null;
      riot.killer = m[3] || null;
      riot.weapon = m[4] || null;
    } else if (f === 'First death of the round') riot.firstDeath = true;
    else if (f === 'First kill of the round') riot.firstKill = true;
    else if (f === 'Traded by a teammate') riot.traded = true;
    else if (f === 'Not traded') riot.traded = false;
    else if (f === 'Traded a teammate') riot.trades = 1;
    else if ((m = TRADES_LINE.exec(f))) riot.trades = Number(m[1]);
    else if ((m = KILLS_LINE.exec(f))) riot.kills = Number(m[1]);
    else if ((m = ALIVE_LINE.exec(f))) riot.alive = { mates: Number(m[1]), enemies: Number(m[2]) };
    else if ((m = CLUTCH_LINE.exec(f))) riot.clutch = { vs: Number(m[1]), won: m[2] === ', and won it' ? true : m[2] === ', lost' ? false : null };
  }
  return { riot, spot };
}

function cardOf(c, review, pistols) {
  const old = c.riot ? null : oldFacts(c, review);
  const r = c.riot || (old && old.riot) || null;
  const spot = c.spot || (old && old.spot) || null;
  const ult = !!c.ultReady || (!!old && c.facts.includes('Ultimate was ready'));
  const agent = review.game && review.game.agent;
  const f = c.forensics || null;
  let look = null;
  if (f && f.cause) {
    // A lost-duel whose better play moves the player is sent without its label.
    const cause = f.cause === 'lost-duel' && phraseHit(f.better, kitOf(agent)) ? null : f.cause;
    look = {
      cause,
      fight: typeof f.fight === 'string' ? f.fight : null,
      change: typeof f.change === 'string' ? f.change : null,
      what: f.cause === 'unclear' ? null : (f.what || null),
      better: f.cause === 'unclear' ? null : (f.better || null),
      source: f.source === 'screen' ? 'screen' : 'riot',
    };
  }
  const digits = f && f.cause !== 'unclear' ? lookDigits(`${f.what || ''} ${f.better || ''}`) : [];
  return {
    n: c.n,
    side: sideOf(c),
    result: c.result === 'won' || c.result === 'lost' ? c.result : null,
    died: !!c.died,
    verified: verifiedCard(c, review),
    watched: c.watched !== false,
    pistol: pistols.has(c.n),
    planted: !!c.planted,
    riot: r ? {
      sec: fin(r.sec) ? r.sec : null,
      killer: r.killer || null,
      weapon: r.weapon || null,
      firstDeath: !!r.firstDeath,
      firstKill: !!r.firstKill,
      kills: fin(r.kills) ? r.kills : null,
      traded: typeof r.traded === 'boolean' ? r.traded : null,
      trades: fin(r.trades) ? r.trades : null,
      alive: r.alive && fin(r.alive.mates) ? { mates: r.alive.mates, enemies: r.alive.enemies } : null,
      clutch: r.clutch && fin(r.clutch.vs) ? { vs: r.clutch.vs, won: typeof r.clutch.won === 'boolean' ? r.clutch.won : null } : null,
      afterPlant: !!r.afterPlant,
      plantSite: plantSiteOf(c),
      plantSec: fin(r.plantSec) ? r.plantSec : null,
      feed: feedOf(r.feed),
    } : null,
    derived: derivedOf(c),
    screen: spot || ult || digits.length ? { spot, ult: ult ? 'ready' : null, lookDigits: digits } : null,
    look,
    why: typeof c.why === 'string' && c.why ? c.why : null,
  };
}

/** An entry of the counted lists, as the server takes one: never more than these fields. */
const entryOf = (e) => (e && e.title ? { key: e.key || null, title: e.title, detail: e.detail || null,
  rounds: Array.isArray(e.rounds) ? e.rounds.slice(0, 24) : [], count: fin(e.count) ? e.count : null, fix: e.fix || null } : null);

/** The breakdown's row for this match's agent or map, as numbers with their sample. */
function rowOf(rows, label) {
  const r = (Array.isArray(rows) ? rows : []).find((x) => x && lower(x.label) === lower(label));
  if (!r) return null;
  const s = r.stats || {};
  const v = (x) => (x && fin(x.value) ? x.value : null);
  return {
    label: r.label, matches: fin(r.matches) ? r.matches : null,
    won: r.record ? r.record.won : null, lost: r.record ? r.record.lost : null, known: r.record ? r.record.known : null,
    winRate: r.winRate && fin(r.winRate.pct) ? r.winRate.pct : null,
    grade: r.grade && fin(r.grade.avg) ? r.grade.avg : null, letter: r.grade ? r.grade.letter : null,
    kd: v(s.kd), acs: v(s.acs), adr: v(s.adr), hs: v(s.hs),
  };
}

/*
 * THE TRACKER'S PROFILE, ONLY THE FIELDS LISTED (spec 8.3): never `_riotId`,
 * which a profile kept on disk carries, nor anything the server did not ask
 * for. Riot's numbers over the player's last matches, never this match's.
 */
function trackerOf(st) {
  if (!st || typeof st !== 'object' || st.error) return null;
  const n = (x) => (fin(x) ? x : null);
  return {
    queue: st.mode === 'unrated' ? 'unrated' : 'competitive',
    rank: typeof st.rank === 'string' ? st.rank : null,
    peak: typeof st.peakRank === 'string' ? st.peakRank : null,
    matches: n(st.matches), kd: n(st.kd), winRate: n(st.winRate), hs: n(st.headshotPct),
    acs: n(st.acs), adr: n(st.adr), kpr: n(st.kpr), dpr: n(st.dpr), apr: n(st.apr),
    agents: (Array.isArray(st.topAgents) ? st.topAgents : []).slice(0, 3).map((a) => ({
      agent: a && a.name, matches: n(a && a.matches), winRate: n(a && a.winRate), kd: n(a && a.kd), acs: n(a && a.acs),
    })).filter((a) => typeof a.agent === 'string'),
  };
}

/** Whether a review is of a match the watch thought was over too soon (Riot's record has it going on). */
function endedEarlyOf(review) {
  return (Array.isArray(review.refused) ? review.refused : []).some((t) => /thought the match was over/i.test(String(t)));
}

function valorantMatch(review) {
  const g = review.game || {};
  const cards = (Array.isArray(review.rounds) ? review.rounds : []).filter((c) => c && Number.isInteger(c.n));
  const pistols = pistolsOf(review);
  const sl = review.scoreline || null;
  const ins = review.insights || {};
  return {
    id: review.id || null,
    matchId: review.matchId || null,
    at: fin(review.at) ? review.at : null,
    day: dayOf(review.at),
    source: review.source === 'riot' ? 'riot' : 'watched',
    verified: !!review.verified,
    endedEarly: endedEarlyOf(review),
    map: g.map || null,
    agent: g.agent || null,
    mode: g.mode || null,
    result: g.result || null,
    score: g.score || null,
    rounds: cards.length,
    watched: review.source === 'riot' ? [] : cards.filter((c) => c.watched !== false).map((c) => c.n),
    comps: review.comps && typeof review.comps === 'object' ? {
      us: (review.comps.us || []).map((x) => ({ agent: x && x.agent, role: x && x.role })),
      them: (review.comps.them || []).map((x) => ({ agent: x && x.agent, role: x && x.role })),
    } : null,
    scoreline: sl ? { kills: sl.kills, deaths: sl.deaths, assists: sl.assists, acs: sl.acs, adr: sl.adr,
      hs: fin(sl.headshotPct) ? sl.headshotPct : null, mvp: sl.mvp || null } : null,
    against: (Array.isArray(review.against) ? review.against : []).map((a) => ({ label: a.label, value: a.value, baseline: a.baseline, games: a.games })),
    grade: review.grade && fin(review.grade.score) ? {
      score: review.grade.score, letter: review.grade.letter, provisional: !!review.grade.provisional,
      categories: (review.grade.categories || []).map((c) => ({ key: c.key, label: c.label, score: c.score, evidence: Array.isArray(c.evidence) ? c.evidence : [] })),
    } : null,
    lists: {
      mistakes: (ins.mistakes || []).map(entryOf).filter(Boolean),
      strengths: (ins.strengths || []).map(entryOf).filter(Boolean),
      missed: (ins.missed || []).map(entryOf).filter(Boolean),
      facts: (ins.facts || []).map(entryOf).filter(Boolean),
    },
    patterns: (Array.isArray(review.patterns) ? review.patterns : []).map((p) => ({ key: p.key, text: p.text })),
    cards: cards.map((c) => cardOf(c, review, pistols)),
    coach: { summary: review.summary || null, focus: review.focus || null },
    verification: review.verification || null,
    dossier: null,
  };
}

/*
 * A LEAGUE GAME IS ITS COMPUTED REVIEW ALONE: the scoreline, the grade, the
 * lists, every death by the game's clock with its one fact. Never the
 * summoner name the recorder kept (`game.me`).
 */
function lolMatch(review) {
  const g = review.game || {};
  const sl = review.scoreline || {};
  const ins = review.insights || {};
  const facts = [];
  if (review.deaths && review.deaths.headline) facts.push(review.deaths.headline);
  if (review.next && review.next.title) facts.push(`The lesson to work on next: ${review.next.title}.`);
  return {
    id: review.id || null, at: fin(review.at) ? review.at : null, day: dayOf(review.at),
    champion: g.champion || null, role: g.role || null, mode: g.mode || null, durationSec: fin(g.durationSec) ? g.durationSec : null,
    result: g.result || null,
    scoreline: { kills: sl.kills, deaths: sl.deaths, assists: sl.assists, cs: sl.cs, csAt10: sl.csAt10, ward: sl.ward, level: sl.level },
    grade: review.grade && fin(review.grade.score) ? {
      score: review.grade.score, letter: review.grade.letter, provisional: !!review.grade.provisional,
      categories: (review.grade.categories || []).map((c) => ({ key: c.key, label: c.label, score: c.score, evidence: Array.isArray(c.evidence) ? c.evidence : [] })),
    } : null,
    lists: {
      mistakes: (ins.mistakes || []).map(entryOf).filter(Boolean),
      strengths: (ins.strengths || []).map(entryOf).filter(Boolean),
      missed: (ins.missed || []).map(entryOf).filter(Boolean),
    },
    deaths: (Array.isArray(review.deathList) ? review.deathList : []).map((d) => ({ n: d.n, atSec: d.atSec, fact: d.fact })),
    facts,
  };
}

/** The label a library row is named by, in fields: the page words it in the player's language. */
function labelOf(row) {
  if (!row) return null;
  return { id: row.id, game: row.game || null, map: row.map || null, agent: row.title || null, mode: row.mode || null,
    result: row.result || null, score: row.score || null, day: dayOf(row.at), at: row.at, source: row.source || null };
}

/**
 * The v2 context.
 *
 * @param review    the review as a window is shown it (index.js present()), or null
 * @param library   { rows, patterns, breakdown }: every library row, the
 *                  game's patterns (patterns.js summarise) and breakdown
 *                  (breakdown.js build)
 * @param tracker   the tracker profile (index.js fetchTrackerStats), or null
 * @param question  the player's question
 * @param opts      { game, language, advanced, switchedFrom (a library row), now }
 */
function build(review, library, tracker, question, opts) {
  const o = opts || {};
  const lib = library || {};
  const game = o.game === 'lol' ? 'lol' : 'valorant';
  const rows = Array.isArray(lib.rows) ? lib.rows : [];
  const r = review && typeof review === 'object' ? review : null;
  const match = !r ? null : game === 'lol' ? lolMatch(r) : valorantMatch(r);
  const pats = lib.patterns || {};
  const of = fin(pats.recorded) ? pats.recorded : null;
  const patterns = [...(pats.mistakes || []).slice(0, 4), ...(pats.strengths || []).slice(0, 2)]
    .map((p) => ({ key: p.key, title: p.title, matches: p.matches, of, trend: p.trend || null }));
  const dims = (lib.breakdown && lib.breakdown.rows) || {};
  const recent = chatList(rows, game, o.now).filter((x) => !r || x.id !== r.id).slice(0, 8).map((x) => ({
    at: x.at, day: dayOf(x.at), map: x.map || null, agent: x.title || null, mode: x.mode || null,
    result: x.result || null, score: x.score || null, grade: x.grade && fin(x.grade.score) ? x.grade.score : null,
  }));
  const sw = o.switchedFrom ? labelOf(o.switchedFrom) : null;
  return {
    v: 2,
    game,
    language: o.language || 'en',
    advanced: o.advanced === true,
    match,
    player: {
      patterns,
      agentRow: game === 'valorant' && match ? rowOf(dims.agent, match.agent) : null,
      mapRow: game === 'valorant' && match ? rowOf(dims.map, match.map) : null,
      tracker: game === 'valorant' ? trackerOf(tracker) : null,
      recent,
    },
    ask: {
      round: game === 'valorant' && r ? roundOf(question, r) : null,
      switchedFrom: sw ? { map: sw.map, agent: sw.agent, result: sw.result, score: sw.score, day: sw.day } : null,
    },
  };
}

// ── The starters a match opens with ────────────────────────────────────────

/**
 * What the page offers to ask about a match: the round to walk through (its
 * first lost round with a look, else its first lost round), its agent, and
 * whether it was graded from Riot's record alone, which opens with its own
 * question.
 */
function startersOf(review) {
  const r = review || {};
  const cards = (Array.isArray(r.rounds) ? r.rounds : []).filter(Boolean).sort((a, b) => a.n - b.n);
  const lost = cards.filter((c) => c.result === 'lost');
  const looked = lost.find((c) => c.forensics && c.forensics.cause);
  return {
    walk: looked ? looked.n : lost.length ? lost[0].n : null,
    agent: (r.game && (r.game.agent || r.game.champion)) || null,
    map: (r.game && r.game.map) || null,
    riotOnly: r.source === 'riot',
    lol: r.kind === 'lol',
  };
}

// ── The one time fill ──────────────────────────────────────────────────────

/*
 * A REVIEW SAVED BEFORE 8.5.0 KEEPS NO KILL FEED, NO PLANT TIME AND NO COMPS,
 * though Riot's round record has them, so Ask Coach could not tell one of its
 * rounds in order. It is filled once, when Ask Coach opens on it: linked (it
 * has a match id), no card with a feed, and never filled or asked before.
 */
function needsFill(review) {
  const r = review || {};
  if (r.kind !== 'valorant' || !r.matchId || r.roundRecordAt || r.roundRecordAsked) return false;
  const cards = Array.isArray(r.rounds) ? r.rounds : [];
  if (!cards.some((c) => c && c.riot)) return false;
  return !cards.some((c) => c && c.riot && Array.isArray(c.riot.feed));
}

/*
 * WHAT THE FILL STORES, AND NOTHING ELSE: on each card with Riot's facts its
 * round's kill feed (with the agents and the gun when the server sends them),
 * the plant's time and site, the review's comps, and the stamp. No regrade,
 * no narrative, no list. A field the server does not send is not stored.
 */
function applyRoundRecord(review, record, now) {
  const per = Array.isArray(record && record.perRound) ? record.perRound : [];
  const byN = new Map(per.filter((x) => x && Number.isInteger(x.n)).map((x) => [x.n, x]));
  const rounds = (Array.isArray(review.rounds) ? review.rounds : []).map((c) => {
    const rr = c && c.riot ? byN.get(c.n) : null;
    if (!rr) return c;
    const riot = { ...c.riot };
    // The shape a review linked by 8.5.0 keeps from its link, by the same
    // function (valorant-verify.js killFeedOf): sides, and agents and guns the
    // game data knows, so a name a server sent in their place is kept as none.
    if (Array.isArray(rr.feed)) riot.feed = killFeedOf(rr.feed);
    if (fin(rr.plantMs)) riot.plantSec = Math.round(rr.plantMs / 100) / 10;
    if (/^[ABC]$/.test(String(rr.plantSite || ''))) riot.plantSite = rr.plantSite;
    return { ...c, riot };
  });
  const comps = record && record.comps && typeof record.comps === 'object'
    && (Array.isArray(record.comps.us) || Array.isArray(record.comps.them))
    ? { us: (record.comps.us || []).map((x) => ({ agent: x.agent, role: x.role || null })),
        them: (record.comps.them || []).map((x) => ({ agent: x.agent, role: x.role || null })) } : null;
  return { ...review, rounds, ...(comps ? { comps } : {}), roundRecordAt: now };
}

/** An answer to the fill that will not change, so it is never asked again. */
function fillRefused(data) {
  const said = String((data && data.error) || '');
  return /not in this match|refused the match lookup|could not resolve the account|No match id/i.test(said);
}

// ── Today's string, for a server from before ───────────────────────────────

/**
 * One review as plain text, as Ask Coach was handed it before 8.5.0 (index.js
 * chatReviewContext, moved here whole), so a server that does not read the
 * v2 context answers as it always did.
 */
function oldText(game, at, review) {
  const r = review || {};
  const g = r.game || {};
  const lines = [];
  lines.push(`${game} match on ${new Date(at).toLocaleDateString([], { month: 'short', day: 'numeric' })}: `
    + [g.map, g.agent || g.champion, g.mode, g.result, g.score].filter(Boolean).join(', ') + '.');
  const sl = r.scoreline || {};
  if (typeof sl.kills === 'number') lines.push(`Scoreline ${sl.kills}/${sl.deaths}/${sl.assists}${sl.acs ? `, ACS ${sl.acs}` : ''}.`);
  const gr = r.grade;
  if (gr && gr.score !== null && gr.score !== undefined) {
    lines.push(`Grade ${gr.score} (${gr.letter})${gr.provisional ? ', provisional' : ''}: `
      + (gr.categories || []).filter((c) => c.score !== null).map((c) => `${c.label} ${c.score} (${c.evidence.join('; ')})`).join('. ') + '.');
  }
  const ins = r.insights || {};
  const listOf = (xs, n = 3) => (xs || []).slice(0, n).map((x) => `${x.title}: ${x.detail}`).join(' ');
  if ((ins.mistakes || []).length) lines.push(`Repeated mistakes: ${listOf(ins.mistakes)}`);
  if ((ins.strengths || []).length) lines.push(`Went well: ${listOf(ins.strengths)}`);
  if ((ins.missed || []).length) lines.push(`Missed: ${listOf(ins.missed)}`);
  if ((ins.facts || []).length) lines.push(`What Riot's record shows: ${listOf(ins.facts, 6)}`);
  for (const card of (r.rounds || []).filter((c) => c.forensics && c.forensics.what).slice(0, 4)) {
    lines.push(`Round ${card.n} death, the coach looked at the frame: ${card.forensics.what}${card.forensics.better ? ' Better: ' + card.forensics.better : ''}`);
  }
  if (r.summary) lines.push(`Review summary: ${r.summary}`);
  if (r.focus) lines.push(`Focus given: ${r.focus}`);
  return lines.join('\n').slice(0, 2400);
}

/*
 * THE TRACKER'S PROFILE AS TODAY'S CHAT READ IT, the fields its prompt reads
 * and none else: never `_riotId`.
 */
function oldStats(st) {
  if (!st || typeof st !== 'object') return null;
  const out = {};
  for (const k of ['error', 'matches', 'rank', 'peakRank', 'kd', 'winRate', 'headshotPct', 'bodyshotPct', 'topAgent', 'kpr', 'dpr', 'apr', 'adr', 'acs']) {
    if (st[k] !== undefined) out[k] = st[k];
  }
  return out;
}

module.exports = {
  HOLD_MS, LIST_SIZE, held, holdEndsAt, chatList, pickMatch, mapNamed, roundOf, pistolsOf, build, startersOf,
  needsFill, applyRoundRecord, fillRefused, oldText, oldStats, labelOf, dayOf, phraseHit, lookDigits, feedOf, derivedOf,
  trackerOf, oldFacts, PHRASES, MATCH_WORDS, ROUND_DIGITS, R_LABEL, ROUND_SPELLED, PISTOL, LOOK_DIGIT,
  DEATH_LINE, ALIVE_LINE, KILLS_LINE, TRADES_LINE, CLUTCH_LINE,
};
