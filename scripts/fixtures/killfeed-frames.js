'use strict';

/**
 * SYNTHETIC KILL FEED FRAMES (the live rating's detector, src/shared/killfeed.js).
 *
 * Draws a whole frame of a given size with Valorant's kill feed laid out as
 * the owner's frames show it (measured at 480p, 720p and 1080p): rows hung
 * from the right edge at the detector's places, each a killer's block, a gun,
 * a victim's block and the two portraits, an ally's block teal and an enemy's
 * red, and the player's own rows with the yellow chevron and portrait edge at
 * the killer's end (a kill) or the victim's (a death). No frame of a real
 * match is in the repo: every pixel here is drawn.
 *
 *   drawFrame({ W, H, rows, ground, wall, card, order }) -> { width, height, data, channels }
 *     rows   [{ slot, killer: 'ally'|'enemy', victim, mine: 'kill'|'death'|null,
 *              klen, vlen (shares of H), portraitYellow: true for a yellow-ish
 *              agent portrait with no highlight }]
 *     ground [r, g, b] the scene behind the feed; wall: the same, only behind
 *            the feed's corner (a wall of the rows' own colour)
 *     card   true: a player card under the feed, as KILLED BY shows one
 *     order  'rgb' (3 channels) or 'bgra' (4, nativeImage's toBitmap)
 *   cut(frame, rect) -> the region's pixels, as index.js hands them over
 */

const { FIRST, PITCH } = require('../../src/shared/killfeed');

const TEAL = [88, 192, 162];
const RED = [226, 84, 92];
const YELLOW = [232, 238, 122];
const WHITE = [246, 246, 246];
const PORTRAIT = [120, 104, 98];

function drawFrame(o) {
  const W = o.W;
  const H = o.H;
  const bgra = o.order === 'bgra';
  const ch = bgra ? 4 : 3;
  const data = Buffer.alloc(W * H * ch);
  const put = (x, y, c) => {
    if (x < 0 || y < 0 || x >= W || y >= H) return;
    const i = (y * W + x) * ch;
    if (bgra) { data[i] = c[2]; data[i + 1] = c[1]; data[i + 2] = c[0]; data[i + 3] = 255; }
    else { data[i] = c[0]; data[i + 1] = c[1]; data[i + 2] = c[2]; }
  };
  const rect = (x0, y0, w, h, c) => {
    for (let y = Math.round(y0); y < Math.round(y0 + h); y++) for (let x = Math.round(x0); x < Math.round(x0 + w); x++) put(x, y, c);
  };
  // Letters and the gun's outline: thin white strokes with the fill between
  // them, as a name reads in a column of the row.
  const strokes = (x0, y0, w, h) => {
    for (let x = Math.round(x0); x < Math.round(x0 + w); x += 3) rect(x, y0, 1, h, WHITE);
  };
  rect(0, 0, W, H, o.ground || [86, 90, 92]);
  if (o.wall) rect(W - H * 0.7, H * 0.05, H * 0.7, H * 0.3, o.wall);
  if (o.card) {
    // A player card under the feed: bright art of every colour, KILLED BY's.
    const y0 = H * 0.315;
    rect(W - H * 0.62, y0, H * 0.6, H * 0.08, [70, 160, 210]);
    for (let k = 0; k < 12; k++) rect(W - H * 0.6 + k * H * 0.045, y0 + H * 0.01, H * 0.02, H * 0.05, k % 3 === 0 ? YELLOW : k % 3 === 1 ? RED : TEAL);
  }
  for (const r of o.rows || []) {
    const cy = H * (FIRST + PITCH * r.slot);
    const h = H * 0.03;
    const y0 = cy - h / 2;
    const port = H * 0.035;
    const right = W - H * 0.016;
    const vlen = (r.vlen || 0.07) * H;
    const klen = (r.klen || 0.08) * H;
    const gun = H * 0.07;
    const vc = r.victim === 'ally' ? TEAL : RED;
    const kc = r.killer === 'ally' ? TEAL : RED;
    // From the right: the victim's portrait, block, the gun on the killer's
    // colour, the killer's block, the killer's portrait.
    const vPort = right - port;
    rect(vPort, y0, port, h, r.portraitYellow === 'victim' ? YELLOW : PORTRAIT);
    const vBlock = vPort - vlen;
    rect(vBlock, y0, vlen, h, vc);
    strokes(vBlock + vlen * 0.2, cy - h * 0.25, vlen * 0.5, h * 0.5);   // the name
    const gBlock = vBlock - gun;
    rect(gBlock, y0, gun, h, kc);
    strokes(gBlock + gun * 0.15, cy - h * 0.2, gun * 0.6, h * 0.35);      // the gun
    const kBlock = gBlock - klen;
    rect(kBlock, y0, klen, h, kc);
    strokes(kBlock + klen * 0.2, cy - h * 0.25, klen * 0.5, h * 0.5);
    const kPort = kBlock - port;
    rect(kPort, y0, port, h, PORTRAIT);
    if (r.portraitYellow === true) {
      // An agent whose portrait is yellow in patches: no edge, no chevron.
      rect(kPort + port * 0.3, y0 + h * 0.15, port * 0.4, h * 0.25, YELLOW);
    }
    const edge = Math.max(1, Math.round(H * 0.002));
    if (r.mine === 'kill') {
      // The yellow frame on the player's portrait and the chevron before it.
      rect(kPort, y0, port, edge, YELLOW); rect(kPort, y0 + h - edge, port, edge, YELLOW);
      rect(kPort, y0, edge, h, YELLOW); rect(kPort + port - edge, y0, edge, h, YELLOW);
      rect(kPort - H * 0.012, y0, H * 0.006, h, YELLOW);
    } else if (r.mine === 'death') {
      rect(vPort, y0, port, edge, YELLOW); rect(vPort, y0 + h - edge, port, edge, YELLOW);
      rect(vPort, y0, edge, h, YELLOW); rect(vPort + port - edge, y0, edge, h, YELLOW);
      rect(right + H * 0.004, y0, H * 0.006, h, YELLOW);
    }
  }
  return { width: W, height: H, data, channels: ch, order: bgra ? 'bgr' : 'rgb' };
}

/** A rectangle of a drawn frame, as nativeImage's crop and toBitmap hand it over. */
function cut(frame, r) {
  const ch = frame.channels;
  const out = Buffer.alloc(r.width * r.height * ch);
  for (let y = 0; y < r.height; y++) {
    frame.data.copy(out, y * r.width * ch, ((r.y + y) * frame.width + r.x) * ch, ((r.y + y) * frame.width + r.x + r.width) * ch);
  }
  return { width: r.width, height: r.height, data: out, channels: ch, order: frame.order };
}

module.exports = { drawFrame, cut, TEAL, RED, YELLOW };
