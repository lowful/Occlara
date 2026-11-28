# The UI

Moved out of CLAUDE.md word for word, nothing reworded or dropped (CLAUDE.md as of commit cc1f880, 8.5.0, lines 1996 to 2323). Sections here: "The UI". Its part "Rules for UI work" is in ui-rules-ipc.md. "Above" and "below" in the text name sections that may now sit in another file under docs/claude/: grep the section's title there to find it. The table in CLAUDE.md says which file to read for which work.

## The UI

Every surface is a plain folder with `index.html`, a `.css` and usually a `.js`.

**ORBIT (27 Nov 2026, the owner's pick; phase 1 on feat/orbit).** The visual
system is Orbit now (`DESIGN.md`, built from the redesign folder's
`ORBIT-SPEC.md`); where this file describes the Progress v3 look below, Orbit
wins. What phase 1 changed, and what to keep true:

- **The bar is 56px** (`main-window.js TOP_H`, `shell.css .bar`): the crescent
  and "Occlara", then FOUR LINKS, Home, Matches, Practice and Clips, plain
  words with one 4px dot gliding to the current one (`placeMarker`, the smooth
  spring over 420ms), then Start at the bar's size (hidden on Home, whose hero
  carries the big one), the pause button while recording, the profile button
  and the window's buttons. Each link is a GROUP of pages (`shell-nav.js TOP`):
  Matches holds the library, Patterns, Stats and the review it opens; Practice
  holds the drills and the Trainer; Clips is the Moments page. A link is found
  by the page it lands on (`#nav .nav-item[data-page="moments"]` reads Clips).
  No page was lost: Patterns and Stats are reached inside Matches and the
  Trainer inside Practice by THE SUB SWITCH (`shared/subnav.js`, `.subnav`, a
  segmented control at the head of each of those pages, its pages from
  `shell-nav.js SUB` through each preload's `subnav`), and Ask Coach is a row
  of the profile menu (`#nav-coach`) and the review's "Ask about this match".
  The `nav` flag on a page still says it is one of the primary pages. Mid match
  the links dim to 35% beside a lock and "Locked until the match ends", every
  link and row locked by `syncSeal` as before, and the bar's Stop goes: Stop is
  the Recording screen's own (`#live-stop`), the pause button stays.
- **A trap:** a classic script's own top level `const top` collides with
  `window.top` and the whole script fails to run, silently. The shell's list
  of links is `topLinks`.
- **The sky** (`shared/sky.js`): stars and the moon's lit limb, drawn in the
  window's own coordinates, so Home (a view 56px down) and the bar's strip of
  it meet with no seam. The moon is drawn once (a few hundred ms) and kept in
  localStorage, which every page shares; it is never drawn mid match.
- **The Recording screen** is one centred column over the sky (screen-silence.md).
- **Home** is the fix as the hero (split at its colon into a headline and a grey
  sub line), Start and Open last review, the last match's agent floating in
  front of the moon (the bundled 256px icon, round: the app ships no full
  portrait), then the bento of the last match, the trend (the grade line, its
  own card now) and what repeats, then the moment the coach looked at beside
  the rank, then the recent matches.
- **The review's hero**: the grade's number at 132px with its letter, "out of
  100" and the change on the last match (`.vd-delta`, from main's progress),
  the medals (`paintMedals`: real facts only, main's own, never another
  player's name), the fix in two tones, and Ask about this match (`#ask`, moved
  out of the header) beside Every round. The result reads in sentence case.
- **Phase 2, every other page** (DESIGN.md, "What is built"): the page head is
  the title at the display size and a grey sub line (`.page-sub`, the header's
  last child; Matches and Patterns set theirs from `matches.js SECTION_SUBS`), one
  hero per page, groups as cards with a mono eyebrow, no card inside a card. The
  Moments page is titled Clips everywhere the player sees it (`shell-nav.js`
  label, its title, its window title); its id, files and channels keep moments.
- **Looking at it**: `env -u ELECTRON_RUN_AS_NODE npx electron
  scripts/shot-demo.js home review recording` boots the shell and a page each
  with its real preload, answers their IPC from the sample library and writes
  `dist-surface-shots/demo-<scene>.png` (scenes: home, matches, patterns, trainer, coach, settings, profile, invite, whatsnew, feedback, players, duos,
  stats, practice, clips, review, stop, recording, waiting, held). Dev only.

**Top navigation (Progress v3).** The sidebar is gone. The shell is a 64px bar
across the window (`main-window.js` `SIDEBAR_W` 0, `TOP_H` 64): the crescent
and Occlara, the pages as pill tabs with one sliding pill marker
(`placeMarker`, the tabs alone), the notice line, then the game switch, the
record controls, the avatar and the window's buttons. Start is drawn in the
bar on every page but Home, whose Start strip is the big one (`.home-page`);
recording, Stop and pause are there on every page, and mid match Stop is the
large capsule (`.sealed-live`). Mid match the tabs are locked by `syncSeal`
as the sidebar's items were, and "Locked until the match ends" sits beside
them. The avatar opens the account menu (`#drawer`, a dropdown since 8.9.1,
`role="menu"`, every row a `menuitem`): the Riot ID line, the games left,
Profile, Invite, Settings, Learn (League), Report a problem and the Discord,
each locked by the seal like a tab. It hangs under the avatar at the window's
right and comes down in 160ms eased out (`menuIn`, a cut under reduced
motion). **It floats over the page, which never resizes for it (8.9.1).** A
page's view paints over the shell's document, so the shell cannot draw below
the bar: the menu is a small see-through view of its own
(`src/renderer/menu`, `menu-preload.js`), made hidden once the shell loads,
laid on top of every page while open at the menu's rectangle plus room for
its shadow, and hidden and emptied on close (`main-window.js openMenu`,
`closeMenu`, `raiseMenu` keeps it above a page the motion raises). The shell
stays its owner: `#drawer` is laid out there but never painted
(`visibility: hidden`), its rows locked by the seal as before, and
`shell.js syncMenu` sends its markup and rectangle (`SHELL_MENU`) on opening
and on every change while open (a MutationObserver, so a seal locking a row
reaches the view). The view draws them with `shell.css`, holds the keyboard
and names a row chosen (`MENU_ACT`); main passes it to the shell
(`PUSH_MENU_ACT`), which clicks its own row only if it is a menuitem that is
neither hidden nor disabled. Until 8.9.1 main narrowed the page by
`DRAWER_W` 296 for the full height while it was open, an empty strip and a
reflow; that constant is gone. Opened by the keyboard (Enter, Space, the
arrows on the avatar) it focuses its first row (ArrowUp, its last); opened
by a press the menu itself holds the focus, no row ringed. Arrows, Home and
End move, and choosing a row, Escape, Tab, the avatar again (its press
remembers the menu was open, so the click after the view's blur does not
reopen it), a press anywhere outside it, the view losing focus or the window
losing focus closes it; Escape and Tab hand focus back to the avatar.
`check:mainwindow` holds the page's bounds unchanged with it open and
`main-drawer.png` pictures it. The game
switch's "Coming soon" popup sits inside the bar, left of the capsule, for
the same reason: hung below the bar it was cut to a sliver by the page.
Where the text below says "the sidebar", read the bar and the
drawer: the ids (`#nav`, `#rec`, `#nav-settings`, `#discord`, `#rail-games`,
`#account`) are the same.

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
stats/       rank, win rate, your numbers (the profile's ACS, K/D, damage,
             per round numbers and shot split), top agents, maps (counted
             from the match list), acts (Riot's record), tracker matches,
             graded matches. The three middle sections are read by
             shared/stats-profile.js from what the dashboard already
             fetched (`profile` in getStatsDashboard), no request of their
             own, each hidden with nothing in it (test:statsprofile)
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

**The Patterns grade chart has one encoding, height** (8.9.1, the owner's
ask: green, amber and white bars with no key "seem like random colors").
`matches.js paintTrend` draws every bar in one neutral tone, the newest in
the ink and named Latest under it, the first bar of each day its short date,
the value over each bar in Mono, the letter floors (C 60, B 70, A 80, S 90,
`grade.js letter()`) as labelled hairlines, the average as a dashed line,
one plain line above saying what it is, and a key under it naming every mark
that is on it (latest, average, provisional, a record, a run). Never colour a
bar by its letter again; the letter is on hover. The four categories under it
say they are averages over the window (`.p-cats-cap`) and each says in an
arrow AND a word whether the last match was above or below (`.p-cat-vs`).
`test:surfaces`, "the match library", holds all of it.

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
"Killed by <agent> with a <gun>" from Riot's record ("an" before a vowel, "with an Operator", since 8.7.2), else "Died"; beside
the title, what killed the player as its bundled icon (Nov 2026,
`killIcon`, `kit-icons.js`: the gun's kill feed icon, or the killer's
ability when the kill was one, `{ kind, file, label }`, null for a word the
index does not know; `moments.js killIconImg` draws only a file of the
index's shape, the label as alt and title, and takes away one that fails to
load; a highlight has none); its line what
the look saw, else where and what Riot says (first to die, nobody traded it,
after the plant); its time Riot's `sec` into the round; its marks every
counted mistake of its review whose rounds hold it (`insights.mistakes`),
`across` when the key is a pattern across matches (`patterns.summarise`); its
clip the look's, played by `clipScheme.urlFor` while on disk
(`reviewStore.clipsOf`), else `clipGone` with the review's `clipsCleared`
reason or 'gone', and nothing at all for a death never looked at, since a
clip is only cut at a look. A HIGHLIGHT is counted off Riot's verified rounds
alone: two or more kills (2K to 5K, five an ace), a clutch Riot records as won, and
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
made from. **A highlight has its own clip (8.17)**, since the player got a
3K and nothing of it was kept: a highlight with kills (2K to 5K, or a clutch
won) carries the card's `highlight` (`{ clip, length, kills, cuts }`, the
clip `h<n>-clip.mkv`, every number ms on the clip's own timeline), played
by its URL with its kill and cut marks (`highlightClipOf`), gone with its
reason as a death's is, and nothing at all where none was cut (its kills
could not be timed, recording off, a review saved before); a first kill
streak is no one moment and never has one. Every highlight clip kept makes
the REEL (`reel`: `{ key: 'highlights', title, line, clips, items }`, null
with none), beside the compilation and never in it, since that one counts
repeated mistakes; highlight clips count in `counts.clips`. How they are
cut is clips.md, "Highlights".

The page (`src/renderer/moments/`, `moments-preload.js`) paints it in the
log's language: the highlights reel first where one is kept (8.17,
`#mo-reel`, "Highlights reel": one ruled row, "Your highlights" and main's
line, the row choosing the Highlights filter, Play all playing every
highlight clip in the same player), the compilation as ruled rows with Play all where clips were
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
and a highlight's with its `kills` and `cuts` (8.17: each kill a tick in
`--good`, each cut a break in the track, the skipped seconds in their titles
and the timeline's, and "12 s skipped" over the picture as playback crosses
one; named "The highlight of round N"),
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
and locks every page in the sidebar, Settings included. In a Valorant match
that screen is the live status (Progress v3, the owner's choice): the map's
art behind one card with the agent, the score, the round and the round tape,
each only while its switch is on, and the review as a locked ring beside it
(`shell.js paintLive`, main's `PUSH_LIVE`); held, or in League, it is the
quiet crescent and its line (`.sealed-quiet`). What it may show and why:
`screen-silence.md`, "The live status, the one exception". A page asked for
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
to 1 on `--ease-spring`), the fix for next match (`#v-focus-wrap`) rises in
as the letter lands (`m-rise` after `--t-slow`), before the standout, the
grade's bars fill from `scaleX(0)` one after another (`--i` from `gradeCard`'s
`opts.reveal`, `--stagger` 40ms apart since 8.9.2, review.css overriding
grade-view.css's 80ms), and the progress chips rise in after them. A review opened later, from the library or Home, or
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

**The rest of the review's motion (8.9.2, review.js "MOTION ON THE PAGE",
review.css).** All of it on screen only (`Motion.whenShown`), none of it
under reduced motion, and no animation event read. The loading screen's steps
rise 40ms apart the first time it shows for a review (`tickIn`,
`Motion.stagger`), each done step's check drawn (`.m-draw`); after that only a
step just done draws its check, and a repaint never rises again. A round, a
League death or a mistake below the fold waits unseen (`.in-wait`) and rises
once as it is scrolled to (`scrollIn`, one IntersectionObserver, `.in-play`,
40ms apart for rows arriving together, six at most), keyed by review and row
for the visit, so the screen look landing repaints nothing that was seen; a
row in view when painted is never held back, and a jump (`flashTo`) settles
its row at once. A still and a clip's picture fade in as they load
(`fadeThumbs`, 220ms, shown anyway after 4 s). A folded round's body and the
study notes and refusals open and close by height, one grid row over
`--dur-base`: the body keeps `hidden` (set at once, as the tests read it),
which review.css draws as a closed `minmax(0, 0fr)` row going invisible only
once closed, and the `<details>` fold their `::details-content` with
`content-visibility` carried over as a discrete step.

**A death's round: the clip alone, and the killer card (8.7, the player's
ask).** Under a moment's clip there is no row of stills any more ("3 s
before" to "Just after" only took room: the clip plays every one and its
timeline marks each); a moment with no clip still shows them, all it has.
Beside it, under the coach's look (or under the why in a round with no look),
the killer card: the killer's agent icon and name, the gun's name and kill
feed icon, and the damage that killer dealt the player that round with head,
body and legs, from Riot's record only (`valorant-review.js killerCard`,
served() as view data; `review.js killerCardEl`; docs/claude/death-look.md,
"The killer card"). When the kill was an agent's ability (Riot's record
names it as the weapon, "Headhunter", "Blade Storm"), the card shows that
ability's icon beside its name in place of a gun's (`weaponKind: 'ability'`).
The icons are bundled under `assets/valorant/`, loaded as 'self', and one
that fails to load is taken away with its words kept. No card is a box: it
opens on a hairline, the agent's face the one framed image.

**The weapon and ability icons (Nov 2026).** `npm run sync:kiticons`
(`scripts/sync-kit-icons.js`; `npm run sync:weaponicons` still runs the same
script) pulls from valorant-api.com each gun's kill feed icon into
`assets/valorant/weapons/<Name>.png` (the knife is Melee) and each playable
agent's four ability icons into `assets/valorant/abilities/<Agent>-<Slot>.png`
(Ability1, Ability2, Grenade, Ultimate; the passive is left out), and writes
their index, `src/shared/valorant-kit-icons.generated.json` (`{ weapons:
{ name: file }, abilities: { agent: [{ slot, key, name, file }] } }`). The
agents' icons stay `sync:agenticons`. Run `sync:valorant` first: only an agent
the game data knows is written, and the sync fails closed (fewer than 15
guns or 20 agents, an agent missing an icon, a download that fails, and
nothing is written). `src/shared/kit-icons.js killIcon(name, agent)` turns
the weapon as Riot's record names it into `{ kind: 'weapon' | 'ability',
file, label }` or null: a gun by its name, an ability in the killer's own kit
alone when the index knows that agent (another agent's ability shows no
icon), and without the agent only a name one kit holds. MAIN PICKS THE FILE:
`file` is always one the index names, never a path built from the word handed
in, and a page never builds a path from text; it only checks that the path
main served is of the index's shape before drawing it. Three places draw
them: the review's killer card (`valorant-review.js killerCard`, `weaponIcon`
and `weaponKind`), the Moments page's death rows (above) and the Profile's
Most used weapon (below). `npm run test:kiticons`.

**Fight it again (Nov 2026).** A death the Trainer can replay has a Fight it
again button beside Further explain in its row (`review.js deathExtras`,
`replayButton`, the shared `btn btn-ghost sm`, the two in one
`.v-death-actions` row, an answer already given dropping below). Main decides:
index.js `present` marks each such card with its replay id
(`trainer-replay.js markRounds`), never mid match or sealed, and the page
draws the button only on a died round whose id has the shape. A click is
`review-preload.js openReplay(id)`, `TRAINER_OPEN` with `replay:<id>`, and
main checks it again before it opens the Trainer on that death. What a replay
is: `docs/claude/trainer.md`, "Fight it again".

**Occlara Wrapped** (`src/renderer/wrapped/`, wrapped.md) is no page: the
year's story is a view of its own over the WHOLE window, the bar included
(`main-window.js openWrapped`, the games toast's pattern), made fresh for each
showing and closed with its page after it, under the games reveal and the
menu, closed by the seal in the tick it comes on. It is the one surface with
a look of its own (ui-rules-ipc.md, "Wrapped's own look").

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
the fix) stood in for, a seeded Free account with its free games used, and the
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
and the pictures. Since Orbit (28 Nov 2026) the walk takes the four links
(Home, Matches, Practice, Clips) and reaches Patterns by the sub switch on
Matches; the JSON names the bar's height (`window.bar`, `TOP_H`, 56) and
`places` holds where the site's pointer goes on each picture, read once the
picture is taken: the links (`tabs`), the sub switch and the rows on Matches,
the compilation's chips and their Play all (`moments`, an action null on a
chip with no clip kept, which shows none), the hero and the filter on Clips,
and the review's grade, fix, Ask about this match and Every round. A place
off its picture, or of a thing that does not show, is null. The ambient loops
(the agent's drift, the twinkling stars) are held (`Motion.ambient(false)`)
before each picture, or two captures never agree. The site's two clips of
real matches (`clip.mp4`, `clip2.mp4`, their posters and `clip-review.json`,
`clip2-review.json`) are NOT this export's: they come from the owner's own
library by hand, and a new export is copied over them, never in place of the
folder.

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

- **The player's own Riot ID, the last game's K/D and the clip played on
  Home** (9.0, the player's ask). Beside the title, the Riot ID in Settings
  as a capsule (the name, the tag quieter), read from the state main pushes
  and never any other player's; without a whole Name#TAG a quiet "Connect
  your Riot ID" opens Settings (`paintPlayer`). In the last match card, at
  the right of the grade, the K/D of that match: the ratio to two places and
  kills / deaths, from the newest whole review's own `scoreline`
  (`home-model.js kdOf`, whole counts only, the kills alone with no death,
  none while the review is being built). The Fix card's play mark plays the
  kept clip right there, in the review's own player (`review/clip-player.js`,
  loaded with `clip-time.js` and its CSS; the page's CSP adds `media-src
  'self' occlara-clip:`), from the URL, death and frames `REVIEW_GET`
  presents (`home-preload.js fixClipOf`, the URL held to
  `occlara-clip://review/<id>/<name>`); without them it opens the review at
  that round as before. A repaint keeps the same clip playing, and any other
  paint releases it (`stopClip`). `test:homemodel` holds the K/D.

- **Occlara Wrapped's invitation** (wrapped.md), from 15 December to 31
  January only: one strip under the title in the app's own look (`#h-wrapped`,
  the Start strip's shape: the crescent, main's line from `WRAPPED_ENTRY`,
  "Play your 2026 Wrapped" as a dark capsule, `WRAPPED_OPEN`), or the line
  alone when the year has fewer than 5 reviewed matches of one game. Asked on
  Home's one review listener and as Home arms; hidden mid match (main answers
  null). `check:wrapped` reads it and presses it.

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
   knows or Melee, never an ability), with the gun's kill feed icon beside its
   name (Nov 2026, `profile.js weaponFigure` sets `icon` from
   `kit-icons.js killIcon` only for a weapon; `profile/profile.js` draws only a
   `valorant/weapons/<Name>.png` path, the name as alt and title, and takes
   away one that fails to load). Most played agent: by matches, Riot's
   agent or one the engine confirmed off the HUD (`ledger.context
   .agentConfirmed`), never a detection alone. Peak rank: Riot's highest rank
   on the account (the tracker profile's `peakRank`: HenrikDev MMR v3's
   `peak` since 8.7.9, with its act, "in E9A2", from `rankDetail.peakSeason`,
   and v2's `highest_rank` when v3 fails) or, higher or without it, the best
   rated game in the rank history main keeps, with its day. Each says its sample or an honest empty
   state (Play a match, Connect your Riot ID, no gun named yet, could not be
   fetched). League is never counted.
4. **Your year** (wrapped.md): Occlara Wrapped's entry, main's line and its
   button (`#pr-wrapped`, `WRAPPED_ENTRY`, `WRAPPED_OPEN`), inside the window
   ("Play your 2026 Wrapped") and after it for the latest year begun ("Play
   2026 again"); a year without enough matches says so with no button.
   Hidden with nothing to say.
5. **Plans**: Free, Pro and Max as ruled rows (prices in `profile.js PLANS`,
   games from `usage.js`), a Monthly and Yearly capsule, the current plan
   marked "Your plan" in a ringed capsule, the others a ghost capsule that asks
   main for `occlara.app/#pricing` (`PROFILE_PLANS`).

Between the figures and Your year sits **Public profile** (docs/claude/social.md):
the username, the opt ins and the preview, hidden until player search is
open. The Players page it links to is social.md's too.

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

### The Practice page

The owner's ask: "something where the players can actually improve with". A
tab right after Patterns (`shell-nav.js` `practice`, `src/renderer/practice/`,
`practice-preload.js`), Valorant only: a PLAN from the player's own repeated
mistakes, never generic tips. Everything is kept on this PC and nothing is
sent anywhere; the page says so at its foot.

- **The plan is the Patterns page's own list** (`src/shared/practice.js`, pure;
  `src/main/services/practice-store.js` in main, wired in index.js as
  `practiceIpc`). Main reads exactly what `getPatterns` reads
  (`reviewStore.recent` over `patterns.LOOK_BACK`, `patterns.summarise`) and
  takes its two most serious mistakes that the drill library has drills for,
  each with "In 4 of your last 6 recorded matches", the patterns' fix, and up
  to three drills for that cause at the player's rank band (`rankBandNow`,
  rank-band.js): the band's own drills first, then every band's, never another
  band's while one fits.
- **The drill library** is `src/shared/drill-library.json` (its own agent's
  file, `test:drilllibrary`): `{ version, drills: [{ id, title, cause, where,
  minutes, bands, steps, goal, why, check }] }`, the cause a death-causes.js or
  insights.js key without its `cause:` prefix, or `general`. `practice.js
  normaliseLibrary` reads it in that shape or as a bare array, with `causes`,
  `name`, `mode`, `duration` as other names; a drill with no id, title, cause or
  step is dropped, a dash in it becomes a comma, and a drill about credits or
  buys is dropped (the economy is out of scope). `where` is shown as Practice
  Range, Deathmatch, Custom game or Unrated match. Read again only when the file
  changes; `OCCLARA_DRILLS` names another file in a dev run.
  `scripts/fixtures/drills-sample.json` is the tests' own small library.
- **It does not churn.** The plan is stored in the store's `practice` key,
  schema `practice.js SCHEMA` (1): `{ v, plans: { valorant: { madeAt, focus: [{
  key, title, since, drills }] } }, log: [{ id, drill, title, minutes, cause, at
  }] }`, read through `normaliseState`, so a missing, malformed or future value
  is nothing saved and never a throw. A focus stays while its mistake is still
  in the patterns' list, whatever its order; it is replaced only once its
  mistake has left it, and a drill only once it is finished (`FINISH`, three
  marks), by the next one for that cause. No repeated mistake with drills, no
  plan.
- **A drill card**: where, minutes, title, the why, 3 to 6 steps, the goal and
  "How you will know" (the drill's check line, what the next review will show),
  and Mark as practised: one dated entry, once a day a drill ("Practised
  today"), "Done 2 of 3 times" under it.
- **The player's own clip of it** (8.11, the owner's ask: show the mistake,
  do not only tell it). Each focus, and the review's link to a mistake not in
  the plan, carries the newest kept clip of that mistake (`practice.js
  clipFor`): THE MOMENTS PAGE'S OWN JOIN, `moments.js mistakesAt` for the
  rounds a review counted it in and `clipOf` for what is still on disk, the
  newest recorded match first and inside it the latest round; a round sat out,
  one not died in and a Riot only match are never shown, and a clip named on a
  card but gone from disk (the cap, Clear clips) is passed over for the next
  one kept. Main builds it in `practice-store.js` from the review store it is
  handed (`deps.reviews`, index.js `practiceIpc`: `reviews: reviewStore`;
  without it no clip, the page as before): the URL is `clip-scheme.js urlFor`,
  the frames `review-clips.js frameTimes`, the poster the look's own frame
  nearest the death from before it as a data URL, and the words main's ("Your
  newest clip of this mistake", "Round 7 on Ascent", "The clip of round 7").
  Nothing the page hands in names a file. The page draws a tile under the
  mistake's fix and above its drills (`.pc-clip`: the poster with the play
  mark, the line and the day, Watch the round); a click on either opens the
  review's own clip player in its place (`clip-player.js`, `clip-time.js`,
  `clip-player.css`, loaded as Moments and Ask Coach load them) and plays it,
  muted. No clip kept, no tile and no empty box. A repaint (a mark, a review
  saved) carries an open clip across as it is, playing or not; one whose clip
  is gone is let go. Leaving the page pauses everything on it.
- **A drill's demo** (8.11): an optional `demo: { src, poster, secs }` on a
  drill (the drill library, playbook.md), the owner's own short recording
  hosted at `https://occlara.app/drills/` (`scripts/make-drill-demo.js`,
  `docs/drill-demo-guide.md`). `practice.js demoOf` keeps it only when both
  URLs are https on that host under `/drills/`, with no query, fragment, login
  or port, a video (webm, mp4) and a picture (webp, jpg, png); otherwise the
  drill reads as having none. The card puts it at its top (`.pc-demo`), HIDDEN
  UNTIL ITS POSTER HAS LOADED, and takes it away at the first failure of
  either file, so offline the card is exactly as before. A muted loop
  (`preload="none"`, nothing of it fetched before) plays while the pointer is
  over it; a click plays it and keeps it playing, a second stops it; out of
  view or on leaving the page it stops. Under reduced motion a hover does
  nothing: the poster waits with its play button for a click. "Demo, 8 s" sits
  on it.
- **Its CSP** allows the website for pictures and media alone: `img-src 'self'
  data: https://occlara.app; media-src 'self' occlara-clip:
  https://occlara.app`, with `base-uri`, `form-action` and `object-src`
  `'none'` as every page. Nothing else on the page reaches the web, and
  nothing of the player's is sent anywhere.
- **Is it working?** For each focus, the last five recorded matches since the
  plan against the five before them, as counts: "Down from 5 of 5 to 2 of 5",
  "Up from 1 of 5 to 3 of 3", "Same, 2 of 5 both times", "Same rate, 2 of 4
  against 1 of 2", "In 2 of your 3 matches since the plan" with nothing before
  it, and "Not enough matches yet" under three since the plan. A match that
  could not count a Riot only key (`progress.js couldCount`, now exported) is in
  neither window. Under it, quiet, the days practised in a row and the minutes
  in all, once there are any.
- **The log**: every mark, dated, each deletable (`PRACTICE_REMOVE`).
- **Empty states**: League shows the panel naming the game; no drill library a
  calm line and the log; no matches yet and no repeated mistakes yet each say
  why and show the `general` drills at the band. Without a Riot ID the band line
  says the drills fit every level, with Connect your Riot ID (Settings).
- **Home's line**: "Today's practice: <drill>, 20 minutes" under the Fix card
  (`#h-practice`, `PRACTICE_TODAY`), the first unfinished drill of the first
  focus, only with a plan and before the day's first mark; it opens the page.
- **The review's Practise this** (`.v-practise` under the fix, `review.js`
  one block): `PRACTICE_OPEN` with the review's top mistake opens the page on
  it, the focus marked "from your review" where it is in the plan, else its
  drills shown on their own above the plan and not stored. Main answers it
  once (`opened`), and the page hands it back on every ask of that visit.
- **Never mid match** (screen-silence.md): the page is a tab like the others,
  locked by `syncSeal`; `PRACTICE_GET` and `PRACTICE_TODAY` answer null and
  `PRACTICE_MARK` and `PRACTICE_REMOVE` `{ ok: false, error: 'match' }` mid
  match or sealed, and Practise this opens nothing (`check:seal`).
  `PUSH_PRACTICE` tells the pages to ask again after a mark or a removal.
- **Train this** (trainer.md): a drill may carry `trainer: "<scenario id>"`,
  the Trainer scenario that truly trains what it asks (the drill library tags
  only aim, peeking and pre-aim drills). `practice.js normDrill` keeps it only
  when it is a string matching `/^[a-z0-9-]{1,48}$/` that
  `src/shared/trainer-scenarios.json` names, else null; `drillView` hands the
  page `trainer` and `trainerTitle`, the scenario's name as the Trainer writes
  it ("Micro flicks", "Site retake, Hard"). The card's foot then ends with
  Train this (`btn btn-ghost sm pc-train`, the same capsule and size as Mark
  as practised, appended last so nothing before it moves), titled "Opens the
  Trainer on <trainerTitle>"; a click is `practice-preload.js openTrainer(id)`,
  `TRAINER_OPEN`, and main opens the Trainer page on that scenario
  (`trainer-store.js open`, refused mid match or sealed and for an unknown id).
  It writes nothing.
- **The bar at 960**: eight tabs (Home, Matches, Patterns, Practice, Trainer,
  Moments, Stats, Coach), Start and the window's buttons fit at the
  window's least width. `shell.css` draws the tabs in at three widths, from
  14 px a side with 4 px between them: at 1280 px and under, 10 px a side
  and 2 px between; at 1100 px and under, 9 px a side, the brand keeps its
  crescent alone and the bar's gap is 12 px; at 1040 px and under, 7 px a
  side with no gap between them, the bar's gap 8 px and its left padding
  20 px, which leaves the last tab clear of the game switch.
  `check:mainwindow` measures it at 960 on the Trainer page, with Start in
  the bar: eight tabs, none cut, the last one ending before what follows it.
- Tests: `test:practice` (the library, the plan, no churn, the refresh after
  three marks, the wording at each threshold, the store's tolerance, Home's line
  once a day and never mid match, the page's dom hooks and its bridge; since
  8.11 the own clip's join over a real review store in a temp folder, newest
  wins, a clip deleted from disk, no clip no tile, Watch the round in the clip
  player, a repaint keeping it open, the demo URLs kept and refused, the card
  unchanged offline, the hover and reduced motion, and the CSP),
  `test:shellnav` and `test:surfaces` (the tab), `check:seal`,
  `check:mainwindow` (the plan on the sample library, a mark and its removal
  moving the log and Home's line, the review's Practise this, the bar at 960;
  `OCCLARA_SHOTS=1` writes `main-practice.png`, `main-practice-working.png`,
  `main-practice-marked.png`, `main-bar-960.png`,
  `main-bar-1280.png`, `main-practice-opened.png`,
  `main-home-practice.png` and `main-review-practise.png`). Train this:
  `test:practice` (the tag kept only when valid, the view's name for it, the
  button on a tagged card alone and its `TRAINER_OPEN`) and
  `test:drilllibrary` (every tag a known scenario, only on aim drills).

### The Trainer page

An aim and movement trainer that runs entirely in the page, the tab right
after Practice (`shell-nav.js` `trainer`, `src/renderer/trainer/`,
`trainer-preload.js`, `src/main/services/trainer-store.js`). No AI and no
network. The page is a rail (the player's own deaths to fight again, then
the 16 scenarios in 11 rows, or the settings) and a stage (the 3D view, a
night scene of our own arenas with generic CC0 models, with the selected
scenario's panel over one still frame in the menu); a click on a row selects
it, and Play, Enter or a double click starts it. Its numbers, the look and
the models, the loop, input, scoring, storage, Fight it again, the seal and
the Ctrl+Shift keys it holds while it has the mouse are all in
`docs/claude/trainer.md`. Practice's drills link into it with Train this
(above), and a review's deaths with Fight it again (the review's paragraph
"Fight it again", above). `check:mainwindow` opens it from its tab, holds it to its menu with
a row for every scenario and no loop running, and with `OCCLARA_SHOTS=1`
writes `main-trainer.png`.

### Report a problem

`src/renderer/feedback/`, shell-nav `feedback` (`nav: false`), opened from
the flag icon at the end of Profile's row in the sidebar's foot
(`#nav-feedback`, `.foot-icon`), directly above the Discord, and locked by
the seal like every page. The player's words, a kind, up to three pictures
and Send; main checks and downscales the pictures and sends the report.
Everything about it: feedback.md. `check:mainwindow` writes
`main-feedback.png`, `main-feedback-filled.png` and `main-feedback-foot.png`.

### The games toast (8.9.1, a centred reveal since 8.10.4)

When the account's games go up for a reason the player did not just spend or
reset, a centred reveal plays over the window (a gift opening, or the crescent in a ring for a plan, the surface below), saying "You
got 2 games" and one line with the reason, "Someone sent you a gift, 25
games a month." (a gift, `source` 'gift' on `/account/me`), "Thanks for your
purchase, 25 games a month." (a plan starting or moving up), "Your invite
paid off." (`bonus_earned` up), "Thanks for your purchase." (`bonus_pool` up
beyond the referral's share, games bought), "Free is now 4 games."
(`free_total` up). A gift names its giver only by the first name they signed
it with (GET /api/gifts, the running gift's `from_name`), never a Riot ID
(a name with `#`, an email or a link is dropped), else "Someone".

- **Detection** is `src/main/services/games-toast.js`, pure: every fresh
  account state (account-service `onChange`, `index.js observeGames`) is
  compared with the last one this PC kept for the SAME account
  (`gamesSeen` in the store, the account named by a hash of its key or
  email). It compares the allowance's parts, tier, source, cap_monthly,
  free_total, bonus_pool and bonus_earned, never `left`, so a new month, a
  game played, a refund, a gift or a plan ending raise nothing. Nothing on
  the first state ever seen, nothing across a sign out and in as someone
  else. What it raises waits in the store (`gamesToastPending`), so a
  restart mid match keeps it. `normalizeState` keeps the server's `source`
  for it (no server change).
- **The 8.9.0 upgrade, once.** Free went 2 to 4 games by a server migration
  on 2026-11-09 and a player updating from 8.9.0 has no state kept: on the
  first state ever seen, a free account with `free_total` exactly 4 or 6,
  signed in or holding a key before this launch, whose version before this
  launch (`changelogSeenVersion`, read at load before the changelog writes
  this one; onboarded with none counts as old) is below 8.9.1, is told "You
  got 2 games, Free is now N games". Decided once (`gamesRaiseChecked`).
- **The surface (8.10.4: a centred reveal, once a card at the top right)** is
  a see-through `WebContentsView` of its own, made the account menu's way
  (`main-window.js toast`, `src/renderer/toast`, `toast-preload.js`), over the
  WHOLE window (`toastBounds`: 0, 0, the content size), over every page and
  under the open menu; the page keeps its bounds. One at a time from main's
  queue, and the view takes the keyboard while it is up (Esc and Enter close
  it, the keyboard goes back to the page after). A flat scrim (`--bg` at 90%,
  no blur, no gradient) and, centred, the picture, the number and one line:
  `words()` carries `look` ('gift' for a gift of a plan, an invite, games
  bought and the free raise, 'plan' for a plan bought or moved up), `big` (the
  number counted up), `unit` ("games", or "games a month" for a plan), `rline`
  and `tier` (Max's ring and number are `--warn`, everything else `--good`).
  pre, n, post and line stay for the old checks. The gift: it drops in (spring),
  shakes (220 ms), the lid pops and rests ajar, a ring pulses out, 22 flat
  pieces burst, the number rises out of the box and counts to its value
  ("+4 games"), then the unit, the line and the buttons, 80 to 140 ms apart. The
  plan: a ring draws itself, the crescent (the logo's own path) turns in, a
  ring pulses, the number counts ("25 games a month"). Every step is a delay
  on its own CSS animation (toast.css lists the timeline); the page counts the
  number and makes the pieces. Continue, Esc, a click on the scrim or 10 s
  say `TOAST_ACT { done }`; See my games says `{ open }`, which opens Profile
  through index.js. Motion is transform, opacity and one stroke draw, flat
  colours only (no glow, no gradient). Reduced motion: it fades, nothing moves,
  draws, bursts or counts. The class is `.rv-root`, not `.reveal`, which is
  ui.css's accordion. Designed after the Figma limit was hit (see the
  `design-in-figma` note); `scripts/shot-reveal.js` writes `reveal-sheet.png`
  with both looks at six moments each.
- **Never mid match** (screen-silence.md): index.js takes nothing off the
  waiting list while a match is in progress or the window is sealed
  (`flushGamesToasts`, flushed from `flushAccountWaits`, so from `syncSeal`
  and a stop), and the view holds any it is handed while sealed, hidden or
  minimised; one on screen as the seal comes on goes in the same tick and
  waits at the front.
- Tests: `test:gamestoast` (each reason, monthly reset, first sign in,
  account switch, held, restart, the upgrade once), `test:shellnav` (the
  view, its queue, the seal, hidden and minimised), `check:seal` (held mid
  match through the real app, shown and drawn once it ends),
  `check:mainwindow` (over Home, words and bounds; `OCCLARA_SHOTS=1` writes
  `main-home-toast.png`).
- Open: a gift the player redeemed in the app's own Profile is toasted too
  (the Profile line already says it); `free_total` going 4 to 6 cannot tell
  the raise from an invite redeemed as the friend, so both say "Free is now
  6 games".
