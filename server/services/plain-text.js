'use strict';

/*
 * NO SEMICOLONS IN WHAT A PLAYER READS (owner rule, 8.7). A semicolon in a
 * coaching line ("Enter second for a match; let a teammate...") reads like a
 * textbook, so every sentence the model writes loses its semicolons here, as
 * well as being told never to write one (the prompts in server/). The model
 * is not trusted to obey, and a review saved before the rule is cleaned as it
 * is shown (main's present(), home-model).
 *
 * A semicolon ends the sentence: "a; b" becomes "a. B". Where the next word is
 * a proper name or a digit the capital changes nothing. The same function is
 * copied to server/services/plain-text.js (src never requires from server,
 * and server/ is not shipped), and test:plaintext holds the two to one rule.
 */

/** One string with its semicolons turned into sentence ends. */
function noSemicolons(text) {
  if (typeof text !== 'string' || text.indexOf(';') < 0) return text;
  return text
    .replace(/\s*;\s*$/, '')
    .replace(/\s*;\s*([a-z])/g, (m, c) => `. ${c.toUpperCase()}`)
    .replace(/\s*;\s*/g, '. ')
    .replace(/\.\s*\.+/g, '.');
}

/** Every string inside a value, deep, with its semicolons gone. Links and data URLs are left alone. */
function scrubText(value) {
  if (typeof value === 'string') return /^(https?|occlara-clip|data):/i.test(value) ? value : noSemicolons(value);
  if (Array.isArray(value)) return value.map(scrubText);
  if (value && typeof value === 'object') {
    const out = {};
    for (const k of Object.keys(value)) out[k] = scrubText(value[k]);
    return out;
  }
  return value;
}

module.exports = { noSemicolons, scrubText };
