'use strict';
/*
 * THE SKY (Orbit, 27 Nov 2026): the star field and the moon's lit limb, the
 * logo's crescent at planet scale. Loaded with
 * <script src="../shared/sky.js"></script> and read as window.OcclaraSky.
 *
 * DRAWN ONCE, NEVER PER FRAME. The moon is a few hundred milliseconds of
 * pixel arithmetic (a lit sphere, its maria and its craters), so it is drawn
 * once into an image and the image is kept: in this document, and in
 * localStorage, which every page of the app shares (they are all file:
 * pages), so the shell and Home make it once between them, and every launch
 * after the first makes it not at all. It is only ever drawn while idle,
 * never mid match: a caller asks for it outside one.
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
    const dpr = Math.min(2, window.devicePixelRatio || 1);
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

  /**
   * The moon put into host as an <img class="sky-moon-img">, once, while the
   * page is idle; it fades in (.ready) as it decodes. Returns nothing.
   */
  function moon(host) {
    if (!host || host.querySelector('.sky-moon-img')) return;
    const put = () => {
      if (host.querySelector('.sky-moon-img')) return;
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

  /** Whether the moon is already an image here or in what the app keeps, so putting it up draws nothing. */
  function hasMoon() {
    if (moonUrl) return true;
    try { const kept = window.localStorage && window.localStorage.getItem(KEY); return !!(kept && kept.startsWith('data:image/')); } catch (e) { return false; }
  }

  window.OcclaraSky = Object.freeze({ stars, twinkles, moon, moonImage, hasMoon, MOON_PX });
})();
