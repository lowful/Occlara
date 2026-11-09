# The UI

Moved out of CLAUDE.md word for word, nothing reworded or dropped (CLAUDE.md as of commit cc1f880, 8.5.0, lines 1996 to 2323). Sections here: "The UI". Its part "Rules for UI work" is in ui-rules-ipc.md. "Above" and "below" in the text name sections that may now sit in another file under docs/claude/: grep the section's title there to find it. The table in CLAUDE.md says which file to read for which work.

## The UI

Every surface is a plain folder with `index.html`, a `.css` and usually a `.js`.

**The Training Log (8.7).** Every page is one ruled column on the dark ground:
a section is a heading and rows parted by the hairline, no card and no box in a
box, one hero per page (Home's fix for the next match at 44px, the review's
Verdict), and the controls are the only tactile objects, capsules lit from above
(`ui.css`). The system as built is `DESIGN.md` at the repo root; the rules are
in ui-rules-ipc.md. Where this file says "card" below for a thing on a page, it
names the element and its id as the scripts and tests still do (Home's
`.card`, the record card), not a drawn frame: nothing on a page has one.

**One window since 8.1** (`src/main/windows/main-window.js`): frameless, in the
taskbar, never on top, so it sits behind the game like any app. Its own
document is the shell, and each page is a surface in a WebContentsView of its
own, laid beside the sidebar and KEPT once opened, so the library keeps its
scroll, Ask Coach its conversation and Stats what it fetched. A page view is
registered under the page's id, so a push reaches it the way it reached its old
window.

```
shell/       the window's document: the sidebar (game, pages, the record card,
             account), the window's buttons, the notice line beside them and
             the Recording screen
home/        the last match and its grade, the next match's focus, Valorant's
             rank, the most repeated mistake, the grade trend, recent matches
matches/     two pages from one surface, ?section=list or patterns; the list
             carries its wins and losses beside the title (winLoss), and the
             breakdown by agent, map and queue is one folded line at the foot
             of Patterns (8.7)
moments/     the Moments page (8.7): every death and highlight of the saved
             reviews, newest match first, with the clips kept and the
             compilation by repeated mistake (below, "The Moments page")
review/      the post-match review, every game, branched on review.kind
stats/       rank, win rate, tracker matches, graded matches
chat/        Ask Coach, on the match its chip names: the newest, one picked or
             asked about from its review, or none (below, "Ask Coach")
settings/    all preferences, version string at the bottom, and under it Riot's
             notice word for word (8.3.2)
```

The pages and their order are `src/shared/shell-nav.js`. A page is loaded with
`?embed=1`, `shared/embed.js` marks it (`html.embedded`) and `ui.css` drops the
card chrome, the close button and the drag region it had as a window and
centres its column. The layout sizes, a 232px sidebar and a 40px top strip,
are in both `main-window.js` and `shell.css`: change them together.

**The Moments page (8.7)** took the Breakdown tab's place in the sidebar, the
owner's call ("the breakdown tab is kind of useless... maybe a tab with the
compilation of their deaths and highlights"). `src/shared/moments.js` is pure:
`build(game, saved, { patterns, clips, url, frames, recordingMode })` turns the saved
reviews (newest first, the patterns' own `LOOK_BACK`, which moments.js
requires from `patterns.js` and re-exports, and index.js reads as
`patternsOf.LOOK_BACK`, so there is one window) into one entry a match
(result, score, date, agent, map, mode, grade) with its moments in round
order. A DEATH is every round card with `died`, except in a round Riot says
the player sat out (8.8, `sat-out.js cardSatOut`, its AFK or stayed in spawn
flag on the card: listed before as "first to die, nobody traded it"): its title the look's cause
from the closed list in the singular (`death-causes.js causeTitle`), else
"Killed by <agent> with a <gun>" from Riot's record ("an" before a vowel, "with an Operator", since 8.7.2), else "Died"; its line what
the look saw, else where and what Riot says (first to die, nobody traded it,
after the plant); its time Riot's `sec` into the round; its marks every
counted mistake of its review whose rounds hold it (`insights.mistakes`),
`across` when the key is a pattern across matches (`patterns.summarise`); its
clip the look's, played by `clipScheme.urlFor` while on disk
(`reviewStore.clipsOf`), else `clipGone` with the review's `clipsCleared`
reason or 'gone', and nothing at all for a death never looked at, since a
clip is only cut at a look. A HIGHLIGHT is counted off Riot's verified rounds
alone: three or more kills (five an ace), a clutch Riot records as won, and
the first kill in two or more rounds running (one entry on the streak's first
round); its times are the player's kills off Riot's kill feed. The
COMPILATION groups every death in a round a pattern counts by the pattern,
over the pattern's own window only (8.7.2: the last `WINDOW` recorded
matches, where 14 saved said "280 deaths over 14 matches" beside a pattern
of 10 of 10),
most deaths first: title, fix, deaths, matches, clips, the line "20 deaths
over 4 matches, 3 clips kept", and its items by key. `clipsNote` is the one
reason no clip at all was kept ('off', 'space', 'cleared', 'nolook'), its
sentence `clipsNoteText`; every sentence the page shows is written here
(`NOTES`, `GONE`), so the page counts and words nothing. Main serves it as
`MOMENTS_GET` (index.js `getMoments`), from the same read the patterns are
made from. **No highlight clips**: Riot's record gives kill times, but a
highlight's place on the recording needs its round's barrier drop on the wall
clock, which only a look's clocked frames give (death-frames.js barrierDrop),
and cutting more clips at the look would hold the recording longer and
outgrow `MAX_CLIPS`; so a highlight is its facts and no clip, said plainly in
the page's counts.

The page (`src/renderer/moments/`, `moments-preload.js`) paints it in the
log's language: the compilation as ruled rows with Play all where clips were
kept (else "No clip kept"), a row chosen (`aria-pressed`) showing only its
deaths below; the filter All, Deaths, Highlights as one capsule
(`occlaraSeg`); the counts line; the note; then each match's ruled line over
its rows, a row a button that opens its review AT THAT ROUND (`REVIEW_OPEN(id,
round)`: index.js `setReviewJump` hands the review `jumpTo` for five seconds,
stamped `jumpAt`, and review.js `jumpIfAsked` runs `goRound` once per open,
keyed on the review, the round and the stamp, on screen, so the row flashes
and takes the keyboard as `flashTo` does, and the same round opened again
from Moments jumps again); the rows rise once per game, 40ms apart, capped at
the eighth; the clip column (`.mo-clip`) is only drawn while a clip is kept
in these matches (`#mo-list.clips`), else the time is the last column, on the
rule. THE COMPILATION PLAYER plays each clip in THE REVIEW'S OWN CLIP PLAYER
(`review/clip-player.js` and `clip-time.js`, loaded by the page, its rules in
`review/clip-player.css`, shared by both pages): the death marked on the
timeline, the time as seconds from the death, a frame step, the speed; one
player a clip, built on `#mo-pl-stage` as each comes up with the clip's
`death` and `frames` (main reads the frames with `reviewClips.frameTimes`),
its loop taken off so `ended` advances; on the clip's own `occlara-clip://`
URL (the page's CSP allows `media-src occlara-clip:`), muted, in a dialog
over the page: Esc closes it and gives the focus back, the arrows on the
dialog's buttons move between clips (inside the clip they move a second, the
player's word, `defaultPrevented`), Space plays and pauses, the toggle's label
alone says Play or Pause, the page behind is `inert` while it is open so Tab
and Shift+Tab cycle inside, "Open its review"
opens the clip's review at its round. It opens only after a match: main is
asked `SHELL_GET` and a sealed answer opens nothing, and the page's leave or
the document going hidden closes it. Empty states teach: no matches yet, no
moments on record, the note on no clips (recording off, the cap, Clear
clips, no look yet) said once. `npm run test:moments` holds the module on the
real Abyss match and on made up reviews, `test:surfaces` the page, its
filter, its player and the sidebar's lock, `check:seal` the page sealed mid
match, `check:mainwindow` the page on real views with looks seeded on the
older matches and one stub clip (`main-moments.png`, `main-moments-rows.png`,
`main-moments-highlights.png`), and a row opening its review at round 2
(`main-moments-review.png`), and `check:matches` the breakdown folded at the
foot of Patterns.

**The seal.** While a match is in progress no page is visible, whatever asks
for one. `syncSeal()` in `src/main/index.js` sets it from `isCoaching &&
matchInProgress()` on a one second tick and before every `openPage()`; the
navigation then answers `shown: null`, the shell paints the Recording screen
and locks every page in the sidebar, Settings included. A page asked for
meanwhile, the review of the match that just ended above all, is remembered
and shows when the seal lifts. Open pages through `openPage()`, never
`mainWindow.show()` directly, which would skip the seal for up to the tick. A
window made again keeps the seal, because made mid match it showed the page
asked for until the next tick. Sealed, the window is out of every capture
(content protection), so the match's recording never has Occlara in it.

**A stop in the middle of a match HOLDS the seal** (`sealHeld`, set from the
engine's `stoppedLive`). Not recording, nothing can tell when that match ends,
and Home would paint its review and the focus for the next match while it is
still being played. Held, the screen says recording stopped and the sidebar
stays open: any page the player opens lifts it, their own choice, as opening
Matches was before 8.1. Start clears it in every game, before the League
branch, and the seal then follows that recording's match: cleared in the
Valorant path alone, a held seal kept every page and the League review behind
"Recording stopped" until a Stop. A review withdrawn because its match resumed
seals first (`withdrawReview`), so its switch to Home never runs unsealed.
`npm run check:seal` boots the app with stand-in engines and holds both.

**Closing quits** (8.4.1, the player's ask: "when the user closes it, just
close it fully dont minimize it"). Its X, Alt+F4 and the taskbar's Close used
to put the window out of sight like Ctrl+Shift+M, Occlara running on in the
tray, so a review still being checked against Riot's record kept its check.
Each is now the window's `close`, held in `main-window.js` and handed to
index.js on the next turn (`onCloseAsk`, `quitFromClose`), NEVER INSIDE THE
CLOSE EVENT: Electron takes a close its handler prevented for a quit cancelled
(it clears its quitting flag as the handler returns), so the quit decided in
that same turn with nothing to ask closed every window and never quit, and the
real app ran on with no window and no tray (index.js's `window-all-closed`
keeps it alive for a tray its cleanup had taken down). It quits by the tray's
own path, `cleanupAndQuit`, and first asks only when quitting would lose
something: a match being recorded right now (the seal's live test), a review
still being built (`review-work.js leftOf`), and a League game's death clips in
the seconds after its review opens, before they are cut (`clipLolDeaths`,
`lolClipping`).
Each question is a native dialog, asked once, whose default and whose Escape
keep Occlara as it is, and a close while one is up asks nothing more. What
they say is `src/shared/quit-ask.js`, checked against what the code does: a
match quit in the middle of keeps the rounds read so far in Matches as a part,
with no read and no clips (a League game stopped part way is never graded),
counted as a stop files them (the ledger's `list()`, never `size()`, which
counts a round only begun off the loading screen or a banner, and said a round
was kept when nothing was); and a review being checked is checked at a later
launch only with a Riot ID connected and once Riot has the match, BY THE LATE
LINK, WHICH DOES NOT FINISH IT AS THE LIVE LINK WOULD: it lays Riot's record
over it with no model call, so no look at the deaths Riot times and no read
(the screen's is taken down), and the recording its clips would be cut from is
deleted as the app quits. A typed and never connected Riot ID runs no late
link, so that one says Grade my recent matches is what checks it. The tray's
Quit and Settings' quit with no question as they always did, and an update's
Restart now and Windows ending its session close the window as the app goes
(`before-quit`, `session-end`) and never ask. Ctrl+Shift+M still hides the
window to the corner mark. `test:shellnav` holds every wording and the close
held and handed over on the next turn on stand-in windows, `check:seal` the
match's and the review's questions through the real index.js (the dialog and
`app.quit` stood in for), a round only begun included, `check:clips` the
League clips' question on a real League review, and `check:mainwindow` the X
and Alt+F4 quitting with nothing asked when nothing is at stake, and never
inside their close event. A match that
resumes after its review opened minimises the window if it is in front, as the
review window used to close.

**The tray icon opens the app** (8.4.1). It had a double click alone, which
toggled the window, so a single click did nothing and a double click on a
window behind the game hid it. A click and a double click now bring the window
up and to the front on the page it was on (`tray.js`, `controller.showWindow`),
the seal settled first, so mid match it shows the Recording screen; the context
menu is as it was, its Show or Hide still a toggle. `test:shellnav` holds
`tray.js` on a stand-in Tray, `check:seal` the click from hidden, minimised and
mid match.

A WebContentsView's page is NOT closed with the window it is laid on, and
once closed its `webContents` reads undefined rather than destroyed, so
`main-window.js` closes them on `closed` and reads them through `alive()`.

**Moving between pages (8.2)** is `shell-nav.js createMotion`, carried out on
the views by `main-window.js`, with the page's half in `shared/embed.js` and
the CSS in `ui.css`. A hidden view keeps its last painted frame, so a page
shown and only then told what to look like flashes what it showed last, the
previous match's review above all. So the page on its way is shown out of
sight first: UNDER the page on screen (re-adding that one with
`addChildView` raises it), or, with none on screen (the seal lifting, the
window's first page), staged at full size with one pixel of it inside the
window's right edge. It is told to ARM (`PUSH_PAGE`): `html.page-armed`,
opacity 0 and 12px toward the side it comes from (`direction()`: down the
sidebar is forward, the review deeper than every page), with no transition.
Two animation frames later it says `PAGE_READY` by its id, and only then is
the page on screen hidden (or the staged one placed) and the new one told to
ENTER, 220ms on `--ease-expo`. A page that never answers is let in after 150ms
(`READY_MS`), one loading again after up to 1.2s (`LOAD_MS`), and a page loads
armed and lets itself in after 1.2s with no word from main (`page-disarm`), so
none can stay invisible. A STAGED page is let in by its timer only while the
window can be seen (`canSee()`: shown, not minimised and focused, because
Electron cannot say whether the game covers it), and its wait starts again on
the window's show, restore and focus: at a match's end the game is in front,
the review's view can paint nothing, and its timer placed it over the frame it
last painted, the previous match's review. A page loading again takes no
ready until its new document commits (`reloading`, cleared on `did-navigate`),
because the document it replaces can still answer an old arm. Sealing still
hides every page in the call, mid switch included. Three Chromium facts it
rests on, measured on Electron 41:

- **A view under an opaque one is occluded and paints nothing**, not one
  animation frame, so it could never arm there. For the switch the page on
  screen is made see-through behind its own document (`CLEAR`; the document
  still paints the ground, so nothing on screen changes) and opaque again once
  it is hidden or stays.
- **A view wholly outside the window is hidden too**, while one with a pixel
  inside it paints, which is what the stage is.
- **Minimised, the window's content measures 0 by 0**, a view laid out then
  is given that, and no `resize` comes on the way back, so the views are laid
  out again on `restore`: a page staged while minimised stayed 0 by 0 and
  never painted.

Make the outgoing view opaque during a switch, or move the stage wholly out of
the window, and every switch falls to the timer and the stale frame is back.
Asked for reduced motion it is a plain cut: still painted out of sight first,
but as it is. `npm run test:shellnav` holds the order of a switch, and
`main-window.js` itself on stand-in views (the window's state, its events, a
reload's old ready refused, the shell's strip kept at TOP_H with its notice
line on one line), and `check:mainwindow` the same on real views,
the seal, a page that never answers, a minimised window and a page loading
again included, and measures the record card (its two buttons alone at its
height before Start, recording between matches and mid match too) and the
notice line.

Everything else that opens moves too, on the tokens and transform, opacity or
a grid row only: the sidebar's marker is ONE element slid to the current page
(`placeMarker()`), never an item's own background, and it follows the record
card's height (a `ResizeObserver`), because once the sidebar overflows
Settings, below the card, moves with it; a dropdown closes as it
opened (`dd-closing`, then hidden); Stats' rank notes, its match rows and a
breakdown row open by height in place (`.reveal`, one grid row from 0fr to
1fr), the breakdown no longer rebuilding its table to open a row; the review's
frame zoom scales from
where the frame was (`zoomShot`); Home's sections arrive one after another on
its first paint and on a change of game, once it is on screen
(`occlaraOnShown`, `.card-in`), their rows and the trend's bars rising 40ms
apart; the library's rows rise once as a game's list first appears
(`.m-item.rise`, capped at the eighth), never on a repaint; every segmented
capsule's thumb slides (`shared/seg.js`); the Recording screen rises in; the
AI log and the weekly report ease in. `npm run test:surfaces` pins each.

**The reveal (8.7).** The review the loading screen gives way to (the
`wasBuilding` branch of `paint()` in review.js, `startReveal`) arrives in
order, once per review id the page holds in memory: the number counts up over
`--t-slow` twice, the letter stamps in after `--t-slow` (`vdStamp`, scale 1.35
to 1 on `--ease-spring`), the grade's bars fill from `scaleX(0)` one after
another (`--i` from `gradeCard`'s `opts.reveal`, 80ms apart), and the progress
chips rise in after them. A review opened later, from the library or Home, or
painted again, is painted as it ends. It is all CSS (`#vreview.revealing`,
review.css and grade-view.css): the count is `@property --n` (an integer)
drawn by `counter()` over the real number, which stays the text, and the page
only sets `--to`; it does no figure of its own. A click or a key adds
`.reveal-done`, the end state at once, and so does a timer once it is over.
Nothing reads an animation event (theme.css): the sound is a `setTimeout`
matched to the stamp's delay. Asked for less motion, nothing counts and every
delay is 0, because theme.css collapses durations and never delays.

The letter landing is heard: `shared/sfx.js` 'reveal' (a soft rising C major
triad), or 'best' (the triad and the octave over it) when the progress has a
best grade or a first S or A. It runs inside `occlaraOnShown` (embed.js), so a
review made whole while the page is off screen or sealed waits to be shown,
its reveal and its sound with it, and main is asked (`getState()`) as the
letter lands: the sound plays only with `sounds` not false and `isCoaching`
false (screen-silence.md). review/index.html must load `../shared/sfx.js`
for it to be heard; without it the reveal is silent. `test:surfaces` holds
each part with a spy on the sound.

**A death's round: the clip alone, and the killer card (8.7, the player's
ask).** Under a moment's clip there is no row of stills any more ("3 s
before" to "Just after" only took room: the clip plays every one and its
timeline marks each); a moment with no clip still shows them, all it has.
Beside it, under the coach's look (or under the why in a round with no look),
the killer card: the killer's agent icon and name, the gun's name and kill
feed icon, and the damage that killer dealt the player that round with head,
body and legs, from Riot's record only (`valorant-review.js killerCard`,
served() as view data; `review.js killerCardEl`; docs/claude/death-look.md,
"The killer card"). The icons are bundled under `assets/valorant/`
(`sync:agenticons`, `sync:weaponicons`), loaded as 'self', and one that fails
to load is taken away with its words kept. No card is a box: it opens on a
hairline, the agent's face the one framed image.

Separate windows, because they are not pages:

```
dock/        the compact always-on-top mark, click through
onboarding/  multi-page first-run flow. The app is gated behind completing it
ailog/       the AI log: every frame read and what was parsed from it, or
             one match's alone, opened from its review's eye
weekly/      weekly report popup: grades, categories, recurring mistakes
learn/       League lessons
activation/  license key entry
splash/      the launch animation
recorder/    the match recorder's page, in a window that is never shown (8.3)
frames/      a look's stills decoded from its clip, in a window that is never shown (8.3.1)
```

**Advanced coaching is shown ON (8.8).** Onboarding's After every match page
has On, advanced marked from the first paint, and Settings' switch reads on
unless the config holds an explicit false (`cfg.advancedTips !== false`). Both
say what it does now, deeper coaching that fits your rank, with no dash and no
semicolon. The toggle stays so a player can turn it off. Why it is on and the
one time switch for existing installs: `docs/claude/playbook.md`, "Advanced
coaching is a BIAS, never a replacement".

The panel and the review, matches, settings, stats and chat windows were
retired in 8.1. `npm run check:mainwindow` boots the app with saved reviews and
asserts the sidebar, Home, the page bounds, the order of a switch between
pages, the seal hiding every page, the review showing when it lifts and a
recent match opening its review.
`npm run test:shellnav` and `npm run test:homemodel` cover the navigation and
Home offline.

**The sample library and the site's proof (8.7).** The reviews
`check:mainwindow` boots on are one fixture, `scripts/fixtures/proof-reviews.js`:
four Valorant reviews built from the real Abyss match (a Jett, 13 : 11, a B of
71 as the newest, three older graded 58, 61 and 64 so the grade rises and the
newest is a best), the older three looked at in rounds 2 and 6 with a clip kept
beside the second and gone from the third, the coach's two lines (the read and
the fix) stood in for, a seeded Free account with its two games used, and the
stand-in reader. `seed(ud, { now })` writes the profile; `installStandIns()`
puts the reader and the account view in place of index.js's. The window is
pictured through `scripts/fixtures/window-shot.js` (the shell and the page
composited, as the check's shots always were), which can also hold a picture
until two captures a beat apart are the same bytes and refuse a blank one.
`scripts/export-site-proof.js --out <dir>` (`npm run export:siteproof`) boots
the real window on the library at 1280 by 800 and a device scale of 2 and
writes what the website's demos are made from, never invented:
`proof.generated.json`, every string read off the real pages (the Verdict, the
categories and their chips, the read, the fix, the lists, the rounds, the
progress lines, the Moments entries; no name, no Riot ID, no date, no id, no
dash, stamped with the commit, labelled "Sample match"), the pages as WebP
(home, matches, moments, review-top, review-rounds, settings, invite, sealed)
through ffmpeg under 3 MB in all, the share image from the review page's own
`verdict-card.js`, and `mark.json` (the crescent's path and the tokens).
`test:siteproof` runs it twice with `--json-only` and holds the JSON to the
same bytes and to those rules. The window's size is asked for again less the
delta the frameless window adds at scale 2, and `--json-only` skips the scale
and the pictures.

**Home (8.2.1), as the player asked for it.** Every section is read from the
library or the rank history, nothing invented (`src/shared/home-model.js`).
Since 8.7 it is one column in the log's order (home.css: the fix for the next
match first, at 44px, the one large thing on the page; the last match as one
ruled line with its grade, its four categories as thin rules under it and the
milestone as a dotted line; the rank; the trend beside the recent matches as
ruled rows; the most repeated mistake last), each section a hairline over a
label, with no frame around any:

- **The last match ends on two buttons and no words**: the eye's "View match"
  (`log-eye.js labelled()`, the eye the Matches rows draw, by the same
  `aiLog` rule: 'kept' opens the match's AI log over `REVIEW_AILOG`, 'gone' is
  disabled with its reason, null is no eye) and Open review. The line saying
  where the grade came from ("From what the screen read") is gone; the review
  says it.
- **The rank**, Valorant's with a Riot ID and a rated game: the newest rated
  point's tier, the last game's RR (+24 in `--good`, -15 in `--bad`, 0 dim)
  and the rank journey as a line, by Stats' own rules (`rankModel`: rated
  points only, cut at the newest jump over 300, a game's RR 60 or less), with
  Rank journey opening Stats with the journey open (8.4.1: `OPEN_STATS` with
  'journey', which main keeps until the Stats page asks, `STATS_OPENED_FOR`,
  as it loads, arms and enters, an enter alone coming to a page called back
  mid switch; it opened Stats with the journey folded in the Rank tile;
  `test:surfaces`, `check:mainwindow`). It is asked for through `STATS_RANK_HISTORY`
  only once Home is painted, so a slow history never holds Home back, and
  Home listens for a change of game, a saved review and the Riot ID from
  before its first paint: the first load waits for the rank, and a game
  picked during that wait was never heard. A paint or a rank answer overtaken
  by a newer one paints nothing (`paintAsk`, `rankAsk`). It sits
  under the next match's focus and grows to fill what the last match leaves
  of that column; with the focus and the most repeated mistake both there,
  that column is already the taller, so the rank stands above the grade trend
  instead (`placeRank`). A column with no card shown goes, and the card
  beside it takes the row.
- **A Competitive row in Recent matches shows its RR** beside its grade
  (`rrForRows`): the nearest rank history point within 45 minutes of the
  match's START, Stats' rule, because the history dates a game by its start
  and a row by its end, and measured from the end a match played straight
  after another took the next game's RR. The start is Riot's own, which a
  linked review keeps (`matchStartedAt`, set by `valorant-review.js build()`
  from the tracker match and carried on the library row), and only without
  it put back from the row's end at 100 seconds a round: a row's end is when
  the watch ended the match or Stop was pressed, so put back from there a
  match ended early or stopped landed 20 to 30 minutes early and took the
  game before's RR. A row on Riot's own start is placed EXACTLY, within five
  minutes (`RR_EXACT_MS`), since the history dates its game by that same
  start: given 45 minutes, a row whose game was not published yet took the
  game before it, a 10 to 13 loss shown as +21, and was never asked for again.
  One point is one game, given to the row it is nearest of all, so a match
  whose own game Riot has not published yet shows nothing rather than its
  neighbour's. Only Riot's "Competitive" is rated; a screen's "Standard" is
  not.
- **The RR is read again once Riot has published the game.** The history
  read as a match ends lacks it, and main and the server each keep it five
  minutes, so every save after the end read it back and Home showed the
  match with no RR, or the game before's in the rank card, until the next
  match. A review first linking (`withTracker`) marks main's history stale
  (`services/rank-history.js published()`), and the next read goes past both
  caches (`refresh=1`, once). A read still out from before never puts its
  older answer over a newer read's (`seq`). And Home asks again six minutes on
  for the newest Competitive match still without its RR, twice at most after
  a paint, only for one that ended within the hour (`rrWaiting`).
- **The grade trend keeps to 120px** (8.7; it filled its row's height before,
  and taller than the fix line it was a second hero): its bars stand on one
  ruled baseline whatever stands beside them, each its grade of the whole
  track, the number positioned off the bar rather than stacked over it.

`test:surfaces` holds Home's and Stats' answers to the same history equal,
and `check:mainwindow` measures the trend on the real layout.

**The record card is its two buttons** (8.2.1, 8.3, 8.4.4): the dot and
"Ready", "Recording", "Paused" over the buttons went in 8.2.1, the line under
them in 8.3, the player's ask ("remove any text under it just leave it with
the two buttons"), and the agent check over them in 8.4.4, the player's ask
too: "Reading your agent...", then "Playing" and the agent with a tick, or a
field to type it with the player's mains when detection found none, in a
Valorant session from Start and mid match as readily. The agent is read off
the player's own HUD in the match now (below, "The agent is read off the
player's own HUD"), so nothing opens on the card, at Start, in a match or
after it, and no channel carries an agent to a window (`AGENT_SET`,
`AGENT_CONFIRM` and `PUSH_AGENT` went, and Ask Coach's agent chip with
them). The box around the two went in 8.7: Start fills the width beside the
round pause button, both 48px, sitting directly in the rail with one padding
all round. The state is the button's word (Start, Stop, "Subscription
ended"), the pause button's icon and, recording, the Stop icon in the signal
on the dark capsule. Start is
`btn btn-rec toggle` (8.6): the signal by its own class, `.btn-rec` in
`ui.css`, never the primary, which is the ink; ended, a ghost at full
opacity. Under it the games left line (`.rail-games`, 8.7). What
the line said when there was something to say is **the notice line** in the
top strip, left of the window's buttons (`shell.js noticeLine`), empty
otherwise, never hidden, because a live region shown and filled in the same
moment is not always read out: the licence ending always (the notice or the default sentence),
then a notice from main except the "Recording..." a League session keeps up
(kind 'recording', which the button and the live card already say),
then paused in the player's language (`panel.pausedLine`), which takes the
place of a notice about the reading ('read-failed', 'capture', and the
recorder's 'recorder', whose last words are that the coach still reads your
screen up to once a second, `recorder.js everyText`, "up to" since the phase
cadence) until the resume puts it back. No "Press Start", no
"Reading your game" (`panel.noTips` went). One line, cut with an
ellipsis and whole in its title, never more than 70% of the strip, the text
out of the drag region and nothing else, so the strip still drags the window;
written only when it changes, as a polite live region.

**An ended plan says how back, and a failed payment is a grace** (8.3.2,
`license-service.js`). A plan bought after the last one ended is a NEW key,
the site minting one per checkout, while the app goes on checking the key it
holds: "Renew at occlara.app" left a player who had renewed locked out for
good. So the running app's words (`endedMessage`, the notice line, Settings'
`ENDED_MESSAGES`, the shell's `ENDED_LINE`) say to renew, then Log out in
Settings and enter the new key, and the licence window's (`messageForStatus`)
say which key to enter. The new key entered after that Log out opens the
window on no notice from the plan that ended (`license.activate` in index.js
clears it: a Log out keeps main's state, and the line still said to do what
the player had just done). A `payment_failed` key is usable until its expiry
(`usable`, the server's rule too), two days past the period end while Stripe
tries the card again: refused, a declined renewal stopped the match being
recorded within three minutes. A key the server refused stays refused on this
PC until the server's next yes (`licenseRefused`, `isLocallyValid`): stored as
'payment_failed' by a server that refused it (any before 8.3.2), that rule read
it usable, so the next outage or offline re-check revived it until the next
real answer ended it again, mid match. The grace is said once as it begins, on the
notice line (kind 'payment', `graceStep`: never pushed again over another
notice, cleared once paid or ended, decided at launch and on every re-check,
the launch's own included), and in Settings beside Manage
subscription. A licence that ends again for another reason (a grace run out,
then cancelled) says the newer reason. At launch a stored key that ended is
asked about once beside the licence window (`launchWithLicence`): a card
updated in the portal while the app was closed renews that same key, and if
the server says yes the window goes and the app opens. The server's expiry is
taken whenever it sends the field, null included, so a key made lifetime by
hand no longer ends again on the old date. A session starts with no cadence
until its engine says one (`state.cadence`), so a League session after a
Valorant one shows no Valorant tier. The licence window's "Get one" opens the sign up page
(`OPEN_PURCHASE` with 'signup', `SIGNUP_URL`), Settings' Manage subscription
the account page, and a page names which, never a URL (`test:surfaces`).

### Accounts in the UI (8.7)

The activation window is the Sign in window: "Sign in with your browser"
first (a waiting state with Cancel), "Use a licence key" opening the old key
form, and "Create a free account" (`OPEN_PURCHASE 'signup'`). Settings has an
Account section above License (email, tier, games line, account key with
Copy, Manage plan, Upgrade, Invite friends, Sign out). Home has one quiet
games line (`#h-games`). The Invite page (`src/renderer/invite/`, shell-nav
`invite`, the sidebar `.foot` button directly above Settings) shows the link,
the progress line and how it works. A locked review shows Riot's record and
the upgrade card only. Every line is a finished string from
`src/shared/usage.js`; no renderer counts. See accounts.md.

### The Profile page (8.8)

`src/renderer/profile/`, shell-nav `profile` (`nav: false`), the sidebar
`.foot` button `#nav-profile` between Invite and Settings, locked by the seal
like every page (`paintNav`, `check:seal`). Main builds the whole page
(`PROFILE_GET`, `index.js profileIpc.get`, `src/shared/profile.js build`) and
answers null mid match or sealed; the page counts nothing and names no URL
(`test:surfaces`). Top to bottom:

1. **The hero**: the games left now (Geist 600 at 72px, the biggest thing on
   the page, no rule over it), the plan and its games, the split into the
   plan's own and bonus games (only when there are bonus games), and when the
   month's games start again. Signed out it says to sign in, and with no
   state it says the games could not be fetched, with Try again.
2. **Buy more games**: the quick picks as one `occlaraSeg` capsule (1, 5, 10,
   25 with their prices), a stepper and a field for any whole 1 to 500, and
   the one primary capsule, "Buy N games for $X". The words as the number
   changes are `profile.js quote` and `step` through the preload, never the
   page's own sums. Buy is `PROFILE_BUY` (accounts.md, "Buying games, in the
   app"); signed out the same button signs in first.
3. **Your play in Valorant**: three figures, label, value and its sample.
   Most used weapon: the player's own kills by gun in Riot's kill feed kept on
   linked reviews (`rounds[].riot.feed`, `by: 'me'`, `w` a gun the game data
   knows or Melee, never an ability). Most played agent: by matches, Riot's
   agent or one the engine confirmed off the HUD (`ledger.context
   .agentConfirmed`), never a detection alone. Peak rank: Riot's highest rank
   on the account (the tracker profile's `peakRank`: HenrikDev MMR v3's
   `peak` since 8.7.9, with its act, "in E9A2", from `rankDetail.peakSeason`,
   and v2's `highest_rank` when v3 fails) or, higher or without it, the best
   rated game in the rank history main keeps, with its day. Each says its sample or an honest empty
   state (Play a match, Connect your Riot ID, no gun named yet, could not be
   fetched). League is never counted.
4. **Plans**: Free, Pro and Max as ruled rows (prices in `profile.js PLANS`,
   games from `usage.js`), a Monthly and Yearly capsule, the current plan
   marked "Your plan" in a ringed capsule, the others a ghost capsule that asks
   main for `occlara.app/#pricing` (`PROFILE_PLANS`).

The page asks again on `ACCOUNT_CHANGED`, `PUSH_REVIEWS` and on coming back to
the front after 30 s, so games bought in the browser show on return.
`OCCLARA_SHOTS=1 npm run check:mainwindow` writes `main-profile.png` and
`main-profile-plans.png` on the sample library.

### What's new and the Discord

`src/renderer/whatsnew/`, shell-nav `whatsnew` (`nav: false`), right after
Settings in the page order and marked as Settings in the sidebar: the
changelog, newest version the hero at 32px, each version a ruled section with
its changes as rows and the kind a small word. Opened from Settings (the row
"What's new in Occlara" and the version line, whose update check is now
"Check for updates" beside it) and from Home's update line, "Occlara updated
to X. See what's new", said once after an update at the right of Home's
title, never mid match. The Discord is a quiet icon at the end of Settings'
row in the sidebar's foot (`#discord`, `.foot-icon`; the foot is a two
column grid so its rows keep their order) and Settings' row "Community".
Everything about them: changelog.md. `check:mainwindow` writes
`main-whatsnew.png`, `main-whatsnew-older.png` and
`main-settings-community.png`, and `main-home.png` with the update line.

### Report a problem

`src/renderer/feedback/`, shell-nav `feedback` (`nav: false`), opened from
the flag icon at the end of Profile's row in the sidebar's foot
(`#nav-feedback`, `.foot-icon`), directly above the Discord, and locked by
the seal like every page. The player's words, a kind, up to three pictures
and Send; main checks and downscales the pictures and sends the report.
Everything about it: feedback.md. `check:mainwindow` writes
`main-feedback.png`, `main-feedback-filled.png` and `main-feedback-foot.png`.
