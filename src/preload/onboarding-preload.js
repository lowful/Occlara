'use strict';

const { contextBridge, ipcRenderer } = require('electron');
const C = require('../shared/channels');
const I18N = require('../shared/i18n');

/**
 * Onboarding bridge: dismiss the welcome tour for good, save its two choices
 * (Riot ID, advanced coaching) straight to config, and Connect a Riot ID,
 * whose recent matches main then grades and pushes as it goes.
 */
function subscribe(channel, cb) {
  if (!C.PUSH_LIST.includes(channel)) return () => {};
  const h = (_e, payload) => cb(payload);
  ipcRenderer.on(channel, h);
  return () => ipcRenderer.removeListener(channel, h);
}

contextBridge.exposeInMainWorld('occlara', {
  // i18n: the catalogue is required here (preloads have Node) and handed to the
  // renderer as a plain translator, so no surface needs Node access to be
  // translated. Read at call time, so a language change repaints correctly.
  i18n: {
    languages: () => I18N.LANGUAGES,
    t: (code, key) => I18N.t(code, key),
    hasUi: (code) => I18N.hasUi(code),
  },

  done: () => ipcRenderer.send(C.ONBOARDING_DONE),
  // The tour writes to the same config the Settings window uses, so the two
  // can never disagree.
  setConfig: (patch) => ipcRenderer.invoke(C.CONFIG_SET, patch),
  getConfig: () => ipcRenderer.invoke(C.CONFIG_GET),
  // Connect tests the Riot ID and starts grading its recent matches; the
  // page then follows the grading as main pushes it.
  testTracker: () => ipcRenderer.invoke(C.STATS_TEST),
  getBackfill: () => ipcRenderer.invoke(C.BACKFILL_STATUS),
  onBackfill:  (cb) => subscribe(C.PUSH_BACKFILL, cb),
});
