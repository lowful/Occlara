'use strict';

/**
 * A ROUND THE PLAYER SAT OUT, END TO END (8.8): Riot's was_afk or
 * stayed_in_spawn, carried as afk and inSpawn (src/shared/sat-out.js), on the
 * real Split match (scripts/fixtures/riot-split-13-7.json and the review
 * saved for it) with round 7 marked AFK: a lost round where the player died
 * first, untraded, to Reyna. Before 8.8 only the mistakes left it out, and
 * the grade (81, not 82), the misses, the card, the page's patterns, the
 * counts sent to the coach, the round it picked for a line, Moments, Ask
 * Coach's enemy block and the paid death look all still counted it.
 *
 * Also here: the untraded deaths told apart by Riot's nearest teammate
 * (insights.js, 'untraded' and 'untraded-close'), the team's buy line as a
 * finding, the rifle core rule (riot-rounds.js buyOf) and the review route's
 * pattern cut that kept the buy line from the coach.
 *
 * Run: npm run test:satout
 */
const fs = require('fs');
const path = require('path');

const FIX = path.join(__dirname, 'fixtures');
const load = (n) => JSON.parse(fs.readFileSync(path.join(FIX, n), 'utf8'));
const { satOut, cardSatOut, satOutNote } = require('../src/shared/sat-out');
const grade = require('../src/shared/grade');
const insights = require('../src/shared/insights');
const review = require('../src/shared/valorant-review');
const verify = require('../src/shared/valorant-verify');
const riotReview = require('../src/shared/riot-review');
const moments = require('../src/shared/moments');
const patterns = require('../src/shared/patterns');
const chatContext = require('../src/shared/chat-context');
const deathFrames = require('../src/shared/death-frames');
const matchReview = require('../server/services/match-review');
const chatPrompt = require('../server/services/chat-prompt');
const riotRounds = require('../server/services/riot-rounds');

let checks = 0;
let fails = 0;
const ok = (cond, what) => {
  checks++;
  if (cond) console.log(`ok    ${what}`);
  else { fails++; console.log(`FAIL  ${what}`); }
};

const AFK = 7;
const SAVED = load('valorant-review-split-801.json');
const SPLIT = load('riot-split-13-7.json');
const row = { matchId: 'split-1', map: 'Split', agent: 'Jett', mode: 'Competitive', result: 'Victory', score: '13-7',
  kills: 17, deaths: 16, assists: 8, kd: 1.06, acs: 279, adr: 181, headshotPct: 22, startedAt: SPLIT.startedAt };
const scoreline = { kills: 17, deaths: 16, assists: 8, acs: 279, adr: 181, headshotPct: 22 };
function riotWith(flags) {
  const r = JSON.parse(JSON.stringify(SPLIT));
  for (const p of r.perRound) if (flags[p.n]) Object.assign(p, flags[p.n]);
  return r;
}
// The saved review with a death look on round 7 and on round 3, the same cause, as 8.2 and later save one.
function saved() {
  const s = JSON.parse(JSON.stringify(SAVED));
  for (const c of s.review.rounds) if (c.n === AFK || c.n === 3) {
    c.forensics = { cause: 'isolated', what: 'You were alone with no teammate in sight.', better: 'Play near a teammate who can trade you.', source: 'screen', variant: 'b' };
  }
  return s;
}
const watched = (flags) => review.served(riotReview.upgradeWatched({ saved: saved(), row, riot: riotWith(flags), history: [], account: 'x#y' }).review);
const ALL = (ins) => ['mistakes', 'missed', 'strengths'].flatMap((k) => (ins[k] || []).map((e) => ({ list: k, ...e })));

// ── The shared test ─────────────────────────────────────────────────────────
ok(satOut({ afk: true }) && satOut({ inSpawn: true }) && !satOut({ afk: 'yes' }) && !satOut({ inSpawn: 1 }) && !satOut(null) && !satOut({}),
  'only a true flag is a round sat out');
ok(cardSatOut({ riot: { afk: true } }) && cardSatOut({ inSpawn: true }) && !cardSatOut({ riot: { afk: false } }), 'and on a card, under riot or on the card');
ok(satOutNote([{ n: 7, afk: true }]) === 'Left out of every count: round 7, Riot marked you AFK.'
  && satOutNote([{ n: 3, inSpawn: true }, { n: 9, afk: true }, { n: 11, afk: true }]) === 'Left out of every count: rounds 9 and 11, Riot marked you AFK; round 3, Riot has you in spawn all round.'
  && satOutNote([{ n: 1 }]) === null, 'the note names the rounds left out, and is none without one');

// ── The grade ───────────────────────────────────────────────────────────────
{
  const g = (flags) => grade.valorant({ rounds: verify.reconcile([], riotWith(flags)).rounds, scoreline, role: 'Duelist', history: [], totalRounds: 20 });
  const none = g({});
  const one = g({ [AFK]: { afk: true } });
  const surv = (x) => x.categories.find((c) => c.key === 'survival').evidence.join('; ');
  const team = (x) => x.categories.find((c) => c.key === 'teamplay').evidence.join('; ');
  ok(none.score === 81 && one.score === 82, `the AFK round is not graded: 81 with it, 82 on the rounds played (${none.score}, ${one.score})`);
  ok(surv(one).includes('15 deaths in 19 rounds') && surv(one).includes('first to die and not traded in 3 of 19 rounds'),
    `Survival counts the rounds played (${surv(one)})`);
  ok(team(one).startsWith('2 of 14 deaths traded'), `and so does Teamplay (${team(one)})`);
  ok(one.notes.includes('Left out of every count: round 7, Riot marked you AFK.') && !none.notes.some((n) => /Left out/.test(n)),
    'a note names the round left out, and only when there is one');
  const spawn = g({ [AFK]: { inSpawn: true } });
  ok(spawn.score === 82 && spawn.notes.includes('Left out of every count: round 7, Riot has you in spawn all round.'), 'a round in spawn the same way');
  const forged = g({ [AFK]: { afk: 'yes' } });
  ok(forged.score === 81, 'a flag that is not true changes nothing');
  // Every verified round sat out (8.8 review): linked, so no "firms up once Riot's round record links", and no grade.
  const afkAll = grade.valorant({ rounds: Array.from({ length: 13 }, (_, i) => ({ n: i + 1, verified: true, died: true, afk: true })),
    totalRounds: 13, scoreline: { kills: 0, deaths: 13, assists: 0, acs: 20 } });
  ok(afkAll.score === null && !afkAll.notes.some((n) => /firms up/.test(n)) && afkAll.notes.some((n) => /^Left out of every count: rounds 1, /.test(n))
    && afkAll.categories.every((c) => c.score === null), `a whole match AFK is linked and has no grade (${afkAll.score}, ${afkAll.notes.join(' | ')})`);
  const unlinked = grade.valorant({ rounds: Array.from({ length: 13 }, (_, i) => ({ n: i + 1, died: true })),
    totalRounds: 13, scoreline: { kills: 10, deaths: 13, assists: 2, acs: 180 } });
  ok(unlinked.notes.some((n) => /firms up once Riot's round record links/.test(n)), 'an unlinked match still says it firms up once the record links');
}

// ── The lists, the card, the page's patterns ───────────────────────────────
const before = watched({});
const after = watched({ [AFK]: { afk: true } });
{
  const all = ALL(after.insights);
  ok(!all.some((e) => (e.rounds || []).includes(AFK)), `no mistake, miss or strength holds the AFK round (${all.filter((e) => (e.rounds || []).includes(AFK)).map((e) => e.key).join(', ') || 'none'})`);
  ok(ALL(before.insights).some((e) => (e.rounds || []).includes(AFK)), 'where without the flag round 7 is counted');
  for (const k of ['mistakes', 'missed', 'strengths']) {
    const keys = (after.insights[k] || []).map((e) => e.key);
    ok(new Set(keys).size === keys.length, `no key twice in the ${k} (${keys.join(', ')})`);
  }
  const miss = after.insights.missed.filter((e) => e.key === 'cause:isolated');
  ok(miss.length === 1 && miss[0].rounds.join() === '3', 'the one look left is one miss, never split into two by the AFK round');
  const card = after.rounds.find((c) => c.n === AFK);
  ok(card.tags[0] && card.tags[0].kind === 'afk' && card.tags.every((t) => t.tone === 'even'), `the AFK chip leads the card and nothing is judged (${card.tags.map((t) => `${t.text}=${t.tone}`).join(' | ')})`);
  ok(!card.tags.some((t) => ['firstdeath', 'untraded', 'traded', 'odds', 'ult'].includes(t.kind)), 'no first death, trade, odds or ultimate chip');
  ok(card.open === false && !card.forensics && !card.why, 'it never opens by itself and shows no look and no line');
  const kept = before.rounds.find((c) => c.n === AFK);
  ok(kept.tags.some((t) => t.kind === 'firstdeath') && kept.open === true, 'without the flag the same card is judged and opens, as before');
  const killer = (after.patterns || []).find((p) => p.key === 'killer');
  ok(killer && killer.text === 'Reyna killed you 4 times, more than anyone else.', `the page's killer line leaves the AFK death out (${killer && killer.text})`);
  ok(!(after.patterns || []).some((p) => /of your 16 deaths/.test(p.text)), 'and no death line counts 16 deaths');
  const streak = (after.patterns || []).find((p) => p.key === 'streak');
  ok(streak && streak.text === 'You lost 3 rounds in a row, rounds 6 to 8.', 'the team\'s run of lost rounds still holds every round');
}
// A card a version before saved: the AFK chip last, after the chips that judge.
{
  const old = saved();
  const c7 = old.review.rounds.find((c) => c.n === AFK);
  c7.facts = ['Died 35s in, to Reyna with a Vandal', 'First death of the round', '5 against 5 when you died', 'Not traded', 'Riot marked you AFK, not counted'];
  c7.riot = { killer: 'Reyna', weapon: 'Vandal', firstDeath: true, traded: false };
  const shown = review.served(old.review).rounds.find((c) => c.n === AFK);
  ok(shown.tags.map((t) => t.text).join(' | ') === 'Riot marked you AFK, not counted | Died 35s in, to Reyna with a Vandal' && shown.tags.every((t) => t.tone === 'even'),
    `an old card is shown as one made today (${shown.tags.map((t) => t.text).join(' | ')})`);
  ok(shown.open === false && !shown.forensics, 'and never opens, its saved look hidden');
  ok(JSON.stringify(c7.facts).includes('First death'), 'its facts on disk are left as they were');
  const plain = review.served(saved().review).rounds.find((c) => c.n === 3);
  ok(plain.open === true && plain.forensics, 'a card not sat out opens on its look as before');
}

// ── What the coach is sent and what it may say ─────────────────────────────
{
  const { rows } = riotReview.ledgerRows(saved().review);
  const body = (flags) => {
    const { rounds } = verify.reconcile(rows, riotWith(flags));
    return review.requestBody({ rounds, context: { agent: 'Jett', map: 'Split', teamScore: 13, enemyScore: 7 }, endedBy: 'score',
      riot: { agent: 'Jett', map: 'Split', score: '13-7', result: 'Victory', scoreline } });
  };
  const b0 = body({});
  const b1 = body({ [AFK]: { afk: true } });
  ok(b0.counts.deaths === 16 && b1.counts.deaths === 15 && b1.counts.untradedMate === b0.counts.untradedMate - 1,
    `countsOf leaves the AFK death out (${JSON.stringify(b0.counts)} then ${JSON.stringify(b1.counts)})`);
  const input = matchReview.normalise(b1);
  const c = matchReview.matchCounts(input);
  ok(c.deaths === 15 && c.rounds === 19, `the server counts the same (${JSON.stringify(c)})`);
  const lines = matchReview.countLines(input);
  ok(lines.includes('Riot marks you as sitting out round 7, so it is left out of these counts.'), `the block says the round is left out (${lines.join(' / ')})`);
  ok(!matchReview.countLines(matchReview.normalise(b0)).some((l) => /sitting out/.test(l)), 'and says nothing of it without one');
  const f = matchReview.matchFacts(input);
  ok(!f.killer || !/ 5 times/.test(f.killer.text), 'the record\'s killer line never counts the AFK death');
  const r7 = input.rounds.find((r) => r.n === AFK);
  ok(r7.afk === true && matchReview.lineWorthy(r7) === false, 'the AFK round is worth no line');
  ok(matchReview.lineWorthy(matchReview.normalise(b0).rounds.find((r) => r.n === AFK)) === true, 'where without the flag it was');
  ok(!matchReview.teachable(input.rounds).some((r) => r.n === AFK), 'teachable never picks it');
  const line = matchReview.roundLine(r7, { plant: true });
  ok(/^R7 [^.]*\. Riot marks the player as sitting this round out/.test(line) && !/first player to die|nobody traded|standing against/.test(line),
    `its round line says the flag first and judges nothing (${line})`);
  // The gate, both ways, on a forged reply.
  const reply = [
    'SUMMARY: You won 13 to 7 on Split. In round 7 you died first and nobody traded you, so slow your entry. Riot marked you AFK in round 7, so it is not judged. Round 6 was lost to Reyna on A Main. You lost 3 rounds in a row, rounds 6 to 8.',
    'R7: You walked into A Main alone, play closer to a teammate.',
    'R6: You took the first fight alone on A Main and lost it.',
    'FOCUS: Stop dying first as you did in R7. Trade your entry with a teammate close.',
  ].join('\n');
  const out = matchReview.parse(reply, input);
  ok(!out.rounds[AFK], 'a round line for the AFK round never stays');
  ok(out.summary && !/died first and nobody traded/.test(out.summary) && /Riot marked you AFK in round 7/.test(out.summary) && /Round 6 was lost/.test(out.summary),
    `the summary sentence judging round 7 goes, the one saying it was AFK and the one about round 6 stay (${out.summary})`);
  ok(/rounds 6 to 8/.test(out.summary || ''), 'a run of rounds through the AFK one is the record of the team and stays');
  ok(matchReview.SAT_OUT_RANGE.test('You lost 10 rounds in a row, rounds 5 to 14.') && !'In rounds 4, 7 and 9 you died first.'.match(matchReview.SAT_OUT_RANGE),
    'the run of rounds, and no list of rounds');
  ok(!out.focus || !/R7|round 7/i.test(out.focus), `the focus sentence naming R7 goes (${out.focus})`);
  const plain = matchReview.parse(reply, matchReview.normalise(b0));
  ok(/died first and nobody traded/.test(plain.summary || ''), 'without the flag the gate drops nothing of it');
  ok(matchReview.SAT_OUT_SAID.test('Riot marked you AFK in round 7.') && matchReview.SAT_OUT_SAID.test('You sat out round 7.')
    && !matchReview.SAT_OUT_SAID.test('In round 7 you died first and nobody traded you.') && !matchReview.SAT_OUT_SAID.test('You spawned the smoke late.'),
    'the words that say a round was sat out, and none that judge it');
}

// ── Moments, Ask Coach, the look, the library ──────────────────────────────
{
  const io = { url: () => '', frames: () => null };
  const ds = moments.valorantDeaths({ id: 'split-1', review: after }, new Set(), io, new Set());
  ok(!ds.some((m) => m.round === AFK) && ds.some((m) => m.round === 3), 'Moments lists no death in the AFK round, and the rest as before');
  ok(moments.valorantDeaths({ id: 'split-1', review: before }, new Set(), io, new Set()).some((m) => m.round === AFK), 'where without the flag it did');

  // An old review's fill learns the flags.
  const filled = chatContext.applyRoundRecord({ rounds: before.rounds },
    { perRound: [{ n: AFK, afk: true }, { n: 8, inSpawn: true }, { n: 9, afk: 'yes' }] }, 1);
  const fr = (n) => filled.rounds.find((c) => c.n === n);
  ok(fr(AFK).riot.afk === true && fr(8).riot.inSpawn === true && !('afk' in fr(9).riot), 'applyRoundRecord carries afk and inSpawn, true only');

  const ctx = chatContext.build(after, { rows: [], patterns: {}, breakdown: null }, null, 'how do I play against Reyna', { game: 'valorant', now: Date.now() });
  const norm = chatPrompt.normalise(ctx);
  const ask = chatPrompt.enemyAskedOf(norm.match, ['Reyna']);
  ok(ask && !ask.text.includes(`Round ${AFK}:`) && /Reyna killed you 4 times, in 4 of your 15 deaths/.test(ask.text),
    `Ask Coach's enemy block leaves the AFK death out of its rounds and its counts (${ask && ask.text.split('\n')[0]})`);

  const { rounds } = verify.reconcile([], riotWith({ [AFK]: { afk: true } }));
  const picks = deathFrames.teachableDeaths(rounds, 20);
  ok(picks.length && !picks.some((r) => r.n === AFK), 'the paid death look never picks the AFK round');
  ok(deathFrames.teachableDeaths(verify.reconcile([], riotWith({})).rounds, 20).some((r) => r.n === AFK), 'where without the flag it could');

  // The library, from a review saved before the lists left the round out.
  const old = saved();
  old.review.rounds.find((c) => c.n === AFK).riot = { afk: true };
  old.review.insights = { mistakes: [{ key: 'same-killer', title: 'Reyna kept winning', rounds: [4, 7, 9], count: 3, agent: 'Reyna', weight: 1 },
    { key: 'cause:isolated', title: 'Caught alone', rounds: [7], count: 1, weight: 2 }], strengths: [], missed: [] };
  const lib = [1, 2].map((i) => ({ id: `m${i}`, at: Date.now() - i * 1e6, game: 'valorant', review: old.review }));
  const sum = patterns.summarise(lib);
  const sk = sum.mistakes.find((m) => m.key === 'same-killer');
  ok(sk && sk.examples.every((e) => !e.rounds.includes(AFK)) && sk.total === 4, `the library takes the AFK round off a saved entry (${sk && JSON.stringify(sk.examples.map((e) => e.rounds))}, total ${sk && sk.total})`);
  ok(!sum.mistakes.some((m) => m.key === 'cause:isolated'), 'and an entry of the AFK round alone is no sighting');
}

// ── Alone, or close and not traded ──────────────────────────────────────────
{
  const base = { verified: true, side: 'attacking', result: 'lost', died: true, traded: false, aliveAtDeath: { mates: 3, enemies: 4 } };
  const make = (near) => near.map((m, i) => ({ n: i + 1, ...base, ...(m ? { mateNear: m } : {}) }));
  // 14 untraded deaths, as on the real Split: 8 with no teammate close or no distance known, 6 with one close.
  const split = make(['far', 'far', null, 'far', 'close', 'far', 'close', null, 'close', 'far', 'close', 'far', 'close', 'close', null, null]
    .map((m, i) => (i < 14 ? m : 'traded')));
  for (const r of split) if (r.mateNear === 'traded') { delete r.mateNear; r.traded = true; }
  const ins = insights.valorant(split, {});
  const tr = ins.mistakes.filter((m) => /^untraded/.test(m.key));
  const e = tr[0];
  // One key for the habit (8.8 review): every reader of the trade habit reads 'untraded' only.
  ok(tr.length === 1 && e.key === 'untraded' && e.count === 14 && e.rounds.length === 14 && e.of === 16 && e.close === 6,
    `14 untraded deaths stay one 'untraded' entry of 14, 6 of them close (${tr.map((m) => `${m.key}:${m.count}`).join()})`);
  ok(e.title === 'Deaths nobody traded' && e.untradedOnly === true, `with a teammate close in some, the title no longer says nobody could trade (${e.title})`);
  ok(e.detail === '14 of your 16 deaths went unanswered: no teammate killed your killer within five seconds, and in 6 of them a teammate was close, rounds 5, 7, 9, 11, 13 and 14.'
    || /^14 of your 16 deaths went unanswered: .*, and in 6 of them a teammate was close, /.test(e.detail), `the detail keeps the whole count and names the close ones (${e.detail})`);
  ok(e.closeRounds.join() === '5,7,9,11,13,14', `closeRounds (${e.closeRounds})`);
  const unknown = insights.valorant(make([null, null, null, null]), {}).mistakes;
  ok(unknown.length === 1 && unknown[0].key === 'untraded' && unknown[0].count === 4 && unknown[0].title === 'Died where nobody could trade'
    && unknown[0].detail === '4 of your 4 deaths went unanswered: no teammate killed your killer within five seconds.'
    && unknown[0].fix === 'Before you take a fight, glance at the minimap for your nearest teammate, and if nobody is within a few steps, move toward them first.',
    'with no distance known it is the one entry it always was, word for word, its fix the far one (Nov 2026, the coaching audit)');
  const allClose = insights.valorant(make(['close', 'close', 'close', 'far']), {}).mistakes;
  ok(allClose.length === 1 && allClose[0].key === 'untraded' && allClose[0].count === 4 && /fight where they can see whoever shoots you/.test(allClose[0].fix),
    `mostly close, the fix is about the pair (${allClose[0] && allClose[0].fix})`);
  const two = insights.valorant(make(['close', 'close', 'traded', 'traded']).map((r) => (r.mateNear === 'traded' ? { ...r, traded: true, mateNear: undefined } : r)), {}).mistakes;
  ok(!two.some((m) => /^untraded/.test(m.key)), 'two untraded deaths stay under the floor of three, close or not');

  // The review's finding: 12 rounds, 10 deaths, 8 not traded (1 to 6 close, 7 and 8 far), Silver.
  const rows = Array.from({ length: 12 }, (_, i) => ({ n: i + 1, verified: true, side: 'attacking', result: 'lost',
    died: i < 10, traded: i < 8 ? false : i < 10 ? true : undefined, mateNear: i < 6 ? 'close' : i < 8 ? 'far' : undefined,
    aliveAtDeath: { mates: 3, enemies: 4 } }));
  const silver = insights.valorant(rows, {}).mistakes;
  const u = silver.find((m) => m.key === 'untraded');
  ok(u && u.count === 8 && u.detail.startsWith('8 of your 10 deaths') && !silver.some((m) => m.key === 'untraded-close'),
    `8 of 10 untraded is one entry of 8 (${silver.filter((m) => /^untraded/.test(m.key)).map((m) => `${m.key}:${m.count}`).join()})`);
  const lever = matchReview.focusLever({ mistakes: silver, context: { rankBand: 'silver_gold', agent: 'Sova' } });
  ok(lever.untraded === true && lever.tradeOk === true, `the review's focus lever still reads the trade habit (${JSON.stringify(lever)})`);
  const levers = chatPrompt.leversOf({ kind: 'valorant', cards: split.map((r) => ({ n: r.n, died: true })), patterns: [], against: [], grade: null,
    lists: { mistakes: [e], strengths: [], missed: [] } });
  ok(levers.some((l) => l.key === 'untraded' && l.kind === 'trade'), 'Ask Coach reads it as the trade habit');
  const lib = [1, 2].map((i) => ({ id: `u${i}`, at: Date.now() - i * 1e6, game: 'valorant', review: { kind: 'valorant', rounds: [], insights: insights.valorant(i === 1 ? split : rows, {}) } }));
  const rep = patterns.summarise(lib).mistakes.find((m) => m.key === 'untraded');
  ok(rep && rep.matches === 2, `the library counts the habit across both matches under one key (${rep && rep.matches})`);
}

// ── The rifle core, and the review route's pattern cut ─────────────────────
{
  const team = (rows) => ({ stats: rows.map(([lv, rem, gun], i) => ({ player: { puuid: `t${i}`, team: 'red' },
    economy: { loadout_value: lv, remaining: rem, weapon: { id: 'w', name: gun, type: 'Weapon' } } })) });
  const ours = () => true;
  const core = team([[3900, 200, 'Vandal'], [3900, 100, 'Phantom'], [3900, 300, 'Vandal'], [2600, 100, 'Spectre'], [2600, 0, 'Spectre']]);
  ok(riotRounds.buyOf(core, 8, 12, ours) === 'full', `three rifles with heavy shields and two SMGs (3380 a player) is a full buy (${riotRounds.buyOf(core, 8, 12, ours)})`);
  const forced = team([[3300, 200, 'Vandal'], [3300, 100, 'Phantom'], [3300, 300, 'Guardian'], [2000, 100, 'Spectre'], [1200, 0, 'Sheriff']]);
  ok(riotRounds.buyOf(forced, 5, 12, ours) === 'force', `three rifles with light shields and two lighter guns, little left (2620 a player), stays a force (${riotRounds.buyOf(forced, 5, 12, ours)})`);
  ok(riotRounds.BUY.RIFLE_CORE_LOAD === 3300, 'the core rule\'s loadout is written down');

  const pats = ['spot', 'firstdeath', 'early', 'killer', 'ult', 'streak', 'postplant', 'retake', 'firstkill', 'sides', 'buys']
    .map((key) => ({ key, text: `A ${key} line.` }));
  const kept = matchReview.normalise({ rounds: [], patterns: pats }).patterns.map((p) => p.key);
  // Changed when the economy went out of scope (Nov 2026): an older client's buys line is dropped, so the team's one is the sides.
  ok(kept.length === 9 && !kept.includes('buys') && kept.includes('sides') && kept.slice(0, 8).join() === pats.slice(0, 8).map((p) => p.key).join(),
    `nine or more patterns keep the first eight and the sides, never the buys (${kept.join(', ')})`);
  ok(matchReview.normalise({ rounds: [], patterns: pats.slice(0, 5) }).patterns.length === 5, 'a short list is kept whole, as before');
  const many = Array.from({ length: 14 }, (_, i) => ({ key: `k${i}`, text: `Line ${i}.` }));
  ok(matchReview.normalise({ rounds: [], patterns: many }).patterns.length === 8, 'and a list of other keys is still cut at eight');
}

console.log(`\n${fails ? fails + ' of ' + checks + ' failed' : 'all ' + checks + ' sat out round checks passed'}`);
process.exit(fails ? 1 : 0);
