'use strict';

/**
 * A KEPT CLIP'S POSTER (Orbit's Clips page, 28 Nov 2026): one real still of
 * the clip, made ONCE by the bundled ffmpeg (import-video.js ffmpegPath, the
 * file the recorder, the clips and the importer use) and kept beside the clip
 * (review-store.js savePoster, <clip>-poster.jpg), so the Clips page shows a
 * frame of the moment instead of the map. Asked for the first time a clip is
 * shown without one; a poster is never drawn, guessed or taken from another
 * clip, and a clip with none yet shows the map's art until it lands.
 *
 * Small and quiet: 480 wide, one JPEG at quality 5, one ffmpeg at a time, a
 * clip that failed is not tried again this session, and NOTHING RUNS WHILE A
 * MATCH IS RECORDED OR THE WINDOW IS SEALED (`busy`), so it never competes
 * with the game or the recorder. The poster goes with its clip (the cap, Clear
 * clips, a look that keeps other clips: review-store.js removeClipFile) and is
 * never counted against the cap (a few KB beside a clip's MB).
 *
 *   const posters = createPosters({ store, ffmpeg, busy, made });
 *   posters.dataUrl(id, name)      // 'data:image/jpeg;base64,...' or null
 *   posters.want(id, name, atSec)  // make it later if it is missing
 */
const { spawn } = require('child_process');

const WIDTH = 480;
const TIMEOUT_MS = 15000;
const MAX_BYTES = 400 * 1024;

function createPosters(deps) {
  const d = deps || {};
  const queue = [];
  const queued = new Set();
  const failed = new Set();
  let running = false;
  let madeAny = false;

  /** The poster as a data URL while it and its clip are on disk, or null. */
  function dataUrl(id, name) {
    const b64 = d.store && typeof d.store.poster === 'function' ? d.store.poster(id, name) : null;
    return b64 ? `data:image/jpeg;base64,${b64}` : null;
  }

  /** One still at `atSec` of the clip, as JPEG bytes, or null. */
  function grab(file, atSec) {
    return new Promise((resolve) => {
      if (!d.ffmpeg || !file) { resolve(null); return; }
      const at = Math.max(0, Number(atSec) || 0).toFixed(2);
      let child;
      try {
        child = spawn(d.ffmpeg, ['-hide_banner', '-loglevel', 'error', '-ss', at, '-i', file, '-frames:v', '1',
          '-vf', `scale=${WIDTH}:-2`, '-q:v', '5', '-f', 'image2', '-vcodec', 'mjpeg', 'pipe:1'], { windowsHide: true });
      } catch { resolve(null); return; }
      const parts = [];
      let size = 0;
      const timer = setTimeout(() => { try { child.kill(); } catch {} }, TIMEOUT_MS);
      child.stdout.on('data', (b) => { size += b.length; if (size <= MAX_BYTES) parts.push(b); });
      child.on('error', () => { clearTimeout(timer); resolve(null); });
      child.on('close', (code) => {
        clearTimeout(timer);
        const bytes = Buffer.concat(parts);
        // A JPEG starts FF D8; anything else, or too much, is no poster.
        resolve(code === 0 && size <= MAX_BYTES && bytes.length > 2 && bytes[0] === 0xff && bytes[1] === 0xd8 ? bytes : null);
      });
    });
  }

  async function next() {
    if (running) return;
    const job = queue.shift();
    if (!job) {
      if (madeAny && typeof d.made === 'function') { madeAny = false; try { d.made(); } catch {} }
      return;
    }
    if (typeof d.busy === 'function' && d.busy()) {
      // Mid match: drop the queue; the page asks again after the match.
      queue.length = 0;
      queued.clear();
      return;
    }
    running = true;
    const key = `${job.id}/${job.name}`;
    try {
      const file = d.store.clipFile(job.id, job.name);
      const bytes = d.store.hasClip(job.id, job.name) ? await grab(file, job.at) : null;
      if (bytes && d.store.savePoster(job.id, job.name, bytes)) madeAny = true;
      else failed.add(key);
    } catch { failed.add(key); }
    queued.delete(key);
    running = false;
    next();
  }

  /** Make a clip's poster later, at atSec into it, when it has none and has not failed. */
  function want(id, name, atSec) {
    const key = `${id}/${name}`;
    if (queued.has(key) || failed.has(key) || !d.store || !d.ffmpeg) return;
    if (typeof d.busy === 'function' && d.busy()) return;
    if (dataUrl(id, name)) return;
    queued.add(key);
    queue.push({ id, name, at: atSec });
    setTimeout(next, 0);
  }

  return { dataUrl, want, state: () => ({ queued: queue.length, running, failed: failed.size }) };
}

module.exports = { createPosters, WIDTH };
