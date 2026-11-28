'use strict';

/**
 * The one window's pages, which of them shows, and how the window moves from
 * one to the next.
 *
 * Since 8.1 the app is one window: a sidebar, and the page beside it. Each
 * page is an existing surface loaded in a view of its own (main-window.js), so
 * a page keeps its scroll, its chat and its state when the player goes
 * elsewhere and comes back. Matches and Patterns are two sections of the one
 * library surface, which used to be a single long scroll; Moments (8.7) is a
 * surface of its own, in the place the Breakdown tab had.
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
  // Practice (docs/claude/ui.md, "The Practice page"): a plan from the
  // repeated mistakes Patterns lists, right after it, and its drills.
  { id: 'practice', label: 'Practice', surface: 'practice', query: {}, preload: 'practice-preload.js', nav: true },
  // The Trainer (docs/claude/trainer.md): an aim and movement trainer in the
  // page, right after the drills that link into it. Sealed like every page.
  { id: 'trainer', label: 'Trainer', surface: 'trainer', query: {}, preload: 'trainer-preload.js', nav: true },
  // Moments (8.7) took the Breakdown tab's place: the player's deaths and
  // highlights, compiled. The breakdown's numbers fold into Patterns.
  { id: 'moments', label: 'Clips', surface: 'moments', query: {}, preload: 'moments-preload.js', nav: true },
  { id: 'stats', label: 'Stats', surface: 'stats', query: {}, preload: 'stats-preload.js', nav: true },
  { id: 'coach', label: 'Ask Coach', surface: 'chat', query: {}, preload: 'chat-preload.js', nav: true },
  // Players (docs/claude/social.md): search Occlara players who opted in, by
  // username or Riot ID, and their public profiles. The top bar is full, so it
  // is the account menu's first row, beside Profile, and reached from
  // Profile's "Public profile" section and Home. Sealed like every page.
  { id: 'players', label: 'Players', surface: 'players', query: {}, preload: 'players-preload.js', nav: false },
  // Occlara Duos (docs/claude/duos.md): a friend's side of the matches played
  // together. Players' family, so the account menu's row under Players (the
  // top bar is full), shown only once the server says Duos is open, and
  // sealed like every page.
  { id: 'duos', label: 'Duos', surface: 'duos', query: {}, preload: 'duos-preload.js', nav: false },
  // The Invite page (8.7): a button in the sidebar's foot directly above
  // Settings, not a nav entry, and locked by the seal like every page.
  { id: 'invite', label: 'Invite', surface: 'invite', query: {}, preload: 'invite-preload.js', nav: false },
  // The Profile page (8.8): the games left, buying more, the player's own
  // figures and the plans, a button in the foot between Invite and Settings.
  { id: 'profile', label: 'Profile', surface: 'profile', query: {}, preload: 'profile-preload.js', nav: false },
  { id: 'settings', label: 'Settings', surface: 'settings', query: {}, preload: 'settings-preload.js', nav: false },
  // What's new (the changelog): no sidebar entry, opened from Settings (its
  // row and the version line) and from Home's update line, one step deeper
  // than Settings, and locked by the seal like every page.
  { id: 'whatsnew', label: "What's new", surface: 'whatsnew', query: {}, preload: 'whatsnew-preload.js', nav: false },
  // Report a problem (docs/claude/feedback.md): no nav entry, the quiet icon
  // at the end of Profile's row in the foot, directly above the Discord,
  // and locked by the seal like every page.
  { id: 'feedback', label: 'Report a problem', surface: 'feedback', query: {}, preload: 'feedback-preload.js', nav: false },
  { id: 'review', label: 'Review', surface: 'review', query: {}, preload: 'review-preload.js', nav: false },
];

function pageOf(id) {
  return PAGES.find((p) => p.id === id) || null;
}

/*
 * THE TOP BAR (Orbit, 27 Nov 2026): four links, each a group of the pages
 * above, so no page is lost. Matches holds the library, Patterns and Stats
 * (reached inside it by a segmented switch, shared/subnav.js) and the review
 * it opens; Practice holds the drills and the Trainer; Clips is the Moments
 * page. A link goes to its group's first page. Ask Coach opens from a
 * review's "Ask about this match" and from the account menu, as Profile,
 * Players, Duos, Invite, Settings, What's new and Report a problem do. The
 * `nav` flag on a page above still says it is one of the app's primary pages.
 * The link's id is the page it lands on, so a link is found by its page.
 */
const TOP = [
  { id: 'home', label: 'Home', pages: ['home'] },
  { id: 'matches', label: 'Matches', pages: ['matches', 'patterns', 'stats', 'review'] },
  { id: 'practice', label: 'Practice', pages: ['practice', 'trainer'] },
  { id: 'moments', label: 'Clips', pages: ['moments'] },
];

/** The top bar's link a page sits under, or null for a page of the account menu. */
function topOf(id) {
  return TOP.find((t) => t.pages.includes(id)) || null;
}

/*
 * THE SUB SWITCH of a group (shared/subnav.js draws it at the head of each of
 * its pages): the pages a player moves between inside it, in order, and the
 * word for each. The review is opened, never chosen, so it is no button.
 */
const SUB = {
  matches: [['matches', 'Matches'], ['patterns', 'Patterns'], ['stats', 'Stats']],
  practice: [['practice', 'Drills'], ['trainer', 'Trainer']],
};

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
 * THE RECORDING VIEW (9.1, the owner's item 14). Pressing Start takes the
 * player to the Recording screen at once, in its waiting state, rather than
 * leaving them on Home until the match is seen. It is the same screen the
 * seal shows, but no seal: no match is in progress, so nothing is locked and
 * any page the player opens (go) takes its place. It holds through a match
 * (the seal shows the screen then anyway) and, with no page asked for, after
 * one; the review of the match that ended is asked for, so it shows.
 *
 * @param home  the page the window opens on
 * @returns { go(id), seal(on), recording(on), state() }, state() being
 *          { page, shown, sealed, rec }: the page the player is on, or will be
 *          on once the seal lifts and the Recording view goes, the page whose
 *          view is visible (null while sealed or on the Recording view), and
 *          whether the Recording view is up
 */
function createNav({ home = 'home' } = {}) {
  let page = pageOf(home) ? home : 'home';
  let sealed = false;
  let rec = false;
  return {
    go(id) {
      if (pageOf(id)) { page = id; rec = false; }
      return this.state();
    },
    seal(on) {
      sealed = !!on;
      return this.state();
    },
    recording(on) {
      rec = !!on;
      return this.state();
    },
    state() {
      return { page, shown: sealed || rec ? null : page, sealed, rec };
    },
  };
}

/*
 * THE HISTORY (9.1, the owner's item 7): the pages the player visited, in
 * order, so the mouse's side buttons (Windows' app-command browser-backward
 * and browser-forward on the window, and a page's own mouse buttons 3 and 4)
 * go back and forward through them as a browser's do, and the review can draw
 * its own back arrow. An entry is { page, key }: the key tells one visit of a
 * page from another (a review's id), null for every other page. Visiting the
 * entry already current adds nothing; visiting from the middle of the list
 * drops what was ahead of it, as a browser does. Pure: main-window.js holds
 * one, index.js decides which entries can still be gone back to (a review
 * deleted since cannot).
 */
const HISTORY_MAX = 50;

function createHistory({ max = HISTORY_MAX } = {}) {
  let list = [];
  let at = -1;
  const same = (a, b) => !!a && !!b && a.page === b.page && (a.key || null) === (b.key || null);
  const entry = (e) => ({ page: e.page, key: e.key === undefined || e.key === null ? null : String(e.key) });
  const find = (dir, ok) => {
    const d = dir < 0 ? -1 : 1;
    for (let i = at + d; i >= 0 && i < list.length; i += d) {
      if (!ok || ok({ ...list[i] })) return i;
    }
    return -1;
  };
  return {
    /** A page shown that was not a step through the history: true when it was added. */
    visit(e) {
      if (!e || !pageOf(e.page)) return false;
      const next = entry(e);
      if (same(list[at], next)) return false;
      list = list.slice(0, at + 1);
      list.push(next);
      if (list.length > max) list = list.slice(list.length - max);
      at = list.length - 1;
      return true;
    },
    /**
     * One step back (dir < 0) or forward, passing over every entry ok()
     * refuses: the entry landed on, or null with nothing moved.
     */
    step(dir, ok) {
      const i = find(dir, ok);
      if (i < 0) return null;
      at = i;
      return { ...list[at] };
    },
    /** The entry a step would land on, nothing moved, or null. */
    peek(dir, ok) {
      const i = find(dir, ok);
      return i < 0 ? null : { ...list[i] };
    },
    /** The entry the player is on, or null before any. */
    current() {
      return at >= 0 && list[at] ? { ...list[at] } : null;
    },
    /**
     * Every entry pred() names taken out (a review deleted): the current
     * entry stays current when it survives, else the one before it does, and
     * two entries left side by side that are the same become one.
     */
    drop(pred) {
      if (typeof pred !== 'function') return false;
      const was = list.length;
      const keep = [];
      let nextAt = -1;
      list.forEach((e, i) => {
        if (pred({ ...e })) return;
        if (keep.length && same(keep[keep.length - 1], e)) { if (i <= at) nextAt = keep.length - 1; return; }
        keep.push(e);
        if (i <= at) nextAt = keep.length - 1;
      });
      list = keep;
      at = list.length ? Math.max(0, nextAt) : -1;
      return list.length !== was;
    },
    /** { back, forward, backTo, forwardTo, at, length }, ok() as step() takes it. */
    state(ok) {
      const b = this.peek(-1, ok);
      const f = this.peek(1, ok);
      return { back: !!b, forward: !!f, backTo: b ? b.page : null, forwardTo: f ? f.page : null, at, length: list.length };
    },
    reset() { list = []; at = -1; },
  };
}

/*
 * ONE PRESS, ONE STEP. A mouse's side button reaches the app twice on
 * Windows: as WM_APPCOMMAND, which Electron gives the window as 'app-command'
 * (browser-backward, browser-forward), and as the page's own mouse button 3
 * or 4. Either can be missing (a mouse driver that sends no app-command, a
 * press over the bar), so both are heard and the second of a pair is dropped:
 * a step the same way from the other source within `ms` of the last one
 * taken. Presses from one source are never dropped, so a fast double press
 * goes back twice.
 */
function createHistoryGate({ ms = 400, now = () => Date.now() } = {}) {
  let last = null;
  return {
    /** @param dir 'back' | 'forward'  @param from 'app' | 'mouse' | 'page' */
    allow(dir, from) {
      const t = now();
      if (last && last.dir === dir && last.from !== from && t - last.at < ms) return false;
      last = { dir, from, at: t };
      return true;
    },
  };
}

module.exports = { PAGES, TOP, SUB, pageOf, topOf, createNav, direction, createMotion, createHistory, createHistoryGate, HISTORY_MAX, READY_MS, LOAD_MS };
