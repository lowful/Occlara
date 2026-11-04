'use strict';

const { contextBridge, ipcRenderer } = require('electron');
const C = require('../shared/channels');
const { pageMotion } = require('./page-motion');

/**
 * Bridge for the Invite page (8.7, src/renderer/invite/): the player's invite
 * link with Copy, how many friends joined and the games earned, and how it
 * works in two lines. Every line is written by main (account-service.js
 * referral, usage.js inviteProgress and INVITE_HOW), so the page only paints.
 * The link is copied by main; the page names no URL.
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
  /** { code, link, invited, qualified, earned, max_friends, max_games, line, how } or null. */
  getReferral: () => ipcRenderer.invoke(C.REFERRAL_GET),
  copyLink:    () => ipcRenderer.invoke(C.REFERRAL_COPY),
  getAccount:  () => ipcRenderer.invoke(C.ACCOUNT_GET),
  onAccount:   (cb) => subscribe(C.ACCOUNT_CHANGED, cb),
  openUpgrade: () => ipcRenderer.send(C.OPEN_UPGRADE),
  go:          (page) => ipcRenderer.send(C.SHELL_NAV, page),
});
