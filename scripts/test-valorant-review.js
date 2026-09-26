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

// ── The watch: a final score needs a second opinion ─────────────────────────
{
  const w = new MatchEndWatch();
  w.play({ team: 12, enemy: 10, mode: 'standard', at: 1000 });
  ok(w.play({ team: 13, enemy: 10, mode: 'standard', at: 11000 }) === null,
    'one final score read does not end the match on its own');
  ok(w.play({ team: 12, enemy: 11, mode: 'standard', at: 21000 }) === null && !w.pendingFinal,
    'and play continuing at a score that is not final cancels it, that read was a misread');
  const e = (w.play({ team: 13, enemy: 11, mode: 'standard', at: 31000 }),
    w.play({ team: 13, enemy: 11, mode: 'standard', at: 41000 }));
  ok(e && e.kind === 'end' && e.reason === 'score', 'two agreeing final reads end it');
  ok(w.play({ team: 13, enemy: 11, mode: 'standard', at: 51000 }).kind === 'ignore',
    'the end screen still shows the final score and a HUD, and is not recorded');
  ok(w.play({ team: 0, enemy: 0, mode: null, at: 400000 }).kind === 'new-match',
    'a lower score is the next match');
}
{
  const w = new MatchEndWatch();
  w.play({ team: 12, enemy: 11, mode: 'standard', at: 0 });
  w.play({ team: 13, enemy: 11, mode: 'standard', at: 10000 });
  const e = w.lobby({ at: 20000, rounds: 24 });
  ok(e && e.kind === 'end' && e.reason === 'score', 'a final read followed by a menu ends it at once');
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
  ok(side && side.text === 'Won 6 of 12 on attack and 7 of 12 on defence.', `side split is exact (${side && side.text})`);

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
  ok(stopped.refused.some((t) => /stopped before the match ended/.test(t)), 'and says why');
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
