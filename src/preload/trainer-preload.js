'use strict';

const { contextBridge, ipcRenderer } = require('electron');
const C = require('../shared/channels');
const DATA = require('../shared/trainer-data.json');
const SCENARIOS = require('../shared/trainer-scenarios.json');
const { pageMotion, subnav } = require('./page-motion');

/**
 * Bridge for the Trainer (src/renderer/trainer/, docs/claude/trainer.md).
 * The page runs the whole simulation itself; across this bridge go only the
 * data files (read once, here), the player's settings (one config key,
 * trainerSettings), the finished runs to keep, and whether the pointer is
 * locked, so main lets go of its Ctrl+Shift keys while it is. Nothing the
 * Trainer does leaves this PC.
 */
function subscribe(channel, cb) {
  if (!C.PUSH_LIST.includes(channel)) return () => {};
  const h = (_e, payload) => cb(payload);
  ipcRenderer.on(channel, h);
  return () => ipcRenderer.removeListener(channel, h);
}

// Copied once: the page gets plain data, never the module.
const data = JSON.parse(JSON.stringify(DATA));
const scenarios = JSON.parse(JSON.stringify(SCENARIOS.scenarios || []));

contextBridge.exposeInMainWorld('occlara', {
  // Moving between pages (shared/embed.js).
  ...pageMotion(ipcRenderer),
  // The sub switch at the page's head (Orbit, shared/subnav.js).
  subnav,
  /** The numbers (trainer-data.json, each value with its source) and the scenarios. */
  data:        () => ({ numbers: data, scenarios }),
  getState:    () => ipcRenderer.invoke(C.STATE_GET),
  /** { trainerSettings, sounds, ... }: the trainer reads its own key and the app's sounds switch. */
  getConfig:   () => ipcRenderer.invoke(C.CONFIG_GET),
  /** The whole settings object, as normaliseSettings makes it; main drops anything else. */
  saveSettings: (s) => ipcRenderer.invoke(C.CONFIG_SET, { trainerSettings: s }),
  /** { runs, opened, replay } or null mid match: `replay` is the death a review's Fight it again opened, else null. */
  getRuns:     () => ipcRenderer.invoke(C.TRAINER_GET),
  /** Fight it again: { list, fresh } (shared/trainer-replay.js) or null mid match. A replay run saves as scenario 'replay'. */
  getReplays:  () => ipcRenderer.invoke(C.TRAINER_REPLAYS),
  /** The replays were shown: the ones from matches so far are no longer fresh. */
  replaysSeen: () => ipcRenderer.invoke(C.TRAINER_REPLAYS_SEEN),
  saveRun:     (run) => ipcRenderer.invoke(C.TRAINER_SAVE, run),
  clearRuns:   (id) => ipcRenderer.invoke(C.TRAINER_CLEAR, typeof id === 'string' ? id : null),
  /** The pointer is locked (true) or not (false). */
  playing:     (on) => ipcRenderer.send(C.TRAINER_PLAYING, on === true),
  onTrainer:   (cb) => subscribe(C.PUSH_TRAINER, cb),
  onState:     (cb) => subscribe(C.PUSH_STATE, cb),
  go:          (page) => ipcRenderer.send(C.SHELL_NAV, page),
  close:       () => window.close(),
});
