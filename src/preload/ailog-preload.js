'use strict';

const { contextBridge, ipcRenderer } = require('electron');
const C = require('../shared/channels');
const I18N = require('../shared/i18n');

/** AI decision-log viewer bridge: read the latest session, close the window. */
contextBridge.exposeInMainWorld('occlara', {
  // i18n: the catalogue is required here (preloads have Node) and handed to the
  // renderer as a plain translator, so no surface needs Node access to be
  // translated. Read at call time, so a language change repaints correctly.
  i18n: {
    languages: () => I18N.LANGUAGES,
    t: (code, key) => I18N.t(code, key),
    hasUi: (code) => I18N.hasUi(code),
  },

  // getLog(id) loads one session WITH its frames, so it is the expensive call.
  // sessions() is metadata only and is what the picker is built from. With a
  // scope (the eye on a review, 8.2) it is that one match's frames, or
  // { gone: true }, and never another session in their place. A session the
  // log no longer keeps is { gone: true } without one too (8.2).
  getLog:   (id, scope) => ipcRenderer.invoke(C.AILOG_GET, id, scope || null),
  sessions: () => ipcRenderer.invoke(C.AILOG_SESSIONS),
  // Checks the log's deaths against Riot. Called after the session is on screen,
  // never before, so the viewer stays instant and works with no network. One
  // match is checked on its own frames.
  confirm:  (id, scope) => ipcRenderer.invoke(C.AILOG_CONFIRM, id, scope || null),
  ask:      (payload) => ipcRenderer.invoke(C.AILOG_ASK, payload),
  // Jump an already open window to another session, or to one match of one
  // when a review's eye is pressed while this one is on screen.
  onShow:   (cb) => ipcRenderer.on(C.AILOG_SHOW, (_e, target) => cb(target)),
  // Only the keyboard hint's counter needs this, but it goes through the same
  // config channels every other surface uses rather than a private store, so
  // "have they seen it" lives with the rest of the preferences.
  getConfig: () => ipcRenderer.invoke(C.CONFIG_GET),
  setConfig: (patch) => ipcRenderer.invoke(C.CONFIG_SET, patch),
  close:  () => window.close(),
});
