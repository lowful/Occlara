'use strict';

/*
 * THE MATCH RATING ON THE REVIEW PAGE (docs/claude/rating.md).
 *
 * Paints what main served as `ratingView` (valorant-review.js withRating,
 * shared/rating.js viewOf): the number, the line across the match by round
 * with its biggest swings marked, the three biggest gains and losses (each
 * opens its round's row, its clip with it where one was kept), the place in
 * the lobby and the lobby by agent. Sides, agents, rounds and numbers only:
 * main sends no name, and nothing here could show one. Every string is set
 * as text.
 *
 * THE REPLAY plays the rating from 6.0 through the match, event by event, a
 * few seconds a round, over the page. The number counts through CSS alone
 * (rating.css, @property --rt over counter()): this file sets the value to
 * count to and never works a figure out. Skip, Esc, a click on the ground or
 * any key ends it at the final value. Under reduced motion theme.css takes
 * the durations to nothing, so each step is shown where it lands. It plays
 * only on screen: a page hidden (sealed mid match) stops it.
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

  // The line's height in the view box, and its floor and ceiling.
  const W = 600;
  const H = 100;
  function domain(line) {
    const vs = line.map((p) => p.value);
    return { lo: Math.min(5.5, ...vs) - 0.3, hi: Math.max(6.5, ...vs) + 0.3 };
  }

  /*
   * The line across the match: one point a round, 6.0 dashed behind it, the
   * swings marked by a dot in the outcome's colour at their round (a gain
   * above, a loss below the line, so the colour is never the only signal).
   * The dots are HTML over the stretched SVG so they stay round.
   */
  function drawLine(host, view, upTo) {
    const line = view.line || [];
    host.replaceChildren();
    if (line.length < 2) { host.hidden = true; return null; }
    const last = line[line.length - 1].n || 1;
    const { lo, hi } = domain(line);
    const x = (n) => (n / last) * W;
    const y = (v) => H - ((v - lo) / (hi - lo)) * H;
    const svg = document.createElementNS(SVG, 'svg');
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    svg.setAttribute('preserveAspectRatio', 'none');
    svg.setAttribute('class', 'rt-svg');
    svg.setAttribute('aria-hidden', 'true');
    const base = document.createElementNS(SVG, 'line');
    base.setAttribute('x1', '0'); base.setAttribute('x2', String(W));
    base.setAttribute('y1', String(y(6))); base.setAttribute('y2', String(y(6)));
    base.setAttribute('class', 'rt-base');
    svg.append(base);
    const path = document.createElementNS(SVG, 'path');
    path.setAttribute('d', line.map((p, i) => `${i ? 'L' : 'M'}${x(p.n).toFixed(1)} ${y(p.value).toFixed(1)}`).join(' '));
    path.setAttribute('class', 'rt-path');
    svg.append(path);
    const plot = el('div', 'rt-plot');
    plot.append(svg);
    const byRound = new Map(line.map((p) => [p.n, p.value]));
    const seen = new Set();
    for (const m of view.marks || []) {
      if (seen.has(`${m.round}:${m.up}`)) continue;
      seen.add(`${m.round}:${m.up}`);
      const v = byRound.get(m.round);
      if (typeof v !== 'number') continue;
      const dot = el('span', `rt-mark ${m.up ? 'up' : 'down'}`);
      dot.style.left = `${(x(m.round) / W) * 100}%`;
      dot.style.top = `${(y(v) / H) * 100}%`;
      dot.dataset.round = String(m.round);
      plot.append(dot);
    }
    const axis = el('div', 'rt-axis');
    axis.append(el('span', null, 'Round 1'), el('span', null, `Round ${last}`));
    host.append(plot, axis);
    host.hidden = false;
    if (typeof upTo === 'number') reveal(host, upTo, last);
    return { last };
  }

  // The replay's line shows the match up to a round, by its clip alone.
  function reveal(host, n, last) {
    const plot = host.querySelector('.rt-plot');
    if (!plot) return;
    const pct = Math.max(0, Math.min(100, 100 - (n / (last || 1)) * 100));
    plot.style.clipPath = `inset(-8px ${pct}% -8px -8px)`;
    for (const d of plot.querySelectorAll('.rt-mark')) d.classList.toggle('on', Number(d.dataset.round) <= n);
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
    $('rt-value').textContent = rated ? view.shown : '';
    $('rt-value').parentNode.hidden = !rated;
    // With no rating the head row goes too, so the note sits under the heading.
    wrap.querySelector('.rt-head').hidden = !rated;
    $('rt-note').textContent = rated ? '' : (view.note || '');
    $('rt-note').hidden = rated || !view.note;
    $('rt-place').textContent = rated && view.place ? `${view.place} in the lobby` : '';
    $('rt-place').hidden = !(rated && view.place);
    $('rt-play').hidden = !(rated && Array.isArray(view.events) && view.events.length);
    if (!rated) {
      $('rt-line').hidden = true; $('rt-line').replaceChildren();
      $('rt-swings').hidden = true; $('rt-lobby-wrap').hidden = true;
      return;
    }
    drawLine($('rt-line'), view);
    $('rt-gains').replaceChildren(...(view.gains || []).map((e) => swingRow(e, hooks)));
    $('rt-losses').replaceChildren(...(view.losses || []).map((e) => swingRow(e, hooks)));
    $('rt-swings').hidden = !((view.gains || []).length || (view.losses || []).length);
    const lobby = Array.isArray(view.lobby) ? view.lobby : [];
    $('rt-lobby-wrap').hidden = lobby.length < 2;
    $('rt-lobby').replaceChildren(...lobby.map((p) => {
      const li = el('li', `rt-lob${p.me ? ' me' : ''}`);
      li.append(el('span', 'rt-lob-agent', p.agent ? (p.me ? `${p.agent}, you` : p.agent) : (p.me ? 'You' : 'Unknown agent')),
        el('span', 'rt-lob-side', p.me ? 'Your team' : p.side === 'us' ? 'Your team' : 'Theirs'),
        el('span', 'rt-lob-val', p.value));
      return li;
    }));
  }

  /* ----------------------------------------------------------------- the replay */

  // A round's events share this much time, each between the two bounds; a
  // round with nothing of the player's passes in EMPTY_MS.
  const ROUND_MS = 2600;
  const STEP_MIN = 600;
  const STEP_MAX = 1200;
  const EMPTY_MS = 320;
  const OPEN_MS = 1400;

  let run = null;

  function steps(view) {
    const events = Array.isArray(view.events) ? view.events : [];
    const last = (view.line || []).length ? view.line[view.line.length - 1].n : 0;
    const out = [];
    for (let n = 1; n <= last; n++) {
      const mine = events.filter((e) => e.round === n);
      if (!mine.length) { out.push({ round: n, ms: EMPTY_MS }); continue; }
      const each = Math.max(STEP_MIN, Math.min(STEP_MAX, ROUND_MS / mine.length));
      for (const e of mine) out.push({ round: n, ms: each, e });
    }
    return { out, last };
  }

  function setNumber(value) {
    const n = $('rt-r-num');
    n.textContent = value.toFixed(1);
    n.style.setProperty('--rt', String(Math.round(value * 10)));
  }

  function open() { return !!run; }

  function play() {
    const view = current;
    if (!view || typeof view.value !== 'number') return;
    stop();
    const box = $('rt-replay');
    const { out, last } = steps(view);
    run = { view, out, last, i: -1, timer: null };
    drawLine($('rt-r-line'), view, 0);
    setNumber(6);
    $('rt-r-round').textContent = '';
    $('rt-r-delta').textContent = '';
    $('rt-r-delta').className = 'rt-r-delta';
    $('rt-r-label').textContent = 'From 6.0, every move is the change in your chance to win the round.';
    $('rt-r-skip').hidden = false;
    $('rt-r-close').hidden = true;
    $('rt-r-again').hidden = true;
    box.classList.remove('done');
    box.hidden = false;
    $('rt-r-skip').focus({ preventScroll: true });
    run.timer = setTimeout(next, OPEN_MS);
  }

  function next() {
    if (!run) return;
    if (document.hidden) { stop(); return; }
    run.i++;
    const s = run.out[run.i];
    if (!s) { finish(); return; }
    $('rt-r-round').textContent = `Round ${s.round} of ${run.last}`;
    reveal($('rt-r-line'), s.round, run.last);
    if (s.e) {
      setNumber(s.e.value);
      const d = $('rt-r-delta');
      const up = /^\+/.test(s.e.delta);
      const down = /^-/.test(s.e.delta);
      d.textContent = up || down ? s.e.delta : '';
      d.className = `rt-r-delta${up ? ' up' : down ? ' down' : ''}`;
      // Each new line rises in again (rating.css): the class off and on.
      const l = $('rt-r-label');
      l.textContent = s.e.label;
      l.classList.remove('in');
      void l.offsetWidth;
      l.classList.add('in');
    }
    run.timer = setTimeout(next, s.ms);
  }

  /** The final value, the place, and the way out. */
  function finish() {
    if (!run) return;
    clearTimeout(run.timer);
    const v = run.view;
    reveal($('rt-r-line'), run.last, run.last);
    setNumber(v.value);
    $('rt-r-round').textContent = 'Final';
    $('rt-r-delta').textContent = '';
    $('rt-r-delta').className = 'rt-r-delta';
    $('rt-r-label').textContent = v.place ? `Final rating, ${v.place} in the lobby.` : 'Final rating.';
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

  /** A key or a click while it plays: to the end; once ended, closed. */
  function skipOrClose() {
    if (!run) return;
    if (run.done) { stop(); const b = $('rt-play'); if (b && !b.hidden) b.focus({ preventScroll: true }); } else finish();
  }

  function wire() {
    const play$ = $('rt-play');
    if (!play$) return;
    play$.addEventListener('click', play);
    $('rt-r-skip').addEventListener('click', (e) => { e.stopPropagation(); finish(); });
    $('rt-r-close').addEventListener('click', (e) => { e.stopPropagation(); stop(); play$.focus({ preventScroll: true }); });
    $('rt-r-again').addEventListener('click', (e) => { e.stopPropagation(); play(); });
    $('rt-replay').addEventListener('click', (e) => { if (e.target === $('rt-replay')) skipOrClose(); });
    // Any key ends it; the buttons keep their own Enter and Space.
    document.addEventListener('keydown', (e) => {
      if (!run) return;
      if (e.target && e.target.tagName === 'BUTTON' && (e.key === 'Enter' || e.key === ' ')) return;
      if (e.key === 'Tab') return;
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
