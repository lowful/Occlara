'use strict';

/**
 * THE LOOK AT THE AGENT IS SENT THE PLAYER'S BAR, NEVER THE FRAME (8.4.4).
 *
 * The read's frame of a buy phase went to detect-agent whole, and the route
 * (qwen/qwen3.7-flash, its live prompt) called the player's Jett "Neon" on 86
 * of 163 such frames of four real sessions and on 34 of 36 round 1 samples,
 * so the look locked Neon in four sessions of four. Every one of those frames
 * shows the player's own Jett bar, and its four icons are about 30 pixels
 * across in a 1280x720 frame. Eleven more answers came off the rest of the
 * frame: an agent named in chat, the killer's panel, a teammate standing in
 * front.
 *
 * So the look is sent this alone: the bar from the health number at its left
 * to the ammo count at its right, the four ability icons and the keys under
 * them between, scaled up AGENT_BAR_SCALE times, as a JPEG of the read's own
 * quality. The bounds are fractions of the frame, so the performance
 * profile's 854x480 frame gives the same bar. Nothing else of the screen
 * leaves the PC for the look: no chat line, no kill feed, no teammate's card,
 * no top bar of portraits. And a crop that cannot be made is null: the look
 * then sends nothing, never the whole frame (coaching-engine.js
 * lookForAgent).
 *
 * Benched live the same way, the bar read the Jett right on 107 of 157 frames
 * where the whole frame was right on 60 of 163, but still Neon on 47, and the
 * player's Pearl Raze on none of 24 (Killjoy 18), its bar plain on every one
 * read by eye: the reader is what fails, and the look is off until one pinned
 * for the route passes (coaching-engine.js AGENT_LOOKS_PER_MATCH).
 */

// The bar on a 1280x720 frame: x 340 to 940, y 636 to its foot, as fractions.
const AGENT_BAR = Object.freeze({ left: 340 / 1280, right: 940 / 1280, top: 636 / 720, bottom: 1 });
const AGENT_BAR_SCALE = 3;

/** The bar's rectangle on a frame `width` by `height`, in whole pixels, or null. */
function barRect(width, height) {
  if (!(Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0)) return null;
  const x = Math.round(width * AGENT_BAR.left);
  const y = Math.round(height * AGENT_BAR.top);
  const w = Math.round(width * AGENT_BAR.right) - x;
  const h = Math.round(height * AGENT_BAR.bottom) - y;
  return w > 0 && h > 0 ? { x, y, width: w, height: h } : null;
}

/**
 * The read's frame (base64 JPEG) cut to the player's bar and scaled up, as a
 * base64 JPEG at `quality`, or null when that cannot be made. `ni` is
 * Electron's nativeImage, or a stand in for it offline.
 */
function cropAgentBar(shot, quality, ni) {
  try {
    if (typeof shot !== 'string' || !shot) return null;
    const q = Number.isFinite(quality) && quality > 0 && quality <= 100 ? Math.round(quality) : null;
    if (q === null) return null;
    const nativeImage = ni || require('electron').nativeImage;
    const img = nativeImage.createFromBuffer(Buffer.from(shot, 'base64'));
    if (!img || img.isEmpty()) return null;
    const size = img.getSize();
    const rect = barRect(size && size.width, size && size.height);
    if (!rect) return null;
    const bar = img.crop(rect);
    const got = bar && !bar.isEmpty() ? bar.getSize() : null;
    if (!got || got.width !== rect.width || got.height !== rect.height) return null;
    const width = rect.width * AGENT_BAR_SCALE;
    const height = rect.height * AGENT_BAR_SCALE;
    const big = bar.resize({ width, height, quality: 'best' });
    const out = big && !big.isEmpty() ? big.getSize() : null;
    if (!out || out.width !== width || out.height !== height) return null;
    const jpeg = big.toJPEG(q);
    return jpeg && jpeg.length ? jpeg.toString('base64') : null;
  } catch {
    return null;
  }
}

module.exports = { AGENT_BAR, AGENT_BAR_SCALE, barRect, cropAgentBar };
