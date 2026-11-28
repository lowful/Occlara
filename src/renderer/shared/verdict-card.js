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
 * the grade's number out of 100 in its tone with "Grade" over "/100" beside it
 * and PROVISIONAL with it when it is (one score, no letter since 9.1),
 * the one standout number with its line (verdict.js standout, 8.7.x, where
 * the reason was), up to four numbers (one the review does not have is left
 * out, never drawn as "--"), the moon from its path, even odd (square, never
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
  const MARK = 'M10 60a50 50 0 1 0 100 0a50 50 0 1 0 -100 0ZM49.86 25.85L47.71 26.13L46.57 26.44L45.57 26.83L45.29 26.83L41.57 28.69L40 29.24L39.14 29.33L38.29 29.22L37.43 28.96L36 28.36L35.29 28.24L34.57 28.32L33.71 28.57L32.57 29.02L31.71 29.44L30.57 30.23L29.15 31.43L27.14 33.55L23.97 38L22.14 41.09L21.43 42.51L20.73 44.14L19.29 47.92L18.86 49.25L18.56 51L18.14 54.86L18.1 56.29L18.23 57.71L18.86 60.87L19.14 61.77L19.57 62.62L21 64.28L22.56 66.86L23.4 68L24.14 68.66L26.14 70.01L26.71 70.21L27.14 70.19L29.57 69.25L30.29 68.72L31.06 67.71L31.56 66.86L31.88 66L32.54 62.43L32.76 60.29L32.91 59.86L33.14 59.57L33.43 59.43L33.86 59.38L36.14 59.77L37.43 59.74L38.14 59.62L39 59.27L40.14 58.54L40.86 57.97L41.46 57.29L41.9 56.57L42.22 55.86L42.43 55.14L42.52 54.43L42.54 53.43L42.41 51.86L41.68 48.43L41.73 48L41.93 47.71L42.57 47.38L46.14 46.24L47.43 45.91L51.14 45.38L52.29 45.06L53.43 44.6L54.43 44.07L55.43 43.44L57.14 42.07L58.34 40.86L59.2 39.57L59.76 38.29L60.46 36.14L60.75 35L60.85 34L60.76 33L60.46 31.86L59.88 30.29L59.36 29.29L58.71 28.51L57.86 27.84L56.35 27L54.72 26.29L53.71 26L52.71 25.84ZM69.43 32.85L68.07 33.29L66.71 34.09L65.9 34.86L65.61 35.29L65.33 35.86L64.78 37.71L64.69 38.29L64.69 38.86L64.99 40L65.9 41.86L66.71 43L67.86 44.05L68.86 44.7L69.86 45.18L72 45.85L73.43 46.18L74.57 46.21L76.43 45.91L76.86 45.99L76.94 46.14L76.91 46.43L76.7 46.86L76.2 47.57L75.99 47.71L75.66 48.14L75.06 49.14L74.1 51.86L72.71 54.99L72.43 55.86L72.05 58L72.03 59.14L72.4 60.57L73.05 62L73.46 62.57L74.11 63.29L74.59 63.71L75.14 64.08L77.43 64.99L78.14 65.12L78.71 65.11L79.57 64.94L80.57 64.52L83.43 62.69L84.29 62.39L86.29 61.85L88.71 60.59L89.14 60.51L89.43 60.6L89.65 60.86L89.82 61.29L89.93 61.86L89.96 62.43L89.85 63.14L89.43 64.54L89.32 65.14L89.29 68.14L89.15 69.14L89 69.53L88.86 69.59L88.71 69.51L88.12 68.71L87.71 68.29L87.14 67.91L86.57 67.64L86 67.51L85.43 67.52L84.57 67.64L84 67.84L83.29 68.35L82.65 69L82.26 69.57L81.99 70.14L81.66 71.14L81.54 71.86L81.56 72.86L81.72 73.57L82 74.1L82.45 74.71L82.73 75L83.14 75.25L83.71 75.42L84.29 75.48L85.38 75.29L86.43 74.77L87.18 74.14L88.09 72.86L89 71.11L89.14 70.93L89.29 70.92L89.71 71.3L91.14 72.88L92.14 73.65L92.71 73.85L93.29 73.86L93.86 73.7L94.43 73.41L95 73L95.71 72.34L96.37 71.57L96.97 70.71L97.95 68.86L98.24 68L98.44 67.14L98.97 63.29L99.01 62.29L98.96 61.29L98.75 60L98.45 59L98.01 58L97.37 56.86L96.86 56.13L96.29 55.53L95.86 55.3L95.43 55.19L94.57 55.2L93.43 55.36L92.71 55.61L91.57 56.26L91.29 56.3L91.14 56.22L90.94 55.86L90.79 55.29L90.06 50.71L89.88 50.57L89.61 49.71L89.14 48.86L88.57 48.14L87.69 47.29L86.29 46.21L85.71 45.86L84.86 45.55L83.71 45.39L81.43 45.37L79.43 45.25L78.71 45.15L78.41 45L78.29 44.71L78.33 44.29L79.01 41.29L78.96 40L78.57 38.43L78.11 37.14L77.54 36.14L76.86 35.28L76.14 34.58L75.36 34L74.57 33.57L73.57 33.17L72.57 32.92L71.43 32.76L70.43 32.74ZM95.14 41.57L94.43 41.68L93.71 42.04L93.29 42.43L92.99 43L92.75 44.14L92.69 45.43L92.81 46.43L93.15 47.57L93.69 48.86L94.26 49.86L94.91 50.71L95.71 51.5L96.43 51.98L97.29 52.3L98.14 52.36L99 52.22L99.43 51.93L99.77 51.43L100.06 50.71L100.24 49.86L100.27 49L100.16 48L99.94 47L99.63 46L99.22 45L98.71 44.04L98.14 43.21L97.57 42.59L97 42.11L96.43 41.77L95.86 41.62ZM33.15 44.57L33.43 44.46L33.86 44.48L34.57 44.89L35.16 45.43L35.49 45.86L35.65 46.29L35.63 46.57L35.44 47L35.09 47.43L33.24 49.14L32.57 49.86L32.02 50.71L31.43 52.08L31 52.54L30.71 52.62L30.43 52.46L30.29 52.22L30.12 51.43L30.14 50.57L30.47 49.43L30.98 48L31.66 46.43L32.43 45.25L32.86 44.78ZM40.57 63.27L40 63.5L38.98 64.14L38.57 64.45L38.29 64.8L38.12 65.14L37.97 65.71L37.75 67L37.7 67.71L37.84 68.71L38.1 69.71L39.19 72L39.83 73.71L40.04 74.57L40.31 76.43L40.5 77.14L40.93 78L41.32 78.57L42.43 79.77L43.57 80.71L44.29 81.17L45.29 81.58L48.43 82.38L49.14 82.48L49.71 82.48L52.71 82.02L53.71 81.73L54.43 81.31L55.31 80.43L56.48 78.86L56.89 78L57.08 77L57 76L56.66 74.86L55.58 72.43L54.98 71.43L54.43 70.86L53.86 70.49L51.75 69.71L49.71 68.49L48 67.87L47.43 67.56L46.85 67L45.13 64.57L44.57 64.01L44 63.6L43.43 63.34L42.86 63.21L41.29 63.18ZM32.57 74.26L32 74.46L31.35 75L30.93 75.57L30.75 76.14L30.66 77L30.74 77.86L31.01 78.71L31.43 79.63L31.96 80.43L32.52 81L33.29 81.56L34.14 82L34.71 82.18L35.29 82.22L35.86 82.13L36.71 81.86L37.07 81.57L37.71 80.83L37.97 80.43L38.11 80L38.11 79.29L37.96 78.29L37.75 77.57L37.48 77L37.03 76.29L36.53 75.71L36 75.28L35 74.67L34 74.26ZM66.14 76.85L65.29 76.99L64.39 77.29L63.57 77.73L62.86 78.28L62.33 78.86L61.87 79.57L61.58 80.29L61.41 81.14L61.44 82L61.62 82.71L61.97 83.43L62.43 84.02L63 84.52L63.71 84.95L64.57 85.26L65.43 85.4L66.43 85.39L67.43 85.19L68.43 84.78L69.2 84.29L69.96 83.57L70.46 82.86L70.84 82L71.01 81.14L70.99 80.29L70.77 79.43L70.29 78.57L69.71 77.96L69 77.45L68.14 77.08L67.14 76.87ZM66.56 78.43L67.29 78.44L68 78.6L68.61 78.86L69.21 79.29L69.7 79.86L69.98 80.43L70.12 81L70.12 81.71L69.94 82.43L69.65 83L69.2 83.57L68.7 84L68 84.4L67.29 84.65L66.57 84.76L65.86 84.74L65.29 84.63L64.71 84.41L64.14 84.06L63.71 83.66L63.43 83.28L63.16 82.71L63.04 82.14L63.03 81.57L63.14 81L63.37 80.43L63.71 79.9L64.16 79.43L64.71 79.02L65.29 78.73L65.86 78.54ZM52.29 87.84L51.43 88.05L50.64 88.43L50 88.99L49.63 89.57L49.45 90.29L49.51 91L49.8 91.71L50.22 92.29L50.86 92.87L51.71 93.38L52.57 93.71L53.57 93.91L54.57 93.93L55.57 93.76L56.41 93.43L57.02 93L57.41 92.57L57.65 92.14L57.83 91.29L57.76 90.71L57.61 90.29L57.05 89.43L56.14 88.66L55.57 88.34L54.86 88.06L53.57 87.8ZM52.67 89L53.57 88.92L54.57 89.06L55.52 89.43L56.3 90L56.82 90.71L57 91.43L56.87 92.14L56.47 92.71L56 93.07L55.43 93.31L54.86 93.44L54.14 93.47L53.43 93.38L52.71 93.17L52.1 92.86L51.54 92.43L51.17 92L50.88 91.43L50.8 90.86L50.86 90.43L51.06 90L51.44 89.57L52 89.22ZM74.14 90.56L73.14 90.86L72.29 91.3L71.54 91.86L70.91 92.57L70.57 93.29L70.5 93.86L70.66 94.43L71.14 94.95L71.71 95.23L72.43 95.36L73.29 95.34L74.14 95.16L75 94.84L75.73 94.43L76.44 93.86L76.93 93.29L77.28 92.57L77.36 92L77.22 91.43L76.89 91L76.43 90.7L75.71 90.49L75 90.45ZM74.2 91.43L74.86 91.34L75.43 91.36L75.86 91.47L76.28 91.71L76.52 92L76.66 92.43L76.61 92.86L76.43 93.29L76.11 93.71L75.64 94.14L75 94.53L74.43 94.77L73.71 94.94L73.14 94.97L72.57 94.89L72.14 94.71L71.8 94.43L71.6 94L71.6 93.57L71.83 93L72.29 92.43L72.84 92L73.43 91.68ZM51.71 95.28L50.43 95.54L49.36 96L48.66 96.57L48.46 96.86L48.28 97.29L48.27 98L48.42 98.43L48.67 98.86L49.35 99.57L50.43 100.28L51.71 100.83L53.14 101.22L54.57 101.42L56 101.43L57.29 101.26L58.43 100.9L59.29 100.4L59.57 100.13L59.86 99.71L60.01 99.29L60.03 98.86L59.94 98.43L59.74 98L59.42 97.57L58.99 97.14L57.94 96.43L56.57 95.83L55 95.41L53.29 95.22ZM52.41 96.43L53.57 96.35L54.86 96.47L56 96.75L57.14 97.22L58 97.8L58.55 98.43L58.73 98.86L58.76 99.14L58.62 99.71L58.27 100.14L57.57 100.57L56.71 100.83L55.86 100.95L54.86 100.95L53.71 100.81L52.71 100.55L51.71 100.14L51 99.69L50.42 99.14L50.1 98.57L50.04 98L50.29 97.43L50.76 97L51.43 96.67Z';
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

  /** The moon, the flat mark, at (x, y), `size` square: one scale on both axes, so never stretched. */
  function mark(ctx, x, y, size, color) {
    ctx.save();
    ctx.translate(x, y);
    const k = size / 120;
    ctx.scale(k, k);
    ctx.fillStyle = color;
    ctx.fill(new Path2D(MARK), 'evenodd');
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
    // on the right. No VERDICT any more: the moon signs the bottom row,
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

    /**
     * The grade's number out of 100 in its tone, its name and "/100" beside
     * it: one score, no letter (9.1). The colour is never the only signal.
     */
    const gradeBlock = (base, px) => {
      const score = clean(String(v.score));
      const npx = px * 0.82;
      // The number's ink on the left margin, where the standout under it starts.
      const at = t.sans(score, 0, base, npx, 600, null, F.display);
      const x = pad + at.left;
      t.sans(score, x, base, npx, 600, P.tone(toneOf(v)), F.display);
      const nx = x + at.width + npx * 0.08;
      t.mono('/100', nx, base, 10, P.ink3);
      t.mono(v.provisional ? 'Grade, provisional' : 'Grade', nx, base - 16, 10, P.ink2);
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
    // The bottom row: the moon and the address as typed, the date on the
    // right. The moon's disc starts 10 of its 120 in, so the mark is drawn
    // that much left to stand on the margin the letter shares.
    mark(ctx, pad - 11 * (10 / 120), H - 32 - 9.5, 11, P.ink2);
    t.mono('occlara.app', pad + 16, H - 32, 10, P.ink3, 'left', true);
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
