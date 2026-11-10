# Drill demos: what to record, and how

The Practice page (8.11) can show a short muted video on a drill's card: the
drill being done, 6 to 12 seconds, looping while the pointer is over it. The
owner records them; nothing here is generated. This guide says what to record
for the first 12 drills, how to record it, and how to turn a recording into the
two files the app shows.

How it fits together:

- `scripts/make-drill-demo.js` turns a recording into `<id>.webm` (VP9,
  1920x1080, 60 fps when the recording has it, no sound) and `<id>.webp` (its
  poster, the same size, quality 90).
- The website hosts both under `https://occlara.app/drills/`. The site is the
  separate repo `lowful/ghostcoach-9a45ac05` (Vite), whose `public/drills/`
  folder is served at `/drills/`. A push to its `main` deploys, so it needs the
  owner's go ahead.
- `src/shared/drill-library.json` gets one field on that drill:
  `"demo": { "src": "https://occlara.app/drills/<id>.webm", "poster": "https://occlara.app/drills/<id>.webp", "secs": 8 }`.
  The app keeps a demo only under that address (`practice.js demoOf`), and
  `npm run test:drilllibrary` holds the field to the script's names and to 6
  to 12 seconds.

Until a drill has the field, its card is exactly as it was. Offline, or with
either file failing to load, the card is also exactly as it was.

## The one rule: no other player's name

No other player's name may be visible in any frame of a demo. That is the
product's rule everywhere (a review shows agents and numbers, never another
player's Riot ID), and a demo is published on the website, so it matters more
here, not less.

- Record in the Range or a custom game on your own wherever the drill allows:
  there is nobody else's name to hide.
- In Deathmatch, or anywhere another player is in the game, hide every place a
  name can show: the kill feed (top right), the scoreboard (do not open it
  while recording), the text chat (bottom left), and the banner that names who
  killed you. Either crop the recording so none of it is in the frame, or hide
  each place with `--blur x,y,w,h`, as many as needed.
- Your own name is yours to show, but none of the kept seconds needs it.
- Watch every second of the finished `.webm` before uploading it, frame by
  frame where something moves through a blurred box. A name visible for one
  frame is a name visible.

## Recording settings

- **Resolution**: record at your display's native 1920x1080 or higher. A
  recording under 1920x1080 is scaled up and looks soft (the script says so).
  A display of another shape (16:10, ultrawide) is fitted with black bars.
- **Frame rate**: 60 fps. The script keeps 60 when the recording has it.
- **Graphics**: in game graphics at High, with the HUD visible (the minimap,
  the ammo, the abilities), so the demo looks like the game the player plays.
- **Crosshair**: the one you normally use. A drill that needs Movement Error on
  (the counter strafe) says so in its steps; turn it on for that one only.
- **No overlays**: no streamer overlays, webcam, alerts, FPS counters or
  recording indicators on screen.
- **The recorder**: anything that records the game at full quality, for example
  OBS at a high quality preset with the output resolution equal to the base, or
  the GPU's own recorder at its highest quality. Keep the file as it comes out;
  the script does the compression.
- **Names**: kill feed and scoreboard names cropped or blurred, as above. Blur
  boxes are in the recording's own pixels: take a screenshot of the recording
  at its own size and measure the box there.

## Making the files

```
node scripts/make-drill-demo.js <recording> <start s> <length s> <drill id> <out dir> [options]
```

- `start` is the second in the recording where the kept part begins, `length`
  is 6 to 12 seconds.
- `--blur x,y,w,h` hides a box (blocks, then blur), repeatable. At 1920x1080
  the kill feed sits in roughly the top right quarter; start from something
  like `--blur 1340,60,580,320` and check it on your own recording.
- `--720` writes 1280x720 in place of 1920x1080.
- `--crf n` sets the quality, 26 by default; lower is sharper and larger.
- `--fit` encodes again 3 steps softer while the file is over 3 MB, up to CRF 36.
- `--poster-at s` picks the poster from that second of the kept part, 0 by
  default, so the poster is the loop's first frame and nothing jumps when it
  starts.
- `--ffmpeg path` uses that ffmpeg; else `OCCLARA_FFMPEG`, else `ffmpeg` on PATH.

It prints both files' sizes, a hint when the video is outside roughly 1.5 to
3 MB, and the exact `demo` line to paste into the library. Then:

1. Watch the `.webm` all the way through, checking for names.
2. Copy both files into the site repo's `public/drills/` and deploy it.
3. Open `https://occlara.app/drills/<id>.webm` and `.webp` in a browser to
   check they are live.
4. Add the `demo` line to the drill in `src/shared/drill-library.json`, run
   `npm run test:drilllibrary` and `npm run test:practice`, and look at the
   Practice page (`OCCLARA_SHOTS=1 npm run check:mainwindow`).

## The first 12 drills

Chosen for the mistakes reviews name most: lost duels, dry peeks, deaths
nobody traded, first deaths, repeeks, playing isolated, exposed plants and
defuses, lost post plants and shots landing below the head, plus three general
drills that every player is offered with no plan yet. Each says where to
record, what to show, and which seconds to keep. Show the drill done well:
the demo is the picture of the habit, not of the mistake.

### 1. `lost-duel-counter-strafe`, Counter strafe on strafing bots (lost duels)

- **Where**: the Practice Range, Bots set to Strafe (F3). Crosshair Movement
  Error on for the inner lines, as the drill's first step says.
- **Show**: strafe, tap the opposite key, the lines close, one shot to the
  head. Three or four of them, both directions.
- **Keep**: 8 to 10 s, from just before the first strafe to just after the
  last head shot lands. No names anywhere in the Range.

### 2. `lost-duel-head-height-walk`, Head height on every corner (shots landing below the head)

- **Where**: a custom game on your own, Allow Cheats on, your most played map.
- **Show**: a slow walk along one route to a site with the crosshair held at
  head height on the edge of each next corner, never dipping to the floor.
- **Keep**: 10 to 12 s covering two or three corners, ideally one where the
  crosshair is already on the spot a head would appear.

### 3. `dry-peek-ability-first`, One ability before every held corner (dry peeks)

- **Where**: a custom game on your own, Allow Cheats, Infinite Abilities and
  Pause Match Timer on.
- **Show**: stop in cover before a corner that is often held, throw the
  agent's flash, recon, smoke, wall or molly at it, and swing only once it has
  landed. Then one plain corner cleared with a jiggle, out and straight back.
- **Keep**: 8 to 10 s, from the stop in cover to the swing just after the
  ability lands.

### 4. `untraded-spacing-spots`, Spacing behind the entry (deaths nobody traded)

- **Where**: a custom game on your own, Allow Cheats on, Ghost on its key
  (set in the Cheats tab).
- **Show**: stand where the entry would stand at a door, then walk back a few
  steps to a spot that sees past the door and is off the entry's line, and do
  the swing from there to the door as one smooth move.
- **Keep**: 8 to 10 s, from the entry's spot to the end of the swing.

### 5. `first-death-swing-as-it-pops`, Swing as your ability lands (first deaths)

- **Where**: a custom game on your own, Allow Cheats and Infinite Abilities on,
  your own agent.
- **Show**: throw a flash, recon or smoke at an entrance and swing out at the
  moment it takes effect. Twice at the same entrance shows the timing best.
- **Keep**: 6 to 8 s, from the throw to the swing.

### 6. `repeek-kill-and-move`, Kill, then leave the line (repeeks)

- **Where**: Deathmatch. Other players' names WILL show: blur the kill feed,
  and keep the scoreboard closed.
- **Show**: a kill, then a step off the line it was fired from before the
  reload, and the next fight taken from a new angle.
- **Keep**: 6 to 10 s, from just before the kill to the step off the line
  (and the next angle if it fits). Check every frame for names, including the
  top of the screen and any banner after a death.

### 7. `isolated-trade-spots`, Find the trade spot for each of your positions (playing isolated)

- **Where**: a custom game on your own, Allow Cheats on, Ghost on its key.
- **Show**: stand on a spot you often play, look at where the enemy would
  fight you, then walk to the second spot that sees that enemy and show it is
  one short swing away.
- **Keep**: 8 to 12 s, from your spot to the covering spot and its look.

### 8. `exposed-covered-plants`, Covered plant spots (exposed on the spike)

- **Where**: a custom game on your own as an attacker, Allow Cheats on, End
  Game Phase to start the round.
- **Show**: the spike planted behind cover, then a walk to a defender entrance
  looking back to show the plant cannot be seen from there.
- **Keep**: 8 to 12 s, from the start of the plant to the look back.

### 9. `postplant-watch-from-cover`, Watch the spike from cover (lost post plants)

- **Where**: a custom game on your own as an attacker, Allow Cheats on, the
  spike planted at your usual spot.
- **Show**: walking off the open site to a spot that sees the spike from cover,
  then the way back from it if a defender swings.
- **Keep**: 8 to 10 s, from leaving the spike to holding it from cover.

### 10. `general-range-warm-up`, Ten minute warm up (general)

- **Where**: the Practice Range, Speed Medium, Streak Eliminate 50 (F3).
- **Show**: part of the timed bot test with the main rifle, steady head shots
  with a stop before each.
- **Keep**: 8 to 10 s of clean hits.

### 11. `general-spray-control`, First five bullets on the dummy (general)

- **Where**: the accuracy target outside the Range.
- **Show**: two bursts of five at the dummy's head, pulling down against the
  climb, and the bullet marks after each.
- **Keep**: 8 to 10 s, both bursts and the marks.

### 12. `general-stop-to-shoot`, Stop, then shoot (general)

- **Where**: Deathmatch with a rifle. Blur the kill feed, keep the scoreboard
  closed.
- **Show**: moving, an enemy appears, a full stop, then the shot. Two of
  them if they come close together.
- **Keep**: 6 to 10 s around the stops and shots, every frame checked for
  names.

## After the first 12

Any other drill takes a demo the same way. The order that helps most is the
mistakes reviews name most often; the Patterns page across real matches says
which. Keep the Range and solo custom games first: a demo with nobody else in
it has no name to hide.
