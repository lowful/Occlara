'use strict';

const C = require('../shared/channels');

/**
 * Moving between pages (8.2): the two calls every page of the main window
 * needs, in one place so the six page preloads cannot drift apart.
 * src/renderer/shared/embed.js uses them: it hears what main-window.js asks
 * of the page (arm, enter, leave) and says when its armed frame is painted.
 *
 * Handed the preload's own ipcRenderer rather than requiring electron itself,
 * so the boot checks and the fake DOM's stand in reach it the same way.
 *
 *   contextBridge.exposeInMainWorld('occlara', { ...pageMotion(ipcRenderer), ... })
 */
function pageMotion(ipcRenderer) {
  return {
    /** (msg) => {} on every PUSH_PAGE: { phase: 'arm' | 'enter' | 'leave', dir }. */
    onPage(cb) {
      const h = (_e, msg) => cb(msg);
      ipcRenderer.on(C.PUSH_PAGE, h);
      return () => ipcRenderer.removeListener(C.PUSH_PAGE, h);
    },
    /** This page, by its id, has painted itself armed. */
    pageReady(id) { ipcRenderer.send(C.PAGE_READY, String(id || '')); },
  };
}

module.exports = { pageMotion };
