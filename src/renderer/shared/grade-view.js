'use strict';

/**
 * The grade and the three insight lists, drawn the same way everywhere they
 * appear: the review window, the match library and the weekly report. The
 * panel and Stats draw their own grade chips and take the colour from here.
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
   * The grade card: the number, the letter, and each category with the facts
   * it was built on. A category that could not be measured says so rather than
   * showing a zero.
   */
  function gradeCard(grade, opts) {
    const o = opts || {};
    const card = el('section', 'gv-grade');
    if (!grade) return card;
    const top = el('div', 'gv-top');
    const hasScore = typeof grade.score === 'number';
    const score = el('div', 'gv-score', hasScore ? grade.score : '--');
    const letter = el('div', 'gv-letter ' + (hasScore ? tone(grade.letter) : 'none'), hasScore ? grade.letter : '?');
    const meta = el('div', 'gv-meta');
    meta.append(el('div', 'gv-label', o.label || 'Match grade'));
    meta.append(el('div', 'gv-sub', !hasScore ? 'Not enough measured to grade this match'
      : grade.provisional ? 'Provisional: some of the record is still missing' : 'Out of 100, from what the record shows'));
    top.append(score, letter, meta);
    card.append(top);

    const cats = el('div', 'gv-cats');
    for (const c of grade.categories || []) {
      const row = el('div', 'gv-cat' + (c.score === null ? ' unmeasured' : ''));
      const head = el('div', 'gv-cat-head');
      head.append(el('span', 'gv-cat-name', c.label));
      head.append(el('b', 'gv-cat-score ' + (c.score === null ? '' : scoreTone(c.score)), c.score === null ? 'not measured' : c.score));
      row.append(head);
      const bar = el('div', 'gv-bar');
      const fill = el('i', c.score === null ? '' : scoreTone(c.score));
      fill.style.setProperty('--w', (c.score === null ? 0 : Math.max(2, Math.min(100, c.score))) + '%');
      bar.append(fill);
      row.append(bar);
      if (c.evidence && c.evidence.length) row.append(el('div', 'gv-ev', c.evidence.join('  ·  ')));
      cats.append(row);
    }
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

  function item(e, kind, onRound) {
    const li = el('li', 'gv-item ' + kind);
    const head = el('div', 'gv-item-head');
    head.append(el('span', 'gv-dot'));
    head.append(el('b', 'gv-item-title', e.title));
    if (e.judged) head.append(el('span', 'gv-badge', "coach's look"));
    li.append(head);
    if (e.detail) li.append(el('p', 'gv-item-detail', e.detail));
    if (e.fix && e.fix !== e.detail) {
      const fix = el('p', 'gv-item-fix');
      fix.append(el('span', 'gv-fix-label', 'Fix'), document.createTextNode(e.fix));
      li.append(fix);
    }
    if (e.rounds && e.rounds.length && onRound !== false) li.append(roundChips(e.rounds, onRound));
    return li;
  }

  /**
   * The three lists. Each is left out when it has nothing, and the whole block
   * says so when all three are empty, because a blank section reads as broken.
   */
  function insightLists(insights, opts) {
    const o = opts || {};
    const ins = insights || {};
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
      for (const e of list.slice(0, o.limit || 6)) ul.append(item(e, kind, o.onRound));
      block.append(ul);
      wrap.append(block);
    }
    if (!any) wrap.append(el('p', 'gv-empty', o.empty || 'Nothing cleared the bar to be called a pattern in this match. That is usually a good sign.'));
    return wrap;
  }

  const api = { gradeCard, insightLists, roundChips, letterOf, tone, scoreTone, gradeTone, el };
  if (typeof window !== 'undefined') window.GradeView = api;
  // Node, for the test that holds the colour rule to grade.js. Nothing here
  // touches the DOM until a card is drawn, so requiring it is safe.
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
