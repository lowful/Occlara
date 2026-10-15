'use strict';

/**
 * The grade, the three insight lists, the death frame picker, the match library
 * and the patterns across it, on the real fixtures wherever there is one.
 *
 *   the Abyss 13 to 11, Jett, 31/21/4, match MVP: Riot's record of it is in
 *   scripts/fixtures, and a grade that called this match a D would be the same
 *   mistake grade-blend.js was written about, a scoreboard outvoted by a count
 *   of deaths
 *
 * Run: npm run test:grade
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { replay, load } = require('./fixtures/replay-match');
const verify = require('../src/shared/valorant-verify');
const grade = require('../src/shared/grade');
const insights = require('../src/shared/insights');
const deathFrames = require('../src/shared/death-frames');
const patterns = require('../src/shared/patterns');
const review = require('../src/shared/valorant-review');
const { ReviewStore, newId } = require('../src/main/services/review-store');
const { assembleReport } = require('../src/main/services/weekly-report');
const causes = require('../src/shared/death-causes');
const serverCauses = require('../server/services/death-forensics').CAUSES;

let fails = 0;
let checks = 0;
const ok = (cond, what) => {
  checks++;
  if (!cond) { fails++; console.log(`FAIL  ${what}`); } else console.log(`ok    ${what}`);
};

const abyss = replay(load('valorant-match-abyss-13-11.json').frames, 'standard');
const riot = load('riot-abyss-13-11.json');
const { rounds } = verify.reconcile(abyss.rounds, riot);
const scoreline = { kills: 31, deaths: 21, assists: 4, acs: 382 };

// ── The two copies of the cause list agree ──────────────────────────────────
ok(Object.keys(causes.CAUSES).sort().join() === Object.keys(serverCauses).sort().join(),
  'the client and server cause lists carry the same labels');
ok(!causes.isAvoidable('lost-duel') && !causes.isAvoidable('unclear') && causes.isAvoidable('dry-peek'),
  'a lost duel and an unclear frame are never counted as mistakes');

// ── The grade on the real match ─────────────────────────────────────────────
const g = grade.valorant({ rounds, scoreline, role: 'Duelist', history: [] });
const cat = (k) => g.categories.find((c) => c.key === k);
ok(g.score >= 70 && g.score <= 85, `a 31 kill MVP win who died alone 20 times grades a B, not an A and not a D (${g.score} ${g.letter})`);
ok(cat('impact').score >= 90, `impact reads the 382 combat score (${cat('impact').score})`);
ok(cat('survival').score < 65, `and survival reads the 21 deaths in 24 rounds (${cat('survival').score})`);
ok(cat('survival').evidence.some((e) => /21 deaths in 24 rounds/.test(e)), 'every category says what it counted');
ok(!g.provisional && g.categories.every((c) => c.score !== null), "with Riot's kill feed every category is measured");
ok(/1 of 21 deaths traded by a teammate/.test(cat('teamplay').evidence[0]), `teamplay reads the real feed (${cat('teamplay').evidence[0]})`);
ok(/team ahead in numbers and lost the round 6 times/.test(cat('decisions').evidence.join(' ')),
  'decisions counts the six rounds the team was ahead when the player died and still lost');
const noFeed = rounds.map((r) => ({ ...r, feedKnown: null, traded: null, trades: null, aliveAtDeath: null, clutch: null }));
const gn = grade.valorant({ rounds: noFeed, scoreline, role: 'Duelist', history: [] });
ok(gn.provisional && gn.categories.find((c) => c.key === 'decisions').score === null,
  'a record fetched before the kill feed was parsed leaves Decisions unmeasured and says so');
ok(rounds.every((r) => r.feedKnown === true), "every round of the real record carries a kill feed read whole");

// ── A verified match with few deaths is graded on Riot's record ─────────────
// The failure: a 7 round swiftplay at 14/2/3 had its trades ignored under a
// note that the kill feed "was not available", and the same match with no
// deaths was provisional on a complete record, Decisions left unmeasured.
{
  const per = (deathRounds) => Array.from({ length: 7 }, (_, i) => {
    const n = i + 1;
    const died = deathRounds.includes(n);
    return {
      n, won: n <= 5, side: n <= 4 ? 'attacking' : 'defending', kills: 2, died, deathMs: died ? 20000 : null,
      killerAgent: died ? 'Sova' : null, weapon: died ? 'Vandal' : null, firstDeath: false, firstKill: n === 1,
      planted: false, plantMs: null, afterPlant: false, traded: died ? false : null, trades: n === 3 || n === 4 ? 1 : 0,
      aliveAtDeath: died ? { mates: 4, enemies: 4 } : null, clutch: null,
      feed: [{ ms: 9000, by: 'me', on: 'enemy' }, ...(died ? [{ ms: 20000, by: 'enemy', on: 'me' }] : [])],
    };
  });
  const two = verify.reconcile([], { perRound: per([2, 6]) }).rounds;
  const g2 = grade.valorant({ rounds: two, scoreline: { kills: 14, deaths: 2, assists: 3, acs: 300 }, role: 'Duelist', history: [] });
  const tp = g2.categories.find((c) => c.key === 'teamplay');
  ok(tp.evidence.includes('you traded a teammate twice'), `two deaths: the trades made are counted (${tp.evidence.join('; ')})`);
  ok(!g2.notes.some((n) => /not available/.test(n)), `and no note claims the feed was missing (${g2.notes.join(' | ')})`);
  const assistsOnly = grade.valorant({ rounds: two.map((r) => ({ ...r, feedKnown: null, trades: null, aliveAtDeath: null })),
    scoreline: { kills: 14, deaths: 2, assists: 3, acs: 300 }, role: 'Duelist', history: [] });
  ok(tp.score > assistsOnly.categories.find((c) => c.key === 'teamplay').score,
    'two trades lift Teamplay over the same assists without a feed');

  const none = verify.reconcile([], { perRound: per([]) }).rounds;
  const g0 = grade.valorant({ rounds: none, scoreline: { kills: 14, deaths: 0, assists: 3, acs: 300 }, role: 'Duelist', history: [] });
  const dec = g0.categories.find((c) => c.key === 'decisions');
  // Seven rounds are a short match (8.5.0): nothing flagged is judged over
  // twelve, the five rounds unplayed at the typical share, so 89, not 96.
  ok(dec.score === 89 && dec.evidence.join(' | ') === 'no avoidable death on record | judged as a short match, over 12 rounds',
    `no deaths: Decisions scores the top its short match rule allows rather than going unmeasured (${dec.score}: ${dec.evidence.join(' | ')})`);
  // Graded from Riot's record alone, the same count is not a judgement on
  // every death: it counted the deaths with the team ahead in a lost round.
  const g0r = grade.valorant({ rounds: none, scoreline: { kills: 14, deaths: 0, assists: 3, acs: 300 }, role: 'Duelist',
    history: [], riotOnly: true });
  const decR = g0r.categories.find((c) => c.key === 'decisions');
  ok(decR.score === dec.score && decR.evidence.join(' | ') === 'no death with your team ahead in a lost round | judged as a short match, over 12 rounds',
    `and from Riot's record alone it says what it counted, at the same score (${decR.evidence.join(' | ')})`);
  ok(!g0.provisional && g0.categories.every((c) => c.score !== null) && g0.score !== null,
    `and a complete Riot record is not provisional (${g0.score} ${g0.letter})`);

  const unplaced = per([2, 6]).map((r) => ({ ...r, traded: null, trades: 0, aliveAtDeath: null,
    feed: [{ ms: 9000, by: null, on: 'enemy' }] }));
  const gu = grade.valorant({ rounds: verify.reconcile([], { perRound: unplaced }).rounds,
    scoreline: { kills: 14, deaths: 2, assists: 3, acs: 300 }, role: 'Duelist', history: [] });
  ok(gu.notes.some((n) => /not available/.test(n)) && gu.provisional,
    'a feed with a kill nobody can place still says so, and stays provisional');
  ok(verify.reconcile([], { perRound: unplaced }).rounds.every((r) => r.feedKnown === false && r.trades === null),
    "and those rounds keep no trade count, since the server's 0 there is not a count");

  // One category is still not a grade, few deaths or not.
  const thin = grade.valorant({ rounds: none, scoreline: null, role: 'Duelist', history: [] });
  ok(thin.score !== null && thin.categories.filter((c) => c.score !== null).length >= 2,
    'with no scoreboard at all, Riot\'s rounds still give two categories, so it grades');
  const tiny = grade.valorant({ rounds: none.slice(0, 2), scoreline: null, role: 'Duelist', history: [] });
  ok(tiny.score === null, `two rounds carry too little weight for an overall (${tiny.score})`);
}
ok(grade.valorant({ rounds, scoreline, role: 'Controller', history: [] }).score < g.score,
  'the same deaths cost a Controller more than a Duelist, whose job is the first fight');
ok(g.letter === grade.letter(g.score), 'the letter follows the number');
ok(grade.letter(90) === 'S' && grade.letter(80) === 'A' && grade.letter(70) === 'B' && grade.letter(60) === 'C' && grade.letter(59) === 'D',
  'the letter bands are S 90, A 80, B 70, C 60');

// Screen only: one category is not a grade.
const screen = grade.valorant({ rounds: abyss.rounds, scoreline: null, role: 'Duelist', history: [], totalRounds: 24 });
ok(screen.score === null && screen.letter === null, 'from the screen alone, deaths are all there is, and that is not graded');
ok(screen.notes.some((n) => /Riot ID/.test(n)), 'and the note says what would grade it');

// With the kill feed: teamwork and decisions speak.
const fed = rounds.map((r) => ({ ...r }));
// Two lost rounds where the player died with the team five against three.
const thrownRounds = fed.filter((r) => r.died && r.result === 'lost').slice(0, 2).map((r) => r.n);
for (const r of fed) {
  if (!r.died) continue;
  r.traded = r.n % 3 === 0;
  r.aliveAtDeath = { mates: 5, enemies: thrownRounds.includes(r.n) ? 3 : 5 };
}
fed.find((r) => r.n === 2).forensics = { cause: 'dry-peek', what: 'You swung mid alone.', better: 'Wait for the flash.' };
fed.find((r) => r.n === 10).forensics = { cause: 'dry-peek', what: 'You swung again.', better: 'Wait.' };
fed.find((r) => r.n === 23).forensics = { cause: 'lost-duel', what: 'A fair fight.', better: null };
const gf = grade.valorant({ rounds: fed, scoreline, role: 'Duelist', history: [] });
ok(gf.categories.every((c) => c.score !== null) && !gf.provisional, 'with the feed every category is measured');
ok(/traded by a teammate/.test(gf.categories.find((c) => c.key === 'teamplay').evidence[0]),
  'teamplay counts trades once the feed is there');
ok(/2 of the 3 deaths the coach looked at were avoidable/.test(gf.categories.find((c) => c.key === 'decisions').evidence.join(' ')),
  'decisions counts the coach\'s look, and a lost duel is not held against the player');

// Against the player's own role average.
const hist = [300, 320, 280].map((acs) => ({ role: 'Duelist', acs }));
const gh = grade.valorant({ rounds, scoreline: { ...scoreline, acs: 250 }, role: 'Duelist', history: hist });
ok(/your Duelist average is 300/.test(gh.categories.find((c) => c.key === 'impact').evidence[0]),
  'with three matches of history, impact compares the player with themselves');

// ── Insights on the real match ──────────────────────────────────────────────
const ins = insights.valorant(rounds, { role: 'Duelist' });
const keys = (l) => ins[l].map((e) => e.key);
ok(keys('strengths').includes('first-kill') && keys('strengths').includes('multi-kill'),
  `opening kills and multi kill rounds are strengths (${keys('strengths')})`);
ok(keys('mistakes').includes('same-killer') && ins.mistakes.find((e) => e.key === 'same-killer').agent === 'Skye',
  'Skye killing the player 7 times is a repeated mistake');
ok(!keys('mistakes').includes('first-death'), 'four first deaths in 24 rounds is inside a Duelist\'s job');
ok(ins.mistakes.every((e) => e.fix), 'every repeated mistake carries its fix');
const insFed = insights.valorant(fed, { role: 'Duelist' });
ok(insFed.mistakes.some((e) => e.key === 'cause:dry-peek' && e.count === 2 && e.judged),
  'two deaths the coach saw as dry peeks are a repeated mistake, marked as the coach\'s judgement');
ok(insFed.mistakes.some((e) => e.key === 'lost-advantage'), 'two rounds thrown five against three are a repeated mistake');
ok(!insFed.missed.some((e) => e.key === 'cause:dry-peek'), 'a repeated cause is not listed again as a single miss');
ok(insights.valorant(rounds.slice(0, 2)).mistakes.length === 0, 'two rounds are too few to call anything a pattern');

// ── Strengths a short match earned ──────────────────────────────────────────
// The player's 7 round Sunset swiftplay won its scoreboard, beat their own
// Duelist average, had a four kill round and opened two rounds, and came back
// with no strength at all: every floor was a count sized for 24 rounds. The
// match below is that shape with other numbers.
{
  const R = (n, o) => ({ n, side: n <= 4 ? 'attacking' : 'defending', result: 'lost', died: true, deathSpot: null,
    early: false, planted: false, verified: true, kills: 1, firstKill: false, firstDeath: false, traded: false, trades: 0,
    afterPlant: false, reads: [], ...o });
  const seven = [R(1), R(2, { kills: 2 }), R(3), R(4, { result: 'won', died: false, kills: 4, firstKill: true, trades: 1 }),
    R(5, { result: 'won', died: false }), R(6, { kills: 1, firstKill: true, trades: 1 }), R(7, { kills: 0 })];
  const scoreline = { kills: 9, deaths: 5, assists: 2, acs: 300 };
  const vs = [{ label: 'ACS', value: 300, baseline: 270, delta: 30, better: true, games: 5 }];
  const got = insights.valorant(seven, { role: 'Duelist', scoreline, against: vs });
  const s = (k) => got.strengths.find((e) => e.key === k);
  ok(s('first-kill') && s('first-kill').count === 2, `two opening kills in seven rounds open rounds (${got.strengths.map((e) => e.key)})`);
  ok(s('multi-kill') && s('multi-kill').detail === '4 kills in round 4.', `one four kill round is a multi kill round (${s('multi-kill') && s('multi-kill').detail})`);
  ok(s('trades') && s('trades').count === 2, 'and two trades in seven rounds traded your teammates');
  ok(s('scoreline') && s('scoreline').detail === '9 kills against 5 deaths, and 300 combat score a round against your '
    + 'Duelist average of 270, over 5 matches.' && s('scoreline').count === 1,
  `and the scoreboard is one (${s('scoreline') && s('scoreline').detail})`);
  const flat = insights.valorant(seven, { role: 'Duelist', scoreline: { kills: 7, deaths: 5, acs: 280 },
    against: [{ label: 'ACS', value: 280, baseline: 270, delta: 10, better: true, games: 5 }] });
  ok(!flat.strengths.some((e) => e.key === 'scoreline'), 'a K/D of 1.4, or a combat score a few points over the average, is not');
  const acsOnly = insights.valorant(seven, { role: 'Duelist', scoreline: { kills: 6, deaths: 5, acs: 300 }, against: vs });
  ok(acsOnly.strengths.some((e) => e.key === 'scoreline' && e.detail === '300 combat score a round against your Duelist '
    + 'average of 270, over 5 matches.'), 'a combat score a tenth over the average is, on its own');
  // Not cheaper for a long match: two opening kills in 24 rounds is under it.
  const long = Array.from({ length: 24 }, (_, i) => R(i + 1, { firstKill: i === 3 || i === 9 }));
  ok(!insights.valorant(long, { role: 'Duelist' }).strengths.some((e) => e.key === 'first-kill'),
    'and two opening kills in 24 rounds still are not');
  // The review hands its scoreboard and the player's own average to the lists.
  const shown = review.build({ rounds: seven, context: { map: 'Sunset', teamScore: 2, enemyScore: 5 }, endedBy: 'score', ai: {},
    tracker: { result: 'Defeat', score: '2-5', kills: 9, deaths: 5, assists: 2, acs: 300, adr: 180, kd: 1.8, headshotPct: 20 },
    role: 'Duelist', history: [250, 270, 290].map((acs) => ({ role: 'Duelist', acs })) });
  ok(shown.insights.strengths.some((e) => e.key === 'scoreline' && /against your Duelist average of 270, over 3 matches\.$/.test(e.detail)),
    `the built review says so (${shown.insights.strengths.map((e) => e.key)})`);
}

// The review carries both.
const built = review.build({ rounds, context: abyss.context, endedBy: 'score', ai: {}, tracker: null, role: 'Duelist',
  history: [], riotMe: { kills: 31, deaths: 21, assists: 4, score: 9168 } });
ok(built.grade && built.grade.score !== null && built.insights && built.insights.strengths.length,
  'the built review carries its grade and its insights');
ok(built.scoreline && built.scoreline.acs === 382, `Riot's own line stands in for the tracker (${built.scoreline && built.scoreline.acs} ACS)`);

// ── The death frame picker ──────────────────────────────────────────────────
const picks = deathFrames.teachableDeaths(rounds);
ok(picks.length === 4 && picks.every((r) => r.died && r.verified), `four teachable deaths (${picks.map((r) => r.n)})`);
ok(new Set(picks.map((r) => Math.min(2, Math.floor(((r.n - 1) / 24) * 3)))).size >= 2, 'spread across the match, not all from the first half');
let found = 0;
for (const r of rounds.filter((x) => x.died)) {
  const fr = deathFrames.framesFor(abyss.records, r, {});
  if (fr.length) found++;
  for (const f of fr) {
    // The one frame allowed from the next round is the one that registered
    // this round's death on its banner.
    const banner = f.round === r.n + 1 && f.died;
    if (f.round !== r.n && !banner) { ok(false, `a frame from round ${f.round} was picked for round ${r.n}`); }
  }
}
ok(found === 21, `the frame before the death is found for every death, at a frame every ten seconds (${found} of 21)`);
// THE BANNER CASE, on the real match: rounds 6 and 24 are post plant deaths
// the screen registered on the banner that already printed the next score.
// The ledger files them back; the log stamps that frame a round later.
for (const n of [6, 24]) {
  const r = rounds.find((x) => x.n === n);
  const fr = deathFrames.framesFor(abyss.records, r, {});
  ok(r.afterPlant && fr.length === 2 && fr[0].round === n && fr[1].round === n + 1 && fr[1].died,
    `round ${n}: its last frame and the banner frame that registered the death (${fr.map((f) => `R${f.round}`).join(', ')})`);
}
{
  const rec = (i, round, phase, died) => ({ at: i * 1000, frame: `f${i}.jpg`, round, died: !!died, state: { phase, clock: '0:30' } });
  const death = { n: 4, deathSec: null, afterPlant: true, verified: true, died: true, screenDied: true };
  const banner = [rec(1, 4, 'active'), rec(2, 4, 'active'), rec(3, 5, 'active', true), rec(4, 5, 'buy')];
  const picked = deathFrames.framesFor(banner, death, {});
  ok(picked.map((f) => f.frame).join() === 'f2.jpg,f3.jpg', `the banner case: round 4's last frame, then the banner (${picked.map((f) => f.frame)})`);
  ok(deathFrames.framesFor(banner, { ...death, screenDied: false }, {}).length === 0,
    "a death Riot has and the screen never registered borrows no other round's frame");
  // A death of the next round's own, after its buy phase, is never taken.
  const own = [rec(1, 4, 'active'), rec(2, 4, 'active'), rec(3, 5, 'buy'), rec(4, 5, 'active'), rec(5, 5, 'active', true)];
  ok(deathFrames.framesFor(own, death, {}).length === 0,
    'a death registered in the next round after its buy phase belongs to that round');
  const late = [rec(1, 4, 'active'), rec(2, 5, 'active'), rec(3, 5, 'active'), rec(4, 5, 'active'), rec(5, 5, 'active', true)];
  ok(deathFrames.framesFor(late, death, {}).length === 0,
    'nor is one registered past the first few frames of the next round');

  // AND THE BANNER FRAME IS THAT ROUND'S ALONE. It is also the first died frame
  // of the round it sits in, so round 5's own post plant death, which has no
  // clock to match, was handed round 4's banner as its death.
  const next = { n: 5, deathSec: null, afterPlant: true, verified: true, died: true, screenDied: true };
  const both = [rec(1, 4, 'active'), rec(2, 4, 'active'), rec(3, 5, 'dead', true), rec(4, 5, 'buy'),
    rec(5, 5, 'active'), rec(6, 5, 'postplant'), rec(7, 5, 'dead', true)];
  ok(deathFrames.framesFor(both, death, {}).map((f) => f.frame).join() === 'f2.jpg,f3.jpg',
    'with a death of its own in the next round, round 4 still takes its banner');
  const own5 = deathFrames.framesFor(both, next, {});
  ok(own5.map((f) => f.frame).join() === 'f6.jpg,f7.jpg',
    `and round 5 takes its own death, never round 4's banner (${own5.map((f) => f.frame)})`);
  const only = [rec(1, 4, 'active'), rec(2, 4, 'active'), rec(3, 5, 'dead', true), rec(4, 5, 'buy'), rec(5, 5, 'active')];
  ok(deathFrames.framesFor(only, next, {}).length === 0,
    "a round whose only died frame is the round before's banner has no look rather than the wrong one");
  // A death after the next round's play began is that round's: the ledger
  // files a death back only before the new round has been bought or played.
  const played = [rec(1, 4, 'active'), rec(2, 4, 'active'), { ...rec(3, 5, 'active'), state: { phase: 'active', clock: '1:20' } },
    rec(4, 5, 'dead', true)];
  ok(deathFrames.framesFor(played, death, {}).length === 0, 'a died frame after the next round began is not filed back');
  ok(deathFrames.framesFor(played, next, {}).map((f) => f.frame).join() === 'f3.jpg,f4.jpg', "it stays the next round's own");
  // Two banner deaths in a row: round 3's sits in round 4, round 4's in round 5.
  const chain = [rec(1, 3, 'active'), rec(2, 3, 'active'),
    rec(3, 4, 'dead', true), rec(4, 4, 'buy'), rec(5, 4, 'active'), rec(6, 4, 'postplant'),
    rec(7, 5, 'dead', true), rec(8, 5, 'buy'), rec(9, 5, 'active'), rec(10, 5, 'postplant'), rec(11, 5, 'dead', true)];
  const at = (n) => deathFrames.framesFor(chain, { ...death, n }, {}).map((f) => f.frame).join();
  ok(at(3) === 'f2.jpg,f3.jpg' && at(4) === 'f6.jpg,f7.jpg' && at(5) === 'f10.jpg,f11.jpg',
    `two banner deaths in a row are each their own round's (${at(3)} | ${at(4)} | ${at(5)})`);
}
// No died frame is handed to two rounds on the real match.
{
  const owners = new Map();
  for (const r of rounds.filter((x) => x.died)) {
    for (const f of deathFrames.framesFor(abyss.records, r, {})) {
      if (f.died) owners.set(f, (owners.get(f) || []).concat(r.n));
    }
  }
  const shared = [...owners.values()].filter((ns) => ns.length > 1);
  ok(!shared.length, `every died frame picked is one round's (${shared.map((ns) => ns.join('+')).join(', ') || 'none shared'})`);
}
const r2 = rounds.find((r) => r.n === 2);
const f2 = deathFrames.framesFor(abyss.records, r2, {});
ok(f2.length >= 1 && deathFrames.secondsIn(f2[0]) <= r2.deathSec && r2.deathSec - deathFrames.secondsIn(f2[0]) <= 10,
  `round 2: the frame is taken before Riot's death second and no more than ten seconds earlier (${deathFrames.secondsIn(f2[0])}s, died ${r2.deathSec}s)`);
ok(deathFrames.framesFor(abyss.records, { n: 99, deathSec: 10 }, {}).length === 0, 'a round the coach never saw has no frames');

// ── The library ─────────────────────────────────────────────────────────────
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'occlara-reviews-'));
try {
  const store = new ReviewStore(dir);
  const now = Date.now();
  const mk = (i, over) => {
    const r = { ...built, ...over, id: newId('valorant', now - i * 3600000), at: now - i * 3600000 };
    return r;
  };
  const a = mk(3, {});
  store.save({ id: a.id, game: 'valorant', at: a.at, review: a, frames: { 'r2-before.jpg': Buffer.from('jpegbytes').toString('base64'), '../evil.jpg': 'x' } });
  ok(store.list().length === 1 && store.list()[0].grade.letter === a.grade.letter, 'a saved review is listed with its grade');
  store.save({ id: a.id, game: 'valorant', at: a.at, review: { ...a, verified: true } });
  ok(store.list().length === 1 && store.list()[0].verified, 'saving the same match again replaces it, never duplicates it');
  ok(store.frame(a.id, 'r2-before.jpg') === Buffer.from('jpegbytes').toString('base64'), 'its frame is kept beside it');
  ok(!fs.existsSync(path.join(dir, 'evil.jpg')) && store.frame(a.id, '../evil.jpg') === null, 'a frame name cannot leave the folder');
  ok(store.get('../../etc') === null && store.get('valorant-1-x') === null, 'an id cannot either');
  const b = mk(2, {}); const c = mk(1, {});
  store.save({ id: b.id, game: 'valorant', at: b.at, review: b });
  store.save({ id: c.id, game: 'valorant', at: c.at, review: c });
  store.save({ id: newId('lol'), game: 'lol', at: now, review: { kind: 'lol', game: { champion: 'Ahri' } } });
  ok(store.list('valorant').length === 3 && store.list()[0].game === 'lol', 'listed newest first, and filtered by game');
  ok(store.recent('valorant', 2).map((e) => e.id).join() === [c.id, b.id].join(), 'recent returns whole reviews, newest first');

  // ── Patterns across them ────────────────────────────────────────────────
  const p = patterns.summarise(store.recent('valorant', 10));
  ok(p.enough && p.matches === 3, 'three matches are enough to call a pattern');
  const skye = p.mistakes.find((m) => m.key === 'same-killer');
  ok(skye && skye.matches === 3 && skye.share === 1, 'a mistake in all three matches is counted in all three');
  ok(p.strengths.some((s) => s.key === 'first-kill'), 'and so is a strength');
  ok(p.grades.length === 3 && p.average === built.grade.score, 'the grade trend and its average');
  ok(p.categories.some((x) => x.key === 'impact' && x.matches === 3), 'each category is averaged across the matches');
  ok(!patterns.summarise(store.recent('valorant', 1)).enough, 'one match is not a pattern');

  // ── The weekly report reads the library ──────────────────────────────────
  const w = assembleReport({ riotId: 'x#y', stats: null, reviews: store.recent('valorant', 10), patterns: p, now });
  ok(w.hasData && w.sessions === 3 && w.avgOverall === built.grade.score, 'the week counts its graded matches and averages them');
  ok(w.habits.length && w.habits[0].fix, 'its recurring mistakes come from the library, with their fix');
  ok(w.categories.length >= 2 && w.categories.every((x) => typeof x.avg === 'number'), 'and its categories are the grade\'s');
  ok(!assembleReport({ riotId: '', stats: null, reviews: [], patterns: null, now }).hasData, 'nothing played and nothing connected is no report');
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}

// ── League ──────────────────────────────────────────────────────────────────
// Two games are graded, Valorant above and League here. Marvel Rivals is no
// longer coached, and its grader and its lists went with it.
ok(!('rivals' in grade) && !('rivals' in insights), 'only Valorant and League have a grader and lists');

const lv = {
  kind: 'lol',
  game: { champion: 'Ahri', role: 'Mid', durationSec: 1800 },
  scoreline: { kills: 6, deaths: 3, assists: 7, cs: 210, ward: 21 },
  fights: { deaths: 3, joinedLost: 0, caughtAlone: 1 },
  objectives: { dragonsFor: 3, dragonsAgainst: 1, baronsFor: 1, baronsAgainst: 0, turretsFor: 7, turretsAgainst: 3 },
  scored: [],
};
const gl = grade.lol(lv);
ok(gl && gl.score !== null && gl.categories.length === 4, `a League game grades on four categories (${gl && gl.score})`);
const gs = grade.lol({ ...lv, game: { ...lv.game, role: 'Support' } });
ok(gs.categories.every((c) => c.key !== 'farming'), 'a support is not graded on farming');
const conceded = (o) => (insights.lol({ ...lv, objectives: o }).missed.find((e) => e.key === 'objectives-lost') || {}).detail;
ok(conceded({ dragonsAgainst: 2, baronsAgainst: 1 }) === 'The enemy took 2 dragons and 1 baron.',
  `objectives conceded count each kind in its own number (${conceded({ dragonsAgainst: 2, baronsAgainst: 1 })})`);
ok(conceded({ dragonsAgainst: 3, baronsAgainst: 0 }) === 'The enemy took 3 dragons.',
  `and a kind they took none of is left out (${conceded({ dragonsAgainst: 3, baronsAgainst: 0 })})`);
ok(conceded({ dragonsAgainst: 1, baronsAgainst: 2 }) === 'The enemy took 1 dragon and 2 barons.', 'one dragon is a dragon');

// ── A pattern's title is true of every match it counts ──────────────────────
{
  const mk = (i, place, agent) => ({
    id: `valorant-${1758000000000 + i}-pat${i}x`, at: 1758000000000 + i, game: 'valorant',
    review: { kind: 'valorant', insights: { strengths: [], missed: [], mistakes: [
      { key: 'same-spot', title: `Dying at ${place}`, place, count: 3, weight: 1.5, rounds: [],
        fix: `Change your position at ${place} each round, or play one step off where they expect you.` },
      { key: 'same-killer', title: `${agent} kept winning`, agent, count: 3, weight: 1, rounds: [],
        fix: `Track where their ${agent} plays, then fight them with a teammate or with utility, never alone.` },
    ] } },
  });
  const differ = patterns.summarise([mk(3, 'B Main', 'Jett'), mk(2, 'A Site', 'Skye'), mk(1, 'A Site', 'Skye')]);
  const spot = differ.mistakes.find((m) => m.key === 'same-spot');
  ok(spot && spot.matches === 3 && spot.title === 'Dying at the same spot' && !/Main|Site/.test(spot.fix),
    `a habit seen at different places is not named after the newest one (${spot && spot.title})`);
  const killer = differ.mistakes.find((m) => m.key === 'same-killer');
  ok(killer && killer.title === 'One enemy agent kept winning' && !/Jett|Skye/.test(killer.fix),
    `nor one seen against different agents (${killer && killer.title})`);
  const same = patterns.summarise([mk(3, 'A Site', 'Skye'), mk(2, 'A site', 'Skye'), mk(1, 'A Site', 'skye')]);
  ok(same.mistakes.find((m) => m.key === 'same-spot').title === 'Dying at A Site'
    && same.mistakes.find((m) => m.key === 'same-killer').title === 'Skye kept winning',
    'and named when every match names the same place or agent');
  // A Site on Bind and A Site on Haven are two places.
  const onMap = (i, map) => { const r = mk(i, 'A Site', 'Skye'); r.review.game = { map }; return r; };
  const maps = patterns.summarise([onMap(3, 'Bind'), onMap(2, 'Haven'), onMap(1, 'Bind')]);
  ok(maps.mistakes.find((m) => m.key === 'same-spot').title === 'Dying at the same spot',
    'the same place name on two maps is not named as one place');
}

// ── A pattern quotes its latest match in today's words ──────────────────────
// 8.2 changed the clutch line: "Round 4, one against 1." read as a one against
// one whatever the number. Matches quotes a pattern's latest sighting under it
// ("Latest match: ..."), and the library hands the patterns the reviews as
// they were saved, so one saved by 8.0.x or 8.1 still says it the old way.
{
  const mk = (i, detail) => ({
    id: `valorant-${1758000000000 + i}-clu${i}x`, at: 1758000000000 + i, game: 'valorant',
    review: { kind: 'valorant', insights: { mistakes: [], missed: [], strengths: [
      { key: 'clutch', title: 'Won as the last one standing', detail, rounds: [4], count: 1 },
    ] } },
  });
  const saved = [mk(2, 'Round 4, one against 1.'), mk(1, 'Round 9, one against 3. Round 12, one against 1.')];
  const clutch = patterns.summarise(saved).strengths.find((s) => s.key === 'clutch');
  const said = clutch ? clutch.examples.map((x) => x.detail) : [];
  ok(clutch && said[0] === 'Round 4, alone against one.' && said[1] === 'Round 9, alone against 3. Round 12, alone against one.',
    `a pattern saved in the 8.1 words quotes its latest match in today's (${said[0]})`);
  ok(insights.countable(saved[0].review).strengths[0].detail === 'Round 4, alone against one.'
    && saved[0].review.insights.strengths[0].detail === 'Round 4, one against 1.',
    'as does every count across matches, and the saved review is left as it was');
}

// ── The trades line, and one look's cause, in today's words (8.4.1) ─────────
// The player's Fracture swiftplay: "You killed the player who had just killed a
// teammate twice." read as the enemy killing a teammate twice, and the one
// look the coach counted as a miss read "Repeeks" beside its round's "Repeek".
{
  const R = (n, o) => ({ n, side: 'defending', result: 'won', died: false, verified: true, kills: 1, firstKill: false,
    firstDeath: false, traded: null, trades: 0, deathSpot: null, early: false, planted: false, afterPlant: false, reads: [], ...o });
  const six = [R(1, { trades: 1 }), R(2, { died: true, traded: true, kills: 3,
    forensics: { cause: 'repeek', what: 'You stayed on the same A Main angle.', better: 'Fall back after the first exchange.' } }),
  R(3, { trades: 1, kills: 2 }), R(4, { kills: 4 }), R(5, { result: 'lost', died: true, traded: false }),
  R(6, { died: true, traded: false, kills: 0, firstDeath: true })];
  const got = insights.valorant(six, { role: 'Duelist' });
  const trades = got.strengths.find((e) => e.key === 'trades');
  ok(trades && trades.detail === 'Twice you killed an enemy right after they killed a teammate.',
    `the trades line says its count first, so it is the player's (${trades && trades.detail})`);
  ok(insights.tradesDetail(1) === 'Once, you killed an enemy right after they killed a teammate.'
    && insights.tradesDetail(5) === '5 times you killed an enemy right after they killed a teammate.',
  'and its one and N forms');
  const miss = got.missed.find((e) => e.key === 'cause:repeek');
  ok(miss && miss.title === 'Repeek' && miss.count === 1, `one look's cause is named in the singular (${miss && miss.title})`);
  const again = insights.valorant(six.map((r) => (r.n === 5 ? { ...r, forensics: { cause: 'repeek', what: 'Again.', better: 'Change angle.' } } : r)),
    { role: 'Duelist' });
  ok(again.mistakes.some((e) => e.key === 'cause:repeek' && e.title === 'Repeeks' && e.count === 2)
    && !again.missed.some((e) => e.key === 'cause:repeek'), 'and two of it in the plural, a repeated mistake');
  // Saved in 8.4.0's words, shown in today's, the file left as it was.
  const old = { kind: 'valorant', source: 'watched', insights: {
    mistakes: [{ key: 'cause:dry-peek', title: 'Dry peeks', detail: 'x', rounds: [2, 9], count: 2, judged: true }],
    strengths: [{ key: 'trades', title: 'Traded your teammates', detail: 'You killed the player who had just killed a teammate twice.', rounds: [1, 3], count: 2 }],
    missed: [{ key: 'cause:repeek', title: 'Repeeks', detail: 'Round 2: You stayed on the same A Main angle.', fix: 'Fall back.', rounds: [2], count: 1, judged: true }],
  } };
  const before = JSON.stringify(old);
  const shown = review.served(old).insights;
  ok(shown.strengths[0].detail === 'Twice you killed an enemy right after they killed a teammate.' && shown.missed[0].title === 'Repeek'
    && shown.mistakes[0].title === 'Dry peeks' && JSON.stringify(old) === before,
  `a review saved in the old words is shown in today's, two of a cause still plural, the saved review unchanged (${shown.missed[0].title}; ${shown.strengths[0].detail})`);
  ok(insights.inTodaysWords({ strengths: [{ key: 'trades', detail: 'You killed the player who had just killed a teammate 3 times.' }] })
    .strengths[0].detail === '3 times you killed an enemy right after they killed a teammate.'
    && insights.asFacts(old.insights).facts.find((f) => f.key === 'trades').detail === 'Twice you killed an enemy right after they killed a teammate.',
  "every count of the old line, and as a fact of a review graded from Riot's record alone");
  ok(insights.TRADES_RE.test('You killed the player who had just killed a teammate once.')
    && !insights.TRADES_RE.test('Twice you killed an enemy right after they killed a teammate.')
    && !insights.TRADES_RE.test('You killed the player who had just killed a teammate.'),
  'the old line is matched by its own words and count, today\'s never');
  // Only a title the list wrote, either form of its cause's, is put in today's
  // words: one it never wrote under a cause's key is left as it was saved.
  const own = insights.inTodaysWords({ missed: [{ key: 'cause:repeek', title: 'Peeked the same angle twice', rounds: [2], count: 1 }],
    mistakes: [{ key: 'cause:repeek', title: 'Repeek', rounds: [2, 5], count: 2 }] });
  ok(own.missed[0].title === 'Peeked the same angle twice' && own.mistakes[0].title === 'Repeeks',
    `a title no list wrote stays, and the singular counted twice is the plural (${own.missed[0].title}; ${own.mistakes[0].title})`);
  // Across matches: the newest sighting's title is the singular, the count is
  // two at least, and the example quoted is today's line.
  const mk = (i) => ({ id: `valorant-${1758000000000 + i}-trd${i}x`, at: 1758000000000 + i, game: 'valorant', review: JSON.parse(before) });
  const p = patterns.summarise([mk(2), mk(1)]);
  const missP = p.missed.find((e) => e.key === 'cause:repeek');
  const tradeP = p.strengths.find((e) => e.key === 'trades');
  ok(missP && missP.matches === 2 && missP.title === 'Repeeks' && tradeP
    && tradeP.examples[0].detail === 'Twice you killed an enemy right after they killed a teammate.',
  `a cause seen once a match, counted across two, is "Repeeks", and the patterns quote today's trades line (${missP && missP.title})`);
}

// ── The lists count recorded matches, the grades every match ───────────────
// A match graded from Riot's record alone has a grade and nothing to count in
// a list: counted, its lists made Home's "most repeated mistake" mostly a
// quote from matches Occlara never saw. On the real match, built from Riot's
// record alone today, and as 8.0.3 saved one, with its three lists.
{
  const riotRows = verify.reconcile([], riot).rounds;
  const fresh = review.build({ rounds: riotRows, context: { agent: 'Jett', map: 'Abyss', teamScore: 13, enemyScore: 11 },
    endedBy: 'score', ai: {}, role: 'Duelist', history: [], riotMe: riot.me, riotIdSet: true, source: 'riot' });
  const old = { ...JSON.parse(JSON.stringify(fresh)), insights: insights.valorant(riotRows, { role: 'Duelist' }) };
  ok(old.insights.mistakes.some((m) => m.key === 'same-killer') && old.insights.strengths.some((s) => s.key === 'first-kill'),
    'the 8.0.3 shape still holds a repeated mistake and a strength to be counted');
  const base = 1758000000000;
  let n = 0;
  const entry = (rv, score) => {
    n++;
    const at = base - n * 3600000;
    return { id: `valorant-${at}-mix${String(n).padStart(3, '0')}`, at, game: 'valorant',
      review: { ...rv, grade: { ...rv.grade, score, letter: grade.letter(score) } } };
  };
  // Newest first: Riot only matches in among three recorded ones.
  const mixed = [entry(fresh, 90), entry(old, 88), entry(built, 70), entry(old, 86), entry(built, 72), entry(built, 74)];
  const p = patterns.summarise(mixed);
  const alone = patterns.summarise(mixed.filter((s) => s.review.source !== 'riot'));
  ok(p.matches === 6 && p.fromRiot === 3 && p.recorded === 3 && p.enough,
    `six matches, three of them from Riot's record, three recorded (${p.matches}, ${p.fromRiot}, ${p.recorded})`);
  ok(['mistakes', 'strengths', 'missed'].every((l) => JSON.stringify(p[l]) === JSON.stringify(alone[l])),
    'the lists are exactly the three recorded matches\' lists, as if the others were not there');
  const skye = p.mistakes.find((m) => m.key === 'same-killer');
  ok(skye && skye.matches === 3 && skye.share === 1 && skye.examples.every((x) => mixed.find((s) => s.id === x.id).review.source !== 'riot'),
    `Skye repeats in 3 of the 3 recorded matches, quoted from them alone (${skye && skye.matches} of ${p.recorded})`);
  ok(p.grades.length === 6 && p.average === Math.round((90 + 88 + 70 + 86 + 72 + 74) / 6),
    `while the grades are every match's (${p.grades.map((x) => x.score).join(', ')}, average ${p.average})`);
  ok(p.categories.length && p.categories.every((c) => c.matches === 6), 'and so are the categories');

  // Ten Riot only matches in front: the grades are theirs, and the lists the
  // recorded ones behind them, which a window of ten alone never reached.
  const deep = Array.from({ length: 10 }, () => entry(old, 80)).concat([entry(built, 70), entry(built, 71)]);
  const q = patterns.summarise(deep);
  ok(q.matches === 10 && q.fromRiot === 10 && q.grades.every((x) => x.score === 80),
    'with ten Riot only matches newest, the grades are those ten');
  ok(q.recorded === 2 && q.enough && q.mistakes.length && q.mistakes.every((m) => m.matches === 2 && m.share === 1),
    `and the lists the two recorded behind them (${q.recorded} recorded, ${q.mistakes.map((m) => m.key).join(', ')})`);
  ok(patterns.LOOK_BACK >= 40 && patterns.LOOK_BACK > patterns.WINDOW, `the library hands over ${patterns.LOOK_BACK} to find them`);

  // From Riot's record alone: grades and categories, and nothing to repeat.
  const r = patterns.summarise(mixed.filter((s) => s.review.source === 'riot'));
  ok(r.matches === 3 && r.recorded === 0 && !r.enough && !r.mistakes.length && !r.strengths.length && !r.missed.length
    && r.grades.length === 3 && r.categories.length, 'only Riot only matches: graded and averaged, and no pattern at all');

  // The weekly report counts what went well and what to fix over recorded matches only.
  const now = base + 3600000;
  const w = assembleReport({ riotId: 'x#y', stats: null, reviews: mixed, patterns: null, now });
  ok(w.sessions === 6 && w.doingWell.includes('Opened rounds, in 3 matches'),
    `the week counts six graded matches and a strength in the three recorded (${w.doingWell.join(' | ')})`);
  const wr = assembleReport({ riotId: 'x#y', stats: null, reviews: mixed.filter((s) => s.review.source === 'riot'), patterns: null, now });
  ok(wr.hasData && wr.sessions === 3 && !wr.doingWell.length && !wr.toImprove.length && !wr.habits.length,
    'a week of Riot only matches has its grades, and nothing to praise or fix');
}

// ── The weekly report's counts carry a title true of every match ────────────
// "Dying at B Main" is one match's place: a week's count of it over three
// matches died at B Main once and at A Site twice says what all three share.
{
  const now = 1758400000000;
  const week = (i, place) => ({ id: `valorant-${now - i * 3600000}-wk${i}x`, at: now - i * 3600000, game: 'valorant',
    review: { kind: 'valorant', game: { map: 'Abyss', agent: 'Jett' },
      grade: { score: 70, letter: 'B', provisional: false, categories: [] },
      insights: { strengths: [], missed: [], mistakes: [
        { key: 'same-spot', title: `Dying at ${place}`, place, detail: 'x', rounds: [], count: 3, weight: 1.5,
          fix: `Change your position at ${place} each round, or play one step off where they expect you.` },
      ] } } });
  const w = assembleReport({ riotId: '', stats: null, reviews: [week(1, 'B Main'), week(2, 'A Site'), week(3, 'A Site')], patterns: null, now });
  ok(w.toImprove.some((x) => x.startsWith('Dying at the same spot.')) && !w.toImprove.some((x) => /Main|Site/.test(x)),
    `a week's repeat carries no one match's place (${w.toImprove.join(' | ')})`);
  const one = assembleReport({ riotId: '', stats: null, reviews: [week(1, 'B Main')], patterns: null, now });
  ok(one.toImprove.some((x) => x.startsWith('Dying at B Main.')), `while one match keeps its own title (${one.toImprove.join(' | ')})`);
}

// ── A short match is judged over twelve rounds (8.5.0) ──────────────────────
// The player's Fracture swiftplay (5 to 1, Jett) and Pearl swiftplay (1 to 5,
// Raze), six rounds each, as the grade reads them: every fact the four
// categories count, round by round, and the scoreboard with the player's
// Duelist average, none of the players or the match. The grade they were
// saved with is today's rule; the short match rule is the player's choice,
// and the numbers are the ones put to them.
{
  const R = (n, o) => ({ n, verified: true, feedKnown: true, died: false, firstDeath: false, firstKill: false, kills: 0, traded: null,
    trades: 0, aliveAtDeath: null, clutch: null, result: 'won', ...o });
  const look = (cause) => ({ cause, what: 'You held the angle.', better: 'Take the next fight from somewhere else.', source: 'riot' });
  const fracture = (r5, r6) => [
    R(1, { side: 'defending', kills: 1, trades: 1 }),
    R(2, { side: 'defending', died: true, firstKill: true, kills: 3, traded: true, aliveAtDeath: { mates: 5, enemies: 1 }, forensics: look('repeek') }),
    R(3, { side: 'defending', kills: 2, trades: 1 }),
    R(4, { side: 'defending', firstKill: true, kills: 4 }),
    R(5, { side: 'attacking', result: 'lost', died: true, firstKill: true, kills: 2, traded: false, aliveAtDeath: { mates: 4, enemies: 3 }, forensics: look(r5) }),
    R(6, { side: 'attacking', died: true, firstDeath: true, kills: 0, traded: false, aliveAtDeath: { mates: 5, enemies: 5 }, forensics: look(r6) }),
  ];
  const pearl = (r1, r5) => [
    R(1, { side: 'attacking', result: 'lost', died: true, traded: false, aliveAtDeath: { mates: 2, enemies: 2 }, forensics: look(r1) }),
    R(2, { side: 'attacking', firstKill: true, kills: 3, clutch: { vs: 2, won: true } }),
    R(3, { side: 'attacking', result: 'lost', died: true, traded: true, aliveAtDeath: { mates: 4, enemies: 5 } }),
    R(4, { side: 'attacking', result: 'lost', died: true, traded: false, aliveAtDeath: { mates: 4, enemies: 5 }, forensics: look('unclear') }),
    R(5, { side: 'defending', result: 'lost', died: true, firstDeath: true, traded: true, aliveAtDeath: { mates: 5, enemies: 5 }, forensics: look(r5) }),
    R(6, { side: 'defending', result: 'lost', died: true, kills: 1, traded: false, aliveAtDeath: { mates: 3, enemies: 4 }, forensics: look('unclear') }),
  ];
  const fracGrade = (r5, r6) => grade.valorant({ rounds: fracture(r5, r6), scoreline: { kills: 12, deaths: 3, assists: 2, acs: 569 },
    role: 'Duelist', history: [380, 386, 392].map((acs) => ({ role: 'Duelist', acs })) });
  const pearlGrade = (r1, r5) => grade.valorant({ rounds: pearl(r1, r5), scoreline: { kills: 4, deaths: 5, assists: 2, acs: 241 },
    role: 'Duelist', history: [380, 385, 390].map((acs) => ({ role: 'Duelist', acs })) });
  const sc = (g, k) => g.categories.find((c) => c.key === k).score;
  // Today's rule, flags over rounds, on the same categories: what each was saved with.
  const today = (g, flags) => {
    const cats = g.categories.map((c) => (c.key === 'decisions'
      ? { ...c, score: grade.curve(flags / 6, grade.DECISIONS_CURVE) + (c.evidence.some((e) => /won 1 clutch/.test(e)) ? 4 : 0) } : c));
    const score = grade.combine(cats);
    return `${Math.round(Math.min(100, cats.find((c) => c.key === 'decisions').score))}, ${score} ${grade.letter(score)}`;
  };
  const shown = (g) => `${sc(g, 'decisions')}, ${g.score} ${g.letter}`;
  const frac = fracGrade('lost-duel', 'lost-duel');
  const fracRe = fracGrade('repeek', 'repeek');
  const pea = pearlGrade('lost-duel', 'lost-duel');
  const peaAv = pearlGrade('dry-peek', 'dry-peek');
  ok(sc(frac, 'survival') === 97 && sc(frac, 'impact') === 100 && sc(frac, 'teamplay') === 87
    && sc(pea, 'survival') === 66 && sc(pea, 'impact') === 46 && sc(pea, 'teamplay') === 89,
  'the two matches read as they were saved: Survival, Impact and Teamplay 97, 100, 87 and 66, 46, 89');
  ok(today(frac, 2) === '50, 84 A' && today(pea, 0) === '100, 73 B' && today(fracRe, 3) === '42, 82 A' && today(peaAv, 2) === '54, 62 C',
    `under the rule before, flags over rounds, they are what they were saved with, 84 A and 73 B, and their relabelled copies 82 A and 62 C (${[today(frac, 2), today(fracRe, 3), today(pea, 0), today(peaAv, 2)].join('; ')})`);
  ok(shown(frac) === '63, 87 A' && shown(fracRe) === '53, 85 A' && shown(pea) === '92, 71 B' && shown(peaAv) === '67, 65 C',
    `judged over twelve rounds they are the numbers put to the player: Fracture 63, 87 A, with rounds 5 and 6 Repeeks 53, 85 A; Pearl 92, 71 B, with rounds 1 and 5 avoidable 67, 65 C (${[shown(frac), shown(fracRe), shown(pea), shown(peaAv)].join('; ')})`);
  // One label, the first: Pearl with round 1 avoidable and round 5 a lost duel.
  const peaOne = pearlGrade('dry-peek', 'lost-duel');
  const swingToday = 100 - Math.round(grade.curve(1 / 6, grade.DECISIONS_CURVE) + 4);
  ok(swingToday === 25 && sc(pea, 'decisions') - sc(peaOne, 'decisions') === 13,
    `so one label in six rounds moves Decisions about half as far as it did: 25 points then, ${sc(pea, 'decisions') - sc(peaOne, 'decisions')} now`);
  const line = (g) => g.categories.find((c) => c.key === 'decisions').evidence;
  ok(line(frac).slice(-1)[0] === 'judged as a short match, over 12 rounds' && grade.SHORT_MATCH_LINE === 'judged as a short match, over 12 rounds'
    && line(frac).length === 3, `and its evidence says how it was judged (${line(frac).join(' | ')})`);
  ok(Math.round(grade.curve(grade.TYPICAL_SHARE, grade.DECISIONS_CURVE)) === 79 && grade.TYPICAL_SHARE === 0.12 && grade.SHORT_MATCH_ROUNDS === 12,
    'the typical share, 0.12, is the one the curve gives 79 for, the median of the player\'s twelve saved Decisions grades');
  ok(grade.decisionsShare(2, 6) === (2 + 0.12 * 6) / 12 && grade.decisionsShare(1, 11) === (1 + 0.12) / 12
    && grade.decisionsShare(3, 12) === 3 / 12 && grade.decisionsShare(6, 24) === 6 / 24,
  'a match under twelve rounds is filled up to twelve at it, and twelve or more is flags over rounds as it was');
  // Twelve rounds and more as they always were: the real Abyss 13 to 11.
  const abyssDec = g.categories.find((c) => c.key === 'decisions');
  const flagged = new Set(rounds.filter((r) => r.died && r.aliveAtDeath && r.aliveAtDeath.mates > r.aliveAtDeath.enemies && r.result === 'lost').map((r) => r.n));
  ok(abyssDec.score === Math.round(grade.curve(flagged.size / 24, grade.DECISIONS_CURVE)) && !abyssDec.evidence.includes(grade.SHORT_MATCH_LINE),
    `a 24 round match is judged on its own rounds, with no such line (${abyssDec.score}: ${abyssDec.evidence.join(' | ')})`);
  const twelve = grade.valorant({ rounds: Array.from({ length: 12 }, (_, i) => R(i + 1, { side: 'defending' })), scoreline: null, role: 'Duelist', history: [] });
  const eleven = grade.valorant({ rounds: Array.from({ length: 11 }, (_, i) => R(i + 1, { side: 'defending' })), scoreline: null, role: 'Duelist', history: [] });
  ok(!line(twelve).includes(grade.SHORT_MATCH_LINE) && line(eleven).includes(grade.SHORT_MATCH_LINE) && sc(twelve, 'decisions') === 96,
    'twelve rounds are no short match, eleven are');

  // A grade already saved is shown as it was saved: the review page, the
  // library and the patterns read it, nothing grades it again.
  const saved = { kind: 'valorant', source: 'watched', game: { map: 'Fracture', agent: 'Jett', mode: 'Swiftplay' },
    grade: { score: 84, letter: 'A', provisional: false, categories: [
      { key: 'survival', label: 'Survival', weight: 25, score: 97, evidence: ['3 deaths in 6 rounds'] },
      { key: 'impact', label: 'Impact', weight: 30, score: 100, evidence: ['569 combat score a round'] },
      { key: 'teamplay', label: 'Teamplay', weight: 20, score: 87, evidence: ['1 of 3 deaths traded by a teammate'] },
      { key: 'decisions', label: 'Decisions', weight: 25, score: 50, evidence: ['1 of the 3 deaths the coach looked at was avoidable'] }], notes: [] },
    rounds: [], insights: { mistakes: [], strengths: [], missed: [] } };
  const before = JSON.stringify(saved.grade);
  const served = review.served(saved);
  const lib = patterns.summarise([{ id: 'valorant-1791938248922-shrt01', at: 1791938248922, game: 'valorant', review: saved },
    { id: 'valorant-1791938248000-shrt02', at: 1791938248000, game: 'valorant', review: saved }]);
  ok(JSON.stringify(served.grade) === before && JSON.stringify(saved.grade) === before
    && lib.grades.every((x) => x.score === 84) && lib.categories.find((c) => c.key === 'decisions').last === 50,
  'a review saved with a grade is shown and counted with that grade, never judged again');
}

// ── Repeek, widened: one lesson counted as one (8.5.0) ──────────────────────
// The Fracture swiftplay's rounds 2, 5 and 6 had the same better play, to
// get out of sight after the first shots, under three labels. Looked at with
// variant b they can be one cause, and counted, with its fix, in the review,
// in what the narrative is told and across matches. The chip and the titles
// are as they were.
{
  const causes = require('../src/shared/death-causes');
  ok(causes.CAUSES.repeek.detail === 'fought again from the same angle after the first exchange'
    && causes.CAUSES.repeek.one === 'Repeek' && causes.CAUSES.repeek.title === 'Repeeks' && causes.isAvoidable('repeek'),
  "repeek's words are widened, its chip and titles kept");
  const R = (n, o) => ({ n, side: 'defending', result: 'won', died: false, verified: true, kills: 1, firstKill: false, firstDeath: false,
    traded: null, trades: 0, deathSpot: null, early: false, planted: false, afterPlant: false, reads: [], ...o });
  const lookAt = (n, what) => ({ cause: 'repeek', what, better: 'After the first exchange, get out of their sight.', fight: 'wrong-time', change: 'timing', variant: 'b' });
  const six = [R(1), R(2, { died: true, traded: true, forensics: lookAt(2, 'You stayed on the A Main angle after the first exchange.') }), R(3), R(4),
    R(5, { side: 'attacking', result: 'lost', died: true, traded: false, forensics: lookAt(5, 'You stayed on the A Site angle after your first shots.') }),
    R(6, { side: 'attacking', died: true, traded: false, forensics: lookAt(6, 'You took the next shot from the same open spot at B Tree.') })];
  const ins = insights.valorant(six, { role: 'Duelist' });
  const rep = ins.mistakes.find((e) => e.key === 'cause:repeek');
  ok(rep && rep.title === 'Repeeks' && rep.count === 3 && rep.rounds.join() === '2,5,6' && rep.judged
    && rep.detail === 'The coach looked at the moment before 3 deaths and saw the same thing: fought again from the same angle after the first exchange, rounds 2, 5 and 6.',
  `three looks at one lesson are one repeated mistake, "Repeeks, rounds 2, 5 and 6" (${rep && rep.detail})`);
  ok(rep && rep.fix === 'After the first exchange or a kill, get out of their sight and take the next fight from somewhere else.',
    `with the widened fix (${rep && rep.fix})`);
  const body = review.requestBody({ rounds: six, context: { agent: 'Jett', map: 'Fracture', teamScore: 5, enemyScore: 1 }, endedBy: 'score' });
  ok(body.mistakes[0] && body.mistakes[0].key === 'cause:repeek' && body.mistakes[0].rounds.join() === '2,5,6' && body.mistakes[0].title === 'Repeeks',
    `the narrative is told it, its first counted mistake, so the summary and the focus name it (${body.mistakes.map((m) => m.key).join(', ')})`);
  ok(!ins.missed.some((e) => e.key === 'cause:repeek'), 'and it is not listed again as a single miss');
  // An old repeek, "peeked it again", reads true under the same words.
  const old = insights.valorant(six.map((r) => (r.forensics ? { ...r, forensics: { cause: 'repeek', what: 'You peeked the same angle again after your kill.',
    better: 'Change angle.' } } : r)), { role: 'Duelist' });
  ok(old.mistakes.find((e) => e.key === 'cause:repeek').title === 'Repeeks', 'a repeek looked at by today\'s prompt counts the same, under the same key');
}

// ── A cause's trend is one prompt's (8.5.0) ─────────────────────────────────
// Variant b widened what a repeek is, so a repeek counted across the two
// prompts would read as rising for its definition's growth. Its newer and
// older halves are compared only across the matches the newest look's prompt
// looked at, and it shows no trend before four of them. Its counts are every
// match's.
{
  const at0 = 1792000000000;
  let k = 0;
  const match = (variant, repeek, extra) => {
    k++;
    const id = `valorant-${at0 - k * 3600000}-trv${String(k).padStart(3, '0')}`;
    const look = (n) => ({ cause: repeek ? 'repeek' : 'lost-duel', what: 'x.', better: 'y.', ...(variant ? { variant } : {}) });
    return { id, at: at0 - k * 3600000, game: 'valorant', review: { kind: 'valorant', source: 'watched', game: { map: 'Fracture' },
      rounds: [{ n: 2, forensics: look(2) }, { n: 5, forensics: look(5) }],
      insights: { strengths: [], missed: [], mistakes: [
        ...(repeek ? [{ key: 'cause:repeek', title: 'Repeeks', detail: 'x', rounds: [2, 5], count: 2, weight: 2, judged: true }] : []),
        ...(extra || []),
      ] } } };
  };
  const untraded = [{ key: 'untraded', title: 'Died where nobody could trade', detail: 'x', rounds: [1, 2, 3], count: 3, weight: 2 }];
  // Newest first: four looked at by b, every one a repeek; four by a before them, none.
  const lib = [match('b', true, untraded), match('b', true, untraded), match('b', true, untraded), match('b', true, untraded),
    match(null, false), match(null, false), match(null, false), match(null, false)];
  const p = patterns.summarise(lib);
  const rep = p.mistakes.find((m) => m.key === 'cause:repeek');
  const unt = p.mistakes.find((m) => m.key === 'untraded');
  ok(rep && rep.matches === 4 && rep.trend === 'steady' && unt.trend === 'rising',
    `four b matches all with repeeks read steady, where counted against the a matches before them they read rising, as a key of no prompt still does (repeek ${rep && rep.trend}, untraded ${unt && unt.trend})`);
  ok(patterns.lookVariant(lib[0].review) === 'b' && patterns.lookVariant(lib[4].review) === 'a'
    && patterns.lookVariant({ rounds: [{ n: 1, forensics: null }] }) === null
    && patterns.lookVariant({ rounds: [{ n: 1, forensics: { cause: 'repeek', variant: 'b' } }, { n: 2, forensics: { cause: 'isolated' } }] }) === null,
  'a look saved with no variant was asked with a; a match never looked at, or by both, is no prompt\'s');
  const three = patterns.summarise([match('b', true), match('b', true), match('b', true), match(null, true), match(null, true), match(null, true)]);
  const rep3 = three.mistakes.find((m) => m.key === 'cause:repeek');
  ok(rep3 && rep3.matches === 6 && rep3.total === 12 && rep3.trend === null,
    `three b matches are no trend yet, and its count is all six matches' (${rep3 && `${rep3.matches} matches, ${rep3.total} times, trend ${rep3.trend}`})`);
  const fewer = patterns.summarise([match('b', true), match('b', false), match('b', false), match('b', false), match('b', false), match('b', false)]);
  ok(fewer.mistakes.length === 0 || !fewer.mistakes.some((m) => m.key === 'cause:repeek'), 'one sighting is no pattern, whatever its prompt');
  const falling = patterns.summarise([match('b', false), match('b', false), match('b', true), match('b', true), match(null, true), match(null, true)]);
  ok(falling.mistakes.find((m) => m.key === 'cause:repeek').trend === 'falling', 'and within b it can fall, the newer two without it, the older two with');
  ok(patterns.TREND_MATCHES === 4, 'four matches before a trend, for any key');
}

console.log(`\n${fails ? fails + ' of ' + checks + ' failed' : 'all ' + checks + ' grade and library checks passed'}`);
process.exit(fails ? 1 : 0);
