'use strict';

/**
 * The game picker's logos: each game's own mark, drawn inline so it takes
 * currentColor from its button, white on the dark ground and the ground's
 * colour on the selected button's white, as the marks Occlara drew did.
 *
 * THE PLAYER'S DECISION OF 2026-10-10. Until 8.2.1 the picker showed three
 * icons Occlara drew, because Riot's IP policy says a project "may not use any
 * of our logos or trademarks" without a written licence and Marvel's marks are
 * as protected. The player read that and chose the games' own logos
 * (CLAUDE.md, "The game picker shows the games' own logos").
 *
 * The source of each is its file in assets/games/: Valorant's and League's the
 * monochrome paths Simple Icons publishes, Marvel Rivals' traced from the game
 * site's icon, since no vector of it is published. Each is one filled path on
 * a 24 unit box, and test:surfaces holds every path here to its file, so the
 * two can never drift. The game's full name always goes beside a logo, as its
 * title and its accessible name, because a symbol alone is a guess.
 *
 * App authored markup, never user or model text, so it is set as innerHTML.
 * A plain script that sets window.GameLogos, because there is no build step.
 */
(function () {
  const LOGOS = {
    valorant: 'M23.792 2.152a.252.252 0 0 0-.098.083c-3.384 4.23-6.769 8.46-10.15 12.69-.107.093-.025.288.119.265 2.439.003 4.877 0 7.316.001a.66.66 0 0 0 .552-.25c.774-.967 1.55-1.934 2.324-2.903a.72.72 0 0 0 .144-.49c-.002-3.077 0-6.153-.003-9.23.016-.11-.1-.206-.204-.167zM.077 2.166c-.077.038-.074.132-.076.205.002 3.074.001 6.15.001 9.225a.679.679 0 0 0 .158.463l7.64 9.55c.12.152.308.25.505.247 2.455 0 4.91.003 7.365 0 .142.02.222-.174.116-.265C10.661 15.176 5.526 8.766.4 2.35c-.08-.094-.174-.272-.322-.184z',
    rivals: 'M2.44 5.86H12.35L18.76 12.75H10.78L21.56 18.14H11.65L5.24 11.25H13.22ZM1.92 8.29L6.84 9.91H3.6L2.58 14.38H6.03L0 16.23ZM22.08 15.71L17.16 14.09H20.4L21.42 9.62H17.97L24 7.77Z',
    lol: 'm1.912 0 1.212 2.474v19.053L1.912 24h14.73l1.337-4.682H8.33V0ZM12 1.516c-.913 0-1.798.112-2.648.312v1.74a9.738 9.738 0 0 1 2.648-.368c5.267 0 9.536 4.184 9.536 9.348a9.203 9.203 0 0 1-2.3 6.086l-.273.954-.602 2.112c2.952-1.993 4.89-5.335 4.89-9.122C23.25 6.468 18.213 1.516 12 1.516Zm0 2.673c-.924 0-1.814.148-2.648.414v13.713h8.817a8.246 8.246 0 0 0 2.36-5.768c0-4.617-3.818-8.359-8.529-8.359zM2.104 7.312A10.858 10.858 0 0 0 .75 12.576c0 1.906.492 3.7 1.355 5.266z',
  };

  /**
   * One game's logo as an <svg> string, or '' for a game without one. It
   * carries its game's id (data-game), because Marvel Rivals' emblem is half
   * as tall as it is wide and is drawn a size up to read as large as the
   * others (shell.css).
   */
  function svg(id, size) {
    const d = LOGOS[id];
    if (!d) return '';
    const px = Number(size) > 0 ? Number(size) : 18;
    return `<svg class="game-logo" data-game="${id}" viewBox="0 0 24 24" width="${px}" height="${px}" fill="currentColor" aria-hidden="true">`
      + `<path d="${d}"/></svg>`;
  }

  const api = { svg, ids: () => Object.keys(LOGOS), path: (id) => LOGOS[id] || null };
  if (typeof window !== 'undefined') window.GameLogos = api;
  // Node, for the test that holds every logo to its file in assets/games.
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
