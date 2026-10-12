'use strict';

/**
 * THE ONE SHAPE A LICENCE KEY HAS (8.3.2): GC-XXXX-XXXX-XXXX-XXXX, GC- and
 * four groups of four capital letters and digits, the shape the website mints
 * (create-license) and the only one the licence server takes
 * (server/routes/license.js KEY_REGEX, after a trim and upper casing and
 * nothing else).
 *
 * The box showed XXXX-XXXX-XXXX-XXXX, so a key typed the way it showed, with
 * no GC-, was refused as an invalid format, and so was one pasted with spaces
 * in it. So a key is put in its shape before it is sent (toKey): full width
 * letters and digits read as their plain ones, upper case, every space, dash
 * or other mark between the characters dropped, a GC in front taken off, and
 * the sixteen letters and digits left grouped by four after GC-. Text that is
 * not sixteen of them is sent as it was typed, trimmed and upper cased, and the
 * server's answer says it is not a key.
 *
 * Its own file, loaded by the page before activation.js (the page's CSP is
 * 'self'), so scripts/test-surfaces.js runs these very rules against the
 * server's own KEY_REGEX.
 */
(function (root) {
  const PREFIX = 'GC';
  const GROUPS = 4;
  const GROUP = 4;
  const BODY = GROUPS * GROUP;
  const PLACEHOLDER = 'GC-XXXX-XXXX-XXXX-XXXX';
  const SHAPE = /^GC-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/;

  /** What was typed, as plain upper case letters, digits and marks, trimmed. */
  function plain(raw) {
    const s = String(raw === null || raw === undefined ? '' : raw);
    return (typeof s.normalize === 'function' ? s.normalize('NFKC') : s).trim().toUpperCase();
  }

  /** The key in its one shape, or what was typed when it is not sixteen letters and digits after an optional GC. */
  function toKey(raw) {
    const typed = plain(raw);
    const chars = typed.replace(/[^A-Z0-9]/g, '');
    const body = chars.length === PREFIX.length + BODY && chars.startsWith(PREFIX) ? chars.slice(PREFIX.length) : chars;
    if (body.length !== BODY) return typed;
    const groups = [];
    for (let i = 0; i < BODY; i += GROUP) groups.push(body.slice(i, i + GROUP));
    return `${PREFIX}-${groups.join('-')}`;
  }

  /** As it is typed: upper case, and only letters, digits and dashes kept. */
  function asTyped(raw) {
    return plain(raw).replace(/[^A-Z0-9-]/g, '');
  }

  const api = { toKey, asTyped, SHAPE, PLACEHOLDER };
  if (typeof module === 'object' && module && module.exports) module.exports = api;
  else root.OcclaraKey = api;
}(typeof window !== 'undefined' ? window : globalThis));
