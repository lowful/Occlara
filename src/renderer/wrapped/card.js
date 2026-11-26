/**
 * WRAPPED'S CLOSING CARD (docs/claude/wrapped.md): the year on one picture,
 * drawn on this PC the way the Verdict's share image is (shared/verdict-card.js).
 * Nothing is uploaded and no link is made: Save hands the PNG to the browser
 * as a download, so Windows asks where to keep it, and Copy puts it on the
 * clipboard, both from here.
 *
 * WHAT IT DRAWS, AND NOTHING ELSE: Wrapped's own ground, the crescent from
 * its path (square, never stretched), the year, the player's title, the main
 * agent's bundled icon (left out when it does not load), up to six figures
 * from the closing slide, a line saying where it came from, and occlara.app.
 * No Riot ID, the player's own included, and no other player's name: the
 * story has no field for one, and a string with a '#' in it is never drawn.
 *
 * 1080 by 1350 (4:5, a post's shape). Geist 800, 700, 600 and 500 and Geist Mono
 * 500, the weights the app ships, loaded before it is drawn.
 */
(function () {
  'use strict';

  const W = 1080;
  const H = 1350;
  const MARK = 'M67.444,10.281 A50,50 0 1,0 107.855,80.274 A42,42 0 1,1 67.444,10.281 Z';
  const SANS = "'Geist', 'Segoe UI', sans-serif";
  const MONO = "'Geist Mono', Consolas, monospace";
  const clean = (s) => (s === null || s === undefined || String(s).includes('#') ? '' : String(s));

  function ready() {
    try {
      if (!document.fonts || typeof document.fonts.load !== 'function') return Promise.resolve();
      return Promise.all([`800 80px ${SANS}`, `700 40px ${SANS}`, `600 40px ${SANS}`, `500 24px ${SANS}`, `500 20px ${MONO}`]
        .map((f) => Promise.resolve(document.fonts.load(f)).catch(() => null))).then(() => undefined);
    } catch (e) { return Promise.resolve(); }
  }

  function loadImg(src) {
    return new Promise((resolve) => {
      if (!src) { resolve(null); return; }
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => resolve(null);
      img.src = src;
    });
  }

  function mark(ctx, x, y, size, fill) {
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(size / 120, size / 120);
    ctx.fillStyle = fill;
    ctx.fill(new Path2D(MARK));
    ctx.restore();
  }

  /** Text cut with an ellipsis to fit `max` pixels. */
  function fit(ctx, s, max) {
    let t = clean(s);
    if (ctx.measureText(t).width <= max) return t;
    while (t.length > 1 && ctx.measureText(`${t}…`).width > max) t = t.slice(0, -1);
    return `${t}…`;
  }

  /**
   * @param v.year     the year
   * @param v.title    { name } or null
   * @param v.figures  [{ n, label }], up to six
   * @param v.agentSrc the main agent's icon, or null
   * @param v.sample   a sample year: it says so on the card
   */
  function draw(v, icon) {
    const cv = document.createElement('canvas');
    cv.width = W;
    cv.height = H;
    const ctx = cv.getContext('2d');
    // The ground: night, two glows and a sweep, Wrapped's own colours.
    ctx.fillStyle = '#07061A';
    ctx.fillRect(0, 0, W, H);
    const g1 = ctx.createRadialGradient(W * 0.85, H * 0.12, 0, W * 0.85, H * 0.12, W * 0.9);
    g1.addColorStop(0, 'rgba(124, 92, 255, 0.85)');
    g1.addColorStop(1, 'rgba(124, 92, 255, 0)');
    ctx.fillStyle = g1;
    ctx.fillRect(0, 0, W, H);
    const g2 = ctx.createRadialGradient(W * 0.05, H * 0.95, 0, W * 0.05, H * 0.95, W * 1.0);
    g2.addColorStop(0, 'rgba(255, 61, 129, 0.75)');
    g2.addColorStop(1, 'rgba(255, 61, 129, 0)');
    ctx.fillStyle = g2;
    ctx.fillRect(0, 0, W, H);
    const g3 = ctx.createLinearGradient(0, H * 0.35, W, H * 0.6);
    g3.addColorStop(0, 'rgba(34, 211, 238, 0)');
    g3.addColorStop(0.5, 'rgba(34, 211, 238, 0.16)');
    g3.addColorStop(1, 'rgba(34, 211, 238, 0)');
    ctx.fillStyle = g3;
    ctx.fillRect(0, 0, W, H);

    const PAD = 84;
    ctx.textBaseline = 'alphabetic';
    // The mark and the name.
    mark(ctx, PAD, PAD - 6, 56, '#FFFFFF');
    ctx.fillStyle = '#FFFFFF';
    ctx.font = `600 30px ${SANS}`;
    ctx.fillText('Occlara Wrapped', PAD + 74, PAD + 32);
    if (v.sample) {
      ctx.font = `500 22px ${SANS}`;
      ctx.fillStyle = 'rgba(255,255,255,0.7)';
      const s = 'Sample year';
      ctx.fillText(s, W - PAD - ctx.measureText(s).width, PAD + 30);
    }

    // The year, huge, in a sweep of the year's colours.
    ctx.font = `800 300px ${SANS}`;
    const yr = clean(v.year);
    const yg = ctx.createLinearGradient(PAD, 260, PAD + 900, 520);
    yg.addColorStop(0, '#FFFFFF');
    yg.addColorStop(0.55, '#C9B8FF');
    yg.addColorStop(1, '#FF8FC0');
    ctx.fillStyle = yg;
    ctx.fillText(yr, PAD - 12, 470);

    // The title and the agent.
    let y = 560;
    if (icon) {
      const S = 150;
      const x = W - PAD - S;
      ctx.save();
      ctx.beginPath();
      ctx.arc(x + S / 2, y + S / 2 - 40, S / 2, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255,255,255,0.1)';
      ctx.fill();
      ctx.clip();
      ctx.drawImage(icon, x, y - 40, S, S);
      ctx.restore();
      ctx.strokeStyle = 'rgba(255,255,255,0.55)';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(x + S / 2, y + S / 2 - 40, S / 2 + 6, 0, Math.PI * 2);
      ctx.stroke();
    }
    if (v.title && v.title.name) {
      ctx.fillStyle = 'rgba(255,255,255,0.72)';
      ctx.font = `500 28px ${SANS}`;
      ctx.fillText('Your title', PAD, y);
      ctx.fillStyle = '#FFFFFF';
      ctx.font = `800 92px ${SANS}`;
      ctx.fillText(fit(ctx, v.title.name, W - PAD * 2 - (icon ? 190 : 0)), PAD, y + 96);
    }

    // The figures, two columns of three, each its number over its label.
    const figs = (v.figures || []).slice(0, 6);
    const top = 780;
    const colW = (W - PAD * 2) / 2;
    figs.forEach((f, i) => {
      const cx = PAD + (i % 2) * colW;
      const cy = top + Math.floor(i / 2) * 150;
      ctx.strokeStyle = 'rgba(255,255,255,0.22)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx + colW - 36, cy);
      ctx.stroke();
      ctx.fillStyle = '#FFFFFF';
      ctx.font = `700 72px ${SANS}`;
      ctx.fillText(fit(ctx, f.n, colW - 40), cx, cy + 84);
      ctx.fillStyle = 'rgba(255,255,255,0.72)';
      ctx.font = `500 26px ${SANS}`;
      ctx.fillText(fit(ctx, f.label, colW - 40), cx, cy + 122);
    });

    // The foot.
    ctx.fillStyle = 'rgba(255,255,255,0.6)';
    ctx.font = `500 24px ${SANS}`;
    ctx.fillText(v.sample ? 'A sample year, made on this PC' : 'Reviewed and made on this PC', PAD, H - PAD + 8);
    ctx.fillStyle = '#FFFFFF';
    ctx.font = `500 26px ${MONO}`;
    const site = 'occlara.app';
    ctx.fillText(site, W - PAD - ctx.measureText(site).width, H - PAD + 8);
    return cv;
  }

  function render(v) {
    return Promise.all([ready(), loadImg(v && v.agentSrc)]).then(([, icon]) => draw(v || {}, icon));
  }

  function png(v) {
    return render(v).then((cv) => new Promise((resolve, reject) => {
      cv.toBlob((b) => (b ? resolve(b) : reject(new Error('the image could not be made'))), 'image/png');
    }));
  }

  async function save(v) {
    try {
      const blob = await png(v);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `occlara-wrapped-${String(v && v.year || '').replace(/[^0-9]/g, '') || 'year'}.png`;
      a.hidden = true;
      document.body.append(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
      return true;
    } catch (e) { return false; }
  }

  async function copy(v) {
    try {
      const blob = await png(v);
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
      return true;
    } catch (e) { return false; }
  }

  window.WrappedCard = { render, png, save, copy, W, H };
})();
