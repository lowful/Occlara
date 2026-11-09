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
 * WHAT IT DRAWS, AND NOTHING ELSE: four corner brackets, the character's icon
 * (a bundled file, left out when there is none) with the agent and mode beside
 * it, the map, score and result (League's champion and the game's length),
 * the letter AND the number out of 100 with PROVISIONAL above it when it is,
 * the one standout number with its line (verdict.js standout, 8.7.x, where
 * the reason was), up to four numbers (one the review does not have is left
 * out, never drawn as "--"), the crescent from its path (square, never
 * stretched) beside occlara.app as typed, and the date. No VERDICT word since
 * 8.7.x. No Riot ID, the player's own included,
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
        // The icon's tile: the paper's own line, filled.
        tile: tok('--paper-line', 'rgba(10, 11, 14, 0.14)'),
        tone: () => ink,
      };
    }
    const ink = tok('--text', '#F5F5F7');
    return {
      ground: tok('--bg', '#0A0B0E'), ink, ink2: tok('--text-dim', '#A1A1A6'), ink3: tok('--text-mute', '#808086'),
      line: tok('--line', 'rgba(255, 255, 255, 0.09)'), bracket: tok('--text-dim', '#A1A1A6'),
      tile: tok('--bg-2', '#0F1116'),
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

  /*
   * THE CHARACTER'S ICON (8.7.x): the agent or the champion the player used,
   * a bundled file under assets/ (shared/agent-icons.js names it), loaded
   * from this script's own folder, so the review page and any page that links
   * the script find the same file. Same origin as the page, so the canvas is
   * never tainted and Save still works. A path of any other shape is never
   * asked for, and one that fails to load leaves the slot out.
   */
  const ICON_PATH = /^(?:valorant\/agents|lol\/champions)\/[A-Za-z0-9]+\.png$/;
  const HERE = (typeof document !== 'undefined' && document.currentScript && document.currentScript.src) || '';

  /** The icon's URL, or null for a path that is not one of the bundled icons'. */
  function iconUrl(icon) {
    if (typeof icon !== 'string' || !ICON_PATH.test(icon)) return null;
    try { return new URL(`../../../assets/${icon}`, HERE || document.baseURI).href; } catch (e) { return null; }
  }

  /** The icon loaded as an image, or null; never rejects. */
  function loadIcon(icon) {
    const url = iconUrl(icon);
    if (!url || typeof Image === 'undefined') return Promise.resolve(null);
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => resolve(img.naturalWidth > 0 ? img : null);
      img.onerror = () => resolve(null);
      img.src = url;
    });
  }

  /** The icon in a rounded tile at (x, y), `size` square, on a quiet ground of its own. */
  function portrait(ctx, img, x, y, size, ground, edge) {
    const r = size * 0.18;
    const shape = () => {
      ctx.beginPath();
      if (typeof ctx.roundRect === 'function') ctx.roundRect(x, y, size, size, r);
      else ctx.rect(x, y, size, size);
    };
    ctx.save();
    shape();
    ctx.fillStyle = ground;
    ctx.fill();
    ctx.clip();
    ctx.drawImage(img, x, y, size, size);
    ctx.restore();
    ctx.save();
    shape();
    ctx.strokeStyle = edge;
    ctx.lineWidth = 1;
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
      /** A small label: Geist Mono 500, untracked, in the case it is written in (8.8: no uppercase, no tracked labels). Its width, drawn only when given a colour. */
      mono(text, x, y, px, color, align) {
        const t = clean(text);
        if (!t) return 0;
        ctx.save();
        style(`500 ${px}px ${F.mono}`, 0, color, align);
        if (color) ctx.fillText(t, x, y);
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
   * @param v     { title, right, letter, score, provisional, stat: { value, label }, stats: [[label, value]], sub, icon, at }
   * @param opts  { size: 'card' | 'post' | 'discord', paper: false for the dark ground,
   *                icon: the character's image, loaded (render() loads it), or none }
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

    // The top row (8.7.x): the character's icon, then the agent and mode (the
    // role and mode for League) in ink, and the map, the score and the result
    // on the right. No VERDICT any more: the crescent signs the bottom row,
    // beside the address. Without an icon the line starts on the margin.
    const icon = o.icon && o.icon.naturalWidth !== 0 ? o.icon : null;
    const iconPx = size === 'discord' ? 30 : 36;
    const rightW = t.mono(v.right, 0, 0, 11, null);
    let subX = pad;
    if (icon) {
      // Centred on the line's capitals, which stand about 8 above its baseline.
      portrait(ctx, icon, pad, 41 - iconPx / 2, iconPx, P.tile, P.line);
      subX = pad + iconPx + 12;
    }
    // The left line never runs into the right one: the mode goes first, then the line.
    const room = W - pad - rightW - 16 - subX;
    const parts = clean(v.sub).split(' · ').filter(Boolean);
    let sub = parts.join(' · ');
    if (t.mono(sub, 0, 0, 11, null) > room && parts.length > 1) sub = parts[0];
    if (t.mono(sub, 0, 0, 11, null) > room) sub = '';
    t.mono(sub, subX, 45, 11, P.ink);
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
    /*
     * The standout under the grade (verdict.js standout), where the reason
     * was: its value large in ink, its line beside it on the same baseline in
     * the reason's old voice, or under the value when it does not fit beside
     * it. No standout, no line.
     */
    const standout = (y, vpx, lpx, maxW, lead) => {
      const s = v.stat && typeof v.stat === 'object' ? v.stat : null;
      const value = s ? clean(s.value) : '';
      const label = s ? clean(s.label) : '';
      if (!value || !label) return;
      const vm = t.sans(value, 0, y, vpx, 600, null, F.display);
      const vx = pad + vm.left;
      t.sans(value, vx, y, vpx, 600, P.ink, F.display);
      const gap = vpx * 0.35;
      const beside = maxW - vm.width - gap;
      const one = t.wrap(label, lpx, 500, beside, 1);
      if (one.length === 1 && !one[0].endsWith('…') && one[0] === label) {
        t.sans(label, vx + vm.width + gap, y, lpx, 500, P.ink2, 0);
        return;
      }
      t.wrap(label, lpx, 500, maxW, 2).forEach((l, i) => t.sans(l, pad, y + lead * (i + 1), lpx, 500, P.ink2, 0));
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
      // 432 by 540: stacked, the grade large, the standout under it.
      gradeBlock(250, 160);
      standout(318, 40, 18, W - pad * 2, 26);
      ctx.fillStyle = P.line;
      ctx.fillRect(pad, 392, W - pad * 2, 1);
      statRow(pad, 426, 20, 30, true);
    } else if (size === 'discord') {
      // 480 by 251.2: the grade on the left, the numbers two by two on the
      // right, the standout under the grade. The grade sits high enough that
      // a standout whose line falls under its value clears the bottom row.
      gradeBlock(140, 92);
      standout(180, 24, 13, 224, 17);
      statGrid(W - pad - 178, 104, 18, 104);
    } else {
      // 634.4 by 400: the grade on the left, the numbers in a row on the right.
      gradeBlock(226, 112);
      standout(276, 30, 15, 300, 21);
      statRow(W - pad, 186, 18, 26, false);
    }
    // The bottom row: the crescent and the address as typed, the date on the
    // right. The crescent's ink starts 21 of its 120 in, so the mark is drawn
    // that much left to stand on the margin the letter shares.
    mark(ctx, pad - 11 * (21 / 120), H - 32 - 9.5, 11, P.ink2);
    t.mono('occlara.app', pad + 16, H - 32, 10, P.ink3, 'left');
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

  /** The faces and the character's icon loaded, then the image drawn. */
  function render(v, opts) {
    return Promise.all([ready(), loadIcon(v && v.icon)])
      .then(([, icon]) => draw(v, { ...(opts || {}), icon }));
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

  const api = { draw, render, ready, save, copy, fileName, dateLabel, palette, fonts, iconUrl, loadIcon, SIZES, SCALE, MARK, ICON_PATH };
  if (typeof window !== 'undefined') window.VerdictCard = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
