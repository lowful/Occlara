'use strict';

/**
 * Reviews built from Riot's record: a match the coach never watched, and a
 * watched one that never linked, checked after the fact. On the real Abyss
 * record and its real ledger. And the one never watched states facts, never
 * a mistake, whether it was built today or saved by 8.0.3.
 *
 * Run: npm run test:riotreview
 */

const { replay, load } = require('./fixtures/replay-match');
const verify = require('../src/shared/valorant-verify');
const grade = require('../src/shared/grade');
const insights = require('../src/shared/insights');
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
  delete old.aiLog;
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
  ok(!r.insights.mistakes.length && r.insights.facts.some((f) => f.key === 'untraded' && f.count === 20),
    'the 20 untraded deaths are a fact, and never a repeated mistake');
  ok(r.at === T0 + 24 * riotReview.ROUND_MS && r.matchStartedAt === T0,
    'with no length from Riot, it ends 100 seconds a round after it started');
  ok(r.summary === null && r.aiUnavailable === false && r.narrativePending === false && r.thin === false,
    'no model was asked, and the window does not say one failed');
  ok(tracker.acs === 382 && tracker.matchId === 'abyss-1' && tracker.agent === 'Jett', 'the tracker row is the listed one');
  const timed = riotReview.fromRiot({ row: ROW, riot: { ...riot, startedAt: T0 + 5000, lengthMs: 1800000 }, history: [] }).review;
  ok(timed.at === T0 + 5000 + 1800000 && timed.matchStartedAt === T0 + 5000, "Riot's own start and length win when it has them");
}

// ── Graded from Riot's record alone, it states facts ───────────────────────
// Riot records what happened and never why. So its counts are one list of
// facts, each under a title that claims nothing more, with no fix, and a
// review saved by 8.0.3 or 8.1 with three lists, fix lines and verdicts for
// titles is shown the same way: valorant-review.js served(), which present()
// in src/main/index.js serves every review through.
{
  // The titles a fact may carry, from the spec, never from the module, and
  // the ones 8.0.3 gave the same counts, each a verdict Riot never recorded.
  const NEUTRAL = {
    'first-kill': 'Kills in the first fight', 'first-death': 'First to die in the round',
    'multi-kill': 'Rounds with three or more kills', 'trades': 'Kills that traded a teammate',
    'untraded': 'Deaths not traded within five seconds', 'early': 'Deaths in the first 30 seconds',
    'lost-advantage': 'Died with your team ahead, round lost', 'same-killer': 'Deaths to Skye',
    'clutch': 'Rounds won as the last one standing', 'one-v-one': 'Rounds lost one against one',
    'postplant': 'Attack rounds after the plant', 'postplant-lost': 'Attack rounds after the plant',
    'retake': 'Defence rounds after their plant', 'survived': 'Rounds survived',
  };
  const VERDICTS = ['Died where nobody could trade', 'Gave back the advantage', 'An advantage given back', 'Opened rounds',
    'First to die', 'Dying in the first 30 seconds', 'Skye kept winning', 'Multi kill rounds', 'Traded your teammates',
    'Won as the last one standing', 'One against one, lost', 'Closed out post plants', 'Post plants that slipped',
    'Won retakes', 'Stayed alive'];
  // The real record had no clutch, and the clutch line is the wording that
  // changed: rounds 1 and 17 (won, alive) are won alone against one and three,
  // and round 2 (lost, died) is a one against one lost.
  const rec = JSON.parse(JSON.stringify(riot));
  const at = (n) => rec.perRound.find((p) => p.n === n);
  at(1).clutch = { vs: 1, won: true };
  at(17).clutch = { vs: 3, won: true };
  at(2).clutch = { vs: 1, won: false };
  const fresh = riotReview.fromRiot({ row: ROW, riot: rec, history: [] }).review;
  // As 8.0.3 saved it: the three lists insights.js then wrote over the same
  // rounds, with the clutch line in its words then, and Decisions as it then
  // read on a match where nothing was counted against the player.
  const rows = verify.reconcile([], rec).rounds;
  const saved = JSON.parse(JSON.stringify(fresh));
  saved.insights = insights.valorant(rows, { role: 'Duelist' });
  const then = rows.filter((x) => x.clutch && x.clutch.won === true && x.clutch.vs >= 1)
    .map((x) => `Round ${x.n}, one against ${x.clutch.vs}`).join('. ') + '.';
  saved.insights.strengths.find((e) => e.key === 'clutch').detail = then;
  saved.grade.categories.find((c) => c.key === 'decisions').evidence = ['no avoidable death on record', 'won 2 clutches'];
  const lists = [...saved.insights.mistakes, ...saved.insights.strengths, ...saved.insights.missed];
  ok(then === 'Round 1, one against 1. Round 17, one against 3.' && lists.some((e) => e.fix)
    && lists.some((e) => VERDICTS.includes(e.title)), `the 8.0.3 shape: "${then}", fix lines, and verdicts for titles`);

  const f = fresh.insights;
  ok(f.mistakes.length === 0 && f.strengths.length === 0 && f.missed.length === 0 && f.facts.length >= 6,
    `a fresh one keeps no mistakes, strengths or misses, and ${f.facts.length} facts`);
  const keysOf = (xs) => xs.map((x) => x.key).join(',');
  ok(keysOf(f.facts) === 'first-kill,multi-kill,untraded,early,lost-advantage,same-killer,clutch,one-v-one,postplant',
    `in the order a round is read, the same every time (${keysOf(f.facts)})`);
  ok(f.facts.every((x) => x.title === NEUTRAL[x.key]), `each under its neutral title (${f.facts.map((x) => x.title).join(' | ')})`);
  ok(f.facts.every((x) => !('fix' in x) && !('weight' in x) && !('judged' in x) && !VERDICTS.includes(x.title)),
    'with no fix line, no weight and no verdict for a title');
  ok(keysOf(f.facts.slice().sort((a, b) => a.key.localeCompare(b.key)))
    === keysOf(lists.slice().sort((a, b) => a.key.localeCompare(b.key))),
    'one fact for every entry the three lists had, no more and no fewer');
  const clutch = f.facts.find((x) => x.key === 'clutch');
  ok(clutch && clutch.detail === 'Round 1, alone against one. Round 17, alone against 3.',
    `the clutch line says the player was alone, and against how many (${clutch && clutch.detail})`);

  const shown = valorantReview.served(saved);
  const byKey = (xs) => JSON.stringify(xs.slice().sort((a, b) => a.key.localeCompare(b.key)));
  ok(byKey(shown.insights.facts) === byKey(f.facts),
    'the 8.0.3 review is shown with the same facts by key: titles, details, rounds and counts');
  ok(shown.insights.mistakes.length === 0 && shown.insights.strengths.length === 0 && shown.insights.missed.length === 0
    && !/"fix"/.test(JSON.stringify(shown.insights)), 'and no list and no fix line left anywhere in it');
  // A word boundary first: "alone against 3" holds "one against 3".
  ok(!/\bone against \d/.test(JSON.stringify(shown.insights)) && /\bone against \d/.test(JSON.stringify(saved.insights)),
    'and its clutch line in today\'s words');
  ok(JSON.stringify(shown.grade.categories.find((c) => c.key === 'decisions').evidence)
    === '["no death with your team ahead in a lost round","won 2 clutches"]' && shown.grade.score === saved.grade.score,
    "its Decisions says what Riot's record counted, the score untouched");
  ok(JSON.stringify(saved.insights.strengths.find((e) => e.key === 'clutch').detail) === JSON.stringify(then)
    && saved.grade.categories.find((c) => c.key === 'decisions').evidence[0] === 'no avoidable death on record',
    'and the saved review itself is left as it was');
  ok(JSON.stringify(valorantReview.served(fresh)) === JSON.stringify(fresh),
    'a review built today comes through the same conversion unchanged');
  ok(JSON.stringify(insights.asFacts(f)) === JSON.stringify(f), 'facts made into facts again are the same facts');

  // The two patterns the conversion reads by, each on a known positive.
  ok(insights.CLUTCH_RE.test('Round 4, one against 1.') && !insights.CLUTCH_RE.test('Round 4, alone against one.')
    && !insights.CLUTCH_RE.test('Round 17, alone against 3.'), 'the old clutch line is found, and today\'s is not');
  ok(insights.ONLY_RE.test('Won only 1 of 4 attack rounds with the spike down.'), 'and so is a miss that says "Won only"');
  const slipped = insights.factsView({ key: 'postplant-lost', title: 'Post plants that slipped', rounds: [3, 9, 14],
    detail: 'Won only 1 of 4 attack rounds with the spike down.', fix: 'After the plant, hold angles on the spike from cover.' });
  ok(slipped && slipped.title === NEUTRAL['postplant-lost'] && slipped.detail === 'Won 1 of 4 attack rounds with the spike down.'
    && !('fix' in slipped), `"Won only 1 of 4" is the fact "Won 1 of 4" (${slipped && slipped.detail})`);
  ok(insights.factsView({ key: 'cause:dry-peek', title: 'Dry peek', detail: 'x', judged: true, rounds: [2] }) === null
    && insights.factsView({ key: 'same-spot', title: 'Dying at A Site', place: 'A Site', detail: 'x', rounds: [] }) === null
    && insights.factsView({ key: 'ult-held', title: 'Died holding your ultimate', detail: 'x', rounds: [] }) === null,
    "the coach's look, a death spot and the ultimate are no facts of Riot's record");

  // Never counted across matches, fresh or saved, while a recorded review is.
  const none = (c) => !c.mistakes.length && !c.strengths.length && !c.missed.length;
  const recorded = valorantReview.build({ rounds: verify.reconcile(played.rounds, rec).rounds, context: played.context,
    endedBy: 'score', ai: {}, role: 'Duelist', history: [], riotMe: rec.me });
  ok(none(insights.countable(fresh)) && none(insights.countable(saved)) && !none(insights.countable(recorded)),
    'neither a fresh nor a saved one gives a list to count across matches, and a recorded one does');
  // A recorded review keeps its three lists when shown, in today's words.
  const old = JSON.parse(JSON.stringify(recorded));
  old.insights.strengths.find((e) => e.key === 'clutch').detail = 'Round 1, one against 1. Round 17, one against 3.';
  const back = valorantReview.served(old);
  ok(!back.insights.facts && back.insights.mistakes.length === recorded.insights.mistakes.length
    && back.insights.mistakes.every((e, i) => e.title === recorded.insights.mistakes[i].title && e.fix === recorded.insights.mistakes[i].fix)
    && back.insights.strengths.find((e) => e.key === 'clutch').detail === 'Round 1, alone against one. Round 17, alone against 3.',
    'a recorded review keeps its lists and fix lines, with its clutch line in today\'s words');
  const league = { kind: 'lol', insights: { mistakes: [], strengths: [], missed: [] } };
  ok(valorantReview.served(league) === league && valorantReview.served(null) === null, 'and another game\'s review is not touched');
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
  // Where its frames are in the AI log, as a review saved since 8.2 keeps it.
  built.aiLog = { session: 'session-2026-09-20T17-58-00-000Z', match: snap.startedAt, from: snap.startedAt, to: snap.endedAt };
  const screenDeaths = built.rounds.filter((c) => c.died).length;
  const { review: up } = riotReview.upgradeWatched({ saved: { id: built.id, at: built.at, review: built }, row: ROW, riot,
    history: [], account: 'Me#EUW' });
  ok(up.id === built.id && up.at === built.at, 'it keeps its id and its place in the library');
  ok(JSON.stringify(up.aiLog) === JSON.stringify(built.aiLog), 'and its place in the AI log, so its eye still opens its frames');
  ok(up.verified && up.matchId === 'abyss-1' && up.lateLinked === true && up.source === 'watched',
    "it is linked and checked against Riot's record, and is still a recorded match");
  ok(up.rounds.filter((c) => c.died).length === 21, `Riot's 21 deaths replace the screen's ${screenDeaths}`);
  ok(up.summary === null && up.focus === null, 'the read written from the old facts is taken down');
  ok(up.refused.some((l) => /taken down/.test(l)), 'and the review says so');
  ok(/Checked against Riot's record/.test(up.verification || ''), 'with the usual line saying what the check changed');
  ok(up.rounds.some((c) => c.spot), 'it keeps the screen\'s death locations where Riot confirms the death');
  ok(!up.ledger, 'and a verified review carries no ledger');
  // THE ROUND IN ORDER AND BOTH COMPS (8.5.0), kept as a live link keeps them,
  // so Ask Coach needs no fill: Riot's comps when its record has them, else
  // what Ask Coach's fill had kept on the review being upgraded.
  const COMPS = { us: [{ agent: 'Jett', role: 'Duelist' }], them: [{ agent: 'Skye', role: 'Initiator' }] };
  const withComps = riotReview.upgradeWatched({ saved: { id: built.id, at: built.at, review: built }, row: ROW, riot: { ...riot, comps: COMPS },
    history: [] }).review;
  const keptFill = riotReview.upgradeWatched({ saved: { id: built.id, at: built.at, review: { ...built, comps: COMPS } }, row: ROW, riot,
    history: [] }).review;
  const fresh85 = riotReview.fromRiot({ row: ROW, riot: { ...riot, comps: COMPS }, history: [] }).review;
  const fedCards = (rv) => rv.rounds.filter((c) => c.riot && Array.isArray(c.riot.feed) && c.riot.feed.length).length;
  ok(JSON.stringify(withComps.comps) === JSON.stringify(COMPS) && JSON.stringify(keptFill.comps) === JSON.stringify(COMPS)
    && JSON.stringify(fresh85.comps) === JSON.stringify(COMPS) && fedCards(up) === 24 && fedCards(fresh85) === 24
    && up.rounds.find((c) => c.n === 3).riot.plantSec === 61.6,
  `an upgrade in place and a review from Riot's record alone keep each round's feed, the plant and both comps (${fedCards(up)} rounds with a feed)`);

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
  ok(!('aiLog' in up2), 'and one saved before reviews kept their place in the AI log is given none, so it is still looked up by its end');
  ok(up2.rounds.find((c) => c.n === invented.n).reads.length === 0,
    'in a round where Riot says the screen invented the death, its reads are dropped');
  ok(up2.rounds.find((c) => c.n === agreed.n).reads.includes('Holding the long angle.'),
    'where Riot agrees, they stay');
  // The notes Riot contradicts go, the ones reconcile() drops and the ones in a
  // round the screen got wrong, and the verification line says nothing of them
  // (8.3.1): the page shows no note, and calls the summary and each round's
  // why the coach's read, so "Riot contradicts 3 of the coach's reads, so they
  // are hidden" read as three of those taken down.
  const total = (rv) => rv.rounds.reduce((a, c) => a + c.reads.length, 0);
  const hidden = total(old) - total(up2);
  ok(hidden > 1 && /^Checked against Riot's record/.test(up2.verification || '') && !/coach's reads?|hidden/.test(up2.verification),
    `and the verification line says nothing of the ${hidden} notes it drops (${up2.verification})`);
}

// ── Its looks from the screen survive the check, where Riot agrees ─────────
// A recording Riot's record never reached is looked at from the screen (8.2,
// screenLook in index.js), and each look is kept on its round's card, never
// in the ledger. Checked against Riot's record later (Connect, "Grade my
// recent matches"), it is rebuilt from that ledger, so the looks are read
// back from its cards: rebuilt alone, every card lost its look, the review
// its "Where you died, and how" and its causes, and nothing calls the coach
// to look again. On the real match, looks on three deaths Riot confirms and
// one on round 17, the death the screen invented.
{
  const snap = { ...played, startedAt: T0 - 60000, endedAt: T0 + 24 * riotReview.ROUND_MS + 60000 };
  const LOOKS = { 2: 'isolated', 14: 'isolated', 17: 'isolated', 19: 'dry-peek' };
  // With the clip of each (8.3), cut from the match's recording.
  const look = (n) => ({ cause: LOOKS[n], what: `You held the site alone in round ${n}, far from your team.`,
    better: 'Hold the angle with a teammate close enough to trade you.',
    frames: [`r${n}-before.jpg`, `r${n}-after.jpg`], source: 'screen', at: snap.startedAt + n * 100000, clip: `r${n}-clip.mkv` });
  // As the look from the screen leaves them: on the ledger's own rows, so the
  // review built from them carries the looks on its cards.
  const rows = played.rounds.map((r) => (LOOKS[r.n] ? { ...r, forensics: look(r.n) } : r));
  const saveAs = (rounds, id) => {
    const rv = valorantReview.build({ rounds, context: played.context, endedBy: 'score', ai: {}, role: 'Duelist', history: [] });
    rv.ledger = valorantReview.ledgerOf({ ...snap, rounds });
    Object.assign(rv, { id, at: snap.endedAt });
    return riotReview.upgradeWatched({ saved: { id, at: rv.at, review: rv }, row: ROW, riot, history: [], account: 'Me#EUW' }).review;
  };
  const built = valorantReview.build({ rounds: rows, context: played.context, endedBy: 'score', ai: {}, role: 'Duelist', history: [] });
  const looked = (rv) => rv.rounds.filter((c) => c.forensics).map((c) => c.n).join(',');
  const causeRounds = (rv, key) => JSON.stringify(([...rv.insights.mistakes, ...rv.insights.missed].find((e) => e.key === key) || {}).rounds || null);
  const riotDied = (n) => !!(riot.perRound.find((p) => p.n === n) || {}).died;
  const screenDied = (n) => !!(played.rounds.find((r) => r.n === n) || {}).died;
  ok(Object.keys(LOOKS).every((n) => screenDied(Number(n))) && [2, 14, 19].every(riotDied) && !riotDied(17),
    'the screen filed deaths in rounds 2, 14, 17 and 19, and Riot has every one of them but 17');
  ok(looked(built) === '2,14,17,19' && causeRounds(built, 'cause:isolated') === '[2,14,17]'
    && !JSON.stringify(valorantReview.ledgerOf({ ...snap, rounds: rows })).includes('forensics'),
    `as 8.2 saves it: looks on rounds ${looked(built)}, a repeated cause, and none of them in its ledger`);
  const up = saveAs(rows, 'valorant-1758391200000-looked');
  const plain = saveAs(played.rounds, 'valorant-1758391200000-unseen');
  ok(up.verified && looked(up) === '2,14,19', `checked against Riot, the looks on the deaths Riot confirms stay (${looked(up) || 'none'})`);
  const kept = up.rounds.filter((c) => c.forensics);
  ok(kept.length === 3 && kept.every((c) => c.forensics.source === 'screen' && c.forensics.cause === LOOKS[c.n]
    && JSON.stringify(c.forensics.frames) === JSON.stringify([`r${c.n}-before.jpg`, `r${c.n}-after.jpg`])
    && c.forensics.what === look(c.n).what && c.forensics.better === look(c.n).better && c.forensics.at === look(c.n).at),
    'each still from the screen, with its cause, its sentences, its moment and the names of its frames kept beside the review');
  ok(kept.every((c) => c.forensics.clip === `r${c.n}-clip.mkv`), 'and the name of its clip (8.3), so its card still plays it');
  // Its clips cleared for space before the check: the review says so still.
  const cleared = (() => {
    const rv = valorantReview.build({ rounds: rows, context: played.context, endedBy: 'score', ai: {}, role: 'Duelist', history: [] });
    rv.ledger = valorantReview.ledgerOf({ ...snap, rounds: rows });
    Object.assign(rv, { id: 'valorant-1758391200000-clear1', at: snap.endedAt, clipsCleared: { reason: 'space', at: T0 } });
    return riotReview.upgradeWatched({ saved: { id: rv.id, at: rv.at, review: rv }, row: ROW, riot, history: [], account: 'Me#EUW' }).review;
  })();
  ok(cleared.clipsCleared && cleared.clipsCleared.reason === 'space' && !('clipsCleared' in up),
    'a review whose clips the cap took says so after the check too, and one that kept them says nothing');
  ok(!up.rounds.find((c) => c.n === 17).forensics && !up.rounds.find((c) => c.n === 17).died,
    'and the look at round 17, a death Riot says never happened, goes with it');
  ok(causeRounds(up, 'cause:isolated') === '[2,14]' && causeRounds(up, 'cause:dry-peek') === '[19]',
    `so its causes count only the confirmed deaths (isolated ${causeRounds(up, 'cause:isolated')}, dry-peek ${causeRounds(up, 'cause:dry-peek')})`);
  ok(JSON.stringify(up.grade) === JSON.stringify(plain.grade),
    `and the grade is the one it gets with no look at all, since a look from the screen is never graded (${up.grade.score})`);
}

// ── A match the watch ended early, checked against Riot's record (8.2.1) ──
// The player's own Split match, saved by 8.0.1 as "Defeat 3-5, Swiftplay"
// after a wrong swiftplay lock ended it in round 9, with no ledger. Riot has
// it Competitive, Victory 13 to 7 over 20 rounds, at 3 to 5 after round 8.
{
  const SPLIT = load('riot-split-13-7.json');
  const SAVED = load('valorant-review-split-801.json');
  const SROW = { matchId: 'split-1', map: 'Split', agent: 'Jett', mode: 'Competitive', result: 'Victory', score: '13-7',
    kills: 17, deaths: 16, assists: 8, kd: 1.06, acs: 279, adr: 181, headshotPct: 22, startedAt: SPLIT.startedAt };
  const old = SAVED.review;
  ok(old.game.result === 'Defeat' && old.game.score === '3-5' && old.game.mode === 'Swiftplay' && old.halftimeAfter === 4
    && old.rounds.length === 8 && !old.ledger && !old.verified,
    'as 8.0.1 saved it: Defeat 3-5, Swiftplay, halftime after round 4, 8 rounds, no ledger, never checked');
  const { review: up, tracker } = riotReview.upgradeWatched({ saved: { id: SAVED.id, at: SAVED.at, review: old },
    row: SROW, riot: SPLIT, history: [], account: 'Me#EUW' });
  ok(up.id === SAVED.id && up.at === SAVED.at && up.verified && up.matchId === 'split-1' && up.lateLinked,
    'checked now, it keeps its id and its place in the library');
  ok(up.rounds.length === 20 && up.watched.rounds === 8
    && up.rounds.every((c) => c.watched === (c.n <= 8) && c.verified && !!c.riot),
    `with all 20 of Riot's rounds, the first 8 the ones the coach watched (${up.watched.rounds} watched)`);
  ok(up.rounds.filter((c) => c.n > 8).every((c) => c.facts.includes('Not watched by the coach') && c.spot === null && !c.reads.length),
    'and the 12 after the watch called it over marked as not watched, with nothing from the screen in them');
  ok(up.game.result === 'Victory' && up.game.score === '13-7' && up.game.mode === 'Competitive' && up.game.agent === 'Jett'
    && up.halftimeAfter === 12, `result, score, queue and halftime are Riot's (${up.game.mode}, ${up.game.result} ${up.game.score})`);
  ok(typeof up.grade.score === 'number' && !up.grade.provisional && up.scoreline.kills === 17 && tracker.acs === 279,
    `and the grade is Riot's numbers' (${up.grade.score} ${up.grade.letter}, ${up.scoreline.kills}/${up.scoreline.deaths}/${up.scoreline.assists})`);
  // Riot attacked rounds 1 to 12; the screen's swiftplay swap had 6 to 8 on defence.
  ok(old.rounds.filter((c) => c.side === 'Defence').map((c) => c.n).join() === '6,7,8'
    && up.rounds.filter((c) => c.n <= 12).every((c) => c.side === 'Attack'),
    "Riot's sides replace the screen's swap after round 4");
  ok(up.rounds.find((c) => c.n === 3).spot === 'B Back' && up.rounds.find((c) => c.n === 4).spot === 'A Tower'
    && !up.rounds.find((c) => c.n === 2).died && up.rounds.find((c) => c.n === 2).spot === null,
    "the screen's death spots stay where Riot confirms the death, and go where Riot says the player lived");
  const SAID = "The coach thought the match was over at 3 to 5, and it went on. Riot's record fills in rounds 9 to 20, "
    + 'which the coach did not watch, so those rounds have no death location and nothing seen on screen.';
  ok(up.refused.includes(SAID), `the review says the coach ended it too soon (${up.refused.join(' | ')})`);
  ok(up.summary === null && up.focus === null && up.refused.some((l) => /taken down/.test(l)),
    'and the read written from the 3-5 is taken down, saying so');
  const sides = (rv) => (rv.patterns.find((p) => p.key === 'sides') || {}).text;
  ok(sides(old) === 'Attack was your stronger side: won 3 of 5 on attack and 0 of 3 on defence.'
    && sides(up) === 'Defence was your stronger side: won 6 of 12 on attack and 7 of 8 on defence.',
    `its patterns are counted over Riot's sides (${sides(up)})`);
  const dashed = (t) => [0x2013, 0x2014].some((c) => String(t).includes(String.fromCharCode(c)));
  ok(dashed(`a ${String.fromCharCode(0x2014)} b`) && !up.refused.some(dashed) && !dashed(up.verification),
    'and no line it adds carries a dash');

  // The live link builds the same match from the screen's own rounds once
  // Riot's record lands (riotLook in index.js): the same line, the same queue.
  const { rows } = riotReview.ledgerRows(old);
  const live = valorantReview.build({ rounds: verify.reconcile(rows, SPLIT).rounds,
    context: { map: 'Split', agent: 'Jett', agentConfirmed: true, teamScore: 3, enemyScore: 5, gameMode: 'swiftplay' },
    endedBy: 'score', ai: {}, tracker: SROW, role: 'Duelist', history: [], riotMe: SPLIT.me, queue: SPLIT.queue });
  ok(live.refused.includes(SAID) && live.game.mode === 'Competitive' && live.halftimeAfter === 12 && live.game.result === 'Victory',
    'built by the live link, it says the same and is the same match');

  // Said only where Riot's record shows it.
  const merged = verify.reconcile(rows, SPLIT).rounds;
  const early = valorantReview.endedTooSoon;
  ok(early(merged, 3, 5) && early(merged, 4, 5) && !early(merged, 5, 3) && !early(merged, 13, 7) && !early(merged, null, 5),
    "an early end is the screen's last score at the round Riot stood at it, and never Riot's final");
  ok(!early(rows, 3, 5) && !early(merged.map((r) => ({ ...r, verified: false })), 3, 5),
    'and needs Riot: rounds Riot has not been laid over prove nothing about where Riot stood');
  const abyss = verify.reconcile(played.rounds, riot).rounds;
  ok(!early(abyss, 13, 11) && !early(abyss, 13, 10),
    'a match seen to its real end is not one, nor a final read one digit short (Riot stood at 12-11 after round 23, never 13-10)');
  const whole = riotReview.upgradeWatched({ saved: { id: 'valorant-1758391200000-whole1', at: T0 + 2400000,
    review: (() => {
      const b = valorantReview.build({ rounds: played.rounds, context: played.context, endedBy: 'score', ai: {}, role: 'Duelist', history: [] });
      b.ledger = valorantReview.ledgerOf({ ...played, startedAt: T0 - 60000, endedAt: T0 + 2400000, endedBy: 'score' });
      return b;
    })() }, row: ROW, riot, history: [] }).review;
  ok(!whole.refused.some((l) => /thought the match was over/.test(l)), 'and the Abyss match the watch saw end says nothing of the kind');
}

console.log(`\n${fails ? fails + ' of ' + checks + ' failed' : 'all ' + checks + ' riot review checks passed'}`);
process.exit(fails ? 1 : 0);
