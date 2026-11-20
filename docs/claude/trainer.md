# The Trainer

An aim and movement trainer that runs entirely in the main window's Trainer
page, the tab right after Practice (`shell-nav.js` `trainer`). It has no AI
and makes no network call: a run is simulated in the page, kept on this PC,
and nothing of it leaves the PC. Practice's drills link into it ("Train
this", below), a review's deaths link into it ("Fight it again", below), and
it is sealed mid match like every page.

The point of it is feel that matches the game: the same degrees per mouse
count, the same field of view, the same run speeds, the same accuracy gate
and the same moving errors, so practice here carries over. Everything else
(the arenas, the figures, the guns' look, the sounds) is our own or generic.

## The hard line: nothing of Riot's or any game's, only numbers

The Trainer takes numbers and feel from Valorant and nothing else. Nothing of
Riot's or of any game's ships in it: no map geometry, no models, no textures,
no sounds, no HUD art, and no shape made to imitate any of them. Every arena
is plain volumes built for a situation, never traced from a map. Words from
the player's own match are another matter: a replay's line names the agent
that killed them, as the game data spells it (Fight it again, below). No
weapon's name is on its profiles: the four have plain names, Heavy
rifle, Silenced rifle, Heavy pistol and Light pistol, and `trainer-data.json`
notes which game weapon's numbers each one follows (`follows`: Vandal,
Phantom, Sheriff, Classic). The Settings pane says it in one line for the
loadout chosen, "Each uses one weapon's numbers: the heavy rifle the
Vandal's, the heavy pistol the Sheriff's." (`app.js paintSettings`,
`#s-follows`); that line is the only place a game weapon is named on screen.

ASKED AND DECLINED. On 19 Nov 2026 the owner asked for Riot's own models and
maps in the Trainer and was told no. Do not add them later, in any form. A
site that hosts game rips (kingdomarchives or any other) is never a source,
and neither is a fan copy of a game's asset, whatever licence its uploader
claims (`scripts/trainer-models/README.md`, "THE RULE: what may be a
source": a generic real world model under CC0, or CC-BY with its credit in
the notice, whose own page states the licence).

### The models that ship

Every model the Trainer shows is a generic CC0 model of real world kit,
converted at build time by `scripts/trainer-models/` into two plain
JavaScript modules, `src/renderer/trainer/models/figure.js` (`FIGURE`) and
`models/guns.js` (`GUNS`). No loader ships and no texture ships: each mesh is
packed as base64 (positions in 16 bits over the mesh's span, normals in 8,
a vertex colour per point with its gloss in the fourth part, and for the
figure its joints, weights and outline normals) and `kit.js unpack` turns it
into a geometry, so three.js stays the one vendored file. Every colour is a
vertex colour set by the build. The sources, from
`native/trainer-models-NOTICE.txt` (each page on poly.pizza read on 19 Nov
2026, each stating CC0 1.0, Public Domain):

| Source | Author | Licence | Used for |
| --- | --- | --- | --- |
| SWAT | Quaternius | CC0 1.0 | the bots' figure (mesh, skeleton and its Idle_Neutral, Run, Run_Back, Run_Left, Run_Right and Death clips), and the forearms and gloved hands of all five view models |
| Rifle West | Pichuliru | CC0 1.0 | the Heavy rifle's view model |
| Assault Rifle West | Pichuliru | CC0 1.0 | the Silenced rifle's view model, and at 90% with no suppressor the rifle the bots hold |
| Suppressor | Pichuliru | CC0 1.0 | the Silenced rifle's suppressor, on the rifle's own muzzle point |
| Pistol West | Pichuliru | CC0 1.0 | the Light pistol's view model |
| Kabar | Pichuliru | CC0 1.0 | the knife's view model |
| Revolver | Quaternius | CC0 1.0 | the Heavy pistol's view model |

The notice says what was changed in each (recoloured, glossed, normals
smoothed by angle, the figure's skin painted as glove and mask so no skin
shows, its upper body posed again to aim a rifle, its fingers curled and
baked, its clips sampled to a few frames each). CC0 asks for no credit; the
notice names the authors anyway.

The downloads are never committed. `node scripts/trainer-models/fetch.js
<raw dir>` gets them again from `sources.json` into a folder outside the
repo (and says so when a file's size is not the one read on 19 Nov 2026),
and `node scripts/trainer-models/build.js <raw dir>` writes the two modules
(`--dry` prints without writing; `--preview` writes `.ply` files that
`preview.py` renders in headless Blender). The modules are generated: never
edit them by hand, change `build.js` and run it. A new source goes into
`sources.json` and the notice in the same change. If `check:publicmirror`
refuses a model module for "secret shaped text", a long run of base64 spelled
a token's first letters by chance: `mesh.js b64` cuts such a run in pieces
and `kit.js` joins them.

three.js r170 is vendored unchanged
(`src/renderer/trainer/vendor/three.module.min.js`, MIT,
`native/three-NOTICE.txt`). Every sound is synthesised (Sounds, below).

## The files

| File | What it does |
| --- | --- |
| `src/shared/trainer-data.json` | Every number the Trainer runs on, each with its unit, source, patch and whether it is verified (below), and `replay`, what a replayed death's enemy fights with. |
| `src/shared/trainer-math.js` | The pure maths, run by main, the tests and the page alike (a classic script there, `window.OcclaraTrainerMath`): `numbers`, `unverified`, sensitivity and field of view, `stepGround` and `stepAir`, spread, `sprayAfter`, recoil, damage and armour, the settings' normalising and the crosshair code, a run's `report`, `killPoints` and `score`, and the store's state (the runs and `seenAt`). |
| `src/shared/trainer-scenarios.json` | The 16 scenarios: id, title, arena, kind, level, limit, bots, botShoot, about, and `causes`, the review's mistake keys each trains. No scenario names a weapon or an HP. |
| `src/shared/trainer-replay.js` | Fight it again: which of the player's own deaths in saved Valorant reviews can be replayed, and each replay's spec (`replayOf`, `replaysOf`, `markRounds`, `parseOpen`). Pure; main and the tests require it. |
| `src/main/services/trainer-store.js` | Main's half: the runs and `seenAt` in the store's `trainer` key, the scenario Train this asked for, the replays (`replays`, `seen`), a replay opened by its id, and every call quiet mid match. `open(id)` shows the page on that scenario or replay. |
| `src/preload/trainer-preload.js` | The bridge: the two data files (copied once), config read and the `trainerSettings` write, the runs, the replays and their seen stamp, whether the pointer is locked, the pushes. |
| `src/renderer/trainer/index.html`, `trainer.css` | The page: the rail (the fresh deaths prompt, the list and the settings), the stage (the canvas, the crosshair canvas, the scenario's panel, the HUD, the pause and the report). CSP `default-src 'self'`. |
| `src/renderer/trainer/app.js` | The page's logic: the rail and the panel, the deaths list, the settings, a run from its countdown to its report, the HUD, the pointer lock, telling main when the lock comes and goes, and the debug handle `window.occlaraTrainer`. |
| `src/renderer/trainer/engine.js` | The simulation and the renderer: the fixed tick, input, collision, shooting, the bots' shots at the player (`BOT_GUN`, `HURT_GAP`, or a replay enemy's own damage), interpolated frames, `respawn` between a replay's fights, and the menu's still (`preview`). |
| `src/renderer/trainer/world.js` | The seven arenas as boxes merged into one mesh (the same boxes are the collision), the world's shader, the contact shadows, the star dome, the floor chevrons, the plan the menu draws (`arenaPlan`) and `rayWorld`. |
| `src/renderer/trainer/bots.js` | The bots: one instanced skinned figure, its clips blended on the CPU, its outline and shadow, the fall when killed, analytic hitboxes (a head sphere, body and leg capsules), movement on the player's own `stepGround`, shooting back (`FIRING_MAX`). |
| `src/renderer/trainer/gun.js` | The four profiles and the knife: equip, reload, fire rate, the Light pistol's burst, spread, recoil and its recovery, aim down sights easing in (`adsAmount`), and the view models from `models/guns.js`. |
| `src/renderer/trainer/scenarios.js` | Each kind's rules: where bots appear and move, when the run is done, the HUD line, the hard level's bot numbers (`SHOOTS`), and a replay's fights. |
| `src/renderer/trainer/audio.js` | Every sound, synthesised with Web Audio (below). |
| `src/renderer/trainer/kit.js` | What the models are made of at run time: `unpack` (a packed mesh to a geometry), `floats`, and how every model is lit (`LIT`, `LIGHT`, `litUniforms`). |
| `src/renderer/trainer/models/figure.js`, `models/guns.js` | Generated by `scripts/trainer-models/build.js`: the bots' figure with its 22 bone skeleton and clips, and the five view models with their hands and muzzles. Never edited by hand. |
| `scripts/trainer-models/` | The build: `sources.json`, `fetch.js`, `glb.js`, `rig.js`, `mesh.js`, `build.js`, `preview.py`, and its `README.md`. |
| `native/trainer-models-NOTICE.txt` | Each source, its author, its licence, what it is used for and what was changed. |

## The page: a rail and a stage

`index.html`, `trainer.css`, `app.js`. The rail (392 px wide, 340 below a
1180 px window) shows only in the menu and has two tabs, Scenarios and
Settings. The stage is the 3D view and what lies over it: in the menu the
selected scenario's panel over a still of its arena, in a run the HUD, then
the pause or the report over the last frame drawn.

- **The list**: when the player has deaths to fight again, "Your deaths"
  first (Fight it again, below). Then the 16 scenarios in 11 rows, under
  Range (the six range drills, each with its own glyph) and Arenas (the five
  arenas, site, lane, stack, corner and plant, each with a plan of it from
  above, `world.js arenaPlan`). An Easy and Hard pair of one arena and kind
  is one row ("Easy and Hard"), and the level is a control in the panel
  (`#d-level`). Each row shows its best score. A click on a row selects it
  (`select`), which repaints the panel and the still and never starts a run;
  `#play`, Enter on the Scenarios tab, or a double click on a row starts the
  scenario selected. Flick grid is selected when the page opens. Below the
  list, "How close is it to the game?" opens three paragraphs, the second
  counting the unverified values.
- **The panel**: Range or Arena and the scenario's facts (its seconds, its
  targets or bots, "they shoot back"), the title, the about line, the level
  control for a pair, "Practice sent you here for this one." when Train this
  sent the player, and the best, the run count and the mean accuracy of the
  last 5 (Calibration shows the turn, the lane and the sensitivity instead).
  A replay's panel is its own (below).
- **The still**: in the menu the engine draws one frame (`engine.preview`)
  and runs no loop: the arena from its own camera (`arena.view`) with a few
  bots standing where its `sample` says. The Settings tab shows the player's
  crosshair over a first person still from the range's start with one bot
  14 m ahead ("Your crosshair, on a target 14 metres away"). A resize draws
  the still again.
- **A run**: a countdown of three beats 650 ms apart with the keys shown
  (`#h-keys`), none for Calibration; then the HUD: score, time and accuracy
  on top (hidden for Calibration), the scenario's line, HP and armour when
  the bots shoot back, the weapon, a reload bar and the ammo, a hit mark, a
  "+points" pop on each kill (`killPoints`, before the accuracy factor), the
  Accurate light in Counter-strafe, and a red edge on the side a bot's hit
  came from. The crosshair is a 2D canvas over the view that rises with the
  recoil the spray has built (`engine.recoilPx`) and, with Opens with firing
  error on, opens with the cone (`engine.conePx`).
- **The pause**: "Paused", the run's name (", not started yet" when the
  countdown had not finished, and such a run starts its countdown again on
  Resume), a sensitivity field that saves to the settings, and Resume,
  Restart and Scenarios.
- **The report**: below, under Scoring.

THE DEBUG HANDLE. `window.occlaraTrainer` (`app.js`, for the checks):
`phase` (menu, countdown, playing, paused or report), `playing` (the
engine's loop), `raw` (whether raw input was granted), `selected`,
`select(id)`, `replays` (the ids of the deaths listed, each
`replay:<reviewId>:<round>`), `setReplays(list)` (paints a list as main
would give it), `sounds` ([drawn, of how many]), `player` (`{ x, y, z,
speed, ground, crouch, hp, armour }`, read only), `frameTimes()` (the ring's
frame times in ms), `lastFrames` (`{ n, p50, p99 }` of the last run, set as
it ends) and `scenarios()` (the ids). `check:trainer` reads `phase`,
`playing`, `raw`, `scenarios()` and `frameTimes()`, and plays a scenario
through `select(id)`, read back with `selected`, and a gesture click on
`#play`; `check:mainwindow` reads `scenarios()` and `playing`.

## The loop

`engine.js`. The simulation steps at a fixed 128 Hz (`tick`, Valorant's tick
rate) from an accumulator; rendering runs every animation frame and draws the
player, the crouch and the bots between their last two ticks (`draw(acc /
TICK)`). A frame longer than 0.25 s is cut to 0.25 s. Mouse look is applied on
every `mousemove` event, never per tick, so a turn reaches the next frame
drawn. The sky, the arena and the bots are one scene; the gun is its own
scene with its own camera (62 degrees), drawn over after a depth clear.

What is made inside the loop, precisely. The engine's per tick state lives
in objects made once and reused: the player, the wish and move vectors, the
ray hit and the shot's result (`hitOut`, `res`), the eye, the direction and
the matrices, the damage target for a bot's hit, the tracer, mark and puff
pools, and the frame time ring of 1200. A bot's pose is blended into arrays
made once (`bots.js` `acc`, `wq`, `wc`) and written into one float texture.
Still made each time: the gun's answer for each bullet that leaves
(`guns.fire` returns a new object, and `{ dry: true }` on an empty click),
the Web Audio nodes of every sound played with the name strings of shots and
steps, and a bot's spawn. The page's frame hook (`app.js onFrame`) moves the
crosshair only when the recoil changes by half a pixel or more and, with the
firing error on, builds one small object a frame for `spread`. The HUD
(`paintHud`) is painted every 80 ms: it runs `report` over the counters and
builds its strings then, and writes an element only when its text changed
(the magazine size beside the ammo is written every time). The frames per
second line is redrawn every 0.4 s when it is on.

The renderer asks for a low latency WebGL2 context (`desynchronized: true`,
`powerPreference: 'high-performance'`) and a pixel ratio of at most 1.5. Low
graphics sets it to 1 and draws the world's grid and edges fainter
(`world.js setDetail`, 0.6).

The loop runs only while a run is played. `app.js` pauses it, stopping the
animation frame and letting go of the pointer, when the pointer lock goes
(Esc), the page is told to leave (`onPage` leave), the document is hidden, or
the window loses focus (`blur`). Paused, the engine draws one still behind
the pause card (`engine.still`); Resume locks again.

## Input

Play, Enter or a double click is the gesture Chromium needs to lock the
pointer, and `begin` locks it on the canvas before the countdown with
`requestPointerLock({ unadjustedMovement: true })`, raw input with no Windows
pointer acceleration. When that is refused (an old driver, a remote session)
the page falls back to the plain lock, and the run's report says so: "Raw
mouse input was not available, so Windows pointer settings may have changed
how far the view turned." When no lock is given at all the run waits paused
("The mouse could not be locked. Click Resume to try again."). Keys are read
by `event.code` through the player's binds; left click fires, right click
aims down sights (or starts the Light pistol's burst), and mouse buttons 4
and 5 can be bound. Aimed, the turn takes the scoped rule at once (divided by
the zoom, times the Aim down sights multiplier, `scoped`), while the view's
zoom eases in (Weapons, below).

The page was spiked on 18 Nov 2026 before it was built: the raw lock was
granted in a WebContentsView with Electron's default permissions, three.js
r170 loads under `default-src 'self'`, and it ran at 240 fps with a 4.2 ms
median frame on the owner's RTX 5060 at 240 Hz.

## The numbers: trainer-data.json

Every leaf is `{ value, unit, source, patch, verified }`, often with a `note`
saying how it was read or worked out; `_about` strings explain a whole
branch. `trainer-math.js numbers()` turns the file into plain values in
metres, seconds and degrees, and `unverified()` lists every leaf whose
`verified` is not true (53 today, `replay.fights` and `replay.guns` among
them), which `npm run test:trainerphysics` lists for the owner.
`verified: true` means an official Riot source, or the wiki citing a patch,
states it, or two independent sources agree. `verified: false` means one
community measurement, a value worked out, or the Trainer's own design.

THE RULE: NO NUMBER IS EVER GUESSED SILENTLY. A number that claims to be the
game's lives in this file with its source. Where nothing is published, the
value says `source: "trainer design"`, `verified: false`, and its note says
why and what it was shaped to. A constant in `trainer-math.js` is only a unit
conversion or a rule of the Trainer itself (the score, the settings' bounds,
the store's caps). The page's own rules that claim nothing about the game
are in code and are the Trainer's own: the hard bots' reaction, rate, hit
chance and armour (`scenarios.js SHOOTS`), their settling and the two that
fire at once (`bots.js`, `FIRING_MAX`), the gun they hit with and the gap
between their hits (`engine.js BOT_GUN`, `HURT_GAP`), and the footstep
spacing. A replay's enemy is the exception that lives in the file:
`replay.guns` (below).

The research is of 18 Nov 2026; the weapon numbers are valorant-api.com's
build 13.10.

### How close each number is

| | Matched from a stated source (`verified: true`) | One community measurement or a single source (`verified: false`) | The Trainer's own design (`verified: false`) |
| --- | --- | --- | --- |
| View | 0.07 degrees per mouse count times sens; the scoped rule (divided by the zoom, times the multiplier); 103 degrees across at 16:9, 70.53 up and down, narrower screens keep the 70.53 | pitch per count 0.07 (one source); wider screens held at 103 across (Riot's page, read as capped) | pitch limit 89 degrees |
| Tick | 128 Hz | | |
| Movement | knife run 6.75 m/s; each weapon's run speed and its aimed down sights multiplier; the accuracy gate at 27.5% of the current top speed (patch 3.0); landing error 7 degrees for 0.225 s (1.09); tagging slows 72.5% (3.0) | walk 0.6 and crouch 0.35 of the run speed (one video); acceleration to the top in 0.288 s, braking 28 m/s2, friction 6.5 per s, counter-strafe no faster than letting go, gravity 20.45 m/s2, jump 6.902 m/s, crouch in 0.276 s, eye 0.4 m lower crouched (one 2022 frame by frame study) | stop speed 0.05 m/s, air control 0.15, tag lasts 0.3 s |
| Body | 100 HP, 50 armour absorbing 66% | | eye height 1.6 m, height 1.8 and 1.35 crouched, radius 0.34, step 0.45, every hitbox size (none is published) |
| Weapons | fire rate, automatic or not, magazine, reload, equip, alt fire, zoom, damage by range band, first shot cone aimed and not, the cone's maximum and its crouched share, the crouched, walking, running and airborne moving errors; the rifles' protected bullets before the sideways sway (11.08) and recovery time; the Light pistol's burst count, cooldown and added error | | how fast the cone opens in a spray (set to reach the published maximum), every recoil climb pattern, its tail and sideways sway, the pistols' sway start and recovery, the burst's rate and recoil share |
| Replay | | | five fights a run; each weapon class's damage a hit (after the game's: a rifle 40, a sniper 150, a shotgun 66 close and 12 past 8 m), taps a second, share that land and reaction |

The weapon profiles' plain names are the Trainer's own (`name`, verified by
definition) and `follows` names the weapon whose numbers they are.

### The movement model

`trainer-math.js stepGround(v, wish, top, m, dt)`, one tick of ground
velocity, used by the player and the bots alike:

- With no key, the speed brakes as dv/dt = -(brakingDecel + friction x speed)
  and stops dead under `stopSpeed`.
- With a key, the speed along the wished line rises in a straight line at
  top / accelTime, so the top is reached in accelTime whatever the top is
  (0.289 s at 128 Hz).
- Pressing against the motion brakes at that same braking rate and no faster
  (`move.counterStrafe` is "same-as-release": in the 2022 measurement a
  counter key does not stop quicker than letting go), and only once stopped
  accelerates the other way.
- The part of the motion across the wished line is braked the same way, so a
  turn is not a skate.
- Over the top (walk pressed while running) it brakes down to the top.

`stepAir` steers a little (`airControl`) and never brakes. `topSpeed` is the
weapon's run speed (the knife's with no weapon), times the aimed down sights
multiplier when aimed, times the walk or crouch share. With the Heavy rifle
that is 5.4 m/s running, 3.24 walking and 1.89 crouched, and a stop from a
full run to under the accuracy gate (27.5% of 5.4) takes about 0.078 s
whether the key is let go or countered. `accurate()` is that gate on the top
speed of how the player moves now; `spread()` adds the moving error scaled
from the gate up to the top speed, the airborne error in the air and the
landing error just after landing.

## Arenas and scenarios

### Arenas

`world.js`, `ARENAS` (`ARENA_IDS`). Every arena is boxes in our own colours,
merged into one mesh; the same boxes are the collision. Units are metres, y
up, the player looking down -z at the start. `spots` are where bots may
stand, `route` is the path the floor chevrons draw, `view` the menu's camera
and `sample` the bots its still shows.

- **range**: a walled range with an amber firing line and a line every 5 m
  down to 55 m, pilasters and beams every 12 m. On the right, the calibration
  lane: 20 m from the firing line, a white mark every 5 m and amber at its
  ends. Straight behind the start, a post to turn a full circle on.
- **site**: a corridor ("the main") into a site with a link off its east
  wall, a default box in a painted plant square, a tall stack, a short box, a
  back platform and a pillar. Fourteen spots bots may stand on and a route
  the floor chevrons draw.
- **lane**: a long main with three cubbies, a choke at its far end and the
  player's crate at the near end, a line every 10 m.
- **stack**: a building front with two doors, a wide opening, an upper window
  and a balcony 4 m up, with five spots: jiggle peeks, wide swings and a
  strafe across the opening.
- **corner**: a corridor the player comes up into a T, a crate down each arm
  and a box at its mouth ahead, and eight spots round either side and
  further in (tight on the corner, deep down the arm, crouched behind a box).
  Its route is the corridor, from the start to the mouth.
- **plant**: an open site with the charge down (a lit marker of our own in a
  painted square), two ways in, a room off the far wall and a room off the
  left one, the player's cover at the near end and cover for a pusher. Its
  four spots are doors, each with a `path`: the bot walks it point by point,
  holding each for that point's seconds (below).
- **duel(spec)**: one fight laid out from a replay's spec (Fight it again,
  below), never a place in any map.

### The look

A night scene, drawn by one small shader in `world.js` (no lights, no shadow
maps, no post): slate volumes with bright edges, a dark floor ruled by a
glowing metre grid, accents that glow in their own colour, and a star dome.

- **The colours** (`C`, `ACCENT`, `AMBER`, `WHITE`): slate greys for
  everything built, near black for floors, and three accents in `GLOW` that
  are drawn at their own colour whatever the light: teal (`ACCENT`) for the
  rims along a cover block's top edge (`crate`), so what can be stood behind
  is seen at once; amber for what to follow (the firing line, the plant
  squares, the charge, the route's chevrons, the lane's 10 m lines, the
  turn post); white for measures (the calibration lane's marks, the duel's
  5 m lines).
- **The light**: `SKY` holds the colours. Each face is lit by a cool sky
  above and the ground's bounce below by the way it faces, plus one key
  light from `SKY.sun` at 0.55 of `sunLight` (the header calls it a high
  moon). A wall that stands on a floor darkens toward it and lifts a little
  toward its top.
- **The grid**: on floors a line every metre and a stronger one every 4 m in
  `SKY.grid`, only hinted on walls, faded where its cells shrink to a few
  pixels so it never shimmers.
- **The edges**: every face has a bright edge (`SKY.edge`), fainter on
  floors, so a block reads against a wall of its colour. Low graphics draws
  grid and edges at 0.6.
- **Distance** fades into the horizon's teal (`SKY.fog`, from 45 m to
  240 m). The renderer clears to that colour.
- **The sky** is a dome that follows the camera (`buildSky`): the horizon's
  teal glow falling away to a near black zenith, and stars, one cell in a few
  hundred holding one, none near the horizon.
- **Contact shadows** are flat dark quads on the floor round every solid box
  that stands on one, wider and darker the taller it is.

HOW A MODEL IS LIT. The bots and the guns use one GLSL function,
`kit.js LIT`, with no lights in their scenes either: the same sky above and
ground below, one key light, a highlight, and a mirror of the sky, all a
dark metal has to be read by at night. Each point's gloss (the packed
colour's fourth part) says what it is made of: about 0 cloth (it wraps the
light and catches a sheen at its edges), about 0.3 polymer (a broad faint
highlight), 0.7 and up metal (a tight tinted highlight and the sky in it).
The colours are `kit.js LIGHT`, which copies `world.js SKY` BY HAND (sky
light, ground light, the sun's colour, the horizon's glow as `glow`, the fog
as `haze` with its 45 and 240 m), so a change to one is a change to both.
`litUniforms` sets them; the bots point `uSun` at `world.js SUN`, and the
guns turn the sun and the up direction into the eye's space every frame,
since the view model's camera never turns.

### Bots

`bots.js`. A figure in plain dark tactical clothing and a helmet, aiming a
rifle at the player, made ahead of time from the SWAT model (above) and
loaded from `models/figure.js`.

- **One instanced skinned mesh**: every bot on the field (up to 16,
  `MAX_BOTS`) is one instance of the figure. The body, its outline and a
  soft round shadow are three draws in all, however many bots there are.
- **The skeleton and the clips**: 22 bones. The clips are `aim`, `crouch`,
  `runF`, `runB`, `runL`, `runR` and `fall`; each frame holds, for each bone,
  its turn from its parent and its place in its parent. A bot's pose is a
  blend of clips worked out on the CPU, bone by bone, then walked down the
  tree: standing or crouched and aiming when still, the run for the way it
  moves as it faces (ahead, back, left or right) eased in by its real speed,
  and the fall when killed. The chest leans up or down toward the player's
  eye (at most 0.7 rad), and everything above it follows. Each bot's bones
  are written, one row a bot, into a float texture the vertex shader skins
  from.
- **The fall**: a bot killed falls for 0.42 s (`FALL_SEC`), lies, and from
  0.6 s (`LIE_SEC`) sinks half a metre into the floor; at 0.85 s
  (`DIE_SEC`) the bots' tick, which the engine runs, takes it away. Its
  shadow widens as it falls.
- **The outline**: the same skinned hull pushed out 2 px and drawn inside
  out, in the colour the `enemy` setting names (yellow, red, purple or cyan,
  `OUTLINES`), turning white for a moment when hit and as it falls; the body
  itself flashes white when hit.
- **Hits** are worked out analytically, a ray against a head sphere and two
  upright capsules (body and legs) from `trainer-data.json hitbox`, never by
  picking the scene. The figure is sized so its helmet stands where the
  head's sphere is, standing and crouched.
- **Movement**: on the player's own `stepGround` at the Heavy rifle's run
  speed, so a strafing bot's stop takes the time a real stop takes. A plan
  is a list of legs, `{ to: [x, z], hold }`, walked with the keys let go
  early enough that braking stops on the mark; `loop` repeats it and `done`
  is called when the last leg is held. Every bot has 100 HP; Spray
  control's target never dies.

`createBots(N, scene)` returns `{ list, spawn, remove, clear, tick, rayHit,
draw, scaleY, meshes, setOutline(name), setResolution(w, h) }`; the module
also exports `MAX_BOTS` and `OUTLINES`.

### Bots that shoot back

A scenario with `botShoot` (the Hard levels), and every replay. The numbers,
exactly:

- `scenarios.js SHOOTS`: on a Hard level each bot reacts 0.45 s after it sees
  the player, taps 1.6 times a second, hits with a chance of 0.14 once
  settled, and wears 50 armour. A replay's enemy takes its reaction, rate and
  chance from `trainer-data.json replay.guns` instead (Fight it again,
  below).
- `bots.js`: a bot counts how long it has seen the player (the eye or the
  chest, `engine.js canSee`, from its head) and loses the count when it loses
  sight. Past its reaction it starts firing, but only `FIRING_MAX` (2) fire
  at once; the rest hold, and one takes over when a firing bot falls or loses
  sight. Each tap lands with the hit chance times its settling, 0.35 +
  (seconds seen less the reaction) / 1.5, held between 0.35 and 1, so it
  settles over a second and a half, times 16 / its distance in metres, held
  between 0.4 and 1.
- `engine.js botShot`: every tap plays the bot's shot, panned by the side it
  comes from. A landing tap hurts only when 0.6 s have passed since the last
  hit landed (`HURT_GAP`), so five bots at once hurt in turn; it always hits
  the body. On a Hard level it hits with the Light pistol's damage
  (`BOT_GUN` `sidearm`, 26 to 30 m and 22 past it, before armour); a replay's
  enemy hits with its class's `dmg` (a shotgun's `dmgFar` past `farFrom`
  metres). Either way it goes through armour, tags the player (72.5% slower
  for 0.3 s), plays the hurt sound and flashes that side of the HUD. At 0 HP
  a scenario's run ends and the report says "you were killed"; a replay
  loses that fight and goes on to the next.
- Measured, as `scenarios.js`'s comment records: tuned on the site so that
  standing in the open in front of the whole site lasts about twenty
  seconds, and a player who clears each angle as it opens loses little.

The player has 100 HP and, only when the bots shoot back, 50 armour.

### Scenarios

The 16 scenarios (`trainer-scenarios.json`, rules in `scenarios.js`). A
scenario names no weapon and no HP (`test:trainerphysics` holds that the
fields are gone): a run is played with the loadout chosen in Settings
(`engine.load` arms the player with `settings.primary` and
`settings.secondary`), and every HP is the data's 100. Of the rest the page
reads `botShoot`, which is what makes a level hard: the bots shoot back and
wear armour, the player wears armour and the HUD shows HP, the panel says
"they shoot back", the report lists Damage taken in place of Time, and a
wide swing on the stack holds 1.8 s, not 1.4. `level` only names the pair
(the level control and "Site retake, Hard"). The time limit runs on every
level that has one (`limit` 0 is none).

| id | Title | Arena, kind | What it is |
| --- | --- | --- | --- |
| calibration | Calibration | range, calibration | the full turn counter (the reload key resets it) and the 20 m lane timed against 20 m at full run speed; no countdown and no score |
| flick-grid | Flick grid | range, flick | 30 targets one at a time across 110 degrees, 8 to 22 m, 60 s |
| micro-flicks | Micro flicks | range, micro | 40 targets a few degrees from the last, 13 to 16 m, 45 s |
| strafe-track | Strafing targets | range, track | 12 targets that strafe and stop as a player does, 60 s |
| counter-strafe | Counter-strafe | range, strafe | 20 targets; a hit counts only when the player was under the accuracy gate (an Accurate light on the HUD), every stop timed, 60 s |
| spray-wall | Spray control | range, spray | five sprays of at least 8 bullets at a target 10 m away with a wall behind it, scored on the bullets that land |
| site-preaim-easy, site-preaim-hard | Site retake | site, route | 10 bots on 10 of the 14 spots, cleared walking the route; hard 45 s |
| lane-hold-easy, lane-hold-hard | Hold the main | lane, hold | 15 bots through the choke or out of the cubbies; one that walks its path alive got away; 60 s |
| stack-peek-easy, stack-peek-hard | Peeks on two levels | stack, peek | 15 bots peeking the doors, the opening, the window and the balcony, two at most at once; 60 s |
| corner-clear-easy, corner-clear-hard | Clear the corner | corner, route | 4 bots on 4 of the 8 spots round either side of the T and further in, sliced a step at a time; easy no limit, hard 30 s |
| plant-hold-easy, plant-hold-hard | Hold after the plant | plant, hold | 12 bots back through the two doors, each walking its door's `path`; one still standing when its path is done got away; 60 s |

A `hold` kind picks a spot at random for each bot, 1.3 to 2.6 s apart. A
spot with a `path` (the plant's doors) gives the bot that path, each point
moved up to half a metre at random and held for its own seconds, then the
bot is gone and counted as got away if it is still alive. The lane's choke
and cubbies keep their own legs (`choke`, `out`).

The page names a scenario with its level as "Site retake, Hard" in the pause
and the report title; the row says "Easy and Hard" and the panel's level
control picks one. The rows are made from the file in its order, one per
arena and kind (`app.js ENTRIES`): six under Range and five under Arenas.

## Fight it again

The player's own deaths, from their saved Valorant reviews, fought again in
the Trainer: a review's death row has the button, and the Trainer's list has
"Your deaths". A replay is a small fight laid out from what the review
already holds about that death, never the place it happened and never
anything of anyone else.

### What a replay is: trainer-replay.js

`replayOf(review, round)` is one death of a saved review as a replay, or
null. NEVER INVENTED: it reads only what the review holds, Riot's record on
the round's card (`riot`: the second, the killer's agent, the gun, after the
plant or not, the kill feed, and `dist`, the killer's distance in metres
where the record measured it), the round's side, the coach's look
(`forensics.cause`, as `death-causes.js recordCause` has it), the review's
counted mistakes and the player's flag. Every value nothing says is null.
It returns null for a review that is not Valorant, is locked or has no
review id of `review-store.js`'s shape, a round that is not there, a round
the player did not die in or sat out (`afk` or `inSpawn`), and a death that
holds nothing beyond "died": no distance, no gun class, no second, no known
killer and no cause other than `unclear`.

It returns `{ id, reviewId, round, at, map, agent, title, line, spec }`.
`id` is `<reviewId>:<round>`, `title` "Round N", `agent` and the killer only
as an agent the game data knows, and `line` one sentence from the known facts
only, such as "Killed by Jett with a rifle from 12 metres, 20 seconds into
the round, on attack." ("up close" under 5 m, "after the plant" in place of
the second). The `spec`:

- `dist`: the killer's distance, metres to one decimal, or null.
- `range`: close, mid or long (THE RANGE RULE, `rangeOf`): from the distance,
  under 10 m (`CLOSE_UNDER`) close, over 25 m (`LONG_OVER`) long, else mid;
  with no distance, from the gun's class, a sniper long, an SMG, a shotgun or
  the knife close, anything else and no gun known mid.
- `killerWeapon`: the gun's class, one of `CLASSES` (rifle, sniper, smg,
  shotgun, pistol, heavy, melee, ability) or null. `WEAPON_CLASS` maps every
  Valorant weapon by the name Riot's record and the game data use (the
  Shorty is a shotgun here, since what a replay needs is the range it kills
  from); a name in any agent's kit (Headhunter, Blade Storm) is `ability`;
  anything else null. `test:trainerreplay` holds that every weapon in the
  game data has a class.
- `side`: attack, defence or null. `afterPlant`: true or false from the card,
  null with no record.
- `cause`: the look's cause, or null.
- `situation`: peek, hold, rotate or duel, by the look's cause, or with no
  known cause by the first fact that holds in `FACT_ORDER` (first-death on
  attack, same-spot and same-killer from the review's counted mistakes,
  early, one-v-one from the clutch, caught-alone, untraded when a teammate
  was alive to trade):

  | Situation | Keys |
  | --- | --- |
  | peek | dry-peek, repeek, overextend, first-death |
  | hold | crossfire, same-spot, exposed, early |
  | rotate | rotating, isolated, caught-alone, untraded |
  | duel | lost-duel, same-killer, one-v-one, no-escape, unclear, and any key the table does not name |

- `enemies`: 1 to 3, the killer and each other enemy the player killed in
  the 3 s (`FIGHT_MS`) before the death in Riot's kill feed, at least 2 for
  a crossfire.
- `flagged`: the player flagged that round and Riot confirms a death in it.

`replaysOf(reviews, { max })` is the replayable deaths of saved reviews (or
library entries `{ id, at, review }`): newest match first, the flagged deaths
first within a match, then by round, each review once, at most 30
(`MAX_DEFAULT`, 500 at most when asked). `markRounds(review, cards)` gives
each card a death can be replayed from its replay id as `replay`.
`parseOpen` reads `replay:<reviewId>:<round>` and `openId` writes it.

### Where the distance comes from

The server keeps one number per death, the killer's distance in metres, and
nothing of any position (`server/services/riot-rounds.js killDistOf`): the
killer's own place in the kill's `player_locations` against where the player
fell, flat distance, in Riot's world units taken as Unreal's centimetre (100
units a metre, `UNITS_PER_METRE`), to one decimal, as `perRound[].killDist`,
only for a death to an enemy. No key where the record does not place both
(a killer dead or out of the list, a v2 record without the locations) or the
distance is past 250 m (`KILL_DIST_MAX_M`). The client keeps it only as a
finite number inside the same 250 m (`valorant-verify.js recordExtras`), and
`valorant-review.js recordOnCard` puts it on a death's card as `riot.dist`.
riot-record.md, "The round record beyond the feed", has it beside the other
facts. Reviews made before this carry no distance, so `rangeOf` judges their
range from the weapon, and the page says so; the `duel` arena then lays the
fight out at that range's distance (below).

### The store and the channels

`trainer-store.js`, wired in index.js with `recent`, the last ten saved
Valorant reviews (`TRAINER_REPLAY_MATCHES`, `reviewStore.recent`), and
`review`, one saved review by id (`reviewStore.get`), so a review older than
those ten still opens its own death.

- `replays()` (`TRAINER_REPLAYS`): `{ list, fresh }`, `list` the
  `replaysOf` of the recent reviews, `fresh` the ids of those from matches
  newer than the state's `seenAt`, all of them before the first time.
- `seen()` (`TRAINER_REPLAYS_SEEN`): `seenAt` set to main's now, so the
  deaths so far are no longer fresh: `{ ok, seenAt }`. `seenAt` lives in the
  `trainer` key beside the runs, still schema 1 (`trainer-math.js
  emptyState`, `normaliseState`: a value saved before reads it as null).
- `open('replay:<reviewId>:<round>')` (`TRAINER_OPEN`): opens the Trainer
  page only when that replay exists (`replayFor`: the id parsed, the review
  found among the recent ones or by id, `replayOf` not null), and keeps both
  the id and the replay for the page.
- `get()` (`TRAINER_GET`): `{ runs, opened, replay }`; `opened` is the
  scenario or the `replay:` id asked for, `replay` the replay itself when one
  was opened, each answered once, then null.
- Every replay run saves under the one scenario id `replay`
  (`trainer-replay.js SCENARIO`), so they chart together.
  That id is in the store's set of ids a run may be saved or cleared under,
  and NOT in `trainer-scenarios.json`, on purpose: a replay is no scenario
  of the list, and the page's list and its tests read that file.

### The review's button

index.js `present` runs `markRounds` over a Valorant review's cards when it
serves one, never mid match or sealed, so a death the Trainer can replay
carries its replay id. The review page (`review.js deathExtras`,
`replayButton`) draws "Fight it again" beside Further explain only on a
died round whose `replay` matches the id's shape; a click is
`review-preload.js openReplay(id)`, `TRAINER_OPEN` with `replay:<id>`, and
main checks the id again. ui.md has the row.

### The page

`app.js`. `load` asks for the runs, then the replays; a replay opened from a
review that is not in the list (an older review's death) is put first, and
so is one that has left main's list while it is selected, asked for or being
played (`free` does the same before a run starts).

- **Your deaths**: above the scenarios, one row a death, "Round N, <map>"
  over its line, with the replay glyph; a fresh death's glyph is ringed, a
  flagged one says Flagged, and the one a review sent says From your review.
  The newest five show, with the selected one and the one asked for always
  among them, and Show all N (then Show fewer) for the rest.
- **The prompt for the newest match**: while any death is fresh, `#fresh`
  above the list says "Your last match on <map> has N deaths you can fight
  again. Pick one under Your deaths.", counting the newest fresh match's
  deaths alone, with Got it. Got it, or starting any replay, clears it and
  sends `TRAINER_REPLAYS_SEEN` (`seenReplays`).
- **`replayScenario(id)`**: a replay as a scenario the run code plays: id
  `replay`, `pick` the replay's own id, the title "Round N, <map>", arena
  `duel`, kind `replay`, no limit, `botShoot` true (so the player wears
  armour), `about` the line and `spec` the replay's spec.
- **Its panel**: "Your death, 5 fights, they shoot back", the title, the
  line, "Your review sent you here to fight this one again." when a review
  sent the player, and in place of the stats "Laid out from Riot's record of
  this death: N metres away, what they held and how it began. It is not the
  place it happened.", or with no distance "...This match was reviewed
  before distances were kept, so the range is judged from the weapon...".
- **The `duel` arena** (`world.js duel(spec)`): the enemy `dist` metres off,
  or with no distance by `spec.range` (close 6 m, mid 15, long 34, and 15
  with none), held between 4 and 45; the yard's width and length
  from that, a white line every 5 m from the player toward the enemy, the
  charge beside the player after the plant, and up to three enemy places
  laid out by situation:
  - peek: a wall across the player's front ending just to their right, and
    enemies already holding past its end, fanned out at their distance.
  - hold: the player behind a cover block, and enemies who wait behind walls
    at the far end and swing out.
  - rotate: the player in the open, a block ahead, and enemies who wait on
    the far side of pillars off to the side and step out sideways, clear of
    the pillar.
  - duel: face to face across the yard, a block near each end, enemies
    holding.

### The fight

`scenarios.js` kind `replay`. A run is five fights (`replay.fights`), each
against `spec.enemies` enemies (1 to 3, no more than the arena lays out).
Each fight waits 0.9 s, then the enemies appear: one that holds is there
already, one that swings waits 0.5 to 2 s more (0.9 s more for each after
the first) and steps out. Each wears 50 armour and has 100 HP, and shoots
with the gun of the class that killed the player
(`trainer-data.json replay.guns`: rifle, sniper, smg, shotgun, pistol or
heavy; a melee, ability or unknown class fights as a rifle): its damage a
hit, its taps a second, its chance once settled and its reaction.

A fight ends when every enemy in it is down (won, 1 s after) or the player
is (lost, 1.3 s after); then `engine.respawn` stands the player at the start
again, whole and with every magazine full, the field cleared, while the
run's clock and counts carry on. After the fifth fight the run is done. The
HUD line is "Fight N of 5, won W", then "Won W of 5". The report puts Fights
won, "W of 5", in place of Kills, and Kills in place of Damage taken or
Time; damage taken is not counted in a replay. A replay's report shows no
best (no New best, Best or First run, and no dashed best line), only the
chart of the last 20 replay runs. Its note is "You won every
one of them. That fight is yours now.", "You lost this fight in your match
and won it W times out of 5 here." or "Not yet. Try it slower: get your
crosshair where their head will be before you can see them.". Next is the
next death in the list.

### Never mid match

None of it shows or runs mid match or sealed. The Trainer page and the
review page are sealed like every page (`syncSeal`). `present` marks no
replay on a card mid match or sealed, so no button is drawn then.
`trainer-store.js` refuses through `busy`: `TRAINER_REPLAYS` and
`TRAINER_GET` answer null, `TRAINER_REPLAYS_SEEN` and a replay run's
`TRAINER_SAVE` answer `{ ok: false, error: 'match' }`, and
`TRAINER_OPEN` with a `replay:` id opens nothing. The page's `begin` asks
`TRAINER_GET` first and starts nothing on a null. `check:seal` holds every
one of those mid match, and that no `seenAt` is stored.

## Weapons

`gun.js`. A shot leaves only when the weapon is up and not reloading, the
fire interval has passed and there is a round. The bullet leaves along the
view plus the recoil built before it, plus a point evenly in the spread cone
(`spread`); its own kick (`recoilKick`) moves the crosshair for the next.

- **The spray**: `sprayAfter(w, shot, idleSec)` is the bullet's place in the
  spray after a rest. Within 1.05 fire intervals of the last bullet nothing
  comes back (holding the trigger is no rest); at the weapon's recovery time
  or later it is 0; between, it falls in a straight line to 0, rounded. The
  next bullet's place is that plus one. Once a fire interval and 12 ms have
  passed since the last bullet, the recoil settles back, falling off at
  3.2 / recoverSec a second (`recover`).
- **Aim down sights** eases in: each frame `st.ads` closes dt x 16 of its gap
  to 1 (`adsAmount()`), the view model slides to the eye, and the view's zoom
  follows it, 1 + (zoom less 1) x `adsAmount()`, through `zoomedFov`. The
  rifles zoom 1.25; the Heavy pistol has no alt fire and the Light pistol's
  is its burst.
- **The view models** come from `models/guns.js`, one packed mesh per weapon
  (`heavy-rifle`, `silenced-rifle`, `heavy-pistol`, `sidearm`, `knife`) with
  its forearms and gloved hands in it and where its muzzle is: a battle
  rifle, a carbine with a suppressor, a revolver, a compact pistol and a
  combat knife (the sources above). Each mesh is unpacked once and kept
  across runs. `VIEW` says where each is held at rest (`hip`, `turn`) and
  how far ahead aimed (`ads`); how far below is worked out from the mesh so
  its highest point stays 3 degrees under the line of sight (`CLEAR`) and
  the crosshair is never covered. They are lit by `kit.js LIT` in their own
  scene. Each frame's pose lags a turn, bobs with the steps, kicks on a shot
  and springs back, dips through a reload, rises when drawn and dips on
  landing. A shot shows a muzzle flash for 0.03 s (kept small when aimed)
  and lights the gun from its muzzle; the silenced rifle shows none.

`createGuns(N, loadout, seed)` returns `{ scene, st, slots, cur, weapon(),
id(), equip, reload, fire, recover, pose, setTrigger, setAlt, zoom(),
adsAmount(), reloading(), reloadProgress(now), reset(now), dispose() }`; the
module also exports `rng(seed)`.

## Scoring

`trainer-math.js report(r)` turns what the page counted into kills, bots,
shots, hits, accuracy, headshot share, first bullet hit share, mean time to
kill, mean reaction and mean stop time (ms), damage taken, died and seconds.
Reaction and time to kill count from the moment a bot is first on screen with
nothing between it and the player; the stop counts from letting go or
pressing against at 90% of the run speed or more until under the gate.

`killPoints(ttkMs, head)`: 100 a kill, 50 more for a head kill, up to 100
more for speed (a kill in 300 ms or less earns all of it, 1500 ms or more
none); the HUD pops it as each kill lands. `score(r, rep)`: the kills'
points times the accuracy factor (half the score always, the other half by
accuracy), less 2 a point of damage taken; clearing every bot inside a time
limit without dying adds 10 a second left. Never below zero.

The report: the scenario's name (", you were killed" when the player died),
the score counting up once through CSS (`--tr-n`, a registered integer
property shown by a counter, over 900 ms, at once with reduced motion), "New
best, N more than before", "Best N" or "First run", a chart of the last 20
scores with the best as a dashed line, and the stats. Each stat shows its
change from the last run of that scenario ("+4% from last run", "Same as
last run"), green when better and red when worse, lower being better for
reaction, time to kill, stop time and damage taken. Stats a scenario never
measures are left out: Spray control drops Headshots, Reaction, Time to kill
and Stop time, and the range drills other than Counter-strafe drop Stop time.
Notes follow (a replay's result, shots fired while moving, each spray's
hits, bots that got away, no raw input, a run that could not be saved). R is
Retry, Enter is Next (the next scenario in the file, the next death for a
replay, or Retry on the last) and Esc goes back to the scenarios, each only
700 ms after the report shows, so a reload pressed as the run ended is no
Retry.

## Storage and settings

- **Runs**: the store's `trainer` key, `{ schema: 1, runs: [...], seenAt }`
  (`trainer-math.js SCHEMA`, `normaliseState`, `addRun`; `seenAt` is Fight
  it again's, above). Each run is cleaned field by field (`cleanRun`), its
  time is main's own, the runs are kept oldest first and only the newest 500
  (`RUNS_MAX`); a missing, malformed or other schema value reads as nothing
  saved, never a throw. A run of a scenario `trainer-scenarios.json` does
  not name is refused, except the replay's one id `replay`. The report's
  "New best" is main's answer (`best`). Settings' Clear every run takes them
  all (`TRAINER_CLEAR` with null; one scenario's id clears that one).
- **Settings**: one config key, `trainerSettings` (`config.js` default null,
  the defaults then shown), as `normaliseSettings` makes it: `{ v, sens, dpi,
  scoped, graphics, fps, volume, primary, secondary, enemy, binds, crosshair
  }`. `enemy` is the bots' outline colour (yellow, red, purple or cyan,
  `ENEMY_COLOURS`). `binds` holds eleven actions, forward, back, left, right,
  walk, crouch, jump, reload, primary, secondary and knife (`BIND_ACTIONS`).
  THE RULE: `CONFIG_SET` takes it only as the whole object
  `normaliseSettings` makes (`config-keys.js`, `validSettings`: it must
  already be exactly its own normalised form), so a partial or out of bounds
  value is dropped, and `CONFIG_GET` hands it back normalised
  (`register-ipc.js snapshotConfig`). Binds on one key twice put every bind
  back to its default (the page swaps two binds instead of doubling one).
  The crosshair can be read from a crosshair profile code pasted from the
  game's settings (`parseCrosshairCode`, the primary profile only). Sens
  defaults to 0.4 at 800 DPI; the Settings pane shows the centimetres and
  inches for a full turn, and the pause panel has its own sensitivity field.
  The page saves 250 ms after the last change.

## Practice's Train this

A drill in `drill-library.json` may carry `trainer: "<scenario id>"` when a
scenario truly trains what the drill asks; only the aim, peeking and pre-aim
drills do (`test:drilllibrary` holds the list of causes allowed). `practice.js
normDrill` keeps it only when it is a string matching `/^[a-z0-9-]{1,48}$/`
that `trainer-scenarios.json` names; the Practice card then shows Train this,
which sends `TRAINER_OPEN` with the id (`practice-preload.js openTrainer`).
Main checks the id, keeps it as `pending`, opens the Trainer page and pushes
`PUSH_TRAINER`; the page's next `TRAINER_GET` gets it once as `opened`. The
page then goes back to the menu if a run was on screen, shows the Scenarios
tab, selects that scenario (its level chosen in the panel for a pair), marks
its row and scrolls it into view, and the panel says "Practice sent you here
for this one." Nothing starts until the player presses Play or Enter or
double clicks the row. A review's Fight it again takes the same path with a
`replay:` id (above). Detail of the card: ui.md, "The Practice page".

## The seal and silence

The Trainer is a page like every other: locked by `syncSeal` mid match
(screen-silence.md), so it is never on screen then, and its loop, which runs
only while the page is shown with the pointer locked, cannot run then. Main
answers every channel with nothing mid match or sealed (`trainer-store.js`,
`deps.busy` is `matchInProgress() || windowSealed()`): `TRAINER_GET` and
`TRAINER_REPLAYS` null, `TRAINER_SAVE`, `TRAINER_CLEAR` and
`TRAINER_REPLAYS_SEEN` `{ ok: false, error: 'match' }`, and `TRAINER_OPEN`
opens nothing, a scenario or a replay. Channels: ui-rules-ipc.md, "The
Trainer's channels".

## The Ctrl+Shift keys while the Trainer has the mouse

WHY. Main holds five global shortcuts (`hotkeys.js BINDINGS`):
Ctrl+Shift+P, M, S, E and H. A global shortcut is taken before any page sees
the key. In the Trainer Ctrl is crouch and Shift is walk by default, so
crouch-walking back (Ctrl+Shift+S) would open Settings mid run, and
Ctrl+Shift+E, H, M and P would each fire too.

HOW.

- The page sends `TRAINER_PLAYING` with true when the pointer locks on its
  canvas and false when it goes (`app.js`, `pointerlockchange`).
- `register-ipc.js` takes a true only from the Trainer's own view (the
  sender's URL is `renderer/trainer/index.html`); a false from anywhere
  resumes.
- `index.js trainerIpc.playing(on)`: with true, and no match in progress,
  the window not sealed and the Trainer in front (`trainerInFront`: the main
  window exists, is focused and not minimised, is not sealed and shows
  `trainer`), `hotkeys.suspend()` unregisters the five; anything else calls
  `hotkeys.resume()`, which registers them again with the actions they were
  first given.
- A 1 s tick in index.js takes them back whenever they are suspended and the
  Trainer is not in front, or a match is in progress, or the window is
  sealed, so a page that died while locked cannot keep them.
- The flag key (death-flags.md) is untouched: `suspend` lets go only of
  `BINDINGS`, and the flag key is held only mid match, when the Trainer is
  sealed.

## Sounds

Every sound is synthesised in `audio.js` with Web Audio, from filtered noise
and tones: four shots, a bot's shot, reload, equip, an empty click, three
footsteps, a landing, a body hit, a head hit, a kill, being hit, and the
countdown beep, go and finish. Each is drawn once, offline, into a buffer
(`OfflineAudioContext`) when the page loads. The loud ones, the five shots,
go through a short room: a convolver whose impulse is seeded noise dying
away, mixed in at each shot's own share, so a shot has a tail. Every sound is
then levelled to one peak and set to its own place in the mix (`LEVEL`).
They play through one gain (the Trainer's volume) and a limiter (a
`DynamicsCompressor` at -6 dB, ratio 12) so a spray with a kill on top never
clips, with stereo panning by where a sound comes from. The `AudioContext`
starts on the gesture that locks the pointer and is suspended while paused.
Footsteps sound only when running, every 2.2 m; walking and crouching are
silent, as in the game. Nothing is recorded, downloaded or taken from any
game, and no audio file ships. With the app's Sounds switch off the Trainer
is silent and says so, and it asks again on every state push.

Generating sounds with ElevenLabs through Composio was tried on 18 Nov 2026
and is blocked until the owner links his own paid ElevenLabs account; a paid
plan is what gives a commercial licence for what it generates.

## The owner's calibration check

Two minutes against the game's own Range, with the same sensitivity and DPI
in both:

1. One full swipe across the mouse pad in the Trainer's Calibration scenario
   turns the same angle as the same swipe in the game's Range (the Trainer
   counts the degrees turned; the reload key resets the count).
2. Running the 20 m lane at full speed takes the time the HUD line shows, 20
   m at the run speed of the weapon in hand (3.70 s with a rifle), and the
   lane's own time is shown beside it.

Any mismatch is fixed in `trainer-data.json`, with its source and a note,
never in code.

## Not in v1, on purpose

Flash dodging, smokes, leaderboards, community drills and scoped snipers.

## How to verify

- `npm run test:trainerphysics`: the maths against the data file, the
  scenarios file (16, on the six arenas the file may name), the state's
  `seenAt`, main's half on a fake store, and the list of unverified numbers.
  607 checks on 19 Nov 2026.
- `npm run test:trainerreplay`: Fight it again, `trainer-replay.js` and
  `trainer-store.js`: the shape on the sample library's reviews
  (`scripts/fixtures/proof-reviews.js`), every null case, every cause key to
  one situation, every weapon in the game data to one class, the range rule,
  the line's words (no Riot ID, no #, no dash), `replaysOf`'s order and cap,
  the review's marks, and main's half on a fake store (refused mid match,
  fresh and seen, a replay opened by its id, a replay run saved). 153 checks
  on 19 Nov 2026.
- `npm run check:trainer`: the page booted for real in the one window, on its
  menu with no loop, its 16 scenarios listed with a row for each, a scenario
  selected and played with a gesture click on Play, stopped when told to
  leave and when another page shows, the keys let go and taken back, and
  nothing off this PC (every request the page makes is `file:` or
  `devtools:`). It opens an Electron window.
- `npm run check:seal`: the Trainer's channels, the replays included, mid
  match. `npm run test:riotrecord`: `killDist` from the record to the card.
  `npm run test:surfaces`: the review's Fight it again button.
- `npm run test:practice` and `npm run test:drilllibrary`: Train this.
- THE ES MODULES' SYNTAX. The page's files (`app.js`, `engine.js`,
  `world.js`, `bots.js`, `gun.js`, `kit.js`, `scenarios.js`, `audio.js`)
  are ES modules, and `node --check file` does not catch a syntax error in
  one. Check each with `node --input-type=module --check < file`.
- Look at it in the real app: open the Trainer, play a scenario with the
  pointer locked, crouch-walk back with Ctrl+Shift+S and see Settings not
  open, press Esc and see the keys come back. A pose that is right in
  Blender's preview can still be wrong under the page's light.

Measured in real runs on 18 Nov 2026 on the owner's PC (RTX 5060, 240 Hz),
before the models and the night look:

- Frame time median 4.2 ms and 99th percentile 4.3 ms, in a run with nothing
  capturing the page (`lastFrames`).
- 1000 mouse counts at sensitivity 0.4 turned 28.0 degrees.
- The 20 m lane took 3.70 s at the rifle's 5.4 m/s.
- Run, walk, crouch and knife speeds read 5.400, 3.240, 1.890 and
  6.750 m/s.
- The jump's apex read 1.14 m sampled, against 1.165 m computed.
