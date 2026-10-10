'use strict';

/*
 * Home: paints what src/shared/home-model.js read from the library (the
 * preload hands it over whole). textContent only, because the focus line and
 * the mistake titles come from reviews a model helped write.
 */

const $ = (id) => document.getElementById(id);
const GV = window.GradeView;
const el = (tag, cls, text) => GV.el(tag, cls, text);

let game = 'valorant';

function when(at) {
  if (!at) return '';
  return new Date(at).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}
const isWin = (result) => /vict|win/i.test(String(result || ''));
const isLoss = (result) => /defeat|loss/i.test(String(result || ''));

function paintLast(last) {
  const host = $('last');
  host.replaceChildren();
  const top = el('div', 'last-top');
  const facts = el('div', 'last-facts');
  facts.append(el('span', 'label', `Last match${last.at ? ', ' + when(last.at) : ''}`));
  if (last.result) facts.append(el('span', 'result ' + (isWin(last.result) ? 'win' : isLoss(last.result) ? 'loss' : ''), last.result));
  if (last.score) facts.append(el('span', 'score', String(last.score).replace(/\s*-\s*/, ' : ')));
  const meta = [last.title, last.map, last.mode].filter(Boolean).join('  ·  ');
  if (meta) facts.append(el('span', 'meta', meta));
  top.append(facts);
  host.append(top);

  if (last.grade) host.append(GV.gradeCard({ ...last.grade, categories: last.categories || [] }, { label: 'Match grade' }));

  const foot = el('div', 'last-foot');
  const checked = last.source === 'riot' ? "Graded from Riot's record"
    : last.verified ? "Checked against Riot's record of the match" : 'From what the screen read';
  foot.append(el('span', 'checked' + (last.verified || last.source === 'riot' ? '' : ' unchecked'), checked));
  const open = el('button', 'btn btn-ghost', 'Open review');
  open.type = 'button';
  open.addEventListener('click', () => window.occlara.openReview(last.id));
  foot.append(open);
  host.append(foot);
}

function paintTrend(trend, average) {
  $('trend').hidden = trend.length < 2;
  if (trend.length < 2) return;
  $('trend-n').textContent = String(trend.length);
  $('trend-avg').textContent = typeof average === 'number' ? `Average ${average}` : '';
  const bars = $('trend-bars');
  bars.replaceChildren();
  bars.setAttribute('aria-label', `Grades ${trend.map((t) => t.score).join(', ')}, oldest first`);
  for (const t of trend) {
    const col = el('div', 'bar-col');
    col.append(el('span', 'bar-num', String(t.score)));
    const bar = el('div', 'bar ' + GV.gradeTone(t));
    bar.style.height = `${Math.max(6, Math.round((t.score / 100) * 110))}px`;
    col.append(bar);
    col.append(el('span', 'bar-map', t.map || ''));
    bars.append(col);
  }
}

function paintRecent(recent) {
  const host = $('recent-list');
  host.replaceChildren();
  for (const m of recent) {
    const b = el('button', 'r-row');
    b.type = 'button';
    b.setAttribute('role', 'listitem');
    const main = el('span', 'r-main');
    const title = el('span', 'r-title', m.map || m.title || 'Match');
    if (m.result) {
      title.append(el('span', 'r-res ' + (isWin(m.result) ? 'win' : isLoss(m.result) ? 'loss' : ''),
        [m.result, m.score].filter(Boolean).join(' ')));
    }
    main.append(title);
    main.append(el('span', 'r-meta', [when(m.at), m.title, m.mode,
      m.source === 'riot' ? "from Riot's record" : m.verified ? "checked against Riot's record" : null].filter(Boolean).join('  ·  ')));
    b.append(main);
    const g = m.grade;
    b.append(el('span', 'r-score', g ? String(g.score) : '--'));
    b.append(el('span', 'gv-letter ' + (g ? GV.gradeTone(g) : 'none'), g ? g.letter : '?'));
    b.addEventListener('click', () => window.occlara.openReview(m.id));
    host.append(b);
  }
}

async function load() {
  const [model, cfg] = await Promise.all([
    window.occlara.getHome(game).catch(() => null),
    window.occlara.getConfig().catch(() => null),
  ]);
  const games = window.occlara.games();
  const g = games.find((x) => x.id === game);
  $('h-game').textContent = g ? g.label : '';
  const has = !!(model && model.last);
  $('empty').hidden = has;
  $('content').hidden = !has;
  if (!has) {
    // Only Valorant is graded from Riot's record, and only with a Riot ID.
    const noRiot = game === 'valorant' && !String((cfg && cfg.riotId) || '').includes('#');
    $('empty-riot').hidden = !noRiot;
    $('empty-settings').hidden = !noRiot;
    return;
  }
  paintLast(model.last);
  $('focus').hidden = !model.focus;
  $('focus-text').textContent = model.focus || '';
  $('top').hidden = !model.top;
  if (model.top) {
    $('top-title').textContent = model.top.title;
    $('top-trend').textContent = model.top.trend === 'rising' ? 'More often lately'
      : model.top.trend === 'falling' ? 'Less often lately' : model.top.trend === 'steady' ? 'Steady' : '';
    $('top-trend').className = 'trend' + (model.top.trend === 'rising' ? ' rising' : '');
    $('top-detail').textContent = model.top.detail;
    $('top-fix').textContent = model.top.fix || '';
    $('top-fix').parentElement.hidden = !model.top.fix;
  }
  paintTrend(model.trend || [], model.average);
  paintRecent(model.recent || []);
}

$('top-more').addEventListener('click', () => window.occlara.go('patterns'));
$('recent-all').addEventListener('click', () => window.occlara.go('matches'));
$('empty-settings').addEventListener('click', () => window.occlara.go('settings'));

(async () => {
  const state = await window.occlara.getState().catch(() => null);
  game = (state && state.gameId) || 'valorant';
  await load();
  // A review saved or improved (Riot's record landing after the match, a match
  // graded from it) repaints Home, and so does a change of game.
  window.occlara.onReviews(() => load());
  window.occlara.onGame((g) => { if (g && g.id) { game = g.id; load(); } });
  console.log('[home] ready');
})();
