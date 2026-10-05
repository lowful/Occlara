'use strict';

/**
 * The Valorant post-match review: the round ledger, the match-end watch, the
 * computed review, and the server half that parses the model's reply.
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
  ok(w.play({ team: 3, enemy: 2, mode: null, at: 60000 }).kind === 'new-match',
    'after a menu end any gameplay is the next thing played');
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
  ok(side && side.text === 'Defence was your stronger side: won 6 of 12 on attack and 7 of 12 on defence.',
    `side split is exact, and names the stronger side (${side && side.text})`);

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

// ── Study notes are sourced and fit the player ──────────────────────────────
{
  const base = { rounds: [], patterns: [{ key: 'early', text: 'x' }], context: { agent: 'Jett', map: 'Abyss' } };
  const notes = matchReview.study(matchReview.normalise(base), 3);
  ok(notes.length === 3 && notes.every((n) => n.coach), `three notes, every one attributed (${notes.map((n) => n.coach).join(', ')})`);
  ok(!notes.some((n) => /recon bolt|stars|Astra/i.test(n.text)), "a Jett never gets a Sova or Astra note");
  ok(!notes.some((n) => /^Your (rifle|pistol|SMG|shotgun|sniper|machine gun)/.test(n.text)), 'no weapon note, the gun changes every round');
  ok(notes.some((n) => /checkpoint|piece of space/i.test(n.text)), 'early deaths send a duelist to the checkpoint notes');
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
  ok([2, 7, 10, 23].every((n) => picks.includes(n)), 'every first death round is among them');
  ok(/one round line for each of these rounds, in this order: R2, /.test(prompt), 'the prompt names them');

  // THE KILLER GATE, on the exact lines the live model wrote for this match.
  const reply = 'SUMMARY: You won.\nR4: Taking A vent wide with no trade partner gives Viper an easy kill opportunity.\n'
    + 'R5: Peeking A vent alone against Viper is a free kill when your team is elsewhere.\n'
    + 'R10: Dying first as Cypher catches you shows you stepped out without breaking his angle.\nFOCUS: Smoke first.';
  const parsed = matchReview.parse(reply, input);
  ok(!(5 in parsed.rounds) && parsed.dropped.some((d) => d.n === 5 && d.said === 'Viper' && d.riot === 'Phoenix'),
    'R5 named Viper where Riot says Phoenix, and is dropped');
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
  const one = verify.describe({ ...c.checks, readsDropped: 1 });
  ok(/Riot contradicts one of the coach's reads, so it is hidden\.$/.test(one), `one hidden read, singular (${one})`);
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
  ok(partial.refused.includes("Riot's record fills in rounds 1 to 14, which the coach did not watch, so those rounds have no location or coach's read."),
    `and it says where the other rounds come from (${partial.refused.join(' | ')})`);
  const early = verify.reconcile(abyss.rounds.filter((r) => r.n <= 20), riot);
  const cut = review.build({ rounds: early.rounds, context: abyss.context, endedBy: 'stop' });
  ok(cut.refused.includes("Coaching was stopped before the match ended. Riot's record fills in rounds 21 to 24, "
    + "which the coach did not watch, so those rounds have no location or coach's read."),
    `stopped at round 20 of 24, Riot's record shows the match went on (${cut.refused.join(' | ')})`);
  ok(review.spans([1, 2, 3, 4, 24]) === 'rounds 1 to 4 and 24' && review.spans([5, 6, 9]) === 'rounds 5, 6 and 9'
    && review.spans([7]) === 'round 7', 'round runs read as a person would write them');
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

// ── The real swiftplay match ────────────────────────────────────────────────
{
  const sp = replay(load('valorant-match-swiftplay-2-5.json').frames, 'swiftplay');
  ok(sp.endedBy === 'score' && sp.rounds.length === 7, `the 2 to 5 swiftplay ends on its score with 7 rounds (${sp.endedBy}, ${sp.rounds.length})`);
  const rv = review.build({ rounds: sp.rounds, context: sp.context, endedBy: sp.endedBy });
  ok(rv.game.result === 'Defeat' && rv.halftimeAfter === 4, 'a defeat, with halftime after round 4');
}

console.log(`\n${fails ? fails + ' of ' + checks + ' failed' : 'all ' + checks + ' valorant review checks passed'}`);
process.exit(fails ? 1 : 0);
