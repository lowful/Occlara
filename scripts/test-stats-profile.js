'use strict';

/**
 * Stats' "Your numbers", "Maps" and "Acts" (src/renderer/shared/stats-profile.js):
 * the profile's averages, the match list by map and each act, read safely.
 * Missing, partial and nonsense data is none, never a row of zeros or a throw.
 *
 * Run: npm run test:statsprofile
 */
const path = require('path');
const SP = require(path.join(__dirname, '..', 'src', 'renderer', 'shared', 'stats-profile.js'));

let failed = 0;
function ok(cond, what, detail) {
  if (cond) console.log('  ok   ' + what);
  else { failed++; console.log('  FAIL ' + what + (detail ? '  (' + detail + ')' : '')); }
}
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

console.log('Your numbers:');
{
  const n = SP.numbers({ matches: 25, kd: 1.08, acs: 214, adr: 142, kpr: 0.74, dpr: 0.69, apr: 0.31, headshotPct: 22, bodyshotPct: 70 });
  ok(n && n.matches === 25 && n.acs === 214 && n.kd === 1.08 && n.adr === 142 && n.kpr === 0.74 && n.dpr === 0.69 && n.apr === 0.31,
    'a full profile keeps every average', JSON.stringify(n));
  ok(n && same(n.shots, { head: 22, body: 70, legs: 8 }), 'the shot split is head, body and the rest legs', JSON.stringify(n && n.shots));
  ok(SP.numbers(null) === null && SP.numbers(undefined) === null && SP.numbers('x') === null, 'no profile is none');
  // An older server's unrated fallback: { kd: 0, winRate: 0, headshotPct: 0 } and no match counted.
  ok(SP.numbers({ kd: 0, winRate: 0, headshotPct: 0, topAgent: 'Unknown', topAgents: [] }) === null, 'a profile with no match counted is none');
  const noShots = SP.numbers({ matches: 3, kd: 0.9, acs: 180, adr: 120, kpr: 0.6, dpr: 0.7, apr: 0.2, headshotPct: 0, bodyshotPct: 0 });
  ok(noShots && noShots.shots === null && noShots.acs === 180, 'no shot counted is no split, the rest stays');
  const zeroRounds = SP.numbers({ matches: 2, kd: 1.5, acs: 0, adr: 0, kpr: 0, dpr: 0, apr: 0, headshotPct: 30, bodyshotPct: 60 });
  ok(zeroRounds && zeroRounds.acs === null && zeroRounds.kpr === null && zeroRounds.kd === 1.5, 'rounds all zero: the per round numbers are none, not zeros');
  const junk = SP.numbers({ matches: 4, kd: 'x', acs: NaN, adr: -3, headshotPct: 140, bodyshotPct: 20 });
  ok(junk === null, 'nothing a number: none', JSON.stringify(junk));
  const partial = SP.numbers({ matches: 4, kd: 1.2 });
  ok(partial && partial.kd === 1.2 && partial.acs === null && partial.shots === null, 'a partial profile keeps what it has');
  ok(SP.numbers({ matches: 5, acs: 200, headshotPct: 60, bodyshotPct: 60 }).shots === null, 'a split above 100% is no split');
}

console.log('Maps:');
{
  const m = (map, result, kills, deaths, acs) => ({ map, result, kills, deaths, acs });
  const rows = SP.byMap([
    m('Ascent', 'Victory', 20, 10, 250), m('Bind', 'Defeat', 10, 20, 150), m('Ascent', 'Defeat', 15, 15, 210),
    m('Ascent', 'Draw', 5, 0, 100), m('Unknown', 'Victory', 1, 1, 1), m('', 'Victory', 1, 1, 1), null, 'x',
    { map: 'Lotus', result: 'Victory' },
  ]);
  ok(same(rows.map((r) => r.map), ['Ascent', 'Lotus', 'Bind']), 'most played first, a tie by wins, Unknown and blank maps left out', rows.map((r) => r.map).join());
  const asc = rows[0];
  ok(asc.played === 3 && asc.won === 1 && asc.kd === 1.6 && asc.acs === 187, 'a map sums its matches: a draw played, not won', JSON.stringify(asc));
  const lotus = rows.find((r) => r.map === 'Lotus');
  ok(lotus.kd === null && lotus.acs === null && lotus.won === 1, 'a match without numbers counts, its numbers are none');
  ok(same(SP.byMap(null), []) && same(SP.byMap({}), []), 'no list is no rows');
  ok(SP.byMap([m('Haven', 'Victory', 12, 0, 300)])[0].kd === 12, 'no death: K/D is the kills, as the server writes it');
  ok(rows.every((r) => !('name' in r) && !('tag' in r)), 'a row carries a map and numbers, never a name');
}

console.log('Top agents from the match list:');
{
  const m = (agent, result, kills, deaths, acs) => ({ agent, result, kills, deaths, acs });
  const rows = SP.agents([
    m('Jett', 'Victory', 20, 10, 250), m('Jett', 'Defeat', 10, 20, 150), m('Sova', 'Victory', 15, 15, 210),
    m('Unknown', 'Victory', 1, 1, 1), m('', 'Victory', 1, 1, 1), null, 'x', { agent: 'Omen', result: 'Defeat' },
  ]);
  ok(same(rows.map((r) => r.name), ['Jett', 'Sova', 'Omen']), 'most played first, a tie by win rate, Unknown and blank left out', rows.map((r) => r.name).join());
  ok(same(rows[0], { name: 'Jett', matches: 2, pct: 50, winRate: 50, kd: 1, acs: 200 }), 'the profile\'s topAgents shape', JSON.stringify(rows[0]));
  const omen = rows.find((r) => r.name === 'Omen');
  ok(omen.kd === null && omen.acs === null, 'a number no match carried is none, never a zero');
  ok(same(SP.agents(null), []) && same(SP.agents([{ map: 'Bind' }]), []), 'no agent named is no rows');
  const many = SP.agents(['A', 'B', 'C', 'D', 'E', 'F', 'G'].map((a) => m(a + 'gent', 'Victory', 1, 1, 100)));
  ok(many.length === 5, 'five at most, as the server lists them');
  ok(rows.every((r) => !('tag' in r) && !('player' in r)), 'an agent and numbers, never a player');
}

console.log('Acts:');
{
  const rows = SP.acts([
    { season: 'e8a3', wins: 10, games: 20, endTier: 'Gold 2' },
    { season: 'e9a1', wins: 30, games: 50, endTier: 'Platinum 1' },
    { season: 'e9a2', wins: null, games: null, endTier: 'Platinum 2' },
    { season: 'e9a3', wins: 4, games: 3, endTier: null },
    { season: null, wins: 1, games: 2 },
    { season: '<b>', wins: 1, games: 2, endTier: 'Gold 1' },
    { season: 'e9a4', wins: 5, games: 9, endTier: '<img>' },
  ]);
  ok(same(rows.map((r) => r.season), ['E9A4', 'E9A2', 'E9A1', 'E8A3']), 'newest first, uppercased, junk seasons and empty acts left out', rows.map((r) => r.season).join());
  ok(same(rows[2], { season: 'E9A1', rank: 'Platinum 1', wins: 30, games: 50, winRate: 60 }), 'an act: its rank, wins, games and win rate', JSON.stringify(rows[2]));
  ok(rows[1].rank === 'Platinum 2' && rows[1].wins === null && rows[1].winRate === null, 'an act with a rank and no games keeps the rank');
  ok(rows[0].rank === null && rows[0].wins === 5, 'a rank that is not a tier name is none');
  ok(same(SP.acts(undefined), []) && same(SP.acts('x'), []), 'no acts is no rows');
}

console.log(failed ? `\n${failed} failed` : '\nall passed');
process.exit(failed ? 1 : 0);
