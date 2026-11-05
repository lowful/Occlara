'use strict';

const { contextBridge, ipcRenderer } = require('electron');
const C = require('../shared/channels');
const changelog = require('../shared/changelog');
const { pageMotion } = require('./page-motion');

/**
 * Bridge for the What's new page (src/renderer/whatsnew/): the changelog the
 * app ships with (src/shared/changelog.generated.json, synced from
 * changelog/changelog.json, never hand edited), handed over at once, and
 * main's background refresh of it from GET /api/changelog (CHANGELOG_REFRESH,
 * 4 s, null on any failure, checked by changelog.js before it arrives). The
 * page counts nothing and names no URL.
 */
// The version running, the app's own (package.json ships with it), for the
// page's Your version mark.
let VERSION = '';
try { VERSION = String(require('../../package.json').version || ''); } catch { VERSION = ''; }
let BUNDLED = [];
try { BUNDLED = changelog.clean(require('../shared/changelog.generated.json')) || []; } catch { BUNDLED = []; }

contextBridge.exposeInMainWorld('occlara', {
  // Moving between pages (shared/embed.js).
  ...pageMotion(ipcRenderer),
  /** The entries bundled with this build, newest first, at once. */
  bundled: () => BUNDLED,
  /** The server's entries, checked, or null. */
  refresh: () => ipcRenderer.invoke(C.CHANGELOG_REFRESH),
  /** The version running, x.y.z. */
  version: () => VERSION,
  kindWord: (kind) => changelog.kindWord(kind),
  dayOf: (date) => changelog.dayOf(date),
  go: (page) => ipcRenderer.send(C.SHELL_NAV, page),
});
