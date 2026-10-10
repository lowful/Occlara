# Occlara

A post-match AI coach for Valorant, Marvel Rivals and League of Legends. An
Electron client reads the game while it is played, shows NOTHING during the
match, and when it ends opens a graded review: a score out of 100 with four
categories and their evidence, the player's repeated mistakes with a fix for
each, what went well, and what was missed. Every review is kept in the match
library, which also counts what keeps repeating across matches.

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
- The AI log seals the live session (`liveLogSealed`), because an open log on a
  second monitor is a live feed of the match by another name. Frame chat refuses
  it, and Ask Coach gets no match memory and no review context mid match. A
  review's eye (below) does nothing mid match, and its read of one match is
  sealed the same way when that match is in the live session. The seal is
  decided on the session a read would serve, never the id asked for, and an id
  the log no longer keeps is gone, never replaced by the newest folder, which
  mid match is the session being recorded.
- Ctrl+Shift+E opens the last review, and does nothing while a match is in
  progress (`matchInProgress()`).
- The sidebar's status line carries notices only (a licence ending, capture
  blocked, the server down), never anything about the match.

### How the match becomes a review

```
src/main/services/coaching-engine.js  the READER: capture, /api/coach/read, the STATE guards
src/shared/valorant-rounds.js         the round ledger, fed the engine's GUARDED context
src/shared/match-end.js               when the match is over
src/shared/valorant-verify.js         Riot's record laid over the ledger
src/shared/death-frames.js            which deaths to look at, and which frames show them
server/services/death-forensics.js    the model's look at those frames: a cause from a closed list
src/shared/valorant-review.js         the computed review, which carries the two below
src/shared/insights.js                repeated mistakes, strengths, misses: counted, per game
src/shared/grade.js                   0 to 100, a letter, four categories with evidence, per game
server/services/match-review.js       the model's half: summary, a why per round, focus
src/main/services/review-store.js     every review saved, userData/reviews
src/shared/patterns.js                what repeats across the last ten matches of a game
src/shared/breakdown.js               the library by map and agent (hero, champion), counted
src/shared/riot-review.js             a review from Riot's record alone, or a recording linked late
src/main/services/backfill.js         Connect grades the last ten matches from Riot's record
src/renderer/review/                  one page for every game, branched on review.kind
src/renderer/matches/                 the library, "Your patterns" and the breakdown pages
src/renderer/home/                    the last match, its focus and the top repeated mistake
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
it.

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
buying, in the engine and in the AI log's death list.

**The mode comes from printed numbers in round 5's buy phase.** Swiftplay swaps
sides after round 4, so its round 5 is a pistol round: 800 credits and a 45
second buy timer. A standard round 5 has four rounds of money and 30 seconds.
Measured: swiftplay round 5 bought at 0:43 with 800, competitive at 0:29 with
3,550. The side swap used to be the swiftplay tell, and it is the model's
inference: on a real competitive match it read the side flipped twice in two
seconds, locked swiftplay, and the wrong lock went back to the model as context,
so rounds 5 to 9 all read as defence. It is now a fallback (buy phase reads
only, four in a row), and a buy phase with a team on 5 proves standard.

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
closes the last one into the library, never opened over the new one.
`npm run test:sessionreplay` replays that session and two others through the
real engine, deaths checked against Riot's record.

**What the review may claim.** No "survived" line unless Riot says so, no death
timing to the second without Riot, no result unless a score end or Riot's record
says so, a spawn is never a death spot, and every insight and pattern must clear
its stated floor. The review is SAVED the moment the match ends, before the
narrative call (`match-ended`), because a quit or a Stop then Start in that
minute lost it or pointed its death frames at the next session's empty log. The
review page opens at once and repaints when Riot publishes the scoreboard, 90 seconds
to four minutes later, and every version is saved to the same review id, except
the corrected numbers shown while the summary is rewritten. It never opens over
a match in progress: one already under way, or the one recording was stopped in
the middle of, which is saved to Matches with a notice. Each review keeps its
own Riot retries, and stopping recording does not cancel them: each try is
verified against that match's own window, so a late answer can only be that
match. The link checks the newest match and the four before it, and refuses a
deathmatch, a match with fewer rounds than the coach watched, and a match
already linked to another review.

**Variant C won the review bench** (`npm run bench:review`, live, spends money)
by making fewer unsupported claims than B; the numbers are in `match-review.js`.
The model's reply is RAW text from `textInfer(..., { json: true })`, sanitized
per field after parsing, because `sanitize()` collapses newlines and the first
bench got every labelled line back as one. Spelled round numbers are turned into
digits in code (`roundDigits`), because the prompt asking was ignored about half
the time. The review is written in the player's language (`languageRule`); the
labels stay English because `parse()` reads them.

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
are dropped. The corrected review repaints at once with the summary marked as
updating, the coach looks at the teachable deaths, then the model writes the
summary again from all of it, including Riot's scoreboard line, because a 31/21
match MVP reviewed from its deaths alone reads as a struggling player.

**The kill feed gives teamwork** (`teamworkOf`): whether a death was traded (a
teammate killed the killer within five seconds, generous on purpose), trades the
player made, how many were standing on each side at the death, and clutches.
The feed that leaves the server carries sides and times and never a name. On
the real Abyss match: traded once in 21 deaths, and six rounds lost after the
player died with the team ahead in numbers.

Three things the model got wrong on the verified prompt, each fixed in code
rather than asked for: it explained rounds 2 to 11 of 24 (`teachable()` picks
the rounds, one per third first), it named the wrong killer (`namesKiller()`
drops that line), and it merged two patterns into one wrong count (a summary
sentence carrying "N of M" is dropped). The `sides` pattern names the stronger
side in words, because given two fractions the model inverted them.

**Riot counts rounds from 0**, and `time_in_round_in_ms` runs from the barriers
dropping. The Riot ID in config is the one looked up, so a match played on
another account never links, which is correct.

### The coach's look at a death

For the four most teachable verified deaths (`teachableDeaths`: a lost round, a
first death, an untraded one, a death with the team ahead; spread across the
match), the client sends the last frame before Riot's death second and the one
just after, and `/api/coach/death-forensics` returns ONE cause from a closed
list (`CAUSES`, mirrored in `src/shared/death-causes.js`; `test:forensics` keeps
the two in step), what happened, and the better play.

- **A cause is a label so it can be counted.** "Your most repeated mistake" is
  a count, and a sentence cannot be counted across matches.
- **A lost duel is on the list and is not a mistake**, so the model has an
  honest place for a fair fight instead of inventing a positioning error.
- **Unclear carries no sentences.** On the bench every unclear answer came with
  a sentence about the frame itself.
- Every sentence passes the map gate (a callout from another map), the ability
  gate (another agent's ability, unless its owner is named) and the killer gate.
- The frame picker wants a full two seconds of margin before the death, because
  the clock is read to the second and a same-second frame showed the combat
  report instead of the fight.
- **The fixture frames carry the old tip cards over the game**, and the first
  bench had models reading the card back. The prompt says to ignore overlays.
  The model was chosen by `npm run bench:forensics`: GPT 6 Luna said "unclear"
  when the frame did not show the fight, where the others invented a peek.

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
  only once the player confirmed it, the engine's rule, so the ability gate
  never passes a spectated teammate's kit as the player's.
- **It reaches the lists, never the grade.** A cause from the screen is counted
  like any other (`cause:` keys, judged), but Decisions skips it (`grade.js`):
  its frames were chosen by the screen's own timing, and with it a review Riot
  never checked spoke in Survival and Decisions, half the weight: four avoidable
  labels graded the real 31 kill Jett at 58 from the screen alone
  (`test:valorantreview`).
- **Where you died, and how** is the last section of every review
  (`review.js paintLooks`): per look, the round and side, the frames across the
  card (Just before and Just after, click to zoom), the round's facts, the cause
  chip, what happened, the better play, and for a screen look "When this
  happened is the coach's own read of the screen, not Riot's record of the
  match." Unclear keeps its frame and no sentence. A round card keeps the chip
  and "See where you died", a link down. Each look keeps `source` and `at`, when
  its first frame was captured, and the eye on its moment sends
  `REVIEW_AILOG(id, at)`: main takes a time inside the match's window only, and
  the AI log opens on the frame nearest it.

The frames the review looked at are saved beside it in the library, so the
moment survives the AI log rolling past it, and a version painted after a look
still shows them (`job.frames`). The AI log keeps every frame of the last three
minutes, every frame around a registered death, one frame per ten seconds of the
rest, and holds a finished match's frames whole until its review has looked
(`holdAiLogFrames`): until released, an hour at most (`HOLD_MAX_MS`), because a
match stopped halfway retries the link for 35 minutes (`match-link.js`) and
then Riot's rounds and the look after that. `test:valorantreview` fails the day
the retries outgrow the hold. `test:forensics` holds the screen prompt and the
killer gate, `test:valorantreview` the picker on the real ledger, `test:surfaces`
the section and the eye at a moment, and `check:matches` paints a kept frame
there (`.v-moment img`) and opens the AI log at it.

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
  `'gone'` or null (`scopeFor`). Null is no eye: Riot's record alone, Rivals
  and League record nothing, and a match recorded with the AI log off has no
  log to open. Gone is a disabled eye with its reason. The kept
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
- `npm run test:ailog` holds the strict read, `locate` and `scopeFor`;
  `test:surfaces` the row, the header and the log's scoped mode;
  `check:matches` clicks row eyes through to the real window, for a review
  that kept its place and one found by its end, and finds the header's.

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
- Marvel Rivals: Impact, Survival, Role duty (healing, blocked or damage by
  role), Accuracy against the same hero. League: Farming (not for supports),
  Survival, Vision, Objectives.
- **One category is not a grade.** From the screen alone Valorant can count
  deaths and nothing else, and that graded a 13 to 11 win at 45. An overall needs
  two categories carrying half the weight; below that it says what would grade it.
- **The Duelist curves are shifted**, because the entry dies more and is traded
  less by design: on the shared curves the real 31 kill Jett read as a player who
  could not stay alive. The lesson from the retired grade-blend.js stands: a real
  scoreboard outranks a count of mistakes, which is why Impact weighs most.

`src/shared/insights.js` makes the three lists from the same facts, each entry
with a floor, a stable `key` (the library counts by it, so renaming one orphans
every saved review that used it) and, for mistakes, a one line `fix`.
`patterns.js` counts those keys across the last ten recorded reviews of a game
(one graded from Riot's record alone has a grade and no list to count, below);
**a pattern needs two matches**, and its trend compares the newer half of the
window with the older half ('rising', 'falling', 'steady').

`npm run test:grade` covers the graders on the real fixture, the lists, the
frame picker, the store, the patterns and the weekly report. `npm run
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
  own link is still running (a stop retries for over half an hour) holds back
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
  clock allowance (90 seconds) was set on them.
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
- `npm run test:riotreview`, `npm run test:backfill`, `npm run check:onboardingriot`.

### The breakdown

`src/shared/breakdown.js` cuts every saved review of a game by map and agent
(map and hero for Rivals, champion for League), cached in main until the next
save. Counted, never written, and every number carries its sample:

- Round numbers come only from Riot checked rounds (the screen files a result a
  round late often enough to fake a side win rate), death locations only from
  recorded rounds, the scoreboard only from matches that have one. K/D is total
  kills over total deaths; ACS, ADR and headshot % are weighted by rounds.
  K/D/A (Valorant and Rivals) is an average match's kills, deaths and assists,
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
  map), "Skye kept winning" only against Skye, and a Rivals comparison only in
  its direction (`insights.repeatTitle`, used by the patterns too). Otherwise
  the title is one that is true of every match it counts.

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
shell/       the window's document: the sidebar (game, pages, Start / Stop,
             status, account), the window's buttons and the Recording screen
home/        the last match and its grade, the next match's focus, the most
             repeated mistake, the grade trend, recent matches
matches/     three pages from one surface, ?section=list, patterns or breakdown;
             the list carries its wins and losses beside the title (winLoss)
review/      the post-match review, every game, branched on review.kind
stats/       rank, win rate, tracker matches, graded matches
chat/        Ask Coach, opened plainly or on one match's review
settings/    all preferences, version string at the bottom
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
asked for until the next tick.

**A stop in the middle of a match HOLDS the seal** (`sealHeld`, set from the
engine's `stoppedLive`). Not recording, nothing can tell when that match ends,
and Home would paint its review and the focus for the next match while it is
still being played. Held, the screen says recording stopped and the sidebar
stays open: any page the player opens lifts it, their own choice, as opening
Matches was before 8.1. Start clears it in every game, before the Rivals and
League branches, and the seal then follows that recording's match: cleared in
the Valorant path alone, a held seal kept every page and the League or Rivals
review behind "Recording stopped" until a Stop. A review withdrawn because its
match resumed seals first (`withdrawReview`), so its switch to Home never runs
unsealed. `npm run check:seal` boots the app with stand-in engines and holds
both.

**Closing hides the window.** Its X, Alt+F4 and the taskbar's Close put it out
of sight like Ctrl+Shift+M, with the dock mark in the corner, and Occlara keeps
running in the tray: a review still being checked against Riot's record,
minutes after the match, would lose that check to a quit. The tray and
Settings quit, and `before-quit` is what lets the window close for real, an
update's restart included. A match that resumes after its review opened
minimises the window if it is in front, as the review window used to close.

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
reload's old ready refused), and `check:mainwindow` the same on real views,
the seal, a page that never answers, a minimised window and a page loading
again included.

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
the Recording screen and the agent bubble rise in; the AI log and the weekly
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
```

The panel and the review, matches, settings, stats and chat windows were
retired in 8.1. `npm run check:mainwindow` boots the app with saved reviews and
asserts the sidebar, Home, the page bounds, the order of a switch between
pages, the seal hiding every page, the review showing when it lifts and a
recent match opening its review.
`npm run test:shellnav` and `npm run test:homemodel` cover the navigation and
Home offline.

### Rules for UI work

**There is no build step and no framework.** No React, no JSX, no bundler, no
TypeScript. Plain DOM APIs and plain CSS. Do not introduce a framework or a
build pipeline to add a component.

**Design tokens live in `src/renderer/shared/theme.css`** and are imported by
every surface. Use the variables, do not hardcode colours, radii, easings or
durations:

- Brand: `--red` `#FF4655`, `--cyan` `#FFFFFF`, `--bg` `#08090A`
  The token NAMES are historical. `--cyan` is white and, under
  `[data-game="rivals"]`, `--red` is gold. They mean "primary accent" and
  "secondary accent". Do not rename them: they are consumed 225 times across 15
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
  10px gutter, the same shape as every other surface.
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
improved. Grading from Riot's record is `BACKFILL_START` and
`BACKFILL_STATUS`, and `PUSH_BACKFILL` carries its status on every change to
onboarding, Settings and Matches. The main window is `SHELL_NAV` (go to a
page), `SHELL_WINDOW` (minimise, maximise, close) and `SHELL_GET`, and
`PUSH_SHELL` carries its navigation state, sealed or not, on every change.
Moving between pages is `PUSH_PAGE` to one page (arm, enter, leave) and
`PAGE_READY` back from it, taken from that page's own view only; every page
preload exposes the two through `src/preload/page-motion.js`.

## The live read's STATE line

The model replies `LOBBY` or `STATE: {...}` (`read-prompt.js`). The STATE is
parsed by `mapState()` in `server/routes/coach.js` and fed back as context on
the next read. **If that shape changes, the feedback loop dies silently**: reads
keep arriving, they just stop being informed by the previous one.

The models are whatever Railway says where an env var is set, and the code
default where it is not: `AI_READ_MODEL` (default deepseek/deepseek-v4.1-flash),
`AI_FORENSICS_MODEL` (default openai/gpt-6-luna), `AI_REVIEW_MODEL` (falls back
to `AI_TEXT_MODEL`). `AI_VISION_MODEL` now only serves the older `/analyze` route
that installed clients before 8.0 still call. Every model call switches
reasoning off and retries a 400 without the switch. There is a credits breaker:
on a 402 the server reports it honestly rather than pretending to be down, and
the client backs off for three minutes.

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

## Do not simplify the guards

`coaching-engine.js` contains deterministic checks that **deliberately override
the model**. Each one exists because of a specific, reproduced failure, and each
one looks like removable defensive cruft until you know the story. They no longer
guard tips; they guard the facts every review is built from. Do not refactor
these away.

- **Map lock with correction** (`applyMapRead`). The model repeatedly insisted
  the player was on Ascent while they were on Breeze. Two agreeing reads
  acquire the lock, two agreeing contradictions correct it.
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
- **HP beats death.** A death is only registered when health is genuinely
  absent and the tell is unambiguous. The model kept announcing deaths that had
  not happened.
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
while alive.

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
src/main/services/lol-recorder.js   polls 127.0.0.1:2999, emits NOTHING to the player
src/shared/lol-review.js            turns the record into a review, deterministically
src/renderer/review/                the post-game surface, opens only when a game ends
```

`finishLolGame()` in `src/main/index.js` grades, appends to `lolHistory` capped
at `BASELINE_GAMES`, and fires `PUSH_LOL_REVIEW`.

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

**The game marks are ours too.** The sidebar's game picker is three icon
buttons, and the icons are never the games' logos: Riot's IP policy says a
project "may not use any of our logos or trademarks" without a written licence,
and Marvel's marks are as protected. `src/renderer/shared/game-marks.js` draws
three stroke icons on the shell's 24 unit grid (stroke 1.75, round ends,
`currentColor`): Valorant a reticle, Marvel Rivals a hexagon with a four point
spark, League a square map with two edge lanes, its diagonal and two corner
bases. No V, no crest, no letter, nothing shaped like a real mark. Each button
carries the game's full name as its title and accessible name, because a symbol
alone is a guess; `test:surfaces` holds both.

## Marvel Rivals reads TEXT, never art

The whole Rivals design turns on one measured fact, and it is easy to undo by
accident because the failing approach looks more capable.

**Naming heroes from scoreboard portraits does not work.** Graded against a real
Season 10 frame with a hand written answer key, six runs scored 17 to 42%
precision against a 90% gate, and answered Mephisto, Doctor Doom and Lightning
Ace, two of whom are not in the game and one of whom is not a Marvel character.
Six prompt revisions moved nothing. A 3x upscaled crop of the portrait column
scored WORSE than the full frame, so it is not a pixel count problem.

**Reading the hero name that hero select PRINTS works perfectly.** Same model,
same day, exact both times. This is text recognition versus art recognition, and
it is the same distinction the Valorant map fingerprint already turns on, where
the printed location label outranks the model's opinion about the picture.

So:

```
hero select    the hero name is printed, so the coach learns YOUR hero here
scoreboard     printed text only: result, map, mode, K/D/A, damage, healing,
               accuracy, role icons. Never hero identity
```

`features.heroCapture` is **separate from `features.draft`** on purpose. Draft
advice is off because the teammate ROLE COUNT reads wrong; the engine still asks
the draft question for the name, and `vet()` returns empty so no draft sentence
reaches a player. Do not merge those flags.

`confirmMine()` in `server/routes/rivals.js` checks the printed name against the
closed roster, so an OCR slip arrives absent rather than wrong. The engine holds
the hero for the match and **forgets it once a scoreboard is reviewed**, or the
next match opens its review naming the last match's hero.

What the hero read bought is `src/shared/rivals-abilities.js`: no sentence may
name an ability the player's hero does not have. The Rivals engine still writes
draft and scoreboard lines internally, and none of them reach the screen during
a match; only its system notices reach the sidebar. It permits one whose OWNER is named in the same sentence,
because "The Thing has Yancy Street Charge, which turns your dash off" is the
counter table's best output.

What it did **not** buy is the switch call. `switchAdvice()` needs the ENEMY
list, which comes off portraits, which is the read that failed. Counters stay
unwired. `rivals-meta.js` and `rivals-moments.js` are also unwired and their
headers say exactly what is missing; read those before calling either.

### The Rivals review is computed, like the League one

`src/shared/rivals-review.js`, and the reason is `lol-review.js`'s reason word
for word: a review is where a confident wrong sentence costs most. The model is
not involved. It makes exactly one judgement, the healing check, because that
data is not close: across twelve real rows Strategists healed 13,068 to 33,213
and everybody else 0 to 567. **Damage blocked gets no such rule**, because those
rows overlap, and any threshold drawn through an overlap is a coin flip wearing
a number.

**It compares you against yourself, and the scoping is the whole design.**
`rivalsHistory` keeps the last 10 matches and a baseline needs 3, matching the
League numbers. A global average would be arithmetic that means nothing, so:

- **role scoped** for kills, deaths, assists, damage, blocked and healing. A
  Strategist's kills and a Duelist's kills are different quantities, and a
  Vanguard dies more than a Strategist by design. Comparing across roles
  manufactures a trend out of the player switching role.
- **hero scoped** for accuracy alone, because a projectile hero is naturally
  lower than a hitscan one at identical skill. `fundamentals()` already says "if
  you cannot tell which the hero is, do not coach the accuracy", and comparing
  Hela's accuracy to Jeff's is that mistake with extra steps.

`lowerIsBetter` on deaths is not cosmetic: without it the review congratulates a
player for dying more than usual. A column that is zero and always has been is
dropped, but a zero against a real average is the most informative row there is
and must survive that filter.

The history entry is built from the REVIEW, not the raw frame, so a hero the
review refused to believe never enters the baseline as that hero either.

Two things that look like details:

- **Heroes switch mid match.** A hero read at draft is the hero they STARTED on.
  The contradiction is detectable in one direction only: a non-Strategist name
  against a healing column that proves a Strategist means they switched, and the
  name is dropped.
- **The refusals are rendered, not just observed.** A player who can see the
  enemy team on their own screen will otherwise assume the coach saw it too and
  chose to stay quiet.

**There is no mode table and that is deliberate.** marvelrivals.com publishes no
modes page, `/gamemodes/` and `/gameinfo/` both 404, so a list would be written
from memory and presented as fact. The mode is printed text, the read that
works, and the review only displays it. Only its SHAPE is checked: a mode is a
short label, so the objective line is dropped while a mode nobody here has heard
of comes through.

### The meta comes from the game's own balance post

`npm run sync:rivalsbalance` fetches `marvelrivals.com/balancepost/`, which is
linked from `/news/`. First party, no key. It is a better source than a tier
list because it is dated and quotable: "Reduce Nastrond Crow Form damage from 70
to 60, published 2026/09/08" is a fact the player can check, where "Hela is S
tier" is a contested opinion that is stale in a month.

**The coach quotes it and never judges it.** It does not say buffed or nerfed,
because deciding which needs inference and the inference is unsafe: "reduce
cooldown" is a buff, "reduce damage" is a nerf, and the verb is identical.
NetEase writes a one line characterisation per hero, so there is a sourced
sentence and nothing to infer.

Two shapes that bite, both recorded in docs/AI-CONTEXT.md: the GLOBAL CHANGES
section carries **no bullet dashes**, and **Deadpool has three sections** because
he is tri-role, so a one-to-one map silently drops two of them.

`balanceBlock()` and `metaBlock()` are added to the prompt **separately**, because
one is fetched and one is hand written and they go stale on different days.
Nesting the sourced one inside the hand written one meant it vanished exactly
when it became the only meta knowledge left.

```
npm run sync:rivals          roster, health and abilities from the game's own site
npm run sync:rivalsbalance   the official balance post: version, date, what changed
npm run check:rivalsknowledge every hero and ability named is one the game has
npm run check:rivalsreview    boots the app, paints a Rivals review, then a League
                              one into the same review page
npm run check:clientboot      src/ never requires from server/, which is not shipped
```

That last one exists because `package.json` ships `src/`, `assets/`,
`node_modules/` and `package.json`, and **not `server/`**. A require reaching
across resolves in the repo, passes every test, and throws MODULE_NOT_FOUND on a
real install. It is the mirror of `check:server`, and `sync:rivals` writes a
second smaller copy into `src/shared` so the shortcut is never needed.

## One game's data is never shown under another game's name

The stats dashboard is Valorant shaped end to end: a Valorant rank ladder, agent
tiles, and a competitive/unrated split only Valorant has. It had no concept of
which game it was for, so selecting League returned all of it unchanged.

`getStatsDashboard` now reads `hasFeature(game, 'stats')` and a game without a
stats source returns empty with `statsSupported: false`, which the renderer
paints as a panel naming the game. Rivals has no official API at all, and League
needs a Riot production key the app does not have. Both say `stats: false` in
`src/shared/games.js` **explicitly**, rather than relying on `hasFeature`
returning false by absence.

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

## The Pro Playbook, and how to grow it

`server/services/knowledge.js` holds the playbook: tagged notes scored against
a situation by `retrieve()`, which returns **only eight**. The review draws on
it twice: `study()` picks the imported notes worth reading before the next
match, by the topic a pattern points to, and the round lines are written with
the retrieved notes in the prompt.

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

**Weapon numbers are computed.** `sync:valorant` pulls the damage table (19
weapons, 13 with falloff), and any note declaring `source.numbers` has every
number in it verified against that weapon's real ranges. A Riot rebalance fails
the build rather than leaving the coach confidently wrong. Notes that give
tactical distances, "play inside 5 meters", are NOT checked, because that is
advice and not a claim about the table.

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
untouched. With the toggle on the mix `retrieve()` serves goes from 34% to 75%
advanced, measured across 12 real logged contexts plus 5 synthetic.

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

## A refund must take the licence away

The Stripe webhook handled four events and none of them was a refund. That left
a hole with no floor under it: a LIFETIME purchase writes `expires_at: null` and
`status: 'active'`, has no subscription to cancel, and `validateKey` asks only
for an active status and an unexpired date. **Buy lifetime, refund it, keep the
product forever.** Nothing fired, nothing logged, nothing expired.

`charge.refunded` and `charge.dispute.created` now revoke, writing both the
status and `expires_at: now`. Two independent reasons for the same answer, so
the licence dies even if `validateKey` is ever relaxed about status.

**A PARTIAL refund must not revoke.** `charge.refunded` fires for both, and a
goodwill partial refund is not a reason to take the product away. The amounts
are compared as well as the flag.

**The customer is a FALLBACK and only when unambiguous.** Licences store
`stripe_session_id` and `stripe_customer_id`, never the payment intent, so the
charge is resolved through the checkout session that created it. When that
fails, the customer is used only if they have exactly ONE active licence: a
repeat buyer has several, and revoking all of them over one refund is a worse
bug than the one this fixes. It logs loudly and refuses rather than guessing.

**THE STRIPE DASHBOARD MUST SUBSCRIBE TO BOTH EVENTS.** The handler cannot run
on an event Stripe never sends, and the endpoint was created listing four. This
is the one part of the fix that is not in this repo.

`npm run test:refundrevoke` runs the real handler against a fake Stripe and a
fake Supabase, covering the full refund, the partial, the chargeback, the
fallback and its safety rail. Proved by disabling the handler and by making
partial refunds revoke.

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

`src/shared/valorant-data.generated.json` is generated by
`npm run sync:valorant` from valorant-api.com. Do not hand-edit it.

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
