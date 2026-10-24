# Rules for UI work, and IPC

Moved out of CLAUDE.md word for word, nothing reworded or dropped (CLAUDE.md as of commit cc1f880, 8.5.0, lines 2324 to 2432). Sections here: "Rules for UI work", "IPC". "Rules for UI work" is a part of the section "The UI" (the rest is in ui.md). "Above" and "below" in the text name sections that may now sit in another file under docs/claude/: grep the section's title there to find it. The table in CLAUDE.md says which file to read for which work.

### Rules for UI work

**There is no build step and no framework.** No React, no JSX, no bundler, no
TypeScript. Plain DOM APIs and plain CSS. Do not introduce a framework or a
build pipeline to add a component.

**Design tokens live in `src/renderer/shared/theme.css`** and are imported by
every surface. Use the variables, do not hardcode colours, radii, easings or
durations:

- Brand (8.6): `--red` `#FF5A3C`, THE SIGNAL, with `--red-2` `#FE6347` (Start
  under the pointer), `--red-3` `#E65136` (Start pressed) and `--red-rgb`;
  `--signal` and `--signal-rgb` are the same colour by the name of its job, and
  what new code writes. `--on-accent` `#0A0B0E` is the label on it (6.35:1;
  white measured 3.10:1). `--cyan` `#FFFFFF`, `--bg` `#0A0B0E` (cool
  charcoal), `--bg-2` `#0F1116`.
  The token NAMES are historical. `--red` is the signal, `--cyan` is white. They
  mean "primary accent" and "secondary accent", the same in every game (one
  palette, `theme.css`). Do not rename them: they are consumed 225 times
  across 15 files and `npm run check:palette` exists because that edit has
  gone wrong.
- THE SIGNAL'S PLACES, and nowhere else: Start's fill, the live record card's
  tint and its Stop icon, the Recording screen's live dot, the notice line's
  urgent dot, and a destructive action under the pointer (the window's close,
  Log out, Clear clips armed, `.btn-ghost.danger`). `check:palette` holds
  every stylesheet rule that names it to `SIGNAL_ALLOWED`, and no script or
  page may name it; a new place is a deliberate edit to that list.
- Text: `--text` `#F5F5F7`, `--text-dim` `#A1A1A6`, `--text-mute` `#808086`
  (18.1, 7.7 and 5.0 to 1 on `--bg`)
- Status: `--good`, `--warn`, `--bad`, each with an `-rgb` twin. An OUTCOME,
  never the brand: a loss, a D, a lost round, a death mark and an error line
  are `--bad`, never the signal.
- Lines: `--line` (the hairline, what `--glass-border` is), `--line-2`
  (a control's border and a keycap's), `--grid` (Home's column grid)
- Paper, the Verdict's share image alone: `--paper`, `--paper-ink`,
  `--paper-ink-2`, `--paper-ink-3`, `--paper-line`
- Glass: `--glass-fill`, `--glass-border`, `--glass-blur`
- Geometry, by role: `--r-card` 6px (a card or a panel), `--r-control` 10px
  (a control), `--r-pill` 999px. The legacy `--r-sm` `--r-md` `--r-lg` keep 8,
  12 and 16 for a window shaped frame and the focus ring; a surface moves its
  own rules to the roles, never by a remap here
- Type: `--track-display` -0.02em and `--lh-display` 1 for titles and big
  numbers, `--track-label` 0.08em for the mono label
- Motion: `--ease`, `--ease-expo`, `--ease-spring`, `--t-press` (a keycap
  going down), `--t-fast` `--t-med` `--t-slow`

`src/renderer/shared/ui.css` holds the shared component styles. If two surfaces
need the same thing, it belongs there, not copied into both. Since 8.6:

- **Buttons are flat**: `.btn` 44px, `--r-control`, Geist 500 15px, no lit
  edge, no shadow, no lift; `.md` 40px, `.sm` 32px. A bare `.btn` and
  `.btn-ghost` are the bordered secondary; `.btn-primary` is the ink with the
  ground on it, white under the pointer; `.btn-link` the borderless in card
  link; `.btn-ghost.danger` takes the signal under the pointer; `.btn-rec` is
  Start. Hovers sit inside `:where(:not(:disabled))`, so a surface's own state
  still outweighs them.
- **Keycaps**: `kbd` and `.kbd`, 22px, the control hairline, `--r-card`,
  Geist Mono 500 11px; `.keys` a chord, one key a cap; `.is-pressed` for
  `--t-press`. A control whose text a test reads carries its cap as
  `data-keys` (`[data-keys]::after`, hidden until the surface shows it) and
  the chord in `aria-keyshortcuts`. Only a shortcut that exists gets a cap.
- **`.mono`**, every small uppercase label: Geist Mono 500 11px on
  `--track-label`, ink-3. **`.eyebrow`** is a mono label led by its index,
  [ 01 ], drawn from a counter the container resets (`counter-reset: sec`),
  so its text stays the label; only where the order never changes.
- **`.vf`, the viewfinder**, only on a card that frames one moment: four 16px
  corner brackets, one border clipped by `clip-path`, never a gradient, and
  never inside an `overflow: hidden` ancestor, which cuts them off.
- **The stat block**, `.stats` of `.stat` with `.stat-n` and `.stat-l`,
  columns divided by the hairline; `.sm` 36px and `.xs` 24px numbers.
- `.display`, `.colgrid` (Home's header band only), `.sig-dot`, `.input`
  (44px, Geist Mono 14px), and page titles in Geist 600 24px.

A stylesheet held to tokens says so on its first line,
`/* palette: tokens only */`, and `check:palette` then refuses any colour
in it but a token and the glass's neutral black and white. **The grade card
and the insight lists are drawn by `shared/grade-view.js` and
`shared/grade-view.css`** in the review, the library and wherever else a grade
appears, so the three cannot drift. They build DOM with textContent only,
because detail lines carry the model's sentences.

**Geist is bundled locally** in `assets/fonts` so the app renders offline, with
Geist Mono for columns of digits. Geist ships weights 400, 500, 600, 700 and
800 only, and Geist Mono 400 and 500 only. Do not reference a weight outside
that set or a webfont URL: the renderer CSP forbids the URL, and a missing
weight silently falls back to Segoe UI, which changes the shape of the whole
interface without erroring. **`theme.css` sets `font-synthesis-weight: none`
on `html` (8.6)**: a weight that is not shipped draws at the nearest one that
is, never as a faked bold. Before it, every Mono rule at 600 or 800 (the
grade, round numbers, scores, the Matches record) was the 500 thickened by
the browser. The type scale has no such weight: a digit in a column is Geist
Mono 500, a big number Geist 600 with `tabular-nums`, and `check:palette`
fails a Mono rule at any other weight but the few its `MONO_PENDING` names,
each left for its surface's task to move. A real heavier Mono means bundling
its file with an `@font-face` in `theme.css`.

Settled decisions that keep getting reintroduced by accident:

- **No decorative gradients anywhere.** Solid fills and hairline borders. The
  one that remains is functional and deliberate: Stats' skeleton shimmer in
  `stats.css`, where the gradient IS the animation. (`ui.css`'s was never a
  shimmer: it was the primary button's hover sweep, and it went in 8.6 with
  the button's glow.) The splash
  vignette used to be the third. It was a radial ellipse fading to fully
  transparent, masking the edge of a transparent window, and it also ate the
  corners: over a light desktop the centre measured rgb(11,12,12) while all four
  corners measured exactly the desktop behind them, so a square window rendered
  as an oval blob. `.stage` is now a solid `--bg` card with an 18px radius and a
  10px gutter, the same shape as every other surface. Stats' rank journey was
  a fourth until 8.4.1, the retired cyan over a gradient fill written into its
  markup from stats.js, which `check:palette` never read: it read stylesheets
  alone. It reads every renderer script and page now, counts every gradient
  against the one shimmer (Stats' share card, with its two, was retired by
  the Verdict's share image in 8.6), and holds `stats.css` and every
  stylesheet marked on its first line to tokens and the glass's neutral black
  and white (a stylesheet it names that the scan no longer reads, renamed or
  moved, fails the check rather than being held to nothing).
- **Start stays the signal**: `--red` `#FF5A3C` with the `--on-accent`
  `#0A0B0E` label, 19px 600, by its own class, `.btn-rec`, so the primary
  being ink never turns it white. Its hover and press are scoped to
  `:not(.active)`, or pressing Stop flashes the signal. Ended, it is a ghost
  at full opacity (7.7:1), never the faded signal (2.40:1). It is the one
  control a player must find without looking, and the one saturated fill.
- **A grade's colour is never its only signal.** The number and the letter are
  always beside it.

**Every surface must stay visually synchronised.** A change to a shared
component or a token is not done until Settings, onboarding, the review and the
library all agree.

## IPC

`src/shared/channels.js` is the single source of truth for every channel name.
It is imported by main, by every preload, and indirectly by every renderer.

**Never hand-type a channel string anywhere else.** The previous client's worst
bug was main and preload drifting to different names, after which a window
silently stopped receiving events with no error. Add the constant to
`channels.js` first, then use it on both sides.

Renderers have no Node access. Everything crosses through a preload via
`contextBridge`. The library is `REVIEWS_LIST`, `REVIEW_GET`, `REVIEW_OPEN`,
`REVIEW_AILOG` (the eye: the AI log on that review's match, or at one moment
of it from the eye on a death the coach looked at), `PATTERNS_GET`,
`BREAKDOWN_GET`, and `PUSH_REVIEWS` fires whenever a review is saved or
improved. `PUSH_REVIEW_WORK` carries `{ id, work }` for a review still being
built, the step it is on or null once it is whole, to the review page, Home
and Matches (8.4.1). Grading from Riot's record is `BACKFILL_START` and
`BACKFILL_STATUS`, and `PUSH_BACKFILL` carries its status on every change to
onboarding, Settings and Matches. The main window is `SHELL_NAV` (go to a
page), `SHELL_WINDOW` (minimise, maximise, close, which quits) and `SHELL_GET`, and
`PUSH_SHELL` carries its navigation state, sealed or not, on every change.
Moving between pages is `PUSH_PAGE` to one page (arm, enter, leave) and
`PAGE_READY` back from it, taken from that page's own view only; every page
preload exposes the two through `src/preload/page-motion.js`. The match
recorder's page hears `PUSH_RECORDER` (start, stop, grab, compare) and answers
on `RECORDER_CHUNK`, `RECORDER_STATUS` and `RECORDER_REPLY`, each checked
against its own window's sender. The frames page hears `PUSH_FRAMES` (a clip's
frames to decode and which to keep) and answers on `FRAMES_REPLY`, checked the
same way. Settings reads what the clips beside the
reviews take with `CLIPS_USAGE` and clears them with `CLIPS_CLEAR`; the
recording's status line comes with the state (`recording`, pushed when the
recorder starts, stops or its rounded frame rate moves). A clip itself never
crosses IPC: the review page plays it from `occlara-clip://`, which main
serves (`clip-scheme.js`). Onboarding asks what this PC can record with over
`PC_CHECK` (`pc-check.js`), and puts the encoder asks it gets back to
WebCodecs itself. Ask Coach asks `CHAT_SEND` with the match on its chip
(`{ reviewId }`, or 'none'), lists what the chip can name with `CHAT_MATCHES`
(the ten newest of the game, held ones left out, the one chosen and its
starters) and moves the chip with `CHAT_MATCH` (8.5.0), and hears
`PUSH_REVIEWS` and `PUSH_GAME` to list again.
