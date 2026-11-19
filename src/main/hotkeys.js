'use strict';

const { globalShortcut } = require('electron');

/**
 * Global hotkeys. `actions` injects handlers. Registration failures (e.g. a key
 * already grabbed by another app) are logged, never thrown.
 */
const BINDINGS = {
  'CommandOrControl+Shift+P': 'pauseResume',
  'CommandOrControl+Shift+M': 'minimizePanel',
  'CommandOrControl+Shift+S': 'openSettings',
  // The last review. Mid match it does nothing, because the review of a match
  // in progress does not exist yet and a half one would be live coaching.
  'CommandOrControl+Shift+E': 'openReview',
  // The match library.
  'CommandOrControl+Shift+H': 'openHistory',
};

let bound = null;      // the actions register() was given, for resume()
let suspended = false;

function register(actions) {
  bound = actions;
  suspended = false;
  for (const [accel, action] of Object.entries(BINDINGS)) {
    try {
      const ok = globalShortcut.register(accel, () => {
        try { actions[action]?.(); }
        catch (err) { console.error(`[hotkeys] ${action} failed:`, err.message); }
      });
      if (!ok) console.warn(`[hotkeys] Failed to register ${accel}`);
    } catch (err) {
      console.warn(`[hotkeys] Error registering ${accel}:`, err.message);
    }
  }
}

function unregister() {
  globalShortcut.unregisterAll();
  flagAccel = null;
  bound = null;
  suspended = false;
}

/*
 * THE TRAINER HOLDS THE KEYBOARD (docs/claude/trainer.md). Ctrl is crouch and
 * Shift is walk there, so crouch-walking back (Ctrl+Shift+S) would open
 * Settings mid run. While the Trainer has the pointer locked the five keys are
 * let go, and taken again the moment it does not. The flag key is not touched:
 * it is held only mid match, when the Trainer is sealed.
 */
function suspend() {
  if (!bound || suspended) return;
  for (const accel of Object.keys(BINDINGS)) { try { globalShortcut.unregister(accel); } catch {} }
  suspended = true;
}

function resume() {
  if (!bound || !suspended) return;
  register(bound);
}

/*
 * THE FLAG KEY (8.13, shared/flag-key.js). The player's own choice, and held
 * only while a Valorant match is being played (index.js syncFlagKey), because a
 * key held here never reaches anything else on the PC.
 */
let flagAccel = null;

function registerFlag(accel, onPress) {
  if (flagAccel === accel) return true;
  unregisterFlag();
  try {
    const ok = globalShortcut.register(accel, () => {
      try { onPress(); }
      catch (err) { console.error('[hotkeys] flag failed:', err.message); }
    });
    if (ok) flagAccel = accel;
    else console.warn('[hotkeys] Failed to register the flag key');
    return !!ok;
  } catch (err) {
    console.warn('[hotkeys] Error registering the flag key:', err.message);
    return false;
  }
}

function unregisterFlag() {
  if (!flagAccel) return;
  try { globalShortcut.unregister(flagAccel); } catch {}
  flagAccel = null;
}

/** Whether a key is free for the flag: taken for a moment and let go. */
function flagKeyFree(accel) {
  if (flagAccel === accel) return true;
  try {
    if (globalShortcut.isRegistered(accel)) return false;
    const ok = globalShortcut.register(accel, () => {});
    if (ok) globalShortcut.unregister(accel);
    return !!ok;
  } catch { return false; }
}

module.exports = { register, unregister, suspend, resume, suspended: () => suspended, registerFlag, unregisterFlag, flagKeyFree, flagHeld: () => flagAccel, BINDINGS };
