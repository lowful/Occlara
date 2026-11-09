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
