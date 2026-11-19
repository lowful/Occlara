'use strict';

/**
 * THE KEY THAT FLAGS A DEATH (8.13): which keys may be bound, as an Electron
 * accelerator, and how one is said. Plain JavaScript, read by main, the config
 * rule and the preloads of the two pages that bind it.
 *
 * A KEY HELD BY A GLOBAL SHORTCUT NEVER REACHES THE GAME. So nothing a player
 * plays with may be bound: no bare letter, digit, Space, Tab, Enter or Esc, and
 * no letter with Ctrl or Shift alone, which are crouch and walk in Valorant.
 * Windows keeps F12 for debuggers and Alt+F4 closes the game. Mouse buttons
 * cannot be bound: a global shortcut is keyboard only.
 */

const DEFAULT_KEY = 'F8';
const MODS = ['Ctrl', 'Alt', 'Shift'];
// Occlara's own keys (hotkeys.js), written as this file writes them.
const TAKEN = new Set(['Ctrl+Shift+P', 'Ctrl+Shift+M', 'Ctrl+Shift+S', 'Ctrl+Shift+E', 'Ctrl+Shift+H']);
const SOLO = new Set(['Insert', 'Delete', 'Home', 'End', 'PageUp', 'PageDown']);
const FN_RE = /^F([1-9]|1\d|2[0-4])$/;
const NUM_RE = /^num[0-9]$/;
const CHAR_RE = /^[A-Z0-9]$/;

function parts(accel) {
  const bits = String(accel || '').split('+').map((s) => s.trim()).filter(Boolean);
  if (!bits.length || bits.length > 4) return null;
  const key = bits[bits.length - 1];
  const mods = bits.slice(0, -1);
  if (new Set(mods).size !== mods.length || mods.some((m) => !MODS.includes(m))) return null;
  return { key, mods: MODS.filter((m) => mods.includes(m)) };
}

/** { ok: true, accel } in this file's order, or { ok: false, why } in the player's words. */
function check(accel) {
  const p = parts(accel);
  if (!p) return { ok: false, why: 'That key cannot be used.' };
  const { key, mods } = p;
  const text = [...mods, key].join('+');
  const fn = FN_RE.test(key);
  const solo = fn || SOLO.has(key) || NUM_RE.test(key);
  const char = CHAR_RE.test(key);
  if (!solo && !char) return { ok: false, why: 'That key cannot be used.' };
  if (key === 'F12') return { ok: false, why: 'Windows keeps F12 for itself. Choose another key.' };
  if (text === 'Alt+F4') return { ok: false, why: 'Alt+F4 closes the game. Choose another key.' };
  if (TAKEN.has(text)) return { ok: false, why: 'Occlara already uses that key.' };
  // A letter or digit needs Alt or both Ctrl and Shift: alone, or with one of
  // the two, it is a key the game is played with.
  if (char && !(mods.includes('Alt') || (mods.includes('Ctrl') && mods.includes('Shift')))) {
    return { ok: false, why: 'The game needs that key. Try F8, or add Alt.' };
  }
  return { ok: true, accel: text };
}

/** The accelerator in this file's order, or '' for none or one that cannot be bound. */
function normal(accel) {
  const c = check(accel);
  return c.ok ? c.accel : '';
}

/** A key as the Settings row and the onboarding page say it. */
function label(accel) {
  return String(accel || '').replace(/num([0-9])/, 'Numpad $1')
    .replace('PageUp', 'Page Up').replace('PageDown', 'Page Down');
}

function keyOfCode(code) {
  const c = String(code || '');
  let m = /^Key([A-Z])$/.exec(c);
  if (m) return m[1];
  m = /^Digit([0-9])$/.exec(c);
  if (m) return m[1];
  m = /^Numpad([0-9])$/.exec(c);
  if (m) return `num${m[1]}`;
  return FN_RE.test(c) || SOLO.has(c) ? c : null;
}

/**
 * A key press on a page, as { pending: true } while only modifiers are down,
 * { ok: true, accel } or { ok: false, why }. `e` is { code, ctrlKey, altKey,
 * shiftKey, metaKey }.
 */
function fromEvent(e) {
  const code = String((e && e.code) || '');
  if (/^(Control|Alt|Shift|Meta|OS)(Left|Right)?$/.test(code)) return { pending: true };
  if (e && e.metaKey) return { ok: false, why: 'The Windows key cannot be used.' };
  const key = keyOfCode(code);
  if (!key) return { ok: false, why: 'That key cannot be used.' };
  const mods = [e.ctrlKey && 'Ctrl', e.altKey && 'Alt', e.shiftKey && 'Shift'].filter(Boolean);
  return check([...mods, key].join('+'));
}

module.exports = { DEFAULT_KEY, check, normal, label, fromEvent };
