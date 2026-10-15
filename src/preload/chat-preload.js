'use strict';

const { contextBridge, ipcRenderer } = require('electron');
const C = require('../shared/channels');
const I18N = require('../shared/i18n');
const { pageMotion } = require('./page-motion');

/**
 * Ask Coach's bridge: a question about the match on the chip, the chip's
 * list and its moves (8.5.0), the seed "Ask about this match" leaves, and
 * the config for the page's language.
 */
function subscribe(channel, cb) {
  const handler = (_e, data) => cb(data);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
}

contextBridge.exposeInMainWorld('occlara', {
  // Moving between pages (shared/embed.js).
  ...pageMotion(ipcRenderer),
  // i18n: the catalogue is required here (preloads have Node) and handed to the
  // renderer as a plain translator, so no surface needs Node access to be
  // translated. Read at call time, so a language change repaints correctly.
  i18n: {
    languages: () => I18N.LANGUAGES,
    t: (code, key) => I18N.t(code, key),
    hasUi: (code) => I18N.hasUi(code),
  },
  // The page's language (shared/i18n-apply.js initI18n reads it).
  getConfig: () => ipcRenderer.invoke(C.CONFIG_GET),

  // One question: the thread since the last divider, and the match on the chip.
  sendChat: (messages, opts) => ipcRenderer.invoke(C.CHAT_SEND, messages, opts || {}),
  // The ten newest reviews of the game, none held, and the chip's match.
  getMatches: () => ipcRenderer.invoke(C.CHAT_MATCHES),
  // The chip moved: a review's id, 'none' for general questions, null for the newest.
  setMatch: (id) => ipcRenderer.invoke(C.CHAT_MATCH, id == null ? null : String(id)),
  getState: () => ipcRenderer.invoke(C.STATE_GET),
  // What "Ask about this match" left for the page, cleared on read so it fires once.
  getSeed:  () => ipcRenderer.invoke(C.CHAT_SEED),
  onState:  (cb) => subscribe(C.PUSH_STATE, cb),
  // A review saved or improved, or the game changed: the list repaints.
  onReviews: (cb) => subscribe(C.PUSH_REVIEWS, cb),
  onGame:    (cb) => subscribe(C.PUSH_GAME, cb),
});
