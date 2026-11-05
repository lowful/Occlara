'use strict';

const path = require('path');
const { fileURLToPath } = require('url');

/**
 * NO PAGE OF OURS EVER BECOMES SOMEONE ELSE'S PAGE.
 *
 * Every window loads one of our own files with its preload, and several
 * preloads run with the sandbox off. A link or a form in text a page paints
 * from the server or the model would navigate the window itself, and the
 * remote page it loaded would get the preload's bridge with it: the content
 * security policy stops an injected script, not a navigation. So every
 * webContents the app makes (app 'web-contents-created', index.js) is held to
 * our own files: a navigation or a redirect to anything else is refused, and
 * no page opens a window at all. Every link out of the app goes through main
 * (shell.openExternal, with a URL main holds), never through a page.
 *
 * Plain Node but for what it is handed, so test:webguard runs it with stand ins.
 */

const RENDERER_ROOT = path.resolve(__dirname, '..', '..', 'renderer');

/** Whether `url` is one of our own pages: a file under src/renderer, nothing else. */
function isOwnPage(url, root = RENDERER_ROOT) {
  let u;
  try { u = new URL(String(url || '')); } catch { return false; }
  if (u.protocol !== 'file:') return false;
  let file;
  try { file = path.resolve(fileURLToPath(u)); } catch { return false; }
  const base = path.resolve(root);
  const rel = path.relative(base, file);
  return !!rel && !rel.startsWith('..') && !path.isAbsolute(rel);
}

/**
 * Hold one webContents to our own pages. `log` is told what was refused,
 * by its origin only (a URL can carry a query nobody should keep).
 */
function guard(contents, opts) {
  const o = opts || {};
  const root = o.root || RENDERER_ROOT;
  const log = typeof o.log === 'function' ? o.log : () => {};
  const originOf = (url) => { try { return new URL(String(url)).origin; } catch { return 'an unreadable url'; } };
  const refuse = (what) => (event, url) => {
    if (isOwnPage(url, root)) return;
    try { event.preventDefault(); } catch {}
    log(`[web-guard] ${what} to ${originOf(url)} refused`);
  };
  contents.on('will-navigate', refuse('a navigation'));
  contents.on('will-redirect', refuse('a redirect'));
  contents.on('will-attach-webview', (event) => {
    try { event.preventDefault(); } catch {}
    log('[web-guard] a webview refused');
  });
  if (typeof contents.setWindowOpenHandler === 'function') {
    contents.setWindowOpenHandler(({ url }) => {
      log(`[web-guard] a window to ${originOf(url)} refused`);
      return { action: 'deny' };
    });
  }
  return contents;
}

module.exports = { guard, isOwnPage, RENDERER_ROOT };
