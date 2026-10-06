# Riot backfill, the onboarding Riot ID step, and the Matches breakdown

Approved 2026-10-05. Ships as 8.0.3. The layout revamp (one main window with a
sidebar) is a separate later release and is not part of this spec.

## Goals

1. When a player connects a Riot ID, grade their recent matches from Riot's
   record, so the library, the patterns and the grade baseline are useful on
   day one.
2. A Riot ID page in onboarding with Connect and Skip.
3. A per map and per agent breakdown in Matches (per map and hero for Marvel
   Rivals, per champion for League), counted from saved reviews only.

## Non goals

- No AI calls for backfilled matches: no summary, no death forensics.
- No automatic catch up on launch. Backfill runs on Connect or on the button.
- No change to the live read, the guards, or anything shown during a match.

## 1. Backfill

### When it runs

- After `testTracker()` succeeds (the Connect button in Settings and in
  onboarding). Main starts it; renderers only listen.
- From the "Grade my recent matches" button in Matches (Valorant tab).
- One run at a time. A start for the account already running returns its
  status. A start for a different account cancels the running one at its next
  safe point and starts the new one.
- While a match is in progress (`matchInProgress()`) the run waits, before
  every request and every save, and its status says so.

### What it grades

The last 10 matches on the account in Competitive, Unrated, Swiftplay or
Premier. Never Deathmatch, Team Deathmatch, Spike Rush, Escalation,
Replication, Snowball Fight or custom games: those either have no rounds or are
not graded on the standard curves.

The list comes from a new server route `GET /api/coach/recent-matches`, which
returns the same rows `/last-match` builds (`lastMatchRow`), newest first, from
one stored-matches call (two when deathmatches crowd the first page), cached
two minutes per Riot ID. When the route is missing (an old server), the client
falls back to `/last-match`, newest plus `recent` (up to five).

Each match's round record comes from the existing `/api/coach/match-rounds`.
`riot-rounds.parse` also returns `startedAt` and `lengthMs` when Riot has them.

### Planning, before any round record is fetched

For each listed match, in this order:

- **have**: a saved review already carries its `matchId`. Skipped.
- **pending**: it fits a watched review whose link job is still running
  (`reviewJobs`). Skipped, the job links it.
- **upgrade**: it fits exactly one saved watched review that never linked, and
  that review fits only this match. Fitting is `verifyCoachedMatch` with the
  review's window (`ledger.startedAt` and `ledger.endedAt`, or for a review
  saved before this release `at` minus its watched rounds plus two, times 100
  seconds), its map, its confirmed agent and its score.
- **ambiguous**: it fits several, or a review fits several matches. Skipped, so
  a match is never in the library twice.
- **new**: everything else.

### Building

Oldest first, so each match is measured against the matches before it.

- **new**: `reconcile([], riot)` gives every round as Riot's, then
  `valorantReview.build` with `source: 'riot'`, the listed row as the tracker,
  Riot's queue, and the history rows older than this match. The review carries
  `source: 'riot'`, `account` (the Riot ID), `matchId`, `matchStartedAt`, and
  `at` = start plus Riot's length (else rounds times 100 seconds).
- **upgrade**: `reconcile(ledger rows, riot)` and `build` with the review's own
  context, id and `at`. The old summary, focus and round whys are dropped,
  because they were written from facts Riot has now corrected, and the review
  says so. A ledger rebuilt from a pre 8.0.3 review's cards drops the reads in
  any round where Riot's death disagrees with the screen's.
- Every graded match adds one `valorantHistory` row (`historyEntry`, with
  `at` = match start and `matchId`), merged by time, deduplicated by
  `matchId`, capped at `BASELINE_GAMES`.

### Pacing and failure

- At least 3 seconds between upstream requests.
- A 503 or a network failure on one match retries after 30 then 60 seconds,
  then that match is marked failed and the run moves on. Three failed matches
  in a row stop the run as unreachable.
- Riot ID not found, licence refused and no matches each end the run with a
  plain sentence, never a silent stop.
- At the end, if anything was graded, a panel notice: "Graded N of your recent
  matches from Riot's record. They are in Matches."

### Status, pushed on every change (`PUSH_BACKFILL`, also `BACKFILL_STATUS`)

```
{ state: 'idle'|'listing'|'waiting'|'grading'|'done'|'error',
  account, found, have, total, done, graded, upgraded, failed,
  items: [{ matchId, map, agent, mode, result, score, startedAt,
            status: 'pending'|'graded'|'upgraded'|'failed', id, grade }],
  message }
```

## 2. Data added to Valorant reviews

- Round cards gain `sideKey` ('attacking'|'defending'|null), `verified`,
  `watched`, `spot` (the screen's death location), `ultReady`, and `riot`
  ({ sec, killer, weapon, firstDeath, firstKill, kills, traded, trades,
  clutch, alive, afterPlant }) on Riot checked rounds.
- A watched review that is not yet verified carries `ledger`: { startedAt,
  endedAt, endedBy, context, rounds } with only the fields `reconcile` reads,
  so it can be linked later. A verified review drops it.
- `source: 'riot'` reviews: no "rounds watched", no "Not watched by the coach"
  on every round, one refused line saying the coach did not watch, so there
  are no death locations, ultimate reads or look at the deaths, and a
  verification line saying it was graded from Riot's record.
- The library row (`metaOf`) gains `source`.
- Older saved cards have none of the new fields. The breakdown reads them from
  the fact strings `roundFacts` writes, which are deterministic, and a test
  asserts the two readings agree on the real fixture.

## 3. Onboarding

The last page becomes "Grade your last matches": the Riot ID field, a Connect
button, the account line (rank) once connected, and the graded matches as rows
(map, agent, result, score, grade) while the run works. The footer button reads
"Skip for now" until a Connect succeeds, then "Let's go". Grading carries on
after the tour closes. The Advanced coaching switch moves to the "After every
match" page. Clear lines for not found, unreachable and no matches.

## 4. Settings

Under the Connect status, a line that follows the run: "Grading your recent
matches from Riot's record: 4 of 10", then the outcome with an Open Matches
link.

## 5. The breakdown

`src/shared/breakdown.js`, pure, one builder per game, fed every saved review
of the game (cached in main, cleared on every save), newest first. New channel
`BREAKDOWN_GET (game, { queue })`.

### Valorant, by map and by agent

Per row: matches, record (W-L, draws named), win %, average grade, and:

- by map: attack and defence round win %, first death %, K/D. Opened: pistol
  rounds, post plants won on attack, retakes won on defence, first kills,
  trades, ACS and ADR, the agents played there with their records, where the
  player dies most there, the most repeated mistake and strength there, and the
  map against the player's other maps.
- by agent (with role): K/D, ACS, first kill %, first death %. Opened: ADR,
  headshot %, traded deaths %, survival, the maps played on it, the most
  repeated mistake and strength, and the agent against the player's others
  (grade and win rate only, since ACS differs by role).

### Rules that keep it correct

- Counted from saved reviews only. The model writes nothing here.
- Round stats (sides, pistols, post plants, retakes, first kills and deaths,
  trades, survival) come only from Riot checked rounds. Death locations come
  only from recorded matches. Scoreline numbers only from matches with a
  scoreline.
- K/D is total kills over total deaths. ACS, ADR and headshot % are weighted
  by rounds.
- Pistol rounds are round 1 and the round after halftime (`halftimeAfter`),
  never overtime.
- The average grade uses non provisional grades only, and says how many.
- Every number carries its sample. Under its floor a rate shows as "3 of 7"
  instead of a percentage. Floors: match win rate 3 matches; side rounds 10;
  pistols 4; post plants and retakes 5; first kills, first deaths and survival
  20 rounds; trades 8 deaths; a death spot needs 3 deaths and a quarter of the
  placed deaths; a repeated mistake or strength needs 2 matches and 40% of
  the row's matches.
- Against the rest needs 3 graded matches in the row and 3 outside it.
- The headline names a strongest or weakest map, or a best agent, only when
  the row has at least 3 graded matches, the rest has at least 3, there are at
  least 6 graded matches in all, and the gap in average grade is at least 6
  points and at least 1.5 standard errors (pooled across all graded matches).
  Otherwise it says nothing stands out yet. Most played needs 3 matches.
- A queue filter (All plus each queue present).

### Marvel Rivals and League

- Rivals by map (record, win %, grade, K/D, damage) and by hero (with role:
  record, win %, grade, K/D, damage, the role's duty stat, accuracy, which is
  hero scoped by design).
- League by champion (games, grade, KDA, CS a minute except supports, vision a
  minute, deaths per 10 minutes). League reviews carry no result, so no
  record.

### Matches window

A "Breakdown" section between Your patterns and Every match: a By map / By
agent switch, queue chips, the headline, and a sortable table whose rows open
in place. Narrow windows hide the lower priority columns, which stay in the
opened row. Tokens only, Geist Mono for digits, a grade always shows its number
and letter beside its colour, text built with textContent only.

## Testing

- `test:breakdown`: the real Abyss record and the session fixtures, hand
  computed side, pistol and opening numbers, every floor, the headline rule,
  legacy cards against structured ones, the queue filter, Rivals and League.
- `test:backfill`: a fake server and a temp library: oldest first, baselines
  from earlier matches only, have, pending, upgrade, ambiguous, the old server
  fallback, pacing, the pause while a match is in progress, retries, cancel,
  the status shape and the notice.
- `test:trackerroutes`: the new route, its filter, its second page and its
  503.
- `test:valorantreview` and `test:grade`: the new card fields and the Riot
  only review.
- Boot checks: `check:matches` paints the breakdown from saved reviews and opens
  a row; `check:onboardingriot` paints the Riot page, skips, and paints pushed
  progress rows.
- Screenshots of the Matches window, onboarding and Settings.
- An independent adversarial review of the whole change before release.
