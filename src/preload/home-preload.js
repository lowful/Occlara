'use strict';

const { contextBridge, ipcRenderer } = require('electron');
const C = require('../shared/channels');
const GAMES = require('../shared/games');
const { homeModel, rankModel, rrForRows, rrWaiting } = require('../shared/home-model');
const { pageMotion } = require('./page-motion');

/**
 * Bridge for Home, the main window's first page: the last match, the focus
 * for the next one, the most repeated mistake, the grade trend and the recent
 * matches, all read from the library, and Valorant's rank from the history
 * main keeps for Stats. The figures are put together by
 * src/shared/home-model.js, here in the preload, so the page only paints.
 * The only writes are window requests: a review, the AI log on the last
 * match's frames, a page.
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
  /**
   * The rank card and the RR of each rated match in the library, by id, from
   * the rank history main keeps for Stats (STATS_RANK_HISTORY, cached there).
   * Home asks once it is painted, so this never holds its first paint back.
   * `waiting` is the newest rated match when Riot has not put its game in the
   * history yet, so Home asks again later (home-model.js rrWaiting).
   * Valorant's alone, and null for any other game.
   */
  async getRank(game) {
    if (game !== 'valorant') return null;
    const [history, rows] = await Promise.all([
      ipcRenderer.invoke(C.STATS_RANK_HISTORY, false),
      ipcRenderer.invoke(C.REVIEWS_LIST, 'valorant'),
    ]);
    const rr = rrForRows(rows, history);
    return { card: rankModel(history), rr, waiting: rrWaiting(rows, rr, Date.now()) };
  },
  games:      () => GAMES.list(true).map((g) => ({ id: g.id, label: g.label })),
  openReview: (id) => ipcRenderer.send(C.REVIEW_OPEN, id),
  // The eye on the last match: the review's id only, and main finds its frames.
  openAiLog:  (id) => ipcRenderer.send(C.REVIEW_AILOG, id),
  go:         (page) => ipcRenderer.send(C.SHELL_NAV, page),
  // The rank card's Rank journey: Stats, with the journey open (8.4.1).
  openRankJourney: () => ipcRenderer.send(C.OPEN_STATS, 'journey'),
  onReviews:  (cb) => subscribe(C.PUSH_REVIEWS, cb),
  // A review still being built moved on a step, or is whole (8.4.1).
  onReviewWork: (cb) => subscribe(C.PUSH_REVIEW_WORK, cb),
  onGame:     (cb) => subscribe(C.PUSH_GAME, cb),
  onState:    (cb) => subscribe(C.PUSH_STATE, cb),
});
