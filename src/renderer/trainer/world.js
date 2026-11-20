// THE ARENAS (docs/claude/trainer.md, "Arenas"). Every one is our own: plain
// volumes in our own colours, built for a Valorant SITUATION (retaking a site,
// holding a long main, peeking on two levels), never traced from a map.
//
// Units are metres, y up, the player looking down -z at the start. An arena is
// a list of boxes merged into ONE mesh. The same boxes are the collision.
// Spots are where bots may stand; the route is the pre-aim path the floor
// chevrons draw; view is the camera the menu shows the arena from.
//
// THE LOOK is a night range under stars, drawn by one small shader (no lights,
// no shadow maps, no post): slate volumes lit by a cool sky and a high moon,
// each with a bright edge so it reads at a glance, a dark floor ruled by a
// glowing metre grid, accents that glow in their own colour (a crate's lid, a
// doorway's frame, the paint on the floor), and distance fading into the
// horizon's teal. Contact shadows are flat quads laid on the floor round
// whatever stands on it. The sky is a dome: stars, and the same horizon.
import * as THREE from './vendor/three.module.min.js';

// ── Colours, as three.js numbers ───────────────────────────────────────────
// Slate for everything built, near black for floors, and three accents that
// glow (GLOW): teal for what to look at, amber for what to follow, white for
// measures.
const ACCENT = 0x4fd6c2, AMBER = 0xf2b441, WHITE = 0xd4dbe6;
const C = {
  concrete: 0x6b707d, concrete2: 0x606572, concrete3: 0x555a67, dark: 0x8e98a9,
  floor: 0x15171d, floor2: 0x1c1f27, floorWarm: 0x15171d, floorWarm2: 0x1c1f27,
  sand: 0x676c79, sand2: 0x5d626f, sand3: 0x535865,
  plaster: 0x6f7481, plaster2: 0x636875,
  teal: 0x747a88, teal2: ACCENT, green: 0x8e98a9,
  wood: 0x61666f, wood2: ACCENT, brick: 0x6c6672, brick2: 0x8e98a9,
  amber: AMBER, white: WHITE,
};
const GLOW = new Set([ACCENT, AMBER, WHITE]);

const SKY = {
  zenith: 0x060a13, horizon: 0x1f5a66, fog: 0x1b4853, fogNear: 45, fogFar: 240,
  sun: [0.35, 0.8, 0.45], skyLight: 0x8a93a8, groundLight: 0x2c2f38, sunLight: 0xdde7ff,
  grid: 0x9fd8e0, edge: 0xc9d6e6,
};

/** A box: its two corners, colour, and whether it blocks (decor does not). */
const box = (x0, y0, z0, x1, y1, z1, color, opts) => ({
  min: [Math.min(x0, x1), Math.min(y0, y1), Math.min(z0, z1)],
  max: [Math.max(x0, x1), Math.max(y0, y1), Math.max(z0, z1)],
  color, solid: !(opts && opts.decor), flat: !!(opts && opts.flat),
});
/** Paint on the floor: a thin slab that neither blocks nor casts. */
const paint = (x0, z0, x1, z1, color, y = 0) => box(x0, y + 0.004, z0, x1, y + 0.012, z1, color, { decor: true, flat: true });

/**
 * A wall along x or z at `at`, `t` thick, with gaps cut from its run, and a
 * darker cap along its top when it is a full wall.
 */
function wall(axis, at, t, from, to, y0, y1, gaps, color, cap) {
  const out = [];
  const piece = (a, b) => {
    out.push(axis === 'x' ? box(a, y0, at, b, y1, at + t, color) : box(at, y0, a, at + t, y1, b, color));
    if (cap) out.push(axis === 'x' ? box(a - 0.05, y1, at - 0.07, b + 0.05, y1 + 0.14, at + t + 0.07, cap, { decor: true }) : box(at - 0.07, y1, a - 0.05, at + t + 0.07, y1 + 0.14, b + 0.05, cap, { decor: true }));
  };
  let s = from;
  for (const [g0, g1] of (gaps || []).slice().sort((a, b) => a[0] - b[0])) {
    if (g0 > s) piece(s, g0);
    s = Math.max(s, g1);
  }
  if (to > s) piece(s, to);
  return out;
}
/** Cover: a block whose top edge glows in the accent, so what can be stood behind is seen at once. */
function crate(x0, y0, z0, x1, y1, z1, color, band) {
  const w = 0.028, o = 0.008, t = { decor: true };
  return [
    box(x0, y0, z0, x1, y1, z1, color),
    box(x0 - o, y1 - w, z0 - o, x1 + o, y1 + o, z0 + w, band, t), box(x0 - o, y1 - w, z1 - w, x1 + o, y1 + o, z1 + o, band, t),
    box(x0 - o, y1 - w, z0 + w, x0 + w, y1 + o, z1 - w, band, t), box(x1 - w, y1 - w, z0 + w, x1 + o, y1 + o, z1 - w, band, t),
  ];
}

// ── The arenas ─────────────────────────────────────────────────────────────

function range() {
  const b = [];
  const H = 7, X = 24, Z0 = -62, Z1 = 12;
  b.push(box(-X - 1, -0.5, Z0 - 1, X + 1, 0, Z1 + 1, C.floor));
  b.push(...wall('x', Z0 - 1, 1, -X - 1, X + 1, 0, H, [], C.concrete2, C.dark));
  b.push(...wall('x', Z1, 1, -X - 1, X + 1, 0, H, [], C.concrete2, C.dark));
  b.push(...wall('z', -X - 1, 1, Z0, Z1, 0, H, [], C.concrete, C.dark));
  b.push(...wall('z', X, 1, Z0, Z1, 0, H, [], C.concrete, C.dark));
  // Pilasters along the side walls and beams across, every 12 m: depth to
  // judge range and speed against.
  for (let z = -6; z >= Z0 + 6; z -= 12) {
    b.push(box(-X, 0, z - 0.4, -X + 0.35, H, z + 0.4, C.concrete3, { decor: true }));
    b.push(box(X - 0.35, 0, z - 0.4, X, H, z + 0.4, C.concrete3, { decor: true }));
    b.push(box(-X, H - 0.22, z - 0.12, X, H, z + 0.12, C.concrete3, { decor: true }));
  }
  // The firing line, and a line every 5 m down range, stronger every 10.
  b.push(paint(-X, -0.09, X, 0.09, C.amber));
  for (let m = 5; m <= 55; m += 5) b.push(paint(-14, -m - (m % 10 ? 0.03 : 0.06), 14, -m + (m % 10 ? 0.03 : 0.06), C.floor2));
  // The calibration lane: 20 m from the yellow line, a mark every 5, and the
  // full turn's marker, a post straight behind the start.
  b.push(paint(16, -20.4, 20, 0.4, C.floor2));
  for (let m = 0; m <= 20; m += 5) b.push(paint(16, -m - 0.07, 20, -m + 0.07, m % 20 === 0 ? C.amber : C.white, 0.012));
  b.push(box(-0.09, 0, 9, 0.09, 5, 9.18, C.amber, { decor: true }));
  b.push(box(-0.5, 0, 8.9, 0.5, 0.12, 9.28, C.dark, { decor: true }));
  return {
    id: 'range', boxes: b, start: { x: 0, y: 0, z: 0, yaw: 0 },
    bounds: { min: [-X + 0.4, -1, Z0 + 0.5], max: [X - 0.4, 30, Z1 - 0.5] },
    lane: { x0: 16, x1: 20, z0: 0, z1: -20 }, marker: { x: 0, z: 9 },
    spots: [], route: [],
    view: { pos: [-9, 5.2, 9], look: [3, 1.2, -18], fov: 52 },
    sample: [[-4, 0, -14], [3, 0, -18], [9, 0, -12], [-9, 0, -21]],
  };
}

function site() {
  const b = [];
  const H = 6;
  b.push(box(-17, -0.5, -21, 27, 0, 27, C.floorWarm));
  // The main: a grey corridor from the spawn side into the site's south wall.
  b.push(...wall('z', -3.5, 0.5, 8.5, 25, 0, H, [], C.concrete, C.dark));
  b.push(...wall('z', 3, 0.5, 8.5, 25, 0, H, [], C.concrete, C.dark));
  b.push(...wall('x', 25, 0.5, -3.5, 3.5, 0, H, [], C.concrete2, C.dark));
  b.push(paint(-3, 8.5, 3, 25, C.floor));
  // The site: sandstone, the main's mouth south, the link east.
  b.push(...wall('x', 8, 0.5, -14.5, 14.5, 0, H, [[-3, 3]], C.sand2, C.sand3));
  b.push(...wall('x', -18.5, 0.5, -14.5, 14.5, 0, H, [], C.sand, C.sand3));
  b.push(...wall('z', -14.5, 0.5, -18, 8, 0, H, [], C.sand2, C.sand3));
  b.push(...wall('z', 14, 0.5, -18, 8, 0, H, [[-10, -6]], C.sand2, C.sand3));
  // The mouth's frame and the link's, in the trim colour: where to look first.
  b.push(box(-3.3, 0, 7.9, -2.94, H, 8.6, C.dark, { decor: true }), box(2.94, 0, 7.9, 3.3, H, 8.6, C.dark, { decor: true }));
  b.push(box(13.9, 0, -10.3, 14.6, H, -9.94, C.dark, { decor: true }), box(13.9, 0, -6.06, 14.6, H, -5.7, C.dark, { decor: true }));
  // The link: a short corridor off the east wall.
  b.push(...wall('x', -10.5, 0.5, 14.5, 24, 0, H, [], C.concrete, C.dark));
  b.push(...wall('x', -6, 0.5, 14.5, 24, 0, H, [], C.concrete, C.dark));
  b.push(...wall('z', 24, 0.5, -10.5, -5.5, 0, H, [], C.concrete2, C.dark));
  // Cover. The default box (a head shows over it crouched), a tall stack, a
  // short box by the west wall, the back platform and a pillar.
  b.push(...crate(-2, 0, -8, 1, 1.15, -5, C.teal, C.teal2));
  b.push(...crate(6, 0, -3, 8.5, 1.3, -0.5, C.wood, C.wood2));
  b.push(...crate(6.3, 1.3, -2.7, 8.2, 2.4, -0.8, C.wood, C.wood2));
  b.push(...crate(-10, 0, 0, -7.5, 1.6, 2.5, C.wood, C.wood2));
  b.push(box(-14, 0, -18, -6, 0.4, -12, C.concrete3));
  b.push(box(-14, 0.4, -18, -6, 0.44, -12, C.concrete2, { decor: true }));
  b.push(box(9, 0, -14, 11, H, -12, C.sand3));
  // The plant zone: a painted square round the default box.
  for (const [x0, z0, x1, z1] of [[-5, -11, 4, -10.86], [-5, -2.14, 4, -2], [-5, -11, -4.86, -2], [3.86, -11, 4, -2]]) b.push(paint(x0, z0, x1, z1, C.amber));
  const face = (x, z) => Math.atan2(-(0 - x), -(10 - z));
  const spot = (id, x, y, z, more) => ({ id, x, y, z, yaw: face(x, z), stance: 'stand', ...more });
  return {
    id: 'site', boxes: b, start: { x: 0, y: 0, z: 21, yaw: 0 },
    bounds: { min: [-14, -1, -18], max: [24, 30, 25] },
    spots: [
      spot('main-left', -2.4, 0, 6.6), spot('main-right', 2.4, 0, 6.6),
      spot('south-west', -13.2, 0, 7.2), spot('south-east', 13.2, 0, 7.2),
      spot('default', -0.5, 0, -8.8, { stance: 'crouch' }),
      spot('stack', 7.3, 0, -4.2), spot('short-box', -8.8, 0, -0.9, { stance: 'crouch' }),
      spot('platform', -10.5, 0.4, -16.6), spot('platform-edge', -13, 0.4, -12.8),
      spot('pillar-back', 12.8, 0, -16.6), spot('pillar-left', 8.2, 0, -15.2),
      spot('link', 17.5, 0, -8), spot('back-wall', 1, 0, -16.8), spot('open', 4, 0, 2.5),
    ],
    route: [[0, 21], [0, 9.5], [-4, 3], [-4.5, -10], [3, -11.5], [11, -8], [13, -8]],
    view: { pos: [-12.5, 11, 16], look: [1, 0.5, -6], fov: 50 },
    sample: [[-0.5, 0, -8.8, 1], [7.3, 0, -4.2], [-10.5, 0.4, -16.6], [12.8, 0, -16.6], [-8.8, 0, -0.9, 1]],
  };
}

function lane() {
  const b = [];
  const H = 6;
  b.push(box(-10, -0.5, -61, 10, 0, 8, C.floor));
  // The main's two walls, each with its cubbies cut in.
  b.push(...wall('z', -4.5, 0.5, -44, 6.5, 0, H, [[-17, -14], [-37, -34]], C.concrete, C.dark));
  b.push(...wall('z', 4, 0.5, -44, 6.5, 0, H, [[-27, -24]], C.concrete, C.dark));
  const cubby = (side, z0, z1) => {
    const x0 = side < 0 ? -7 : 4.5, x1 = side < 0 ? -4.5 : 7;
    b.push(box(side < 0 ? -7.5 : 7, 0, z0 - 0.5, side < 0 ? -7 : 7.5, H, z1 + 0.5, C.concrete3));
    b.push(box(x0, 0, z0 - 0.5, x1, H, z0, C.concrete3), box(x0, 0, z1, x1, H, z1 + 0.5, C.concrete3));
    // Its frame in the trim colour, and a patch of floor: an angle to check.
    const fx = side < 0 ? -4.56 : 3.94;
    b.push(box(fx, 0, z0 - 0.14, fx + 0.62, H, z0 + 0.05, C.dark, { decor: true }), box(fx, 0, z1 - 0.05, fx + 0.62, H, z1 + 0.14, C.dark, { decor: true }));
    b.push(paint(x0, z0, x1, z1, C.floor2));
  };
  cubby(-1, -17, -14); cubby(1, -27, -24); cubby(-1, -37, -34);
  // The choke at the far end, in brick, and the room beyond the bots come from.
  b.push(...wall('x', -45, 1, -9, 9, 0, H, [[-1.5, 1.5]], C.brick, C.brick2));
  b.push(...wall('z', -9, 0.5, -60, -45, 0, H, [], C.concrete2, C.dark));
  b.push(...wall('z', 8.5, 0.5, -60, -45, 0, H, [], C.concrete2, C.dark));
  b.push(...wall('x', -60.5, 0.5, -9, 9, 0, H, [], C.concrete2, C.dark));
  b.push(...wall('x', 6.5, 0.5, -4.5, 4.5, 0, H, [], C.concrete2, C.dark));
  // The player's cover at the near end.
  b.push(...crate(-2.6, 0, -1.3, -0.5, 1.05, -0.3, C.teal, C.teal2));
  // A line every 10 m along the main, to judge range.
  for (let m = 10; m <= 40; m += 10) b.push(paint(-4, -m - 0.05, 4, -m + 0.05, C.amber));
  const face = (x, z) => Math.atan2(-(0 - x), -(2 - z));
  return {
    id: 'lane', boxes: b, start: { x: 0.8, y: 0, z: 1.6, yaw: 0 },
    bounds: { min: [-4, -1, -44.5], max: [4, 30, 6.5] },
    spots: [
      { id: 'cubby-1', x: -5.8, y: 0, z: -15.5, yaw: face(-5.8, -15.5), out: [-2.6, -15.5] },
      { id: 'cubby-2', x: 5.8, y: 0, z: -25.5, yaw: face(5.8, -25.5), out: [2.4, -25.5] },
      { id: 'cubby-3', x: -5.8, y: 0, z: -35.5, yaw: face(-5.8, -35.5), out: [-2.2, -35.5] },
      { id: 'choke', x: 0, y: 0, z: -52, yaw: 0, out: [0, -38] },
    ],
    route: [],
    view: { pos: [3.2, 4.6, 5.6], look: [-0.6, 1.0, -26], fov: 50 },
    sample: [[-2.6, 0, -15.5], [2.4, 0, -25.5], [0.4, 0, -37]],
  };
}

function stack() {
  const b = [];
  const H = 9;
  b.push(box(-14, -0.5, -14, 14, 0, 17, C.floorWarm));
  b.push(...wall('z', -13, 0.5, -4.5, 15.5, 0, 6, [], C.concrete, C.dark));
  b.push(...wall('z', 12.5, 0.5, -4.5, 15.5, 0, 6, [], C.concrete, C.dark));
  b.push(...wall('x', 15.5, 0.5, -13, 13, 0, 6, [], C.concrete2, C.dark));
  // The building's front at z = -4.5: two doors, a wide opening, an upper
  // window and a balcony whose floor is 4 m up.
  const F = -4.5;
  b.push(...wall('x', F, 0.5, -12.5, 12.5, 0, 2.8, [[-8, -6], [-2, 2], [6, 8]], C.plaster));
  b.push(...wall('x', F, 0.5, -12.5, 12.5, 2.8, 3.2, [[-2, 2]], C.plaster));
  b.push(...wall('x', F, 0.5, -12.5, 12.5, 3.2, 5.0, [[2.6, 6.8]], C.plaster2));
  b.push(...wall('x', F, 0.5, -12.5, 12.5, 5.0, 6.5, [[-4, -1.5], [2.6, 6.8]], C.plaster));
  b.push(...wall('x', F, 0.5, -12.5, 12.5, 6.5, H, [], C.plaster, C.green));
  // A band between the floors, and frames round every opening.
  b.push(box(-12.5, 3.3, F + 0.5, 12.5, 3.55, F + 0.56, C.green, { decor: true }));
  for (const [x0, x1, y1] of [[-8, -6, 2.8], [6, 8, 2.8], [-2, 2, 3.2]]) {
    b.push(box(x0 - 0.14, 0, F + 0.5, x0, y1 + 0.14, F + 0.58, C.green, { decor: true }), box(x1, 0, F + 0.5, x1 + 0.14, y1 + 0.14, F + 0.58, C.green, { decor: true }));
    b.push(box(x0, y1, F + 0.5, x1, y1 + 0.14, F + 0.58, C.green, { decor: true }));
  }
  b.push(box(-4.14, 4.86, F + 0.5, -1.36, 5.0, F + 0.6, C.green, { decor: true }), box(-4.14, 6.5, F + 0.5, -1.36, 6.64, F + 0.58, C.green, { decor: true }));
  b.push(box(-4.14, 5.0, F + 0.5, -4, 6.5, F + 0.58, C.green, { decor: true }), box(-1.5, 5.0, F + 0.5, -1.36, 6.5, F + 0.58, C.green, { decor: true }));
  // Inside: the upper floor, the back wall, the sides.
  b.push(box(-12.5, 3.8, -12, 12.5, 4.0, -4.5, C.concrete3));
  b.push(box(-12.5, 0, -12.5, 12.5, H, -12, C.plaster2));
  b.push(box(-13, 0, -12.5, -12.5, H, -4, C.plaster2), box(12.5, 0, -12.5, 13, H, -4, C.plaster2));
  // The balcony: a slab out from the opening and a low wall a head shows over.
  b.push(box(2.6, 3.8, -4.5, 6.8, 4.0, -2.6, C.green));
  b.push(box(2.6, 4.0, -2.8, 6.8, 4.95, -2.6, C.green));
  b.push(box(2.5, 4.95, -2.86, 6.9, 5.03, -2.54, C.dark, { decor: true }));
  // Cover in the courtyard.
  b.push(...crate(-6, 0, 3, -4, 1.3, 5, C.wood, C.wood2));
  b.push(...crate(4, 0, 4, 6, 1.3, 6, C.wood, C.wood2));
  return {
    id: 'stack', boxes: b, start: { x: 0, y: 0, z: 11, yaw: 0 },
    bounds: { min: [-12.5, -1, -3.8], max: [12.5, 30, 15.5] },
    spots: [
      // jiggle: a short peek and back. wide: a swing out and a stop.
      // strafe: across a gap. from and to are the move's two ends.
      { id: 'door-left', y: 0, behave: 'jiggle', from: [-9.4, -6.2], to: [-7.0, -6.2] },
      { id: 'door-right', y: 0, behave: 'wide', from: [8.4, -6.2], to: [7.0, -3.4] },
      { id: 'garage', y: 0, behave: 'strafe', from: [-3.5, -6.5], to: [3.5, -6.5] },
      { id: 'window', y: 4.0, behave: 'jiggle', from: [-6.2, -5.4], to: [-2.8, -5.4] },
      { id: 'balcony', y: 4.0, behave: 'wide', from: [5.8, -6.2], to: [4.6, -3.4] },
    ],
    route: [],
    view: { pos: [-9.5, 6.4, 14.5], look: [1.5, 2.6, -4], fov: 50 },
    sample: [[-7.0, 0, -5.6], [0.8, 0, -6.5], [-2.8, 4.0, -5.4], [4.6, 4.0, -3.4]],
  };
}

/** A close corner: a corridor into a T, with someone round either side. */
function corner() {
  const b = [];
  const H = 5;
  b.push(box(-14, -0.5, -15, 14, 0, 9, C.floor));
  // The corridor the player comes up, and the T it meets.
  b.push(...wall('z', -2.5, 0.5, -7.5, 7, 0, H, [], C.concrete, C.dark));
  b.push(...wall('z', 2, 0.5, -7.5, 7, 0, H, [], C.concrete, C.dark));
  b.push(...wall('x', 7, 0.5, -2.5, 2.5, 0, H, [], C.concrete2, C.dark));
  b.push(...wall('x', -8, 0.5, -12.5, -2.5, 0, H, [], C.sand2, C.dark));
  b.push(...wall('x', -8, 0.5, 2.5, 12.5, 0, H, [], C.sand2, C.dark));
  b.push(...wall('x', -13.5, 0.5, -12.5, 12.5, 0, H, [], C.sand, C.dark));
  b.push(...wall('z', -13, 0.5, -13.5, -7.5, 0, H, [], C.sand2, C.dark));
  b.push(...wall('z', 12.5, 0.5, -13.5, -7.5, 0, H, [], C.sand2, C.dark));
  // Something to hide behind down each arm, and a box at the mouth.
  b.push(...crate(-9.5, 0, -12.6, -7.5, 1.2, -11.2, C.teal, C.teal2));
  b.push(...crate(7, 0, -9.6, 9, 1.2, -8.4, C.teal, C.teal2));
  b.push(...crate(-0.9, 0, -13, 0.9, 1.05, -12, C.wood, C.wood2));
  b.push(paint(-2, -7.6, 2, -7.46, C.amber));
  const face = (x, z) => Math.atan2(-(0 - x), -(-4 - z));
  const spot = (id, x, z, more) => ({ id, x, y: 0, z, yaw: face(x, z), stance: 'stand', ...more });
  return {
    id: 'corner', boxes: b, start: { x: 0, y: 0, z: 5, yaw: 0 },
    bounds: { min: [-12.5, -1, -13], max: [12.5, 30, 7] },
    spots: [
      spot('left-tight', -3.6, -8.7), spot('left-deep', -11.5, -10), spot('left-box', -8.5, -10.6, { stance: 'crouch' }),
      spot('right-tight', 3.6, -8.7), spot('right-deep', 11.5, -11.5), spot('right-box', 8, -10.3, { stance: 'crouch' }),
      spot('ahead-box', 0, -11.4, { stance: 'crouch' }), spot('ahead-left', -1.6, -12.6),
    ],
    route: [[0, 5], [0, -6.5]],
    view: { pos: [9, 9.5, 8], look: [-1, 0.5, -9], fov: 52 },
    sample: [[-3.6, 0, -8.7], [8, 0, -10.3, 1], [-11.5, 0, -10], [0, 0, -11.4, 1]],
  };
}

/** After the plant: an open site with the charge down, two ways in, and the player holding it. */
function plant() {
  const b = [];
  const H = 5.5;
  b.push(box(-17, -0.5, -22, 17, 0, 12, C.floor));
  b.push(...wall('x', 10, 0.5, -14.5, 14.5, 0, H, [], C.concrete2, C.dark));
  b.push(...wall('z', -14.5, 0.5, -16, 10, 0, H, [[-9, -5]], C.sand2, C.dark));
  b.push(...wall('z', 14, 0.5, -16, 10, 0, H, [], C.sand2, C.dark));
  b.push(...wall('x', -16.5, 0.5, -14.5, 14.5, 0, H, [[4, 8]], C.sand, C.dark));
  // The two ways in: a room off the far wall and a room off the left one.
  b.push(...wall('x', -21.5, 0.5, 2, 10, 0, H, [], C.concrete, C.dark));
  b.push(...wall('z', 2, 0.5, -21.5, -16, 0, H, [], C.concrete, C.dark), ...wall('z', 9.5, 0.5, -21.5, -16, 0, H, [], C.concrete, C.dark));
  b.push(...wall('z', -17, 0.5, -11, -3, 0, H, [], C.concrete, C.dark));
  b.push(...wall('x', -11, 0.5, -17, -14.5, 0, H, [], C.concrete, C.dark), ...wall('x', -3.5, 0.5, -17, -14.5, 0, H, [], C.concrete, C.dark));
  // Cover: the player's at the near end, and what the site gives a pusher.
  b.push(...crate(-2.5, 0, 5, 0.5, 1.1, 6.2, C.teal, C.teal2));
  b.push(...crate(5, 0, 2, 7, 1.9, 4, C.wood, C.wood2));
  b.push(...crate(-8, 0, -11, -5.5, 1.3, -9, C.wood, C.wood2));
  b.push(...crate(8, 0, -9, 10, 1.3, -6.5, C.teal, C.teal2));
  // The charge: a marker of our own, lit, in a painted square.
  b.push(box(-0.16, 0, -3.16, 0.16, 0.34, -2.84, C.amber, { decor: true }));
  for (const [x0, z0, x1, z1] of [[-1.5, -4.5, 1.5, -4.4], [-1.5, -1.6, 1.5, -1.5], [-1.5, -4.5, -1.4, -1.5], [1.4, -4.5, 1.5, -1.5]]) b.push(paint(x0, z0, x1, z1, C.amber));
  return {
    id: 'plant', boxes: b, start: { x: -1, y: 0, z: 7.6, yaw: 0 },
    bounds: { min: [-14, -1, -16], max: [14, 30, 10] },
    // Each bot walks its path in, holding each point for its seconds; one left alive at the end got away.
    spots: [
      { id: 'far-door', x: 6, y: 0, z: -19.5, path: [[6, -16.2, 0], [6, -12, 1.2], [3, -7, 2.5]] },
      { id: 'far-door-wide', x: 6.6, y: 0, z: -20, path: [[6.6, -16.2, 0], [10.6, -10.6, 2.8]] },
      { id: 'left-door', x: -16, y: 0, z: -7, path: [[-14.2, -7, 0], [-10.5, -7, 1.2], [-6.5, -6, 2.5]] },
      { id: 'left-door-tight', x: -16, y: 0, z: -6.4, path: [[-14.2, -6.4, 0], [-12.5, -3, 3]] },
    ],
    route: [],
    view: { pos: [-11, 11, 13], look: [1, 0.4, -5], fov: 50 },
    sample: [[6, 0, -12], [-10.5, 0, -7], [10.6, 0, -10.6, 1]],
  };
}

/**
 * One fight, laid out from a death (trainer-replay.js spec): the player at one
 * end, the enemy `dist` metres off, and cover that makes it the kind of fight
 * it was. peek: the player starts behind a corner and has to come round it
 * onto someone already holding. hold: the player holds from cover and someone
 * swings out. rotate: the player is in the open and it comes from the side.
 * duel: face to face across the yard. Nothing here is a place in any map.
 */
function duel(spec) {
  const sp = spec || {};
  const judged = { close: 6, mid: 15, long: 34 }[sp.range] || 15;
  const d = Math.max(4, Math.min(45, Number.isFinite(sp.dist) ? sp.dist : judged));
  const kind = sp.situation || 'duel';
  const b = [];
  const H = 5;
  const W = Math.max(12, Math.min(18, d * 0.7));
  const far = -(d + 9);
  b.push(box(-W - 1, -0.5, far - 1, W + 1, 0, 9, C.floor));
  b.push(...wall('x', 8, 0.5, -W, W, 0, H, [], C.concrete2, C.dark));
  b.push(...wall('x', far - 0.5, 0.5, -W, W, 0, H, [], C.sand, C.dark));
  b.push(...wall('z', -W - 0.5, 0.5, far, 8, 0, H, [], C.concrete, C.dark));
  b.push(...wall('z', W, 0.5, far, 8, 0, H, [], C.concrete, C.dark));
  const start = { x: 0, y: 0, z: 0, yaw: 0 };
  const enemy = [];      // where each enemy waits, and where it steps out to
  if (kind === 'peek') {
    // A wall across the player's front with its end just right of them.
    b.push(...wall('x', -3.2, 0.6, -W, 1.2, 0, H, [], C.sand2, C.dark));
    start.x = -1.6; start.z = 0.6;
    // Each enemy stands its distance from the corner's end, fanned out past it.
    const at = (deg, r) => { const a = deg * Math.PI / 180; const x = Math.min(W - 1.5, 1.2 + Math.sin(a) * r), z = -2.9 - Math.cos(a) * r; return { from: [x, z], to: [x, z], holds: true }; };
    enemy.push(at(22, d), at(40, Math.max(3, d - 1.5)), at(9, d + 2));
  } else if (kind === 'hold') {
    b.push(...crate(-1.4, 0, -2.4, 1.4, 1.1, -1.4, C.teal, C.teal2));
    // What they come out from behind.
    b.push(...wall('x', -d - 0.3, 0.6, -5, -0.6, 0, H, [], C.sand2, C.dark));
    b.push(...wall('x', -d - 0.3, 0.6, 3.4, 8, 0, H, [], C.sand2, C.dark));
    enemy.push({ from: [-2.4, -d - 2], to: [1.2, -d + 1.2] }, { from: [5.4, -d - 2], to: [2.2, -d + 0.4] }, { from: [-3, -d - 2.2], to: [-6.5, -d + 1] });
  } else if (kind === 'rotate') {
    // In the open, and it comes from the side: pillars to come out from.
    const a = 68 * Math.PI / 180;
    const ex = Math.sin(a) * d, ez = -Math.cos(a) * d;
    const cx = Math.min(W - 2.5, ex);
    b.push(box(cx - 0.9, 0, ez - 0.9, cx + 0.9, H, ez + 0.9, C.sand3));
    b.push(box(-cx - 0.9, 0, ez - 3.9, -cx + 0.9, H, ez - 2.1, C.sand3));
    b.push(...crate(-1.2, 0, -7, 1.2, 1.1, -6, C.teal, C.teal2));
    // Behind a pillar is its far side from the player; out is a step sideways from there, clear of the pillar.
    const round = (px, pz, side) => {
      const l = Math.hypot(px, pz) || 1, ux = px / l, uz = pz / l;
      const fx = Math.max(-W + 0.8, Math.min(W - 0.8, px + ux * 1.7)), fz = pz + uz * 1.7;
      return { from: [fx, fz], to: [Math.max(-W + 0.8, Math.min(W - 0.8, fx - uz * 2.4 * side)), fz + ux * 2.4 * side] };
    };
    enemy.push(round(cx, ez, 1), round(-cx, ez - 3, 1), round(cx, ez, -1));
  } else {
    b.push(...crate(-3.6, 0, -1.6, -1.6, 1.1, -0.6, C.teal, C.teal2));
    b.push(...crate(1.4, 0, -d + 0.8, 3.4, 1.1, -d + 1.8, C.teal, C.teal2));
    enemy.push({ from: [0, -d], to: [0, -d], holds: true }, { from: [-4.5, -d - 1], to: [-4.5, -d - 1], holds: true }, { from: [4.8, -d + 1.5], to: [4.8, -d + 1.5], holds: true });
  }
  if (sp.afterPlant) {
    // The charge, beside the player: it is what the fight was over.
    b.push(box(start.x + 2.2, 0, start.z + 1.6, start.x + 2.52, 0.34, start.z + 1.92, C.amber, { decor: true }));
  }
  // A line every 5 m from the player to the enemy, to see the range it happened at.
  for (let m = 5; m < d; m += 5) b.push(paint(-1, -m - 0.04, 1, -m + 0.04, C.white));
  return {
    id: 'duel', boxes: b, start,
    bounds: { min: [-W + 0.1, -1, far + 0.1], max: [W - 0.1, 30, 7.9] },
    spots: [], route: [], enemy, kind, dist: d,
    view: { pos: [W * 0.75, 7 + d * 0.18, 9], look: [0, 0.6, -d * 0.55], fov: 50 },
    sample: enemy.slice(0, Math.max(1, Math.min(3, sp.enemies || 1))).map((e) => [e.to[0], 0, e.to[1]]),
  };
}

const ARENAS = { range, site, lane, stack, corner, plant, duel };
export const ARENA_IDS = Object.keys(ARENAS);

// ── The shader ─────────────────────────────────────────────────────────────

const lin = (hex) => new THREE.Color(hex);

const WORLD_VERT = /* glsl */`
attribute vec2 aUv;
attribute vec3 aSize;
attribute float aGlow;
varying vec3 vCol; varying vec3 vN; varying vec3 vW; varying vec2 vUv; varying vec3 vSize; varying float vDist; varying float vGlow;
void main() {
  vCol = color; vN = normal; vUv = aUv; vSize = aSize; vGlow = aGlow;
  vec4 w = modelMatrix * vec4(position, 1.0);
  vW = w.xyz;
  vec4 mv = viewMatrix * w;
  vDist = -mv.z;
  gl_Position = projectionMatrix * mv;
}`;

const WORLD_FRAG = /* glsl */`
uniform vec3 uSun; uniform vec3 uSunLight; uniform vec3 uSkyLight; uniform vec3 uGroundLight;
uniform vec3 uFog; uniform float uFogNear; uniform float uFogFar; uniform float uDetail;
uniform vec3 uGrid; uniform vec3 uEdge;
varying vec3 vCol; varying vec3 vN; varying vec3 vW; varying vec2 vUv; varying vec3 vSize; varying float vDist; varying float vGlow;

float grid(vec2 p, float cell) {
  vec2 q = p / cell;
  vec2 fw = fwidth(q);
  vec2 d = abs(fract(q - 0.5) - 0.5) / max(fw, vec2(1e-5));
  float line = 1.0 - min(min(d.x, d.y), 1.0);
  // Faded out where the cells shrink to a few pixels, so it never shimmers.
  return line * (1.0 - smoothstep(0.12, 0.45, max(fw.x, fw.y)));
}

void main() {
  vec3 n = normalize(vN);
  float up = n.y;
  float wallish = 1.0 - abs(up);
  vec3 light = mix(uGroundLight, uSkyLight, up * 0.5 + 0.5) + uSunLight * max(dot(n, uSun), 0.0);
  vec3 col = vCol * light;

  // Where it stands on a floor, a wall darkens toward it, and lifts a little toward its top.
  float grounded = vSize.z;
  float h = vUv.y;
  col *= mix(1.0, mix(0.7, 1.0, smoothstep(0.0, 1.8, h)), wallish * grounded);
  col *= 1.0 + 0.10 * wallish * smoothstep(0.0, 5.0, h);

  // The grid: it glows on floors, a metre fine and every four stronger, and is
  // only hinted on walls.
  vec2 p = abs(up) > 0.5 ? vW.xz : (abs(n.x) > 0.5 ? vec2(vW.z, vW.y) : vec2(vW.x, vW.y));
  float floorish = step(0.5, up);
  float g1 = grid(p, 1.0), g4 = grid(p, 4.0);
  col += uGrid * (g1 * 0.07 + g4 * 0.20) * floorish * uDetail;
  col += uGrid * g1 * 0.018 * (1.0 - floorish) * uDetail;

  // A bright edge on every face, so a block reads as a block against a like wall.
  vec2 e2 = min(vUv, vSize.xy - vUv);
  float e = min(e2.x, e2.y);
  float edge = 1.0 - smoothstep(0.010, 0.010 + fwidth(e) * 1.5, e);
  col = mix(col, uEdge, edge * 0.55 * uDetail * (1.0 - floorish * 0.6));

  // Accents glow in their own colour, whatever the light.
  col = mix(col, vCol * 1.15, vGlow);

  col = mix(col, uFog, smoothstep(uFogNear, uFogFar, vDist) * 0.92);
  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
}`;

let worldMat = null;
function worldMaterial() {
  if (worldMat) return worldMat;
  worldMat = new THREE.ShaderMaterial({
    vertexShader: WORLD_VERT, fragmentShader: WORLD_FRAG, vertexColors: true,
    uniforms: {
      uSun: { value: new THREE.Vector3(...SKY.sun).normalize() },
      uSunLight: { value: lin(SKY.sunLight).multiplyScalar(0.55) },
      uSkyLight: { value: lin(SKY.skyLight).multiplyScalar(0.95) },
      uGroundLight: { value: lin(SKY.groundLight).multiplyScalar(1.1) },
      uFog: { value: lin(SKY.fog) }, uFogNear: { value: SKY.fogNear }, uFogFar: { value: SKY.fogFar },
      uGrid: { value: lin(SKY.grid) }, uEdge: { value: lin(SKY.edge) },
      uDetail: { value: 1 },
    },
  });
  return worldMat;
}

const SKY_FRAG = /* glsl */`
uniform vec3 uZenith; uniform vec3 uHorizon;
varying vec3 vDir;
float hash(vec3 p) { p = fract(p * 0.3183099 + vec3(0.1, 0.2, 0.3)); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
void main() {
  vec3 d = normalize(vDir);
  // The horizon's glow, falling away to the dark above.
  float t = smoothstep(-0.02, 0.5, d.y);
  vec3 col = mix(uHorizon, uZenith, pow(t, 0.62));
  col += uHorizon * 0.5 * exp(-max(d.y, 0.0) * 9.0);
  // Stars: one cell in a few hundred holds one, brighter or fainter, none near the horizon.
  vec3 p = d * 190.0;
  vec3 cell = floor(p);
  float h = hash(cell);
  float size = 0.18 + 0.22 * hash(cell + 7.1);
  float star = step(0.9945, h) * smoothstep(size, 0.0, length(fract(p) - 0.5));
  col += vec3(0.85, 0.92, 1.0) * star * (0.35 + 0.65 * hash(cell + 3.7)) * smoothstep(0.04, 0.3, d.y);
  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
}`;

/** The sky: a dome that follows the camera. Made once. */
export function buildSky() {
  const m = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, depthTest: false,
    vertexShader: 'varying vec3 vDir; void main() { vDir = position; gl_Position = projectionMatrix * viewMatrix * vec4(position + cameraPosition, 1.0); }',
    fragmentShader: SKY_FRAG,
    uniforms: { uZenith: { value: lin(SKY.zenith) }, uHorizon: { value: lin(SKY.horizon) } },
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 16), m);
  mesh.frustumCulled = false;
  mesh.renderOrder = -10;
  return mesh;
}

export const SUN = SKY.sun;
/** The colour distance fades to, for whatever else is drawn in the scene. */
export const HAZE = SKY.fog;
/** How much surface detail (grid and edges) the world draws: 1, or 0.6 on Low. */
export function setDetail(v) { worldMaterial().uniforms.uDetail.value = v; }

// ── Building ───────────────────────────────────────────────────────────────

const FACES = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];

/** Whether a box stands on a floor: on the ground, or on top of another solid it overlaps. */
function groundedOn(b, boxes) {
  if (b.flat) return false;
  if (Math.abs(b.min[1]) < 1e-3) return true;
  for (const o of boxes) {
    if (o === b || !o.solid) continue;
    if (Math.abs(o.max[1] - b.min[1]) > 1e-3 || b.min[0] >= o.max[0] || b.max[0] <= o.min[0] || b.min[2] >= o.max[2] || b.max[2] <= o.min[2]) continue;
    // A floor under it, not the course of wall below it: what it stands on is clearly the larger.
    if ((o.max[0] - o.min[0]) * (o.max[2] - o.min[2]) > 1.4 * (b.max[0] - b.min[0]) * (b.max[2] - b.min[2])) return true;
  }
  return false;
}

/** One merged mesh for the arena's boxes. */
function buildMesh(boxes) {
  const pos = [], nor = [], uv = [], size = [], col = [], glow = [], idx = [];
  const c = new THREE.Color();
  let v = 0;
  for (const bx of boxes) {
    const [x0, y0, z0] = bx.min, [x1, y1, z1] = bx.max;
    c.setHex(bx.color);
    const g = groundedOn(bx, boxes) ? 1 : 0;
    const gl = GLOW.has(bx.color) ? 1 : 0;
    for (const [nx, ny, nz] of FACES) {
      if (ny < 0 && y0 <= 0.02) continue;          // never seen: against the ground
      if (bx.flat && ny <= 0) continue;            // paint: its top alone
      let q, w, h;
      if (nx) { const x = nx > 0 ? x1 : x0; q = [[x, y0, z0, 0, 0], [x, y0, z1, 1, 0], [x, y1, z1, 1, 1], [x, y1, z0, 0, 1]]; w = z1 - z0; h = y1 - y0; }
      else if (ny) { const y = ny > 0 ? y1 : y0; q = [[x0, y, z0, 0, 0], [x1, y, z0, 1, 0], [x1, y, z1, 1, 1], [x0, y, z1, 0, 1]]; w = x1 - x0; h = z1 - z0; }
      else { const z = nz > 0 ? z1 : z0; q = [[x0, y0, z, 0, 0], [x1, y0, z, 1, 0], [x1, y1, z, 1, 1], [x0, y1, z, 0, 1]]; w = x1 - x0; h = y1 - y0; }
      // Wound so the face's front looks the way its normal does.
      const ax = q[1][0] - q[0][0], ay = q[1][1] - q[0][1], az = q[1][2] - q[0][2];
      const bx2 = q[2][0] - q[0][0], by = q[2][1] - q[0][1], bz = q[2][2] - q[0][2];
      if ((ay * bz - az * by) * nx + (az * bx2 - ax * bz) * ny + (ax * by - ay * bx2) * nz < 0) q.reverse();
      for (const p of q) {
        pos.push(p[0], p[1], p[2]);
        nor.push(nx, ny, nz);
        uv.push(p[3] * w, p[4] * h);
        size.push(w, h, g);
        col.push(c.r, c.g, c.b);
        glow.push(gl);
      }
      idx.push(v, v + 1, v + 2, v, v + 2, v + 3);
      v += 4;
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  geo.setAttribute('aUv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setAttribute('aSize', new THREE.Float32BufferAttribute(size, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.setAttribute('aGlow', new THREE.Float32BufferAttribute(glow, 1));
  geo.setIndex(idx);
  geo.computeBoundingSphere();
  const mesh = new THREE.Mesh(geo, worldMaterial());
  mesh.frustumCulled = false;
  return mesh;
}

let shadeMat = null;
/** Flat dark quads whose darkness is a vertex value: contact shadows and the bots' own. */
export function shadeMaterial() {
  if (shadeMat) return shadeMat;
  shadeMat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1,
    vertexShader: 'attribute float aShade; varying float vShade; void main() { vShade = aShade; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: 'varying float vShade; void main() { gl_FragColor = vec4(0.0, 0.0, 0.0, vShade * vShade); }',
  });
  return shadeMat;
}

/** The contact shadows: a strip of darkness on the floor round every box that stands on one. */
function buildContact(boxes) {
  const pos = [], shade = [], idx = [];
  let v = 0;
  const R = 0.85, A = 0.62;
  const quad = (a, b, c, d, sa, sb, sc, sd) => {
    for (const [p, s] of [[a, sa], [b, sb], [c, sc], [d, sd]]) { pos.push(p[0], p[1], p[2]); shade.push(s); }
    idx.push(v, v + 1, v + 2, v, v + 2, v + 3);
    v += 4;
  };
  for (const b of boxes) {
    if (!b.solid || b.flat || !groundedOn(b, boxes)) continue;
    if (b.max[1] - b.min[1] < 0.3) continue;
    const y = b.min[1] + 0.006;
    const [x0, , z0] = b.min, [x1, , z1] = b.max;
    // Taller things throw a wider, darker strip.
    const k = Math.min(1, (b.max[1] - b.min[1]) / 2.5);
    const r = R * (0.5 + 0.5 * k), a = A * (0.6 + 0.4 * k);
    quad([x0, y, z1], [x1, y, z1], [x1, y, z1 + r], [x0, y, z1 + r], a, a, 0, 0);
    quad([x1, y, z0], [x0, y, z0], [x0, y, z0 - r], [x1, y, z0 - r], a, a, 0, 0);
    quad([x1, y, z1], [x1, y, z0], [x1 + r, y, z0], [x1 + r, y, z1], a, a, 0, 0);
    quad([x0, y, z0], [x0, y, z1], [x0 - r, y, z1], [x0 - r, y, z0], a, a, 0, 0);
    quad([x1, y, z1], [x1 + r, y, z1], [x1 + r, y, z1 + r], [x1, y, z1 + r], a, 0, 0, 0);
    quad([x0, y, z1], [x0, y, z1 + r], [x0 - r, y, z1 + r], [x0 - r, y, z1], a, 0, 0, 0);
    quad([x1, y, z0], [x1, y, z0 - r], [x1 + r, y, z0 - r], [x1 + r, y, z0], a, 0, 0, 0);
    quad([x0, y, z0], [x0 - r, y, z0], [x0 - r, y, z0 - r], [x0, y, z0 - r], a, 0, 0, 0);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('aShade', new THREE.Float32BufferAttribute(shade, 1));
  geo.setIndex(idx);
  const mesh = new THREE.Mesh(geo, shadeMaterial());
  mesh.frustumCulled = false;
  mesh.renderOrder = 1;
  return mesh;
}

/** Chevrons on the floor along the route, one every 2.4 m. */
function buildChevrons(route) {
  if (!route || route.length < 2) return null;
  const s = new THREE.Shape();
  s.moveTo(0, 0.42); s.lineTo(0.5, -0.08); s.lineTo(0.5, -0.36); s.lineTo(0, 0.14); s.lineTo(-0.5, -0.36); s.lineTo(-0.5, -0.08); s.closePath();
  const geo = new THREE.ShapeGeometry(s);
  geo.rotateX(-Math.PI / 2);
  const marks = [];
  for (let i = 0; i + 1 < route.length; i++) {
    const [ax, az] = route[i], [bx, bz] = route[i + 1];
    const len = Math.hypot(bx - ax, bz - az);
    const yaw = Math.atan2(-(bx - ax), -(bz - az));
    for (let d = 1.2; d < len - 0.4; d += 2.4) marks.push([ax + ((bx - ax) * d) / len, az + ((bz - az) * d) / len, yaw]);
  }
  const mat = new THREE.MeshBasicMaterial({ color: C.amber, transparent: true, opacity: 0.8, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  const mesh = new THREE.InstancedMesh(geo, mat, marks.length);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(1, 1, 1), p = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
  marks.forEach(([x, z, yaw], i) => { q.setFromAxisAngle(up, yaw); p.set(x, 0.02, z); m4.compose(p, q, sc); mesh.setMatrixAt(i, m4); });
  mesh.renderOrder = 2;
  mesh.frustumCulled = false;
  return mesh;
}

/** The arena: its meshes added to `scene`, and what the simulation needs. */
export function buildArena(id, scene, extra, spec) {
  const a = (ARENAS[id] || ARENAS.range)(spec);
  // A scenario's own boxes (the spray wall), each [x0, y0, z0, x1, y1, z1].
  for (const x of extra || []) a.boxes.push(...wall('x', Math.min(x[2], x[5]), Math.abs(x[5] - x[2]), x[0], x[3], x[1], x[4], [], C.plaster, C.dark));
  const group = new THREE.Group();
  group.add(buildMesh(a.boxes), buildContact(a.boxes));
  const chev = buildChevrons(a.route);
  if (chev) group.add(chev);
  scene.add(group);
  a.group = group;
  a.solids = a.boxes.filter((x) => x.solid);
  return a;
}

export function disposeArena(a, scene) {
  if (!a || !a.group) return;
  scene.remove(a.group);
  a.group.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material && o.material !== worldMat && o.material !== shadeMat) o.material.dispose(); });
}

/** The arena seen from above, for the menu's thumbnail: footprints of what stands on its floor, in its bounds. */
export function arenaPlan(id, spec) {
  const a = (ARENAS[id] || ARENAS.range)(spec);
  const solids = a.boxes.filter((b) => b.solid && b.max[1] - b.min[1] > 0.3 && b.min[1] < 3);
  return {
    bounds: a.bounds, start: a.start, route: a.route,
    spots: a.spots.map((s) => (s.from ? [s.to[0], s.to[1]] : [s.out ? s.out[0] : s.x, s.out ? s.out[1] : s.z])),
    blocks: solids.filter((b) => b.min[1] >= -0.01).map((b) => ({ x0: b.min[0], z0: b.min[2], x1: b.max[0], z1: b.max[2], tall: b.max[1] - b.min[1] > 2.5 })),
  };
}

/**
 * The distance along a ray to the first solid box it meets, or maxD.
 * A slab test per box; an arena is a few dozen boxes, so a loop is cheaper
 * than any structure.
 */
export function rayWorld(solids, ox, oy, oz, dx, dy, dz, maxD) {
  let best = maxD;
  const ix = 1 / dx, iy = 1 / dy, iz = 1 / dz;
  for (let i = 0; i < solids.length; i++) {
    const b = solids[i];
    let t0 = (b.min[0] - ox) * ix, t1 = (b.max[0] - ox) * ix;
    if (t0 > t1) { const t = t0; t0 = t1; t1 = t; }
    let u0 = (b.min[1] - oy) * iy, u1 = (b.max[1] - oy) * iy;
    if (u0 > u1) { const t = u0; u0 = u1; u1 = t; }
    if (u0 > t0) t0 = u0;
    if (u1 < t1) t1 = u1;
    let w0 = (b.min[2] - oz) * iz, w1 = (b.max[2] - oz) * iz;
    if (w0 > w1) { const t = w0; w0 = w1; w1 = t; }
    if (w0 > t0) t0 = w0;
    if (w1 < t1) t1 = w1;
    if (t1 >= t0 && t1 > 0 && t0 < best) best = Math.max(0, t0);
  }
  return best;
}
