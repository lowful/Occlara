'use strict';

/**
 * The grade: 0 to 100, a letter, and four categories, each with the facts it
 * came from.
 *
 * WHY EVERY CATEGORY CARRIES ITS EVIDENCE. A bare number invites exactly one
 * response, "that's wrong", and nothing to check it against. Each category
 * here says what it counted, so a player who disagrees can see which fact they
 * disagree with, and a player who agrees knows what to change.
 *
 * WHY IT IS ARITHMETIC. Same reason as every review in this app: the model
 * never writes a number the player is judged by. The one model judgement that
 * reaches a grade is the death cause label from death-forensics, and it moves
 * only the Decisions category, never more than its weight.
 *
 * A CATEGORY WITH NOTHING TO MEASURE IS LEFT OUT, not scored as zero or as
 * average. The overall is the weighted mean of the categories that spoke, and
 * the grade says `provisional` when Riot's record was not linked or a category
 * is missing, because the same match graded from the screen alone and from
 * Riot's record can land ten points apart.
 *
 * THE LESSON FROM grade-blend.js SURVIVES: a real scoreboard outranks a count
 * of mistakes. A 31 kill match MVP graded from their deaths alone read as a
 * struggling player. Impact carries the most weight for that reason.
 *
 * Every curve below is a set of anchor points, interpolated, so each can be
 * read as a table: "0.75 deaths a round is 64". They were set against real
 * matches in scripts/fixtures and are asserted in npm run test:grade.
 *
 * Pure, no Electron.
 */

const { isAvoidable } = require('./death-causes');

// "1 deaths", "traded a teammate 1 times" and "of the 1 deaths" all reached the
// evidence lines, which are the sentences a player checks the grade against.
const plural = (n, one, many) => `${n} ${n === 1 ? one : (many || one + 's')}`;
const times = (n) => (n === 1 ? 'once' : n === 2 ? 'twice' : `${n} times`);

const clamp = (v, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, v));
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const round1 = (v) => Math.round(v * 10) / 10;

/** Piecewise linear over [[x, y], ...], flat beyond the ends. */
function curve(x, pts) {
  if (x <= pts[0][0]) return pts[0][1];
  for (let i = 1; i < pts.length; i++) {
    const [x1, y1] = pts[i];
    if (x <= x1) {
      const [x0, y0] = pts[i - 1];
      return y0 + ((x - x0) / (x1 - x0)) * (y1 - y0);
    }
  }
  return pts[pts.length - 1][1];
}

/** S 90+, A 80+, B 70+, C 60+, D below. */
function letter(score) {
  if (score === null || score === undefined) return null;
  return score >= 90 ? 'S' : score >= 80 ? 'A' : score >= 70 ? 'B' : score >= 60 ? 'C' : 'D';
}

/** The weighted mean of the categories that have a score. */
function combine(categories) {
  const scored = categories.filter((c) => c.score !== null);
  if (!scored.length) return null;
  const w = scored.reduce((a, c) => a + c.weight, 0);
  // Each category as the card SHOWS it, capped at 100. Averaging the raw ones
  // let an Impact of 109 lift the overall above what the four numbers under it
  // could make, so a player checking the grade against them could not.
  return Math.round(scored.reduce((a, c) => a + clamp(c.score) * c.weight, 0) / w);
}

/**
 * ONE CATEGORY IS NOT A GRADE. The screen alone can count deaths and nothing
 * else, and a match graded on deaths alone put a 13 to 11 win at 45. So an
 * overall needs at least two categories carrying half the weight between them,
 * and below that the categories that did speak are shown without a letter.
 */
const MIN_CATEGORIES = 2;
const MIN_WEIGHT_SHARE = 0.5;

function finish(categories, provisional, notes = []) {
  const spoke = categories.filter((c) => c.score !== null);
  const weight = spoke.reduce((a, c) => a + c.weight, 0);
  const all = categories.reduce((a, c) => a + c.weight, 0);
  const enough = spoke.length >= MIN_CATEGORIES && weight >= all * MIN_WEIGHT_SHARE;
  const score = enough ? combine(categories) : null;
  return {
    score,
    letter: letter(score),
    provisional: !!provisional || categories.some((c) => c.score === null),
    categories: categories.map((c) => ({ ...c, score: c.score === null ? null : Math.round(clamp(c.score)) })),
    notes,
  };
}

const perRound = (n, rounds) => (rounds ? n / rounds : null);

// ── Valorant ────────────────────────────────────────────────────────────────

/** ACS against the player's own recent matches in the same role, when there are three. */
function roleBaseline(history, role, key) {
  const pool = (history || []).filter((h) => h && (!role || h.role === role)).slice(-10)
    .map((h) => num(h[key])).filter((v) => v !== null);
  if (pool.length < 3) return null;
  return { mean: pool.reduce((a, b) => a + b, 0) / pool.length, games: pool.length };
}

/*
 * WHAT DECISIONS SAYS WHEN IT FLAGGED NOTHING. A recorded match had its
 * ultimate read and the coach's look behind the count, so "no avoidable death"
 * is what the count found. Graded from Riot's record alone it counted only the
 * deaths with the team ahead in a lost round, and calling the rest not
 * avoidable was a judgement nobody made, so it says what it counted.
 */
const NONE_AVOIDABLE = 'no avoidable death on record';
const NONE_COUNTED = 'no death with your team ahead in a lost round';

/**
 * @param input.rounds     reconciled rounds (valorant-verify) or ledger rows
 * @param input.scoreline  { kills, deaths, assists, acs } from Riot or the tracker, or null
 * @param input.role       the agent's role
 * @param input.history    valorantHistory rows
 * @param input.totalRounds the match's round count when known (from the score)
 * @param input.riotOnly   graded from Riot's record alone, with no recording
 */
function valorant(input) {
  const rows = Array.isArray(input.rounds) ? input.rounds : [];
  const verified = rows.filter((r) => r.verified);
  const isVerified = verified.length > 0;
  const role = input.role || null;
  const sl = input.scoreline || null;
  const total = isVerified ? verified.length : (num(input.totalRounds) || rows.length);
  const deaths = isVerified ? verified.filter((r) => r.died).length
    : (sl && num(sl.deaths) !== null ? sl.deaths : rows.filter((r) => r.died).length);
  const notes = [];
  if (!isVerified && !sl) {
    notes.push(input.linkMissing === 'taken'
      ? "A full grade needs Riot's record of the match, and it is on another review of this match in your library."
      : input.linkMissing
      ? "A full grade needs Riot's record of the match, and it was not found. A match played on another account than the Riot ID in Settings never links."
      : input.riotIdSet
        ? "A full grade needs Riot's record of the match. It grades itself once Riot publishes it, a few minutes after the match."
        : "A full grade needs Riot's record of the match. Add your Riot ID in Settings and it grades itself a few minutes after the match.");
  }
  else if (!isVerified) notes.push('Graded from the scoreboard. It firms up once Riot\'s round record links.');

  // Survival: deaths a round, and being the first to die more than the role explains.
  const survival = { key: 'survival', label: 'Survival', weight: 25, score: null, evidence: [] };
  if (total >= 3) {
    const dpr = deaths / total;
    // A Duelist's job is to take the first fight, so the same death rate means
    // less for one. Measured on the real Abyss match: a 31 kill Jett at 0.875
    // deaths a round graded 49 on the shared curve, which read as a player who
    // could not stay alive rather than an entry doing entry work.
    const DPR = role === 'Duelist'
      ? [[0.5, 97], [0.65, 86], [0.8, 70], [0.95, 52], [1.1, 36]]
      : [[0.4, 97], [0.55, 86], [0.7, 70], [0.85, 52], [1.0, 36]];
    let s = curve(dpr, DPR);
    survival.evidence.push(`${plural(deaths, 'death')} in ${plural(total, 'round')}`);
    if (isVerified) {
      const fd = verified.filter((r) => r.firstDeath).length;
      const allowance = role === 'Duelist' ? 0.22 : 0.14;
      const excess = Math.max(0, fd / total - allowance);
      if (fd) survival.evidence.push(`first to die in ${fd} of ${plural(total, 'round')}`);
      s -= excess * 100;
      const lived = verified.filter((r) => !r.died).length;
      if (lived) survival.evidence.push(`survived ${plural(lived, 'round')}`);
    }
    survival.score = s;
  }

  // Impact: combat score against the player's own role average, or an absolute
  // ladder until there are three matches to compare with. Opening kills and
  // multi kill rounds on top.
  const impact = { key: 'impact', label: 'Impact', weight: 30, score: null, evidence: [] };
  const acs = sl ? num(sl.acs) : null;
  if (acs !== null) {
    const base = roleBaseline(input.history, role, 'acs');
    let s;
    if (base) {
      s = curve(acs / base.mean, [[0.6, 38], [0.8, 56], [1.0, 72], [1.2, 86], [1.45, 97]]);
      impact.evidence.push(`${Math.round(acs)} combat score a round, your ${role || ''} average is ${Math.round(base.mean)}`.replace('  ', ' '));
    } else {
      s = curve(acs, [[110, 30], [160, 48], [210, 64], [260, 78], [320, 90], [390, 98]]);
      impact.evidence.push(`${Math.round(acs)} combat score a round`);
    }
    if (sl && num(sl.kills) !== null) impact.evidence.push(`${plural(sl.kills, 'kill')}, ${plural(sl.deaths, 'death')}, ${plural(sl.assists == null ? 0 : sl.assists, 'assist')}`);
    if (isVerified) {
      const fk = verified.filter((r) => r.firstKill).length;
      const multi = verified.filter((r) => num(r.kills) !== null && r.kills >= 3).length;
      if (fk) impact.evidence.push(`first kill in ${plural(fk, 'round')}`);
      if (multi) impact.evidence.push(`${plural(multi, 'round')} with three or more kills`);
      s += Math.min(6, Math.max(0, fk / total - 0.1) * 60) + Math.min(6, multi * 2);
    }
    impact.score = s;
  } else if (isVerified) {
    // Riot's rounds without a combat score: kills a round.
    const kills = verified.reduce((a, r) => a + (num(r.kills) || 0), 0);
    impact.score = curve(kills / total, [[0.3, 30], [0.55, 50], [0.8, 68], [1.05, 84], [1.35, 96]]);
    impact.evidence.push(`${plural(kills, 'kill')} in ${plural(total, 'round')}`);
  }

  /*
   * RIOT'S KILL FEED IS A FACT ABOUT THE WHOLE MATCH, not about the deaths in
   * it. This used to be inferred from the deaths: the count of who was standing
   * only exists on a death round, and the trade ratio needed three deaths. So a
   * verified swiftplay at 14/2/3 had its two trades ignored under a note saying
   * the feed "was not available", and the same match with no deaths left
   * Decisions unmeasured and the whole grade provisional on a complete record.
   * reconcile() now says per round whether the feed was read whole
   * (feedKnown); the numbers standing are kept as a fallback for rows built
   * without it.
   */
  const hasFeed = verified.some((r) => r.feedKnown === true || !!r.aliveAtDeath);
  const trades = verified.reduce((a, r) => a + (num(r.trades) || 0), 0);

  // Teamplay: were your deaths answered, did you answer theirs, and assists.
  const teamplay = { key: 'teamplay', label: 'Teamplay', weight: 20, score: null, evidence: [] };
  const known = verified.filter((r) => r.died && typeof r.traded === 'boolean');
  const assists = sl ? num(sl.assists) : null;
  if (known.length >= 3) {
    const traded = known.filter((r) => r.traded).length;
    // Same reason: whoever goes in first is the hardest player to trade, and in
    // solo queue the trade is mostly the team's to make. The real Abyss Jett was
    // traded once in 21 deaths.
    const TRADED = role === 'Duelist'
      ? [[0, 42], [0.12, 56], [0.25, 70], [0.4, 84], [0.55, 95]]
      : [[0, 36], [0.15, 50], [0.3, 66], [0.45, 82], [0.6, 94]];
    let s = curve(traded / known.length, TRADED);
    s += Math.min(10, trades * 2);
    if (assists !== null) s += curve(assists / total, [[0, 0], [0.15, 2], [0.3, 5]]);
    teamplay.score = s;
    teamplay.evidence.push(`${traded} of ${plural(known.length, 'death')} traded by a teammate`);
    if (trades) teamplay.evidence.push(`you traded a teammate ${times(trades)}`);
    if (assists !== null) teamplay.evidence.push(plural(assists, 'assist'));
  } else if (assists !== null && total >= 3) {
    // Under three deaths there are too few to say whether this player's deaths
    // get answered, so that ratio waits. The trades they MADE do not depend on
    // how often they died, and count whenever the feed was there.
    let s = curve(assists / total, [[0.05, 45], [0.15, 60], [0.3, 76], [0.45, 90]]);
    teamplay.evidence.push(`${plural(assists, 'assist')} in ${plural(total, 'round')}`);
    if (hasFeed) {
      s += Math.min(10, trades * 2);
      if (trades) teamplay.evidence.push(`you traded a teammate ${times(trades)}`);
    } else {
      notes.push('Teamplay is from assists alone: Riot\'s kill feed was not available to count trades.');
    }
    teamplay.score = s;
  }

  // Decisions: deaths the record calls avoidable, against the rounds played.
  //   the team was up in numbers and the round was lost
  //   the ultimate was ready and never used
  //   the coach looked at the frame and saw a mistake from the closed list
  // Clutches won count the other way. With the feed and no deaths at all,
  // nothing was thrown, which is the top of the curve, not a missing category.
  // Three rounds at least, the floor the other categories keep, or a remake
  // two rounds long would grade on a share of two.
  const decisions = { key: 'decisions', label: 'Decisions', weight: 25, score: null, evidence: [] };
  // NOT A LOOK FROM THE SCREEN ALONE (8.2). Its frames were chosen by when the
  // screen read the death, which can be late, and with it a review Riot never
  // checked would speak in two categories: graded on its deaths and four of
  // the coach's labels, which is the grade from the screen that one category
  // is not a grade exists to refuse. It is shown, and counted in the lists.
  const looked = rows.filter((r) => r.died && r.forensics && r.forensics.cause && r.forensics.cause !== 'unclear'
    && r.forensics.source !== 'screen');
  if (total >= 3 && (hasFeed || looked.length)) {
    const flagged = new Set();
    const thrown = verified.filter((r) => r.died && r.aliveAtDeath && r.aliveAtDeath.mates > r.aliveAtDeath.enemies && r.result === 'lost');
    for (const r of thrown) flagged.add(r.n);
    const ult = rows.filter((r) => r.died && r.ultAtDeath === 'ready');
    for (const r of ult) flagged.add(r.n);
    const avoid = looked.filter((r) => isAvoidable(r.forensics.cause));
    for (const r of avoid) flagged.add(r.n);
    let s = curve(flagged.size / total, [[0, 96], [0.08, 85], [0.16, 72], [0.25, 60], [0.4, 42]]);
    const clutches = verified.filter((r) => r.clutch && r.clutch.won === true).length;
    s += Math.min(8, clutches * 4);
    decisions.score = s;
    if (thrown.length) decisions.evidence.push(`died with the team ahead in numbers and lost the round ${times(thrown.length)}`);
    if (ult.length) decisions.evidence.push(`died with the ultimate ready ${times(ult.length)}`);
    if (looked.length) {
      decisions.evidence.push(looked.length === 1
        ? `the one death the coach looked at was ${avoid.length ? '' : 'not '}avoidable`
        : `${avoid.length} of the ${looked.length} deaths the coach looked at ${avoid.length === 1 ? 'was' : 'were'} avoidable`);
    }
    if (clutches) decisions.evidence.push(`won ${clutches} clutch${clutches === 1 ? '' : 'es'}`);
    if (!decisions.evidence.length) decisions.evidence.push(input.riotOnly ? NONE_COUNTED : NONE_AVOIDABLE);
  }

  return finish([survival, impact, teamplay, decisions], !isVerified, notes);
}

/**
 * A Riot only grade saved before 8.2, in the words it is graded in now: its
 * Decisions said "no avoidable death on record". Shown, never saved, and a
 * grade with nothing to change comes back as it was.
 */
function riotWords(grade) {
  if (!grade || !Array.isArray(grade.categories)) return grade;
  const said = (c) => c && c.key === 'decisions' && Array.isArray(c.evidence) && c.evidence.includes(NONE_AVOIDABLE);
  if (!grade.categories.some(said)) return grade;
  return { ...grade, categories: grade.categories.map((c) => (said(c)
    ? { ...c, evidence: c.evidence.map((e) => (e === NONE_AVOIDABLE ? NONE_COUNTED : e)) } : c)) };
}

// ── Marvel Rivals ───────────────────────────────────────────────────────────

/** What a role is graded on for its duty, and the ladder until a baseline exists. */
const RIVALS_DUTY = {
  Strategist: { stat: 'healing', label: 'healing', pts: [[4000, 35], [9000, 55], [15000, 72], [22000, 86], [30000, 96]] },
  Vanguard:   { stat: 'blocked', label: 'damage blocked', pts: [[4000, 35], [12000, 55], [22000, 72], [35000, 86], [50000, 96]] },
  Duelist:    { stat: 'damage', label: 'damage', pts: [[4000, 35], [9000, 55], [15000, 72], [22000, 86], [30000, 96]] },
};

function rivals(review, history) {
  if (!review || review.empty) return null;
  const s = review.scoreline || {};
  const role = review.game && review.game.role;
  const against = new Map((review.against || []).map((a) => [a.id, a]));
  const vs = (id, pts, lowerIsBetter) => {
    const a = against.get(id);
    if (!a || !a.baseline) return null;
    const ratio = lowerIsBetter ? a.baseline / Math.max(0.5, a.value) : a.value / a.baseline;
    return { score: curve(ratio, pts), a };
  };
  const ratioPts = [[0.5, 35], [0.8, 56], [1.0, 72], [1.25, 86], [1.6, 97]];
  const noBaseline = [];

  const impact = { key: 'impact', label: 'Impact', weight: 30, score: null, evidence: [] };
  const k = num(s.kills); const d = num(s.deaths); const as = num(s.assists);
  if (k !== null && d !== null) {
    const kv = vs('kills', ratioPts);
    const kda = (k + (as || 0) * 0.5) / Math.max(1, d);
    impact.score = kv ? kv.score : curve(kda, [[0.8, 38], [1.5, 55], [2.5, 70], [4, 84], [6, 95]]);
    impact.evidence.push(`${plural(k, 'kill')}, ${plural(d, 'death')}, ${plural(as || 0, 'assist')}`);
    if (kv) impact.evidence.push(`your ${role || ''} average is ${round1(kv.a.baseline)} kills`.replace('  ', ' '));
    else noBaseline.push('impact');
  }

  const survival = { key: 'survival', label: 'Survival', weight: 25, score: null, evidence: [] };
  if (d !== null) {
    const dv = vs('deaths', ratioPts, true);
    survival.score = dv ? dv.score : curve(d, [[2, 95], [5, 82], [8, 66], [11, 52], [15, 38]]);
    survival.evidence.push(plural(d, 'death'));
    if (dv) survival.evidence.push(`your ${role || ''} average is ${round1(dv.a.baseline)}`.replace('  ', ' '));
    else noBaseline.push('survival');
  }

  const duty = { key: 'duty', label: 'Role duty', weight: 30, score: null, evidence: [] };
  const spec = RIVALS_DUTY[role];
  if (spec && num(s[spec.stat]) !== null) {
    const dv = vs(spec.stat, ratioPts);
    duty.score = dv ? dv.score : curve(s[spec.stat], spec.pts);
    duty.evidence.push(`${Math.round(s[spec.stat]).toLocaleString('en-US')} ${spec.label}`);
    if (dv) duty.evidence.push(`your ${role} average is ${Math.round(dv.a.baseline).toLocaleString('en-US')}`);
    else noBaseline.push('duty');
  }

  const aim = { key: 'aim', label: 'Accuracy', weight: 15, score: null, evidence: [] };
  const av = vs('accuracy', ratioPts);
  if (av) {
    aim.score = av.score;
    aim.evidence.push(`${round1(av.a.value)}% against your ${review.game.hero} average of ${round1(av.a.baseline)}%`);
  }

  const notes = [];
  if (noBaseline.length) {
    notes.push(`Still learning you: ${3 - Math.min(2, (history || []).length)} more matches on this role and the grade compares you with yourself.`);
  }
  return finish([impact, survival, duty, aim], noBaseline.length > 0, notes);
}

// ── League of Legends ───────────────────────────────────────────────────────

function lol(review) {
  if (!review || !review.scoreline) return null;
  const s = review.scoreline;
  const g = review.game || {};
  const min = num(g.durationSec) ? g.durationSec / 60 : null;
  const support = /support|utility/i.test(g.role || '');
  const notes = [];

  const farming = { key: 'farming', label: 'Farming', weight: support ? 0 : 25, score: null, evidence: [] };
  if (!support && min && num(s.cs) !== null) {
    const cpm = s.cs / min;
    farming.score = curve(cpm, [[3.5, 35], [5, 55], [6.5, 70], [8, 85], [9.5, 96]]);
    farming.evidence.push(`${s.cs} CS, ${round1(cpm)} a minute`);
    if (num(s.csAt10) !== null) farming.evidence.push(`${s.csAt10} CS at 10 minutes`);
  }

  const survival = { key: 'survival', label: 'Survival', weight: 25, score: null, evidence: [] };
  if (min && num(s.deaths) !== null) {
    const per10 = (s.deaths / min) * 10;
    let sc = curve(per10, [[0.8, 95], [1.8, 80], [2.8, 65], [4, 50], [5.5, 36]]);
    const f = review.fights || {};
    if (num(f.caughtAlone) !== null && s.deaths) sc -= Math.min(10, (f.caughtAlone / s.deaths) * 12);
    survival.score = sc;
    survival.evidence.push(`${plural(s.deaths, 'death')} in ${plural(Math.round(min), 'minute')}`);
    if (f.caughtAlone) survival.evidence.push(`${f.caughtAlone} caught alone`);
  }

  const vision = { key: 'vision', label: 'Vision', weight: support ? 35 : 20, score: null, evidence: [] };
  if (min && num(s.ward) !== null) {
    const wpm = s.ward / min;
    vision.score = curve(wpm, support ? [[0.8, 40], [1.4, 60], [2, 76], [2.6, 90]] : [[0.25, 40], [0.5, 58], [0.8, 74], [1.2, 90]]);
    vision.evidence.push(`vision score ${s.ward}, ${round1(wpm)} a minute`);
  }

  const objectives = { key: 'objectives', label: 'Objectives', weight: support ? 40 : 30, score: null, evidence: [] };
  const o = review.objectives || {};
  const forO = (o.dragonsFor || 0) + (o.baronsFor || 0) * 2 + (o.turretsFor || 0) * 0.5;
  const againstO = (o.dragonsAgainst || 0) + (o.baronsAgainst || 0) * 2 + (o.turretsAgainst || 0) * 0.5;
  if (forO + againstO >= 2) {
    objectives.score = curve(forO / (forO + againstO), [[0.15, 36], [0.35, 52], [0.5, 66], [0.7, 82], [0.9, 95]]);
    objectives.evidence.push(`dragons ${o.dragonsFor || 0} to ${o.dragonsAgainst || 0}, barons ${o.baronsFor || 0} to ${o.baronsAgainst || 0}, turrets ${o.turretsFor || 0} to ${o.turretsAgainst || 0}`);
  }
  const cats = [farming, survival, vision, objectives].filter((c) => c.weight > 0);
  if (support) notes.push('Graded as a support: farming is left out and vision counts for more.');
  return finish(cats, false, notes);
}

module.exports = { valorant, rivals, lol, letter, curve, combine, riotWords, NONE_AVOIDABLE, NONE_COUNTED };
