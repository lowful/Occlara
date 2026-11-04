/* The segmented control's sliding thumb (8.7 redesign).
 *
 * occlaraSeg(el) turns a row of buttons into one capsule with a single thumb
 * that slides to the chosen one, the way a monthly / yearly toggle does. The
 * markup stays what it was: the buttons are the control, their state is the
 * attribute or class the surface already sets (aria-pressed="true",
 * aria-selected="true", .on, .active or .picked), and a test or a screen
 * reader reads no new element. The thumb is an extra aria-hidden span behind
 * the buttons, moved with a transform, so it stays on the compositor.
 *
 *   occlaraSeg(document.getElementById('capturespeed'));
 *
 * It follows the state by itself: a MutationObserver watches the buttons'
 * class and aria attributes and the row's children (a surface that rebuilds
 * its buttons, as Learn does, needs no second call), and a ResizeObserver
 * keeps the thumb on its button when the row is resized. The first placement
 * is instant (.still), every later one slides. Under prefers-reduced-motion
 * the slide is a cut (theme.css collapses the transition).
 *
 * Nothing here runs during a match: the pages that hold a segmented control
 * are sealed while one is played, and the thumb draws nothing a player could
 * read.
 */
(function () {
  'use strict';

  const CHOSEN = '[aria-pressed="true"], [aria-selected="true"], [aria-checked="true"], .on, .active, .picked';

  function enhance(el) {
    if (!el || el.__seg) return el && el.__seg;
    el.classList.add('seg-slide');
    const thumb = document.createElement('span');
    thumb.className = 'seg-thumb still';
    thumb.setAttribute('aria-hidden', 'true');
    el.prepend(thumb);

    let raf = 0;
    const place = () => {
      raf = 0;
      const on = Array.from(el.children).find((b) => b.tagName === 'BUTTON' && b.matches(CHOSEN));
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

    // A mutation on the thumb itself (its own class) is place()'s own doing
    // and is not a reason to place again.
    new MutationObserver((recs) => { if (recs.some((r) => r.target !== thumb)) queue(); })
      .observe(el, { subtree: true, childList: true, attributes: true, attributeFilter: ['class', 'aria-pressed', 'aria-selected', 'aria-checked', 'hidden'] });
    if (typeof ResizeObserver === 'function') new ResizeObserver(queue).observe(el);
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(queue);
    queue();
    el.__seg = { place: queue };
    return el.__seg;
  }

  window.occlaraSeg = enhance;
})();
