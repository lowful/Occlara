'use strict';

/**
 * ONE CLOCK FOR TWO CLIPS (docs/claude/duos.md): the round's own time, in ms
 * from its start, and where it lies in each clip. Pure, so the Duos page
 * loads it and test:duos runs it.
 *
 * A clip's marks carry an ANCHOR, one moment known on both clocks: { clip,
 * round }, the death (its place in the clip and Riot's moment of it) or a
 * highlight's first kill. A highlight's clip has its dead time cut out (its
 * cuts, { at, skipped }, ms on the clip's timeline): past each cut the
 * round's clock runs `skipped` ms ahead of the clip's. A clip with no anchor
 * has no place on the round's clock and plays alone.
 */
(function (root) {
  const fin = (x) => typeof x === 'number' && Number.isFinite(x);
  const cutsOf = (m) => (m && Array.isArray(m.cuts) ? m.cuts.filter((c) => c && fin(c.at) && fin(c.skipped) && c.skipped >= 0).slice().sort((a, b) => a.at - b.at) : []);
  const anchorOf = (m) => (m && m.anchor && fin(m.anchor.clip) && fin(m.anchor.round) ? m.anchor : null);
  /** The time the cuts at or before `clipMs` skipped. */
  const skippedTo = (cuts, clipMs) => cuts.reduce((n, c) => (c.at <= clipMs ? n + c.skipped : n), 0);

  /** The round's time at a place in the clip, or null with no anchor. */
  function roundAt(marks, clipMs) {
    const a = anchorOf(marks);
    if (!a || !fin(clipMs)) return null;
    const cuts = cutsOf(marks);
    return a.round + (clipMs - a.clip) + (skippedTo(cuts, clipMs) - skippedTo(cuts, a.clip));
  }

  /**
   * Where a moment of the round lies in the clip: { clip, inside, gap }, or
   * null with no anchor. `inside` false: before the clip's start or past its
   * end (lengthMs, when known), clamped to it. `gap` true: in time a cut
   * skipped, placed at the cut, where the clip goes on.
   */
  function clipAt(marks, roundMs, lengthMs) {
    const a = anchorOf(marks);
    if (!a || !fin(roundMs)) return null;
    const cuts = cutsOf(marks);
    const end = fin(lengthMs) && lengthMs > 0 ? lengthMs : Infinity;
    // Walk the pieces between cuts, each a straight run of both clocks.
    const starts = [0, ...cuts.map((c) => c.at)];
    let out = null;
    for (let i = 0; i < starts.length; i++) {
      const from = starts[i];
      const to = i + 1 < starts.length ? starts[i + 1] : end;
      const r0 = roundAt(marks, from);
      const r1 = r0 + (to - from);
      if (roundMs < r0) {
        // Before this piece: before the clip, or in the time the cut before it skipped.
        out = i === 0 ? { clip: 0, inside: false, gap: false } : { clip: from, inside: true, gap: true };
        break;
      }
      if (roundMs <= r1 || i === starts.length - 1) {
        const c = from + (roundMs - r0);
        out = c > end ? { clip: end, inside: false, gap: false } : { clip: c, inside: true, gap: false };
        break;
      }
    }
    return out;
  }

  /** The round's time at the clip's start and end: [from, to], or null. */
  function spanOf(marks, lengthMs) {
    if (!anchorOf(marks) || !fin(lengthMs) || lengthMs <= 0) return null;
    return [roundAt(marks, 0), roundAt(marks, lengthMs)];
  }

  /** "0:34.2" for a round's ms. */
  function clockOf(ms) {
    if (!fin(ms)) return '';
    const neg = ms < 0;
    const t = Math.abs(ms) / 1000;
    const m = Math.floor(t / 60);
    const s = t - m * 60;
    return `${neg ? '-' : ''}${m}:${s < 10 ? '0' : ''}${s.toFixed(1)}`;
  }

  const api = { roundAt, clipAt, spanOf, clockOf, anchorOf };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.DuoTime = api;
})(typeof window !== 'undefined' ? window : this);
