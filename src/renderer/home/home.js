'use strict';

/*
 * Home: paints what src/shared/home-model.js read from the library (the
 * preload hands it over whole). textContent only, because the focus line and
 * the mistake titles come from reviews a model helped write.
 */

const $ = (id) => document.getElementById(id);
const GV = window.GradeView;
const el = (tag, cls, text) => GV.el(tag, cls, text);
const SVG = 'http://www.w3.org/2000/svg';

let game = 'valorant';
let cfg = null;
// The RR of each rated match, by review id, from the last rank answer, kept so
// a repaint shows them at once instead of blinking out until it is asked again.
let rr = {};
// Every paint asks for the rank again, and only the newest answer is painted.
let rankAsk = 0;
// And every paint reads the library again, and only the newest read is
// painted: a change of game while the last read was out left that one to land
// after it, painting the game left behind under the new game's name.
let paintAsk = 0;
// The cards are to arrive with the next paint that lands (arrive()), so a
// paint that was to bring them in and was overtaken hands that on.
let arriving = false;

/*
 * THE NEWEST RATED MATCH WITHOUT ITS RR (8.2.1) is asked about again once the
 * five minutes main and the server each keep the history are over, at most
 * twice after a paint (home-model.js rrWaiting says which match and why):
 * Riot puts the game in the history minutes after the match, after the reads
 * its review's saves make. Each paint sets it going again.
 */
const RANK_AGAIN_MS = 6 * 60 * 1000;
const RANK_AGAIN_TRIES = 2;
let rankAgain = null;
let rankTries = 0;

function when(at) {
  if (!at) return '';
  return new Date(at).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}
const isWin = (result) => /vict|win/i.test(String(result || ''));
const isLoss = (result) => /defeat|loss/i.test(String(result || ''));

/** "+24 RR", "-15 RR", "0 RR", as the Stats rank tile writes it. */
const rrText = (change) => `${change > 0 ? '+' : ''}${change} RR`;
/** A gain in --good, a loss in --red, no change dim (home.css). */
const rrTone = (change) => (change > 0 ? 'gain' : change < 0 ? 'loss' : 'even');

function paintLast(last) {
  const host = $('last');
  host.replaceChildren();
  const top = el('div', 'last-top');
  const facts = el('div', 'last-facts');
  facts.append(el('span', 'label', `Last match${last.at ? ', ' + when(last.at) : ''}`));
  // STILL BEING CHECKED (8.4.1): its result, score and grade are the screen's
  // until the review is whole, and Riot's record changes them minutes later,
  // so the card says what it waits for in their place, as its review page
  // shows a loading screen.
  if (last.result && !last.work) facts.append(el('span', 'result ' + (isWin(last.result) ? 'win' : isLoss(last.result) ? 'loss' : ''), last.result));
  if (last.score && !last.work) facts.append(el('span', 'score', String(last.score).replace(/\s*-\s*/, ' : ')));
  const meta = [last.title, last.map, last.mode].filter(Boolean).join('  ·  ');
  if (meta) facts.append(el('span', 'meta', meta));
  top.append(facts);
  host.append(top);

  const checking = last.work ? GV.checking(last.work, { full: true }) : null;
  if (checking) host.append(checking);
  else if (last.grade) host.append(GV.gradeCard({ ...last.grade, categories: last.categories || [] }, { label: 'Match grade' }));

  /*
   * THE FOOT CARRIES TWO BUTTONS AND NOTHING ELSE (8.2.1): the eye, "View
   * match", which opens the match's AI log as its row in Matches does, and
   * Open review. It used to say where the grade came from ("From what the
   * screen read", "Checked against Riot's record of the match"), which the
   * review itself says. No eye where nothing was recorded, a match graded
   * from Riot's record alone, and a disabled one with its reason once the log
   * no longer holds the match: the rule every eye follows (shared/log-eye.js).
   */
  const foot = el('div', 'last-foot');
  const eye = window.LogEye ? window.LogEye.labelled(last.aiLog, () => window.occlara.openAiLog(last.id), 'View match') : null;
  if (eye) foot.append(eye);
  const open = el('button', 'btn btn-ghost', 'Open review');
  open.type = 'button';
  open.addEventListener('click', () => window.occlara.openReview(last.id));
  foot.append(open);
  host.append(foot);
}

/*
 * THE GRADE OVER THE LAST MATCHES FILLS ITS CARD (8.2.1). The card stands
 * beside Recent matches, which sets the row's height, and bars drawn in a
 * fixed 150px left a band of empty card under them. Now the bars' area grows
 * to the card's foot, each bar is its grade as a share of that whole height,
 * and the number is positioned off the bar's top instead of stacked above it
 * in one column, which took its own height out of the bar's (the cap that
 * flattened the library's trend, matches.css .p-bar).
 */
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
    const track = el('div', 'bar-track');
    track.style.setProperty('--h', `${Math.max(4, Math.min(100, Number(t.score) || 0))}%`);
    track.append(el('div', 'bar ' + GV.gradeTone(t)), el('span', 'bar-num', String(t.score)));
    col.append(track, el('span', 'bar-map', t.map || ''));
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
    b.dataset.id = m.id;
    const main = el('span', 'r-main');
    const title = el('span', 'r-title', m.map || m.title || 'Match');
    // Still being checked (8.4.1): the screen's result and grade are not said
    // until Riot's record has had its say, the pill in their place.
    if (m.result && !m.work) {
      title.append(el('span', 'r-res ' + (isWin(m.result) ? 'win' : isLoss(m.result) ? 'loss' : ''),
        [m.result, m.score].filter(Boolean).join(' ')));
    }
    main.append(title);
    main.append(el('span', 'r-meta', [when(m.at), m.title, m.mode,
      m.source === 'riot' ? "from Riot's record" : m.verified ? "checked against Riot's record" : null].filter(Boolean).join('  ·  ')));
    b.append(main);
    // The RR the match moved, beside its grade, once the rank has answered
    // (fillRank): a match Riot's record calls Competitive, placed on its own
    // game in the rank history (home-model.js rrForRows).
    b.append(el('span', 'r-rr'));
    const checking = m.work ? GV.checking(m.work) : null;
    const g = m.grade;
    if (checking) b.append(checking);
    else {
      b.append(el('span', 'r-score', g ? String(g.score) : '--'));
      b.append(el('span', 'gv-letter ' + (g ? GV.gradeTone(g) : 'none'), g ? g.letter : '?'));
    }
    b.addEventListener('click', () => window.occlara.openReview(m.id));
    host.append(b);
  }
  paintRowRR();
}

/** Each recent match's RR from the last rank answer; nothing where none is known. */
function paintRowRR() {
  for (const b of $('recent-list').querySelectorAll('.r-row')) {
    const span = b.querySelector('.r-rr');
    if (!span) continue;
    const change = rr[b.dataset.id];
    const known = typeof change === 'number' && Number.isFinite(change);
    span.hidden = !known;
    span.textContent = known ? rrText(change) : '';
    span.className = 'r-rr' + (known ? ' ' + rrTone(change) : '');
    span.title = known ? 'RR from this match' : '';
  }
}

/*
 * THE RANK (8.2.1), Valorant's, with a Riot ID: the rank the newest rated game
 * left, the RR the last one moved, and the rank journey as a line, by the rules
 * Stats keeps (home-model.js rankModel), and a way to the journey itself on
 * Stats. Filled in once the page is painted, because the history can be a
 * network read away, and gone, the column closing up, without a rated game.
 */
function paintRank(card) {
  const host = $('rank');
  const was = host.hidden;
  host.hidden = !card;
  if (card) {
    $('rank-tier').textContent = card.tier;
    const span = $('rank-rr');
    const known = typeof card.change === 'number' && Number.isFinite(card.change);
    span.hidden = !known;
    span.textContent = known ? rrText(card.change) : '';
    span.className = 'rank-rr' + (known ? ' ' + rrTone(card.change) : '');
    paintLine(card);
  }
  closeUp();
  if (was && card) rise(host);
}

/**
 * The journey as a line, oldest game on the left, the newest a dot at its end.
 * Drawn on a 100 by 40 box stretched to the card (preserveAspectRatio none,
 * with a stroke that does not stretch), so the dot is a span laid over it
 * rather than a circle that would stretch into an ellipse. A journey that
 * barely moved is drawn level through the middle rather than along the floor.
 */
function paintLine(card) {
  const host = $('rank-line');
  host.replaceChildren();
  const line = Array.isArray(card.line) ? card.line.filter((e) => Number.isFinite(e)) : [];
  host.hidden = line.length < 2;
  if (host.hidden) { host.removeAttribute('aria-label'); return; }
  const W = 100, H = 40, PAD = 5;
  const lo = Math.min(...line), hi = Math.max(...line);
  const mid = (lo + hi) / 2;
  const half = Math.max((hi - lo) / 2, 10);
  const x = (i) => (i / (line.length - 1)) * W;
  const y = (e) => H / 2 - ((e - mid) / half) * (H / 2 - PAD);
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.setAttribute('preserveAspectRatio', 'none');
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS(SVG, 'path');
  path.setAttribute('d', line.map((e, i) => `${i ? 'L' : 'M'}${x(i).toFixed(2)} ${y(e).toFixed(2)}`).join(' '));
  path.setAttribute('vector-effect', 'non-scaling-stroke');
  svg.append(path);
  const dot = el('span', 'rank-dot');
  dot.style.top = `${((y(line[line.length - 1]) / H) * 100).toFixed(2)}%`;
  host.append(svg, dot);
  host.setAttribute('aria-label', `Rank journey over your last ${card.games} rated games, from ${card.from} to ${card.tier}`);
}

/*
 * WHERE THE RANK SITS. Under the next match's focus, in the room the last
 * match leaves beside it, where it grows to fill whatever is left (home.css).
 * With the focus AND the most repeated mistake in that column, the column is
 * the taller of the two already, and the rank there opened a band of empty
 * card inside the last match instead; so then it stands above the grade
 * trend, a card that stretches to Recent matches' height anyway. With one of
 * the two missing (a match graded from Riot's record alone has no focus) the
 * column has the room, and the rank stays in it.
 */
function placeRank() {
  const rank = $('rank');
  const full = !$('focus').hidden && !$('top').hidden;
  if (full && rank.parentNode !== $('lower')) $('lower').prepend(rank);
  else if (!full && rank.parentNode !== $('side')) $('focus').after(rank);
}

/** A column closes up as its cards go, and goes itself when none is shown. */
function closeUp() {
  for (const col of [$('side'), $('lower')]) col.hidden = [...col.children].every((c) => c.hidden);
}

/** A card shown after the others arrived rises in by itself, as they did. */
function rise(card) {
  card.classList.remove('card-in');
  void card.offsetWidth;   // taken off and put back, so it plays again
  card.style.setProperty('--i', '0');
  card.classList.add('card-in');
}

/**
 * The rank card and the recent matches' RR, asked for after the page is
 * painted. Only Valorant, and only with a Riot ID: the rank history is read
 * for the ID in Settings, and another game's Home has no rank of this kind.
 * Not asked while Home has no match to show, since nothing would show it.
 *
 * @param again  asked by its own timer for a match still waiting for its RR,
 *               not by a paint, so the tries already made still count
 */
async function fillRank(again) {
  const ask = ++rankAsk;
  clearTimeout(rankAgain);
  rankAgain = null;
  if (!again) rankTries = 0;
  const riot = game === 'valorant' && !$('content').hidden && String((cfg && cfg.riotId) || '').includes('#');
  const r = riot ? await window.occlara.getRank(game).catch(() => null) : null;
  if (ask !== rankAsk) return;   // a newer paint asked again meanwhile
  rr = (r && r.rr) || {};
  paintRank((r && r.card) || null);
  paintRowRR();
  if (r && r.waiting && rankTries < RANK_AGAIN_TRIES) {
    rankTries++;
    rankAgain = setTimeout(() => { rankAgain = null; fillRank(true); }, RANK_AGAIN_MS);
  }
}

/*
 * THE CARDS ARRIVE ONE AFTER ANOTHER (8.2), the first time Home is painted and
 * on a change of game, never when a review saved in the meantime repaints it.
 * Run once the page is on screen (embed.js), or they would play out while it
 * is still out of sight, waiting to come in.
 */
function arrive() {
  const run = () => {
    const cards = [...document.querySelectorAll('.home .card')].filter((c) => !c.hidden && !c.closest('[hidden]'));
    for (const c of cards) c.classList.remove('card-in');
    void document.body.offsetWidth;   // taken off and put back, so it plays again
    cards.forEach((c, i) => {
      c.style.setProperty('--i', String(i));
      c.classList.add('card-in');
    });
  };
  if (typeof window.occlaraOnShown === 'function') window.occlaraOnShown(run); else run();
}

/**
 * PAINTED FIRST, THEN THE RANK: the library is on this machine and the rank
 * history may be a network read away, so Home never waits for it. Asked for
 * before the cards arrive, so a card that is not this game's (the rank, after
 * a change of game) is gone before they do. A paint overtaken by a newer one
 * asks for nothing: the newer one does.
 *
 * @param opts.arrive  the cards come in one after another once painted
 */
async function load(opts) {
  if (opts && opts.arrive) arriving = true;
  if (!(await paint())) return;
  const ranked = fillRank();
  if (arriving) { arriving = false; arrive(); }
  await ranked;
}

/** @returns {Promise<boolean>} false when a newer paint was asked for meanwhile, and nothing was painted */
async function paint() {
  const ask = ++paintAsk;
  const [model, config] = await Promise.all([
    window.occlara.getHome(game).catch(() => null),
    window.occlara.getConfig().catch(() => null),
  ]);
  if (ask !== paintAsk) return false;
  cfg = config;
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
    return true;
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
    $('top-fix').parentNode.hidden = !model.top.fix;
  }
  placeRank();
  paintTrend(model.trend || [], model.average);
  closeUp();
  paintRecent(model.recent || []);
  return true;
}

$('top-more').addEventListener('click', () => window.occlara.go('patterns'));
$('recent-all').addEventListener('click', () => window.occlara.go('matches'));
// Stats with the journey open, which this button names (8.4.1): it opened
// Stats with the journey folded in the Rank tile, one more click away.
$('rank-more').addEventListener('click', () => window.occlara.openRankJourney());
$('empty-settings').addEventListener('click', () => window.occlara.go('settings'));

/*
 * LISTENING BEFORE THE FIRST PAINT (8.2.1). The first load waits for the rank,
 * a network read that can take fifteen seconds, and with the listeners set up
 * after it, a game picked in the sidebar meanwhile was never heard (PUSH_GAME
 * comes once, on the change), and Home stayed on the game left behind for the
 * session. So they are set up as soon as the state says which game Home is
 * for, and a paint overtaken by a newer one paints nothing (paint()).
 */
(async () => {
  const state = await window.occlara.getState().catch(() => null);
  game = (state && state.gameId) || 'valorant';
  let riotId = String((state && state.riotId) || '').trim();
  // A review saved or improved (Riot's record landing after the match, a match
  // graded from it) repaints Home, and so does a change of game, whose cards
  // arrive again.
  window.occlara.onReviews(() => load());
  // A review still being built moving on, or whole at last (8.4.1): its last
  // match card and its row say so, or show its grade.
  if (typeof window.occlara.onReviewWork === 'function') window.occlara.onReviewWork(() => load());
  window.occlara.onGame((g) => { if (g && g.id) { game = g.id; load({ arrive: true }); } });
  // A Riot ID changed in Settings is another account's rank, or none: the
  // state main pushes on every config write carries it, and only a change of
  // it paints Home again.
  if (typeof window.occlara.onState === 'function') {
    window.occlara.onState((s) => {
      if (!s || typeof s.riotId !== 'string' || s.riotId.trim() === riotId) return;
      riotId = s.riotId.trim();
      load();
    });
  }
  await load({ arrive: true });
  console.log('[home] ready');
})();
