'use strict';

/**
 * THE KILL FEED DETECTOR (src/shared/killfeed.js, docs/claude/rating.md "Live").
 *
 * On drawn frames only (scripts/fixtures/killfeed-frames.js), never a frame of
 * a real match: the player's own kill and own death told from a teammate's
 * row by the yellow edge alone, at 480p, 720p, 1080p and on a wide screen,
 * over a wall of the rows' own colours, beside an agent portrait that is
 * yellow in patches, over a player card under the feed, rows stacked, BGRA as
 * nativeImage hands it, bad input, and its cost.
 *
 * Pure node, no window. Run: npm run test:killfeed
 */
const kf = require('../src/shared/killfeed');
const { drawFrame, cut } = require('./fixtures/killfeed-frames');

let checks = 0;
let fails = 0;
function ok(cond, msg) {
  checks++;
  if (cond) console.log(`  ok  ${msg}`);
  else { fails++; console.log(`  FAIL ${msg}`); }
}

/** Draw, cut the region as index.js does, detect. */
function read(o) {
  const f = drawFrame(o);
  const r = kf.regionOf(o.W, o.H);
  return kf.detect(cut(f, r), o.H);
}
const brief = (d) => d.list.map((x) => `${x.slot}:${x.killer}>${x.victim}${x.mine ? `*${x.mine}` : ''}`).join(' ');

// The region: even numbers, the right edge, under the score bar.
{
  for (const [W, H] of [[854, 480], [1280, 720], [1920, 1080], [2560, 1080], [1366, 768]]) {
    const r = kf.regionOf(W, H);
    ok(r && r.x + r.width === W - (W % 2) + (W % 2 ? 0 : 0) && r.width % 2 === 0 && r.height % 2 === 0 && r.y % 2 === 0
      && r.y > H * 0.07 && r.y + r.height < H * 0.31, `the region of ${W}x${H} hangs from the right edge under the score bar, in even numbers (${JSON.stringify(r)})`);
  }
  ok(kf.regionOf(0, 720) === null && kf.regionOf('a', 'b') === null, 'no region for a frame of no size');
}

// The three kinds of row, at every size.
for (const [W, H] of [[854, 480], [1280, 720], [1920, 1080], [2560, 1080]]) {
  const d = read({ W, H, rows: [
    { slot: 0, killer: 'ally', victim: 'enemy', mine: 'kill' },
    { slot: 1, killer: 'enemy', victim: 'ally', mine: 'death', vlen: 0.09 },
    { slot: 2, killer: 'ally', victim: 'enemy', klen: 0.12 },
    { slot: 3, killer: 'enemy', victim: 'ally', vlen: 0.05 },
  ] });
  ok(brief(d) === '0:ally>enemy*kill 1:enemy>ally*death 2:ally>enemy 3:enemy>ally' && d.kills.length === 1 && d.deaths.length === 1,
    `${W}x${H}: the player's kill, the player's death, a teammate's kill and a teammate's death told apart (${brief(d)})`);
}

// What is no highlight.
{
  const d = read({ W: 1280, H: 720, rows: [{ slot: 0, killer: 'ally', victim: 'enemy', portraitYellow: true }] });
  ok(brief(d) === '0:ally>enemy', `an agent portrait yellow in patches is a teammate's row, not the player's (${brief(d)})`);
  const v = read({ W: 1280, H: 720, rows: [{ slot: 0, killer: 'ally', victim: 'enemy', portraitYellow: 'victim' }] });
  ok(brief(v) === '0:ally>enemy', `nor is a victim's yellow portrait the player's death on a row the enemy died in (${brief(v)})`);
  const card = read({ W: 1280, H: 720, card: true, rows: [] });
  ok(card.rows === 0 && card.list.length === 0, 'a player card under the feed (KILLED BY) is no row');
  const quiet = read({ W: 1920, H: 1080, rows: [] });
  ok(quiet.rows === 0 && quiet.kills.length === 0 && quiet.deaths.length === 0, 'an empty feed has no row');
}

// Walls of the rows' own colours behind the corner.
for (const [name, wall] of [['teal', [80, 176, 150]], ['salmon', [222, 140, 130]], ['red', [220, 70, 80]], ['pale yellow', [228, 232, 150]]]) {
  const d = read({ W: 1280, H: 720, wall, rows: [{ slot: 0, killer: 'ally', victim: 'enemy', mine: 'kill' }, { slot: 1, killer: 'enemy', victim: 'ally' }] });
  const kill = d.list.find((x) => x.slot === 0);
  const other = d.list.find((x) => x.slot === 1);
  ok(!d.list.some((x) => x.mine && x.slot !== 0) && (!kill || kill.mine === 'kill' || name === 'pale yellow'),
    `a ${name} wall behind the feed makes no row the player's that is not (${brief(d)})`);
  ok(!other || other.mine === null, `and a teammate's death over the ${name} wall is no death of the player's`);
}

// A full feed, and the order BGRA comes in.
{
  const rows = [0, 1, 2, 3, 4, 5].map((s) => ({ slot: s, killer: s % 2 ? 'enemy' : 'ally', victim: s % 2 ? 'ally' : 'enemy', mine: s === 4 ? 'kill' : null }));
  const d = read({ W: 1920, H: 1080, rows });
  ok(d.rows === 6 && d.list.map((x) => x.slot).join() === '0,1,2,3,4,5' && d.kills.length === 1 && d.kills[0].slot === 4,
    `six rows read top to bottom, the player's at its place (${brief(d)})`);
  const b = read({ W: 1280, H: 720, order: 'bgra', rows: [{ slot: 0, killer: 'ally', victim: 'enemy', mine: 'kill' }, { slot: 1, killer: 'enemy', victim: 'ally', mine: 'death' }] });
  ok(brief(b) === '0:ally>enemy*kill 1:enemy>ally*death', `BGRA, as nativeImage's toBitmap gives it, reads the same (${brief(b)})`);
}

// The signature: the same row in two frames, another row apart.
{
  const a = read({ W: 1280, H: 720, rows: [{ slot: 1, killer: 'ally', victim: 'enemy', mine: 'kill', vlen: 0.07 }] }).list[0];
  const moved = read({ W: 1280, H: 720, rows: [{ slot: 0, killer: 'ally', victim: 'enemy', mine: 'kill', vlen: 0.07 }] }).list[0];
  const other = read({ W: 1280, H: 720, rows: [{ slot: 0, killer: 'ally', victim: 'enemy', mine: 'kill', vlen: 0.11 }] }).list[0];
  ok(a && moved && Math.abs(a.sig.v - moved.sig.v) < 0.003 && Math.abs(a.sig.r - moved.sig.r) < 4, 'a row moved up a place keeps its signature');
  ok(other && Math.abs(other.sig.v - a.sig.v) > 0.02, 'a victim with a longer name has another');
  ok(Object.keys(a).sort().join() === 'killer,mine,sig,slot,victim' && Object.keys(a.sig).sort().join() === 'b,g,r,v',
    'a row says its place, its sides, whose it is and its signature, nothing more (no name is read)');
}

// Bad input never throws.
{
  let threw = false;
  try {
    for (const bad of [null, {}, { width: 10, height: 10, data: Buffer.alloc(3) }, { width: -1, height: 5, data: Buffer.alloc(100) }, 'x']) {
      const d = kf.detect(bad, 720);
      if (!d || d.rows !== 0) threw = true;
    }
  } catch { threw = true; }
  ok(!threw, 'no picture, a short buffer or a size of nothing is no row, never a throw');
}

// The cost: it runs beside the game once a read.
{
  const f = drawFrame({ W: 1920, H: 1080, rows: [{ slot: 0, killer: 'ally', victim: 'enemy', mine: 'kill' }, { slot: 1, killer: 'enemy', victim: 'ally' }] });
  const img = cut(f, kf.regionOf(1920, 1080));
  const t0 = process.hrtime.bigint();
  const N = 50;
  for (let i = 0; i < N; i++) kf.detect(img, 1080);
  const ms = Number(process.hrtime.bigint() - t0) / 1e6 / N;
  ok(ms < 5, `a 1080p frame's feed is read in ${ms.toFixed(2)} ms (under 5)`);
}

// The colour classes, each on a known pixel.
{
  const C = kf.CLASSES;
  ok(kf.classOf(232, 238, 122) === C.YELLOW && kf.classOf(88, 192, 162) === C.TEAL && kf.classOf(226, 84, 92) === C.RED && kf.classOf(120, 120, 120) === C.NONE,
    'yellow, teal, red and grey are each their class');
}

console.log(`\n${fails ? fails + ' of ' + checks + ' failed' : 'all ' + checks + ' kill feed checks passed'}`);
process.exit(fails ? 1 : 0);
