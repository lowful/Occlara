'use strict';

/*
 * THE PRACTICE PAGE. Paints what main wrote (src/shared/practice.js
 * planView): the plan from the player's own repeated mistakes, the drills
 * under each as cards, whether each mistake is shrinking, the days practised
 * and the log. Nothing here counts or words a fact: every title, line and
 * number is main's. textContent only, since a mistake's title and fix come
 * from reviews a model helped write.
 *
 * Its two writes are a drill marked practised and a log entry taken out,
 * both kept on this PC, and both refused by main mid match (the page is
 * locked by the seal then anyway).
 *
 * MOTION: the page's sections rise once per visit (shared/motion.js), only
 * on screen and never under reduced motion; a repaint draws them as they are.
 */

const $ = (id) => document.getElementById(id);
const api = window.occlara || {};

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined && text !== null) n.textContent = String(text);
  return n;
}

let game = 'valorant';
let view = null;
let ask = 0;
// The mistake the review asked the page to open on ({ key, title }), kept
// for the visit and handed back on every ask, so a repaint keeps it.
let asked = null;
// Scrolled to once, as it is first painted.
let scrollTo = false;
let busy = false;

function fmtDay(at) {
  return new Date(at).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
}

// ── A drill, as a card ────────────────────────────────────────────────────
function drillCard(d) {
  const card = el('article', 'pc-drill');
  card.dataset.drill = d.id;
  const meta = el('div', 'pc-d-meta');
  if (d.where) meta.append(el('span', 'pc-where', d.where));
  if (d.minutes) meta.append(el('span', 'pc-min', `${d.minutes} min`));
  card.append(meta, el('h4', 'pc-d-title', d.title));
  if (d.why) card.append(el('p', 'pc-why', d.why));
  const steps = el('ol', 'pc-steps');
  for (const s of d.steps || []) steps.append(el('li', null, s));
  card.append(steps);
  const facts = el('dl', 'pc-facts');
  const fact = (term, text) => {
    if (!text) return;
    const row = el('div', 'pc-fact');
    row.append(el('dt', null, term), el('dd', null, text));
    facts.append(row);
  };
  fact('Goal', d.goal);
  fact('How you will know', d.check);
  if (facts.children.length) card.append(facts);
  const foot = el('div', 'pc-d-foot');
  const btn = el('button', 'btn btn-ghost sm pc-mark', d.today ? 'Practised today' : 'Mark as practised');
  btn.type = 'button';
  btn.disabled = !!d.today;
  btn.setAttribute('aria-label', d.today ? `${d.title}, practised today` : `Mark ${d.title} as practised today`);
  btn.addEventListener('click', () => markDrill(d.id, btn));
  foot.append(btn);
  if (d.doneLine) foot.append(el('span', 'pc-done' + (d.finished ? ' finished' : ''), d.doneLine));
  card.append(foot);
  return card;
}

function drills(host, list) {
  host.replaceChildren(...(list || []).map(drillCard));
}

async function markDrill(id, btn) {
  if (busy) return;
  busy = true;
  btn.disabled = true;
  let r = null;
  try { r = await api.mark(id); } catch { r = null; }
  busy = false;
  if (!r || !r.ok) btn.disabled = !!(r && r.error === 'today');
  await load();
}

async function removeEntry(id, btn) {
  if (busy) return;
  busy = true;
  btn.disabled = true;
  try { await api.remove(id); } catch { /* the log is painted again either way */ }
  busy = false;
  await load();
}

// ── The plan ──────────────────────────────────────────────────────────────
function focusBlock(f, i) {
  const sec = el('div', 'pc-focus' + (f.focused ? ' opened' : ''));
  sec.dataset.key = f.key;
  const head = el('div', 'pc-focus-head');
  head.append(el('span', 'pc-label', f.focused ? `Focus ${i + 1}, from your review` : `Focus ${i + 1}`));
  head.append(el('h3', 'pc-focus-title', f.title));
  if (f.line) head.append(el('p', 'pc-count', f.line));
  if (f.fix) head.append(el('p', 'pc-fix', f.fix));
  const grid = el('div', 'pc-drills');
  drills(grid, f.drills);
  sec.append(head, grid);
  return sec;
}

function bandLine(textId, btnId) {
  $(textId).textContent = view.bandLine || '';
  $(btnId).hidden = !view.needsRiotId;
}

function paintTrend() {
  const host = $('pc-trend');
  host.replaceChildren();
  for (const f of view.focus || []) {
    const p = f.progress || {};
    const row = el('div', 'pc-trow');
    row.setAttribute('role', 'listitem');
    const left = el('div', 'pc-tmain');
    left.append(el('span', 'pc-ttitle', f.title));
    if (p.over) left.append(el('span', 'pc-tover', p.over));
    row.append(left, el('span', 'pc-tval ' + (p.tone || 'even') + (p.enough ? '' : ' wait'), p.text || ''));
    host.append(row);
  }
  // The days practised, quiet, once there are any.
  const st = view.streak && view.streak.entries ? view.streak.line : '';
  $('pc-streak').hidden = !st;
  $('pc-streak').textContent = st;
}

function paintLog() {
  const host = $('pc-log');
  host.replaceChildren();
  const log = view.log || [];
  $('pc-log-none').hidden = log.length > 0;
  // Said once: under Is it working? with a plan, at the log's head without one.
  $('pc-log-streak').hidden = !(view.streak && view.streak.entries) || view.status === 'plan';
  $('pc-log-streak').textContent = view.streak ? view.streak.line : '';
  for (const e of log) {
    const row = el('div', 'pc-lrow');
    row.setAttribute('role', 'listitem');
    row.dataset.entry = e.id;
    row.append(el('span', 'pc-lday', fmtDay(e.at)), el('span', 'pc-ltitle', e.title), el('span', 'pc-lmin', e.minutes ? `${e.minutes} min` : ''));
    const del = el('button', 'icon-btn pc-del');
    del.type = 'button';
    del.title = 'Take this out of the log';
    del.setAttribute('aria-label', `Take ${e.title}, ${fmtDay(e.at)}, out of the log`);
    del.innerHTML = '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12"/><path d="M18 6L6 18"/></svg>';
    del.addEventListener('click', () => removeEntry(e.id, del));
    row.append(del);
    host.append(row);
  }
}

function paint() {
  $('pc-wait').hidden = true;
  $('pc-page').hidden = false;
  const v = view;
  const league = v.status === 'game';
  $('pc-lede').hidden = league;

  const empty = v.empty || null;
  $('pc-empty').hidden = !empty;
  $('pc-empty-title').textContent = empty ? empty.title : '';
  $('pc-empty-hint').textContent = empty ? empty.hint : '';

  const extra = !league && v.asked ? v.asked : null;
  $('pc-asked').hidden = !extra;
  if (extra) {
    $('pc-asked-title').textContent = extra.title || 'This mistake';
    $('pc-asked-line').hidden = !extra.line;
    $('pc-asked-line').textContent = extra.line || '';
    drills($('pc-asked-drills'), extra.drills);
  }

  const plan = v.status === 'plan';
  $('pc-plan').hidden = !plan;
  if (plan) {
    bandLine('pc-band', 'pc-riot');
    $('pc-focus').replaceChildren(...v.focus.map(focusBlock));
  }

  const general = !league && !plan && (v.general || []).length > 0;
  $('pc-general').hidden = !general;
  if (general) {
    bandLine('pc-general-band', 'pc-general-riot');
    drills($('pc-general-drills'), v.general);
  }

  $('pc-working').hidden = !plan;
  if (plan) paintTrend();

  $('pc-log-sec').hidden = league;
  if (!league) paintLog();
  $('pc-privacy').hidden = league;
  $('pc-privacy').textContent = v.privacy || '';

  // THE SECTIONS RISE once per visit, on screen, nothing under reduced motion.
  const M = window.Motion;
  if (M && typeof M.stagger === 'function') M.stagger($('pc-page'), `page:${game}`);

  // Opened from a review: that mistake's drills in view, once.
  if (scrollTo) {
    scrollTo = false;
    const target = document.querySelector('.pc-focus.opened') || (extra ? $('pc-asked') : null);
    if (target && typeof target.scrollIntoView === 'function') {
      const go = () => target.scrollIntoView({ block: 'start' });
      if (typeof window.occlaraOnShown === 'function') window.occlaraOnShown(go); else go();
    }
  }
}

async function load() {
  const n = ++ask;
  let v = null;
  try { v = typeof api.getPractice === 'function' ? await api.getPractice(game, asked) : null; } catch { v = null; }
  // The review's Practise this is answered once: kept even by an answer
  // overtaken, and asked again with it.
  if (v && v.opened && v.opened.key) {
    asked = { key: v.opened.key, title: v.opened.title || null };
    scrollTo = true;
    if (n !== ask) { load(); return; }
  }
  if (n !== ask) return;
  // Null mid match: the page is sealed and shows nothing new.
  if (!v) return;
  view = v;
  paint();
}

$('pc-riot').addEventListener('click', () => api.go('settings'));
$('pc-general-riot').addEventListener('click', () => api.go('settings'));

// A page of the main window has no window of its own to close.
const closeWindow = () => { if (!(window.occlaraEmbedded && window.occlaraEmbedded())) api.close(); };
$('close').addEventListener('click', closeWindow);

(async () => {
  const st = typeof api.getState === 'function' ? await api.getState().catch(() => null) : null;
  game = (st && st.gameId) || 'valorant';
  // A review saved, a drill marked, the game switched, or the page coming
  // back (a new day, the review's Practise this): asked again.
  if (typeof api.onPractice === 'function') api.onPractice(() => load());
  if (typeof api.onReviews === 'function') api.onReviews(() => load());
  if (typeof api.onGame === 'function') api.onGame((g) => { if (g && g.id) { game = g.id; load(); } });
  // Leaving ends the visit, and the mistake the review opened it on with it.
  if (typeof api.onPage === 'function') {
    api.onPage((m) => {
      if (m && m.phase === 'leave') asked = null;
      if (m && m.phase === 'arm') load();
    });
  }
  await load();
  console.log('[practice] ready');
})();
