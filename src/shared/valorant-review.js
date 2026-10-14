'use strict';

/**
 * The Valorant post-match review, computed.
 *
 * Same principle as lol-review.js, for the same reason: a review is where a
 * confident wrong sentence costs most, because the match is over and the
 * player can only check it against a half memory. So every number
 * and every pattern here is ARITHMETIC over the round ledger. The model writes
 * exactly two kinds of sentence, the summary and a short "why" per round, and
 * both are labelled as the coach's read rather than presented as fact.
 *
 * A PATTERN MUST CLEAR A BAR TO BE SHOWN. "2 of 2 deaths at A Site" in a match
 * the coach watched for three rounds is a coincidence with a number on it. Each
 * pattern below states its floor, and a thin match simply shows fewer of them,
 * which is the honest outcome.
 *
 * Pure, no Electron, so the tests build real reviews from logged sessions.
 */

const insights = require('./insights');
const grader = require('./grade');
const { CLIP_RE, LOOK_AT } = require('./clips');
const { roleOf } = require('./agent-roles');
const { weaponName } = require('./valorant-verify');

let DATA = {};
try {
  DATA = require('./valorant-data.generated.json');
} catch {
  DATA = {};
}

const BASELINE_GAMES = 10;
const BASELINE_MIN = 3;

function pct(a, b) { return b ? Math.round((a / b) * 100) : 0; }

function plural(n, one, many) { return `${n} ${n === 1 ? one : (many || one + 's')}`; }

/**
 * "a Vandal", "an Outlaw". Riot's weapon names include Outlaw, Operator, Odin
 * and Ares, and the verified round card read "to Cypher with a Outlaw". Every
 * name the game uses that starts with a vowel letter also starts with a vowel
 * sound, so the letter decides.
 */
function withArticle(noun) {
  const s = String(noun || '').trim();
  return `${/^[aeiou]/i.test(s) ? 'an' : 'a'} ${s}`;
}

/** "rounds 1 to 14", "rounds 1 to 14 and 24", "round 5": runs of consecutive rounds. */
function spans(ns) {
  const sorted = ns.slice().sort((a, b) => a - b);
  const runs = [];
  for (const n of sorted) {
    const last = runs[runs.length - 1];
    if (last && n === last[1] + 1) last[1] = n;
    else runs.push([n, n]);
  }
  const text = runs.flatMap(([a, b]) => (a === b ? [`${a}`] : b === a + 1 ? [`${a}`, `${b}`] : [`${a} to ${b}`]));
  const joined = text.length === 1 ? text[0] : `${text.slice(0, -1).join(', ')} and ${text[text.length - 1]}`;
  return `${sorted.length === 1 ? 'round' : 'rounds'} ${joined}`;
}

function sideLabel(side) {
  return side === 'attacking' ? 'Attack' : side === 'defending' ? 'Defence' : null;
}

/*
 * A READ THAT NAMES A PLACE ON ANOTHER MAP IS NOT A READ OF THIS MATCH. The
 * engine's map lock held Haven for the first three minutes of the player's
 * Sunset swiftplay, the map went back to the model as context, and its notes
 * named Haven's places: round 2's last two reads were "holding A Long alone
 * with low HP" and "holding A Long with spike planted on A", on a map with no
 * A Long. The review then sends them to the model as what happened, and its
 * own rule is to name only places the ledger has. So a read naming a callout
 * the game prints on some map but not on this one is left out: a site letter
 * as printed ("A Long", never "a long angle") and the words after it, or a
 * callout only some maps have ("Hookah").
 */
const CALLOUTS = (() => {
  const byMap = new Map();
  const all = new Set();
  for (const [map, g] of Object.entries(DATA.mapGeometry || {})) {
    const names = new Set(((g && g.callouts) || []).map((c) => String((c && c.n) || '').toLowerCase()).filter(Boolean));
    byMap.set(map.toLowerCase(), names);
    for (const n of names) all.add(n);
  }
  return { byMap, all: [...all].map((n) => n.split(' ')) };
})();

/** The callout a read names that does not exist on `map`, or null. */
function foreignPlace(text, map) {
  const own = CALLOUTS.byMap.get(String(map || '').trim().toLowerCase());
  if (!own) return null;
  const toks = String(text || '').split(/[^A-Za-z]+/).filter(Boolean);
  const low = toks.map((t) => t.toLowerCase());
  for (const words of CALLOUTS.all) {
    const name = words.join(' ');
    if (own.has(name)) continue;
    for (let i = 0; i + words.length <= toks.length; i++) {
      // A site letter only as the game prints it, capital, so "a long" is English.
      if (words[0].length === 1 && toks[i] !== words[0].toUpperCase()) continue;
      if (words.every((w, k) => low[i + k] === w)) return toks.slice(i, i + words.length).join(' ');
    }
  }
  const m = String(map).trim().toLowerCase();
  for (const [word, maps] of Object.entries(DATA.mapCallouts || {})) {
    if (!maps.includes(m) && low.includes(word)) return word;
  }
  return null;
}

/*
 * A READ NAMING ANOTHER AGENT'S KIT IS NOT THE PLAYER'S PLAY (8.4.1). Round 2
 * of the player's Fracture swiftplay, on Jett, kept "holding A Main with
 * alarmbot deployed", Killjoy's, and it went to the review model as what the
 * player was seen doing: a spectated teammate's HUD, or a misread. So a read
 * naming an ability the player's agent does not have is left out, the engine's
 * rule for a teammate's kit called "own" (spectate-tells.js foreignAgentInTell)
 * with the look's own allowance (death-forensics.js foreignAbility): named
 * with its owner ("a Killjoy alarmbot at A Main") it is about that agent, not
 * the player. Matched as whole words, where foreignAgentInTell matches inside
 * them: that way Harbor's Cove is in every "from cover". Only with an agent
 * the player confirmed or Riot's record names, the engine's rule, and an
 * agent the game data does not know (one released after the last sync) has
 * no kit to hold a read to, so every read stays.
 */
const escapeRe = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const KITS = (() => {
  const out = [];
  for (const [agent, a] of Object.entries(DATA.agents || {})) {
    const owner = new RegExp(`\\b${escapeRe(agent)}\\b`, 'i');
    for (const ab of (a && a.abilities) || []) {
      // "nebula  / dissipate" is two names; KAY/O's "frag/ment" is one.
      for (const part of String(ab).split(/\s+\/\s+/)) {
        const name = part.trim().toLowerCase();
        if (name.length >= 4) out.push({ agent: agent.toLowerCase(), name, owner, re: new RegExp(`\\b${escapeRe(name)}\\b`, 'i') });
      }
    }
  }
  return out;
})();

/** The ability of another agent a read names, the player being on `agent`, or null. */
function foreignKit(text, agent) {
  const mine = String(agent || '').trim().toLowerCase();
  if (!mine || !KITS.some((k) => k.agent === mine)) return null;
  const t = String(text || '');
  for (const k of KITS) {
    if (k.agent === mine || !k.re.test(t) || k.owner.test(t)) continue;
    return k.name;
  }
  return null;
}

/**
 * A round's reads as the review shows and sends them: none from another map,
 * and none naming another agent's kit (`agent`, the player's, when known).
 */
function readsOf(r, map, agent) {
  return (Array.isArray(r && r.reads) ? r.reads : []).map((x) => (x && typeof x === 'object' ? x.text : x))
    .filter((t) => typeof t === 'string' && t && !foreignPlace(t, map) && !foreignKit(t, agent));
}

/** The agent a round's reads are held to: Riot's, else the one the player confirmed, else none. */
function kitAgentOf(riotAgent, ctx) {
  const c = ctx || {};
  return (typeof riotAgent === 'string' && riotAgent) || (c.agentConfirmed && typeof c.agent === 'string' ? c.agent : null);
}

/*
 * THE FRAMES A LOOK KEEPS ON ITS CARD (8.3.1): up to five, the stills it took
 * from the match's recording (shared/clips.js LOOK_AT) or the read's own
 * frames, in time order, with each one's seconds from the death (frameAt)
 * where the look knew them, and where they came from (framesFrom). The page
 * labels each frame by its seconds. Cut to two as before, a recorded look's
 * card kept its stills of 3 and 1.5 s before the death, both labelled "Just
 * before", and lost the fight and the death screen it was sent. A look from
 * before keeps its two names and no seconds, and is labelled by its names.
 */
const LOOK_FRAMES = Math.max(LOOK_AT.riot.length, LOOK_AT.screen.length);
function lookFrames(f) {
  const all = Array.isArray(f && f.frames) ? f.frames : [];
  const frames = all.slice(0, LOOK_FRAMES);
  const at = Array.isArray(f.frameAt) && f.frameAt.length === all.length
    && f.frameAt.every((x) => typeof x === 'number' && Number.isFinite(x)) ? f.frameAt.slice(0, frames.length) : null;
  return {
    frames,
    ...(at ? { frameAt: at } : {}),
    ...(f.framesFrom === 'recording' || f.framesFrom === 'reads' ? { framesFrom: f.framesFrom } : {}),
  };
}

/*
 * THE MODE A PLAYER KNOWS IT BY. The screen can only tell swiftplay's 4 round
 * halves from a standard match's 12, and "Standard" is not a name Valorant uses.
 * Riot's record names the queue, so once the match links, the review says
 * Competitive or Unrated, and a match the screen got wrong is put right.
 */
// Keyed by letters only, because Riot's record says "custom" and "newmap"
// where HenrikDev's match list says "Custom Game" and "New Map", and a custom
// game named for neither was counted in the breakdown as a standard match.
const QUEUE_LABELS = {
  competitive: 'Competitive', unrated: 'Unrated', swiftplay: 'Swiftplay', premier: 'Premier',
  spikerush: 'Spike Rush', deathmatch: 'Deathmatch', hurm: 'Team Deathmatch', teamdeathmatch: 'Team Deathmatch',
  ggteam: 'Escalation', escalation: 'Escalation', onefa: 'Replication', replication: 'Replication',
  newmap: 'New Map', snowball: 'Snowball Fight', snowballfight: 'Snowball Fight', custom: 'Custom', customgame: 'Custom',
};
function queueLabel(queue) {
  return QUEUE_LABELS[String(queue || '').toLowerCase().replace(/[^a-z]/g, '')] || null;
}
/** The halftime rule a queue plays by: 'swiftplay', 'standard', 'spikerush' or null. */
function queueHalves(queue) {
  const q = String(queue || '').toLowerCase().replace(/[^a-z]/g, '');
  if (/swift/.test(q)) return 'swiftplay';
  if (/spikerush/.test(q)) return 'spikerush';
  if (/competitive|unrated|premier|custom|newmap/.test(q)) return 'standard';
  return null;
}

/** Where halftime falls, so the timeline can draw it. Null when unknown. */
function halftimeAfter(mode, rounds) {
  if (mode === 'swiftplay') return 4;
  if (mode === 'spikerush') return 3;
  if (mode === 'standard') return 12;
  // Unknown mode: a match that reached round 10 cannot be swiftplay.
  return rounds.some((r) => r.n >= 10) ? 12 : null;
}

/**
 * The patterns worth a line, each with the floor it has to clear.
 * Returns [{ key, text }] in order of how much they are worth reading.
 */
function patterns(rounds) {
  const out = [];
  const watched = rounds.length;
  const deaths = rounds.filter((r) => r.died);
  if (watched < 3) return out;

  // Where the deaths happened. At least two at one spot AND at least 30% of the
  // deaths the coach could PLACE, so four deaths spread over four places never
  // produce a pattern, and a death with no readable spot neither counts for a
  // place nor dilutes one. On the real 24 round match this is 6 of 22 deaths at
  // A Site, 6 of the 17 it could place, which a player reads and recognises,
  // where 2 of 7 would be noise with a number on it.
  const spots = new Map();
  for (const r of deaths) {
    if (!r.deathSpot) continue;
    const k = r.deathSpot.toLowerCase();
    const e = spots.get(k) || { name: r.deathSpot, rounds: [] };
    e.rounds.push(r.n);
    spots.set(k, e);
  }
  const top = [...spots.values()].sort((a, b) => b.rounds.length - a.rounds.length)[0];
  const placed = deaths.filter((r) => r.deathSpot).length;
  if (top && top.rounds.length >= 2 && top.rounds.length * 10 >= placed * 3) {
    out.push({
      key: 'spot',
      text: `${top.rounds.length} of your ${deaths.length} deaths were at ${top.name}, `
        + `in rounds ${top.rounds.join(', ')}.`,
    });
  }

  // RIOT ONLY: the first death of the round. Only a round Riot verified can say
  // who died first, so this counts verified rounds and nothing else. Floor:
  // three, and a quarter of those rounds.
  const verified = rounds.filter((r) => r.verified);
  const firsts = verified.filter((r) => r.firstDeath);
  if (firsts.length >= 3 && firsts.length * 4 >= verified.length) {
    out.push({
      key: 'firstdeath',
      text: `You were the first player to die in ${firsts.length} of ${verified.length} rounds, `
        + `${listRounds(firsts)}.`,
    });
  }

  // Early deaths: in the first 30 seconds of the round and before any plant.
  // With Riot's record this is exact; from the screen alone it undercounts,
  // because the spectator camera makes a dead player look alive for a while.
  const early = deaths.filter((r) => r.early);
  if (early.length >= 2) {
    out.push({
      key: 'early',
      text: `${early.length} of your ${deaths.length} deaths came in the first 30 seconds of the round, `
        + `before any plant, in ${listRounds(early)}.`,
    });
  }

  // RIOT ONLY: who killed you most. Three kills and a quarter of the deaths,
  // so a spread of killers never reads as a rivalry.
  const byKiller = new Map();
  for (const r of deaths) if (r.killerAgent) byKiller.set(r.killerAgent, (byKiller.get(r.killerAgent) || 0) + 1);
  const topKiller = [...byKiller.entries()].sort((a, b) => b[1] - a[1])[0];
  if (topKiller && topKiller[1] >= 3 && topKiller[1] * 4 >= deaths.length) {
    out.push({ key: 'killer', text: `${topKiller[0]} killed you ${topKiller[1]} times, more than anyone else.` });
  }

  // The ultimate. Only a CONFIRMED ready read counts; the icon is small and a
  // null read is the common case, so an unknown never becomes "you held it".
  const heldUlt = deaths.filter((r) => r.ultAtDeath === 'ready');
  if (heldUlt.length >= 1) {
    out.push({
      key: 'ult',
      text: `You died with your ultimate ready in ${plural(heldUlt.length, 'round')}, `
        + `${heldUlt.map((r) => r.n).join(', ')}.`,
    });
  }

  // The longest run of lost rounds, three or more.
  let best = null;
  let run = [];
  for (const r of rounds) {
    if (r.result === 'lost') {
      run.push(r.n);
      if (!best || run.length > best.length) best = run.slice();
    } else if (r.result === 'won') run = [];
  }
  if (best && best.length >= 3) {
    out.push({
      key: 'streak',
      text: `You lost ${best.length} rounds in a row, rounds ${best[0]} to ${best[best.length - 1]}.`,
    });
  }

  // Attack against defence, when each side has three decided rounds.
  const decided = rounds.filter((r) => r.result && r.side);
  const atk = decided.filter((r) => r.side === 'attacking');
  const def = decided.filter((r) => r.side === 'defending');
  if (atk.length >= 3 && def.length >= 3) {
    const aw = atk.filter((r) => r.result === 'won').length;
    const dw = def.filter((r) => r.result === 'won').length;
    // THE STRONGER HALF IS NAMED, not left to be inferred from two fractions.
    // Given "won 6 of 12 on attack and 7 of 12 on defence", the model wrote
    // that the player "secured the attack half", which is the opposite.
    //
    // AND ONLY ON A GAP OF TWO ROUNDS, the rates' gap over a side of average
    // length. The player's Sunset swiftplay won one round on each side, 1 of 4
    // against 1 of 3, and the review called defence the stronger side: one
    // round either way is the same side, so it says the sides were close.
    const ar = aw / atk.length;
    const dr = dw / def.length;
    const gap = (Math.abs(ar - dr) * (atk.length + def.length)) / 2;
    const lead = ar === dr ? 'Your attack and defence were level'
      : gap < 2 ? 'Neither side was clearly stronger'
        : ar > dr ? 'Attack was your stronger side' : 'Defence was your stronger side';
    out.push({
      key: 'sides',
      text: `${lead}: won ${aw} of ${atk.length} on attack and ${dw} of ${def.length} on defence.`,
    });
  }

  // After the spike went down. On attack that is the post-plant, on defence it
  // is the retake, and those are different skills, so they are counted apart.
  // Only the rounds the player was alive in when it went down
  // (insights.aliveAtPlant): a death before the plant is no post plant played.
  const postAtk = decided.filter((r) => insights.aliveAtPlant(r) && r.side === 'attacking');
  if (postAtk.length >= 2) {
    const w = postAtk.filter((r) => r.result === 'won').length;
    out.push({ key: 'postplant', text: `On attack, won ${w} of ${postAtk.length} rounds once the spike was down.` });
  }
  const retakes = decided.filter((r) => insights.aliveAtPlant(r) && r.side === 'defending');
  if (retakes.length >= 2) {
    const w = retakes.filter((r) => r.result === 'won').length;
    out.push({ key: 'retake', text: `On defence, won ${w} of ${retakes.length} rounds after they planted.` });
  }

  // RIOT ONLY, and the one pattern that is good news: opening the round.
  const openers = verified.filter((r) => r.firstKill);
  if (openers.length >= 3) {
    out.push({ key: 'firstkill', text: `You got the first kill of the round ${openers.length} times, ${listRounds(openers)}.` });
  }

  return out;
}

/**
 * Whether the watch ended the match early: Riot's rounds go on past the score
 * the screen ended on, and stood at exactly that score after that many rounds.
 * The link's half of the same rule is match-link.js endedEarly(); this one
 * reads the rounds Riot's record has already been laid over, so a final score
 * misread by one digit (13-10 for 13-11) is never taken for an early end:
 * Riot stood at 12-11 after round 23, never at 13-10.
 */
function endedTooSoon(rounds, team, enemy) {
  if (typeof team !== 'number' || typeof enemy !== 'number') return false;
  const n = team + enemy;
  if (!(n > 0) || rounds.length <= n) return false;
  const first = rounds.slice().sort((a, b) => a.n - b.n).slice(0, n);
  if (first.some((r, i) => r.n !== i + 1 || !r.verified || (r.result !== 'won' && r.result !== 'lost'))) return false;
  return first.filter((r) => r.result === 'won').length === team;
}

/** "rounds 2, 5 and 9", or the first eight and a count, so a line stays readable. */
function listRounds(rows) {
  const ns = rows.map((r) => r.n);
  if (ns.length === 1) return `round ${ns[0]}`;
  const shown = ns.slice(0, 8);
  const rest = ns.length - shown.length;
  if (rest > 0) return `rounds ${shown.join(', ')} and ${rest} more`;
  return `rounds ${shown.slice(0, -1).join(', ')} and ${shown[shown.length - 1]}`;
}

/** The facts line under a round, computed, never written by the model. */
function roundFacts(r, opts) {
  const facts = [];
  // RIOT VERIFIED: exact, so exact numbers. The seconds, the killer and the
  // weapon are Riot's; only the place is the screen's.
  if (r.verified) {
    if (r.died) {
      let line = r.deathSpot ? `Died at ${r.deathSpot}` : 'Died';
      if (r.deathSec !== null && r.deathSec !== undefined) line += `${r.deathSpot ? ',' : ''} ${r.deathSec}s in`;
      if (r.killerAgent) line += `, to ${r.killerAgent}${r.weapon ? ` with ${withArticle(r.weapon)}` : ''}`;
      facts.push(line);
      if (r.firstDeath) facts.push('First death of the round');
      if (r.aliveAtDeath) facts.push(`${r.aliveAtDeath.mates} against ${r.aliveAtDeath.enemies} when you died`);
      if (r.traded === true) facts.push('Traded by a teammate');
      if (r.traded === false) facts.push('Not traded');
      if (r.ultAtDeath === 'ready') facts.push('Ultimate was ready');
    } else {
      // Riot knows who survived, so the line the screen could not honestly
      // write is back.
      facts.push('Survived');
    }
    if (typeof r.kills === 'number' && r.kills > 0) facts.push(plural(r.kills, 'kill'));
    if (r.firstKill) facts.push('First kill of the round');
    if (typeof r.trades === 'number' && r.trades > 0) facts.push(r.trades === 1 ? 'Traded a teammate' : `Traded teammates ${r.trades} times`);
    if (r.clutch && r.clutch.vs >= 1) {
      facts.push(`Last one standing against ${r.clutch.vs}${r.clutch.won === true ? ', and won it' : r.clutch.won === false ? ', lost' : ''}`);
    }
    if (r.planted) facts.push(r.plantSpot ? `Spike planted at ${r.plantSpot}` : 'Spike planted');
    // A review built from Riot's record alone was watched in no round, and
    // saying so on every card says nothing the header has not.
    if (r.watched === false && !(opts && opts.riotOnly)) facts.push('Not watched by the coach');
    return facts;
  }
  if (r.died) {
    let line = r.deathSpot ? `Died at ${r.deathSpot}` : 'Died';
    // A BUCKET, NOT A SECOND COUNT. Frames arrive every ten seconds or so, so
    // "20 seconds in" could have been 12, and a number that exact claims a
    // precision the capture never had.
    if (r.deathClock !== null && r.deathClock !== undefined && !r.planted) {
      const into = 100 - r.deathClock;
      const when = into <= 30 ? 'early in the round' : into <= 70 ? 'mid round' : 'late in the round';
      // "Died, mid round" read as a typo in the screenshot; with no spot the
      // timing is the whole clause.
      line += r.deathSpot ? `, ${when}` : ` ${when}`;
    }
    facts.push(line);
    if (r.ultAtDeath === 'ready') facts.push('Ultimate was ready');
  }
  // NO "SURVIVED" LINE. It was here, and a replay of a real session caught it
  // claiming survival in a round the player died in, because a quarter of
  // frames carry no readable score and a death can land in the wrong round.
  // "No death seen" is all the ledger can honestly say, and saying nothing
  // says that.
  if (r.planted) facts.push(r.plantSpot ? `Spike planted at ${r.plantSpot}` : 'Spike planted');
  return facts;
}

/**
 * The review object the window paints.
 *
 * @param input.rounds     ledger.list()
 * @param input.context    the engine's match context at the end
 * @param input.endedBy    'score' | 'lobby' | 'stop'
 * @param input.ai         { summary, rounds: { [n]: why }, focus, study: [{ text }] }
 * @param input.tracker    the verified tracker match, or null
 * @param input.role       the agent's role, for the history scope
 * @param input.history    past historyEntry() rows
 */
function build(input) {
  const rounds = Array.isArray(input.rounds) ? input.rounds : [];
  const ctx = input.context || {};
  const ai = input.ai || {};
  const tracker = input.tracker || null;
  const whys = ai.rounds || {};
  // A match the coach never watched, graded from Riot's record after the fact
  // (riot-review.js). It claims nothing only the screen could have seen.
  const riotOnly = input.source === 'riot';

  const team = typeof ctx.teamScore === 'number' ? ctx.teamScore : null;
  const enemy = typeof ctx.enemyScore === 'number' ? ctx.enemyScore : null;
  // The result is only claimed when it is KNOWN: the tracker linked this exact
  // match, or the watch ended it on a score no mode could continue from.
  let result = null;
  let score = null;
  if (tracker && tracker.result) {
    result = tracker.result;
    score = tracker.score || null;
  } else if (input.endedBy === 'score' && team !== null && enemy !== null) {
    result = team > enemy ? 'Victory' : team < enemy ? 'Defeat' : 'Draw';
    score = `${team}-${enemy}`;
  } else if (team !== null && enemy !== null && team + enemy > 0) {
    score = `${team}-${enemy}`;
  }

  const mapName = ctx.map || (tracker && tracker.map) || null;
  const kitAgent = kitAgentOf((tracker && tracker.agent) || (input.riotMe && input.riotMe.agent), ctx);
  const cards = rounds.map((r) => ({
    n: r.n,
    side: sideLabel(r.side),
    // The side as Riot or the ledger names it, and the facts below as fields:
    // the label and the sentences are for reading, these are for counting
    // (breakdown.js). A card saved before these existed is read back from its
    // fact sentences instead.
    sideKey: r.side === 'attacking' || r.side === 'defending' ? r.side : null,
    result: r.result,
    died: r.died,
    early: !!r.early,
    planted: r.planted,
    verified: !!r.verified,
    watched: !riotOnly && r.watched !== false,
    // Where the screen placed the death. Riot records no locations.
    spot: r.died && r.deathSpot ? r.deathSpot : null,
    ultReady: !!(r.died && r.ultAtDeath === 'ready'),
    riot: r.verified ? {
      sec: typeof r.deathSec === 'number' ? r.deathSec : null,
      killer: r.killerAgent || null,
      weapon: r.weapon || null,
      firstDeath: !!r.firstDeath,
      firstKill: !!r.firstKill,
      kills: typeof r.kills === 'number' ? r.kills : null,
      traded: typeof r.traded === 'boolean' ? r.traded : null,
      trades: typeof r.trades === 'number' ? r.trades : null,
      clutch: r.clutch && typeof r.clutch.vs === 'number'
        ? { vs: r.clutch.vs, won: typeof r.clutch.won === 'boolean' ? r.clutch.won : null } : null,
      alive: r.aliveAtDeath && typeof r.aliveAtDeath.mates === 'number'
        ? { mates: r.aliveAtDeath.mates, enemies: r.aliveAtDeath.enemies } : null,
      afterPlant: !!r.afterPlant,
    } : null,
    facts: roundFacts(r, { riotOnly }),
    reads: readsOf(r, mapName, kitAgent),
    why: typeof whys[r.n] === 'string' && whys[r.n] ? whys[r.n] : null,
    // The coach's look at the frame before the death, when it took one.
    forensics: r.forensics && r.forensics.cause ? {
      cause: r.forensics.cause, what: r.forensics.what || null, better: r.forensics.better || null,
      // The kept frame names, the library storing the images beside the
      // review, with their seconds from the death (lookFrames).
      ...lookFrames(r.forensics),
      // How the moment was found (8.2): 'screen' when Riot's record never
      // reached the review and the coach framed the death by when the screen
      // read it, so the page says the timing is the coach's own read. 'riot'
      // otherwise, which is every look saved before 8.2.
      source: r.forensics.source === 'screen' ? 'screen' : 'riot',
      // When the first frame it looked at was captured, for the eye at that moment.
      at: typeof r.forensics.at === 'number' ? r.forensics.at : null,
      // The clip of it kept beside the review (8.3, src/shared/clips.js): its
      // name and nothing else, never a path. Played from the library, or null
      // when the match was not recorded.
      clip: typeof r.forensics.clip === 'string' && CLIP_RE.test(r.forensics.clip) ? r.forensics.clip : null,
    } : null,
  }));

  // WHAT THE COACH WATCHED, which is not every round once Riot's record is laid
  // over a session started or stopped partway: reconcile() returns all of
  // Riot's rounds and marks the ones the coach never saw. Counting those, a
  // session watched from round 15 of the real Abyss match said "24 rounds
  // watched" over round cards reading "Not watched by the coach". A ledger row
  // carries no flag, and every one of them was watched.
  const seen = rounds.filter((r) => r.watched !== false);
  const unseen = rounds.filter((r) => r.watched === false).map((r) => r.n);
  const deaths = seen.filter((r) => r.died).length;
  const decided = seen.filter((r) => r.result);
  const isVerified = rounds.some((r) => r.verified);
  const refused = riotOnly
    ? ['The coach did not watch this match, so it has no death locations, no ultimate reads and no look at '
      + 'your deaths. Record your next match for the full review.']
    : isVerified
      ? ['Riot records when you died and to whom, not where. Death locations are read off the screen.']
      : ['Kills, damage and who won each fight are not printed on the HUD in a way the coach can read, '
        + 'so a round card says what was seen, not how the duel went.'];
  // STOPPED PARTWAY, SAID ONLY WHERE IT IS TRUE. From the screen alone a match
  // stopped halfway and one stopped on its end screen look the same, so the
  // line says only what is known: the coach never saw the end. Riot's record
  // knows, because its rounds after the last one watched are the match going
  // on, and it fills those in, so the old "this covers the rounds the coach
  // watched" was false the moment it linked.
  if (!riotOnly && !isVerified && input.endedBy === 'stop') {
    refused.push('Coaching was stopped before the coach saw the match end, so this covers the rounds it watched.');
  }
  // The next match began before this one was seen ending (a remake, an unrated
  // 13 to 12 with no menu read), so nothing on screen says how it ended.
  if (!riotOnly && !isVerified && input.endedBy === 'next-match') {
    refused.push('The next match started before the coach saw this one end, so this covers the rounds it watched.');
  }
  if (!riotOnly && isVerified && unseen.length) {
    const lastSeen = seen.reduce((a, r) => Math.max(a, r.n), 0);
    const stoppedEarly = input.endedBy === 'stop' && unseen.some((n) => n > lastSeen);
    // THE WATCH ENDED IT TOO SOON (8.2.1), said where Riot's record shows it.
    // The review a player saw first said "Defeat 3-5", and the one Riot's
    // record corrected says "Victory 13-7": without a word between them that
    // reads as the coach changing its mind about the same match.
    const overTooSoon = input.endedBy === 'score' && endedTooSoon(rounds, team, enemy);
    // NOTHING SEEN ON SCREEN, never "no coach's read" (8.3.1): the page calls
    // each round's why the coach's read, and the narrative Riot's record is
    // sent writes one for a round lost to a death, watched or not.
    refused.push(`${stoppedEarly ? 'Coaching was stopped before the match ended. ' : ''}`
      + `${overTooSoon ? `The coach thought the match was over at ${team} to ${enemy}, and it went on. ` : ''}`
      + `Riot's record fills in ${spans(unseen)}, which the coach did not watch, `
      + `so ${unseen.length === 1 ? 'that round has' : 'those rounds have'} ${UNSEEN_HAS}`);
  }
  if (!riotOnly && !tracker && !isVerified) {
    // 'later' (8.2.1): the watch ended the match on a score only swiftplay
    // ends on, and the link gave up before Riot's record of it was out. That
    // match may well have gone on, so it is not called another account's.
    refused.push(input.linkMissing === 'taken'
      ? "Riot's record of this match is already on another review in your library, so it is not repeated here."
      : input.linkMissing === 'later'
      ? "Riot's record of this match was not found yet. The coach ended it "
        + `${team !== null && enemy !== null ? `at ${team} to ${enemy}, ` : 'on '}a score only Swiftplay ends on, `
        + "so the match may have gone on after that. It is checked against Riot's record again at a later launch "
        + 'with your Riot ID connected, or now with Grade my recent matches in Matches.'
      // Not found within the live link's tries is not never: a launch with the
      // Riot ID connected checks unlinked recordings again (the late link).
      : input.linkMissing
      ? "Riot's record of this match was not found, so there is no scoreboard yet. It is checked again at a "
        + 'later launch with your Riot ID connected. A match played on another account than the Riot ID in Settings never links.'
      : input.riotIdSet
        ? 'The scoreboard comes from Riot once the match is published, and fills in here a few minutes after the match.'
        : 'The scoreboard comes from Riot once the match is published. '
          + 'Add your Riot ID in Settings, and it fills in here a few minutes after the match.');
  }

  // The numbers the grade is built on: the tracker's scoreboard, else Riot's
  // own line from the round record, else nothing.
  const riotMe = input.riotMe || null;
  const scoreline = tracker ? {
    kills: tracker.kills, deaths: tracker.deaths, assists: tracker.assists,
    acs: tracker.acs, adr: tracker.adr, headshotPct: tracker.headshotPct, kd: tracker.kd,
  } : riotMe && typeof riotMe.kills === 'number' ? {
    kills: riotMe.kills, deaths: riotMe.deaths, assists: riotMe.assists,
    acs: typeof riotMe.score === 'number' && rounds.length ? Math.round(riotMe.score / rounds.length) : null,
    adr: typeof riotMe.damage === 'number' && rounds.length ? Math.round(riotMe.damage / rounds.length) : null,
  } : null;
  const totalRounds = score ? score.split('-').reduce((a, b) => a + (Number(b) || 0), 0) : null;
  const vs = against(tracker, input.role || null, input.history || []);
  // The scoreboard and the player's own average reach the strengths, so a
  // match won on its scoreline says so (insights.js, 'scoreline').
  const counted = insights.valorant(rounds, { role: input.role || null, scoreline, against: vs });

  // Riot's agent wins over the screen's, the same as every other fact it has.
  const game = {
    agent: (tracker && tracker.agent) || ctx.agent || null,
    map: mapName,
    mode: queueLabel(input.queue)
      || (ctx.gameMode === 'swiftplay' ? 'Swiftplay' : ctx.gameMode === 'standard' ? 'Standard' : null),
    result,
    score,
  };

  return {
    kind: 'valorant',
    // Recorded and reviewed, or graded from Riot's record after the fact.
    source: riotOnly ? 'riot' : 'watched',
    at: Date.now(),
    // When Riot says the match started, once its record is linked (8.2.1): the
    // rank history dates a game by it, and Home places the match there by it
    // (home-model.js startOf). The review's `at` is when the watch ended the
    // match or Stop was pressed, which for a match ended early or stopped is
    // long before Riot's end. Null from the screen alone.
    matchStartedAt: tracker && Number.isFinite(tracker.startedAt) && tracker.startedAt > 0 ? tracker.startedAt : null,
    endedBy: input.endedBy || 'stop',
    game,
    scoreline,
    watched: riotOnly ? null : {
      rounds: seen.length,
      deaths,
      decided: decided.length,
      survival: seen.length ? pct(seen.length - deaths, seen.length) : null,
    },
    halftimeAfter: halftimeAfter(queueHalves(input.queue) || ctx.gameMode, rounds),
    // Whether Riot's record has been applied, and what it changed. The window
    // says so, because a review that quietly changed its numbers reads as one
    // that cannot make up its mind.
    verified: isVerified,
    verification: riotOnly
      ? "Graded from Riot's record of the match. The coach did not watch it, so everything here is what Riot records."
      : input.verification || null,
    patterns: patterns(rounds),
    // Repeated mistakes, what went well, what was missed. Counted, not written.
    // From Riot's record alone none of the three: Riot records what happened
    // and never why, so the same counts are facts (insights.asFacts).
    insights: riotOnly ? insights.asFacts(counted) : counted,
    grade: riotOnlyNote(grader.valorant({
      rounds, scoreline, role: input.role || null, history: input.history || [], totalRounds,
      riotIdSet: input.riotIdSet, linkMissing: input.linkMissing, riotOnly,
    }), riotOnly),
    summary: ai.summary || null,
    focus: ai.focus || null,
    // A study note is kept as its text alone. A server from before 8.2 sent
    // the name of whoever a note was imported from with it, and the app never
    // says where its knowledge comes from.
    study: Array.isArray(ai.study)
      ? ai.study.filter((n) => n && typeof n.text === 'string' && n.text).slice(0, 3).map((n) => ({ text: n.text }))
      : [],
    rounds: cards,
    against: vs,
    refused,
  };
}

/**
 * DECISIONS MEASURES LESS WITHOUT THE SCREEN, and a Riot only grade says so.
 * Two of its three counts need a recording: the ultimate ready at a death, and
 * the coach's look at the frame before one. Graded from Riot's record alone,
 * Decisions counts the deaths with the team ahead in a lost round, and the
 * clutches, so the same match can score higher there than it would recorded.
 */
function riotOnlyNote(grade, riotOnly) {
  // Only beside a Decisions score: beside "not measured" it explained a
  // number the card does not show.
  const decisions = grade && Array.isArray(grade.categories) ? grade.categories.find((c) => c.key === 'decisions') : null;
  if (riotOnly && grade && Array.isArray(grade.notes) && decisions && decisions.score !== null) {
    grade.notes.push("Decisions counts what Riot records: deaths with your team ahead in a round you lost, and "
      + "clutches. Your ultimate at each death and the coach's look at it need a recorded match.");
  }
  return grade;
}

/**
 * A SAVED REVIEW IN THE WORDS ONE BUILT TODAY WOULD CARRY, for the window
 * (present() in src/main/index.js serves every review through here). Nothing
 * is written back: the library on disk stays as each version saved it.
 *
 *   graded from Riot's record alone  facts in place of the three lists, and
 *       Decisions saying what it counted. Saved by 8.0.3 or 8.1, it kept fix
 *       lines and titles claiming what Riot never records.
 *   recorded                         its clutch line, "one against 1" until 8.2
 *
 * A review built today comes back with the same content.
 */
function served(review) {
  if (!review || review.kind !== 'valorant') return review;
  if (review.source === 'riot') {
    return weaponsInTodaysWords({ ...review, insights: insights.asFacts(review.insights), grade: grader.riotWords(review.grade) });
  }
  const out = review.insights ? { ...review, insights: insights.inTodaysWords(review.insights) } : review;
  return weaponsInTodaysWords(aboutNotesInTodaysWords(out));
}

/*
 * A WEAPON THAT NAMES NO WEAPON, LEFT OFF A REVIEW SAVED WITH ONE (8.4.1).
 * The player's Fracture swiftplay was saved with round 6 "Died at B Tree, 3s
 * in, to Chamber with a Weapon": the server had taken HenrikDev's type for a
 * name, which neither the server nor the client does now (valorant-verify.js
 * weaponName). Shown, the card and the strip say "to Chamber", as a review
 * built today does, and its Riot facts carry no weapon. On disk it stays as
 * it was saved. A card from before 8.0.3, with no Riot fields, is read off
 * its death line alone.
 */
function weaponsInTodaysWords(review) {
  if (!review || !Array.isArray(review.rounds)) return review;
  const cut = (line) => {
    if (typeof line !== 'string' || !line.startsWith('Died')) return line;
    const k = line.lastIndexOf(' with ');
    if (k < 0) return line;
    const tail = line.slice(k + ' with '.length);
    const named = tail.startsWith('an ') ? tail.slice(3) : tail.startsWith('a ') ? tail.slice(2) : null;
    return named && !weaponName(named) ? line.slice(0, k) : line;
  };
  let changed = false;
  const rounds = review.rounds.map((c) => {
    if (!c || typeof c !== 'object') return c;
    const facts = Array.isArray(c.facts) ? c.facts.map(cut) : c.facts;
    const typeWord = c.riot && typeof c.riot.weapon === 'string' && !weaponName(c.riot.weapon);
    if (!typeWord && (!Array.isArray(c.facts) || facts.every((f, i) => f === c.facts[i]))) return c;
    changed = true;
    return { ...c, facts, ...(typeWord ? { riot: { ...c.riot, weapon: null } } : {}) };
  });
  return changed ? { ...review, rounds } : review;
}

/*
 * WHAT A REVIEW SAVED BEFORE 8.3.1 SAYS ABOUT THE COACH'S NOTES, in today's
 * words. Its cards showed the notes, and two of its sentences are about them:
 * "Riot contradicts one of the coach's reads, so it is hidden" and "those
 * rounds have no location or coach's read". The page shows no note now and
 * calls the summary and each round's why the coach's read (review.js), so the
 * first read as a summary or a round line taken down, and the second sat over
 * rounds the narrative had written a line for. Shown, never on disk.
 */
const UNSEEN_HAS = 'no death location and nothing seen on screen.';
const UNSEEN_HAD = "no location or coach's read.";
const HIDDEN_READS = / Riot contradicts (?:one|\d+) of the coach's reads, so (?:it is|they are) hidden\./;

function aboutNotesInTodaysWords(review) {
  const v = typeof review.verification === 'string' ? review.verification.replace(HIDDEN_READS, '') : review.verification;
  const said = Array.isArray(review.refused) ? review.refused : null;
  const refused = said && said.map((t) => (typeof t === 'string' && t.endsWith(UNSEEN_HAD) ? t.slice(0, -UNSEEN_HAD.length) + UNSEEN_HAS : t));
  const changed = v !== review.verification || (said && refused.some((t, i) => t !== said[i]));
  return changed ? { ...review, verification: v, ...(said ? { refused } : {}) } : review;
}

/** A death's timing as the bucket roundFacts prints, or null. */
function timingOf(r) {
  if (r.verified) return r.died && r.deathSec !== null && r.deathSec !== undefined
    ? (r.early ? 'early' : r.deathSec <= 70 ? 'mid' : 'late') : null;
  if (!r.died || r.deathClock === null || r.deathClock === undefined || r.planted) return null;
  const into = 100 - r.deathClock;
  return into <= 30 ? 'early' : into <= 70 ? 'mid' : 'late';
}

/**
 * What the server's review route is sent. The engine and the review bench both
 * build it here, so the bench measures exactly what a player's match sends.
 */
function requestBody({ rounds, context, endedBy, tips, notes, riot }) {
  const ctx = context || {};
  const team = typeof ctx.teamScore === 'number' ? ctx.teamScore : null;
  const enemy = typeof ctx.enemyScore === 'number' ? ctx.enemyScore : null;
  const map = ctx.map || (riot && riot.map) || null;
  const kitAgent = kitAgentOf(riot && riot.agent, ctx);
  /*
   * THE COUNTED LISTS GO WITH THE ROUNDS, so the summary names the mistake the
   * review counted. Asked for "the most repeated mistake" with only the round
   * lines in front of it, the model found one in the reads: on the player's
   * Sunset swiftplay it wrote "Standing idle in spawn during buy phase was the
   * repeated mistake occurring in rounds 1, 2, 3 and 4", where the review had
   * counted deaths nobody traded, in other rounds. The same
   * counts the review shows, from the same rounds, the agent's role deciding
   * the floors as it does there; the fix lines stay here, the review shows them.
   */
  const s = riot && riot.scoreline;
  const counted = insights.valorant(rounds, {
    role: roleOf((riot && riot.agent) || ctx.agent),
    scoreline: s && typeof s.kills === 'number' && typeof s.deaths === 'number' ? s : null,
  });
  const listed = (list) => list.slice(0, 4).map((e) => ({
    key: e.key, title: e.title, detail: e.detail, rounds: (e.rounds || []).slice(0, 12), count: e.count,
  }));
  return {
    tips: (tips || []).slice(-30),
    notes: (notes || []).slice(-20),
    mistakes: listed(counted.mistakes),
    strengths: listed(counted.strengths),
    rounds: rounds.map((r) => ({
      n: r.n, side: r.side, result: r.result, died: r.died, deathSpot: r.deathSpot,
      timing: timingOf(r), planted: r.planted, plantSpot: r.plantSpot,
      ultReady: r.died && r.ultAtDeath === 'ready',
      reads: readsOf(r, map, kitAgent),
      // Riot's exact facts, when the match has been checked against them.
      ...(r.verified ? {
        verified: true, sec: r.deathSec, killer: r.killerAgent, weapon: r.weapon,
        firstDeath: r.firstDeath, firstKill: r.firstKill, kills: r.kills,
        traded: typeof r.traded === 'boolean' ? r.traded : null,
        alive: r.aliveAtDeath || null,
      } : {}),
      // The coach's look at the death, so the summary and the round lines
      // agree with the cause the review counts.
      ...(r.forensics && r.forensics.cause ? { cause: r.forensics.cause, seen: r.forensics.what || null } : {}),
    })),
    patterns: patterns(rounds),
    context: {
      agent: (riot && riot.agent) || ctx.agent || null,
      map: ctx.map || (riot && riot.map) || null,
      advancedTips: ctx.advancedTips === true,
      // The review is written in the player's language; the gates below it
      // still read the labels, which stay English.
      language: typeof ctx.language === 'string' ? ctx.language : 'en',
    },
    // Riot's final score and result outrank the last score the screen read.
    final: riot && riot.score ? {
      team: Number(riot.score.split('-')[0]), enemy: Number(riot.score.split('-')[1]),
      result: riot.result || null, verified: true,
      // The player's own scoreboard line. Without it the model saw 21 deaths
      // and nothing else, and reviewed a 31 kill match MVP as a struggling
      // player. Deaths mean something different next to 31 kills.
      scoreline: riot.scoreline || null,
    } : {
      team, enemy,
      result: endedBy === 'score' && team !== null && enemy !== null
        ? (team > enemy ? 'Victory' : team < enemy ? 'Defeat' : 'Draw') : null,
    },
  };
}

/**
 * One row of Valorant history, from the TRACKER'S numbers only. The ledger has
 * no kills or damage, and a baseline built from guesses would compare the
 * player against a number nobody measured.
 */
function historyEntry(tracker, role) {
  if (!tracker || typeof tracker.acs !== 'number') return null;
  return {
    at: Date.now(),
    agent: tracker.agent || null,
    role: role || null,
    map: tracker.map || null,
    result: tracker.result || null,
    acs: tracker.acs, adr: tracker.adr, kd: tracker.kd, headshotPct: tracker.headshotPct,
  };
}

/**
 * What a review needs to be checked against Riot's record later: the screen's
 * rounds as reconcile() reads them, and the window and context the match link
 * checks. Kept only while a review is unverified (index.js), so a Riot ID
 * added after the link gave up can still grade the match (backfill.js).
 * Reads are trimmed to the fields reconcile() uses; a location trail to eight.
 */
function ledgerOf(snap) {
  if (!snap || !Array.isArray(snap.rounds)) return null;
  const c = snap.context || {};
  return {
    startedAt: typeof snap.startedAt === 'number' ? snap.startedAt : null,
    endedAt: typeof snap.endedAt === 'number' ? snap.endedAt : null,
    endedBy: snap.endedBy || null,
    context: {
      agent: c.agent || null,
      agentConfirmed: !!c.agentConfirmed,
      map: c.map || null,
      teamScore: typeof c.teamScore === 'number' ? c.teamScore : null,
      enemyScore: typeof c.enemyScore === 'number' ? c.enemyScore : null,
      gameMode: c.gameMode || null,
    },
    rounds: snap.rounds.map((r) => ({
      n: r.n,
      side: r.side || null,
      result: r.result || null,
      died: !!r.died,
      deathSpot: r.deathSpot || null,
      deathClock: typeof r.deathClock === 'number' ? r.deathClock : null,
      early: !!r.early,
      ultAtDeath: r.ultAtDeath || null,
      ultSeen: r.ultSeen === undefined ? null : r.ultSeen,
      planted: !!r.planted,
      plantSpot: r.plantSpot || null,
      locs: Array.isArray(r.locs) ? r.locs.slice(0, 8) : [],
      frames: typeof r.frames === 'number' ? r.frames : 0,
      reads: (Array.isArray(r.reads) ? r.reads : []).slice(0, 12)
        .map((x) => ({ text: String((x && x.text) || ''), death: !!(x && x.death) })),
    })),
  };
}

/**
 * Against the player's own recent matches, IN THE SAME ROLE.
 *
 * A controller's ACS and a duelist's ACS are different quantities. Comparing
 * across roles manufactures a trend out of the player switching role.
 */
function against(tracker, role, history) {
  if (!tracker || typeof tracker.acs !== 'number') return [];
  const pool = (history || []).filter((h) => h && (!role || h.role === role)).slice(-BASELINE_GAMES);
  if (pool.length < BASELINE_MIN) return [];
  const metrics = [
    ['ACS', 'acs'], ['Damage per round', 'adr'], ['K/D', 'kd'], ['Headshot %', 'headshotPct'],
  ];
  const out = [];
  for (const [label, key] of metrics) {
    const vals = pool.map((h) => h[key]).filter((v) => typeof v === 'number');
    const value = tracker[key];
    if (vals.length < BASELINE_MIN || typeof value !== 'number') continue;
    const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
    const baseline = key === 'kd' ? Math.round(mean * 100) / 100 : Math.round(mean);
    const delta = key === 'kd' ? Math.round((value - baseline) * 100) / 100 : Math.round(value - baseline);
    out.push({ label, value, baseline, delta, better: delta === 0 ? null : delta > 0, games: vals.length });
  }
  return out;
}

module.exports = { build, served, patterns, roundFacts, historyEntry, ledgerOf, against, halftimeAfter, requestBody, timingOf,
  queueLabel, queueHalves, withArticle, spans, endedTooSoon, foreignPlace, foreignKit, readsOf, BASELINE_GAMES, BASELINE_MIN };
