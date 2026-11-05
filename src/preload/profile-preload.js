'use strict';

const { contextBridge, ipcRenderer } = require('electron');
const C = require('../shared/channels');
const profile = require('../shared/profile');
const { pageMotion } = require('./page-motion');

/**
 * Bridge for the Profile page (8.8, src/renderer/profile/): the games left,
 * buying more, the player's own Valorant figures and the plans. The page is
 * built by main (profile.js build, PROFILE_GET), and the price as the number
 * changes is profile.js's own quote and step, handed through here, so the
 * page counts nothing. Both links are opened by main, which checks them: the
 * page names no URL.
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
  /** { hero, signedIn, buy, play, plans } or null. */
  getProfile:  () => ipcRenderer.invoke(C.PROFILE_GET),
  /** What the buy button says for a number as typed: { ok, n, total, label, note }. */
  quote:       (v) => profile.quote(v),
  /** One step up or down, kept in 1 to 500. */
  step:        (v, by) => profile.step(v, by),
  buy:         (n) => ipcRenderer.invoke(C.PROFILE_BUY, n),
  openPlans:   () => ipcRenderer.invoke(C.PROFILE_PLANS),
  signIn:      () => ipcRenderer.invoke(C.ACCOUNT_SIGNIN),
  onAccount:   (cb) => subscribe(C.ACCOUNT_CHANGED, cb),
  onReviews:   (cb) => subscribe(C.PUSH_REVIEWS, cb),
  go:          (page) => ipcRenderer.send(C.SHELL_NAV, page),
});
