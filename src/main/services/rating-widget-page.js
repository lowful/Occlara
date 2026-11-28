'use strict';

/**
 * THE STREAM WIDGET'S PAGE, made whole (the live rating, docs/claude/rating.md
 * "Live"). The template src/renderer/rating-widget/widget.html with its slots
 * filled: Geist and Geist Mono as data (nothing is fetched from the net, the
 * page's own CSP refuses it), the app's tokens (shared/theme.css, its font
 * files' lines taken out), the shared badge (shared/rating-badge.css and .js)
 * and the widget's own widget.css and widget.js. Made once and kept; the
 * server (rating-stream.js) serves it as it is.
 */

const fs = require('fs');
const path = require('path');

const RENDERER = path.join(__dirname, '..', '..', 'renderer');
const FONTS = path.join(__dirname, '..', '..', '..', 'assets', 'fonts');

// The weights the widget draws with: the badge 700, the label 600 and 500, the move Mono 500.
const FACES = [['Geist', 500, 'geist-500.woff2'], ['Geist', 600, 'geist-600.woff2'], ['Geist', 700, 'geist-700.woff2'], ['Geist Mono', 500, 'geistmono-500.woff2']];

let made = null;

function read(rel) { return fs.readFileSync(path.join(RENDERER, rel), 'utf8'); }

/** The page, every slot filled. A slot's text never carries "</" (it would end the tag it sits in). */
function build() {
  const fonts = FACES.map(([family, weight, file]) => {
    let data = '';
    try { data = fs.readFileSync(path.join(FONTS, file)).toString('base64'); } catch { data = ''; }
    return data ? `@font-face { font-family: '${family}'; font-style: normal; font-weight: ${weight}; font-display: block; src: url(data:font/woff2;base64,${data}) format('woff2'); }` : '';
  }).join('\n');
  // The tokens, without theme.css's own font lines, which point at files.
  const theme = read('shared/theme.css').split(/\r?\n/).filter((l) => !/^@font-face/.test(l.trim())).join('\n');
  const slots = {
    '/*FONTS*/': fonts,
    '/*THEME*/': theme,
    '/*BADGE_CSS*/': read('shared/rating-badge.css'),
    '/*WIDGET_CSS*/': read('rating-widget/widget.css'),
    '/*BADGE_JS*/': read('shared/rating-badge.js'),
    '/*WIDGET_JS*/': read('rating-widget/widget.js'),
  };
  let html = read('rating-widget/widget.html');
  for (const [slot, text] of Object.entries(slots)) {
    const safe = String(text).replace(/<\//g, '<\\/');
    html = html.split(slot).join(safe);
  }
  return html;
}

/** The page, made on first ask. */
function page() {
  if (!made) made = build();
  return made;
}

module.exports = { page, build };
