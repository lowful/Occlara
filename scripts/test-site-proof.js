'use strict';

/**
 * The site proof exporter (scripts/export-site-proof.js), offline: run twice
 * on the sample library (--json-only, no pictures), proof.generated.json is
 * the same bytes both times, carries no dash, no Riot ID mark, no email, no
 * review id and no date, says "Sample match", and holds what the website
 * reads off it: the Verdict (a B of 71), the four categories with their
 * evidence, the coach's read, the fix line, the repeated mistakes, the
 * rounds, the progress lines and the Moments entries. mark.json carries the
 * crescent and the tokens. The fixture itself carries no dash either.
 *
 * Run: npm run test:siteproof
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const EXPORTER = path.join(__dirname, 'export-site-proof.js');
// The two dashes the house rules ban, as escapes so this file carries neither.
const DASHES = new RegExp('[\\u2013\\u2014]');

let fails = 0;
let checks = 0;
const ok = (cond, what, detail) => {
  checks++;
  if (!cond) { fails++; console.log(`FAIL  ${what}${detail ? `\n        ${detail}` : ''}`); } else console.log(`ok    ${what}`);
};

const dirs = ['a', 'b'].map((k) => path.join(os.tmpdir(), `occlara-site-proof-test-${k}`));
for (const d of dirs) { fs.rmSync(d, { recursive: true, force: true }); fs.mkdirSync(d, { recursive: true }); }

const runs = dirs.map((d) => {
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const r = spawnSync(process.execPath, [EXPORTER, '--out', d, '--json-only'], { cwd: ROOT, encoding: 'utf8', env, timeout: 220000 });
  return { dir: d, status: r.status, out: `${r.stdout || ''}${r.stderr || ''}` };
});
for (const r of runs) ok(r.status === 0, `the exporter ran into ${path.basename(r.dir)}`, r.status === 0 ? '' : r.out.trim().split('\n').slice(-6).join('\n        '));
if (runs.some((r) => r.status !== 0)) { console.log(`\n${checks - fails} of ${checks} checks passed`); process.exit(1); }

const read = (d, f) => fs.readFileSync(path.join(d, f));
const textA = read(dirs[0], 'proof.generated.json').toString('utf8');
ok(textA === read(dirs[1], 'proof.generated.json').toString('utf8'), 'proof.generated.json is the same bytes on two runs');
ok(read(dirs[0], 'mark.json').equals(read(dirs[1], 'mark.json')), 'mark.json is the same bytes on two runs');

// ── What it must not carry ────────────────────────────────────────────────
ok(!DASHES.test(textA), 'the proof carries no em or en dash');
ok(!/#/.test(textA), "the proof carries no '#', the mark of a Riot ID");
ok(!/@/.test(textA), 'the proof carries no email');
ok(!/valorant-\d{10,}/.test(textA), 'the proof carries no review id');
ok(!/\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d{1,2}, \d{1,2}:\d{2} [AP]M\b/.test(textA), 'the proof carries no date or time of a match');
ok(!/GC-TEST/.test(textA), "the proof carries no account key");
for (const f of ['scripts/fixtures/proof-reviews.js', 'scripts/export-site-proof.js', 'scripts/fixtures/window-shot.js']) {
  ok(!DASHES.test(fs.readFileSync(path.join(ROOT, f), 'utf8')), `${f} carries no em or en dash`);
}

// ── What it must carry ────────────────────────────────────────────────────
const p = JSON.parse(textA);
ok(p.label === 'Sample match', 'the proof is labelled "Sample match"', p.label);
ok(/^[0-9a-f]{40}$/.test(p.commit) && typeof p.dirty === 'boolean', 'the proof is stamped with the git commit', p.commit);
ok(p.window && p.window.width === 1280 && p.window.height === 800 && p.window.scale === 2, 'the proof names the window its pictures are of');
const v = p.review && p.review.verdict;
ok(v && v.letter === 'B' && v.score === '71' && v.out === '/100' && v.stat && v.stat.value && v.stat.label && v.result === 'VICTORY' && v.scoreline === '13 : 11',
  'the Verdict is a B of 71 on a 13 : 11 victory with its standout', JSON.stringify(v));
ok(v && v.stats.length >= 2 && v.stats.every((s) => s.value && s.label), "Riot's numbers are there, each a value and a label");
const cats = p.review && p.review.grade.categories;
ok(Array.isArray(cats) && cats.length === 4 && cats.every((c) => c.name && /^\d+$/.test(c.score) && c.evidence.length > 0),
  'four categories, each with a score and its evidence chips', JSON.stringify(cats && cats.map((c) => [c.name, c.score, c.evidence.length])));
ok(p.review.read.heading === "The coach's read" && p.review.read.lines.length === 3, "the coach's read, three lines", JSON.stringify(p.review.read));
ok(p.review.fix.text === p.home.fix && p.review.fix.text.length > 20, 'the fix line, the same on Home and the review', p.review.fix.text);
ok(p.review.progress.length >= 3 && p.review.progress.every((l) => l.text && l.tone), 'the progress lines', JSON.stringify(p.review.progress));
const mistakes = p.review.lists.find((l) => l.heading === 'Your repeated mistakes');
ok(mistakes && mistakes.items[0].title === 'Died where nobody could trade' && mistakes.items[0].hero && mistakes.items[0].detail,
  'the repeated mistakes, the top one first as the hero', JSON.stringify(mistakes && mistakes.items.map((i) => i.title)));
ok(mistakes && mistakes.items.every((i) => !/^(?:→\s*)?Fix\b/.test(i.fix)), 'a fix carries its sentence, not its label');
ok(mistakes && mistakes.items.slice(1).every((i) => i.fix), 'every mistake after the first carries a fix');
ok(p.review.rounds.rows.length === 24 && p.review.rounds.halves.length === 2 && p.review.rounds.rows.every((r) => /^R\d+$/.test(r.n) && r.result && r.side),
  'every round as a row with its number, result and side, under two halves', `${p.review.rounds.rows.length} rows`);
ok(p.review.rounds.rows.some((r) => r.tags.length > 2), 'the rounds carry their tags');
ok(p.home.last.grade.score === '71' && p.home.last.grade.letter === 'B' && p.home.recent.length === 4 && p.home.trend.grades.join() === '58,61,64,71',
  'Home: the last match a B of 71, four recent matches, the grade rising', JSON.stringify(p.home.trend));
ok(p.home.recent.every((r) => r.result && r.grade && r.letter && !/\d{1,2}:\d{2}/.test(r.meta)), 'the recent rows carry no time');
ok(p.matches.rows.length === 4 && p.matches.rows.every((r) => r.topMistake === 'Died where nobody could trade'), 'Matches: four rows, each with its top mistake');
ok(p.patterns.lists.length >= 2 && p.patterns.lists[0].items[0].title === 'Died where nobody could trade', 'Patterns: the lists across the matches');
const mo = p.moments;
ok(mo && mo.matches.length === 4 && mo.compilation.rows.length >= 3 && /^\d+ deaths, \d+ highlights, 1 clip across 4 matches$/.test(mo.counts),
  'Moments: four matches, the compilation and the counts line', mo && mo.counts);
ok(mo && mo.matches.every((m) => m.moments.length && m.moments.every((x) => x.round && x.kind && x.title)), 'every Moments entry has its round, kind and title');
ok(mo && mo.matches.some((m) => m.moments.some((x) => x.kind === 'Highlight')) && mo.matches.some((m) => m.moments.some((x) => x.clip === 'Play')),
  'Moments: a highlight, and the one clip kept');
ok(mo && mo.matches.some((m) => m.moments.some((x) => x.title === 'Caught alone' && x.line)), "Moments: a death titled by the coach's look");
ok(mo && mo.matches.every((m) => !('when' in m)), 'the Moments matches carry no date');
ok(p.sealed && p.sealed.title === 'Recording' && p.sealed.facts.length === 3, 'the Recording screen, its title and three facts');
ok(p.shell.pages.join() === 'Home,Matches,Patterns,Moments,Stats,Ask Coach' && p.shell.start === 'Start', 'the shell: its pages and Start');
ok(p.invite && p.invite.progress && p.invite.how.length === 2, 'Invite: the progress line and how it works');

const mark = JSON.parse(read(dirs[0], 'mark.json').toString('utf8'));
ok(mark.path && mark.viewBox === '0 0 120 120' && mark.ground === '#0A0B0E' && mark.ink === '#F5F5F7' && mark.signal === '#E5383B' && mark.label === 'Sample match',
  'mark.json: the crescent, the ground, the ink and the signal', JSON.stringify(mark));

for (const d of dirs) fs.rmSync(d, { recursive: true, force: true });
console.log(`\n${checks - fails} of ${checks} checks passed`);
process.exit(fails ? 1 : 0);
