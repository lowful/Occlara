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
      const D = 'M67.444,10.281 A50,50 0 1,0 107.855,80.274 A42,42 0 1,1 67.444,10.281 Z';
      g.append(svg('path', { d: D, fill: 'url(#mg)', class: 'm-glow' }), svg('path', { d: D, fill: 'url(#mg)' }));
      m.append(defs, g);
      moon.append(m);
      // The main agent, in the crescent's hollow.
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
