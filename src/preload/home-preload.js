'use strict';

const { contextBridge, ipcRenderer } = require('electron');
const C = require('../shared/channels');
const GAMES = require('../shared/games');
const { homeModel } = require('../shared/home-model');

/**
 * Bridge for Home, the main window's first page: the last match, the focus
 * for the next one, the most repeated mistake, the grade trend and the recent
 * matches, all read from the library. The figures are put together by
 * src/shared/home-model.js, here in the preload, so the page only paints.
 */
function subscribe(channel, cb) {
  if (!C.PUSH_LIST.includes(channel)) return () => {};
  const h = (_e, payload) => cb(payload);
  ipcRenderer.on(channel, h);
  return () => ipcRenderer.removeListener(channel, h);
}

contextBridge.exposeInMainWorld('occlara', {
  getState:   () => ipcRenderer.invoke(C.STATE_GET),
  getConfig:  () => ipcRenderer.invoke(C.CONFIG_GET),
  /** Everything Home shows for one game, from the library. */
  async getHome(game) {
    const [rows, patterns] = await Promise.all([
      ipcRenderer.invoke(C.REVIEWS_LIST, game || null),
      ipcRenderer.invoke(C.PATTERNS_GET, game || null),
    ]);
    const list = Array.isArray(rows) ? rows : [];
    // REVIEW_GET answers the review itself; the model checks it is the newest row's.
    const newest = list[0] ? await ipcRenderer.invoke(C.REVIEW_GET, list[0].id).catch(() => null) : null;
    const review = newest ? { ...newest, id: newest.id || list[0].id } : null;
    return homeModel({ rows: list, patterns, review });
  },
  games:      () => GAMES.list(true).map((g) => ({ id: g.id, label: g.label })),
  openReview: (id) => ipcRenderer.send(C.REVIEW_OPEN, id),
  go:         (page) => ipcRenderer.send(C.SHELL_NAV, page),
  onReviews:  (cb) => subscribe(C.PUSH_REVIEWS, cb),
  onGame:     (cb) => subscribe(C.PUSH_GAME, cb),
  onState:    (cb) => subscribe(C.PUSH_STATE, cb),
});
