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
  // A tilt note, whichever: since 8.8 the consensus note on not fighting to
  // fix the scoreboard (weight 3) outranks the scoreline one on the same topic.
  const topicOf = (text) => { const n = knowledge.all().find((x) => x.text === text); return n && n.source ? n.source.topic : null; };
  ok(cores(streak) === 2 && streak.some((n) => topicOf(n.text) === 'tilt'),
    `a run of lost rounds gives core the majority back, as a death streak does in retrieve() (${streak.map((n) => tierOf(n.text)).join(', ')})`);
  const four = matchReview.study(matchReview.normalise(withAdvanced(base)), 4);
  ok(four.length === 4 && cores(four) === 1, 'four notes for the prompt keep the same reserve, one core');
  // What a server from before 8.2 sends: the review keeps the text alone.
  const built = review.build({ rounds: [], context: {}, endedBy: 'stop',
    ai: { study: [{ text: 'Wait for the team.', coach: 'Someone (Team)' }, null, { coach: 'Someone' }] } });
  ok(JSON.stringify(built.study) === '[{"text":"Wait for the team."}]',
    `a note that arrives with a source is kept as its text alone (${JSON.stringify(built.study)})`);
}

// ── The rank band in the review (8.8, knowledge.js rankAdjust) ──────────────
// The study list and the notes the review is written with: a Gold player
// never gets a note whose lowest band is above Gold, an Immortal player gets
// the asc_plus only ones, and a review whose client sent no band, or a band
// no key matches, is today's, byte for byte, prompt included.
{
  const knowledge = require('../server/services/knowledge');
  const BANDS = knowledge.RANK_BANDS;
  const lowestOf = (text) => {
    const n = knowledge.all().find((x) => x.text === text);
    return n && Array.isArray(n.ranks) && n.ranks.length ? Math.min(...n.ranks.map((r) => BANDS.indexOf(r))) : 0;
  };
  const seeded = (fn) => {
    const random = Math.random;
    let x = 11;
    Math.random = () => { x = (x * 16807) % 2147483647; return x / 2147483647; };
    try { return fn(); } finally { Math.random = random; }
  };
  const rounds = [1, 2, 3, 4, 5, 6].map((n) => ({ n, side: n < 4 ? 'defending' : 'attacking', result: n % 2 ? 'lost' : 'won', died: n % 2 === 1,
    verified: true, cause: n === 1 ? 'lost-duel' : n === 3 ? 'dry-peek' : null }));
  const bodyOf = (band, extra) => ({ rounds, patterns: [{ key: 'early', text: 'x' }, { key: 'spot', text: 'y' }],
    mistakes: [{ key: 'cause:lost-duel', title: 'Lost duels', detail: 'x', rounds: [1, 5], count: 2 }],
    context: { agent: 'Sova', map: 'Ascent', ...(band === undefined ? {} : { rankBand: band }), ...(extra || {}) }, final: { team: 7, enemy: 13 } });
  const inputOf = (band, extra) => ({ ...matchReview.normalise(bodyOf(band, extra)), byCause: true });
  // The notes the review prompt carries, read back out of its knowledge block.
  const notesIn = (prompt) => {
    const i = prompt.indexOf('COACHING KNOWLEDGE');
    if (i < 0) return [];
    // The notes' own lines, up to the blank line before a worked cases block (8.8).
    const lines = prompt.slice(i).split('\n').slice(1);
    const end = lines.findIndex((l) => !l.startsWith('- '));
    return (end < 0 ? lines : lines.slice(0, end)).map((l) => l.slice(2));
  };
  const plainPrompt = seeded(() => matchReview.buildPrompt({ ...inputOf(undefined), variant: 'C' }));
  let same = true;
  for (const junk of [null, '', 'Gold 2', 'gold', 'radiant', 7]) {
    if (seeded(() => matchReview.buildPrompt({ ...inputOf(junk), variant: 'C' })) !== plainPrompt) same = false;
    if (JSON.stringify(matchReview.study(inputOf(junk), 3)) !== JSON.stringify(matchReview.study(inputOf(undefined), 3))) same = false;
  }
  ok(same, 'a review with no band, or a band no key matches, is today\'s prompt and study list byte for byte');
  for (const adv of [false, true]) {
    const gold = seeded(() => matchReview.buildPrompt({ ...inputOf('silver_gold', { advancedTips: adv }), variant: 'C' }));
    const goldStudy = matchReview.study(inputOf('silver_gold', { advancedTips: adv }), 3);
    const notes = notesIn(gold).concat(goldStudy.map((n) => n.text));
    // The full eight, the prompt as it is without worked cases (8.8), which take the lowest notes' place.
    const plainNotes = notesIn(seeded(() => matchReview.buildPrompt({ ...inputOf(undefined, { advancedTips: adv }), variant: 'C' }, { cases: false })))
      .concat(matchReview.study(inputOf(undefined, { advancedTips: adv }), 3).map((n) => n.text));
    ok(plainNotes.some((t) => lowestOf(t) > 1), `the same review with no band does carry a note above Gold, so the next check means something (advanced ${adv ? 'on' : 'off'})`);
    ok(notes.length >= 6 && notes.every((t) => lowestOf(t) <= 1),
      `a Gold player's review notes and study list never reach above Gold, advanced ${adv ? 'on' : 'off'} (${notes.length} notes)`);
    ok(goldStudy.length === 3 && notesIn(gold).length <= 8, 'and the study list keeps three, the knowledge block at most eight');
  }
  // The asc_plus only cause notes a Sova review on Ascent can be served, by
  // the causes they answer (8.8 brought them for more than lost duels).
  const fitsReview = (n) => (!n.agents || n.agents.includes('Sova')) && (!n.roles || n.roles.includes('initiator'))
    && (!n.maps || n.maps.includes('Ascent')) && !n.side && !n.phase && !n.situations && !n.weapons && !n.enemyAgents && !n.enemyWithout;
  const ascOnly = knowledge.all().filter((n) => Array.isArray(n.ranks) && n.ranks.length === 1 && n.ranks[0] === 'asc_plus' && Array.isArray(n.cause) && fitsReview(n));
  const ascCauses = [...new Set(ascOnly.flatMap((n) => n.cause))];
  const immNotes = new Set(knowledge.retrieve({ agent: 'Sova', map: 'Ascent', causes: ascCauses, rankBand: 'asc_plus' }, 2000));
  const goldNotes = new Set(knowledge.retrieve({ agent: 'Sova', map: 'Ascent', causes: ascCauses, rankBand: 'silver_gold' }, 2000));
  ok(ascOnly.length >= 1 && ascOnly.every((n) => immNotes.has(n.text) && !goldNotes.has(n.text)),
    "an Immortal player's review context reaches the asc_plus only notes, the same context at Gold never does");
  const imm = seeded(() => matchReview.buildPrompt({ ...inputOf('asc_plus'), variant: 'C' }));
  ok(/PLAYER LEVEL: the player is ranked Ascendant or above\./.test(imm) && !/PLAYER LEVEL/.test(plainPrompt),
    'the review prompt names the level only when a band came');
  // The study list for an Immortal: a note for the low bands is left out
  // unless this match points to it.
  const lowNote = knowledge.all().find((n) => n.source && Array.isArray(n.ranks) && n.ranks.join() === 'iron_bronze,silver_gold' && !n.weapons);
  ok(lowNote && knowledge.rankAdjust(lowNote, 'asc_plus', false) === null && knowledge.rankAdjust(lowNote, 'asc_plus', true) === 0,
    'a low band note is left out for an Immortal, and kept when the match shows it missing');
}

// ── The enemy team and the worked cases in the review (8.8) ────────────────
// The enemy agents come from the comp a client of this release sends and,
// for one the route marks (byEnemy), Riot's killers. A worked case is in the
// prompt only where this match's situation matches one, two at most, in the
// place of the lowest notes so the prompt grows by CASE_GROWTH at most; with
// no match, no band and no enemy the prompt is today's, byte for byte.
{
  const knowledge = require('../server/services/knowledge');
  const cases = require('../server/services/cases');
  const seeded = (fn) => {
    const random = Math.random;
    let x = 5;
    Math.random = () => { x = (x * 16807) % 2147483647; return x / 2147483647; };
    try { return fn(); } finally { Math.random = random; }
  };
  const died = (n, side, extra) => ({ n, side, result: 'lost', died: true, timing: 'mid', ...(extra || {}) });
  const bodyOf = (ctx, rounds, extra) => ({ rounds, patterns: [], mistakes: [], strengths: [], context: ctx, final: { team: 9, enemy: 13 }, ...(extra || {}) });
  const C = (input, opts) => seeded(() => matchReview.buildPrompt({ ...input, variant: 'C' }, opts));

  // The field: agents only, checked, and none read as before.
  const plainBody = bodyOf({ agent: 'Sova', map: 'Haven' }, [died(4, 'attacking'), died(5, 'attacking'), died(6, 'attacking')]);
  const plain = matchReview.normalise(plainBody);
  ok(!('enemyAgents' in plain.context), 'the review reads no enemy agents from a client that sends none');
  ok(JSON.stringify(matchReview.normalise(bodyOf({ ...plainBody.context, enemyAgents: ['Player#TAG', 7, 'nobody'] }, plainBody.rounds))) === JSON.stringify(plain),
    'and a list with no agent the game data knows as none, byte for byte');
  ok(JSON.stringify(matchReview.normalise(bodyOf({ ...plainBody.context, enemyAgents: ['cypher', 'Player#TAG', 'Jett'] }, plainBody.rounds)).context.enemyAgents) === '["Cypher","Jett"]',
    'a real comp is kept, agents only, as the game data spells them');
  // The client's half: Riot's comp goes as context.enemyAgents, agents only,
  // and no comp sends no field, so a review without the link is unchanged.
  const comps = { us: [{ agent: 'Sova' }], them: [{ agent: 'killjoy' }, { agent: 'Player#TAG' }, { agent: 'Cypher' }] };
  const sentWith = review.requestBody({ rounds: plainBody.rounds.map((r) => ({ ...r })), context: { map: 'Haven' }, endedBy: 'score', riot: { agent: 'Sova', comps } });
  const sentWithout = review.requestBody({ rounds: plainBody.rounds.map((r) => ({ ...r })), context: { map: 'Haven' }, endedBy: 'score', riot: { agent: 'Sova' } });
  ok(JSON.stringify(sentWith.context.enemyAgents) === '["Cypher","Killjoy"]' && !('enemyAgents' in sentWithout.context)
    && JSON.stringify({ ...sentWith.context, enemyAgents: undefined }) === JSON.stringify({ ...sentWithout.context, enemyAgents: undefined }),
  'the client sends the enemy comp from Riot\'s record, agents the game data knows, sorted, and nothing else changes; no comp, no field');
  ok(JSON.stringify(matchReview.normalise(sentWith).context.enemyAgents) === '["Cypher","Killjoy"]', 'and the server reads it as sent');
  const killed = matchReview.normalise(bodyOf(plainBody.context, [died(4, 'attacking', { verified: true, killer: 'Killjoy' }), died(5, 'attacking'), died(6, 'attacking')]));
  ok(matchReview.enemiesOf(killed).length === 0 && JSON.stringify(matchReview.enemiesOf({ ...killed, byEnemy: true })) === '["Killjoy"]',
    "Riot's killers are the enemy agents only for a client the route marks, and an older one's are never read");

  // No match, no band, no enemy: today's prompt, byte for byte.
  const quiet = matchReview.normalise(bodyOf({ agent: 'Harbor', map: 'Lotus', advancedTips: true },
    [{ n: 1, side: 'defending', result: 'won', died: false }, { n: 2, side: 'defending', result: 'won', died: false }, { n: 3, side: 'defending', result: 'lost', died: false }]));
  ok(cases.pick(cases.fromReview(quiet, [])).length === 0 && C(quiet) === C(quiet, { cases: false }),
    'a review whose situation no case matches is today\'s prompt byte for byte');
  ok(!C(quiet).includes('WORKED CASES'), 'and carries no cases block');

  // A match: the cases block, two at most, in the place of the lowest notes.
  const clove = matchReview.normalise(bodyOf({ agent: 'Clove', map: 'Haven', advancedTips: true, rankBand: 'asc_plus' },
    [died(4, 'attacking'), died(5, 'attacking'), died(6, 'attacking', { cause: 'isolated' })],
    { mistakes: [{ key: 'cause:isolated', title: 'Died alone', detail: 'x', rounds: [6], count: 1 }] }));
  const withCases = C(clove);
  const today = C(clove, { cases: false });
  const blockAt = withCases.indexOf('\n\n' + cases.HEAD);
  ok(blockAt > 0, 'a review whose situation matches gets the worked cases block');
  const blockEnd = withCases.indexOf('\n\n', blockAt + 2);
  const caseLines = withCases.slice(blockAt + 2, blockEnd).split('\n').slice(1);
  ok(caseLines.length >= 1 && caseLines.length <= cases.MAX_CASES && caseLines.every((l) => l.startsWith('- ')),
    `with ${caseLines.length} case lines, never more than ${cases.MAX_CASES}`);
  const notesOf = (p) => { const i = p.indexOf('COACHING KNOWLEDGE'); const ls = p.slice(i).split('\n').slice(1); const e = ls.findIndex((l) => !l.startsWith('- ')); return ls.slice(0, e < 0 ? ls.length : e); };
  const kept = notesOf(withCases);
  const all8 = notesOf(today);
  ok(kept.length >= matchReview.NOTES_FLOOR && JSON.stringify(all8.slice(0, kept.length)) === JSON.stringify(kept),
    `the notes kept are today's first ${kept.length} of ${all8.length}, the lowest gone`);
  const rebuilt = withCases.slice(0, blockAt) + withCases.slice(blockEnd);
  const todayCut = today.replace(all8.join('\n'), kept.join('\n'));
  ok(rebuilt === todayCut, 'and taking the cases block out leaves today\'s prompt with those notes, byte for byte');
  ok(withCases.length <= Math.floor(today.length * (1 + matchReview.CASE_GROWTH)),
    `the prompt grows by ${Math.round((withCases.length / today.length - 1) * 100)}%, within ${matchReview.CASE_GROWTH * 100}%`);
  ok(withCases.includes(cases.line(cases.all().find((c) => c.id === 'k028'))), "an Immortal Clove dying on attack mid round is given the high Immortal controller's case");

  // The band: a Gold player never gets an asc_plus only case, an Immortal does.
  const asc = new Set(cases.all().filter((c) => c.ranks.length === 1 && c.ranks[0] === 'asc_plus').map(cases.line));
  const gold = C({ ...clove, context: { ...clove.context, rankBand: 'silver_gold' } });
  ok(![...asc].some((l) => gold.includes(l)) && [...asc].some((l) => withCases.includes(l)),
    'the same review at Gold carries no asc_plus only case, at Immortal it does');
  ok(!C({ ...clove, context: { ...clove.context, advancedTips: false } }).includes(cases.line(cases.all().find((c) => c.id === 'k028'))),
    'and with Advanced coaching off an advanced case is left out');

  // The enemy: a case for an enemy agent never blind, served against it.
  const sova = (enemy) => matchReview.normalise(bodyOf({ agent: 'Sova', map: 'Haven', advancedTips: true, rankBand: 'asc_plus', ...(enemy ? { enemyAgents: enemy } : {}) },
    [died(4, 'attacking'), died(5, 'attacking'), died(6, 'attacking')]));
  const cypherCase = cases.all().find((c) => c.id === 'k074');
  const inScored = (input) => cases.scored(cases.fromReview(input, matchReview.enemiesOf(input))).some((n) => n.c.id === 'k074');
  ok(cypherCase && !inScored(sova()) && !inScored(sova(['Jett', 'Omen'])) && inScored(sova(['Cypher', 'Jett'])),
    'the silent C walk past a Cypher camera is served against a Cypher, never against another comp or blind');
  const kjNote = knowledge.all().find((n) => n.enemyAgents && n.enemyAgents.includes('Killjoy') && !n.agents && !n.side && !n.phase && !n.roles);
  const studyHas = (input) => [...matchReview.study(input, 40)].some((n) => n.text === kjNote.text);
  ok(kjNote && !studyHas(sova()) && !studyHas(sova(['Jett'])), 'the study list never lists an enemy note blind or against another comp');

  // A real situational match only (cases.js situational, concentrated): a
  // Jett whose deaths are spread over the round is given no case on the clock.
  const spreadTimes = ['early', 'mid', 'late', 'mid', null, null, 'late'];
  const spread = matchReview.normalise(bodyOf({ agent: 'Jett', map: 'Ascent', advancedTips: true },
    spreadTimes.map((t, i) => ({ ...died(i + 3, 'attacking'), timing: t }))));
  ok(cases.pick(cases.fromReview(spread, [])).length === 0 && C(spread) === C(spread, { cases: false }),
    'a Jett whose seven deaths are spread over the round gets no case, today\'s prompt byte for byte');
  ok(C(clove) === C(clove), 'the same match reviewed twice is given the same cases, the seed is the match');
  // Variety across matches: the same shape of match, different rounds.
  const sets = new Set();
  for (let i = 0; i < 30; i++) {
    const r = [died(1, 'defending', { timing: 'early', verified: true, sec: 20 + i }), died(4, 'defending', { verified: true, sec: 50 }),
      died(5, 'attacking', { verified: true, sec: 45 }), died(6, 'attacking', { timing: 'early', verified: true, sec: 25 })];
    const input = matchReview.normalise(bodyOf({ agent: 'Killjoy', advancedTips: true, rankBand: 'plat_diamond' }, r));
    sets.add(cases.pick(cases.fromReview(input, [])).map((c) => c.id).join('+'));
  }
  ok(sets.size >= 3 && ![...sets].includes(''), `thirty Killjoy matches of the same shape (a pistol death, early and mid deaths) are given ${sets.size} different case sets, not the same pair in all`);
  // Never one lesson twice in the prompt.
  const twoIds = cases.pick(cases.fromReview(clove, matchReview.enemiesOf(clove)));
  ok(twoIds.length < 2 || !cases.lessonsOf(twoIds[1]).some((l) => cases.lessonsOf(twoIds[0]).includes(l)),
    'the two cases of a review teach two different things');

  // enemyHint (8.8): the Hush anchor note, served blind before, is never in a
  // review against a known comp with no Hush.
  const anchorNote = knowledge.all().find((n) => Array.isArray(n.enemyHint) && n.text.startsWith('When a Hush anchor appears,'));
  const noHush = ['Jett', 'Sova', 'Omen', 'Killjoy', 'Reyna'];
  let blindHas = 0, compHas = 0;
  for (const agent of ['Sova', 'Fade', 'Breach', 'Omen', 'Viper', 'Sage', 'Cypher', 'Neon']) {
    const body = (enemy) => matchReview.normalise(bodyOf({ agent, map: 'Haven', advancedTips: true, ...(enemy ? { enemyAgents: enemy } : {}) },
      [died(4, 'attacking'), died(5, 'attacking'), died(6, 'defending')]));
    // The review's own retrieve() call, at the whole pool, and its prompt.
    const pool = (input) => knowledge.retrieve({ agent, map: 'Haven', causes: [], ...(input.context.enemyAgents ? { enemyAgents: input.context.enemyAgents } : {}) }, 2000, { advanced: true });
    if (pool(body()).includes(anchorNote.text)) blindHas++;
    if (pool(body(noHush)).includes(anchorNote.text) || C(body(noHush)).includes(anchorNote.text)) compHas++;
  }
  ok(anchorNote && blindHas === 8 && compHas === 0, `the Hush anchor note is in the review's pool blind for ${blindHas} of 8 agents, as before, and never against a comp with no Hush`);

  // The band's reserve (knowledge.ADVANCED_SLOTS_BY_BAND) in the review: an
  // Iron review's notes are the band's fundamentals, a Platinum one keeps its depth.
  const advSet = new Set(knowledge.all().filter((n) => n.tier === 'advanced').map((n) => n.text));
  const notesAt = (band) => {
    const p = C(matchReview.normalise(bodyOf({ agent: 'Raze', map: 'Bind', advancedTips: true, ...(band ? { rankBand: band } : {}) },
      [died(4, 'attacking'), died(5, 'attacking'), died(6, 'attacking')])), { cases: false });
    const i = p.indexOf('COACHING KNOWLEDGE');
    const ls = p.slice(i).split('\n').slice(1);
    const e = ls.findIndex((l) => !l.startsWith('- '));
    return ls.slice(0, e < 0 ? ls.length : e).map((l) => l.slice(2));
  };
  const advCount = (band) => notesAt(band).filter((t) => advSet.has(t)).length;
  ok(advCount('iron_bronze') <= 1 && advCount('silver_gold') <= 3 && advCount('plat_diamond') >= 5 && advCount(null) >= 5,
    `advanced notes in the review: ${advCount('iron_bronze')} at Iron, ${advCount('silver_gold')} at Gold, ${advCount('plat_diamond')} at Platinum, ${advCount(null)} with no band`);

  // The budget, alone: notes go from the end down to the floor, then a case, else today's.
  const base = 'x'.repeat(1000);
  const build = (ns, cs) => base + ns.join('') + cs.join('');
  const notes = ['a'.repeat(30), 'b'.repeat(30), 'c'.repeat(30), 'd'.repeat(30), 'e'.repeat(30)];
  const todayB = build(notes, []);
  const fits = matchReview.withinBudget(todayB, notes, ['C'.repeat(130)], build);
  ok(fits === build(notes.slice(0, 4), ['C'.repeat(130)]) && fits.length <= Math.floor(todayB.length * 1.1), 'the budget drops the last note first, as few as it needs');
  ok(matchReview.withinBudget(todayB, notes, ['C'.repeat(100), 'D'.repeat(100)], build) === build(notes, ['C'.repeat(100)]),
    'and when two cases do not fit even with three notes it keeps one, with every note that fits beside it');
  ok(matchReview.withinBudget(todayB, notes, ['C'.repeat(500)], build) === todayB, 'and a case that cannot fit at all leaves today\'s prompt');
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
  ok(named.every((t) => carried.has(t)) && Object.keys(matchReview.CAUSE_TOPICS).sort().join() === 'crossfire,dry-peek,exposed,isolated,lost-duel,overextend,repeek,rotating',
    'every topic a pattern or a cause names is one a note carries, and the seven avoidable causes and lost-duel have topics');
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
  // A client before round 3 sends no `swing` and is asked as before; this
  // body, built as today's client builds it, carries one (round 3, below).
  const { swing: _swing, ...bodyBefore3 } = body;
  ok(Array.isArray(body.swing) && matchReview.round3(input) && !matchReview.round3(matchReview.normalise(bodyBefore3)),
    'a body built today carries the swing, the mark of the round 3 rules, and one without it is a client before them');
  const prompt = matchReview.buildPrompt(matchReview.normalise(bodyBefore3));
  const prompt3 = matchReview.buildPrompt(input);
  ok(/COUNTED MISTAKES[^\n]*\n- Died where nobody could trade \(rounds 2, 3, 6 and 7\): 4 of your 5 deaths/.test(prompt)
    && /Second, the first counted mistake in your own words, with its count exactly as given/.test(prompt),
  'the summary is asked for the first counted mistake, with its count');
  ok(/COUNTED MISTAKES[^\n]*\n- Died where nobody could trade \(rounds 2, 3, 6 and 7\): 4 of your 5 deaths/.test(prompt3)
    && /Second, the lever the FOCUS fixes, in your own words: a counted mistake with its count exactly as given/.test(prompt3)
    && !/the first counted mistake/.test(prompt3) && /\nFOCUS LEVER: /.test(prompt3) && /\nAIM EVIDENCE: /.test(prompt3),
  'a round 3 client\'s summary is asked for the lever the focus fixes, never the first counted mistake by rule');
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
    // Round 4: R3 is an attack round with no plant, where "hold the space you
    // have and let them come to you" loses to the clock (insights.js says so
    // of the same advantage), so the lesson with one fact is one for attack.
    + 'R3: Up four against three, take the site together and plant instead of taking the next duel.\n'
    + 'R6: You were traded by a teammate, so keep swinging.', input);
  ok(!(1 in live.rounds) && live.dropped.some((d) => d.n === 1 && d.said === 'not traded'),
    'a line saying round 1 was not traded, where Riot traded it, goes');
  ok(!(2 in live.rounds) && live.dropped.some((d) => d.n === 2 && d.said === 'the facts again'),
    'a line that only says the round\'s facts again (killer, weapon, seconds, numbers) goes');
  ok(live.rounds[3] && /take the site together/.test(live.rounds[3]), 'a lesson with one fact in it stays');
  const waited = matchReview.parse('SUMMARY: You lost 2 to 5.\nR3: Up four against three, hold the space you have and let them come to you instead of taking the next duel.', input);
  ok(!(3 in waited.rounds) && waited.dropped.some((d) => d.n === 3 && d.said === 'round state'),
    'and the old line, waiting for the enemy on attack before any plant, goes as the round state (round 4)');
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
  ok(/one sentence, at most 30 words, written as when this happens, do that, because of the one fact/.test(prompt)
    && /never restate them/.test(prompt) && /starting with You won or You lost/.test(prompt)
    && /Being traded means a teammate killed your killer within five seconds, which is good/.test(prompt),
  'the model is asked for one lesson a round, never the facts again, the summary from the player\'s own result');
  ok(!/when this happens, do that/.test(prompt3) && !/the move to make/.test(prompt3) && /never restate them/.test(prompt3)
    && /starting with You won or You lost/.test(prompt3) && !/which is good: never call it/.test(prompt3)
    && /judge the round, not the trade/.test(prompt3) && /never praise a death in a lost round/.test(prompt3),
  'and a round 3 client\'s prompt carries no template words and judges the round, not the trade');
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
  ok(JSON.stringify(review.withoutView(review.served(cut))) === JSON.stringify(cut), 'and one built today is shown as it was built, give or take its view-only fields');
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
  // A REVIVE PUTS A PLAYER BACK (read-1). Sage's resurrection and Clove's
  // ultimate bring a player back, and the feed then shows them killing or
  // dying again. Counting every kill on a mate as one fewer standing made a
  // clutch the player never had (and 4 Decisions points on the grade).
  const revived = full([K(10000, 'r1', 'b2'), K(20000, 'r1', 'b3'), K(25000, 'r2', 'b4'),
    K(30000, 'b2', 'r3'), K(32000, 'r1', 'b5'), K(45000, 'b2', 'r1')], 'Blue');
  ok(revived.clutch === null, 'a teammate revived and killing is standing, so the player was never last one up',
    JSON.stringify(revived.clutch));
  const twice = full([K(10000, 'r1', 'b2'), K(20000, 'r1', 'b3'), K(25000, 'r2', 'b4'),
    K(40000, 'r2', 'b2'), K(45000, 'me', 'r1')], 'Blue');
  ok(twice.clutch === null, 'a teammate killed twice was revived in between, and the fifth still stands: no clutch',
    JSON.stringify(twice.clutch));
  const twiceThenMe = full([K(10000, 'r1', 'b2'), K(20000, 'r1', 'b3'), K(25000, 'r2', 'b4'),
    K(40000, 'r2', 'b2'), K(50000, 'r3', 'me')], 'Red');
  ok(twiceThenMe.aliveAtDeath && twiceThenMe.aliveAtDeath.mates === 2 && twiceThenMe.aliveAtDeath.enemies === 5,
    'the player died with the fifth teammate still up: two standing, the player included', JSON.stringify(twiceThenMe.aliveAtDeath));
  const enemyRevive = full([K(5000, 'b2', 'r1'), K(6000, 'b3', 'r2'), K(7000, 'r1', 'b3'), K(20000, 'r3', 'me')], 'Red');
  ok(enemyRevive.aliveAtDeath && enemyRevive.aliveAtDeath.enemies === 4 && enemyRevive.aliveAtDeath.mates === 4,
    'an enemy revived and killing stands again: four against four at the death', JSON.stringify(enemyRevive.aliveAtDeath));
  const lateMate = full([K(5000, 'r1', 'b2'), K(6000, 'r1', 'b3'), K(7000, 'r2', 'b4'), K(8000, 'r2', 'b5'),
    K(20000, 'me', 'r1'), K(30000, 'b2', 'r2'), K(35000, 'me', 'r3')], 'Blue');
  ok(lateMate.clutch === null, 'a clutch is withdrawn once a revived teammate shows in the feed after it', JSON.stringify(lateMate.clutch));
  ok(clutch.clutch && clutch.clutch.vs === 5, 'and a real clutch with no revive still counts');
  // A kill by a player who is down is not always a revive: a mutual kill lands
  // a few ms after the shooter's own death, and a molly thrown before dying
  // kills after it. Neither may withdraw a real clutch.
  const mutual = full([K(5000, 'r1', 'b2'), K(6000, 'r1', 'b3'), K(7000, 'r2', 'b4'), K(8000, 'r3', 'b5'),
    K(8010, 'b5', 'r3'), K(20000, 'me', 'r1'), K(25000, 'me', 'r2')], 'Blue');
  ok(mutual.clutch && mutual.clutch.won === true, 'a mutual kill logged after the shooter died is no revive: the clutch stands',
    JSON.stringify(mutual.clutch));
  const molly = full([K(5000, 'r1', 'b2'), K(6000, 'r1', 'b3'), K(7000, 'r2', 'b4'), K(8000, 'r2', 'b5'),
    { ...K(12000, 'b5', 'r3'), weapon: { name: 'Ability' } }, K(20000, 'me', 'r1'), K(25000, 'me', 'r2')], 'Blue');
  ok(molly.clutch && molly.clutch.won === true, 'a dead teammate\'s utility kill is no revive: the clutch stands',
    JSON.stringify(molly.clutch));
  const mutualDeath = full([K(5000, 'r1', 'b2'), K(5005, 'b2', 'r1'), K(20000, 'r3', 'me')], 'Red');
  ok(mutualDeath.aliveAtDeath && mutualDeath.aliveAtDeath.mates === 4 && mutualDeath.aliveAtDeath.enemies === 4,
    'a mutual kill leaves four against four', JSON.stringify(mutualDeath.aliveAtDeath));

  // RIOT'S SIDES ONLY WHERE THE QUEUE'S HALVES ARE KNOWN (stale F2). Riot's
  // side beats the screen's, and every queue that was not swiftplay or Spike
  // Rush was given 12 round halves: Replication (first to 5), a Summit Only
  // New Map queue ("will use the Swiftplay mode format", 13.00) and Retake
  // (sides swap every round) labelled rounds 5 to 9 attacking.
  const sidesOf = (queue, n, won) => riotRounds.parse({
    metadata: { map: { name: 'Summit' }, queue: { id: queue } },
    players: [...blue, ...red],
    teams: [{ team_id: 'Blue', rounds: { won: won[0] } }, { team_id: 'Red', rounds: { won: won[1] } }],
    rounds: Array.from({ length: n }, () => ({ winning_team: 'Blue' })),
    kills: [],
  }, 'me', 'T').perRound.map((r) => (r.side ? r.side[0] : '-')).join('');
  ok(sidesOf('swiftplay', 9, [5, 4]) === 'ddddaaaad', `swiftplay halves of four (${sidesOf('swiftplay', 9, [5, 4])})`);
  ok(sidesOf('onefa', 9, [5, 4]) === 'ddddaaaad', `Replication plays halves of four too (${sidesOf('onefa', 9, [5, 4])})`);
  ok(sidesOf('newmap', 8, [5, 3]) === 'ddddaaaa', `a first to five New Map queue plays halves of four (${sidesOf('newmap', 8, [5, 3])})`);
  ok(sidesOf('newmap', 20, [13, 7]) === 'dddddddddddd' + 'aaaaaaaa', 'and one that reached 13 plays halves of twelve');
  ok(sidesOf('retake', 9, [5, 4]) === '---------', `Retake swaps every round, so Riot gives no side and the screen's stands (${sidesOf('retake', 9, [5, 4])})`);
  ok(sidesOf('skirmish2v2', 7, [4, 3]) === '-------', 'nor for a queue it does not know');
  ok(sidesOf('competitive', 3, [3, 0]) === 'ddd' && sidesOf('unrated', 13, [13, 0]).endsWith('a'), 'Competitive and Unrated keep their twelve');
}

// ── A queue Riot names is the review's mode, never "Standard" (stale F1) ────
{
  const known = review.queueLabel;
  ok(known('Skirmish 2v2') === 'Skirmish 2v2' && known('retake') === 'Retake' && known('Knockout') === 'Knockout'
    && known('Gauntlet: Glitched') === 'Gauntlet: Glitched' && known('ar1s') === 'AR1S' && known('allrandom') === 'All Random',
  `2026 queues are named for what they are (${['Skirmish 2v2', 'retake', 'Knockout', 'Gauntlet: Glitched', 'ar1s', 'allrandom'].map(known).join(', ')})`);
  ok(known('competitive') === 'Competitive' && known('New Map') === 'New Map' && known('') === null && known(null) === null,
    'the known ones are unchanged, and no queue is no label');
  ok(review.queueHalves('newmap') === null && review.queueHalves('onefa') === 'swiftplay' && review.queueHalves('retake') === null
    && review.queueHalves('Skirmish 2v2') === null && review.queueHalves('competitive') === 'standard',
  'halftime from the queue only where its halves are known: a New Map queue leaves it to the screen');
  const rounds = Array.from({ length: 7 }, (_, i) => ({ n: i + 1, side: 'attacking', won: i % 2 === 0, died: false, kills: 0 }));
  const skirmish = review.build({ rounds, context: { agent: 'Jett', map: 'Bind', gameMode: 'standard', teamScore: 4, enemyScore: 3 },
    endedBy: 'score', ai: {}, role: 'Duelist', history: [], queue: 'Skirmish 2v2' });
  ok(skirmish.game.mode === 'Skirmish 2v2' && skirmish.halftimeAfter === null,
    `a linked Skirmish match is not reviewed as Standard with halftime at 12 (${skirmish.game.mode}, ${skirmish.halftimeAfter})`);
  // read-3: Spike Rush read off the screen alone is named for what it is,
  // with its halftime after round 3, never "Swiftplay" with halftime after 4.
  const spikeRush = review.build({ rounds, context: { agent: 'Jett', map: 'Bind', gameMode: 'spikerush', teamScore: 4, enemyScore: 3 },
    endedBy: 'score', ai: {}, role: 'Duelist', history: [] });
  ok(spikeRush.game.mode === 'Spike Rush' && spikeRush.halftimeAfter === 3,
    `a screen only Spike Rush review says Spike Rush, halftime after 3 (${spikeRush.game.mode}, ${spikeRush.halftimeAfter})`);
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

// ── The killer card (8.7) ───────────────────────────────────────────────────
// The game's death recap again, beside the round's clip: the killer's agent
// and icon, the gun and its kill feed icon, and the damage the killer dealt
// the player that round, all Riot's, as finished strings served() works out
// (valorant-review.js killerCard). The server sums the killer's damage events
// on the player (riot-rounds.js killerDamageOf), numbers only.
{
  const riotRounds = require('../server/services/riot-rounds');
  const me = { puuid: 'p-me' }; const fade = { puuid: 'p-fade' };
  const round = { stats: [
    { player: fade, damage_events: [{ player: me, damage: 39, headshots: 0, bodyshots: 1, legshots: 0 },
      { player: { puuid: 'p-mate' }, damage: 150, headshots: 1, bodyshots: 0, legshots: 0 },
      { player: me, damage: 103, headshots: 1, bodyshots: 1, legshots: 0 }] },
    { player: me, damage_events: [{ player: fade, damage: 20, headshots: 0, bodyshots: 0, legshots: 1 }] }] };
  const isMe = (x) => !!x && x.puuid === 'p-me';
  ok(JSON.stringify(riotRounds.killerDamageOf(round, fade, isMe)) === '{"damage":142,"head":1,"body":2,"legs":0}',
    `the server sums the killer's damage on the player and nobody else's (${JSON.stringify(riotRounds.killerDamageOf(round, fade, isMe))})`);
  ok(riotRounds.killerDamageOf({ player_stats: [{ player_puuid: 'p-fade', damage_events: [{ receiver_puuid: 'p-me', damage: 80, headshots: 0, bodyshots: 2, legshots: 1 }] }] }, fade, isMe).damage === 80,
    'and reads the older v2 shape too');
  ok(riotRounds.killerDamageOf({}, fade, isMe) === null && riotRounds.killerDamageOf(round, { puuid: 'p-nobody' }, isMe) === null,
    'a round with no events for the killer has no damage, never a guess');

  const riot = JSON.parse(JSON.stringify(load('riot-abyss-13-11.json')));
  const p2 = riot.perRound.find((r) => r.n === 2);
  p2.killerDamage = { damage: 142, head: 1, body: 2, legs: 0, name: 'Someone#NA1' };
  p2.feed[0].ka = 'Viper';
  const p3 = riot.perRound.find((r) => r.died && r.n !== 2);
  const { rounds } = verify.reconcile(abyss.rounds, riot);
  ok(JSON.stringify(rounds.find((r) => r.n === 2).killerDamage) === '{"damage":142,"head":1,"body":2,"legs":0}',
    'the link keeps the damage as whole counts, and nothing else the server could send');
  const shown = review.served({ kind: 'valorant', ...review.build({ rounds, context: { ...abyss.context, agent: 'Jett' }, endedBy: 'score' }) });
  const k2 = shown.rounds.find((c) => c.n === 2).killerCard;
  ok(k2 && k2.label === 'Killed by' && k2.agent === 'Viper' && k2.agentIcon === 'valorant/agents/Viper.png'
    && k2.weapon === 'Marshal' && k2.weaponIcon === 'valorant/weapons/Marshal.png'
    && k2.damage === '142' && k2.damageLabel === 'damage to you this round'
    && JSON.stringify(k2.hits) === '[{"label":"Head","value":"1"},{"label":"Body","value":"2"},{"label":"Legs","value":"0"}]',
  `the real round 2 shows Viper, the Marshal and 142 damage, head 1, body 2, legs 0 (${JSON.stringify(k2)})`);
  const k3 = shown.rounds.find((c) => c.n === p3.n).killerCard;
  ok(k3 && k3.agent === p3.killerAgent && k3.damage === null && k3.hits === null && k3.damageLabel === null,
    `a death Riot's record kept no damage for shows the killer and the gun with the damage left out (round ${p3.n}, ${JSON.stringify(k3)})`);
  ok(shown.rounds.filter((c) => c.killerCard).length === 21 && shown.rounds.filter((c) => !c.died).every((c) => !c.killerCard),
    'every one of the 21 deaths has a card, and a round survived has none');
  ok(!/#|Someone|puuid/.test(JSON.stringify(shown.rounds.map((c) => c.killerCard || null))), 'no card holds a name, a tag or an id');
  ok(JSON.stringify(review.withoutView(shown).rounds.map((c) => Object.keys(c).includes('killerCard'))).indexOf('true') === -1,
    'and the card is view only, taken off with the rest');

  // A round the card must stay out of: a screen only review, a death to a
  // teammate or to the player themself, a killer no agent the data knows, a
  // feed that names another killer than the record.
  const card = (riotPart, extra) => review.served({ kind: 'valorant', rounds: [{ n: 4, died: true, facts: [], riot: riotPart, ...(extra || {}) }] })
    .rounds[0].killerCard || null;
  ok(card(null) === null, 'a screen only round, with no Riot record, has no card');
  ok(card({ killer: 'Sova', weapon: 'Vandal', feed: [{ by: 'mate', on: 'me', ka: 'Sova' }] }) === null, 'a death to a teammate has no card');
  ok(card({ killer: 'Jett', weapon: null, feed: [{ by: 'me', on: 'me', ka: 'Jett' }] }) === null, 'nor one to the player themself');
  ok(card({ killer: 'Someone#NA1', weapon: 'Vandal' }) === null && card({ killer: 'puuid-1234', weapon: 'Vandal' }) === null,
    'a killer that is no agent the game data knows is never shown');
  ok(card({ killer: 'Raze', weapon: 'Vandal', feed: [{ by: 'enemy', on: 'me', ka: 'Neon' }] }) === null,
    'a feed that names another killer than the record shows nothing');
  const odd = card({ killer: 'KAY/O', weapon: 'Headhunter', damage: { damage: 0, head: 0, body: 0, legs: 0 } });
  ok(odd && odd.agent === 'KAY/O' && odd.agentIcon === 'valorant/agents/KAYO.png' && odd.weapon === 'Headhunter'
    && odd.weaponIcon === null && odd.damage === null,
  `an ability Riot names keeps its name with no gun icon, and no damage is no number (${JSON.stringify(odd)})`);
  ok(card({ killer: 'Fade', weapon: 'Phantom' }, { died: false }) === null, 'a round survived has no card');
}

// ── Round 3 (Nov 2026): the swing, the lever, aim, the round, the gates ─────
// From the audit of 84 real outputs by six judges: the focus was the trade
// habit in 20 of 24 reviews, aim was refused without a look, traded deaths in
// lost rounds were praised, the template's words reached players, and orbs,
// health, spike carriers, standings and ability keys were invented. A client
// of the round 3 rules sends `swing` (requestBody, always); one before it is
// reviewed exactly as at e77ca68, prompt and study list, byte for byte.
{
  const fs = require('fs');
  const path = require('path');
  const Module = require('module');
  const { execFileSync } = require('child_process');
  const knowledge = require('../server/services/knowledge');
  // The two dashes, built from their codes (CLAUDE.md: never the character).
  const DASHES = new RegExp(`[${String.fromCharCode(0x2013)}${String.fromCharCode(0x2014)}]`);
  const seeded = (fn) => {
    const random = Math.random;
    let x = 7;
    Math.random = () => { x = (x * 16807) % 2147483647; return x / 2147483647; };
    try { return fn(); } finally { Math.random = random; }
  };

  // 1. A client before round 3 is today's prompt and study list, byte for byte,
  //    against the module as it was at e77ca68 (skipped where git cannot say).
  let before = null;
  try {
    const src = execFileSync('git', ['show', 'e77ca68:server/services/match-review.js'], { cwd: path.join(__dirname, '..'), encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    const file = path.join(__dirname, '..', 'server', 'services', 'match-review.js');
    const m = new Module(file, module);
    m.filename = file;
    m.paths = Module._nodeModulePaths(path.dirname(file));
    m._compile(src, file);
    before = m.exports;
  } catch { before = null; }
  const mk = (n, o) => ({ n, side: n <= 6 ? 'attacking' : 'defending', result: n % 3 ? 'lost' : 'won', died: n % 3 !== 0, verified: true,
    sec: 15 + n, killer: n % 2 ? 'Omen' : 'Reyna', weapon: n % 4 ? 'Vandal' : 'Sheriff', traded: n % 5 === 0, kills: 0,
    alive: { mates: 4, enemies: 5 }, reads: [], ...(o || {}) });
  const oldBodies = [
    { rounds: [1, 2, 3, 4, 5, 6, 7, 8].map((n) => mk(n)), patterns: [{ key: 'early', text: 'x' }], mistakes: [], strengths: [],
      context: { agent: 'Jett', map: 'Split' }, final: { team: 5, enemy: 13 } },
    { rounds: [1, 2, 3, 4, 5, 6, 7, 8].map((n) => mk(n, n === 2 ? { cause: 'lost-duel' } : {})), patterns: [{ key: 'streak', text: 'y' }],
      mistakes: [{ key: 'untraded', title: 'Died where nobody could trade', detail: '5 of your 6 deaths went unanswered: x.', rounds: [1, 2, 4, 5, 7], count: 5 }],
      strengths: [], context: { agent: 'Raze', map: 'Pearl', rankBand: 'plat_diamond', advancedTips: true, enemyAgents: ['Omen', 'Reyna', 'Jett', 'Sage', 'Killjoy'] },
      final: { team: 7, enemy: 13, verified: true, scoreline: { kills: 10, deaths: 16, assists: 2, acs: 180, headshotPct: 9 } } },
  ];
  if (before) {
    let same = true;
    for (const b of oldBodies) {
      for (const marks of [{}, { byCause: true }, { byCause: true, byEnemy: true }]) {
        const now = { ...matchReview.normalise(b), ...marks };
        const then = { ...before.normalise(b), ...marks };
        if (seeded(() => matchReview.buildPrompt(now)) !== seeded(() => before.buildPrompt(then))) same = false;
        if (JSON.stringify(matchReview.study(now, 3, { lines: ['Hold the spike from cover near a teammate after the plant.'] }))
          !== JSON.stringify(before.study(then, 3))) same = false;
      }
    }
    ok(same, 'a client before round 3 (no swing) is reviewed as at e77ca68: the same prompt and the same study list, byte for byte');
  } else console.log('skip  e77ca68 is not readable here, the byte for byte check against it did not run');

  // 2. The swing, from Riot's record of the audit's own Split match.
  const split = verify.reconcile([], load('riot-split-13-7.json')).rounds;
  ok(JSON.stringify(review.swingOf(split, null)) === JSON.stringify(['You won 6 of 12 rounds on attack and 7 of 8 on defence.',
    'Reyna killed you 5 times, more than anyone else.']),
  `the Split match's swing is its attack half and the Reyna who killed the player five times (${review.swingOf(split, null).join(' | ')})`);
  const abyssRiot = verify.reconcile([], load('riot-abyss-13-11.json')).rounds;
  ok(JSON.stringify(review.swingOf(abyssRiot, null)) === '["Skye killed you 7 times, more than anyone else."]',
    `the Abyss overtime, level by side, is the Skye who killed the player seven times (${review.swingOf(abyssRiot, null).join(' | ')})`);
  ok(review.swingOf(abyss.rounds, null).length === 0, 'a match Riot never checked has no swing: the screen alone is never the record');
  // The audit's three missed stories, each shaped as its match was.
  const rr = (n, side, result, o) => ({ n, side, result, verified: true, died: false, planted: false, ...(o || {}) });
  // Sunset 4 to 13 in shape: attack even, every defence round they planted lost, a won hold between.
  const sunset = [...Array.from({ length: 8 }, (_, i) => rr(i + 1, 'attacking', i % 2 ? 'lost' : 'won')),
    ...Array.from({ length: 12 }, (_, i) => (i % 4 === 3 ? rr(9 + i, 'defending', 'won') : rr(9 + i, 'defending', 'lost', { planted: true })))];
  ok(review.swingOf(sunset, null).includes('Once they planted on defence, your team won 0 of 9 rounds.'),
    `0 of 9 retakes is a swing (${review.swingOf(sunset, null).join(' | ')})`);
  const corrode = Array.from({ length: 16 }, (_, i) => rr(i + 1, i < 12 ? 'attacking' : 'defending', i >= 2 && i < 12 ? 'lost' : 'won'));
  ok(review.swingOf(corrode, null)[0] === 'You lost 10 rounds in a row, rounds 3 to 12.', `and 10 rounds lost in a row (${review.swingOf(corrode, null).join(' | ')})`);
  const pearl = Array.from({ length: 6 }, (_, i) => rr(i + 1, 'attacking', i ? 'lost' : 'won'));
  const fiveDuelists = { us: ['Jett', 'Raze', 'Reyna', 'Phoenix', 'Neon'].map((agent) => ({ agent })), them: [{ agent: 'Omen' }] };
  ok(review.swingOf(pearl, { comps: fiveDuelists }).includes('Your team had no controller: Jett, Neon, Phoenix, Raze, Reyna.'),
    'and a team of five duelists with no controller');
  const op = Array.from({ length: 8 }, (_, i) => rr(i + 1, 'attacking', 'lost', { died: true, killerAgent: i % 2 ? 'Jett' : 'Chamber', weapon: i < 4 ? 'Operator' : 'Vandal' }));
  ok(review.swingOf(op, null).includes('An Operator killed you 4 times.'), `a gun that is no common rifle killing the player four times (${review.swingOf(op, null).join(' | ')})`);
  ok([split, abyssRiot, sunset, corrode, op].every((rs) => review.swingOf(rs, null).every((t) => !/;/.test(t) && !DASHES.test(t) && t.length < 200)),
    'every swing line is plain, with no dash and no semicolon');

  // 3. What the server is sent and keeps.
  const body = review.requestBody({ rounds: split, context: { agent: 'Jett', map: 'Split' }, endedBy: 'score',
    riot: { agent: 'Jett', map: 'Split', score: '13-7', result: 'Victory', scoreline: { kills: 17, deaths: 16, assists: 8, acs: 279, headshotPct: 22 } } });
  const input = matchReview.normalise(body);
  ok(Array.isArray(body.swing) && body.swing.length === 2 && matchReview.round3(input) && input.swing.join() === body.swing.join(),
    'the body carries the swing and the server keeps it');
  ok(JSON.stringify(input.rounds.find((r) => r.n === 6).standings) === '[[5,5],[4,5],[3,5],[2,5],[2,4],[2,3],[1,3],[1,2],[1,1],[0,1]]'
    && input.final.scoreline.hs === 22,
  'and each verified round\'s standings from the kill feed, and the headshot rate');
  // A round 3 client's (no `counts`, round 4 below): the swing facts block.
  const prompt = seeded(() => matchReview.buildPrompt(matchReview.normalise({ ...body, counts: undefined })));
  ok(prompt.includes('SWING FACTS (computed from Riot\'s record of this match, the biggest first, these are true):\n- You won 6 of 12 rounds on attack and 7 of 8 on defence.\n- Reyna killed you 5 times, more than anyone else.')
    && !/\[\[5,5\]/.test(prompt) && !/\b22 percent\b/.test(prompt),
  'the prompt carries the swing as finished lines, never the standings, and a headshot rate usual for the level is no aim evidence');
  ok(!DASHES.test(prompt) && !/when this happens, do that/.test(prompt), 'and no dash and no template for the model to copy');
  const p = matchReview.parse('SUMMARY: You won 13 to 7. You won 6 of 12 rounds on attack and 7 of 8 on defence, so the attack half is where '
    + 'rounds went. Your opening kills gave the team room.\nFOCUS: Enter on a teammate\'s flash.', input);
  ok(p.summary === 'You won 13 to 7. You won 6 of 12 rounds on attack and 7 of 8 on defence, so the attack half is where rounds went. Your opening kills gave the team room.',
    `the summary may quote a swing fact's numbers, as given (${p.summary})`);
  const pOld = matchReview.parse('SUMMARY: You won 13 to 7. You won 6 of 12 rounds on attack and 7 of 8 on defence, so the attack half is where rounds went.',
    matchReview.normalise({ ...body, swing: undefined }));
  ok(pOld.summary === 'You won 13 to 7.', 'and a client before it keeps the old rule: no count the review did not send');

  // 4. The lever, the aim evidence and the level, in code.
  const untraded = (x, n) => ({ key: 'untraded', title: 'Died where nobody could trade', detail: `${x} of your ${n} deaths went unanswered: x.`, rounds: [1, 2, 3, 4, 5], count: x });
  const lever = (band, x, n, agent) => matchReview.focusLever(matchReview.normalise({ rounds: [mk(1)], swing: [], mistakes: [untraded(x, n)],
    context: { agent: agent || 'Sova', ...(band ? { rankBand: band } : {}) } }));
  ok(lever('iron_bronze', 13, 15).tradeOk && lever('silver_gold', 7, 10).tradeOk && lever(null, 7, 10).tradeOk,
    'deaths nobody traded that dominate may be the focus at Iron to Gold, or with the level unknown');
  ok(!lever('plat_diamond', 7, 10).tradeOk && !lever('asc_plus', 7, 10).tradeOk && lever('asc_plus', 13, 15).tradeOk && !lever('silver_gold', 6, 10).tradeOk,
    'from Platinum only when they are eight in ten, and never when they do not dominate');
  ok(lever('plat_diamond', 7, 10, 'Jett').entry && !lever('plat_diamond', 7, 10).entry, 'and a duelist is taught their part of the entry');
  const plat = matchReview.normalise({ rounds: [mk(1)], swing: [], mistakes: [untraded(7, 10)], context: { agent: 'Jett', rankBand: 'plat_diamond' } });
  ok(/Never make checking that a teammate can trade you the focus in this match/.test(matchReview.leverRule(plat))
    && /their part of the entry/.test(matchReview.leverRule(plat)),
  'a Platinum duelist is told never to make the trade check the focus, and to teach the entry instead');
  const aimOf = (band, hs, cause) => matchReview.aimEvidence(matchReview.normalise({ rounds: [mk(1, cause ? { cause } : {})], swing: [],
    context: { ...(band ? { rankBand: band } : {}) }, final: { team: 1, enemy: 2, scoreline: { kills: 1, deaths: 1, assists: 0, acs: 1, headshotPct: hs } } }));
  ok(aimOf('silver_gold', 10).low && !aimOf('silver_gold', 22) && aimOf('asc_plus', 17).low && !aimOf('asc_plus', 19)
    && aimOf(null, 9).low && !aimOf(null, 10) && aimOf('plat_diamond', 30, 'lost-duel').lostDuels === 1,
  'aim evidence: a headshot rate well below the level\'s usual, or a look\'s lost duel, and nothing else');
  const aimPrompt = (hs) => seeded(() => matchReview.buildPrompt(matchReview.normalise({ ...body, final: { ...body.final, scoreline: { ...body.final.scoreline, headshotPct: hs } },
    context: { ...body.context, rankBand: 'silver_gold' } })));
  ok(/AIM EVIDENCE: the player's headshot rate this match was 9 percent, well below what is usual at their level/.test(aimPrompt(9))
    && /AIM EVIDENCE: none in this match, so never say whether aim was or was not the problem\./.test(aimPrompt(22)),
  'and the prompt says which, so a low rate is aim and no evidence is neither');
  const levels = knowledge.RANK_BANDS.map((b) => matchReview.rankRule3(b));
  ok(new Set(levels).size === 4 && levels.every((l) => /Round lines differ in kind by level/.test(l) && /never to be copied/.test(l)
    && /must never be the one a lower ranked player would be given/.test(l) && !/;/.test(l) && !DASHES.test(l))
    && !/staying where a teammate can trade you/.test(levels[1]) && matchReview.rankRule3(undefined) === '',
  'each level has its own kind of round line with an example, no semicolon, Silver no longer the trade habit, and no band no line');

  // 5. THE AUDIT'S OWN REVIEWS (scripts/fixtures/audit-round3-reviews.json):
  //    the gates drop the fabrications the six judges found, and only those.
  const audit = require('./fixtures/audit-round3-reviews.json').reviews;
  const dropped = {};
  const lost = [];
  for (const x of audit) {
    const ab = { rounds: x.rounds, swing: [], mistakes: [], strengths: [], context: { agent: x.agent, map: x.map, rankBand: x.band },
      final: { team: Number(x.score.split('-')[0]), enemy: Number(x.score.split('-')[1]), result: x.result, verified: true, scoreline: x.scoreline } };
    const got = matchReview.parse(x.reply, matchReview.normalise(ab));
    for (const d of got.dropped) {
      dropped[`${x.id} ${d.n === null ? 'S' : 'R' + d.n} ${d.said}`] = true;
      lost.push(d.said);
    }
  }
  const want = ['review-split-13-7-iron_bronze R6 orb', 'review-split-13-7-silver_gold R6 orb', 'review-split-13-7-plat_diamond R6 orb',
    'review-split-13-7-asc_plus R6 orb', 'review-corrode-3-13-iron_bronze R9 carrier', 'review-corrode-3-13-silver_gold R9 carrier',
    'review-corrode-3-13-plat_diamond R9 carrier', 'review-corrode-3-13-asc_plus R9 carrier', 'review-pearl-1-5-silver_gold R6 state',
    'review-sunset-4-13-iron_bronze R16 praise', 'review-sunset-4-13-plat_diamond R16 praise'];
  ok(JSON.stringify(Object.keys(dropped).sort()) === JSON.stringify(want.sort()),
    `the audit's 24 reviews lose exactly the invented orb (4), the spike carrier (4), the 11 HP (1) and the praised deaths in lost rounds (2), nothing else (${Object.keys(dropped).join(', ')})`);
  // The audit's other bad sentences, from Ask Coach, through the same gates.
  const jett = matchReview.normalise({ rounds: [mk(1)], swing: [], context: { agent: 'Jett' } });
  const BAD = [
    ['When this happens, do that: plant, then take a spot behind cover where a teammate is close enough to kill whoever kills you.', 'template'],
    ['Her Turret (E) and Alarmbot (C) are the two things that punish a Jett who moves first.', 'kit'],
    ['The turret watches an angle and shoots when you cross it, and the alarmbot reveals and slows anyone who walks into its range.', 'kit'],
    ['Paranoia sends a vision-blocking shadow through walls, Shrouded Step teleports him a short way.', 'kit'],
    ['Your aim is not the problem here.', 'aim'], ['Aim is not what cost you this Split match.', 'aim'],
    ['Your aim is not the first thing to fix.', 'aim'], ['Your aim is not the main problem here.', 'aim'],
    ['To build it, run deathmatch or a few unrated rounds with one rule: you are only allowed to peek an angle if a teammate is within sight of it.', 'drill'],
  ];
  for (const [s, kind] of BAD) ok(matchReview.claimOf(s, jett, null) === kind, `the audit's "${s.slice(0, 50)}" goes as ${kind} (${matchReview.claimOf(s, jett, null)})`);
  const GOOD = [
    'For a drill, play deathmatch and practice stopping before each shot and putting the first bullet at head height.',
    'After the plant, hold the spike from cover with a teammate nearby because your death was traded even though the round was lost.',
    'When you hold a gap like this, keep your crosshair ready to fire because this was a sound fight lost on the shot.',
    'Leer on C blinds anyone looking at it, which punishes a player holding an angle alone.',
    'Clear the Slow Orb before you cross, because it holds you in the open.',
    'The right play here is to fall back to a teammate.',
    'You were 4 against 5 when you swung, so the next fight needed a teammate.',
    // A distance is no Range, and Team Deathmatch has a team (the round 3 verification).
    'Play in range of your teammates so they can trade your death.',
    'Play Team Deathmatch and trade each other with a teammate.',
  ];
  ok(GOOD.every((s) => matchReview.claimOf(s, jett, null) === null), `and the true lines beside them stay (${GOOD.map((s) => matchReview.claimOf(s, jett, null)).join(',')})`);
  // The standings and the gun, on the Split record.
  const r6 = input.rounds.find((r) => r.n === 6);
  ok(matchReview.claimOf('You were 4 against 4 there, so wait for the team.', input, r6) === 'state'
    && matchReview.claimOf('You were 3 against 5 there, so wait for the team.', input, r6) === null,
  'a standing the round\'s kill feed never stood at goes, one it stood at stays');
  const gun = { n: 3, verified: true, died: true, result: 'lost', killer: 'Killjoy', weapon: 'Bandit' };
  const turret = { ...gun, weapon: null };
  ok(matchReview.claimOf('You died to her Turret because you walked in alone.', jett, gun) === 'utility'
    && matchReview.claimOf('You died to her Turret because you walked in alone.', jett, turret) === null
    && matchReview.claimOf('Her Turret spotted you, then her Bandit finished it.', jett, gun) === null,
  'a gun kill blamed on the killer\'s ability goes, and the same line with no gun on record stays');
  const reyna = matchReview.normalise({ rounds: [mk(1)], swing: [], context: { agent: 'Reyna' } });
  ok(matchReview.claimOf('Devour off the orb after the kill, then reset.', reyna, null) === null
    && matchReview.claimOf('When you go for the orb, ask a teammate to watch.', jett, null) === 'orb',
  'a Reyna\'s soul orb is hers, an ultimate orb nothing states is not');
  // A whole reply: a round line goes whole, a summary sentence alone.
  const whole = matchReview.parse('SUMMARY: You won 13 to 7. Your aim is not the problem here. Your openings won rounds.\n'
    // R3, not R4 (round 4): Riot's record has the spike down in round 3 and
    // never in round 4, and holding a spike that was never planted now goes.
    // And since the blind audit of 8.7.9 the player died in round 3 before
    // the plant (the early pattern's rounds), so the line kept is about the
    // fight, not the spike (record-claims.js checkPostPlant).
    + 'R6: When you go for the orb, ask a teammate to watch the angle first.\nR3: Swing from cover with a teammate set to follow.\nFOCUS: Enter on a flash.', input);
  ok(whole.summary === 'You won 13 to 7. Your openings won rounds.' && !(6 in whole.rounds) && whole.rounds[3] && whole.focus === 'Enter on a flash.'
    && whole.dropped.some((d) => d.n === 6 && d.said === 'orb') && whole.dropped.some((d) => d.n === null && d.said === 'summary aim'),
  `a false line goes whole, a false summary sentence alone, never the review (${JSON.stringify(whole.dropped)})`);
  const src = fs.readFileSync(path.join(__dirname, '..', 'server', 'services', 'match-review.js'), 'utf8')
    + fs.readFileSync(path.join(__dirname, '..', 'src', 'shared', 'valorant-review.js'), 'utf8');
  ok(!src.includes(String.fromCharCode(8)), 'no backspace byte in either file, the shell regex hazard');

  // 6. The study list: it turns by the match, follows aim evidence, leaves
  //    out what the round advice contradicts, and the Operator needs one.
  const studyOf = (b, o) => matchReview.study({ ...matchReview.normalise(b), byCause: true, byEnemy: true }, 3, o).map((n) => n.text);
  const variety = new Set();
  const plainSets = new Set();
  for (let k = 0; k < 12; k++) {
    const b = { rounds: [1, 2, 3, 4, 5, 6, 7, 8].map((n) => mk(n, { sec: 10 + n + k })), swing: [], patterns: [{ key: 'early', text: 'x' }],
      context: { agent: 'Jett', map: 'Split', rankBand: 'silver_gold', advancedTips: true }, final: { team: 5 + k, enemy: 13 } };
    for (const t of studyOf(b)) variety.add(t);
    plainSets.add(JSON.stringify(studyOf({ ...b, swing: undefined })));
    ok(JSON.stringify(studyOf(b)) === JSON.stringify(studyOf(b)), k === 0 ? 'one match always gets the same study list' : 'and again');
  }
  ok(plainSets.size === 1 && variety.size >= 6, `twelve matches alike but for their rounds: a client before round 3 gets one list for all, a round 3 client ${variety.size} notes`);
  const opBody = (weapon) => ({ rounds: [1, 2, 3, 4, 5, 6, 7, 8].map((n) => mk(n, { weapon, cause: n < 3 ? 'dry-peek' : null })), swing: [], patterns: [],
    mistakes: [{ key: 'cause:dry-peek', title: 'Dry peeks', detail: 'x', rounds: [1, 2], count: 2 }],
    context: { agent: 'Sova', map: 'Ascent', rankBand: 'plat_diamond', advancedTips: true, enemyAgents: ['Jett', 'Chamber', 'Omen', 'Sage', 'Fade'] } });
  const OP = 'When an enemy Operator is holding a lane, do not dry peek it to find out where he is';
  const served = (b) => {
    const i = { ...matchReview.normalise(b), byCause: true, byEnemy: true };
    return seeded(() => matchReview.buildPrompt(i, { cases: false })).includes(OP);
  };
  // For every client, the one change to an old client's notes: the note was
  // served blind on a Jett or a Chamber in the comp, 9 of the audit's 24
  // reviews with no Operator kill in any match (knowledge.js enemyFit).
  ok(!served(opBody('Vandal')) && served(opBody('Operator')) && !served({ ...opBody('Vandal'), swing: undefined })
    && served({ ...opBody('Operator'), swing: undefined }),
  'the enemy Operator note needs an Operator kill on Riot\'s record, not a Jett or a Chamber on their team, for every client');
  const lowAim = { rounds: [1, 2, 3, 4, 5, 6].map((n) => mk(n)), swing: [], patterns: [], mistakes: [],
    context: { agent: 'Jett', map: 'Split', rankBand: 'silver_gold' }, final: { team: 3, enemy: 13, scoreline: { kills: 4, deaths: 12, assists: 1, acs: 120, headshotPct: 8 } } };
  const topicOf = (text) => { const n = knowledge.all().find((x) => x.text === text); return n && n.source ? n.source.topic : null; };
  const aimTopics = new Set(matchReview.CAUSE_TOPICS['lost-duel']);
  ok(studyOf(lowAim).some((t) => aimTopics.has(topicOf(t))) && !studyOf({ ...lowAim, final: { ...lowAim.final, scoreline: { ...lowAim.final.scoreline, headshotPct: 20 } } })
    .some((t) => aimTopics.has(topicOf(t))) && !studyOf({ ...lowAim, swing: undefined }).some((t) => aimTopics.has(topicOf(t))),
  'a low headshot rate with no look sends a round 3 client to the aim notes, a usual one does not, and a client before it as before');
  const PRESENCE = 'As a duelist after the plant, show presence deep on their side';
  const ppBody = { rounds: [1, 2, 3, 4, 5, 6].map((n) => mk(n, { side: 'attacking', planted: true, result: 'lost' })), swing: [],
    patterns: [{ key: 'postplant', text: 'x' }], context: { agent: 'Jett', map: 'Split', rankBand: 'plat_diamond', advancedTips: true } };
  // Every note the match can be listed, one a topic, so the filter is seen whatever the turn.
  const wide = (o) => matchReview.study({ ...matchReview.normalise(ppBody), byCause: true, byEnemy: true }, 400, o).map((n) => n.text);
  ok(wide().some((t) => t.startsWith(PRESENCE))
    && !wide({ lines: ['After the plant, hold the spike from cover near a teammate and let them come.'] }).some((t) => t.startsWith(PRESENCE))
    && wide({ lines: ['Take one piece of space and stop before you swing.'] }).some((t) => t.startsWith(PRESENCE))
    && matchReview.study({ ...matchReview.normalise({ ...ppBody, swing: undefined }), byCause: true }, 400,
      { lines: ['After the plant, hold the spike from cover near a teammate.'] }).some((n) => n.text.startsWith(PRESENCE)),
  'the forward post plant note goes beside a round line holding the spike from cover, and stays beside one about something else');
  ok(matchReview.spread('a|b') !== matchReview.spread('a|c') && Math.abs(matchReview.spread('a|b') - matchReview.spread('a|c')) > 0.01,
    'the turn\'s hash spreads two seeds that differ in one letter');
}

// ── Round 4 (Nov 2026): one block of numbers, a lever by level, the gates ──
// From the live re-audit of 8.7.7 (the same 84 items): the trade habit at
// every level, Ascendant reviews worse, "13 of your 15" beside 16 deaths and
// 14 untraded, "Fight her" with no her, "so your next review can check", and
// an attacker with no plant told to let the enemy come. A client of the round
// 4 rules sends `counts` (requestBody, always); one before it is reviewed as
// at 4a5aa0e (8.7.7), prompt and study list, byte for byte.
{
  const path = require('path');
  const fs = require('fs');
  const Module = require('module');
  const { execFileSync } = require('child_process');
  const knowledge = require('../server/services/knowledge');
  const abilityFacts = require('../server/services/ability-facts');
  const DASHES = new RegExp(`[${String.fromCharCode(0x2013)}${String.fromCharCode(0x2014)}]`);
  const seeded = (fn) => {
    const random = Math.random;
    let x = 7;
    Math.random = () => { x = (x * 16807) % 2147483647; return x / 2147483647; };
    try { return fn(); } finally { Math.random = random; }
  };
  const audit = require('./fixtures/audit-round3-reviews.json').reviews;
  const after = require('./fixtures/audit-round3-after-reviews.json').reviews;
  const bodyOf = (x, o) => ({ rounds: x.rounds, swing: [], counts: {}, mistakes: x.mistakes || [], strengths: [], patterns: [],
    context: { agent: x.agent, map: x.map, rankBand: x.band, advancedTips: true },
    final: { team: Number(x.score.split('-')[0]), enemy: Number(x.score.split('-')[1]), result: x.result, verified: true, scoreline: x.scoreline }, ...(o || {}) });
  const inputOf = (x, o) => ({ ...matchReview.normalise(bodyOf(x, o)), byCause: true, byEnemy: true });
  const without = (b, k) => { const c = { ...b }; delete c[k]; return c; };

  // 1. A client before round 4 is 8.7.7's prompt and study list, byte for
  //    byte (skipped where git cannot say), round 3 clients and older alike.
  let before = null;
  try {
    const src = execFileSync('git', ['show', '4a5aa0e:server/services/match-review.js'], { cwd: path.join(__dirname, '..'), encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    const file = path.join(__dirname, '..', 'server', 'services', 'match-review.js');
    const m = new Module(file, module);
    m.filename = file;
    m.paths = Module._nodeModulePaths(path.dirname(file));
    m._compile(src, file);
    before = m.exports;
  } catch { before = null; }
  if (before) {
    let same = true;
    let sameParse = true;
    for (const x of after) {
      for (const b of [without(bodyOf(x), 'counts'), without(without(bodyOf(x), 'counts'), 'swing')]) {
        for (const marks of [{}, { byCause: true, byEnemy: true }]) {
          const now = { ...matchReview.normalise(b), ...marks };
          const then = { ...before.normalise(b), ...marks };
          if (seeded(() => matchReview.buildPrompt(now)) !== seeded(() => before.buildPrompt(then))) same = false;
          if (JSON.stringify(matchReview.study(now, 3, { lines: ['Hold the spike from cover.'] }))
            !== JSON.stringify(before.study(then, 3, { lines: ['Hold the spike from cover.'] }))) same = false;
        }
      }
    }
    ok(same, 'a client before round 4 (no counts) is reviewed as at 4a5aa0e: the same prompt and the same study list, byte for byte, 48 bodies');
    // Its parse too, but where a round 4 gate for every client finds a leak:
    // of the 48 real replies, the after set's product clause alone.
    const moved = [];
    for (const x of [...audit, ...after]) {
      const b = without(bodyOf(x), 'counts');
      const a = matchReview.parse(x.reply, matchReview.normalise(b));
      const t = before.parse(x.reply, before.normalise(b));
      if (JSON.stringify([a.summary, a.rounds, a.focus]) !== JSON.stringify([t.summary, t.rounds, t.focus])) moved.push(x.id);
    }
    // And since 8.7.10 the clock turned around (match-review.js clockWrong),
    // for every client: Corrode round 1, an attack round after the plant,
    // "so you can make the attackers spend time finding you".
    sameParse = moved.length === 2 && moved.includes('review-sunset-4-13-asc_plus') && moved.includes('review-corrode-3-13-silver_gold');
    ok(sameParse, `and its 48 real replies parse as at 4a5aa0e but the one "so your next review can check" and the one clock turned around (${moved.join(', ')})`);
  } else console.log('skip  4a5aa0e is not readable here, the byte for byte check against it did not run');

  // 2. The counts: the client's (countsOf) and the server's (matchCounts) agree.
  const split = verify.reconcile([], load('riot-split-13-7.json')).rounds;
  const body = review.requestBody({ rounds: split, context: { agent: 'Jett', map: 'Split' }, endedBy: 'score',
    riot: { agent: 'Jett', map: 'Split', score: '13-7', result: 'Victory', scoreline: { kills: 17, deaths: 16, assists: 8, acs: 279, headshotPct: 22 } } });
  const input = { ...matchReview.normalise({ ...body, context: { ...body.context, rankBand: 'asc_plus' } }), byCause: true, byEnemy: true };
  const server = matchReview.matchCounts(input);
  ok(matchReview.round4(input) && JSON.stringify(body.counts) === JSON.stringify(without(server, 'rounds'))
    && server.deaths === 16 && server.untraded === 14 && server.untradedMate === 13 && server.tradeable === 15 && server.alone === 1,
  `the body carries what the card counted, and the server counts the same from the rounds (${JSON.stringify(server)})`);
  const untraded = (body.mistakes || []).find((m) => m.key === 'untraded');
  ok(untraded && /^13 of your 15 deaths went unanswered/.test(untraded.detail), 'the card\'s own count is 13 of 15, the deaths a teammate alive could trade');
  ok(!matchReview.round4(matchReview.normalise(without(body, 'counts'))) && !matchReview.round4(matchReview.normalise({ ...body, swing: undefined })),
    'no counts, or no swing, is no round 4 client');

  // 3. The one SWING AND COUNTS block, and the card's count in the record's words.
  const prompt = seeded(() => matchReview.buildPrompt(input));
  ok(prompt.includes('SWING AND COUNTS (computed from Riot\'s record of this match, the biggest swing first, these are true, and the only numbers of rounds or deaths the summary and the round lines may quote, exactly as written here):\n'
    + '- You won 6 of 12 rounds on attack and 7 of 8 on defence.\n- Reyna killed you 5 times, more than anyone else.\n- You died 16 times in 20 rounds.\n'
    + '- 14 of your 16 deaths were not traded by a teammate within five seconds.\n'
    + '- 1 of those deaths came as the last player alive, when nobody was left to trade, so 13 of your 15 deaths with a teammate alive to trade went unanswered.')
    && !prompt.includes('SWING FACTS'),
  'the prompt has one block of numbers: the swing, the deaths, the raw untraded count and the card\'s, and what separates them');
  ok(prompt.includes('13 of your 15 deaths with a teammate alive to trade went unanswered: no teammate killed your killer within five seconds.')
    && !prompt.includes('13 of your 15 deaths went unanswered'),
  'and the counted mistake says which deaths its count is of');
  ok(!DASHES.test(prompt) && !/;/.test(matchReview.countLines(input).join(' ')), 'no dash in the prompt, no semicolon in the block');
  for (const [from, to] of matchReview.ROUND4_SWAPS) {
    const want = to.replace('{KIT}', ' Say of an ability only what its line under WHAT THE ABILITIES DO says.');
    ok(prompt.includes(want) && prompt.split(from).length === want.split(from).length, `the round 4 swap applies: "${want.slice(0, 60)}"`);
  }
  for (const [, to] of matchReview.GROUNDING4_SWAPS) ok(prompt.includes(to), `and the grounding swap: "${to.slice(0, 60)}"`);
  ok(prompt.includes('R4 attack, lost.') && /R4 attack, lost\.[^\n]*spike not planted/.test(prompt) && /R3 attack, lost\.[^\n]*spike planted/.test(prompt),
    'each verified round says whether the spike went down, a round without a plant included');
  ok(prompt.includes('WHAT THE ABILITIES DO, in the game\'s own words. Say of an ability only what its line says:')
    && prompt.includes(abilityFacts.abilityLine('Jett', 'Tailwind')) && prompt.includes(abilityFacts.abilityLine('Reyna', 'Leer'))
    && JSON.stringify(matchReview.kitAgents(input)) === '["Jett","Reyna","Phoenix"]',
  `the player's kit and the two agents who killed them most, in the game's words (${matchReview.kitAgents(input).join(', ')})`);
  ok(/DEPTH: at this level reason from this match's own numbers/.test(prompt) && /at most one fundamentals habit/.test(prompt)
    && !/DEPTH:/.test(seeded(() => matchReview.buildPrompt({ ...input, context: { ...input.context, rankBand: 'silver_gold' } }))),
  'from Platinum the review reasons from the match\'s numbers with a trade off and one fundamentals habit at most, below it no depth rule');
  ok(!/see in their next review/.test(prompt) && /Never mention this review, a next review, the app/.test(prompt),
    'the focus is no longer told to be seen in the next review, and the review never talks about itself');

  // 4. The lever by level: the six audit matches at four bands.
  const table = [];
  const byMatch = new Map();
  for (const x of after) {
    const lever = matchReview.leverOf(inputOf(x));
    const kind = lever ? lever.kind : 'round 3 rule';
    table.push(`${x.id.slice(7).padEnd(28)} ${kind}`);
    const m = x.id.replace(/^review-/, '').replace(/-(?:iron_bronze|silver_gold|plat_diamond|asc_plus)$/, '');
    if (!byMatch.has(m)) byMatch.set(m, {});
    byMatch.get(m)[x.band] = { kind, rule: seeded(() => matchReview.buildPrompt(inputOf(x))).split('FOCUS LEVER: ')[1].split('\n')[0] };
  }
  console.log(`      the focus lever, six matches at four bands:\n      ${table.join('\n      ')}`);
  const high = after.filter((x) => matchReview.HIGH_BANDS.has(x.band)).map((x) => matchReview.leverOf(inputOf(x)));
  ok(high.every((l) => !l || l.kind !== 'trade'), 'from Platinum the trade habit is never the lever when the library does not find it again');
  const varied = [...byMatch.values()].filter((b) => new Set(Object.values(b).map((v) => v.kind)).size >= 2);
  ok(varied.length >= 4 && [...byMatch.values()].every((b) => b.plat_diamond.rule !== b.iron_bronze.rule || b.iron_bronze.kind === 'round 3 rule'),
    `the lever differs by level in ${varied.length} of the six matches, and Platinum is never told Iron's lever`);
  const ascKinds = new Set([...byMatch.values()].map((b) => b.asc_plus.kind).filter((k) => k !== 'round 3 rule'));
  ok(ascKinds.size >= 2 && !ascKinds.has('trade'), `and Ascendant gets the side, the tempo or a repeated decision, never the trade (${[...ascKinds].join(', ')})`);
  const splitPlat = after.find((x) => x.id === 'review-split-13-7-plat_diamond');
  const corrodePlat = after.find((x) => x.id === 'review-corrode-3-13-plat_diamond');
  const fewLost = { ...inputOf(corrodePlat, { recurring: ['untraded'] }) };
  fewLost.rounds = fewLost.rounds.map((r) => (r.n > 4 && r.result === 'lost' ? { ...r, traded: true } : r));
  ok(matchReview.leverOf(inputOf(corrodePlat, { recurring: ['untraded'] })).kind === 'trade'
    && matchReview.leverOf(inputOf(corrodePlat)).kind !== 'trade'
    && matchReview.leverOf(inputOf(corrodePlat, { recurring: ['first-death'] })).kind !== 'trade'
    && matchReview.leverOf(fewLost).kind !== 'trade',
  'from Platinum the trade leads only when the library finds it again AND this match lost rounds to it');

  // The client's half (round 4): the keys come from the library, counted as
  // the Patterns page counts them, the match under review left out.
  {
    const patternsOf = require('../src/shared/patterns');
    const lib = (id, keys) => ({ id, game: 'valorant', at: 0, review: { insights: {
      mistakes: keys.map((k) => ({ key: k, title: k, detail: 'x', rounds: [1, 2], count: 2, weight: 1 })), strengths: [], missed: [] } } });
    const current = lib('now', ['untraded']);
    const library = [current, lib('a', ['untraded', 'first-death']), lib('b', ['untraded']), lib('c', ['first-death'])];
    const keys = patternsOf.recurringKeys(library, 'now');
    const page = patternsOf.summarise(library.slice(1)).mistakes.map((m) => m.key);
    ok(keys.includes('untraded') && keys.includes('first-death') && JSON.stringify(keys) === JSON.stringify(page.slice(0, 8)),
      `the recurring keys are the Patterns page's mistakes over the earlier matches (${keys.join(', ')})`);
    ok(!patternsOf.recurringKeys([current, lib('a', ['untraded'])], 'now').length
      && !patternsOf.recurringKeys([current, lib('a', ['untraded']), lib('b', ['first-death'])], 'now').includes('untraded'),
      'one earlier match, or this match and one more, is no habit: the match under review never counts toward its own');
    ok(!patternsOf.recurringKeys([lib('a', ['untraded']), { id: 'riot', review: { source: 'riot', insights: { mistakes: [{ key: 'untraded' }] } } }], null).length,
      'a match graded from Riot\'s record alone counts nothing, as on the Patterns page');
    const sent = review.requestBody({ rounds: [], context: { map: 'Corrode' }, endedBy: 'score', recurring: keys });
    const unsent = review.requestBody({ rounds: [], context: { map: 'Corrode' }, endedBy: 'score' });
    ok(JSON.stringify(sent.recurring) === JSON.stringify(keys) && !('recurring' in unsent)
      && !('recurring' in review.requestBody({ rounds: [], context: {}, endedBy: 'score', recurring: [] })),
      'requestBody sends the keys, and no field at all when there are none');
    ok(matchReview.leverOf(inputOf(corrodePlat, { recurring: sent.recurring })).kind === 'trade'
      && matchReview.leverOf(inputOf(corrodePlat, { recurring: patternsOf.recurringKeys(library.slice(0, 2), 'now') })).kind !== 'trade',
      'so from Platinum the trade leads with a library that repeats it, and not with one that does not');
    const root = path.join(__dirname, '..');
    const main = fs.readFileSync(path.join(root, 'src', 'main', 'index.js'), 'utf8');
    const eng = fs.readFileSync(path.join(root, 'src', 'main', 'services', 'coaching-engine.js'), 'utf8');
    const endAt = eng.indexOf('async requestMatchReview(snap)');
    const askAt = eng.indexOf('this.recurring()', endAt);
    ok(/recurring: recurringNow\(job\.id\)/.test(main) && /recurring: \(\) => recurringNow\(null\)/.test(main)
      && /patternsOf\.recurringKeys\(reviewStore\.recent\('valorant', patternsOf\.LOOK_BACK\)/.test(main)
      && askAt > endAt && askAt < eng.indexOf("this.emit('match-ended', snap)", endAt)
      && /valorantReview\.requestBody\(\{ \.\.\.snap, recurring \}\)/.test(eng),
      'both review requests send the library\'s keys, the engine reading them before match-ended saves this match');
  }
  ok(matchReview.leverOf(matchReview.normalise({ ...bodyOf(splitPlat), context: { agent: 'Jett' } })) === null
    && matchReview.leverOf(matchReview.normalise(without(bodyOf(splitPlat), 'counts'))) === null,
  'no band, or a client before round 4, is the round 3 rule');
  const noFact = { ...inputOf(after.find((x) => x.id === 'review-fracture-5-1-asc_plus')) };
  ok(/Never make checking that a teammate can trade you the focus/.test(seeded(() => matchReview.buildPrompt({ ...noFact,
    mistakes: [{ key: 'untraded', title: 'x', detail: '9 of your 10 deaths went unanswered: x.', rounds: [1, 2, 3, 4, 5], count: 9 }] }))),
  'and from Platinum with no fact for any kind, the round 3 rule never lets the trade be the focus, even at nine in ten');

  // 5. The study list and the cases follow the swing.
  const topicOf = (text) => { const n = knowledge.all().find((x) => x.text === text); return n && n.source ? n.source.topic : null; };
  const sunsetPlat = after.find((x) => x.id === 'review-sunset-4-13-plat_diamond');
  const retakeTopics = new Set(matchReview.PATTERN_TOPICS.retake);
  ok(matchReview.study(inputOf(sunsetPlat), 3).some((n) => retakeTopics.has(topicOf(n.text)))
    && matchReview.swingTopics(inputOf(sunsetPlat)).has('retake shape') && matchReview.swingTopics(matchReview.normalise(without(bodyOf(sunsetPlat), 'counts'))).size === 0,
  'a retake that collapsed (0 of 9) sends the player to a retake note')
  const splitSilver = after.find((x) => x.id === 'review-split-13-7-silver_gold');
  const answersReyna = (t) => { const n = knowledge.all().find((x) => x.text === t); return !!n && [...(n.enemyAgents || []), ...(n.enemyHint || [])].includes('Reyna'); };
  ok(matchReview.study(inputOf(splitSilver), 3).some((n) => answersReyna(n.text)),
    `the Reyna who killed the player five times brings a note that answers Reyna (${matchReview.study(inputOf(splitSilver), 3).map((n) => n.text.slice(0, 40)).join(' | ')})`);
  const situ = matchReview.caseSituation(inputOf(sunsetPlat), matchReview.enemiesOf(inputOf(sunsetPlat)));
  ok(situ.phases.has('retake') && situ.patterns.includes('retake')
    && !require('../server/services/cases').fromReview(matchReview.normalise(without(bodyOf(sunsetPlat), 'counts')), []).patterns.includes('retake'),
  'and the cases are chosen for the retake too, a client before round 4 as before');
  ok(JSON.stringify(matchReview.leverSituation(inputOf(sunsetPlat))) === '{"phase":"postplant","side":"defense"}',
    'the notes the prompt retrieves are the retake\'s');

  // 6. The gates, on the re-audit's own text, from the reviews and from Ask Coach.
  const pearl = inputOf(after.find((x) => x.id === 'review-pearl-1-5-silver_gold'));
  const pr = (n) => pearl.rounds.find((r) => r.n === n);
  const iso = inputOf(after.find((x) => x.id === 'review-corrode-3-13-iron_bronze'));
  const BAD = [
    ['If you are one of the last two, fall back behind cover, let the enemy come to you, and only fight from an angle where the teammate beside you can see the same enemy.', pearl, pr(1), 'round state'],
    ['Hold the angle and let the clock work for you instead of swinging.', pearl, pr(4), 'round state'],
    ['After the plant, hold the spike from cover instead of seeking another fight.', pearl, pr(4), 'no plant'],
    ['Wait for the defuse sound, then swing together.', pearl, pr(5), 'no plant'],
    ['The biggest thing holding you back is dying where nobody could trade you, and it has shown up in 5 of your last 6 matches.', pearl, null, 'library'],
    ['You had 27% headshot accuracy against your average of 32%, so slow down before the shot.', iso, null, 'library'],
    ['Before an aggressive peek, name the teammate close enough to kill your killer so your next review can check it.', pearl, pr(1), 'product'],
    ['Occlara can show you this fight again on the Moments page.', pearl, null, 'product'],
    ['To build it, play Deathmatch and make yourself say out loud before every fight whether anyone could help you.', pearl, null, 'drill'],
    ['Use Undercut to check the angle before you swing.', iso, null, 'kit'],
    // 8.7.10, the clock turned around (clockWrong): Corrode round 1, on attack, lost after the plant.
    ['After the plant, hold the spike from cover instead of exposing yourself to the Classic, so the attackers have to move against the clock.', iso, iso.rounds.find((r) => r.n === 1), 'round state'],
    ['After the plant, hold the spike from cover instead of staying alone on site, so you can make the attackers spend time finding you.', iso, iso.rounds.find((r) => r.n === 1), 'round state'],
    ['Before the plant, hold the angle and make the defenders spend time.', pearl, pr(4), 'round state'],
  ];
  for (const [s, inp, r, kind] of BAD) ok(matchReview.claimOf(s, inp, r) === kind, `the re-audit's "${s.slice(0, 50)}" goes as ${kind} (${matchReview.claimOf(s, inp, r)})`);
  const GOOD = [
    ['After the plant, hold the spike from cover and make the defenders come to you.', pearl, pr(3)],
    ['On defence, hold your angle from farther back and let the attackers come to you.', pearl, pr(5)],
    ['Practise it in your next match rather than in Deathmatch, because the Range and Deathmatch have no teammates to check for.', pearl, null],
    ['Practise stopping before each shot in Deathmatch, one angle at a time.', pearl, null],
    ['Take the site together and plant before the clock runs low.', pearl, pr(4)],
    ['Review the round in your head before the next buy.', pearl, null],
    // The clock the right way round (8.7.10, clockWrong) stays.
    ['With the spike planted, check for cover before holding the site so you can stay alive and make the defenders spend time.', iso, iso.rounds.find((r) => r.n === 1)],
    ['Once the spike is down, hold it from cover and make the defenders spend time reaching it rather than taking another fight.', iso, iso.rounds.find((r) => r.n === 1)],
  ];
  ok(GOOD.every(([s, inp, r]) => matchReview.claimOf(s, inp, r) === null), `and the true lines beside them stay (${GOOD.map(([s, inp, r]) => matchReview.claimOf(s, inp, r)).join(',')})`);
  ok(matchReview.productCut('Before an aggressive peek or entry, name the teammate close enough to kill your killer so your next review can check whether the fight had an immediate answer.')
    === 'Before an aggressive peek or entry, name the teammate close enough to kill your killer.'
    && matchReview.productCut('Your next review will show it.') === null,
  'a product clause is cut where the sentence stands without it, and a sentence that is only product talk goes');

  // The coherence pass: what stays after a drop still reads.
  const splitIn = inputOf(splitSilver);
  const orphan = matchReview.parse('SUMMARY: You won 13 to 7. Reyna won 5 of your 6 duels on A. Fight her with a teammate or after a flash, never one on one. '
    + 'Your opening kills gave your team room.\nFOCUS: Enter on a teammate\'s flash.', splitIn);
  ok(orphan.summary === 'You won 13 to 7. Your opening kills gave your team room.' && orphan.dropped.some((d) => d.said === 'summary orphan'),
    `a sentence about "her" goes with the dropped one that named her (${orphan.summary})`);
  const kept = matchReview.parse('SUMMARY: You won 13 to 7. Reyna killed you 5 times, more than anyone else. Fight her with a teammate or after a flash. '
    + 'Your opening kills gave your team room.\nFOCUS: Enter on a teammate\'s flash.', splitIn);
  ok(kept.summary === 'You won 13 to 7. Reyna killed you 5 times, more than anyone else. Fight her with a teammate or after a flash. Your opening kills gave your team room.',
    `and stays where the sentence naming her stays (${kept.summary})`);
  const leans = matchReview.parse('SUMMARY: You won 13 to 7. Your aim is not the problem here. It cost you rounds 3 and 4. Your opening kills gave your team room.', splitIn);
  ok(leans.summary === 'You won 13 to 7. Your opening kills gave your team room.', `a sentence opening on "It" after a drop goes too (${leans.summary})`);
  const opener = matchReview.parse('SUMMARY: You won 13 to 7. This came from your opening kills, which gave your team room.', splitIn);
  ok(opener.summary === 'You won 13 to 7. This came from your opening kills, which gave your team room.', 'with nothing dropped, an opener stays');

  // The count, in the summary and the round lines.
  const counted = matchReview.parse('SUMMARY: You won 13 to 7. 13 of your 15 deaths went unanswered, including rounds 3, 4, 6 and 7. '
    + 'You won 6 of 12 rounds on attack and 7 of 8 on defence. 12 of your 16 deaths came alone.\n'
    + 'R4: With 3 of your 5 teammates alive, take the next fight together.\nR7: Go in on a teammate\'s flash, because the first fight decides the round.\nFOCUS: Enter on a flash.', splitIn);
  ok(counted.summary === 'You won 13 to 7. 13 of your 15 deaths with a teammate alive to trade went unanswered, including rounds 3, 4, 6 and 7. You won 6 of 12 rounds on attack and 7 of 8 on defence.',
    `the card's count is named for its deaths, the block's stays, and a count the block does not hold goes (${counted.summary})`);
  ok(!(4 in counted.rounds) && counted.rounds[7] && counted.dropped.some((d) => d.n === 4 && d.said === 'count'),
    'a round line quoting a count the block does not hold goes whole');
  const oldCounted = matchReview.parse('SUMMARY: You won 13 to 7. 13 of your 15 deaths went unanswered.', matchReview.normalise({ ...without(body, 'counts'), mistakes: body.mistakes }));
  ok(oldCounted.summary === 'You won 13 to 7. 13 of your 15 deaths went unanswered.', 'a client before round 4 keeps its words');

  // From Platinum, one fundamentals habit at most.
  const capped = matchReview.parse('SUMMARY: You won 13 to 7.\nR3: Take the fight with a teammate close enough to kill your killer.\n'
    + 'R7: Name who follows you before the swing.\nR8: Reset to cover after the opening kill, giving up the second fight to keep the numbers.\n'
    + 'FOCUS: Go in on a teammate\'s flash on attack.', inputOf(splitPlat));
  ok(capped.rounds[3] && !(7 in capped.rounds) && capped.rounds[8] && capped.dropped.some((d) => d.n === 7 && d.said === 'fundamentals'),
    'from Platinum a second line teaching the trade habit goes, the first and the others stay');
  const lowCap = matchReview.parse('SUMMARY: You won 13 to 7.\nR3: Take the fight with a teammate close enough to kill your killer.\nR7: Name who follows you before the swing.',
    inputOf(splitSilver));
  ok(lowCap.rounds[3] && lowCap.rounds[7], 'below Platinum the trade habit is the lesson it is, in as many lines as teach it');

  // The re-audit's 24 reviews as a round 4 client reads them: the stale
  // count named, the product clause cut, a second fundamentals line from
  // Platinum, and nothing else.
  const gone = {};
  let quoted = 0;
  let named = 0;
  const STALE = /\b(?:13 of your 15|12 of your 13|9 of your 11) deaths\b/;
  for (const x of after) {
    const got = matchReview.parse(x.reply, inputOf(x));
    for (const d of got.dropped) gone[`${x.id} ${d.n === null ? 'S' : 'R' + d.n} ${d.said}`] = true;
    if (STALE.test(x.reply.split('\n')[0])) quoted += 1;
    if (STALE.test(got.summary || '') && /deaths with a teammate alive to trade went unanswered/.test(got.summary)) named += 1;
  }
  // The one round state line is the clock turned around (8.7.10, clockWrong):
  // Corrode round 1 after the plant on attack, "make the attackers spend time".
  const clockLine = 'review-corrode-3-13-silver_gold R1 round state';
  const kinds = Object.keys(gone).filter((k) => k !== clockLine).map((k) => k.split(' ').slice(2).join(' '));
  ok(quoted >= 10 && named === quoted && gone[clockLine] && kinds.every((k) => k === 'fundamentals' || k === 'product clause') && kinds.filter((k) => k === 'product clause').length === 1,
    `the 24 re-audit reviews: the card's count named for its deaths in all ${quoted} summaries that quote it (${named}), one product clause, the clock turned around in Corrode round 1, and only fundamentals lines besides (${Object.keys(gone).join(', ')})`);
  const src = fs.readFileSync(path.join(__dirname, '..', 'server', 'services', 'match-review.js'), 'utf8')
    + fs.readFileSync(path.join(__dirname, '..', 'src', 'shared', 'valorant-review.js'), 'utf8');
  ok(!src.includes(String.fromCharCode(8)), 'no backspace byte in either file, the shell regex hazard');
}

// ── The blind audit of 8.7.8 (Nov 2026), stream A: the record and the seams ─
// The review's parse gates read the same record-claims.js and coherence.js as
// Ask Coach: a round line a certain fact contradicts goes whole, a summary or
// focus sentence alone, and a swing fact glued on with its capital is mended.
{
  const rounds = [
    { n: 14, side: 'defending', result: 'lost', died: true, verified: true, sec: 31, killer: 'Omen', kills: 0, deathSpot: 'A Elbow' },
    { n: 5, side: 'attacking', result: 'lost', died: true, verified: true, sec: 12, killer: 'Phoenix', kills: 0, deathSpot: 'B Site', planted: true },
    { n: 6, side: 'attacking', result: 'lost', died: true, verified: true, sec: 8, killer: 'Phoenix', kills: 0, deathSpot: 'A Main' },
  ];
  const input = matchReview.normalise({ rounds, variant: 'C', context: { agent: 'Iso', language: 'en', enemyAgents: ['Chamber', 'Fade', 'Omen', 'Phoenix', 'Reyna'] } });
  const p = matchReview.parse([
    'SUMMARY: You won 5 to 1 by opening fights, even as You died 3 times in 6 rounds. You beat Omen in round 14 before he could swing.',
    'R14: Omen caught you at A Elbow, so hold the angle from further back.',
    'R5: You beat Phoenix in round 5, but you died before your team had touched B.',
    'R6: That was a defence round, and you peeked A Main alone.',
    'FOCUS: Hold your angle from cover, and fall back after the first shot.',
  ].join('\n'), input);
  ok(p.summary === 'You won 5 to 1 by opening fights, even as you died 3 times in 6 rounds.', `the seam mended and the kill Riot does not have dropped from the summary (${p.summary})`);
  ok(p.rounds[14] === 'Omen caught you at A Elbow, so hold the angle from further back.', 'a true round line stays as written');
  ok(!(5 in p.rounds) && !(6 in p.rounds), 'round 5 (a kill of nobody, a death at B Site told before the team touched B) and round 6 (a defence for an attack) go whole');
  ok(p.dropped.some((d) => d.n === 5 && /^record /.test(d.said)) && p.dropped.some((d) => d.n === 6 && d.said === 'record side'), `each logged by its kind (${JSON.stringify(p.dropped)})`);
  ok(p.focus === 'Hold your angle from cover, and fall back after the first shot.', 'the focus stays as written');
  // The team's record after the plant, said as the team's, stays in the summary.
  const sunset = matchReview.normalise({ variant: 'C', context: { agent: 'Jett', language: 'en' }, swing: ['Once they planted on defence, your team won 0 of 9 rounds.'],
    patterns: [{ key: 'early', text: '5 of your 9 deaths came in the first 30 seconds of the round, before any plant, in rounds 1, 2, 3, 4 and 5.' }],
    rounds: [1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => ({ n, side: 'defending', result: 'lost', died: true, verified: true, sec: n <= 5 ? 18 : 40, killer: 'Killjoy', kills: 0, planted: true })) });
  const s = matchReview.parse('SUMMARY: You lost 4 to 13, and once they planted on defence, your team won 0 of 9 rounds. Your biggest mistake was the retake: you won 0 of 9 defence rounds once they planted.', sunset);
  ok(s.summary === 'You lost 4 to 13, and once they planted on defence, your team won 0 of 9 rounds.', `the team's record kept, the player blamed for it dropped (${s.summary})`);
  // Outside English, nothing of it reads.
  const es = matchReview.normalise({ rounds, variant: 'C', context: { agent: 'Iso', language: 'es' } });
  ok(matchReview.parse('SUMMARY: Ganaste 5 a 1, even as You died.', es).summary === 'Ganaste 5 a 1, even as You died.', 'a review outside English is left as written');
}

// ── RIOT'S ROUND RECORD TEACHES THE REVIEW (8.8) ────────────────────────────
// The team's buy, the nearest teammate, Riot's callout of the death and the
// casts choose the study notes, the coaching notes and the cases, tell the
// prompt how to use them, and gate the sentences they contradict. A client
// that sends none of them is reviewed as before, byte for byte.
{
  const knowledge = require('../server/services/knowledge');
  const DASHES = new RegExp(`[${String.fromCharCode(0x2013)}${String.fromCharCode(0x2014)}]`);
  const seededRun = (fn) => {
    const random = Math.random;
    let x = 7;
    Math.random = () => { x = (x * 16807) % 2147483647; return x / 2147483647; };
    try { return fn(); } finally { Math.random = random; }
  };
  const R = (n, extra) => ({ n, side: 'attacking', result: 'lost', died: true, verified: true, sec: 20, timing: 'early', killer: 'Killjoy', weapon: 'Vandal',
    kills: 0, traded: false, alive: { mates: 3, enemies: 5 }, deathSpot: 'B Main', ...(extra || {}) });
  const rounds = [
    R(1, { result: 'won', died: false, sec: null, timing: null, killer: null, traded: null, alive: null, deathSpot: null, buy: 'pistol' }),
    R(2, { buy: 'eco', mate: 'far', place: 'B Main' }),
    R(3, { buy: 'eco', mate: 'far', place: 'B Main' }),
    R(4, { buy: 'full', mate: 'far', place: 'B Main', timing: 'mid', sec: 50 }),
    R(5, { buy: 'full', mate: 'close', place: 'A Main', deathSpot: 'A Main', timing: 'mid', sec: 50 }),
    R(6, { result: 'won', died: false, sec: null, timing: null, killer: null, traded: null, alive: null, deathSpot: null, buy: 'full' }),
  ];
  const strip = (r) => { const { buy, mate, place, casts, afk, ...rest } = r; return rest; };
  const body = (rs, extra) => ({ variant: 'C', context: { agent: 'Jett', map: 'Sunset', language: 'en', advancedTips: true, ...((extra && extra.context) || {}) },
    final: { team: 2, enemy: 4, result: 'Defeat', verified: true }, rounds: rs, patterns: [], mistakes: [], strengths: [] });
  const input = matchReview.normalise(body(rounds));
  const plain = matchReview.normalise(body(rounds.map(strip)));
  ok(input.rounds.find((r) => r.n === 2).place === 'B Main' && !('place' in matchReview.normalise(body([R(2, { place: 'Hookah', buy: 'eco' })])).rounds[0]),
    'the server keeps Riot\'s place only as a place of the map');
  ok(!('place' in matchReview.normalise(body([R(2, { died: false, place: 'B Main' })])).rounds[0]), 'and only for a death');
  const sig = matchReview.recordSignalsOf(input);
  ok(sig && sig.economy.includes('eco') && sig.economy.includes('fullbuy') && sig.causes.includes('isolated') && sig.repeatPlace === 'B Main',
    `the signals: deaths on ecos, full loadouts lost, lone deaths, three deaths at B Main (${JSON.stringify(sig)})`);
  ok(matchReview.recordSignalsOf(plain) === null, 'a review without the record has no signal');

  // The study list: the spot topics for the repeated callout, the lone deaths' checkpoints.
  const topicOf = (text) => ((knowledge.all().find((n) => n.text === text) || {}).source || {}).topic;
  const studied = matchReview.study(input, 4).map((n) => topicOf(n.text));
  const before = matchReview.study(plain, 4).map((n) => topicOf(n.text));
  const spotOrIso = [...matchReview.PATTERN_TOPICS.spot, ...matchReview.CAUSE_TOPICS.isolated, ...matchReview.ECONOMY_TOPICS.eco];
  ok(studied.filter((t) => spotOrIso.includes(t)).length > before.filter((t) => spotOrIso.includes(t)).length,
    `the study list turns to the repeated callout, the lone deaths and the eco (${studied.join(' | ')})`);
  ok(JSON.stringify(matchReview.study(plain, 4)) === JSON.stringify(matchReview.study(matchReview.normalise(body(rounds.map(strip))), 4)), 'without the record the list is as before');

  // The coaching notes and the cases.
  const p = seededRun(() => matchReview.buildPrompt(input));
  const p0 = seededRun(() => matchReview.buildPrompt(plain));
  const econNotes = knowledge.all().filter((n) => n.situations && n.situations.some((f) => ['eco', 'fullbuy'].includes(f))).map((n) => n.text);
  const knowledgeOf = (text) => { const i = text.indexOf('COACHING KNOWLEDGE'); const j = text.indexOf('\n\n', i); return i < 0 ? '' : text.slice(i, j < 0 ? undefined : j); };
  const fullNotes = knowledge.all().filter((n) => n.situations && n.situations.includes('fullbuy')).map((n) => n.text);
  const lines = (text) => knowledgeOf(text).split('\n').filter((l) => l.startsWith('- ')).map((l) => l.slice(2));
  const at = lines(p).findIndex((t) => fullNotes.includes(t));
  ok(at >= 0 && at < matchReview.NOTES_FLOOR && !lines(p0).some((t) => fullNotes.includes(t)) && econNotes.length > 0,
    `full loadouts lost bring a full loadout note into the coaching knowledge, inside the floor the cases never cut (at ${at})`);
  const cs = matchReview.caseSituation(input, []);
  ok(cs.economies.has('eco') && cs.causes.has('isolated') && !matchReview.caseSituation(plain, []).economies.has('eco'), 'and the eco and the lone deaths into the cases\' situation');
  const silver = matchReview.normalise(body(rounds, { context: { rankBand: 'silver_gold' } }));
  const casesMod = require('../server/services/cases');
  const eligible = (x) => casesMod.scored(matchReview.caseSituation(x, [])).map((n) => n.c.id);
  const silverPlain = matchReview.normalise(body(rounds.map(strip), { context: { rankBand: 'silver_gold' } }));
  ok(eligible(silver).includes('k134') && !eligible(silverPlain).includes('k134'),
    'an attacking eco lost alone makes the attacking eco case eligible, which it is not without the record');

  // The prompt's lines, only for what the rounds carry.
  ok(p.includes(matchReview.RECORD_USE.mate) && p.includes(matchReview.RECORD_USE.buy) && !p.includes(matchReview.RECORD_USE.casts) && !p.includes(matchReview.RECORD_USE.afk),
    'the prompt says how to use the distance and the economy, and nothing of casts or AFK it does not have');
  ok(!/spacing point|economy changes what a death teaches/.test(p0) && p0.includes(matchReview.NO_ECONOMY), 'a match without the record is prompted as before');
  const casts = matchReview.normalise(body([R(2, { casts: [{ name: 'Tailwind', n: 0 }, { name: 'Updraft', n: 1 }] }), R(3, { afk: true })]));
  const pc = matchReview.buildPrompt(casts);
  ok(pc.includes(matchReview.RECORD_USE.casts) && pc.includes(matchReview.RECORD_USE.afk) && !pc.includes(matchReview.RECORD_USE.mate), 'the casts and the AFK round each bring their own line');
  const mateOnly = matchReview.buildPrompt(matchReview.normalise(body([R(2, { mate: 'far' })])));
  ok(mateOnly.includes(matchReview.NO_ECONOMY + matchReview.RECORD_USE.mate), 'a distance without a buy keeps the rule that the economy is not known');
  for (const s of Object.values(matchReview.RECORD_USE)) ok(!s.includes(';') && !DASHES.test(s) && !matchReview.BUY_BLAME.test(s), `no semicolon, dash or "buy" in "${s.slice(0, 50)}"`);

  // The gates: a sentence the round's record contradicts goes, a true one stays.
  const reply = 'SUMMARY: You lost 2 to 4. In round 2 you died at A Main with nobody around. Round 2 was an eco, so that death cost little.\n'
    + 'R4: That round was an eco, so the loss was cheap.\nR5: Nobody was close when you died, so the fight could not be traded.\n'
    + 'R3: Nobody was close when you died, so step back toward your team.\nFOCUS: Take the B Main fight with a teammate.';
  const out = matchReview.parse(reply, input);
  ok(out.summary === 'You lost 2 to 4. Round 2 was an eco, so that death cost little.', `the summary loses the death put at A Main and keeps the eco (${out.summary})`);
  ok(!out.rounds[4] && !out.rounds[5] && !!out.rounds[3], `round 4 called an eco of a full loadout and round 5's nobody close of a teammate close go, round 3 stays (${Object.keys(out.rounds)})`);
  ok(out.dropped.some((d) => d.n === 4 && d.said === 'record record') && out.dropped.some((d) => d.n === 5 && d.said === 'record record'), 'each dropped as the record\'s');
  const outPlain = matchReview.parse(reply, plain);
  ok(!!outPlain.rounds[4] && !!outPlain.rounds[5] && /A Main/.test(outPlain.summary || ''), 'a review without the record judges none of it');
}

// ── The blind audit of 8.7.9 (Nov 2026), stream B: the review ─────────────
// From Platinum the deaths are ranked by what each cost and the prompt and
// the study list follow them; a round line giving advice for after the plant
// of a death before it goes (record-claims.js checkPostPlant). On the audit's
// own 24 review bodies (scripts/fixtures/audit-round3-after-reviews.json).
{
  console.log('\nthe blind audit of 8.7.9, stream B (review):');
  const DASHES = new RegExp('[' + String.fromCharCode(0x2013, 0x2014) + ']');
  const after = require('./fixtures/audit-round3-after-reviews.json').reviews;
  const bodyOf = (x, o) => ({ rounds: x.rounds, swing: [], counts: {}, mistakes: x.mistakes || [], strengths: [], patterns: [],
    context: { agent: x.agent, map: x.map, rankBand: x.band, advancedTips: true },
    final: { team: Number(x.score.split('-')[0]), enemy: Number(x.score.split('-')[1]), result: x.result, verified: true, scoreline: x.scoreline }, ...(o || {}) });
  const inputOf = (x, o) => ({ ...matchReview.normalise(bodyOf(x, o)), byCause: true, byEnemy: true });
  const get = (id) => after.find((x) => x.id === id);
  const fracAsc = inputOf(get('review-fracture-5-1-asc_plus'));
  const line = matchReview.costLineOf(fracAsc);
  ok(/^THE COSTLIEST DEATHS/.test(line) && /First, round 5, an attack round your team lost/.test(line) && line.indexOf('round 5') < line.indexOf('round 2')
    && !line.includes(';') && !DASHES.test(line), `Fracture at Ascendant: round 5, the only lost round, ranked first (${line.slice(0, 140)})`);
  ok(matchReview.costLineOf(inputOf(get('review-fracture-5-1-silver_gold'))) === '' && matchReview.costLineOf(matchReview.normalise({ ...bodyOf(get('review-fracture-5-1-asc_plus')), counts: undefined })) === '',
    'no line below Platinum, and none for a client before round 4');
  ok(matchReview.buildPrompt(fracAsc).includes(line) && !matchReview.buildPrompt(inputOf(get('review-fracture-5-1-silver_gold'))).includes('THE COSTLIEST DEATHS'),
    'the Ascendant prompt carries the line beside the counts, the Silver prompt does not');
  // Advice for after the plant, of a death before it: Pearl round 3 (three
  // reviews) and Sunset 2 to 5 round 1, the player dead in the early pattern.
  const early = (rounds) => [{ key: 'early', text: `5 of your 5 deaths came in the first 30 seconds of the round, before any plant, in rounds ${rounds}.` }];
  const pearl = inputOf(get('review-pearl-1-5-silver_gold'), { patterns: early('1, 3, 4, 5 and 6') });
  const out = matchReview.parse('SUMMARY: You lost 1 to 5.\nR3: Enter B with a teammate following, then hold the planted spike from cover rather than exposing yourself again.\n'
    + 'R4: Call which teammate follows before pushing so your early entry has support.\nFOCUS: Before an early push, call which teammate will follow you.', pearl);
  ok(!out.rounds[3] && !!out.rounds[4] && out.dropped.some((d) => d.n === 3 && d.said === 'record postplant'),
    `Pearl round 3's "hold the planted spike" of a death before the plant goes, round 4 stays (${JSON.stringify(out.dropped)})`);
  const pearlNoEarly = inputOf(get('review-pearl-1-5-silver_gold'));
  ok(!!matchReview.parse('SUMMARY: You lost 1 to 5.\nR3: Enter B with a teammate following, then hold the planted spike from cover.', pearlNoEarly).rounds[3],
    'kept where the record cannot say the death came before the plant');
  // The study list follows the costliest deaths from Platinum, never what a line already says.
  const topics = matchReview.costTopics(fracAsc);
  ok(topics.get('man advantage') === matchReview.COST_BONUS && topics.has('Lost duel checklist') && matchReview.costTopics(inputOf(get('review-fracture-5-1-silver_gold'))).size === 0,
    'Fracture round 5, the advantage given back on a lost duel, sends the study list to playing the numbers and the duel, from Platinum only');
  const firsts = new Set(after.filter((x) => x.band === 'asc_plus').map((x) => (matchReview.study(inputOf(x))[0] || {}).text));
  ok(firsts.size >= 4, `the six Ascendant matches open their study lists on ${firsts.size} different notes`);
  const st = matchReview.study(fracAsc);
  ok(st.length && matchReview.study(fracAsc, 3, { lines: [st[0].text] }).every((n) => n.text !== st[0].text) && matchReview.repeats(st[0].text, [st[0].text]),
    'a note the focus or a round line already says is left out of the study list');
  ok(!matchReview.repeats(st[0].text, ['Hold the spike from cover.']), 'and a note no line says stays');
}

console.log(`\n${fails ? fails + ' of ' + checks + ' failed' : 'all ' + checks + ' valorant review checks passed'}`);
process.exit(fails ? 1 : 0);
