'use strict';

const { contextBridge, ipcRenderer } = require('electron');
const C = require('../shared/channels');
const I18N = require('../shared/i18n');
const GAMES = require('../shared/games');
const { PAGES } = require('../shared/shell-nav');
const { DISCORD_URL } = require('../shared/config');
const { iconOf, mapArtOf } = require('../shared/agent-icons');

/**
 * Bridge for the shell, the main window's own document (8.1): the sidebar,
 * the top strip and the Recording screen. It carries what the panel used to:
 * Start, Stop and Pause, the notice line and the sounds, plus the pages, the
 * game and the window's own buttons. No agent check since 8.4.4: the agent is
 * read off the player's own HUD in the match, and nothing asks for it.
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
    .map((g) => ({ id: g.id, label: g.label, coaching: GAMES.canCoach(g.id), preview: !!g.preview, comingSoon: !!g.comingSoon })),

  // the record controls
  startCoaching: () => ipcRenderer.send(C.COACH_START),
  stopCoaching:  () => ipcRenderer.send(C.COACH_STOP),
  pauseResume:   () => ipcRenderer.send(C.COACH_PAUSE),
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
  onGame:   (cb) => subscribe(C.PUSH_GAME, cb),
  // The sidebar's Invite button (8.7), above Settings in its foot: go('invite')
  // opens the page, locked by the seal like every page. The account's view
  // too, should the foot show the tier.
  openInvite: () => ipcRenderer.send(C.SHELL_NAV, 'invite'),
  // The Discord icon at the end of Settings' row: main opens the invite, only
  // as exactly DISCORD_URL and never mid match or sealed (community.js).
  openDiscord: () => ipcRenderer.invoke(C.DISCORD_OPEN, DISCORD_URL),
  getAccount: () => ipcRenderer.invoke(C.ACCOUNT_GET),
  onAccount:  (cb) => subscribe(C.ACCOUNT_CHANGED, cb),

  // THE LIVE STATUS (Progress v3): main's four facts while a match is
  // recorded (PUSH_LIVE), each only while its switch is on, and the
  // switches themselves, the four keys alone (config-keys.js).
  getLive: () => ipcRenderer.invoke(C.LIVE_GET),
  onLive:  (cb) => subscribe(C.PUSH_LIVE, cb),
  setLive: (key, on) => (['liveMap', 'liveAgent', 'liveScore', 'liveRound'].includes(key) && typeof on === 'boolean'
    ? ipcRenderer.invoke(C.CONFIG_SET, { [key]: on }) : Promise.resolve(null)),
  // The bundled art of a map and an agent, or null (agent-icons.js).
  mapArt:   (name) => { const r = mapArtOf(name); return r ? `../../../assets/${r}` : null; },
  agentArt: (name) => { const r = iconOf('valorant', name); return r ? `../../../assets/${r}` : null; },
});
