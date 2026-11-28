'use strict';

/**
 * WHAT OCCLARA KEEPS ON THIS PC, AND THE ROOM LEFT (9.1, the owner's item 18:
 * "a bar showing how much space clips and recordings take, and what can be
 * cleared"). Counted off the disk each time it is asked, never kept:
 *
 *   clips       every clip kept beside a review (shared/clips.js CLIP_RE) and
 *               its poster (POSTER_RE), the files the cap counts and Clear
 *               clips takes
 *   recordings  the match recording's pages (userData/recording, recorder.js),
 *               held only until a match's clips are cut and swept at every
 *               quit, so never the player's to clear
 *   frames      the stills each review keeps beside it (its folder's other
 *               .jpg files) and the AI log's frames of the screen
 *               (userData/ai-log), which the log thins and prunes itself
 *   other       the reviews themselves and the logs' text
 *   total       the four together
 *   free        the space left on the drive the recordings are written to
 *
 * NEVER FOLLOWS A LINK. A junction or a symbolic link in any of these folders
 * is passed over, counted as nothing, so a link to another folder can never
 * make a folder look larger, or be walked into.
 *
 * Plain fs, no Electron: test:storage runs it against a temp folder.
 */

const fs = require('fs');
const path = require('path');
const { CLIP_RE, POSTER_RE } = require('../../shared/clips');

const ID_RE = /^[a-z]+-\d{10,}-[a-z0-9]{4,}$/;
const IMAGE_RE = /\.jpe?g$/i;

/** Every file under a folder, as [{ name, bytes, dir }], links passed over; [] for none. */
async function filesUnder(root, depth = 0) {
  const out = [];
  if (!root || depth > 6) return out;
  let entries = [];
  try { entries = await fs.promises.readdir(root, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    if (e.isSymbolicLink()) continue;
    const p = path.join(root, e.name);
    if (e.isDirectory()) {
      out.push(...await filesUnder(p, depth + 1));
    } else if (e.isFile()) {
      try {
        const st = await fs.promises.lstat(p);
        if (st.isFile()) out.push({ name: e.name, bytes: st.size, dir: root });
      } catch { /* gone as it was read */ }
    }
  }
  return out;
}

const sum = (xs) => xs.reduce((n, x) => n + x.bytes, 0);

/**
 * @param o.reviews    the review store's root (userData/reviews)
 * @param o.recording  the recorder's root (userData/recording)
 * @param o.aiLog      the AI log's root (userData/ai-log)
 * @param o.freeBytes  (dir) => bytes free on its drive, or null (recorder.js realFreeBytes)
 * @param o.driveOf    (dir) => 'C:' or null (pc-check.js driveOf)
 * @returns {Promise<{ clips: { bytes, count, matches }, recordings: { bytes, count },
 *   frames: { bytes, review, log }, other: { bytes }, total: number,
 *   free: { bytes, drive } }>}
 */
async function measure(o) {
  const opts = o || {};
  const reviewFiles = await filesUnder(opts.reviews);
  const clipFiles = reviewFiles.filter((f) => CLIP_RE.test(f.name) || POSTER_RE.test(f.name));
  const clipOwners = new Set(reviewFiles.filter((f) => CLIP_RE.test(f.name)).map((f) => path.basename(f.dir)).filter((d) => ID_RE.test(d)));
  const reviewFrames = reviewFiles.filter((f) => IMAGE_RE.test(f.name) && !POSTER_RE.test(f.name) && f.dir !== opts.reviews);
  const reviewOther = reviewFiles.filter((f) => !clipFiles.includes(f) && !reviewFrames.includes(f));

  const recFiles = await filesUnder(opts.recording);
  const recDirs = new Set(recFiles.map((f) => path.relative(opts.recording, f.dir).split(path.sep)[0]).filter(Boolean));

  const logFiles = await filesUnder(opts.aiLog);
  const logFrames = logFiles.filter((f) => IMAGE_RE.test(f.name));
  const logOther = logFiles.filter((f) => !IMAGE_RE.test(f.name));

  const clips = { bytes: sum(clipFiles), count: clipFiles.filter((f) => CLIP_RE.test(f.name)).length, matches: clipOwners.size };
  const recordings = { bytes: sum(recFiles), count: recDirs.size };
  const frames = { bytes: sum(reviewFrames) + sum(logFrames), review: sum(reviewFrames), log: sum(logFrames) };
  const other = { bytes: sum(reviewOther) + sum(logOther) };

  let free = null;
  const where = opts.recording || opts.reviews || null;
  try { free = typeof opts.freeBytes === 'function' && where ? opts.freeBytes(where) : null; } catch { free = null; }
  let drive = null;
  try { drive = typeof opts.driveOf === 'function' && where ? opts.driveOf(where) : null; } catch { drive = null; }

  return {
    clips, recordings, frames, other,
    total: clips.bytes + recordings.bytes + frames.bytes + other.bytes,
    free: { bytes: Number.isFinite(free) && free >= 0 ? free : null, drive: drive || null },
  };
}

/**
 * Whether `file` lies inside `root`, resolved, and is not `root` itself: the
 * test a path must pass before Explorer is opened on it.
 */
function inside(root, file) {
  if (!root || !file) return false;
  const rel = path.relative(path.resolve(root), path.resolve(file));
  return !!rel && !rel.startsWith('..') && !path.isAbsolute(rel);
}

module.exports = { measure, filesUnder, inside };
