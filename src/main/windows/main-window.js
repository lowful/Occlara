'use strict';

const { app, BrowserWindow, WebContentsView, screen } = require('electron');
const path = require('path');
const registry = require('./registry');
const store = require('../services/store');
const C = require('../../shared/channels');
const { pageOf, createNav, createMotion } = require('../../shared/shell-nav');

/**
 * THE ONE WINDOW (8.1).
 *
 * The app used to be a small always-on-top panel and a window for each thing
 * it showed: the review, the library, Settings, Stats, Ask Coach. It is now one
 * window: the shell (src/renderer/shell) draws the sidebar, a top strip with
 * the window's buttons and the Recording screen, and each page is an existing
 * surface in a WebContentsView of its own, laid over the content area.
 *
 * A PAGE IS KEPT ONCE OPENED. Its view is created on the first visit and only
 * hidden afterwards, so the library keeps its scroll, Ask Coach its
 * conversation and Stats what it fetched. A page view is registered under the
 * page's id, so every push reaches it the way it reached its old window.
 *
 * THE SEAL. While a match is in progress no page shows (src/shared/shell-nav.js),
 * whatever asks: the shell paints the Recording screen and the sidebar's pages
 * are locked. A page asked for meanwhile, the review of the match that just
 * ended above all, shows when the seal lifts. HELD is the seal a stop in the
 * middle of a match leaves (index.js): the same screen, but the sidebar stays
 * open, because only the player can say when that match is over.
 *
 * CLOSING HIDES IT. Its X, Alt+F4 and the taskbar's Close put it out of sight
 * as Ctrl+Shift+M does, and Occlara keeps running in the tray: the review that
 * just opened is still being checked against Riot's record, minutes after the
 * match, and quitting would end that. The tray and Settings quit.
 *
 * Not always on top and in the taskbar, unlike the panel it replaces: it sits
 * behind the game like any app, and nothing on it can catch a click mid aim.
 *
 * MOVING BETWEEN PAGES (8.2) is shell-nav.js createMotion, carried out here.
 * A hidden view keeps its last painted frame, so the page on its way is shown
 * where nobody sees it, told to arm, and let in once it has painted that
 * (PAGE_READY), or after READY_MS. Where that can be is decided by two things
 * Chromium does:
 *
 *  - A VIEW COVERED BY AN OPAQUE ONE IS HIDDEN. Chromium counts it occluded
 *    and stops it painting: measured on Electron 41, a page under another ran
 *    no animation frame at all, so it could never arm there. So for the
 *    switch the page on screen is made see-through behind its own page (its
 *    document still paints the ground, so nothing on screen changes) and the
 *    page under it paints. Opaque again once it is hidden or stays.
 *  - A VIEW WHOLLY OUTSIDE THE WINDOW IS HIDDEN TOO, and one with a pixel of
 *    itself inside it paints. With no page on screen to go under (the seal
 *    lifting, the window's first page), the page is staged at full size with
 *    STAGE_PX of its left edge, page ground, over the right edge of the page
 *    area, and moved into place once armed: the same size, so the frame it
 *    painted is the frame shown.
 *
 * And a page in a window nobody can see (hidden, minimised, or behind the
 * game, which is where a match's end finds it) paints nothing at all, so a
 * staged page is let in by its timer only once the window can be seen
 * (canSee()), and its wait starts again as the window is shown, restored or
 * focused.
 *
 * A PAGE LOADING AGAIN (Ask Coach on another match) still has its old document
 * until the new one commits, and that one can still say it is ready: to an arm
 * from before, its two frames waiting in a view that could not paint them. So
 * from reload() to the new document's commit no ready from that page counts
 * (reloading), and the switch waits for the new document's own.
 */

// The shell lays itself out at these sizes (shell.css): change both together.
const SIDEBAR_W = 232;
const TOP_H = 40;
const DEFAULT_W = 1200;
const DEFAULT_H = 780;
const MIN_W = 960;
const MIN_H = 640;
// How much of a staged page is inside the window (above): enough for Chromium
// to paint it, and only the page's own left margin.
const STAGE_PX = 1;
// A page view's ground, and its see-through state while a page is on its way
// under it. #08090A is --bg (theme.css).
const GROUND = '#08090A';
const CLEAR = '#00000000';

let win = null;
const views = new Map();   // page id -> WebContentsView
let nav = createNav();
let held = false;          // the seal is the one a stop mid match left
let quitting = false;      // the app is quitting: closing the window closes it
let maximizeOnShow = false;
let onChange = null;       // index.js: the corner mark and the tray follow the window
let staged = null;         // the page shown out of sight at the page area's edge
const reloading = new Set();   // pages loading again, until their new document commits

const motion = createMotion({
  under(to, from) {
    const b = views.get(to);
    const a = views.get(from);
    if (!alive(b) || !win || win.isDestroyed()) return;
    if (alive(a)) {
      // Re-adding a view that is already a child moves it to the top.
      win.contentView.addChildView(a);
      a.setBackgroundColor(CLEAR);
    }
    b.setVisible(true);
  },
  stage(to) {
    const b = views.get(to);
    if (!alive(b)) return;
    staged = to;
    layout();
    b.setVisible(true);
  },
  place(to) {
    if (staged === to) staged = null;
    layout();
  },
  hide(id) {
    const v = views.get(id);
    if (alive(v)) {
      v.setVisible(false);
      v.setBackgroundColor(GROUND);
    }
    // Out of sight first, then back to the page area's bounds for next time.
    if (staged === id) { staged = null; layout(); }
  },
  keep(id) {
    const v = views.get(id);
    if (alive(v)) v.setBackgroundColor(GROUND);
  },
  send(id, msg) {
    const v = views.get(id);
    if (alive(v)) v.webContents.send(C.PUSH_PAGE, msg);
  },
  alive: (id) => alive(views.get(id)),
  canSee: () => canSee(),
  later: (fn, ms) => setTimeout(fn, ms),
  cancel: (t) => clearTimeout(t),
});

// Quitting by any path, the tray, Settings or an update restarting the app,
// lets the window close for real.
app.on('before-quit', () => { quitting = true; });

function changed(kind) {
  if (!onChange) return;
  try { onChange(kind); } catch (e) { console.warn('[main-window] change hook:', e.message); }
}

/** Saved bounds that still land on a connected display, else none. */
function savedBounds() {
  const b = store.get('mainBounds');
  if (!b || !Number.isFinite(b.width) || !Number.isFinite(b.height)) return null;
  const width = Math.max(MIN_W, b.width);
  const height = Math.max(MIN_H, b.height);
  if (!Number.isFinite(b.x) || !Number.isFinite(b.y)) return { width, height };
  // A monitor unplugged since would leave the window somewhere nobody can see.
  const onScreen = screen.getAllDisplays().some((d) => {
    const a = d.workArea;
    return b.x < a.x + a.width - 80 && b.x + width > a.x + 80 && b.y >= a.y - 20 && b.y < a.y + a.height - 80;
  });
  return onScreen ? { x: b.x, y: b.y, width, height } : { width, height };
}

/**
 * @param opts.deferShow  build and load the window but keep it hidden until
 *   reveal(): at launch the splash plays alone and the app appears when it
 *   finishes, as the panel did.
 */
function create(opts) {
  if (win && !win.isDestroyed()) return win;
  const deferShow = !!(opts && opts.deferShow);
  const b = savedBounds() || { width: DEFAULT_W, height: DEFAULT_H };
  // A window made again opens on Home, and KEEPS THE SEAL: made mid match by a
  // page asked for, it showed that page until the next check sealed it.
  const was = { sealed: nav.state().sealed, held };
  nav = createNav();
  if (was.sealed) nav.seal(true);
  held = was.sealed && was.held;
  // Left maximised last time, it comes back maximised. Not here: maximize()
  // shows a window, and a deferred one would appear behind the splash.
  maximizeOnShow = !!store.get('mainMaximized');
  closeViews();   // any left from a window gone before its 'closed' arrived
  motion.reset();
  staged = null;
  const self = new BrowserWindow({
    ...b,
    ...(Number.isFinite(b.x) ? {} : { center: true }),
    minWidth: MIN_W,
    minHeight: MIN_H,
    frame: false,
    backgroundColor: '#08090A',
    show: false,
    title: 'Occlara',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false, // false so the preload can require the shared modules
      preload: path.join(__dirname, '../../preload/shell-preload.js'),
    },
  });
  win = self;
  self.loadFile(path.join(__dirname, '../../renderer/shell/index.html'));
  self.once('ready-to-show', () => { if (!deferShow && win === self) bringUp(true); });

  const save = () => {
    if (self.isDestroyed() || self.isMinimized()) return;
    store.set('mainMaximized', self.isMaximized());
    if (!self.isMaximized()) store.set('mainBounds', self.getBounds());
  };
  self.on('resize', layout);
  self.on('resized', save);
  self.on('moved', save);
  self.on('maximize', () => { layout(); save(); push(); });
  self.on('unmaximize', () => { layout(); save(); push(); });
  self.on('close', (e) => {
    if (quitting) return;
    e.preventDefault();
    self.hide();
  });
  self.on('session-end', () => { quitting = true; });
  self.on('show', () => changed('show'));
  self.on('hide', () => changed('hide'));
  self.on('minimize', () => changed('minimize'));
  self.on('restore', () => changed('restore'));
  // A page staged while nobody could see the window gets its wait again from
  // the moment somebody can (canSee() below). Restored, the views are laid
  // out again first: minimised, the window's content measures 0 by 0, a view
  // laid out then is given that, and no resize comes on the way back, so a
  // page staged while minimised stayed 0 by 0, never painted, and never said
  // it was ready.
  const seen = () => { if (win === self) motion.seen(); };
  self.on('show', seen);
  self.on('restore', () => { if (win === self) layout(); seen(); });
  self.on('focus', seen);
  self.on('closed', () => {
    if (win !== self) return;
    win = null;
    motion.reset();
    staged = null;
    closeViews();
  });

  registry.register('main', self);
  apply();
  return self;
}

/**
 * A view's page is not closed with the window it was laid on, and the registry
 * would go on sending it every push.
 */
function closeViews() {
  for (const v of views.values()) {
    try { if (alive(v)) v.webContents.close(); } catch { /* already gone */ }
  }
  views.clear();
  reloading.clear();
}

/**
 * Whether a view's page is still there. Once closed a view's webContents is
 * not a destroyed object but undefined, so it is never read unchecked.
 */
function alive(v) {
  return !!(v && v.webContents && !v.webContents.isDestroyed());
}

/**
 * Whether the window can be seen, and so whether a view in it can paint:
 * shown, not minimised, and in front. Electron says whether it has the focus
 * but not whether the game covers it, and a covered view paints nothing, so a
 * window without the focus is taken as one nobody can see: at a match's end
 * the game has the focus and this window is behind it. A window on a second
 * monitor is the one this gets wrong, and costs nothing there: its pages can
 * paint, so they answer for themselves.
 */
function canSee() {
  const w = get();
  return !!(w && w.isVisible() && !w.isMinimized() && w.isFocused());
}

/**
 * On screen: restored if minimised, maximised if it was left so, and focused
 * unless `focus` is false (mid match, so the game keeps the keyboard).
 */
function bringUp(focus) {
  const w = get();
  if (!w) return;
  if (w.isMinimized()) { if (focus) w.restore(); else w.showInactive(); }
  if (maximizeOnShow) {
    maximizeOnShow = false;
    if (!w.isMaximized()) w.maximize();   // shows it, without focus
  }
  if (!w.isVisible()) { if (focus) w.show(); else w.showInactive(); }
  if (focus) w.focus();
}

/** The page's view, made on its first visit. */
function ensureView(id) {
  const had = views.get(id);
  if (alive(had)) return had;
  const p = pageOf(id);
  if (!p || !win || win.isDestroyed()) return null;
  // A page that closed itself is made again, and its empty view taken away.
  if (had) {
    views.delete(id);
    try { win.contentView.removeChildView(had); } catch { /* not laid on this window */ }
  }
  const v = new WebContentsView({
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      preload: path.join(__dirname, '../../preload', p.preload),
    },
  });
  v.setBackgroundColor(GROUND);
  v.setVisible(false);
  win.contentView.addChildView(v);
  // The page knows its own id (embed.js), to say it is ready by it.
  v.webContents.loadFile(path.join(__dirname, '../../renderer', p.surface, 'index.html'),
    { query: { embed: '1', page: p.id, ...p.query } });
  // A page on screen or on its way whose view closes is no longer either.
  v.webContents.once('destroyed', () => { if (views.get(id) === v) motion.forget(id); });
  // A page loading again has only its new document once that commits, or once
  // an error page takes the old one's place: its readies count again (pageReady).
  const loaded = () => { if (views.get(id) === v) reloading.delete(id); };
  v.webContents.on('did-navigate', loaded);
  v.webContents.on('did-fail-load', (_e, _code, _what, _url, mainFrame) => { if (mainFrame) loaded(); });
  registry.register(p.id, v);
  views.set(id, v);
  layout();
  return v;
}

function layout() {
  if (!win || win.isDestroyed()) return;
  const [w, h] = win.getContentSize();
  const rect = { x: SIDEBAR_W, y: TOP_H, width: Math.max(0, w - SIDEBAR_W), height: Math.max(0, h - TOP_H) };
  for (const [id, v] of views) {
    if (!alive(v)) continue;
    // A staged page keeps the page area's size and sits off its right edge.
    v.setBounds(id === staged ? { ...rect, x: w - STAGE_PX } : rect);
  }
}

function state() {
  const s = nav.state();
  return { ...s, held: s.sealed && held, maximized: !!(win && !win.isDestroyed() && win.isMaximized()) };
}

function push() {
  registry.sendTo('main', C.PUSH_SHELL, state());
}

/**
 * Show the page the navigation says, by way of the motion above, and hide
 * every other. Sealed, every page goes at once, in this call.
 * @param opts.reload  the page's view is loading its page again
 */
function apply(opts) {
  const s = nav.state();
  if (s.shown) ensureView(s.shown);
  motion.show(s.shown, { reload: !!(opts && opts.reload) });
  // Only the page on screen and the one on its way are ever shown.
  const m = motion.state();
  for (const [id, v] of views) {
    if (alive(v) && id !== m.onScreen && !(m.coming && m.coming.to === id) && v.getVisible()) v.setVisible(false);
  }
  push();
}

/**
 * PAGE_READY: a page painted itself armed. Taken from that page's own view
 * only, so no page can let another in, and from its current document only: a
 * view loading its page again keeps its webContents, and with it its id, so
 * until the new document commits a ready is the old one's and changes nothing.
 */
function pageReady(id, sender) {
  const v = views.get(id);
  if (!alive(v) || (sender && v.webContents.id !== sender.id)) return false;
  if (reloading.has(id)) return false;
  return motion.ready(id);
}

/**
 * Go to a page. The window comes forward (restored, shown and, unless told
 * otherwise, focused), and so does the page, so a keyboard player lands in it.
 * While sealed only the destination is remembered.
 *
 * @param opts.focus   false to bring the window up without taking focus
 * @param opts.reveal  false to change the page without touching the window
 * @param opts.reload  true to load the page again (Ask Coach on another match)
 */
function show(id, opts) {
  const o = opts || {};
  if (!pageOf(id)) return false;
  // Asked for a page with no window yet (Settings from the tour, a boot
  // check), the window is made, as each page's own window used to be. Asked
  // not to come forward, it is made out of sight.
  if (!win || win.isDestroyed()) create({ deferShow: o.reveal === false });
  nav.go(id);
  let reload = false;
  if (o.reload) {
    const v = views.get(id);
    if (alive(v)) {
      // Marked first: from here to the new document's commit, any ready from
      // this page is the document being replaced (pageReady).
      reloading.add(id);
      v.webContents.reload();
      reload = true;
    }
  }
  apply({ reload });
  if (!win || win.isDestroyed()) return false;
  if (o.reveal !== false) bringUp(o.focus !== false);
  const v = views.get(id);
  if (alive(v) && o.focus !== false && o.reveal !== false) {
    const focusPage = () => {
      const s = nav.state();
      if (alive(v) && !s.sealed && s.shown === id) v.webContents.focus();
    };
    // Focused once loaded again: focused now, the page being replaced took
    // the focus and with it, in Ask Coach, the question meant for the new one.
    if (reload) v.webContents.once('did-finish-load', focusPage);
    else focusPage();
  }
  return true;
}

/** @param opts.held  the seal a stop mid match left: the sidebar stays open */
function setSealed(on, opts) {
  const h = !!on && !!(opts && opts.held);
  if (nav.state().sealed === !!on && held === h) return;
  held = h;
  nav.seal(!!on);
  apply();
}

function current() { return nav.state(); }

/**
 * What the shell is told, the same shape PUSH_SHELL carries. The shell asks
 * for it at boot (SHELL_GET), and answering with current() lost the held
 * flag: a shell loaded again during a held seal painted the live Recording
 * screen and locked its sidebar, the one way out of a held seal.
 */
function shellState() { return state(); }

function get() { return win && !win.isDestroyed() ? win : null; }

/**
 * Show the window, made again if it is gone: the splash handing over, a second
 * launch of the app. Safe to call more than once.
 */
function reveal() {
  if (!get()) create({ deferShow: true });
  bringUp(true);
}

function minimize() { const w = get(); if (w) w.minimize(); }

/** Out of sight, as its X does: the tray and Ctrl+Shift+M bring it back. */
function hide() { const w = get(); if (w && w.isVisible()) w.hide(); }

function toggleMaximize() {
  const w = get();
  if (!w) return;
  if (w.isMaximized()) w.unmaximize(); else w.maximize();
}

/** Whether the window is out of sight: hidden by the shortcut, or minimised. */
function isHidden() {
  const w = get();
  return !w || !w.isVisible() || w.isMinimized();
}

/**
 * Ctrl+Shift+M: out of sight, or back. Returns whether it is now hidden.
 * @param opts.focus  false to come back without taking focus from the game
 */
function toggleHidden(opts) {
  const focus = !(opts && opts.focus === false);
  const w = get();
  if (!w || isHidden()) {
    if (!w) create({ deferShow: true });
    bringUp(focus);
    return false;
  }
  w.hide();
  return true;
}

/** The corner mark and the tray follow the window: fn('show' | 'hide' | 'minimize' | 'restore'). */
function onWindowChange(fn) { onChange = typeof fn === 'function' ? fn : null; }

/** The page views by id, for the boot checks. */
function pageViews() { return new Map(views); }

/** The page on screen and the one on its way, which is staged and which are loading again, for the checks. */
function motionState() { return { ...motion.state(), staged, reloading: [...reloading] }; }

module.exports = {
  create, get, reveal, show, setSealed, current, shellState, minimize, hide, toggleMaximize, isHidden, toggleHidden,
  onWindowChange, pageReady, pageViews, motionState, SIDEBAR_W, TOP_H, STAGE_PX,
};
