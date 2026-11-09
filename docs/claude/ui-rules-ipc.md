# Rules for UI work, and IPC

Moved out of CLAUDE.md word for word, nothing reworded or dropped (CLAUDE.md as of commit cc1f880, 8.5.0, lines 2324 to 2432). Sections here: "Rules for UI work", "IPC". "Rules for UI work" is a part of the section "The UI" (the rest is in ui.md). "Above" and "below" in the text name sections that may now sit in another file under docs/claude/: grep the section's title there to find it. The table in CLAUDE.md says which file to read for which work.

### Rules for UI work

**There is no build step and no framework.** No React, no JSX, no bundler, no
TypeScript. Plain DOM APIs and plain CSS. Do not introduce a framework or a
build pipeline to add a component.

**Design tokens live in `src/renderer/shared/theme.css`** and are imported by
every surface. Use the variables, do not hardcode colours, radii, easings or
durations:

- Brand (8.6): `--red` `#E5383B`, THE SIGNAL, with `--red-2` `#F04A4D` (Start
  under the pointer), `--red-3` `#C9302F` (Start pressed) and `--red-rgb`;
  `--signal` and `--signal-rgb` are the same colour by the name of its job, and
  what new code writes. `--on-accent` `#0A0B0E` is the label on it (4.65:1;
  white measures 4.23:1). `--cyan` `#FFFFFF`, `--bg` `#0A0B0E` (cool
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
- Geometry, by role (8.7): `--r-btn` 999px (every capsule control, the
  segmented track and thumb, a letter mark), `--r-control` 10px (an input, a
  nav row, a window button), `--r-card` 6px (a keycap or a framed image only;
  there is no card), `--r-pill` 999px. The legacy `--r-sm` `--r-md` `--r-lg`
  keep 8, 12 and 16 for a window shaped frame in a window of its own and the
  focus ring; a surface moves its own rules to the roles, never by a remap here
- Depth (8.7), the button's alone, offset shadows and inset lit edges, never a
  gradient or a halo: `--hi` the lit top edge on a dark capsule, `--hi-ink` the
  same on the ink capsule and the segmented thumb, `--hi-signal` the same on
  Start, `--drop` the resting shadow, `--drop-hover` the one under the pointer
- Spacing: `--space-1` (4px) to `--space-10` (40px), the 4px grid. Space between
  groups (`--space-10`) beats space within one (8 to 12px); `--space-1` binds a
  label to its control
- Type: `--track-display` -0.02em and `--lh-display` 1 for titles and big
  numbers, `--track-label` 0.08em for the stat block's label
- Motion: `--ease`, `--ease-out` (an arrival), `--ease-expo`, `--ease-spring`,
  `--t-press` (a keycap or a capsule going down), `--t-fast` `--t-med` `--t-slow`

`src/renderer/shared/ui.css` holds the shared component styles. If two surfaces
need the same thing, it belongs there, not copied into both. Since 8.7 (the
system as built is `DESIGN.md` at the repo root):

- **Buttons are capsules with depth**: `.btn` 40px, `--r-btn`, Geist 500
  14px, white at .055 with the `--line-2` border, the lit top edge (`--hi`)
  and the resting shadow (`--drop`); under the pointer it rises 1px and its
  shadow opens (`--drop-hover`), pressed it goes to `scale(0.985)` into an
  inset shadow over `--t-press`; `.md` 36px, `.sm` 30px. A bare `.btn` and
  `.btn-ghost` are the dark capsule; `.btn-primary` is the ink with the ground
  on it and `--hi-ink`, white under the pointer, one per view at most;
  `.btn-link` is borderless and flat and does not rise; `.btn-ghost.danger`
  takes the signal under the pointer; `.btn-rec` is Start, 48px, `--hi-signal`;
  `.icon-btn` is the 34px round capsule with the same rise and press, `.lg`
  48px. The dropdown's `.dd-btn` is the same capsule at 36px. Hovers sit
  inside `:where(:not(:disabled))`, so a surface's own state still outweighs
  them. Never restyle a button locally.
- **The segmented capsule** (`.seg-slide`, `.seg-thumb`): a row of buttons
  with one thumb that slides to the chosen one. `occlaraSeg(el)` from
  `shared/seg.js` (loaded with `<script src="../shared/seg.js">`) adds the
  class and an `aria-hidden` thumb and keeps it on the button whose state the
  surface already sets (`aria-pressed`, `aria-selected`, `aria-checked`,
  `.on`, `.active`, `.picked`), through a `MutationObserver` and a
  `ResizeObserver`; the markup and what a test reads do not change. A
  surface's own `.seg` rule fills the chosen button itself only
  `:not(.seg-slide)`, so a page painted without the script looks the same.
- **Keycaps**: `kbd` and `.kbd`, 22px, the control hairline, `--r-card`,
  Geist Mono 500 11px; `.keys` a chord, one key a cap; `.is-pressed` for
  `--t-press`. A control whose text a test reads carries its cap as
  `data-keys` (`[data-keys]::after`, hidden until the surface shows it) and
  the chord in `aria-keyshortcuts`. Only a shortcut that exists gets a cap.
- **The label**: every small label is Geist 12/500 in `--text-mute`, sentence
  case, set by each surface. The mono uppercase kicker (`.mono`) and the
  indexed eyebrow (`.eyebrow`, "[ 01 ]") are gone and must not come back:
  Geist Mono is for columns of digits, keycaps, round numbers and the match
  id alone, and no heading carries a section number.
- **`.vf`, the viewfinder**, only on what frames one moment: four 16px
  corner brackets, one border clipped by `clip-path`, never a gradient, and
  never inside an `overflow: hidden` ancestor, which cuts them off.
- **The stat block**, `.stats` of `.stat` with `.stat-n` and `.stat-l`,
  columns divided by the hairline; `.sm` 36px and `.xs` 24px numbers.
- `.display`, `.colgrid` (Home's header band only), `.sig-dot`, `.input`
  (44px, Geist Mono 14px, `--r-control`), `.reveal` (opening in place by
  height), `.rise-in` (a row rising 6px, 40ms a row by `--i`), and page
  titles in Geist 600 24px.

**No cards (8.7).** A section is a heading, then rows parted by
`1px solid var(--line)`; a list opens and closes on a hairline; a row's hover
is a faint fill (white at .035) across the whole row. Never a border and a
fill around a block of content, and never a box inside a box. What stays
framed: an input, a keycap, a frame or clip image, the letter mark, the share
image, and a window shaped frame in a window of its own. One hero per page
(Home's fix line at 44px, the review's Verdict and its fix line, the library's
first repeated mistake, Settings' first group); 40px between groups, 8 to 12px
inside one. A paragraph of explanation is one sentence and a `<details>` line
holding the rest, every fact kept. State is form before hue: a counted grade a
solid rule or filled mark, a provisional one dashed, an unmeasured category a
dashed hairline.

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
fails a Mono rule at any other weight. Its `MONO_PENDING` list, the rules each
surface's task was to move, is empty since 8.7 and can only shrink. A real
heavier Mono means bundling its file with an `@font-face` in `theme.css`.

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
- **Start stays the signal**: `--red` `#E5383B` with the `--on-accent`
  `#0A0B0E` label, 18px 600, by its own class, `.btn-rec`, so the primary
  being ink never turns it white. Its hover and press are scoped to
  `:not(.active)`, or pressing Stop flashes the signal. Recording, it is the
  dark capsule with its stop icon in the signal. Ended, it is a ghost
  at full opacity (7.7:1), never the faded signal (2.40:1). It is the one
  control a player must find without looking, and the one saturated fill.
- **A grade's colour is never its only signal.** The number and the letter are
  always beside it.
- **Motion is transform, opacity, shadow and clip**, never layout: feedback
  140 to 220ms, the one authored moment on a page 420ms, rows rising 6px with a
  40ms stagger capped at eight, once, when a list first appears and never on a
  repaint; numbers count up through CSS (`@property --n` over `counter()`),
  never JS arithmetic. Nothing loops, and nothing moves, shows or plays mid
  match. `prefers-reduced-motion` collapses every duration in `theme.css`, and
  a surface zeroes its delays, so every state is still seen.

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
of it from the eye on a death the coach looked at), `PATTERNS_GET` (with
`progress`, `libraryProgress()` from the same read, for the library's marks and
Home's milestone), `PROGRESS_GET` (8.7: one review's `matchProgress()`, for the
review page through `review-preload.js progressOf`, beside its `verdictOf` and a
read only `getState` for the reveal's sound),
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

### The account's channels (8.7)

The account lives in main (`src/main/services/account-service.js`, wired in
`index.js` as `accountIpc`), and a page is handed its view, never the session
token: `{ signedIn, via ('session' | 'key' | null), pending, waiting, email,
tier, tierLabel, gamesLeft, cap (null or { capped, title, body, upgrade }),
capped, accountKey, invites, urls }`. Every line in it is a finished string
from `src/shared/usage.js` (`gamesLeft`, `capState`, `capNotice`,
`inviteProgress`, `INVITE_HOW`), so no renderer does arithmetic on games or
dates (`test:usage`).

- `ACCOUNT_GET` (invoke): the view, asked of the server first when its 60 s
  cache is old, never while a match is in progress.
- `ACCOUNT_SIGNIN` (invoke): the browser sign in, resolved once it ends,
  `{ ok: true, account }` or `{ ok: false, error }` with error one of
  cancelled, timeout, refused, unreachable, browser, listen. On ok main closes
  the Sign in window and opens the app. `ACCOUNT_SIGNIN_CANCEL` (send) ends a
  waiting one.
- `ACCOUNT_SIGNOUT` (invoke): signed out here and on the server, the licence
  key cleared too, and back to the Sign in window (`controller.logout`, the
  same as `LICENSE_LOGOUT`).
- `ACCOUNT_COPY_KEY` (invoke): main writes the account key to the clipboard.
- `REFERRAL_GET` (invoke): `GET /api/referral` with `line` and `how`, or null
  (null mid match). `REFERRAL_COPY` (invoke): main copies the invite link,
  only ever an `https://occlara.app/invite/` one.
- `PROFILE_GET` (invoke, 8.8): the Profile page as `profile.js build` makes it
  (`{ hero, signedIn, buy, play, plans }`), null mid match or sealed.
  `PROFILE_BUY` (invoke, the number): main opens `occlara.app/buy?games=N`
  only for a whole 1 to 500 that `profile.isBuyUrl` passes, never mid match.
  `PROFILE_PLANS` (invoke): `occlara.app/#pricing`, never mid match. The
  account's view carries `games` (`profile.gamesState`) for the page's hero.
  Gifts (8.8, accounts.md "Gifts"): `PROFILE_GIFT` (invoke, an offer id)
  opens `occlara.app/buy?gift=<offer>` only as `gifts.isGiftBuyUrl` passes it,
  `PROFILE_REDEEM` (invoke, the text pasted) redeems a gift link or code on
  the signed in account and answers `{ ok, said }`, `PROFILE_GIFT_COPY`
  (invoke, a gift id) copies the link main holds for a gift this account
  bought. All three answer nothing mid match or sealed.
- `OPEN_UPGRADE` and `OPEN_ACCOUNT` (send): occlara.app/pricing and
  occlara.app/account, opened by main; `OPEN_PURCHASE` with 'signup' is
  "Create a free account".
- `ACCOUNT_CHANGED` (push, in `PUSH_LIST`): the view, on a sign in or out and
  whenever the games move. HELD while a match is in progress or the window is
  sealed, and sent once it is free (`flushAccountWaits`, from `syncSeal` and
  `controller.stop`). A cap's notice line waits the same way, and further:
  only while nothing is being recorded and the window is not sealed.

The preloads that carry them: `activation-preload.js` (signIn, cancelSignIn,
openSignup, getAccount, onAccount, beside the key form's activate),
`settings-preload.js` (getAccount, onAccount, copyAccountKey, signOut,
signIn, cancelSignIn, openAccount, openUpgrade, openInvite), `home-preload.js` (getAccount,
onAccount, openUpgrade), `shell-preload.js` (openInvite, getAccount,
onAccount) and `invite-preload.js` for the Invite page (getReferral,
copyLink, getAccount, onAccount, openUpgrade, go, and the page motion). The
Invite page is the page id `invite`, opened with `SHELL_NAV`; its entry in
`src/shared/shell-nav.js` PAGES names `invite-preload.js`. `CONFIG_SET` writes
only the keys on `src/main/ipc/config-keys.js` RULES, each with a value it can
hold (since 8.7.2; it used to refuse only keys beginning with `account`, so a
page could set the licence fields `isLocallyValid` reads). A setting a page
newly writes goes on that list, or it is silently dropped (`test:configset`
holds every key a renderer writes to it). The sign in is main's alone.

Every webContents is held to our own files (`windows/web-guard.js`, wired by
`app.on('web-contents-created')` in index.js, `test:webguard`): a navigation or
redirect anywhere but `src/renderer` is refused, and no page opens a window or a
webview. A link out of the app goes through main with a URL main holds
(`shell.openExternal`), never a page's `target=_blank` or `window.open`.

### The community's channels (changelog.md)

- `DISCORD_OPEN` (invoke, the URL): main opens the Discord invite only when
  it is exactly config.js `DISCORD_URL`, never mid match or sealed
  (`src/main/ipc/community.js`), `{ ok }` or `{ ok: false, error: 'url' |
  'match' }`.
- `CHANGELOG_REFRESH` (invoke): the entries of `GET /api/changelog`, checked
  by `changelog.js clean`, or null on any failure, 4 s at most.
- `CHANGELOG_NOTICE` (invoke): Home's update line `{ version, text, link }`
  or null (nothing to say, recording, mid match, sealed); `PUSH_CHANGELOG`
  carries it once the seal lifts, and null once What's new opened.
  `CHANGELOG_SEEN` (send, the version): Home had it on screen.

### The games toast's channels (8.9.1, ui.md "The games toast")

- `PUSH_TOAST` (push, main to the toast view alone): `{ toast: { id, kind,
  pre, n, post, line } }`, one finished toast (games-toast.js `words`), or
  `{ clear: true }` when the seal or a hidden window takes it away.
- `TOAST_ACT` (send, the toast view alone, `toast-preload.js`): `{ done: id }`
  (its time up, its X) or `{ open: id }` (pressed: main opens Profile, never
  sealed). Anything from another sender, or for a toast not on screen, is
  ignored.

### The live status's channels (Progress v3, screen-silence.md)

- `PUSH_LIVE` (push, main to the shell alone): `{ state: 'waiting' }`
  before a Valorant match is under way, then `{ state: 'live', startedAt,
  mode, map?, agent?, team?, enemy?, tape?, round? }`, each fact only while
  its switch is on (`liveMap`, `liveAgent`, `liveScore` carries the score and
  the tape, `liveRound`), and null when nothing is recorded. Built by
  `index.js liveView` from `coaching-engine.js matchContext` and nothing else
  of it; checked once a second, sent only when it changed.
- `LIVE_GET` (invoke): the same, for a shell loaded mid match.
- The four switches are page writable booleans (`config-keys.js`), written by
  Settings and the Recording screen's Choose (`shell-preload.js setLive`,
  which takes those four keys alone).
