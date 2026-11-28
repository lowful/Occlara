'use strict';
/*
 * THE SKY (Orbit, 27 Nov 2026): the star field and the moon's lit limb, the
 * logo's crescent at planet scale. Loaded with
 * <script src="../shared/sky.js"></script> and read as window.OcclaraSky.
 *
 * THE MOON TURNS (9.1, the owner's item 9). It is a sphere drawn on the GPU
 * (WebGL) at the device's own resolution, its surface the real Moon's: two
 * pictures made from NASA's own lunar maps (assets/moon, assets/README.txt),
 * the ground's brightness and its relief, turned slowly by the wall clock,
 * so every document that shows it agrees; see "THE TURNING MOON" below. It
 * stands still while a match is recorded, out of sight and under reduced
 * motion, and its pictures are never taken up mid match: a caller asks for
 * it outside one, and an upload under way waits while the shell is sealed.
 * Where WebGL is missing it is the image moon: the same maps lit the same
 * way, a few hundred milliseconds of pixel arithmetic drawn once into an
 * image and kept, in this document and in localStorage, which every page of
 * the app shares (they are all file: pages).
 *
 * WINDOW COORDINATES. The bar is the shell's document and Home is a view of
 * its own under it, so each draws the sky as the whole window would and
 * shifts it by where its document sits (opts.top, TOP_H for a page view):
 * Home's sky and the strip of it the bar shows meet with no seam.
 *
 * No colour here is the brand's: the stars and the moon are the sky's own
 * greys and blues, and nothing here is a gradient.
 */
(function () {
  // A small seeded generator, so the sky is the same on every launch and in
  // every document that draws it.
  function rng(seed) {
    let a = seed >>> 0;
    return () => {
      a |= 0; a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

  /*
   * THE STARS: one canvas, a fixed field of points over the window, denser
   * near the top. canvas is sized to its own box; opts.top shifts the field
   * up by that many pixels, so a page view under the bar continues the bar's
   * field; opts.height is the whole window's height when known.
   */
  function stars(canvas, opts) {
    if (!canvas || typeof canvas.getContext !== 'function' || typeof canvas.getBoundingClientRect !== 'function') return;
    const o = opts || {};
    const r = canvas.getBoundingClientRect();
    const dpr = Math.min(3, window.devicePixelRatio || 1);
    const w = Math.max(1, Math.round(r.width)), h = Math.max(1, Math.round(r.height));
    canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const top = Number(o.top) || 0;
    const fullH = Math.max(h + top, Number(o.height) || 0);
    const rnd = rng(3);
    const n = Math.round((w * fullH) / 2500);
    for (let i = 0; i < n; i++) {
      const x = Math.round(rnd() * w);
      const y = Math.round(Math.pow(rnd(), 1.2) * fullH) - top;
      const a = 0.08 + Math.pow(rnd(), 2.2) * 0.34;
      const s = rnd() < 0.07 ? 2 : 1;
      if (y < -2 || y > h + 2) continue;
      ctx.fillStyle = `rgba(232, 236, 255, ${a.toFixed(3)})`;
      ctx.fillRect(x, y, s, s);
    }
  }

  /** A few stars that twinkle (CSS, .sky-twinkle), put into host once. */
  function twinkles(host, count) {
    if (!host || host.childElementCount) return;
    const rnd = rng(19);
    for (let i = 0; i < (count || 10); i++) {
      const t = document.createElement('i');
      t.className = 'sky-twinkle';
      t.style.left = `${(4 + rnd() * 92).toFixed(2)}%`;
      t.style.top = `${(3 + rnd() * 46).toFixed(2)}%`;
      t.style.setProperty('--d', `${(6 + rnd() * 3).toFixed(2)}s`);
      t.style.setProperty('--dl', `-${(rnd() * 6).toFixed(2)}s`);
      host.append(t);
    }
  }

  /*
   * ── THE MOON'S SURFACE (9.1: the owner asked for the moon in higher
   * quality, and the taste is real things over drawn portrayals) ───────────
   *
   * Until 9.1 the surface was made up here, noise for the seas and craters
   * scattered evenly, and it read as a drawing. It is the real Moon now: two
   * pictures written once by scripts/make-moon-maps.js from NASA's public
   * domain lunar maps (the sources and their terms: assets/README.txt),
   * bundled in assets/moon and loaded from this script's own folder, so
   * every page that links it finds the same files (the CSP takes local
   * images alone):
   *
   *   albedo.webp  4096 x 1024, how bright the ground is: the CGI Moon Kit's
   *                colour map (LRO's Wide Angle Camera, normalised, so it
   *                carries no shadows of its own), as its luminance.
   *   relief.webp  2048 x 1024, the ground's slope east (the top half) and
   *                north (the bottom half), 128 level, from LOLA's elevation
   *                model (LRO's laser altimeter): the light falls across the
   *                real craters, so their shadows move as the moon turns.
   *
   * Both are the band of latitude the turn ever shows (LAT), longitude -180
   * at the left edge and east to the right, north at the top. They are
   * loaded once a document, decoded off the main thread, and only when a
   * moon asks for them, never mid match.
   */
  const HERE = (typeof document !== 'undefined' && document.currentScript && document.currentScript.src) || '';
  const MAPS = { albedo: 'moon/albedo.webp', relief: 'moon/relief.webp' };
  const ALB_W = 4096;                  // albedo.webp's width: a GPU that cannot hold it draws the image moon
  const LAT = 64 * Math.PI / 180;      // the band's half height: the moon's turn never shows more
  const SLOPE = 0.45;                  // the slope relief.webp's 0 and 255 stand for (make-moon-maps.js)
  const RELIEF = 2.2;                  // the relief drawn up, so a crater reads at planet scale
  // How the map's brightness becomes the light the ground gives back:
  // MID is the map's middle (its median, in linear light), drawn at TONE[0];
  // TONE[1] how far the seas and the rays stand from it (below 1, nearer
  // than the map, which NASA stretched for the eye); TONE[2] the earthshine
  // the night side keeps, so its seas show faintly; TONE[3] the grain finer
  // than the map that rides on the surface (the GPU's alone).
  const MID = 0.3;
  const A_MID = Math.pow(MID, 1 / 2.2);
  const TONE = [0.6, 0.7, 0.006, 0.035];

  const mapUrl = (rel) => { try { return new URL(`../../../assets/${rel}`, HERE || document.baseURI).href; } catch (e) { return null; } };
  let surface = null;                  // { albedo, relief } decoded, false where they cannot load
  let loading = null;
  /** The two pictures, decoded: a promise of them, or of null where they cannot be had. */
  function loadSurface() {
    if (loading) return loading;
    const one = (rel) => new Promise((resolve) => {
      const src = mapUrl(rel);
      if (!src || typeof Image === 'undefined') { resolve(null); return; }
      const img = new Image();
      img.decoding = 'async';
      const done = () => resolve(img.naturalWidth > 0 ? img : null);
      img.onload = () => { if (typeof img.decode === 'function') img.decode().then(done, done); else done(); };
      img.onerror = () => resolve(null);
      img.src = src;
    });
    loading = Promise.all([one(MAPS.albedo), one(MAPS.relief)]).then(([albedo, relief]) => {
      surface = albedo && relief ? { albedo, relief } : false;
      if (!surface) console.warn('[sky] the moon\'s maps did not load');
      return surface || null;
    });
    return loading;
  }

  // THE TURN AND THE LIGHT, the same for the GPU and the image moon.
  const TURN_S = 1440;                 // one whole turn in 24 minutes
  // The moon's axis, in the screen's own frame (x right, y down, z toward the
  // viewer): across the lit limb, so the surface comes up over the limb as it
  // turns, both poles out of sight.
  const AXIS = norm([0.909, 0.418, 0.25]);
  // The light, from the lower left and behind, so the lit limb is the logo's crescent.
  const LIGHT = norm([-0.55, 0.55, -0.62]);
  // The middle of the lit limb the windows show, for which way the turn runs.
  const LIMB = norm([-0.42, 0.91, 0]);

  function norm(v) { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; }
  function dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
  function cross(a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }

  // The moon's own frame: Y its axis (north), X the point that faces the
  // viewer (so the maps' seam is round the back), Z to complete it, which
  // puts east to the right of a moon seen with north up, as the sky has it.
  const BY = AXIS;
  const BX = norm([0 - dot([0, 0, 1], BY) * BY[0], 0 - dot([0, 0, 1], BY) * BY[1], 1 - dot([0, 0, 1], BY) * BY[2]]);
  const BZ = cross(BX, BY);
  // Column major, so M * v is (BX.v, BY.v, BZ.v).
  const M = new Float32Array([BX[0], BY[0], BZ[0], BX[1], BY[1], BZ[1], BX[2], BY[2], BZ[2]]);
  const LIGHT_B = [dot(BX, LIGHT), dot(BY, LIGHT), dot(BZ, LIGHT)];
  // The limb sits at the frame's +Z or -Z: the turn runs so its surface rises.
  const DIR = dot(BZ, LIMB) > 0 ? -1 : 1;
  const SIDE = norm([LIGHT[0], LIGHT[1], 0]);

  /**
   * The light one point of the ground gives back, linear, before the
   * encoding: a its brightness in the map (0 to 1, sRGB), lam the light on
   * its slope, lam0 on the sphere there, nz how square it faces the viewer.
   * The GPU's DRAW below is the same arithmetic.
   */
  function lit(a, lam, lam0, nz, out) {
    const alb = TONE[0] * Math.pow(Math.max(1e-4, Math.pow(a, 2.2)) / MID, TONE[1]);
    const light = Math.pow(smooth(-0.06, 0.78, lam), 1.25);
    const rim = Math.pow(1 - nz, 2.4) * smooth(0.05, 0.7, lam0) * 0.34;
    const L = alb * (light + TONE[2]);
    out[0] = L * 0.84 + rim * 0.42 + 0.0038;
    out[1] = L * 0.88 + rim * 0.52 + 0.0035;
    out[2] = L * 0.98 + rim + 0.0095;
    return out;
  }

  /*
   * THE IMAGE MOON, the fallback: the same maps on the same sphere at the
   * turn's start, lit the same way, drawn once on the CPU into MOON_PX
   * pixels and kept (KEY). Used where WebGL is missing or is the software
   * renderer, and while a match is recorded before the turning moon is up.
   */
  const MOON_PX = 1000;
  const KEY = 'occlara.sky.moon.v2';
  // The drawn moon 9.0 kept goes: it is not this moon, and it took the room.
  try { if (window.localStorage) window.localStorage.removeItem('occlara.sky.moon.v1'); } catch (e) { /* no storage here */ }

  /** A picture's grey levels at w by h, through a 2D canvas, or null. */
  function levels(img, w, h) {
    const cv = document.createElement('canvas');
    cv.width = w; cv.height = h;
    const ctx = typeof cv.getContext === 'function' ? cv.getContext('2d', { willReadFrequently: true }) : null;
    if (!ctx) return null;
    try {
      ctx.drawImage(img, 0, 0, w, h);
      const d = ctx.getImageData(0, 0, w, h).data;
      const out = new Uint8Array(w * h);
      for (let i = 0; i < out.length; i++) out[i] = d[i * 4];
      return out;
    } catch (e) { return null; }
  }

  /** The moon drawn into cv from the maps; false where it could not be. */
  function drawMoon(cv, s) {
    // Half the maps' size is more than a 1000 pixel moon shows.
    const AW = 2048, AH = 512, RW = 1024, RH = 512;
    const alb = levels(s.albedo, AW, AH), rel = levels(s.relief, RW, RH);
    const ctx = cv.getContext('2d');
    if (!alb || !rel || !ctx) return false;
    const S = cv.width, C = S / 2, R = S * 0.46;
    const img = ctx.createImageData(S, S), px = img.data;
    // Bilinear, wrapping round in longitude.
    const at = (src, W, H, u, v, y0, rows) => {
      const x = u * W - 0.5, y = Math.min(rows - 1, Math.max(0, v * rows - 0.5));
      const xi = Math.floor(x), yi = Math.floor(y), fx = x - xi, fy = y - yi;
      const xa = ((xi % W) + W) % W, xb = (xa + 1) % W, ya = y0 + yi, yb = y0 + Math.min(rows - 1, yi + 1);
      const a = src[ya * W + xa], b = src[ya * W + xb], c = src[yb * W + xa], d = src[yb * W + xb];
      return (a + (b - a) * fx) * (1 - fy) + (c + (d - c) * fx) * fy;
    };
    const enc = (v) => Math.round(255 * Math.pow(Math.min(1, Math.max(0, v)), 1 / 2.2));
    const rgb = [0, 0, 0];
    const turn = 0;
    for (let y = 0; y < S; y++) {
      const ny = (y + 0.5 - C) / R;
      for (let x = 0; x < S; x++) {
        const nx = (x + 0.5 - C) / R;
        const d2 = nx * nx + ny * ny, i = (y * S + x) * 4;
        if (d2 >= 1) {
          // The thin atmosphere of light round the lit side.
          const d = Math.sqrt(d2);
          if (d > 1.14) continue;
          const side = Math.max(0, (nx * SIDE[0] + ny * SIDE[1]) / d);
          const g = Math.exp(-(d - 1) * 30) * (0.03 + 0.62 * side * side * side);
          if (g < 0.004) continue;
          px[i] = 150; px[i + 1] = 168; px[i + 2] = 255; px[i + 3] = Math.round(Math.min(1, g) * 255);
          continue;
        }
        const nz = Math.sqrt(1 - d2);
        const qx = BX[0] * nx + BX[1] * ny + BX[2] * nz, qy = BY[0] * nx + BY[1] * ny + BY[2] * nz, qz = BZ[0] * nx + BZ[1] * ny + BZ[2] * nz;
        const lat = Math.asin(Math.min(1, Math.max(-1, qy))), lon0 = Math.atan2(qz, qx);
        const u = (lon0 - turn) / (2 * Math.PI) + 0.5, v = Math.min(1, Math.max(0, 0.5 - lat / (2 * LAT)));
        // Past the band (near a pole, on the night side) the ground fades to its middle, never a smear of the band's last row.
        const band = 1 - smooth(LAT - 0.08, LAT, Math.abs(lat));
        const a = A_MID + (at(alb, AW, AH, u, v, 0, AH) / 255 - A_MID) * band;
        const se = band * (at(rel, RW, RH, u, v, 0, RH / 2) - 128) / 127, sn = band * (at(rel, RW, RH, u, v, RH / 2, RH / 2) - 128) / 127;
        const sl = Math.sin(lat), cl = Math.cos(lat), so = Math.sin(lon0), co = Math.cos(lon0);
        const k = SLOPE * RELIEF;
        let bx = qx - k * (se * -so + sn * -sl * co), by = qy - k * (sn * cl), bz = qz - k * (se * co + sn * -sl * so);
        const bl = Math.hypot(bx, by, bz) || 1; bx /= bl; by /= bl; bz /= bl;
        lit(a, bx * LIGHT_B[0] + by * LIGHT_B[1] + bz * LIGHT_B[2], qx * LIGHT_B[0] + qy * LIGHT_B[1] + qz * LIGHT_B[2], nz, rgb);
        const edge = Math.min(1, (1 - Math.sqrt(d2)) * R + 0.5);
        px[i] = enc(rgb[0]); px[i + 1] = enc(rgb[1]); px[i + 2] = enc(rgb[2]); px[i + 3] = Math.round(edge * 255);
      }
    }
    ctx.putImageData(img, 0, 0);
    return true;
  }

  let moonUrl = null;
  /** The image moon this document or the app keeps, as a URL, or null: never draws. */
  function moonImage() {
    if (moonUrl) return moonUrl;
    try {
      const kept = window.localStorage && window.localStorage.getItem(KEY);
      if (kept && kept.startsWith('data:image/')) { moonUrl = kept; return moonUrl; }
    } catch (e) { /* no storage here */ }
    return null;
  }

  /** The image moon drawn now from the maps and kept: a promise of its URL, or of null (never mid match). */
  let drawing = null;
  function drawImageMoon() {
    if (moonImage()) return Promise.resolve(moonUrl);
    if (drawing) return drawing;
    const cv = document.createElement('canvas');
    if (typeof cv.getContext !== 'function' || !cv.getContext('2d')) return Promise.resolve(null);
    drawing = loadSurface().then((s) => {
      drawing = null;
      // The maps may land as a match starts: nothing is drawn mid match.
      if (!s || sealedHere()) return null;
      cv.width = cv.height = MOON_PX;
      if (!drawMoon(cv, s)) return null;
      let url = null;
      try { url = cv.toDataURL('image/webp', 0.9); } catch (e) { url = null; }
      if (!url || !url.startsWith('data:image/webp')) { try { url = cv.toDataURL('image/png'); } catch (e) { url = null; } }
      moonUrl = url;
      try { if (url && window.localStorage) window.localStorage.setItem(KEY, url); } catch (e) { /* full: kept in this document alone */ }
      return url;
    });
    return drawing;
  }

  /** Whether an image of the moon is kept, so putting it up draws nothing. */
  function keptImage() {
    return !!moonImage();
  }

  /**
   * The image moon put up: an <img class="sky-moon-img"> over the whole
   * host, once, fading in (.ready) as it decodes. `draw` false puts up only
   * an image already kept, drawing nothing.
   */
  function imageMoon(host, draw) {
    if (!host || host.querySelector('img.sky-moon-img')) return;
    const put = (url) => {
      // The turning moon may have come up meanwhile: then it stands alone.
      if (!url || host.querySelector('img.sky-moon-img') || host.querySelector('canvas.sky-moon-gl.ready')) return;
      const img = document.createElement('img');
      img.className = 'sky-moon-img';
      img.alt = '';
      img.decoding = 'async';
      img.draggable = false;
      img.addEventListener('load', () => img.classList.add('ready'), { once: true });
      img.src = url;
      host.append(img);
    };
    const kept = moonImage();
    if (kept) { put(kept); return; }
    if (draw === false) return;
    const go = () => { drawImageMoon().then(put); };
    if (typeof window.requestIdleCallback === 'function') window.requestIdleCallback(go, { timeout: 1500 });
    else setTimeout(go, 120);
  }

  /*
   * ── THE TURNING MOON (9.1, the owner's item 9) ────────────────────────────
   *
   * The 9.0 image was 1000 pixels drawn over a box 130% of the window wide,
   * so on a 1280 window at 1x every pixel of it was 1.7 on screen; at 2x,
   * 3.3. The owner asked for it sharp at 1x and 2x, and turning slowly, as a
   * real moon would.
   *
   * SO IT IS A SPHERE ON THE GPU, its two maps (THE MOON'S SURFACE above) in
   * two textures of one grey channel each (R8 where WebGL 2 has it, a byte a
   * texel: about 8 MB with their smaller sizes, where 9.0's one baked RGBA
   * texture took 22), taken up once, a map a frame, never mid match. Each
   * frame only looks them up: for each pixel of the part of the moon this
   * document shows, the point of the sphere under it, turned about the
   * moon's axis by the clock, its ground lit from the lower left and behind
   * on its real slope, so the lit limb stays the logo's crescent and a
   * crater's shadow moves as it turns. A grain finer than the map rides on
   * the surface, so it stays crisp at 2x and 3x.
   *
   * ONLY WHAT IS SEEN IS DRAWN. The canvas covers the part of the moon's box
   * inside this document's window, at the device's own resolution (the bar's
   * strip alone in the shell on Home), never the whole box; a host turned by
   * CSS (the Recording screen's moon, resting low) is drawn whole, at most
   * 2048 pixels, and still.
   *
   * IN STEP EVERYWHERE. The turn is read from the wall clock (one turn every
   * TURN_S seconds), never counted per document, so Home, the bar's strip of
   * it and the review agree to the frame and the strip meets Home's with no
   * seam.
   *
   * STILL WHEN IT SHOULD BE. 30 frames a second at most; no frame while the
   * window or the page is out of sight, while a match is recorded
   * (html.rec-still, Motion.onAmbient), under reduced motion, or while an
   * ancestor holds it at no opacity (the shell's sky off Home): it draws one
   * frame where it stands and waits. The upload (once, a map a frame; the
   * code still calls it the bake) waits while the shell is sealed and while
   * a match is recorded (html.rec-still, between matches too), so nothing of
   * it runs then, as the image moon was never drawn then; until it is done
   * an image already kept is shown, or nothing, and it is taken up where it
   * stopped once the recording ends.
   *
   * LET GO OUT OF SIGHT. A page (Home, the review: an embedded view, never
   * on screen mid match) hidden for FREE_MS lets its textures go, and takes
   * them up again from the decoded maps as it comes back, its last frame
   * standing meanwhile. The shell's moon is kept: it stands behind the
   * Recording screen mid match, when nothing may be taken up.
   *
   * WHERE WEBGL IS MISSING (a test's DOM) or is the software renderer, the
   * image moon above stands in.
   */
  const FPS = 30;
  const WHOLE_PX = 2048;               // a turned host, drawn whole, at most this many pixels
  const FREE_MS = 120000;              // a page out of sight this long lets its textures go

  const HEAD = '#ifdef GL_FRAGMENT_PRECISION_HIGH\nprecision highp float;\n#else\nprecision mediump float;\n#endif\n';
  const NOISE = `
float h13(vec3 p) { p = fract(p * 0.1031); p += dot(p, p.zyx + 31.32); return fract((p.x + p.y) * p.z); }
float vn(vec3 p) {
  vec3 i = floor(p); vec3 f = fract(p); vec3 u = f * f * (3.0 - 2.0 * f);
  float a = h13(i), b = h13(i + vec3(1.0, 0.0, 0.0)), c = h13(i + vec3(0.0, 1.0, 0.0)), d = h13(i + vec3(1.0, 1.0, 0.0));
  float e = h13(i + vec3(0.0, 0.0, 1.0)), g = h13(i + vec3(1.0, 0.0, 1.0)), k = h13(i + vec3(0.0, 1.0, 1.0)), l = h13(i + vec3(1.0, 1.0, 1.0));
  return mix(mix(mix(a, b, u.x), mix(c, d, u.x), u.y), mix(mix(e, g, u.x), mix(k, l, u.x), u.y), u.z);
}
`;
  const VERT = 'attribute vec2 aPos; void main() { gl_Position = vec4(aPos, 0.0, 1.0); }';

  // A FRAME: each pixel's point on the sphere, turned by the clock, its
  // ground looked up in the two maps and lit as lit() above has it, and the
  // thin glow of atmosphere round the lit side outside it. Premultiplied alpha.
  const DRAW = HEAD + NOISE + `
uniform sampler2D uAlb;
uniform sampler2D uRel;
uniform vec2 uOrigin;
uniform float uScale;
uniform float uBufH;
uniform float uHalf;
uniform float uR;
uniform float uPx;
uniform float uTurn;
uniform float uLat;
uniform float uSlope;
uniform float uMid;
uniform vec4 uTone;
uniform vec2 uRelEdge;
uniform mat3 uM;
uniform vec3 uL;
uniform vec2 uSide;
const float PI = 3.14159265;
void main() {
  vec2 css = uOrigin + vec2(gl_FragCoord.x, uBufH - gl_FragCoord.y) * uScale;
  vec2 n2 = (css - vec2(uHalf)) / uR;
  float d2 = dot(n2, n2);
  if (d2 >= 1.0) {
    float d = sqrt(d2);
    if (d > 1.14) { gl_FragColor = vec4(0.0); return; }
    float side = max(0.0, dot(n2 / d, uSide));
    float g = clamp(exp(-(d - 1.0) * 30.0) * (0.03 + 0.62 * side * side * side), 0.0, 1.0);
    gl_FragColor = vec4(vec3(0.588, 0.659, 1.0) * g, g);
    return;
  }
  float d = sqrt(d2);
  float nz = sqrt(1.0 - d2);
  vec3 q0 = uM * vec3(n2, nz);
  float lat = asin(clamp(q0.y, -1.0, 1.0));
  float lon0 = atan(q0.z, q0.x);
  float lonB = lon0 - uTurn;
  // Longitude runs on past the seam (the texture repeats), so the smaller
  // sizes are chosen smoothly there; north is the maps' top row.
  vec2 uv = vec2(lonB / (2.0 * PI) + 0.5, clamp(0.5 - lat / (2.0 * uLat), 0.0, 1.0));
  // Past the band (near a pole, on the night side) the ground fades to its middle.
  float band = 1.0 - smoothstep(uLat - 0.08, uLat, abs(lat));
  float a = mix(pow(uMid, 1.0 / 2.2), texture2D(uAlb, uv).r, band);
  float vr = clamp(uv.y, uRelEdge.x, uRelEdge.y) * 0.5;
  float se = band * (texture2D(uRel, vec2(uv.x, vr)).r * 255.0 - 128.0) / 127.0;
  float sn = band * (texture2D(uRel, vec2(uv.x, vr + 0.5)).r * 255.0 - 128.0) / 127.0;
  vec3 east = vec3(-sin(lon0), 0.0, cos(lon0));
  vec3 north = vec3(-sin(lat) * cos(lon0), cos(lat), -sin(lat) * sin(lon0));
  vec3 nb = normalize(q0 - (se * east + sn * north) * uSlope);
  float lam0 = dot(q0, uL);
  float lam = dot(nb, uL);
  // A grain finer than the map, riding on the surface, faded toward the limb.
  vec3 qb = vec3(cos(lat) * cos(lonB), sin(lat), cos(lat) * sin(lonB));
  float grain = (vn(qb * 1400.0) - 0.5) * 2.0 * uTone.w * smoothstep(0.04, 0.35, nz);
  float alb = uTone.x * pow(max(pow(a, 2.2), 1e-4) / uMid, uTone.y) * (1.0 + grain);
  float light = pow(smoothstep(-0.06, 0.78, lam), 1.25);
  float rim = pow(1.0 - nz, 2.4) * smoothstep(0.05, 0.7, lam0) * 0.34;
  float L = alb * (light + uTone.z);
  vec3 lin = vec3(L * 0.84 + rim * 0.42 + 0.0038, L * 0.88 + rim * 0.52 + 0.0035, L * 0.98 + rim + 0.0095);
  vec3 col = pow(clamp(lin, 0.0, 1.0), vec3(1.0 / 2.2));
  float edge = clamp((1.0 - d) * uR * uPx + 0.5, 0.0, 1.0);
  gl_FragColor = vec4(col * edge, edge);
}
`;

  const still = () => document.documentElement.classList.contains('rec-still');
  // Mid match the shell is sealed (and no page is on screen): nothing is
  // taken up then, as the image moon was never drawn then. Between matches
  // while recording (the Recording view, a page) html.rec-still holds it
  // too (9.1, the owner's item 9: every loop pauses while recording).
  const sealedHere = () => !!document.querySelector('.app.is-sealed');
  // A page of the main window (embed.js): never on screen mid match.
  const embeddedPage = () => document.documentElement.classList.contains('embedded');
  const ambientOn = () => (window.Motion && typeof window.Motion.ambientOn === 'function' ? window.Motion.ambientOn() : document.visibilityState !== 'hidden');
  const pageOut = () => {
    const c = document.documentElement.classList;
    return c.contains('page-armed') || c.contains('page-leaving') || document.visibilityState === 'hidden';
  };
  /** The six numbers of a CSS transform, or null for none. */
  function matrixOf(el) {
    if (typeof window.getComputedStyle !== 'function') return null;
    const t = window.getComputedStyle(el).transform;
    if (!t || t === 'none') return null;
    const flat = t.match(/^matrix\(([^)]+)\)$/);
    const deep = t.match(/^matrix3d\(([^)]+)\)$/);
    if (!flat && !deep) return { turned: true };
    const v = (flat || deep)[1].split(',').map(Number);
    const off = (x, want) => Math.abs(x - want) > 1e-6;
    // A slide alone moves it; anything else (a turn, a scale) is drawn whole.
    if (flat) return { e: v[4], f: v[5], turned: off(v[0], 1) || off(v[1], 0) || off(v[2], 0) || off(v[3], 1) };
    const turned = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 15].some((i) => off(v[i], i === 0 || i === 5 || i === 10 || i === 15 ? 1 : 0));
    return { e: v[12], f: v[13], turned };
  }
  /** An ancestor holding the moon at no opacity or out of the layout (the shell's sky off Home). */
  function hiddenAbove(host) {
    if (typeof window.getComputedStyle !== 'function') return false;
    for (let e = host, i = 0; e && e !== document.documentElement && i < 6; e = e.parentElement, i++) {
      const s = window.getComputedStyle(e);
      if (s.display === 'none' || s.visibility === 'hidden' || Number(s.opacity) === 0) return true;
    }
    return false;
  }
  /*
   * The part of the host's box this document shows, in the host's own CSS
   * pixels: its box against the window, any slide of its ancestors (the
   * review's sky follows the scroll) taken back so the part kept is the one
   * at rest; in the shell's document on Home, only the bar's strip, which is
   * all of it a page leaves uncovered. A host turned by CSS is drawn whole.
   */
  function regionOf(host) {
    const S = host.offsetWidth || 0;
    if (S < 8) return null;
    const own = matrixOf(host);
    if (own && own.turned) return { x: 0, y: 0, w: S, h: S, S, whole: true };
    const r = host.getBoundingClientRect();
    let dx = 0, dy = 0;
    for (let e = host.parentElement; e && e !== document.documentElement; e = e.parentElement) {
      const m = matrixOf(e);
      if (m && !m.turned) { dx += m.e || 0; dy += m.f || 0; }
    }
    const left = r.left - dx, top = r.top - dy;
    let bottom = window.innerHeight || 0;
    const bar = document.querySelector('.app.home-page:not(.is-sealed):not(.rec-view) > .bar');
    if (bar && host.closest('.sky')) bottom = Math.min(bottom, bar.getBoundingClientRect().bottom);
    const x0 = Math.max(0, left), y0 = Math.max(0, top);
    const x1 = Math.min(window.innerWidth || 0, left + S), y1 = Math.min(bottom, top + S);
    if (x1 - x0 < 1 || y1 - y0 < 1) return null;
    const x = Math.max(0, Math.floor(x0 - left)), y = Math.max(0, Math.floor(y0 - top));
    return { x, y, w: Math.min(S - x, Math.ceil(x1 - left) - x), h: Math.min(S - y, Math.ceil(y1 - top) - y), S, whole: false };
  }

  /** One program from its two shaders, or null. */
  function program(gl, fs) {
    const make = (type, src) => {
      const s = gl.createShader(type);
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) { console.warn('[sky] shader:', gl.getShaderInfoLog(s)); return null; }
      return s;
    };
    const v = make(gl.VERTEX_SHADER, VERT), f = make(gl.FRAGMENT_SHADER, fs);
    if (!v || !f) return null;
    const p = gl.createProgram();
    gl.attachShader(p, v); gl.attachShader(p, f);
    gl.bindAttribLocation(p, 0, 'aPos');
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) { console.warn('[sky] program:', gl.getProgramInfoLog(p)); return null; }
    return p;
  }

  /** A software renderer draws this on the CPU at every frame: the image moon instead. */
  function software(gl) {
    let name = '';
    try {
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      name = String(gl.getParameter(ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER) || '');
    } catch (e) { name = ''; }
    return /swiftshader|llvmpipe|softpipe|software|basic render/i.test(name);
  }

  // Where the clock stands for the turn: the wall clock, so every document
  // agrees; a picture can hold it (window.__occlaraMoonTime, seconds).
  const clock = () => (typeof window.__occlaraMoonTime === 'number' ? window.__occlaraMoonTime : Date.now() / 1000);
  const turnAt = (s) => DIR * 2 * Math.PI * ((((s % TURN_S) + TURN_S) % TURN_S) / TURN_S);

  /** The turning moon in host, or null where WebGL cannot draw it (the image moon stands in). */
  function glMoon(host) {
    const canvas = document.createElement('canvas');
    if (typeof canvas.getContext !== 'function') return null;
    const opts = { alpha: true, premultipliedAlpha: true, antialias: false, depth: false, stencil: false, preserveDrawingBuffer: false, powerPreference: 'low-power' };
    // WebGL 2 keeps a grey map in a byte a texel (R8); WebGL 1 as luminance.
    let gl = null, gl2 = false;
    try {
      gl = canvas.getContext('webgl2', opts);
      gl2 = !!gl;
      if (!gl) gl = canvas.getContext('webgl', opts) || canvas.getContext('experimental-webgl', opts);
    } catch (e) { gl = null; }
    if (!gl) return null;
    // A context refused for this moon is let go at once, not left to the collector.
    const refuse = () => { try { const x = gl.getExtension('WEBGL_lose_context'); if (x) x.loseContext(); } catch (e) { /* gone */ } return null; };
    if (software(gl)) return refuse();
    const maxTex = gl.getParameter(gl.MAX_TEXTURE_SIZE) || 0;
    if (maxTex < ALB_W) return refuse();
    const draw = program(gl, DRAW);
    if (!draw) return refuse();
    const aniso = gl.getExtension('EXT_texture_filter_anisotropic') || gl.getExtension('WEBKIT_EXT_texture_filter_anisotropic');

    canvas.className = 'sky-moon-img sky-moon-gl';
    canvas.setAttribute('aria-hidden', 'true');
    canvas.style.position = 'absolute';
    canvas.style.pointerEvents = 'none';
    const st = { gl, draw, alb: null, rel: null, relH: 1024, buf: null, baked: false, reg: null,
      raf: 0, bakeRaf: 0, last: 0, n: 0, park: 0, free: 0, shown: false, lost: false, u: {} };
    // Each uniform's place, asked once.
    const uni = (n) => {
      if (!(n in st.u)) st.u[n] = gl.getUniformLocation(st.draw, n);
      return st.u[n];
    };

    function setup() {
      st.buf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, st.buf);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
      st.alb = st.rel = null;
      st.baked = false;
      return true;
    }
    if (!setup()) return refuse();

    /** One map into a texture of its own, one grey channel, its smaller sizes made for the limb. */
    function upload(img) {
      const t = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
      gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
      if (gl2) gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, gl.RED, gl.UNSIGNED_BYTE, img);
      else gl.texImage2D(gl.TEXTURE_2D, 0, gl.LUMINANCE, gl.LUMINANCE, gl.UNSIGNED_BYTE, img);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
      // The limb is seen edge on: a few samples along it keep it sharp there.
      if (aniso) gl.texParameterf(gl.TEXTURE_2D, aniso.TEXTURE_MAX_ANISOTROPY_EXT, Math.min(4, gl.getParameter(aniso.MAX_TEXTURE_MAX_ANISOTROPY_EXT) || 1));
      gl.generateMipmap(gl.TEXTURE_2D);
      return t;
    }

    /** The upload waits: the shell sealed, or a match recorded (html.rec-still). */
    const held = () => sealedHere() || still();
    /** While it waits with nothing drawn, the image moon stands in (mid match only one already kept). */
    const standIn = () => { if (!st.baked && !st.shown) imageMoon(host, !sealedHere()); };

    /**
     * The maps taken up, one a frame, never while the shell is sealed and
     * never while a match is recorded (html.rec-still), between matches
     * included (the owner's item 9). Held, the image moon stands in
     * (between matches drawn once if none is kept, a still picture as in
     * 9.0; sealed, only one already kept), and the upload is taken up where
     * it stopped once the recording ends (the observer below: wake) or the
     * shell is unsealed (the shell lays it out again: wake). The maps are
     * loaded first, once a document, off the main thread.
     */
    function bakeStep() {
      st.bakeRaf = 0;
      if (st.lost || st.baked) return;
      if (held()) { standIn(); return; }
      if (surface === false) return;
      if (!surface) { loadSurface().then(() => wake()); return; }
      if (!st.alb) { st.alb = upload(surface.albedo); st.bakeRaf = requestAnimationFrame(bakeStep); return; }
      st.rel = upload(surface.relief);
      st.relH = surface.relief.naturalHeight || 1024;
      st.baked = true;
      baked = true;
      layout();
    }

    /** A frame at the clock's turn. */
    function paint() {
      if (!st.baked || !st.reg || st.lost) return;
      const r = st.reg;
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.useProgram(st.draw);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, st.alb);
      gl.uniform1i(uni('uAlb'), 0);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, st.rel);
      gl.uniform1i(uni('uRel'), 1);
      gl.uniform2f(uni('uOrigin'), r.x, r.y);
      gl.uniform1f(uni('uScale'), r.w / canvas.width);
      gl.uniform1f(uni('uBufH'), canvas.height);
      gl.uniform1f(uni('uHalf'), r.S / 2);
      gl.uniform1f(uni('uR'), r.S * 0.46);
      gl.uniform1f(uni('uPx'), canvas.width / r.w);
      gl.uniform1f(uni('uTurn'), turnAt(clock()));
      gl.uniform1f(uni('uLat'), LAT);
      gl.uniform1f(uni('uSlope'), SLOPE * RELIEF);
      gl.uniform1f(uni('uMid'), MID);
      gl.uniform4f(uni('uTone'), TONE[0], TONE[1], TONE[2], TONE[3]);
      // Each half of relief.webp is sampled inside its own rows, never the other's.
      const half = st.relH / 2;
      gl.uniform2f(uni('uRelEdge'), 0.5 / half, 1 - 0.5 / half);
      gl.uniformMatrix3fv(uni('uM'), false, M);
      gl.uniform3f(uni('uL'), LIGHT_B[0], LIGHT_B[1], LIGHT_B[2]);
      gl.uniform2f(uni('uSide'), SIDE[0], SIDE[1]);
      gl.bindBuffer(gl.ARRAY_BUFFER, st.buf);
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
      gl.disable(gl.BLEND);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      if (!st.shown) {
        st.shown = true;
        // The image that stood in goes once the sphere is up.
        for (const img of host.querySelectorAll('img.sky-moon-img')) img.remove();
        requestAnimationFrame(() => canvas.classList.add('ready'));
      }
    }

    /** The textures let go: a page out of sight for FREE_MS. Its last frame stands. */
    function release() {
      st.free = 0;
      if (st.lost || !st.baked || !embeddedPage() || document.visibilityState !== 'hidden') return;
      cancelAnimationFrame(st.raf); st.raf = 0;
      gl.deleteTexture(st.alb); gl.deleteTexture(st.rel);
      st.alb = st.rel = null;
      st.baked = false;
    }
    function freeSoon() {
      // A check can shorten the wait (window.__occlaraMoonFreeMs), as a picture holds the clock.
      const ms = typeof window.__occlaraMoonFreeMs === 'number' ? window.__occlaraMoonFreeMs : FREE_MS;
      if (!st.free && st.baked && embeddedPage()) st.free = setTimeout(release, ms);
    }

    const moving = () => st.baked && !!st.reg && !st.lost && ambientOn() && !pageOut();
    function frame(now) {
      st.raf = 0;
      if (!moving()) return;
      if (now - st.last >= 1000 / FPS - 2) { st.last = now; paint(); }
      // Now and then: an ancestor that took it out of sight parks it.
      if (++st.n % FPS === 0 && hiddenAbove(host)) { park(); return; }
      st.raf = requestAnimationFrame(frame);
    }
    function park() {
      clearTimeout(st.park);
      st.park = setTimeout(() => { st.park = 0; if (!hiddenAbove(host)) wake(); else park(); }, 1000);
    }
    /** Back to work: the maps where they stopped, then the frames. Out of sight, the textures go in time. */
    function wake() {
      if (st.lost) return;
      if (document.visibilityState === 'hidden') freeSoon();
      else if (st.free) { clearTimeout(st.free); st.free = 0; }
      if (!st.baked) {
        if (held()) standIn();
        else if (!st.bakeRaf) st.bakeRaf = requestAnimationFrame(bakeStep);
        return;
      }
      if (st.raf || st.park) return;
      if (moving()) st.raf = requestAnimationFrame(frame);
    }
    function layout() {
      if (st.lost) return;
      const reg = regionOf(host);
      st.reg = reg;
      if (!reg) { canvas.style.display = 'none'; return; }
      canvas.style.display = '';
      const dpr = Math.min(3, window.devicePixelRatio || 1);
      const scale = reg.whole ? Math.min(dpr, WHOLE_PX / reg.S) : dpr;
      const bw = Math.max(1, Math.round(reg.w * scale)), bh = Math.max(1, Math.round(reg.h * scale));
      canvas.style.left = `${reg.x}px`; canvas.style.top = `${reg.y}px`;
      canvas.style.width = `${reg.w}px`; canvas.style.height = `${reg.h}px`;
      // A canvas sized again is cleared: with its textures let go, nothing stands until they are back.
      if ((canvas.width !== bw || canvas.height !== bh) && !st.baked) st.shown = false;
      if (canvas.width !== bw) canvas.width = bw;
      if (canvas.height !== bh) canvas.height = bh;
      paint();
      wake();
    }

    canvas.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      st.lost = true;
      cancelAnimationFrame(st.raf); cancelAnimationFrame(st.bakeRaf); clearTimeout(st.park); clearTimeout(st.free);
      st.raf = st.bakeRaf = st.park = st.free = 0;
    });
    canvas.addEventListener('webglcontextrestored', () => {
      // Everything of the old context is gone, the program and the textures with it.
      st.lost = false;
      st.shown = false;
      st.u = {};
      st.draw = program(gl, DRAW);
      if (st.draw && setup()) wake();
    });

    host.append(canvas);
    // While a match is recorded before it is ready, the image moon stands
    // in: mid match (sealed) only one already kept, between matches drawn
    // once if none is, a still picture and no loop.
    if (held()) standIn();
    // The upload starts once the page is idle, after its own first paint.
    const begin = () => { if (!st.bakeRaf && !st.baked) wake(); };
    if (typeof window.requestIdleCallback === 'function') window.requestIdleCallback(begin, { timeout: 1500 }); else setTimeout(begin, 120);
    // stop() holds the frames, and the upload with them while a match is
    // recorded (an upload a hidden window held is taken up by wake, as before).
    const stop = () => {
      cancelAnimationFrame(st.raf); st.raf = 0;
      if (still()) { cancelAnimationFrame(st.bakeRaf); st.bakeRaf = 0; standIn(); }
    };
    return { layout, wake, stop, ready: () => st.baked };
  }

  // The moons of this document, by host.
  const moons = new Map();
  let baked = false;

  /**
   * The moon put into host: the turning sphere where WebGL draws it, else the
   * image moon. Asked again (a resize, the shell's state changing, a page
   * shown) it lays itself out again for what the window now shows.
   */
  function moon(host) {
    if (!host) return;
    const had = moons.get(host);
    if (had) { if (had.layout) had.layout(); return; }
    const m = glMoon(host);
    if (!m) { moons.set(host, {}); imageMoon(host, true); return; }
    moons.set(host, m);
    m.layout();
  }

  // Each moon follows the window's size, ambient motion (a recording, the
  // window hidden, reduced motion) and its page coming back on screen.
  const all = () => [...moons.values()].filter((m) => m && m.layout);
  let resized = 0;
  window.addEventListener('resize', () => { clearTimeout(resized); resized = setTimeout(() => { for (const m of all()) m.layout(); }, 150); });
  window.addEventListener('occlara-page-enter', () => { for (const m of all()) m.wake(); });
  document.addEventListener('visibilitychange', () => { for (const m of all()) m.wake(); });
  if (window.Motion && typeof window.Motion.onAmbient === 'function') {
    window.Motion.onAmbient((on) => { for (const m of all()) { if (on) m.wake(); else m.stop(); } });
  }
  // html.rec-still heard here as well: an upload a recording held is taken
  // up again as it ends even where ambient motion stays off (reduced motion).
  if (typeof MutationObserver === 'function') {
    let was = still();
    try {
      new MutationObserver(() => {
        const now = still();
        if (now === was) return;
        was = now;
        for (const m of all()) { if (now) m.stop(); else m.wake(); }
      }).observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    } catch (e) { /* none */ }
  }

  /** Whether the moon can go up here without drawing anything heavy: the sphere is ready, or an image is kept. */
  function hasMoon() {
    return baked || keptImage();
  }

  window.OcclaraSky = Object.freeze({ stars, twinkles, moon, moonImage, hasMoon, MOON_PX, TURN_S, MAPS });
})();
