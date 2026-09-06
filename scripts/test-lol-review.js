'use strict';

/**
 * The League recorder and the post-game review.
 *
 * Offline and deterministic: no client, no network. Every rule gets a known
 * POSITIVE and a known NEGATIVE, which is the discipline that caught the real
 * bugs in the tip glyph lexicon and in the grader.
 */

const assert = require('assert');
const { LolRecorder } = require('../src/main/services/lol-recorder');
const review = require('../src/shared/lol-review');

let checks = 0;
function ok(what, cond) {
  checks += 1;
  if (!cond) { console.error('FAIL: ' + what); process.exit(1); }
}

const ME = 'Me#EUW';
const A1 = 'Ally1#EUW';
const A2 = 'Ally2#EUW';
const FOE = 'Foe#EUW';

function rec() {
  return new LolRecorder({ getRole: () => 'Mid', getBand: () => 2, log: () => {} });
}

// ── Event collection ────────────────────────────────────────────────────────
{
  const r = rec();
  const payload = { events: { Events: [
    { EventID: 1, EventName: 'GameStart', EventTime: 0 },
    { EventID: 2, EventName: 'ChampionKill', EventTime: 300, KillerName: FOE, VictimName: ME },
  ] } };

  r.collectEvents(payload);
  ok('first poll takes both events', r.events.length === 2);

  // THE BUG THIS GUARDS. eventdata returns the FULL list every poll, so
  // appending blindly multiplies every kill by the number of polls: a 4 death
  // game becomes a 200 death one over a 30 minute match.
  r.collectEvents(payload);
  r.collectEvents(payload);
  ok('re-polling the same events adds nothing', r.events.length === 2);

  payload.events.Events.push({ EventID: 3, EventName: 'ChampionKill', EventTime: 400, KillerName: ME, VictimName: FOE });
  r.collectEvents(payload);
  ok('a genuinely new event is taken', r.events.length === 3);

  // Malformed entries must not throw or land in the record.
  r.collectEvents({ events: { Events: [null, 7, 'nope'] } });
  ok('junk entries are dropped, not stored', r.events.length === 3);
  r.collectEvents({});
  ok('a payload with no events survives', r.events.length === 3);
}

// ── Identifying the player ──────────────────────────────────────────────────
{
  const r = rec();
  r.identify(
    { riotId: ME },
    [{ riotId: ME, championName: 'Ahri', team: 'ORDER' },
     { riotId: A1, championName: 'Leona', team: 'ORDER' },
     { riotId: FOE, championName: 'Zed', team: 'CHAOS' }],
  );
  ok('riotId identifies the player', r.me === ME);
  ok('champion is read from the matching row', r.champion === 'Ahri');
  ok('allies are same team and not me', r.allies.length === 1 && r.allies[0] === A1);
  ok('enemies are never counted as allies', !r.allies.includes(FOE));

  // Riot moved from summonerName to riotId, and both appear in the wild.
  const r2 = rec();
  r2.identify({ summonerName: 'Legacy' }, [{ summonerName: 'Legacy', championName: 'Jinx', team: 'ORDER' }]);
  ok('summonerName still identifies the player', r2.me === 'Legacy' && r2.champion === 'Jinx');

  const r3 = rec();
  r3.identify({ riotIdGameName: 'Split', riotIdTagLine: 'EUW' },
    [{ riotIdGameName: 'Split', riotIdTagLine: 'EUW', championName: 'Yasuo', team: 'ORDER' }]);
  ok('split riot id fields are joined', r3.me === 'Split#EUW' && r3.champion === 'Yasuo');
}

// ── The record handed to the grader ─────────────────────────────────────────
{
  const r = rec();
  r.live = true;
  r.me = ME;
  r.allies = [A1];
  r.champion = 'Ahri';
  r.lastGameTime = 1800;
  r.at10 = { t: 600, cs: 52, ward: 4 };
  r.last = { t: 1800, cs: 210, ward: 12, kills: 5, deaths: 3, assists: 7, level: 16 };
  r.collectEvents({ events: { Events: [
    { EventID: 1, EventName: 'ChampionKill', EventTime: 400, KillerName: FOE, VictimName: ME },
    { EventID: 2, EventName: 'ChampionKill', EventTime: 1200, KillerName: FOE, VictimName: ME },
  ] } });

  const out = r.toRecord();
  // CS AT TEN, not the final total. Taking the final would flatter anyone who
  // farmed well after a bad laning phase, which is exactly backwards.
  ok('csAt10 comes from the ten minute snapshot', out.stats.csAt10 === 52);
  ok('csAt10 is not the final CS', out.stats.csAt10 !== 210);
  // One death before 15:00 (at 400s), one after (1200s).
  ok('deathsBy15 counts only deaths before 15:00', out.stats.deathsBy15 === 1);

  // NULL, NEVER ZERO. A zero here grades as a perfect score on a metric the
  // API cannot supply, which is the specific way this kind of code lies.
  ok('deathsAhead is null, not zero', out.stats.deathsAhead === null);
  ok('goldHeldSec is null, not zero', out.stats.goldHeldSec === null);
  ok('the raw events ride along for inspection', out.events.length === 2);
  ok('role and band come from the getters', out.role === 'Mid' && out.band === 2);
}

// ── An unstarted recorder invents nothing ───────────────────────────────────
{
  const r = rec();
  const out = r.toRecord();
  ok('no game means no csAt10', out.stats.csAt10 === null);
  ok('no game means no duration', out.stats.gameTimeSec === null);
  ok('no game means no deaths counted', out.stats.deathsBy15 === 0);
}

// ── The death story picks the dominant pattern ──────────────────────────────
{
  const joined = review.deathStory({ joinedLost: 3, caughtAlone: 1 }, 5);
  ok('a joined-lost game leads with arriving late', joined.headline.includes('after an ally had already died'));

  const alone = review.deathStory({ joinedLost: 1, caughtAlone: 4 }, 6);
  ok('a caught-alone game leads with being alone', alone.headline.includes('no ally dying anywhere near'));

  const mixed = review.deathStory({ joinedLost: 1, caughtAlone: 1 }, 4);
  ok('a mixed game says so rather than forcing a pattern', mixed.headline.includes('otherwise'));

  const none = review.deathStory({ joinedLost: 0, caughtAlone: 0 }, 0);
  ok('no deaths is its own answer', none.headline === 'You did not die.');
}

// ── Objectives, for and against ─────────────────────────────────────────────
{
  const events = [
    { EventName: 'DragonKill', KillerName: A1 },
    { EventName: 'DragonKill', KillerName: FOE },
    { EventName: 'DragonKill', KillerName: FOE },
    { EventName: 'BaronKill', KillerName: ME },
    { EventName: 'TurretKilled', KillerName: FOE },
  ];
  const o = review.objectives(events, ME, [A1, A2]);
  ok('our dragons counted', o.dragonsFor === 1);
  ok('their dragons counted', o.dragonsAgainst === 2);
  ok('a baron by me counts as ours', o.baronsFor === 1);
  ok('a turret by them counts against', o.turretsAgainst === 1 && o.turretsFor === 0);
}

// ── The whole review ────────────────────────────────────────────────────────
{
  const events = [
    { EventID: 1, EventName: 'ChampionKill', EventTime: 300, KillerName: FOE, VictimName: A1 },
    { EventID: 2, EventName: 'ChampionKill', EventTime: 310, KillerName: FOE, VictimName: ME },
    { EventID: 3, EventName: 'ChampionKill', EventTime: 900, KillerName: FOE, VictimName: ME },
  ];
  const record = {
    me: ME, allies: [A1, A2], champion: 'Ahri', role: 'Mid', band: 2, mode: 'CLASSIC',
    stats: { gameTimeSec: 1800, csAt10: 52, deathsBy15: 2, wardScore: 9.5, deathsAhead: null, goldHeldSec: null },
    final: { cs: 180, kills: 5, deaths: 2, assists: 7, ward: 9.5, level: 16 },
    events,
  };
  const r = review.buildReview(record, []);

  ok('the review names the champion', r.game.champion === 'Ahri');
  ok('the duration is formatted mm:ss', r.game.duration === '30:00');
  ok('the scoreline carries csAt10', r.scoreline.csAt10 === 52);

  // THE BUG THIS GUARDS. gradeGame returns marks at the TOP level, not inside
  // fights. Reading fights.marks produced an always-empty list, which reads as
  // "nothing worth reviewing" rather than as a bug.
  ok('a caught-alone death becomes a reviewable moment', r.moments.length === 1);
  ok('the moment carries a scrubbable timestamp', r.moments[0].at === '15:00');

  ok('the fight split is reported', r.fights.joinedLost === 1 && r.fights.caughtAlone === 1);
  ok('a first game has no scored skills yet', r.scored.length === 0);
  ok('metrics the API cannot supply are listed unmeasured', r.unmeasured.length >= 1);
  ok('the review always says what to do next', r.next && r.next.title);
  ok('gamesRecorded reflects an empty history', r.gamesRecorded === 0);

  // Nothing the data cannot support.
  const text = JSON.stringify(r).toLowerCase();
  ok('the review never claims to know positioning', text.indexOf('you were out of position') === -1);
  ok('the review never invents an item recommendation', text.indexOf('you should have built') === -1);
}

// ── A malformed record must not throw ───────────────────────────────────────
{
  assert.doesNotThrow(() => review.buildReview(null, null), 'a null record');
  assert.doesNotThrow(() => review.buildReview({}, []), 'an empty record');
  assert.doesNotThrow(() => review.buildReview({ events: [null, 3] }, []), 'junk events');
  checks += 3;
}

console.log('PASS: all ' + checks + ' recorder and review checks passed');
