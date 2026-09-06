'use strict';

/**
 * Turn a recorded League game into a review.
 *
 * DETERMINISTIC ON PURPOSE. Every line below is computed from numbers the
 * recorder actually observed, and the model is not involved. That is the same
 * rule the Valorant guards enforce, one level up: when code and model disagree,
 * code wins, and here the code is the only one that saw the game.
 *
 * A generated review would be fluent and occasionally wrong, and a review is
 * exactly where "occasionally wrong" is most expensive: the player cannot check
 * it, because the game is over and they are reading a summary of something they
 * half remember. So it says less and every sentence is checkable.
 *
 * WHAT IT REFUSES TO SAY. The Live Client Data API carries no position, no
 * camera, no wave state and no enemy cooldowns. So the review never comments on
 * positioning, map awareness in the abstract, "you should have warded here",
 * itemisation choices, or anything about what the enemy was doing. Those are
 * the lines an automated review most wants to write and least deserves to.
 */

const grader = require('./lol-grader');
const lessons = require('./lol-lessons');
const curriculum = require('./lol-curriculum');

const num = (v) => (typeof v === 'number' && isFinite(v) ? v : null);
const arr = (v) => (Array.isArray(v) ? v : []);
const str = (v) => (typeof v === 'string' ? v : '');

/** mm:ss from seconds, for timestamps a player can scrub to in a replay. */
function clock(sec) {
  const s = Math.max(0, Math.round(num(sec) || 0));
  return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
}

/**
 * How the deaths happened, which is the single most useful thing in the record.
 *
 * ChampionKill events carry a timestamp, a victim and a killer, and that alone
 * separates the two ways games are actually lost at these ranks: arriving at a
 * fight that was already down a body, and being caught with nobody near you.
 * Neither needs a model, a position, or anything but arithmetic on timestamps.
 */
function deathStory(fights, deaths) {
  const total = num(deaths) || 0;
  if (!total) {
    return { headline: 'You did not die.', detail: 'Nothing to review here. That is the whole point of the lesson on dying.' };
  }
  const joined = num(fights.joinedLost) || 0;
  const alone = num(fights.caughtAlone) || 0;
  const other = Math.max(0, total - joined - alone);

  // Lead with whichever pattern actually dominated, rather than always leading
  // with the same one.
  if (joined > alone && joined > other) {
    return {
      headline: `${joined} of your ${total} deaths came after an ally had already died.`,
      detail: 'That is arriving at a fight that was already lost. The count was against you before you got there, '
        + 'and dying second turns a bad trade into a worse one. Before you walk toward a fight, count who is actually arriving.',
    };
  }
  if (alone > joined && alone > other) {
    return {
      headline: `${alone} of your ${total} deaths happened with no ally dying anywhere near them.`,
      detail: 'That is being caught alone while nothing else was happening on the map. These are the cheapest deaths to remove, '
        + 'because no fight was being contested and nothing was being traded for them.',
    };
  }
  return {
    headline: `You died ${total} times: ${joined} into a fight already lost, ${alone} alone, ${other} otherwise.`,
    detail: 'No single pattern dominated this game, which usually means the deaths were situational rather than habitual.',
  };
}

/**
 * The moments worth scrubbing to.
 *
 * Timestamps only. The review says WHEN and what the record shows, never what
 * the player should have been doing at that second, because it cannot see it.
 */
function moments(marks) {
  const out = [];
  // gradeGame() returns marks at the TOP level, NOT inside fights. Reading
  // fights.marks silently produced an always-empty list, which looked like
  // "nothing worth reviewing" rather than a bug.
  for (const m of arr(marks).slice(0, 5)) {
    out.push({ at: clock(m.at), atSec: num(m.at), why: str(m.why) });
  }
  return out;
}

/** Objectives the team took or gave up, straight off the event list. */
function objectives(events, me, allies) {
  const mine = new Set([str(me), ...arr(allies).map(str)].filter(Boolean));
  // arr() guards the LIST and str() guards the FIELDS, and between them sat the
  // same gap the grader's evts() closes: a null entry reached a property read
  // and threw, losing the whole review rather than one line of it.
  const count = (name, ours) => arr(events).filter((e) => {
    if (!e || typeof e !== 'object') return false;
    if (str(e.EventName) !== name) return false;
    const killer = str(e.KillerName);
    const isOurs = mine.has(killer);
    return ours ? isOurs : !isOurs;
  }).length;

  return {
    dragonsFor: count('DragonKill', true), dragonsAgainst: count('DragonKill', false),
    baronsFor: count('BaronKill', true), baronsAgainst: count('BaronKill', false),
    turretsFor: count('TurretKilled', true), turretsAgainst: count('TurretKilled', false),
  };
}

/**
 * Build the whole review.
 *
 * @param record  what lol-recorder produced
 * @param history previous graded games, newest last, for the personal baseline
 */
function buildReview(record, history) {
  const r = record || {};
  const graded = grader.gradeGame(r, history);
  const fights = graded.fights || { deaths: 0, joinedLost: 0, caughtAlone: 0 };
  const final = r.final || {};
  const stats = r.stats || {};

  const kills = num(final.kills);
  const deaths = num(final.deaths);
  const assists = num(final.assists);

  // Only skills that actually produced a verdict. "unmeasured" is reported
  // separately and never as a failure.
  const results = arr(graded.results);
  const scored = results.filter((x) => x.verdict === 'pass' || x.verdict === 'fail');
  const unmeasured = results.filter((x) => x.verdict === 'unmeasured').map((x) => x.skill);

  const nextId = grader.recommend(results);
  const nextSkill = nextId ? lessons.skill(nextId) : null;
  const nextLesson = nextSkill ? curriculum.lesson(nextSkill.lesson || nextSkill.id) : null;

  return {
    // What was played. Named so the player can tell at a glance that the
    // recorder followed the right game and the right person.
    game: {
      champion: str(r.champion) || null,
      mode: str(r.mode) || null,
      map: str(r.map) || null,
      role: str(r.role) || null,
      durationSec: num(stats.gameTimeSec),
      duration: stats.gameTimeSec ? clock(stats.gameTimeSec) : null,
      me: str(r.me) || null,
    },
    scoreline: {
      kills, deaths, assists,
      cs: num(final.cs),
      csAt10: num(stats.csAt10),
      ward: num(final.ward),
      level: num(final.level),
    },
    deaths: deathStory(fights, deaths !== null ? deaths : fights.deaths),
    fights,
    moments: moments(graded.marks),
    objectives: objectives(r.events, r.me, r.allies),
    // Per skill, against the player's own recent baseline.
    scored,
    unmeasured,
    // What to do next, which is the half a review usually forgets.
    next: nextSkill && nextLesson ? {
      skillId: nextSkill.id,
      title: nextLesson.title,
      mistake: nextLesson.mistake,
      klass: nextSkill.klass,
    } : null,
    // First run honesty: how many games the baseline is built from.
    gamesRecorded: arr(history).length,
  };
}

module.exports = { buildReview, deathStory, objectives, clock };
