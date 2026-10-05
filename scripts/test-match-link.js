'use strict';

/**
 * Deciding whether a tracker match is the one a coaching session watched.
 *
 * This refused a real match and the session was graded with no scoreboard at
 * all. The reason was that it compared START times: the match began more than
 * the 20 minute lead before the player hit Start, so it was rejected for
 * "starting before the session" despite being the only game they played and
 * still being in progress the whole time coaching ran.
 *
 * Start time is the wrong question. What makes a match the coached one is that
 * it was BEING PLAYED while the coach was watching, so the test is overlap. The
 * tracker never reports an end time, but it does report the scoreline, and the
 * round count that falls out of it estimates the length closely enough.
 *
 * The guard still refuses when in doubt: a session graded against somebody
 * else's scoreboard looks authoritative while being completely wrong, which is
 * worse than a session with no scoreboard.
 *
 * Run: npm run test:matchlink
 */
const path = require('path');
const { verifyCoachedMatch, pickCoachedMatch, roundsPlayed, matchEndEstimate } =
  require(path.join(__dirname, '..', 'src', 'main', 'services', 'match-link.js'));

let pass = 0, fail = 0;
const check = (name, ok, detail) => {
  ok ? pass++ : fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok || !detail ? '' : `\n        ${detail}`}`);
};

const MIN = 60 * 1000;
const T = (m) => new Date('2026-08-12T21:00:00Z').getTime() + m * MIN;

// The real failure: coaching started at 21:04 and ran to 21:13, on a match that
// had begun at 20:30 and was still going throughout.
const SESSION_START = T(4);
const SESSION_END = T(13);
const COACHED = { map: 'Breeze', agent: 'Iso' };

console.log('the match that was wrongly refused:');
const longMatch = { startedAt: T(-30), map: 'Breeze', agent: 'Iso', score: '13-11' };
const v = verifyCoachedMatch(longMatch, SESSION_START, SESSION_END, COACHED);
check('  a long match already underway links', v.ok, `refused: ${v.why}`);

console.log('\nround count is read from the scoreline:');
check('  "13-11" is 24 rounds', roundsPlayed({ score: '13-11' }) === 24);
check('  "5-2" is 7 rounds', roundsPlayed({ score: '5-2' }) === 7);
check('  a missing scoreline is 0', roundsPlayed({}) === 0);
check('  24 rounds runs about 40 minutes',
  Math.round((matchEndEstimate(longMatch) - longMatch.startedAt) / MIN) === 40);

console.log('\nit still refuses a match that was already over:');
// A short game that ended well before coaching began must not be linked.
const stale = { startedAt: T(-60), map: 'Breeze', agent: 'Iso', score: '5-2' };
const s = verifyCoachedMatch(stale, SESSION_START, SESSION_END, COACHED);
check('  a finished earlier match is refused', !s.ok, `linked it anyway: ${JSON.stringify(s)}`);

console.log('\nthe identity checks are unchanged:');
const wrongMap = verifyCoachedMatch({ startedAt: T(-10), map: 'Ascent', agent: 'Iso', score: '13-11' },
  SESSION_START, SESSION_END, COACHED);
check('  a different map is refused', !wrongMap.ok, wrongMap.why);

const wrongAgent = verifyCoachedMatch({ startedAt: T(-10), map: 'Breeze', agent: 'Jett', score: '13-11' },
  SESSION_START, SESSION_END, COACHED);
check('  a different agent is refused', !wrongAgent.ok, wrongAgent.why);

const nothingToCheck = verifyCoachedMatch({ startedAt: T(-10), score: '13-11' },
  SESSION_START, SESSION_END, {});
check('  timing alone is never enough', !nothingToCheck.ok, nothingToCheck.why);

const later = verifyCoachedMatch({ startedAt: T(40), map: 'Breeze', agent: 'Iso', score: '13-11' },
  SESSION_START, SESSION_END, COACHED);
check('  a match starting well after the session is refused', !later.ok, later.why);

console.log('\nwith no scoreline to estimate from, the old lead window still applies:');
const noScore = verifyCoachedMatch({ startedAt: T(-30), map: 'Breeze', agent: 'Iso' },
  SESSION_START, SESSION_END, COACHED);
check('  unknown length beyond the lead is refused', !noScore.ok, noScore.why);
const noScoreRecent = verifyCoachedMatch({ startedAt: T(-5), map: 'Breeze', agent: 'Iso' },
  SESSION_START, SESSION_END, COACHED);
check('  unknown length inside the lead still links', noScoreRecent.ok, noScoreRecent.why);

console.log('\nthe newest match is not always the coached one:');
{
  const coached = { matchId: 'b', startedAt: T(-10), map: 'Breeze', agent: 'Iso', score: '13-11' };
  const skirmish = { matchId: 'a', startedAt: T(14), map: 'Skirmish E', agent: 'Iso', score: '5-3' };
  const pick = pickCoachedMatch({ ...skirmish, recent: [coached] }, SESSION_START, SESSION_END, COACHED);
  check('  a skirmish queued after it no longer hides it', pick.match && pick.match.matchId === 'b',
    JSON.stringify(pick));
  const none = pickCoachedMatch({ ...skirmish, recent: [{ ...coached, map: 'Ascent' }] }, SESSION_START, SESSION_END, COACHED);
  check('  and every candidate still has to verify', !none.match && none.tried === 2, JSON.stringify(none));
  const solo = pickCoachedMatch(coached, SESSION_START, SESSION_END, COACHED);
  check('  a server without the list still links the newest', solo.match === coached, JSON.stringify(solo));
}

console.log('\na deathmatch is never the coached match:');
{
  const dm = { matchId: 'dm', startedAt: T(-8), map: 'Breeze', agent: 'Iso', score: '0-0', mode: 'Deathmatch' };
  const v = verifyCoachedMatch(dm, SESSION_START, SESSION_END, COACHED);
  check('  a 0-0 deathmatch on the same map and agent is refused', !v.ok, JSON.stringify(v));
  const tdm = verifyCoachedMatch({ ...dm, score: '100-87', mode: 'Team Deathmatch' }, SESSION_START, SESSION_END, COACHED);
  check('  and so is team deathmatch, whatever its score', !tdm.ok, JSON.stringify(tdm));
}

console.log('\nthe rounds have to fit:');
{
  const prev = { matchId: 'p', startedAt: T(-25), map: 'Breeze', agent: 'Iso', score: '13-5' };
  const watched12to7 = { ...COACHED, score: { team: 12, enemy: 7, final: false } };
  const v = verifyCoachedMatch(prev, SESSION_START, SESSION_END, watched12to7);
  check('  an 18 round match cannot be one the coach watched 19 rounds of', !v.ok, JSON.stringify(v));
  const real = { ...prev, matchId: 'r', score: '13-9' };
  check('  a 22 round one can', verifyCoachedMatch(real, SESSION_START, SESSION_END, watched12to7).ok);
  const ended = { ...COACHED, score: { team: 13, enemy: 11, final: true } };
  const shorter = verifyCoachedMatch({ ...prev, score: '13-8' }, SESSION_START, SESSION_END, ended);
  check('  a match seen ending at 24 rounds is not a 21 round one', !shorter.ok, JSON.stringify(shorter));
  check('  but it is a 24 round one', verifyCoachedMatch({ ...prev, score: '11-13' }, SESSION_START, SESSION_END, ended).ok);
}

console.log('\na match already linked to another review is skipped:');
{
  const a = { matchId: 'a', startedAt: T(-10), map: 'Breeze', agent: 'Iso', score: '13-11' };
  const pick = pickCoachedMatch(a, SESSION_START, SESSION_END, { ...COACHED, exclude: ['a'] });
  check('  its id is not linked twice', !pick.match && /already linked/.test(pick.why), JSON.stringify(pick));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
