# Occlara

A Valorant AI coach. An Electron client watches the screen, sends frames to a
Node/Express backend, and turns what it saw into a round by round review that
opens when the match ends. It used to show tips on top of the game in real
time, and that is closed: see "Live tips are closed" below before touching
anything that reaches the screen during a match.

The client never reads game memory, never touches game files, and never
automates input. It captures the display the same way OBS does. That property
is the whole product, so nothing should ever be added that breaks it.

## Live tips are closed, and the review is the product

`liveTipsClosed: true` on Valorant in `src/shared/games.js` is **the one switch**.
Riot's VALORANT developer policy lists as unapproved "in-game apps and overlays
that include any real-time data that would improve a player's performance
immediately by altering player behavior (i.e. 'go here now'), vs altering it
upon reflection, learning and coaching the player game over game". A player got
a one week ban with the app flagged as third party. The anti-cheat axis (screen
capture like OBS) was always clean; the written policy was not.

While the switch is on, **nothing the coach writes reaches any surface during a
match**, and each of these is a separate leak that was closed on purpose:

- `pushTip` holds `ai` and `library` tips in `state.heldTips`, never in
  `state.tips`, because PUSH_STATE carries `state.tips` to every window.
- The overlay window is **not created** (`syncOverlay`), not merely hidden. The
  voice coach speaks whatever the overlay receives, so it goes with it.
- The AI log seals the live session mid match (`liveLogSealed`), frame chat
  refuses it, and Ask Coach gets no match memory. Each is a window a player can
  keep open on a second monitor.
- Ctrl+Shift+E does nothing mid match and opens the last review after it.
  Force tip is a no-op.

Settings and onboarding **grey the live controls out** with the pill "Live Tips
are temporarily closed" rather than deleting them, so the player's setup
survives. The pill is a SIBLING of the heading, never inside it: i18n-apply sets
`textContent` on translated headings and silently deleted it.

Do not flip the switch back without Riot's written approval of the product.

### How the match becomes a review

```
src/shared/valorant-rounds.js   the round ledger, fed the engine's GUARDED context
src/shared/match-end.js         when the match is over
src/shared/valorant-review.js   the computed review: patterns, facts, the result
server/services/match-review.js the model's half: summary, a why per round, focus
src/renderer/review/            one window for every game, branched on review.kind
```

**The score lags the round in both directions**, measured on a real 24 round
match in `scripts/fixtures/`: a buy phase starts while the score still reads the
old number, and the round end banner prints the next score while the player is
still spectating. The ledger advances on a buy phase after mid round play, and
files a death before the new round's first buy back into the round that ended.
"Play" needs a mid round clock, because the banner is an active phase frame
with 0:01 on it, and counting it cascaded every later round by one.

**A match ends** on a score no mode can continue from, confirmed by a second
read or by the next frame being a menu, or on most of a minute of menus after
three rounds. 13 to 12 is deliberately not final: unrated ends there and
competitive does not. Too early is the expensive direction, because it opens a
window over a round in progress.

**What the review may claim.** No "survived" line (the ledger cannot know it),
no death timing to the second (a bucket, since frames are ten seconds apart), no
result unless a score end or Riot's verified record says so, a spawn is never a
death spot, and a pattern must clear its stated floor. The window opens at once
and repaints when Riot publishes the scoreboard, which is 90 seconds to four
minutes later.

**Variant C won the bench** (`npm run bench:review`, live, spends money) by
making fewer unsupported claims than B; the numbers are in `match-review.js`.
The model's reply is RAW text from `textInfer(..., { json: true })`, sanitized
per field after parsing, because `sanitize()` collapses newlines and the first
bench got every labelled line back as one. Spelled round numbers are turned into
digits in code (`roundDigits`), because the prompt asking was ignored about half
the time.

`npm run test:valorantreview` replays both real fixtures through all of it.

### Riot's record overrides the screen, and the read is written again

**The screen is wrong in ways only Riot can show.** Checked against Riot's
record of the real Abyss fixture (`scripts/fixtures/riot-abyss-13-11.json`): the
screen read 22 deaths where Riot has 21 (round 17 invented from one post-plant
spectator frame), put 6 deaths in the first 30 seconds where Riot puts 16, and
5 of the coach's own death reviews named the wrong killer. The timing error is
the spectator trap again: after a death the HUD shows a teammate alive at 100
health, so the coach thinks the player lived another half minute.

So when `fetchCoachedMatch` links the match, `withRiot()` in `src/main/index.js`
fetches `/api/coach/match-rounds` (parsed in `server/services/riot-rounds.js`)
and `src/shared/valorant-verify.js` reconciles: deaths, the second, the killer
and weapon, first death, first kill, kills and round results are Riot's; the
screen keeps only the location, the ult icon and what the coach said. Reads Riot
contradicts are dropped. The corrected review repaints at once with the summary
marked as updating, then the model writes it again from Riot's facts, including
Riot's scoreboard line, because a 31/21 match MVP reviewed from its deaths alone
reads as a struggling player.

Three things the model got wrong on the verified prompt, each now fixed in code
rather than asked for: it explained rounds 2 to 11 of 24 (`teachable()` picks
the rounds, one per third first), it named the wrong killer (`namesKiller()`
drops that line), and it merged two patterns into one wrong count (a summary
sentence carrying "N of M" is dropped). The `sides` pattern names the stronger
side in words, because given two fractions the model inverted them.

**Riot counts rounds from 0**, and `time_in_round_in_ms` runs from the barriers
dropping. The Riot ID in config is the one looked up, so a match played on
another account never links, which is correct.

## Layout

```
src/main/          Electron main process (Node). Windows, services, IPC handlers.
src/main/windows/  One file per surface, plus registry.js
src/main/services/ coaching-engine.js is the client brain
src/preload/       One preload per surface, contextBridge only
src/renderer/      The UI. Vanilla HTML + CSS + JS, no framework, no build step
src/shared/        channels.js, config.js, valorant-data.generated.json
server/            Express backend (deployed on Railway)
server/routes/     coach.js holds the prompt and the coaching routes
scripts/           sync-valorant-data.js, sync-patch-notes.js
```

Entry point is `src/main/index.js`. Version lives in `package.json` and is
shown at the bottom of Settings.

```
npm start              run the app
npm run dev            run with devtools and dev userData
npm run sync:valorant  regenerate valorant-data.generated.json
npm run release        build and publish a Windows installer
```

## The UI

Twelve renderer surfaces, each a plain folder with `index.html`, a `.css` and
usually a `.js`:

```
overlay/     the in-game tip cards. The surface players actually see
panel/       the main control window
dock/        the compact always-on-top dock
onboarding/  multi-page first-run flow. The app is gated behind completing it
settings/    all preferences, version string at the bottom
stats/       rank, win rate, match history
history/     past coaching sessions
ailog/       AI decision log: screenshots, STATE, and the tip that was sent
chat/        chat with the AI about one logged frame
weekly/      weekly report popup
activation/  license key entry
audio/       hidden surface, audio capture only. Not a visual surface
```

### Rules for UI work

**There is no build step and no framework.** No React, no JSX, no bundler, no
TypeScript. Plain DOM APIs and plain CSS. Do not introduce a framework or a
build pipeline to add a component.

**Design tokens live in `src/renderer/shared/theme.css`** and are imported by
every surface. Use the variables, do not hardcode colours, radii, easings or
durations:

- Brand: `--red` `#FF4655`, `--cyan` `#FFFFFF`, `--bg` `#08090A`
  The token NAMES are historical. `--cyan` is white and, under
  `[data-game="rivals"]`, `--red` is gold. They mean "primary accent" and
  "secondary accent". Do not rename them: they are consumed 225 times across 15
  files and `npm run check:palette` exists because that edit has gone wrong.
- Text: `--text`, `--text-dim`, `--text-mute`
- Glass: `--glass-fill`, `--glass-border`, `--glass-blur`
- Geometry: `--r-sm` `--r-md` `--r-lg`
- Motion: `--ease`, `--ease-expo`, `--ease-spring`, `--t-fast` `--t-med` `--t-slow`

`src/renderer/shared/ui.css` holds the shared component styles. If two surfaces
need the same thing, it belongs there, not copied into both.

**Geist is bundled locally** in `assets/fonts` so the app renders offline, with
Geist Mono for columns of digits. It ships weights 400, 500, 600, 700 and 800
only. Do not reference a weight outside that set or a webfont URL: the renderer
CSP forbids the URL, and a missing weight silently falls back to Segoe UI, which
changes the shape of the whole interface without erroring.

**Tip card styles are user-configurable.** `tipStyle` in `src/shared/config.js`
is one of `glass | solid | minimal | neon`, and `tipOpacity` runs 0.25 to 1.
The overlay applies them as `data-style` and a `--tip-alpha` variable on
`.tips`. Any new style needs a matching `.tips[data-style="..."]` block in
`overlay/overlay.css` and an option in Settings and onboarding, or the three
will drift out of sync.

Three settled decisions that keep getting reintroduced by accident:

- **No decorative gradients anywhere.** Solid fills and hairline borders. The
  two that remain are functional and deliberate: the loading shimmer in
  `ui.css` and `stats.css`, where the gradient IS the animation. The splash
  vignette used to be the third. It was a radial ellipse fading to fully
  transparent, masking the edge of a transparent window, and it also ate the
  corners: over a light desktop the centre measured rgb(11,12,12) while all four
  corners measured exactly the desktop behind them, so a square window rendered
  as an oval blob. `.stage` is now a solid `--bg` card with an 18px radius and a
  10px gutter, the same shape as every other surface.
- **The coaching button stays red.** It is the one control a player must find
  without looking, and the only place the accent earns full saturation in an
  otherwise white-on-black interface.
- **No left accent bar on tip cards.** Accent is carried by the meta dot and
  label colour, via `--tip-accent`.

Transparent or low-opacity tip styles need an outline and a drop shadow, or
they become unreadable against a bright part of the game.

**Every surface must stay visually synchronised.** A change to a shared
component, a token, or a tip style is not done until Settings, onboarding and
the overlay all agree.

## IPC

`src/shared/channels.js` is the single source of truth for every channel name.
It is imported by main, by every preload, and indirectly by every renderer.

**Never hand-type a channel string anywhere else.** The previous client's worst
bug was main and preload drifting to different names, after which the overlay
silently stopped receiving events with no error. Add the constant to
`channels.js` first, then use it on both sides.

Renderers have no Node access. Everything crosses through a preload via
`contextBridge`.

## The coaching pipeline

The client captures a frame, sends it to `POST /api/coach/analyze`, and the
model replies in a fixed two-line shape:

```
<the tip, one sentence>
STATE: {"side":...,"phase":...,"round":...,"hp":...,"alive":...,"map":...,...}
```

Line 1 is shown to the player. Line 2 is parsed by `mapState()` in
`server/routes/coach.js` and fed back as context on the next frame. **If that
format changes, the feedback loop dies silently**: tips keep appearing, they
just stop being informed by anything.

The model is whatever `AI_VISION_MODEL` and `AI_TEXT_MODEL` say on Railway,
not what the code says. The code default is `google/gemini-3-flash-preview`;
Railway was last seen set to `qwen/qwen3.7-flash`, a reasoning model, which is
why every text path retries on an empty reply. There is a credits breaker: on a 402 the server reports it honestly
rather than pretending to be down, and the client backs off for three minutes.

## Do not simplify the guards

`src/main/services/coaching-engine.js` contains deterministic checks that
**deliberately override the model**. Each one exists because of a specific,
reproduced failure, and each one looks like removable defensive cruft until you
know the story. Do not refactor these away.

- **Map lock with correction** (`applyMapRead`). The model repeatedly insisted
  the player was on Ascent while they were on Breeze. Two agreeing reads
  acquire the lock, two agreeing contradictions correct it.
- **Map fingerprint from printed labels** (`applyLocationLabel`,
  `mapFromLabels`). Valorant prints the location name on screen. Accumulated
  labels identify the map far more reliably than the model's guess, and once
  `mapConfirmedByLabels` is true the model can no longer change it.
- **Callout gate.** A tip naming a callout that does not exist on the confirmed
  map is rejected, so the coach cannot send the player to a location from a
  different map.
- **Scoreboard continuity** (`scoreboardChallenge`). Scores never move
  backwards, and a forward jump needs two agreeing reads before it is accepted.
- **HP beats death.** A death is only registered when health is genuinely
  absent and the tell is unambiguous. The model kept announcing deaths that had
  not happened.
- **Death silence** (`DEATH_TIPS_MAX`, `isSpectating`). At most two review tips
  after dying, then nothing until the next buy phase.
- **Play variety** (`PLAY_PATTERNS`). Stops the coach repeating the same stock
  advice, for example telling the player to hold a crossfire every round.
- **Ability gate.** Blocks commands to use abilities the player's agent does
  not have.
- **Reject reasons** (`noteReject`). Records why a tip was dropped so the
  diagnostics payload can explain silence.

The governing principle: **the coach reports what is actually on screen and
never infers.** When code and model disagree, code wins.

### Whose HUD is it, and why death reviews used to vanish

Valorant puts you on a teammate's camera the instant you die, so the health, the
weapon and the abilities in that corner become THEIRS. Every guard reasoning "a
readable health number means alive" is then reading somebody else's health.

A real graded session: the player's first death was rejected twice with "said the
player was dead while they were alive at 100 HP". The frames read `own HP 100 and
Ghost`, then `own HP 100 and Bandit`, then `own HP 19 and **Sova** abilities`,
while the player was Iso. One bug, four consequences: the death never registered,
so `lastDeathAt` was never set, so `isSpectating()` stayed false, so `death: true`
was never set, so the spectator merge guard never engaged and a teammate's Ghost,
Bandit and Sword were logged as the player's own weapon.

`src/shared/spectate-tells.js` is the fix. **A HUD that changes whose it is mid
round is spectating, whatever the health says.** One strong signal (a named
spectator screen, or another agent's abilities called "own") or two weak ones (a
weapon change, health rising) decides it. A buy phase and a return from
spectating are boundaries, because `roundNumber` was missing on a third of the
real frames. `server/routes/coach.js` mirrors the vocabulary by hand, since
`check:server` forbids reaching into `src/`, and `npm run test:spectate` asserts
both copies agree on the real frames.

### Death reviews skip the repetition gates, and only those

Of 26 death reviews in that session, **24 were dropped**. Twenty-two of those
were repetition gates, not truth gates. A review of a death is ABOUT a specific
moment, so it is supposed to resemble the last one: same callout, same mistake,
same words.

`isDeath` is now decided in `processAIResponse` **above** the gates rather than
forty lines below them, and skips `isSimilarToRecent`, the topic cooldown,
`PLAY_PATTERNS` and `recentAbilities`. Every truth gate still applies, and
`DEATH_TIPS_MAX` stays at 2. Two related fixes: the dead-player action gate was
eating past-tense reviews of the corpse it was written to protect, and library
filler emitted on a reject path was re-arming the very play gate that fired.

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
src/main/services/lol-recorder.js   polls 127.0.0.1:2999, emits NOTHING to the player
src/shared/lol-review.js            turns the record into a review, deterministically
src/renderer/review/                the post-game surface, opens only when a game ends
```

`finishLolGame()` in `src/main/index.js` grades, appends to `lolHistory` capped
at `BASELINE_GAMES`, and fires `PUSH_LOL_REVIEW`.

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

## Marvel Rivals reads TEXT, never art

The whole Rivals design turns on one measured fact, and it is easy to undo by
accident because the failing approach looks more capable.

**Naming heroes from scoreboard portraits does not work.** Graded against a real
Season 10 frame with a hand written answer key, six runs scored 17 to 42%
precision against a 90% gate, and answered Mephisto, Doctor Doom and Lightning
Ace, two of whom are not in the game and one of whom is not a Marvel character.
Six prompt revisions moved nothing. A 3x upscaled crop of the portrait column
scored WORSE than the full frame, so it is not a pixel count problem.

**Reading the hero name that hero select PRINTS works perfectly.** Same model,
same day, exact both times. This is text recognition versus art recognition, and
it is the same distinction the Valorant map fingerprint already turns on, where
the printed location label outranks the model's opinion about the picture.

So:

```
hero select    the hero name is printed, so the coach learns YOUR hero here
scoreboard     printed text only: result, map, mode, K/D/A, damage, healing,
               accuracy, role icons. Never hero identity
```

`features.heroCapture` is **separate from `features.draft`** on purpose. Draft
advice is off because the teammate ROLE COUNT reads wrong; the engine still asks
the draft question for the name, and `vet()` returns empty so no draft sentence
reaches a player. Do not merge those flags.

`confirmMine()` in `server/routes/rivals.js` checks the printed name against the
closed roster, so an OCR slip arrives absent rather than wrong. The engine holds
the hero for the match and **forgets it once a scoreboard is reviewed**, or the
next match opens its review naming the last match's hero.

What the hero read bought is `src/shared/rivals-abilities.js`, the Rivals
equivalent of `validateTipForAgent`: no tip may name an ability the player's
hero does not have. It permits one whose OWNER is named in the same sentence,
because "The Thing has Yancy Street Charge, which turns your dash off" is the
counter table's best output.

What it did **not** buy is the switch call. `switchAdvice()` needs the ENEMY
list, which comes off portraits, which is the read that failed. Counters stay
unwired. `rivals-meta.js` and `rivals-moments.js` are also unwired and their
headers say exactly what is missing; read those before calling either.

### The Rivals review is computed, like the League one

`src/shared/rivals-review.js`, and the reason is `lol-review.js`'s reason word
for word: a review is where a confident wrong sentence costs most. The model is
not involved. It makes exactly one judgement, the healing check, because that
data is not close: across twelve real rows Strategists healed 13,068 to 33,213
and everybody else 0 to 567. **Damage blocked gets no such rule**, because those
rows overlap, and any threshold drawn through an overlap is a coin flip wearing
a number.

**It compares you against yourself, and the scoping is the whole design.**
`rivalsHistory` keeps the last 10 matches and a baseline needs 3, matching the
League numbers. A global average would be arithmetic that means nothing, so:

- **role scoped** for kills, deaths, assists, damage, blocked and healing. A
  Strategist's kills and a Duelist's kills are different quantities, and a
  Vanguard dies more than a Strategist by design. Comparing across roles
  manufactures a trend out of the player switching role.
- **hero scoped** for accuracy alone, because a projectile hero is naturally
  lower than a hitscan one at identical skill. `fundamentals()` already says "if
  you cannot tell which the hero is, do not coach the accuracy", and comparing
  Hela's accuracy to Jeff's is that mistake with extra steps.

`lowerIsBetter` on deaths is not cosmetic: without it the review congratulates a
player for dying more than usual. A column that is zero and always has been is
dropped, but a zero against a real average is the most informative row there is
and must survive that filter.

The history entry is built from the REVIEW, not the raw frame, so a hero the
review refused to believe never enters the baseline as that hero either.

Two things that look like details:

- **Heroes switch mid match.** A hero read at draft is the hero they STARTED on.
  The contradiction is detectable in one direction only: a non-Strategist name
  against a healing column that proves a Strategist means they switched, and the
  name is dropped.
- **The refusals are rendered, not just observed.** A player who can see the
  enemy team on their own screen will otherwise assume the coach saw it too and
  chose to stay quiet.

**There is no mode table and that is deliberate.** marvelrivals.com publishes no
modes page, `/gamemodes/` and `/gameinfo/` both 404, so a list would be written
from memory and presented as fact. The mode is printed text, the read that
works, and the review only displays it. Only its SHAPE is checked: a mode is a
short label, so the objective line is dropped while a mode nobody here has heard
of comes through.

### The meta comes from the game's own balance post

`npm run sync:rivalsbalance` fetches `marvelrivals.com/balancepost/`, which is
linked from `/news/`. First party, no key. It is a better source than a tier
list because it is dated and quotable: "Reduce Nastrond Crow Form damage from 70
to 60, published 2026/09/08" is a fact the player can check, where "Hela is S
tier" is a contested opinion that is stale in a month.

**The coach quotes it and never judges it.** It does not say buffed or nerfed,
because deciding which needs inference and the inference is unsafe: "reduce
cooldown" is a buff, "reduce damage" is a nerf, and the verb is identical.
NetEase writes a one line characterisation per hero, so there is a sourced
sentence and nothing to infer.

Two shapes that bite, both recorded in docs/AI-CONTEXT.md: the GLOBAL CHANGES
section carries **no bullet dashes**, and **Deadpool has three sections** because
he is tri-role, so a one-to-one map silently drops two of them.

`balanceBlock()` and `metaBlock()` are added to the prompt **separately**, because
one is fetched and one is hand written and they go stale on different days.
Nesting the sourced one inside the hand written one meant it vanished exactly
when it became the only meta knowledge left.

```
npm run sync:rivals          roster, health and abilities from the game's own site
npm run sync:rivalsbalance   the official balance post: version, date, what changed
npm run check:rivalsknowledge every hero and ability named is one the game has
npm run check:rivalsreview    boots the app, paints a Rivals review, then a League
                              one into the same window
npm run check:clientboot      src/ never requires from server/, which is not shipped
```

That last one exists because `package.json` ships `src/`, `assets/`,
`node_modules/` and `package.json`, and **not `server/`**. A require reaching
across resolves in the repo, passes every test, and throws MODULE_NOT_FOUND on a
real install. It is the mirror of `check:server`, and `sync:rivals` writes a
second smaller copy into `src/shared` so the shortcut is never needed.

## One game's data is never shown under another game's name

The stats dashboard is Valorant shaped end to end: a Valorant rank ladder, agent
tiles, and a competitive/unrated split only Valorant has. It had no concept of
which game it was for, so selecting League returned all of it unchanged.

`getStatsDashboard` now reads `hasFeature(game, 'stats')` and a game without a
stats source returns empty with `statsSupported: false`, which the renderer
paints as a panel naming the game. Rivals has no official API at all, and League
needs a Riot production key the app does not have. Both say `stats: false` in
`src/shared/games.js` **explicitly**, rather than relying on `hasFeature`
returning false by absence.

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

## The Pro Playbook, and how to grow it

`server/services/knowledge.js` holds the playbook: tagged notes scored against
the live situation by `retrieve()`, which returns **only eight** and injects
them at `${habitsBlock}`. `playbookMode()` is pinned to `hybrid`, so both the
static habits and the retrieved notes go in.

**New knowledge goes in `server/data/playbook.json`**, the growth hook the
module has always documented. It merges at startup, `check:playbook` covers it
automatically through `knowledge.all()`, and extra fields such as `source` pass
through untouched. The 40 notes there are from Bonkar (Malkolm Rench, NRG head
coach, VCT Champions 2025) VOD reviews, and **imported notes must carry
`source.coach`** or the checker fails them.

**Tagging decides whether a note exists at all.** Scoring is `agents +4`,
`weapons +4`, `maps +3`, `situations +2` each, `side/phase/roles +2`, and only
eight notes survive. Measured: a role-tagged note loses to an agent-tagged one
every time for a confirmed agent, so a Jett got **zero** of the imported notes
until the load-bearing role notes were given their role's agent list too. An
untagged note competes with 357 others and loses.

**A typo in a tag is invisible.** `retrieve()` excludes rather than warns, so
`phase: 'postpant'` makes a note permanently unreachable with no error. That is
what the tag vocabulary check exists for, and the vocabulary list is itself
checked against the flags `situationOf` actually produces, in both directions.

**Weapon numbers are computed.** `sync:valorant` pulls the damage table (19
weapons, 13 with falloff), and any note declaring `source.numbers` has every
number in it verified against that weapon's real ranges. A Riot rebalance fails
the build rather than leaving the coach confidently wrong. Notes that give
tactical distances, "play inside 5 meters", are NOT checked, because that is
advice and not a claim about the table.

A contradiction advisory was built here and **removed after measuring**: both
alarms it raised were false, "send it" matching Wingman and Owl Drone rather
than aggression. What would actually work is recorded in the file.

### Advanced tips is a BIAS, never a replacement

`advancedTips` in config, off by default, surfaced in Settings. A note carries
`tier: 'core' | 'advanced'`, core being the default so the 357 hand written ones
are untouched. With the toggle on the mix goes from 34% to 75% advanced,
measured across 12 real logged contexts plus 5 synthetic.

**A floor of core notes always survives, and on a deathstreak core takes the
majority back.** That is the design, not a hedge: advanced advice assumes the
fundamentals are in place, and a player dying on repeat needs to stop walking
into open ground rather than a damage breakpoint. The override is deliberately
not configurable, because someone who turned advanced mode on is exactly the
person who will not turn it off while losing.

It is a **reserve, not a score bonus**. A bonus was the first design and does
not do what it says: with `agents +4` in play, a bonus big enough to guarantee
advanced notes surface drowns the specificity that makes any note relevant.

**A weapon note must never name the weapon it is tagged for.** The prompt says
USE THE WEAPON TO SHAPE THE PLAY BUT DO NOT NAME IT, since the player can see
their own gun. All 17 shipped naming it, so the coach held a fact it was
forbidden to say, and a live A/B showed it using none of them. They give a
distance to play now, which is better advice anyway. Naming a DIFFERENT gun is
allowed and is often the point.

`npm run bench:advanced` runs the live A/B on real frames, toggle on against
off. It is a bench, not a check: it spends money and only a human can grade
whether the tip got better. `npm run test:advancedtips` measures the retrieval
shift offline, which is the half that can be checked.

**The first A/B tested the easy half.** Measured on real contexts alone, all
twelve came back "no agent", so `agents` notes, the highest scoring tag at +4,
were never exercised. Always run both sets.

### The coach can see your ultimate, and only that

STATE carries `ult`, "ready" or "charging" or null. Before it, the coach had **no
ability state whatsoever**: the prompt told the model to read the ability icons
and never asked it to report what it saw, so every ultimate tip was a guess.

`ULT_COMMAND` in `coaching-engine.js` drops a tip telling the player to press an
ultimate the HUD says is charging. **Only a confirmed "charging" blocks.** The
icon is small and often obscured so null is the common read, and a gate firing
on null would silence every ultimate tip rather than the wrong ones.
`playerUlt` is in `SPECTATOR_OWNED`, because after a death that icon belongs to
the teammate being watched.

Basic abilities still have no state. `ABILITY_COMMAND` remains a blanket ban on
commanding a mobility ability, which is the honest position while the coach
cannot see cooldowns.

### Ctrl+Shift+E explains the last tip, and refuses when that is unsafe

**With live tips closed this whole path is bypassed**: the hotkey opens the
last review after a match and does nothing during one. What follows describes
the live mode, kept for the day it is approved.

The live tip is one sentence because it is read mid fight. `explainLastTip()`
unpacks the same call on the frame it was made about, through
`/api/coach/frame-chat`, which already answers at length with no tip-length gate.
The live tip contract is untouched.

`src/shared/explain-gate.js` allows it **only in a buy phase or while dead**,
and **refuses on unknown**, which inverts the usual rule here. Elsewhere an
unreadable field means say nothing and carry on; here the cost is asymmetric, so
anything not provably safe declines and says when to try again. Dead is
`playerAlive === false || phase === 'dead'`, matching `isSpectating()`: demanding
both would refuse a dead player on exactly the ambiguous frames right after a
death.

It picks the last frame that **produced a shown tip**, not the last frame, since
the guards reject the majority. It renders through the existing review card and
needs `white-space: pre-wrap`, because `textContent` drops blank lines and the
first version rendered three paragraphs as one unbroken wall.

**The post-match review may reason across the observed facts**, and is the only
place that may. Its fourth sentence names a repeat, "three of four deaths on the
same angle", and is conditional: the prompt says to stop at three sentences when
the facts are thin. The CRITICAL GROUNDING RULE above it is unchanged and must
stay: tips prove what was ADVISED, never what the player did.

**No test grades whether a tip is insightful.** `review-log.js` says so in as
many words. `verify:ai` is the gate for any prompt or STATE change and it spends
real money, so it is a manual pre-flight, never CI.

## A refund must take the licence away

The Stripe webhook handled four events and none of them was a refund. That left
a hole with no floor under it: a LIFETIME purchase writes `expires_at: null` and
`status: 'active'`, has no subscription to cancel, and `validateKey` asks only
for an active status and an unexpired date. **Buy lifetime, refund it, keep the
product forever.** Nothing fired, nothing logged, nothing expired.

`charge.refunded` and `charge.dispute.created` now revoke, writing both the
status and `expires_at: now`. Two independent reasons for the same answer, so
the licence dies even if `validateKey` is ever relaxed about status.

**A PARTIAL refund must not revoke.** `charge.refunded` fires for both, and a
goodwill partial refund is not a reason to take the product away. The amounts
are compared as well as the flag.

**The customer is a FALLBACK and only when unambiguous.** Licences store
`stripe_session_id` and `stripe_customer_id`, never the payment intent, so the
charge is resolved through the checkout session that created it. When that
fails, the customer is used only if they have exactly ONE active licence: a
repeat buyer has several, and revoking all of them over one refund is a worse
bug than the one this fixes. It logs loudly and refuses rather than guessing.

**THE STRIPE DASHBOARD MUST SUBSCRIBE TO BOTH EVENTS.** The handler cannot run
on an event Stripe never sends, and the endpoint was created listing four. This
is the one part of the fix that is not in this repo.

`npm run test:refundrevoke` runs the real handler against a fake Stripe and a
fake Supabase, covering the full refund, the partial, the chargeback, the
fallback and its safety rail. Proved by disabling the handler and by making
partial refunds revoke.

## Conventions

**No em dashes or en dashes** anywhere, in tips, in UI copy, in docs. Use
commas. This is a hard rule.

**Never write a regex through a shell heredoc.** `\b` becomes a literal
backspace byte, the file still parses, `node --check` still passes, and the
regex silently matches nothing. This has bitten twice, once killing every
pattern in `PLAY_PATTERNS`. Edit regexes with a file-editing tool, and always
assert a new regex matches a known-positive string.

**Secrets come from the environment.** `.env` and `server/.env` are gitignored
and this repo is public. Never commit a key.

`src/shared/valorant-data.generated.json` is generated by
`npm run sync:valorant` from valorant-api.com. Do not hand-edit it.

**The name is Occlara; two identifiers are still ghostcoach.** `appId`
(`com.ghostcoach.app2`) and the `GhostCoach-releases` repo deliberately keep the
old name. `appId` is what Windows and electron-updater match an install on, and
the releases URL is compiled into every client already in the field, so moving
either orphans every existing user: no updates, no licence, no history. A brand
is what users see; an identity is what the software is.

The Railway host `ghostcoach-production.up.railway.app` is in the same category
and is the worst of the three to move, because every installed client has it
baked into `src/shared/config.js`. Renaming the Railway service breaks coaching
and licence checks for everyone on an older build, instantly. The safe path is a
custom domain pointed at the same service, kept alongside the old hostname
forever, never a rename.

**The userData folder DID move**, from `%APPDATA%\GhostCoach 2.0` to
`%APPDATA%\Occlara`, because unlike the three above it can be moved together
with its contents. `src/main/services/profile-migration.js` does it once on
launch and `npm run test:profilemigration` covers it, including every failure
path. The rule there is never lose data: any failure keeps using the old folder
and the app carries on. Note it necessarily runs before the single instance
lock, which lives inside userData, and read the comment before reordering
anything.

`artifactName` was on that list and is not any more: it moved to
`Occlara Setup.${ext}` in 4.7.0. It was never actually load-bearing.
electron-updater resolves the installer through `latest.yml`, which is
regenerated every build and names whatever the artifact is currently called, and
nothing in `src/` hard-codes an installer filename. Verify that before assuming
any other name here is safe to move: the test is whether something outside this
repo has the string baked in.

**The logo is an aperture, and it exists in four places.** `assets/logo-mark.svg`
is the source; `splash/index.html` and `dock/index.html` inline their own copies
so they can animate and inherit `currentColor`; `scripts/generate-icon.js` draws
it mathematically for the `.ico` and `.png`. Change one and change all of them.
The SVG carries an explicit `color="#FFFFFF"` because an external SVG loaded
through an `<img>` tag is its own document, so `currentColor` resolves to black
there and the mark renders invisible on the dark ground.

**Look at UI changes, do not only compile them.**
`npx electron scripts/shot-surface.js panel settings` writes real screenshots to
`dist-surface-shots/`. A dropped colour declaration, an unshipped font weight and
a stretched logo all pass every automated check in this repo and are obvious in a
picture.

## Releases

Built with electron-builder and updated via electron-updater. Installers are
published to the separate `lowful/GhostCoach-releases` repo, which keeps the old
name on purpose: electron-updater reads it, and the code repo being renamed does
not make it safe to rename. The code repo itself is `lowful/Occlara`, renamed
from `lowful/GhostCoach` on 2026-08-30.

The main repo's single release (id 296500148) carries the **public download**,
and `scripts/publish-download.js` refreshes it as the second half of
`npm run release`. It publishes the same bytes under **two** names:

- `Occlara-Setup.exe`, which every new link should use
- `GhostCoach.2.0.Setup.exe`, which must never be removed

The old name stays because GitHub bakes the filename into the download URL and
offers no redirect for it, so every link already in the wild, in Discord, in
someone's bookmarks, dies the moment it goes. This is about existing links, not
about auto-update, which reads `latest.yml` and does not care what the file is
called.

## The website

The marketing site is a **separate private repo**, `lowful/ghostcoach-9a45ac05`.
It is Vite, React, TypeScript, Tailwind and shadcn, and it syncs bidirectionally
with Lovable from `main`. None of this repo's conventions apply there, and none
of its files live here.
