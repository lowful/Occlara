'use strict';

/**
 * A review's clips (8.3): cut out of the match's recording when the review
 * looks at its moments, kept beside it in the library, named on its cards,
 * and, whenever it is shown, either played or said to be gone.
 *
 * CUT WHILE THE RECORDING IS HELD. The recording of a finished match is held
 * until its review's work is done (index.js releaseMatchHolds), and its pages
 * go soon after. So a clip is cut as a look is taken, before it is sent, since
 * 8.3.1 the look's stills coming from it (look-stills.js), and never later: a
 * review that looks again (Riot's record landing after the screen's look)
 * cuts its own, under the same names where the rounds are the same, and the
 * last look's are the ones kept (review-store.js keepClips).
 *
 * ONE AT A TIME, with main let go between them: a clip is a few MB read off
 * the recording's pages and written beside the review, and six of them in one
 * go is main held for the whole of it.
 *
 * Plain Node: the recording, the store and the clock are handed in, so
 * scripts/test-clips.js runs it on the real fixture and a temp folder.
 */

const clips = require('../../shared/clips');

const nextTurn = () => new Promise((resolve) => setImmediate(resolve));

/**
 * Cut and keep a clip of each moment, in the order given, `max` at most.
 *
 *   looks    [{ key, name, moment }]: what the clip is of (a round number, a
 *            death), the name it is kept under, and when the death was (ms)
 *   cut      (from, to, at) => { bytes, startWall } | null   recorder.cutClip
 *   save     (name, bytes) => true once kept       review-store.js saveClip
 *   stopped  () => true when the review was withdrawn meanwhile
 *
 * Resolves with { kept: [{ key, name, bytes, from, to, startWall }], tried,
 * missed }: missed is how many moments the recording did not hold (paused,
 * given up, started after it, or off), and startWall where each clip's own 0
 * is on the wall clock, for the stills the look takes from it (8.3.1).
 */
async function cutClips(opts) {
  const o = opts || {};
  const max = Number.isInteger(o.max) && o.max > 0 ? Math.min(o.max, clips.MAX_CLIPS) : clips.MAX_CLIPS;
  const out = { kept: [], tried: 0, missed: 0 };
  const turn = typeof o.yieldTo === 'function' ? o.yieldTo : nextTurn;
  for (const look of Array.isArray(o.looks) ? o.looks : []) {
    if (out.kept.length >= max) break;
    if (typeof o.stopped === 'function' && o.stopped()) break;
    const w = look ? clips.windowOf(look.moment) : null;
    if (!w || !clips.CLIP_RE.test(String(look.name || ''))) continue;
    out.tried += 1;
    let got = null;
    try { got = o.cut(w.from, w.to, look.moment); } catch { got = null; }
    const bytes = got && got.bytes;
    if (!bytes || !bytes.length) { out.missed += 1; continue; }
    // Withdrawn while it was cut: nothing is written for a review that is gone.
    if (typeof o.stopped === 'function' && o.stopped()) break;
    let saved = false;
    try { saved = !!o.save(look.name, bytes); } catch { saved = false; }
    if (saved) {
      out.kept.push({ key: look.key, name: look.name, bytes: bytes.length, from: w.from, to: w.to,
        startWall: Number.isFinite(got.startWall) ? got.startWall : null });
    }
    await turn();
  }
  return out;
}

/**
 * The review as a page is shown it: each clip a card names is played from
 * its URL while it is on disk, and said to be cleared once it is not, if the
 * review was told why (review.clipsCleared); a clip simply missing (a review
 * restored without its clips) is left out and its frames show as before.
 * Valorant's looks are on rounds[].forensics, League's deaths on deathList.
 *
 * @param io.has  (name) => whether that clip of this review is on disk
 * @param io.url  (name) => the URL to play it by
 * Returns a copy; the review handed in is never changed.
 */
function presentClips(review, io) {
  if (!review || typeof review !== 'object' || !io) return review;
  const why = review.clipsCleared && review.clipsCleared.reason === 'space' ? 'space'
    : review.clipsCleared ? 'cleared' : null;
  const about = (name) => {
    if (typeof name !== 'string' || !clips.CLIP_RE.test(name)) return null;
    if (io.has(name)) return { clipUrl: io.url(name) };
    return why ? { clipGone: why } : null;
  };
  let out = review;
  if (Array.isArray(review.rounds) && review.rounds.some((c) => c && c.forensics && c.forensics.clip)) {
    out = { ...out, rounds: review.rounds.map((c) => {
      const extra = c && c.forensics ? about(c.forensics.clip) : null;
      return extra ? { ...c, forensics: { ...c.forensics, ...extra } } : c;
    }) };
  }
  if (Array.isArray(review.deathList) && review.deathList.some((d) => d && d.clip)) {
    out = { ...out, deathList: review.deathList.map((d) => {
      const extra = d ? about(d.clip) : null;
      return extra ? { ...d, ...extra } : d;
    }) };
  }
  return out;
}

/** Every clip a review names, Valorant's and League's alike. */
function namedClips(review) {
  const names = [];
  for (const c of (review && review.rounds) || []) if (c && c.forensics && typeof c.forensics.clip === 'string') names.push(c.forensics.clip);
  for (const d of (review && review.deathList) || []) if (d && typeof d.clip === 'string') names.push(d.clip);
  return names.filter((n) => clips.CLIP_RE.test(n));
}

module.exports = { cutClips, presentClips, namedClips };
