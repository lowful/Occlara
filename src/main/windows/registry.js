'use strict';

/**
 * Central registry of live BrowserWindows + a single broadcast helper so engine
 * events fan out to every surface without per-call window lookups.
 * Window modules register/unregister themselves on create/closed.
 *
 * Since 8.1 it also holds the main window's PAGE VIEWS (main-window.js): a
 * WebContentsView has webContents like a window does, so a push reaches the
 * library, the review and Settings by the same names it always used, whether
 * they live in a window or a view. A view has no 'closed' event; it is
 * forgotten when its contents are destroyed.
 */
const windows = new Map(); // name → BrowserWindow or WebContentsView

function isDead(target) {
  if (!target) return true;
  if (typeof target.isDestroyed === 'function') return target.isDestroyed();
  return !target.webContents || target.webContents.isDestroyed();
}

function register(name, target) {
  windows.set(name, target);
  forwardConsole(name, target);
  const forget = () => { if (windows.get(name) === target) windows.delete(name); };
  if (typeof target.isDestroyed === 'function' && typeof target.on === 'function') target.on('closed', forget);
  else target.webContents.on('destroyed', forget);
}

/**
 * Tee every renderer's console into the main-process log (→ debug.log). This is
 * how a broken preload/bridge surfaces instead of failing silently, the exact
 * class of bug that killed the old client. Handles both the legacy positional
 * and the newer details-object 'console-message' signatures.
 */
function forwardConsole(name, win) {
  win.webContents.on('console-message', (...args) => {
    let level, message, sourceId, line;
    if (args.length >= 2 && args[1] && typeof args[1] === 'object' && 'message' in args[1]) {
      ({ level, message, sourceId, lineNumber: line } = args[1]);
    } else {
      [, level, message, line, sourceId] = args;
    }
    const src = String(sourceId || '').split(/[\\/]/).pop();
    const text = `[renderer:${name}] ${message}${src ? ` (${src}:${line})` : ''}`;
    if (String(level).toLowerCase() === 'error' || level === 3) console.error(text);
    else console.log(text);
  });
}

function get(name) {
  const w = windows.get(name);
  return w && !isDead(w) ? w : null;
}

/** Send to a single window or view if it exists. */
function sendTo(name, channel, data) {
  const w = get(name);
  if (w) w.webContents.send(channel, data);
}

/** Send to every live window and view (used for engine push events). */
function broadcast(channel, data) {
  for (const [, w] of windows) {
    if (w && !isDead(w)) w.webContents.send(channel, data);
  }
}

module.exports = { register, get, sendTo, broadcast };
