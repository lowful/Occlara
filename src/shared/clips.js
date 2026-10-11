'use strict';

/**
 * THE CLIP OF A MOMENT (8.3): what a review keeps of its match's recording.
 *
 * The recording itself goes once a review's work is done (recorder.js holds
 * it until then). What stays is a short clip of each moment the review looked
 * at, cut out of it by wall clock (webm.js cutClip) and kept beside the review
 * in the library (review-store.js), under a cap on the space every clip takes
 * together. Named for its moment, so a card names its own:
 *
 *   r<n>-clip.mkv   the death in round n of a Valorant match
 *   d<k>-clip.mkv   the player's k-th death in a League game
 *
 * WHICH SECONDS. From 11 before the death to 4 after it: the fight that led
 * to it, the death, and the first seconds after, which in Valorant is the
 * killer seen from the spectator camera. Every second of the recording opens
 * on a keyframe, and a clip starts on the one at or before its first second,
 * so it can open up to a second early.
 *
 * WHEN THE DEATH WAS. A look has no time of the death itself, only the frames
 * it looked at (death-frames.js), each stamped when it was captured:
 *   Riot's look      the last frame before Riot's death second, and how many
 *                    seconds before it (gap): the death is that frame's time
 *                    plus the gap. On the real Abyss match, read every nine
 *                    seconds or so, the four deaths came 1 to 5 seconds after
 *                    their frames, which a fixed two seconds gets wrong. Only
 *                    where the round clock picked the frame: one framed the
 *                    screen's way (a post plant death, no clocked frame before
 *                    it) has no gap, and is the screen's below
 *   the screen's     the frame before the death and the one the screen
 *                    registered it on: the death is at or before the second
 *   a frame alone    about two seconds after it, the margin the frame picker
 *                    keeps before a death
 *
 * AND NOT ONCE THE PLAYER CHOSE OFF (cutsClips), whatever the recorder still
 * holds of a match already played.
 *
 * Plain JavaScript, so main and the tests read the same numbers.
 */

// A clip's file name, and nothing else: no path, no other type.
const CLIP_RE = /^[rd]\d{1,3}-clip\.mkv$/;

const BEFORE_MS = 11000;
const AFTER_MS = 4000;
// The frame picker keeps two seconds between the frame and the death.
const LEAD_MS = 2000;
// A review keeps at most this many. A Valorant review looks at four deaths.
const MAX_CLIPS = 6;

// The space every clip may take, together, in GB: a choice in Settings.
const CAPS_GB = [5, 10, 20, 50];
const DEFAULT_CAP_GB = 10;
const GB = 1024 * 1024 * 1024;

// The type a clip is served as. Chromium names its H.264 recordings
// video/x-matroska, and canPlayType says nothing to avc1 in video/webm.
const MIME = 'video/x-matroska';

/** Round n's clip, or null for anything that is not a round number. */
function roundClip(n) {
  const k = Number(n);
  return Number.isInteger(k) && k > 0 && k < 1000 ? `r${k}-clip.mkv` : null;
}

/** The player's k-th death in a League game, counted from 1. */
function deathClip(k) {
  const i = Number(k);
  return Number.isInteger(i) && i > 0 && i < 1000 ? `d${i}-clip.mkv` : null;
}

/** The cap in GB, one of CAPS_GB, the default for anything else. */
function capGB(value) {
  const n = Number(value);
  return CAPS_GB.includes(n) ? n : DEFAULT_CAP_GB;
}

/** The seconds a clip of a death at `moment` (wall clock ms) covers. */
function windowOf(moment) {
  if (!Number.isFinite(moment)) return null;
  return { from: moment - BEFORE_MS, to: moment + AFTER_MS };
}

/**
 * When the death a look looked at happened, on the wall clock, from the frames
 * it was sent (see WHEN THE DEATH WAS). Null when the look has no time at all.
 *
 * @param look  { at, gap, frames: [{ at }, ...] } as death-frames.js looksFor
 *              gives it: `at` the first frame's capture, `gap` the seconds from
 *              it to Riot's death second, or null
 */
function momentOf(look) {
  if (!look || !Number.isFinite(look.at)) return null;
  if (Number.isFinite(look.gap) && look.gap >= 0) return look.at + look.gap * 1000;
  const second = Array.isArray(look.frames) ? look.frames[1] : null;
  if (second && Number.isFinite(second.at) && second.at >= look.at) return second.at;
  return look.at + LEAD_MS;
}

/**
 * Whether a clip may be cut now, by the config as main reads it (`prefs.get`).
 * Not once the player chose Off: a finished match's recording is held for up
 * to an hour (recorder.js), and Riot's look landing minutes after Off still
 * cut its clips and kept them beside the review. recorder.js lets go of what
 * it holds when it is told of Off (prefsChanged); this is the guard where it
 * was not. Auto turning itself off (two busy sessions in a week, which writes
 * recordingAutoOff) is not the player's choice, and the match it gave up in
 * keeps the clips of what was recorded before it did, as recorder.js keeps
 * that recording for them.
 */
function cutsClips(prefs) {
  const get = (key) => (prefs && typeof prefs.get === 'function' ? prefs.get(key) : null);
  return !(get('recordingMode') === 'off' && !get('recordingAutoOff'));
}

/**
 * At most `max` of a list, spread across it, in order: all of them when they
 * fit, else the first, the last and the rest evenly between, so a League game
 * of ten deaths has clips from its start, its middle and its end rather than
 * of its first six.
 */
function pickSpread(list, max) {
  const xs = Array.isArray(list) ? list : [];
  const k = Number.isInteger(max) && max > 0 ? max : MAX_CLIPS;
  if (xs.length <= k) return xs.slice();
  if (k === 1) return [xs[0]];
  const out = [];
  for (let i = 0; i < k; i++) {
    const x = xs[Math.round((i * (xs.length - 1)) / (k - 1))];
    if (!out.includes(x)) out.push(x);
  }
  return out;
}

module.exports = {
  CLIP_RE, BEFORE_MS, AFTER_MS, LEAD_MS, MAX_CLIPS, CAPS_GB, DEFAULT_CAP_GB, GB, MIME,
  roundClip, deathClip, capGB, windowOf, momentOf, cutsClips, pickSpread,
};
