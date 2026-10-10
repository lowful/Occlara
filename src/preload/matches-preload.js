'use strict';

const { contextBridge, ipcRenderer } = require('electron');
const C = require('../shared/channels');
const GAMES = require('../shared/games');
const { winLoss } = require('../shared/home-model');
const { pageMotion } = require('./page-motion');

/**
 * Bridge for the match library. Reads saved reviews, and the patterns and the
 * breakdown across them; the only writes are window requests (open a review,
 * or the AI log on its match) and asking main to grade the recent matches of
 * the Riot ID in Settings from Riot's record, which it then pushes as it
 * works. The record beside the title is counted here, by
 * src/shared/home-model.js, from the rows the page already has, so the page
 * only paints it.
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
  getState:     () => ipcRenderer.invoke(C.STATE_GET),
  getConfig:    () => ipcRenderer.invoke(C.CONFIG_GET),
  listReviews:  (game) => ipcRenderer.invoke(C.REVIEWS_LIST, game || null),
  /** { wins, losses, draws, unknown } in the rows listReviews returned. */
  winLoss:      (rows) => winLoss(rows),
  getPatterns:  (game) => ipcRenderer.invoke(C.PATTERNS_GET, game || null),
  getBreakdown: (game, opts) => ipcRenderer.invoke(C.BREAKDOWN_GET, game || null, opts || {}),
  startBackfill: () => ipcRenderer.invoke(C.BACKFILL_START),
  getBackfill:  () => ipcRenderer.invoke(C.BACKFILL_STATUS),
  onBackfill:   (cb) => subscribe(C.PUSH_BACKFILL, cb),
  openReview:   (id) => ipcRenderer.send(C.REVIEW_OPEN, id),
  // The eye on a row: the review's id only, and main finds its frames.
  openAiLog:    (id) => ipcRenderer.send(C.REVIEW_AILOG, id),
  openSettings: () => ipcRenderer.send(C.OPEN_SETTINGS),
  onReviews:    (cb) => subscribe(C.PUSH_REVIEWS, cb),
  onGame:       (cb) => subscribe(C.PUSH_GAME, cb),
  games:        () => GAMES.list(true).map((g) => ({ id: g.id, label: g.label })),
  close:        () => window.close(),
});
