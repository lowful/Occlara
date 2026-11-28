'use strict';

const C = require('../shared/channels');

/**
 * STILL WHILE RECORDING (9.1, the owner's item 9: "When recording starts,
 * pause EVERY animation in the app ... and resume after"). One switch for
 * every surface: main says whether a match is being recorded (PUSH_STILL on
 * every change, STILL_GET once as the document loads), and this puts
 * `html.rec-still` on the surface's own document, or takes it off.
 *
 * What pauses on it:
 *   - every infinite CSS animation, by a rule under html.rec-still beside it
 *     (motion.css, theme.css and each page's own; test:still finds every
 *     infinite animation in the renderer and asks for its rule);
 *   - the ambient motion shared/motion.js drives (html.ambient-off, which it
 *     now also puts on for rec-still): the agent's drift, the stars' twinkle,
 *     the moon, and any canvas loop that asks Motion.ambientOn() before it
 *     draws a frame and Motion.onAmbient(cb) when to start again.
 * What does not: an entrance or a change of state, which plays once and ends
 * on its own frame, and the live rating's count on the Recording screen, which
 * moves only when a fact arrives.
 *
 * Handed the preload's own ipcRenderer, as page-motion.js is, so the boot
 * checks and the fake DOM's stand in reach it the same way. Nothing here
 * throws: a surface with no document, or a stand in with no invoke, is left
 * as it is.
 */
const CLASS = 'rec-still';

function stillSync(ipcRenderer) {
  if (typeof document === 'undefined' || !ipcRenderer) return null;
  let still = false;
  let pushed = false;
  const paint = () => {
    const root = document.documentElement;
    if (root && root.classList) root.classList.toggle(CLASS, still);
  };
  const set = (v) => { still = v === true; paint(); };
  try {
    if (typeof ipcRenderer.on === 'function') ipcRenderer.on(C.PUSH_STILL, (_e, m) => { pushed = true; set(!!(m && m.still === true)); });
  } catch { /* no pushes in a stand in */ }
  try {
    if (typeof ipcRenderer.invoke === 'function') {
      Promise.resolve(ipcRenderer.invoke(C.STILL_GET))
        // A push that came first is newer than this answer.
        .then((m) => { if (!pushed) set(!!(m && m.still === true)); })
        .catch(() => {});
    }
  } catch { /* none */ }
  // The class on the page's <html> once there is one: a preload runs before it is parsed.
  if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') window.addEventListener('DOMContentLoaded', paint);
  return { still: () => still };
}

module.exports = { stillSync, CLASS };
