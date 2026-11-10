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
src/shared/moments.js                 every death and highlight of the saved reviews, with the clips kept (8.7)
src/shared/riot-review.js             a review from Riot's record alone, or a recording linked late
src/main/services/backfill.js         Connect grades the last ten matches from Riot's record; the late link at launch
src/renderer/review/                  one page for every game, branched on review.kind
src/renderer/matches/                 the library and "Your patterns", the breakdown folded at its foot
src/renderer/moments/                 the Moments page: deaths and highlights, compiled, and their player
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

### The review's round 4 rules (Nov 2026)

From the live re-audit of 8.7.7 (the same 84 items, `scripts/fixtures/audit-round3-after-reviews.json`
holds its 24 reviews). A client sends `counts` (`valorant-review.js countsOf`, what the card counted)
every time, and that field is the mark: `match-review.js round4`. A body without it, every client
before this change, gets 8.7.7's prompt and study list byte for byte (`test:valorantreview` holds
48 bodies against commit 4a5aa0e).

- **One block of numbers.** `SWING AND COUNTS` replaces the swing facts: the swing, then the
  server's own count of the deaths (`matchCounts`, verified rounds, the card's rule), the raw untraded
  count and the card's ("13 of your 15 deaths with a teammate alive to trade", because the card leaves
  out a death as the last one alive and a player who died 16 times read 13 of 15 as wrong), then the
  side split, the post plant and retake record, the repeat killer and the early deaths
  (`matchFacts`). The counted mistake is shown with the same words (`mistakesShown`), the reply's
  unqualified card count is named the same way (`qualifyCount`), and a summary sentence or a round
  line quoting any other "N of M" goes (`allowedPairs`).
- **The lever by level** (`leverOf`, `LEVER_ORDER`). From Platinum the trade habit is the focus only
  when the library finds it again (`recurring`: `patterns.js recurringKeys`, the Patterns page's
  mistake keys counted over the saved reviews BEFORE this match, which is left out by its id, sent by
  both callers of `requestBody`: index.js `recurringNow(job.id)` for Riot's look and the engine's
  `opts.recurring`, read once in `requestMatchReview` before `match-ended` saves the match, never per
  frame) and this match's untraded deaths decided rounds (four, and
  half the lost rounds with a death). Otherwise Iron gets the basic habit, Silver the matchup first,
  Platinum a decision (post plant, retake, advantage), Ascendant the side gap, the first fight's timing
  or a repeated decision. The six audit matches at four bands are printed by the test. From Platinum a
  `DEPTH` rule asks for the match's numbers and a trade off, and `fundamentalsCap` keeps one line
  teaching the trade habit at most.
- **The notes and cases follow the swing** (`swingTopics`, `MATCHUP_BONUS`, `leverSituation`,
  `caseSituation`): a weak post plant brings post plant notes, a collapsed retake the retake notes,
  the repeat killer the notes that answer that agent.
- **The kit** (`kitBlockOf`): the player's agent and the two agents who killed them most, each
  ability's line from `ability-facts.js kitLines`. The kit gate reads "his ultimate" in a round line as
  that round's killer's.
- **Gates for every client** (they drop only what is false or leaked; of the 48 real replies one
  changes): `product` (the review, a next review, the app, Occlara: a clause is cut where the sentence
  stands without it, `productCut`), `library` (another match's number: "5 of your last 6", "your
  average"), `round state` (an attacker in a round with no plant told to let the enemy come or play
  for time, and since 8.7.10 the clock turned around, `clockWrong`: a sentence set after the plant
  that puts the attackers on the clock, or one in a round never planted that puts the defenders on
  it, as Corrode round 1's "so the attackers have to move against the clock") and `no plant` (advice that needs a planted spike, a defuse or a retake in a round Riot's
  record has no plant in), the drill gate also reading "whether anyone could help you" and keeping
  "rather than in Deathmatch", and the coherence pass (`cohere`): after a drop, a sentence opening on
  It, This, They or Her goes, and a she, her, he or him with no agent or enemy named before it goes.
- **What each death cost, from Platinum** (8.7.10, the blind audit of 8.7.9, stream B; detail in
  ask-coach.md, "The blind audit of 8.7.9"). A round 4 client at Platinum or above gets THE COSTLIEST
  DEATHS beside SWING AND COUNTS (`costLineOf`, `record-claims.js costRank`: a lost round above any won
  one, then the numbers the death left, after the plant, untraded), and its study list follows the two
  costliest deaths (`costTopics`: after the plant to the post plant or the retake, an advantage given
  back to playing the numbers, the look's cause to its topics, a first death a player down at a third of
  the weight so it never fills the list, `costKillers` the notes that answer their killers), and leaves
  out a note a round line or the focus already says (`repeats`). On the six audit matches at Ascendant
  the study list opens on 5 different notes. Below Platinum, and for a client before round 4, the
  prompt and the list are as before. And for every client a round line giving advice for after the
  plant of a death the record has before it goes (`record-claims.js checkPostPlant`, gate `record
  postplant`: Pearl round 3's "hold the planted spike" in three reviews, Sunset 2 to 5 round 1).
  The gate knows "before" only from the death's second against the plant's, so since the audit of
  round 7 (Split round 10 at Plat, a death 34 s before the plant coached as a post plant hold) a
  verified planted round Riot timed sends `plantSec` and Riot's `afterPlant` (`requestBody`), kept
  by `normalise` on verified rounds only. `row()` takes afterPlant false as certain only beside the
  plant time and the death's second, and without it a death within half a second of the plant is
  never "before" (the second is rounded). A client without the field is reviewed as before.

- **The trades and the distance in the review** (round 8, `ledgerOf`, every band, round 4
  clients): beside SWING AND COUNTS, the match's deaths and the early ones split by trade and by
  Riot's nearest teammate, every count with its rounds, its pairs quotable (`allowedPairs`). The
  record gates read alone said of a teammate close in a round line or the summary (`checkAlone`),
  and a rewrite ("nobody traded" for "nobody could trade") keeps the sentence in place
  (`recordGates`). Detail: ask-coach.md, "Round 8: counts over several rounds".

- **The round line's timeline and state** (round 8, the blind audit of round 7, round 4 clients;
  a client before round 4 keeps the old words, byte for byte): the standing is said as what it was
  and what the death left (`standingWords`: "their team 4 against 3 as they died, the player
  counted, not the first death: 1 teammate already down, leaving 3 against 3", the last one alive
  said so), the enemy's side by its noun ("the enemy were the defenders"). For every client, a
  planted round Riot timed says the plant's second and which side of it the death fell
  (`plantWords`, by Riot's afterPlant), a screen read of the plant under way is not sent for a
  death after the plant nor one of the spike down for a death before it (`phaseKept`,
  `READ_DURING_PLANT`, `READ_SPIKE_DOWN`), and the player's kills' places are said apart from the
  death's ("the player's kills fell at A Elbow"). `recordSent` keeps `killPlaces` whenever sent,
  and since round 8 the client sends them for every verified round with a kill Riot places
  (`valorant-review.js requestBody`; until that release only a death with no Riot place has
  them, and the kill place gate judges nothing elsewhere). The gates: ask-coach.md, "Round 8: the
  timeline and the state".

### Round 8: the game facts kinds in claimOf (Nov 2026)

`match-review.js claimOf` adds, after every kind before: `drill` also from `game-claims.js
teamDrill` (the shared team words, read past a disclaimer; the old `DRILL_TEAM` rule stays), `lethal`
for a one shot the damage table does not give (`checkOneShot`), `kit` for firing on the move
(`checkMoveFire`) and a kit's bullets said wrong (`checkBullets`), and `unseen` for where the
crosshair sat or what the player saw with no look saying it (the round's `seen` for a round line,
every round's `seen` for the summary and focus; never the look's better play). `claimGates` reads a
Deathmatch drill's frame across the summary's and the focus's sentences (`soloDrillFrame`), and is
exported for `test:valorantreview`. Over round 7's 24 reviews none of these drops a line.

### Round 8: the review floor, won rounds and the SWING line (Nov 2026)

The Fracture 5 to 1 reviews of round 7 (`match-review.js`, `routes/coach.js /match-review`):

- **The floor** (`floorFails`, `floorNote`, `floorMerge`, `floorFill`): a review shows at least
  one ROUND line where a round is worth one (`linePicks`) and a focus that says what to do. The
  Plat review was served with no round line and the focus "You give up a quick kill attempt to keep
  the advantage while the clock runs.", the tradeoff tail of a sentence the name gate cut. A reply
  short of it is asked for once more, while the client's 60 s allow (52 s budget, 15 s left at
  least), with the reasons in plain words, the name drop's never naming the word; the second reply
  fills only the fields the first could not show; what is still missing is computed from the
  round's own facts (`floorLine`: after the plant on attack, after their plant on defence, defence
  with the team ahead, untraded with the nearest teammate far or close, a first death on attack,
  the side's own lesson), for the costliest death (`costRank` from Platinum, else the best scored),
  the focus its instruction clause, both run back through `parse` and the name pass. A reply with
  no summary is no narrative and is never floored. Logged as `[review] floor: short of ...` by kind
  only; the response carries `dropped: { kind: count }` (`dropKind`) for a client from 8.5.0 or
  one that names no version, only where something went.
- **The focus instructs** (`focusGate`, `coherence.js instructs`, `FOCUS_DO`, `TRADEOFF_ONLY`):
  last in `parse`, a focus with no sentence opening on an imperative, straight away or after a
  lead clause, or whose first sentence is only a cost or a gain, goes (said `focus no
  instruction`). Of 172 real review focuses (rounds 1 to 7 served, the two audit fixtures) only the
  Plat one fails. English only. A floor, not a quality gate: grow the verb list rather than loosen
  the shape. Grown in the 8.8 review: "Focus on", "Work on", "Avoid", "Don't" and "Do not",
  "Prioritise", "Learn", "Remember", "Think", "Limit", "Reduce", "Aim to", "Make sure", with
  "only" and "never" as leads before a verb ("Only take fights", "Never peek alone"), and the
  lead clauses "During ...,", "The moment ...,", "Any round ...," and "Next half ...," up to 160
  characters. Each had nulled a correct focus and paid a second model call. "Only two of your
  deaths were traded" still fails.
- **Variant A is never floored** (8.8 review, `floorFails`): the bench's baseline asks for three
  unlabelled sentences, so it never has a round line or a focus; floored, every baseline review
  made a second call and was no longer the old review.
- **The true sentences of a line the record cut** (8.8 review, `lineRest`): `recordGates` dropped a
  round line whole for one sentence the record contradicts, and the floor put its computed line in
  place, so the Fracture Iron R5 lost "You lost a fair fight on the shot." with "As your teammate
  plants, hold from cover". The other sentences are kept where none leans on the cut one (a
  pointer, or "That", "This", "It", "So" right after it), led by the round's `floorLine` where what
  is left gives no instruction. Every later gate still reads the line.
- **Won rounds get a line when too few lost ones do** (`wonPicks`, `WON_LINES` 2, a round 4
  client): with fewer than two rounds `lineWorthy`, a death in a won round Riot verified that the
  look labelled or that was the round's first death may have a line, scored below any lost one,
  its facts saying "your team won it anyway, so say what the death risked, never that it lost the
  round", and `parse` accepts it. Fracture 5 to 1 gives rounds 2 and 6 beside round 5.
- **The SWING line is the server's** (`SWING_SWAP_EN`, `swingInto`): in an English review the
  summary's sentence one is the score and what decided it, never a SWING AND COUNTS line, and the
  route puts the block's first line in as sentence two, word for word, unless the summary already
  gives it (its numbers in order in one sentence, or its words anywhere). A review in another
  language keeps the old rule. A read prompt change: `verify:ai` and `bench:review` are the
  owner's gate before it ships. And the seam the old rule made is split
  (`coherence.js splitSwingSeam`, `SWING_SEAM`, `WON_NO_VERB`, in `seamGates`): "You won 5 to 1,
  opening fights and winning key duels despite this: you died 3 times in 6 rounds." reads "You won
  5 to 1 by opening fights and winning key duels. You died 3 times in 6 rounds."
- **A connective after a cut** (`coherence.js repairConnective`, in `structureGates`): a summary
  or focus sentence opening "So", "Thus", "Therefore", "As a result" at the head or right after a
  dropped one loses the connective; "That is why", "This means", "Which is how" after a drop goes
  as an orphan; a round line opening "So," reads as its clause. The `cohere` rule that drops a
  "So" after a gate's drop (not a name drop) still runs first.

Replayed over all 84 round 7 outputs against the tree before this stage: the only sentence newly
dropped is the Plat focus; the floor computes round 5 for Plat and Iron (Iron's line went to the
plant phase gate); the Ascendant seam is split; no SWING line is put in twice. Tests:
`test:valorantreview` ("ROUND 8: THE THIN REVIEW"), `test:reviewroute` ("THE REVIEW FLOOR, on the
Fracture 5 to 1 match", the four bands through the route).

### The economy is out of scope in the review (Nov 2026)

The owner's rule after the coach bench 9 (`docs/claude/ask-coach.md`, "The coach bench 9"): the coach
does not coach the economy (loss pay, buys, saves, ecos, forces, credits, who buys what, spend
advice). Ask Coach v2 had it first; the review has it now:

- **The prompt says so** (`match-review.js ECONOMY_REVIEW_RULE`, put in by `buildPrompt` right after
  the grounding rule on what the ledger holds, for every review and every grounding variant): never
  what anyone should buy, save or force, no credits, loss bonus or what the team can afford, no death
  or play explained by the economy. A round the ledger names as a pistol round, an eco or a loadout
  ("the team played it on an eco", Riot's buy as `RECORD_BUY` words) stays as a label of where the
  round sits. `RECORD_USE.buy` ("the team's economy changes what a death teaches") is gone, and a
  team buy no longer turns the grounding rule into "the economy is known where a round states it"
  (`SOME_ECONOMY` now says that of the casts only).
- **Gate economy** (`economyGates`, after `lookGates`): Ask Coach's `fact-gates.js
  gateEconomyScope` (`game-claims.js economyClaim`) over the review, a round line whole and a summary
  or focus sentence alone, logged as `economy` / `summary economy` / `focus economy`
  (`dropKind` economy, and `FLOOR_SAYS.economy` tells the floor's retry why). English only, as every
  gate over the review's words; `BUY_BLAME` before it still takes any "buy".
- **No note or case that teaches the economy** (`teachesEconomy`, `reviewCasePool`): `study()`
  lists none, `promptRounds` serves none (the retrieval is no longer told `sig.economy`, the economy
  note no longer moves inside `NOTES_FLOOR`, and `add` skips one), and the worked cases are picked
  from the corpus without the economy's (`cases.pick`'s pool). `signalTopics` sends the eco and
  forced round signals to no topic (`ECONOMY_TOPICS` is kept, unread). Of the 96 prompts the byte for
  byte check against 4a5aa0e replays (48 bodies, two marks each), 72 served an economy note or case
  then and none now; every other prompt is the old one plus the rule, byte for byte.
- **No buys pattern** (`valorant-review.js patterns`, `ECONOMY_PATTERNS`): the client no longer
  writes "Your team lost 4 of 5 rounds on a full loadout ..." (`buyDiscipline` still counts it, and
  nothing shows it); `served()` (`withoutEconomy`) drops a saved review's own line from the page and
  the share card, `chat-context.js` and `chat-prompt.js normalise` from Ask Coach, and
  `match-review.js normalise` (`ECONOMY_PATTERNS`) from an older client's review body. The grade and
  the counted mistakes, strengths and misses never had an economy entry (`grade.js`, `insights.js`),
  so no grade moved. The card's chips ("Eco round", "Full buy") stay: labels from the record.

Not changed: the cost line's "the team on a full loadout" (`costReasonLine`, the record's label), the
death look's buy fact (`death-forensics.js recordLines`, context for the look), and the live read
prompt in `coach.js`, which still reads the economy as context ("ECONOMY IS CONTEXT, NEVER A TIP"):
nothing it writes reaches the player since 8.0, and changing it needs `verify:ai`.
Tests: `test:valorantreview` ("the economy out of scope in the review", and the two byte for byte
checks), `test:riotrecord` (the buys pattern and the grounding rule), `test:gameclaims` (the review's
sentences).

### A Start that never reaches a game (Nov 2026)

The owner's ask: "make sure that when a user starts but doesn't go into a game it cancels that."
Until then a Valorant Start ran until Stop whatever happened: the game never opened, or left in its
menus, the reader kept reading the menus every 5 to 10 s, a recording session stayed open and an AI log
folder was made, for hours. No game was counted (only a reply the server calls in a match reserves one,
`coach.js inMatchState`, `usage.js noteRead`), but nothing ended it.

- **Never entered a game**: since Start (or the last resume) no reply was anything but LOBBY
  (`coaching-engine.js sawGame`, set in `processRead`, cleared by `start()`) and the ledger holds no
  round. Every reply the server could reserve a game on is not LOBBY, so a session that may be cancelled
  reserved nothing and nothing is released. The first reply that is not LOBBY disarms the watch for the
  session: menus after a match are the ordinary state between matches.
- **The rules** (`src/main/services/no-game-watch.js`, checked every `TICK_MS` 15 s while armed,
  index.js `noGameTick`): `NO_GAME_PROCESS_MS` 5 min with neither Valorant nor Riot's client running
  (`tasklist`, image names only; Riot's client up alone, launching or patching, is never gone; a probe
  that cannot tell never cancels; filtered by name since 2026-11-09, `PROBE_FILTERS`: `VALORANT*`
  first and, only when neither the game nor its stub runs, `RiotClient*`, a call each since two `/FI`
  on one field AND together, 16 to 78 ms of CPU a probe where the whole list took 300 to 530; a call
  that fails or prints nothing at all is cannot tell, tasklist's own no match line is absent), or `MENUS_ONLY_MS` 30 min with the game open and only LOBBY replies,
  one within `LOBBY_FRESH_MS` 2 min (reads failing or a capped account's stopped reads never cancel). 30
  and not 20: a queue reads as LOBBY like the main menu, high rank and off hour queues run past ten
  minutes, a dodge requeues, and a cancel in a queue loses the match's review, while 30 minutes of menus
  cost about 190 reads. A pause restarts both clocks.
- **The cancel** (`controller.cancelNoGame`, never with a game seen or a held seal): `stop({ discard:
  true })`, the reader stopped (its empty ledger asks for no review), `recorder.stopSession({ discard:
  true })` (this session's folders deleted after a clean stop, no counts block, no `recordingLast`; a
  finished match's held recording is untouched), `discardAiLog` (the session folder deleted), then the
  notice strip says `NOTICE`, "Stopped watching: no game started. Press Start when you are ready." (kind
  `no-game`, nothing about a match), and Start works at once. A very short match keeps the server's
  short game refund as before. League is not watched (it is coming soon; its recorder knows when a game
  runs). Tests: `test:nogame` (the rules on a fake clock, the process list, the real reader),
  `test:recorder` (the discard), `check:nogame` (the real index.js: cancelled with nothing kept, claimed
  or reviewed, Start again, a queue under the threshold left alone, a match always wins).

### The match's own memory (Nov 2026)

A death is read in the context of the match (`src/shared/death-chain.js
memoryOf`, `earlierOf`; the chains themselves in death-look.md, "Chains of
mistakes"). Counted in code from Riot's record of the rounds the player
played, each line with its floor: the callouts the player died at twice or
more (two at most) and the enemy who killed them there twice; the enemy who
killed them three times or more; an enemy who killed them in none of three or
more deaths before a round and three times from it on (an adjustment, said
as the counts and never as a reason); the longest run of three or more
deaths nobody traded with a teammate alive, said as its span past four
rounds; the round's first fights (three or more); and what the first half
kept that the second dropped by half its share (trades, first kills). Per
death, `earlier`: the same callout and the same killer in rounds before it,
and its place in a run nobody traded.

- **To the narrative** (`valorant-review.js requestBody` `chains`, always an
  object: `{ half, rounds: [{ n, first, worse, fair, gap }], main }`, kinds and
  numbers, never a sentence). The server (`match-review.js normalise
  chainsIn`, `server/services/match-memory.js`) checks each kind against its
  own rounds (`chainWords`: one the rounds do not bear out is dropped, a
  first mistake that goes takes its chain with it), words it, counts the
  memory itself (`memoryLines`, the client's rules, `test:deathchain` holds the
  two line for line), and holds the biggest repeat to the checked chains
  (`mainWords`). The round line gains the chain and "earlier in the match,
  ..." (`chainFacts`), and a block `MEMORY_HEAD` after the counted strengths
  carries the lines, the repeat and `CHAIN_RULE` (teach the first mistake, the
  later ones in a few words, earlier only as given). A client before sends no
  `chains`: no key is added and the prompt is byte for byte as before (the
  pattern of `swing` and `counts`), so the 8.4.4 pins and the round 3 and 4
  replays are untouched.
- **To Ask Coach** (`chat-context.js cardOf` sends a card's `chain` as kinds
  alone; `chat-prompt.js factsOf` `f.memory`, only when a card carries one):
  the match part gets up to four memory lines under COUNTED ("The match's own
  memory: ..."), and each round asked, in full, its chain checked and worded
  by `match-memory.js` and "EARLIER IN THIS MATCH, before round N" (three
  lines at most), every number harvested for the gates. A client before
  sends no chain and is told none of it.
- **Held to the record** (`record-claims.js checkEarlier`, reader `earlier`,
  last among the readers, the review and Ask Coach alike): "the third time
  you died at Hookah", "your third death at Hookah", "you had died at Hookah
  twice before", "Chamber had killed you twice before", "the third time
  Chamber killed you", "you died at Hookah again", "Chamber killed you again"
  are counted against Riot's rounds before the sentence's round, by Riot's
  place (never a whole site) and killer; a round before it the record cannot
  place leaves a count it could make true unjudged; a plan judges nothing; a
  false one drops the sentence. The memory lines and the repeat join the
  review's counted texts (`contextOfReview countedTexts`), so a count and its
  list are held to them too.

What the record cannot show, so nothing here says it: health and armour at
the fight, where anyone stood before the kill (positions are read on the
server only for the teammate's distance at the death), when in the round an
ability was cast (only how many, and most saved matches hold no casts at
all), whether a teammate could see the killer, and why an enemy changed what
they did. How the narrative and Ask Coach use the new blocks needs a paid
bench (`bench:review`, `bench:chat`), the lead's call.
