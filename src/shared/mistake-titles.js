'use strict';

/**
 * ONE MISTAKE, ONE NAME (9.1). The library counts a mistake by its key, and
 * the player reads it by its title, so a key that has gone by two titles reads
 * as two mistakes. "Deaths nobody traded" and "Died where nobody could trade"
 * were both `untraded`: from 8.8 the list wrote the first where Riot had a
 * teammate close at any of the deaths and the second where none was, and a
 * review saved before 8.8 always has the second. Side by side on Home, in the
 * Matches rows and in a review they read as two habits, and the second claims
 * a distance a death with no positions does not have (record-claims.js gates
 * "nobody could trade you" for the same reason). So every untraded entry is
 * "Deaths nobody traded" now, its detail still saying how many had a teammate
 * close, and a title saved before is shown in today's words, never rewritten
 * on disk.
 *
 * Pure, no Electron. Read by insights.js (the title it writes, inTodaysWords
 * and repeatTitle, so the review page, the patterns, Home, progress, the
 * weekly report, Practice and Wrapped show today's title), moments.js and
 * review-store.js (the library row's top mistake, which keeps the title alone
 * and no key). The server cannot require this file (check:server), so
 * chat-prompt.js keeps its own copy of the two strings, which
 * test:mistaketitles holds equal to this one.
 *
 * A RENAME IS A TITLE ONLY. The key never changes, because the library counts
 * by it: renaming a key orphans every saved review that used it.
 */

/** The title each key is written under today, where a key once had another. */
const TITLES = Object.freeze({
  untraded: 'Deaths nobody traded',
});

/**
 * Every title a list once wrote that today's words replace: the old title, the
 * key it belonged to, and the title today. Only a title that was never any
 * other key's goes here, so a row that kept the title alone (the library
 * index) is safe to rename without its key.
 */
const RENAMED = Object.freeze([
  Object.freeze({ key: 'untraded', from: 'Died where nobody could trade', to: TITLES.untraded }),
]);

const BY_FROM = new Map(RENAMED.map((r) => [r.from.toLowerCase(), r]));

/**
 * A saved title in today's words. With a key, only that key's old title is
 * renamed; with none (a library row's top mistake), any title on the list.
 * Anything else, a cause's title, a title built from the match ("Phoenix kept
 * winning"), or not a string at all, comes back as it was.
 */
function todaysTitle(key, title) {
  if (typeof title !== 'string') return title;
  const hit = BY_FROM.get(title.trim().toLowerCase());
  if (!hit) return title;
  if (key !== null && key !== undefined && key !== hit.key) return title;
  return hit.to;
}

/** An entry ({ key, title, ... }) with its title in today's words: the same object when nothing changes. */
function todaysEntryTitle(e) {
  if (!e || typeof e !== 'object' || typeof e.title !== 'string') return e;
  const title = todaysTitle(e.key, e.title);
  return title === e.title ? e : { ...e, title };
}

module.exports = { TITLES, RENAMED, todaysTitle, todaysEntryTitle };
