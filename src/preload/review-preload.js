'use strict';

const { contextBridge, ipcRenderer } = require('electron');
const C = require('../shared/channels');
const { pageMotion } = require('./page-motion');

/**
 * Bridge for the post-game review.
 *
 * Read only by design: this surface reports what a finished game contained and
 * has nothing to command. Its writes are window requests rather than changes to
 * anything: a lesson, the library, Ask Coach on this match, and the AI log on
 * this match's frames.
 */
contextBridge.exposeInMainWorld('occlara', {
  // Moving between pages (shared/embed.js).
  ...pageMotion(ipcRenderer),
  // The window can be opened by the push OR by hand later, so it can always ask
  // for the last review rather than depending on having caught the event.
  getReview: () => ipcRenderer.invoke(C.LOL_REVIEW_GET),
  onReview:  (cb) => {
    const h = (_e, r) => cb(r);
    ipcRenderer.on(C.PUSH_LOL_REVIEW, h);
    return () => ipcRenderer.removeListener(C.PUSH_LOL_REVIEW, h);
  },
  // The Rivals review arrives on its own channel, carrying its own shape. Both
  // land in the same window, and the renderer branches on review.kind rather
  // than on which listener fired, so opening the window by hand and receiving
  // the push take the same path.
  onRivalsReview: (cb) => {
    const h = (_e, r) => cb(r);
    ipcRenderer.on(C.PUSH_RIVALS_REVIEW, h);
    return () => ipcRenderer.removeListener(C.PUSH_RIVALS_REVIEW, h);
  },
  // The Valorant review, round by round. Same window, same kind switch.
  onValorantReview: (cb) => {
    const h = (_e, r) => cb(r);
    ipcRenderer.on(C.PUSH_VALORANT_REVIEW, h);
    return () => ipcRenderer.removeListener(C.PUSH_VALORANT_REVIEW, h);
  },
  openLearn: () => ipcRenderer.send(C.OPEN_LEARN),
  // The library, and Ask Coach opened on this match.
  openMatches: () => ipcRenderer.send(C.OPEN_HISTORY),
  askAbout:    (id) => ipcRenderer.send(C.OPEN_CHAT_SEEDED, { reviewId: id }),
  // The eye: the review's id only, and main finds its frames in the AI log.
  // The eye on one death the coach looked at adds when its frame was taken,
  // so the log opens at that moment of the match (8.2).
  openAiLog:   (id, at) => (typeof at === 'number' && Number.isFinite(at)
    ? ipcRenderer.send(C.REVIEW_AILOG, id, at) : ipcRenderer.send(C.REVIEW_AILOG, id)),
  close:     () => window.close(),
});
