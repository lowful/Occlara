# Nothing reaches the screen during a match

Moved out of CLAUDE.md word for word, nothing reworded or dropped (CLAUDE.md as of commit cc1f880, 8.5.0, lines 14 to 66). Sections here: "Nothing reaches the screen during a match, in any game". "Above" and "below" in the text name sections that may now sit in another file under docs/claude/: grep the section's title there to find it. The table in CLAUDE.md says which file to read for which work.

## Nothing reaches the screen during a match, in any game

Occlara used to show live tips. They are **removed**, not paused, since 8.0:
the overlay window, the voice coach, the tip library, tip history, tip styles,
force tip and explain tip are gone from the code, and so is the switch that
used to close them. Do not add any of it back, and do not add anything else
that tells a player what to do while they play.

Riot's VALORANT developer policy lists as unapproved "in-game apps and overlays
that include any real-time data that would improve a player's performance
immediately by altering player behavior (i.e. 'go here now'), vs altering it
upon reflection, learning and coaching the player game over game". A player got
a one week ban with the app flagged as third party. The anti-cheat axis (screen
capture like OBS) was always clean; the written policy was not. League's policy
is stricter still (see below). The second half of that sentence is the product.

## The live status, the one exception (Progress v3)

The owner chose, knowing the rule above and the ban behind it, to show the
match's status on the Recording screen while it is recorded: a deliberate
reversal, kept as narrow as that choice allows.

- **Only the four facts the player's own HUD already shows**: the map, their
  agent (the one the look locked, `agentConfirmed`), the score and the round,
  plus the round tape, which is the score's own history (a round added to the
  team a W, to the enemy an L, a jump of more than one rounds of unknown
  order). Never HP, positions, economy, who is alive, the spike, the enemy, a
  read, a tip, the read cadence, or anything of a review. Nothing on it says
  what to do. The review stays a locked ring, "Nothing is coached while you
  play".
- **Main decides it** (`index.js liveView`, checked once a second, sent only
  when it changed on `PUSH_LIVE`, `LIVE_GET` for a shell loaded mid match).
  Only a Valorant match the reader is under way in; `{ state: 'waiting' }`
  before it is; null when nothing is recorded. Each fact is left out in main
  while its switch is off (`liveMap`, `liveAgent`, `liveScore`, `liveRound`,
  on by default, Settings' "Match status while recording" and the screen's
  own Choose), so a fact switched off never reaches a window.
- **The pages stay sealed.** The live status is the Recording screen's alone;
  every page, the AI log, Ask Coach, the eye, Ctrl+Shift+E and the rest below
  stay exactly as sealed as before. League keeps the quiet screen.
- **Nothing on it moves** but its arrival and the facts changing: no ticking
  clock (it says when the recording started), no pulse.
- **The read cadence line is gone** from the sealed screen
  (`paintSealedFacts` used to write "Reading your game every 1s in a live
  round" onto it, a live number about the match).
- `check:mainwindow` plays a match by and holds the screen to the four facts
  and the tape, and to none of the HP, credits, players alive, spot and spike
  the reader's context also held.
- The public site's fair-play copy and FAQ still say nothing is shown mid
  match; they live in the website repo and must change with this.

## The live rating, the second exception (2026-11-26)

The owner asked for the player's match rating (rating.md) visible and moving
while the match is played, like a football player's live rating, for players
and for streams. He was told it widens the rule above (Riot's policy on
real-time data, the one week ban) and chose, on 2026-11-26: **the Recording
screen plus a stream widget, opt in.** A second deliberate exception, kept
exactly as narrow as that choice:

- **Off by default.** One Settings switch, `liveRating`, under "Match status
  while recording", with the warning beside it in plain words (it shows a
  number about your play while you play; Riot does not approve apps that
  show real-time data that changes how you play; Occlara shows a number and
  what happened, never what to do; your choice) and a confirm before it
  turns on (Off asks nothing). A second switch, `liveRatingStream`, for the
  stream widget, locked while the first is off; turning the rating off turns
  it off. The Recording screen's own Choose cannot turn it on.
- **What may show:** the rating (0.0 to 10.0) in its tier's badge, its last
  move (signed) with the engine's plain label of what happened ("First
  kill, 5v5", "Died first, 5v5"), a small line of the rating so far, marked
  "Live, provisional". After the match, on the widget only, "Full time" with
  the confirmed number for two minutes once Riot's record has linked.
  **Never** advice, a tip, a read, HP, positions, economy, the enemy, who is
  alive, or anything of a review. The label says what happened, never what
  to do.
- **Never a window over the game, never an overlay, never a sound.** The
  Recording screen is the main window behind the game, as before. The widget
  is a page OBS fetches from a loopback server and lays on the stream;
  Occlara draws nothing over the game.
- **Every other sealed surface stays exactly as sealed.** League gets
  nothing (no reader feeds it). An import shows nothing live (its reader has
  no hook).
- **Main decides it** (index.js `feedLiveRating`, `syncLiveRating`,
  `liveView`; `live-rating-service.js` `feed`, `field`, `widget`, `pick`):
  read only while the switch is on, sent on PUSH_LIVE only when it changed
  (the tick compares the whole view), only its own fields
  (`{ value, shown, tier, last: { delta, up, down, label }, line }`), and
  nothing else of the reader's context. With the switch off no frame is read
  for it, nothing is kept, PUSH_LIVE has no `rating` key and the widget's
  server is stopped: no rating data exists in any window or leaves main.
- **The widget's server** (rating-stream.js) is bound to 127.0.0.1 alone,
  started only while both switches are on and stopped (every connection
  cut) the moment either goes off; every path carries a per install random
  token main makes and keeps (no page can write it); the Host header must be
  the loopback address and its port (DNS rebinding); it answers the page and
  its events and nothing else, with no CORS header.
- **Nothing on the screen moves** but a fact arriving or changing: the
  badge's number counts once to a new value and the move rises or falls
  once, no pulse, no ticking.
- `check:mainwindow` holds the Recording screen to no rating with the switch
  off (frames with the player's kill handed to main all the same), to the
  number, its move and "Live, provisional" with it on and to the rating's
  own fields in PUSH_LIVE, and to none again once off; `test:liveratingwiring`
  holds main's gates; `test:ratingstream` the server.
- The public site's fair play copy says nothing is shown mid match; it lives
  in the website repo and must change with this, as with the live status.

## The flag key's tick, the one sound (8.13)

The owner chose it: a press of the flag key plays one quiet tick mid match, because the window is behind the game and nothing else could say the key was heard. It is the same tick for every press, a death matched or not, so it carries nothing about the match, and it follows the Sounds setting. Nothing is drawn, and no other sound plays mid match (`docs/claude/death-flags.md`).

What still counts as "reaching the screen", and is sealed mid match:

- The main window shows no page at all mid match, only a Recording screen, and
  its sidebar's pages are locked (`syncSeal`, below under The UI), because an
  open page on a second monitor is the same live feed. A stop in the middle of
  a match holds that seal until the player opens a page. Held, and in League,
  the screen is the quiet one (the crescent, one line, two facts as ruled rows,
  `shell.css .sealed-quiet`); in a Valorant match it is the live status above.
  It rises in once, the live dot never pulses, and no capsule thumb or reveal
  runs while it is up.
- The corner mark, the always on top crescent the window leaves at the top
  right of the screen while it is hidden, goes while the seal is on, live or
  held, and comes back once it lifts with the window still hidden (8.3.2,
  `placeMark` in index.js, `check:seal`). It showed nothing, but it sat over
  Valorant's kill feed, and the window is hidden exactly while a match is
  played.
- The AI log seals the live session (`liveLogSealed`), because an open log on a
  second monitor is a live feed of the match by another name. Frame chat refuses
  it, and Ask Coach answers nothing mid match: the question is refused before
  any request is made (8.5.0, `ask-coach.js`, `MID_MATCH`), its one time fill
  waits, and a review saved after a stop mid match is held from it (below,
  "Ask Coach knows the match it is asked about"). A
  review's eye (below) does nothing mid match, and its read of one match is
  sealed the same way when that match is in the live session. The seal is
  decided on the session a read would serve, never the id asked for, and an id
  the log no longer keeps is gone, never replaced by the newest folder, which
  mid match is the session being recorded.
- The review's reveal (8.7, ui.md "The reveal"), its count, its stamp and
  its sound, waits for the seal to lift. It runs inside `occlaraOnShown`
  (embed.js), and a sealed page is never on screen, so a review made whole
  while the next match records is revealed only once the player opens a
  page. Its sound then asks main first and plays only with sounds on and
  `isCoaching` false. Both guards are needed: the first keeps it off the
  screen, the second keeps a page shown between a Start and the seal quiet
  (`test:surfaces`, "revealed once, and heard once, only on screen").
- Ctrl+Shift+E opens the last review, and does nothing while a match is in
  progress (`matchInProgress()`).
- The window's notice line, in the top strip and shown only when there is
  one, carries notices only (a licence ending, capture blocked, the server
  down) and the paused line, never anything about the match.
- The update's restart question waits while the player is playing
  (`updater.js`, `busy` from index.js: a session running, a stop mid match
  holding the seal, or a review still being built, `reviewBeingBuilt`, for
  the hour its match is held at most). It came up whenever the download
  landed, over the game mid round and in agent select, and "Restart now" quit
  the recording and the review being checked with it. It is asked again
  every 30 seconds until then, and names the newest version downloaded
  meanwhile, the one a restart installs (`test:updater`). A question asked
  while idle and left open as a match starts closes itself (its `signal`),
  and an answer is checked against `busy` again, so a "Restart now" pressed
  mid match installs nothing: either way it is asked again once the match is
  over (8.7.2).
- Accounts (8.7, accounts.md): a 402 cap mid match is silent (the engine
  stops reading, recording goes on, the review is saved locked), every cap or
  games left notice and the `ACCOUNT_CHANGED` push wait for the seal to lift
  (flushed from `syncSeal` and `controller.stop`), and the Invite page is a
  page like the others, locked by `syncSeal` (`check:seal`).
- The Moments page (8.7, ui.md) is a page like the others, locked by
  `syncSeal` (`check:seal`), and its compilation player, which plays the kept
  clips of a repeated mistake back to back, asks main whether the window is
  sealed before it opens (`SHELL_GET`) and closes on the page's leave and on
  the document going hidden, so no clip plays mid match (`test:surfaces`). A sign in the
  server stops taking (onRefused) never acts mid match: the recording goes
  on, a read refused after it has no key to revalidate and ends no licence
  (`recheckAuth`, the licence watch only ends a stored key), and the Sign in
  window waits until nothing is recorded AND no seal holds, a stop mid match
  included (`sessionEndedWhileRecording`, flushed with the account waits;
  Start ends it at once, as the player's own choice). `check:sessionend`.
- What's new and the Discord (changelog.md): the What's new page is a page
  like the others, locked by `syncSeal`; the sidebar's Discord icon is locked
  with the pages and drawn as the lock, and main refuses the invite mid match
  or sealed (`community.js`); Home's update line is answered null while
  recording, mid match or sealed and pushed only once the seal lifts, the
  cap's notice's wait (`check:seal`).
- Report a problem (feedback.md): the page is a page like the others,
  locked by `syncSeal`, its flag above the Discord drawn as the lock, and
  main answers its four channels with nothing mid match or sealed: no info,
  no picture taken, no report sent (`feedback-service.js`, `check:seal`).
- The games toast (8.9.1, ui.md "The games toast"): "You got 2 games" at the
  top right, its own view over the pages, WAITS mid match. index.js takes no
  toast off its waiting list while a match is in progress or the window is
  sealed (`flushGamesToasts`, from `flushAccountWaits`, so the seal lifting
  and a stop flush it), the list is kept in the store across a restart, and
  the window's toast view shows nothing while sealed, hidden or minimised:
  one on screen as the seal comes on goes in the same tick and is shown whole
  later. A click opens Profile only while unsealed (`check:seal`,
  `test:shellnav`, `test:gamestoast`).
- The Trainer (trainer.md), the aim and movement trainer: a page like the
  others, locked by `syncSeal`, so it is never shown mid match and its loop,
  which runs only while the page is on screen with the pointer locked, cannot
  run then. Main answers its channels with nothing mid match or sealed
  (`trainer-store.js busy`: no runs, no save, no clear, and Practice's Train
  this opens nothing).
- Occlara Wrapped (wrapped.md), the year's story, is a view of its own over
  the whole window, and THE SEAL CLOSES IT in the tick it comes on
  (`main-window.js setSealed`, `closeWrapped`): taken off the window, its
  audio muted at once and its page closed, so nothing of it is seen or heard
  mid match, and the keyboard is given to nothing as it goes, since on
  Windows focusing a page raises the window over the game
  (`closeWrapped({ refocus: false })`). It never opens while sealed, hidden or minimised
  (`openWrapped`), main answers `WRAPPED_GET` and `WRAPPED_ENTRY` with null
  and `WRAPPED_OPEN` with `{ ok: false, error: 'match' }` mid match or sealed
  (`wrapped-service.js busy`), Home's invitation is hidden then, and its one
  time auto open waits for a show or a focus after the seal lifts, never at
  the lift itself (`check:seal`, `check:wrapped`, `test:shellnav`).
- Fight it again (trainer.md, "Fight it again"), the review's button that
  opens a death in the Trainer, never shows or runs mid match. index.js
  `present` marks no card with a replay id while a match is in progress or the
  window is sealed, so no button is drawn, and the review page is sealed like
  the rest. Main refuses every way in through `trainer-store.js busy`:
  `TRAINER_REPLAYS` answers null, `TRAINER_REPLAYS_SEEN` and a replay run's
  `TRAINER_SAVE` answer `{ ok: false, error: 'match' }`, `TRAINER_OPEN` with a
  `replay:` id opens nothing, and nothing is stored (no run, no `seenAt`).
  The Trainer's `begin` asks `TRAINER_GET` first and starts no fight on a
  null. `check:seal` holds each of those mid match.
- The Trainer's hold on the Ctrl+Shift keys can never happen mid match. While
  the Trainer has the pointer locked, main lets go of Ctrl+Shift+P, M, S, E
  and H (`hotkeys.js suspend`), because Ctrl is crouch and Shift is walk in
  the Trainer and crouch-walking back with S would open Settings. Main lets
  them go only when the page says it locked (`TRAINER_PLAYING`, from the
  Trainer's own view), no match is in progress, the window is not sealed and
  the Trainer is the page in front of a focused, unminimised window
  (`index.js trainerInFront`); and a 1 s tick takes them back whenever any of
  that stops being true. A match starting seals the window, so the keys are
  back within a second at most whatever the page said, and the Trainer
  itself pauses whenever its window loses focus, its page is left or hidden,
  or it loses the pointer; in its menu it draws one still frame and runs no
  loop at all. The flag key is never touched: it is held only mid match,
  when the Trainer is sealed.

## Occlara Duos is silent mid match, and its uploads stop (2026-11-25)

The Duos page (docs/claude/duos.md) is a page of the main window, sealed like
every page, and its row in the account menu is locked by the seal. Every duo
channel answers null mid match or sealed with no request made, the uploader's
tick does nothing then, and an upload in flight is aborted the moment a match
starts (it competes with the game for the player's connection) and sent again
after it. A partner's new pins are said only on the Duos page, the next time it
is opened: never a notification mid match, and no OS notification at all.
check:seal holds the page, the row, every channel and the tick; test:duos holds
the abort on a real upload.
