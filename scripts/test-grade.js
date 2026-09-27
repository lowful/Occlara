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
const noFeed = rounds.map((r) => ({ ...r, traded: null, trades: null, aliveAtDeath: null, clutch: null }));
const gn = grade.valorant({ rounds: noFeed, scoreline, role: 'Duelist', history: [] });
ok(gn.provisional && gn.categories.find((c) => c.key === 'decisions').score === null,
  'a record fetched before the kill feed was parsed leaves Decisions unmeasured and says so');
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
    if (f.round !== r.n) { ok(false, `a frame from round ${f.round} was picked for round ${r.n}`); }
  }
}
ok(found >= 17, `the frame before the death is found for most deaths, at a frame every ten seconds (${found} of 21)`);
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

console.log(`\n${fails ? fails + ' of ' + checks + ' failed' : 'all ' + checks + ' grade and library checks passed'}`);
process.exit(fails ? 1 : 0);
