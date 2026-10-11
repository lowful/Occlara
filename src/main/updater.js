'use strict';

const { app, dialog } = require('electron');
const { autoUpdater } = require('electron-updater');

/**
 * Auto-updates. Checks the public releases feed the moment the app opens and
 * every 6 hours after, downloads new versions silently in the background
 * (differential via the blockmap, so updates are small), then prompts the
 * player from the app: restart now, or later, in which case the update
 * installs on next quit.
 *
 * Only runs in the packaged app; `npm start` dev sessions never check.
 * Every failure path is log-only: an update problem must never affect
 * coaching.
 *
 * NEVER WHILE THE PLAYER IS PLAYING. The download lands whenever it lands, a
 * check every six hours, and its question came up whenever it did: over the
 * game mid round, a window nothing may put on the screen while a match is
 * played, and in agent select. "Restart now" then quit the recording, and
 * the review still being checked against Riot's record with it, whose clips
 * are cut from that recording as its look lands. So while `busy()` says a
 * session is running, a stop mid match holds the seal, or a review is still
 * being built, the question waits, asked again every 30 seconds
 * (`retryMs`). Quitting meanwhile installs it as "Later" does.
 */
const ASK_AGAIN_MS = 30 * 1000;
let prompted = false;
// The newest version downloaded: a session can outlast a six hour check, so
// the question, asked once the player stops, names what a restart installs.
let latest = null;
// Surfaced in Settings next to the version, so the player can see at a glance
// whether they are current instead of guessing whether an update landed.
let status = { state: 'idle', version: null, checkedAt: 0 };

function getStatus() {
  return { ...status, current: app.getVersion(), packaged: app.isPackaged };
}

/** Whether the player is playing now, by index.js's busy(); a throw is not busy. */
function playing(opts) {
  try { return typeof opts.busy === 'function' && !!opts.busy(); } catch { return false; }
}

/** The question, once the player is not playing, about the newest download. */
async function ask(opts) {
  if (playing(opts)) {
    setTimeout(() => ask(opts), opts.retryMs || ASK_AGAIN_MS);
    return;
  }
  const info = latest || {};
  try {
    const { response } = await dialog.showMessageBox({
      type: 'info',
      title: 'Occlara update ready',
      message: `Occlara ${info.version} is ready to install.`,
      detail: 'Restart now to update, or keep playing and it installs when you close the app.',
      buttons: ['Restart now', 'Later'],
      defaultId: 0,
      cancelId: 1,
      noLink: true,
    });
    if (response === 0) {
      setImmediate(() => autoUpdater.quitAndInstall());
    }
  } catch (e) {
    console.error('[updater] prompt failed:', e.message);
  }
}

function init(options) {
  const opts = options || {};
  if (!app.isPackaged) {
    status = { state: 'dev', version: null, checkedAt: Date.now() };
    return;
  }

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;   // "Later" still applies it on quit
  autoUpdater.logger = console;

  autoUpdater.on('checking-for-update', () => { status = { ...status, state: 'checking' }; });

  autoUpdater.on('update-not-available', () => {
    status = { state: 'current', version: null, checkedAt: Date.now() };
  });

  autoUpdater.on('update-available', (info) => {
    status = { state: 'downloading', version: info.version, checkedAt: Date.now() };
    console.log('[updater] update available:', info.version, '(downloading in background)');
  });

  autoUpdater.on('update-downloaded', (info) => {
    status = { state: 'ready', version: info.version, checkedAt: Date.now() };
    latest = info || latest;
    console.log('[updater] update downloaded:', info && info.version);
    if (prompted) return;   // one question a run, waiting or answered
    prompted = true;
    ask(opts);
  });

  autoUpdater.on('error', (err) => {
    // Offline, feed unreachable, rate limited: all fine, try again later.
    status = { ...status, state: 'offline', checkedAt: Date.now() };
    console.log('[updater] check failed (will retry):', err == null ? 'unknown' : err.message);
  });

  const check = () => autoUpdater.checkForUpdates().catch(() => {});
  check();                                     // the moment the app opens
  setInterval(check, 6 * 60 * 60 * 1000);      // and every 6 hours
}

/** Settings "check now": forces a fresh look at the feed. */
function checkNow() {
  if (!app.isPackaged) return Promise.resolve(getStatus());
  status = { ...status, state: 'checking' };
  return autoUpdater.checkForUpdates().catch(() => {}).then(() => getStatus());
}

module.exports = { init, getStatus, checkNow };
