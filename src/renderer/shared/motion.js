'use strict';
/*
 * MOTION (8.9.2, ORBIT 27 Nov 2026): what a page needs to play an entrance
 * once, count a result up, squish a press, change its state through a View
 * Transition and keep its ambient motion quiet, beside shared/motion.css.
 * Loaded with <script src="../shared/motion.js"></script> before the page's
 * own script, and read as window.Motion.
 *
 * ONCE PER VISIT. A page of the main window is a view kept alive between
 * visits; embed.js says each time it comes on screen ('occlara-page-enter').
 * Motion.once(el, key) is true the first time it is asked for that element
 * and key in a visit, and false every time after, so a list painted again
 * when its data refreshes never enters again. A window of its own is one
 * visit.
 *
 * REDUCED MOTION. Motion.reduced() reads prefers-reduced-motion; asked for
 * less, the entrances add nothing (motion.css would take them off anyway),
 * countUp writes the final text at once and a transition is a plain change.
 *
 * AMBIENT (the agent's float, the stars, the moon's parallax): slow, and off
 * whenever the window is hidden. Motion.ambient(false) turns it off while a
 * match is being recorded; html.ambient-off is what the CSS pauses on, and
 * Motion.ambientOn() what a script asks before it draws a frame of it.
 *
 * NEVER MID MATCH. Nothing here knows about a match, and nothing needs to:
 * mid match no page is on screen. A page calls these only while it shows
 * what it already shows outside a match.
 */
(function () {
  const mq = typeof window.matchMedia === 'function' ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
  const reduced = () => !!(mq && mq.matches);
  const root = document.documentElement;

  let visit = 1;
  let seen = new WeakMap();
  // The first enter of a page that loaded armed is the visit it loaded in.
  window.addEventListener('occlara-page-enter', (e) => {
    if (e && e.detail && e.detail.first) return;
    visit++;
    seen = new WeakMap();
  });
  /** fn once the page is on screen (embed.js), or now in a window of its own. */
  const whenShown = (fn) => (typeof window.occlaraOnShown === 'function' ? window.occlaraOnShown(fn) : fn());

  /** True the first time for this element and key in this visit of the page. */
  function once(el, key) {
    if (!el) return false;
    const k = String(key == null ? '' : key);
    let keys = seen.get(el);
    if (!keys) { keys = new Set(); seen.set(el, keys); }
    if (keys.has(k)) return false;
    keys.add(k);
    return true;
  }

  // The longest an entrance here takes: --dur-enter, five staggers, a margin.
  const SETTLE_MS = 480 + 5 * 40 + 120;

  /** Put an entrance class on el and take it off once it has played. */
  // Played when the page is on screen, never into an armed page nobody sees.
  function play(el, cls, ms) {
    if (!el || reduced()) return;
    whenShown(() => {
      if (reduced()) return;
      el.classList.remove(cls);
      void el.offsetWidth;
      el.classList.add(cls);
      setTimeout(() => el.classList.remove(cls), ms || SETTLE_MS);
    });
  }

  /** el fades in and rises 8px, once per visit (key: 'rise'). */
  function rise(el, key) {
    if (!once(el, key || 'rise')) return false;
    play(el, 'm-rise');
    return true;
  }

  /** THE ENTRANCE: el arrives from 8px low, .985 and a 6px blur, once per visit (key: 'enter'). */
  function enter(el, key) {
    if (!once(el, key || 'enter')) return false;
    play(el, 'm-enter');
    return true;
  }

  /** el pops in (scale 0.96 to 1), once per visit (key: 'pop'). */
  function pop(el, key) {
    if (!once(el, key || 'pop')) return false;
    play(el, 'm-pop');
    return true;
  }

  /**
   * The container's children enter one after another, 40ms apart and six at
   * most staggered, once per visit (key: 'stagger'). The class comes off once
   * they have played, so children put in later (a refresh) simply appear.
   */
  function stagger(container, key) {
    if (!container || !once(container, key || 'stagger')) return false;
    if (reduced()) return true;
    [...container.children].forEach((c, i) => c.style.setProperty('--i', String(Math.min(i, 5))));
    play(container, 'm-stagger');
    return true;
  }

  /** A press that landed: 1, .86, 1 over 260ms. Every time it is asked, never under reduced motion. */
  function squish(el) {
    if (!el || reduced()) return;
    el.classList.remove('m-squish');
    void el.offsetWidth;
    el.classList.add('m-squish');
    setTimeout(() => el.classList.remove('m-squish'), 300);
  }

  /**
   * A change of state inside this document through the View Transitions API
   * (motion.css: the old fades out with a 4px blur, the new rises 8px on the
   * smooth spring; an element with a view-transition-name morphs). Where the
   * API is missing, under reduced motion or with the page out of sight, fn
   * simply runs. Returns a promise that settles once the change is made.
   */
  function transition(fn) {
    const run = () => { try { fn(); } catch (e) { /* the change is the caller's */ } };
    if (typeof document.startViewTransition !== 'function' || reduced() || document.visibilityState === 'hidden') {
      run();
      return Promise.resolve();
    }
    try {
      const vt = document.startViewTransition(run);
      return vt && vt.updateCallbackDone ? vt.updateCallbackDone.catch(() => {}) : Promise.resolve();
    } catch (e) {
      run();
      return Promise.resolve();
    }
  }

  // AMBIENT: off whenever the window is hidden, and while the page says so.
  let ambientWanted = true;
  const paintAmbient = () => {
    const on = ambientWanted && document.visibilityState !== 'hidden' && !reduced();
    root.classList.toggle('ambient-off', !on);
  };
  document.addEventListener('visibilitychange', paintAmbient);
  if (mq && typeof mq.addEventListener === 'function') mq.addEventListener('change', paintAmbient);
  paintAmbient();
  /** Ambient motion on or off for this page (off while a match is recorded). */
  function ambient(on) { ambientWanted = on !== false; paintAmbient(); }
  /** Whether a frame of ambient motion should be drawn now. */
  const ambientOn = () => !root.classList.contains('ambient-off');

  const counting = new WeakMap();
  const live = new Set();
  // Out of sight a frame never comes: a count under way ends on its value.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') for (const job of [...live]) job.done();
  });
  /** Ease out quart, close to --ease-out. */
  const easeOut = (t) => 1 - Math.pow(1 - t, 4);

  /**
   * el counts up to value and ends on exactly format(value). format(n) turns
   * a number on the way into text (default: rounded); dur is 600 to 900ms
   * (default 800). Asked for less motion, with the page out of sight, or for
   * a value that is not a number, the final text is written at once. The
   * final text is also in data-value from the start, so nothing that reads
   * the element has to wait for it. Returns a promise that settles once the
   * final text is on.
   */
  function countUp(el, value, opts) {
    const o = opts || {};
    const format = typeof o.format === 'function' ? o.format : (n) => String(Math.round(n));
    const to = Number(value);
    if (!el) return Promise.resolve();
    const prev = counting.get(el);
    if (prev) { cancelAnimationFrame(prev.raf); prev.done(); }
    const finalText = Number.isFinite(to) ? format(to) : String(value == null ? '' : value);
    el.dataset.value = finalText;
    el.classList.add('m-count');
    if (!Number.isFinite(to) || reduced() || document.visibilityState === 'hidden') {
      el.textContent = finalText;
      counting.delete(el);
      return Promise.resolve();
    }
    const from = Number.isFinite(Number(o.from)) ? Number(o.from) : 0;
    const dur = Math.min(900, Math.max(600, Number(o.dur) || 800));
    const delay = Math.max(0, Number(o.delay) || 0);
    return new Promise((resolve) => {
      const job = { raf: 0, timer: 0, fallback: 0, done: () => {
        cancelAnimationFrame(job.raf);
        clearTimeout(job.timer);
        clearTimeout(job.fallback);
        live.delete(job);
        if (counting.get(el) === job) counting.delete(el);
        el.textContent = finalText;
        resolve();
      } };
      counting.set(el, job);
      live.add(job);
      const start = () => {
        const t0 = performance.now();
        const step = (now) => {
          if (counting.get(el) !== job) return;
          // A frame's time can sit a hair before t0, and a negative t would
          // print a number below the start (a K/D of -0.27) for that frame.
          const t = Math.max(0, Math.min(1, (now - t0) / dur));
          if (t >= 1) { job.done(); return; }
          el.textContent = format(from + (to - from) * easeOut(t));
          job.raf = requestAnimationFrame(step);
        };
        job.raf = requestAnimationFrame(step);
      };
      el.textContent = format(from);
      if (delay) job.timer = setTimeout(start, delay); else start();
      // Frames stop in a window that is covered or hidden after the count
      // began, and the number would stand mid count (0.23 for a K/D of 1.48
      // in the site export). A timer still runs there, so it always lands.
      job.fallback = setTimeout(() => { if (counting.get(el) === job) job.done(); }, delay + dur + 150);
    });
  }

  window.Motion = Object.freeze({ reduced, once, rise, enter, pop, stagger, squish, transition, ambient, ambientOn, countUp, visit: () => visit, whenShown });
})();
