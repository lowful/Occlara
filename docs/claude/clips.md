# The match is recorded on the PC: clips, playback and the cap

Moved out of CLAUDE.md word for word, nothing reworded or dropped (CLAUDE.md as of commit cc1f880, 8.5.0, lines 1620 to 1969). Sections here: "The match is recorded on the PC". This file is the second half of it, from the bullet "The clip of each moment"; recorder.md holds the first half. "Above" and "below" in the text name sections that may now sit in another file under docs/claude/: grep the section's title there to find it. The table in CLAUDE.md says which file to read for which work.

- **The clip of each moment** (`index.js clipLooks`, `review-clips.js`). When a
  Valorant review's look lands (the screen's, `screenLook`, or Riot's, in
  `withRiot`), each looked at death is cut out of the recording while the
  match's hold still keeps it, from 11 s before the death to 4 s after
  (`clips.js windowOf`), but from no earlier than a second before its round's
  barriers dropped where the look knows them (8.4.1, the look's `drop`,
  `lookWindow`), and never after the first still the look takes from it: the
  player's Fracture round 6 died 3 s in, and its clip spent its first 8 of
  15 s in the buy phase (on the real Split match rounds 6, 15 and 17 are cut
  so). Six a review at most, and kept beside the review as
  `r<n>-clip.mkv` (`review-store.js saveClip`, written by path, never through
  the review's JSON as frames are), its name on the card (`forensics.clip`).
  Then the hold is let go with the AI log's (`releaseMatchHolds`). Since 8.3.1
  the clips are cut before the look is sent, which takes its stills from them
  (above, "The look sees the recording"), and the clip's own 0 on the wall
  clock comes with it (`recorder.cutClip` `startWall`). When the death was is
  the look's `moment` (`clips.js momentOf`): Riot's, its round's barrier drop
  plus Riot's milliseconds. Without one, the look's own frames': Riot's look is
  its frame plus Riot's seconds past it (`gap`; on the real Abyss match the
  four deaths came 1 to 5 s after their frames, so a fixed two seconds was
  wrong), the screen's is the frame that registered the death, and a frame
  alone is two seconds before it. The gap only where the round clock picked
  the frame (`death-frames.js lookAt`: no plant, the death at most 10 s on);
  a Riot look framed the screen's way is the screen's. Its first frame's
  clock is not the round's: on the real Split match round 15's was a buy
  phase frame read as the round clock, and its clip was cut wholly inside the
  buy phase, 16 s before the death (`test:clips` replays that session through
  the real reader). After the plant a frame's clock is one read before it: on
  the real Abyss session rounds 6 and 16 read 10 and 8 s before Riot's second
  on frames that came after the death. One look's clips at a time, and only
  while that look is the one kept: Riot's wins, its clips replace the
  screen's, and a clip an earlier look cut of a round this one did not choose
  goes (`keepClips`), as does one of a look a late link drops, a death Riot
  says never happened, when the backfill upgrades the review in place (its
  save in index.js). A match not recorded (Off, given up, no encoder, a death
  before the recording began) has none, and its moments show their frames.
  Nor is anything cut once the player chose Off, whatever the recorder still
  holds (`clips.js cutsClips`, asked before every look's clips and every
  League game's: the guard beside `discard`), and a look that lands then
  takes an earlier look's clips with it, its cards naming none; Auto turning
  itself off is not that choice. The same holds for Off chosen while a look
  is out, its own clips already cut (`recordingStills` and `keepLookClips`
  ask again): no still is taken from them after it, so a look still waiting
  for its stills is sent the read's frames, and it keeps none of them, as
  8.3.0's look, cutting after it landed, kept none.
- **Highlights** (8.17, `index.js clipHighlights`, `clips.js` HIGHLIGHTS,
  `webm.js cutJoined`). The owner got a 3K and no clip of it was kept: only
  deaths were ever cut (on the real 7 round Split swiftplay, rounds 1, 2, 4
  and 6 had their death clips and the 3K, 3K and 4K of rounds 3, 5 and 7
  none). Now each round Riot's record proves a highlight with kills (2K to
  5K, or a clutch won: `highlightRank`; a clutch won with no kill, and a
  first kill streak, have none) is cut as ONE clip of its kills,
  `h<n>-clip.mkv`, a name of its own since a round can hold a death clip and
  a highlight clip both (`CLIP_RE` is `[rdh]`, so `saveClip`, `clipsOf`,
  `keepClips`, the cap, `occlara-clip` and `namedClips` take it as any
  clip). Six a review at most (`MAX_HIGHLIGHT_CLIPS`, apart from the
  deaths' `MAX_CLIPS`), filled ace, 4K, clutch won, 3K, 2K, then the earlier
  round (`pickHighlights`).
  - **When the kills were** (`death-frames.js killMoments`): exactly as a
    death is timed, its round's barrier drop off its clocked frames
    (`roundDrop`, deathMoment's own drop, which a round the player survived
    has too) plus Riot's feed milliseconds of each `by: 'me', on: 'enemy'`
    entry. One clock: on both real Riot records in the repo every death's
    `deathMs` is its own feed entry's `ms` (37 of 37), and the feed holds
    every one of Riot's kills (48 of 48); in a round with a death the kills
    and the death come off the very same drop, so each kill lies Riot's own
    gap before the death the death clip marks (`test:clips`, the real Split
    session through the real reader: 9 of 9 rounds with a kill timed, every
    one with a death on its death look's drop). NOTHING RATHER THAN A GUESS:
    no drop, a planted round without Riot's plant time, or a kill the drop
    puts outside the round's frames, and the round gets no highlight clip and
    the page says nothing about one. Riot's look alone cuts them; a look from
    the screen keeps none.
  - **Which seconds** (`killWindows`): each kill from 4 s before it to 2.5 s
    after. The death's 11 s lead is there for the look's stills (back to
    4.5 s) and the fight that led to it; a kill's moment is the duel itself,
    so 4 s shows the peek and the shot, and 2.5 s the kill banner and the
    next swing, where a death needs 4 for the killer from the spectator
    camera. No earlier than a second before the barriers, as a death's.
    Windows that overlap or come within 3 s of each other are one: a cut
    skipping less is a jump for nothing, and each piece may open on the
    keyframe up to a second early anyway. Past 45 s (`HIGHLIGHT_MAX_MS`,
    the flagged death's, each piece counted with a second at each end,
    `PIECE_SLACK_MS`: it opens on the keyframe Cluster at or before its first
    second and runs on to the next Cluster's first frame, so a window of 10
    to 12 s is cut 9.149 to 12.213; counted at one end only, the real cut ran
    about a second a piece past the cap) every
    kill's lead and tail is cut by the same share, down to 1 s and 0.5 s,
    never by dropping a kill: a clip still too long then keeps them all.
  - **One file of several pieces** (`webm.js planJoin`, `cutJoined`,
    `joinClips`). Each piece is a clip as `cutClip` writes it, opening on a
    keyframe Cluster with its own SPS and PPS; two whose Clusters meet or
    overlap are one. Joined, each piece's Clusters are written again with
    their Timecodes moved on by a running offset, the lengths of the pieces
    before, the blocks copied byte for byte: Timecodes only rise, the
    Duration is the pieces' lengths together, the Cues point at every
    keyframe Cluster of every piece. One piece is `cutClip`'s own clip, byte
    for byte. EACH CLUSTER IS REBUILT ONCE and the file written once
    (`joinSteps`, `writeClip`): cutting each piece as a clip and reading it
    back to join copied every byte three times, 4.6 ms a MB on the fixture
    against `cutClip`'s 1.7 (6.1 against 2.2 on the reviewer's PC), and a
    45 s 1080p highlight is 34 to 68 MB; written once it is 1.8 to 2.0, the
    same bytes. `joinClips` stays for an import's whole ffmpeg clips. Main is
    let go between pieces (`cutJoinedSoon`) and between highlights, since the
    next match may be recording. `recorder.cutJoined(windows, kills)` cuts
    from the recording that holds every kill to within a second of its
    ends, the one they lie furthest inside first, as `cutClip` chooses (of
    two back to back, kills just past the first one's end are the second's),
    and A CLIP MISSING A KILL IS NO CLIP: one whose pieces do not hold every
    kill is passed over, and `cutHighlights` keeps a clip only with every
    kill marked (a 3K once kept showing two). It answers each piece's wall
    clock start and end and its place in the clip.
  - **The cuts and the kills are marked** (`highlightMarks`): kept on the
    card as `highlight: { clip, length, kills, cuts: [{ at, skipped }] }`,
    ms on the clip's own timeline (`valorant-review.js highlightOnCard`, only
    on a card that has one). The clip player draws each kill as a tick in
    `--good` and each cut as a break in the track, their titles and the
    timeline's saying "10 s skipped at 8 s", and over the picture "10 s
    skipped" for 1.6 s as playback or a step crosses a cut (`crossAt`, a
    move of 1.5 s or less, so a loop or a jump says nothing).
  - **The same rules stop them**: Off (`cutsClips`, asked before and while
    they are cut, and at `keepLookClips`), a locked review, a look no longer
    the review's (`stale`), the recording already let go (a later look takes
    the clips cut, `job.highlightsCut`, and asks for nothing). Cut on the
    look's queue (`job.clipping`), after the deaths' and BEFORE
    `recordingCut`, so the recording is never let go first. Named on their
    cards by `riotLook` from `job.highlights`, which `keepLookClips` keeps
    with the deaths' and a flag's; anything else in the folder goes. A look
    refused for the games cap (402) saves the review locked and names no
    clip, so the highlight clips it just cut are taken off the folder
    (`dropHighlightClips`) and every other clip stays as it did before.
  - **Imported recordings too** (`import-video.js cutVideoJoined`, the run's
    `cutJoined`): each piece cut by ffmpeg as any import clip, every one
    opening on a keyframe, the match in progress waited out before EACH
    piece's encode (`idle`, never only the first), then joined by
    `joinClips`, which needs the same
    video (track, codec, size, TimecodeScale) rather than the same Tracks
    bytes, since ffmpeg writes a fresh TrackUID each run. A 45 s highlight
    in three pieces took 3.4 s on the test video here; six of them sit well
    inside the import review's 10 working minutes (`IMPORT_REVIEW_MS`, time
    a match is played not counted). If those run out, the import is
    reported done with the review as saved and its holds let go
    (`reviewImport`); the job is not cancelled, so a look still cutting
    goes on reading the player's own file, and its clips and next save can
    still land after.
  - Not on the review page: a round card names its highlight clip, but only
    the Moments page (its rows and the reel) and the compilation player
    play it.
  - Held by `test:clips` (names, windows on the Split case, the cap trim,
    marks, the order, the real records' one clock, the real Split session,
    and index.js's own look in a sandbox over a stand in four minute
    recording: the Split swiftplay's three highlights cut while the
    recording is held and let go after, their marks, Off, locked, a look
    from the screen, the card), `test:webm` (the joined file: rising
    Timecodes, its Duration, the source's blocks, keyframes, Cues, merging,
    refusals, `joinClips`), `check:webmplay` (a joined clip of the fixture
    plays, knows its length and shows the recording's frame in each piece),
    `test:reviewstore`, `test:moments`, `test:surfaces` (the reel, the
    marks, the words at a cut) and `test:importvideo` (ffmpeg's pieces
    joined). Fixture: `scripts/fixtures/highlights-split-swiftplay.json`,
    the Split swiftplay's kill times, numbers only.
- **League's deaths, clipped** (`index.js clipLolDeaths`). The League recorder
  notes the game's clock against the wall clock on every poll
  (`lol-recorder.js timeline`, `wallAt`: the last poll at or before a moment,
  carried on a second a second, so a pause is crossed), and at the game's end
  each `ChampionKill` of the player is found in the recording by wall time and
  cut the same way, six at most spread from the first to the last
  (`pickSpread`), as `d<k>-clip.mkv`, six seconds after the review opens, so
  the last fight's four seconds are on disk. The review's "Your deaths"
  (`lol-review.js deathList`) lists every death by the game's clock with the
  one fact the record gives (an ally died in the 20 s before, none within
  20 s, or one in the 20 s after: `analyseDeaths`'s arithmetic), and the clip,
  drawn as a Valorant review's rounds are (8.3.1): a death with its clip a row
  with the clip beside its fact, any other one line.
- **Playback** (`clip-scheme.js`). `occlara-clip://review/<id>/<name>`,
  privileged before the app is ready (standard, secure, stream) and handled
  with hand written Range and 206, 416 past the end, a Range it does not read
  ignored for the whole clip, `video/x-matroska` (canPlayType refuses H.264 in
  video/webm), no caching, and a 404 with no body for anything but a file
  named as a clip (`CLIP_RE`) in a review's own folder (`clipFile`). The review
  page's CSP adds `media-src 'self' occlara-clip:`. In its death's round the
  clip plays alone (8.7: the filmstrip of stills under it is gone): muted, inline, looping,
  the frame the coach looked at nearest before the death as its poster, with
  no caption (its row says what it is), nothing loaded until it is
  played or moved (preload none: measured, a clip loading its metadata took
  about 40% of a core in the GPU process for a second, a 640x360 one playing
  about 8%, one paused nothing), a click on the picture plays or pauses it,
  and out of view or with the page hidden it pauses.
  Whether a clip is there is asked of the disk each time a review is shown
  (`present()`, `presentClips`).
- **The clip's player** (8.4.4, `renderer/review/clip-player.js`, its
  arithmetic `clip-time.js`, one pure file the page loads and `test:clips`
  runs), the player's ask: "control for the clips ... like pausing, rewinding,
  and controlling the time and going in step by step". Every clip a review
  shows has it, a round's and a League death's alike. Under the picture a
  timeline, an input of type range read out as the seconds from the death,
  the death on it in --bad and the coach's stills where they were taken
  (their `frameAt`), and one row: play and pause, back to the start, back and
  forward a second, back and forward one frame (pausing first), the time in
  the stills' words ("2.4 s before", "0.3 s after", "At the death" on the
  frame the death falls in, to the hundredth within a twentieth of a second
  of it, where a tenth says nothing; a look from the screen counts from its
  read, that frame "Read as dead"), and the speed, 1x, 0.5x and 0.25x. A
  still under its clip was a place in it (a click moved the clip to that
  still's own frame); since 8.7 no strip of stills is drawn under a clip at
  all (death-look.md, "No strip of stills under a clip"), the timeline's
  marks say where each was, and `showStill` and `keysFrom` wait unused. The keyboard only while
  the player has focus, which a click on the picture or a control gives its
  root (out of the tab order): Space or K plays and pauses, comma and full
  stop step a frame, the arrows a second, Home the start; Space on a control
  reached by Tab presses that control, and the page's own scroll keys stay
  the page's. The stills under the clip hear the same keys (`keysFrom`): a
  still clicked keeps the focus, and full stop pressed then did nothing; now
  it steps on from the still's frame. One seek in flight at a time, the
  newest asked waiting for `seeked` (a seek decodes from the keyframe before
  it), and none to where the clip already stands for the same frame: paused
  at the last frame, Chromium answers a seek to the same time by looping the
  clip back to its start, and a step on at the end, a second on there and
  the timeline at its end twice each showed frame 0. The timeline lets go on
  the page's own pointerup too: grabbed, dragged off it and let go there
  with its place unchanged, the range heard neither its pointerup nor a
  change, and the clip stayed paused with its timeline and its time stopped.
  - **A step lands on a real frame.** Main reads each clip's frames off its
    blocks (`clip-frames.js indexClip`, the reading the stills are decoded
    by), once a file by its path, size and time written (`review-clips.js
    frameTimes`), and `presentClips` hands them over with the clip
    (`clipFrames`, `{ times, end }`); without them a step is a thirtieth of a
    second, which on the fixture's uneven frames (15 to 77 ms apart) lands
    on another frame than the next on 165 of 210 steps, drifting as it goes.
    WHERE IN THE FRAME was measured, each frame read off its
    pixels against the one WebCodecs decodes at that index: paused, Chromium
    shows the first frame it decodes whose end it ESTIMATES, its time plus a
    running average of frame lengths, reaches the time asked for. 1 ms into
    each frame showed the frame before on 145 of 199, 4 ms in on 25, and 2 ms
    before the next frame showed an earlier frame on frame 26, which a 47 ms
    gap follows, in the review page some of the time: the player stepping to
    frames' starts lost frame 30, then stepping to their ends lost frame 26.
    So a step lands where the frame before is over by that estimate and this
    one is not (`insideOf`), and every one of the clip's 420 steps, each
    frame forward and back, then showed its frame in the review page, twice
    over. A second either way and the timeline land the same way (`landOn`).
  - **And the frame is seen, not assumed** (`clip-player.js`). That estimate
    takes in the frames decoded ahead of the one shown, so beside a capture
    stall, or short frames after long ones, no landing inside a frame is
    sure. Walked frame by frame on this PC's own clips, each step judged by
    its pixels against WebCodecs and by the compositor's own frame time, a
    clip with a 313 ms stall showed another frame than the one stepped to on
    35 of 946 steps, up to six frames back (frames after the stall shown for
    none of their own times), one with a 64 ms gap on 3 of 976, and the 57 a
    second clip on none of 1,822. So the frame a seek of ours presents is
    read off the compositor (`requestVideoFrameCallback`), and a seek that
    showed another goes again by what it saw, six times at most, halving
    between the times seen too early and too late once it has both: shown
    the frame before for a time, Chromium takes that frame to last that
    long, and the frame wanted shows up to as far past its own start. The
    time beside the clip and the next step count from the frame on screen,
    which can stand a frame or two before the clock; a time seen to show a
    frame is gone back to; and a frame shown for no time tried goes back to
    the try that showed the frame nearest it, one on the way the move goes
    first (kept to the last try, a step on beside the stall stood nine
    frames back), is said as the frame on screen and stepped past, never
    stuck behind. A time that showed one frame can be the next frame's own
    landing, so "already there" is the same frame, never only the same
    time: taken for the same place, it held a real clip's steps still for
    good. Without the callback or the clip's frames nothing is checked, and
    a window never shown presents no frame (check:webmplay walks the stall
    on screen). Walked again, six of those clips, 7,364 steps, showed their
    own frame on every step but 4 or 5 of the stalled clip's (two walks),
    each then the frame beside the one stepped to, said as the frame on
    screen.
  - **The death's place** is kept on the card beside the clip's name when
    the clip is cut (`clipDeath`, ms on the clip's own timeline, never a wall
    clock): a Valorant look's moment less the clip's own 0, only where the
    look's frames carry their seconds from it (`review-clips.js
    lookDeathInClip`, in `keepLookClips`; a look timed by a clock read to the
    second marks nothing rather than a guess), League's death by the game's
    clock on the wall clock less the clip's 0 (`clips.deathInClip`, in
    `clipLolDeaths`). `presentClips` drops a place outside the clip, and a
    review saved before 8.4.4 has none: nothing is marked, the time is the
    clip's own seconds ("4.2 s of 15 s"), and its stills zoom.
  - `test:surfaces` holds the markup and every name, the marks, the words,
    the steps with a clip's frames and without them, one seek in flight, the
    last frame, the timeline let go off it, the keyboard and the stills' keys,
    the speed, the filmstrip, a League death, a review saved before, and the
    frame shown checked on a stood in compositor (the frame before shown, a
    later one, both, a frame never shown, the same time for the next frame);
    `test:clips` the arithmetic on the fixture's frames, main's read and its
    cache, the place kept and handed over; `check:webmplay` each step by the
    frame's pixels, the last frame stepped at, and the fixture clip with a
    300 ms stall put in it stepped across it, the case shown real by the same
    walk unchecked; `check:clips` the player in the real review page by the
    frame the <video> presents, the keys as trusted input with the page never
    scrolled, slow motion, the timeline clicked and the stills.
- **Ask Coach plays them too.** A reply about a death can carry that round's
  clip under the paragraph about it (ask-coach.md, "The coach shows the
  player's own clips"). The chat page loads `clip-time.js`, `clip-player.js`
  and `clip-player.css` as the Moments page does, its CSP adds `media-src
  'self' occlara-clip:`, and the clip is found by main the Moments page's way
  (index.js AskCoach deps `clips`, over `moments.js build`). The server only
  ever hears round numbers and answers round numbers: the URL is main's, of
  the review asked about, and a "Watch round N" capsule becomes the player
  only when clicked.
- **A clip's poster** (Orbit's Clips page, 28 Nov 2026, `services/clip-posters.js`).
  One real still of a kept clip, made ONCE by the bundled ffmpeg the first time the
  Clips page lists the clip without one (`index.js withPosters`, a death's 0.8 s
  before the death, a highlight's 0.3 s before its first kill), 480 wide, one JPEG,
  one ffmpeg at a time, never mid match or sealed, and a clip that failed is not tried
  again that session. Kept beside the clip as `<clip>-poster.jpg` (`clips.js
  posterNameOf`, `POSTER_RE`; `review-store.js savePoster`, through a temp file, only
  while its clip is there) and handed to the page as a data URL in the moments
  model (`clip.poster`), never through the clip scheme. It is NOT a clip: not listed
  by `clipsOf`, not counted against the cap, and deleted wherever its clip is
  (`removeClipFile`, from `keepClips` and `dropClips`, so the cap and Clear clips
  take it too). Until it lands, and where no clip was kept, the page shows the map's
  bundled splash dimmed, never a frame from elsewhere; main tells the Clips page once a
  batch is made (`PUSH_REVIEWS` with `posters`, to that page alone), and it repaints
  unless its player is open. `test:reviewstore` holds the poster's life beside its clip.

- **The cap** (`clipCapGB`, 5, 10, 20 or 50 GB, 10 by default). After every
  clip kept, at launch, and when the cap is lowered, the clips past it go a
  review at a time, the oldest first and a folder no review owns before any
  (`capClips`). A folder is owned when its `<id>.json` is on disk, listed in
  `index.json` or not, and only a folder with no review is deleted whole
  (8.7.2). An `index.json` that is missing or cannot be read is rebuilt from
  the `<id>.json` files, never read as an empty library: read as one, the next
  save wrote an index of one review, and the cap then deleted every other
  review's folder, frames and all (`review-store.js index()`,
  `test:reviewstore`). A review that lost its clips keeps its frames, facts and grade
  and says "Its clip was cleared to keep your clips under the space set in
  Settings" (`clipsCleared` on the saved review, carried by every later
  version of one still being improved); Clear clips in Settings takes every
  clip and says it was cleared in Settings. A clip missing for no reason given
  (a review restored without it) is left out and its frames show.
- **Settings**: "Record match video", On or Off (the player asked for a
  setting that toggles it; On is the stored 'auto', never renamed), 480p,
  720p or 1080p (480p since 8.7, first of the three, its title and the
  folded hint saying it is the lightest, 15 frames a second, and that its
  death moments are less sharp; the status line then says "Recording now at
  480p, about 15 fps"), a hint per game (`REC_HINT`: Valorant's recorded while its screen is
  read, League's while its own record is, never saying its screen is read),
  and one status line: "Recording now at 720p, about 30 fps" (`liveView`: the
  track's own height when it gives one, so a 1280x1024 display at 1080p says
  1024p, else the setting; the frames recorded a second, the median of the
  last ten seconds whose picture changed, to the nearest five: since 8.4.2
  30 where it said the 57 the capture delivered), or why it
  is not, this session's reason before the last session's: no hardware video
  encoder, the PC busy (two sessions in a week turned it off, with Try again,
  which sets it back On), not enough disk, Windowed Fullscreen needed, an
  error; in League it says the review is still built from the game's record,
  never that the screen is read, and so do Capture speed and Performance,
  which say there that they do nothing in League (and League's recording
  covers the standard frame whatever Performance says, `readSize`). The line
  is written only when it changes, a polite live region.
  Under it what the clips take against the cap, the cap, and Clear clips,
  which asks on the first press and clears on a second within four seconds
  (`CLIPS_USAGE`, `CLIPS_CLEAR`, read again on every `PUSH_REVIEWS`).
- **The AI log is locked on, both ways** (8.9, the owner's rule: "if the
  recording setting is on, lock the captures, vice versa"). A Valorant
  review finds each death it looks at in the AI log's frames
  (`index.js forensicsFor`: no log, no look), with recording on the clips are
  cut where those frames say, and with recording off they are the only thing
  the look has. So its switch in Settings is always shown on, both buttons
  disabled, with a line for each state (`settings.js AILOG_LOCK` and
  `AILOG_LOCK_OFF`; League's two say it does nothing there, never that its
  screen is read). Recording Off asks first (`rec-confirm`) and saves
  `recordingMode: 'off', aiLog: true`; a config holding `aiLog: false` from
  before the lock is stored back on when Settings loads, and the recorder's
  busy turn-off sets it on too (`recorder.js strike`). Main writes the log
  whatever is stored (`startAiLog` has no off path), so the lock is what
  happens, not only what is drawn. Never give the switch back an Off:
  `test:surfaces` holds both states and League's.
- **Onboarding asks first** (8.3.1, the tour's fourth page of five, How
  Occlara watches): Record gameplay or Frames only, the stored 'auto' and
  'off', and 480p, 720p or 1080p (480p since 8.7), with a PC check behind them run as the page
  opens. Main reads what Node can (`src/main/services/pc-check.js`, over
  `PC_CHECK`): the GPU's name (getGPUInfo('basic'), 22 ms here where
  'complete' took 260, the "Microsoft Basic Render Driver" passed over), the
  CPU's threads, the RAM, the primary display in physical pixels, the free
  space where the recordings go, and the recorder's own three encoder asks for
  that display (fitSize, codecFor, bitrateFor: 854x480 at avc1.42E01F and
  1.33 Mbps, 1280x720 at avc1.42E01F and 1920x1080 at avc1.42E028 on a 1080p
  display), which the page puts to
  VideoEncoder exactly as the recorder page's gate does. The rules are
  `src/renderer/onboarding/pc-rules.js`, one pure file the page loads and the
  test runs: no hardware encoder (720p and 1080p refused and no yes to 480p)
  or under 8 GB free, Frames only and Record
  cannot be chosen; under 8 GB of RAM or 4 threads, Record at 480p
  recommended where the encoder said yes to it (8.7: "With 4 GB of RAM, 480p
  is the lightest way to record."), Frames only still open, and Frames only
  recommended as before where it did not; otherwise Record, at 1080p when the encoder takes it,
  the display is 1920x1080 or more and there are 16 GB and 8 threads; at
  480p (8.7) where the RAM or the threads are known to fall short of that and
  the encoder said yes to 480p ("This PC can record at 480p, the lightest
  size. 720p and 1080p are for 16 GB of RAM or more."); else
  720p, the line saying what 1080p was short of (the display, the encoder's
  1080p, or a fact not read: a strong PC stays at 720p); an encoder that
  takes 480p alone records at 480p. So a PC once told to record nothing, or
  720p for want of RAM or threads, is offered 480p first. RAM is read as the size it
  is sold in (os.totalmem() is 31.8 on a 32 GB PC, under 14 on a 16 GB laptop
  sharing 2 with its graphics). The recommendation is pre selected and saved
  only over the store's defaults, which nobody chose, so a tour shown again
  after a logout keeps the Off or 1080p picked in Settings, the
  recommendation tagged beside it; a pick made while the check runs is kept;
  a saved size the encoder refuses, which the recorder's gate would never
  record, is shown unavailable with its reason (on the size, and in the line
  where the line did not say it) and the recommended size picked and saved in
  its place, beside the player's own Record or Frames only; the two asks run
  at once, and an ask that never answers is unknown, never a no (one after
  the other, a hung encoder held "Checking this PC" for ten seconds). The
  choices are radios, Record's size a group of its own: an arrow moves between
  them and picks, turning no page, Tab comes in on the picked one, and Enter
  on a button is that button alone (on Next it pressed Next twice), the
  page's last control (Frames only) picking and going on. Its copy is true in every
  game: Valorant and League are recorded, and the one sentence about the
  screen names Valorant. `npm run test:pccheck` holds every rule, main's
  facts and the asks against the real Recorder's start and the real recorder
  page's gate; `test:surfaces` the page and its keys; `check:onboardingriot`
  the page in the real app, this PC as it is and PCs stood in for, and the
  keys sent as trusted input, so the browser's own click on Enter is in play.
- **Counts for the developer**: one block a session to
  `POST /api/coach/session-report` (`reportBlock`): version, the game
  (valorant or lol), mode, res (480, 720 or 1080, `RES_CHOICES`, which
  `server/services/telemetry.js RECORDING_RES` holds the same, test:telemetry
  holding the two equal), the outcome from a closed list (recorded, off,
  no-hw-encoder, busy, disk, black, error), minutes recorded, fps p50 (the
  frames recorded, in a match, picture changing), the recorder's CPU p50,
  the main process's and the GPU process's CPU p50 (`mainCpuP50`,
  `gpuCpuP50`, since 2026-11-09, % of one core: main hosts the capturer, so
  the page alone read about a tenth of the cost; counted only, the busy
  rule never reads them, and the server keeps them only from the release
  that lists them) and the PC's p90, whether the gate passed. Nothing else; `server/services/telemetry.js` keeps only
  those words or 'other' (a block from before the game counts its game as
  'other'), clamps every number, splits the summary by game, and counts the
  tip era's reports as before. A session ends with its block however it ends,
  Stop, quit, logout or Windows ending its session (`shutdown()` used to send
  none, and Settings kept the session before's reason), and the newest block
  is kept (`recordingReportPending`, `{ at, n, block }`) until the server
  takes it. As the process ends (a quit, an update's restart, Windows ending
  its session, each calling `shutdown({ exiting: true })`, which marks the
  'report'; a logout is not that, the app goes on) it is only kept, never
  posted: posted into the exit it could reach the server and lose its answer,
  and the next launch sent it again, the session counted twice. The next
  launch sends what one left, once (`sendPendingReport`, at launch with the
  key kept, or in `launchMainApp` once one is activated).
- **debug.log says what the recording did** (8.4.1, `recorder.js logStatus`).
  Once a minute, beside the frames the capture delivered and the frames
  recorded (8.4.2, "fps p50 55.1 delivered and 30 recorded"), the track's own
  settings as the page reads them each second (`getSettings()`, its size and
  frame rate), and the frames and MB written since the last line against the
  bitrate asked ("1770 frames and 42.7 MB written in the last 61 s (29 a
  second, 5.9 Mbps against the 6 Mbps asked, 25 KB a frame)", the real
  screen after; before, "3034 frames and 71.7 MB ... (50.2 a second, 9.9
  Mbps ...)"); the start line adds the track's frame rate, what the capture
  was asked for and that it is recorded at up to 30 (at 480p "asked 854x480
  at up to 30 fps, recorded at up to 15, 1.3 Mbps"), and the bitrate MediaRecorder took, and the stop's
  line the chunks and frames handed over against those that came, the frames
  left open and the tracks still live, and the chunks' 0 against the page's
  (`stoppedText`). On the
  player's Fracture swiftplay the recording fell from 57 to 32 frames a
  second for its last two minutes with no line saying why, and at 57 its
  pages ran about twice the 6 Mbps asked, a constant 24 KB a frame. Counts in
  a log line only, no rule reads them and nothing leaves the PC.
- **The dev switches work unpackaged only**: `OCCLARA_FAKE_CAPTURE=1` records
  frames the page draws (written to a track generator: a canvas's own
  captureStream stalled in a second recorder page with the main window open)
  and makes every GDI frame flat grey, so no check touches the screen; `=black`
  draws black, and `=busy` four hundred blocks that move every frame, which
  the encoder spends its whole budget on (the flat picture asks it for less,
  so twice the bitrate never showed on it). `OCCLARA_DEV_FAKE_FPS` draws it
  that many times a second (30 unless set). `OCCLARA_DEV_RECORDER_MIN_FPS`,
  `_BUSY_MS` and `_PAGE_MS` force the busy rule and shorten pages.
  `OCCLARA_DEV_RECORDER_ASK_FPS` (2026-11-09) is the frame rate the capture
  is asked for at every size, a whole number from 15 to 120 (anything else is
  ignored), in place of the size's own (45 at 720p and 1080p, 30 at 480p,
  `recorder.js ratesFor`), so another ask can be tried in a game; the record
  rate, the grid and the busy floor stay the size's. The start line in
  debug.log says the ask it used (`asked WxH at up to N fps`).

`npm run test:recorder` holds every rule above on a fake clock and fake files
with the real fixture, the Valorant rules on the real reader replaying the
real Split match, the page's account through the real rules, ten minutes
of 3 Mbps Clusters held to under 30 MB of memory, and the minute line on two
minutes at 57 and then 32 frames a second delivered, 30 recorded. And 8.4.2's
thirty a second: grid.js as the page loads it (30 a second of a capture at
32 to 60, every frame of one at 30 or under, jittered as Windows' timers
jitter it or not, at most two more after a still screen, a capture whose
timestamps stand still, jump back, repeat every other frame, step half a
second back once a second or are missing, 30 a second each), its pump (a
frame the writer cannot take closed at once, none queued, the stop waiting
on a write in flight, nothing left open), and the real page run with stand
ins for Chromium (the
generator recorded and never the capture, 300 of 600 frames in ten seconds,
a frame in flight counted open, every chunk handed over then no frame and no
buffer of the capture left open, its tracks torn down); Settings and the
counts saying the frames recorded and the busy rule the frames delivered;
the 0 the page's first frame where the first chunks allow it, and a clip
forty minutes in cut within 2 ms of its moment with the wall clock gaining
or losing 75 ppm on the recording's own, where one offset put it 179 ms out
(a second's Cluster early, losing). And 8.7's 480p: its size on nine
displays (16:9, 21:9, 16:10, a 1366x768 laptop, 32:9, 5:4, 4:3) and never
covering the Standard read, its bitrate, its 30 asked and 15 recorded, the
grid keeping 15 of a capture at 17 to 60 and every frame of one at 15 or
under, its busy floor of 6 (a minute at 10 delivered is not busy there and
is at 720p; 5 gives up in 20 s), a dev floor laid over it only when set,
Performance's read served from it, Settings told "480p, about 15", its
counts naming 480, and old saved sizes (a number 1080, junk) read as
before. `npm run
check:recorder` boots the app and runs the real page on generated frames,
the busy picture drawn 60 times a second: paged, served, the gate (H.264
yes, VP9 no on this PC), the track's settings reported each second and the
bitrate MediaRecorder took, 30 a second recorded on disk and in a clip cut
from it, and said so where the page and Settings say it, within 1.4 times
the bitrate asked (twice it before), no frame held open while recording and
none, nor any track live, at the stop, the 0 the
first frame's moment with the chunks' own within 50 ms after it, the page's
two clocks read together and kept every five seconds, stopped
cleanly with every chunk the page said it handed over on disk, held at a
match's end, not judged before a read lands, busy back to GDI with its
notice, black stopped, a display change stopping the page with nothing open
and building the 30 a second again on a new one, the displays' events
reaching the recorder, 480p recorded by the real page (854x480 on disk,
15 a second of the 60 drawn, within the band of its 1.33 Mbps, every read on
the GDI helper, Settings and its counts saying 480), Windows ending its session and an update's restart
deleting everything in the call, a quit leaving nothing, none of the three
posting its counts into the exit, and counts one kept sent at the next
launch.
`npm run test:clips` holds, since 8.7, a 480p clip at 15 frames a second cut, stepped and
stilled on its own frames (its last frame 67 ms, never a thirtieth), and
the names, the seconds, the moments on the real
Abyss match, and on the real Split and Abyss sessions through the real reader
(`scripts/fixtures/replay-session.js`), the cut and only from a recording
that holds the moment, Off, the store, the cap, a late link's clips and the
scheme's ranges offline; `npm run check:clips` boots the app: a death
recorded live is clipped beside its review before the hold goes, the page
plays it, nothing is clipped once Off is chosen and an earlier look's clip
goes, a clip of the canvas fixture plays, pauses and seeks to its frame
through occlara-clip, Clear clips takes them, a League death is clipped by
the game's own clock, and a late link through the real backfill keeps only
the clips its cards name. The
generated frames hold the GPU process at 50 to 80% of a core on their own
(the spike measured the whole app at about 21% of one capturing the real
screen in full motion), and with a clip seeked in the review page the
recorder page froze for 4 to 19 s in 10 of 12 runs, and in none of 4 without
one, so the check stops recording before any clip plays. Watching a clip
between matches while recording is the game test's to measure. check:clips
draws its picture 30 times a second, as it always did, where check:recorder
draws 60: drawn at 60, its stills held against a `<video>` seeked to the
same second failed, a still and a seek a frame apart (the recorded frames up
to 50 ms apart) differing by 4.6 of 255 where the check allows 4, and one seek
a second early presenting no new frame. The stills are WebCodecs' own frames;
it is the seek that lands a frame either side.

## Deleting and storage (9.1, the owner's item 18)

- **A whole match** (`MATCH_DELETE`, `index.js deleteMatch`, from a Matches
  row's menu or the review, after the page's own confirm): the review, its
  folder (clips, posters, kept frames), its library row and its year record
  (`review-store.js remove`), an import's AI log folder too; the panel's last
  grade, the review page on it (which goes back where the player came from, or
  to Matches) and the history's entries of it follow (`dropReview`). A
  recorded match's frames in the AI log stay with their session, which the log
  prunes itself. Refused mid match or sealed ('match') and while its review is
  still being built ('working'). IMPORT_DELETE is the same path for an import.
- **One clip** (`CLIP_DELETE`, `deleteClip`, `review-store.js removeClip`):
  the file and its poster; the review keeps its frames, facts and grade, and
  shows its frames where the clip was. PUSH_REVIEWS `{ id, game, clip,
  removed: true }` follows.
- **A clip's file in Explorer** (`CLIP_REVEAL`, `revealClip`): by the
  review's id and the clip's name, never a path a page names; only a clip in
  the store's own folder (`clipFile`, `storage-usage.js inside`) and on disk,
  through `shell.showItemInFolder`. Not mid match or sealed.
- **What Occlara keeps** (`STORAGE_GET`, `storage`,
  `services/storage-usage.js measure`): the clips with their posters, the
  recordings, the frames (a review's and the AI log's), the rest, the total,
  the room left on the recording's drive, the cap, and `clearable.clips`.
  Counted off the disk each time, async, never walking into a link; null mid
  match. Only clips are the player's to clear (CLIPS_CLEAR or one at a time):
  the recordings are held only until a match's clips are cut and go at every
  quit, and the frames are thinned by the log itself.
- **The match rating on a library row** (item 16): REVIEWS_LIST rows carry
  `rating: { value, shown }` (shown on the 100 scale) or null, from the saved
  rating (`review-store.js metaOf`); a row saved before 9.1 is rated once in
  the background after the first list (`index.js fillRowRatings`, never mid
  match) and PUSH_REVIEWS `{ ratings: true }` asks Home and Matches to list again.
- The cap and Clear clips are unchanged: a deleted clip is simply not on disk
  for them to count. `test:storage` holds all of it.
