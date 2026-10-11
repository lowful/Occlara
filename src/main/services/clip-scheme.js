'use strict';

/**
 * occlara-clip://review/<id>/<name>: a clip kept beside a review, played by
 * the review page's <video> (8.3).
 *
 * WHY A SCHEME OF ITS OWN. A <video> seeks by asking for byte ranges, and a
 * page has no other way to reach a file under userData that can answer one:
 * file:// is the app's own code and nothing else, and a data URL or a blob
 * puts the whole clip in the page and through IPC on every paint. So main
 * serves the clip itself, a range at a time, from the one place clips live.
 *
 * WHAT IT SERVES, AND NOTHING ELSE. A file with a clip's name (clips.js
 * CLIP_RE) in a review's own folder (review-store.js clipFile resolves it,
 * under userData/reviews). Another host, a path of more or fewer parts, any
 * other name, a method other than GET or HEAD, or a file not there is a 404
 * with no body: the scheme says nothing about what is on disk.
 *
 * RANGES BY HAND. Chromium's media stack asks for "bytes=0-" first and then
 * for wherever a seek lands. Each is answered 206 with its Content-Range,
 * Accept-Ranges, and the clip's type, video/x-matroska (an H.264 clip typed
 * video/webm is one canPlayType refuses). A range past the end is 416 with
 * the size, as HTTP says; a Range this does not read (another unit, several
 * ranges, an end before its start) is ignored, as HTTP allows, and the whole
 * clip is a 200.
 *
 * Registered privileged before the app is ready (standard, so the URL has a
 * host and a path; secure; stream, which a <video> needs to play from it) and
 * handled once it is, in index.js. Otherwise plain Node: the handler takes a
 * Request and returns a Response, so scripts/test-clips.js drives it as is.
 */

const fs = require('fs');
const clips = require('../../shared/clips');

const SCHEME = 'occlara-clip';
const HOST = 'review';
const PRIVILEGED = { scheme: SCHEME, privileges: { standard: true, secure: true, stream: true } };

/** The URL a review page plays one clip by. */
function urlFor(id, name) {
  return `${SCHEME}://${HOST}/${id}/${name}`;
}

/**
 * The review id and clip name a URL names, or null for anything else. The
 * id is only split off here; the store decides whether it is one.
 */
function parse(url) {
  let u;
  try { u = new URL(String(url)); } catch { return null; }
  if (u.protocol !== `${SCHEME}:` || u.hostname !== HOST || u.port || u.username || u.password || u.search || u.hash) return null;
  const parts = u.pathname.split('/');
  if (parts.length !== 3 || parts[0] !== '' || !parts[1] || !clips.CLIP_RE.test(parts[2])) return null;
  return { id: parts[1], name: parts[2] };
}

/**
 * A Range header against a file of `size` bytes:
 *   null              no header: the whole file
 *   { start, end }    one range, inclusive, clamped to the file
 *   'unsatisfiable'   a range that starts past the end (416)
 *   'ignore'          a header this does not read: the whole file, as HTTP allows
 */
function rangeOf(header, size) {
  if (header === null || header === undefined || header === '') return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(String(header).trim());
  if (!m || (m[1] === '' && m[2] === '')) return 'ignore';
  if (m[1] === '') {
    // The last n bytes.
    const n = Number(m[2]);
    if (!(n > 0) || !(size > 0)) return 'unsatisfiable';
    return { start: Math.max(0, size - n), end: size - 1 };
  }
  const start = Number(m[1]);
  if (m[2] !== '' && Number(m[2]) < start) return 'ignore';
  if (!(start < size)) return 'unsatisfiable';
  return { start, end: m[2] === '' ? size - 1 : Math.min(Number(m[2]), size - 1) };
}

const nothing = (status) => new Response(null, { status });

/** `length` bytes of a file from `start`, read whole: a clip is a few MB. */
async function readSlice(fsp, file, start, length) {
  const fh = await fsp.open(file, 'r');
  try {
    const buf = Buffer.alloc(length);
    let got = 0;
    while (got < length) {
      const { bytesRead } = await fh.read(buf, got, length - got, start + got);
      if (!bytesRead) break;
      got += bytesRead;
    }
    return got === length ? buf : buf.subarray(0, got);
  } finally {
    await fh.close();
  }
}

/**
 * The scheme's handler.
 *
 * @param opts.fileOf  (id, name) => the clip's path, or null when it is not
 *                     one (review-store.js clipFile)
 * @param opts.fs      fs.promises, for the tests to hand in their own
 */
function createHandler(opts) {
  const fileOf = opts && opts.fileOf;
  const fsp = (opts && opts.fs) || fs.promises;
  return async function handle(request) {
    const method = String((request && request.method) || 'GET').toUpperCase();
    if (method !== 'GET' && method !== 'HEAD') return nothing(405);
    const where = parse(request && request.url);
    let file = null;
    try { file = where && typeof fileOf === 'function' ? fileOf(where.id, where.name) : null; } catch { file = null; }
    if (!file) return nothing(404);
    let st;
    try { st = await fsp.stat(file); } catch { return nothing(404); }
    if (!st.isFile()) return nothing(404);
    const size = st.size;
    const asked = request.headers && typeof request.headers.get === 'function' ? request.headers.get('range') : null;
    const r = rangeOf(asked, size);
    // No cache: a clip cleared for space, or a newer look's clip under the
    // same name, is read again rather than played from memory.
    const base = { 'Content-Type': clips.MIME, 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-store' };
    if (r === 'unsatisfiable') {
      return new Response(null, { status: 416, headers: { ...base, 'Content-Range': `bytes */${size}` } });
    }
    const part = r && typeof r === 'object' ? r : null;
    const start = part ? part.start : 0;
    const length = part ? part.end - part.start + 1 : size;
    const headers = { ...base, 'Content-Length': String(length) };
    if (part) headers['Content-Range'] = `bytes ${part.start}-${part.end}/${size}`;
    const status = part ? 206 : 200;
    if (method === 'HEAD' || !length) return new Response(null, { status, headers });
    let body;
    try { body = await readSlice(fsp, file, start, length); } catch { return nothing(404); }
    if (body.length !== length) return nothing(404);
    return new Response(body, { status, headers });
  };
}

module.exports = { SCHEME, HOST, PRIVILEGED, urlFor, parse, rangeOf, createHandler };
