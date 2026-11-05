'use strict';

/**
 * THE CHANGELOG IN THE APP: pure, no Electron, so test-community-ipc.js and
 * test-surfaces.js drive it directly.
 *
 * The one source is changelog/changelog.json at the repo root; the app bundles
 * its synced copy, src/shared/changelog.generated.json (npm run
 * sync:changelog, never hand edited), and the What's new page refreshes it in
 * the background from GET /api/changelog. What the server answers is checked
 * here (clean) before a line of it reaches the page: anything that is not a
 * well formed entry is dropped, and an answer with none left is no answer.
 *
 * The update line on Home (noticeFor) is said once a version: on the first
 * launch after an update to a version the changelog has an entry for. The
 * first launch ever says nothing and only remembers the version installed.
 */

const { DISCORD_URL } = require('./config');

const VERSION = /^(\d+)\.(\d+)\.(\d+)$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const KINDS = { new: 'New', improved: 'Improved', fixed: 'Fixed' };
const MAX_ENTRIES = 60;
const MAX_ITEMS = 12;
// Written as char codes, never as the characters (CLAUDE.md, no dashes).
const BANNED = new RegExp(`[${String.fromCharCode(0x2013, 0x2014)};]`);

/** a < b: negative, equal: 0, a > b: positive. null when either is no x.y.z. */
function cmpVersion(a, b) {
  const x = VERSION.exec(String(a || ''));
  const y = VERSION.exec(String(b || ''));
  if (!x || !y) return null;
  for (let i = 1; i <= 3; i++) {
    const d = Number(x[i]) - Number(y[i]);
    if (d) return d;
  }
  return 0;
}

const text = (v, max) => typeof v === 'string' && v.trim() && v.length <= max && !BANNED.test(v) ? v.trim() : null;

/**
 * Only well formed entries, newest first, each with only its known fields.
 * null when the list is not a list or nothing in it is an entry.
 */
function clean(list) {
  if (!Array.isArray(list)) return null;
  const out = [];
  const seen = new Set();
  for (const e of list.slice(0, MAX_ENTRIES)) {
    if (!e || typeof e !== 'object') continue;
    const version = VERSION.test(e.version || '') ? e.version : null;
    const date = typeof e.date === 'string' && DATE.test(e.date) ? e.date : null;
    const title = text(e.title, 80);
    const summary = text(e.summary, 160);
    if (!version || !date || !title || !summary || seen.has(version)) continue;
    const items = (Array.isArray(e.items) ? e.items : [])
      .filter((it) => it && KINDS[it.kind] && text(it.text, 300))
      .slice(0, MAX_ITEMS)
      .map((it) => ({ kind: it.kind, text: it.text.trim() }));
    if (!items.length) continue;
    seen.add(version);
    out.push({ version, date, title, summary, items });
  }
  out.sort((a, b) => cmpVersion(b.version, a.version));
  return out.length ? out : null;
}

/** The server's answer ({ version, entries }) as entries, or null. */
function fromServer(body) {
  return body && typeof body === 'object' ? clean(body.entries) : null;
}

/** The kind as the page says it. */
function kindWord(kind) {
  return KINDS[kind] || '';
}

/** "4 Nov 2026" for "2026-11-04", read as a calendar day (no time zone shift). */
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function dayOf(date) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(date || ''));
  if (!m || !MONTHS[Number(m[2]) - 1]) return '';
  return `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]} ${m[1]}`;
}

/**
 * The update line for this launch.
 * @returns null (nothing to say), { seed } (the first launch ever: remember
 *   the version installed, say nothing) or { version, text, link }
 */
function noticeFor({ current, seen, onboarded, entries }) {
  if (!VERSION.test(current || '')) return null;
  if (!seen) {
    // A first launch has never finished onboarding; one that has is an
    // install from before the changelog, updated to this version.
    if (!onboarded) return { seed: current };
  } else {
    const c = cmpVersion(seen, current);
    if (c === null || c >= 0) return null;
  }
  if (!Array.isArray(entries) || !entries.some((e) => e && e.version === current)) return null;
  return { version: current, text: `Occlara updated to ${current}.`, link: "See what's new" };
}

/** Exactly the one invite link, nothing like it. */
function isDiscordUrl(url) {
  return typeof url === 'string' && url === DISCORD_URL;
}

module.exports = { cmpVersion, clean, fromServer, kindWord, dayOf, noticeFor, isDiscordUrl, DISCORD_URL, KINDS };
