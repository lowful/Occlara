'use strict';

/**
 * THE RATING VIDEO TOOL (scripts/rating-video.js, docs/claude/rating.md "The
 * video tool"), on synthetic video only: the kill feed is drawn by the
 * detector's own fixtures (scripts/fixtures/killfeed-frames.js), the picture
 * and the sound come from ffmpeg's own sources, and no frame of a real match
 * is read or kept. Pure node and the bundled ffmpeg: no window.
 *
 *   the font      woff2.js decodes the app's Geist to a TrueType font a
 *                 checker would take (the tables, loca against glyf, the
 *                 whole font's checksum), and the triplet decoding's corners
 *   the events    from frames: kills by side and the player's own, a round
 *                 split by the gap and one by a wipe, its result; sideOf; a
 *                 hand corrected file checked line by line
 *   the plan      moves, labels without numbers, a kill that moves nothing
 *                 still named, Riot's record laid on by an offset, and the
 *                 offset found from the kills read
 *   the overlay   layout clear of the kill feed, the minimap and the health
 *                 bar at 720p, 1080p and 1440p, the count, the ASS script's
 *                 timing, the move only where the number moved, Full time
 *   the options   defaults, every refusal
 *   end to end    a tiny drawn video read, rendered and probed: H.264 high,
 *                 yuv420p, AAC, faststart, the badge in its tier's colour, the
 *                 kill feed still readable under it, the vertical cut 1080x1920
 *
 * Run: npm run test:ratingvideo
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync, execFileSync } = require('child_process');

const FF = require('ffmpeg-static');
const kf = require('../src/shared/killfeed');
const { drawFrame, cut } = require('./fixtures/killfeed-frames');
const { woff2ToTtf, triplet } = require('./rating-video/woff2');
const { createOfflineReader, checkEvents, sideOf, GAP_S } = require('./rating-video/events');
const { planOf, planOfRecord, alignRounds } = require('./rating-video/plan');
const A = require('./rating-video/ass');
const { parseArgs, probe, readFeed, renderArgs, asFile } = require('./rating-video');

const REPO = path.join(__dirname, '..');
let pass = 0;
const fails = [];
function ok(cond, name) { if (cond) pass++; else fails.push(name); console.log(`${cond ? 'ok  ' : 'FAIL'}  ${name}`); }
const near = (a, b, tol) => Math.abs(a - b) <= tol;

// ---------- the font ----------
{
  const ttf = woff2ToTtf(fs.readFileSync(path.join(REPO, 'assets', 'fonts', 'geist-700.woff2')));
  const n = ttf.readUInt16BE(4);
  const tables = {};
  for (let i = 0; i < n; i++) {
    const o = 12 + i * 16;
    tables[ttf.toString('latin1', o, o + 4)] = { off: ttf.readUInt32BE(o + 8), len: ttf.readUInt32BE(o + 12) };
  }
  ok(ttf.readUInt32BE(0) === 0x00010000 && ['cmap', 'glyf', 'head', 'hhea', 'hmtx', 'loca', 'maxp', 'name', 'post'].every((t) => tables[t]), 'woff2: a TrueType font with every table a font needs');
  const head = tables.head.off;
  ok(ttf.readUInt32BE(head + 12) === 0x5f0f3cf5, "woff2: head's magic number in place");
  const glyphs = ttf.readUInt16BE(tables.maxp.off + 4);
  const long = ttf.readInt16BE(head + 50) === 1;
  const last = long ? ttf.readUInt32BE(tables.loca.off + glyphs * 4) : ttf.readUInt16BE(tables.loca.off + glyphs * 2) * 2;
  ok(glyphs > 300 && last === tables.glyf.len && tables.loca.len === (glyphs + 1) * (long ? 4 : 2), `woff2: loca has one offset a glyph and ends at glyf's end (${glyphs} glyphs)`);
  let sum = 0;
  for (let i = 0; i < ttf.length; i += 4) sum = (sum + ttf.readUInt32BE(i)) >>> 0;
  ok(sum === 0xb1b0afba, "woff2: the whole font's checksum is TrueType's constant");
  // The glyph of 'A' (cmap) has contours: read through the font as a renderer would.
  const fake = { u8: (() => { const q = [5, 6, 7, 8, 9, 10, 11]; return () => q.shift(); })(), u16: (() => { const q = [300, 400]; return () => q.shift(); })() };
  ok(JSON.stringify(triplet(0, fake)) === JSON.stringify([0, -5]) && JSON.stringify(triplet(11, fake)) === JSON.stringify([6, 0])
    && JSON.stringify(triplet(21, fake)) === JSON.stringify([1, -8]) && JSON.stringify(triplet(127, fake)) === JSON.stringify([300, 400]),
  'woff2: the triplet encoding, a y move, an x move, a nibble pair and two words, signs from the flag');
  let bad = null;
  try { woff2ToTtf(Buffer.from('not a font at all, not even close')); } catch (e) { bad = e.message; }
  ok(/not a woff2/.test(bad || ''), 'woff2: anything else is refused, not decoded');
}

// ---------- the events, from frames ----------
const H = 720;
const W = 1280;
const reg = kf.regionOf(W, H);
const ROW_LIFE = 5;
const detCache = new Map();
/** The detector's answer for the feed at time t: every kill's row for five seconds, oldest on top. */
function detAt(kills, t) {
  const rows = kills.filter((k) => k.t <= t && t < k.t + ROW_LIFE).sort((a, b) => a.t - b.t).slice(-6)
    .map((k, i) => ({ slot: i, killer: k.killer, victim: k.victim, mine: k.mine || null, vlen: k.vlen }));
  const key = JSON.stringify(rows);
  if (!detCache.has(key)) detCache.set(key, kf.detect(cut(drawFrame({ W, H, order: 'rgb', rows }), reg), H));
  return detCache.get(key);
}
function readSim(kills, until, opts, fps) {
  const r = createOfflineReader(opts || {});
  const step = 1 / (fps || 10);
  for (let t = 0; t <= until + 1e-9; t += step) r.frame(Math.round(t * 100) / 100, detAt(kills, t));
  return r.finish(until);
}
const brief = (evs) => evs.map((e) => (e.kind === 'kill' ? `${e.round}:${e.killer}>${e.victim}` : e.kind === 'end' ? `${e.round}:end:${e.won}` : `${e.round}:round:${e.side}`));

{
  // Round 1: the player's kill, a teammate down, a teammate's kill; then a
  // quiet stretch longer than the rule's gap; round 2: the player dies.
  const kills = [
    { t: 2.0, killer: 'ally', victim: 'enemy', mine: 'kill', vlen: 0.05 },
    { t: 6.0, killer: 'enemy', victim: 'ally', vlen: 0.06 },
    { t: 9.0, killer: 'ally', victim: 'enemy', vlen: 0.07 },
    { t: 62.0, killer: 'enemy', victim: 'ally', mine: 'death', vlen: 0.05 },
  ];
  const out = readSim(kills, 70, { side: 'attacking' });
  const b = brief(out.events);
  ok(JSON.stringify(b) === JSON.stringify(['1:round:attacking', '1:me>them', '1:them>us', '1:us>them', '1:end:null', '2:round:attacking', '2:them>me', '2:end:null']),
    `events: kills by side and the player's own, a new round after ${GAP_S} s with no row (${b.join(' ')})`);
  const t = out.events.filter((e) => e.kind === 'kill').map((e) => e.t);
  ok(near(t[0], 2.0, 0.25) && near(t[1], 6.0, 0.25) && near(t[2], 9.0, 0.25) && near(t[3], 62.0, 0.25), `events: each kill at the moment its row first shows (${t.join(', ')})`);
  ok(out.splits.length === 1 && out.splits[0].why === 'gap' && near(out.splits[0].t, 62, 0.2), 'events: the split is the gap\'s, where the next row came');
  const round2 = out.events.find((e) => e.kind === 'round' && e.round === 2);
  ok(round2 && near(round2.t, 62, 0.2), 'events: round 2 opens at its first row');

  // A wipe: five enemies down, the next row soon after is the next round, round 1 won.
  const wipe = [1, 2, 3, 4, 5].map((s, i) => ({ t: s * 1.2, killer: 'ally', victim: 'enemy', mine: i === 2 ? 'kill' : null, vlen: 0.04 + i * 0.01 }));
  wipe.push({ t: 25, killer: 'enemy', victim: 'ally', vlen: 0.05 });
  const w = readSim(wipe, 30, {});
  const wb = brief(w.events);
  ok(wb.filter((x) => x === '1:us>them' || x === '1:me>them').length === 5 && wb.includes('1:me>them') && wb.includes('1:end:true') && wb.includes('2:them>us'),
    `events: a side wiped out ends the round won, the next row ${25 - 6} s later opens the next (${wb.join(' ')})`);
  ok(w.splits.length === 1 && w.splits[0].why === 'wipe', 'events: that split is the wipe\'s, well inside the quiet gap');

  // The same rows with no gap and no wipe stay one round.
  const one = readSim([{ t: 2, killer: 'ally', victim: 'enemy', vlen: 0.05 }, { t: 30, killer: 'enemy', victim: 'ally', vlen: 0.06 }], 36, {});
  ok(one.events.filter((e) => e.kind === 'round').length === 1, 'events: 28 s between two kills of a round is still one round');
}

{
  ok(sideOf(1, { side: 'attacking' }) === 'attacking' && sideOf(12, { side: 'attacking' }) === 'attacking' && sideOf(13, { side: 'attacking' }) === 'defending'
    && sideOf(25, { side: 'attacking' }) === 'attacking' && sideOf(26, { side: 'attacking' }) === 'defending' && sideOf(27, { side: 'attacking' }) === 'attacking',
  'sideOf: the sides swap after round 12 and every round of overtime');
  ok(sideOf(14, { side: 'defending', startRound: 14 }) === 'defending' && sideOf(12, { side: 'defending', startRound: 14 }) === 'attacking'
    && sideOf(5, { side: 'attacking', half: 4 }) === 'defending' && sideOf(3, {}) === null,
  'sideOf: from a later first round, a Swiftplay half of 4, and unknown without --side');
}

{
  const good = checkEvents({ events: [{ t: 0, kind: 'round', round: 3, side: 'defending' }, { t: 4.2, kind: 'kill', killer: 'me', victim: 'them', assists: ['me', 'x'] },
    { t: 30, kind: 'plant', by: 'them' }, { t: 1.5, kind: 'kill', killer: 'us', victim: 'them' }, { t: 60, kind: 'end', won: false }] });
  ok(good.map((e) => e.t).join(',') === '0,1.5,4.2,30,60' && good[2].assists.length === 1, 'checkEvents: sorted by time, an assist only the player\'s');
  const refuse = (list) => { try { checkEvents({ events: list }); return null; } catch (e) { return e.message; } };
  ok(/event 1.*killer and victim/.test(refuse([{ t: 1, kind: 'kill', killer: 'Someone', victim: 'them' }]) || ''), 'checkEvents: a kill names sides, never a player');
  ok(/event 2.*time/.test(refuse([{ t: 1, kind: 'round', round: 1 }, { kind: 'kill', killer: 'me', victim: 'them' }]) || ''), 'checkEvents: a missing time names its line');
  ok(/kind/.test(refuse([{ t: 1, kind: 'ace' }]) || '') && /won/.test(refuse([{ t: 1, kind: 'end', won: 'yes' }]) || '') && /events/.test(refuse(null) || 'x'),
    'checkEvents: an unknown kind, a result that is no boolean, no list at all');
}

// ---------- the plan ----------
{
  const p = planOf([{ t: 0, kind: 'round', round: 1, side: 'attacking' }, { t: 3, kind: 'kill', killer: 'me', victim: 'them' }, { t: 4, kind: 'kill', killer: 'us', victim: 'them' },
    { t: 7, kind: 'kill', killer: 'me', victim: 'them' }, { t: 9, kind: 'kill', killer: 'them', victim: 'me' }, { t: 20, kind: 'end', won: true }], {});
  const s = p.steps;
  ok(s.length >= 3 && s[0].t === 3 && s[0].label === 'Opening kill' && s[0].delta.startsWith('+') && s[0].up && s[0].shown === String(Math.round(s[0].value * 10)),
    `plan: the first kill rises, labelled "Opening kill" (${s.map((x) => `${x.t}:${x.delta}:${x.label}`).join(' ')})`);
  ok(s.every((x) => !/\d+v\d+/.test(x.label)), 'plan: no label carries the numbers standing');
  const death = s.find((x) => x.t === 9);
  ok(death && death.down && death.delta.startsWith('-') && /^Died/.test(death.label), 'plan: the death falls');
  ok(s.every((x) => (x.delta === '') === (!x.up && !x.down)), 'plan: a step that moves nothing has no delta, but keeps its label');
  ok(p.start === 6 && Math.abs(p.final - s[s.length - 1].value) < 1e-9, 'plan: from 6.0 to the last value');
}

{
  // Riot's record of a review: two rounds, the second laid on the video 12.3 s in.
  const review = { kind: 'valorant', game: { mode: 'standard' }, rounds: [
    { n: 1, sideKey: 'attacking', result: 'won', riot: { feed: [{ ms: 4000, by: 'me', on: 'enemy' }, { ms: 9000, by: 'mate', on: 'enemy' }] } },
    { n: 2, sideKey: 'attacking', result: 'lost', riot: { feed: [{ ms: 3000, by: 'enemy', on: 'mate' }, { ms: 5000, by: 'me', on: 'enemy', as: [] }, { ms: 8000, by: 'enemy', on: 'me' }] } },
  ] };
  const offsets = new Map([[2, 12.3]]);
  const p = planOfRecord(review, offsets, { duration: 30 });
  ok(p.start > 6 && p.steps.length === 2 && near(p.steps[0].t, 17.3, 0.01) && near(p.steps[1].t, 20.3, 0.01),
    `plan from the record: round 1 counted into the opening value (${p.start.toFixed(1)}), round 2's moves at offset plus ms`);
  const read = [{ t: 15.55, killer: 'them', victim: 'us' }, { t: 17.6, killer: 'me', victim: 'them' }, { t: 20.5, killer: 'them', victim: 'me' }];
  const got = alignRounds(review, read);
  ok(got.size === 1 && near(got.get(2), 12.4, 0.35) && !got.has(1), `alignRounds: round 2 placed from the kills read (${got.get(2)}), round 1 with none read stays unplaced`);
}

// ---------- the overlay ----------
{
  const inter = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
  let clear = true;
  let under = true;
  for (const [w, h] of [[1280, 720], [1920, 1080], [2560, 1440]]) {
    const r = kf.regionOf(w, h);
    const feed = { x: r.x, y: r.y, w: r.width, h: r.height };
    const minimap = { x: 0, y: 0, w: Math.round(w * 0.25), h: Math.round(h * 0.47) };
    const health = { x: Math.round(w * 0.27), y: Math.round(h * 0.88), w: Math.round(w * 0.46), h: Math.round(h * 0.12) };
    for (const corner of ['bottom-left', 'top-left', 'top-right', 'bottom-right']) {
      const L = A.layoutOf(w, h, { corner });
      const p = L.plate;
      if (inter(p, feed) || inter(p, minimap) || inter(p, health) || p.x < 0 || p.y < 0 || p.x + p.w > w || p.y + p.h > h) clear = false;
    }
    if (A.layoutOf(w, h, { corner: 'top-right' }).plate.y < r.y + r.height) under = false;
  }
  ok(clear, 'overlay: every corner clear of the kill feed, the minimap and the health bar, inside the frame, at 720p, 1080p and 1440p');
  ok(under, 'overlay: top right sits under the kill feed');
  const v = A.layoutOf(1080, 1920, { corner: 'vertical' });
  ok(v.plate.w <= 1080 && v.plate.x >= 0 && v.plate.y > 1920 * 0.6 && v.s > 1.8, 'overlay: the vertical cut\'s badge large, under the picture');
  ok(A.layoutOf(1920, 1080, { scale: 1.5 }).plate.w === Math.round(A.layoutOf(1920, 1080, {}).plate.w * 1.5) || near(A.layoutOf(1920, 1080, { scale: 1.5 }).plate.w, A.layoutOf(1920, 1080, {}).plate.w * 1.5, 1), 'overlay: --scale scales it');
  let threw = null;
  try { A.layoutOf(1920, 1080, { corner: 'middle' }); } catch (e) { threw = e.message; }
  ok(/corner/.test(threw || ''), 'overlay: an unknown corner is refused');

  const c = A.countSteps(10, 6.0, 6.4);
  ok(c[0].t === 10 && c[c.length - 1].shown === '64' && c.every((x) => /^\d{2,3}$/.test(x.shown) && Math.abs(x.value * 10 - Number(x.shown)) < 1e-9) && c[c.length - 1].t <= 10 + A.COUNT_S + 1e-9 && c.every((x, i) => !i || Number(x.shown) >= Number(c[i - 1].shown)),
    `overlay: the count climbs to the new value in ${A.COUNT_S} s, on the app's 100 scale (${c.map((x) => x.shown).join(' ')})`);
  const d = A.countSteps(5, 6.4, 5.9, 5.2);
  ok(d[d.length - 1].shown === '59' && d[d.length - 1].t <= 5.2 + 1e-9, 'overlay: a count cut short by the next move still lands on its value');
  ok(A.ts(0) === '0:00:00.00' && A.ts(61.234) === '0:01:01.23' && A.ts(3725.5) === '1:02:05.50', 'overlay: ASS times');
  ok(A.col('#52C88A') === '&H8AC852&', 'overlay: colours in ASS\'s blue green red');
  // 9.1: the full moon, from its one source, its holes cut under either fill rule.
  const moonD = require('./moon/moon-art').FLAT_D;
  const mm = A.moonMark(120);
  const loops = A.moonLoops();
  const nested = loops.slice(1).every((pts, i) => {
    const holder = loops.filter((o, m) => m !== i + 1 && A.inLoop(pts[0], o));
    const depth = holder.length;
    return (A.loopArea(pts) > 0) === (depth % 2 === 0 ? A.loopArea(loops[0]) > 0 : A.loopArea(loops[0]) <= 0);
  });
  ok(loops.length === moonD.split('M').length - 1 && mm.split(' m ').length === loops.length && mm.startsWith('m 110 60')
    && mm.split(' ').filter((w) => w !== 'm' && w !== 'l').every((v) => Number(v) >= 0 && Number(v) <= 120) && nested,
  'overlay: the moon drawn from its one source, the disc and every sea and crater, each outline run against the one it lies in');

  const plan = { start: 6, final: 6.2, steps: [
    { t: 3.1, value: 6.3, shown: '63', tier: 'fair', delta: '+3', up: true, down: false, label: 'Opening kill' },
    { t: 5.4, value: 6.3, shown: '63', tier: 'fair', delta: '', up: false, down: false, label: 'Kill' },
    { t: 9.0, value: 6.2, shown: '62', tier: 'fair', delta: '-1', up: false, down: true, label: 'Died {x}' },
  ] };
  const s = A.assOf(plan, 1920, 1080, 12, { fullTime: 2 });
  const lines = s.text.split('\n').filter((l) => l.startsWith('Dialogue:'));
  ok(/PlayResX: 1920/.test(s.text) && /PlayResY: 1080/.test(s.text) && s.end === 14, 'overlay: the script is the video\'s size and runs to the end of Full time');
  ok(lines.some((l) => l.includes(',0:00:03.10,') && l.endsWith('}+3') && l.includes(A.col(A.TOKENS.good))), 'overlay: the move rises in green at its moment');
  ok(lines.some((l) => l.includes(',0:00:09.00,') && l.endsWith('}-1') && l.includes(A.col(A.TOKENS.bad))), 'overlay: and falls in red at its moment');
  ok(!lines.some((l) => l.startsWith('Dialogue: 5,0:00:05.40,') && /Mono/.test(l)) && lines.some((l) => l.startsWith('Dialogue: 5,0:00:05.40,') && l.endsWith('}Kill')), 'overlay: a step that moved nothing shows its label and no move');
  ok(lines.some((l) => l.endsWith('}Died x')) && !lines.some((l) => /\}Died \{/.test(l)), 'overlay: a label cannot carry an override');
  ok(lines.some((l) => l.includes(',0:00:12.00,0:00:14.00,') && l.endsWith('}Full time')), 'overlay: "Full time" holds the last two seconds');
  ok(lines.some((l) => l.endsWith('}60')) && lines.some((l) => l.endsWith('}63')) && lines.some((l) => l.endsWith('}62')) && lines.some((l) => l.endsWith('}Occlara')), 'overlay: the number and the brand are drawn');
  ok(!lines.some((l) => /\}\d+\.\d$/.test(l)) && lines.some((l) => /\}\d+$/.test(l)), "overlay: ONE SCALE (9.1): the badge never draws the rating's own tenths, 6.8 is 68 as the app shows it");
  const none = A.assOf(plan, 1920, 1080, 12, {});
  ok(!/Full time/.test(none.text) && none.end === 12, 'overlay: no Full time unless asked');
}

// ---------- the options ----------
{
  const o = parseArgs(['C:/v/match.mkv']);
  ok(o.input === 'C:/v/match.mkv' && o.fps === 10 && o.corner === 'bottom-left' && o.scale === 1 && o.fullTime === 0 && o.half === 12 && o.render && /match-rating\.mp4$/.test(o.out),
    'options: the defaults, the mp4 beside the video');
  const v = parseArgs(['m.mp4', '--vertical', '--full-time', '--side=defending', '--start-round', '14', '--mode', 'swiftplay', '--corner', 'top-right', '--scale', '1.4', '--out', 'x.mp4']);
  ok(v.vertical && v.fullTime === 2 && v.side === 'defending' && v.startRound === 14 && v.half === 4 && v.corner === 'top-right' && v.scale === 1.4 && v.out === 'x.mp4',
    'options: both spellings, --full-time alone is 2 s, Swiftplay halves at 4');
  ok(parseArgs(['m.mp4', '--full-time=3.5']).fullTime === 3.5 && /-rating-vertical\.mp4$/.test(parseArgs(['m.mp4', '--vertical']).out), 'options: --full-time=S, and the vertical cut\'s own name');
  const refuse = (a) => { try { parseArgs(a); return null; } catch (e) { return e.message; } };
  ok(/unknown option/.test(refuse(['m.mp4', '--lies']) || ''), 'options: an unknown option is refused');
  ok(/--no-render goes with --dump-events/.test(refuse(['m.mp4', '--no-render']) || ''), 'options: --no-render without --dump-events is refused');
  ok(/one or the other/.test(refuse(['m.mp4', '--events', 'e.json', '--review', 'x9fzkd']) || ''), 'options: --events and --review together are refused');
  ok(/--side/.test(refuse(['m.mp4', '--side', 'left']) || '') && /--corner/.test(refuse(['m.mp4', '--corner', 'middle']) || '') && /--scale/.test(refuse(['m.mp4', '--scale', '9']) || ''),
    'options: a side, a corner or a scale out of range is refused');
  ok(/which video/.test(refuse([]) || '') && /\.mp4/.test(refuse(['m.mp4', '--out', 'x.gif']) || '') && /--to/.test(refuse(['m.mp4', '--from', '9', '--to', '3']) || ''),
    'options: no video, an output that is no mp4, --to before --from');
  ok(/review id/.test(refuse(['m.mp4', '--review', '../x']) || '') && /agent/.test(refuse(['m.mp4', '--agent', 'a;b']) || ''), 'options: a review id or agent with path or odd characters is refused');
  // Round 4: ffmpeg is handed every path as a file, so a name like a protocol is read as a file.
  const args = renderArgs(parseArgs(['concat,a.mkv', '--out', 'http,x.mp4']), { W: 1280, H: 720, fps: 30, audio: true }, 1280, 720, 0);
  const at = args.indexOf('-i');
  ok(at > 0 && args[at + 1] === asFile('concat,a.mkv') && /^file:/.test(args[at + 1]) && /^file:/.test(args[args.length - 1]) && args[args.length - 1].endsWith('http,x.mp4'),
    `options: the input and the output reach ffmpeg as file: paths (${args[at + 1].slice(0, 12)}...)`);
}

// ---------- end to end, on a drawn video ----------
(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'occlara-rating-video-test-'));
  try {
    // Six seconds at five frames a second, the player's kill row from 1.0 s, a tone for sound.
    const fps = 5;
    const raw = [];
    for (let k = 0; k < 6 * fps; k++) {
      const t = k / fps;
      const rows = t >= 1.0 ? [{ slot: 0, killer: 'ally', victim: 'enemy', mine: 'kill', vlen: 0.05 }] : [];
      raw.push(drawFrame({ W, H, order: 'rgb', rows, ground: [70, 80, 90] }).data);
    }
    const src = path.join(dir, 'drawn.mkv');
    const mk = spawnSync(FF, ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', `${W}x${H}`, '-r', String(fps), '-i', 'pipe:0',
      '-f', 'lavfi', '-i', 'sine=frequency=440:duration=6', '-shortest', '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '10', '-pix_fmt', 'yuv444p', '-c:a', 'aac', src], { input: Buffer.concat(raw), maxBuffer: 1 << 26 });
    ok(mk.status === 0 && fs.existsSync(src), 'end to end: a drawn video made with ffmpeg\'s own sources');

    const info = probe(src);
    ok(info.W === W && info.H === H && info.audio && near(info.duration, 6, 0.3), `end to end: probe reads its size, sound and length (${info.W}x${info.H}, ${info.duration} s)`);
    const reader = createOfflineReader({});
    const n = await readFeed({ input: src, fps: 10 }, info, reader);
    const ev = reader.finish(info.duration).events;
    const mine = ev.filter((e) => e.kind === 'kill' && e.killer === 'me');
    ok(n >= 55 && mine.length === 1 && near(mine[0].t, 1.0, 0.25), `end to end: the player's kill read off the video at ${mine[0] ? mine[0].t : '?'} s`);

    // Rendered, with Full time, then probed.
    const out = path.join(dir, 'out.mp4');
    const run = spawnSync(process.execPath, [path.join(__dirname, 'rating-video.js'), src, '--out', out, '--full-time', '--preset', 'veryfast'], { encoding: 'utf8' });
    ok(run.status === 0 && fs.existsSync(out), `end to end: rendered (${(run.stderr || '').trim().slice(-200)})`);
    let pinfo = '';
    try { execFileSync(FF, ['-hide_banner', '-i', out], { stdio: ['ignore', 'pipe', 'pipe'] }); } catch (e) { pinfo = String(e.stderr || ''); }
    ok(/Video: h264 \(High\)/.test(pinfo) && /yuv420p/.test(pinfo) && /Audio: aac/.test(pinfo) && /1280x720/.test(pinfo), `end to end: H.264 high, yuv420p, AAC, the source's size (${pinfo.split('\n').filter((l) => /Stream/.test(l)).map((l) => l.trim().slice(0, 90)).join(' | ')})`);
    const dm = /Duration: (\d+):(\d+):([\d.]+)/.exec(pinfo);
    ok(dm && near(Number(dm[3]), 8, 0.3), `end to end: the video plus two seconds of Full time (${dm ? dm[3] : '?'} s)`);
    const bytes = fs.readFileSync(out);
    ok(bytes.indexOf('moov') > 0 && bytes.indexOf('moov') < bytes.indexOf('mdat'), 'end to end: faststart, the index before the media');
    ok(/Opening kill/.test(run.stdout || ''), 'end to end: the move printed with its label');

    // A frame after the kill: the badge in the fair tier's amber, the kill feed still readable.
    const frame = execFileSync(FF, ['-loglevel', 'error', '-ss', '2.5', '-i', out, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1'], { maxBuffer: 1 << 26 });
    const L = A.layoutOf(W, H, {});
    const px = (x, y) => { const i = (y * W + x) * 3; return [frame[i], frame[i + 1], frame[i + 2]]; };
    const b = px(L.badge.x + Math.round(6 * L.s), L.badge.y + Math.round(L.badge.h / 2));
    ok(near(b[0], 0xd9, 18) && near(b[1], 0xa4, 18) && near(b[2], 0x41, 18), `end to end: the badge drawn in its tier's colour where the layout puts it (${b.join(',')})`);
    const plateIn = px(L.plate.x + L.plate.w - Math.round(30 * L.s), L.plate.y + L.plate.h - Math.round(10 * L.s));
    ok(plateIn[0] < 40 && plateIn[1] < 40 && plateIn[2] < 45, `end to end: the plate's dark surface behind the label (${plateIn.join(',')})`);
    const corner = Buffer.alloc(reg.width * reg.height * 3);
    for (let y = 0; y < reg.height; y++) frame.copy(corner, y * reg.width * 3, ((reg.y + y) * W + reg.x) * 3, ((reg.y + y) * W + reg.x + reg.width) * 3);
    const after = kf.detect({ width: reg.width, height: reg.height, data: corner, channels: 3 }, H).list;
    ok(after.length === 1 && after[0].mine === 'kill', 'end to end: the kill feed under the overlay still reads, the player\'s row and its yellow');

    // The vertical cut.
    const vout = path.join(dir, 'v.mp4');
    const vr = spawnSync(process.execPath, [path.join(__dirname, 'rating-video.js'), src, '--out', vout, '--vertical', '--preset', 'veryfast', '--to', '3'], { encoding: 'utf8' });
    let vinfo = '';
    try { execFileSync(FF, ['-hide_banner', '-i', vout], { stdio: ['ignore', 'pipe', 'pipe'] }); } catch (e) { vinfo = String(e.stderr || ''); }
    ok(vr.status === 0 && /1080x1920 \[SAR 1:1/.test(vinfo), 'end to end: the vertical cut is 1080 by 1920, square pixels');

    // A hand corrected file renders without reading the video.
    const evf = path.join(dir, 'e.json');
    fs.writeFileSync(evf, JSON.stringify({ events: [{ t: 0, kind: 'round', round: 1 }, { t: 2, kind: 'kill', killer: 'them', victim: 'me' }] }));
    const er = spawnSync(process.execPath, [path.join(__dirname, 'rating-video.js'), src, '--out', path.join(dir, 'e.mp4'), '--events', evf, '--preset', 'veryfast'], { encoding: 'utf8' });
    ok(er.status === 0 && /Died first/.test(er.stdout) && !/reading the kill feed|read \d+ frames/.test(er.stdout), 'end to end: --events renders the file\'s events, the video not read');
    const dumpf = path.join(dir, 'd.json');
    const dr = spawnSync(process.execPath, [path.join(__dirname, 'rating-video.js'), src, '--dump-events', dumpf, '--no-render'], { encoding: 'utf8' });
    const dumped = dr.status === 0 && fs.existsSync(dumpf) ? JSON.parse(fs.readFileSync(dumpf, 'utf8')) : null;
    ok(dumped && checkEvents(dumped).some((e) => e.kind === 'kill' && e.killer === 'me') && !fs.existsSync(path.join(dir, 'drawn-rating.mp4')), 'end to end: --dump-events writes a list --events takes back, and --no-render renders nothing');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  console.log(fails.length ? `\nFAIL: ${fails.length} of ${pass + fails.length} rating video checks failed:\n  ${fails.join('\n  ')}` : `\nall ${pass} rating video checks passed`);
  process.exit(fails.length ? 1 : 0);
})().catch((e) => { console.error(e.stack || e); process.exit(1); });
