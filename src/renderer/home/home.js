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

// Dates, times and counts in the interface's language (shared/intl.js), with
// a plain fallback where it is not loaded.
const INTL = window.occlaraIntl || null;
const isWin = (result) => /vict|win/i.test(String(result || ''));
const isLoss = (result) => /defeat|loss/i.test(String(result || ''));

/** "+24 RR", "-15 RR", "0 RR", as the Stats rank tile writes it. */
const rrText = (change) => `${change > 0 ? '+' : ''}${change} RR`;
/** A gain in --good, a loss in --bad, no change dim (home.css). */
const rrTone = (change) => (change > 0 ? 'gain' : change < 0 ? 'loss' : 'even');

/** "Nov 8" and "11:11 AM", the margin's two lines for a match. */
function dayOf(at) {
  if (!at) return '';
  return INTL ? INTL.date(at) : new Date(at).toLocaleDateString([], { month: 'short', day: 'numeric' });
}
function timeOf(at) {
  if (!at) return '';
  return INTL ? INTL.time(at) : new Date(at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}
/** "3 hours ago", "yesterday", then a short date: when a recent match was. */
function agoOf(at) {
  if (!at) return '';
  return INTL ? INTL.ago(at) : dayOf(at);
}
/** One whole sentence for a count (shared/intl.js plural), English without it. */
function plural(n, messages, values) {
  if (INTL) return INTL.plural(n, messages, values);
  const msg = n === 1 && messages.one ? messages.one : messages.other;
  return String(msg).replace(/\{(\w+)\}/g, (m, k) => (k === 'n' ? String(n) : values && k in values ? String(values[k]) : m));
}

/** Agent and mode, the second line of a recent row: "Jett, Competitive". */
function whoHow(m) {
  const who = m.title || '';
  const mode = m.mode || '';
  if (who && mode) return `${who}, ${mode}`;
  return who || mode;
}

/**
 * Who and where, as the line says it: "Jett on Abyss, Standard". Each case is
 * its own whole string, never words glued around a missing part.
 */
function whoWhere(m) {
  const who = m.title || '';
  const where = m.map || '';
  const mode = m.mode || '';
  if (who && where && mode) return `${who} on ${where}, ${mode}`;
  if (who && where) return `${who} on ${where}`;
  if (who && mode) return `${who}, ${mode}`;
  if (where && mode) return `${where}, ${mode}`;
  return who || where || mode;
}

/**
 * THE LAST MATCH AS ONE LINE (8.8). The margin holds when it was; the line
 * reads as a sentence, "Victory 13 : 11, Jett on Abyss, Standard, 71 B", the
 * grade's number and letter (the shared card's top, moved onto the line) at
 * its end, and its two buttons at the right. Under it the four categories as
 * a compact ruled table, then the milestone with the pen's tick beside it.
 * STILL BEING CHECKED (8.4.1): its result, score and grade are the screen's
 * until the review is whole, and Riot's record changes them minutes later, so
 * the section says what it waits for in their place, as its review page
 * shows a loading screen.
 *
 * @param milestone  the last match against the ones before it (8.7,
 *   home-model.js milestone, progress.js libraryProgress latest): one finished
 *   line, { kind, tone, text }, drawn as the review draws its progress strip
 *   (GradeView.progressStrip). Left out while the match is still being
 *   checked, since its grade is not yet its own.
 */
function paintLast(last, milestone) {
  const host = $('last');
  host.replaceChildren();
  const top = el('div', 'last-top');
  const mg = el('div', 'mg last-when');
  mg.append(el('span', 'label', 'Last match'));
  if (last.at) mg.append(el('span', 'mg-day', dayOf(last.at)), el('span', 'mg-time', timeOf(last.at)));
  top.append(mg);
  // Read as one sentence: "Victory 13 : 11, Jett on Abyss, Standard". The
  // parts are inline text, the comma a word of the sentence, never a gap.
  const line = el('p', 'last-line');
  const said = [];
  if (last.result && !last.work) said.push(el('span', 'result ' + (isWin(last.result) ? 'win' : isLoss(last.result) ? 'loss' : ''), last.result));
  if (last.score && !last.work) said.push(el('span', 'score', String(last.score).replace(/\s*-\s*/, ' : ')));
  const meta = whoWhere(last);
  const outcome = el('span', 'outcome');
  said.forEach((s, i) => { if (i) outcome.append(' '); outcome.append(s); });
  if (said.length) line.append(outcome);
  if (meta) {
    if (said.length) line.append(', ');
    line.append(el('span', 'meta', meta));
  }
  top.append(line);
  host.append(top);
  const strip = milestone && !last.work ? GV.progressStrip({ lines: [milestone] }) : null;
  if (strip) {
    strip.classList.add('last-prog');
    host.append(strip);
  }

  const checking = last.work ? GV.checking(last.work, { full: true }) : null;
  if (checking) host.append(checking);
  else if (last.grade) {
    const card = GV.gradeCard({ ...last.grade, categories: last.categories || [] }, { label: 'Match grade', table: true });
    // The number and the letter end the line; the categories stay below.
    const gTop = card.querySelector('.gv-top');
    if (gTop) line.append(' ', gTop);
    host.append(card);
  }

  /*
   * THE FOOT CARRIES TWO BUTTONS AND NOTHING ELSE (8.2.1): the eye, "View
   * match", which opens the match's AI log as its row in Matches does, and
   * Open review, Home's one primary. No eye where nothing was recorded, a
   * match graded from Riot's record alone, and a disabled one with its
   * reason once the log no longer holds the match: the rule every eye
   * follows (shared/log-eye.js).
   */
  const foot = el('div', 'last-foot');
  const eye = window.LogEye ? window.LogEye.labelled(last.aiLog, () => window.occlara.openAiLog(last.id), 'View match') : null;
  if (eye) foot.append(eye);
  // While the review is still being written it opens on its loading page, so
  // it is not the page's call to action yet: a quiet rectangle until it is
  // whole (8.8 critique).
  const open = el('button', last.work ? 'btn btn-secondary' : 'btn btn-primary', 'Open review');
  open.type = 'button';
  open.addEventListener('click', () => window.occlara.openReview(last.id));
  foot.append(open);
  host.append(foot);
}

/*
 * THE GRADE OVER THE LAST MATCHES, WRITTEN (8.8). Four or five numbers are
 * not a chart: the trend is one line of figures, oldest first, "58, 61, 64,
 * 71", the way a coach jots them down, and the pen ticks the best of them
 * (penMark). The sentence before them says what they are and which was best,
 * so the tick always has its words. The average stands in the block's margin.
 */
function paintTrend(trend, average) {
  const host = $('trend');
  const shown = trend.length >= 2;
  host.hidden = !shown;
  host.replaceChildren();
  // "Average 75": the word in Geist, the figure in the mono face.
  const avg = $('trend-avg');
  avg.replaceChildren();
  avg.hidden = !(shown && typeof average === 'number');
  if (!avg.hidden) avg.append(el('span', 'mg-word', 'Average'), ' ', el('span', 'mg-num', String(average)));
  if (!shown) return;
  const scores = trend.map((t) => Number(t.score));
  const best = Math.max(...scores);
  host.append(el('span', 'trend-say', plural(trend.length,
    { one: 'Your last grade, best {best}', other: 'Your last {n} grades, oldest first, best {best}' }, { best })));
  const figs = el('span', 'trend-figs');
  trend.forEach((t, j) => {
    const fig = el('span', 'trend-fig ' + GV.gradeTone(t), String(t.score));
    if (t.map) fig.title = `${t.map}: ${t.score}`;
    // The newest best, if two tie: the one the pen ticks.
    if (Number(t.score) === best && scores.lastIndexOf(best) === j) fig.classList.add('best');
    figs.append(fig);
    if (j < trend.length - 1) figs.append(el('span', 'trend-sep', ','));
  });
  host.append(figs);
}

function paintRecent(recent) {
  const host = $('recent-list');
  host.replaceChildren();
  recent.forEach((m) => {
    const b = el('button', 'r-row');
    b.type = 'button';
    b.setAttribute('role', 'listitem');
    b.dataset.id = m.id;
    // When it was, in the block's margin, as the notebook keeps its dates.
    const at = el('span', 'r-when', agoOf(m.at));
    if (m.at) at.title = `${dayOf(m.at)}, ${timeOf(m.at)}`;
    b.append(at);
    const main = el('span', 'r-main');
    const title = el('span', 'r-title', m.map || m.title || 'Match');
    // Still being checked (8.4.1): the screen's result and grade are not said
    // until Riot's record has had its say, the pill in their place.
    if (m.result && !m.work) {
      title.append(el('span', 'r-res ' + (isWin(m.result) ? 'win' : isLoss(m.result) ? 'loss' : ''),
        [m.result, m.score].filter(Boolean).join(' ')));
    }
    // No badges here (8.8): a best is the pen's tick on the trend above, and
    // Matches keeps the row badges, so the fact is said once on this page.
    main.append(title);
    const meta = whoHow(m);
    if (meta) main.append(el('span', 'r-meta', meta));
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
  });
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
 * WHERE THE RANK SITS (8.8): after the last match, always. To 8.7 it moved
 * above the grade trend when the column beside the last match was full; the
 * notebook is one column, so there is no room to balance and it keeps its
 * place in the order (home.css).
 */
function placeRank() {
  const rank = $('rank');
  if (rank.parentNode !== $('side')) $('focus').after(rank);
}

/** The side column closes up as its cards go, and goes itself when none is shown. */
function closeUp() {
  const col = $('side');
  col.hidden = [...col.children].every((c) => c.hidden);
}

/*
 * THE ARRIVAL ENDS (8.7). card-in is each section's one entrance (home.css,
 * 8.8: an opacity fade, nothing inside it moves). The class is taken off once
 * the fade is through, so a repaint (a review saved: load() with no arrive)
 * never plays it again; its end state is the natural state, so nothing
 * visible changes when it goes.
 */
const ARRIVAL_MS = 400;
let arrivalEnd = null;
function endArrival(cards) {
  clearTimeout(arrivalEnd);
  arrivalEnd = setTimeout(() => {
    arrivalEnd = null;
    for (const c of cards) c.classList.remove('card-in');
  }, ARRIVAL_MS);
}

/** A card shown after the others arrived fades in by itself, as they did. */
function rise(card) {
  card.classList.remove('card-in');
  void card.offsetWidth;   // taken off and put back, so it plays again
  card.style.setProperty('--i', '0');
  card.classList.add('card-in');
  endArrival([...document.querySelectorAll('.home .card.card-in')]);
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
 * THE CARDS ARRIVE (8.2; 8.8 together, one fade each, no stagger), the first
 * time Home is painted and on a change of game, never when a review saved in
 * the meantime repaints it. --i is kept as each card's place for the tests.
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
    endArrival(cards);
  };
  if (typeof window.occlaraOnShown === 'function') window.occlaraOnShown(run); else run();
}

/*
 * THE COACH'S PEN ON HOME (8.8, shared/marks.js): the underline under the fix
 * for the next match and one tick, over the best of the written grades (it
 * takes no width, so the run of figures keeps its commas). Two marks at most,
 * never on a button or the nav. The milestone line beside the last match is
 * not ticked as well (8.8 critique: the same stamp twice on one screen reads
 * as an icon font, not a pen).
 *
 * Still on every paint. Drawn in once, on the FIRST PAINT AFTER A MATCH: the
 * first time this page is on screen (occlaraOnShown) with a last match whose
 * review is whole and that the pen has not drawn for yet, remembered by its
 * id. marks.js draws only with motion allowed and main saying coaching is
 * off; a match whose review is still being checked, or a fix carried over
 * from the review before it, is marked still and waits.
 */
const PEN_KEY = 'occlara.home.penDrawn';
let penAsk = 0;
function penSeen() {
  try { return window.localStorage ? window.localStorage.getItem(PEN_KEY) : null; } catch (e) { return null; }
}
function penKeep(id) {
  try { if (window.localStorage) window.localStorage.setItem(PEN_KEY, String(id)); } catch (e) { /* kept for this paint only */ }
}

/** The pen's marks on the page as painted, with fresh asking them to draw in. */
function penMark(model, fresh) {
  const pen = window.occlaraPen;
  if (!pen) return;
  const fix = $('focus-text');
  if (model && model.focus && !$('focus').hidden) {
    pen.mark(fix, 'underline', { text: model.focus, draw: fresh, lines: 'last' });
  } else pen.clear(fix);
  const prog = $('last').querySelector('.last-prog .gv-prog.good');
  if (prog) pen.clear(prog);
  const best = $('trend').hidden ? null : $('trend').querySelector('.trend-fig.best');
  if (best) {
    best.classList.add('ticked');
    pen.mark(best, 'tick', { text: `best ${best.textContent}`, draw: fresh, delay: fresh ? 320 : 0, place: 'above' });
  }
}

function penStill(model) {
  const ask = ++penAsk;
  penMark(model, false);
  const last = model && model.last;
  const whole = !!(last && last.id && !last.work && !model.focusPrevious);
  if (!whole || penSeen() === String(last.id)) return;
  const draw = () => {
    if (ask !== penAsk) return;   // a newer paint has marked the page since
    penKeep(last.id);
    penMark(model, true);
  };
  if (typeof window.occlaraOnShown === 'function') window.occlaraOnShown(draw); else draw();
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
  if (!has) return true;
  paintLast(model.last, model.milestone || null);
  // THE FIX STAYS THE HERO WHILE A REVIEW IS WRITTEN (8.7): the last whole
  // review's fix, its label saying so (home.css #focus.previous), rather
  // than the page opening on the chart while the newest is still checked.
  $('focus').hidden = !model.focus;
  $('focus-was').hidden = !model.focusPrevious;
  $('focus-text').textContent = model.focus || '';
  $('top').hidden = !model.top;
  if (model.top) {
    $('top-title').textContent = model.top.title;
    $('top-trend').textContent = model.top.trend === 'rising' ? 'More often lately'
      : model.top.trend === 'falling' ? 'Less often lately' : model.top.trend === 'steady' ? 'Steady' : '';
    $('top-trend').className = 'trend' + (model.top.trend === 'rising' ? ' rising' : '');
    $('top-detail').textContent = model.top.detail;
    $('top-fix').textContent = model.top.fix || '';
    $('top-fix').hidden = !model.top.fix;
  }
  placeRank();
  paintTrend(model.trend || [], model.average);
  closeUp();
  paintRecent(model.recent || []);
  penStill(model);
  return true;
}

$('top-more').addEventListener('click', () => window.occlara.go('patterns'));
$('recent-all').addEventListener('click', () => window.occlara.go('matches'));
// Stats with the journey open, which this button names (8.4.1): it opened
// Stats with the journey folded in the Rank tile, one more click away.
$('rank-more').addEventListener('click', () => window.occlara.openRankJourney());
// The games left (8.7) are the rail's line under Start (shell.js), said once;
// Home carries no copy of it.

/*
 * LISTENING BEFORE THE FIRST PAINT (8.2.1). The first load waits for the rank,
 * a network read that can take fifteen seconds, and with the listeners set up
 * after it, a game picked in the sidebar meanwhile was never heard (PUSH_GAME
 * comes once, on the change), and Home stayed on the game left behind for the
 * session. So they are set up as soon as the state says which game Home is
 * for, and a paint overtaken by a newer one paints nothing (paint()).
 */
/*
 * THE UPDATE LINE: "Occlara updated to 8.7.3." and See what's new, main's
 * words, said once after an update (index.js changelogIpc). Main answers null
 * mid match or while sealed and pushes the line once the seal lifts; the line
 * counts as seen only once this page is on screen with it.
 */
function paintNews(n) {
  const line = n && typeof n.text === 'string' && n.text ? n : null;
  const host = document.getElementById('h-news');
  if (!host) return;
  host.hidden = !line;
  if (!line) return;
  document.getElementById('h-news-text').textContent = line.text;
  document.getElementById('h-news-open').textContent = line.link || "See what's new";
  const seen = () => { if (typeof window.occlara.newsSeen === 'function') window.occlara.newsSeen(line.version); };
  if (typeof window.occlaraOnShown === 'function') window.occlaraOnShown(seen); else seen();
}
document.getElementById('h-news-open').addEventListener('click', () => {
  if (typeof window.occlara.openWhatsNew === 'function') window.occlara.openWhatsNew();
});
if (typeof window.occlara.onNews === 'function') window.occlara.onNews(paintNews);
if (typeof window.occlara.getNews === 'function') {
  Promise.resolve(window.occlara.getNews()).then((n) => { if (n) paintNews(n); }).catch(() => {});
}

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
