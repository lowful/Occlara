'use strict';

/**
 * THE CLIP PLAYER'S ARITHMETIC (8.4.4): where a step lands, and what a time
 * in a clip is called. One pure file, which the review page loads before its
 * player (clip-player.js) and scripts/test-clips.js runs as it is.
 *
 * A STEP LANDS ON A REAL FRAME. Main reads each clip's frames off its blocks
 * (review-clips.js frameTimes, the reading the look's stills were decoded by)
 * and hands the page their times with the clip, so a step goes to the next or
 * previous frame's own time, never to a guess at a frame rate: a clip recorded
 * before 8.4.2 runs at up to about 57 a second, or unevenly. Without the
 * times, a step is a thirtieth of a second, the rate every clip has been
 * recorded at since 8.4.2.
 *
 * WHERE IN THE FRAME A STEP LANDS. Paused, Chromium shows the first frame it
 * decodes whose end it ESTIMATES, its time plus a running average of the
 * frames before it, reaches the time asked for, and a frame whose estimated
 * end falls short of it is taken as over. So the frame before can still
 * cover a time just after a frame begins, and a frame followed by a long gap
 * can be taken as over before its next one begins. Measured in a <video> on
 * the fixture clip, whose frames came unevenly, each frame read off its
 * pixels against the one WebCodecs decodes at that index: 1 ms into each
 * frame showed the frame before on 145 of 199 frames, 4 ms in on 25 (each
 * just after a long gap, where the average runs long), and 2 ms before the
 * next frame showed an earlier frame on frame 26, followed by a 47 ms gap, in
 * the review page some of the time. So a step lands where, by that estimate,
 * the frame before is over and this one is not (insideOf: between the frame
 * before plus the average and this frame plus it, inside the frame, a
 * margin either side), its middle when the frames leave no such place. The
 * second either way and the timeline land the same way (landOn). The average
 * also takes in frames decoded ahead of the one shown, so beside a capture
 * stall, or short frames after long ones, no landing is sure (a real 30 a
 * second clip: frames after a 313 ms stall were shown for none of their own
 * times), and the player checks the frame the compositor presents and seeks
 * again (clip-player.js, SEEN, NOT ASSUMED).
 *
 * THE TIME IS SECONDS FROM THE DEATH, in the words the stills under the clip
 * use (review.js frameLabel): "2.4 s before", "0.3 s after", and the frame the
 * death falls in "At the death". A look from the screen counts from its read
 * of the death, that frame "Read as dead", as its stills do. To the tenth, and
 * to the hundredth within a twentieth of a second of the death, where a tenth
 * rounds to nothing: the frame after the death's is "0.03 s after", never
 * "0 s after". A clip whose death's place is not known is timed by its own
 * seconds, and says so, rather than by a death placed by a guess.
 */
(function (root, make) {
  const api = make();
  if (typeof module === 'object' && module && module.exports) module.exports = api;
  else root.ClipTime = api;
})(typeof window !== 'undefined' ? window : this, () => {
  // The margin a step keeps from either edge it lands between, in ms.
  const INSIDE_MS = 2;
  // The frames before one that its running average is taken over: Chromium's
  // runs over a few, and a long gap lifts it for about six frames after.
  const AVERAGE_OVER = [6, 16];
  // A step without the clip's frames: a frame at the rate clips are recorded at.
  const FALLBACK_S = 1 / 30;
  // How near a still's own frame its seconds put it: they are kept to the hundredth.
  const STILL_MS = 5;

  const finite = (x) => typeof x === 'number' && Number.isFinite(x);

  /**
   * The frames handed with a clip, { times, end }: each frame's time in ms on
   * the clip's own timeline, rising, and where the last stops being on screen.
   * Null for none, or for a list that is not one (a time that is no number, or
   * one out of order), and the player then steps a thirtieth of a second.
   */
  function framesOf(given) {
    const times = given && Array.isArray(given.times) ? given.times : null;
    if (!times || !times.length) return null;
    for (let i = 0; i < times.length; i++) {
      if (!finite(times[i]) || times[i] < 0 || (i > 0 && times[i] <= times[i - 1])) return null;
    }
    const last = times[times.length - 1];
    const end = finite(given.end) && given.end > last ? given.end : last + FALLBACK_S * 1000;
    return { times: times.slice(), end };
  }

  /** The frame on screen at `ms`: the last that began at or before it, or -1 before the first. */
  function frameIndex(times, ms) {
    let lo = 0;
    let hi = times.length - 1;
    let at = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (times[mid] <= ms) { at = mid; lo = mid + 1; } else hi = mid - 1;
    }
    return at;
  }

  /** The mean length of the `n` frames before frame `k`, ms; null with none before it. */
  function meanBefore(t, k, n) {
    const from = Math.max(1, k - n + 1);
    if (k < 1 || from > k) return null;
    return (t[k] - t[from - 1]) / (k - from + 1);
  }

  /**
   * Where frame `i` is shown from, in seconds: where the frame before is over
   * by Chromium's estimate and this one is not (see WHERE IN THE FRAME A STEP
   * LANDS), the average taken over the few frames before it and over more,
   * the later of the two for the frame before and the earlier for this one,
   * inside the frame by a margin; the frame's middle when that leaves nothing.
   */
  function insideOf(frames, i) {
    const t = frames.times;
    const k = Math.max(0, Math.min(t.length - 1, i));
    const start = t[k];
    const next = k + 1 < t.length ? t[k + 1] : frames.end;
    const margin = Math.min(INSIDE_MS, (next - start) / 4);
    const means = AVERAGE_OVER.map((n) => meanBefore(t, k, n)).filter((x) => x !== null);
    let lo = start + margin;
    let hi = next - margin;
    if (means.length) {
      lo = Math.max(lo, t[k - 1] + Math.max(...means) + margin);
      hi = Math.min(hi, start + Math.min(...means) - margin);
    }
    return (lo < hi ? (lo + hi) / 2 : (start + next) / 2) / 1000;
  }

  /** The clip's first frame, in seconds; 0 without its frames. */
  function startOf(frames) {
    return frames ? insideOf(frames, 0) : 0;
  }

  /**
   * Where a move to `t` (seconds) lands: inside the frame on screen then, so
   * the clip shows the frame its time is said for. Without the frames, `t`.
   */
  function landOn(frames, t) {
    if (!frames) return t;
    return insideOf(frames, Math.max(0, frameIndex(frames.times, (finite(t) ? t : 0) * 1000)));
  }

  /**
   * Where a step of one frame from `t` (seconds) lands, in seconds: the next
   * frame's own time for `dir` 1, the one before's for -1, the first and the
   * last frames the ends. Without the clip's frames, a thirtieth of a second
   * either way, inside the clip (`duration`, seconds, when known).
   */
  function stepFrom(frames, t, dir, duration) {
    const d = dir < 0 ? -1 : 1;
    const now = finite(t) ? t : 0;
    if (frames) {
      const i = frameIndex(frames.times, now * 1000);
      return insideOf(frames, i < 0 ? 0 : i + d);
    }
    const most = finite(duration) && duration > 0 ? duration : Infinity;
    return Math.max(0, Math.min(most, now + d * FALLBACK_S));
  }

  /**
   * Where a still the look took falls in the clip, in seconds, its own frame
   * just inside: `at` its seconds from the death (frameAt), `death` the
   * death's place in the clip (ms). Its seconds are the frame's own to the
   * hundredth, so the frame that began within STILL_MS of them is the one.
   */
  function stillAt(frames, death, at) {
    const ms = death + at * 1000;
    if (frames) {
      const k = frameIndex(frames.times, ms + STILL_MS);
      return insideOf(frames, k < 0 ? 0 : k);
    }
    return Math.max(0, (ms + STILL_MS) / 1000);
  }

  /** Seconds as the stills say them: to the tenth, and to the hundredth under a twentieth. */
  function secondsOf(x) {
    const tenth = Math.round(Math.abs(x) * 10) / 10;
    if (tenth > 0) return String(tenth);
    return String(Math.max(0.01, Math.round(Math.abs(x) * 100) / 100));
  }

  /**
   * What the time `t` (seconds) of a clip is called: { text, label, death },
   * the words beside the timeline, the words a screen reader is given for the
   * timeline's place, and whether its frame is the death's.
   *
   *   death     the death's place in the clip, ms, or null when not known
   *   screen    a look from the screen: counted from its read of the death
   *   frames    the clip's frames (framesOf), or null
   *   duration  the clip's length, seconds, when known
   */
  function timeWords(t, opts) {
    const o = opts || {};
    const ms = Math.max(0, finite(t) ? t * 1000 : 0);
    if (!finite(o.death)) {
      const s = String(Math.round(ms / 100) / 10);
      const of = finite(o.duration) && o.duration > 0 ? String(Math.round(o.duration * 10) / 10) : null;
      return {
        text: of === null ? `${s} s` : `${s} s of ${of} s`,
        label: `${s} s into the clip${of === null ? '' : `, of ${of} s`}`,
        death: false,
      };
    }
    const frames = o.frames || null;
    let shown = ms;
    let atDeath = false;
    if (frames) {
      const i = Math.max(0, frameIndex(frames.times, ms));
      shown = frames.times[i];
      atDeath = i === frameIndex(frames.times, o.death);
    } else {
      atDeath = Math.abs(ms - o.death) < (FALLBACK_S * 1000) / 2;
    }
    if (atDeath) {
      return o.screen
        ? { text: 'Read as dead', label: 'The frame the screen read the death on', death: true }
        : { text: 'At the death', label: 'At the death', death: true };
    }
    const from = (shown - o.death) / 1000;
    const n = secondsOf(from);
    const side = from < 0 ? 'before' : 'after';
    return { text: `${n} s ${side}`, label: `${n} s ${side} ${o.screen ? 'the screen read the death' : 'the death'}`, death: false };
  }

  return { INSIDE_MS, FALLBACK_S, STILL_MS, framesOf, frameIndex, insideOf, startOf, landOn, stepFrom, stillAt, secondsOf, timeWords };
});
