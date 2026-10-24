'use strict';

const { BrowserWindow } = require('electron');
const path = require('path');
const registry = require('./registry');

/**
 * Tiny, fully click-through badge, the crescent mark, shown where the panel was docked when
 * the user minimizes. It CANNOT be clicked (setIgnoreMouseEvents) so it never
 * catches the cursor mid-aim, restore is via hotkey (Ctrl+Shift+M) or tray.
 *
 * NEVER DURING A MATCH (8.3.2). It is always on top at the top right of the
 * screen, over Valorant's kill feed, so index.js shows it only while the main
 * window is out of sight AND the seal is off (placeMark, from the seal's own
 * test in syncSeal): a match in progress, or a stop mid match holding the
 * seal, takes it away, and the seal lifting brings it back.
 */
// Window is larger than the 26px crescent so its dark rim and soft shadow
// have transparent room and never clip at the window edge. Safe to oversize
// because the dock is fully click-through (setIgnoreMouseEvents below).
const SIZE = 84;

function ensure() {
  let win = registry.get('dock');
  if (win) return win;

  win = new BrowserWindow({
    width: SIZE, height: SIZE,
    transparent: true, frame: false, alwaysOnTop: true, skipTaskbar: true,
    resizable: false, movable: false, focusable: false, hasShadow: false, show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration:  false,
      sandbox:          false,
      preload: path.join(__dirname, '../../preload/dock-preload.js'),
    },
  });

  win.setIgnoreMouseEvents(true);            // fully click-through
  win.setAlwaysOnTop(true, 'screen-saver');
  // OUT OF EVERY CAPTURE, OURS INCLUDED. The mark sits top right, over
  // Valorant's kill feed, and Occlara's own GDI capture read it into every
  // frame taken while the main window was hidden, which is exactly when a
  // match is played. On Windows 10 2004 and later this takes the window out
  // of capture altogether rather than painting it black; older builds paint
  // it black, over the pixels the mark already covered.
  win.setContentProtection(true);
  win.loadFile(path.join(__dirname, '../../renderer/dock/index.html'));
  registry.register('dock', win);
  return win;
}

function showAt(anchor) {
  const win = ensure();
  if (anchor && Number.isFinite(anchor.x) && Number.isFinite(anchor.y)) {
    win.setPosition(Math.round(anchor.x), Math.round(anchor.y));
  }
  win.showInactive();
  win.setAlwaysOnTop(true, 'screen-saver');
}

function hide() {
  const win = registry.get('dock');
  if (win && win.isVisible()) win.hide();
}

/** Whether the mark is on screen. */
function isShown() {
  const win = registry.get('dock');
  return !!(win && win.isVisible());
}

module.exports = { showAt, hide, isShown, SIZE };
