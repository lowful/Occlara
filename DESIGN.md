# Occlara's visual system (8.8, the coach's notebook)

These are the rules for what the renderer draws, read against
`src/renderer/shared/theme.css`, `ui.css`, `marks.js`, `marks.css`, `seg.js` and
the surface stylesheets. Working rules are in `docs/claude/ui-rules-ipc.md`; the
window, the seal and the pages are in `docs/claude/ui.md`. When the code and this
file disagree, fix one of them in the same change.

8.8 is being built surface by surface (the plan's stages A0 to A8). A0, the
foundations, is in: the voice, the pen, the ink, the curves, the weight roles,
the margin token and the three button ranks. Each page adopts them in its own
stage. A rule below marked **(adopting)** is the rule a page moves to in its
stage; until then the page keeps its 8.7 shape.

## The idea

A coach marked up your match. The ground stays dark and the interface stays
quiet, and the type is one family, Geist, for every word and number. Two
things carry the hand: the coach's **voice**, set apart by role (weight, size
and ink, never a second face), and the coach's **pen**,
hand drawn strokes on the few things that matter. A page reads like a marked up
match sheet: a narrow margin of round numbers, times and grades beside a column
of sentences.

**What changed from 8.7, "the training log":**

- The fix line was Geist 44/600. It is now `.t-fix`, Geist 700 at 38px, -0.03em,
  line-height 1.1, balanced, with the pen's underline. A serif voice was tried
  in 8.8's first pass and removed: a second face read as random beside the
  app's bold Geist.
- Every button was one capsule. There are now three ranks: the filled capsule
  (one per view), a quiet rectangle, and a text button.
- 95% of the type was 500 or 600. Body is now 400, labels 500, titles 600.
- `--ease-out` was `.25, 1, .5, 1` (quart); it is now `.23, 1, .32, 1`, with a new
  `--ease-in-out`. A press was `scale(.985)` over 80ms; it is now `scale(.97)` over
  160ms.
- A hover moved a control on every device; it now moves one only with a real
  pointer (`(hover: hover) and (pointer: fine)`).
- "Hairline, grey label, rows" on every section gives way, page by page, to the
  margin layout **(adopting)**.

## Ground and ink

All in `theme.css`, consumed everywhere as tokens (`check:palette` refuses a
literal outside it).

| Token | Value | Job |
| --- | --- | --- |
| `--bg` | `#0A0B0E` | the ground of every surface, cool charcoal |
| `--bg-2` | `#0F1116` | a second ground, rarely used |
| `--text` | `#F5F5F7` | the ink, 18.1:1 on the ground |
| `--text-dim` | `#A1A1A6` | support text, 7.7:1 |
| `--text-mute` | `#808086` | labels and quiet lines, 5.0:1 |
| `--ink-pen` | `#CDAE86` | **the pen**, warm pencil, 9.4:1 |
| `--ink-pen-dim` | `#8A765E` | a quieter pen note, 4.5:1 |
| `--line` | white at .09 | the hairline |
| `--line-2` | white at .16 | a control's border, a keycap's, a secondary button's |
| `--grid` | white at .045 | Home's column grid |
| `--signal` (`--red`) | `#E5383B` | Start and the signal's other places, nothing else |
| `--red-2`, `--red-3` | `#F04A4D`, `#C9302F` | Start under the pointer, Start pressed |
| `--on-accent` | `#0A0B0E` | the label on the signal (4.65:1) |
| `--cyan` | `#FFFFFF` | the secondary accent, white; the focus ring |
| `--good`, `--warn`, `--bad` | `#52C88A`, `#D9A441`, `#E8636F` | outcomes only, never the brand |
| `--paper*` | | the Verdict's share image alone |

Rules:

- Components use semantic tokens only. One accent per view.
- `--ink-pen` is the pen's strokes and its margin notes (`.pen-note`), nothing
  else: never text, a fill, a border, the signal or an outcome.
  `check:palette PEN_ALLOWED` lists its places, and no script or page names it.
- Text keeps 4.5:1 on its ground; a UI part and the pen keep 3:1
  (`test:marks` computes the pen's).
- A row's hover fill is white at .035; a control's resting fill white at .055
  and .095 under the pointer. Those neutrals are the only literals a tokens only
  stylesheet may hold.
- State is form before hue: a counted grade a solid rule or filled mark, a
  provisional one dashed, an unmeasured category a dashed hairline, a failed
  status a ringed dot. A grade's colour always sits beside its number and letter.

## Type

One family, two faces, bundled in `assets/fonts` and declared in `theme.css` (the CSP
allows `font-src 'self'` and nothing else). `font-synthesis-weight: none` on
`html`, so a weight not shipped draws at the nearest one, never as a faked bold.

| Face | Token | Weights | For |
| --- | --- | --- | --- |
| Geist | `--font` | 400 to 800 | every interface word and number |
| Geist Mono | `--font-mono` | 400, 500 | round numbers, columns of digits, keycaps, the match id |

**There is no serif and no second display face.** No other font is added or
loaded. `check:palette` fails any `font-family` that is not `var(--font)` or
`var(--font-mono)`, any other `@font-face` or font token, any named serif, and
any font file in `assets/fonts` that is not Geist's; `test:marks` holds the roles.

**The voice is a role, not a font,** in two shared classes in `shared/ui.css`:

- `.t-fix`: the one fix line and any hero line. Geist 700 (`--w-display`),
  -0.03em, line-height 1.1, `text-wrap: balance`, in `--text`; the page sets the size.
- `.t-voice`: what the coach says (the coach's read, round notes, what the look
  saw, Ask Coach's answers). Geist 400, 16 to 17px, line-height 1.55, in the full
  `--text`, so it reads as sentences beside the 500 labels in `--text-dim`.

Never a label, a button or a number.

**Weight roles:** `--w-body` 400, `--w-label` 500, `--w-title` 600,
`--w-display` 700. Hierarchy comes from weight, then size, then ink.

| Role | Setting |
| --- | --- |
| The fix for next match | `.t-fix`, Geist 700, 38px on the review and 34px on Home, -0.03em, line-height 1.1, 24 to 28ch, with the pen's underline |
| The coach's spoken lines | `.t-voice`, Geist 400, 16 to 17px, line-height 1.55, `--text` |
| The Verdict's letter | Geist 64/600, -0.04em, in its tone |
| Page title | Geist 24/600 on `--track-display` (-0.02em) |
| A big number | Geist 600, `tabular-nums`, 24 to 44px by place |
| Section heading | Geist 15/600, -0.01em, sentence case, no index |
| Body | Geist 14/400 in `--text`, line-height 1.5, 60 to 75 characters |
| Label | Geist 12/500 in `--text-mute`, sentence case |
| A round number, a column of digits | Geist Mono 500, 11 to 13px, tabular |

- Line-height 1.1 for display, 1.2 to 1.3 for headings, 1.5 to 1.6 for body.
- 24px and up takes -0.01 to -0.02em.
- `text-wrap: balance` on headings and short lines, `pretty` on paragraphs.
- `tabular-nums` on every figure.
- Never justify. No mono uppercase kicker, no `[ 01 ]` eyebrow, no section
  number, no eyebrow over a heading.

## The pen

`src/renderer/shared/marks.js` (`window.occlaraPen`) and `marks.css`. This is the
one thing only Occlara draws.

**What it is.** Six kinds of hand drawn stroke: underline, circle, bracket,
arrow, tick and strike, with three or four variants each. Every variant was drawn
as a path, not computed. It wobbles, overshoots its end and carries a second,
lighter pass over part of its length, which gives the uneven pressure. The paths
are laid out at the size of what they mark, never stretched, so a stroke keeps a
pen's width. The variant is picked by an FNV-1a hash of the text, and on a line
mark each line also varies its start, end, height and pressure from that hash.
The same note is marked the same way every time.

**What it marks**, one to three marks on a screen and never more:

- the fix: an underline;
- the rounds that prove it: a circle or a bracket in the margin;
- a best: a tick;
- a cleared habit: a strike.

It never marks chrome, a button, the nav or a label, and it is never decoration.

**The API.** `occlaraPen.mark(el, kind, { text, draw, delay })` draws one mark on
an element (`.pen-host`, an `aria-hidden` svg), replaces a previous mark of the
same kind, and follows the element's size afterwards, staying still.
`occlaraPen.clear(el, kind)` takes a mark away.

**When it draws.** A mark is still by default. It draws in once by
`stroke-dashoffset` (`pathLength` 1) over `--t-pen` (450ms) on `--ease-out`,
and only when all of these hold:

- the caller passed `draw: true`;
- the player has not asked for less motion;
- main has said coaching is off (`getState` at load, `onState` after). Unknown
  counts as coaching.

The caller asks only from the review's reveal (`review.js runReveal`, inside
`occlaraOnShown`) or a page's first paint after a match. `test:marks` holds
every `draw: true` in the renderer to those places. The reveal's end
(`.reveal-done`) makes the stroke whole at once, and under reduced motion a mark
is simply there.

**What changed:** 8.7 had no pen. A handwriting font was considered and refused:
a real stroke beside real type reads as human, while a script font reads as a
template.

## The margin (adopting)

`--margin-w` (72px) is a content page's narrow left column, as on a marked up
match sheet. It holds round numbers, times, dates, grades and the pen's short
notes (`.pen-note`, Geist 12/500 in `--ink-pen`). The content column beside it
holds the sentences. The review, Home and Moments take it first, then Matches and
Patterns. A page's column is otherwise centred up to 1040px
(`html.embedded .sheet > header, > .body`), with `--space-8` at the sides.

## Spacing and layout

- The 4px grid: `--space-1` (4) to `--space-10` (40).
- Space between groups is at least twice the space inside one: 8 to 12px inside,
  24 to 40px between. `--space-1` binds a label to its control.
- Radii are concentric (outer = inner + padding).
- On a control with an icon, the icon side's padding is 2px less than the text
  side's.
- Bordered controls sit 12px apart.
- One primary action per view. More than three secondary actions go into a menu.

## Ruled rows, not cards

A section is a heading, then rows parted by `1px solid var(--line)`; a list
begins with a hairline and ends with one. Nothing holds a border and a fill
around a block of content, and no box sits inside a box. No gradient, glow or
decorative blur.

What stays framed:

- an input (`.input`, `--r-control`);
- a keycap (`.kbd`, `--r-card`);
- a frame or clip image (`--r-card` and the hairline);
- a portrait;
- the letter mark;
- the share image;
- a window shaped frame in a window of its own (onboarding, activation, learn,
  weekly, `--r-lg`).

## Controls: three ranks

Every button is `ui.css`'s, never restyled locally. A page changes rank by its
class, never by its own rule.

| Rank | Class | Look | Use |
| --- | --- | --- | --- |
| Primary | `.btn.btn-primary`, Start `.btn.btn-rec` | the filled capsule, `--r-btn`, the ink (or the signal for Start) with a lit edge | one per view |
| Secondary | `.btn.btn-secondary` | a quiet rectangle, 36px, `--r-control`, the `--line-2` border, no fill and no shadow, filling faintly under the pointer | everything else a view does |
| Tertiary | `.btn.btn-tertiary` | words in `--text-dim`, underlined in `--text-mute` under the pointer | a quiet way on: show more, change, dismiss |

- A bare `.btn` and `.btn-ghost` are the 8.7 dark capsule. They stay working, and
  each page moves them to a rank in its stage **(adopting)**. `.btn-link`,
  `.icon-btn`, `.dd-btn` and `.btn-ghost.danger` are unchanged.
- **Press:** `scale(.97)` over `--t-tap` (160ms) on `--ease-out`. A disabled
  control never scales (every press sits in `:where(:not(:disabled))`).
- **Hover:** fill and ink change on `ease` everywhere. A transform (the
  capsule's 1px rise) happens only under `@media (hover: hover) and
  (pointer: fine)`. The secondary and tertiary do not rise.
- Disabled is .45 opacity and no shadow.
- Buttons are verb first ("Open review", "Connect Riot ID").

**The segmented capsule** (`.seg-slide`, `occlaraSeg(el)` from `seg.js`) is for a
real either/or switch only, such as capture speed, On and Off, a queue, or a cut.
It is not for a filter list or a page's actions. The markup is the buttons, and
their state is the attribute or class the surface already sets. seg.js adds the
`aria-hidden` thumb and keeps it on the chosen button through a
`MutationObserver` and a `ResizeObserver`.

## Radii by role

| Token | Value | Role |
| --- | --- | --- |
| `--r-btn` | 999px | the primary capsule, the segmented track and thumb, a letter mark |
| `--r-control` | 10px | an input, a secondary button, a nav row's hover and marker, a window button |
| `--r-card` | 6px | a keycap, a framed image, a row's focus ring, a tertiary's focus |
| `--r-pill` | 999px | kept for the few pills left |
| `--r-sm`, `--r-md`, `--r-lg` | 8, 12, 16px | the focus ring and a window shaped frame in its own window |

## Motion

Transform, opacity, clip-path and stroke-dashoffset only. Never
`transition: all`, never from `scale(0)`, nothing that loops, and nothing during
a match.

| Token | Value | Use |
| --- | --- | --- |
| `--ease-out` | `cubic-bezier(.23, 1, .32, 1)` | an arrival, a press, the pen |
| `--ease-in-out` | `cubic-bezier(.77, 0, .175, 1)` | something on screen moving to a new place |
| `ease` | | hover and colour changes |
| `--ease`, `--ease-expo`, `--ease-spring` | unchanged | kept for the rules that use them |
| `--t-press` | 80ms | a keycap going down |
| `--t-tap` | 160ms | a control going down |
| `--t-fast` | 140ms | a fill or ink answering the pointer |
| `--t-med` | 220ms | a page coming in, a thumb or marker sliding, a row opening |
| `--t-slow` | 420ms | the reveal's beats |
| `--t-pen` | 450ms | the pen drawing once |

- Never an ease-in on UI. Everything UI stays under 300ms; the pen alone is
  longer, because it is the one authored moment.
- Small popovers take 125 to 200ms and dropdowns 150 to 250ms. An exit is shorter
  than its entry, with 8 to 12px of travel.
- A stagger is 30 to 60ms and is capped at six items. Lists stop staggering on
  every visit **(adopting)**: the rise-in stays on the review's reveal and on a
  page's entry.
- **The reveal** (`review.js startReveal`), once per review and only on screen:
  - the number counts up;
  - the letter stamps in;
  - the pen underlines the fix as the letter lands;
  - the category rules fill.
  A click, a key or the clock ends it (`.reveal-done`). Its sound plays only with
  sounds on and coaching off.
- **Reduced motion** keeps opacity and colour and removes all movement.
  `theme.css` collapses every duration, surfaces drop their entrances, and the
  pen never draws.

## Focus and keyboard

Every interactive element shows a 2px ring in `--cyan` at .55 on
`:focus-visible`. Everything is reachable by keyboard.

## The signal's places

`--signal` is used in these places and nowhere else:

- Start's fill;
- the live record controls and their Stop icon;
- the Recording screen's live dot;
- the notice line's urgent dot;
- a destructive action under the pointer.

`scripts/check-palette.js SIGNAL_ALLOWED` lists the exact rules. A loss, a D, a
lost round, a death and an error line are `--bad`. The pen is never the signal.

## Copy

- Buttons are verb first.
- An empty state says what to do and why, warmly and briefly, with exactly one
  next action.
- An error is calm and plain, and sits next to the action.
- Strings are built whole, never concatenated around a variable.
- No em or en dash anywhere.

## What never to do

- No card, no box inside a box, no gradient (except Stats' skeleton shimmer),
  no glow, no decorative blur.
- No font but Geist and Geist Mono: no serif, no second display face, no
  voice outside `.t-fix` and `.t-voice`, and neither on a label, a button or a number.
- No pen on chrome, a button or the nav; no more than three marks on a screen; no
  pen that draws while coaching, under reduced motion, or outside the reveal or a
  first paint after a match.
- No handwriting font.
- No button styled locally, no second primary in a view, no capsule for a
  secondary action **(adopting)**.
- No second accent: the signal only in its places, the pen only in its places,
  outcomes only in `--good`, `--warn`, `--bad`.
- No hover transform without a fine pointer, no press on a disabled control, no
  `transition: all`, nothing that loops, nothing that shows, moves or plays mid
  match, no new sound.
- No weight a face does not ship, no webfont URL, no em or en dash in any copy.
- No colour as the only signal: a number, a word or a shape always sits beside
  it.
