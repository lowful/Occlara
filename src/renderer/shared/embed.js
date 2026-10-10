'use strict';

/*
 * A surface loaded as a page of the main window (src/main/windows/main-window.js)
 * is told so by its query: ?embed=1, and for the library ?section=list,
 * patterns or breakdown. It runs in <head>, before the body is parsed, so an
 * embedded page never paints a frame of its old window chrome first.
 *
 * html.embedded drops the transparent gutter, the glass card, the close button
 * and the drag region (ui.css): the shell owns the window around the page.
 */
(function () {
  try {
    const q = new URLSearchParams(location.search);
    const root = document.documentElement;
    if (q.get('embed') === '1') root.classList.add('embedded');
    const section = q.get('section');
    if (section && /^[a-z]+$/.test(section)) root.dataset.section = section;
  } catch (e) {
    console.error('[embed] could not read the page query:', e && e.message);
  }
})();

/** Whether this surface is a page of the main window rather than a window of its own. */
window.occlaraEmbedded = () => document.documentElement.classList.contains('embedded');
