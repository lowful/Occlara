'use strict';
/*
 * THE SUB SWITCH (Orbit, 27 Nov 2026). The top bar has four links, and two
 * of them hold more than one page (shell-nav.js TOP and SUB): Matches holds
 * the library, Patterns and Stats, Practice holds the drills and the Trainer.
 * Each of those pages draws this one segmented control at its head, the page
 * it is chosen, the others a press away (window.occlara.go, SHELL_NAV).
 *
 *   <nav class="subnav no-drag" data-group="matches" data-current="stats" aria-label="Matches"></nav>
 *
 * data-current names the page; on the library's surface, which is two pages
 * by its ?section, it is read from the query when the markup leaves it out.
 * The pages and their words come from the preload (window.occlara.subnav,
 * shell-nav.js SUB), so there is one list. Built with textContent alone.
 * Sealed mid match like every page: a page is never on screen then.
 */
(function () {
  function current(el) {
    if (el.dataset.current) return el.dataset.current;
    const section = new URLSearchParams(window.location.search).get('section');
    return section === 'patterns' ? 'patterns' : 'matches';
  }

  function build(el) {
    if (!el || el.__subnav) return;
    const bridge = window.occlara || {};
    const items = typeof bridge.subnav === 'function' ? bridge.subnav(el.dataset.group) : null;
    if (!Array.isArray(items) || items.length < 2 || typeof bridge.go !== 'function') { el.hidden = true; return; }
    el.__subnav = true;
    const here = current(el);
    const row = document.createElement('div');
    row.className = 'subnav-seg';
    row.setAttribute('role', 'group');
    row.setAttribute('aria-label', el.getAttribute('aria-label') || 'Pages');
    for (const it of items) {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = it.label;
      b.dataset.page = it.id;
      b.setAttribute('aria-pressed', String(it.id === here));
      if (it.id === here) b.setAttribute('aria-current', 'page');
      b.addEventListener('click', () => { if (it.id !== here) bridge.go(it.id); });
      row.append(b);
    }
    el.append(row);
    if (typeof window.occlaraSeg === 'function') window.occlaraSeg(row);
  }

  function all() { document.querySelectorAll('.subnav[data-group]').forEach(build); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', all, { once: true });
  else all();
  window.occlaraSubnav = build;
})();
