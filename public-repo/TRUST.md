# What Occlara does on your PC

Every claim below points at the file that shows it, so you can check it yourself.

## It never touches the game

- **No game memory is read.** Nothing in this app opens the game's process or reads its memory. Search the source for `ReadProcessMemory` or `OpenProcess`: there is none.
- **No game files are read or changed.**
- **No input is sent.** The app never presses keys or moves the mouse for you. There is no `SendInput`, `keybd_event`, `robotjs` or anything like it.
- **It sees the screen the way OBS does.** Frames come from a plain screen capture: the ffmpeg that ships with the app grabs one frame of the desktop with its `gdigrab` input, a GDI copy of the screen ([`src/main/services/gdi-grab.js`](src/main/services/gdi-grab.js) holds the exact arguments, [`src/main/services/capture.js`](src/main/services/capture.js) runs it), or from the match recording while one runs ([`src/main/services/recorder.js`](src/main/services/recorder.js)).

## Nothing coaches you during a match

While a match is in progress the window shows only a Recording screen with its pages locked. No tip, overlay or voice tells you what to do mid match. See `syncSeal` in [`src/main/index.js`](src/main/index.js) and [`src/main/windows/main-window.js`](src/main/windows/main-window.js). The Recording screen can show your own map, agent, score and round, the same facts your game HUD already shows, each behind a switch in Settings.

## What is sent, and where

- **During a match**, compressed screenshots of your screen are sent to the Occlara server so the coach can follow the match ([`src/main/services/coaching-engine.js`](src/main/services/coaching-engine.js), [`src/main/services/api-client.js`](src/main/services/api-client.js)). The server does not save them. It asks its AI provider not to store or train on them.
- **When a match ends**, the facts of the match and a few still frames from around each of your deaths are sent so the review can be written. Asking the coach about a moment sends that moment's frame.
- **Your recordings and clips stay on your PC**, in your Occlara folder. The video is never uploaded. A screenshot is only sent with a problem report if you choose to attach it.

The app talks to these hosts only:

| Host | What for |
| --- | --- |
| `ghostcoach-production.up.railway.app` | the Occlara server: coaching, reviews, your account and licence |
| `occlara.app` | the website: sign in, plans, What's new |
| `valorant-api.com` | public Valorant data: maps, agents, icons |
| `discord.gg` | the community invite, only when you press it |

Updates come from the `lowful/GhostCoach-releases` releases ([`src/main/updater.js`](src/main/updater.js)).

## How the app protects itself

- Every window loads only the app's own files and can never be sent to a web page ([`src/main/windows/web-guard.js`](src/main/windows/web-guard.js)).
- Pages reach the app only through named calls, and a call from anything that is not one of its own pages is refused ([`src/main/ipc/register-ipc.js`](src/main/ipc/register-ipc.js)).
- The installed program will not run as a general script runner or accept debugging flags, and it checks its own files before starting (`build.electronFuses` in [`package.json`](package.json)).
- Your sign in is stored encrypted by Windows ([`src/main/services/account-service.js`](src/main/services/account-service.js)).
