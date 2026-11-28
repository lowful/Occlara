'use strict';

/**
 * WHERE THE MATCH RATING IS SAVED AND SERVED (docs/claude/rating.md): on the
 * real Abyss match, the review built at the match's end with Riot's record
 * laid over it, the one graded from Riot's record alone (the backfill), the
 * late link's upgrade in place and an import's build all save a rating with
 * its version; a review from the screen alone saves none and is served the
 * line that says what would give it one; a review saved before ratings is
 * rated on open from its cards, written nowhere and its grade untouched; a
 * saved rating is served as saved; a locked review and League get none; and
 * nothing served names anyone, the lobby being sides, agents and numbers.
 *
 * Pure node, no window. Run: npm run test:ratingwiring
 */
const fs = require('fs');
const path = require('path');

const FIX = path.join(__dirname, 'fixtures');
const load = (n) => JSON.parse(fs.readFileSync(path.join(FIX, n), 'utf8'));
const rating = require('../src/shared/rating');
const valorantReview = require('../src/shared/valorant-review');
const verify = require('../src/shared/valorant-verify');
const riotReview = require('../src/shared/riot-review');
const { replay } = require('./fixtures/replay-match');
const proof = require('./fixtures/proof-reviews');

let checks = 0;
let fails = 0;
const ok = (cond, what) => {
  checks++;
  if (!cond) { fails++; console.log(`FAIL  ${what}`); } else console.log(`ok    ${what}`);
};

const riot = load('riot-abyss-13-11.json');
const played = replay(load('valorant-match-abyss-13-11.json').frames, 'standard');
const ROW = { matchId: 'abyss-1', map: 'Abyss', agent: 'Jett', mode: 'Unrated', result: 'Victory', score: '13-11',
  kills: 31, deaths: 21, assists: 4, kd: 1.48, acs: 382, adr: 243, headshotPct: 25, startedAt: Date.parse('2026-09-20T18:00:00Z') };
const TRACKER = { matchId: 'abyss-1', map: 'Abyss', agent: 'Jett', mode: 'Unrated', result: 'Victory', score: '13-11' };

const savedShape = (r) => !!r && typeof r.version === 'number' && r.version === rating.VERSION && typeof r.value === 'number'
  && r.value >= 0 && r.value <= 10 && Array.isArray(r.timeline) && r.timeline.length > 0 && r.rounds > 0;

console.log('\nSaved where Riot\'s record is laid over the review');
let linked;
{
  const { rounds } = verify.reconcile(played.rounds, riot);
  linked = valorantReview.build({ rounds, context: { ...played.context, agent: 'Jett' }, endedBy: 'score', ai: {},
    tracker: TRACKER, role: 'Duelist', history: [], queue: 'unrated' });
  ok(savedShape(linked.rating), `the match end with Riot's record linked saves a rating (${linked.rating && linked.rating.value}, version ${linked.rating && linked.rating.version})`);
  const direct = rating.fromRecord({ rounds: rating.roundsOfReview(linked), queue: 'Unrated', meAgent: 'Jett' }).rating;
  ok(JSON.stringify(direct) === JSON.stringify(linked.rating), 'and it is the engine run over the review\'s own cards');
  ok(linked.rating.place === null && linked.rating.lobby === null, 'a feed that names no agent gives no place and no lobby');
  ok(linked.rating.timeline.every((e) => e.round >= 1 && e.round <= 24 && typeof e.label === 'string' && e.label), 'each event has its round and a plain label');

  const { review: fromRiot } = riotReview.fromRiot({ row: ROW, riot, history: [], account: 'Me#EUW' });
  ok(savedShape(fromRiot.rating), `a review graded from Riot's record alone (the backfill) saves one too (${fromRiot.rating.value})`);

  const snap = { ...played, startedAt: ROW.startedAt - 60000, endedAt: ROW.startedAt + 24 * riotReview.ROUND_MS + 60000 };
  const screen = valorantReview.build({ rounds: played.rounds, context: played.context, endedBy: 'score', ai: {}, role: 'Duelist', history: [] });
  ok(!('rating' in screen), 'a review from the screen alone saves none');
  screen.ledger = valorantReview.ledgerOf(snap);
  screen.id = 'valorant-1758391200000-abcdef';
  screen.at = snap.endedAt;
  const { review: up } = riotReview.upgradeWatched({ saved: { id: screen.id, at: screen.at, review: screen }, row: ROW, riot, history: [] });
  ok(savedShape(up.rating), `the late link's upgrade in place saves one (${up.rating.value})`);
  ok(JSON.stringify(up.grade) !== undefined && typeof up.grade.score === 'number', 'and grades as it always did');

  // An import that matched is built through the same build (index.js
  // buildValorantReview with snap.importRun): the same cards, the same rating.
  const imported = { ...valorantReview.build({ rounds: verify.reconcile(played.rounds, riot).rounds, context: { ...played.context, agent: 'Jett' }, endedBy: 'score', ai: {},
    tracker: TRACKER, role: 'Duelist', history: [], queue: 'unrated' }), imported: true };
  ok(JSON.stringify(imported.rating) === JSON.stringify(linked.rating), 'an import that matched saves the same one');

  // The grade is not touched by the rating: with the rating module stubbed
  // out, the same build grades byte for byte the same, and saves no rating.
  const real = rating.ratingOfReview;
  rating.ratingOfReview = () => ({ rating: null, why: 'stub', note: null });
  let without;
  try {
    without = valorantReview.build({ rounds: verify.reconcile(played.rounds, riot).rounds, context: { ...played.context, agent: 'Jett' },
      endedBy: 'score', ai: {}, tracker: TRACKER, role: 'Duelist', history: [], queue: 'unrated' });
  } finally { rating.ratingOfReview = real; }
  ok(!('rating' in without) && JSON.stringify(without.grade) === JSON.stringify(linked.grade) && JSON.stringify(without.insights) === JSON.stringify(linked.insights),
    `the grade and the lists are the same with the rating stubbed out (${linked.grade.score})`);
}

console.log('\nServed to the page');
{
  const shown = valorantReview.served({ ...linked, id: 'valorant-1-a' });
  const v = shown.ratingView;
  ok(v && v.value === linked.rating.value && v.shown === String(Math.round(linked.rating.value * 10)), `the page is sent the saved value, shown on the 100 scale (${v && v.shown})`);
  ok(v.line.length === 25 && v.line[0].value === 6 && v.line[24].value === v.value, 'a line from 6.0 at round 0 to the final at round 24');
  ok(v.gains.length === 3 && v.losses.length === 3 && v.gains.every((e) => /^\+\d+$/.test(e.delta)) && v.losses.every((e) => /^-\d+$/.test(e.delta)),
    `three gains and three losses, each a signed move on the 100 scale (${v.gains.map((e) => e.delta).join(' ')} / ${v.losses.map((e) => e.delta).join(' ')})`);
  ok(v.events.length === linked.rating.timeline.length, 'every event for the replay');
  ok(!('ratingView' in linked), 'the view is never written onto the review held');

  // A rating saved under an older version is shown as it was saved.
  const old = { ...linked, rating: { ...linked.rating, version: 0, value: 7.7 } };
  ok(valorantReview.served(old).ratingView.value === 7.7 && valorantReview.served(old).ratingView.version === 0, 'a saved rating is shown as saved, whatever its version');

  // A review saved before ratings: counted on open, written nowhere, its grade untouched.
  const before = JSON.parse(JSON.stringify(linked));
  delete before.rating;
  const frozen = JSON.stringify(before);
  const onOpen = valorantReview.served(before);
  ok(onOpen.ratingView && onOpen.ratingView.value === linked.rating.value, `a review saved before ratings is rated on open (${onOpen.ratingView && onOpen.ratingView.shown})`);
  ok(JSON.stringify(before) === frozen && !('rating' in before), 'and nothing is written back to it');
  ok(onOpen.grade.score === before.grade.score, 'and its grade is the one it was saved with');

  // A review saved before the feed was kept: the line that says why.
  const noFeed = JSON.parse(frozen);
  for (const c of noFeed.rounds) if (c.riot) delete c.riot.feed;
  const nf = valorantReview.served(noFeed).ratingView;
  ok(nf && nf.value === null && /^Saved before Occlara kept Riot's kill feed/.test(nf.note), `one saved before the kill feed was kept says so ("${nf && nf.note}")`);

  // The screen alone: what would rate it.
  const screen = valorantReview.build({ rounds: played.rounds, context: played.context, endedBy: 'score', ai: {}, role: 'Duelist', history: [] });
  const sv = valorantReview.served(screen).ratingView;
  ok(sv && sv.value === null && /Riot's record/.test(sv.note), `a screen only review says what would rate it ("${sv && sv.note}")`);

  // Locked, and League.
  const locked = valorantReview.served({ ...linked, locked: true });
  ok(!('ratingView' in locked) && !('rating' in locked), 'a locked review is sent no view and not the saved rating');
  ok(!('rating' in shown) && !('rating' in valorantReview.served({ kind: 'lol', rating: { version: 1, value: 7 } })), 'no review sends the saved rating, its timeline or its lobby, only the view');
  ok(valorantReview.served({ kind: 'lol', game: { champion: 'Ahri' } }).ratingView === undefined, 'League is sent none');
}

console.log('\nThe sample library ranks all ten, by agent only');
{
  const b = proof.build({ now: 1e12 });
  const r = b.built.rating;
  ok(savedShape(r) && r.place && r.place.of === 10 && r.lobby.length === 10, `the sample's newest match is ${rating.placeLine(r.place)} (${r.value})`);
  ok(r.lobby.every((p) => Object.keys(p).sort().join() === 'agent,me,side,value' && typeof p.agent === 'string'), 'each of the ten is a side, an agent and a value');
  const view = valorantReview.served({ ...b.built, id: 'valorant-1-b' }).ratingView;
  const text = JSON.stringify(view);
  ok(!/#/.test(text) && !/puuid|name|tag/i.test(Object.keys(view).join() + view.lobby.map((p) => Object.keys(p).join()).join()), 'nothing served carries a Riot ID, a name or a tag');
  const DASHES = new RegExp('[' + String.fromCharCode(0x2013, 0x2014) + ']');
  ok(!DASHES.test(text) && DASHES.test(String.fromCharCode(0x2014)), 'nor a dash');
}

console.log('\nNothing mid match: no channel of its own');
{
  const channels = require('../src/shared/channels');
  // One named exception, 9.1: LIVE_RATING_SET, the live rating's switch beside
  // Start on Home, a boolean written from Home to main and never a rating
  // carried to a window (test:recordingview, test:configset hold it).
  const SWITCH_ONLY = ['LIVE_RATING_SET'];
  ok(!Object.keys(channels).some((k) => /RATING/.test(k) && !SWITCH_ONLY.includes(k)) && !channels.PUSH_LIST.includes(channels.LIVE_RATING_SET),
    'the rating rides the review, which is sealed mid match, and adds no channel (the live rating\'s switch on Home writes a boolean, and carries none)');
}

console.log(`\n${fails ? fails + ' of ' + checks + ' failed' : 'all ' + checks + ' rating wiring checks passed'}`);
process.exit(fails ? 1 : 0);
