'use strict';

/**
 * PRACTICE (docs/claude/ui.md, "The Practice page"): the plan from the
 * player's own repeated mistakes and everything around it, offline.
 *
 *   the library   read in either shape, a malformed drill dropped, the
 *                 economy left out, the house's dashes taken out; the real
 *                 src/shared/drill-library.json read whole when it is there
 *   the plan      the two most serious repeated mistakes with drills, at the
 *                 player's band; no churn when the list reorders; a focus
 *                 replaced once its mistake leaves the list; a drill
 *                 finished after FINISH marks and the next one in its place;
 *                 general drills with no repeated mistakes or no matches
 *   is it working the counts and their words at each threshold
 *   the store     a missing, malformed or future value read as nothing
 *                 saved, never a throw; quiet mid match
 *   Home's line   only with a plan, never mid match or for League, gone once
 *                 a drill is marked today and back the next day
 *   the page      its dom hooks, its plan, its League panel, a mark and a
 *                 removal through its bridge, nothing painted mid match
 *   the review    its Practise this link, opening the page on that mistake
 *   own clip      (8.11) the newest kept clip of each mistake, the Moments
 *                 page's join over a real review store in a temp folder: the
 *                 newest match and its latest round win, a clip gone from
 *                 disk is passed over, a sat out round and a Riot only match
 *                 are not moments, no clip is no tile, Watch the round plays
 *                 it in the clip player, and a repaint keeps it open
 *   demos         (8.11) a drill's demo kept only under occlara.app/drills/,
 *                 its card unchanged until the poster is in and after any
 *                 failure, a hover preview, a click under reduced motion
 *
 * Run: npm run test:practice
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const P = require('../src/shared/practice');
const patternsOf = require('../src/shared/patterns');
const nav = require('../src/shared/shell-nav');
const C = require('../src/shared/channels');
const { createPractice } = require('../src/main/services/practice-store');
const { ReviewStore, newId } = require('../src/main/services/review-store');
const clipScheme = require('../src/main/services/clip-scheme');
const { loadSurface, settle } = require('./fixtures/fake-dom');

let fails = 0;
let checks = 0;
const ok = (cond, what, detail) => {
  checks++;
  if (!cond) { fails++; console.log(`FAIL  ${what}${detail ? `\n        ${detail}` : ''}`); } else console.log(`ok    ${what}`);
};
const DASHES = new RegExp('[' + String.fromCharCode(0x2013, 0x2014) + ']');
const ROOT = path.join(__dirname, '..');
const FIXTURE = path.join(__dirname, 'fixtures', 'drills-sample.json');
const fixture = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));
const lib = P.normaliseLibrary(fixture);

// Noon on fixed days, so no day boundary moves under a test.
const day = (n) => new Date(2026, 10, 10 + n, 12, 0, 0).getTime();
const HOUR = 3600000;

// ── The library ───────────────────────────────────────────────────────────
ok(lib && lib.drills.length === fixture.drills.length, `the sample library reads whole (${lib && lib.drills.length} drills)`);
{
  const raw = [
    { id: 'a', title: 'A drill', cause: 'cause:repeek', steps: ['one', 'two'], where: 'Practice Range', minutes: '12', bands: ['silver_gold', 'gold'] },
    { id: 'b', name: 'Named', causes: ['untraded', 'first-death'], steps: 'just one', mode: 'dm', duration: 8 },
    { id: 'c', title: 'Save for the next round', cause: 'general', steps: ['Count your credits before the buy.'] },
    { id: 'd', title: 'No steps', cause: 'general', steps: [] },
    { title: 'No id', cause: 'general', steps: ['x'] },
    { id: 'a', title: 'Same id again', cause: 'general', steps: ['x'] },
    { id: 'e', title: 'A' + String.fromCharCode(0x2014) + 'dash', cause: 'general', steps: ['Walk' + String.fromCharCode(0x2013) + 'then stop'], where: 'unrated' },
    'not a drill', null,
  ];
  const l = P.normaliseLibrary(raw);
  const by = (id) => l.drills.find((d) => d.id === id);
  ok(l && l.drills.map((d) => d.id).join() === 'a,b,e', 'an array of drills reads too; no steps, no id, a repeated id and anything not a drill are dropped', l && l.drills.map((d) => d.id).join());
  ok(by('a').causes.join() === 'repeek' && by('a').where === 'Practice Range' && by('a').minutes === 12 && by('a').bands.join() === 'silver_gold',
    'a cause reads with or without cause:, the place by its name, minutes as a number, an unknown band dropped');
  ok(by('b').title === 'Named' && by('b').causes.join() === 'untraded,first-death' && by('b').where === 'Deathmatch' && by('b').minutes === 8 && by('b').steps.length === 1,
    'name, causes, mode and duration read as title, the causes, where and minutes');
  ok(!by('c'), 'a drill about credits and the buy is dropped: the economy is out of scope');
  ok(!DASHES.test(JSON.stringify(by('e'))) && by('e').title === 'A, dash' && by('e').where === 'Unrated match', 'a dash in the library becomes a comma, and unrated reads as an Unrated match', JSON.stringify(by('e')));
  ok(P.normaliseLibrary(null) === null && P.normaliseLibrary({}) === null && P.normaliseLibrary({ drills: [{}] }) === null && P.normaliseLibrary('x') === null,
    'a library missing, empty or with no drill in it is none');
}
{
  const real = path.join(ROOT, 'src', 'shared', 'drill-library.json');
  if (fs.existsSync(real)) {
    const raw = JSON.parse(fs.readFileSync(real, 'utf8'));
    const l = P.normaliseLibrary(raw);
    const n = (raw.drills || raw).length;
    ok(l && l.drills.length === n, `the real drill library reads whole, ${l && l.drills.length} of ${n} drills`);
    ok(l && P.drillsFor(l, 'general', null, []).length >= 2, 'and has general drills for a player with no repeated mistakes');
    ok(l && l.drills.every((d) => d.steps.length >= 3 && d.steps.length <= 6 && d.goal && d.check), 'every real drill has 3 to 6 steps, a goal and a check line');
  } else {
    console.log('skip  the real drill library is not in this tree yet');
  }
}

// ── A drill's demo (8.11) ─────────────────────────────────────────────────
const GOOD_DEMO = { src: 'https://occlara.app/drills/lost-duel-counter-strafe.webm', poster: 'https://occlara.app/drills/lost-duel-counter-strafe.webp', secs: 8 };
{
  const base = { id: 'x', title: 'A drill', cause: 'repeek', steps: ['one'] };
  const demoOfDrill = (demo) => { const l = P.normaliseLibrary([{ ...base, demo }]); return l ? l.drills[0].demo : 'no drill'; };
  ok(JSON.stringify(demoOfDrill(GOOD_DEMO)) === JSON.stringify(GOOD_DEMO), 'DEMOS: a demo under occlara.app/drills/ is kept, its video, poster and seconds');
  ok(demoOfDrill(undefined) === null, 'a drill with no demo reads as before, its demo none');
  const bad = [
    ['http', { ...GOOD_DEMO, src: 'http://occlara.app/drills/a.webm' }],
    ['another host', { ...GOOD_DEMO, src: 'https://example.com/drills/a.webm' }],
    ['a look alike host', { ...GOOD_DEMO, src: 'https://occlara.app.example.com/drills/a.webm' }],
    ['a subdomain', { ...GOOD_DEMO, poster: 'https://cdn.occlara.app/drills/a.webp' }],
    ['outside drills', { ...GOOD_DEMO, src: 'https://occlara.app/a.webm' }],
    ['a folder that only starts like drills', { ...GOOD_DEMO, src: 'https://occlara.app/drillsx/a.webm' }],
    ['climbing out', { ...GOOD_DEMO, src: 'https://occlara.app/drills/../a.webm' }],
    ['an escaped climb', { ...GOOD_DEMO, src: 'https://occlara.app/drills/%2e%2e/a.webm' }],
    ['a query', { ...GOOD_DEMO, src: 'https://occlara.app/drills/a.webm?x=1' }],
    ['a fragment', { ...GOOD_DEMO, poster: 'https://occlara.app/drills/a.webp#x' }],
    ['a login', { ...GOOD_DEMO, src: 'https://me@occlara.app/drills/a.webm' }],
    ['a port', { ...GOOD_DEMO, src: 'https://occlara.app:8443/drills/a.webm' }],
    ['a picture as the video', { ...GOOD_DEMO, src: 'https://occlara.app/drills/a.webp' }],
    ['a video as the poster', { ...GOOD_DEMO, poster: 'https://occlara.app/drills/a.webm' }],
    ['a script', { ...GOOD_DEMO, src: 'https://occlara.app/drills/a.js' }],
    ['a data URL', { ...GOOD_DEMO, poster: 'data:image/webp;base64,AAAA' }],
    ['javascript', { ...GOOD_DEMO, src: 'javascript:alert(1)' }],
    ['a file URL', { ...GOOD_DEMO, src: 'file:///C:/drills/a.webm' }],
    ['a backslash', { ...GOOD_DEMO, src: 'https://occlara.app/drills' + String.fromCharCode(92) + 'a.webm' }],
    ['an upper case scheme', { ...GOOD_DEMO, src: 'HTTPS://occlara.app/drills/a.webm' }],
    ['a space', { ...GOOD_DEMO, src: 'https://occlara.app/drills/a b.webm' }],
    ['the video alone', { src: GOOD_DEMO.src }],
    ['the poster alone', { poster: GOOD_DEMO.poster }],
    ['not a string', { src: 7, poster: GOOD_DEMO.poster }],
    ['a list', [GOOD_DEMO.src, GOOD_DEMO.poster]],
    ['a string', GOOD_DEMO.src],
  ];
  const kept = bad.filter(([, d]) => demoOfDrill(d) !== null).map(([w]) => w);
  ok(!kept.length, `a demo anywhere else is dropped (${bad.length} kinds: http, other hosts, outside /drills/, a climb, a query, a login, a port, the wrong kind of file, one URL alone)`, kept.join(', '));
  ok(bad.every(([, d]) => { const l = P.normaliseLibrary([{ ...base, demo: d }]); return l && l.drills.length === 1; }), 'and a bad demo never drops its drill');
  ok(demoOfDrill({ ...GOOD_DEMO, secs: 'x' }).secs === null && demoOfDrill({ ...GOOD_DEMO, secs: 300 }).secs === null && demoOfDrill({ ...GOOD_DEMO, secs: 7.6 }).secs === 8,
    'its seconds kept only when they are a sensible length, rounded');
  ok(P.demoOf({ src: 'https://occlara.app/drills/v2/a-b_c.mp4', poster: 'https://occlara.app/drills/v2/a-b_c.jpg' }) !== null, 'a folder under drills, mp4 and jpg read too');
  const view = P.planView({ patterns: { enough: false, recorded: 0, mistakes: [] }, library: P.normaliseLibrary([{ ...base, cause: 'general', demo: GOOD_DEMO }]), state: P.emptyState(), now: day(0), saved: [] });
  ok(view.general[0] && view.general[0].demo && view.general[0].demo.src === GOOD_DEMO.src, 'and the page is handed it with the drill');
}

// ── The plan ──────────────────────────────────────────────────────────────
const M = (key, title, matches) => ({ key, title, matches, total: matches, fix: `Fix for ${title}.`, weight: 1 });
const pats = (list, recorded) => ({ enough: true, recorded: recorded || 6, mistakes: list });
{
  // same-killer has no drill in the sample: skipped, the next takes its place.
  const p = pats([M('same-killer', 'Skye kept winning', 5), M('untraded', 'Deaths nobody traded', 4), M('early', 'Dying early', 4), M('lost-advantage', 'Gave back the advantage', 3)]);
  const a = P.choosePlan({ patterns: p, library: lib, band: null, state: P.emptyState(), now: day(0) });
  const plan = a.state.plans.valorant;
  ok(a.changed && plan.focus.map((f) => f.key).join() === 'untraded,early', 'the plan is the two most serious repeated mistakes that have drills', plan && plan.focus.map((f) => f.key).join());
  ok(plan.focus.every((f) => f.drills.length >= 2 && f.drills.length <= 3 && f.since === day(0)), 'each with two or three drills, dated', JSON.stringify(plan.focus));
  // Reordered, the same two stay, in their order.
  const p2 = pats([M('early', 'Dying early', 6), M('lost-advantage', 'Gave back the advantage', 5), M('untraded', 'Deaths nobody traded', 4)]);
  const b = P.choosePlan({ patterns: p2, library: lib, band: null, state: a.state, now: day(1) });
  ok(!b.changed && b.state.plans.valorant.focus.map((f) => f.key).join() === 'untraded,early', 'NO CHURN: the list reordered, a third mistake above one of them, the plan stays as it was');
  // untraded leaves the list: replaced by the next with drills, the other kept with its date.
  const p3 = pats([M('early', 'Dying early', 6), M('lost-advantage', 'Gave back the advantage', 5)]);
  const c = P.choosePlan({ patterns: p3, library: lib, band: null, state: b.state, now: day(2) });
  const f3 = c.state.plans.valorant.focus;
  ok(c.changed && f3.map((f) => f.key).join() === 'early,lost-advantage' && f3[0].since === day(0) && f3[1].since === day(2),
    'a focus whose mistake stopped repeating is replaced, the one still repeating keeps its date', JSON.stringify(f3.map((f) => [f.key, f.since])));
  // No repeated mistakes: no plan.
  const d = P.choosePlan({ patterns: { enough: false, recorded: 1, mistakes: [] }, library: lib, band: null, state: c.state, now: day(3) });
  ok(d.changed && !d.state.plans.valorant, 'with no repeated mistake left there is no plan');
  const e = P.choosePlan({ patterns: p, library: null, band: null, state: a.state, now: day(3) });
  ok(!e.changed && e.state === a.state, 'with no library the stored plan is left as it was');
}
{
  // THE BAND: a drill for other bands is left out while one fits.
  const l = P.normaliseLibrary({ drills: [
    { id: 'hi', title: 'High', cause: 'repeek', bands: ['asc_plus'], steps: ['x'] },
    { id: 'all', title: 'Every band', cause: 'repeek', bands: [], steps: ['x'] },
    { id: 'lo', title: 'Low', cause: 'repeek', bands: ['iron_bronze'], steps: ['x'] },
  ] });
  ok(P.drillsFor(l, 'cause:repeek', 'iron_bronze', []).map((d) => d.id).join() === 'lo,all', 'at a band: its own drills first, then every band\'s, never another band\'s');
  ok(P.drillsFor(l, 'repeek', 'asc_plus', []).map((d) => d.id).join() === 'hi,all', 'and the other way up');
  ok(P.drillsFor(l, 'repeek', null, []).map((d) => d.id).join() === 'all,hi,lo', 'with no band: every band\'s first, then the rest');
  const only = P.normaliseLibrary({ drills: [{ id: 'hi', title: 'High', cause: 'repeek', bands: ['asc_plus'], steps: ['x'] }] });
  ok(P.drillsFor(only, 'repeek', 'iron_bronze', []).map((d) => d.id).join() === 'hi', 'and a cause with nothing at the band still shows what there is');
}
{
  // REFRESH AFTER FINISH marks: the finished drill makes way for the next.
  const l = P.normaliseLibrary({ drills: [1, 2, 3, 4].map((i) => ({ id: `u${i}`, title: `Drill ${i}`, cause: 'untraded', steps: ['x'], minutes: 10 })) });
  const p = pats([M('untraded', 'Deaths nobody traded', 4)]);
  let st = P.choosePlan({ patterns: p, library: l, band: null, state: P.emptyState(), now: day(0) }).state;
  ok(st.plans.valorant.focus[0].drills.join() === 'u1,u2,u3', 'three drills to start');
  const d1 = l.drills[0];
  const m1 = P.mark(st, d1, day(0), 'e1');
  ok(m1 && m1.state.log.length === 1 && m1.entry.minutes === 10, 'a mark is one dated entry with its minutes');
  ok(P.mark(m1.state, d1, day(0) + HOUR, 'e1b') === null, 'and the same drill marked again the same day is not counted twice');
  st = m1.state;
  st = P.mark(st, d1, day(1), 'e2').state;
  let r = P.choosePlan({ patterns: p, library: l, band: null, state: st, now: day(1) });
  ok(!r.changed && r.state.plans.valorant.focus[0].drills.join() === 'u1,u2,u3', 'two marks: the drill stays');
  st = P.mark(r.state, d1, day(2), 'e3').state;
  r = P.choosePlan({ patterns: p, library: l, band: null, state: st, now: day(2) });
  ok(r.changed && r.state.plans.valorant.focus[0].drills.join() === 'u2,u3,u4' && r.state.plans.valorant.focus[0].since === day(0),
    'the third mark finishes it: the next drill takes its place, the focus keeps its date', r.state.plans.valorant.focus[0].drills.join());
  const v = P.planView({ patterns: p, library: l, band: null, state: r.state, now: day(2), saved: [], riotId: false });
  ok(v.status === 'plan' && v.focus[0].drills.every((d) => d.id !== 'u1'), 'and the page shows the new set');
  const back = P.unmark(st, 'e3');
  ok(back && back.log.length === 2 && P.unmark(st, 'nope') === null, 'an entry taken out of the log, and none taken for an id not in it');
}

// ── Is it working? ────────────────────────────────────────────────────────
const KEY = 'untraded';
const rv = (i, has, opts) => ({
  id: `v${i}`, at: day(0) + (opts && opts.before ? -1 : 1) * (i + 1) * HOUR, game: 'valorant',
  review: { kind: 'valorant', verified: !(opts && opts.unverified), source: opts && opts.riot ? 'riot' : undefined,
    insights: { mistakes: has ? [{ key: KEY, title: 'Deaths nobody traded', rounds: [3], count: 1 }] : [] } },
});
const series = (after, before) => [
  ...after.map((h, i) => rv(after.length - i, h)),         // newest first after the plan
  ...before.map((h, i) => rv(i, h, { before: true })),
];
{
  let p = P.progressOf(series([], [true, true]), KEY, day(0));
  ok(!p.enough && p.text === 'Not enough matches yet' && p.over === 'After 3 matches since the plan, this says whether it is shrinking', 'no match since the plan: not enough matches yet', JSON.stringify(p));
  p = P.progressOf(series([true, false], [true]), KEY, day(0));
  ok(!p.enough && p.text === 'Not enough matches yet' && p.over === '2 of the 3 matches it needs since the plan', 'two since the plan: still not enough, and says how many', p.over);
  p = P.progressOf(series([false, true, false, false, true], [true, true, true, true, true]), KEY, day(0));
  ok(p.enough && p.trend === 'down' && p.tone === 'good' && p.text === 'Down from 5 of 5 to 2 of 5' && p.over === 'Your last 5 matches against the 5 before',
    'down: the counts as they are', JSON.stringify(p));
  p = P.progressOf(series([true, true, true], [false, true, false, false, false]), KEY, day(0));
  ok(p.trend === 'up' && p.tone === 'bad' && p.text === 'Up from 1 of 5 to 3 of 3', 'up, three matches since against the five before', p.text);
  p = P.progressOf(series([true, false, true, false, false], [true, false, false, true, false]), KEY, day(0));
  ok(p.trend === 'same' && p.tone === 'even' && p.text === 'Same, 2 of 5 both times', 'same', p.text);
  p = P.progressOf(series([true, false, true, false], [true, false]), KEY, day(0));
  ok(p.trend === 'same' && p.text === 'Same rate, 2 of 4 against 1 of 2', 'the same share over windows of two sizes says so', p.text);
  p = P.progressOf(series([true, false, true], []), KEY, day(0));
  ok(p.enough && p.trend === null && p.text === 'In 2 of your 3 matches since the plan', 'nothing before the plan: the count alone, no comparison', p.text);
  // Seven since the plan: the last five against the five before them.
  p = P.progressOf(series([false, false, false, false, false, true, true], [true, true, true]), KEY, day(0));
  ok(p.text === 'Down from 5 of 5 to 0 of 5', 'more than five since: the last five against the five before them', p.text);
  // A match Riot never reached cannot count a Riot only key: left out.
  const s = series([false, false, false], [true, true]);
  s.splice(0, 0, { ...rv(9, false), review: { ...rv(9, false).review, verified: false } });
  s.push({ ...rv(8, false, { before: true }), review: { ...rv(8, false).review, source: 'riot' } });
  p = P.progressOf(s, KEY, day(0));
  ok(p.text === 'Down from 2 of 2 to 0 of 3', 'a match Riot never reached, and one graded from Riot alone, count in neither window', p.text);
  ok(!DASHES.test(JSON.stringify([p])), 'no dash in a line');
}

// ── The player's own clip of a mistake (8.11) ─────────────────────────────
// Reviews as main saves them: each round card the player died in with the
// look's clip named, the mistake counted in its rounds (insights), and what
// is on disk handed in, as moments.js build is handed it.
const CK = 'untraded';
const cid = (i) => `valorant-${1762000000000 + i}-abcd${i}`;
const died = (n, clip, extra) => ({ n, died: true, result: 'lost',
  forensics: { cause: 'isolated', what: 'You swung alone.', clip, clipDeath: 11000, frames: [`r${n}-a.jpg`, `r${n}-b.jpg`], frameAt: [-3, 0.5] }, ...(extra || {}) });
const crv = (i, rounds, opts) => ({
  id: cid(i), at: day(0) - (i + 1) * HOUR, game: 'valorant',
  review: { kind: 'valorant', verified: true, source: opts && opts.riot ? 'riot' : undefined, game: { map: (opts && opts.map) || 'Ascent', agent: 'Jett' }, rounds,
    insights: { mistakes: [{ key: CK, title: 'Deaths nobody traded', rounds: (opts && opts.counted) || rounds.map((c) => c.n), count: 1 }] } },
});
function clipIo(disk) {
  const asked = [];
  return {
    asked,
    clips: (id) => { asked.push(id); return [...(disk[id] || [])]; },
    url: (id, name) => clipScheme.urlFor(id, name),
    frames: () => ({ times: [0, 33.3, 66.6], end: 15000 }),
    poster: (id, name) => `data:image/jpeg;base64,${Buffer.from(`${id}/${name}`).toString('base64')}`,
  };
}
const posterIs = (c, id, name) => c && c.poster === `data:image/jpeg;base64,${Buffer.from(`${id}/${name}`).toString('base64')}`;
{
  const older = crv(5, [died(11, 'r11-clip.mkv')], { map: 'Bind' });
  const newer = crv(1, [died(3, 'r3-clip.mkv'), died(7, 'r7-clip.mkv')]);
  const disk = { [cid(5)]: ['r11-clip.mkv'], [cid(1)]: ['r3-clip.mkv', 'r7-clip.mkv'] };
  let c = P.clipFor([older, newer], CK, clipIo(disk));
  ok(c && c.url === clipScheme.urlFor(cid(1), 'r7-clip.mkv') && c.round === 7,
    'OWN CLIP: the newest match wins whatever order the reviews come in, and inside it the latest round', c && c.url);
  ok(c.death === 11000 && c.frames && c.frames.end === 15000 && c.map === 'Ascent' && c.at === newer.at && c.id === cid(1),
    'with the death\'s place in the clip, main\'s read of its frames, the map and the match', JSON.stringify(c && { death: c.death, map: c.map }));
  ok(c.line === 'Round 7 on Ascent' && c.label === 'The clip of round 7' && c.title === 'Your newest clip of this mistake', 'its words are main\'s', c.line);
  ok(posterIs(c, cid(1), 'r7-a.jpg'), 'its poster the look\'s frame nearest the death from before it');
  // Gone from disk: passed over for the next one kept.
  c = P.clipFor([older, newer], CK, clipIo({ ...disk, [cid(1)]: ['r3-clip.mkv'] }));
  ok(c && c.round === 3 && c.id === cid(1), 'a clip named on its card but gone from disk is passed over for the next round kept', c && c.url);
  c = P.clipFor([older, newer], CK, clipIo({ ...disk, [cid(1)]: [] }));
  ok(c && c.id === cid(5) && c.round === 11 && c.line === 'Round 11 on Bind', 'and with none of the newest match kept, the match before it', c && c.url);
  ok(P.clipFor([older, newer], CK, clipIo({})) === null, 'NO CLIP: nothing on disk, nothing shown');
  ok(P.clipFor([older, newer], 'early', clipIo(disk)) === null, 'a mistake never counted in a round with a clip has none');
  // Counted in round 3 only: round 7's clip is of another moment.
  c = P.clipFor([crv(1, [died(3, 'r3-clip.mkv'), died(7, 'r7-clip.mkv')], { counted: [3] })], CK, clipIo(disk));
  ok(c && c.round === 3, 'only a round the mistake was counted in, as the Moments page joins them', c && c.url);
  // A round sat out, a round not died in, a Riot only match, a name that is no clip's: none of them.
  const sat = crv(1, [died(3, 'r3-clip.mkv', { riot: { afk: true } })]);
  const alive = crv(1, [{ ...died(3, 'r3-clip.mkv'), died: false }]);
  const riot = crv(1, [died(3, 'r3-clip.mkv')], { riot: true });
  const odd = crv(1, [died(3, '../r3-clip.mkv')]);
  ok([sat, alive, riot, odd].every((s) => P.clipFor([s], CK, clipIo({ [cid(1)]: ['r3-clip.mkv', '../r3-clip.mkv'] })) === null),
    'a round the player sat out, one they did not die in, a match graded from Riot alone and a name that is no clip\'s are never shown');
  // The disk is asked only for a review with a candidate.
  const io = clipIo(disk);
  P.clipFor([crv(2, [{ n: 4, died: true }]), newer], CK, io);
  ok(io.asked.join() === cid(1), 'the disk is asked only of a review that has a clip to show', io.asked.join());
  // The poster: the first frame with no seconds, none with no frames, none when the frame is gone.
  const noAt = crv(1, [{ ...died(3, 'r3-clip.mkv'), forensics: { ...died(3, 'r3-clip.mkv').forensics, frameAt: null } }]);
  ok(posterIs(P.clipFor([noAt], CK, clipIo(disk)), cid(1), 'r3-a.jpg'), 'a look with no seconds on its frames: its first frame is the poster');
  const noFrames = crv(1, [{ ...died(3, 'r3-clip.mkv'), forensics: { cause: 'isolated', clip: 'r3-clip.mkv' } }]);
  const nf = P.clipFor([noFrames], CK, clipIo(disk));
  ok(nf && nf.poster === null && nf.death === null, 'a look with no frames has no poster, and a clip with no place for the death has none either');
  ok(P.clipFor([newer], CK, { ...clipIo(disk), poster: () => null }).poster === null, 'and a frame gone from disk is no poster, the clip still shown');
  ok(P.clipFor([newer], CK, null) === null && P.clipFor([newer], null, clipIo(disk)) === null && P.clipFor(null, CK, clipIo(disk)) === null,
    'with nothing to ask, nothing is shown, never a throw');
  ok(P.clipFor([newer], CK, { ...clipIo(disk), clips: () => { throw new Error('disk'); } }) === null, 'and a disk that throws is no clip');
  ok(!DASHES.test(JSON.stringify(P.clipFor([older, newer], CK, clipIo(disk)))), 'no dash in its words');
  // planView carries it on each focus and on the review's link, and says nothing when there is none.
  const p = { enough: true, recorded: 6, mistakes: [{ key: CK, title: 'Deaths nobody traded', matches: 4, fix: 'Fix.' }, { key: 'early', title: 'Dying early', matches: 3, fix: 'Fix.' }] };
  const chosen = P.choosePlan({ patterns: p, library: lib, band: null, state: P.emptyState(), now: day(0) }).state;
  const pv = P.planView({ patterns: p, library: lib, state: chosen, now: day(0), saved: [older, newer], clipOf: (k) => P.clipFor([older, newer], k, clipIo(disk)), focus: { key: 'cause:repeek', title: 'Repeeks' } });
  ok(pv.focus[0].clip && pv.focus[0].clip.round === 7 && pv.focus[1].clip === null && pv.asked && pv.asked.clip === null,
    'the page\'s view: the clip on its focus, none on a focus or a review\'s link with none kept');
  const pv2 = P.planView({ patterns: p, library: lib, state: chosen, now: day(0), saved: [], clipOf: () => { throw new Error('x'); } });
  ok(pv2.focus.every((f) => f.clip === null), 'and a join that throws is no clip, never a page that fails');
}

// ── The streak and the log ────────────────────────────────────────────────
{
  const e = (id, at, minutes) => ({ id, drill: 'd' + id, title: 'T', minutes, at });
  let s = P.streakOf([], day(5));
  ok(s.days === 0 && s.line === 'Nothing practised yet.', 'nothing practised yet');
  s = P.streakOf([e('a', day(5), 10), e('b', day(4), 15), e('c', day(3), 5), e('d', day(1), 10)], day(5));
  ok(s.days === 3 && s.minutes === 40 && s.line === 'Practised 3 days in a row, 40 minutes in all.', 'three days running, every minute counted', s.line);
  s = P.streakOf([e('b', day(4), 15), e('c', day(3), 5)], day(5));
  ok(s.days === 2, 'before today\'s first mark, yesterday still holds the run');
  s = P.streakOf([e('c', day(2), 5)], day(5));
  ok(s.days === 0 && s.line === '5 minutes practised in all.', 'a run broken says the minutes alone');
}

// ── The store ─────────────────────────────────────────────────────────────
{
  const bad = [undefined, null, 'x', 42, [], { v: 2, log: [{ id: 'a', drill: 'b', at: 1 }] }, { plans: 'no', log: 'no' },
    { v: 1, plans: { valorant: { focus: [{}, { key: 'untraded', drills: 'x' }] } }, log: [{ id: 1 }, { id: 'ok', drill: 'd', at: 5, minutes: -3 }, { id: 'ok', drill: 'd', at: 6 }] }];
  const outs = bad.map((b) => { try { return P.normaliseState(b); } catch (err) { return err; } });
  ok(outs.every((o) => o && o.v === P.SCHEMA && typeof o.plans === 'object' && Array.isArray(o.log)), 'anything stored reads as a state, never a throw');
  ok(outs[5].log.length === 0, 'a schema this build does not know reads as nothing saved');
  const last = outs[7];
  ok(last.plans.valorant.focus.length === 1 && last.plans.valorant.focus[0].drills.length === 0 && last.log.length === 1 && last.log[0].minutes === null,
    'a malformed focus or entry is dropped, a repeated entry id kept once, a bad minutes read as none', JSON.stringify(last));
}

// The service on a stand in store, the sample library, made up reviews.
function service(o) {
  const data = { practice: o.stored };
  const pushes = [];
  const opened = [];
  let t = o.now;
  const saved = o.saved;
  const svc = createPractice({
    store: { get: (k) => data[k], set: (k, v) => { data[k] = JSON.parse(JSON.stringify(v)); } },
    recent: () => saved,
    summarise: (s) => patternsOf.summarise(s),
    band: () => o.band || null,
    riotId: () => o.riotId || '',
    busy: () => !!o.busy(),
    game: () => o.game(),
    gameLabel: (id) => (id === 'lol' ? 'League of Legends' : 'Valorant'),
    open: (p) => opened.push(p),
    changed: () => pushes.push(1),
    library: o.library || FIXTURE,
    now: () => t,
  });
  return { svc, data, pushes, opened, at: (x) => { t = x; } };
}
// Six recorded matches, each with untraded and early, newest first, two hours apart.
const libraryOf = (n, keys) => Array.from({ length: n }, (_v, i) => ({
  id: `valorant-${i}`, at: day(0) - (i + 1) * 2 * HOUR, game: 'valorant',
  review: { kind: 'valorant', verified: true, insights: { mistakes: keys.map((k) => ({ key: k, title: k === 'untraded' ? 'Deaths nobody traded' : 'Dying early', rounds: [2], count: 1, fix: `Fix ${k}.` })) } },
}));
(async () => {
  {
    let busy = false;
    let game = 'valorant';
    const s = service({ stored: 'garbage', saved: libraryOf(6, ['untraded', 'early']), now: day(0), busy: () => busy, game: () => game });
    const v = s.svc.get('valorant');
    ok(v && v.status === 'plan' && v.focus.map((f) => f.key).join() === 'untraded,early' && v.focus[0].line === 'In 6 of your last 6 recorded matches',
      'the service builds the plan from the patterns\' own count over garbage in the store', v && JSON.stringify(v.focus.map((f) => [f.key, f.line])));
    ok(s.data.practice && s.data.practice.v === P.SCHEMA && s.data.practice.plans.valorant, 'and stores it under its schema');
    ok(v.focus[0].progress && !v.focus[0].progress.enough, 'no match since the plan yet: not enough');
    ok(v.needsRiotId && v.bandLine === 'These drills fit every level until your rank is known.', 'without a Riot ID it says the drills fit every level, and the page offers Connect your Riot ID');
    ok(!DASHES.test(JSON.stringify(v)), 'no dash anywhere in the page');
    ok(/kept on this PC/.test(v.privacy), 'and it says everything is kept on this PC');

    // HOME'S LINE.
    const t0 = s.svc.today();
    ok(t0 && /^Today's practice: .+, \d+ minutes$/.test(t0.text) && t0.cause === 'untraded', 'Home\'s line names the first drill of the first focus with its minutes', t0 && t0.text);
    busy = true;
    ok(s.svc.today() === null && s.svc.get('valorant') === null, 'MID MATCH: no line on Home, no page');
    const refused = s.svc.mark(t0.drill);
    ok(refused && refused.ok === false && refused.error === 'match' && !s.pushes.length, 'and a mark is refused, nothing pushed');
    s.svc.open('untraded', 'x');
    ok(!s.opened.length, 'and the review\'s link opens nothing');
    busy = false;
    const m = s.svc.mark(t0.drill);
    ok(m.ok && s.pushes.length === 1 && s.data.practice.log.length === 1, 'a mark is stored and the pages are told');
    ok(s.svc.today() === null, 'ONCE A DAY: practised today, no line on Home');
    ok(s.svc.mark(t0.drill).error === 'today', 'and the same drill twice in a day is refused');
    ok(s.svc.mark('no-such-drill').error === 'drill', 'a drill the library does not have is refused');
    s.at(day(1));
    const t1 = s.svc.today();
    ok(t1 && t1.drill === t0.drill, 'the next day the line is back');
    game = 'lol';
    ok(s.svc.today() === null, 'never for League');
    const lol = s.svc.get('lol');
    ok(lol && lol.status === 'game' && lol.empty.title === 'League of Legends practice', 'League gets its panel, naming the game');
    game = 'valorant';
    const entry = s.data.practice.log[0].id;
    ok(s.svc.remove(entry).ok && s.data.practice.log.length === 0 && s.svc.remove(entry).error === 'entry', 'an entry deleted from the log, once');
    // The review's Practise this: the page opened on that mistake, answered once.
    s.svc.open('cause:repeek', 'Repeeks');
    ok(s.opened.join() === 'practice', 'the review\'s link opens the Practice page');
    const o1 = s.svc.get('valorant');
    ok(o1.opened && o1.opened.key === 'cause:repeek' && o1.asked && o1.asked.title === 'Repeeks' && o1.asked.drills.length >= 1,
      'on that mistake: not in the plan, so its drills are shown on their own', JSON.stringify(o1.asked && o1.asked.title));
    const o2 = s.svc.get('valorant', { key: 'cause:repeek', title: 'Repeeks' });
    ok(!o2.opened && o2.asked && o2.asked.key === 'cause:repeek', 'answered once, and kept while the page hands it back');
    s.svc.open('early', 'Dying early');
    const o3 = s.svc.get('valorant');
    ok(!o3.asked && o3.focus.find((f) => f.key === 'early').focused, 'a mistake in the plan is marked in place');
    ok(!s.data.practice.plans.valorant.focus.some((f) => f.key === 'cause:repeek'), 'and nothing the review asked is stored in the plan');
  }
  {
    // EMPTY STATES.
    const none = service({ stored: undefined, saved: [], now: day(0), busy: () => false, game: () => 'valorant', riotId: 'Name#TAG' });
    const v = none.svc.get('valorant');
    ok(v.status === 'nomatches' && v.empty.title === 'No matches yet' && v.general.length >= 2 && !v.today, 'no matches: says so, with drills for every player, and no Home line', JSON.stringify(v.empty));
    ok(!v.needsRiotId && /every level/.test(v.bandLine), 'a Riot ID with no rank on record: every level, no Connect');
    const one = service({ stored: undefined, saved: libraryOf(1, ['untraded']), now: day(0), busy: () => false, game: () => 'valorant', band: 'silver_gold' });
    const v1 = one.svc.get('valorant');
    ok(v1.status === 'norepeats' && v1.empty.title === 'No repeated mistakes yet' && v1.general.length >= 2 && v1.bandLine === 'Drills sized for Silver and Gold.',
      'one match: no repeated mistakes yet, general drills at the band', JSON.stringify([v1.status, v1.bandLine]));
    const nolib = service({ stored: undefined, saved: libraryOf(4, ['untraded']), now: day(0), busy: () => false, game: () => 'valorant', library: path.join(os.tmpdir(), 'occlara-no-such-drills.json') });
    const v2 = nolib.svc.get('valorant');
    ok(v2.status === 'nolibrary' && v2.empty.title === 'No drills in this build' && !v2.focus.length && !v2.general.length && nolib.svc.today() === null,
      'the library missing: a calm line, no drills, no Home line');
    const bad = path.join(os.tmpdir(), `occlara-bad-drills-${process.pid}.json`);
    fs.writeFileSync(bad, '{ not json');
    const broken = service({ stored: undefined, saved: libraryOf(4, ['untraded']), now: day(0), busy: () => false, game: () => 'valorant', library: bad });
    ok(broken.svc.get('valorant').status === 'nolibrary', 'and a library that does not parse is the same');
    fs.rmSync(bad, { force: true });
  }

  // ── The page ────────────────────────────────────────────────────────────
  const dir = path.join(ROOT, 'src', 'renderer', 'practice');
  const html = fs.readFileSync(path.join(dir, 'index.html'), 'utf8');
  const js = fs.readFileSync(path.join(dir, 'practice.js'), 'utf8');
  const css = fs.readFileSync(path.join(dir, 'practice.css'), 'utf8');
  const ids = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]));
  const wanted = [...new Set([...js.matchAll(/(?:\$|getElementById)\(\s*'([^']+)'\s*\)/g)].map((m) => m[1]))];
  const missing = wanted.filter((id) => !ids.has(id));
  ok(wanted.length > 15 && !missing.length, `THE PAGE'S DOM HOOKS: every id practice.js asks for is in its index.html (${wanted.length})`, missing.join());
  ok(/^\/\* palette: tokens only \*\//.test(css), 'its stylesheet is held to tokens');
  ok(![html, js, css].some((s) => DASHES.test(s)), 'no dash in the page');
  ok(/src="\.\.\/shared\/motion\.js"/.test(html) && /Motion/.test(js) && html.indexOf('../shared/embed.js') < html.indexOf('<link rel="stylesheet"'),
    'it loads embed.js first and the shared motion layer');
  const page = nav.pageOf('practice');
  ok(page && page.surface === 'practice' && page.preload === 'practice-preload.js' && page.nav === true, 'Practice is a page with its own surface and preload, a tab');
  const tabs = nav.PAGES.filter((p) => p.nav).map((p) => p.id);
  ok(tabs.indexOf('practice') === tabs.indexOf('patterns') + 1, 'right after Patterns', tabs.join());

  {
    // The page on the service's own view, through its real preload.
    const s = service({ stored: undefined, saved: libraryOf(6, ['untraded', 'early']), now: day(0), busy: () => false, game: () => 'valorant' });
    let sealed = false;
    const handlers = {
      [C.STATE_GET]: () => ({ gameId: 'valorant' }),
      [C.PRACTICE_GET]: (g, asked) => (sealed ? null : s.svc.get(g, asked)),
      [C.PRACTICE_MARK]: (id) => s.svc.mark(id),
      [C.PRACTICE_REMOVE]: (id) => s.svc.remove(id),
    };
    const q = loadSurface('practice', { handlers });
    await settle(10);
    const $ = q.$;
    ok(!$('pc-page').hidden && $('pc-wait').hidden && !$('pc-plan').hidden && $('pc-empty').hidden && $('pc-general').hidden,
      'the page paints the plan');
    const blocks = q.document.querySelectorAll('.pc-focus');
    ok(blocks.length === 2 && blocks[0].querySelector('.pc-focus-title').textContent === 'Deaths nobody traded'
      && blocks[0].querySelector('.pc-count').textContent === 'In 6 of your last 6 recorded matches', 'two mistakes, each with its count', blocks.length);
    const cards = q.document.querySelectorAll('.pc-drill');
    ok(cards.length >= 4 && cards.every((c) => c.querySelector('.pc-d-title') && c.querySelectorAll('.pc-steps li').length >= 1 && c.querySelector('.pc-mark')),
      'each drill a card: title, steps and Mark as practised', cards.length);
    ok(cards[0].querySelectorAll('.pc-fact dt').map((d) => d.textContent).join() === 'Goal,How you will know', 'with its goal and how you will know');
    ok(!$('pc-working').hidden && q.document.querySelectorAll('#pc-trend .pc-trow').length === 2 && /Not enough matches yet/.test($('pc-trend').textContent),
      'Is it working, honest with no match since the plan');
    ok(!$('pc-log-none').hidden && !q.document.querySelectorAll('#pc-log .pc-lrow').length, 'an empty log says so');
    const first = cards[0];
    const id = first.dataset.drill;
    q.fire(first.querySelector('.pc-mark'), 'click');
    await settle(10);
    ok(q.bridge.invoked.some(([ch, x]) => ch === C.PRACTICE_MARK && x === id), 'Mark as practised asks main to mark that drill');
    const again = q.document.querySelector(`.pc-drill[data-drill="${id}"] .pc-mark`);
    ok(again && again.disabled && again.textContent === 'Practised today', 'and the card says it was practised today');
    const rows = q.document.querySelectorAll('#pc-log .pc-lrow');
    ok(rows.length === 1 && $('pc-log-none').hidden && /min/.test(rows[0].textContent), 'the log lists it, dated');
    q.fire(rows[0].querySelector('.pc-del'), 'click');
    await settle(10);
    ok(q.bridge.invoked.some(([ch]) => ch === C.PRACTICE_REMOVE) && !q.document.querySelectorAll('#pc-log .pc-lrow').length, 'and deleting it takes it out');
    // Mid match the page paints nothing new.
    sealed = true;
    const before = $('pc-focus').children.length;
    q.bridge.emit(C.PUSH_PRACTICE, null);
    await settle(10);
    ok($('pc-focus').children.length === before && !$('pc-page').hidden, 'MID MATCH: main answers null and the page paints nothing new');
    sealed = false;
    // League.
    q.bridge.emit(C.PUSH_GAME, { id: 'lol' });
    await settle(10);
    ok(!$('pc-empty').hidden && $('pc-empty-title').textContent === 'League of Legends practice' && $('pc-plan').hidden && $('pc-log-sec').hidden,
      'League: its panel and nothing else');
  }

  // ── The player's own clip, through main and on the page (8.11) ──────────
  {
    // A real review store in a temp folder: six recorded matches with both
    // mistakes, the newest two with the look's clip of round 2 kept beside
    // them (stand in bytes, never a real clip) and the look's frames.
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'occlara-practice-clips-'));
    const store = new ReviewStore(root);
    const ids = [];
    for (let i = 0; i < 6; i++) {
      const at = day(0) - (i + 1) * 2 * HOUR;
      const id = newId('valorant', at);
      ids.push(id);
      const rounds = i < 2 ? [died(2, 'r2-clip.mkv'), { n: 9, died: true }] : [{ n: 2, died: true }];
      store.save({ id, game: 'valorant', at, review: { kind: 'valorant', verified: true, game: { map: i ? 'Bind' : 'Ascent', agent: 'Jett' }, rounds,
        insights: { mistakes: [
          { key: 'untraded', title: 'Deaths nobody traded', rounds: [2], count: 1, fix: 'Fix untraded.' },
          { key: 'early', title: 'Dying early', rounds: [9], count: 1, fix: 'Fix early.' },
        ] } },
      frames: i < 2 ? { 'r2-a.jpg': Buffer.from(`stand in frame ${i}`).toString('base64'), 'r2-b.jpg': Buffer.from('later').toString('base64') } : undefined });
      if (i < 2) store.saveClip(id, 'r2-clip.mkv', Buffer.from(`stand in clip ${i}`));
    }
    const mk = (withStore) => {
      const data = {};
      return createPractice({
        store: { get: (k) => data[k], set: (k, v) => { data[k] = JSON.parse(JSON.stringify(v)); } },
        recent: () => store.recent('valorant', patternsOf.LOOK_BACK),
        summarise: (s) => patternsOf.summarise(s),
        band: () => null, riotId: () => '', busy: () => false, game: () => 'valorant',
        gameLabel: () => 'Valorant', open: () => {}, changed: () => {},
        library: FIXTURE, now: () => day(0),
        ...(withStore ? { reviews: store } : {}),
      });
    };
    const svc = mk(true);
    let v = svc.get('valorant');
    const un = v && v.focus.find((f) => f.key === 'untraded');
    const ea = v && v.focus.find((f) => f.key === 'early');
    ok(un && un.clip && un.clip.url === clipScheme.urlFor(ids[0], 'r2-clip.mkv') && un.clip.url.startsWith('occlara-clip://review/'),
      'THROUGH MAIN: the newest kept clip of the mistake, by occlara-clip\'s own URL for that review', un && JSON.stringify(un.clip && un.clip.url));
    ok(un.clip.poster === `data:image/jpeg;base64,${Buffer.from('stand in frame 0').toString('base64')}` && un.clip.line === 'Round 2 on Ascent',
      'its poster the look\'s own frame from the store, its line the round and map');
    ok(ea && ea.clip === null, 'a mistake with no clip kept has none');
    // The clip deleted from disk: the next match's is shown, then none.
    fs.rmSync(store.clipFile(ids[0], 'r2-clip.mkv'));
    v = svc.get('valorant');
    ok(v.focus.find((f) => f.key === 'untraded').clip.url === clipScheme.urlFor(ids[1], 'r2-clip.mkv'), 'CLIP DELETED FROM DISK: asked again, the match before it');
    const q = loadSurface('practice', { handlers: {
      [C.STATE_GET]: () => ({ gameId: 'valorant' }),
      [C.PRACTICE_GET]: (g, asked) => svc.get(g, asked),
    } });
    await settle(10);
    const blocks = q.document.querySelectorAll('.pc-focus');
    const withClip = blocks.find((b) => b.dataset.key === 'untraded');
    const without = blocks.find((b) => b.dataset.key === 'early');
    const tile = withClip && withClip.querySelector('.pc-clip');
    ok(tile && tile.querySelector('.pc-clip-tile') && tile.querySelector('.pc-clip-poster') && tile.querySelector('.pc-clip-watch').textContent === 'Watch the round',
      'THE PAGE: the focus with a clip has its tile, the look\'s frame and Watch the round');
    ok(/^Round 2 on Bind, /.test(tile.querySelector('.pc-clip-line').textContent), 'with the round, the map and the day', tile.querySelector('.pc-clip-line').textContent);
    ok(without && !without.querySelector('.pc-clip') && !without.querySelector('video'), 'NO CLIP: no tile and no empty box');
    const order = withClip.children.map((n) => n.className);
    ok(order.indexOf('pc-clip') === order.indexOf('pc-focus-head') + 1 && order.indexOf('pc-drills') === order.indexOf('pc-clip') + 1, 'beside its drills: after the mistake, before the cards', order.join());
    ok(!q.document.querySelectorAll('video').length, 'nothing loads before it is asked for: no video on the page');
    q.fire(tile.querySelector('.pc-clip-watch'), 'click');
    await settle(5);
    const open = withClip.querySelector('.pc-clip.open');
    const vid = open && open.querySelector('.v-clip video');
    ok(open && vid && vid.getAttribute('src') === clipScheme.urlFor(ids[1], 'r2-clip.mkv') && vid.getAttribute('preload') === 'none' && vid.muted === true,
      'Watch the round opens it in the review\'s own clip player, muted, by main\'s URL', vid && vid.getAttribute('src'));
    ok(open.querySelector('.cp-row') && /^Round 2 on Bind/.test(open.querySelector('.pc-clip-line').textContent), 'with its controls, and still saying what it is');
    q.bridge.emit(C.PUSH_PRACTICE, null);
    await settle(10);
    ok(q.document.querySelector('.pc-clip.open') === open && open.querySelector('video').getAttribute('src'), 'A REPAINT keeps the clip being watched as it is');
    fs.rmSync(store.clipFile(ids[1], 'r2-clip.mkv'));
    q.bridge.emit(C.PUSH_PRACTICE, null);
    await settle(10);
    ok(!q.document.querySelectorAll('.pc-clip').length && !open.querySelector('video').getAttribute('src'),
      'and once no clip is kept the tile goes, the open one let go');
    // Without the review store wired, the page is as it was.
    const bare = mk(false).get('valorant');
    ok(bare.focus.every((f) => f.clip === null), 'without the review store handed in, no clip, and the page as before');
    fs.rmSync(root, { recursive: true, force: true });
  }

  // ── A drill's demo on the page (8.11) ───────────────────────────────────
  {
    const withDemos = path.join(os.tmpdir(), `occlara-demo-drills-${process.pid}.json`);
    fs.writeFileSync(withDemos, JSON.stringify({ ...fixture, drills: fixture.drills.map((d) => ({ ...d, demo: { src: `https://occlara.app/drills/${d.id}.webm`, poster: `https://occlara.app/drills/${d.id}.webp`, secs: 8 } })) }));
    const page = async (reduced) => {
      const s = service({ stored: undefined, saved: libraryOf(6, ['untraded', 'early']), now: day(0), busy: () => false, game: () => 'valorant', library: withDemos });
      const mq = { matches: !!reduced, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} };
      const q = loadSurface('practice', { handlers: {
        [C.STATE_GET]: () => ({ gameId: 'valorant' }),
        [C.PRACTICE_GET]: (g, asked) => s.svc.get(g, asked),
      }, window: { matchMedia: () => mq } });
      await settle(10);
      return q;
    };
    const q = await page(false);
    const cards = q.document.querySelectorAll('.pc-drill');
    const boxes = q.document.querySelectorAll('.pc-drill .pc-demo');
    ok(cards.length >= 4 && boxes.length === cards.length && boxes.every((b) => b.hidden) && !q.document.querySelectorAll('video').length,
      'DEMOS ON THE PAGE: each card holds its demo hidden until the poster is in, and nothing of the video loads', `${boxes.length} of ${cards.length}`);
    const [b0, b1, b2] = boxes;
    ok(b0.querySelector('.pc-demo-poster').src === `https://occlara.app/drills/${cards[0].dataset.drill}.webp` && cards[0].firstChild === b0, 'its poster from the website, at the top of the card');
    q.fire(b0.querySelector('.pc-demo-poster'), 'load');
    ok(!b0.hidden && b0.querySelector('.pc-demo-tag').textContent === 'Demo, 8 s', 'the poster in, the demo shows, its length on it');
    // Offline: the poster fails, and the card is as it was.
    const before = cards[1].children.length;
    q.fire(b1.querySelector('.pc-demo-poster'), 'error');
    ok(!cards[1].querySelector('.pc-demo') && cards[1].children.length === before - 1 && cards[1].querySelector('.pc-d-title') && cards[1].querySelector('.pc-mark'),
      'OFFLINE: a poster that fails takes the demo away, the card exactly as before');
    // A hover previews it, a click keeps it playing, a second click stops it.
    const btn = b0.querySelector('.pc-demo-btn');
    q.fire(btn, 'pointerenter');
    const v0 = b0.querySelector('video');
    ok(v0 && v0.getAttribute('src') === `https://occlara.app/drills/${cards[0].dataset.drill}.webm` && v0.getAttribute('preload') === 'none'
      && v0.muted === true && v0.getAttribute('loop') !== null, 'a hover makes its video: muted, looping, preload none, from the website');
    q.fire(btn, 'click');
    ok(btn.getAttribute('aria-pressed') === 'true', 'a click keeps it playing');
    q.fire(btn, 'click');
    ok(btn.getAttribute('aria-pressed') === 'false', 'and a second stops it');
    // The video failing takes the demo away too.
    q.fire(v0, 'error');
    ok(!cards[0].querySelector('.pc-demo') && cards[0].querySelector('.pc-d-title'), 'a video that fails takes the demo away, the card as before');
    q.fire(b2.querySelector('.pc-demo-poster'), 'load');
    q.bridge.emit(C.PUSH_PRACTICE, null);
    await settle(10);
    ok(q.document.querySelectorAll('.pc-drill .pc-demo').length === cards.length, 'painted again, each card asks for its demo again');
    // REDUCED MOTION: the poster with its play mark, nothing on a hover, a click plays.
    const r = await page(true);
    const rb = r.document.querySelector('.pc-drill .pc-demo');
    r.fire(rb.querySelector('.pc-demo-poster'), 'load');
    r.fire(rb.querySelector('.pc-demo-btn'), 'pointerenter');
    ok(!rb.hidden && rb.querySelector('.pc-demo-mark') && !rb.querySelector('video'), 'REDUCED MOTION: the poster and its play button, nothing played on a hover');
    r.fire(rb.querySelector('.pc-demo-btn'), 'click');
    ok(rb.querySelector('video') && rb.querySelector('.pc-demo-btn').getAttribute('aria-pressed') === 'true', 'and a click plays it');
    // No demo in the library: the cards as they were.
    const plain = service({ stored: undefined, saved: libraryOf(6, ['untraded', 'early']), now: day(0), busy: () => false, game: () => 'valorant' });
    const pq = loadSurface('practice', { handlers: { [C.STATE_GET]: () => ({ gameId: 'valorant' }), [C.PRACTICE_GET]: (g, a) => plain.svc.get(g, a) } });
    await settle(10);
    ok(pq.document.querySelectorAll('.pc-drill').length >= 4 && !pq.document.querySelectorAll('.pc-demo').length, 'a drill with no demo has no box at all');
    fs.rmSync(withDemos, { force: true });
  }
  {
    const html = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'practice', 'index.html'), 'utf8');
    const csp = (/http-equiv="Content-Security-Policy"\s+content="([^"]+)"/.exec(html) || [])[1] || '';
    const dir = (name) => ((csp.split(';').map((s) => s.trim()).find((s) => s.startsWith(`${name} `)) || '').split(/\s+/).slice(1));
    ok(dir('media-src').join(' ') === "'self' occlara-clip: https://occlara.app" && dir('img-src').join(' ') === "'self' data: https://occlara.app",
      'ITS CSP: media from itself, occlara-clip and the website, pictures from itself, data and the website', csp);
    ok(dir('default-src').join(' ') === "'self'" && !/connect-src|script-src [^;]*https/.test(csp) && dir('base-uri').join() === "'none'" && dir('form-action').join() === "'none'" && dir('object-src').join() === "'none'",
      'and nothing else from the web: no script, no connection, no base, no form, no object');
    ok(['../review/clip-time.js', '../review/clip-player.js', '../review/clip-player.css'].every((f) => html.includes(`"${f}"`)), 'it loads the review\'s own clip player');
  }

  // ── Home's line on the page ─────────────────────────────────────────────
  {
    const rows = [{ id: 'h0', at: day(0), title: 'Jett', map: 'Abyss', result: 'Victory', score: '13-11', grade: { score: 70, letter: 'B' } }];
    let today = { text: "Today's practice: Fight where a teammate can trade, 10 minutes", drill: 'x' };
    const h = loadSurface('home', { handlers: {
      [C.STATE_GET]: () => ({ gameId: 'valorant', isCoaching: false }), [C.CONFIG_GET]: () => ({ language: 'en' }),
      [C.REVIEWS_LIST]: () => rows,
      [C.PATTERNS_GET]: () => ({ matches: 1, enough: false, mistakes: [], strengths: [], missed: [], grades: [], categories: [] }),
      [C.REVIEW_GET]: (id) => ({ id, kind: 'valorant', focus: 'Trade your entry.', grade: { score: 70, letter: 'B', categories: [] } }),
      [C.PRACTICE_TODAY]: () => today,
    } });
    await settle(12);
    ok(!h.$('h-practice').hidden && h.$('h-practice-open').textContent === today.text, 'HOME: the line under the Fix card, main\'s words');
    h.fire(h.$('h-practice-open'), 'click');
    ok(h.bridge.sent.some(([ch, p]) => ch === C.SHELL_NAV && p === 'practice'), 'and it opens the Practice page');
    today = null;
    h.bridge.emit(C.PUSH_PRACTICE, null);
    await settle(10);
    ok(h.$('h-practice').hidden, 'practised today (or mid match, or League): main answers null and the line goes');
  }

  // ── The review's link ───────────────────────────────────────────────────
  {
    const rjs = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'review', 'review.js'), 'utf8');
    const rpre = fs.readFileSync(path.join(ROOT, 'src', 'preload', 'review-preload.js'), 'utf8');
    ok(/Practise this/.test(rjs) && /openPractice/.test(rjs) && /PRACTICE_OPEN/.test(rpre), 'the review\'s Fix card has Practise this, through PRACTICE_OPEN');
  }

  console.log(`\n${checks - fails} of ${checks} checks passed`);
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.log('FAIL  threw', e && e.stack); process.exit(1); });
