'use strict';

/**
 * A DEATH IS A CHAIN OF MISTAKES READ IN THE CONTEXT OF THE MATCH (Nov 2026).
 *
 *   npm run test:deathchain
 *
 * The chain of one death (src/shared/death-chain.js), the match's own memory,
 * the chains counted (insights.js chainCounts), the review's view of them
 * (valorant-review.js withView), what a review request carries and how the
 * server checks and words it (server/services/match-memory.js,
 * match-review.js), the gate on what a reply says came earlier
 * (record-claims.js checkEarlier), and Ask Coach's round asked
 * (chat-context.js, chat-prompt.js). Offline, no model.
 *
 * The rounds are the owner's Bind match as Riot's record has it, agents and
 * callouts only, no name: round 6 on defence at Hookah, a Stinger kill on the
 * first attacker 8.8 s in and Chamber killing the player 1.07 s later, no
 * teammate close, nobody trading it, five against four in a round the team
 * lost; Phoenix killed the player at Hookah in rounds 1 and 3, Chamber in 5.
 */

const dc = require('../src/shared/death-chain');
const insights = require('../src/shared/insights');
const review = require('../src/shared/valorant-review');
const chatContext = require('../src/shared/chat-context');
const mm = require('../server/services/match-memory');
const matchReview = require('../server/services/match-review');
const rc = require('../server/services/record-claims');
const chatPrompt = require('../server/services/chat-prompt');

let fails = 0;
let checks = 0;
const ok = (cond, what) => {
  checks += 1;
  if (cond) console.log(`ok    ${what}`);
  else { fails += 1; console.log(`FAIL  ${what}`); }
};
const DASH = new RegExp(`[${String.fromCharCode(0x2013)}${String.fromCharCode(0x2014)}]`);

// ── The owner's Bind match, as ledger rows ─────────────────────────────────
const feed6 = [
  { ms: 8808, by: 'me', on: 'enemy', ka: 'Iso', va: 'Phoenix', w: 'Stinger' },
  { ms: 9874, by: 'enemy', on: 'me', ka: 'Chamber', va: 'Iso', w: 'Phantom' },
  { ms: 21000, by: 'mate', on: 'enemy', ka: 'Phoenix', va: 'Neon', w: 'Phantom' },
];
const look6 = { cause: 'repeek', what: 'You held the edge of cover at B Window, killed the first enemy, then stayed on the same angle and Chamber killed you with a Phantom.',
  better: 'After the first kill, step back behind cover instead of staying on the angle for Chamber.', frames: [], source: 'riot', fight: 'wrong-time', change: 'timing', variant: 'b' };
const death = (n, o) => ({ n, side: 'defending', result: 'lost', died: true, early: false, planted: false, verified: true, deathSec: 40,
  killerAgent: 'Phoenix', weapon: 'Vandal', kills: 0, traded: false, aliveAtDeath: { mates: 3, enemies: 4 }, feed: [], riotSpot: 'Hookah', mateNear: 'far', ...o });
const lived = (n, o) => ({ n, side: 'defending', result: 'won', died: false, verified: true, feed: [], kills: 1, ...o });
const bind = () => [
  death(1),
  lived(2),
  death(3, { result: 'won' }),
  lived(4),
  death(5, { killerAgent: 'Chamber', riotSpot: 'B Long', mateNear: 'close' }),
  death(6, { early: true, deathSec: 10, killerAgent: 'Chamber', weapon: 'Phantom', firstKill: true, kills: 1, aliveAtDeath: { mates: 5, enemies: 4 }, feed: feed6, forensics: look6 }),
  lived(7),
];

// Rounds 1 and 3 on attack, where nobody close to trade can be a first mistake, so the match has a biggest repeat.
const bindAtk = () => bind().map((r) => (r.n === 1 || r.n === 3 ? { ...r, side: 'attacking' } : r));

// ── 1. The chain of round 6 ─────────────────────────────────────────────────
console.log('\nthe chain of a death:');
{
  const rows = bind();
  const c = dc.chainOf(rows[5], rows, { half: 12 });
  ok(c && c.first && c.first.kind === 'no-escape' && c.first.from === 'look',
    `round 6's first mistake is the spot with no way out, the look's repeek as the record reads it (${c && c.first && c.first.kind})`);
  ok(c.first.short === 'a kill at Hookah, then Chamber killed you 1.1 seconds later', `its evidence is Riot's place, killer and seconds (${c.first.short})`);
  ok(c.worse.map((w) => w.kind).join() === 'untradeable,gave-advantage', `what made it worse: nobody close to trade, and the five against four given back (${c.worse.map((w) => w.kind)})`);
  ok(c.worse[0].text === 'No teammate was close when you died, with four teammates alive, and nobody traded it.', `the trade in the record's words (${c.worse[0].text})`);
  ok(c.worse[1].text === 'Your team was up 5 against 4 when you died, and the round was lost.', 'the advantage in the record\'s words');
  ok(c.mistakes === 3, 'three mistakes in one death');
  ok(c.earlier.join(' | ') === 'you died at Hookah in rounds 1 and 3 too | Chamber killed you in round 5 too | your fourth death in a row that nobody traded',
    `what came before it: the same spot twice, the same enemy once, the run nobody traded (${c.earlier.join(' | ')})`);
  ok(c.situation[0] === 'the score was 3 to 2 before the round', `the score before the round from the results (${c.situation.join(' | ')})`);
  ok(!JSON.stringify(c).match(/\b(?:buy|eco|credits|always|never)\b/i) && !DASH.test(JSON.stringify(c)), 'no economy, no absolutes, no dash');

  // Each condition held both ways.
  const one = (o, more) => { const rs = bind(); rs[5] = { ...rs[5], ...o }; return dc.chainOf(rs[5], more ? more(rs) : rs, { half: 12 }); };
  ok(one({ forensics: { ...look6, cause: 'lost-duel' }, feed: [feed6[1]] }) === null || one({ forensics: { ...look6, cause: 'lost-duel' }, feed: [feed6[1]] }).first === null,
    'a lost duel the record does not answer is a fair fight, never a first mistake');
  const fair = one({ forensics: { ...look6, cause: 'lost-duel' }, feed: [feed6[1]] });
  ok(fair && fair.fair && fair.worse.map((w) => w.kind).join() === 'untradeable,gave-advantage', 'and what made it cost more is still said beside it');
  ok(one({ traded: true }).worse.every((w) => w.kind !== 'untradeable' && w.kind !== 'gave-advantage'), 'a traded death has neither the trade nor the advantage given back');
  ok(one({ mateNear: 'close' }).worse.every((w) => w.kind !== 'untradeable'), 'a teammate close: not nobody close to trade');
  ok(one({ aliveAtDeath: { mates: 1, enemies: 2 }, result: 'lost' }).worse.every((w) => w.kind !== 'untradeable'), 'the last one alive had nobody to trade them');
  ok(one({ forensics: { ...look6, cause: 'isolated', what: 'Caught alone.' }, feed: [feed6[1]] }).first.kind === 'isolated'
    && one({ forensics: { ...look6, cause: 'isolated', what: 'Caught alone.' }, feed: [feed6[1]] }).worse.every((w) => w.kind !== 'untradeable'),
  'a look that saw the player caught alone is the first mistake, and the record does not say it twice');
  // The spot with no way out from the record alone, with no look.
  const noLook = one({ forensics: null });
  ok(noLook.first.kind === 'no-escape' && noLook.first.from === 'record', 'with no look, the record\'s own kill answered at once is the first mistake');
  ok(!one({ forensics: null, feed: [{ ...feed6[0], ms: 7000 }, feed6[1]] }).first, 'a death 2.9 s after the kill is no instant answer, and on defence before the plant nobody close to trade is no first mistake');
  ok(one({ forensics: null, side: 'attacking', feed: [{ ...feed6[0], ms: 7000 }, feed6[1]] }).first.kind === 'untradeable', 'on attack nobody close to trade comes first');
  // No first mistake and no fair fight: no chain of mistakes.
  const quiet = dc.chainOf(death(9, { traded: false, mateNear: 'close', riotSpot: 'A Short', killerAgent: 'Viper' }), [death(9, { mateNear: 'close', riotSpot: 'A Short', killerAgent: 'Viper' })]);
  ok(quiet === null, 'a death with a teammate close and no trade, and nothing else, is no chain: the record cannot show whose mistake it was');
  ok(dc.chainOf(death(4, { afk: true }), [death(4, { afk: true })]) === null, 'a round the player sat out has no chain');
  ok(dc.chainOf(death(4, { verified: false }), [death(4, { verified: false })]) === null, 'a death Riot never verified has no chain');
  // No ability (Nov 2026, the coaching audit): every cast at zero, trusted only
  // where the match has a cast in another round, never first, never on defence
  // before the plant in the first 40 s, and a dry peek takes it as its evidence.
  const casts = { C: 0, Q: 0, E: 0, X: 0 };
  const castOnce = lived(2, { casts: { ...casts, Q: 1 } });
  const withMatch = (r) => [castOnce, r];
  const atkFar = (o) => death(8, { side: 'attacking', casts, riotSpot: 'A Short', ...o });
  const util = dc.chainOf(atkFar({}), withMatch(atkFar({})));
  ok(util && util.first.kind === 'untradeable' && util.worse.some((w) => w.kind === 'no-utility' && w.text === "Riot's record has no ability cast by you that round."),
    `every cast at zero, with a cast in another round, is no ability used, beside a first mistake (${util && util.worse.map((w) => w.kind)})`);
  ok(dc.chainOf(atkFar({ mateNear: null }), withMatch(atkFar({ mateNear: null }))) === null, 'no ability used is never a first mistake: alone it is no chain');
  ok(!dc.FIRST_ORDER.includes('no-utility') && dc.KINDS['no-utility'].cause === false, 'and it is not in the first order');
  const noCastAnywhere = dc.chainOf(atkFar({}), [lived(2, { casts }), atkFar({})]);
  ok(noCastAnywhere && !noCastAnywhere.worse.some((w) => w.kind === 'no-utility'), 'a match with no cast above zero in any round is a record that does not count them: not trusted');
  ok(dc.chainOf(atkFar({ casts: { ...casts, Q: 1 } }), withMatch(atkFar({ casts: { ...casts, Q: 1 } }))).worse.every((w) => w.kind !== 'no-utility'), 'one cast is not none');
  // On defence before the plant, a death at 40 s or sooner never counts it; at 41 s it may.
  const defOver = (sec) => death(8, { casts, deathSec: sec, riotSpot: 'A Short', forensics: { cause: 'overextend', what: 'You pushed.', source: 'riot' } });
  ok(dc.chainOf(defOver(40), withMatch(defOver(40))).worse.every((w) => w.kind !== 'no-utility'), 'on defence before the plant, a death at 40 s does not count no ability used');
  ok(dc.chainOf(defOver(41), withMatch(defOver(41))).worse.some((w) => w.kind === 'no-utility'), 'and a death at 41 s does');
  ok(dc.chainOf(defOver(null), withMatch(defOver(null))).worse.every((w) => w.kind !== 'no-utility'), 'and a death at an unknown second does not');
  const defAfter = death(8, { casts, deathSec: 30, afterPlant: true, planted: true, riotSpot: 'A Short', forensics: { cause: 'overextend', what: 'You pushed.', source: 'riot' } });
  ok(dc.chainOf(defAfter, withMatch(defAfter)).worse.some((w) => w.kind === 'no-utility'), 'after the plant on defence it counts at any second');
  const dryRow = (o) => atkFar({ mateNear: null, forensics: { cause: 'dry-peek', what: 'You swung wide.', source: 'riot' }, ...o });
  const dry = dc.chainOf(dryRow({}), withMatch(dryRow({})));
  ok(dry.first.kind === 'dry-peek' && !dry.worse.some((w) => w.kind === 'no-utility') && /no ability cast by you/.test(dry.first.text), 'a dry peek with no cast carries the record as its own evidence');
  ok(!/no ability cast by you/.test(dc.chainOf(dryRow({}), [dryRow({})]).first.text), 'and not where the match has no cast to trust the zero by');
  // Early on attack: only on attack, with the whole team up, before the plant.
  const atk = (o) => death(2, { side: 'attacking', early: true, deathSec: 18, aliveAtDeath: { mates: 5, enemies: 5 }, mateNear: 'close', riotSpot: 'A Short', firstDeath: true, ...o });
  const early = dc.chainOf(atk({}), [atk({})]);
  ok(early.first.kind === 'early-attack' && early.worse[0].kind === 'first-death', `an early untraded death on attack, first down (${early.first.kind}, ${early.worse.map((w) => w.kind)})`);
  ok(dc.chainOf(atk({ side: 'defending' }), [atk({ side: 'defending' })]) === null, 'on defence the attackers choose when to come: no early death mistake');
  // The same spot a third time, never a whole site.
  const thrice = [death(1, { side: 'attacking' }), death(3, { side: 'attacking' }), death(5, { side: 'attacking' })];
  ok(dc.chainOf(thrice[2], thrice).first.kind === 'untradeable' && dc.chainOf(thrice[2], thrice).worse.some((w) => w.kind === 'repeat-spot' && w.short === 'your third death at Hookah, after rounds 1 and 3'),
    'a third death at one callout is the same spot again');
  const sites = [1, 3, 5].map((n) => death(n, { riotSpot: 'A site', side: 'attacking' }));
  ok(!dc.chainOf(sites[2], sites).worse.some((w) => w.kind === 'repeat-spot') && dc.chainOf(sites[2], sites).earlier.every((t) => !/A site/.test(t)),
    'a whole site is never the same spot');
  // Ordinals past ten.
  const run = Array.from({ length: 12 }, (_, i) => death(i + 1, { riotSpot: 'A Short', killerAgent: ['Viper', 'Sova', 'Omen', 'Jett'][i % 4] }));
  ok(dc.chainOf(run[10], run).earlier.includes('your 11th death in a row that nobody traded') && dc.chainOf(run[11], run).earlier.includes('your 12th death in a row that nobody traded'),
    'the 11th and the 12th in a row');
}

// ── 1b. Defence before the plant, and the same spot (the owner's lead) ────────
console.log('\nnobody close to trade on defence, and the same spot:');
{
  // The owner's Bind rounds 1, 3, 5, 8, 9 and 11 as the record has them: on
  // defence, before any plant, no teammate close, nobody trading it, no look.
  const owner = [1, 3, 5, 8, 9, 11].map((n) => death(n, { riotSpot: n <= 3 ? 'Hookah' : 'B Long', killerAgent: ['Phoenix', 'Astra'][n % 2] }));
  for (const r of owner) {
    const c = dc.chainOf(r, owner, { half: 12 });
    ok(!c || (!c.first && !c.worse.length), `Bind round ${r.n} on defence before the plant: nobody close to trade is no first mistake, and nothing is said worse (${c && c.first && c.first.kind})`);
  }
  // Round 7: on defence after the plant (a retake or holding the plant), it can be first.
  const r7 = death(7, { afterPlant: true, planted: true, riotPlantMs: 26000, deathSec: 36 });
  ok(dc.chainOf(r7, [r7]).first.kind === 'untradeable', 'Bind round 7, after the plant: nobody close to trade can be first');
  ok(dc.chainOf(death(4, { side: 'attacking' }), [death(4, { side: 'attacking' })]).first.kind === 'untradeable', 'and on attack');
  // Beside another first mistake it may still make it worse: round 6 keeps it.
  ok(dc.chainOf(bind()[5], bind()).worse[0].kind === 'untradeable', 'beside a first mistake on defence it still makes it worse');
  // The same spot alone is never first: context in earlier.
  const four = [1, 3, 6, 19].map((n) => death(n, { side: 'attacking', mateNear: 'close', killerAgent: ['Sova', 'Omen', 'Jett', 'Skye'][n % 4] }));
  const c19 = dc.chainOf(four[3], four);
  ok(c19 && !c19.first && !c19.worse.length && c19.earlier[0] === 'you died at Hookah in rounds 1, 3 and 6 too', `the same spot a fourth time is context, never the first mistake (${JSON.stringify(c19 && c19.first)})`);
  // The server holds the same rule for a client that sends it anyway.
  const srv = mm.rowsOfReview([{ n: 1, side: 'defending', result: 'lost', died: true, verified: true, traded: false, mate: 'far', alive: { mates: 3, enemies: 4 }, place: 'Hookah' }]);
  ok(mm.chainWords({ n: 1, first: 'untradeable', worse: [] }, srv) === null && mm.chainWords({ n: 1, first: 'repeat-spot', worse: [] }, srv) === null,
    'the server takes neither as a first mistake on defence before the plant');
}

// ── 2. The match's own memory ───────────────────────────────────────────────
console.log('\nthe match\'s memory:');
{
  const rows = bind();
  const mem = dc.memoryOf(rows, { half: 12 });
  const by = (k) => mem.find((m) => m.key === k);
  ok(by('place') && by('place').text === 'You died at Hookah 3 times, rounds 1, 3 and 6.', `the callout the player kept dying at (${by('place') && by('place').text})`);
  ok(by('place-killer') && by('place-killer').text === 'Phoenix killed you at Hookah twice, rounds 1 and 3.', 'and the enemy who killed them there twice');
  ok(by('streak') && by('streak').text === '4 deaths in a row nobody traded, rounds 1, 3, 5 and 6.', `the run of deaths nobody traded (${by('streak') && by('streak').text})`);
  const long = Array.from({ length: 8 }, (_, i) => death(i + 1, { riotSpot: null }));
  ok(dc.memoryOf(long).find((m) => m.key === 'streak').text === '8 deaths in a row nobody traded, from round 1 to round 8.', 'a long run is said as its span, never a list of eight');
  const shift = [death(1, { killerAgent: 'Sova', riotSpot: null }), death(2, { killerAgent: 'Omen', riotSpot: null }), death(3, { killerAgent: 'Jett', riotSpot: null }),
    death(4, { killerAgent: 'Chamber', riotSpot: null }), death(5, { killerAgent: 'Chamber', riotSpot: null }), death(7, { killerAgent: 'Chamber', riotSpot: null })];
  const s = dc.memoryOf(shift).find((m) => m.key === 'shift');
  ok(s && s.text === 'Chamber killed you in none of your 3 deaths before round 4, and in rounds 4, 5 and 7 from then on.', `an enemy who started winning from a round on (${s && s.text})`);
  const fc = dc.memoryOf([lived(1, { firstKill: true }), lived(2, { firstKill: true }), death(3, { firstDeath: true })]).find((m) => m.key === 'first-contact');
  ok(fc && fc.text === "You were in the round's first fight 3 times: you won it in rounds 1 and 2, and died first in round 3.", 'the first fights the player was in');
  const halves = [1, 2, 3, 4].map((n) => death(n, { traded: n !== 4, riotSpot: null, killerAgent: null })).concat([14, 15, 16].map((n) => death(n, { riotSpot: null, killerAgent: null })));
  const h = dc.memoryOf(halves, { half: 12 }).find((m) => m.key === 'half');
  ok(h && h.text === 'In the first half 3 of your 4 deaths were traded, and in the second half 0 of 3.', `what the first half kept and the second dropped (${h && h.text})`);
  ok(dc.memoryOf([death(1, { afk: true }), death(2, { afk: true }), death(3, { afk: true })]).length === 0, 'rounds sat out are in no line');
}

// ── 3. Counted, and the biggest repeat ──────────────────────────────────────
console.log('\nthe chains counted:');
{
  // Rounds 1 and 3 on attack, where nobody close to trade can be a first mistake.
  const rows = bindAtk();
  const counted = insights.chainCounts(dc.chainsOf(rows, { half: 12 }));
  ok(counted.first.find((x) => x.kind === 'untradeable').count === 2 && counted.worse.find((x) => x.kind === 'untradeable').count === 1,
    'a kind is counted apart as a first mistake and as what made one worse');
  ok(counted.mainKind === 'untradeable' && counted.main === 'Your biggest repeat: dying where no teammate was close enough to trade, in 3 rounds, rounds 1, 3 and 6.',
    `the biggest repeat over every mistake of every death (${counted.main})`);
  const beside = [1, 2, 3].map((n) => death(n, { side: 'attacking', riotSpot: null, killerAgent: null, aliveAtDeath: { mates: 4, enemies: 3 } }));
  ok(insights.chainCounts(dc.chainsOf(beside)).main === 'Your biggest repeat: dying where no teammate was close enough to trade, in 3 rounds, rounds 1, 2 and 3, and in 3 of those rounds also dying with your team up in numbers in a round it then lost.',
    'and the mistake most often beside it in those rounds');
  ok(insights.chainCounts([]).main === null, 'no chain, no repeat');
}

// ── 4. The review shows it, never on disk, and the grade does not move ──────
console.log('\nthe review:');
{
  const built = review.build({ rounds: bindAtk(), context: { map: 'Bind', agent: 'Iso', gameMode: 'standard' }, endedBy: 'stop' });
  const before = JSON.stringify(built);
  const shown = review.served(JSON.parse(before));
  const r6 = shown.rounds.find((c) => c.n === 6);
  ok(r6.chain && r6.chain.first.kind === 'no-escape' && r6.chain.mistakes === 3, 'a saved card is shown with its chain');
  ok(shown.context && shown.context.memory.some((m) => m.key === 'place') && /^Your biggest repeat: /.test(shown.context.chains.main), 'and the review with its memory and its biggest repeat');
  ok(JSON.stringify(review.withoutView(shown)) === before, 'withoutView takes both off again: nothing on disk changes');
  ok(JSON.stringify(shown.grade) === JSON.stringify(built.grade) && JSON.stringify(shown.insights.mistakes) === JSON.stringify(built.insights.mistakes),
    'the grade and the repeated mistakes are as built');
  const riotOnly = review.served({ ...JSON.parse(before), source: 'riot' });
  ok(riotOnly.rounds.every((c) => !c.chain) && !(riotOnly.context && riotOnly.context.chains), 'graded from Riot\'s record alone: facts, no chain');
}

// ── 5. The review request and the server ────────────────────────────────────
console.log('\nthe review request:');
{
  const rows = bindAtk();
  const body = review.requestBody({ rounds: rows, context: { map: 'Bind', agent: 'Iso', gameMode: 'standard' }, endedBy: 'stop' });
  ok(body.chains && body.chains.half === 12 && body.chains.rounds.find((c) => c.n === 6).first === 'no-escape' && body.chains.rounds.find((c) => c.n === 6).gap === 1.1,
    'the request carries each chain by its kinds, the half and the seconds of the spot with no way out');
  ok(!/[a-z]{3,} [a-z]{3,} [a-z]{3,}/.test(JSON.stringify(body.chains)), 'and no sentence');
  const input = matchReview.normalise(body);
  const c6 = input.chains.find((c) => c.n === 6);
  ok(c6 && c6.first.kind === 'no-escape' && c6.worse.map((w) => w.kind).join() === 'untradeable,gave-advantage', 'the server checks each kind against its own rounds');
  ok(input.memory.map((m) => m.text).join('|') === dc.memoryOf(rows, { half: 12 }).map((m) => m.text).join('|'), 'the server\'s memory is the client\'s, line for line');
  for (const n of [1, 3, 5, 6]) {
    const x = dc.rowsOf(rows).find((r) => r.n === n);
    ok(mm.earlierLines(mm.rowsOfReview(input.rounds), n).join('|') === dc.earlierOf(x, dc.rowsOf(rows)).join('|'), `and what came before round ${n} too`);
  }
  ok(input.chainMain === insights.chainCounts(dc.chainsOf(rows, { half: 12 })).main, `the biggest repeat in the server's words is the client's (${input.chainMain})`);
  // Forged kinds go.
  const forged = matchReview.normalise({ ...body, chains: { half: 12, rounds: [{ n: 6, first: 'early-attack', worse: ['first-death', 'same-killer'], fair: false }, { n: 2, first: 'untradeable', worse: [] }],
    main: { kind: 'untradeable', rounds: [1, 2, 3] } } });
  ok(!forged.chains.length && forged.chainMain === null, 'a kind the rounds do not bear out, a round with no death and a repeat over the wrong rounds are dropped');
  const prompt = matchReview.buildPrompt(input);
  ok(prompt.includes(matchReview.MEMORY_HEAD) && prompt.includes('You died at Hookah 3 times, rounds 1, 3 and 6.') && prompt.includes(input.chainMain),
    'the prompt carries the memory and the biggest repeat');
  ok(/R6 defence, lost\.[^\n]*the death as a chain of mistakes, read in code from Riot's record and the coach's look: first risky spot, no escape \(a kill at Hookah, then Chamber killed you 1\.1 seconds later\), made worse by nobody close to trade \(no teammate close, and nobody traded it\) and advantage given back \(your team was up 5 against 4 and lost the round\)/.test(prompt),
    'round 6\'s line carries its chain');
  ok(/R6 [^\n]*earlier in the match, you died at Hookah in rounds 1 and 3 too, Chamber killed you in round 5 too/.test(prompt), 'and what came before it');
  ok(!DASH.test(prompt.slice(prompt.indexOf(matchReview.MEMORY_HEAD))), 'no dash in what it adds');
  // A client before chains: no key, the prompt byte for byte.
  const old = { ...body };
  delete old.chains;
  const oldInput = matchReview.normalise(old);
  ok(!('chains' in oldInput) && !('memory' in oldInput) && !('chainMain' in oldInput), 'a client before chains is normalised with no new key');
  // Variant B, no notes: the notes the knowledge serves vary call to call.
  const stripped = matchReview.buildPrompt({ ...oldInput, variant: 'B' });
  const today = matchReview.buildPrompt({ ...input, variant: 'B', chains: undefined, memory: undefined, chainMain: undefined, chainHalf: undefined });
  ok(stripped === today && !stripped.includes(matchReview.MEMORY_HEAD) && !/chain of mistakes|earlier in the match/.test(stripped), 'and its prompt is today\'s without them, byte for byte');
}

// ── 6. The gate on what came earlier ────────────────────────────────────────
console.log('\nthe gate on earlier rounds:');
{
  const rows = bind();
  const input = matchReview.normalise(review.requestBody({ rounds: rows, context: { map: 'Bind', agent: 'Iso', gameMode: 'standard' }, endedBy: 'stop' }));
  const ctx = rc.contextOfReview(input);
  const at6 = (s) => rc.checkEarlier(s, ctx, { round: 6 });
  ok(at6('This was the third time you died at Hookah.') === null, 'the third death at Hookah in round 6 is the record\'s, kept');
  ok(typeof at6('This was the fourth time you died at Hookah.') === 'string', 'the fourth goes');
  ok(at6('You had died at Hookah twice before.') === null && typeof at6('You had died at Hookah three times before.') === 'string', 'twice before kept, three times before goes');
  ok(at6('You died at Hookah again.') === null && typeof rc.checkEarlier('You died at Hookah again.', ctx, { round: 1 }) === 'string', 'again in round 6 kept, again in round 1 goes');
  ok(at6('Chamber killed you again.') === null && typeof at6('Viper killed you again, from the same door.') === 'string',
    'Chamber again kept (round 5), Viper again goes (Viper never killed you)');
  ok(typeof at6('Chamber had killed you twice before.') === 'string' && at6('Chamber had killed you once before.') === null, 'by killer, the count before the round');
  ok(at6('If you die at Hookah again, play off the angle.') === null, 'a plan judges nothing');
  ok(rc.checkEarlier('This was the fourth time you died at Hookah.', ctx, {}) === null, 'nor a sentence with no round');
  ok(at6('the third time you died at A site.') === null, 'nor a whole site');
  const rows2 = rc.checkRows([{ s: 'This was the fourth time you died at Hookah.', p: 0 }], ctx, { round: 6 });
  ok(rows2.some((x) => x.kind === 'earlier' && x.reason), 'and it runs among the readers, as earlier');
}

// ── 7. Ask Coach sees earlier rounds ────────────────────────────────────────
console.log('\nAsk Coach:');
{
  const built = review.build({ rounds: bind(), context: { map: 'Bind', agent: 'Iso', gameMode: 'standard' }, endedBy: 'stop',
    tracker: { result: 'Victory', score: '13-10', agent: 'Iso', map: 'Bind', kills: 18, deaths: 21, assists: 8, acs: 265 } });
  built.id = 'valorant-1-test';
  const shown = review.served(built);
  const ctx = chatContext.build(shown, {}, null, 'what went wrong in round 6?', { game: 'valorant' });
  const card = ctx.match.cards.find((c) => c.n === 6);
  ok(card.chain && card.chain.first === 'no-escape' && card.chain.worse.join() === 'untradeable,gave-advantage' && !JSON.stringify(card.chain).includes(' '),
    'the card carries its chain by kinds alone');
  const msgs = [{ role: 'user', content: 'what went wrong in round 6?' }];
  const prompt = chatPrompt.buildPrompt(chatPrompt.normalise(ctx), msgs);
  ok(prompt.includes('Code read this death from Riot\'s record and the coach\'s look as a chain of mistakes: first risky spot, no escape'),
    'the round asked is told its chain');
  ok(prompt.includes('EARLIER IN THIS MATCH, before round 6') && prompt.includes('you died at Hookah in rounds 1 and 3 too; Chamber killed you in round 5 too'),
    'and what came before it in the match');
  ok(prompt.includes("- The match's own memory: You died at Hookah 3 times, rounds 1, 3 and 6."), 'the match part carries the memory lines');
  const dyn = chatPrompt.buildParts(chatPrompt.normalise(ctx), msgs).parts.slice(1).join('');
  ok(dyn.length <= chatPrompt.DYNAMIC_MAX_CHARS + 2000, `within the dynamic budget (${dyn.length})`);
  // A client before chains: the same prompt as before.
  const noChain = JSON.parse(JSON.stringify(ctx));
  for (const c of noChain.match.cards) delete c.chain;
  const p0 = chatPrompt.buildPrompt(chatPrompt.normalise(noChain), msgs);
  ok(!/EARLIER IN THIS MATCH|chain of mistakes|Earlier in this match:/.test(p0), 'a client before chains is told none of it');
}

// ── 8. One chain a round, each kind once, on the server (match-memory.js) ──
// Two chains sent for one round made "in 3 rounds, rounds 4, 4 and 7", and a
// kind sent twice was two things that made it worse.
console.log('\none chain a round:');
{
  const r = (n) => ({ n, side: 'attacking', result: 'lost', died: true, verified: true, traded: false, mate: 'far', alive: { mates: 4, enemies: 3 }, firstDeath: true, place: 'A Short' });
  const rows = mm.rowsOfReview([r(4), r(7)]);
  const c4 = mm.chainWords({ n: 4, first: 'untradeable', worse: ['gave-advantage', 'gave-advantage', 'first-death'] }, rows);
  ok(c4 && c4.worse.map((w) => w.kind).join() === 'gave-advantage,first-death', `a kind sent twice is said once (${c4 && c4.worse.map((w) => w.kind)})`);
  const c4b = mm.chainWords({ n: 4, first: 'untradeable', worse: ['gave-advantage'] }, rows);
  const c7 = mm.chainWords({ n: 7, first: 'untradeable', worse: ['gave-advantage'] }, rows);
  const chains = [c4, c4b, c7];
  const main = mm.mainWords({ kind: 'untradeable', rounds: [4, 4, 7] }, chains);
  ok(main === 'Your biggest repeat: dying where no teammate was close enough to trade, in 2 rounds, rounds 4 and 7.', `two chains for round 4 are one round (${main})`);
  ok(mm.mainWords({ kind: 'untradeable', rounds: [4, 7] }, chains) === main, 'and the rounds sent once say the same');
  ok(mm.mainWords({ kind: 'untradeable', rounds: [4, 7], beside: { kind: 'gave-advantage', count: 3 } }, chains) === main,
    'a beside count that counts round 4 twice is not said');
  ok(/, and in 2 of those rounds also dying with your team up in numbers in a round it then lost\.$/.test(mm.mainWords({ kind: 'untradeable', rounds: [4, 7], beside: { kind: 'gave-advantage', count: 2 } }, chains) || ''),
    'and the true one, a round once, is');
  ok(mm.mainWords({ kind: 'first-death', rounds: [4, 7] }, [c4b, c4, c7]) === null, 'the first chain sent for a round is the one counted, as its round line takes it');
}

console.log(`\n${fails ? fails + ' of ' + checks + ' failed' : 'all ' + checks + ' death chain checks passed'}`);
process.exit(fails ? 1 : 0);
