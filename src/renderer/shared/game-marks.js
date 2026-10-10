'use strict';

/**
 * The game picker's marks: Occlara's own, drawn here, never a game's logo.
 *
 * Riot's IP policy says a project "may not use any of our logos or trademarks"
 * without a written licence, and Marvel's marks are as protected, so the
 * sidebar shows three plain stroke icons on the 24 unit grid every icon in the
 * shell is drawn on, stroke 1.75 with round ends, in currentColor:
 *
 *   valorant  a reticle: a ring, four short ticks across it, a centre dot
 *   rivals    a hexagon with a four point spark inside it
 *   lol       a square map: two lanes round its edges, the diagonal between
 *             them, and a small base in two corners
 *
 * No V, no crest, no letter, and nothing shaped like any game's real mark,
 * for the reason the League rank marks are ours too (rankMark() in learn.js).
 * The game's full name always goes beside a mark, as its title and its
 * accessible name, because a symbol alone is a guess.
 *
 * App authored markup, never user or model text, so it is set as innerHTML.
 * A plain script that sets window.GameMarks, because there is no build step.
 */
(function () {
  const MARKS = {
    valorant: '<circle cx="12" cy="12" r="6.5"/>'
      + '<path d="M12 2.5v4M12 17.5v4M2.5 12h4M17.5 12h4"/>'
      + '<circle cx="12" cy="12" r="1.25" fill="currentColor" stroke="none"/>',
    rivals: '<path d="M12 2.75l8 4.62v9.26l-8 4.62-8-4.62V7.37z"/>'
      + '<path d="M12 7.6c0.45 2.6 1.8 3.95 4.4 4.4c-2.6 0.45-3.95 1.8-4.4 4.4c-0.45-2.6-1.8-3.95-4.4-4.4c2.6-0.45 3.95-1.8 4.4-4.4z"/>',
    lol: '<rect x="3" y="16" width="5" height="5" rx="1.25"/>'
      + '<rect x="16" y="3" width="5" height="5" rx="1.25"/>'
      + '<path d="M5.5 16V8.5a3 3 0 0 1 3-3H16M8 18.5h7.5a3 3 0 0 0 3-3V8M8 16l8-8"/>',
  };

  /** One game's mark as an <svg> string, or '' for a game without one. */
  function svg(id, size) {
    const inner = MARKS[id];
    if (!inner) return '';
    const px = Number(size) > 0 ? Number(size) : 18;
    return `<svg class="game-mark" viewBox="0 0 24 24" width="${px}" height="${px}" fill="none" stroke="currentColor"`
      + ` stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${inner}</svg>`;
  }

  const api = { svg, ids: () => Object.keys(MARKS) };
  if (typeof window !== 'undefined') window.GameMarks = api;
  // Node, for the test that holds every mark to the grid and the stroke.
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
