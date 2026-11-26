# The match rating

A football style player rating (FotMob, SofaScore) for a Valorant match: a
number from 0.0 to 10.0 that starts at 6.0 and moves by tenths with what the
player does. Build 1 (this file) is the engine and the post-match surface.
Build 2 feeds the same engine live from the screen for the Recording screen
and an OBS browser source, behind a switch that is off by default ("Live",
below, the owner's second exception to the silence rule); build 3 will draw
it onto a video and is not written. Nothing of build 1 shows mid match.

Files: `src/shared/rating.js` (the engine, pure), `src/shared/valorant-review.js`
(`ratingField` in `build`, `withRating` in `served`, the planter, defuse and
assisters on the card in `recordOnCard`), `src/shared/valorant-verify.js`
(`killFeedOf` and `recordExtras` keep them, `endKept`),
`server/services/riot-rounds.js` (`endOf`, `endsOf`: sends them),
`src/renderer/review/rating-view.js` and `rating.css` (the block and the
replay), `scripts/rating-fit.js` (the table), `scripts/rating-calibrate.js`
(the weights), `scripts/test-rating.js`, `scripts/test-rating-wiring.js`,
`scripts/check-rating-window.js`, and the sample in
`scripts/fixtures/proof-reviews.js` (`withAgents`).

## The model

**Every move is the change in a team's chance to win the round that the
action caused.** The chance comes from the players standing on each side,
whether the spike is down and, once the attackers are wiped after the plant,
the spike's clock (`winChance`, below). A kill moves it from the state before
to the state after; the killer is credited that change, the victim debited
it. So a first kill at 5v5 is about a quarter of a round (0.26 for an
attacker, 0.21 for a defender), the last kill of a 5v1 two hundredths (0.02),
a kill after the spike went off or after the round is decided nothing,
whatever side is known, and a clutch or a multi kill is worth what the kills
inside it moved, with no bonus written for either: a 1v4 clutch won carries
0.94 of a round, an ace from 5v5 0.61 (`test:rating`). Calibration showed no
shape the maths undervalued, so no explicit term was added.

- **Deaths** are debited the swing they caused, times `LOSS_WEIGHT` 0.8 (a
  duel lost is partly the killer's doing; football ratings average above
  their start for the same reason), and **never less than `DEATH_FLOOR`
  0.12** before the round is over (below, "The bottom of the scale").
- **A traded death** (a teammate kills the killer within `TRADE_MS`, 5 s,
  the record's own rule) gives back `TRADE_BACK`, 0.7 of what it cost above
  the floor, at the trade: a traded death still costs the life. **The trader
  keeps the whole swing of the trade kill**, a good play whatever the death
  it answered cost; the give back is added on its own, so the lobby's total
  grows by it and the calibration holds the mean (round 2 took it out of the
  trader, which could leave a trade kill worth nothing). Of two deaths to the
  same killer the latest is the one traded. Both ends must be named: a killer
  with no agent is the bare `them`, never matched to a later kill (round 1
  did, read every death as traded and rated the Abyss 8.3 where its own maths
  gave 8.0). Where the feed cannot show the trade (a killer with no key, or
  no times), Riot's own `traded` flag on the player's death gives the same
  share back. A death's label says "traded" or "not traded" once the round
  ends. An entry who dies first every round and is always traded within a
  second, with no kills, rates 3.6 (3.2 untraded).
- **Revives** (`riot-rounds.js teamworkOf`'s rule): a **gun** kill (`isGun`,
  the game data's weapons and the knife) by a player down 2 s or more, or a
  second death of one, puts them back up first, and the change in the chance
  at that moment is credited to whoever made it (`reviverOf`): Clove is her
  own (Not Dead Yet), anyone else a Sage of that side who is up, **the player
  when the player is that Sage**, and with no Sage up the revived player. A
  revive clears the player's death from the round's name. An ability's kill
  by a player already dead (a molly 3 s after its owner died) is no revive.
  **Clove's ultimate running out** with no kill (a self kill by an ability of
  a player down) moves nothing: the round costs what the first death cost.
- **The spike going off** is found by the first event after its time, or by
  the round's end, which the record now times at the spike's time when the
  attackers won a planted round with no defuse (`eventsOfRound`). What was
  left of the chance at the last moment the engine knew of is then settled
  the way a round's end settles it (the attackers up gain it, the defenders
  up lose it), and the round is decided. So an ace that leaves 40 s and no
  defuse rates the same whether the spike then kills the player or not (6.2
  both, `test:rating`), where it rated 7.2 and 6.3.
- **Assists** take `ASSIST_SHARE` 0.15 of the kill's swing each, half at most
  in all, from the killer.
- **Plants and defuses** move the chance like a kill does. A named planter or
  defuser takes `PLANTER_SHARE` half and the rest is shared by the side's
  players alive at it, the other side's alive taking the cost; with no one
  named it is all shared.
- **The round's end.** What was left of the chance (a defuse nobody named,
  the timer, the spike going off, a save) goes to whoever was still up, by
  side ("Round won, held to the timer", "Round lost, alive at the end"). Then
  the result term, `RESULT` 0.02 to each player of the side that won and
  minus 0.02 to each of the side that lost.
- **A teamkill or a self kill** is carried by whoever did it, and named so:
  "Killed by a teammate", "Died to yourself", "Killed a teammate".
- **A round the player sat out** (`sat-out.js`) moves nothing of theirs and is
  not counted as a round played; the others' values still see it.

**A round's name** is a label only, from what the player did in it: "Ace",
"Triple kill with the opening kill", "2 kills, won a 1v3", "Opening kill and
the plant", "Trade kill", "Died first, not traded", "Saved the last life",
"Double kill, then died". It adds no points.

## The bottom of the scale (round 3)

The second review scripted ten archetypes (`scripts/fixtures/rating-archetypes.js`)
and found the bottom wrong: an AFK Riot did not flag (0/13 in a 3 to 13
loss) and a 3/20 bottom frag both rated 5.7, at or above a 12/12 player at
5.6, and an entry at 12/24 always traded rated 7.7, second in the lobby. The
cause: a death in a round already lost (1v5) moves the chance by nearly
nothing, so doing nothing and dying late cost nothing.

**The mechanism: a death costs at least `DEATH_FLOOR`, 0.12 of a round,
before the round is over**, and a trade gives back only what it cost above
the floor. A life is the gun, the shields and the information the team had,
which the next rounds pay for even when this one is gone: the chance to win
this round is not all a death costs. The floor does not touch the top of the
table (a kill is valued as before, exit kills still little, clutches and
defuses as before); it does not touch a death after the round is decided
(the spike gone off, a side wiped), which is over. The other candidate, the
lost round's share weighted by what the player did in it, charges presence
more than play and needed a definition of "did" that a live feed cannot
always give; the floor is one number on one event.

With the floor and `LOSS_WEIGHT` 0.8 (the mean held near 6.5):

| archetype | K/D | rating | place |
| --- | --- | --- | --- |
| top frag, lost 10 to 13 | 32/14 | 9.8 | 2nd |
| hard carry, 13 to 9 | 23/8 | 9.4 | 2nd |
| lurker, late kills | 18/10 | 8.7 | 5th |
| sentinel, survives, 7 defuses | 14/0 | 8.7 | 3rd |
| 1v4 clutch hero, lost | 17/14 | 7.6 | 3rd |
| 12/12 player | 12/12 | 7.4 | 3rd |
| support, 38 assists, 12 plants | 0/17 | 6.2 | 4th |
| entry, always traded | 12/24 | 5.9 | 5th |
| baiter, 18 exit kills | 18/12 | 5.6 | 6th |
| AFK, not flagged, 3 to 13 | 0/13 | 4.5 | 7th |
| bottom frag, won 13 to 7 | 3/20 | 4.1 | 9th |

The 12/12 player sits at 7.4, not the 6.0 to 6.5 the review asked for, and
that is the lobby's doing, not the scale's: in that script he makes the
decisive kill of every round his team wins, and six of the ten players in
his lobby have 0 to 6 kills (Raze has 54). He is third of ten and 1.2 above
the lobby's mean. In a **balanced lobby** (`balanced()`, every kill and
death rotating through all ten) every player sits at 5.7 to 6.8, the mean
6.28, which is what an ordinary game is. `test:rating` holds the order: an
unflagged AFK and a bottom frag at least 1.5 under the 12/12 and under 5,
the 12/24 entry not second and under the 12/12, the top kept (a carry and a
losing top frag at 9 or more, the clutch hero at 7 or more, the sentinel at
8 or more), timely kills over exit kills by 2 or more, and the balanced
lobby at 6.0 to 6.6.

## The table

`node scripts/rating-fit.js --library`: every round of Riot's record with a
kill feed, both teams, **116 rounds, 907 states with both sides standing**
(the two fixtures with a feed and the owner's five saved reviews with one).
Each candidate is fitted by maximum likelihood and scored held out by match
(each match by a fit on the other six):

| model | in sample | held out by match | opening 5v5 |
| --- | --- | --- | --- |
| the man difference and the spike | 0.4950 | **0.5057** | 39.0 |
| and an opening term | 0.4944 | 0.5066 | 43.1 |
| and the ratio of players standing | 0.4943 | 0.5081 | 39.3 |
| and the players down | 0.4936 | 0.5099 | 42.7 |
| and the players down after the plant | 0.4921 | 0.5076 | 40.9 |

    logit P = -0.45 + 1.05 (a - d) + 1.02 planted

The difference alone holds up best held out, so the ratio of round 1 is gone.
The attackers won 43.1 percent of the 116 openings and the model says 39 at
equal numbers: within one standard error (4.6 points), and a term of its own
for the opening did worse held out, so the intercept stays the one fitted on
every equal state, where the clock is the defenders'.

**Attackers wiped after the plant** win if the defenders cannot reach the
spike and defuse it (7 s) in the time it has left:
`sigmoid((12 - seconds left) / 3)`. The record has 20 such states, the
attackers winning 2, at 15.3 and 19.2 s left, and losing every one with 20 s
or more; a free fit of the two numbers separates the data and is no use, so
the curve is centred on the defuse and 5 s to reach it. With no clock to go
by, the record's own share, 0.10.

Attackers' chance in percent, spike up / spike down:

| attackers, defenders | 1 | 2 | 3 | 4 | 5 |
| --- | --- | --- | --- | --- | --- |
| 5 | 98 / 99 | 94 / 98 | 84 / 94 | 65 / 83 | 39 / 64 |
| 4 | 94 / 98 | 84 / 94 | 65 / 83 | 39 / 64 | 18 / 38 |
| 3 | 84 / 94 | 65 / 83 | 39 / 64 | 18 / 38 | 7 / 18 |
| 2 | 65 / 83 | 39 / 64 | 18 / 38 | 7 / 18 | 3 / 7 |
| 1 | 39 / 64 | 18 / 38 | 7 / 18 | 3 / 7 | 1 / 3 |

With no side known the spike cannot be placed and the man advantage alone is
used, symmetric. The sample is thin and is one player's lobbies: refit with
the script as more matches with a feed are saved (the planter and the
assisters now come with every match linked from the next server), and **bump
`VERSION` with any change to a number**.

## The display and match length

Shown = 6.0 plus a squash of the net swing: above 6, 4 tanh(x / 3.2), so 10.0
is reached only in the limit; below, 3 tanh(x / 2.6), a floor of 3.0. One
decimal.

    x = net (24 + 12) / (E + 12) min(1, E / rounds)

`rounds` counts the rounds **ended**: a round is counted at its end event, so
the shown value never moves without an event (round 25 opening moved 9.8 to
9.7 before anything happened), and a round's own move is read at one scale
(the value after it against the value before it at the same count), so a
winning overtime round never reads as a loss.

E is the queue's usual longest match: 24 rounds, 9 for Swiftplay and
Replication, 7 for Spike Rush (`lengthOf`; a first to five match of nine
rounds or fewer with no queue named is Swiftplay). Twelve rounds of neutral
play are the K, the same idea as the grade's "a short match is judged over
twelve rounds".

- **Up to E rounds every move weighs the same from round 1**, so a live value
  (build 2) never leaps because the match is young.
- **Overtime does not inflate**: past E the net is taken per round, so thirty
  rounds of the same play rate exactly what twenty four did (8.8 and 8.8,
  `test:rating`). Live, each round past E dilutes the value a little, at its
  end.
- **A Swiftplay is not wildly volatile**: its moves count 36 / 21 = 1.71
  times, which leaves its noise a little under a full match's where a per
  round average would give four times the swing per move. The same play
  rates 7.4 in six Swiftplay rounds against 8.8 over 24.
- A rating needs `MIN_ROUNDS` 3 rounds played.

## Calibration

`node scripts/rating-calibrate.js --library` (it prints agents and numbers
only and writes nothing). Seven matches with a kill feed: the two fixtures
(no agents in their feed, so the player alone) and five saved reviews with
every kill named by agent, all ten rated. 52 timelines.

- **Distribution**: mean 6.57, median 6.6, 10th percentile 4.7, 90th 8.5,
  min 4.3, max 9.3. By whole point: 4.x 10, 5.x 6, 6.x 16, 7.x 8, 8.x 11,
  9.x 1. None at 10.0.
- **Per match, all ten** (best, worst, mean): 20 rounds 8.5, 4.8, 6.67;
  6 rounds 8.7, 4.7, 6.43; 16 rounds 8.5, 4.5, 6.45; 23 rounds 9.3, 4.4,
  6.77; 7 rounds 8.5, 4.3, 6.35.
- **Correlations**: with kills less deaths over all 52 timelines 0.89 (0.91
  per round); the player's own seven matches with ACS 0.88; with Occlara's
  grade over the five graded 0.82. Clearly related, not a copy: the rating
  ranks by when a kill came and what it changed. The other nine's ACS never
  reaches the client, so the ACS figure is the player's own seven matches.
- **Real matches**: the Abyss 31 kill, 21 death Jett rates 8.3; the Split 17
  / 16 Jett 6.7; the player's five saved reviews 6.6, 7.3, 7.0, 6.8 and 8.5
  (ACS 279, 241, 285, 265, 447; grades 71, 73, 61, 65, 84), placed 5th, 3rd,
  5th, 4th and 1st of 10.
- **How the weights were set** (round 3): `DEATH_FLOOR` 0.12 puts the
  unflagged AFK at 4.5 and the bottom frag at 4.1 (0.15 moved them 0.2 more
  and pulled the balanced lobby to 6.15); `LOSS_WEIGHT` 0.8 puts the
  library's mean at 6.57 and the balanced lobby at 6.28 (0.85 gave 6.44 and
  6.15, 0.75 gave 6.71); `TRADE_BACK` 0.7 of what a death cost above the
  floor keeps a traded entry clearly above an untraded one; the squash's 3.2
  and 2.6 put the best near 8.5 to 9 and the worst near 4.5. The table did
  not change: `rating-fit.js` fits the chance from the record, which no
  weight touches.

## What a missing field costs

Measured on the seven matches by taking the field out of every round (mean
change of the player's final, largest change):

| missing | what happens | cost |
| --- | --- | --- |
| the round's side | no defenders' edge, no spike in the chance; a plant whose planter's side is known still says the side (and is believed over a side given before) | -0.10, at most 0.3 |
| kill times (`ms`) | each kill takes the time of the one before it in the feed, so the order is the feed's; no named trade is seen (Riot's flag still counts); no spike clock | -0.07, at most 0.2 |
| the plant's time | the plant moves nothing and post plant kills are valued as before it | -0.07, at most 0.2 |
| the round's result | no result term and no end remainder | -0.07, at most 0.2 |
| agents on the feed (`ka`, `va`) | only the player is rated, so no place and no lobby; trades come from Riot's flag alone; plants and the end remainder are shared only by known players | +0.01, at most 0.1 |
| the victim's side | the kill is worth `NEUTRAL_SWING` 0.17, the mean swing of a kill or death in calibration | per kill |
| the killer's side | the victim is debited, nobody credited | per kill |
| the numbers standing | worked out from the feed; the screen's own count can be given (`alive`) and wins | none with a whole feed |
| assisters, planter, defuser | every kill the killer's; a plant shared by the side's alive; a defuse the round end's remainder | matches linked before the Nov 2026 server |

## The event shape (what build 2 must feed)

A player is a key: `'me'`, a side and an agent (`'us:Sova'`, `'them:Jett'`),
or a side alone (`'us'`, `'them'`) when the agent is not known, counted in the
numbers standing and credited nothing. Never a name.

    createRating({ subject: 'me', players: [keys], queue, longest, meAgent })
    r.push(event) -> { round, ms, kind, delta, value, swing, label, ignored? }
    r.snapshot()  -> { version, value, net, rounds, players: [{ key, side, agent, value, net }], timeline, byRound }
    r.value()

    { kind: 'round',  id?, round, side: 'attacking' | 'defending' | null, satOut }
    { kind: 'kill',   id?, round, ms, killer: key, victim: key, assists: [key], weapon, alive: { us, them }, traded? }
    { kind: 'plant',  id?, round, ms, by: key or side }
    { kind: 'defuse', id?, round, ms, by: key or side }
    { kind: 'end',    id?, round, won: true | false | null }   (the subject's side)

- **A live feed is untidy, so**: an event whose `id` was seen is ignored
  (`ignored: 'repeated'`); an event for a round older than the one being
  played is ignored (`'stale'`), so a late `end` never opens a phantom round;
  a `round` event for the round being played only fills its side if it had
  none (`'same round'`), never resetting the numbers; a round no `round`
  event opened is opened by its first event. Give every kill an id built
  from what identifies it (round, ms, killer, victim).
- `side` is the side of `us`. The subject may be on either team: `won` is
  always the subject's own side.
- `players` lists the lobby when it is known (agent select), so a player is
  counted alive and gets the result term before their first kill.
- `alive` before a kill, when the screen reads it, overrides the count the
  engine keeps. `weapon` tells a revive (a gun) from a molly. `traded` is
  Riot's own flag, for a death whose killer has no key.
- `delta` is the change in the shown value, `swing` the subject's credit in
  chance to win, `label` a plain line ("First kill, 5v5", "Died first, not
  traded", "Kill as the last one up, 1v3", "Revived Sova, 3v4"), null when
  the event was nothing of the subject's. Live, a death's label gains ",
  traded" or ", not traded" only at the round's end, on the timeline entry.

`fromRecord` and `eventsOfRound` turn Riot's record (a card's `riot.feed` with
`as`, `plantSec`, `plantBy`, `defuseSec`, `defuseBy`, `traded`, `sideKey`,
`result`, the AFK flags) into these events.

## Riot's record: what the rating needed added

`riot-rounds.js parse` (Nov 2026) adds, only where the record names them and
by side and agent only (`endOf`: `{ by: 'me' | 'mate' | 'enemy', a }`, never a
name, tag or puuid): `as` on each kill with assisters (v4 `assistants` as
players, v2 `assistant_puuid` and `assistant_team`), and on each round
`plantBy` (v4 `plant.player`, v2 `plant_events.planted_by`), `defuseMs` and
`defuseBy` (v4 `defuse`, v2 `defuse_events`). A record without them adds no
key, so an older client reads the same round. Round 3 hardened the parse:
`lower` and `idOf` take strings only (an object with a `toString` that is not
a function in a name or team field threw, and the route then asked for that
match again forever), an agent is passed on only when the game data knows it
(`endOf`), and a defuse time outside 0 to 300 s is dropped. The client keeps each end only
as a side and an agent the game data knows (`valorant-verify.js endKept`),
and the card carries `plantBy`, `defuseSec` and `defuseBy` (`recordOnCard`).
`test:riotrecord` holds both shapes, the forged ends dropped and no name.

## What is saved

On the review, `rating` (`valorant-review.js build`, `ratingField`, from the
cards), only where the cards carry Riot's kill feed:

    { version, value, rounds,
      byRound: [{ n, won, value, delta, swing, label }],
      timeline: [{ round, ms, kind, delta, value, swing, label }],
      place: { n, of } | null,
      lobby: [{ side, agent, value, me }] | null }

The lobby and the place only when every kill names both ends by agent. Sides,
agents and numbers. `VERSION` is 1 (no build has shipped it); a saved rating
is served as saved whatever its version, never counted again.

**Every path that lays Riot's record over a review builds through `build`**:
the match end (`index.js buildValorantReview`), an import that matched, the
late link and the backfill (`riot-review.js upgradeWatched` and `fromRiot`).
A review from the screen alone saves none. League has none.

**Old reviews**: `served` (`withRating`) counts one on open from the saved
cards when they carry the feed (linked since 8.5.0), never writing it back
and never touching the grade (`test:ratingwiring` stubs the rating out and
holds the grade and the lists byte for byte). A review linked before the feed
was kept says "Saved before Occlara kept Riot's kill feed for every round, so
there is nothing to rate it from." and a screen only one "Rated only once
Riot's record of the match is linked: the rating is counted from Riot's kill
feed, round by round."

**The saved rating never leaves for a window**: `served` drops `rating` from
every review it serves, any game, and sends `ratingView` alone; a locked
review gets neither. **A damaged saved rating never fails a review**
(`cleanSaved`, and `withRating` catches anything else): the value is clamped
to 0 to 10 (a saved 99 shows 10.0) or, not a number, there is no saved
rating; a lobby with a damaged row is dropped whole, with the place; a
semicolon saved before is shown as a comma. Labels are saved clean: a revive
and a kill in one line are joined by a comma.

## On the review page

`ratingView` (`rating.js viewOf`, a view field, never on disk): the value and
its tier, a point a round with its move, name, result and the running score,
the half, the three biggest round gains and losses (sorted by the move the
page shows, the swing breaking a tie), their rounds as marks, the place as
"3rd of 10", the lobby by side, agent, value and tier, and every event for
the replay.

The block, "Match rating", sits before "Round by round": the number at 64px
in its tier's colour (under 6 `--bad`, 6 to 6.9 `--warn`, 7 to 7.9 `--good`,
8 to 8.9 `--tier-4`, 9 and up `--tier-5`, the number always the text) "out
of 10", the place "2nd of 10 in the lobby", Replay the rating, then the line:
a soft area under it, 6.0 dashed, the half dashed and labelled, a tick a
round (won brighter), the swings' dots (a gain's `--good` above the line, a
loss's `--bad` below). Pointing at a round, or focusing the line and using
the arrow keys, shows its point, a cursor and one line under the chart:
"Round 14, 7 : 7, +0.4, Triple kill with the opening kill". Then the three
biggest round gains and losses side by side (a row opens its round's row
through `goRound`, its clip with it), and "The lobby, by agent" closed. No
card, tokens only.

**The replay**, a broadcast graphic over the page in the Verdict's panel: the
round ("Round 7 of 24") and the score in a pill ticking at each round's end;
the rating in a badge in its tier's colour with the dark ink on it, counting
through CSS (`@property --rt`, the value in tenths, drawn by `counter()` over
the real number, which stays the text); the move beside it rising in green
or falling in red; a running feed of the last four events, the newest on
top; the event's line; the line drawing point by point with its newest point
ringed in the tier's colour; and "Full time" with the final badge, the
place, the final score and the feed turned into the match's story (its two
biggest round gains and its biggest loss). A round's events share 2.6 s (0.6 to 1.2 s each), a round with nothing
of the player's 0.36 s, so a 24 round match plays in about a minute. Skip,
Esc, a click on the ground or any key but a modifier goes to full time; again
closes it; Esc never closes the page under it. Tab stays inside the dialog.
Only full time is announced (a live region of its own). Under reduced motion
it opens at full time. A page hidden stops it. A window under 720 wide puts
the feed under the badge; one under 720 high tightens the stage.

**Matches and Home were left alone**: neither has an obvious slot for one
more number beside the grade and the RR chip.

## Nothing mid match

The rating rides the review, served through the review's own channels,
which are sealed mid match; it adds no channel (`test:ratingwiring`). The
replay stops when its page is hidden. The one way a rating reaches the
screen mid match is the live rating below, off by default.

## Live (build 2, the owner's second exception, 2026-11-26)

The owner asked for the rating moving in real time, like a football
player's live rating, for players and for streams, and chose, told that it
widens the silence rule: **the Recording screen plus a stream widget, opt
in**. The rule and its limits are screen-silence.md, "The live rating, the
second exception". This section is how it is fed and how well.

Files: `src/shared/killfeed.js` (the detector, pure), `src/shared/live-rating.js`
(the feed, pure), `src/main/services/live-rating-service.js` (main's gates),
`src/main/services/rating-stream.js` (the widget's loopback server),
`src/main/services/rating-widget-page.js` and `src/renderer/rating-widget/`
(the widget's page), `src/renderer/shared/rating-badge.js` and `.css` (the
badge, shared with the review's replay), index.js (`feedLiveRating`,
`syncLiveRating`, `liveView`'s `rating`, `logLiveFinal`), and
`scripts/live-rating-measure.js` (`npm run measure:liverating`).

### Where live events come from

The read's STATE has no field saying whose a kill is, and the read prompt,
the model and the guards were not to change (a prompt change needs
`verify:ai`, which spends money). So the sources were measured first:

- **The reads alone.** `mates` and `foes` are no use: on the owner's
  Swiftplay of 23 Nov they read 5 against 5 through a round of three kills
  by the player. `killFeed` is free text ("SPIKE KILLED", "Reyna killed by
  Iso"): 388 of 1,501 reads carry one and not one of the player's 31 kills
  can be told from it ("player got" or "you killed"). Deaths: the reader's
  own registrations, one a round, find 26 of 31 (83.9%) with 26 of 32 right
  (81.3%): its weak tells register deaths that never happened and the trial
  takes back only some.
- **The kill feed's own highlight, read locally** (`killfeed.js`). Valorant
  marks the rows the player is in with a pale yellow chevron and an edge on
  the player's portrait: at the killer's end for the player's kill, at the
  victim's end for the player's death. The rows hang from the right edge
  under the score bar, 0.0362 of the screen's height apart from 0.104; an
  ally's block is teal and an enemy's red. The detector reads the six rows'
  middle lines of the frame the reader already captured, classes each pixel
  teal, red or yellow, finds each row's killer and victim blocks, and calls
  a row the player's only where the yellow covers most of the row's lines
  within a portrait of the block's outer end (an agent portrait yellow in
  patches is not an edge). A yellow wall in the corner makes it abstain. It
  reads no name. It costs 0.15 ms a frame (p50, 0.5 ms p99) once the corner
  is cut; main's nativeImage decode of the frame comes on top, not measured
  here (no Electron on the owner's PC).
- **The trap: the highlight follows the player being watched.** Dead and
  spectating, Valorant marks the spectated teammate's rows the same way.
  So the yellow is the player's only while the guarded context does not
  hold the player dead and no death of theirs was counted this round.
- **The combination is what ships**: every row counted once as a kill by
  side (teal killer `us`, red `them`, so the numbers standing are the
  feed's), the player's own kill only where the yellow was seen on **two**
  frames, the player's death from the row, plants from the guarded spike and
  its side lock, round results from the guarded scoreboard. The engine's own
  death registration is not used (`engineDeaths`): measured, adding it found
  no death the rows missed and added three that never happened (28 of 32
  right).

Rows are counted once by their place: the feed only moves up (the oldest
leaves from the top, a new row comes in under), so a frame's rows are laid
on the last frame's at the smallest move up that fits, and a row under the
last frame's lowest is new (`overlap`). A signature alone (the victim's
block length and portrait colour) wobbles as a row slides and counted some
kills twice; and a row first seen more than a row's life ago (6 s, measured)
has left. A plain row waits for its yellow up to four sightings or 4 s, and
is counted at once when it leaves the feed. The round closes 2.5 s after the
score moves (its last kill is often first seen on the banner) and the next
opens when the reader's ledger moves on and its barriers drop.

### Measured (`npm run measure:liverating`)

On the owner's sessions with their frames kept beside Riot's record: the
Split bench session (720p, a read every 2 s, thinned), three saved reviews
whose AI log kept its frames (two at 720p, one at 480p) and the Abyss bench
(a read every 10 s: one frame in a row's life at most, so it is printed and
kept out of the totals). Riot's rounds laid on the frames' clock by
read-score.js's barrier drops; a kill matched from 1.5 s before Riot's moment
to 8 s after, a death from 6 s before to 10 s after.

| session | frames | kills found, counted | deaths found, counted | live final, confirmed |
| --- | --- | --- | --- | --- |
| Split, 19 rounds | 720p | 4 of 14, 4 | 15 of 16, 15 | 4.7, 6.0 |
| review q3bntd, 6 rounds | 720p | 3 of 4, 3 | 4 of 5, 4 | 4.8, 7.2 |
| review loi6yi, 5 rounds | 720p | 0 of 2, 0 | 4 of 5, 4 | 5.4, 5.6 |
| review x9fzkd, 7 rounds | 480p | 5 of 11, 5 | 5 of 5, 6 | 6.1, 8.5 |

- **The player's kills: recall 12 of 31 (38.7%), precision 12 of 12
  (100%)**, lag from Riot's moment to the frame that counted it p50 3.6 s,
  p90 5.1 s. With the yellow on one frame enough (`mineSeen: 1`): recall 22
  of 31 (71.0%), precision 22 of 29 (75.9%), lag p50 2.1 s.
- **The player's deaths: recall 28 of 31 (90.3%), precision 28 of 29
  (96.6%)**, lag p50 1.2 s, p90 3.7 s. The three missed have no kept frame
  in the death row's life (the AI log thins); the one wrong is a death row
  in a 480p round Riot records no death in, the player killing again two
  seconds later (a revive, by the look of it).
- **The live final against the confirmed rating** of the same rounds: -1.3,
  -2.4, -0.2 and -2.4, mean absolute 1.58 (0.75 with one frame of yellow).
  The live number runs low: it misses kills, assists, the defuse and the
  trades a kill it did not see would have given.
- **The bar was not met** (the player's kills 85% recall and 95% precision,
  deaths 95% both). So the live number moves only on what is known for
  sure: a kill of the player's only on the yellow seen twice (no kill shown
  in these sessions was wrong), a death only on Valorant's own row, plants
  and results from the guards. It is marked "Live, provisional" everywhere,
  the review's confirmed rating replaces it, and every live final is logged
  against the confirmed one (below) so the gap can be measured in the field.

Why recall is low here and may be higher live: the kept frames are thinned
(the Split's every 2 s with gaps, a row's life is about 5 s), and the live
reader reads every second in a live round. At 480p the edge is two pixels
and blurs. Not seen yet, so not claimed: Valorant's colour blind modes
(other ally and enemy colours), a screen other than 16:9, a kill banner
skin's effect on the corner (none expected, the banner sits lower).

### What would close the gap, not done

A read prompt field, read off the same highlight the detector reads:
`"mine": {"kills": <rows in the kill feed whose killer portrait has the
yellow edge>, "death": <a row with the yellow edge on the victim>}` in the
STATE line, the counts of rows visible on this frame, null when the feed is
not on screen, nothing else (no name, no agent). mapState would keep it as
integers 0 to 5 and a boolean, the engine would hand it to the live feed
only, never to a guard. Verifying it: `npm run verify:ai` plain and at
`--lag 4` (about 480 reads, under $0.20 at the read's price), then a bench
of the new field against Riot's kills on the four bench sessions
(`bench:sessions --go`, three runs of each prompt: about $1.15 to $3.16 and
3 to 6 hours at the two prices seen), and a read that writes a few more
tokens (about 1% more a read, which is 97 to 99% of the AI bill). Whether a
model reads a two pixel edge at 720p any better than the detector is the
open question that bench answers.

### Main decides it

- **Off by default** (`liveRating`, config.js). Settings turns it on past a
  plain warning and a confirm (settings.js). Off: no frame is decoded for
  it (`liveRating.feed` with the switch off resets and returns), nothing is
  kept, PUSH_LIVE has no `rating` key, the widget's server is stopped.
- **On**: each read the live Valorant reader applies hands its own frame
  (the engine's diagnostics record, the AI log's) to `feedLiveRating`; the
  corner is cut and decoded with nativeImage (`decodeFeed`, BGRA). An import
  runs a reader of its own with no such hook; League has no reader here.
- **What leaves main** (`live-rating-service.js pick`): `{ value, shown,
  tier, last: { delta, up, down, label } | null, line }` and nothing else, on
  PUSH_LIVE's `rating` mid match, and on the widget's events with the second
  switch: `{ state: 'idle' }`, `{ state: 'live', rating }`, or for two minutes
  after the review's confirmed rating lands, `{ state: 'final', rating:
  { value, shown, tier } }` ("Full time").
- **The field log**: when a review is saved with its confirmed rating
  (`saveReview`, `logLiveFinal`), the live final of its match (kept at the
  match's end, `liveRating.end`) is written beside its AI log as
  `live-rating.json`: `{ match, live, confirmed, gap, liveRounds,
  confirmedRounds, liveKills, liveDeaths, version }`, never shown, and a
  debug log line.

### The surfaces

- **The Recording screen** (shell.js `paintRating`): one ruled row under the
  score, the number in the replay's own badge (shared/rating-badge), its last
  move rising in green or falling in red with the engine's label ("First
  kill, 5v5", "Died first, 5v5"), the small line, "Live, provisional". The
  count and the move run once on a change, nothing else moves.
- **The stream widget** (rating-widget/): a broadcast plate for a stream's
  corner, the badge, the move, the label, the line and "Live, provisional",
  or "Full time" with the confirmed number; nothing between matches.
  Standard 520 by 190 in OBS, compact (`?size=compact`) 360 by 130. Served
  self contained (the fonts as data, no request but its own events).

## Tests

- `npm run test:rating` (115), round 3 adding: the player as Sage credited
  the revive, Clove's own revive hers with a Sage up, a thrown 1v0 settled
  the same killed by the spike or not, the spike round's end timed, the
  latest of two deaths traded, Riot's flag with a named killer and no times,
  a trade kill that keeps its swing, the names (died then revived then aced,
  Clove's kill, death and ultimate, a team kill, a fall, killing a
  teammate), a kill with no time in its place, no semicolon, overtime moving
  nothing at round 25's opening, a damaged saved rating (a lobby value that
  is no number, a 99, a value that is no number, a semicolon), and the
  archetypes in order with the balanced lobby. And from round 2: the chance and the spike's clock, the swings,
  the sanity cases (an ace, a 1v4 clutch above an ace with no bonus, 24
  untraded first deaths near the floor, a traded entry at 4.4 to 5, cleanup
  kills under the start and under the mates who took the rounds, an AFK
  round moving nothing), trades (no false trade between bare keys, Riot's
  flag, the give back out of the trader), revives (Sage's credit, Clove's
  ultimate, a molly after death), a team kill and a fall, the plant and
  round end shares, a live feed's repeats, a stale end and a repeated round,
  the spike's clock with no side, a subject on the other team, the queues,
  the round names, the swings in the page's order, determinism, every
  missing field, overtime exactly flat, the saved shape, the real Abyss at
  8.0 to 8.6, and no dash in the engine, the view, the CSS, the doc or the
  scripts.
- `npm run test:ratingwiring` (29): saved by the match end, the Riot only
  review, the late link and an import, none from the screen alone; the grade
  and the lists byte for byte with the rating stubbed out; served as the view
  alone, the saved rating never sent; counted on open and written nowhere;
  the notes; none locked or for League; the sample ranks all ten by agent; no
  name, no dash, no channel.
- `npm run test:riotrecord`: the new fields from both record shapes, no
  name, a forged end dropped, none added to a record without them, a hostile
  `toString` in a name or team field parsing without a throw, a roster agent
  that is a player's name never passed on, and a defuse time out of range
  dropped.
- `npm run check:rating` (a window, run on GitHub's Windows machine only):
  the block as main served it with its tier, the line's ticks, half and a
  round read by the arrow keys, a swing opening its round, the replay playing
  as a broadcast (badge tier, feed, score, nothing announced), Shift not
  skipping it and Tab staying in it, a key to full time and its announcement,
  Esc closing only it, the screen only note, a locked review without it.
  `OCCLARA_SHOTS=1` writes `main-rating*.png` at the default size and at the
  window's least, 960 by 640.
- `check:mainwindow` holds the block before the rounds with the served value
  and place, and pictures it as `main-review-rating.png`.
- `node scripts/rating-fit.js --library` and `node scripts/rating-calibrate.js
  --library` rerun the table and the weights.
- The live rating: `npm run test:killfeed` (the detector on drawn frames,
  every size, walls, a yellow portrait, a player card, BGRA, its cost),
  `test:liverating` (the feed: a row seen many times once, the yellow twice,
  rows moving up, the spectated teammate's highlight, late rows, a missed
  round, a false match end and its resume, a new match, a death a guard took
  back, the view's fields, drawn pixels end to end), `test:liveratingwiring`
  (main's gates: off reads and keeps nothing, on sends only the rating's own
  fields, the widget's states, the field log, index.js read as text, the
  switches off by default, the token no page's), `test:ratingstream` (the
  widget's server: loopback only, the token, the Host check, nothing else
  served, no CORS, the events' shape, stopped), `check:ratingwidget` (a
  window, on GitHub's machine: the widget in Chromium, its states and sizes,
  `widget-*.png`), and `check:mainwindow` (the Recording screen with the
  switch off and on, Settings' warning, confirm and widget address,
  `main-recording-rating.png`, `main-settings-live-rating-*.png`).
  `npm run measure:liverating` reruns the measurement on this PC's sessions
  (read only, counts only).

## Open questions

1. The table is fitted on one player's lobbies; refit as more matches with a
   feed (and now assisters and planters) are saved, with a `VERSION` bump.
2. The other nine's ACS is not kept, so the rating's agreement with ACS is
   measured on the player's own matches alone.
