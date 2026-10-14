'use strict';

/**
 * THE RECORDING'S FRAMES, THIRTY A SECOND (8.4.2). Its own file, loaded by the
 * recorder page before recorder.js (the page's CSP is script-src 'self'), so
 * that scripts/test-recorder.js drives this very code, as it drives health.js.
 *
 * WHY. The capture is asked for 60 frames a second, because asked for 30 with
 * the whole screen moving it delivered 21 (recorder.js ASK_FPS). MediaRecorder
 * was handed that track and recorded every frame it delivered, and Chromium
 * configures MediaRecorder's encoder for 30 frames a second whatever comes,
 * so each frame was given the bits of a thirtieth of a second: on the
 * player's Fracture swiftplay the capture delivered 57 a second and the pages
 * ran 74 to 91 MB a minute where 6 Mbps is 43, a constant 24 KB a frame, then
 * 45 to 47 MB at 32 a second, and its clips came out at 56.5, 55.6 and 32
 * frames a second. Measured here the same: a busy picture fed at 60 a second
 * wrote 13.1 Mbps against the 6 asked. So the recording is handed 30 a
 * second, each frame keeping the bits it had, and the bitrate is the one
 * asked. The coach's look decodes single stills from the clips
 * (look-stills.js), so each frame's quality is what matters, not 60 of them.
 *
 * HOW. A processor on the capture track hands this page every frame; the
 * pump keeps the grid's and writes them to a track generator, which is what
 * MediaRecorder records, and closes every other frame at once. Nothing is
 * copied: a frame written is the capture's own, passed on.
 *
 * THE GRID, by each frame's own timestamp: thirty slots a second open as the
 * capture's clock runs, and a frame takes the oldest slot open. A frame may
 * take one opening within a quarter of a slot, and a still screen leaves at
 * most two open. So a capture at 30 to 60 a second records 30, and every frame
 * of one at 30 or fewer is recorded. The first frame of each slot, counted on
 * a fixed grid, was simulated first and is not that: a capture at an even 30
 * a second with a millisecond or two of jitter, its frames sitting on the
 * slots' edges, recorded 22 to 27 a second, two frames in one slot and none in
 * the next; open slots carried over recorded all 30 of every run.
 *
 * NEVER QUEUED. A frame the generator cannot take at once (a write still in
 * flight) is closed, and its slot stays open for the next: a frame held waits
 * on one of the capture's few buffers, which stalls the capture.
 */
(function (root) {
  const RECORD_FPS = 30;
  // A frame may take a slot that opens within this much of a slot.
  const EARLY = 0.25;
  // A still screen leaves at most this many slots open.
  const MOST_OPEN = 2;
  // A timestamp further back than this (µs) is a new origin, not one frame
  // out of turn.
  const NEW_ORIGIN_US = 1e6;

  /**
   * The grid's rule. take(ts, nowMs) says whether the frame whose own
   * timestamp is `ts` (µs, VideoFrame.timestamp) is recorded; `nowMs` is the
   * page's clock, used only when the timestamps do not move on, so a capture
   * that stamped every frame alike still records.
   *
   * EACH STRETCH OF TIME COUNTED ONCE. What the page's clock counted while the
   * timestamps stood still, stepped back less than a second or were missing
   * is taken off the next step they move on by. Counted on both clocks, a
   * capture at 60 a second whose every other frame repeated the last one's
   * timestamp recorded 45 a second, one with a timestamp half a second back
   * once a second 31, and one with no timestamps its first frame alone. A step
   * back of more than a second is a new origin, and they count on from it.
   */
  function createGrid(fps) {
    const slotUs = 1e6 / (Number(fps) > 0 ? Number(fps) : RECORD_FPS);
    let open = 1;
    let seen = false;
    let lastTs = null;   // the newest timestamp the slots were opened up to
    let lastNow = null;
    let byPage = 0;      // µs the page's clock opened since that timestamp
    return {
      take(ts, nowMs) {
        const t = Number(ts);
        const now = Number(nowMs);
        const pageUs = Number.isFinite(now) && lastNow !== null && now > lastNow ? (now - lastNow) * 1000 : 0;
        if (seen) {
          let us = pageUs;
          if (Number.isFinite(t) && lastTs !== null && t > lastTs) {
            us = Math.max(0, t - lastTs - byPage);
            byPage = 0;
            lastTs = t;
          } else if (Number.isFinite(t) && (lastTs === null || lastTs - t > NEW_ORIGIN_US)) {
            byPage = 0;
            lastTs = t;
          } else byPage += us;
          open = Math.min(MOST_OPEN, open + us / slotUs);
        } else if (Number.isFinite(t)) lastTs = t;
        seen = true;
        if (Number.isFinite(now)) lastNow = now;
        if (open < 1 - EARLY) return false;
        open -= 1;
        return true;
      },
      /** The slots open now, for the tests. */
      open: () => open,
    };
  }

  /**
   * Every frame of `reader`, held as it comes (`hold`), then written to
   * `writer` when the writer can take one now and the grid takes it, or
   * closed (`release`) at once. A frame written is released once its write
   * settles (the generator closes it as it takes it). `kept` and `closed` are
   * told of each. Resolves once the reader is done or cancelled and every
   * write has settled, so nothing it held is still open.
   */
  async function pump(o) {
    const grid = o.grid;
    const now = typeof o.now === 'function' ? o.now : () => NaN;
    const writing = new Set();
    for (;;) {
      let r;
      try { r = await o.reader.read(); } catch { break; }
      if (!r || r.done) break;
      const f = o.hold(r.value);
      if (!(o.writer.desiredSize > 0) || !grid.take(f.timestamp, now())) {
        o.release(f);
        if (o.closed) o.closed();
        continue;
      }
      if (o.kept) o.kept();
      let w;
      try { w = Promise.resolve(o.writer.write(f)); } catch (e) { w = Promise.reject(e); }
      const settled = w.catch(() => {}).then(() => { o.release(f); writing.delete(settled); });
      writing.add(settled);
    }
    await Promise.all([...writing]);
  }

  const api = { createGrid, pump, RECORD_FPS, EARLY, MOST_OPEN };
  if (typeof module === 'object' && module && module.exports) module.exports = api;
  else root.OcclaraRecorderGrid = api;
}(typeof window !== 'undefined' ? window : globalThis));
