'use strict';

/**
 * The match library: what keeps happening across matches, then every match.
 *
 * Everything shown is read from saved reviews. Patterns need two matches of one
 * game before they say anything, and the page says that rather than showing an
 * empty frame, because an empty frame reads as broken.
 */

const $ = (id) => document.getElementById(id);
const { el, tone, scoreTone } = window.GradeView;

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

/** One bar per graded match, oldest on the left. */
function paintTrend(grades) {
  const host = $('p-trend');
  host.replaceChildren();
  host.hidden = grades.length < 2;
  for (const g of grades.slice().reverse()) {
    const bar = el('div', 'p-bar');
    bar.title = `${fmtWhen(g.at)}: ${g.score} (${g.letter})${g.provisional ? ', provisional' : ''}`;
    const fill = el('i', scoreTone(g.score) + (g.provisional ? ' prov' : ''));
    fill.style.setProperty('--h', Math.max(4, g.score) + '%');
    bar.append(el('span', null, g.score), fill);
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
    // How often across matches, then the latest sighting in its own words,
    // labelled, so its round numbers are not read as belonging to every match.
    detail: `In ${p.matches} of your last ${total} matches.`
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
  if (!p.enough) {
    $('p-sub').textContent = p.matches
      ? 'One match reviewed. After the next one, this shows what repeats.'
      : 'Play two matches and this shows what keeps happening across them.';
    return;
  }
  $('p-sub').textContent = `Across your last ${p.matches} matches. A pattern needs two of them to count.`;
  const view = window.GradeView.insightLists({
    mistakes: p.mistakes.map((x) => asItem(x, p.matches)),
    strengths: p.strengths.map((x) => asItem(x, p.matches)),
    missed: p.missed.map((x) => asItem(x, p.matches)),
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

function row(m) {
  const b = el('button', 'm-row');
  b.type = 'button';
  b.setAttribute('role', 'listitem');
  const main = el('div', 'm-main');
  const top = el('div', 'm-top');
  top.append(el('span', 'm-title', m.title || 'Unknown'));
  if (m.result) {
    top.append(el('span', 'm-res ' + (/vict|win/i.test(m.result) ? 'win' : /defeat|loss/i.test(m.result) ? 'loss' : ''),
      [m.result, m.score].filter(Boolean).join(' ')));
  }
  main.append(top);
  main.append(el('div', 'm-meta', [fmtWhen(m.at), m.map, m.mode, m.verified ? "checked against Riot's record" : null]
    .filter(Boolean).join('  ·  ')));
  if (m.topMistake) main.append(el('div', 'm-top-mistake', `Top mistake: ${m.topMistake}`));

  const side = el('div', 'm-side');
  const ask = el('span', 'btn btn-ghost m-ask', 'Ask');
  ask.title = 'Ask Coach about this match';
  ask.addEventListener('click', (e) => { e.stopPropagation(); window.occlara.askAbout(m.id); });
  side.append(ask);
  const grade = el('div', 'm-grade');
  const g = m.grade;
  grade.append(el('span', 'm-score', g ? g.score : '--'));
  grade.append(el('span', 'm-letter ' + (g ? tone(g.letter) : 'none'), g ? g.letter : '?'));
  if (g && g.provisional) grade.title = 'Provisional: some of the record was missing';
  side.append(grade);
  b.append(main, side);
  b.addEventListener('click', () => window.occlara.openReview(m.id));
  return b;
}

async function load() {
  const [list, patterns] = await Promise.all([
    window.occlara.listReviews(game), window.occlara.getPatterns(game),
  ]);
  const rows = Array.isArray(list) ? list : [];
  const host = $('list');
  host.replaceChildren();
  rows.forEach((m, i) => {
    const r = row(m);
    r.style.animationDelay = Math.min(i * 40, 360) + 'ms';
    host.append(r);
  });
  $('empty').hidden = rows.length > 0;
  paintPatterns(patterns || { matches: 0, enough: false, grades: [], categories: [], average: null });
}

$('close').addEventListener('click', () => window.occlara.close());
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') window.occlara.close(); });

(async () => {
  const state = await window.occlara.getState().catch(() => null);
  const games = window.occlara.games();
  game = (state && state.gameId) || (games[0] && games[0].id) || 'valorant';
  paintTabs(games);
  await load();
  // A review saved or improved while this is open (Riot's record landing a few
  // minutes after the match) repaints the list and the patterns.
  window.occlara.onReviews(() => load());
  window.occlara.onGame((g) => { if (g && g.id) { game = g.id; paintTabs(games); load(); } });
  console.log('[matches] ready');
})();
