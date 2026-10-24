'use strict';

/**
 * THE MARK IN ITS FIVE PLACES (8.6): one crescent, drawn five ways, and they
 * must never drift. The aperture before it was hand copied into five places
 * and ended up subtly different in them, which is the failure this exists for.
 *
 *   assets/logo-mark.svg        the source: the path, color="#F5F5F7" on its
 *                               root (through an <img> currentColor would be
 *                               black, and the mark invisible on the ground)
 *   src/renderer/dock           the corner mark: the same path, inline
 *   src/renderer/shell          the Recording screen: the same path, inline,
 *                               with its live dot drawn by shell.css, still
 *   src/renderer/splash         the two circles, the shade in a mask
 *   scripts/generate-icon.js    the two circles by arithmetic, for every icon
 *
 * and the icons in assets/ are what that arithmetic draws, byte for byte, so
 * a changed mark that was not run through `node scripts/generate-icon.js`
 * fails here.
 *
 * Run: npm run test:mark
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

let fails = 0;
const ok = (cond, what, detail) => {
  if (!cond) { fails++; console.log(`FAIL  ${what}${detail ? `\n        ${detail}` : ''}`); }
  else console.log(`ok    ${what}`);
};

const gen = require('./generate-icon');
const PATH = 'M76.294,4.281 A50,50 0 1,0 116.705,74.274 A42,42 0 1,1 76.294,4.281 Z';
const r3 = (n) => Math.round(n * 1000) / 1000;

// The readers, on known strings first: a reader that finds nothing would pass
// every file below.
const pathsIn = (src) => [...src.matchAll(/<path\b[^>]*\sd="([^"]+)"/g)].map((m) => m[1]);
const svgTag = (src, cls) => (src.match(new RegExp(`<svg\\b[^>]*class="${cls}"[^>]*>`)) || [''])[0];
const OLD_MARK = /stroke-dasharray|\bpupil\b|\bring\b|aperture/i;
ok(pathsIn('<svg><path fill="x" d="M1,2 Z"/><path d="M3,4 Z" /></svg>').join('|') === 'M1,2 Z|M3,4 Z'
  && svgTag('<svg class="mark" viewBox="0 0 120 120"><path/></svg>', 'mark') === '<svg class="mark" viewBox="0 0 120 120">',
'the path and svg readers find what they look for');
ok(OLD_MARK.test('<circle class="pupil" cx="32"/>') && OLD_MARK.test('stroke-dasharray="130.690 20.106"')
  && !OLD_MARK.test('<path d="M76.294,4.281 Z" fill="currentColor"/>'),
'the old mark detector finds the ring and the pupil, and passes over the crescent');

// 1. The arithmetic: the two circles, and the path they make.
ok(gen.OUTER.x === 71 && gen.OUTER.y === 54 && gen.OUTER.r === 50
  && r3(gen.INNER.x) === 86.588 && r3(gen.INNER.y) === 45 && gen.INNER.r === 42,
'generate-icon.js draws the disc r50 at (71, 54) less the shade r42 at (86.588, 45)', JSON.stringify([gen.OUTER, gen.INNER]));
ok(gen.inCrescent(25, 60) && gen.inCrescent(60, 100) && !gen.inCrescent(86.588, 45) && !gen.inCrescent(5, 5) && !gen.inCrescent(118, 10),
  'inside the crescent is the back of the moon, never the shade or past the disc');
ok(gen.tilePath(100 / 120) === PATH, 'and the path it computes for the 120 box is the mark\'s path', gen.tilePath(100 / 120));

// 2. The source.
const svg = read('assets/logo-mark.svg');
const root = (svg.match(/<svg\b[^>]*>/) || [''])[0];
// IT MUST PARSE. A double hyphen inside an XML comment is not well formed, and
// an <img> of an SVG that does not parse shows a broken picture: the first
// draft of this file's comment named the ink token, two hyphens and all, and
// every header in the app lost its mark while every string check here passed.
const badComments = (src) => [...src.matchAll(/<!--([\s\S]*?)-->/g)].filter((m) => m[1].includes('--') || m[1].endsWith('-'));
ok(badComments('<!-- the ink, --text -->').length === 1 && badComments('<!-- the ink, the text token -->').length === 0,
  'the comment reader finds a double hyphen and passes over a plain comment');
ok(!badComments(svg).length && /^\s*(<!--[\s\S]*?-->\s*)*<svg\b[\s\S]*<\/svg>\s*$/.test(svg),
  'and the file is well formed: no double hyphen in a comment, one svg element and nothing after it',
  badComments(svg).map((m) => m[1].trim().slice(0, 60)).join(' | '));
ok(/\scolor="#F5F5F7"/.test(root) && /viewBox="0 0 120 120"/.test(root) && /role="img"/.test(root) && /aria-label="Occlara"/.test(root),
  'assets/logo-mark.svg carries color="#F5F5F7", the ink, on its root, in the 120 box', root);
ok(pathsIn(svg).length === 1 && pathsIn(svg)[0] === PATH && /<path\b[^>]*fill="currentColor"/.test(svg)
  && !/<circle\b/.test(svg) && !OLD_MARK.test(svg.replace(/<!--[\s\S]*?-->/g, '')),
'one path, the crescent, in currentColor, and no ring or pupil left in it');

// 3. The corner mark and the Recording screen inline the same path.
const dock = read('src/renderer/dock/index.html');
const dockSvg = svgTag(dock, 'mark');
ok(/viewBox="0 0 120 120"/.test(dockSvg) && /width="26"/.test(dockSvg) && pathsIn(dock).length === 1 && pathsIn(dock)[0] === PATH
  && /fill="currentColor"/.test(dock) && !OLD_MARK.test(dock.replace(/<!--[\s\S]*?-->/g, '')),
'the corner mark is the same path at 26px, in currentColor');
const shell = read('src/renderer/shell/index.html');
const sealed = (shell.match(/<svg\b[^>]*class="sealed-mark"[^>]*>[\s\S]*?<\/svg>/) || [''])[0];
ok(/viewBox="0 0 120 120"/.test(sealed) && /width="88"/.test(sealed) && pathsIn(sealed).length === 1 && pathsIn(sealed)[0] === PATH
  && /fill="currentColor"/.test(sealed) && !/<circle\b/.test(sealed),
'the Recording screen\'s mark is the same path at 88px, with no pupil', sealed.slice(0, 120));
const shellCss = read('src/renderer/shell/shell.css');
const code = (src) => src.replace(/<!--[\s\S]*?-->/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
ok(!OLD_MARK.test(code(shellCss)) && !OLD_MARK.test(code(shell)), 'the shell keeps no rule or element of the pupil');
const dot = (code(shellCss).match(/\n\.sealed h1::before \{([^}]*)\}/) || [])[1] || '';
ok(/background: var\(--signal\)/.test(dot) && /width: 8px/.test(dot) && /height: 8px/.test(dot) && !/animation/.test(dot)
  && /\n\.sealed\.held h1::before \{ display: none; \}/.test(shellCss),
'its live dot is one still 8px dot in the signal before the title, and held it goes', dot.trim());
ok(!/infinite/.test((code(shellCss).match(/\n\.sealed[^{]*\{[^}]*\}/g) || []).join('\n')),
  'and nothing on the Recording screen loops');

// 4. The splash draws the two circles, and its shade comes to rest in place.
const splash = read('src/renderer/splash/index.html');
const disc = (splash.match(/<circle\b(?=[^>]*mask="url\(#phase\)")[^>]*>/) || [''])[0];
const shade = (splash.match(/<circle\b[^>]*class="shade"[^>]*>/) || [''])[0];
const num = (tag, a) => Number((tag.match(new RegExp(`\\s${a}="([\\d.]+)"`)) || [])[1]);
ok(num(disc, 'cx') === gen.OUTER.x && num(disc, 'cy') === gen.OUTER.y && num(disc, 'r') === gen.OUTER.r
  && num(shade, 'cx') === r3(gen.INNER.x) && num(shade, 'cy') === r3(gen.INNER.y) && num(shade, 'r') === gen.INNER.r,
'the splash\'s disc and shade are the same two circles', `${disc} ${shade}`);
const splashCss = read('src/renderer/splash/splash.css');
ok(/to\s*\{\s*cx: 86\.588px; cy: 45px; r: 42px; \}/.test(splashCss) && !OLD_MARK.test(code(splashCss)) && !/shockwave|infinite/.test(code(splashCss)),
  'its shade comes to rest in its own place, and no ring, pupil, shockwave or loop is left');
ok(/class="wordmark">Occlara</.test(splash) && /\.wordmark \{[^}]*font-weight: 600;/.test(splashCss),
  'the name under it is "Occlara", Geist 600');

// 5. The icons are what the arithmetic draws, byte for byte.
const buf = (rel) => fs.readFileSync(path.join(ROOT, rel));
const icoSizes = (b) => Array.from({ length: b.readUInt16LE(4) }, (_v, i) => b[6 + i * 16] || 256);
ok(buf('assets/icon.png').equals(gen.png(512, gen.draw(512, true))), 'assets/icon.png is the 512 tile the script draws');
ok(buf('assets/icon.ico').equals(gen.ico(gen.APP.map((s) => ({ size: s, data: gen.png(s, gen.draw(s, true)) }))))
  && icoSizes(buf('assets/icon.ico')).join(' ') === '16 20 24 32 40 48 64 96 128 256',
'assets/icon.ico is the tile at 16 to 256', icoSizes(buf('assets/icon.ico')).join(' '));
for (const [name, ink] of [['tray-dark', gen.INK], ['tray-light', gen.GROUND]]) {
  const b = buf(`assets/${name}.ico`);
  ok(b.equals(gen.ico(gen.TRAY.map((s) => ({ size: s, data: gen.png(s, gen.draw(s, false, ink)) })))) && icoSizes(b).join(' ') === '16 20 24 32 40 48',
    `assets/${name}.ico is the crescent alone at 16 to 48`, icoSizes(b).join(' '));
}
// And what they draw, read back out of the 16px tray pictures: the crescent's
// colour alone, nothing of a tile, a dark crescent for a light taskbar.
function pixels16(icoBuf) {
  const off = icoBuf.readUInt32LE(6 + 12);
  const len = icoBuf.readUInt32LE(6 + 8);
  const p = icoBuf.subarray(off, off + len);
  let at = 8; const idat = [];
  while (at < p.length) {
    const n = p.readUInt32BE(at); const type = p.toString('ascii', at + 4, at + 8);
    if (type === 'IDAT') idat.push(p.subarray(at + 8, at + 8 + n));
    at += 12 + n;
  }
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const out = [];
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) out.push(raw.subarray(y * 65 + 1 + x * 4, y * 65 + 1 + x * 4 + 4));
  return out;
}
const hexOf = (px) => '#' + [px[0], px[1], px[2]].map((v) => v.toString(16).padStart(2, '0')).join('').toUpperCase();
for (const [name, want] of [['tray-dark', '#F5F5F7'], ['tray-light', '#0A0B0E']]) {
  const px = pixels16(buf(`assets/${name}.ico`));
  const seen = px.filter((x) => x[3] > 0);
  const colours = [...new Set(seen.map(hexOf))];
  ok(seen.length > 20 && seen.length < 160 && colours.length === 1 && colours[0] === want && px[0][3] === 0,
    `the 16px ${name} picture is a crescent in ${want} and nothing else`, `${seen.length} pixels in ${colours.join(', ')}`);
}

// 6. Nothing of the aperture is left in what ships, but the AI log's eye,
// which is an eye by design.
const stale = [];
(function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else if (/\.(js|css|html|svg|txt)$/.test(e.name) && !p.endsWith(path.join('shared', 'log-eye.js'))
      && /aperture|\bpupils?\b/i.test(fs.readFileSync(p, 'utf8'))) stale.push(path.relative(ROOT, p));
  }
})(path.join(ROOT, 'src'));
for (const f of fs.readdirSync(path.join(ROOT, 'assets'))) {
  if (/\.(svg|txt)$/.test(f) && /aperture|\bpupils?\b/i.test(read(`assets/${f}`))) stale.push(`assets/${f}`);
}
ok(!stale.length, 'no word of the aperture or its pupil is left in src or assets, but the AI log\'s eye', stale.join(', '));

console.log(fails ? `\n${fails} mark check(s) FAILED` : '\nall mark checks passed: one crescent in its five places, and every icon drawn from it');
process.exit(fails ? 1 : 0);
