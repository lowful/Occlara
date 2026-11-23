'use strict';

/**
 * The GDI frame, taken by the ffmpeg that already ships with the app
 * (`-f gdigrab`), not by a helper exe of our own (8.16.1).
 *
 * gdigrab is the same primitive the helper used, a BitBlt of the screen, so
 * the frame is the same picture: it never reads game memory, touches game
 * files or hooks anything, and it sees what OBS's display capture sees. What
 * changed is who runs it. OcclaraCapture.exe was 5 KB, unsigned, windowless,
 * and all it did was copy the screen and print it, which is the shape of a
 * screenshot stealer to an antivirus that has never seen the file: Bitdefender
 * quarantined it as Trojan.GenericKD on players' machines. ffmpeg.exe is a
 * build millions of machines already hold, and no file of ours copies the
 * screen any more.
 *
 * Pure: the arguments only. capture-worker.js runs them.
 */

/**
 * GDI+'s 0 to 100 quality as ffmpeg's mjpeg scale (2 best, 31 worst). Matched
 * by size on one frame, and rounded towards the sharper side, since the read
 * is small HUD text: 70 gave 32.7 KB from the helper and -q:v 2 gives 36 KB,
 * 50 gave 14 KB and -q:v 3 gives 15.8 KB.
 */
function qscale(jpegQuality) {
  const q = Number(jpegQuality);
  if (!Number.isFinite(q) || q >= 70) return 2;
  if (q >= 50) return 3;
  return 5;
}

function whole(n) { return Number.isFinite(n) && n > 0 ? Math.round(n) : 0; }

/**
 * geom is the primary display in physical pixels, and where it sits in the
 * whole desktop: { multi, w, h, x, y }. With one display it is not needed,
 * "desktop" is the primary. With more, gdigrab's desktop is every monitor side
 * by side, and the read wants the primary alone, as the helper took it:
 *   mode 'area'  the primary's rectangle asked of gdigrab (its origin is 0,0)
 *   mode 'crop'  the whole desktop, cut down to the primary afterwards, for a
 *                desktop gdigrab refuses the rectangle of
 * The frame is stretched to the profile's size whatever the display's shape,
 * as the helper's `new Bitmap(shot, w, h)` did. No mouse pointer, as before.
 */
function ffmpegArgs(prof, geom, mode) {
  const args = ['-nostdin', '-hide_banner', '-loglevel', 'error',
    '-probesize', '32', '-analyzeduration', '0', '-framerate', '60',
    '-f', 'gdigrab', '-draw_mouse', '0'];
  const g = geom && geom.multi && whole(geom.w) && whole(geom.h) ? geom : null;
  const filters = [];
  if (g && mode !== 'crop') {
    args.push('-offset_x', '0', '-offset_y', '0', '-video_size', `${whole(g.w)}x${whole(g.h)}`);
  } else if (g) {
    filters.push(`crop=${whole(g.w)}:${whole(g.h)}:${Math.max(0, Math.round(g.x) || 0)}:${Math.max(0, Math.round(g.y) || 0)}`);
  }
  filters.push(`scale=${whole(prof.targetW)}:${whole(prof.targetH)}:flags=bilinear`);
  args.push('-i', 'desktop', '-frames:v', '1', '-vf', filters.join(','),
    '-q:v', String(qscale(prof.jpegQuality)), '-pix_fmt', 'yuvj420p',
    '-f', 'image2pipe', '-vcodec', 'mjpeg', '-');
  return args;
}

/** A JPEG starts FF D8 and ends FF D9: anything else is not a frame. */
function isJpeg(buf) {
  return !!buf && buf.length > 4 && buf[0] === 0xFF && buf[1] === 0xD8
    && buf[buf.length - 2] === 0xFF && buf[buf.length - 1] === 0xD9;
}

/**
 * The primary display for ffmpegArgs, from Electron's `screen`: physical
 * pixels, because gdigrab counts in them whatever the scaling. Null when it
 * cannot be told, and then the whole desktop is taken.
 */
function geometry(screen) {
  try {
    const all = screen.getAllDisplays();
    const prim = screen.getPrimaryDisplay();
    const phys = (d) => (typeof screen.dipToScreenRect === 'function'
      ? screen.dipToScreenRect(null, d.bounds)
      : { x: d.bounds.x * d.scaleFactor, y: d.bounds.y * d.scaleFactor, width: d.bounds.width * d.scaleFactor, height: d.bounds.height * d.scaleFactor });
    const p = phys(prim);
    let left = 0; let top = 0;
    for (const d of all) { const r = phys(d); left = Math.min(left, r.x); top = Math.min(top, r.y); }
    return { multi: all.length > 1, w: Math.round(p.width), h: Math.round(p.height), x: Math.round(p.x - left), y: Math.round(p.y - top) };
  } catch { return null; }
}

module.exports = { qscale, ffmpegArgs, isJpeg, geometry };
