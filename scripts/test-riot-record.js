'use strict';

/**
 * Riot's round record beyond the kill feed (8.8): where each death happened,
 * the team's buy, the nearest teammate at the death, the player's ability
 * casts, and Riot's AFK flags. HenrikDev's v4 match record sends all of it
 * on every link; until 8.8 riot-rounds.js only logged its key names.
 *
 * Every field is optional. A record without it, a server from before and a
 * client from before get exactly the rounds they always did, and no player's
 * name, tag or id is in anything this sends. The payload below is synthetic,
 * in HenrikDev's documented v4 shape, with invented names so the privacy
 * checks have something to look for. No call leaves this process.
 *
 * Run: npm run test:riotrecord
 */

const riotRounds = require('../server/services/riot-rounds');
const matchReview = require('../server/services/match-review');
const chatPrompt = require('../server/services/chat-prompt');
const verify = require('../src/shared/valorant-verify');
const review = require('../src/shared/valorant-review');
const insights = require('../src/shared/insights');
const riotReview = require('../src/shared/riot-review');
const chatContext = require('../src/shared/chat-context');
const DATA = require('../src/shared/valorant-data.generated.json');

let fails = 0;
let checks = 0;
const ok = (cond, what) => {
  checks++;
  if (!cond) { fails++; console.log(`FAIL  ${what}`); } else console.log(`ok    ${what}`);
};

const DASHES = new RegExp(`[${String.fromCharCode(0x2013)}${String.fromCharCode(0x2014)}]`);

// ── A synthetic v4 match on Ascent ──────────────────────────────────────────
// World points from Ascent's own callouts through the inverse of the map's
// transform, so a place read back is the callout it was made from.
const geo = DATA.mapGeometry.ascent;
const T = geo.transform;
const at = (name, dx = 0, dy = 0) => {
  const c = geo.callouts.find((x) => x.n === name);
  return { x: (c.y - T.yScalarToAdd) / T.yMultiplier + dx, y: (c.x - T.xScalarToAdd) / T.xMultiplier + dy };
};

const ME = { puuid: 'p-me', name: 'Lowfulwyrm', tag: 'QX7', team: 'Red' };
const MATES = [1, 2, 3, 4].map((i) => ({ puuid: `p-m${i}`, name: `Brindlecap${i}`, tag: `MT${i}`, team: 'Red' }));
const FOES = [1, 2, 3, 4, 5].map((i) => ({ puuid: `p-e${i}`, name: `Zephyrine${i}`, tag: `EN${i}`, team: 'Blue' }));
const AGENTS = ['Jett', 'Omen', 'Sova', 'Killjoy', 'Fade', 'Reyna', 'Brimstone', 'Skye', 'Cypher', 'Raze'];
const ALL = [ME, ...MATES, ...FOES];

// The team's economy each round: [loadout a player, remaining a player], or
// null where the record has the rows but no economy, or a number of rows.
const ECON = [
  [800, 0],      // 1  pistol, the first round of the first half
  [400, 3000],   // 2  eco: under 1000 a player
  [2400, 200],   // 3  force: between, under 1000 left
  [2400, 2500],  // 4  half: between, money kept
  [4200, 600],   // 5  full
  [3900, 100],   // 6  full at exactly FULL_MIN
  [3899, 1000],  // 7  half: one credit under FULL_MIN, exactly FORCE_LEFT_MAX left
  [1000, 999],   // 8  force: exactly ECO_MAX is no eco, one credit under FORCE_LEFT_MAX left
  [999, 0],      // 9  eco: one under ECO_MAX
  'two',         // 10 two teammates' rows only: no buy
  [4400, 300],   // 11 full
  [4400, 300],   // 12 full
  [800, 0],      // 13 pistol, the first round of the second half
  [4400, 300],   // 14 full
];
const WON = [true, false, true, false, false, true, false, true, true, false, false, false, true, false];

function statsFor(n) {
  const e = ECON[n - 1];
  return ALL.map((p, i) => {
    const ours = p.team === 'Red';
    const row = { player: { ...p } };
    if (ours && e === 'two' && i > 1) return row;
    // The enemy always carries 5000: a buy that mixed the teams would read full.
    // Each teammate's gun goes with the loadout, as in a real record: a rifle
    // on a full buy, an SMG between, a Classic on an eco or a pistol round.
    const lv = e === 'two' ? 4000 : e[0];
    const gun = lv >= 3900 ? 'Vandal' : lv >= 1000 ? 'Spectre' : 'Classic';
    row.economy = ours ? { loadout_value: lv, remaining: e === 'two' ? 0 : e[1], weapon: { id: 'w', name: gun, type: 'Weapon' } }
      : { loadout_value: 5000, remaining: 0 };
    if (p === ME) {
      row.ability_casts = { grenade: 1, ability_1: 0, ability_2: 2, ultimate: null };
      row.was_afk = n === 7;
      row.stayed_in_spawn = n === 8;
      row.received_penalty = false;
    }
    return row;
  });
}

const near = (p, loc) => ({ player: { ...p }, view_radians: 1.2, location: loc });
function kill(round, ms, killer, victim, loc, around) {
  return { round, time_in_round_in_ms: ms, killer: { ...killer }, victim: { ...victim },
    weapon: { id: 'w', name: 'Vandal', type: 'Weapon' }, location: loc, player_locations: around, assistants: [] };
}

function payload({ queue = 'competitive', strip = false } = {}) {
  const rounds = ECON.map((_, i) => ({ winning_team: WON[i] ? 'Red' : 'Blue', result: 'Elimination',
    plant: null, defuse: null, stats: statsFor(i + 1) }));
  const bElbow = at('B Main');
  const aMain = at('A Main');
  const kills = [
    // Round 2: the player dies at B Main, a teammate 800 units off: close.
    kill(1, 20000, FOES[0], ME, bElbow, [near(MATES[0], { x: bElbow.x + 800, y: bElbow.y }), near(FOES[0], aMain), near(MATES[1], aMain)]),
    // Round 3: dies at A Main, the nearest teammate 3000 units off: far.
    kill(2, 31000, FOES[1], ME, aMain, [near(MATES[0], { x: aMain.x, y: aMain.y + 3000 }), near(MATES[2], { x: aMain.x + 4000, y: aMain.y })]),
    // Round 4: the player kills at Mid Courtyard, and an enemy kills a teammate.
    kill(3, 15000, ME, FOES[1], at('Mid Courtyard'), [near(ME, at('Mid Top'))]),
    kill(3, 40000, FOES[2], MATES[0], at('A Site'), []),
    // Round 5: dies with no player_locations: no distance.
    { round: 4, time_in_round_in_ms: 22000, killer: { ...FOES[2] }, victim: { ...ME }, weapon: { name: 'Phantom' }, location: at('Mid Link') },
    // Round 6: dies off the map, far from every callout: no place.
    kill(5, 25000, FOES[3], ME, { x: 900000, y: 900000 }, [near(MATES[1], { x: 900100, y: 900000 })]),
    // Round 7 (Riot's AFK): dies untraded.
    kill(6, 18000, FOES[4], ME, at('A Lobby'), [near(MATES[1], at('Mid Top'))]),
    // Round 9: the player is the last one alive (four teammates down first), so nobody is close.
    kill(8, 10000, FOES[0], MATES[0], at('Mid Top'), []),
    kill(8, 11000, FOES[0], MATES[1], at('Mid Top'), []),
    kill(8, 12000, FOES[0], MATES[2], at('Mid Top'), []),
    kill(8, 13000, FOES[0], MATES[3], at('Mid Top'), []),
    kill(8, 30000, FOES[0], ME, at('B Site'), [near(FOES[0], at('B Lobby'))]),
  ];
  const d = {
    metadata: { match_id: 'm-synthetic-1', map: { id: 'x', name: 'Ascent' }, queue: { id: queue, name: queue }, started_at: '2026-11-01T10:00:00Z', game_length_in_ms: 2000000 },
    players: ALL.map((p, i) => ({ puuid: p.puuid, name: p.name, tag: p.tag, team_id: p.team, agent: { id: 'a', name: AGENTS[i] },
      stats: { kills: 10, deaths: 9, assists: 3, score: 4000, damage: { dealt: 2000, received: 1800 } } })),
    teams: [{ team_id: 'Red', rounds: { won: 6, lost: 8 } }, { team_id: 'Blue', rounds: { won: 8, lost: 6 } }],
    rounds,
    kills,
  };
  if (strip) {
    for (const r of d.rounds) for (const s of r.stats) { delete s.economy; delete s.ability_casts; delete s.was_afk; delete s.stayed_in_spawn; }
    for (const k of d.kills) { delete k.location; delete k.player_locations; }
  }
  return d;
}

// ── The server: riot-rounds.js parse ────────────────────────────────────────
const parsed = riotRounds.parse(payload(), ME.name, ME.tag);
const pr = (n) => parsed.perRound.find((r) => r.n === n);
ok(!parsed.error && parsed.perRound.length === 14, `the synthetic match parses, 14 rounds (${parsed.error || parsed.perRound.length})`);

// (1) Where each death happened, as Ascent's own callouts.
ok(pr(2).deathAt === 'B Main' && pr(3).deathAt === 'A Main', `deaths placed at the callout they were made at (${pr(2).deathAt}, ${pr(3).deathAt})`);
ok(JSON.stringify(pr(4).killsAt) === '["Mid Courtyard"]', `the player's kill placed where the enemy fell, a teammate's death not counted (${JSON.stringify(pr(4).killsAt)})`);
ok(!('deathAt' in pr(6)), 'a death far from every callout has no place, never a guess');
ok(!('deathAt' in pr(1)) && !('killsAt' in pr(1)), 'a round without a death or a kill has no place keys at all');
ok(riotRounds.spotOf('Nowhere', at('A Main')) === null && riotRounds.spotOf('Ascent', null) === null
  && riotRounds.spotOf('Ascent', { x: 'a', y: 1 }) === null, 'an unknown map, a missing point and a point that is not a number show nothing');
{
  // Every callout of every map, round tripped: the place is that callout, or its area when two callouts sit too close to tell.
  let same = 0; let area = 0; let wrong = 0;
  for (const [m, g] of Object.entries(DATA.mapGeometry)) {
    const t = g.transform;
    for (const c of g.callouts) {
      const s = riotRounds.spotOf(m, { x: (c.y - t.yScalarToAdd) / t.yMultiplier, y: (c.x - t.xScalarToAdd) / t.xMultiplier });
      if (s === (c.a || c.n)) same++; else if (s && verify.placeName(m, s) === s) area++; else wrong++;
    }
  }
  ok(wrong === 0 && same > 250, `every map's callouts read back as themselves, or an area of that map where two sit too close (${same} exact, ${area} area, ${wrong} wrong)`);
}

// (2) The team's buy, by the thresholds written in riot-rounds.js BUY.
ok(riotRounds.BUY.ECO_MAX === 1000 && riotRounds.BUY.FULL_MIN === 3900 && riotRounds.BUY.FORCE_LEFT_MAX === 1000 && riotRounds.BUY.MIN_PLAYERS === 3,
  'the buy thresholds are the ones written down: eco under 1000, full from 3900, force under 1000 left, three teammates at least');
const buys = parsed.perRound.map((r) => r.buy || null);
ok(JSON.stringify(buys) === JSON.stringify(['pistol', 'eco', 'force', 'half', 'full', 'full', 'half', 'force', 'eco', null, 'full', 'full', 'pistol', 'full']),
  `each round's buy by the thresholds, the edges included, the enemy's 5000 never mixed in (${JSON.stringify(buys)})`);
{
  const swift = riotRounds.parse(payload({ queue: 'swiftplay' }), ME.name, ME.tag).perRound.map((r) => r.buy || null);
  ok(swift[0] === 'pistol' && swift[4] === 'pistol' && swift[13] === 'full', `swiftplay's pistol rounds are 1 and 5, its halves of four (${swift.slice(0, 6).join(', ')})`);
  const rush = riotRounds.parse(payload({ queue: 'spikerush' }), ME.name, ME.tag).perRound;
  ok(rush.every((r) => !('buy' in r)), 'Spike Rush hands out its loadouts, so no round has a buy');
  const dm = riotRounds.parse(payload({ queue: 'deathmatch' }), ME.name, ME.tag).perRound;
  ok(dm.every((r) => !('buy' in r)), 'a queue with no known halves (deathmatch) has no buy');
}
// The guns carried (Nov 2026, from the owner's six audit matches on the live
// server): rifles with light shields, a save round of pistols, the bonus round.
{
  const team = (rows) => ({ stats: rows.map(([lv, rem, gun], i) => ({ player: { puuid: `t${i}`, team: 'red' },
    economy: { loadout_value: lv, remaining: rem, weapon: gun === undefined ? undefined : gun === null ? null : { id: 'w', name: gun, type: 'Weapon' } } })) });
  const ours = () => true;
  const rifleLight = team([[3300, 400, 'Vandal'], [3300, 200, 'Phantom'], [3300, 0, 'Vandal'], [3300, 500, 'Phantom'], [3300, 300, 'Vandal']]);
  ok(riotRounds.buyOf(rifleLight, 5, 12, ours) === 'full', `five rifles with light shields (3300 a player, little left) is a full buy, not a force (${riotRounds.buyOf(rifleLight, 5, 12, ours)})`);
  const oneSaves = team([[3900, 300, 'Vandal'], [3900, 100, 'Phantom'], [3300, 0, 'Guardian'], [3300, 200, 'Bulldog'], [800, 2400, 'Sheriff']]);
  ok(riotRounds.buyOf(oneSaves, 8, 12, ours) === 'full', 'four rifles and one teammate saving on a Sheriff is a full buy');
  const twoSave = team([[3900, 300, 'Vandal'], [3900, 100, 'Phantom'], [3300, 0, 'Vandal'], [800, 2400, 'Sheriff'], [500, 2400, 'Ghost']]);
  ok(riotRounds.buyOf(twoSave, 8, 12, ours) !== 'full', `three rifles and two saving is no full buy (${riotRounds.buyOf(twoSave, 8, 12, ours)})`);
  const unknownGuns = team([[3300, 400], [3300, 200], [3300, 0], [3300, 500], [3300, 300]]);
  ok(riotRounds.buyOf(unknownGuns, 5, 12, ours) === 'force', 'a record that names no gun reads by the averages exactly as before');
  const notAGun = team([[3300, 400, 'Brindlecap1'], [3300, 200, 'Brindlecap2'], [3300, 0, 'Brindlecap3'], [3300, 500, 'Brindlecap4'], [3300, 300, null]]);
  ok(riotRounds.buyOf(notAGun, 5, 12, ours) === 'force', 'a gun name the game data does not know counts as no rifle');
  const pistolsLight = team([[1200, 2200, 'Sheriff'], [1200, 2000, 'Sheriff'], [900, 2400, 'Ghost'], [1200, 1800, 'Sheriff'], [1000, 2100, 'Classic']]);
  ok(riotRounds.buyOf(pistolsLight, 7, 12, ours) === 'eco', `a save round of pistols with light shields is an eco, not a half buy (${riotRounds.buyOf(pistolsLight, 7, 12, ours)})`);
  const pistolsAndSmg = team([[1200, 200, 'Sheriff'], [2000, 100, 'Spectre'], [1200, 300, 'Sheriff'], [1200, 0, 'Sheriff'], [1200, 200, 'Sheriff']]);
  ok(riotRounds.buyOf(pistolsAndSmg, 7, 12, ours) === 'force', 'one SMG among the pistols is no save round');
  const bonus = team([[2000, 900, 'Spectre'], [2000, 600, 'Spectre'], [2000, 800, 'Spectre'], [1300, 1500, 'Sheriff'], [2000, 700, 'Spectre']]);
  ok(riotRounds.buyOf(bonus, 2, 12, ours, { afterPistolWin: true }) === 'half' && riotRounds.buyOf(bonus, 2, 12, ours) === 'force',
    'SMGs right after a won pistol round are the bonus round, a half buy, never a force');
  ok(riotRounds.buyOf(team([[400, 3000, 'Classic'], [400, 3000, 'Classic'], [400, 3000, 'Classic']]), 2, 12, ours, { afterPistolWin: true }) === 'eco',
    'a team that saves after a won pistol is still an eco');
  ok(riotRounds.buyOf(rifleLight, 1, 12, ours) === 'pistol' && riotRounds.buyOf(rifleLight, 13, 12, ours) === 'pistol', 'a pistol round stays a pistol round whatever is carried');
  // In the parse: the round after each half's pistol round, only when the team won it.
  const bonusPayload = payload();
  bonusPayload.rounds[12].winning_team = 'Blue';   // the second half's pistol round lost
  for (const n of [2, 14]) {
    for (const s of bonusPayload.rounds[n - 1].stats) {
      if (s.player.team === 'Red') s.economy = { loadout_value: 2000, remaining: 700, weapon: { id: 'w', name: 'Spectre', type: 'Weapon' } };
    }
  }
  const bp = riotRounds.parse(bonusPayload, ME.name, ME.tag).perRound;
  ok(bp[1].buy === 'half' && bp[13].buy === 'force', `round 2 after a won pistol is a bonus half buy, round 14 after a lost one a force (${bp[1].buy}, ${bp[13].buy})`);
}

// (3) The nearest teammate at the death.
ok(pr(2).mateNear === 'close' && pr(3).mateNear === 'far', `a teammate 800 units off is close, 3000 is far (${pr(2).mateNear}, ${pr(3).mateNear})`);
ok(riotRounds.MATE_CLOSE_UNITS === 1500, 'the line is 1500 of the map\'s units, written down');
ok(!('mateNear' in pr(5)), 'a kill with no player_locations says no distance');
ok(!('mateNear' in pr(9)), 'the last one alive, with no teammate in player_locations, has no distance');

// (4) Casts and the AFK flags.
ok(JSON.stringify(pr(1).casts) === '{"C":1,"Q":0,"E":2}', `casts by the kit's key, the ultimate's null left out (${JSON.stringify(pr(1).casts)})`);
ok(JSON.stringify(riotRounds.castsOf({ ability_casts: { c_cast: 2, q_cast: 1, e_cast: 0, x_cast: 1 } })) === '{"C":2,"Q":1,"E":0,"X":1}',
  'v2\'s c_cast, q_cast, e_cast and x_cast read the same');
ok(riotRounds.castsOf({ ability_casts: { grenade: -1, ability_1: 1.5, ability_2: 99 } }) === null && riotRounds.castsOf({}) === null,
  'a negative, a fraction or an impossible count is no cast');
ok(pr(7).afk === true && !('afk' in pr(6)) && pr(8).inSpawn === true && !('inSpawn' in pr(7)),
  'Riot\'s was_afk and stayed_in_spawn are kept on their own rounds only');

// No name, tag or id rides in anything sent.
{
  const text = JSON.stringify(parsed.perRound).toLowerCase();
  const leaked = ALL.flatMap((p) => [p.name, p.tag, p.puuid]).filter((w) => text.includes(w.toLowerCase()));
  ok(!leaked.length, `the rounds carry no player's name, tag or id (${leaked.join(', ') || 'none'})`);
  ok(!/view_radians|player_locations|"location"|"x":|"y":/.test(text), 'and no raw position or view leaves the server');
}

// A record without the data: exactly today's round, no key added.
{
  const NEW = ['deathAt', 'killsAt', 'buy', 'mateNear', 'casts', 'afk', 'inSpawn'];
  const bare = riotRounds.parse(payload({ strip: true }), ME.name, ME.tag);
  const added = bare.perRound.flatMap((r) => NEW.filter((k) => k in r));
  ok(!added.length, `a record without locations, economy, casts or flags adds no key to any round (${added.join(', ') || 'none'})`);
  const strip = (r) => { const o = { ...r }; for (const k of NEW) delete o[k]; return o; };
  ok(JSON.stringify(bare.perRound) === JSON.stringify(parsed.perRound.map(strip)),
    'and every other field of every round is the same as the full record\'s');
  const nulls = payload();
  for (const r of nulls.rounds) for (const s of r.stats) { s.economy = null; s.ability_casts = null; s.was_afk = null; s.stayed_in_spawn = null; }
  for (const k of nulls.kills) { k.location = null; k.player_locations = null; }
  const n = riotRounds.parse(nulls, ME.name, ME.tag);
  ok(!n.perRound.flatMap((r) => NEW.filter((k) => k in r)).length, 'nulls where the fields are read degrade to no key, never a throw');
}

// ── The client: valorant-verify.js reconcile ────────────────────────────────
const { rounds: merged } = verify.reconcile([], parsed);
const mr = (n) => merged.find((r) => r.n === n);
ok(mr(2).riotSpot === 'B Main' && mr(2).mateNear === 'close' && mr(2).buy === 'eco', 'reconcile keeps Riot\'s place, the distance and the buy');
ok(JSON.stringify(mr(4).killSpots) === '["Mid Courtyard"]' && JSON.stringify(mr(1).casts) === '{"C":1,"Q":0,"E":2}', 'and the kill places and the casts');
ok(mr(7).afk === true && mr(8).inSpawn === true, 'and Riot\'s AFK flags');
{
  const forged = verify.reconcile([], { map: 'Ascent', perRound: [{ n: 1, died: true, deathMs: 1000, won: false, deathAt: 'Hookah', killsAt: ['Lowfulwyrm', 'A Main'],
    buy: 'yolo', mateNear: 'Brindlecap1', casts: { C: 1.5, Q: -1, E: 'two', X: 1, Z: 3 }, afk: 'yes' }] }).rounds[0];
  ok(!('riotSpot' in forged), 'a place of another map (Hookah is Bind\'s) is no place on Ascent');
  ok(JSON.stringify(forged.killSpots) === '["A Main"]', 'a name sent as a place is dropped, a real callout kept');
  ok(!('buy' in forged) && !('mateNear' in forged) && !('afk' in forged), 'a buy, a distance or a flag that is not one of the words is no key');
  ok(JSON.stringify(forged.casts) === '{"X":1}', 'only whole counts by a known key are kept');
  ok(verify.placeName('Bind', 'hookah') === 'Hookah' && verify.placeName('Ascent', 'b site') === 'B site' && verify.placeName('Ascent', 'B') === null
    && verify.placeName('Atlantis', 'A Main') === null, 'a place is a callout, its common name or an area of that map, never a bare letter or an unknown map');
  const old = verify.reconcile([], { map: 'Ascent', perRound: [{ n: 1, died: true, deathMs: 1000, won: false }] }).rounds[0];
  const NEW = ['riotSpot', 'killSpots', 'buy', 'mateNear', 'casts', 'afk', 'inSpawn'];
  ok(!NEW.some((k) => k in old), 'a server from before adds no key to the reconciled round');
}

// ── The review: valorant-review.js ──────────────────────────────────────────
const built = riotReview.fromRiot({ row: { matchId: 'm-synthetic-1', map: 'Ascent', agent: 'Jett', mode: 'Competitive', result: 'Defeat', score: '6-8', startedAt: Date.parse('2026-11-01T10:00:00Z') },
  riot: { ...parsed, map: 'Ascent' }, history: [], account: 'x#y' }).review;
const served = review.served(built);
const card = (n) => served.rounds.find((c) => c.n === n);
ok(card(2).riot.place === 'B Main' && card(2).riot.buy === 'eco' && card(2).riot.mate === 'close', 'the card carries Riot\'s place, the buy and the distance');
ok(card(2).facts[0] === 'Died at B Main, 20s in, to Reyna with a Vandal', `the death chip says where, from Riot (${card(2).facts[0]})`);
ok(card(3).facts.includes('Not traded, nobody close'), `an untraded death with the nearest teammate far says so in one chip (${card(3).facts.join(' | ')})`);
ok(card(9).facts.includes('Not traded') && !card(9).facts.some((f) => /close/.test(f)), 'the last one alive gets no distance on its trade chip');
ok(card(5).facts.includes('Full buy') && card(1).facts.includes('Pistol round') && card(3).facts.includes('Force buy') && card(4).facts.includes('Half buy')
  && card(2).facts.includes('Eco round'), 'each round shows its buy as a chip');
ok(!card(10).facts.some((f) => /buy|Eco|Pistol/.test(f)), 'a round with no buy shows none');
ok(card(7).facts.includes('Riot marked you AFK, not counted') && card(8).facts.includes('Stayed in spawn all round, not counted'), 'a round Riot says was sat out says so');
ok(JSON.stringify(card(1).riot.casts) === '[{"key":"C","name":"Cloudburst","n":1},{"key":"Q","name":"Updraft","n":0},{"key":"E","name":"Tailwind","n":2}]',
  `the casts named by the player's kit (${JSON.stringify(card(1).riot.casts)})`);
{
  const tags = served.rounds.flatMap((c) => c.tags || []);
  ok(tags.some((t) => t.kind === 'buy' && t.text === 'Full buy') && tags.some((t) => t.kind === 'afk') && tags.some((t) => t.kind === 'untraded' && t.text === 'Not traded, nobody close'),
    'each new chip has its kind for its icon');
  const words = served.rounds.flatMap((c) => c.facts).concat((served.patterns || []).map((p) => p.text)).join(' ');
  ok(!DASHES.test(words) && !words.includes(';'), 'no dash and no semicolon in any chip or pattern');
}

// The buy discipline.
{
  const line = (served.patterns || []).find((p) => p.key === 'buys');
  // Decided buy rounds, pistols left out: eco 2 and 9 (lost, won), force 3 and 8 (won, won), half 4 and 7 (lost, lost),
  // full 5, 6, 11, 12, 14. The team's buy is the team's, so the rounds the player sat out (7, 8) count here.
  ok(line && line.text === 'Your team lost 4 of 5 rounds on a full loadout, lost 2 of 2 rounds on a half loadout, won 1 of 2 eco rounds and won 2 of 2 forced rounds.',
    `the buy discipline line, its numbers counted from the rounds (${line && line.text})`);
  ok(line && !/\bbuy/i.test(line.text), 'worded without "buy", which the review\'s and Ask Coach\'s gates drop');
  const d = review.buyDiscipline(merged.map((r) => ({ ...r, verified: true, result: r.result })));
  ok(d && d.full === 5 && d.fullLost === 4 && d.eco === 2 && d.ecoWon === 1 && d.force === 2 && d.forceWon === 2 && d.half === 2,
    `and as numbers (${JSON.stringify(d && { ...d, text: undefined })})`);
  ok(review.buyDiscipline(merged.slice(0, 5)) === null, `under ${review.BUYS_MIN} decided buy rounds, no line`);
  ok(review.buyDiscipline(merged.map((r) => ({ ...r, buy: undefined }))) === null, 'a match with no buy has no line');
  // A FINDING, NEVER A TALLY (8.8): each part only where it says something.
  const of = (spec) => spec.flatMap(([buy, won, lost]) => [...Array(won).fill('won'), ...Array(lost).fill('lost')]
    .map((result) => ({ verified: true, buy, result })));
  const said = (spec) => { const x = review.buyDiscipline(of(spec)); return x ? x.text : null; };
  ok(said([['full', 7, 4]]) === null, `a team that won 7 of 11 full loadouts has no full part (${said([['full', 7, 4]])})`);
  ok(said([['full', 3, 3]]) === 'Your team lost 3 of 6 rounds on a full loadout.', `losing half of them is one (${said([['full', 3, 3]])})`);
  ok(said([['full', 6, 0], ['eco', 0, 2]]) === null, `no eco won of two is no line, where it was "won 0 of 2 eco rounds" (${said([['full', 6, 0], ['eco', 0, 2]])})`);
  ok(said([['full', 5, 0], ['eco', 1, 0]]) === null, 'one eco won of one is too few to call working');
  ok(said([['full', 4, 0], ['eco', 1, 2]]) === 'Your team won 1 of 3 eco rounds.', `an eco won of three is one (${said([['full', 4, 0], ['eco', 1, 2]])})`);
  ok(said([['full', 4, 0], ['force', 0, 2]]) === null && said([['full', 4, 0], ['force', 1, 1]]) === 'Your team won 1 of 2 forced rounds.',
    'a forced round counts only once one of two or more is won');
  ok(said([['full', 4, 0], ['half', 0, 4]]) === 'Your team lost 4 of 4 rounds on a half loadout.' && said([['full', 4, 0], ['half', 3, 3]]) === 'Your team lost 3 of 6 rounds on a half loadout.'
    && said([['full', 4, 0], ['half', 5, 1]]) === null, `the half loadouts are counted as the full ones (${said([['full', 4, 0], ['half', 0, 4]])})`);
}

// AFK rounds are excluded from mistake counts.
{
  const base = { verified: true, side: 'attacking', result: 'lost', died: true, traded: false, aliveAtDeath: { mates: 3, enemies: 4 }, deathSec: 40 };
  const rows = [1, 2, 3, 4, 5, 6].map((n) => ({ n, ...base, died: n <= 3, traded: n <= 3 ? false : null }));
  const counted = insights.valorant(rows, {});
  const untraded = counted.mistakes.find((m) => m.key === 'untraded');
  ok(untraded && untraded.count === 3, `three untraded deaths are a counted mistake (${untraded && untraded.count})`);
  const afk = rows.map((r) => (r.n === 2 ? { ...r, afk: true } : r));
  ok(!insights.valorant(afk, {}).mistakes.some((m) => m.key === 'untraded'), 'with one of them a round Riot marks AFK, two is under the floor and nothing is counted');
  const spawn = rows.map((r) => (r.n === 3 ? { ...r, inSpawn: true } : r));
  ok(!insights.valorant(spawn, {}).mistakes.some((m) => m.key === 'untraded'), 'and a round Riot says was spent in spawn is left out the same way');
  const lostAdv = rows.map((r) => ({ ...r, aliveAtDeath: { mates: 4, enemies: 3 } }));
  const adv = insights.valorant(lostAdv, {}).mistakes.find((m) => m.key === 'lost-advantage');
  const advAfk = insights.valorant(lostAdv.map((r) => (r.n === 1 ? { ...r, afk: true } : r)), {}).mistakes.find((m) => m.key === 'lost-advantage');
  ok(adv && adv.rounds.includes(1) && advAfk && !advAfk.rounds.includes(1), 'every mistake leaves the AFK round out of its rounds');
  ok(!(served.insights.mistakes || []).some((m) => (m.rounds || []).includes(7) || (m.rounds || []).includes(8)),
    'the built review counts round 7 (AFK) and round 8 (in spawn) in no mistake');
}

// ── What the review model is sent ───────────────────────────────────────────
{
  const body = review.requestBody({ rounds: merged, context: { agent: 'Jett', map: 'Ascent' }, endedBy: 'score', riot: { agent: 'Jett', map: 'Ascent' } });
  const r2 = body.rounds.find((r) => r.n === 2);
  const r1 = body.rounds.find((r) => r.n === 1);
  ok(r2.deathSpot === 'B Main' && r2.buy === 'eco' && r2.mate === 'close', 'the review model is sent Riot\'s place, the buy and the distance');
  ok(JSON.stringify(r1.casts) === '[{"name":"Cloudburst","n":1},{"name":"Updraft","n":0},{"name":"Tailwind","n":2}]', 'and the casts by kit name');
  ok(body.rounds.find((r) => r.n === 7).afk === true && body.rounds.find((r) => r.n === 8).afk === true, 'and the rounds sat out');
  const oldBody = review.requestBody({ rounds: verify.reconcile([], riotRounds.parse(payload({ strip: true }), ME.name, ME.tag)).rounds,
    context: { agent: 'Jett', map: 'Ascent' }, endedBy: 'score', riot: { agent: 'Jett', map: 'Ascent' } });
  ok(oldBody.rounds.every((r) => !['buy', 'mate', 'casts', 'afk'].some((k) => k in r)), 'a record without them sends none of the keys');

  const input = matchReview.normalise({ ...body, variant: 'C' });
  const n2 = input.rounds.find((r) => r.n === 2);
  ok(n2.buy === 'eco' && n2.mate === 'close' && input.rounds.find((r) => r.n === 1).casts.length === 3, 'the server keeps them');
  const forged = matchReview.normalise({ rounds: [{ n: 1, verified: true, died: true, buy: 'loads', mate: 'Brindlecap1', casts: [{ name: 'Brindlecap1', n: 2 }, { name: 'Cloudburst', n: 99 }], afk: 1 }] }).rounds[0];
  ok(!['buy', 'mate', 'casts', 'afk'].some((k) => k in forged), 'and drops a word, a name or a count that is not one of them');
  const unverified = matchReview.normalise({ rounds: [{ n: 1, verified: false, died: true, buy: 'eco', mate: 'close' }] }).rounds[0];
  ok(!('buy' in unverified) && !('mate' in unverified), 'a round Riot never verified carries none of them');
  const prompt = matchReview.buildPrompt(input);
  ok(/R2 [^\n]*a teammate stood close when they died; the team played it on an eco/.test(prompt), 'the round line says the distance and the buy');
  ok(/R1 [^\n]*abilities used: Cloudburst once, Tailwind twice/.test(prompt), 'and the casts');
  ok(prompt.includes('The team\'s economy and the player\'s abilities used are known only where a round states them')
    && !prompt.includes('Damage, utility usage and economy are not in the ledger'), 'the grounding rule says where they are known');
  const before = matchReview.buildPrompt(matchReview.normalise({ ...oldBody, variant: 'C' }));
  ok(before.includes('Damage, utility usage and economy are not in the ledger, so never state them.')
    && !/stood close|played it on|abilities used/.test(before), 'a match without them is prompted as before');
  const line = (body.patterns || []).find((p) => p.key === 'buys');
  ok(line && !matchReview.BUY_BLAME.test(line.text), 'the buy discipline pattern passes the review\'s buy gate');
}

// ── What Ask Coach is sent ──────────────────────────────────────────────────
{
  const ctx = chatContext.build(served, {}, null, 'how was my economy', {});
  const m = ctx.match;
  const c2 = m.cards.find((c) => c.n === 2);
  ok(c2.riot.place === 'B Main' && c2.riot.buy === 'eco' && c2.riot.mate === 'close', 'Ask Coach\'s card carries the place, the buy and the distance');
  ok(m.patterns.some((p) => p.key === 'buys'), 'and the buy discipline pattern');
  const norm = chatPrompt.normalise(ctx);
  const nm = norm && norm.match;
  const nc = nm && nm.cards.find((c) => c.n === 2);
  ok(nc && nc.riot.place === 'B Main' && nc.riot.buy === 'eco' && nc.riot.mate === 'close', `the chat server keeps them (${nc && JSON.stringify({ place: nc.riot.place, buy: nc.riot.buy })})`);
  ok(nm && nm.patterns.some((p) => p.key === 'buys'), 'and the buy line survives the review sentence gate');
  const n1 = nm && nm.cards.find((c) => c.n === 1);
  ok(n1 && JSON.stringify(n1.riot.casts) === '[{"name":"Cloudburst","n":1},{"name":"Updraft","n":0},{"name":"Tailwind","n":2}]', 'and the casts by kit name');
  const forged = chatPrompt.normalise({ ...ctx,
    match: { ...m, cards: [{ n: 1, died: true, verified: true, riot: { place: 'Hookah', killPlaces: ['Zephyrine1'], buy: 'big', mate: 'near', casts: [{ name: 'Alarmbot', n: 1 }] } }] } });
  const fr = forged && forged.match && forged.match.cards[0] && forged.match.cards[0].riot;
  ok(fr && !['place', 'killPlaces', 'buy', 'mate', 'casts'].some((k) => k in fr), 'a place of another map, a name, a word not theirs or another agent\'s kit is dropped');
}

// ── One place for a death (8.7.10) ──────────────────────────────────────────
// The round 3 audit: 14 of 8.7.9's 87 place mentions followed the screen's
// spot, not Riot's place. On the player's competitive Split, reviewed by
// 8.0.1 and linked late, the screen's spot of every death was Riot's place of
// the death before it. Riot's places below are the record's own for that
// match (the audit's records-parsed.json, callouts only), laid on the Riot
// fixture of the same match, which was fetched before the server sent them.
{
  const SPLIT_PLACES = { 1: 'B Back', 3: 'A Tower', 4: 'B site', 5: 'A Main', 6: 'A Rafters', 7: 'B site', 8: 'B Stairs', 9: 'A site',
    10: 'B site', 11: 'B Stairs', 12: 'A site', 15: 'A Main', 16: 'Mid Mail', 17: 'A Ramps', 19: 'A Rafters', 20: 'A Main' };
  const splitRiot = JSON.parse(JSON.stringify(require('./fixtures/riot-split-13-7.json')));
  for (const rr of splitRiot.perRound) if (SPLIT_PLACES[rr.n]) rr.deathAt = SPLIT_PLACES[rr.n];
  const saved = require('./fixtures/valorant-review-split-801.json');
  const { rows, legacy } = riotReview.ledgerRows(saved.review);
  const spotOf = (n) => (rows.find((r) => r.n === n) || {}).deathSpot;
  ok(legacy && spotOf(3) === 'B Back' && spotOf(4) === 'A Tower' && spotOf(6) === 'A Main',
    `the saved 8.0.1 Split's screen spots are Riot's of the death before (round 3 ${spotOf(3)}, 4 ${spotOf(4)}, 6 ${spotOf(6)})`);
  ok(verify.screenLagged(rows, splitRiot.perRound, 'Split'), 'a ledger a death behind Riot\'s is read as behind, off the places alone');
  const { rounds: lr, checks: lc } = verify.reconcile(rows, splitRiot);
  const at = (n) => lr.find((r) => r.n === n);
  ok(at(3).deathSpot === 'A Tower' && at(4).deathSpot === 'B site' && at(6).deathSpot === 'A Rafters' && at(8).deathSpot === 'B Stairs',
    `each death is at Riot's place of its own round (3 ${at(3).deathSpot}, 4 ${at(4).deathSpot}, 6 ${at(6).deathSpot}, 8 ${at(8).deathSpot})`);
  ok(lr.filter((r) => r.watched).every((r) => !r.screenDied && !r.reads.length && !r.locs.length && r.ultAtDeath === null),
    'and nothing the screen read in a round, another round\'s, is laid over Riot\'s');
  ok(lc.lagged === true && lc.agreed === 6 && JSON.stringify(lc.invented) === '[2]' && JSON.stringify(lc.missed) === '[1]',
    `the counts stay as the screen read them (${JSON.stringify({ agreed: lc.agreed, invented: lc.invented, missed: lc.missed })})`);
  const line = verify.describe(lc);
  ok(line.endsWith("The screen filed its deaths a round late, so each round's place and notes are Riot's alone.") && !DASHES.test(line) && !line.includes(';'),
    `and the verification line says so (${line})`);
  const up = riotReview.upgradeWatched({ saved, riot: splitRiot, history: [],
    row: { matchId: 'split-1', map: 'Split', agent: 'Jett', mode: 'Competitive', result: 'Victory', score: '13-7', kills: 17, deaths: 16, assists: 8, startedAt: Date.parse(splitRiot.startedAt) || 0 } });
  const card = (n) => up.review.rounds.find((c) => c.n === n);
  ok(card(3).spot === 'A Tower' && card(5).spot === 'A Main' && !up.review.rounds.some((c) => c.died && c.spot && c.spot !== SPLIT_PLACES[c.n]),
    'the late link\'s cards say Riot\'s place of each death and no other');
  const spotLine = (up.review.patterns || []).find((p) => p.key === 'spot');
  ok(!spotLine || !/B Site, in rounds 5, 8/.test(spotLine.text), `and no spot pattern counted on the screen's spots (${spotLine && spotLine.text})`);

  // The live reader on the same match is in step: not behind, and its
  // death spots give way to Riot's places.
  const { replaySession } = require('./fixtures/replay-session');
  const live = replaySession('valorant-session-split-competitive.json', splitRiot);
  const lv = (n) => live.rounds.find((r) => r.n === n);
  ok(lv(1).screenDied && lv(3).screenDied && lv(6).deathSpot === 'A Rafters' && lv(8).deathSpot === 'B Stairs',
    `today's reader files the Split's deaths where Riot does, never read as behind (round 6 ${lv(6).deathSpot}, round 8 ${lv(8).deathSpot})`);

  // A row carrying both, as a saved card laid back over the record: Riot's
  // place counts, the screen's only where Riot has none.
  const both = [3, 4, 5, 6, 8].map((n) => ({ n, died: true, verified: true, deathSpot: { 3: 'B Back', 4: 'A Tower', 5: 'B Site', 6: 'A Main', 8: 'B Site' }[n], riotSpot: SPLIT_PLACES[n] }));
  const pats = review.patterns([...both, { n: 9, died: true, verified: true, deathSpot: 'B Site' }, { n: 10, died: false, verified: true }]);
  ok(!pats.some((p) => p.key === 'spot' && /B Site/i.test(p.text) && /\b5\b/.test(p.text)), `the spot pattern counts Riot's places (${pats.map((p) => p.text).join(' | ')})`);
  ok(review.deathPlace(both[0]) === 'A Tower' && review.deathPlace({ died: true, verified: true, deathSpot: 'B Site' }) === 'B Site'
    && review.deathPlace({ died: true, verified: false, deathSpot: 'B Site', riotSpot: 'A Main' }) === 'B Site' && review.deathPlace({ died: false, deathSpot: 'B Site' }) === null,
  'deathPlace is Riot\'s where it has one, the screen\'s where it has none');
  const thrice = [1, 2, 3, 4].map((n) => ({ n, died: true, verified: true, deathSpot: 'B Site', riotSpot: n === 4 ? 'B site' : 'A Main', killerAgent: null }));
  const counted = insights.valorant(thrice, { role: 'Duelist' });
  const same = counted.mistakes.find((m) => m.key === 'same-spot');
  ok(same && same.place === 'A Main' && JSON.stringify(same.rounds) === '[1,2,3]', `the counted same spot mistake is Riot's place (${same && same.title})`);

  // The server: Riot's place is the round's only place, and a counted place
  // line Riot's record contradicts is left out, for a client before 8.7.10.
  const body = {
    variant: 'C', context: { map: 'Split', agent: 'Jett' },
    rounds: [
      { n: 5, died: true, verified: true, deathSpot: 'B Site', place: 'A Main' },
      { n: 8, died: true, verified: true, deathSpot: 'B Site', place: 'B Stairs' },
      { n: 9, died: true, verified: true, deathSpot: 'A Site' },
    ],
    patterns: [{ key: 'spot', text: '2 of your 16 deaths were at B Site, in rounds 5, 8.' }, { key: 'early', text: '7 of your 16 deaths came in the first 30 seconds.' }],
    mistakes: [{ key: 'same-spot', title: 'Dying at B Site', detail: '3 of the deaths the coach could place were at B Site.', rounds: [5, 8, 9] },
      { key: 'untraded', title: 'Died where nobody could trade', detail: '13 of your 15 deaths went unanswered.', rounds: [5, 8] }],
  };
  const inp = matchReview.normalise(body);
  const nr = (n) => inp.rounds.find((r) => r.n === n);
  ok(nr(5).deathSpot === 'A Main' && nr(8).deathSpot === 'B Stairs' && nr(9).deathSpot === 'A Site',
    `the round line's place is Riot's where the record has one, the screen's where it has none (${[5, 8, 9].map((n) => nr(n).deathSpot).join(', ')})`);
  ok(!inp.patterns.some((p) => p.key === 'spot') && inp.patterns.some((p) => p.key === 'early'), 'the screen counted spot pattern Riot contradicts is left out, the rest stay');
  ok(!inp.mistakes.some((m) => m.key === 'same-spot') && inp.mistakes.some((m) => m.key === 'untraded'), 'and so is the same spot mistake');
  const prompt = matchReview.buildPrompt(inp);
  ok(!/B Site/.test(prompt.split('\n').filter((l) => /^R[58]\b/.test(l)).join('\n')), 'the prompt\'s round 5 and 8 lines never name the screen\'s B Site');
  const agrees = matchReview.normalise({ ...body, rounds: body.rounds.map((r) => ({ ...r, place: r.place ? 'B Site' : undefined })) });
  ok(agrees.patterns.some((p) => p.key === 'spot') && agrees.mistakes.some((m) => m.key === 'same-spot'), 'a place line Riot agrees with stays');
  const old = matchReview.normalise({ ...body, rounds: body.rounds.map(({ place, ...r }) => r) });
  ok(old.rounds.every((r) => r.deathSpot === body.rounds.find((x) => x.n === r.n).deathSpot) && old.patterns.length === 2 && old.mistakes.length === 2,
    'a client before 8.8 sends no place and is read as before');

  // Ask Coach: the screen's spot goes where Riot's place is on the card.
  const ctx = chatContext.build(served, {}, null, 'where did I die', {});
  const cards = ctx.match.cards.map((c) => (c.n === 2 ? { ...c, screen: { ...(c.screen || {}), spot: 'A Main' } } : c.n === 3 ? { ...c, died: true, screen: { spot: 'A Main' } } : c));
  const norm = chatPrompt.normalise({ ...ctx, match: { ...ctx.match, cards,
    lists: { ...(ctx.match.lists || {}), mistakes: [{ key: 'same-spot', title: 'Dying at A Main', detail: 'x', rounds: [2, 3] }] } } });
  const c2 = norm.match.cards.find((c) => c.n === 2);
  ok(c2.riot.place === 'B Main' && !(c2.screen && c2.screen.spot), `a card with Riot's place sends no screen spot (${c2.screen && c2.screen.spot})`);
  ok(!norm.match.lists.mistakes.some((m) => m.key === 'same-spot'), 'and the same spot mistake Riot\'s place contradicts is left out');
}

// ── The buy hedge only where it is true (8.7.10) ────────────────────────────
{
  const withBuy = chatPrompt.normalise(chatContext.build(served, {}, null, 'what did I buy in round 2', {}));
  const rules = chatPrompt.rulesFor(withBuy);
  ok(chatPrompt.matchHasBuy(withBuy) && rules.includes(chatPrompt.BUY_HEDGE_RECORD) && !rules.includes(chatPrompt.BUY_HEDGE)
    && rules.includes(chatPrompt.SAVE_HEDGE_RECORD), 'a match whose record holds the team buy is never told the record holds no buy');
  ok(!DASHES.test(chatPrompt.BUY_HEDGE_RECORD + chatPrompt.SAVE_HEDGE_RECORD) && !(chatPrompt.BUY_HEDGE_RECORD + chatPrompt.SAVE_HEDGE_RECORD).includes(';'),
    'the new rule has no dash and no semicolon');
  const noBuy = { ...withBuy, match: { ...withBuy.match, cards: withBuy.match.cards.map((c) => ({ ...c, riot: c.riot ? { ...c.riot, buy: undefined } : c.riot })) } };
  ok(!chatPrompt.matchHasBuy(noBuy) && chatPrompt.rulesFor(noBuy) === chatPrompt.VALORANT_RULES, 'a match without one keeps the rules word for word');
  ok(chatPrompt.rulesFor({ ...noBuy, rankBand: 'asc_plus' }) === chatPrompt.VALORANT_RULES.replace(chatPrompt.IMPROVING_RULE, chatPrompt.IMPROVING_RULE_877),
    'and above Gold the improving rule is 8.7.7\'s as before');
}

console.log(`\n${fails ? fails + ' of ' + checks + ' failed' : 'all ' + checks + ' riot record checks passed'}`);
process.exit(fails ? 1 : 0);
