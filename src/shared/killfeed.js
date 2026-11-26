'use strict';

/**
 * THE KILL FEED, READ OFF A FRAME (the live rating, build 2;
 * docs/claude/rating.md "Live").
 *
 * Pure and cheap: no Electron, no network, no file. It is handed the pixels of
 * the top right corner of a frame the reader already captured (index.js cuts
 * it with nativeImage, `regionOf` says where) and says what each kill feed row
 * is: whose side killed whose, and whether it is the player's own kill or the
 * player's own death. Nothing of it reads a name: a row is told by colours.
 *
 * What Valorant draws (measured on the owner's frames: 720p and 480p reads,
 * 1080p clips): each kill is one row hung from the right edge under the score
 * bar, one under the other, about 0.036 of the screen's height apart; the
 * killer's block on the left, the victim's on the right, an ally's block teal
 * and an enemy's red. A row the player is in carries a pale yellow chevron and
 * edge on the player's own portrait: at the row's LEFT end for the player's
 * kill, at its RIGHT end for the player's death. No other row has a yellow
 * edge running the row's height (an agent's portrait can be yellow in
 * patches, which is why the edge must cover most of the row's lines).
 *
 * The highlight follows the player being WATCHED: once the player is dead and
 * spectating a teammate, that teammate's rows carry it. This module cannot
 * know that; the live rating reads the yellow as the player's only while the
 * player is up (live-rating.js).
 *
 * Scale: every length is a share of the frame's HEIGHT and the rows are read
 * at their fixed places (FIRST, PITCH), anchored to the right edge, so 480p,
 * 720p, 1080p and a wider screen read alike. Not seen yet, so not claimed:
 * Valorant's colour blind modes, which change the two colours.
 *
 * Cost: one pass over the six rows' middle lines (about 0.08 H tall by 0.62 H
 * wide, under 40,000 pixels at 720p). Well under a millisecond in node.
 */

// The rows' centres, as shares of the frame's height: the first at 0.104,
// then every 0.0362 (measured at 480p, 720p and 1080p).
const FIRST = 0.104;
const PITCH = 0.0362;
const SLOTS = 6;
const HALF = 0.0062;            // the middle lines read of each row, either side of its centre

/** Where the kill feed lives, as a rectangle in the frame's pixels (even numbers). */
function regionOf(frameW, frameH) {
  const W = Math.round(Number(frameW));
  const H = Math.round(Number(frameH));
  if (!(W > 0 && H > 0)) return null;
  const even = (v) => Math.max(2, Math.round(v / 2) * 2);
  const width = Math.min(W - (W % 2), even(H * 0.62));
  const y = even(H * (FIRST - 0.02));
  const height = even(H * (PITCH * (SLOTS - 1) + 0.04));
  return { x: W - width, y, width, height };
}

const NONE = 0;
const TEAL = 1;
const RED = 2;
const YELLOW = 3;

/** A pixel's class: the rows' fills lean far enough to tell over a translucent ground. */
function classOf(r, g, b) {
  if (r > 160 && g > 165 && b < 175 && g - b > 50 && r - b > 45 && Math.abs(r - g) < 40) return YELLOW;
  if (g - r > 38 && b - r > 18 && g > 110) return TEAL;
  if (r - g > 65 && r - b > 55 && r > 150) return RED;
  return NONE;
}

/**
 * @param img { width, height, data, channels?: 3 | 4, order?: 'rgb' | 'bgr' }
 *        the region's pixels as regionOf cut them, rows top to bottom
 *        (nativeImage's toBitmap is BGRA: channels 4, order 'bgr')
 * @param frameH the full frame's height (the scale)
 * @returns { rows, list: [{ slot, killer, victim, mine, sig }], kills, deaths }
 *   killer, victim  'ally' | 'enemy'
 *   mine            'kill' | 'death' | null: the yellow's end of the row
 *   sig             { v, r, g, b }: the victim block's length (a share of H)
 *                   and the victim portrait's mean colour, to know the row
 *                   again in the next frame wherever it has moved up to
 */
function detect(img, frameH) {
  const out = { rows: 0, list: [], kills: [], deaths: [] };
  if (!img || !img.data || !(img.width > 0) || !(img.height > 0)) return out;
  const W = img.width | 0;
  const Hr = img.height | 0;
  const ch = img.channels === 4 ? 4 : 3;
  const bgr = img.order === 'bgr';
  const H = Number(frameH) > 0 ? Number(frameH) : Hr / (PITCH * (SLOTS - 1) + 0.04);
  if (img.data.length < W * Hr * ch) return out;
  const top = Math.max(2, Math.round((H * (FIRST - 0.02)) / 2) * 2);
  const d = img.data;
  const px = (x, y) => {
    const i = (y * W + x) * ch;
    return bgr ? classOf(d[i + 2], d[i + 1], d[i]) : classOf(d[i], d[i + 1], d[i + 2]);
  };
  const minRun = Math.max(3, Math.round(H * 0.03));     // a block: a short name at least
  const bridge = Math.max(2, Math.round(H * 0.012));    // the gun's white icon, a letter's gap
  const edgeIn = Math.round(H * 0.13);                  // a row ends a portrait from the right edge
  const reach = Math.round(H * 0.14);                   // the chevron and the portrait beside a block
  const gapIn = Math.round(H * 0.05);                   // a gap inside one side of a row
  const halfH = Math.max(2, Math.round(H * HALF));

  for (let s = 0; s < SLOTS; s++) {
    const c = Math.round(H * (FIRST + PITCH * s)) - top;
    const a = Math.max(0, c - halfH);
    const b = Math.min(Hr - 1, c + halfH);
    if (b <= a) continue;
    const lines = b - a + 1;
    const cls = new Uint8Array(W * lines);
    const col = new Uint8Array(W);
    for (let x = 0; x < W; x++) {
      let t = 0; let r = 0;
      for (let y = a; y <= b; y++) {
        const k = px(x, y);
        cls[(y - a) * W + x] = k;
        if (k === TEAL) t++; else if (k === RED) r++;
      }
      col[x] = t >= lines * 0.5 && t >= r ? TEAL : r >= lines * 0.5 ? RED : NONE;
    }
    const blocks = [];
    let cur = null;
    for (let x = 0; x < W; x++) {
      const k = col[x];
      if (k === NONE) continue;
      if (cur && cur.c === k && x - cur.x1 <= bridge) { cur.x1 = x; continue; }
      if (cur) blocks.push(cur);
      cur = { c: k, x0: x, x1: x };
    }
    if (cur) blocks.push(cur);
    const big = blocks.filter((x) => x.x1 - x.x0 + 1 >= minRun);
    if (big.length < 2) continue;
    const vb = big[big.length - 1];
    if (vb.x1 < W - edgeIn) continue;             // a row hangs from the right edge
    // The killer's block: the nearest block of the other colour before the
    // victim's (a wall of one colour may run into either).
    let k = -1;
    for (let i = big.length - 2; i >= 0 && k < 0; i--) if (big[i].c !== vb.c) k = i;
    if (k < 0) continue;                           // one colour: a team kill, or a wall
    // The killer's side runs left through its own colour (a name, the gun),
    // gaps of a letter or an icon between.
    let k0 = k;
    while (k0 > 0 && big[k0 - 1].c === big[k].c && big[k0].x0 - big[k0 - 1].x1 <= gapIn) k0--;
    const kb = { c: big[k].c, x0: big[k0].x0, x1: big[k].x1 };
    out.rows++;
    const row = {
      slot: s,
      killer: kb.c === TEAL ? 'ally' : 'enemy',
      victim: vb.c === TEAL ? 'ally' : 'enemy',
      mine: null,
      sig: sigOf(img, vb, a, b, H),
    };
    // The yellow edge, on most lines within a reach of the block's outer end
    // (lines covered by any yellow pixel there, since the chevron slants).
    const covered = (lo, hi) => {
      let n = 0;
      for (let y = 0; y < lines; y++) {
        for (let x = Math.max(0, lo); x <= Math.min(W - 1, hi); x++) if (cls[y * W + x] === YELLOW) { n++; break; }
      }
      return n / lines;
    };
    const inset = Math.round(H * 0.012);
    // A yellow wall in the corner (sand in the sun) would be yellow beside
    // every block: with the corner's own far left yellow on these lines, the
    // edge says nothing, so no row is called the player's.
    const wall = covered(0, Math.round(H * 0.04)) >= 0.3;
    // The killer's colour running to the region's edge (a teal wall): the
    // chevron is somewhere inside that run, before the gun.
    const s0 = kb.x0 <= minRun ? 0 : kb.x0 - reach;
    const s1 = kb.x0 <= minRun ? Math.max(0, kb.x1 - minRun) : kb.x0 + inset;
    if (wall) row.mine = null;
    else if (row.killer === 'ally' && covered(s0, s1) >= 0.6) row.mine = 'kill';
    else if (row.victim === 'ally' && covered(vb.x1 - inset, W - 1) >= 0.6) row.mine = 'death';
    out.list.push(row);
    if (row.mine === 'kill') out.kills.push({ slot: s, sig: row.sig });
    if (row.mine === 'death') out.deaths.push({ slot: s });
  }
  return out;
}

/** The victim's block length (share of H) and the portrait right of it, its mean colour. */
function sigOf(img, block, a, b, H) {
  const W = img.width | 0;
  const ch = img.channels === 4 ? 4 : 3;
  const bgr = img.order === 'bgr';
  const v = Math.round(((block.x1 - block.x0 + 1) / H) * 1000) / 1000;
  const p0 = Math.min(W - 1, block.x1 + 1);
  const p1 = Math.min(W, p0 + Math.max(2, Math.round(H * 0.025)));
  let r = 0; let g = 0; let bl = 0; let n = 0;
  for (let y = a; y <= b; y++) {
    for (let x = p0; x < p1; x++) {
      const i = (y * W + x) * ch;
      r += bgr ? img.data[i + 2] : img.data[i]; g += img.data[i + 1]; bl += bgr ? img.data[i] : img.data[i + 2]; n++;
    }
  }
  return n ? { v, r: Math.round(r / n), g: Math.round(g / n), b: Math.round(bl / n) } : { v, r: 0, g: 0, b: 0 };
}

module.exports = { regionOf, detect, classOf, FIRST, PITCH, SLOTS, CLASSES: { NONE, TEAL, RED, YELLOW } };
