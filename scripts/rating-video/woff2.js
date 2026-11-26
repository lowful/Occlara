'use strict';

/**
 * WOFF2 TO A PLAIN TRUETYPE FONT, pure node (the rating video tool,
 * docs/claude/rating.md "The video tool"). The app ships its own font, Geist,
 * only as woff2 (assets/fonts), and the bundled ffmpeg's freetype and libass
 * cannot read woff2 (no brotli in that build). So the tool decodes the app's
 * own files to .ttf in a temporary folder before it draws: the same letters
 * as the app and the widget, no font from the system, nothing fetched.
 *
 * The format is the W3C's WOFF2 (https://www.w3.org/TR/WOFF2/): a header, a
 * table directory, one brotli stream with every table, the glyf and loca
 * tables usually in their transformed form (rebuilt here, section 5.1) and
 * hmtx sometimes (5.4). A font collection is not supported (the app has none).
 *
 *   const { woff2ToTtf } = require('./woff2'); fs.writeFileSync('x.ttf', woff2ToTtf(fs.readFileSync('x.woff2')));
 */

const zlib = require('zlib');

const KNOWN = ['cmap', 'head', 'hhea', 'hmtx', 'maxp', 'name', 'OS/2', 'post', 'cvt ', 'fpgm', 'glyf', 'loca', 'prep', 'CFF ', 'VORG',
  'EBDT', 'EBLC', 'gasp', 'hdmx', 'kern', 'LTSH', 'PCLT', 'VDMX', 'vhea', 'vmtx', 'BASE', 'GDEF', 'GPOS', 'GSUB', 'EBSC', 'JSTF',
  'MATH', 'CBDT', 'CBLC', 'COLR', 'CPAL', 'SVG ', 'sbix', 'acnt', 'avar', 'bdat', 'bloc', 'bsln', 'cvar', 'fdsc', 'feat', 'fmtx',
  'fvar', 'gvar', 'hsty', 'just', 'lcar', 'mort', 'morx', 'opbd', 'prop', 'trak', 'Zapf', 'Silf', 'Glat', 'Gloc', 'Feat', 'Sill'];

class Reader {
  constructor(buf, at) { this.b = buf; this.p = at || 0; }
  u8() { return this.b[this.p++]; }
  u16() { const v = this.b.readUInt16BE(this.p); this.p += 2; return v; }
  i16() { const v = this.b.readInt16BE(this.p); this.p += 2; return v; }
  u32() { const v = this.b.readUInt32BE(this.p); this.p += 4; return v; }
  base128() {
    let v = 0;
    for (let i = 0; i < 5; i++) {
      const c = this.u8();
      if (i === 0 && c === 0x80) throw new Error('woff2: a UIntBase128 with a leading zero');
      if (v & 0xfe000000) throw new Error('woff2: a UIntBase128 over 32 bits');
      v = (v << 7) | (c & 0x7f);
      if (!(c & 0x80)) return v >>> 0;
    }
    throw new Error('woff2: a UIntBase128 longer than five bytes');
  }
  u255() {
    const c = this.u8();
    if (c === 253) return this.u16();
    if (c === 255) return this.u8() + 253;
    if (c === 254) return this.u8() + 506;
    return c;
  }
  bytes(n) { const v = this.b.subarray(this.p, this.p + n); if (v.length !== n) throw new Error('woff2: a stream ran out'); this.p += n; return v; }
}

/** One point's move, from its flag and the glyph stream (section 5.2, the triplet encoding). */
function triplet(flag, r) {
  const sign = (f, v) => ((f & 1) ? v : -v);
  if (flag < 10) { const b = r.u8(); return [0, sign(flag, ((flag & 14) << 7) + b)]; }
  if (flag < 20) { const b = r.u8(); return [sign(flag, (((flag - 10) & 14) << 7) + b), 0]; }
  if (flag < 84) {
    const b0 = flag - 20; const b1 = r.u8();
    return [sign(flag, 1 + (b0 & 0x30) + (b1 >> 4)), sign(flag >> 1, 1 + ((b0 & 0x0c) << 2) + (b1 & 0x0f))];
  }
  if (flag < 120) {
    const b0 = flag - 84; const x = r.u8(); const y = r.u8();
    return [sign(flag, 1 + (Math.floor(b0 / 12) << 8) + x), sign(flag >> 1, 1 + (((b0 % 12) >> 2) << 8) + y)];
  }
  if (flag < 124) {
    const a = r.u8(); const b = r.u8(); const c = r.u8();
    return [sign(flag, (a << 4) + (b >> 4)), sign(flag >> 1, ((b & 0x0f) << 8) + c)];
  }
  const a = r.u16(); const b = r.u16();
  return [sign(flag, a), sign(flag >> 1, b)];
}

/** The transformed glyf table back to glyf and loca (section 5.1). Answers { glyf, loca, xMins, indexFormat }. */
function untransformGlyf(data) {
  const h = new Reader(data);
  h.u16(); // reserved
  const options = h.u16();
  const numGlyphs = h.u16();
  const indexFormat = h.u16();
  const sizes = [h.u32(), h.u32(), h.u32(), h.u32(), h.u32(), h.u32(), h.u32()];
  let at = h.p;
  const streams = sizes.map((n) => { const s = new Reader(data.subarray(at, at + n)); at += n; return s; });
  const [nContour, nPoints, flags, glyphs, composite, bboxS, instr] = streams;
  const bitmapLen = 4 * Math.floor((numGlyphs + 31) / 32);
  const bboxBits = bboxS.bytes(bitmapLen);
  const overlap = (options & 1) ? data.subarray(at, at + ((numGlyphs + 7) >> 3)) : null;
  const hasBox = (i) => (bboxBits[i >> 3] & (0x80 >> (i & 7))) !== 0;
  const out = [];
  const xMins = new Array(numGlyphs).fill(0);
  for (let g = 0; g < numGlyphs; g++) {
    const nc = nContour.i16();
    if (nc === 0) { out.push(Buffer.alloc(0)); continue; }
    if (nc === -1) {
      // A composite: its components as they are, its box always given.
      const start = composite.p;
      let more = true;
      let instructions = false;
      while (more) {
        const f = composite.u16();
        composite.u16();
        composite.p += (f & 0x0001) ? 4 : 2;
        if (f & 0x0008) composite.p += 2; else if (f & 0x0040) composite.p += 4; else if (f & 0x0080) composite.p += 8;
        if (f & 0x0100) instructions = true;
        more = (f & 0x0020) !== 0;
      }
      const comp = composite.b.subarray(start, composite.p);
      const box = [bboxS.i16(), bboxS.i16(), bboxS.i16(), bboxS.i16()];
      xMins[g] = box[0];
      const parts = [Buffer.alloc(10)];
      parts[0].writeInt16BE(-1, 0); box.forEach((v, i) => parts[0].writeInt16BE(v, 2 + i * 2));
      parts.push(Buffer.from(comp));
      if (instructions) {
        const n = glyphs.u255();
        const len = Buffer.alloc(2); len.writeUInt16BE(n, 0);
        parts.push(len, Buffer.from(instr.bytes(n)));
      }
      out.push(Buffer.concat(parts));
      continue;
    }
    if (nc < 0) throw new Error('woff2: a glyph with a negative contour count other than -1');
    const ends = [];
    let total = 0;
    for (let c = 0; c < nc; c++) { total += nPoints.u255(); ends.push(total - 1); }
    const xs = new Array(total); const ys = new Array(total); const on = new Array(total);
    let x = 0; let y = 0;
    for (let p = 0; p < total; p++) {
      const f = flags.u8();
      on[p] = (f & 0x80) === 0;
      const [dx, dy] = triplet(f & 0x7f, glyphs);
      x += dx; y += dy; xs[p] = x; ys[p] = y;
    }
    const nIns = glyphs.u255();
    const ins = instr.bytes(nIns);
    let box;
    if (hasBox(g)) box = [bboxS.i16(), bboxS.i16(), bboxS.i16(), bboxS.i16()];
    else box = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
    xMins[g] = box[0];
    // Written plainly: a flag a point, each coordinate a 16 bit move.
    const ov = overlap && (overlap[g >> 3] & (0x80 >> (g & 7))) ? 0x40 : 0;
    const b = Buffer.alloc(10 + nc * 2 + 2 + nIns + total + total * 4);
    let o = 0;
    b.writeInt16BE(nc, o); o += 2;
    for (const v of box) { b.writeInt16BE(v, o); o += 2; }
    for (const e of ends) { b.writeUInt16BE(e, o); o += 2; }
    b.writeUInt16BE(nIns, o); o += 2;
    Buffer.from(ins).copy(b, o); o += nIns;
    for (let p = 0; p < total; p++) b[o++] = (on[p] ? 1 : 0) | (p === 0 ? ov : 0);
    let px = 0;
    for (let p = 0; p < total; p++) { b.writeInt16BE(xs[p] - px, o); o += 2; px = xs[p]; }
    let py = 0;
    for (let p = 0; p < total; p++) { b.writeInt16BE(ys[p] - py, o); o += 2; py = ys[p]; }
    out.push(b);
  }
  // Every glyph padded to four bytes, loca in the format the head names.
  const offs = [0];
  const padded = out.map((g) => { const n = (g.length + 3) & ~3; const p = Buffer.alloc(n); g.copy(p); offs.push(offs[offs.length - 1] + n); return p; });
  const glyf = Buffer.concat(padded);
  const loca = Buffer.alloc(indexFormat ? offs.length * 4 : offs.length * 2);
  offs.forEach((v, i) => { if (indexFormat) loca.writeUInt32BE(v, i * 4); else loca.writeUInt16BE(v / 2, i * 2); });
  return { glyf, loca, xMins, indexFormat, numGlyphs };
}

/** The transformed hmtx back (section 5.4): a missing side bearing is the glyph's xMin. */
function untransformHmtx(data, numGlyphs, numHMetrics, xMins) {
  const r = new Reader(data);
  const f = r.u8();
  const adv = []; for (let i = 0; i < numHMetrics; i++) adv.push(r.u16());
  const lsb = [];
  for (let i = 0; i < numHMetrics; i++) lsb.push((f & 1) ? xMins[i] : r.i16());
  for (let i = numHMetrics; i < numGlyphs; i++) lsb.push((f & 2) ? xMins[i] : r.i16());
  const b = Buffer.alloc(numHMetrics * 4 + (numGlyphs - numHMetrics) * 2);
  let o = 0;
  for (let i = 0; i < numHMetrics; i++) { b.writeUInt16BE(adv[i], o); b.writeInt16BE(lsb[i], o + 2); o += 4; }
  for (let i = numHMetrics; i < numGlyphs; i++) { b.writeInt16BE(lsb[i], o); o += 2; }
  return b;
}

function checksum(b) {
  let s = 0;
  const n = (b.length + 3) & ~3;
  const p = b.length === n ? b : Buffer.concat([b, Buffer.alloc(n - b.length)]);
  for (let i = 0; i < n; i += 4) s = (s + p.readUInt32BE(i)) >>> 0;
  return s;
}

/** A woff2 file's bytes to a TrueType font's bytes. Throws on anything it cannot read. */
function woff2ToTtf(buf) {
  const r = new Reader(buf);
  if (r.u32() !== 0x774f4632) throw new Error('woff2: not a woff2 file');
  const flavor = r.u32();
  if (flavor === 0x74746366) throw new Error('woff2: a font collection is not supported');
  r.u32(); // length
  const numTables = r.u16();
  r.u16(); r.u32();
  const compressed = r.u32();
  r.u16(); r.u16(); r.u32(); r.u32(); r.u32(); r.u32(); r.u32();
  const tables = [];
  for (let i = 0; i < numTables; i++) {
    const f = r.u8();
    const tag = (f & 0x3f) === 0x3f ? buf.subarray(r.p, r.p + 4).toString('latin1') : KNOWN[f & 0x3f];
    if ((f & 0x3f) === 0x3f) r.p += 4;
    const version = (f >> 6) & 3;
    const orig = r.base128();
    const transformed = (tag === 'glyf' || tag === 'loca') ? version === 0 : version !== 0;
    const len = transformed ? r.base128() : orig;
    tables.push({ tag, orig, len, transformed });
  }
  const data = zlib.brotliDecompressSync(buf.subarray(r.p, r.p + compressed));
  let at = 0;
  for (const t of tables) { t.data = data.subarray(at, at + t.len); at += t.len; }
  const by = (tag) => tables.find((t) => t.tag === tag);
  const glyf = by('glyf');
  let rebuilt = null;
  if (glyf && glyf.transformed) {
    rebuilt = untransformGlyf(glyf.data);
    glyf.data = rebuilt.glyf;
    by('loca').data = rebuilt.loca;
  }
  const hmtx = by('hmtx');
  if (hmtx && hmtx.transformed) {
    if (!rebuilt) throw new Error('woff2: a transformed hmtx needs the transformed glyf');
    const numHMetrics = by('hhea').data.readUInt16BE(34);
    hmtx.data = untransformHmtx(hmtx.data, rebuilt.numGlyphs, numHMetrics, rebuilt.xMins);
  }
  // head: the loca format the glyf was rebuilt in, the checksum adjustment zeroed until the end.
  const head = Buffer.from(by('head').data);
  if (rebuilt) head.writeInt16BE(rebuilt.indexFormat, 50);
  head.writeUInt32BE(0, 8);
  by('head').data = head;
  // The font: the offset table, the records sorted by tag, each table padded to four bytes.
  const sorted = tables.slice().sort((a, b) => (a.tag < b.tag ? -1 : a.tag > b.tag ? 1 : 0));
  let pow = 1; let lg = 0; while (pow * 2 <= numTables) { pow *= 2; lg++; }
  const dir = Buffer.alloc(12 + numTables * 16);
  dir.writeUInt32BE(flavor, 0); dir.writeUInt16BE(numTables, 4);
  dir.writeUInt16BE(pow * 16, 6); dir.writeUInt16BE(lg, 8); dir.writeUInt16BE(numTables * 16 - pow * 16, 10);
  let off = dir.length;
  const bodies = [];
  sorted.forEach((t, i) => {
    const d = Buffer.from(t.data);
    const o = 12 + i * 16;
    dir.write(t.tag, o, 4, 'latin1');
    dir.writeUInt32BE(checksum(d), o + 4); dir.writeUInt32BE(off, o + 8); dir.writeUInt32BE(d.length, o + 12);
    t.offset = off;
    const n = (d.length + 3) & ~3;
    const p = Buffer.alloc(n); d.copy(p);
    bodies.push(p); off += n;
  });
  const font = Buffer.concat([dir, ...bodies]);
  const headAt = by('head').offset;
  font.writeUInt32BE((0xb1b0afba - checksum(font)) >>> 0, headAt + 8);
  return font;
}

module.exports = { woff2ToTtf, triplet };
