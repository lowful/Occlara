'use strict';
/*
 * THE SKY (Orbit, 27 Nov 2026): the star field and the moon's lit limb, the
 * logo's crescent at planet scale. Loaded with
 * <script src="../shared/sky.js"></script> and read as window.OcclaraSky.
 *
 * THE MOON TURNS (9.1, the owner's item 9). It is a sphere drawn on the GPU
 * (WebGL) at the device's own resolution, its surface baked once into a
 * texture and turned slowly by the wall clock, so every document that shows
 * it agrees; see "THE TURNING MOON" below. It stands still while a match is
 * recorded, out of sight and under reduced motion, and it is never baked
 * mid match: a caller asks for it outside one, and a bake under way waits
 * while the shell is sealed. Where WebGL is missing it is the image moon:
 * a few hundred milliseconds of pixel arithmetic (a lit sphere, its maria
 * and its craters) drawn once into an image and kept, in this document and
 * in localStorage, which every page of the app shares (they are all file:
 * pages).
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

  // THE MOON, lit from the lower left so the visible limb is a crescent.
  const MOON_PX = 1000;
  const KEY = 'occlara.sky.moon.v1';
  function drawMoon(cv) {
    const S = cv.width, C = S / 2, R = S * 0.46;
    const ctx = cv.getContext('2d');
    const img = ctx.createImageData(S, S), px = img.data;
    const rnd = rng(11);
    const GN = 128, grid = new Float32Array(GN * GN);
    for (let i = 0; i < grid.length; i++) grid[i] = rnd();
    const vn = (x, y) => {
      const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
      const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
      const x0 = xi & 127, x1 = (xi + 1) & 127, y0 = (yi & 127) * GN, y1 = ((yi + 1) & 127) * GN;
      const a = grid[y0 + x0], b = grid[y0 + x1], c = grid[y1 + x0], d = grid[y1 + x1];
      return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
    };
    const fbm = (x, y, oct) => { let s = 0, amp = 0.5, f = 1, n = 0; for (let k = 0; k < oct; k++) { s += amp * vn(x * f, y * f); n += amp; f *= 2.03; amp *= 0.5; } return s / n; };
    const craters = [];
    for (let i = 0; i < 260; i++) {
      const a = rnd() * Math.PI * 2, d = Math.sqrt(rnd());
      craters.push([Math.cos(a) * d, Math.sin(a) * d, 0.004 + Math.pow(rnd(), 3.4) * 0.05]);
    }
    const B = 28, buckets = Array.from({ length: B * B }, () => []);
    for (const c of craters) {
      const r = c[2] * 1.4;
      const x0 = Math.max(0, Math.floor(((c[0] - r + 1) / 2) * B)), x1 = Math.min(B - 1, Math.floor(((c[0] + r + 1) / 2) * B));
      const y0 = Math.max(0, Math.floor(((c[1] - r + 1) / 2) * B)), y1 = Math.min(B - 1, Math.floor(((c[1] + r + 1) / 2) * B));
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) buckets[y * B + x].push(c);
    }
    let Lx = -0.55, Ly = 0.55, Lz = -0.62;
    const ln = Math.hypot(Lx, Ly, Lz); Lx /= ln; Ly /= ln; Lz /= ln;
    const lxy = Math.hypot(Lx, Ly), Sx = Lx / lxy, Sy = Ly / lxy;
    const enc = (v) => Math.round(255 * Math.pow(Math.min(1, Math.max(0, v)), 1 / 2.2));
    for (let y = 0; y < S; y++) {
      const ny = (y + 0.5 - C) / R;
      for (let x = 0; x < S; x++) {
        const nx = (x + 0.5 - C) / R;
        const d2 = nx * nx + ny * ny, i = (y * S + x) * 4;
        if (d2 >= 1) {
          // The thin atmosphere of light round the lit side.
          const d = Math.sqrt(d2);
          if (d > 1.14) continue;
          const side = Math.max(0, (nx * Sx + ny * Sy) / d);
          const g = Math.exp(-(d - 1) * 30) * (0.03 + 0.62 * side * side * side);
          if (g < 0.004) continue;
          px[i] = 150; px[i + 1] = 168; px[i + 2] = 255; px[i + 3] = Math.round(Math.min(1, g) * 255);
          continue;
        }
        const nz = Math.sqrt(1 - d2);
        const lam = nx * Lx + ny * Ly + nz * Lz;
        const edge = Math.min(1, (1 - Math.sqrt(d2)) * R + 0.5);
        if (lam < -0.22) { px[i] = 10; px[i + 1] = 9; px[i + 2] = 24; px[i + 3] = Math.round(edge * 255); continue; }
        let sh = 0, al = 0;
        const bx = Math.min(B - 1, Math.floor(((nx + 1) / 2) * B)), by = Math.min(B - 1, Math.floor(((ny + 1) / 2) * B));
        const list = buckets[by * B + bx];
        for (let k = 0; k < list.length; k++) {
          const c = list[k], dx = nx - c[0], dy = ny - c[1];
          const dl = Math.sqrt(dx * dx + dy * dy), dd = dl / c[2];
          if (dd > 1.4) continue;
          const uL = (dx * Lx + dy * Ly) / (dl + 1e-6);
          if (dd < 1) { sh -= 0.3 * dd * uL; al -= 0.012 * (1 - dd * 0.5); }
          else { const f = 1 - (dd - 1) / 0.4; sh += 0.16 * f * uL; al += 0.025 * f; }
        }
        const light = Math.pow(smooth(-0.06, 0.78, lam + sh * 0.3 * Math.min(1, Math.max(0.25, lam * 3))), 1.25);
        const mare = smooth(0.46, 0.66, fbm(nx * 2.1 + 7.3, ny * 2.1 + 1.1, 4));
        const fine = fbm(nx * 22 + 3.1, ny * 22 + 9.7, 3);
        const alb = Math.max(0.12, 0.6 - 0.2 * mare + (fine - 0.5) * 0.12 + al);
        const rim = Math.pow(1 - nz, 2.4) * smooth(0.05, 0.7, lam) * 0.34;
        const L = alb * light;
        px[i] = enc(L * 0.84 + rim * 0.42 + 0.0038);
        px[i + 1] = enc(L * 0.88 + rim * 0.52 + 0.0035);
        px[i + 2] = enc(L * 0.98 + rim * 1.0 + 0.0095);
        px[i + 3] = Math.round(edge * 255);
      }
    }
    ctx.putImageData(img, 0, 0);
  }


  let moonUrl = null;
  /** The moon as an image URL: this document's, the one the app keeps, or drawn now and kept. */
  function moonImage() {
    if (moonUrl) return moonUrl;
    try {
      const kept = window.localStorage && window.localStorage.getItem(KEY);
      if (kept && kept.startsWith('data:image/')) { moonUrl = kept; return moonUrl; }
    } catch (e) { /* no storage here: draw it */ }
    const cv = document.createElement('canvas');
    if (typeof cv.getContext !== 'function' || !cv.getContext('2d')) return null;
    cv.width = cv.height = MOON_PX;
    drawMoon(cv);
    let url = null;
    try { url = cv.toDataURL('image/webp', 0.9); } catch (e) { url = null; }
    if (!url || !url.startsWith('data:image/webp')) { try { url = cv.toDataURL('image/png'); } catch (e) { url = null; } }
    moonUrl = url;
    try { if (url && window.localStorage) window.localStorage.setItem(KEY, url); } catch (e) { /* full: kept in this document alone */ }
    return moonUrl;
  }

  /** Whether an image of the moon is kept, so putting it up draws nothing. */
  function keptImage() {
    if (moonUrl) return true;
    try { const kept = window.localStorage && window.localStorage.getItem(KEY); return !!(kept && kept.startsWith('data:image/')); } catch (e) { return false; }
  }

  /**
   * THE IMAGE MOON, the fallback: an <img class="sky-moon-img"> over the whole
   * host, put in once while the page is idle, fading in (.ready) as it
   * decodes. Used where WebGL is missing or is the software renderer, and
   * while a match is recorded before the turning moon is ready. `draw` false
   * puts up only an image already kept, drawing nothing.
   */
  function imageMoon(host, draw) {
    if (!host || host.querySelector('img.sky-moon-img')) return;
    const put = () => {
      if (host.querySelector('img.sky-moon-img')) return;
      if (draw === false && !keptImage()) return;
      const url = moonImage();
      if (!url) return;
      const img = document.createElement('img');
      img.className = 'sky-moon-img';
      img.alt = '';
      img.decoding = 'async';
      img.draggable = false;
      img.addEventListener('load', () => img.classList.add('ready'), { once: true });
      img.src = url;
      host.append(img);
    };
    if (moonUrl) put();
    else if (typeof window.requestIdleCallback === 'function') window.requestIdleCallback(put, { timeout: 1500 });
    else setTimeout(put, 120);
  }

  /*
   * ── THE TURNING MOON (9.1, the owner's item 9) ────────────────────────────
   *
   * The image above was 1000 pixels drawn over a box 130% of the window wide,
   * so on a 1280 window at 1x every pixel of it was 1.7 on screen, and its
   * craters' hard edges stair stepped; at 2x, 3.3. The owner asked for it
   * sharp at 1x and 2x, and turning slowly, as a real moon would.
   *
   * SO IT IS A SPHERE ON THE GPU. Its surface is baked ONCE into a texture
   * (WebGL, one pass in strips over a few frames, while the page is idle):
   * the maria, the fine grain and four sizes of craters scattered over the
   * sphere in three dimensions, each crater a bowl and a raised rim, stored as
   * its albedo and its slope, so the light falls across every crater as the
   * surface turns. Each frame then only looks the texture up: for each pixel
   * of the part of the moon this document shows, the point of the sphere under
   * it, turned about the moon's axis by the clock, lit from the lower left
   * and behind as before, so the lit limb stays the logo's crescent. A pixel
   * of grain finer than the texture rides on the surface too, so it stays
   * crisp at 2x and 3x.
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
   * frame where it stands and waits. The bake (once, a strip a frame) waits
   * while the shell is sealed, so nothing heavy ever runs mid match, as the
   * image moon was never drawn then; until it is done an image already kept
   * is shown, or nothing.
   *
   * WHERE WEBGL IS MISSING (a test's DOM) or is the software renderer, the
   * image moon above stands in, as before.
   */
  const TURN_S = 1440;                 // one whole turn in 24 minutes
  const FPS = 30;
  const TEX_W = 4096, TEX_H = 1024;    // the surface, as a band of latitude
  const LAT = 64 * Math.PI / 180;      // the band's half height: the moon's turn never shows more
  const SMAX = 1.4;                    // the steepest slope the texture keeps
  const STRIPS = 16;                   // the bake, a strip a frame
  const WHOLE_PX = 2048;               // a turned host, drawn whole, at most this many pixels

  // The moon's axis, in the screen's own frame (x right, y down, z toward the
  // viewer): across the lit limb, so the surface comes up over the limb as it
  // turns, both poles out of sight.
  const AXIS = norm([0.909, 0.418, 0.25]);
  // The light, from the lower left and behind, as the image moon was lit.
  const LIGHT = norm([-0.55, 0.55, -0.62]);
  // The middle of the lit limb the windows show, for which way the turn runs.
  const LIMB = norm([-0.42, 0.91, 0]);

  function norm(v) { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; }
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

  // The moon's own frame: Y its axis, X the point that faces the viewer (so
  // the texture's seam is round the back), Z to complete it.
  const BY = AXIS;
  const BX = norm([0 - dot([0, 0, 1], BY) * BY[0], 0 - dot([0, 0, 1], BY) * BY[1], 1 - dot([0, 0, 1], BY) * BY[2]]);
  const BZ = cross(BX, BY);
  // Column major, so M * v is (BX.v, BY.v, BZ.v).
  const M = new Float32Array([BX[0], BY[0], BZ[0], BX[1], BY[1], BZ[1], BX[2], BY[2], BZ[2]]);
  const LIGHT_B = [dot(BX, LIGHT), dot(BY, LIGHT), dot(BZ, LIGHT)];
  // The limb sits at the frame's +Z or -Z: the turn runs so its surface rises.
  const DIR = dot(BZ, LIMB) > 0 ? -1 : 1;
  const SIDE = norm([LIGHT[0], LIGHT[1], 0]);

  const HEAD = '#ifdef GL_FRAGMENT_PRECISION_HIGH\nprecision highp float;\n#else\nprecision mediump float;\n#endif\n';
  const NOISE = `
float h13(vec3 p) { p = fract(p * 0.1031); p += dot(p, p.zyx + 31.32); return fract((p.x + p.y) * p.z); }
vec3 h33(vec3 p) { p = fract(p * vec3(0.1031, 0.1030, 0.0973)); p += dot(p, p.yxz + 33.33); return fract((p.xxy + p.yxx) * p.zyx); }
float vn(vec3 p) {
  vec3 i = floor(p); vec3 f = fract(p); vec3 u = f * f * (3.0 - 2.0 * f);
  float a = h13(i), b = h13(i + vec3(1.0, 0.0, 0.0)), c = h13(i + vec3(0.0, 1.0, 0.0)), d = h13(i + vec3(1.0, 1.0, 0.0));
  float e = h13(i + vec3(0.0, 0.0, 1.0)), g = h13(i + vec3(1.0, 0.0, 1.0)), k = h13(i + vec3(0.0, 1.0, 1.0)), l = h13(i + vec3(1.0, 1.0, 1.0));
  return mix(mix(mix(a, b, u.x), mix(c, d, u.x), u.y), mix(mix(e, g, u.x), mix(k, l, u.x), u.y), u.z);
}
`;
  const VERT = 'attribute vec2 aPos; void main() { gl_Position = vec4(aPos, 0.0, 1.0); }';

  // THE BAKE: one texel of the band a fragment, its point on the sphere, the
  // maria, the grain, and four fields of craters, each a bowl 0.36 of its
  // radius deep and a rim 0.09 high (so every size has the same slopes), its
  // slope added up in three dimensions and kept as its east and north parts.
  const BAKE = HEAD + NOISE + `
uniform vec2 uSize;
uniform float uLat;
uniform float uSMax;
const float PI = 3.14159265;
float fbm4(vec3 p) { float s = 0.0, a = 0.5, n = 0.0; for (int i = 0; i < 4; i++) { s += a * vn(p); n += a; p = p * 2.03 + 7.1; a *= 0.5; } return s / n; }
float fbm3(vec3 p) { float s = 0.0, a = 0.5, n = 0.0; for (int i = 0; i < 3; i++) { s += a * vn(p); n += a; p = p * 2.03 + 3.7; a *= 0.5; } return s / n; }
void field(vec3 q, float cell, float rMin, float rMax, float dens, float seed, inout vec3 grad, inout float alb) {
  vec3 ip = floor(q / cell);
  for (int z = -1; z <= 1; z++) for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
    vec3 c = ip + vec3(float(x), float(y), float(z));
    vec3 h = h33(c + seed);
    if (h.x > dens) continue;
    vec3 ctr = normalize((c + 0.15 + 0.7 * h33(c * 1.37 + seed + 17.0)) * cell);
    float r = mix(rMin, rMax, h.y * h.y * h.y);
    vec3 dv = q - ctr;
    float dl = length(dv);
    float d = dl / r;
    if (d > 1.7) continue;
    vec3 dir = dv / max(dl, 1e-6);
    float x1 = (d - 1.0) / 0.24;
    float rimE = exp(-x1 * x1);
    float dh = (d < 1.0 ? 0.72 * d : 0.0) + 0.09 * rimE * (-2.0 * x1 / 0.24);
    dh *= 1.0 - smoothstep(1.45, 1.7, d);
    grad += dir * dh;
    alb += (d < 1.0 ? -0.03 * (1.0 - d * d) : 0.0) + 0.04 * rimE * (0.35 + 0.65 * h.z);
  }
}
void main() {
  vec2 uv = gl_FragCoord.xy / uSize;
  float lon = (uv.x - 0.5) * 2.0 * PI;
  float lat = (uv.y * 2.0 - 1.0) * uLat;
  vec3 q = vec3(cos(lat) * cos(lon), sin(lat), cos(lat) * sin(lon));
  float mare = smoothstep(0.46, 0.66, fbm4(q * 1.9 + vec3(7.3, 1.1, 4.2)));
  float fine = fbm3(q * 19.0 + vec3(3.1, 9.7, 1.3));
  vec3 grad = vec3(0.0);
  float alb = 0.0;
  field(q, 0.36, 0.035, 0.11, 0.34, 1.0, grad, alb);
  field(q, 0.12, 0.012, 0.04, 0.16, 2.0, grad, alb);
  field(q, 0.045, 0.0045, 0.015, 0.12, 3.0, grad, alb);
  field(q, 0.018, 0.0028, 0.006, 0.1, 4.0, grad, alb);
  vec3 g = grad - dot(grad, q) * q;
  vec3 east = vec3(-sin(lon), 0.0, cos(lon));
  vec3 north = vec3(-sin(lat) * cos(lon), cos(lat), -sin(lat) * sin(lon));
  float se = clamp(dot(g, east) / uSMax, -1.0, 1.0);
  float sn = clamp(dot(g, north) / uSMax, -1.0, 1.0);
  float a = max(0.12, 0.62 - 0.24 * mare + (fine - 0.5) * 0.12 + alb);
  gl_FragColor = vec4(clamp(a, 0.0, 1.0), se * 0.5 + 0.5, sn * 0.5 + 0.5, 1.0);
}
`;

  // A FRAME: each pixel's point on the sphere, turned by the clock, its
  // surface looked up, lit as the image moon was (the light from the lower
  // left and behind, the cold rim light at the limb), and the thin glow of
  // atmosphere round the lit side outside it. Premultiplied alpha.
  const DRAW = HEAD + NOISE + `
uniform sampler2D uTex;
uniform vec2 uOrigin;
uniform float uScale;
uniform float uBufH;
uniform float uHalf;
uniform float uR;
uniform float uPx;
uniform float uTurn;
uniform float uLat;
uniform float uSMax;
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
  vec4 t = texture2D(uTex, vec2(lonB / (2.0 * PI) + 0.5, clamp(lat / uLat, -1.0, 1.0) * 0.5 + 0.5));
  vec3 east = vec3(-sin(lon0), 0.0, cos(lon0));
  vec3 north = vec3(-sin(lat) * cos(lon0), cos(lat), -sin(lat) * sin(lon0));
  vec3 gt = ((t.g * 2.0 - 1.0) * east + (t.b * 2.0 - 1.0) * north) * uSMax;
  vec3 nb = normalize(q0 - gt * 0.42);
  float lam0 = dot(q0, uL);
  float lam = dot(nb, uL);
  // A grain finer than the texture, riding on the surface, faded toward the limb.
  vec3 qb = vec3(cos(lat) * cos(lonB), sin(lat), cos(lat) * sin(lonB));
  float grain = (vn(qb * 420.0) - 0.5) * 0.06 * smoothstep(0.04, 0.35, nz);
  float alb = max(0.1, t.r + grain);
  float light = pow(smoothstep(-0.06, 0.78, lam), 1.25);
  float rim = pow(1.0 - nz, 2.4) * smoothstep(0.05, 0.7, lam0) * 0.34;
  float L = alb * light;
  vec3 lin = vec3(L * 0.84 + rim * 0.42 + 0.0038, L * 0.88 + rim * 0.52 + 0.0035, L * 0.98 + rim + 0.0095);
  vec3 col = pow(clamp(lin, 0.0, 1.0), vec3(1.0 / 2.2));
  float edge = clamp((1.0 - d) * uR * uPx + 0.5, 0.0, 1.0);
  gl_FragColor = vec4(col * edge, edge);
}
`;

  const still = () => document.documentElement.classList.contains('rec-still');
  // Mid match the shell is sealed (and no page is on screen): nothing is
  // baked then, as the image moon was never drawn then. Between matches
  // while recording (the Recording view, a page) it may be, once.
  const sealedHere = () => !!document.querySelector('.app.is-sealed');
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
    let gl = null;
    try { gl = canvas.getContext('webgl', opts) || canvas.getContext('experimental-webgl', opts); } catch (e) { gl = null; }
    if (!gl) return null;
    // A context refused for this moon is let go at once, not left to the collector.
    const refuse = () => { try { const x = gl.getExtension('WEBGL_lose_context'); if (x) x.loseContext(); } catch (e) { /* gone */ } return null; };
    if (software(gl)) return refuse();
    const maxTex = gl.getParameter(gl.MAX_TEXTURE_SIZE) || 0;
    if (maxTex < TEX_W) return refuse();
    const bake = program(gl, BAKE), draw = program(gl, DRAW);
    if (!bake || !draw) return refuse();

    canvas.className = 'sky-moon-img sky-moon-gl';
    canvas.setAttribute('aria-hidden', 'true');
    canvas.style.position = 'absolute';
    canvas.style.pointerEvents = 'none';
    const st = { gl, bake, draw, tex: null, fb: null, buf: null, strip: 0, baked: false, reg: null, scale: 1,
      raf: 0, bakeRaf: 0, last: 0, n: 0, park: 0, shown: false, lost: false, u: {} };
    // Each uniform's place, asked once.
    const uni = (which, n) => {
      const k = which + n;
      if (!(k in st.u)) st.u[k] = gl.getUniformLocation(which === 'd' ? st.draw : st.bake, n);
      return st.u[k];
    };

    function setup() {
      st.buf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, st.buf);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
      st.tex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, st.tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, TEX_W, TEX_H, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      st.fb = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, st.fb);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, st.tex, 0);
      const ok = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      st.strip = 0;
      st.baked = false;
      return ok;
    }
    if (!setup()) return refuse();

    /** One strip of the surface a frame, never while the shell is sealed. */
    function bakeStep() {
      st.bakeRaf = 0;
      if (st.lost || st.baked) return;
      if (sealedHere()) return;   // taken up again once unsealed (the shell lays it out again: wake)
      const rows = TEX_H / STRIPS;
      gl.bindFramebuffer(gl.FRAMEBUFFER, st.fb);
      gl.viewport(0, st.strip * rows, TEX_W, rows);
      gl.useProgram(st.bake);
      gl.uniform2f(uni('b', 'uSize'), TEX_W, TEX_H);
      gl.uniform1f(uni('b', 'uLat'), LAT);
      gl.uniform1f(uni('b', 'uSMax'), SMAX);
      gl.bindBuffer(gl.ARRAY_BUFFER, st.buf);
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
      gl.disable(gl.BLEND);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      st.strip++;
      if (st.strip < STRIPS) { st.bakeRaf = requestAnimationFrame(bakeStep); return; }
      // Done: its smaller sizes for the limb, where the surface is seen edge on.
      gl.bindTexture(gl.TEXTURE_2D, st.tex);
      gl.generateMipmap(gl.TEXTURE_2D);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
      gl.deleteFramebuffer(st.fb);
      st.fb = null;
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
      const u = (n) => uni('d', n);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, st.tex);
      gl.uniform1i(u('uTex'), 0);
      gl.uniform2f(u('uOrigin'), r.x, r.y);
      gl.uniform1f(u('uScale'), r.w / canvas.width);
      gl.uniform1f(u('uBufH'), canvas.height);
      gl.uniform1f(u('uHalf'), r.S / 2);
      gl.uniform1f(u('uR'), r.S * 0.46);
      gl.uniform1f(u('uPx'), canvas.width / r.w);
      gl.uniform1f(u('uTurn'), turnAt(clock()));
      gl.uniform1f(u('uLat'), LAT);
      gl.uniform1f(u('uSMax'), SMAX);
      gl.uniformMatrix3fv(u('uM'), false, M);
      gl.uniform3f(u('uL'), LIGHT_B[0], LIGHT_B[1], LIGHT_B[2]);
      gl.uniform2f(u('uSide'), SIDE[0], SIDE[1]);
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
    /** Back to work: the bake where it stopped, then the frames. */
    function wake() {
      if (st.lost) return;
      if (!st.baked) { if (!st.bakeRaf && !sealedHere()) st.bakeRaf = requestAnimationFrame(bakeStep); return; }
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
      if (canvas.width !== bw) canvas.width = bw;
      if (canvas.height !== bh) canvas.height = bh;
      paint();
      wake();
    }

    canvas.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      st.lost = true;
      cancelAnimationFrame(st.raf); cancelAnimationFrame(st.bakeRaf); clearTimeout(st.park);
      st.raf = st.bakeRaf = st.park = 0;
    });
    canvas.addEventListener('webglcontextrestored', () => {
      // Everything of the old context is gone, the programs with it.
      st.lost = false;
      st.shown = false;
      st.u = {};
      st.bake = program(gl, BAKE);
      st.draw = program(gl, DRAW);
      if (st.bake && st.draw && setup()) wake();
    });

    host.append(canvas);
    // While a match is recorded before it is ready, an image already kept
    // stands in; nothing is drawn.
    if (still() || sealedHere()) imageMoon(host, false);
    // The bake starts once the page is idle, after its own first paint.
    const begin = () => { if (!st.bakeRaf && !st.baked) wake(); };
    if (typeof window.requestIdleCallback === 'function') window.requestIdleCallback(begin, { timeout: 1500 }); else setTimeout(begin, 120);
    return { layout, wake, stop: () => { cancelAnimationFrame(st.raf); st.raf = 0; }, ready: () => st.baked };
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
  // html.rec-still heard here as well: a bake a recording held is taken up
  // again as it ends even where ambient motion stays off (reduced motion).
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

  window.OcclaraSky = Object.freeze({ stars, twinkles, moon, moonImage, hasMoon, MOON_PX, TURN_S });
})();
