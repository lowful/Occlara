'use strict';

/**
 * WHAT A PAGE MAY WRITE TO THE CONFIG (CONFIG_SET, register-ipc.js).
 *
 * The handler used to write any key a page handed it except the account's,
 * so a page bug or an injected script could set the licence fields
 * (licenseStatus, licenseExpiry, licenseRefused, which isLocallyValid reads),
 * the key, the device id or any other state only main writes. Now a key is
 * written only when it is one Settings, onboarding or the AI log writes, and
 * only with a value that key can hold. Everything else is dropped.
 *
 * A setting a page writes must be on this list: check:config holds the
 * renderer's setConfig keys to it, and test:configset every rule here.
 *
 * Plain Node, no Electron, so the test runs it as it is.
 */

const { GAMES, isComingSoon, isRetired } = require('../../shared/games');
const { CAPS_GB } = require('../../shared/clips');
const { LANGUAGES } = require('../../shared/i18n');

const bool = (v) => typeof v === 'boolean';
const oneOf = (...vals) => (v) => vals.includes(v);

const RULES = Object.freeze({
  // 'auto', or a pinned gap in ms (Settings' buttons: 1000 to 5000).
  captureSpeed:   (v) => v === 'auto' || (Number.isInteger(v) && v >= 250 && v <= 60000),
  captureQuality: oneOf('standard', 'performance'),
  advancedTips:   bool,
  aiLog:          bool,
  sounds:         bool,
  // The live status's four switches (Progress v3), Settings and the
  // Recording screen's own Choose.
  liveMap:        bool,
  liveAgent:      bool,
  liveScore:      bool,
  liveRound:      bool,
  ailogHintSeen:  (v) => Number.isInteger(v) && v >= 0 && v <= 1000,
  // Typed a character at a time, so a Riot ID without its # yet is a value.
  riotId:         (v) => typeof v === 'string' && v.length <= 64,
  language:       (v) => typeof v === 'string' && LANGUAGES.some((l) => l.code === v),
  // A game that is coming soon cannot be chosen (games.js comingSoon), nor a retired one.
  game:           (v) => typeof v === 'string' && Object.prototype.hasOwnProperty.call(GAMES, v)
                    && !isComingSoon(v) && !isRetired(v),
  recordingMode:  oneOf('auto', 'off'),
  recordingRes:   oneOf('480', '720', '1080'),
  clipCapGB:      (v) => CAPS_GB.includes(v),
});

const WRITABLE = Object.freeze(Object.keys(RULES));

/** The part of `partial` a page may write: known keys with values they can hold. */
function pageWritable(partial) {
  const out = {};
  if (!partial || typeof partial !== 'object' || Array.isArray(partial)) return out;
  for (const k of Object.keys(partial)) {
    if (!Object.prototype.hasOwnProperty.call(RULES, k)) continue;
    let ok = false;
    try { ok = RULES[k](partial[k]) === true; } catch { ok = false; }
    if (ok) out[k] = partial[k];
  }
  return out;
}

module.exports = { pageWritable, WRITABLE, RULES };
