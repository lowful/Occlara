'use strict';

/*
 * THE PRACTICE PAGE. Paints what main wrote (src/shared/practice.js
 * planView): at the top the two repeated mistakes of the plan (Your focus),
 * each with how often it repeated, whether it is shrinking since the plan
 * was made, its fix and the player's own newest clip of it; then the drills
 * in three groups, Mechanics with the Trainer, Game sense and Awareness
 * (9.1), each drill a row that says why it is there (the repeated mistake it
 * is for) and opens in place on what to do; then the log. Nothing here
 * counts or words a fact: every title, line and number is main's.
 * textContent only, since a mistake's title and fix come from reviews a
 * model helped write; the icons are this file's own markup.
 *
 * Its two writes are a drill marked practiced and a log entry taken out,
 * both kept on this PC, and both refused by main mid match (the page is
 * locked by the seal then anyway). A drill tagged with a Trainer scenario
 * (main's `trainer`, `trainerTitle`) has Train this, and the Trainer's row
 * under Mechanics its scenarios, which ask main to open the Trainer page on
 * one (TRAINER_OPEN); Open the Trainer opens its page. None of them writes.
 *
 * MOTION: the page's sections rise once per visit (shared/motion.js), only
 * on screen and never under reduced motion; a repaint draws them as they are.
 * A drill opens and closes by a transition on the smooth spring, so a second
 * press mid way reverses from where it is; one open stays open across a
 * repaint (a mark), drawn open at once.
 *
 * SHOWN, NOT ONLY TOLD (8.11). Each mistake carries the player's own newest
 * kept clip of it (main's, practice.js clipFor): a tile with the look's own
 * frame, its round and map, which opens it in place in the review's own clip
 * player (review/clip-player.js) and plays it. No clip kept, no tile. A clip
 * open when the page is painted again stays where it is, playing or not. And
 * a drill may carry a demo from the website (main keeps only
 * https://occlara.app/drills/): its poster, shown once it has loaded, and a
 * muted loop that plays while the pointer is over it, or on a click, which
 * keeps it playing; nothing of it loads before (preload none). Under reduced
 * motion the poster waits with its play button for a click. Offline, or with
 * the media failing, the drill is exactly as before.
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
// The drills open, by id, carried across a repaint.
const openIds = new Set();
// The log shown whole, or its newest LOG_SHOWN.
let logAll = false;
const LOG_SHOWN = 5;

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
  p.setAttribute('d', 'M10.43 6.98L17.18 10.78A1.4 1.4 0 0 1 17.18 13.22L10.43 17.02A1.4 1.4 0 0 1 8.34 15.8L8.34 8.2A1.4 1.4 0 0 1 10.43 6.98Z');
  p.setAttribute('fill', 'currentColor');
  svg.append(p);
  return svg;
}

// The page's own glyphs, stroked, 24 wide. App authored markup.
const GLYPH = {
  range: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="4.2"/><circle cx="12" cy="12" r="0.9" fill="currentColor"/>',
  deathmatch: '<circle cx="12" cy="12" r="6.5"/><path d="M12 2.8v5M12 16.2v5M2.8 12h5M16.2 12h5"/>',
  custom: '<path d="M4.5 7.5h9M18.5 7.5h1M4.5 16.5h3M11.5 16.5h8"/><circle cx="16" cy="7.5" r="2.2"/><circle cx="9.5" cy="16.5" r="2.2"/>',
  unrated: '<circle cx="9" cy="9" r="3"/><circle cx="16.6" cy="10" r="2.4"/><path d="M3.6 19c.6-3.2 2.7-5 5.4-5s4.8 1.8 5.4 5"/><path d="M15.4 14.5c2.4-.2 4.4 1.3 5 4.5"/>',
  // The Trainer's own glyph for its flick drills (trainer/app.js GLYPH.flick).
  trainer: '<circle cx="5.5" cy="8" r="1.7"/><circle cx="18.5" cy="6" r="1.7"/><circle cx="14" cy="18" r="1.7"/><path d="M7 9.4l5.9 7.2M14.8 16.2l3-8.4"/>',
  chevron: '<path d="M6.5 9.5l5.5 5.5 5.5-5.5"/>',
  check: '<path d="M5 12.5l4.2 4.2L19 7"/>',
  down: '<path d="M12 5v14M6.5 13.5L12 19l5.5-5.5"/>',
  up: '<path d="M12 19V5M6.5 10.5L12 5l5.5 5.5"/>',
  same: '<path d="M5 12h14"/>',
  arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  close: '<path d="M6 6l12 12"/><path d="M18 6L6 18"/>',
};
function glyph(name, cls, width) {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', String(width || 1.7));
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  if (cls) svg.setAttribute('class', cls);
  svg.innerHTML = GLYPH[name] || '';
  return svg;
}
/** The glyph for where a drill is played, by main's words for the place. */
function placeGlyph(where) {
  const w = String(where || '').toLowerCase();
  if (/range/.test(w)) return 'range';
  if (/deathmatch/.test(w)) return 'deathmatch';
  if (/custom/.test(w)) return 'custom';
  return 'unrated';
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
  // The row it belongs to gives it the whole width under the mistake.
  const row = box.closest('.pc-frow');
  if (row) row.classList.add('clip-open');
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

/** The tile: the look's own frame with the play mark, the round, map and day under it. Null with no clip. */
function clipBlock(c) {
  if (!c || !c.url) return null;
  const kept = openClips.get(c.url);
  if (kept) { openClips.delete(c.url); return kept; }
  const box = el('div', 'pc-clip');
  box.dataset.url = c.url;
  const tile = el('button', 'pc-clip-tile');
  tile.type = 'button';
  tile.title = c.title || 'Your newest clip of this mistake';
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
  box.append(tile, el('span', 'pc-clip-line', c.at ? `${c.line}, ${fmtDay(c.at)}` : c.line));
  tile.addEventListener('click', () => openClip(box, c, true));
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
 * The demo's box, hidden until its poster has loaded, so an offline drill is
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

// ── Why a drill is here ───────────────────────────────────────────────────
/** The repeated mistake a drill is for and how often it repeated, or why it fits every player. */
function reasonLine(r, tag) {
  if (!r || (!r.title && !r.line)) return null;
  const p = el(tag || 'p', `pc-reason ${r.kind === 'mistake' && r.title ? 'is-mistake' : 'is-general'}`);
  if (r.kind === 'mistake' && r.title) {
    p.append(el('span', 'sr-only', 'For your repeated mistake: '), el('span', 'pc-r-dot'), el('span', 'pc-r-title', r.title));
    if (r.line) p.append(el('span', 'pc-r-line', r.line));
  } else {
    p.append(el('span', 'pc-r-line', r.line));
  }
  return p;
}

// ── A drill, as a row that opens in place ─────────────────────────────────
let rowSeq = 0;

/** Open or close a drill row; a transition, so a press mid way reverses from where it is. */
function setOpen(card, open) {
  const was = card.classList.contains('open');
  if (was === !!open) return;
  card.classList.toggle('open', !!open);
  const head = card.querySelector('.pc-d-head');
  if (head) head.setAttribute('aria-expanded', String(!!open));
  if (open) openIds.add(card.dataset.drill); else openIds.delete(card.dataset.drill);
  // Nothing plays in a closed drill.
  if (!open) for (const v of card.querySelectorAll('video')) { if (typeof v._stop === 'function') v._stop(); }
}

function drillCard(d) {
  const card = el('article', 'pc-drill');
  card.dataset.drill = d.id;
  card.dataset.group = d.group || '';
  if (d.reason && d.reason.key) card.dataset.reason = d.reason.key;
  if (d.today) card.classList.add('today');
  const bodyId = `pc-d-${++rowSeq}`;

  // The row: where, the title, why it is here, its length and how far along.
  const h = el('h4', 'pc-d-h');
  const head = el('button', 'pc-d-head');
  head.type = 'button';
  head.setAttribute('aria-expanded', 'false');
  head.setAttribute('aria-controls', bodyId);
  const ico = el('span', 'pc-d-ico');
  ico.append(glyph(placeGlyph(d.where)));
  const main = el('span', 'pc-d-main');
  main.append(el('span', 'pc-d-title', d.title));
  // Inside the row's button: phrasing alone.
  const why = reasonLine(d.reason, 'span');
  if (why) main.append(why);
  const meta = el('span', 'pc-d-meta');
  if (d.where) meta.append(el('span', 'pc-where', d.where));
  if (d.minutes) meta.append(el('span', 'pc-min', `${d.minutes} min`));
  const state = el('span', 'pc-d-state');
  if (d.today) {
    state.classList.add('good');
    state.append(glyph('check', 'pc-d-check', 2.2), el('span', null, 'Practiced today'));
  } else if (d.finished) {
    state.classList.add('good');
    state.textContent = 'Finished';
  } else if (d.done) {
    state.textContent = `${d.done} of ${d.finish}`;
    state.title = d.doneLine || '';
  }
  const chev = el('span', 'pc-d-chev');
  chev.append(glyph('chevron', null, 2));
  head.append(ico, main, meta, state, chev);
  h.append(head);
  card.append(h);

  // What to do, one step away: the why, the steps, the goal and how you will
  // know, Mark as practiced and Train this.
  const body = el('div', 'pc-d-body');
  body.id = bodyId;
  body.setAttribute('role', 'region');
  body.setAttribute('aria-label', d.title);
  const inner = el('div', 'pc-d-inner');
  const content = el('div', 'pc-d-content');
  const demo = demoBox(d);
  if (demo) content.append(demo);
  if (d.why) content.append(el('p', 'pc-why', d.why));
  const steps = el('ol', 'pc-steps');
  for (const s of d.steps || []) steps.append(el('li', null, s));
  content.append(steps);
  const facts = el('dl', 'pc-facts');
  const fact = (term, text) => {
    if (!text) return;
    const row = el('div', 'pc-fact');
    row.append(el('dt', null, term), el('dd', null, text));
    facts.append(row);
  };
  fact('Goal', d.goal);
  fact('How you will know', d.check);
  if (facts.children.length) content.append(facts);
  const foot = el('div', 'pc-d-foot');
  const btn = el('button', 'btn btn-primary sm pc-mark', d.today ? 'Practiced today' : 'Mark as practiced');
  btn.type = 'button';
  btn.disabled = !!d.today;
  btn.setAttribute('aria-label', d.today ? `${d.title}, practiced today` : `Mark ${d.title} as practiced today`);
  btn.addEventListener('click', () => markDrill(d.id, btn));
  foot.append(btn);
  if (d.doneLine) foot.append(el('span', 'pc-done' + (d.finished ? ' finished' : ''), d.doneLine));
  // TRAIN THIS (docs/claude/trainer.md): a drill a Trainer scenario trains
  // opens the Trainer on it. Last in the foot, so nothing before it moves.
  if (d.trainer && typeof api.openTrainer === 'function') {
    const train = el('button', 'btn btn-ghost sm pc-train', 'Train this');
    train.type = 'button';
    train.title = `Opens the Trainer on ${d.trainerTitle || 'this drill'}`;
    train.setAttribute('aria-label', `Train ${d.title} in the Trainer, on ${d.trainerTitle || 'its scenario'}`);
    train.addEventListener('click', () => api.openTrainer(d.trainer));
    foot.append(train);
  }
  content.append(foot);
  inner.append(content);
  body.append(inner);
  card.append(body);

  head.addEventListener('click', () => setOpen(card, !card.classList.contains('open')));
  // Drawn open at once when it was open before this paint.
  if (openIds.has(d.id)) { card.classList.add('open'); head.setAttribute('aria-expanded', 'true'); }
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

// ── The Trainer, under Mechanics ──────────────────────────────────────────
function trainerRow(t) {
  const row = el('div', 'pc-trainer');
  const ico = el('span', 'pc-d-ico pc-t-ico');
  ico.append(glyph('trainer'));
  const main = el('div', 'pc-d-main');
  main.append(el('span', 'pc-d-title', t.title || 'Aim trainer'));
  if (t.reason && t.reason.kind === 'mistake') {
    const why = reasonLine(t.reason);
    if (why) main.append(why);
  }
  if (t.line) main.append(el('p', 'pc-t-line', t.line));
  const openPage = () => { if (typeof api.go === 'function') api.go('trainer'); };
  // The way in, then a few of its scenarios to start on.
  const acts = el('div', 'pc-t-chips');
  const go = el('button', 'btn btn-primary sm pc-t-open');
  go.type = 'button';
  const label = el('span', 'btn-label', 'Open the Trainer');
  const arrow = el('span', 'btn-arrow');
  arrow.append(glyph('arrow', null, 2));
  go.append(label, arrow);
  go.addEventListener('click', openPage);
  acts.append(go);
  if (typeof api.openTrainer === 'function' && (t.scenarios || []).length) {
    const chips = el('div', 'pc-t-scen');
    chips.setAttribute('role', 'group');
    chips.setAttribute('aria-label', 'Start the Trainer on');
    for (const s of t.scenarios) {
      const c = el('button', 'btn btn-ghost sm pc-t-chip', s.title);
      c.type = 'button';
      c.dataset.scenario = s.id;
      c.title = `Opens the Trainer on ${s.title}`;
      c.addEventListener('click', () => api.openTrainer(s.id));
      chips.append(c);
    }
    acts.append(chips);
  }
  main.append(acts);
  // A real still of the Trainer's own arena, not a drawing of one: a press opens it.
  const still = el('button', 'pc-t-still');
  still.type = 'button';
  // The button beside it says the same, so the picture is the pointer's alone.
  still.setAttribute('aria-hidden', 'true');
  still.tabIndex = -1;
  const img = el('img', 'pc-t-img');
  img.alt = '';
  img.decoding = 'async';
  img.addEventListener('error', () => still.remove());
  img.src = 'trainer-still.jpg';
  still.append(img);
  still.addEventListener('click', openPage);
  row.append(ico, main, still);
  return row;
}

// ── The three groups ──────────────────────────────────────────────────────
function groupBlock(g) {
  const sec = el('section', 'pc-card pc-group');
  sec.dataset.group = g.id;
  const titleId = `pc-g-${g.id}`;
  sec.setAttribute('aria-labelledby', titleId);
  const head = el('header', 'pc-g-head');
  head.append(el('span', 'pc-label', g.name));
  const h = el('h3', 'pc-g-title', g.title);
  h.id = titleId;
  head.append(h);
  const list = el('div', 'pc-g-list');
  if (g.trainer) list.append(trainerRow(g.trainer));
  for (const d of g.drills || []) list.append(drillCard(d));
  sec.append(head, list);
  return sec;
}

// ── Your focus ────────────────────────────────────────────────────────────
function trendOf(p) {
  if (!p || !p.text) return null;
  const tone = p.enough ? (p.tone || 'even') : 'wait';
  const n = el('span', `pc-trend ${tone}`);
  if (p.over) n.title = p.over;
  const way = p.enough ? (p.trend === 'down' ? 'down' : p.trend === 'up' ? 'up' : p.trend === 'same' ? 'same' : null) : null;
  if (way) n.append(glyph(way, 'pc-trend-ico', 2.2));
  n.append(el('span', null, p.text));
  return n;
}

function focusBlock(f) {
  const row = el('div', 'pc-focus pc-frow' + (f.focused ? ' opened' : ''));
  row.dataset.key = f.key;
  const head = el('div', 'pc-focus-head');
  if (f.focused) head.append(el('span', 'pc-from', 'From your review'));
  head.append(el('h3', 'pc-focus-title', f.title));
  const facts = el('p', 'pc-fmeta');
  if (f.line) facts.append(el('span', 'pc-count', f.line));
  const t = trendOf(f.progress);
  if (t) facts.append(t);
  if (facts.children.length) head.append(facts);
  if (f.fix) head.append(el('p', 'pc-fix', f.fix));
  row.append(head);
  // The player's own clip of it, beside the mistake; none kept, nothing drawn.
  const clip = clipBlock(f.clip);
  if (clip) {
    const aside = el('div', 'pc-aside');
    aside.append(clip);
    row.append(aside);
    if (clip.classList.contains('open')) row.classList.add('clip-open');
  }
  return row;
}

function bandLine() {
  $('pc-band').textContent = view.bandLine || '';
  $('pc-riot').hidden = !view.needsRiotId;
}

function paintLog() {
  const host = $('pc-log');
  host.replaceChildren();
  const log = view.log || [];
  $('pc-log-none').hidden = log.length > 0;
  // Said once: at Your focus with a plan, at the log's head without one.
  $('pc-log-streak').hidden = !(view.streak && view.streak.entries) || view.status === 'plan';
  $('pc-log-streak').textContent = view.streak ? view.streak.line : '';
  const shown = logAll ? log : log.slice(0, LOG_SHOWN);
  for (const e of shown) {
    const row = el('div', 'pc-lrow');
    row.setAttribute('role', 'listitem');
    row.dataset.entry = e.id;
    row.append(el('span', 'pc-lday', fmtDay(e.at)), el('span', 'pc-ltitle', e.title), el('span', 'pc-lmin', e.minutes ? `${e.minutes} min` : ''));
    const del = el('button', 'icon-btn pc-del');
    del.type = 'button';
    del.title = 'Take this out of the log';
    del.setAttribute('aria-label', `Take ${e.title}, ${fmtDay(e.at)}, out of the log`);
    del.append(glyph('close', null, 2.2));
    del.addEventListener('click', () => removeEntry(e.id, del));
    row.append(del);
    host.append(row);
  }
  const more = $('pc-log-more');
  more.hidden = log.length <= LOG_SHOWN;
  more.textContent = logAll ? 'Show fewer' : `Show all ${log.length}`;
  more.setAttribute('aria-expanded', String(logAll));
}

function paint() {
  $('pc-wait').hidden = true;
  $('pc-page').hidden = false;
  const v = view;
  const league = v.status === 'game';
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
  $('pc-asked').querySelector('.pc-frow').classList.toggle('clip-open', !!(askedClip && askedClip.classList.contains('open')));

  const plan = v.status === 'plan';
  $('pc-plan').hidden = !plan;
  // Only a clip plays here: one open is carried into the new rows, and one
  // with no place left in them is let go below.
  if (plan) $('pc-focus').replaceChildren(...v.focus.map(focusBlock));
  // The days practiced, quiet, at Your focus once there are any.
  const st = plan && v.streak && v.streak.entries ? v.streak.line : '';
  $('pc-streak').hidden = !st;
  $('pc-streak').textContent = st;

  // The three groups, each with what it holds; the Trainer always under Mechanics.
  const groups = league ? [] : (v.groups || []).filter((g) => (g.drills || []).length || g.trainer);
  releaseVideos($('pc-groups'));
  $('pc-groups').replaceChildren(...groups.map(groupBlock));
  const anyDrill = groups.some((g) => (g.drills || []).length);
  $('pc-band-line').hidden = league || !anyDrill;
  if (!league) bandLine();

  // An open clip with no place in this paint is let go.
  for (const n of openClips.values()) releaseVideos(n);
  openClips = new Map();

  $('pc-log-sec').hidden = league;
  if (!league) paintLog();
  $('pc-privacy').hidden = league;
  $('pc-privacy').textContent = v.privacy || '';

  // THE SECTIONS RISE once per visit, on screen, nothing under reduced motion.
  const M = window.Motion;
  if (M && typeof M.stagger === 'function') M.stagger($('pc-page'), `page:${game}`);

  // Opened from a review: that mistake's first drill opened and in view, once.
  if (scrollTo) {
    scrollTo = false;
    const opened = document.querySelector('.pc-focus.opened');
    let target = null;
    if (opened) {
      const key = opened.dataset.key;
      const first = [...document.querySelectorAll('#pc-groups .pc-drill')].find((c) => c.dataset.reason === key);
      if (first) { setOpen(first, true); target = first; } else target = opened;
    } else if (extra) {
      const first = $('pc-asked-drills').querySelector('.pc-drill');
      if (first) setOpen(first, true);
      target = $('pc-asked');
    }
    if (target && typeof target.scrollIntoView === 'function') {
      const go = () => target.scrollIntoView({ block: opened ? 'center' : 'start' });
      if (typeof window.occlaraOnShown === 'function') window.occlaraOnShown(go); else go();
    }
  }
}

async function load() {
  const n = ++ask;
  let v = null;
  try { v = typeof api.getPractice === 'function' ? await api.getPractice(game, asked) : null; } catch { v = null; }
  // The review's Practice this is answered once: kept even by an answer
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
$('pc-log-more').addEventListener('click', () => {
  logAll = !logAll;
  if (view) paintLog();
});

// A page of the main window has no window of its own to close.
const closeWindow = () => { if (!(window.occlaraEmbedded && window.occlaraEmbedded())) api.close(); };
$('close').addEventListener('click', closeWindow);

(async () => {
  const st = typeof api.getState === 'function' ? await api.getState().catch(() => null) : null;
  game = (st && st.gameId) || 'valorant';
  // A review saved, a drill marked, the game switched, or the page coming
  // back (a new day, the review's Practice this): asked again.
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
