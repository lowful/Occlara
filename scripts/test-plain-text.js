'use strict';

/*
 * NO SEMICOLONS IN WHAT A PLAYER READS (owner rule, 8.7). The helper exists
 * twice, src/shared/plain-text.js and server/services/plain-text.js, and the
 * two must stay one rule. Run: node scripts/test-plain-text.js
 */

const fs = require('fs');
const path = require('path');

let failed = 0;
function ok(cond, what, detail) {
  console.log(`${cond ? 'ok   ' : 'FAIL '} ${what}`);
  if (!cond) { failed++; if (detail !== undefined) console.log('       ' + detail); }
}

const root = path.join(__dirname, '..');
const a = require('../src/shared/plain-text');
const b = require('../server/services/plain-text');
const SEMI = ';';

const cases = [
  ['Enter second for a match; let a teammate take first contact, then trade.', 'Enter second for a match. Let a teammate take first contact, then trade.'],
  ['Hold the angle ; then swing', 'Hold the angle. Then swing'],
  ['Trade your duelist;', 'Trade your duelist'],
  ['One; two; three.', 'One. Two. Three.'],
  ['Round 5; 13 kills', 'Round 5. 13 kills'],
  ['No semicolon here.', 'No semicolon here.'],
];
for (const [input, want] of cases) {
  const got = a.noSemicolons(input);
  ok(got === want, `"${input}" reads "${want}"`, got);
  ok(!got.includes(SEMI), 'and holds no semicolon');
  ok(b.noSemicolons(input) === got, 'the server copy gives the same answer');
}

ok(a.noSemicolons(null) === null && a.noSemicolons(7) === 7, 'a value that is not a string is left alone');

const deep = a.scrubText({ focus: 'a; b', rounds: [{ text: 'c; d' }], url: 'https://occlara.app/x;y', clip: 'occlara-clip://r/a;b', n: 3 });
ok(deep.focus === 'a. B' && deep.rounds[0].text === 'c. D' && deep.n === 3, 'scrubText cleans every string, deep, and keeps numbers');
ok(deep.url.includes(SEMI) && deep.clip.includes(SEMI), 'a link is left as it is');
// A kept frame reaches the review page as a data URL; scrubbed, it was a broken image.
const frameUrl = 'data:image/jpeg;base64,ZnJhbWU=';
ok(a.scrubText({ frame: frameUrl }).frame === frameUrl && b.scrubText({ frame: frameUrl }).frame === frameUrl, 'a data URL is left as it is');
ok(JSON.stringify(b.scrubText({ x: ['p; q'] })) === JSON.stringify(a.scrubText({ x: ['p; q'] })), 'the two copies scrub alike');

// The two files are one rule: the code, apart from its comments, is the same.
const body = (f) => fs.readFileSync(path.join(root, f), 'utf8').replace(/\r\n/g, '\n').replace(/\/\*[\s\S]*?\*\//g, '').trim();
ok(body('src/shared/plain-text.js') === body('server/services/plain-text.js'), 'src and server hold the same code');

// The wiring: the presenter, the home model and the server's cleaners use it.
const has = (f, re) => re.test(fs.readFileSync(path.join(root, f), 'utf8'));
ok(has('src/main/index.js', /scrubText/), 'a review is cleaned as it is presented');
ok(has('src/shared/home-model.js', /noSemicolons\(ownFocus/), 'the fix on Home is cleaned');
ok(has('server/services/match-review.js', /out\.focus = noSemicolons/), 'the model\'s focus is cleaned as it is read');
ok(has('server/routes/coach.js', /\\s\*;\\s\*/), 'the shared server cleaner drops semicolons');
ok(has('server/services/match-review.js', /never use semicolons/), 'the review prompt says never to write one');

console.log(failed ? `\n${failed} FAILED` : '\nall plain text checks passed');
process.exit(failed ? 1 : 0);
