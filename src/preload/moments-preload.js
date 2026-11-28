'use strict';

const { contextBridge, ipcRenderer } = require('electron');
const C = require('../shared/channels');
const GAMES = require('../shared/games');
const { pageMotion } = require('./page-motion');
const { mapArtOf } = require('../shared/agent-icons');

/**
 * Bridge for the Moments page (8.7, src/renderer/moments/): every death and
 * highlight of the saved reviews of one game, the clips kept of them, and the
 * compilation by repeated mistake, all counted by main (src/shared/moments.js).
 * The page only paints and plays. Its writes are window requests: a review
 * opened at one of its rounds. The seal is asked about before a clip plays
 * (SHELL_GET), so nothing plays mid match.
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
  getShell:    () => ipcRenderer.invoke(C.SHELL_GET),
  /** { game, matches: [{ id, at, title, map, result, score, grade, moments }], compilation, counts, clipsNote }. */
  getMoments:  (game) => ipcRenderer.invoke(C.MOMENTS_GET, game || null),
  /** The review, at one of its rounds. */
  openReview:  (id, round) => ipcRenderer.send(C.REVIEW_OPEN, id, Number.isInteger(round) && round > 0 ? round : null),
  // Settings, at its Clips row where asked (9.1, the Storage card): 'clips' or nothing.
  openSettings: (at) => ipcRenderer.send(C.OPEN_SETTINGS, at === 'clips' ? 'clips' : null),
  onReviews:   (cb) => subscribe(C.PUSH_REVIEWS, cb),
  onReviewWork: (cb) => subscribe(C.PUSH_REVIEW_WORK, cb),
  onGame:      (cb) => subscribe(C.PUSH_GAME, cb),
  games:       () => GAMES.list(true).map((g) => ({ id: g.id, label: g.label })),
  go:          (page) => ipcRenderer.send(C.SHELL_NAV, page),
  // The map's bundled splash (agent-icons.js), for a moment with no clip kept (Orbit's Clips page).
  mapArt:      (name) => { const r = mapArtOf(name); return r ? `../../../assets/${r}` : null; },
  // THE CLIPS' OWN ACTIONS AND STORAGE (9.1, the owner's items 12 and 18). Main
  // checks every id and name; a page never names a path.
  deleteClip:  (id, name) => ipcRenderer.invoke(C.CLIP_DELETE, typeof id === 'string' ? id : null, typeof name === 'string' ? name : null),
  revealClip:  (id, name) => ipcRenderer.invoke(C.CLIP_REVEAL, typeof id === 'string' ? id : null, typeof name === 'string' ? name : null),
  deleteMatch: (id) => ipcRenderer.invoke(C.MATCH_DELETE, typeof id === 'string' ? id : null),
  getStorage:  () => ipcRenderer.invoke(C.STORAGE_GET),
  getClipsUsage: () => ipcRenderer.invoke(C.CLIPS_USAGE),
  clearClips:  () => ipcRenderer.invoke(C.CLIPS_CLEAR),
  close:       () => window.close(),
});
