'use strict';

/**
 * The grade and the three insight lists, drawn the same way everywhere they
 * appear: the review, the match library and Home. A match graded from Riot's
 * record alone has one list of facts in place of the three. A row that has
 * room for the letter alone draws it with letter(), and Stats takes its
 * colours from here.
 *
 * TEXT ONLY, never innerHTML. Detail lines carry agent names, callouts and the
 * coach's sentences about a frame, and none of that is ours to trust as markup.
 *
 * A plain script that sets window.GradeView, because there is no build step and
 * each surface loads it with a <script> tag after i18n-apply.js.
 */
(function () {
  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined && text !== null) n.textContent = String(text);
    return n;
  }

  /*
   * THE ONE GRADE COLOUR RULE, keyed to the letter bands in src/shared/grade.js.
   *
   * There used to be three. Letters went by tone() below, numbers by a
   * scoreTone() with its own cut-offs at 80, 65 and 50, and Stats by a
   * ratingClass() at 85, 70 and 55, so one 58 was a red D in its library row,
   * a yellow bar in the trend above that row and a yellow 58 in Stats, and an
   * 82 A was green everywhere except Stats, where it was white. Every grade the
   * app draws now goes through here: the panel, the library, Stats and the
   * review, the categories included, so a category and an overall reading the
   * same number can never disagree on one card.
   *
   * letterOf() mirrors grade.js letter() because a renderer cannot require
   * src/shared, and npm run test:surfaces asserts the two agree on every score
   * from 0 to 100.
   */

  /** S 90+, A 80+, B 70+, C 60+, D below. The same bands as grade.js. */
  function letterOf(score) {
    if (typeof score !== 'number' || !Number.isFinite(score)) return null;
    return score >= 90 ? 'S' : score >= 80 ? 'A' : score >= 70 ? 'B' : score >= 60 ? 'C' : 'D';
  }

  /** S and A read as good, B as neutral, C as a warning, D as a problem. */
  function tone(letter) {
    return letter === 'S' || letter === 'A' ? 'good' : letter === 'B' ? 'mid' : letter === 'C' ? 'warn' : 'bad';
  }

  /**
   * A bare number, such as a category score, coloured as its letter would be.
   * No number, no colour: tone() reads a missing letter as a D, and a grade
   * that does not exist must not be painted as a bad one.
   */
  function scoreTone(score) {
    const l = letterOf(score);
    return l ? tone(l) : '';
  }

  /**
   * A grade object ({ score, letter }) or a bare score. The letter the grade
   * carries wins, because it is the one printed beside the colour.
   */
  function gradeTone(g) {
    if (g && typeof g === 'object') return g.letter ? tone(g.letter) : scoreTone(g.score);
    return scoreTone(g);
  }

  /**
   * THE LETTER ALONE (8.6), for a row or a chip with no room for the card:
   * the square in its tone with the letter in it, the one drawing the library,
   * the breakdown and Stats use rather than a letter chip each. `g` is a
   * score or a grade ({ score, letter }), whose own letter wins; `opts.size`
   * is 'sm' (28px) or 'xs' (20px), the card's 40px without it. No grade is a
   * '?' in no colour, never a D.
   */
  function letter(g, opts) {
    const o = opts || {};
    const grade = g && typeof g === 'object' ? g : { score: g, letter: letterOf(g) };
    const l = grade.letter || letterOf(grade.score);
    const size = o.size === 'sm' || o.size === 'xs' ? ' ' + o.size : '';
    return el('span', 'gv-letter ' + (l ? gradeTone(grade) : 'none') + size, l || '?');
  }

  /*
   * A LEADING NUMBER IN BOLD (8.7), for display only: "8 deaths in 13 rounds"
   * draws its 8 in <b>, so a row of chips reads as numbers first. A pattern on
   * the text grade.js wrote, never a sum, the same kind as the review's
   * versus() reading a sign. Text with no number first is drawn as it is.
   */
  const LEAD_NUM = /^(\d+(?:[.,]\d+)?%?)(\s[\s\S]*)$/;

  /** One piece of evidence as a stat chip. */
  function chip(text, cls) {
    const c = el('span', cls || 'gv-chip');
    const m = LEAD_NUM.exec(String(text));
    if (m) c.append(el('b', null, m[1]), document.createTextNode(m[2]));
    else c.textContent = String(text);
    return c;
  }

  /**
   * The grade card: the number, the letter, and each category with the facts
   * it was built on. A category that could not be measured says so rather than
   * showing a zero. `opts.compact` leaves out the row of the number and the
   * letter, for a page that shows them already (the review, under its
   * Verdict); the categories and their evidence stay. `opts.reveal` gives each
   * bar its place in the order (--i), for the review's reveal to stagger by;
   * the card draws the same without it.
   */
  function gradeCard(grade, opts) {
    const o = opts || {};
    const card = el('section', 'gv-grade' + (o.compact ? ' compact' : ''));
    if (!grade) return card;
    if (!o.compact) {
      const top = el('div', 'gv-top');
      const hasScore = typeof grade.score === 'number';
      const score = el('div', 'gv-score', hasScore ? grade.score : '--');
      const mark = el('div', 'gv-letter ' + (hasScore ? tone(grade.letter) : 'none'), hasScore ? grade.letter : '?');
      const meta = el('div', 'gv-meta');
      meta.append(el('div', 'gv-label', o.label || 'Match grade'));
      meta.append(el('div', 'gv-sub', !hasScore ? 'Not enough measured to grade this match'
        : grade.provisional ? 'Provisional: some of the record is still missing' : 'Out of 100, from what the record shows'));
      top.append(score, mark, meta);
      card.append(top);
    }

    // NOTHING MEASURED (Progress v3): a match with no Riot record has every
    // category unmeasured, and four "not measured" rows with one sentence read
    // half empty. It is one panel instead: what is missing, why, and the one
    // thing to do (opts.onAddRiot draws "Add your Riot ID").
    const all = grade.categories || [];
    if (all.length && all.every((c) => c.score === null) && !o.keepRows) {
      const box = el('div', 'gv-empty');
      box.append(el('b', 'gv-empty-title', 'The grade needs Riot\'s record'));
      box.append(el('p', 'gv-empty-line', (grade.notes && grade.notes[0]) || 'Survival, impact, teamplay and decisions are counted from Riot\'s record of the match, so there is nothing to grade yet.'));
      if (typeof o.onAddRiot === 'function') {
        const b = el('button', 'btn btn-primary sm', 'Add your Riot ID');
        b.type = 'button';
        b.addEventListener('click', o.onAddRiot);
        box.append(b);
      }
      card.append(box);
      card.classList.add('empty');
      return card;
    }
    const cats = el('div', 'gv-cats');
    all.forEach((c, i) => {
      const row = el('div', 'gv-cat' + (c.score === null ? ' unmeasured' : ''));
      const head = el('div', 'gv-cat-head');
      head.append(el('span', 'gv-cat-name', c.label));
      head.append(el('b', 'gv-cat-score ' + (c.score === null ? '' : scoreTone(c.score)), c.score === null ? 'not measured' : c.score));
      row.append(head);
      const bar = el('div', 'gv-bar');
      const fill = el('i', c.score === null ? '' : scoreTone(c.score));
      fill.style.setProperty('--w', (c.score === null ? 0 : Math.max(2, Math.min(100, c.score))) + '%');
      if (o.reveal) fill.style.setProperty('--i', String(i));
      bar.append(fill);
      row.append(bar);
      // The facts the category was built on, a chip each, where they were one
      // line joined by dots.
      if (c.evidence && c.evidence.length) {
        const chips = el('div', 'gv-chips');
        for (const e of c.evidence) chips.append(chip(e));
        row.append(chips);
      }
      cats.append(row);
    });
    card.append(cats);
    for (const n of grade.notes || []) card.append(el('p', 'gv-note', n));
    return card;
  }

  /** "R2", "R9", ... as chips, clickable when the caller can jump to a round. */
  function roundChips(rounds, onRound) {
    const wrap = el('div', 'gv-rounds');
    for (const n of (rounds || []).slice(0, 12)) {
      const chip = el(onRound ? 'button' : 'span', 'gv-rchip', `R${n}`);
      if (onRound) {
        chip.type = 'button';
        chip.addEventListener('click', () => onRound(n));
      }
      wrap.append(chip);
    }
    return wrap;
  }

  /**
   * One entry. `brief` (the review's saidInRound, below) is an entry whose
   * sentences its round's row says on the same page: its title with its round
   * chip beside it, one line, the chip jumping to the round.
   */
  function item(e, kind, onRound, brief) {
    const li = el('li', 'gv-item ' + kind + (brief ? ' brief' : ''));
    const head = el('div', 'gv-item-head');
    head.append(el('span', 'gv-dot'));
    head.append(el('b', 'gv-item-title', e.title));
    if (brief) head.append(roundChips(e.rounds, onRound));
    if (e.judged && kind !== 'fact') head.append(el('span', 'gv-badge', "coach's look"));
    li.append(head);
    if (brief) return li;
    if (e.detail) li.append(el('p', 'gv-item-detail', e.detail));
    // A fact is never a mistake, so it never carries a fix.
    if (e.fix && e.fix !== e.detail && kind !== 'fact') {
      const fix = el('p', 'gv-item-fix');
      fix.append(el('span', 'gv-fix-label', 'Fix'), document.createTextNode(e.fix));
      li.append(fix);
    }
    if (e.rounds && e.rounds.length && onRound !== false) li.append(roundChips(e.rounds, onRound));
    return li;
  }

  /** The fix as the line to act on: an arrow, its label, the sentence, larger than the detail. */
  function action(fix) {
    const p = el('p', 'gv-action');
    const mark = el('span', 'gv-action-mark', '→');
    mark.setAttribute('aria-hidden', 'true');
    p.append(mark, el('span', 'gv-fix-label', 'Fix'), document.createTextNode(fix));
    return p;
  }

  /*
   * THE LISTS RANKED (8.7, `opts.hero`, the review's): the top mistake is a
   * card of its own, its fix the line to act on, and every other entry one
   * line, closed, that opens to its detail and fix. A wall of entries each as
   * loud as the next read as none of them mattering more.
   */
  function hero(e, kind, onRound) {
    const li = el('li', 'gv-item gv-hero ' + kind);
    const head = el('div', 'gv-item-head');
    head.append(el('span', 'gv-dot'), el('b', 'gv-item-title', e.title));
    if (e.judged) head.append(el('span', 'gv-badge', "coach's look"));
    li.append(head);
    if (e.detail) li.append(el('p', 'gv-item-detail', e.detail));
    if (e.fix && e.fix !== e.detail) li.append(action(e.fix));
    if (e.rounds && e.rounds.length && onRound !== false) li.append(roundChips(e.rounds, onRound));
    return li;
  }

  /** One entry, closed: its title and how many rounds, opening to the rest. */
  function closedRow(e, kind, onRound) {
    const li = el('li', 'gv-item gv-rowed ' + kind);
    const row = el('details', 'gv-row');
    const head = el('summary', 'gv-item-head');
    head.append(el('span', 'gv-dot'), el('b', 'gv-item-title', e.title));
    const n = Array.isArray(e.rounds) ? e.rounds.length : 0;
    if (n) head.append(el('span', 'gv-count', `${n} round${n === 1 ? '' : 's'}`));
    if (e.judged) head.append(el('span', 'gv-badge', "coach's look"));
    row.append(head);
    const body = el('div', 'gv-row-body');
    if (e.detail) body.append(el('p', 'gv-item-detail', e.detail));
    if (e.fix && e.fix !== e.detail) {
      const fix = el('p', 'gv-item-fix');
      fix.append(el('span', 'gv-fix-label', 'Fix'), document.createTextNode(e.fix));
      body.append(fix);
    }
    if (n && onRound !== false) body.append(roundChips(e.rounds, onRound));
    if (body.children.length) row.append(body);
    li.append(row);
    return li;
  }

  /**
   * WHAT RIOT'S RECORD SHOWS, for a review graded from it alone: one neutral
   * list in place of the three. Riot records what happened and never why, so
   * each entry is a count with its rounds, under a title that claims nothing
   * more (insights.js asFacts), with no fix and no verdict colour on its dot.
   */
  function factList(facts, opts) {
    const o = opts || {};
    const list = Array.isArray(facts) ? facts : [];
    const wrap = el('div', 'gv-insights');
    if (!list.length) {
      wrap.append(el('p', 'gv-empty', o.factsEmpty || "Nothing in Riot's record of this match cleared the bar to be listed here."));
      return wrap;
    }
    const block = el('section', 'gv-block gv-facts');
    block.append(el('h3', null, o.factsTitle || "What Riot's record shows"));
    const ul = el('ul', 'gv-list');
    for (const e of list.slice(0, o.factsLimit || 12)) ul.append(item(e, 'fact', o.onRound));
    block.append(ul);
    wrap.append(block);
    return wrap;
  }

  /**
   * The three lists. Each is left out when it has nothing, and the whole block
   * says so when all three are empty, because a blank section reads as broken.
   * A review's insights that carry facts are a review graded from Riot's record
   * alone, and are drawn as facts wherever they are drawn.
   *
   * @param opts.saidInRound  (entry) => true when the page says the entry's
   *   sentences in its round's own row: the review page passes it for a death
   *   the coach looked at, so it is said once. Taken only with an onRound to
   *   jump there; the library and Home pass neither.
   * @param opts.hero  the lists ranked (hero() above): the top mistake a card,
   *   the rest closed rows. An entry said in its round stays brief.
   */
  function insightLists(insights, opts) {
    const o = opts || {};
    const ins = insights || {};
    if (Array.isArray(ins.facts)) return factList(ins.facts, o);
    const brief = (e) => typeof o.onRound === 'function' && typeof o.saidInRound === 'function'
      && Array.isArray(e.rounds) && e.rounds.length > 0 && !!o.saidInRound(e);
    const wrap = el('div', 'gv-insights');
    const blocks = [
      ['mistakes', o.mistakesTitle || 'Your repeated mistakes', 'bad'],
      ['strengths', o.strengthsTitle || 'What went well', 'good'],
      ['missed', o.missedTitle || 'What you missed', 'warn'],
    ];
    let any = false;
    for (const [key, title, kind] of blocks) {
      const list = ins[key] || [];
      if (!list.length) continue;
      any = true;
      const block = el('section', 'gv-block');
      block.append(el('h3', null, title));
      const ul = el('ul', 'gv-list');
      list.slice(0, o.limit || 6).forEach((e, i) => {
        const b = brief(e);
        if (!o.hero || b) ul.append(item(e, kind, o.onRound, b));
        else if (key === 'mistakes' && i === 0) ul.append(hero(e, kind, o.onRound));
        else ul.append(closedRow(e, kind, o.onRound));
      });
      block.append(ul);
      wrap.append(block);
    }
    if (!any) wrap.append(el('p', 'gv-empty', o.empty || 'Nothing cleared the bar to be called a pattern in this match. That is usually a good sign.'));
    return wrap;
  }

  /*
   * A REVIEW STILL BEING CHECKED (8.4.1), in its grade's place. Until a review
   * is whole its grade, result and score are the screen's, and Riot's record
   * changes them minutes later (the review page shows a loading screen
   * meanwhile), so its row in Matches and Home's recent matches show this pill
   * where the grade would be, and Home's last match the card (`full`), saying
   * what it waits for. Drawn here, as every grade is, so the three agree.
   *
   * `work` is the review's work from main ({ path: 'riot' | 'screen', step }),
   * and none draws nothing.
   */
  const CHECKING = {
    riot: { pill: 'Checking', title: "Being checked against Riot's record",
      sub: 'Riot publishes a match 1 to 4 minutes after it ends. Its grade shows here once the review is complete.' },
    screen: { pill: 'Writing', title: 'The review is being written',
      sub: 'Its grade shows here once the review is complete.' },
  };
  function checking(work, opts) {
    const w = work && CHECKING[work.path] ? CHECKING[work.path] : null;
    if (!w) return null;
    const pill = el('span', 'gv-checking');
    pill.append(el('i', 'gv-checking-dot'), document.createTextNode(w.pill));
    pill.title = w.title;
    if (!(opts && opts.full)) return pill;
    const card = el('section', 'gv-checking-card');
    card.setAttribute('role', 'status');
    card.append(pill, el('div', 'gv-checking-title', w.title), el('p', 'gv-sub', w.sub));
    return card;
  }

  /*
   * THIS MATCH AGAINST THE ONES BEFORE IT (8.7): the finished lines
   * shared/progress.js wrote ("Best grade in your last 23 graded matches.",
   * "Up 6 on your last match."), a chip each in its tone. Each line carries its
   * sign and its window in words, so the colour is never the only signal and
   * nothing here counts. `opts.omit` leaves out lines of the kinds named, for a
   * page that says one elsewhere (the review says the focus line above its
   * focus). Null when there is nothing to say.
   */
  const PROG_TONES = new Set(['good', 'bad', 'even']);
  function progressStrip(progress, opts) {
    const omit = new Set((opts && opts.omit) || []);
    const lines = (progress && Array.isArray(progress.lines) ? progress.lines : [])
      .filter((l) => l && typeof l.text === 'string' && l.text && !omit.has(l.kind));
    if (!lines.length) return null;
    const ul = el('ul', 'gv-progs');
    for (const l of lines) {
      const li = el('li', 'gv-prog ' + (PROG_TONES.has(l.tone) ? l.tone : 'even'), l.text);
      if (l.kind) li.dataset.kind = String(l.kind);
      ul.append(li);
    }
    return ul;
  }

  /** "9:46", the hour and minutes alone, for the grade line's foot. */
  function clock(at) {
    if (!at) return '';
    const d = new Date(at);
    const h = d.getHours() % 12 || 12;
    return `${h}:${String(d.getMinutes()).padStart(2, '0')}`;
  }

  /*
   * THE GRADE LINE (Progress v3): grades as a line, oldest on the left, each
   * a dot with its number over it and its time under it, the newest larger
   * and filled. Home's last match, Matches' side card. Drawn in its own
   * pixels at the size asked (no stretch), so the dots stay round; under two
   * grades it draws nothing. `points` is [{ score, at }], oldest first.
   *
   * THE FOOT NEVER RUNS TOGETHER (8.9.1): at eight points in Matches' 216px
   * card the times stood 25px apart and read as one string, "8:259:043:54".
   * Each label is measured (the mono face is 0.6em a figure) and kept only
   * when it clears the one kept to its right by a gap, newest first, so the
   * newest is always labelled; a label the same as that one is skipped, and
   * one at the edge is pulled inside the box. `opts.foot` names the label of a
   * point (the clock by default).
   *
   * A NUMBER NEVER SITS ON THE LINE (8.9.2): every number used to stand 12px
   * over its dot, so a point the line rose into or fell from had its number
   * on the segment ("64" on the climb to 97, "71" and "73" on the line). Each
   * number now takes the clear side of its dot: over a peak or a flat point,
   * under a valley, and on a slope whichever of above, below or the two
   * diagonals away from the line is clear (`placeNums`). A place is clear when
   * the number's box, grown by the line's half width and a margin, crosses no
   * segment and no dot, overlaps no number already placed, and stays between
   * the top of the box and the foot. The plot keeps room over its highest dot
   * and under its lowest for a number, so either side always fits. A line that
   * still passes behind a number (nothing was clear) is cut around it by the
   * number's halo, a stroke in the card's ground painted under the figures.
   */
  // Measured in the real window (Inter, 12px, 700, tabular figures).
  const GL = { FIG: 7.4, ASC: 9, DESC: 0.5, PAD: 2.5, GAP: 5, R: 4, RNOW: 6, FOOT: 16 };
  function numBox(cx, base, text) {
    const half = (String(text).length * GL.FIG) / 2;
    return { l: cx - half, r: cx + half, t: base - GL.ASC, b: base + GL.DESC };
  }
  /** Liang-Barsky: does the segment (x1,y1)-(x2,y2) cross the box at all? */
  function segHitsBox(x1, y1, x2, y2, bx) {
    const dx = x2 - x1, dy = y2 - y1;
    let t0 = 0, t1 = 1;
    const p = [-dx, dx, -dy, dy], q = [x1 - bx.l, bx.r - x1, y1 - bx.t, bx.b - y1];
    for (let k = 0; k < 4; k++) {
      if (p[k] === 0) { if (q[k] < 0) return false; continue; }
      const t = q[k] / p[k];
      if (p[k] < 0) { if (t > t1) return false; if (t > t0) t0 = t; } else { if (t < t0) return false; if (t < t1) t1 = t; }
    }
    return true;
  }
  /*
   * Where each number goes: [{ x, y }] (its centre and baseline), for dots
   * at `xy` ([[x, y]], oldest first) whose grades are `v`, in a w by h box
   * whose foot starts GL.FOOT over the bottom.
   */
  function placeNums(v, xy, w, h) {
    const n = v.length;
    const floor = h - GL.FOOT - 2;
    const grow = (bx, by) => ({ l: bx.l - by, r: bx.r + by, t: bx.t - by, b: bx.b + by });
    const placed = [];
    const out = new Array(n);
    const cost = (i, cx, base) => {
      const text = String(v[i]);
      const bx = numBox(cx, base, text);
      let c = 0;
      if (bx.t < 1 || bx.b > floor) c += 1000;
      const g = grow(bx, GL.PAD);
      for (let k = 0; k < n - 1; k++) if (segHitsBox(xy[k][0], xy[k][1], xy[k + 1][0], xy[k + 1][1], g)) c += 1000;
      for (let k = 0; k < n; k++) {
        const rad = (k === n - 1 ? GL.RNOW : GL.R) + GL.PAD;
        const nx = Math.min(Math.max(xy[k][0], g.l), g.r), ny = Math.min(Math.max(xy[k][1], g.t), g.b);
        if (Math.hypot(nx - xy[k][0], ny - xy[k][1]) < rad) c += 1000;
      }
      for (const o of placed) {
        if (bx.l < o.r + 2 && bx.r > o.l - 2 && bx.t < o.b + 2 && bx.b > o.t - 2) c += 1000;
      }
      return c;
    };
    // The newest first, so it has the first pick; then right to left.
    for (let i = n - 1; i >= 0; i--) {
      const [px, py] = xy[i];
      const r = i === n - 1 ? GL.RNOW : GL.R;
      const half = (String(v[i]).length * GL.FIG) / 2;
      const prev = i > 0 ? v[i - 1] : null, next = i < n - 1 ? v[i + 1] : null;
      const nb = [prev, next].filter((t) => t !== null);
      // A valley (every neighbour higher) wants under; anything else over.
      const under = nb.length && nb.every((t) => t > v[i]);
      const upY = (gap) => py - r - gap - GL.DESC;
      const downY = (gap) => py + r + gap + GL.ASC;
      const near = (side) => (side === 'up' ? upY(GL.GAP) : downY(GL.GAP));
      const want = under ? 'down' : 'up', other = under ? 'up' : 'down';
      // In order of preference: straight over or under on its own side, the
      // other side, then the four diagonals, then a little further out.
      const cands = [
        [px, near(want)], [px, near(other)],
        [px - half + 1, near(want)], [px + half - 1, near(want)],
        [px - half + 1, near(other)], [px + half - 1, near(other)],
        [px, want === 'up' ? upY(GL.GAP + 6) : downY(GL.GAP + 6)],
        [px, other === 'up' ? upY(GL.GAP + 6) : downY(GL.GAP + 6)],
      ].map(([cx, base]) => [Math.min(Math.max(cx, half + 1), w - half - 1), base]);
      let best = null;
      cands.forEach(([cx, base], rank) => {
        const c = cost(i, cx, base) + rank;
        if (!best || c < best.c) best = { c, cx, base };
      });
      out[i] = { x: best.cx, y: best.base };
      placed.push(numBox(best.cx, best.base, String(v[i])));
    }
    return out;
  }
  function gradeLine(points, w, h, opts) {
    const SVGNS = 'http://www.w3.org/2000/svg';
    const pts = (Array.isArray(points) ? points : []).filter((t) => t && Number.isFinite(Number(t.score)));
    if (pts.length < 2) return null;
    const v = pts.map((t) => Number(t.score));
    const lo = Math.min(...v), hi = Math.max(...v);
    const span = Math.max(hi - lo, 8);
    const mid = (lo + hi) / 2;
    // Room over the highest dot and under the lowest for a number and its
    // gap, and under that the foot.
    const room = GL.ASC + GL.DESC + GL.GAP + GL.RNOW + 1;
    const top = room + 1, bottom = h - GL.FOOT - 2 - room;
    const x = (i) => 18 + i * ((w - 36) / (v.length - 1));
    const y = (n) => (top + bottom) / 2 - ((n - mid) / span) * (bottom - top);
    const xy = v.map((n, i) => [Number(x(i).toFixed(1)), Number(y(n).toFixed(1))]);
    const mk = (tag, attrs, text) => {
      const n = document.createElementNS(SVGNS, tag);
      for (const [k, val] of Object.entries(attrs)) n.setAttribute(k, String(val));
      if (text !== undefined) n.textContent = text;
      return n;
    };
    const svg = mk('svg', { viewBox: `0 0 ${w} ${h}`, width: w, height: h, class: 'grade-line', role: 'img',
      'aria-label': `Grades ${v.join(', ')}, oldest first` });
    svg.append(mk('polyline', { points: xy.map(([a, b]) => `${a},${b}`).join(' '), class: 'gl-line' }));
    const numAt = placeNums(v, xy, w, h);
    v.forEach((n, i) => {
      const last = i === v.length - 1;
      svg.append(mk('circle', { cx: xy[i][0], cy: xy[i][1], r: last ? GL.RNOW : GL.R, class: 'gl-dot' + (last ? ' now' : '') }));
    });
    // The numbers over every dot and the line, so a halo cuts the line.
    v.forEach((n, i) => {
      const last = i === v.length - 1;
      svg.append(mk('text', { x: numAt[i].x.toFixed(1), y: numAt[i].y.toFixed(1), class: 'gl-num' + (last ? ' now' : '') }, String(n)));
    });
    const footOf = opts && typeof opts.foot === 'function' ? opts.foot : (t) => clock(t.at);
    const FIG = 6, GAP = 10;   // gl-time is 10px mono, a figure 0.6em wide
    let kept = null;           // the label kept to the right: { x, half, text }
    for (let i = v.length - 1; i >= 0; i--) {
      const text = String(footOf(pts[i]) || '');
      if (!text) continue;
      const half = (text.length * FIG) / 2;
      const at = Math.min(Math.max(x(i), half), w - half);
      if (kept && (text === kept.text || kept.x - kept.half - (at + half) < GAP)) continue;
      svg.append(mk('text', { x: at.toFixed(1), y: h - 4, class: 'gl-time' }, text));
      kept = { x: at, half, text };
    }
    return svg;
  }

  const api = { gradeLine, gradeCard, insightLists, factList, roundChips, progressStrip, chip, LEAD_NUM, letter, letterOf, tone, scoreTone, gradeTone, checking, el };
  if (typeof window !== 'undefined') window.GradeView = api;
  // Node, for the test that holds the colour rule to grade.js. Nothing here
  // touches the DOM until a card is drawn, so requiring it is safe.
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
