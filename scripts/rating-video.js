'use strict';

/**
 * THE RATING VIDEO: the match rating on a recording, moving at each kill and
 * death, for the owner's content (docs/claude/rating.md "The video tool").
 * A tool in scripts/, never shipped in the app (package.json ships no
 * scripts). No server, no AI read, no licence, no window: the bundled ffmpeg
 * decodes the kill feed's corner, the live rating's own detector and feed
 * read it (scripts/rating-video/events.js), the match rating's engine moves
 * the number (plan.js), libass draws the widget's look over the video in the
 * app's own font (ass.js, woff2.js), and libx264 writes an mp4 phones and
 * TikTok, Shorts and X take (H.264 high, yuv420p, AAC, faststart).
 *
 *   npm run rating:video -- <video> [--out file.mp4] [options]
 *
 *   --side attacking|defending   the player's side in the first round in the video
 *   --start-round N              the first round's number (1)
 *   --half N                     the last round of the first half (12, Swiftplay 4)
 *   --mode standard|swiftplay    the match's mode (the engine's length rule)
 *   --agent Name                 the player's agent
 *   --events file.json           a hand corrected event list instead of reading the video
 *   --dump-events file.json      write the event list read off the video (fix one, render again)
 *   --no-render                  with --dump-events: stop after writing it
 *   --review <id>                one of the owner's reviews: Riot's record, laid on the video
 *   --from S --to S              only this part of the video, in seconds
 *   --corner bottom-left|top-left|top-right|bottom-right   where the badge goes (bottom-left)
 *   --scale X                    the badge's size (1)
 *   --vertical                   a 9:16 cut, 1080 by 1920, the badge large under the picture
 *   --full-time[=S]              hold the last frame S seconds (2) with "Full time"
 *   --fps N                      kill feed reads a second (10)
 *   --crf N --preset P           libx264's quality (18, medium)
 *
 * Read only on its input and on the owner's reviews. Prints no name.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, execFileSync } = require('child_process');

const FF = require('ffmpeg-static');
const kf = require('../src/shared/killfeed');
const { createOfflineReader, checkEvents } = require('./rating-video/events');
const { planOf, planOfRecord, alignRounds } = require('./rating-video/plan');
const { assOf, FONT_FILES } = require('./rating-video/ass');
const { woff2ToTtf } = require('./rating-video/woff2');

const REPO = path.join(__dirname, '..');

const FLAGS = new Set(['vertical', 'no-render', 'full-time', 'help']);
const VALUES = new Set(['out', 'side', 'start-round', 'half', 'mode', 'agent', 'events', 'dump-events', 'review', 'from', 'to', 'corner', 'scale', 'fps', 'crf', 'preset', 'full-time']);

/** The command line, checked. Throws a plain sentence on anything wrong. */
function parseArgs(argv) {
  const o = { input: null, fps: 10, scale: 1, corner: 'bottom-left', fullTime: 0, crf: 18, preset: 'medium', vertical: false, render: true };
  const raw = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) { if (o.input) throw new Error(`one video at a time ("${a}")`); o.input = a; continue; }
    const eq = a.indexOf('=');
    const key = eq > 0 ? a.slice(2, eq) : a.slice(2);
    if (!FLAGS.has(key) && !VALUES.has(key)) throw new Error(`unknown option --${key}`);
    if (eq > 0) raw[key] = a.slice(eq + 1);
    else if (FLAGS.has(key)) raw[key] = true;
    else { if (i + 1 >= argv.length) throw new Error(`--${key} needs a value`); raw[key] = argv[++i]; }
  }
  if (raw.help) return { help: true };
  const num = (k, lo, hi) => { const v = Number(raw[k]); if (!Number.isFinite(v) || v < lo || v > hi) throw new Error(`--${k} is a number from ${lo} to ${hi}`); return v; };
  const int = (k, lo, hi) => { const v = num(k, lo, hi); if (!Number.isInteger(v)) throw new Error(`--${k} is a whole number`); return v; };
  if (raw.side !== undefined) { if (raw.side !== 'attacking' && raw.side !== 'defending') throw new Error('--side is attacking or defending'); o.side = raw.side; }
  if (raw['start-round'] !== undefined) o.startRound = int('start-round', 1, 50);
  if (raw.mode !== undefined) { if (raw.mode !== 'standard' && raw.mode !== 'swiftplay') throw new Error('--mode is standard or swiftplay'); o.mode = raw.mode; }
  o.half = raw.half !== undefined ? int('half', 1, 30) : o.mode === 'swiftplay' ? 4 : 12;
  if (raw.agent !== undefined) { if (!/^[A-Za-z/ ]{2,20}$/.test(raw.agent)) throw new Error('--agent is an agent\'s name'); o.agent = raw.agent; }
  if (raw.events !== undefined) o.events = raw.events;
  if (raw['dump-events'] !== undefined) o.dumpEvents = raw['dump-events'];
  if (raw.review !== undefined) { if (!/^[A-Za-z0-9-]{4,60}$/.test(raw.review)) throw new Error('--review is a review id, like valorant-1795411502650-x9fzkd or its last part'); o.review = raw.review; }
  if (raw.from !== undefined) o.from = num('from', 0, 86400);
  if (raw.to !== undefined) o.to = num('to', 0, 86400);
  if (o.from !== undefined && o.to !== undefined && o.to <= o.from) throw new Error('--to comes after --from');
  if (raw.corner !== undefined) { if (!['bottom-left', 'top-left', 'top-right', 'bottom-right'].includes(raw.corner)) throw new Error('--corner is bottom-left, top-left, top-right or bottom-right'); o.corner = raw.corner; }
  if (raw.scale !== undefined) o.scale = num('scale', 0.4, 3);
  if (raw.fps !== undefined) o.fps = int('fps', 2, 30);
  if (raw.crf !== undefined) o.crf = int('crf', 0, 40);
  if (raw.preset !== undefined) { if (!/^(ultrafast|superfast|veryfast|faster|fast|medium|slow|slower|veryslow)$/.test(raw.preset)) throw new Error('--preset is one of libx264\'s presets'); o.preset = raw.preset; }
  if (raw['full-time'] !== undefined) o.fullTime = raw['full-time'] === true ? 2 : num('full-time', 0.5, 10);
  o.vertical = raw.vertical === true;
  o.render = raw['no-render'] !== true;
  if (!o.render && !o.dumpEvents) throw new Error('--no-render goes with --dump-events');
  if (o.events && o.review) throw new Error('--events and --review each say what happened: one or the other');
  if (o.events && o.dumpEvents) throw new Error('--dump-events writes what the video reads: not with --events');
  if (!o.input) throw new Error('which video? npm run rating:video -- <video> [--out file.mp4]');
  if (raw.out !== undefined) o.out = raw.out;
  else o.out = path.join(path.dirname(o.input), `${path.basename(o.input, path.extname(o.input))}-rating${o.vertical ? '-vertical' : ''}.mp4`);
  if (!/\.mp4$/i.test(o.out)) throw new Error('--out is an .mp4 file');
  return o;
}

/** What ffmpeg says of the file: size, frame rate, length, audio. */
function probe(file) {
  let info = '';
  try { execFileSync(FF, ['-hide_banner', '-i', file], { stdio: ['ignore', 'pipe', 'pipe'] }); } catch (e) { info = String(e.stderr || ''); }
  const v = /Stream #[^\n]*Video:[^\n]*?, (\d{2,5})x(\d{2,5})[^\n]*?(?:, ([\d.]+) fps)?/.exec(info);
  const d = /Duration: (\d+):(\d+):([\d.]+)/.exec(info);
  if (!v || !d) throw new Error('ffmpeg cannot read a video in that file');
  const fpsM = /, ([\d.]+) fps/.exec(info);
  return { W: Number(v[1]), H: Number(v[2]), fps: fpsM ? Number(fpsM[1]) : 30, duration: Number(d[1]) * 3600 + Number(d[2]) * 60 + Number(d[3]), audio: /Stream #[^\n]*Audio:/.test(info) };
}

const range = (o) => [...(o.from !== undefined ? ['-ss', String(o.from)] : []), ...(o.to !== undefined ? ['-to', String(o.to)] : [])];

/** The kill feed's corner read off every frame at o.fps, into the offline reader. */
function readFeed(o, info, reader, onProgress) {
  return new Promise((resolve, reject) => {
    const r = kf.regionOf(info.W, info.H);
    const size = r.width * r.height * 3;
    const p = spawn(FF, ['-loglevel', 'error', ...range(o), '-i', o.input, '-vf', `fps=${o.fps},crop=${r.width}:${r.height}:${r.x}:${r.y}`, '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1'], { stdio: ['ignore', 'pipe', 'pipe'] });
    let buf = Buffer.alloc(0);
    let k = 0;
    let err = '';
    p.stderr.on('data', (d) => { err += d; });
    p.stdout.on('data', (d) => {
      buf = buf.length ? Buffer.concat([buf, d]) : d;
      while (buf.length >= size) {
        const img = { width: r.width, height: r.height, data: buf.subarray(0, size), channels: 3 };
        reader.frame(k / o.fps, kf.detect(img, info.H));
        k++;
        buf = buf.subarray(size);
        if (onProgress && k % (o.fps * 30) === 0) onProgress(k / o.fps);
      }
    });
    p.on('error', reject);
    p.on('close', (code) => (code === 0 ? resolve(k) : reject(new Error(`ffmpeg stopped reading the video: ${err.trim().split('\n').pop()}`))));
  });
}

/** One of the owner's reviews, by its id or the id's last part. Read only. */
function loadReview(id) {
  const dir = path.join(process.env.APPDATA || '', 'Occlara', 'reviews');
  const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith('.json') && f !== 'index.json' && f.includes(id)) : [];
  if (files.length !== 1) throw new Error(files.length ? `"${id}" names ${files.length} reviews: give more of the id` : `no review "${id}" in ${dir}`);
  const review = JSON.parse(fs.readFileSync(path.join(dir, files[0]), 'utf8')).review;
  if (!review || review.kind !== 'valorant') throw new Error('that review is not a Valorant match');
  return { review, dir: path.join(dir, files[0].replace(/\.json$/, '')) };
}

/**
 * The input is one of the review's own death clips: its round's offset from
 * the clip's own death mark, exact (a clip saved before the mark was kept has
 * its death placed 4.45 s before its end, and says so).
 */
function clipOffsets(rv, input, info) {
  const out = new Map();
  let guessed = false;
  const same = (a, b) => path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();
  for (const c of rv.review.rounds || []) {
    const fo = c && c.forensics;
    if (!fo || !fo.clip || !same(path.join(rv.dir, fo.clip), input)) continue;
    const feed = c.riot && Array.isArray(c.riot.feed) ? c.riot.feed : null;
    const death = feed && feed.find((e) => e.on === 'me');
    const deathMs = death ? death.ms : c.riot && Number.isFinite(c.riot.sec) ? c.riot.sec * 1000 : null;
    if (deathMs === null) continue;
    guessed = !Number.isFinite(fo.clipDeath);
    const clipDeath = guessed ? (info.duration - 4.45) * 1000 : fo.clipDeath;
    out.set(c.n, (clipDeath - deathMs) / 1000);
  }
  return { offsets: out, guessed };
}

/** The app's own font, decoded once into the work folder. */
function writeFonts(dir) {
  fs.mkdirSync(dir, { recursive: true });
  for (const f of FONT_FILES) fs.writeFileSync(path.join(dir, `${f}.ttf`), woff2ToTtf(fs.readFileSync(path.join(REPO, 'assets', 'fonts', `${f}.woff2`))));
}

/** The ffmpeg command that draws the plan and writes the mp4 (run in the work folder). */
function renderArgs(o, info, outW, outH, ft) {
  const fps = Math.max(1, Math.round(info.fps || 30));
  const hold = ft > 0 ? `,tpad=stop_mode=clone:stop_duration=${ft}` : '';
  const draw = 'ass=overlay.ass:fontsdir=fonts';
  const graph = o.vertical
    ? `[0:v]fps=${fps},split=2[a][b];[a]scale=270:480:force_original_aspect_ratio=increase,crop=270:480,boxblur=8:2,scale=${outW}:${outH},eq=brightness=-0.12[bg];`
      + `[b]scale=${outW}:-2[fg];[bg][fg]overlay=0:(H-h)/2-${Math.round(outH * 0.08)},setsar=1${hold},${draw},format=yuv420p[v]`
    : `[0:v]fps=${fps},scale=${outW}:${outH}${hold},${draw},format=yuv420p[v]`;
  const audio = info.audio ? ['-map', '0:a:0?', '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', ...(ft > 0 ? ['-af', `apad=pad_dur=${ft}`] : [])] : [];
  return ['-hide_banner', '-loglevel', 'error', '-y', ...range(o), '-i', path.resolve(o.input), '-filter_complex', graph, '-map', '[v]', ...audio,
    '-c:v', 'libx264', '-preset', o.preset, '-crf', String(o.crf), '-profile:v', 'high', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', path.resolve(o.out)];
}

async function main() {
  let o;
  try { o = parseArgs(process.argv.slice(2)); } catch (e) { console.error(`rating:video: ${e.message}`); process.exit(2); }
  if (o.help) { console.log(fs.readFileSync(__filename, 'utf8').split('*/')[0].split('\n').slice(2).map((l) => l.replace(/^ \*\s?/, '')).join('\n')); return; }
  if (!fs.existsSync(o.input)) throw new Error(`no file "${o.input}"`);
  const info = probe(o.input);
  const duration = Math.max(0, (o.to !== undefined ? Math.min(o.to, info.duration) : info.duration) - (o.from || 0));
  if (Math.abs(info.W / info.H - 16 / 9) > 0.02) console.log(`note: the video is ${info.W}x${info.H}, not 16:9: the kill feed is looked for where a 16:9 picture has it`);
  if (info.H < 700) console.log(`note: at ${info.H} rows too few of the player's kills were found live (rating.md "Live"): use 720p or more`);
  const readVideo = async () => {
    const reader = createOfflineReader({ side: o.side, startRound: o.startRound, half: o.half, mode: o.mode, agent: o.agent });
    const t0 = Date.now();
    const n = await readFeed(o, info, reader, (s) => process.stdout.write(`\rreading the kill feed: ${Math.round(s)} s of ${Math.round(duration)} s`));
    const out = reader.finish(duration);
    console.log(`\rread ${n} frames at ${o.fps} a second in ${((Date.now() - t0) / 1000).toFixed(1)} s: ${out.events.filter((e) => e.kind === 'kill').length} kills, ${out.events.filter((e) => e.kind === 'round').length} round(s)`);
    return out;
  };

  let plan;
  if (o.review) {
    const rv = loadReview(o.review);
    let { offsets, guessed } = clipOffsets(rv, o.input, info);
    let how = guessed ? "the clip's end (no death mark kept: placed 4.45 s before it)" : "the clip's own death mark";
    // The marks are in the whole file's time, the video drawn starts at --from.
    if (o.from) for (const [n, v] of offsets) offsets.set(n, v - o.from);
    if (!offsets.size) {
      const read = await readVideo();
      offsets = alignRounds(rv.review, read.events.filter((e) => e.kind === 'kill'));
      how = 'the kill feed read off the video, matched to the record';
    }
    if (!offsets.size) throw new Error('none of the review\'s rounds could be placed on this video: is it the same match?');
    plan = planOfRecord(rv.review, offsets, { duration });
    console.log(`Riot's record: round(s) ${[...offsets.keys()].join(', ')} placed by ${how}`);
  } else {
    let events;
    if (o.events) {
      events = checkEvents(JSON.parse(fs.readFileSync(o.events, 'utf8')));
      console.log(`events from ${o.events}: ${events.length}`);
    } else {
      events = (await readVideo()).events;
    }
    if (o.dumpEvents) {
      fs.writeFileSync(o.dumpEvents, JSON.stringify({
        tool: 'npm run rating:video', note: 'Times in seconds of the video. killer and victim: me, us or them. Fix what is wrong, add a plant ({ "t", "kind": "plant", "by": "us" }) or an assist ("assists": ["me"]), and render again with --events.',
        events,
      }, null, 1) + '\n');
      console.log(`wrote ${events.length} events to ${o.dumpEvents}`);
      if (!o.render) return;
    }
    plan = planOf(events, { mode: o.mode, agent: o.agent, startRound: o.startRound });
  }
  for (const s of plan.steps) console.log(`  ${s.t.toFixed(2).padStart(7)} s  ${s.delta.padStart(5)}  ${s.shown}  ${s.label}`);
  console.log(`the rating: ${plan.start.toFixed(1)} at the start, ${plan.final.toFixed(1)} at the end`);

  const outW = o.vertical ? 1080 : info.W - (info.W % 2);
  const outH = o.vertical ? 1920 : info.H - (info.H % 2);
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'occlara-rating-video-'));
  try {
    writeFonts(path.join(work, 'fonts'));
    const ass = assOf(plan, outW, outH, duration, { corner: o.vertical ? 'vertical' : o.corner, scale: o.scale, fullTime: o.fullTime });
    fs.writeFileSync(path.join(work, 'overlay.ass'), ass.text);
    const t0 = Date.now();
    await new Promise((resolve, reject) => {
      const p = spawn(FF, renderArgs(o, info, outW, outH, o.fullTime), { cwd: work, stdio: ['ignore', 'ignore', 'pipe'] });
      let err = '';
      p.stderr.on('data', (d) => { err += d; });
      p.on('error', reject);
      p.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg could not write the video: ${err.trim().split('\n').slice(-3).join(' ')}`))));
    });
    console.log(`wrote ${o.out} (${outW}x${outH}, ${(duration + (o.fullTime || 0)).toFixed(1)} s) in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
}

if (require.main === module) {
  main().catch((e) => { console.error(`rating:video: ${e.message}`); process.exit(1); });
}

module.exports = { parseArgs, probe, renderArgs, clipOffsets, readFeed };
