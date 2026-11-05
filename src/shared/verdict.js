'use strict';

/**
 * THE VERDICT (8.6.0): what the top of a graded review says, and what its
 * share image draws. From a review as the page is served it (valorant-review.js
 * served(), or a League review as finishLolGame() saves it). Pure, no Electron
 * and no DOM: the review page reads it through its preload (review-preload.js
 * verdictOf), the share image draws it (renderer/shared/verdict-card.js), and
 * test:verdict builds it from the fixtures.
 *
 *   { game, title, right, letter, score, provisional, reason, stat, stats, sub, icon, at }
 *
 * THE ONE REASON IS COUNTED, NEVER WRITTEN. It is the review's own top entry
 * (insights.js, every number in it arithmetic): the first strength for an S or
 * an A, the first mistake below that, Riot's first fact for a match graded
 * from Riot's record alone, else the first of the round patterns cut to its
 * first clause. An entry the coach's look judged (judged: true, a death cause
 * the model labelled) is passed over, and the model's summary and focus are
 * never read. No reason is better than an invented one: then there is none.
 * A League entry speaks in its own counted line (insights.js lol), never its
 * bare title: "CS at 10:00." says nothing a player can check.
 *
 * NO NAME. It carries agents and numbers only, and has no field for a Riot ID
 * or a summoner name, the player's own included: League's game.me is never
 * read, and a string holding a '#', the mark of a Riot ID, is left out
 * wherever it came from.
 *
 * ONE GAME'S VERDICT. A review is Valorant's or League's by its kind, and one
 * of neither (a retired game's) has no Verdict, never another game's.
 */

const { iconOf } = require('./agent-icons');

const plural = (n, one, many) => `${n} ${n === 1 ? one : (many || one + 's')}`;
const times = (n) => (n === 1 ? 'once' : n === 2 ? 'twice' : `${n} times`);
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
/** A string the Verdict may carry: none with a '#' in it, so never a Riot ID. */
const said = (v) => (typeof v === 'string' && v.trim() && !v.includes('#') ? v.trim() : null);
const DOT = ' · ';

/** The letters grade.js gives; a score without one of them has no Verdict. */
const LETTERS = new Set(['S', 'A', 'B', 'C', 'D']);
/** The grades whose reason is what went well. */
const STRONG = new Set(['S', 'A']);
const RESULT = new Map([['Victory', 'Win'], ['Defeat', 'Loss'], ['Draw', 'Draw']]);
/** Its own key, never one an object inherits ("toString" is no line). */
const own = (o, k) => typeof k === 'string' && Object.prototype.hasOwnProperty.call(o, k);

/** Short lines for the Valorant entries insights.js makes, by key; any other falls to its title. */
/*
 * SINCE 8.7.2 a traded death leaves the first death and the advantage counts,
 * and a death as the last one alive leaves the untraded one (insights.js,
 * untradedOnly). Their lines say so, and the untraded line's denominator is
 * the entry's own (of): read off the cards it was every death Riot knows the
 * trade of, and a 13 of 16 untraded match said "8 of your 16 deaths". A count
 * saved before keeps the line it was made for.
 */
const newCount = (e) => e.untradedOnly === true || /\bnobody traded it\b/.test(String(e.detail || ''));
const LINES = {
  'first-death': (e, t) => {
    const what = newCount(e) ? 'First to die and not traded' : 'First to die';
    return t.verifiedRounds ? `${what} in ${e.count} of ${t.verifiedRounds} rounds.` : `${what} in ${plural(e.count, 'round')}.`;
  },
  'lost-advantage': (e) => `Died${newCount(e) ? ' untraded' : ''} with the team up in numbers in ${plural(e.count, 'lost round')}.`,
  untraded: (e, t) => {
    const of = num(e.of) !== null && e.of >= e.count ? e.of : t.tradeKnown;
    return of ? `${e.count} of your ${plural(of, 'death')} went untraded.` : `${e.count} of your deaths went untraded.`;
  },
  early: (e, t) => (t.deaths ? `${e.count} of ${plural(t.deaths, 'death')} in the first 30 seconds.` : `${plural(e.count, 'death')} in the first 30 seconds.`),
  'ult-held': (e) => `Died holding the ultimate in ${plural(e.count, 'round')}.`,
  'first-kill': (e) => `First kill of the round ${times(e.count)}.`,
  'multi-kill': (e) => `${plural(e.count, 'round')} with three kills or more.`,
  clutch: (e) => `Won ${plural(e.count, 'round')} as the last one standing.`,
  trades: (e) => `Traded a teammate ${times(e.count)}.`,
  survived: (e) => `Survived ${plural(e.count, 'round')}.`,
};

/*
 * A PATTERN'S FIRST CLAUSE: "16 of your 21 deaths came in the first 30
 * seconds of the round", cut where its list of rounds, its comparison or its
 * split begins (", in rounds 2", ", rounds 2", ", 4", ", more than", ",
 * before", ": "). "On attack, won 1 of 2 rounds" is one clause and stays
 * whole: its comma is followed by a word.
 */
const CLAUSE_CUT = /,\s(?:in\s)?(?:rounds?\s|more than|before|\d)|:\s/;

function firstClause(text) {
  const s = String(text || '').trim();
  const cut = s.search(CLAUSE_CUT);
  const head = (cut > 0 ? s.slice(0, cut) : s).replace(/[.\s]+$/, '');
  return head ? head + '.' : null;
}

/** A Valorant entry's line: its short line by key, else its title and how many rounds. */
function valorantLine(e, totals) {
  const rounds = Array.isArray(e.rounds) ? e.rounds.length : 0;
  const count = typeof e.count === 'number' ? e.count : rounds;
  if (own(LINES, e.key)) return LINES[e.key]({ ...e, count }, totals);
  const title = typeof e.title === 'string' ? e.title.replace(/[.\s]+$/, '') : '';
  if (!title) return null;
  return rounds ? `${title}, ${plural(rounds, 'round')}.` : `${title}.`;
}

/**
 * A League entry's line: its own detail, which insights.js lol counts ("4 of
 * your 6 deaths happened with no ally dying anywhere near.", "CS at 10:00: 52
 * this game, against your average of 61."). A skill measured without a number
 * has its label for a detail, the same as its title, and says nothing.
 */
function lolLine(e) {
  const detail = typeof e.detail === 'string' ? e.detail.trim() : '';
  const title = typeof e.title === 'string' ? e.title.trim() : '';
  return detail && detail !== title ? detail : null;
}

/** The one reason, counted from the review's own lists (above), or null. */
function reason(review) {
  const r = review || {};
  const ins = r.insights || {};
  const lol = r.kind === 'lol';
  const rounds = Array.isArray(r.rounds) ? r.rounds : [];
  const totals = {
    verifiedRounds: (r.verified ? rounds.length : rounds.filter((x) => x && x.verified).length) || null,
    deaths: rounds.filter((x) => x && x.died).length || null,
    // A round card carries Riot's trade under riot (valorant-review.js), never
    // on itself: read off the card, every death counted as unknown, and the
    // Abyss match said "20 of your deaths" where Riot knows of all 21.
    tradeKnown: rounds.filter((x) => x && x.died && x.riot && typeof x.riot.traded === 'boolean').length || null,
  };
  const letter = r.grade && r.grade.letter;
  const lists = STRONG.has(letter)
    ? [ins.strengths, ins.mistakes, ins.facts]
    : [ins.mistakes, ins.facts, ins.strengths];
  for (const list of lists) {
    for (const e of Array.isArray(list) ? list : []) {
      if (!e || typeof e !== 'object' || e.judged) continue;
      const line = said(lol ? lolLine(e) : valorantLine(e, totals));
      if (line) return line;
    }
  }
  for (const p of Array.isArray(r.patterns) ? r.patterns : []) {
    const line = said(p && firstClause(p.text));
    if (line) return line;
  }
  return null;
}

/*
 * THE STANDOUT (8.7.x): the one number the share image shows under the grade,
 * where the reason was. Counted from the review's own record, never the
 * model's, in a fixed order, the first that holds wins:
 *
 *   Valorant, from the rounds Riot's record verified (round.riot):
 *     1. an ace or a four kill round, every round at the most named
 *     2. a clutch won, the most enemies, the earliest of a tie
 *     3. a three kill round
 *     4. first kills of the round, two or more
 *   League, from the scoreline:
 *     1. CS per minute, 6 or more over a game of five minutes or more, never
 *        for a support, whose job is not the wave
 *     2. a KDA of 3 or more
 *   Then the calm fallback, the same arithmetic for any match: kills per death
 *   (Valorant) or the KDA (League), and a game with no deaths says so. With no
 *   numbers at all there is no standout, and the image leaves the line out.
 *
 * { value, label }: a short value drawn large and a finished line beside it.
 */
const ratio = (a, b) => (Math.round((a / b) * 100) / 100).toFixed(2);

function valorantStandout(r) {
  const rows = (Array.isArray(r.rounds) ? r.rounds : []).filter((x) => x && x.riot && typeof x.n === 'number');
  const killsOf = (x) => (typeof x.riot.kills === 'number' ? x.riot.kills : 0);
  const top = rows.reduce((m, x) => Math.max(m, killsOf(x)), 0);
  // Every round at the most, so a second one is never hidden behind the first.
  const where = (k) => {
    const ns = rows.filter((x) => killsOf(x) === k).map((x) => x.n);
    return ns.length === 1 ? `round ${ns[0]}` : ns.length === 2 ? `rounds ${ns[0]} and ${ns[1]}` : `each of ${ns.length} rounds`;
  };
  // A Sage revive can make six: the count is said as it was, never rounded down to five.
  // It can also make five kills that are not all five enemies, so a round is an
  // ace only when its kill feed shows the player killing five different enemy
  // agents (va, valorant-verify.js killFeedOf). A round without that proof is
  // its count, 5K, never an ace by its number alone.
  const isAce = (x) => {
    const feed = Array.isArray(x.riot.feed) ? x.riot.feed : (Array.isArray(x.feed) ? x.feed : []);
    const victims = new Set(feed.filter((k) => k && k.by === 'me' && k.on === 'enemy' && typeof k.va === 'string' && k.va)
      .map((k) => k.va.toLowerCase()));
    return victims.size >= 5;
  };
  if (top >= 5) {
    const ace = rows.some((x) => killsOf(x) === top && isAce(x));
    return { value: ace ? 'Ace' : `${top}K`, label: `${top === 5 ? 'Five' : top} kills in ${where(top)}` };
  }
  if (top === 4) return { value: '4K', label: `Four kills in ${where(4)}` };
  const clutch = rows.filter((x) => x.riot.clutch && x.riot.clutch.won === true && num(x.riot.clutch.vs) !== null && x.riot.clutch.vs >= 1)
    .reduce((best, x) => (!best || x.riot.clutch.vs > best.riot.clutch.vs ? x : best), null);
  if (clutch) return { value: `1v${clutch.riot.clutch.vs}`, label: `Clutch won in round ${clutch.n}` };
  if (top === 3) return { value: '3K', label: `Three kills in ${where(3)}` };
  const first = rows.filter((x) => x.riot.firstKill === true).length;
  if (first >= 2) return { value: String(first), label: 'First kills of the round' };
  return null;
}

function lolStandout(r) {
  const sl = r.scoreline || {};
  const game = r.game || {};
  const cs = num(sl.cs);
  const sec = num(game.durationSec);
  const support = /^(support|utility)$/i.test(String(game.role || '').trim());
  if (!support && cs !== null && sec !== null && sec >= 300) {
    const perMin = Math.round((cs / (sec / 60)) * 10) / 10;
    if (perMin >= 6) return { value: perMin.toFixed(1), label: 'CS per minute' };
  }
  const [k, d, a] = [num(sl.kills), num(sl.deaths), num(sl.assists)];
  if (k !== null && d !== null && a !== null && d > 0 && (k + a) / d >= 3) return { value: ratio(k + a, d), label: 'KDA ratio' };
  return null;
}

/** The calm fallback: kills per death, or League's KDA, and a game with no deaths says so. */
function fallbackStandout(r, lol) {
  const sl = r.scoreline || {};
  const [k, d, a] = [num(sl.kills), num(sl.deaths), num(sl.assists)];
  if (k === null || d === null) return null;
  if (lol) {
    if (a === null) return null;
    if (d === 0) return k + a > 0 ? { value: String(k + a), label: 'Kills and assists without dying' } : null;
    return { value: ratio(k + a, d), label: 'KDA ratio' };
  }
  if (d === 0) return k > 0 ? { value: String(k), label: 'Kills without dying' } : null;
  return { value: ratio(k, d), label: 'Kills per death' };
}

/** The one standout number of a review (above), or null. */
function standout(review) {
  const r = review || {};
  if (r.kind !== 'valorant' && r.kind !== 'lol') return null;
  const lol = r.kind === 'lol';
  const s = (lol ? lolStandout(r) : valorantStandout(r)) || fallbackStandout(r, lol);
  return s && said(s.value) && said(s.label) ? { value: s.value, label: s.label } : null;
}

/** [label, value] for each number the review has; an unknown one is left out, never shown as "--". */
function statsOf(pairs) {
  return pairs.filter(([, value]) => value !== null && value !== undefined).map(([label, value]) => [label, value]);
}

/**
 * The Verdict of a Valorant or League review, or null when there is no grade
 * to show: a review still being built (work), one too thin to grade (no
 * score, which the review says in words instead), or one of neither game.
 */
function of(review) {
  const r = review || {};
  if (r.work) return null;
  if (r.kind !== 'valorant' && r.kind !== 'lol') return null;
  const g = r.grade || {};
  const score = num(g.score);
  if (score === null || !LETTERS.has(g.letter)) return null;
  const lol = r.kind === 'lol';
  const game = r.game || {};
  const sl = r.scoreline || {};
  const kda = [sl.kills, sl.deaths, sl.assists].every((v) => num(v) !== null) ? `${sl.kills}/${sl.deaths}/${sl.assists}` : null;
  const join = (parts) => parts.map(said).filter(Boolean).join(DOT);
  const result = RESULT.get(game.result) || game.result || null;
  const hs = num(sl.headshotPct);
  return {
    game: lol ? 'lol' : 'valorant',
    // The map or the champion alone, for the share image's file name.
    title: said(lol ? game.champion : game.map),
    // League's review has no result (lol-review.js): its champion and the
    // game's length, and nothing said about how it ended.
    right: join(lol ? [game.champion, game.duration] : [game.map, game.score, result]),
    letter: g.letter,
    score,
    provisional: !!g.provisional,
    reason: reason(r),
    // The image's line under the grade (standout, above). The page keeps the reason.
    stat: standout(r),
    stats: statsOf(lol
      ? [['K/D/A', kda], ['CS', num(sl.cs)], ['CS at 10', num(sl.csAt10)], ['Ward', num(sl.ward)]]
      : [['K/D/A', kda], ['ACS', num(sl.acs)], ['ADR', num(sl.adr)], ['HS', hs !== null ? `${hs}%` : null]]),
    sub: join(lol ? [game.role, game.mode] : [game.agent, game.mode]),
    // The character the player used, as a path under assets/ the image draws
    // (agent-icons.js), or null, and the image leaves the slot out.
    icon: iconOf(lol ? 'lol' : 'valorant', lol ? game.champion : game.agent),
    at: num(r.at),
  };
}

module.exports = { of, reason, standout, firstClause, LINES, CLAUSE_CUT };
