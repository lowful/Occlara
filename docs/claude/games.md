# Marvel Rivals was removed, and one game's data stays under its own game

Moved out of CLAUDE.md word for word, nothing reworded or dropped (CLAUDE.md as of commit cc1f880, 8.5.0, lines 3175 to 3273). Sections here: "Marvel Rivals was removed in 8.4.0", "One game's data is never shown under another game's name". "Above" and "below" in the text name sections that may now sit in another file under docs/claude/: grep the section's title there to find it. The table in CLAUDE.md says which file to read for which work.

## Marvel Rivals was removed in 8.4.0

The player's decision: Occlara coaches Valorant and League of Legends, and
Marvel Rivals went whole, its engine, review, routes, data syncs, logo and
copy. An install from before still calls its routes, so every path under
`/api/rivals`, by any method, answers 410 with "Marvel Rivals is no longer
supported by Occlara. Update Occlara at occlara.app." and nothing else: no
licence looked up, no model called, no rate limit, and the live view counts it
as no read, no review and no game (`server/routes/retired.js`,
`test:serverguards`, `test:licenceoutage`, `test:presence`). What a player's
PC kept of it is put away at launch, before any page can ask
(`retired-games.js putAway`, in `app.whenReady`): a stored game of 'rivals'
becomes 'valorant', `rivalsHistory`, the baseline its reviews were graded
against, goes from the config, and its saved reviews, which no page can open
any more, are deleted with their folders and library rows, said in one log
line. Until then `review-store.js` never lists or opens one, so none is
counted on Home, in Matches, the patterns, the breakdown or the weekly report.
After the first launch there is nothing left to do. A review is the game's by
the game it was saved under and its id, never by its words: a Valorant or
League review whose sentences name Marvel Rivals stays. The library's index
is read once and written back from that read alone, and not at all when the
disk would not hand it over: read a second time after the deletes, a failed
read wrote it back empty over every Valorant and League row. Only the
Valorant reader ever wrote the AI log, so a session of it recorded while
Marvel Rivals was played is that reader's misreads, kept and opened as any
other. The id is kept only as `games.js RETIRED`, which is what makes that
possible (`test:games`, and `check:matches` on a profile 8.3.2 left).
`rivalsTitlesRepaired` is not one of its keys: it says an install ran 8.0.3
(the late link, above), and stays.

## One game's data is never shown under another game's name

The stats dashboard is Valorant shaped end to end: a Valorant rank ladder, agent
tiles, and a competitive/unrated split only Valorant has. It had no concept of
which game it was for, so selecting League returned all of it unchanged.

`getStatsDashboard` now reads `hasFeature(game, 'stats')` and a game without a
stats source returns empty with `statsSupported: false`, which the renderer
paints as a panel naming the game. League needs a Riot production key the app
does not have, and says `stats: false` in `src/shared/games.js`
**explicitly**, rather than relying on `hasFeature` returning false by
absence.

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

**Stats and Riot's death check show no other player's name, and Ask Coach is
not told the Overview is a trend** (8.4.1):

- **A match's team is agents and numbers** (`coach.js matchDetail`,
  `stats.js matchRow`). "Your team" showed every teammate's full Riot ID, and
  Valorant lets a player hide theirs from anyone outside their party, while
  Riot's policy is that a product shows no player's identity to others
  without their opt in. The server sends no name or tag on any row, the page
  paints none an older server still sends, and the player's own row says
  "You", as the review's kill feed carries no name (`test:trackerroutes`,
  `test:surfaces`).
- **The MVP badge and the roster are each player's own** (8.5.0, `coach.js
  matchDetail`, `mvpKey`). Both come from one match detail call, cached
  forever, and the cache was keyed by the match alone: a duo partner who also
  uses Occlara was handed the first requester's badge and roster, their row
  marked as the player's. It is keyed `matchId|name#tag` in lower case
  (`test:trackerroutes`).
- **Riot's death check names the killer by agent** (`coach.js
  killerAgentOf`, `/match-deaths`). It answered the killer's full Riot ID,
  and the AI log painted it on every death Riot confirmed, a name its owner
  may have hidden as much as a teammate's. It is the killer's agent from the
  match's roster now, as in the review's facts (`riot-rounds.js
  killerAgent`), and a killer the roster does not have is none, never a name,
  which the AI log's mark says as no killer ("Round 2. Confirmed by Riot."),
  where it read "killed by null". And the app keeps a killer only as an agent
  the game data knows (`valorant-verify.js agentName`, where the check enters
  it in `death-reconcile.js`), so a server from before, which still sends the
  Riot ID or a puuid, has no name painted either, only no killer; the server
  deploys first all the same, or the log names no killer at all
  (`test:trackerroutes`, `test:deathreconcile`, `test:surfaces`).
- **The four Overview scores are sums over the tracker profile**
  (`trackerCategoryScores`: Positioning is 140 less a hundred times the deaths
  a round), no recorded match goes into them, and their arrows compare the
  profile with a copy of itself. They went to Ask Coach as "their
  coached-session trend" with "Target the weakest or falling category when
  giving drills": for a player dying 0.78 times a round, drills on
  positioning. The app sends them no more, the server ignores them from an
  older install, and the profile's own numbers are in the prompt already
  (`test:serverguards`). The 0 to 100 match rating on each row still waits for
  the Stats revamp; the share card built on it was retired in 8.6 (it printed
  the Riot ID, stretched the mark and drew two gradients). A Verdict card with
  its own share image is built on the `verdict` branch and not yet wired into
  the review page.
