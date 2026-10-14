'use strict';

const { Tray, Menu, nativeImage, app } = require('electron');
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
 */
let tray = null;

function create(actions) {
  try {
    const iconPath = path.join(__dirname, '../../assets/icon.png');
    const icon = fs.existsSync(iconPath)
      ? nativeImage.createFromPath(iconPath).resize({ width: 16, height: 16 })
      : nativeImage.createEmpty();

    tray = new Tray(icon);
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
  if (tray) { tray.destroy(); tray = null; }
}

module.exports = { create, update, destroy };
