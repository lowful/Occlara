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

// PRACTICE, NEVER PRACTISE (9.1, the owner's rule): saved model text can say
// "practised" (a review in the owner's library: "play the simple, practised
// rounds that built the lead"); it reads "practiced" wherever it is shown.
const spelt = [
  ['play the simple, practised rounds that built the lead', 'play the simple, practiced rounds that built the lead'],
  ['Practise the swing.', 'Practice the swing.'],
  ['Keep practising it; then review.', 'Keep practicing it. Then review.'],
  ['PRACTISE', 'PRACTICE'],
  ['She practises lineups', 'She practices lineups'],
  ['Practice stays practice.', 'Practice stays practice.'],
];
for (const [input, want] of spelt) {
  const got = a.scrubText({ t: input }).t;
  ok(got === want, `"${input}" is shown as "${want}"`, got);
  ok(b.scrubText({ t: input }).t === got, 'and the server copy shows it the same');
}
ok(a.practiceSpelling(null) === null && a.practiceSpelling('practiced') === 'practiced', 'a value that is not a string, or spelt already, is left alone');
ok(a.scrubText({ u: 'https://occlara.app/practise' }).u === 'https://occlara.app/practise', 'a link keeps its own spelling');
{
  // Through the home model's fix, the way Home shows it.
  const HM = require('../src/shared/home-model');
  const row = { id: 'valorant-1-a', game: 'valorant', at: Date.now(), map: 'Split', title: 'Jett', grade: { score: 70 } };
  const m = HM.homeModel({ rows: [row], patterns: {}, review: { id: 'valorant-1-a', focus: 'Play the practised rounds; trade.' }, previous: null });
  ok(m.focus === 'Play the practiced rounds. Trade.', "Home's fix is shown as Practice spells it", m.focus);
}
{
  // Through the lists every repeat is counted from (insights.countable): a
  // cause's fix is the look's `better`, and Practice's focus, the Patterns
  // fix, the breakdown's "Repeated here" and the weekly report all show it.
  const { countable } = require('../src/shared/insights');
  const patternsOf = require('../src/shared/patterns');
  const entry = { key: 'cause:repeek', title: 'Repeeks', count: 2, rounds: [3, 7], fix: 'Practise the jiggle peek; then swing once.', detail: 'Round 3; repeeked.' };
  const out = countable({ insights: { mistakes: [entry], strengths: [], missed: [] } }).mistakes[0];
  ok(out.fix === 'Practice the jiggle peek. Then swing once.' && out.detail === 'Round 3. Repeeked.' && entry.fix.includes('Practise'),
    "a list's fix and line read as Practice spells them, with no semicolon, the saved review untouched", JSON.stringify(out));
  const clean = { key: 'cause:repeek', title: 'Repeeks', count: 2, rounds: [3, 7], fix: 'Swing once.' };
  ok(countable({ insights: { mistakes: [clean] } }).mistakes[0] === clean, 'and an entry with nothing to change is the same entry');
  const reviews = [1, 2, 3].map((i) => ({ id: `valorant-${i}-a`, at: i, game: 'valorant',
    review: { kind: 'valorant', insights: { mistakes: [{ ...entry, fix: 'Keep practising the jiggle peek; then swing once.' }], strengths: [], missed: [] }, rounds: [] } }));
  const p = patternsOf.summarise(reviews);
  const m = p && Array.isArray(p.mistakes) ? p.mistakes.find((x) => x.key === 'cause:repeek') : null;
  ok(m && m.fix === 'Keep practicing the jiggle peek. Then swing once.', 'and a repeated mistake\'s fix on Practice and Patterns too', JSON.stringify(m && m.fix));
}

// The two files are one rule: the code, apart from its comments, is the same.
const body = (f) => fs.readFileSync(path.join(root, f), 'utf8').replace(/\r\n/g, '\n').replace(/\/\*[\s\S]*?\*\//g, '').trim();
ok(body('src/shared/plain-text.js') === body('server/services/plain-text.js'), 'src and server hold the same code');

// The wiring: the presenter, the home model and the server's cleaners use it.
const has = (f, re) => re.test(fs.readFileSync(path.join(root, f), 'utf8'));
ok(has('src/main/index.js', /scrubText/), 'a review is cleaned as it is presented');
ok(has('src/shared/home-model.js', /noSemicolons\(ownFocus/), 'the fix on Home is cleaned');
ok(has('src/shared/home-model.js', /practiceSpelling\(noSemicolons\(ownFocus/), 'and spelt as Practice spells it');
ok(has('src/main/services/ask-coach.js', /reply: practiceSpelling\(data\.reply\)/), "Ask Coach's answer is shown as Practice spells it");
ok(has('src/shared/moments.js', /scrubText\(f\.what\)/), "the look's words on Clips are cleaned as the review's are");
ok(has('src/main/index.js', /PUSH_DEATH_EXPLAIN[^\n]*scrubText/), 'and Further explain is');
ok(has('server/services/match-review.js', /out\.focus = noSemicolons/), 'the model\'s focus is cleaned as it is read');
ok(has('server/routes/coach.js', /\\s\*;\\s\*/), 'the shared server cleaner drops semicolons');
ok(has('server/services/match-review.js', /never use semicolons/), 'the review prompt says never to write one');

console.log(failed ? `\n${failed} FAILED` : '\nall plain text checks passed');
process.exit(failed ? 1 : 0);
