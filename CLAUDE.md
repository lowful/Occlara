# Occlara

A post-match AI coach for Valorant and League of Legends. An Electron client
reads the game while it is played, shows NOTHING during the match, and when it
ends opens a graded review: a score out of 100 with four categories and their
evidence, the player's repeated mistakes with a fix for each, what went well,
and what was missed. Every review is kept in the match library, which also
counts what keeps repeating across matches.

The client never reads game memory, never touches game files, and never
automates input. It captures the display the same way OBS does. That property
is the whole product, so nothing should ever be added that breaks it.

This is the short core that always loads. The deep detail of each area lives in
`docs/claude/`, one file per area, and is read on demand (table below). Put new
detail there, not here, so this file stays short.

## Nothing that coaches reaches the screen during a match, in any game

Live tips, the overlay window and the voice coach were removed in 8.0, not
paused: do not add any of it back, and do not add anything else that tells a
player what to do while they play. Riot's VALORANT policy lists real-time data
that changes behaviour immediately as unapproved, League's is stricter still,
and a player got a one week ban. Mid match the main window shows only a
Recording screen with its pages locked (`syncSeal`); the AI log, Ask Coach, a
review's eye, Ctrl+Shift+E, the corner mark and the update restart question
are sealed or wait; the notice line never says anything about the match.

**The one exception, on purpose (Progress v3, the owner's choice):** in a
Valorant match the Recording screen shows the live status, the four facts the
player's own HUD already shows, map, agent, score and round, plus the round
tape the score draws, each behind its Settings switch (`liveMap`,
`liveAgent`, `liveScore`, `liveRound`). Main decides it (`index.js liveView`,
`PUSH_LIVE`) and sends nothing else of the reader's context: never HP,
positions, economy, the enemy, a read, a tip, the read cadence or anything of
a review. Never widen it. Every sealed surface, the exception and why:
`docs/claude/screen-silence.md`.

**The second exception, on purpose (the live rating, the owner's choice,
2026-11-26):** OFF by default; with the `liveRating` switch on (in Settings or
beside Start on Home, each past the same plain warning and a confirm) the Recording screen also shows the match rating,
its last move with the engine's label of what happened and a small line,
marked "Live, provisional", and with `liveRatingStream` a loopback only OBS
widget shows the same. Main decides it (`index.js syncLiveRating`,
`live-rating-service.js`); off, nothing of it is read, kept or sent. Never
advice, a read, HP, positions, economy, the enemy, who is alive or anything of
a review; never an overlay or a sound; League and imports get nothing. Never
widen it either (`docs/claude/screen-silence.md`, "The live rating").

The flag key's press plays one tick mid match, the same for every press, and
shows nothing (`docs/claude/death-flags.md`).

## Never forget

- **Do not simplify the guards.** The deterministic checks in
  `coaching-engine.js` (map lock, label fingerprint, scoreboard continuity, HP
  beats death, spectating and more) override the model on purpose, each for a
  reproduced failure, so never refactor one away: when code and model disagree,
  code wins (`docs/claude/guards.md`).
- **Marvel Rivals was removed in 8.4.0.** Never add it back: every
  `/api/rivals` route answers 410, saved Rivals reviews are deleted at launch
  (`putAway`), and the id survives only as `games.js RETIRED`
  (`docs/claude/games.md`).
- **One game's data is never shown under another game's name.** A game without
  a source (League has `stats: false`) shows a panel naming the game, never
  another game's dashboard, and no other player's Riot ID is shown, only agents
  and numbers (`docs/claude/games.md`). That holds for every player who has
  not opted in: teammates and enemies in a review, the kill feed, the roster,
  share images, everything. The one exception (the owner, 2026-11-25): an
  Occlara user's own Riot ID, once they proved control of it in the game, on their own public profile
  and in player search, because that user turned it on
  (`docs/claude/social.md`). Occlara Duos names a partner only by username;
  the one place a name can show there is a partner's own clip, their screen as
  it was, shared by their choice (`docs/claude/duos.md`).
- **A refund must take the licence away.** A full `charge.refunded` or any
  `charge.dispute.created` revokes the licence and cancels the subscription
  first, a partial refund must not revoke, and every licence write in the
  Stripe webhook checks its error and throws (`docs/claude/licence-billing.md`).
- **Run `npm run verify:ai` after any read prompt or model change.** It is the
  gate, and it spends money (`docs/claude/live-read.md`).

## Layout

```
src/main/          Electron main process (Node). Windows, services, IPC handlers.
src/main/windows/  main-window.js (the one window and its pages), one file per separate window, registry.js
src/main/services/ coaching-engine.js reads the game; review-store.js keeps reviews
src/preload/       One preload per surface, contextBridge only
src/renderer/      The UI. Vanilla HTML + CSS + JS, no framework, no build step
src/shared/        channels.js, config.js, grade.js, insights.js, the per-game reviews
server/            Express backend (deployed on Railway)
server/routes/     coach.js holds the routes: read, match-review, death-forensics, chat
scripts/           sync-*, the benches, the checks and tests
```

Entry point is `src/main/index.js`. Version lives in `package.json` and is
shown at the bottom of Settings.

```
npm start              run the app
npm run dev            run with devtools and dev userData
npm test               every offline check and test
npm run verify:ai      the live read, gated against Riot's record (spends money)
npm run sync:valorant  regenerate valorant-data.generated.json
npm run release        build and publish a Windows installer
```

Every check and test also runs alone, as `npm run test:<name>` or
`npm run check:<name>` (the names are in package.json).

## Where the detail lives

Read the file for the area before you edit it. The area files still say "above"
and "below" for sections that may sit in another file: grep the section's title
in `docs/claude/` to find it.

| You are | Read |
| --- | --- |
| Touching a window, the seal, the AI log, the updater prompt or anything that could show something mid match | `docs/claude/screen-silence.md` |
| Working on the reader, its cadence, the round ledger, match end, or what a review may claim | `docs/claude/match-to-review.md` |
| Laying Riot's record over the screen: `valorant-verify`, `riot-rounds`, teamwork, HenrikDev fills | `docs/claude/riot-record.md` |
| Changing the look at a death: frames, causes, the name gate, forensics variants, the review page's rounds | `docs/claude/death-look.md` |
| Changing the eye that opens one match's AI log | `docs/claude/ai-log-eye.md` |
| Changing the grade, insights, patterns or the breakdown | `docs/claude/grade-breakdown.md` |
| Grading from Riot's record alone: Connect, `backfill.js`, the late link, `match-link` | `docs/claude/backfill.md` |
| Changing the recorder: capture, encoder, what is kept, the disk guard, health | `docs/claude/recorder.md` |
| Changing clips: cutting, playback, the clip player, the cap, recording Settings and onboarding, dev switches | `docs/claude/clips.md` |
| Changing the main window, shell, pages, Home, the record card, closing or the tray | `docs/claude/ui.md` |
| Changing the Moments page (deaths and highlights, the compilation, its player) or `moments.js` | `docs/claude/ui.md`, "The Moments page" |
| Changing CSS, tokens, fonts, the signal's places or the shared components, or adding an IPC channel (`channels.js`) | `docs/claude/ui-rules-ipc.md` |
| Changing the live read prompt or STATE line, `mapState`, model env vars, call costs, or running `verify:ai` | `docs/claude/live-read.md` |
| Touching a guard in `coaching-engine.js`: map lock, labels, scoreboard, HP beats death, spectating | `docs/claude/guards.md` |
| Changing how the agent is read off the HUD (`lookForAgent`, detect-agent, `agent-crop`) | `docs/claude/agent-hud.md` |
| Working on League: its recorder, `lol-review`, why there is no live coach | `docs/claude/league.md` |
| Switching game, the Stats dashboard, the retired Marvel Rivals routes, or showing any other player's name | `docs/claude/games.md` |
| Adding or tagging playbook notes (`knowledge.js`, `playbook.json`), worked cases (`cases.json`, `cases.js`), enemy agent tags, `study()`, Advanced coaching | `docs/claude/playbook.md` |
| Changing game numbers: the primer, `sync:valorant`, `game-rules.json`, patch notes, the stated facts gate | `docs/claude/primer.md` |
| Changing Ask Coach: `chat-context`, `ask-coach.js`, `chat-prompt`, the fact gates, `bench:chat` | `docs/claude/ask-coach.md` |
| Changing licences, the Stripe webhook, refunds, renewals, grace or `sync-expiry` | `docs/claude/licence-billing.md` |
| Touching accounts, sign in, tiers, game caps, `game_usage`, the read gate, referral, `ENFORCE_CAPS` or a rate limit | `docs/claude/accounts.md` |
| The changelog, What's new, Home's update line, `/api/changelog`, the Discord button or post | `docs/claude/changelog.md` |
| Changing the Practice page, the drill library (`drill-library.json`) or `practice.js` | `docs/claude/ui.md`, "The Practice page", and `docs/claude/playbook.md`, "The drill library" |
| Changing the Trainer page, its numbers (`trainer-data.json`, `trainer-math.js`), arenas, models, scenarios, Fight it again (`trainer-replay.js`) or `trainer-store.js` | `docs/claude/trainer.md` |
| Changing how a death is read as a chain of mistakes, or the match's own memory (`death-chain.js`, `match-memory.js`) | `docs/claude/death-look.md`, "Chains of mistakes", and `docs/claude/match-to-review.md`, "The match's own memory" |
| Changing the Profile page, buying games in the app or `profile.js` | `docs/claude/ui.md`, "The Profile page", and `docs/claude/accounts.md`, "Buying games, in the app" |
| Importing a recording: `import-video.js`, its panel, `/api/usage/import`, the bundled ffmpeg | `docs/claude/import.md` |
| Changing the flag key, flagged deaths or Further explain | `docs/claude/death-flags.md` |
| Report a problem: its button, page, `/api/feedback`, the inbox (`npm run feedback`) or triaging a player's report | `docs/claude/feedback.md` |
| Public profiles, usernames, player search, the Players page, proving a Riot ID (named agents, off until SOCIAL_RIOT_PROOF=1), `/api/social`, `social-001-profiles.sql` | `docs/claude/social.md` |
| Occlara Duos: invites and codes, the Max rule, teammates found, the sheet, clip uploads to the `duo-clips` bucket, the duo cache, pins, the Duos page, `/api/social/duos`, `social-002-duos.sql`, `SOCIAL_DUOS_ON` | `docs/claude/duos.md` |
| Occlara Wrapped: the year record (`year-record.js`), the story (`wrapped.js`), its view, its look, sound and closing card, when it opens | `docs/claude/wrapped.md` |
| The match rating (`rating.js`): the chance to win table, the swings, the event shape a live feed must send, the calibration, what is saved, its block and replay on the review page (`rating-view.js`) | `docs/claude/rating.md` |
| The live rating: the kill feed detector (`killfeed.js`), the live feed (`live-rating.js`), main's gates (`live-rating-service.js`), the stream widget and its server (`rating-stream.js`, `rating-widget/`), the shared badge, `measure:liverating` | `docs/claude/rating.md`, "Live", and `docs/claude/screen-silence.md`, "The live rating" |
| The rating video tool, the owner's content (`scripts/rating-video.js`, `scripts/rating-video/`, `rating:video`, `measure:ratingvideo`), never shipped | `docs/claude/rating.md`, "The video tool" |

## Conventions

**No em dashes or en dashes** anywhere, in reviews, in UI copy, in docs, in
commit messages. Use commas. This is a hard rule. In code that has to match a
dash, write it as an escape (`\u2014`), never the character.

**Never write a regex through a shell heredoc.** `\b` becomes a literal
backspace byte, the file still parses, `node --check` still passes, and the
regex silently matches nothing. This has bitten several times, once killing
every pattern in a tip gate that no longer exists, and in 8.0 a Python patch
through a heredoc turned a `'\n'` into a real newline inside a JS string.
Edit regexes with a file-editing tool, and always assert a new regex matches a
known-positive string.

**Secrets come from the environment.** `.env` and `server/.env` are gitignored
and this repo is public. Never commit a key.

**A session reaches the repo only through `scripts/fixtures/make-session-fixture.js`**,
and never a frame, a still, a clip or a screenshot of it. It keeps the engine's
inputs, its free text cut to an allowlist, and since 8.4.1 each run of dropped
words leaves one placeholder, "someone": dropped outright, "<name> killed by
Chamber" became "killed by Chamber", which the spectate guard reads as the
player's own death banner, and the Fracture replay lost the read that let round
6 register a second death. It writes nothing while the fixture holds a word of
the Riot ID in Settings, which nothing accepts, or a word the session wrote that
neither the allowlist nor the game data knows, until a person has checked it is
no name and passed it with `--accept` (`leaks`, `strangeWords`;
`test:sessionreplay` holds the Fracture fixture to the same lists). The four fixtures before it were cut by the old
scrubber and are not regenerated, since numbers were measured on them:
regenerated, the text of 81 to 260 frames each changes and the anchored KILLED
BY flips on 5 to 15 kill feed lines, the guarded state of 2 frames (the Abyss
swiftplay) and 6 (the Abyss unrated) changes, and every test passes with the
same lines, the same deaths, rounds, modes and reads.

`src/shared/valorant-data.generated.json` is generated by
`npm run sync:valorant` from valorant-api.com. Do not hand-edit it.

**src/ never requires from server/** (`npm run check:clientboot`), because
`package.json` ships `src/`, `assets/`, `node_modules/` and `package.json`,
and **not `server/`**. A require reaching across resolves in the repo, passes
every test, and throws MODULE_NOT_FOUND on a real install. It is the mirror of
`check:server`, and `sync:valorant` writes an identical copy of its data into
`src/shared` and `server/` so the shortcut is never needed.

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

**The logo is a full moon, and it exists in five places, from one source**
(the owner's pick, Nov 2026, the CLEAN detail level). The source is
`scripts/moon/`: the design's `moon-geometry.js` and `moon-art.js` unchanged
and its drawings copied byte for byte into `moon-drawings.js`; never redraw
the moon, change the design and copy again. `assets/logo-mark.svg` is the one
colour mark (the disc with its seas and four craters cut by even odd fill);
`dock/index.html` and the Recording screen in `shell/index.html` inline its
path with `fill-rule="evenodd"`, so they take `currentColor`; the bar shows
the colour drawing at 22 (`assets/mark-bar.svg`) and the splash the clean
colour moon (`assets/splash/moon.svg`); `scripts/generate-icon.js` writes
those three SVGs in node and RENDERS every icon in a hidden Electron window
(the drawn moon is SVG filters no arithmetic reproduces): the `.png`, the
`.ico` (the drawn moon from 256 to 40, the 32 grid drawing at 32 and 24, the
16px drawing at 20 and 16) and four tray icons (the moon idle, the record ring
with the moon as its dot while recording, each for a dark and a light
taskbar). Home's Wrapped row, the games toast, Wrapped and the share image
draw the same path, even odd. Change the moon, then run `node
scripts/generate-icon.js` under the Electron lock: `npm run test:mark` holds
every place to the one path and every icon to `scripts/moon/rendered.json`,
which records what each was rendered from. The SVG carries an explicit
`color="#F5F5F7"` because an external SVG loaded through an `<img>` tag is its
own document, so `currentColor` resolves to black there and the mark renders
invisible on the dark ground. TRAP: `electron script.js` loads the script
through Electron's default app, so `require.main === module` is false there;
a script meant to run in Electron must test its own name in `process.argv`.

**Look at UI changes, do not only compile them.**
`npx electron scripts/shot-surface.js shell settings` writes real screenshots to
`dist-surface-shots/`, one surface on its own, `npx electron
scripts/shot-demo.js home review recording` the bar and a page on the sample
library with their real preloads (`demo-<scene>.png`, unset
ELECTRON_RUN_AS_NODE first), and `OCCLARA_SHOTS=1 npm run
check:mainwindow` writes `main-<page>.png`, every page in the window beside the
sidebar with saved reviews in it. A dropped colour declaration, an unshipped
font weight and a stretched logo all pass every automated check in this repo
and are obvious in a picture. The website's demos come from
`npm run export:siteproof`, the same window on the same sample library
(`scripts/fixtures/proof-reviews.js`), never from anything invented
(`docs/claude/ui.md`).

## Releases

Built with electron-builder and updated via electron-updater. Installers are
published to the separate `lowful/GhostCoach-releases` repo, which keeps the old
name on purpose: electron-updater reads it, and the code repo being renamed does
not make it safe to rename. The code repo itself is `lowful/Occlara`, renamed
from `lowful/GhostCoach` on 2026-08-30.

A version bump needs its `changelog/changelog.json` entry, synced
(`check:changelog` fails without one); the release posts it to Discord.

The main repo's single release (id 296500148) carries the **public download**,
and `scripts/publish-download.js` refreshes it as the second half of
`npm run release`. The release holds **two** names:

- `Occlara-Setup.exe`, which every new link should use and which is the only one
  refreshed each release
- `GhostCoach.2.0.Setup.exe`, which must never be removed but is no longer
  refreshed (since 8.10.3 it stays the 8.10.3 build, an install from it updates
  itself on first launch; `OCCLARA_REFRESH_LEGACY_NAME=1` refreshes it again)

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
