# The match is recorded on the PC: the recorder

Moved out of CLAUDE.md word for word, nothing reworded or dropped (CLAUDE.md as of commit cc1f880, 8.5.0, lines 1395 to 1619). Sections here: "The match is recorded on the PC". This file is the first half of it, up to the bullet "Out of the recording"; clips.md holds the second half. "Above" and "below" in the text name sections that may now sit in another file under docs/claude/: grep the section's title there to find it. The table in CLAUDE.md says which file to read for which work.

## The match is recorded on the PC

```
src/main/services/recorder.js        pages, holds, the sweep, the disk guard, health, the fallback, the counts
src/main/windows/recorder-window.js  a window nobody sees, the primary display's source, the CPU sample
src/renderer/recorder/               the page: the gate, MediaRecorder fed 30 frames a second, 15 at 480p (grid.js), the read's frame, health each second
src/main/services/capture.js         the read's frame: from the stream while it serves one, else the GDI helper
src/shared/webm.js                   the chunks read as they come, whole Clusters out, clips cut by them
src/shared/clips.js                  a clip's name, its seconds, when a look's death was, the cap's choices
src/main/services/review-clips.js    the clips of a review's moments cut, and shown or said to be gone
src/main/services/clip-scheme.js     occlara-clip://, a review's clips served by range and nothing else
src/shared/clip-frames.js            a clip's frames off its blocks, its codec off its SPS, which to decode for a second
src/main/services/look-stills.js     the stills a look takes from its clip, and the order they are sent in
src/main/windows/frames-window.js    a window nobody sees, opened for a look's stills and closed after them
src/renderer/frames/                 the page: WebCodecs on the clip's H.264, each still a 1280x720 JPEG
```

Since 8.3 the match is recorded on the player's own PC while it is played, so
its review can play back the moments it looked at. Display capture as OBS's
Display Capture takes it: desktopCapturer's source for the primary display
(matched on `display_id`) opened with getUserMedia, never the game's memory or
files, never a hook into it. The page is a window that is never shown, and its
one voice is a notice on the window's notice line about capture. Valorant
sessions and League sessions record, both reviews having deaths to clip. The
player does nothing: recording is on by default (On, stored 'auto'), measures
its own cost on every PC, turns itself off where the PC cannot afford it, and
the coach keeps reading once a second either way.

**What is never recorded or kept**: audio (the capture asks for none), any
display but the primary one, the screen outside a session (Start to Stop),
Occlara's own windows while a match is played (the main window sealed, the AI
log, the corner mark: "Out of the recording", below), and any recording past
its review's work: the recording is deleted once nothing holds it, and only
the clips of the moments the review looked at stay beside it, under the cap.
No recording and no clip ever leaves the PC. The frames the coach reads go to
the server as they always have, one a read, and the counts below say how the
PC coped, never what was on it.

- **Auto by default, and it turns itself off.** `recordingMode` 'auto' or
  'off', `recordingRes` '480', '720' or '1080' (480 since 8.7; main reads it
  through `recorder.js resOf`, and Settings and onboarding by the same rule
  in their own pages: '480' and '1080' as they are, a number 480 or 1080 too,
  anything else '720', as every reader did before there were three). Judged only while a match is in
  progress, the recorder gives up for the session ('busy') when for 20 s
  straight the capture delivers under 12 frames a second (6 at 480p, the
  floor sized to the rate recorded: `RES[res].minFps`, a dev limit laid over
  it only when set) while the picture
  changes (or stops delivering; what the capture delivers, never the 30 a
  second recorded of it), a chunk is over 4 s late, the page's process
  is over 60% of ONE core, or the PC is over 95% (`HEALTH`, first guesses to be
  tuned from the counts below). The reads go back to the GDI helper at the same
  cadence, one notice says so, and two busy sessions within 7 days turn Auto
  off (`recordingStrikes`, `recordingAutoOff`), which Settings says, with Try
  again (On chosen again forgets them). Paused, nothing is recorded either.
  A League game is a match in progress here too, and as its screen is never
  read, its notices end "The review is still built from the game's own
  record." (`deps.still`). A Valorant match is judged only once a read has
  landed and the last one was not a menu (`recorder.js valorantInMatch`), not
  on the seal's `matchInProgress()` alone, which holds through the menus after
  a match left in round 1 or 2 and through a session whose reads all fail: a
  loading screen's CPU gave up as busy there and took a strike. The fps rule
  is fed by the page's own account (`src/renderer/recorder/health.js`, a file
  test:recorder runs): a second with no new frame carries the last "picture
  changed" verdict, since said "not changing" there every second after a
  frame was a good one, and a capture slowed to a frame every 1.5 or 5 s, or
  one a second at random, never gave up; now each does within 30 s.
- **H.264 on the GPU, or nothing.** The page asks `VideoEncoder.isConfigSupported`
  with prefer-hardware first, before the screen is opened ('no-hw-encoder'):
  in the spike it told the GPU's encoder apart (yes for H.264, no for VP9, which
  then took a whole core in software). MediaRecorder, Matroska first, 1.33 Mbps
  at 480p, 3 at 720p and 6 at 1080p (more for a recording bigger than its box, in proportion
  to its pixels, twice the box's at most: `bitrateFor`), a keyframe and a chunk
  every second. At 720p and 1080p (480p's below) the capture is asked for 45 fps (60 until 2026-11-09, below), because asked for 30 with the
  whole screen moving it delivered 21, and the recording is handed 30 of them
  (8.4.2, `src/renderer/recorder/grid.js`, `RECORD_FPS`): Chromium sets
  MediaRecorder's encoder for 30 frames a second whatever it is handed, so
  every frame got a thirtieth of a second's bits however many came. On the
  player's Fracture swiftplay at 1080p the capture delivered 57 a second, the
  pages ran 74 to 91 MB a minute where 6 Mbps is 43, a constant 24 KB a
  frame, then 45 to 47 MB at 32 a second, and the clips came out at 56.5,
  55.6 and 32 frames a second: the disk guard, the hold, the clip cap and
  what Settings implies are all sized on the bitrate asked. So MediaRecorder
  records a track generator, and a processor on the capture track hands the
  page every frame: the grid keeps 30 a second by each frame's own timestamp
  (thirty slots a second open on the capture's clock, a frame takes the
  oldest open, one opening within a quarter of a slot included, and a still
  screen leaves at most two open; the page's clock counts only what the
  timestamps do not, each stretch of time once, since counted on both a
  capture at 60 whose every other timestamp repeated recorded 45 a second),
  writes them to the generator, and closes every other frame at once. A
  frame the generator cannot take now is closed too, never queued, its slot
  left open for the next. A frame written is the
  capture's own, passed on, never copied, and keeps the bits it had, which is
  what the look's stills need, each a single decoded frame. The first frame
  of each slot of a fixed grid was simulated first: a capture at an even 30
  whose frames sat on the slots' edges recorded 22 to 27 a second, two frames
  in one slot and none in the next. Measured on this PC's real screen, a full
  screen pattern at 240 Hz through the real page at 1080p: before, 56.7
  delivered, 52.1 a second recorded, 10.45 Mbps (74.7 MB a minute) against
  the 6 asked, 24.5 KB a frame; after, 55.9 delivered, 29.9 recorded, 6.05
  Mbps (43.3 MB a minute), 24.7 KB a frame. On the busy generated picture at
  60 a second, 6.09 Mbps against 3 at 720p and 12.58 against 6 at 1080p
  before, 3.52 and 6.37 after (the encoder runs a little over the asked on
  a picture that busy), and the page and the GPU process, measured back to
  back on a quiet PC, fell with the frames encoded: the page from 17 to 11%
  of a core at 720p and from 54 to 20 at 1080p, the GPU process from 19 to 11
  and from 41 to 18; at 30 a second delivered nothing changed (7.7 and 7.6,
  17.5 and 17.7), so the grid itself costs nothing measured. On the real
  screen the page went from 7.3 to 3.8% of a core and the GPU process from
  18.9 to 8.5, the PC busier during the run before (50% against 20). No frame
  was held open but the read's newest, in any run. The read's clone and its
  processor are as they were.
  The level is by macroblocks (`codecFor`): 3.1 up to 3600 (1280x720), 4.0
  past it.
- **480p, the light size** (8.7, the owner's ask: "try to make the recording
  less laggy if we can, i dont know if 60 fps is needed or not and also add
  an option for something below 720p. making it more lightweight is
  better"). `RES[480]`: 854x480, the capture asked for 30 frames a second and
  15 of them recorded (the start's `fps` and `recordFps`, which the page and
  grid.js take as given), 1.33 Mbps, 720p's 3 in proportion to its pixels, so
  each frame keeps a 720p frame's bits per pixel and, Chromium giving each
  frame a thirtieth of a second's bits, about half of it written at 15 a
  second (0.7 Mbps on the real screen, 1.5 on the busy generated picture).
  The gate asks it at 30 fps like every size, since that is what Chromium
  sets MediaRecorder's encoder for. Its stills are decoded from 854x480 and
  drawn up to the look's 1280x720, so its death moments are less sharp, which
  Settings says. MEASURED on this PC (RTX 5060, i5-14400F, one 1920x1080
  display at 240 Hz), the real page recording the real screen with a busy
  pattern drawn on a quarter of it at every refresh, 12 to 20 s a run, two
  passes, % of one core: today's 720p (asked 60, recorded 30) took the page
  4.3 and 3.9 and the MAIN process 30.2 and 29.6, at 54 to 57 delivered;
  1080p 5.1 and 4.8, main 22.7 and 21.3 (no scaling: the display is 1080p).
  THE CAPTURE ITSELF IS THE COST, and it is in Electron's main process,
  where Chromium's desktop capturer runs: it follows the frames delivered,
  recorded or not, and the scaling (1080p, unscaled on this display, cost
  less than 720p at the same rate), and the earlier measurements here (the
  page and the GPU process alone) never saw it. 720p
  asked for 30 delivered 29 and took main 17.9 and 16.8; recorded at 24, 20
  or 15 of them main stayed at 15.5 to 16.7 and the page fell to 2.7 at 15. 480p
  asked 30 and recorded 15: page 1.5 and 1.7, main 14.6 and 17.3, 0.7 Mbps
  against 720p's 3. The GPU process ran 33 to 51 with the pattern alone at 43,
  too noisy to rank; with the pattern drawn at 60 a second instead it was
  15.5 for today's 720p and 11.8 for 480p (main 26.8 and 12.4). BUT 480p
  cannot hand the Standard read its 1280x720 frame, so the read is the GDI
  helper's again, as with recording Off, and the helper is a process start a
  read: 78 ms of CPU each here (median of 30), 8% of a core at a read a
  second. So in a Valorant live round 480p costs about a quarter less CPU
  than today's 720p (page and main 16 to 19, plus 8), and about half less
  where there is no read to take (League) or the read is Performance's
  854x480, which it covers and serves (`fitSize` below). Two ways round the
  GDI read were measured and not taken: a frame's `displayWidth` set to
  854x480 on a 1280x720 capture is ignored by MediaRecorder (it recorded
  1280x720), and each recorded frame drawn down on a canvas from a 1280x720
  capture recorded 854x480 with the read served, at page 4.8 and 5.5, main
  15.4 and 17.3, about what 480p with the GDI read costs, for a copy of every
  frame where every other size passes the capture's own on.
- **Whether 60 is needed** (8.7, measured, not changed). 720p and 1080p
  still ask 60 and record 30. On this 240 Hz screen asked 30 delivered 29
  (and 29 with the pattern drawn at 60 a second), asked 45 delivered 43 and
  took main 22 against 28.6 at 60, and asked 30 took 13 to 14 points of a core
  less than 60. Asking 30 at 720p and 1080p would be the largest saving of
  all, but the 8.3 spike measured 21 delivered at 30 with the whole screen
  moving, so a PC like that would record 21 instead of 30; a 60 Hz display
  cannot be tried here without changing Windows' display settings. 45 should
  deliver 30 on a 60 Hz display by the same arithmetic (a grab, then the
  first refresh a frame period later) and 36 to 41 on 144 to 240 Hz, untried
  on 60 Hz. Both are proposals for a game test, not shipped. (Superseded on
  2026-11-09: 45 shipped, next item.)
- **Asked for 45, not 60** (2026-11-09, the owner: "if it doesn't need 60
  fps then we don't need that"). WHY: asked for 60 and recorded at 30, the
  capture cost the main process twice what the recording needed, 28.8% of a
  core against 14.7% asked for 30, since the capturer runs in main and every
  frame past the grid's 30 was grabbed, copied, handed over and closed
  unrecorded. NOW: `RES[720]` and `RES[1080]` ask 45 (`ASK_FPS`); the record
  rate (30), the grid, the 1 s keyframes and chunks, clip cutting, the busy
  floor (`minFps` 12) and 480p (asks 30, records 15) are as they were. WHY
  45 AND NOT 30: a capturer that waits 1/45 s (22 ms) after a grab still
  catches the next frame of a 60 Hz display at 33 ms, so a 60 Hz game is
  delivered at 30; asked 30 (33 ms, a hair past the frame) the 8.3 spike got
  21 on a 60 Hz screen, under the grid's 30. MEASURED on this PC (240 Hz,
  `scripts/spike-recorder.js --motion`, which records every frame delivered,
  so the grid would keep min(30, delivered)), delivered fps and main's p50 %
  of a core: 720p asked 60, 55.9 and 26.4; asked 45, 32.2 and 15.5 (30 s)
  and 43.5 and 22.0 (60 s); asked 30, 29.3 and 14.1. 1080p asked 60, 32.2
  and 11.0; asked 45, 43.4 and 14.7 (30 s) and 32.2 and 11.6 (60 s); asked
  30, 29.0 and 10.8, with 6 gaps over 50 ms and one of 137. So 45 delivered
  32 to 44 in all four runs (always enough for 30 recorded), and 30 delivered
  29 here and 21 on the 8.3 display, below 30 recorded either way. The GPU
  process stayed at 15 to 22 throughout, too noisy to rank; main follows the
  frames delivered, which is why a run that delivered 32 cost less than one
  that delivered 43. Untried: a 60 Hz display, and the felt smoothness of a
  game, which needs the PresentMon protocol. `OCCLARA_DEV_RECORDER_ASK_FPS`
  tries another ask in a game (clips.md, the dev switches), and the session
  counts now carry main's and the GPU process's CPU (`mainCpuP50`,
  `gpuCpuP50`; the minute line says both) so the fleet shows whether it
  worked on other PCs. Their CPU is counted only: the busy rule's 60% stays
  the page's alone, since main at 15 to 30% on a healthy PC would strike.
  test:recorder holds 45, the dev ask (15 to 120, whole, any size) and that
  main and the GPU process at 400% never give up a recording; check:recorder
  draws its picture at 45 and holds the real start line's ask and the real
  counts' main and GPU fields. The same day onboarding's Record gameplay row
  and Settings' folded recording hint (`settings.js SMOOTHEST`, both games)
  gained "For the smoothest game, turn off NVIDIA Instant Replay, AMD ReLive
  or Xbox Game Bar capture while Occlara records.", since a second capture
  of the game doubles the work (this PC's NVIDIA one ran on the Video Encode
  engine through every spike run); the row's own text was cut to "Recorded
  at about 30 fps for clips of your deaths, kept on this PC." so the page
  still fits its card (check:onboardingriot).
- **Never cropped, and never fewer rows than the read.** The display's own
  shape (`fitSize`): asked a box of another shape, this Chromium hands back
  exactly the box (a 1280x600 ask on a 1920x1080 display came back 1280x600).
  The scale is the larger of filling the box and COVERING the read's frame
  (the capture profile's size, `deps.readSize`), never above the display and
  never past H.264 level 4.0's 8160 macroblocks: fitted to the box alone a
  3440x1440 display recorded 1280x536 and the read, stretched to 1280x720,
  drew the score digits and the minimap's labels from a quarter fewer rows
  than GDI. Now 3440x1440 at 720p is 1720x720, 1920x1200 is 1280x800 and
  5120x1440 is 2560x720 at either setting. A recording the level brought under
  the read's frame records on and leaves the read on GDI (`coversRead`), and a
  frame asked bigger than the track is GDI's too. A display smaller than the
  read's frame (1024x768) is recorded whole, and that covers it (`covers` with
  the display): it is every pixel the GDI helper reads, stretched up the same
  way, where measured against the frame alone it left every read of the
  session on the helper's launch a frame. The log says whether the
  track kept the shape. 480p's box is smaller than the Standard read's
  frame, so what a recording covers is the read's frame WITHIN its box
  (8.7): 480p is never fewer rows or columns than 854x480, 3440x1440 records
  1146x480, 1920x1200 854x534, 5120x1440 1706x480, a 1366x768 laptop 854x480,
  1280x1024 854x684 and 1024x768 854x640, all level 3.1, and it never covers
  the Standard read, whose reads stay on the GDI helper (logged at the start);
  covering Performance's 854x480 it serves the read. 720p and 1080p record
  what they did, every read's frame being within their boxes.
- **The read's frame** comes from a clone of the track through a
  MediaStreamTrackProcessor, the newest VideoFrame kept and every other closed,
  drawn STRETCHED to the capture profile's size (1280x720, JPEG 0.7) as
  `OcclaraCapture.cs` does, and only once a comparison with one GDI frame says
  the stream sees the game. Compared at the start and once a minute: the stream
  black (mean under 4 of 255) twice, 5 s apart, while GDI is not stops recording
  for the session ('black', "Recording needs Windowed Fullscreen in this game");
  both black twice puts up "Capture is black". A read the stream cannot serve
  (no frame for 2 s, a page that did not answer) is taken by the helper; three
  unanswered in a row, or a page whose renderer went away, and it is broken
  ('error'). The page reports each second how many VideoFrames it holds open
  (`framesOpen`, the newest, for a moment a clone, and a frame the grid is
  handing on), and at its stop how many are left once it has torn its tracks
  down, and how many of those tracks are still live (`tracksLive`: the
  capture, its clone, the generator), none of either: a frame never closed is
  a capture buffer never given back, and a screen capture has only a few. Each second it says what the
  capture delivered (`fps`, the busy rule's) and what was recorded
  (`recordedFps`, Settings' and the counts').
  A recording is of the display that was primary when it opened, Chromium's
  source being tied to that monitor, while GDI reads whichever is primary at
  each frame: when screen's events say another display is primary now (the
  game moved, a laptop docked), the read is off the stream at once and the
  recording starts again on the new primary (`displaysChanged`), or the read
  and the clips were of Discord on the old one. The GDI helper is DPI aware
  (`SetProcessDPIAware`, native/OcclaraCapture.cs, rebuilt): unaware, at 125%
  it copied only the top left 1536x864 of a 1920x1080 screen, and the read
  changed framing whenever it fell back to GDI.
- **What is kept.** One minute pages beside one `init.mkv` under
  `userData/recording/rec-<stamp>/`, whole Clusters only, so the init segment
  and the pages joined are the recording byte for byte. A page two minutes old
  goes, unless the match in progress began before it ended (`keepSince`) or a
  hold covers it: a finished match is held (`holdRecording`) from its start to
  five minutes past its end, the time a match ended too early can still resume
  in, until its review's work is done (`releaseMatchHolds`, beside its AI log
  frames), an hour at most, or sooner, the moment Riot's look has cut its
  clips (8.3.1, `recordingCut`): its stills are decoded from those clips after
  the match in progress ends, and held to the link's end the match before's
  recording, about 1.6 GB at 1080p, was kept through the whole of the next
  one. A look after it (Riot's again after a failure, the screen's when Riot's
  never finished) takes those clips and asks the recorder for nothing; a look
  from the screen lets nothing go, since Riot's may still follow it
  (`test:clips` runs index.js's own look on the hold counts). `cutClip(from, to, at)` cuts a clip out of the
  pages by wall clock, from the recording that holds `at` (the death) when a
  session has more than one: the first that overlapped was taken before, and
  a death just after a pause came out as the seconds before the pause. And
  from none that does not hold it, to within a second of either end, the
  moment's own estimate: a recording that stopped 2 s before the death still
  overlapped its window, and gave the 10 s before its end as the death's clip.
  The page's wall clock maps onto the recording's timeline from the newest
  frame each chunk carries, within a few ms on the fixture. Since 8.4.2 the
  page also says the moment it handed over its first frame (`firstWall`), and
  as MediaRecorder stamps a generator's frame when it is written, that moment
  is the recording's 0, taken wherever it lies between the start and the
  latest its first twenty chunks allow (`Segment.zero`, `hiFirst`): the chunks
  alone put it 15 to 42 ms late on the generated picture and 29 on the real
  screen, an encoder's latency. The stop's line says both, and how many frames
  were handed over against how many the recording holds: in every run
  measured all of them, the first included, or all but the one written as it
  stopped. AND THE TWO CLOCKS PART (8.4.2): the recording's timeline is the
  page's monotonic clock, the one MediaRecorder stamps by, and the moments a
  clip is cut for are the wall clock's, which Windows moves against it as it
  keeps the time. On this PC, synced with time.windows.com every 34 minutes,
  the wall clock gained 40 to 75 ppm, in steps of about 5 ms, and one offset
  taken at the 0 (8.4.1's chunks did no better) put frames three to five
  minutes into a recording 8 to 15 ms out, so a death forty minutes in 0.1 to
  0.2 s, measured through the real page recording a generated picture that
  carries the wall clock it was drawn at. So each second's report carries
  both clocks (`at`, `mono`), a reading is kept every five seconds
  (`clockAt`), and a clip is cut with the page's first frame moved on by how
  far the two had parted by its moment (`zeroAt`): 98% of the frames of those
  five minutes within 3 ms, the first hundred seconds as the last. A Valorant
  match in progress is kept from its start once a read has landed, menus or not (one
  menu read mid round must not cost it its pages), ninety minutes back at most
  (`valorantKeepSince`): before, a session whose reads failed from Start kept
  every page, about 1.3 GB an hour, with no ledger to clip. Nothing recorded
  stays in memory: a Cluster's bytes go to its page and are dropped, and the
  reader keeps no list of what it closed (`webm.js keepClusters`); kept, ten
  minutes held 225 MB in the main process. Everything a run left is swept at
  launch; everything goes at every quit, at a logout and when Windows ends
  its session (`shutdown()`, synchronous: from cleanupAndQuit, from
  before-quit for a quit that is not the tray's, an update's Restart now,
  which skips cleanupAndQuit, and from the main window's 'session-end'
  through `mainWindow.onSessionEnd`, since no before-quit comes then and the
  process can be ended next), and at an uninstall
  (`build/uninstaller.nsh`, which kills the app first), with the AI log's
  frames of the screen from five sessions, which the app prunes only at
  a Start and which had stayed after an uninstall for good. A logout ends the
  recording before it clears the licence key, so its counts go with it. Off chosen by hand
  takes every recording and hold with it (`discard`), so no clip is cut after
  it; Auto turning itself off (`strike()`) is not that, and its match keeps
  its clips. Nothing starts under 8 GB free or goes on under 4 GB. A League
  game in progress is kept from when its recorder first saw it (`liveSince`).
- **Out of the recording.** The main window while sealed (`main-window.js
  protect()`), the AI log while recording (`ailog-window.js setProtected`,
  from 'running', which is false once after every true, a quit or a logout
  included: a logout used to leave every AI log out of captures for the rest
  of the run), the dock mark always, by content protection, which Windows
  reports only once a window is on screen. Between matches the main window is
  in it, as it is on the player's own screen.
