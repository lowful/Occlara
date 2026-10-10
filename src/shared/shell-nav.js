'use strict';

/**
 * The one window's pages, which of them shows, and how the window moves from
 * one to the next.
 *
 * Since 8.1 the app is one window: a sidebar, and the page beside it. Each
 * page is an existing surface loaded in a view of its own (main-window.js), so
 * a page keeps its scroll, its chat and its state when the player goes
 * elsewhere and comes back. Matches, Patterns and Breakdown are three sections
 * of the one library surface, which used to be a single long scroll.
 *
 * THE SEAL. Nothing reaches the screen during a match, so while one is in
 * progress the window shows no page at all, only the Recording screen the
 * shell paints. A page asked for while sealed (the review of the match that
 * just ended is the usual one) is remembered and shown when the seal lifts.
 *
 * Pure: no Electron, so test-shell-nav.js drives it directly, the motion
 * between pages included.
 */

const PAGES = [
  { id: 'home', label: 'Home', surface: 'home', query: {}, preload: 'home-preload.js', nav: true },
  { id: 'matches', label: 'Matches', surface: 'matches', query: { section: 'list' }, preload: 'matches-preload.js', nav: true },
  { id: 'patterns', label: 'Patterns', surface: 'matches', query: { section: 'patterns' }, preload: 'matches-preload.js', nav: true },
  { id: 'breakdown', label: 'Breakdown', surface: 'matches', query: { section: 'breakdown' }, preload: 'matches-preload.js', nav: true },
  { id: 'stats', label: 'Stats', surface: 'stats', query: {}, preload: 'stats-preload.js', nav: true },
  { id: 'coach', label: 'Ask Coach', surface: 'chat', query: {}, preload: 'chat-preload.js', nav: true },
  { id: 'settings', label: 'Settings', surface: 'settings', query: {}, preload: 'settings-preload.js', nav: false },
  { id: 'review', label: 'Review', surface: 'review', query: {}, preload: 'review-preload.js', nav: false },
];

function pageOf(id) {
  return PAGES.find((p) => p.id === id) || null;
}

/**
 * Which way the window moves from one page to the next (8.2): 'forward' down
 * the sidebar, Settings at its foot last, 'back' up it, and 'none' when either
 * end is no page (the Recording screen, the window's first page) or both are
 * the same one. The review is deeper than every page, as it opens from the
 * library: forward into it from anywhere, back out of it to anywhere.
 */
function direction(from, to) {
  const a = PAGES.findIndex((p) => p.id === from);
  const b = PAGES.findIndex((p) => p.id === to);
  if (a < 0 || b < 0 || a === b) return 'none';
  if (to === 'review') return 'forward';
  if (from === 'review') return 'back';
  return b > a ? 'forward' : 'back';
}

// A page that never says it is ready is let in after this long (main-window.js),
// a staged one only once the window can be seen (createMotion).
const READY_MS = 150;
// A page loading again is given the time it gives itself before it lets
// itself in (ui.css, page-disarm), because until its new document has painted
// the view still holds the old one's frame. Staged, it too waits on while the
// window cannot be seen.
const LOAD_MS = 1200;

/**
 * MOVING BETWEEN PAGES (8.2): the order of it, for main-window.js to carry out
 * on real views. Pure, so test-shell-nav.js drives it with a fake.
 *
 * A HIDDEN VIEW KEEPS ITS LAST PAINTED FRAME. A page shown and only then told
 * what to look like flashes whatever it showed last, the previous match's
 * review above all. So the page on its way is shown where nobody sees it
 * first: under the page on screen, or, with none on screen (the seal lifting,
 * the window's first page), staged at the edge of the page area. It is told to
 * ARM (invisible, offset toward the side it comes from), paints that, and says
 * so (ready). Only then does the page on screen go and the new one ENTER. A
 * page that never says so is let in after READY_MS.
 *
 * A STAGED PAGE IS LET IN BY ITS TIMER ONLY WHERE THE WINDOW CAN BE SEEN. At a
 * match's end the seal lifts with the game in front: the window is covered,
 * a covered view paints nothing, and so the review staged for it cannot arm,
 * cannot answer, and placed by its timer showed the frame it last painted, the
 * previous match's review, the moment the player looked. So while the window
 * cannot be seen the timer leaves the page staged, and once it can (shown,
 * restored, focused: seen()) the page gets its whole wait again. Its own ready
 * still lets it in at any time: its frames are already asked for, and come
 * the moment its view can paint them.
 *
 * Sealing takes every page away at once, mid switch included, with no motion
 * at all: nothing may reach the screen during a match.
 *
 * @param fx.under(to, from)  show `to` beneath `from`, which stays on top
 * @param fx.stage(to)        show `to` out of sight, at the page area's edge
 * @param fx.place(to)        a staged page into the page area
 * @param fx.hide(id)         out of sight
 * @param fx.keep(id)         a page told to leave stays on screen after all
 * @param fx.send(id, msg)    PUSH_PAGE: { phase: 'arm' | 'enter' | 'leave', dir }
 * @param fx.alive(id)        whether its view is still there to cover with
 * @param fx.canSee()         whether the window can be seen, so a view in it paints
 * @param fx.later(fn, ms) -> handle, fx.cancel(handle)
 * @returns { show(id | null, { reload }), ready(id), seen(), forget(id), state(), reset() }
 */
function createMotion(fx) {
  let onScreen = null;
  let onScreenDir = 'none';   // the way it came in, for a page that loads late
  let coming = null;          // { to, from, dir, staged, timer, ms }

  function arrive(c) {
    if (coming !== c) return;
    coming = null;
    fx.cancel(c.timer);
    if (c.staged) fx.place(c.to);
    if (c.from) fx.hide(c.from);
    onScreen = c.to;
    onScreenDir = c.dir;
    fx.send(c.to, { phase: 'enter', dir: c.dir });
  }

  /**
   * Let `c` in after `ms`, answer or not. A staged page, with no page on
   * screen to stay up over it, waits on where the window cannot be seen
   * (above), until seen() gives it the wait again.
   */
  function wait(c, ms) {
    fx.cancel(c.timer);
    c.ms = ms;
    c.timer = fx.later(() => {
      c.timer = null;
      if (c.staged && !fx.canSee()) return;
      arrive(c);
    }, ms);
  }

  /** The page on its way goes back out of sight. */
  function callOff() {
    const c = coming;
    if (!c) return null;
    coming = null;
    fx.cancel(c.timer);
    fx.hide(c.to);
    return c;
  }

  return {
    /**
     * @param to  the page to show, or null while sealed
     * @param opts.reload  its view is loading its page again: the old
     *   document is not told to arm, and the new one, which arms itself as it
     *   loads, is waited for up to LOAD_MS
     */
    show(to, opts) {
      const reload = !!(opts && opts.reload);
      if (!to) {
        callOff();
        if (onScreen) fx.hide(onScreen);
        onScreen = null;
        return;
      }
      if (coming && coming.to === to) {
        if (reload) wait(coming, LOAD_MS);
        return;
      }
      const off = callOff();
      if (onScreen === to) {
        // Called back before the page on its way arrived: the page told to
        // leave stays, and comes back from its fade.
        if (off) { fx.keep(to); fx.send(to, { phase: 'enter', dir: 'none' }); }
        if (reload) onScreenDir = 'none';
        return;
      }
      const from = onScreen && fx.alive(onScreen) ? onScreen : null;
      const dir = direction(from, to);
      const c = { to, from, dir, staged: !from, timer: null, ms: 0 };
      coming = c;
      if (from) fx.under(to, from); else fx.stage(to);
      if (from) fx.send(from, { phase: 'leave' });
      if (!reload) fx.send(to, { phase: 'arm', dir });
      wait(c, reload ? LOAD_MS : READY_MS);
    },
    /**
     * A page painted its armed frame. The page on its way enters; the page on
     * screen, which armed itself as it loaded (late, or loaded again), is let
     * in; any other is a hidden page that finished loading, and stays armed
     * until it is next shown.
     */
    ready(id) {
      if (coming && coming.to === id) { arrive(coming); return true; }
      if (!coming && onScreen === id) { fx.send(id, { phase: 'enter', dir: onScreenDir }); return true; }
      return false;
    },
    /**
     * The window was shown, restored or focused: it may be seen from now. A
     * staged page on its way waits its whole wait again from here, the time
     * it was given to paint and answer counted from when its view could, so
     * one that never answers still comes in once the window is seen.
     */
    seen() {
      if (coming && coming.staged) wait(coming, coming.ms);
    },
    /**
     * A page's view was closed. The page on screen is no page now; a page on
     * its way is called off and the page it was to replace stays; and a page
     * leaving with nothing left above the one on its way lets that one in.
     */
    forget(id) {
      if (coming && coming.to === id) {
        const c = coming;
        coming = null;
        fx.cancel(c.timer);
        if (c.from) { fx.keep(c.from); fx.send(c.from, { phase: 'enter', dir: 'none' }); }
        return;
      }
      if (coming && coming.from === id) { arrive(coming); }
      if (onScreen === id) onScreen = null;
    },
    state() {
      return { onScreen, coming: coming ? { to: coming.to, from: coming.from, dir: coming.dir, staged: coming.staged } : null };
    },
    /** The window and its views are gone. */
    reset() {
      if (coming) fx.cancel(coming.timer);
      coming = null;
      onScreen = null;
      onScreenDir = 'none';
    },
  };
}

/**
 * @param home  the page the window opens on
 * @returns { go(id), seal(on), state() }, state() being
 *          { page, shown, sealed }: the page the player is on, or will be on
 *          once the seal lifts, and the page whose view is visible (null while
 *          sealed)
 */
function createNav({ home = 'home' } = {}) {
  let page = pageOf(home) ? home : 'home';
  let sealed = false;
  return {
    go(id) {
      if (pageOf(id)) page = id;
      return this.state();
    },
    seal(on) {
      sealed = !!on;
      return this.state();
    },
    state() {
      return { page, shown: sealed ? null : page, sealed };
    },
  };
}

module.exports = { PAGES, pageOf, createNav, direction, createMotion, READY_MS, LOAD_MS };
