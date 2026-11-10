'use strict';

const { app, BrowserWindow, WebContentsView, screen, ipcMain } = require('electron');
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
 * CLOSING QUITS (8.4.1). Its X, Alt+F4 and the taskbar's Close used to put it
 * out of sight as Ctrl+Shift+M does, Occlara running on in the tray, and the
 * player asked for closing to close it. Each is the window's 'close', which is
 * held here and handed to index.js on the next turn (onCloseAsk, and never
 * inside the event: a quit there is one Electron cancels): it quits by the
 * tray's own path, and first asks, only when quitting would lose a match being
 * recorded, a review still being built or a League game's death clips still
 * being cut. Kept open, the window stays as it was. A
 * quit already under way (before-quit: the tray's Quit, Settings', an update's
 * Restart now) and Windows ending its session let it close for real.
 * Ctrl+Shift+M still hides it to the corner mark.
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
// TOP NAVIGATION (Progress v3): no sidebar, a 64px bar across the top.
//
// THE ACCOUNT MENU FLOATS OVER THE PAGE (8.9.1). A page's view paints over the
// shell's document, so the menu the avatar opens, which hangs below the bar,
// cannot be drawn by the shell: until 8.9.1 the page was narrowed by the
// menu's width for the full height while it was open, an empty strip and a
// page reflowing under it. Now it is a small see-through view of its own
// (src/renderer/menu), laid on top of every page only while open and sized to
// the menu and its shadow, so the page under it keeps its bounds. The shell
// stays its owner: it lays the menu out (its #drawer, never painted) and sends
// its markup and rectangle (SHELL_MENU), and the view draws it, moves through
// it by keyboard and says what was chosen (MENU_ACT), which the shell carries
// out on its own rows (PUSH_MENU_ACT), seal locks and all.
const SIDEBAR_W = 0;
const TOP_H = 64;
const MENU_MAX = 640;      // the most the view may be, either way, whatever the shell asks
let menuView = null;
let menuOpen = false;
let menuQueued = null;     // what to draw once the menu's document has loaded
// THE GAMES TOAST (8.9.1, ui.md "The games toast"): "You got 2 games" at the
// top right, under the bar, over every page, in a see-through view of its own
// made the menu's way. One at a time from toastQueue; never while sealed,
// hidden or minimised: then it waits, and a toast on screen as the seal comes
// on goes at once and is put back at the front, to be shown whole later.
const TOAST_MAX = 12;
let toastView = null;
let toastQueue = [];       // toasts waiting, oldest first
let toastNow = null;       // the toast on screen
let toastSent = null;      // what to send once the toast's document has loaded
let onToastOpen = null;    // index.js: a toast clicked opens Profile
const DEFAULT_W = 1200;
const DEFAULT_H = 780;
const MIN_W = 960;
const MIN_H = 640;
// How much of a staged page is inside the window (above): enough for Chromium
// to paint it, and only the page's own left margin.
const STAGE_PX = 1;
// A page view's ground, and its see-through state while a page is on its way
// under it. #07080C is --bg (theme.css).
const GROUND = '#07080C';
const CLEAR = '#00000000';

let win = null;
const views = new Map();   // page id -> WebContentsView
let nav = createNav();
let held = false;          // the seal is the one a stop mid match left
let quitting = false;      // the app is quitting: closing the window closes it
let maximizeOnShow = false;
let onChange = null;       // index.js: the corner mark and the tray follow the window
let onEnd = null;          // index.js: what must be done before Windows ends its session
let onClose = null;        // index.js: a close asked for, which quits, asking first if it would lose something
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
      raiseMenu();
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
    backgroundColor: '#07080C',   // is --bg (theme.css)
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
  // Made again while sealed, it is out of the recording from its first frame.
  protect(nav.state().sealed);
  self.loadFile(path.join(__dirname, '../../renderer/shell/index.html'));
  self.once('ready-to-show', () => { if (!deferShow && win === self) bringUp(true); });
  // The account menu's view is made once the shell has loaded, hidden, so its
  // first opening does not wait on a document loading.
  self.webContents.once('did-finish-load', () => { if (win === self) { ensureMenu(); pumpToast(); } });

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
  // Its X, Alt+F4 and the taskbar's Close: held, and handed to index.js, which
  // quits once nothing would be lost by it or the player says so. Never hidden
  // in the tray any more.
  //
  // HANDED OVER ON THE NEXT TURN, NEVER INSIDE THIS EVENT. Electron takes a
  // close prevented here for a quit cancelled: once this handler returns it
  // clears its quitting flag (Browser::OnWindowCloseCancelled). So a quit
  // called in the same turn, as closing with nothing at stake did, closed
  // every window and then never quit, index.js's window-all-closed keeping the
  // app alive for a tray its cleanup had already taken down: the process ran
  // on with no window and no tray (measured on Electron 41, the real index.js
  // closed by Alt+F4 and by the X: still running 5 s on, with 0 windows).
  self.on('close', (e) => {
    if (quitting) return;
    e.preventDefault();
    setImmediate(() => {
      // A quit begun meanwhile (the tray's Quit, Windows ending its session)
      // closes the window by itself, and nothing is left to ask.
      if (quitting) return;
      if (onClose) {
        try { onClose(); } catch (err) { console.warn('[main-window] close hook:', err.message); }
      } else if (typeof app.quit === 'function') {
        app.quit();
      }
    });
  });
  // Windows is shutting down, restarting or logging off: no before-quit comes,
  // and the process can be ended as soon as this returns, so what must not be
  // left behind (the match recording, index.js) goes now, synchronously.
  self.on('session-end', () => {
    quitting = true;
    if (onEnd) { try { onEnd(); } catch (e) { console.warn('[main-window] session end hook:', e.message); } }
  });
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
  // A toast waiting for the window to be seen comes now; hidden or
  // minimised, the one on screen waits for the next time.
  self.on('show', () => { if (win === self) pumpToast(); });
  self.on('restore', () => { if (win === self) pumpToast(); });
  self.on('hide', () => { if (win === self) withdrawToast(); });
  self.on('minimize', () => { if (win === self) withdrawToast(); });
  self.on('focus', seen);
  // The account menu shuts as the window loses the focus (another app, the
  // game), as an open list does.
  self.on('blur', () => { if (win === self) closeMenu(); });
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
  try { if (alive(menuView)) menuView.webContents.close(); } catch { /* already gone */ }
  menuView = null;
  menuOpen = false;
  menuQueued = null;
  try { if (alive(toastView)) toastView.webContents.close(); } catch { /* already gone */ }
  toastView = null;
  // A toast on screen as its window goes is shown again in the next one.
  if (toastNow) toastQueue.unshift(toastNow);
  toastNow = null;
  toastSent = null;
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
  raiseMenu();
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
  // The page area is the same with the account menu open or shut: the menu
  // is a view over it (openMenu), never a strip taken from it.
  const rect = { x: SIDEBAR_W, y: TOP_H, width: Math.max(0, w - SIDEBAR_W), height: Math.max(0, h - TOP_H) };
  for (const [id, v] of views) {
    if (!alive(v)) continue;
    // A staged page keeps the page area's size and sits off its right edge.
    v.setBounds(id === staged ? { ...rect, x: w - STAGE_PX } : rect);
  }
  if (alive(toastView)) toastView.setBounds(toastBounds(w, h));
}

// ── The account menu (8.9.1), over the page ───────────────────────────────

/** The menu's view, made once per window and kept, hidden, between openings. */
function ensureMenu() {
  if (alive(menuView)) return menuView;
  if (!win || win.isDestroyed()) return null;
  const v = new WebContentsView({
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      preload: path.join(__dirname, '../../preload/menu-preload.js'),
    },
  });
  // See-through: only the menu and its shadow paint, the page shows round it.
  v.setBackgroundColor(CLEAR);
  v.setVisible(false);
  win.contentView.addChildView(v);
  menuView = v;
  menuQueued = null;
  const wc = v.webContents;
  let loaded = false;
  if (typeof wc.once === 'function') {
    wc.once('did-finish-load', () => {
      loaded = true;
      if (menuView === v && menuQueued) { wc.send(C.PUSH_MENU, menuQueued); menuQueued = null; }
    });
    wc.once('destroyed', () => { if (menuView === v) { menuView = null; menuOpen = false; } });
  } else {
    loaded = true;
  }
  v.__occlaraLoaded = () => loaded;
  wc.loadFile(path.join(__dirname, '../../renderer/menu/index.html'));
  registry.register('menu', v);
  return v;
}

function sendMenu(msg) {
  const v = menuView;
  if (!alive(v)) return;
  if (v.__occlaraLoaded && !v.__occlaraLoaded()) { menuQueued = msg; return; }
  v.webContents.send(C.PUSH_MENU, msg);
}

/** The menu over every page: re-adding a child view moves it to the top. */
function raiseMenu() {
  if (toastNow && alive(toastView) && win && !win.isDestroyed()) win.contentView.addChildView(toastView);
  if (menuOpen && alive(menuView) && win && !win.isDestroyed()) win.contentView.addChildView(menuView);
}

const num = (n) => (Number.isFinite(n) ? Math.round(n) : NaN);

/**
 * The shell opened its menu, or changed it while open: m.html is its rows'
 * markup and m.rect the rectangle the view should cover, in the window's
 * content, the menu and its shadow. Clamped to the window, never larger than
 * MENU_MAX either way. The view is told where in itself the menu sits.
 */
function openMenu(m) {
  if (!win || win.isDestroyed() || !m || typeof m.html !== 'string' || !m.rect) return false;
  const [w, h] = win.getContentSize();
  const r = { x: num(m.rect.x), y: num(m.rect.y), width: num(m.rect.width), height: num(m.rect.height) };
  if (![r.x, r.y, r.width, r.height].every(Number.isFinite) || r.width <= 0 || r.height <= 0) return false;
  const x = Math.max(0, Math.min(r.x, w - 1));
  const y = Math.max(0, Math.min(r.y, h - 1));
  const bounds = { x, y, width: Math.min(MENU_MAX, r.width - (x - r.x), w - x), height: Math.min(MENU_MAX, r.height - (y - r.y), h - y) };
  if (bounds.width <= 0 || bounds.height <= 0) return false;
  const v = ensureMenu();
  if (!v) return false;
  const fresh = !menuOpen;
  v.setBounds(bounds);
  // Where the menu sits in the view, moved by whatever the window's edge cut.
  const inset = { left: (num(m.inset && m.inset.left) || 0) - (x - r.x), top: (num(m.inset && m.inset.top) || 0) - (y - r.y) };
  const box = { width: num(m.box && m.box.width) || 0, height: num(m.box && m.box.height) || 0 };
  sendMenu({ html: m.html, left: inset.left, top: inset.top, width: box.width, height: box.height,
    focus: ['first', 'last', 'menu'].includes(m.focus) ? m.focus : null, fresh });
  menuOpen = true;
  raiseMenu();
  if (fresh || !v.getVisible()) v.setVisible(true);
  // The keyboard goes with it: arrows, Escape and Tab are the view's.
  if (fresh || m.focus) v.webContents.focus();
  return true;
}

/**
 * The menu shut. Its view hides and forgets what it drew, so the next opening
 * never shows the last one's rows for a frame. Unless the shell shut it
 * itself, the shell is told (PUSH_MENU_ACT): Escape and Tab hand the focus
 * back to the avatar, a press elsewhere leaves it where it went.
 * @param opts.fromShell  the shell shut it: nothing to tell it
 * @param opts.refocus    the focus goes back to the shell's avatar
 */
function closeMenu(opts) {
  const o = opts || {};
  if (!menuOpen) return;
  menuOpen = false;
  const v = menuView;
  let hadFocus = false;
  if (alive(v)) {
    hadFocus = typeof v.webContents.isFocused === 'function' && v.webContents.isFocused();
    v.setVisible(false);
    sendMenu({ html: '' });
  }
  const w = get();
  // A hidden view keeps the keyboard unless it is given away: back to the
  // shell when asked, or when the focus was still in the menu (Learn, the
  // Discord: nothing else took it).
  if (w && (o.refocus || hadFocus)) w.webContents.focus();
  if (!o.fromShell) registry.sendTo('main', C.PUSH_MENU_ACT, { closed: true, refocus: !!o.refocus });
}

/** SHELL_WINDOW 'drawer-close' still shuts the menu; 'drawer-open' is SHELL_MENU's now. */
function setDrawer(open) {
  if (!open) closeMenu({ fromShell: true });
}

/** Whether the menu is open and where its view is, for the checks and the pictures. */
function menuState() {
  const v = alive(menuView) ? menuView : null;
  return { open: menuOpen && !!v && v.getVisible(), view: v, bounds: v ? v.getBounds() : null };
}


// ── The games toast (8.9.1), over the page ────────────────────────────────

/**
 * Where the reveal's view sits: the whole window (8.10.4). It draws a flat
 * scrim over every page and the bar and centres the gift or the plan on it,
 * so it covers everything and takes the keyboard (Esc, Enter) while it is up.
 */
function toastBounds(w, h) {
  return { x: 0, y: 0, width: Math.max(0, w), height: Math.max(0, h) };
}

/** The toast's view, made on the first toast and kept, hidden, between them. */
function ensureToast() {
  if (alive(toastView)) return toastView;
  if (!win || win.isDestroyed()) return null;
  const v = new WebContentsView({
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      preload: path.join(__dirname, '../../preload/toast-preload.js'),
    },
  });
  // See-through: only the card and its shadow paint.
  v.setBackgroundColor(CLEAR);
  v.setVisible(false);
  win.contentView.addChildView(v);
  toastView = v;
  toastSent = null;
  const wc = v.webContents;
  let loaded = false;
  if (typeof wc.once === 'function') {
    wc.once('did-finish-load', () => {
      loaded = true;
      if (toastView === v && toastSent) { wc.send(C.PUSH_TOAST, toastSent); toastSent = null; }
    });
    wc.once('destroyed', () => {
      if (toastView !== v) return;
      toastView = null;
      if (toastNow) toastQueue.unshift(toastNow);
      toastNow = null;
    });
  } else {
    loaded = true;
  }
  v.__occlaraLoaded = () => loaded;
  wc.loadFile(path.join(__dirname, '../../renderer/toast/index.html'));
  registry.register('toast', v);
  const [w, h] = win.getContentSize();
  v.setBounds(toastBounds(w, h));
  return v;
}

function sendToast(msg) {
  const v = toastView;
  if (!alive(v)) return;
  if (v.__occlaraLoaded && !v.__occlaraLoaded()) { toastSent = msg; return; }
  v.webContents.send(C.PUSH_TOAST, msg);
}

/** Whether a toast may be on screen now: the window shown, not minimised, and not sealed. */
function toastMayShow() {
  const w = get();
  return !!(w && w.isVisible() && !w.isMinimized() && !nav.state().sealed);
}

/** The next toast, when none is on screen and one may be. */
function pumpToast() {
  if (toastNow || !toastQueue.length || !toastMayShow()) return false;
  const v = ensureToast();
  if (!v) return false;
  toastNow = toastQueue.shift();
  sendToast({ toast: toastNow });
  win.contentView.addChildView(v);
  raiseMenu();
  v.setVisible(true);
  // The reveal takes the keyboard so Esc and Enter close it; a test window
  // with no real contents has nothing to focus.
  try { if (v.webContents && typeof v.webContents.focus === 'function') v.webContents.focus(); } catch { /* not focusable */ }
  return true;
}

/** The toast on screen goes at once and waits at the front for the next time (sealed, hidden). */
function withdrawToast() {
  const v = toastView;
  if (alive(v) && v.getVisible()) v.setVisible(false);
  if (!toastNow) return;
  toastQueue.unshift(toastNow);
  toastNow = null;
  sendToast({ clear: true });
}

/** The toast on screen is over: the next comes, or the view hides. */
function toastDone(id) {
  if (!toastNow || (id && toastNow.id !== id)) return;
  toastNow = null;
  if (!pumpToast()) {
    const v = toastView;
    if (alive(v)) v.setVisible(false);
    // The keyboard goes back to the window's own page.
    try { if (win && !win.isDestroyed() && win.webContents && typeof win.webContents.focus === 'function') win.webContents.focus(); } catch { /* gone */ }
  }
}

/**
 * A toast for the queue: { id, kind, pre, n, post, line }, the finished words
 * of games-toast.js words(). Shown at once when it may be, else it waits.
 */
function toast(t) {
  if (!t || typeof t !== 'object' || typeof t.line !== 'string') return false;
  const clip = (v, n) => (typeof v === 'string' ? v.slice(0, n) : '');
  const one = {
    id: clip(String(t.id || `t${Date.now().toString(36)}`), 40),
    kind: clip(t.kind, 16),
    pre: clip(t.pre, 60),
    n: Number.isFinite(t.n) && t.n > 0 ? Math.min(9999, Math.round(t.n)) : null,
    post: clip(t.post, 30),
    line: clip(t.line, 120),
    // The centred reveal (8.10.4): its picture, its counted number, what it
    // counts, its one line and a plan's tier (the ring's colour).
    look: t.look === 'plan' ? 'plan' : 'gift',
    big: Number.isFinite(t.big) && t.big > 0 ? Math.min(9999, Math.round(t.big)) : (Number.isFinite(t.n) && t.n > 0 ? Math.min(9999, Math.round(t.n)) : null),
    unit: clip(t.unit, 30),
    rline: clip(typeof t.rline === 'string' && t.rline ? t.rline : t.line, 120),
    tier: t.tier === 'max' ? 'max' : t.tier === 'pro' ? 'pro' : '',
  };
  if (toastQueue.some((q) => q.id === one.id) || (toastNow && toastNow.id === one.id)) return false;
  toastQueue.push(one);
  if (toastQueue.length > TOAST_MAX) toastQueue = toastQueue.slice(-TOAST_MAX);
  pumpToast();
  return true;
}

/** fn() runs when a toast is clicked: index.js opens Profile, the seal's way. */
function onToastClick(fn) { onToastOpen = typeof fn === 'function' ? fn : null; }

/** The toast on screen, the ones waiting and its view, for the checks and the pictures. */
function toastState() {
  const v = alive(toastView) ? toastView : null;
  return { shown: !!(toastNow && v && v.getVisible()), now: toastNow, queued: toastQueue.map((t) => t.id), view: v, bounds: v ? v.getBounds() : null };
}

if (ipcMain && typeof ipcMain.on === 'function') {
  // From the toast's view alone: one done (its time up, its X), or clicked.
  ipcMain.on(C.TOAST_ACT, (e, m) => {
    if (!alive(toastView) || !e || e.sender !== toastView.webContents || !m) return;
    const id = typeof m.done === 'string' ? m.done : typeof m.open === 'string' ? m.open : '';
    if (!id || !toastNow || toastNow.id !== id) return;
    const opening = typeof m.open === 'string';
    toastDone(id);
    if (opening && onToastOpen && !nav.state().sealed) {
      try { onToastOpen(); } catch (err) { console.warn('[main-window] toast open:', err.message); }
    }
  });
  // From the shell alone: open, change or shut its menu.
  ipcMain.on(C.SHELL_MENU, (e, m) => {
    const w = get();
    if (!w || !e || e.sender !== w.webContents) return;
    try {
      if (m && m.open) { if (!openMenu(m)) closeMenu(); }
      else closeMenu({ fromShell: true });
    } catch (err) { console.warn('[main-window] menu:', err.message); }
  });
  // From the menu's view alone: a row chosen, or the menu shut from inside.
  ipcMain.on(C.MENU_ACT, (e, m) => {
    if (!alive(menuView) || !e || e.sender !== menuView.webContents || !m) return;
    if (typeof m.choose === 'string' && /^[a-z][a-z-]{0,31}$/.test(m.choose)) {
      if (menuOpen) registry.sendTo('main', C.PUSH_MENU_ACT, { choose: m.choose });
    } else if (m.close) {
      closeMenu({ refocus: !!m.refocus });
    }
  });
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
  protect(!!on);
  shutMenuForSeal(!!on);
  if (nav.state().sealed === !!on && held === h) return;
  held = h;
  nav.seal(!!on);
  // Sealed, the toast goes in this tick, with the pages; lifted, the ones
  // that waited come.
  if (on) withdrawToast();
  apply();
  if (!on) pumpToast();
}

/**
 * THE MENU SHUTS AS THE SEAL COMES ON. The account menu's view lies over every
 * page, the Recording screen too, and nothing shut it when a match started:
 * left open, it stayed over the sealed window. Shut here, before the shell
 * repaints, and the shell is told (PUSH_MENU_ACT closed), so its own #drawer
 * shuts with it. The focus is not handed back: the seal decides what shows.
 */
function shutMenuForSeal(on) {
  if (on && menuOpen) closeMenu();
}

/**
 * OUT OF THE RECORDING WHILE SEALED (8.3). A match is recorded off the screen
 * as it is shown, and the window it is sealed behind would be in the video
 * wherever it stood over the game. Content protection takes a window out of
 * every capture on Windows 10 2004 and later (the stream's and GDI's alike),
 * as the corner mark has been since 8.2. Only while sealed: a review open
 * between matches is the player's to screenshot or stream.
 */
function protect(on) {
  const w = get();
  if (!w || w.__occlaraProtected === on) return;
  w.setContentProtection(on);
  w.__occlaraProtected = on;
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

/** Out of sight, as Ctrl+Shift+M puts it: the tray and the shortcut bring it back. */
function hide() { const w = get(); if (w && w.isVisible()) w.hide(); }

/**
 * Closed, as Alt+F4 and the taskbar's Close close it: the top strip's X. The
 * window's 'close' is what decides (onCloseAsk), so the three are one path.
 */
function close() { const w = get(); if (w) w.close(); }

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

/** fn() runs, synchronously, when Windows ends its session (shutdown, restart, logoff). */
function onSessionEnd(fn) { onEnd = typeof fn === 'function' ? fn : null; }

/**
 * fn() runs on the turn after the window is asked to close (its X, Alt+F4,
 * the taskbar's Close) while no quit is under way, the close held: index.js
 * quits, asking first when that would lose something. With none set, a close
 * quits.
 */
function onCloseAsk(fn) { onClose = typeof fn === 'function' ? fn : null; }

/** The page views by id, for the boot checks. */
function pageViews() { return new Map(views); }

/** The page on screen and the one on its way, which is staged and which are loading again, for the checks. */
function motionState() { return { ...motion.state(), staged, reloading: [...reloading] }; }

module.exports = {
  create, get, reveal, show, setSealed, current, shellState, minimize, hide, close, toggleMaximize, isHidden, toggleHidden,
  onWindowChange, onSessionEnd, onCloseAsk, pageReady, pageViews, motionState, SIDEBAR_W, TOP_H, setDrawer, menuState, STAGE_PX,
  toast, toastState, onToastClick,
};
