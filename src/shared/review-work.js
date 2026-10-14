'use strict';

/**
 * WHAT IS LEFT OF A REVIEW'S WORK (8.4.1), read off the job main keeps for
 * every Valorant review still being improved (src/main/index.js reviewJobs).
 *
 * A REVIEW STILL BEING BUILT IS A LOADING SCREEN, NOT A HALF REVIEW. The review
 * page opened at the match's end and repainted as each half landed: the screen's
 * numbers first, Riot's scoreboard 90 seconds to four minutes later, Riot's
 * rounds over them with the summary marked as being rewritten, the coach's look
 * at the deaths, then the summary again. The player read a review that changed
 * under them three times, so until its work is done the page shows the steps it
 * is on instead (workOf()), and Home's last match and its Matches row say it is
 * being checked where its grade would be.
 *
 * Done is:
 *
 *   with Riot's record (a Riot ID set when the narrative came back, `byRiot`)
 *     Riot's rounds laid over it, the looks landed and the summary rewritten
 *     (`riotLooked`), or the link given up (`linkMissing`)
 *   from the screen alone (no Riot ID then)
 *     the narrative in (`narrated`) and the look from the screen done
 *     (`screenLooked`)
 *
 * AND IT NEVER WAITS FOREVER. Riot's record not in RIOT_WAIT_MS after the end,
 * the review is painted from the screen with the note it carries already (the
 * scoreboard comes from Riot once the match is published), and it repaints when
 * the record lands, as it always has. Past BUILD_MAX_MS nothing is a loading
 * screen whatever is still going on: a look waiting out a match in progress, a
 * call that hangs. A job whose work has once read as done is done for good
 * (`released`, which main sets the first time this answers null), so a record
 * landing after the review was painted never turns it back into a loading
 * screen.
 *
 * Never for a review that is saved and not shown: a match recording was stopped
 * in the middle of, and one the next match began over. Each is a part of a
 * match, kept in Matches, whose link can try for over half an hour while that
 * match may still be played. Nor for a review saved before this version, or a
 * review of League, since main keeps no job for either.
 *
 * WHAT QUITTING WOULD COST (leftOf()), for the question closing asks first
 * (src/shared/quit-ask.js): the same work, judged for the hour the match's
 * frames and recording are held at most (ai-log-store.js HOLD_MAX_MS), and for
 * a part of a match too, whose link is still trying.
 *
 * Pure: main hands it the job, the time and whether a Riot ID is set, so
 * test:surfaces and test:homemodel hold it on stand-in jobs.
 */

// Riot publishes a match 90 seconds to four minutes after it ends; past six,
// the screen's review is painted and Riot's record fills it in when it comes.
const RIOT_WAIT_MS = 6 * 60 * 1000;
// Riot's record in at the last moment still has its look and its summary to
// come, a minute or two; past this, whatever is going on, the page paints.
const BUILD_MAX_MS = 12 * 60 * 1000;

// The steps the page lists, in the order the work does them. With Riot's
// record: saved, the wait for it, its rounds laid over the screen's, the look
// at the deaths it confirms, then the review written from all of it. From the
// screen alone the review is written first and the look follows.
const STEPS = Object.freeze({
  riot: Object.freeze(['saved', 'riot', 'deaths', 'look', 'writing']),
  screen: Object.freeze(['saved', 'writing', 'look']),
});
const STAGES = new Set(['deaths', 'look', 'writing']);

/** When the job's match ended, or null. */
function endOf(job) {
  const snap = job && job.snap;
  return snap && Number.isFinite(snap.endedAt) ? snap.endedAt : null;
}

/**
 * Which way the review is finished: Riot's record or the screen. Decided when
 * the narrative came back (index.js onValorantMatchReview), which is when the
 * link and the look from the screen start, and before that by whether a Riot
 * ID is set now.
 */
function pathOf(job, riotIdSet) {
  if (job.byRiot === true) return 'riot';
  if (job.byRiot === false) return 'screen';
  return riotIdSet ? 'riot' : 'screen';
}

/** Saved and never shown: a part of a match (index.js onValorantMatchEnded's `live`). */
function aPart(job) {
  const snap = job.snap || {};
  return !!snap.stoppedLive || snap.endedBy === 'next-match';
}

/**
 * The review's loading screen, or null once there is none to show.
 *
 * @returns {null | { path: 'riot' | 'screen', steps: string[], step: string,
 *   endedAt: number, until: number | null, scoreboard: boolean }}
 *   `step` the one under way, `until` when the page stops waiting for Riot's
 *   record (null once it is in, or from the screen alone), `scoreboard`
 *   whether Riot's scoreboard has linked already
 */
function workOf(job, now, riotIdSet) {
  if (!job || job.cancelled || job.finished || job.released) return null;
  if (aPart(job)) return null;
  const end = endOf(job);
  if (end === null) return null;
  const t = Number.isFinite(now) ? now : Date.now();
  // A clock set back since the end counts from the end.
  const age = Math.max(0, t - end);
  if (age >= BUILD_MAX_MS) return null;
  const path = pathOf(job, riotIdSet);
  if (path === 'riot') {
    if (job.riotLooked || job.linkMissing) return null;
    if (!job.riotBusy && age >= RIOT_WAIT_MS) return null;
    return {
      path,
      steps: STEPS.riot.slice(),
      step: job.riotBusy ? (STAGES.has(job.stage) ? job.stage : 'deaths') : 'riot',
      endedAt: end,
      until: job.riotBusy ? null : end + RIOT_WAIT_MS,
      scoreboard: !!job.tracker,
    };
  }
  if (job.narrated && job.screenLooked) return null;
  return { path, steps: STEPS.screen.slice(), step: job.narrated ? 'look' : 'writing', endedAt: end, until: null, scoreboard: false };
}

/**
 * What is still to do that a quit would lose, or null when nothing is.
 *
 * @param holdMs  how long after its end a job counts at all (the hour its
 *                match's frames and recording are held)
 * @returns {null | { path: 'riot' | 'screen', narrated: boolean,
 *   recordIn: boolean, scoreboard: boolean, part: boolean }}
 *   `recordIn` Riot's rounds are in and being laid over, `part` a match
 *   recording was stopped in, or the next one began over
 */
function leftOf(job, now, riotIdSet, holdMs) {
  if (!job || job.cancelled || job.finished) return null;
  const end = endOf(job);
  if (end === null) return null;
  const t = Number.isFinite(now) ? now : Date.now();
  if (Number.isFinite(holdMs) && Math.max(0, t - end) >= holdMs) return null;
  const path = pathOf(job, riotIdSet);
  const part = aPart(job);
  if (path === 'riot') {
    if (job.riotLooked || job.linkMissing) return null;
    return { path, narrated: !!job.narrated, recordIn: !!job.riotBusy, scoreboard: !!job.tracker, part };
  }
  if (job.narrated && job.screenLooked) return null;
  return { path, narrated: !!job.narrated, recordIn: false, scoreboard: false, part };
}

module.exports = { workOf, leftOf, pathOf, RIOT_WAIT_MS, BUILD_MAX_MS, STEPS };
