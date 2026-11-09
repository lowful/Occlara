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
// Home as 8.9 draws it: the last match card's parts, no empty one and one separator each.
const last = p.home.last;
ok(last.result === 'Victory' && last.score === '13 : 11' && last.meta === 'Jett · Abyss · Standard',
  "Home's last match: the result, the score and the agent, map and queue, one separator each", JSON.stringify([last.result, last.score, last.meta]));
ok(last.grade.label === 'Match grade' && last.grade.sub === 'Out of 100, from what the record shows', "Home's grade: its label and its line", JSON.stringify(last.grade));
ok(last.milestone.join() === 'Best in 4' && last.change === '+7', "Home's last match: its mark and its change since the match before", JSON.stringify([last.milestone, last.change]));
ok(last.kd && last.kd.label === 'K/D' && last.kd.ratio === (31 / 21).toFixed(2) &&last.kd.split === '31 / 21', "Home's K/D of the last match", JSON.stringify(last.kd));
ok(p.home.player.idShown === false && p.home.player.connect === 'Connect your Riot ID', 'Home shows no Riot ID, the Connect link in its place', JSON.stringify(p.home.player));
ok(p.home.top && p.home.top.title === 'Died where nobody could trade' && /^In \d of your last \d recorded matches\.$/.test(p.home.top.detail)
  && p.home.top.trend && p.home.top.fix.length > 20, "Home's top mistake, how often, its trend and its fix", JSON.stringify(p.home.top));
ok(p.home.mistakes.length >= 3 && p.home.mistakes.every((m) => m.title && /^\d+x$/.test(m.count)), "Home's repeated mistakes, each counted");
ok(p.home.trend.label === p.matches.chart.label && /^Grade over your last \d$/.test(p.home.trend.label), "the trend's label, as the Matches chart says it", p.home.trend.label);
ok(p.matches.rows.length === 4 && p.matches.rows.every((r) => r.topMistake === 'Died where nobody could trade'), 'Matches: four rows, each with its top mistake');
ok(p.matches.rows.every((r) => r.title === 'Jett on Abyss' && !/\d+\s*:\s*\d+/.test(r.meta)), 'Matches: each row the agent on the map, and no wins to losses');
ok(p.matches.chart && p.matches.chart.now === '71' && p.matches.chart.average === 'Average 64', 'Matches: the chart of the grade', JSON.stringify(p.matches.chart));
ok(p.patterns.lists.length >= 2 && p.patterns.lists[0].items[0].title === 'Died where nobody could trade', 'Patterns: the lists across the matches');
ok(p.patterns.lists[0].items[0].hero && p.patterns.lists[0].items[0].fix && p.patterns.lists[0].items.every((i) => i.chips.length >= 2),
  'Patterns: the top mistake a card with its fix, every entry with its chips');
ok(p.patterns.grades.join() === '58,61,64,71' && p.patterns.chart && p.patterns.chart.bands.join() === 'S 90,A 80,B 70,C 60'
  && p.patterns.chart.average === 'avg 64' && p.patterns.chart.key.includes('Latest match'), 'Patterns: the chart, its bands, its average and its key', JSON.stringify(p.patterns.chart));
ok(p.patterns.categories.length === 4 && p.patterns.categories.every((c) => c.average && c.label && c.last && c.versus), 'Patterns: the four category averages');
ok(v && v.label === 'Match review' && v.reason === v.stat.label, "the Verdict's label is the page's heading, its reason the standout's line", JSON.stringify([v.label, v.reason]));
const mo = p.moments;
ok(mo && mo.matches.length === 4 && mo.compilation.rows.length >= 3 && /^\d+ deaths, \d+ highlights, 1 clip across 4 matches$/.test(mo.counts),
  'Moments: four matches, the compilation and the counts line', mo && mo.counts);
ok(mo && mo.matches.every((m) => m.moments.length && m.moments.every((x) => x.round && x.kind && x.title)), 'every Moments entry has its round, kind and title');
ok(mo && mo.matches.some((m) => m.moments.some((x) => x.kind === 'Highlight')) && mo.matches.some((m) => m.moments.some((x) => x.clip === 'Play')),
  'Moments: a highlight, and the one clip kept');
ok(mo && mo.matches.some((m) => m.moments.some((x) => x.title === 'Caught alone' && x.line)), "Moments: a death titled by the coach's look");
ok(mo && mo.matches.every((m) => !('when' in m)), 'the Moments matches carry no date');
ok(p.sealed && p.sealed.title === 'Recording' && p.sealed.facts.length === 1, 'the Recording screen, its title and the locked review');
ok(p.sealed.shown.join() === 'Map,Agent,Score,Round' && /Nothing is coached while you play/.test(p.sealed.facts[0].text),
  'the Recording screen shows the four facts and nothing that coaches', JSON.stringify(p.sealed));
ok(p.shell.pages.join() === 'Home,Matches,Patterns,Moments,Stats,Ask Coach' && p.shell.start === 'Start', 'the shell: its pages and Start');
ok(p.shell.foot.join() === 'Profile,Invite,Settings,Report a problem,Discord' && /^You have used your \d free games$/.test(p.shell.games),
  "the account menu's rows and the games line, read off the menu's own view", JSON.stringify([p.shell.foot, p.shell.games]));
const inside = (pt) => pt && pt.x > 0 && pt.x < 1 && pt.y > 0 && pt.y < 1;
ok(p.places && p.shell.pages.every((n) => inside(p.places.tabs[n]) && p.places.tabs[n].y < 64 / 800),
  'where each tab sits on the pictures: in the top bar', JSON.stringify(p.places && p.places.tabs));
ok(p.places && p.places.moments.length === mo.compilation.rows.length && p.places.moments.every((r, i) => r.title === mo.compilation.rows[i].title
  && inside(r.row) && inside(r.action) && r.action.x > r.row.x && r.row.y > 64 / 800), 'where each compilation row and its Play all sit on the picture of Moments');
ok(p.invite && p.invite.progress && p.invite.how.length === 2, 'Invite: the progress line and how it works');

const mark = JSON.parse(read(dirs[0], 'mark.json').toString('utf8'));
ok(mark.path && mark.viewBox === '0 0 120 120' && mark.ground === '#07080C' && mark.ink === '#F5F5F7' && mark.signal === '#E5383B' && mark.label === 'Sample match',
  'mark.json: the crescent, the ground, the ink and the signal', JSON.stringify(mark));

for (const d of dirs) fs.rmSync(d, { recursive: true, force: true });
console.log(`\n${checks - fails} of ${checks} checks passed`);
process.exit(fails ? 1 : 0);
