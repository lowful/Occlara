'use strict';

/*
 * THE GAMES TOAST (8.9.1): the view main lays at the top right over every
 * page while a toast is up (main-window.js toast). It draws the one toast
 * main sends, as text only: "You got <n> games" with the number counted up,
 * and its reason. Its time is the line along the foot (toast.css
 * toastTime), so hovering holds it and its end dismisses it; the X dismisses
 * it at once; a press anywhere else on the card opens Profile (main decides,
 * and never while sealed). Each end is said to main once, by id, and main
 * sends the next one or hides the view. { clear: true } takes it away
 * without a word (the seal came on: main keeps it for later).
 */

const $ = (id) => document.getElementById(id);
const box = $('toast');
const titleEl = $('toast-title');
const lineEl = $('toast-line');
const timeEl = $('toast-time');
const bridge = window.occlaraToast;
const SHOW_MS = 6000;
const COUNT_MS = 520;
const GIFT_KINDS = new Set(['gift', 'invite']);
const reduced = () => window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

let current = null;   // the id on screen
let ending = false;
let counter = 0;

function stopCount() { if (counter) cancelAnimationFrame(counter); counter = 0; }

/** The title, its number counted up from 0 unless motion is reduced. */
function paintTitle(t) {
  titleEl.replaceChildren();
  titleEl.append(document.createTextNode(t.pre || ''));
  if (Number.isFinite(t.n) && t.n > 0) {
    const n = document.createElement('span');
    n.className = 'n';
    n.textContent = reduced() ? String(t.n) : '0';
    titleEl.append(n);
    if (!reduced()) {
      const start = performance.now() + 140;
      const tick = (now) => {
        const p = Math.min(1, Math.max(0, (now - start) / COUNT_MS));
        const eased = 1 - Math.pow(1 - p, 3);
        n.textContent = String(Math.round(eased * t.n));
        counter = p < 1 ? requestAnimationFrame(tick) : 0;
      };
      counter = requestAnimationFrame(tick);
    }
  }
  titleEl.append(document.createTextNode(t.post || ''));
}

function show(t) {
  stopCount();
  current = t.id;
  ending = false;
  box.classList.remove('leaving');
  box.dataset.mark = GIFT_KINDS.has(t.kind) ? 'gift' : 'plus';
  paintTitle(t);
  lineEl.textContent = t.line || '';
  box.style.setProperty('--toast-ms', `${SHOW_MS}ms`);
  // Each toast comes in again and its time starts full.
  box.hidden = true;
  box.style.animation = 'none';
  timeEl.style.animation = 'none';
  void box.offsetWidth;
  box.style.animation = '';
  timeEl.style.animation = '';
  box.hidden = false;
}

/** Its end, said once: 'done' (time up, the X) or 'open' (the card pressed). */
function end(how) {
  if (!current || ending) return;
  ending = true;
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
  current = null;
  ending = false;
  box.hidden = true;
  box.classList.remove('leaving');
}

timeEl.addEventListener('animationend', () => end('done'));
$('toast-close').addEventListener('click', (e) => { e.stopPropagation(); end('done'); });
$('toast-body').addEventListener('click', () => end('open'));

if (bridge) {
  bridge.onToast((m) => {
    if (!m) return;
    if (m.clear) { clear(); return; }
    if (m.toast && m.toast.id) show(m.toast);
  });
}
