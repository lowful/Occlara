'use strict';

/**
 * THE FRAMES OF A CLIP (8.3.1), for the coach's look at a death.
 *
 * A look used to see two frames the live read had captured, a second or more
 * apart, and on the real Sunset match every one of its four looks came back
 * unclear: none of the frames sent showed the fight. The match's recording
 * holds every frame of it, 32 a second, and the clip of each death is cut out
 * of it before the look is sent (review-clips.js). So the look takes its
 * frames from that clip instead, at the seconds around the death that show the fight
 * (shared/clips.js LOOK_AT), decoded in a page nobody sees
 * (src/renderer/frames), and only those stills go to the server: no clip and
 * no recording ever leaves the PC.
 *
 * WHAT IS IN A CLIP. cutClip (webm.js) writes a Segment of known size whose
 * Clusters each open on a keyframe that carries its own SPS and PPS, about one
 * a second, the frames as Chromium's MediaRecorder wrote them: H.264 in Annex
 * B, start codes and no length prefixes (ffprobe: is_avc false), in
 * SimpleBlocks with no lacing. So a decoder fed a Cluster's keyframe and the
 * frames after it needs nothing from before it, and a frame at second t is
 * decoded from the keyframe at or before t up to it, never the whole clip.
 *
 * WHICH FRAME IS "AT" A SECOND. The one on screen then: the last frame that
 * began at or before it. A second before the clip's first frame, or after its
 * last frame ended, is not in the clip, and has no frame rather than the
 * nearest one: that is another moment.
 *
 * Plain JavaScript on Buffers, so main builds the decoder's work from it and
 * the tests read the real fixture with it. The page only decodes what it is
 * handed.
 */

const ID = {
  EBML: 0x1A45DFA3, Segment: 0x18538067, Info: 0x1549A966, TimecodeScale: 0x2AD7B1,
  Tracks: 0x1654AE6B, TrackEntry: 0xAE, TrackNumber: 0xD7, TrackType: 0x83, CodecID: 0x86,
  Video: 0xE0, PixelWidth: 0xB0, PixelHeight: 0xBA,
  Cluster: 0x1F43B675, Timecode: 0xE7, SimpleBlock: 0xA3, BlockGroup: 0xA0, Block: 0xA1, ReferenceBlock: 0xFB,
};
const TICK_NS = 1000000;
// A frame lasts this long when nothing after it says how long: a frame at 30
// a second, as webm.js reckons a clip's last one.
const FALLBACK_FRAME_MS = 1000 / 30;

function vlen(first) {
  for (let len = 1, mask = 0x80; len <= 8; len++, mask >>= 1) if (first & mask) return len;
  return 0;
}

// An element's header at p: { id, size (null when unknown), data, end }, or
// null when no element can begin there.
function head(buf, p, limit) {
  if (p >= limit) return null;
  const il = vlen(buf[p]);
  if (!il || il > 4 || p + il >= limit) return null;
  const sl = vlen(buf[p + il]);
  if (!sl || p + il + sl > limit) return null;
  let id = 0;
  for (let i = 0; i < il; i++) id = id * 256 + buf[p + i];
  const top = 0xFF >> sl;
  let size = buf[p + il] & top;
  let unknown = size === top;
  for (let i = 1; i < sl; i++) {
    const b = buf[p + il + i];
    size = size * 256 + b;
    if (b !== 0xFF) unknown = false;
  }
  const data = p + il + sl;
  if (!unknown && data + size > limit) return null;
  return { id, size: unknown ? null : size, data, end: unknown ? null : data + size };
}

const uint = (buf, s, e) => { let v = 0; for (let i = s; i < e; i++) v = v * 256 + buf[i]; return v; };

/** The children of [s, e), each of known size; stops at the first that is not. */
function kids(buf, s, e) {
  const out = [];
  for (let p = s; p < e;) {
    const h = head(buf, p, e);
    if (!h || h.end === null) break;
    out.push(h);
    p = h.end;
  }
  return out;
}

function trackOf(buf, tracks) {
  for (const te of kids(buf, tracks.data, tracks.end)) {
    if (te.id !== ID.TrackEntry) continue;
    const t = { track: null, type: null, codecId: null, width: null, height: null };
    for (const k of kids(buf, te.data, te.end)) {
      if (k.id === ID.TrackNumber) t.track = uint(buf, k.data, k.end);
      else if (k.id === ID.TrackType) t.type = uint(buf, k.data, k.end);
      else if (k.id === ID.CodecID) t.codecId = buf.toString('latin1', k.data, k.end).replace(/\0+$/, '');
      else if (k.id === ID.Video) {
        for (const v of kids(buf, k.data, k.end)) {
          if (v.id === ID.PixelWidth) t.width = uint(buf, v.data, v.end);
          else if (v.id === ID.PixelHeight) t.height = uint(buf, v.data, v.end);
        }
      }
    }
    if (t.type === 1 && t.track > 0) return t;
  }
  return null;
}

// One block's frame: its track, its ticks after the Cluster's Timecode, and
// where its bytes are. Laced blocks are not what this producer writes.
function blockAt(buf, data, end) {
  const tl = vlen(buf[data]);
  if (!tl || data + tl + 3 > end) return null;
  let track = buf[data] & (0xFF >> tl);
  for (let i = 1; i < tl; i++) track = track * 256 + buf[data + i];
  const rel = buf.readInt16BE(data + tl);
  const flags = buf[data + tl + 2];
  if (flags & 0x06) return null;
  return { track, rel, flags, start: data + tl + 3, end };
}

/**
 * Every video frame of a clip, in order: { ms, key, start, end }, its time on
 * the clip's own timeline and where its bytes are in `buf`, beside the track's
 * codec, size and the length of the clip. Null when it is not a clip this app
 * cut (no EBML header, no video track, no frame).
 */
function indexClip(input) {
  const buf = Buffer.isBuffer(input) ? input : ArrayBuffer.isView(input) ? Buffer.from(input.buffer, input.byteOffset, input.byteLength) : null;
  if (!buf || buf.length < 8 || buf.readUInt32BE(0) !== ID.EBML) return null;
  const ebml = head(buf, 0, buf.length);
  if (!ebml || ebml.end === null) return null;
  const seg = head(buf, ebml.end, buf.length);
  if (!seg || seg.id !== ID.Segment) return null;
  const segEnd = seg.end === null ? buf.length : seg.end;
  let scale = TICK_NS;
  let track = null;
  const frames = [];
  for (let p = seg.data; p < segEnd;) {
    const h = head(buf, p, segEnd);
    if (!h) break;
    if (h.id === ID.Info && h.end !== null) {
      const ts = kids(buf, h.data, h.end).find((k) => k.id === ID.TimecodeScale);
      if (ts) scale = uint(buf, ts.data, ts.end) || TICK_NS;
    } else if (h.id === ID.Tracks && h.end !== null) {
      track = trackOf(buf, h);
    } else if (h.id === ID.Cluster) {
      const stop = h.end === null ? segEnd : h.end;
      let tc = 0;
      let q = h.data;
      while (q < stop) {
        const k = head(buf, q, stop);
        // A Cluster of unknown size (a recording as Chromium writes it) ends
        // where the next one begins.
        if (!k || k.end === null || k.id === ID.Cluster) break;
        if (k.id === ID.Timecode) tc = uint(buf, k.data, k.end);
        else if (k.id === ID.SimpleBlock || k.id === ID.BlockGroup) {
          let b = null;
          let key = false;
          if (k.id === ID.SimpleBlock) {
            b = blockAt(buf, k.data, k.end);
            key = !!b && (b.flags & 0x80) !== 0;
          } else {
            const inner = kids(buf, k.data, k.end);
            const blk = inner.find((x) => x.id === ID.Block);
            b = blk ? blockAt(buf, blk.data, blk.end) : null;
            // A Block in a group is a keyframe unless the group references another.
            key = !inner.some((x) => x.id === ID.ReferenceBlock);
          }
          if (b && track && b.track === track.track) {
            frames.push({ ms: ((tc + b.rel) * scale) / 1e6, key, start: b.start, end: b.end });
          }
        }
        q = k.end;
      }
      if (q <= h.data) break;
      p = h.end === null ? q : stop;
      continue;
    }
    if (h.end === null) break;
    p = h.end;
  }
  if (!track || !frames.length) return null;
  frames.sort((a, b) => a.ms - b.ms);
  const span = frames[frames.length - 1].ms - frames[0].ms;
  const step = frames.length > 1 && span > 0 ? span / (frames.length - 1) : FALLBACK_FRAME_MS;
  const firstKey = frames.find((f) => f.key);
  return {
    buf,
    codecId: track.codecId,
    width: track.width,
    height: track.height,
    codec: firstKey ? codecOf(buf.subarray(firstKey.start, firstKey.end)) : null,
    frames,
    // Where the last frame stops being on screen.
    endMs: frames[frames.length - 1].ms + step,
  };
}

/**
 * The WebCodecs name of an H.264 stream, avc1.PPCCLL, from the SPS its
 * keyframe carries: profile, constraint flags and level, as ffprobe names the
 * recordings (avc1.42c028, Constrained Baseline at level 4.0). Annex B (start
 * codes) or length prefixed, whichever the frame is. Null without an SPS.
 */
function codecOf(frame) {
  const b = frame;
  const hex = (x) => x.toString(16).padStart(2, '0');
  const sps = (i) => (i + 3 < b.length ? `avc1.${hex(b[i + 1])}${hex(b[i + 2])}${hex(b[i + 3])}` : null);
  const annexB = b.length > 4 && b[0] === 0 && b[1] === 0 && (b[2] === 1 || (b[2] === 0 && b[3] === 1));
  if (annexB) {
    for (let i = 0; i + 3 < b.length; i++) {
      if (b[i] === 0 && b[i + 1] === 0 && b[i + 2] === 1 && (b[i + 3] & 0x1F) === 7) return sps(i + 3);
    }
    return null;
  }
  for (let p = 0; p + 4 < b.length;) {
    const n = b.readUInt32BE(p);
    if (!n || p + 4 + n > b.length) return null;
    if ((b[p + 4] & 0x1F) === 7) return sps(p + 4);
    p += 4 + n;
  }
  return null;
}

/**
 * Which frames to decode for frames at `times` (ms on the clip's timeline), and
 * which of them each time is: for each, the frame on screen then and the
 * keyframe at or before it, and the frames from that keyframe to it decoded in
 * one run. Times sharing a run decode it once.
 *
 *   { runs: [{ from, to }], picks: [{ t, frame }] }   indexes into clip.frames;
 *                                                      frame null when t is
 *                                                      not in the clip
 */
function planFrames(clip, times) {
  const fs = clip && Array.isArray(clip.frames) ? clip.frames : [];
  const picks = (Array.isArray(times) ? times : []).map((t) => {
    if (!Number.isFinite(t) || !fs.length || t < fs[0].ms || t >= clip.endMs) return { t, frame: null };
    let i = 0;
    while (i + 1 < fs.length && fs[i + 1].ms <= t) i += 1;
    return { t, frame: i };
  });
  const runs = [];
  for (const p of picks.filter((x) => x.frame !== null).sort((a, b) => a.frame - b.frame)) {
    let k = p.frame;
    while (k > 0 && !fs[k].key) k -= 1;
    if (!fs[k].key) { p.frame = null; continue; }
    const last = runs[runs.length - 1];
    if (last && k <= last.to) last.to = Math.max(last.to, p.frame);
    else runs.push({ from: k, to: p.frame });
  }
  return { runs, picks };
}

/**
 * The page's work for frames at `times` (ms on the clip's timeline): the
 * codec, the size and every frame to decode with its timestamp in
 * microseconds, as VideoDecoder takes them, and for each time the timestamp of
 * the frame it is, or null. Each run opens on its keyframe, so the runs feed
 * one decoder back to back. Null when the clip cannot be decoded at all.
 */
function decodeJob(clip, times) {
  if (!clip || !clip.codec || !clip.width || !clip.height) return null;
  const { runs, picks } = planFrames(clip, times);
  const us = (ms) => Math.round(ms * 1000);
  const chunks = [];
  for (const r of runs) {
    for (let i = r.from; i <= r.to; i++) {
      const f = clip.frames[i];
      chunks.push({ ts: us(f.ms), key: !!f.key, data: clip.buf.subarray(f.start, f.end) });
    }
  }
  return {
    codec: clip.codec,
    width: clip.width,
    height: clip.height,
    chunks,
    picks: picks.map((p) => (p.frame === null ? null : us(clip.frames[p.frame].ms))),
  };
}

module.exports = { indexClip, codecOf, planFrames, decodeJob, FALLBACK_FRAME_MS };
