'use strict';

const { app } = require('electron');
const { autoUpdater } = require('electron-updater');

/**
 * Auto-updates. Checks the public releases feed the moment the app opens and
 * every 6 hours after, downloads new versions silently in the background
 * (differential via the blockmap, so updates are small), and installs one
 * only when the player asks for it, or when they quit the app.
 *
 * Only runs in the packaged app; `npm start` dev sessions never check.
 * Every failure path is log-only: an update problem must never affect
 * coaching. electron-updater's flow is the one it always was (autoDownload,
 * autoInstallOnAppQuit, quitAndInstall, the feed's latest.yml): only the
 * question changed.
 *
 * THE UPDATER IN THE BAR (9.1, the owner's item 22). The restart question was
 * a native box that came up whenever the download landed. It is gone: the
 * bar's green control at its top right says it instead (shell.js
 * paintUpdate), a download arrow with the download's progress round it while
 * it downloads, then "Restart to update" once it is ready. Pressing that is
 * the one way this module ever calls quitAndInstall (install()); nothing here
 * restarts the app by itself. Quitting meanwhile installs it, as "Later" did.
 *
 * NEVER WHILE THE PLAYER IS PLAYING. The download lands whenever it lands, a
 * check every six hours, and its question came up over the game mid round, a
 * window nothing may put on the screen while a match is played, and in agent
 * select; "Restart now" then quit the recording, and the review still being
 * checked against Riot's record with it, whose clips are cut from that
 * recording as its look lands. So while `busy()` says a session is running, a
 * stop mid match holds the seal, a review is still being built or an import
 * runs, the control is not shown at all (view() is null) and install() is
 * refused. It is looked at again every second (WATCH_MS) while there is an
 * update to show, and pushed the moment that changes.
 */
// How often a held control checks whether the player has stopped playing.
const WATCH_MS = 1000;
// The newest version downloaded and ready to install, or null: a session can
// outlast a six hour check, so the control names what a restart installs.
let downloaded = null;
// The download under way: its whole percent, or null when electron-updater
// has said nothing of its progress yet (a differential download may not).
let percent = null;
// Pressed and on its way out: nothing more is offered.
let installing = false;
// Surfaced in Settings next to the version, so the player can see at a glance
// whether they are current instead of guessing whether an update landed.
let status = { state: 'idle', version: null, checkedAt: 0 };
let options = {};
let lastPushed = 'null';
let watch = null;

function getStatus() {
  return { ...status, percent: status.state === 'downloading' ? percent : null, current: app.getVersion(), packaged: app.isPackaged };
}

/** A version ready or on its way: what the bar shows, which a new check never takes away. */
function holdsBar() {
  return status.state === 'ready' || status.state === 'downloading';
}

/** Whether the player is playing now, by index.js's busy(); a throw is not busy. */
function playing() {
  try { return typeof options.busy === 'function' && !!options.busy(); } catch { return false; }
}

/**
 * What the bar may show, or null: nothing to show, or the player is playing.
 *   { state: 'downloading', version, percent: 0 to 100 | null }
 *   { state: 'ready', version }
 *   { state: 'installing', version }
 */
function view() {
  if (!app.isPackaged || playing()) return null;
  if (installing && downloaded) return { state: 'installing', version: downloaded.version };
  if (status.state === 'downloading') return { state: 'downloading', version: status.version || null, percent };
  if (downloaded) return { state: 'ready', version: downloaded.version };
  return null;
}

/** The bar told, only when what it may show changed. */
function emit() {
  const v = view();
  const key = JSON.stringify(v);
  if (key !== lastPushed) {
    lastPushed = key;
    try { if (typeof options.push === 'function') options.push(v); } catch (e) { console.error('[updater] push failed:', e.message); }
  }
  // Watched while there is something to show: a match starting hides it, its
  // end shows it again. Nothing to show, nothing watched.
  const something = status.state === 'downloading' || !!downloaded;
  if (something && !watch) {
    watch = setInterval(emit, options.watchMs || WATCH_MS);
    if (typeof watch.unref === 'function') watch.unref();
  } else if (!something && watch) {
    clearInterval(watch);
    watch = null;
  }
}

/**
 * The bar's "Restart to update", pressed. Installs only what is downloaded,
 * only while the player is not playing, once.
 * @returns {{ ok: true } | { ok: false, error: 'dev' | 'match' | 'not-ready' | 'installing' }}
 */
function install() {
  if (!app.isPackaged) return { ok: false, error: 'dev' };
  if (installing) return { ok: false, error: 'installing' };
  if (playing()) { emit(); return { ok: false, error: 'match' }; }
  if (!downloaded || status.state === 'downloading') return { ok: false, error: 'not-ready' };
  installing = true;
  emit();
  console.log('[updater] restart to update pressed:', downloaded.version);
  setImmediate(() => {
    try { autoUpdater.quitAndInstall(); } catch (e) {
      installing = false;
      console.error('[updater] install failed:', e.message);
      emit();
    }
  });
  return { ok: true };
}

function init(opts) {
  options = opts || {};
  if (!app.isPackaged) {
    status = { state: 'dev', version: null, checkedAt: Date.now() };
    return;
  }

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;   // quitting the app installs one that is ready
  autoUpdater.logger = console;

  autoUpdater.on('checking-for-update', () => {
    // A check while one is ready, or downloading, leaves the bar as it is:
    // 'checking' is no state the bar draws, so a check mid download (the six
    // hour timer, Settings' Check for updates) took the ring away.
    if (!holdsBar()) status = { ...status, state: 'checking' };
  });

  autoUpdater.on('update-not-available', () => {
    status = downloaded ? { state: 'ready', version: downloaded.version, checkedAt: Date.now() }
      : { state: 'current', version: null, checkedAt: Date.now() };
    emit();
  });

  autoUpdater.on('update-available', (info) => {
    const version = info && info.version;
    // The six hour check finding the version already downloaded: it is ready
    // still, and the bar does not go back to downloading for it.
    if (downloaded && version === downloaded.version) {
      status = { state: 'ready', version, checkedAt: Date.now() };
      emit();
      return;
    }
    // A check mid download finding the version already on its way: the
    // download carries on, and so does its percent (not the unsure quarter
    // again until the next progress event).
    if (status.state === 'downloading' && version && version === status.version) {
      status = { ...status, checkedAt: Date.now() };
      emit();
      return;
    }
    // A newer one supersedes what was downloaded: it is the one a restart
    // installs once it lands.
    downloaded = null;
    percent = null;
    status = { state: 'downloading', version, checkedAt: Date.now() };
    console.log('[updater] update available:', version, '(downloading in background)');
    emit();
  });

  autoUpdater.on('download-progress', (p) => {
    const n = p && Number.isFinite(p.percent) ? Math.max(0, Math.min(100, Math.floor(p.percent))) : null;
    if (n === null || n === percent) return;
    percent = n;
    if (status.state !== 'downloading') status = { ...status, state: 'downloading' };
    emit();
  });

  autoUpdater.on('update-downloaded', (info) => {
    downloaded = info && info.version ? { version: info.version } : downloaded || { version: null };
    percent = null;
    status = { state: 'ready', version: downloaded.version, checkedAt: Date.now() };
    console.log('[updater] update downloaded:', info && info.version);
    emit();
  });

  autoUpdater.on('error', (err) => {
    // Offline, feed unreachable, rate limited: all fine, try again later. One
    // already downloaded is still ready; a download that failed shows nothing.
    percent = null;
    status = downloaded ? { state: 'ready', version: downloaded.version, checkedAt: Date.now() }
      : { ...status, state: 'offline', checkedAt: Date.now() };
    console.log('[updater] check failed (will retry):', err == null ? 'unknown' : err.message);
    emit();
  });

  const check = () => autoUpdater.checkForUpdates().catch(() => {});
  check();                                     // the moment the app opens
  setInterval(check, 6 * 60 * 60 * 1000);      // and every 6 hours
}

/** Settings "check now": forces a fresh look at the feed. */
function checkNow() {
  if (!app.isPackaged) return Promise.resolve(getStatus());
  if (!holdsBar()) status = { ...status, state: 'checking' };
  return autoUpdater.checkForUpdates().catch(() => {}).then(() => getStatus());
}

module.exports = { init, getStatus, checkNow, view, install };
