'use strict';

const { app, BrowserWindow, WebContentsView, screen } = require('electron');
const path = require('path');
const registry = require('./registry');
const store = require('../services/store');
const C = require('../../shared/channels');
const { pageOf, createNav } = require('../../shared/shell-nav');

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
 */

// The shell lays itself out at these sizes (shell.css): change both together.
const SIDEBAR_W = 232;
const TOP_H = 40;
const DEFAULT_W = 1200;
const DEFAULT_H = 780;
const MIN_W = 960;
const MIN_H = 640;

let win = null;
const views = new Map();   // page id -> WebContentsView
let nav = createNav();
let held = false;          // the seal is the one a stop mid match left
let quitting = false;      // the app is quitting: closing the window closes it
let maximizeOnShow = false;
let onChange = null;       // index.js: the corner mark and the tray follow the window

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
  self.on('closed', () => {
    if (win !== self) return;
    win = null;
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
}

/**
 * Whether a view's page is still there. Once closed a view's webContents is
 * not a destroyed object but undefined, so it is never read unchecked.
 */
function alive(v) {
  return !!(v && v.webContents && !v.webContents.isDestroyed());
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
  v.setBackgroundColor('#08090A');
  v.setVisible(false);
  win.contentView.addChildView(v);
  v.webContents.loadFile(path.join(__dirname, '../../renderer', p.surface, 'index.html'),
    { query: { embed: '1', ...p.query } });
  registry.register(p.id, v);
  views.set(id, v);
  layout();
  return v;
}

function layout() {
  if (!win || win.isDestroyed()) return;
  const [w, h] = win.getContentSize();
  const rect = { x: SIDEBAR_W, y: TOP_H, width: Math.max(0, w - SIDEBAR_W), height: Math.max(0, h - TOP_H) };
  for (const v of views.values()) {
    if (alive(v)) v.setBounds(rect);
  }
}

function state() {
  const s = nav.state();
  return { ...s, held: s.sealed && held, maximized: !!(win && !win.isDestroyed() && win.isMaximized()) };
}

function push() {
  registry.sendTo('main', C.PUSH_SHELL, state());
}

/** Show the page the navigation says, and hide every other. */
function apply() {
  const s = nav.state();
  if (s.shown) ensureView(s.shown);
  for (const [id, v] of views) {
    if (alive(v)) v.setVisible(id === s.shown);
  }
  push();
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
  let reloading = false;
  if (o.reload) {
    const v = views.get(id);
    if (alive(v)) { v.webContents.reload(); reloading = true; }
  }
  apply();
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
    if (reloading) v.webContents.once('did-finish-load', focusPage);
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

module.exports = {
  create, get, reveal, show, setSealed, current, minimize, hide, toggleMaximize, isHidden, toggleHidden,
  onWindowChange, pageViews, SIDEBAR_W, TOP_H,
};
