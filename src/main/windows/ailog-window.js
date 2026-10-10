'use strict';

const { BrowserWindow } = require('electron');
const path = require('path');
const C = require('../../shared/channels.js');
const registry = require('./registry');

/**
 * AI decision-log viewer: scrub through the frames the coach read this session,
 * each paired with the STATE it parsed and the tip it gave, to see what went
 * wrong. Larger than the other popups because it shows a screenshot.
 */
/**
 * Opened at what the caller names (below), or at the newest session.
 *
 * Carried in the URL hash rather than pushed over IPC after load, because the
 * window may not exist yet and a message sent to a renderer that has not
 * finished loading is simply lost. The hash is there before the first line of
 * the renderer runs.
 */
/**
 * @param target a session folder name, OR the literal 'deaths' to open in
 *   death-review mode on the newest session, OR { scope } from the eye on a
 *   review (8.2): one match of one session, { session, match, from, to } as
 *   main found it, or { gone: true } when no kept session holds it. A scope
 *   rides in the hash as JSON, told apart from a folder name by its brace.
 *   With `at` beside it, from the eye on one death the coach looked at, the
 *   match opens on the frame captured then rather than on its first death.
 */
function open(target) {
  const existing = registry.get('ailog');
  if (existing) {
    // Already open: tell it to move, since the URL was read once at load. The
    // eye on a review is often pressed with the log minimised, so it comes
    // back up rather than taking focus where nobody can see it.
    if (target) existing.webContents.send(C.AILOG_SHOW, target);
    if (existing.isMinimized()) existing.restore();
    existing.focus();
    return existing;
  }

  const win = new BrowserWindow({
    width:  900,
    height: 640,
    frame:       false,
    resizable:   true,
    minWidth:    640,
    minHeight:   460,
    transparent: false,
    center:      true,
    backgroundColor: '#0b1119',
    show:        false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration:  false,
      sandbox:          false,
      preload: path.join(__dirname, '../../preload/ailog-preload.js'),
    },
  });

  win.loadFile(path.join(__dirname, '../../renderer/ailog/index.html'),
    target ? { hash: encodeURIComponent(typeof target === 'object' ? JSON.stringify(target) : String(target)) } : undefined);
  win.once('ready-to-show', () => win.show());

  registry.register('ailog', win);
  return win;
}

function get() { return registry.get('ailog'); }

module.exports = { open, get };
