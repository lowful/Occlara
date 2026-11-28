'use strict';

/**
 * OCCLARA WRAPPED, offline (docs/claude/wrapped.md): the year record and the
 * story's numbers.
 *
 *  1. A row: what rowOf keeps of a real review (the sample library's Abyss
 *     match), and what it never keeps (a Riot ID, a name, a killer that is no
 *     agent the game data knows).
 *  2. The record: a row a save, replaced by id, kept past the library's 300
 *     trim, taken by a removal on purpose, filled once from the library, and
 *     a corrupt year file read from its backup.
 *  3. The story on the sample year (scripts/fixtures/wrapped-sample.js):
 *     every slide's numbers worked out again here, independently.
 *  4. Thin data: each slide left out when its numbers cannot stand.
 *  5. The title: each archetype chosen from numbers that earn it.
 *  6. League kept apart from Valorant.
 *  7. The calendar: 15 December, 31 January, the year's turn, the one time
 *     auto open.
 *  8. The service: nothing mid match, the auto open once, clips only on disk.
 *
 * Plain fs on a temp folder.
 *
 * Run: npm run test:wrapped
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const W = require('../src/shared/wrapped');
const { YearRecord } = require('../src/main/services/year-record');
const { ReviewStore, newId, MAX_REVIEWS } = require('../src/main/services/review-store');
const { createWrapped } = require('../src/main/services/wrapped-service');
const sample = require('./fixtures/wrapped-sample');

let passed = 0;
let failed = 0;
function ok(cond, what, detail) {
  if (cond) { passed++; console.log(`ok    ${what}`); } else { failed++; console.log(`FAIL  ${what}${detail ? ` (${detail})` : ''}`); }
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'occlara-wrapped-'));
let seq = 0;
const fresh = () => { const d = path.join(tmp, `s${++seq}`); fs.mkdirSync(d, { recursive: true }); return d; };
const sum = (xs) => xs.reduce((a, b) => a + b, 0);
const at = (y, m, d, h = 20, mi = 0) => new Date(y, m, d, h, mi).getTime();

// ── 1. A row ────────────────────────────────────────────────────────────────
const base = sample.base();
{
  ok(base && base.game === 'valorant' && base.agent === 'Jett' && base.map === 'Abyss' && base.team === 13 && base.enemy === 11,
    'the real Abyss match is a row: Valorant, Jett, Abyss, 13 : 11', JSON.stringify(base && { a: base.agent, m: base.map }));
  ok(base.k === 31 && base.d === 21 && base.rounds === 24 && base.grade && base.grade.score === 70,
    'its scoreline, rounds and grade as the review has them');
  ok(base.multi[3] === 1 && base.multi[4] === 2 && base.fk === 8 && base.fd === 4,
    'its multi kills and first fights off Riot\'s rounds', JSON.stringify({ m: base.multi, fk: base.fk, fd: base.fd }));
  ok(Object.keys(base.killedBy).every((a) => W.agentOf(a) === a) && sum(Object.values(base.killedBy)) > 0,
    'the killers are agents the game data knows', JSON.stringify(base.killedBy));
  ok(base.minutesBy === 'estimate' && base.minutes === Math.round((24 * 100) / 60), 'with no clock to time it, its minutes are labelled an estimate: 24 rounds at 100 s');
  ok(Array.isArray(base.mistakes) && base.mistakes.some((m) => m.key === 'untraded'), 'its counted mistakes by key');
  ok(base.deathClips.join() === 'r2-clip.mkv,r6-clip.mkv', 'the clips the look named', base.deathClips.join());
  ok(!JSON.stringify(base).includes('#'), 'nothing in it has a "#"');

  const named = W.rowOf('valorant-1790000000000-abcdef', 'valorant', at(2026, 5, 1), {
    game: { agent: 'Ghost#EUW', map: 'Ascent', result: 'Victory', score: '13-5', mode: 'Name#TAG' },
    grade: { score: 80, letter: 'A' },
    rounds: [{ n: 1, died: true, riot: { killer: 'Somebody#1234', feed: [{ by: 'me', w: 'Vandal' }, { by: 'me', w: 'Player#99' }], kills: 1 } },
      { n: 2, died: true, riot: { killer: 'Reyna', kills: 0 } }],
  });
  ok(named && named.agent === null && named.mode === null && !JSON.stringify(named).includes('#'),
    'a Riot ID where an agent or a mode should be is never kept', JSON.stringify(named && { a: named.agent, m: named.mode }));
  ok(named.killedBy.Reyna === 1 && Object.keys(named.killedBy).length === 1 && named.weapons.Vandal === 1 && Object.keys(named.weapons).length === 1,
    'a killer or a weapon that is a name is dropped, an agent and a gun kept', JSON.stringify({ k: named.killedBy, w: named.weapons }));
  ok(W.rowOf('valorant-1790000000000-abcdef', 'valorant', at(2026, 5, 1), { game: { map: 'Haven' } }) === null,
    'a review with no result and no grade (a recording abandoned) is no match to count');
  const riotOnly = W.rowOf('valorant-1790000000001-abcdef', 'valorant', at(2026, 5, 1), { source: 'riot', matchStartedAt: at(2026, 5, 1) - 31 * 60000, game: { result: 'Defeat', score: '9-13' }, insights: { mistakes: [{ key: 'untraded', count: 4 }] } });
  ok(riotOnly.source === 'riot' && riotOnly.mistakes === null && riotOnly.minutes === 31 && riotOnly.minutesBy === 'riot',
    'a match graded from Riot\'s record: no mistakes counted, its minutes from Riot\'s start to its end');
  const lol = W.rowOf('lol-1790000000002-abcdef', 'lol', at(2026, 5, 2), { kind: 'lol', game: { champion: 'Ahri', me: 'Summoner Name', durationSec: 1800, result: 'Victory' }, scoreline: { kills: 5, deaths: 2, assists: 9 } });
  ok(lol.game === 'lol' && lol.champion === 'Ahri' && lol.minutes === 30 && !JSON.stringify(lol).includes('Summoner'),
    'a League row: its champion and length, never the summoner name');
  const imported = W.rowOf('valorant-1790000000003-abcdef', 'valorant', at(2026, 5, 3), { imported: true, game: { result: 'Victory', score: '13-2' } });
  ok(imported.source === 'import', 'an imported recording says so');
  // A CLUTCH NEEDS THE PLAYER ALIVE AT THE END (9.1, insights.js
  // clutchWonAlive): the AI audit's Split round 12, left last against 3,
  // killed, the round won after, is no clutch for the Closer; nor is one
  // whose death is unknown.
  const clutchy = W.rowOf('valorant-1790000000004-abcdef', 'valorant', at(2026, 5, 4), {
    game: { agent: 'Jett', map: 'Split', result: 'Victory', score: '13-9' }, grade: { score: 75 },
    rounds: [{ n: 12, died: true, riot: { kills: 1, clutch: { vs: 3, won: true } } },
      { n: 13, riot: { kills: 0, clutch: { vs: 2, won: true } } },
      { n: 14, died: false, riot: { kills: 1, clutch: { vs: 2, won: true } } }],
  });
  ok(clutchy.clutches === 1 && clutchy.clutchBest === 2 && !clutchy.highlights.some((h) => h.r === 12 || h.r === 13) && clutchy.highlights.some((h) => h.r === 14 && h.cv === 2),
    'a clutch counts only where Riot says the player did not die: one, against 2, never the round won after they fell', JSON.stringify({ c: clutchy.clutches, b: clutchy.clutchBest, h: clutchy.highlights }));
}

// ── 2. The record ───────────────────────────────────────────────────────────
const review = (score, extra) => ({ kind: 'valorant', game: { agent: 'Jett', map: 'Ascent', result: score >= 60 ? 'Victory' : 'Defeat', score: '13-9', mode: 'Competitive' },
  grade: { score, letter: score >= 70 ? 'B' : 'C', provisional: false }, scoreline: { kills: 20, deaths: 15, assists: 4 }, ...(extra || {}) });
{
  const root = fresh();
  const rec = new YearRecord(path.join(root, 'wrapped'));
  const id = newId('valorant', at(2026, 2, 3));
  rec.put(id, 'valorant', at(2026, 2, 3), review(61));
  ok(rec.rows(2026).length === 1 && rec.rows(2026)[0].grade.score === 61, 'a save writes its row');
  rec.put(id, 'valorant', at(2026, 2, 3), review(74, { matchId: '3969f39f-ce92-47b5-bcc3-e3ed182ade69' }), { rank: { tier: 'Gold 2', elo: 1100 } });
  ok(rec.rows(2026).length === 1 && rec.rows(2026)[0].grade.score === 74 && rec.rows(2026)[0].rank.tier === 'Gold 2',
    'saved again (a late link, an upgrade): the same row replaced, never a second');
  rec.put(id, 'valorant', at(2026, 2, 3), review(75));
  ok(rec.rows(2026)[0].rank && rec.rows(2026)[0].rank.tier === 'Gold 2', 'a rank known at an earlier save is kept by a save that has none');
  rec.put(id, 'valorant', at(2026, 2, 3), { kind: 'valorant', game: {} });
  ok(rec.rows(2026).length === 0, 'saved again as nothing to count: its row goes');
  const later = new YearRecord(path.join(root, 'wrapped'));
  rec.put(id, 'valorant', at(2026, 2, 3), review(70));
  ok(new YearRecord(path.join(root, 'wrapped')).rows(2026).length === 1 && later.years().includes(2026), 'kept on disk, read back by a new record');
  // Re-dated into another year: moved, never in both.
  rec.put(id, 'valorant', at(2025, 11, 31, 23, 30), review(70));
  ok(rec.rows(2025).length === 1 && rec.rows(2026).length === 0, 'a review re-dated into another year moves its row');
  const json = fs.readFileSync(path.join(root, 'wrapped', '2025.json'), 'utf8');
  ok(JSON.parse(json).v === W.SCHEMA && JSON.parse(json).year === 2025, 'the file carries its schema and its year');
}
{
  // The library's trim never touches a row; a removal on purpose does.
  const root = fresh();
  const rec = new YearRecord(path.join(root, 'wrapped'));
  const store = new ReviewStore(path.join(root, 'reviews'), { year: rec });
  const ids = [];
  for (let i = 0; i < MAX_REVIEWS + 5; i++) {
    const when = at(2026, 0, 2) + i * 3600000;
    const id = newId('valorant', when);
    ids.push(id);
    store.save({ id, game: 'valorant', at: when, review: review(50 + (i % 40)) });
  }
  ok(store.list().length === MAX_REVIEWS, `the library keeps ${MAX_REVIEWS}`, String(store.list().length));
  ok(rec.rows(2026).length === MAX_REVIEWS + 5, 'the year record keeps all of them: the trim takes no row', String(rec.rows(2026).length));
  ok(!store.get(ids[0]) && rec.rows(2026).some((r) => r.id === ids[0]), 'January\'s first match is gone from the library and still in the year');
  store.remove(ids[ids.length - 1]);
  ok(!rec.rows(2026).some((r) => r.id === ids[ids.length - 1]) && rec.rows(2026).length === MAX_REVIEWS + 4,
    'a review removed on purpose (a deleted import, a resumed match) takes its row');
  store.remove(ids[1], true);
  ok(rec.rows(2026).some((r) => r.id === ids[1]), 'a removal without its index (the retired games\' sweep) leaves a row alone');
}
{
  // The one time fill.
  const root = fresh();
  const store = new ReviewStore(path.join(root, 'reviews'));
  for (let i = 0; i < 7; i++) { const when = at(2026, 3, 1 + i); store.save({ id: newId('valorant', when), game: 'valorant', at: when, review: review(60 + i) }); }
  store.save({ id: newId('valorant', at(2026, 3, 20)), game: 'valorant', at: at(2026, 3, 20), review: { game: { map: 'Bind' } } });
  const rec = new YearRecord(path.join(root, 'wrapped'));
  ok(!rec.backfilled(), 'a new record has not been filled');
  const n = rec.backfill(store);
  ok(n === 7 && rec.rows(2026).length === 7 && rec.backfilled(), 'filled once from the library: every match to count, none of the abandoned', String(n));
  ok(rec.backfill(store) === 0, 'and never again');
  // The store wired after it: new saves land beside the filled rows.
  const wired = new ReviewStore(path.join(root, 'reviews'), { year: rec });
  wired.save({ id: newId('valorant', at(2026, 3, 25)), game: 'valorant', at: at(2026, 3, 25), review: review(80) });
  ok(rec.rows(2026).length === 8, 'and every save after it adds its row');
}
{
  // A corrupt year file never loses the year.
  const root = fresh();
  const dir = path.join(root, 'wrapped');
  const rec = new YearRecord(dir);
  for (let i = 0; i < 4; i++) rec.put(newId('valorant', at(2026, 4, 1 + i)), 'valorant', at(2026, 4, 1 + i), review(60 + i));
  const file = path.join(dir, '2026.json');
  ok(fs.existsSync(`${file}.bak`), 'a write keeps the copy it replaces');
  fs.writeFileSync(file, '{"v":1,"year":2026,"rows":{"valorant-17');
  const back = new YearRecord(dir);
  const rows = back.rows(2026);
  ok(rows.length === 3, 'a year file cut short is read from its backup (the copy before the last write)', String(rows.length));
  ok(fs.readdirSync(dir).some((f) => f.startsWith('2026.json.corrupt-')), 'the unreadable file is put aside for a look, never deleted');
  ok(JSON.parse(fs.readFileSync(file, 'utf8')).rows && new YearRecord(dir).rows(2026).length === 3, 'and the year is written back whole');
  fs.writeFileSync(file, 'garbage');
  fs.writeFileSync(`${file}.bak`, 'garbage too');
  let threw = false;
  let none = null;
  try { none = new YearRecord(dir).rows(2026); } catch { threw = true; }
  ok(!threw && Array.isArray(none) && none.length === 0, 'both unreadable: an empty year, never a throw');
  fs.writeFileSync(file, JSON.stringify({ v: 99, year: 2026, rows: { x: { id: 'x' } } }));
  const newer = new YearRecord(dir);
  newer.put(newId('valorant', at(2026, 4, 9)), 'valorant', at(2026, 4, 9), review(70));
  ok(JSON.parse(fs.readFileSync(file, 'utf8')).v === 99, 'a file of a newer schema is never written over by this one');
  const tolerant = new YearRecord(path.join(fresh(), 'w'));
  fs.mkdirSync(tolerant.root, { recursive: true });
  fs.writeFileSync(tolerant.file(2026), JSON.stringify({ v: 1, year: 2026, rows: { a: { id: 'a', at: 'soon', game: 'valorant' }, b: { id: 'b', at: at(2026, 1, 1), game: 'rivals' }, c: { id: 'c', at: at(2026, 1, 1), game: 'valorant' } } }));
  ok(tolerant.rows(2026).map((r) => r.id).join() === 'c', 'read tolerantly: a row of a shape it never writes is dropped');
}

{
  // A FILE HELD BY A SCANNER IS NOT CORRUPT (review 2, finding 1): EBUSY,
  // EPERM, EACCES on a read never set the file aside, never write the backup
  // back over it, and a save made meanwhile waits for the next good read.
  const dir = path.join(fresh(), 'wrapped');
  const rec = new YearRecord(dir);
  for (let i = 0; i < 3; i++) rec.put(newId('valorant', at(2026, 3, 1 + i)), 'valorant', at(2026, 3, 1 + i), review(60 + i));
  const file = path.join(dir, '2026.json');
  const real = fs.readFileSync;
  for (const code of ['EBUSY', 'EPERM', 'EACCES']) {
    let held = Infinity;   // the main file refuses every read until let go
    fs.readFileSync = function (f, ...a) {
      if (held > 0 && String(f) === file) { held -= 1; const e = new Error(`${code}: held`); e.code = code; throw e; }
      return real.call(fs, f, ...a);
    };
    const back = new YearRecord(dir);
    const served = back.rows(2026).length;
    const extraId = newId('valorant', at(2026, 3, 20 + ['EBUSY', 'EPERM', 'EACCES'].indexOf(code)));
    back.put(extraId, 'valorant', at(2026, 3, 20), review(70));
    const before = JSON.parse(real.call(fs, file, 'utf8'));
    ok(served >= 2 && !fs.readdirSync(dir).some((f) => f.includes('.corrupt-')), `${code}: what can be read is served, and nothing is set aside`, `${served}`);
    ok(!before.rows[extraId], `${code}: nothing is written over the held file`);
    held = 0;
    fs.readFileSync = real;
    const after = back.rows(2026);
    const disk = JSON.parse(real.call(fs, file, 'utf8'));
    ok(after.some((r) => r.id === extraId) && Object.keys(disk.rows).length === after.length && after.length >= 4,
      `${code}: read at last, the file keeps every row and the save that waited lands`, `${after.length} rows, ${Object.keys(disk.rows).length} on disk`);
  }
  fs.readFileSync = real;
}
{
  // A CORRUPT FILE: every whole row still in it is salvaged, never only the backup's.
  const dir = path.join(fresh(), 'wrapped');
  const rec = new YearRecord(dir);
  const ids = [];
  for (let i = 0; i < 5; i++) { const id = newId('valorant', at(2026, 6, 1 + i)); ids.push(id); rec.put(id, 'valorant', at(2026, 6, 1 + i), review(60 + i)); }
  const file = path.join(dir, '2026.json');
  const whole = fs.readFileSync(file, 'utf8');
  fs.writeFileSync(file, whole.slice(0, whole.lastIndexOf(ids[4]) + 30));   // cut inside the fifth row
  const back = new YearRecord(dir);
  const got = back.rows(2026).map((r) => r.id);
  ok(ids.slice(0, 4).every((id) => got.includes(id)), 'a file cut inside its last row keeps the four whole rows before it (salvaged, not only the backup)', got.length);
  ok(fs.readdirSync(dir).some((f) => f.startsWith('2026.json.corrupt-')), 'and the cut file is set aside for a look');
}
{
  // A ROW BELONGS TO THE FILE IT IS IN (finding 2): a match at 00:30 on
  // 1 January saved in one time zone is 31 December in another; read there,
  // it is kept, saved over, and never dropped.
  const dir = path.join(fresh(), 'wrapped');
  fs.mkdirSync(dir, { recursive: true });
  const cross = W.rowOf('valorant-1798700000000-tzzz01', 'valorant', at(2026, 11, 31, 22, 30), review(72));
  fs.writeFileSync(path.join(dir, '2027.json'), JSON.stringify({ v: 1, year: 2027, rows: { [cross.id]: cross } }));
  const rec = new YearRecord(dir);
  ok(rec.rows(2027).length === 1, 'a row whose date reads as another year here is kept in the file it is in');
  rec.put(newId('valorant', at(2027, 0, 9)), 'valorant', at(2027, 0, 9), review(70));
  rec.put(newId('valorant', at(2027, 0, 10)), 'valorant', at(2027, 0, 10), review(71));
  ok(Object.keys(JSON.parse(fs.readFileSync(path.join(dir, '2027.json'), 'utf8')).rows).includes(cross.id), 'and two saves later it is still on disk');
  rec.put(cross.id, 'valorant', cross.at, review(73));
  ok(rec.yearOf(cross.id) === 2027 && rec.rows(2026).length === 0, 'the same match saved again stays where it is');
  ok(W.story(rec.rows(), { year: 2026 }).counts.valorant === 1, 'and the story places it by the reader\'s own calendar');
}

// ── 3. The story on the sample year ─────────────────────────────────────────
const rows = sample.rows();
const YEAR = 2026;
const vRows = rows.filter((r) => r.game === 'valorant');
const lRows = rows.filter((r) => r.game === 'lol');
const st = W.story(rows, { year: YEAR, has: () => true, extras: { trainer: 41, drills: 12 } });
const slide = (k) => st.slides.find((s) => s.kind === k);
{
  ok(st.enough && st.slides.map((s) => s.kind).join() === 'open,time,mains,grades,best,highlights,mistakes,fights,title,rank,lol,summary',
    'the sample year tells every slide, Valorant first and League its own', st.slides.map((s) => s.kind).join());
  const t = slide('time');
  ok(t.matches === vRows.length && t.minutes === sum(vRows.map((r) => r.minutes)), 'time: the matches and the minutes, summed', `${t.matches} ${t.minutes}`);
  ok(t.hours === Math.round(t.minutes / 60), 'and the hours from them');
  const days = new Set(vRows.map((r) => new Date(r.at).toDateString())).size;
  ok(t.days === days, 'the days played, by the local date', `${t.days} vs ${days}`);
  const months = Array.from({ length: 12 }, (_, m) => vRows.filter((r) => new Date(r.at).getMonth() === m).length);
  ok(JSON.stringify(t.months) === JSON.stringify(months) && t.busiestMonth.matches === Math.max(...months), 'the months and the busiest');
  const agents = {};
  for (const r of vRows) agents[r.agent] = (agents[r.agent] || 0) + 1;
  const main = Object.entries(agents).sort((a, b) => b[1] - a[1])[0];
  const m = slide('mains');
  ok(m.agent.name === main[0] && m.agent.matches === main[1], 'the main agent by matches', `${m.agent.name} ${m.agent.matches}`);
  ok(!JSON.stringify(m).includes('Ahri') && m.totalMatches === vRows.length, 'Valorant\'s mains count no League game');
  const graded = vRows.filter((r) => r.grade && !r.grade.provisional).sort((a, b) => a.at - b.at);
  const third = Math.floor(graded.length / 3);
  const avg = (xs) => Math.round(sum(xs) / xs.length);
  const g = slide('grades');
  ok(g.count === graded.length && g.climb.from === avg(graded.slice(0, third).map((r) => r.grade.score)) && g.climb.to === avg(graded.slice(-third).map((r) => r.grade.score)),
    'the climb: the first third of the counted grades against the last third', JSON.stringify(g.climb));
  ok(g.climb.by > 0, 'the sample\'s grade rises over the year');
  const best = graded.slice().sort((a, b) => b.grade.score - a.grade.score || b.at - a.at)[0];
  ok(slide('best').id === best.id && slide('best').grade.score === best.grade.score, 'the match of the year: the highest counted grade, never a provisional one');
  const h = slide('highlights');
  ok(h.threeK === sum(vRows.map((r) => r.multi[3])) && h.aces === sum(vRows.map((r) => r.multi[5])) && h.clutches === sum(vRows.map((r) => r.clutches)),
    'highlights: the 3Ks, the aces and the clutches won, summed');
  ok(h.clip && /^h\d+-clip\.mkv$/.test(h.clip.clip), 'and the clip to play: a highlight clip');
  const mi = slide('mistakes');
  ok(mi.beaten && mi.beaten.key === 'untraded' && mi.beaten.early > mi.beaten.late, 'the mistake beaten: untraded deaths, falling over the sample year', JSON.stringify(mi.beaten));
  ok(mi.still && mi.still.key === 'early', 'still to beat: dying early, steady all year', JSON.stringify(mi.still));
  // The sample year saved it as "Died where nobody could trade"; the page says today's title (9.1, mistake-titles.js).
  ok(mi.beaten.title === 'Deaths nobody traded', 'under today\'s title, from a year record saved under the old one');
  const f = slide('fights');
  const guns = {};
  for (const r of vRows) for (const [w, n] of Object.entries(r.weapons)) guns[w] = (guns[w] || 0) + n;
  ok(f.gun.name === Object.entries(guns).sort((a, b) => b[1] - a[1])[0][0], 'the favourite gun by kills', f.gun.name);
  ok(f.nemesis && W.agentOf(f.nemesis.agent) === f.nemesis.agent, 'the agent that got the player most: an agent, never a name');
  let run = 0; let longest = 0;
  for (const r of vRows.slice().sort((a, b) => a.at - b.at)) { run = r.result === 'win' ? run + 1 : 0; longest = Math.max(longest, run); }
  ok(f.streak === longest, 'the longest run of wins', `${f.streak} vs ${longest}`);
  ok(W.TITLES.includes(slide('title').id) && slide('title').facts.length === 2, 'a title, with the two numbers that earned it', slide('title').id);
  const r = slide('rank');
  ok(r.first === vRows.filter((x) => x.rank)[0].rank.tier && r.last === vRows.filter((x) => x.rank).slice(-1)[0].rank.tier, 'the rank journey from the first tier known to the last');
  const s = slide('summary');
  ok(s.figures.length <= 6 && s.figures[0].n === vRows.length && s.title && s.title.name, 'the closing card: the title and up to six figures');
  ok(!JSON.stringify(st).includes('#'), 'nothing in the whole story has a "#"');
  const again = W.story(sample.rows(), { year: YEAR, has: () => true, extras: { trainer: 41, drills: 12 } });
  ok(JSON.stringify(again) === JSON.stringify(st), 'the same rows tell the same story, every time');
  const noClips = W.story(rows, { year: YEAR, has: () => false });
  ok(noClips.slides.find((x) => x.kind === 'highlights').clip === null && noClips.slides.find((x) => x.kind === 'best').clip === null,
    'a clip no longer on disk (the cap, Clear clips) is no clip at all');
}

// ── 4. Thin data ────────────────────────────────────────────────────────────
{
  const few = vRows.slice(0, 4);
  const thin = W.story(few, { year: YEAR });
  ok(!thin.enough && thin.slides.length === 0, `under ${W.MIN_MATCHES} matches there is no story`);
  const e = W.entryOf({ now: at(YEAR, 11, 20), rows: few });
  ok(e && !e.enough && !e.button && /needs 5 reviewed matches/.test(e.line) && /You have 4/.test(e.line), 'and the entry says plainly there is not enough yet', e && e.line);
  const ungraded = vRows.slice(0, 8).map((x) => ({ ...x, grade: null, rank: undefined, mistakes: null, multi: { 2: 0, 3: 0, 4: 0, 5: 0 }, clutches: 0, highlights: [], weapons: {}, killedBy: {}, riotRounds: 0, result: x.result }));
  const st2 = W.story(ungraded, { year: YEAR });
  const kinds = st2.slides.map((x) => x.kind);
  ok(st2.enough && !kinds.includes('grades') && !kinds.includes('best') && !kinds.includes('highlights') && !kinds.includes('mistakes') && !kinds.includes('rank'),
    'no grades, no clips, no Riot rounds: the grade journey, the match of the year, highlights, mistakes and rank are left out', kinds.join());
  ok(kinds.includes('open') && kinds.includes('time') && kinds.includes('title') && kinds.includes('summary'), 'and what can be told still is');
  const nine = vRows.filter((x) => Array.isArray(x.mistakes)).slice(0, 9);
  ok(W.mistakesOf(nine) === null, `the mistake slide needs ${W.MIN_RECORDED} recorded matches`);
  const g11 = vRows.filter((x) => x.grade && !x.grade.provisional).slice(0, 11);
  const gs = W.gradesOf(g11);
  ok(gs && gs.climb === null && gs.small, 'eleven graded matches: no climb claimed, and the sample called small');
  ok(W.rankJourneyOf([{ ...vRows[0], rank: { tier: 'Gold 1' } }]) === null, 'a rank known for one match is no journey');
  ok(W.gradesOf(vRows.slice(0, 4)) === null, `the grade journey needs ${W.MIN_GRADED} counted grades`);
}

// ── 5. The title ────────────────────────────────────────────────────────────
{
  const time = { matches: 40, days: 20, hours: 20, estimated: 0 };
  const v = (over) => ({ time, agents: [{ name: 'Jett', matches: 14 }, { name: 'Raze', matches: 10 }], fights: null, grades: null, highlights: null, kd: null, winRate: 50, ...over });
  ok(W.titleOf(v({})).id === 'student', 'nothing stands out: the Student, who reviewed their matches');
  ok(W.titleOf(v({ fights: { first: { fk: 90, fd: 40, rounds: 500, fkRate: 18, fdRate: 8.5 } } })).id === 'entry', 'many first kills, more than first deaths: the Entry');
  ok(W.titleOf(v({ highlights: { clutches: 14, clutchBest: 3 } })).id === 'clutch', 'a clutch won in a third of matches: the Closer');
  ok(W.titleOf(v({ grades: { climb: { from: 58, to: 70, by: 12 } } })).id === 'climber', 'the grade up 12: the Climber');
  ok(W.titleOf(v({ agents: [{ name: 'Sova', matches: 32 }] })).id === 'specialist', 'one agent in 80% of matches: the Specialist');
  ok(W.titleOf(v({ kd: { kd: 1.5, kills: 900, matches: 40 } })).id === 'fragger', 'a K/D of 1.5: the Fragger');
  ok(W.titleOf(v({ fights: { first: { fk: 30, fd: 20, rounds: 500, fkRate: 6, fdRate: 4 } } })).id === 'anchor', 'first to die in 4% of rounds: the Anchor');
  ok(W.titleOf(v({ agents: ['A', 'B', 'C', 'D', 'E', 'F', 'G'].map((n) => ({ name: n, matches: 6 })) })).id === 'flex', 'seven agents, none over a third: the Flex');
  ok(W.titleOf(v({ time: { matches: 120, days: 70, hours: 60, estimated: 0 } })).id === 'grinder', '120 matches on 70 days: the Grinder');
  const both = v({ grades: { climb: { from: 50, to: 62, by: 12 } }, kd: { kd: 3.0, kills: 900, matches: 40 } });
  ok(W.titleOf(both).id === 'fragger', 'two earned: the one furthest past its own bar wins (a K/D of 3.0 is 2.5 times its bar, a climb of 12 twice its)');
  const tie = v({ grades: { climb: { from: 50, to: 62, by: 12 } }, kd: { kd: 2.4, kills: 900, matches: 40 } });
  ok(W.titleOf(tie).id === 'climber', 'level (both twice their bar): the order of the list decides, the Climber before the Fragger');
  ok(JSON.stringify(W.titleOf(tie)) === JSON.stringify(W.titleOf(v({ grades: { climb: { from: 50, to: 62, by: 12 } }, kd: { kd: 2.4, kills: 900, matches: 40 } }))), 'and the same numbers always give the same title');
  ok(W.titleOf(v({ fights: { first: { fk: 90, fd: 40, rounds: 500, fkRate: 18, fdRate: 8.5 } } })).facts.map((x) => x.n).join() === '90,18%', 'its two numbers are the ones that earned it');
}

// ── 6. League kept apart ────────────────────────────────────────────────────
{
  const onlyLol = W.story(lRows, { year: YEAR });
  ok(onlyLol.enough && onlyLol.valorant === null && onlyLol.slides.map((s) => s.kind).join() === 'open,lol,summary',
    'a League only year: its opening, League\'s own slide and the card, no Valorant slide', onlyLol.slides.map((s) => s.kind).join());
  ok(onlyLol.slides[0].game === 'lol' && onlyLol.slides[0].champion === 'Ahri', 'opened on League\'s champion, never an agent');
  ok(onlyLol.slides.find((s) => s.kind === 'summary').figures.every((f) => !/agent/.test(f.label)), 'and its card names no Valorant figure');
  const fewLol = W.story([...vRows, ...lRows.slice(0, 3)], { year: YEAR });
  ok(!fewLol.slides.some((s) => s.kind === 'lol') && fewLol.valorant.time.matches === vRows.length,
    'three League games: no League slide, and not one of them counted in Valorant\'s numbers');
  const lol = slide('lol');
  ok(lol.time.matches === lRows.length && lol.champion.name === 'Ahri', 'League\'s slide counts League alone', `${lol.time.matches}`);
}

// ── 7. The calendar ─────────────────────────────────────────────────────────
{
  ok(W.yearOpenAt(at(2026, 11, 14, 23, 59)) === null, '14 December 23:59: not yet');
  ok(W.yearOpenAt(at(2026, 11, 15, 0, 0)) === 2026, '15 December 00:00: 2026\'s Wrapped is offered');
  ok(W.yearOpenAt(at(2026, 11, 31, 23, 59)) === 2026, '31 December 23:59: still 2026');
  ok(W.yearOpenAt(at(2027, 0, 1, 0, 0)) === 2026, '1 January 00:00: still 2026, across the year\'s turn');
  ok(W.yearOpenAt(at(2027, 0, 31, 23, 59)) === 2026, '31 January 23:59: the last minute of it');
  ok(W.yearOpenAt(at(2027, 1, 1, 0, 0)) === null, '1 February 00:00: over');
  ok(W.yearOpenAt(at(2026, 10, 25)) === null && W.latestYear(at(2026, 10, 25)) === 2025, 'today, 25 November: no window, and the latest year is 2025');
  const turn = [
    ...vRows.slice(0, 6).map((r, i) => ({ ...r, id: `valorant-${at(2026, 11, 31, 23, 30) + i}-yyyy${i}`, at: at(2026, 11, 31, 23, 30) + i })),
    { ...vRows[6], id: `valorant-${at(2027, 0, 1, 0, 10)}-zzzz1`, at: at(2027, 0, 1, 0, 10) },
  ];
  ok(W.story(turn, { year: 2026 }).valorant.time.matches === 6 && W.story(turn, { year: 2027 }).counts.valorant === 1,
    'a match at 23:30 on 31 December is 2026\'s, one at 00:10 on 1 January is 2027\'s');
  ok(W.entryOf({ now: at(2026, 10, 25), rows: vRows }) === null, 'out of the window with no year behind it: nothing to say');
  const after = W.entryOf({ now: at(2027, 2, 3), rows: vRows });
  ok(after && !after.open && after.enough && after.button === 'Play 2026 again', 'after the window: 2026 stays reachable (Profile)', after && after.button);
  const within = W.entryOf({ now: at(2026, 11, 20), rows: vRows });
  ok(within.open && within.button === 'Play your 2026 Wrapped' && /ready/.test(within.line), 'in the window: the invitation', within.line);
  const opened = {};
  ok(W.autoOpenYear({ now: at(2026, 11, 15, 9), rows: vRows, opened, free: true }) === 2026, 'in the window with enough: it opens by itself');
  opened[2026] = at(2026, 11, 15, 9);
  ok(W.autoOpenYear({ now: at(2026, 11, 28), rows: vRows, opened, free: true }) === null, 'once, never again that year');
  ok(W.autoOpenYear({ now: at(2026, 11, 15, 9), rows: vRows, opened: {}, free: false }) === null, 'not while main says the window may not show it (a match, the seal, onboarding, the tray)');
  ok(W.autoOpenYear({ now: at(2026, 11, 15, 9), rows: vRows.slice(0, 4), opened: {}, free: true }) === null, 'not with too few matches');
  ok(W.autoOpenYear({ now: at(2026, 10, 25), rows: vRows, opened: {}, free: true }) === null, 'not outside the window');
  ok(W.autoOpenYear({ now: at(2027, 0, 10), rows: vRows, opened: {}, free: true }) === 2026, 'first shown on 10 January: still once for 2026');
}

{
  // Outside the window only a year that was offered (finding 4).
  const shift = (r, y) => { const d = new Date(r.at); d.setFullYear(y); return { ...r, at: d.getTime() }; };
  const y25 = vRows.slice(0, 6).map((r) => shift(r, 2025));
  ok(W.entryOf({ now: at(2026, 10, 25), rows: y25 }) === null, 'today, six 2025 reviews left by the cap: no "Play 2025 again" for a year never offered');
  const opened25 = W.entryOf({ now: at(2026, 10, 25), rows: y25, opened: { 2025: at(2026, 0, 3) } });
  ok(opened25 && opened25.button === 'Play 2025 again', 'a year the player had open is offered again');
  ok(W.entryOf({ now: at(2027, 2, 3), rows: vRows }).button === 'Play 2026 again', '2026 on is offered after its window');
}

// ── Copy, numbers and privacy (findings 9, 10) ─────────────────────────────
{
  const plain = vRows.slice(0, 5).map((r) => ({ ...r, minutes: null }));
  const st0 = W.story(plain, { year: YEAR });
  const title = st0.slides.find((s) => s.kind === 'title');
  const sum0 = st0.slides.find((s) => s.kind === 'summary');
  ok(!JSON.stringify(title.facts).includes('hours') && !sum0.figures.some((f) => /hours/.test(f.label)), 'five matches with no minutes: no "0 hours" on the title or the card', JSON.stringify(sum0.figures));
  ok(sum0.figures.every((f) => f.n !== 0), 'and no figure of 0 on the card');
  const mk = (i, has) => ({ id: `valorant-${1780000000000 + i}-abcd${i}`, game: 'valorant', at: new Date(2026, 1, 1 + i).getTime(), mistakes: has ? [{ key: 'early', n: 1, title: 'Dying in the first 30 seconds' }] : [] });
  const ten = [...[1, 1, 1, 0, 0].map((h, i) => mk(i, h)), ...[1, 1, 0, 0, 0].map((h, i) => mk(i + 5, h))];
  const m = W.mistakesOf(ten);
  ok(m && m.beaten && m.beaten.key === 'early', '3 of 5 down to 2 of 5 is a drop of 20 points, counted in whole matches', JSON.stringify(m && m.beaten));
  const page = fs.readFileSync(path.join(__dirname, '..', 'src/renderer/wrapped/wrapped.js'), 'utf8');
  ok(/'3K round' : '3K rounds'/.test(page) && /'4K round' : '4K rounds'/.test(page) && /'big round' : 'big rounds'/.test(page), 'one 3K, one 4K, one big round: said in the singular');
  const card = fs.readFileSync(path.join(__dirname, '..', 'src/renderer/wrapped/card.js'), 'utf8');
  const used = new Set([...card.matchAll(/ctx\.font = `(\d{3}) \d+px \$\{(SANS|MONO)\}`/g)].map((x) => `${x[1]} ${x[2]}`));
  const loaded = new Set([...card.matchAll(/`(\d{3}) \d+px \$\{(SANS|MONO)\}`/g)].filter((x) => card.indexOf(x[0]) < card.indexOf('function loadImg')).map((x) => `${x[1]} ${x[2]}`));
  ok(used.size >= 4 && [...used].every((w) => loaded.has(w)), 'the card loads every face it draws in before it draws', `${[...used].join(', ')} | ${[...loaded].join(', ')}`);
  const named = W.rowOf('valorant-1790000000009-abcdef', 'valorant', at(2026, 5, 1), {
    game: { agent: 'Jett', result: 'Victory', score: '13-5' }, grade: { score: 80 },
    insights: { mistakes: [{ key: 'same-killer', count: 3, title: 'xXFreeTextXx kept winning' }, { key: 'same-spot', count: 2, title: 'Dying at whatever they typed' }, { key: 'untraded', count: 4, title: 'Died where nobody could trade' }] },
  });
  ok(!JSON.stringify(named).includes('FreeText') && !JSON.stringify(named).includes('typed'), 'a title built from the match (same-killer, same-spot) is never kept, only its key and count');
  ok(named.mistakes.find((x) => x.key === 'untraded').title === 'Died where nobody could trade', 'a fixed title is');
  ok(W.mistakesOf([...Array(10)].map((_, i) => ({ id: `valorant-${1780000000000 + i}-kkkk${i}`, game: 'valorant', at: at(2026, 1, 1 + i), mistakes: i < 5 ? [{ key: 'same-killer', n: 3 }] : [] }))).beaten.title === 'One enemy agent kept winning',
    'and the page names it by its general title');
}

// ── When it may open by itself (finding 6, index.js free) ──────────────────
{
  const { mayOpenNow } = require('../src/main/services/wrapped-service');
  const good = { surfacesUp: true, onboarded: true, visible: true, minimized: false, focused: true, match: false, sealed: false, shown: 'home', onScreen: 'home', coming: false, toast: false, menu: false, wrapped: false };
  ok(mayOpenNow(good), 'Home settled on screen, the window in front, nothing over it: it may open');
  for (const [what, over] of [['a review on screen', { shown: 'review', onScreen: 'review' }], ['the Trainer', { shown: 'trainer', onScreen: 'trainer' }],
    ['Moments', { shown: 'moments', onScreen: 'moments' }], ['Settings', { shown: 'settings', onScreen: 'settings' }], ['Profile back from a checkout', { shown: 'profile', onScreen: 'profile' }],
    ['Home still on its way', { onScreen: 'matches', coming: true }], ['onboarding not done', { onboarded: false }], ['the app not up', { surfacesUp: false }],
    ['the window not focused', { focused: false }], ['hidden', { visible: false }], ['minimised', { minimized: true }], ['a match on', { match: true }],
    ['sealed (a stop held)', { sealed: true }], ['a games reveal up', { toast: true }], ['the account menu open', { menu: true }], ['Wrapped already up', { wrapped: true }],
    // 9.1: recording holds every animation still (html.rec-still), the story too.
    ['recording on between matches, Home on screen', { recording: true }]]) {
    ok(!mayOpenNow({ ...good, ...over }), `not with ${what}`);
  }
  const idx = fs.readFileSync(path.join(__dirname, '..', 'src/main/index.js'), 'utf8');
  ok(/sealed: windowSealed\(\), recording: !!state\.isCoaching,/.test(idx) && /if \(!still\) \{ try \{ wrappedSoon\(\);/.test(idx),
    'main hands it the recording, and asks again the moment recording stops');
}

// ── The ground steps down only when the GPU cannot keep up (finding 7) ──────
{
  const { tooSlow } = require('../src/renderer/wrapped/gl.js');
  const steady = (ms) => Array.from({ length: 300 }, () => ms);
  ok(!tooSlow(20, steady(20), 50), 'a 50 Hz panel running every frame on time: no step down');
  ok(!tooSlow(20.8, steady(20.8), 48), 'a 48 Hz panel: none');
  ok(!tooSlow(33.3, steady(33.3), 60), 'Chromium\'s 30 frames a second on battery: none');
  ok(!tooSlow(33.3, steady(33.3), null), 'and with the panel unknown: none');
  ok(!tooSlow(4.17, steady(4.17), 240), 'a 240 Hz panel on time: none');
  const jank = [...steady(4.17).slice(0, 200), ...Array.from({ length: 100 }, (_, i) => (i % 3 ? 4.17 : 30))];
  ok(tooSlow(12.4, jank, 240), 'frames being dropped against its own cadence: step down');
  ok(tooSlow(45, steady(45), 60), 'a steady 22 frames a second on a 60 Hz panel: step down');
}

// ── 8. The service ──────────────────────────────────────────────────────────
{
  const kept = new Map();
  let busy = false;
  let free = true;
  let shown = 0;
  const now = { t: at(2026, 11, 16, 20) };
  const svc = createWrapped({
    year: { rows: () => rows },
    store: { get: (k) => kept.get(k), set: (k, v) => kept.set(k, v) },
    now: () => now.t,
    busy: () => busy,
    free: () => free,
    hasClip: (id, name) => name === 'h1-clip.mkv' || name === 'h2-clip.mkv',
    clipUrl: (id, name) => `occlara-clip://review/${id}/${name}`,
    extras: () => ({ trainer: 3, drills: 1 }),
    sounds: () => true,
    show: () => { shown += 1; return true; },
  });
  const g = svc.get();
  ok(g && g.year === 2026 && g.story.enough && g.sounds === true, 'the page is handed the year\'s story');
  const clips = g.story.slides.filter((s) => s.clip).map((s) => s.clip);
  ok(clips.every((c) => /^h[12]-clip\.mkv$/.test(c.clip) && c.url === `occlara-clip://review/${c.id}/${c.clip}`), 'every clip handed over is on disk, with main\'s URL', JSON.stringify(clips.map((c) => c.clip)));
  busy = true;
  ok(svc.get() === null && svc.entry() === null && svc.open().ok === false && svc.open().error === 'match' && svc.maybeAuto() === null,
    'mid match or sealed: no story, no entry, nothing opens');
  busy = false;
  free = false;
  ok(svc.maybeAuto() === null && shown === 0, 'shown with something in the way (a review, the tray, onboarding): no auto open, nothing kept');
  free = true;
  ok(svc.maybeAuto() === 2026 && shown === 1 && kept.get(svc.KEY)[2026] === now.t, 'the first time it may: it opens by itself, and the year is kept');
  now.t += 86400000;
  ok(svc.maybeAuto() === null && shown === 1, 'the next day: never again by itself');
  ok(svc.open(2026).ok && shown === 2, 'opened by the player as often as they like');
  ok(svc.open(2024).ok === false && svc.open(2024).error === 'thin', 'a year without enough matches does not open');
}

fs.rmSync(tmp, { recursive: true, force: true });
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
