'use strict';

/**
 * The grade and the three insight lists, drawn the same way everywhere they
 * appear: the review window, the match library and the weekly report.
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

  /** S and A read as good, B as neutral, C as a warning, D as a problem. */
  function tone(letter) {
    return letter === 'S' || letter === 'A' ? 'good' : letter === 'B' ? 'mid' : letter === 'C' ? 'warn' : 'bad';
  }
  function scoreTone(score) {
    return score >= 80 ? 'good' : score >= 65 ? 'mid' : score >= 50 ? 'warn' : 'bad';
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

  window.GradeView = { gradeCard, insightLists, roundChips, tone, scoreTone, el };
})();
