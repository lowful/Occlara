'use strict';

const { contextBridge, ipcRenderer } = require('electron');
const C = require('../shared/channels');
const GAMES = require('../shared/games');
const { pageMotion } = require('./page-motion');

/**
 * Bridge for the Practice page (src/renderer/practice/): the plan from the
 * player's own repeated mistakes, its drills, the log and whether it is
 * working, every line of it written by main (src/shared/practice.js
 * planView). The page only paints. Its writes are a drill marked practised
 * and an entry taken out of the log, both kept on this PC, and both refused
 * mid match by main.
 */
function subscribe(channel, cb) {
  if (!C.PUSH_LIST.includes(channel)) return () => {};
  const h = (_e, payload) => cb(payload);
  ipcRenderer.on(channel, h);
  return () => ipcRenderer.removeListener(channel, h);
}

contextBridge.exposeInMainWorld('occlara', {
  // Moving between pages (shared/embed.js).
  ...pageMotion(ipcRenderer),
  getState:    () => ipcRenderer.invoke(C.STATE_GET),
  /** The page for one game, or null mid match; `asked` the mistake this visit opened on. */
  getPractice: (game, asked) => ipcRenderer.invoke(C.PRACTICE_GET, game || null,
    asked && typeof asked.key === 'string' ? { key: asked.key, title: typeof asked.title === 'string' ? asked.title : null } : null),
  /** A drill marked practised today: { ok } or { ok: false, error }. */
  mark:        (id) => ipcRenderer.invoke(C.PRACTICE_MARK, String(id || '')),
  /** An entry taken out of the log. */
  remove:      (id) => ipcRenderer.invoke(C.PRACTICE_REMOVE, String(id || '')),
  onPractice:  (cb) => subscribe(C.PUSH_PRACTICE, cb),
  onReviews:   (cb) => subscribe(C.PUSH_REVIEWS, cb),
  onGame:      (cb) => subscribe(C.PUSH_GAME, cb),
  games:       () => GAMES.list(true).map((g) => ({ id: g.id, label: g.label })),
  go:          (page) => ipcRenderer.send(C.SHELL_NAV, page),
  close:       () => window.close(),
});
