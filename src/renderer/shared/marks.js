/**
 * THE COACH'S PEN (8.8, "the coach's notebook"): the one thing only Occlara
 * draws. Hand drawn strokes over the page, the way a coach marks up a match
 * sheet: an underline under the fix, a circle or a bracket by the rounds that
 * prove it, an arrow at a note, a tick by a best, a strike through a cleared
 * habit. One to three on a screen, never on chrome, a button or the nav.
 *
 * Each kind has three or four variants, drawn by hand as paths in a unit box
 * and laid out at the size of what they mark, so a stroke is never stretched
 * and its width stays a pen's. Every variant wobbles, overshoots its end and
 * carries a second, lighter pass over part of its length, which is where the
 * uneven pressure comes from. The variant is picked from a hash of the text,
 * so the same note gets the same stroke every time it is drawn.
 *
 *   window.occlaraPen.mark(el, 'underline', { text: el.textContent, draw: false })
 *
 * DRAWN ONCE, AND NEVER MID MATCH. A mark is still by default. It draws itself
 * in (stroke-dashoffset over --t-pen on --ease-out) only when the caller asks
 * with draw: true, and only then if three things hold: the player has not
 * asked for less motion, main has said coaching is off (getState at load,
 * onState after, or setCoaching), and the page is a review revealing or a
 * page's first paint after a match, which is the caller's to know: review.js
 * runReveal, inside occlaraOnShown, is the only draw today, and test:marks
 * holds every draw: true in the renderer to the places it lists. Unknown
 * coaching counts as coaching: the mark is drawn still.
 *
 * Built with createElementNS and attributes alone; no text of the page goes
 * into markup. UMD like sfx.js, so test:marks requires it in Node.
 */
(function (root, factory) {
  const api = factory(root);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.occlaraPen = api;
}(typeof window !== 'undefined' ? window : globalThis, function (root) {
  'use strict';

  const NS = 'http://www.w3.org/2000/svg';

  // Each variant: the stroke, then its second pass (lighter, over part of the
  // stroke). Points are in a unit box, x then y, and may sit a little outside
  // it: that is the overshoot. Commands are absolute M, C and S only.
  const PATHS = {
    // Under one line of text. The box is the line, 3px past its start and 6px
    // past its end, 12 to 18px tall (deeper for a longer line) about the
    // line's foot.
    underline: [
      ['M -.005 .62 C .12 .50 .30 .58 .47 .52 C .64 .46 .82 .51 1.02 .36',
        'M .06 .68 C .26 .62 .50 .60 .74 .51'],
      ['M .01 .46 C .20 .56 .38 .40 .58 .47 C .76 .53 .90 .44 .985 .53 C 1.01 .56 1.025 .50 1.035 .45',
        'M .30 .52 C .48 .47 .62 .53 .86 .48'],
      ['M 0 .34 C .02 .50 .05 .58 .12 .58 C .38 .59 .66 .50 .90 .57 C .96 .59 1 .51 1.04 .28',
        'M .14 .64 C .40 .62 .62 .55 .84 .60'],
      ['M -.01 .52 C .25 .43 .60 .59 1.01 .44 C .82 .60 .58 .68 .40 .72',
        'M .08 .56 C .33 .50 .55 .56 .80 .50'],
    ],
    // Through one line of text, at its middle.
    strike: [
      ['M -.01 .60 C .25 .50 .55 .55 1.02 .40',
        'M .05 .64 C .30 .59 .60 .55 .90 .49'],
      ['M 0 .44 C .30 .53 .62 .45 1.015 .56',
        'M .40 .51 C .60 .48 .78 .53 .95 .55'],
      ['M .01 .63 C .33 .56 .70 .51 1.03 .34',
        'M .02 .68 C .30 .62 .55 .59 .75 .53'],
    ],
    // Around the whole element, 10px out at the sides and 7px above and below.
    // Each one ends past where it started, the way a quick ring does.
    circle: [
      ['M .70 .05 C .45 -.03 .10 .04 .03 .40 C -.02 .72 .28 .99 .58 .96 C .88 .93 1.02 .66 .98 .38 C .95 .16 .78 .04 .55 .08',
        'M .07 .28 C .02 .48 .07 .70 .20 .83'],
      ['M .20 .15 C .38 0 .80 .01 .95 .26 C 1.04 .46 .95 .82 .64 .95 C .36 1.03 .04 .88 .02 .55 C 0 .30 .14 .12 .42 .04',
        'M .60 .96 C .40 1 .18 .94 .07 .76'],
      ['M .50 .02 C .85 0 1.02 .30 .99 .52 C .96 .80 .70 .98 .45 .97 C .16 .95 0 .72 .02 .46 C .04 .18 .30 .03 .62 .06 C .70 .07 .74 .10 .79 .13',
        'M .97 .40 C 1 .58 .94 .76 .80 .88'],
      ['M .88 .22 C .74 .02 .30 -.02 .10 .20 C -.04 .40 .04 .80 .38 .95 C .70 1.04 1 .80 .97 .50 C .95 .36 .91 .28 .81 .17',
        'M .14 .16 C .02 .30 0 .52 .08 .70'],
    ],
    // Down the left of the element, in the margin: 14px wide, 22px to 8px
    // left of its edge, a little past its top and bottom.
    bracket: [
      ['M .95 .02 C .55 .01 .35 .04 .36 .16 C .38 .40 .30 .62 .33 .86 C .35 .97 .58 .99 .98 .97',
        'M .37 .20 C .35 .42 .32 .62 .34 .80'],
      ['M .85 0 C .45 .03 .30 .08 .32 .30 C .34 .55 .37 .75 .30 .95 C .50 .99 .75 1 1.02 .99',
        'M .33 .34 C .34 .52 .36 .70 .32 .90'],
      ['M 1 .05 C .70 .02 .42 0 .40 .10 C .36 .30 .45 .70 .38 .90 C .37 .96 .40 .99 .90 1.01',
        'M .41 .16 C .38 .36 .44 .62 .40 .84'],
    ],
    // From the margin to the element's first line: 40px wide, ending 8px
    // short of its edge, 22px tall about the line's middle.
    arrow: [
      ['M .02 .72 C .25 .63 .55 .58 .92 .48 M .66 .17 C .78 .30 .88 .40 .95 .48 C .84 .58 .74 .70 .67 .86',
        'M .06 .72 C .30 .64 .52 .60 .70 .55'],
      ['M 0 .95 C .20 .80 .45 .55 .93 .50 M .70 .24 C .80 .36 .90 .46 .96 .50 C .86 .60 .76 .68 .69 .78',
        'M .04 .92 C .22 .78 .40 .62 .62 .54'],
      ['M .04 .38 C .30 .52 .60 .57 .90 .52 M .73 .28 C .84 .40 .90 .48 .94 .53 C .86 .62 .80 .72 .75 .85',
        'M .10 .42 C .32 .52 .52 .56 .74 .55'],
    ],
    // Beside the element's first line, in the margin: 20px wide, 12px left of
    // its edge, 18px tall about the line's middle.
    tick: [
      ['M .02 .52 C .12 .56 .24 .72 .34 .94 C .48 .60 .70 .28 1.03 .01',
        'M .38 .84 C .52 .56 .70 .32 .94 .08'],
      ['M 0 .60 C .16 .62 .26 .80 .32 .97 C .40 .70 .62 .30 .96 .08 C .98 .06 1.01 .05 1.05 .04',
        'M .35 .88 C .46 .62 .62 .36 .86 .15'],
      ['M .06 .44 C .14 .52 .22 .70 .30 .88 C .34 .96 .36 .92 .40 .82 C .54 .50 .74 .22 .99 -.01',
        'M .42 .78 C .55 .50 .72 .28 .92 .06'],
    ],
  };
  const KINDS = Object.keys(PATHS);

  // The pen's width, by kind, and the second pass's share of it.
  const WIDTH = { underline: 2.3, strike: 1.9, circle: 1.6, bracket: 1.6, arrow: 1.5, tick: 1.9 };
  const PASS = 0.6;

  /** FNV-1a, 32 bit: the same text, the same number, in every process. */
  function hash(s) {
    let h = 0x811c9dc5;
    const str = String(s == null ? '' : s);
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h >>> 0;
  }

  /** Which variant of a kind this text gets, and, for a mark over several lines, which on line n. */
  function pick(kind, text, n) {
    const set = PATHS[kind];
    if (!set) return -1;
    return (hash(kind + '|' + text) + (n || 0) * 7) % set.length;
  }

  const r1 = (v) => Math.round(v * 10) / 10;
  /** A unit path laid out on a box of x, y, w, h pixels. */
  function layout(d, x, y, w, h) {
    const out = [];
    let axis = 0;
    for (const t of String(d).split(' ')) {
      if (!t) continue;
      if (t === 'M' || t === 'C' || t === 'S') { out.push(t); axis = 0; continue; }
      const v = Number(t);
      out.push(String(r1(axis === 0 ? x + v * w : y + v * h)));
      axis = 1 - axis;
    }
    return out.join(' ');
  }

  /** The stroke and its second pass for one variant, laid out on a box. */
  function pathFor(kind, variant, x, y, w, h) {
    const v = (PATHS[kind] || [])[variant];
    if (!v) return null;
    return { main: layout(v[0], x, y, w, h), pass: v[1] ? layout(v[1], x, y, w, h) : null };
  }

  /** The boxes a kind is drawn on, in the element's own pixels, one per line for a line mark. */
  function boxes(kind, size, lines, place) {
    const w = size.width, h = size.height;
    const first = lines[0] || { left: 0, top: 0, width: w, height: h };
    const mid = first.top + first.height / 2;
    // A longer line gets a deeper box, so its wobble is a hand's and not a ruler's.
    const deep = (l) => Math.min(18, Math.max(12, l.width * 0.03));
    if (kind === 'underline') return lines.map((l) => ({ x: l.left - 3, y: l.top + l.height - deep(l) / 2 - 2, w: l.width + 9, h: deep(l) }));
    if (kind === 'strike') return lines.map((l) => ({ x: l.left - 3, y: l.top + l.height * 0.56 - 6, w: l.width + 7, h: 12 }));
    if (kind === 'circle') return [{ x: -10, y: -7, w: w + 20, h: h + 14 }];
    if (kind === 'bracket') return [{ x: -22, y: -3, w: 14, h: h + 6 }];
    if (kind === 'arrow') return [{ x: -48, y: mid - 11, w: 40, h: 22 }];
    // A tick on a figure in a run ("58, 61, 64, 71") sits over it, taking
    // no width, so the commas keep their rhythm (place: 'above').
    if (place === 'above') return [{ x: w / 2 - 6, y: first.top - 15, w: 15, h: 13 }];
    return [{ x: -32, y: mid - 10, w: 20, h: 18 }];
  }

  /** The element's size and its lines (a Range's rects, merged by row), relative to it. */
  function measure(el) {
    const box = typeof el.getBoundingClientRect === 'function' ? el.getBoundingClientRect() : null;
    if (!box || !(box.width > 0) || !(box.height > 0)) return null;
    const lines = [];
    const doc = el.ownerDocument;
    let range = null;
    try { range = doc && typeof doc.createRange === 'function' ? doc.createRange() : null; } catch (e) { range = null; }
    if (range && typeof range.setStart === 'function' && typeof range.setEnd === 'function' && typeof range.getClientRects === 'function') {
      // The text alone: the pen's own svgs are the last children, and no line.
      const kids = Array.from(el.childNodes || []);
      let end = kids.findIndex((n) => n.classList && typeof n.classList.contains === 'function' && n.classList.contains('pen'));
      if (end < 0) end = kids.length;
      range.setStart(el, 0);
      range.setEnd(el, end);
      const rects = Array.from(range.getClientRects ? range.getClientRects() : []);
      for (const r of rects) {
        if (!(r.width > 1) || !(r.height > 1)) continue;
        const top = r.top - box.top, left = r.left - box.left;
        const row = lines.find((l) => Math.abs(l.top - top) < 3);
        if (row) {
          const right = Math.max(row.left + row.width, left + r.width);
          row.left = Math.min(row.left, left);
          row.width = right - row.left;
          row.height = Math.max(row.height, r.height);
        } else lines.push({ left, top, width: r.width, height: r.height });
      }
    }
    if (!lines.length) lines.push({ left: 0, top: 0, width: box.width, height: box.height });
    lines.sort((a, b) => a.top - b.top);
    return { size: { width: box.width, height: box.height }, lines };
  }

  // What main has said about coaching: null until it has said anything,
  // which counts as coaching (a mark is drawn still).
  let coaching = null;
  function setCoaching(v) { coaching = v === true ? true : v === false ? false : null; }
  try {
    const bridge = root.occlara;
    if (bridge && typeof bridge.getState === 'function') {
      Promise.resolve(bridge.getState()).then((s) => { if (s && typeof s.isCoaching === 'boolean') setCoaching(s.isCoaching); }).catch(() => {});
    }
    if (bridge && typeof bridge.onState === 'function') {
      bridge.onState((s) => { if (s && typeof s.isCoaching === 'boolean') setCoaching(s.isCoaching); });
    }
  } catch (e) { /* no bridge: coaching stays unknown, every mark still */ }

  const lessMotion = () => typeof root.matchMedia === 'function' && !!root.matchMedia('(prefers-reduced-motion: reduce)').matches;
  /** Whether a mark asked to draw may: motion allowed and coaching known to be off. */
  function mayDraw(opts) { return !!(opts && opts.draw === true) && coaching === false && !lessMotion(); }

  const held = typeof WeakMap === 'function' ? new WeakMap() : null;
  function marksOf(el) {
    if (!held) return (el.__pen = el.__pen || {});
    if (!held.has(el)) held.set(el, {});
    return held.get(el);
  }

  function attrs(node, a) { for (const k of Object.keys(a)) node.setAttribute(k, String(a[k])); return node; }

  /** Paint one mark's svg on the element, as it now measures. */
  function render(el, kind, state) {
    const doc = el.ownerDocument;
    const m = measure(el);
    if (!m) return false;
    const svg = state.svg;
    while (svg.firstChild) svg.removeChild(svg.firstChild);
    attrs(svg, { width: r1(m.size.width), height: r1(m.size.height), viewBox: `0 0 ${r1(m.size.width)} ${r1(m.size.height)}` });
    const w = WIDTH[kind] || 1.7;
    const lineKind = kind === 'underline' || kind === 'strike';
    let list = boxes(kind, m.size, m.lines, state.place).slice(0, 6);
    // opts.lines: 'last' marks only the last line of a wrapped element, a
    // number n at most its last n: one stroke under a fix that wraps reads
    // as a hand, three read as a ruler.
    if (lineKind && state.lines === 'last') list = list.slice(-1);
    else if (lineKind && Number(state.lines) >= 1) list = list.slice(-Math.floor(Number(state.lines)));
    list.forEach((b, i) => {
      // A hand does not repeat itself line to line: each line's stroke starts
      // a little early or late, stops short or runs on, sits a hair higher or
      // lower and presses a little harder or lighter, all from the text's
      // hash, so the same note is marked the same way every time.
      let { x, y, w: bw } = b;
      let lw = w;
      if (lineKind) {
        const j = hash(state.text + '#' + i);
        const u = (shift) => ((j >>> shift) & 255) / 255;
        const start = u(0) * 7 - 5;
        x += start;
        bw += -start + bw * (u(8) * 0.07 - 0.045);
        y += u(16) * 3 - 1.5;
        lw = w * (0.82 + u(24) * 0.3);
      }
      const p = pathFor(kind, pick(kind, state.text, i), x, y, bw, b.h);
      svg.appendChild(attrs(doc.createElementNS(NS, 'path'), {
        class: 'pen-stroke', d: p.main, pathLength: 1, 'stroke-width': r1(lw), style: `--k:${i}`,
      }));
      if (p.pass) {
        svg.appendChild(attrs(doc.createElementNS(NS, 'path'), {
          class: 'pen-stroke pen-pass', d: p.pass, pathLength: 1, 'stroke-width': r1(lw * PASS), style: `--k:${i}`,
        }));
      }
    });
    return true;
  }

  /**
   * Mark an element. kind is one of KINDS; opts.text picks the variant (the
   * element's text when left out); opts.draw asks to draw it in, which it
   * does only under mayDraw; opts.lines ('last' or a number) keeps an
   * underline or a strike to the last line or the last n lines; opts.place
   * 'above' sets a tick over a figure instead of in the margin before it. Marked again with the same kind, the mark is
   * replaced; it follows the element's size, still, from then on. Returns the
   * svg, or null for an unknown kind.
   */
  function mark(el, kind, opts) {
    if (!el || !PATHS[kind]) return null;
    const o = opts || {};
    const doc = el.ownerDocument;
    if (!doc || typeof doc.createElementNS !== 'function') return null;
    const all = marksOf(el);
    const was = all[kind];
    if (was) {
      if (was.ro) was.ro.disconnect();
      if (was.svg.parentNode) was.svg.parentNode.removeChild(was.svg);
    }
    const text = o.text != null ? String(o.text) : String(el.textContent || '');
    const svg = attrs(doc.createElementNS(NS, 'svg'), { class: `pen pen-${kind}`, 'aria-hidden': 'true', focusable: 'false' });
    const state = { svg, text, ro: null, lines: o.lines, place: o.place };
    all[kind] = state;
    if (el.classList) el.classList.add('pen-host');
    el.appendChild(svg);
    const drawn = render(el, kind, state);
    if (mayDraw(o) && drawn) {
      const delay = Number(o.delay) > 0 ? Math.round(Number(o.delay)) : 0;
      if (delay) svg.style.setProperty('--pen-delay', `${delay}ms`);
      svg.classList.add('drawing');
      // Once, then still: a later redraw (a resize) must not play it again.
      setTimeout(() => svg.classList.remove('drawing'), delay + 1400);
    }
    // A wrap that changes (a window resized, the voice's font arriving after
    // the first layout) is drawn again where the text now is, and still.
    if (typeof root.ResizeObserver === 'function') {
      let first = true;
      state.ro = new root.ResizeObserver(() => {
        if (first) { first = false; if (drawn) return; }
        render(el, kind, state);
      });
      state.ro.observe(el);
    }
    const fonts = doc.fonts;
    if (fonts && fonts.ready && typeof fonts.ready.then === 'function') {
      fonts.ready.then(() => { if (all[kind] === state) render(el, kind, state); }).catch(() => {});
    }
    return svg;
  }

  /** Take an element's mark of a kind away, or every mark with no kind. */
  function clear(el, kind) {
    if (!el) return;
    const all = marksOf(el);
    for (const k of kind ? [kind] : Object.keys(all)) {
      const s = all[k];
      if (!s) continue;
      if (s.ro) s.ro.disconnect();
      if (s.svg.parentNode) s.svg.parentNode.removeChild(s.svg);
      delete all[k];
    }
  }

  return { KINDS, PATHS, hash, pick, pathFor, mark, clear, setCoaching, mayDraw, coaching: () => coaching };
}));
