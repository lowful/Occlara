'use strict';

/*
 * THE RATING'S BADGE (docs/claude/rating.md), shared by the review's replay
 * (review/rating-view.js), the Recording screen's live rating (shell/shell.js)
 * and the stream widget's page (rating-widget/, the server inlines this file).
 * Its look is rating-badge.css. Every string is set as text; the count is the
 * stylesheet's (the value in tenths as --rt), this file works no figure out.
 */
(function () {
  const TIERS = ['poor', 'fair', 'good', 'great', 'excellent'];
  const tierOf = (v) => (v >= 9 ? 'excellent' : v >= 8 ? 'great' : v >= 7 ? 'good' : v >= 6 ? 'fair' : 'poor');
  function setTier(node, tier) {
    if (!node) return;
    for (const t of TIERS) node.classList.remove(`t-${t}`);
    if (tier) node.classList.add(`t-${tier}`);
  }
  /** The badge's number and its tier: the value as text, counted by CSS. */
  function setNumber(num, badge, value) {
    if (!num || typeof value !== 'number' || !Number.isFinite(value)) return;
    num.textContent = value.toFixed(1);
    num.style.setProperty('--rt', String(Math.round(value * 10)));
    setTier(badge, tierOf(value));
  }
  /** The move: "+0.3" rises in green, "-0.2" falls in red, once; nothing for no move. */
  function setDelta(el, delta) {
    if (!el) return;
    const d = String(delta || '');
    const up = /^\+/.test(d) && d !== '+0.0';
    const down = /^-/.test(d) && d !== '-0.0';
    el.textContent = up || down ? d : '';
    el.className = el.className.replace(/\s*\b(up|down)\b/g, '');
    if (up || down) { void el.offsetWidth; el.classList.add(up ? 'up' : 'down'); }
  }
  window.RatingBadge = { TIERS, tierOf, setTier, setNumber, setDelta };
})();
