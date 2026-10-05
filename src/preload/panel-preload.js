'use strict';

const { contextBridge, ipcRenderer } = require('electron');
const C = require('../shared/channels');
const I18N = require('../shared/i18n');

/**
 * Control panel bridge, the interactive hub. Sends commands to main and
 * subscribes to state/status pushes.
 */
function subscribe(channel, cb) {
  const handler = (_e, data) => cb(data);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
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


  // commands
  startCoaching: () => ipcRenderer.send(C.COACH_START),
  stopCoaching:  () => ipcRenderer.send(C.COACH_STOP),
  pauseResume:   () => ipcRenderer.send(C.COACH_PAUSE),
  confirmAgent:  () => ipcRenderer.send(C.AGENT_CONFIRM),
  resizePanel:   (h) => ipcRenderer.send(C.PANEL_RESIZE, h),
  minimize:      () => ipcRenderer.send(C.PANEL_MINIMIZE),
  openSettings:  () => ipcRenderer.send(C.OPEN_SETTINGS),
  openHistory:   () => ipcRenderer.send(C.OPEN_HISTORY),
  openReview:    () => ipcRenderer.send(C.OPEN_REVIEW),
  openChat:      () => ipcRenderer.send(C.OPEN_CHAT),
  openStats:     () => ipcRenderer.send(C.OPEN_STATS),
  // The AI decision log. register-ipc already handled OPEN_AILOG; only the
  // bridge was missing, so nothing in the panel could reach it.
  openAiLog:     (id) => ipcRenderer.send(C.OPEN_AILOG, id || null),
  openLearn:     () => ipcRenderer.send(C.OPEN_LEARN),
  quit:          () => ipcRenderer.send(C.APP_QUIT),
  // request/response
  getState:      () => ipcRenderer.invoke(C.STATE_GET),
  // The panel's translator reads the language from here, exactly as Settings
  // does. Without it initI18n's refresh threw inside its own try on every call,
  // the language stayed English, and the panel was the one surface that never
  // followed the setting: Settings said "Starten" while the panel said "Start".
  getConfig:     () => ipcRenderer.invoke(C.CONFIG_GET),
  setAgent:      (name) => ipcRenderer.invoke(C.AGENT_SET, name),
  // subscriptions
  onStatus: (cb) => subscribe(C.PUSH_STATUS, cb),
  onState:  (cb) => subscribe(C.PUSH_STATE, cb),
  onAgent:  (cb) => subscribe(C.PUSH_AGENT, cb),
  onNudge:  (cb) => subscribe(C.PUSH_NUDGE, cb),
});
