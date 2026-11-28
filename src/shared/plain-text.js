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

/*
 * PRACTICE, NEVER PRACTISE (9.1, the owner's rule: every "Practise" the
 * player sees is "Practice"). The model can write the British verb ("the
 * simple, practised rounds that built the lead"), and a review saved before
 * the rule keeps it, so a word that starts "practis" reads "practic" as it is
 * shown: practise, practised, practises, practising, a capital kept.
 */
function practiceSpelling(text) {
  if (typeof text !== 'string' || !/practis/i.test(text)) return text;
  return text.replace(/\b(practi)(s)(e|ed|es|ing)\b/gi, (m, head, s, tail) => `${head}${s === 'S' ? 'C' : 'c'}${tail}`);
}

/**
 * Every string inside a value, deep, with its semicolons gone and Practice
 * spelt so (9.1). Links are left alone, and so is a data URL: a kept frame
 * is "data:image/jpeg;base64,...",
 * and scrubbed it became "data:image/jpeg. Base64,...", a broken image in its
 * round's row and a clip player with no poster.
 */
function scrubText(value) {
  if (typeof value === 'string') return /^(https?|occlara-clip|data):/i.test(value) ? value : practiceSpelling(noSemicolons(value));
  if (Array.isArray(value)) return value.map(scrubText);
  if (value && typeof value === 'object') {
    const out = {};
    for (const k of Object.keys(value)) out[k] = scrubText(value[k]);
    return out;
  }
  return value;
}

module.exports = { noSemicolons, practiceSpelling, scrubText };
