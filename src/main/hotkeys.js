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

function register(actions) {
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
}

module.exports = { register, unregister, BINDINGS };
