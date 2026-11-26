'use strict';

/**
 * THE MATCH RATING ENGINE (src/shared/rating.js, docs/claude/rating.md):
 * the chance to win, the swings, the sanity cases (an ace round, a 1v3
 * clutch, first death untraded every round, bottom frag on cleanup kills, a
 * traded entry, a round sat out), determinism, missing fields, the length
 * rule, the saved shape and its version, and the real Abyss record.
 *
 * Pure node, no window. Run: npm run test:rating
 */
const rating = require('../src/shared/rating');

let checks = 0;
let fails = 0;
function ok(cond, msg) {
  checks++;
  if (cond) console.log(`  ok  ${msg}`);
  else { fails++; console.log(`  FAIL ${msg}`); }
}

const { winChance, createRating } = rating;

/* A tiny round builder: kills as [killer, victim, ms]. */
function round(n, side, kills, won, extra) {
  return [
    { kind: 'round', round: n, side, ...(extra && extra.satOut ? { satOut: true } : {}) },
    ...(extra && extra.plantMs !== undefined ? [{ kind: 'plant', round: n, ms: extra.plantMs, by: side === 'attacking' ? 'us' : 'them' }] : []),
    ...kills.map(([killer, victim, ms]) => ({ kind: 'kill', round: n, ms, killer, victim, weapon: 'Vandal' })),
    { kind: 'end', round: n, won },
  ].sort((a, b) => (a.kind === 'round' ? -1 : b.kind === 'round' ? 1 : a.kind === 'end' ? 1 : b.kind === 'end' ? -1 : a.ms - b.ms));
}
const LOBBY = ['me', 'us:Sova', 'us:Omen', 'us:Sage', 'us:Raze', 'them:Jett', 'them:Reyna', 'them:Viper', 'them:Cypher', 'them:Fade'];
const THEM = LOBBY.filter((k) => k.startsWith('them:'));
const MATES = LOBBY.filter((k) => k.startsWith('us:'));
function run(events, opts) {
  const r = createRating({ players: LOBBY, ...(opts || {}) });
  const outs = events.map((e) => r.push(e));
  return { r, outs, snap: r.snapshot() };
}
const valueOf = (snap, key) => snap.players.find((p) => p.key === key).value;

console.log('\nThe chance to win');
{
  ok(winChance(5, 5, false) < 0.5 && winChance(5, 5, false) > 0.3, `defenders edge at 5v5 with the spike up (${winChance(5, 5, false).toFixed(2)})`);
  ok(winChance(5, 5, true) > 0.5, 'a plant at equal numbers favours the attackers');
  ok(winChance(5, 4, false) > winChance(5, 5, false) && winChance(4, 5, false) < winChance(5, 5, false), 'a man up helps, a man down hurts');
  ok(winChance(0, 3, false) === 0 && winChance(3, 0, false) === 1, 'a side wiped out with no spike is decided');
  ok(winChance(0, 3, true, 5) > 0.9 && winChance(0, 1, true, 30) < 0.02 && winChance(0, 2, true, 12) === 0.5 && winChance(0, 2, true, 0) === 1,
    `attackers wiped after the plant win by the spike's clock (5 s left ${winChance(0, 3, true, 5).toFixed(2)}, 12 s 0.5, 30 s ${winChance(0, 1, true, 30).toFixed(3)})`);
  ok(winChance(0, 2, true) === rating.WP.WIPED_FLAT, "and with no clock to go by, the record's own share");
  for (let a = 1; a <= 5; a++) for (let d = 1; d <= 5; d++) {
    if (a < 5 && !(winChance(a + 1, d, false) > winChance(a, d, false))) ok(false, `monotone in attackers at ${a}v${d}`);
    if (d < 5 && !(winChance(a, d + 1, false) < winChance(a, d, false))) ok(false, `monotone in defenders at ${a}v${d}`);
  }
  ok(true, 'monotone in both numbers on every state');
}

console.log('\nThe swings');
{
  const r = createRating({ players: LOBBY });
  r.push({ kind: 'round', round: 1, side: 'attacking' });
  const first = r.push({ kind: 'kill', round: 1, ms: 10000, killer: 'me', victim: 'them:Jett' });
  ok(first.swing > 0.2 && first.label === 'First kill, 5v5', `a first kill at 5v5 is a large swing (${first.swing}, "${first.label}")`);
  for (const [i, v] of ['them:Reyna', 'them:Viper', 'them:Cypher'].entries()) r.push({ kind: 'kill', round: 1, ms: 11000 + i * 1000, killer: 'us:Sova', victim: v });
  const fifth = r.push({ kind: 'kill', round: 1, ms: 20000, killer: 'me', victim: 'them:Fade' });
  ok(fifth.swing > 0 && fifth.swing < 0.05, `the last kill of a 5v1 is tiny (${fifth.swing}, "${fifth.label}")`);

  const s = createRating({ players: LOBBY });
  s.push({ kind: 'round', round: 1, side: 'attacking' });
  s.push({ kind: 'plant', round: 1, ms: 40000, by: 'us' });
  const late = s.push({ kind: 'kill', round: 1, ms: 40000 + 46000, killer: 'me', victim: 'them:Jett' });
  ok(late.swing === 0 && late.label === 'Kill after the round was decided', `a kill after the spike went off moves nothing ("${late.label}")`);
  const endOut = s.push({ kind: 'end', round: 1, won: true });
  ok(endOut.kind === 'end' && endOut.swing > 0, 'the round end still gives the small result term');
  ok(rating.W.RESULT <= 0.03, `the result term stays small (${rating.W.RESULT})`);
}

console.log('\nAn ace round');
{
  const ace = run(round(1, 'attacking', THEM.map((v, i) => ['me', v, 5000 + i * 4000]), true));
  const labels = ace.snap.timeline.map((e) => e.label);
  ok(labels[0] === 'First kill, 5v5' && labels.filter((l) => /\bkill\b/i.test(l)).length === 5, `five kills, the first labelled ("${labels.join('; ')}")`);
  const sum = ace.snap.timeline.filter((e) => e.kind === 'kill').reduce((a, e) => a + e.swing, 0);
  ok(Math.abs(sum - (1 - winChance(5, 5, false))) < 0.003, `the ace's swings sum to the chance it took the round from (${sum.toFixed(3)})`);
  ok(ace.snap.value >= 6.8, `an ace in one round lifts the rating clearly (${ace.snap.value})`);
}

console.log('\nA 1v3 clutch');
{
  // Four mates die, the player kills three, the round is won.
  const kills = [['them:Jett', 'us:Sova', 5000], ['me', 'them:Jett', 7000], ['them:Reyna', 'us:Omen', 9000], ['them:Viper', 'us:Sage', 11000],
    ['them:Viper', 'us:Raze', 13000], ['me', 'them:Reyna', 20000], ['me', 'them:Viper', 25000], ['me', 'them:Cypher', 30000], ['me', 'them:Fade', 35000]];
  const c = run(round(1, 'defending', kills, true));
  const clutch = c.snap.timeline.filter((e) => e.kind === 'kill' && e.ms >= 20000);
  const sum = clutch.reduce((a, e) => a + e.swing, 0);
  ok(clutch[0].label === 'Kill as the last one up, 1v4' && sum > 0.9, `the clutch kills from 1v4 carry nearly the whole round (${sum.toFixed(3)})`);
  const ace = run(round(1, 'defending', THEM.map((v, i) => ['me', v, 5000 + i * 4000]), true));
  ok(c.snap.value > ace.snap.value, `a 1v4 clutch is worth more than an ace at 5v5, with no bonus written (${c.snap.value} against ${ace.snap.value})`);
}

console.log('\nFirst death untraded, every round');
{
  const ev = [];
  for (let n = 1; n <= 24; n++) ev.push(...round(n, n <= 12 ? 'attacking' : 'defending', [['them:Jett', 'me', 8000]], n % 2 === 0));
  const d = run(ev);
  ok(d.snap.value <= 4.0, `twenty four untraded first deaths land near the floor (${d.snap.value})`);
  ok(d.snap.value >= 3.0, 'and never under the floor');
  const lab = d.snap.timeline.find((e) => e.kind === 'kill');
  ok(lab.label === 'Died first, not traded', `each death says it was not traded once the round is over ("${lab.label}")`);
}

console.log('\nA traded entry duelist');
{
  const untraded = [];
  const traded = [];
  for (let n = 1; n <= 24; n++) {
    const side = n <= 12 ? 'attacking' : 'defending';
    untraded.push(...round(n, side, [['them:Jett', 'me', 8000]], n % 2 === 0));
    traded.push(...round(n, side, [['them:Jett', 'me', 8000], ['us:Sova', 'them:Jett', 9500]], n % 2 === 0));
  }
  const u = run(untraded);
  const t = run(traded);
  ok(t.snap.value > u.snap.value + 0.5, `a traded entry rates well above an untraded one (${t.snap.value} against ${u.snap.value})`);
  ok(t.snap.value < 6.0, `but dying first every round is still below the start (${t.snap.value})`);
  const lab = t.snap.timeline.map((e) => e.label);
  ok(lab.includes('Died first, traded') && lab.includes('Your death was traded, part of it given back'), 'the death says it was traded and the trade gives part back');
  ok(valueOf(t.snap, 'us:Sova') > 6.5, `the trader is credited the kill (${valueOf(t.snap, 'us:Sova')})`);
}

console.log('\nBottom frag with only cleanup kills');
{
  const ev = [];
  for (let n = 1; n <= 24; n++) {
    const side = n <= 12 ? 'attacking' : 'defending';
    if (n % 2) {
      // The mates take the round to 5v1, the player takes the last kill.
      ev.push(...round(n, side, [['us:Sova', 'them:Jett', 5000], ['us:Omen', 'them:Reyna', 7000], ['us:Sage', 'them:Viper', 9000],
        ['us:Raze', 'them:Cypher', 11000], ['me', 'them:Fade', 20000]], true));
    } else {
      // Dies mid round at even numbers, not traded, the round lost.
      ev.push(...round(n, side, [['them:Jett', 'us:Sova', 5000], ['us:Omen', 'them:Jett', 6000], ['them:Reyna', 'me', 15000],
        ['them:Viper', 'us:Omen', 20000], ['them:Viper', 'us:Sage', 22000], ['them:Viper', 'us:Raze', 24000]], false));
    }
  }
  const b = run(ev);
  const mates = MATES.map((k) => valueOf(b.snap, k));
  ok(b.snap.value < 6.0, `twelve cleanup kills and twelve deaths rate under the start (${b.snap.value})`);
  ok(b.snap.value < Math.min(...mates.slice(0, 3)), `and under the mates who took the rounds (${b.snap.value} against ${mates.join(', ')})`);
}

console.log('\nA round sat out moves nothing');
{
  const r = createRating({ players: LOBBY });
  for (const e of round(1, 'attacking', [['me', 'them:Jett', 5000]], true)) r.push(e);
  const before = r.value();
  const outs = round(2, 'attacking', [['them:Jett', 'me', 3000], ['them:Reyna', 'us:Sova', 6000]], false, { satOut: true }).map((e) => r.push(e));
  ok(r.value() === before && outs.every((o) => o.delta === 0 && o.swing === 0), `the AFK round's death and loss move nothing (${before} before and after)`);
  ok(!r.snapshot().timeline.some((e) => e.round === 2), 'and the timeline has nothing of it');
  ok(r.snapshot().rounds === 1, 'and it is not counted as a round played');
}

console.log('\nDeterministic');
{
  const ev = [];
  for (let n = 1; n <= 20; n++) ev.push(...round(n, n <= 12 ? 'attacking' : 'defending', [['me', 'them:Jett', 4000 + n * 10], ['them:Reyna', 'me', 9000], ['us:Sova', 'them:Reyna', 11000]], n % 3 !== 0, n % 4 === 0 ? { plantMs: 3000 } : null));
  const a = JSON.stringify(run(ev).snap);
  const b = JSON.stringify(run(ev).snap);
  ok(a === b, 'the same events give the same rating, byte for byte');
}

console.log('\nMissing fields degrade');
{
  // No side: the man advantage alone, still a value.
  const noSide = run(round(1, null, [['me', 'them:Jett', 5000]], true));
  ok(noSide.snap.value > 6 && noSide.snap.timeline[0].label === 'First kill, 5v5', `no side still rates a kill (${noSide.snap.value})`);
  // No times: no trade can be seen.
  const noMs = run([{ kind: 'round', round: 1, side: 'attacking' }, { kind: 'kill', round: 1, killer: 'them:Jett', victim: 'me' },
    { kind: 'kill', round: 1, killer: 'us:Sova', victim: 'them:Jett' }, { kind: 'end', round: 1, won: false }]);
  ok(!noMs.snap.timeline.some((e) => /given back/.test(e.label || '')), 'no times, no trade given back');
  // An unplaced victim: the neutral swing, credited to the named killer.
  const r = createRating({ players: LOBBY });
  r.push({ kind: 'round', round: 1, side: 'attacking' });
  const o = r.push({ kind: 'kill', round: 1, ms: 5000, killer: 'me', victim: null });
  ok(Math.abs(o.swing - rating.W.NEUTRAL_SWING) < 1e-9, `a victim of no known side is worth the neutral swing (${o.swing})`);
  // An agent missing: nobody but the player is credited, and no place.
  const fr = rating.fromRecord({ rounds: [1, 2, 3].map((n) => ({ n, side: 'attacking', won: true,
    feed: [{ ms: 5000, by: 'me', on: 'enemy' }, { ms: 6000, by: 'enemy', on: 'mate' }] })) });
  ok(fr.rating && fr.rating.place === null && fr.rating.lobby === null && fr.rating.value > 6, `a feed without agents rates the player alone (${fr.rating && fr.rating.value})`);
  // Events with nothing in them, and garbage.
  const g = createRating();
  ok(g.push(null) === null && g.push('x') === null && g.value() === 6, 'garbage moves nothing');
  // The numbers standing from the screen win over the tracked ones.
  const s = createRating({ players: LOBBY });
  s.push({ kind: 'round', round: 1, side: 'attacking' });
  const alone = s.push({ kind: 'kill', round: 1, ms: 5000, killer: 'me', victim: 'them:Jett', alive: { us: 1, them: 3 } });
  ok(alone.label === 'First kill, 1v3', `the screen's numbers standing are used when given ("${alone.label}")`);
  // No result known: no result term.
  const nr = run([{ kind: 'round', round: 1, side: 'attacking' }, { kind: 'end', round: 1, won: null }]);
  ok(nr.snap.value === 6, 'a round with no known result moves nothing');
}

console.log('\nMatch length');
{
  const per = (n, queue) => {
    const ev = [];
    for (let i = 1; i <= n; i++) ev.push(...round(i, i % 2 ? 'attacking' : 'defending', i % 2 ? [['me', 'them:Jett', 5000]] : [], i % 2 === 1));
    return run(ev, { queue }).snap.value;
  };
  const v24 = per(24); const v30 = per(30); const v6 = per(6, 'Swiftplay'); const v6std = per(6);
  ok(v30 === v24, `overtime at the same play does not inflate (${v30} at 30 rounds, ${v24} at 24)`);
  ok(v6 > v6std && v6 < v24, `a Swiftplay counts its moves more, but stays under the full match at the same play (${v6} against ${v24})`);
  ok(rating.lengthOf('Swiftplay') === 9 && rating.lengthOf('Spike Rush') === 7 && rating.lengthOf('Competitive') === 24 && rating.lengthOf(null) === 24, 'the queue lengths');
  ok(rating.display(1e9, 24) <= 10 && rating.display(-1e9, 24) >= 3, 'the ends: never past 10, never under 3');
  ok(rating.display(0, 24) === 6, 'nothing done is 6.0');
}

console.log('\nThe saved shape and its version');
{
  const fr = rating.fromRecord({ rounds: [1, 2, 3, 4].map((n) => ({ n, side: 'defending', won: n !== 2,
    feed: [{ ms: 5000, by: 'me', on: 'enemy', ka: 'Jett', va: 'Sova' }, { ms: 7000, by: 'enemy', on: 'mate', ka: 'Reyna', va: 'Omen' }] })) });
  const s = fr.rating;
  ok(s.version === rating.VERSION && typeof s.value === 'number' && s.rounds === 4, `version ${s.version}, value ${s.value}, rounds ${s.rounds}`);
  ok(s.timeline.every((e) => ['round', 'ms', 'kind', 'delta', 'value', 'swing', 'label'].every((k) => k in e) && Object.keys(e).length === 7), 'each event keeps round, time, kind, delta, value after, swing and label');
  ok(s.lobby.every((p) => Object.keys(p).sort().join() === 'agent,me,side,value'), 'the lobby is side, agent, value and which is the player, nothing else');
  ok(s.place && s.place.of === s.lobby.length && rating.placeLine(s.place) === `${rating.ordinal(s.place.n)} of ${s.place.of}`, `the place (${rating.placeLine(s.place)})`);
  ok(rating.ordinal(1) === '1st' && rating.ordinal(2) === '2nd' && rating.ordinal(3) === '3rd' && rating.ordinal(11) === '11th' && rating.ordinal(10) === '10th', 'ordinals');
  const sw = rating.swings(s);
  ok(sw.gains.length && sw.gains.every((e) => e.swing > 0) && sw.losses.every((e) => e.swing < 0), 'the biggest gains and losses');
  // A saved rating is shown as saved, never counted again.
  const savedOld = { version: 0, value: 7.7, rounds: 4, timeline: [], place: null, lobby: null };
  const rv = { kind: 'valorant', rating: savedOld, rounds: [] };
  ok(rating.ratingOfReview(rv).rating === savedOld, 'a review with a saved rating keeps it, whatever the version');
  const screen = rating.ratingOfReview({ kind: 'valorant', rounds: [{ n: 1, result: 'won', riot: null }] });
  ok(screen.rating === null && screen.why === 'no-record' && /Riot's record/.test(screen.note), `a screen only review says what would rate it ("${screen.note}")`);
  ok(rating.ratingOfReview({ kind: 'lol', rounds: [] }).rating === null && rating.ratingOfReview({ kind: 'lol' }).note === null, 'League has none, and no note');
  ok(rating.fromRecord({ rounds: [{ n: 1, feed: [] }, { n: 2, feed: [] }] }).why === 'too-short', 'two rounds are too few');
  ok(rating.fromRecord({ rounds: [{ n: 1, feed: [] }, { n: 2 }, { n: 3, feed: [] }] }).why === 'no-feed', 'a round with no feed is no rating');
}

console.log('\nNo dash and no name');
{
  const src = require('fs').readFileSync(require.resolve('../src/shared/rating'), 'utf8');
  const DASHES = new RegExp('[' + String.fromCharCode(0x2013, 0x2014) + ']');
  ok(!DASHES.test(src), 'no em or en dash in rating.js');
  for (const f of ['src/renderer/review/rating-view.js', 'src/renderer/review/rating.css', 'docs/claude/rating.md', 'scripts/rating-fit.js', 'scripts/rating-calibrate.js']) {
    ok(!DASHES.test(require('fs').readFileSync(require('path').join(__dirname, '..', f), 'utf8')), `no em or en dash in ${f}`);
  }
  ok(DASHES.test('a' + String.fromCharCode(0x2014) + 'b'), 'the dash test matches a known dash');
}

console.log('\nThe real Abyss record');
{
  const g = require('./fixtures/riot-abyss-13-11.json');
  const rounds = g.perRound.map((r) => ({ n: r.n, side: r.side, won: r.won, plantMs: r.plantMs, feed: r.feed }));
  const fr = rating.fromRecord({ rounds, queue: g.queue, meAgent: g.me.agent }).rating;
  ok(fr.value >= 8 && fr.value <= 8.6, `the 31 kill, 21 death Jett rates 8.0 to 8.6 (${fr.value})`);
  ok(fr.place === null, 'a feed from before agents were in it gives no place');
  const again = rating.fromRecord({ rounds, queue: g.queue, meAgent: g.me.agent }).rating;
  ok(JSON.stringify(again) === JSON.stringify(fr), 'counted twice, the same');
  const last = fr.timeline[fr.timeline.length - 1];
  ok(last.value === fr.value, 'the timeline ends on the final value');
}

console.log('\nTrades: named, or Riot\'s own flag');
{
  // No agents: every enemy is the bare 'them', which must never read as the same player.
  const bare = createRating();
  bare.push({ kind: 'round', round: 1, side: 'attacking' });
  bare.push({ kind: 'kill', round: 1, ms: 5000, killer: 'them', victim: 'me', weapon: 'Vandal' });
  const notMine = bare.push({ kind: 'kill', round: 1, ms: 6000, killer: 'us', victim: 'them', weapon: 'Vandal' });
  bare.push({ kind: 'end', round: 1, won: false });
  ok(notMine.swing === 0 && bare.snapshot().timeline[0].label === 'Died first, not traded', 'a kill on some unnamed enemy is no trade of the player\'s death');
  // Riot's flag, where the killer has no key.
  const flagged = createRating();
  flagged.push({ kind: 'round', round: 1, side: 'attacking' });
  const d = flagged.push({ kind: 'kill', round: 1, ms: 5000, killer: 'them', victim: 'me', weapon: 'Vandal', traded: true });
  flagged.push({ kind: 'end', round: 1, won: false });
  ok(d.swing > -0.2 * rating.W.LOSS_WEIGHT && flagged.snapshot().timeline[0].label === 'Died first, traded', `Riot's traded flag gives part back with no keys (${d.swing})`);
  // A one for one trade adds nothing to the lobby's total.
  const sum = (snap) => snap.players.reduce((q, p) => q + p.net, 0);
  const t = run([{ kind: 'round', round: 1, side: 'attacking' }, { kind: 'kill', round: 1, ms: 5000, killer: 'them:Jett', victim: 'me', weapon: 'Vandal' },
    { kind: 'kill', round: 1, ms: 5800, killer: 'us:Sova', victim: 'them:Jett', weapon: 'Vandal' }]);
  const u = run([{ kind: 'round', round: 1, side: 'attacking' }, { kind: 'kill', round: 1, ms: 5000, killer: 'them:Jett', victim: 'me', weapon: 'Vandal' },
    { kind: 'kill', round: 1, ms: 9000 + 5000, killer: 'us:Sova', victim: 'them:Jett', weapon: 'Vandal' }]);
  ok(Math.abs(sum(t.snap) - sum(u.snap)) < 0.002, `the give back comes out of the trader's credit (lobby total ${sum(t.snap).toFixed(3)} traded, ${sum(u.snap).toFixed(3)} not)`);
  // The entry traded within a second every round, no kills.
  const ev = [];
  for (let n = 1; n <= 24; n++) ev.push(...round(n, n <= 12 ? 'attacking' : 'defending', [['them:Jett', 'me', 8000], ['us:Sova', 'them:Jett', 8900]], n % 2 === 0));
  const e = run(ev).snap.value;
  ok(e >= 4.4 && e <= 5, `an entry who dies first every round and is always traded rates 4.4 to 5 (${e})`);
}

console.log('\nRevives, the Clove ultimate, a team kill and a fall');
{
  const L = { players: LOBBY, meAgent: 'Clove' };
  const clove = createRating(L);
  clove.push({ kind: 'round', round: 1, side: 'attacking' });
  const died = clove.push({ kind: 'kill', round: 1, ms: 5000, killer: 'them:Jett', victim: 'me', weapon: 'Vandal' });
  const ran = clove.push({ kind: 'kill', round: 1, ms: 19000, killer: 'me', victim: 'me', weapon: 'Not Dead Yet' });
  ok(ran.swing === 0 && ran.label === 'Your ultimate ran out, no kill', `Clove's ultimate running out with no kill moves nothing ("${ran.label}")`);
  const plain = createRating(L);
  plain.push({ kind: 'round', round: 1, side: 'attacking' });
  const died2 = plain.push({ kind: 'kill', round: 1, ms: 5000, killer: 'them:Jett', victim: 'me', weapon: 'Vandal' });
  ok(clove.snapshot().net === plain.snapshot().net && died.swing === died2.swing, 'so the round costs what the first death cost');
  // Sage brings Sova back: Sova's gun kill 15 s after his death is the revive, credited to Sage.
  const s = createRating({ players: LOBBY, subject: 'us:Sage' });
  s.push({ kind: 'round', round: 1, side: 'attacking' });
  s.push({ kind: 'kill', round: 1, ms: 5000, killer: 'them:Jett', victim: 'us:Sova', weapon: 'Vandal' });
  const back = s.push({ kind: 'kill', round: 1, ms: 20000, killer: 'us:Sova', victim: 'them:Jett', weapon: 'Vandal' });
  ok(back.swing > 0.1 && /^Revived Sova, /.test(back.label), `the revive is Sage's, the chance it gave back (${back.swing}, "${back.label}")`);
  // A molly thrown before dying kills after the death: no revive.
  const m = createRating({ players: LOBBY });
  m.push({ kind: 'round', round: 1, side: 'attacking' });
  m.push({ kind: 'kill', round: 1, ms: 5000, killer: 'us:Sova', victim: 'them:Viper', weapon: 'Vandal' });
  m.push({ kind: 'kill', round: 1, ms: 8000, killer: 'them:Viper', victim: 'us:Omen', weapon: 'Snake Bite' });
  const after = m.push({ kind: 'kill', round: 1, ms: 9000, killer: 'me', victim: 'them:Jett', weapon: 'Vandal' });
  ok(after.label === 'Kill, 4v4', `an ability's kill by a dead player is no revive ("${after.label}")`);
  ok(rating.isGun('Vandal') && rating.isGun('knife') && !rating.isGun('Snake Bite') && !rating.isGun('Not Dead Yet'), 'a gun is the game data\'s weapon or the knife');
  // A teammate's molly, and a fall.
  const tk = run([{ kind: 'round', round: 1, side: 'attacking' }, { kind: 'kill', round: 1, ms: 5000, killer: 'me', victim: 'us:Sova', weapon: 'Incendiary' }]);
  ok(tk.outs[1].label === 'Killed a teammate' && tk.outs[1].swing < 0 && valueOf(tk.snap, 'us:Sova') === 6, 'a team kill is carried by the one who made it, not the one killed');
  const fall = run([{ kind: 'round', round: 1, side: 'attacking' }, { kind: 'kill', round: 1, ms: 5000, killer: 'me', victim: 'me', weapon: null }]);
  ok(fall.outs[1].label === 'Died to yourself' && fall.outs[1].swing < 0, 'a fall is the player\'s own');
}

console.log('\nPlant and round end shares');
{
  const p = run([{ kind: 'round', round: 1, side: 'attacking' }, { kind: 'kill', round: 1, ms: 5000, killer: 'me', victim: 'them:Jett', weapon: 'Vandal' },
    { kind: 'plant', round: 1, ms: 30000, by: 'us:Sova' }]);
  const gain = winChance(5, 4, true) - winChance(5, 4, false);
  const sova = p.snap.players.find((x) => x.key === 'us:Sova').net;
  const mine = p.snap.players.find((x) => x.key === 'me').net - p.outs[1].swing;
  ok(Math.abs(sova - gain * (rating.W.PLANTER_SHARE + (1 - rating.W.PLANTER_SHARE) / 5)) < 0.002 && Math.abs(mine - gain * (1 - rating.W.PLANTER_SHARE) / 5) < 0.002,
    `the planter takes half and the five alive share the rest (${sova.toFixed(3)}, ${mine.toFixed(3)})`);
  const defenders = p.snap.players.filter((x) => x.key.startsWith('them:') && x.key !== 'them:Jett').map((x) => x.net);
  ok(defenders.every((x) => Math.abs(x + gain / 4 * rating.W.LOSS_WEIGHT) < 0.002), 'the four defenders up share its cost');
  // A round won on the timer: the defenders still up share what was left.
  const t = run([{ kind: 'round', round: 1, side: 'defending' }, { kind: 'kill', round: 1, ms: 5000, killer: 'them:Jett', victim: 'us:Sova', weapon: 'Vandal' },
    { kind: 'end', round: 1, won: true }]);
  ok(t.outs[2].label === 'Round won, held to the timer' && t.outs[2].swing > 0.1, `held to the timer, the alive share what was left ("${t.outs[2].label}", ${t.outs[2].swing})`);
}

console.log('\nA live feed: repeats, disorder, the clock');
{
  const r = createRating({ players: LOBBY });
  r.push({ kind: 'round', round: 1, side: 'attacking', id: 'r1' });
  const a = r.push({ kind: 'kill', round: 1, ms: 5000, killer: 'me', victim: 'them:Jett', weapon: 'Vandal', id: 'k1' });
  const b = r.push({ kind: 'kill', round: 1, ms: 5000, killer: 'me', victim: 'them:Jett', weapon: 'Vandal', id: 'k1' });
  ok(b.ignored === 'repeated' && b.swing === 0 && r.value() === a.value, 'the same id twice moves nothing the second time');
  r.push({ kind: 'end', round: 1, won: true });
  r.push({ kind: 'round', round: 2, side: 'attacking' });
  r.push({ kind: 'kill', round: 2, ms: 3000, killer: 'me', victim: 'them:Jett', weapon: 'Vandal' });
  const late = r.push({ kind: 'end', round: 1, won: false });
  ok(late.ignored === 'stale' && r.snapshot().byRound.length === 1, 'an end for a round already over is ignored, no phantom round');
  const again = r.push({ kind: 'round', round: 2, side: 'defending' });
  const next = r.push({ kind: 'kill', round: 2, ms: 6000, killer: 'me', victim: 'them:Reyna', weapon: 'Vandal' });
  ok(again.ignored === 'same round' && next.label === 'Kill, 5v4', `the round's event again changes nothing standing ("${next.label}")`);
  // The spike's time ran out with no side known and no planter: nothing moves.
  const u = createRating({ players: LOBBY });
  u.push({ kind: 'round', round: 1, side: null });
  u.push({ kind: 'plant', round: 1, ms: 30000, by: null });
  const k = u.push({ kind: 'kill', round: 1, ms: 30000 + 50000, killer: 'me', victim: 'them:Jett', weapon: 'Vandal' });
  ok(k.swing === 0 && k.label === 'Kill after the round was decided', `a kill after the spike's time moves nothing, whatever the side ("${k.label}")`);
}

console.log('\nA subject on the other side, and the queues');
{
  const them = createRating({ players: LOBBY, subject: 'them:Jett' });
  them.push({ kind: 'round', round: 1, side: 'attacking' });
  const k = them.push({ kind: 'kill', round: 1, ms: 5000, killer: 'them:Jett', victim: 'me', weapon: 'Vandal' });
  const e = them.push({ kind: 'end', round: 1, won: true });
  ok(k.label === 'First kill, 5v5' && e.swing > 0 && them.snapshot().byRound[0].won === true, 'a subject on the other team: its kill, and its round won when won is its own');
  ok(rating.lengthOf('Replication') === 9 && rating.lengthOf('onefa') === 9, 'Replication is first to five, nine rounds at most');
}

console.log('\nThe rounds, named');
{
  const ace = run(round(1, 'attacking', THEM.map((v, i) => ['me', v, 5000 + i * 3000]), true)).snap.byRound[0];
  ok(ace.label === 'Ace', `an ace ("${ace.label}")`);
  const triple = run(round(1, 'attacking', [['me', 'them:Jett', 4000], ['me', 'them:Reyna', 6000], ['me', 'them:Viper', 8000], ['them:Cypher', 'me', 12000]], false)).snap.byRound[0];
  ok(triple.label === 'Triple kill with the opening kill, then died', `a triple, then a death ("${triple.label}")`);
  const clutch = run(round(1, 'defending', [['them:Jett', 'us:Sova', 3000], ['them:Jett', 'us:Omen', 4000], ['them:Reyna', 'us:Sage', 5000], ['them:Reyna', 'us:Raze', 6000],
    ['me', 'them:Jett', 20000], ['me', 'them:Reyna', 25000]], true)).snap.byRound[0];
  ok(clutch.label === '2 kills, won a 1v5', `a clutch ("${clutch.label}")`);
  const plant = run([{ kind: 'round', round: 1, side: 'attacking' }, { kind: 'kill', round: 1, ms: 4000, killer: 'me', victim: 'them:Jett', weapon: 'Vandal' },
    { kind: 'plant', round: 1, ms: 30000, by: 'me' }, { kind: 'end', round: 1, won: true }]).snap.byRound[0];
  ok(plant.label === 'Opening kill and the plant', `an opening kill and the plant ("${plant.label}")`);
  const save = run(round(1, 'attacking', [['them:Jett', 'us:Sova', 3000], ['them:Jett', 'us:Omen', 4000], ['them:Reyna', 'us:Sage', 5000], ['them:Reyna', 'us:Raze', 6000]], false)).snap.byRound[0];
  ok(save.label === 'Saved the last life', `a save ("${save.label}")`);
  const rr = run([...round(1, 'attacking', [['me', 'them:Jett', 4000]], true), ...round(2, 'attacking', [['them:Jett', 'me', 4000]], false),
    ...round(3, 'attacking', [['me', 'them:Jett', 4000], ['me', 'them:Reyna', 5000]], true)]);
  const sw = rating.swings(rating.fromRecord({ rounds: [] }).rating || { byRound: rr.snap.byRound });
  const shown = sw.gains.map((g) => g.delta);
  ok(shown.every((d, i) => i === 0 || d <= shown[i - 1]) && sw.losses.length === 1, `the round swings read in the order the page shows them (${shown.join(' ')})`);
}

console.log(`\n${fails ? fails + ' of ' + checks + ' failed' : 'all ' + checks + ' rating checks passed'}`);
process.exit(fails ? 1 : 0);
