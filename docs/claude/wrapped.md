# Occlara Wrapped

The owner's ask: "a yearly wrapped for occlara that tracks stuff and is
animated for the users, high quality, and plays by the end of the year". The
player's year as a short animated story, over the whole window, offered from
15 December to 31 January. He chose that Wrapped gets its own bold look: it is
the one surface allowed colour, gradients, looping motion and framed objects
(ui-rules-ipc.md, "Wrapped's own look"). The rest of the app stays as it is.

Nothing of it leaves the PC: no route, no upload, no AI call. Nothing of it
shows or plays during a match (screen-silence.md).

## The year record (the "tracks stuff")

The library keeps 300 reviews at most (`review-store.js MAX_REVIEWS`) and
trims the oldest, so a year was stored nowhere. `src/main/services/year-record.js`
keeps one compact row per reviewed match, a file a year, never trimmed:

```
userData/wrapped/<year>.json       { v, year, rows: { <review id>: row } }
userData/wrapped/<year>.json.bak   the last good copy before the newest write
userData/wrapped/<year>.json.corrupt-<time>   a file that could not be read, put aside
userData/wrapped/state.json        { v, backfilledAt, rows }: the one time fill
```

- **Written on every save of a review, by its id** (`review-store.js save`
  calls `recordYear`, `year.put`), so a late link, an upgraded review or a
  re-save replaces its row and never adds a second. A review re-dated into
  another year moves its row. A review that is no match to count (no result
  and no grade: a recording begun and abandoned) has no row, and a save that
  makes one so takes its old row.
- **The trim never touches a row.** `save()` pushes the oldest out through
  `trim(id)` (files only). **A removal on purpose does**: `remove(id)` with
  its index, which is the player deleting an imported recording, a match that
  resumed (`withdrawReview`), a stop folded into the whole match
  (`retireStopStubs`, `onValorantMatchEnded`'s prior) and a backfill taken
  back (`dropReview`). `remove(id, true)` is only `removeRetired`'s sweep of a
  retired game, which never had a row. There is no other delete of a review in
  the app (Matches' Delete is the import's).
- **Filled once** from every review on disk the first time this version runs
  (`yearRecord.backfill`, in `app.whenReady` after `putAway`), so 2026 is not
  empty, then marked done in `state.json`. Every launch after lays on rows the
  rank tiers the history has learned since (`fillRanks`).
- **A corrupt file never loses the year.** Every write goes through a temp
  file, flushed, then renamed, and the copy it replaces is kept as `.bak`
  first. A file is corrupt ONLY when it was read and is not JSON or not a
  year file: it is set aside (`.corrupt-<time>`, kept), every whole row still
  in it is salvaged row by row (`salvage`: a file cut inside its last row
  loses that row alone) and laid over its `.bak`, and the year written back.
  Both unreadable is an empty year, never a throw. A file of a newer schema is
  read for what it has and never written over. A row of a shape `rowOf` never
  writes is dropped on reading.
- **A file the disk will not hand over is NOT corrupt** (review 2): a
  scanner holding it for a moment (EBUSY, EPERM, EACCES, any read error but a
  missing file) is never set aside, renamed or written. Its `.bak` is served,
  the year is marked held and not cached, so the next read tries again, and a
  save or a removal made meanwhile waits in `pending` and is laid on the real
  file once it is read. The one time fill is not marked done while a year was
  held, so the next launch makes sure of it.
- **A row belongs to the file it is in.** Which local year a match falls in
  depends on the time zone it is read in (00:30 on 1 January in one zone is
  31 December in another), so reading never drops a row for its date, and the
  same match saved again stays in its file; the story places each row by the
  reader's own calendar (`story` filters by local year). A review re-dated
  moves its row, never drops it.
- **The row** (`src/shared/wrapped.js rowOf`, schema 1): id, at, game, source
  (`watched`, `riot`, `import`), result, mode, grade (score, letter,
  provisional), kills, deaths, assists, flags (the flag key's presses kept on
  the review); Valorant: map, agent, team and enemy score, rounds, ACS, ADR,
  headshot share, minutes and `minutesBy` (`ledger` from the ledger's start
  and end, `riot` from Riot's start to the match's end, `estimate` at 100
  seconds a round, labelled so on the slide), Riot rounds read, multi kills by
  size (2 to 5), clutches won and the biggest, first kills and first deaths
  (a round sat out is no first death), kills by gun (Riot's feed, guns the kit
  index names), the agents that killed the player (agents the game data knows,
  NEVER a name), the counted mistakes (key, count, and the list's own title only for keys
  whose title is fixed: `same-spot` and `same-killer` build theirs from the
  match, "Dying at <place>", "<agent> kept winning", so they keep key and count
  alone and the page names them by the general title (`MATCH_TEXT_KEYS`); none
  for a match graded from Riot's record alone), up to 12 highlights (round,
  kills, clutch, clip name), the clip names kept, the rank tier and RR when the
  rank history on disk knows the match (`rank-history.json`, which keeps only
  the last 20 rated games, so older ranks are only what an earlier save
  caught), Riot's start and match id. League: champion, role, CS, minutes from
  the game's own length, death clip names; never the summoner name.
  **A string with `#` or `@` in it is never kept**, so no Riot ID, the
  player's own included.
- **Counted from their own stores, not the record**: Trainer runs this year
  (the store's `trainer`, kept to the last 500 runs, so a heavy year is
  undercounted and the slide never claims more) and drills practised (the
  store's `practice` log, its last 400). Ask Coach keeps no store of the
  questions asked, so they are not counted rather than a new hook added.

## The story

`src/shared/wrapped.js story(rows, { year, has, extras })` is pure and
deterministic, and every number on every slide comes from it
(`test:wrapped` works each one out again on the sample year). **A slide whose
numbers cannot stand is left out**, and a small sample says so on the slide.
The slides as shipped, in order:

1. **open**: the year, huge; the crescent with the main agent's icon in its
   hollow; the matches this year.
2. **time**: matches reviewed, hours (with "about" and a line saying how many
   were timed by their rounds when any were), days played, the twelve months
   as bars with the busiest lit, the biggest day when it held two or more.
3. **mains**: the main agent (icon in its ring, matches, win rate from three
   decided matches), the three most played with bars, the main map with its
   splash behind the slide.
4. **grades**: needs 5 counted grades (`MIN_GRADED`; provisional grades never
   count). The climb is the first third of the counted grades against the
   last third, 4 a side at least (`CLIMB_MIN`), else the average; a line of
   monthly averages drawn on; the letters; the best month among months with 3
   grades (`MONTH_MIN`) when two such months exist. Under 12 graded it says
   the sample is small.
5. **best**: the highest counted grade, the newest of equals: the letter
   stamped, the score, map, agent, score line, K/D/A, the day, and its best
   highlight clip playing muted if the file is still on disk (the cap and Clear
   clips take clips; a missing file is no clip, checked as the story is built
   and again by the page's `error`), else the agent.
6. **highlights**: only with a 3K, 4K, ace or clutch won; the four counts, the
   2Ks in a line, how many matches Riot's rounds came from, and the year's best
   kept highlight clip (an ace before a 4K before a 3K before a clutch, the
   newest of equals).
7. **mistakes**: needs 10 recorded matches (`MIN_RECORDED`): the early half of
   the year's recorded matches against the late half. Beaten: in 3 or more and
   30% of early matches and down 20 points of share or more, the biggest drop.
   Still to beat: in 3 or more and 30% of late matches, the most. Counted in
   whole matches, never float shares (3 of 5 to 2 of 5 is 20 points). Titles are
   the general ones (`insights.repeatTitle`: "One enemy agent kept winning",
   never one match's agent).
8. **fights**: the gun with 10 kills or more, the agent that got the player
   most (5 times or more, an agent only), first kills and deaths over 40 Riot
   rounds or more, the longest run of wins (2 or more).
9. **title**: one of nine (`TITLES`), each scored as how far past its own bar
   the player is, the highest winning and the list's order breaking a tie:
   The Entry (first kills in 12% of 80+ rounds, more than first deaths), The
   Closer (3+ clutches won, one a fifth of matches), The Climber (grade up 6+),
   The Specialist (one agent in 60% of 10+), The Fragger (K/D 1.2+ over 10+),
   The Anchor (first to die in 8% or less of 80+ rounds), The Flex (6+ agents,
   none over 35%, 15+ matches), The Grinder (60 matches or 40 days), and The
   Student (always there: reviewed their matches), each shown with the two
   numbers that earned it (the Student's hours give way to days played when no
   match was timed: a 0 is never a figure, on the slide or the card).
10. **rank**: only with 2 or more rated matches whose tier is known: first,
    last, peak, a ladder of the divisions between, lit as climbed.
11. **lol**: League's own slide, named "League of Legends", only with 5 League
    matches: matches, hours, win rate, average grade (5 graded), the best
    game, the most played champion. League rows are never in a Valorant number
    and the reverse. A League only year opens on the champion and has only
    this slide and the card.
12. **summary**: the closing card, drawn on the PC (below), Save image, Copy
    image, Replay, Close. It does not move on by itself.

**The minimum is 5 reviewed matches of one game** (`MIN_MATCHES`): the least
that names a main agent, a time worth adding up and a best match worth
framing. Under it there is no story, the entry says "Your 2026 Wrapped needs 5
reviewed matches of one game. You have 3 so far.", no button, and it never
opens by itself.

## When it appears

- **The window**: year Y from 15 December Y 00:00 to 31 January Y+1 23:59,
  local time (`windowOf`, `yearOpenAt`). A match belongs to the local year it
  ended in.
- **Home** shows the invitation only inside the window (`#h-wrapped`, a strip
  in the app's own look under the title: the crescent, main's line, "Play your
  2026 Wrapped"); without enough matches, the line alone.
- **Profile** has "Your year" (`#pr-wrapped`) inside the window and after it
  for the latest year begun ("Play 2026 again"), but after its window only a
  year from 2026 (`FIRST_YEAR`, the first Wrapped) on, or one the player had
  open (the store's `wrappedSeen` and `wrappedAutoOpened`): a 2025 rebuilt from
  whatever reviews the cap left was never offered and is never offered now.
- **It opens by itself once, and only over Home.** `index.js onMainWindow`
  asks a beat (900 ms) after the window is shown, restored or focused, or a
  page comes on screen (`page`, from `main-window.js push`) (`wrappedSoon`,
  `wrapped-service.js maybeAuto`), and it opens only when: inside the window,
  enough matches, not opened by itself for that year before (the store's
  `wrappedAutoOpened`, written BEFORE it opens so a crash never doubles it),
  the app's surfaces up and onboarding done, the window visible, not minimised
  and focused, no match in progress, no seal, HOME the page asked for and
  settled on screen with nothing on its way, and no games reveal, account menu
  or Wrapped already up (`wrapped-service.js mayOpenNow`, the snapshot
  `index.js free` builds, held in `test:wrapped` condition by condition). Never
  over a review, the Trainer mid run, a clip in Moments, Settings or Profile on
  the way back from a checkout: it waits for the next time Home is shown, and
  Home's invitation covers everyone else. The app never starts hidden in the
  tray, so "shown" is a real show. Mid match it waits: the next show, focus or
  Home after the seal lifts opens it.
- **The dev switches**, a run from the repo only: `OCCLARA_DEV_WRAPPED=sample`
  opens it on a sample year built from the repo's fixtures
  (`scripts/fixtures/wrapped-sample.js`: the sample library's real Abyss
  match made a row by `rowOf`, varied by a seeded generator into 96 Valorant
  matches and 7 League games, labelled "Sample year" on every slide and the
  card); `OCCLARA_DEV_WRAPPED=open` opens it on the PC's own record any day;
  `OCCLARA_DEV_WRAPPED_NOW=<ms>` is the clock its calendar reads.

## The surface

**Its own view over the WHOLE window, the bar included** (`main-window.js
openWrapped`), the games toast's pattern rather than a page with `nav: false`:
a page sits under the 64 px bar and moves through the page motion, a view of
its own covers everything and is closed outright. Made fresh on each opening
and closed with its page on each closing (Escape, its X, Close, the seal), so
no story plays on in a view nobody sees; opaque, its own ground. Over every
page, under the games reveal and the account menu (`raiseMenu`). Refused while
sealed, hidden or minimised. **The seal closes it in the same tick it comes
on**: off the window, muted at once (`setAudioMuted`), its page closed, and
the keyboard given to NOTHING (`closeWrapped({ refocus: false })`: on Windows
focusing web contents raises its window, over the game; `check:seal` and
`test:shellnav` hold it). Hidden, minimised or out of focus (the window's
`blur`: the game in front on another monitor) it is told to pause, story and
sound (`PUSH_WRAPPED { pause }`), and the window's focus back resumes it
(`{ resume }`), which the page takes only when it was this that paused it,
never a pause the player chose. A games reveal over it gives the keyboard
back to Wrapped as it closes, not to the shell.

The page, `src/renderer/wrapped/`: `wrapped.js` (the slides, the controls),
`gl.js` (the ground), `sound.js` (the score), `card.js` (the closing card),
`wrapped.css`. Preload `wrapped-preload.js`: the story from main and the
pictures it names (agent icons, map splashes, gun icons, champion icons from
the bundled files, only for names the game data knows), close, pause. Every
string is set as text; a picture path and a clip URL are checked against their
shapes before use.

- **Controls**: a click on the right 72% or Space, Enter, Right, Page Down go
  on; a click on the left, Left, Page Up, Backspace go back; P or K pause, M
  mutes, R or Home replay, End the card, Escape closes; three buttons at the
  top right say the same (pause, mute, close), each with its key in its title
  and `aria-keyshortcuts`. A progress strip at the top, one segment a slide,
  whose fill (a Web Animation) moves the story on when it ends: 6 to 9 s a
  slide, the card never. Pausing pauses every animation, the clip, the ground
  and the sound. The window hidden, minimised or out of focus, or the document
  hidden, pauses it, and the focus back resumes it (above).
  The keyboard is the view's while it is up, and goes back to the page after.
- **Less motion** (`prefers-reduced-motion`): every slide arrives whole, no
  number counts, nothing loops, the ground is one still drawn again only when
  the colours change, a clip waits for a press, each slide stays half as long
  again.
- **The ground** (`gl.js`): plain WebGL 1, no library (the vendored three.js
  was not needed): a pass of domain warped noise mixing each slide's three
  colours, an aurora band and a vignette, plus up to 900 points of light
  flying at the viewer, added. Drawn at 62% of the window's pixels (at most
  1400 wide, the field is soft and upscales without a seam). **It holds its
  frame rate or steps down**, judged against the display's own cadence and
  never a fixed number of ms (`tooSlow`): frames being dropped (a second's mean
  over 1.35 times the usual interval, its 20th percentile, plus 2 ms), or the
  usual cadence itself under half the panel's rate (main sends `hz`,
  `screen.getDisplayMatching`) and under 29 a second. A 48 or 50 Hz panel or
  Chromium's 30 a second on battery runs every frame on time and keeps the
  ground; a steady cadence of 29 or more never steps down. Each step drops a level (46%, 520 points; 34%, 220; 26%, no points, 24 draws a
  second), and below the last the canvas goes and a CSS gradient ground shows;
  a lost context does the same. `__wrapped.state().gl` reports its frame
  times.
- **The score** (`sound.js`): original, made by Web Audio as it plays, no file
  and nobody's music: a pad of four chords (F major 9, A minor 7, C major 7, G
  six, eight seconds each, detuned saws through a low pass with a sub), a
  breath of filtered noise as a slide turns, a bell from the scale as a big
  number lands, a rising run for the title. Master at 0.2 through a
  compressor. It starts muted when Settings' Sounds is off (`WRAPPED_GET
  sounds`); the mute button is the player's either way.
- **The closing card** (`card.js`): 1080 by 1350, drawn on the PC like the
  Verdict's share image: the crescent from its path, the year, the title, the
  main agent's icon, up to six figures, "Reviewed and made on this PC" (or
  "A sample year"), occlara.app. No Riot ID, no name, nothing with `#`. Save
  hands the PNG to the browser as a download (Windows asks where); Copy puts it
  on the clipboard.

## The channels

`WRAPPED_GET` (the story, null mid match or sealed), `WRAPPED_ENTRY` (Home and
Profile's words, null mid match), `WRAPPED_OPEN` (`{ ok, year }` or `{ ok:
false, error: 'match' | 'thin' | 'window' }`), `WRAPPED_ACT` (the view's close,
taken from its own view only), `PUSH_WRAPPED` (pause, main to the view alone).
All through `safeHandle` in `register-ipc.js`.

## Tests and pictures

- `test:wrapped`: the row of the real Abyss match and what a row never keeps;
  the record (a save, the replace by id, the 300 trim keeping every row, a
  removal on purpose taking one, the one time fill, a corrupt file read from
  its backup, a newer schema left alone, tolerant reading); every slide's
  numbers on the sample year; the slides left out on thin data; each title;
  League kept apart; the calendar (14 and 15 December, 31 December and 1
  January, 31 January and 1 February, the year's turn) and the one time open;
  the service (nothing mid match, once, clips only on disk); since review 2:
  a file held by a scanner (EBUSY, EPERM, EACCES) served and never set aside
  or written over, the save that waited landing once it reads; rows salvaged
  from a file cut short; a row whose date is another year in this time zone
  kept through saves; no "Play 2025 again" for a year never offered; no 0
  figure; 3 of 5 to 2 of 5 beaten in whole matches; singular copy; the card
  loading every face it draws; match text titles never stored; `mayOpenNow`
  condition by condition; and `tooSlow` on 48, 50, 60 and 240 Hz panels, the
  30 a second battery cap, dropped frames and a slow cadence.
- `check:wrapped` boots the real app on the sample library with the sample
  year on 16 December: the auto open once over the whole window, the keys, no
  second auto open across hide, show, minimise and focus, Home's invitation
  and button, a match starting closing it in the seal's tick with every ask
  refused, Sounds off opening it muted, and reduced motion looping nothing;
  out of focus it pauses and the focus back resumes it; and a new year's auto
  open given over Settings waits, then opens once Home is shown.
- `check:seal` holds it closed and silent in the tick a match resumes and
  refused every way mid match, with no page or shell focused as it goes;
  `test:shellnav` holds the view on stand-ins
  (refused sealed, hidden, minimised; whole window; under the games reveal;
  paused when hidden or out of focus and resumed on focus; the keyboard back to
  it after a games reveal; closed by the seal, focusing nothing, and by its own
  view only).
- `check:palette` lets Wrapped's files (and no other) draw their own colours
  and gradients, and fails if its stylesheet's first line stops saying so; its
  self test runs the very rule on a gradient in Home's, ui.css and look-alike
  paths and fails if any of them passes.
- Pictures: `env -u ELECTRON_RUN_AS_NODE npx electron scripts/shot-wrapped.js
  --out <dir> --size 1200x780 [--frames] [--perf] [--reduced] [--real]`
  writes every slide of the sample year (`--real`: this PC's own record, or
  its library read only, never written; keep the pictures out of the repo),
  frames across the opening, the title and the highlights, and `perf.json`,
  the frame times on the heaviest slide.

## Open

- A year's ranks are only those the rank history knew when a review was saved
  or at a later launch: the history keeps the last 20 rated games, so a player
  who rarely opens the app between rated games has gaps, and the slide counts
  only the matches whose rank it knows.
- Trainer runs and drills are counted from stores that keep their last 500
  and 400 entries.
- Ask Coach questions are not counted: there is no store of them.
- The weekly report popup can open over the window: Wrapped then waits to
  open by itself (the window is not focused), or, already up, pauses until the
  window has the focus again.
- A steady GPU cadence of 29 frames a second or more is never stepped down,
  since it cannot be told from a display or battery cap without a GPU timer,
  which WebGL does not give a page.
