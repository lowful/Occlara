# Flagging a death, and Further explain (8.13)

The player presses a key after a death they want to study. That death gets the look, a longer clip that the cap never takes, a yellow flag on the review and a deeper answer from the coach. Further explain gives the same deeper answer for any death, on request.

## The key

- `flagKey` in the store, `F8` by default, `''` for none. Bound in onboarding (the "Keep it out of your way" page) and Settings' Hotkeys, through `src/renderer/shared/flag-key.js`. What may be bound is `src/shared/flag-key.js`: never a key the game is played with, because a global shortcut does not reach the game. Keyboard only.
- Held only while a Valorant match is being played (`index.js syncFlagKey`, once a second), and released otherwise. A key another app holds is retried every 30 s and the review says so (`keyFailed`).
- **Nothing in the repo tests it with Valorant focused. Check it in a real match after changing it.**
- A press is a wall clock time and one tick (`PUSH_FLAG_TICK`, `sfx.js 'flag'`), the same tick whether or not a death matches, following the Sounds setting. Nothing is drawn (`screen-silence.md`).

## Which death

`shared/death-flags.js resolve`: the latest death before the press, up to the next round's barriers. The deaths come from `death-frames.js flagDeaths`. From the screen a death's start is the last frame before it, because the frame that reads it can be 9 to 29 s late. Six flags a match at most (`MAX_CLIPS`). The presses are read again when Riot's record lands (`index.js readFlags`, `merge`), so a flag follows its death. A flagged death Riot says never happened keeps its flag and clip, marked `noDeath`.

## The clip

`clips.flagWindow`: 20 s before and 6 s after Riot's moment, or from 12 s before the last living frame to 4 s after the read, 45 s at most, and not back through the buy phase. `cutLookClips` cuts it even with no look. `keepLookClips` and `flagsOnly` (a locked review) keep it whatever the look answered. `capClips` passes over it (`flaggedClips` on the library row, `flaggedNow` for a review not saved yet). Flagged clips do not count against the cap. Clear clips and deleting the review still take them. Off means no clip, and the flag stays.

Known limit: Stop then Start inside one match retires the first part's review (`retireStopStubs`), and its flags go with it.

## The look

`looksFor(..., 4, flagged)`: flagged deaths first, the most teachable fill what is left of four, and flagged past four are all looked at. The server takes six deaths only from a client of 8.13 or later.

## On the review

`review.deathFlags` and `review.deathExplains` live on the review by round, never on the cards, so a rebuilt card keeps them (`stampReview`, `riot-review.js carriedFlags`). `served()` puts them on the shown card as `flag` and `explain`. The flag is `--warn`: it is the player's own mark, not a death's `--bad`.

## Further explain

`src/main/services/death-explain.js`, `REVIEW_EXPLAIN`, `POST /api/coach/death-explain`, `server/services/death-explain.js`. One saved answer a death. It sends the look's stills, else the AI log's two frames (last five sessions), else Riot's facts, and the server is told which. Every sentence passes the look's gates, and an answer without a picture claims no sight. It uses no game, is locked by `chatLocked` with no games left rather than the look's six hour `reviewGate`, and has its own limits, 30 an hour and 60 a day per account (`rate-limits.js`). A saved answer reaches only its own row (`PUSH_DEATH_EXPLAIN`), so a clip being watched keeps playing. Flagged deaths are explained by themselves when the review's work is done (`explainFlagged`).
