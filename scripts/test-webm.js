'use strict';

/**
 * src/shared/webm.js on a real recording and on streams built here.
 *
 * THE FIXTURE IS REAL. scripts/fixtures/recording-canvas.mkv was written by
 * Chromium's own MediaRecorder in this repo's Electron (H.264, a keyframe every
 * 1000 ms, a chunk every 1000 ms), recording a generated canvas, never a screen
 * (scripts/fixtures/make-recording-fixture.js). recording-canvas.json beside it
 * says how big each chunk was, so the reader is fed the chunks exactly as they
 * arrived, and each of them ends one byte into an element's ID, as every chunk
 * of the eight recordings measured did (webm.js, READ AS IT ARRIVES).
 *
 * Held here:
 *   the same init segment and Clusters fed whole, in the recorded chunks, in
 *     chunks ending one byte into every Cluster's ID, one byte at a time and in
 *     random pieces, through a buffer the caller reuses, with and without the
 *     bytes kept, and all of it what a plain walk of the whole file written
 *     here finds; each chunk hands back the Clusters it closed
 *   every Cluster opens on a keyframe, and the block flags are true: each
 *     opening block is an IDR carrying its SPS and PPS, and a block is flagged
 *     a keyframe exactly when its frame is an IDR
 *   a clip's first Timecode is 0 and its blocks are byte identical to the
 *     source's; it has a Duration and Cues that point at its Clusters, and a
 *     SeekHead that points at Info, Tracks and the Cues
 *   cut from the last keyframe Cluster at or before the start, through the one
 *     covering the end, at the very start and at the very end too
 *   the Cluster bytes fetched by read() give the same clip as bytes kept
 *   a block in a BlockGroup, a delta frame opening a Cluster, another track's
 *     block first, a TimecodeScale other than 1 ms, sizes known, a stream cut
 *     off inside a block
 *   nonsense refused, never thrown on, and what was read before it kept
 *   indexFile reads a file in pieces, never whole
 *
 * check:webmplay plays the cut clips in a real <video>.
 *
 * Run: npm run test:webm
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const util = require('util');
const webm = require('../src/shared/webm');

const { createReader, indexFile, parseInit, planClip, cutClip } = webm;

let fails = 0;
let checks = 0;
const ok = (cond, what) => {
  checks++;
  if (!cond) { fails++; console.log(`FAIL  ${what}`); } else console.log(`ok    ${what}`);
};
// A yes or no, never a diff: drawing one between two Clusters' bytes takes minutes.
const same = (a, b) => util.isDeepStrictEqual(a, b);
const noThrow = (fn) => { try { return { value: fn() }; } catch (e) { return { threw: e }; } };

const FIXTURE = path.join(__dirname, 'fixtures', 'recording-canvas.mkv');
const META = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'recording-canvas.json'), 'utf8'));
const FILE = fs.readFileSync(FIXTURE);

// ── An independent reading of a whole file ────────────────────────────────
// Written plainly for this test, sharing nothing with webm.js: a whole buffer,
// walked from the front. It reads only what these files hold (one byte track
// numbers, Timecodes of up to six bytes).
const CLUSTER = 0x1F43B675;
const CLUSTER_KIDS = new Set([0xE7, 0x5854, 0xA7, 0xAB, 0xA3, 0xA0, 0xAF, 0xEC, 0xBF]);
const lenOf = (x) => { let n = 1; while (n <= 8 && !(x & (0x100 >> n))) n++; return n; };
function hdr(b, p) {
  const idLen = lenOf(b[p]);
  const id = b.readUIntBE(p, idLen);
  const sLen = lenOf(b[p + idLen]);
  const top = 0xFF >> sLen;
  let size = b[p + idLen] & top;
  let all = size === top;
  for (let i = 1; i < sLen; i++) { size = size * 256 + b[p + idLen + i]; if (b[p + idLen + i] !== 0xFF) all = false; }
  const dataStart = p + idLen + sLen;
  return { id, start: p, dataStart, size: all ? null : size, end: all ? null : dataStart + size };
}
function kidsOf(b, s, e) {
  const out = [];
  for (let p = s; p < e;) { const h = hdr(b, p); out.push(h); p = h.end; }
  return out;
}
const uintAt = (b, h) => { let v = 0; for (let i = h.dataStart; i < h.end; i++) v = v * 256 + b[i]; return v; };
function walkFile(b) {
  const ebml = hdr(b, 0);
  const seg = hdr(b, ebml.end);
  const segEnd = seg.end === null ? b.length : seg.end;
  const out = { ebmlEnd: ebml.end, seg, top: [], clusters: [] };
  for (let p = seg.dataStart; p < segEnd;) {
    const h = hdr(b, p);
    if (h.id !== CLUSTER) { out.top.push(h); p = h.end; continue; }
    const stop = h.end === null ? segEnd : h.end;
    const c = { offset: p, sizeKnown: h.end !== null, timecode: null, blocks: [] };
    let q = h.dataStart;
    while (q < stop) {
      const k = hdr(b, q);
      if (h.end === null && !CLUSTER_KIDS.has(k.id)) break;
      if (k.id === 0xE7) c.timecode = uintAt(b, k);
      if (k.id === 0xA3) {
        c.blocks.push({ start: q, end: k.end, track: b[k.dataStart] & 0x7F, rel: b.readInt16BE(k.dataStart + 1), key: (b[k.dataStart + 3] & 0x80) !== 0, frame: b.subarray(k.dataStart + 4, k.end) });
      }
      q = k.end;
    }
    c.size = q - p;
    out.clusters.push(c);
    p = q;
  }
  return out;
}

// H.264 NAL unit types in an Annex B frame: 7 SPS, 8 PPS, 5 an IDR slice.
function nalTypes(f) {
  const types = [];
  for (let i = 0; i + 3 < f.length; i++) {
    if (f[i] === 0 && f[i + 1] === 0 && f[i + 2] === 1) { types.push(f[i + 3] & 0x1F); i += 3; }
  }
  return types;
}

// ── Streams built here ────────────────────────────────────────────────────
const W = {
  id(n) { const out = []; for (let v = n; v > 0; v = Math.floor(v / 256)) out.unshift(v % 256); return Buffer.from(out); },
  uint(n, len) {
    let size = len || 1;
    if (!len) while (size < 8 && n >= Math.pow(2, 8 * size)) size++;
    const b = Buffer.alloc(size);
    for (let i = size - 1, v = n; i >= 0; i--, v = Math.floor(v / 256)) b[i] = v % 256;
    return b;
  },
  size(n) {
    let len = 1;
    while (n >= Math.pow(2, 7 * len) - 1) len++;
    const b = W.uint(n, len);
    b[0] |= 0x80 >> (len - 1);
    return b;
  },
  bytes: (x) => (Buffer.isBuffer(x) ? x : Array.isArray(x) ? Buffer.from(x) : Buffer.from(String(x), 'latin1')),
  el: (id, ...payload) => { const body = Buffer.concat(payload.map(W.bytes)); return Buffer.concat([W.id(id), W.size(body.length), body]); },
  unknown: (id) => Buffer.concat([W.id(id), Buffer.from([0x01, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF])]),
  int16: (n) => { const b = Buffer.alloc(2); b.writeInt16BE(n); return b; },
};
const simple = (track, rel, key, n) => W.el(0xA3, [0x80 | track], W.int16(rel), [key ? 0x80 : 0x00], Buffer.alloc(n || 40, 0x5A));
const grouped = (track, rel, referenced) => W.el(0xA0, W.el(0xA1, [0x80 | track], W.int16(rel), [0x00], Buffer.alloc(40, 0x5A)), ...(referenced ? [W.el(0xFB, W.uint(33))] : []));
const EBML_HEAD = (docType) => W.el(0x1A45DFA3, W.el(0x4286, W.uint(1)), W.el(0x4282, docType || 'webm'));
const TRACKS = (list) => W.el(0x1654AE6B, ...(list || [[1, 1]]).map(([n, type]) => W.el(0xAE, W.el(0xD7, W.uint(n)), W.el(0x83, W.uint(type)), W.el(0x86, type === 1 ? 'V_TEST' : 'A_TEST'))));
const INFO = (scale) => W.el(0x1549A966, W.el(0x2AD7B1, W.uint(scale || 1000000)), W.el(0x4D80, 'test'));
function stream(o) {
  const clusters = (o.clusters || []).map((c) => {
    const body = Buffer.concat([W.el(0xE7, W.uint(c.t))].concat(c.blocks || []));
    return o.clusterKnown ? W.el(CLUSTER, body) : Buffer.concat([W.unknown(CLUSTER), body]);
  });
  const body = Buffer.concat([INFO(o.scale), TRACKS(o.tracks)].concat(clusters));
  return Buffer.concat([EBML_HEAD(o.docType), o.segmentKnown ? W.el(0x18538067, body) : Buffer.concat([W.unknown(0x18538067), body])].concat(o.after ? [o.after] : []));
}
// One video frame a cluster per 33 ms, the first a keyframe, the rest not.
const second = (t, opensOnKey) => ({ t, blocks: [0, 33, 66, 99].map((rel, i) => simple(1, rel, i === 0 && opensOnKey !== false)) });

function readAll(pieces, options) {
  const r = createReader(options);
  const closed = [];
  for (const p of pieces) closed.push(...r.push(p));
  closed.push(...r.end());
  return { r, closed };
}
const strip = (clusters) => clusters.map((c) => { const o = Object.assign({}, c); delete o.data; return o; });

// ── The fixture is the one the JSON describes ─────────────────────────────
ok(FILE.length === META.bytes && crypto.createHash('sha256').update(FILE).digest('hex') === META.sha256,
  `the fixture is the recording its JSON describes (${FILE.length} bytes, sha256 ${META.sha256.slice(0, 12)})`);
ok(META.chunks.reduce((n, c) => n + c.size, 0) === FILE.length && META.chunks.length >= 10,
  `its ${META.chunks.length} recorded chunks add up to it`);
const CHUNKS = [];
for (let at = 0, i = 0; i < META.chunks.length; at += META.chunks[i].size, i++) CHUNKS.push(FILE.subarray(at, at + META.chunks[i].size));
ok(META.asked.mimeType.indexOf('h264') >= 0 && META.asked.videoKeyFrameIntervalDuration === 1000 && META.asked.timesliceMs === 1000
  && META.recorder.mimeTypeAfterStop.indexOf('video/x-matroska') === 0,
  `recorded as the recorder will record: ${META.asked.mimeType}, keyframes every 1000 ms, a chunk a second, named ${META.recorder.mimeTypeAfterStop}`);

// ── The reader, against the plain walk ────────────────────────────────────
const truth = walkFile(FILE);
const whole = readAll([FILE], { keepBytes: true });
const R = whole.r;
const C = R.clusters;
ok(!R.error && R.ended && C.length === truth.clusters.length && C.length >= 10,
  `fed whole, it reads ${C.length} Clusters with no error (${R.error || 'none'})`);
ok(R.docType === 'matroska' && R.timecodeScale === 1000000 && same(R.video, { track: 1, codec: 'V_MPEG4/ISO/AVC', width: 640, height: 360 }),
  `a matroska stream, 1 ms ticks, video track 1, ${R.video && R.video.codec} ${R.video && R.video.width}x${R.video && R.video.height}`);
ok(Buffer.isBuffer(R.init) && R.init.length === truth.clusters[0].offset && R.init.equals(FILE.subarray(0, truth.clusters[0].offset)),
  `the init segment is every byte before the first Cluster (${R.init && R.init.length} bytes)`);
ok(truth.seg.size === null && truth.clusters.every((c) => !c.sizeKnown) && truth.top.every((h) => h.id === 0x1549A966 || h.id === 0x1654AE6B),
  'as Chromium writes a live stream: a Segment and Clusters of unknown size, Info and Tracks, no Cues');
ok(C.every((c, i) => c.offset === truth.clusters[i].offset && c.size === truth.clusters[i].size),
  'every Cluster at the offset, and of the size, a walk of the whole file finds');
ok(C.every((c, i, a) => (i + 1 < a.length ? c.offset + c.size === a[i + 1].offset : c.offset + c.size === FILE.length)),
  'one after another, the last ending with the file');
ok(C.every((c, i) => c.timecode === truth.clusters[i].timecode),
  `every Timecode the walk reads, in ms (${C.slice(0, 4).map((c) => c.timecode).join(', ')}, ...)`);
ok(C.every((c, i) => {
  const v = truth.clusters[i].blocks.filter((b) => b.track === 1);
  const times = v.map((b) => truth.clusters[i].timecode + b.rel);
  return c.frames === v.length && c.first === times[0] && c.last === Math.max(...times) && c.keyframe === v[0].key;
}), 'and its frames counted, its first and latest frame times, and its first block\'s keyframe flag');
ok(C.every((c, i) => c.data && c.data.equals(FILE.subarray(c.offset, c.offset + c.size)) && !c.truncated),
  'kept, each Cluster\'s bytes are the file\'s bytes at its offset');
ok(same(whole.closed, C), 'push and end hand back every Cluster as it closes, once, in order');

// ── Fed as it arrived ─────────────────────────────────────────────────────
const chunkStarts = CHUNKS.map((ch, i) => CHUNKS.slice(0, i).reduce((n, x) => n + x.length, 0));
const inside = C.filter((c) => !chunkStarts.includes(c.offset)).length;
ok(inside >= C.length / 2,
  `${inside} of ${C.length} Clusters begin inside a chunk, not at its start, so the reader has to carry them across chunks`);
{
  // Measured on eight recordings: MediaRecorder hands a chunk over on the
  // first byte the muxer writes once the timeslice is up, so a chunk ends one
  // byte into an element's ID, the next Cluster's or a block's, never between
  // two elements. Every element start in the file, from the plain walk:
  const starts = new Map();
  for (const c of truth.clusters) {
    starts.set(c.offset, 'Cluster');
    for (const b of c.blocks) starts.set(b.start, 'SimpleBlock');
  }
  const ends = chunkStarts.slice(1);
  const intoId = ends.filter((e) => starts.has(e - 1));
  const kinds = intoId.reduce((m, e) => { m[starts.get(e - 1)] = (m[starts.get(e - 1)] || 0) + 1; return m; }, {});
  ok(intoId.length >= 1,
    `${intoId.length} of the ${ends.length} chunk ends are one byte into an element's ID (${Object.entries(kinds).map(([k, n]) => n + ' a ' + k + '\'s').join(', ')}), the reader holding that byte for the next chunk`);
  // The pattern the other recordings showed, every chunk one byte into a
  // Cluster's ID, cut here from this one whatever pattern it came with.
  const cuts = C.slice(1).map((c) => c.offset + 1);
  const pieces = [0].concat(cuts).map((s, i, a) => FILE.subarray(s, i + 1 < a.length ? a[i + 1] : FILE.length));
  const idCut = readAll(pieces, { keepBytes: true });
  ok(!idCut.r.error && same(idCut.r.clusters, C) && idCut.r.init.equals(R.init),
    `fed in ${pieces.length} chunks that each end one byte into the next Cluster's ID, the same`);
}
{
  // An unknown size Cluster closes once the next one's header has all come,
  // whichever chunk that happens in; until then it is open, its size unknown.
  const headerEnd = C.map((c) => hdr(FILE, c.offset).dataStart);
  const r = createReader({ keepBytes: true });
  let pushed = 0;
  const wrong = [];
  CHUNKS.forEach((ch, k) => {
    const closed = r.push(ch).map((c) => c.index);
    const before = pushed;
    pushed += ch.length;
    const want = C.filter((c, i) => i + 1 < C.length && headerEnd[i + 1] > before && headerEnd[i + 1] <= pushed).map((c) => c.index);
    const reading = C.filter((c, i) => headerEnd[i] <= pushed).pop();
    if (closed.join() !== want.join() || !r.open || r.open.index !== reading.index || r.open.size !== null
      || r.open.offset !== reading.offset || r.open.timecode !== reading.timecode) wrong.push(k);
  });
  const last = r.end().map((c) => c.index);
  ok(!wrong.length && last.join() === String(C.length - 1) && r.open === null,
    'each chunk hands back exactly the Clusters whose next one\'s header it completed, the one being read stays open with its size unknown, and end() closes the last'
    + (wrong.length ? ' (wrong after chunks ' + wrong.join(', ') + ')' : ''));
}
const chunked = readAll(CHUNKS, { keepBytes: true });
ok(!chunked.r.error && same(chunked.r.clusters, C) && chunked.r.init.equals(R.init), `fed in the ${CHUNKS.length} chunks as they came, the same Clusters and init segment`);
const t0 = Date.now();
const bytes = [];
for (let i = 0; i < FILE.length; i++) bytes.push(FILE.subarray(i, i + 1));
const single = readAll(bytes, { keepBytes: true });
ok(!single.r.error && same(single.r.clusters, C) && single.r.init.equals(R.init),
  `fed one byte at a time, the same (${FILE.length} pushes in ${Date.now() - t0} ms)`);
{
  let seed = 7;
  const rand = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
  const pieces = [];
  for (let at = 0; at < FILE.length;) { const n = 1 + Math.floor(rand() * 5000); pieces.push(FILE.subarray(at, at + n)); at += n; }
  const random = readAll(pieces, { keepBytes: true });
  ok(!random.r.error && same(random.r.clusters, C), `fed in ${pieces.length} random pieces, the same`);
}
{
  const lean = readAll(CHUNKS);
  ok(!lean.r.error && lean.r.clusters.every((c) => !('data' in c)) && same(lean.r.clusters, strip(C)) && lean.r.init.equals(R.init),
    'without keepBytes it keeps no Cluster\'s bytes and finds the same');
}
{
  // The caller may reuse its buffer once push returns: nothing kept may be a
  // view of it. Pieces of 1 to 13 bytes end inside headers and block starts,
  // which is when the reader holds bytes over to the next push.
  const reuse = (sizeOf) => {
    const r = createReader({ keepBytes: true });
    const scratch = Buffer.alloc(4096);
    for (let at = 0, k = 0; at < FILE.length; k++) {
      const n = FILE.copy(scratch, 0, at, Math.min(FILE.length, at + sizeOf(k)));
      r.push(scratch.subarray(0, n));
      scratch.fill(0xEE);
      at += n;
    }
    r.end();
    return r;
  };
  const big = reuse(() => 4096);
  const small = reuse((k) => 1 + (k % 13));
  ok(!big.error && same(big.clusters, C) && big.init.equals(R.init) && !small.error && same(small.clusters, C) && small.init.equals(R.init),
    'a caller reusing one buffer for every chunk, of 4096 bytes or of 1 to 13, still gets the same: nothing held is a view of it');
}

// ── Keyframes ─────────────────────────────────────────────────────────────
ok(C.every((c) => c.keyframe === true), `every Cluster opens on a keyframe (${C.length} of ${C.length})`);
ok(truth.clusters.every((c) => { const t = nalTypes(c.blocks[0].frame); return t.includes(7) && t.includes(8) && t.includes(5); }),
  'each opening block is an IDR that carries its own SPS and PPS, so a clip can begin at any Cluster');
ok(truth.clusters.every((c) => c.blocks.every((b) => b.key === nalTypes(b.frame).includes(5))),
  'and a block is flagged a keyframe exactly when its frame is an IDR');
ok(C.slice(1).every((c, i) => c.timecode - C[i].timecode >= 700 && c.timecode - C[i].timecode <= 1500),
  `about a second apart, as videoKeyFrameIntervalDuration asked (${C.slice(1).map((c, i) => c.timecode - C[i].timecode).join(', ')} ms)`);

// ── The init segment ──────────────────────────────────────────────────────
{
  const head = parseInit(R.init);
  ok(head && head.docType === 'matroska' && head.mime === 'video/x-matroska' && head.timecodeScale === 1000000 && same(head.video, R.video),
    `parseInit reads it: ${head && head.mime}, the type an H.264 clip has to be served as`);
  ok(same(parseInit(FILE) && parseInit(FILE).video, R.video), 'and reads a whole recording as its own init segment, stopping at the first Cluster');
  ok(parseInit(stream({ docType: 'webm', clusters: [] })).mime === 'video/webm', 'a webm DocType plays as video/webm');
}

// ── Clips ─────────────────────────────────────────────────────────────────
function readClip(clip) {
  const t = walkFile(clip);
  const top = (id) => t.top.find((h) => h.id === id);
  const info = top(0x1549A966);
  const infoKids = info ? kidsOf(clip, info.dataStart, info.end) : [];
  const dur = infoKids.find((k) => k.id === 0x4489);
  const cues = top(0x1C53BB6B);
  const points = cues ? kidsOf(clip, cues.dataStart, cues.end).map((cp) => {
    const kids = kidsOf(clip, cp.dataStart, cp.end);
    const pos = kidsOf(clip, kids.find((k) => k.id === 0xB7).dataStart, kids.find((k) => k.id === 0xB7).end);
    return { time: uintAt(clip, kids.find((k) => k.id === 0xB3)), track: uintAt(clip, pos.find((k) => k.id === 0xF7)), at: uintAt(clip, pos.find((k) => k.id === 0xF1)) };
  }) : [];
  const seek = top(0x114D9B74);
  const seeks = seek ? kidsOf(clip, seek.dataStart, seek.end).map((s) => {
    const kids = kidsOf(clip, s.dataStart, s.end);
    const idEl = kids.find((k) => k.id === 0x53AB);
    return { id: clip.readUIntBE(idEl.dataStart, idEl.size), at: uintAt(clip, kids.find((k) => k.id === 0x53AC)) };
  }) : [];
  return {
    t, info, infoKids, tracks: top(0x1654AE6B), seeks, points,
    durationTicks: dur ? (dur.size === 8 ? clip.readDoubleBE(dur.dataStart) : clip.readFloatBE(dur.dataStart)) : null,
  };
}
const segData = (x) => x.t.seg.dataStart;
const sourceBlocks = (fromIndex, toIndex) => truth.clusters.slice(fromIndex, toIndex + 1).reduce((a, c) => a.concat(c.blocks), []);

{
  // A moment in the middle: from a little after one keyframe to a little after another.
  const from = C[4].timecode + 370;
  const to = C[8].timecode + 274;
  const plan = planClip(C, from, to);
  ok(plan && plan.clusters.map((c) => c.index).join() === '4,5,6,7,8' && plan.start === C[4].timecode && plan.end === C[9].first,
    `a clip of ${from} to ${to} ms is Clusters 4 to 8: from the last keyframe at or before its start (${C[4].timecode}) through the one covering its end, ending where Cluster 9's first frame begins (${C[9].first})`);
  const clip = cutClip({ init: R.init, clusters: C, from, to });
  ok(Buffer.isBuffer(clip) && clip.length > 0, `cutClip returns a Buffer (${clip && clip.length} bytes)`);
  const x = readClip(clip);
  ok(x.t.clusters.length === 5 && x.t.clusters[0].timecode === 0, 'the clip\'s first Timecode is 0');
  ok(same(x.t.clusters.map((c) => c.timecode), C.slice(4, 9).map((c) => c.timecode - C[4].timecode)),
    `every Timecode rebased by the same amount (${x.t.clusters.map((c) => c.timecode).join(', ')})`);
  const got = x.t.clusters.reduce((a, c) => a.concat(c.blocks), []);
  const want = sourceBlocks(4, 8);
  ok(got.length === want.length && got.every((b, i) => clip.subarray(b.start, b.end).equals(FILE.subarray(want[i].start, want[i].end))),
    `its ${got.length} blocks are byte identical to the source's, in order`);
  ok(clip.subarray(0, truth.ebmlEnd).equals(FILE.subarray(0, truth.ebmlEnd)) && x.t.seg.size === clip.length - segData(x),
    'it keeps the source\'s EBML header, under a Segment whose size is known and right');
  ok(x.t.clusters.every((c) => c.sizeKnown), 'and Clusters whose sizes are known');
  ok(x.durationTicks === C[9].first - C[4].timecode, `Info has a Duration: ${x.durationTicks} ms, its first frame to where its last ends`);
  ok(x.infoKids.some((k) => k.id === 0x2AD7B1 && uintAt(clip, k) === 1000000) && x.infoKids.some((k) => k.id === 0x4D80),
    'and the source\'s TimecodeScale and MuxingApp');
  ok(x.tracks && clip.subarray(x.tracks.start, x.tracks.end).equals(FILE.subarray(truth.top[1].start, truth.top[1].end)), 'the source\'s Tracks, as they were');
  ok(x.points.length === 5 && x.points.every((p, i) => p.track === 1 && p.time === x.t.clusters[i].timecode && x.t.clusters[i].offset === segData(x) + p.at),
    'Cues: a point at each keyframe Cluster, on the video track, at its time, pointing at it');
  const at = (id) => (x.seeks.find((s) => s.id === id) || {}).at;
  ok(x.seeks.length === 3 && x.info.start === segData(x) + at(0x1549A966) && x.tracks.start === segData(x) + at(0x1654AE6B)
    && walkFile(clip).top.find((h) => h.id === 0x1C53BB6B).start === segData(x) + at(0x1C53BB6B),
    'a SeekHead pointing at Info, Tracks and the Cues');
  const cuesAt = walkFile(clip).top.find((h) => h.id === 0x1C53BB6B).start;
  ok(cuesAt < x.t.clusters[0].offset, 'the Cues before the Clusters, where a player reading from the front finds them');
  const back = readAll([clip]);
  ok(!back.r.error && back.r.clusters.length === 5 && back.r.clusters[0].timecode === 0 && back.r.clusters.every((c) => c.keyframe === true),
    'and webm.js reads the clip back: five Clusters from 0, each opening on a keyframe');

  // The bytes fetched as needed, as from the recording on disk.
  const fd = fs.openSync(FIXTURE, 'r');
  const asked = [];
  const read = (c) => { asked.push(c.index); const b = Buffer.alloc(c.size); fs.readSync(fd, b, 0, c.size, c.offset); return b; };
  const viaRead = cutClip({ init: R.init, clusters: strip(C), from, to, read });
  fs.closeSync(fd);
  ok(viaRead && viaRead.equals(clip) && asked.join() === '4,5,6,7,8', 'read(cluster) fetches only the Clusters the clip needs, and gives the same clip');
}
{
  const from = C[4].timecode;
  ok(planClip(C, from, from).clusters.map((c) => c.index).join() === '4', 'a start exactly on a Cluster\'s Timecode begins at that Cluster');
  ok(planClip(C, from - 1, from).clusters.map((c) => c.index).join() === '3,4', 'a millisecond before it begins at the one before');
}
{
  // The very start.
  for (const from of [0, -5, -Infinity]) {
    const plan = planClip(C, from, C[2].timecode + 300);
    ok(plan && plan.clusters.map((c) => c.index).join() === '0,1,2' && plan.start === 0 && plan.end === C[3].first,
      `a clip from ${from} begins at the recording's first Cluster`);
  }
  const clip = cutClip({ init: R.init, clusters: C, from: 0, to: C[2].timecode + 300 });
  const x = clip && readClip(clip);
  const want = sourceBlocks(0, 2);
  const got = x ? x.t.clusters.reduce((a, c) => a.concat(c.blocks), []) : [];
  ok(x && x.t.clusters[0].timecode === 0 && x.durationTicks === C[3].first && got.every((b, i) => clip.subarray(b.start, b.end).equals(FILE.subarray(want[i].start, want[i].end))),
    `cut at the very start: Timecode 0, a Duration of ${x && x.durationTicks} ms, the source's blocks`);
  const one = cutClip({ init: R.init, clusters: C, from: 0, to: 0 });
  ok(one && readClip(one).t.clusters.length === 1 && readClip(one).durationTicks === C[1].first, 'from 0 to 0 is the first Cluster alone');
}
{
  // The very end.
  const L = C.length - 1;
  const last = C[L];
  const meanFrame = (last.last - last.first) / (last.frames - 1);
  for (const to of [last.timecode + 400, Infinity, last.last + 60000]) {
    const plan = planClip(C, last.timecode + 200, to);
    ok(plan && plan.clusters.map((c) => c.index).join() === String(L) && Math.abs(plan.end - (last.last + meanFrame)) < 1e-9,
      `a clip to ${to} ends with the last Cluster, its last frame lasting the clip's mean frame interval (${meanFrame.toFixed(1)} ms)`);
  }
  const clip = cutClip({ init: R.init, clusters: C, from: last.timecode + 200, to: Infinity });
  const x = clip && readClip(clip);
  const want = sourceBlocks(L, L);
  const got = x ? x.t.clusters.reduce((a, c) => a.concat(c.blocks), []) : [];
  ok(x && x.t.clusters.length === 1 && x.t.clusters[0].timecode === 0 && got.length === want.length
    && got.every((b, i) => clip.subarray(b.start, b.end).equals(FILE.subarray(want[i].start, want[i].end)))
    && Math.abs(x.durationTicks - (last.last - last.timecode + meanFrame)) < 1e-6,
    `cut at the very end: Timecode 0, the source's last ${want.length} blocks, a Duration of ${x && x.durationTicks.toFixed(1)} ms`);
  const all = cutClip({ init: R.init, clusters: C, from: -Infinity, to: Infinity });
  ok(all && readClip(all).t.clusters.length === C.length && readClip(all).points.length === C.length, 'from the very start to the very end is every Cluster, each with a cue');
}

// ── Streams built here: what the recording does not show ──────────────────
{
  // Delta frames opening Clusters: a clip must reach back to a keyframe.
  const s = stream({ clusters: [second(0), second(1000, false), second(2000, false), second(3000), second(4000, false)] });
  const { r } = readAll([s], { keepBytes: true });
  ok(!r.error && r.clusters.map((c) => c.keyframe).join() === 'true,false,false,true,false', 'a Cluster opening on a delta frame reads as not a keyframe');
  const plan = planClip(r.clusters, 2500, 3500);
  ok(plan && plan.clusters.map((c) => c.timecode).join() === '0,1000,2000,3000' && plan.start === 0 && plan.end === 4000,
    'a clip starting between keyframes reaches back to the last keyframe Cluster at or before it, not the Cluster at its start');
  const clip = cutClip({ init: r.init, clusters: r.clusters, from: 2500, to: 3500 });
  const x = clip && readClip(clip);
  ok(x && x.points.map((p) => p.time).join() === '0,3000' && x.t.clusters.map((c) => c.timecode).join() === '0,1000,2000,3000',
    'and its Cues point only at the Clusters that open on a keyframe');
  const late = planClip(r.clusters, 3500, 4500);
  ok(late && late.clusters.map((c) => c.timecode).join() === '3000,4000', 'from 3500 it begins at the keyframe Cluster at 3000');
}
{
  // The keyframe flag is the first VIDEO block's.
  const s = stream({
    tracks: [[1, 1], [2, 2]],
    clusters: [
      { t: 0, blocks: [simple(1, 0, false), simple(1, 33, true)] },
      { t: 1000, blocks: [simple(2, 0, true), simple(1, 10, false), simple(1, 43, true)] },
      { t: 2000, blocks: [simple(2, 0, false), simple(1, 5, true)] },
    ],
  });
  const { r } = readAll([s]);
  ok(!r.error && r.clusters.map((c) => c.keyframe).join() === 'false,false,true'
    && r.clusters.map((c) => c.frames).join() === '2,2,1' && r.clusters[1].first === 1010 && r.clusters[2].first === 2005,
    'a keyframe later in a Cluster does not make it open on one, and another track\'s blocks are not counted');
}
{
  const s = stream({ clusters: [{ t: 0, blocks: [grouped(1, 0, false), simple(1, 33, false)] }, { t: 1000, blocks: [grouped(1, 0, true)] }] });
  const one = readAll([s]);
  const bytewise = readAll(Array.from(s, (b) => Buffer.from([b])));
  ok(!one.r.error && one.r.clusters.map((c) => c.keyframe).join() === 'true,false' && one.r.clusters[0].frames === 2
    && same(bytewise.r.clusters, one.r.clusters),
    'a Block in a BlockGroup is a keyframe unless the group has a ReferenceBlock, read whole or a byte at a time');
}
{
  // What describes the old file, or would no longer match the new Timecode, stays behind.
  const extras = [W.el(0xA7, W.uint(1234)), W.el(0xAB, W.uint(99)), W.el(0xEC, Buffer.alloc(6)), W.el(0xBF, Buffer.alloc(4, 0x77))];
  const s = stream({ clusters: [{ t: 0, blocks: extras.concat([simple(1, 0, true), simple(1, 33, false)]) }, { t: 1000, blocks: [simple(1, 0, true)].concat(extras) }] });
  const { r } = readAll([s], { keepBytes: true });
  const clip = !r.error && cutClip({ init: r.init, clusters: r.clusters, from: 0, to: 1000 });
  const kids = clip ? walkFile(clip).clusters.map((c) => kidsOf(clip, hdr(clip, c.offset).dataStart, c.offset + c.size).map((k) => k.id.toString(16)).join()) : [];
  ok(r.clusters.length === 2 && r.clusters[0].frames === 2 && kids.join(' | ') === 'e7,a3,a3 | e7,a3',
    `a clip keeps a Cluster's new Timecode and its blocks, and leaves Position, PrevSize, Void and CRC-32 behind (${kids.join(' | ')})`);
}
{
  // A first frame a little before its Cluster's Timecode cues at 0, never at a wrapped number.
  const s = stream({ clusters: [second(0), { t: 1000, blocks: [simple(1, -5, true), simple(1, 28, false)] }, second(2000)] });
  const { r } = readAll([s], { keepBytes: true });
  const clip = cutClip({ init: r.init, clusters: r.clusters, from: 1000, to: 1500 });
  const x = clip && readClip(clip);
  ok(r.clusters[1].first === 995 && x && x.points.length === 1 && x.points[0].time === 0, 'a keyframe a few ticks before its Cluster\'s Timecode cues at 0');
}
{
  const s = stream({ scale: 100000, clusters: [{ t: 0, blocks: [simple(1, 0, true), simple(1, 330, false)] }, { t: 10000, blocks: [simple(1, 0, true), simple(1, 330, false)] }] });
  const { r } = readAll([s], { keepBytes: true });
  ok(!r.error && r.timecodeScale === 100000 && r.clusters.map((c) => c.timecode).join() === '0,1000' && r.clusters[0].last === 33,
    'a TimecodeScale of 0.1 ms: Timecodes and frame times in ms');
  const clip = cutClip({ init: r.init, clusters: r.clusters, from: 1000, to: 1000 });
  const x = clip && readClip(clip);
  ok(x && x.t.clusters[0].timecode === 0 && Math.abs(x.durationTicks - 660) < 1e-6 && x.infoKids.some((k) => k.id === 0x2AD7B1 && uintAt(clip, k) === 100000),
    'and a clip of it keeps that scale, its Duration in its ticks');
}
{
  const s = stream({ segmentKnown: true, clusterKnown: true, clusters: [second(0), second(1000)], after: Buffer.from('trailing bytes after the Segment') });
  const { r } = readAll(Array.from(s, (b) => Buffer.from([b])), { keepBytes: true });
  ok(!r.error && r.clusters.length === 2 && r.clusters[1].offset + r.clusters[1].size === s.length - 'trailing bytes after the Segment'.length,
    'a Segment and Clusters of known size read the same, and what follows the Segment is left alone');
  // After the Segment, a block that could be the open Cluster's own.
  const tail = simple(1, 132, true);
  const u = stream({ segmentKnown: true, clusters: [second(0), second(1000)], after: tail });
  const ru = readAll([u]).r;
  ok(!ru.error && ru.clusters.length === 2 && ru.clusters[1].offset + ru.clusters[1].size === u.length - tail.length && ru.clusters[1].frames === 4,
    'an unknown size Cluster ends where its known size Segment does, and a block after it is not its own');
}
{
  // Cut off inside a block, as a crash would leave it.
  const lastBlocks = truth.clusters[truth.clusters.length - 1].blocks;
  const cutAt = lastBlocks[5].start + 9;
  const { r, closed } = readAll([FILE.subarray(0, cutAt)], { keepBytes: true });
  const L = r.clusters[r.clusters.length - 1];
  ok(!r.error && r.clusters.length === C.length && L.truncated && L.frames === 5 && L.offset + L.size === lastBlocks[5].start
    && L.data.equals(FILE.subarray(L.offset, lastBlocks[5].start)) && same(strip(r.clusters.slice(0, -1)), strip(C.slice(0, -1))) && closed.length === C.length,
    'a stream cut off inside a block: the last Cluster is marked truncated, ends at its last whole block, and the rest stand');
  const clip = cutClip({ init: r.init, clusters: r.clusters, from: L.timecode, to: Infinity });
  ok(clip && readClip(clip).t.clusters[0].blocks.length === 5, 'and it still cuts');
  const atBoundary = readAll([FILE.subarray(0, lastBlocks[5].start)]).r;
  const lb = atBoundary.clusters[atBoundary.clusters.length - 1];
  ok(!atBoundary.error && !lb.truncated && lb.frames === 5, 'cut off between two blocks, nothing was lost inside one, so it is not marked truncated');
}

// ── Nonsense ──────────────────────────────────────────────────────────────
// Refused where the nonsense is, while it is pushed, not only once the stream
// ends; `atEnd` for a stream whose only fault is stopping too soon.
function refused(what, pieces, expectClusters, atEnd) {
  const run = noThrow(() => {
    const r = createReader();
    for (const p of pieces) r.push(p);
    const during = r.error;
    r.end();
    return { r, during };
  });
  const r = run.value && run.value.r;
  const when = atEnd ? !!r && !run.value.during : !!r && !!run.value.during;
  ok(!run.threw && r && typeof r.error === 'string' && r.error.length > 0 && when && (expectClusters === undefined || r.clusters.length === expectClusters),
    `${what}: refused ${atEnd ? 'when it ends' : 'as it is pushed'}, not thrown (${run.threw ? 'THREW ' + run.threw.message : r.error})`);
  return r;
}
for (const [what, x] of [['null', null], ['undefined', undefined], ['a string', 'EBML'], ['a number', 42], ['an object', { length: 3 }]]) {
  refused(`a chunk that is ${what}`, [x], 0);
}
{
  const typed = readAll([new Uint8Array(FILE)]).r;
  ok(!typed.error && same(typed.clusters, strip(C)), 'fed a Uint8Array, the same Clusters');
  const viaAb = readAll(CHUNKS.map((ch) => ch.buffer.slice(ch.byteOffset, ch.byteOffset + ch.length))).r;
  ok(!viaAb.error && same(viaAb.clusters, strip(C)), 'fed ArrayBuffers, as IPC hands them over, the same');
}
refused('an empty stream', [], 0, true);
refused('the text of a page', [Buffer.from('<!doctype html><title>no</title>')], 0);
refused('a PNG', [Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A])], 0);
{
  // 0x1F would begin a four byte ID, so only the EBML check turns it away this early.
  const r = createReader();
  r.push(Buffer.from([0x1F]));
  ok(r.error && r.bytes === 1, 'a first byte that cannot begin an EBML header is refused at once, without waiting for more');
}
{
  let seed = 99;
  const rand = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return Math.floor(seed / 8388608) & 0xFF; };
  for (let k = 0; k < 20; k++) {
    const junk = Buffer.from(Array.from({ length: 4096 }, rand));
    const run = noThrow(() => readAll([FILE.subarray(0, 4), junk]));
    if (run.threw || !run.value.r.error) { ok(false, 'random bytes after an EBML ID are refused, not thrown'); break; }
    if (k === 19) ok(true, 'twenty runs of random bytes after an EBML ID: every one refused, none thrown');
  }
}
refused('the stream ended inside the EBML header', [FILE.subarray(0, 20)], 0, true);
refused('the stream ended before its first Cluster', [FILE.subarray(0, R.init.length)], 0, true);
refused('a DocType that is not matroska or webm', [stream({ docType: 'mp4x', clusters: [second(0)] })], 0);
refused('an EBML header of unknown size', [Buffer.concat([W.unknown(0x1A45DFA3), W.el(0x4282, 'webm')])], 0);
refused('no Segment after the EBML header', [Buffer.concat([EBML_HEAD(), INFO()])], 0);
refused('an Info of unknown size', [Buffer.concat([EBML_HEAD(), W.unknown(0x18538067), W.unknown(0x1549A966)])], 0);
refused('a Cluster before Tracks', [Buffer.concat([EBML_HEAD(), W.unknown(0x18538067), INFO(), W.unknown(CLUSTER), W.el(0xE7, W.uint(0))])], 0);
refused('Tracks with no video track', [stream({ tracks: [[2, 2]], clusters: [second(0)] })], 0);
refused('a block before its Cluster\'s Timecode', [Buffer.concat([EBML_HEAD(), W.unknown(0x18538067), INFO(), TRACKS(), W.unknown(CLUSTER), simple(1, 0, true)])]);
refused('an element running past the end of its Cluster', [Buffer.concat([EBML_HEAD(), W.unknown(0x18538067), INFO(), TRACKS(),
  W.id(CLUSTER), W.size(8), W.el(0xE7, W.uint(0)), simple(1, 0, true)])]);
refused('an element ID with no length marker', [Buffer.concat([EBML_HEAD(), W.unknown(0x18538067), Buffer.from([0x00, 0x81, 0x00])])], 0);
refused('an Info too big to be one', [Buffer.concat([EBML_HEAD(), W.unknown(0x18538067), W.id(0x1549A966), W.size(webm.MAX_META + 1)])], 0);
refused('no Cluster in the first megabyte', [Buffer.concat([EBML_HEAD(), W.unknown(0x18538067), INFO(), TRACKS(), W.id(0xEC), W.size(webm.MAX_INIT)])], 0);
{
  // Garbage after two good Clusters: they stand, and the third is closed at its last whole child.
  const good = stream({ clusters: [second(0), second(1000), second(2000)] });
  const clean = readAll([good]).r;
  // A well formed element of an ID no Segment holds: only that check stops it.
  const broken = Buffer.concat([good, Buffer.from([0x42, 0x42, 0x81, 0x00])]);
  const r = refused('an element no Segment holds, after the Clusters', [broken], 3);
  ok(same(r.clusters, clean.clusters), 'and the Clusters read before it are the same as a clean read\'s');
  const huge = Buffer.concat([stream({ clusters: [second(0), second(1000)] }), W.id(0xA3), W.size(webm.MAX_ELEMENT + 1)]);
  const rh = refused('a block of more than 64 MB', [huge], 2);
  ok(rh.clusters[1].frames === 4 && !rh.clusters[1].truncated, 'the Cluster it was in closes at its last whole block');
}
{
  // Zeros written over a Cluster's start in the real recording.
  const dirty = Buffer.from(FILE);
  dirty.fill(0, C[6].offset, C[6].offset + 4);
  const r = refused('a real recording with its seventh Cluster\'s ID zeroed', [dirty]);
  ok(same(strip(r.clusters.slice(0, 6)), strip(C.slice(0, 6))), 'the six Clusters before it are read as they were');
}
{
  const r = createReader();
  r.push(Buffer.from('nope'));
  const err = r.error;
  ok(same(r.push(FILE), []) && r.error === err && r.clusters.length === 0, 'once refused, more chunks are ignored and the reason kept');
  const done = createReader();
  done.push(FILE);
  done.end();
  ok(same(done.push(FILE), []) && same(done.end(), []) && done.clusters.length === C.length, 'once ended, more chunks and a second end change nothing');
}
{
  const bad = [
    ['nothing', () => cutClip()],
    ['an empty object', () => cutClip({})],
    ['a string', () => cutClip('clip')],
    ['an init that is not one', () => cutClip({ init: Buffer.from('init'), clusters: C, from: 0, to: 1000 })],
    ['a recording\'s Cluster as the init', () => cutClip({ init: C[0].data, clusters: C, from: 0, to: 1000 })],
    ['no Clusters', () => cutClip({ init: R.init, clusters: [], from: 0, to: 1000 })],
    ['Clusters that are not an array', () => cutClip({ init: R.init, clusters: 'C', from: 0, to: 1000 })],
    ['a start that is not a number', () => cutClip({ init: R.init, clusters: C, from: '0', to: 1000 })],
    ['a start of NaN', () => cutClip({ init: R.init, clusters: C, from: NaN, to: 1000 })],
    ['an end before the start', () => cutClip({ init: R.init, clusters: C, from: 3000, to: 2000 })],
    ['an end before the first keyframe', () => cutClip({ init: R.init, clusters: C.slice(2), from: 0, to: 1000 })],
    ['a start after the last frame has ended', () => cutClip({ init: R.init, clusters: C, from: C[C.length - 1].last + 1000, to: Infinity })],
    ['Clusters out of order', () => cutClip({ init: R.init, clusters: [C[3], C[2]], from: 0, to: 9999 })],
    ['Clusters with no bytes and no read', () => cutClip({ init: R.init, clusters: strip(C), from: 0, to: 1000 })],
    ['a read that throws', () => cutClip({ init: R.init, clusters: strip(C), from: 0, to: 1000, read: () => { throw new Error('gone'); } })],
    ['a read that returns the wrong length', () => cutClip({ init: R.init, clusters: strip(C), from: 0, to: 1000, read: (c) => FILE.subarray(c.offset, c.offset + c.size - 1) })],
    ['bytes that are not a Cluster', () => cutClip({ init: R.init, clusters: C.map((c) => Object.assign({}, c, { data: Buffer.alloc(c.size, 0x41) })), from: 0, to: 1000 })],
    // The right size and shape under another four byte ID: only the ID says it is not one.
    ['a Cluster\'s blocks under the ID of Tags', () => cutClip({ init: R.init, clusters: C.map((c) => Object.assign({}, c, { data: Buffer.concat([Buffer.from([0x12, 0x54, 0xC3, 0x67]), c.data.subarray(4)]) })), from: 0, to: 1000 })],
    ['bytes of another Cluster', () => cutClip({ init: R.init, clusters: C.map((c, i) => Object.assign({}, c, { data: C[i + 1] ? C[i + 1].data : c.data })), from: 0, to: 1000 })],
  ];
  for (const [what, fn] of bad) {
    const run = noThrow(fn);
    ok(!run.threw && run.value === null, `cutClip refuses ${what}: null, not thrown${run.threw ? ' (THREW ' + run.threw.message + ')' : ''}`);
  }
  ok([null, undefined, 3, 'x', Buffer.alloc(0), Buffer.from('nope'), FILE.subarray(0, 40)].every((x) => noThrow(() => parseInit(x)).value === null),
    'parseInit refuses what is not an init segment, never throws');
}

// ── indexFile ─────────────────────────────────────────────────────────────
{
  const realRead = fs.readSync;
  const realWhole = fs.readFileSync;
  const lengths = [];
  let whole = 0;
  fs.readSync = function patched(fd, buf, off, len, position) { lengths.push(len); return realRead.call(fs, fd, buf, off, len, position); };
  fs.readFileSync = function patched(...args) { whole++; return realWhole.apply(fs, args); };
  let r;
  try { r = indexFile(FIXTURE, { keepBytes: true }); } finally { fs.readSync = realRead; fs.readFileSync = realWhole; }
  ok(!r.error && same(r.clusters, C) && r.init.equals(R.init), 'indexFile reads the recording on disk to the same Clusters');
  ok(whole === 0 && lengths.length > 1 && Math.max(...lengths) <= 65536,
    `in ${lengths.length} pieces of at most ${Math.max(...lengths)} bytes, never the whole file at once`);
  const missing = noThrow(() => indexFile(path.join(__dirname, 'fixtures', 'no-such-recording.mkv')));
  ok(!missing.threw && missing.value.error && missing.value.clusters.length === 0, `a file that is not there: ${missing.value && missing.value.error}`);
}

console.log(`\n${fails ? fails + ' of ' + checks + ' failed' : 'all ' + checks + ' webm checks passed'}`);
process.exit(fails ? 1 : 0);
