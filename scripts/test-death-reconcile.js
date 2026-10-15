'use strict';

/**
 * Checking screen-read deaths against Riot's record.
 *
 * The trap this exists for is comparing the wrong two numbers. Coaching rarely
 * covers a whole match, and one real session ran for nine frames at the start of
 * an eighteen round game in which the player's first death was in round 5.
 * Comparing its 0 detected deaths against the match's 11 would report a
 * catastrophic miss when the detector was exactly right. So the comparison is
 * always against the deaths inside the rounds the session actually watched.
 *
 * Run: npm run test:deathreconcile
 */
const path = require('path');
const { reconcile, summarise, roundsCovered } =
  require(path.join(__dirname, '..', 'src', 'main', 'services', 'death-reconcile.js'));

let fails = 0;
const ok = (cond, what) => { if (!cond) { fails++; console.log(`FAIL  ${what}`); } else console.log(`ok    ${what}`); };

/** Frames carrying a scoreline, which is how the covered rounds are worked out. */
const frames = (rounds) => rounds.map((r) => ({
  state: { teamScore: Math.ceil((r - 1) / 2), enemyScore: Math.floor((r - 1) / 2) },
}));
// The killer by agent, as the server names it since 8.4.1 (coach.js killerAgentOf).
const AGENT_BY_ROUND = ['Jett', 'Sova', 'Omen', 'Sage', 'Reyna', 'Killjoy', 'Viper', 'Cypher', 'Raze'];
const death = (round) => ({ round, killer: AGENT_BY_ROUND[round % AGENT_BY_ROUND.length], weapon: 'Vandal', atMs: 20000 });
const found = (n) => Array.from({ length: n }, (_, i) => ({ at: i * 5 }));

// ── The partial-session trap, taken from a real session ─────────────────────
{
  // Nine frames covering round 1 of an eighteen round match whose first death
  // was in round 5. The detector found nothing and was right.
  const tracker = { rounds: 18, total: 11, deaths: [5, 6, 7, 8, 9, 11, 13, 14, 15, 16, 18].map(death) };
  const r = reconcile([], tracker, frames([1, 1, 1]));
  ok(r.status === 'agrees', `a session that ended before the first death AGREES (got ${r.status})`);
  ok(r.expected === 0, `nothing was expected in the rounds it watched (expected ${r.expected})`);
  ok(r.matchTotal === 11, 'the full match total is still reported');
  ok(r.partial === true, 'and it is flagged as covering only part of the match');
  ok(summarise(r) === "Checked against Riot's record of rounds 1 to 2: the screen read no deaths, and Riot has none either.",
    `the summary says which rounds (${summarise(r)})`);
}

// ── The three real verdicts ─────────────────────────────────────────────────
{
  const tracker = { rounds: 9, total: 7, deaths: [1, 2, 3, 4, 5, 6, 7].map(death) };
  const whole = frames([1, 5, 9]);
  ok(reconcile(found(7), tracker, whole).status === 'agrees', 'equal counts agree');
  ok(reconcile(found(5), tracker, whole).status === 'missed', 'fewer found is a miss');
  ok(reconcile(found(8), tracker, whole).status === 'overcounted', 'more found is an overcount');
  // IN PLAIN ENGLISH, IN THE REVIEW'S WORDS (8.4.1). It said "Riot recorded 3
  // deaths, the coach marked 6, so 3 is not real." on the player's Fracture
  // swiftplay, beside a review saying the screen read 4 deaths.
  const m = reconcile(found(5), tracker, whole);
  ok(summarise(m) === "Checked against Riot's record of the match: the screen read 5 deaths and Riot has 7.",
    `the miss is said as the review says it (${summarise(m)})`);
  const o = reconcile(found(8), tracker, whole);
  ok(summarise(o) === "Checked against Riot's record of the match: the screen read 8 deaths and Riot has 7.",
    `so is the overcount (${summarise(o)})`);
  ok(summarise(reconcile(found(7), tracker, whole)) === "Checked against Riot's record of the match: the screen read 7 deaths and Riot has 7."
    && summarise(reconcile(found(1), { rounds: 9, total: 0, deaths: [] }, whole)) === "Checked against Riot's record of the match: the screen read 1 death, and Riot has none."
    && summarise(reconcile([], tracker, whole)) === "Checked against Riot's record of the match: the screen read no deaths and Riot has 7.",
  'and equal counts, Riot with none, the screen with none: counted, never claimed the same deaths');
  const DASHES = new RegExp('[' + String.fromCharCode(0x2013) + String.fromCharCode(0x2014) + ']');
  const OLD = /\bis not real\b|\bwent unseen\b|\bthe coach marked\b/;
  ok(DASHES.test(`a${String.fromCharCode(0x2014)}b`) && !DASHES.test('a-b')
    && OLD.test('Riot recorded 3 deaths, the coach marked 6, so 3 is not real.') && OLD.test('so 2 went unseen.')
    && !OLD.test("Checked against Riot's record of the match: the screen read 4 deaths and Riot has 3, with none in round 1."),
  'the dash and old sentence detectors match what they look for, and pass over the new line');
  ok(![m, o].some((x) => DASHES.test(summarise(x)) || OLD.test(summarise(x))), 'with no dash, and none of the old sentence');
}

// ── Round by round, for the engine's deaths (8.4.1) ─────────────────────────
// The player's Fracture swiftplay: the engine's ledger filed deaths in rounds
// 1, 2, 5 and 6 of a 6 round match; Riot has 2, 5 and 6. Its records carry the
// round the ledger filed each frame under, and the match's stamp.
{
  const verify = require(path.join(__dirname, '..', 'src', 'shared', 'valorant-verify.js'));
  const M = 1791937491610;
  const ledgerFrames = (from, to, match) => {
    const out = [];
    for (let n = from; n <= to; n++) for (let k = 0; k < 3; k++) out.push({ at: M + n * 100000 + k, round: n, died: false, match: match === undefined ? M : match, state: {} });
    return out;
  };
  const recs = ledgerFrames(1, 6);
  const engine = (rounds) => rounds.map((n) => ({ at: (n - 1) * 3, round: n, registered: true }));
  const riot = { rounds: 6, total: 3, deaths: [
    { round: 2, killer: 'Astra', weapon: 'Sheriff', atMs: 31000 },
    { round: 5, killer: 'Jett', weapon: 'Sheriff', atMs: 33000 },
    { round: 6, killer: 'Chamber', weapon: 'Weapon', atMs: 3000 },
  ] };
  const r = reconcile(engine([1, 2, 5, 6]), riot, recs);
  ok(r.byRound === true && r.status === 'overcounted' && r.detected === 4 && r.expected === 3,
    `the engine's deaths are checked round by round (${r.status}, ${r.detected} against ${r.expected})`);
  ok(summarise(r) === "Checked against Riot's record of the match: the screen read 4 deaths and Riot has 3, with none in round 1.",
    `in the review's own words (${summarise(r)})`);
  // The review's own line, from its own ledger by valorant-verify.js, is the
  // same sentence: the two are one check said once.
  const ledger = [1, 2, 3, 4, 5, 6].map((n) => ({ n, died: [1, 2, 5, 6].includes(n), reads: [], locs: [], frames: 3 }));
  const perRound = [1, 2, 3, 4, 5, 6].map((n) => ({ n, died: [2, 5, 6].includes(n), won: n !== 6 }));
  const review = verify.describe(verify.reconcile(ledger, { perRound }).checks);
  ok(review === summarise(r), `and the review's verification line is that sentence word for word (${review})`);
  ok(JSON.stringify(r.pairs.map((p) => [p.at, p.round, p.killer, p.weapon])) === JSON.stringify([[3, 2, 'Astra', 'Sheriff'], [12, 5, 'Jett', 'Sheriff'], [15, 6, 'Chamber', null]]),
    `each death Riot has is paired by its own frame, a weapon Riot named none for named none (${JSON.stringify(r.pairs)})`);
  ok(JSON.stringify(r.refuted) === JSON.stringify([{ at: 0, round: 1 }]), 'and the one in a round Riot has none in is said to be that one');
  const agree = reconcile(engine([2, 5, 6]), riot, recs);
  ok(agree.status === 'agrees' && summarise(agree) === "Checked against Riot's record of the match: Riot confirms all 3 deaths the screen read.",
    `the same deaths agree (${summarise(agree)})`);
  const miss = reconcile(engine([2, 5]), riot, recs);
  ok(miss.status === 'missed' && summarise(miss) === "Checked against Riot's record of the match: the screen read 2 deaths and Riot has 3, with one in round 6 the screen missed.",
    `a round the screen missed is named (${summarise(miss)})`);
  const both = reconcile(engine([1, 2, 5]), riot, recs);
  ok(both.status === 'overcounted' && summarise(both) === "Checked against Riot's record of the match: the screen read 3 deaths and Riot has 3, with none in round 1 and one in round 6 the screen missed.",
    `equal counts in other rounds are no agreement (${summarise(both)})`);
  // Started in round 3: only the rounds the coach watched.
  const late = reconcile(engine([5, 6]), riot, ledgerFrames(3, 6));
  ok(late.status === 'agrees' && late.partial && summarise(late) === "Checked against Riot's record of the 4 rounds the coach watched: Riot confirms all 2 deaths the screen read.",
    `a session begun in round 3 is checked on the rounds it watched (${summarise(late)})`);
  // Two matches in the records count their rounds each from 1: by counts.
  const two = reconcile(engine([2, 5]), riot, [...ledgerFrames(1, 6), ...ledgerFrames(1, 3, M + 1)]);
  ok(!two.byRound && !two.checks && /^Checked against Riot's record of /.test(summarise(two)), `a session of two matches is checked by its counts (${summarise(two)})`);
  // Deaths found in runs of frames, in a log from before 8.0, carry no ledger round.
  const runs = reconcile([{ at: 0, round: 2 }, { at: 5, round: 5 }], riot, recs);
  ok(!runs.byRound && runs.status === 'missed', 'and so are deaths found in runs of frames, whose round is the score\'s');
  // A match the watch ended at 3 to 5 in round 9 that went on to 5 to 7 under
  // no round (8.0.1's Split session): its frames after the end are its own, in
  // the rounds their scores say, the next match's stamp on them or not.
  const ended = [...ledgerFrames(1, 9), ...[[3, 5], [4, 5], [4, 6], [5, 6], [5, 7]].map(([t, e], k) => (
    { at: M + 2000000 + k * 100000, round: null, died: false, match: M + 1, state: { teamScore: t, enemyScore: e } }))];
  const { ledgerRounds, filedRounds } = require(path.join(__dirname, '..', 'src', 'main', 'services', 'death-reconcile.js'));
  ok(JSON.stringify(ledgerRounds(ended)) === JSON.stringify({ from: 1, to: 13 })
    && JSON.stringify(filedRounds(ended).slice(-2)) === JSON.stringify([{ match: M, round: 12 }, { match: M, round: 13 }]),
  `the rounds it covers reach the last score it read, all of them the match's (${JSON.stringify(ledgerRounds(ended))})`);
  const on = { rounds: 13, total: 4, deaths: [2, 5, 11, 12].map((n) => ({ round: n, killer: 'Sage', weapon: 'Vandal' })) };
  const onR = reconcile(engine([2, 5, 11, 12]), on, ended);
  ok(onR.byRound && onR.status === 'agrees' && summarise(onR) === "Checked against Riot's record of the match: Riot confirms all 4 deaths the screen read.",
    `so its deaths after the end are checked in their own rounds, none refuted for lying past round 9 (${summarise(onR)})`);
}

// ── Pairing ─────────────────────────────────────────────────────────────────
{
  const tracker = { rounds: 9, total: 3, deaths: [2, 5, 8].map(death) };
  const agree = reconcile(found(3), tracker, frames([1, 9]));
  ok(agree.pairs.length === 3, 'agreeing counts are paired in order');
  ok(agree.pairs[1].round === 5 && agree.pairs[1].killer === 'Killjoy',
    'each mark gets the real round and killer');

  // A forced pairing across a mismatch attaches the wrong killer to the wrong
  // moment, which reads as confident detail while being wrong.
  const off = reconcile(found(2), tracker, frames([1, 9]));
  ok(off.pairs.length === 0, 'a mismatch pairs NOTHING rather than guessing');
  ok(off.rounds.join() === '2,5,8', 'but the rounds Riot recorded are still reported');
}

// ── A killer is an agent, never a player's Riot ID (8.4.1) ──────────────────
// The server names the killer in Riot's death check by agent; one from before
// 8.4.1 still sends the killer's full Riot ID, or a puuid, which the AI log
// painted on every death Riot confirmed. Where the check enters the client, a
// killer is an agent the game data knows, or none.
{
  const theirs = [
    { round: 2, killer: 'Foe#NA1', weapon: 'Vandal' },
    { round: 5, killer: '7f3c2a10-9b1e-4c55-8d2a-0e6f4b7a9c31', weapon: 'Phantom' },
    { round: 8, killer: 'kay/o', weapon: 'Ghost' },
  ];
  const killers = (rec) => JSON.stringify(rec.pairs.map((p) => p.killer));
  const byCount = reconcile(found(3), { rounds: 9, total: 3, deaths: theirs }, frames([1, 9]));
  ok(byCount.status === 'agrees' && killers(byCount) === '[null,null,"KAY/O"]',
    `checked by counts, a Riot ID or a puuid is no killer and an agent is the agent (${killers(byCount)})`);
  const M = 1791937491610;
  const recs = [];
  for (let n = 1; n <= 9; n++) for (let k = 0; k < 3; k++) recs.push({ at: M + n * 100000 + k, round: n, died: false, match: M, state: {} });
  const byRound = reconcile([2, 5, 8].map((n) => ({ at: (n - 1) * 3, round: n, registered: true })), { rounds: 9, total: 3, deaths: theirs }, recs);
  ok(byRound.byRound === true && killers(byRound) === '[null,null,"KAY/O"]', `and so round by round (${killers(byRound)})`);
  ok(!/Foe|NA1|7f3c2a10/.test(JSON.stringify([byCount, byRound, summarise(byCount), summarise(byRound)])),
    'no player\'s name, tag or puuid is anywhere in the check');
}

// ── The scoreboard lags, so the window has slack ────────────────────────────
{
  // Three deaths verified against screenshots all carried a score one round
  // behind the screenshot, so a death on the edge must not be called missing.
  const tracker = { rounds: 9, total: 1, deaths: [death(6)] };
  const r = reconcile(found(1), tracker, frames([1, 5]));   // read only up to round 5
  ok(r.status === 'agrees', 'a death one round past the last readable score still counts');
}

// ── Degenerate input ────────────────────────────────────────────────────────
ok(reconcile(found(3), null, frames([1])).status === 'unavailable', 'no tracker data is unavailable, not a miss');
ok(reconcile(found(3), {}, frames([1])).status === 'unavailable', 'an empty tracker reply is unavailable too');
ok(summarise({ status: 'unavailable' }) === '', 'and it says nothing rather than something wrong');
ok(roundsCovered([]) === null, 'a session with no readable score has no round span');
{
  // No readable scoreboard anywhere: the whole match is the window, and the
  // verdict must not pretend to know which part was watched.
  const tracker = { rounds: 9, total: 2, deaths: [death(3), death(7)] };
  const r = reconcile(found(2), tracker, [{ state: {} }, { state: {} }]);
  ok(r.status === 'agrees' && r.covered === null, 'an unreadable scoreboard compares against the whole match');
}

// ── The cache remembers answers and forgets failures ────────────────────────
{
  const { makeCheckCache } = require(path.join(__dirname, '..', 'src', 'main', 'services', 'death-reconcile.js'));
  let clock = 1000;
  const cache = makeCheckCache(3 * 60 * 1000, () => clock);

  cache.remember('s1', { status: 'agrees', expected: 4 });
  clock += 60 * 60 * 1000;                       // an hour later
  ok(cache.get('s1').status === 'agrees', 'a settled result is kept, since a finished match never changes');

  // THE BUG THIS EXISTS FOR. The tracker takes a minute or two to index a match
  // after it ends, and the session a player opens first is the one they just
  // played. Remembering the failure forever meant checking once, seconds too
  // early, and never again.
  cache.remember('s2', { status: 'unavailable', why: 'no tracker match lines up with this session' });
  clock += 1000;
  ok(cache.get('s2') !== null, 'a failure is remembered briefly, so reopening does not hammer the tracker');
  clock += 3 * 60 * 1000;
  ok(cache.get('s2') === null, 'but it EXPIRES, so a match indexed late is still found');

  ok(cache.get('never asked') === null, 'an unknown key is a miss');
}

console.log(fails ? `\n${fails} failure(s)` : '\nall death reconcile checks passed');
process.exit(fails ? 1 : 0);
