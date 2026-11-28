'use strict';

const C = require('../shared/channels');
const { stillSync } = require('./still');

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
 *
 * Since 9.1 every page also gets, from here and nowhere else:
 *   - THE HISTORY (the owner's item 7): `history` on its bridge (historyApi
 *     below), and its mouse's side buttons going back and forward
 *     (mouseHistory below);
 *   - STILL WHILE RECORDING (item 9): html.rec-still while a match is
 *     recorded (still.js).
 */
function pageMotion(ipcRenderer) {
  mouseHistory(ipcRenderer);
  stillSync(ipcRenderer);
  return {
    /** (msg) => {} on every PUSH_PAGE: { phase: 'arm' | 'enter' | 'leave', dir }. */
    onPage(cb) {
      const h = (_e, msg) => cb(msg);
      ipcRenderer.on(C.PUSH_PAGE, h);
      return () => ipcRenderer.removeListener(C.PUSH_PAGE, h);
    },
    /** This page, by its id, has painted itself armed. */
    pageReady(id) { ipcRenderer.send(C.PAGE_READY, String(id || '')); },
    history: historyApi(ipcRenderer),
  };
}

/**
 * THE HISTORY a page can use (9.1, index.js navHistory): every call answers
 * the state after it, { back, forward, backTo, forwardTo, backLabel,
 * forwardLabel, at, length } (backLabel is the page's name, "Matches").
 *   back({ fallback })  one step back; with nothing to go back to, the page
 *                       `fallback` names opens instead (the review's arrow
 *                       passes 'matches')
 *   forward()           one step forward
 *   state()             whether either way has a page left, and which
 *   onChange(cb)        cb(state) whenever that changes; returns the unsubscribe
 * Mid match nothing moves (the seal), and the answer says so.
 */
function historyApi(ipcRenderer) {
  return {
    back(opts) {
      const fallback = opts && typeof opts.fallback === 'string' ? opts.fallback : undefined;
      return ipcRenderer.invoke(C.HISTORY_GO, { dir: 'back', from: 'page', ...(fallback ? { fallback } : {}) });
    },
    forward() { return ipcRenderer.invoke(C.HISTORY_GO, { dir: 'forward', from: 'page' }); },
    state() { return ipcRenderer.invoke(C.HISTORY_GET); },
    onChange(cb) {
      if (typeof cb !== 'function') return () => {};
      const h = (_e, s) => cb(s);
      ipcRenderer.on(C.PUSH_HISTORY, h);
      return () => ipcRenderer.removeListener(C.PUSH_HISTORY, h);
    },
  };
}

/**
 * THE MOUSE'S SIDE BUTTONS in this document (9.1): button 3 is back, 4 is
 * forward, as a browser takes them. Their press is kept from the page (no
 * click, no selection) and their release asks main for the step. Windows
 * also sends the same press to the window as an app-command, which main
 * hears too and takes once (shell-nav.js createHistoryGate). Not while the
 * Trainer holds the pointer: its buttons are the game's then.
 */
function mouseHistory(ipcRenderer) {
  if (typeof window === 'undefined' || typeof window.addEventListener !== 'function' || !ipcRenderer) return false;
  if (window.__occlaraMouseHistory) return true;
  window.__occlaraMouseHistory = true;
  const on = (e) => {
    if (!e || (e.button !== 3 && e.button !== 4)) return;
    if (typeof document !== 'undefined' && document.pointerLockElement) return;
    if (typeof e.preventDefault === 'function') e.preventDefault();
    if (e.type !== 'mouseup') return;
    try {
      Promise.resolve(ipcRenderer.invoke(C.HISTORY_GO, { dir: e.button === 3 ? 'back' : 'forward', from: 'mouse' })).catch(() => {});
    } catch { /* a stand in with no invoke */ }
  };
  window.addEventListener('mousedown', on, true);
  window.addEventListener('mouseup', on, true);
  return true;
}

/**
 * THE SUB SWITCH (Orbit, 27 Nov 2026): a group's pages and their words
 * (shell-nav.js SUB), for shared/subnav.js at the head of each page of the
 * group. Matches' and Practice's pages expose it as `subnav`.
 */
function subnav(group) {
  const { SUB } = require('../shared/shell-nav');
  return (SUB[group] || []).map(([id, label]) => ({ id, label }));
}

module.exports = { pageMotion, subnav, historyApi, mouseHistory };
