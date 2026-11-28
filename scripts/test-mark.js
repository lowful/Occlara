'use strict';

/**
 * THE MARK IN ITS FIVE PLACES, ONE SOURCE (the full moon, Nov 2026; the rule
 * since 8.6). The aperture before the crescent was hand copied into five
 * places and drifted; then the crescent; now the moon. One mark, drawn from
 * one source, and every place holds the same moon:
 *
 *   scripts/moon/               THE SOURCE: the design's moon-geometry.js and
 *                               moon-art.js, and its drawings (moon-drawings.js)
 *   assets/logo-mark.svg        the one colour mark: the disc with its seas and
 *                               four craters cut by even odd fill, color="#F5F5F7"
 *                               on its root (through an <img> currentColor would
 *                               be black, and the mark invisible on the ground)
 *   src/renderer/dock           the corner mark: the same path inline, currentColor
 *   src/renderer/shell          the Recording screen's moon: the same path inline,
 *                               its live dot still; and the bar's mark, the
 *                               colour drawing at 22 (assets/mark-bar.svg)
 *   src/renderer/splash         the clean colour moon (assets/splash/moon.svg),
 *                               arriving in one motion
 *   scripts/generate-icon.js    every icon, rendered from the drawings
 *
 * and the icons in assets/ are what those drawings render to: each file is the
 * one scripts/moon/rendered.json records, rendered from drawings with the hash
 * it records, so a moon changed and not run through
 * `node scripts/generate-icon.js` fails here, and so does an icon edited by hand.
 * The other places that sign with the mark (Home's Wrapped row, the games
 * toast, Wrapped, the share image) draw the same path.
 *
 * Run: npm run test:mark
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const buf = (rel) => fs.readFileSync(path.join(ROOT, rel));

let fails = 0;
const ok = (cond, what, detail) => {
  if (!cond) { fails++; console.log(`FAIL  ${what}${detail ? `\n        ${detail}` : ''}`); }
  else console.log(`ok    ${what}`);
};

const G = require('./moon/moon-geometry');
const A = require('./moon/moon-art');
const M = require('./moon/moon-drawings');
const gen = require('./generate-icon');
const D = A.FLAT_D;

// The readers, on known strings first: a reader that finds nothing would pass
// every file below.
const pathsIn = (src) => [...src.matchAll(/<path\b[^>]*\sd="([^"]+)"/g)].map((m) => m[1]);
const pathTags = (src) => [...src.matchAll(/<path\b[^>]*>/g)].map((m) => m[0]);
const svgTag = (src, cls) => (src.match(new RegExp(`<svg\\b[^>]*class="${cls}"[^>]*>`)) || [''])[0];
const svgBlock = (src, cls) => (src.match(new RegExp(`<svg\\b[^>]*class="${cls}"[^>]*>[\\s\\S]*?<\\/svg>`)) || [''])[0];
const OLD_MARK = /stroke-dasharray|\bpupil\b|aperture|67\.444|76\.294|77\.738|107\.855/i;
ok(pathsIn('<svg><path fill="x" d="M1,2 Z"/><path d="M3,4 Z" /></svg>').join('|') === 'M1,2 Z|M3,4 Z'
  && svgTag('<svg class="mark" viewBox="0 0 120 120"><path/></svg>', 'mark') === '<svg class="mark" viewBox="0 0 120 120">'
  && svgBlock('<i><svg class="m" a="1"><path d="Z"/></svg></i>', 'm') === '<svg class="m" a="1"><path d="Z"/></svg>',
'the path and svg readers find what they look for');
ok(OLD_MARK.test('<path d="M67.444,10.281 A50,50 0 1,0 107.855,80.274 A42,42 0 1,1 67.444,10.281 Z"/>') && OLD_MARK.test('<circle class="shade" cx="77.738"/>')
  && OLD_MARK.test('stroke-dasharray="130.690 20.106"') && !OLD_MARK.test(`<path fill-rule="evenodd" d="${D}"/>`),
'the old mark detector finds the crescent and the aperture, and passes over the moon');

// 1. The source: the design's moon, its numbers as the board states them.
ok(G.LIGHT_DEG === -128 && A.FLAT_SCALE === 0.9 && A.FLAT_INNER === 0.74 && A.FLAT_SHIFT === 0.14,
  'the moon is lit from the upper left, 128 degrees round; the seas at 0.9 of the disc; a crater a ring of 0.74 moved 0.14 from the light',
  JSON.stringify([G.LIGHT_DEG, A.FLAT_SCALE, A.FLAT_INNER, A.FLAT_SHIFT]));
ok(D.startsWith('M10 60a50 50 0 1 0 100 0a50 50 0 1 0 -100 0Z') && (D.match(/M/g) || []).length >= 12,
  'the flat mark is the disc of radius 50 at (60, 60) and its seas and craters cut from it', `${(D.match(/M/g) || []).length} subpaths`);
ok(A.FLAT_CRATERS.map((c) => c.name).join(',') === 'Tycho,Clavius,Highland,Highland E', 'its four craters: Tycho, Clavius and two highland craters',
  A.FLAT_CRATERS.map((c) => c.name).join(','));
// The two dashes CLAUDE.md bans, built from their codes so this file carries neither.
const DASH = new RegExp('[' + String.fromCharCode(0x2013) + String.fromCharCode(0x2014) + ']');
const drawings = read('scripts/moon/moon-drawings.js');
ok(/Copied byte for byte from the design/.test(drawings) && !DASH.test(drawings + read('scripts/moon/moon-art.js') + read('scripts/moon/moon-geometry.js')),
  'the drawings say they are the design\'s, copied, and the source carries no dash');

// 2. The one colour mark.
const svg = read('assets/logo-mark.svg');
const root = (svg.match(/<svg\b[^>]*>/) || [''])[0];
// IT MUST PARSE: a double hyphen inside an XML comment is not well formed, and
// an <img> of an SVG that does not parse shows a broken picture.
const badComments = (src) => [...src.matchAll(/<!--([\s\S]*?)-->/g)].filter((m) => m[1].includes('--') || m[1].endsWith('-'));
ok(badComments('<!-- the ink, --text -->').length === 1 && badComments('<!-- the ink, the text token -->').length === 0,
  'the comment reader finds a double hyphen and passes over a plain comment');
ok(svg === M.markSvg, 'assets/logo-mark.svg is the design\'s mark file, written by the script');
ok(!badComments(svg).length && /^\s*<svg\b[\s\S]*<\/svg>\s*$/.test(svg), 'and it is well formed: no double hyphen in a comment, one svg element and nothing after it');
ok(/\scolor="#F5F5F7"/.test(root) && /viewBox="0 0 120 120"/.test(root) && /role="img"/.test(root) && /aria-label="Occlara"/.test(root),
  'it carries color="#F5F5F7", the ink, on its root, in the 120 box', root);
ok(pathsIn(svg).length === 1 && pathsIn(svg)[0] === D && /fill-rule="evenodd"/.test(pathTags(svg)[0]) && /fill="currentColor"/.test(pathTags(svg)[0]),
  'one path, the moon, even odd, in currentColor');

/** An inline mark: its svg's own tag and its one path, the moon, even odd, currentColor. */
function inlineMoon(block, inherit) {
  const tags = pathTags(block);
  return tags.length === 1 && pathsIn(block)[0] === D && /fill-rule="evenodd"/.test(tags[0])
    && (/fill="currentColor"/.test(tags[0]) || (inherit && /fill="currentColor"/.test(block)));
}

// 3. The corner mark and the Recording screen inline the same path.
const dock = read('src/renderer/dock/index.html');
const dockSvg = svgBlock(dock, 'mark');
ok(/viewBox="0 0 120 120"/.test(dockSvg) && /width="26"/.test(dockSvg) && inlineMoon(dockSvg), 'the corner mark is the same moon at 26px, even odd, in currentColor');
const shell = read('src/renderer/shell/index.html');
const sealed = svgBlock(shell, 'sealed-mark');
ok(/viewBox="0 0 120 120"/.test(sealed) && /width="88"/.test(sealed) && inlineMoon(sealed),
  'the Recording screen\'s mark is the same moon at 88px, even odd, in currentColor');
const shellCss = read('src/renderer/shell/shell.css');
const code = (src) => src.replace(/<!--[\s\S]*?-->/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
const dot = (code(shellCss).match(/\n\.sealed h1::before \{([^}]*)\}/) || [])[1] || '';
ok(/background: var\(--signal\)/.test(dot) && /width: 8px/.test(dot) && /height: 8px/.test(dot) && !/animation/.test(dot)
  && /\n\.sealed\.held h1::before \{ display: none; \}/.test(shellCss),
'its live dot is one still 8px dot in the signal before the title, and held it goes', dot.trim());
ok(!/infinite/.test((code(shellCss).match(/\n\.sealed[^{]*\{[^}]*\}/g) || []).join('\n')), 'and nothing on the Recording screen loops');
// The bar's mark: the colour drawing at 22.
const barImg = (shell.match(/<img class="mark"[^>]*>/) || [''])[0];
ok(/src="\.\.\/\.\.\/\.\.\/assets\/mark-bar\.svg"/.test(barImg) && /width="22"/.test(barImg) && /height="22"/.test(barImg)
  && /\.brand \.mark \{ width: 22px; height: 22px;/.test(shellCss),
'the bar\'s mark is the moon in colour at 22px, assets/mark-bar.svg', barImg);
ok(read('assets/mark-bar.svg') === gen.barMark() && gen.BAR_PX === 22, 'and assets/mark-bar.svg is the design\'s 24 unit drawing at 22, written by the script');

// 4. The splash: the clean colour moon, one motion.
const splash = read('src/renderer/splash/index.html');
const splashCss = read('src/renderer/splash/splash.css');
ok(/<img class="moon" src="\.\.\/\.\.\/\.\.\/assets\/splash\/moon\.svg" width="160" height="160"/.test(splash)
  && read('assets/splash/moon.svg') === gen.splashMoon() && gen.SPLASH_PX === 160,
'the splash shows the clean moon, assets/splash/moon.svg as the script draws it, at 160');
ok(gen.SPLASH_OPTS.level === 'clean' && gen.splashMoon().includes(`${A.seaPath(0, 0, 100).slice(0, 40)}`),
  'the splash\'s moon is the CLEAN drawing, its seas the same seas the mark is cut from');
ok(!/<mask\b|<circle\b|class="shade"|<pattern\b/.test(splash) && !/infinite/.test(code(splashCss)),
  'no shade, mask or orbit is left in the splash, and nothing loops');
const frames = [...code(splashCss).matchAll(/@keyframes\s+([\w-]+)/g)].map((m) => m[1]).sort().join(',');
// Every element that animates: a rule's selectors whose animation is not none, each once.
const animated = [...new Set([...code(splashCss).matchAll(/([^{}]+)\{([^{}]*)\}/g)]
  .filter((m) => /\banimation:\s*(?!none)/.test(m[2]))
  .flatMap((m) => m[1].trim().split(',').map((s) => s.trim())))].sort();
ok(frames === 'moonIn,stageIn,stageOut,wordIn' && animated.join('|') === '.moon|.stage|.wordmark',
  'one motion: the card in and out, the moon arriving and the name fading up, nothing else', `${frames} | ${animated.join(' ')}`);
const moonIn = (code(splashCss).match(/@keyframes moonIn \{([\s\S]*?)\n\}/) || [])[1] || '';
ok(/from \{[^}]*opacity: 0;[^}]*filter: blur\(\d+px\)/.test(moonIn) && /to\s+\{[^}]*opacity: 1;[^}]*filter: none;/.test(moonIn),
  'the moon fades in and sharpens from a soft blur', moonIn.trim());
ok(/class="wordmark">Occlara</.test(splash) && /\.wordmark \{[^}]*font-family: var\(--font\);[^}]*font-weight: 700;/.test(splashCss),
  'the name under it is "Occlara", Onest 700 as the bar sets it');

// 5. Every other place that signs with the mark draws the same moon.
const homeHw = svgBlock(read('src/renderer/home/index.html'), 'hw-mark');
const toastMoon = svgBlock(read('src/renderer/toast/index.html'), 'plan-moon');
const wrappedHtml = read('src/renderer/wrapped/index.html');
const wrappedBrand = (wrappedHtml.match(/<div class="wr-brand"[\s\S]*?<\/svg>/) || [''])[0];
ok(inlineMoon(homeHw) && inlineMoon(toastMoon, true) && inlineMoon(wrappedBrand),
  'Home\'s Wrapped row, the games toast and Wrapped\'s brand draw the same moon, even odd');
const js = (rel, name) => ((read(rel).match(new RegExp(`const ${name} = '([^']+)';`)) || [])[1]);
ok(js('src/renderer/shared/verdict-card.js', 'MARK') === D && /ctx\.fill\(new Path2D\(MARK\), 'evenodd'\)/.test(read('src/renderer/shared/verdict-card.js')),
  'the share image draws the same moon, even odd');
ok(js('src/renderer/wrapped/card.js', 'MARK') === D && /ctx\.fill\(new Path2D\(MARK\), 'evenodd'\)/.test(read('src/renderer/wrapped/card.js'))
  && js('src/renderer/wrapped/wrapped.js', 'D') === D && (read('src/renderer/wrapped/wrapped.js').match(/'fill-rule': 'evenodd'/g) || []).length === 2,
'Wrapped\'s card and its opening draw the same moon, even odd');

// 6. The icons: each the file the manifest records, rendered from these drawings.
const man = JSON.parse(read('scripts/moon/rendered.json'));
const crypto = require('crypto');
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
for (const [rel, entries] of gen.jobs()) {
  const rec = man.files[rel];
  const there = fs.existsSync(path.join(ROOT, rel));
  ok(!!rec && there && rec.sources === gen.sourceHash(entries) && rec.sha256 === sha(buf(rel)),
    `${rel} is rendered from today's drawings and is the file the render wrote`,
    !rec ? 'not in the manifest' : !there ? 'missing' : rec.sources !== gen.sourceHash(entries) ? 'the drawings changed: run node scripts/generate-icon.js' : 'the file was changed by hand');
}
/** The PNG entries of an ICO, as { size, png }. */
function icoEntries(b) {
  return Array.from({ length: b.readUInt16LE(4) }, (_v, i) => {
    const e = 6 + i * 16;
    return { size: b[e] || 256, png: b.subarray(b.readUInt32LE(e + 12), b.readUInt32LE(e + 12) + b.readUInt32LE(e + 8)) };
  });
}
/** A PNG the script wrote (every row filter 0) as its size and RGBA pixels. */
function decode(p) {
  const w = p.readUInt32BE(16), h = p.readUInt32BE(20);
  let at = 8; const idat = [];
  while (at < p.length) {
    const n = p.readUInt32BE(at); const type = p.toString('ascii', at + 4, at + 8);
    if (type === 'IDAT') idat.push(p.subarray(at + 8, at + 8 + n));
    at += 12 + n;
  }
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const px = Buffer.alloc(w * h * 4);
  let filtered = 0;
  for (let y = 0; y < h; y++) { if (raw[y * (1 + w * 4)] !== 0) filtered++; raw.copy(px, y * w * 4, y * (1 + w * 4) + 1, (y + 1) * (1 + w * 4)); }
  return { w, h, px, filtered, at: (x, y) => px.subarray((y * w + x) * 4, (y * w + x) * 4 + 4) };
}
const icon = icoEntries(buf('assets/icon.ico'));
ok(icon.map((e) => e.size).join(' ') === gen.APP.join(' ') && icon.every((e) => decode(e.png).w === e.size && decode(e.png).h === e.size),
  'assets/icon.ico holds the tile at 16 to 256, each entry its own size', icon.map((e) => e.size).join(' '));
ok(JSON.stringify(man.files['assets/icon.ico'].drawings) === JSON.stringify(gen.APP.map((s) => `${s} ${gen.appDrawing(s)}`))
  && gen.appDrawing(256) === 'drawn moon, grain' && gen.appDrawing(48) === 'drawn moon' && gen.appDrawing(32) === 'the 32 grid drawing' && gen.appDrawing(16) === 'the 16 px drawing',
'each size from the moon\'s own drawing: the drawn moon from 256 to 40, the 32 grid drawing at 32 and 24, the 16 px drawing at 20 and 16');
const big = decode(buf('assets/icon.png'));
ok(big.w === 512 && big.at(0, 0)[3] === 0 && big.at(256, 256)[3] === 255 && big.at(256, 256)[0] > 120,
  'assets/icon.png is the 512 tile: clear past the squircle, the lit moon at its centre', `${big.w} corner a${big.at(0, 0)[3]} centre ${[...big.at(256, 256)].join(',')}`);
const near = (px, hex) => [1, 3, 5].every((k, i) => Math.abs(px[i] - parseInt(hex.slice(k, k + 2), 16)) <= 4);
for (const [file, kind, ink] of gen.TRAYS) {
  const entries = icoEntries(buf(`assets/${file}`));
  const p = decode(entries[0].png);
  const solid = [];
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) if (p.at(x, y)[3] >= 200) solid.push(p.at(x, y));
  const shape = kind === 'rec'
    // The ring (r 6 to 7) and the moon as its dot (r 4), the gap between them clear.
    ? p.at(8, 8)[3] >= 200 && p.at(8, 1)[3] >= 128 && p.at(8, 2)[3] <= 64 && p.at(0, 0)[3] === 0
    // The disc (r 7) with its seas and Tycho's crater cut: the crater's pixel clear, the highland lit.
    : p.at(7, 11)[3] <= 64 && p.at(12, 11)[3] >= 200 && p.at(0, 0)[3] === 0;
  ok(entries.map((e) => e.size).join(' ') === gen.TRAY.join(' ') && p.w === 16 && p.filtered === 0 && solid.length > 20 && solid.every((px) => near(px, ink)) && shape,
    `assets/${file} is the ${kind === 'rec' ? 'record ring with the moon as its dot' : 'moon with its seas cut'} in ${ink}, crisp at 16, at 16 to 48`,
    `${solid.length} solid pixels, sizes ${entries.map((e) => e.size).join(' ')}`);
}

// 7. No crescent or aperture is left in what ships, but the AI log's eye,
// which is an eye by design.
const stale = [];
(function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else if (/\.(js|css|html|svg|txt)$/.test(e.name) && !p.endsWith(path.join('shared', 'log-eye.js'))
      && /aperture|\bpupils?\b|M67\.444|M76\.294|77\.738/i.test(fs.readFileSync(p, 'utf8'))) stale.push(path.relative(ROOT, p));
  }
})(path.join(ROOT, 'src'));
for (const f of fs.readdirSync(path.join(ROOT, 'assets'))) {
  if (/\.(svg|txt)$/.test(f) && /aperture|\bpupils?\b|M67\.444|77\.738/i.test(read(`assets/${f}`))) stale.push(`assets/${f}`);
}
ok(!stale.length, 'no crescent, aperture or pupil is left in src or assets, but the AI log\'s eye', stale.join(', '));
ok(!fs.existsSync(path.join(ROOT, 'assets', 'splash', 'glass.png')) && !fs.existsSync(path.join(ROOT, 'assets', 'splash', 'glow.png')) && !fs.existsSync(path.join(ROOT, 'assets', 'splash', 'ground.png')),
  'and the crescent splash\'s pictures are gone');

console.log(fails ? `\n${fails} mark check(s) FAILED` : '\nall mark checks passed: one moon in its five places, from one source, and every icon rendered from it');
process.exit(fails ? 1 : 0);
