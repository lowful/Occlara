'use strict';
/**
 * THE MOON'S SURFACE, FROM NASA'S OWN MAPS (9.1, the owner's item 9).
 *
 * Writes the two pictures the turning moon samples (src/renderer/shared/
 * sky.js), from real lunar data, never drawn:
 *
 *   assets/moon/albedo.webp  4096 x 1024, grey: how bright the ground is,
 *                            the CGI Moon Kit's colour map (LRO's Wide Angle
 *                            Camera, Hapke normalised, so it carries no
 *                            shadows of its own) as its luminance.
 *   assets/moon/relief.webp  2048 x 1024, grey: the ground's slope, worked
 *                            out here from LOLA's elevation model (LRO's
 *                            laser altimeter), east slope in the top half,
 *                            north slope in the bottom half, 128 level.
 *
 * Both are the band of latitude the moon's turn ever shows (LAT below, the
 * same number as sky.js), equirectangular, longitude -180 at the left edge
 * and east to the right, north at the top. The light falls on the relief in
 * the page, so a crater's shadow moves as the moon turns.
 *
 * Sources (NASA imagery and data are not copyrighted; see assets/README.txt):
 *   colour  CGI Moon Kit, NASA's Scientific Visualization Studio
 *           (svs.gsfc.nasa.gov/4720), its full map lroc_color_poles.tif,
 *           27360 by 13680, the copy on Wikimedia Commons (the SVS download
 *           links answer 403 from here; the file is the same), COLOR_URL.
 *   height  LOLA's gridded elevation model at 16 pixels a degree, ldem_16,
 *           from NASA's Planetary Data System (Geosciences Node), DEM_URL.
 *
 *   node scripts/make-moon-maps.js [--color <tif or png>] [--dem <ldem_16.img>]
 *
 * Given no files it downloads both into the system's temp folder first
 * (the colour map is 518 MB). A TIFF that large is more than ffmpeg opens,
 * so it is reduced first to 8192 by 4096, its luminance, by Python's Pillow
 * (python with Pillow on the PATH); any smaller equirectangular colour map
 * centred on longitude 0 is read as it is. The pictures are encoded by the
 * bundled ffmpeg (ffmpeg-static). Dev tool, never shipped.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'assets', 'moon');
const FFMPEG = require('ffmpeg-static');

const COLOR_URL = 'https://upload.wikimedia.org/wikipedia/commons/4/4b/CGI_Moon_Kit_-_Lroc_color_poles.tif';
const DEM_URL = 'https://pds-geosciences.wustl.edu/lro/lro-l-lola-3-rdr-v1/lrolol_1xxx/data/lola_gdr/cylindrical/img/ldem_16.img';

// The band of latitude, as sky.js has it (const LAT).
const LAT = 64;
const ALB_W = 4096, ALB_H = 1024;
const REL_W = 2048, REL_H = 512;          // each half of relief.webp
// The steepest slope relief.webp keeps (sky.js const SLOPE): steeper is held
// there (0.03% of the band). A 4096 wide relief was tried: no sharper at 2x
// to the eye, and 300 KB more.
const SLOPE = 0.45;
const MOON_R = 1737400;                   // metres, LOLA's reference sphere
// WebP qualities: about 590 KB and 520 KB, a mean error of 2.4 and 2.8 levels of 255.
const ALB_Q = 82, REL_Q = 80;

const arg = (name) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : null; };

async function fetchTo(url, file) {
  if (fs.existsSync(file) && fs.statSync(file).size > 0) return file;
  console.log(`downloading ${url}`);
  const res = await fetch(url, { headers: { 'User-Agent': 'occlara-make-moon-maps/1.0 (a dev tool)' } });
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()));
  return file;
}

/*
 * The full colour map reduced by Pillow: its luminance (Rec. 709 weights on
 * the sRGB values), Lanczos to 8192 by 4096, a grey PNG. Run with -P, so
 * nothing beside the file or in the working folder is imported.
 */
const REDUCE_PY = [
  'import sys',
  'from PIL import Image',
  'Image.MAX_IMAGE_PIXELS = None',
  'im = Image.open(sys.argv[1]).convert("RGB")',
  'im = im.convert("L", (0.2126, 0.7152, 0.0722, 0))',
  'im = im.resize((8192, 4096), Image.LANCZOS, reducing_gap=3.0)',
  'im.save(sys.argv[2])',
].join('\n');
function reduceTiff(file) {
  const out = path.join(os.tmpdir(), 'occlara-moon-src', 'lroc_luma_8192.png');
  if (fs.existsSync(out) && fs.statSync(out).mtimeMs > fs.statSync(file).mtimeMs) return out;
  console.log('reducing the colour map with Pillow (a minute or two)');
  const r = spawnSync('python', ['-P', '-c', REDUCE_PY, file, out], { encoding: 'utf8', cwd: os.tmpdir() });
  if (r.status !== 0) throw new Error(`Pillow could not reduce ${file}: ${r.stderr || r.error}`);
  return out;
}

/** A picture's pixels as rgb24, through ffmpeg. */
function decodeRgb(file) {
  const probe = spawnSync(FFMPEG, ['-hide_banner', '-i', file], { encoding: 'utf8' });
  const m = String(probe.stderr).match(/Video: [^\n]*?, (\d+)x(\d+)/);
  if (!m) throw new Error(`no size for ${file}`);
  const w = Number(m[1]), h = Number(m[2]);
  const r = spawnSync(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-i', file, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { maxBuffer: w * h * 3 + 1024 });
  if (r.status !== 0 || r.stdout.length !== w * h * 3) throw new Error(`decode ${file}: ${r.stderr}`);
  return { w, h, px: r.stdout };
}

/** Grey bytes to a lossy WebP, through ffmpeg. */
function encodeWebp(file, w, h, bytes, quality) {
  const r = spawnSync(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'rawvideo', '-pix_fmt', 'gray', '-s', `${w}x${h}`, '-i', '-',
    '-vf', 'format=yuv420p', '-c:v', 'libwebp', '-lossless', '0', '-quality', String(quality), '-compression_level', '6', '-preset', 'picture', file], { input: Buffer.from(bytes.buffer, bytes.byteOffset, bytes.length) });
  if (r.status !== 0) throw new Error(`encode ${file}: ${r.stderr}`);
}

/** The WebP back as grey bytes, to measure what the encoding cost. */
function decodeGrey(file, w, h) {
  const r = spawnSync(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-i', file, '-f', 'rawvideo', '-pix_fmt', 'gray', '-'], { maxBuffer: w * h + 1024 });
  return r.stdout;
}

// Lanczos 3, for one axis of a resample.
const sinc = (x) => (x === 0 ? 1 : Math.sin(Math.PI * x) / (Math.PI * x));
const lanczos = (x) => (Math.abs(x) < 3 ? sinc(x) * sinc(x / 3) : 0);

/**
 * One axis of a resample: for each of n outputs, the source taps and their
 * weights. at(i) is output i's centre in source pixels; scale > 1 widens
 * the kernel (shrinking). wrap joins the two ends (longitude).
 */
function taps(n, srcN, at, scale, wrap) {
  const k = Math.max(1, scale), out = [];
  for (let i = 0; i < n; i++) {
    const c = at(i), lo = Math.floor(c - 3 * k), hi = Math.ceil(c + 3 * k);
    const idx = [], wt = [];
    let sum = 0;
    for (let s = lo; s <= hi; s++) {
      const w = lanczos((s + 0.5 - c) / k);
      if (!w) continue;
      let j = s;
      if (wrap) j = ((s % srcN) + srcN) % srcN; else j = Math.min(srcN - 1, Math.max(0, s));
      idx.push(j); wt.push(w); sum += w;
    }
    out.push({ idx, wt: wt.map((w) => w / sum) });
  }
  return out;
}

/** A field resampled onto the band: longitude -180..180 across, LAT..-LAT down. */
function toBand(src, sw, sh, w, h, lonOfCol0) {
  // Source pixel centres: column c at lonOfCol0 + (c + 0.5) * 360 / sw, row r at 90 - (r + 0.5) * 180 / sh.
  const tx = taps(w, sw, (i) => ((-180 + (i + 0.5) * 360 / w) - lonOfCol0) * sw / 360, sw / w, true);
  const ty = taps(h, sh, (j) => (90 - (LAT - (j + 0.5) * 2 * LAT / h)) * sh / 180, (sh * 2 * LAT / 180) / h, false);
  const mid = new Float32Array(w * sh);
  for (let r = 0; r < sh; r++) {
    const row = r * sw;
    for (let i = 0; i < w; i++) {
      const t = tx[i];
      let s = 0;
      for (let k = 0; k < t.idx.length; k++) s += src[row + t.idx[k]] * t.wt[k];
      mid[r * w + i] = s;
    }
  }
  const out = new Float32Array(w * h);
  for (let j = 0; j < h; j++) {
    const t = ty[j];
    for (let i = 0; i < w; i++) {
      let s = 0;
      for (let k = 0; k < t.idx.length; k++) s += mid[t.idx[k] * w + i] * t.wt[k];
      out[j * w + i] = s;
    }
  }
  return out;
}

const pct = (arr, p) => { const a = Float32Array.from(arr).sort(); return a[Math.min(a.length - 1, Math.floor(p * a.length))]; };

(async () => {
  const tmp = path.join(os.tmpdir(), 'occlara-moon-src');
  fs.mkdirSync(tmp, { recursive: true });
  const colorFile = arg('--color') || await fetchTo(COLOR_URL, path.join(tmp, 'lroc_color_poles.tif'));
  const demFile = arg('--dem') || await fetchTo(DEM_URL, path.join(tmp, 'ldem_16.img'));
  fs.mkdirSync(OUT, { recursive: true });

  // THE ALBEDO: the colour map's luminance (Rec. 709 weights on its sRGB
  // values, which is what the eye reads as its brightness), kept as sRGB.
  const c = decodeRgb(/\.tiff?$/i.test(colorFile) ? reduceTiff(colorFile) : colorFile);
  const lum = new Float32Array(c.w * c.h);
  for (let i = 0; i < lum.length; i++) lum[i] = (0.2126 * c.px[i * 3] + 0.7152 * c.px[i * 3 + 1] + 0.0722 * c.px[i * 3 + 2]) / 255;
  // The map is centred on longitude 0: its first column starts at -180.
  const alb = toBand(lum, c.w, c.h, ALB_W, ALB_H, -180);
  const albBytes = new Uint8Array(alb.length);
  for (let i = 0; i < alb.length; i++) albBytes[i] = Math.max(0, Math.min(255, Math.round(alb[i] * 255)));
  const albFile = path.join(OUT, 'albedo.webp');
  encodeWebp(albFile, ALB_W, ALB_H, albBytes, ALB_Q);
  const albBack = decodeGrey(albFile, ALB_W, ALB_H);
  let albErr = 0;
  for (let i = 0; i < albBytes.length; i++) albErr += Math.abs(albBack[i] - albBytes[i]);
  console.log(`albedo ${ALB_W}x${ALB_H}: ${(fs.statSync(albFile).size / 1024).toFixed(0)} KB, mean error ${(albErr / albBytes.length).toFixed(2)} of 255,`
    + ` levels p1 ${(pct(alb, 0.01) * 255).toFixed(0)} p50 ${(pct(alb, 0.5) * 255).toFixed(0)} p99 ${(pct(alb, 0.99) * 255).toFixed(0)}`);

  // THE RELIEF: LOLA's heights (int16, half metres above the reference
  // sphere), its first column at longitude 0 running east, its first row at
  // the north pole. Slopes at its own 16 pixels a degree, then resampled.
  const DW = 5760, DH = 2880;
  const raw = fs.readFileSync(demFile);
  if (raw.length !== DW * DH * 2) throw new Error(`ldem_16.img is ${raw.length} bytes, not ${DW * DH * 2}`);
  const hgt = new Float32Array(DW * DH);
  for (let i = 0; i < hgt.length; i++) hgt[i] = raw.readInt16LE(i * 2) * 0.5;
  const dLon = (2 * Math.PI) / DW, dLat = Math.PI / DH;
  const east = new Float32Array(DW * DH), north = new Float32Array(DW * DH);
  for (let r = 0; r < DH; r++) {
    const lat = (90 - (r + 0.5) * 180 / DH) * Math.PI / 180;
    const dx = 2 * MOON_R * Math.max(0.02, Math.cos(lat)) * dLon, dy = 2 * MOON_R * dLat;
    const up = Math.max(0, r - 1), down = Math.min(DH - 1, r + 1);
    for (let i = 0; i < DW; i++) {
      const L = r * DW + ((i + DW - 1) % DW), R = r * DW + ((i + 1) % DW);
      east[r * DW + i] = (hgt[R] - hgt[L]) / dx;
      north[r * DW + i] = (hgt[up * DW + i] - hgt[down * DW + i]) / (dy * (down - up) / 2);
    }
  }
  const se = toBand(east, DW, DH, REL_W, REL_H, 0);
  const sn = toBand(north, DW, DH, REL_W, REL_H, 0);
  const abs = new Float32Array(se.length);
  for (let i = 0; i < se.length; i++) abs[i] = Math.hypot(se[i], sn[i]);
  const rel = new Uint8Array(REL_W * REL_H * 2);
  let held = 0;
  const enc = (s) => { if (Math.abs(s) > SLOPE) held++; return Math.max(0, Math.min(255, Math.round(128 + 127 * Math.max(-1, Math.min(1, s / SLOPE))))); };
  for (let i = 0; i < se.length; i++) { rel[i] = enc(se[i]); rel[se.length + i] = enc(sn[i]); }
  const relFile = path.join(OUT, 'relief.webp');
  encodeWebp(relFile, REL_W, REL_H * 2, rel, REL_Q);
  const relBack = decodeGrey(relFile, REL_W, REL_H * 2);
  let relErr = 0;
  for (let i = 0; i < rel.length; i++) relErr += Math.abs(relBack[i] - rel[i]);
  console.log(`relief ${REL_W}x${REL_H * 2}: ${(fs.statSync(relFile).size / 1024).toFixed(0)} KB, mean error ${(relErr / rel.length).toFixed(2)} of 255,`
    + ` slope p50 ${pct(abs, 0.5).toFixed(3)} p99 ${pct(abs, 0.99).toFixed(3)} p99.9 ${pct(abs, 0.999).toFixed(3)}, held at ${SLOPE}: ${(100 * held / rel.length).toFixed(3)}%`);
})().catch((e) => { console.error(e); process.exit(1); });
