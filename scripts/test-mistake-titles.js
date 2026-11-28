'use strict';

/**
 * ONE MISTAKE, ONE NAME (9.1, src/shared/mistake-titles.js). A key the lists
 * once wrote under two titles ("Deaths nobody traded" and "Died where nobody
 * could trade", both `untraded`) is shown under today's one wherever a saved
 * review is read: the review page (served), the patterns and Home, a library
 * row's top mistake, the Moments page, Wrapped's title for the year, and Ask
 * Coach's prompt. Nothing on disk is rewritten.
 *
 * Run: npm run test:mistaketitles
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const titles = require(path.join(ROOT, 'src/shared/mistake-titles'));
const insights = require(path.join(ROOT, 'src/shared/insights'));
const patterns = require(path.join(ROOT, 'src/shared/patterns'));
const moments = require(path.join(ROOT, 'src/shared/moments'));
const wrapped = require(path.join(ROOT, 'src/shared/wrapped'));
const vr = require(path.join(ROOT, 'src/shared/valorant-review'));
const ReviewStore = require(path.join(ROOT, 'src/main/services/review-store')).ReviewStore
  || require(path.join(ROOT, 'src/main/services/review-store'));

let failed = 0;
function ok(cond, label, detail) {
  if (cond) console.log(`ok    ${label}`);
  else { failed++; console.log(`FAIL  ${label}${detail ? `\n        ${detail}` : ''}`); }
}

const OLD = 'Died where nobody could trade';
const NEW = 'Deaths nobody traded';

console.log('the mapping:');
ok(titles.TITLES.untraded === NEW, 'untraded is "Deaths nobody traded" today');
ok(titles.todaysTitle('untraded', OLD) === NEW, 'the old untraded title reads as today\'s');
ok(titles.todaysTitle(null, OLD) === NEW && titles.todaysTitle(undefined, `  ${OLD.toLowerCase()} `) === NEW,
  'and with no key (a library row keeps the title alone), any case and spacing');
ok(titles.todaysTitle('early', OLD) === OLD, 'another key\'s entry is never renamed by a title it happens to share');
for (const t of ['Phoenix kept winning', 'Dying at A site', 'Repeek', 'Repeeks', 'Gave back the advantage', 'An advantage given back', NEW, '', 'x'])
  ok(titles.todaysTitle('untraded', t) === t || (t === NEW), `"${t}" is left as it is`);
ok(titles.todaysTitle('untraded', null) === null && titles.todaysTitle('untraded', 7) === 7, 'a title that is not a string comes back as it was');
const same = { key: 'early', title: 'Dying in the first 30 seconds' };
ok(titles.todaysEntryTitle(same) === same, 'an entry with nothing to rename is the same object');
const was = { key: 'untraded', title: OLD, detail: 'd', rounds: [1, 2, 3] };
const now = titles.todaysEntryTitle(was);
ok(now !== was && now.title === NEW && now.detail === 'd' && now.rounds === was.rounds && was.title === OLD,
  'a renamed entry is a copy with every other field kept, and the saved one untouched');
const keys = new Set();
for (const r of titles.RENAMED) {
  ok(r.key && r.from && r.to && r.from !== r.to, `the rename of "${r.from}" names its key and today's title`);
  ok(!keys.has(r.from.toLowerCase()), 'and no old title is listed twice');
  keys.add(r.from.toLowerCase());
  ok(!titles.RENAMED.some((x) => x.from.toLowerCase() === r.to.toLowerCase()), 'and no title today is itself renamed');
}
const DASH = new RegExp(`[${String.fromCharCode(0x2013)}${String.fromCharCode(0x2014)}]`);
ok(!DASH.test(fs.readFileSync(path.join(ROOT, 'src/shared/mistake-titles.js'), 'utf8')), 'the module carries no dash');

console.log('\nwhat the lists write today:');
{
  // Five untraded deaths, none with a teammate close: the title once was the old one.
  const card = (n, mate) => ({ n, result: 'loss', died: true, traded: false, mateNear: mate, aliveAtDeath: { mates: 4, enemies: 5 } });
  const facts = (mate) => [1, 2, 3, 4, 5].map((n) => card(n, mate));
  // insights.valorant reads the match's facts; drive it through its real entry point.
  const build = (mate) => {
    try { return insights.valorant(facts(mate), {}); } catch (e) { return { error: e.message }; }
  };
  const far = build('far');
  const close = build('close');
  const u = (x) => (x && Array.isArray(x.mistakes) ? x.mistakes.find((m) => m.key === 'untraded') : null);
  const src = fs.readFileSync(path.join(ROOT, 'src/shared/insights.js'), 'utf8');
  ok(!src.includes(`'${OLD}'`), 'insights.js writes the old title nowhere');
  ok(/key: 'untraded', title: TITLES\.untraded,/.test(src), 'and writes the untraded title from the shared mapping');
  ok(u(far) && u(close) && u(far).title === NEW && u(close).title === NEW && u(far).close === 0 && u(close).close === 5,
    'far or close, the entry is "Deaths nobody traded", the count of close deaths kept beside it',
    JSON.stringify([far.error || (u(far) && u(far).title), close.error || (u(close) && u(close).title)]));
}

console.log('\na review saved before, in today\'s words:');
{
  const ins = { mistakes: [{ key: 'untraded', title: OLD, detail: '5 of your 6 deaths went unanswered.', rounds: [1, 2, 4, 5, 7], count: 5, weight: 2 },
    { key: 'early', title: 'Dying in the first 30 seconds', detail: 'x', rounds: [3, 6, 9], count: 3, weight: 2 }], strengths: [], missed: [] };
  const t = insights.inTodaysWords(ins);
  ok(t.mistakes[0].title === NEW && t.mistakes[1].title === 'Dying in the first 30 seconds' && ins.mistakes[0].title === OLD,
    'inTodaysWords renames it and leaves the saved lists as they were');
  const review = { kind: 'valorant', source: 'watched', game: { map: 'Split', agent: 'Jett' }, insights: ins, rounds: [] };
  let served = null;
  try { served = vr.served(review); } catch (e) { served = { error: e.message }; }
  ok(served && served.insights && served.insights.mistakes[0].title === NEW, 'served() shows it under today\'s title', served && served.error);
  ok(insights.countable(review).mistakes[0].title === NEW, 'and countable(), which the patterns, progress, Practice and the weekly report read');
  ok(insights.repeatTitle('untraded', 'mistakes', { title: OLD, fix: 'f' }, new Set()).title === NEW,
    'repeatTitle names a count across matches by today\'s title, the newest sighting saved as it was');
  ok((() => {
    const rows = [...Array(10)].map((_, i) => ({ id: `valorant-${1780000000000 + i}-kkkk${i}`, game: 'valorant', at: 1780000000000 + i * 86400000,
      mistakes: i < 6 ? [{ key: 'untraded', n: 4, title: OLD }] : [] }));
    const m = wrapped.mistakesOf(rows);
    const all = m ? [m.beaten, m.still, ...(m.list || [])].filter(Boolean) : [];
    return all.length > 0 && all.every((x) => x.key !== 'untraded' || x.title === NEW);
  })(), 'Wrapped names the year\'s untraded deaths by today\'s title, from a year record saved under the old one');

  // Two matches, one saved under each title: one pattern, under today's title.
  const mk = (id, at, title) => ({ id, at, review: { kind: 'valorant', source: 'watched', at, game: { map: 'Split', agent: 'Jett' },
    grade: { score: 70, letter: 'B' }, insights: { mistakes: [{ key: 'untraded', title, detail: 'x', rounds: [1, 2, 3], count: 3, weight: 2 }], strengths: [], missed: [] } } });
  let sum = null;
  try {
    sum = patterns.summarise([mk('valorant-1790000000002-bbbbbb', 1790000000002, NEW), mk('valorant-1790000000001-aaaaaa', 1790000000001, OLD)]);
  } catch (e) { sum = { error: e.message }; }
  const pm = sum && Array.isArray(sum.mistakes) ? sum.mistakes.filter((p) => p.key === 'untraded') : [];
  ok(pm.length === 1 && pm[0].title === NEW, 'two matches saved under the two titles are one pattern, under today\'s', JSON.stringify(sum && (sum.error || sum.mistakes)).slice(0, 200));
  // The newest saved under the old title: the pattern still reads today's.
  try {
    sum = patterns.summarise([mk('valorant-1790000000002-bbbbbb', 1790000000002, OLD), mk('valorant-1790000000001-aaaaaa', 1790000000001, NEW)]);
  } catch (e) { sum = { error: e.message }; }
  const pm2 = sum && Array.isArray(sum.mistakes) ? sum.mistakes.filter((p) => p.key === 'untraded') : [];
  ok(pm2.length === 1 && pm2[0].title === NEW, 'and when the newest is the one saved under the old title', JSON.stringify(sum && (sum.error || sum.mistakes)).slice(0, 200));
}

console.log('\nthe Moments page and the library row:');
{
  ok((() => {
    const at = moments.mistakesAt({ source: 'watched', insights: { mistakes: [{ key: 'untraded', title: OLD, rounds: [4] }] } }, 4);
    return at.length === 1 && at[0].title === NEW;
  })(), 'a death on the Moments page is marked with today\'s title');
  const src = fs.readFileSync(path.join(ROOT, 'src/shared/moments.js'), 'utf8');
  ok(/title: todaysTitle\(e\.key, e\.title\)/.test(src), 'moments.js marks a death through the shared mapping');

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'occlara-titles-'));
  try {
    const rows = [
      { id: 'valorant-1790000000001-aaaaaa', game: 'valorant', at: 1790000000001, title: 'Jett', topMistake: OLD, source: 'watched' },
      { id: 'valorant-1790000000002-bbbbbb', game: 'valorant', at: 1790000000002, title: 'Jett', topMistake: 'Dying in the first 30 seconds', source: 'watched' },
      { id: 'valorant-1790000000003-cccccc', game: 'valorant', at: 1790000000003, title: 'Jett', topMistake: OLD, source: 'riot' },
    ];
    fs.writeFileSync(path.join(dir, 'index.json'), JSON.stringify(rows));
    for (const r of rows) fs.writeFileSync(path.join(dir, `${r.id}.json`), JSON.stringify({ id: r.id, game: r.game, at: r.at, review: { kind: 'valorant' } }));
    const store = new ReviewStore(dir);
    const list = store.list();
    const by = (id) => list.find((x) => x.id === id) || {};
    ok(by('valorant-1790000000001-aaaaaa').topMistake === NEW, 'a library row saved under the old title lists under today\'s', JSON.stringify(list.map((x) => x.topMistake)));
    ok(by('valorant-1790000000002-bbbbbb').topMistake === 'Dying in the first 30 seconds', 'any other title lists as it was');
    ok(by('valorant-1790000000003-cccccc').topMistake === null, "and a match graded from Riot's record alone still lists none");
    ok(JSON.parse(fs.readFileSync(path.join(dir, 'index.json'), 'utf8'))[0].topMistake === OLD, 'and the index on disk is never rewritten');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

console.log('\nAsk Coach, which cannot require the client file:');
{
  const cp = require(path.join(ROOT, 'server/services/chat-prompt'));
  ok(cp.CLIENT_UNTRADED_TITLE === titles.TITLES.untraded && cp.OLD_UNTRADED_TITLE === OLD,
    'chat-prompt.js holds the client\'s two titles word for word');
  const input = { game: 'valorant', player: { patterns: [{ key: 'untraded', title: NEW, matches: 4, of: 6, trend: 'falling' }] } };
  const input2 = { game: 'valorant', player: { patterns: [{ title: OLD, matches: 4, of: 6 }] } };
  let a = '';
  let b = '';
  try { a = String(cp.renderPlayer(input, false) || ''); b = String(cp.renderPlayer(input2, false) || ''); } catch (e) { a = `error ${e.message}`; }
  ok(a.includes(`"${cp.UNTRADED_TITLE}"`) && !a.includes(NEW) && b.includes(`"${cp.UNTRADED_TITLE}"`) && !b.includes(OLD),
    'a pattern under either client title reaches the prompt under the one title its match line uses', `${a.slice(0, 160)} | ${b.slice(0, 160)}`);
}

if (failed) {
  console.log(`\nFAIL: ${failed} mistake title check(s) failed`);
  process.exit(1);
}
console.log('\nPASS: one mistake, one name, wherever a saved review is read');
