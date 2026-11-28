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

**Shown on the 100 scale (9.1, the owner's item 16).** Every figure a player
sees is the value times ten, rounded, as the grade is out of 100: 6.0 shows
60, 8.3 shows 83, a move of +0.6 shows +6 (`shared/display.js rating`,
`ratingDelta`, `ratingMove`). Inside, everything below keeps the rating's
own units, 3.0 to 10.0, and so does every test of the model. `viewOf`'s
`shown`, its lobby's values and every `delta` it sends (a round's, a swing's,
an event's) are already on the 100 scale, a move being the difference of the
two shown numbers so a list of them adds up; `value` stays the rating's own.
The live view (`live-rating.js view`, `live-rating-service.js` "Full time")
sends the same, its `last.up` and `last.down` following the move shown, and
the badge (`rating-badge.js`, which the stream widget inlines) writes and
counts the whole number (`--rt`, one integer counter).

Shown = 6.0 plus a squash of the net swing: above 6, 4 tanh(x / 3.2), so 10.0
is reached only in the limit; below, 3 tanh(x / 2.6), a floor of 3.0. One
decimal inside, shown times ten.

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
"Round 14, 7 : 7, +4, Triple kill with the opening kill". Then the three
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

**Since 9.1 the replay is a player** (the owner's item 16, rating-view.js):
- pause and play (the larger button, Space or K), the previous and the next
  event (the arrows, or J and L), Home to kick off, End to full time, and a
  round on its line clicked goes to that round's first event. Every step is
  drawn whole from the steps before it (`render(i)`), so a step back is as
  true as a step on: the line, the score, the number, the move, the label,
  the feed's last four, the swings' dots of the rounds ended. A step taken
  by hand is announced ("Round 7, First kill, 5v5, +3. Match rating 64."),
  the steps it plays by itself are not, full time is. "Round won" shows the
  round's score with it, not a step after. Esc and a click on the ground go
  to full time and then close, as before; any other key does nothing. At
  full time play is Watch again; the previous event steps back from it.
- THE MOMENT beside the badge (16:9): what was kept of the current event on
  this PC, by `review.js mediaOf(e, role, nth)`: the player's death, the
  round's death clip from 1.8 s before the death (the coach's look, else a
  flagged death's), else the look's frame nearest before it; the player's
  kill, the round's highlight clip at that kill (its nth of the round, on
  the clip's own timeline). An event with its clip holds 2.8 s while it
  plays, one with a frame 1.8 s. With nothing kept the match's map shows,
  dimmed, under "No clip or frame of this moment was kept". At full time the
  match's best highlight loops there. The clip plays only while the replay
  does and is let go when it closes.
- WHAT AN EVENT WAS (`roleOf`): the opening of rating.js's own words, death
  ("Died", "Killed by a teammate", "Your ultimate ran out"), kill ("First
  kill", "Kill", "Traded a teammate"), assist, plant, defuse, revive, traded,
  teamkill; `end` by its kind; anything else none. `test:reviewpage` holds
  every label on the four sample matches to a role, and each round's kills
  by role to Riot's count. A new label in rating.js with a new opening needs
  its line in `ROLES`.
- The stage is two columns (the badge, the event's words and the feed; the
  moment) to 980 wide, one under 760. It sits outside the page's scroll.

**Every round's line** in "Round by round" carries its move (9.1, item 16,
`review.js placeMove`): the engine's label of the round, grey, and the
round's move on the 100 scale, from `ratingView.rounds`, whose moves add up
to the match (60 and the moves is the number shown).

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

### Round 2: the recorder's frames, five a second (what ships)

The round 1 numbers above are the reads' frames: one a second at best, the
AI log's kept ones thinned to one in 2 s with gaps, against a row that lives
about 5 s, with the yellow wanted on two frames. Counted kill by kill on the
same frames, 26 of the 28 kills that had any frame in their row's life showed
the yellow on at least one, 0.73 of the frames: the detector saw them, the
supply was too thin to see them twice. So the supply changed:

- **The recorder's own frames.** The recorder's page already keeps the
  capture's newest VideoFrame (recorder.md). With the switch on main asks it
  (`recorder.setFeed`, the page's `feed` command): every 200 ms it clones the
  newest frame, draws **the kill feed's corner alone** (`drawImage` with the
  corner as the source rectangle, into a canvas the corner's size), reads
  that back (`getImageData` of the corner, never the whole frame), closes the
  clone, runs the detector there (`killfeed.js`, loaded by the page) and
  sends only the rows. The recording, its encoder and the read's own frame
  are untouched. Off, no timer runs. What it costs is counted in the page
  (`feedMs` on the health line) and written to the debug log once a minute
  (`[live-rating] the kill feed's corner: ... ms a second`). `check:feedcost`
  measures the same draw and read back in Chromium on GitHub's machine (no
  GPU there, so the CPU cost; a game PC's GPU readback is the field log's).
- **The reads' frames are no longer read for kills in main** (the nativeImage
  decode is gone): they give the rating its context alone (round, side,
  score, spike, the guarded alive).
- **Only at 720p and 1080p recording.** Recording off or at 480p, the rating
  stays off (`index.js liveRatingSupported`, the recorder's track 700 rows
  or more) and Settings says why under the switch: no full rate 480p video
  exists on this PC to measure, and the 480p reads were the weakest.
- **Counting each row once at five a second** needed three changes found on
  the clips: rows are aligned as an ordered match against every row seen in
  the last row's life (`align`; the last frame alone counted a row again after
  one frame missed it, and the signature wobbles as a semi transparent row
  crosses a changing wall); a victim block longer than 0.14 of the height is
  no row (an ability's colour in the corner); a plain row waits for 8
  sightings or 4 s for its yellow (1.6 s at five a second). The player's own
  death now needs an upright yellow edge, two neighbouring columns on 0.6 of
  the lines (a yellow haired agent's portrait made one false death: its
  columns reach 0.47 at most, the real frame 0.67 to 1). A kill row under
  the player's own death row on the same frame came after the death and is
  never the player's (the spectating trap within one frame).

**Measured on full rate video** (`npm run measure:liveratingclips`): every
death clip on this PC, 20 of them (15 at 1080p, 5 at 720p, none at 480p),
each about 16 s around a death, 30 a second, sampled at 2, 5, 10 and 30 a
second. 13 have Riot's feed on the review (9 with the clip's own death mark,
4 placed 4.45 s before the clip's end); 7 older ones have no feed, so they
count for deaths (their time placed) and for the spectating trap only. **There
are no highlight clips on this PC** (the owner's saved reviews predate 8.17),
so the player's kills inside these clips are few: **3**.

| rate | own kills found, counted wrong | own deaths found, counted wrong | lag kills p50, p90 | lag deaths p50, p90 | others' kills counted (Riot 20) |
| --- | --- | --- | --- | --- | --- |
| 2 a second | 3 of 3, 0 | 19 of 20, 0 | 0.35, 0.67 s | 0.14, 2.24 s | 16 |
| **5 a second** | **3 of 3, 0** | **20 of 20, 0** | **0.25, 0.37 s** | **0.12, 1.35 s** | **17** |
| 10 a second | 3 of 3, 0 | 19 of 20, 0 | 0.15, 0.37 s | 0.11, 0.65 s | 22 |
| 30 a second | 3 of 3, 0 | 20 of 20, 0 | 0.08, 0.27 s | 0.15, 1.23 s | 25 |

By height at 5 a second: 1080p kills 2 of 2, deaths 15 of 15; 720p kills 1
of 1, deaths 5 of 5. The corner read in Chromium (`check:feedcost`, GitHub's
machine, no GPU, software canvas): at 1080p a 670 by 238 corner, 4.2 ms a
read, 21 ms a second at five a second (about 2% of one core), against 7.7 ms
for a whole frame drawn and read back; 720p 3.4 ms a read (17 ms a second);
480p 1.8 ms. So the corner costs about half a whole frame there, not the
share of the pixels it is: the draw from a VideoFrame carries a fixed cost.
On a game PC the frame is a GPU texture and the read back is the GPU's; that
cost is logged once a minute in the field and was not measured here. The detector costs 0.38 ms a corner in node (p50, 1.7
ms p99) at these heights, about 2 ms a second at five a second, before the
draw and read back. In the clips with no feed the player's kills counted were
1, 1, 1, 0, 4, 0 and 0 against Riot's 2, 1, 2, 0, 3, 2 and 0 kills in those
rounds (some before the clip began); the 4 is one more than Riot has for that
round and is not explained (a row first seen 0.8 s before the death).

What this does and does not show. The deaths clear the bar on this sample
(20 of 20, none wrong). The player's kills cannot be said to clear 85% and 95%
on 3 kills: they are 3 of 3 with none wrong, and the per kill visibility on
the reads' frames (26 of 28 kills show the yellow on some frame, 0.73 of
frames) says two sightings in a row's 5 s at five a second should be the
rule, but **the bar is not measured as met for kills** until full rate video
with many of the player's kills is measured (a match recorded with highlight
clips, or a whole recording kept). Multi kills: none of the player's are in
these clips; three of a teammate's rows stacking in one clip (q3bntd round 1)
were counted once each. The live final against the confirmed rating can only
be reconstructed from the reads' frames (round 1 above), not from the
recorder's, since no whole match was recorded on this PC.

**Assists.** The feed shows the assisters as small agent portraits left of
the killer's portrait (seen on the owner's frames), with no yellow on the
player's that was seen; reading them would mean matching the player's own
agent portrait, which is not built. Not read. What it costs could not be
measured here: no saved match carries Riot's assisters yet (the server sends
them from the November 2026 deploy). By the engine's weights an assist is
`ASSIST_SHARE` 0.15 of the kill's swing, about 0.03 of a round on a typical
kill, so 4 to 6 assists over a match are roughly 0.1 to 0.2 of the shown
value that the live number will not have.

### Round 3: an adversarial review, and what changed

An independent review ran scripts against the branch. The seal and the
widget's server held; the rest is fixed:

- **The highlight is read from the portrait's own frame alone**
  (`killfeed.js`). Measured on the owner's rows: the chevron and the frame's
  left edge are a run of 5 to 14 columns yellow on most of the row's lines,
  0.045 to 0.11 of the height left of the killer's teal; the death's edge a
  run right of the victim's teal by 0.025 to 0.07. So a run must be at least
  0.0035 of the height wide (0.0018 for the death's thinner edge) and at most
  0.02, must not cross into the gap above or below the row (where a body's
  outline crossing the feed is, and the chevron is not), must sit at that
  distance from the row's own teal, and nothing else on the row's lines left
  of it may be yellow. Valorant's yellow enemy highlight drawn as 1, 2, 5 and
  6 pixel outlines across the feed, a yellow patch beside a row and a bright
  yellow ground make no row the player's; compression noise does not stop
  the real ones (`test:killfeed`, the review's own `adv-outline` and
  `adv-detector`). On the reads' frames the per kill visibility went up with
  it: 11 of 11 kills at 480p and 16 of 17 at 720p show the highlight on some
  frame (0.73 and 0.81 of the frames), where it was 26 of 28 together before.
- **Two frames for a death too**, as for a kill: one frame of yellow at a
  victim's end counted a death at once and then blocked the round's kills.
- **One rating a match id** (`live-rating-service.js`): a new id is a new
  rating, a match the reader resumes goes back to its own; a new match whose
  first read carried the last one's score (or none) used to carry its 6.6 on
  and file its death under the last match's round 3. Inside one rating, a
  score read lower before anything was counted starts the match again.
- **"Not reading the kill feed"** in place of the number (screen and widget)
  when two rounds close with no row seen at all (yellow enemy blocks, a 4:3
  picture pillarboxed in a 16:9 capture, very long names on 4:3 stretched,
  all of which read nothing), when the recorder's rows stop for 3 s, or when
  the page stopped for its cost.
- **Sanity caps**: a side loses five players a round at most (a revive's
  second death is dropped); three or more rows new on one frame are colours
  crossing the corner, none counted; a row counted as a teammate's never
  takes a later yellow row.
- **The spectating trap when the player's own death row is missed**: no
  yellow kill row counts for 1.5 s after a teammate's death row (or under it
  on the same frame), nor outside the live round; a kill already on the feed
  before that death row keeps its yellow (a trade). Not closed: a missed
  death row that reads as no row at all leaves a spectated teammate's kill
  in that window, as the review's scenario A still shows.
- **The feed is asked for only** with the switch on, a Valorant session
  recording at 700 rows or more, the page under its budget (a read over 15 ms
  three times running stops it, `feed-off`) and the recorder not over 1.5 s
  late (`wantFeed`, tested by behaviour on the real Recorder).
- **Turning it on is Settings' alone** (`register-ipc.js fromSettings`):
  from any other page the switch only goes off (`test:configset`).
- **The live label says what happened, no numbers standing**: "Opening
  kill", "Kill", "Trade kill", "Died first", "Died", "Round won" (`liveLabel`);
  the review keeps its own.
- PUSH_LIVE goes to the shell alone and the store is read once a tick; a
  stop during the widget's start leaves nothing running (`test:ratingstream`).

Measured again on the clips at five a second (`npm run measure:liveratingclips`):
the player's kills 3 of 3, none wrong, no possible false positive in the
clips with no feed (counted against Riot's kills for the whole round: 1 of 2,
1 of 1, 1 of 2, 0 of 0, 3 of 3, 0 of 2, 0 of 0); deaths 20 of 20, none
wrong, lag p50 0.31 s, p90 1.35 s. **The death times of 11 of the 20 clips are
guessed** (no death mark kept, placed 4.45 s before the clip's end): l7eesy
rounds 2, 3, 6 and 7, eq7o3v rounds 2, 5 and 6, q3bntd rounds 1, 4, 5 and 6;
the 9 others (bsxk1d rounds 2, 7, 10, 12, loi6yi round 6, x9fzkd rounds 1, 2,
4, 6) carry the clip's own death mark.

### Round 4: a second adversarial review, and what changed

The review's new scripts (recall, false highlights, the feed, matches, caps)
ran against round 3. Recorder safety, the rating a match id, two frame
deaths, the not reading state, the gate and the stream server held. Fixed:

- **A counted row is never refused on its yellow** (`live-rating.js align`).
  Round 3's rule that a counted row never takes a yellow one read the
  detector's raw yellow, and when it fired the row and every row under it
  were made new: one noise yellow frame counted a kill twice, and dead and
  spectating, the watched teammate's rows were counted again every 1.6 s (60
  kill events where there were 30). Gone; nor is a row refused on its
  signature, since the owner's real rows read their block length anywhere
  from 0.03 to 0.065 of the height frame to frame. A frame's row may be new
  wherever it is in the feed (a misread top row no longer makes the two
  under it new, which counted a kill twice on a real clip, q3bntd round 6),
  and the signature weighs half (at 0.2 a frame's rows all shifted onto the
  row about to leave, and the new one under them was lost).
- **Three rows new on one frame wait instead of being dropped**: counted once
  they stay a second with their signatures steady (a Raze ult, the feed read
  again after a recorder stall or switched on mid round); colours crossing
  the corner do not stay. Any row seen on one frame only and gone is noise.
- **A row lives by when it was last seen**: it has left once missed on three
  frames read and unseen a second (a stall with no frame read ages nothing),
  or unseen 5 s; a row on screen 7 s is one kill. A row older than 4.5 s is
  the same only when followed frame to frame.
- **The highlight's own shape** (`killfeed.js`): a yellow box outline (3 px at
  720p, 4 at 1080p) or a solid blob 4 to 12 px wide at the chevron's place
  beside a teammate's row, and yellow in a teammate's death row's right
  margin, read as the player's before (two frames do not help against an
  enemy standing still). Measured on the owner's rows: the chevron's point
  narrows (its outer column a third to a half as tall as the tallest, and on
  a death the point is the tail just past the frame's full edge, 32 then 10,
  8, 6, 4, 2 lines at 1080p), and is the outermost yellow. So a highlight
  needs that point (a partial column across the plate's middle, with the
  yellow only falling away past it), or the portrait's own frame (its top
  and bottom edges yellowish across the portrait). The frame alone could
  not be required: those edges are 1 to 2 px blended into the plate
  (127/187/124 at 1080p), never yellow to the classifier, and yellowish on
  only 35 to 65 percent of the highlighted frames. Kept on the owner's
  highlighted frames: kills 147 of 150 at 1080p and 24 of 24 at 720p,
  deaths 314 of 315 and 84 of 92; none new.
- **Each row's real top and bottom** from its own block (its colour or its
  name's white letters across most of it): real rows sit up to 7 px off
  their place at 1080p, and the gap lines checked above and below the
  highlight are now just outside the row's own plate, not at a fixed place
  (3 px off at 720p lost both the kill and the death before). A wall of the
  block's own colour makes the plate too tall: then the killer's block, then
  the row's place. Teal leans green over blue, so a sky blue ground
  (140/180/220) is no teal.
- **Turning it on is the Settings view's own main frame** (`register-ipc.js
  fromSettings`): the sender is the registry's Settings webContents and the
  frame its main frame (or the same frame by process and routing id), never
  a URL another page or a frame inside one could carry.
- **The corner read is asked again at the next match** after a page stopped
  for its cost (one hitch on a load screen stopped it for the whole
  recording), and the lag lets go over 1500 ms and takes back only under
  1000 ms, so a recorder hovering at the limit does not switch it each
  second (`wantFeed`, `index.js feedMatch`, `feedLagging`).

**Known, by design (the spectating guard)**: a kill row within 1.5 s of a
teammate's death row is counted as a teammate's (`us`), so a real trade by
the player 0.2 s after a teammate fell is lost to them; from 0.4 s on it is
theirs. **Still open**: the player's own death row missed by the detector
while the reader still says the player is alive; the watched teammate's kill
in the next seconds is then the player's (scenario A).

Measured again on the clips (`npm run measure:liveratingclips`): at 5 a
second kills 3 of 3, none wrong, deaths 20 of 20, others' kills 18 against
Riot's 20; at 10 a second deaths 20 of 20, others 21 against 20; at 2 a second
deaths 19 of 20. The review's scenarios: every one counts right but the
trade inside 1.5 s (above).

### The owner's first real match on this branch

1. **Before**: in Settings, Record match video **On at 720p or 1080p** (write
   down which), Live rating On (past its confirm), the Stream widget On only
   if a stream is to be tried. Note the in game **Enemy Highlight Color**
   (Settings, General, Accessibility in Valorant) and whether a colour blind
   mode is on: a yellow enemy highlight is the case the detector was hardened
   against, a colour blind mode was never seen.
2. **Play one whole match** as usual, recording from the start. Glance at the
   Recording screen between rounds only if wanted: it should say a number
   and "Live, provisional", or "Not reading the kill feed".
3. **After**, once the review has linked Riot's record:
   - `%APPDATA%\Occlara\ai-log\<the match's session>\live-rating.json`: the
     live final, the confirmed rating, the gap, the player's kills and deaths
     the live rating counted (`liveKills`, `liveDeaths`) and `reading`; set
     `liveKills` against the review's own kill count for the match.
   - The debug log (`%APPDATA%\Occlara\debug.log`): `[live-rating] the kill
     feed's corner: N reads in 60 s, X ms a second in the recorder's page, Y ms
     a read` once a minute (the real cost on that PC's GPU), any
     `[live-rating] the recorder's page stopped reading the kill feed`, and
     `[live-rating] live final ... against confirmed ...`.
   - The review keeps highlight clips for the multi kills and a death clip a
     death: `npm run measure:liveratingclips` (and `-- --fps=2`, `--fps=10`)
     reads every clip on the PC with the review's feed and says, per height,
     the player's kills found and counted wrong, the deaths, the lag, and any
     possible false positive.
   - **The kill bar is met** when, over that match's clips and its
     `live-rating.json`, the player's kills counted are at least 85% of
     Riot's (recall) with at least 95% of those right (precision), and the
     deaths at least 95% both. A highlight clip of a 3K or 4K is the test of
     rows stacking: each kill counted once.

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
  plain warning and a confirm (settings.js), and so does the switch beside
  Start on Home since 9.1 (`home/live-rating-switch.js`, the same words,
  through `LIVE_RATING_SET`, on only for Home's own page). Off: no frame is decoded for
  it (`liveRating.feed` with the switch off resets and returns), nothing is
  kept, PUSH_LIVE has no `rating` key, the widget's server is stopped.
- **On**: each read the live Valorant reader applies hands its record (the
  engine's diagnostics, the AI log's) to `feedLiveRating` as the context, and
  the recorder's page sends the kill feed's rows five times a second
  (`recorder.on('feed')`, `liveRating.feedTap`), only while recording at 720p
  or 1080p (`liveRatingSupported`). An import runs a reader of its own with no
  such hook; League has no reader here.
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

- **The Recording screen** (shell.js `paintRating`): one glass row under the
  score (Orbit, 9.1), the number in the replay's own badge (shared/rating-badge)
  drawn as a glass tile, its tier a hairline rim and a dot, its last move
  rising in green or falling in red with the engine's label ("Opening kill",
  "Died first"), the small line, "Live, provisional". The count and the move
  run once on a change, nothing else moves. Start lands on this screen at
  once (the Recording view, screen-silence.md), so with the switch on its
  waiting state says the rating shows there once the match starts.
- **The stream widget** (rating-widget/): a broadcast plate for a stream's
  corner, the badge, the move, the label, the line and "Live, provisional",
  or "Full time" with the confirmed number; nothing between matches.
  Standard 520 by 190 in OBS, compact (`?size=compact`) 360 by 130. Served
  self contained (the fonts as data, no request but its own events).

## The video tool (build 3, the owner's content, 2026-11-26)

A tool for the owner alone, in `scripts/`, never shipped (package.json ships
no scripts): it takes a recording, his own, one of Occlara's clips, or a pro
player's point of view VOD, and writes an mp4 with the match rating on it,
moving at each kill and death the way a football rating does on a broadcast.
No server, no AI read, no licence, no window.

```
npm run rating:video -- <video> [--out file.mp4] [options]
```

| option | what it does |
| --- | --- |
| `--out file.mp4` | where to write (beside the video, `<name>-rating.mp4`) |
| `--side attacking\|defending` | the player's side in the first round in the video (unknown otherwise) |
| `--start-round N` | that round's number (1) |
| `--half N` | the last round of the first half (12, Swiftplay 4); overtime swaps every round |
| `--mode standard\|swiftplay`, `--agent Name` | for the engine (its length rule, the agent) |
| `--dump-events file.json` | write what the video says happened, to fix by hand |
| `--no-render` | with `--dump-events`: stop there |
| `--events file.json` | render a hand corrected list, the video not read |
| `--review <id>` | one of the owner's reviews (its id or last part): Riot's record, exact |
| `--from S --to S` | only that part of the video |
| `--corner bottom-left\|top-left\|top-right\|bottom-right` | where the badge goes (bottom left) |
| `--scale X` | the badge's size (1) |
| `--vertical` | a 9:16 cut, 1080 by 1920 |
| `--full-time[=S]` | the last frame held S seconds (2) with "Full time" |
| `--fps N` | kill feed reads a second (10) |
| `--crf N --preset P` | libx264's quality (18, medium) |

**How it reads the video** (`scripts/rating-video/events.js`): the bundled
ffmpeg decodes only the kill feed's corner at 10 frames a second, the live
rating's own detector reads it (`killfeed.js`) and the live rating's own feed
counts the rows (`live-rating.js`: the rows lined up frame to frame, the
player's yellow on two frames, no yellow kill while a teammate is watched, the
caps), fed a context the video cannot give and the tool makes up honestly:

- **Rounds**: a new round starts at the first row after a side was wiped out,
  or after 40 s with no row. Measured on Riot's record of the owner's 72
  rounds (`npm run measure:ratingvideo`): 65 of 67 rounds ended in a wipe,
  the rule could miss at most 1 of the 67 boundaries (a lower bound on the
  gap: the 30 s buy phase and the next round's first kill), and it splits 6
  of 474 gaps inside a round (a long quiet stretch after the plant) into a new
  round. A wipe needs every row of it read; a missed one leaves the 40 s gap.
- **Results**: only a wipe says one (enemy wiped, won; team wiped, lost);
  otherwise unknown (cost in "What a missing field costs": -0.07, at most 0.2
  over a match).
- **The side**: only from `--side` (cost: -0.10, at most 0.3).
- **The spike, the clock, the score**: not read. A plant moves nothing (cost
  -0.07, at most 0.2), add it by hand with `--events`.
- **Assists**: not on the feed (round 2 above), so not counted, except by hand
  (`"assists": ["me"]` on a kill) or with `--review`.
- **The numbers standing**: from every row of the feed, both teams. On the
  owner's 9 death clips with Riot's feed and a death mark, one second after
  each kill: both teams right 19 of 22 times (86.4%), the enemy's 100%, the
  player's team 86.4% (a teammate's death row missed).
- **The player's own kills and deaths**: the live rating's, measured above
  (deaths 20 of 20; at 10 a second the clips show the player's kill in 8 of
  20 clips, none counted beyond Riot's count for the round). Pro VODs were
  never measured: the bar is the owner's real match first.

So with the video alone the number is the live rating's: right in its moves,
usually lower than the review's for the missing side, plant, results and
assists. `--dump-events` writes the list (`{ t, kind: 'round', round, side }`,
`{ t, kind: 'kill', killer, victim }` with `me`, `us`, `them`, `{ t, kind:
'end', won }`), the owner fixes a wrong line, adds a plant (`{ "t", "kind":
"plant", "by": "us" }`) or an assist, and renders again with `--events`.

**`--review <id>`, exact**: the review's rounds go through the engine as the
review counts them (Riot's kills with their times, assists, plants, defuses,
results, sides), the value the video opens on counts every round before, and
each round is laid on the video by one offset: a death clip of that review by
its own death mark (exact; a clip saved before the mark was kept has its
death placed 4.45 s before its end and the tool says so), any other recording
(his whole OBS match) by matching the kills read off the video to the
record's (`plan.js alignRounds`, two kills of the same two teams within
0.8 s). Measured: placed from the video alone on 7 of the 9 clips with a mark,
off it by 0.23 s at the median and 0.41 s at most (the row shows a little
after the kill); the two not placed had one kill read of a round with more.

**The overlay** (`scripts/rating-video/ass.js`): the widget's broadcast look
drawn by the bundled ffmpeg's libass, chosen over drawtext with PNG overlays
because one subtitle script carries shapes, text and motion on time, frame
exact, and over a hidden Electron window because it needs none. One plate on
the app's surface with its rim and shadow, the number in its tier's colour in
the dark ink (counted to its new value in 0.42 s, the badge's colour turning
with it), the move rising in green or falling in red at the event (sliding 14
px and fading after 2.8 s), the short label without the numbers standing
(`liveLabel`, rising 6 px, held 4 s; a kill that moves the shown number less
than 0.05 keeps its label and shows no move), and the moon with
"Occlara" (9.1: drawn from the mark's one source, scripts/moon, each outline
run against the one it lies in so libass cuts the seas and craters as the
SVG's even odd rule does, `ass.js moonMark`; the stream widget signs with the
same moon inline). The app ships Geist only as woff2 and this ffmpeg's freetype cannot
read woff2, so `scripts/rating-video/woff2.js` decodes the app's own files to
TrueType in pure node (brotli from node's zlib, the glyf and loca transform
rebuilt), into a temporary folder each run: checked against fontTools, all 783
glyphs' outlines and metrics the same. Placement, scaled by the height: bottom
left (default) ends at 0.86 of the height, clear of the minimap, the voice
list, the kill feed, the health bar and the abilities (the chat sits under
it); top right is under the kill feed, top left under the minimap, bottom
right left of the weapon list.

**The output**: libx264 (`-profile:v high`, `yuv420p`, CRF 18, medium), the
source's sound as AAC 192k (padded with silence through Full time), the
source's frame rate rounded, `+faststart`: what phones, TikTok, Shorts and X
take. Every path reaches ffmpeg as `file:` and the full path (`asFile`), so
a video named like a protocol (`concat:`, `http:`) is read as a file. `--vertical` puts the whole picture full width across the middle over a
blurred, darkened copy of itself and the badge at twice the size under it.

**A pro player's VOD, step by step**:

1. Only a player's own point of view with the normal player HUD: the kill
   feed top right as the player sees it, the player's own rows yellow. A
   broadcast or observer HUD is not supported (below).
2. 720p or more, 16:9 (the corner is looked for where a 16:9 picture has it;
   the tool says so otherwise).
3. Trim to the match or the moment first, with `--from` and `--to`, or the
   tool reads the whole VOD.
4. Run it with `--dump-events` and `--side` if the first round's side is known,
   look at the list, fix what is wrong (rounds, a missed row, plants), render
   with `--events`. Only sides and agents are written, never a name.

**A VCT broadcast, not done.** Broadcasts use the observer HUD: a different
kill feed (all ten players with their names, team colours rather than ally
teal and enemy red, no yellow for one player) and both teams' players along
the bottom. Rating one player there would take a detector of its own for that
feed's geometry and colours, a way to tell the chosen player's rows (by the
agent portrait at the row's end, read against the ten agents on the bottom
bar, since the names must never be read or printed), the round from the
broadcast's own round counter, and a fresh measurement against the match's
public record before anything is shown.

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
- The video tool: `npm run test:ratingvideo` (67, pure node and the bundled
  ffmpeg, synthetic video only: the woff2 decoder's tables, loca and
  checksum; events from drawn frames, a round split by the gap and one by a
  wipe, its result, the sides by half and overtime, a hand corrected file
  checked line by line; the plan's moves and labels, Riot's record by offset
  and the offset found from the kills read; the overlay clear of the kill
  feed, the minimap and the health bar at 720p, 1080p and 1440p, the count,
  the script's timing, Full time; every option and refusal; a drawn video
  read, rendered and probed end to end: H.264 high, yuv420p, AAC, faststart,
  the badge in its tier's colour, the kill feed still read under it, the
  vertical cut). `npm run measure:ratingvideo` reruns the round rule on Riot's
  record, the numbers standing and `--review`'s placing on this PC's clips
  (read only, counts only).

## Open questions

1. The table is fitted on one player's lobbies; refit as more matches with a
   feed (and now assisters and planters) are saved, with a `VERSION` bump.
2. The other nine's ACS is not kept, so the rating's agreement with ACS is
   measured on the player's own matches alone.
