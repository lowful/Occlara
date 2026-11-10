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
