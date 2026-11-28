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
(function () {

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
  // Teal leans green over blue (the owner's rows: 98/170/143, 109/186/146);
  // a sky blue ground (140/180/220) leans blue and is no row (round 4).
  if (g - r > 38 && b - r > 18 && g > 110 && g - b > -15) return TEAL;
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
  // A name's white letter (or its pale edge) on a block.
  const bright = (x, y) => {
    const i = (y * W + x) * ch;
    return Math.min(d[i], d[i + 1], d[i + 2]) > 165;
  };
  const minRun = Math.max(3, Math.round(H * 0.03));     // a block: a short name at least
  const bridge = Math.max(2, Math.round(H * 0.012));    // the gun's white icon, a letter's gap
  const edgeIn = Math.round(H * 0.13);                  // a row ends a portrait from the right edge
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
    // A victim's block is a name: measured 0.03 to 0.11 of the height. A block
    // far longer is a wall or an ability's colour in the corner, no row.
    if (vb.x1 - vb.x0 + 1 > H * 0.14) continue;
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
    /*
     * THE PLAYER'S HIGHLIGHT, read from the portrait's own frame alone
     * (round 3, after an adversarial review). Measured on the owner's rows:
     * the frame's upright left edge and the chevron make a run of 5 to 14
     * neighbouring columns yellow on most of the row's lines (0.0045 to 0.013
     * of the height), 0.07 to 0.12 of the height left of a killer's block for
     * a kill, in the right margin past the victim's block for a death. So:
     *   - a run, not a pixel: at least 0.0035 of the height wide (a one or two
     *     pixel outline, Valorant's yellow enemy highlight on a body, is too
     *     thin), at most 0.02 (a yellow patch or wall is too wide);
     *   - inside the row: the same columns are not yellow on the lines just
     *     above or below the row's plate (between two rows), where a line or
     *     a patch of the scene crossing the feed is, and the chevron is not;
     *   - nothing else yellow beside it: outside the row's extent on its own
     *     lines (the open scene left of the portrait) no column is yellow on
     *     half the lines, or the frame says nothing and no row is the player's.
     * The live feed then wants it on two frames, for a kill and a death alike.
     */
    const runMin = Math.max(2, Math.round(H * 0.0035));
    const runMax = Math.max(runMin + 2, Math.round(H * 0.02));
    // The row's own top and bottom, from its victim's block (round 4): the
    // lines where most of the block's columns are its colour. Real rows sit up
    // to 7 px off their place at 1080p, and the lines checked for the gaps
    // above and below must be outside this row's plate, not at a fixed place.
    // A wall of the block's own colour behind the feed runs the plate on
    // into it: a plate taller than a row is no plate, the killer's block is
    // asked, then the row's own place.
    const fits = (p) => p.bottom - p.top + 1 <= H * 0.04;
    let plate = plateOf(px, bright, vb, c, H, Hr);
    if (!fits(plate)) plate = plateOf(px, bright, kb, c, H, Hr);
    if (!fits(plate)) plate = { top: c - Math.round(H * 0.0155), bottom: c + Math.round(H * 0.0155) };
    const gapOut = Math.max(2, Math.round(H * 0.0028));
    const gapA = Math.max(0, plate.top - gapOut);
    const gapB = Math.min(Hr - 1, plate.bottom + gapOut);
    // The runs in a strip that are an edge of this row's plate.
    const runsIn = (lo, hi, least) => {
      const out2 = [];
      let run = 0; let start = 0;
      const close = (end) => {
        if (run < (least || runMin) || run > runMax) return;
        // Not crossing into the gaps above and below the row.
        for (let x = start; x <= end; x++) if (px(x, gapA) === YELLOW || px(x, gapB) === YELLOW) return;
        out2.push({ x0: start, x1: end });
      };
      for (let x = Math.max(0, lo); x <= Math.min(W - 1, hi); x++) {
        let n = 0;
        for (let y = 0; y < lines; y++) if (cls[y * W + x] === YELLOW) n++;
        if (n >= lines * 0.6) { if (!run) start = x; run++; } else { if (run) close(x - 1); run = 0; }
      }
      if (run) close(Math.min(W - 1, hi));
      return out2;
    };
    // Yellow on half the lines anywhere in a strip of open scene.
    const stray = (lo, hi) => {
      for (let x = Math.max(0, lo); x <= Math.min(W - 1, hi); x++) {
        let n = 0;
        for (let y = 0; y < lines; y++) if (cls[y * W + x] === YELLOW) n++;
        if (n >= lines * 0.5) return true;
      }
      return false;
    };
    // How far the row's teal is from an edge run: measured on the owner's
    // rows, 0.045 to 0.11 of the height from the chevron's right to the
    // killer's teal (the portrait and its plate between), 0.043 to 0.053 from
    // the victim's teal to the death's edge. A run at any other distance is no
    // part of this row's highlight.
    // Measured both to the row's next teal column and to its next teal block
    // (a name wide): a portrait's teal pixels come and go from frame to frame,
    // so either in its band will do.
    const tealRight = (x) => { const t = big.find((q) => q.c === TEAL && q.x0 > x); let p = Infinity; for (let i = x + 1; i < W; i++) if (col[i] === TEAL) { p = i - x; break; } return [t ? t.x0 - x : Infinity, p]; };
    const tealLeft = (x) => { const t = big.filter((q) => q.c === TEAL && q.x1 < x).pop(); let p = Infinity; for (let i = x - 1; i >= 0; i--) if (col[i] === TEAL) { p = x - i; break; } return [t ? x - t.x1 : Infinity, p]; };
    const inBand = (ds, lo, hi) => ds.some((d) => d >= H * lo && d <= H * hi);
    const clear = Math.round(H * 0.02);
    /*
     * THE HIGHLIGHT'S OWN SHAPE (round 4, measured on the owner's 1080p and
     * 720p rows): a yellow box's edge or a solid yellow blob beside a
     * teammate's row (Valorant's yellow enemy highlight on a distant enemy,
     * standing still, so two frames do not help) is as tall at its outer
     * column as anywhere, and the player's highlight is not: the chevron's
     * tip holds at most about half the yellow of its tallest column (p90 0.41
     * at 1080p, 0.52 at 720p on kills). Where the tip is blurred full, the
     * portrait's own frame says it: its top and bottom edges yellowish across
     * the portrait (a thin line blended into the plate, 127/187/124 at 1080p,
     * seen on 35 to 65 percent of the highlighted frames, so never required
     * alone). One of the two, or the row is not the player's.
     */
    const ext = (x) => { let n = 0; for (let y = plate.top - 3; y <= plate.bottom + 3; y++) if (y >= 0 && y < Hr && px(x, y) === YELLOW) n++; return n; };
    const mid = Math.round((plate.top + plate.bottom) / 2);
    const midYellow = (x) => px(x, mid) === YELLOW || px(x, mid - 1) === YELLOW || px(x, mid + 1) === YELLOW;
    // The tip: at the run's outer column or just past it (on a death the run
    // is the frame's full edge and the chevron's tail comes after it, 32 then
    // 10, 8, 6, 4, 2 lines at 1080p), a column yellow on part of the lines
    // only and across the plate's middle, as a chevron's point is. A box's
    // inside is yellow at its top and bottom, never across the middle.
    const narrows = (run, dir) => {
      let most = 0;
      for (let x = run.x0; x <= run.x1; x++) most = Math.max(most, ext(x));
      if (!most) return false;
      const from = dir < 0 ? run.x0 : run.x1;
      const reach = Math.max(3, Math.round(H * 0.012));
      for (let s = 0; s <= reach; s++) {
        const x = from + dir * s;
        if (x < 0 || x >= W) break;
        const e = ext(x);
        if (s > 0 && e === 0) break;
        if (e > 0 && e <= most * TIP_SHARE && midYellow(x)) {
          // The point is the outermost yellow: past it the yellow only
          // falls away to nothing (a narrow box's inside, between its two
          // full height edges, is partial too, and a full edge comes after).
          for (let u = 1; u <= reach * 2; u++) {
            const xx = x + dir * u;
            if (xx < 0 || xx >= W) return true;
            const ee = ext(xx);
            if (ee === 0) return true;
            if (ee > most * TIP_SHARE) return false;
          }
          return false;
        }
      }
      return false;
    };
    const framed = (x0, x1) => portraitFramed(img, x0, x1, plate, Hr);
    if (row.killer === 'ally') {
      // The chevron: the rightmost edge run left of the killer's block that
      // has the killer's own teal within a portrait to its right, and no other
      // yellow left of it on these lines.
      const runs = runsIn(0, kb.x1 - minRun).filter((r) => inBand(tealRight(r.x1), 0.045, 0.125));
      const k = runs[runs.length - 1];
      if (k && !stray(0, k.x0 - clear)
        && (narrows(k, -1) || framed(Math.max(k.x1 + 1, kb.x0 - Math.round(H * 0.035)), kb.x0 - 2))) row.mine = 'kill';
    }
    if (!row.mine && row.victim === 'ally') {
      // The death: an edge run right of the victim's teal block, within a
      // portrait of it, and no yellow in the open scene left of the row.
      const runs = runsIn(vb.x1 + 1, W - 1, Math.max(2, Math.round(H * 0.0018))).filter((r) => inBand(tealLeft(r.x0), 0.025, 0.07));
      const left = big[0].x0;
      const ok = runs.some((r) => narrows(r, 1) || framed(vb.x1 + 2, Math.min(r.x0 - 1, vb.x1 + Math.round(H * 0.035))));
      if (ok && !stray(0, left - clear)) row.mine = 'death';
    }
    row.span = [kb.x0, vb.x1];
    out.list.push(row);
    if (row.mine === 'kill') out.kills.push({ slot: s, sig: row.sig });
    if (row.mine === 'death') out.deaths.push({ slot: s });
  }
  return out;
}

const TIP_SHARE = 0.65;          // the chevron's tip holds at most this share of its tallest column's yellow

/**
 * A row's plate, its top and bottom lines, from a block of it: the line
 * nearest the row's place where most of the block's columns are its colour
 * or the name's white letters on it (a name's lines are more letter than
 * colour; at least a fifth colour, so a bright scene is not a plate), grown
 * up and down while they stay so (one line of a letter's edge may dip).
 * Where the block says nothing, the place's own lines.
 */
function plateOf(px, bright, blk, c, H, Hr) {
  const share = (y) => {
    if (y < 0 || y >= Hr) return 0;
    let n = 0; let w = 0; let t = 0;
    for (let x = blk.x0; x <= blk.x1; x++) { t++; if (px(x, y) === blk.c) n++; else if (bright(x, y)) w++; }
    return t && n >= t * 0.2 && n + w >= t * 0.6 ? 1 : 0;
  };
  const fallback = { top: c - Math.round(H * 0.0155), bottom: c + Math.round(H * 0.0155) };
  const reach = Math.round(H * 0.008);
  let seed = null;
  for (let d = 0; d <= reach && seed === null; d++) {
    if (share(c - d) >= 0.5) seed = c - d; else if (share(c + d) >= 0.5) seed = c + d;
  }
  if (seed === null) return fallback;
  const lim = Math.round(H * 0.022);
  let top = seed; let bottom = seed;
  while (top > c - lim && (share(top - 1) >= 0.5 || share(top - 2) >= 0.5 && top - 2 >= c - lim)) top -= share(top - 1) >= 0.5 ? 1 : 2;
  while (bottom < c + lim && (share(bottom + 1) >= 0.5 || share(bottom + 2) >= 0.5 && bottom + 2 <= c + lim)) bottom += share(bottom + 1) >= 0.5 ? 1 : 2;
  return bottom - top + 1 >= H * 0.015 ? { top, bottom } : fallback;
}

/** A portrait's own yellow frame: a line yellowish across it at the plate's top edge and one at its bottom. */
function portraitFramed(img, x0, x1, plate, Hr) {
  const W = img.width | 0;
  const ch = img.channels === 4 ? 4 : 3;
  const bgr = img.order === 'bgr';
  const d = img.data;
  if (!(x1 - x0 >= 3)) return false;
  const line = (y) => {
    if (y < 0 || y >= Hr) return 0;
    let n = 0; let t = 0;
    for (let x = Math.max(0, x0); x <= Math.min(W - 1, x1); x++) {
      const i = (y * W + x) * ch;
      const r = bgr ? d[i + 2] : d[i]; const g = d[i + 1]; const b = bgr ? d[i] : d[i + 2];
      t++;
      // The frame's thin line, blended into the plate and the portrait: green and red over blue.
      if (r - b >= -5 && g - b >= 35 && g > 130) n++;
    }
    return t ? n / t : 0;
  };
  let topOk = false; let botOk = false;
  for (let y = plate.top - 3; y <= plate.top + 2 && !topOk; y++) if (line(y) >= 0.5) topOk = true;
  for (let y = plate.bottom - 2; y <= plate.bottom + 3 && !botOk; y++) if (line(y) >= 0.5) botOk = true;
  return topOk && botOk;
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

const api = { regionOf, detect, classOf, FIRST, PITCH, SLOTS, CLASSES: { NONE, TEAL, RED, YELLOW } };
// Main and the tests require it; the recorder's page loads it as a script
// (recorder/index.html) and reads it off the window, so it runs beside the
// frames it reads and only the rows cross to main.
if (typeof module !== 'undefined' && module.exports) module.exports = api;
else if (typeof self !== 'undefined') self.OcclaraKillfeed = api;

}());
