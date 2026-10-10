'use strict';

/**
 * Finds a surface by its URL among every live webContents: the separate
 * windows (onboarding, the AI log, the weekly report) and, since 8.1, the
 * main window's page views, which BrowserWindow.getAllWindows() never lists.
 * Returns an object with the webContents the boot checks drive, or null.
 *
 * @param part  a piece of the URL, '/review/' or 'section=breakdown'
 */
function find(part) {
  const { webContents } = require('electron');
  const all = webContents.getAllWebContents()
    .filter((wc) => !wc.isDestroyed() && (wc.getURL() || '').includes(part));
  return all[0] ? { webContents: all[0] } : null;
}

module.exports = { find };
