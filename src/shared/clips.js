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
 * AND NO EARLIER THAN ITS ROUND (8.4.1). The player's Fracture round 6 death
 * came 3 s after the barriers dropped, and its clip spent its first 8 of 15 s
 * in the buy phase: the spawn, the scoreboard, the round before's combat
 * report. Where the round's barriers dropping is known (the look's `drop`,
 * death-frames.js barrierDrop), a clip starts no earlier than a second before
 * them, and never after the first still its look takes from it (LOOK_AT), so
 * every still stays inside the clip (lookWindow).
 *
 * WHEN THE DEATH WAS. Riot's look carries it (8.3.1, `moment`): its round's
 * barriers dropping, read off every clocked frame of the round, plus Riot's
 * own milliseconds (death-frames.js deathMoment). On the real Sunset match,
 * with Riot's seconds alone, that put each death within 0.6 s of where its
 * clip shows it; the rule before put round 2's 2.65 s late and round 6's
 * 1.15 s early. A look without it has only the frames it looked at, each
 * stamped when it was captured:
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
 * THE STILLS A LOOK TAKES FROM ITS CLIP (8.3.1, LOOK_AT), in seconds from that
 * moment, chosen on the real Sunset match's four clips. Riot's: 3 s before (where
 * the player stood, the health, the weapon, who was near), 1.5 s (the
 * approach), 0.7 and 0.3 s (the fight: round 3's two enemies at the end of the
 * street are on screen from 0.7 s before), and 0.7 s after, the death screen,
 * KILLED BY and the combat report of damage dealt and taken. Later than about
 * 1 s after, the frames are the player's own map, a ping wheel, black, then a
 * teammate's camera. The screen's moment is the frame that registered the
 * death, which on that match came 0.7 to 2.7 s after it, so its stills reach
 * further back: 4.5, 3, 2 and 1 s before it and that moment itself.
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
// A clip of an early death opens this long before its round's barriers drop.
const DROP_LEAD_MS = 1000;
// The frame picker keeps two seconds between the frame and the death.
const LEAD_MS = 2000;
// A review keeps at most this many. A Valorant review looks at four deaths.
const MAX_CLIPS = 6;

// The seconds from the death a look's stills are taken at (see THE STILLS A
// LOOK TAKES), in time order: Riot's moment, and the screen's.
const LOOK_AT = Object.freeze({
  riot: Object.freeze([-3, -1.5, -0.7, -0.3, 0.7]),
  screen: Object.freeze([-4.5, -3, -2, -1, 0]),
});

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

/**
 * The seconds a clip of a death at `moment` (wall clock ms) covers. With its
 * round's barriers dropping at `drop` (wall clock ms), from no earlier than a
 * second before them, and never after the first still taken from the clip
 * (`firstStill`, seconds from the moment; the earliest either look takes when
 * none is given). A drop after the death is no drop of its round.
 */
function windowOf(moment, drop, firstStill) {
  if (!Number.isFinite(moment)) return null;
  let from = moment - BEFORE_MS;
  if (Number.isFinite(drop) && drop <= moment) {
    const still = moment + (Number.isFinite(firstStill) ? firstStill : Math.min(LOOK_AT.riot[0], LOOK_AT.screen[0])) * 1000;
    from = Math.max(from, Math.min(drop - DROP_LEAD_MS, still));
  }
  return { from, to: moment + AFTER_MS };
}

/**
 * The seconds a look's clip covers: around its moment (momentOf), from its
 * round's barriers where it knows them (`drop`), holding its own first still:
 * Riot's look takes them around Riot's moment (`moment`), the screen's around
 * its read of the death (stillsMomentOf).
 */
function lookWindow(look) {
  const first = look && Number.isFinite(look.moment) ? LOOK_AT.riot[0] : LOOK_AT.screen[0];
  return windowOf(momentOf(look), look ? look.drop : null, first);
}

/**
 * When the death a look looked at happened, on the wall clock (see WHEN THE
 * DEATH WAS). Null when the look has no time at all.
 *
 * @param look  { moment, at, gap, frames: [{ at }, ...] } as death-frames.js
 *              looksFor gives it: `moment` Riot's death off its round's clock,
 *              when there is one; `at` the first frame's capture, `gap` the
 *              seconds from it to Riot's death second, or null
 */
function momentOf(look) {
  if (look && Number.isFinite(look.moment)) return look.moment;
  if (!look || !Number.isFinite(look.at)) return null;
  if (Number.isFinite(look.gap) && look.gap >= 0) return look.at + look.gap * 1000;
  const second = Array.isArray(look.frames) ? look.frames[1] : null;
  if (second && Number.isFinite(second.at) && second.at >= look.at) return second.at;
  return look.at + LEAD_MS;
}

/**
 * The moment a look's stills are taken around (8.3.1, LOOK_AT), or null for
 * none. The screen's look takes them around its read of the death, and the
 * server is told that is what their seconds count from. Riot's look takes
 * them only around Riot's own death on the wall clock (`moment`, deathMoment),
 * because the server is told their seconds are from Riot's death, good to a
 * few tenths. A moment from the rule before it (a frame's clock read to the
 * second, or the frame that registered the death) can be two seconds and
 * more out, enough to put the death screen in the still called 0.3 s before
 * it. Without Riot's moment the look is sent the read's own frames, with the
 * words they always had.
 */
function stillsMomentOf(look, source) {
  if (source === 'screen') return momentOf(look);
  return look && Number.isFinite(look.moment) ? look.moment : null;
}

/**
 * WHERE A MOMENT FALLS IN ITS CLIP (8.4.4), in ms on the clip's own timeline:
 * the moment on the wall clock less where the clip's own 0 is on it
 * (recorder.cutClip's startWall), to the ms. The clip's player marks the death
 * there. Null when either is unknown, and the player then marks nothing,
 * rather than a death placed by a guess.
 */
function deathInClip(moment, startWall) {
  return Number.isFinite(moment) && Number.isFinite(startWall) ? Math.round(moment - startWall) : null;
}

/**
 * The name a look's still from the recording is kept under, beside the review
 * (8.3.1): round n's k-th of them in time order, before or after the death,
 * r6-rec1-before.jpg to r6-rec5-after.jpg. The read frames keep their names,
 * r6-before.jpg and r6-after.jpg, and a page that reads no seconds labels each
 * by the word in its name.
 */
function stillName(n, k, at) {
  const r = Number(n);
  const i = Number(k);
  if (!Number.isInteger(r) || r < 1 || r > 999 || !Number.isInteger(i) || i < 1 || i > 9 || !Number.isFinite(at)) return null;
  return `r${r}-rec${i}-${at < 0 ? 'before' : 'after'}.jpg`;
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
  CLIP_RE, BEFORE_MS, AFTER_MS, LEAD_MS, DROP_LEAD_MS, MAX_CLIPS, CAPS_GB, DEFAULT_CAP_GB, GB, MIME, LOOK_AT,
  roundClip, deathClip, capGB, windowOf, lookWindow, momentOf, stillsMomentOf, deathInClip, stillName, cutsClips, pickSpread,
};
