'use strict';

/**
 * ADVANCED COACHING IS ON FOR EVERYONE (8.8), and a player who turns it off
 * keeps it off.
 *
 * It was off by default while the playbook handed every player the same notes,
 * because advanced advice assumes the fundamentals are in place. Since 8.8 the
 * notes are sized to the player's rank (knowledge.js rankAdjust): a Gold player
 * is never handed a note written for Radiant, and the core floor and the
 * deathstreak override still hold (retrieve()). So the deeper coaching is the
 * best coaching for every player, and it is the default.
 *
 * WHY A MIGRATION AND NOT ONLY A NEW DEFAULT. electron-store (conf) writes its
 * defaults into the file on first run, so every existing install holds
 * `advancedTips: false` on disk, a value nobody chose, and conf reads the file
 * over the defaults: changing the default alone would turn it on for new
 * installs only. turnOnOnce() sets it on once, for everyone, keyed by
 * `advancedTipsOnAt`, and never again, so the player's own toggle after this
 * update sticks.
 *
 * Plain Node, no Electron: it is handed the store, so the test drives it with
 * a fake one.
 */

const FLAG = 'advancedTipsOnAt';

/** On unless it is explicitly false: a missing key is on. */
function isOn(v) { return v !== false; }

/** Advanced coaching as the store holds it, on when unset. */
function on(store) {
  try { return isOn(store.get('advancedTips')); } catch { return true; }
}

/**
 * Once per install: turn Advanced coaching on and stamp the flag, in one
 * write. True when it ran. A store that throws is left as it is, the app
 * carries on, and it is tried again at the next launch.
 */
function turnOnOnce(store, now = Date.now()) {
  try {
    const at = store.get(FLAG);
    if (typeof at === 'number' && at > 0) return false;
    store.set({ advancedTips: true, [FLAG]: now > 0 ? now : 1 });
    return true;
  } catch (e) {
    try { console.error('[store] could not turn on Advanced coaching:', e.message); } catch {}
    return false;
  }
}

module.exports = { FLAG, isOn, on, turnOnOnce };
