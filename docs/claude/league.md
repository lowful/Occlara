# League records in silence and coaches afterwards

Moved out of CLAUDE.md word for word, nothing reworded or dropped (CLAUDE.md as of commit cc1f880, 8.5.0, lines 3102 to 3174). Sections here: "League records in silence and coaches afterwards". "Above" and "below" in the text name sections that may now sit in another file under docs/claude/: grep the section's title there to find it. The table in CLAUDE.md says which file to read for which work.

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
src/main/services/lol-recorder.js   polls 127.0.0.1:2999, emits NOTHING to the player, notes the game's clock
src/shared/lol-review.js            turns the record into a review, deterministically
src/renderer/review/                the post-game surface, opens only when a game ends
```

`finishLolGame()` in `src/main/index.js` grades, appends to `lolHistory` capped
at `BASELINE_GAMES`, and fires `PUSH_LOL_REVIEW`. Since 8.3 the game is also
recorded on the PC, as a Valorant match is (display capture alone; the
session's screen is never read, and the recording shows nothing), and its
review's "Your deaths" plays the clip of each death, found in the recording by
the game's own clock (`clipLolDeaths`, "The match is recorded on the PC").

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

**The game picker shows the games' own logos: the player's decision of
2026-10-10.** Until 8.2.1 its buttons carried icons Occlara drew, because
Riot's IP policy says a project "may not use any of our logos or trademarks"
without a written licence. The player was told that, with Riot's policy text,
and chose the logos. The sources are `assets/games/valorant.svg` and
`lol.svg`, each one filled path on a 24 unit box, the monochrome paths Simple
Icons publishes. `src/renderer/shared/game-logos.js` draws the same paths
inline so they take `currentColor` and keep the picker's colours, and
`test:surfaces` fails if a path there ever differs from its file, or if a logo
is sized apart from the other. Each button still carries the game's full name
as its title and accessible name, because a symbol alone is a guess, and the
recording lock. Hover lights the game not picked and never the picked one: the
hover rule outranked the pressed one, and its `--text` over the pressed
button's `--text` ground drew that logo white on white (`test:surfaces`
cascades the rules). Rank marks stay ours (above): that decision was about the
picker alone.
