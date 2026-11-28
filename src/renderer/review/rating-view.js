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
 * and the place.
 *
 * A PLAYER SINCE 9.1 (the owner's item 16): pause and play, the previous and
 * the next event, a round on the line to go to it, Full time; and beside the
 * badge the moment itself, the clip kept of it from just before it, or its
 * kept frame, where the review has one (review.js mediaOf), the match's map
 * with a plain line where it has none. Space or K plays and pauses, the
 * arrows (or J and L) step an event, Home goes back to kick off and End to
 * full time; Esc or a click on the ground goes to full time, and a second
 * closes it. Tab stays inside it. Under reduced motion it opens at full time
 * and steps only when asked. Full time is announced, and a step taken by
 * hand; the steps it plays by itself are not. A hidden page (sealed mid
 * match) stops it.
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
  // The badge, its tiers and its move are one shared component
  // (shared/rating-badge.js), the Recording screen's and the widget's too.
  const { tierOf, setTier } = window.RatingBadge;

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
   * the chart: "Round 14, 7 : 7, +4, Triple kill with the opening kill".
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
        el('span', `rt-read-d${moveCls(r.delta)}`, r.delta),
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
      setTier(val, p.tier || tierOf(Number(p.value) / 10));
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
  // 9.1: an event whose clip was kept holds long enough to watch it, from
  // LEAD_S before the moment; one with a frame holds a beat. Played on after
  // a pause, the next step comes this soon.
  const CLIP_MS = 2800;
  const FRAME_MS = 1800;
  const LEAD_S = 1.8;
  const RESUME_MS = 600;
  const INTRO = 'From 60, every move is the change in your chance to win the round.';
  const NONE_KEPT = 'No clip or frame of this moment was kept';

  /*
   * WHAT AN EVENT WAS, FOR THE PLAYER (9.1): rating.js names every event of
   * the player's in plain words, each kind of them opening the same way
   * ("Died first, 5v5", "Kill, 4v3", "First kill, 5v5", "Traded a teammate,
   * 3v3", "Assist, 4v4"), so its opening says which it was. The kill's or the
   * death's moment is what the replay shows; anything else shows none. A
   * label no opening fits is null, and shows none either. test:reviewpage
   * holds every label rating.js writes on the sample matches to one role, and
   * each round's kills to Riot's count.
   */
  const ROLES = [
    [/^(?:Died|Killed by a teammate|Your ultimate ran out)\b/, 'death'],
    [/^(?:First kill|Kill|Traded a teammate)\b/, 'kill'],
    [/^Assist\b/, 'assist'],
    [/^(?:Planted the spike|Spike planted)\b/, 'plant'],
    [/^(?:Defused the spike|Spike defused)\b/, 'defuse'],
    [/^(?:Back in the round|Revived)\b/, 'revive'],
    [/^Your death was traded\b/, 'traded'],
    [/^Killed a teammate\b/, 'teamkill'],
  ];
  function roleOf(e) {
    if (!e) return null;
    if (e.kind === 'end') return 'end';
    const label = typeof e.label === 'string' ? e.label : '';
    for (const [re, role] of ROLES) if (re.test(label)) return role;
    return null;
  }

  let run = null;

  /**
   * Every step: the round's events in order, each at its place along the
   * round, then the round's result. An event step carries what it was for
   * the player (role) and, for a kill, which of the round's kills it is (nth).
   */
  function steps(view) {
    const events = Array.isArray(view.events) ? view.events : [];
    const rounds = Array.isArray(view.rounds) ? view.rounds : [];
    const out = [];
    for (const r of rounds) {
      const mine = events.filter((e) => e.round === r.n);
      const each = mine.length ? Math.max(STEP_MIN, Math.min(STEP_MAX, ROUND_MS / mine.length)) : EMPTY_MS;
      let kills = 0;
      mine.forEach((e, i) => {
        const role = roleOf(e);
        const nth = role === 'kill' ? kills++ : 0;
        out.push({ round: r.n, ms: each, x: r.n - 1 + (i + 1) / (mine.length + 1), e, role, nth });
      });
      out.push({ round: r.n, ms: mine.length ? 220 : EMPTY_MS, x: r.n, end: r });
    }
    return { out, last: rounds.length };
  }

  // The badge's number: the value on the 100 scale, counted by CSS.
  function setNumber(value) {
    window.RatingBadge.setNumber($('rt-r-num'), $('rt-r-badge'), value);
  }
  /** ' up', ' down' or '' for a move as shown on the 100 scale ("+4", "-3", "0"). */
  function moveCls(delta) {
    const way = window.RatingBadge.wayOf(delta);
    return way ? ` ${way}` : '';
  }
  // The move beside the badge, rising in green or falling in red.
  function setDelta(delta) {
    window.RatingBadge.setDelta($('rt-r-delta'), delta);
  }
  function feedRow(e) {
    const li = el('li', 'rt-f');
    li.append(el('span', 'rt-f-n', `R${e.round}`), el('span', 'rt-f-label', e.label),
      el('span', `rt-f-d${moveCls(e.delta)}`, window.RatingBadge.wayOf(e.delta) ? e.delta : ''));
    return li;
  }
  /** The feed as a list, newest first, drawn again only when it changed (its newest row rises in). */
  function paintFeed(list, key) {
    if (run && run.feedKey === key) return;
    if (run) run.feedKey = key;
    $('rt-r-feed').replaceChildren(...list.map(feedRow));
  }

  function open() { return !!run; }

  /* THE MOMENT: the clip from just before it, its frame, or the map and a line. */
  function mediaFor(s) {
    if (!s || !s.e) return null;
    if (s.media === undefined) {
      let m = null;
      try { m = hooks && typeof hooks.mediaOf === 'function' ? hooks.mediaOf(s.e, s.role, s.nth) : null; } catch (err) { m = null; }
      s.media = m && (typeof m.clip === 'string' || typeof m.frame === 'string') ? m : null;
    }
    return s.media;
  }
  function paintArt() {
    const host = $('rt-r-art');
    const url = hooks && typeof hooks.art === 'string' ? hooks.art : null;
    if (host.dataset.url === (url || '')) return;
    host.dataset.url = url || '';
    if (!url) { host.replaceChildren(); return; }
    const img = document.createElement('img');
    img.alt = '';
    img.decoding = 'async';
    img.addEventListener('error', () => img.remove(), { once: true });
    img.src = url;
    host.replaceChildren(img);
  }
  function showMedia(m, cap) {
    if (!run) return;
    const fig = $('rt-r-media');
    const v = $('rt-r-video');
    const img = $('rt-r-frame');
    const key = m ? (m.clip ? `c|${m.clip}|${m.at}` : `f|${m.frame}`) : `n|${cap || ''}`;
    if (run.mediaKey === key) { syncVideo(); return; }
    run.mediaKey = key;
    fig.classList.remove('has-clip', 'has-frame');
    v.loop = !!(m && m.clip && m.loop);
    if (m && m.clip) {
      const start = typeof m.at === 'number' && Number.isFinite(m.at) ? Math.max(0, m.at - LEAD_S) : 0;
      const go = () => {
        if (!run || run.mediaKey !== key) return;
        try { v.currentTime = start; } catch (err) { /* not seekable yet */ }
        syncVideo();
      };
      v.onseeked = () => v.classList.remove('loading');
      v.onerror = () => { if (run && run.mediaKey === key) { fig.classList.remove('has-clip'); $('rt-r-cap').textContent = NONE_KEPT; } };
      // Another clip is held out until it shows its frame; the next kill in the
      // same clip is a cut within it, as the game's own.
      if (v.dataset.src !== m.clip) v.classList.add('loading');
      if (v.dataset.src !== m.clip) {
        v.dataset.src = m.clip;
        v.onloadedmetadata = go;
        v.preload = 'auto';
        v.setAttribute('src', m.clip);
      } else {
        go();
      }
      fig.classList.add('has-clip');
      $('rt-r-cap').textContent = m.cap || '';
    } else if (m && m.frame) {
      if (typeof v.pause === 'function') v.pause();
      img.src = m.frame;
      fig.classList.add('has-frame');
      $('rt-r-cap').textContent = m.cap || '';
    } else {
      if (typeof v.pause === 'function') v.pause();
      $('rt-r-cap').textContent = cap || '';
    }
  }
  /** The clip plays while the replay does, and holds still while it is paused. */
  function syncVideo() {
    const v = $('rt-r-video');
    if (!run || !$('rt-r-media').classList.contains('has-clip')) return;
    // Full time's highlight loops on its own, the replay over, unless less
    // motion is asked (then it holds its first frame) or ambient motion is off.
    const calm = lessMotion() || (window.Motion && typeof window.Motion.ambientOn === 'function' && !window.Motion.ambientOn());
    const go = run.playing || (run.done && v.loop === true && !calm);
    if (go && v.paused && typeof v.play === 'function') { const p = v.play(); if (p && typeof p.catch === 'function') p.catch(() => {}); }
    else if (!go && !v.paused && typeof v.pause === 'function') v.pause();
  }
  function releaseVideo() {
    const v = $('rt-r-video');
    if (!v) return;
    v.onloadedmetadata = null;
    v.onseeked = null;
    v.onerror = null;
    if (typeof v.pause === 'function') v.pause();
    delete v.dataset.src;
    if (v.getAttribute('src')) { v.removeAttribute('src'); if (typeof v.load === 'function') v.load(); }
    $('rt-r-media').classList.remove('has-clip', 'has-frame');
  }
  /** How long a step holds while the replay plays. */
  function durationOf(s) {
    if (!s) return OPEN_MS;
    const m = s.e ? mediaFor(s) : null;
    return m && m.clip ? CLIP_MS : m && m.frame ? FRAME_MS : s.ms;
  }

  /*
   * THE REPLAY AT STEP i, drawn whole from the steps before it (-1 is kick
   * off), so a step back is as true as a step on: the line to there, the
   * score, the number, the move and the label of the last event, the feed's
   * last four, the swings' dots of the rounds ended, and the moment. `anim`
   * is a step the replay plays by itself, whose score ticks and point pings.
   */
  function render(i, anim) {
    const r = run;
    r.i = i;
    r.done = false;
    $('rt-replay').classList.remove('done');
    const pts = [{ x: 0, value: 6 }];
    let score = '0 : 0';
    let ev = null;
    const feed = [];
    const ended = new Set();
    for (let j = 0; j <= i && j < r.out.length; j++) {
      const s = r.out[j];
      if (s.e) {
        pts.push({ x: s.x, value: s.e.value }); ev = s.e; feed.push(j);
        // "Round won" is the round's end: its score shows with it, not a step after.
        if (s.e.kind === 'end') { const end = r.out.find((x) => x.end && x.round === s.round); if (end) score = end.end.score; }
      } else if (s.end) { pts.push({ x: s.x, value: s.end.value }); score = s.end.score; ended.add(s.round); }
    }
    const s = i >= 0 ? r.out[i] : null;
    const p = pts[pts.length - 1];
    $('rt-r-round').textContent = s ? `Round ${s.round} of ${r.last}` : 'Kick off';
    const sc = $('rt-r-score');
    if (sc.textContent !== score) {
      sc.textContent = score;
      if (anim) { sc.classList.remove('tick'); void sc.offsetWidth; sc.classList.add('tick'); }
    }
    setNumber(p.value);
    if (s && s.e) setDelta(s.e.delta);
    else if (!s) setDelta('');
    const l = $('rt-r-label');
    const text = ev ? ev.label : INTRO;
    if (l.textContent !== text) {
      l.textContent = text;
      l.classList.remove('in');
      void l.offsetWidth;
      l.classList.add('in');
    }
    const last = feed.slice(-FEED).reverse();
    paintFeed(last.map((j) => r.out[j].e), last.join(','));
    r.chart.draw(pts);
    r.chart.at(p.x, p.value);
    for (const m of r.chart.marks) m.classList.toggle('on', ended.has(Number(m.dataset.round)));
    const now = $('rt-r-line').querySelector('.rt-now');
    if (now) {
      setTier(now, tierOf(p.value));
      if (anim) { now.classList.remove('ping'); void now.offsetWidth; now.classList.add('ping'); }
    }
    // A round's end keeps the moment of its last event on screen.
    if (s && s.e) showMedia(mediaFor(s), NONE_KEPT);
    else if (!s) showMedia(null, '');
    paintTransport();
  }

  /** The controls as the replay stands: pause or play, the steps either way, Full time or Watch again. */
  function paintTransport() {
    const box = $('rt-replay');
    const playing = !!(run && run.playing);
    const done = !!(run && run.done);
    box.classList.toggle('paused', !playing);
    const t = $('rt-r-toggle');
    const name = playing ? 'Pause' : done ? 'Watch again' : 'Play';
    t.setAttribute('aria-label', name);
    t.title = `${name} (Space)`;
    $('rt-r-prev').disabled = !run || (run.i < 0 && !done);
    $('rt-r-next').disabled = !run || done;
    $('rt-r-skip').hidden = !run || done;
    $('rt-r-again').hidden = !run || !done;
    // A control the keyboard was on, gone or turned off, hands it to play and pause.
    const a = document.activeElement;
    if (run && a && box.contains(a) && (a.disabled || a.hidden)) t.focus({ preventScroll: true });
  }

  // `force` plays the steps under reduced motion too: the window check's, never a click's.
  function play(force) {
    const view = current;
    if (!view || typeof view.value !== 'number') return;
    stop();
    const box = $('rt-replay');
    const { out, last } = steps(view);
    run = { view, out, last, i: -1, timer: null, playing: false, done: false, mediaKey: null, feedKey: null };
    run.chart = chart($('rt-r-line'), view, [{ x: 0, value: 6 }]);
    seekable(run.chart);
    box.classList.remove('done');
    box.hidden = false;
    paintArt();
    $('rt-r-said').textContent = '';
    render(-1, false);
    if (lessMotion() && force !== true) { finish(); return; }
    run.playing = true;
    paintTransport();
    $('rt-r-toggle').focus({ preventScroll: true });
    run.timer = setTimeout(tick, OPEN_MS);
  }

  /** One step on, as the replay plays by itself. */
  function tick() {
    if (!run || !run.playing) return;
    if (document.hidden) { stop(); return; }
    const i = run.i + 1;
    if (i >= run.out.length) { finish(); return; }
    render(i, true);
    run.timer = setTimeout(tick, durationOf(run.out[i]));
  }
  // The name kept for the window check and older callers: one step on.
  const next = tick;

  function pause() {
    if (!run || !run.playing) return;
    run.playing = false;
    clearTimeout(run.timer);
    run.timer = null;
    syncVideo();
    paintTransport();
  }
  function resume() {
    if (!run || run.playing) return;
    if (run.done) { restart(); return; }
    run.playing = true;
    syncVideo();
    paintTransport();
    const s = run.i >= 0 ? run.out[run.i] : null;
    const m = s && s.e ? mediaFor(s) : null;
    run.timer = setTimeout(tick, m && m.clip ? CLIP_MS / 2 : RESUME_MS);
  }
  function togglePlay() { if (!run) return; if (run.playing) pause(); else resume(); }
  /** From kick off again, playing. */
  function restart() {
    if (!run) return;
    clearTimeout(run.timer);
    run.playing = true;
    run.done = false;
    run.feedKey = null;
    render(-1, false);
    $('rt-r-said').textContent = '';
    run.timer = setTimeout(tick, OPEN_MS);
  }

  /** To step j (an event, or -1 for kick off), by hand: it plays on from there if it was playing. */
  function jump(j, said) {
    if (!run) return;
    clearTimeout(run.timer);
    run.timer = null;
    render(Math.max(-1, Math.min(j, run.out.length - 1)), false);
    const s = run.i >= 0 ? run.out[run.i] : null;
    if (said !== false) {
      $('rt-r-said').textContent = s && s.e
        ? `Round ${s.round}, ${s.e.label}, ${s.e.delta}. Match rating ${$('rt-r-num').textContent}.`
        : 'Kick off. Match rating 60.';
    }
    if (run.playing) run.timer = setTimeout(tick, durationOf(s));
  }
  function nextEvent() {
    if (!run || run.done) return;
    let j = run.i + 1;
    while (j < run.out.length && !run.out[j].e) j++;
    if (j >= run.out.length) { finish(); return; }
    jump(j);
  }
  function prevEvent() {
    if (!run) return;
    let j = (run.done ? run.out.length : run.i) - 1;
    while (j >= 0 && !run.out[j].e) j--;
    jump(j);
  }
  /** A round on the replay's line, clicked: its first event, or its end with none. */
  function seekable(c) {
    if (!c || !c.plot) return;
    c.plot.classList.add('seek');
    c.plot.addEventListener('click', (e) => {
      if (!run) return;
      const box = c.plot.getBoundingClientRect();
      const n = Math.max(1, Math.min(run.last, Math.ceil(((e.clientX - box.left) / Math.max(1, box.width)) * c.last)));
      let j = run.out.findIndex((s) => s.round === n && s.e);
      if (j < 0) j = run.out.findIndex((s) => s.round === n && s.end);
      if (j >= 0) jump(j);
    });
  }

  /** Full time: the final rating, the place, the whole line, and the way out. */
  function finish() {
    if (!run) return;
    clearTimeout(run.timer);
    const v = run.view;
    const pts = [{ x: 0, value: 6 }];
    for (const s of run.out) pts.push({ x: s.x, value: s.e ? s.e.value : s.end.value });
    run.chart.draw(pts);
    run.chart.at(run.last, v.value);
    for (const m of run.chart.marks) m.classList.add('on');
    setNumber(v.value);
    setDelta('');
    const lastScore = (v.rounds || []).length ? v.rounds[v.rounds.length - 1].score : '';
    $('rt-r-score').textContent = lastScore;
    $('rt-r-round').textContent = 'Full time';
    $('rt-r-label').textContent = v.place ? `Full time, ${v.place} in the lobby.` : 'Full time.';
    // The feed becomes the match's story: its two biggest round gains and its biggest loss.
    run.feedKey = 'story';
    $('rt-r-feed').replaceChildren(...[...(v.gains || []).slice(0, 2), ...(v.losses || []).slice(0, 1)]
      .map((e) => feedRow({ round: e.round, label: e.label, delta: e.delta })));
    $('rt-r-said').textContent = `Full time. Match rating ${v.shown}${v.place ? `, ${v.place} in the lobby` : ''}.`;
    run.timer = null;
    run.playing = false;
    run.done = true;
    run.i = run.out.length;
    // Full time plays the match's best highlight, looping, where one was kept.
    let best = null;
    try { best = hooks && typeof hooks.best === 'function' ? hooks.best() : null; } catch (err) { best = null; }
    showMedia(best && typeof best.clip === 'string' ? { ...best, loop: true } : null, '');
    $('rt-replay').classList.add('done');
    paintTransport();
    $('rt-r-close').focus({ preventScroll: true });
  }

  /** Closed, wherever it was, its clip let go. */
  function stop() {
    if (run && run.timer) clearTimeout(run.timer);
    run = null;
    releaseVideo();
    const box = $('rt-replay');
    if (box) box.hidden = true;
  }

  /** Esc or a click on the ground while it plays: to full time; once there, closed. */
  function skipOrClose() {
    if (!run) return;
    if (run.done) { stop(); const b = $('rt-play'); if (b && !b.hidden) b.focus({ preventScroll: true }); } else finish();
  }

  const MODIFIERS = new Set(['Shift', 'Control', 'Alt', 'Meta', 'CapsLock', 'NumLock', 'ScrollLock', 'Fn', 'AltGraph', 'OS', 'Hyper', 'Super']);
  // The player's keys, as a video player's.
  const KEYS = {
    ' ': togglePlay, k: togglePlay, K: togglePlay,
    ArrowLeft: prevEvent, j: prevEvent, J: prevEvent,
    ArrowRight: nextEvent, l: nextEvent, L: nextEvent,
    Home: () => jump(-1), End: () => finish(),
    Escape: skipOrClose,
  };

  function wire() {
    const play$ = $('rt-play');
    if (!play$) return;
    play$.addEventListener('click', () => play(false));
    $('rt-r-skip').addEventListener('click', (e) => { e.stopPropagation(); finish(); });
    $('rt-r-close').addEventListener('click', (e) => { e.stopPropagation(); stop(); play$.focus({ preventScroll: true }); });
    $('rt-r-again').addEventListener('click', (e) => { e.stopPropagation(); restart(); $('rt-r-toggle').focus({ preventScroll: true }); });
    $('rt-r-toggle').addEventListener('click', (e) => { e.stopPropagation(); togglePlay(); });
    $('rt-r-prev').addEventListener('click', (e) => { e.stopPropagation(); prevEvent(); });
    $('rt-r-next').addEventListener('click', (e) => { e.stopPropagation(); nextEvent(); });
    $('rt-replay').addEventListener('click', (e) => { if (e.target === $('rt-replay')) skipOrClose(); });
    document.addEventListener('keydown', (e) => {
      if (!run) return;
      // Tab stays inside the dialog, between its buttons that are shown and on.
      if (e.key === 'Tab') {
        const btns = [...$('rt-replay').querySelectorAll('button')].filter((b) => !b.hidden && !b.disabled);
        if (!btns.length) return;
        e.preventDefault();
        e.stopPropagation();
        const i = btns.indexOf(document.activeElement);
        btns[(i + (e.shiftKey ? -1 : 1) + btns.length) % btns.length].focus({ preventScroll: true });
        return;
      }
      if (MODIFIERS.has(e.key) || e.ctrlKey || e.metaKey || e.altKey) return;
      // Enter and Space on a button press that button, as everywhere.
      if (e.target && e.target.tagName === 'BUTTON' && (e.key === 'Enter' || e.key === ' ')) return;
      const act = KEYS[e.key];
      // Before the page's own Esc, which would close the page under it.
      e.preventDefault();
      e.stopPropagation();
      if (act) act();
    }, true);
    document.addEventListener('visibilitychange', () => { if (document.hidden) stop(); });
    // A match starting (html.rec-still, main's) stops it too.
    if (window.Motion && typeof window.Motion.onAmbient === 'function') {
      window.Motion.onAmbient(() => { if (window.Motion.still()) stop(); });
    }
  }
  wire();

  window.RatingView = {
    paint, play, stop, open, finish, next, pause, resume, nextEvent, prevEvent, roleOf,
    state: () => (run ? { i: run.i, playing: run.playing, done: run.done, media: run.mediaKey } : null),
    steps: (v) => steps(v || current || {}),
  };
})();
