# The match rating

A football style player rating (FotMob, SofaScore) for a Valorant match: a
number from 0.0 to 10.0 that starts at 6.0 and moves by tenths with what the
player does. Build 1 (this file) is the engine and the post-match surface.
Build 2 will feed the same engine live from the screen reader for the
Recording screen and an OBS browser source; build 3 will draw it onto a
video. Neither is written yet, and nothing of build 1 shows mid match.

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

- **Deaths** are debited the swing they caused, times `LOSS_WEIGHT` 0.85 (a
  duel lost is partly the killer's doing; football ratings average above
  their start for the same reason).
- **A traded death** (a teammate kills the killer within `TRADE_MS`, 5 s,
  the record's own rule) gives back `TRADE_BACK`, 0.7 of what it cost, at the
  trade, **taken out of the trader's credit for the trade kill**, so a one
  for one trade adds nothing to the lobby's total. Both ends must be named:
  a killer with no agent is the bare `them`, which is never matched to a later
  kill (round 1 matched it to any later kill, read every death as traded and rated the Abyss 8.3 where its own maths gave 8.0).
  With no keys, Riot's own `traded` flag on the player's death gives the same
  share back, from nobody. A death's label says "traded" or "not traded" once
  the round ends. An entry who dies first every round and is always traded
  within a second, with no kills, rates 4.5 (3.2 untraded).
- **Revives** (`riot-rounds.js teamworkOf`'s rule): a **gun** kill (`isGun`,
  the game data's weapons and the knife) by a player down 2 s or more, or a
  second death of one, puts them back up first, and the change in the chance
  at that moment is credited to a Sage of that side who is up, else to the
  player themselves (Clove's Not Dead Yet). An ability's kill by a player
  already dead (a molly 3 s after its owner died) is no revive. **Clove's
  ultimate running out** with no kill (a self kill by an ability of a player
  down) moves nothing: the round costs what the first death cost, labelled
  "Your ultimate ran out, no kill".
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
- **A teamkill or a self kill** is carried by whoever did it.
- **A round the player sat out** (`sat-out.js`) moves nothing of theirs and is
  not counted as a round played; the others' values still see it.

**A round's name** is a label only, from what the player did in it: "Ace",
"Triple kill with the opening kill", "2 kills, won a 1v3", "Opening kill and
the plant", "Trade kill", "Died first, not traded", "Saved the last life",
"Double kill, then died". It adds no points.

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

E is the queue's usual longest match: 24 rounds, 9 for Swiftplay and
Replication, 7 for Spike Rush (`lengthOf`; a first to five match of nine
rounds or fewer with no queue named is Swiftplay). Twelve rounds of neutral
play are the K, the same idea as the grade's "a short match is judged over
twelve rounds".

- **Up to E rounds every move weighs the same from round 1**, so a live value
  (build 2) never leaps because the match is young.
- **Overtime does not inflate**: past E the net is taken per round, so thirty
  rounds of the same play rate exactly what twenty four did (8.8 and 8.8,
  `test:rating`). Live, each round past E dilutes the value a little.
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

- **Distribution**: mean 6.55, median 6.5, 10th percentile 4.8, 90th 8.3,
  min 4.3, max 9.1. By whole point: 4.x 7, 5.x 10, 6.x 17, 7.x 7, 8.x 10,
  9.x 1. None at 10.0.
- **Per match, all ten** (best, worst, mean): 20 rounds 8.5, 5.0, 6.71;
  6 rounds 8.5, 4.6, 6.35; 16 rounds 8.3, 4.5, 6.46; 23 rounds 9.1, 4.8,
  6.70; 7 rounds 8.4, 4.3, 6.32.
- **Correlations**: with kills less deaths over all 52 timelines 0.86 (0.88
  per round); the player's own seven matches with ACS 0.85; with Occlara's
  grade over the five graded 0.94. Clearly related, not a copy: the rating
  ranks by when a kill came and what it changed. The other nine's ACS never
  reaches the client, so the ACS figure is the player's own seven matches.
- **Real matches**: the Abyss 31 kill, 21 death Jett rates 8.3; the Split 17
  / 16 Jett 6.9; the player's five saved reviews 6.8, 7.4, 6.6, 6.9 and 8.4
  (ACS 279, 241, 285, 265, 447; grades 71, 73, 61, 65, 84), placed 4th, 3rd,
  6th, 4th and 1st of 10.
- **How the weights were set**: `TRADE_BACK` 0.7 puts the always traded
  entry at 4.5; with the give back now out of the trader's credit,
  `LOSS_WEIGHT` 0.85 puts the mean at 6.55; the squash's 3.2 and 2.6 put the
  best near 8.5 to 9 and the worst near 4.5.

## What a missing field costs

Measured on the seven matches by taking the field out of every round (mean
change of the player's final, largest change):

| missing | what happens | cost |
| --- | --- | --- |
| the round's side | no defenders' edge, no spike in the chance; a plant whose planter's side is known still says the side | -0.16, at most 0.4 |
| kill times (`ms`) | the feed's own order; no named trade is seen (Riot's flag still counts); no "after the spike went off" | -0.14, at most 0.5 |
| the plant's time | the plant moves nothing and post plant kills are valued as before it | -0.09, at most 0.2 |
| the round's result | no result term and no end remainder | -0.04, at most 0.2 |
| agents on the feed (`ka`, `va`) | only the player is rated, so no place and no lobby; trades come from Riot's flag alone; plants and the end remainder are shared only by known players | +0.16, at most 0.5 |
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
key, so an older client reads the same round. The client keeps each end only
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
review gets neither.

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
replay stops when its page is hidden.

## Tests

- `npm run test:rating` (90): the chance and the spike's clock, the swings,
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
  name, a forged end dropped, and none added to a record without them.
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

## Open questions

1. The table is fitted on one player's lobbies; refit as more matches with a
   feed (and now assisters and planters) are saved, with a `VERSION` bump.
2. The other nine's ACS is not kept, so the rating's agreement with ACS is
   measured on the player's own matches alone.
