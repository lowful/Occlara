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
const { FIGHTS, CHANGES } = require('./death-causes');
const icons = require('./valorant-icons');

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
 * Riot's record names or the engine locked (since 8.4.4 off the player's own
 * HUD, two answers on buy phase frames, before it the player's tick), the
 * engine's rule, and an agent the game data does not know (one released after
 * the last sync) has no kit to hold a read to, so every read stays.
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

/**
 * The agent a round's reads are held to: Riot's, else the one the engine
 * confirmed (locked off the player's own HUD since 8.4.4, the player's tick
 * before it), else none.
 */
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
 * WHAT A LOOK ASKED WITH VARIANT B ALSO SAYS (8.5.0): its judgement of the
 * fight, the one thing its better play changes most, each from its closed list
 * (death-causes.js FIGHTS, CHANGES), and the prompt it was asked with. Kept
 * only where the look carries them; a look saved without a variant was asked
 * with a (death-causes.js variantOf).
 */
function lookJudgement(f) {
  const out = {};
  if (FIGHTS.includes(f && f.fight)) out.fight = f.fight;
  if (CHANGES.includes(f && f.change)) out.change = f.change;
  if (f && (f.variant === 'a' || f.variant === 'b')) out.variant = f.variant;
  return out;
}

/*
 * BOTH TEAM COMPS, AGENTS ONLY (8.5.0): Riot's record of the match names
 * every player's agent, and the server sends them sorted by agent, so nothing
 * in them says which player was which (riot-rounds.js compsOf). Kept on the
 * review from the link (here) or Ask Coach's one time fill, each an agent the
 * game data knows with its role from that data, whatever arrived, and sorted
 * again: a name that reached here would be shown on the review page, and an
 * order could say who was who.
 */
function compsOf(c) {
  if (!c || typeof c !== 'object') return null;
  const agents = Object.keys(DATA.agents || {});
  const team = (xs) => (Array.isArray(xs) ? xs : []).slice(0, 5).map((x) => {
    const name = x && typeof x.agent === 'string' ? agents.find((a) => a.toLowerCase() === x.agent.trim().toLowerCase()) : null;
    return name ? { agent: name, role: roleOf(name) || null } : null;
  }).filter(Boolean).sort((a, b) => a.agent.localeCompare(b.agent));
  const us = team(c.us);
  const them = team(c.them);
  return us.length || them.length ? { us, them } : null;
}

/*
 * THE COMPS LINE (8.5.0, the player's choice: one line under the round
 * strip), computed when a review is shown, never kept on disk: "Your team:
 * Breach, Jett (you), Killjoy, Omen, Sova. Theirs: Cypher, Fade, Reyna, Sage,
 * Viper." Both teams must be known, each by agents the game data knows, and
 * "(you)" marks the player's own agent where the review names it. Null with
 * no comps, as every review saved before the link or the fill kept them.
 */
function compsLine(review) {
  const c = compsOf(review && review.comps);
  if (!c || !c.us.length || !c.them.length) return null;
  const mine = review.game && typeof review.game.agent === 'string' ? review.game.agent.toLowerCase() : null;
  let marked = false;
  const us = c.us.map((x) => {
    if (!marked && mine && x.agent.toLowerCase() === mine) { marked = true; return `${x.agent} (you)`; }
    return x.agent;
  });
  return `Your team: ${us.join(', ')}. Theirs: ${c.them.map((x) => x.agent).join(', ')}.`;
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
  skirmish: 'Skirmish', retake: 'Retake', knockout: 'Knockout', gauntlet: 'Gauntlet', allrandom: 'All Random', ar1s: 'AR1S',
};
/*
 * A QUEUE RIOT NAMES IS NEVER "STANDARD" (stale F1). A linked Skirmish 2v2,
 * Retake or Knockout match fell back to the screen's 'standard' and was
 * reviewed as "Standard" with halftime at 12, and counted in the breakdown
 * with real matches. A queue this table does not know is named in its own
 * words, which the breakdown's list of graded queues leaves out.
 */
function queueLabel(queue) {
  const raw = String(queue || '').trim();
  if (!raw) return null;
  const letters = raw.toLowerCase().replace(/[^a-z]/g, '');
  const known = QUEUE_LABELS[letters] || QUEUE_LABELS[raw.toLowerCase().replace(/[^a-z0-9]/g, '')];
  if (known) return known;
  const words = raw.replace(/[_-]+/g, ' ').replace(/[^A-Za-z0-9: ]/g, '').replace(/\s+/g, ' ').trim().slice(0, 32);
  return words ? words.split(' ').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ') : null;
}
/** The halftime rule a queue plays by: 'swiftplay', 'standard', 'spikerush' or null. */
function queueHalves(queue) {
  const q = String(queue || '').toLowerCase().replace(/[^a-z]/g, '');
  if (/swift/.test(q)) return 'swiftplay';
  if (/spikerush/.test(q)) return 'spikerush';
  // Replication is first to five, halves of four.
  if (/^(onefa|replication)$/.test(q)) return 'swiftplay';
  // A New Map queue plays whichever format its patch says (Summit Only is
  // Swiftplay's), so its halftime is left to the screen and the round count.
  if (/competitive|unrated|premier|custom/.test(q)) return 'standard';
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

/*
 * ONE PLACE FOR A DEATH (8.7.10): Riot's callout where its record places the
 * death (riotSpot), the screen's spot only for a round it has none for. A
 * link of 8.7.10 already writes deathSpot so (valorant-verify.js reconcile),
 * and this is the same rule for a row that carries both, as a saved card laid
 * back over Riot's record does.
 */
function deathPlace(r) {
  if (!r || !r.died) return null;
  if (r.verified && typeof r.riotSpot === 'string' && r.riotSpot) return r.riotSpot;
  return typeof r.deathSpot === 'string' && r.deathSpot ? r.deathSpot : null;
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
    const place = deathPlace(r);
    if (!place) continue;
    const k = place.toLowerCase();
    const e = spots.get(k) || { name: place, rounds: [] };
    e.rounds.push(r.n);
    spots.set(k, e);
  }
  const top = [...spots.values()].sort((a, b) => b.rounds.length - a.rounds.length)[0];
  const placed = deaths.filter((r) => deathPlace(r)).length;
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

  // RIOT ONLY (8.8): the team's buy discipline, buyDiscipline's line.
  const buys = buyDiscipline(rounds);
  if (buys) out.push({ key: 'buys', text: buys.text });

  return out;
}

/*
 * THE TEAM'S BUY DISCIPLINE (8.8), from the buy Riot's record gives each
 * round (riot-rounds.js buyOf): the full buy rounds lost, the eco rounds won
 * and the forced rounds won, of the decided rounds that had a buy, pistol
 * rounds left out. Only with BUYS_MIN such rounds, and each part only where
 * it has rounds (full buys two). One finished line, its numbers counted here
 * and nowhere else, and worded without "buy" itself: the review's gate drops
 * any summary sentence with the word (match-review.js BUY_BLAME), and Ask
 * Coach's every review sentence that has it, so the line says "full loadout"
 * where the card's chip says "Full buy".
 */
const BUYS_MIN = 6;
function buyDiscipline(rounds) {
  const v = (rounds || []).filter((r) => r && r.verified && (r.result === 'won' || r.result === 'lost')
    && ['eco', 'force', 'half', 'full'].includes(r.buy));
  if (v.length < BUYS_MIN) return null;
  const of = (kind) => v.filter((r) => r.buy === kind);
  const won = (rs) => rs.filter((r) => r.result === 'won').length;
  const full = of('full');
  const eco = of('eco');
  const force = of('force');
  const half = of('half');
  const parts = [];
  if (full.length >= 2) parts.push(`lost ${full.length - won(full)} of ${full.length} rounds on a full loadout`);
  if (eco.length) parts.push(`won ${won(eco)} of ${eco.length} eco ${eco.length === 1 ? 'round' : 'rounds'}`);
  if (force.length) parts.push(`won ${won(force)} of ${force.length} forced ${force.length === 1 ? 'round' : 'rounds'}`);
  if (!parts.length) return null;
  const said = parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
  return {
    rounds: v.length,
    full: full.length, fullLost: full.length - won(full),
    eco: eco.length, ecoWon: won(eco),
    force: force.length, forceWon: won(force),
    half: half.length, halfWon: won(half),
    text: `Your team ${said}.`,
  };
}

/*
 * THE MATCH'S SWING (round 3, Nov 2026): the one or two numbers from Riot's
 * record that moved the most rounds, as finished lines the review's model is
 * handed as true and may quote exactly. Six judges read 24 real reviews and
 * all six found the real story missing: a Sunset match lost on 0 of 9
 * defence rounds after the plant, a Corrode match on 10 rounds lost in a row,
 * a Pearl team with no controller, an Omen who killed the player six times.
 * The summary and the focus had only the counted mistakes to draw on, and
 * named the deaths nobody traded in 20 of 24 reviews.
 *
 * Verified rounds only, every line arithmetic, each with the floor it has to
 * clear and a weight in rounds (how many rounds it plausibly cost), the
 * largest first, two at most. Every line is plain words with no dash and no
 * semicolon, and names agents and guns only, never a player.
 */
const SWING_MAX = 2;
const SWING_FLOOR = 1.5;
const COMMON_RIFLES = new Set(['vandal', 'phantom']);
function swingOf(rounds, riot) {
  const out = [];
  const v = (rounds || []).filter((r) => r && r.verified && r.side && (r.result === 'won' || r.result === 'lost'));
  if (v.length < 6) return [];
  const won = (rs) => rs.filter((r) => r.result === 'won').length;

  // The sides, on a gap of three rounds or more (the sides pattern names a
  // stronger side at two).
  const atk = v.filter((r) => r.side === 'attacking');
  const def = v.filter((r) => r.side === 'defending');
  if (atk.length >= 4 && def.length >= 4) {
    const gap = (Math.abs(won(atk) / atk.length - won(def) / def.length) * (atk.length + def.length)) / 2;
    if (gap >= 3) out.push({ weight: gap, text: `You won ${won(atk)} of ${atk.length} rounds on attack and ${won(def)} of ${def.length} on defence.` });
  }
  // After the plant, the TEAM's record, whoever was alive: a post plant the
  // team keeps losing is a decision about where to play and when to save.
  const postAtk = atk.filter((r) => r.planted);
  if (postAtk.length >= 3 && won(postAtk) * 2 <= postAtk.length) {
    out.push({ weight: postAtk.length * 0.65 - won(postAtk),
      text: `Once the spike was down on attack, your team won ${won(postAtk)} of ${postAtk.length} rounds.` });
  }
  const postDef = def.filter((r) => r.planted);
  if (postDef.length >= 3 && won(postDef) * 5 <= postDef.length) {
    out.push({ weight: postDef.length * 0.35 - won(postDef),
      text: `Once they planted on defence, your team won ${won(postDef)} of ${postDef.length} rounds.` });
  }
  // The longest run of lost rounds, five or more.
  let best = [];
  let run = [];
  for (const r of v.slice().sort((a, b) => a.n - b.n)) {
    if (r.result === 'lost') { run.push(r.n); if (run.length > best.length) best = run.slice(); } else run = [];
  }
  if (best.length >= 5) out.push({ weight: best.length - 3, text: `You lost ${best.length} rounds in a row, rounds ${best[0]} to ${best[best.length - 1]}.` });
  // The player's own team with no controller, from Riot's comp of five.
  const comp = compsOf(riot && riot.comps);
  if (comp && comp.us.length === 5 && !comp.us.some((x) => x.role === 'Controller')) {
    out.push({ weight: 2.5, text: `Your team had no controller: ${comp.us.map((x) => x.agent).join(', ')}.` });
  }
  // The one killer, or the one gun that is not a common rifle, behind the deaths.
  const deaths = v.filter((r) => r.died);
  const byKiller = new Map();
  const byGun = new Map();
  for (const r of deaths) {
    if (r.killerAgent) byKiller.set(r.killerAgent, (byKiller.get(r.killerAgent) || 0) + 1);
    const gun = weaponName(r.weapon);
    if (gun && !COMMON_RIFLES.has(gun.toLowerCase())) byGun.set(gun, (byGun.get(gun) || 0) + 1);
  }
  const topKiller = [...byKiller.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0];
  if (topKiller && topKiller[1] >= 4 && topKiller[1] * 10 >= deaths.length * 3) {
    out.push({ weight: topKiller[1] - 2, text: `${topKiller[0]} killed you ${topKiller[1]} times, more than anyone else.` });
  }
  const topGun = [...byGun.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0];
  if (topGun && topGun[1] >= 3 && topGun[1] * 10 >= deaths.length * 3) {
    out.push({ weight: topGun[1] - 1, text: `${withArticle(topGun[0])[0].toUpperCase()}${withArticle(topGun[0]).slice(1)} killed you ${topGun[1]} times.` });
  }
  return out.filter((s) => s.weight >= SWING_FLOOR).sort((a, b) => b.weight - a.weight).slice(0, SWING_MAX).map((s) => s.text);
}

/*
 * THE NUMBERS STANDING THROUGH A ROUND (round 3), from Riot's kill feed: 5
 * against 5, then after each kill, the player's side first. The review's
 * state gate (server ability-facts.js checkState) holds an "N against M" in a
 * round line to them: the audit's Pearl round 1 said "4 against 2" of a round
 * that stood 2 against 2. Null where the record kept no feed.
 */
function standingsOf(r) {
  if (!r || !Array.isArray(r.feed) || !r.feed.length) return null;
  const out = [[5, 5]];
  let m = 5;
  let e = 5;
  for (const k of r.feed) {
    if (k && (k.on === 'me' || k.on === 'mate')) m -= 1;
    else if (k && k.on === 'enemy') e -= 1;
    else continue;
    if (m >= 0 && e >= 0) out.push([m, e]);
  }
  return out.slice(0, 12);
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

/*
 * THE ROUND RECORD BEYOND THE FEED ON A CARD (8.8). The team's buy as the
 * card's words (BUY_WORDS), the casts by the player's kit (the game data's
 * kit name for each key, the key alone for an agent it does not know), and
 * the rest as reconcile kept them. Nothing here is a count of anything.
 */
const BUY_WORDS = { pistol: 'Pistol round', eco: 'Eco round', force: 'Force buy', half: 'Half buy', full: 'Full buy' };
const CAST_ORDER = ['C', 'Q', 'E', 'X'];
function castsNamed(casts, agent) {
  if (!casts || typeof casts !== 'object') return null;
  const a = typeof agent === 'string' && DATA.agents ? Object.entries(DATA.agents).find(([k]) => k.toLowerCase() === agent.toLowerCase()) : null;
  const kit = a && Array.isArray(a[1].kit) ? a[1].kit : [];
  const out = CAST_ORDER.filter((k) => Number.isInteger(casts[k])).map((key) => {
    const slot = kit.find((x) => x && x.key === key);
    return { key, name: slot && typeof slot.name === 'string' ? slot.name : null, n: casts[key] };
  });
  return out.length ? out : null;
}
function recordOnCard(r, agent) {
  const out = {};
  if (typeof r.riotSpot === 'string' && r.riotSpot) out.place = r.riotSpot;
  if (Array.isArray(r.killSpots) && r.killSpots.length) out.killPlaces = r.killSpots.slice(0, 5);
  if (BUY_WORDS[r.buy]) out.buy = r.buy;
  if (r.mateNear === 'close' || r.mateNear === 'far') out.mate = r.mateNear;
  const casts = castsNamed(r.casts, agent);
  if (casts) out.casts = casts;
  if (r.afk === true) out.afk = true;
  if (r.inSpawn === true) out.inSpawn = true;
  return out;
}

/** The facts line under a round, computed, never written by the model. */
function roundFacts(r, opts) {
  const facts = [];
  // RIOT VERIFIED: exact, so exact numbers. The seconds, the killer and the
  // weapon are Riot's, and since 8.8 the place where its record has one
  // (riotSpot), else the screen's.
  if (r.verified) {
    if (r.died) {
      const place = r.riotSpot || r.deathSpot;
      let line = place ? `Died at ${place}` : 'Died';
      if (r.deathSec !== null && r.deathSec !== undefined) line += `${place ? ',' : ''} ${r.deathSec}s in`;
      if (r.killerAgent) line += `, to ${r.killerAgent}${r.weapon ? ` with ${withArticle(r.weapon)}` : ''}`;
      facts.push(line);
      if (r.firstDeath) facts.push('First death of the round');
      if (r.aliveAtDeath) facts.push(`${r.aliveAtDeath.mates} against ${r.aliveAtDeath.enemies} when you died`);
      if (r.traded === true) facts.push('Traded by a teammate');
      // How near the closest teammate stood, said with the trade it decides,
      // one chip (8.8): never for the last one alive, who had nobody near.
      if (r.traded === false) {
        const alone = !!(r.aliveAtDeath && r.aliveAtDeath.mates <= 1);
        facts.push(alone || !r.mateNear ? 'Not traded'
          : r.mateNear === 'close' ? 'Not traded, a teammate was close' : 'Not traded, nobody close');
      }
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
    // The team's buy (8.8), and a round Riot says the player sat out.
    if (BUY_WORDS[r.buy]) facts.push(BUY_WORDS[r.buy]);
    if (r.afk === true) facts.push('Riot marked you AFK, not counted');
    else if (r.inSpawn === true) facts.push('Stayed in spawn all round, not counted');
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
    // Where the death was: Riot's place where its record has one (8.7.10,
    // deathPlace), else where the screen placed it.
    spot: deathPlace(r),
    ultReady: !!(r.died && r.ultAtDeath === 'ready'),
    riot: r.verified ? {
      sec: typeof r.deathSec === 'number' ? r.deathSec : null,
      killer: r.killerAgent || null,
      weapon: r.weapon || null,
      // What the killer dealt the player this round (8.7, the killer card),
      // only where Riot's record had it, so a card saved before keeps its keys.
      ...(r.killerDamage && typeof r.killerDamage.damage === 'number' ? { damage: { ...r.killerDamage } } : {}),
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
      // The round in order (8.5.0, valorant-verify.js): Riot's kill feed by
      // side and agent, never a name, and the plant's moment and site, so Ask
      // Coach tells it with no fill (chat-context.js needsFill). Only where the
      // record had them, so a review built before keeps its shape.
      ...(Array.isArray(r.feed) ? { feed: r.feed } : {}),
      ...(typeof r.riotPlantMs === 'number' ? { plantSec: Math.round(r.riotPlantMs / 100) / 10 } : {}),
      ...(r.plantSite ? { plantSite: r.plantSite } : {}),
      // The round record beyond the feed (8.8, valorant-verify.js
      // recordExtras), each only where the record had it, so a card built
      // before keeps its keys: where the player died and where their kills
      // fell, the team's buy, the nearest teammate at the death in a word,
      // the casts by key and kit name, and Riot's AFK flags.
      ...recordOnCard(r, kitAgent),
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
      // Where in that clip the moment its frames are timed against falls, in
      // ms on the clip's own timeline, for its player to mark (8.4.4,
      // review-clips.js lookDeathInClip). Null with no clip, and for a look
      // that never timed its frames: a number, never the wall clock.
      clipDeath: typeof r.forensics.clip === 'string' && CLIP_RE.test(r.forensics.clip)
        && typeof r.forensics.clipDeath === 'number' && Number.isFinite(r.forensics.clipDeath) ? r.forensics.clipDeath : null,
      // What a look asked with variant b also says (8.5.0, death-causes.js):
      // its judgement of the fight, the one thing its better play changes, and
      // the prompt it was asked with, which a cause's trend is held to
      // (patterns.js lookVariant). Data for Ask Coach and the trend, never the
      // grade, and only where the look said it, so a card saved before keeps
      // its keys: a look with no variant was asked with a.
      ...lookJudgement(r.forensics),
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
      ? ["Where you died is read off the screen, not taken from Riot's record, so a death's place can be misread."]
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
      || (ctx.gameMode === 'swiftplay' ? 'Swiftplay' : ctx.gameMode === 'spikerush' ? 'Spike Rush'
        : ctx.gameMode === 'standard' ? 'Standard' : null),
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
    // A queue Riot named whose halves are not known (Skirmish, Retake) never
    // takes the screen's 'standard' 12: only a New Map queue, whose format
    // varies by patch, leaves it to the screen.
    halftimeAfter: halftimeAfter(queueHalves(input.queue)
      || (!queueLabel(input.queue) || queueLabel(input.queue) === 'New Map' ? ctx.gameMode : null), rounds),
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
    // Both team comps from Riot's record (8.5.0, compsOf), where the link had
    // them: agents and roles only. The page's comps line is computed from it
    // when shown (compsLine), and Ask Coach is told it.
    ...(compsOf(input.comps) ? { comps: compsOf(input.comps) } : {}),
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
    return withView(withCompsLine(weaponsInTodaysWords({ ...review, insights: insights.asFacts(review.insights),
      grade: grader.riotWords(review.grade) })));
  }
  const out = review.insights ? { ...review, insights: insights.inTodaysWords(review.insights) } : review;
  return withView(withCompsLine(weaponsInTodaysWords(aboutNotesInTodaysWords(out))));
}

/*
 * WHAT THE PAGE DRAWS BY, NEVER ON DISK (B2). Each round's facts as tags, the
 * rounds that open by themselves, and the summary as lines: worked out here so
 * the window does no reading of its own, from what any saved review already
 * holds, so a review from any version gets them. withoutView takes them off
 * again, for a test that holds the rest of what is shown unchanged.
 */
const VIEW_FIELDS = ['summaryLines'];
const VIEW_CARD_FIELDS = ['tags', 'open', 'killerCard'];

function withView(review) {
  if (!review || typeof review !== 'object') return review;
  // The rounds of the top mistake the list counted, the one the page leads
  // with. None from Riot's record alone, which counts facts, not mistakes.
  const top = insights.countable(review).mistakes[0];
  const hot = new Set(top && Array.isArray(top.rounds) ? top.rounds : []);
  const rounds = Array.isArray(review.rounds)
    ? review.rounds.map((c) => {
      if (!c || typeof c !== 'object') return c;
      const card = { ...c, tags: factTags(c.facts), open: !!(c.forensics || c.why || hot.has(c.n)) };
      const killer = killerCard(c);
      if (killer) card.killerCard = killer;
      return card;
    })
    : review.rounds;
  return { ...review, rounds, summaryLines: summaryLines(review.summary) };
}

/*
 * THE KILLER CARD (8.7): the game's own death recap again, beside the round's
 * clip. Who killed the player by agent and icon, the gun by name and kill feed
 * icon, and what that killer dealt the player in the round, head, body and
 * legs, as finished strings the page sets by textContent.
 *
 * RIOT'S RECORD ONLY. The killer is Riot's (riot-rounds.js killerAgent), an
 * agent the game data knows or no card; the gun is Riot's name for it, its
 * icon only for a gun the data knows; the damage only where Riot's round kept
 * the killer's damage events on the player (killerDamageOf), else left out. A
 * screen only review gets no card: the screen's look names no killer by rule
 * (death-forensics.js parse), and a kill feed line read off the screen is a
 * read, never a fact. A round whose kill feed says the player fell to a
 * teammate or to themselves, or names another agent as the killer than the
 * record does, gets no card either. Never a name: agents and numbers only
 * (docs/claude/games.md).
 */
function killerCard(c) {
  const riot = c && c.died && c.riot;
  if (!riot || !riot.killer) return null;
  const agent = icons.agentName(riot.killer);
  if (!agent) return null;
  if (Array.isArray(riot.feed)) {
    const end = riot.feed.find((k) => k && k.on === 'me');
    if (end && end.by && end.by !== 'enemy') return null;
    if (end && end.ka && icons.agentName(end.ka) !== agent) return null;
  }
  const gun = typeof riot.weapon === 'string' && riot.weapon.trim() ? riot.weapon.trim() : null;
  const d = riot.damage && typeof riot.damage === 'object' ? riot.damage : null;
  const whole = (v) => (typeof v === 'number' && Number.isInteger(v) && v >= 0 ? v : null);
  const dealt = d && whole(d.damage) ? d.damage : null;
  const parts = dealt ? [['Head', whole(d.head)], ['Body', whole(d.body)], ['Legs', whole(d.legs)]] : [];
  const hits = parts.some(([, n]) => n) ? parts.map(([label, n]) => ({ label, value: String(n || 0) })) : null;
  return {
    label: 'Killed by',
    agent,
    agentIcon: icons.agentIcon(agent),
    weapon: gun,
    weaponIcon: gun ? icons.weaponIcon(gun) : null,
    damage: dealt ? String(dealt) : null,
    damageLabel: dealt ? 'damage to you this round' : null,
    hits,
  };
}

/** The review without what withView added: as served() gave it before B2. */
function withoutView(review) {
  if (!review || typeof review !== 'object') return review;
  const out = { ...review };
  for (const k of VIEW_FIELDS) delete out[k];
  if (Array.isArray(out.rounds)) {
    out.rounds = out.rounds.map((c) => {
      if (!c || typeof c !== 'object') return c;
      const card = { ...c };
      for (const k of VIEW_CARD_FIELDS) delete card[k];
      return card;
    });
  }
  return out;
}

/*
 * EACH FACT roundFacts WRITES, AS A TAG: { kind, tone, text }, the text the
 * fact itself. Matched on the exact sentences it writes, today's and every
 * earlier one a saved card can hold ("Died at B Tree, 3s in, to Chamber" as
 * weaponsInTodaysWords leaves it). A sentence matched by none is a plain
 * 'fact', so a card saved by some other version still shows every line.
 *
 * Tones: 'bad' a death or the round's first one, 'warn' what the counts call
 * a mistake (not traded, the ultimate held, a death with the team ahead),
 * 'good' what they call a strength, 'even' the rest.
 */
const ODDS_RE = /^(\d+) against (\d+) when you died$/;
const KILLS_RE = /^\d+ kills?$/;
const TRADED_MATES_RE = /^Traded teammates \d+ times$/;
const CLUTCH_FACT_RE = /^Last one standing against \d+(, and won it|, lost)?$/;
// "Died", "Died at A Main, 31s in, to Astra with a Sheriff", "Died 12s in",
// "Died, to Jett", "Died mid round": the word, then the end, a space or a comma.
const DIED_RE = /^Died(?:$|[ ,])/;

const FACT_EXACT = new Map([
  ['First death of the round', { kind: 'firstdeath', tone: 'bad' }],
  ['Traded by a teammate', { kind: 'traded', tone: 'even' }],
  ['Not traded', { kind: 'untraded', tone: 'warn' }],
  // 8.8: the trade with the nearest teammate's distance, one chip.
  ['Not traded, a teammate was close', { kind: 'untraded', tone: 'warn' }],
  ['Not traded, nobody close', { kind: 'untraded', tone: 'warn' }],
  // 8.8: the team's buy, and a round Riot says the player sat out.
  ['Pistol round', { kind: 'buy', tone: 'even' }],
  ['Eco round', { kind: 'buy', tone: 'even' }],
  ['Force buy', { kind: 'buy', tone: 'even' }],
  ['Half buy', { kind: 'buy', tone: 'even' }],
  ['Full buy', { kind: 'buy', tone: 'even' }],
  ['Riot marked you AFK, not counted', { kind: 'afk', tone: 'even' }],
  ['Stayed in spawn all round, not counted', { kind: 'afk', tone: 'even' }],
  ['Ultimate was ready', { kind: 'ult', tone: 'warn' }],
  ['Survived', { kind: 'survived', tone: 'good' }],
  ['First kill of the round', { kind: 'firstkill', tone: 'good' }],
  ['Traded a teammate', { kind: 'tradedmate', tone: 'good' }],
  ['Spike planted', { kind: 'plant', tone: 'even' }],
  ['Not watched by the coach', { kind: 'unwatched', tone: 'even' }],
]);

function factTag(text) {
  const exact = FACT_EXACT.get(text);
  if (exact) return { ...exact, text };
  if (DIED_RE.test(text)) return { kind: 'death', tone: 'bad', text };
  const odds = ODDS_RE.exec(text);
  if (odds) {
    // Ahead and still dead is the lost advantage the mistakes count; level or
    // behind is what the round already was.
    return { kind: 'odds', tone: Number(odds[1]) > Number(odds[2]) ? 'warn' : 'even', text };
  }
  if (KILLS_RE.test(text)) return { kind: 'kill', tone: 'good', text };
  if (TRADED_MATES_RE.test(text)) return { kind: 'tradedmate', tone: 'good', text };
  const clutch = CLUTCH_FACT_RE.exec(text);
  if (clutch) return { kind: 'clutch', tone: clutch[1] === ', and won it' ? 'good' : 'even', text };
  if (text.startsWith('Spike planted at ')) return { kind: 'plant', tone: 'even', text };
  return { kind: 'fact', tone: 'even', text };
}

/** A card's facts as tags, in their order; none for a card with no facts. */
function factTags(facts) {
  if (!Array.isArray(facts)) return [];
  return facts.filter((f) => typeof f === 'string' && f).map(factTag);
}

/*
 * THE SUMMARY AS LINES, one sentence each, split only where a sentence ends:
 * a stop, then a space, then a capital, a digit or a quote. Never inside
 * "1.5", and never after "vs." or "e.g.", which the model writes mid sentence.
 * A summary it cannot split is one line; none is no lines.
 */
const SENTENCE_END_RE = /[.!?]+["')\]]?\s+(?=["'(\[]?[A-Z0-9])/g;
const ABBREV_RE = /(?:^|[\s(])(?:vs|v|e\.g|i\.e|etc|approx)\.$/i;

function summaryLines(summary) {
  if (typeof summary !== 'string') return [];
  const text = summary.trim();
  if (!text) return [];
  const out = [];
  let from = 0;
  SENTENCE_END_RE.lastIndex = 0;
  let m;
  while ((m = SENTENCE_END_RE.exec(text))) {
    const stop = m.index + m[0].trimEnd().length;
    const head = text.slice(from, stop);
    // "vs. Jett": the stop ends a word the model shortens, not the sentence.
    if (ABBREV_RE.test(text.slice(Math.max(from, m.index - 8), m.index + 1))) continue;
    if (head.trim()) out.push(head.trim());
    from = m.index + m[0].length;
  }
  const rest = text.slice(from).trim();
  if (rest) out.push(rest);
  return out;
}

/** The review as shown, with its comps line (8.5.0) where it has comps, never on disk. */
function withCompsLine(review) {
  const line = compsLine(review);
  return line ? { ...review, compsLine: line } : review;
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

/** The enemy team's agents from Riot's comp, as compsOf keeps them, or null. */
function enemyAgentsOf(riot) {
  const c = compsOf(riot && riot.comps);
  return c && c.them.length ? c.them.map((x) => x.agent) : null;
}

/**
 * What the server's review route is sent. The engine and the review bench both
 * build it here, so the bench measures exactly what a player's match sends.
 */
/*
 * WHAT THE CARD COUNTED, as numbers (round 4): the deaths Riot's record
 * has, those nobody traded, those as the last one alive, and so those a
 * teammate alive could have traded (insights.js valorant's own rule). Sent
 * as `counts`, every time, the mark of a client built for the review's
 * round 4 rules (server match-review.js normalise), which counts the same
 * from the same rounds for its SWING AND COUNTS block.
 */
function countsOf(rounds) {
  const deaths = (rounds || []).filter((r) => r && r.verified && r.died);
  const known = deaths.filter((r) => typeof r.traded === 'boolean');
  const alone = (r) => !!(r.aliveAtDeath && typeof r.aliveAtDeath.mates === 'number' && r.aliveAtDeath.mates <= 1);
  const tradeable = known.filter((r) => !alone(r));
  return {
    deaths: deaths.length,
    known: known.length,
    untraded: known.filter((r) => r.traded === false).length,
    alone: known.filter(alone).length,
    tradeable: tradeable.length,
    untradedMate: tradeable.filter((r) => r.traded === false).length,
  };
}

function requestBody({ rounds, context, endedBy, tips, notes, riot, recurring }) {
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
      // Riot's place of the death where its record has one (8.8), else the screen's.
      n: r.n, side: r.side, result: r.result, died: r.died, deathSpot: (r.verified && r.died && r.riotSpot) || r.deathSpot,
      timing: timingOf(r), planted: r.planted, plantSpot: r.plantSpot,
      ultReady: r.died && r.ultAtDeath === 'ready',
      reads: readsOf(r, map, kitAgent),
      // Riot's exact facts, when the match has been checked against them.
      ...(r.verified ? {
        verified: true, sec: r.deathSec, killer: r.killerAgent, weapon: r.weapon,
        firstDeath: r.firstDeath, firstKill: r.firstKill, kills: r.kills,
        traded: typeof r.traded === 'boolean' ? r.traded : null,
        alive: r.aliveAtDeath || null,
        // The numbers standing through the round (round 3), for the state gate only.
        ...(standingsOf(r) ? { standings: standingsOf(r) } : {}),
        // THE PLANT'S TIME FROM RIOT'S RECORD (the blind audit of round 7):
        // a Plat review told Split round 10 "after the plant, use cover to
        // hold the spike" of a death Riot has 34 s before the plant. The
        // server's post plant gate (record-claims.js checkPostPlant) knows a
        // death came before the plant only from the death's second against
        // the plant's, and the round sent neither the plant's time nor Riot's
        // afterPlant. Both go only in a round Riot's record timed the plant,
        // where afterPlant is Riot's own answer, never false for unknown; a
        // round without it is sent as before, byte for byte.
        ...(r.planted && typeof r.riotPlantMs === 'number' && Number.isFinite(r.riotPlantMs)
          ? { plantSec: Math.round(r.riotPlantMs / 100) / 10, afterPlant: r.afterPlant === true } : {}),
        // The round record beyond the feed (8.8), only where it had them: the
        // team's buy, the nearest teammate at the death, the player's casts
        // by kit name, and a round Riot says the player sat out. A record
        // without them sends the round as before, byte for byte.
        ...(BUY_WORDS[r.buy] ? { buy: r.buy } : {}),
        ...(r.died && (r.mateNear === 'close' || r.mateNear === 'far') ? { mate: r.mateNear } : {}),
        ...(castsNamed(r.casts, kitAgent) ? { casts: castsNamed(r.casts, kitAgent).map((c) => ({ name: c.name, n: c.n })) } : {}),
        ...(r.afk === true || r.inSpawn === true ? { afk: true } : {}),
        // Riot's callout of the death apart from deathSpot (which is it, or
        // the screen's where Riot had none), for the server's retrieval
        // signals and record gates alone (match-review.js recordSent).
        ...(r.died && r.riotSpot ? { place: r.riotSpot } : {}),
        // Where the player's kills fell, in a death Riot's record has no
        // place for (round 7), so the server never sends the screen's spot
        // as the death's place when it lies in another region than every
        // kill (match-review.js placesKept: Sunset 2 to 5 round 6).
        ...(r.died && !r.riotSpot && Array.isArray(r.killSpots) && r.killSpots.length ? { killPlaces: r.killSpots.slice(0, 5) } : {}),
      } : {}),
      // The coach's look at the death, so the summary and the round lines
      // agree with the cause the review counts.
      ...(r.forensics && r.forensics.cause ? { cause: r.forensics.cause, seen: r.forensics.what || null } : {}),
    })),
    patterns: patterns(rounds),
    // The match's swing from Riot's record (round 3, swingOf), always an
    // array: a client that sends it is one built for the review's round 3
    // rules (server match-review.js normalise), and one that does not is
    // reviewed as before.
    swing: swingOf(rounds, riot),
    // What the card counted (round 4, countsOf), always an object: the mark
    // of the round 4 rules, as `swing` is of round 3's.
    counts: countsOf(rounds),
    // The counted mistakes the library finds again across recent matches,
    // keys only, where the caller knows them. From Platinum the trade habit
    // is the focus only when it is one of these (server leverOf).
    ...(Array.isArray(recurring) && recurring.length ? { recurring: recurring.filter((k) => typeof k === 'string').slice(0, 8) } : {}),
    context: {
      agent: (riot && riot.agent) || ctx.agent || null,
      map: ctx.map || (riot && riot.map) || null,
      advancedTips: ctx.advancedTips === true,
      // The review is written in the player's language; the gates below it
      // still read the labels, which stay English.
      language: typeof ctx.language === 'string' ? ctx.language : 'en',
      // The enemy team's agents from Riot's comp (8.8, compsOf), agents only,
      // for the notes and cases that answer them (server knowledge.js
      // enemyFit). Left out when the link brought no comp.
      ...(enemyAgentsOf(riot) ? { enemyAgents: enemyAgentsOf(riot) } : {}),
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
      // Where the agent came from (8.4.4): 'hud' when the engine read it off
      // the player's own HUD, which the late link and the backfill never
      // refuse a match over (match-link.js linkAgentOf), as the live link
      // does not. Null for one the player confirmed, and for every review
      // saved before.
      agentSource: typeof c.agentSource === 'string' && c.agentSource ? c.agentSource : null,
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
  queueLabel, queueHalves, withArticle, spans, endedTooSoon, foreignPlace, foreignKit, readsOf, compsOf, compsLine, enemyAgentsOf, lookJudgement,
  factTags, summaryLines, withoutView, VIEW_FIELDS, VIEW_CARD_FIELDS,
  BASELINE_GAMES, BASELINE_MIN, swingOf, standingsOf, SWING_MAX, countsOf,
  buyDiscipline, castsNamed, recordOnCard, BUY_WORDS, BUYS_MIN, deathPlace };
