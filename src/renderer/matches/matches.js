'use strict';

/**
 * The match library: what keeps happening across matches, on which map and
 * agent (hero, champion) it happens, then every match.
 *
 * Everything shown is read from saved reviews. Patterns need two matches of one
 * game before they say anything, and the page says that rather than showing an
 * empty frame, because an empty frame reads as broken. The Valorant list also
 * offers to grade the recent matches of the Riot ID in Settings from Riot's
 * record, and follows that run as main pushes it.
 */

const $ = (id) => document.getElementById(id);
// Every grade here is coloured by its letter through GradeView.gradeTone, the
// same rule the review, the panel and Stats use.
const { el, gradeTone } = window.GradeView;

let game = null;

function fmtWhen(at) {
  const d = new Date(at);
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' }) + ', '
    + d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

function paintTabs(games) {
  const host = $('tabs');
  host.replaceChildren();
  for (const g of games) {
    const b = el('button', 'tab', g.label);
    b.type = 'button';
    b.setAttribute('role', 'tab');
    b.setAttribute('aria-selected', String(g.id === game));
    b.addEventListener('click', () => { game = g.id; paintTabs(games); load(); });
    host.append(b);
  }
}

/**
 * One bar per graded match, oldest on the left.
 *
 * The score sets --h on the bar, and both the fill's height and the number's
 * place read it, so a 95 stands taller than a 77. The number used to sit in
 * the same flex column as the fill, where it could not shrink and the fill
 * could: every grade from about 77 up drew the same bar, and a player climbing
 * through A and S saw a flat line. matches.css takes the number out of that
 * column.
 */
function paintTrend(grades) {
  const host = $('p-trend');
  host.replaceChildren();
  host.hidden = grades.length < 2;
  for (const g of grades.slice().reverse()) {
    const bar = el('div', 'p-bar');
    bar.title = `${fmtWhen(g.at)}: ${g.score} (${g.letter})${g.provisional ? ', provisional' : ''}`;
    bar.style.setProperty('--h', Math.max(4, Math.min(100, g.score)) + '%');
    const fill = el('i', gradeTone(g) + (g.provisional ? ' prov' : ''));
    bar.append(fill, el('span', null, g.score));
    host.append(bar);
  }
}

function paintCats(cats) {
  const host = $('p-cats');
  host.replaceChildren();
  host.hidden = !cats.length;
  for (const c of cats) {
    const box = el('div', 'p-cat');
    box.append(el('b', null, c.average), el('span', null, c.label));
    box.append(el('small', null, `last match ${c.last}`));
    host.append(box);
  }
}

/** A pattern as an insight item, with how often and which way it is going. */
function asItem(p, total) {
  return {
    title: p.title,
    // How often across the RECORDED matches (patterns.js), then the latest
    // sighting in its own words, labelled, so its round numbers are not read
    // as belonging to every match.
    detail: `In ${p.matches} of your last ${total} recorded matches.`
      + (p.examples[0] && p.examples[0].detail ? ` Latest match: ${p.examples[0].detail}` : ''),
    fix: p.fix || null,
    judged: p.judged,
    rounds: [],
    trend: p.trend,
  };
}

function paintPatterns(p) {
  $('p-avg').hidden = p.average === null;
  $('p-avg-num').textContent = p.average === null ? '' : p.average;
  paintTrend(p.grades || []);
  paintCats(p.categories || []);
  const host = $('p-lists');
  host.replaceChildren();
  // THE GRADES ARE OVER EVERY MATCH, THE PATTERNS OVER THE RECORDED ONES. A
  // match graded from Riot's record alone has a grade and nothing to repeat,
  // since Riot records what happened and never why (patterns.js).
  if (!p.enough) {
    $('p-sub').textContent = !p.matches ? 'Play two matches and this shows what keeps happening across them.'
      : p.recorded ? 'One match recorded. After the next one, this shows what repeats.'
        : "Your matches so far are graded from Riot's record, which says what happened and not why. "
          + 'Record two and this shows what repeats.';
    return;
  }
  $('p-sub').textContent = p.fromRiot
    ? `Grades across your last ${p.matches} matches, patterns across the last ${p.recorded} you recorded. A pattern needs two of them to count.`
    : `Across your last ${p.matches} matches. A pattern needs two of them to count.`;
  const view = window.GradeView.insightLists({
    mistakes: p.mistakes.map((x) => asItem(x, p.recorded)),
    strengths: p.strengths.map((x) => asItem(x, p.recorded)),
    missed: p.missed.map((x) => asItem(x, p.recorded)),
  }, {
    mistakesTitle: 'Your most serious repeated mistakes',
    strengthsTitle: 'What you keep doing well',
    missedTitle: 'What you keep missing',
    onRound: false,
    limit: 5,
    empty: 'Nothing has repeated across your matches yet.',
  });
  // Which way each one is going, beside its title. Rising is bad news for a
  // mistake and good news for a strength.
  const lists = [['mistakes', true], ['strengths', false], ['missed', true]];
  const blocks = view.querySelectorAll('.gv-block');
  let b = 0;
  for (const [key, bad] of lists) {
    if (!p[key].length) continue;
    const nodes = blocks[b++].querySelectorAll('.gv-item');
    nodes.forEach((node, i) => {
      const t = p[key][i] && p[key][i].trend;
      if (!t) return;
      const good = t === 'steady' ? null : (t === 'falling') === bad;
      node.querySelector('.gv-item-head').append(el('span',
        'p-trendword ' + (good === null ? 'steady' : good ? 'better' : 'worse'),
        t === 'steady' ? 'steady' : t === 'rising' ? 'more often lately' : 'less often lately'));
    });
  }
  host.append(view);
}

// ── The breakdown ───────────────────────────────────────────────────────────
// Painted and sorted here, never counted: breakdown.js counts, for the reason
// review.js gives, that a renderer doing arithmetic is a second place for the
// numbers to disagree. Formatting a rate as "57%" or "4 of 7" is all it does.

const DOT = '  ·  ';
const bstate = { dim: {}, queue: {}, sort: {}, open: null };
let lastBreakdown = null;
let bOpened = null;      // { id, row, holder } the row open now (toggleRow)
/** --t-med in ms, read from theme.css so the timer and the reveal (ui.css) agree. */
function revealMs() {
  try {
    const v = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--t-med'));
    return Number.isFinite(v) ? v : 220;
  } catch { return 220; }
}

const col = (key, title, kind, o = {}) => ({ key, title, kind, ...o });
// K/D/A NEEDS ITS EIGHT CHARACTERS. "22/17/11" is 60px of Geist Mono, and at
// the main window's narrowest (960 wide) the map cut's columns measured 58px,
// where the assists were cut to an ellipsis. Its track never goes under this.
const KDA_MIN = 64;
const COLS = {
  valorant: {
    map: [
      col('label', 'Map', 'label'), col('matches', 'Matches', 'int'), col('record', 'Record', 'record'),
      col('winRate', 'Win %', 'rate', { unit: 'matches won' }), col('grade', 'Grade', 'grade'),
      col('stats.attack', 'Attack', 'rate', { unit: 'attack rounds won', opt: true }),
      col('stats.defence', 'Defence', 'rate', { unit: 'defence rounds won', opt: true }),
      col('stats.firstDeath', 'First death', 'rate', { unit: 'rounds', opt: true }),
      col('stats.kda', 'K/D/A', 'kda', { opt: true, min: KDA_MIN }),
    ],
    agent: [
      col('label', 'Agent', 'label'), col('matches', 'Matches', 'int'), col('record', 'Record', 'record'),
      col('winRate', 'Win %', 'rate', { unit: 'matches won' }), col('grade', 'Grade', 'grade'),
      col('stats.kda', 'K/D/A', 'kda', { opt: true, min: KDA_MIN }), col('stats.acs', 'ACS', 'avg', { opt: true }),
      col('stats.firstKill', 'First kill', 'rate', { unit: 'rounds', opt: true }),
      col('stats.firstDeath', 'First death', 'rate', { unit: 'rounds', opt: true }),
    ],
  },
  rivals: {
    map: [
      col('label', 'Map', 'label'), col('matches', 'Matches', 'int'), col('record', 'Record', 'record'),
      col('winRate', 'Win %', 'rate', { unit: 'matches won' }), col('grade', 'Grade', 'grade'),
      col('stats.kda', 'K/D/A', 'kda', { opt: true, min: KDA_MIN }), col('stats.damage', 'Damage', 'avg', { opt: true }),
    ],
    hero: [
      col('label', 'Hero', 'label'), col('matches', 'Matches', 'int'), col('record', 'Record', 'record'),
      col('winRate', 'Win %', 'rate', { unit: 'matches won' }), col('grade', 'Grade', 'grade'),
      col('stats.kda', 'K/D/A', 'kda', { opt: true, min: KDA_MIN }), col('stats.damage', 'Damage', 'avg', { opt: true }),
      col('stats.duty', 'Role duty', 'duty', { opt: true }), col('stats.accuracy', 'Accuracy', 'pctavg', { opt: true }),
    ],
  },
  lol: {
    champion: [
      col('label', 'Champion', 'label'), col('matches', 'Games', 'int'), col('grade', 'Grade', 'grade'),
      col('stats.kda', 'KDA', 'kd'), col('stats.csPerMin', 'CS / min', 'dec1', { opt: true }),
      col('stats.visionPerMin', 'Vision / min', 'dec1', { opt: true }),
      col('stats.deathsPer10', 'Deaths / 10', 'dec1', { opt: true }),
    ],
  },
};

const get = (o, key) => key.split('.').reduce((v, k) => (v === null || v === undefined ? v : v[k]), o);
const matchesWord = (n, lol) => `${n} ${lol ? (n === 1 ? 'game' : 'games') : (n === 1 ? 'match' : 'matches')}`;
const signed = (n) => (n > 0 ? `+${n}` : String(n));
const recordText = (r) => `${r.won}-${r.lost}${r.drawn ? `-${r.drawn}` : ''}`;
const rateText = (r) => (r.pct !== null ? `${r.pct}% (${r.count} of ${r.n})` : `${r.count} of ${r.n}`);
const kdaText = (v) => `${v.kills}/${v.deaths}/${v.assists}`;

/**
 * "K/D/A 18/14/5" for a line of averages, or null. It is over only the
 * matches whose line had assists, so where that is fewer than the line's own
 * sample it says its own.
 */
function kdaLine(v, sample) {
  if (!v || v.value === null || v.value === undefined) return null;
  return `K/D/A ${kdaText(v)}` + (v.n < sample ? ` (${matchesWord(v.n, false)})` : '');
}

function none(td) { td.textContent = '--'; td.classList.add('none'); return td; }

function cell(c, row) {
  const v = get(row, c.key);
  const td = el('div', 'b-td' + (c.kind === 'label' ? ' b-name' : '') + (c.opt ? ' b-opt' : ''));
  td.setAttribute('role', c.kind === 'label' ? 'rowheader' : 'cell');
  const over = (n) => `over ${matchesWord(n, false)}`;
  switch (c.kind) {
    case 'label':
      td.append(el('span', null, row.label));
      if (row.sub) td.append(el('small', null, row.sub));
      // A long Rivals map or hero name is cut to fit; the whole one on hover.
      td.title = row.sub ? `${row.label}, ${row.sub}` : row.label;
      return td;
    case 'int':
      td.textContent = String(v);
      return td;
    case 'record':
      if (!v || !v.known) return none(td);
      td.textContent = recordText(v);
      td.title = `${v.won} won, ${v.lost} lost${v.drawn ? `, ${v.drawn} drawn` : ''}`;
      return td;
    case 'rate':
      if (!v || !v.n) return none(td);
      td.textContent = v.pct !== null ? `${v.pct}%` : `${v.count} of ${v.n}`;
      if (v.pct === null) td.classList.add('raw');
      td.title = `${v.count} of ${v.n} ${c.unit || ''}`.trim();
      return td;
    case 'grade': {
      if (!v || v.avg === null) {
        none(td);
        if (v && v.provisional) td.title = 'Only provisional grades so far';
        return td;
      }
      const wrap = el('span', 'b-grade');
      wrap.append(el('span', null, String(v.avg)),
        el('span', 'b-letter ' + gradeTone({ score: v.avg, letter: v.letter }), v.letter));
      td.append(wrap);
      td.title = `Average of ${v.n} graded ${v.n === 1 ? 'match' : 'matches'}`
        + (v.provisional ? `, ${v.provisional} provisional left out` : '');
      return td;
    }
    case 'kd':
      if (!v || v.value === null || v.value === undefined) return none(td);
      td.textContent = v.value.toFixed(2);
      td.title = v.kills !== undefined ? `${v.kills} kills, ${v.deaths} deaths, ${over(v.n)}` : over(v.n);
      return td;
    case 'kda':
      // An average match, as a scoreboard prints it. The K/D it sorts on, and
      // how many matches it is over, are on hover.
      if (!v || v.value === null || v.value === undefined) return none(td);
      td.textContent = kdaText(v);
      td.title = `K/D ${v.value.toFixed(2)} ${over(v.n)}`;
      return td;
    case 'duty':
      if (!v || v.value === null || v.value === undefined) return none(td);
      td.append(el('span', null, v.value.toLocaleString('en-US')), el('small', 'b-unit', v.label.toLowerCase()));
      td.title = `${v.label}, average ${over(v.n)}`;
      return td;
    default:
      if (!v || v.value === null || v.value === undefined) return none(td);
      td.textContent = c.kind === 'dec1' ? v.value.toFixed(1) : c.kind === 'pctavg' ? `${v.value}%` : v.value.toLocaleString('en-US');
      td.title = over(v.n);
      return td;
  }
}

/**
 * Where a row sorts in a column: [tier, value].
 *
 * A RATE UNDER ITS FLOOR IS "1 of 1", NOT 100%. Sorted on count over n it
 * outranked every real rate, so a map won once sat above one won 8 of 10. So
 * a row with a percentage is tier 2 and sorts on it, a row under the floor is
 * tier 1 and sorts on count over n among its own kind, and a row with nothing
 * in the column is tier 0. The record is held to the win rate's floor, the
 * breakdown's own winRate.pct. A tier never flips with the direction: the
 * rows the column can rank come first either way.
 */
function sortRank(c, row) {
  const v = get(row, c.key);
  switch (c.kind) {
    case 'label': return [2, row.label.toLowerCase()];
    case 'int': return [2, v];
    case 'record':
      if (!v || !v.known) return [0, 0];
      return [row.winRate && row.winRate.pct !== null ? 2 : 1, v.won / v.known];
    case 'rate':
      if (!v || !v.n) return [0, 0];
      return v.pct !== null ? [2, v.pct] : [1, v.count / v.n];
    case 'grade': return v && v.avg !== null ? [2, v.avg] : [0, 0];
    default: return v && typeof v.value === 'number' ? [2, v.value] : [0, 0];
  }
}

function compareRows(c, dir, x, y) {
  const [tx, a] = sortRank(c, x);
  const [ty, z] = sortRank(c, y);
  if (tx !== ty) return ty - tx;
  const cmp = typeof a === 'string' ? a.localeCompare(z) : a - z;
  return (dir === 'asc' ? cmp : -cmp) || y.matches - x.matches || x.label.localeCompare(y.label);
}

function crossText(c) {
  return `${c.label} ${c.matches}`
    + (c.record && c.record.known ? ` (${recordText(c.record)})` : '')
    + (c.grade && c.grade.avg !== null ? `, avg ${c.grade.avg}` : '');
}

function vsText(v, dim) {
  return [
    v.grade !== null ? `Grade ${signed(v.grade)}` : null,
    v.winRate !== null ? `Win rate ${signed(v.winRate)} pts` : null,
    v.firstDeath !== null && dim === 'map' ? `First deaths ${signed(v.firstDeath)} pts` : null,
  ].filter(Boolean).join(DOT);
}

/** The opened row's lines: [label, text, fix?]. Each only where it has data. */
function detailLines(gameId, dim, row, dims) {
  const s = row.stats || {};
  const out = [];
  const d = dims.find((x) => x.key === dim) || { many: 'others' };
  if (gameId === 'valorant') {
    const sides = [s.attack && s.attack.n ? `Attack ${rateText(s.attack)}` : null,
      s.defence && s.defence.n ? `Defence ${rateText(s.defence)}` : null].filter(Boolean);
    if (sides.length) out.push(['Rounds won', sides.join(DOT)]);
    if (s.pistol && s.pistol.n) out.push(['Pistol rounds', `Won ${s.pistol.count} of ${s.pistol.n}`]);
    const spike = [s.postPlant && s.postPlant.n ? `Won ${s.postPlant.count} of ${s.postPlant.n} attack rounds after the plant` : null,
      s.retake && s.retake.n ? `${s.retake.count} of ${s.retake.n} retakes won on defence` : null].filter(Boolean);
    if (spike.length) out.push(['Spike down', spike.join(DOT)]);
    if (s.firstKill && s.firstKill.n) out.push(['Openings', `First kill ${rateText(s.firstKill)}${DOT}First death ${rateText(s.firstDeath)}`]);
    if (s.traded && s.traded.n) out.push(['Trades', `${s.traded.count} of ${s.traded.n} deaths traded by a teammate${s.traded.pct !== null ? ` (${s.traded.pct}%)` : ''}`]);
    if (s.survived && s.survived.n) out.push(['Survival', `Alive at the end of ${s.survived.count} of ${s.survived.n} rounds${s.survived.pct !== null ? ` (${s.survived.pct}%)` : ''}`]);
    const sample = Math.max((s.kd && s.kd.n) || 0, (s.acs && s.acs.n) || 0);
    const board = [s.acs && s.acs.value !== null ? `ACS ${s.acs.value}` : null, s.adr && s.adr.value !== null ? `ADR ${s.adr.value}` : null,
      kdaLine(s.kda, sample), s.kd && s.kd.value !== null ? `K/D ${s.kd.value.toFixed(2)}` : null,
      s.hs && s.hs.value !== null ? `Headshot ${s.hs.value}%` : null].filter(Boolean);
    if (board.length) out.push(['Scoreboard', board.join(DOT) + DOT + matchesWord(sample, false)]);
  }
  if (gameId === 'rivals') {
    const line = [kdaLine(s.kda, row.matches), s.kd && s.kd.value !== null ? `K/D ${s.kd.value.toFixed(2)}` : null,
      s.damage && s.damage.value !== null ? `Damage ${s.damage.value.toLocaleString('en-US')}` : null,
      s.duty ? `${s.duty.label} ${s.duty.value.toLocaleString('en-US')}` : null,
      s.accuracy && s.accuracy.value !== null ? `Accuracy ${s.accuracy.value}%` : null].filter(Boolean);
    if (line.length) out.push(['Averages', line.join(DOT)]);
  }
  if (gameId === 'lol') {
    const line = [s.kda && s.kda.value !== null ? `KDA ${s.kda.value.toFixed(2)}` : null,
      s.csPerMin && s.csPerMin.value !== null ? `CS a minute ${s.csPerMin.value.toFixed(1)}` : null,
      s.visionPerMin && s.visionPerMin.value !== null ? `Vision a minute ${s.visionPerMin.value.toFixed(1)}` : null,
      s.deathsPer10 && s.deathsPer10.value !== null ? `Deaths per 10 minutes ${s.deathsPer10.value.toFixed(1)}` : null].filter(Boolean);
    if (line.length) out.push(['Averages', line.join(DOT)]);
  }
  if (row.cross && row.cross.length) {
    const title = dim === 'map' ? (gameId === 'rivals' ? 'Heroes here' : 'Agents here') : 'Maps';
    out.push([title, row.cross.slice(0, 6).map(crossText).join(DOT)]);
  }
  if (row.spots) {
    if (row.spots.callout) {
      out.push(['Where you die', `${row.spots.callout.spot}, ${row.spots.callout.deaths} of the ${row.spots.callout.placed} deaths the coach placed here`]);
    } else if (row.spots.top && row.spots.top.length) {
      out.push(['Where you die', row.spots.top.map((t) => `${t.spot} ${t.deaths}`).join(DOT) + `${DOT}of ${row.spots.placed} placed`]);
    }
  }
  // Out of the row's recorded matches: one graded from Riot's record alone
  // repeats nothing (breakdown.js repeated()).
  if (row.mistake) out.push(['Repeated here', `${row.mistake.title}, in ${row.mistake.matches} of ${row.mistake.of} recorded matches.`, row.mistake.fix]);
  if (row.strength) out.push(['Goes well', `${row.strength.title}, in ${row.strength.matches} of ${row.strength.of} recorded matches.`]);
  if (row.vsRest) {
    const text = vsText(row.vsRest, dim);
    if (text) out.push([`Against your other ${d.many}`, text]);
  }
  return out;
}

function detail(b, dim, row) {
  // A row of its own with one cell across every column, so the table stays a
  // table to a screen reader: a region between two rows is not one. The row
  // opens by height (.reveal, ui.css), its cell the clip and the box in it.
  const holder = el('div', 'b-detail-row reveal');
  holder.setAttribute('role', 'row');
  const cellEl = el('div', 'b-detail-cell reveal-clip');
  cellEl.setAttribute('role', 'cell');
  cellEl.setAttribute('aria-colspan', String(((COLS[b.game] || {})[dim] || []).length || 1));
  cellEl.setAttribute('aria-label', `${row.label} in detail`);
  const box = el('div', 'b-detail');
  cellEl.append(box);
  holder.append(cellEl);
  for (const [label, text, fix] of detailLines(b.game, dim, row, b.dims)) {
    box.append(el('div', 'b-dt', label));
    const dd = el('p', 'b-dd', text);
    if (fix) {
      const f = el('span', 'b-fix');
      f.append(el('span', 'gv-fix-label', 'Fix'), document.createTextNode(fix));
      dd.append(f);
    }
    box.append(dd);
  }
  const checked = row.stats && typeof row.stats.checked === 'number' ? row.stats.checked : null;
  if (b.game === 'valorant' && checked !== null && checked < row.matches) {
    box.append(el('p', 'b-src', checked
      ? `Round numbers come from the ${checked} of these ${row.matches} matches checked against Riot's record.`
      : "None of these matches is checked against Riot's record yet, so there are no round numbers."));
  }
  return holder;
}

/** The line under the heading: the sample, and what is not in the rows of `dim`. */
function subLine(b, dim) {
  if (!b.matches) return '';
  const lol = b.game === 'lol';
  const parts = [`Across ${matchesWord(b.matches, lol)}${b.queue && b.queue !== 'All' ? ` in ${b.queue}` : ''}.`];
  if (b.game === 'valorant' && b.checked < b.matches) {
    parts.push(b.checked
      ? `Round numbers come from the ${matchesWord(b.checked, false)} checked against Riot's record.`
      : "None of these matches is checked against Riot's record yet, so there are no round numbers.");
  }
  // A MATCH WITH NOTHING READ FOR THIS CUT IS IN NO ROW, so the rows add up to
  // fewer than the count above. Said, or it reads as a miscount. When it is
  // every match there are no rows at all, and the empty line says why.
  const d = (b.dims || []).find((x) => x.key === dim);
  const unknown = (b.unknown && b.unknown[dim]) || 0;
  if (d && unknown > 0 && unknown < b.matches) {
    parts.push(`${matchesWord(unknown, lol)} with no ${d.one} read ${unknown === 1 ? 'is' : 'are'} not in a row.`);
  }
  if (b.left) parts.push(`${b.left} in other modes ${b.left === 1 ? 'is' : 'are'} left out, since ${b.left === 1 ? 'it is' : 'they are'} played on other rules.`);
  return parts.join(' ');
}

/** Why the table is empty: nothing saved yet, or nothing saved has this cut read. */
function emptyLine(b, dim) {
  const d = (b.dims || []).find((x) => x.key === dim);
  if (b.matches && d) return `None of these ${b.game === 'lol' ? 'games' : 'matches'} has a confirmed ${d.one} yet.`;
  // Saved matches, all in modes the breakdown leaves out: said, rather than
  // asking for a match over a library that has some.
  if (!b.matches && b.left) {
    const noun = b.game === 'lol' ? ['game', 'games'] : ['match', 'matches'];
    const what = b.left === 1 ? `Your one saved ${noun[0]} is in a mode` : `All ${b.left} of your saved ${noun[1]} are in modes`;
    return `${what} played on other rules${b.game === 'valorant' ? ' (Spike Rush and the like)' : ''}, `
      + `so ${b.left === 1 ? 'it is not' : 'none is'} broken down here.`;
  }
  return b.game === 'valorant'
    ? 'Nothing to break down yet. Record a match, or grade your recent matches from Riot below.'
    : 'Nothing to break down yet.';
}

/**
 * EVERY REPAINT REBUILDS THE SECTION, so the control that had the keyboard is
 * found again by its data-focus key and given it back. Without this, Enter on
 * a row opened it and dropped focus to the top of the page, so a keyboard
 * player could open one row and then had to tab back down to reach the next.
 * A row opens in place since 8.2 (toggleRow) and repaints nothing; a sort, a
 * cut or a queue still does.
 */
function paintBreakdown(b) {
  const host = $('breakdown');
  const active = document.activeElement;
  const had = active && active !== host && host.contains(active) && active.dataset ? active.dataset.focus : null;
  drawBreakdown(b);
  if (!had) return;
  const again = [...host.querySelectorAll('[data-focus]')].find((n) => n.dataset.focus === had);
  if (again) again.focus();
}

function drawBreakdown(b) {
  lastBreakdown = b;
  const host = $('breakdown');
  if (!b || !Array.isArray(b.dims) || !b.dims.length) {
    // ON ITS OWN PAGE (8.1) the breakdown says it has nothing yet, rather than
    // leaving a blank page under its title.
    const own = document.documentElement.dataset.section === 'breakdown';
    host.hidden = !own;
    if (own) {
      for (const id of ['b-dims', 'b-queues', 'b-headline', 'b-note']) $(id).hidden = true;
      $('b-table').replaceChildren();
      $('b-sub').textContent = '';
      $('b-empty').textContent = 'Nothing to break down yet. Every saved review of this game is counted here, by map and by agent.';
      $('b-empty').hidden = false;
    }
    return;
  }
  host.hidden = false;
  const dims = b.dims;
  let dim = bstate.dim[b.game];
  if (!dims.some((d) => d.key === dim)) dim = bstate.dim[b.game] = dims[0].key;

  const dimsHost = $('b-dims');
  dimsHost.replaceChildren();
  // Nothing saved yet is one empty line, with no switch that changes nothing.
  dimsHost.hidden = dims.length < 2 || !b.matches;
  for (const d of dims) {
    const btn = el('button', null, d.label);
    btn.type = 'button';
    btn.dataset.focus = `dim:${d.key}`;
    btn.setAttribute('role', 'tab');
    btn.setAttribute('aria-selected', String(d.key === dim));
    btn.addEventListener('click', () => { bstate.dim[b.game] = d.key; bstate.open = null; paintBreakdown(lastBreakdown); });
    dimsHost.append(btn);
  }

  const qHost = $('b-queues');
  qHost.replaceChildren();
  const queues = Array.isArray(b.queues) ? b.queues : [];
  qHost.hidden = queues.length < 2;
  if (queues.length >= 2) {
    // League has no All (breakdown.js lol()): its modes are played on other maps.
    for (const q of b.allQueue === false ? queues : [{ label: 'All', matches: b.total }, ...queues]) {
      const chip = el('button', 'b-chip', q.label);
      chip.type = 'button';
      chip.dataset.focus = `queue:${q.label}`;
      chip.setAttribute('aria-pressed', String(q.label === b.queue));
      chip.append(el('small', null, q.matches));
      chip.addEventListener('click', () => { bstate.queue[b.game] = q.label; bstate.open = null; loadBreakdown(); });
      qHost.append(chip);
    }
  }

  $('b-sub').textContent = subLine(b, dim);
  const hl = $('b-headline');
  hl.replaceChildren();
  const calls = Array.isArray(b.headline) ? b.headline : [];
  for (const h of calls) {
    const card = el('div', 'b-call');
    card.append(el('span', null, h.title), el('b', null, h.label), el('small', null, h.detail));
    hl.append(card);
  }
  hl.hidden = !calls.length;
  $('b-note').hidden = !b.note;
  $('b-note').textContent = b.note || '';

  const rows = (b.rows && b.rows[dim]) || [];
  const table = $('b-table');
  table.replaceChildren();
  table.hidden = !rows.length;
  $('b-empty').hidden = rows.length > 0;
  $('b-empty').textContent = emptyLine(b, dim);
  if (!rows.length) return;

  const cols = (COLS[b.game] || {})[dim] || [];
  const track = (c, narrow) => (c.kind === 'label' ? `minmax(${narrow ? 96 : 112}px, 1.6fr)` : `minmax(${c.min || 46}px, 1fr)`);
  table.style.setProperty('--cols', cols.map((c) => track(c, false)).join(' '));
  table.style.setProperty('--cols-narrow', cols.filter((c) => !c.opt).map((c) => track(c, true)).join(' '));
  const sortKey = `${b.game}:${dim}`;
  const s = bstate.sort[sortKey] || { key: 'matches', dir: 'desc' };

  const head = el('div', 'b-tr b-th');
  head.setAttribute('role', 'row');
  for (const c of cols) {
    const th = el('div', 'b-th-cell' + (c.opt ? ' b-opt' : ''));
    th.setAttribute('role', 'columnheader');
    th.setAttribute('aria-sort', s.key === c.key ? (s.dir === 'asc' ? 'ascending' : 'descending') : 'none');
    const btn = el('button', 'b-sort' + (c.kind === 'label' ? ' left' : ''), c.title);
    btn.type = 'button';
    btn.dataset.focus = `sort:${c.key}`;
    btn.addEventListener('click', () => {
      const dir = s.key === c.key ? (s.dir === 'asc' ? 'desc' : 'asc') : (c.kind === 'label' ? 'asc' : 'desc');
      bstate.sort[sortKey] = { key: c.key, dir };
      paintBreakdown(lastBreakdown);
    });
    th.append(btn);
    head.append(th);
  }
  table.append(head);

  const sc = cols.find((c) => c.key === s.key) || cols[1];
  const sorted = rows.slice().sort((x, y) => compareRows(sc, s.dir, x, y));
  bOpened = null;
  for (const row of sorted) {
    const id = `${sortKey}:${row.key}`;
    const open = bstate.open === id;
    const r = el('div', 'b-tr b-row');
    r.dataset.focus = `row:${id}`;
    r.setAttribute('role', 'row');
    r.setAttribute('tabindex', '0');
    r.setAttribute('aria-expanded', String(open));
    for (const c of cols) r.append(cell(c, row));
    const toggle = () => toggleRow(r, id, () => detail(b, dim, row));
    r.addEventListener('click', toggle);
    r.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); }
    });
    table.append(r);
    // Drawn open, as it was before this repaint: no motion.
    if (open) {
      const holder = detail(b, dim, row);
      holder.classList.add('open');
      table.append(holder);
      bOpened = { id, row: r, holder };
    }
  }
}

/*
 * A ROW OPENS IN PLACE (8.2). Opening one used to repaint the whole section,
 * so the table was built again and the detail just appeared. Now the detail
 * row is put after its row and grows from nothing to its height (.reveal,
 * ui.css), the one open before closes the same way and is taken out once
 * closed, and the rows, and the keyboard's place on them, stay as they are.
 */
function collapseRow(open) {
  open.row.setAttribute('aria-expanded', 'false');
  const h = open.holder;
  h.classList.remove('open');
  clearTimeout(h.closing);
  h.closing = setTimeout(() => h.remove(), revealMs());
}
function toggleRow(r, id, make) {
  const was = bOpened;
  if (was) collapseRow(was);
  bOpened = null;
  if (was && was.id === id) { bstate.open = null; return; }
  bstate.open = id;
  r.setAttribute('aria-expanded', 'true');
  const holder = make();
  r.after(holder);
  void holder.offsetHeight;   // at 0fr first, or there is nothing to grow from
  holder.classList.add('open');
  bOpened = { id, row: r, holder };
}

async function loadBreakdown() {
  const b = await window.occlara.getBreakdown(game, { queue: bstate.queue[game] || 'All' }).catch(() => null);
  paintBreakdown(b && !b.error ? b : null);
}

// ── Grading recent matches from Riot's record ───────────────────────────────
let backfill = null;
let riotId = '';

function paintBf() {
  const box = $('bf');
  box.hidden = game !== 'valorant';
  if (box.hidden) return;
  const s = backfill || { state: 'idle' };
  const btn = $('bf-go');
  const connected = riotId.includes('#');
  // A RUN BELONGS TO ITS ACCOUNT. Once the Riot ID changes, the last run's
  // outcome ("Graded 4 recent matches") is about another account's matches,
  // and a run still winding down for the old ID is not grading this one, so
  // neither is shown, nor holds the button, until a status names this ID.
  const mine = connected && String(s.account || '').trim().toLowerCase() === riotId.toLowerCase();
  const busy = mine && (s.state === 'listing' || s.state === 'waiting' || s.state === 'grading');
  btn.disabled = busy;
  btn.textContent = !connected ? 'Add your Riot ID' : busy ? 'Grading' : 'Grade my recent matches';
  const text = mine && s.state !== 'idle' ? (s.message || '') : '';
  $('bf-status').textContent = text;
  $('bf-status').title = text;
}

/** The Riot ID in Settings, read again, and the grading line repainted on it. */
async function refreshRiotId() {
  const cfg = await window.occlara.getConfig().catch(() => null);
  if (cfg) riotId = String(cfg.riotId || '').trim();
  paintBf();
}

$('bf-go').addEventListener('click', async () => {
  if (!riotId.includes('#')) { window.occlara.openSettings(); return; }
  backfill = await window.occlara.startBackfill().catch(() => backfill);
  paintBf();
});

/**
 * One match: a card holding two buttons side by side, the row, which opens its
 * review, and the eye, which opens the AI log on its frames where main says it
 * is still kept (shared/log-eye.js). Siblings, never one inside the other,
 * which is what the "Ask" this row used to carry was: clicked, it was the
 * row's click too, and a screen reader read it into the row's name. Asking
 * the coach about a match is on its review page.
 *
 * @param gutter  the list has eyes, so a row without one keeps its room and
 *   the grades still line up down the list
 */
function row(m, gutter) {
  const item = el('div', 'm-item');
  item.setAttribute('role', 'listitem');
  const b = el('button', 'm-row');
  b.type = 'button';
  const main = el('div', 'm-main');
  const top = el('div', 'm-top');
  top.append(el('span', 'm-title', m.title || 'Unknown'));
  if (m.result) {
    top.append(el('span', 'm-res ' + (/vict|win/i.test(m.result) ? 'win' : /defeat|loss/i.test(m.result) ? 'loss' : ''),
      [m.result, m.score].filter(Boolean).join(' ')));
  }
  main.append(top);
  main.append(el('div', 'm-meta', [fmtWhen(m.at), m.map, m.mode,
    m.source === 'riot' ? "from Riot's record" : m.verified ? "checked against Riot's record" : null]
    .filter(Boolean).join('  ·  ')));
  if (m.topMistake) main.append(el('div', 'm-top-mistake', `Top mistake: ${m.topMistake}`));

  const grade = el('div', 'm-grade');
  const g = m.grade;
  grade.append(el('span', 'm-score', g ? g.score : '--'));
  grade.append(el('span', 'm-letter ' + (g ? gradeTone(g) : 'none'), g ? g.letter : '?'));
  if (g && g.provisional) grade.title = 'Provisional: some of the record was missing';
  b.append(main, grade);
  b.addEventListener('click', () => window.occlara.openReview(m.id));
  item.append(b);
  const eye = window.LogEye.button(m.aiLog, () => window.occlara.openAiLog(m.id));
  if (eye) item.append(eye);
  else if (gutter) {
    const gap = el('span', 'm-eye-gap');
    gap.setAttribute('aria-hidden', 'true');
    item.append(gap);
  }
  return item;
}

/**
 * WON AND LOST BESIDE THE TITLE, "2:1", on the list page alone: the Patterns
 * and Breakdown pages are titled for what they count, and a record above
 * them would read as theirs. The preload counts it (home-model.js winLoss)
 * by the result tests row() colours by. Hidden when no match has a result,
 * as no League review does, rather than reading 0:0 as a record.
 */
function paintWinLoss(rows) {
  const box = $('wl');
  const wl = document.documentElement.dataset.section === 'list' ? window.occlara.winLoss(rows) : null;
  box.hidden = !wl || wl.wins + wl.losses + wl.draws === 0;
  if (box.hidden) return;
  const say = (n, one, many) => `${n} ${n === 1 ? one : many}`;
  const record = `${say(wl.wins, 'win', 'wins')}, ${say(wl.losses, 'loss', 'losses')}`;
  box.querySelector('.wl-w').textContent = String(wl.wins);
  box.querySelector('.wl-l').textContent = String(wl.losses);
  box.querySelector('.wl-sr').textContent = record;
  box.title = `${record}${wl.draws ? `, ${say(wl.draws, 'draw', 'draws')}` : ''}.`
    + (wl.unknown ? ` ${say(wl.unknown, 'match', 'matches')} with no result ${wl.unknown === 1 ? 'is' : 'are'} not counted.` : '');
}

async function load() {
  const [list, patterns, cfg] = await Promise.all([
    window.occlara.listReviews(game), window.occlara.getPatterns(game),
    window.occlara.getConfig().catch(() => null),
  ]);
  riotId = String((cfg && cfg.riotId) || '').trim();
  const rows = Array.isArray(list) ? list : [];
  const host = $('list');
  host.replaceChildren();
  const eyes = rows.some((m) => m.aiLog === 'kept' || m.aiLog === 'gone');
  rows.forEach((m, i) => {
    const r = row(m, eyes);
    r.style.animationDelay = Math.min(i * 40, 360) + 'ms';
    host.append(r);
  });
  $('empty').hidden = rows.length > 0;
  paintWinLoss(rows);
  paintPatterns(patterns || { matches: 0, enough: false, grades: [], categories: [], average: null });
  paintBf();
  await loadBreakdown();
}

// A page of the main window has no window of its own to close: the sidebar is
// how a player leaves it.
const closeWindow = () => { if (!(window.occlaraEmbedded && window.occlaraEmbedded())) window.occlara.close(); };
$('close').addEventListener('click', closeWindow);
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeWindow(); });

// ONE SURFACE, THREE PAGES (8.1). As a page of the main window the library
// shows one section, named by its query, and is titled for it.
const SECTION_TITLES = { list: 'Matches', patterns: 'Patterns', breakdown: 'Breakdown' };
{
  const title = SECTION_TITLES[document.documentElement.dataset.section];
  const h = document.querySelector('.sheet > header .h-brand h2');
  if (title && h) { h.textContent = title; document.title = `Occlara ${title}`; }
}

(async () => {
  const state = await window.occlara.getState().catch(() => null);
  const games = window.occlara.games();
  game = (state && state.gameId) || (games[0] && games[0].id) || 'valorant';
  paintTabs(games);
  await load();
  backfill = await window.occlara.getBackfill().catch(() => null);
  paintBf();
  // CONNECT IN SETTINGS IS WHAT STARTS A RUN, usually while this window is
  // open, and the Riot ID was read when the list loaded. Read it again with
  // each push, or the button kept saying "Add your Riot ID" under a run that
  // was already grading, until the first saved match reloaded the list.
  window.occlara.onBackfill((s) => {
    backfill = s;
    refreshRiotId();
  });
  // AN ID EDITED IN SETTINGS WITH NO RUN BEHIND IT PUSHES NOTHING HERE, and
  // the line went on naming the last ID's outcome until the list reloaded.
  // Settings is another window, so coming back to this one reads it again.
  window.addEventListener('focus', () => { refreshRiotId(); });
  // A review saved or improved while this is open (Riot's record landing a few
  // minutes after the match, or a match graded from it) repaints the list, the
  // patterns and the breakdown.
  window.occlara.onReviews(() => load());
  window.occlara.onGame((g) => { if (g && g.id) { game = g.id; paintTabs(games); load(); } });
  console.log('[matches] ready');
})();
