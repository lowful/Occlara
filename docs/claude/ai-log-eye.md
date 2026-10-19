# The eye opens that match's AI log

Moved out of CLAUDE.md word for word, nothing reworded or dropped (CLAUDE.md as of commit cc1f880, 8.5.0, lines 1009 to 1100). Sections here: "The eye opens that match's AI log". It is a part of the section "Nothing reaches the screen during a match, in any game". "Above" and "below" in the text name sections that may now sit in another file under docs/claude/: grep the section's title there to find it. The table in CLAUDE.md says which file to read for which work.

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
  `'gone'` or null (`scopeFor`). Null is no eye: Riot's record alone and
  League write nothing to the log, and a match recorded with the AI log off
  has no log to open. Gone is a disabled eye with its reason. The kept
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
- **Its deaths are the engine's** (8.4.1, `ai-log-timeline.js engineDeaths`),
  so the death it opens on is one the engine kept. Every record since 8.0
  carries `died`, true on the frame the engine registered a death on, and a
  death on trial is written with its verdict, false once withdrawn; the log
  takes those, one a round, the first, as the ledger does, in the round the
  record is filed under (`death-reconcile.js filedRounds`: the ledger's, or
  for a frame read after the watch ended a match, the round its score says,
  where that ledger files it on a resume). A death on the banner that already
  printed the next score, registered on a round's first frames before any buy
  or play, is the round before's when that round has none, as the ledger
  files it, though its record carries the new round (`death-frames.js
  borrowedInto`, the review's frame picker's own rule): on the real 24 round
  Abyss match rounds 6 and 24 died so, and taken at their records' rounds the
  log listed 21 deaths where the ledger has 22, round 7's own refused as a
  second and a round 25 the match never had. It used to find its own in runs of
  frames, and on the player's Fracture swiftplay listed 6 where the engine
  registered 5, its ledger kept 4 and Riot has 3: every real death a frame
  or two late ("no own health number" read as the player's own HUD), one
  SWITCH PLAYER frame the engine never registered and round 6 twice; any of
  those first in a match was where its eye opened. The runs are kept for a
  log from before 8.0, which carries no verdict, and refuse a negation of the
  HUD now ("no own HP", "own HP not visible"), and a dead flag on the
  SPECTATORS counter alone is no evidence, as the engine drops that read.
- **Riot's death check is the review's own check, in its own words**
  (`death-reconcile.js`): the engine's deaths, of one match, are checked round
  by round against Riot's over the rounds the log was filed under, and said by
  `valorant-verify.js describe`, so the log's line is the review's: "Checked
  against Riot's record of the match: the screen read 4 deaths and Riot has 3,
  with none in round 1." It said "Riot recorded 3 deaths, the coach marked 6,
  so 3 is not real." Each death Riot has carries Riot's killer and weapon (the
  killer's agent, never their Riot ID, and the weapon's name, never its type),
  one in a round Riot has none in is dimmed and says so, and a log from before
  8.0, or a session of several matches, is checked by its counts in the same
  words with no round named. Never timed: the review's
  "read 59 s before Riot's" needs Riot's plant (`deathMoment`), and the deaths
  the log's check is sent (`/api/coach/match-deaths`) carry none, so on such a
  match the log pairs the death the review calls early.
- `npm run test:ailog` holds the strict read, `locate` and `scopeFor`, the
  match's first death the engine's, and main's own keep rules run in a sandbox
  (a round change's frames kept, and lost to the cap before a death's, after a
  held match's other frames); `test:ailog-timeline` the engine's deaths, equal
  to the ledger's round for round on the five committed sessions through the
  real engine, a banner death driven through it and the real Abyss match, whose
  check says what its review says, and the negation; `test:deathreconcile` the
  check round by round and its sentence equal to the review's; `test:surfaces`
  the row, the header, the log's scoped mode and a check's marks;
  `check:matches` clicks row eyes through to the real window, for a review that
  kept its place and one found by its end, and finds the header's.
