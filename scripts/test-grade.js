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
  ok(dec.score >= 90 && dec.evidence.join() === 'no avoidable death on record',
    `no deaths: Decisions scores the top of its curve rather than going unmeasured (${dec.score})`);
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

// ── Rivals and League ───────────────────────────────────────────────────────
const rv = {
  kind: 'rivals', empty: false,
  game: { hero: 'Luna Snow', role: 'Strategist' },
  scoreline: { kills: 9, deaths: 5, assists: 22, healing: 24000, damage: 6000 },
  against: [],
};
const gr = grade.rivals(rv, []);
ok(gr && gr.score !== null && gr.provisional, `a Rivals match grades, provisionally until there is a baseline (${gr && gr.score})`);
ok(gr.categories.find((c) => c.key === 'duty').evidence[0].includes('24,000 healing'), 'a Strategist is graded on healing');
const rvb = { ...rv, against: [{ id: 'healing', label: 'Healing', scope: 'role', value: 24000, baseline: 16000, delta: 8000, better: true, games: 4 }] };
ok(insights.rivals(rvb).strengths.some((s) => s.key === 'vs:healing'), 'healing half again above the role average is a strength');

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

// ── Rivals titles saved backwards before 8.0.3 are rebuilt once ─────────────
{
  const { repairRivalsTitles } = require('../src/main/services/review-repair');
  const dir2 = fs.mkdtempSync(path.join(os.tmpdir(), 'occlara-repair-'));
  try {
    const st = new ReviewStore(dir2);
    const review = { kind: 'rivals', empty: false, game: { hero: 'Luna Snow', role: 'Strategist' }, scoreline: {},
      grade: { score: 66, letter: 'C', provisional: false, categories: [] },
      against: [{ id: 'deaths', label: 'Deaths', value: 11, baseline: 8, delta: 3, better: false, games: 5, scope: 'role' }] };
    // As 8.0.2 saved it: more deaths than usual, titled "Deaths down".
    review.insights = { mistakes: [{ key: 'vs:deaths', title: 'Deaths down 38%', detail: 'x', rounds: [], count: 1, weight: 3.8 }],
      strengths: [], missed: [] };
    const id = newId('rivals', 1758000000000);
    st.save({ id, game: 'rivals', at: 1758000000000, review });
    ok(st.list('rivals')[0].topMistake === 'Deaths down 38%', 'an 8.0.2 Rivals review reads its deaths backwards');
    ok(repairRivalsTitles(st, insights) === 1, 'the repair rewrites it');
    ok(st.list('rivals')[0].topMistake === 'Deaths up 38%' && st.get(id).review.insights.mistakes[0].title === 'Deaths up 38%',
      'and the library row and the review now say the deaths went up');
    ok(st.get(id).review.grade.score === 66 && st.get(id).at === 1758000000000, 'nothing else in it changes');
    ok(repairRivalsTitles(st, insights) === 0, 'and a second run finds nothing to rewrite');
  } finally {
    fs.rmSync(dir2, { recursive: true, force: true });
  }
}

// ── The weekly report's counts carry a title true of every match ────────────
{
  const now = 1758400000000;
  const week = (i, pct) => ({ id: `rivals-${now - i * 3600000}-wk${i}x`, at: now - i * 3600000, game: 'rivals',
    review: { kind: 'rivals', game: { hero: 'Luna Snow', role: 'Strategist' },
      grade: { score: 70, letter: 'B', provisional: false, categories: [] },
      insights: { mistakes: [], missed: [], strengths: [
        { key: 'vs:healing', title: `Healing up ${pct}%`, detail: 'x', rounds: [], count: 1 },
      ] } } });
  const w = assembleReport({ riotId: '', stats: null, reviews: [week(1, 32), week(2, 16), week(3, 25)], patterns: null, now });
  ok(w.doingWell.includes('Healing above your average, in 3 matches') && !w.doingWell.some((x) => /\d+%/.test(x)),
    `a week's repeat carries no one match's percentage (${w.doingWell.join(' | ')})`);
  const one = assembleReport({ riotId: '', stats: null, reviews: [week(1, 32)], patterns: null, now });
  ok(one.doingWell.includes('Healing up 32%'), 'while one match keeps its own title');
}

// ── A Rivals comparison's up and down are the number's ──────────────────────
{
  const ins = insights.rivals({ empty: false, game: { hero: 'Hela', role: 'Duelist' }, scoreline: {}, against: [
    { id: 'deaths', label: 'Deaths', value: 4, baseline: 8, delta: -4, better: true, games: 5, scope: 'role' },
    { id: 'kills', label: 'Kills', value: 10, baseline: 20, delta: -10, better: false, games: 5, scope: 'role' },
  ] });
  ok(ins.strengths.some((s) => s.title === 'Deaths down 50%') && ins.mistakes.some((m) => m.title === 'Kills down 50%'),
    `fewer deaths than usual reads "Deaths down", never "Deaths up" (${ins.strengths.map((s) => s.title).join(', ')})`);
  const rv = (i) => ({ id: `rivals-${1758000000000 + i}-riv${i}x`, at: 1758000000000 + i, game: 'rivals',
    review: { kind: 'rivals', insights: ins } });
  const p = patterns.summarise([rv(2), rv(1)]);
  ok(p.strengths.some((s) => s.title === 'Deaths below your average') && p.mistakes.some((m) => m.title === 'Kills below your average'),
    'and a pattern of them carries the direction, never one match\'s percentage');
}

console.log(`\n${fails ? fails + ' of ' + checks + ' failed' : 'all ' + checks + ' grade and library checks passed'}`);
process.exit(fails ? 1 : 0);
