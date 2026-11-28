'use strict';

/**
 * ONE SCORE AND ONE WAY TO SAY IT (9.1, the owner's items 16 and 1):
 * src/shared/display.js, and the copies of it that have to stand alone.
 *
 *   - the grade is a number out of 100 and the match rating is shown on the
 *     same 100 scale (8.3 is 83, a move of +0.6 is +6), and a list of moves
 *     always adds up to the change in the shown numbers;
 *   - the two names, "Grade" and "Match rating", each with its tooltip, the
 *     same in display.js and in GradeView (a page cannot require display.js
 *     from a preload world, so GradeView keeps the words, and this holds them
 *     to one answer);
 *   - the rating badge's own arithmetic (the stream widget's page is that file
 *     inlined) gives display.js's number and move for every value;
 *   - a mistake's title inside a sentence starts lower case, names keep their
 *     capital, and the agents a page knows are the game data's;
 *   - no page draws a letter grade (a scan of the renderer's scripts).
 *
 * Run: npm run test:display
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const D = require('../src/shared/display');
const data = require('../src/shared/valorant-data.generated.json');

let fails = 0;
let checks = 0;
const ok = (cond, what, detail) => {
  checks++;
  if (!cond) { fails++; console.log(`FAIL  ${what}${detail !== undefined ? `\n        ${detail}` : ''}`); } else console.log(`ok    ${what}`);
};
const DASHES = new RegExp('[\\u2013\\u2014]');

// ── The names ──────────────────────────────────────────────────────────────
ok(D.NAMES.grade.name === 'Grade' && D.NAMES.rating.name === 'Match rating', 'the two names: Grade and Match rating');
ok([D.NAMES.grade.tip, D.NAMES.rating.tip].every((t) => typeof t === 'string' && t.length > 20 && t.length < 160 && !DASHES.test(t) && /out of 100/.test(t)),
  'each has a short tooltip that says it is out of 100, with no dash');
ok(/coach's read/.test(D.NAMES.grade.tip) && /chance to win/.test(D.NAMES.rating.tip), 'the grade is the coach\'s read, the rating the chance to win');

// ── The grade ──────────────────────────────────────────────────────────────
ok(D.grade(84) === '84' && D.grade(84.4) === '84' && D.grade({ score: 71 }) === '71' && D.grade(null) === '' && D.grade(NaN) === '' && D.grade(140) === '100',
  'a grade is its whole number out of 100, or nothing');
ok(D.gradeWords({ score: 84 }) === 'Grade 84' && D.gradeWords({ score: 66, provisional: true }) === 'Grade 66, provisional' && D.gradeWords(null) === '',
  'said in words: "Grade 84", "Grade 66, provisional"');
ok(D.gradeDelta(19) === '+19' && D.gradeDelta(-12) === '-12' && D.gradeDelta(0) === '0' && D.gradeDelta(null) === '', 'a change in the grade: +19, -12, 0');

// ── The match rating on the 100 scale ───────────────────────────────────────
ok(D.rating(8.3) === '83' && D.rating(6) === '60' && D.rating(10) === '100' && D.rating(3) === '30' && D.rating(6.04) === '60' && D.rating(6.05) === '61' && D.rating(null) === '',
  'the rating times ten, rounded: 8.3 is 83, 6.0 is 60, 10.0 is 100');
ok(D.ratingDelta(0.6) === '+6' && D.ratingDelta(-0.3) === '-3' && D.ratingDelta(0.04) === '0' && D.ratingDelta(-0.04) === '0' && D.ratingDelta(undefined) === '',
  'a move times ten, signed: +0.6 is +6, a move under half a point is 0');
ok(D.ratingMove(8.34, 7.66) === '+6' && D.ratingMove(7.04, 7.16) === '-2' && D.ratingMove(6, 6) === '0', 'a move between two values is the difference of the two shown numbers');
{
  // A list of values and their moves always adds up, however the values fall.
  let seed = 7;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  let addsUp = true;
  for (let run = 0; run < 200; run++) {
    const vals = [6];
    for (let i = 0; i < 30; i++) vals.push(Math.max(3, Math.min(10, vals[vals.length - 1] + (rnd() - 0.5) * 0.9)));
    const sum = vals.slice(1).reduce((n, v, i) => n + Number(D.ratingMove(v, vals[i])), 0);
    if (sum !== D.ratingPoints(vals[vals.length - 1]) - D.ratingPoints(vals[0])) addsUp = false;
  }
  ok(addsUp, 'over 200 matches of 30 moves, the shown moves add up to the change in the shown number');
}
ok(D.moveWay('+6') === 'up' && D.moveWay('-3') === 'down' && D.moveWay('0') === null && D.moveWay('+0') === null && D.moveWay('-0.0') === null && D.moveWay('') === null,
  'which way a shown move goes: +6 up, -3 down, 0 neither');

// The rating badge stands alone (the stream widget is that file inlined): its arithmetic is display.js's.
{
  const sandbox = { window: {}, document: {} };
  vm.runInNewContext(fs.readFileSync(path.join(ROOT, 'src/renderer/shared/rating-badge.js'), 'utf8'), sandbox);
  const RB = sandbox.window.RatingBadge;
  let same = !!RB;
  for (let v = 3; RB && v <= 10.0001; v += 0.01) if (RB.points(v) !== D.ratingPoints(v)) same = false;
  for (const s of ['+6', '-3', '0', '+0', '-0', '', '+12', '-0.0', 'x']) if (RB && RB.wayOf(s) !== D.moveWay(s)) same = false;
  ok(same, "the rating badge's number and move are display.js's, for every value from 3.0 to 10.0");
  const num = { textContent: '', style: { props: {}, setProperty(k, v) { this.props[k] = v; } } };
  const badge = { classList: { set: new Set(), add(c) { this.set.add(c); }, remove(c) { this.set.delete(c); } } };
  RB.setNumber(num, badge, 8.34);
  ok(num.textContent === '83' && num.style.props['--rt'] === '83' && badge.classList.set.has('t-great'), 'the badge writes 83 for 8.34, counts to 83 and keeps its tier', `${num.textContent} ${num.style.props['--rt']}`);
  const css = fs.readFileSync(path.join(ROOT, 'src/renderer/shared/rating-badge.css'), 'utf8');
  ok(/counter-reset:\s*rtv var\(--rt\)/.test(css) && /content:\s*counter\(rtv\)/.test(css) && !/counter\(rtw\)/.test(css),
    'the badge counts one whole number, never a decimal point');
}

// GradeView keeps the grade's name and tooltip as display.js has them.
{
  const GV = require('../src/renderer/shared/grade-view');
  ok(GV.GRADE_NAME === D.NAMES.grade.name && GV.GRADE_TIP === D.NAMES.grade.tip, "GradeView names the grade with display.js's words");
  ok(typeof GV.letter === 'undefined' && typeof GV.scoreBadge === 'function', 'GradeView has no letter() to draw with, only scoreBadge()');
}

// The pages that name the rating use the same tooltip.
{
  const tip = D.NAMES.rating.tip;
  for (const f of ['review/index.html', 'shell/index.html']) {
    const html = fs.readFileSync(path.join(ROOT, 'src/renderer', f), 'utf8');
    ok(html.includes(`title="${tip}"`) && html.includes('Match rating'), `${f}: "Match rating" with its tooltip`);
  }
  const review = fs.readFileSync(path.join(ROOT, 'src/renderer/review/index.html'), 'utf8');
  ok(/class="rt-out">out of 100</.test(review) && !/out of 10</.test(review), 'the review\'s rating block says out of 100');
}

// ── A title inside a sentence ──────────────────────────────────────────────
const cases = [
  ['Dying in the first 30 seconds', 'dying in the first 30 seconds'],
  ['Died where nobody could trade', 'died where nobody could trade'],
  ['Gave back the advantage', 'gave back the advantage'],
  ['One enemy agent kept winning', 'one enemy agent kept winning'],
  ['A teammate was close', 'a teammate was close'],
  ['Reyna kept winning', 'Reyna kept winning'],
  ['KAY/O kept winning', 'KAY/O kept winning'],
  ["Jett's dash", "Jett's dash"],
  ['B Main', 'B Main'],
  ['A site retakes', 'A site retakes'],
  ['3K rounds', '3K rounds'],
  ['ADR under 100', 'ADR under 100'],
  ['Riot\'s record', 'Riot\'s record'],
  ['Ahri roamed bot', 'Ahri roamed bot'],
  ['Haven attack', 'Haven attack'],
  ['', ''],
];
for (const [t, want] of cases) ok(D.inSentence(t) === want, `inSentence("${t}") is "${want}"`, D.inSentence(t));
ok(D.inSentence(null) === '' && D.inSentence(42) === '', 'anything not a string is nothing');

// The agents and maps a page knows are the game data's (sync:valorant adding one fails here first).
ok(JSON.stringify([...D.AGENTS].sort()) === JSON.stringify(Object.keys(data.agents).sort()), 'display.js AGENTS is every agent in valorant-data',
  `missing: ${Object.keys(data.agents).filter((a) => !D.AGENTS.includes(a)).join(', ')}`);
ok(JSON.stringify([...D.MAPS].sort()) === JSON.stringify([...data.maps].sort()), 'display.js MAPS is every map in valorant-data');

// In a page: no require, no module, the lists alone.
{
  const sandbox = { self: {} };
  vm.runInNewContext(fs.readFileSync(path.join(ROOT, 'src/shared/display.js'), 'utf8'), sandbox);
  const P = sandbox.self.OcclaraDisplay;
  ok(!!P && P.inSentence('Reyna kept winning') === 'Reyna kept winning' && P.inSentence('Dying at B Main') === 'dying at B Main'
    && P.rating(7.26) === '73' && P.ratingDelta(-0.3) === '-3', 'loaded in a page it sets window.OcclaraDisplay and works from its own lists');
  P.addNames(['Teemo']);
  ok(P.inSentence('Teemo shrooms') === 'Teemo shrooms', 'and a page may add the names it knows');
}

// ── No page draws a letter grade ─────────────────────────────────────────────
{
  const files = [];
  const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) { if (e.name !== 'vendor') walk(p); } else if (/\.(js|html)$/.test(e.name)) files.push(p); } };
  walk(path.join(ROOT, 'src/renderer'));
  const LETTER_CLASS = /\b(?:gv|m|b|vd|pv|dm-l|grade)-letter\b|id="pv-letter"|id="dm-l-/;
  const LETTER_TEXT = /\$\{[^}]*\.letter\}|textContent\s*=[^;]*\.letter\b|\.letters\[/;
  // 9.1: a letter can also reach the screen as a floor ("3 in a row at
  // ${run.floor || 'B'} or better" drew "at B or better" on Patterns' key)
  // or as a quoted letter a template falls back to.
  const LETTER_FLOOR = /\$\{[^}]*(?<!Math)\.floor\b[^}]*\}|\$\{[^}]*(?:\|\||\?\?)\s*['"][A-FS]['"]\s*\}/;
  const bad = [];
  for (const f of files) {
    const text = fs.readFileSync(f, 'utf8');
    text.split('\n').forEach((line, i) => {
      if (LETTER_CLASS.test(line) || LETTER_TEXT.test(line) || LETTER_FLOOR.test(line)) bad.push(`${path.relative(ROOT, f)}:${i + 1}: ${line.trim().slice(0, 120)}`);
    });
  }
  ok(bad.length === 0, 'ONE SCORE: no page script or document draws a letter grade', bad.join('\n        '));
  ok(LETTER_TEXT.test('el.textContent = g.letter;') && LETTER_CLASS.test("el('span', 'm-letter good')") && !LETTER_TEXT.test('letterSpacing = 2'),
    'and the scan finds a known letter when there is one');
  ok(LETTER_FLOOR.test("`${run.count} in a row at ${run.floor || 'B'} or better`") && LETTER_FLOOR.test("`at ${grade || 'A'}`")
    && !LETTER_FLOOR.test('`${Math.floor(n / 2)} rounds`') && !LETTER_FLOOR.test("`${run.from || 70} or better`"),
  'and a letter reached through a floor or a quoted fallback, never Math.floor or a number');
}

console.log(`\n${fails ? `FAIL: ${fails} of ${checks}` : `all ${checks} display checks passed`}`);
process.exit(fails ? 1 : 0);
