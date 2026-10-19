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

## Nothing reaches the screen during a match, in any game

Live tips, the overlay window and the voice coach were removed in 8.0, not
paused: do not add any of it back, and do not add anything else that tells a
player what to do while they play. Riot's VALORANT policy lists real-time data
that changes behaviour immediately as unapproved, League's is stricter still,
and a player got a one week ban. Mid match the main window shows only a
Recording screen with its pages locked (`syncSeal`); the AI log, Ask Coach, a
review's eye, Ctrl+Shift+E, the corner mark and the update restart question
are sealed or wait; the notice line never says anything about the match. Every
sealed surface and why: `docs/claude/screen-silence.md`.

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
  and numbers (`docs/claude/games.md`).
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
| Changing CSS, tokens or fonts, or adding an IPC channel (`channels.js`) | `docs/claude/ui-rules-ipc.md` |
| Changing the live read prompt or STATE line, `mapState`, model env vars, call costs, or running `verify:ai` | `docs/claude/live-read.md` |
| Touching a guard in `coaching-engine.js`: map lock, labels, scoreboard, HP beats death, spectating | `docs/claude/guards.md` |
| Changing how the agent is read off the HUD (`lookForAgent`, detect-agent, `agent-crop`) | `docs/claude/agent-hud.md` |
| Working on League: its recorder, `lol-review`, why there is no live coach | `docs/claude/league.md` |
| Switching game, the Stats dashboard, the retired Marvel Rivals routes, or showing any other player's name | `docs/claude/games.md` |
| Adding or tagging playbook notes (`knowledge.js`, `playbook.json`), `study()`, Advanced coaching | `docs/claude/playbook.md` |
| Changing game numbers: the primer, `sync:valorant`, `game-rules.json`, patch notes, the stated facts gate | `docs/claude/primer.md` |
| Changing Ask Coach: `chat-context`, `ask-coach.js`, `chat-prompt`, the fact gates, `bench:chat` | `docs/claude/ask-coach.md` |
| Changing licences, the Stripe webhook, refunds, renewals, grace or `sync-expiry` | `docs/claude/licence-billing.md` |

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

**The logo is an aperture, and it exists in five places.** `assets/logo-mark.svg`
is the source; `splash/index.html`, `dock/index.html` and the Recording screen in
`shell/index.html` (a thinner stroke at 88px) inline their own copies so they
can animate and inherit `currentColor`; `scripts/generate-icon.js` draws it
mathematically for the `.ico` and `.png`. Change one and change all of them.
The SVG carries an explicit `color="#FFFFFF"` because an external SVG loaded
through an `<img>` tag is its own document, so `currentColor` resolves to black
there and the mark renders invisible on the dark ground.

**Look at UI changes, do not only compile them.**
`npx electron scripts/shot-surface.js shell settings` writes real screenshots to
`dist-surface-shots/`, one surface on its own, and `OCCLARA_SHOTS=1 npm run
check:mainwindow` writes `main-<page>.png`, every page in the window beside the
sidebar with saved reviews in it. A dropped colour declaration, an unshipped
font weight and a stretched logo all pass every automated check in this repo
and are obvious in a picture.

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
