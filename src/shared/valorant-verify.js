'use strict';

/**
 * Check the screen's round ledger against Riot's record of the same match.
 *
 * THE SCREEN IS WRONG IN WAYS ONLY RIOT CAN SHOW. On the real 24 round Abyss
 * match in scripts/fixtures the ledger read 22 deaths where Riot has 21 (an
 * invented one in round 17), and put 6 deaths in the first 30 seconds where
 * Riot puts 19 of 21 there. That second one is the spectator trap: the instant
 * a player dies the HUD becomes a teammate's, alive at 100 health, so the coach
 * believes the player lived another thirty seconds. A review built on that
 * tells an entry player their problem is mid round positioning.
 *
 * So when the match links, Riot decides every fact it records exactly:
 *
 *   died or not, and when, to the second
 *   which agent killed them, and with what
 *   whether they were the first death of the round, or got the first kill
 *   their kills in the round, who won it, which side they were on
 *   whether the spike went down
 *
 * The screen keeps only what Riot does not record: where the player was, the
 * ultimate icon, and what the coach said at the time. A screen death spot is
 * kept only in a round Riot confirms a death, and a plant's callout only in a
 * round Riot says was planted, on the site Riot says it was planted on.
 *
 * AND A DEATH IS RIOT'S ONLY WHERE ITS MOMENT IS (8.3.1). With the AI log's
 * frames beside the ledger, a death the screen registered more than five
 * seconds before Riot's own is another moment, and counted with the deaths the
 * screen invented: on the player's Sunset swiftplay 8.3.0 filed round 5's
 * false death, read during an ally's defuse, under round 6, nearly a minute
 * before Riot's round 6 death, and the line counted it as agreeing while round
 * 6 took its place and its ultimate.
 *
 * AND THE COACH'S OWN READS ARE CHECKED. A death review in a round Riot says
 * the player survived is dropped, and so is one naming a killer Riot says did
 * not kill them. "You died to Viper" when Skye killed you is a confident wrong
 * sentence in the one place the player is most likely to check it.
 *
 * Pure, so the tests run it against the real fixture and Riot's real record.
 */

const deathFrames = require('./death-frames');

let AGENTS = [];
// A kill's gun as the feed keeps it (killFeedOf): the game's guns, and every
// agent's abilities by their kit names, since an ability can kill.
let GUNS = [];
let KIT_NAMES = [];
try {
  const d = require('./valorant-data.generated.json');
  AGENTS = Object.keys(d.agents || {});
  GUNS = Object.keys(d.weapons || {});
  for (const a of Object.values(d.agents || {})) {
    for (const k of (a && Array.isArray(a.kit) ? a.kit : [])) if (k && typeof k.name === 'string' && k.name) KIT_NAMES.push(k.name);
  }
} catch {
  AGENTS = [];
}

/*
 * A WEAPON IS A NAME, NEVER A TYPE (8.4.1). The server took HenrikDev's type
 * for a weapon it could not name, and the player's Fracture round 6 read "to
 * Chamber with a Weapon" (server/services/riot-rounds.js weaponOf, which no
 * longer does). A server from before still sends "Weapon" or "Ability", so
 * here, where Riot's record enters the client, a word that names no weapon is
 * no weapon: the card says "to Chamber", and neither prompt is told one. The
 * server's list, mirrored by hand (check:clientboot forbids reaching into
 * server/); test:valorantreview holds the two equal.
 */
const NOT_A_WEAPON = ['weapon', 'ability', 'bomb', 'fall', 'invalid', 'ultimate', 'primary', 'ability1', 'ability2',
  'grenadeability', 'passive'];
function weaponName(w) {
  const s = typeof w === 'string' ? w.trim() : '';
  return s && !NOT_A_WEAPON.includes(s.toLowerCase().replace(/\s+/g, '')) ? s : null;
}

/** The killer's damage on the player as the server sends it, whole counts only, or null. */
function damageOf(d) {
  if (!d || typeof d !== 'object') return null;
  const whole = (v) => (typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 9999 ? v : null);
  const damage = whole(d.damage);
  if (!damage) return null;
  return { damage, head: whole(d.head) ?? 0, body: whole(d.body) ?? 0, legs: whole(d.legs) ?? 0 };
}

/*
 * A KILLER IS AN AGENT, NEVER A PLAYER (8.4.1). The server names the killer in
 * Riot's death check by the agent they played (coach.js killerAgentOf), and
 * one from before still sends the killer's full Riot ID, or a puuid, which the
 * AI log painted on every death Riot confirmed: a name its owner may have
 * hidden. So where that check enters the client (death-reconcile.js), a
 * killer is an agent the game data knows, in its own spelling, or none.
 */
function agentName(s) {
  const t = typeof s === 'string' ? s.trim().toLowerCase() : '';
  return (t && AGENTS.find((a) => a.toLowerCase() === t)) || null;
}

/*
 * WHERE THE SPIKE WENT DOWN IS RIOT'S, when its record names the site (8.3.1;
 * server/services/riot-rounds.js plantSiteOf). The screen's callout stays where
 * it names that site, the part Riot never says ("B Boba" in a round Riot has
 * planted on B), and gives way to the site where it names another or none: on
 * the player's Sunset swiftplay round 5's "B Boba" was round 4's plant, filed a
 * round ahead, and Riot has round 5 planted on A. A record with no site, one
 * fetched before the server sent it, keeps the screen's, as before.
 */
const SITE_RE = /^([abc])(?![a-z])/i;
function plantSpotOf(screen, site) {
  const riot = typeof site === 'string' && /^[ABC]$/.test(site) ? site : null;
  if (!riot) return screen || null;
  const said = String(screen || '').trim();
  const m = SITE_RE.exec(said);
  // A bare letter says nothing the site does not.
  return m && m[1].toUpperCase() === riot && said.length > 1 ? screen : `${riot} Site`;
}

/*
 * A SCREEN DEATH MORE THAN THIS BEFORE RIOT'S IS NOT RIOT'S (8.3.1). Riot's
 * death is its round's barriers dropping, read off the round's own clock, plus
 * Riot's milliseconds (death-frames.js deathMoment), and the screen's is the
 * frame that registered it (framesFor, the ledger's own rule for which one).
 * A read a second registers a death 0.7 to 2.7 s after it (the Sunset clips),
 * so one five seconds before cannot be it. AFTER IS NOT CHECKED: a death
 * registered late is the same death, the spectator trap, and on the Abyss
 * session read every nine seconds, 26, 42 and 50 s after Riot's.
 */
const EARLY_DEATH_MS = 5000;

/**
 * How many seconds before Riot's death the screen registered its own of the
 * round, when it was more than EARLY_DEATH_MS before; null when it was not, or
 * when the frames cannot say (no AI log, no clock to place Riot's death by, no
 * frame that registered the screen's).
 */
function earlyBy(records, rr, window) {
  if (!Array.isArray(records) || !records.length) return null;
  const moment = deathFrames.deathMoment(records,
    { n: rr.n, died: true, deathMs: rr.deathMs, plantMs: rr.plantMs, afterPlant: !!rr.afterPlant }, window);
  if (!Number.isFinite(moment)) return null;
  const reg = deathFrames.framesFor(records, { n: rr.n, died: true, verified: false, screenDied: true }, window)
    .find((f) => f && f.died);
  if (!reg || !Number.isFinite(reg.at) || moment - reg.at <= EARLY_DEATH_MS) return null;
  return Math.round((moment - reg.at) / 1000);
}

/** The agent a read names as the killer, or null. Plain string search, no regex. */
function namedKiller(text) {
  const t = String(text || '').toLowerCase();
  for (const agent of AGENTS) {
    const a = agent.toLowerCase();
    if (t.includes(`died to ${a}`) || t.includes(`killed by ${a}`) || t.includes(`${a} killed you`)
        || t.includes(`${a} caught you`) || t.includes(`died to an enemy ${a}`)) {
      return agent;
    }
  }
  return null;
}

const same = (a, b) => String(a || '').toLowerCase().replace(/[^a-z]/g, '')
  === String(b || '').toLowerCase().replace(/[^a-z]/g, '');

/*
 * A round's kill feed as a review keeps it (8.5.0), the shape Ask Coach's one
 * time fill stores (chat-context.js applyRoundRecord): { ms, by, on }, and
 * the killer's agent, the victim's and the gun (ka, va, w) where the server
 * sent them, each an agent the game data knows (agentName) or what the game
 * data says can kill (feedGun: a gun, the knife, an ability by its kit name),
 * so nothing a server sent as a player can ride in either. Nothing else of an
 * entry is kept. Null when the record holds no feed (a server from before it
 * parsed one).
 */
const SIDES = new Set(['me', 'mate', 'enemy']);
function feedGun(w) {
  const s = weaponName(w);
  const t = s ? s.toLowerCase() : '';
  if (!t) return null;
  const gun = GUNS.find((g) => g === t);
  if (gun) return gun.charAt(0).toUpperCase() + gun.slice(1);
  if (t === 'melee' || t === 'knife') return 'Melee';
  return KIT_NAMES.find((n) => n.toLowerCase() === t) || null;
}
function killFeedOf(feed) {
  if (!Array.isArray(feed)) return null;
  return feed.filter((k) => k && typeof k === 'object').slice(0, 24).map((k) => {
    const e = { ms: typeof k.ms === 'number' && Number.isFinite(k.ms) ? k.ms : null,
      by: SIDES.has(k.by) ? k.by : null, on: SIDES.has(k.on) ? k.on : null };
    const ka = agentName(k.ka);
    const va = agentName(k.va);
    const w = feedGun(k.w);
    if (ka) e.ka = ka;
    if (va) e.va = va;
    if (w) e.w = w;
    return e;
  });
}

/*
 * THE ROUND RECORD BEYOND THE FEED (8.8, server/services/riot-rounds.js):
 * where the player died and where the enemies they killed fell, as the
 * callout the game's data names there; the team's buy; whether the nearest
 * teammate was close at the death; the player's ability casts by key; and
 * Riot's AFK flags. Each is kept only as a value this file knows: a place
 * only as a callout, an area or a site of the match's own map in the game
 * data (an unknown map keeps none), the buy and the distance only as their
 * words, the casts only as whole counts by key. A record without them, and
 * a server from before, add no key at all, so the round is as it always was.
 */
let GEOMETRY = {};
try { GEOMETRY = require('./valorant-data.generated.json').mapGeometry || {}; } catch { GEOMETRY = {}; }
const BUY_KINDS = ['pistol', 'eco', 'force', 'half', 'full'];
const NEAR_WORDS = ['close', 'far'];
const CAST_SLOTS = ['C', 'Q', 'E', 'X'];
const placesCache = new Map();
function placesOf(map) {
  const key = String(map || '').toLowerCase().trim();
  if (!key) return null;
  if (placesCache.has(key)) return placesCache.get(key);
  const geo = GEOMETRY[key];
  let out = null;
  if (geo && Array.isArray(geo.callouts)) {
    out = new Map();
    const add = (s) => { if (typeof s === 'string' && s) out.set(s.toLowerCase(), s); };
    for (const c of geo.callouts) {
      add(c && c.n);
      add(c && c.a);
      // An area by its name ("Mid"), a site as "A site", never a bare letter.
      if (c && /^[abc]$/i.test(String(c.s || ''))) add(`${String(c.s).toUpperCase()} site`);
      else add(c && c.s);
    }
  }
  placesCache.set(key, out);
  return out;
}
function placeName(map, s) {
  const places = placesOf(map);
  const t = typeof s === 'string' ? s.trim().toLowerCase() : '';
  return (places && t && places.get(t)) || null;
}
function castsKept(c) {
  if (!c || typeof c !== 'object' || Array.isArray(c)) return null;
  const out = {};
  for (const k of CAST_SLOTS) if (Number.isInteger(c[k]) && c[k] >= 0 && c[k] <= 20) out[k] = c[k];
  return Object.keys(out).length ? out : null;
}
function recordExtras(rr, map) {
  const out = {};
  const spot = rr.died ? placeName(map, rr.deathAt) : null;
  if (spot) out.riotSpot = spot;
  const kills = (Array.isArray(rr.killsAt) ? rr.killsAt : []).slice(0, 5).map((s) => placeName(map, s)).filter(Boolean);
  if (kills.length) out.killSpots = kills;
  if (BUY_KINDS.includes(rr.buy)) out.buy = rr.buy;
  if (rr.died && NEAR_WORDS.includes(rr.mateNear)) out.mateNear = rr.mateNear;
  const casts = castsKept(rr.casts);
  if (casts) out.casts = casts;
  if (rr.afk === true) out.afk = true;
  if (rr.inSpawn === true) out.inSpawn = true;
  return out;
}

/*
 * A SCREEN LEDGER ONE DEATH BEHIND RIOT'S (8.7.10). The player's competitive
 * Split was reviewed by 8.0.1, whose ledger filed every death a round late
 * (the match locked as swiftplay at round 5 and was ended mid round 9), and
 * the late link laid Riot's record over those rounds by number. Both sources
 * then had a death in the same rounds, and the screen's spot of each was
 * Riot's place of the player's death before it, every time: round 3 at B Back
 * (Riot's round 1), 4 at A Tower (Riot's 3), then 5, 6 and 8 the same way,
 * with none at Riot's own place. Today's reader files that session's deaths
 * where Riot does (test:sessionreplay), so this is an old ledger's fault, and
 * it is read off the places alone, which a saved review still has when its
 * frames and its clock are long gone: at least three screen spots equal to
 * Riot's place of the death before and more than twice as many as equal
 * Riot's own. A player dying at one spot round after round matches both and
 * counts as agreeing, so a ledger in step never reads as behind.
 */
const placeKey = (s) => String(s || '').toLowerCase().replace(/[^a-z]/g, '');
function screenLagged(ledger, per, map) {
  const dead = per.filter((rr) => rr && rr.died && Number.isInteger(rr.n)).sort((a, b) => a.n - b.n);
  const place = new Map(dead.map((rr) => [rr.n, placeName(map, rr.deathAt)]));
  const order = dead.map((rr) => rr.n);
  let same = 0;
  let behind = 0;
  for (const r of ledger || []) {
    if (!r || !r.died || !r.deathSpot || !place.has(r.n)) continue;
    const s = placeKey(r.deathSpot);
    const here = place.get(r.n);
    const i = order.indexOf(r.n);
    const before = i > 0 ? place.get(order[i - 1]) : null;
    if (here && placeKey(here) === s) same++;
    else if (before && placeKey(before) === s) behind++;
  }
  return behind >= 3 && behind > same * 2;
}

/**
 * @param rounds  ledger.list() rows
 * @param riot    the /api/coach/match-rounds reply: { perRound: [...] }
 * @param opts    { records, window }: the match's AI log records and its wall
 *                clock bounds, which time each death (earlyBy); without them
 *                a death is Riot's by its round alone, as before
 * @returns { rounds, checks }
 */
function reconcile(rounds, riot, opts) {
  const per = Array.isArray(riot && riot.perRound) ? riot.perRound : [];
  if (!per.length) return { rounds, checks: null };

  const records = opts && Array.isArray(opts.records) ? opts.records : null;
  const window = (opts && opts.window) || {};
  const ledger = rounds || [];
  const byN = new Map(ledger.map((r) => [r.n, r]));
  const riotN = new Set(per.map((rr) => rr.n));
  /*
   * THE CHECK IS PER ROUND, AND ONLY OVER THE ROUNDS THE COACH WATCHED. It used
   * to compare two totals: every death the screen read against every death in
   * Riot's record. A session started in round 15 of the real Abyss match then
   * read "the screen read 9 deaths and Riot has 21", twelve deaths the screen
   * was never in a position to see, and a death filed one round late (the
   * banner lag) left both totals equal, so the line said Riot confirmed every
   * death while it had moved one.
   */
  const checks = {
    watched: 0,          // rounds the coach watched that Riot has
    screenDeaths: 0,     // deaths the screen read in them
    riotDeaths: 0,       // Riot's deaths in those same rounds
    agreed: 0,           // rounds both have a death in, at the same moment
    invented: [],        // rounds the screen called a death and Riot did not, or not then
    early: [],           // { n, s } of those, Riot's death s seconds after the screen's
    missed: [],          // rounds Riot has a death the screen did not see
    readsDropped: 0,     // coach reads Riot contradicts
    roundsAdded: 0,      // rounds Riot has that the coach never watched
  };
  // A death in a round Riot does not have at all, past the final score, is
  // one Riot does not confirm either.
  for (const r of ledger) {
    if (riotN.has(r.n) || !r.died) continue;
    checks.screenDeaths++;
    checks.invented.push(r.n);
  }

  // RIOT'S PLANT, WHEN ITS RECORD HAS PLANTS. Riot sets the flag on every
  // round, so a round it says was not planted was not, and the screen's plant
  // there was a banner read of the round before (valorant-rounds.js). The OR
  // that used to sit here kept every one of them. Only a record with no plant
  // in any round falls back to the screen, because that is also what a renamed
  // field in Riot's payload looks like.
  const riotPlants = per.some((rr) => rr.planted === true);
  // THE KILL FEED, ROUND BY ROUND. Riot's names are stripped before the record
  // leaves the server, but each kill still says which side it was by and on,
  // and teamworkOf() counts nobody in a round where one kill could not be
  // placed. That is what makes "no trade" a fact rather than a missing number,
  // and what a match with few deaths needs to be graded on its feed at all.
  const feedSeen = per.some((rr) => Array.isArray(rr.feed) && rr.feed.length > 0);
  const feedOf = (rr) => (feedSeen && Array.isArray(rr.feed)
    ? rr.feed.every((k) => !!(k && k.by && k.on)) : null);
  // A ledger a death behind Riot's (screenLagged): its rounds are Riot's
  // numbers with another round's screen in them, so nothing the screen read
  // in a round (its spot, its ultimate at the death, its reads, its trail,
  // the frames that filed the death) is laid over Riot's round. The rounds
  // and their deaths are Riot's, and the counts stay as the screen read them.
  const lagged = screenLagged(ledger, per, riot && riot.map);
  if (lagged) checks.lagged = true;

  const merged = per.map((rr) => {
    const r0 = byN.get(rr.n);
    const r = r0 && lagged ? { ...r0, deathSpot: null, ultAtDeath: null, locs: [], reads: [] } : r0;
    if (r0 && lagged) checks.readsDropped += (r0.reads || []).length;
    // The screen's death of the round, when it came well before Riot's: a
    // death invented as surely as one in a round Riot has none in, and
    // nothing of it (its spot, its ultimate, its reads) is laid over Riot's.
    const early = r && r.died && rr.died ? earlyBy(records, rr, window) : null;
    const filed = !!(r && r.died) && early === null;
    // A lagged ledger's death is counted where the screen filed it, and none
    // of what it read there is this death's.
    const screenDeath = filed && !lagged;
    const extras = recordExtras(rr, riot && riot.map);
    if (r) {
      checks.watched++;
      if (r.died) checks.screenDeaths++;
      if (rr.died) checks.riotDeaths++;
      if (filed && rr.died) checks.agreed++;
      if (r.died && !(filed && rr.died)) checks.invented.push(rr.n);
      if (early !== null) checks.early.push({ n: rr.n, s: early });
      if (rr.died && !r.died) checks.missed.push(rr.n);
    } else {
      checks.roundsAdded++;
    }
    const feedKnown = feedOf(rr);
    const planted = riotPlants ? rr.planted === true : !!(r && r.planted);

    const reads = [];
    for (const x of (r ? r.reads : [])) {
      if (x.death && (!rr.died || early !== null)) { checks.readsDropped++; continue; }
      const named = namedKiller(x.text);
      if (named && rr.killerAgent && !same(named, rr.killerAgent)) { checks.readsDropped++; continue; }
      reads.push(x);
    }

    const sec = rr.died && typeof rr.deathMs === 'number' ? Math.round(rr.deathMs / 1000) : null;
    return {
      n: rr.n,
      side: rr.side || (r && r.side) || null,
      result: rr.won === true ? 'won' : rr.won === false ? 'lost' : (r ? r.result : null),
      died: !!rr.died,
      // Whether the screen filed this death itself. The frame picker needs
      // it: only a death the screen registered has a frame that registered it
      // (death-frames.js). One registered well before Riot's is not this one.
      screenDied: screenDeath,
      // ONE PLACE FOR A DEATH (8.7.10): Riot's, where its record places it
      // (recordExtras' riotSpot), and the screen's only in a round Riot's
      // record has no place for. Two places in front of the model, the
      // screen's often a round off, put the old spot in 14 of 87 of 8.7.9's
      // place mentions (round 3 audit), and the spot pattern, the counted
      // same spot mistake and the card's spot all read this one field.
      deathSpot: rr.died ? (extras.riotSpot || (r && screenDeath ? r.deathSpot : null)) : null,
      deathSec: sec,
      // Kept in the ledger's own unit so every existing reader of deathClock
      // still works: seconds LEFT on a 100 second round.
      deathClock: sec !== null ? Math.max(0, 100 - sec) : null,
      early: !!rr.died && !rr.afterPlant && sec !== null && sec <= 30,
      ultAtDeath: rr.died && r && screenDeath ? r.ultAtDeath : null,
      ultSeen: r ? r.ultSeen : null,
      planted,
      // Only in a round that was planted, on Riot's site (plantSpotOf).
      plantSpot: planted ? plantSpotOf(r ? r.plantSpot : null, rr.plantSite) : null,
      locs: r ? r.locs.slice() : [],
      reads,
      frames: r ? r.frames : 0,
      watched: !!r,
      verified: true,
      kills: typeof rr.kills === 'number' ? rr.kills : null,
      killerAgent: rr.killerAgent || null,
      weapon: weaponName(rr.weapon),
      // What the killer dealt the player this round (8.7, riot-rounds.js
      // killerDamageOf): whole numbers only, or null, for the killer card.
      killerDamage: rr.died ? damageOf(rr.killerDamage) : null,
      firstDeath: !!rr.firstDeath,
      firstKill: !!rr.firstKill,
      // From Riot's kill feed, null when the feed could not say (a record
      // fetched before the server parsed teamwork has none of these). The
      // server sends trades as 0 when it could not place a kill, which is not
      // a count, so it is only kept where the round's feed was read whole.
      feedKnown,
      traded: typeof rr.traded === 'boolean' ? rr.traded : null,
      trades: typeof rr.trades === 'number' && feedKnown !== false ? rr.trades : null,
      aliveAtDeath: rr.aliveAtDeath && typeof rr.aliveAtDeath.mates === 'number' ? rr.aliveAtDeath : null,
      clutch: rr.clutch && typeof rr.clutch.vs === 'number' ? rr.clutch : null,
      afterPlant: !!rr.afterPlant,
      // THE ROUND IN ORDER (8.5.0), kept as the link has it so Ask Coach can
      // tell a round without asking again (chat-context.js needsFill): Riot's
      // kill feed of it, when and which side each end was on, both ends by
      // agent and the gun once the server sends them, never a name; and the
      // plant's moment and site. Null where the record has none. Never named
      // plantMs: that is death-frames.js's, which times a post plant death only
      // once withRiotTimes has handed it Riot's milliseconds for the look.
      feed: killFeedOf(rr.feed),
      riotPlantMs: typeof rr.plantMs === 'number' && Number.isFinite(rr.plantMs) ? rr.plantMs : null,
      plantSite: /^[ABC]$/.test(String(rr.plantSite || '')) ? rr.plantSite : null,
      // The round record beyond the feed (8.8, recordExtras), only the keys
      // the record had.
      ...extras,
    };
  });

  checks.invented.sort((a, b) => a - b);
  checks.early.sort((a, b) => a.n - b.n);
  return { rounds: merged, checks };
}

/** "a", "a and b", "a, b and c". */
const listText = (xs) => (xs.length < 2 ? String(xs[0]) : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);
/** "round 6", "rounds 6 and 17", "rounds 2, 6 and 17". */
function roundsText(ns) {
  if (ns.length === 1) return `round ${ns[0]}`;
  return `rounds ${listText(ns)}`;
}
const deathsText = (n) => (n === 0 ? 'no deaths' : n === 1 ? '1 death' : `${n} deaths`);

/**
 * One line a player can read about what the check changed.
 *
 * WORDED FROM THE ROUNDS, NEVER FROM THE TWO TOTALS. Equal totals said "Riot
 * confirms all 2 deaths the screen read" over a match where Riot rejected one
 * and the screen had missed another, which is the one sentence on the page
 * written to say what the check corrected. And it is scoped to the rounds the
 * coach watched, because a session started partway is the normal way the app
 * is used and Riot's other rounds are no fault of the screen's.
 *
 * NOTHING ABOUT THE NOTES IT DROPPED (8.3.1). It said "Riot contradicts one
 * of the coach's reads, so it is hidden" when the round cards showed the
 * coach's notes. The page shows none of them now (review.js), and calls the
 * summary and each round's why "the coach's read", so the sentence read as a
 * summary or a round line taken down. They are still dropped (readsDropped).
 *
 * A DEATH READ WELL BEFORE RIOT'S IS SAID IN NUMBERS ALONE (8.3.1): its round
 * and how many seconds before Riot's it came, beside the rounds Riot has none
 * in. "None in round 6" would be untrue, Riot having one there.
 */
function describe(checks) {
  if (!checks) return null;
  if (!checks.watched) {
    return "Checked against Riot's record of the match: the coach watched none of its rounds, so every round here is Riot's.";
  }
  const S = checks.screenDeaths;
  const R = checks.riotDeaths;
  const I = checks.invented;
  const E = Array.isArray(checks.early) ? checks.early : [];
  const M = checks.missed;
  const w = checks.watched;
  const scope = checks.roundsAdded > 0 ? `the ${w === 1 ? 'one round' : `${w} rounds`} the coach watched` : 'the match';
  let deaths;
  if (!I.length && !M.length) {
    deaths = S === 0 ? 'the screen read no deaths, and Riot has none either'
      : S === 1 ? 'Riot confirms the one death the screen read'
        : `Riot confirms all ${S} deaths the screen read`;
  } else if (R === 0) {
    deaths = `the screen read ${deathsText(S)}, in ${roundsText(I)}, and Riot has none`;
  } else if (S === 0) {
    deaths = `the screen read no deaths and Riot has ${R}, in ${roundsText(M)}`;
  } else {
    const where = [];
    const none = I.filter((n) => !E.some((e) => e.n === n));
    if (none.length) where.push(`none in ${roundsText(none)}`);
    if (E.length) {
      where.push(E.length === 1 ? `one in round ${E[0].n} the screen read ${E[0].s} s before Riot's`
        : `deaths in ${roundsText(E.map((e) => e.n))} the screen read ${listText(E.map((e) => e.s))} s before Riot's`);
    }
    if (M.length) {
      where.push(M.length === 1 ? `one in round ${M[0]} the screen missed` : `deaths in ${roundsText(M)} the screen missed`);
    }
    deaths = `the screen read ${deathsText(S)} and Riot has ${R}, with ${listText(where)}`;
  }
  // A ledger a death behind Riot's (screenLagged) kept none of what it read
  // in a round, and the line says why the cards hold Riot's places alone.
  const behind = checks.lagged ? " The screen filed its deaths a round late, so each round's place and notes are Riot's alone." : '';
  return `Checked against Riot's record of ${scope}: ${deaths}.${behind}`;
}

module.exports = { reconcile, describe, namedKiller, weaponName, agentName, killFeedOf, feedGun, NOT_A_WEAPON,
  recordExtras, placeName, BUY_KINDS, screenLagged };
