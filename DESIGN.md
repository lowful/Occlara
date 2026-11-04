# Occlara's visual system, as built (8.7, The Training Log)

This records what the renderer draws today, read from `src/renderer/shared/theme.css`,
`ui.css`, `seg.js` and the surface stylesheets. The rules for working on it are in
`docs/claude/ui-rules-ipc.md`; the window, the seal and the pages are in
`docs/claude/ui.md`. When the code and this file disagree, fix one of them in the
same change.

## The idea

Every match is one ruled entry in a training log. Content is grouped by hairline
rules and whitespace, never by cards. The one thing to do differently next match
is the largest type on Home and at the top of every review. The controls are the
only tactile objects: capsules lit from above, on a dark ground. Nothing shows,
moves or plays during a match; the Recording screen rises in once and is still.

## Ground and ink

All in `theme.css`, consumed everywhere as tokens (`check:palette` refuses a
literal outside it).

| Token | Value | Job |
| --- | --- | --- |
| `--bg` | `#0A0B0E` | the ground of every surface, cool charcoal |
| `--bg-2` | `#0F1116` | a second ground, now rarely used (the rail sits on `--bg`) |
| `--text` | `#F5F5F7` | the ink, 18.1:1 on the ground |
| `--text-dim` | `#A1A1A6` | support text, 7.7:1 |
| `--text-mute` | `#808086` | labels and quiet lines, 5.0:1 |
| `--line` | white at .09 | the hairline: every rule between rows and over a section |
| `--line-2` | white at .16 | a control's border, a keycap's, a letter mark's |
| `--grid` | white at .045 | Home's column grid, drawn as elements |
| `--signal` (`--red`) | `#FF5A3C` | Start and the signal's other places, nothing else |
| `--red-2`, `--red-3` | `#FE6347`, `#E65136` | Start under the pointer, Start pressed |
| `--on-accent` | `#0A0B0E` | the label on the signal (6.35:1) |
| `--cyan` | `#FFFFFF` | the secondary accent, white; the focus ring |
| `--good`, `--warn`, `--bad` | `#52C88A`, `#D9A441`, `#E8636F` | outcomes only, never the brand |
| `--paper*` | | the Verdict's share image alone |

A hover fill on a row is `rgba(255, 255, 255, 0.035)` across the whole row; a
control's resting fill is white at .055 and .095 under the pointer. These two
neutrals are the only colour literals a tokens only stylesheet may hold.

State is form before hue: a counted grade has a solid rule or a filled mark, a
provisional one a dashed rule or a dashed capsule (`.m-letter.prov`,
`.vd-prov`), an unmeasured category a dashed hairline, a failed status a ringed
dot where a good one is filled. A grade's colour always sits beside its number
and its letter.

## Type

Geist and Geist Mono, bundled in `assets/fonts` (Geist 400 to 800, Mono 400 and
500). `font-synthesis-weight: none` on `html`, so a weight not shipped draws at
the nearest one and never as a faked bold. The scale, in few sizes:

| Role | Setting |
| --- | --- |
| Hero (the fix for next match) | Geist 44/600, letter-spacing -0.03em, line-height 1.05, `text-wrap: pretty` |
| The Verdict's letter | Geist 64/600, -0.04em, in its tone |
| Page title | Geist 24/600 on `--track-display` (-0.02em) |
| A big number | Geist 600 with `font-variant-numeric: tabular-nums`, 24 to 44px by place (`.display`, `.stats .stat-n`, `.m-score` 20px) |
| Section heading | Geist 15/600, -0.01em, sentence case, no index |
| Body | Geist 14/400 in `--text`, support in `--text-dim`, line-height 1.5, max 72ch |
| Label | Geist 12/500 in `--text-mute`, sentence case |
| A column of digits, a keycap, the match id, a round number | Geist Mono 500, 11 to 13px, tabular |

There are no mono uppercase kickers, no `[ 01 ]` eyebrows and no section numbers.
The only uppercase left is the stat block's label (`.stats .stat-l`) and the
dropdown's small label. One hero per page: Home's fix line, the review's Verdict
and its fix line, the library's first repeated mistake, Settings' first group.

## Spacing

The 4px grid, `--space-1` (4) to `--space-10` (40). Space between groups beats
space within them: 40px between groups (`--space-10`), 8 to 12px inside one, and
`--space-1` binds a label to its control. A page's column is centred up to 1040px
(`html.embedded .sheet > header, > .body`), with `--space-8` at the sides below
that.

## Ruled rows, not cards

A section is a heading, then rows parted by `1px solid var(--line)`; a list
begins with a hairline and ends with one. Nothing holds a border and a fill
around a block of content, and no box sits inside a box. What stays framed: an
input (`.input`, `--r-control`), a keycap (`.kbd`, `--r-card`), a frame or clip
image (`--r-card` and the hairline), the letter mark (a small ringed capsule),
the share image, and a window shaped frame in a window of its own (onboarding,
activation, learn, weekly, `--r-lg`).

How each page keeps it:

- **Home** (`home.css`): one column of sections, each a hairline over a label
  and its rows, rising one after another on first paint (`.card.card-in`; the
  class name is historical, the element is a section). The fix line at 44px, then
  the last match as one ruled line (result, score, who and where, the grade and
  its two buttons), the categories as four thin rules, the milestone as a dotted
  line, then the trend beside the recent matches as ruled rows.
- **The review** (`review.css`, `grade-view.css`): the Verdict as the hero
  (letter, number out of 100, the one reason, the result and score at the right,
  Riot's numbers in a ruled row), the fix at 44px, the progress as one line of
  dotted facts, the four categories as named rules filled to the score with the
  evidence as one inline run, the lists as rows with the top mistake set larger,
  every round a ruled row.
- **Matches, Patterns, Breakdown** (`matches.css`): rows parted by the hairline,
  the row's hover a faint fill, the grade a number and a ringed letter, the trend's
  bars on one hairline, the breakdown a table of ruled rows that open in place
  (`.reveal`).
- **Settings** (`settings.css`): a group is a heading, one line saying what it
  changes, and its capsule control on the same row at the right; the explanation
  is folded into a `<details>` line under the row, every word kept. The first
  group has no rule over it: it is the page's hero.
- **The shell** (`shell.css`): the rail is the page's ground behind one hairline.
  Its only fills are the marker on the current page, the thumb of the game
  capsule and the two record capsules. The Recording screen is the crescent,
  one line and three facts as ruled rows.

## Capsule controls

Every button is `ui.css`'s, never restyled locally. The capsule is `--r-btn`
(999px) and its depth is built from offset shadows and inset lit edges, never a
gradient and never a halo:

| Token | Value | Job |
| --- | --- | --- |
| `--hi` | `inset 0 1px 0 rgba(255,255,255,.11)` | the lit top edge on a dark capsule |
| `--hi-ink` | `inset 0 1px 0 rgba(255,255,255,.85), inset 0 -1px 0 rgba(0,0,0,.16)` | the same on the ink capsule and the segmented thumb |
| `--hi-signal` | `inset 0 1px 0 rgba(255,255,255,.32), inset 0 -1px 0 rgba(0,0,0,.18)` | the same on Start |
| `--drop` | `0 1px 2px rgba(0,0,0,.55)` | the resting shadow |
| `--drop-hover` | `0 6px 14px -4px rgba(0,0,0,.7)` | the shadow under the pointer |

- `.btn`: 40px, Geist 500 14px, white at .055 with the `--line-2` border, `--hi`
  and `--drop`. `.md` 36px, `.sm` 30px at 13px. A trailing keycap pulls the end
  padding in.
- Under the pointer a capsule rises 1px (`translateY(-1px)`) and its shadow
  opens to `--drop-hover`; pressed it goes to `translateY(0) scale(0.985)` with an
  inset shadow over `--t-press` (80ms). Transform and shadow only.
- `.btn-primary`: the ink capsule, the ground's colour on it, `--hi-ink`;
  `--cyan` (white) under the pointer. One primary per view at most.
- `.btn-ghost`: the dark capsule, the same as a bare `.btn`.
  `.btn-ghost.danger` takes the signal under the pointer.
- `.btn-link`: borderless and flat, no depth, so it does not rise.
- `.btn-rec`: Start, 48px, the one saturated fill in the app, `--on-accent` on
  it, `--hi-signal`; its hover and press leave Stop (`.active`) alone. Recording,
  Start is Stop: the dark capsule with its stop icon in the signal. Ended, a ghost
  at full opacity.
- `.icon-btn`: a 34px round capsule with the same lit edge, rise and press;
  `.lg` 48px beside Start; `.log-eye` 30px on a row.
- `.dd-btn` (the dropdown's trigger) is the same capsule, 36px.
- The hovers sit in `:where(:not(:disabled))`, so a surface's own state (armed
  Clear clips, a done button) still outweighs them. Disabled is .45 opacity and
  no shadow.

## The segmented capsule and seg.js

A row of buttons becomes one capsule with one sliding thumb, the way a monthly
and yearly toggle does: capture speed, On and Off, the recording size, the clip
cap, the game picker in the rail, Stats' queue, the breakdown's cut and queue,
Learn's bands, onboarding's choices and the share sheet's options.

- Markup stays what it was: the buttons are the control and their state is the
  attribute or class the surface already sets (`aria-pressed="true"`,
  `aria-selected="true"`, `aria-checked="true"`, `.on`, `.active`, `.picked`).
  A test or a screen reader reads no new element.
- `occlaraSeg(el)` from `shared/seg.js` (loaded with
  `<script src="../shared/seg.js">`) adds `.seg-slide` to the row and prepends an
  `aria-hidden` `.seg-thumb` behind the buttons. A `MutationObserver` on the
  buttons' class and aria attributes and the row's children, and a
  `ResizeObserver`, keep the thumb on the chosen button; a surface that rebuilds
  its buttons needs no second call. The first placement is instant (`.still`),
  every later one slides on `--t-med` and `--ease-expo`.
- `ui.css .seg-slide`: 3px of padding, the `--line-2` border, black at .32 with an
  inset shadow, so the track reads as a well; the buttons are 32px, flat and
  transparent, dim until chosen, the ground's colour on the thumb. The thumb is
  the ink with `--hi-ink` and `--drop`, moved by transform (seg.js writes its width
  before the transform, so only the slide animates).
- A surface's own `.seg` rule draws the chosen button filled when the script has
  not run (`.seg:not(.seg-slide) > button.active`), so a page painted without it
  looks the same at rest.

## Radii by role

| Token | Value | Role |
| --- | --- | --- |
| `--r-btn` | 999px | a capsule control, the segmented track and thumb, a letter mark |
| `--r-control` | 10px | an input, a nav row's hover and the marker, a window button |
| `--r-card` | 6px | a keycap, a framed image, a row's focus ring |
| `--r-pill` | 999px | kept for the few pills left |
| `--r-sm`, `--r-md`, `--r-lg` | 8, 12, 16px | the focus ring and a window shaped frame in a window of its own; not for a panel on a page |

## Motion

Restrained and material: transform, opacity, shadow and clip only, nothing that
loops, and nothing during a match.

| Token | Value | Use |
| --- | --- | --- |
| `--t-press` | 80ms | a keycap or capsule going down |
| `--t-fast` | 140ms | a fill or ink answering the pointer |
| `--t-med` | 220ms | a page coming in, a thumb or the marker sliding, a row opening |
| `--t-slow` | 420ms | the one authored moment on a page: an arrival, the reveal |
| `--ease` | `cubic-bezier(.22, 1, .36, 1)` | feedback |
| `--ease-out` | `cubic-bezier(.25, 1, .5, 1)` | an arrival (ease-out-quart) |
| `--ease-expo` | `cubic-bezier(.16, 1, .3, 1)` | a page, a thumb, a marker, a row rising |
| `--ease-spring` | `cubic-bezier(.34, 1.56, .64, 1)` | the letter's stamp |

- **Continuity.** A page change slides 12px from the side it comes from on
  `--t-med` (`html.page-armed`, `ui.css`); the sidebar marker is one element slid
  to the current page; every segmented thumb slides; a breakdown row and Stats'
  notes open by height in place (`.reveal`, one grid row from 0fr to 1fr).
- **Arrival.** Rows rise 6px (`riseIn`, `.rise-in`, `.m-item.rise`,
  `.recent.card-in .r-row`) 40ms apart, the stagger capped at the eighth row,
  once, when a list first appears on screen, never on a repaint. Home's sections
  arrive the same way on first paint and on a change of game; the trend's bars
  rise by their clip (`barUp`).
- **The reveal** (`review.js startReveal`, `review.css`, `grade-view.css`), the
  focal moment, once per review as the loading screen gives way and only on
  screen: the number counts up over `--t-slow` twice (`@property --n`, drawn by
  `counter()` over the real number, which stays the text; no JS arithmetic), the
  letter stamps in after `--t-slow` (`vdStamp`, scale 1.35 to 1 on the spring),
  the reason rises, the category rules fill from `scaleX(0)` 80ms apart, and the
  progress lines rise after them. A click, a key or the clock adds
  `.reveal-done`, the end state at once. The letter landing is heard
  (`shared/sfx.js`), only with sounds on and `isCoaching` false.
- **Feedback.** A capsule rises 1px and presses with a hair of scale; a nav
  row's icon scales to .92 on press; a `<details>` chevron turns and its
  paragraph rises.
- **Reduced motion.** `theme.css` collapses every duration to 0.01ms; the
  surfaces also zero their delays and drop their entrances, so a reduced-motion
  user still sees every state and waits for nothing. Content is visible by
  default; no state depends on an animation event.

## Focus and keyboard

Every interactive element shows a 2px ring in `--cyan` at .55 on
`:focus-visible` (inset on a row inside a scrolling body, 2px outside a
control); a header that reads as text underlines instead. Everything is
reachable by keyboard, and text keeps 4.5:1 on its ground.

## The signal's places

`--signal` is Start's fill, the live record controls and their Stop icon, the
Recording screen's live dot, the notice line's urgent dot and a destructive action
under the pointer (the window's close, `.btn-ghost.danger`, Clear clips armed).
`scripts/check-palette.js SIGNAL_ALLOWED` lists the exact rules; no script or page
may name it. A loss, a D, a lost round, a death and an error line are `--bad`.

## What never to do

- No card: no border and fill around a block of content, and never a box inside
  a box. A section is a heading and rules.
- No gradient (the one allowed is Stats' skeleton shimmer, where the gradient is
  the animation), no glow, no coloured halo, no blur as decoration.
- No mono uppercase kicker, no `[ 01 ]` eyebrow, no section number.
- No wall of small grey text: one sentence that changes what the player does,
  the rest folded into a hint or a `<details>`, with every fact kept.
- No button styled locally: `.btn`, `.btn-primary`, `.btn-ghost`, `.btn-rec`,
  `.icon-btn`, `.dd-btn` are the controls. No second primary in a view.
- No second accent: the signal only in its places, outcomes only in
  `--good`, `--warn`, `--bad`.
- No animation on layout (width, height, top), nothing that loops, nothing that
  shows, moves or plays mid match, no new sound.
- No weight Geist does not ship, no webfont URL, no em or en dash in any copy.
- No colour as the only signal: a number, a word or a shape beside it always.
