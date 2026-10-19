# Matches graded from Riot's record

Moved out of CLAUDE.md word for word, nothing reworded or dropped (CLAUDE.md as of commit cc1f880, 8.5.0, lines 1169 to 1359). Sections here: "Matches graded from Riot's record". It is a part of the section "Nothing reaches the screen during a match, in any game". "Above" and "below" in the text name sections that may now sit in another file under docs/claude/: grep the section's title there to find it. The table in CLAUDE.md says which file to read for which work.

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
