'use strict';

/**
 * THE GRADE TREND (9.1, the owner's items 15 and 21): one drawing of a run of
 * grades, oldest on the left, for the top of Matches and Home's trend card.
 * The owner's pick from the option board (the redesign folder's charts/
 * board.png): the moonlit area. One calm line through every match, the area
 * under it a soft fill of the ink fading to nothing (a fade, which is a mask
 * and no paint, check:palette), the newest match the brightest dot.
 *
 *   const chart = TrendChart.draw(host, points, opts);
 *   chart.play();          // the line draws itself, once, when it is seen
 *   chart.set(points);     // the same chart on new data, no motion
 *   chart.destroy();
 *
 * points, oldest first: [{ id, grade, at, provisional, agent, map, result,
 *   scoreline, delta, record, run, notes }]. Only grade is needed; the rest
 *   is the tooltip's, except two marks Patterns draws (9.1, the same chart
 *   under the Matches link's two tabs): `record`, a milestone's words ("Best
 *   in 12"), rings the match's dot in the good tone, and `run: true` on each
 *   match of a run underlines them along the baseline. `notes` are extra
 *   lines for the tooltip, which says every mark in words.
 * opts:
 *   height    the plot's height in px (180)
 *   average   a dashed line at this grade, labelled "avg 76", or null
 *   guides    the grades a hairline marks ([60, 70, 80, 90])
 *   onOpen    fn(point): a click or Enter on a match opens it
 *   label     what the chart is, for a screen reader ("Grade over your last 20 graded matches")
 *   now       the time "Today" is measured from (Date.now())
 *
 * ONE ENCODING, HEIGHT (8.9.1, kept): every match is the same neutral dot on
 * the same line, its height the grade out of 100; only the newest is
 * brighter, and nothing is coloured by its band. A provisional grade is a
 * dashed ring, and the tooltip says so.
 *
 * THE FOOT IS DATES (the owner's item 4): each day's matches carry the day
 * once, centred under them, "Today", "Yesterday" or "Nov 22", never a time
 * of day for matches on different days. A label that would touch its
 * neighbour is left out, the newest day's first, so the newest is always
 * labelled. The tooltip has the time.
 *
 * DRAWN IN ITS OWN PIXELS at the host's width (no stretch, so the dots stay
 * round), and drawn again when the host changes width.
 *
 * THE MOTION (Orbit): play() draws the line left to right on --ease-enter,
 * the fill wiping in under it, each dot arriving as the line passes it, the
 * newest's number last. Once: the page calls it once per visit. Less motion,
 * and it is simply there. One shot keyframes only, nothing infinite, so
 * nothing runs while a match is recorded.
 *
 * KEYBOARD: the chart takes focus; Left and Right (and Home, End) move from
 * match to match with its tooltip, read out by a polite live line; Enter
 * opens it; Escape lets go. The pointer does the same by hovering.
 *
 * Read as window.TrendChart; required in node by the tests.
 */
(function (root) {
  const SVGNS = 'http://www.w3.org/2000/svg';
  const PAD = { L: 30, R: 18, T: 18, B: 28 };
  const DRAW_MS = 900;
  /*
   * WHEN THE LINE REACHES A POINT (9.1 fix): the line is drawn on
   * --ease-enter, cubic-bezier(0.16, 1, 0.3, 1) (theme.css; test:trendchart
   * holds the two the same), so it is at half its length a tenth of the way
   * in. A dot's delay linear in x left the dots well behind the line mid
   * draw. This is the time, as a share of the draw, at which the eased line
   * has covered `f` of its length: the bezier's progress solved for f, then
   * its time read off.
   */
  const EASE_ENTER = [0.16, 1, 0.3, 1];
  function reachedAt(f) {
    const [x1, y1, x2, y2] = EASE_ENTER;
    const at = (a, b, s) => 3 * (1 - s) * (1 - s) * s * a + 3 * (1 - s) * s * s * b + s * s * s;
    const want = Math.max(0, Math.min(1, f));
    let lo = 0, hi = 1;
    for (let k = 0; k < 24; k++) { const mid = (lo + hi) / 2; if (at(y1, y2, mid) < want) lo = mid; else hi = mid; }
    return at(x1, x2, (lo + hi) / 2);
  }
  const FIG = 6.2;          // a 10px Geist Mono figure
  const FOOT_GAP = 14;      // between two foot labels

  const fin = (v) => typeof v === 'number' && Number.isFinite(v);

  function mk(tag, attrs, text) {
    const n = document.createElementNS(SVGNS, tag);
    for (const [k, v] of Object.entries(attrs || {})) n.setAttribute(k, String(v));
    if (text !== undefined) n.textContent = text;
    return n;
  }
  function div(cls, text) {
    const n = document.createElement('div');
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  }
  function span(cls, text) {
    const n = document.createElement('span');
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  }
  const reduced = () => {
    try { return !!(root.matchMedia && root.matchMedia('(prefers-reduced-motion: reduce)').matches); } catch { return false; }
  };

  /** The day a time falls on, for grouping: "Mon Nov 24 2026". */
  const dayKey = (at) => (fin(at) ? new Date(at).toDateString() : '');

  /*
   * WHEN A MATCH WAS PLAYED is shared/display.js's (matchDay, matchWhen), the
   * one way every page says it (9.1): a page loads display.js before this
   * file, and node requires it.
   */
  const display = () => root.OcclaraDisplay || (typeof require === 'function' ? require('../../shared/display') : null);

  /** A day as the foot says it: "Today", "Yesterday", "Nov 22". */
  function dayWord(at, now) {
    return fin(at) ? display().matchDay(at, now) : '';
  }

  /** "Today, 9:25 PM", "Yesterday, 9:25 PM", "Nov 22, 9:25 PM". */
  function whenWord(at, now) {
    return fin(at) ? display().matchWhen(at, now) : '';
  }

  /*
   * A smooth line that never overshoots a point (monotone cubic, Fritsch and
   * Carlson): between two matches the curve stays between their two grades,
   * so it never draws a grade nobody played.
   */
  function smoothPath(xy) {
    const n = xy.length;
    if (n < 2) return '';
    if (n === 2) return `M${xy[0][0]},${xy[0][1]} L${xy[1][0]},${xy[1][1]}`;
    const d = [], m = new Array(n);
    for (let i = 0; i < n - 1; i++) d.push((xy[i + 1][1] - xy[i][1]) / (xy[i + 1][0] - xy[i][0]));
    m[0] = d[0];
    m[n - 1] = d[n - 2];
    for (let i = 1; i < n - 1; i++) m[i] = d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2;
    for (let i = 0; i < n - 1; i++) {
      if (d[i] === 0) { m[i] = 0; m[i + 1] = 0; continue; }
      const a = m[i] / d[i], b = m[i + 1] / d[i], t = a * a + b * b;
      if (t > 9) { const k = 3 / Math.sqrt(t); m[i] = k * a * d[i]; m[i + 1] = k * b * d[i]; }
    }
    const f = (v) => Number(v.toFixed(2));
    let p = `M${f(xy[0][0])},${f(xy[0][1])}`;
    for (let i = 0; i < n - 1; i++) {
      const h = (xy[i + 1][0] - xy[i][0]) / 3;
      p += ` C${f(xy[i][0] + h)},${f(xy[i][1] + m[i] * h)} ${f(xy[i + 1][0] - h)},${f(xy[i + 1][1] - m[i + 1] * h)} ${f(xy[i + 1][0])},${f(xy[i + 1][1])}`;
    }
    return p;
  }

  /**
   * The foot: one label a day, centred under that day's matches, kept from
   * the newest leftwards only where it clears the one kept to its right.
   * @returns [{ x, text, first, last }] left to right
   */
  function footLabels(points, xOf, w, now) {
    const groups = [];
    points.forEach((p, i) => {
      const key = dayKey(p.at);
      const g = groups[groups.length - 1];
      if (g && g.key === key) g.to = i;
      else groups.push({ key, from: i, to: i, at: p.at });
    });
    const kept = [];
    for (let k = groups.length - 1; k >= 0; k--) {
      const g = groups[k];
      const text = g.key ? dayWord(g.at, now) : '';
      if (!text) continue;
      const half = (text.length * FIG) / 2;
      const mid = (xOf(g.from) + xOf(g.to)) / 2;
      const x = Math.min(Math.max(mid, PAD.L + half), w - half);
      const right = kept[0];
      if (right && x + half + FOOT_GAP > right.x - right.half) continue;
      kept.unshift({ x, half, text });
    }
    return kept.map((l) => ({ x: Number(l.x.toFixed(1)), text: l.text }));
  }

  /** The grades the plot spans: up to 100, and down to a ten under the lowest (50 at most). */
  function domain(grades) {
    const lo = Math.min(...grades);
    return { lo: Math.max(0, Math.min(50, Math.floor((lo - 4) / 10) * 10)), hi: 100 };
  }

  /** The default tooltip: when, what, the result and the grade. */
  function tipOf(p, now) {
    const box = div('tc-tip-body');
    const when = whenWord(p.at, now);
    if (when) box.append(span('tc-tip-when', when));
    const name = p.agent && p.map ? `${p.agent} on ${p.map}` : (p.agent || p.map || '');
    if (name) box.append(span('tc-tip-name', name));
    const res = [p.result, p.scoreline].filter(Boolean).join(' ');
    if (res) {
      const tone = /^(?:victory|win)/i.test(p.result || '') ? ' win' : /^(?:defeat|loss)/i.test(p.result || '') ? ' loss' : '';
      box.append(span('tc-tip-res' + tone, res));
    }
    const g = div('tc-tip-grade');
    g.append(span('tc-tip-num', String(Math.round(p.grade))), span('tc-tip-word', p.provisional ? 'Grade, provisional' : 'Grade'));
    if (fin(p.delta)) {
      const d = Math.round(p.delta);
      g.append(span('tc-tip-delta' + (d > 0 ? ' up' : d < 0 ? ' down' : ''), d > 0 ? `+${d}` : d < 0 ? `-${-d}` : '0'));
    }
    box.append(g);
    for (const n of notesOf(p)) box.append(span('tc-tip-note', n));
    return box;
  }

  /** A point's marks in words: its record, then any notes. */
  function notesOf(p) {
    const out = [];
    if (typeof p.record === 'string' && p.record) out.push(p.record);
    if (Array.isArray(p.notes)) for (const n of p.notes) if (typeof n === 'string' && n) out.push(n);
    return out;
  }

  /** The tooltip in words, for the live line. */
  function sayOf(p, now) {
    const name = p.agent && p.map ? `${p.agent} on ${p.map}` : (p.agent || p.map || '');
    const d = fin(p.delta) ? Math.round(p.delta) : null;
    return [whenWord(p.at, now), name, [p.result, p.scoreline].filter(Boolean).join(' '),
      `Grade ${Math.round(p.grade)}${p.provisional ? ', provisional' : ''}${d === null ? '' : d > 0 ? `, up ${d}` : d < 0 ? `, down ${-d}` : ', level'}`,
      ...notesOf(p).map((n) => n.replace(/[.\s]+$/, ''))]
      .filter(Boolean).join('. ') + '.';
  }

  function draw(host, input, options) {
    let opts = Object.assign({ height: 180, average: null, guides: [60, 70, 80, 90], onOpen: null, label: '', now: null }, options || {});
    let points = [];
    let geo = null;          // { w, h, x(i), y(g), xy }
    let active = -1;
    let drawnW = 0;
    let playing = 0;

    host.classList.add('tc');
    host.replaceChildren();
    const fill = div('tc-fill');
    fill.setAttribute('aria-hidden', 'true');
    const tip = div('tc-tip');
    tip.setAttribute('aria-hidden', 'true');
    tip.hidden = true;
    const live = div('tc-live sr-only');
    live.setAttribute('aria-live', 'polite');
    let svg = null;
    host.append(fill, tip, live);
    host.tabIndex = 0;
    host.setAttribute('role', 'group');
    host.setAttribute('aria-roledescription', 'chart');

    function width() {
      const w = Number(host.clientWidth) || (host.getBoundingClientRect ? host.getBoundingClientRect().width : 0) || 600;
      return Math.max(160, Math.round(w));
    }

    function render() {
      const pts = points;
      if (svg) svg.remove();
      fill.replaceChildren();
      tip.hidden = true;
      active = -1;
      host.classList.toggle('tc-empty', pts.length < 2);
      if (pts.length < 2) { svg = null; geo = null; return; }
      const w = width();
      const h = Math.max(120, Number(opts.height) || 180);
      drawnW = w;
      const grades = pts.map((p) => p.grade);
      const dom = domain(grades);
      const n = pts.length;
      const x = (i) => PAD.L + (n === 1 ? 0 : i * ((w - PAD.L - PAD.R) / (n - 1)));
      const y = (g) => PAD.T + ((dom.hi - g) / (dom.hi - dom.lo)) * (h - PAD.T - PAD.B);
      const xy = grades.map((g, i) => [x(i), y(g)]);
      geo = { w, h, x, y, xy };
      const base = h - PAD.B;
      const line = smoothPath(xy);
      host.style.setProperty('--tc-h', `${h}px`);

      // The fill: its own layer, so the fade is a mask on it (tc-fill).
      const fsvg = mk('svg', { width: w, height: h, viewBox: `0 0 ${w} ${h}`, 'aria-hidden': 'true', focusable: 'false' });
      fsvg.append(mk('path', { d: `${line} L${xy[n - 1][0].toFixed(2)},${base} L${xy[0][0].toFixed(2)},${base} Z`, class: 'tc-area' }));
      fill.append(fsvg);

      svg = mk('svg', { width: w, height: h, viewBox: `0 0 ${w} ${h}`, class: 'tc-svg', 'aria-hidden': 'true', focusable: 'false' });
      const guides = mk('g', { class: 'tc-guides' });
      for (const g of opts.guides || []) {
        if (!(g > dom.lo && g < dom.hi)) continue;
        const gy = y(g).toFixed(1);
        guides.append(mk('line', { x1: PAD.L, x2: w - PAD.R, y1: gy, y2: gy, class: 'tc-guide' }));
        guides.append(mk('text', { x: 0, y: (Number(gy) + 3.5).toFixed(1), class: 'tc-guide-label' }, String(g)));
      }
      guides.append(mk('line', { x1: PAD.L, x2: w - PAD.R, y1: base, y2: base, class: 'tc-base' }));
      svg.append(guides);

      if (fin(opts.average)) {
        const ay = y(Math.max(dom.lo, Math.min(dom.hi, opts.average)));
        const g = mk('g', { class: 'tc-avg' });
        g.append(mk('line', { x1: PAD.L, x2: w - PAD.R, y1: ay.toFixed(1), y2: ay.toFixed(1), class: 'tc-avg-line' }));
        // Its words at the right end, over the dashes, or under them where
        // the newest match sits close over that end of the line.
        const newestY = xy[n - 1][1];
        const under = Math.abs(newestY - ay) < 20 && newestY < ay;
        const label = `avg ${Math.round(opts.average)}`;
        const lx = w - PAD.R - 18;
        g.append(mk('text', { x: lx, y: (under ? ay + 13 : ay - 6).toFixed(1), class: 'tc-avg-label', 'text-anchor': 'end' }, label));
        svg.append(g);
      }

      // A RUN IS UNDERLINED (Patterns, 9.1): each stretch of matches marked
      // run, a short rule along the baseline under them, named in the key
      // and in each one's tooltip, so the line is never the only sign.
      const runs = mk('g', { class: 'tc-runs' });
      let runCount = 0;
      for (let i = 0; i < n; i++) {
        if (!pts[i].run) continue;
        let j = i;
        while (j + 1 < n && pts[j + 1].run) j++;
        // Under its matches alone, never past the plot's own ends.
        const half = Math.min(7, ((w - PAD.L - PAD.R) / Math.max(1, n - 1)) / 3);
        const x1 = Math.max(PAD.L, x(i) - half), x2 = Math.min(w - PAD.R, x(j) + half);
        runs.append(mk('line', { x1: x1.toFixed(1), x2: x2.toFixed(1), y1: base + 6, y2: base + 6, class: 'tc-run' }));
        runCount++;
        i = j;
      }
      if (runCount) svg.append(runs);

      const path = mk('path', { d: line, class: 'tc-line', pathLength: 1 });
      svg.append(path);

      const dots = mk('g', { class: 'tc-dots' });
      const dense = n > 40;
      xy.forEach(([cx, cy], i) => {
        const last = i === n - 1;
        const record = typeof pts[i].record === 'string' && pts[i].record;
        if (dense && !last && !record) return;
        // A record is ringed in the good tone, outside its dot (Patterns).
        if (record) dots.append(mk('circle', { cx: cx.toFixed(1), cy: cy.toFixed(1), r: last ? 8 : 6.5, class: 'tc-record' }));
        // A provisional grade is an open ring a little larger, finely dashed
        // (trend-chart.css): at 2.75 the dash read as a broken x on the line.
        const c = mk('circle', { cx: cx.toFixed(1), cy: cy.toFixed(1), r: last ? 4.5 : pts[i].provisional ? 3.5 : 2.75,
          class: 'tc-dot' + (last ? ' now' : '') + (pts[i].provisional ? ' prov' : ''), 'data-grade': Math.round(pts[i].grade) });
        // Each dot arrives as the eased line reaches it (reachedAt), a breath early so it is up as the line passes.
        c.style.setProperty('--d', `${Math.max(0, Math.round(reachedAt((cx - PAD.L) / Math.max(1, w - PAD.L - PAD.R)) * DRAW_MS) - 40)}ms`);
        dots.append(c);
      });
      svg.append(dots);

      // The newest grade over its dot.
      const [nx, ny] = xy[n - 1];
      svg.append(mk('text', { x: Math.min(nx, w - 8).toFixed(1), y: (ny - 11).toFixed(1), class: 'tc-now-label', 'text-anchor': nx > w - 20 ? 'end' : 'middle' },
        String(Math.round(grades[n - 1]))));

      const foot = mk('g', { class: 'tc-foot' });
      const labels = footLabels(pts, x, w, opts.now);
      labels.forEach((l, i) => foot.append(mk('text', { x: l.x, y: h - 8, class: 'tc-foot-label' + (i === labels.length - 1 ? ' now' : ''), 'text-anchor': 'middle' }, l.text)));
      svg.append(foot);

      // What the pointer and the keyboard move: a hairline and a ring.
      const cursor = mk('g', { class: 'tc-cursor' });
      cursor.append(mk('line', { x1: 0, x2: 0, y1: PAD.T - 8, y2: base, class: 'tc-cursor-line' }), mk('circle', { cx: 0, cy: 0, r: 5, class: 'tc-cursor-dot' }));
      svg.append(cursor);

      host.insertBefore(svg, tip);
      const avg = fin(opts.average) ? ` Average ${Math.round(opts.average)}.` : '';
      host.setAttribute('aria-label', `${opts.label || `Grade over your last ${n} graded matches`}, oldest first, from ${Math.round(grades[0])} to ${Math.round(grades[n - 1])}.${avg}`
        + ` Use the left and right arrow keys to read each match${opts.onOpen ? ', and Enter to open it' : ''}.`);
      host.classList.toggle('tc-openable', typeof opts.onOpen === 'function');
    }

    function setActive(i, say) {
      if (!geo || !svg) return;
      const n = points.length;
      if (i < 0 || i >= n) {
        active = -1;
        host.classList.remove('tc-active');
        tip.hidden = true;
        return;
      }
      active = i;
      const [cx, cy] = geo.xy[i];
      const cursor = svg.querySelector('.tc-cursor');
      if (cursor) {
        const ln = cursor.querySelector('.tc-cursor-line');
        const dot = cursor.querySelector('.tc-cursor-dot');
        ln.setAttribute('x1', cx.toFixed(1));
        ln.setAttribute('x2', cx.toFixed(1));
        dot.setAttribute('cx', cx.toFixed(1));
        dot.setAttribute('cy', cy.toFixed(1));
      }
      host.classList.add('tc-active');
      // Shown from nothing, the card appears where it belongs; it glides
      // only from match to match, never in from where it last was.
      const fresh = tip.hidden;
      tip.replaceChildren(tipOf(points[i], opts.now));
      tip.hidden = false;
      if (fresh) tip.style.transition = 'none';
      // Beside the dot, on whichever side has room, and over it unless that
      // leaves the top.
      const tw = tip.offsetWidth || 180, th = tip.offsetHeight || 96;
      const right = cx + 14 + tw <= geo.w;
      const left = right ? cx + 14 : Math.max(0, cx - 14 - tw);
      const top = Math.max(0, Math.min(geo.h - th, cy - th / 2));
      tip.style.transform = `translate(${Math.round(left)}px, ${Math.round(top)}px)`;
      if (fresh) { void tip.offsetWidth; tip.style.transition = ''; }
      if (say) live.textContent = sayOf(points[i], opts.now);
    }

    function nearest(clientX) {
      if (!geo || !svg) return -1;
      const box = svg.getBoundingClientRect();
      const px = clientX - box.left;
      const n = points.length;
      const step = (geo.w - PAD.L - PAD.R) / Math.max(1, n - 1);
      return Math.max(0, Math.min(n - 1, Math.round((px - PAD.L) / step)));
    }

    const onMove = (e) => { const i = nearest(e.clientX); if (i !== active) setActive(i, false); };
    const onLeave = () => { if (document.activeElement !== host) setActive(-1); };
    const onClick = (e) => {
      if (typeof opts.onOpen !== 'function' || !points.length) return;
      const i = e && fin(e.clientX) ? nearest(e.clientX) : active;
      if (i >= 0) opts.onOpen(points[i]);
    };
    const onKey = (e) => {
      const n = points.length;
      if (n < 2) return;
      let i = active;
      if (e.key === 'ArrowRight') i = i < 0 ? n - 1 : Math.min(n - 1, i + 1);
      else if (e.key === 'ArrowLeft') i = i < 0 ? n - 1 : Math.max(0, i - 1);
      else if (e.key === 'Home') i = 0;
      else if (e.key === 'End') i = n - 1;
      else if (e.key === 'Enter' || e.key === ' ') {
        if (active >= 0 && typeof opts.onOpen === 'function') { e.preventDefault(); opts.onOpen(points[active]); }
        return;
      } else if (e.key === 'Escape') { if (active >= 0) { e.preventDefault(); e.stopPropagation(); setActive(-1); } return; }
      else return;
      e.preventDefault();
      setActive(i, true);
    };
    const onBlur = () => setActive(-1);
    host.addEventListener('pointermove', onMove);
    host.addEventListener('pointerleave', onLeave);
    host.addEventListener('click', onClick);
    host.addEventListener('keydown', onKey);
    host.addEventListener('blur', onBlur);

    let ro = null;
    if (typeof root.ResizeObserver === 'function') {
      ro = new root.ResizeObserver(() => {
        if (!points.length) return;
        const w = width();
        if (Math.abs(w - drawnW) >= 2) render();
      });
      ro.observe(host);
    }

    function set(next, more) {
      if (more) opts = Object.assign(opts, more);
      points = (Array.isArray(next) ? next : []).filter((p) => p && fin(Number(p.grade))).map((p) => ({ ...p, grade: Number(p.grade) }));
      render();
    }

    /** The line draws itself once; nothing under less motion. */
    function play() {
      if (!svg || reduced()) return;
      clearTimeout(playing);
      host.classList.remove('tc-play');
      void host.offsetWidth;
      host.classList.add('tc-play');
      playing = setTimeout(() => host.classList.remove('tc-play'), DRAW_MS + 700);
    }

    function destroy() {
      clearTimeout(playing);
      if (ro) ro.disconnect();
      host.removeEventListener('pointermove', onMove);
      host.removeEventListener('pointerleave', onLeave);
      host.removeEventListener('click', onClick);
      host.removeEventListener('keydown', onKey);
      host.removeEventListener('blur', onBlur);
      host.replaceChildren();
      host.classList.remove('tc', 'tc-play', 'tc-active', 'tc-empty', 'tc-openable');
    }

    set(input);
    return {
      play, set, destroy,
      get active() { return active; },
      select: (i) => setActive(i, true),
      get el() { return host; },
    };
  }

  const api = { draw, smoothPath, footLabels, dayWord, whenWord, domain, sayOf, notesOf, reachedAt, EASE_ENTER, DRAW_MS };
  if (typeof module === 'object' && module && module.exports) module.exports = api;
  if (root) root.TrendChart = api;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
