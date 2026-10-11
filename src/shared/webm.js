'use strict';

/**
 * The match recording, read as it is written, and cut into clips that seek.
 *
 * WHAT CHROMIUM WRITES. MediaRecorder recording H.264 writes Matroska (DocType
 * matroska, video/x-matroska;codecs=avc1 once it has started) the way a live
 * stream is written: a Segment of unknown size, Clusters of unknown size, no
 * Cues, no Duration, no SeekHead, the init segment (the EBML header, the
 * Segment's header, Info and Tracks) once at the front. Measured by the 8.3
 * spike (scripts/spike-recorder.js) on this Electron: with
 * videoKeyFrameIntervalDuration 1000 every Cluster opens on a keyframe that
 * carries its own SPS and PPS, about one a second, so any Cluster can begin a
 * clip and a decoder needs nothing from before it.
 *
 * READ AS IT ARRIVES. The recorder hands over a chunk every second (the
 * timeslice), and a chunk is cut on a timer, not on a Cluster. Measured on
 * eight recordings in this Electron: MediaRecorder hands a chunk over on the
 * first byte the muxer writes once the timeslice is up, so every one of 100
 * chunks ended ONE BYTE INTO AN ELEMENT'S ID, 63 into the next Cluster's and 37
 * into a block's, never between two elements. A chunk is therefore never a
 * whole number of Clusters, and files cut where chunks end would split a
 * Cluster at every seam. createReader() is fed the chunks in order and holds
 * only what it cannot decide yet (a header cut in two, a block's first bytes,
 * Info or Tracks until they are whole), so the same clusters come out of the
 * whole file, of the chunks as they came, and of one byte at a time. A block's
 * frame data is passed over, never held: the reader counts frames, it does not
 * keep them, unless it is asked to keep each Cluster's bytes (keepBytes) for
 * whoever writes them to disk, whole Cluster by whole Cluster.
 *
 * AN UNKNOWN SIZE CLUSTER ENDS where an element that cannot be its child
 * begins (the next Cluster, as a rule) or where the stream ends. So a
 * Cluster's size is known only once the next one starts, and the last one's
 * only at end().
 *
 * WHAT IT FINDS. The init segment, every byte before the first Cluster, which
 * every clip begins with; and for each Cluster its offset in the stream, its
 * size, its Timecode in ms (the TimecodeScale applied), whether its first video
 * block is a keyframe, how many video frames it holds, and the times of its
 * first and latest frames.
 *
 * CUTTING. cutClip() takes the init segment and whole Clusters, from the last
 * one opening on a keyframe at or before the start through the one covering the
 * end, and writes them out again with their Timecodes rebased so the clip
 * starts at 0. The blocks are copied byte for byte. Around them it writes what a
 * live stream lacks and a player needs to seek: Info with a Duration, Cues (a
 * point at each keyframe Cluster), and a SeekHead, under a Segment and Clusters
 * of known size. Cut without them, the spike's clip played and seeked from a
 * blob but reported its duration as Infinity. The Cues sit before the Clusters,
 * as the spike measured them, so a player finds them reading from the front.
 * An H.264 clip is served as video/x-matroska (parseInit's mime): Chromium's
 * canPlayType answers "probably" to that and nothing to avc1 in video/webm.
 * From a blob it sniffs the container and plays either (check:webmplay saw
 * it), so whether a served type is held to that is the server's own check.
 *
 * REFUSED, NEVER THROWN. A recording is written by one producer, so anything it
 * would not write (no EBML header, a DocType that is not matroska or webm, an
 * element of unknown size that is not a Segment or a Cluster, an element that
 * runs past its parent, a block before its Cluster's Timecode, an absurd size)
 * stops the reader with `error` saying why, and cutClip() returns null for
 * anything it cannot cut. The Clusters read before the stream broke stay as
 * they were, so what was recorded up to there can still be cut.
 *
 * Plain JavaScript on Buffers, no Electron, so test-webm.js drives it directly.
 */

// Element IDs, as Matroska writes them down: an ID keeps its length marker
// bits, so its number's bytes are the ID's bytes.
const ID = {
  EBML: 0x1A45DFA3, DocType: 0x4282,
  Segment: 0x18538067, SeekHead: 0x114D9B74, Seek: 0x4DBB, SeekID: 0x53AB, SeekPosition: 0x53AC,
  Info: 0x1549A966, TimecodeScale: 0x2AD7B1, Duration: 0x4489,
  Tracks: 0x1654AE6B, TrackEntry: 0xAE, TrackNumber: 0xD7, TrackType: 0x83, CodecID: 0x86,
  Video: 0xE0, PixelWidth: 0xB0, PixelHeight: 0xBA,
  Cues: 0x1C53BB6B, CuePoint: 0xBB, CueTime: 0xB3, CueTrackPositions: 0xB7, CueTrack: 0xF7, CueClusterPosition: 0xF1,
  Cluster: 0x1F43B675, Timecode: 0xE7, SilentTracks: 0x5854, Position: 0xA7, PrevSize: 0xAB,
  SimpleBlock: 0xA3, BlockGroup: 0xA0, Block: 0xA1, ReferenceBlock: 0xFB, EncryptedBlock: 0xAF,
  Tags: 0x1254C367, Chapters: 0x1043A770, Attachments: 0x1941A469, Void: 0xEC, CRC32: 0xBF,
};
const NAME = {};
for (const [name, id] of Object.entries(ID)) NAME[id] = name;
const nameOf = (id) => NAME[id] || 'element 0x' + id.toString(16).toUpperCase();

// What a Segment may hold, and what a Cluster may. Anything else where one of
// these is expected is not this producer's stream.
const TOP = new Set([ID.SeekHead, ID.Info, ID.Tracks, ID.Cues, ID.Cluster, ID.Tags, ID.Chapters, ID.Attachments, ID.Void, ID.CRC32]);
const CLUSTER_CHILD = new Set([ID.Timecode, ID.SilentTracks, ID.Position, ID.PrevSize, ID.SimpleBlock, ID.BlockGroup, ID.EncryptedBlock, ID.Void, ID.CRC32]);
// What a clip keeps of a Cluster besides its new Timecode. Position and PrevSize
// describe the old file, and a CRC-32 would no longer match the new Timecode.
const CLIP_KEEPS = new Set([ID.SimpleBlock, ID.BlockGroup, ID.EncryptedBlock]);

const EBML_MAGIC = [0x1A, 0x45, 0xDF, 0xA3];
const MATROSKA_TICK_NS = 1000000;     // the default TimecodeScale: a tick of 1 ms
// Held whole to be read: the EBML header, Info and Tracks, a hundred bytes or
// so from Chromium. Past this size it is not one.
const MAX_META = 65536;
// Every byte before the first Cluster is held until it begins. A live stream
// puts it a few hundred bytes in.
const MAX_INIT = 1 << 20;
// A Cluster's child, or an element passed over: a 1080p keyframe is well under
// a megabyte. A size past this is a broken stream, and passing over it would
// swallow every Cluster after it without a word.
const MAX_ELEMENT = 64 * (1 << 20);
// A clip's last frame lasts this long when nothing after it says how long.
const FALLBACK_FRAME_MS = 1000 / 30;

const EMPTY = Buffer.alloc(0);

// ---------------------------------------------------------------------------
// EBML numbers
// ---------------------------------------------------------------------------

// A variable length integer is one to eight bytes; its length is the count of
// leading zero bits in its first byte, plus one. A first byte of 0 begins no
// valid number, so it reads as length 0.
function vintLength(first) {
  for (let len = 1, mask = 0x80; len <= 8; len++, mask >>= 1) if (first & mask) return len;
  return 0;
}

// An element's header at p: its ID (marker bits kept), its size (marker bits
// dropped; null when every value bit is set, which means unknown) and the
// header's length. Null when the bytes before `end` stop inside it; { bad }
// when no Matroska header can begin there.
function headerAt(buf, p, end) {
  if (p >= end) return null;
  const idLen = vintLength(buf[p]);
  if (idLen === 0 || idLen > 4) return { bad: 'an element ID that is not 1 to 4 bytes long' };
  if (p + idLen >= end) return null;
  const sizeLen = vintLength(buf[p + idLen]);
  if (sizeLen === 0) return { bad: 'an element size that is not 1 to 8 bytes long' };
  if (p + idLen + sizeLen > end) return null;
  let id = 0;
  for (let i = 0; i < idLen; i++) id = id * 256 + buf[p + i];
  const top = 0xFF >> sizeLen;
  let size = buf[p + idLen] & top;
  let unknown = size === top;
  for (let i = 1; i < sizeLen; i++) {
    const b = buf[p + idLen + i];
    size = size * 256 + b;
    if (b !== 0xFF) unknown = false;
  }
  return { id, size: unknown ? null : size, headerLen: idLen + sizeLen };
}

// The children of a whole element held in buf, every one of known size and
// inside it. Null when they are not.
function children(buf, start, end) {
  const out = [];
  for (let p = start; p < end;) {
    const h = headerAt(buf, p, end);
    if (!h || h.bad || h.size === null || p + h.headerLen + h.size > end) return null;
    out.push({ id: h.id, start: p, dataStart: p + h.headerLen, end: p + h.headerLen + h.size });
    p += h.headerLen + h.size;
  }
  return out;
}

function uint(buf, s, e) {
  if (e - s > 8) return null;
  let v = 0;
  for (let i = s; i < e; i++) v = v * 256 + buf[i];
  return v;
}

function text(buf, s, e) {
  let end = s;
  while (end < e && buf[end] !== 0) end += 1;
  return buf.toString('latin1', s, end);
}

// A track number in a block, read as a size is (marker bits dropped).
function vintValue(buf, p, len) {
  let v = buf[p] & (0xFF >> len);
  for (let i = 1; i < len; i++) v = v * 256 + buf[p + i];
  return v;
}

// Bytes in, whatever kind: a Buffer, a Uint8Array or any other view, or an
// ArrayBuffer (from another realm too, as IPC hands them over). Null for
// anything else.
function asBuffer(x) {
  if (Buffer.isBuffer(x)) return x;
  if (ArrayBuffer.isView(x)) return Buffer.from(x.buffer, x.byteOffset, x.byteLength);
  if (Object.prototype.toString.call(x) === '[object ArrayBuffer]') return Buffer.from(x);
  return null;
}

// ---------------------------------------------------------------------------
// Info and Tracks, read whole
// ---------------------------------------------------------------------------

// Each returns what it read, or a string saying why it could not.
function readInfo(buf, s, e) {
  const kids = children(buf, s, e);
  if (!kids) return 'an Info whose children do not fit inside it';
  const out = { timecodeScale: MATROSKA_TICK_NS, kids };
  const scale = kids.find((k) => k.id === ID.TimecodeScale);
  if (scale) {
    out.timecodeScale = uint(buf, scale.dataStart, scale.end);
    if (!(out.timecodeScale > 0)) return 'a TimecodeScale of ' + out.timecodeScale;
  }
  return out;
}

function readTracks(buf, s, e) {
  const entries = children(buf, s, e);
  if (!entries) return 'Tracks whose children do not fit inside them';
  let video = null;
  for (const te of entries) {
    if (te.id !== ID.TrackEntry) continue;
    const kids = children(buf, te.dataStart, te.end);
    if (!kids) return 'a TrackEntry whose children do not fit inside it';
    const t = { track: null, type: null, codec: null, width: null, height: null };
    for (const k of kids) {
      if (k.id === ID.TrackNumber) t.track = uint(buf, k.dataStart, k.end);
      else if (k.id === ID.TrackType) t.type = uint(buf, k.dataStart, k.end);
      else if (k.id === ID.CodecID) t.codec = text(buf, k.dataStart, k.end);
      else if (k.id === ID.Video) {
        for (const v of children(buf, k.dataStart, k.end) || []) {
          if (v.id === ID.PixelWidth) t.width = uint(buf, v.dataStart, v.end);
          else if (v.id === ID.PixelHeight) t.height = uint(buf, v.dataStart, v.end);
        }
      }
    }
    if (t.type === 1 && t.track > 0 && !video) video = { track: t.track, codec: t.codec, width: t.width, height: t.height };
  }
  return { video };
}

// ---------------------------------------------------------------------------
// The incremental reader
// ---------------------------------------------------------------------------

// Bytes held by their offset in the stream: the init segment until the first
// Cluster begins, and with keepBytes the Cluster being read. Copies, never the
// caller's buffer, which it may reuse once push returns.
function byteWindow() {
  let parts = [];
  return {
    add(at, buf) { if (buf.length) parts.push({ at, buf }); },
    take(from, to) {
      const out = [];
      for (const p of parts) {
        const s = Math.max(from, p.at);
        const e = Math.min(to, p.at + p.buf.length);
        if (e > s) out.push(p.buf.subarray(s - p.at, e - p.at));
      }
      return Buffer.concat(out);
    },
    drop(before) {
      let i = 0;
      while (i < parts.length && parts[i].at + parts[i].buf.length <= before) i += 1;
      if (i) parts = parts.slice(i);
      if (parts.length && parts[0].at < before) parts[0] = { at: before, buf: parts[0].buf.subarray(before - parts[0].at) };
    },
    clear() { parts = []; },
  };
}

/**
 * A reader for one recording, fed its chunks in order.
 *
 *   const reader = createReader({ keepBytes, keepClusters })
 *   reader.push(chunk)   the Clusters this chunk closed, in order (an array)
 *   reader.end()         the stream is over: the Clusters that closes (the last)
 *
 *   reader.init          every byte before the first Cluster, once it began
 *   reader.clusters      every Cluster read to its end: { index, offset, size,
 *                        timecode, keyframe, frames, first, last, truncated },
 *                        the times in ms, offset and size in bytes, and with
 *                        keepBytes its bytes as `data`. With keepClusters
 *                        false it stays empty: each Cluster is only handed
 *                        back by push() and end(). That is the recorder's
 *                        reader, which runs from Start to Stop and writes
 *                        each Cluster to disk as it closes: keeping them all
 *                        held every byte recorded in memory, about 22 MB a
 *                        minute at 720p (src/main/services/recorder.js).
 *   reader.open          the Cluster being read, its size not known yet
 *   reader.error         null, or why the stream was refused
 *   reader.docType, reader.timecodeScale, reader.video { track, codec, width,
 *   height }, reader.bytes (how many were pushed)
 *
 * A Cluster's `first` is its first video frame's time and `last` its latest;
 * `keyframe` is whether its first video block is one (null with no video
 * block); `truncated` is whether the stream stopped inside it, which loses that
 * block and keeps the rest.
 */
function createReader(options) {
  const keepBytes = !!(options && options.keepBytes);
  const keepClusters = !(options && options.keepClusters === false);
  let closedCount = 0;      // Clusters read to their end, kept or not
  let pos = 0;              // the stream offset of pending[0]
  let pending = EMPTY;      // bytes that came and are not decided yet
  let skip = 0;             // bytes still to pass over before reading on
  let stage = 'ebml';       // ebml, segment, top, cluster, group, after
  let segmentEnd = null;    // where the Segment ends, when its size is known
  let cluster = null;       // the Cluster being read
  let group = null;         // a BlockGroup being read inside it
  let passing = null;       // the element being passed over: { end, frame }
  let closedNow = [];
  let keeping = true;
  const kept = byteWindow();

  const reader = {
    init: null,
    clusters: [],
    error: null,
    ended: false,
    bytes: 0,
    docType: null,
    timecodeScale: MATROSKA_TICK_NS,
    video: null,
    push,
    end,
  };
  Object.defineProperty(reader, 'open', {
    enumerable: true,
    get() {
      if (!cluster) return null;
      // `last` is its latest frame read whole so far: the recorder sets its
      // wall clock by the newest frame each chunk carries, and a Cluster only
      // closes a chunk after its frames arrived (src/main/services/recorder.js).
      return {
        index: cluster.index, offset: cluster.offset, size: null, timecode: ms(cluster.ticks), keyframe: cluster.keyframe,
        frames: cluster.frames, first: ms(cluster.firstTicks), last: ms(cluster.lastTicks),
      };
    },
  });

  const ms = (ticks) => (ticks === null ? null : ticks * reader.timecodeScale / 1e6);

  function refuse(why) {
    if (reader.error) return false;
    reader.error = why;
    // What was read of the open Cluster up to its last whole child stands.
    if (cluster) closeCluster(cut());
    pending = EMPTY;
    skip = 0;
    kept.clear();
    keeping = false;
    return false;
  }

  // Passes n bytes, the ones held first, and the rest as they come.
  function advance(n) {
    const have = Math.min(n, pending.length);
    pending = pending.subarray(have);
    pos += have;
    skip = n - have;
  }

  // An element of the Cluster (or of its BlockGroup) passed over to its end.
  function pass(end, frame) {
    passing = { end, frame: frame || null };
    advance(end - pos);
    settle();
  }

  // Counts the element being passed over once every byte of it has come.
  function settle() {
    if (!passing || skip > 0 || pos < passing.end) return;
    const p = passing;
    passing = null;
    if (group) {
      if (p.frame && p.frame.block) group.frame = p.frame;
      if (p.frame && p.frame.reference) group.referenced = true;
      return;
    }
    if (p.frame) countFrame(p.frame, p.frame.key);
    cluster.last = p.end;
  }

  function countFrame(frame, key) {
    if (!reader.video || frame.track !== reader.video.track) return;
    cluster.frames += 1;
    if (cluster.keyframe === null) cluster.keyframe = key;
    if (cluster.firstTicks === null) cluster.firstTicks = frame.ticks;
    if (cluster.lastTicks === null || frame.ticks > cluster.lastTicks) cluster.lastTicks = frame.ticks;
  }

  // Whether the stream stopped inside the open Cluster rather than after one
  // of its children: inside a block, a BlockGroup, or short of a known size.
  function cut() {
    return !!(group || (passing && pos < passing.end) || (cluster.end !== null && cluster.last < cluster.end));
  }

  function closeCluster(truncated) {
    const c = cluster;
    const end = truncated || cluster.end === null ? c.last : cluster.end;
    const rec = {
      index: c.index,
      offset: c.offset,
      size: end - c.offset,
      timecode: ms(c.ticks),
      keyframe: c.keyframe,
      frames: c.frames,
      first: ms(c.firstTicks),
      last: ms(c.lastTicks),
      truncated: !!truncated,
    };
    if (keepBytes) {
      rec.data = kept.take(c.offset, end);
      kept.drop(end);
    }
    if (keepClusters) reader.clusters.push(rec);
    closedCount += 1;
    closedNow.push(rec);
    cluster = null;
    group = null;
    passing = null;
  }

  function stepEbml() {
    // Turned away from the first byte that cannot begin an EBML header, so a
    // file of something else is refused without waiting for more of it.
    for (let i = 0; i < Math.min(EBML_MAGIC.length, pending.length); i++) {
      if (pending[i] !== EBML_MAGIC[i]) return refuse('not a Matroska or WebM stream: it does not begin with an EBML header');
    }
    const h = headerAt(pending, 0, pending.length);
    if (!h) return false;
    if (h.bad) return refuse(h.bad + ', in the EBML header');
    if (h.size === null || h.size > MAX_META) return refuse('an EBML header of ' + (h.size === null ? 'unknown size' : h.size + ' bytes'));
    const total = h.headerLen + h.size;
    if (pending.length < total) return false;
    const kids = children(pending, h.headerLen, total);
    if (!kids) return refuse('an EBML header whose children do not fit inside it');
    const dt = kids.find((k) => k.id === ID.DocType);
    reader.docType = dt ? text(pending, dt.dataStart, dt.end) : 'matroska';
    if (reader.docType !== 'matroska' && reader.docType !== 'webm') return refuse('a DocType of ' + JSON.stringify(reader.docType) + ', not matroska or webm');
    advance(total);
    stage = 'segment';
    return true;
  }

  function stepSegment() {
    const h = headerAt(pending, 0, pending.length);
    if (!h) return false;
    if (h.bad) return refuse(h.bad + ', where the Segment should begin');
    if (h.id !== ID.Segment) return refuse(nameOf(h.id) + ' where the Segment should begin');
    segmentEnd = h.size === null ? null : pos + h.headerLen + h.size;
    advance(h.headerLen);
    stage = 'top';
    return true;
  }

  function stepTop() {
    if (segmentEnd !== null && pos >= segmentEnd) { stage = 'after'; return false; }
    const h = headerAt(pending, 0, pending.length);
    if (!h) return false;
    if (h.bad) return refuse(h.bad + ', at byte ' + pos);
    if (!TOP.has(h.id)) return refuse(nameOf(h.id) + ' at byte ' + pos + ', which no Segment holds');
    if (h.id === ID.Cluster) return openCluster(h);
    if (h.size === null) return refuse(nameOf(h.id) + ' of unknown size at byte ' + pos + ', which only a Segment or a Cluster may be');
    const end = pos + h.headerLen + h.size;
    if (segmentEnd !== null && end > segmentEnd) return refuse(nameOf(h.id) + ' at byte ' + pos + ' runs past the end of its Segment');
    if (reader.init === null && end > MAX_INIT) return refuse('no Cluster in the first ' + MAX_INIT + ' bytes');
    if (h.size > MAX_ELEMENT) return refuse(nameOf(h.id) + ' of ' + h.size + ' bytes at byte ' + pos);
    // Info and Tracks before the first Cluster are read; anything else, and
    // any after it, is passed over.
    if (reader.init === null && (h.id === ID.Info || h.id === ID.Tracks)) {
      if (h.size > MAX_META) return refuse(nameOf(h.id) + ' of ' + h.size + ' bytes');
      if (pending.length < h.headerLen + h.size) return false;
      const got = h.id === ID.Info ? readInfo(pending, h.headerLen, h.headerLen + h.size) : readTracks(pending, h.headerLen, h.headerLen + h.size);
      if (typeof got === 'string') return refuse(got);
      if (h.id === ID.Info) reader.timecodeScale = got.timecodeScale;
      else reader.video = got.video;
    }
    advance(h.headerLen + h.size);
    return true;
  }

  function openCluster(h) {
    if (!reader.video) return refuse('a Cluster at byte ' + pos + ' before Tracks named a video track');
    const offset = pos;
    const end = h.size === null ? null : offset + h.headerLen + h.size;
    if (end !== null && segmentEnd !== null && end > segmentEnd) return refuse('a Cluster at byte ' + pos + ' that runs past the end of its Segment');
    if (reader.init === null) {
      reader.init = kept.take(0, offset);
      if (!keepBytes) { keeping = false; kept.clear(); }
    }
    if (keepBytes) kept.drop(offset);
    // An unknown size Cluster also ends where a Segment of known size does.
    cluster = {
      index: closedCount, offset, end, limit: end !== null ? end : segmentEnd,
      ticks: null, keyframe: null, frames: 0, firstTicks: null, lastTicks: null, last: offset + h.headerLen,
    };
    advance(h.headerLen);
    stage = 'cluster';
    return true;
  }

  function stepCluster() {
    settle();
    if (passing) return false;
    if (cluster.limit !== null && pos >= cluster.limit) { closeCluster(false); stage = 'top'; return true; }
    const h = headerAt(pending, 0, pending.length);
    if (!h) return false;
    if (h.bad) return refuse(h.bad + ', inside Cluster ' + cluster.index);
    if (!CLUSTER_CHILD.has(h.id)) {
      // Where an unknown size Cluster ends.
      if (cluster.end === null) { closeCluster(false); stage = 'top'; return true; }
      return refuse(nameOf(h.id) + ' inside Cluster ' + cluster.index + ', which no Cluster holds');
    }
    if (h.size === null) return refuse(nameOf(h.id) + ' of unknown size inside Cluster ' + cluster.index);
    const end = pos + h.headerLen + h.size;
    if (cluster.limit !== null && end > cluster.limit) return refuse(nameOf(h.id) + ' that runs past the end of Cluster ' + cluster.index);
    if (h.size > MAX_ELEMENT) return refuse(nameOf(h.id) + ' of ' + h.size + ' bytes inside Cluster ' + cluster.index);
    if (h.id === ID.Timecode) {
      if (h.size > 8) return refuse('a Timecode of ' + h.size + ' bytes in Cluster ' + cluster.index);
      if (pending.length < h.headerLen + h.size) return false;
      cluster.ticks = uint(pending, h.headerLen, h.headerLen + h.size);
      pass(end);
      return true;
    }
    if (h.id === ID.SimpleBlock) return readBlock(h, end, false);
    if (h.id === ID.BlockGroup) {
      group = { end, frame: null, referenced: false };
      advance(h.headerLen);
      stage = 'group';
      return true;
    }
    pass(end);
    return true;
  }

  function stepGroup() {
    settle();
    if (passing) return false;
    if (pos >= group.end) {
      // A Block in a group is a keyframe unless the group references another.
      const g = group;
      group = null;
      if (g.frame) countFrame(g.frame, !g.referenced);
      cluster.last = g.end;
      stage = 'cluster';
      return true;
    }
    const h = headerAt(pending, 0, pending.length);
    if (!h) return false;
    if (h.bad) return refuse(h.bad + ', inside a BlockGroup in Cluster ' + cluster.index);
    if (h.size === null) return refuse(nameOf(h.id) + ' of unknown size inside a BlockGroup in Cluster ' + cluster.index);
    const end = pos + h.headerLen + h.size;
    if (end > group.end) return refuse(nameOf(h.id) + ' that runs past the end of its BlockGroup in Cluster ' + cluster.index);
    if (h.id === ID.Block) return readBlock(h, end, true);
    pass(end, h.id === ID.ReferenceBlock ? { reference: true } : null);
    return true;
  }

  // A block's first bytes are its track number, its time as a signed 16 bit
  // count of ticks after its Cluster's Timecode, and its flags, whose 0x80 bit
  // marks a keyframe in a SimpleBlock. The rest, the frame, is passed over.
  function readBlock(h, end, inGroup) {
    if (pending.length < h.headerLen + 1) return false;
    const tlen = vintLength(pending[h.headerLen]);
    if (tlen === 0) return refuse('a block whose track number cannot be read, in Cluster ' + cluster.index);
    if (tlen + 3 > h.size) return refuse('a block too short for its own header, in Cluster ' + cluster.index);
    if (cluster.ticks === null) return refuse('a block before its Cluster\'s Timecode, in Cluster ' + cluster.index);
    if (pending.length < h.headerLen + tlen + 3) return false;
    const frame = {
      track: vintValue(pending, h.headerLen, tlen),
      ticks: cluster.ticks + pending.readInt16BE(h.headerLen + tlen),
      key: (pending[h.headerLen + tlen + 2] & 0x80) !== 0,
      block: inGroup,
    };
    pass(end, frame);
    return true;
  }

  function step() {
    if (stage === 'ebml') return stepEbml();
    if (stage === 'segment') return stepSegment();
    if (stage === 'top') return stepTop();
    if (stage === 'cluster') return stepCluster();
    if (stage === 'group') return stepGroup();
    return false;
  }

  function push(chunk) {
    closedNow = [];
    if (reader.error || reader.ended) return closedNow;
    const buf = asBuffer(chunk);
    if (!buf) { refuse('a chunk that is not bytes'); return closedNow; }
    if (!buf.length) return closedNow;
    const at = reader.bytes;
    reader.bytes += buf.length;
    if (keeping) kept.add(at, Buffer.from(buf));
    let rest = buf;
    if (skip > 0) {
      const n = Math.min(skip, rest.length);
      skip -= n;
      pos += n;
      rest = rest.subarray(n);
    }
    if (rest.length) pending = pending.length ? Buffer.concat([pending, rest]) : rest;
    while (!reader.error && step()) { /* each step decides what it can */ }
    // Past the end of a Segment of known size nothing more is read, or held.
    if (stage === 'after') { pending = EMPTY; keeping = false; kept.clear(); }
    // What is left waits for the next chunk, as a copy.
    if (pending.length) pending = Buffer.from(pending);
    return closedNow;
  }

  function end() {
    closedNow = [];
    if (reader.ended) return closedNow;
    reader.ended = true;
    if (reader.error) return closedNow;
    if (cluster) {
      settle();
      // A group whose bytes all came closes when the next element is read,
      // and the stream has no next element.
      if (group && !passing && pos >= group.end) stepGroup();
      closeCluster(cut());
    }
    if (reader.init === null) refuse('the stream ended before its first Cluster');
    pending = EMPTY;
    skip = 0;
    kept.clear();
    keeping = false;
    return closedNow;
  }

  return reader;
}

/**
 * A recording already on disk, read in pieces as it would have arrived, never
 * whole: the reader after end(). Options as createReader's. A file that stops
 * being readable part way is ended where it stopped, which keeps the Clusters
 * read before it, and `error` says so.
 */
function indexFile(file, options) {
  // Required here, not at the top, so a page that loads this module for its
  // reader never asks for fs.
  const fs = require('fs');
  const reader = createReader(options);
  let fd = null;
  let failed = null;
  try {
    fd = fs.openSync(file, 'r');
    const piece = Buffer.alloc(1 << 16);
    for (;;) {
      const n = fs.readSync(fd, piece, 0, piece.length, null);
      if (!n) break;
      reader.push(piece.subarray(0, n));
      if (reader.error) break;
    }
  } catch (e) {
    failed = 'the file could not be read: ' + e.message;
  } finally {
    if (fd !== null) { try { fs.closeSync(fd); } catch { /* closed already */ } }
  }
  reader.end();
  if (failed) reader.error = failed;
  return reader;
}

/**
 * The init segment, read whole: { docType, mime, timecodeScale, video }, with
 * the EBML header, Info and Tracks as bytes for cutClip to write out again.
 * Null when it is not the front of a recording. Reading stops at the first
 * Cluster, so a whole recording reads as its own init segment. The mime is the
 * one a clip is played as: video/x-matroska unless the DocType says webm.
 */
function parseInit(init) {
  const buf = asBuffer(init);
  if (!buf || !buf.length) return null;
  for (let i = 0; i < EBML_MAGIC.length; i++) if (buf[i] !== EBML_MAGIC[i]) return null;
  const head = headerAt(buf, 0, buf.length);
  if (!head || head.bad || head.size === null) return null;
  const ebmlEnd = head.headerLen + head.size;
  const ebmlKids = ebmlEnd <= buf.length ? children(buf, head.headerLen, ebmlEnd) : null;
  if (!ebmlKids) return null;
  const dt = ebmlKids.find((k) => k.id === ID.DocType);
  const docType = dt ? text(buf, dt.dataStart, dt.end) : 'matroska';
  if (docType !== 'matroska' && docType !== 'webm') return null;
  const seg = headerAt(buf, ebmlEnd, buf.length);
  if (!seg || seg.bad || seg.id !== ID.Segment) return null;
  let info = null;
  let tracks = null;
  for (let p = ebmlEnd + seg.headerLen; p < buf.length;) {
    const h = headerAt(buf, p, buf.length);
    if (h && !h.bad && h.id === ID.Cluster) break;
    if (!h || h.bad || h.size === null || p + h.headerLen + h.size > buf.length) return null;
    const el = { start: p, dataStart: p + h.headerLen, end: p + h.headerLen + h.size };
    if (h.id === ID.Info && !info) info = el;
    else if (h.id === ID.Tracks && !tracks) tracks = el;
    p = el.end;
  }
  if (!tracks) return null;
  const inf = info ? readInfo(buf, info.dataStart, info.end) : { timecodeScale: MATROSKA_TICK_NS, kids: [] };
  const trk = readTracks(buf, tracks.dataStart, tracks.end);
  if (typeof inf === 'string' || typeof trk === 'string' || !trk.video) return null;
  return {
    docType,
    mime: docType === 'webm' ? 'video/webm' : 'video/x-matroska',
    timecodeScale: inf.timecodeScale,
    video: trk.video,
    ebml: buf.subarray(0, ebmlEnd),
    info: inf.kids.map((k) => ({ id: k.id, bytes: buf.subarray(k.start, k.end) })),
    tracks: buf.subarray(tracks.start, tracks.end),
  };
}

// ---------------------------------------------------------------------------
// Clips
// ---------------------------------------------------------------------------

const isTime = (x) => typeof x === 'number' && !Number.isNaN(x);
const isMs = (x) => typeof x === 'number' && Number.isFinite(x);

/**
 * Which Clusters a clip of [from, to] (ms on the recording's timeline, as the
 * Clusters' timecodes are) is made of: from the last Cluster opening on a
 * keyframe at or before `from`, since a decoder must begin on one, through the
 * last that starts by `to`, the one covering it. A `from` before the first
 * keyframe starts at it; a `to` past the end runs to the end. A window wholly
 * before the first keyframe or after the last frame has no clip: what it would
 * show is not the moment asked for.
 *
 *   { clusters, start, end }   start and end on the recording's timeline, in ms:
 *                              where the clip's 0 is, and where its last frame
 *                              ends (the next Cluster's first frame when there
 *                              is one, else the last frame plus the clip's mean
 *                              frame interval)
 *
 * Null when no clip can be cut. Clusters without a video frame are left out.
 */
function planClip(clusters, from, to) {
  if (!Array.isArray(clusters) || !isTime(from) || !isTime(to) || to < from) return null;
  const usable = clusters.filter((c) => c && isMs(c.timecode) && isMs(c.first) && isMs(c.last) && c.frames > 0);
  for (let i = 1; i < usable.length; i++) if (usable[i].timecode < usable[i - 1].timecode) return null;
  let first = -1;
  for (let i = 0; i < usable.length && usable[i].timecode <= from; i++) if (usable[i].keyframe === true) first = i;
  if (first < 0) first = usable.findIndex((c) => c.keyframe === true);
  if (first < 0 || usable[first].timecode > to) return null;
  let last = first;
  while (last + 1 < usable.length && usable[last + 1].timecode <= to) last += 1;
  const chosen = usable.slice(first, last + 1);
  const next = usable[last + 1];
  let end;
  if (next) end = next.first;
  else {
    const frames = chosen.reduce((n, c) => n + c.frames, 0);
    const span = chosen[chosen.length - 1].last - chosen[0].first;
    end = chosen[chosen.length - 1].last + (frames > 1 && span > 0 ? span / (frames - 1) : FALLBACK_FRAME_MS);
  }
  if (from >= end) return null;
  return { clusters: chosen, start: chosen[0].timecode, end };
}

// EBML writing: an unsigned number in `len` bytes (as few as it takes when
// len is not given), a size with its length marker, an element.
function uintBytes(n, len) {
  let size = len || 1;
  if (!len) while (size < 8 && n >= Math.pow(2, 8 * size)) size += 1;
  const out = Buffer.alloc(size);
  let v = n;
  for (let i = size - 1; i >= 0; i--) { out[i] = v % 256; v = Math.floor(v / 256); }
  return out;
}

// Every value bit set means "unknown", hence the minus one.
function sizeBytes(n, len) {
  let size = len || 1;
  if (!len) while (size < 8 && n >= Math.pow(2, 7 * size) - 1) size += 1;
  const out = uintBytes(n, size);
  out[0] |= 0x80 >> (size - 1);
  return out;
}

const idBytes = (id) => uintBytes(id);

function element(id, payload) {
  return Buffer.concat([idBytes(id), sizeBytes(payload.length), payload]);
}

function floatElement(id, x) {
  const b = Buffer.alloc(8);
  b.writeDoubleBE(x);
  return element(id, b);
}

// A Cluster written out again with a new Timecode and a known size, its blocks
// copied as they were. Null when the bytes are not one whole Cluster.
function rebuildCluster(data, ticks) {
  const h = headerAt(data, 0, data.length);
  if (!h || h.bad || h.id !== ID.Cluster) return null;
  const end = h.size === null ? data.length : h.headerLen + h.size;
  if (end !== data.length) return null;
  const kids = children(data, h.headerLen, end);
  if (!kids) return null;
  const parts = [element(ID.Timecode, uintBytes(ticks))];
  for (const k of kids) if (CLIP_KEEPS.has(k.id)) parts.push(data.subarray(k.start, k.end));
  return element(ID.Cluster, Buffer.concat(parts));
}

/**
 * A clip of [from, to] on the recording's timeline, in ms, as one Buffer
 * that plays and seeks: the init segment's EBML header, then a Segment of known
 * size holding a SeekHead, Info with a Duration, the recording's Tracks as they
 * were, Cues, and the Clusters planClip chose, rebased so the clip starts at 0.
 *
 *   cutClip({ init, clusters, from, to, read })
 *
 * `clusters` are the reader's, each with its bytes as `data` (keepBytes), or
 * fetched as needed by read(cluster), which returns that Cluster's bytes, so a
 * caller holding the recording on disk reads only the Clusters the clip needs.
 * Null when there is no clip to cut, the init segment is not one, or a
 * Cluster's bytes are not that Cluster.
 */
function cutClip(args) {
  const { init, clusters, from, to, read } = args && typeof args === 'object' ? args : {};
  const head = parseInit(init);
  const plan = head && planClip(clusters, from, to);
  if (!plan) return null;
  // Times on the recording's timeline are ms; a Matroska file counts ticks.
  const tickMs = head.timecodeScale / 1e6;
  const ticks = (t) => Math.round(t / tickMs);
  const base = ticks(plan.start);
  const built = [];
  for (const c of plan.clusters) {
    let data = c.data;
    if (data === undefined && typeof read === 'function') {
      try { data = read(c); } catch { return null; }
    }
    data = asBuffer(data);
    if (!data || (Number.isInteger(c.size) && data.length !== c.size)) return null;
    const bytes = rebuildCluster(data, ticks(c.timecode) - base);
    if (!bytes) return null;
    built.push({ c, bytes });
  }

  const infoParts = head.info.filter((k) => k.id !== ID.Duration).map((k) => k.bytes);
  if (!head.info.some((k) => k.id === ID.TimecodeScale)) infoParts.unshift(element(ID.TimecodeScale, uintBytes(head.timecodeScale)));
  // A Duration is a float of ticks, so an estimated end keeps its fraction.
  infoParts.push(floatElement(ID.Duration, plan.end / tickMs - base));
  const info = element(ID.Info, Buffer.concat(infoParts));
  const tracks = head.tracks;

  // Every position in the SeekHead and the Cues is written in 8 bytes, so
  // their sizes are known before the positions they hold. Positions count from
  // the first byte of the Segment's data.
  const keyed = built.filter((b) => b.c.keyframe === true);
  const cues = (positions) => element(ID.Cues, Buffer.concat(keyed.map((b, i) => element(ID.CuePoint, Buffer.concat([
    element(ID.CueTime, uintBytes(Math.max(0, ticks(b.c.first) - base))),
    element(ID.CueTrackPositions, Buffer.concat([
      element(ID.CueTrack, uintBytes(head.video.track)),
      element(ID.CueClusterPosition, uintBytes(positions[i], 8)),
    ])),
  ])))));
  const seekHead = (at) => element(ID.SeekHead, Buffer.concat([[ID.Info, at.info], [ID.Tracks, at.tracks], [ID.Cues, at.cues]].map(([id, p]) =>
    element(ID.Seek, Buffer.concat([element(ID.SeekID, idBytes(id)), element(ID.SeekPosition, uintBytes(p, 8))])))));
  const seekLen = seekHead({ info: 0, tracks: 0, cues: 0 }).length;
  const at = { info: seekLen, tracks: seekLen + info.length, cues: seekLen + info.length + tracks.length };
  let p = at.cues + cues(keyed.map(() => 0)).length;
  const where = new Map();
  for (const b of built) { where.set(b, p); p += b.bytes.length; }
  const body = Buffer.concat([seekHead(at), info, tracks, cues(keyed.map((b) => where.get(b)))].concat(built.map((b) => b.bytes)));
  return Buffer.concat([head.ebml, idBytes(ID.Segment), sizeBytes(body.length, 8), body]);
}

module.exports = { createReader, indexFile, parseInit, planClip, cutClip, MAX_INIT, MAX_META, MAX_ELEMENT };
