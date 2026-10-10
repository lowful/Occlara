'use strict';

/**
 * The eye that opens one match's AI log (8.2), drawn the same on its row in
 * Matches and in its review's header, from the one word main hands both pages
 * (the `aiLog` of a REVIEWS_LIST row, and of a review as present() sends it):
 *
 *   'kept'   the log still holds the match: the eye opens it on its frames
 *   'gone'   it no longer does: the eye stays, disabled, and its tooltip says why
 *   null     nothing was recorded (a match graded from Riot's record alone,
 *            one recorded with the AI log off, Marvel Rivals, League): there
 *            is no eye at all
 *
 * The page sends the review's id and nothing else (REVIEW_AILOG): which session
 * and which frames are main's to find. The one exception is the eye on a death
 * the coach looked at, at the bottom of a review, which adds when its frame was
 * captured, so the log opens at that moment. It is the Stats header's eye, the one
 * icon the app has for the AI log, and a button of its own, beside a row and
 * never inside one: a control inside a button is clicked with it and read into
 * its name.
 *
 * A plain script that sets window.LogEye, because there is no build step and
 * each surface loads it with a <script> tag before its own.
 */
(function () {
  const SVG = 'http://www.w3.org/2000/svg';
  const NAME = 'Open the AI log of this match';
  // The eye on one death the coach looked at, in its review (8.2).
  const MOMENT = 'Open the AI log at this moment';
  const GONE = 'No AI log is kept for this match. The AI log keeps only your most recent recording '
    + 'sessions, and the review keeps the frames the coach looked at.';

  function svgEl(tag, attrs) {
    const n = document.createElementNS(SVG, tag);
    for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
    return n;
  }

  /** The Stats header's eye, drawn rather than parsed: the lid and the pupil. */
  function icon() {
    const svg = svgEl('svg', { viewBox: '0 0 24 24', width: '15', height: '15', fill: 'none', stroke: 'currentColor',
      'stroke-width': '2', 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true' });
    svg.append(svgEl('path', { d: 'M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z' }), svgEl('circle', { cx: '12', cy: '12', r: '3' }));
    return svg;
  }

  /**
   * The eye for one match, or null when it has no log to open.
   * @param state   'kept' | 'gone' | null, as main sent it
   * @param onOpen  called on a click, only while the log is kept
   * @param name    what it opens, when that is not the whole match: the eye on
   *                one death a review looked at opens the log at its moment
   */
  function button(state, onOpen, name) {
    if (state !== 'kept' && state !== 'gone') return null;
    const label = typeof name === 'string' && name ? name : NAME;
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'icon-btn log-eye';
    b.setAttribute('aria-label', label);
    b.title = state === 'kept' ? label : GONE;
    b.disabled = state !== 'kept';
    b.append(icon());
    if (state === 'kept' && typeof onOpen === 'function') b.addEventListener('click', onOpen);
    return b;
  }

  const api = { button, NAME, MOMENT, GONE };
  if (typeof window !== 'undefined') window.LogEye = api;
  // Node, for the test that holds both pages to the same eye.
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
