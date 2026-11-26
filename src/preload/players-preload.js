'use strict';

const { contextBridge, ipcRenderer } = require('electron');
const C = require('../shared/channels');
const agentIcons = require('../shared/agent-icons');
const { pageMotion } = require('./page-motion');

/**
 * Bridge for the Players page (src/renderer/players/, docs/claude/social.md):
 * search Occlara players who opted in, by username or Riot ID, and open their
 * public profile. Main makes every request with the account's own auth and
 * answers finished words (src/shared/social.js), or null mid match or sealed,
 * when the seal hides this page anyway. The art is the bundled files only
 * (agent-icons.js): an agent or a map the game data knows gets a path, nothing
 * is fetched.
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
  /** { live, signedIn, problem } for the page's states (only: 'live' asks nothing more). */
  state:     () => ipcRenderer.invoke(C.SOCIAL_STATE, { only: 'live' }),
  search:    (q) => ipcRenderer.invoke(C.SOCIAL_SEARCH, String(q || '')),
  view:      (name) => ipcRenderer.invoke(C.SOCIAL_VIEW, String(name || '')),
  block:     (name, on) => ipcRenderer.invoke(C.SOCIAL_BLOCK, { name: String(name || ''), on: on !== false }),
  report:    (name, reason) => ipcRenderer.invoke(C.SOCIAL_REPORT, { name: String(name || ''), reason: String(reason || '') }),
  /** The profile this page was opened at (from Profile or a search elsewhere), taken once. */
  take:      () => ipcRenderer.invoke(C.SOCIAL_TAKE),
  signIn:    () => ipcRenderer.invoke(C.ACCOUNT_SIGNIN),
  onSocial:  (cb) => subscribe(C.PUSH_SOCIAL, cb),
  onAccount: (cb) => subscribe(C.ACCOUNT_CHANGED, cb),
  go:        (page) => ipcRenderer.send(C.SHELL_NAV, page),
  /** The bundled portrait of an agent, relative to assets/, or null. */
  agentArt:  (name) => agentIcons.iconOf('valorant', name),
  /** The bundled splash of a map, relative to assets/, or null. */
  mapArt:    (name) => agentIcons.mapArtOf(name),
});
