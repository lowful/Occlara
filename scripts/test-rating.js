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
  ok(t.snap.value >= u.snap.value + 0.3, `a traded entry rates above an untraded one (${t.snap.value} against ${u.snap.value})`);
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
  const kept = rating.ratingOfReview(rv).rating;
  ok(kept.version === 0 && kept.value === 7.7 && kept.rounds === 4, 'a review with a saved rating keeps it, whatever the version');
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
  // The trader keeps the whole swing of the trade kill, the give back added on its own (round 3).
  const sova = (snap) => snap.players.find((p) => p.key === 'us:Sova').net;
  const charged = Math.abs(t.outs[1].swing);
  const back = (charged - rating.W.DEATH_FLOOR * rating.W.LOSS_WEIGHT) * rating.W.TRADE_BACK;
  ok(Math.abs(sova(t.snap) - sova(u.snap)) < 0.002 && Math.abs(sum(t.snap) - sum(u.snap) - back) < 0.002,
    `the trader keeps the whole kill and the give back is added on its own (Sova ${sova(t.snap).toFixed(3)} traded, ${sova(u.snap).toFixed(3)} not)`);
  // The entry traded within a second every round, no kills.
  const ev = [];
  for (let n = 1; n <= 24; n++) ev.push(...round(n, n <= 12 ? 'attacking' : 'defending', [['them:Jett', 'me', 8000], ['us:Sova', 'them:Jett', 8900]], n % 2 === 0));
  const e = run(ev).snap.value;
  // Round 3: a traded death still costs the life (DEATH_FLOOR), so a zero kill entry stays low.
  ok(e >= 3.4 && e < 4.5, `an entry who dies first every round, always traded, no kills, rates 3.4 to 4.4 (${e})`);
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
  // 9.1 (the AI audit's Split round 12 shape): left last against two, one
  // kill, killed, the spike winning the round after. No "won a 1v2": the
  // round is the team's, not a clutch of the subject's.
  const dead = run(round(1, 'attacking', [['them:Jett', 'us:Sova', 3000], ['them:Jett', 'us:Omen', 4000], ['them:Reyna', 'us:Sage', 5000], ['them:Reyna', 'us:Raze', 6000],
    ['me', 'them:Jett', 20000], ['them:Reyna', 'me', 26000]], true, { plantMs: 12000 })).snap.byRound[0];
  ok(!/won a 1v/i.test(dead.label) && /died/i.test(dead.label), `a clutch the subject died in is not won by them ("${dead.label}")`);
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

console.log('\nRound 3: who revives, the spike settled, trades, and the names');
{
  // 1. The player is the Sage who revives.
  const sage = createRating({ players: ['me', 'us:Sova', 'us:Omen', 'us:Killjoy', 'us:Jett', ...THEM], meAgent: 'Sage' });
  sage.push({ kind: 'round', round: 1, side: 'attacking' });
  sage.push({ kind: 'kill', round: 1, ms: 1000, killer: 'them:Reyna', victim: 'us:Jett', weapon: 'Vandal' });
  const res = sage.push({ kind: 'kill', round: 1, ms: 9000, killer: 'us:Jett', victim: 'them:Reyna', weapon: 'Vandal' });
  ok(res.swing > 0.15 && /^Revived Jett, /.test(res.label), `the player as Sage is credited the revive ("${res.label}", ${res.swing})`);
  // 7. Clove's own ultimate is hers, a Sage up or not.
  const clove = createRating({ players: [...LOBBY.filter((k) => k !== 'us:Sage'), 'us:Sage'], meAgent: 'Clove' });
  clove.push({ kind: 'round', round: 1, side: 'attacking' });
  clove.push({ kind: 'kill', round: 1, ms: 1000, killer: 'them:Jett', victim: 'me', weapon: 'Vandal' });
  const back = clove.push({ kind: 'kill', round: 1, ms: 5000, killer: 'me', victim: 'them:Reyna', weapon: 'Vandal' });
  const sageNet = clove.snapshot().players.find((p) => p.key === 'us:Sage').net;
  ok(back.swing > 0.3 && Math.abs(sageNet) < 0.03 && /back in the round$/.test(back.label), `Clove's own revive is Clove's, not a living Sage's (${back.swing}, Sage ${sageNet}, "${back.label}")`);
  // 2. The spike goes off on a thrown 1v0: settled the same whether it kills the player or not.
  const spike = (tail) => {
    const r = createRating({ players: LOBBY });
    r.push({ kind: 'round', round: 1, side: 'defending' });
    [['them:Jett', 'us:Sova', 1000], ['them:Jett', 'us:Omen', 2000], ['them:Jett', 'us:Sage', 3000], ['them:Jett', 'us:Raze', 4000],
      ['me', 'them:Reyna', 5000], ['me', 'them:Viper', 6000], ['me', 'them:Cypher', 7000]].forEach(([k, v, ms]) => r.push({ kind: 'kill', round: 1, ms, killer: k, victim: v, weapon: 'Vandal' }));
    r.push({ kind: 'plant', round: 1, ms: 20000, by: 'them:Jett' });
    r.push({ kind: 'kill', round: 1, ms: 24000, killer: 'me', victim: 'them:Jett', weapon: 'Vandal' });
    r.push({ kind: 'kill', round: 1, ms: 25000, killer: 'me', victim: 'them:Fade', weapon: 'Vandal' });
    for (const e of tail) r.push(e);
    r.push({ kind: 'end', round: 1, won: false });
    return r.snapshot();
  };
  const lived = spike([]);
  const killed = spike([{ kind: 'kill', round: 1, ms: 65500, killer: 'me', victim: 'me', weapon: null }]);
  const nobody = spike([{ kind: 'kill', round: 1, ms: 65500, killer: null, victim: 'me', weapon: null }]);
  ok(lived.value === killed.value && killed.value === nobody.value && lived.byRound[0].label === 'Ace' && killed.byRound[0].label === 'Ace',
    `an ace thrown by no defuse rates the same, killed by the spike or not (${lived.value}, ${killed.value}, ${nobody.value})`);
  const rec = rating.eventsOfRound({ n: 1, side: 'attacking', won: true, plantMs: 30000, feed: [{ ms: 5000, by: 'me', on: 'enemy', ka: 'Jett', va: 'Sova' }] });
  ok(rec[rec.length - 1].ms === 30000 + rating.W.SPIKE_MS + 1, 'a round the spike won ends at the spike\'s time, so the clock settles it');
  // 3. Of two deaths to one killer, the latest is the traded one; Riot's flag with no times.
  const two = createRating({ players: LOBBY });
  two.push({ kind: 'round', round: 1, side: 'attacking' });
  two.push({ kind: 'kill', round: 1, ms: 1000, killer: 'them:Jett', victim: 'us:Sova', weapon: 'Vandal' });
  two.push({ kind: 'kill', round: 1, ms: 3000, killer: 'them:Jett', victim: 'us:Omen', weapon: 'Vandal' });
  two.push({ kind: 'kill', round: 1, ms: 4000, killer: 'me', victim: 'them:Jett', weapon: 'Vandal' });
  const nets = two.snapshot().players;
  ok(nets.find((p) => p.key === 'us:Omen').net > nets.find((p) => p.key === 'us:Sova').net + 0.05, 'the latest of two deaths to one killer is the one traded');
  const noMs = rating.fromRecord({ rounds: [1, 2, 3].map((n) => ({ n, side: 'attacking', won: false, traded: true,
    feed: [{ by: 'enemy', on: 'me', ka: 'Jett' }, { by: 'mate', on: 'enemy', ka: 'Sova', va: 'Jett' }] })) }).rating;
  ok(noMs.byRound.every((r) => r.label === 'Died first, traded'), 'Riot\'s traded flag counts when the killer is named but the feed has no times');
  // The trader keeps the kill even when the death it avenged cost more.
  const big = createRating({ players: LOBBY });
  big.push({ kind: 'round', round: 1, side: 'attacking' });
  big.push({ kind: 'kill', round: 1, ms: 1000, killer: 'them:Jett', victim: 'us:Sova', weapon: 'Vandal' });
  big.push({ kind: 'kill', round: 1, ms: 1100, killer: 'them:Reyna', victim: 'us:Omen', weapon: 'Vandal' });
  big.push({ kind: 'kill', round: 1, ms: 1200, killer: 'them:Viper', victim: 'us:Sage', weapon: 'Vandal' });
  big.push({ kind: 'kill', round: 1, ms: 1300, killer: 'them:Cypher', victim: 'us:Raze', weapon: 'Vandal' });
  const tk = big.push({ kind: 'kill', round: 1, ms: 2000, killer: 'me', victim: 'them:Cypher', weapon: 'Vandal' });
  ok(tk.swing > 0 && /^Traded a teammate/.test(tk.label), `a trade kill always keeps its own swing (${tk.swing})`);
  // 5. Names.
  const nm = (events) => run([{ kind: 'round', round: 1, side: 'attacking' }, ...events.map(([k, v, ms, w]) => ({ kind: 'kill', round: 1, ms, killer: k, victim: v, weapon: w === undefined ? 'Vandal' : w })),
    { kind: 'end', round: 1, won: true }], { meAgent: 'Clove' }).snap.byRound[0].label;
  ok(nm([['them:Jett', 'me', 1000], ['me', 'them:Jett', 4000], ['me', 'them:Reyna', 5000], ['me', 'them:Viper', 6000], ['me', 'them:Cypher', 7000], ['me', 'them:Fade', 8000]]) === 'Ace',
    'died, back in the round, then an ace reads "Ace", the death cleared by the revive');
  ok(nm([['me', 'them:Jett', 1000], ['them:Reyna', 'me', 2000], ['me', 'me', 16000, 'Not Dead Yet']]) === 'Opening kill, then died', 'Clove: a kill, a death and the ultimate running out keeps the death');
  ok(nm([['us:Sova', 'me', 1000, 'Incendiary']]) === 'Killed by a teammate' && nm([['me', 'me', 1000, null]]) === 'Died to yourself', 'a team kill and a fall say so, never "Died first, not traded"');
  ok(nm([['me', 'us:Sova', 1000, 'Incendiary']]) === 'Killed a teammate', 'killing a teammate is in the name');
  // 6. A kill with no ms keeps its place in the feed, and the order is one order.
  const ev = rating.eventsOfRound({ n: 1, side: 'attacking', won: true, plantMs: 3000,
    feed: [{ ms: 5000, by: 'me', on: 'enemy' }, { ms: null, by: 'mate', on: 'enemy' }, { ms: 1000, by: 'mate', on: 'enemy' }] });
  ok(ev.slice(1, -1).map((e) => `${e.kind}@${e.ms}`).join(' ') === 'kill@1000 plant@3000 kill@5000 kill@null', `a kill with no time follows the kill before it in the feed (${ev.slice(1, -1).map((e) => `${e.kind}@${e.ms}`).join(' ')})`);
  // 9. No semicolon is ever saved in a label.
  const sv = createRating({ players: LOBBY, meAgent: 'Clove' });
  sv.push({ kind: 'round', round: 1, side: 'attacking' });
  sv.push({ kind: 'kill', round: 1, ms: 1000, killer: 'them:Jett', victim: 'me', weapon: 'Vandal' });
  const both = sv.push({ kind: 'kill', round: 1, ms: 5000, killer: 'me', victim: 'them:Reyna', weapon: 'Vandal' });
  ok(!/;/.test(both.label) && /, back in the round$/.test(both.label), `a revive and a kill in one line, joined by a comma ("${both.label}")`);
  // 10. Overtime: the value never moves without an event, and a positive round reads positive.
  const ot = createRating({ players: LOBBY });
  for (let n = 1; n <= 24; n++) for (const e of round(n, n % 2 ? 'attacking' : 'defending', [['me', 'them:Jett', 4000]], true)) ot.push(e);
  const at24 = ot.value();
  const open25 = ot.push({ kind: 'round', round: 25, side: 'attacking' });
  ok(open25.delta === 0 && ot.value() === at24, `opening round 25 moves nothing (${at24} then ${ot.value()})`);
  for (const e of round(25, 'attacking', [['me', 'them:Jett', 4000]], true).slice(1)) ot.push(e);
  ok(ot.snapshot().byRound[24].delta >= 0, `a winning overtime round with an opening kill never reads as a loss (${ot.snapshot().byRound[24].delta})`);
}

console.log('\nA damaged saved rating');
{
  const vr = require('../src/shared/valorant-review');
  const base = { kind: 'valorant', game: {}, rounds: [], rating: { version: 1, value: 7, rounds: 3, timeline: [], place: { n: 1, of: 2 },
    lobby: [{ side: 'us', agent: 'Jett', value: 'bad', me: true }, { side: 'them', agent: 'Sova', value: 6, me: false }] } };
  let shown = null;
  try { shown = vr.served(base); } catch (e) { shown = { threw: e.message }; }
  ok(shown && !shown.threw && shown.ratingView && shown.ratingView.lobby === null, `a lobby value that is no number never fails the review (${JSON.stringify(shown && (shown.threw || shown.ratingView && shown.ratingView.shown))})`);
  ok(vr.served({ ...base, rating: { ...base.rating, value: 99, lobby: null } }).ratingView.shown === '100', 'a saved 99 is shown as 100, the top of the 100 scale');
  ok(vr.served({ ...base, rating: { version: 1, value: 'x' } }).ratingView.value === null, 'a saved value that is no number is no saved rating, and a review with no feed says so');
  ok(rating.cleanSaved({ version: 1, value: 7, timeline: [{ round: 1, value: 7, delta: 0.3, swing: 0.2, label: 'A; B', kind: 'kill' }] }).timeline[0].label === 'A, B', 'a semicolon saved before is shown as a comma');
}

console.log('\nThe bottom of the scale: the archetypes in order');
{
  const { A, balanced } = require('./fixtures/rating-archetypes');
  const v = {};
  const place = {};
  for (const [name, rounds] of Object.entries(A)) {
    const r = rating.fromRecord({ rounds, meAgent: 'Reyna', queue: 'competitive' }).rating;
    v[name] = r.value; place[name] = r.place.n;
  }
  const avg = v['average player (12-12)'];
  ok(v['AFK, not flagged (3-13)'] <= avg - 1.5 && v['AFK, not flagged (3-13)'] < 5, `an AFK Riot did not flag, 0/13, rates clearly under a 12/12 (${v['AFK, not flagged (3-13)']} against ${avg})`);
  ok(v['bottom frag, won (13-7)'] <= avg - 1.5 && v['bottom frag, won (13-7)'] < 5, `a 3/20 bottom frag too (${v['bottom frag, won (13-7)']})`);
  ok(place['entry, always traded (13-11)'] > 2 && v['entry, always traded (13-11)'] < avg, `a 12/24 entry, always traded, is not second and is under the 12/12 (${v['entry, always traded (13-11)']}, ${place['entry, always traded (13-11)']} of 10)`);
  ok(v['hard carry (13-9)'] >= 9 && v['top frag, lost (10-13)'] >= 9 && v['1v4 clutch hero, lost (9-13)'] >= 7 && v['sentinel, survives, defuses (13-11)'] >= 8,
    `the top stays: a carry ${v['hard carry (13-9)']}, a top frag who lost ${v['top frag, lost (10-13)']}, a clutch hero ${v['1v4 clutch hero, lost (9-13)']}, a sentinel ${v['sentinel, survives, defuses (13-11)']}`);
  ok(v['lurker, late kills (13-11)'] > v['baiter, exit kills (12-12)'] + 2, `impact over volume: 18 timely kills over 18 exit kills (${v['lurker, late kills (13-11)']} against ${v['baiter, exit kills (12-12)']})`);
  const b = rating.fromRecord({ rounds: balanced(24), meAgent: 'Reyna', queue: 'competitive' }).rating;
  const vals = b.lobby.map((p) => p.value);
  const mean = vals.reduce((q, x) => q + x, 0) / vals.length;
  ok(mean >= 6 && mean <= 6.6 && Math.min(...vals) >= 5.4 && Math.max(...vals) <= 7.2, `a balanced lobby sits at 6.0 to 6.6 (${mean.toFixed(2)}, ${Math.min(...vals)} to ${Math.max(...vals)})`);
}

console.log(`\n${fails ? fails + ' of ' + checks + ' failed' : 'all ' + checks + ' rating checks passed'}`);
process.exit(fails ? 1 : 0);
