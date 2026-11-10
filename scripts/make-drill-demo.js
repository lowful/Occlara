'use strict';

/**
 * A DRILL'S DEMO (8.11): turns a recording the owner made of a drill into the
 * two files the Practice page shows on that drill's card, a short muted loop
 * and its poster, for the website to host under https://occlara.app/drills/.
 *
 *   node scripts/make-drill-demo.js <input> <start s> <length s> <drill id> <out dir>
 *        [--720] [--blur x,y,w,h]... [--crf n] [--fit] [--poster-at s] [--ffmpeg path]
 *
 *   input      the owner's own recording (OBS, ShadowPlay, any file ffmpeg reads)
 *   start      where the kept part starts, in seconds into the recording
 *   length     how long it is, 6 to 12 seconds
 *   drill id   an id of src/shared/drill-library.json; the files are named after it
 *   out dir    where <id>.webm and <id>.webp are written
 *
 *   --720         1280x720 in place of the default 1920x1080
 *   --blur x,y,w,h  a box hidden by blocks and blur, in the RECORDING's own
 *                 pixels (measure it on a screenshot of the recording at its
 *                 own size), as many times as there are boxes: the kill feed,
 *                 the scoreboard, the chat, anything with another player's name
 *   --crf n       the quality, 26 by default (lower is sharper and larger)
 *   --fit         over 3 MB, encoded again 3 CRF softer each time, up to CRF 36
 *   --poster-at s seconds into the kept part for the poster, 0 by default, so
 *                 the poster is the loop's own first frame and nothing jumps
 *                 when it starts playing
 *   --ffmpeg path the ffmpeg to use; else OCCLARA_FFMPEG, else ffmpeg on PATH
 *
 * HIGH QUALITY, SMALL ENOUGH. VP9 in WebM, two pass at a constant quality
 * (-crf 26 with -b:v 0, -row-mt 1), 1920x1080 scaled to fit with black bars
 * where the recording is another shape, 60 frames a second kept when the
 * recording has them (30 otherwise), no sound and no metadata. Roughly 1.5 to
 * 3 MB for 6 to 12 seconds; the size is printed with a hint when it is
 * outside that. The poster is a WebP of the same size at quality 90.
 *
 * NO OTHER PLAYER'S NAME may be visible in a demo (CLAUDE.md, games.md): crop
 * the recording or hide each place a name shows with --blur, and look at every
 * second of the result before it is uploaded. docs/drill-demo-guide.md says
 * what to record for each drill and how.
 *
 * The app's own clips are cut in plain JavaScript (review-clips.js has no
 * ffmpeg); this tool, like export-site-proof.js, uses ffmpeg from PATH. Dev
 * tool, never shipped: electron-builder packages src/ and assets/ only.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const LIBRARY = path.join(ROOT, 'src', 'shared', 'drill-library.json');
const DEMO_BASE = 'https://occlara.app/drills/';
const MIN_S = 6;
const MAX_S = 12;
const AIM_LOW = 1.5 * 1024 * 1024;
const AIM_HIGH = 3 * 1024 * 1024;

function fail(msg) {
  console.error(`FAIL: ${msg}`);
  process.exit(1);
}

function usage() {
  console.log('Usage: node scripts/make-drill-demo.js <input> <start s> <length s> <drill id> <out dir> [--720] [--blur x,y,w,h]... [--crf n] [--fit] [--poster-at s] [--ffmpeg path]');
}

/** The arguments, read and checked. */
function readArgs(argv) {
  const pos = [];
  const o = { hd: true, blur: [], crf: 26, posterAt: 0, ffmpeg: process.env.OCCLARA_FFMPEG || 'ffmpeg' };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => { if (i + 1 >= argv.length) fail(`${a} needs a value`); return argv[++i]; };
    if (a === '--720') o.hd = false;
    else if (a === '--1080') o.hd = true;
    else if (a === '--blur') o.blur.push(next());
    else if (a === '--crf') o.crf = Number(next());
    else if (a === '--fit') o.fit = true;
    else if (a === '--poster-at') o.posterAt = Number(next());
    else if (a === '--ffmpeg') o.ffmpeg = next();
    else if (a === '--help' || a === '-h') { usage(); process.exit(0); }
    else if (a.startsWith('--')) fail(`unknown option ${a}`);
    else pos.push(a);
  }
  if (pos.length !== 5) { usage(); fail('give the input, the start, the length, the drill id and the out dir'); }
  const [input, start, length, id, out] = pos;
  o.input = path.resolve(input);
  o.start = Number(start);
  o.length = Number(length);
  o.id = id;
  o.out = path.resolve(out);
  if (!fs.existsSync(o.input) || !fs.statSync(o.input).isFile()) fail(`no recording at ${o.input}`);
  if (!Number.isFinite(o.start) || o.start < 0) fail('the start is seconds into the recording, 0 or more');
  if (!Number.isFinite(o.length) || o.length < MIN_S || o.length > MAX_S) fail(`the length is ${MIN_S} to ${MAX_S} seconds`);
  if (!Number.isFinite(o.crf) || o.crf < 15 || o.crf > 45) fail('--crf is 15 to 45');
  if (!Number.isFinite(o.posterAt) || o.posterAt < 0 || o.posterAt >= o.length) fail('--poster-at is seconds into the kept part, under its length');
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id)) fail(`${id} is not a drill id`);
  let lib = null;
  try { lib = JSON.parse(fs.readFileSync(LIBRARY, 'utf8')); } catch { fail(`could not read ${LIBRARY}`); }
  const drill = (lib.drills || []).find((d) => d && d.id === id);
  if (!drill) fail(`no drill ${id} in src/shared/drill-library.json`);
  o.title = drill.title;
  return o;
}

/** A --blur box, in the recording's pixels, made even and kept inside the frame. */
function boxOf(raw, w, h) {
  const n = String(raw).split(',').map((s) => Number(s.trim()));
  if (n.length !== 4 || n.some((x) => !Number.isFinite(x)) || n[2] <= 0 || n[3] <= 0) fail(`--blur ${raw} is not x,y,w,h`);
  let [x, y, bw, bh] = n.map((v) => Math.round(v));
  // Even edges, grown outward, so the chroma of a 4:2:0 picture is cut cleanly.
  const x2 = Math.min(w, x + bw + ((x + bw) % 2));
  const y2 = Math.min(h, y + bh + ((y + bh) % 2));
  x = Math.max(0, x - (x % 2));
  y = Math.max(0, y - (y % 2));
  bw = x2 - x;
  bh = y2 - y;
  if (bw < 2 || bh < 2) fail(`--blur ${raw} is outside the ${w}x${h} recording`);
  return { x, y, w: bw, h: bh };
}

/** The recording's size, frame rate and length, read off ffmpeg's own description of it. */
function probe(ffmpeg, input) {
  const r = spawnSync(ffmpeg, ['-hide_banner', '-i', input], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
  if (r.error) fail(`could not run ${ffmpeg} (${r.error.code || r.error.message}). Install ffmpeg or pass --ffmpeg <path>`);
  const text = String(r.stderr || '');
  const line = text.split(/\r?\n/).find((l) => /Stream #\d+:\d+.*: Video: /.test(l));
  if (!line) fail('no video stream in the recording');
  const size = /, (\d{2,5})x(\d{2,5})[,\s\[]/.exec(line);
  if (!size) fail('could not read the recording\'s size');
  const fps = /([\d.]+) fps/.exec(line) || /([\d.]+) tbr/.exec(line);
  const dur = /Duration: (\d+):(\d+):([\d.]+)/.exec(text);
  return {
    w: Number(size[1]), h: Number(size[2]),
    fps: fps ? Number(fps[1]) : null,
    duration: dur ? Number(dur[1]) * 3600 + Number(dur[2]) * 60 + Number(dur[3]) : null,
  };
}

/**
 * The filter graph: each --blur box cut out, made into coarse blocks and
 * blurred, laid back where it was, then the picture scaled to fit W x H with
 * black bars, square pixels, the frame rate and 4:2:0.
 */
function graph(boxes, W, H, fps) {
  const tail = [
    `scale=${W}:${H}:force_original_aspect_ratio=decrease:flags=lanczos`,
    `pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:color=black`,
    'setsar=1',
    ...(fps ? [`fps=${fps}`] : []),
    'format=yuv420p',
  ].join(',');
  if (!boxes.length) return `[0:v]${tail}[out]`;
  const parts = [`[0:v]split=${boxes.length + 1}[base]${boxes.map((_b, i) => `[c${i}]`).join('')}`];
  boxes.forEach((b, i) => {
    const pw = Math.max(2, Math.round(b.w / 16));
    const ph = Math.max(2, Math.round(b.h / 16));
    parts.push(`[c${i}]crop=${b.w}:${b.h}:${b.x}:${b.y},scale=${pw}:${ph}:flags=area,scale=${b.w}:${b.h}:flags=neighbor,gblur=sigma=4[b${i}]`);
  });
  let last = 'base';
  boxes.forEach((b, i) => {
    parts.push(`[${last}][b${i}]overlay=${b.x}:${b.y}[v${i}]`);
    last = `v${i}`;
  });
  parts.push(`[${last}]${tail}[out]`);
  return parts.join(';');
}

function run(ffmpeg, args, what) {
  const r = spawnSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-stats', '-y', ...args], { stdio: ['ignore', 'ignore', 'inherit'] });
  if (r.error || r.status !== 0) fail(`ffmpeg could not ${what} (exit ${r.status}${r.error ? `, ${r.error.message}` : ''})`);
}

const kb = (n) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(2)} MB` : `${Math.round(n / 1024)} KB`);

function main() {
  const o = readArgs(process.argv.slice(2));
  const W = o.hd ? 1920 : 1280;
  const H = o.hd ? 1080 : 720;
  const src = probe(o.ffmpeg, o.input);
  if (src.duration !== null && o.start + o.length > src.duration + 0.05) {
    fail(`the recording is ${src.duration.toFixed(1)} s long, so ${o.length} s from ${o.start} s runs past its end`);
  }
  // 60 kept when the recording has it (59.94 counts), else 30, never more than it has.
  const fps = src.fps && src.fps >= 50 ? 60 : src.fps && src.fps < 30 ? Math.max(1, Math.round(src.fps)) : 30;
  if (src.w < W || src.h < H) {
    console.log(`note: the recording is ${src.w}x${src.h}, under ${W}x${H}, so it is scaled up. Record at 1920x1080 or more for a sharp demo.`);
  }
  const boxes = o.blur.map((b) => boxOf(b, src.w, src.h));
  fs.mkdirSync(o.out, { recursive: true });
  const webm = path.join(o.out, `${o.id}.webm`);
  const webp = path.join(o.out, `${o.id}.webp`);
  const log = path.join(os.tmpdir(), `occlara-drill-demo-${process.pid}`);
  const input = ['-ss', String(o.start), '-i', o.input, '-t', String(o.length)];
  const filter = ['-filter_complex', graph(boxes, W, H, fps), '-map', '[out]', '-an', '-sn', '-dn'];

  /** Both passes at one quality; the demo's size in bytes. */
  const encode = (crf) => {
    const vp9 = ['-c:v', 'libvpx-vp9', '-b:v', '0', '-crf', String(crf), '-row-mt', '1', '-tile-columns', o.hd ? '2' : '1', '-g', String(fps * 4), '-pix_fmt', 'yuv420p'];
    console.log(`${o.title}: ${o.length} s from ${o.start} s of ${path.basename(o.input)} (${src.w}x${src.h}${src.fps ? `, ${src.fps} fps` : ''}), to ${W}x${H} at ${fps} fps, VP9 CRF ${crf}, ${boxes.length} blurred ${boxes.length === 1 ? 'box' : 'boxes'}`);
    console.log('pass 1 of 2');
    run(o.ffmpeg, [...input, ...filter, ...vp9, '-deadline', 'good', '-cpu-used', '4', '-pass', '1', '-passlogfile', log, '-f', 'null', '-'], 'read the recording (pass 1)');
    console.log('pass 2 of 2');
    run(o.ffmpeg, [...input, ...filter, ...vp9, '-deadline', 'good', '-cpu-used', '1', '-auto-alt-ref', '1', '-lag-in-frames', '25',
      '-pass', '2', '-passlogfile', log, '-map_metadata', '-1', '-f', 'webm', webm], 'write the demo (pass 2)');
    for (const f of fs.readdirSync(os.tmpdir())) if (f.startsWith(path.basename(log))) { try { fs.rmSync(path.join(os.tmpdir(), f), { force: true }); } catch { /* left in temp */ } }
    return fs.statSync(webm).size;
  };
  let crf = Math.round(o.crf);
  let bytes = encode(crf);
  // --fit: over 3 MB, again a little softer, CRF 36 at most.
  while (o.fit && bytes > AIM_HIGH && crf + 3 <= 36) {
    console.log(`${kb(bytes)} is over 3 MB, so again at CRF ${crf + 3} (--fit)`);
    crf += 3;
    bytes = encode(crf);
  }

  console.log('poster');
  run(o.ffmpeg, ['-ss', String(o.start + o.posterAt), '-i', o.input, '-filter_complex', graph(boxes, W, H, null), '-map', '[out]',
    '-frames:v', '1', '-an', '-map_metadata', '-1', '-c:v', 'libwebp', '-quality', '90', '-compression_level', '6', webp], 'write the poster');

  const size = fs.statSync(webm).size;
  const psize = fs.statSync(webp).size;
  const secs = Math.round(o.length);
  console.log('');
  console.log(`Wrote ${webm}, ${kb(size)} (${W}x${H}, ${fps} fps, ${o.length} s, VP9 CRF ${crf}, muted)`);
  console.log(`Wrote ${webp}, ${kb(psize)}`);
  if (size > AIM_HIGH) console.log(`note: over 3 MB. Try --crf ${Math.min(45, crf + 3)} or --fit, or a shorter length.`);
  else if (size < AIM_LOW) console.log(`note: under 1.5 MB, which is fine; --crf ${Math.max(15, crf - 3)} keeps more detail if it looks soft.`);
  console.log('');
  console.log('Before uploading, watch every second of it: no other player\'s name may be visible anywhere (kill feed, scoreboard, chat, banners).');
  console.log(`Upload both to ${DEMO_BASE}, then add to drill ${o.id} in src/shared/drill-library.json and run npm run test:drilllibrary:`);
  console.log(`  "demo": { "src": "${DEMO_BASE}${o.id}.webm", "poster": "${DEMO_BASE}${o.id}.webp", "secs": ${secs} }`);
}

if (require.main === module) main();

module.exports = { graph, boxOf };
