'use strict';

/*
 * THE MATCH RATING ON THE REVIEW PAGE (docs/claude/rating.md).
 *
 * Paints what main served as `ratingView` (valorant-review.js withRating,
 * shared/rating.js viewOf): the number in its tier's colour, the line across
 * the match by round with a soft area under it, a tick a round, the half
 * marked and the biggest swings dotted, a round's move and name under the
 * line on hover, focus or the arrow keys, the three biggest round gains and
 * losses (each opens its round's row, its clip with it where one was kept),
 * the place in the lobby and the lobby by agent. Sides, agents, rounds and
 * numbers only: main sends no name. Every string is set as text.
 *
 * THE REPLAY, a broadcast graphic over the page: the rating in a badge in
 * its tier's colour, counting through CSS (rating.css, @property --rt over
 * counter(); this file sets the value to count to and works no figure out),
 * the move beside it rising in green or falling in red, a running feed of
 * the last events, the round and the score ticking, the line drawing as it
 * goes with its newest point ringed, and "Full time" with the final rating
 * and the place. Skip, Esc, a click on the ground or any key but a modifier
 * goes to full time; a second closes it. Tab stays inside it. Under reduced
 * motion it opens at full time. Only the final is announced. A hidden page
 * (sealed mid match) stops it.
 */
(function () {
  const $ = (id) => document.getElementById(id);
  const SVG = 'http://www.w3.org/2000/svg';
  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined && text !== null) n.textContent = String(text);
    return n;
  }
  function svgEl(tag, attrs) {
    const n = document.createElementNS(SVG, tag);
    for (const [k, v] of Object.entries(attrs || {})) n.setAttribute(k, String(v));
    return n;
  }
  const lessMotion = () => typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const TIERS = ['poor', 'fair', 'good', 'great', 'excellent'];
  const tierOf = (v) => (v >= 9 ? 'excellent' : v >= 8 ? 'great' : v >= 7 ? 'good' : v >= 6 ? 'fair' : 'poor');
  function setTier(node, tier) {
    for (const t of TIERS) node.classList.remove(`t-${t}`);
    if (tier) node.classList.add(`t-${tier}`);
  }

  // The view box: 600 wide, 100 high; the line keeps a margin top and bottom.
  const W = 600;
  const H = 100;
  function scale(values, last) {
    const lo = Math.min(5.5, ...values) - 0.3;
    const hi = Math.max(6.5, ...values) + 0.3;
    return { x: (n) => (n / (last || 1)) * W, y: (v) => H - ((v - lo) / (hi - lo)) * H };
  }

  /*
   * THE CHART: the area under the line, 6.0 dashed, the half, a tick a round,
   * the line, and the dots of the swings (HTML over the stretched SVG so they
   * stay round). `points` are { x: rounds from the start, value }.
   */
  function chart(host, view, points, opts) {
    const o = opts || {};
    const last = (view.line && view.line.length ? view.line[view.line.length - 1].n : 0) || 1;
    const sc = scale((view.line || []).map((p) => p.value).concat(points.map((p) => p.value)), last);
    host.replaceChildren();
    const plot = el('div', 'rt-plot');
    const svg = svgEl('svg', { viewBox: `0 0 ${W} ${H}`, preserveAspectRatio: 'none', class: 'rt-svg', 'aria-hidden': 'true' });
    if (view.half) svg.append(svgEl('line', { x1: sc.x(view.half), x2: sc.x(view.half), y1: 0, y2: H, class: 'rt-halfline' }));
    svg.append(svgEl('line', { x1: 0, x2: W, y1: sc.y(6), y2: sc.y(6), class: 'rt-base' }));
    const area = svgEl('path', { class: 'rt-area' });
    const path = svgEl('path', { class: 'rt-path' });
    svg.append(area, path);
    plot.append(svg);
    const draw = (pts) => {
      if (!pts.length) { path.setAttribute('d', ''); area.setAttribute('d', ''); return; }
      const d = pts.map((p, i) => `${i ? 'L' : 'M'}${sc.x(p.x).toFixed(1)} ${sc.y(p.value).toFixed(1)}`).join(' ');
      path.setAttribute('d', d);
      area.setAttribute('d', `${d} L${sc.x(pts[pts.length - 1].x).toFixed(1)} ${H} L${sc.x(pts[0].x).toFixed(1)} ${H} Z`);
    };
    draw(points);
    // The swings' dots, at their round's end.
    const byRound = new Map((view.line || []).map((p) => [p.n, p.value]));
    const seen = new Set();
    const marks = [];
    for (const m of view.marks || []) {
      const key = `${m.round}:${m.up}`;
      if (seen.has(key) || typeof byRound.get(m.round) !== 'number') continue;
      seen.add(key);
      const dot = el('span', `rt-mark ${m.up ? 'up' : 'down'}`);
      dot.style.left = `${(sc.x(m.round) / W) * 100}%`;
      dot.style.top = `${(sc.y(byRound.get(m.round)) / H) * 100}%`;
      dot.dataset.round = String(m.round);
      plot.append(dot);
      marks.push(dot);
    }
    // The point being read (hover, focus, the replay's newest).
    const now = el('span', 'rt-now');
    now.hidden = true;
    const cursor = el('span', 'rt-cursor');
    cursor.hidden = true;
    plot.append(cursor, now);
    const at = (x, value) => {
      now.hidden = false;
      now.style.left = `${(sc.x(x) / W) * 100}%`;
      now.style.top = `${(sc.y(value) / H) * 100}%`;
      cursor.hidden = !o.cursor;
      cursor.style.left = now.style.left;
    };
    // A tick a round, won or lost, and the half's label.
    const ticks = el('div', 'rt-ticks');
    for (const r of view.rounds || []) {
      const t = el('span', `rt-tick${r.won === true ? ' won' : r.won === false ? ' lost' : ''}`);
      t.style.left = `${(sc.x(r.n - 0.5) / W) * 100}%`;
      ticks.append(t);
    }
    const axis = el('div', 'rt-axis');
    axis.append(el('span', null, 'Round 1'));
    if (view.half) {
      const h = el('span', 'rt-axis-half', 'Half');
      h.style.left = `${(sc.x(view.half) / W) * 100}%`;
      axis.append(h);
    }
    axis.append(el('span', null, `Round ${last}`));
    host.append(plot, ticks, axis);
    host.hidden = false;
    return { draw, at, marks, plot, last, hide: () => { now.hidden = true; cursor.hidden = true; } };
  }

  function swingRow(e, hooks) {
    const li = el('li', 'rt-row');
    const b = el('button', 'rt-row-btn');
    b.type = 'button';
    b.append(el('span', 'rt-round', `R${e.round}`), el('span', 'rt-label', e.label), el('span', `rt-delta ${e.up ? 'up' : 'down'}`, e.delta));
    b.title = `Open round ${e.round}`;
    b.addEventListener('click', () => { if (hooks && typeof hooks.goRound === 'function') hooks.goRound(e.round); });
    li.append(b);
    return li;
  }

  /*
   * A ROUND READ OFF THE LINE: the pointer over the plot, or the plot focused
   * and the arrow keys, shows that round's point, a cursor and its line under
   * the chart: "Round 14, 7 : 7, +0.4, Triple kill with the opening kill".
   */
  function readable(c, view) {
    const plot = c.plot;
    const read = $('rt-read');
    const rounds = view.rounds || [];
    if (!rounds.length) return;
    let at = null;
    plot.tabIndex = 0;
    plot.setAttribute('role', 'group');
    plot.setAttribute('aria-label', 'The rating round by round. Use the arrow keys to read a round.');
    const show = (i) => {
      at = Math.max(0, Math.min(rounds.length - 1, i));
      const r = rounds[at];
      c.at(r.n, r.value);
      read.replaceChildren(el('span', 'rt-read-n', `Round ${r.n}`), el('span', 'rt-read-score', r.score),
        el('span', `rt-read-d${/^\+/.test(r.delta) ? ' up' : /^-/.test(r.delta) ? ' down' : ''}`, r.delta),
        el('span', 'rt-read-label', r.label || (r.won === true ? 'Round won' : r.won === false ? 'Round lost' : '')));
      read.classList.add('on');
    };
    const clear = () => { c.hide(); read.classList.remove('on'); read.replaceChildren(el('span', 'rt-read-hint', 'Point at a round, or focus the line and use the arrow keys.')); };
    clear();
    plot.addEventListener('mousemove', (e) => {
      const box = plot.getBoundingClientRect();
      const n = Math.ceil(((e.clientX - box.left) / Math.max(1, box.width)) * c.last);
      show(n - 1);
    });
    plot.addEventListener('mouseleave', () => { if (document.activeElement !== plot) clear(); });
    plot.addEventListener('focus', () => show(at === null ? rounds.length - 1 : at));
    plot.addEventListener('blur', clear);
    plot.addEventListener('keydown', (e) => {
      const step = { ArrowLeft: -1, ArrowRight: 1, Home: -1e3, End: 1e3 }[e.key];
      if (step === undefined) return;
      e.preventDefault();
      show((at === null ? rounds.length - 1 : at) + step);
    });
  }

  let current = null;
  let hooks = null;

  /** The block, from the review as served; hidden with nothing to say. */
  function paint(view, h) {
    hooks = h || null;
    if (current !== view) stop();
    current = view || null;
    const wrap = $('v-rating-wrap');
    if (!wrap) return;
    if (!view) { wrap.hidden = true; return; }
    wrap.hidden = false;
    const rated = typeof view.value === 'number';
    wrap.querySelector('.rt-head').hidden = !rated;
    $('rt-value').textContent = rated ? view.shown : '';
    setTier($('rt-value'), rated ? view.tier || tierOf(view.value) : null);
    $('rt-note').textContent = rated ? '' : (view.note || '');
    $('rt-note').hidden = rated || !view.note;
    $('rt-place').textContent = rated && view.place ? `${view.place} in the lobby` : '';
    $('rt-place').hidden = !(rated && view.place);
    $('rt-play').hidden = !(rated && Array.isArray(view.events) && view.events.length);
    if (!rated) {
      $('rt-line').hidden = true; $('rt-line').replaceChildren(); $('rt-read').hidden = true;
      $('rt-swings').hidden = true; $('rt-lobby-wrap').hidden = true;
      return;
    }
    const c = chart($('rt-line'), view, (view.line || []).map((p) => ({ x: p.n, value: p.value })), { cursor: true });
    $('rt-read').hidden = false;
    readable(c, view);
    $('rt-gains').replaceChildren(...(view.gains || []).map((e) => swingRow(e, hooks)));
    $('rt-losses').replaceChildren(...(view.losses || []).map((e) => swingRow(e, hooks)));
    $('rt-swings').hidden = !((view.gains || []).length || (view.losses || []).length);
    const lobby = Array.isArray(view.lobby) ? view.lobby : [];
    $('rt-lobby-wrap').hidden = lobby.length < 2;
    $('rt-lobby').replaceChildren(...lobby.map((p) => {
      const li = el('li', `rt-lob${p.me ? ' me' : ''}`);
      const val = el('span', 'rt-lob-val', p.value);
      setTier(val, p.tier || tierOf(Number(p.value)));
      li.append(el('span', 'rt-lob-agent', p.agent ? (p.me ? `${p.agent}, you` : p.agent) : (p.me ? 'You' : 'Unknown agent')),
        el('span', 'rt-lob-side', p.me ? 'Your team' : p.side === 'us' ? 'Your team' : 'Theirs'), val);
      return li;
    }));
  }

  /* ----------------------------------------------------------------- the replay */

  // A round's events share this much time, each between the two bounds; a
  // round with nothing of the player's passes in EMPTY_MS.
  const ROUND_MS = 2600;
  const STEP_MIN = 600;
  const STEP_MAX = 1200;
  const EMPTY_MS = 360;
  const OPEN_MS = 1400;
  const FEED = 4;

  let run = null;

  /** Every step: the round's events in order, each at its place along the round, then the round's result. */
  function steps(view) {
    const events = Array.isArray(view.events) ? view.events : [];
    const rounds = Array.isArray(view.rounds) ? view.rounds : [];
    const out = [];
    for (const r of rounds) {
      const mine = events.filter((e) => e.round === r.n);
      const each = mine.length ? Math.max(STEP_MIN, Math.min(STEP_MAX, ROUND_MS / mine.length)) : EMPTY_MS;
      mine.forEach((e, i) => out.push({ round: r.n, ms: each, x: r.n - 1 + (i + 1) / (mine.length + 1), e }));
      out.push({ round: r.n, ms: mine.length ? 220 : EMPTY_MS, x: r.n, end: r });
    }
    return { out, last: rounds.length };
  }

  // The badge's number: the value in tenths, counted by CSS.
  function setNumber(value) {
    const n = $('rt-r-num');
    n.textContent = value.toFixed(1);
    n.style.setProperty('--rt', String(Math.round(value * 10)));
    setTier($('rt-r-badge'), tierOf(value));
  }
  // The move beside the badge, rising in green or falling in red.
  function setDelta(delta) {
    const d = $('rt-r-delta');
    const up = /^\+/.test(delta);
    const down = /^-/.test(delta) && delta !== '-0.0';
    d.textContent = up || down ? delta : '';
    d.className = 'rt-r-delta';
    if (up || down) { void d.offsetWidth; d.className = `rt-r-delta ${up ? 'up' : 'down'}`; }
  }
  function pushFeed(e) {
    const f = $('rt-r-feed');
    const li = el('li', 'rt-f');
    li.append(el('span', 'rt-f-n', `R${e.round}`), el('span', 'rt-f-label', e.label),
      el('span', `rt-f-d${/^\+/.test(e.delta) ? ' up' : /^-/.test(e.delta) && e.delta !== '-0.0' ? ' down' : ''}`, e.delta === '0.0' ? '' : e.delta));
    f.prepend(li);
    while (f.children.length > FEED) f.lastElementChild.remove();
  }

  function open() { return !!run; }

  // `force` plays the steps under reduced motion too: the window check's, never a click's.
  function play(force) {
    const view = current;
    if (!view || typeof view.value !== 'number') return;
    stop();
    const box = $('rt-replay');
    const { out, last } = steps(view);
    run = { view, out, last, i: -1, timer: null, points: [{ x: 0, value: 6 }], done: false };
    run.chart = chart($('rt-r-line'), view, run.points);
    for (const m of run.chart.marks) m.classList.remove('on');
    run.chart.at(0, 6);
    setNumber(6);
    setDelta('');
    $('rt-r-feed').replaceChildren();
    $('rt-r-round').textContent = 'Kick off';
    $('rt-r-score').textContent = '0 : 0';
    $('rt-r-label').textContent = 'From 6.0, every move is the change in your chance to win the round.';
    $('rt-r-said').textContent = '';
    $('rt-r-skip').hidden = false;
    $('rt-r-close').hidden = true;
    $('rt-r-again').hidden = true;
    box.classList.remove('done');
    box.hidden = false;
    $('rt-r-skip').focus({ preventScroll: true });
    if (lessMotion() && force !== true) { finish(); return; }
    run.timer = setTimeout(next, OPEN_MS);
  }

  function next() {
    if (!run) return;
    if (document.hidden) { stop(); return; }
    run.i++;
    const s = run.out[run.i];
    if (!s) { finish(); return; }
    $('rt-r-round').textContent = `Round ${s.round} of ${run.last}`;
    if (s.e) {
      run.points.push({ x: s.x, value: s.e.value });
      setNumber(s.e.value);
      setDelta(s.e.delta);
      pushFeed(s.e);
      const l = $('rt-r-label');
      l.textContent = s.e.label;
      l.classList.remove('in');
      void l.offsetWidth;
      l.classList.add('in');
    } else if (s.end) {
      run.points.push({ x: s.x, value: s.end.value });
      setNumber(s.end.value);
      const sc = $('rt-r-score');
      if (sc.textContent !== s.end.score) {
        sc.textContent = s.end.score;
        sc.classList.remove('tick');
        void sc.offsetWidth;
        sc.classList.add('tick');
      }
      for (const m of run.chart.marks) if (Number(m.dataset.round) === s.round) m.classList.add('on');
    }
    const p = run.points[run.points.length - 1];
    run.chart.draw(run.points);
    run.chart.at(p.x, p.value);
    const now = $('rt-r-line').querySelector('.rt-now');
    if (now) { setTier(now, tierOf(p.value)); now.classList.remove('ping'); void now.offsetWidth; now.classList.add('ping'); }
    run.timer = setTimeout(next, s.ms);
  }

  /** Full time: the final rating, the place, the whole line, and the way out. */
  function finish() {
    if (!run) return;
    clearTimeout(run.timer);
    const v = run.view;
    run.points = [{ x: 0, value: 6 }];
    for (const s of run.out) run.points.push({ x: s.x, value: s.e ? s.e.value : s.end.value });
    run.chart.draw(run.points);
    run.chart.at(run.last, v.value);
    for (const m of run.chart.marks) m.classList.add('on');
    setNumber(v.value);
    setDelta('');
    const lastScore = (v.rounds || []).length ? v.rounds[v.rounds.length - 1].score : '';
    $('rt-r-score').textContent = lastScore;
    $('rt-r-round').textContent = 'Full time';
    $('rt-r-label').textContent = v.place ? `Full time, ${v.place} in the lobby.` : 'Full time.';
    // The feed becomes the match's story: its two biggest round gains and its biggest loss.
    const f = $('rt-r-feed');
    f.replaceChildren();
    for (const e of [...(v.gains || []).slice(0, 2), ...(v.losses || []).slice(0, 1)].reverse()) pushFeed({ round: e.round, label: e.label, delta: e.delta });
    $('rt-r-said').textContent = `Full time. Match rating ${v.shown}${v.place ? `, ${v.place} in the lobby` : ''}.`;
    $('rt-r-skip').hidden = true;
    $('rt-r-close').hidden = false;
    $('rt-r-again').hidden = false;
    $('rt-replay').classList.add('done');
    run.timer = null;
    run.done = true;
    $('rt-r-close').focus({ preventScroll: true });
  }

  /** Closed, wherever it was. */
  function stop() {
    if (run && run.timer) clearTimeout(run.timer);
    run = null;
    const box = $('rt-replay');
    if (box) box.hidden = true;
  }

  /** A key or a click while it plays: to full time; once there, closed. */
  function skipOrClose() {
    if (!run) return;
    if (run.done) { stop(); const b = $('rt-play'); if (b && !b.hidden) b.focus({ preventScroll: true }); } else finish();
  }

  const MODIFIERS = new Set(['Shift', 'Control', 'Alt', 'Meta', 'CapsLock', 'NumLock', 'ScrollLock', 'Fn', 'AltGraph', 'OS', 'Hyper', 'Super']);

  function wire() {
    const play$ = $('rt-play');
    if (!play$) return;
    play$.addEventListener('click', () => play(false));
    $('rt-r-skip').addEventListener('click', (e) => { e.stopPropagation(); finish(); });
    $('rt-r-close').addEventListener('click', (e) => { e.stopPropagation(); stop(); play$.focus({ preventScroll: true }); });
    $('rt-r-again').addEventListener('click', (e) => { e.stopPropagation(); play(false); });
    $('rt-replay').addEventListener('click', (e) => { if (e.target === $('rt-replay')) skipOrClose(); });
    document.addEventListener('keydown', (e) => {
      if (!run) return;
      // Tab stays inside the dialog, between its buttons that are shown.
      if (e.key === 'Tab') {
        const btns = [...$('rt-replay').querySelectorAll('button')].filter((b) => !b.hidden);
        if (!btns.length) return;
        e.preventDefault();
        e.stopPropagation();
        const i = btns.indexOf(document.activeElement);
        btns[(i + (e.shiftKey ? -1 : 1) + btns.length) % btns.length].focus({ preventScroll: true });
        return;
      }
      if (MODIFIERS.has(e.key)) return;
      if (e.target && e.target.tagName === 'BUTTON' && (e.key === 'Enter' || e.key === ' ')) return;
      // Before the page's own Esc, which would close the page under it.
      e.preventDefault();
      e.stopPropagation();
      skipOrClose();
    }, true);
    document.addEventListener('visibilitychange', () => { if (document.hidden) stop(); });
  }
  wire();

  window.RatingView = { paint, play, stop, open, finish, steps: (v) => steps(v || current || {}) };
})();
