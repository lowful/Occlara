'use strict';

const { contextBridge, ipcRenderer } = require('electron');
const C = require('../shared/channels');
const GAMES = require('../shared/games');
const { homeModel, rankModel, rrForRows, rrWaiting } = require('../shared/home-model');
const { iconOf, mapArtOf } = require('../shared/agent-icons');
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

/** A path under assets/ as the page loads it, or null. */
const asset = (rel) => (rel ? `../../../assets/${rel}` : null);

/*
 * PROGRESS V3, THE ART: the last match's map behind its card and the agent's
 * portrait in it, and each recent row's agent, from the bundled files
 * (sync:mapart, sync:agenticons), and only a name the generated data knows
 * gets one (agent-icons.js). Valorant's alone.
 */
function artOf(game, model) {
  if (game !== 'valorant' || !model) return { last: null, rows: {} };
  const last = model.last ? { agent: asset(iconOf('valorant', model.last.title)), map: asset(mapArtOf(model.last.map)) } : null;
  const rows = {};
  for (const r of model.recent || []) rows[r.id] = { agent: asset(iconOf('valorant', r.title)), map: asset(mapArtOf(r.map)) };
  return { last, rows };
}

/*
 * THE FIX CARD'S PICTURE: the first death the coach looked at in the newest
 * whole review that left something to see, its kept clip's poster (the
 * still nearest the death from before it, as the review's player shows it,
 * review.js posterOf) and whether the clip itself is still on disk. Null
 * when no look kept a clip or a still: the card then falls back to the map.
 */
function fixClipOf(review) {
  if (!review || !Array.isArray(review.rounds)) return null;
  const frames = review.frameData && typeof review.frameData === 'object' ? review.frameData : {};
  for (const c of review.rounds) {
    const f = c && c.forensics;
    if (!f || !Number.isInteger(c.n)) continue;
    const names = Array.isArray(f.frames) ? f.frames : [];
    const at = Array.isArray(f.frameAt) && f.frameAt.length === names.length ? f.frameAt : null;
    const shots = names.map((name, i) => ({ src: frames[name], at: at ? at[i] : null })).filter((x) => typeof x.src === 'string' && x.src.startsWith('data:image/'));
    const before = shots.filter((x) => typeof x.at === 'number' && x.at < 0);
    const poster = (before.length ? before[before.length - 1] : shots[0] || {}).src || null;
    const clip = typeof f.clipUrl === 'string' && !!f.clipUrl;
    if (!poster && !clip) continue;
    return { round: c.n, place: typeof c.spot === 'string' && c.spot ? c.spot : null, poster, clip, gone: !clip && !!f.clipGone };
  }
  return null;
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
    // While the newest is still being written (its row carries work), the
    // one before it lends its fix (home-model.js focusPrevious).
    const writing = !!(list[0] && list[0].work) && !(review && typeof review.focus === 'string' && review.focus.trim());
    const before = writing && list[1] ? await ipcRenderer.invoke(C.REVIEW_GET, list[1].id).catch(() => null) : null;
    const model = homeModel({ rows: list, patterns, review, previous: before });
    return { ...model, art: artOf(game, model), fix: fixClipOf(review) };
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
  // A review, at one of its rounds when given (the Fix card's clip, as Moments opens one).
  openReview: (id, round) => (Number.isInteger(round) && round > 0 ? ipcRenderer.send(C.REVIEW_OPEN, id, round) : ipcRenderer.send(C.REVIEW_OPEN, id)),
  // The Start strip (Progress v3): the same Start as the sidebar's.
  startCoaching: () => ipcRenderer.send(C.COACH_START),
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
  // Games left (8.7): one quiet line, written by main (usage.js gamesLeft),
  // '' when there is nothing to say.
  getAccount: () => ipcRenderer.invoke(C.ACCOUNT_GET),
  onAccount:  (cb) => subscribe(C.ACCOUNT_CHANGED, cb),
  openUpgrade: () => ipcRenderer.send(C.OPEN_UPGRADE),
  // The update line (the changelog): main's { version, text, link } or null,
  // never mid match or sealed; seen once it is on screen; What's new opens it.
  getNews:      () => ipcRenderer.invoke(C.CHANGELOG_NOTICE),
  onNews:       (cb) => subscribe(C.PUSH_CHANGELOG, cb),
  newsSeen:     (version) => ipcRenderer.send(C.CHANGELOG_SEEN, String(version || '')),
  openWhatsNew: () => ipcRenderer.send(C.SHELL_NAV, 'whatsnew'),
});
