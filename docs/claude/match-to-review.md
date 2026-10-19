# How the match becomes a review

Moved out of CLAUDE.md word for word, nothing reworded or dropped (CLAUDE.md as of commit cc1f880, 8.5.0, lines 67 to 434). Sections here: "How the match becomes a review". It is a part of the section "Nothing reaches the screen during a match, in any game". "Above" and "below" in the text name sections that may now sit in another file under docs/claude/: grep the section's title there to find it. The table in CLAUDE.md says which file to read for which work.

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
