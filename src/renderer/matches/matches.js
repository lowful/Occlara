'use strict';

/**
 * The match library: what keeps happening across matches, on which map and
 * agent (champion) it happens, then every match.
 *
 * Everything shown is read from saved reviews. Patterns need two matches of one
 * game before they say anything, and the page says that rather than showing an
 * empty frame, because an empty frame reads as broken. The list page (9.1)
 * leads with the grade trend across the top and when the player plays best,
 * then every match as a simple row with a menu that can delete it. A run
 * grading recent matches from Riot's record (Connect in Settings) is shown
 * as one line while main pushes it.
 */

const $ = (id) => document.getElementById(id);
// Every grade here is coloured by its letter through GradeView.gradeTone, the
// same rule the review, the panel and Stats use.
const { el, gradeTone } = window.GradeView;

let game = null;

/*
 * MOTION (8.9.2, shared/motion.js). An entrance plays ONCE PER VISIT of the
 * page, keyed on the host that stays (a list painted again on a refresh is
 * new elements in the same host, so it never plays twice), only once the
 * page is on screen, and not at all under reduced motion. fn finds what to
 * move when it runs, so a repaint in between moves what is there; the
 * classes come off once played, so nothing replays when the page shows again.
 */
const M = window.Motion || null;
const SETTLE_MS = 380 + 6 * 40 + 420 + 120;
function entrance(host, key, fn) {
  if (!M || !host || !M.once(host, key) || M.reduced()) return;
  M.whenShown(() => {
    if (M.reduced()) return;
    const undo = fn();
    if (typeof undo === 'function') setTimeout(undo, SETTLE_MS);
  });
}
/** Format a number on its way as the final one is written: as many decimals. */
function likeFormat(v) {
  const s = String(v);
  const dec = s.includes('.') ? s.split('.')[1].length : 0;
  return (n) => (dec ? n.toFixed(dec) : String(Math.round(n)));
}
/*
 * A RESULT COUNTS UP. A whole number is counted in CSS (matches.css
 * .m-counting, @property --m-n, as the review's score is): its real number
 * stays the text the whole time and the count is drawn over it, ending on it.
 * A decimal, which counter() cannot draw, is counted by Motion.countUp.
 */
function countUp(el, value) {
  const v = Number(value);
  if (!el || !Number.isFinite(v)) return;
  if (Number.isInteger(v) && v >= 0) {
    el.style.setProperty('--to', String(v));
    el.classList.add('m-counting');
    setTimeout(() => el.classList.remove('m-counting'), 800 + 120);
  } else {
    M.countUp(el, v, { format: likeFormat(value) });
  }
}
/** el counts up to its number once per visit of host (key); its text is final throughout. */
function countOnce(host, key, el, value) {
  if (!el || !Number.isFinite(Number(value))) return;
  entrance(host, key, () => { if (el.isConnected) countUp(el, value); });
}

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
 *
 * ONE ENCODING (8.9.1): height is the grade, and nothing else changes with it.
 * The bars used to take their letter's colour, green, amber and white with no
 * key, and read as random. Every bar is one neutral tone now, the newest in
 * the ink and named under it, the bands are thin guide lines labelled at the
 * left by the number each starts at (60, 70, 80, 90: one score, no letters,
 * 9.1), the average is a dashed line, the first bar of each day carries its
 * date, and a key under the chart names each mark that is on it.
 */
const BANDS = [90, 80, 70, 60];
const clampH = (n) => Math.max(0, Math.min(100, n));

function shortDate(at) {
  const d = at ? new Date(at) : null;
  // No time, no date: never "Invalid Date" under a bar.
  return d && Number.isFinite(d.getTime()) ? d.toLocaleDateString([], { month: 'short', day: 'numeric' }) : '';
}

function keyItem(swatchCls, text, swatchText) {
  const item = el('span', 'p-key-item');
  item.append(el('i', 'p-key-sw ' + swatchCls, swatchText || ''), el('span', null, text));
  return item;
}
/*
 * A RECORD IS OUTLINED, A RUN UNDERLINED (8.7), from what main counted
 * (progress.js libraryProgress): a bar whose match carries a best or a first
 * mark is `.best`, and the newest `run.count` grades, the run the newest match
 * stands in, are `.run`. A run skips no graded match and a provisional grade
 * ends one, so those are the first grades of the list, newest first. Each says
 * so on hover as well, so the outline is never the only sign.
 */
const RECORD_KINDS = new Set(['best', 'first']);

function paintTrend(grades, progress, average) {
  const host = $('p-trend');
  host.replaceChildren();
  host.hidden = grades.length < 2;
  if (grades.length < 2) return;
  const marks = (progress && progress.marks) || {};
  const run = progress && progress.run && typeof progress.run.count === 'number' ? progress.run : null;
  const inRun = new Set(run ? grades.slice(0, run.count).map((g) => g.id) : []);
  const newest = grades[0].id;

  host.append(el('p', 'p-trend-cap',
    `Your grade in each of your last ${grades.length} graded matches, oldest on the left. `
    + 'The lines mark 60, 70, 80 and 90.'));

  const plot = el('div', 'p-plot');
  plot.setAttribute('role', 'img');
  plot.setAttribute('aria-label', 'Grades, oldest first: ' + grades.slice().reverse().map((g) => g.score).join(', ')
    + (typeof average === 'number' ? `. Average ${average}.` : '.'));
  for (const at of BANDS) {
    const guide = el('div', 'p-guide');
    guide.style.setProperty('--h', at + '%');
    guide.append(el('span', null, String(at)));
    plot.append(guide);
  }
  if (typeof average === 'number') {
    const line = el('div', 'p-avgline');
    line.style.setProperty('--h', clampH(average) + '%');
    line.append(el('span', null, `avg ${average}`));
    plot.append(line);
  }

  const bars = el('div', 'p-bars');
  const records = [];
  let anyProv = false;
  let lastDay = null;
  for (const g of grades.slice().reverse()) {
    const record = (marks[g.id] || []).find((k) => RECORD_KINDS.has(k.kind));
    if (record) records.push({ score: g.score, text: record.text });
    if (g.provisional) anyProv = true;
    const latest = g.id === newest;
    const bar = el('div', 'p-bar' + (latest ? ' latest' : '') + (record ? ' best' : '') + (inRun.has(g.id) ? ' run' : ''));
    bar.title = `${fmtWhen(g.at)}: grade ${g.score}${g.provisional ? ', provisional' : ''}`
      + (latest ? '. Your latest match' : '')
      + (record ? `. ${record.text}` : '')
      + (inRun.has(g.id) ? `. One of ${run.count} in a row at ${run.from || 70} or better` : '');
    bar.style.setProperty('--h', clampH(g.score) + '%');
    const fill = el('i', g.provisional ? 'prov' : null);
    // A date under the first bar of each day, as an axis is labelled; the
    // newest is named Latest. The whole time is on hover.
    const day = shortDate(g.at);
    bar.append(el('span', null, g.score), fill, el('small', null, latest ? 'Latest' : day !== lastDay ? day : ''));
    lastDay = day;
    bars.append(bar);
  }
  plot.append(bars);
  host.append(plot);

  // The key names every mark that is on the chart, and only those, so no
  // mark is ever a colour or a shape left for the player to guess at.
  const key = el('div', 'p-key');
  key.append(keyItem('latest', 'Latest match'));
  if (typeof average === 'number') key.append(keyItem('avg', `Average, ${average}`));
  if (anyProv) key.append(keyItem('prov', 'Provisional grade'));
  for (const r of records) key.append(keyItem('best', r.text, String(r.score)));
  if (run && inRun.size > 1) key.append(keyItem('run', `${run.count} in a row at ${run.floor || 'B'} or better`));
  host.append(key);

  // THE BARS GROW FROM THE BASELINE, 40ms apart and six at most staggered,
  // their numbers fading in as they land, then the average draws in from the
  // left (matches.css .p-in, .p-draw). Once per visit: a refresh paints the
  // chart as it is.
  entrance(host, 'trend', () => {
    const bs = [...host.querySelectorAll('.p-bar')];
    bs.forEach((b, i) => {
      b.style.setProperty('--i', String(Math.min(i, 5)));
      b.classList.add('p-in');
      const f = b.querySelector('i');
      if (f) { f.style.setProperty('--i', String(Math.min(i, 5))); f.classList.add('m-grow'); }
    });
    const avg = host.querySelector('.p-avgline');
    if (avg) avg.classList.add('p-draw');
    return () => {
      for (const b of bs) { b.classList.remove('p-in'); const f = b.querySelector('i'); if (f) f.classList.remove('m-grow'); }
      if (avg) avg.classList.remove('p-draw');
    };
  });
}

/*
 * The four categories as averages over the same matches as the grades, each
 * with its last match beside it and which side of the average it fell, as an
 * arrow AND a word, so the colour is never the only sign.
 */
function paintCats(cats, matches) {
  const host = $('p-cats');
  host.replaceChildren();
  host.hidden = !cats.length;
  if (!cats.length) return;
  const most = Math.max(...cats.map((c) => c.matches || 0), 0) || matches;
  host.append(el('p', 'p-cats-cap', most
    ? `Category averages over your last ${most} ${most === 1 ? 'match' : 'matches'}, and how your latest match compares.`
    : 'Category averages, and how your latest match compares.'));
  for (const c of cats) {
    const box = el('div', 'p-cat');
    box.title = c.matches ? `${c.label}: average of ${c.matches} ${c.matches === 1 ? 'match' : 'matches'}, last match ${c.last}` : '';
    box.append(el('b', null, c.average), el('span', null, c.label));
    box.append(el('small', null, `last match ${c.last}`));
    const side = c.last > c.average ? 'up' : c.last < c.average ? 'down' : 'level';
    const words = { up: '↑ above average', down: '↓ below average', level: 'at average' };
    box.append(el('em', 'p-cat-vs ' + side, words[side]));
    host.append(box);
  }
  // The four averages count up once per visit, each ending on its number.
  entrance(host, 'count', () => {
    for (const b of host.querySelectorAll('.p-cat b')) {
      const v = b.textContent;
      if (Number.isFinite(Number(v)) && v !== '') countUp(b, v);
    }
  });
}

/**
 * A pattern as an insight item. How often it came up is its chips
 * (patternChips), so the detail is the latest sighting alone, in its own
 * words and labelled, so its round numbers are not read as belonging to every
 * match. Under the ranked lists every entry but the top mistake keeps it
 * closed in its row.
 */
function asItem(p) {
  const latest = p.examples && p.examples[0] && p.examples[0].detail ? p.examples[0].detail : null;
  return {
    title: p.title,
    detail: latest ? `Latest match: ${latest}` : null,
    fix: p.fix || null,
    judged: p.judged,
    rounds: [],
    trend: p.trend,
  };
}

const TREND_WORDS = { steady: 'steady', rising: 'more often lately', falling: 'less often lately' };

/**
 * How often and which way, as chips beside the title: "2 of 5 recorded
 * matches" across the RECORDED matches (patterns.js), "7 times" in all, then
 * the trend word. Rising is bad news for a mistake and good news for a
 * strength.
 */
function patternChips(p, total, bad) {
  const box = el('span', 'gv-chips p-chips');
  box.append(window.GradeView.chip(`${p.matches} of ${total} recorded matches`));
  if (typeof p.total === 'number' && p.total > p.matches) {
    box.append(window.GradeView.chip(`${p.total} ${p.total === 1 ? 'time' : 'times'}`));
  }
  const t = p.trend;
  if (TREND_WORDS[t]) {
    const good = t === 'steady' ? null : (t === 'falling') === bad;
    box.append(el('span', 'gv-chip p-trendword ' + (good === null ? 'steady' : good ? 'better' : 'worse'), TREND_WORDS[t]));
  }
  return box;
}

function paintPatterns(p) {
  $('p-avg').hidden = p.average === null;
  $('p-avg-num').textContent = p.average === null ? '' : p.average;
  if (p.average !== null) countOnce($('p-avg'), 'count', $('p-avg-num'), p.average);
  paintTrend(p.grades || [], p.progress, p.average);
  paintCats(p.categories || [], p.matches);
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
    mistakes: p.mistakes.map(asItem),
    strengths: p.strengths.map(asItem),
    missed: p.missed.map(asItem),
  }, {
    mistakesTitle: 'Your most serious repeated mistakes',
    strengthsTitle: 'What you keep doing well',
    missedTitle: 'What you keep missing',
    onRound: false,
    limit: 5,
    // Ranked, as the review's are (8.7): the top mistake a card, the rest
    // closed rows that open to the latest sighting and the fix.
    hero: true,
    empty: 'Nothing has repeated across your matches yet.',
  });
  // Each entry's chips beside its title, in the head of the card or the
  // closed row alike (GradeView.insightLists draws both as .gv-item).
  const lists = [['mistakes', true], ['strengths', false], ['missed', true]];
  const blocks = view.querySelectorAll('.gv-block');
  let b = 0;
  for (const [key, bad] of lists) {
    if (!p[key].length) continue;
    const nodes = blocks[b++].querySelectorAll('.gv-item');
    nodes.forEach((node, i) => {
      if (!p[key][i]) return;
      node.querySelector('.gv-item-head').append(patternChips(p[key][i], p.recorded, bad));
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
      // A long map, agent or champion name is cut to fit; the whole one on hover.
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
      wrap.append(el('span', 'b-num ' + gradeTone({ score: v.avg }), String(v.avg)));
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
    default:
      if (!v || v.value === null || v.value === undefined) return none(td);
      td.textContent = c.kind === 'dec1' ? v.value.toFixed(1) : v.value.toLocaleString('en-US');
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
  if (gameId === 'lol') {
    const line = [s.kda && s.kda.value !== null ? `KDA ${s.kda.value.toFixed(2)}` : null,
      s.csPerMin && s.csPerMin.value !== null ? `CS a minute ${s.csPerMin.value.toFixed(1)}` : null,
      s.visionPerMin && s.visionPerMin.value !== null ? `Vision a minute ${s.visionPerMin.value.toFixed(1)}` : null,
      s.deathsPer10 && s.deathsPer10.value !== null ? `Deaths per 10 minutes ${s.deathsPer10.value.toFixed(1)}` : null].filter(Boolean);
    if (line.length) out.push(['Averages', line.join(DOT)]);
  }
  if (row.cross && row.cross.length) {
    const title = dim === 'map' ? 'Agents here' : 'Maps';
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
function subLine(b, dim) { return subParts(b, dim).join(' '); }

/**
 * The sample's sentences, one by one: the first ("Across 4 matches in
 * Competitive.") sits beside the folded line's title; the rest, which say
 * why a column is empty, go above the table (#b-sample), where they wrap
 * rather than being cut to an ellipsis at the window's width.
 */
function subParts(b, dim) {
  if (!b.matches) return [];
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
  return parts;
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
/**
 * THE CUT AND THE QUEUE ARE SEGMENTED CAPSULES (8.7, shared/seg.js): one
 * thumb slides to the chosen button. occlaraSeg puts the thumb into the row
 * once, so a repaint takes the buttons out and leaves it, where
 * replaceChildren took the thumb with them and the capsule lost its fill.
 */
function clearButtons(host) {
  for (const b of [...host.querySelectorAll('button')]) b.remove();
}
function segment(host) {
  try {
    if (typeof window.occlaraSeg === 'function') window.occlaraSeg(host);
  } catch { /* a DOM with no observers (the offline tests) draws the buttons flat */ }
}

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
    // Nothing to break down: the folded line at the foot of Patterns (8.7)
    // is not drawn at all, rather than a line that opens on nothing.
    host.hidden = true;
    return;
  }
  host.hidden = false;
  const dims = b.dims;
  let dim = bstate.dim[b.game];
  if (!dims.some((d) => d.key === dim)) dim = bstate.dim[b.game] = dims[0].key;

  const dimsHost = $('b-dims');
  clearButtons(dimsHost);
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
  clearButtons(qHost);
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

  const parts = subParts(b, dim);
  $('b-sub').textContent = parts[0] || '';
  $('b-sample').textContent = parts.slice(1).join(' ');
  $('b-sample').hidden = parts.length < 2;
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
// NO BUTTON HERE (9.1, the owner's item 5): "Grade my recent matches" is
// gone from Matches. Connect in Settings (and in onboarding) grades the
// account's recent matches, and the run's own line shows here while it runs
// and once it ends, so the rows arriving are never a mystery.
let backfill = null;
let riotId = '';

function paintBf() {
  const box = $('bf');
  const connected = riotId.includes('#');
  const s = backfill || { state: 'idle' };
  // A RUN BELONGS TO ITS ACCOUNT. Once the Riot ID changes, the last run's
  // outcome ("Graded 4 recent matches") is about another account's matches,
  // and a run still winding down for the old ID is not grading this one, so
  // neither is shown until a status names this ID.
  const mine = connected && String(s.account || '').trim().toLowerCase() === riotId.toLowerCase();
  const busy = mine && (s.state === 'listing' || s.state === 'waiting' || s.state === 'grading');
  const text = mine && s.state !== 'idle' ? (s.message || '') : '';
  box.hidden = game !== 'valorant' || !text;
  box.classList.toggle('busy', busy);
  $('bf-status').textContent = text;
  $('bf-status').title = text;
}

/** The Riot ID in Settings, read again, and the grading line repainted on it. */
async function refreshRiotId() {
  const cfg = await window.occlara.getConfig().catch(() => null);
  if (cfg) riotId = String(cfg.riotId || '').trim();
  paintBf();
}

// ── Importing a recording (8.12) ─────────────────────────────────────────────
// Main picks and holds the file and does the work (import-video.js). This shows
// where it is, from the status it pushes, and the plan's card from usage.js.
let imp = { state: 'idle' };
let impCard = null;
let impNote = '';
const IMP_STEPS = { saved: 'Saving the match', riot: "Getting Riot's record", deaths: 'Checking the deaths',
  look: 'Looking at your deaths', writing: 'Writing the review' };
const clockOf = (sec) => {
  const s = Math.round(Number(sec) || 0);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

function matchOption(m) {
  const day = Number.isFinite(m.startedAt) ? new Date(m.startedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '';
  const o = document.createElement('option');
  o.value = m.matchId;
  o.textContent = [m.map, m.agent, m.score, day, m.taken ? 'already in your library' : ''].filter(Boolean).join(', ');
  o.disabled = !!m.taken;
  return o;
}

function paintImport() {
  // The head's action is the list page's: its panel is drawn over the rows.
  $('imp-go').hidden = game !== 'valorant' || document.documentElement.dataset.section === 'patterns';
  const s = imp || { state: 'idle' };
  const lock = impCard && impCard.allowed === false ? impCard : null;
  const choosing = s.state === 'choosing' || (s.state === 'choosing-refused' && !s.gate);
  const running = ['starting', 'reading', 'paused', 'cancelling'].includes(s.state);
  const show = (id, on) => { $(id).hidden = !on; };
  const box = $('imp');
  const visible = !!lock || choosing || running || ['review', 'done', 'failed'].includes(s.state) || !!impNote;
  box.hidden = game !== 'valorant' || !visible;
  $('imp-go').disabled = running || s.state === 'review';
  if (box.hidden) return;
  let title = s.fileName || 'Import a recording';
  let line = impNote;
  if (lock) { title = lock.title; line = lock.body; }
  else if (choosing) {
    line = [clockOf(s.seconds) + ' long', s.message || (impCard && impCard.line) || ''].filter(Boolean).join('. ');
  } else if (s.state === 'starting') line = 'Starting';
  else if (s.state === 'reading') line = `Reading the video, ${s.percent || 0}%. You can keep using Occlara.`;
  else if (s.state === 'paused') line = 'Paused until your match is over.';
  else if (s.state === 'cancelling') line = 'Cancelling';
  else if (s.state === 'review') line = IMP_STEPS[s.step] || 'Building your review';
  else if (s.state === 'done') {
    title = s.locked ? 'Saved, but locked' : 'Your review is ready';
    line = [s.matched ? "Matched to Riot's record." : "Reviewed from the screen, not matched to Riot's record.",
      s.restUnread ? 'The first full match was reviewed, the rest of the file was not read.' : ''].filter(Boolean).join(' ');
  } else if (s.state === 'failed') { title = 'This recording was not imported'; line = s.message || ''; }
  $('imp-title').textContent = title;
  $('imp-line').textContent = line;
  show('imp-pick', choosing && !lock && Array.isArray(s.matches) && s.matches.some((m) => !m.taken));
  if (!$('imp-pick').hidden && $('imp-match').dataset.for !== String(s.pick)) {
    const none = document.createElement('option');
    none.value = '';
    none.textContent = "Not in the list, review it from the screen, no grade";
    $('imp-match').replaceChildren(...s.matches.map(matchOption), none);
    $('imp-match').value = s.nearest || '';
    $('imp-match').dataset.for = String(s.pick);
  }
  show('imp-bar', running && s.state !== 'starting');
  $('imp-fill').style.width = `${s.percent || 0}%`;
  $('imp-bar').setAttribute('aria-valuenow', String(s.percent || 0));
  show('imp-start', choosing && !lock);
  show('imp-open', s.state === 'done' && !!s.reviewId);
  show('imp-upgrade', !!(lock && lock.upgrade));
  $('imp-upgrade').textContent = lock && lock.upgrade === 'max' ? 'Upgrade to Max' : 'Upgrade to Pro';
  show('imp-buy', !!(lock && lock.buy));
  show('imp-cancel', s.state === 'reading' || s.state === 'paused');
  show('imp-close', !!lock || choosing || s.state === 'done' || s.state === 'failed' || (!!impNote && !running));
  show('imp-licence', choosing && !lock);
}

function takeImport(s) {
  if (!s || s.sealed) return;
  if (s.error === 'match') return;
  imp = s;
  impNote = s.state === 'idle' && s.message ? s.message : '';
  paintImport();
}

$('imp-go').addEventListener('click', async () => {
  const got = await window.occlara.getImport(true).catch(() => null);
  if (!got || got.sealed) return;
  impCard = got.card;
  impNote = got.card ? '' : 'Imports are not available right now. Try again shortly.';
  if (!got.card || got.card.allowed === false) { imp = got.status || imp; paintImport(); return; }
  takeImport(await window.occlara.pickImport().catch(() => null));
});
$('imp-start').addEventListener('click', async () => {
  const id = $('imp-pick').hidden ? null : $('imp-match').value || null;
  const s = await window.occlara.startImport(id).catch(() => null);
  if (s && s.state === 'choosing-refused' && s.gate) impCard = (await window.occlara.getImport(true).catch(() => ({}))).card || impCard;
  takeImport(s);
});
$('imp-cancel').addEventListener('click', async () => takeImport(await window.occlara.cancelImport().catch(() => null)));
$('imp-close').addEventListener('click', async () => {
  impCard = null;
  impNote = '';
  imp = (await window.occlara.closeImport().catch(() => null)) || { state: 'idle' };
  if (['done', 'failed', 'choosing-refused'].includes(imp.state)) imp = { state: 'idle' };
  paintImport();
});
$('imp-open').addEventListener('click', () => { if (imp.reviewId) window.occlara.openReview(imp.reviewId); });
$('imp-upgrade').addEventListener('click', () => window.occlara.importAction('upgrade'));
$('imp-buy').addEventListener('click', () => window.occlara.importAction('buy'));
$('imp-licence').addEventListener('click', () => window.occlara.importAction('licence'));

// ── The rows ────────────────────────────────────────────────────────────────
/*
 * SIMPLER ROWS (9.1, the owner's item 11: "too much information that players
 * skim past"). A row is six things, in columns, so the eye runs down them:
 * the agent's portrait, the agent and the map with the date under them, the
 * result and the score, the grade, its change on the match before. The rest
 * is one step away, in the row's peek (hover, or the keyboard's focus): the
 * queue and where the grade came from, the top mistake, the milestones, the
 * RR and the match rating. And the review, one press.
 *
 * A row is a list item holding siblings, never one control inside another:
 * the row (a button, which opens the review), the eye (the AI log, where its
 * frames are still kept, shared/log-eye.js) and the menu (Open review,
 * Delete match). The peek is the row's description (aria-describedby).
 *
 * A ROW WITH NO GRADE SAYS WHY, where its result and grade would be
 * (whyUngraded): still being checked has its pill (GradeView.checking), a
 * locked one, a part stopped before the end, one too little of was read, an
 * import not matched to Riot's record, or not enough measured.
 */
const D = window.OcclaraDisplay || null;
const inSentence = (t) => (D && typeof D.inSentence === 'function' ? D.inSentence(t) : String(t || ''));
const GRADE_TIP = (D && D.NAMES && D.NAMES.grade.tip) || '';
const RATING = (D && D.NAMES && D.NAMES.rating) || { name: 'Match rating', tip: '' };

/** "13 : 11", the score as the game draws it. */
const scoreText = (s) => String(s || '').replace(/\s*[-:]\s*/, ' : ');
/** "Jett on Split", whatever is known of the two. */
const nameOf = (m) => (m.title && m.map ? `${m.title} on ${m.map}` : (m.title || m.map || 'Unknown match'));
/** 'win', 'loss' or '' from a result. */
const outcomeOf = (r) => (/^(?:vict|win)/i.test(r || '') ? 'win' : /^(?:defeat|loss)/i.test(r || '') ? 'loss' : '');

/** A row's date: "Today, 9:25 PM", "Yesterday, 9:25 PM" or "Nov 22, 9:25 PM". */
function whenOf(at) {
  const TC = window.TrendChart;
  if (TC && typeof TC.whenWord === 'function') return TC.whenWord(at);
  return fmtWhen(at);
}

/**
 * Why a row has no grade: [short, long]. The short one stands in the row, the
 * long one is its tooltip; both say only what the row itself shows.
 */
function whyUngraded(m) {
  if (m.locked) return ['No games left, not graded', 'Saved while your account had no games left, so it was not graded. Open it for what Riot recorded.'];
  if (m.stoppedLive && !m.result) return ['Stopped early, not graded', 'Stop was pressed before this match ended, so too little of it was read to grade. Open it for what was read.'];
  if (!m.result && !m.score) return ['Too little read to grade', 'Too little of this match was read to grade it: its score was never on screen long enough. Open it for what was read.'];
  if (m.imported && !m.matchId && !m.verified) return ["Not matched to Riot's record", "This recording was not matched to Riot's record of a match, and a full grade needs it. Open it for what the screen showed."];
  return ['Not enough measured to grade', 'Not enough of this match was measured to grade it. Open it to see what was.'];
}

let peekSeq = 0;

/**
 * @param m       the library row
 * @param o.gutter  the list has eyes, so a row without one keeps its room
 * @param o.marks   the row's milestones as main counted them (progress.js
 *                  libraryProgress marks[id]): [{ kind, text }], none while
 *                  the match is still being checked
 * @param o.delta   the grade's change on the graded match before, or 'first'
 */
function row(m, o) {
  const { gutter, marks, delta } = o || {};
  const item = el('div', 'm-item');
  item.setAttribute('role', 'listitem');
  item.dataset.id = m.id;
  const b = el('button', 'm-row');
  b.type = 'button';
  const src = typeof window.occlara.agentArt === 'function' ? window.occlara.agentArt(game, m.title) : null;
  const face = el(src ? 'img' : 'span', 'm-face');
  if (src) {
    face.src = src;
    face.alt = '';
    face.addEventListener('error', () => face.replaceWith(el('span', 'm-face')));
  }
  face.setAttribute('aria-hidden', 'true');

  const name = el('div', 'm-name');
  name.append(el('span', 'm-title', nameOf(m)), el('span', 'm-when', whenOf(m.at)));

  // STILL BEING CHECKED (8.4.1): its result, its top mistake and its grade
  // are the screen's until the review is whole, so the row says it is being
  // checked where its grade would be and names neither of the others yet.
  const checking = m.work ? window.GradeView.checking(m.work) : null;
  const g = checking ? null : m.grade;
  const grade = el('div', 'm-grade');
  const res = el('div', 'm-result');
  let dEl = el('span', 'm-delta none');
  if (checking) {
    grade.append(checking);
  } else if (g) {
    if (m.result) res.append(el('span', 'm-res ' + outcomeOf(m.result), [m.result, scoreText(m.score)].filter(Boolean).join(' ')));
    // One score, no letter (9.1): the number in its band's tone, dashed when provisional.
    grade.append(el('span', 'm-score ' + gradeTone(g) + (g.provisional ? ' prov' : ''), String(g.score)));
    grade.title = `Grade ${g.score}${g.provisional ? ', provisional: some of the record was missing' : ''}. ${GRADE_TIP}`;
    if (delta === 'first') dEl = el('span', 'm-delta first', 'First');
    else if (typeof delta === 'number') {
      dEl = el('span', 'm-delta ' + (delta > 0 ? 'up' : delta < 0 ? 'down' : 'even'), D ? D.gradeDelta(delta) : `${delta > 0 ? '+' : ''}${delta}`);
      dEl.title = 'Since the graded match before';
    }
  } else {
    const [short, long] = whyUngraded(m);
    if (m.result) res.append(el('span', 'm-res ' + outcomeOf(m.result), [m.result, scoreText(m.score)].filter(Boolean).join(' ')));
    grade.append(el('span', 'm-score none', '--'));
    const why = el('span', 'm-why', short);
    why.title = long;
    res.append(why);
    item.classList.add('ungraded');
  }
  b.append(face, name, res, grade, dEl);

  // ── The peek: the rest, one step away ──
  const peek = el('div', 'm-peek');
  peek.id = `m-peek-${++peekSeq}`;
  peek.setAttribute('role', 'tooltip');
  const source = m.imported ? (m.matchId || m.verified ? 'Imported recording' : "Imported, not matched to Riot's record")
    : m.source === 'riot' ? "From Riot's record" : m.verified ? "Checked against Riot's record" : null;
  peek.append(el('div', 'm-meta', [whenOf(m.at), m.mode, source].filter(Boolean).join('  ·  ')));
  const facts = el('dl', 'm-facts');
  const fact = (label, value, cls) => {
    const wrap = el('div', 'm-fact' + (cls ? ' ' + cls : ''));
    wrap.append(el('dt', null, label));
    const dd = el('dd');
    if (value instanceof Object && value.nodeType) dd.append(value); else dd.textContent = value;
    wrap.append(dd);
    facts.append(wrap);
    return wrap;
  };
  if (!checking && m.topMistake) fact('Top mistake', el('span', 'm-top-mistake', m.topMistake));
  if (!checking && Array.isArray(marks)) {
    const box = el('span', 'm-marks');
    for (const k of marks) {
      if (!k || typeof k.text !== 'string' || !k.text) continue;
      const mark = el('span', 'm-mark' + (k.kind ? ' ' + k.kind : ''), k.text);
      mark.title = k.text;
      box.append(mark);
    }
    if (box.children.length) fact('Milestones', box);
  }
  if (!checking && m.rating && m.rating.shown) {
    const f = fact(RATING.name, String(m.rating.shown), 'm-rating');
    f.title = RATING.tip;
  }
  // The RR the match moved, filled in once main answers (paintRR).
  const rr = fact('RR', el('span', 'm-rr'), 'm-rr-fact');
  rr.hidden = true;
  if (checking) facts.append(el('p', 'm-peek-note', "Still being checked against Riot's record."));
  else if (!g) facts.append(el('p', 'm-peek-note', whyUngraded(m)[1]));
  peek.append(facts);
  b.setAttribute('aria-describedby', peek.id);
  // A name a screen reader reads as one line: what the eye sees across the row.
  b.setAttribute('aria-label', [nameOf(m), whenOf(m.at), checking ? 'still being checked' : null,
    !checking && m.result ? [m.result, scoreText(m.score)].filter(Boolean).join(' ') : null,
    g ? `grade ${g.score}${g.provisional ? ', provisional' : ''}` : checking ? null : 'not graded',
    g && typeof delta === 'number' ? `${D ? D.gradeDelta(delta) : delta} on the match before` : null,
    !checking && m.topMistake ? `top mistake ${inSentence(m.topMistake)}` : null].filter(Boolean).join(', '));
  b.addEventListener('click', () => window.occlara.openReview(m.id));
  item.append(b);

  const eye = window.LogEye.button(m.aiLog, () => window.occlara.openAiLog(m.id));
  if (eye) item.append(eye);
  else if (gutter) {
    const gap = el('span', 'm-eye-gap');
    gap.setAttribute('aria-hidden', 'true');
    item.append(gap);
  }
  item.append(menuButton(m), peek);
  // The last rows' peek opens upward, so it never runs past the list's end.
  item.addEventListener('pointerenter', () => placePeek(item));
  b.addEventListener('focus', () => placePeek(item));
  return item;
}

/** A peek near the foot of the scrolling page opens over its row instead of under it. */
function placePeek(item) {
  try {
    const scroller = document.querySelector('.body');
    if (!scroller) return;
    const sb = scroller.getBoundingClientRect();
    const ib = item.getBoundingClientRect();
    const peek = item.querySelector('.m-peek');
    const ph = (peek && peek.offsetHeight) || 140;
    item.classList.toggle('peek-up', ib.bottom + ph + 16 > sb.bottom && ib.top - ph - 16 > sb.top);
  } catch { /* no layout */ }
}

// ── A row's menu (9.1, the owner's item 18) ─────────────────────────────────
const DOTS = '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><circle cx="5.5" cy="12" r="1.6" fill="currentColor"/><circle cx="12" cy="12" r="1.6" fill="currentColor"/><circle cx="18.5" cy="12" r="1.6" fill="currentColor"/></svg>';
let menuFor = null;     // { m, button } the menu is open on

function menuButton(m) {
  const btn = el('button', 'icon-btn m-more');
  btn.type = 'button';
  btn.innerHTML = DOTS;
  btn.title = 'More';
  btn.setAttribute('aria-label', `More for ${nameOf(m)}`);
  btn.setAttribute('aria-haspopup', 'menu');
  btn.setAttribute('aria-expanded', 'false');
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (menuFor && menuFor.button === btn) { closeMenu(true); return; }
    openMenu(m, btn, e.detail === 0);
  });
  btn.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); openMenu(m, btn, true); }
  });
  return btn;
}

function menuItems(m) {
  const items = [{ id: 'open', text: 'Open review', run: () => window.occlara.openReview(m.id) }];
  if (m.aiLog === 'kept') items.push({ id: 'log', text: 'Open AI log', run: () => window.occlara.openAiLog(m.id) });
  if (!m.work && typeof window.occlara.deleteMatch === 'function') items.push({ id: 'delete', text: 'Delete match', danger: true, sep: true, run: () => askDelete(m) });
  return items;
}

function openMenu(m, btn, fromKeys) {
  closeMenu(false);
  const menu = $('m-menu');
  menu.replaceChildren();
  for (const it of menuItems(m)) {
    if (it.sep) menu.append(el('div', 'm-menu-sep'));
    const r = el('button', 'm-menu-item' + (it.danger ? ' danger' : ''), it.text);
    r.type = 'button';
    r.setAttribute('role', 'menuitem');
    r.tabIndex = -1;
    r.dataset.action = it.id;
    r.addEventListener('click', (e) => { e.stopPropagation(); closeMenu(false); it.run(); });
    menu.append(r);
  }
  menuFor = { m, button: btn };
  btn.setAttribute('aria-expanded', 'true');
  btn.classList.add('open');
  // Under the button, its right edge on the button's, inside the window
  // (position: fixed; the menu closes on a scroll, so it never drifts).
  menu.hidden = false;
  try {
    const bb = btn.getBoundingClientRect();
    const mh = menu.offsetHeight || 120;
    const mw = menu.offsetWidth || 188;
    const below = bb.bottom + 6 + mh <= (window.innerHeight || 800) - 8;
    menu.style.top = `${Math.round(below ? bb.bottom + 6 : bb.top - 6 - mh)}px`;
    menu.style.left = `${Math.round(Math.max(8, bb.right - mw))}px`;
    menu.classList.toggle('up', !below);
  } catch { /* no layout */ }
  menu.classList.remove('in');
  void menu.offsetWidth;
  menu.classList.add('in');
  if (fromKeys) {
    const first = menu.querySelector('.m-menu-item');
    if (first) first.focus();
  }
}

function closeMenu(refocus) {
  const menu = $('m-menu');
  if (!menuFor) { menu.hidden = true; return; }
  const { button } = menuFor;
  menuFor = null;
  menu.hidden = true;
  menu.classList.remove('in');
  button.setAttribute('aria-expanded', 'false');
  button.classList.remove('open');
  if (refocus && button.isConnected) button.focus();
}

$('m-menu').addEventListener('keydown', (e) => {
  const items = [...$('m-menu').querySelectorAll('.m-menu-item')];
  const at = items.indexOf(document.activeElement);
  if (e.key === 'ArrowDown') { e.preventDefault(); items[(at + 1) % items.length].focus(); }
  else if (e.key === 'ArrowUp') { e.preventDefault(); items[(at - 1 + items.length) % items.length].focus(); }
  else if (e.key === 'Home') { e.preventDefault(); items[0].focus(); }
  else if (e.key === 'End') { e.preventDefault(); items[items.length - 1].focus(); }
  else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeMenu(true); }
  else if (e.key === 'Tab') closeMenu(false);
});
document.addEventListener('click', (e) => {
  if (menuFor && !$('m-menu').contains(e.target)) closeMenu(false);
});
window.addEventListener('blur', () => closeMenu(false));
{
  const scroller = document.querySelector('.body');
  if (scroller) scroller.addEventListener('scroll', () => closeMenu(false), { passive: true });
}

// ── Delete a match, asked first ─────────────────────────────────────────────
/*
 * WHAT GOES IS SAID (9.1, the owner's item 18): the review, its clips and its
 * frames, off this PC, for good (MATCH_DELETE, foundations). An imported
 * recording's own video file stays where it was and the game it used is not
 * given back. Keep it is the default and Escape keeps it. Main refuses mid
 * match and while the review is still being written, and the dialog says so.
 */
const DELETE_ERRORS = {
  match: 'Not while a match is being recorded. Try again once it ends.',
  working: 'This review is still being written. Try again in a minute.',
  gone: 'This match was already deleted.',
  bad: 'This match could not be deleted.',
};
let confirmFor = null;   // { m, back } the dialog is asking about

function askDelete(m) {
  const box = $('m-confirm');
  const what = [nameOf(m), m.result ? [m.result, scoreText(m.score)].filter(Boolean).join(' ') : null, whenOf(m.at)].filter(Boolean).join(', ');
  $('m-confirm-what').textContent = what + '.';
  $('m-confirm-body').textContent = 'Its review, its clips and its frames are deleted from this PC. This cannot be undone.'
    + (m.imported ? ' Your video file is kept, and the game it used is not given back.' : '');
  $('m-confirm-error').hidden = true;
  $('m-confirm-error').textContent = '';
  const go = $('m-confirm-go');
  go.disabled = false;
  go.textContent = 'Delete match';
  const item = [...$('list').querySelectorAll('.m-item')].find((it) => it.dataset.id === m.id) || null;
  confirmFor = { m, back: item && item.querySelector('.m-more') };
  box.hidden = false;
  box.classList.remove('in');
  void box.offsetWidth;
  box.classList.add('in');
  $('m-confirm-keep').focus();
}

function closeConfirm(refocus) {
  const box = $('m-confirm');
  if (box.hidden) return;
  const back = confirmFor && confirmFor.back;
  confirmFor = null;
  box.hidden = true;
  box.classList.remove('in');
  if (refocus && back && back.isConnected) back.focus();
}

let leaving = 0;          // rows animating out: a repaint waits for them
let loadAfter = false;
async function doDelete() {
  if (!confirmFor) return;
  const { m } = confirmFor;
  const go = $('m-confirm-go');
  go.disabled = true;
  go.textContent = 'Deleting';
  const r = await window.occlara.deleteMatch(m.id).catch(() => null);
  if (!r || !r.ok) {
    go.disabled = false;
    go.textContent = 'Delete match';
    const err = (r && DELETE_ERRORS[r.error]) || DELETE_ERRORS.bad;
    $('m-confirm-error').textContent = err;
    $('m-confirm-error').hidden = false;
    if (r && r.error === 'gone') { closeConfirm(false); load(); }
    return;
  }
  closeConfirm(false);
  removeRow(m.id);
}

/** The row folds away, and the next row takes the keyboard. */
function removeRow(id) {
  const item = [...$('list').querySelectorAll('.m-item')].find((it) => it.dataset.id === id);
  if (!item) { load(); return; }
  const next = item.nextElementSibling || item.previousElementSibling;
  const focusNext = () => { const b = next && next.isConnected && next.querySelector('.m-row'); if (b) b.focus(); };
  if (!M || M.reduced()) { item.remove(); focusNext(); load(); return; }
  leaving++;
  item.style.height = `${item.offsetHeight}px`;
  void item.offsetHeight;
  item.classList.add('m-leaving');
  setTimeout(() => {
    item.remove();
    focusNext();
    leaving = Math.max(0, leaving - 1);
    if (!leaving) { loadAfter = false; load(); }
  }, 360);
}

$('m-confirm-keep').addEventListener('click', () => closeConfirm(true));
$('m-confirm-go').addEventListener('click', () => { doDelete(); });
$('m-confirm').addEventListener('click', (e) => { if (e.target === $('m-confirm')) closeConfirm(true); });
$('m-confirm').addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeConfirm(true); return; }
  if (e.key === 'Tab') {
    // The two buttons hold the keyboard while the dialog is up.
    const a = $('m-confirm-keep'), z = $('m-confirm-go');
    if (e.shiftKey && document.activeElement === a) { e.preventDefault(); z.focus(); }
    else if (!e.shiftKey && document.activeElement === z) { e.preventDefault(); a.focus(); }
  }
});

/*
 * THE RR EACH RATED MATCH MOVED (8.7.9), "+18", in the row's peek, from
 * main's rank history by the match's Riot id (REVIEWS_RR, home-model.js
 * rrForRows). Asked once the rows are painted, so a slow history never holds
 * the list back, and an answer overtaken by a newer paint paints nothing.
 */
let rrAsk = 0;
async function paintRR(forGame) {
  const mine = ++rrAsk;
  const chips = typeof window.occlara.getRR === 'function'
    ? await window.occlara.getRR(forGame).catch(() => ({})) : {};
  if (mine !== rrAsk || forGame !== game) return;
  for (const item of $('list').querySelectorAll('.m-item')) {
    const span = item.querySelector('.m-rr');
    const wrap = item.querySelector('.m-rr-fact');
    if (!span || !wrap) continue;
    const c = chips && chips[item.dataset.id];
    wrap.hidden = !c;
    span.textContent = c ? String(c.text).replace(/^RR\s*/, '') : '';
    span.className = 'm-rr' + (c && c.tone ? ' ' + c.tone : '');
    wrap.title = c ? c.title : '';
  }
}

// ── The grade trend across the top ──────────────────────────────────────────
/*
 * THE HERO OF THE LIST PAGE (9.1, the owner's items 15 and 21): the last
 * CHART_N graded matches as the moonlit area (shared/trend-chart.js), across
 * the page, drawn as it comes on screen, the latest, the average of the same
 * matches and the best of them over it. From the rows themselves, newest
 * first, so a match in the list is a point here; a click on a point, or
 * Enter on it, opens its review. Hidden under two grades, and on Patterns.
 *
 * The average is over the matches drawn, as patterns.js averages a window: a
 * provisional grade is left out once two final ones are there.
 */
const CHART_N = 20;
let chart = null;

function chartPoints(rows, deltas) {
  return rows.filter((m) => !m.work && m.grade && Number.isFinite(Number(m.grade.score)))
    .slice(0, CHART_N).reverse()
    .map((m) => ({ id: m.id, grade: Number(m.grade.score), at: m.at, provisional: !!m.grade.provisional,
      agent: m.title || null, map: m.map || null, result: m.result || null, scoreline: m.score ? scoreText(m.score) : null,
      delta: typeof deltas[m.id] === 'number' ? deltas[m.id] : null }));
}

function averageOf(points) {
  const finals = points.filter((p) => !p.provisional);
  const over = finals.length >= 2 ? finals : points;
  return over.length ? Math.round(over.reduce((a, p) => a + p.grade, 0) / over.length) : null;
}

function paintChart(rows, deltas) {
  const box = $('m-chart');
  const points = chartPoints(rows, deltas);
  const listPage = document.documentElement.dataset.section === 'list';
  box.hidden = !listPage || points.length < 2;
  if (box.hidden) { if (chart) { chart.destroy(); chart = null; } return; }
  const last = points[points.length - 1];
  const avg = averageOf(points);
  const best = points.reduce((a, p) => (p.grade > a.grade ? p : a), points[0]);
  $('m-chart-n').textContent = String(points.length);
  $('m-chart-big').textContent = String(last.grade);
  const d = last.delta;
  const since = $('m-chart-since');
  since.textContent = typeof d === 'number' ? (D ? D.gradeDelta(d) : String(d)) : '';
  since.className = 'm-chart-since ' + (typeof d !== 'number' ? 'none' : d > 0 ? 'up' : d < 0 ? 'down' : 'even');
  since.title = typeof d === 'number' ? 'On the graded match before' : '';
  $('m-chart-avg').textContent = avg === null ? '--' : String(avg);
  $('m-chart-best').textContent = String(best.grade);
  $('m-chart-best').title = `${nameOf({ title: best.agent, map: best.map })}, ${whenOf(best.at)}`;
  const opts = { height: 196, average: avg, label: `Grade over your last ${points.length} graded matches`,
    onOpen: (p) => window.occlara.openReview(p.id) };
  if (chart) chart.set(points, opts);
  else chart = window.TrendChart.draw($('m-chart-line'), points, opts);
  // THE LINE DRAWS ITSELF once per visit, as the page comes on screen, and
  // the latest grade counts up to its number.
  countOnce(box, 'count', $('m-chart-big'), last.grade);
  entrance(box, 'draw', () => { if (chart) chart.play(); });
}

// ── When you play ───────────────────────────────────────────────────────────
/*
 * BEST AND WORST TIME TO PLAY (9.1, the owner's item 15), from every graded
 * row of this game by when it started (src/shared/play-times.js, which says
 * every word). Beside the words, the eight times of day as columns, each
 * standing at its average grade, its count under it; a time with fewer than
 * play-times' MIN_SLOT matches is drawn faint and never compared. The list
 * page alone, and only once a match is graded.
 */
const SLOT_SHORT = ['12 AM', '3 AM', '6 AM', '9 AM', '12 PM', '3 PM', '6 PM', '9 PM'];

function paintWhen(rows) {
  const box = $('when');
  const P = window.OcclaraPlayTimes;
  const listPage = document.documentElement.dataset.section === 'list';
  const r = P ? P.playTimes(rows) : null;
  box.hidden = !listPage || !r || !r.counted;
  if (box.hidden) return;
  $('when-title').textContent = r.text.title;
  $('when-note').textContent = r.text.note;
  const prog = $('when-progress');
  prog.hidden = r.enough;
  if (!r.enough) {
    const pct = Math.round((r.counted / (r.counted + r.need)) * 100);
    $('when-fill').style.setProperty('--p', `${pct}%`);
    prog.setAttribute('role', 'progressbar');
    prog.setAttribute('aria-label', 'Graded matches toward best and worst times');
    prog.setAttribute('aria-valuemin', '0');
    prog.setAttribute('aria-valuemax', String(r.counted + r.need));
    prog.setAttribute('aria-valuenow', String(r.counted));
  }
  const calls = $('when-calls');
  calls.hidden = !r.enough;
  box.classList.toggle('unclear', r.enough && !r.clear);
  if (r.enough) {
    $('when-best-k').textContent = r.text.best.kicker;
    $('when-best').textContent = r.text.best.label;
    $('when-best-line').textContent = r.text.best.line;
    $('when-worst-k').textContent = r.text.worst.kicker;
    $('when-worst').textContent = r.text.worst.label;
    $('when-worst-line').textContent = r.text.worst.line;
  }
  const hours = $('when-hours');
  hours.replaceChildren();
  const LO = 40;
  for (const s of r.slots) {
    const col = el('div', 'when-col' + (s.compared ? ' compared' : s.n ? ' thin' : ' empty')
      + (r.enough && r.best && s.slot === r.best.slot ? ' best' : '') + (r.enough && r.worst && s.slot === r.worst.slot ? ' worst' : ''));
    const h = s.avg === null ? 0 : Math.max(4, Math.round(((s.avg - LO) / (100 - LO)) * 100));
    col.style.setProperty('--h', `${h}%`);
    const bar = el('div', 'when-bar');
    const fillEl = el('i');
    bar.append(fillEl);
    if (s.avg !== null) bar.append(el('span', 'when-avg', String(s.avg)));
    col.append(bar, el('span', 'when-hour', SLOT_SHORT[s.slot]), el('span', 'when-n', s.n ? String(s.n) : ''));
    col.title = s.n
      ? `${s.label}: average grade ${s.avg} over ${s.n} ${s.n === 1 ? 'match' : 'matches'}${s.decided ? `, won ${s.won} of ${s.decided}` : ''}`
        + (s.compared ? '' : `. Compared once ${P.MIN_SLOT} are graded here.`)
      : `${s.label}: no graded matches`;
    hours.append(col);
  }
  hours.setAttribute('aria-label', 'Average grade by the time of day each match started: '
    + r.slots.filter((s) => s.n).map((s) => `${s.label}, ${s.avg} over ${s.n}`).join('; ') + '.');
  // The columns grow from their baseline once per visit, 40ms apart.
  entrance(hours, 'grow', () => {
    const fills = [...hours.querySelectorAll('.when-bar i')];
    fills.forEach((f, i) => { f.style.setProperty('--i', String(Math.min(i, 7))); f.classList.add('when-grow'); });
    return () => fills.forEach((f) => f.classList.remove('when-grow'));
  });
}

async function load() {
  const [list, patterns, cfg] = await Promise.all([
    window.occlara.listReviews(game), window.occlara.getPatterns(game),
    window.occlara.getConfig().catch(() => null),
  ]);
  riotId = String((cfg && cfg.riotId) || '').trim();
  const rows = Array.isArray(list) ? list : [];
  const host = $('list');
  closeMenu(false);
  host.replaceChildren();
  const eyes = rows.some((m) => m.aiLog === 'kept' || m.aiLog === 'gone');
  const marks = (patterns && patterns.progress && patterns.progress.marks) || {};
  // Each graded row's change since the graded row under it (older), and
  // "First" for the oldest graded one.
  const deltas = {};
  const graded = rows.filter((m) => !m.work && m.grade && Number.isFinite(Number(m.grade.score)));
  graded.forEach((m, i) => {
    const older = graded[i + 1];
    deltas[m.id] = older ? Number(m.grade.score) - Number(older.grade.score) : 'first';
  });
  const painted = rows.map((m) => row(m, { gutter: eyes, marks: marks[m.id], delta: deltas[m.id] }));
  for (const r of painted) host.append(r);
  // THE ROWS RISE ONCE, as this game's list first appears on screen (.rise,
  // matches.css): 40ms apart, the stagger capped at the sixth row, and only
  // once the page is shown (embed.js occlaraOnShown), so it is seen. A repaint
  // after that, a review saved or improved, draws the rows as they are.
  if (painted.length && host.dataset.risen !== game) {
    host.dataset.risen = game;
    const rise = () => painted.forEach((r, i) => {
      if (r.parentNode !== host) return;   // painted again meanwhile
      r.style.setProperty('--i', String(Math.min(i, 5)));
      r.classList.add('rise');
    });
    if (typeof window.occlaraOnShown === 'function') window.occlaraOnShown(rise); else rise();
  }
  $('empty').hidden = rows.length > 0;
  paintChart(rows, deltas);
  paintWhen(rows);
  // The list's own heading, once a card stands over it.
  $('list-title').hidden = !rows.length || ($('m-chart').hidden && $('when').hidden);
  paintRR(game);
  paintPatterns(patterns || { matches: 0, enough: false, grades: [], categories: [], average: null });
  paintBf();
  await loadBreakdown();
}

// A page of the main window has no window of its own to close: the sidebar is
// how a player leaves it.
const closeWindow = () => { if (!(window.occlaraEmbedded && window.occlaraEmbedded())) window.occlara.close(); };
$('close').addEventListener('click', closeWindow);
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeWindow(); });

// ONE SURFACE, TWO PAGES (8.1; the Breakdown page folded into Patterns in
// 8.7). As a page of the main window the library shows one section, named
// by its query, and is titled for it.
const SECTION_TITLES = { list: 'Matches', patterns: 'Patterns' };
// ORBIT: each section's grey sub line under its title.
const SECTION_SUBS = { list: 'Every match you played, the newest first.', patterns: 'What keeps repeating across your matches, and how each match compares.' };
{
  const section = document.documentElement.dataset.section;
  const title = SECTION_TITLES[section];
  const h = document.querySelector('.sheet > header .h-brand h2');
  if (title && h) { h.textContent = title; document.title = `Occlara ${title}`; }
  const sub = document.querySelector('.sheet > header .page-sub');
  if (sub && SECTION_SUBS[section]) sub.textContent = SECTION_SUBS[section];
}

(async () => {
  const state = await window.occlara.getState().catch(() => null);
  const games = window.occlara.games();
  game = (state && state.gameId) || (games[0] && games[0].id) || 'valorant';
  paintTabs(games);
  segment($('b-dims'));
  segment($('b-queues'));
  await load();
  backfill = await window.occlara.getBackfill().catch(() => null);
  paintBf();
  const importNow = await window.occlara.getImport(false).catch(() => null);
  if (importNow && importNow.status) imp = importNow.status;
  paintImport();
  window.occlara.onImport((s) => takeImport(s));
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
  // A row folding away after a delete holds the repaint until it is gone.
  window.occlara.onReviews(() => { if (leaving) { loadAfter = true; return; } load(); });
  // A review still being built moving on, or whole at last (8.4.1): its row
  // says it is being checked, or shows its grade.
  if (typeof window.occlara.onReviewWork === 'function') window.occlara.onReviewWork(() => load());
  window.occlara.onGame((g) => { if (g && g.id) { game = g.id; paintTabs(games); load(); paintImport(); } });
  console.log('[matches] ready');
})();
