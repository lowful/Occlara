'use strict';

/**
 * The version a window check's app runs under, the same on every platform.
 *
 * A check boots Electron on a bare script, so Electron reports the version of
 * its own executable: its release (41.3.0) on Windows and macOS, and "0.0" on
 * Linux, where CI runs. electron-updater refuses "0.0" the moment
 * src/main/updater.js loads, so on Linux the app stopped at index.js's require
 * of it, before a single handler was registered, and the checks failed on
 * that. Linux is given what the other two report.
 *
 * Require it in the Electron half of a check, before anything from src/main.
 */
const { app } = require('electron');

if (process.platform === 'linux') app.setVersion(process.versions.electron);
