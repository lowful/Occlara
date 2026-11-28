# Occlara's visual system, as built: Orbit (27 Nov 2026)

This records what the renderer draws, read from `src/renderer/shared/theme.css`,
`ui.css`, `motion.css`, `motion.js`, `sky.js`, `seg.js`, `subnav.js` and the surface
stylesheets. The contract it is built from is `ORBIT-SPEC.md` (the owner's redesign
folder); the rules for working on it are in `docs/claude/ui-rules-ipc.md`; the window,
the seal and the pages are in `docs/claude/ui.md`. When the code and this file
disagree, fix one of them in the same change.

## The idea

Occlara in Fomo's language: an indigo black sky where the moon that is the logo
hangs at planet scale, the player's agent floats in front of it, and the
review arrives as a notification that opens. Cards on the sky, each holding an
eyebrow, a title and one real fragment of the product. One accent, indigo, kept for
the few things that are the app's own actions. Motion is buttery: it transitions,
reverses where it is interrupted, and settles on a spring. Nothing shows, moves or
plays during a match but the Recording screen's arrival and its facts changing.

## What is built

Phase 1 (feat/orbit) rebuilt the foundation, the top bar and the Recording screen,
Home, and the review's hero. Phase 2 gave every other page Orbit's layout language:

- **THE PAGE HEAD** (ui.css, every page of the main window): the title at the display
  size, the page's controls beside it (the sub switch on Matches, Patterns, Stats and
  Practice), and a grey sub line under the whole row (`.page-sub`, the last child of
  the header, wrapped to a line of its own). It is the page's one hero: a page that had
  a second (Report a problem's question, Players' search heading) folds it into that line.
- **Cards and eyebrows**: each page's groups are cards on the ground with a mono
  eyebrow (Stats, Profile, Invite, What's new, Report a problem, Clips, the Matches
  trend); a card never holds a card, so Practice's sections stay on the ground and its
  drills are the cards, their steps numbered in raised circles as the reference draws them.
- **Clips** is the Moments page's name everywhere the player sees it (the link, the
  title, the window title); its id, files and channels keep moments.
- **The windows of their own** (onboarding, Sign in, weekly, learn, the AI log, the
  toast) read on the tokens in sentence case; Wrapped keeps its own look.
- Still the last layout under the new look: the Clips page is ruled rows, not the
  reference's frame grid (that wants a poster for every moment, and one exists only
  where a clip was kept); Settings is a page of cards, not the reference's sheet with
  its live preview; the profile menu's head (an avatar, the player, the game) is the
  shell's to draw.

## Ground, ink and the accent

All in `theme.css`, consumed everywhere as tokens (`check:palette` refuses a literal
outside it). Every name the surfaces consumed before Orbit is kept, its value moved.

| Token | Value | Job |
| --- | --- | --- |
| `--bg` | `#060510` | the ground, indigo black |
| `--card` (`--s1`) | `#12111A` | a card on the ground |
| `--raised` (`--s2`) | `#161522` | a raised control, a selected row, a segmented thumb |
| `--s3`, `--s4` | `#1C1B2A`, `#232233` | the steps above, for what still names them |
| `--line` | `#CBD0EB1A` | the hairline round a card, between rows |
| `--line-2` | `#CBD0EB2B` | a hovered card's, an input's, a control's |
| `--text` | `#F7F7F7` | the ink, 19.0:1 |
| `--text-2` (`--text-dim`) | `#9899A3` | the grey sub line, 7.2:1 |
| `--text-mute` | `#80818C` | a label, 5.3:1 |
| `--text-3` | `#474B52` | marks only, never words (2.2:1) |
| `--accent` | `#516AF6` | the accent |
| `--accent-2` | `#6F85FF` | its lighter step: an eyebrow, the keyboard's ring, the round under way |
| `--accent-t`, `--accent-tint` | `#516AF629`, `#C9D0FF` | its tint (an input's ring), the record dot under the pointer |
| `--btn`, `--btn-h` | `#606AF780`, `#606AF7CC` | the indigo glass Start is filled with, and under the pointer |
| `--btn-bar`, `--btn-bar-h` | `#4F59E0D9`, `#606AF7F0` | the bar's Start, denser over the moon |
| `--glass`, `--glass-h` | `#CBD0EB1F`, `#CBD0EB33` | the white glass of a primary |
| `--glass-q`, `--glass-q-h` | `#CBD0EB12`, `#CBD0EB24` | the quiet glass of every other control |
| `--won` (`--good`), `--lost` (`--bad`) | `#21C95E`, `#FF622E` | outcomes only, quiet |
| `--won-bar`, `--lost-bar`, `--todo-bar` | | the round tape's marks |
| `--gold-*`, `--silver-*`, `--bronze-*` | | the medals' metal, the review's SVG defs alone |
| `--close` | `#E5484D` | the window's close under the pointer |

The signal's old names point at the accent (`--red` and `--signal` are `#516AF6`,
`--on-accent` is white), so a surface not yet rebuilt still puts its Start in indigo.

**THE ACCENT'S PLACES, and nowhere else:** Start and Stop (`.btn-rec`, its record
icon), the recording dot, the selected round (the round under way on the tape), the
keyboard's focus ring, and a card's eyebrow. `check:palette SIGNAL_ALLOWED` lists the
exact rules, and its signal rule reads the accent's own names too. A destructive action
is coral (`--bad`), never the accent; a selection is the raised fill or the ink.

## Type

Onest, one variable file from 100 to 900 (OFL, `assets/fonts/onest-var.woff2`), for
everything read; Geist Mono 400 and 500 for eyebrows, times and columns of digits.
`font-synthesis-weight: none` on `html`.

| Role | Setting |
| --- | --- |
| Display (Home's fix, a page head) | Onest 40px (36 under 1100 wide), 700, -0.035em, 1.08 |
| The grade numeral | Onest 700, 84px on a card, larger on the review, -0.06em, tabular |
| Card title | Onest 22px, 700, -0.025em |
| Body | Onest 15px, 400, -0.011em (set on `html`) |
| Small | 13px |
| Eyebrow | Geist Mono 500 12px, uppercase, .06em, `--accent-2` (`.o-eyebrow`) |

Everything is sentence case: headlines, titles, sub lines, buttons ("Your fix for
next match", "Open last review"). The eyebrow is a label and stays uppercase. The
wordmark is "Occlara".

## Components (`ui.css`)

- **Buttons**, radius 12, a 1px `--line`, Onest 600 15px, 44px (`.lg` 52, `.md` 36,
  `.sm` 30):
  - `.btn-rec`: START, the loudest word in the app. The indigo glass (`--btn`) over a
    12px blur, the label 15px 700 in white on -0.01em (17px at `.xl`, the hero size),
    and the record icon beside the word (`.rec-ico`: a 14px ring of 1.5px in white at
    70% holding a 6px dot; under the pointer the dot takes `--accent-tint` and grows to
    7px over 160ms). Recording it is Stop (`.active`): the same glass quieter with an
    inset indigo glow, its dot squared into the stop glyph. The glow is still.
  - `.btn-primary`: the white glass (`--glass`), 700, the view's main action that is not Start.
  - `.btn`, `.btn-ghost`: the quiet glass. `.btn-link`: text alone, the quiet glass
    fading in under the pointer. `.btn-ghost.danger`: coral text and line, filled
    coral only while pressed.
  - The arrow: where the markup asks for one (`.btn-label` and `.btn-arrow`), the label
    sits 8px right at rest and the arrow slides in under the pointer or the keyboard,
    180ms on the smooth spring, by transform and opacity.
  - `.icon-btn`: 36px round in the quiet glass, squished to .86 by a press.
- **The card** (`.o-card`): `--card`, radius 24, a 1px `--line`, 28px in, `contain:
  paint`; one that leads somewhere (`.is-link`) takes `--line-2` and lifts 1px over
  200ms. `.o-eyebrow`, `.o-title`, `.o-display`, `.o-sub`, `.o-link` go in it. Cards on a
  screen are never all one size.
- **Input** (`.input`): 44px on the card's fill, radius 16, `--line-2`, the accent's
  ring when focused.
- **Switch** (`.switch`, `role="switch"`): 44 by 26, the knob sliding on the smooth
  spring; on, the track is the ink (the accent stays in its places).
- **Segmented control** (`.seg-slide`, `shared/seg.js`): one track on the card's fill,
  4px in, radius 12; the raised thumb settles on the smooth spring over 240ms.
- **The sub switch** (`.subnav`, `shared/subnav.js`): the pages one top link holds, a
  segmented control at the head of each of them (Matches: Matches, Patterns, Stats;
  Practice: Drills, Trainer).
- Keycaps (`kbd`, `--r-frame`), the viewfinder, the stat block, the live dot, the
  column grid: as before, on the new tokens.

## Radii by role

| Token | Value | Role |
| --- | --- | --- |
| `--r-card` (`--r-panel`) | 24px | a card |
| `--r-btn` | 12px | a button, the segmented track |
| `--r-in` | 16px | an input |
| `--r-tile` | 16px | a tile, a menu |
| `--r-control` | 10px | a small button, a nav link's focus ring, a chip |
| `--r-frame` | 6px | a keycap, a framed image (what `--r-card` meant before Orbit) |
| `--r-pill` | 999px | a true pill |

## Motion (the buttery part)

| Token | Value | Use |
| --- | --- | --- |
| `--ease-out` | `cubic-bezier(.23, 1, .32, 1)` | small UI, hovers |
| `--ease-enter` | `cubic-bezier(.16, 1, .3, 1)` | entrances |
| `--ease-drawer` | `cubic-bezier(.32, .72, 0, 1)` | sheets, drawers |
| `--spring-smooth` | `linear(...)`, no overshoot, about 520ms | a selection, the nav dot, an entrance |
| `--spring-gentle` | `linear(...)`, 1% over, about 600ms | a press releasing, a medal |
| `--dur-hover-in`, `--dur-hover-out` | 120, 220ms | a hover in and out |
| `--dur-press` | 90ms | a press going down |
| `--dur-select`, `--dur-nav` | 240, 420ms | a selection; the nav dot |
| `--dur-enter`, `--dur-sheet` | 480, 460ms | an element arriving; a sheet |
| `--dur-page-out`, `--dur-page-in` | 160, 380ms | a page leaving and arriving |
| `--stagger` | 40ms | six at most, then the rest together |

- **Transitions for state, keyframes only for one shot moments.** A hover, a press, a
  selection, an open and a close are transitions, so they reverse from where they are.
- **The entrance** (`.m-enter`, `Motion.enter`, `.m-stagger`): from 8px low at .985,
  transparent and blurred 6px, 480ms on the smooth spring, once per visit of a page.
- **Pages** move by `embed.js` and `main-window.js` (each page is a view of its own):
  the page leaving fades with a 4px blur in 160ms, the page arriving rises 8px and fades
  in over 380ms on the smooth spring. Within one document a change of state goes
  through the View Transitions API (`Motion.transition`, `motion.css`): the old fades
  out with a 4px blur, the new rises 8px; where the API is missing it is a plain change.
  The Recording screen uses it as the waiting line gives way to the match's facts.
- **The nav dot** (`shell.js placeMarker`): one 4px dot under the current link, played
  from link to link by a transform on the smooth spring over 420ms.
- **Numbers** count up: the grade through CSS (`@property` over `counter()`), a K/D
  through `Motion.countUp` (requestAnimationFrame, ease out, 600 to 900ms, tabular).
- **Ambient** (the stars' twinkle, the agent's float): slow (6 to 9s), off whenever the
  window is hidden and while a match is recorded (`Motion.ambient`, `html.ambient-off`).
  The moon is drawn once into an image and kept (`shared/sky.js`, localStorage), never
  per frame, and never drawn mid match.
- **Reduced motion**: `theme.css` collapses durations; the surfaces drop their
  entrances, the arrow's travel, the press's scale, the loops and the view transition's
  movement, keeping only what a crossfade says.

## The sky (`shared/sky.js`)

The star field, a few twinkling stars and the moon, drawn in the window's own
coordinates: the bar (the shell's document) and Home (a view 56px down) each draw it
as the whole window would and shift it by where they sit, so Home's moon carries
straight on through the bar with no seam. The bar shows its strip only on Home; mid
match the whole sky is behind the Recording screen, the moon resting low and still.

## The screens built in phase 1

- **The top bar** (`shell/`, 56px, `main-window.js TOP_H`): the moon in colour and
  "Occlara", the four links (Home, Matches, Practice, Clips; `shell-nav.js TOP`), then
  Start at the bar's size (hidden on Home, whose hero carries the big one), the profile
  button and the window's buttons. Mid match the links dim to 35% beside a lock and
  "Locked until the match ends", and the bar keeps the pause button. Ask Coach,
  Profile, Players, Duos, Invite, Settings, Learn, Report a problem and the Discord are
  rows of the profile menu.
- **The Recording screen** (`shell/`, `screen-silence.md`): one centred column over the
  sky: the still dot and "Recording since 10:58 PM", the agent and the map, the score at
  136px, the round and the round tape (bars: won, lost, of unknown order, under way in
  the accent, to come; the halves parted), Stop with its still glow, and "Your review
  opens when the match ends.", with the player's own choice of what shows at its foot.
- **Home** (`home/`): the sky; the fix for the next match as the hero, split at its
  colon into a headline and a grey sub line, Start and Open last review and the line
  that the review opens when the match ends, the last match's agent standing in front
  of the moon (its full portrait, `assets/agents-full`; the head icon in its orbit ring
  where there is none), floating slowly; the bento of the last match, the trend and
  what repeats; the moment the coach looked at beside the rank; the recent matches.
- **The review's hero** (`review/`): see `docs/claude/ui.md`, "The review's hero": the
  sky behind it, the agent standing at its right as on Home.

## Built on feat/orbit-art (phase 2, Nov 2026)

- **Review ready**, the signature: as the review's loading screen gives way to the
  whole review, the loading screen falls away, a card drops in on the gentle spring
  (the app's icon, "Review ready", the grade and how it moved on the last match), holds
  a beat and opens into the review, which grows out of its corners; then the count,
  the stamp and the medals. Only once the review is whole and on screen, never mid
  match, never under less motion (`docs/claude/ui.md`, "REVIEW READY").
- **The logo, the full moon** (the owner's pick, Nov 2026, the CLEAN level; replaces the
  crescent): the moon that hangs over Home, drawn round and full, its seas where they
  are on the sky and its craters lit from the upper left, falling to indigo on the far
  side. One source, `scripts/moon/`; never redrawn (CLAUDE.md, the logo's five places).
  - **The one colour mark** (`assets/logo-mark.svg`): one disc with its seas and four
    craters cut by even odd fill; the dock and the Recording screen inline it in
    `currentColor`.
  - **The bar's mark**: the moon in colour, its own 24 unit drawing at 22px
    (`assets/mark-bar.svg`), 7px before "Occlara".
  - **The app icon**: the drawn moon on indigo black glass (a squircle of exponent 5,
    its haze at the top left), with its grain at 256 and 128, without it down to 40;
    its own drawings at 32 and 24 and at 20 and 16.
  - **The tray**: the moon in one flat colour on the 16 grid, three cuts (the western
    ocean, the eastern sea, Tycho); while recording, the record ring of Start's glyph
    with the moon as its dot. Ink on a dark taskbar, the ground on a light one.
- **The splash**, clean and simplified: the night, then ONE MOTION: the moon arrives,
  fading in and sharpening from a soft blur so its lit edge and its soft indigo glow
  settle, then "Occlara" fades up under it in Onest 700. About 1.2s, then still until
  the window fades. No shade, orbit, particle or loader. **The dock** is the flat moon,
  arriving and floating on Orbit's motion.
- **The Recording screen never pulses** (the owner's decision): Stop's glow and the dot
  are still, held by `test:recordingstill`.

## What never to do

- No accent outside its places; no second accent; outcomes only in `--good`, `--warn`,
  `--bad`.
- No gradient that paints, but the medals' metal and Wrapped's own look; a mask's fade
  is allowed (`check:palette`).
- No animation on layout (width, height, top); no keyframe for a state; nothing that
  shows, moves or plays mid match but the Recording screen's arrival and its facts.
- No weight outside what ships, no webfont URL, no em or en dash in any copy.
- No colour as the only signal: a number, a word or a shape beside it always.
- No claim, testimonial, user count or rank that is not the player's own record; a
  medal only for a real thing, and never another player's name.
