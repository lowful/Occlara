'use strict';

const { contextBridge, ipcRenderer } = require('electron');
const C = require('../shared/channels');
const I18N = require('../shared/i18n');
const GAMES = require('../shared/games');
const { PAGES } = require('../shared/shell-nav');

/**
 * Bridge for the shell, the main window's own document (8.1): the sidebar,
 * the top strip and the Recording screen. It carries what the panel used to:
 * Start, Stop and Pause, the agent check, the status line and the sounds,
 * plus the pages, the game and the window's own buttons.
 */
function subscribe(channel, cb) {
  if (!C.PUSH_LIST.includes(channel)) return () => {};
  const h = (_e, payload) => cb(payload);
  ipcRenderer.on(channel, h);
  return () => ipcRenderer.removeListener(channel, h);
}

contextBridge.exposeInMainWorld('occlara', {
  i18n: {
    languages: () => I18N.LANGUAGES,
    t: (code, key) => I18N.t(code, key),
    hasUi: (code) => I18N.hasUi(code),
  },
  pages: () => PAGES.map((p) => ({ id: p.id, label: p.label, nav: p.nav })),
  // The games a player is offered, the rule Settings' picker keeps.
  games: (includeUnavailable) => GAMES.list(includeUnavailable)
    .map((g) => ({ id: g.id, label: g.label, coaching: GAMES.canCoach(g.id), preview: !!g.preview })),

  // the record controls
  startCoaching: () => ipcRenderer.send(C.COACH_START),
  stopCoaching:  () => ipcRenderer.send(C.COACH_STOP),
  pauseResume:   () => ipcRenderer.send(C.COACH_PAUSE),
  confirmAgent:  () => ipcRenderer.send(C.AGENT_CONFIRM),
  setAgent:      (name) => ipcRenderer.invoke(C.AGENT_SET, name),
  setGame:       (id) => ipcRenderer.invoke(C.CONFIG_SET, { game: id }),
  getState:      () => ipcRenderer.invoke(C.STATE_GET),
  getConfig:     () => ipcRenderer.invoke(C.CONFIG_GET),

  // the window
  go:            (page) => ipcRenderer.send(C.SHELL_NAV, page),
  windowAction:  (action) => ipcRenderer.send(C.SHELL_WINDOW, action),
  getShell:      () => ipcRenderer.invoke(C.SHELL_GET),
  openLearn:     () => ipcRenderer.send(C.OPEN_LEARN),
  quit:          () => ipcRenderer.send(C.APP_QUIT),

  // pushes
  onShell:  (cb) => subscribe(C.PUSH_SHELL, cb),
  onStatus: (cb) => subscribe(C.PUSH_STATUS, cb),
  onState:  (cb) => subscribe(C.PUSH_STATE, cb),
  onAgent:  (cb) => subscribe(C.PUSH_AGENT, cb),
  onGame:   (cb) => subscribe(C.PUSH_GAME, cb),
});
