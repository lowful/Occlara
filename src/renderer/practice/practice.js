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
 *
 * SHOWN, NOT ONLY TOLD (8.11). Each mistake carries the player's own newest
 * kept clip of it (main's, practice.js clipFor): a tile with the look's own
 * frame, its round and map, and Watch the round, which opens it in place in
 * the review's own clip player (review/clip-player.js) and plays it. No clip
 * kept, no tile. A clip open when the page is painted again stays where it
 * is, playing or not. And a drill may carry a demo from the website
 * (main keeps only https://occlara.app/drills/): its poster, shown once it
 * has loaded, and a muted loop that plays while the pointer is over it, or
 * on a click, which keeps it playing; nothing of it loads before (preload
 * none). Under reduced motion the poster waits with its play button for a
 * click. Offline, or with the media failing, the card is exactly as before.
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

const SVG_NS = 'http://www.w3.org/2000/svg';
/** The play mark, the clip player's own shape, filled. */
function playMark(cls) {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('class', cls);
  const p = document.createElementNS(SVG_NS, 'path');
  p.setAttribute('d', 'M8 5.5v13l10.5-6.5z');
  p.setAttribute('fill', 'currentColor');
  svg.append(p);
  return svg;
}

const reducedMotion = () => {
  const M = window.Motion;
  if (M && typeof M.reduced === 'function') return !!M.reduced();
  return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
};

/** Every <video> in `host` stopped and let go, so nothing decodes behind a repaint. */
function releaseVideos(host) {
  if (!host) return;
  for (const v of host.querySelectorAll('video')) if (demoWatch) demoWatch.unobserve(v);
  if (window.ClipPlayer && typeof window.ClipPlayer.release === 'function') { window.ClipPlayer.release(host); return; }
  for (const v of host.querySelectorAll('video')) {
    try { if (typeof v.pause === 'function') v.pause(); } catch { /* no decoder */ }
    v.removeAttribute('src');
    try { if (typeof v.load === 'function') v.load(); } catch { /* nothing loaded */ }
  }
}

// ── The player's own clip of a mistake ────────────────────────────────────
// Open clips by URL, carried across a repaint: a mark or a review saved
// paints the page again, and the clip being watched stays as it is.
let openClips = new Map();

/** The clip in its player, in place of the tile, and played (a click asked for it). */
function openClip(box, c, play) {
  box.classList.add('open');
  box.replaceChildren();
  const cap = el('div', 'pc-clip-cap');
  cap.append(el('span', 'pc-label', c.title), el('span', 'pc-clip-line', c.at ? `${c.line}, ${fmtDay(c.at)}` : c.line));
  box.append(cap);
  if (!window.ClipPlayer || typeof window.ClipPlayer.create !== 'function') return;
  const p = window.ClipPlayer.create({ url: c.url, death: c.death, frames: c.frames || null, label: c.label, poster: c.poster || null });
  box.append(p.el);
  if (!play) return;
  // Grown in place from the tile: the whole player brought into view.
  if (typeof box.scrollIntoView === 'function') box.scrollIntoView({ block: 'nearest' });
  const v = p.video;
  const played = v && typeof v.play === 'function' ? v.play() : null;
  if (played && typeof played.catch === 'function') {
    played.catch((e) => {
      // A pause asked for before it started is no failure; anything else says so.
      if (e && e.name === 'AbortError') return;
      cap.append(el('span', 'pc-clip-fail', 'This clip could not be played.'));
    });
  }
}

/** The tile: the look's own frame, the round and map, and Watch the round. Null with no clip. */
function clipBlock(c) {
  if (!c || !c.url) return null;
  const kept = openClips.get(c.url);
  if (kept) { openClips.delete(c.url); return kept; }
  const box = el('div', 'pc-clip');
  box.dataset.url = c.url;
  const tile = el('button', 'pc-clip-tile');
  tile.type = 'button';
  tile.setAttribute('aria-label', `Watch ${c.label ? c.label.charAt(0).toLowerCase() + c.label.slice(1) : 'the clip'}`);
  if (c.poster) {
    const img = el('img', 'pc-clip-poster');
    img.alt = '';
    img.decoding = 'async';
    img.addEventListener('error', () => img.remove());
    img.src = c.poster;
    tile.append(img);
  }
  const mark = el('span', 'pc-clip-mark');
  mark.append(playMark('pc-clip-icon'));
  tile.append(mark);
  const text = el('div', 'pc-clip-text');
  text.append(el('span', 'pc-label', c.title), el('span', 'pc-clip-line', c.at ? `${c.line}, ${fmtDay(c.at)}` : c.line));
  const watch = el('button', 'btn btn-ghost sm pc-clip-watch', 'Watch the round');
  watch.type = 'button';
  text.append(watch);
  box.append(tile, text);
  const go = () => openClip(box, c, true);
  tile.addEventListener('click', go);
  watch.addEventListener('click', go);
  return box;
}

// ── A drill's demo, from the website ─────────────────────────────────────
// Out of view, a demo pauses and lets go of its click.
let demoWatch = null;
function watchDemo(v, stop) {
  if (typeof window.IntersectionObserver !== 'function') return;
  if (!demoWatch) {
    demoWatch = new window.IntersectionObserver((entries) => {
      for (const e of entries) if (!e.isIntersecting && e.target.paused === false && e.target._stop) e.target._stop();
    }, { threshold: 0 });
  }
  v._stop = stop;
  demoWatch.observe(v);
}

/**
 * The demo's box, hidden until its poster has loaded, so an offline card is
 * exactly as before; gone at the first failure of either file.
 */
function demoBox(d) {
  const m = d.demo;
  if (!m || !m.src || !m.poster) return null;
  const box = el('div', 'pc-demo');
  box.hidden = true;
  const btn = el('button', 'pc-demo-btn');
  btn.type = 'button';
  btn.setAttribute('aria-label', `Play the ${m.secs ? `${m.secs} second ` : ''}demo of ${d.title}`);
  btn.setAttribute('aria-pressed', 'false');
  const img = el('img', 'pc-demo-poster');
  img.alt = '';
  img.decoding = 'async';
  const mark = el('span', 'pc-demo-mark');
  mark.append(playMark('pc-demo-icon'));
  const tag = el('span', 'pc-demo-tag', m.secs ? `Demo, ${m.secs} s` : 'Demo');
  btn.append(img, mark, tag);
  box.append(btn);

  let v = null;
  let pinned = false;
  let failed = false;
  const pause = () => { if (v && v.paused === false && typeof v.pause === 'function') v.pause(); };
  const fail = () => {
    if (failed) return;
    failed = true;
    if (v) releaseVideos(box);
    box.remove();
  };
  const stop = () => {
    pinned = false;
    btn.setAttribute('aria-pressed', 'false');
    pause();
  };
  const start = () => {
    if (failed) return;
    if (!v) {
      v = document.createElement('video');
      v.className = 'pc-demo-video';
      v.muted = true;
      for (const a of ['muted', 'loop', 'playsinline']) v.setAttribute(a, '');
      v.setAttribute('preload', 'none');
      v.setAttribute('aria-hidden', 'true');
      v.addEventListener('error', fail);
      v.addEventListener('playing', () => box.classList.add('playing'));
      v.addEventListener('pause', () => box.classList.remove('playing'));
      v.setAttribute('src', m.src);
      btn.insertBefore(v, mark);
      watchDemo(v, stop);
    }
    const p = typeof v.play === 'function' ? v.play() : null;
    if (p && typeof p.catch === 'function') p.catch((e) => { if (!(e && e.name === 'AbortError')) fail(); });
  };
  // A preview while the pointer is over it, never under reduced motion; a
  // click plays it and keeps it playing, a second click stops it.
  btn.addEventListener('pointerenter', () => { if (!reducedMotion()) start(); });
  btn.addEventListener('pointerleave', () => { if (!pinned) pause(); });
  btn.addEventListener('click', () => {
    if (pinned) { stop(); return; }
    pinned = true;
    btn.setAttribute('aria-pressed', 'true');
    start();
  });
  img.addEventListener('load', () => { if (!failed) box.hidden = false; });
  img.addEventListener('error', fail);
  img.src = m.poster;
  return box;
}

// ── A drill, as a card ────────────────────────────────────────────────────
function drillCard(d) {
  const card = el('article', 'pc-drill');
  card.dataset.drill = d.id;
  const demo = demoBox(d);
  if (demo) card.append(demo);
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
  releaseVideos(host);
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
  sec.append(head);
  // The player's own clip of it, beside its drills; none kept, nothing drawn.
  const clip = clipBlock(f.clip);
  if (clip) sec.append(clip);
  const grid = el('div', 'pc-drills');
  drills(grid, f.drills);
  sec.append(grid);
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
  // A clip being watched is carried into the new paint (clipBlock).
  openClips = new Map();
  for (const n of document.querySelectorAll('.pc-clip.open')) if (n.dataset.url) openClips.set(n.dataset.url, n);

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
  } else releaseVideos($('pc-asked-drills'));
  const askedClip = extra ? clipBlock(extra.clip) : null;
  $('pc-asked-clip').hidden = !askedClip;
  $('pc-asked-clip').replaceChildren(...(askedClip ? [askedClip] : []));

  const plan = v.status === 'plan';
  $('pc-plan').hidden = !plan;
  if (plan) {
    bandLine('pc-band', 'pc-riot');
    for (const g of $('pc-focus').querySelectorAll('.pc-drills')) releaseVideos(g);
    $('pc-focus').replaceChildren(...v.focus.map(focusBlock));
  }
  // An open clip with no place in this paint is let go.
  for (const n of openClips.values()) releaseVideos(n);
  openClips = new Map();

  const general = !league && !plan && (v.general || []).length > 0;
  $('pc-general').hidden = !general;
  if (general) {
    bandLine('pc-general-band', 'pc-general-riot');
    drills($('pc-general-drills'), v.general);
  } else releaseVideos($('pc-general-drills'));

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
  // Leaving ends the visit, and the mistake the review opened it on with it;
  // nothing plays on a page nobody is looking at (a demo let go of its click).
  if (typeof api.onPage === 'function') {
    api.onPage((m) => {
      if (m && m.phase === 'leave') {
        asked = null;
        for (const v of document.querySelectorAll('video')) {
          if (typeof v._stop === 'function') v._stop();
          else if (v.paused === false && typeof v.pause === 'function') v.pause();
        }
      }
      if (m && m.phase === 'arm') load();
    });
  }
  await load();
  console.log('[practice] ready');
})();
