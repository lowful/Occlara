'use strict';

/**
 * test:recordingstill. THE RECORDING SCREEN NEVER PULSES (the owner's
 * decision, Nov 2026, over ORBIT-SPEC.md's glow pulse and breathing dot;
 * docs/claude/screen-silence.md). Nothing on it moves but its arrival and the
 * facts changing: the live dot, Stop's inset glow, the round tape and the sky
 * behind it are still. Read from the CSS: no rule the Recording screen or
 * Stop matches carries a repeating animation, and the dot, Stop and the
 * screen's parts name no keyframe at all.
 */

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const R = path.join(__dirname, '..', 'src', 'renderer');
const read = (...p) => fs.readFileSync(path.join(R, ...p), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
let n = 0;
const ok = (name) => { n++; console.log(`  ok  ${name}`); };

/** Every rule of `css` as [selector, body]. */
function rules(css) {
  const out = [];
  const re = /([^{}@]+)\{([^{}]*)\}/g;
  let m;
  while ((m = re.exec(css))) out.push([m[1].trim(), m[2]]);
  return out;
}
const repeats = (body) => /animation[^;]*\binfinite\b/.test(body) || /animation-iteration-count\s*:\s*infinite/.test(body);
const animates = (body) => /(^|;|\s)animation(-name)?\s*:\s*(?!none)/.test(body);

const shell = read('shell', 'shell.css');
const ui = read('shared', 'ui.css');

// The screen's own parts, in the shell, and Stop wherever it is styled.
const SCREEN = /\.sealed\b|\.live-|#live-|\.sealed-|\.tape\b|\.lt-/;
const STOP = /\.btn-rec\.active|\.btn-rec\.active\s+\.rec-ico/;

for (const [sel, body] of rules(shell)) {
  if (!SCREEN.test(sel)) continue;
  assert.ok(!repeats(body), `${sel} repeats an animation on the Recording screen`);
}
ok('nothing on the Recording screen repeats an animation');

for (const [sel, body] of rules(shell)) {
  if (!/\.live-dot|\.sealed h1::before/.test(sel)) continue;
  assert.ok(!animates(body) && !/transition/.test(body), `${sel}: the live dot moves`);
}
ok('the live dot is still, no animation and no transition');

for (const css of [ui, shell]) {
  for (const [sel, body] of rules(css)) {
    if (!STOP.test(sel)) continue;
    assert.ok(!animates(body), `${sel}: Stop names an animation, its glow must be still`);
  }
}
ok('Stop and its stop glyph name no animation: the glow is still');

// The only keyframe the screen may play is its arrival, once.
const named = [];
for (const [sel, body] of rules(shell)) {
  if (!SCREEN.test(sel) || !animates(body)) continue;
  const m = /animation(?:-name)?\s*:\s*([A-Za-z][\w-]*)/.exec(body);
  if (m) named.push(`${sel} ${m[1]}`);
}
assert.ok(named.every((x) => /\briseIn$/.test(x)), `only the arrival plays: ${named.join(', ')}`);
ok('the one keyframe on the screen is its arrival, riseIn');

console.log(`\ntest:recordingstill: ${n} passed`);
