# Import a recording (8.12)

A player with a plan adds their own video of a Valorant match (OBS, ShadowPlay
or similar; mp4, mkv, mov or webm; 1 to 65 minutes, 8 GB at most) and gets the
same review as a live match, marked "Imported recording". The entry point is
beside "Grade my recent matches" on the Matches page.

## The owner's rules

- **Free:** no imports, bonus or bought games or not.
- **Pro:** 5 imports a billing month. After that, only with a bonus game
  (`bonus_pool`, which holds bought and invite games alike), or by moving to Max.
- **Max:** no monthly limit.
- **Every import needs a game and uses one**, on both plans, whatever
  `ENFORCE_CAPS` says. "Always open" on Max means no monthly import limit.
- **Giving back:** a failure gives the import and game back. A cancel gives them
  back before 120 match frames were read (where a live game counts) and counts
  after. All of it stays under `settle_game`'s three give backs a day.
- **A file with several matches:** the first full match (3 rounds or more) is
  reviewed for 1 game, and the panel says the rest was not read when over five
  minutes of it were left.
- **A match not in Riot's last 10**, or "Not in the list": reviewed from the
  screen and labelled "not matched to Riot's record". The late link and Grade my
  recent matches never claim an imported review (`backfill.js openOf`).

## How it runs

`src/main/services/import-video.js` is the whole job, plain Node with everything
handed in; `index.js` (`importer()`, `reviewImport`) is only the wiring.

1. **Pick.** Main shows the native picker and keeps the path. The page only ever
   gets the base name, length and Riot's list. No path or byte crosses IPC.
2. **Claim.** `POST /api/usage/import` with a new job id.
3. **Read.** ffmpeg pipes one 1280x720 JPEG per second of video. A separate
   `CoachingEngine`, its timer cleared, is driven as the live loop drives it:
   `phaseGap` picks the frames, up to 4 reads are out, replies apply in order
   under `withClock` (`shared/virtual-clock.js`, also the bench's clock). Sends
   are at most about 2 a second. A 429 waits and resends the same frame.
4. **Clock.** Synthetic: the picked match's `startedAt` plus the video time, or
   the file's modified time minus its length.
5. **End.** After a match ends, 120 more seconds are read so the engine can take
   back a false end. End of file calls `engine.stop()`; `stoppedLive` is forced
   false so no seal hold or notice fires.
6. **Review.** The usual `onValorantMatchEnded`, `onValorantMatchReview` and
   `linkRiotRecord`, branching on `snap.importRun`: frames from the import's own
   log, clips from its file, no recording hold, nothing opened over the page.
   The picked match must pass `verifyCoachedMatch` and Riot's rounds must stand
   at the video's exact score (`scoreAfter`), or the review is screen only. The
   clock starts at the picked match, so time proves nothing here. Riot's list is
   preselected only within 30 minutes of the file's own time.

## Deleting one

An imported row on Matches has Delete (two presses). `importDelete` removes the
review, its clips and kept frames (`dropReview`) and its log folder
(`review.importedLog`, `aiLogStore.removeImported`). It refuses while a match
is played or the review is still being worked on. The player's own file is never
touched, because Occlara never copies it, and the game stays used. Clear clips in
Settings also takes imported clips.

## What it must never touch

The global `engine`, `state.isCoaching`, `syncSeal`, `liveView`, `PUSH_LIVE`, the
AI log globals, `holdRecording`. It is refused while `matchInProgress()` or the
window is sealed, waits from Start until the match in front of it is over, and
`PUSH_IMPORT` is held while sealed (`flushImportPush`).

## Traps

- **ffmpeg's Matroska is not the recorder's.** The muxer always writes length
  prefixes and an avcC, even after `h264_mp4toannexb`. `toRecorderShape` rewrites
  each length to a start code in place and turns CodecPrivate into a Void.
  `repeat-headers=1` puts the SPS and PPS in each keyframe.
- **`ffmpeg-static` has no ffprobe.** `probe` parses `ffmpeg -i`.
- **The log folder is `session-import-*`,** so `dirs` and the review's eye find
  it. `pruneAiLog` passes running imports as held. Every frame stays until the
  review is done (a death only Riot knows can be anywhere), then `thin()`.
- **Import RPCs do not go through `m.rpc`.** A missing function there marks
  accounts not live for the whole server, which the SQL not being applied yet
  would otherwise do.

## Server

`X-Occlara-Import: <job id>` on reads, the look and the review books them to the
import's `game_usage` row (`importGate`, `noteImportRead`, `importReviewed`). A
read needs a reserved row of this account, at most 4000 reads. The review and
looks keep `REVIEWS_PER_GAME` each. The routes fail closed.

**The SQL is `docs/sql/0012_imported_recordings.sql`,** applied on the site's
database through Lovable (`kind` check, `import_past_limit`, `count_imports`,
`import_state`, `claim_import`, the stale settle at 12 hours). Until it runs, the
routes answer 503 `imports-not-ready` and the panel says imports are unavailable.

## ffmpeg and its licence

The installer carries the unmodified `ffmpeg-static` 5.3.0 binary (FFmpeg 6.1.1,
gyan.dev essentials, GPLv3, about 83 MB unpacked) through `extraResources`,
with `ffmpeg-LICENSE.txt`, `ffmpeg-README.txt` and `native/ffmpeg-NOTICE.txt`.
Occlara only starts it as a separate program. It is a dev dependency, so it is
not packed into the app's own `node_modules`. In the repo, `OCCLARA_FFMPEG`
overrides it.

Tests: `test:importvideo` (real ffmpeg, real engine, fake server),
`test:importserver`.
