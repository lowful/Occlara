'use strict';

/**
 * The Valorant post-match review, computed.
 *
 * Same principle as lol-review.js and rivals-review.js, for the same reason: a
 * review is where a confident wrong sentence costs most, because the match is
 * over and the player can only check it against a half memory. So every number
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

const BASELINE_GAMES = 10;
const BASELINE_MIN = 3;

function pct(a, b) { return b ? Math.round((a / b) * 100) : 0; }

function plural(n, one, many) { return `${n} ${n === 1 ? one : (many || one + 's')}`; }

function sideLabel(side) {
  return side === 'attacking' ? 'Attack' : side === 'defending' ? 'Defence' : null;
}

/** Where halftime falls, so the timeline can draw it. Null when unknown. */
function halftimeAfter(mode, rounds) {
  if (mode === 'swiftplay') return 4;
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

  // Early deaths: before any plant with 70 seconds or more still on the clock.
  const early = deaths.filter((r) => r.early);
  if (early.length >= 2) {
    out.push({
      key: 'early',
      text: `${early.length} deaths came in the first 30 seconds of the round, before any plant, `
        + `in rounds ${early.map((r) => r.n).join(', ')}.`,
    });
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
    out.push({
      key: 'sides',
      text: `Won ${aw} of ${atk.length} on attack and ${dw} of ${def.length} on defence.`,
    });
  }

  // After the spike went down. On attack that is the post-plant, on defence it
  // is the retake, and those are different skills, so they are counted apart.
  const postAtk = decided.filter((r) => r.planted && r.side === 'attacking');
  if (postAtk.length >= 2) {
    const w = postAtk.filter((r) => r.result === 'won').length;
    out.push({ key: 'postplant', text: `On attack, won ${w} of ${postAtk.length} rounds once the spike was down.` });
  }
  const retakes = decided.filter((r) => r.planted && r.side === 'defending');
  if (retakes.length >= 2) {
    const w = retakes.filter((r) => r.result === 'won').length;
    out.push({ key: 'retake', text: `On defence, won ${w} of ${retakes.length} rounds after they planted.` });
  }

  return out;
}

/** The facts line under a round, computed, never written by the model. */
function roundFacts(r) {
  const facts = [];
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
 * @param input.ai         { summary, rounds: { [n]: why }, focus, study: [{text, coach}] }
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

  const cards = rounds.map((r) => ({
    n: r.n,
    side: sideLabel(r.side),
    result: r.result,
    died: r.died,
    early: !!r.early,
    planted: r.planted,
    facts: roundFacts(r),
    reads: r.reads.map((x) => x.text),
    why: typeof whys[r.n] === 'string' && whys[r.n] ? whys[r.n] : null,
  }));

  const deaths = rounds.filter((r) => r.died).length;
  const decided = rounds.filter((r) => r.result);
  const refused = [
    'Kills, damage and who won each fight are not printed on the HUD in a way the coach can read, '
      + 'so a round card says what was seen, not how the duel went.',
  ];
  if (input.endedBy === 'stop') {
    refused.push('Coaching was stopped before the match ended, so this covers the rounds the coach watched.');
  }
  if (!tracker) {
    refused.push('The scoreboard comes from Riot once the match is published. '
      + 'Add your Riot ID in Settings, and it fills in here a few minutes after the match.');
  }

  const game = {
    agent: ctx.agent || (tracker && tracker.agent) || null,
    map: ctx.map || (tracker && tracker.map) || null,
    mode: ctx.gameMode === 'swiftplay' ? 'Swiftplay' : ctx.gameMode === 'standard' ? 'Standard' : null,
    result,
    score,
  };

  return {
    kind: 'valorant',
    at: Date.now(),
    endedBy: input.endedBy || 'stop',
    game,
    scoreline: tracker ? {
      kills: tracker.kills, deaths: tracker.deaths, assists: tracker.assists,
      acs: tracker.acs, adr: tracker.adr, headshotPct: tracker.headshotPct, kd: tracker.kd,
    } : null,
    watched: {
      rounds: rounds.length,
      deaths,
      decided: decided.length,
      survival: rounds.length ? pct(rounds.length - deaths, rounds.length) : null,
    },
    halftimeAfter: halftimeAfter(ctx.gameMode, rounds),
    patterns: patterns(rounds),
    summary: ai.summary || null,
    focus: ai.focus || null,
    study: Array.isArray(ai.study) ? ai.study.slice(0, 3) : [],
    rounds: cards,
    against: against(tracker, input.role || null, input.history || []),
    refused,
  };
}

/** A death's timing as the bucket roundFacts prints, or null. */
function timingOf(r) {
  if (!r.died || r.deathClock === null || r.deathClock === undefined || r.planted) return null;
  const into = 100 - r.deathClock;
  return into <= 30 ? 'early' : into <= 70 ? 'mid' : 'late';
}

/**
 * What the server's review route is sent. The engine and the review bench both
 * build it here, so the bench measures exactly what a player's match sends.
 */
function requestBody({ rounds, context, endedBy, tips, notes }) {
  const ctx = context || {};
  const team = typeof ctx.teamScore === 'number' ? ctx.teamScore : null;
  const enemy = typeof ctx.enemyScore === 'number' ? ctx.enemyScore : null;
  return {
    tips: (tips || []).slice(-30),
    notes: (notes || []).slice(-20),
    rounds: rounds.map((r) => ({
      n: r.n, side: r.side, result: r.result, died: r.died, deathSpot: r.deathSpot,
      timing: timingOf(r), planted: r.planted, plantSpot: r.plantSpot,
      ultReady: r.died && r.ultAtDeath === 'ready',
      reads: r.reads.map((x) => x.text),
    })),
    patterns: patterns(rounds),
    context: { agent: ctx.agent || null, map: ctx.map || null, advancedTips: ctx.advancedTips === true },
    final: {
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
 * Against the player's own recent matches, IN THE SAME ROLE.
 *
 * A controller's ACS and a duelist's ACS are different quantities, the same
 * argument rivals-review.js makes about Strategists and Duelists. Comparing
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

module.exports = { build, patterns, roundFacts, historyEntry, against, halftimeAfter, requestBody, timingOf,
  BASELINE_GAMES, BASELINE_MIN };
