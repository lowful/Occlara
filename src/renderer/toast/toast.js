'use strict';

/*
 * THE REVEAL (8.10.4, once the games toast): the view main lays over the whole
 * window while one is up (main-window.js toast). It draws the one event main
 * sends, centred: a gift that opens ("+4 games") or the crescent in a ring
 * (a plan), the number counted up, one line and two buttons. The timeline is
 * all CSS (toast.css); this file counts the number, makes the flat pieces,
 * and says how it ended, once, by id: 'done' (Continue, Esc, a click on the
 * scrim, 10 s up) or 'open' (See my games: main opens Profile, and never
 * while sealed). { clear: true } takes it away without a word (the seal came
 * on: main keeps it for later).
 */

const $ = (id) => document.getElementById(id);
const box = $('reveal');
const bigEl = $('rv-big');
const unitEl = $('rv-unit');
const lineEl = $('rv-line');
const piecesEl = $('rv-pieces');
const bridge = window.occlaraToast;
const SHOW_MS = 10000;
const COUNT_AT = 960;     // the number starts counting as it rises out (toast.css rvRise, 900 ms)
const COUNT_MS = 760;
const reduced = () => window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

let current = null;   // the id on screen
let ending = false;
let counter = 0;
let timer = 0;

function stopCount() { if (counter) cancelAnimationFrame(counter); counter = 0; }
function stopTimer() { if (timer) clearTimeout(timer); timer = 0; }
function arm(ms) { stopTimer(); timer = setTimeout(() => end('done'), ms); }

/** The number counted up from 0 once it has risen, or set at once when motion is reduced. */
function paintBig(t) {
  const plus = t.look === 'gift' && !/month/.test(t.unit || '') ? '+' : '';
  const n = Number.isFinite(t.big) && t.big > 0 ? t.big : 0;
  if (!n) { bigEl.textContent = ''; return; }
  if (reduced()) { bigEl.textContent = plus + n; return; }
  bigEl.textContent = plus + '0';
  const start = performance.now() + COUNT_AT;
  const tick = (now) => {
    const p = Math.min(1, Math.max(0, (now - start) / COUNT_MS));
    const eased = 1 - Math.pow(1 - p, 3);
    bigEl.textContent = plus + String(Math.round(eased * n));
    counter = p < 1 ? requestAnimationFrame(tick) : 0;
  };
  counter = requestAnimationFrame(tick);
}

/** 22 flat pieces for the gift, always the same: their angle, reach and turn are arithmetic. */
function makePieces() {
  piecesEl.replaceChildren();
  for (let i = 0; i < 22; i++) {
    const a = (i / 22) * Math.PI * 2 + ((i * 37) % 7) * 0.09;
    const reach = 110 + ((i * 53) % 10) * 17;
    const el = document.createElement('span');
    el.className = 'pc c' + (i % 4);
    el.style.width = (6 + (i % 3) * 3) + 'px';
    el.style.height = (i % 2 ? 6 : 12) + 'px';
    el.style.setProperty('--x', Math.round(Math.cos(a) * reach) + 'px');
    el.style.setProperty('--y', Math.round(Math.sin(a) * reach * 0.8 - 40) + 'px');
    el.style.setProperty('--r', ((i * 47) % 180) + 'deg');
    el.style.setProperty('--d', ((i % 5) * 18) + 'ms');
    piecesEl.append(el);
  }
}

function show(t) {
  stopCount();
  stopTimer();
  current = t.id;
  ending = false;
  box.classList.remove('leaving');
  box.dataset.look = t.look === 'plan' ? 'plan' : 'gift';
  box.dataset.tier = t.tier === 'max' ? 'max' : t.tier === 'pro' ? 'pro' : '';
  unitEl.textContent = t.unit || '';
  lineEl.textContent = t.rline || t.line || '';
  bigEl.setAttribute('aria-label', `${t.big || ''} ${t.unit || ''}`.trim());
  if (box.dataset.look === 'gift') makePieces(); else piecesEl.replaceChildren();
  paintBig(t);
  // Each one starts its timeline again: hide, force a reflow, show.
  box.hidden = true;
  void box.offsetWidth;
  box.hidden = false;
  arm(SHOW_MS);
  try { $('rv-continue').focus({ preventScroll: true }); } catch { /* not focusable yet */ }
}

/** Its end, said once: 'done' or 'open' (See my games). */
function end(how) {
  if (!current || ending) return;
  ending = true;
  stopTimer();
  const id = current;
  stopCount();
  box.classList.add('leaving');
  const finish = () => {
    if (current !== id) return;
    current = null;
    box.hidden = true;
    box.classList.remove('leaving');
    if (how === 'open') bridge.open(id); else bridge.done(id);
  };
  // The way out is short; with the view hidden no animationend may come.
  let gone = false;
  const once = () => { if (!gone) { gone = true; finish(); } };
  box.addEventListener('animationend', function out(e) {
    if (e.target !== box) return;
    box.removeEventListener('animationend', out);
    once();
  });
  setTimeout(once, 260);
}

function clear() {
  stopCount();
  stopTimer();
  current = null;
  ending = false;
  box.hidden = true;
  box.classList.remove('leaving');
}

$('rv-continue').addEventListener('click', () => end('done'));
$('rv-profile').addEventListener('click', () => end('open'));
$('rv-scrim').addEventListener('click', () => end('done'));
window.addEventListener('keydown', (e) => {
  if (!current) return;
  if (e.key === 'Escape') { e.preventDefault(); end('done'); }
});
if (bridge) {
  bridge.onToast((m) => {
    if (!m) return;
    if (m.clear) { clear(); return; }
    if (m.toast && m.toast.id) show(m.toast);
  });
}
