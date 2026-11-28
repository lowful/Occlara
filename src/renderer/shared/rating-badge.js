'use strict';

/*
 * THE RATING'S BADGE (docs/claude/rating.md), shared by the review's replay
 * (review/rating-view.js), the Recording screen's live rating (shell/shell.js)
 * and the stream widget's page (rating-widget/, the server inlines this file).
 * Its look is rating-badge.css. Every string is set as text; the count is the
 * stylesheet's (the value on the 100 scale as --rt), this file works no figure
 * out but the one below.
 *
 * ON THE 100 SCALE (9.1, the owner's item 16): the rating is kept from 3.0 to
 * 10.0 inside and shown times ten, rounded, as the grade is shown out of 100:
 * 8.3 is 83. points() is shared/display.js ratingPoints, written out here
 * because the stream widget's page is this file inlined and nothing else
 * (test:display holds the two to one answer). The move arrives already on
 * that scale ("+6", "-3", "0"), main's or the review's.
 */
(function () {
  const TIERS = ['poor', 'fair', 'good', 'great', 'excellent'];
  const tierOf = (v) => (v >= 9 ? 'excellent' : v >= 8 ? 'great' : v >= 7 ? 'good' : v >= 6 ? 'fair' : 'poor');
  /** The rating on the 100 scale: 8.3 is 83 (display.js ratingPoints). */
  const points = (v) => (typeof v === 'number' && Number.isFinite(v) ? Math.round(v * 10) : null);
  /** 'up', 'down' or null for a move as shown: "+6" up, "-3" down, "0" and "+0" neither (display.js moveWay). */
  function wayOf(d) {
    const s = String(d == null ? '' : d).trim();
    if (!/^[+-]\d/.test(s) || /^[+-]0+(?:\.0+)?$/.test(s)) return null;
    return s[0] === '+' ? 'up' : 'down';
  }
  function setTier(node, tier) {
    if (!node) return;
    for (const t of TIERS) node.classList.remove(`t-${t}`);
    if (tier) node.classList.add(`t-${tier}`);
  }
  /** The badge's number and its tier: the value on the 100 scale as text, counted by CSS. */
  function setNumber(num, badge, value) {
    const p = points(value);
    if (!num || p === null) return;
    num.textContent = String(p);
    num.style.setProperty('--rt', String(p));
    setTier(badge, tierOf(value));
  }
  /** The move: "+3" rises in green, "-2" falls in red, once; nothing for no move. */
  function setDelta(el, delta) {
    if (!el) return;
    const d = String(delta || '');
    const way = wayOf(d);
    el.textContent = way ? d : '';
    el.className = el.className.replace(/\s*\b(up|down)\b/g, '');
    if (way) { void el.offsetWidth; el.classList.add(way); }
  }
  window.RatingBadge = { TIERS, tierOf, points, wayOf, setTier, setNumber, setDelta };
})();
