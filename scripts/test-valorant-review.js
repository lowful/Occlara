'use strict';

/**
 * The Valorant post-match review: the round ledger, the match-end watch, the
 * computed review, and the server half that parses the model's reply. And the
 * deaths a review Riot's record never reached is looked at by (8.2), with the
 * frames of the real match each look is sent, and how long they are held.
 *
 * THE TWO MATCHES BELOW ARE REAL, from the AI decision log, trimmed to the
 * model's STATE reads with no frames and no player names. The 24 round Abyss
 * match is the one that found both ledger bugs recorded in valorant-rounds.js:
 * the score lagging a new round (a death filed under the round before, then
 * dropped because that round already had one) and the round end banner
 * printing the next score early (a death filed a round late). Every assertion
 * about a specific round below was checked by hand against the logged frames.
 *
 * Run: npm run test:valorantreview
 */

const { replay, load } = require('./fixtures/replay-match');
const { RoundLedger } = require('../src/shared/valorant-rounds');
const { MatchEndWatch, isFinalScore } = require('../src/shared/match-end');
const review = require('../src/shared/valorant-review');
const matchReview = require('../server/services/match-review');
const verify = require('../src/shared/valorant-verify');
const { metaOf } = require('../src/main/services/review-store');
const { roleOf } = require('../src/shared/agent-roles');

let fails = 0;
let checks = 0;
const ok = (cond, what) => {
  checks++;
  if (!cond) { fails++; console.log(`FAIL  ${what}`); } else console.log(`ok    ${what}`);
};

// ── Final scores ────────────────────────────────────────────────────────────
ok(isFinalScore(13, 11, 'standard'), '13 to 11 ends a standard match');
ok(isFinalScore(11, 13, null), 'a 13 ends a match even with the mode unknown, swiftplay never reaches it');
ok(!isFinalScore(13, 12, 'standard'), '13 to 12 is NOT final, unrated ends there and competitive does not');
ok(isFinalScore(14, 12, 'standard'), 'overtime won by two is final');
ok(!isFinalScore(15, 12, 'standard'), 'a three round overtime lead cannot happen, so it is a misread, not an end');
ok(!isFinalScore(5, 3, 'standard'), 'a standard match passes through 5 to 3');
ok(!isFinalScore(5, 3, null), 'and with the mode unknown 5 to 3 is not trusted either');
ok(isFinalScore(5, 3, 'swiftplay') && isFinalScore(4, 5, 'swiftplay'), 'swiftplay ends at 5, sudden death included');

// ── The watch: a final score waits for the game to stop ─────────────────────
{
  const w = new MatchEndWatch();
  w.play({ team: 12, enemy: 10, mode: 'standard', at: 1000 });
  ok(w.play({ team: 13, enemy: 10, mode: 'standard', at: 11000 }) === null,
    'one final score read does not end the match on its own');
  ok(w.play({ team: 12, enemy: 11, mode: 'standard', at: 21000 }) === null && !w.pendingFinal,
    'and play continuing at a score that is not final cancels it, that read was a misread');
  w.play({ team: 13, enemy: 11, mode: 'standard', at: 31000 });
  ok(w.play({ team: 13, enemy: 11, mode: 'standard', at: 33000 }) === null,
    'two reads two seconds apart are one moment read twice, not a confirmation');
  const e = w.play({ team: 13, enemy: 11, mode: 'standard', at: 52000 });
  ok(e && e.kind === 'end' && e.reason === 'score', 'twenty seconds at the final score with nothing played ends it');
  ok(w.play({ team: 13, enemy: 11, mode: 'standard', at: 62000 }).kind === 'ignore',
    'the end screen still shows the final score and a HUD, and is not recorded');
  ok(w.play({ team: 0, enemy: 0, mode: null, scoreRead: false, at: 300000 }).kind === 'ignore',
    "a frame with no score of its own carries the engine's held copy of the end, and starts nothing");
  ok(w.play({ team: 0, enemy: 0, mode: null, at: 400000 }).kind === 'new-match',
    'a lower score read on its own frame is the next match');
}
{
  const w = new MatchEndWatch();
  w.play({ team: 12, enemy: 11, mode: 'standard', at: 0 });
  w.play({ team: 13, enemy: 11, mode: 'standard', at: 10000 });
  const e = w.lobby({ at: 12000, rounds: 24 });
  ok(e && e.kind === 'end' && e.reason === 'score', 'a final read followed by a menu ends it at once');
}
{
  const w = new MatchEndWatch();
  w.play({ team: 12, enemy: 10, mode: 'standard', at: 0 });
  w.play({ team: 13, enemy: 10, mode: 'standard', phase: 'active', clock: '0:02', at: 2000 });
  ok(w.play({ team: 13, enemy: 10, mode: 'standard', phase: 'buy', clock: '0:24', at: 9000 }) === null && !w.pendingFinal,
    'a buy phase at a final score is the next round being bought, so that 13 was a misread');
  w.play({ team: 13, enemy: 10, mode: 'standard', phase: 'active', clock: '1:05', at: 30000 });
  ok(w.play({ team: 13, enemy: 10, mode: 'standard', phase: 'active', clock: '1:05', at: 32000 }) === null && !!w.pendingFinal,
    'a clock frozen on the round end banner is not play');
  ok(w.play({ team: 13, enemy: 10, mode: 'standard', phase: 'dead', clock: '0:58', at: 39000 }) === null && !w.pendingFinal,
    'a round clock still counting down is a round still being played');
  ok(!w.play({ team: 13, enemy: 10, mode: 'standard', phase: 'buy', clock: '1:34', at: 41000 }) && !!w.pendingFinal,
    'a "buy" read with the round timer on it is not a buy phase');
}

// ── The watch: swiftplay needs the menu, twice ─────────────────────────────
{
  const w = new MatchEndWatch();
  w.play({ team: 3, enemy: 4, mode: 'swiftplay', at: 0 });
  for (let t = 2000; t <= 60000; t += 2000) w.play({ team: 3, enemy: 5, mode: 'swiftplay', phase: 'dead', at: t });
  ok(!w.ended, 'a minute at 3 to 5 does not end a swiftplay on time, 5 to 3 is an ordinary standard score');
  ok(w.lobby({ at: 62000, rounds: 8 }) === null, 'one menu frame does not, an alt tab looks like that');
  const e = w.lobby({ at: 64000, rounds: 8 });
  ok(e && e.kind === 'end' && e.reason === 'score', 'two menu frames in a row do');
}
{
  // THE REAL FAILURE: a competitive match with swiftplay wrongly locked, 3 to 5
  // read twice two seconds apart at the end of round 8, then round 9 bought.
  const w = new MatchEndWatch();
  w.play({ team: 3, enemy: 4, mode: 'swiftplay', at: 0 });
  w.play({ team: 3, enemy: 5, mode: 'swiftplay', phase: 'dead', clock: '0:03', at: 1000 });
  ok(w.play({ team: 3, enemy: 5, mode: 'swiftplay', phase: 'dead', at: 3000 }) === null,
    'the two reads that opened a review over round 9 no longer end anything');
  ok(w.play({ team: 3, enemy: 5, mode: 'swiftplay', phase: 'buy', clock: '0:20', at: 11000 }) === null && !w.pendingFinal,
    'and the buy phase of round 9 clears the pending end');
  w.lobby({ at: 13000, rounds: 8 });
  w.lobby({ at: 15000, rounds: 8 });
  ok(!w.ended, 'so an alt tab during that buy phase cannot end it either');
}

// ── The watch: a match that was not over resumes ───────────────────────────
{
  const w = new MatchEndWatch();
  w.play({ team: 3, enemy: 4, mode: 'swiftplay', map: 'Split', at: 0 });
  w.play({ team: 3, enemy: 5, mode: 'swiftplay', map: 'Split', phase: 'dead', at: 2000 });
  w.lobby({ at: 4000, rounds: 8 });
  w.lobby({ at: 6000, rounds: 8 });
  ok(w.ended && w.ended.reason === 'score', 'an alt tab right at the round end still ends it, the case resume exists for');
  ok(w.play({ team: 3, enemy: 5, mode: 'swiftplay', map: 'Split', phase: 'buy', clock: '0:20', scoreRead: false, at: 9000 }).kind === 'ignore',
    'a buy phase on the held score proves nothing');
  ok(w.play({ team: 3, enemy: 5, mode: 'swiftplay', map: 'Split', phase: 'buy', clock: '0:18', at: 11000 }).kind === 'ignore',
    'one buy phase read at the ended score waits for a second');
  const r = w.play({ team: 3, enemy: 5, mode: 'swiftplay', map: 'Split', phase: 'buy', clock: '0:16', at: 13000 });
  ok(r && r.kind === 'resume' && r.from === 'score' && !w.ended, 'two of them resume the same match');
}
{
  const w = new MatchEndWatch();
  w.play({ team: 3, enemy: 4, mode: 'swiftplay', at: 0 });
  w.play({ team: 3, enemy: 5, mode: 'swiftplay', phase: 'dead', at: 2000 });
  w.lobby({ at: 4000, rounds: 8 }); w.lobby({ at: 6000, rounds: 8 });
  w.play({ team: 4, enemy: 5, mode: 'standard', phase: 'dead', at: 100000 });
  const r = w.play({ team: 4, enemy: 5, mode: 'standard', phase: 'active', clock: '1:20', at: 102000 });
  ok(r && r.kind === 'resume', 'a score past the end, read twice, resumes it too');
}
{
  const w = new MatchEndWatch();
  w.play({ team: 7, enemy: 5, map: 'Bind', at: 0 });
  for (let i = 1; i <= 5; i++) w.lobby({ at: i * 12000, rounds: 12 });
  ok(w.ended && w.ended.reason === 'lobby', 'a crash to the menu ends the match on the menu path');
  w.play({ team: 7, enemy: 5, map: 'Bind', phase: 'buy', clock: '0:25', at: 150000 });
  const r = w.play({ team: 7, enemy: 5, map: 'Bind', phase: 'buy', clock: '0:23', at: 152000 });
  ok(r && r.kind === 'resume' && r.from === 'lobby', 'and reconnecting to it resumes the same match');
}
{
  const w = new MatchEndWatch();
  w.play({ team: 7, enemy: 5, map: 'Bind', at: 0 });
  for (let i = 1; i <= 5; i++) w.lobby({ at: i * 12000, rounds: 12 });
  ok(w.play({ team: 7, enemy: 6, map: 'Haven', phase: 'buy', clock: '0:25', at: 150000 }).kind === 'new-match',
    'the same score on another map is not the same match');
  const v = new MatchEndWatch();
  v.play({ team: 7, enemy: 5, map: 'Bind', at: 0 });
  for (let i = 1; i <= 5; i++) v.lobby({ at: i * 12000, rounds: 12 });
  ok(v.play({ team: 7, enemy: 5, map: 'Bind', phase: 'buy', clock: '0:25', at: 60000 + 6 * 60000 }).kind === 'new-match',
    'nor is play six minutes after the end');
  const x = new MatchEndWatch();
  x.play({ team: 12, enemy: 10, at: 0 });
  x.play({ team: 13, enemy: 10, at: 2000 });
  x.lobby({ at: 4000, rounds: 23 });
  ok(x.play({ team: 0, enemy: 0, phase: 'buy', clock: '0:40', at: 120000 }).kind === 'new-match',
    'a real end is followed by a 0 to 0 buy phase, which is the next match, not a resume');
}

// ── The watch: the menu path ────────────────────────────────────────────────
{
  const w = new MatchEndWatch();
  w.play({ team: 3, enemy: 2, mode: null, at: 0 });
  ok(w.lobby({ at: 10000, rounds: 6 }) === null && w.lobby({ at: 20000, rounds: 6 }) === null
    && w.lobby({ at: 30000, rounds: 6 }) === null,
    'three menu frames inside 45 seconds do not end it, an alt tab in a buy phase looks like this');
  const e = w.lobby({ at: 50000, rounds: 6 });
  ok(e && e.kind === 'end' && e.reason === 'lobby', 'most of a minute of menus does');
  ok(w.play({ team: 3, enemy: 2, mode: null, at: 60000 }).kind === 'ignore',
    'after a menu end, play at the same score waits: it may be the same match coming back');
  ok(w.play({ team: 0, enemy: 0, mode: null, at: 62000 }).kind === 'new-match',
    'and a lower score read on its own frame is the next match');
}
{
  // A crash or a long alt tab in a buy phase ends the match on the menu path,
  // and the player comes back mid round at the same score: the same match.
  const w = new MatchEndWatch();
  w.play({ team: 5, enemy: 3, map: 'Bind', phase: 'buy', clock: '0:20', at: 0 });
  for (let i = 1; i <= 5; i++) w.lobby({ at: i * 12000, rounds: 8 });
  ok(w.ended && w.ended.reason === 'lobby', 'a reconnect starts with the menu path ending the match');
  ok(w.play({ team: 5, enemy: 3, map: 'Bind', phase: 'active', clock: '1:05', at: 90000 }).kind === 'ignore',
    'one live round read at the ended score waits for a second');
  const r = w.play({ team: 5, enemy: 3, map: 'Bind', phase: 'active', clock: '1:03', at: 92000 });
  ok(r && r.kind === 'resume' && r.from === 'lobby', 'two of them resume it, mid round');
}
{
  const w = new MatchEndWatch();
  w.play({ team: 0, enemy: 1, mode: null, at: 0 });
  for (let i = 1; i <= 8; i++) w.lobby({ at: i * 10000, rounds: 2 });
  ok(!w.ended, 'two rounds is not a match worth reviewing, however long the menu');
}

// ── The real 24 round match ─────────────────────────────────────────────────
const abyss = replay(load('valorant-match-abyss-13-11.json').frames, 'standard');
const byN = new Map(abyss.rounds.map((r) => [r.n, r]));
{
  ok(abyss.endedBy === 'score', `the 13 to 11 match ends on its score (${abyss.endedBy})`);
  ok(abyss.rounds.length === 24, `24 rounds, not a phantom 25th from the final read (${abyss.rounds.length})`);
  const won = abyss.rounds.filter((r) => r.result === 'won').length;
  const lost = abyss.rounds.filter((r) => r.result === 'lost').length;
  ok(won === 13 && lost === 11, `every round's result follows from the score (${won} won, ${lost} lost)`);
  ok(byN.get(1).result === 'won' && !byN.get(1).died, 'round 1 won, no death seen');
  ok(byN.get(2).died && byN.get(2).deathSpot === 'A Site',
    'round 2 death at A Site, not moved a round late by the round 1 banner');
  ok(byN.get(6).died && byN.get(6).deathClock === null,
    'round 6 death caught on the banner that already showed the round 7 score, filed back with NO timing');
  ok(byN.get(7).died && byN.get(7).deathSpot === 'A Site',
    "round 7 keeps its own death rather than losing it to round 6's");
  ok(byN.get(13).died && byN.get(13).deathSpot === 'A Lobby',
    'round 13 death while the score still read round 12, filed forward by the buy phase');
  ok(byN.get(13).side === 'attacking' && byN.get(12).side === 'defending', 'halftime flips the side at 12');
  ok(byN.get(21).planted && !byN.get(21).died, 'round 21 has the plant and no death');
  const deathReads = abyss.rounds.flatMap((r) => r.reads.filter((x) => x.death).map((x) => ({ n: r.n, x })));
  ok(deathReads.every(({ n }) => byN.get(n).died),
    'every death review is filed in a round that had a death, not the buy phase it landed in');
  ok(abyss.rounds.every((r) => r.reads.length <= 3), 'at most three reads per round');
}

// ── Patterns clear their bars ───────────────────────────────────────────────
{
  const pats = review.patterns(abyss.rounds);
  const keys = pats.map((p) => p.key);
  ok(keys.includes('early') && keys.includes('sides'), `the real match yields early deaths and a side split (${keys.join(', ')})`);
  const spotReal = pats.find((p) => p.key === 'spot');
  ok(spotReal && /^6 of your 22 deaths were at A Site/.test(spotReal.text),
    `and 6 of 22 deaths at A Site, matching the frames (${spotReal && spotReal.text})`);
  ok(pats.every((p) => !/[\u2013\u2014]/.test(p.text)), 'no pattern text carries a dash');
  const side = pats.find((p) => p.key === 'sides');
  ok(side && side.text === 'Neither side was clearly stronger: won 6 of 12 on attack and 7 of 12 on defence.',
    `side split is exact, and one round between the sides names no stronger side (${side && side.text})`);

  const mk = (n, extra) => ({ n, side: 'defending', result: 'lost', died: false, deathSpot: null, deathClock: null,
    early: false, ultAtDeath: null, planted: false, plantSpot: null, reads: [], frames: 3, ...extra });
  const scattered = [mk(1, { died: true, deathSpot: 'A Site' }), mk(2, { died: true, deathSpot: 'B Main' }),
    mk(3, { died: true, deathSpot: 'Mid' }), mk(4, { died: true, deathSpot: 'A Link' }),
    mk(5, { died: true, deathSpot: 'B Site' }), mk(6, { died: true, deathSpot: 'A Site' }),
    mk(7, { died: true, deathSpot: 'Mid Top' })];
  ok(!review.patterns(scattered).some((p) => p.key === 'spot'),
    'two deaths at one spot out of seven is not a pattern, it is under 30%');
  const repeat = scattered.slice(0, 3).concat([mk(4, { died: true, deathSpot: 'A Site' })]);
  const spot = review.patterns(repeat).find((p) => p.key === 'spot');
  ok(spot && spot.text.startsWith('2 of your 4 deaths were at A Site'), `two of four at one spot is (${spot && spot.text})`);
  const charging = [mk(1, { died: true, ultAtDeath: 'charging' }), mk(2), mk(3)];
  ok(!review.patterns(charging).some((p) => p.key === 'ult'), 'a charging ult at death is never reported as held');
  const ready = [mk(1, { died: true, ultAtDeath: 'ready' }), mk(2), mk(3)];
  ok(review.patterns(ready).some((p) => p.key === 'ult'), 'a confirmed ready ult at death is');
  ok(review.patterns(ready.slice(0, 2)).length === 0, 'under three rounds, no patterns at all');
}

// ── The built review ────────────────────────────────────────────────────────
{
  const rv = review.build({ rounds: abyss.rounds, context: abyss.context, endedBy: 'score' });
  ok(rv.kind === 'valorant' && rv.game.result === 'Victory' && rv.game.score === '13-11',
    'a score end claims the result');
  ok(rv.halftimeAfter === 12, 'halftime drawn after round 12');
  const facts = rv.rounds.flatMap((c) => c.facts);
  ok(!facts.some((f) => /surviv/i.test(f)), 'no round claims survival, the ledger cannot know it');
  ok(!facts.some((f) => /\d+ seconds/.test(f)), 'no death timing to the second, only a bucket');
  ok(rv.rounds.find((c) => c.n === 2).facts[0] === 'Died at A Site, early in the round', 'round 2 reads as a person would say it');
  const stopped = review.build({ rounds: abyss.rounds, context: abyss.context, endedBy: 'stop' });
  ok(stopped.game.result === null && stopped.game.score === '13-11',
    'a stopped session shows the score it read but does not claim a result');
  // Not "before the match ended": from the screen alone, Stop pressed on the
  // end screen of a match the watch had not ended looks exactly like this.
  ok(stopped.refused.some((t) => t === 'Coaching was stopped before the coach saw the match end, so this covers the rounds it watched.'),
    'and says why, claiming only what the screen knows');
  const tracked = review.build({ rounds: abyss.rounds, context: abyss.context, endedBy: 'stop',
    tracker: { result: 'Defeat', score: '11-13', kills: 10, deaths: 17, assists: 4, acs: 180, adr: 120, headshotPct: 20, kd: 0.59 } });
  ok(tracked.game.result === 'Defeat' && tracked.scoreline.acs === 180, "Riot's verified record outranks the screen");
}

// ── Against your own average, role scoped ───────────────────────────────────
{
  const t = { acs: 250, adr: 150, kd: 1.2, headshotPct: 25 };
  const hist = [
    { role: 'duelist', acs: 200, adr: 130, kd: 1, headshotPct: 20 },
    { role: 'duelist', acs: 220, adr: 140, kd: 1.1, headshotPct: 22 },
    { role: 'controller', acs: 150, adr: 100, kd: 0.8, headshotPct: 18 },
  ];
  ok(review.against(t, 'duelist', hist).length === 0, 'two matches in the role is not a baseline, the controller game does not count');
  hist.push({ role: 'duelist', acs: 240, adr: 150, kd: 1.2, headshotPct: 24 });
  const rows = review.against(t, 'duelist', hist);
  const acs = rows.find((r) => r.label === 'ACS');
  ok(acs && acs.baseline === 220 && acs.delta === 30 && acs.better === true, `ACS against the duelist average (${acs && JSON.stringify(acs)})`);
  ok(review.historyEntry({ result: 'Victory' }, 'duelist') === null, 'no tracker numbers, no history row');
}

// ── What the server is sent ─────────────────────────────────────────────────
{
  const body = review.requestBody({ rounds: abyss.rounds, context: { ...abyss.context, agent: 'Jett' }, endedBy: 'score' });
  ok(body.rounds.length === 24 && body.final.result === 'Victory', 'the body carries every round and the result');
  ok(body.rounds.find((r) => r.n === 2).timing === 'early', 'timing goes as a bucket');
  ok(body.rounds.find((r) => r.n === 6).timing === null, 'and a banner death sends none');
  const input = matchReview.normalise(body);
  ok(input.rounds.length === 24 && input.variant === matchReview.DEFAULT_VARIANT, 'the server accepts it whole');
  const prompt = matchReview.buildPrompt(input);
  ok(/R13 attack, lost\. died at A Lobby/.test(prompt), 'round 13 reaches the prompt as the ledger has it');
  ok(!/[\u2013\u2014]/.test(prompt), 'the prompt carries no dash for the model to copy');
  ok(/COACHING KNOWLEDGE/.test(prompt) && /never say where it comes from/i.test(prompt),
    'the knowledge comes with the rule that the review never says where it comes from');
  ok(!/\bVOD\b/i.test(prompt) && /\bVOD\b/i.test('from pro VOD reviews'), 'and the prompt names no VOD review behind it');
}

// ── The server parses the reply, and refuses rounds it was never sent ───────
{
  const input = matchReview.normalise({ rounds: [{ n: 2, died: true }, { n: 7, died: true }], variant: 'C' });
  const p = matchReview.parse('**SUMMARY:** First. Second.\nThird.\n\nR2: Because the team was not there.\nR9: Invented round.\nR 7. Late rotate.\nFOCUS: Wait for the trade.', input);
  ok(p.summary === 'First. Second. Third.', `a summary that runs onto a second line is kept whole (${p.summary})`);
  ok(p.rounds[2] === 'Because the team was not there.' && p.rounds[7] === 'Late rotate.', 'round lines parse, bold and spacing tolerated');
  ok(!(9 in p.rounds), 'a round the ledger never sent is dropped, not painted');
  ok(p.focus === 'Wait for the trade.', 'focus parses');
  const a = matchReview.parse('One. Two. Three.', matchReview.normalise({ rounds: [{ n: 1 }], variant: 'A' }));
  ok(a.summary === 'One. Two. Three.', 'variant A is prose, and all of it is the summary');
  const huge = matchReview.normalise({ rounds: Array.from({ length: 90 }, (_, i) => ({ n: i + 1, reads: ['x'.repeat(900)] })) });
  ok(huge.rounds.length === 40 && huge.rounds[0].reads[0].length === 220, 'a hostile body is bounded');
}

// ── Spelled round numbers become digits ─────────────────────────────────────
// The model spelled them out on about half the bench replies, including one
// list of seventeen, whatever the prompt said.
{
  const rd = matchReview.roundDigits;
  ok(rd('Repeated deaths in rounds two, six, seven and fourteen.') === 'Repeated deaths in rounds 2, 6, 7 and 14.',
    'a spelled list after "rounds" becomes digits');
  ok(rd('in rounds twenty two, and twenty three.') === 'in rounds 22, and 23.', 'twenty two folds into 22');
  ok(rd('Losing three rounds in a row.') === 'Losing three rounds in a row.', 'a count BEFORE "rounds" is not a round number');
  ok(rd('seen in rounds 3 4 6 and 9.') === 'seen in rounds 3, 4, 6 and 9.', 'bare round numbers get their commas back');
  ok(rd('in rounds 2, 3 and 4.') === 'in rounds 2, 3 and 4.', 'and a list that already has them is left alone');
  ok(rd('In round seven you died, then one teammate traded.') === 'In round 7 you died, then one teammate traded.',
    'and "one teammate" later in the sentence is left alone');
}

// ── Study notes fit the player, follow Advanced coaching, and name no source ─
// A note is its text and nothing else: the app never says where its knowledge
// comes from. Off, Advanced coaching lists core notes only; on, it keeps
// retrieve()'s reserve at study's scale, a core note always among the three and
// the majority on a run of lost rounds.
{
  const knowledge = require('../server/services/knowledge');
  const tierOf = (text) => { const n = knowledge.all().find((x) => x.text === text); return n ? n.tier || 'core' : null; };
  const textOnly = (notes) => notes.every((n) => JSON.stringify(Object.keys(n)) === '["text"]');
  const cores = (notes) => notes.filter((n) => tierOf(n.text) === 'core').length;
  const base = { rounds: [], patterns: [{ key: 'early', text: 'x' }], context: { agent: 'Jett', map: 'Abyss' } };
  const withAdvanced = (b) => ({ ...b, context: { ...b.context, advancedTips: true } });
  const off = matchReview.study(matchReview.normalise(base), 3);
  const on = matchReview.study(matchReview.normalise(withAdvanced(base)), 3);
  ok(off.length === 3 && on.length === 3 && textOnly(off) && textOnly(on),
    `three notes either way, each its text and nothing else (${JSON.stringify(on[0])})`);
  ok(cores(off) === 3, `Advanced coaching off, every note is core (${off.map((n) => tierOf(n.text)).join(', ')})`);
  ok(cores(on) === 1, `on, advanced takes two of the three and a core note survives (${on.map((n) => tierOf(n.text)).join(', ')})`);
  const all = off.concat(on);
  ok(!all.some((n) => /recon bolt|stars|Astra/i.test(n.text)), "a Jett never gets a Sova or Astra note");
  ok(!all.some((n) => /^Your (rifle|pistol|SMG|shotgun|sniper|machine gun)/.test(n.text)), 'no weapon note, the gun changes every round');
  ok(on.some((n) => /checkpoint|piece of space/i.test(n.text)), 'early deaths send a duelist to the checkpoint notes');
  ok(!off.some((n) => /checkpoint|piece of space/i.test(n.text)) && off.some((n) => /angle|peek/i.test(n.text)),
    'which are advanced, so with it off they go to the core notes on taking an angle');
  const streak = matchReview.study(matchReview.normalise(withAdvanced({ ...base, patterns: [{ key: 'streak', text: 'x' }] })), 3);
  ok(cores(streak) === 2 && streak.some((n) => /letting the scor/i.test(n.text)),
    `a run of lost rounds gives core the majority back, as a death streak does in retrieve() (${streak.map((n) => tierOf(n.text)).join(', ')})`);
  const four = matchReview.study(matchReview.normalise(withAdvanced(base)), 4);
  ok(four.length === 4 && cores(four) === 1, 'four notes for the prompt keep the same reserve, one core');
  // What a server from before 8.2 sends: the review keeps the text alone.
  const built = review.build({ rounds: [], context: {}, endedBy: 'stop',
    ai: { study: [{ text: 'Wait for the team.', coach: 'Someone (Team)' }, null, { coach: 'Someone' }] } });
  ok(JSON.stringify(built.study) === '[{"text":"Wait for the team."}]',
    `a note that arrives with a source is kept as its text alone (${JSON.stringify(built.study)})`);
}

// ── Study by cause (8.5.0, match-review.js CAUSE_TOPICS) ────────────────────
// A death's cause sends the study list to its topics: a counted `cause:`
// mistake as a pattern does (+5), a single looked at death by +2, for a
// client of 8.5.0 or later (byCause, which the route sets by the version
// gate). A client before it is listed its notes as today. And every topic a
// pattern or a cause names is one a note carries (check:playbook), which a
// planted topic nobody carries must fail.
{
  const knowledge = require('../server/services/knowledge');
  const topicOf = (text) => { const n = knowledge.all().find((x) => x.text === text); return n && n.source ? n.source.topic : null; };
  const topics = (notes) => notes.map((x) => topicOf(x.text));
  const dry = { n: 2, side: 'attacking', result: 'lost', died: true, cause: 'dry-peek' };
  const body = { rounds: [dry, { ...dry, n: 5 }], patterns: [], context: { agent: 'Omen', map: 'Pearl' },
    mistakes: [{ key: 'cause:dry-peek', title: 'Dry peeks', detail: 'Died 2 times', rounds: [2, 5], count: 2 }] };
  const input = matchReview.normalise(body);
  const today = topics(matchReview.study(input, 3));
  const counted = topics(matchReview.study({ ...input, byCause: true }, 3));
  ok(matchReview.CAUSE_TOPICS['dry-peek'].includes('planning the peek') && counted.includes('planning the peek') && !today.includes('planning the peek'),
    `a counted dry peek sends the study list to planning the peek, for a client of 8.5.0 or later (${counted.join(', ')}, where today it is ${today.join(', ')})`);
  ok(JSON.stringify(matchReview.study(input, 3)) === JSON.stringify(matchReview.study(matchReview.normalise(body), 3)) && input.byCause === undefined,
    'and without byCause the list is today\'s, which normalise never sets');
  const single = topics(matchReview.study({ ...matchReview.normalise({ ...body, mistakes: [], rounds: [dry] }), byCause: true }, 3));
  ok(single.includes('planning the peek'), `one death the coach looked at moves its cause's topics up too (${single.join(', ')})`);
  const carried = new Set(knowledge.all().map((n) => n.source && n.source.topic).filter(Boolean));
  const named = [...Object.values(matchReview.PATTERN_TOPICS), ...Object.values(matchReview.CAUSE_TOPICS)].flat();
  ok(named.every((t) => carried.has(t)) && Object.keys(matchReview.CAUSE_TOPICS).sort().join() === 'crossfire,dry-peek,exposed,isolated,overextend,repeek,rotating',
    'every topic a pattern or a cause names is one a note carries, and the seven avoidable causes have topics');
  const { spawnSync } = require('child_process');
  const playbook = (env) => spawnSync(process.execPath, [require('path').join(__dirname, 'check-playbook.js')],
    { encoding: 'utf8', env: { ...process.env, ...env } });
  const clean = playbook({});
  const planted = playbook({ CHECK_PLAYBOOK_TOPIC: 'a topic nobody carries' });
  ok(clean.status === 0 && planted.status === 1 && /CAUSE_TOPICS\.planted sends the player to "a topic nobody carries"/.test(planted.stdout + planted.stderr),
    `and check:playbook fails a topic no note carries (${clean.status}, ${planted.status})`);
}

// ── The side study leans to is the side the patterns name (8.3.1) ──────────
// The sides pattern names a stronger side only on a gap of two rounds, and
// study() leaned on any gap: the player's Sunset swiftplay, 1 of 4 on attack
// against 1 of 3 on defence, said "Neither side was clearly stronger" over
// notes leaning to attack. The server mirrors the client's rule (weakSide),
// held equal here on every split of three to twelve decided rounds a side.
{
  const split = (aw, an, dw, dn) => [
    ...Array.from({ length: an }, (_v, i) => ({ n: i + 1, side: 'attacking', result: i < aw ? 'won' : 'lost', died: false })),
    ...Array.from({ length: dn }, (_v, i) => ({ n: an + i + 1, side: 'defending', result: i < dw ? 'won' : 'lost', died: false })),
  ];
  const leadOf = (rows) => { const p = review.patterns(rows).find((x) => x.key === 'sides'); return p ? p.text.split(':')[0] : null; };
  const named = { 'Attack was your stronger side': 'defense', 'Defence was your stronger side': 'attack' };
  const differ = [];
  let splits = 0;
  for (let an = 3; an <= 12; an++) {
    for (let dn = 3; dn <= 12; dn++) {
      for (let aw = 0; aw <= an; aw++) {
        for (let dw = 0; dw <= dn; dw++) {
          const rows = split(aw, an, dw, dn);
          const lead = leadOf(rows);
          const weak = matchReview.weakSide(rows);
          splits++;
          if (weak !== (named[lead] || null)) differ.push(`${aw} of ${an} against ${dw} of ${dn}: ${weak} under "${lead}"`);
        }
      }
    }
  }
  ok(!differ.length, `study leans to the weaker side only where the patterns name a stronger one, on all ${splits} splits (${differ.slice(0, 3).join('; ') || 'none differ'})`);
  const sunset = split(1, 4, 1, 3);
  ok(matchReview.weakSide(sunset) === null && leadOf(sunset) === 'Neither side was clearly stronger'
    && matchReview.weakSide(split(1, 4, 3, 4)) === 'attack' && matchReview.weakSide(split(3, 3, 1, 3)) === 'defense',
  'the Sunset swiftplay\'s 1 of 4 against 1 of 3 leans to neither, and a two round gap still does');
}

// ── A fresh ledger with a jump in the score ─────────────────────────────────
{
  const l = new RoundLedger();
  l.observe({ team: 2, enemy: 1, phase: 'active', clock: '1:10' });
  l.observe({ team: 4, enemy: 1, phase: 'buy' });
  const list = l.list();
  ok(list.find((r) => r.n === 4).result === 'won' && list.find((r) => r.n === 5).result === 'won',
    'two missed rounds where only one side scored are both known wins');
  l.observe({ team: 5, enemy: 2, phase: 'buy' });
  const l2 = l.list();
  ok(l2.find((r) => r.n === 6).result === null && l2.find((r) => r.n === 7).result === null,
    'when both sides scored while nobody watched, the order is unknowable and no result is guessed');
}

// ── Riot's record overrides the screen ──────────────────────────────────────
// Riot's real record of the same Abyss match, from /api/coach/match-rounds.
// The screen ledger read 22 deaths and Riot has 21; the extra is round 17. The
// screen put 6 deaths in the first 30 seconds; Riot puts most of them there,
// because the spectator camera made the dead player look alive.
{
  const verify = require('../src/shared/valorant-verify');
  const riot = load('riot-abyss-13-11.json');
  const riotDeaths = riot.perRound.filter((r) => r.died).length;
  ok(riotDeaths === 21 && riot.me.deaths === 21, `Riot's rounds add up to its scoreboard, 21 deaths (${riotDeaths})`);
  ok(riot.perRound.reduce((a, r) => a + r.kills, 0) === riot.me.kills,
    `and the per round kills add up to its ${riot.me.kills}`);

  const { rounds, checks } = verify.reconcile(abyss.rounds, riot);
  ok(checks.screenDeaths === 22 && checks.riotDeaths === 21, `the screen said 22, Riot says 21 (${checks.screenDeaths}, ${checks.riotDeaths})`);
  ok(checks.invented.join() === '17' && !checks.missed.length, `the invented death is round 17 and none were missed (${checks.invented}, ${checks.missed})`);
  ok(rounds.filter((r) => r.died).length === 21, 'after the check the review has 21 deaths');
  ok(rounds.every((r) => r.verified) && rounds.length === 24, 'every round is verified');
  ok(!rounds.find((r) => r.n === 17).died && !rounds.find((r) => r.n === 17).deathSpot,
    'round 17 loses its invented death and its death spot');

  const r2 = rounds.find((r) => r.n === 2);
  ok(r2.deathSec === 15 && r2.killerAgent === 'Viper' && r2.weapon === 'Marshal' && r2.firstDeath,
    'round 2 carries Riot\'s 15 seconds, Viper and the Marshal, and the first death');
  ok(r2.deathSpot === 'A Site', 'and keeps the screen\'s location, which Riot does not record');

  // Every surviving coach read that names a killer names Riot's killer.
  const wrong = rounds.flatMap((r) => r.reads.filter((x) => {
    const named = verify.namedKiller(x.text);
    return named && r.killerAgent && named.toLowerCase() !== r.killerAgent.toLowerCase();
  }));
  ok(checks.readsDropped > 0, `reads naming the wrong killer are dropped (${checks.readsDropped})`);
  ok(wrong.length === 0, 'and no surviving read contradicts Riot');
  ok(!rounds.some((r) => !r.died && r.reads.some((x) => x.death)), 'no death review survives in a round Riot says was survived');

  const pats = review.patterns(rounds);
  const early = pats.find((p) => p.key === 'early');
  const earlyN = rounds.filter((r) => r.early).length;
  ok(earlyN === 16, `Riot puts 16 deaths in the first 30 seconds before a plant (${earlyN}), the screen said 6`);
  ok(early && early.text.startsWith('16 of your 21 deaths came in the first 30 seconds'), `the pattern says so (${early && early.text})`);
  const killer = pats.find((p) => p.key === 'killer');
  ok(killer && killer.text === 'Skye killed you 7 times, more than anyone else.', `top killer (${killer && killer.text})`);
  ok(pats.some((p) => p.key === 'firstkill'), 'the first kill pattern, the good news, clears its floor');
  ok(!pats.some((p) => p.key === 'firstdeath'), '4 first deaths in 24 rounds is under its floor and stays out');

  const rv = review.build({ rounds, context: { ...abyss.context, agent: 'Jett' }, endedBy: 'score',
    verification: verify.describe(checks) });
  ok(rv.verified && /Riot has 21/.test(rv.verification), `the review says what the check changed (${rv.verification})`);
  const c1 = rv.rounds.find((c) => c.n === 1);
  ok(c1.facts.join('|') === 'Survived|2 kills', `a verified survived round can say so (${c1.facts})`);
  const c2 = rv.rounds.find((c) => c.n === 2);
  ok(c2.facts[0] === 'Died at A Site, 15s in, to Viper with a Marshal', `round 2 reads exactly (${c2.facts[0]})`);
  ok(!rv.refused.some((t) => /Kills, damage/.test(t)), 'the "kills are not on the HUD" refusal goes once Riot supplies them');
  // WHAT IT CANNOT TELL YOU IS TRUE (8.6). It said Riot records when you died
  // and to whom, not where: Riot's record carries every kill's location, and
  // the review keeps the screen's alone, so that is what it says.
  ok(rv.refused.includes("Where you died is read off the screen, not taken from Riot's record, so a death's place can be misread.")
    && !rv.refused.some((t) => /not where/.test(t)),
  `a linked review says its death places are the screen's, never that Riot has none (${rv.refused.join(' | ')})`);

  const body = review.requestBody({ rounds, context: abyss.context, endedBy: 'score',
    riot: { agent: 'Jett', map: 'Abyss', score: '13-11', result: 'Victory' } });
  const input = matchReview.normalise(body);
  ok(input.context.agent === 'Jett' && input.final.verified, 'the server is told Riot\'s agent and final score');
  const prompt = matchReview.buildPrompt(input);
  ok(/R2 defence, lost\. died at A Site 15 seconds into the round, killed by Viper with a Marshal/.test(prompt),
    'the model gets Riot\'s facts for each round');
  ok(/Riot's final score was 13 to 11/.test(prompt) && /checked against Riot/.test(prompt), 'and is told they are Riot\'s');

  // The scoreboard line. Without it a 31 kill match MVP was reviewed from his
  // 21 deaths alone.
  const withLine = matchReview.buildPrompt(matchReview.normalise(review.requestBody({
    rounds, context: abyss.context, endedBy: 'score',
    riot: { agent: 'Jett', map: 'Abyss', score: '13-11', result: 'Victory',
      scoreline: { kills: 31, deaths: 21, assists: 4, acs: 382 } } })));
  ok(/31 kills, 21 deaths, 4 assists, combat score 382 a round/.test(withLine), 'the model sees Riot\'s scoreboard line');

  // THE ROUND PICKER. Left to itself the model explained rounds 2 to 11 of 24.
  const picks = matchReview.teachable(input.rounds);
  ok(picks.length === 10, `ten rounds are picked (${picks})`);
  ok(picks.some((n) => n <= 8) && picks.some((n) => n > 8 && n <= 16) && picks.some((n) => n > 16),
    `and every third of the match gets at least one (${picks})`);
  ok([2, 10, 23].every((n) => picks.includes(n)), 'every first death in a lost round is among them');
  // A line explains a death in a round that was not won: round 7's first
  // death was in a round the team won, and 11 rounds were lost to a death.
  ok(!picks.includes(7) && input.rounds.filter(matchReview.lineWorthy).length === 11,
    `and no won round is, first death or not (${picks})`);
  ok(/one round line for each of these rounds, in this order: R2, /.test(prompt), 'the prompt names them');

  // THE KILLER GATE, on the exact lines the live model wrote for this match.
  // Its R5 line went to a round the team won, which gets no line at all now,
  // so the same sentence is held to the gate on round 22, which Riot has
  // Skye winning.
  const reply = 'SUMMARY: You won.\nR4: Taking A vent wide with no trade partner gives Viper an easy kill opportunity.\n'
    + 'R5: Peeking A vent alone against Viper is a free kill when your team is elsewhere.\n'
    + 'R10: Dying first as Cypher catches you shows you stepped out without breaking his angle.\n'
    + 'R22: Peeking A vent alone against Viper is a free kill when your team is elsewhere.\nFOCUS: Smoke first.';
  const parsed = matchReview.parse(reply, input);
  ok(!(22 in parsed.rounds) && parsed.dropped.some((d) => d.n === 22 && d.said === 'Viper' && d.riot === 'Skye'),
    'R22 named Viper where Riot says Skye, and is dropped');
  ok(!(5 in parsed.rounds) && !parsed.dropped.some((d) => d.n === 5), 'and round 5, won, gets no line to check');
  ok(4 in parsed.rounds && 10 in parsed.rounds, 'R4 (Viper) and R10 (Cypher) match Riot and stay');

  // THE COUNT GATE, on the sentence the live model wrote, which merged 6 of 12
  // on attack with 6 of 10 after the plant into one wrong figure.
  const counted = matchReview.parse('SUMMARY: You won the match 13 to 11 by securing six of twelve attack rounds '
    + 'after spike plant. Your most repeated mistake was stepping out alone in rounds 2, 3 and 4. '
    + 'You won 7 out of 12 on defence.', input);
  ok(counted.summary === 'Your most repeated mistake was stepping out alone in rounds 2, 3 and 4.',
    `sentences carrying a count are dropped, round numbers are not (${counted.summary})`);
  ok(/write no counts or fractions/.test(prompt), 'and the prompt asks for none');
}

// ── A plant belongs to the round it was seen in ─────────────────────────────
// The failure: round 6 planted at B Site and won, and the banner frames that
// already print 4 to 2 still carry "planted" from the engine's context, which
// only a buy phase clears. They are filed under round 7, so round 7 was
// planted at B Site, its early death lost its bucket, and Riot's record could
// not take it back because the merge was an OR.
{
  const l = new RoundLedger();
  let at = 0;
  const f = (o) => { at += 1000; l.observe({ at, side: 'attacking', ...o }); };
  const clock = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  for (let s = 30; s >= 1; s -= 2) f({ team: 3, enemy: 2, phase: 'buy', clock: clock(s) });
  for (let s = 100; s >= 60; s -= 2) f({ team: 3, enemy: 2, phase: 'active', clock: clock(s) });
  for (let i = 0; i < 20; i++) f({ team: 3, enemy: 2, phase: 'postplant', spike: 'planted', spikeSpot: 'B Site' });
  // The banner, read three ways: the clock it prints, no clock, and post plant.
  f({ team: 4, enemy: 2, phase: 'active', clock: '0:01', spike: 'planted', spikeSpot: 'B Site' });
  f({ team: 4, enemy: 2, phase: 'active', spike: 'planted', spikeSpot: 'B Site' });
  f({ team: 4, enemy: 2, phase: 'postplant', spike: 'planted', spikeSpot: 'B Site' });
  for (let s = 30; s >= 1; s -= 2) f({ team: 4, enemy: 2, phase: 'buy', clock: clock(s) });
  for (let s = 100; s >= 86; s -= 2) f({ team: 4, enemy: 2, phase: 'active', clock: clock(s) });
  f({ team: 4, enemy: 2, phase: 'dead', clock: '1:25', died: true, deathSpot: 'A Main' });
  for (let s = 84; s >= 20; s -= 4) f({ team: 4, enemy: 2, phase: 'dead', clock: clock(s) });
  f({ team: 4, enemy: 3, phase: 'active', clock: '0:01' });
  const rows = l.list();
  const r6 = rows.find((r) => r.n === 6);
  const r7 = rows.find((r) => r.n === 7);
  ok(r6.planted && r6.plantSpot === 'B Site', 'round 6 keeps its plant at B Site');
  ok(!r7.planted && r7.plantSpot === null, `the banner frames after it do not plant round 7 (${r7.planted}, ${r7.plantSpot})`);
  ok(r7.early && review.timingOf(r7) === 'early', 'so round 7\'s death 15 seconds in keeps its early flag and its bucket');
  ok(!review.roundFacts(r7).some((t) => /Spike planted/.test(t)), `and its card says nothing about a spike (${review.roundFacts(r7)})`);

  // A banner plant with no plant seen in the round before is that round's.
  const b = new RoundLedger();
  at = 0;
  const g = (o) => { at += 1000; b.observe({ at, side: 'defending', ...o }); };
  for (let s = 100; s >= 30; s -= 5) g({ team: 1, enemy: 1, phase: 'dead', clock: clock(s) });
  g({ team: 1, enemy: 2, phase: 'dead', clock: '0:00', spike: 'planted', spikeSpot: 'A Site' });
  ok(b.list().find((r) => r.n === 3).planted && !b.rounds.get(4).planted,
    'a plant seen only on the banner is credited back to the round that ended');

  // Riot's planted flag outranks the screen's, when its record has plants.
  const verify = require('../src/shared/valorant-verify');
  const screen = rows.map((r) => (r.n === 7 ? { ...r, planted: true, plantSpot: 'B Site' } : r));
  const riotPlants = { perRound: [
    { n: 6, won: true, died: false, planted: true, kills: 1 },
    { n: 7, won: false, died: true, deathMs: 15000, planted: false, kills: 0 },
  ] };
  const v = verify.reconcile(screen, riotPlants).rounds;
  ok(v.find((r) => r.n === 6).planted && v.find((r) => r.n === 6).plantSpot === 'B Site',
    "Riot's plant keeps the site the screen read");
  ok(!v.find((r) => r.n === 7).planted && v.find((r) => r.n === 7).plantSpot === null,
    'and a plant Riot does not have is dropped, site and all');
  const noPlantData = { perRound: riotPlants.perRound.map((r) => ({ ...r, planted: false })) };
  ok(verify.reconcile(screen, noPlantData).rounds.find((r) => r.n === 6).planted,
    'a record with no plant in any round falls back to the screen, which is what a renamed field looks like');

  // AND RIOT'S SITE, when its record names one (8.3.1). The player's Sunset
  // swiftplay: round 5 was "Spike planted at B Boba", a frame of round 4's
  // plant the ledger had filed a round ahead, where Riot has round 5 planted
  // on A. The screen's callout stays where it names Riot's site, the part
  // Riot never says.
  const siteRow = (n, spot) => ({ n, side: 'defending', result: null, died: false, deathSpot: null, deathClock: null, early: false,
    ultAtDeath: null, ultSeen: null, planted: !!spot, plantSpot: spot, locs: [], reads: [], frames: 5 });
  const sited = verify.reconcile([siteRow(4, 'B Boba'), siteRow(5, 'B Boba'), siteRow(6, 'A'), siteRow(7, 'Mid Courtyard'), siteRow(8, null)], { perRound: [
    { n: 4, won: true, died: false, planted: true, plantSite: 'B' },
    { n: 5, won: true, died: false, planted: true, plantSite: 'A' },
    { n: 6, won: false, died: false, planted: true, plantSite: 'A' },
    { n: 7, won: false, died: false, planted: true, plantSite: 'A' },
    { n: 8, won: false, died: false, planted: true, plantSite: 'B' },
    { n: 9, won: false, died: false, planted: true, plantSite: 'C' },
  ] }).rounds;
  const spotOf = (n) => sited.find((r) => r.n === n).plantSpot;
  ok(spotOf(5) === 'A Site' && spotOf(4) === 'B Boba' && review.roundFacts(sited.find((r) => r.n === 5)).includes('Spike planted at A Site'),
    `Riot's site is the plant's: round 5's B Boba, round 4's plant filed a round ahead, is A Site, and round 4 keeps the callout Riot never says (${spotOf(5)}, ${spotOf(4)})`);
  ok(spotOf(6) === 'A Site' && spotOf(7) === 'A Site' && spotOf(8) === 'B Site' && spotOf(9) === 'C Site',
    'a bare letter, a place on no site, no callout at all and a round never watched all take Riot\'s site');
  const unsited = verify.reconcile([siteRow(5, 'B Boba')], { perRound: [{ n: 5, won: true, died: false, planted: true }] }).rounds;
  ok(unsited[0].plantSpot === 'B Boba', 'and a record naming no site, one fetched before the server sent it, keeps the screen\'s');
}

// ── The reads a round keeps: play, the last of it, nobody named ─────────────
// The player's Sunset swiftplay, read a second: every card's reads were its
// buy phase, because the ledger kept a round's FIRST three notes, and the
// review was written from them. The notes below are that match's own wording
// (the names in it are made up); the frames are its shape, a buy phase and
// then a round in mid with the death a tenth of a second after the last read.
{
  const { notPlay, namesSomeone } = require('../src/shared/valorant-rounds');
  const l = new RoundLedger();
  let at = 0;
  const f = (o) => { at += 1000; l.observe({ at, team: 0, enemy: 0, side: 'defending', alive: true, ...o }); };
  const clock = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  f({ phase: 'buy', clock: '0:43', note: 'standing in A Lobby during buy phase' });
  f({ phase: 'buy', clock: '0:42', note: 'player holding Classic in spawn during buy phase' });
  f({ phase: 'buy', clock: '0:41', note: 'in spawn during buy phase with an overlay open' });
  // A buy phase frame whose note never says so: the frame's phase decides.
  f({ phase: 'buy', clock: '0:40', note: 'player holding A Elbow alone with Ghost' });
  for (let s = 39; s >= 0; s--) f({ phase: 'buy', clock: clock(s) });
  f({ phase: 'active', clock: '1:39', note: 'holding B Main with Ghost out, dash ready' });
  // The model's buy words on a frame it read as active with the round clock running.
  f({ phase: 'active', clock: '1:38', note: 'holding B Main during buy phase' });
  f({ phase: 'active', clock: '1:37', note: 'holding Mid Courtyard, enemy spotted mid' });
  f({ phase: 'active', clock: '1:36', note: 'holding Mid Courtyard alone with knife out' });
  f({ phase: 'active', clock: '1:35', note: 'player at B Site stairs with 22 HP, teammate Zorbo ahead' });
  f({ phase: 'active', clock: '1:34', note: 'player holding Mid Courtyard with low HP' });
  // The death screen, on a frame the engine still held as alive and in play.
  f({ phase: 'postplant', clock: '1:33', note: 'dead, viewing combat report while spike is planted on A' });
  f({ phase: 'dead', clock: '1:32', alive: false, died: true, deathSpot: 'Mid Courtyard', note: 'killed by KAY/O, 159 damage taken' });
  f({ phase: 'dead', clock: '1:31', alive: false, note: 'spectating teammate holding A Site' });
  // Alive again by the alive flag (the spectator HUD), after the death: not before it.
  f({ phase: 'active', clock: '1:30', note: 'holding A Site with Vandal' });
  const r1 = l.list().find((r) => r.n === 1);
  const reads = r1.reads.map((x) => x.text);
  ok(JSON.stringify(reads) === JSON.stringify(['holding Mid Courtyard, enemy spotted mid',
    'holding Mid Courtyard alone with knife out', 'player holding Mid Courtyard with low HP']),
  `a round keeps the last three reads of play before the death, never the buy phase (${JSON.stringify(reads)})`);
  // A round the player lived through ends on its banner, an active frame with
  // under fifteen seconds left, whatever its note says.
  for (let s = 29; s >= 1; s -= 7) f({ team: 0, enemy: 1, phase: 'buy', clock: clock(s), note: 'standing in B Lobby during buy phase' });
  f({ team: 0, enemy: 1, phase: 'active', clock: '1:35', note: 'holding B Main with Vandal' });
  f({ team: 0, enemy: 1, phase: 'active', clock: '1:10', note: 'player alone on B Site looking at a wall' }, 25000);
  f({ team: 0, enemy: 1, phase: 'postplant', spike: 'planted', note: 'holding B Boba while spike is planted' }, 30000);
  f({ team: 0, enemy: 1, phase: 'active', clock: '0:03', note: 'holding B Site with Vandal' }, 30000);
  const r2 = l.list().find((r) => r.n === 2);
  const lived = r2.reads.map((x) => x.text);
  ok(!r2.died && JSON.stringify(lived) === JSON.stringify(['holding B Main with Vandal',
    'player alone on B Site looking at a wall', 'holding B Boba while spike is planted']),
  `and a round survived keeps its last three of play, never the banner that ends it (${JSON.stringify(lived)})`);
  // The screen's half of Riot's afterPlant: a plant seen before the death.
  const p = new RoundLedger();
  at = 0;
  const g = (o, dt = 1000) => { at += dt; p.observe({ at, side: 'attacking', alive: true, ...o }); };
  g({ team: 0, enemy: 0, phase: 'active', clock: '1:20' });
  g({ team: 0, enemy: 0, phase: 'dead', clock: '1:10', alive: false, died: true }, 10000);
  g({ team: 0, enemy: 0, phase: 'dead', alive: false, spike: 'planted' }, 20000);
  g({ team: 0, enemy: 1, phase: 'buy', clock: '0:29' }, 30000);
  g({ team: 0, enemy: 1, phase: 'active', clock: '1:20' }, 30000);
  g({ team: 0, enemy: 1, phase: 'postplant', spike: 'planted' }, 20000);
  g({ team: 0, enemy: 1, phase: 'dead', alive: false, died: true }, 10000);
  const pl = p.list();
  ok(pl[0].planted && pl[0].afterPlant === false && pl[1].planted && pl[1].afterPlant === true,
    'a death before the plant was seen is not after it, and one after it is');
  ok(notPlay('holding B Main during buy phase') === 'buy' && notPlay('scoreboard open while dead in B Lobby')
    && notPlay('player standing in spawn holding Classic, surrender vote active') === 'surrender'
    && notPlay('WON ENEMY TEAM ELIMINATED banner shown') && notPlay('Spectating teammate defusing on A Site')
    && notPlay('holding A Lobby with 100 HP') === null && notPlay('player holding Mid Courtyard with low HP') === null,
  'what the state cannot tell, the words do: the buy phase, a menu, a vote, a banner, the spectator camera');
  ok(namesSomeone('player at B Site stairs with 22 HP, teammate Zorbo ahead') === 'Zorbo'
    && namesSomeone('player watching Klumpf walk through B Site') === 'Klumpf'
    && namesSomeone('holding A Lobby with teammate zorbo') === 'zorbo'
    && namesSomeone('teammate Sage running ahead toward mid, player holding A Lobby') === null
    && namesSomeone('holding A Lobby with teammates Brimstone, Sova, Skye and Phoenix nearby') === null
    && namesSomeone('ALLY DEFUSING, player holding A Site') === null
    && namesSomeone('player holding Mid Courtyard with Ghost, signature ability charged') === null
    && namesSomeone('holding A Main with KAY/O behind, knife out with dash ready') === null,
  'a read naming a person is never kept; agents, weapons, callouts and the HUD\'s own words are not people');
  // THE SERVER'S COPY (server/services/match-review.js) cannot require this
  // one, so the two are held equal here, on every note this block reads.
  const words = ['standing in A Lobby during buy phase', 'holding B Main during buy phase', 'holding B site with barriers up',
    'buy phase with combat report open in B Lobby', 'scoreboard open while dead in B Lobby', 'player dead at B Site 5m',
    'killed by KAY/O, 159 damage taken', 'spectating teammate holding A Site', 'WON ENEMY TEAM ELIMINATED banner shown',
    'player standing in spawn holding Classic, surrender vote active', 'full scoreboard open while holding A Link',
    'in buy menu at defender spawn, combat report open', 'player holding Mid Courtyard with low HP',
    'holding A Lobby with 100 HP', 'holding Mid Courtyard, enemy spotted mid', 'ally defusing spike on A Site'];
  ok(words.every((t) => !!notPlay(t) === matchReview.NOT_PLAY.test(t)) && words.filter((t) => notPlay(t)).length === 12
    && matchReview.NOT_PLAY.source === require('../src/shared/valorant-rounds').NOT_PLAY.source,
  "the server's copy of what is not play is the ledger's, word for word, and agrees read by read");
}

// ── Where a round begins: a buy read once play has been seen ────────────────
{
  const clock = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  // THE MISREAD, as the engine hands it over: the player's round 5 post plant,
  // a "buy 0:39" read off the ammo counter a second after the last post plant
  // read, then four more timers on any number, and buy reads with no timer
  // that carry the last one read, as the engine's context does. It advanced
  // the round, and round 5's post plant, its spike and a death went to round 6.
  const l = new RoundLedger();
  let at = 0;
  const seen = [];
  const f = (o, dt = 1000) => { at += dt; l.observe({ at, team: 1, enemy: 3, side: 'defending', alive: true, ...o }); seen.push(l.current()); };
  for (let s = 43; s >= 1; s--) f({ phase: 'buy', clock: clock(s) });
  for (let s = 99; s >= 64; s--) f({ phase: 'active', clock: clock(s) });
  for (let i = 0; i < 5; i++) f({ phase: 'postplant', clock: '1:04', spike: 'planted', spikeSpot: 'A Site' });
  const from = seen.length;
  f({ phase: 'buy', clock: '0:39' });
  f({ phase: 'buy', clock: '0:39' });
  f({ phase: 'buy', clock: '0:13' });
  f({ phase: 'buy', clock: '0:23' });
  f({ phase: 'buy', clock: '0:19' });
  // Its start a tenth of a second after the last post plant read, alone.
  f({ phase: 'buy', clock: '0:39' }, 1100);
  f({ phase: 'active', clock: '0:39' });
  f({ phase: 'active', clock: '0:39' });
  // The engine's held "0:39", three seconds on: no timer was read here.
  f({ phase: 'buy', clock: '0:39' }, 1100);
  f({ phase: 'active', clock: '0:39' });
  f({ phase: 'postplant', clock: '0:39', spike: 'planted' });
  f({ phase: 'postplant', clock: '0:39', spike: 'planted' });
  ok(seen.slice(from).every((n) => n === 5),
    `misread buy timers in a post plant never begin the next round (${seen.slice(from).join(',')})`);
  // The real buy phase, seven seconds after the last post plant read, still does.
  f({ phase: 'buy', clock: '0:29' }, 7000);
  f({ phase: 'buy', clock: '0:28' });
  ok(l.current() === 6, `and the next real buy phase, before the score moves, is round 6 (${l.current()})`);

  // THE RUNNING BUY TIMER. A buy timer already accepted is running, a play read
  // inside it set "played", and a buy read misread inside it would begin a
  // round that is still being bought.
  const b = new RoundLedger();
  at = 0;
  const g = (o, dt = 1000) => { at += dt; b.observe({ at, team: 0, enemy: 3, side: 'attacking', alive: true, ...o }); };
  for (let s = 99; s >= 40; s -= 3) g({ phase: 'active', clock: clock(s) });
  g({ team: 1, enemy: 3, phase: 'active', clock: '0:05' }, 3000);
  g({ team: 1, enemy: 3, phase: 'buy', clock: '0:28' }, 6000);
  g({ team: 1, enemy: 3, phase: 'active', clock: '1:05' }, 2000);
  g({ team: 1, enemy: 3, phase: 'buy', clock: '0:29' }, 6000);
  g({ team: 1, enemy: 3, phase: 'buy', clock: '0:19' }, 1000);
  ok(b.current() === 5, `a buy read inside the buy timer already running is that buy phase, never the next (${b.current()})`);

  // THE SECOND READ IS ANOTHER SECOND OF THE TIMER. In the player's round 5
  // the frame after the first "buy 0:39" read buy with no timer, and the
  // engine handed it over carrying the 0:39 it held: one read twice, which as
  // two agreeing reads began round 6 in the post plant. So is a still number
  // misread twice, an ammo counter that has not moved.
  const post = () => {
    const led = new RoundLedger();
    let t = 0;
    const filed = [];
    const h = (o, dt = 1000) => { t += dt; led.observe({ at: t, team: 1, enemy: 3, side: 'defending', alive: true, ...o }); filed.push(led.current()); };
    for (let s = 43; s >= 1; s--) h({ phase: 'buy', clock: clock(s) });
    for (let s = 99; s >= 64; s--) h({ phase: 'active', clock: clock(s) });
    for (let i = 0; i < 5; i++) h({ phase: 'postplant', clock: '1:04', spike: 'planted', spikeSpot: 'A Site' });
    return { h, filed, from: filed.length, led };
  };
  const copy = post();
  copy.h({ phase: 'buy', clock: '0:39' }, 6100);
  copy.h({ phase: 'buy', clock: '0:39' });
  copy.h({ phase: 'postplant', clock: '0:39', spike: 'planted' });
  const still = post();
  still.h({ phase: 'buy', clock: '0:29' }, 2000);
  still.h({ phase: 'buy', clock: '0:29' });
  still.h({ phase: 'postplant', clock: '0:29', spike: 'planted' });
  ok(copy.filed.slice(copy.from).every((n) => n === 5) && still.filed.slice(still.from).every((n) => n === 5),
    `a buy read and the same clock again a second later are one read, and begin no round (${copy.filed.slice(copy.from).join(',')}; ${still.filed.slice(still.from).join(',')})`);
  // A real buy phase whose second read left the timer empty begins on the read after it, the timer moving.
  const real = post();
  real.h({ phase: 'buy', clock: '0:29' }, 2000);
  real.h({ phase: 'buy', clock: '0:29' });
  real.h({ phase: 'buy', clock: '0:27' });
  ok(real.led.current() === 6, `and a real buy phase read so still begins the round once its timer has moved (${real.filed.slice(real.from).join(',')})`);
}

// ── One death a round, and the ultimate ─────────────────────────────────────
{
  const clock = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  // ONE DEATH A ROUND KEEPS THE FIRST, though the player was read alive
  // between two registrations: on the real Abyss session round 23 those reads
  // were the spectator camera, alive at 1:09 and 1:00 after a death Riot has
  // 12 seconds in, and taking the later registration moved the death 36
  // seconds late and to the teammate's spot.
  const l = new RoundLedger();
  let at = 0;
  const f = (o, dt = 1000) => { at += dt; l.observe({ at, team: 12, enemy: 10, side: 'attacking', alive: true, ...o }); };
  for (let s = 24; s >= 6; s -= 9) f({ phase: 'buy', clock: clock(s) }, 9000);
  f({ phase: 'dead', clock: '0:05', alive: false, died: true }, 10000);
  f({ phase: 'active', clock: '1:27', loc: 'Mid Bottom' }, 8000);
  f({ phase: 'active', clock: '1:09', loc: 'A Main' }, 19000);
  f({ phase: 'active', clock: '1:00', loc: 'A Lobby' }, 7000);
  f({ phase: 'dead', clock: '0:51', alive: false, died: true, deathSpot: 'A Lobby' }, 8000);
  const r = l.list().find((x) => x.n === 23);
  ok(r.died && r.deathClock === null && r.deathSpot === null,
    `the later registration, after the spectator camera read alive, does not replace the first (${r.deathSpot}, ${r.deathClock})`);

  // THE ULTIMATE. The engine keeps the last ult it read when a read leaves the
  // field empty, so one misread "ready" (3 of 8 pips lit) carried to the frame
  // after it, and then a death was "holding your ultimate".
  const u = new RoundLedger();
  at = 0;
  const h = (o, dt = 1000) => { at += dt; u.observe({ at, team: 1, enemy: 3, side: 'defending', alive: true, ...o }); };
  for (let s = 29; s >= 1; s--) h({ phase: 'buy', clock: clock(s), ult: 'charging' });
  for (let s = 99; s >= 80; s--) h({ phase: 'active', clock: clock(s), ult: 'charging' });
  h({ phase: 'active', clock: '1:19', ult: 'ready' });
  h({ phase: 'active', clock: '1:18', ult: 'ready' });
  h({ phase: 'dead', clock: '1:17', alive: false, died: true, ult: 'ready' });
  ok(u.list().find((x) => x.n === 5).ultAtDeath !== 'ready', 'one ready read carried a second is not an ultimate held');
  const w = new RoundLedger();
  at = 0;
  const k = (o, dt = 1000) => { at += dt; w.observe({ at, team: 1, enemy: 3, side: 'defending', alive: true, ...o }); };
  for (let s = 99; s >= 80; s--) k({ phase: 'active', clock: clock(s), ult: 'ready' });
  k({ phase: 'dead', clock: '1:19', alive: false, died: true, ult: 'ready' });
  ok(w.list().find((x) => x.n === 5).ultAtDeath === 'ready', 'ready read alive for twenty seconds is');
  // With the frame's own read the engine can send (ultRead), two ready reads in a row while alive.
  const x = new RoundLedger();
  at = 0;
  const q = (o, dt = 1000) => { at += dt; x.observe({ at, team: 1, enemy: 3, side: 'defending', alive: true, ...o }); };
  for (let s = 99; s >= 90; s--) q({ phase: 'active', clock: clock(s), ult: 'charging', ultRead: 'charging' });
  q({ phase: 'active', clock: '1:29', ult: 'ready', ultRead: 'ready' });
  for (let s = 88; s >= 70; s--) q({ phase: 'active', clock: clock(s), ult: 'ready', ultRead: null });
  q({ phase: 'dead', clock: '1:09', alive: false, died: true, ult: 'ready', ultRead: null });
  ok(x.list().find((y) => y.n === 5).ultAtDeath !== 'ready', 'one read of its own, held for twenty seconds, is not');
}

// ── What the review is written from: the reads, the sides, the plants ──────
{
  // The map lock held Haven for the first three minutes of the Sunset match,
  // and round 2's last reads named Haven's A Long.
  const fp = review.foreignPlace;
  ok(fp('holding A Long alone with low HP', 'Sunset') === 'A Long' && fp('holding A Long alone', 'Haven') === null
    && fp('holding a long angle on B Site', 'Sunset') === null && fp('holding Hookah alone', 'Sunset') === 'hookah'
    && fp('holding B Boba alone while spike is planted', 'Sunset') === null && fp('holding A Long alone', null) === null,
  "a read naming a place another map has and this one does not is not this match's");
  const mk = (n, o) => ({ n, side: n <= 4 ? 'attacking' : 'defending', result: 'lost', died: true, deathSpot: null,
    deathClock: null, early: false, ultAtDeath: null, planted: false, plantSpot: null, reads: [], frames: 30, ...o });
  const rows = [
    mk(1, { planted: true, afterPlant: false, reads: [{ text: 'holding B site with spike carrier just killed' }] }),
    mk(2, { planted: true, afterPlant: true, reads: [{ text: 'player standing at B Site holding knife' }, { text: 'holding A Long alone with low HP' }] }),
    mk(3), mk(4, { result: 'won', died: false, planted: true }),
    mk(5, { result: 'won', died: false, planted: true }), mk(6, { planted: true, afterPlant: false }), mk(7, { planted: true, afterPlant: false }),
  ];
  const rv = review.build({ rounds: rows, context: { map: 'Sunset', teamScore: 2, enemyScore: 5 }, endedBy: 'score', ai: {} });
  ok(JSON.stringify(rv.rounds.find((c) => c.n === 2).reads) === '["player standing at B Site holding knife"]',
    'so the card leaves it out');
  const body = review.requestBody({ rounds: rows, context: { map: 'Sunset', teamScore: 2, enemyScore: 5 }, endedBy: 'score' });
  ok(JSON.stringify(body.rounds.find((r) => r.n === 2).reads) === '["player standing at B Site holding knife"]',
    'and so does what the model is sent');
  // ANOTHER AGENT'S KIT (8.4.1). The player's Fracture swiftplay, on Jett,
  // kept "holding A Main with alarmbot deployed" for round 2, Killjoy's, and
  // sent it as what the player was seen doing. Its own notes from that match:
  // the two "behind cover" ones are the player's, though Harbor has a Cove.
  const fk = review.foreignKit;
  ok(fk('holding A Main with alarmbot deployed', 'Jett') === 'alarmbot' && fk('holding B with recon bolt ready', 'Jett') === 'recon bolt'
    && fk('player holding A Dish behind cover', 'Jett') === null && fk('player alone on A Site holding an off angle behind cover', 'Jett') === null
    && fk('peeking with blade storm out', 'Jett') === null && fk('holding A Main with a Killjoy alarmbot ahead', 'Jett') === null
    && fk('holding A Main with alarmbot deployed', null) === null && fk('holding A Main with alarmbot deployed', 'Agent Released Later') === null,
  "a read naming another agent's ability is not the player's, as a whole word, unless its owner is named; none is judged without the player's agent");
  const kit = [mk(1, { result: 'won', died: false }), mk(2, { result: 'won', reads: [{ text: 'holding A Main alone, one enemy spotted in A' },
    { text: 'holding A Main with alarmbot deployed' }, { text: 'player holding A Dish behind cover' }] }), mk(3), mk(4)];
  const kitReads = (o) => JSON.stringify(review.build({ rounds: kit, context: { map: 'Fracture', ...o }, endedBy: 'stop', ai: {} })
    .rounds.find((c) => c.n === 2).reads);
  const sentReads = (o, riot) => JSON.stringify(review.requestBody({ rounds: kit, context: { map: 'Fracture', ...o }, endedBy: 'stop', riot })
    .rounds.find((r) => r.n === 2).reads);
  const KEPT = '["holding A Main alone, one enemy spotted in A","player holding A Dish behind cover"]';
  ok(kitReads({ agent: 'Jett', agentConfirmed: true }) === KEPT && sentReads({ agent: 'Jett', agentConfirmed: true }) === KEPT
    && sentReads({ agent: 'Killjoy', agentConfirmed: false }, { agent: 'Jett', map: 'Fracture' }) === KEPT,
  `so the card and what the model is sent leave it out, by the agent the player confirmed or Riot's (${sentReads({ agent: 'Jett', agentConfirmed: true })})`);
  ok(JSON.parse(kitReads({ agent: 'Jett', agentConfirmed: false })).length === 3,
    'and an agent the player never confirmed holds no read to its kit, the engine\'s rule');
  // THE AGENT THE ENGINE READ OFF THE PLAYER'S OWN HUD (8.4.4), two answers
  // on buy phase frames that agree, nothing asked of the player: confirmed for
  // the reads as a tick was, the review's agent until Riot's record names one,
  // and Riot's from then on, every read held to Riot's agent's kit.
  const HUD = { agent: 'Jett', agentConfirmed: true, agentSource: 'hud' };
  ok(kitReads(HUD) === KEPT && sentReads(HUD) === KEPT, 'a HUD agent holds the reads to its kit, as a confirmed one does', kitReads(HUD));
  const hudBuilt = review.build({ rounds: kit, context: { map: 'Fracture', ...HUD }, endedBy: 'stop', ai: {} });
  ok(hudBuilt.game.agent === 'Jett', `the review names the HUD's agent while Riot's record is not in (${hudBuilt.game.agent})`);
  const riotTracker = { matchId: 'm', agent: 'Killjoy', map: 'Fracture', result: 'Victory', score: '5-1', kills: 12, deaths: 3, assists: 2,
    acs: 260, adr: 160, kd: 4, headshotPct: 30, startedAt: 1000 };
  const riotBuilt = review.build({ rounds: kit, context: { map: 'Fracture', ...HUD }, endedBy: 'score', ai: {}, tracker: riotTracker });
  ok(riotBuilt.game.agent === 'Killjoy' && JSON.parse(JSON.stringify(riotBuilt.rounds.find((c) => c.n === 2).reads)).length === 3,
    `and Riot's agent replaces it once the record is in, the reads held to Riot's agent's kit (${riotBuilt.game.agent}, `
    + `${JSON.stringify(riotBuilt.rounds.find((c) => c.n === 2).reads)})`);
  ok(JSON.parse(sentReads(HUD, { agent: 'Killjoy', map: 'Fracture' })).length === 3
    && review.requestBody({ rounds: kit, context: { map: 'Fracture', ...HUD }, endedBy: 'stop', riot: { agent: 'Killjoy' } }).context.agent === 'Killjoy',
  'what the model is sent with Riot\'s record names Riot\'s agent and holds the reads to its kit');
  const noAgent = review.build({ rounds: kit, context: { map: 'Fracture' }, endedBy: 'stop', ai: {} });
  ok(noAgent.game.agent === null && JSON.parse(JSON.stringify(noAgent.rounds.find((c) => c.n === 2).reads)).length === 3,
    'a match neither the HUD nor Riot named an agent for says nothing of one, and holds no read to a kit');

  // AND THE ROLE AND THE LOOK ARE RIOT'S AGENT'S TOO, in main (index.js):
  // buildValorantReview's role, which grades the match and goes on its
  // baseline row (historyEntry), and the look from the screen once the
  // scoreboard has linked and only Riot's rounds never came. No link holds a
  // HUD agent to Riot's (match-link.js linkAgentOf), so a Sova the look locked
  // where Riot has Jett was graded on an Initiator's curves, its row an
  // Initiator's, and the look's ability gate was handed Sova's kit.
  {
    const vm = require('vm');
    const mainText = require('fs').readFileSync(require('path').join(__dirname, '..', 'src', 'main', 'index.js'), 'utf8').replace(/\r\n/g, '\n');
    const fnOf = (head) => { const i = mainText.indexOf(head); const j = i < 0 ? -1 : mainText.indexOf('\n}\n', i); return j < 0 ? '' : mainText.slice(i, j + 3); };
    const built = fnOf('\nfunction buildValorantReview(');
    const screen = fnOf('\nasync function lookFromScreen(');
    ok(!!built && !!screen, 'main\'s buildValorantReview and lookFromScreen are found');
    const looked = [];
    const box = vm.createContext({
      console: { log() {} }, Date, Math, Number, JSON, Object, Array, String, Promise,
      require: (m) => { if (m !== '../shared/valorant-review') throw new Error(`${m} is not in the sandbox`); return review; },
      agentData: require('../src/main/services/agent-data'),
      store: { get: () => null },
      forensicsFor: async (rounds, snap) => { looked.push(snap.context); return { byRound: {}, frames: {} }; },
      repaintReview() {},
    });
    const main = vm.runInContext(`${built}\n${screen}\n;({ buildValorantReview, lookFromScreen })`, box);
    const snap = { rounds: kit, context: { map: 'Fracture', agent: 'Sova', agentConfirmed: true, agentSource: 'hud' }, endedBy: 'score' };
    const jett = { ...riotTracker, agent: 'Jett' };
    const linked = main.buildValorantReview(snap, jett, { history: [] });
    const fromLine = main.buildValorantReview(snap, null, { history: [], riotMe: { agent: 'Jett' } });
    const screenOnly = main.buildValorantReview(snap, null, { history: [] });
    ok(linked.role === 'Duelist' && linked.built.game.agent === 'Jett' && review.historyEntry(jett, linked.role).role === 'Duelist'
      && fromLine.role === 'Duelist' && screenOnly.role === 'Initiator',
    `the role is Riot's agent's once its record names one, the scoreboard's or Riot's own line, and its baseline row a Duelist's; the HUD's only before (${linked.role}, ${fromLine.role}, ${screenOnly.role})`);
    const noLock = main.buildValorantReview({ ...snap, context: { map: 'Fracture' } }, jett, { history: [] });
    ok(noLock.role === 'Duelist' && review.historyEntry(jett, noLock.role).role === 'Duelist',
      `and a match the look locked no agent in still gets Riot's role on its row (${noLock.role})`);
    // The look is asked for as lookFromScreen begins, before its first await.
    main.lookFromScreen({ snap, tracker: jett, cancelled: false }).catch(() => {});
    main.lookFromScreen({ snap, tracker: null, cancelled: false }).catch(() => {});
    ok(looked.length === 2 && looked[0].agent === 'Jett' && looked[0].agentConfirmed === true && looked[1].agent === 'Sova'
      && snap.context.agent === 'Sova',
    `the look from the screen after the scoreboard linked is told Riot's agent, before it the HUD's, the review's own context left as it was (${looked.map((c) => c && c.agent).join(', ')})`);

  }
  // One round won on each side is no stronger side.
  const pats = review.patterns(rows);
  const side = pats.find((p) => p.key === 'sides');
  ok(side && side.text === 'Neither side was clearly stronger: won 1 of 4 on attack and 1 of 3 on defence.',
    `one win a side names no stronger side (${side && side.text})`);
  // Post plants and retakes are the rounds the player was alive in when the
  // spike went down: rounds 1, 6 and 7 were deaths before the plant.
  const post = pats.find((p) => p.key === 'postplant');
  ok(post && post.text === 'On attack, won 1 of 2 rounds once the spike was down.' && !pats.some((p) => p.key === 'retake'),
    `a death before the plant is no post plant played, and no retake (${post && post.text})`);
  const ins = require('../src/shared/insights').valorant(rows, {});
  ok(!ins.missed.some((e) => e.key === 'postplant-lost'), 'nor a post plant that slipped');
}

// ── The review's model is told what was counted, and code holds it to it ───
{
  const D = 'no teammate killed your killer within five seconds.';
  const mk = (n, o) => ({ n, side: n <= 4 ? 'attacking' : 'defending', result: 'lost', died: true, deathSpot: null,
    deathClock: null, early: false, ultAtDeath: null, planted: false, plantSpot: null, verified: true, deathSec: 20,
    killerAgent: 'KAY/O', weapon: 'Sheriff', traded: false, kills: 1, firstKill: false, firstDeath: false,
    aliveAtDeath: { mates: 3, enemies: 4 }, reads: [], frames: 30, ...o });
  const rows = [mk(1, { traded: true, reads: [{ text: 'holding B Main with Ghost' }] }), mk(2), mk(3),
    mk(4, { result: 'won', died: false, kills: 4, firstKill: true }), mk(5, { result: 'won', died: false }), mk(6), mk(7)];
  const body = review.requestBody({ rounds: rows, context: { map: 'Sunset', agent: 'Jett' }, endedBy: 'score',
    riot: { agent: 'Jett', map: 'Sunset', score: '2-5', result: 'Defeat', scoreline: { kills: 9, deaths: 5, assists: 1, acs: 300 } } });
  const untraded = (body.mistakes || []).find((m) => m.key === 'untraded');
  ok(untraded && untraded.rounds.join() === '2,3,6,7' && untraded.detail === `4 of your 5 deaths went unanswered: ${D}`
    && !('fix' in untraded) && (body.strengths || []).some((s) => s.key === 'multi-kill'),
  'the model is sent the counted mistakes and strengths the review shows, with no fix line');
  const input = matchReview.normalise(body);
  const prompt = matchReview.buildPrompt(input);
  ok(/COUNTED MISTAKES[^\n]*\n- Died where nobody could trade \(rounds 2, 3, 6 and 7\): 4 of your 5 deaths/.test(prompt)
    && /Second, the first counted mistake in your own words, with its count exactly as given/.test(prompt),
  'the summary is asked for the first counted mistake, with its count');
  ok(/Seen in play: "holding B Main with Ghost"/.test(prompt) && !/every ten seconds/.test(prompt)
    && /Nothing done in the buy phase is a mistake/.test(prompt) && /9 kills, 5 deaths, 1 assist,/.test(prompt),
  'what was seen in play is sent as that, read a second, and the buy phase is never a mistake');
  ok(/in this order: R1, R2, R3, R6, R7\./.test(prompt), 'a line is asked only for the rounds lost to a death');
  const old = matchReview.normalise({ rounds: [{ n: 1, reads: ['standing in A Lobby during buy phase',
    'player holding Classic in spawn during buy phase', 'holding A Lobby alone'] }] });
  ok(JSON.stringify(old.rounds[0].reads) === '["holding A Lobby alone"]',
    "a client from before sends its buy phase reads, and the server keeps them from the prompt");
  // Nor its counted lists, which it counts on its own page: told "none cleared
  // the bar" under COUNTED MISTAKES, the model was told a falsehood as true.
  const before = { ...body };
  delete before.mistakes;
  delete before.strengths;
  const oldPrompt = matchReview.buildPrompt(matchReview.normalise(before));
  const noneCounted = matchReview.buildPrompt(matchReview.normalise({ ...body, mistakes: [], strengths: [] }));
  ok(!/COUNTED (?:MISTAKES|STRENGTHS)/.test(oldPrompt)
    && /COUNTED MISTAKES[^\n]*\n- none cleared the bar in this match/.test(noneCounted)
    && /COUNTED STRENGTHS[^\n]*\n- none cleared the bar in this match/.test(noneCounted),
  'and sends no counted lists, so its prompt says nothing of them, where one that counted none says so');

  // THE MODEL'S OWN REPLY TO THE PLAYER'S SUNSET MATCH, word for word, with
  // its round 3 line's first sentence in the summary too, which names no
  // mistake and blames the spawn all the same.
  const reply = 'SUMMARY: You lost the match by failing to establish early map control on attack. '
    + 'Standing idle in spawn during buy phase was the repeated mistake occurring in rounds 1, 2, 3 and 4. '
    + 'Holding a pistol in spawn prevents you from reacting quickly to enemy pushes. '
    + 'Your ability to secure first kills when you committed correctly shows your potential for impact.\n'
    + 'R1: Dying early with a utility weapon leaves your team at a numbers disadvantage before they can organize. '
    + 'You need to hold an angle from cover rather than waiting in open spawn.\n'
    + 'R2: Being dead while your team loses means you missed the chance to apply pressure earlier. '
    + 'You must stay alive through the initial engagement to trade kills effectively.\n'
    + 'R3: Holding a pistol in spawn prevents you from reacting quickly to enemy pushes. '
    + 'You should be positioned near a checkpoint to take space immediately after the round starts.\n'
    + 'R4: Opening menus in spawn delays your movement into position and wastes valuable time. '
    + 'You must close all interfaces before moving out to ensure you are ready for contact.\n'
    + 'FOCUS: Move to your first piece of cover immediately upon round start to avoid standing still in spawn '
    + 'and missing the initial exchange.';
  const p = matchReview.parse(reply, input);
  ok(p.summary === 'You lost the match by failing to establish early map control on attack. '
    + 'Your ability to secure first kills when you committed correctly shows your potential for impact.',
  `a summary sentence blaming the spawn and the buy phase is dropped (${p.summary})`);
  ok(!(1 in p.rounds) && !(3 in p.rounds) && p.rounds[2] && p.blamed.some((b) => b.n === 1 && b.said === 'spawn'),
    `and so is every round line that does, the rest kept (${Object.keys(p.rounds)})`);
  ok(!(4 in p.rounds) && !p.blamed.some((b) => b.n === 4), 'a won round with no death gets no line at all');
  ok(p.focus === null, 'and a focus on standing in spawn goes too');
  const named = matchReview.parse('SUMMARY: You lost 2 to 5. Your most repeated mistake was dying where nobody could '
    + 'trade, 4 of your 5 deaths, in rounds 2, 3, 6 and 7. The repeated mistake was holding one angle too long in '
    + 'rounds 1, 4 and 5. You won 4 of 7 duels.', input);
  ok(named.summary === 'You lost 2 to 5. Your most repeated mistake was dying where nobody could trade, 4 of your 5 '
    + 'deaths, in rounds 2, 3, 6 and 7.',
  `the counted mistake with its own count stays, one the review never counted goes, and any other count (${named.summary})`);

  // THE LIVE MODEL'S WORDS FOR THIS MATCH on the first 8.3.1 server: round 1
  // "No one traded the death" where Riot has it traded, every line the fact
  // line again, and "Riot lost 2 to 5".
  const live = matchReview.parse('SUMMARY: Riot lost 2 to 5 because you died in untradeable positions early in multiple '
    + 'rounds. You opened rounds with first kills twice.\n'
    + 'R1: You died at Mid Bottom after twenty six seconds from KAY/O\'s Sheriff while two teammates stood against three '
    + 'enemies. No one traded the death.\n'
    + 'R2: You died after twenty seven seconds from KAY/O\'s Sheriff while four teammates stood against three enemies.\n'
    + 'R3: Up four against three, hold the space you have and let them come to you instead of taking the next duel.\n'
    + 'R6: You were traded by a teammate, so keep swinging.', input);
  ok(!(1 in live.rounds) && live.dropped.some((d) => d.n === 1 && d.said === 'not traded'),
    'a line saying round 1 was not traded, where Riot traded it, goes');
  ok(!(2 in live.rounds) && live.dropped.some((d) => d.n === 2 && d.said === 'the facts again'),
    'a line that only says the round\'s facts again (killer, weapon, seconds, numbers) goes');
  ok(live.rounds[3] && /hold the space you have/.test(live.rounds[3]), 'a lesson with one fact in it stays');
  ok(!(6 in live.rounds) && live.dropped.some((d) => d.n === 6 && d.said === 'traded'),
    'and one saying a death nobody traded was traded goes too');
  ok(live.summary === 'You opened rounds with first kills twice.',
    `and a summary sentence naming Riot as the one who lost goes (${live.summary})`);
  // The second deploy's words for round 3, the prompt now saying what a trade is.
  const harm = matchReview.parse('SUMMARY: You lost 2 to 5.\nR3: Decide how you are taking an angle before you arrive '
    + 'at it because hesitating at the corner gets you traded.\nR7: Take one piece of space, survive behind cover, then '
    + 'wait for the team to reach you before pushing further.', input);
  ok(!(3 in harm.rounds) && harm.rounds[7] && harm.dropped.some((d) => d.n === 3),
    'a line warning that something "gets you traded" goes: being traded is your killer dying, never the harm');
  ok(/one sentence, at most 30 words, on what to do differently next time/.test(prompt)
    && /never restate them/.test(prompt) && /starting with You won or You lost/.test(prompt)
    && /Being traded means a teammate killed your killer within five seconds, which is good/.test(prompt),
  'the model is asked for one lesson a round, never the facts again, the summary from the player\'s own result');
  // The ledger's own labels, R2 and R7, are rounds to the gates (8.4.1): the
  // counted mistake named by them stays, written out, and one the review never
  // counted named by them still goes.
  const labelled = matchReview.parse('SUMMARY: You lost 2 to 5. Your most repeated mistake was dying where nobody could '
    + 'trade, 4 of your 5 deaths, in R2, R3, R6 and R7. The repeated mistake was holding one angle too long in R1, R4 and R5.', input);
  ok(labelled.summary === 'You lost 2 to 5. Your most repeated mistake was dying where nobody could trade, 4 of your 5 '
    + 'deaths, in rounds 2, 3, 6 and 7.',
  `a counted mistake named by its labels stays as rounds, one never counted goes (${labelled.summary})`);
}

// ── With nothing counted, one mistake in one round is no repeated mistake ──
// The player's Fracture swiftplay (8.4.1): won 5 to 1, nothing counted as a
// mistake, and the summary lost its middle sentence, the one about round 5,
// the round the match was lost in, because the gate dropped every sentence
// with "mistake" in it. And the model copied the ledger's labels into prose,
// "survived R1, R3 and R4", where the page says rounds.
{
  const R = (n, o) => ({ n, side: n <= 4 ? 'defending' : 'attacking', result: 'won', died: false, verified: true, kills: 1, ...o });
  const body = {
    rounds: [R(1), R(2, { died: true, sec: 31, killer: 'Astra', weapon: 'Sheriff', kills: 3, firstKill: true, traded: true,
      alive: { mates: 5, enemies: 1 }, deathSpot: 'A Main', cause: 'repeek' }), R(3, { kills: 2 }), R(4, { kills: 4, firstKill: true }),
    R(5, { result: 'lost', died: true, sec: 33, killer: 'Jett', weapon: 'Sheriff', kills: 2, firstKill: true, traded: false,
      alive: { mates: 4, enemies: 3 }, deathSpot: 'A Site', planted: true, cause: 'lost-duel' }),
    R(6, { died: true, sec: 3, killer: 'Chamber', kills: 0, firstDeath: true, traded: false, alive: { mates: 5, enemies: 5 },
      deathSpot: 'B Tree', planted: true, cause: 'lost-duel' })],
    patterns: [{ key: 'firstkill', text: 'You got the first kill of the round 3 times, rounds 2, 4 and 5.' }],
    mistakes: [],
    strengths: [{ key: 'first-kill', title: 'Opened rounds', detail: 'You got the first kill of the round 3 times, rounds 2, 4 and 5.', rounds: [2, 4, 5], count: 3 }],
    context: { agent: 'Jett', map: 'Fracture', language: 'en' },
    final: { team: 5, enemy: 1, result: 'Victory', verified: true, scoreline: { kills: 12, deaths: 3, assists: 2, acs: 569 } },
  };
  const input = matchReview.normalise(body);
  const MIDDLE = 'Your one costly mistake came in round 5, dying after the plant with your team up 4 against 3.';
  const p = matchReview.parse('SUMMARY: You won 5 to 1 by opening rounds and turning fights into multikills. '
    + `${MIDDLE} You also traded teammates and survived R1, R3 and R4.\n`
    + 'R5: After the plant, take a position a teammate can trade rather than holding alone; nobody traded your death.\n'
    + 'FOCUS: After the plant, check where your teammates are before taking another duel, as in R5.', input);
  ok(p.summary === `You won 5 to 1 by opening rounds and turning fights into multikills. ${MIDDLE} `
    + 'You also traded teammates and survived rounds 1, 3 and 4.',
  `the player's summary keeps its three sentences, round 5's among them, and says rounds (${p.summary})`);
  ok(p.focus === 'After the plant, check where your teammates are before taking another duel, as in round 5.',
    `and so does the focus (${p.focus})`);
  const claims = [
    'Your repeated mistake was dying after the plant in round 5.',
    'You made the same mistake again in round 6.',
    'Your mistakes in rounds 5 and 6 cost you the fights.',
    'You kept making the mistake of holding the angle alone.',
    'Your mistake in most rounds was holding the angle after the first shots.',
    'The mistake came twice, in R5 and R6.',
  ];
  const left = claims.filter((s) => matchReview.parse(`SUMMARY: You won 5 to 1. ${s}`, input).summary !== 'You won 5 to 1.');
  ok(!left.length, `but with nothing counted, a sentence saying a mistake came back still goes, by its words or its two rounds (kept: ${left.join(' | ') || 'none'})`);
  // HOW OFTEN IS A COUNT TOO: "your most common mistake" with nothing counted
  // claims one the review never counted, and went before 8.4.1 as every
  // "mistake" sentence did.
  const often = [
    'Your most common mistake was dying untraded, as in round 5.',
    'Your most frequent mistake was peeking without utility.',
    'You often made the mistake of holding the angle alone.',
    'Your usual mistake was taking the duel after the first shots.',
    'You always made the mistake of staying on the angle.',
    'Throughout the match your mistake was staying exposed.',
    'Your habitual mistake was peeking first.',
  ];
  const stayed = often.filter((s) => matchReview.parse(`SUMMARY: You won 5 to 1. ${s}`, input).summary !== 'You won 5 to 1.');
  ok(!stayed.length && matchReview.parse(`SUMMARY: You won 5 to 1. ${MIDDLE}`, input).summary === `You won 5 to 1. ${MIDDLE}`,
    `and so does one saying how often, its most common or its usual, while the one round's mistake stays (kept: ${stayed.join(' | ') || 'none'})`);
  // The labels, as text: a run of them, one alone, one at a sentence's start,
  // one already after "round", a range; and the words they must never touch.
  const L = matchReview.roundLabels;
  ok(L('You also traded teammates and survived R1, R3 and R4.') === 'You also traded teammates and survived rounds 1, 3 and 4.'
    && L('R5 was lost after the plant. In R6 you died first.') === 'Round 5 was lost after the plant. In round 6 you died first.'
    && L('in round R5 you peeked') === 'in round 5 you peeked' && L('Round R1 and R3') === 'Rounds 1 and 3'
    && L('R1 to R3 were won') === 'Rounds 1 to 3 were won' && L('R1-R3 were won') === 'Rounds 1 to 3 were won'
    && L("R10 and R12's plants") === "Rounds 10 and 12's plants",
  'R<n> written out: a run as rounds, one as round, capital at a sentence\'s start, a range with "to"');
  const untouched = ['an AR15 and R2D2 and R100', 'Raze ulted in B Main', 'You won 5 to 1.', 'rounds 2 and 5', 'r5 lower case'];
  ok(untouched.every((t) => L(t) === t) && new RegExp(matchReview.ROUND_LABELS.source).test('survived R1, R3 and R4')
    && !new RegExp(matchReview.ROUND_LABELS.source).test(untouched.join(' ')),
  'and nothing else: not a word with R and digits in it, a capital R word, a score, rounds already written, a lower case r');
  // IN AN ENGLISH REVIEW ONLY: the words written out are English, and a review
  // the player reads in Spanish or German must be natural Spanish or German
  // (languageRule). Written out there, "Sobreviviste las R1, R3 y R4" read
  // "Sobreviviste las rounds 1, 3 y round 4". The label reads in any language.
  const inLang = (code) => matchReview.normalise({ ...body, context: { ...body.context, language: code } });
  const es = matchReview.parse('SUMMARY: Ganaste 5 a 1. Sobreviviste las R1, R3 y R4.\n'
    + 'R5: Tras la plant, juega donde un aliado pueda cambiar tu muerte.\nFOCUS: Mira a tus aliados antes del duelo, como en la R5.', inLang('es'));
  const de = matchReview.parse('SUMMARY: Du hast 5 zu 1 gewonnen. In R2 und R5 bist du gestorben.', inLang('de'));
  const xx = matchReview.parse('SUMMARY: You won 5 to 1. You survived R1 and R3.', inLang('xx'));
  ok(es.summary === 'Ganaste 5 a 1. Sobreviviste las R1, R3 y R4.' && es.focus === 'Mira a tus aliados antes del duelo, como en la R5.'
    && es.rounds[5] === 'Tras la plant, juega donde un aliado pueda cambiar tu muerte.'
    && de.summary === 'Du hast 5 zu 1 gewonnen. In R2 und R5 bist du gestorben.'
    && xx.summary === 'You won 5 to 1. You survived rounds 1 and 3.',
  `and only in an English review: one in Spanish or German keeps its labels, a code the prompt writes English for is English (${es.summary} | ${de.summary} | ${xx.summary})`);
}

// ── The round after the last one ────────────────────────────────────────────
// An unrated 13 to 12 is deliberately not a final score, so it ends on the menu
// path, and the banner that printed 13 to 12 opened a round 26 nobody played.
{
  const l = new RoundLedger();
  let at = 0;
  const f = (o, dt = 2000) => { at += dt; l.observe({ at, side: 'defending', ...o }); };
  f({ team: 12, enemy: 12, phase: 'buy', clock: '0:20' });
  f({ team: 12, enemy: 12, phase: 'active', clock: '1:20' }, 40000);
  f({ team: 12, enemy: 12, phase: 'active', clock: '0:40' }, 40000);
  f({ team: 13, enemy: 12, phase: 'active', clock: '0:01' }, 30000);
  f({ team: 13, enemy: 12, phase: 'active', clock: '0:01' });
  const list = l.list();
  ok(list.length === 1 && list[0].n === 25 && list[0].result === 'won',
    `a lobby or stop end has no empty last round (${list.map((r) => r.n)})`);
  ok(l.size() === 2, 'the ledger itself still holds the banner frames, only the list leaves the round out');
  f({ team: 13, enemy: 12, phase: 'buy', clock: '0:28' }, 8000);
  ok(l.list().map((r) => r.n).join() === '25,26', 'a last round with its buy phase seen is kept');
  const d = new RoundLedger();
  d.observe({ at: 1000, team: 3, enemy: 3, phase: 'buy', clock: '0:20' });
  d.observe({ at: 60000, team: 3, enemy: 3, phase: 'active', clock: '0:30' });
  d.observe({ at: 90000, team: 3, enemy: 4, phase: 'dead', clock: '0:01', died: true });
  ok(d.list().map((r) => r.n).join() === '7', 'and a banner death is filed back, so it keeps no round of its own');
}

// ── What Riot's check says it changed ───────────────────────────────────────
{
  const verify = require('../src/shared/valorant-verify');
  const riot = load('riot-abyss-13-11.json');
  const mk = (n, died) => ({ n, side: 'defending', result: 'lost', died, deathSpot: null, deathClock: null, early: false,
    ultAtDeath: null, ultSeen: null, planted: false, plantSpot: null, locs: [], reads: [], frames: 5 });
  const line = (ledger, per) => verify.describe(verify.reconcile(ledger, { perRound: per }).checks);
  const R = (n, died) => ({ n, died, deathMs: died ? 20000 : null, won: false });

  // A death filed a round late: equal totals, different rounds.
  const moved = line([mk(4, false), mk(5, false), mk(6, true)], [R(4, false), R(5, true), R(6, false)]);
  ok(moved === "Checked against Riot's record of the match: the screen read 1 death and Riot has 1, "
    + 'with none in round 6 and one in round 5 the screen missed.', `a moved death is never "confirmed" (${moved})`);
  ok(line([mk(1, true), mk(2, false)], [R(1, true), R(2, false)])
    === "Checked against Riot's record of the match: Riot confirms the one death the screen read.", 'one death, in words');
  ok(line([mk(1, false), mk(2, false)], [R(1, false), R(2, false)])
    === "Checked against Riot's record of the match: the screen read no deaths, and Riot has none either.", 'and none');
  ok(line([mk(1, true)], [R(1, false)]) === "Checked against Riot's record of the match: the screen read 1 death, in round 1, and Riot has none.",
    'a death Riot does not have');

  // Watched from round 15: Riot's deaths before it are not the screen's to miss.
  const late = abyss.rounds.filter((r) => r.n >= 15);
  const c = verify.reconcile(late, riot);
  ok(c.checks.watched === 10 && c.checks.screenDeaths === 9 && c.checks.riotDeaths === 8,
    `counted over the 10 rounds the coach watched (${c.checks.watched}, ${c.checks.screenDeaths}, ${c.checks.riotDeaths})`);
  const said = verify.describe(c.checks);
  ok(said.startsWith("Checked against Riot's record of the 10 rounds the coach watched: the screen read 9 deaths and Riot has 8, with none in round 17."),
    `and said that way (${said})`);
  ok(!/21/.test(said), 'never against the 21 deaths of rounds it never saw');
  // NOTHING ABOUT THE NOTES IT DROPPED (8.3.1): the page shows none of them,
  // and calls the summary and each round's why the coach's read, so "Riot
  // contradicts one of the coach's reads, so it is hidden" read as one of those
  // taken down.
  const one = verify.describe({ ...c.checks, readsDropped: 1 });
  const many = verify.describe({ ...c.checks, readsDropped: 3 });
  ok(one === said && many === said && !/coach's reads?|hidden/.test(one),
    `the notes Riot contradicts are dropped, and the line says nothing of them (${one})`);
  // Built from code points, so this file never carries the character it bans.
  const dashed = (t) => [0x2013, 0x2014].some((c) => t.includes(String.fromCharCode(c)));
  ok(dashed(`a ${String.fromCharCode(0x2014)} b`) && !dashed('a - b'), 'the dash check catches a dash and lets a hyphen through');
  ok(![moved, said, one].some(dashed), 'no line carries a dash');

  // The review over that partial session.
  const partial = review.build({ rounds: c.rounds, context: abyss.context, endedBy: 'stop', verification: said });
  ok(partial.watched.rounds === 10 && partial.watched.deaths === 8,
    `the header counts the rounds the coach saw, not Riot's 24 (${partial.watched.rounds} watched, ${partial.watched.deaths} deaths)`);
  ok(!partial.refused.some((t) => /stopped before/.test(t)),
    'stopped on the last round, the review does not claim the match went on');
  // NOTHING SEEN ON SCREEN, never "no coach's read" (8.3.1): the page calls
  // each round's why the coach's read, and the narrative Riot's record is sent
  // writes one for a round lost to a death the coach never watched (round 3 of
  // this session among them, teachable() on the server).
  ok(partial.refused.includes("Riot's record fills in rounds 1 to 14, which the coach did not watch, so those rounds have no death location and nothing seen on screen."),
    `and it says where the other rounds come from (${partial.refused.join(' | ')})`);
  const linesFor = matchReview.teachable(matchReview.normalise(review.requestBody({ rounds: c.rounds, context: abyss.context,
    endedBy: 'stop', tips: [], notes: [] })).rounds);
  ok(linesFor.some((n) => n < 15) && !partial.refused.some((t) => /coach's read/.test(t)),
    `so a round it never watched can carry a line, and no refusal says it has none (lines for ${linesFor.join(', ')})`);
  const early = verify.reconcile(abyss.rounds.filter((r) => r.n <= 20), riot);
  const cut = review.build({ rounds: early.rounds, context: abyss.context, endedBy: 'stop' });
  ok(cut.refused.includes("Coaching was stopped before the match ended. Riot's record fills in rounds 21 to 24, "
    + 'which the coach did not watch, so those rounds have no death location and nothing seen on screen.'),
    `stopped at round 20 of 24, Riot's record shows the match went on (${cut.refused.join(' | ')})`);
  // A review saved before 8.3.1 says the two in today's words where it is shown
  // (served, from present() in index.js), and the saved one is left as it was.
  const before = { ...cut, verification: `${said} Riot contradicts one of the coach's reads, so it is hidden.`,
    refused: cut.refused.map((t) => t.replace('no death location and nothing seen on screen.', "no location or coach's read.")) };
  const beforeMany = { ...before, verification: `${said} Riot contradicts 3 of the coach's reads, so they are hidden.` };
  const shownBefore = review.served(before);
  ok(shownBefore.verification === said && review.served(beforeMany).verification === said
    && JSON.stringify(shownBefore.refused) === JSON.stringify(cut.refused)
    && /reads, so it is hidden\.$/.test(before.verification) && before.refused.some((t) => t.endsWith("no location or coach's read.")),
  `a review saved before says them in today's words when shown, and is left as it was (${shownBefore.verification} | ${shownBefore.refused.join(' | ')})`);
  ok(JSON.stringify(review.served(cut)) === JSON.stringify(cut), 'and one built today is shown as it was built');
  ok(review.spans([1, 2, 3, 4, 24]) === 'rounds 1 to 4 and 24' && review.spans([5, 6, 9]) === 'rounds 5, 6 and 9'
    && review.spans([7]) === 'round 7', 'round runs read as a person would write them');
}

// ── 8.3.1: a death is Riot's only at Riot's moment ─────────────────────────
// The player's Sunset swiftplay, read a second, through the real reader, its
// frames as the AI log keeps them. 8.3.0 filed round 5's defuse, 436.8 to
// 461.1 s, under round 6, and with it a false death read at 459.1 s off the
// SPECTATORS counter: round 6 kept it, a minute before Riot's round 6 death,
// and the line counted the two as one. Riot's record of the match is not in
// the repo: each death's milliseconds here are its round's barriers dropping
// (barrierDrop) to the death its clip shows, round 1's, which has no clip,
// between its last frame alive and its first dead.
{
  const { replaySession } = require('./fixtures/replay-session');
  const deathFrames = require('../src/shared/death-frames');
  const sunset = replaySession('valorant-session-sunset-swiftplay.json', null);
  const wall = (s) => sunset.t0 + s * 1000;
  const DEATH = { 1: 70.4, 2: 163.5, 3: 252.62, 6: 518.1, 7: 614.7 };
  const as830 = sunset.records.map((x) => (x.at >= wall(436.8) && x.at <= wall(461.15)
    ? { ...x, round: 6, died: x.died || Math.abs(x.at - wall(459.1)) < 50 } : x));
  const riotOf = (records) => ({ perRound: [1, 2, 3, 4, 5, 6, 7].map((n) => {
    const drop = deathFrames.barrierDrop(records, n, sunset.window);
    const died = n in DEATH;
    return { n, won: n === 4 || n === 5, died, deathMs: died && drop ? Math.round(wall(DEATH[n]) - drop.at) : null, planted: false };
  }) });
  // 8.3.0's ledger: a death in every round but 4, round 6's at A Site with the ultimate ready.
  const row = (n, died, extra) => ({ n, side: n <= 4 ? 'attacking' : 'defending', result: null, died, deathSpot: died ? 'Mid Top' : null,
    deathClock: null, early: false, ultAtDeath: null, ultSeen: null, planted: false, plantSpot: null, locs: [], reads: [], frames: 30, ...(extra || {}) });
  const rows = [1, 2, 3, 4, 5, 6, 7].map((n) => row(n, n !== 4, n === 6
    ? { deathSpot: 'A Site', ultAtDeath: 'ready', reads: [{ text: 'You went down holding A Elbow.', death: true }] } : {}));
  const then = verify.reconcile(rows, riotOf(as830), { records: as830, window: sunset.window });
  const e6 = then.checks.early[0];
  ok(then.checks.invented.join() === '5,6' && then.checks.agreed === 4 && then.checks.early.length === 1 && e6.n === 6 && e6.s === 59,
    `filed as 8.3.0 filed it, round 6's death read 59 s before Riot's is one the screen invented, with round 5's (${JSON.stringify(then.checks)})`);
  const r6 = then.rounds.find((r) => r.n === 6);
  ok(r6.died && !r6.screenDied && r6.deathSpot === null && r6.ultAtDeath === null && !r6.reads.length && then.checks.readsDropped === 1,
    'and nothing of it is laid over Riot\'s death: no place, no ultimate, no read of it, and no frame of it as the one that registered Riot\'s');
  const said = verify.describe(then.checks);
  ok(said === "Checked against Riot's record of the match: the screen read 6 deaths and Riot has 5, with none in round 5 and one in round 6 the screen read 59 s before Riot's."
    && !/hidden|coach's read/.test(said), `the line says it in numbers alone (${said})`);
  // As the ledger files it now, round 6's own death registered 1.9 s after Riot's is Riot's.
  const now = verify.reconcile(rows, riotOf(sunset.records), { records: sunset.records, window: sunset.window });
  ok(now.checks.agreed === 5 && now.checks.invented.join() === '5' && !now.checks.early.length
    && now.rounds.find((r) => r.n === 6).deathSpot === 'A Site' && verify.describe(now.checks).endsWith('with none in round 5.'),
  'a death the screen registered just after Riot\'s is Riot\'s, and keeps the place the screen read');
  const untimed = verify.reconcile(rows, riotOf(as830));
  ok(untimed.checks.agreed === 5 && !untimed.checks.early.length && untimed.rounds.find((r) => r.n === 6).deathSpot === 'A Site',
    'and with no AI log frames to time them, a death is Riot\'s by its round alone, as before');
  const mainSrc = require('fs').readFileSync(require('path').join(__dirname, '..', 'src', 'main', 'index.js'), 'utf8');
  const lookSrc = mainSrc.slice(mainSrc.indexOf('const riotLook = async'), mainSrc.indexOf('deathFrames.withRiotTimes(rounds, riot)'));
  ok(/verify\.reconcile\(snap\.rounds, riot,\s*\{ records: snap\.log \? snap\.log\.records : null, window: \{ from: snap\.startedAt, to: snap\.endedAt \} \}\)/.test(lookSrc),
    'and main hands the check the match\'s AI log frames and window when Riot\'s record lands (riotLook in index.js)');

  // AFTER RIOT'S IS NOT CHECKED. Registered late is the same death, the
  // spectator trap: the real Abyss session, read every nine seconds, through
  // the real reader, against Riot's real record of it.
  const ABYSS = load('riot-abyss-13-11.json');
  const session = replaySession('valorant-session-abyss-unrated.json', null);
  const timed = verify.reconcile(session.rounds, ABYSS, { records: session.records, window: session.window });
  const gapOf = (rr) => {
    const m = deathFrames.deathMoment(session.records, { n: rr.n, died: true, deathMs: rr.deathMs, plantMs: rr.plantMs, afterPlant: rr.afterPlant }, session.window);
    const reg = deathFrames.framesFor(session.records, { n: rr.n, died: true, verified: false, screenDied: true }, session.window).find((f) => f.died);
    return m !== null && reg ? (reg.at - m) / 1000 : null;
  };
  const late = ABYSS.perRound.filter((rr) => rr.died && (session.rounds.find((r) => r.n === rr.n) || {}).died)
    .map((rr) => ({ n: rr.n, gap: gapOf(rr) })).filter((g) => g.gap !== null && g.gap > 5);
  ok(late.length >= 2 && late.some((g) => g.gap > 20) && late.every((g) => !timed.checks.early.some((e) => e.n === g.n))
    && timed.checks.early.every((e) => e.s > 5),
  `a death registered after Riot's, however late, is Riot's: ${late.map((g) => `R${g.n} ${g.gap.toFixed(1)} s after`).join(', ')}`
    + ` (counted early: ${timed.checks.early.map((e) => `R${e.n} ${e.s} s before`).join(', ') || 'none'})`);
}

// ── 8.2.1: the watch ended it too soon, said only where it did ──────────────
// The real Split match: the screen's 8 rounds, ended at 3 to 5 on a wrong
// swiftplay lock, with Riot's record of all 20 laid over them. Riot stood at
// 3 to 5 after round 8, so a recording STOPPED there reads like one the watch
// ended there, and only the second may say the coach thought the match was
// over: the first was the player pressing Stop, and nearly every review
// stopped mid match and checked by Riot would say it otherwise.
{
  const riotReview = require('../src/shared/riot-review');
  const SPLIT = load('riot-split-13-7.json');
  const SAVED = load('valorant-review-split-801.json');
  const { rows: eight } = riotReview.ledgerRows(SAVED.review);
  const ctx = { map: 'Split', agent: 'Jett', agentConfirmed: true, teamScore: 3, enemyScore: 5, gameMode: 'swiftplay' };
  const laid = (endedBy) => review.build({ rounds: verify.reconcile(eight, SPLIT).rounds, context: ctx, endedBy, ai: {},
    riotMe: SPLIT.me, queue: SPLIT.queue });
  const over = (rv) => rv.refused.some((l) => /thought the match was over/.test(l));
  const asStop = laid('stop');
  const asScore = laid('score');
  ok(eight.length === 8 && asStop.verified && asStop.rounds.length === 20 && !over(asStop)
    && asStop.refused.some((l) => l.startsWith("Coaching was stopped before the match ended. Riot's record fills in rounds 9 to 20")),
  `stopped at 3 to 5, where Riot stood after round 8, it says recording stopped, never that the coach thought `
    + `the match was over (${asStop.refused.join(' | ')})`);
  ok(over(asScore) && asScore.refused.some((l) => l.startsWith('The coach thought the match was over at 3 to 5, and it went on.')),
    'and ended there by the watch, on its score, it says the coach thought the match was over');

  // GIVEN UP ON BEFORE RIOT HAD THE MATCH. One the watch ended on a score
  // only swiftplay ends on may have gone on, and Riot publishes a match once
  // it is over, so the link that gave up on it (match-link.js mayGoOn) says
  // so, never that the match was played on another account.
  const gaveUp = review.build({ rounds: eight, context: ctx, endedBy: 'score', ai: {}, riotIdSet: true, linkMissing: 'later' });
  const lost = review.build({ rounds: eight, context: ctx, endedBy: 'score', ai: {}, riotIdSet: true, linkMissing: true });
  const LATER = "Riot's record of this match was not found yet. The coach ended it at 3 to 5, a score only Swiftplay ends on, "
    + "so the match may have gone on after that. It is checked against Riot's record again at a later launch "
    + 'with your Riot ID connected, or now with Grade my recent matches in Matches.';
  const anotherAccount = (lines) => lines.some((l) => /another account/.test(l));
  ok(gaveUp.refused.includes(LATER) && !anotherAccount(gaveUp.refused) && !anotherAccount(gaveUp.grade.notes)
    && gaveUp.grade.notes.some((n) => /may have gone on after the coach ended it/.test(n)),
  `a link given up on an end that may have gone on says it may have, and that it is checked again (${gaveUp.refused.join(' | ')})`);
  ok(anotherAccount(lost.refused) && anotherAccount(lost.grade.notes), 'while any other link given up on says what it always did');
  const dashed = (t) => [0x2013, 0x2014].some((c) => String(t).includes(String.fromCharCode(c)));
  ok(![...gaveUp.refused, ...gaveUp.grade.notes].some(dashed), 'and no line of it carries a dash');
}

// ── a or an ─────────────────────────────────────────────────────────────────
{
  const a = review.withArticle;
  ok(a('Outlaw') === 'an Outlaw' && a('Operator') === 'an Operator' && a('Odin') === 'an Odin' && a('Ares') === 'an Ares',
    'an Outlaw, an Operator, an Odin, an Ares');
  ok(a('Vandal') === 'a Vandal' && a('Marshal') === 'a Marshal' && a('Sheriff') === 'a Sheriff', 'a Vandal, a Marshal, a Sheriff');
  const card = review.roundFacts({ verified: true, died: true, deathSpot: 'B Site', deathSec: 28, killerAgent: 'Cypher', weapon: 'Outlaw' });
  ok(card[0] === 'Died at B Site, 28s in, to Cypher with an Outlaw', `the round card (${card[0]})`);
}

// ── A weapon is a name, never a type (8.4.1) ────────────────────────────────
// The player's Fracture swiftplay, round 6: Riot's record gave the kill no
// weapon name (most likely Chamber's Headhunter), the server took HenrikDev's
// type for one, and the card, the strip and both prompts read "to Chamber with
// a Weapon".
{
  const riotRounds = require('../server/services/riot-rounds');
  const me = { name: 'Me', tag: 'EUW', puuid: 'p1', team_id: 'Blue', agent: { name: 'Jett' }, stats: { kills: 0, deaths: 2, assists: 0 } };
  const foe = { name: 'Foe', tag: 'EUW', puuid: 'p2', team_id: 'Red', agent: { name: 'Chamber' }, stats: {} };
  const d = {
    metadata: { map: { name: 'Fracture' }, queue: { id: 'swiftplay' } },
    players: [me, foe],
    teams: [{ team_id: 'Blue', rounds: { won: 0 } }, { team_id: 'Red', rounds: { won: 3 } }],
    rounds: [{ winning_team: 'Red' }, { winning_team: 'Red' }, { winning_team: 'Red' }],
    kills: [
      { round: 0, time_in_round_in_ms: 3000, killer: { puuid: 'p2' }, victim: { puuid: 'p1' }, weapon: { id: 'x', name: null, type: 'Weapon' } },
      { round: 1, time_in_round_in_ms: 9000, killer: { puuid: 'p2' }, victim: { puuid: 'p1' }, weapon: { id: 'Ultimate', name: null, type: 'Ability' } },
      { round: 2, time_in_round_in_ms: 9000, killer: { puuid: 'p2' }, victim: { puuid: 'p1' }, weapon: { id: 'y', name: 'Marshal', type: 'Weapon' } },
    ],
  };
  const per = riotRounds.parse(d, 'Me', 'EUW').perRound;
  ok(per[0].weapon === null && per[1].weapon === null && per[2].weapon === 'Marshal',
    `the server names a kill's weapon by its name alone: none for "Weapon" or "Ability", "Marshal" for the Marshal (${per.map((r) => r.weapon).join(', ')})`);
  ok(riotRounds.weaponOf({ damage_weapon_name: 'Spectre' }) === 'Spectre' && riotRounds.weaponOf({ weapon: { name: 'Ability' } }) === null
    && riotRounds.weaponOf({ weapon: { name: 'Melee', type: 'Melee' } }) === 'Melee' && riotRounds.weaponOf({}) === null,
  "an older payload's own name still counts, a type word in the name field is none, and the knife's name stays");
  const { weaponName, NOT_A_WEAPON } = verify;
  ok(JSON.stringify(NOT_A_WEAPON) === JSON.stringify(riotRounds.NOT_A_WEAPON),
    'the client and the server hold the same words that name no weapon');
  ok(weaponName('Weapon') === null && weaponName('ability') === null && weaponName('Grenade Ability') === null && weaponName('') === null
    && weaponName(null) === null && weaponName(' Sheriff ') === 'Sheriff' && weaponName('Headhunter') === 'Headhunter',
  'and the client reads a type word as no weapon, a server from before still sending one');
  const fromOld = verify.reconcile([], { perRound: [
    { n: 6, won: true, side: 'attacking', kills: 0, died: true, deathMs: 3000, killerAgent: 'Chamber', weapon: 'Weapon', firstDeath: true },
    { n: 2, won: true, side: 'defending', kills: 3, died: true, deathMs: 31000, killerAgent: 'Astra', weapon: 'Sheriff' },
  ] }).rounds;
  ok(fromOld.find((r) => r.n === 6).weapon === null && fromOld.find((r) => r.n === 2).weapon === 'Sheriff',
    "where Riot's record enters the client, so neither prompt is told one");
  const six = review.roundFacts(fromOld.find((r) => r.n === 6));
  ok(six[0] === 'Died 3s in, to Chamber', `the round card says "to Chamber" (${six[0]})`);
  // SAVED WITH ONE, shown without it, never rewritten: the player's own card,
  // one from before 8.0.3 with no Riot fields, and a review graded from Riot's
  // record alone.
  const saved = {
    kind: 'valorant', source: 'watched',
    rounds: [
      { n: 2, facts: ['Died at A Main, 31s in, to Astra with a Sheriff', '5 against 1 when you died'], riot: { sec: 31, killer: 'Astra', weapon: 'Sheriff' } },
      { n: 6, facts: ['Died at B Tree, 3s in, to Chamber with a Weapon', 'First death of the round', 'Not traded'], riot: { sec: 3, killer: 'Chamber', weapon: 'Weapon' } },
      { n: 9, facts: ['Died at A Site, 20s in, to Raze with an Ability'] },
    ],
    insights: { mistakes: [], strengths: [], missed: [] },
  };
  const before = JSON.stringify(saved);
  const shown = review.served(saved);
  const at = (rv, n) => rv.rounds.find((c) => c.n === n);
  ok(at(shown, 6).facts[0] === 'Died at B Tree, 3s in, to Chamber' && at(shown, 6).riot.weapon === null
    && at(shown, 6).facts.slice(1).join() === 'First death of the round,Not traded',
  `a review saved with "with a Weapon" is shown "to Chamber", its Riot facts with no weapon (${at(shown, 6).facts[0]})`);
  ok(at(shown, 9).facts[0] === 'Died at A Site, 20s in, to Raze' && at(shown, 2).facts[0] === 'Died at A Main, 31s in, to Astra with a Sheriff'
    && at(shown, 2).riot.weapon === 'Sheriff',
  'a card from before 8.0.3 is read off its death line alone, and a real weapon stays');
  ok(JSON.stringify(saved) === before, 'and the review handed in is not changed: on disk it stays as it was saved');
  const riotOnly = review.served({ ...JSON.parse(before), source: 'riot', grade: { notes: [], categories: [] } });
  ok(at(riotOnly, 6).facts[0] === 'Died at B Tree, 3s in, to Chamber' && at(riotOnly, 6).riot.weapon === null,
    "and so is one graded from Riot's record alone");
}

// ── The v4 parser, on a small synthetic match ───────────────────────────────
{
  const riotRounds = require('../server/services/riot-rounds');
  const me = { name: 'Me', tag: 'EUW', puuid: 'p1', team_id: 'Blue', agent: { name: 'Jett' }, stats: { kills: 1, deaths: 1, assists: 0 } };
  const foe = { name: 'Foe', tag: 'EUW', puuid: 'p2', team_id: 'Red', agent: { name: 'Sova' }, stats: {} };
  const d = {
    metadata: { map: { name: 'Bind' }, queue: { id: 'unrated' } },
    players: [me, foe],
    teams: [{ team_id: 'Blue', won: true, rounds: { won: 1, lost: 1 } }, { team_id: 'Red', won: false, rounds: { won: 1, lost: 1 } }],
    rounds: [
      { winning_team: 'Red', plant: { round_time_in_ms: 20000, site: 'A' } },
      { winning_team: 'Blue', plant: null },
    ],
    kills: [
      { round: 0, time_in_round_in_ms: 12000, killer: { puuid: 'p2' }, victim: { puuid: 'p9' }, weapon: { name: 'Vandal' } },
      { round: 0, time_in_round_in_ms: 25000, killer: { puuid: 'p2' }, victim: { puuid: 'p1' }, weapon: { name: 'Vandal' } },
      { round: 1, time_in_round_in_ms: 8000, killer: { puuid: 'p1' }, victim: { puuid: 'p2' }, weapon: { name: 'Sheriff' } },
    ],
  };
  const out = riotRounds.parse(d, 'Me', 'EUW');
  ok(out.perRound.length === 2 && out.score === '1-1', `two rounds, 1-1 (${out.score})`);
  const [a, b] = out.perRound;
  ok(a.n === 1 && a.died && a.deathMs === 25000 && a.killerAgent === 'Sova' && a.weapon === 'Vandal',
    'Riot counts rounds from 0, the death lands in round 1 with its killer\'s agent');
  ok(!a.firstDeath && a.afterPlant && a.won === false, 'not the first death, after the plant, and a loss');
  ok(a.side === 'defending' && b.side === 'defending', 'blue defends the first half, red attacks it');
  ok(b.kills === 1 && b.firstKill && !b.died && b.won === true, 'round 2: the opening kill and a win');
  ok(riotRounds.parse(d, 'Nobody', 'X').error, 'a Riot ID not in the match is an error, never somebody else\'s rounds');
  ok(riotRounds.attackersOf(25, 12) === 'red' && riotRounds.attackersOf(26, 12) === 'blue', 'overtime swaps every round');
  ok(riotRounds.attackersOf(5, 4) === 'blue', 'swiftplay halves are four rounds');
  ok(a.traded === null && a.aliveAtDeath === null, 'a feed with a player off the roster says nothing about teamwork');
  ok(a.feed.every((k) => !('killer' in k) && !('victim' in k)), 'the feed carries sides and times, never who');
  // THE PLANT'S SITE (8.3.1), read and never sent before, so the review kept
  // the screen's.
  const older = riotRounds.parse({ ...d, rounds: [{ winning_team: 'Red', plant_events: { plant_site: 'b', plant_time_in_round: 30000 } }, d.rounds[1]] }, 'Me', 'EUW');
  ok(a.plantSite === 'A' && b.plantSite === null && older.perRound[0].plantSite === 'B' && older.perRound[0].plantMs === 30000,
    `Riot's site comes with each round planted, in either shape, and none where nothing was (${a.plantSite}, ${b.plantSite}, ${older.perRound[0].plantSite})`);
  ok(riotRounds.plantSiteOf({ site: 'C Site' }) === 'C' && riotRounds.plantSiteOf({ site: 'Attackers' }) === null
    && riotRounds.plantSiteOf({ site: 'D' }) === null && riotRounds.plantSiteOf(null) === null, 'a site is A, B or C, and nothing else is one');

  // Teamwork, on a full ten player round.
  const P = (id, team) => ({ name: id, tag: 'T', puuid: id, team_id: team, agent: { name: 'Jett' }, stats: {} });
  const blue = ['me', 'b2', 'b3', 'b4', 'b5'].map((id) => P(id, 'Blue'));
  const red = ['r1', 'r2', 'r3', 'r4', 'r5'].map((id) => P(id, 'Red'));
  const K = (ms, killer, victim) => ({ round: 0, time_in_round_in_ms: ms, killer: { puuid: killer }, victim: { puuid: victim }, weapon: { name: 'Vandal' } });
  const full = (kills, winner) => riotRounds.parse({
    metadata: { map: { name: 'Bind' }, queue: { id: 'competitive' } },
    players: [...blue, ...red],
    teams: [{ team_id: 'Blue', rounds: { won: 1 } }, { team_id: 'Red', rounds: { won: 0 } }],
    rounds: [{ winning_team: winner }],
    kills,
  }, 'me', 'T').perRound[0];

  const traded = full([K(10000, 'r1', 'me'), K(13000, 'b2', 'r1')], 'Red');
  ok(traded.traded === true && traded.aliveAtDeath.mates === 5 && traded.aliveAtDeath.enemies === 5,
    'died in the opening duel and a teammate killed the killer three seconds later: traded');
  const alone = full([K(10000, 'r1', 'me'), K(19000, 'b2', 'r1')], 'Red');
  ok(alone.traded === false, 'nine seconds later is not a trade');
  const trader = full([K(10000, 'r1', 'b2'), K(11500, 'me', 'r1')], 'Blue');
  ok(trader.trades === 1 && trader.traded === null, 'killing the player who just killed a teammate is a trade made');
  const up = full([K(5000, 'b2', 'r1'), K(6000, 'b3', 'r2'), K(20000, 'r3', 'me')], 'Red');
  ok(up.aliveAtDeath.mates === 5 && up.aliveAtDeath.enemies === 3, 'died five against three: the advantage is on record');
  const clutch = full([K(5000, 'r1', 'b2'), K(6000, 'r1', 'b3'), K(7000, 'r2', 'b4'), K(8000, 'r2', 'b5'),
    K(20000, 'me', 'r1'), K(25000, 'me', 'r2')], 'Blue');
  ok(clutch.clutch && clutch.clutch.vs === 5 && clutch.clutch.won === true, 'last one standing against five, and won it');
}

// ── Riot's record by agent and gun, and the name set kept on the server (8.5.0) ─
// Both comps and each kill's agents and gun reach the reply, so Ask Coach can
// tell a round in order; the players' names go into the match's name set,
// hashed on the server, and into nothing the parse returns.
{
  const riotRounds = require('../server/services/riot-rounds');
  const P = (id, team, agent) => ({ name: `Name${id}`, tag: `T${id}`, puuid: `puuid-${id}-x`, team_id: team, agent: { name: agent }, stats: {} });
  const players = [P('me', 'Blue', 'Jett'), P('b2', 'Blue', 'Omen'), P('b3', 'Blue', 'Sova'), P('b4', 'Blue', 'Killjoy'), P('b5', 'Blue', 'Raze'),
    P('r1', 'Red', 'Reyna'), P('r2', 'Red', 'Viper'), P('r3', 'Red', 'Fade'), P('r4', 'Red', 'Cypher'), { ...P('r5', 'Red', 'Neon'), agent: null }];
  const K = (round, ms, killer, victim, weapon) => ({ round, time_in_round_in_ms: ms, killer: { puuid: `puuid-${killer}-x` },
    victim: { puuid: `puuid-${victim}-x` }, weapon });
  const d = {
    metadata: { map: { name: 'Bind' }, queue: { id: 'competitive' } },
    players,
    teams: [{ team_id: 'Blue', rounds: { won: 1 } }, { team_id: 'Red', rounds: { won: 1 } }],
    rounds: [{ winning_team: 'Red' }, { winning_team: 'Blue' }],
    kills: [K(0, 9000, 'r1', 'me', { name: 'Sheriff', type: 'Weapon' }), K(0, 12000, 'b2', 'r1', { name: 'Vandal' }),
      K(1, 7000, 'me', 'r3', { name: null, type: 'Ability' }), K(1, 8000, 'r5', 'b4', { name: 'Phantom' })],
  };
  const out = riotRounds.parse(d, 'Nameme', 'Tme');
  ok(JSON.stringify(out.comps) === JSON.stringify({
    us: [{ agent: 'Jett', role: 'Duelist' }, { agent: 'Killjoy', role: 'Sentinel' }, { agent: 'Omen', role: 'Controller' },
      { agent: 'Raze', role: 'Duelist' }, { agent: 'Sova', role: 'Initiator' }],
    them: [{ agent: 'Cypher', role: 'Sentinel' }, { agent: 'Fade', role: 'Initiator' }, { agent: 'Reyna', role: 'Duelist' }, { agent: 'Viper', role: 'Controller' }] }),
  `both comps by agent and role, sorted by agent, a player the payload names no agent for left out (${JSON.stringify(out.comps)})`);
  const [r1, r2] = out.perRound.map((r) => r.feed);
  ok(JSON.stringify(r1) === JSON.stringify([{ ms: 9000, by: 'enemy', on: 'me', ka: 'Reyna', va: 'Jett', w: 'Sheriff' },
    { ms: 12000, by: 'mate', on: 'enemy', ka: 'Omen', va: 'Reyna', w: 'Vandal' }])
    && JSON.stringify(r2) === JSON.stringify([{ ms: 7000, by: 'me', on: 'enemy', ka: 'Jett', va: 'Fade', w: null },
      { ms: 8000, by: 'enemy', on: 'mate', ka: null, va: 'Killjoy', w: 'Phantom' }]),
  'each kill says both ends by agent, a player with no agent none, and its gun by name or none, never its type');
  ok(out.perRound[0].traded === true && out.perRound[0].killerAgent === 'Reyna' && out.perRound[0].weapon === 'Sheriff',
    'and the round facts every client reads are as they were');
  ok(!/Name(me|b\d|r\d)|\bT(me|b\d|r\d)\b|puuid-/.test(JSON.stringify(out)), 'nothing the parse returns carries a name, a tag or an id');
  const older = riotRounds.parse({ ...d, players: { all_players: players }, teams: { blue: { rounds_won: 1 }, red: { rounds_won: 1 } } }, 'Nameme', 'Tme');
  ok(JSON.stringify(older.comps) === JSON.stringify(out.comps), 'an older payload\'s shape gives the same comps');
  const replication = riotRounds.compsOf([P('a', 'Blue', 'Jett'), P('b', 'Blue', 'Jett'), P('c', 'Red', 'Sage')], 'blue');
  ok(JSON.stringify(replication) === '{"us":[{"agent":"Jett","role":"Duelist"},{"agent":"Jett","role":"Duelist"}],"them":[{"agent":"Sage","role":"Sentinel"}]}',
    'a Replication team is five of one agent, each listed');
  const ID = '6f1e2d3c-bbbb-4ccc-8ddd-abcdefabcdef';
  riotRounds.noteNames(ID, { players: [...players, { name: 'Hold Phantom', tag: '1234' }, { name: 'xo', tag: 'EUW' }] });
  const set = riotRounds.nameSetOf(ID);
  ok(set && set.has('nice shot nameb2') && set.has('the tr3 tag') && set.has('EUW') && !set.has('Hold the angle with your Phantom')
    && !set.has('1234 damage') && !set.has('xo') && JSON.stringify(set) === '{}',
  "the match's name set holds every word of the names and tags but the game's, plain English, digits and words under three letters, and prints nothing");
  // The name gate's own words are no word of a name to the set either: a
  // player called "Behind Cover" with the tag "Angle" took every look line
  // saying "fall back behind cover" or "staying on the angle" with them.
  const PLAY = 'c0ffee00-1111-4222-8333-444455556666';
  riotRounds.noteNames(PLAY, { players: [{ name: 'Behind Cover', tag: 'Angle' }, { name: 'Tessik', tag: 'Crosshair' }] });
  const play = riotRounds.nameSetOf(PLAY);
  ok(play && play.has('Your teammate Tessik was ahead of you.') && !play.has('Fall back behind cover after the first exchange.')
    && !play.has('You stayed on the angle with your crosshair low.'),
  "and the name gate's plain words of play are none of its words, while the rest of a name is");
}

// ── The real swiftplay match ────────────────────────────────────────────────
{
  const sp = replay(load('valorant-match-swiftplay-2-5.json').frames, 'swiftplay');
  ok(sp.endedBy === 'score' && sp.rounds.length === 7, `the 2 to 5 swiftplay ends on its score with 7 rounds (${sp.endedBy}, ${sp.rounds.length})`);
  const rv = review.build({ rounds: sp.rounds, context: sp.context, endedBy: sp.endedBy });
  ok(rv.game.result === 'Defeat' && rv.halftimeAfter === 4, 'a defeat, with halftime after round 4');
}

// ── 8.0.3: cards carry what the breakdown counts, a Riot only review, the ledger ──
{
  const played = replay(load('valorant-match-abyss-13-11.json').frames, 'standard');
  const riotRec = load('riot-abyss-13-11.json');
  const { rounds: vr } = verify.reconcile(played.rounds, riotRec);
  const built = review.build({ rounds: vr, context: played.context, endedBy: 'score', ai: {}, role: 'Duelist',
    history: [], riotMe: riotRec.me, queue: riotRec.queue });
  const c6 = built.rounds.find((c) => c.n === 6);
  ok(c6.sideKey === 'defending' && c6.verified === true && c6.watched === true,
    'a card says its side, that Riot checked it, and that the coach watched it');
  ok(c6.riot && c6.riot.killer === 'Skye' && c6.riot.traded === false && c6.riot.afterPlant === true,
    "and carries Riot's facts for the round");
  ok(built.rounds.filter((c) => c.riot && c.riot.firstKill).length === 8, 'eight first kills, as Riot has them');
  ok(built.rounds.every((c) => c.spot === null || c.died), 'a death spot only on a round with a death');
  ok(built.rounds.some((c) => c.spot), 'and the screen keeps its locations where Riot confirms the death');
  ok(built.source === 'watched', 'a recorded review says so');

  const tracker = { matchId: 'm', map: 'Abyss', agent: 'Jett', result: 'Victory', score: '13-11', kills: 31, deaths: 21,
    assists: 4, kd: 1.48, acs: 382, adr: 243, headshotPct: 25 };
  const only = review.build({ rounds: verify.reconcile([], riotRec).rounds,
    context: { agent: 'Jett', map: 'Abyss', teamScore: 13, enemyScore: 11 }, endedBy: 'score', ai: {}, tracker,
    role: 'Duelist', history: [], riotMe: riotRec.me, queue: 'unrated', riotIdSet: true, source: 'riot' });
  ok(only.source === 'riot' && only.watched === null, 'a Riot only review claims no rounds watched');
  ok(only.rounds.length === 24 && only.rounds.every((c) => !c.facts.includes('Not watched by the coach')),
    'and does not print "Not watched" on every round');
  ok(only.rounds.every((c) => c.watched === false && c.verified === true), 'every card is Riot checked and unwatched');
  ok(only.refused.length === 1 && /did not watch/.test(only.refused[0]), 'one line says what the coach could not see');
  ok(/Riot's record/.test(only.verification || ''), "the verification line says it was graded from Riot's record");
  ok(only.grade && typeof only.grade.score === 'number', `and it is graded (${only.grade && only.grade.score})`);
  ok(only.game.mode === 'Unrated' && only.halftimeAfter === 12, 'with the queue Riot names and its halftime');

  const ledger = review.ledgerOf({ ...played, startedAt: 1000, endedAt: 2000 });
  ok(ledger && ledger.rounds.length === played.rounds.length && ledger.startedAt === 1000 && ledger.endedAt === 2000
    && ledger.endedBy === played.endedBy, 'the ledger keeps the window, how it ended, and every round');
  ok(ledger.rounds.every((r) => Array.isArray(r.reads) && r.reads.every((x) => typeof x.text === 'string'
    && typeof x.death === 'boolean')), 'with reads reconcile() can check');
  const again = verify.reconcile(ledger.rounds, riotRec);
  const live = verify.reconcile(played.rounds, riotRec);
  ok(again.checks.watched === live.checks.watched && again.checks.agreed === live.checks.agreed
    && again.checks.invented.join() === live.checks.invented.join(), 'and reconciles exactly as the live ledger does');
  ok(review.ledgerOf(null) === null, 'no snapshot, no ledger');
  // Where the agent came from (8.4.4), which the late link and the backfill
  // weigh (match-link.js linkAgentOf): the HUD's, kept as 'hud'; one the
  // player confirmed, and every snapshot before, as none.
  const hudLedger = review.ledgerOf({ ...played, context: { ...played.context, agent: 'Jett', agentConfirmed: true, agentSource: 'hud' } });
  const tickLedger = review.ledgerOf({ ...played, context: { ...played.context, agent: 'Jett', agentConfirmed: true } });
  ok(hudLedger.context.agent === 'Jett' && hudLedger.context.agentConfirmed === true && hudLedger.context.agentSource === 'hud'
    && tickLedger.context.agentSource === null,
  'the ledger keeps where its agent came from: the HUD look, or none for one the player confirmed', JSON.stringify([hudLedger.context, tickLedger.context]));

  ok(metaOf('valorant-1-abcd', 'valorant', { source: 'riot' }, 1).source === 'riot'
    && metaOf('valorant-1-abcd', 'valorant', {}, 1).source === null, 'the library row keeps where a review came from');
  // Where its frames are in the AI log (8.2), so the list can say whether the
  // eye has anything to open. A review saved before kept none, and its row
  // must not claim it had the log off.
  const place = { session: 'session-2026-10-01T18-00-00-000Z', match: 1000, from: 1000, to: 2000 };
  const rowOf = (r) => metaOf('valorant-1-abcd', 'valorant', r, 1);
  ok(JSON.stringify(rowOf({ aiLog: place }).aiLog) === JSON.stringify(place) && rowOf({ aiLog: null }).aiLog === null
    && !('aiLog' in rowOf({})), 'and where its frames are in the AI log: null with the log off, no field before 8.2');
  ok(roleOf('Jett') === 'Duelist' && roleOf('jett') === 'Duelist' && roleOf('KAY/O') === 'Initiator' && roleOf('Nobody') === null,
    'roles are read case insensitively from the generated agent data');
}

// ── 8.2: where you died, and how, in a review Riot's record never reached ───
// The coach looks at the deaths the screen saw (death-frames.js looksFor), on
// the real Abyss ledger as it stands before any Riot check: the most teachable
// four, spread across the match, each framed by the frame the screen
// registered the death on and the one before it, named as the library keeps
// them. Checked by hand against the logged frames.
{
  const deathFrames = require('../src/shared/death-frames');
  const looks = deathFrames.looksFor(abyss.records, abyss.rounds, {}, 'screen');
  const ns = looks.map((l) => l.round.n);
  ok(ns.join() === '2,14,19,22', `four of the screen's deaths are looked at, in round order (${ns})`);
  ok(looks.every((l) => l.round.died && !l.round.verified), 'every one a death the screen saw, and none Riot checked');
  const third = (n) => Math.min(2, Math.floor(((n - 1) / 24) * 3));
  ok(new Set(ns.map(third)).size === 3, 'one from each third of the match, as Riot\'s looks are spread');
  ok(looks.filter((l) => l.round.result === 'lost').length === 4 && looks.filter((l) => l.round.early).length === 3,
    'lost rounds first, and early deaths among them');
  ok(looks.every((l) => l.frames.length === 2 && l.frames[0].round === l.round.n && !l.frames[0].died && l.frames[1].died),
    'each framed by the frame before the death and the one the screen registered it on');
  ok(looks.every((l) => l.names.join() === `r${l.round.n}-before.jpg,r${l.round.n}-after.jpg`),
    `named as the library keeps them (${looks.map((l) => l.names.join('+')).join(', ')})`);
  ok(looks.map((l) => l.frames.map((f) => f.frame).join('+')).join() === [
    'frame-0011.jpg+frame-0012.jpg', 'frame-0142.jpg+frame-0143.jpg', 'frame-0193.jpg+frame-0194.jpg', 'frame-0220.jpg+frame-0221.jpg'].join(),
  `and they are these frames of the real match (${looks.map((l) => l.frames.map((f) => f.frame).join('+'))})`);
  ok(looks.every((l) => l.at === l.frames[0].at && l.gap === null), 'each with when its first frame was captured, and no second Riot never gave');
  // Round 13 is as teachable as round 14, and the frame that registered its
  // death is all the log has of it: the look would be sent the player already
  // dead as the moment before, so round 14 is looked at in its place.
  ok(deathFrames.teachableScreenDeaths(abyss.rounds).map((r) => r.n).includes(13)
    && deathFrames.framesFor(abyss.records, byN.get(13), {}).length === 1 && !ns.includes(13),
  'a death with no frame before the one that registered it is passed over for the next');
  const won = abyss.rounds.filter((r) => r.result === 'won');
  ok(deathFrames.teachableScreenDeaths(won).length === 4, 'deaths in rounds that were won can still be chosen');
  ok(deathFrames.looksFor(abyss.records, abyss.rounds, {}, 'riot').length === 0, 'and a look from Riot\'s record takes none of them');
  // A look from Riot's record is unchanged: its verified deaths, by Riot's second.
  const riotRounds = verify.reconcile(abyss.rounds, load('riot-abyss-13-11.json')).rounds;
  const riotLooks = deathFrames.looksFor(abyss.records, riotRounds, {}, 'riot');
  ok(riotLooks.map((l) => l.round.n).join() === deathFrames.teachableDeaths(riotRounds).map((r) => r.n).join()
    && riotLooks.every((l) => typeof l.gap === 'number' && l.names[0] === `r${l.round.n}-before.jpg`),
  `Riot's looks are still its teachable deaths, framed by its second (${riotLooks.map((l) => `R${l.round.n} ${l.gap}s`)})`);

  // The review built with them: each card says how its moment was found, and
  // when, for the eye at that moment.
  const rows = abyss.rounds.map((r) => ({ ...r }));
  for (const l of looks) {
    rows.find((r) => r.n === l.round.n).forensics = { cause: 'isolated', what: 'You held the site alone.', better: 'Hold closer to your team.',
      frames: l.names, source: 'screen', at: l.at };
  }
  const rv = review.build({ rounds: rows, context: abyss.context, endedBy: 'score', ai: {} });
  const c14 = rv.rounds.find((c) => c.n === 14);
  ok(c14.forensics && c14.forensics.source === 'screen' && c14.forensics.at === looks[1].at
    && c14.forensics.frames.join() === 'r14-before.jpg,r14-after.jpg', `the card carries the look's source, moment and frames (${JSON.stringify(c14.forensics)})`);
  // A LOOK FROM THE SCREEN NEVER REACHES THE GRADE. With it, this match would
  // speak in Survival and Decisions, half the weight, and be graded from the
  // screen alone. The same looks counted as Riot's would do exactly that.
  const dec = (g) => g.categories.find((c) => c.key === 'decisions');
  ok(rv.grade.score === null && dec(rv.grade).score === null, `the grade stays ungraded from the screen alone (${rv.grade.score})`);
  const asRiot = review.build({ rounds: rows.map((r) => (r.forensics ? { ...r, forensics: { ...r.forensics, source: 'riot' } } : r)),
    context: abyss.context, endedBy: 'score', ai: {} });
  ok(asRiot.grade.score !== null && dec(asRiot.grade).score !== null,
    `which is the look keeping out of it: the same looks as Riot's would grade it (${asRiot.grade.score})`);
  ok(rv.insights.mistakes.some((e) => e.key === 'cause:isolated' && e.judged && e.count === 4),
    'while the cause is counted in the lists, as the coach\'s judgement');
  // A look saved before 8.2 carries neither, and is Riot's: no other kind existed.
  const old = review.build({ rounds: [{ ...rows[1], forensics: { cause: 'dry-peek', what: 'x.', better: 'y.', frames: ['r2-before.jpg'] } }],
    context: abyss.context, endedBy: 'score', ai: {} });
  ok(old.rounds[0].forensics.source === 'riot' && old.rounds[0].forensics.at === null, 'a look saved before 8.2 reads as Riot\'s, with no moment');
  // A LOOK THAT SAW THE RECORDING (8.3.1) keeps all five of its stills on its
  // card, in time order, with each one's seconds from the death, which the
  // page labels them by. Cut to two, the card kept 3 and 1.5 s before the
  // death, both "Just before", and lost the fight and the death screen.
  const stills = ['r2-rec1-before.jpg', 'r2-rec2-before.jpg', 'r2-rec3-before.jpg', 'r2-rec4-before.jpg', 'r2-rec5-after.jpg'];
  const recorded = review.build({ rounds: [{ ...rows[1], forensics: { cause: 'isolated', what: 'x.', better: 'y.', source: 'riot',
    frames: stills, frameAt: [-3.01, -1.52, -0.71, -0.31, 0.69], framesFrom: 'recording', at: 1000 } }],
  context: abyss.context, endedBy: 'score', ai: {} }).rounds[0].forensics;
  ok(recorded.frames.join() === stills.join() && recorded.frameAt.join() === '-3.01,-1.52,-0.71,-0.31,0.69'
    && recorded.framesFrom === 'recording',
  `a look's five stills from the recording stay on its card with their seconds from the death (${JSON.stringify(recorded.frames)}, ${JSON.stringify(recorded.frameAt)})`);
  const misfit = review.build({ rounds: [{ ...rows[1], forensics: { cause: 'isolated', frames: stills, frameAt: [-3, -1.5] } }],
    context: abyss.context, endedBy: 'score', ai: {} }).rounds[0].forensics;
  ok(!('frameAt' in old.rounds[0].forensics) && !('framesFrom' in old.rounds[0].forensics) && old.rounds[0].forensics.frames.join() === 'r2-before.jpg'
    && misfit.frames.length === 5 && !('frameAt' in misfit),
  'while a look from before keeps its names and no seconds, and seconds that do not match its frames are none');

  // THE FRAMES ARE HELD FOR THE WHOLE LINK, the look after it included. The
  // longest is a match recording was stopped in: every try at the scoreboard,
  // then every try at Riot's rounds with its look and summary, then the look
  // from the screen, each request at its timeout, after the narrative.
  const link = require('../src/main/services/match-link');
  const { HOLD_MAX_MS } = require('../src/main/services/ai-log-store');
  const sum = (xs) => xs.reduce((a, b) => a + b, 0);
  const NARRATIVE = 60000; const STATS = 15000; const SCOREBOARD = 30000; const ROUNDS = 30000; const LOOK = 60000; const SUMMARY = 60000;
  const longest = NARRATIVE + STATS + sum(link.LINK_RETRY_LONG_MS) + (link.LINK_RETRY_LONG_MS.length + 1) * SCOREBOARD
    + sum(link.RIOT_ROUNDS_RETRY_MS) + (link.RIOT_ROUNDS_RETRY_MS.length + 1) * ROUNDS + LOOK + SUMMARY + LOOK;
  ok(HOLD_MAX_MS > longest && link.LINK_RETRY_LONG_MS.length >= link.LINK_RETRY_MS.length && sum(link.LINK_RETRY_LONG_MS) > sum(link.LINK_RETRY_MS),
    `the AI log holds a match's frames longer than its longest link (${Math.round(longest / 60000)} of ${HOLD_MAX_MS / 60000} minutes)`);
  ok(longest > 40 * 60000, 'which the forty minutes it used to hold them for did not cover');
  // A SCORE END MAY ASK FOR MORE ON EVERY TRY (8.2.1): with nothing verified,
  // the round records of the listed matches that could be one the watch ended
  // early (match-link.js linkEarly), EARLY_ASKS_PER_TRY at most, each at its
  // timeout. And one on a score only swiftplay ends on tries for as long as a
  // stop (linkRetries), since the match may have gone on: asking for all five
  // listed matches' records on each of those tries outlasted the hold.
  const swift = link.linkRetries('score', { team: 3, enemy: 5, final: true });
  const scoreEnd = NARRATIVE + STATS + sum(swift)
    + (swift.length + 1) * (SCOREBOARD + link.EARLY_ASKS_PER_TRY * ROUNDS)
    + sum(link.RIOT_ROUNDS_RETRY_MS) + (link.RIOT_ROUNDS_RETRY_MS.length + 1) * ROUNDS + LOOK + SUMMARY + LOOK;
  ok(swift === link.LINK_RETRY_LONG_MS && HOLD_MAX_MS > scoreEnd,
    `and a score end that may have gone on, asking for every early end's record it may on every try, still fits it `
    + `(${Math.round(scoreEnd / 60000)} minutes)`);
}

console.log(`\n${fails ? fails + ' of ' + checks + ' failed' : 'all ' + checks + ' valorant review checks passed'}`);
process.exit(fails ? 1 : 0);
