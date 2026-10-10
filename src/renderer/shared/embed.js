'use strict';

/*
 * A surface loaded as a page of the main window (src/main/windows/main-window.js)
 * is told so by its query: ?embed=1, its page id (?page=), and for the library
 * ?section=list, patterns or breakdown. It runs in <head>, before the body is
 * parsed, so an embedded page never paints a frame of its old window chrome
 * first.
 *
 * html.embedded drops the transparent gutter, the glass card, the close button
 * and the drag region (ui.css): the shell owns the window around the page.
 *
 * MOVING BETWEEN PAGES (8.2). main-window.js shows a page out of sight and asks
 * it to ARM (PUSH_PAGE): html.page-armed, invisible and 12px toward the side it
 * comes from (data-page-dir), at once, with no transition. Two animation frames
 * later that frame is painted, and the page says so (PAGE_READY, by its id).
 * Main then takes the page on screen away and tells this one to ENTER, which is
 * the one transition (ui.css). A page told to LEAVE fades while the next one
 * gets ready. A page LOADS armed, so its first frame is never a flash of its
 * own content, says it is ready once that frame is painted, and main lets it
 * in if it is the page shown. And if main never answers, ui.css lets it in
 * after 1.2 seconds, so no page can stay invisible.
 */
(function () {
  const root = document.documentElement;
  let page = null;
  try {
    const q = new URLSearchParams(location.search);
    if (q.get('embed') === '1') root.classList.add('embedded');
    const section = q.get('section');
    if (section && /^[a-z]+$/.test(section)) root.dataset.section = section;
    const id = q.get('page');
    if (id && /^[a-z]+$/.test(id)) page = id;
  } catch (e) {
    console.error('[embed] could not read the page query:', e && e.message);
  }

  const bridge = window.occlara;
  if (!root.classList.contains('embedded') || !page || !bridge
    || typeof bridge.onPage !== 'function' || typeof bridge.pageReady !== 'function') {
    // A window of its own, or a bridge without the motion: on screen as it
    // is, so whatever waits for that runs at once.
    window.occlaraOnShown = (fn) => fn();
    return;
  }

  root.classList.add('page-armed');

  const armed = () => root.classList.contains('page-armed');
  /** Style worked out now, so the change after it starts from here. */
  const settle = () => {
    if (typeof window.getComputedStyle === 'function' && document.body) void window.getComputedStyle(document.body).opacity;
  };
  const setDir = (dir) => {
    if (dir === 'forward' || dir === 'back') root.dataset.pageDir = dir;
    else delete root.dataset.pageDir;
  };

  // Each arm is answered once. An enter, or a later arm, makes an answer
  // still waiting for its frames stale.
  let turn = 0;
  function answer() {
    const mine = ++turn;
    window.requestAnimationFrame(() => window.requestAnimationFrame(() => {
      if (mine === turn) bridge.pageReady(page);
    }));
  }

  function arm(dir) {
    root.classList.remove('page-leaving');
    // Armed already (asked again before it came in): taken off and put back,
    // so the 1.2 second fallback in ui.css counts from now.
    if (armed()) { root.classList.remove('page-armed'); settle(); }
    setDir(dir);
    root.classList.add('page-armed');
    answer();
  }

  // What waits for the page to be on screen: let in, not leaving, and in a
  // window that is itself shown. A page let in while the window was still
  // hidden behind the splash is on screen only once the window appears.
  const waiting = [];
  const onScreen = () => !armed() && !root.classList.contains('page-leaving') && document.visibilityState !== 'hidden';
  function flush() {
    if (!onScreen()) return;
    for (const fn of waiting.splice(0)) {
      try { fn(); } catch (e) { console.error('[embed] on shown:', e && e.message); }
    }
  }
  document.addEventListener('visibilitychange', flush);

  function enter(dir) {
    turn++;
    // A page that loaded armed learns the way it comes in only now, and is
    // put on that side first, while it is still invisible.
    if (armed() && (dir || 'none') !== (root.dataset.pageDir || 'none')) { setDir(dir); settle(); }
    root.classList.remove('page-armed', 'page-leaving');
    flush();
  }

  function leave() {
    turn++;
    root.classList.add('page-leaving');
  }

  /** fn once this page is on screen: now, or when it next is. */
  window.occlaraOnShown = (fn) => {
    waiting.push(fn);
    flush();
  };

  bridge.onPage((m) => {
    const phase = m && m.phase;
    if (phase === 'arm') arm(m.dir);
    else if (phase === 'enter') enter(m.dir);
    else if (phase === 'leave') leave();
  });

  // Loaded armed: ready once the armed frame is painted.
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', answer, { once: true });
  else answer();
})();

/** Whether this surface is a page of the main window rather than a window of its own. */
window.occlaraEmbedded = () => document.documentElement.classList.contains('embedded');
