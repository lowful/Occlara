'use strict';

const { Tray, Menu, nativeImage, nativeTheme, app } = require('electron');
const path = require('path');
const fs   = require('fs');

/**
 * System tray. `actions` injects the handlers so the tray stays decoupled from
 * the coaching controller.
 *
 * THE ICON OPENS THE APP (8.4.1). It had a double click alone, and that
 * toggled the window: a single click did nothing at all, and a window behind
 * the game went out of sight on a double click. A click and a double click
 * now both bring the window up and to the front (actions.show); the context
 * menu, the right click, is as it was, its Show or Hide still a toggle.
 *
 * THE MOON FOLLOWS THE TASKBAR (8.6, the full moon since Nov 2026). The tray
 * draws the moon alone, no tile, in one flat colour on the 16 grid: in the ink
 * on a dark taskbar (tray-dark.ico) and in the ground on a light one
 * (tray-light.ico), each at the sizes Windows asks for at 100 to 300%
 * scaling, so no 16px copy is shrunk from a larger picture. While a match is
 * recorded it is the RECORD RING with the moon as its dot, the glyph of the
 * Start button (tray-rec-dark.ico, tray-rec-light.ico), so the tray says what
 * the button says. Windows changing its theme repaints it.
 */
let tray = null;
let recording = false;

/** The tray's picture for the taskbar's theme now and the recording state, or nothing if the file is missing. */
function trayImage(rec) {
  const dark = !!(nativeTheme && nativeTheme.shouldUseDarkColorsForSystemIntegratedUI);
  const name = `tray-${rec ? 'rec-' : ''}${dark ? 'dark' : 'light'}.ico`;
  const file = path.join(__dirname, '../../assets', name);
  return fs.existsSync(file) ? nativeImage.createFromPath(file) : nativeImage.createEmpty();
}

function onTheme() {
  if (tray) tray.setImage(trayImage(recording));
}

function create(actions) {
  try {
    tray = new Tray(trayImage(recording));
    if (nativeTheme) nativeTheme.on('updated', onTheme);
    tray.setToolTip('Occlara');
    update(false, actions);
    // A double click is a click first, so the window is asked up twice, and
    // asking it up again changes nothing.
    tray.on('click', () => actions.show());
    tray.on('double-click', () => actions.show());
  } catch (err) {
    console.warn('[tray] Could not create tray:', err.message);
  }
  return tray;
}

function update(isCoaching, actions) {
  if (!tray) return;
  // The record ring while recording, the moon alone otherwise: set only on a change.
  if (!!isCoaching !== recording) {
    recording = !!isCoaching;
    try { tray.setImage(trayImage(recording)); } catch (e) { /* the tray keeps its last picture */ }
  }
  const hidden = actions.isMinimized && actions.isMinimized();
  const menu = Menu.buildFromTemplate([
    { label: isCoaching ? 'Stop Recording' : 'Start Recording',
      click: () => (isCoaching ? actions.stop() : actions.start()) },
    { label: hidden ? 'Show Occlara' : 'Hide Occlara', click: () => actions.toggleMinimize() },
    { label: 'Last Review…',        click: () => actions.openReview() },
    { label: 'Matches…',            click: () => actions.openHistory() },
    { label: 'Weekly Report…',      click: () => actions.openWeekly() },
    { label: 'AI Log…',             click: () => actions.openAiLog() },
    { label: 'Settings…',           click: () => actions.openSettings() },
    { type: 'separator' },
    { label: 'Quit Occlara',        click: () => actions.quit() },
  ]);
  tray.setContextMenu(menu);
  tray.setToolTip(isCoaching ? 'Occlara, recording' : 'Occlara');
}

function destroy() {
  if (nativeTheme) nativeTheme.removeListener('updated', onTheme);
  if (tray) { tray.destroy(); tray = null; }
  recording = false;
}

module.exports = { create, update, destroy, trayImage };
