# The match is recorded on the PC: the recorder

Moved out of CLAUDE.md word for word, nothing reworded or dropped (CLAUDE.md as of commit cc1f880, 8.5.0, lines 1395 to 1619). Sections here: "The match is recorded on the PC". This file is the first half of it, up to the bullet "Out of the recording"; clips.md holds the second half. "Above" and "below" in the text name sections that may now sit in another file under docs/claude/: grep the section's title there to find it. The table in CLAUDE.md says which file to read for which work.

## The match is recorded on the PC

```
src/main/services/recorder.js        pages, holds, the sweep, the disk guard, health, the fallback, the counts
src/main/windows/recorder-window.js  a window nobody sees, the primary display's source, the CPU sample
src/renderer/recorder/               the page: the gate, MediaRecorder fed 30 frames a second (grid.js), the read's frame, health each second
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
  'off', `recordingRes` '720' or '1080'. Judged only while a match is in
  progress, the recorder gives up for the session ('busy') when for 20 s
  straight the capture delivers under 12 frames a second while the picture
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
  then took a whole core in software). MediaRecorder, Matroska first, 3 Mbps at
  720p and 6 at 1080p (more for a recording bigger than its box, in proportion
  to its pixels, twice the box's at most: `bitrateFor`), a keyframe and a chunk
  every second. The capture is asked for 60 fps, because asked for 30 with the
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
  track kept the shape.
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
