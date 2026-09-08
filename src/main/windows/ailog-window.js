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
 * @param sessionId  open at this log session, or null for the newest.
 *
 * Carried in the URL hash rather than pushed over IPC after load, because the
 * window may not exist yet and a message sent to a renderer that has not
 * finished loading is simply lost. The hash is there before the first line of
 * the renderer runs.
 */
/**
 * @param sessionId a session folder name, OR the literal 'deaths' to open in
 *   death-review mode on the newest session. The match review card's eye button
 *   sends the latter, because the useful thing after a match is the deaths, not
 *   frame zero.
 */
function open(sessionId) {
  const existing = registry.get('ailog');
  if (existing) {
    // Already open: tell it to move, since the URL was read once at load.
    if (sessionId) existing.webContents.send(C.AILOG_SHOW, sessionId);
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
    sessionId ? { hash: encodeURIComponent(String(sessionId)) } : undefined);
  win.once('ready-to-show', () => win.show());

  registry.register('ailog', win);
  return win;
}

function get() { return registry.get('ailog'); }

module.exports = { open, get };
