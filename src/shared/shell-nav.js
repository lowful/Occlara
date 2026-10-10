'use strict';

/**
 * The one window's pages, and which of them shows.
 *
 * Since 8.1 the app is one window: a sidebar, and the page beside it. Each
 * page is an existing surface loaded in a view of its own (main-window.js), so
 * a page keeps its scroll, its chat and its state when the player goes
 * elsewhere and comes back. Matches, Patterns and Breakdown are three sections
 * of the one library surface, which used to be a single long scroll.
 *
 * THE SEAL. Nothing reaches the screen during a match, so while one is in
 * progress the window shows no page at all, only the Recording screen the
 * shell paints. A page asked for while sealed (the review of the match that
 * just ended is the usual one) is remembered and shown when the seal lifts.
 *
 * Pure: no Electron, so test-shell-nav.js drives it directly.
 */

const PAGES = [
  { id: 'home', label: 'Home', surface: 'home', query: {}, preload: 'home-preload.js', nav: true },
  { id: 'matches', label: 'Matches', surface: 'matches', query: { section: 'list' }, preload: 'matches-preload.js', nav: true },
  { id: 'patterns', label: 'Patterns', surface: 'matches', query: { section: 'patterns' }, preload: 'matches-preload.js', nav: true },
  { id: 'breakdown', label: 'Breakdown', surface: 'matches', query: { section: 'breakdown' }, preload: 'matches-preload.js', nav: true },
  { id: 'stats', label: 'Stats', surface: 'stats', query: {}, preload: 'stats-preload.js', nav: true },
  { id: 'coach', label: 'Ask Coach', surface: 'chat', query: {}, preload: 'chat-preload.js', nav: true },
  { id: 'settings', label: 'Settings', surface: 'settings', query: {}, preload: 'settings-preload.js', nav: false },
  { id: 'review', label: 'Review', surface: 'review', query: {}, preload: 'review-preload.js', nav: false },
];

function pageOf(id) {
  return PAGES.find((p) => p.id === id) || null;
}

/**
 * @param home  the page the window opens on
 * @returns { go(id), seal(on), state() }, state() being
 *          { page, shown, sealed }: the page the player is on, or will be on
 *          once the seal lifts, and the page whose view is visible (null while
 *          sealed)
 */
function createNav({ home = 'home' } = {}) {
  let page = pageOf(home) ? home : 'home';
  let sealed = false;
  return {
    go(id) {
      if (pageOf(id)) page = id;
      return this.state();
    },
    seal(on) {
      sealed = !!on;
      return this.state();
    },
    state() {
      return { page, shown: sealed ? null : page, sealed };
    },
  };
}

module.exports = { PAGES, pageOf, createNav };
