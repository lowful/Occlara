'use strict';

/**
 * THE RECORDER PAGE'S ACCOUNT OF THE CAPTURE, once a second (8.3): how many
 * frames came, whether the picture changed, how old the newest frame is. Its
 * own file, loaded by the page before recorder.js (the page's CSP is
 * script-src 'self'), so that scripts/test-recorder.js drives this very code
 * through the real health rules (recorder.js createHealth), not a copy of it.
 *
 * A SECOND THAT BROUGHT NO NEW FRAME SAYS WHAT THE LAST FRAME SAID. Whether
 * the picture changed is read off two frames, so a second with no new frame
 * has nothing to compare. Said "not changing" there, every second after a
 * frame was a good one, and one good second starts the 20 s again: replayed
 * through createHealth, a capture slowed to a frame every 1.1, 1.5, 1.9 or 2.5
 * s never gave up in ten minutes, nor did four of five half hours of frames
 * at random at one a second, and the session recorded a slideshow. Carried, a
 * slowed capture gives up within 30 s of a match, and a still screen is still
 * told apart: its frames keep coming, a couple a second, each the same as the
 * last. A capture that stops altogether is main's to see (a newest frame over
 * 2 s old, recorder.js STALE_FRAME_MS).
 */
(function (root) {
  // The mean absolute difference, of 255, between this second's newest frame
  // and the last second's that counts as the picture changing. A game in play
  // differs by tens; a blinking caret by hundredths.
  const CHANGE_MAD = 1;

  const r1 = (x) => Math.round(x * 10) / 10;

  /** The mean absolute difference between two brightness pictures of one size. */
  function mad(a, b) {
    let d = 0;
    for (let i = 0; i < a.length; i++) d += Math.abs(a[i] - b[i]);
    return d / a.length;
  }

  /**
   * One recording's account, from `start` { now, frames, recorded }: the
   * page's clock (ms), its count of frames the capture handed over, and of
   * frames handed to the recording (grid.js), when the recording began.
   *
   * second({ now, frames, recorded, newestAt, thumb }) is one second's: the
   * clock, the frames the capture handed over so far, the frames recorded so
   * far, when the newest came (null before any), and thumb(), which draws the
   * newest frame small ({ luma, mean }) and is called only when a frame came
   * since the last account. Returns { fps, recordedFps, changing, luma,
   * frameAgeMs }: fps what the capture delivered (the busy rule's), and
   * recordedFps what was recorded of it (Settings' and the counts', 8.4.2),
   * null when not counted; luma null when no frame came.
   */
  function createTally(start) {
    const s = start || {};
    let lastFrames = Number(s.frames) || 0;
    let lastRecorded = Number(s.recorded) || 0;
    let lastAt = Number(s.now) || 0;
    let thumbAt = 0;
    let prev = null;
    let changing = false;
    return {
      second(x) {
        const elapsed = Math.max(0.25, (x.now - lastAt) / 1000);
        const fps = r1((x.frames - lastFrames) / elapsed);
        const counted = Number.isFinite(x.recorded);
        const recordedFps = counted ? r1((x.recorded - lastRecorded) / elapsed) : null;
        lastFrames = x.frames;
        if (counted) lastRecorded = x.recorded;
        lastAt = x.now;
        let luma = null;
        if (x.newestAt !== null && x.newestAt > thumbAt) {
          const t = x.thumb();
          luma = r1(t.mean);
          changing = !!prev && mad(t.luma, prev) > CHANGE_MAD;
          prev = t.luma;
          thumbAt = x.now;
        }
        // No new frame: `changing` is still the verdict the last one gave.
        return { fps, recordedFps, changing, luma, frameAgeMs: x.newestAt === null ? null : Math.round(x.now - x.newestAt) };
      },
    };
  }

  const api = { createTally, mad, CHANGE_MAD };
  if (typeof module === 'object' && module && module.exports) module.exports = api;
  else root.OcclaraRecorderHealth = api;
}(typeof window !== 'undefined' ? window : globalThis));
