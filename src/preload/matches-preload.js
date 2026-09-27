'use strict';

const { contextBridge, ipcRenderer } = require('electron');
const C = require('../shared/channels');
const GAMES = require('../shared/games');

/**
 * Bridge for the match library. Reads saved reviews and the patterns across
 * them; the only writes are window requests (open a review, ask about one).
 */
function subscribe(channel, cb) {
  if (!C.PUSH_LIST.includes(channel)) return () => {};
  const h = (_e, payload) => cb(payload);
  ipcRenderer.on(channel, h);
  return () => ipcRenderer.removeListener(channel, h);
}

contextBridge.exposeInMainWorld('occlara', {
  getState:     () => ipcRenderer.invoke(C.STATE_GET),
  getConfig:    () => ipcRenderer.invoke(C.CONFIG_GET),
  listReviews:  (game) => ipcRenderer.invoke(C.REVIEWS_LIST, game || null),
  getPatterns:  (game) => ipcRenderer.invoke(C.PATTERNS_GET, game || null),
  openReview:   (id) => ipcRenderer.send(C.REVIEW_OPEN, id),
  askAbout:     (id) => ipcRenderer.send(C.OPEN_CHAT_SEEDED, { reviewId: id }),
  openSettings: () => ipcRenderer.send(C.OPEN_SETTINGS),
  onReviews:    (cb) => subscribe(C.PUSH_REVIEWS, cb),
  onGame:       (cb) => subscribe(C.PUSH_GAME, cb),
  games:        () => GAMES.list(true).map((g) => ({ id: g.id, label: g.label })),
  close:        () => window.close(),
});
