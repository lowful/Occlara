'use strict';

/**
 * REPORT A PROBLEM, the app's half of the rules (docs/claude/feedback.md).
 * Pure: main (services/feedback-service.js), the preload and the tests read
 * it. The server keeps the same numbers in server/services/feedback.js,
 * since server/ cannot require src/ nor src/ server/; test:feedback holds the
 * two equal.
 *
 * Every sentence a player reads is here, finished: no dash, no semicolon.
 */

const KINDS = ['broke', 'coaching', 'idea'];
const KIND_LABEL = { broke: 'Something broke', coaching: 'Wrong coaching', idea: 'Idea' };
const TEXT_MIN = 10;
const TEXT_MAX = 4000;
const MAX_IMAGES = 3;
// A picture the player picks, before main downscales it.
const FILE_MAX_BYTES = 5 * 1024 * 1024;
const FILE_TYPES = ['image/png', 'image/jpeg', 'image/webp'];
// What main sends: the long side at most this, recompressed to JPEG, and no
// bigger than the server takes (IMAGE_MAX_BYTES there).
const LONG_SIDE = 1600;
const SEND_MAX_BYTES = 2 * 1024 * 1024;
const JPEG_QUALITY = 85;
const JPEG_QUALITY_SMALLER = 70;
const PREVIEW_HEIGHT = 160;

/** What the page says for each answer main gives. */
const SAID = {
  sent: 'Thanks. Your report is in, and it will be read.',
  match: 'Reports wait until the match is over.',
  auth: 'Sign in from Settings, or add your licence key, to send a report.',
  busy: 'You have sent a lot of reports lately. Try again later.',
  later: 'Reports cannot be sent right now. Try again later.',
  unreachable: 'Occlara could not reach its server. Check your connection and try again.',
  short: `Tell us a little more, at least ${TEXT_MIN} characters.`,
  long: `That is more than ${TEXT_MAX} characters. Shorten it a little.`,
  kind: 'Choose what kind of report this is.',
  invalid: 'This report could not be sent. Try again.',
  type: 'Only PNG, JPG and WebP pictures can be added.',
  size: 'That picture is over 5 MB.',
  image: 'That picture could not be read.',
  many: `Up to ${MAX_IMAGES} pictures can be added.`,
};

/** What is sent, as the page shows it under the form. */
const WHAT_IS_SENT = 'Your words, the pictures you add, the app version, your Windows version, the game, and your last review only if you attach it.';
const NEVER_SENT = 'Never your Riot ID, your licence key or your email. Your account is sent as an id. A picture is sent as it is, so crop out names you do not want to share.';

/**
 * The player's words with what must never leave the PC taken out: their
 * Riot ID as stored, any licence key and any email address. Plain string
 * work, no regex beyond the two asserted in test:feedback.
 */
const KEY_SHAPE = /GC-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}/gi;
const EMAIL_SHAPE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/g;

function replaceAllInsensitive(text, needle, by) {
  if (!needle) return text;
  const low = text.toLowerCase();
  const n = needle.toLowerCase();
  let out = '';
  let i = 0;
  for (;;) {
    const j = low.indexOf(n, i);
    if (j < 0) break;
    out += text.slice(i, j) + by;
    i = j + n.length;
  }
  return out + text.slice(i);
}

function scrubText(text, { riotId, email } = {}) {
  let t = typeof text === 'string' ? text : '';
  const id = typeof riotId === 'string' ? riotId.trim() : '';
  if (id.includes('#')) {
    const [name, tag] = id.split('#');
    // The ID as stored, and as typed with a space before the tag.
    t = replaceAllInsensitive(t, id, 'my Riot ID');
    if (name && tag) t = replaceAllInsensitive(t, `${name.trim()} #${tag.trim()}`, 'my Riot ID');
  }
  if (typeof email === 'string' && email.includes('@')) t = replaceAllInsensitive(t, email.trim(), 'my email');
  t = t.replace(KEY_SHAPE, 'my licence key');
  t = t.replace(EMAIL_SHAPE, 'an email');
  return t;
}

/** The last review as the page names it, from a library row, or null. */
function reviewLine(row) {
  if (!row || !row.id) return null;
  const bits = [row.map, row.title ? `as ${row.title}` : null].filter(Boolean);
  return { id: String(row.id), line: bits.length ? `Your last match, ${bits.join(' ')}` : 'Your last match' };
}

/** The error word main answers, for a server answer. */
function errorOfStatus(status) {
  if (status === 401 || status === 403) return 'auth';
  if (status === 429) return 'busy';
  if (status === 413) return 'size';
  if (status === 400) return 'invalid';
  return 'later';
}

module.exports = {
  KINDS, KIND_LABEL, TEXT_MIN, TEXT_MAX, MAX_IMAGES, FILE_MAX_BYTES, FILE_TYPES, LONG_SIDE, SEND_MAX_BYTES,
  JPEG_QUALITY, JPEG_QUALITY_SMALLER, PREVIEW_HEIGHT, SAID, WHAT_IS_SENT, NEVER_SENT,
  scrubText, reviewLine, errorOfStatus, replaceAllInsensitive,
};
