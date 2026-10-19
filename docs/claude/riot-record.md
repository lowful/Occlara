# Riot's record overrides the screen

Moved out of CLAUDE.md word for word, nothing reworded or dropped (CLAUDE.md as of commit cc1f880, 8.5.0, lines 435 to 626). Sections here: "Riot's record overrides the screen". It is a part of the section "Nothing reaches the screen during a match, in any game". "Above" and "below" in the text name sections that may now sit in another file under docs/claude/: grep the section's title there to find it. The table in CLAUDE.md says which file to read for which work.

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
