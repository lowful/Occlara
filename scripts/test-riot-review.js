'use strict';

/**
 * Reviews built from Riot's record: a match the coach never watched, and a
 * watched one that never linked, checked after the fact. On the real Abyss
 * record and its real ledger.
 *
 * Run: npm run test:riotreview
 */

const { replay, load } = require('./fixtures/replay-match');
const verify = require('../src/shared/valorant-verify');
const grade = require('../src/shared/grade');
const valorantReview = require('../src/shared/valorant-review');
const riotReview = require('../src/shared/riot-review');

let fails = 0;
let checks = 0;
const ok = (cond, what) => {
  checks++;
  if (!cond) { fails++; console.log(`FAIL  ${what}`); } else console.log(`ok    ${what}`);
};

const riot = load('riot-abyss-13-11.json');
const played = replay(load('valorant-match-abyss-13-11.json').frames, 'standard');
const T0 = Date.parse('2026-09-20T18:00:00Z');
const HOUR = 3600000;
const ROW = { matchId: 'abyss-1', map: 'Abyss', agent: 'Jett', mode: 'Unrated', result: 'Victory', score: '13-11',
  kills: 31, deaths: 21, assists: 4, kd: 1.48, acs: 382, adr: 243, headshotPct: 25, startedAt: T0 };
const strip = (rv) => {
  const old = JSON.parse(JSON.stringify(rv));
  delete old.ledger;
  delete old.source;
  for (const c of old.rounds) {
    delete c.sideKey; delete c.spot; delete c.ultReady; delete c.riot; delete c.verified; delete c.watched;
  }
  return old;
};

// ── A match the coach never watched ─────────────────────────────────────────
{
  const { review: r, role, tracker } = riotReview.fromRiot({ row: ROW, riot, history: [], account: 'Me#EUW' });
  ok(role === 'Duelist', `Jett is graded as a Duelist (${role})`);
  ok(r.kind === 'valorant' && r.source === 'riot' && r.account === 'Me#EUW' && r.matchId === 'abyss-1',
    'a Riot only review, linked, with the account it came from');
  ok(r.game.agent === 'Jett' && r.game.map === 'Abyss' && r.game.mode === 'Unrated' && r.game.result === 'Victory'
    && r.game.score === '13-11', 'agent, map, queue, result and score are Riot\'s');
  ok(r.verified === true && r.watched === null && r.rounds.length === 24, 'every round is Riot\'s and none is claimed as watched');
  ok(r.rounds.every((c) => c.watched === false && c.spot === null && c.riot), 'no card has a location or claims the coach saw it');
  ok(r.rounds.filter((c) => c.died).length === 21, '21 deaths, as Riot has them');
  const direct = grade.valorant({ rounds: verify.reconcile([], riot).rounds, scoreline: r.scoreline, role: 'Duelist',
    history: [], totalRounds: 24, riotIdSet: true });
  ok(r.grade.score === direct.score && typeof r.grade.score === 'number',
    `graded exactly as grade.js grades Riot's rounds (${r.grade.score} ${r.grade.letter})`);
  ok(!r.grade.provisional, "with Riot's kill feed every category is measured");
  ok((r.grade.notes || []).some((n) => /Decisions counts what Riot records/.test(n)),
    'and the grade says what Decisions could not count without a recording');
  const noFeed = { ...riot, perRound: riot.perRound.map((p) => ({ ...p, feed: [], aliveAtDeath: null, traded: null, trades: null, clutch: null })) };
  const nf = riotReview.fromRiot({ row: ROW, riot: noFeed, history: [] }).review;
  const nfDecisions = nf.grade.categories.find((c) => c.key === 'decisions');
  ok(nfDecisions && nfDecisions.score === null && !(nf.grade.notes || []).some((n) => /Decisions counts/.test(n)),
    'with Decisions unmeasured, there is no note explaining a number the card does not show');
  ok((r.insights.mistakes || []).some((m) => m.key === 'untraded'), 'the untraded deaths are a repeated mistake');
  ok(r.at === T0 + 24 * riotReview.ROUND_MS && r.matchStartedAt === T0,
    'with no length from Riot, it ends 100 seconds a round after it started');
  ok(r.summary === null && r.aiUnavailable === false && r.narrativePending === false && r.thin === false,
    'no model was asked, and the window does not say one failed');
  ok(tracker.acs === 382 && tracker.matchId === 'abyss-1' && tracker.agent === 'Jett', 'the tracker row is the listed one');
  const timed = riotReview.fromRiot({ row: ROW, riot: { ...riot, startedAt: T0 + 5000, lengthMs: 1800000 }, history: [] }).review;
  ok(timed.at === T0 + 5000 + 1800000 && timed.matchStartedAt === T0 + 5000, "Riot's own start and length win when it has them");
}

// ── Measured against the matches before it, never after ─────────────────────
{
  const mk = (at, acs) => ({ at, agent: 'Jett', role: 'Duelist', map: 'Bind', result: 'Victory', acs, adr: 150, kd: 1, headshotPct: 20 });
  const before = [1, 2, 3].map((i) => mk(T0 - i * HOUR, 300));
  const after = [1, 2].map((i) => mk(T0 + i * HOUR, 100));
  const kept = riotReview.historyBefore([...after, ...before], T0);
  ok(kept.length === 3 && kept.every((h, i) => !i || kept[i - 1].at < h.at), 'historyBefore keeps the earlier rows, oldest first');
  const r = riotReview.fromRiot({ row: ROW, riot, history: [...after, ...before] }).review;
  const acs = (r.against || []).find((a) => a.label === 'ACS');
  ok(acs && acs.baseline === 300 && acs.games === 3, `against the three matches before it (${acs && acs.baseline})`);
}

// ── The ledger a review keeps, and the one rebuilt from an older review ─────
{
  const snap = { ...played, startedAt: T0 - 60000, endedAt: T0 + 24 * riotReview.ROUND_MS + 60000 };
  const built = valorantReview.build({ rounds: played.rounds, context: played.context, endedBy: 'score',
    ai: { summary: 'You held A long well.' }, role: 'Duelist', history: [] });
  built.ledger = valorantReview.ledgerOf(snap);
  const fresh = riotReview.ledgerRows(built);
  ok(!fresh.legacy && fresh.rows.length === played.rounds.length, 'a review saved since 8.0.3 gives its ledger back');
  const rebuilt = riotReview.ledgerRows(strip(built));
  ok(rebuilt.legacy && rebuilt.rows.length === built.rounds.length, 'an older one is rebuilt from its cards');
  const spots = (rows) => rows.filter((x) => x.died && x.deathSpot).map((x) => `${x.n}:${x.deathSpot}`).join(',');
  ok(spots(rebuilt.rows) === spots(fresh.rows), `with every death location its cards printed (${spots(rebuilt.rows)})`);
  const sides = (rows) => rows.map((x) => x.side || '-').join(',');
  ok(sides(rebuilt.rows) === sides(fresh.rows), 'and every side');
  // The plant line is read back by its own pattern, so it gets a real positive:
  // the real ledger planted in five rounds and named the site in each.
  const plants = (rows) => rows.filter((x) => x.planted && x.plantSpot).map((x) => `${x.n}:${x.plantSpot}`).join(',');
  ok(!!plants(fresh.rows) && plants(rebuilt.rows) === plants(fresh.rows),
    `and every plant site (${plants(rebuilt.rows)})`);
  ok(rebuilt.rows.every((x) => x.reads.every((y) => y.death === false)), 'its reads cannot say they were about a death');
}

// ── A watched match that never linked, checked now ──────────────────────────
{
  const snap = { ...played, startedAt: T0 - 60000, endedAt: T0 + 24 * riotReview.ROUND_MS + 60000 };
  const built = valorantReview.build({ rounds: played.rounds, context: played.context, endedBy: 'score',
    ai: { summary: 'You held A long well.', focus: 'Trade more.' }, role: 'Duelist', history: [] });
  built.ledger = valorantReview.ledgerOf(snap);
  built.id = 'valorant-1758391200000-abcdef';
  built.at = snap.endedAt;
  const screenDeaths = built.rounds.filter((c) => c.died).length;
  const { review: up } = riotReview.upgradeWatched({ saved: { id: built.id, at: built.at, review: built }, row: ROW, riot,
    history: [], account: 'Me#EUW' });
  ok(up.id === built.id && up.at === built.at, 'it keeps its id and its place in the library');
  ok(up.verified && up.matchId === 'abyss-1' && up.lateLinked === true && up.source === 'watched',
    "it is linked and checked against Riot's record, and is still a recorded match");
  ok(up.rounds.filter((c) => c.died).length === 21, `Riot's 21 deaths replace the screen's ${screenDeaths}`);
  ok(up.summary === null && up.focus === null, 'the read written from the old facts is taken down');
  ok(up.refused.some((l) => /taken down/.test(l)), 'and the review says so');
  ok(/Checked against Riot's record/.test(up.verification || ''), 'with the usual line saying what the check changed');
  ok(up.rounds.some((c) => c.spot), 'it keeps the screen\'s death locations where Riot confirms the death');
  ok(!up.ledger, 'and a verified review carries no ledger');

  // The same review saved before the ledger existed, with a read in a round
  // the screen invented a death in and one in a round both agree on.
  const old = strip(built);
  const riotDied = (n) => !!(riot.perRound.find((p) => p.n === n) || {}).died;
  const invented = old.rounds.find((c) => c.died && !riotDied(c.n));
  const agreed = old.rounds.find((c) => c.died && riotDied(c.n));
  ok(!!invented && !!agreed, `the real ledger has an invented death (round ${invented && invented.n}) and an agreed one`);
  invented.reads = ['You went down on the spike.'];
  agreed.reads = ['Holding the long angle.'];
  const { review: up2 } = riotReview.upgradeWatched({ saved: { id: old.id, at: old.at, review: old }, row: ROW, riot, history: [] });
  ok(up2.verified && up2.rounds.filter((c) => c.died).length === 21, 'an older review upgrades the same way');
  ok(up2.rounds.find((c) => c.n === invented.n).reads.length === 0,
    'in a round where Riot says the screen invented the death, its reads are dropped');
  ok(up2.rounds.find((c) => c.n === agreed.n).reads.includes('Holding the long angle.'),
    'where Riot agrees, they stay');
  // The line that says how many reads Riot contradicts counts every one hidden:
  // the ones reconcile() drops and the ones in a round the screen got wrong.
  const total = (rv) => rv.rounds.reduce((a, c) => a + c.reads.length, 0);
  const hidden = total(old) - total(up2);
  const said = /contradicts (one|\d+) of the coach's reads/.exec(up2.verification || '');
  const count = said ? (said[1] === 'one' ? 1 : Number(said[1])) : 0;
  ok(hidden > 1 && count === hidden, `and the verification line counts every read it hides (${count} said, ${hidden} hidden)`);
}

console.log(`\n${fails ? fails + ' of ' + checks + ' failed' : 'all ' + checks + ' riot review checks passed'}`);
process.exit(fails ? 1 : 0);
