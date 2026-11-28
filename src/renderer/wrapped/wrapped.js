/**
 * OCCLARA WRAPPED, THE PAGE (docs/claude/wrapped.md): the year's story, slide
 * by slide, over the whole window.
 *
 * Main builds every number (src/shared/wrapped.js, WRAPPED_GET) and this page
 * words and draws them: nothing here counts the year. Every string reaches
 * the page as text (textContent), never as HTML, and the only pictures are
 * the bundled files the preload names. Main answers null mid match or sealed,
 * and the seal closes this view outright, so nothing of it plays in a match.
 *
 * THE CONTROLS: a click on the right of the window or Space, Enter, the right
 * arrow or Page Down go on; a click on the left, the left arrow, Page Up or
 * Backspace go back; P or K pause, M mutes, R replays, Escape closes, and the
 * three buttons at the top right say the same. Each slide moves on by itself
 * after its time, shown on the strip at the top, except the last. Hidden,
 * minimised or out of focus for long, it pauses (PUSH_WRAPPED).
 *
 * LESS MOTION (prefers-reduced-motion): every slide arrives whole with
 * nothing moving, the ground is one still frame, no number counts, a clip
 * waits for a press, and each slide stays half as long again.
 */
(function () {
  'use strict';

  const api = window.occlaraWrapped;
  const $ = (id) => document.getElementById(id);
  const root = $('wr');
  const stage = $('wr-stage');
  const reduced = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  if (reduced) root.classList.add('reduced');

  // ── Small builders: text only, never HTML ────────────────────────────────
  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined && text !== null) e.textContent = String(text);
    return e;
  }
  /** A line that lifts out of its own mask, `d` ms after the slide arrives. */
  function line(tag, cls, text, d, grad) {
    const outer = el(tag, `ln ${cls || ''}`.trim());
    const inner = el('span', grad ? 'grad grad-in' : '', text);
    outer.style.setProperty('--d', `${d || 0}ms`);
    outer.append(inner);
    inner.style.setProperty('--d', `${d || 0}ms`);
    return outer;
  }
  const at = (e, d) => { e.style.setProperty('--d', `${d || 0}ms`); return e; };
  const up = (e, d) => { e.classList.add('up'); return at(e, d); };
  const pop = (e, d) => { e.classList.add('pop'); return at(e, d); };
  /** A number that counts up from 0 to `n` once its slide arrives. */
  function count(n, cls, d, suffix) {
    const e = el('span', `num ${cls || ''}`.trim());
    const val = Number(n);
    const whole = `${Number.isFinite(val) ? fmt(val) : String(n)}${suffix || ''}`;
    e.textContent = whole;
    if (Number.isFinite(val) && !reduced && val > 1) {
      e.dataset.to = String(val);
      e.dataset.d = String(d || 0);
      e.dataset.suffix = suffix || '';
    }
    return e;
  }
  const fmt = (v) => (Number.isInteger(v) ? v.toLocaleString('en-GB') : (Math.round(v * 10) / 10).toLocaleString('en-GB'));
  const plural = (n, one, many) => `${fmt(n)} ${n === 1 ? one : (many || `${one}s`)}`;
  const clean = (s) => (typeof s === 'string' && !s.includes('#') ? s : '');
  function img(src, alt, cls) {
    if (typeof src !== 'string' || !/^\.\.\/\.\.\/\.\.\/assets\/[A-Za-z0-9/_.-]+\.(png|jpg)$/.test(src)) return null;
    const i = el('img', cls);
    i.alt = clean(alt);
    i.decoding = 'async';
    i.src = src;
    i.addEventListener('error', () => i.remove());
    return i;
  }
  function orb(src, alt, small) {
    const o = el('div', small ? 'orb sm' : 'orb');
    const face = el('div', 'face');
    const i = img(src, alt);
    if (i) face.append(i);
    o.append(face);
    return o;
  }
  function stat(n, label, d, opts) {
    const s = el('div', 'stat');
    const o = opts || {};
    const nEl = typeof n === 'number' ? count(n, 'stat-n', d, o.suffix) : el('span', 'stat-n', n);
    if (o.grad) nEl.classList.add('grad');
    s.append(nEl, el('span', 'stat-l', label));
    return up(s, d);
  }
  const svgNS = 'http://www.w3.org/2000/svg';
  const svg = (tag, attrs) => { const e = document.createElementNS(svgNS, tag); for (const [k, v] of Object.entries(attrs || {})) e.setAttribute(k, String(v)); return e; };

  // ── The palettes: the ground's three colours and the type's three ─────────
  const LOOK = {
    open:       { ground: ['#3B1E8F', '#8A1F5C', '#0E4C7A'], accent: ['#C4B5FD', '#F9A8D4', '#67E8F9'], energy: 0.9 },
    time:       { ground: ['#0B5E7A', '#1D3E9E', '#13A3B8'], accent: ['#A5F3FC', '#93C5FD', '#C4B5FD'], energy: 0.6 },
    mains:      { ground: ['#6A1B9A', '#B8326B', '#2B5DB8'], accent: ['#F0ABFC', '#FDA4AF', '#93C5FD'], energy: 0.7 },
    grades:     { ground: ['#0E6B5C', '#3E7E1E', '#1B6FA8'], accent: ['#BEF264', '#5EEAD4', '#93C5FD'], energy: 0.6 },
    best:       { ground: ['#8A4A06', '#A3261C', '#5E2A9E'], accent: ['#FDE68A', '#FDBA74', '#F9A8D4'], energy: 1.0 },
    highlights: { ground: ['#A0124F', '#5C1FA8', '#C2410C'], accent: ['#FDA4AF', '#D8B4FE', '#FDBA74'], energy: 1.2 },
    mistakes:   { ground: ['#14507A', '#3D2A8F', '#0F766E'], accent: ['#99F6E4', '#A5B4FC', '#BAE6FD'], energy: 0.45 },
    fights:     { ground: ['#8F1D1D', '#7C2D92', '#B45309'], accent: ['#FCA5A5', '#F0ABFC', '#FCD34D'], energy: 0.9 },
    title:      { ground: ['#5B21B6', '#BE185D', '#0E7490'], accent: ['#DDD6FE', '#FBCFE8', '#A5F3FC'], energy: 1.3 },
    rank:       { ground: ['#065F46', '#155E75', '#4338CA'], accent: ['#6EE7B7', '#7DD3FC', '#C7D2FE'], energy: 0.7 },
    lol:        { ground: ['#6B5214', '#0E5C66', '#1E3A8A'], accent: ['#F3E3B3', '#7FE3DA', '#A5C8FF'], energy: 0.7 },
    summary:    { ground: ['#4C1D95', '#9D174D', '#0E7490'], accent: ['#DDD6FE', '#FBCFE8', '#A5F3FC'], energy: 0.8 },
  };
  // How long each slide stays, in ms, before it moves on by itself (0: never).
  const STAY = { open: 6000, time: 8000, mains: 8000, grades: 8500, best: 9000, highlights: 9000, mistakes: 9000, fights: 8500, title: 8000, rank: 7000, lol: 7500, summary: 0 };

  // ── The state ────────────────────────────────────────────────────────────
  let data = null;
  let slides = [];
  let index = -1;
  let current = null;       // the slide on screen: { kind, node }
  let fillAnim = null;      // the strip's fill of the slide on screen, which moves it on
  let paused = false;
  let gl = null;
  let closing = false;
  let hintTimer = 0;

  const art = () => (data && data.art) || { agents: {}, maps: {}, guns: {}, champions: {} };
  const agentSrc = (n) => (n && art().agents[n]) || null;
  const mapSrc = (n) => (n && art().maps[n]) || null;

  // ── The slides ───────────────────────────────────────────────────────────
  const BUILD = {
    open(s) {
      const n = el('section', 'sl');
      const moon = el('div', 'moon');
      const m = svg('svg', { viewBox: '0 0 120 120', 'aria-hidden': 'true' });
      const defs = svg('defs');
      const lg = svg('linearGradient', { id: 'mg', x1: '0', y1: '0', x2: '1', y2: '1' });
      lg.append(svg('stop', { offset: '0', 'stop-color': '#FFFFFF' }), svg('stop', { offset: '0.5', 'stop-color': LOOK.open.accent[0] }), svg('stop', { offset: '1', 'stop-color': LOOK.open.accent[1] }));
      defs.append(lg);
      const g = svg('g', { class: 'm-spin' });
      const D = 'M10 60a50 50 0 1 0 100 0a50 50 0 1 0 -100 0ZM49.86 25.85L47.71 26.13L46.57 26.44L45.57 26.83L45.29 26.83L41.57 28.69L40 29.24L39.14 29.33L38.29 29.22L37.43 28.96L36 28.36L35.29 28.24L34.57 28.32L33.71 28.57L32.57 29.02L31.71 29.44L30.57 30.23L29.15 31.43L27.14 33.55L23.97 38L22.14 41.09L21.43 42.51L20.73 44.14L19.29 47.92L18.86 49.25L18.56 51L18.14 54.86L18.1 56.29L18.23 57.71L18.86 60.87L19.14 61.77L19.57 62.62L21 64.28L22.56 66.86L23.4 68L24.14 68.66L26.14 70.01L26.71 70.21L27.14 70.19L29.57 69.25L30.29 68.72L31.06 67.71L31.56 66.86L31.88 66L32.54 62.43L32.76 60.29L32.91 59.86L33.14 59.57L33.43 59.43L33.86 59.38L36.14 59.77L37.43 59.74L38.14 59.62L39 59.27L40.14 58.54L40.86 57.97L41.46 57.29L41.9 56.57L42.22 55.86L42.43 55.14L42.52 54.43L42.54 53.43L42.41 51.86L41.68 48.43L41.73 48L41.93 47.71L42.57 47.38L46.14 46.24L47.43 45.91L51.14 45.38L52.29 45.06L53.43 44.6L54.43 44.07L55.43 43.44L57.14 42.07L58.34 40.86L59.2 39.57L59.76 38.29L60.46 36.14L60.75 35L60.85 34L60.76 33L60.46 31.86L59.88 30.29L59.36 29.29L58.71 28.51L57.86 27.84L56.35 27L54.72 26.29L53.71 26L52.71 25.84ZM69.43 32.85L68.07 33.29L66.71 34.09L65.9 34.86L65.61 35.29L65.33 35.86L64.78 37.71L64.69 38.29L64.69 38.86L64.99 40L65.9 41.86L66.71 43L67.86 44.05L68.86 44.7L69.86 45.18L72 45.85L73.43 46.18L74.57 46.21L76.43 45.91L76.86 45.99L76.94 46.14L76.91 46.43L76.7 46.86L76.2 47.57L75.99 47.71L75.66 48.14L75.06 49.14L74.1 51.86L72.71 54.99L72.43 55.86L72.05 58L72.03 59.14L72.4 60.57L73.05 62L73.46 62.57L74.11 63.29L74.59 63.71L75.14 64.08L77.43 64.99L78.14 65.12L78.71 65.11L79.57 64.94L80.57 64.52L83.43 62.69L84.29 62.39L86.29 61.85L88.71 60.59L89.14 60.51L89.43 60.6L89.65 60.86L89.82 61.29L89.93 61.86L89.96 62.43L89.85 63.14L89.43 64.54L89.32 65.14L89.29 68.14L89.15 69.14L89 69.53L88.86 69.59L88.71 69.51L88.12 68.71L87.71 68.29L87.14 67.91L86.57 67.64L86 67.51L85.43 67.52L84.57 67.64L84 67.84L83.29 68.35L82.65 69L82.26 69.57L81.99 70.14L81.66 71.14L81.54 71.86L81.56 72.86L81.72 73.57L82 74.1L82.45 74.71L82.73 75L83.14 75.25L83.71 75.42L84.29 75.48L85.38 75.29L86.43 74.77L87.18 74.14L88.09 72.86L89 71.11L89.14 70.93L89.29 70.92L89.71 71.3L91.14 72.88L92.14 73.65L92.71 73.85L93.29 73.86L93.86 73.7L94.43 73.41L95 73L95.71 72.34L96.37 71.57L96.97 70.71L97.95 68.86L98.24 68L98.44 67.14L98.97 63.29L99.01 62.29L98.96 61.29L98.75 60L98.45 59L98.01 58L97.37 56.86L96.86 56.13L96.29 55.53L95.86 55.3L95.43 55.19L94.57 55.2L93.43 55.36L92.71 55.61L91.57 56.26L91.29 56.3L91.14 56.22L90.94 55.86L90.79 55.29L90.06 50.71L89.88 50.57L89.61 49.71L89.14 48.86L88.57 48.14L87.69 47.29L86.29 46.21L85.71 45.86L84.86 45.55L83.71 45.39L81.43 45.37L79.43 45.25L78.71 45.15L78.41 45L78.29 44.71L78.33 44.29L79.01 41.29L78.96 40L78.57 38.43L78.11 37.14L77.54 36.14L76.86 35.28L76.14 34.58L75.36 34L74.57 33.57L73.57 33.17L72.57 32.92L71.43 32.76L70.43 32.74ZM95.14 41.57L94.43 41.68L93.71 42.04L93.29 42.43L92.99 43L92.75 44.14L92.69 45.43L92.81 46.43L93.15 47.57L93.69 48.86L94.26 49.86L94.91 50.71L95.71 51.5L96.43 51.98L97.29 52.3L98.14 52.36L99 52.22L99.43 51.93L99.77 51.43L100.06 50.71L100.24 49.86L100.27 49L100.16 48L99.94 47L99.63 46L99.22 45L98.71 44.04L98.14 43.21L97.57 42.59L97 42.11L96.43 41.77L95.86 41.62ZM33.15 44.57L33.43 44.46L33.86 44.48L34.57 44.89L35.16 45.43L35.49 45.86L35.65 46.29L35.63 46.57L35.44 47L35.09 47.43L33.24 49.14L32.57 49.86L32.02 50.71L31.43 52.08L31 52.54L30.71 52.62L30.43 52.46L30.29 52.22L30.12 51.43L30.14 50.57L30.47 49.43L30.98 48L31.66 46.43L32.43 45.25L32.86 44.78ZM40.57 63.27L40 63.5L38.98 64.14L38.57 64.45L38.29 64.8L38.12 65.14L37.97 65.71L37.75 67L37.7 67.71L37.84 68.71L38.1 69.71L39.19 72L39.83 73.71L40.04 74.57L40.31 76.43L40.5 77.14L40.93 78L41.32 78.57L42.43 79.77L43.57 80.71L44.29 81.17L45.29 81.58L48.43 82.38L49.14 82.48L49.71 82.48L52.71 82.02L53.71 81.73L54.43 81.31L55.31 80.43L56.48 78.86L56.89 78L57.08 77L57 76L56.66 74.86L55.58 72.43L54.98 71.43L54.43 70.86L53.86 70.49L51.75 69.71L49.71 68.49L48 67.87L47.43 67.56L46.85 67L45.13 64.57L44.57 64.01L44 63.6L43.43 63.34L42.86 63.21L41.29 63.18ZM32.57 74.26L32 74.46L31.35 75L30.93 75.57L30.75 76.14L30.66 77L30.74 77.86L31.01 78.71L31.43 79.63L31.96 80.43L32.52 81L33.29 81.56L34.14 82L34.71 82.18L35.29 82.22L35.86 82.13L36.71 81.86L37.07 81.57L37.71 80.83L37.97 80.43L38.11 80L38.11 79.29L37.96 78.29L37.75 77.57L37.48 77L37.03 76.29L36.53 75.71L36 75.28L35 74.67L34 74.26ZM66.14 76.85L65.29 76.99L64.39 77.29L63.57 77.73L62.86 78.28L62.33 78.86L61.87 79.57L61.58 80.29L61.41 81.14L61.44 82L61.62 82.71L61.97 83.43L62.43 84.02L63 84.52L63.71 84.95L64.57 85.26L65.43 85.4L66.43 85.39L67.43 85.19L68.43 84.78L69.2 84.29L69.96 83.57L70.46 82.86L70.84 82L71.01 81.14L70.99 80.29L70.77 79.43L70.29 78.57L69.71 77.96L69 77.45L68.14 77.08L67.14 76.87ZM66.56 78.43L67.29 78.44L68 78.6L68.61 78.86L69.21 79.29L69.7 79.86L69.98 80.43L70.12 81L70.12 81.71L69.94 82.43L69.65 83L69.2 83.57L68.7 84L68 84.4L67.29 84.65L66.57 84.76L65.86 84.74L65.29 84.63L64.71 84.41L64.14 84.06L63.71 83.66L63.43 83.28L63.16 82.71L63.04 82.14L63.03 81.57L63.14 81L63.37 80.43L63.71 79.9L64.16 79.43L64.71 79.02L65.29 78.73L65.86 78.54ZM52.29 87.84L51.43 88.05L50.64 88.43L50 88.99L49.63 89.57L49.45 90.29L49.51 91L49.8 91.71L50.22 92.29L50.86 92.87L51.71 93.38L52.57 93.71L53.57 93.91L54.57 93.93L55.57 93.76L56.41 93.43L57.02 93L57.41 92.57L57.65 92.14L57.83 91.29L57.76 90.71L57.61 90.29L57.05 89.43L56.14 88.66L55.57 88.34L54.86 88.06L53.57 87.8ZM52.67 89L53.57 88.92L54.57 89.06L55.52 89.43L56.3 90L56.82 90.71L57 91.43L56.87 92.14L56.47 92.71L56 93.07L55.43 93.31L54.86 93.44L54.14 93.47L53.43 93.38L52.71 93.17L52.1 92.86L51.54 92.43L51.17 92L50.88 91.43L50.8 90.86L50.86 90.43L51.06 90L51.44 89.57L52 89.22ZM74.14 90.56L73.14 90.86L72.29 91.3L71.54 91.86L70.91 92.57L70.57 93.29L70.5 93.86L70.66 94.43L71.14 94.95L71.71 95.23L72.43 95.36L73.29 95.34L74.14 95.16L75 94.84L75.73 94.43L76.44 93.86L76.93 93.29L77.28 92.57L77.36 92L77.22 91.43L76.89 91L76.43 90.7L75.71 90.49L75 90.45ZM74.2 91.43L74.86 91.34L75.43 91.36L75.86 91.47L76.28 91.71L76.52 92L76.66 92.43L76.61 92.86L76.43 93.29L76.11 93.71L75.64 94.14L75 94.53L74.43 94.77L73.71 94.94L73.14 94.97L72.57 94.89L72.14 94.71L71.8 94.43L71.6 94L71.6 93.57L71.83 93L72.29 92.43L72.84 92L73.43 91.68ZM51.71 95.28L50.43 95.54L49.36 96L48.66 96.57L48.46 96.86L48.28 97.29L48.27 98L48.42 98.43L48.67 98.86L49.35 99.57L50.43 100.28L51.71 100.83L53.14 101.22L54.57 101.42L56 101.43L57.29 101.26L58.43 100.9L59.29 100.4L59.57 100.13L59.86 99.71L60.01 99.29L60.03 98.86L59.94 98.43L59.74 98L59.42 97.57L58.99 97.14L57.94 96.43L56.57 95.83L55 95.41L53.29 95.22ZM52.41 96.43L53.57 96.35L54.86 96.47L56 96.75L57.14 97.22L58 97.8L58.55 98.43L58.73 98.86L58.76 99.14L58.62 99.71L58.27 100.14L57.57 100.57L56.71 100.83L55.86 100.95L54.86 100.95L53.71 100.81L52.71 100.55L51.71 100.14L51 99.69L50.42 99.14L50.1 98.57L50.04 98L50.29 97.43L50.76 97L51.43 96.67Z';
      g.append(svg('path', { d: D, 'fill-rule': 'evenodd', fill: 'url(#mg)', class: 'm-glow' }), svg('path', { d: D, 'fill-rule': 'evenodd', fill: 'url(#mg)' }));
      m.append(defs, g);
      moon.append(m);
      // The main agent, before the moon's upper right.
      // (A League only year: its champion, never an agent.)
      const face = s.game === 'lol' ? (s.champion && art().champions[s.champion]) : agentSrc(s.agent);
      if (face) moon.append(pop(orb(face, s.game === 'lol' ? s.champion : s.agent, false), 900));
      n.append(moon);
      const col = el('div', 'col');
      col.append(line('p', 'k', 'Occlara Wrapped', 100));
      col.append(line('h1', 'hero', String(data.year), 240, true));
      col.append(line('p', 'p', s.game === 'lol' ? 'Your year in League of Legends, reviewed.' : 'Your year, reviewed. Every match the coach saw, added up.', 520));
      col.append(up(el('p', 'note', `${plural(s.matches, 'match', 'matches')} this year. Let's look back.`), 760));
      n.append(col);
      return { node: n, land: 1 };
    },

    time(s) {
      const n = el('section', 'sl');
      n.append(line('p', 'k', 'Your year in time', 80));
      const hero = el('div', 'row');
      const big = el('h2', 'hero');
      big.append(count(s.matches, 'grad', 200));
      hero.append(up(big, 160));
      const side = el('div');
      side.append(line('p', 'h3', s.matches === 1 ? 'match reviewed' : 'matches reviewed', 320));
      side.append(line('p', 'p', s.hours ? `That is ${s.estimated ? 'about ' : ''}${fmt(s.hours)} hours of play, on ${plural(s.days, 'day')}.` : `On ${plural(s.days, 'day')}.`, 460));
      hero.append(side);
      n.append(hero);
      const months = el('div', 'months');
      const max = Math.max(1, ...s.months);
      const top = s.busiestMonth ? s.busiestMonth.month : -1;
      s.months.forEach((c, i) => {
        const mo = el('div', i === top ? 'mo top' : 'mo');
        const b = el('b');
        b.style.height = `${Math.max(2, (c / max) * 100)}%`;
        at(b, 600 + i * 55);
        b.title = `${c} in ${['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'][i]}`;
        mo.append(b, el('span', '', 'JFMAMJJASOND'[i]));
        months.append(mo);
      });
      n.append(months);
      const bits = [];
      if (s.busiestMonth) bits.push(`${s.busiestMonth.name} was your busiest month, with ${plural(s.busiestMonth.matches, 'match', 'matches')}.`);
      if (s.busiestDay) bits.push(`Your biggest day: ${s.busiestDay.text}, ${plural(s.busiestDay.matches, 'match', 'matches')}.`);
      if (bits.length) n.append(up(el('p', 'note', bits.join(' ')), 1300));
      if (s.estimated) n.append(up(el('p', 'note', `${s.estimated === 1 ? '1 match was timed by its rounds' : `${fmt(s.estimated)} matches were timed by their rounds`}, about 100 seconds a round.`), 1400));
      return { node: n, land: 2 };
    },

    mains(s) {
      const n = el('section', 'sl');
      if (s.map && mapSrc(s.map.name)) setArt(mapSrc(s.map.name), false);
      const grid = el('div', 'split');
      const left = el('div');
      left.append(line('p', 'k', 'Your main', 80));
      if (s.agent) {
        const r = el('div', 'row');
        r.style.alignItems = 'center';
        r.append(pop(orb(agentSrc(s.agent.name), s.agent.name), 200));
        const t = el('div');
        t.append(line('h2', 'hero', s.agent.name, 320, true));
        t.append(line('p', 'p', `${plural(s.agent.matches, 'match', 'matches')}${s.agent.winRate !== null ? `, ${s.agent.winRate}% won` : ''}.`, 480));
        r.append(t);
        left.append(r);
      }
      const right = el('div');
      if (s.agents.length > 1) {
        right.append(line('p', 'k', 'Most played', 600));
        const list = el('div', 'list3');
        const max = s.agents[0].matches;
        s.agents.forEach((a, i) => {
          const li = up(el('div', 'li'), 700 + i * 120);
          li.append(orb(agentSrc(a.name), a.name, true));
          const mid = el('div');
          mid.append(el('div', 'li-name', a.name));
          const bar = el('div', 'li-bar');
          const fill = at(el('i'), 800 + i * 120);
          fill.style.setProperty('--w', String(a.matches / max));
          bar.append(fill);
          mid.append(bar);
          li.append(mid, el('span', 'li-n', String(a.matches)));
          list.append(li);
        });
        right.append(list);
      }
      if (s.map) {
        const m = up(el('div'), 1100);
        m.style.marginTop = 'clamp(22px, 4vmin, 44px)';
        m.append(el('p', 'k', 'Your map'));
        m.append(el('p', 'h3', s.map.name));
        m.append(el('p', 'note', `${plural(s.map.matches, 'match', 'matches')}${s.map.winRate !== null ? `, ${s.map.winRate}% won` : ''}.`));
        right.append(m);
      }
      grid.append(left, right);
      n.append(grid);
      return { node: n, land: 3 };
    },

    grades(s) {
      const n = el('section', 'sl');
      n.append(line('p', 'k', 'Your grade, out of 100', 80));
      const r = el('div', 'row');
      r.style.alignItems = 'center';
      if (s.climb && s.climb.by >= 0) {
        const h = el('h2', 'hero md');
        h.append(count(s.climb.from, '', 160), document.createTextNode(' → '), count(s.climb.to, 'grad', 420));
        r.append(up(h, 160));
        const t = el('div');
        t.append(line('p', 'h3', s.climb.by > 0 ? `Up ${s.climb.by} points` : s.climb.by < 0 ? `Down ${-s.climb.by} points` : 'Level all year', 520));
        t.append(line('p', 'p', `Your first ${s.climb.each} graded matches against your last ${s.climb.each}.`, 640));
        r.append(t);
      } else {
        const h = el('h2', 'hero md');
        h.append(count(s.avg, 'grad', 160));
        r.append(up(h, 160));
        const t = el('div');
        t.append(line('p', 'h3', 'your average grade', 400));
        // A year that ended lower is said plainly, as numbers, under the average.
        t.append(line('p', 'p', s.climb
          ? `Your first ${s.climb.each} graded matches averaged ${s.climb.from}, your last ${s.climb.each} ${s.climb.to}.`
          : `Over ${plural(s.count, 'graded match', 'graded matches')}.`, 520));
        r.append(t);
      }
      n.append(r);
      n.append(chart(s));
      const foot = el('div', 'letters');
      for (const L of ['S', 'A', 'B', 'C', 'D', 'F']) {
        if (!s.letters[L]) continue;
        const c = el('span', 'chip');
        c.append(el('b', '', L), document.createTextNode(` ${s.letters[L]}`));
        foot.append(c);
      }
      if (s.bestMonth) {
        const c = el('span', 'chip');
        c.append(document.createTextNode('Best month '), el('b', '', `${s.bestMonth.name}, ${s.bestMonth.avg}`));
        foot.append(c);
      }
      n.append(up(foot, 1700));
      if (s.small) n.append(up(el('p', 'note', `A small sample: ${plural(s.count, 'graded match', 'graded matches')} so far.`), 1800));
      return { node: n, land: 4 };
    },

    best(s) {
      const n = el('section', 'sl');
      if (mapSrc(s.map)) setArt(mapSrc(s.map), true);
      const grid = el('div', 'split');
      const left = el('div');
      left.append(line('p', 'k', 'Your match of the year', 80));
      const st = el('div', 'stamp');
      const L = pop(el('span', 'letter grad', s.grade.letter || ''), 260);
      st.append(L);
      const sc = el('div', 'score100');
      sc.append(count(s.grade.score, '', 420), el('small', '', 'of 100'));
      st.append(up(sc, 420));
      left.append(st);
      const words = [s.map, s.agent].filter(Boolean).join(', ');
      if (words) left.append(line('p', 'h3', words, 600));
      const facts = [];
      if (Number.isFinite(s.team) && Number.isFinite(s.enemy)) facts.push(`${s.team} : ${s.enemy}${s.result === 'win' ? ', won' : s.result === 'loss' ? ', lost' : ''}`);
      if (Number.isFinite(s.k) && Number.isFinite(s.d)) facts.push(`${s.k} kills, ${s.d} deaths${Number.isFinite(s.a) ? `, ${s.a} assists` : ''}`);
      if (facts.length) left.append(line('p', 'p', facts.join('. ') + '.', 740));
      left.append(up(el('p', 'note', `${s.day}${s.mode ? `, ${s.mode}` : ''}.`), 880));
      grid.append(left);
      const right = el('div');
      const c = clipEl(s.clip, s.clip ? s.clip.title : '', 700);
      if (c) right.append(c);
      else if (s.agent && agentSrc(s.agent)) right.append(pop(orb(agentSrc(s.agent), s.agent), 600));
      grid.append(right);
      n.append(grid);
      return { node: n, land: 5, video: !!c };
    },

    highlights(s) {
      const n = el('section', 'sl');
      const grid = el('div', s.clip ? 'split' : '');
      const left = el('div');
      left.append(line('p', 'k', 'Your highlights', 80));
      const lead = s.aces ? { n: s.aces, w: s.aces === 1 ? 'ace' : 'aces' } : s.fourK ? { n: s.fourK, w: s.fourK === 1 ? '4K' : '4Ks' } : { n: s.threeK + s.clutches, w: s.threeK + s.clutches === 1 ? 'big round' : 'big rounds' };
      const h = el('h2', 'hero');
      h.append(count(lead.n, 'grad', 200));
      left.append(up(h, 160));
      left.append(line('p', 'h3', lead.w, 380));
      const q = el('div', 'quad');
      const four = [[s.threeK, s.threeK === 1 ? '3K round' : '3K rounds'], [s.fourK, s.fourK === 1 ? '4K round' : '4K rounds'], [s.aces, s.aces === 1 ? 'ace' : 'aces'], [s.clutches, s.clutches === 1 ? 'clutch won' : 'clutches won']];
      four.forEach(([v, l], i) => {
        const cell = el('div', i === 0 && !s.aces ? 'q lead' : i === 2 && s.aces ? 'q lead' : 'q');
        cell.append(count(v, 'stat-n', 600 + i * 120), el('span', 'stat-l', l));
        q.append(up(cell, 560 + i * 120));
      });
      left.append(q);
      const bits = [];
      if (s.clutchBest >= 2) bits.push(`Your biggest clutch was a 1v${s.clutchBest}.`);
      if (s.twoK) bits.push(`And ${fmt(s.twoK)} more rounds with two kills.`);
      if (bits.length) left.append(up(el('p', 'note', bits.join(' ')), 1200));
      left.append(up(el('p', 'note', `Counted off Riot's record of ${plural(s.riotMatches, 'match', 'matches')}.`), 1300));
      grid.append(left);
      const c = clipEl(s.clip, s.clip ? `${s.clip.title}${s.clip.map ? ` on ${s.clip.map}` : ''}` : '', 800);
      if (c) { const right = el('div'); right.append(c); grid.append(right); }
      n.append(grid);
      return { node: n, land: 0, video: !!c };
    },

    mistakes(s) {
      const n = el('section', 'sl');
      n.append(line('p', 'k', 'What you worked on', 80));
      n.append(line('h2', 'h2', s.beaten ? 'A habit you broke.' : 'One to take into next year.', 200, true));
      const duel = el('div', 'duel');
      const side = (m, kicker, d, beaten) => {
        const c = up(el('div', 'side'), d);
        c.append(el('p', 'k', kicker), el('p', 'h3', m.title || 'A repeated mistake'));
        const bars = el('div', 'bars2');
        const row = (label, v, cls, dd) => {
          const b = el('div', `bar2 ${cls}`);
          const tr = el('div', 'tr');
          const fill = at(el('i'), dd);
          fill.style.setProperty('--w', String(Math.max(0.02, v / m.side)));
          tr.append(fill);
          b.append(el('span', '', label), tr, el('b', '', `${v} of ${m.side}`));
          return b;
        };
        bars.append(row('Early on', m.early, 'early', d + 200), row('Lately', m.late, 'late', d + 360));
        c.append(bars);
        const pctE = Math.round((100 * m.early) / m.side);
        const pctL = Math.round((100 * m.late) / m.side);
        c.append(el('p', 'verdict', beaten ? `From ${pctE}% of your matches to ${pctL}%.` : `Still in ${pctL}% of your recent matches.`));
        return c;
      };
      if (s.beaten) duel.append(side(s.beaten, 'The one you beat', 420, true));
      if (s.still) duel.append(side(s.still, 'Still to beat', 640, false));
      n.append(duel);
      n.append(up(el('p', 'note', `Your ${s.recorded} recorded matches, the first ${s.side} against the last ${s.side}.`), 1300));
      return { node: n, land: 1 };
    },

    fights(s) {
      const n = el('section', 'sl');
      n.append(line('p', 'k', 'Your fights', 80));
      n.append(line('h2', 'h2', 'How the duels went.', 200, true));
      const g = el('div', 'grid4');
      let d = 420;
      const cell = (tile, num, label, extra) => {
        const c = up(el('div', 'cell'), d);
        c.append(tile);
        const t = el('div');
        t.append(typeof num === 'number' ? count(num, 'stat-n', d + 100) : el('span', 'stat-n', num), el('span', 'stat-l', label));
        if (extra) t.append(el('p', 'note', extra));
        c.append(t);
        g.append(c);
        d += 160;
      };
      const tile = (src, alt, glyph) => {
        const t = el('div', 'icon-tile');
        const i = img(src, alt);
        if (i) t.append(i); else t.append(el('span', 'glyph', glyph || ''));
        return t;
      };
      if (s.gun) cell(tile(art().guns[s.gun.name], s.gun.name, s.gun.name.slice(0, 1)), s.gun.name, `${fmt(s.gun.kills)} kills with it, ${s.gun.share}% of the gun kills Riot recorded`);
      if (s.nemesis) {
        const o = orb(agentSrc(s.nemesis.agent), s.nemesis.agent, true);
        cell(o, s.nemesis.agent, `got you ${plural(s.nemesis.times, 'time')}, more than any other agent`);
      }
      if (s.first) cell(tile(null, '', '1st'), s.first.fk, `first kills, in ${s.first.fkRate}% of your rounds`, `First to die in ${s.first.fdRate}% (${fmt(s.first.fd)}).`);
      if (s.streak) cell(tile(null, '', 'W'), s.streak, 'wins in a row, your longest run');
      n.append(g);
      return { node: n, land: 2 };
    },

    title(s) {
      const n = el('section', 'sl center');
      n.append(el('div', 'halo'));
      n.append(line('p', 'k', `Your ${data.year} title`, 120));
      n.append(line('h2', 'title-name', s.name, 320, true));
      n.append(line('p', 'p', s.line, 700));
      const st = el('div', 'stats');
      (s.facts || []).slice(0, 2).forEach((f, i) => st.append(stat(f.n, f.label, 1000 + i * 160, { grad: i === 0 })));
      n.append(st);
      return { node: n, land: 'rise' };
    },

    rank(s) {
      const n = el('section', 'sl');
      n.append(line('p', 'k', 'Your rank, as far as Riot told us', 80));
      const c = el('div', 'climb');
      c.append(up(el('p', 'h2', s.first), 200));
      const a = svg('svg', { class: 'arrow', viewBox: '0 0 120 60', 'aria-hidden': 'true' });
      a.append(svg('path', { d: 'M6 30 H108 M86 10 L108 30 L86 50' }));
      at(a.querySelector('path'), 420);
      c.append(a);
      const last = el('p', 'h2');
      last.append(el('span', 'grad', s.last));
      c.append(up(last, 560));
      n.append(c);
      const words = s.moved > 0 ? `Up ${plural(s.moved, 'division')} over the year.` : s.moved < 0 ? `Down ${plural(-s.moved, 'division')} over the year.` : 'Where you started, held all year.';
      n.append(line('p', 'p', words, 780));
      // The divisions from where the year started to where it ended, lit as climbed.
      const ladder = rankLadder(s.first, s.last, s.peak);
      if (ladder) n.append(up(ladder, 860));
      const chips = el('div', 'letters');
      const peak = el('span', 'chip');
      peak.append(document.createTextNode('Peak '), el('b', '', s.peak));
      chips.append(peak);
      n.append(up(chips, 900));
      n.append(up(el('p', 'note', `From the ${plural(s.games, 'rated match', 'rated matches')} whose rank this PC knows.`), 1000));
      return { node: n, land: 3 };
    },

    lol(s) {
      const n = el('section', 'sl');
      const grid = el('div', 'split');
      const left = el('div');
      left.append(line('p', 'k', 'And on the Rift', 80));
      left.append(line('h2', 'h2', 'League of Legends', 200, true));
      const st = el('div', 'stats');
      st.append(stat(s.time.matches, s.time.matches === 1 ? 'League match' : 'League matches', 420));
      if (s.time.hours) st.append(stat(s.time.hours, 'hours', 560));
      if (s.winRate !== null) st.append(stat(`${s.winRate}%`, 'won', 700));
      if (s.avgGrade !== null) st.append(stat(s.avgGrade, 'average grade', 840));
      left.append(st);
      if (s.best) left.append(up(el('p', 'note', `Your best League game: ${s.best.grade.score} of 100${s.best.champion ? ` on ${s.best.champion}` : ''}, ${s.best.day}.`), 1000));
      grid.append(left);
      if (s.champion) {
        const right = el('div');
        const src = art().champions[s.champion.name];
        right.append(pop(orb(src, s.champion.name), 500));
        const cap = up(el('p', 'h3', s.champion.name), 700);
        cap.style.marginTop = '24px';
        right.append(cap, up(el('p', 'note', `Your most played champion, ${plural(s.champion.matches, 'match', 'matches')}.`), 800));
        grid.append(right);
      }
      n.append(grid);
      return { node: n, land: 4 };
    },

    summary(s) {
      const n = el('section', 'sl');
      const grid = el('div', 'sum');
      const card = pop(el('div', 'sum-card'), 200);
      grid.append(card);
      const right = el('div');
      right.append(line('p', 'k', 'That was your year', 80));
      right.append(line('h2', 'h2', s.title ? s.title.name : `${data.year}, reviewed`, 200, true));
      const bye = line('p', 'p', 'Save it, share it, and see you in the next one.', 400);
      bye.style.maxWidth = '40ch';
      right.append(bye);
      const acts = up(el('div', 'actions'), 700);
      const said = el('p', 'said');
      said.setAttribute('role', 'status');
      const v = cardValue(s);
      const save = el('button', 'wr-cta primary', 'Save image');
      save.type = 'button';
      save.addEventListener('click', async (e) => { e.stopPropagation(); said.textContent = (await window.WrappedCard.save(v)) ? 'Saved. Windows asked where to keep it.' : 'The image could not be saved.'; });
      const copy = el('button', 'wr-cta', 'Copy image');
      copy.type = 'button';
      copy.addEventListener('click', async (e) => { e.stopPropagation(); said.textContent = (await window.WrappedCard.copy(v)) ? 'Copied. Paste it anywhere.' : 'The image could not be copied.'; });
      const again = el('button', 'wr-cta', 'Replay');
      again.type = 'button';
      again.addEventListener('click', (e) => { e.stopPropagation(); go(0); });
      const shut = el('button', 'wr-cta', 'Close');
      shut.type = 'button';
      shut.addEventListener('click', (e) => { e.stopPropagation(); close(); });
      acts.append(save, copy, again, shut);
      right.append(acts, said);
      right.append(up(el('p', 'note', 'Made on this PC. Nothing was uploaded.'), 900));
      grid.append(right);
      n.append(grid);
      window.WrappedCard.render(v).then((cv) => {
        const i = el('img');
        i.alt = `Your ${data.year} in Occlara`;
        i.src = cv.toDataURL('image/png');
        card.append(i);
      }).catch(() => card.remove());
      return { node: n, land: 'rise', focus: save };
    },
  };

  /** The divisions between where the year's rank started and ended, as steps: lit as climbed, the peak marked. */
  const LADDER = ['Iron', 'Bronze', 'Silver', 'Gold', 'Platinum', 'Diamond', 'Ascendant', 'Immortal', 'Radiant'];
  const tierAt = (t) => { const [nm, dv] = String(t || '').split(' '); const i = LADDER.indexOf(nm); return i < 0 ? -1 : i * 3 + ((Number(dv) || 1) - 1); };
  const tierName = (i) => (i >= 24 ? 'Radiant' : `${LADDER[Math.floor(i / 3)]} ${(i % 3) + 1}`);
  function rankLadder(first, last, peak) {
    const a = tierAt(first);
    const b = tierAt(last);
    const p = tierAt(peak);
    if (a < 0 || b < 0) return null;
    const lo = Math.max(0, Math.min(a, b) - 1);
    const hi = Math.min(24, Math.max(a, b, p) + 1);
    if (hi - lo > 10) return null;
    const row = el('div', 'ladder');
    for (let i = lo; i <= hi; i++) {
      const lit = i >= Math.min(a, b) && i <= Math.max(a, b);
      const step = el('span', `step${lit ? ' lit' : ''}${i === b ? ' now' : ''}${i === p ? ' peak' : ''}`);
      at(step, 900 + (i - lo) * 80);
      step.append(el('i'), el('span', '', tierName(i)));
      row.append(step);
    }
    return row;
  }

  /** The closing card's values: the year, the title, the figures, the agent's icon. */
  function cardValue(s) {
    return {
      year: data.year, title: s.title, sample: !!data.sample,
      figures: (s.figures || []).map((f) => ({ n: typeof f.n === 'number' ? fmt(f.n) : clean(String(f.n)), label: clean(f.label) })),
      agentSrc: s.agent ? agentSrc(s.agent) : s.champion ? art().champions[s.champion] || null : null,
    };
  }

  /** A clip in its frame, or null when there is none to play. Muted, looping; a press under less motion. */
  function clipEl(clip, caption, d) {
    if (!clip || typeof clip.url !== 'string' || !/^occlara-clip:\/\/review\/[^/\s]+\/h\d{1,2}-clip\.mkv$/.test(clip.url)) return null;
    const box = el('div', 'clip');
    const v = el('video');
    v.muted = true;
    v.loop = true;
    v.playsInline = true;
    v.preload = 'auto';
    v.src = clip.url;
    v.addEventListener('error', () => box.remove());
    box.append(v);
    if (caption) box.append(el('span', 'clip-cap', caption));
    if (reduced) {
      const b = el('button', 'clip-play');
      b.type = 'button';
      b.setAttribute('aria-label', 'Play the clip');
      const s = svg('svg', { viewBox: '0 0 24 24', 'aria-hidden': 'true' });
      s.append(svg('path', { d: 'M8 5.2v13.6a.8.8 0 0 0 1.2.7l10.6-6.8a.8.8 0 0 0 0-1.4L9.2 4.5A.8.8 0 0 0 8 5.2z' }));
      b.append(s);
      b.addEventListener('click', (e) => { e.stopPropagation(); b.remove(); v.play().catch(() => {}); });
      box.append(b);
    }
    return pop(box, d);
  }

  /** The grade line: one point a month with counted grades, drawn on. */
  function chart(s) {
    const W = 1200;
    const H = 380;
    const pts = s.months.filter(Boolean);
    const lo = Math.max(0, Math.min(40, ...pts.map((m) => m.avg)) - 10);
    const hi = Math.min(100, Math.max(80, ...pts.map((m) => m.avg)) + 5);
    const x = (m) => 40 + (m / 11) * (W - 80);
    const y = (v) => H - 40 - ((v - lo) / (hi - lo)) * (H - 80);
    const root2 = svg('svg', { class: 'chart up', viewBox: `0 0 ${W} ${H}`, preserveAspectRatio: 'none', 'aria-hidden': 'true' });
    root2.style.setProperty('--d', '200ms');
    const defs = svg('defs');
    const lg = svg('linearGradient', { id: 'gl-g', x1: '0', y1: '0', x2: '1', y2: '0' });
    lg.append(svg('stop', { offset: '0', 'stop-color': '#FFFFFF' }), svg('stop', { offset: '0.5', 'stop-color': LOOK.grades.accent[0] }), svg('stop', { offset: '1', 'stop-color': LOOK.grades.accent[1] }));
    const ag = svg('linearGradient', { id: 'gl-a', x1: '0', y1: '0', x2: '0', y2: '1' });
    ag.append(svg('stop', { offset: '0', 'stop-color': LOOK.grades.accent[1], 'stop-opacity': '0.35' }), svg('stop', { offset: '1', 'stop-color': LOOK.grades.accent[1], 'stop-opacity': '0' }));
    defs.append(lg, ag);
    root2.append(defs);
    for (const v of [60, 70, 80, 90]) {
      if (v < lo || v > hi) continue;
      root2.append(svg('line', { class: 'gl-grid', x1: 40, x2: W - 40, y1: y(v), y2: y(v) }));
      const t = svg('text', { x: 0, y: y(v) + 5 });
      t.textContent = String(v);
      root2.append(t);
    }
    if (pts.length >= 2) {
      // A smooth line through the months (Catmull-Rom as cubic Beziers).
      const P = pts.map((m) => [x(m.month), y(m.avg)]);
      let d = `M${P[0][0]},${P[0][1]}`;
      for (let i = 0; i < P.length - 1; i++) {
        const p0 = P[i - 1] || P[i];
        const p1 = P[i];
        const p2 = P[i + 1];
        const p3 = P[i + 2] || p2;
        d += ` C${p1[0] + (p2[0] - p0[0]) / 6},${p1[1] + (p2[1] - p0[1]) / 6} ${p2[0] - (p3[0] - p1[0]) / 6},${p2[1] - (p3[1] - p1[1]) / 6} ${p2[0]},${p2[1]}`;
      }
      root2.append(svg('path', { class: 'gl-area', d: `${d} L${P[P.length - 1][0]},${H - 40} L${P[0][0]},${H - 40} Z`, fill: 'url(#gl-a)' }));
      const path = svg('path', { class: 'gl-line', d, stroke: 'url(#gl-g)' });
      root2.append(path);
      // Its length, for the draw, once it is in the page.
      requestAnimationFrame(() => { try { path.style.setProperty('--len', String(Math.ceil(path.getTotalLength()) + 2)); } catch (e) { /* drawn whole */ } });
      path.style.setProperty('--len', '4000');
    }
    pts.forEach((m, i) => {
      const best = s.bestMonth && s.bestMonth.month === m.month;
      const dot = svg('circle', { class: 'gl-dot', cx: x(m.month), cy: y(m.avg), r: best ? 9 : 6 });
      dot.style.setProperty('--d', `${700 + i * 110}ms`);
      root2.append(dot);
      if (best) root2.append(svg('circle', { class: 'gl-best', cx: x(m.month), cy: y(m.avg), r: 17 }));
    });
    for (let mth = 0; mth < 12; mth++) {
      const t = svg('text', { x: x(mth) - 5, y: H - 6 });
      t.textContent = 'JFMAMJJASOND'[mth];
      root2.append(t);
    }
    return root2;
  }

  // ── The map behind a slide ───────────────────────────────────────────────
  const artEl = $('wr-art');
  function setArt(src, full) {
    if (typeof src !== 'string' || !/^\.\.\/\.\.\/\.\.\/assets\/valorant\/maps\/[A-Za-z0-9]+\.jpg$/.test(src)) return;
    artEl.style.backgroundImage = `linear-gradient(90deg, rgba(5, 6, 10, 0.8) 0%, rgba(5, 6, 10, 0.38) 45%, rgba(5, 6, 10, 0.12) 100%), url("${src}")`;
    artEl.classList.toggle('full', !!full);
    artEl.classList.remove('on');
    void artEl.offsetWidth;
    artEl.classList.add('on');
  }
  const clearArt = () => artEl.classList.remove('on');

  // ── Counting, on screen only ─────────────────────────────────────────────
  let counting = [];
  let countRaf = 0;
  let countClock = 0;    // ms of counting, paused with the story
  let countLast = 0;
  function startCounts(node, after) {
    counting = [...node.querySelectorAll('[data-to]')].map((e) => ({ e, to: Number(e.dataset.to), d: (Number(e.dataset.d) || 0) + (after || 0), suffix: e.dataset.suffix || '', dec: !Number.isInteger(Number(e.dataset.to)) }));
    for (const c of counting) c.e.textContent = `0${c.suffix}`;
    countClock = 0;
    countLast = 0;
    cancelAnimationFrame(countRaf);
    if (counting.length) countRaf = requestAnimationFrame(tickCounts);
  }
  function tickCounts(now) {
    if (!counting.length) return;
    if (!paused) countClock += countLast ? Math.min(100, now - countLast) : 0;
    countLast = now;
    let left = 0;
    for (const c of counting) {
      const t = Math.max(0, Math.min(1, (countClock - c.d) / 1400));
      const k = t === 1 ? 1 : 1 - Math.pow(2, -10 * t);
      const v = c.to * k;
      c.e.textContent = `${c.dec ? (Math.round(v * 10) / 10).toLocaleString('en-GB') : Math.round(v).toLocaleString('en-GB')}${c.suffix}`;
      if (t < 1) left += 1;
    }
    if (left) countRaf = requestAnimationFrame(tickCounts);
    else counting = [];
  }

  // ── Moving through the story ─────────────────────────────────────────────
  const progress = $('wr-progress');
  function paintStrip() {
    progress.textContent = '';
    slides.forEach((s, i) => {
      const seg = el('span', i < index ? 'wr-seg done' : 'wr-seg');
      seg.append(el('i'));
      progress.append(seg);
    });
    progress.setAttribute('aria-valuenow', String(Math.round(((index + 1) / Math.max(1, slides.length)) * 100)));
    $('wr-count').textContent = `${String(index + 1).padStart(2, '0')} / ${String(slides.length).padStart(2, '0')}`;
  }

  function go(i, dir) {
    if (closing || !slides.length) return;
    const next = Math.max(0, Math.min(slides.length - 1, i));
    if (next === index && current) return;
    const back = dir === 'back' || next < index;
    const hadOld = !!current;
    index = next;
    const s = slides[index];
    const look = LOOK[s.kind] || LOOK.summary;
    root.dataset.slide = s.kind;
    for (const [k, v] of [['--a1', look.accent[0]], ['--a2', look.accent[1]], ['--a3', look.accent[2]]]) root.style.setProperty(k, v);
    if (gl) { gl.setPalette(look.ground, 1600); gl.setEnergy(look.energy); }
    clearArt();
    // The slide going: out with its motion, its clip stopped at once.
    if (current) {
      const old = current.node;
      for (const v of old.querySelectorAll('video')) { try { v.pause(); v.removeAttribute('src'); v.load(); } catch (e) { /* gone */ } }
      // Kept 'is-in', so its pieces stay where they arrived while the slide goes.
      old.classList.add('is-out');
      old.setAttribute('aria-hidden', 'true');
      setTimeout(() => old.remove(), reduced ? 220 : 460);
    }
    let built;
    try { built = BUILD[s.kind](s); } catch (e) { built = { node: el('section', 'sl') }; console.warn('[wrapped] slide', s.kind, e && e.message); }
    current = { kind: s.kind, node: built.node };
    built.node.dataset.kind = s.kind;
    if (back) built.node.classList.add('from-back');
    // After another slide, its pieces wait for the old one to be mostly gone.
    const turned = hadOld;
    if (turned) built.node.classList.add('turned');
    stage.append(built.node);
    void built.node.offsetWidth;
    built.node.classList.add('is-in');
    startCounts(built.node, turned && !reduced ? 240 : 0);
    if (built.video) {
      for (const v of built.node.querySelectorAll('video')) if (!reduced && !paused) v.play().catch(() => {});
    }
    // The sound of it.
    if (window.WrappedSound) {
      window.WrappedSound.turn(index === 0 ? 0.6 : 1);
      if (built.land === 'rise') setTimeout(() => window.WrappedSound.rise(), 500);
      else setTimeout(() => window.WrappedSound.land(built.land || 0), 380);
    }
    paintStrip();
    runStrip(s.kind);
    if (built.focus && s.kind === 'summary') setTimeout(() => { try { built.focus.focus({ preventScroll: true }); } catch (e) { /* */ } }, reduced ? 0 : 700);
  }

  /** The slide's own fill on the strip, which moves the story on as it ends. */
  function runStrip(kind) {
    if (fillAnim) { try { fillAnim.cancel(); } catch (e) { /* */ } fillAnim = null; }
    const segs = progress.children;
    const seg = segs[index];
    if (!seg) return;
    const bar = seg.firstChild;
    const ms = (STAY[kind] || 8000) * (reduced ? 1.5 : 1);
    if (!STAY[kind]) { bar.style.transform = 'scaleX(1)'; return; }
    fillAnim = bar.animate([{ transform: 'scaleX(0)' }, { transform: 'scaleX(1)' }], { duration: ms, easing: 'linear', fill: 'forwards' });
    if (paused) fillAnim.pause();
    const mine = fillAnim;
    fillAnim.onfinish = () => { if (fillAnim === mine && !paused && !closing) next(); };
  }

  function next() { if (index < slides.length - 1) go(index + 1, 'next'); }
  function back() { if (index > 0) go(index - 1, 'back'); else go(0); }

  function setPaused(on) {
    paused = !!on;
    root.classList.toggle('paused', paused);
    const b = $('wr-pause');
    b.setAttribute('aria-label', paused ? 'Play' : 'Pause');
    b.title = paused ? 'Play (P)' : 'Pause (P)';
    for (const a of document.getAnimations()) {
      // The strip's fill and every CSS motion stop where they are.
      try { if (paused) a.pause(); else if (a.playState === 'paused') a.play(); } catch (e) { /* finished */ }
    }
    for (const v of stage.querySelectorAll('video')) { try { if (paused) v.pause(); else if (!reduced) v.play().catch(() => {}); } catch (e) { /* */ } }
    if (gl) { if (paused) gl.stop(); else gl.start(); }
    if (window.WrappedSound) { if (paused) window.WrappedSound.pause(); else window.WrappedSound.resume(); }
  }

  function setMuted(on) {
    root.classList.toggle('muted', !!on);
    const b = $('wr-mute');
    b.setAttribute('aria-label', on ? 'Unmute' : 'Mute');
    b.title = on ? 'Unmute (M)' : 'Mute (M)';
    if (window.WrappedSound) window.WrappedSound.setMuted(!!on);
  }

  function close() {
    if (closing) return;
    closing = true;
    if (fillAnim) { try { fillAnim.cancel(); } catch (e) { /* */ } }
    if (window.WrappedSound) window.WrappedSound.stop();
    for (const v of document.querySelectorAll('video')) { try { v.pause(); } catch (e) { /* */ } }
    root.classList.add('closing');
    setTimeout(() => { try { api.close(); } catch (e) { /* main closes it anyway */ } }, reduced ? 0 : 240);
  }

  // ── Input ────────────────────────────────────────────────────────────────
  $('wr-next').addEventListener('click', () => next());
  $('wr-back').addEventListener('click', () => back());
  $('wr-pause').addEventListener('click', () => { autoPaused = false; setPaused(!paused); });
  $('wr-mute').addEventListener('click', () => setMuted(!root.classList.contains('muted')));
  $('wr-close').addEventListener('click', () => close());
  $('wr-empty-close').addEventListener('click', () => close());
  document.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.altKey || e.metaKey) return;
    const onButton = e.target && e.target.tagName === 'BUTTON' && !e.target.classList.contains('wr-zone');
    const k = e.key;
    if (k === 'Escape') { e.preventDefault(); close(); return; }
    if (root.dataset.state !== 'ready') return;
    if (k === 'ArrowRight' || k === 'PageDown' || (k === ' ' && !onButton) || (k === 'Enter' && !onButton)) { e.preventDefault(); next(); hideHint(); return; }
    if (k === 'ArrowLeft' || k === 'PageUp' || k === 'Backspace') { e.preventDefault(); back(); hideHint(); return; }
    if (k === 'p' || k === 'P' || k === 'k' || k === 'K') { e.preventDefault(); autoPaused = false; setPaused(!paused); return; }
    if (k === 'm' || k === 'M') { e.preventDefault(); setMuted(!root.classList.contains('muted')); return; }
    if (k === 'r' || k === 'R' || k === 'Home') { e.preventDefault(); go(0); return; }
    if (k === 'End') { e.preventDefault(); go(slides.length - 1); }
  });
  function hideHint() { $('wr-hint').classList.add('gone'); }
  // Hidden, minimised or out of focus (main's PUSH_WRAPPED, the document going
  // hidden): paused where it is, story and sound. The focus back resumes it,
  // but only when it was this that paused it, never a pause the player chose.
  let autoPaused = false;
  const autoPause = () => { if (closing || paused) return; autoPaused = true; setPaused(true); };
  const autoResume = () => { if (closing || !autoPaused) return; autoPaused = false; setPaused(false); };
  if (api && typeof api.onPause === 'function') api.onPause(autoPause);
  if (api && typeof api.onResume === 'function') api.onResume(autoResume);
  document.addEventListener('visibilitychange', () => { if (document.hidden) autoPause(); });

  function empty(text) {
    root.dataset.state = 'empty';
    $('wr-empty-text').textContent = text;
    $('wr-empty').hidden = false;
    $('wr-empty-close').focus();
  }

  // ── Begin ────────────────────────────────────────────────────────────────
  async function begin() {
    let got = null;
    try { got = api ? await api.get() : null; } catch (e) { got = null; }
    if (!got || !got.story) { empty('Wrapped is not available right now. It never opens during a match.'); return; }
    data = got;
    if (!got.story.enough || !Array.isArray(got.story.slides) || !got.story.slides.length) {
      empty(`Your ${got.year} Wrapped needs at least 5 reviewed matches of one game. Play a few more and come back.`);
      return;
    }
    slides = got.story.slides.filter((s) => s && BUILD[s.kind]);
    $('wr-sample').hidden = !got.sample;
    try { await document.fonts.ready; } catch (e) { /* draws in what there is */ }
    const canvas = $('wr-gl');
    gl = window.WrappedGL ? window.WrappedGL.create(canvas, { reduced, hz: Number(got.hz) || null, onFail: () => root.classList.add('no-gl') }) : null;
    if (!gl) root.classList.add('no-gl');
    else gl.start();
    if (window.WrappedSound) { window.WrappedSound.setMuted(got.sounds === false); window.WrappedSound.play(); }
    setMuted(got.sounds === false);
    root.dataset.state = 'ready';
    try { root.focus(); } catch (e) { /* */ }
    go(0);
    hintTimer = setTimeout(hideHint, 9000);
  }

  // For the checks and the pictures: where the story is and how it runs.
  window.__wrapped = {
    state: () => ({ ready: root.dataset.state === 'ready', index, kind: current ? current.kind : null, slides: slides.map((s) => s.kind), paused, muted: root.classList.contains('muted'), reduced, gl: gl ? gl.stats() : null, sound: window.WrappedSound ? window.WrappedSound.state() : null, closing }),
    go: (i) => go(i),
    pause: (on) => setPaused(on !== false),
    gl: () => gl,
  };
  root.tabIndex = -1;
  begin();
})();
