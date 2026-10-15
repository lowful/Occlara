'use strict';

/**
 * CLOSING QUITS (8.4.1), and asks first only when quitting would lose
 * something. The window's X, Alt+F4 and the taskbar's Close used to hide
 * Occlara in the tray, so the review that had just opened kept being checked
 * against Riot's record; the player asked for closing to close it. So it quits
 * by the path the tray's Quit takes (index.js cleanupAndQuit), and before that
 * asks at most three questions, each once, each a native dialog whose default
 * and whose Escape is the choice that loses nothing:
 *
 *   a match being recorded right now (matchQuestion)
 *   a review still being built (reviewQuestion), from what review-work.js
 *     leftOf() says is left of it
 *   a League game's death clips still being cut (clipsQuestion), the few
 *     seconds after its review opens
 *
 * EVERY WORD IS WHAT HAPPENS, checked against the code that does it:
 *
 *   A match quit in the middle of. The engine's stop() files what it read as
 *   a review of the rounds recorded so far, at once and before any call
 *   (coaching-engine.js requestMatchReview, index.js onValorantMatchEnded),
 *   so those rounds are kept in Matches; nothing is kept with no round read.
 *   Its narrative call never comes back and the recording is deleted as the
 *   app quits (recorder.js shutdown), so it has no read and no clips. With a
 *   Riot ID connected, a later launch checks it against Riot's record (the
 *   late link, backfill.js late()), and only once Riot has the match, which is
 *   after it is over. A League game stopped part way is never graded
 *   (lol-recorder.js stop()).
 *
 *   A review still being built. THE LATE LINK DOES NOT FINISH IT AS THE LIVE
 *   ONE WOULD. It runs at a later launch with a Riot ID connected (once in six
 *   hours, backfill.js LATE_EVERY_MS), once Riot has the match, and lays Riot's
 *   record over the review in place (riot-review.js upgradeWatched): the
 *   result, the score, the rounds and the grade. It calls no model, so the
 *   coach never looks at the deaths Riot times, and the read written from the
 *   screen is taken down rather than written again; and the recording its
 *   clips would be cut from is deleted as the app quits. A Riot ID that was
 *   typed and never connected runs no late link: only Grade my recent matches
 *   does the same. And from the screen alone, nothing finishes it later.
 *
 *   A League game's death clips. Its review is whole and saved as the game
 *   ends, and each death is cut from the recording six seconds later, once
 *   the last fight's seconds are on disk (index.js clipLolDeaths). The
 *   recording is deleted as the app quits, so a quit in those seconds keeps
 *   the review with no clip of any death.
 *
 * Pure: index.js hands it what it knows (the game, the rounds read, whether a
 * Riot ID is set and connected, whether there is a recording to clip, how many
 * League games are having their deaths clipped), and test:shellnav holds every
 * wording.
 */

/** The buttons: the first is the default and what Escape answers. */
const STAY_RECORDING = 'Keep recording';
const STAY_OPEN = 'Keep Occlara open';

/** "a", "a or b", "a, b or c". */
const either = (items) => (items.length < 2 ? items.join('')
  : `${items.slice(0, -1).join(', ')} or ${items[items.length - 1]}`);

/**
 * The question a match being recorded asks, or null when none is.
 *
 * @param m.game       'valorant' | 'lol'
 * @param m.rounds     rounds the reader has filed of the match so far
 * @param m.connected  a Riot ID connected (index.js connectedRiotId())
 * @param m.clips      the match is being recorded on this PC
 */
function matchQuestion(m) {
  if (!m) return null;
  if (m.game === 'lol') {
    return {
      kind: 'match',
      message: 'A game is being recorded. Quit and stop recording?',
      detail: 'A game stopped part way is not reviewed, so nothing of this one is kept. '
        + 'Keep recording and it is reviewed when it ends.',
      buttons: [STAY_RECORDING, 'Quit'],
      quit: 1,
    };
  }
  const rounds = Number(m.rounds) || 0;
  const kept = rounds > 0
    ? `The ${rounds === 1 ? 'round' : `${rounds} rounds`} recorded so far ${rounds === 1 ? 'is' : 'are'} kept in Matches `
      + `as part of a match, as the screen read ${rounds === 1 ? 'it' : 'them'}, `
      + `with no coach's read${m.clips ? ' and no video clips' : ''}.`
      + (m.connected ? " It is checked against Riot's record at a later launch, once the match is over." : '')
    : 'No round of it has been recorded yet, so nothing of it is kept.';
  return {
    kind: 'match',
    message: 'A match is being recorded. Quit and stop recording?',
    detail: `${kept} Keep recording and ${rounds > 0 ? 'the whole match' : 'the match'} is reviewed when it ends.`,
    buttons: [STAY_RECORDING, 'Quit'],
    quit: 1,
  };
}

/**
 * The question a review still being built asks, or null when none is.
 *
 * @param r.left       review-work.js leftOf() of its job
 * @param r.riotIdSet  a Riot ID in Settings
 * @param r.connected  that Riot ID connected (index.js connectedRiotId())
 * @param r.clips      it has a recording, or clips cut from one, at stake
 */
function reviewQuestion(r) {
  const left = r && r.left;
  if (!left) return null;
  const clips = r.clips ? ['their video clips'] : [];
  const look = "the coach's look at your deaths";
  if (left.path === 'screen') {
    const missing = left.narrated ? [look, ...clips] : ["the coach's read", 'its look at your deaths', ...clips];
    return {
      kind: 'review',
      message: "Your last match's review is still being written. Quit now?",
      detail: `Quit now and it is kept ${left.narrated ? '' : 'as the screen read it, '}without ${either(missing)}. `
        + 'Keep Occlara open and it finishes by itself, usually in a minute or two.',
      buttons: [STAY_OPEN, 'Quit now'],
      quit: 1,
    };
  }
  // What a later check against Riot's record leaves out: the look, the clips
  // and any read, the screen's taken down (riot-review.js upgradeWatched).
  const without = either([look, ...clips, 'a written read']);
  const later = r.connected
    ? `Quit now and it is checked at a later launch instead, once Riot has the match, without ${without}.`
    : r.riotIdSet
      ? 'Quit now and it stays as the screen read it until you press Grade my recent matches in Matches, '
        + `which lays Riot's record over it without ${without}.`
      // The Riot ID taken out of Settings while it was being checked: nothing
      // will check it, and what the screen read stays, its read included.
      : `Quit now and it is kept as the screen read it, without ${either(["Riot's record", look, ...clips])}.`;
  return {
    kind: 'review',
    message: "Your last match is still being checked against Riot's record. Quit now?",
    detail: `${later} Keep Occlara open and it finishes by itself.`,
    buttons: [STAY_OPEN, 'Quit now'],
    quit: 1,
  };
}

/**
 * The question a League game's death clips still being cut ask, or null when
 * none are.
 *
 * @param c.cutting  League games whose deaths are being clipped right now
 *                   (index.js clipLolDeaths)
 */
function clipsQuestion(c) {
  if (!c || !(Number(c.cutting) > 0)) return null;
  return {
    kind: 'clips',
    message: "Your last game's death clips are still being saved. Quit now?",
    detail: 'Quit now and its review is kept without the video clips of your deaths. '
      + 'Keep Occlara open and they are saved by themselves in a few seconds.',
    buttons: [STAY_OPEN, 'Quit now'],
    quit: 1,
  };
}

module.exports = { matchQuestion, reviewQuestion, clipsQuestion, STAY_RECORDING, STAY_OPEN };
