# Occlara

A post-match AI coach for Valorant and League of Legends. An Electron client
reads the game while it is played, shows NOTHING during the match, and when it
ends opens a graded review: a score out of 100 with four categories and their
evidence, the player's repeated mistakes with a fix for each, what went well,
and what was missed. Every review is kept in the match library, which also
counts what keeps repeating across matches.

The client never reads game memory, never touches game files, and never
automates input. It captures the display the same way OBS does. That property
is the whole product, so nothing should ever be added that breaks it.

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

What still counts as "reaching the screen", and is sealed mid match:

- The main window shows no page at all mid match, only a Recording screen, and
  its sidebar's pages are locked (`syncSeal`, below under The UI), because an
  open page on a second monitor is the same live feed. A stop in the middle of
  a match holds that seal until the player opens a page.
- The corner mark, the always on top aperture the window leaves at the top
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
  meanwhile, the one a restart installs (`test:updater`).

### How the match becomes a review

```
src/main/services/coaching-engine.js  the READER: capture, /api/coach/read, the STATE guards
src/shared/read-cadence.js            how often each phase is read, the engine's gap a floor
src/shared/valorant-rounds.js         the round ledger, fed the engine's GUARDED context
src/shared/match-end.js               when the match is over
src/shared/valorant-verify.js         Riot's record laid over the ledger
src/shared/death-frames.js            which deaths to look at, and which frames show them
server/services/death-forensics.js    the model's look at those frames: a cause from a closed list
src/shared/valorant-review.js         the computed review, which carries the two below
src/shared/insights.js                repeated mistakes, strengths, misses: counted, per game
src/shared/grade.js                   0 to 100, a letter, four categories with evidence, per game
server/services/match-review.js       the model's half: summary, a why per round, focus
src/main/services/review-store.js     every review saved, userData/reviews, with its frames and clips
src/shared/patterns.js                what repeats across the last ten matches of a game
src/shared/breakdown.js               the library by map and agent (or champion), counted
src/shared/riot-review.js             a review from Riot's record alone, or a recording linked late
src/main/services/backfill.js         Connect grades the last ten matches from Riot's record; the late link at launch
src/renderer/review/                  one page for every game, branched on review.kind
src/renderer/matches/                 the library, "Your patterns" and the breakdown pages
src/renderer/home/                    the last match, its focus, the rank and the top repeated mistake
```

**The read is facts only.** `POST /api/coach/read` (`server/services/read-prompt.js`)
returns `LOBBY` or one STATE line, the same shape `mapState()` has always parsed,
plus a `note`: one factual observation of what the player is doing. No tip is
written anywhere. The engine keeps **up to four reads in flight** (two until a
latency is measured, then `inFlightLimit()`: p90 over the gap rounded up, plus
one) and applies them in capture order (`seq`, `pending`, `drain`), because the
ledger, the death edge and scoreboard continuity all assume time runs forwards.
So a read's context is the last APPLIED reply's, four reads old with four out,
and `bench:read -- --lag 4` measures the read on exactly that. A read gives up
at 12 seconds (the server at 9), because one hung read holds every reply behind
it. But every guard, the ledger and the match-end watch reckon on when a frame
was CAPTURED (`applyRead`'s `at`), never when its reply was applied: on
application time the same session read differently from run to run, the
Sunset post plant filed under round 6 and the Abyss swiftplay's round 1 death
lost at a read p90 of 2.7 seconds (`test:sessionreplay` replays five sessions
with latency drawn, `test:cadence` holds the ledger to capture time).

**The cadence is measured, not chosen.** `captureSpeed` is `auto` or a pinned
tier from `CAPTURE_TIERS` (1, 2, 3, 5 seconds). Auto starts at 1s and steps
down only when p90 latency passes four gaps and a tenth, after three failed
reads in a row, or on a 429 (which also stops sending for ten seconds), and
back up when p90 falls under 70% of what four in flight cover at the faster
tier (`adaptCadence`). At a fixed two in flight it ran at 2s falling to 3s on
real sessions. `npm run test:cadence` drives the real engine on a fake clock.
The capture helper's p50 and p90 go to the log every 60 frames: past about
700ms, the per frame launch alone is too slow for a steady 1s. The read model
was chosen by `npm run bench:read`, scored against Riot's record of the real
Abyss match; the numbers are in `server/routes/coach.js` beside `readModel`,
their tier the one auto holds at each p90 with up to four in flight. DeepSeek
V4.1 Flash was chosen when two in flight made it the only one that sustained
a read a second, invented no death and read every label; of the four that
hold 1s now, it and Ling 3.0 invent no death, and DeepSeek agrees with more
of Riot's deaths at under half the latency.

**And the gap is a floor, phase by phase** (8.3.2, `src/shared/read-cadence.js`).
The read is 97 to 99% of the AI bill, and it went out every gap from Start to
Stop: on the Sunset swiftplay, read a second, 29% of the reads were the buy
phase, 23% the player dead, 12% menus, agent select and loading, 8% a menu
inside the match (the shop, the big map) and 3% the end screen. So `tick()`
reads at the slower of the gap and the phase's own, decided on the last
APPLIED read, never the one in flight, and at the gap again whenever that read
was captured longer ago than the phase's gap and 4 s (a pause, an outage, a
12 s hung read, a 429). The tiers, `inFlightLimit`, the `cadence` event (the
tier, which Settings' line gives as the live round's gap, saying the rest is
read less often, and the Recording screen's capture row as the gap "in a live
round") and every guard are
untouched, and a pinned speed stays the floor.

- **Menus** out of a match: every 5 s after two LOBBY replies in a row, every
  10 s once the run passes three minutes. Only the next match's first game
  read needs them, and the seal and the ledger begin on it, so the seal can
  come up to 5 s (10 s) later, inside round 1's 45 s buy phase, before
  anything of the match has been read.
- **A menu inside the match**: the shop, two LOBBY replies in the ledger's own
  buy phase with its timer more than 5 s from running out, every 3 s, and the
  gap from 5 s before the barriers drop to 15 s after. Any other (the big map,
  Escape, an alt tab): ten replies at the gap first, then every 3 s, and every
  5 s once the run reaches 45 s, the end screen, which the menu path ends by
  time, not by reads.
- **The buy phase sleeps on a timer two reads agree on**: two frames that each
  set the ledger's buy end from the clock printed on them, the ends within
  2 s, at least 1.8 s apart and showing different seconds (a still number
  misread twice is one read, the ledger's rule). Then a read every 5 s, the
  shop's included, until 4 s before the barriers drop. It wakes at once on a
  post plant or a planted spike, the player held dead, an active read whose
  clock is not that timer's (none, over 0:45, more than 3 s off), or a buy
  timer more than 3 s off. The cost audit's rule, one read's timer, skipped
  every clocked buy read after a LOBBY, so `buyUntil` was never set and the
  Abyss swiftplay's round 2 combat report registered a death in every draw.
  Sunset round 5's "buy 0:39" off the ammo counter is a misread to the ledger
  and sets no buy end; without the 1.8 s, two misreads a second apart slept
  through four seconds of a live round. And it sleeps only while the engine's
  own combat report window (`buyUntil`) still reaches the end of the sleep: a
  buy read with no clock cut that window to 2 s (since 8.3.2 only a window one
  clocked read opened, or one the ledger's buy end does not agree with,
  "Nobody dies in a buy phase" below), read every second
  the clocked read after it puts it back, and asleep the read 5 s later was the
  combat report, registered as the round's death in its buy phase, which took
  the real death's place and emptied the round's notes. On 1,500 random buy
  phases through the real engine (a buy read without its clock 6% and 15% of
  the time, the combat report in 80% of them) reading everything registered
  26 and 61 such deaths, the sleep without the check 16 to 30 and 42 to 55,
  with it 12 to 20 and 26 to 47.
- **Dead**: the gap for 5 s after the death (the frame after it is Riot's
  look's) and while a weak tell's death is on trial, then every 3 s until a
  buy read or an alive read. The gap instead at match point (a team on 12, on
  4 in a swiftplay or a match of no known mode, or one round from any final),
  while a score step or a final waits for its second read, and on a tell that
  names neither the spectator screen nor the death screen. Without the 5 s and
  the waiting step, a remake's second round and a swiftplay final's last lost
  their results.
- **Rounds 4 and 5 are read whole while the mode is unknown**, every phase, and
  the buy phases of rounds 4 to 9 never sleep: round 5's buy phase tells the
  mode, round 4's step takes two reads to put the ledger there, and the side
  swap fallback counts four buy reads in rounds 5 to 8. The window opens on
  the score a read printed before the guards hold a step for its second read
  (round 4's buy phase began on the Sunset match with the context a round
  behind), and a misread score never closes it.
- **The live round**, the post plant and the banner alive: the gap.

Through the real engine at a read a second, each session with the menus it had
between Start and Stop, the cadence sends 37.1% fewer reads on the Sunset
(760 to 478), 37.2% on the Abyss swiftplay and 35.2% on the Split (both read
every 2 s, counted on a 1 s grid): an hour from $2.36 to $1.52 at DeepSeek's own
price, $0.92 to $0.60 at OpenRouter's spread. Every death registers on the same
frame, every round keeps its result and its reads, the mode locks on the same
read and the four looks pick the same frames. What differs was measured and
accepted: the wrong Haven lock not taken on the Sunset and taken 11 s later on
the Abyss swiftplay (the right map on the same read), the Split's invented
round 18 death (round 17's combat report) not registered (the buy window rule
under "Nobody dies in a buy phase" now drops it reading everything too), a
plant callout in
other words for the same site, round 6's moment 0.1 to 0.2 s, and the menu
path's end up to 5 s later. The only live reads left unread are buy phase
frames the model called active (0:17 to 0:19). Known exposure: a Stop pressed
on a round's banner while dead, outside match point, can leave that round
without a result. The capture log's line every 60 frames ends with what the
phase held back ("347 reads skipped by phase (idle 203, menus 144)").
`npm run test:readpolicy` holds every rule at its boundary, the edge cases on
the 200 ms heartbeat, and the real sessions through the real engine at
the cadence's own capture times (the fixtures' `thinned` counts put back the
LOBBY replies the log never writes), the latency drawn per frame; each rule
reverted fails it. The Fracture swiftplay joined them in 8.4.1: 28.9% fewer
reads, with only the menu path's end moved.

**The score lags the round in both directions**, measured on a real 24 round
match in `scripts/fixtures/`: a buy phase starts while the score still reads the
old number, and the round end banner prints the next score while the player is
still spectating. The ledger advances on a buy phase after mid round play, and
files a death before the new round's first buy back into the round that ended.
"Play" needs a mid round clock, because the banner is an active phase frame
with 0:01 on it, and counting it cascaded every later round by one. At a read a
second the model also says "buy" with the round timer on screen and "active"
with the buy timer on screen, so a buy phase is a buy read with at most 0:45 on
it, and lasts until the buy timer it showed runs out (`isBuyPhase`).

**Nobody dies in a buy phase.** Valorant shows the last round's COMBAT REPORT
again as the buy phase starts, "KILLED BY Reyna" in its panel, and on a real
competitive session 9 of 29 death registrations were that panel, each filed
into the new round where the ledger's one death a round then refused the
round's real death. While a buy timer is running a dead read is a living player
buying, in the engine and in the AI log's death list. A buy read with no clock
never cuts short a window two clocked reads agree on (8.3.2, `buyWindow`: two
different seconds of the timer, ending within two seconds of each other): on
the real Split "buy 0:24" and "buy 0:18" held it to 1811 s, a "buy" read at
1802.6 s cut it to two seconds, and round 17's combat report was round 18's
death, a round Riot has the player alive. A window ONE clocked read opened is
still cut, because that read can be a misread mid round: on the Abyss swiftplay
"buy 0:29" was read with the round clock at a minute, and the "buy" read after
it is what let round 1's real death register (`test:sessionreplay` holds both).
Nor one the round ledger's own buy end does not agree with, within 3 s
(`buyEndsAt`), because two misreads can agree by chance, and the ledger takes a
buy timer read after play only when its clock can be one (`buyVerdict`), so a
post plant's misreads set it nothing. The Sunset swiftplay's round 5 post plant
read five "buy" timers in six seconds, 0:39, 0:13, 0:23, 0:19 and 0:39: had the
last been 0:18, it and the 0:19 would have held the window over the rest of the
post plant, a real death there read as the combat report (`test:sessionreplay`
replays it with one there, `test:readpolicy` holds the rule).

**The mode comes from printed numbers in round 5's buy phase.** Swiftplay swaps
sides after round 4, so its round 5 is a pistol round: 800 credits and a 45
second buy timer. A standard round 5 has four rounds of money and 30 seconds.
Measured: swiftplay round 5 bought at 0:43 with 800, competitive at 0:29 with
3,550. The side swap used to be the swiftplay tell, and it is the model's
inference: on a real competitive match it read the side flipped twice in two
seconds, locked swiftplay, and the wrong lock went back to the model as context,
so rounds 5 to 9 all read as defence. It is now a fallback (buy phase reads
only, four in a row), and a buy phase with a team on 5 proves standard.
And round 5's money and timer count only from a buy read whose own clock puts
its buy phase's start after the ledger's last play frame, to within 2 s (8.4.1,
`beganAfterPlay`, buyVerdict's start, `PLAY_SLACK_MS`), because the round end
countdown reads like a buy timer: on the player's Fracture swiftplay the TAB
scoreboard was open over round 4's, "buy 0:01" and "buy 0:00" with round 4's
4,550 credits, after the banner's 4 to 0 had moved the ledger to round 5. Those
two locked standard, nothing could take it back, rounds 5 and 6 went to
defence by the halftime math, 4 to 1 was no match point, so round 6's dead
phase was read every 3 s and the final 5 to 1 fell between two reads, and the
review waited for Stop. A timer at 0:01 began 29 s before it was read, inside
round 4; the real buy phase's 0:43 and 0:42 lock swiftplay, and the four other
sessions lock on the same read as before (`test:sessionreplay`, on
`valorant-session-fracture-swiftplay.json`). A buy read with no clock of its
own counts for nothing. The 2 s are the whole second the clock shows and the
countdown's own 0:00: its frames carry the "postplant" of a read on it, so on
the player's Sunset swiftplay its 0:00 was the last frame of play, a tenth
before the start round 5's 0:43 gave. Taken exactly, as buyVerdict takes it,
that 0:43 read 0.1 s earlier counted for nothing, and with every frame moved
up to 0.3 s the pistol timer locked swiftplay in 16 of 30 runs, the side swap
in the rest; in a standard match the side swap is then free of the economy
that holds it back. With the 2 s it is 30 of 30, and the countdown, begun by
its clock half a minute before the buy phase, stays refused. Known exposure:
the last play frame is the last one the player was alive in, so a player dead
through the end of round 4 leaves it early (50 s before round 5's buy phase on
the Abyss swiftplay, 17 s on the Split), and a countdown read as a buy timer
there would still count.

**A match ends** on a score no mode can continue from, confirmed by the game
stopping: a menu frame (the end of match screen reads as one), or twenty seconds
of reads at that score with no buy phase and no running round clock. "A second
read" stopped being enough at a read a second, because two reads a second apart
are one moment read twice. A swiftplay final needs the menu, twice, because 5 to
3 is an ordinary standard score and swiftplay is the weakest fact the engine
has. Or on most of a minute of menus after three rounds. 13 to 12 is
deliberately not final: unrated ends there and competitive does not. Too early
is the expensive direction, because it opens a review over a round in progress.

**And if it was not the end, the match resumes.** Play that carries on from the
ended score (a buy phase at it, or a higher score), read twice within five
minutes on the same map, puts the match back with every frame read since, and
the review it opened is withdrawn from the review page and the library. A real
session ended a competitive match at 3 to 5 in round 9, ignored the rest as the
end screen, and stopping at 12 to 7 reviewed nothing. A new match the watch
never saw the last one end (a remake, an unrated 13-12 with no menus read)
closes the last one into the library, never opened over the new one. It is
believed on time, not reads (8.4.3, `newMatchRun`): 0 to 0, 1 to 0 or 0 to 1
read over ten seconds, first such read to the latest, on three reads at least,
with no read of the held score or a higher one between them; once the watch
has ended the match, one read. Two reads in a row from round 5 were enough,
and at a read a second they are one moment read twice: on the bench the live
read prompt read the Fracture's round 5, 4 to 0 printed plainly, as 0 to 0
three times in two seconds, which closed the match into the library at round 5
and filed the rest of it as a new match (`test:sessionreplay` lays those
replies over the AI log's reads of the same frames). A real new match spends
45 seconds in its first buy phase at 0 to 0, and what the wait filed into the
old match's ledger (the new match's reads with no score of their own, at the
old one's held score) comes off it again: filed, a buy read there was a round
bought at 13 to 12 that nobody played (`test:newmatch`, `test:scoreguards`).
The frames of the count that is believed are the new match's, and they are
filed into its ledger then, each at the low score it read (or the last one
read before it) and with no side, since the old match's side lock held their
side meanwhile: held and filed nowhere, a death read in them was lost, and a
remake whose reads began in its round 1, its buy phase paused through, lost
the death seven seconds in at a read every 1, 2 and 3 seconds
(`test:readpolicy`). Frames from before the wait last started again are not
among them, a death of the old match included (`test:scoreguards`). Their AI
log records were written as they came, under the old match's stamp and its
last round, so a look at a death among them finds no frame of that round
before the belief. And the closed match is reviewed on its context as the wait
began, its map, mode and agent: the next match's reads go on landing in the
live context meanwhile, two of another map correct a map the model's reads
hold, and the closed match took the next one's map, which the link then
refused its own match for. A Stop while the wait counts reviews the old match
the same way, its own rounds (none bought by the low reads the wait held) on
its context as the wait began, and only its score the live one, the guards'
own, which no read of the next match moves and a final adopted at the Stop
sets: reviewed on the live context, a Stop two reads into the next match took
that match's map (`test:scoreguards`). And all of it within thirty seconds of
the wait's first read (`NEW_MATCH_WITHIN_MS`): the first read past that
starts the wait again when it is a low one, and ends it when it is not. A
read with no score of its own never ends a wait, and a real session goes
minutes without one: over the Abyss match's 144 seconds with
none, two rounds and fifteen reads, 0 to 0 laid on five of them 24 to 31
seconds apart was a new match on the third, the match closed into the library
at round 10 (`test:sessionreplay`). What the wait kept of the old match stays
when it starts again, until the held score is read again: a shop held half a
minute splits a real new match's first low reads, and taken again there, the
old match was reviewed on the next one's map with a round 27 bought at 13 to
12 (`test:scoreguards`). A new match's first buy phase is read every 5 seconds
at the slowest (the slowest capture speed, or the buy phase asleep), so it is
believed on its third read, ten seconds after its first: `test:readpolicy`
runs its remake at every capture speed through the real engine and its
cadence, believed 10 to 12 seconds after its first low read (12 at a read
every 3 seconds) with its own round 1 in its ledger; the remake, the unrated
13-12 and every new match `test:newmatch` held before the bound are believed
on the same read as without it; and `test:newmatch` holds both edges, 30
seconds inside it and 31 past it.
`npm run test:sessionreplay` replays that session and four others through the
real engine, deaths checked against Riot's record. A match ended early that
never resumed, that 8.0.1 review among them, is Riot's record's to put right
("Ended early by the watch", under "Matches graded from Riot's record").

**What the review may claim.** No "survived" line unless Riot says so, no death
timing to the second without Riot, no result unless a score end or Riot's record
says so, a spawn is never a death spot, and every insight and pattern must clear
its stated floor. The review is SAVED the moment the match ends, before the
narrative call (`match-ended`), because a quit or a Stop then Start in that
minute lost it or pointed its death frames at the next session's empty log. The
review page opens at once, on its loading screen while the review is built
(below), and every version is saved to the same review id as it lands, except
the corrected numbers held while the summary is rewritten. It never opens over
a match in progress: one already under way, or the one recording was stopped in
the middle of, which is saved to Matches with a notice. Each review keeps its
own Riot retries, and stopping recording does not cancel them: each try is
verified against that match's own window, so a late answer can only be that
match. The link checks the newest match and the four before it, and refuses a
deathmatch, a match with fewer rounds than the coach watched, and a match
already linked to another review.

**A review still being built is a loading screen, not a half review** (8.4.1,
the player's ask: "if the match review is not complete, loading and verifying
from Riot, have it as a loading screen until everything is complete"). The page
used to paint the screen's review at the end and repaint it three times as the
rest landed. Now each job says what is left of its work (`src/shared/review-work.js
workOf`, from flags the steps set: `byRiot` and `narrated` as the narrative
comes back, `tracker`, `riotBusy` and `stage` while Riot's record is laid over,
`screenLooked`, `finished`), it goes with the review (`present()`) and every
library row, and it is pushed on every change (`PUSH_REVIEW_WORK`), at each
step and by a second's tick while any review waits. The page shows the steps in
the Recording screen's shape: with Riot's record, the match saved, waiting for
Riot's record (usually 1 to 4 minutes, with the time since the end and how long
it waits), checking the deaths, the coach's look, the review written; from the
screen alone, saved, written, the look. NOTHING ON IT MOVES FOR LONG, nor on
the pill below: with its mark turning and its dot breathing the page was
composited every frame, and the look's stills, decoded from the clip on the GPU
while it waits, timed out in check:clips in three runs of three (0.7 s with it
still), so it rises in once and its ticking clock says the work goes on. It
holds every version meanwhile and paints the last one whole once the work is
null: Riot's look landed and the read rewritten, the link given up, or from the
screen alone the narrative and the screen's look done. IT NEVER WAITS FOREVER: Riot's record not in six minutes after the end,
the screen's review is painted with the note it carries already (the scoreboard
fills in once the match is published) and repaints when the record lands;
nothing is a loading screen past twelve; and a job once painted whole is done
for good (`released`), so a record landing late never turns it back. Never for
a part of a match (a stop mid match, the next match begun over it), a review
saved before, or League, whose reviews are whole at the end. Home's last match
and its recent row, and its row in Matches, show `GradeView.checking` where the
grade, result and score would be (the Matches header counts no result for it),
and repaint on the push. `test:surfaces` holds `workOf` and the three pages,
and main's own tick and latch (`workOfJob`, `noteWork`, `watchWork`) in a
sandbox on a fake clock: Riot's record not in, the page told at six minutes
with nothing else happening, and Riot's rounds landing at seven never a loading
screen again. `test:homemodel` holds the rows, `check:mainwindow` the loading
screen through the real index.js with a stand-in reader, and Home and Matches
beside it.

**Variant C won the review bench** (`npm run bench:review`, live, spends money)
by making fewer unsupported claims than B; the numbers are in `match-review.js`.
The model's reply is RAW text from `textInfer(..., { json: true })`, sanitized
per field after parsing, because `sanitize()` collapses newlines and the first
bench got every labelled line back as one. Spelled round numbers are turned into
digits in code (`roundDigits`), because the prompt asking was ignored about half
the time, and the ledger's own labels are written out (8.4.1, `roundLabels`):
the prompt names each round R1, R2, and the player's Fracture swiftplay summary
said "survived R1, R3 and R4", so a run of them is "rounds 1, 3 and 4" in the
summary, the focus and the round lines, before any gate reads a sentence's
rounds. In an English review only: the words are English, and written out in
a Spanish one "R1, R3 y R4" read "rounds 1, 3 y round 4", so a review in the
player's own language keeps the label. It runs on the server as the reply is
parsed, so a review saved before keeps the labels it was written with, the
Fracture swiftplay's "survived R1, R3 and R4" among them: a saved review does
not say which language it is in. The review is written in the player's
language (`languageRule`); the labels stay English because `parse()` reads them.

`npm run test:valorantreview` replays both real fixtures through all of it.

### Riot's record overrides the screen

**The screen is wrong in ways only Riot can show.** Checked against Riot's
record of the real Abyss fixture (`scripts/fixtures/riot-abyss-13-11.json`): the
screen read 22 deaths where Riot has 21 (round 17 invented from one post-plant
spectator frame), put 6 deaths in the first 30 seconds where Riot puts 16, and
5 of the coach's own reads named the wrong killer. The timing error is the
spectator trap: after a death the HUD shows a teammate alive at 100 health, so
the coach thinks the player lived another half minute.

So when `fetchCoachedMatch` links the match, `withRiot()` in `src/main/index.js`
fetches `/api/coach/match-rounds` (parsed in `server/services/riot-rounds.js`)
and `valorant-verify.js` reconciles: deaths, the second, the killer and weapon,
first death, first kill, kills and round results are Riot's; the screen keeps
only the location, the ult icon and what the coach noted. Reads Riot contradicts
are dropped. A weapon is Riot's name for it, never its type (8.4.1,
`riot-rounds.js weaponOf`, in the round record and the AI log's death check):
HenrikDev gives a kill it cannot name (an ability, most likely Chamber's
Headhunter there) a type of "Weapon" or "Ability", and the player's Fracture
round 6 read "to Chamber with a Weapon" on the card, the strip and both
prompts. With no name
the line is "to Chamber". The client reads a type word as no weapon too
(`valorant-verify.js weaponName`, the list held equal to the server's), since
a server from before still sends one, and a review saved with one is shown
without it (`served()`), never rewritten. Since 8.3.1 the plant's site is
Riot's too (`plantSite`, A, B or C), the screen's callout kept only where it
names that site: the player's
Sunset round 5 read "planted at B Boba", round 4's plant filed a round ahead,
where Riot has A. And a death is Riot's only at Riot's moment: given the
match's AI log frames, one the screen registered more than five seconds
BEFORE Riot's (its round's barriers dropping plus Riot's milliseconds,
`deathMoment`) is counted with the deaths it invented, nothing of it laid over
Riot's, and the line says it in numbers alone ("one in round 6 the screen read
59 s before Riot's"). One registered after Riot's is never counted so: that
is the spectator trap, the same death read late, up to 50 s on the Abyss
session read every nine seconds.
The corrected review goes to the page at once with the summary marked as
updating (held behind the loading screen while that is up, above), the coach
looks at the teachable deaths, then the model writes the summary again from all
of it, including Riot's scoreboard line, because a 31/21 match MVP reviewed from
its deaths alone reads as a struggling player.

**The kill feed gives teamwork** (`teamworkOf`): whether a death was traded (a
teammate killed the killer within five seconds, generous on purpose), trades the
player made, how many were standing on each side at the death, and clutches.
The feed that leaves the server carries sides and times and never a name. On
the real Abyss match: traded once in 21 deaths, and six rounds lost after the
player died with the team ahead in numbers.

**Since 8.5.0 it says who by agent, still never by name** (`riot-rounds.js`).
Each kill of the feed carries the killer's agent, the victim's and the gun
(`ka`, `va`, `w`: the roster's agent by puuid or name and tag, none for a
player the roster lacks, the gun by `weaponOf`, never its type), the reply
carries both team comps (`comps: { us, them }`, each `{ agent, role }` with the
role from the game data, sorted by agent, a player with no agent left out),
and its `shape` goes one level deeper, key names only: a round's per player
stats and their economy, damage events and ability casts, the plant and the
defuse, a kill's weapon, location and players' locations, a player's economy
and stats, the metadata and a team, any key that is a word of a player's name,
tag or id left out. A client from 8.5.0 writes the shape to its debug log on
each link (`index.js riotRoundsFor`): below the top level the only live
evidence of HenrikDev's v4 record was four key lists. Every client ignores what
it does not read (`test:trackerroutes`, `test:valorantreview`).

**And a review linked by 8.5.0 keeps the round in order** (`valorant-verify.js
reconcile` and `killFeedOf`, `valorant-review.js build`, `riot-review.js`):
each card's Riot facts gain the round's kill feed (`{ ms, by, on }`, with `ka`,
`va` and `w` only where they are an agent the game data knows and what it says
can kill, a gun, the knife or an ability by its kit name, so a name a server
sent in their place is kept as none), the plant's time (`plantSec`) and its
site, and the review both comps (`comps`, the game data's agents and roles,
sorted again), from the live link, Riot's record alone and the backfill's
upgrade in place, which keeps the comps Ask Coach's fill kept where the record
sends none. That is the shape the fill stores, by the same function, so a
review linked by 8.5.0 is never filled (`test:chatcontext`, `test:riotreview`).
The row's own field is `riotPlantMs`, never `plantMs`, which is
death-frames.js's: it times a post plant death only once `withRiotTimes` hands
it Riot's milliseconds for the look, and carried on every reconciled round it
moved the frames the picker chose for one (`test:grade`, round 6). A review
saved before keeps no feed and is filled once (below, "Ask Coach").

**The match's name set stays on the server** (8.5.0, `riot-rounds.js
noteNames`, `nameSetOf`). Every word of every player's name and tag in a
match `/match-rounds` fetched, lower case, the game's own words, plain English,
the name gate's own plain words of play and the gear (a player called "Behind
Cover" with the tag "Angle" took every look line saying "fall back behind
cover" or "staying on the angle" with them), digits and words under three
letters skipped, each hashed with a key made at
boot (`crypto.randomBytes`), kept by match id for a day, 500 matches at most.
`nameSetOf(matchId)` hands out something that answers `has(text)` (any word of
the text one of a player's) and holds nothing it could print, to the name
gates of the look (`input.names`), the review and Ask Coach for that match
alone, by the match id an 8.5.0 client sends; no reply, log line or file ever
carries it, and after a restart only the gates' own rule runs.

**A fill waits its turn on the shared HenrikDev key** (8.5.0, `coach.js
fillRefused`). A `/match-rounds` request marked `purpose=fill` (Ask Coach's one
time fill of a review saved before the reply carried the feed, and later Phase
D's) goes upstream only when no HenrikDev request was turned away with a 429
in the last two minutes and fewer than ten fills went upstream in the last
minute, server wide; otherwise it is a 503 with retry, which the fill asks
again on the next open. One the reply cache answers costs the key nothing and
is served. Live links and the backfill never wait (`test:trackerroutes`).

Three things the model got wrong on the verified prompt, each fixed in code
rather than asked for: it explained rounds 2 to 11 of 24 (`teachable()` picks
the rounds, one per third first), it named the wrong killer (`namesKiller()`
drops that line), and it merged two patterns into one wrong count (a summary
sentence carrying "N of M" is dropped). The `sides` pattern names the stronger
side in words, because given two fractions the model inverted them, and only on
a gap of two rounds: one win a side is "Neither side was clearly stronger". The
study notes lean to the weaker side by the same rule (`weakSide`, mirrored on
the server and held equal to the pattern on every split in test:valorantreview).

**The review is written from play, and from what was counted** (8.3.1). On the
player's Sunset swiftplay (8.3.0, a read a second) every round card's reads
were its buy phase, because the ledger kept a round's FIRST three notes, and
the summary's "repeated mistake" was standing in spawn during the buy phase,
over a match lost on untraded deaths. So:

- **A round keeps the last three notes of play, frozen at the death**
  (`valorant-rounds.js`): from a frame in play with the player alive and not
  the round end banner, never one about the buy phase, a menu, the scoreboard,
  the combat report, a vote, a banner or the spectator camera (`notPlay`; the
  server mirrors it in `match-review.js` and drops those from an older
  client's reads, `test:valorantreview` holding the two equal), never one
  naming a person (`namesSomeone`), never one naming a place this map does
  not have (`valorant-review.js foreignPlace`: the Haven lock put "A Long" in
  round 2's reads on Sunset), and never one naming another agent's ability
  (8.4.1, `foreignKit`, by Riot's agent or the one the engine locked, off the
  player's own HUD since 8.4.4): round 2
  of the player's Fracture swiftplay, on Jett, sent "holding A Main with
  alarmbot deployed" to the model as what the player was doing. Whole words,
  so "behind cover" is never Harbor's Cove (the engine's `foreignAgentInTell`
  matches inside words, and would have dropped two of that match's notes),
  and allowed with its owner named, the look's own rule.
- **The model is told what was counted.** `requestBody` sends the counted
  mistakes and strengths, the summary's repeated mistake is the first of them
  with its count, the line format is unchanged, and a line is asked for only
  a round lost to a death (`lineWorthy`; the four kill round won on attack had
  been told "Opening menus in spawn delays your movement"). Code drops a round
  line, a summary sentence or a focus sentence that blames the buy phase, the
  spawn or a menu (`BUY_BLAME`), a summary sentence calling something a
  repeated mistake whose rounds are no counted mistake's, and any "N of M" but
  a counted mistake's own. With nothing counted, only a sentence saying a
  mistake came back goes (8.4.1, `REPEAT_WORDS`: repeated, again, kept, every,
  most rounds, twice, and how often, "your most common mistake", often,
  usually, always, or two rounds named): every sentence saying "mistake"
  went, and the player's Fracture swiftplay, won 5 to 1, lost the summary's
  middle sentence, "Your one costly mistake came in round 5, dying after the
  plant with your team up 4 against 3.", the round the match was lost in.
  Known exposure, the safe way: those words inside the one round ("where you
  kept holding the angle", "peeked the same angle again") and a number after
  its round ("round 5, 33 seconds in", which `namedRounds` reads as two) still
  drop a one round sentence, and the summary is two sentences again. A
  round line is ONE lesson: what to do differently, with the one fact that
  makes it the lesson, because the card shows the facts
  beside it. Live on the first 8.3.1 server the review model (Railway's
  qwen3.7-flash) restated every fact line, wrote "No one traded the death" for
  a round Riot has traded, and opened with "Riot lost 2 to 5"; so code drops a
  line that contradicts its round's trade either way (`NOT_TRADED`,
  `WAS_TRADED`) or calls being traded the harm (`TRADE_AS_HARM`: "hesitating
  gets you traded"), one naming three of its own facts again (`factsRestated`:
  the killer, the weapon, the place, the seconds, the numbers standing), and a
  summary sentence naming Riot as the one who won or lost.
- **A buy read once play has been seen begins a round only when it can**
  (`buyVerdict`): never inside a buy timer already running, never on a clock
  not read on that frame (the engine holds the last one, `clockRead`), and only
  when its clock puts the start after the last frame that could only be play,
  a second read agreeing when that is under three seconds, and showing another
  second of the timer: the same clock again is the engine's held copy of the
  first or a still number misread twice, one read. In round 5's post
  plant "buy 0:39", read off the ammo counter, advanced the round, round 5's
  false death went to round 6, and round 6's real one was refused for it, so
  round 6 "died at A Site with the ultimate ready". `test:sessionreplay`
  replays that session. One death a round still keeps the first: taking the
  later one was measured to move the real Abyss round 23 death 36 s late.
- **An ultimate is held only on two ready reads alive** (the frame's own,
  `ultRead`, when the engine sends it; else held ready over six seconds), since
  one misread "ready" the engine carried was a death "holding your ultimate"
  in the patterns, the missed list and Decisions.
- **Strengths fit the match played** (`insights.js`): a count's floor is a
  share of the rounds, never under two (`shareFloor`), one four kill round is
  a multi kill round, the scoreboard is one (`scoreline`: a K/D of 1.5 with
  eight kills, or a combat score a tenth over the player's own role average),
  and post plants and retakes count only rounds the player was alive in at
  the plant (`aliveAtPlant`). That match had three mistakes and no strength.

**Riot counts rounds from 0**, and `time_in_round_in_ms` runs from the barriers
dropping. The Riot ID in config is the one looked up, so a match played on
another account never links, which is correct.

### The coach's look at a death

For the four most teachable verified deaths (`teachableDeaths`: a lost round, a
first death, an untraded one, a death with the team ahead; spread across the
match), the client sends frames of each, each with its seconds from Riot's death
(below), and `/api/coach/death-forensics` returns ONE cause from a closed
list (`CAUSES`, mirrored in `src/shared/death-causes.js`; `test:forensics` keeps
the two in step), what happened, and the better play.

**When Riot's death was on the wall clock** (8.3.1, `death-frames.js
barrierDrop`, `deathMoment`). Every frame of a round that shows the round clock
says when its barriers dropped to within a second (the HUD shows the seconds
left rounded down: a frame reading S left was taken 99 - S to 100 - S seconds
in), and the drop is where those spans meet, buy timers (45 s or less) and
frames after the plant left out, a misread outvoted, two agreeing groups (two
rounds' frames filed under one) no answer. Riot's death is the drop plus
Riot's own milliseconds (`withRiotTimes`: reconcile keeps the second alone),
after the plant too, by the clock before it (Riot's `plantMs`; a post plant
death without it is not timed), and only inside the round's own frames. The
rule before read one frame's clock against Riot's rounded second, and on the
real Sunset match no look saw its fight: round 2's frames, a post plant death,
both came after it, and round 6's "after" frame 0.12 s before it, alive. Now
its four deaths land within 0.6 s of where their clips show them, the real
Split match's within half a second of its buy timers, and the Abyss looks
within 1.5 s of the rule before (`test:clips`, on
`valorant-session-sunset-swiftplay.json`, the match's AI log through
`make-session-fixture.js`; Riot's record of it is not in the repo). The read
frames are then the last one at least 0.3 s before the death and the first one
past it, any phase, `frameAt` beside them; a round with no clocked frame keeps
the rule before.

**The look sees the recording** (8.3.1, `index.js forensicsFor`,
`look-stills.js`, `clip-frames.js`, `windows/frames-window.js`,
`renderer/frames`). The clip of each death is cut first, and the look is sent
stills of it (`clips.LOOK_AT`): Riot's at 3, 1.5, 0.7 and 0.3 s before the death
and 0.7 s after (the fight on screen from 0.7 s before on the Sunset match's
clips, then KILLED BY and the combat report; past about 1 s after, the player's
own map, black, a teammate), the screen's at 4.5, 3, 2 and 1 s before its read
of the death and that moment, since the screen read it 0.7 to 2.7 s late. Each
is decoded in a page nobody sees with WebCodecs on the clip's own H.264, the
frame on screen at that second, 1280x720 JPEG at the read's quality: measured
on the real round 3 clip, 101 frames decoded in 116 ms preferring the GPU and
599 in software, every still the frame ffmpeg decodes at that index, where a
`<video>` seeked in the same hidden window took 6.3 s for six and its
`requestVideoFrameCallback` fired on three. Never while a match is in progress
(`afterMatch`: the look waits for it, an hour at most), the page opened for the
look and closed after it, the stills kept beside the review as
`r<n>-rec<k>-before.jpg`/`-after.jpg` with `frameAt` and `framesFrom:
'recording'`. Only stills leave the PC. Sent with the last before the death and
the first after it ahead of the rest (`sendOrder`; with none after it, the last
two before it in time order, since a screen look's last still, at its read,
lands a frame early as often as not), so a server from before keeps those two,
and deploys first; the server takes up to five a death with their seconds,
sorts them, and its prompt names each one's second from Riot's death second
(from the screen, from its read of the death), the frames after it as the
death screen, and the screen's spot as giving way to the place the frames
print (round 6's was a round earlier's). A body with no `frameAt` gets two
frames and the words it always did. A death with no clip (not recorded, Off)
is sent the read frames, timed as above, and so is a Riot look with no
`moment` of its own (`clips.stillsMomentOf`): its stills would be called
seconds from Riot's death, good to a few tenths, around a moment the rule
before puts two seconds and more out. Its card keeps up to five frames in
time order with `frameAt` and `framesFrom` (`valorant-review.js lookFrames`),
which the page labels them by: cut to two, a recorded look showed 3 and 1.5 s
before the death and lost the fight and the death screen.

- **A cause is a label so it can be counted.** "Your most repeated mistake" is
  a count, and a sentence cannot be counted across matches.
- **A lost duel is on the list and is not a mistake**, so the model has an
  honest place for a fair fight instead of inventing a positioning error.
- **Unclear carries no sentences.** On the bench every unclear answer came with
  a sentence about the frame itself.
- Every sentence passes the map gate (a callout from another map), the ability
  gate (another agent's ability, unless its owner is named), the killer gate
  and, since 8.5.0, the name gate (below).
- Without a death moment the frame picker wants a full two seconds of margin
  before Riot's second, because the clock is read to the second and a
  same-second frame showed the combat report instead of the fight.
- **The fixture frames carry the old tip cards over the game**, and the first
  bench had models reading the card back. The prompt says to ignore overlays.
  The model was chosen by `npm run bench:forensics`: GPT 6 Luna said "unclear"
  when the frame did not show the fight, where the others invented a peek.
  Since 8.4.0 it is GPT 6 Sol, benched again on the body 8.3.1+ clients send
  (`--timed`): 1 confident wrong cause in 36 looks against Luna's 7, the R3
  fight in Mid Library found 12 of 13 times against 0, no overlay copied, at
  about $0.03 a match (the table beside `forensicsModel`).

**Two gates every client gets** (8.5.0, `death-forensics.js parse`):

- **No player is named in a look** (`server/services/name-gate.js`). The look
  sees KILLED BY, the kill feed and teammates' cards, and a name it copies is
  saved, shown and handed to the review and Ask Coach. The gate is the
  client's read rule (`valorant-rounds.js namesSomeone`: a capitalised word no
  list of the game's knows is a name) with three changes: each sentence's
  first word is exempt, a word after "teammate" or "ally" counts only when
  capitalised, and the game's words grow (the keys C, Q, E and X, the modes,
  the ranks, the roles, the sides, Riot, Valorant, Occlara). As the client's
  rule stands it called 66 of the 122 look sentences and round lines on record
  names ("Stay" 16, "Hold" 14, "Take" 8); this calls none, and still catches
  "You were killed by Morvane with a Vandal." and "Your teammate Tessik was ahead
  of you." (`scripts/fixtures/look-sentences.json`: the bench's 98 verbatim,
  the library's 24 retyped as equivalents). A Riot ID or a handle's shape (an
  underscore inside a word, letters and digits mixed in four or more that are
  no game form: R5, 4v3, 100hp) counts in any language, first word included,
  "round #12" never; and so does any word of the match's own players, when an
  8.5.0 client sent the match id and the server holds that match's name set
  (`riot-rounds.js nameSetOf`, handed in as `input.names`, which answers
  has(text) and holds nothing it could print). The capital rule is English's
  alone: German writes every noun with one, Polish and Turkish put a case
  ending on an agent's own name; a language code the prompt does not know is
  asked in English (`promptName`), and read as English. A sentence ends at a
  full stop, a question, an exclamation mark or a colon, and never at a
  semicolon, after "vs." or at the colon of "by:" and "to:": split there too,
  the death screen copied as "KILLED BY: Zorbo" made the name a first word,
  exempt. The death screen's and the shop's own words reach the capital rule
  in lower case (`GAME_PHRASES`: COMBAT REPORT, SWITCH PLAYER, SPECTATING,
  Light, Heavy and Regen Armor or Shields, Headshot, the Clutch, Thrifty and
  Flawless banners), since a look reads them off its last frame and "The
  COMBAT REPORT shows you dealt 0 damage." was a name to it; a word of them
  alone, "Report", still is. None of the 122, nor of the 696 sentences the 13
  Oct bench:review wrote, turns on either. The sentence is dropped as one
  naming another map is, logged as "a name", never the name; its plain words
  are the client's, word for word (`test:forensics` holds the two lists
  equal).
- **Isolated is refused on a death Riot records as traded**: the look is
  unclear, with no sentences, logged by round. "Too far from teammates to be
  traded" beside Riot's own trade is the screen's word over Riot's.

**Variant b: the fight judged first, the label last** (8.5.0, an admin bench's
alone until bench A passes, then 8.5.0 and later by `FORENSICS_PROMPT=b`). On
8.4.3, with five recording stills a death, four of Sol's five speaking looks on
the player's Fracture and Pearl swiftplays were "Lost the duel", a fair fight
with nothing to fix, beside a better play saying to fall back after the first
shots: the reply asked for the cause first and the advice after it. Variant b's
reply comes in the order it is decided, `{what, fight, better, change, cause,
alt}`, 400 tokens to a's 320. It judges the fight (`FIGHTS`: right, wrong-spot,
wrong-time, not-needed, unclear) in place of a's "a fair fight from a sound
position is lost-duel", writes the better play (a right fight's is about the
duel, and may say to be ready to step back if the first shots miss), says the
one thing it changes most (`CHANGES`), and only then picks a cause from that
judgement's family: right is lost-duel; wrong-spot is isolated, crossfire,
overextend, exposed or rotating; wrong-time is repeek, dry-peek or rotating;
not-needed is overextend, repeek, exposed or dry-peek. A Duelist's entry with a
teammate close enough to trade is no wrong spot on its own. Code holds it:

- a cause outside its fight's family gives way to `alt`, failing both the look
  is unclear with no sentences, and the conflict is logged by keys alone
  (`[forensics] R5 conflict: fight right, cause repeek, alt none`; a word off
  the lists is "unknown", never the model's word);
- a `change` outside its fight's set is saved as null and the label kept:
  data for Ask Coach and the bench, never the grade;
- isolated on a traded death is unclear, as above; unclear carries no
  sentences; a mistake with no surviving what is unclear, lost-duel excepted.

The look saves `fight`, `change` and `variant` beside its cause (`index.js
askForensics`, the reply's variant where the look names none, and the card
keeps them through `valorant-review.js lookJudgement`, each from its closed
list); one saved with none was asked with a. And it sends Riot's match id
(Riot's look's own, the scoreboard's for the look from the screen), the key to
the match's name set on the server, as Riot's review written again does
(`test:forensics`, `askForensics` run in a sandbox). **No key is added and
none renamed**: b's words widen repeek to "fought again from the same angle
after the first exchange or a kill, by staying on it or by peeking it again"
(`CAUSES_B`; the review keeps quoting
`CAUSES`), so the Fracture swiftplay's rounds 2, 5 and 6, one lesson under three
labels, can count as one: "Repeeks, rounds 2, 5 and 6". The client's words and
fix follow (`death-causes.js`, `insights.js CAUSE_FIX`), true of every repeek
ever saved; the chip and titles stay Repeek and Repeeks, and an 8.4 client draws
nothing new. **Who gets which is the route's** (`coach.js forensicsVariant`, by
the one version gate `clientAtLeast`): a client before 8.5.0 is answered with
today's prompt and parse byte for byte but for the two gates above, held to
the look as 8.4.4 shipped it, frozen in `scripts/fixtures/death-forensics-844.js`
(150 bodies' prompts, 4,740 replies). The module asks with b only when
`input.variant` is 'b'.

**Variant b2: b with the evidence each judgement rests on** (8.5.0, admin
only until bench A passes, then `FORENSICS_PROMPT=b2`). Bench A of 15 Oct ran b
five times on 16 of the player's deaths against a key three agent panels
wrote from the stills and Riot's facts, merged 2 of 3 and frozen before the
first run: b held its families (no look contradicted itself) and beat a on
forbidden labels, 5 in 80 against 13, but called Fracture round 6 (a Sheriff
fight opened from the open against a Chamber holding the far end, three
missed shots, no damage) right four runs of five, round 5 (the key's one fair
duel) "stayed on the angle" three of five, and two read frames of round 1 a
lost duel every run. b2 writes the judgement out (`judgementB2`): first a
check that the frames are of this death at all, against Riot's facts (the
frame after the death still alive, the spike down before its plant, another
round's score); then what to read (where the player stood, who held the
angle, health and ammo frame by frame, the damage each side dealt); then the
judgements by that evidence: right is set at the edge of cover with the enemy
coming into the angle, or a meeting with neither set, in one exchange; a held
angle walked into, or a long fight opened from the open with no utility
first, is a dry peek even when the player shot first; a repeek needs an
exchange the frames show ending and the same angle again, and a new place
after a kill is never one. Unclear is asked for empty (`REPLY_B2`). Its
causes, families and parse are b's, and its looks carry b's labels as 'b'
(`LABELS`), the word an 8.5.0 client keeps and a cause's trend is held to;
the reply's own `variant` says b2.

**The phrase lists set no label, in any variant** (`death-forensics.js
PHRASES`; one list in four copies, the client's in `death-causes.js` and Ask
Coach's in `fact-gates.js` and `chat-context.js`, held equal regex for regex):
what a better play says it changes (decision, team, reset and timing, utility,
the player's own abilities by name, aim), each regex held to a phrase it must
catch and one it must not. They cannot tell a hedge from a lesson, so they only log a lost
duel whose better play trips one but aim (`lost-duel better play trips
reset`), keep a saved lost duel's label from Ask Coach when its better play
moves the player (`movesPlayer`), and are Ask Coach's fair fight check. On the
23 lost duels on record (`scripts/fixtures/lost-duel-answers.json`, the bench's
18 verbatim and the library's 5 retyped) they change no label.

**Bench A runs on the live body** (`npm run bench:forensics -- openai/gpt-6-sol
--own --key --variant b --runs 5 --costs`, and `--variant a` as the control;
spends money, about $1.10 a variant, each run stopped at `--budget`, $1.50 by
default, so the two together stop at bench A's $3). Its set is
`userData/bench/looks/set.json`, never the repo, written by `scripts/make-look-set.js`
under Electron: the stills a review kept (Fracture R2, R5, R6, Pearl R1, R4,
R5, R6), the stills a kept clip holds, decoded at `clips.LOOK_AT` through the
app's own frames page (the Sunset swiftplay's R2, R3, R6 and R7, recorded on
8.3.0 before a look took stills, their moments in the clip given with `--at
l7eesy@2=9.2`: an argument shaped `x:2` makes Electron exit unseen), the
read's frames where nothing else was kept (the Abyss swiftplay's R2) and the
Abyss 13 to 11's four from the bench's copy of its session: 16 deaths, 80
looks a variant. Each death goes alone, and each reply is scored RAW, before
parse(), beside the server's parsed look (`scripts/bench-look-score.js`), since
a parse that enforces the families cannot show a contradiction. The server
sends an admin bench each reply's label words raw (`/death-forensics` with
`raw: true` beside the admin password, `look.raw`; a licence's own `raw: true`
is sent nothing), or the bench would stop at its first answer:
`death-forensics.js rawLabels`, the fight, cause, alt and
change as the model wrote them, each its key or "unknown", and whether it
wrote a what, never a sentence or a word off a list, since a name in one would
leave the server; the bench scores them as it would the reply's text
(`test:serverguards` on the route itself). A look
the server failed (its timeout, the provider) is asked once more, and a second
failure stops the run saying so. The key (`key.json` beside the set, from the
`key.template.json` and `key-sheet.html` the script writes, never overwritten)
is written before the bench by people who watched each death: the fight,
whether it was a fair duel, the labels acceptable and forbidden. Pass:
forbidden labels at most 2 in 80;
every fair duel lost-duel in 4 runs of 5; the avoidable share at most the
key's plus 5 points; unclear wherever the key says so; raw self contradictions
at most 5% and conflicts at most 10% of the looks that spoke; the Fracture
three all acceptable in 4 runs of 5; p90 at most 4 s on the five still body.
`--dry` builds every body and sends nothing. `test:forensics` holds the
arithmetic of every bar on a set of its own, and runs the bench end to end on
a profile of its own against a stand in server on 127.0.0.1 that answers with
the real parse and rawLabels: the retry, what each look is sent with, the
ledger's spend, and a run file with no licence and no word off a list.

**A review Riot's record never reached looks too** (8.2). Before, frames
reached a review only through Riot's verified deaths, so a screen only review
showed no picture though the AI log kept its death frames. `screenLook(job)`
in `src/main/index.js` runs the look from the screen once a review: right
after the narrative when no Riot ID is set, else in `linkRiotRecord`'s `done()`
when Riot's rounds never came (the scoreboard never linked, or its rounds kept
failing), always before the frames are released, and never over Riot's look,
which wins whether it lands first or while the screen's is out.

- **Which deaths** (`death-frames.js teachableScreenDeaths`): the screen knows
  no first death and no trade, so a lost round scores 3 and an early death 1
  over a base of 1 that lets a won round be chosen, spread by thirds as Riot's
  are. `looksFor(records, rounds, window, 'screen')` frames each one by
  `framesFor`'s no clock path, the frame that registered the death and the one
  before it, and passes over a death whose registering frame is all its round
  has: that frame shows the player already dead. On the real Abyss ledger that
  is rounds 2, 14, 19 and 22, round 14 in place of round 13.
- **What the server is told** (`source: 'screen'`, which survives `normalise`;
  no source is Riot's, every client before 8.2): the facts were read off the
  screen and may be incomplete, never "Riot's record, exact"; Riot's facts
  arriving beside it are dropped; the frames are framed by when the screen read
  the death, which can be late (if the first frame shows the player dead or
  watching a teammate, unclear); and no killer may be named at all. `parse`
  drops every sentence naming an agent as the killer, in any of its wordings,
  since `wrongKiller` had nothing to check without Riot's killer. Its kill
  words are English, and the look is written in the player's language, so in
  any other language it drops every sentence naming an agent but the player's
  own: "Una Sova te mató" matched none of them. The agent goes
  only once the engine locked it, since 8.4.4 off the player's own HUD (two
  answers on buy phase frames, `lookForAgent`; the player's tick before it),
  the rule every guard keeps, so the ability gate never passes a spectated
  teammate's kit as the player's.
- **It reaches the lists, never the grade.** A cause from the screen is counted
  like any other (`cause:` keys, judged), but Decisions skips it (`grade.js`):
  its frames were chosen by the screen's own timing, and with it a review Riot
  never checked spoke in Survival and Decisions, half the weight: four avoidable
  labels graded the real 31 kill Jett at 58 from the screen alone
  (`test:valorantreview`).
- **A look is inside its own round** (8.3.1, `review.js paintRounds`). The
  review is one list of rounds under the strip: a round the coach looked at is
  a row with its facts once, then on one side the clip from the match's
  recording when there is one (8.3, below) with the frames under it as a
  filmstrip, four to the row at least (with no clip, the two read frames two a
  row and the five stills of a clip since cleared three, where two a row stood
  them 520px tall), and on the other the cause chip marked
  "Coach's look", what happened and the better play, and for a screen look
  "Timed from the coach's read of the screen, not Riot's record." Frames are
  labelled by `frameAt`, their seconds against the death to the tenth, every
  one before it by its own ("3 s before", "1.5 s before", "0.7 s before",
  "0.3 s before", then "Just after" within a second after it; rounded to
  whole seconds, the 1.5 s still read "2 s", and the last second's two both
  read "Just before"), a screen look's against its read of
  the death ("1 s before", the read's own frame "Read as dead"), never "At
  the death": the screen read the player's Sunset deaths 0.7 to 2.7 s late,
  so those frames can show the player already dead. Frames with no `frameAt`
  (a look saved before, the screen's read frames) are labelled by their
  names. A click zooms one; under its clip, where the card says where the
  death falls in it, a click on a still moves the clip to that still's own
  frame and pauses it there instead, the clip at the width a zoomed frame
  takes (8.4.4, "The clip's player" below). Unclear keeps its frames and no
  sentence, and its round's why, marked "Coach's read", is the advice it has.
  A look that speaks takes the why's place for Riot's look only, which is
  sent to the narrative that writes the why, so the two are one account of
  the death. The screen's look lands after the lines are written
  (`screenLook`, after the narrative) and nothing writes them again, so its
  round keeps the why written without it: the look's lines and its timing
  first, then the why, a block of its own under a hairline. A round with
  no look carries its why, and one with nothing to say is one line. The
  coach's raw reads are not shown, and nothing says them hidden: the
  verification line no longer counts the reads Riot contradicts, and a round
  the coach never watched has "no death location and nothing seen on screen",
  never "no coach's read" (`served()` says both in today's words for a review
  saved before). It was a section of its own at the bottom
  ("Where you died, and how"), each look's facts said there a second time,
  with "See where you died" on the round's card: the player's latest review,
  seven rounds with four looks, painted 8,096px and paints 4,071. Each look
  keeps `source` and `at`, when its first frame was captured, and the eye on
  its moment, in its round's line, sends `REVIEW_AILOG(id, at)`: main takes a
  time inside the match's window only, and the AI log opens on the frame
  nearest it.
- **The rest of the page says each thing once** (8.3.1): Riot's four numbers
  sit in the result's card with the player's own average under each (the
  "Against your own average" section repeated them), no scoreboard note before
  the match links (the grade's note and the refusals say it), the grade under
  the result and the lists under the coach's read, a pattern under the strip
  only where no list entry counts it (`SAID`, the post plants' miss included),
  a study note only where the focus does not already say it (`restates`),
  and each death the coach looked at, a miss of its own under "What you
  missed" ("Round 6:" and what the look saw, the better play its fix), as its
  title and its round chip, which jumps to the round saying both sentences
  (`saidInRound`, GradeView's `saidInRound` option, only where the row says
  them). The library and Home draw it whole, and the lists are counted by
  key, so nothing in them changed.
- **Both team comps, one line under the strip** (8.5.0, the player's choice,
  `review.js paintComps`): "Your team: Breach, Jett (you), Killjoy, Omen,
  Sova. Theirs: Cypher, Fade, Reyna, Sage, Viper." It is computed when the
  review is shown (`valorant-review.js served`, `compsLine`), never kept on
  disk, from the review's `comps`, which the link keeps since 8.5.0 and Ask
  Coach's fill keeps on a review saved before: agents the game data knows and
  nothing else, sorted, the player's own marked, set by textContent. A review
  with no comps, or only its own team's, has no line (`test:surfaces`;
  `check:mainwindow` paints it in the real window). Riot's record of each
  death in a line of its own (what was bought, the damage each way) is Phase
  D's.

The frames the review looked at are saved beside it in the library, so the
moment survives the AI log rolling past it, and a version painted after a look
still shows them (`job.frames`). Since 8.3 so is a clip of each moment from the
match's recording, cut before the look is sent (8.3.1) and played above its
frames, under a cap (below, "The match is recorded on the PC"). The AI log keeps every frame
of the last three minutes, every frame around a registered death, the ten
seconds either side of a round change (8.3.1, marked `turn`, which the frame
cap takes before any death's and after a held match's other frames: on the
Sunset swiftplay the read that began round 5 in round 4's buy phase had been
thinned away), one frame
per ten seconds of the rest, and holds a finished match's frames whole until
its review has looked (`holdAiLogFrames`): until released, an hour at most
(`HOLD_MAX_MS`), because a match stopped halfway retries the link for 35
minutes (`match-link.js`) and then Riot's rounds and the look after that.
`test:valorantreview` fails the day
the retries outgrow the hold. `test:forensics` holds the screen prompt, the
killer gate, the timed prompt and its limits (five stills from the recording
by their seconds from Riot's death second or the screen's read, two untimed
from a client before), and the real Split round 15, a buy phase frame read as
the round clock once told "in the second the player died", told its frames'
own seconds; `test:clips` the drop, the moments and the stills' plan,
`check:clips` the stills taken live and held against the clip's own frames,
`test:valorantreview` the picker on the real ledger, `test:surfaces`
the one list, a recording look of four frames, the read frames, a screen look
and the eye at a moment, and `check:matches` paints a kept frame in its round
(`#round-2 .v-moment img`) and opens the AI log at it.

### The eye opens that match's AI log

Since 8.2 a Matches row and the review's header carry an eye (the Stats
header's, `shared/log-eye.js`) that opens the AI log on that match alone. It
sits BESIDE the row's button, never inside it, where the "Ask" the row used to
carry sat: clicked, that was the row's click too.

- **A review keeps its place in the log**, `aiLog { session, match, from, to }`:
  the session folder, the match's stamp (`matchStartedAt`, which every record
  carries as `match`) and its window, set at match end from `job.log`
  (`aiLogStore.placeOf`), on every version by `stampReview()`, through a late
  link by `upgradeWatched()`, and into its library row (`metaOf`). Null when
  the log was off. A review saved before 8.2 has no field and is found when
  asked, by when its match ended (`ai-log-store.js locate`): the newest match
  stamped before that end whose last frame came within five minutes of it,
  among the finished sessions only.
- **Main resolves the scope, never a page.** `REVIEW_AILOG(id)` names the
  review; `REVIEWS_LIST` rows and a presented review say only `aiLog: 'kept'`,
  `'gone'` or null (`scopeFor`). Null is no eye: Riot's record alone and
  League write nothing to the log, and a match recorded with the AI log off
  has no log to open. Gone is a disabled eye with its reason. The kept
  folder list is cached in main and dropped when a session starts, is pruned
  or a match ends; each finished session's matches are read once.
- **That read is STRICT** (`read()` with a scope): only the match's frames, a
  record being one when it was captured after the match began and carries its
  stamp or was captured before it ended, and `{ gone: true }` once they are no
  longer kept: never another match under this one's name.
- **No read puts another session in place of one asked for** (`served`,
  `serve`, `askAbout` in `ai-log-store.js`), and THE SEAL IS DECIDED ON THE
  SESSION A READ WOULD SERVE, never the id asked for. Before, an id the log no
  longer kept fell back to the newest folder, which mid match is the session
  being recorded: an old match's eye, then Start (which prunes the oldest
  session), then "Whole session", showed the match in progress. Now a session
  that is gone reads as gone, a question about it is refused, and while sealed
  the session being recorded is in no reply and no list. "Whole session" asks
  for exactly its session and paints the closed or gone state for any other
  answer.
- The log opens in death review mode on the match's first death (its first
  frame when nobody died), with no picker and "Whole session" for the rest
  around the frame on screen. Gone, it says the log keeps the last 5 recording
  sessions and the review keeps the frames the coach looked at. Frame chat and
  Riot's death check read the same match, and a frame's conversation is keyed
  by its file, since its place differs between the match and the session.
- **Its deaths are the engine's** (8.4.1, `ai-log-timeline.js engineDeaths`),
  so the death it opens on is one the engine kept. Every record since 8.0
  carries `died`, true on the frame the engine registered a death on, and a
  death on trial is written with its verdict, false once withdrawn; the log
  takes those, one a round, the first, as the ledger does, in the round the
  record is filed under (`death-reconcile.js filedRounds`: the ledger's, or
  for a frame read after the watch ended a match, the round its score says,
  where that ledger files it on a resume). A death on the banner that already
  printed the next score, registered on a round's first frames before any buy
  or play, is the round before's when that round has none, as the ledger
  files it, though its record carries the new round (`death-frames.js
  borrowedInto`, the review's frame picker's own rule): on the real 24 round
  Abyss match rounds 6 and 24 died so, and taken at their records' rounds the
  log listed 21 deaths where the ledger has 22, round 7's own refused as a
  second and a round 25 the match never had. It used to find its own in runs of
  frames, and on the player's Fracture swiftplay listed 6 where the engine
  registered 5, its ledger kept 4 and Riot has 3: every real death a frame
  or two late ("no own health number" read as the player's own HUD), one
  SWITCH PLAYER frame the engine never registered and round 6 twice; any of
  those first in a match was where its eye opened. The runs are kept for a
  log from before 8.0, which carries no verdict, and refuse a negation of the
  HUD now ("no own HP", "own HP not visible"), and a dead flag on the
  SPECTATORS counter alone is no evidence, as the engine drops that read.
- **Riot's death check is the review's own check, in its own words**
  (`death-reconcile.js`): the engine's deaths, of one match, are checked round
  by round against Riot's over the rounds the log was filed under, and said by
  `valorant-verify.js describe`, so the log's line is the review's: "Checked
  against Riot's record of the match: the screen read 4 deaths and Riot has 3,
  with none in round 1." It said "Riot recorded 3 deaths, the coach marked 6,
  so 3 is not real." Each death Riot has carries Riot's killer and weapon (the
  killer's agent, never their Riot ID, and the weapon's name, never its type),
  one in a round Riot has none in is dimmed and says so, and a log from before
  8.0, or a session of several matches, is checked by its counts in the same
  words with no round named. Never timed: the review's
  "read 59 s before Riot's" needs Riot's plant (`deathMoment`), and the deaths
  the log's check is sent (`/api/coach/match-deaths`) carry none, so on such a
  match the log pairs the death the review calls early.
- `npm run test:ailog` holds the strict read, `locate` and `scopeFor`, the
  match's first death the engine's, and main's own keep rules run in a sandbox
  (a round change's frames kept, and lost to the cap before a death's, after a
  held match's other frames); `test:ailog-timeline` the engine's deaths, equal
  to the ledger's round for round on the five committed sessions through the
  real engine, a banner death driven through it and the real Abyss match, whose
  check says what its review says, and the negation; `test:deathreconcile` the
  check round by round and its sentence equal to the review's; `test:surfaces`
  the row, the header, the log's scoped mode and a check's marks;
  `check:matches` clicks row eyes through to the real window, for a review that
  kept its place and one found by its end, and finds the header's.

### The grade, and the lists under it

`src/shared/grade.js`, pure, one grader per game. **Every category carries the
facts it came from**, so a player who disagrees can see which fact they
disagree with. The model never writes a number a player is judged by; the one
model judgement that reaches a grade is the death cause label, and only in
Decisions.

- Valorant: Survival (deaths a round, first deaths beyond the role's share),
  Impact (combat score against the player's own role average once there are
  three matches, an absolute ladder until then; first kills; multi kill rounds),
  Teamplay (traded deaths, trades made, assists), Decisions (deaths with the
  team ahead and the round lost, ult held, avoidable causes; clutches won).
- League: Farming (not for supports), Survival, Vision, Objectives.
- **One category is not a grade.** From the screen alone Valorant can count
  deaths and nothing else, and that graded a 13 to 11 win at 45. An overall needs
  two categories carrying half the weight; below that it says what would grade it.
- **The Duelist curves are shifted**, because the entry dies more and is traded
  less by design: on the shared curves the real 31 kill Jett read as a player who
  could not stay alive. The lesson from the retired grade-blend.js stands: a real
  scoreboard outranks a count of mistakes, which is why Impact weighs most.
- **A short match is judged over twelve rounds** (8.5.0, the player's choice,
  `decisionsShare`). Decisions is a curve over the share of rounds flagged, so
  in a six round Swiftplay one label was a sixth of the match: it moved the
  player's Fracture and Pearl swiftplays 21 to 25 points in Decisions and 5 to
  6 overall, and six flawless rounds scored 96. A match under twelve rounds is
  filled up to twelve at the typical share, (flags + 0.12 x (12 - rounds)) /
  12, 0.12 being where the curve gives about 79, the median of the player's
  twelve saved Decisions grades. One label in six rounds moves it 13 points
  where it moved 25, both ways; Fracture as saved grades 63 and 87 A where it
  was saved at 50 and 84, with rounds 5 and 6 Repeeks 53 and 85 A, and Pearl
  92 and 71 B where it was 100 and 73, with rounds 1 and 5 avoidable 67 and 65
  C (`test:grade`, on both matches' facts). Twelve rounds and more are judged
  as they always were. Its evidence gains "judged as a short match, over 12
  rounds". A grade already saved is shown and counted as it was saved, never
  graded again; a review graded anew (Riot's record laid over it, at the
  match's end or by the late link's upgrade in place) is graded by this rule.

`src/shared/insights.js` makes the three lists from the same facts, each entry
with a floor, a stable `key` (the library counts by it, so renaming one orphans
every saved review that used it) and, for mistakes, a one line `fix`. A
cause's title is in the singular for one and the plural for two or more
(8.4.1, `death-causes.js causeTitle`): one look's miss read "Repeeks" beside
its round's "Repeek" chip, and a count across matches is always the plural
(`repeatTitle`). The trades line says its count first, "Twice you killed an
enemy right after they killed a teammate.", where 8.4.0's "You killed the
player who had just killed a teammate twice." read as the enemy killing
twice. A review saved before is shown in today's words, its facts and the
patterns included (`inTodaysWords`, `factsView`), never rewritten on disk.
`patterns.js` counts those keys across the last ten recorded reviews of a game
(one graded from Riot's record alone has a grade and no list to count, below);
**a pattern needs two matches**, and its trend compares the newer half of the
window with the older half ('rising', 'falling', 'steady'). **A cause's trend
is one prompt's** (8.5.0, `lookVariant`): variant b widened what a repeek is, so
counted across the two prompts a repeek would read as rising for its
definition's growth. A `cause:` key's halves are compared only across the
matches the newest look's prompt looked at (a look saved with no variant was a;
a match never looked at, or by both, is none's), with no trend before four of
them; its counts, in how many matches and how often, are every match's.

`npm run test:grade` covers the graders on the real fixture, the lists, the
frame picker, the store, the patterns and the weekly report, the short match
rule on the Fracture and Pearl swiftplays, repeek counted as one lesson and the
trend by prompt. `npm run
check:matches` boots the app with saved reviews, reads the library back from the
DOM, paints the breakdown, and clicks a row through to its review and its kept
frame, and its eye through to the AI log on that match.

### Matches graded from Riot's record

Connect (in onboarding, with Skip, and in Settings) and "Grade my recent
matches" in Matches grade the account's last ten Competitive, Unrated,
Swiftplay or Premier matches from Riot's record (`backfill.js`,
`riot-review.js`), so a new player's library, patterns and role baseline are
not empty on day one. The list is `GET /api/coach/recent-matches`; an older
server falls back to `/last-match`.

- **Never twice.** Every match is planned before anything is fetched, and a
  saved recording CLAIMS the listed match that shares the most of its window
  (at least half), plus any match it covers half of, because a player cannot
  play two at once; the seam between back to back matches is not a claim. A
  best share that is mostly clock slack decides nothing, so a short stop at a
  seam claims both neighbours and both are left alone, and a recording whose
  own link is still running (a stop, or a score end that may have gone on,
  retries for over half an hour) holds back
  every match near it. A listed match's span is Riot's start to 100 seconds a
  round, never past the next listed match's start. One in the library and checked is skipped; one
  linked but never checked against Riot's rounds is checked in place, unless
  the listed row's kills, deaths and assists are not the `scoreline` the link
  saved (a duo partner's ID typed by mistake lists the same match); one 8.0.0
  or 8.0.1 linked (verified, with no matchId, which those versions never
  stored) is stamped with its matchId, as is a recording of a queue the grade
  is not built for, named for what it was; one a recording is still linking is
  left to it; one a recording watched but never linked is upgraded IN PLACE
  (the `ledger` an unverified review now keeps, or for an older one its cards
  read back), keeping the coach's looks from the screen, read back from its
  cards because the ledger has none, on the deaths Riot confirms and only
  those (`upgradeWatched`, `test:riotreview`); and one claimed by a recording
  that fails the link's checks, or by two, is left alone. A duplicate is a
  match counted twice in every pattern and twice in the role baseline.
- **Riot's own start and length decide** (`confirm()`). Real matches run 83 to
  103 seconds a round, so the estimate is minutes out either way: a recording
  of only the last round of a slow match fell outside its own match, which was
  filed again beside it. So every match fetched, the ones the plan left alone
  included, is decided again on its round record's `startedAt` and `lengthMs`,
  and stays real for the matches after it. `test:backfill` runs 510 timelines
  on real pacing (Riot's start at the load or at agent select, the PC clock up
  to two minutes off, the app left running between matches) through the whole
  run, and the plan alone on the stamps and links it decides by itself; the
  clock allowance (90 seconds, `CLOCK_SLACK_MS` in `match-link.js`) was set
  on them.
- **Ended early by the watch** (8.2.1, `match-link.js endedEarly`). A
  recording whose last score is one Riot's round record passes through is that
  match, and the watch ended it too soon. The player's own case, the fixtures
  `valorant-review-split-801.json` and `riot-split-13-7.json`: 8.0.1 locked
  swiftplay on a competitive Split match, ended it at 3 to 5 in round 9 (a
  swiftplay final) and saved "Defeat 3-5, Swiftplay"; Riot has it Competitive,
  Victory 13 to 7 over 20 rounds, and at exactly 3 to 5 after round 8. Every
  link check refused it for its score (a match seen ending after 8 rounds is
  not a 20 round one), every run left the recording and the match alone, and
  Home said "From what the screen read" for good. So the score the watch ended
  on may disagree with Riot's final, and the mode with Riot's queue, only when:
  the map is the same on both sides (never merely unknown on one); the agent is
  Riot's when the player confirmed the recording's (one never confirmed agrees
  with anything, and so since 8.4.4 does one the engine read off the HUD,
  `linkAgentOf`); the moment the watch ended the match lies inside Riot's own span,
  its start to start plus length with the clock allowance, because that is
  what an early end is; and the screen's last score, team against enemy, is
  Riot's score after round team + enemy, with more rounds after it, and the
  end comes at least that many rounds into Riot's match (55 s a round at the
  least, `MIN_ROUND_MS`): without it a recording that ended its own match at
  5 to 4, unlisted, was upgraded as the NEXT match on the same map, begun a
  minute later and at 5 to 4 after round 9, and the seam between back to back
  matches is not a claim. The
  recording's START is deliberately not held to Riot's span: it is when Start
  was pressed or the match before ended, minutes before Riot's start in the
  normal order of a session, and a review with no ledger has only an estimate
  of it, which on fast rounds lands minutes early; the end is exact, and the
  claims already weigh the whole window. Everything else stays refused: a
  deathmatch, a match over before the recording or begun after it, fewer
  rounds than were watched, another account, a match another review holds.
  In the backfill the plan sees such a recording as 'ambiguous' and fetches
  its match, and `confirm()` decides again on the record (`claimsOf` takes the
  rule once `real` holds it). AN EARLY END MAKES THE CLAIM ITSELF: it shares
  little of its match, and its recording often opened long before Riot's
  start, so a recording opened twenty minutes before failed both share rules
  and a full run filed its match again beside it, the late link leaving it as
  nobody's. Once the record is in, an unverified recording it confirms claims
  the match, held to the one claimant rules; before, one that may have ended
  it (`mayHaveEnded`: a score only swiftplay ends on, the same map, the end
  inside the match's span, refused for its score alone) only asks for the
  record, and the ask is none of the recording's claims, because a recording
  that ended its own match on a clock ahead of Riot's lies inside the next
  match's span too. The upgrade is the usual one IN PLACE, all of Riot's
  rounds, the watched ones keeping what the screen saw and the rest "Not
  watched by the coach", the old read taken down, result, score, queue,
  halftime and grade from Riot's record. The review says why its result
  changed: "The coach thought the match was over at 3 to 5, and it went on."
  (`valorant-review.js endedTooSoon`, from the rounds Riot's record is laid
  over, so a final read one digit short is never taken for one). The live link
  takes the same rule (`linkEarly`): when nothing verifies, the round records
  of the listed matches that pass every check but the score's, on the screen's
  map and with an estimated span that could hold the end, are asked for, two
  at most a try (`EARLY_ASKS_PER_TRY`), a record that refused is not asked for
  again, and the one that passes is laid over the review without a second
  request. Riot publishes a match only once it is over, and the real Split
  match's record was out nearly twenty minutes after the watch's end, past a
  score end's last try, so a score end on a score only swiftplay ends on
  (`mayGoOn`) tries for as long as a stop (`linkRetries`, `LINK_RETRY_LONG_MS`;
  `test:valorantreview` holds the AI log's hold to it), and when even that
  gives up, its review says the match may have gone on and is checked again
  later, never that it was played on another account (`linkMissing: 'later'`).
- **The late link at launch** (8.2.1, `backfill.js late()`). A recording whose
  link gave up stayed the screen's until the player pressed Connect or "Grade
  my recent matches" again, and a match ended early is one whose Riot record
  is published only once the rest of it has been played, which can be after
  even the live link's longer tries, or after the app was closed. So a little
  after launch, with a Riot ID connected, the app runs this same machinery by
  itself: the plan, the claims and the early end, three seconds between
  requests, the stop and take back on a Riot ID change, the wait while a match
  is played. CONNECTED IS `riotConnected` ALONE (`connectedRiotId()`), which a
  Connect or a run that listed its matches writes. A profile is no proof:
  every launch refreshes the profile of whatever ID Settings holds, a duo
  partner's typed in to look at their rank included, and taken as proof it ran
  the late link for an account nobody connected, filling the player's
  recordings with that player's agent and numbers. An install from before
  riotConnected (8.0.2 and older) kept its connection as the profile alone, so
  that profile counts once, read at load before any refresh can write one
  (`keepOldConnection`, `riotConnectedKept`), and only on an install that
  never ran 8.0.3, the version that brought Connect (`rivalsTitlesRepaired`,
  written at its first launch, says it did; no Marvel Rivals key whatever its
  name: the repair that wrote it went with that game, and it is still written
  at the first launch, `createAppSurfaces`, for this alone): after it a typed
  ID with a profile from an earlier launch was never connected. Settings says
  "Connected" by the same rule. Never during a match: a launch
  whose try lands mid match tries again each minute until the match is over
  (`atLaunch()`), where it used to be the session's only try. At most once in
  six hours (`lateLinkAt` in the config, from the run's start, across
  launches; a clock set back runs it), and only when a recording from the last
  thirty days has no Riot record laid over it. It files nothing new: a match
  nobody recorded stays Connect's, and a Connect pressed while it runs takes
  over as a full run, taking over what it did too, so a Riot ID corrected
  during the full run takes back the late link's upgrades and baseline rows as
  well. Its lines say "Checking" and "Checked", and a run that changed
  something says so as a notice, "Checked 1 recent match against Riot's
  record. It is in Matches." `npm run check:latelink` boots the app on the
  player's own 8.0.1 review through the real launch and the real link, server
  faked: upgraded at launch, Home showing Victory 13 : 7, a second launch
  within six hours asking for nothing, a Riot ID typed and never connected
  asking for nothing though the launch saved its profile, a launch mid match
  checking it once the match is over, and the live link taking the same match
  on one record on the real timeline (Riot lists it only once it is over and
  published, the link's waits cut by `OCCLARA_DEV_LINK_SCALE`), beside a match
  Riot never lists whose review says it may have gone on.
- **Only the account in Settings.** `start()` refuses any other, and a run
  stops itself before listing and before every save once Settings holds
  another ID for more than a few seconds, and TAKES BACK what it did: the
  reviews it filed from Riot's record alone and their baseline rows go, the
  player's own rows those pushed out of the ten come back, the reviews its
  saves pushed out of a full library (of any game) are saved again whole with
  their frames, and the recordings it checked or stamped are saved back as
  they were. A corrected typo that was
  somebody's real account leaves none of their matches behind. A run that
  finished keeps everything, so a duo partner's ID left in Settings until the
  run ends leaves their numbers on the recordings it checked. Connect reads
  the ID again after its profile lookup for the same reason, and an ID HenrikDev
  cannot find loses the profile kept from an earlier Connect.
- **A Riot only review claims nothing the screen saw** (`source: 'riot'`): no
  death location, no ult read, no look at a death, no model call, and both the
  review and its grade's notes say so.
- **And it states facts, never a mistake** (8.2). Riot records what happened
  and never why, so a Riot only review keeps no mistakes, strengths or misses:
  its counts are one neutral list, "What Riot's record shows"
  (`insights.asFacts`, drawn by `grade-view.js factList`), each entry its key
  and counted detail under a title by key ("Deaths not traded within five
  seconds", never "Died where nobody could trade"), with no fix, and its
  Decisions evidence says what it counted. None of it is counted across
  matches (`insights.countable`): the patterns, Home's most repeated mistake,
  the breakdown's repeats and the weekly report count recorded matches only,
  the lists from the last ten recorded (`getPatterns` hands over
  `patterns.LOOK_BACK`, 40, to find them), while grades and categories count
  every match. What they count is in today's words too (`countable` passes
  the lists through `inTodaysWords`), so a pattern quoting an 8.1 review's
  clutch line says "alone against one". A review saved before 8.2 is
  converted when served (`present()` through `valorant-review.js served()`),
  never on disk, and the `topMistake` its library row was given is cleaned on
  read (`review-store.js list()`). No key was renamed. `test:riotreview`
  holds a fresh review and an 8.0.3 one to the same facts; `test:grade`,
  `test:homemodel`, `test:backfill`, `test:breakdown` and `test:surfaces`
  hold the counting and the copy, and `check:matches` boots the app on an
  8.0.3 one and reads its row and its review back.
- Oldest first, each against the history from before it, one baseline row per
  match. Three seconds between requests on the one HenrikDev key, two retries
  on a failure that passes, and three matches Riot did not answer in a row end
  the run. It waits while a match is in progress, and a Riot ID change or a
  logout cancels it.
- `npm run test:riotreview`, `npm run test:backfill`, `npm run test:matchlink`,
  `npm run check:onboardingriot`, `npm run check:latelink`.

### The breakdown

`src/shared/breakdown.js` cuts every saved review of a game by map and agent
(map and champion for League), cached in main until the next save. Counted,
never written, and every number carries its sample:

- Round numbers come only from Riot checked rounds (the screen files a result a
  round late often enough to fake a side win rate), death locations only from
  recorded rounds, the scoreboard only from matches that have one. K/D is total
  kills over total deaths; ACS, ADR and headshot % are weighted by rounds.
  K/D/A (Valorant) is an average match's kills, deaths and assists,
  over only the matches whose line read all three, and it sorts on their K/D.
  Pistol rounds are round 1 and the first round Riot's sides change, never
  overtime; the review's own halftime is used only when no side is known,
  because an 8.0.0 or 8.0.1 review carries the screen's guess at it.
- A rate under its floor (`FLOOR`) is shown as "3 of 7", never a percentage.
  A row against the rest needs three matches on each side.
- A headline (strongest or weakest map, best agent) needs three graded matches
  on the row, three outside it, six in all, and a gap of six points that is
  also one and a half standard errors. Otherwise the page says nothing stands
  out yet.
- **Cards saved before 8.0.3 have no structured fields**, so the breakdown and
  the late link read their facts back from the sentences `roundFacts()` writes.
  Change one of those sentences and `npm run test:breakdown` fails, which is
  the point: the two readings are held equal on the real match.
- Spike Rush, Replication, Escalation, customs and deathmatches are left out,
  and counted as left out. **League is one mode at a time, with no All**:
  Summoner's Rift, ARAM, Arena and Swiftplay are other maps or clocks, so a CS
  a minute across them is a number about nothing; the most played opens first.
- **A repeat across matches is the same thing each time.** "Dying at A Site"
  repeats only at A Site on the same map (the name exists on nearly every
  map) and "Skye kept winning" only against Skye (`insights.repeatTitle`, used
  by the patterns too). Otherwise the title is one that is true of every match
  it counts.

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
  clip plays above the frames, a filmstrip under it: muted, inline, looping,
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
  the death on it in --red and the coach's stills where they were taken
  (their `frameAt`), and one row: play and pause, back to the start, back and
  forward a second, back and forward one frame (pausing first), the time in
  the stills' words ("2.4 s before", "0.3 s after", "At the death" on the
  frame the death falls in, to the hundredth within a twentieth of a second
  of it, where a tenth says nothing; a look from the screen counts from its
  read, that frame "Read as dead"), and the speed, 1x, 0.5x and 0.25x. A
  still under its clip is a place in it: a click moves the clip to that
  still's own frame, paused, and marks the still. The keyboard only while
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
- **The cap** (`clipCapGB`, 5, 10, 20 or 50 GB, 10 by default). After every
  clip kept, at launch, and when the cap is lowered, the clips past it go a
  review at a time, the oldest first and a folder no review owns before any
  (`capClips`). A review that lost its clips keeps its frames, facts and grade
  and says "Its clip was cleared to keep your clips under the space set in
  Settings" (`clipsCleared` on the saved review, carried by every later
  version of one still being improved); Clear clips in Settings takes every
  clip and says it was cleared in Settings. A clip missing for no reason given
  (a review restored without it) is left out and its frames show.
- **Settings**: "Record match video", On or Off (the player asked for a
  setting that toggles it; On is the stored 'auto', never renamed), 720p or
  1080p, a hint per game (`REC_HINT`: Valorant's recorded while its screen is
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
- **Onboarding asks first** (8.3.1, the tour's fourth page of five, How
  Occlara watches): Record gameplay or Frames only, the stored 'auto' and
  'off', and 720p or 1080p, with a PC check behind them run as the page
  opens. Main reads what Node can (`src/main/services/pc-check.js`, over
  `PC_CHECK`): the GPU's name (getGPUInfo('basic'), 22 ms here where
  'complete' took 260, the "Microsoft Basic Render Driver" passed over), the
  CPU's threads, the RAM, the primary display in physical pixels, the free
  space where the recordings go, and the recorder's own two encoder asks for
  that display (fitSize, codecFor, bitrateFor: 1280x720 at avc1.42E01F and
  1920x1080 at avc1.42E028 on a 1080p display), which the page puts to
  VideoEncoder exactly as the recorder page's gate does. The rules are
  `src/renderer/onboarding/pc-rules.js`, one pure file the page loads and the
  test runs: no hardware encoder or under 8 GB free, Frames only and Record
  cannot be chosen; under 8 GB of RAM or 4 threads, Frames only recommended,
  Record still open; otherwise Record, at 1080p when the encoder takes it,
  the display is 1920x1080 or more and there are 16 GB and 8 threads, else
  720p, the line saying what 1080p was short of. RAM is read as the size it
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
  (valorant or lol), mode, res, the outcome from a closed list (recorded, off,
  no-hw-encoder, busy, disk, black, error), minutes recorded, fps p50 (the
  frames recorded, in a match, picture changing), the recorder's CPU p50 and
  the PC's p90, whether the gate passed. Nothing else; `server/services/telemetry.js` keeps only
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
  Mbps ...)"); the start line adds the track's frame rate, that it is
  recorded at up to 30, and the bitrate MediaRecorder took, and the stop's
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
(a second's Cluster early, losing). `npm run
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
reaching the recorder, Windows ending its session and an update's restart
deleting everything in the call, a quit leaving nothing, none of the three
posting its counts into the exit, and counts one kept sent at the next
launch.
`npm run test:clips` holds the names, the seconds, the moments on the real
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

## Layout

```
src/main/          Electron main process (Node). Windows, services, IPC handlers.
src/main/windows/  main-window.js (the one window and its pages), one file per separate window, registry.js
src/main/services/ coaching-engine.js reads the game; review-store.js keeps reviews
src/preload/       One preload per surface, contextBridge only
src/renderer/      The UI. Vanilla HTML + CSS + JS, no framework, no build step
src/shared/        channels.js, config.js, grade.js, insights.js, the per-game reviews
server/            Express backend (deployed on Railway)
server/routes/     coach.js holds the routes: read, match-review, death-forensics, chat
scripts/           sync-*, the benches, the checks and tests
```

Entry point is `src/main/index.js`. Version lives in `package.json` and is
shown at the bottom of Settings.

```
npm start              run the app
npm run dev            run with devtools and dev userData
npm test               every offline check and test
npm run verify:ai      the live read, gated against Riot's record (spends money)
npm run sync:valorant  regenerate valorant-data.generated.json
npm run release        build and publish a Windows installer
```

## The UI

Every surface is a plain folder with `index.html`, a `.css` and usually a `.js`.

**One window since 8.1** (`src/main/windows/main-window.js`): frameless, in the
taskbar, never on top, so it sits behind the game like any app. Its own
document is the shell, and each page is a surface in a WebContentsView of its
own, laid beside the sidebar and KEPT once opened, so the library keeps its
scroll, Ask Coach its conversation and Stats what it fetched. A page view is
registered under the page's id, so a push reaches it the way it reached its old
window.

```
shell/       the window's document: the sidebar (game, pages, the record card,
             account), the window's buttons, the notice line beside them and
             the Recording screen
home/        the last match and its grade, the next match's focus, Valorant's
             rank, the most repeated mistake, the grade trend, recent matches
matches/     three pages from one surface, ?section=list, patterns or breakdown;
             the list carries its wins and losses beside the title (winLoss)
review/      the post-match review, every game, branched on review.kind
stats/       rank, win rate, tracker matches, graded matches
chat/        Ask Coach, on the match its chip names: the newest, one picked or
             asked about from its review, or none (below, "Ask Coach")
settings/    all preferences, version string at the bottom, and under it Riot's
             notice word for word (8.3.2)
```

The pages and their order are `src/shared/shell-nav.js`. A page is loaded with
`?embed=1`, `shared/embed.js` marks it (`html.embedded`) and `ui.css` drops the
card chrome, the close button and the drag region it had as a window and
centres its column. The layout sizes, a 232px sidebar and a 40px top strip,
are in both `main-window.js` and `shell.css`: change them together.

**The seal.** While a match is in progress no page is visible, whatever asks
for one. `syncSeal()` in `src/main/index.js` sets it from `isCoaching &&
matchInProgress()` on a one second tick and before every `openPage()`; the
navigation then answers `shown: null`, the shell paints the Recording screen
and locks every page in the sidebar, Settings included. A page asked for
meanwhile, the review of the match that just ended above all, is remembered
and shows when the seal lifts. Open pages through `openPage()`, never
`mainWindow.show()` directly, which would skip the seal for up to the tick. A
window made again keeps the seal, because made mid match it showed the page
asked for until the next tick. Sealed, the window is out of every capture
(content protection), so the match's recording never has Occlara in it.

**A stop in the middle of a match HOLDS the seal** (`sealHeld`, set from the
engine's `stoppedLive`). Not recording, nothing can tell when that match ends,
and Home would paint its review and the focus for the next match while it is
still being played. Held, the screen says recording stopped and the sidebar
stays open: any page the player opens lifts it, their own choice, as opening
Matches was before 8.1. Start clears it in every game, before the League
branch, and the seal then follows that recording's match: cleared in the
Valorant path alone, a held seal kept every page and the League review behind
"Recording stopped" until a Stop. A review withdrawn because its match resumed
seals first (`withdrawReview`), so its switch to Home never runs unsealed.
`npm run check:seal` boots the app with stand-in engines and holds both.

**Closing quits** (8.4.1, the player's ask: "when the user closes it, just
close it fully dont minimize it"). Its X, Alt+F4 and the taskbar's Close used
to put the window out of sight like Ctrl+Shift+M, Occlara running on in the
tray, so a review still being checked against Riot's record kept its check.
Each is now the window's `close`, held in `main-window.js` and handed to
index.js on the next turn (`onCloseAsk`, `quitFromClose`), NEVER INSIDE THE
CLOSE EVENT: Electron takes a close its handler prevented for a quit cancelled
(it clears its quitting flag as the handler returns), so the quit decided in
that same turn with nothing to ask closed every window and never quit, and the
real app ran on with no window and no tray (index.js's `window-all-closed`
keeps it alive for a tray its cleanup had taken down). It quits by the tray's
own path, `cleanupAndQuit`, and first asks only when quitting would lose
something: a match being recorded right now (the seal's live test), a review
still being built (`review-work.js leftOf`), and a League game's death clips in
the seconds after its review opens, before they are cut (`clipLolDeaths`,
`lolClipping`).
Each question is a native dialog, asked once, whose default and whose Escape
keep Occlara as it is, and a close while one is up asks nothing more. What
they say is `src/shared/quit-ask.js`, checked against what the code does: a
match quit in the middle of keeps the rounds read so far in Matches as a part,
with no read and no clips (a League game stopped part way is never graded),
counted as a stop files them (the ledger's `list()`, never `size()`, which
counts a round only begun off the loading screen or a banner, and said a round
was kept when nothing was); and a review being checked is checked at a later
launch only with a Riot ID connected and once Riot has the match, BY THE LATE
LINK, WHICH DOES NOT FINISH IT AS THE LIVE LINK WOULD: it lays Riot's record
over it with no model call, so no look at the deaths Riot times and no read
(the screen's is taken down), and the recording its clips would be cut from is
deleted as the app quits. A typed and never connected Riot ID runs no late
link, so that one says Grade my recent matches is what checks it. The tray's
Quit and Settings' quit with no question as they always did, and an update's
Restart now and Windows ending its session close the window as the app goes
(`before-quit`, `session-end`) and never ask. Ctrl+Shift+M still hides the
window to the corner mark. `test:shellnav` holds every wording and the close
held and handed over on the next turn on stand-in windows, `check:seal` the
match's and the review's questions through the real index.js (the dialog and
`app.quit` stood in for), a round only begun included, `check:clips` the
League clips' question on a real League review, and `check:mainwindow` the X
and Alt+F4 quitting with nothing asked when nothing is at stake, and never
inside their close event. A match that
resumes after its review opened minimises the window if it is in front, as the
review window used to close.

**The tray icon opens the app** (8.4.1). It had a double click alone, which
toggled the window, so a single click did nothing and a double click on a
window behind the game hid it. A click and a double click now bring the window
up and to the front on the page it was on (`tray.js`, `controller.showWindow`),
the seal settled first, so mid match it shows the Recording screen; the context
menu is as it was, its Show or Hide still a toggle. `test:shellnav` holds
`tray.js` on a stand-in Tray, `check:seal` the click from hidden, minimised and
mid match.

A WebContentsView's page is NOT closed with the window it is laid on, and
once closed its `webContents` reads undefined rather than destroyed, so
`main-window.js` closes them on `closed` and reads them through `alive()`.

**Moving between pages (8.2)** is `shell-nav.js createMotion`, carried out on
the views by `main-window.js`, with the page's half in `shared/embed.js` and
the CSS in `ui.css`. A hidden view keeps its last painted frame, so a page
shown and only then told what to look like flashes what it showed last, the
previous match's review above all. So the page on its way is shown out of
sight first: UNDER the page on screen (re-adding that one with
`addChildView` raises it), or, with none on screen (the seal lifting, the
window's first page), staged at full size with one pixel of it inside the
window's right edge. It is told to ARM (`PUSH_PAGE`): `html.page-armed`,
opacity 0 and 12px toward the side it comes from (`direction()`: down the
sidebar is forward, the review deeper than every page), with no transition.
Two animation frames later it says `PAGE_READY` by its id, and only then is
the page on screen hidden (or the staged one placed) and the new one told to
ENTER, 220ms on `--ease-expo`. A page that never answers is let in after 150ms
(`READY_MS`), one loading again after up to 1.2s (`LOAD_MS`), and a page loads
armed and lets itself in after 1.2s with no word from main (`page-disarm`), so
none can stay invisible. A STAGED page is let in by its timer only while the
window can be seen (`canSee()`: shown, not minimised and focused, because
Electron cannot say whether the game covers it), and its wait starts again on
the window's show, restore and focus: at a match's end the game is in front,
the review's view can paint nothing, and its timer placed it over the frame it
last painted, the previous match's review. A page loading again takes no
ready until its new document commits (`reloading`, cleared on `did-navigate`),
because the document it replaces can still answer an old arm. Sealing still
hides every page in the call, mid switch included. Three Chromium facts it
rests on, measured on Electron 41:

- **A view under an opaque one is occluded and paints nothing**, not one
  animation frame, so it could never arm there. For the switch the page on
  screen is made see-through behind its own document (`CLEAR`; the document
  still paints the ground, so nothing on screen changes) and opaque again once
  it is hidden or stays.
- **A view wholly outside the window is hidden too**, while one with a pixel
  inside it paints, which is what the stage is.
- **Minimised, the window's content measures 0 by 0**, a view laid out then
  is given that, and no `resize` comes on the way back, so the views are laid
  out again on `restore`: a page staged while minimised stayed 0 by 0 and
  never painted.

Make the outgoing view opaque during a switch, or move the stage wholly out of
the window, and every switch falls to the timer and the stale frame is back.
Asked for reduced motion it is a plain cut: still painted out of sight first,
but as it is. `npm run test:shellnav` holds the order of a switch, and
`main-window.js` itself on stand-in views (the window's state, its events, a
reload's old ready refused, the shell's strip kept at TOP_H with its notice
line on one line), and `check:mainwindow` the same on real views,
the seal, a page that never answers, a minimised window and a page loading
again included, and measures the record card (its two buttons alone at its
height before Start, recording between matches and mid match too) and the
notice line.

Everything else that opens moves too, on the tokens and transform, opacity or
a grid row only: the sidebar's marker is ONE element slid to the current page
(`placeMarker()`), never an item's own background, and it follows the record
card's height (a `ResizeObserver`), because once the sidebar overflows
Settings, below the card, moves with it; a dropdown closes as it
opened (`dd-closing`, then hidden); Stats' rank notes, its match rows and a
breakdown row open by height in place (`.reveal`, one grid row from 0fr to
1fr), the breakdown no longer rebuilding its table to open a row; the review's
frame zoom scales from
where the frame was (`zoomShot`); Home's cards arrive one after another on its
first paint and on a change of game, once it is on screen (`occlaraOnShown`);
the Recording screen rises in; the AI log and the weekly
report ease in. `npm run test:surfaces` pins each.

Separate windows, because they are not pages:

```
dock/        the compact always-on-top mark, click through
onboarding/  multi-page first-run flow. The app is gated behind completing it
ailog/       the AI log: every frame read and what was parsed from it, or
             one match's alone, opened from its review's eye
weekly/      weekly report popup: grades, categories, recurring mistakes
learn/       League lessons
activation/  license key entry
splash/      the launch animation
recorder/    the match recorder's page, in a window that is never shown (8.3)
frames/      a look's stills decoded from its clip, in a window that is never shown (8.3.1)
```

The panel and the review, matches, settings, stats and chat windows were
retired in 8.1. `npm run check:mainwindow` boots the app with saved reviews and
asserts the sidebar, Home, the page bounds, the order of a switch between
pages, the seal hiding every page, the review showing when it lifts and a
recent match opening its review.
`npm run test:shellnav` and `npm run test:homemodel` cover the navigation and
Home offline.

**Home (8.2.1), as the player asked for it.** Every card is read from the
library or the rank history, nothing invented (`src/shared/home-model.js`):

- **The last match ends on two buttons and no words**: the eye's "View match"
  (`log-eye.js labelled()`, the eye the Matches rows draw, by the same
  `aiLog` rule: 'kept' opens the match's AI log over `REVIEW_AILOG`, 'gone' is
  disabled with its reason, null is no eye) and Open review. The line saying
  where the grade came from ("From what the screen read") is gone; the review
  says it.
- **The rank**, Valorant's with a Riot ID and a rated game: the newest rated
  point's tier, the last game's RR (+24 in `--good`, -15 in `--red`, 0 dim)
  and the rank journey as a line, by Stats' own rules (`rankModel`: rated
  points only, cut at the newest jump over 300, a game's RR 60 or less), with
  Rank journey opening Stats with the journey open (8.4.1: `OPEN_STATS` with
  'journey', which main keeps until the Stats page asks, `STATS_OPENED_FOR`,
  as it loads, arms and enters, an enter alone coming to a page called back
  mid switch; it opened Stats with the journey folded in the Rank tile;
  `test:surfaces`, `check:mainwindow`). It is asked for through `STATS_RANK_HISTORY`
  only once Home is painted, so a slow history never holds Home back, and
  Home listens for a change of game, a saved review and the Riot ID from
  before its first paint: the first load waits for the rank, and a game
  picked during that wait was never heard. A paint or a rank answer overtaken
  by a newer one paints nothing (`paintAsk`, `rankAsk`). It sits
  under the next match's focus and grows to fill what the last match leaves
  of that column; with the focus and the most repeated mistake both there,
  that column is already the taller, so the rank stands above the grade trend
  instead (`placeRank`). A column with no card shown goes, and the card
  beside it takes the row.
- **A Competitive row in Recent matches shows its RR** beside its grade
  (`rrForRows`): the nearest rank history point within 45 minutes of the
  match's START, Stats' rule, because the history dates a game by its start
  and a row by its end, and measured from the end a match played straight
  after another took the next game's RR. The start is Riot's own, which a
  linked review keeps (`matchStartedAt`, set by `valorant-review.js build()`
  from the tracker match and carried on the library row), and only without
  it put back from the row's end at 100 seconds a round: a row's end is when
  the watch ended the match or Stop was pressed, so put back from there a
  match ended early or stopped landed 20 to 30 minutes early and took the
  game before's RR. A row on Riot's own start is placed EXACTLY, within five
  minutes (`RR_EXACT_MS`), since the history dates its game by that same
  start: given 45 minutes, a row whose game was not published yet took the
  game before it, a 10 to 13 loss shown as +21, and was never asked for again.
  One point is one game, given to the row it is nearest of all, so a match
  whose own game Riot has not published yet shows nothing rather than its
  neighbour's. Only Riot's "Competitive" is rated; a screen's "Standard" is
  not.
- **The RR is read again once Riot has published the game.** The history
  read as a match ends lacks it, and main and the server each keep it five
  minutes, so every save after the end read it back and Home showed the
  match with no RR, or the game before's in the rank card, until the next
  match. A review first linking (`withTracker`) marks main's history stale
  (`services/rank-history.js published()`), and the next read goes past both
  caches (`refresh=1`, once). A read still out from before never puts its
  older answer over a newer read's (`seq`). And Home asks again six minutes on
  for the newest Competitive match still without its RR, twice at most after
  a paint, only for one that ended within the hour (`rrWaiting`).
- **The grade trend fills its card**: its bars stand on the card's foot
  whatever height Recent matches gives the row, each its grade of the whole
  track, the number positioned off the bar rather than stacked over it.

`test:surfaces` holds Home's and Stats' answers to the same history equal,
and `check:mainwindow` measures the trend on the real layout.

**The record card is its two buttons** (8.2.1, 8.3, 8.4.4): the dot and
"Ready", "Recording", "Paused" over the buttons went in 8.2.1, the line under
them in 8.3, the player's ask ("remove any text under it just leave it with
the two buttons"), and the agent check over them in 8.4.4, the player's ask
too: "Reading your agent...", then "Playing" and the agent with a tick, or a
field to type it with the player's mains when detection found none, in a
Valorant session from Start and mid match as readily. The agent is read off
the player's own HUD in the match now (below, "The agent is read off the
player's own HUD"), so nothing opens on the card, at Start, in a match or
after it, and no channel carries an agent to a window (`AGENT_SET`,
`AGENT_CONFIRM` and `PUSH_AGENT` went, and Ask Coach's agent chip with
them). Start fills the width beside the square pause button, both
48px, one padding all round. The state is the button's word (Start, Stop, "Subscription
ended"), the pause button's icon and the live colour while recording. What
the line said when there was something to say is **the notice line** in the
top strip, left of the window's buttons (`shell.js noticeLine`), empty
otherwise, never hidden, because a live region shown and filled in the same
moment is not always read out: the licence ending always (the notice or the default sentence),
then a notice from main except the "Recording..." a League session keeps up
(kind 'recording', which the button and the live card already say),
then paused in the player's language (`panel.pausedLine`), which takes the
place of a notice about the reading ('read-failed', 'capture', and the
recorder's 'recorder', whose last words are that the coach still reads your
screen up to once a second, `recorder.js everyText`, "up to" since the phase
cadence) until the resume puts it back. No "Press Start", no
"Reading your game" (`panel.noTips` went). One line, cut with an
ellipsis and whole in its title, never more than 70% of the strip, the text
out of the drag region and nothing else, so the strip still drags the window;
written only when it changes, as a polite live region.

**An ended plan says how back, and a failed payment is a grace** (8.3.2,
`license-service.js`). A plan bought after the last one ended is a NEW key,
the site minting one per checkout, while the app goes on checking the key it
holds: "Renew at occlara.app" left a player who had renewed locked out for
good. So the running app's words (`endedMessage`, the notice line, Settings'
`ENDED_MESSAGES`, the shell's `ENDED_LINE`) say to renew, then Log out in
Settings and enter the new key, and the licence window's (`messageForStatus`)
say which key to enter. The new key entered after that Log out opens the
window on no notice from the plan that ended (`license.activate` in index.js
clears it: a Log out keeps main's state, and the line still said to do what
the player had just done). A `payment_failed` key is usable until its expiry
(`usable`, the server's rule too), two days past the period end while Stripe
tries the card again: refused, a declined renewal stopped the match being
recorded within three minutes. A key the server refused stays refused on this
PC until the server's next yes (`licenseRefused`, `isLocallyValid`): stored as
'payment_failed' by a server that refused it (any before 8.3.2), that rule read
it usable, so the next outage or offline re-check revived it until the next
real answer ended it again, mid match. The grace is said once as it begins, on the
notice line (kind 'payment', `graceStep`: never pushed again over another
notice, cleared once paid or ended, decided at launch and on every re-check,
the launch's own included), and in Settings beside Manage
subscription. A licence that ends again for another reason (a grace run out,
then cancelled) says the newer reason. At launch a stored key that ended is
asked about once beside the licence window (`launchWithLicence`): a card
updated in the portal while the app was closed renews that same key, and if
the server says yes the window goes and the app opens. The server's expiry is
taken whenever it sends the field, null included, so a key made lifetime by
hand no longer ends again on the old date. A session starts with no cadence
until its engine says one (`state.cadence`), so a League session after a
Valorant one shows no Valorant tier. The licence window's "Get one" opens the sign up page
(`OPEN_PURCHASE` with 'signup', `SIGNUP_URL`), Settings' Manage subscription
the account page, and a page names which, never a URL (`test:surfaces`).

### Rules for UI work

**There is no build step and no framework.** No React, no JSX, no bundler, no
TypeScript. Plain DOM APIs and plain CSS. Do not introduce a framework or a
build pipeline to add a component.

**Design tokens live in `src/renderer/shared/theme.css`** and are imported by
every surface. Use the variables, do not hardcode colours, radii, easings or
durations:

- Brand: `--red` `#FF4655`, `--cyan` `#FFFFFF`, `--bg` `#08090A`
  The token NAMES are historical. `--cyan` is white. They mean "primary
  accent" and "secondary accent", the same in every game (one palette,
  `theme.css`). Do not rename them: they are consumed 225 times across 15
  files and `npm run check:palette` exists because that edit has gone wrong.
- Text: `--text`, `--text-dim`, `--text-mute`
- Status: `--good`, `--warn`, `--red`, each with an `-rgb` twin
- Glass: `--glass-fill`, `--glass-border`, `--glass-blur`
- Geometry: `--r-sm` `--r-md` `--r-lg`
- Motion: `--ease`, `--ease-expo`, `--ease-spring`, `--t-fast` `--t-med` `--t-slow`

`src/renderer/shared/ui.css` holds the shared component styles. If two surfaces
need the same thing, it belongs there, not copied into both. **The grade card
and the insight lists are drawn by `shared/grade-view.js` and
`shared/grade-view.css`** in the review, the library and wherever else a grade
appears, so the three cannot drift. They build DOM with textContent only,
because detail lines carry the model's sentences.

**Geist is bundled locally** in `assets/fonts` so the app renders offline, with
Geist Mono for columns of digits. Geist ships weights 400, 500, 600, 700 and
800 only, and Geist Mono 400 and 500 only. Do not reference a weight outside
that set or a webfont URL: the renderer CSP forbids the URL, and a missing
weight silently falls back to Segoe UI, which changes the shape of the whole
interface without erroring. A Mono weight above 500 is the known exception: the
browser draws the 500 thickened, a synthetic bold, which is what the Mono 600
numbers (the grade, round numbers, scores) and the Matches record at 800 are. A
real heavier Mono means bundling its file with an `@font-face` in `theme.css`.

Settled decisions that keep getting reintroduced by accident:

- **No decorative gradients anywhere.** Solid fills and hairline borders. The
  two that remain are functional and deliberate: the loading shimmer in
  `ui.css` and `stats.css`, where the gradient IS the animation. The splash
  vignette used to be the third. It was a radial ellipse fading to fully
  transparent, masking the edge of a transparent window, and it also ate the
  corners: over a light desktop the centre measured rgb(11,12,12) while all four
  corners measured exactly the desktop behind them, so a square window rendered
  as an oval blob. `.stage` is now a solid `--bg` card with an 18px radius and a
  10px gutter, the same shape as every other surface. Stats' rank journey was
  a fourth until 8.4.1, the retired cyan over a gradient fill written into its
  markup from stats.js, which `check:palette` never read: it read stylesheets
  alone. It reads every renderer script and page now, counts every gradient
  against the shimmers and the share card's two (left for the Stats revamp),
  and holds `stats.css` to tokens and the glass's neutral black and white
  (`TOKENS_ONLY`, which a stylesheet joins once it is clean, and a stylesheet
  in it that the scan no longer reads, renamed or moved, fails the check
  rather than being held to nothing).
- **The Start button stays red.** It is the one control a player must find
  without looking, and the only place the accent earns full saturation in an
  otherwise white-on-black interface.
- **A grade's colour is never its only signal.** The number and the letter are
  always beside it.

**Every surface must stay visually synchronised.** A change to a shared
component or a token is not done until Settings, onboarding, the review and the
library all agree.

## IPC

`src/shared/channels.js` is the single source of truth for every channel name.
It is imported by main, by every preload, and indirectly by every renderer.

**Never hand-type a channel string anywhere else.** The previous client's worst
bug was main and preload drifting to different names, after which a window
silently stopped receiving events with no error. Add the constant to
`channels.js` first, then use it on both sides.

Renderers have no Node access. Everything crosses through a preload via
`contextBridge`. The library is `REVIEWS_LIST`, `REVIEW_GET`, `REVIEW_OPEN`,
`REVIEW_AILOG` (the eye: the AI log on that review's match, or at one moment
of it from the eye on a death the coach looked at), `PATTERNS_GET`,
`BREAKDOWN_GET`, and `PUSH_REVIEWS` fires whenever a review is saved or
improved. `PUSH_REVIEW_WORK` carries `{ id, work }` for a review still being
built, the step it is on or null once it is whole, to the review page, Home
and Matches (8.4.1). Grading from Riot's record is `BACKFILL_START` and
`BACKFILL_STATUS`, and `PUSH_BACKFILL` carries its status on every change to
onboarding, Settings and Matches. The main window is `SHELL_NAV` (go to a
page), `SHELL_WINDOW` (minimise, maximise, close, which quits) and `SHELL_GET`, and
`PUSH_SHELL` carries its navigation state, sealed or not, on every change.
Moving between pages is `PUSH_PAGE` to one page (arm, enter, leave) and
`PAGE_READY` back from it, taken from that page's own view only; every page
preload exposes the two through `src/preload/page-motion.js`. The match
recorder's page hears `PUSH_RECORDER` (start, stop, grab, compare) and answers
on `RECORDER_CHUNK`, `RECORDER_STATUS` and `RECORDER_REPLY`, each checked
against its own window's sender. The frames page hears `PUSH_FRAMES` (a clip's
frames to decode and which to keep) and answers on `FRAMES_REPLY`, checked the
same way. Settings reads what the clips beside the
reviews take with `CLIPS_USAGE` and clears them with `CLIPS_CLEAR`; the
recording's status line comes with the state (`recording`, pushed when the
recorder starts, stops or its rounded frame rate moves). A clip itself never
crosses IPC: the review page plays it from `occlara-clip://`, which main
serves (`clip-scheme.js`). Onboarding asks what this PC can record with over
`PC_CHECK` (`pc-check.js`), and puts the encoder asks it gets back to
WebCodecs itself. Ask Coach asks `CHAT_SEND` with the match on its chip
(`{ reviewId }`, or 'none'), lists what the chip can name with `CHAT_MATCHES`
(the ten newest of the game, held ones left out, the one chosen and its
starters) and moves the chip with `CHAT_MATCH` (8.5.0), and hears
`PUSH_REVIEWS` and `PUSH_GAME` to list again.

## The live read's STATE line

The model replies `LOBBY` or `STATE: {...}` (`read-prompt.js`). The STATE is
parsed by `mapState()` in `server/routes/coach.js` and fed back as context on
the next read. **If that shape changes, the feedback loop dies silently**: reads
keep arriving, they just stop being informed by the previous one.

The models are whatever Railway says where an env var is set, and the code
default where it is not: `AI_READ_MODEL` (default deepseek/deepseek-v4.1-flash),
`AI_FORENSICS_MODEL` (default openai/gpt-6-sol since 8.4.0), `AI_REVIEW_MODEL`
(default openai/gpt-6-sol since 8.4.0, no longer falling back to
`AI_TEXT_MODEL`, which Ask Coach keeps for every client before 8.5.0; the
bench tables are beside each in coach.js), and `AI_CHAT_MODEL` (8.5.0, Ask
Coach v2's, below, default openai/gpt-6-sol until bench:chat names a winner).
`AI_TEXT_MODEL`'s code default is google/gemini-3-flash-preview, so a /health
naming qwen/qwen3.7-flash as `textModel` is Railway's env var, which
bench:review measured at 10 wrong facts or more in 84 lines against Gemini 3
Flash's 4. Two rounds of benches on 13 Oct 2026 kept the read on DeepSeek: the
one model that agreed with one more of Riot's deaths, Gemini 3.5 Flash Lite,
cost 4 to 5.6 times as much, and every other candidate agreed with fewer at
2.3 to 8 times the price. `AI_VISION_MODEL` serves the look at the agent
(`/detect-agent`, the player's bar off their own HUD since 8.4.4, a look the
client keeps off until a reader passes its bench: "And the look is off",
below) and frame chat;
the tip era routes it also served to installs before 8.0 (`/analyze`,
`/recap`, `/summary/*`, `/suggest-library-tip`) answer 410 with an "update
Occlara" sentence, no licence checked and no model called, as every
`/api/rivals` path does since 8.4.0 (below, "Marvel Rivals was removed in
8.4.0"). Every model call switches reasoning off and retries a 400 without the
switch. There is a credits breaker: on a 402 the server reports it honestly
rather than pretending to be down, and the client backs off for three minutes.

**A pinned call never falls back, and a strike is its own model's** (8.5.0,
`textInfer`'s `fallback`, `textStrikes`). textInfer sent a call that came back
empty or timed out again to `AI_TEXT_MODEL_FALLBACK` or the vision model,
pinned or not, so the review (Sol, chosen by bench:review) came back written by
whatever that was when Sol hiccuped; and one strike anywhere moved every
unpinned text call for the life of the process, so a review's Sol timing out
moved Ask Coach. The review passes `fallback: false`, and so does Ask Coach v2:
a failure there is no narrative (a 503, or an empty reply that parses to a null
summary, which every client handles, and Riot's repaint asks again). Strikes
are counted per model, an empty wallet striking none, and the configured text
model moves to the backstop only after its own: `/health` says `textModel` and
`textModelNow`, the one unpinned calls go to now, and `chatModel`. Only an
UNPINNED call strikes: bench:review and bench:chat bench Gemini 3 Flash, the
text model's own default, and one bench answer empty or cut off at v2's
deadline, struck, moved every old client's Ask Coach to the backstop until a
restart (`test:serverguards`, a review bench and a v2 bench on that model).

**What the calls cost is the provider's own figure** (8.3.1, `coach.js
bookCost`). Every call to OpenRouter asks for its usage (`usage: { include:
true }`) and books the `usage.cost` it returns under the route it served
(read, forensics, review, chat, bench, other) and the licence that made it, by day
and by month, carried with the request (`costScope`, which the coach router
sets). A call that returns no cost (another provider, the legacy Gemini path,
one aborted at its deadline, billed all the same) books the flat price per
image instead, counted apart as estimated; one the provider refused books
nothing. `/api/admin/costs` shows `spend` today and this month by route, real
and estimated apart, and each licence's own by its hash; `global` keeps the
calls as the routes count them and the flat estimate beside them. `npm run
test:aicost` holds it on a scripted provider. **A bench is booked apart**
(8.5.0, `benchCall`): a request with the admin password naming a bench model or
a prompt variant is booked under `bench` with no licence, whatever route it
went to, so a licence's figures and Ask Coach's cap never count a bench run,
and a bench reads its cost off `spend.<period>.routes.bench`. bench-sessions.js
counts that route beside the licence's own read over the same period, and
bench-review.js `--costs` prints a `--models` review off it: read off the
licence alone, a candidate's run cost $0 and bench:sessions' `--max-usd` never
stopped one (`test:benchsession`, on a stand in that books as this server does).

**Ask Coach v2, the route's half** (8.5.0, `coach.js chatV2`; the prompt and
the reply gates are `chat-prompt.js` over `fact-gates.js`). Served to a request
whose context is v2 (`context.v: 2`) from a client of 8.5.0 or later once
`CHAT_PROMPT=v2` is set on Railway, or to an admin bench naming `variant: 'v2'`
or `'v2-noprimer'`; everything else, every client before 8.5.0 above all, is
answered as today, byte for byte, and a deploy without `chat-prompt.js`, or a v2
context it cannot take, is answered as today too. An 8.5.0 client answered
that way sends its matches without the 0 to 100 rating, and today's prompt
lists them without one where it said "rating undefined" on every line; a
client before it sends one on every match, so its prompt is unchanged
(`test:serverguards`). `AI_CHAT_MODEL` answers,
pinned with `fallback: false` (an admin bench may name a model from
`BENCH_MODELS`, and is told which answered), 900 tokens at 0.4, inside one 40 s
budget from the request (`CHAT_TIMES`): the first call abandoned at 28 s, the
gates' one retry (a first sentence dropped, or fewer than two left) with their
reasons named and at most 500 tokens only with 15 s left, and otherwise the
honest line, `honest: true` so a client can say it in the player's language.
The question reaches the prompt with "round #12" read as round 12 before the
Riot ID scrub (`scrubAsked`), the reply keeps its paragraphs, each sanitised on
its own and cut at 4,000 characters, the match's name set goes to the gates and
a sentence still carrying one of its words is dropped here, and `dropped`
(counts by gate), `logged` (what a rule in log mode, the name rule's, would
have dropped) and `sentences` (how many the gates weighed) go back, counts
only, for bench:chat's rates. THE DAILY CAP is per licence, one rolling 24 hour
list of (time, booked cost) (`chatRoom`, the question's own line filled by
`bookCost`, an aborted call included): `CHAT_DAY_USD` (default $0.15) or
`CHAT_DAY_QUESTIONS` (default 40) reached, the question is 429 `{ error:
'chat-daily', resetsAt }`, the moment enough of the list leaves the day, before
any model is called. It covers v2 and, from 8.5.0, frame chat; a bench is never
counted, and a client before 8.5.0 is never capped and keeps the limiter's 25
messages in 5 minutes. In memory, so a deploy resets it. The day's questions,
drops by gate, retries, honest lines and refusals are `GET /api/admin/chat`
(server.js, behind the admin password), never `/health`. FRAME CHAT lost "THE
TIP IT GAVE THEN" (no tip since 8.0), takes a linked round's Riot facts as an
8.5.0 client sends them (`riot`, bounded by `riotFrameFacts`), and drops a
sentence of its answer naming a player. THE VERSION GATE is one function,
`clientAtLeast`, as `knowsGrace` reads X-Occlara-Version: it serves v2 and the
death look's variant b (`forensicsVariant`: 8.5.0 and later once
`FORENSICS_PROMPT=b`, or an admin bench, `'a'` its control), and nothing new
reaches a client built before it (`test:serverguards`, `test:aicost`).

**No player is named in what the server's models write back** (8.5.0,
`namesSomeoneHere`). The review's summary, focus and round lines and frame
chat's answer go a sentence at a time through the match's name set (in any
language, the match id an 8.5.0 client sends) and the server's name gate
(`name-gate.js`: a Riot ID or a handle's shape in any language, its capital
rule in English), a sentence naming someone dropped whole and a round line with
it, logged by place only. The review's and frame chat's own words reach the
capital rule in lower case (`REVIEW_WORDS`: MVP, ACS, ADR, K/D, HS, Victory,
Defeat, Attack, Defense, the banners, and what the HUD prints in capitals,
COMBAT REPORT, SWITCH PLAYER, SPECTATORS, MATCH POINT), which it would take for
names; over the 696 sentences the 13 Oct bench:review wrote and the 45 of the
player's saved reviews it drops none (`test:reviewroute`). Frame chat has no
answer on record to measure it over, and its own words are there too: the "I"
its prompt asks for ("I cannot tell from this frame"), the gear by the game's
names (Heavy Shields, Regen Shield), Melee, HEADSHOT, CREDITS and ADS. Without
them an old client's frame chat answer came back "5 seconds before it.", or no
answer at all. And a sentence dropped takes no number with it: a point between
two digits ends no sentence (`sentencesOf`), where "a 1.48 K/D" came back
"a 1. 48 K/D" beside a summary sentence the gate took out (`test:serverguards`).

**`npm run verify:ai` is the gate for any read prompt or model change.** It
runs the live read over the 240 real frames and fails on parse under 95%,
labels under 95%, more than one invented death, under 80% of Riot's deaths
agreed, or a p90 over six seconds. With up to four reads in flight a tier holds
while p90 stays under its gap x 4 x 1.1, so the 1s tier holds while p90 stays
under 4.4 seconds, and the table it prints gives the tier each model holds. Run
it as `npm run verify:ai -- --lag 4` as well, before a release and for any
change that ages the read's context (more in flight, a longer read timeout):
with four reads in flight each frame goes with the context of four reads
earlier. The session is read from `userData/bench/<session>` first and
from the AI log only after it, because the AI log keeps the five newest
sessions and prunes the rest at every Start; keep the fixture copied to
`%APPDATA%\Occlara\bench\session-2026-09-22T04-24-07-240Z` (bench:forensics
reads it the same way, and `test:benchsession` holds the order). It spends
real money, so it is a manual pre-flight, never CI.

**A read prompt changes as a variant first** (8.4.1, `read-prompt.js
VARIANTS`, `coach.js readVariant`). On the player's Fracture swiftplay of 14
Oct the live prompt registered two deaths of a living player: it offers "the
word Spectating" as a dead tell and hands the model "a teammate's portrait and
name above SWITCH PLAYER", which came back word for word on frames whose only
cue was the SPECTATORS 1 counter, it never says what that counter is, and it
says a planted spike has a timer, which Valorant does not print. Variant b
drops the word, says the counter counts who watches the player on screen and
is no sign of death (nor of life), asks for SWITCH PLAYER, KILLED BY or COMBAT
REPORT only when they are printed on the frame, with nothing quoted to copy,
and says there is no clock after a plant; the STATE line is the same. It is
served only to a request that names it (`variant: 'b'`) beside the admin
password, as a bench model is: a player naming it is read with the live
prompt, and the reply says which prompt answered whenever one was named. b
keeps 90 characters of aliveTell where the live prompt keeps 60 (`TELL_MAX`),
which cut frame-00186's "SPECTATORS 1" to "SPE", where `SPECTATOR_COUNT`
would have seen the counter. `npm run verify:ai -- --variant b` and `-- --lag
4 --variant b` bench it, with the admin password, and stop if the server read
with another prompt. It becomes the default only once both pass live; until
then `test:serverguards` holds the live prompt byte for byte, who may ask for
b and what b says, and `test:benchsession` the bench's flag.

**Variant c** came from judging b's bench frame by frame against Riot's
record over four real sessions, and b did not replace the live prompt: on the
three current sessions the live prompt caught 24 of Riot's 24 deaths and b
21, and where the two disagreed on dead or alive the frames sided with the
live prompt 74 times to 22, nearly all in the buy phase, where the round
before's COMBAT REPORT, KILLED BY at its top, is on screen over a living
player (111 such frames read dead on b, 59 on the live prompt). c keeps b's
one clean win, no "Spectating" and nothing quoted to copy, and: the player is
dead only on SWITCH PLAYER, a COMBAT REPORT with ROUND ONGOING at its foot,
or no health number; the buy phase is never death; the SPECTATORS counter,
the skull of the player's own kill banner, the kill feed, the scoreboard, the
map, the buy menu and a WON, LOST or FLAWLESS banner are no sign of death and
stay out of the tell; no word the frame does not print and none saying a word
is absent (each of b's "SWITCH PLAYER not shown" was a death to the server);
alive null when it cannot tell; and the timer is read as printed until the
spike icon takes its place, a timer still counting being no plant. It keeps
120 characters of aliveTell (`TELL_MAX`), since 90 cut "SPECTATORS 1" to
"SPECTATOR", which the spectator tell reads and the counter rule does not.
Served exactly as b is, `npm run verify:ai -- --variant c` benches it. It
replaces the live prompt only when three runs of each, interleaved over the
four sessions on one upstream, each frame sent the engine's own context
(`readContext()`) and scored by time against Riot, show it missing no death
the live prompt caught, inventing no more deaths or plants, reading fewer buy
frames dead in every session and no more LOBBY, and passing verify:ai plain
and at `--lag 4`, its cost a read within a tenth. `test:serverguards` holds c as
the live prompt with its alive and clock lines given the judge's word for
word, who may ask for it and its cap, and `test:benchsession` the bench's
flag for c.

**c is the live prompt since 15 Oct 2026**, the player's choice, and the
prompt every install read with before it is variant a, byte for byte, for the
benches to measure against (`read-prompt.js`: `LINES.alive.live` and
`LINES.clock.live` are c's; `TELL_MAX` 120 live and on c, 60 on a, 90 on b).
`npm run bench:sessions`, three runs of each interleaved over the four
sessions: invented deaths 4.33 a run against 7.33, no death the prompt before
caught missed (the Abyss 17.3 of 21 caught against 15, the Split 16 of 16
against 15.7, the Sunset 5 of 5 and the Fracture 3 of 3 both), buy frames
read dead 0.5 to 4.1% against 8.2 to 32.8% in every session, LOBBY replies
10.7 against 38, invented plants 1.33 both, verify:ai PASSED plain and at
`--lag 4`. It missed one term, a read costing 12.7% more ($0.0003173 against
$0.0002816, its prompt about 1,000 characters longer) where the bench allowed
a tenth, and the player chose c for the rest. `test:serverguards` holds the
live prompt byte for byte as c's, c's bench read with that very prompt, and a
byte for byte as the prompt before.

**The bench that decides it reads as the app reads** (8.4.3,
`bench-read.js --engine`, `scripts/read-score.js`, `npm run bench:sessions`).
verify:ai sends each frame the server's own replies merged raw, so a misread
fed back stays fed back: on both Fracture runs of b's bench a 0 to 0 read
dropped the score line from the next prompt and the engine's new match rule
reset the match, and buy frames sent "the player was DEAD on the last frame"
were read dead 35 to 50% of the time against 11 to 19% without it. And it
scores every session against the Abyss record. `--engine` sends each frame
what the real engine's `readContext()` gives and applies each reply through
the engine in capture order as `drain()` does (a failed read skipped, a LOBBY
a menu), its network stubbed and its clock the frame's capture time
(`AppReader`, started as the app starts it, no heartbeat, and no frame for the
look at the agent, so no agent, as in a match whose look never locked one,
where the app's context carries the agent the look locked from its round 1
buy phase on, since 8.4.4 for every player); `--lag N` sends frame k
the context once the replies up to k - N are applied; each trace line keeps
the reply as sent and what the frame was `sent`; `--gate` is refused beside
it. Without the flag nothing moves: `test:benchsession` holds the default run,
verify:ai and `--lag 4` to 8.4.2's requests, table and trace byte for byte over
a scripted session, and `--engine` to an engine of the test's own. It reads
every frame the log kept, where the app's read cadence would skip some.
`read-score.js` is the judge's scorer made reusable: each round's barrier
drop from every run's clocked reads of its frames (one vote a frame and clock),
numbered by the score most runs read there; Riot's death the drop plus Riot's
milliseconds, or the whole second the Sunset's and the Fracture's reviews kept
(`riot-sunset-2-5.json`, `riot-fracture-5-1.json`: rounds, sides, results,
death seconds, agents and plants, `wholeSeconds`); a death caught from 5 s
before it to the next buy phase and still standing, one the next read withdrew
no catch, the rest invented; and per run the false plants, LOBBY replies, buy
frames read dead of those judged, parse, labels, p50, p90 and the rounds one
by one. Every run is replayed on the guards of the day, so its numbers move
with them. On b's traces of 14 Oct it gives the judge's numbers exactly, ten
runs and three AI logs, and from the AI log's reads alone it puts Riot's deaths
within 0.6 s of the Sunset's clips and the Fracture's recording looks
(`test:readscore`, which also scans every Riot record here for a player name,
a puuid or a tag). `npm run bench:sessions` SPENDS MONEY and spends nothing
without `--go`: it prints every run, its reads, the cost at the two prices seen
($0.00033 a read, $0.00012 after OpenRouter moved the read at about 23:08 UTC
on 14 Oct) and the time. With it the candidates' verify:ai goes first, plain
and at `--lag 4` (its verdict read off its printed line), then runs of live
and c in turn over the sessions, `--engine` each, every run its own process
costed exactly from the licence's read spend in `/api/admin/costs` before and
after, stopping before the next run on a prompt not served, a refused read
(401, 402, 403, 429), over 5% failed, a run that read fewer frames than its
session has (it died part way, and is scored as no run), a data policy
fallback, a restart or the `--max-usd` cap; then every whole run is scored
together and the judge's terms are checked and printed (`acceptance`: the
judge's bench first, three whole runs of each prompt on each of the four
sessions with every run done, so a bench that stopped, on its last run as
on any other, or ran fewer replaces nothing; then no death live caught in
most runs caught in half or fewer of the candidate's, invented deaths,
plants and LOBBY at or under live's mean, buy frames read dead under live's
in every session, both gates passed, a read's cost within a tenth). The
default, three runs of each on the
four sessions, is 26 runs and 9,576 reads: about $3.16 and 6.4 hours at the
first price, $1.15 and 2.7 hours at the second. `test:benchsession` runs it
offline against a stand in for the server.

## Do not simplify the guards

`coaching-engine.js` contains deterministic checks that **deliberately override
the model**. Each one exists because of a specific, reproduced failure, and each
one looks like removable defensive cruft until you know the story. They no longer
guard tips; they guard the facts every review is built from. Do not refactor
these away.

- **Map lock with correction** (`applyMapRead`). The model repeatedly insisted
  the player was on Ascent while they were on Breeze. Two agreeing reads
  acquire the lock, two agreeing contradictions correct it. And the labels hold
  it to account short of naming the map: two reads of a printed label the
  locked map does not have release it (`weighLockAgainst`), one only some maps
  have, the locked one among them, clears that doubt, and a model read outside
  the maps the labels leave is refused (`labelCandidates`). On the player's
  Sunset swiftplay Haven, locked on the first two buy phase reads, went back to
  the model as context for three minutes while B Lobby was printed. A map the
  game data does not know (one released after the last `sync:valorant`) is
  never weighed against the labels, which say nothing about it, as the
  server's `labelFitsMap` has it: weighed, every label it printed read as one
  it lacks.
- **Map fingerprint from printed labels** (`applyLocationLabel`,
  `mapFromLabels`). Valorant prints the location name on screen. Accumulated
  labels identify the map far more reliably than the model's guess, and once
  `mapConfirmedByLabels` is true the model can no longer change it.
- **Scoreboard continuity** (`scoreboardChallenge`). One round forward needs two
  agreeing reads like any other jump, a step the model misread on consecutive
  frames is taken back by three reads that carry on from the score before it
  (`lastStep`, never once a buy phase has confirmed it), and a lone digit is
  checked against the held other one rather than merged raw. Scores never move
  backwards, and a forward jump needs two agreeing reads before it is accepted.
  A read with a round number and no scores is no evidence either way (8.3.2):
  it neither takes the place of a step read once with its scores, nor clears
  it, since the round number is the model's inference and printed nowhere. It
  used to, so the step's second read was a first read again
  (`test:scoreguards`).
- **HP beats death.** A death is only registered when health is genuinely
  absent and the tell is unambiguous. The model kept announcing deaths that had
  not happened. The phase "dead" needs the same proof as the alive flag and
  waits for the same second read (it registered on one unchecked frame), and
  the proof knows the death screen, KILLED BY, the COMBAT REPORT and SWITCH
  PLAYER (`DEAD_TELL`), which every real death of the Sunset match read first.
  A dead read in a buy phase is no first read of two. A death on a weak tell,
  none of what the death screen prints, is withdrawn when the very next read,
  in the same round, is the player's own HUD as it stood, the same health and
  the same gun (`judgeTrial`): its frame is filed in the ledger again as no
  death and its AI log record is written with the verdict. A different health
  or gun is the spectated teammate's HUD called "own", and the death stands.
  So does one the spectate guard calls somebody else's HUD (a teammate's kit
  called "own", the kill feed's KILLED BY), and one whose next read came more
  than 15 seconds later (`TRIAL_MS`): after a pause or an outage that read can
  be a later round, its score unread, the player at full health with the same
  rifle bought again. The
  death's 20 second cooldown stands after a withdrawal, even for the death
  screen: on the Abyss swiftplay the withdrawn round 7 death was followed
  eight seconds later by "SWITCH PLAYER" read on the living player, and a
  death screen let past the cooldown filed it again (`test:sessionreplay`).
- **A return from the dead waits for a second read** (8.4.1). Nobody comes
  back mid round but by a revive, and one read saying so is likelier the death
  screen read wrong: on the player's Fracture swiftplay, 34 seconds after round
  6's death, a frame of SWITCH PLAYER, a teammate's portrait and the COMBAT
  REPORT read "own HP 50 and Sheriff". Believed, it was the "coming back from
  spectating" boundary, which switches off every weak signal (the gun gone from
  Ghost to Sheriff among them), the player was alive again, and the next read's
  SWITCH PLAYER registered a second death in the round, which the ledger's one
  death a round refused and the AI log kept. So while a registered death
  stands, an alive read whose round clock carries on the clock at the death
  (within 3 s) is held for one more read: the next such read is believed (a
  revive costs one read, and Riot's record puts it back), a dead or buy read
  starts it again, and a buy read, a score that moved or a clock that does not
  carry on is never held. `judgeTrial` runs first and is untouched. On the
  committed sessions it takes away one duplicate round 10 registration on the
  Abyss unrated, which the ledger had refused already (`test:sessionreplay`).
- **No spike is down while the round clock runs** (8.4.1). After a plant the
  spike icon takes the timer's place, so a read of the live round (phase
  active) whose own round clock still counts, over 45 s or carrying on the
  round clock in play, has its "planted" dropped before the merge, and the
  context never holds it: on the player's Fracture swiftplay round 3 at 0:51
  read "planted at B" off the chat line "spotted the SPIKE in B", the clock
  running on to 0:41 and 0:32, and Riot has no plant. A read held as a return
  from the dead is weighed by the phase it claimed. A plant the context already
  holds stays, and the frame of the plant itself, read post plant with the
  timer's last second on it, plants: it is the only planted read of the
  Split's round 2, which Riot has, at 1:12. Checked against every committed
  session's plants: the same rounds and sites, the Abyss unrated's round 14
  set on its next read, its "active 1:22, planted" having come 7 s before
  Riot's plant, which moves that death's moment 0.4 s (`test:valorantreview`'s
  "R14 5.5 s after" is 5.1). Known exposure: the Fracture round 3 countdown,
  read "postplant 0:00, planted at B Site", still credits round 3 a plant, the
  ledger filing a plant read before the new round's first buy or play into the
  round that ended, and no clock rule tells it from a plant seen only on a
  banner.
- **Spectating** (`isSpectating`, `spectate-tells.js`), below.

The governing principle: **the coach reports what is actually on screen and
never infers.** When code and model disagree, code wins.

### Whose HUD is it

Valorant puts you on a teammate's camera the instant you die, so the health, the
weapon and the abilities in that corner become THEIRS. Every guard reasoning "a
readable health number means alive" is then reading somebody else's health.

A real graded session: the player's first death was rejected twice with "said the
player was dead while they were alive at 100 HP". The frames read `own HP 100 and
Ghost`, then `own HP 100 and Bandit`, then `own HP 19 and **Sova** abilities`,
while the player was Iso. One bug, four consequences: the death never registered,
so `lastDeathAt` was never set, so `isSpectating()` stayed false, so the spectator
merge guard never engaged and a teammate's Ghost, Bandit and Sword were logged as
the player's own weapon.

`src/shared/spectate-tells.js` is the fix. **A HUD that changes whose it is mid
round is spectating, whatever the health says.** One strong signal (a named
spectator screen, or another agent's abilities called "own") or two weak ones (a
weapon change, health rising) decides it. A buy phase and a return from
spectating are boundaries, because `roundNumber` was missing on a third of the
real frames. `server/routes/coach.js` mirrors the vocabulary by hand, since
`check:server` forbids reaching into `src/`, and `npm run test:spectate` asserts
both copies agree on the real frames. `playerUlt` is spectator owned too: after
a death that icon is the teammate's, so the ledger only keeps an ult read taken
while alive, and each frame hands it its own read (`ultRead`), never the one
the context holds over an empty read.

**The SPECTATORS counter is a false friend** (`SPECTATOR_COUNT`,
`countsSpectators`, in both copies). "SPECTATORS 1" at the top right counts who
is watching the player, so it is on a living player's HUD, and on the player's
Sunset swiftplay the model wrote it as "Spectating 1 top right": two deaths
registered in rounds Riot has survived, one of them pushing out round 6's real
one. The counter is no spectator screen and no proof, and a dead read whose
only evidence it is is dropped, not waited on, unless the death screen or
another strong signal (a teammate's kit, the kill feed's KILLED BY) is beside
it.

**Every form of the word reads alike on both copies** (8.4.3). The client
reads "spectat" with no word boundary; the server's copy, between word
boundaries, read "spectating" and "spectator" but not "spectated", which
variant b of the read prompt wrote on four reads of the bench ("belongs to the
spectated teammate"), a spectator screen to the client and none to the server.
It reads the word as the client does now, and `test:spectate` holds a tell of
every form equal on both copies (spectate, spectated, spectates, spectating,
spectator, spectators, b's four verbatim), the counter's forms the counter on
both, and each copy's own list word for word over every tell it holds, so a
word one list reads and the other does not fails it even where the counter
hides the difference. The counter's number follows any form of the word:
"Spectated 1 top right" and "spectated by 1" are the player being watched,
and with the number read only after "spectate", "spectates", "spectating" and
"spectator", both copies took them for a spectator screen and the client's own
guard dropped a living player's 99 and proved a death on one frame
(`test:spectate`, `test:deathhp`). "The spectated teammate" with a number
further on is still the screen. No read the bench or the AI logs kept writes
"spectated" before a number; every one is the dead player's view of a
teammate.

**A death word the tell's own clause negates is no death word** (8.4.3,
`affirms`, in both copies; the engine's `DEAD_TELL` and `DEATH_SCREEN` and the
cadence's are read through it). On the bench of the player's four sessions,
variant b of the read prompt wrote "SWITCH PLAYER not shown", "SWITCH PLAYER
not printed" and "no SWITCH PLAYER or KILLED BY printed", nine reads, eight of
them a living player in a buy phase, and both copies took the words for the
screen. So a death word (spectating, SWITCH PLAYER, KILLED BY, the COMBAT
REPORT, a killcam, a death recap, YOU DIED, TEAM ELIMINATED, observer,
respawn) counts only where its own clause, to a comma, a full stop, a
semicolon or a bar, does not negate it: "no", "not", "without", "never",
"neither" or "nor" right before it, or "not shown", "not printed", "not
visible", "not on screen", "absent", "missing" or "hidden" right after it, at
most two words for what it is ("text", "prompt", "panel") or "is" between; two
joined by "or" or "nor" share one negation. The "no" of "SWITCH PLAYER bottom
left, no own HP" and "KILLED BY Sage, no own health" is the health's, and the
word stands. A tell is weighed word by word, never dropped whole for one
negated word: seven of the nine still print KILLED BY and the COMBAT REPORT,
which stand, and one of them, "KILLED BY PHOENIX and COMBAT REPORT panel
printed, SWITCH PLAYER not visible", is the Abyss match's round 20 death. Over
the bench's ten runs, the AI logs and the committed session fixtures, 6,797
reads with a tell, the rule moves two, both b's on the Split, and replayed
through the real engine every run and AI log registers and files each frame
as it did; the live prompt wrote no such tell. `test:spectate` holds the two
copies equal on the nine and on every committed fixture's tell,
`test:serverguards` the read route, `test:deathhp` the engine's proof, its
trial and the read that judges it, and `test:readpolicy` the cadence.

### The agent is read off the player's own HUD

Nothing asks the player which agent they are on (8.4.4, the player's ask).
Until 8.4.3 the engine captured a frame of its own three seconds after Start
and every 30 seconds until detect-agent named one, and the record card asked
"Playing" and the agent with a tick nine seconds in, or for it to be typed with
the player's mains offered. Start is pressed in the menus or in agent select,
so that first frame was usually agent select: on the player's 8.4.0 Fracture
swiftplay it named a teammate's KAY/O, and the player typed Jett by hand. The
abilities on the player's own HUD say the agent during the match, and Riot's
record says exactly which one it was after it. The tour's first page says so
("Just play: nothing asks which agent you are on", `onboarding/index.html`),
where it had kept telling the player to confirm the agent when the sidebar
asked.

So `lookForAgent` (coaching-engine.js) sends detect-agent the player's bar cut
out of a read's OWN frame (below, "The call carries the bar"), once its reply
is applied, and only a frame that surely shows the player's own ability bar
(`ownHudFrame`). It is off for now (below, "And the look is off"):

- **A buy phase**, where nobody spectates. The read saw the player alive with
  their own health number, nothing of the death screen or the spectator camera
  in its tell or its kill feed, and no doubt (the buy phase is where Valorant
  shows the COMBAT REPORT of the round before, KILLED BY ASTRA over Astra's
  face); a buy timer read on the frame from 0:45 down to 0:08, since the round
  end countdown reads like one (0:07 to 0:00 on that Fracture match, the TAB
  scoreboard's ten portraits open over it), begun after the last frame of
  play (`beganAfterPlay`); and the guards left it a buy phase with the player
  alive and no sign of anyone else's HUD (`hudRead`). And its timer is the
  ledger's: the end its own clock gives (its capture time plus its timer)
  within 3 s of the ledger's `buyEndsAt` once the frame is filed
  (`AGENT_BUY_END_MS`), when the ledger has one. The ledger sets that end from
  a buy frame it takes, so one it did not take is a buy read that was not: on
  the bench sessions the Abyss round 19's 0:00 as its barriers dropped, read
  "buy 0:10", a live round at 1:39 read "buy 0:08", each the clock a buy frame
  read seconds before, and the Sunset round 5's post plant read "buy 0:39" off
  the ammo counter, six frames of the 187 the look took (five on the Abyss).
  Each showed the player alive on their own bar, but a reader that reads the
  bar would read a spectated teammate's as well, and a buy read with a misread
  clock while dead would lock the teammate. And never after a death until a
  round has ended (`look.deathRounds`): the score, as the frame printed it or
  as the guards hold it, past the rounds it had when the look saw the player
  die. Dead, the player is on a teammate's camera until the round is over, and
  the ledger takes a buy read there for the next buy phase, the spectator
  camera's frames being no play to it, so that read's own timer sets the very
  end the rule before holds it to: offline, "buy 0:39" read off a spectated
  teammate's ammo counter twenty seconds into the camera, the teammate's HUD
  called own, passed that rule, and so did "buy 0:36" three seconds later, the
  round clock read as a buy timer late in a round and a post plant's camera,
  each pair two answers that lock the teammate. A death seen before its match
  began is the last match's (`beginMatch`, the watch's new match keeping the
  look). On the bench sessions it leaves out five more frames, each the first
  buy frame after a death with no score yet read past the death's, so the look
  takes 176 of the 181, and the app's own sequence on their answers locks what
  it did in all five.
- **A live round, as the fallback**, from round 4 of a match no buy phase
  frame has shown the HUD in (a player who stays in the shop, every buy read a
  LOBBY): its first 20 seconds, the tell claiming the player's own HUD, the
  spectate guard seeing no signal at all, no death in the last 30 seconds, and
  only in a round read as it began (`look.startAt`, `seesRoundBegin`: its
  first seven seconds on its clock, or a buy phase read in the ten seconds
  before its barriers dropped). Start pressed mid match, or a pause lifted,
  finds a round nobody saw begin and a death in it nobody registered: Start
  pressed while dead in round 6's first 20 seconds sent the spectated
  teammate's HUD, read as "own HP 100 and Ghost" on frames no sign flagged,
  and two answers naming the teammate's Sova locked it as the player's. A
  LOBBY is no round beginning, since Start is pressed in Occlara's own window
  and its frames read as one.
- Never a LOBBY (menus, agent select, a loading screen), the end screen or what
  is played after it until the next match shows itself, nor the next match's
  frames while the wait for it counts (`newMatchRun`).

**Two answers that agree lock it**, on two frames at least three seconds apart
with no answer naming another between them: a disagreement keeps looking, the
newer answer the one the next must agree with, and an answer naming no agent is
no evidence either way. A name the game data does not know, or one only near a
real one, locks nothing (`exactAgent`). Locked (`lockAgent`), it is
`agentConfirmed` with `agentSource: 'hud'`: the agent every guard holds the HUD
to (the spectate guard's teammate's kit called "own", the trial of a weak death,
`foreignKit` on the round notes, the screen look's ability gate) and the read's
context, as only a tick's ever was. One call out at a time, off the read path
(no capture of its own, nothing waiting on it, 30 seconds for its answer), three
a round and eight a match at most, none once locked; the look starts again with
every match (`beginMatch`) and drops an answer about the last one, and a match
that resumes after the watch ended it too early gets its own agent back.

**Two calls a match, once it is on.** Replayed through the real engine over the
five committed sessions, detect-agent stood in for and answering in two seconds,
every one locked in round 1's buy phase in two calls, 12 to 16 seconds after the
first frame it sent; with three answers in ten naming no agent and one in seven
the wrong one, two to five calls, every lock right; with every buy read a LOBBY
the fallback locked each in round 4, 5 or 6, in two (the Sunset's in round 6:
its AI log is thinned to a frame every ten seconds, and no frame of round 5 was
read in its first seven seconds). Before, a capture every 30 seconds until an
answer came.

**The call carries the bar, never the frame** (`agent-crop.js`, handed to the
engine by index.js as `cropAgent`, Electron's nativeImage in main). Benched
live on the four Jett sessions with the route's live prompt
(qwen/qwen3.7-flash), the whole frame was read Neon on 86 of its 163 accepted
frames and on 34 of 36 round 1 samples, so the look locked Neon in four
sessions of four. Every one of those frames shows the player's own Jett bar,
its icons about 30 pixels across, and eleven more answers came off the rest of
the frame: an agent named in chat, the killer's panel, a teammate standing in
front. So the look sends x 340 to 940 and y 636 to the foot of the 1280x720
frame, the health number to the ammo count, as fractions (the performance
profile's 854x480 gives the same bar), scaled up three times to 1800x252, a
JPEG of the read's own quality, about 29 KB. A crop that cannot be cut (a
frame that does not decode, a crop or a scale of another size, no encoder)
sends nothing, never the whole frame, and spends no look. No chat line, kill
feed, teammate's card or top bar of portraits leaves the PC for the look.

**And the look is off** (`AGENT_LOOKS_PER_MATCH` 0): nothing is sent and
nothing locks, and the agent waits for Riot's record, as for a player who never
ticked in 8.4.3. The crop was benched live, 198 calls one at a time and two
seconds apart at least, every one a 200, $0.006896 as OpenRouter priced them
($0.0000348 a call, the whole frame's $0.0000487), over five sessions: the four
Jett ones and the player's Pearl swiftplay as Raze, each AI log replayed
through the real engine with the route's answers taken live, and every frame
the look accepts sent once. The bar read the Jett right on 107 of its 157
frames (68%, the whole frame's 37%), Neon on 47, and round 1's twelve 8 Jett
and 4 Neon. The app's own sequence locked Jett on the Abyss (two calls), the
Split and the Sunset (three), but Neon on the Fracture (eight calls, round 4),
and Killjoy on the Pearl in five: not one of the Raze's 24 frames was read as
Raze (Killjoy 18, KAY/O 4, Miks 2). In random orders of each session's frames
two agreeing answers lock the wrong agent 6.7% (Abyss), 15.9% (Split), 10.7%
(Sunset), 53.5% (Fracture) and 99.6% (Pearl) of the time, where the gate was
under 1 in 100. Leaving out the pistol rounds (round 1, and the first round
after the swap) did no better: on the same answers Neon locked on the Split and
the Fracture and Killjoy on the Pearl, 10.4% to 99.8% wrong in random orders,
and with fresh answers KAY/O on the Pearl. On the crops read by eye, thirteen
from all five sessions with the misread ones among them, the four icons are
plain: it is the reader that fails. So the next step is a stronger vision
model pinned for this route (it shares `AI_VISION_MODEL` with frame chat),
which needs a deploy and the same bench over the same crops, and the look
goes back to eight a match only once the app's own sequence locks Riot's agent
or nothing in every session and random orders lock a wrong one under 1 in 100.

**A HUD agent never costs a match its Riot link** (`match-link.js
linkAgentOf`). The live link, the late link and the backfill (`backfill.js
windowOf`, through the ledger, which keeps `agentSource`) see no agent in one
the screen found by itself, as in one never confirmed: it refuses no match and
confirms none either, so a match with no map read still needs one. One the
player confirmed, every review saved before 8.4.4, is checked as it always was.
Riot's agent, once its record is in, is the review's (`game.agent`,
`kitAgentOf`, Riot's look, the narrative), and so is the role the match is
graded on and its baseline row takes (`index.js buildValorantReview`, the
scoreboard's agent or Riot's own line before the screen's: on the HUD's, a
Sova locked where Riot has Jett was graded on an Initiator's curves and its
row was an Initiator's), and the agent the look from the screen is told once
the scoreboard has linked and only Riot's rounds never came (`lookFromScreen`).
A match neither the HUD nor Riot named an agent for says nothing of one. A
match that resumes gets its agent back with its source (`resumeMatch`): back
as a bare confirmed agent, it read to the link as the player's tick.

**A wrong lock is worse than none for the spectate guard**: on the wrong agent
a tell naming the player's real kit reads as a teammate's, a strong signal. So
the route's prompt is the thing to bench. The live one, which every install is
answered with byte for byte, asks for the four ability icons at the bottom
center "just above their HP bar"; on the player's round 1 buy phase as Jett
they sit beside the health number in one bar, their keys under them (C, Q, MB4
and X: the player has E on a mouse button), and every in game frame carries
the ten agent portraits along the top bar. From round 2 a buy phase frame can
carry far more: the cards over teammates, each with its portrait and ability
icons, and the COMBAT REPORT of the round before, KILLED BY ASTRA over Astra's
face, which the read need not mention: round 3 of the Fracture swiftplay at
0:23 was read "own HP 100 and Classic" with all of it on screen, a frame
`ownHudFrame` takes while no agent is locked. Variant
b (`detectPrompt('b')`, `detectVariant`, an admin bench's alone as the read
prompt's variants are, and told back as `variant`) says where the bar is and
what is in it, a key under an icon perhaps rebound, answers from the four icons
and from no face, name or other icons (the teammates' cards named), and says
UNKNOWN for a spectated teammate's bar. It replaces the live prompt only once
a bench over the buy phase frames this client sends has measured both against
Riot's agent.

**And for the stronger reader, variant crop and a bench model** (8.5.0, the
server's half of the next step). Since 8.4.4 the call carries the bar alone,
where b describes a whole screen. Variant crop (`detectPrompt('crop')`, served
as b is, an admin bench's alone) is written for that picture: a crop enlarged
three times, the health number at its left, the four icons with their keys
under them (perhaps rebound, X the ultimate with its pips), the ammo count at
its right, an icon dimmed or carrying charge pips when used or not bought
still its shape, and nothing about faces, cards or panels, none of which is in
it. And an admin bench may name a model from `BENCH_MODELS` on `/detect-agent`
as on every other route, and is told which answered (`model`), so the bench
over the same crops can measure a stronger vision model before one is pinned.
The live prompt and `AI_VISION_MODEL` answer every install as they did
(`test:serverguards`).

Nothing of it reaches the screen, at any time. `npm run test:agentdetect`
holds the look through the real engine on a fake clock, turned on by hand at
eight a match (Start and agent select, one answer, two agreeing, a
disagreement, spectating, the death screen and the combat report, the
countdown, a timer begun in play, a buy timer ending away from the ledger's,
a buy read on the spectator camera before its round ended (a teammate's ammo,
the round clock late in a round, a post plant's camera), the buy phase once it
has, and a death before a match began, the caps, a new match, the fallback,
and no fallback in a round never read as it began: Start pressed while dead, a
pause lifted while dead), the call
carrying the crop and nothing when the crop cannot be cut, the crop itself
(its bounds on both profiles, its scale, the read's quality, null and never
the frame when it cannot be made), the look off in the engine as it ships (two
buy phases of the player's own HUD send nothing, cut nothing and lock
nothing), no page telling the player to confirm, pick or type an agent, and
the prompt byte for byte beside b (b taking a key under an icon as perhaps
rebound, and the teammates' cards as no kit of the player's);
`test:serverguards` the route answering a player with the live prompt and an
admin bench with b; `test:cadence` the reader as it ships sending no look, and
turned on, the look off the read path on the bar cut from the read's own
frames; `test:matchlink` and
`test:backfill` the link's rule; `test:valorantreview` Riot's agent over the
HUD's, the ledger's source, and main's role and look from the screen on Riot's
agent; `test:matchlifecycle` a resumed match's HUD agent keeping its source;
`test:surfaces` and `check:mainwindow` the card, its two buttons alone
recording and mid match.

## League records in silence and coaches afterwards

There is **no live League coach and there must never be one.** This is policy,
not an unfinished feature. Riot's League policy approves exactly one overlay
category, "game overlays that provide static data that is available prior to the
game", and bans both "any game-session-specific information that would be
previously unknown to the player" and "apps that dictate player decisions".
Riot's VALORANT policy names the legitimate alternative in the same sentence:
altering behaviour "upon reflection, learning and coaching the player game over
game". Riot also enforced the enemy-ultimate-timer ban by reinterpreting an
existing clause with about a week's notice, on pain of API key deactivation, so
the broad clauses have teeth.

So the pipeline is:

```
src/main/services/lol-recorder.js   polls 127.0.0.1:2999, emits NOTHING to the player, notes the game's clock
src/shared/lol-review.js            turns the record into a review, deterministically
src/renderer/review/                the post-game surface, opens only when a game ends
```

`finishLolGame()` in `src/main/index.js` grades, appends to `lolHistory` capped
at `BASELINE_GAMES`, and fires `PUSH_LOL_REVIEW`. Since 8.3 the game is also
recorded on the PC, as a Valorant match is (display capture alone; the
session's screen is never read, and the recording shows nothing), and its
review's "Your deaths" plays the clip of each death, found in the recording by
the game's own clock (`clipLolDeaths`, "The match is recorded on the PC").

Three things about it that look like details and are not:

- **The review is not generated.** Every line is computed from what the recorder
  observed. A review is where a confident wrong sentence costs most, because the
  game is over and the player cannot check it against anything but a half
  memory. Code wins over the model here for the same reason it does in the
  Valorant guards.
- **`collectEvents` de-duplicates by `EventID`.** `/eventdata` returns the FULL
  list every poll, so appending blindly multiplies every kill by the poll count
  and turns a 4 death game into a 200 death one.
- **The schema is unverified against a live patch.** No League client was
  available when it was written, so field names come from Riot's docs rather
  than a real payload. Everything reads through `num()`, `str()` and `arr()`, a
  wrong field name yields "not measured" rather than a wrong number, and the raw
  events are stored verbatim so a first real game can correct it.

`npm run check:lolreview` boots the app and asserts a review reaches the screen,
because a channel drifting between main and preload silently shows an empty
state that looks deliberate.

**Rank marks are ours, not Riot's.** Riot's ranked emblems live in the game
client and are mirrored by CommunityDragon rather than published on Data Dragon,
which is where the champion icons this app already ships come from, so they sit
under a different permission in a paid product. They are also ornate gold
gradients that would fight `--bg`. `rankMark()` in `learn.js` draws a shield
with one to five pips in `--tier-1` through `--tier-5`; the pip COUNT carries the
tier as well as the colour does.

**The game picker shows the games' own logos: the player's decision of
2026-10-10.** Until 8.2.1 its buttons carried icons Occlara drew, because
Riot's IP policy says a project "may not use any of our logos or trademarks"
without a written licence. The player was told that, with Riot's policy text,
and chose the logos. The sources are `assets/games/valorant.svg` and
`lol.svg`, each one filled path on a 24 unit box, the monochrome paths Simple
Icons publishes. `src/renderer/shared/game-logos.js` draws the same paths
inline so they take `currentColor` and keep the picker's colours, and
`test:surfaces` fails if a path there ever differs from its file, or if a logo
is sized apart from the other. Each button still carries the game's full name
as its title and accessible name, because a symbol alone is a guess, and the
recording lock. Hover lights the game not picked and never the picked one: the
hover rule outranked the pressed one, and its `--text` over the pressed
button's `--text` ground drew that logo white on white (`test:surfaces`
cascades the rules). Rank marks stay ours (above): that decision was about the
picker alone.

## Marvel Rivals was removed in 8.4.0

The player's decision: Occlara coaches Valorant and League of Legends, and
Marvel Rivals went whole, its engine, review, routes, data syncs, logo and
copy. An install from before still calls its routes, so every path under
`/api/rivals`, by any method, answers 410 with "Marvel Rivals is no longer
supported by Occlara. Update Occlara at occlara.app." and nothing else: no
licence looked up, no model called, no rate limit, and the live view counts it
as no read, no review and no game (`server/routes/retired.js`,
`test:serverguards`, `test:licenceoutage`, `test:presence`). What a player's
PC kept of it is put away at launch, before any page can ask
(`retired-games.js putAway`, in `app.whenReady`): a stored game of 'rivals'
becomes 'valorant', `rivalsHistory`, the baseline its reviews were graded
against, goes from the config, and its saved reviews, which no page can open
any more, are deleted with their folders and library rows, said in one log
line. Until then `review-store.js` never lists or opens one, so none is
counted on Home, in Matches, the patterns, the breakdown or the weekly report.
After the first launch there is nothing left to do. A review is the game's by
the game it was saved under and its id, never by its words: a Valorant or
League review whose sentences name Marvel Rivals stays. The library's index
is read once and written back from that read alone, and not at all when the
disk would not hand it over: read a second time after the deletes, a failed
read wrote it back empty over every Valorant and League row. Only the
Valorant reader ever wrote the AI log, so a session of it recorded while
Marvel Rivals was played is that reader's misreads, kept and opened as any
other. The id is kept only as `games.js RETIRED`, which is what makes that
possible (`test:games`, and `check:matches` on a profile 8.3.2 left).
`rivalsTitlesRepaired` is not one of its keys: it says an install ran 8.0.3
(the late link, above), and stays.

## One game's data is never shown under another game's name

The stats dashboard is Valorant shaped end to end: a Valorant rank ladder, agent
tiles, and a competitive/unrated split only Valorant has. It had no concept of
which game it was for, so selecting League returned all of it unchanged.

`getStatsDashboard` now reads `hasFeature(game, 'stats')` and a game without a
stats source returns empty with `statsSupported: false`, which the renderer
paints as a panel naming the game. League needs a Riot production key the app
does not have, and says `stats: false` in `src/shared/games.js`
**explicitly**, rather than relying on `hasFeature` returning false by
absence.

Switching game is a harder boundary than switching Riot ID: it stops a running
session, clears every tracker cache, closes the League only Learn window, and
fires `PUSH_GAME`. That channel is **edge triggered** on purpose. `PUSH_STATE`
already carried `gameId`, but it fires on every config write and status tick, so
a surface had to diff it by hand and Stats did not.

Three checks boot the real app, because all three bugs they cover were invisible
to every static check and to a screenshot:

```
npm run check:gameswitch   switching game repaints Stats, and back again
npm run check:splash       the launch animation is always actually seen
npm run check:learnrole    a support never sees the CS lesson
```

**Stats and Riot's death check show no other player's name, and Ask Coach is
not told the Overview is a trend** (8.4.1):

- **A match's team is agents and numbers** (`coach.js matchDetail`,
  `stats.js matchRow`). "Your team" showed every teammate's full Riot ID, and
  Valorant lets a player hide theirs from anyone outside their party, while
  Riot's policy is that a product shows no player's identity to others
  without their opt in. The server sends no name or tag on any row, the page
  paints none an older server still sends, and the player's own row says
  "You", as the review's kill feed carries no name (`test:trackerroutes`,
  `test:surfaces`).
- **The MVP badge and the roster are each player's own** (8.5.0, `coach.js
  matchDetail`, `mvpKey`). Both come from one match detail call, cached
  forever, and the cache was keyed by the match alone: a duo partner who also
  uses Occlara was handed the first requester's badge and roster, their row
  marked as the player's. It is keyed `matchId|name#tag` in lower case
  (`test:trackerroutes`).
- **Riot's death check names the killer by agent** (`coach.js
  killerAgentOf`, `/match-deaths`). It answered the killer's full Riot ID,
  and the AI log painted it on every death Riot confirmed, a name its owner
  may have hidden as much as a teammate's. It is the killer's agent from the
  match's roster now, as in the review's facts (`riot-rounds.js
  killerAgent`), and a killer the roster does not have is none, never a name,
  which the AI log's mark says as no killer ("Round 2. Confirmed by Riot."),
  where it read "killed by null". And the app keeps a killer only as an agent
  the game data knows (`valorant-verify.js agentName`, where the check enters
  it in `death-reconcile.js`), so a server from before, which still sends the
  Riot ID or a puuid, has no name painted either, only no killer; the server
  deploys first all the same, or the log names no killer at all
  (`test:trackerroutes`, `test:deathreconcile`, `test:surfaces`).
- **The four Overview scores are sums over the tracker profile**
  (`trackerCategoryScores`: Positioning is 140 less a hundred times the deaths
  a round), no recorded match goes into them, and their arrows compare the
  profile with a copy of itself. They went to Ask Coach as "their
  coached-session trend" with "Target the weakest or falling category when
  giving drills": for a player dying 0.78 times a round, drills on
  positioning. The app sends them no more, the server ignores them from an
  older install, and the profile's own numbers are in the prompt already
  (`test:serverguards`). The 0 to 100 match rating on each row, and the share
  card built on it, wait for the Stats revamp.

## The Pro Playbook, and how to grow it

`server/services/knowledge.js` holds the playbook: tagged notes scored against
a situation by `retrieve()`, which returns **only eight**. The review draws on
it twice: `study()` picks the imported notes worth reading before the next
match, by the topic a pattern points to, and the round lines are written with
the retrieved notes in the prompt.

**And by the topic a death's cause points to** (8.5.0, `match-review.js
CAUSE_TOPICS`, for a client of 8.5.0 or later: the route sets `byCause` by the
version gate, and one before it is listed its notes as today, byte for byte).
A counted `cause:` mistake's topics weigh as a pattern's (+5), a single death
the coach looked at gives its cause's +2: dry-peek planning the peek, filling
utility and paint the picture; isolated checkpoints; repeek giving ground,
planning the peek and movement; crossfire planning the peek and paint the
picture; rotating its three rotation topics; overextend checkpoints and tempo;
exposed post plant and retake shape. The summary and the focus already name
the first counted mistake, so the study notes now follow it; against agent
tagged notes at +4 the shift is small (an Omen's counted dry peeks bring in
planning the peek). Ask Coach's notes leave out the review's own list as
either kind of client was given it. `check:playbook` fails a topic of either
table that no note carries (`CHECK_PLAYBOOK_TOPIC` plants one, which
`test:valorantreview` holds it to), and `test:serverguards` holds the route's
gate.

**New knowledge goes in `server/data/playbook.json`**, the growth hook the
module has always documented. It merges at startup, `check:playbook` covers it
automatically through `knowledge.all()`, and extra fields such as `source` pass
through untouched. Its 69 notes are 42 imported from pro VOD reviews and 27 of
Occlara's own, computed from the damage table or written from round shapes, and
**an imported note must carry `source.topic`**, which is what `study()` picks
by, or the checker fails it.

**The app never says where a note came from.** A source holds its kind and its
topic, never a name: `check:playbook` fails a note with a `coach` key, the
study card is the note's text alone, the review prompt tells the model never to
name a source, and `present()` in `src/main/index.js` cuts every study note to
its text on every review a window is handed, the ones saved before 8.2
included. `npm run check:attribution` reads every tracked file, and every file
git would add, for the names of the coach and team the notes were taken from,
built from character codes so the checker never contains them. Git history and
the website repo still carry them.

**Tagging decides whether a note exists at all.** Scoring is `agents +4`,
`weapons +4`, `maps +3`, `situations +2` each, `side/phase/roles +2`, and only
eight notes survive. Measured: a role-tagged note loses to an agent-tagged one
every time for a confirmed agent, so a Jett got **zero** of the imported notes
until the load-bearing role notes were given their role's agent list too. An
untagged note competes with 357 others and loses.

**A typo in a tag is invisible.** `retrieve()` excludes rather than warns, so
`phase: 'postpant'` makes a note permanently unreachable with no error. That is
what the tag vocabulary check exists for, and the vocabulary list is itself
checked against the flags `situationOf` actually produces, in both directions.

**Weapon numbers are computed.** `sync:valorant` pulls the damage table (20
weapons, 13 with falloff), and any note declaring `source.numbers` has every
number in it verified against that weapon's real ranges, its spelled numbers
too since 8.5.0 ("two taps", "a fifth bullet"; "one" only before what it
counts, never the pronoun). A derived number (hits to kill, a magazine) is
legal only as a claim the note declares in `source.claims`, `{ weapon, part,
armor, hits, band }` or `{ weapon, field, value }`, which check:playbook
computes against the table through the primer (`game-primer.js noteClaims`).
Two of Occlara's own notes were false that way and nothing could see it: the
Guardian's "two taps a full shield" (two body hits leave Heavy Armor on 20)
and the Marshal's "one body and one pistol shot is a kill" (true only with a
Sheriff, or against Light Armor). Both are computed claims now, and
check:primer plants them word for word into check:playbook, which must fail
them. A Riot rebalance fails the build rather than leaving the coach
confidently wrong. Notes that give tactical distances, "play inside 5 meters",
are NOT checked, because that is advice and not a claim about the table.

A contradiction advisory was built here and **removed after measuring**: both
alarms it raised were false, "send it" matching Wingman and Owl Drone rather
than aggression. What would actually work is recorded in the file.

### Advanced coaching is a BIAS, never a replacement

`advancedTips` in config, off by default, surfaced in Settings as Advanced
coaching. It now shapes the notes the REVIEW draws on (`match-review.js` passes
`context.advancedTips` to `retrieve()`), and the study list keeps the same
reserve at its scale: off, `study()` lists core notes only; on, two of three are
advanced with a core note always among them, and a match lost in a run of
rounds (the `streak` pattern) gives core two of three. A note carries `tier:
'core' | 'advanced'`, core being the default so the 357 hand written ones are
untouched. With the toggle on the mix `retrieve()` serves goes from about 30% to 75%
advanced, measured across 12 real logged contexts plus 6 synthetic (the sixth,
Swiftplay's round 5 pistol, since 8.5.0).

**A floor of core notes always survives, and on a deathstreak core takes the
majority back.** That is the design, not a hedge: advanced advice assumes the
fundamentals are in place, and a player dying on repeat needs to stop walking
into open ground rather than a damage breakpoint. The override is deliberately
not configurable, because someone who turned advanced mode on is exactly the
person who will not turn it off while losing.

It is a **reserve, not a score bonus**. A bonus was the first design and does
not do what it says: with `agents +4` in play, a bonus big enough to guarantee
advanced notes surface drowns the specificity that makes any note relevant.

**A weapon note must never name the weapon it is tagged for**, since the player
can see their own gun. They give a distance to play instead, which is better
advice anyway. Naming a DIFFERENT gun is allowed and is often the point.

`npm run test:advancedtips` measures the retrieval shift offline. **Always run
it on both sets**: measured on real contexts alone, all twelve came back "no
agent", so `agents` notes, the highest scoring tag at +4, were never exercised.
It also pins what the primer changed in retrieval (below): the pistol rounds by
mode, the computed buy lines, and the four notes that lost a typed number.

## The Valorant primer: every game number has a source

`server/services/game-primer.js` (8.5.0) renders what the models are told
about the game: how a match runs, the credits, damage and armour, a line per
gun, duels, roles and teams, every agent's kit on its keys, attack and
defence, and what the review counts. Before it, every number Ask Coach said
came from the model's memory, which predates the Bandit, the Warden, the Regen
Shield, Veto, Miks and Phoenix's key swap. **Every game number is synced,
stated and confirmed, or measured, never typed.** Three tiers, and nothing
else reaches the text:

- **Synced**, from the game's own files through valorant-api.com. Since 8.5.0
  `sync:valorant` keeps every gun's head, body and leg damage by band, its fire
  rate, magazine, reload, draw, running speed, first bullet spread, aimed
  burst, pellets, alt fire, penetration and feature; the armour (cost, the
  share of each hit it takes, what it absorbs before it breaks, read from its
  own text, and the Regen Shield's pool); each agent's kit (slot, default key
  C, Q, E or X, name, description) and Riot's role descriptions; Standard's and
  Swiftplay's own rules ("First to 13 wins.", Swiftplay's halves of 4 and no
  win by two); the patch and version; each map's minimap transform (for Riot's
  kill positions later). Every field the gates read is as it was
  (`abilities` the lower case list in the game's order, `ranges[].body`), and
  both copies stay identical. The extraction is
  `server/services/valorant-extract.js`, which the sync requires, so the live
  check reads the live game with the code that wrote the synced copy. It
  FAILS CLOSED, naming every problem: fewer than 15 guns, a missing armour,
  an agent missing a used slot or a description, a gun or gear item
  `KNOWN_WEAPONS` or `KNOWN_GEAR` does not list, a field the API renamed. A
  new gun is a renderer change first, then a sync.
- **Stated**, in `server/data/game-rules.json`: the numbers no game data API
  publishes, each once, with its kind (`riot-notes`, `measured`, `occlara`,
  `wiki`), source, `verifiedPatch`, topic tags, check and `confirmed`. **A
  wiki fact renders only once confirmed.** The player confirmed on 15 Oct 2026,
  with the VALORANT Wiki as the stated source, the standard economy (the 800
  start, the 3,000 win, the 1,900, 2,400 and 2,900 losses, the 200 kill, the
  300 plant, overtime's 5,000), the spike (the 4 s plant, the 7 s defuse with
  its half at 3.5 s, the 45 s timer, the beeps at 20 and 10 s) and ultimate
  points (1 each for a kill, a death, a plant or defuse, an orb). Swiftplay's
  pays and its ultimate start stay `confirmed: null` and are said in words
  ("the second round of a half pays more after a won first round"); the kill
  and plant pays are Competitive's facts, so Swiftplay is told they pay only
  once they are stated and confirmed for it, never read into its "same core
  rules". Riot's
  patch notes give the 9,000 cap, the surviving loser's 1,000 and the Regen
  Shield's 25. Measured: health 100 (the AI log fixtures' canary), the round's
  100 s and the buy's 30 and 45 s (the client's constants). Occlara's own: the
  trade's 5 s (imported from `TRADE_MS`, never copied), the early death's 30
  s, the multi kill's 3, halves of 12, overtime won by a lead of 2 and
  Unrated's 12 all decider (`match-end.js`). check:primer holds every mirror
  equal to the code it mirrors, by export where there is one and by a pattern
  that must read the number where there is not.
- **Principles**: coaching text with no digits and no spelled numbers.

**Every number goes through one helper, and keeps its provenance.** `n()`
records the value, how it is shown (a number, beside the printed `text`), its
subject and `subjectKind` (gun, gear, agent, ability, rule), its attribute in
the number gate's own words (`hits`, `head`, `body`, `legs`, `price`,
`credits`, `seconds`, `rate`, `magazine`, `pellets`, `health`, `percent`,
`points`, `metres`, `kills`), its part, band and armour (`none`, `Light
Armor`, `Heavy Armor`), the words a rule's number is tied by in a sentence,
its source and the inputs it was computed from; a grouped number keeps an
entry for each gun it covers. `provenance(mode, opts)` is what
`fact-gates.js primerHas` checks a reply's numbers against. Hits to kill are
simulated hit by hit through the absorption rule (and held equal to the
closed form for every gun, band, part and armour); time to kill is the first
hit at once and then one a fire interval, so a Spectre's 6 body hits on Heavy
Armor take 0.38 s and a Vandal's 4 take 0.31. **Damage prints as the game
shows it**, the whole number below a fractional value (the Sheriff's head hit
is 159, as the player's Fracture combat report showed it), with the exact
value kept for the arithmetic. Every grouping is computed: the prototype's
hand typed "sidearms run at 85%" was false for the Sheriff and the Shorty.
Riot's own kit text goes through the same helper, its digits and its spelled
numbers ("every two kills") included.

**Every sentence is a unit with its inputs**, and a unit whose input is
withheld is left out whole, or said in its fallback words; a heading or a
bullet whose units all go goes with them. Withheld are a synced number the
live game no longer has and every sentence computed from it; the gun table
and the kits (every `w:`, `g:` and `a:` input) when a differing live patch
cannot be fetched or extracted, or no check has succeeded for 24 hours; a
stated fact a patch since its `verifiedPatch` may have touched; and for a
past match (`matchAt`), what the patches released since it tagged. **The
numbers are the game as it is now**, and the header says so word for word:
"These are the game's numbers as it is now. A match played before a patch can
differ, and a number a patch has changed since that match is left out for it."

**The live version check** (`startLiveCheck()`, at boot and every six hours;
`liveStatus()`, `{ synced, live, withheld }`, for `/api/admin`) asks
valorant-api.com's `/v1/version`. When it differs from the synced version it
fetches the endpoints the sync uses, extracts them with `valorant-extract.js`
and diffs every synced number the primer prints (`flatten`). A changed number
is withheld until the next sync and deploy, one log line names it (and only
when that changes), and **a new number is never stated before check:primer
has run on it**: the primer prints the synced data only, the live data is
read to diff and nothing else. Nothing runs at require time, since
check:server loads every server file, and the timer never holds a process
open. **server.js starts it once listening, on Railway alone**
(`liveCheckWanted`: `RAILWAY_ENVIRONMENT_NAME` or the older
`RAILWAY_ENVIRONMENT`, which Railway sets on every deploy, or
`PRIMER_LIVE_CHECK=on`; `PRIMER_LIVE_CHECK=off` stops it anywhere, and every
test that boots server.js sets it): no check, test or CI run calls
valorant-api.com, and Railway's server is never left unchecked, which after a
day would withhold the gun table and the kits. `GET /api/admin/primer`, behind
the admin password, is `liveStatus()`: after a deploy `live.lastOkAt` set and
`withheld` and `statedGate` empty say the primer states everything it has
(`check:primer`, `test:serverguards`).

**The patch history and its two gates.** `server/patch-notes.generated.json`
keeps the last 12 patches in `history`, each with its release date and EVERY
line of its notes, since the old sync dropped a line naming no agent, gun or
map and an economy change names none. Every line means the short and the long
ones too, which the prompt's five words to 240 characters keep out of
`changes` only: Riot writes a change as a heading and short lines under it,
and the heading is what names the topic (9.10's Regen Shield was "Regen
Shield" over "Damage Absorption: 25 HP", neither five words, so the prompt's
filter left the history nothing about the shield). A patch's notes count as
found only on a line of five words or more (`substantive`), so a page of
nothing but its own chrome withholds rather than vouches. The top level fields
`patch-context.js` reads are as they were, and `npm run sync:patch --
--upgrade` converts an old file offline (its lines named only, so it can
withhold a gun but never clear a stated fact). A line is tagged by topic
(`server/services/patch-topics.js`: economy, armor, spike, timers, format,
ultimate, swiftplay, health, each pattern narrow on purpose and asserted on a
positive and a negative line and its `CASES`: a heading names its topic, a
plant time is the spike's, Spike Rush is a mode, a buy time is a timer).
**The stated facts gate**, deploy wide: a fact passes when it was verified on
the synced patch, or when every patch since had its notes found whole and none
of their lines carries one of its topics; re-stamping is one edit of
`verifiedPatch`, made after reading the lines. **A past match** is on the
patch live on its date (`matchAt`), and within 48 hours after a release on
both, or on Riot's own patch for it once the record gives one (`matchPatch`,
Phase D's `game_version`); it loses what the patches since tagged (a stated
fact by its topics, a gun or an agent by name, the armour by `armor`), and
every stated fact a patch can touch when a patch since has no notes, notes
kept only in part, or is missing from the history altogether (a hole between
two kept patches is a patch nobody read; the sync records one it could not
read rather than leaving the hole; across a major only its X.00 follows the
last major's patch, so 14.01 straight over 13.08 is 14.00 missing). Occlara's
own rules, the facts with no topic (the trade's 5 s, the early death, the multi
kill), no patch changes, and no gate withholds them: the review a match was
graded by says them.

**Where it goes, and never.** Ask Coach gets the core for the match's mode
and its slices (`kit`, `guns`), the death look the duel slice (`duel`, worded
"bought", from full health) and both kits, the review the core without the
gun table and the roster (`guns: false`) and the match's slices. The slices
count only what they can: a shotgun in a duel by the pellets of one shell
("a shell kills with 9 of its 12 body pellets"), never as a race of shots at
its fire rate and never against a rifle's body count (counted as shots, a
Judge at 5 m read as 2.29 s to kill Heavy Armor); a Regen Shield bought by its
own absorption and its own name; an armour the game data does not name as no
duel at all, never as none; the comps (`comps`) only by agents the game data
knows, anything else in a team list counted and never printed, a player's
name above all, and a team holding one never said to lack a role; the guns
slice's effective health only while the armour rule holds, as the core's. If
prefix caching does not reach the provider, Ask Coach's gun table moves to
slices with the roster kept (`guns: false, roster: true`). The core renders in about
4 ms and is the same text for every match on the synced patch, so it can sit
first in a prompt for caching. Never the live read, never League, never `src/`
(check:primer scans every require of it).

**Today's knowledge, corrected** (8.5.0). `knowledge.js`'s four unsourced
numbers went: footsteps "audible around 20 meters" (no source anywhere), the
defuse's 7 and 3.5 s (now read from the confirmed rules), "the Frenzy melts
inside 10 meters" (the band now read from the table, 20 m), and "the Spectre
stays accurate on the move" (in no data); the Spectre's 15 m reads the table
too. `situationOf`'s pistol rounds follow the mode (`ctx.mode`, or the live
engine's `gameMode`: round 5 in Swiftplay, where round 13 never comes, with no
mode Competitive as before) and its eco and full buy lines are computed (a
Spectre with Light Armor, 2,000; a rifle with Heavy Armor, 3,900). Measured
against 8.4.4: the study pool is identical, and of the 86 notes every review
and chat retrieval can reach only the footsteps note's words changed.

`npm run check:primer` (in npm test) holds all of it offline: every number in
every render inside a recorded number, with no spelled one in the primer's
own words (a planted digit must be caught); the extraction giving the
generated file back from the API's shape and failing closed on each rule;
only confirmed facts, and exactly the player's decision; hits, time to kill
per gun and damage as shown, recomputed independently; mutation (a Spectre
head hit of 110 removes "no Spectre head hit kills"); the mirrors and the
canaries; size (the Ask Coach core under 17,000 characters, about 16,400
today); no dashes, no source name, no patch number; the live check on a faked
valorant-api (a changed Sheriff head hit withheld with its sentences, an
outage after 24 hours, a failed extraction at once); the history and both
gates (a heading and its short lines kept, a page of chrome no notes, a 13.09
that moved the shield and the plant withholding both, 14.01 over 13.08 a hole,
Occlara's own rules never withheld); the slices' counts (a Judge's shell, a
Regen Shield, an unknown armour, a name in a team list); check:playbook's
planted controls; and where the primer goes.

## Ask Coach knows the match it is asked about

Ask Coach (8.5.0, v2) answers about one match at a time, and code decides
which. Before it was handed a 2,400 character summary of whichever review was
open, the tip era's session tips and the tracker's profile, and the model said
every game number from memory.

```
src/shared/chat-context.js       which match, the hold, the rounds a question names, the v2 context, the fill's rules
src/main/services/ask-coach.js   main's half: the chip, the refusals, both shapes, the one time fill
src/renderer/chat/               the page: the match chip, the starters, a thread per match
server/services/chat-prompt.js   normalise, the prompt, parseReply, the retry's words
server/services/fact-gates.js    the reply gates, a sentence at a time
scripts/bench-chat.js            the bench that picks the model (spends money)
```

- **Which match, in code** (`chat-context.js pickMatch`). The chip says it:
  the newest of the game when the page is opened from the sidebar, the
  review's own from "Ask about this match", one picked from the ten newest,
  or none for a general question. A question moves it only by the map rule:
  a map written as a proper noun after "on", "in", "at" or "my", in a question
  with a match word (a round, a death, a result, "match", "that game"), and
  exactly one of the ten newest on that map. "How do I play B on Split" names
  no match; "why did I die in round 5 on Split" does. Two of the ten or more
  on it is answered by asking which, none by saying so, with no model call
  either way, and a question that moved the chip goes alone, under a divider,
  its reply naming the match. The round a question names is read in code as
  well (`roundOf`): round 5, round five, R5, round #12, the pistol round by
  side (the second is the mode's own, round 5 in Swiftplay), the first, the
  last, overtime, and ronda, Runde, rodada, manche. A review older than the
  ten newest that "Ask about this match" or the chip named stays the match,
  and joins the list (`ask-coach.js list`): asked about the player's eleventh,
  the question went to the newest.
- **Nothing mid match, nothing of a held match.** A question asked while a
  match is in progress is refused before any request (`MID_MATCH`), and asked
  again after the fill and the tracker, which take time. A review saved after
  a stop in the middle of its match may be of a match still being played
  (`held`: `stoppedLive`, not linked, saved under 90 minutes ago, no review
  after it): never the default, never listed, refused when "Ask about this
  match" names it with the time it lifts, and frame chat refuses its frames
  (`HELD_FRAME`), until Riot's record links it, a later match is recorded or
  90 minutes pass. Its counts are no part of what the chat is told across
  matches either (`ask-coach.js library`): the patterns and the breakdown's
  rows are counted again without it while it is held, where they had told
  "across your last matches" what the held match had shown so far.
- **What it is sent** (`context.v: 2`, `build()`): the match as its review
  keeps it, each card's Riot facts (the second, the killer and gun, first death
  and kill, kills, the trade, the numbers standing, the clutch, the plant's
  site and time, the kill feed in order with its agents and guns, kept from
  the link since 8.5.0 and once filled on a review saved before), the
  numbers an explanation needs computed (seconds from the player's last kill
  to the death, seconds after the plant), the screen's spot and ult, a saved
  look's cause, sentences and digits, the counted lists and patterns, the
  grade with its evidence, the numbers against the player's own average, the
  coach's summary and focus, the breakdown's rows for the map and the agent,
  the patterns across matches, the tracker's numbers by name and the eight
  newest other matches a line each. A card saved before 8.0.3 is read back
  from its sentences (`oldFacts`), as the breakdown reads them: the player's
  Abyss swiftplay went with no killer, second or trade in any round. A saved
  lost duel whose better play moves the player goes without its label (the
  phrase lists, above). NEVER SENT: the engine's match memory, session tips,
  the tracker's `_riotId`, the match list's 0 to 100 rating, any player's name,
  a held match, anything mid match. Today's fields go beside it, so a server
  from before answers as it always did (`oldText` is the old string, moved
  whole).
- **The server takes it bounded** (`chat-prompt.js normalise`): agents, guns,
  maps and callouts against the game data, causes against `CAUSES`, numbers
  in range, free text through the handle shape, `BUY_BLAME`, the match's own
  name set when this server holds it, the capital rule and the killer gate,
  and the spike's time left computed from the primer's stated timer, never
  typed on the client. The capital rule reads the game's own capitals in lower
  case first, the review route's `REVIEW_WORDS` word for word and the chat's
  own (`fact-gates.js lowerGameWords`, test:chatgates holding the two lists
  equal): a summary sentence with "K/D", "ACS", "MVP" or "Victory" in it
  never reached the prompt.
- **The prompt** (`buildPrompt`): the spec's rules word for word, the primer's
  core for the match's mode as of the match (the same text for every match on
  the patch, so it can be cached), then the player, the match (the asked round
  in full with its feed in order, every other round a line), the kits and,
  with `CHAT_PRIMER_GUNS=slices`, the guns named (the core then keeping its
  roster), eight coaching notes at most (by the topics the counted mistakes
  point to, and `retrieve()` on the asked round, Advanced coaching honoured),
  the conversation, and outside English the language line. A 20 round match
  fits its own 19,000 characters with its round in full (`DYNAMIC_MAX_CHARS`,
  trimmed in four steps). League gets its computed review and no primer;
  `v2-noprimer` is the bench's control.
- **The gates, a sentence at a time** (`fact-gates.js check`, through
  `parseReply`). A sentence that fails one is dropped, never repaired: a
  player's name or handle, or a capitalised word the player typed (never in
  German); a source named; a meta or a ranking ("X is the best agent"); a round
  the match does not have; a result or a death the record contradicts, the
  negation read at its verb ("you didn't lose round 5" stays); a death called
  something its look did not call it; a killer who is not Riot's; a callout
  off the map or an ability off the player's kit in a sentence about a round;
  a standing, a time or a gun the record contradicts; the buy phase or the
  spawn blamed; an economy claim (Riot's record holds no buys before Phase D);
  "N of M" that is no counted one; "0:08" for a second; and every number,
  spelled ones and hit words turned to digits first, each by its unit and
  what it is about, against the primer's own provenance (by gun, part, armour
  and band), the match's numbers, the round's times within a second, the
  standings and the look's digits. Outside English a number is checked by its
  digits and unit alone, and the capital rule is English's. The name heuristic
  is in log mode (`name-log`, counted, never dropped) until bench:chat
  measures it. A reply whose first sentence was dropped, or that keeps fewer
  than two, is asked for once more with the reasons named (`retryPrompt`),
  else the honest line.
- **What bench:chat's panel found the gates dropping true, 15 Oct** (Sol v2,
  30 answers read by three agents; each fix pinned in test:chatgates from the
  run's own replies). The match's own result beside a round ("which you won
  13 to 11, round 22 was an attack you lost") was taken for the round's; a
  curly apostrophe (Sol's "didn’t") broke the negation, so the gates read every
  sentence straightened (`straighten`) and the reply keeps it as written;
  "pistol round" named round 1 wherever it stood, so it names a round only as
  one ("the pistol round", "your second pistol round", the second the match's
  second), and the review's run reader never sees it, nor "and one of", which
  read "pistol round and one of the two rounds you survived" as round 1. A
  question naming two rounds sent neither in full, the cause of both wrong
  facts the panel found: every round a question names is told in full, three
  at most (`MAX_ASKED_ROUNDS`). A bare "Yes." or "No." whose claim was dropped
  goes with it and the reply is asked for again. A gun said to be the
  player's must be one the round's facts give them ("you fought Clove with a
  Classic" where the Classic was the killer's drops). The prompt's static
  prefix and the match's facts come first, byte for byte the same for every
  question of a match (`buildParts`), and the gun table is in the slices by
  default (`CHAT_PRIMER_GUNS=core` puts it back), since Sol cached 0 tokens.
- **What an independent probe of the gates found, 15 Oct** (each pinned in
  test:chatgates, each pin failing with its rule reverted). Passed: "Neon is
  better than Jett right now", "Jett is S tier", "the highest win rate on
  Abyss", "the most picked duelist" and "strong in the current patch", all
  rankings now (`AGENT_RANKED`, `TIER`, `RATE_RANKED`, `MOST_PICKED`,
  `PATCH_NOW`); "Pro players like Brimo" with the capital that opens a
  sentence; "the coach calls round 6 a lost duel", the label read past the
  round named; "you lost the first round", "round 5 was a loss" and "the enemy
  took round 5"; in a reply about one round, "nobody traded you" and "a
  teammate traded you", what the player bought or saved and their own gun
  ("your Vandal lost to his Sheriff"), none of them read as about the round;
  "3 against 4" for 4 against 3, the player's side now first unless the
  sentence is about theirs; "you died 25 s into the round" for another
  kill's 25 s or a counted line's 30, a death's time now Riot's second of it
  within one; "three kills in round 3" for two, a named round's own count; in
  League, "Ahri is better than Zed right now" and "the best champion right
  now" (`CHAMPION_RANKED`, `CHAMPION_META`, League's alone, "your best
  champion by grade" the player's own). And a review's own sentence naming a
  player of the match in lower case reached the prompt: the match's name set
  holds it now (`chat-prompt.js matchNames`).
  Dropped wrongly: "I don't have pick rates or a tier list for the current
  patch", the honest answer the rules ask for, with its retry told it had
  ranked agents (a meta word a negation or "rather than" governs is no
  claim, `META_REFUSED`); every sentence saying "K/D", "Overtime" or "Attack"
  once the player had typed the word with a capital, as an echo of a name
  (the coach's own words and the game's capitals are no name they typed);
  "I cannot tell you what you bought, because this match's record does not
  hold it" (`ECON_REFUSAL`), and "you bought time" or "you saved your
  ultimate", money words only where they are money; "a 1.48 K/D", "your K/D
  in this match was 1.48", "your grade for the match was 66" and "you went
  31 and 21", the scoreboard as the review itself writes it; "you died 21
  times in 24 rounds", the scoreline's own deaths read as a repeat nobody
  counted; a League death "12 minutes 34 seconds in", as the prompt itself
  writes it; and the counted line quoted, "you got the first kill of the
  round 8 times, rounds 5, 11 and 2 more", read as rounds 8 and 2 (a counted
  line quoted is about the match, never the asked round alone,
  `quotesCounted`). Still unchecked, by the spec's own reach: a claim about
  the round that is not about the player ("the spike was planted at B", "it
  was a clutch"), another kill's killer ("their Viper killed your Sova"), any
  number outside English beyond its digits being one the facts hold
  somewhere, and an echo in German, which capitalises every noun. Still
  dropped: a past sentence with "kept" or "again" in it that no counted line
  says ("you kept your crosshair at head height"), and a general rule naming
  round numbers ("a save in round 2 sets up a full buy in round 3").
  bench:chat's raw rate, its drop rate and the person's read are what
  measure them.
- **Its model, its time and its cap are the route's** (above, "Ask Coach v2,
  the route's half"): `AI_CHAT_MODEL` pinned with no weaker model behind it,
  40 s across both calls, and $0.15 a licence a rolling day. The page says
  the cap in the player's language with when it lifts ("You've used today's
  questions. Ask Coach is back at 21:14."), and main waits 50 s for a reply.
- **The one time fill** (`ask-coach.js fill`, `chat-context.js needsFill`,
  `applyRoundRecord`). A review linked before 8.5.0 keeps no kill feed, plant
  time or comps, though Riot's round record has them. Ask Coach opening on it
  asks `/match-rounds` once, `purpose=fill` (the server's fill reserve), for
  the connected Riot ID only, three seconds after this app's last HenrikDev
  request, never mid match, never for a held match and never while the
  backfill or a review's own link is at work, and stores those fields and the
  stamp, nothing else: no regrade, no narrative, no list. An answer that will
  not change stamps it asked and it is never asked again; a 503 asks on the
  next open. A question waits for a fill under way 8 s at most. The fill
  stores the feed by the link's own function (`valorant-verify.js
  killFeedOf`), so a review linked by 8.5.0, which keeps the same fields from
  its link, is never filled.
- **League and frame chat.** A League question gets the computed review alone
  (the scoreline, the grade, the lists, every death by the game's clock),
  never the summoner name. Frame chat sends a linked round's Riot facts
  (`riot`, read by the route's `riotFrameFacts`) and refuses a held match's
  frames.
- **The page** (`src/renderer/chat/`): the chip is the shared dropdown, the
  starters come from the match (its round with a look to walk through, its
  agent, its lost rounds; general ones with none; League's own), a switch
  starts a new thread under a divider, the cap and the hold are lines rather
  than bubbles, and a reply keeps its paragraphs (`white-space: pre-line`),
  set by textContent alone. An answer still on its way when the chip moves
  lands where its typing dots stood, in the thread that asked it, and never
  joins the new thread's conversation: it had landed under the new match's
  divider and gone to the model with that match's next question.

`npm run test:chatcontext` holds the hold (a held match's counts out of the
patterns too), the map rule and the rounds, a review older than the ten
newest kept as the match, what is never sent, the cards and looks (old cards
read back equal to their fields on the real Abyss), the fill and the refusals
on fakes, and both shapes; `npm run test:chatgates` every gate on its
positives and negatives, each regex on a known positive and negative, the
independent probe's cases above, the prompt's order and budget, the slices,
the retry and the honest line, and the real primer's numbers; `test:surfaces`
the page.

**bench:chat picks the model** (`npm run bench:chat`, spends money, about
$3.80, stopped at `--budget`, $5). Six matches: the repo's Abyss 13 to 11
built offline and filled from its own record, and its Split 13 to 7 (the
player's upgraded review where their library has it, else the repo's 8.0.1
review upgraded offline), their questions in
`scripts/fixtures/chat-questions.json`; and the player's Fracture, Sunset,
Abyss swiftplay and Pearl, theirs in `userData/bench/chat/`, never in the
repo. About thirty questions, each with a key written by hand from
Riot's record (what a right answer states and the claims it must not make),
checked apart from the gates. Every question goes through `ask-coach.js`
itself on a read-only copy of the library, the player's reviews filled as the
fill fills them, kept beside the bench and never saved. The server must send
an admin bench the model's own text (`raw: true` beside the admin password:
`raw`, `rawRetry` when the gates asked again, and `usage`, both calls' prompt,
cached and completion tokens; a licence's own `raw: true` is sent the reply
alone), or the bench stops at its first answer. Even there a sentence carrying
a word of the match's name set is withheld (`coach.js rawForBench`, the
marker `name-gate.js WITHHELD`, which bench:chat counts as a name), since the
bench scores raw replies: the wrong fact rate with its exact 95%
interval, what the gates caught and what slipped past them, drops, retries,
honest lines, names, cost, cached tokens and latency, every bar of 8.13 and
the cheapest model passing them all. The finalist's answers go to a sheet for
a person to read, folded in by `--score <run> --read <read>`. `--dry` sends
nothing, reads no licence or password and writes nothing: it holds every key
to its own samples and every question to the match and round it must land on.
It runs after the server deploys with v2 off; on a pass `AI_CHAT_MODEL` and
`CHAT_PROMPT=v2` are set on Railway, and unsetting `CHAT_PROMPT` rolls it back.

## A refund must take the licence away

The Stripe webhook handled four events and none of them was a refund. That left
a hole with no floor under it: a LIFETIME purchase writes `expires_at: null` and
`status: 'active'`, has no subscription to cancel, and `validateKey` asks only
for an active status and an unexpired date. **Buy lifetime, refund it, keep the
product forever.** Nothing fired, nothing logged, nothing expired.

`charge.refunded` and `charge.dispute.created` now revoke, writing both the
status and `expires_at: now`. Two independent reasons for the same answer, so
the licence dies even if `validateKey` is ever relaxed about status.

**And then every plan became a subscription, and none of it reached them.**
The site sells weekly, monthly and yearly through its own create-checkout, all
three `mode: subscription`. A subscription's Checkout Session has no payment
intent, so the lookup by session never found a site licence; a Dispute has no
customer, so a chargeback had nothing to go on; a refund left the subscription
billing (a weekly refunded on day two was charged again on day seven); and the
status written, 'refunded', is one the licences table's CHECK refused. So the
charge is read again as the server's own API version renders it (stripe-node
14 pins 2023-10-16, which still has `charge.invoice`; a basil event does not),
and the licence is found in this order: **its invoice's subscription** (exact,
since a subscription is one purchase), then the checkout session of its
payment intent (the old one-time lifetime), then the customer.

**A full refund or any dispute cancels the subscription, FIRST**, so billing
stops even while the database refuses the revoke and Stripe retries it.

**A PARTIAL refund must not revoke.** `charge.refunded` fires for both, and a
goodwill partial refund is not a reason to take the product away. The amounts
are compared as well as the flag. A goodwill refund must be partial, because a
full one ends the purchase, its subscription included.

**The customer is a FALLBACK and only when unambiguous.** When neither the
subscription nor the session names a licence, the customer is used only if they
have exactly ONE active licence: a repeat buyer has several, and revoking all of
them over one refund is a worse bug than the one this fixes. It logs loudly and
refuses rather than guessing. A dispute takes its customer from its charge.

**The reason is written where the table allows it.** 'refunded' and 'disputed'
once the site's migration adds them to the status CHECK; until then the CHECK
refuses them (23514) and 'cancelled' is written with the expiry now, so the
same code works on either side of the migration. Nothing that follows undoes a
revoke: `customer.subscription.deleted` keeps a 'refunded' or 'disputed' reason,
and a payment never brings a revoked licence back (a renewal logs it for a human).

### Renewals reach the licence, and a refused write says so

**No renewal ever reached a licence, and the logs said they did.** The licences
table's trigger (`prevent_license_privilege_escalation`) exempted the service
role by `request.jwt.claim.role`, a setting PostgREST no longer sets, so it
refused the webhook's every write to status and expires_at; nothing read the
error, "renewed. New expiry" was logged either way, and every subscriber lost
the app at the end of the first period while Stripe went on charging them.
Three more things would each have done it alone: Stripe's API 2025-03-31.basil
moved an Invoice's subscription to `parent.subscription_details.subscription`
(events arrive in the endpoint's version, so both invoice handlers broke out
silently), the expiry was the old one plus 7 or 30 days with no yearly at all,
and a failed write answered 200, so Stripe never retried it.

- **Every licence write in the webhook checks its error and throws**, the
  handler answers 500, and Stripe retries the event for up to three days. A
  write the database refuses is retried until it lands, never logged as done.
  Errors are logged by code and message only: a CHECK violation's details are
  the whole row, key and all.
- **The expiry is Stripe's own period end plus two days** (`services/billing.js`,
  shared by the webhook, `/api/payments/cancel` and the repair route below):
  `invoice.paid` writes the paid invoice's latest line period end plus the
  grace, status active, in either API version and for every plan. Stripe charges
  a renewal about an hour after the period ends, up to three days when its own
  deliveries fail, and the app stops the recording in progress the minute an
  expiry passes. A subscription set to cancel at its period end gets the grace
  too: the customer can renew it in Stripe's portal (the site's Manage
  subscription) before then, which tells this server nothing, and that renewal
  is charged about an hour after the end, so an exact end stopped the match
  being recorded for that hour. Access stops when Stripe ends it:
  `customer.subscription.deleted` sets the licence cancelled. A renewal never
  moves an expiry earlier: an invoice that ends sooner (a one-off charge on the
  subscription, a proration, an old event replayed) cannot cut a paid period.
- **Stripe does not promise order.** `invoice.payment_failed` asks the invoice
  how it stands now, so a failure delivered after the retry that paid cannot
  lock out a paying customer, and it marks only an active licence. A renewal
  brings back a merely cancelled licence only while Stripe still bills its
  subscription (one cancelled on the site while its billing call failed).
- **A failed payment is a grace, not an end.** `invoice.payment_failed` marks
  the licence on Stripe's first failed attempt at a renewal, while its expiry
  still runs two days past the period end and Stripe tries the card again, and
  every licence check refused it: within three minutes of a declined card the
  app stopped the match being recorded. Now a payment_failed licence is usable
  until its expiry: `checkKey` (coach.js) answers valid, and
  `/api/license/activate` and `/validate` answer `valid: true` with
  `status: 'payment_failed'`, the plan and `expiresAt`, which the app warns on
  and works through. The device lock holds as before. With no expiry, or a
  past one (answered `expired`), it is not usable, and cancelled, expired,
  refunded and disputed never are. One rule, `usable` in `routes/license.js`,
  shared by checkKey and held equal to the app's own (`license-service.js
  usable`) by `test:licenceoutage`. Only to an app that knows it
  (`knowsGrace`, 8.3.2 and later by the `X-Occlara-Version` every request
  carries): one before it read anything but 'active' as ended on its own
  minute check, so answered valid it stopped the session after every three
  minute re-check and offered Start again in between, and it is refused as it
  always was. The refund's customer fallback counts a licence in its grace as
  live, and the account dashboard's `renews` is false once Stripe has ended
  the subscription (canceled, incomplete_expired, or no record of it).
- **A lifetime licence that names a subscription** (one made lifetime by hand)
  is never given an expiry, cancelled or marked payment_failed by that
  subscription's renewals, failed payments or end. A full refund or a dispute
  of its charge still revokes it, as it revokes anything that charge bought.
- **`/api/payments/cancel` stops every subscription Stripe still bills**, not
  the newest licence's: Stripe is asked about every subscription the user's
  licences name, whatever their status, each is set to cancel at its period
  end, and each licence still on runs to that end plus the grace (the end the
  customer is told is Stripe's own). One whose payment is failing (past_due,
  unpaid, incomplete, paused) is cancelled now and says `endedNow`: its period
  was never paid, and set to cancel at its end Stripe went on retrying the
  unpaid invoice, so a customer who cancelled to stop the retries could still
  be charged. A Stripe failure is a 502 and a refused write a 500 that says
  billing is stopped, never a 200.
- **Only Occlara's own objects.** Every event of the Stripe account reaches the
  endpoint, another product's included. A full refund or a dispute cancels a
  subscription only when an Occlara checkout started it (its metadata names
  one of Occlara's plans and a `user_id` or `userId`, asked of Stripe first so
  billing stops while the licences table is down) or a licence names it, and a
  checkout naming a user the licences table does not have (`user_id`
  references auth.users: 23503, or 22P02 for an id that is no uuid) mints
  nothing and answers 200: as a 500, Stripe retried each such sale for three
  days, and an endpoint that keeps failing is one Stripe disables.

**The repair: `POST /api/admin/licenses/sync-expiry`**, behind the admin
password. Fixing the webhook moves a licence on at its next renewal; this moves
every existing one now, by the same rule, reading each licence's subscription
in Stripe. A DRY RUN BY DEFAULT: it writes nothing and lists every row it would
change, before and after; `?apply=1` writes them, each write checked, and answers
500 listing any that failed. One Stripe bills runs to its period end plus two
days (the same when set to cancel). One whose card fails is payment_failed to
the end of the period PAID for plus two days, which is where the unpaid period
began (`billing.js failingExpiryFor`): Stripe moves the period on when it bills
the renewal, paid or not, and since a failed payment is a grace the unpaid
period's end was that period free, 32 days on a monthly plan and 367 on a
yearly one, and an unpaid licence (Stripe done retrying) revived; an unpaid,
incomplete or paused one is never moved later than it already runs.
A site cancelled licence Stripe still bills is active again for the period paid,
one Stripe ended is cancelled at the moment it ended, and a revoked licence
whose subscription still bills, a lifetime one, or a subscription Stripe has no
record of is listed and left as it is. Run it once the migration below is live.

**What the webhook mints, and what it logs.** The site mints its own licences
(create-license, at /success and from the account page), naming the buyer as
`metadata.user_id`, so a site purchase is one quiet line here: "UNLINKED
PURCHASE" is kept for a checkout neither checkout made, where it was logged for
every site sale and hid the real orphans. Only the old Railway checkout's
purchases (`client_reference_id` or `metadata.userId`) are minted here, the plan
from the price's own interval (week, month, year) rather than STRIPE_PRICE_*,
the key from `crypto.randomInt`. No licence key or email is printed anywhere.
The old public `POST /api/payments/create-checkout` (no sign in, any userId, the
old $20 and $100 prices) and `GET /api/payments/success` (a key for any session
id) answer 410: neither the site nor the app calls them.

**The frames go only to providers that keep nothing, and asking never takes
the product down.** Every OpenRouter call (`chatCall` in coach.js) asks for
`provider: { data_collection: 'deny' }`. A model with no provider that denies
collection has every call refused, HTTP 404 "No endpoints found matching your
data policy" (or the 503 OpenRouter's errors page lists for the same, "There
is no available model provider that meets your routing requirements", the
data policy being the only routing requirement sent), so that one refusal
falls back per call: it is sent once more without the preference, booked as
any call, and nothing else ever is (a 400, 401, 402, 403, 429, any other 5xx
or a timeout is the call's own answer). The calls
that fell back are counted per route since boot (read, forensics, review,
chat, bench, other), said in one log line a route an hour at most, and
`GET /health` counts them as `dataPolicy: { mode, fellBack, refusedAgain,
since }`: a route counting in `fellBack` sends its model's frames to providers
that may keep them, each call after a refused round trip, until the model
changes. They are counted by what happened to the retry: one OpenRouter
refuses again ("No endpoints found" once more) went to no provider, so it is
`refusedAgain`, never `fellBack`: an account wide privacy setting or a model
with no live provider stops it, which `AI_DATA_COLLECTION=allow` does not
change. One answered, cut off, or refused in other words may have reached a
provider, so it is `fellBack`.
`AI_DATA_COLLECTION=allow` sends no preference and retries nothing.
`test:aiprivacy` holds it on a scripted provider, and boots the server for
/health.

**NOT IN THIS REPO, and none of it works without them:**
- The site's SQL migration: the trigger's service role exemption read from
  `request.jwt.claims`, and the plan and status CHECKs taking 'yearly',
  'refunded' and 'disputed'. Until it is live every renewal and revoke answers
  500 and Stripe keeps retrying, which is the intended, loud failure, so it
  goes live BEFORE this server deploys: the old server is unharmed by it, and
  Stripe retries an event for three days and disables an endpoint that keeps
  failing.
- The Stripe endpoint subscribed to `invoice.paid`, `invoice.payment_failed`,
  `customer.subscription.deleted`, `charge.refunded`, `charge.dispute.created`
  and `checkout.session.completed`. It was created listing four. Its API
  version can be either shape; the code reads both.
- The repair run once, dry first, then `?apply=1`.
- STRIPE_PRICE_WEEKLY, MONTHLY and LIFETIME removed from Railway: nothing reads them.

`npm run test:refundrevoke`, `test:renewals`, `test:billingroutes` and
`test:checkoutplan` run the real handlers against `scripts/fixtures/fake-billing.js`:
a licences table with exactly the live columns, the status and plan CHECKs as
the migrations define them (before and after the site's), the trigger as it
behaves live, and PostgREST's own errors; a Stripe that answers the server in
2023-10-16 and sends events in 2023-10-16 or basil. The old fakes agreed to
everything, which is how test:refundrevoke passed while every site refund left
its key working. Each fix was proved by reverting it and watching its check fail.

## Conventions

**No em dashes or en dashes** anywhere, in reviews, in UI copy, in docs, in
commit messages. Use commas. This is a hard rule. In code that has to match a
dash, write it as an escape (`\u2014`), never the character.

**Never write a regex through a shell heredoc.** `\b` becomes a literal
backspace byte, the file still parses, `node --check` still passes, and the
regex silently matches nothing. This has bitten several times, once killing
every pattern in a tip gate that no longer exists, and in 8.0 a Python patch
through a heredoc turned a `'\n'` into a real newline inside a JS string.
Edit regexes with a file-editing tool, and always assert a new regex matches a
known-positive string.

**Secrets come from the environment.** `.env` and `server/.env` are gitignored
and this repo is public. Never commit a key.

**A session reaches the repo only through `scripts/fixtures/make-session-fixture.js`**,
and never a frame, a still, a clip or a screenshot of it. It keeps the engine's
inputs, its free text cut to an allowlist, and since 8.4.1 each run of dropped
words leaves one placeholder, "someone": dropped outright, "<name> killed by
Chamber" became "killed by Chamber", which the spectate guard reads as the
player's own death banner, and the Fracture replay lost the read that let round
6 register a second death. It writes nothing while the fixture holds a word of
the Riot ID in Settings, which nothing accepts, or a word the session wrote that
neither the allowlist nor the game data knows, until a person has checked it is
no name and passed it with `--accept` (`leaks`, `strangeWords`;
`test:sessionreplay` holds the Fracture fixture to the same lists). The four fixtures before it were cut by the old
scrubber and are not regenerated, since numbers were measured on them:
regenerated, the text of 81 to 260 frames each changes and the anchored KILLED
BY flips on 5 to 15 kill feed lines, the guarded state of 2 frames (the Abyss
swiftplay) and 6 (the Abyss unrated) changes, and every test passes with the
same lines, the same deaths, rounds, modes and reads.

`src/shared/valorant-data.generated.json` is generated by
`npm run sync:valorant` from valorant-api.com. Do not hand-edit it.

**src/ never requires from server/** (`npm run check:clientboot`), because
`package.json` ships `src/`, `assets/`, `node_modules/` and `package.json`,
and **not `server/`**. A require reaching across resolves in the repo, passes
every test, and throws MODULE_NOT_FOUND on a real install. It is the mirror of
`check:server`, and `sync:valorant` writes an identical copy of its data into
`src/shared` and `server/` so the shortcut is never needed.

**The name is Occlara; two identifiers are still ghostcoach.** `appId`
(`com.ghostcoach.app2`) and the `GhostCoach-releases` repo deliberately keep the
old name. `appId` is what Windows and electron-updater match an install on, and
the releases URL is compiled into every client already in the field, so moving
either orphans every existing user: no updates, no licence, no history. A brand
is what users see; an identity is what the software is.

The Railway host `ghostcoach-production.up.railway.app` is in the same category
and is the worst of the three to move, because every installed client has it
baked into `src/shared/config.js`. Renaming the Railway service breaks coaching
and licence checks for everyone on an older build, instantly. The safe path is a
custom domain pointed at the same service, kept alongside the old hostname
forever, never a rename.

**The userData folder DID move**, from `%APPDATA%\GhostCoach 2.0` to
`%APPDATA%\Occlara`, because unlike the three above it can be moved together
with its contents. `src/main/services/profile-migration.js` does it once on
launch and `npm run test:profilemigration` covers it, including every failure
path. The rule there is never lose data: any failure keeps using the old folder
and the app carries on. Note it necessarily runs before the single instance
lock, which lives inside userData, and read the comment before reordering
anything.

`artifactName` was on that list and is not any more: it moved to
`Occlara Setup.${ext}` in 4.7.0. It was never actually load-bearing.
electron-updater resolves the installer through `latest.yml`, which is
regenerated every build and names whatever the artifact is currently called, and
nothing in `src/` hard-codes an installer filename. Verify that before assuming
any other name here is safe to move: the test is whether something outside this
repo has the string baked in.

**The logo is an aperture, and it exists in five places.** `assets/logo-mark.svg`
is the source; `splash/index.html`, `dock/index.html` and the Recording screen in
`shell/index.html` (a thinner stroke at 88px) inline their own copies so they
can animate and inherit `currentColor`; `scripts/generate-icon.js` draws it
mathematically for the `.ico` and `.png`. Change one and change all of them.
The SVG carries an explicit `color="#FFFFFF"` because an external SVG loaded
through an `<img>` tag is its own document, so `currentColor` resolves to black
there and the mark renders invisible on the dark ground.

**Look at UI changes, do not only compile them.**
`npx electron scripts/shot-surface.js shell settings` writes real screenshots to
`dist-surface-shots/`, one surface on its own, and `OCCLARA_SHOTS=1 npm run
check:mainwindow` writes `main-<page>.png`, every page in the window beside the
sidebar with saved reviews in it. A dropped colour declaration, an unshipped
font weight and a stretched logo all pass every automated check in this repo
and are obvious in a picture.

## Releases

Built with electron-builder and updated via electron-updater. Installers are
published to the separate `lowful/GhostCoach-releases` repo, which keeps the old
name on purpose: electron-updater reads it, and the code repo being renamed does
not make it safe to rename. The code repo itself is `lowful/Occlara`, renamed
from `lowful/GhostCoach` on 2026-08-30.

The main repo's single release (id 296500148) carries the **public download**,
and `scripts/publish-download.js` refreshes it as the second half of
`npm run release`. It publishes the same bytes under **two** names:

- `Occlara-Setup.exe`, which every new link should use
- `GhostCoach.2.0.Setup.exe`, which must never be removed

The old name stays because GitHub bakes the filename into the download URL and
offers no redirect for it, so every link already in the wild, in Discord, in
someone's bookmarks, dies the moment it goes. This is about existing links, not
about auto-update, which reads `latest.yml` and does not care what the file is
called.

## The website

The marketing site is a **separate private repo**, `lowful/ghostcoach-9a45ac05`.
It is Vite, React, TypeScript, Tailwind and shadcn, and it syncs bidirectionally
with Lovable from `main`. None of this repo's conventions apply there, and none
of its files live here.
