# Occlara

A post-match AI coach for **Valorant**, **Marvel Rivals** and **League of
Legends**. Occlara reads your game while you play (the display, the way OBS
captures it) and shows **nothing** during the match. When the match ends it
opens a graded review: a score out of 100 with four categories and the facts
behind each, your repeated mistakes with a fix for each, what went well, and
what you missed. Every review is kept in the match library, which also tracks
what keeps repeating across your games. Players unlock the app with a license
key.

> This repository is the **Electron desktop client** and the backend it talks to
> (`server/`, deployed at `https://ghostcoach-production.up.railway.app`).

## Quick start

```bash
npm install
npm start          # or: npm run dev
```

On first launch you'll see the **activation screen**, paste your license key.
After a short tour, Occlara opens the control panel. Press **Start** before a
match; the review opens on its own when the match ends.

## Hotkeys

| Hotkey | Action |
|--------|--------|
| `Ctrl+Shift+E` | Open your last review (does nothing mid match) |
| `Ctrl+Shift+H` | Open Matches, the library of every review |
| `Ctrl+Shift+M` | Minimize the panel |
| `Ctrl+Shift+P` | Pause / resume recording |
| `Ctrl+Shift+S` | Open settings |

## Architecture

```
src/
├─ shared/
│  ├─ channels.js          # single source of truth for all IPC channel names
│  ├─ config.js            # server URL, capture tiers, store defaults
│  ├─ valorant-review.js   # the computed Valorant review
│  ├─ grade.js             # 0 to 100, a letter, four categories with evidence, per game
│  ├─ insights.js          # repeated mistakes, strengths, misses, per game
│  └─ patterns.js          # what repeats across the last ten matches
├─ main/
│  ├─ index.js             # app lifecycle, the review flow, event to IPC fan-out
│  ├─ tray.js · hotkeys.js
│  ├─ windows/             # panel · review · matches · settings · stats · ... (+ registry)
│  ├─ ipc/register-ipc.js  # every ipcMain handler, one place
│  └─ services/
│     ├─ coaching-engine.js# the reader: capture, /api/coach/read, the STATE guards
│     ├─ review-store.js   # every review saved under userData/reviews
│     ├─ lol-recorder.js   # League's Live Client Data, polled silently
│     ├─ capture.js        # worker-thread manager
│     └─ capture-worker.js # screen capture (Worker Thread)
├─ preload/                # one contextIsolated bridge per window
└─ renderer/               # one folder per surface + shared CSS and grade view
server/                    # Express backend: read, match review, death forensics, licensing
```

**Key design points**

- **Nothing live.** Riot's policies ban overlays that tell a player what to do
  mid match and name coaching "game over game" as the alternative. Occlara is
  that alternative, for every game.
- **Riot's record overrides the screen.** When the match links, deaths, killers,
  trades and round results come from Riot; the screen keeps the place and the moment.
- **Single-source-of-truth IPC**, main and every preload import `shared/channels.js`,
  so channel names can never drift out of sync.
- **`contextIsolation: true`, `nodeIntegration: false`** on every window; preloads
  expose a minimal `window.occlara` API.
- **Capture runs in a Worker Thread** so the game never stalls on a screenshot.

## Build (Windows)

```bash
npm run dist:win        # NSIS installer in dist/
```

## Notes

- Config, licence cache and saved reviews live under `%APPDATA%\Occlara\`.
  Installs from before the rename are moved there automatically on first launch.
- A session log is written to `%APPDATA%\Occlara\debug.log` (truncated each run).
- If Windows Defender ever flags the screen-capture step, add a folder exclusion for
  the install directory (screen capture is a normal `.NET` API but can trip heuristics).
