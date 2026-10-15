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
const clipFrames = require('../../shared/clip-frames');

const nextTurn = () => new Promise((resolve) => setImmediate(resolve));

/**
 * Cut and keep a clip of each moment, in the order given, `max` at most.
 *
 *   looks    [{ key, name, moment, window? }]: what the clip is of (a round
 *            number, a death), the name it is kept under, when the death was
 *            (ms), and the seconds to cut when the look knows them better than
 *            its moment does (clips.lookWindow, 8.4.1)
 *   cut      (from, to, at) => { bytes, startWall } | null   recorder.cutClip
 *   save     (name, bytes) => true once kept       review-store.js saveClip
 *   stopped  () => true when the review was withdrawn meanwhile
 *
 * Resolves with { kept: [{ key, name, bytes, from, to, startWall, moment }],
 * tried, missed }: missed is how many moments the recording did not hold
 * (paused, given up, started after it, or off), startWall where each clip's
 * own 0 is on the wall clock, for the stills the look takes from it (8.3.1),
 * and moment the one it was cut around, for its player's death (8.4.4).
 */
async function cutClips(opts) {
  const o = opts || {};
  const max = Number.isInteger(o.max) && o.max > 0 ? Math.min(o.max, clips.MAX_CLIPS) : clips.MAX_CLIPS;
  const out = { kept: [], tried: 0, missed: 0 };
  const turn = typeof o.yieldTo === 'function' ? o.yieldTo : nextTurn;
  for (const look of Array.isArray(o.looks) ? o.looks : []) {
    if (out.kept.length >= max) break;
    if (typeof o.stopped === 'function' && o.stopped()) break;
    // The look's own window where it has one (clips.lookWindow: an early
    // death's clip starts at its round), else the moment's.
    const w = look ? (look.window && Number.isFinite(look.window.from) && Number.isFinite(look.window.to)
      ? look.window : clips.windowOf(look.moment)) : null;
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
        startWall: Number.isFinite(got.startWall) ? got.startWall : null,
        moment: Number.isFinite(look.moment) ? look.moment : null });
    }
    await turn();
  }
  return out;
}

/**
 * THE DEATH'S PLACE IN A LOOK'S CLIP (8.4.4), in ms on the clip's own
 * timeline, kept on the card beside the clip's name (`clipDeath`) for its
 * player: the moment the look's frames are timed against, and only where they
 * are. A look whose frames carry their seconds from the death (frameAt) took
 * them around Riot's own death on the wall clock, or a look from the screen
 * around its read of it (clips.stillsMomentOf), and the stills and the clip
 * then count from the same moment. A look whose frames carry no seconds was
 * timed by a clock read to the second (clips.momentOf), so its clip marks
 * nothing rather than a death placed by a guess.
 *
 * @param look       the look as main keeps it: { moment, frameAt, ... }
 * @param startWall  where the clip's own 0 is on the wall clock
 */
function lookDeathInClip(look, startWall) {
  const at = look && Array.isArray(look.frameAt) ? look.frameAt : [];
  const timed = at.length > 0 && at.every((x) => typeof x === 'number' && Number.isFinite(x));
  return timed ? clips.deathInClip(look.moment, startWall) : null;
}

/*
 * A CLIP'S FRAMES FOR ITS PLAYER (8.4.4): each frame's time on the clip's own
 * timeline, read off its blocks by clip-frames.js indexClip, the same reading
 * the look's stills were decoded by, and where its last frame stops being on
 * screen. The page steps a frame to the next one's own time with them, never
 * by a guessed frame rate: a clip recorded before 8.4.2 runs at up to about 57
 * a second, or unevenly.
 *
 * READ ONCE A FILE, by its path, its size and when it was written: a newer
 * look's clip kept under the same name is read again, and a clip shown again
 * is not. The last MAX_FRAME_FILES are kept, a review's six at a time.
 */
const MAX_FRAME_FILES = 48;

function createFrameTimes(opts) {
  const fsx = (opts && opts.fs) || require('fs');
  const max = opts && Number.isInteger(opts.max) && opts.max > 0 ? opts.max : MAX_FRAME_FILES;
  const kept = new Map();
  const frameTimes = (file) => {
    if (typeof file !== 'string' || !file) return null;
    let st = null;
    try { st = fsx.statSync(file); } catch { return null; }
    if (!st || !st.isFile()) return null;
    const key = `${file}|${st.size}|${st.mtimeMs}`;
    if (kept.has(key)) {
      const hit = kept.get(key);
      kept.delete(key);
      kept.set(key, hit);
      return hit;
    }
    let clip = null;
    try { clip = clipFrames.indexClip(fsx.readFileSync(file)); } catch { clip = null; }
    const out = clip && clip.frames.length
      ? { times: clip.frames.map((f) => Math.round(f.ms * 1000) / 1000), end: Math.round(clip.endMs * 1000) / 1000 }
      : null;
    for (const k of [...kept.keys()]) if (k.startsWith(`${file}|`)) kept.delete(k);
    kept.set(key, out);
    while (kept.size > max) kept.delete(kept.keys().next().value);
    return out;
  };
  frameTimes.size = () => kept.size;
  return frameTimes;
}

/** Main's own reader of clips' frames, shared by every review it presents. */
const frameTimes = createFrameTimes();

/** A death's place in its clip when it falls inside it, by its frames where they were read; else null. */
function placedIn(death, frames) {
  if (typeof death !== 'number' || !Number.isFinite(death) || death < 0) return null;
  return frames && Number.isFinite(frames.end) && death > frames.end ? null : death;
}

/**
 * The review as a page is shown it: each clip a card names is played from
 * its URL while it is on disk, and said to be cleared once it is not, if the
 * review was told why (review.clipsCleared); a clip simply missing (a review
 * restored without its clips) is left out and its frames show as before.
 * Valorant's looks are on rounds[].forensics, League's deaths on deathList.
 *
 * And for its player (8.4.4): the clip's frames (clipFrames, { times, end },
 * io.frames), and the death's place in it (clipDeath, kept on the card when
 * the clip was cut), left null when it falls outside the clip.
 *
 * @param io.has     (name) => whether that clip of this review is on disk
 * @param io.url     (name) => the URL to play it by
 * @param io.frames  (name) => its frames, { times, end }, or null; optional
 * Returns a copy; the review handed in is never changed.
 */
function presentClips(review, io) {
  if (!review || typeof review !== 'object' || !io) return review;
  const why = review.clipsCleared && review.clipsCleared.reason === 'space' ? 'space'
    : review.clipsCleared ? 'cleared' : null;
  const about = (name, death) => {
    if (typeof name !== 'string' || !clips.CLIP_RE.test(name)) return null;
    if (io.has(name)) {
      let frames = null;
      try { frames = typeof io.frames === 'function' ? io.frames(name) : null; } catch { frames = null; }
      const good = frames && Array.isArray(frames.times) && frames.times.length ? frames : null;
      return { clipUrl: io.url(name), ...(good ? { clipFrames: good } : {}), clipDeath: placedIn(death, good) };
    }
    return why ? { clipGone: why } : null;
  };
  let out = review;
  if (Array.isArray(review.rounds) && review.rounds.some((c) => c && c.forensics && c.forensics.clip)) {
    out = { ...out, rounds: review.rounds.map((c) => {
      const extra = c && c.forensics ? about(c.forensics.clip, c.forensics.clipDeath) : null;
      return extra ? { ...c, forensics: { ...c.forensics, ...extra } } : c;
    }) };
  }
  if (Array.isArray(review.deathList) && review.deathList.some((d) => d && d.clip)) {
    out = { ...out, deathList: review.deathList.map((d) => {
      const extra = d ? about(d.clip, d.clipDeath) : null;
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

module.exports = { cutClips, presentClips, namedClips, lookDeathInClip, createFrameTimes, frameTimes, MAX_FRAME_FILES };
