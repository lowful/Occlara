'use strict';

/**
 * THE STILLS A LOOK AT A DEATH TAKES FROM ITS CLIP (8.3.1).
 *
 * The clip is cut first (review-clips.js), then a few of its frames around the
 * death are decoded in a page nobody sees (src/renderer/frames, opened by
 * index.js) as JPEGs at the read's size and quality, kept beside the review as
 * its frames are, and sent to the look with their seconds from the death
 * instead of the two frames the live read took. Only stills ever leave the
 * PC: the clip and the recording stay on it.
 *
 * Plain Node: the decoder is handed in, so scripts/test-clips.js drives this
 * with a stand in and check:clips with the real page.
 */

const clipFrames = require('../../shared/clip-frames');

function toBuffer(x) {
  if (Buffer.isBuffer(x)) return x;
  if (ArrayBuffer.isView(x)) return Buffer.from(x.buffer, x.byteOffset, x.byteLength);
  if (Object.prototype.toString.call(x) === '[object ArrayBuffer]') return Buffer.from(x);
  return null;
}

/**
 * The stills of one clip at seconds from a death, in time order, only those
 * the clip holds: [{ at, jpeg }], `at` the seconds from the death of the frame
 * itself (the one on screen at that second, up to a frame earlier). [] when
 * the clip cannot be read or decoded.
 *
 *   bytes      the clip, as webm.js cutClip wrote it
 *   startWall  the wall clock (ms) of the clip's own 0 (recorder.cutClip)
 *   moment     the death on the wall clock (ms)
 *   offsets    the seconds from the death to take (clips.LOOK_AT)
 *   decode     (job) => Promise<{ ok, frames }>   frames-window.js handle.decode
 *   size       { width, height, quality }         the stills, JPEG quality 0 to 1
 */
async function stillsOf(o) {
  const opts = o || {};
  const clip = clipFrames.indexClip(toBuffer(opts.bytes));
  const offsets = Array.isArray(opts.offsets) ? opts.offsets.filter(Number.isFinite) : [];
  if (!clip || !offsets.length || !Number.isFinite(opts.startWall) || !Number.isFinite(opts.moment)) return [];
  const times = offsets.map((s) => opts.moment + s * 1000 - opts.startWall);
  const job = clipFrames.decodeJob(clip, times);
  if (!job || !job.chunks.length || typeof opts.decode !== 'function') return [];
  const size = opts.size || {};
  let r = null;
  try {
    r = await opts.decode({ ...job, outWidth: size.width || 1280, outHeight: size.height || 720, quality: size.quality || 0.7 });
  } catch { r = null; }
  if (!r || !r.ok || !Array.isArray(r.frames)) return [];
  const out = [];
  // To the hundredth, the same either side of the death.
  const secs = (ms) => (ms < 0 ? -1 : 1) * Math.round(Math.abs(ms) / 10) / 100;
  job.picks.forEach((ts, i) => {
    const jpeg = ts === null ? null : toBuffer(r.frames[i]);
    if (!jpeg || !jpeg.length) return;
    out.push({ at: secs(opts.startWall + ts / 1000 - opts.moment), jpeg });
  });
  // Two offsets that land on one frame (a clip of few frames a second) are one still.
  return out.filter((s, i) => !out.slice(0, i).some((p) => p.at === s.at));
}

/**
 * The order a look's frames are sent in: the last before the death and the
 * first after it, then the rest. A server from before 8.3.1 keeps a death's
 * first two frames and calls them the last before the death and the one just
 * after it, so sent in time order it would read 3 s and 1.5 s before as "just
 * after". The server since sorts them by their seconds again. Indexes into
 * `ats` (each frame's seconds from the death).
 *
 * WITH NOTHING AT OR AFTER THE MOMENT, THE LAST TWO BEFORE IT, in time order.
 * A look from the screen takes its last still at its read of the death, and
 * the frame on screen then is a frame early as often as not (-0.03 s on
 * check:clips): led by that one and the next in time, a server from before
 * read the frame of the read as "the last one before the screen read the
 * player as dead" and the 4.5 s still as "the first one where it did".
 */
function sendOrder(ats) {
  const xs = (Array.isArray(ats) ? ats : []).map((at, i) => ({ at, i })).filter((x) => Number.isFinite(x.at));
  const before = xs.filter((x) => x.at < 0).sort((a, b) => b.at - a.at);
  const after = xs.filter((x) => x.at >= 0).sort((a, b) => a.at - b.at);
  const lead = (after.length ? [before[0], after[0]] : [before[1], before[0]]).filter(Boolean);
  const rest = xs.filter((x) => !lead.includes(x)).sort((a, b) => a.at - b.at);
  return lead.concat(rest).map((x) => x.i);
}

module.exports = { stillsOf, sendOrder, toBuffer };
