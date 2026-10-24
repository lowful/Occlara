'use strict';

/**
 * THE VERDICT'S SHARE IMAGE (8.6.0), drawn on this PC from the Verdict already
 * on the page (src/shared/verdict.js, through the review's preload). Nothing
 * is uploaded, no link is made and no server draws it: the PNG goes to a file
 * the player picks, or to the clipboard, and only from there anywhere. No
 * channel either: Save is an anchor with a blob URL and Copy is the clipboard,
 * both here in the renderer, as Stats' card did them.
 *
 * A plain script that sets window.VerdictCard (no build step). It reads the
 * theme's tokens and font stacks off :root with getComputedStyle, because a
 * canvas cannot read var(): handed one as a fillStyle or a font it refuses it
 * without a word and keeps the one before, which is how Stats' old card drew
 * its tints. A token that still reads as a var() is never handed over; the
 * fallback beside it is, and every fallback is the token's own value.
 *
 * WHAT IT DRAWS, AND NOTHING ELSE: four corner brackets, the crescent from its
 * path (square, never stretched), VERDICT, the map, score and result (League's
 * champion and the game's length), the letter AND the number out of 100 with
 * PROVISIONAL above it when it is, the one reason, up to four numbers (one the
 * review does not have is left out, never drawn as "--"), the agent and mode,
 * occlara.app as typed, and the date. No Riot ID, the player's own included,
 * and no other player's name: the Verdict has no field for one, and a string
 * with a '#' in it is not drawn whatever brought it.
 *
 * PAPER BY DEFAULT. On paper every letter is ink, since a grade's colours
 * measure about 2.7:1 there and the number beside it says the rest. Dark, the
 * letter takes its tone from GradeView, the one grade colour rule, with the
 * number beside it as everywhere a grade is drawn.
 *
 * Three sizes, each laid out in a reference box drawn at 2.5 times: the card,
 * 1586 by 1000 (1.586:1); the post, 1080 by 1350 (4:5); Discord, 1200 by 628
 * (1.91:1, a link preview's shape, posted as an image). Geist 600 and 500 and
 * Geist Mono 500 only, the weights the app ships (ready() loads them first).
 */
(function () {
  const MARK = 'M76.294,4.281 A50,50 0 1,0 116.705,74.274 A42,42 0 1,1 76.294,4.281 Z';
  const SCALE = 2.5;
  const SIZES = {
    card:    { w: 1586, h: 1000 },
    post:    { w: 1080, h: 1350 },
    discord: { w: 1200, h: 628 },
  };
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  /** A token off :root, or its fallback when it is missing or still names a var(). */
  function tok(name, fallback) {
    let v = '';
    try { v = String(getComputedStyle(document.documentElement).getPropertyValue(name) || '').trim(); } catch (e) { v = ''; }
    return v && !/var\(/i.test(v) ? v : fallback;
  }

  /** A tracking token ("0.08em") as a number of ems, or the fallback. */
  function em(name, fallback) {
    const m = /^(-?\d*\.?\d+)em$/.exec(tok(name, ''));
    return m ? Number(m[1]) : fallback;
  }

  /** The two font stacks and the app's own tracking, off :root. */
  function fonts() {
    return {
      sans: tok('--font', "'Geist', 'Segoe UI', sans-serif"),
      mono: tok('--font-mono', "'Geist Mono', Consolas, monospace"),
      label: em('--track-label', 0.08),
      display: em('--track-display', -0.02),
    };
  }

  /** The colours of one ground, as values a canvas takes. */
  function palette(paper) {
    if (paper) {
      const ink = tok('--paper-ink', '#0A0B0E');
      return {
        ground: tok('--paper', '#E9EBF0'), ink, ink2: tok('--paper-ink-2', '#484A4E'), ink3: tok('--paper-ink-3', '#636568'),
        line: tok('--paper-line', 'rgba(10, 11, 14, 0.14)'), bracket: tok('--paper-ink-2', '#484A4E'),
        tone: () => ink,
      };
    }
    const ink = tok('--text', '#F5F5F7');
    return {
      ground: tok('--bg', '#0A0B0E'), ink, ink2: tok('--text-dim', '#A1A1A6'), ink3: tok('--text-mute', '#808086'),
      line: tok('--line', 'rgba(255, 255, 255, 0.09)'), bracket: tok('--text-dim', '#A1A1A6'),
      tone: (t) => (t === 'good' ? tok('--good', '#52C88A') : t === 'warn' ? tok('--warn', '#D9A441')
        : t === 'bad' ? tok('--bad', '#E8636F') : ink),
    };
  }

  /** The letter's tone by the one grade colour rule (grade-view.js), or none. */
  function toneOf(v) {
    const GV = typeof window !== 'undefined' ? window.GradeView : null;
    return GV && typeof GV.gradeTone === 'function' ? GV.gradeTone({ score: v.score, letter: v.letter }) : '';
  }

  /** Text the image may carry: never a string with a '#' in it. */
  const clean = (s) => (s === null || s === undefined || String(s).includes('#') ? '' : String(s));

  /** "4 Oct 2026", the local day of a timestamp, or null. */
  function dateLabel(at) {
    if (typeof at !== 'number' || !Number.isFinite(at)) return null;
    const d = new Date(at);
    return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
  }

  /** "2026-10-04", the local day of a timestamp, or null. */
  function isoDay(at) {
    if (typeof at !== 'number' || !Number.isFinite(at)) return null;
    const d = new Date(at);
    const two = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}`;
  }

  /** occlara-verdict-<map or champion>-<score>-<yyyy-mm-dd>.png */
  function fileName(v) {
    const x = v || {};
    const slug = clean(x.title).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'match';
    const score = typeof x.score === 'number' && Number.isFinite(x.score) ? `-${x.score}` : '';
    const day = isoDay(x.at);
    return `occlara-verdict-${slug}${score}${day ? `-${day}` : ''}.png`;
  }

  function brackets(ctx, x, y, w, h, len, lw, color) {
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = lw;
    ctx.lineCap = 'butt';
    const o = lw / 2;
    ctx.beginPath();
    ctx.moveTo(x + o, y + len); ctx.lineTo(x + o, y + o); ctx.lineTo(x + len, y + o);
    ctx.moveTo(x + w - len, y + o); ctx.lineTo(x + w - o, y + o); ctx.lineTo(x + w - o, y + len);
    ctx.moveTo(x + w - o, y + h - len); ctx.lineTo(x + w - o, y + h - o); ctx.lineTo(x + w - len, y + h - o);
    ctx.moveTo(x + len, y + h - o); ctx.lineTo(x + o, y + h - o); ctx.lineTo(x + o, y + h - len);
    ctx.stroke();
    ctx.restore();
  }

  /** The crescent at (x, y), `size` square: one scale on both axes, so never stretched. */
  function mark(ctx, x, y, size, color) {
    ctx.save();
    ctx.translate(x, y);
    const k = size / 120;
    ctx.scale(k, k);
    ctx.fillStyle = color;
    ctx.fill(new Path2D(MARK));
    ctx.restore();
  }

  /** The pen: text in the app's two faces, at the app's own tracking. */
  function pen(ctx, F) {
    const style = (font, track, color, align) => {
      ctx.font = font;
      ctx.letterSpacing = `${Number(track.toFixed(2))}px`;
      if (color) ctx.fillStyle = color;
      ctx.textAlign = align || 'left';
      ctx.textBaseline = 'alphabetic';
    };
    const measure = (text) => {
      const m = ctx.measureText(text);
      return { width: m.width || 0, left: Number.isFinite(m.actualBoundingBoxLeft) ? m.actualBoundingBoxLeft : 0 };
    };
    return {
      /** A small label: Geist Mono 500, tracked, upper case unless asked (a URL stays as typed). Its width, drawn only when given a colour. */
      mono(text, x, y, px, color, align, keepCase) {
        const t = keepCase ? clean(text) : clean(text).toUpperCase();
        if (!t) return 0;
        ctx.save();
        const track = px * F.label;
        style(`500 ${px}px ${F.mono}`, track, color, align);
        // A right aligned tracked line ends in its own last spacing: take it back.
        if (color) ctx.fillText(t, x + (align === 'right' ? track : 0), y);
        const w = measure(t).width;
        ctx.restore();
        return w;
      },
      /** A number: Geist Mono 500, untracked. Its width, drawn only when given a colour. */
      num(text, x, y, px, color) {
        const t = clean(text);
        ctx.save();
        style(`500 ${px}px ${F.mono}`, 0, color, 'left');
        if (color && t) ctx.fillText(t, x, y);
        const w = measure(t).width;
        ctx.restore();
        return w;
      },
      /** Geist at a weight that ships (500 or 600), at `track` ems. Its width and its ink's left bearing. */
      sans(text, x, y, px, weight, color, track) {
        const t = clean(text);
        ctx.save();
        style(`${weight} ${px}px ${F.sans}`, (track || 0) * px, color, 'left');
        if (color && t) ctx.fillText(t, x, y);
        const m = measure(t);
        ctx.restore();
        return m;
      },
      /** Lines of at most maxW, at most maxLines, the last cut with an ellipsis. */
      wrap(text, px, weight, maxW, maxLines) {
        const words = clean(text).split(/\s+/).filter(Boolean);
        if (!words.length) return [];
        ctx.save();
        style(`${weight} ${px}px ${F.sans}`, 0, null, 'left');
        const fits = (s) => measure(s).width <= maxW;
        const lines = [];
        let cur = '';
        for (const w of words) {
          const next = cur ? `${cur} ${w}` : w;
          if (!cur || fits(next)) cur = next;
          else { lines.push(cur); cur = w; }
        }
        if (cur) lines.push(cur);
        if (lines.length > maxLines) {
          const keep = lines.slice(0, maxLines);
          let last = keep[maxLines - 1];
          while (last && !fits(`${last}…`)) last = last.slice(0, -1);
          keep[maxLines - 1] = `${last.replace(/[\s,.;:]+$/, '')}…`;
          ctx.restore();
          return keep;
        }
        ctx.restore();
        return lines;
      },
    };
  }

  /**
   * Draw a Verdict (verdict.js of()) into a new canvas, synchronously: call
   * ready() first, or use render(), so the faces are loaded.
   * @param v     { title, right, letter, score, provisional, reason, stats: [[label, value]], sub, at }
   * @param opts  { size: 'card' | 'post' | 'discord', paper: false for the dark ground }
   */
  function draw(v, opts) {
    const o = opts || {};
    const size = Object.prototype.hasOwnProperty.call(SIZES, o.size) ? o.size : 'card';
    const S = SIZES[size];
    const P = palette(o.paper !== false);
    const F = fonts();
    const cv = document.createElement('canvas');
    cv.width = S.w;
    cv.height = S.h;
    const ctx = cv.getContext('2d');
    const t = pen(ctx, F);
    const W = S.w / SCALE;
    const H = S.h / SCALE;
    const pad = 32;
    const stats = (Array.isArray(v.stats) ? v.stats : [])
      .filter((s) => Array.isArray(s) && s[1] !== null && s[1] !== undefined && clean(s[0]) && clean(s[1]))
      .slice(0, 4);

    ctx.save();
    ctx.scale(SCALE, SCALE);
    ctx.fillStyle = P.ground;
    ctx.fillRect(0, 0, W, H);
    brackets(ctx, 12, 12, W - 24, H - 24, 16, 1.5, P.bracket);

    // The top row: the mark and VERDICT; the map, the score and the result on
    // the right. The crescent's ink starts 21 of its 120 in, so the mark is
    // drawn that much left to stand on the margin the letter and reason share.
    mark(ctx, pad - 14 * (21 / 120), 33, 14, P.ink);
    t.mono('Verdict', pad + 20, 45, 11, P.ink);
    t.mono(v.right, W - pad, 45, 11, P.ink3, 'right');

    /** The letter, then the number out of 100: the colour is never the only signal. */
    const gradeBlock = (base, px) => {
      const letter = clean(v.letter);
      // The letter's ink on the left margin, where the reason under it starts.
      const at = t.sans(letter, 0, base, px, 600, null, F.display);
      const x = pad + at.left;
      t.sans(letter, x, base, px, 600, P.tone(toneOf(v)), F.display);
      const nx = x + at.width + px * 0.1;
      const spx = px * 0.42;
      const score = t.sans(String(v.score), nx, base, spx, 600, P.ink2, F.display);
      t.mono('/100', nx + score.width + 4, base, 10, P.ink3);
      // Just above the number it qualifies: Geist's figures stand 0.71 of the size.
      if (v.provisional) t.mono('Provisional', nx, base - spx * 0.71 - 12, 10, P.ink3);
    };
    const reasonLines = (px, maxW, maxLines, y, lead) => {
      t.wrap(v.reason, px, 500, maxW, maxLines).forEach((l, i) => t.sans(l, pad, y + i * lead, px, 500, P.ink2, 0));
    };
    /** The numbers in one row of columns, each as wide as it needs: from x1 (`left`) or ending at it. Its left edge. */
    const statRow = (x1, y, px, gap, left) => {
      if (!stats.length) return null;
      const ws = stats.map(([label, value]) => Math.max(t.num(value, 0, 0, px, null), t.mono(label, 0, 0, 10, null)));
      let x = left ? x1 : x1 - ws.reduce((a, b) => a + b, 0) - gap * (ws.length - 1);
      const x0 = x;
      stats.forEach(([label, value], i) => {
        if (i) { ctx.fillStyle = P.line; ctx.fillRect(x - gap / 2, y - 14, 1, px + 26); }
        t.mono(label, x, y, 10, P.ink3);
        t.num(value, x, y + px + 8, px, P.ink);
        x += ws[i] + gap;
      });
      return x0;
    };
    /** The numbers two by two, from x0. */
    const statGrid = (x0, y, px, colW) => {
      stats.forEach(([label, value], i) => {
        const x = x0 + (i % 2) * colW;
        const yy = y + Math.floor(i / 2) * (px + 34);
        if (i % 2) { ctx.fillStyle = P.line; ctx.fillRect(x - 14, yy - 14, 1, px + 26); }
        t.mono(label, x, yy, 10, P.ink3);
        t.num(value, x, yy + px + 8, px, P.ink);
      });
    };

    if (size === 'post') {
      // 432 by 540: stacked, the grade large, the reason in up to three lines.
      gradeBlock(250, 160);
      reasonLines(22, W - pad * 2, 3, 298, 30);
      ctx.fillStyle = P.line;
      ctx.fillRect(pad, 392, W - pad * 2, 1);
      statRow(pad, 426, 20, 30, true);
      t.mono(v.sub, pad, 486, 10, P.ink3);
    } else if (size === 'discord') {
      // 480 by 251.2: the grade on the left, the numbers two by two on the
      // right. The grade sits high enough that a reason of two lines clears
      // the bottom row.
      gradeBlock(140, 92);
      reasonLines(15, 224, 2, 172, 20);
      const x0 = W - pad - 178;
      statGrid(x0, 92, 18, 104);
      t.mono(v.sub, x0, stats.length ? 92 + Math.ceil(stats.length / 2) * 52 : 140, 10, P.ink3);
    } else {
      // 634.4 by 400: the grade on the left, the numbers in a row on the right.
      gradeBlock(226, 112);
      reasonLines(15, 300, 2, 262, 21);
      const x0 = statRow(W - pad, 168, 18, 26, false);
      if (x0 === null) t.mono(v.sub, W - pad, 262, 10, P.ink3, 'right');
      else t.mono(v.sub, x0, 262, 10, P.ink3);
    }
    // The bottom row: the address as typed, the date on the right.
    t.mono('occlara.app', pad, H - 32, 10, P.ink3, 'left', true);
    const day = dateLabel(v.at);
    if (day) t.mono(day, W - pad, H - 32, 10, P.ink3, 'right');
    ctx.restore();
    return cv;
  }

  /** The three faces the image draws in, loaded before it is drawn. */
  function ready() {
    const F = fonts();
    try {
      if (!document.fonts || typeof document.fonts.load !== 'function') return Promise.resolve();
      return Promise.all([`600 40px ${F.sans}`, `500 40px ${F.sans}`, `500 20px ${F.mono}`]
        .map((face) => Promise.resolve(document.fonts.load(face)).catch(() => null))).then(() => undefined);
    } catch (e) {
      return Promise.resolve();
    }
  }

  /** The faces loaded, then the image drawn. */
  function render(v, opts) {
    return ready().then(() => draw(v, opts));
  }

  /** The image as a PNG blob. */
  function png(v, opts) {
    return render(v, opts).then((cv) => new Promise((resolve, reject) => {
      cv.toBlob((b) => (b ? resolve(b) : reject(new Error('the image could not be made'))), 'image/png');
    }));
  }

  /**
   * Save: the PNG handed to the browser as a download under its file name, so
   * Windows asks where to keep it. True once it is handed over.
   */
  async function save(v, opts) {
    try {
      const blob = await png(v, opts);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName(v);
      a.hidden = true;
      document.body.append(a);
      a.click();
      a.remove();
      // Kept a while: the download reads it after the click.
      setTimeout(() => URL.revokeObjectURL(url), 60000);
      return true;
    } catch (e) {
      return false;
    }
  }

  /** Copy: the PNG on the clipboard as an image. True when it is there. */
  async function copy(v, opts) {
    try {
      const blob = await png(v, opts);
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
      return true;
    } catch (e) {
      return false;
    }
  }

  const api = { draw, render, ready, save, copy, fileName, dateLabel, palette, fonts, SIZES, SCALE, MARK };
  if (typeof window !== 'undefined') window.VerdictCard = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
