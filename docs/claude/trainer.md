# The Trainer

An aim and movement trainer that runs entirely in the main window's Trainer
page, the tab right after Practice (`shell-nav.js` `trainer`). It has no AI
and makes no network call: a run is simulated in the page, kept on this PC,
and nothing of it leaves the PC. Practice's drills link into it ("Train
this", below), and it is sealed mid match like every page.

The point of it is feel that matches the game: the same degrees per mouse
count, the same field of view, the same run speeds, the same accuracy gate
and the same moving errors, so practice here carries over. Everything else
(the arenas, the figures, the guns' look, the sounds) is our own.

## The hard line: nothing of Riot's

The Trainer takes numbers and feel from Valorant and nothing else. No map
geometry (every arena is plain boxes built for a situation, never traced from
a map), no models, textures, sounds, agent names or HUD art, and no weapon's
name on its profiles. The four weapon profiles have plain names, Heavy rifle,
Silenced rifle, Heavy pistol and Light pistol, and `trainer-data.json` notes
which game weapon's numbers each one follows (`follows`: Vandal, Phantom,
Sheriff, Classic). The Settings pane says it in one line for the loadout
chosen, "Each uses one weapon's numbers: the heavy rifle the Vandal's, the
heavy pistol the Sheriff's." (`app.js paintSettings`, `#s-follows`); that
line is the only place a game weapon is named on screen. The figures, guns
and arenas are built in code from a few shapes (`kit.js`, and boxes in
`world.js`); no model, texture or sound file ships. three.js r170 is vendored
unchanged (`src/renderer/trainer/vendor/three.module.min.js`, MIT,
`native/three-NOTICE.txt`).

## The files

| File | What it does |
| --- | --- |
| `src/shared/trainer-data.json` | Every number the Trainer runs on, each with its unit, source, patch and whether it is verified (below). |
| `src/shared/trainer-math.js` | The pure maths, run by main, the tests and the page alike (a classic script there, `window.OcclaraTrainerMath`): `numbers`, `unverified`, sensitivity and field of view, `stepGround` and `stepAir`, spread, `sprayAfter`, recoil, damage and armour, the settings' normalising and the crosshair code, a run's `report`, `killPoints` and `score`, and the store's state. |
| `src/shared/trainer-scenarios.json` | The 12 scenarios: id, title, arena, kind, level, limit, bots, botShoot, about, and `causes`, the review's mistake keys each trains. No scenario names a weapon or an HP. |
| `src/main/services/trainer-store.js` | Main's half: the runs in the store's `trainer` key, the scenario Train this asked for, and every call quiet mid match. `open(scenarioId)` shows the page on that scenario. |
| `src/preload/trainer-preload.js` | The bridge: the two data files (copied once), config read and the `trainerSettings` write, the runs, whether the pointer is locked, the pushes. |
| `src/renderer/trainer/index.html`, `trainer.css` | The page: the rail (the scenario list and the settings), the stage (the canvas, the crosshair canvas, the scenario's panel, the HUD, the pause and the report). CSP `default-src 'self'`. |
| `src/renderer/trainer/app.js` | The page's logic: the rail and the panel, the settings, a run from its countdown to its report, the HUD, the pointer lock, telling main when the lock comes and goes, and the debug handle `window.occlaraTrainer`. |
| `src/renderer/trainer/engine.js` | The simulation and the renderer: the fixed tick, input, collision, shooting, the bots' shots at the player (`BOT_GUN`, `HURT_GAP`), interpolated frames, and the menu's still (`preview`). |
| `src/renderer/trainer/world.js` | The four arenas as boxes merged into one mesh (the same boxes are the collision), the world's shader, the contact shadows, the sky dome, the floor chevrons, the plan the menu draws (`arenaPlan`) and `rayWorld`. |
| `src/renderer/trainer/bots.js` | The training dummies: instanced body and head, their outline and shadow, the fall when killed, analytic hitboxes (a head sphere, body and leg capsules), movement on the player's own `stepGround`, shooting back on hard levels (`FIRING_MAX`). |
| `src/renderer/trainer/gun.js` | The four profiles and the knife: equip, reload, fire rate, the Light pistol's burst, spread, recoil and its recovery, aim down sights easing in (`adsAmount`), and the view models built from `kit.js` parts. |
| `src/renderer/trainer/scenarios.js` | Each kind's rules: where bots appear and move, when the run is done, the HUD line, and the hard level's bot numbers (`SHOOTS`). |
| `src/renderer/trainer/audio.js` | Every sound, synthesised with Web Audio (below). |
| `src/renderer/trainer/kit.js` | The modelling kit: boxes, cylinders, capsules and spheres merged into one geometry with a vertex colour per part (`merge`), so a figure or a gun is one draw. |

## The page: a rail and a stage

`index.html`, `trainer.css`, `app.js`. The rail (392 px wide, 340 below a
1180 px window) shows only in the menu and has two tabs, Scenarios and
Settings. The stage is the 3D view and what lies over it: in the menu the
selected scenario's panel over a still of its arena, in a run the HUD, then
the pause or the report over the last frame drawn.

- **The list**: the 12 scenarios in 9 rows, under Range (the six range drills,
  each with its own glyph) and Arenas (the three arenas, each with a plan of
  it from above, `world.js arenaPlan`). An Easy and Hard pair of one arena and
  kind is one row ("Easy and Hard"), and the level is a control in the panel
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
`select(id)`, `sounds` ([drawn, of how many]), `player` (`{ x, y, z, speed,
ground, crouch, hp, armour }`, read only), `frameTimes()` (the ring's frame
times in ms), `lastFrames` (`{ n, p50, p99 }` of the last run, set as it
ends) and `scenarios()` (the ids). `check:trainer` reads `phase`, `playing`,
`raw`, `scenarios()` and `frameTimes()`, and plays a scenario through
`select(id)`, read back with `selected`, and a gesture click on `#play`;
`check:mainwindow` reads `scenarios()` and `playing`.

## The loop

`engine.js`. The simulation steps at a fixed 128 Hz (`tick`, Valorant's tick
rate) from an accumulator; rendering runs every animation frame and draws the
player, the crouch and the bots between their last two ticks (`draw(acc /
TICK)`). A frame longer than 0.25 s is cut to 0.25 s. Mouse look is applied on
every `mousemove` event, never per tick, so a turn reaches the next frame
drawn. The arena and the bots are one scene; the gun is its own scene with
its own camera (62 degrees), drawn over after a depth clear.

What is made inside the loop, precisely. The engine's per tick state lives
in objects made once and reused: the player, the wish and move vectors, the
ray hit and the shot's result (`hitOut`, `res`), the eye, the direction and
the matrices, the damage target for a bot's hit, the tracer, mark and puff
pools, and the frame time ring of 1200. Still made each time: the gun's
answer for each bullet that leaves (`guns.fire` returns a new object, and
`{ dry: true }` on an empty click), the Web Audio nodes of every sound played
with the name strings of shots and steps, and a bot's spawn. The page's frame
hook (`app.js onFrame`) moves the crosshair only when the recoil changes by
half a pixel or more and, with the firing error on, builds one small object
a frame for `spread`. The HUD (`paintHud`) is painted every 80 ms: it runs
`report` over the counters and builds its strings then, and writes an
element only when its text changed (the magazine size beside the ammo is
written every time). The frames per second line is redrawn every 0.4 s
when it is on.

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
`verified` is not true (51 today), which `npm run test:trainerphysics` lists
for the owner. `verified: true` means an official Riot source, or the wiki
citing a patch, states it, or two independent sources agree. `verified:
false` means one community measurement, a value worked out, or the
Trainer's own design.

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
spacing.

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

`world.js`. Every arena is boxes in our own colours, merged into one mesh;
the same boxes are the collision.

- **range**: a walled range with a yellow firing line and a line every 5 m
  down to 55 m, pilasters and beams every 12 m. On the right, the calibration
  lane: 20 m from the yellow line, a mark every 5 m. Straight behind the
  start, a post to turn a full circle on.
- **site**: a corridor ("the main") into a sandstone site with a link off its
  east wall, a default box in a painted plant square, a tall stack, a short
  box, a back platform and a pillar. Fourteen spots bots may stand on and a
  route the floor chevrons draw.
- **lane**: a long main with three cubbies, a brick choke at its far end and
  the player's crate at the near end, a line every 10 m.
- **stack**: a building front with two doors, a wide opening, an upper window
  and a balcony 4 m up, with five spots: jiggle peeks, wide swings and a
  strafe across the opening.

### The look

The world has no lights and no shadow maps. One shader in `world.js` lights
every face from a fixed sun and a sky and ground light by the way the face
looks; a wall that stands on a floor darkens toward it and wears a skirting
band; every face carries a fine grid of 1 m with a stronger line every 4 m,
faded where its cells shrink to a few pixels; every face has a lit edge, so a
box reads against a wall of its colour; and distance fades into the
horizon's colour (from 55 m to 230 m). Contact shadows are flat quads on the
floor round every solid box that stands on one, wider and darker the taller
it is. The sky is a dome that follows the camera, with the same horizon.

### Bots

`bots.js`. Our own figure, a training dummy in a dark suit with a pale head,
built from `kit.js` parts. The body and the head are each one instanced mesh
(up to 16 bots), lit by a hemisphere light and a sun the bots add to the
scene for their own material; the world's shader ignores them. Over each, an
outline pass draws the same hulls pushed out 2 px and inside out, in the
colour the `enemy` setting names (yellow, red, purple or cyan, `OUTLINES`),
turning white for a moment when hit and as it falls; under each, a soft
round shadow. A bot
killed falls over 0.26 s (it swells a little, then folds into the floor),
and the bots' tick, which the engine runs, takes it away after that. Hits
are worked out analytically, a ray against a head sphere and two upright
capsules (body and legs), never by picking the scene. Bots move on the
player's own `stepGround` at the Heavy rifle's run speed, so a strafing
bot's stop takes the time a real stop takes. Every bot has 100 HP; Spray
control's target never dies.

### Bots that shoot back

Only a scenario with `botShoot` (the Hard levels). The numbers, exactly:

- `scenarios.js SHOOTS`: each bot reacts 0.45 s after it sees the player,
  taps 1.6 times a second, hits with a chance of 0.14 once settled, and wears
  50 armour.
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
  the body, with the Light pistol's damage (`BOT_GUN` `sidearm`, 26 to 30 m
  and 22 past it, before armour); it tags the player (72.5% slower for
  0.3 s), plays the hurt sound and flashes that side of the HUD. At 0 HP the
  run ends and the report says "you were killed".
- Measured, as `scenarios.js`'s comment records: tuned on the site so that
  standing in the open in front of the whole site lasts about twenty
  seconds, and a player who clears each angle as it opens loses little.

The player has 100 HP and, only when the bots shoot back, 50 armour.

### Scenarios

The 12 scenarios (`trainer-scenarios.json`, rules in `scenarios.js`). A
scenario names no weapon and no HP (`test:trainerphysics` holds that the
fields are gone): a run is played with the loadout chosen in Settings
(`engine.load` arms the player with `settings.primary` and
`settings.secondary`), and every HP is the data's 100. Of the rest the page
reads `botShoot`, which is what makes a level hard: the bots shoot back and
wear armour, the player wears armour and the HUD shows HP, the panel says
"they shoot back", the report lists Damage taken in place of Time, and a
wide swing on the stack holds 1.8 s, not 1.4. `level` only names the pair
(the level control and "Site retake, Hard"). The time limit runs on every
level that has one.

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

The page names a scenario with its level as "Site retake, Hard" in the pause
and the report title; the row says "Easy and Hard" and the panel's level
control picks one.

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
- **The view models** are built in `gun.js` from `kit.js` parts, one merged
  geometry each with an accent colour per profile, a gloved hand on the grip
  and, on a long gun, one under the barrel. The rifles are carbines with an
  end cap and no stock; the silenced rifle carries a silencer and shows no
  muzzle flash. They are lit in their own scene by a hemisphere and a
  directional light. Each frame's pose lags a turn, bobs with the steps,
  kicks on a shot and springs back, dips through a reload, rises when drawn
  and dips on landing; a muzzle flash shows for 0.03 s.

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
Notes follow (shots fired while moving, each spray's hits, bots that got
away, no raw input, a run that could not be saved). R is Retry, Enter is Next
(the next scenario in the file, or Retry on the last) and Esc goes back to
the scenarios, each only 700 ms after the report shows, so a reload pressed
as the run ended is no Retry.

## Storage and settings

- **Runs**: the store's `trainer` key, `{ schema: 1, runs: [...] }`
  (`trainer-math.js SCHEMA`, `normaliseState`, `addRun`). Each run is cleaned
  field by field (`cleanRun`), its time is main's own, the runs are kept
  oldest first and only the newest 500 (`RUNS_MAX`); a missing, malformed or
  other schema value reads as nothing saved, never a throw. A run of a
  scenario `trainer-scenarios.json` does not name is refused. The report's
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
double clicks the row. Detail of the card: ui.md, "The Practice page".

## The seal and silence

The Trainer is a page like every other: locked by `syncSeal` mid match
(screen-silence.md), so it is never on screen then, and its loop, which runs
only while the page is shown with the pointer locked, cannot run then. Main
answers every channel with nothing mid match or sealed (`trainer-store.js`,
`deps.busy` is `matchInProgress() || windowSealed()`): `TRAINER_GET` null,
`TRAINER_SAVE` and `TRAINER_CLEAR` `{ ok: false, error: 'match' }`, and
`TRAINER_OPEN` opens nothing. Channels: ui-rules-ipc.md, "The Trainer's
channels".

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
  scenarios file, main's half on a fake store, and the list of unverified
  numbers. 552 checks on 18 Nov 2026.
- `npm run check:trainer`: the page booted for real in the one window, on its
  menu with no loop, a scenario selected and played with a gesture click on
  Play, stopped when told to leave and when another page shows, the keys let
  go and taken back, and nothing off this PC. Passing on 18 Nov 2026 with 21
  requests by the page, all `file:`.
- `npm run test:practice` and `npm run test:drilllibrary`: Train this.
- Look at it in the real app: open the Trainer, play a scenario with the
  pointer locked, crouch-walk back with Ctrl+Shift+S and see Settings not
  open, press Esc and see the keys come back.

Measured in real runs on 18 Nov 2026 on the owner's PC (RTX 5060, 240 Hz):

- Frame time median 4.2 ms and 99th percentile 4.3 ms, in a run with nothing
  capturing the page (`lastFrames`).
- 1000 mouse counts at sensitivity 0.4 turned 28.0 degrees.
- The 20 m lane took 3.70 s at the rifle's 5.4 m/s.
- Run, walk, crouch and knife speeds read 5.400, 3.240, 1.890 and
  6.750 m/s.
- The jump's apex read 1.14 m sampled, against 1.165 m computed.
