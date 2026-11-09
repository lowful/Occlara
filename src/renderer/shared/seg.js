/* The segmented control's sliding thumb (8.7 redesign), and since 8.8 its
 * radio semantics.
 *
 * occlaraSeg(el) turns a row of buttons into one capsule with a single thumb
 * that slides to the chosen one, the way a monthly / yearly toggle does. The
 * markup stays what it was: the buttons are the control, their state is the
 * attribute or class the surface already sets (aria-pressed="true",
 * aria-selected="true", .on, .active or .picked), and a test reads no new
 * element. The thumb is an extra aria-hidden span behind the buttons, moved
 * with a transform, so it stays on the compositor.
 *
 *   occlaraSeg(document.getElementById('capturespeed'));
 *
 * A RADIOGROUP (8.8). A class alone told a screen reader nothing about which
 * one was chosen, and the keyboard had to Tab through every option. So the
 * row is role="radiogroup", each button role="radio" with aria-checked
 * mirrored from the surface's own state, and the row is ONE tab stop (a
 * roving tabindex on the chosen button). The arrow keys move the choice to
 * the next or previous enabled button, Home and End to the first and last,
 * by clicking it, so the surface's own click handler does what it always
 * did. A surface that writes aria-checked itself keeps writing it: the
 * mirror is only written where the surface uses another sign. The row takes
 * its name from aria-label or aria-labelledby if the surface gave one.
 *
 * It follows the state by itself: a MutationObserver watches the buttons'
 * class and aria attributes and the row's children (a surface that rebuilds
 * its buttons, as Learn does, needs no second call), and a ResizeObserver
 * keeps the thumb on its button when the row is resized. The first placement
 * is instant (.still), every later one slides. Under prefers-reduced-motion
 * the thumb jumps (ui.css).
 *
 * Nothing here runs during a match: the pages that hold a segmented control
 * are sealed while one is played, and the thumb draws nothing a player could
 * read.
 */
(function () {
  'use strict';

  // The signs a surface uses for "chosen", other than aria-checked, which is
  // also what this file writes.
  const OWN = '[aria-pressed="true"], [aria-selected="true"], .on, .active, .picked';
  const CHOSEN = OWN + ', [aria-checked="true"]';

  const buttons = (el) => Array.from(el.children).filter((b) => b.tagName === 'BUTTON');
  const set = (b, name, v) => { if (b.getAttribute(name) !== v) b.setAttribute(name, v); };

  function enhance(el) {
    if (!el || el.__seg) return el && el.__seg;
    el.classList.add('seg-slide');
    set(el, 'role', 'radiogroup');
    const thumb = document.createElement('span');
    thumb.className = 'seg-thumb still';
    thumb.setAttribute('aria-hidden', 'true');
    el.prepend(thumb);

    // Does the surface keep aria-checked itself? Then it is the state, and
    // this file only reads it.
    const pageChecks = () => buttons(el).some((b) => b.hasAttribute('aria-checked') && !b.hasAttribute('data-seg-checked'));

    const sync = () => {
      const all = buttons(el);
      const own = pageChecks();
      let chosen = null;
      for (const b of all) {
        set(b, 'role', 'radio');
        const on = own ? b.getAttribute('aria-checked') === 'true' : b.matches(OWN);
        if (!own) { set(b, 'aria-checked', on ? 'true' : 'false'); set(b, 'data-seg-checked', ''); }
        if (on && !chosen) chosen = b;
      }
      // One tab stop: the chosen button, or the first enabled one.
      const stop = chosen && !chosen.disabled ? chosen : all.find((b) => !b.disabled && !b.hidden) || null;
      for (const b of all) set(b, 'tabindex', b === stop ? '0' : '-1');
    };

    let raf = 0;
    const place = () => {
      raf = 0;
      sync();
      const on = buttons(el).find((b) => b.matches(CHOSEN));
      if (!on || !on.offsetWidth) { if (thumb.classList.contains('on')) thumb.classList.remove('on'); return; }
      thumb.style.width = on.offsetWidth + 'px';
      thumb.style.height = on.offsetHeight + 'px';
      thumb.style.transform = 'translate(' + on.offsetLeft + 'px, ' + on.offsetTop + 'px)';
      // The thumb's classes are touched only when they change: the observer
      // below watches the subtree, the thumb is in it, and a class written
      // on every pass queued the next one, for as long as the page lived.
      if (!thumb.classList.contains('on')) thumb.classList.add('on');
      // Slide from the second placement on: the first one is where it starts.
      if (thumb.classList.contains('still')) requestAnimationFrame(() => requestAnimationFrame(() => thumb.classList.remove('still')));
    };
    const queue = () => { if (!raf) raf = requestAnimationFrame(place); };

    // The arrow keys move the choice, as in any radio group.
    el.addEventListener('keydown', (e) => {
      const keys = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1, Home: 'first', End: 'last' };
      const step = keys[e.key];
      if (step === undefined) return;
      const live = buttons(el).filter((b) => !b.disabled && !b.hidden);
      if (!live.length) return;
      const at = live.indexOf(e.target);
      let next;
      if (step === 'first') next = live[0];
      else if (step === 'last') next = live[live.length - 1];
      else next = live[((at < 0 ? 0 : at + step) + live.length) % live.length];
      e.preventDefault();
      if (!next || next === e.target) return;
      next.focus();
      next.click();
      sync();
    });

    // A mutation on the thumb itself (its own class) is place()'s own doing
    // and is not a reason to place again. sync() writes an attribute only
    // when it changes, so its own writes settle after one pass.
    new MutationObserver((recs) => { if (recs.some((r) => r.target !== thumb)) queue(); })
      .observe(el, { subtree: true, childList: true, attributes: true, attributeFilter: ['class', 'aria-pressed', 'aria-selected', 'aria-checked', 'hidden', 'disabled'] });
    if (typeof ResizeObserver === 'function') new ResizeObserver(queue).observe(el);
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(queue);
    sync();
    queue();
    el.__seg = { place: queue };
    return el.__seg;
  }

  window.occlaraSeg = enhance;
})();
