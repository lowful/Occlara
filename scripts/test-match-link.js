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
const { verifyCoachedMatch, pickCoachedMatch, roundsPlayed, matchEndEstimate, scoreAfter, endedEarly, earlyCandidates,
  linkEarly, mayGoOn, linkRetries, linkAgentOf, ROUND_MS, CLOCK_SLACK_MS, MIN_ROUND_MS, EARLY_ASKS_PER_TRY, LINK_RETRY_MS, LINK_RETRY_LONG_MS } =
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

// AN AGENT THE SCREEN FOUND BY ITSELF AGREES WITH ANY MATCH (8.4.4). The
// engine reads the agent off the player's own HUD now, never asking the
// player: two answers that agree lock it, source 'hud', and a misread icon
// must never cost the review its scoreboard, which Riot's record then names
// the agent of. One the player confirmed, every review saved before 8.4.4,
// still refuses a match on another agent.
console.log('\nthe agent the link weighs (linkAgentOf):');
{
  const hud = { map: 'Breeze', agent: 'Iso', agentConfirmed: true, agentSource: 'hud' };
  const ticked = { map: 'Breeze', agent: 'Iso', agentConfirmed: true };
  const jettMatch = { startedAt: T(-10), map: 'Breeze', agent: 'Jett', score: '13-11' };
  check('  a HUD agent is no agent to the link, a confirmed one is, an unconfirmed one is not',
    linkAgentOf(hud) === null && linkAgentOf(ticked) === 'Iso' && linkAgentOf({ ...ticked, agentConfirmed: false }) === null
    && linkAgentOf(null) === null && linkAgentOf({ agentConfirmed: true, agent: '' }) === null,
  JSON.stringify([linkAgentOf(hud), linkAgentOf(ticked)]));
  const fromHud = verifyCoachedMatch(jettMatch, SESSION_START, SESSION_END, { map: hud.map, agent: linkAgentOf(hud) });
  check('  the link takes a match whose agent is not the one the HUD look locked', fromHud.ok, fromHud.why);
  const fromTick = verifyCoachedMatch(jettMatch, SESSION_START, SESSION_END, { map: ticked.map, agent: linkAgentOf(ticked) });
  check('  and still refuses one on another agent than the player confirmed', !fromTick.ok && /agent mismatch/.test(fromTick.why), fromTick.why);
  const hudOnly = verifyCoachedMatch({ startedAt: T(-10), agent: 'Jett', score: '13-11' }, SESSION_START, SESSION_END,
    { map: null, agent: linkAgentOf(hud) });
  check('  a HUD agent alone confirms nothing either: with no map, timing alone is still not enough', !hudOnly.ok, hudOnly.why);
}

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

// ── Ended early by the watch (8.2.1) ─────────────────────────────────────────
// The player's own match: a competitive Split match 8.0.1 locked swiftplay on
// and ended at 3 to 5 in round 9, saved as "Defeat 3-5, Swiftplay", and
// Riot's record of it, Competitive, Victory 13 to 7 over 20 rounds. Every
// link check refused it for its score, so it stayed the screen's for good.
console.log('\na match the watch ended early is that match, on Riot\'s round record:');
(async () => {
  const fixture = (name) => require(path.join(__dirname, 'fixtures', name));
  const RIOT = fixture('riot-split-13-7.json');
  const SAVED = fixture('valorant-review-split-801.json');
  const ROW = { matchId: 'split-1', map: 'Split', agent: 'Jett', mode: 'Competitive', result: 'Victory', score: '13-7',
    kills: 17, deaths: 16, assists: 8, kd: 1.06, acs: 279, adr: 181, headshotPct: 22, startedAt: RIOT.startedAt };
  const RIOT_END = RIOT.startedAt + RIOT.lengthMs;
  // The recording as the backfill places a review saved before the ledger:
  // its end, and (8 + 2) rounds before it (backfill.js windowOf).
  const END = SAVED.at;
  const START = END - 10 * ROUND_MS;
  const ENDED = { map: 'Split', agent: null, score: { team: 3, enemy: 5, final: true } };
  const at = (team, enemy) => ({ ...ENDED, score: { team, enemy, final: true } });

  check('  the screen ended it at 3-5 in Swiftplay, and Riot has it Competitive, 13-7 over 20 rounds',
    SAVED.review.game.score === '3-5' && SAVED.review.game.mode === 'Swiftplay' && SAVED.review.endedBy === 'score'
    && RIOT.score === '13-7' && RIOT.queue === 'competitive' && RIOT.perRound.length === 20);
  const refused = verifyCoachedMatch(ROW, START, END, ENDED);
  check('  the link refuses it for its score, as 8.0.1 did on every try',
    !refused.ok && /ended after 8 rounds and this one after 20/.test(refused.why), JSON.stringify(refused));
  const s8 = scoreAfter(RIOT, 8);
  const s9 = scoreAfter(RIOT, 9);
  check("  Riot's record stood at 3-5 after round 8, and at 4-5 after round 9",
    s8 && s8.team === 3 && s8.enemy === 5 && s9 && s9.team === 4 && s9.enemy === 5, JSON.stringify({ s8, s9 }));
  check('  and says nothing past its last round, or before its first',
    scoreAfter(RIOT, 21) === null && scoreAfter(RIOT, 0) === null && scoreAfter(null, 3) === null);
  const gap = { ...RIOT, perRound: RIOT.perRound.map((r) => (r.n === 4 ? { ...r, won: null } : r)) };
  check('  a round with no winner leaves the score unknown, never guessed',
    scoreAfter(gap, 8) === null && scoreAfter(gap, 3) !== null && !endedEarly(ROW, gap, START, END, ENDED).ok);

  const early = endedEarly(ROW, RIOT, START, END, ENDED);
  check('  so it is that match, ended early by the watch', early.ok, JSON.stringify(early));
  for (const [team, enemy] of [[5, 3], [2, 5], [4, 4]]) {
    const v = endedEarly(ROW, RIOT, START, END, at(team, enemy));
    check(`  a last score of ${team}-${enemy}, which Riot's record never stood at, is still refused`,
      !v.ok && /never stood at/.test(v.why), JSON.stringify(v));
  }
  check('  while 4-5, which it stood at after round 9, is the same match ended a round later',
    endedEarly(ROW, RIOT, START, END + ROUND_MS, at(4, 5)).ok);
  const bind = endedEarly(ROW, RIOT, START, END, { ...ENDED, map: 'Bind' });
  check('  a recording on another map is refused', !bind.ok && /map mismatch/.test(bind.why), JSON.stringify(bind));
  const unknownMap = endedEarly(ROW, RIOT, START, END, { ...ENDED, map: null, agent: 'Jett' });
  check('  and one whose map was never read, since an unknown proves nothing here', !unknownMap.ok, JSON.stringify(unknownMap));
  const sova = endedEarly(ROW, RIOT, START, END, { ...ENDED, agent: 'Sova' });
  check('  a confirmed agent that is not Riot\'s is refused', !sova.ok && /agent mismatch/.test(sova.why), JSON.stringify(sova));
  // A listed row that names no map or agent leaves those to Riot's record.
  const bare = { ...ROW, map: null };
  const riotMap = endedEarly(bare, RIOT, START, END, { ...ENDED, map: 'Bind', agent: 'Jett' });
  check("  with no map on the listed row, Riot's record's map decides, and another is refused",
    !riotMap.ok && /map mismatch \(coached Bind, match Split\)/.test(riotMap.why)
    && endedEarly(bare, RIOT, START, END, { ...ENDED, agent: 'Jett' }).ok, JSON.stringify(riotMap));
  const riotAgent = endedEarly({ ...ROW, agent: null }, RIOT, START, END, { ...ENDED, agent: 'Sova' });
  check("  and with no agent on it, Riot's record's agent", !riotAgent.ok && /agent mismatch \(coached Sova, match Jett\)/.test(riotAgent.why),
    JSON.stringify(riotAgent));
  check('  a confirmed Jett agrees, and an agent never confirmed agrees with anything',
    endedEarly(ROW, RIOT, START, END, { ...ENDED, agent: 'Jett' }).ok && early.ok);
  // 8.4.4: one the HUD look locked agrees with anything too, Sova though Riot has Jett.
  const hudSova = endedEarly(ROW, RIOT, START, END,
    { ...ENDED, agent: linkAgentOf({ agent: 'Sova', agentConfirmed: true, agentSource: 'hud' }) });
  check('  and so does one the HUD look locked, Sova where Riot has Jett', hudSova.ok, JSON.stringify(hudSova));
  const after = endedEarly(ROW, RIOT, START, RIOT_END + CLOCK_SLACK_MS + 60000, ENDED);
  check('  a recording that ended after Riot says the match was over is refused',
    !after.ok && /outside the time/.test(after.why), JSON.stringify(after));
  const before = endedEarly(ROW, RIOT, RIOT.startedAt - 3600000, RIOT.startedAt - CLOCK_SLACK_MS - 60000, ENDED);
  check('  and so is one that ended before it began', !before.ok && /outside the time/.test(before.why), JSON.stringify(before));
  check('  one ended within the clock allowance of either edge is not',
    endedEarly(ROW, RIOT, START, RIOT.startedAt + 5 * ROUND_MS, ENDED).ok
    && endedEarly(ROW, RIOT, START, RIOT_END + CLOCK_SLACK_MS - 1000, ENDED).ok);
  check('  the recording may open long before the match: Start in the menus, a queue, agent select',
    endedEarly(ROW, RIOT, RIOT.startedAt - 25 * 60000, END, ENDED).ok);
  // A recording that ended its OWN match a minute before the next one began
  // was handed that next match when it stood at the same score: the seam
  // between back to back matches is not a claim, and 8 rounds take minutes.
  const seam = endedEarly(ROW, RIOT, RIOT.startedAt - 40 * 60000, RIOT.startedAt + 80000, ENDED);
  check('  an end at round 8 that came 80 seconds into the match is refused: 8 rounds cannot have been played',
    !seam.ok && /too soon for 8 rounds/.test(seam.why), JSON.stringify(seam));
  check(`  the shortest a round is held to be is ${MIN_ROUND_MS / 1000} s, below the 83 to 103 s measured`,
    MIN_ROUND_MS >= 45000 && MIN_ROUND_MS <= 60000);
  const stopped = endedEarly(ROW, RIOT, START, END, { ...ENDED, score: { team: 3, enemy: 5, final: false } });
  check('  an end that was not on a score is not this rule\'s, and the link takes it as it always did',
    !stopped.ok && verifyCoachedMatch(ROW, START, END, { ...ENDED, score: { team: 3, enemy: 5, final: false } }).ok);
  const dm = endedEarly({ ...ROW, mode: 'Deathmatch' }, RIOT, START, END, ENDED);
  check('  a deathmatch is still never the coached match', !dm.ok && /not a match with rounds/.test(dm.why), JSON.stringify(dm));
  const eight = { ...RIOT, perRound: RIOT.perRound.slice(0, 8) };
  const short = endedEarly({ ...ROW, score: '3-5' }, eight, START, END, ENDED);
  check('  a record that ends where the screen did is no early end (the link\'s own rule takes that one)',
    !short.ok && verifyCoachedMatch({ ...ROW, score: '3-5' }, START, END, ENDED).ok, JSON.stringify(short));
  const fewer = endedEarly({ ...ROW, score: '2-4' }, { ...RIOT, perRound: RIOT.perRound.slice(0, 6) }, START, END, ENDED);
  check('  and a match with fewer rounds than the coach watched is still refused',
    !fewer.ok && /watched 8 rounds and the match had 6/.test(fewer.why), JSON.stringify(fewer));

  // The live link: which listed matches have their record asked for.
  const other = { ...ROW, matchId: 'ascent-1', map: 'Ascent', startedAt: RIOT.startedAt - 2400000, score: '13-9' };
  const lm = { ...ROW, recent: [other] };
  check('  no listed match verifies, so the link alone finds nothing',
    !pickCoachedMatch(lm, START, END, ENDED).match);
  const cands = earlyCandidates(lm, START, END, ENDED).map((m) => m.matchId);
  check('  the record worth asking for is the one on the screen\'s map', cands.join() === 'split-1', JSON.stringify(cands));
  check('  never one another review holds, and none when the watch did not end it on a score',
    !earlyCandidates(lm, START, END, { ...ENDED, exclude: ['split-1'] }).length
    && !earlyCandidates(lm, START, END, { ...ENDED, score: { team: 3, enemy: 5, final: false } }).length);
  // Split twice in a row: the match before ended twenty minutes before the
  // watch ended this one, which its estimate (100 seconds a round) runs past
  // the recording's start, so it passes the link's loose overlap check.
  const prev = { ...ROW, matchId: 'split-0', score: '13-11', startedAt: RIOT.startedAt - 2300000 };
  check('  the same map the match before passes the loose checks, and its record is not worth a request',
    verifyCoachedMatch(prev, START, END, { ...ENDED, score: { team: 3, enemy: 5, final: false } }).ok
    && earlyCandidates({ ...ROW, recent: [prev] }, START, END, ENDED).map((m) => m.matchId).join() === 'split-1');

  const asked = [];
  const roundsOf = async (m) => { asked.push(m.matchId); return m.matchId === 'split-1' ? RIOT : null; };
  const got = await linkEarly(lm, START, END, ENDED, roundsOf, new Set());
  check('  linked with the record it was decided on, so it is not fetched twice',
    got && got.match.matchId === 'split-1' && got.riot === RIOT && asked.join() === 'split-1', JSON.stringify(asked));
  const no = new Set();
  asked.length = 0;
  const miss = await linkEarly(lm, START, END, at(5, 3), roundsOf, no);
  const again = await linkEarly(lm, START, END, at(5, 3), roundsOf, no);
  check('  a record that refused is remembered, and not asked for on the next try',
    miss === null && again === null && no.has('split-1') && asked.join() === 'split-1', JSON.stringify(asked));
  const flaky = new Set();
  asked.length = 0;
  const down = async (m) => { asked.push(m.matchId); return null; };
  await linkEarly(lm, START, END, ENDED, down, flaky);
  await linkEarly(lm, START, END, ENDED, down, flaky);
  check('  one that did not arrive is asked for again', !flaky.size && asked.join() === 'split-1,split-1', JSON.stringify(asked));
  // A score end that may go on tries for over half an hour (linkRetries), so
  // one try asks for EARLY_ASKS_PER_TRY records at most, and a record that
  // refused lets the next try reach the ones after it.
  const three = { ...ROW, recent: [{ ...ROW, matchId: 'split-2', startedAt: RIOT.startedAt - 60000 },
    { ...ROW, matchId: 'split-3', startedAt: RIOT.startedAt - 120000 }] };
  const flipped = { ...RIOT, perRound: RIOT.perRound.map((r) => ({ ...r, won: !r.won })) };
  const capped = new Set();
  asked.length = 0;
  const lastIs = async (m) => { asked.push(m.matchId); return m.matchId === 'split-3' ? RIOT : flipped; };
  const firstTry = await linkEarly(three, START, END, ENDED, lastIs, capped);
  const askedFirst = asked.join();
  const nextTry = await linkEarly(three, START, END, ENDED, lastIs, capped);
  check(`  one try asks for ${EARLY_ASKS_PER_TRY} records at most, and the next reaches the one after them`,
    EARLY_ASKS_PER_TRY === 2 && earlyCandidates(three, START, END, ENDED).length === 3 && firstTry === null
    && askedFirst === 'split-1,split-2' && nextTry && nextTry.match.matchId === 'split-3'
    && asked.join() === 'split-1,split-2,split-3', JSON.stringify(asked));

  // HOW LONG THE LINK TRIES. A score end on a score only swiftplay ends on
  // may be a match the watch ended early, which Riot publishes only once it
  // is over: the real Split match's record was out nearly twenty minutes
  // after the watch's end, past a score end's last try, so it tries for as
  // long as a stop does.
  const done = (team, enemy) => ({ team, enemy, final: true });
  check('  a score end at 3-5, 5-3 or 5-4 may go on, and tries as long as a stop',
    [done(3, 5), done(5, 3), done(5, 4)].every((s) => mayGoOn(s) && linkRetries('score', s) === LINK_RETRY_LONG_MS));
  check('  one at 13-11, 11-13 or 14-12 is over, and tries the usual while',
    [done(13, 11), done(11, 13), done(14, 12)].every((s) => !mayGoOn(s) && linkRetries('score', s) === LINK_RETRY_MS));
  check('  a stop, and a match the next one began over, try long as they always did; a menu end does not',
    linkRetries('stop', { team: 3, enemy: 5, final: false }) === LINK_RETRY_LONG_MS
    && linkRetries('next-match', { team: 3, enemy: 5, final: false }) === LINK_RETRY_LONG_MS
    && linkRetries('lobby', { team: 3, enemy: 5, final: false }) === LINK_RETRY_MS && !mayGoOn({ team: 3, enemy: 5, final: false }));
  const offset = (ms) => [0, ...ms].reduce((at, d, i) => [...at, (at[i - 1] || 0) + d], []);
  const listedAt = RIOT_END + 90000 - END;
  check("  the Split match's record, published 90 seconds after Riot's end, is listed after a score end's last try "
    + 'and before a long one\'s',
  offset(LINK_RETRY_MS).every((t) => t < listedAt) && offset(LINK_RETRY_LONG_MS).some((t) => t > listedAt),
  JSON.stringify({ listedAt, short: offset(LINK_RETRY_MS), long: offset(LINK_RETRY_LONG_MS) }));

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.log('FAIL  the test crashed:', e.stack || e.message); process.exit(1); });
