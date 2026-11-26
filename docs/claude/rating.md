# The match rating

A football style player rating (FotMob, SofaScore) for a Valorant match: a
number from 0.0 to 10.0 that starts at 6.0 and moves by tenths with what the
player does. Build 1 (this file) is the engine and the post-match surface.
Build 2 will feed the same engine live from the screen reader for the
Recording screen and an OBS browser source; build 3 will draw it onto a
video. Neither is written yet, and nothing of build 1 shows mid match.

Files: `src/shared/rating.js` (the engine, pure), `src/shared/valorant-review.js`
(`ratingField` in `build`, `withRating` in `served`),
`src/renderer/review/rating-view.js` and `rating.css` (the block and the
replay), `scripts/rating-calibrate.js` (the calibration),
`scripts/test-rating.js`, `scripts/test-rating-wiring.js`,
`scripts/check-rating-window.js`, and the sample in
`scripts/fixtures/proof-reviews.js` (`withAgents`).

## The model

**Every move is the change in the player's team's chance to win the round
that the action caused.** The chance comes from the players standing on each
side and whether the spike is down (`winChance`, below). A kill moves it from
the state before to the state after; the killer is credited that change, the
victim debited it. So a first kill at 5v5 is about a quarter of a round
(0.23 for an attacker, 0.19 for a defender), the last kill of a 5v1 two
hundredths (0.02), a kill after the spike went off nothing, and a clutch or a
multi kill is worth what the kills inside it moved, with no bonus written for
either: a 1v4 clutch won carries 0.95 of a round, an ace from 5v5 0.61
(`test:rating`). Calibration showed no shape the maths undervalued, so no
explicit term was added.

- **Deaths** are debited the swing they caused, times `LOSS_WEIGHT` 0.9 (a
  duel lost is partly the killer's doing; football ratings average above
  their start for the same reason). **A traded death** (a teammate kills the
  killer within `TRADE_MS`, 5 s, the record's own rule) gives back
  `TRADE_BACK`, half of its cost, at the trade, labelled "Your death was
  traded, half of it given back"; the trader is credited the trade kill's
  own swing. A death's label says "traded" or "not traded" once the round
  ends.
- **Assists** take `ASSIST_SHARE` 0.15 of the kill's swing each, half at most
  in all, from the killer. The feed the client keeps names no assister yet,
  so today every kill is its killer's alone (open question 1).
- **Plants and defuses** move the chance like a kill does. A named planter or
  defuser takes `PLANTER_SHARE` half and the rest is shared by the side's
  players alive at it, the other side's alive taking the cost. The record the
  client keeps has the plant's time but not who planted, and no defuse at all,
  so today a plant is shared by the attackers alive, and a defuse is the
  round end's remainder (next point).
- **The round's end.** What was left of the chance (a defuse nobody named,
  the timer, the spike going off, a save) goes to whoever was still up, by
  side, the winners gaining it and the losers alive losing it ("Round won,
  spike defused", "Round lost, alive at the end"). Then the small result
  term, `RESULT` 0.02 to each player of the side that won and minus 0.02 to
  each of the side that lost. It stays small because the result is already
  inside the swings: a side's swings in a round sum to its result less its
  chance at the start.
- **A teamkill or a self kill** is carried by whoever did it.
- **Revives** follow `riot-rounds.js teamworkOf`: a gun kill by a player down
  2 s or more, or a second death of one, puts them back up first.
- **A round the player sat out** (`sat-out.js`, Riot's AFK or in spawn flag
  on the card) moves nothing of theirs and is not counted as a round played;
  the others' values still see it.
- **Decided**: a swing under 0.01 is labelled "after the round was decided".

## The table

The chance for the attackers to win from `a` attackers against `d`
defenders, a logistic fitted by maximum likelihood on **116 rounds of Riot's
record, 940 states, both teams of every round**: the two fixtures with a kill
feed (`riot-abyss-13-11`, `riot-split-13-7`) and the owner's five saved
reviews with one.

    logit P = -0.43 + 0.82 (a - d) + 0.60 ln(a / d) + 0.98 planted

Log loss 0.494, against 0.495 for the difference alone and 0.501 for the
ratio alone. The ratio is what makes a man up in a 2v2 worth more than one in
a 5v5, as the record has it (2v1 won 75 percent, 5v4 62 percent). The
intercept is the defenders' edge at equal numbers with the spike up, which
the clock gives them. A side wiped with no spike down has lost; attackers
wiped after the plant still win while the defuse is not done, half the time
against one defender and 0.3 times as likely for each more (26 such states,
by eye: 5 of 10, 1 of 7, 0 of 6). The sample is thin and is one player's
lobbies, so the curve is the data's shape, not a published table; refit it
with `scripts/rating-calibrate.js`'s data as more matches with a feed are
saved, and bump `VERSION`.

Attackers' chance in percent, spike up / spike down:

| attackers, defenders | 1 | 2 | 3 | 4 | 5 |
| --- | --- | --- | --- | --- | --- |
| 5 | 98 / 99 | 93 / 97 | 82 / 92 | 63 / 82 | 39 / 63 |
| 4 | 95 / 98 | 84 / 93 | 64 / 82 | 39 / 63 | 20 / 40 |
| 3 | 87 / 95 | 65 / 83 | 39 / 63 | 19 / 39 | 8 / 20 |
| 2 | 69 / 86 | 39 / 63 | 18 / 37 | 8 / 18 | 3 / 8 |
| 1 | 39 / 63 | 16 / 33 | 6 / 15 | 2 / 6 | 1 / 2 |
| 0 | 0 / 50 | 0 / 15 | 0 / 5 | 0 / 1 | 0 / 0 |

With no side known the spike cannot be placed and the man advantage alone is
used, symmetric: `sigmoid(0.82 (us - them) + 0.60 ln(us / them))`.

## The display and match length

Shown = 6.0 plus a squash of the net swing: above 6, 4 tanh(x / 3.2), so 10.0
is reached only in the limit; below, 3 tanh(x / 2.6), a floor of 3.0. One
decimal. x is the net scaled to a standard length:

    x = net (24 + 12) / (max(rounds, E) + 12)

E is the queue's usual longest match: 24 rounds, 9 for Swiftplay, 7 for
Spike Rush (`lengthOf`; a first to five match of nine rounds or fewer with no
queue named is Swiftplay). Twelve rounds of neutral play are the K, the same
idea as the grade's "a short match is judged over twelve rounds".

- **Up to E rounds every move weighs the same from round 1**, so a live value
  (build 2) never leaps because the match is young, the way a football
  rating's early goal counts as much as a late one.
- **Overtime does not inflate**: past E every move is diluted a little. The
  same play over 30 rounds rates 8.7 where 24 rounds rated 8.6.
- **A Swiftplay is not wildly volatile**: its moves count 36 / 21 = 1.71
  times, which leaves its noise a little under a full match's (the square
  root of 6 rounds times 1.71 is 4.2 rounds' worth, against 4.9 for 24) where
  a per round average would give four times the swing per move. The same
  play rates 7.3 in six Swiftplay rounds against 8.6 over 24.
- A rating needs `MIN_ROUNDS` 3 rounds played.

## Calibration

`node scripts/rating-calibrate.js --library` (fixtures and the owner's
saved reviews; it prints agents and numbers only and writes nothing). Seven
matches with a kill feed: the two fixtures (no agents in their feed, so the
player alone) and five saved reviews with every kill named by agent, all ten
rated. 52 timelines.

- **Distribution**: mean 6.58, median 6.6, 10th percentile 4.6, 90th 8.5,
  min 4.3, max 9.3. By whole point: 4.x 10, 5.x 7, 6.x 15, 7.x 8, 8.x 11,
  9.x 1. None at 10.0.
- **Per match, all ten** (best, worst, mean): 20 rounds 8.7, 4.4, 6.62;
  6 rounds 8.8, 4.6, 6.38; 16 rounds 8.5, 4.5, 6.50; 23 rounds 9.3, 4.6,
  6.77; 7 rounds 8.6, 4.3, 6.38. The best is 8.5 to 9.3, the worst 4.3 to
  4.6, as asked.
- **Correlations**: with kills less deaths over all 52 timelines 0.89 (0.90
  per round); the player's own seven matches with ACS 0.91; with Occlara's
  grade over the five graded 0.84. Clearly related, not a copy: the rating
  ranks by when a kill came and what it changed (first kills, trades,
  clutches), and only Riot's ACS for the player himself is kept, so the ACS
  figure is over 7 matches; the other nine's ACS never reaches the client.
- **Real matches**: the Abyss 31 kill, 21 death Jett rates 8.3; the Split
  17 / 16 Jett 7.3; the player's five saved reviews 6.6, 7.1, 6.9, 6.5 and 8.6
  (ACS 279, 241, 285, 265, 447; grades 71, 73, 61, 65, 84), placed 5th, 3rd,
  6th, 6th and 1st of 10.
- **How the weights were set**: `LOSS_WEIGHT` 1.0 put the mean at 6.34, 0.75
  at 6.94, 0.9 at 6.58; `TRADE_BACK` 0.4 moved it 0.04; the squash's 3.2 and
  2.6 put the best near 8.5 to 9 and the worst near 4.5.

The sample is small (five full lobbies), and the owner's own lobbies. Rerun
the script as the library grows; any change to a number bumps `VERSION`.

## What a missing field costs

Measured on the seven matches by taking the field out of every round (mean
change of the player's final, largest change):

| missing | what happens | cost |
| --- | --- | --- |
| the round's side | no defenders' edge, no spike in the chance (symmetric model); a plant still says the side when its planter's side is known | -0.13, at most 0.3 |
| kill times (`ms`) | the feed's own order is used; no trade is seen, so no death is given back; no "after the spike went off" | -0.33, at most 0.7 |
| the plant's time | the plant moves nothing and post plant kills are valued as before it | -0.09, at most 0.2 |
| the round's result | no result term and no end remainder | -0.03, at most 0.2 |
| agents on the feed (`ka`, `va`) | only the player is rated, so no place and no lobby; the player's death cannot be seen traded (the killer has no key); plants and the end remainder are shared only by known players | +0.24, at most 0.7 |
| the victim's side | the kill is worth `NEUTRAL_SWING` 0.17, the mean swing of a kill or death in calibration | per kill |
| the killer's side | the victim is debited, nobody credited | per kill |
| the numbers standing | worked out from the feed; the screen's own count can be given (`alive`) and wins | none with a whole feed |
| assisters | every kill is the killer's | today's state |
| planter, defuser | shared among the side's players alive; a defuse is the round end's remainder | today's state |

## The event shape (what build 2 must feed)

A player is a key: `'me'`, a side and an agent (`'us:Sova'`, `'them:Jett'`),
or a side alone (`'us'`, `'them'`) when the agent is not known, counted in the
numbers standing and credited nothing. Never a name.

    createRating({ subject: 'me', players: [keys], queue, longest, meAgent })
    r.push(event) -> { round, ms, kind, delta, value, swing, label }
    r.snapshot()  -> { version, value, net, rounds, players: [{ key, side, agent, value, net }], timeline }
    r.value()

    { kind: 'round',  round, side: 'attacking' | 'defending' | null, satOut }
    { kind: 'kill',   round, ms, killer: key, victim: key, assists: [key], weapon, alive: { us, them } }
    { kind: 'plant',  round, ms, by: key or side }
    { kind: 'defuse', round, ms, by: key or side }
    { kind: 'end',    round, won: true | false | null }   (the subject's side)

`players` lists the lobby when it is known (agent select), so a player is
counted alive and gets the result term before their first kill. A round no
`round` event opened is opened by its first event. `alive` before a kill,
when the screen reads it, overrides the count the engine keeps. `weapon` only
tells a revive from a molly. `delta` is the change in the shown value, `swing`
the subject's credit in chance to win, `label` a plain line ("First kill,
5v5", "Died first, not traded", "Kill as the last one up, 1v3", "Spike
planted, 4v3"), null when the event was nothing of the subject's. Live, a
death's label gains ", traded" or ", not traded" only at the round's end, on
the timeline entry, not on the answer already given. `fromRecord` and
`eventsOfRound` turn Riot's record (the card's `riot.feed`, `plantSec`,
`sideKey`, `result`, the AFK flags) into these events, the feed's `as`,
`plantBy`, `defuseSec` and `defuseBy` read where a later record carries them.

## What is saved

On the review, `rating` (`valorant-review.js build`, `ratingField`, from the
cards), only where the cards carry Riot's kill feed:

    { version, value, rounds,
      timeline: [{ round, ms, kind, delta, value, swing, label }],
      place: { n, of } | null,
      lobby: [{ side, agent, value, me }] | null }

The lobby and the place only when every kill names both ends by agent. Sides,
agents and numbers: never a name, tag, puuid or Riot ID. `VERSION` is 1; a
saved rating is served as saved whatever its version, never counted again, so
a number changed later does not lie about an old one.

**Every path that lays Riot's record over a review builds through `build`**:
the match end (`index.js buildValorantReview`), an import that matched (the
same function with `snap.importRun`), the late link and the backfill
(`riot-review.js upgradeWatched` and `fromRiot`). A review from the screen
alone saves none. League has none.

**Old reviews**: `served` (`withRating`) counts one on open from the saved
cards when they carry the feed (linked since 8.5.0), never writing it back
and never touching the grade. A review linked before the feed was kept is
told "Saved before Occlara kept Riot's kill feed for every round, so there is
nothing to rate it from." and a screen only one "Rated only once Riot's
record of the match is linked: the rating is counted from Riot's kill feed,
round by round." A locked review gets no view.

## On the review page

`served` sends the page `ratingView` (`rating.js viewOf`, a view field,
`VIEW_FIELDS`, never on disk): the value, the line by round from 6.0 at round
0, the three biggest gains and losses by swing (each its round, label and
signed move), their rounds as marks, the place as "3rd of 10", the lobby by
side, agent and value, and every event for the replay.

The block, "Match rating", sits before "Round by round": the number at 64px
Geist 600 "out of 10", the place "2nd of 10 in the lobby", Replay the rating,
the line (the ink, 6.0 dashed, a gain's dot in `--good` above the line and a
loss's in `--bad` below it, so the colour is never the only signal), the
gains and losses side by side (a row opens its round's row through
`goRound`, its clip with it where one was kept), and "The lobby, by agent"
closed in a `details`. No card, tokens only (`rating.css` says so on its
first line).

**The replay** plays the rating from 6.0 over the page in the Verdict's own
panel: the round ("Round 7 of 24"), the number at 120px counting through CSS
(`@property --rt`, the value in tenths, its whole part and tenth drawn by
`counter()` over the real number, which stays the text), the move in its
outcome's colour, the line of what happened rising in, the match's line
revealed by its clip up to the round, and the marks appearing. A round's
events share 2.6 s (0.6 to 1.2 s each), a round with nothing of the
player's passes in 0.32 s, so a 24 round match plays in about a minute. Skip,
any key, Esc or a click on the ground goes to the final value and the place;
again closes it. Esc closes only the replay, never the page. Reduced motion
takes every duration to nothing (theme.css), so each step is shown where it
lands. A page hidden stops it.

**Matches and Home were left alone**: neither has an obvious slot for one
more number beside the grade and the RR chip.

## Nothing mid match

The rating rides the review, served through the review's own channels,
which are sealed mid match; it adds no channel (`test:ratingwiring` holds
that). The replay stops when its page is hidden.

## Tests

- `npm run test:rating`: the chance (monotone, the zero rows), the swings
  (first kill, the last of a 5v1, after the spike went off), the sanity
  cases (an ace, a 1v4 clutch worth more than an ace with no bonus, 24
  untraded first deaths near the floor, a traded entry above an untraded one
  and still under 6.0, cleanup kills under the start and under the mates who
  took the rounds, an AFK round moving nothing), determinism, every missing
  field, the length rule, the saved shape and its version, the real Abyss.
- `npm run test:ratingwiring`: saved by the match end, the Riot only review,
  the late link and an import, none from the screen alone; served as saved,
  counted on open and written nowhere, the grade untouched; the notes; none
  locked or for League; the sample ranks all ten by agent; no name, no
  dash, no channel.
- `npm run check:rating` (a window): the block on the real page as main
  served it, a swing opening its round, the replay playing, skipped and
  closed, Esc closing only it, the screen only note, a locked review without
  it. `OCCLARA_SHOTS=1` writes `main-rating*.png`.
- `check:mainwindow` holds the block before the rounds with the served value
  and place, and pictures it as `main-review-rating.png`.
- The sample library (`proof-reviews.js withAgents`) gives the fixture's feed
  agents from its comps, deterministically, so it rates all ten: a sample's,
  never what a real match said about the other nine.

## Open questions

1. **Assists, the planter and the defuser are not in the record the client
   keeps.** HenrikDev's v4 kill has its assistants and the round its plant
   and defuse with the player; `riot-rounds.js parse` could add `as` to each
   feed kill and `plantBy`, `defuseMs` and `defuseBy` to each round (by side
   and agent, never a name), carried by `valorant-verify.js killFeedOf` and
   `recordOnCard`. The engine already reads them. Not done in build 1: it is
   a server change and a new key on every linked card.
2. The table is fitted on one player's lobbies; refit as more matches with a
   feed are saved.
3. The other nine's ACS is not kept, so the rating's agreement with ACS is
   measured on the player's own matches alone.
