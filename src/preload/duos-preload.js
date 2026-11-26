'use strict';

const { contextBridge, ipcRenderer } = require('electron');
const C = require('../shared/channels');
const agentIcons = require('../shared/agent-icons');
const D = require('../shared/duos');
const { pageMotion } = require('./page-motion');

/**
 * Bridge for the Duos page (src/renderer/duos/, docs/claude/duos.md): a
 * friend's side of the matches played together. Main makes every request
 * with the account's own auth and answers finished words
 * (src/shared/duos.js), or null mid match or sealed, when the seal hides this
 * page anyway. A clip plays from occlara-clip:// only: the player's own from
 * its review's folder, the partner's from the duo cache once it is opened.
 * The art is the bundled files only (agent-icons.js).
 */
function subscribe(channel, cb) {
  if (!C.PUSH_LIST.includes(channel)) return () => {};
  const h = (_e, payload) => cb(payload);
  ipcRenderer.on(channel, h);
  return () => ipcRenderer.removeListener(channel, h);
}

contextBridge.exposeInMainWorld('occlara', {
  ...pageMotion(ipcRenderer),
  state:     () => ipcRenderer.invoke(C.DUOS_STATE),
  invite:    (name) => ipcRenderer.invoke(C.DUOS_INVITE, String(name || '')),
  makeCode:  () => ipcRenderer.invoke(C.DUOS_CODE),
  acceptCode: (code) => ipcRenderer.invoke(C.DUOS_ACCEPT, { code: String(code || '') }),
  acceptFrom: (from) => ipcRenderer.invoke(C.DUOS_ACCEPT, { from: String(from || '') }),
  decline:   (from) => ipcRenderer.invoke(C.DUOS_DECLINE, String(from || '')),
  cancel:    (ref) => ipcRenderer.invoke(C.DUOS_CANCEL, String(ref || '')),
  remove:    (name) => ipcRenderer.invoke(C.DUOS_REMOVE, String(name || '')),
  flag:      (name, reason) => ipcRenderer.invoke(C.DUOS_FLAG, { name: String(name || ''), reason: String(reason || '') }),
  block:     (name) => ipcRenderer.invoke(C.SOCIAL_BLOCK, { name: String(name || ''), on: true }),
  setUpload: (on) => ipcRenderer.invoke(C.DUOS_UPLOAD, on === true),
  plans:     () => ipcRenderer.invoke(C.DUOS_PLANS),
  match:     (ref) => ipcRenderer.invoke(C.DUOS_MATCH, String(ref || '')),
  openClip:  (x) => ipcRenderer.invoke(C.DUOS_CLIP, { ref: String((x && x.ref) || ''), name: String((x && x.name) || ''), match: String((x && x.match) || ''), expiresAt: String((x && x.expiresAt) || '') }),
  pin:       (b) => ipcRenderer.invoke(C.DUOS_PIN, b && typeof b === 'object' ? { clip: String(b.clip || ''), at: Number.isInteger(b.at) ? b.at : -1,
    label: String(b.label || ''), reaction: b.reaction ? String(b.reaction) : null } : {}),
  unpin:     (ref) => ipcRenderer.invoke(C.DUOS_UNPIN, String(ref || '')),
  signIn:    () => ipcRenderer.invoke(C.ACCOUNT_SIGNIN),
  onDuos:    (cb) => subscribe(C.PUSH_DUOS, cb),
  onAccount: (cb) => subscribe(C.ACCOUNT_CHANGED, cb),
  go:        (page) => ipcRenderer.send(C.SHELL_NAV, page),
  agentArt:  (name) => agentIcons.iconOf('valorant', name),
  mapArt:    (name) => agentIcons.mapArtOf(name),
  // The fixed lists and the words the page says that need no state.
  words: {
    what: D.WHAT, needsMax: D.NEEDS_MAX, askInvite: D.ASK_INVITE, names: D.NAMES_NOTE, said: { ...D.SAID },
    pins: D.PIN_CHOICES.map((x) => ({ ...x })), reactions: D.REACTION_CHOICES.map((x) => ({ ...x })),
    keepDays: D.DUO.KEEP_DAYS, partnersMax: D.DUO.PARTNERS_MAX,
  },
});
