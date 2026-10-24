# Lovable brief: the Occlara website, 8.6

Paste everything below the line into Lovable. It is the 8.6 spec's section on
the website, its rules and its copy word for word. It replaces the brief that
stood here before 8.6, which described the live tip era: an overlay, a tip
every few seconds, and a coach that spoke during the match. None of that is
the product, and pasted now it would bring the old copy back.

None of this repo's files go into the website repo except the export the
demos read (`proof.generated.json`, written by `node
scripts/export-site-proof.js` on the release commit). The site goes live
only after the 8.6.0 installer is published, because its window demos must
show a UI that exists.

---

## What Occlara is

Occlara is a post match AI coach for Valorant and League of Legends, on
Windows 10 and 11. It shows nothing about the match while you play, records
the match on your PC when the PC can record, and opens a review when the match
ends: a score out of 100 from four categories with their evidence, the
mistakes you keep making with one fix for each, what went well, and what was
missed, opening on its Verdict, the grade with one reason counted from the
match. In Valorant it reads your main display the way OBS captures it, up to
once a second, and checks each review against Riot's record of the match once
your Riot ID is connected. League of Legends is read from the game's own Live
Client Data on your PC, never from its screen. It never reads game memory,
never touches game files, and never automates input.

## Rules that keep the site true

- **No em dash and no en dash** anywhere in the copy. Use commas.
- **Nothing about the match while you play.** Never "overlay" except inside
  Riot's quoted sentence, and never "next round", "between rounds", "live
  tip", "every few seconds", "voice coach", "coaching tip", "real time
  coaching", "death log", "tip every" or "keep the panel". No hero of the
  product running over gameplay: it would depict an overlay. The hero shows
  the window after a match.
- **Two games**: Valorant and League of Legends. Never Marvel Rivals, any
  "rivals", NetEase or "three games".
- **Every claim is true of the build it ships beside**, with its condition
  stated where it is made (a Valorant grade needs the Riot ID connected; a clip
  needs a PC that can record). A clause that says a screen, the display,
  frames, stills, pixels or screenshots are read, seen or watched, or names
  OBS, names Valorant, never League.
- **Every string a demo shows from a real review comes from the export**, and
  every drawn stand in is labelled as one (the table below).
- **No other player's name or Riot ID anywhere**: agents and numbers only. The
  shared picture carries no Riot ID, the player's own included.
- **No "#1", "MOST POPULAR", testimonials or user counts**: no source backs
  them. No Discord button: no real server or invite exists. No public share
  link: a review never leaves the PC.
- **No decorative gradients.** The column grid is drawn as elements.
- **Fonts are Geist and Geist Mono** at the weights the Google Fonts link loads
  (400 to 800 of both), with `font-synthesis-weight: none` on `html`.
- **The signal is only** a live dot, an urgent dot, Start in the drawings of
  the app and a destructive action under the pointer. A loss, an error or a
  death is `--negative` (`--oc-bad`). The primary is the ink.

## How the site is built and checked

Separate private repo `lowful/ghostcoach-9a45ac05` (Vite, React, TypeScript, Tailwind, shadcn), synced both ways with Lovable from main. Work on one branch; **pushing main deploys production and needs the player's yes**. Lovable edits main too, so while the branch is open the player pauses edits in Lovable, or the lead rebases the branch on main just before merging and reruns every check. `npm ci` is broken: `npm install --no-audit --no-fund`, and never commit `package-lock.json`. After every `npm run build`, `git checkout -- supabase/functions/mcp/index.ts`. Then `npm test` and `npx tsc -p tsconfig.app.json --noEmit` (lint is not a gate). `public/riot.txt` stays whatever else in `public/` changes.

Gates kept green, changed only on purpose:
- `copy.test.ts`: no dash; no tip era words. In copy that means: never "overlay" except inside Riot's quoted sentence, never "next round", "between rounds", "live tip", "every few seconds", "voice coach", "coaching tip", "real time coaching", "death log", "tip every", "keep the panel".
- `two-games.test.tsx`: no Marvel, Rivals (any "rivals"), NetEase, "three games"; the pinned strings below are kept; every route is in `src/test/stubs/pages.tsx` `PAGES`; the og-image's sha256 is updated after the new card is looked at.
- `screen-copy.test.tsx`: a clause that says a screen, the display, frames, stills, pixels or screenshots are read, seen or watched, or names OBS, names Valorant (or sits in a block that names Valorant alone) and never League; on the legal pages, in the FAQ, in llms.txt and now on /manifesto, a clause with "Riot's record", "round by round" or "what it saw" names Valorant itself. Every line below was held to these rules when it was written; a line changed is held to them again by the site's own suite.
- `plan-price.test.tsx`, the edge billing, checkout and licence tests, `legal-copy.test.tsx`, `rendered-pages.test.tsx`, `account-page.test.tsx`.
- `lovable-memory.test.ts` (colours and pages) and `ProductProof.test.tsx` (H1, section order).
- New: `src/test/palette.test.ts` (the foundation, below) and `src/test/proof-export.test.tsx` (the demos, below).

## The foundation: fonts, tokens, colours, components, the mark


- **Fonts unchanged**: `index.html` keeps Geist and Geist Mono from Google Fonts at 400 to 800; Tailwind's `sans` and `display` stay Geist, `mono` Geist Mono; the memory's Font line and its test stay as they are. `html { font-synthesis-weight: none; }` is added.
- **Tokens** (`src/index.css` `:root`, integer HSL with the hex comment the memory test reads). Moved: `--background: 225 17% 5%; /* #0A0B0E */`, `--surface: 223 19% 7%; /* #0F1116 */`, `--surface-raised: 225 17% 9%; /* #14161C */`. New: `--signal: 9 100% 62%; /* #FF5A3C */`, `--signal-hover: 9 99% 64%; /* #FE6347 */`, `--negative: 355 74% 65%; /* #E8636F */`, `--paper: 223 19% 93%; /* #E9EBF0 */`. Gone: `--accent-solid` and `--accent-hover`. Kept as they are: `--foreground` (#F5F5F7), `--foreground-secondary` (#A1A1A6), `--foreground-muted` (#808086), `--positive`, `--warning`, the hairlines, `--border-strong`, `--ease-out` and `--ease` (the app's own curves). The bridge: `--primary: var(--foreground)`, `--primary-foreground: var(--background)`, `--destructive: var(--signal)`, `--destructive-foreground: var(--background)`, `--sidebar-primary: var(--foreground)`, `--sidebar-primary-foreground: var(--background)`, `--radius: 0.625rem`.
- **The `--oc-*` set keeps its names**, as the app keeps its own, and its values move: `--oc-bg #0A0B0E`, `--oc-bg2 #0F1116`, `--oc-side #0F1116` (the app's rail is `--bg-2`), `--oc-red #FF5A3C` (the signal, under its old name); `--oc-text`, `--oc-dim`, `--oc-mute`, `--oc-line`, `--oc-line-2`, `--oc-line-3`, `--oc-good`, `--oc-warn` unchanged. Added: `--oc-red-rgb: 255, 90, 60`, `--oc-bad: #E8636F`, `--oc-bad-rgb: 232, 99, 111`, `--oc-grid: rgba(255,255,255,0.045)`, `--oc-glass: rgba(13,14,16,0.72)`, `--oc-paper #E9EBF0`, `--oc-paper-ink #0A0B0E`, `--oc-paper-ink-2 #484A4E`, `--oc-paper-ink-3 #636568`, `--oc-paper-line rgba(10,11,14,0.14)`, `--oc-r-card 6px`, `--oc-r-control 10px`, `--oc-r-pill 999px`. None of the 150 uses of the existing names changes.
- **Every red sorted by its job**, as the app's 8.6 colour pass sorted its own:

| Rules in `src/index.css` | Becomes |
|---|---|
| `.ow-toggle` (the drawn Start) | `--oc-red` fill, `--oc-bg` label at 600, as the app's Start |
| `.ow-stop`, `.ow-rec.is-live` (its tint as `rgba(var(--oc-red-rgb), a)`), `.ow-rec-dot`, `.rec-dot.is-live` | stay the signal; the two dots lose `breathe` and sit still |
| `.oc-dot.is-bad`, `.oc-cause.is-bad`, `.oc-letter.is-bad`, `.gv-letter.is-bad`, `.gv-cat-score.is-bad`, `.gv-bar i.is-bad`, `.oc-rr.is-loss`, `.oc-trend.is-worse`, `.lg-died`, `.mk-died`, `.lh-row-main em.is-loss` | `--oc-bad`, tints `rgba(var(--oc-bad-rgb), a)` |
| `.rec-head-rail i` (the diagram's playhead, its glow gone), `.rec-clip i`, `.rec-clip b`, `.rec-stat-kept b`, `.md-tab-bar i, .ld-tab-bar i` | ink: none of them is live or a loss |
| `.sc-enemy i`, `.sc-foe i` and their `::before` (the stand in stills' drawn enemies) | `--oc-bad` tints: a drawn enemy, not the brand |
| `.plan.is-featured` | `--oc-line-3` border on `--oc-bg2`: the featured card is marked by its primary button |
| `.rd-check.is-checked .rd-cell.is-invented`, `.rd-check.is-fixed ...` | deleted with the invented death (the ReviewDemo, below) |
| `.hd-pupil` | deleted with the aperture |

- **The primary audit** (the bridge makes `primary` ink): in `index.css` and in Account, Success, Signup, ForgotPassword, ResetPassword, OAuthConsent and NotFound (its `Radar` icon is `text-primary`), an error or alert that used `text-primary` or a `primary` tint becomes `negative`; a decorative icon tint becomes `foreground-secondary`; a primary action stays `default` (ink); a destructive action is the `destructive` ghost.
- **`src/test/palette.test.ts`**, every rule asserted against a known positive and a known negative string inside it: no `#FF4655` and no `rgba(255, 70, 85` (any spacing) in `src/**/*.{css,ts,tsx}` or `supabase/functions/_shared/email-templates/theme.ts`; every `var(--name)` in `src/index.css` is defined there or set as a custom property in a TSX style object (today `--i`, `--w`, `--d`, `--k`, `--j`, `--rec-ms`, `--side`, `--size`, `--reach`, `--gv-delay`, `--rv-delay` are set inline, so the check reads both); every font family named is Geist, Geist Mono or a generic or system fallback, at a weight the Google Fonts URL loads; `font-synthesis-weight: none` on `html`; `--oc-red` and `--signal` only in the selectors of the table's signal rows, `.sig-dot` and the destructive hover.
- **Components** in `index.css`: `.oc-mono` (Geist Mono 500, 11px, 0.08em, uppercase), `.oc-eyebrow` with `.ix`, `.oc-display` (Geist 600, -0.02em, line-height 1), `.oc-vf` (the app's viewfinder), `.oc-kbd` and `.oc-keys`, `.oc-stats` (64px numbers here, 40px under 768px), `.oc-colgrid` (one layer behind the whole page: 12 columns from 1024px, 6 from 768, none under; the paper section covers it), `.oc-paper` (the inverted section), `.sig-dot`. shadcn `Button`: default ink, 44px at `lg`, `--radius`, Geist 500 15px, hover white; `outline` is the ghost (0.03 fill, the strong hairline); `destructive` is the ghost with the signal under the pointer. `Reveal`: opacity and 12px, 0.7s on `--ease-out`, 50ms apart, once, none under reduced motion. The nav pill takes `--oc-glass` after 40px of scroll.
- **The mark**: `Brand.tsx` exports `CrescentMark` (the path, `currentColor`) in place of `ApertureMark`, and every import moves to it (Navbar, Footer, auth and legal layouts, 404, Account, AppWindow, HeroDemo, CallToAction). The wordmark Geist 600, -0.02em.
- **Out of the CSS**: the aperture's rules and keyframes (`cta-ring`, `cta-pupil`, `hd-pupil`, `pupil`, `breathe`, and the reduced motion line naming them), the headline's word animation and odometer. The "Deliberately inert" comment says the column grid is the one decoration and is drawn as elements.
- **public**: `favicon.svg`, `favicon.ico`, `apple-touch-icon.png`, `icon-512.png` from `generate-icon.js --site`; `index.html` links the touch icon; the Organization JSON-LD logo is `https://occlara.app/icon-512.png`. `riot.txt`, `robots.txt`, `sitemap.xml` and `llms.txt` stay (the last two change with /manifesto).
- **og-image.jpg**: 1200x630 JPEG on #0A0B0E with the column grid; the lockup top left; "Silent while you play. Graded when it ends." Geist 600; `.oc-mono` "VALORANT · LEAGUE OF LEGENDS · WINDOWS 10 AND 11"; the Abyss Verdict card (dark, from the export) on the right. Rendered in Chromium, looked at, then its sha256 goes into `two-games.test.tsx`. `og:image:alt`: "Occlara, the post match coach for Valorant and League of Legends".
- **Head of the home page** (Index.tsx and index.html, three copies of the description as the test counts): title "Occlara | The post match coach for Valorant and League of Legends"; description "Occlara shows you nothing while you play, then reviews the match when it ends: what you keep doing wrong, what went well, and clips of your deaths. Valorant and League of Legends, for Windows."
- **`.lovable/memory/index.md`**: Colors (the moved and new lines in its format; `--accent-solid` and `--accent-hover` gone; then "Borders are a white hairline at 9% (--hairline), controls at 18% (--border-strong). --primary is the ink: buttons are ink on charcoal. The signal, --signal, is only for a live dot, an urgent dot, Start in the drawings of the app and a destructive action under the pointer. --negative is a loss, an error or a death. Paper is only for the During and after section. There is no cyan."); Font unchanged; Sections (the new order); Pages (adds /blog/how-to-review-valorant-matches and /manifesto).
- **Index.tsx**: Navbar, Hero, ProductProof, Proof, Games, Safety, Pricing, FAQ, CallToAction, Footer. ProductProof renders `<Verdict />` between its review and its round. `Verdict.tsx` and `Proof.tsx` are their own sections.
- **Dead files deleted** after checking nothing imports them: `src/assets/agents/*.asset.json`, `src/assets/ghostcoach-hero-screenshot.png.asset.json`, `src/assets/occlara-live-gameplay.png.asset.json`, `src/assets/ghostcoach-panel.png`, `src/assets/ghostcoach-screenshot.png`, `src/components/AgentPortrait.tsx`, `src/hooks/useCursorGlow.ts`, `src/hooks/useScrollReveal.ts`, `public/placeholder.svg`, `REVAMP_NOTES.md`. The CDN copies are the owner's to delete in Lovable.

## The homepage, top to bottom

Every section follows one grammar: eyebrow, a heading, a lead of about two lines, at most one call to act, then the artifact. Eyebrow indices count in page order.

**Navbar.** The crescent and "Occlara". Links: How it works (/#how-it-works), Review (/#review), Games (/#games), Pricing (/#pricing), Manifesto (/manifesto). Right: Log in (/signup?tab=login) and Get Occlara (/signup, primary); signed in, Account and Log out as today. The phone menu carries the same links.

**Hero.** Left column:
- Eyebrow: `[ 01 ]` POST MATCH COACH
- H1: **Silent while you play. Graded when it ends.**
- Lead: "Occlara follows your match in silence and shows you nothing until it is over. Then your review opens: a score out of 100, the mistakes you keep making, and clips of your deaths."
- Buttons: Create account (primary, /signup, keeps `btn-primary`), See pricing (ghost, #pricing).
- Meta, two lines as today: "Valorant, League of Legends" and "Windows 10 and 11, 3-day money-back guarantee".
- Note (13px, ink-3): "A Valorant grade needs your Riot ID connected and lands once Riot publishes the match, usually 1 to 4 minutes after it ends. A League of Legends review is whole when the game ends."

Right column: a 16:9 `.oc-vf` frame holding the HeroDemo (the demos, below). Under it, `.oc-mono`: "DEMO, DRAWN FROM THE APP'S OWN SCREENS. A REAL VALORANT MATCH ON ABYSS, CHECKED AGAINST RIOT'S RECORD."

Under both, the stat block:

| Number | Label | Note under it |
|---|---|---|
| 0 | TIPS, NUMBERS OR PAGES ABOUT THE MATCH WHILE YOU PLAY | During a match the window shows only a Recording screen, every page locked. |
| 15 s | CLIP, AT MOST, OF EACH DEATH THE COACH LOOKED AT | Cut from your own recording, 11 seconds before the death to 4 after, shorter when the death comes in a round's first seconds. Valorant, with recording on: a graphics card with a hardware H.264 encoder and 8 GB free. League of Legends keeps clips of up to six deaths. |
| 10 | PAST VALORANT MATCHES GRADED WHEN YOU CONNECT | Your last ten Valorant matches in Competitive, Unrated, Swiftplay or Premier, graded from Riot's record, so they have no clips. |

**How it works, `#how-it-works`.**
- Eyebrow `[ 02 ]` WHILE YOU PLAY. H2 **Press Start, then play.**
- Lead: "In Valorant, Occlara reads your screen the way OBS captures it, up to once a second. In League of Legends it reads the game's own live data. In both it records the match on your PC when your PC can record, and nothing about the match reaches your screen until it ends."
- Artifact: the RecordingDemo (the demos, below), its strings as today.
- Facts row: **Encoder**: "H.264 on your graphics card, at 720p or 1080p and about 30 frames a second." **If it lags**: "Recording stops for that session, and the coach keeps reading." **Privacy**: "The recording and its clips never leave your PC. In Valorant, the frames the coach reads, up to one a second, and a few stills of each death it looks at are sent to Occlara's server and its AI provider to be read; the server keeps none of them. No sound, no other monitors." **What stays**: "Clips of up to six deaths a match, each up to 15 seconds, under a space limit you set, 10 GB unless you change it."

**The review, `#review`.**
- Eyebrow `[ 03 ]` THE REVIEW. H2 **A grade you can check.**
- Lead: "A score out of 100 from four categories, each listing the facts it came from. Then the mistakes you keep making with one fix for each, what went well, and in Valorant every round, checked against Riot's record."
- Artifact: the ReviewDemo (the demos, below), opening on its Verdict.
- Caption: "A real Valorant match on Abyss, as Occlara 8.6 reviews it, checked against Riot's record: the screen read 22 deaths and Riot has 21."

**The verdict, `#verdict`.**
- Eyebrow `[ 04 ]` THE VERDICT. H2 **The grade, and the reason for it.**
- Lead: "Every graded review opens on its Verdict: the letter, the score out of 100 and one reason counted from the match, never written by the model. Share image saves it as a picture made on your PC, with no Riot ID on it."
- Three live HTML cards, 1.586:1, `.oc-vf`, the middle one turned 2 degrees, each with `.oc-mono` REAL MATCH under it, their values from the export (`proof/verdicts.ts` reads it). Today's values:
    1. SPLIT · 13-7 · WIN, **B 71**/100, "14 of your 16 deaths went untraded.", K/D/A 17/16/8, ACS 279, ADR 181, HS 22%, JETT · COMPETITIVE, 4 OCT 2026.
    2. ABYSS · 3-5 · LOSS, **S 97**/100, "First kill of the round 4 times.", K/D/A 11/5/2, ACS 417, ADR 285, HS 33%, JETT · SWIFTPLAY, 4 OCT 2026.
    3. FRACTURE · 5-1 · WIN, **A 84**/100, "First kill of the round 3 times.", K/D/A 12/3/2, ACS 569, ADR 320, HS 24%, JETT · SWIFTPLAY, 13 OCT 2026.
- Under the cards: "Real matches, real reviews, agents and numbers only. A loss graded S and a win graded B: the grade is how you played, not the scoreboard."
- Letters toned as in the app (S and A `--oc-good`, B ink, C `--oc-warn`, D `--oc-bad`), the number always beside them.

**One round, `#deaths`.**
- Eyebrow `[ 05 ]` ONE ROUND, TAKEN APART. H2 **Rewatch the moment. Then fix it.**
- Lead: "In Valorant, for the deaths worth learning from, the review cuts the seconds before and after out of your own recording, names the cause when its frames show it, and gives you the better play. A fair fight you lost is called a lost duel, not a mistake."
- Artifact: the RoundDemo (the demos, below), pinned while four steps scroll past, every string from the export:
    1. **Riot's facts.** "R2 · WON · DEFENCE" and "Died at A Main, 31s in, to Astra with a Sheriff · 5 against 1 when you died · Traded by a teammate · 3 kills · First kill of the round"
    2. **The moment.** Five stills under their labels, 3 S BEFORE, 1.5 S BEFORE, 0.7 S BEFORE, 0.3 S BEFORE, JUST AFTER, and the timeline as the clip player draws it: 15 s, the death 11 s in, in `--oc-bad`, the five stills marked where they were taken.
    3. **The cause.** The chip Repeek and "You stayed on the same A Main angle after trading shots and killing one enemy, then Astra killed you with a Sheriff."
    4. **The better play.** "After the first exchange, fall back behind cover instead of staying on the angle with 57 health."
- Then, "Also looked at in this match", each with its chip, what and Better as the review shows them: R5 Lost the duel, "You held an angle from cover on A Site, fired at the visible Jett, and lost the duel to her Sheriff." Better: "Keep using the wall for cover, but fall back after your first shots instead of staying on the angle." R6 Lost the duel, "You fought Chamber from B Tree with your Sheriff, fired three shots, and died without dealing damage." Better: "Take the next shot from cover instead of staying exposed in the duel."
- Caption: "Round 2 of a real Valorant match on Fracture, word for word as its review shows it. The stills are drawn stand ins for the ones cut from your own recording."

**The library, `#library`.**
- Eyebrow `[ 06 ]` THE LIBRARY. H2 **It remembers every match.**
- Lead: "Every review is kept. Occlara counts what repeats across your last ten matches, breaks your record down by map and agent, and keeps your Valorant rank and RR beside it."
- Artifact: the LibraryDemo, restyled. Caption: "An example library of ten matches, labelled as one. Its Abyss row is the real match above."

**Proof, `#proof`.**
- Eyebrow `[ 07 ]` PROOF. H2 **Four things you can check.**
- Lead: "Each is something the app does today, the first three drawn the way the app draws them."
- Four `.oc-vf` cards:
    1. **Nothing on screen until it ends.** "During a match the window shows one screen, Recording, and locks every page. Ask Coach answers nothing and an update waits until you are done." Drawing: the rail with its locks, the crescent, the still dot and "Recording".
    2. **Checked against Riot's record.** "On a real Valorant match the screen read 22 deaths and Riot has 21. The extra one, in round 17, was dropped." Drawing: the export's 24 round strip, round 17 as the app draws it, a won round with no death mark, and the verification sentence under it word for word.
    3. **It says when it cannot tell.** "When the coach's frames missed the fight, its look says Frame unclear and names no cause and no better play. A fight you lost fairly is Lost the duel, not a mistake." Drawing: two rows from the export as the review draws them, 610vb4 round 4 (its facts, the Frame unclear chip, its Coach's read) and Fracture round 5 (the Lost the duel chip, its what and Better).
    4. **The recording stays on your PC.** "Written to your PC a minute at a time while you play and deleted once the review is built, apart from clips of up to six deaths, each up to 15 seconds. In Valorant, the frames the coach reads, up to one a second, and a few stills of each death it looks at are sent to Occlara's server to be read; the server keeps none of them." Drawing: the minute pages, four kept clips, the rest struck, labelled `.oc-mono` DIAGRAM.

**Games, `#games`.** Hairline rows, each still an `article` with its `h3`.
- Eyebrow `[ 08 ]` TWO GAMES. H2 **Two games. Graded after every match.** Lead: "One license covers both, and each is graded on what that game can honestly show." (both pinned; the pin's spelling moves with it, see Other pages)
- **Valorant**, tag Recorded and clipped: "Occlara reads Valorant off your main display the way OBS captures it, up to once a second, and checks each review against Riot's record of the match once your Riot ID is connected. The review goes round by round, with a clip of each death the coach looked at, and Stats keeps your rank journey." Graded on Survival, Impact, Teamplay, Decisions.
- **League of Legends**, tag Recorded and clipped: "Read from the game's own Live Client Data on your PC. Its screen is never read, only recorded for the clips. Every death is listed by the game clock, with clips of up to six of them. Supports are not graded on Farming, and Stats is for Valorant only." Graded on Farming, Survival, Vision, Objectives.

**During and after, `#safety`, the one section on paper.**
- Eyebrow `[ 09 ]` DURING AND AFTER. H2 **It stays outside the game.**
- Lead: "Riot's developer policy separates help that changes how you play right now from coaching that works “upon reflection, learning and coaching the player game over game”. Occlara is built entirely on the second half of that sentence."
- Table:

| | During the match | After the match |
|---|---|---|
| On your screen | Recording, with every page locked | Your review, the moment it is ready |
| Ask Coach | Answers nothing | Answers about the match you pick |
| Your recording | Written to your PC a minute at a time | Cut to clips of up to six of your deaths, the rest deleted |
| An update | Waits | Asks to restart |
| Your mouse and keys | Never touched | Never touched |

- The four Never rows as today: **Reads game memory** ("In Valorant it captures your display, the way OBS does when you stream. In League of Legends it reads the game's own Live Client Data on your PC, never its screen."), **Touches game files** ("Nothing injected, patched or hooked. No driver, no kernel component."), **Sends an input** ("It cannot move your crosshair or press a key. Every shot is yours."), **Coaches you mid match** ("No tip, no number, no page about the match until it is over.").
- Links: How Occlara plays fair (/fair-play), Read the manifesto (/manifesto).
- On paper: no status colours (they fail there); ink, `--oc-paper-ink-2` and `-3`, `--oc-paper-line`.

**Pricing, `#pricing`.**
- Eyebrow `[ 10 ]` PRICING. H2 **Pick how long you want it.** Lead: "Every plan unlocks everything in both games. Start weekly to try it in your next session, go monthly to keep it going, or go yearly for the lowest price a month."
- Cards (PlanPrice and the renewal sentence untouched; MOST POPULAR goes; Monthly stays the featured card with the primary button):
    - **Weekly, $10 per week.** "Try it for a ranked push, with a 3-day money-back guarantee". Every feature for Valorant and League of Legends · A graded review after each match you play with Occlara on, Valorant with your Riot ID connected · Clips of your deaths, kept on your PC, when your PC can record · Cancel any time, no questions asked · 3-day money-back guarantee. Button Start weekly.
    - **Monthly, $29.99 per month.** "For regular players, billed every month". Everything in Weekly · Cheaper than four weeks of Weekly · Cancel any time, keep access through the period · 3-day money-back guarantee. Button Start monthly.
    - **Yearly, $249.99 per year.** "Billed once a year, the lowest price a month at $20.83". Every feature for Valorant and League of Legends · A graded review after each match you play with Occlara on, Valorant with your Riot ID connected · Clips of your deaths, kept on your PC, when your PC can record · Renews every 12 months, cancel any time before it does · 3-day money-back guarantee, on a renewal too. Button Start yearly.
- Under them: "One license covers Valorant and League of Legends on one PC at a time. Payments are handled by Stripe." (pinned, spelling moved with it) and "Every plan has a 3-day money-back guarantee. Questions? Email support@occlara.app."

**FAQ, `#faq`, `src/data/faq.ts`, also the JSON-LD.**
- Eyebrow `[ 11 ]` FAQ. H2 **The questions worth answering.** Lead: "Anything else, ask support@occlara.app."
1. **What does Occlara grade?** "With your Riot ID connected, a Valorant match gets a score out of 100 and a letter once Riot's record of it is found. The score is built from four categories: Survival, Impact, Teamplay and Decisions. Each category lists the facts it came from, so you can see what moved it. The review then lists the mistakes you keep making with a fix for each, what went well, and what you missed. A Valorant match Riot's record never links to, such as one played on another account than the Riot ID in Settings, is reviewed from the screen alone. From the screen alone, a Valorant review counts your deaths and shows what would grade it. League of Legends games are graded on categories of their own."
2. **When does the review open?** "A League of Legends review opens the moment the game ends. With your Riot ID connected, a Valorant review opens when the match ends and shows its steps while it waits for Riot's record of the Valorant match, usually 1 to 4 minutes. If Riot is late, the review from the screen is shown at six minutes and fills in when the record lands."
3. **Does it show anything while I play?** (today's answer)
4. **Will recording slow my game down?** (today's answer)
5. **Where does the recording go?** (today's answer)
6. **What is sent to Occlara?** "In Valorant, the frames the coach reads, up to one a second, and a few stills of each death it looks at go to Occlara's server and its AI provider to be read, and the server keeps none of them. Anything on your main display while a Valorant session runs can be in those frames. Each request asks for providers that neither keep it nor train on it; when no provider of the model offers that, the request is sent once more without that ask, so the review still comes. The server also gets each Valorant match's facts, to write its review, and your Riot ID, to fetch Riot's record of it. Ask Coach sends the match you ask about as its review keeps it, a line for each of your eight newest other matches and your question, with agents and numbers and no player's name; asking about a frame of a Valorant session in the AI log sends that frame. In League of Legends no frame is sent: the game is read from its own Live Client Data on your PC. After a session the app sends a few numbers about how recording coped, never what was on screen. Your reviews, your clips and the log of your recent sessions are stored on your PC."
7. **How does it know what really happened?** "Once your Riot ID is connected, each Valorant review is checked against Riot's own record of the match. Deaths, killers, weapons, timing and round results come from Riot, and the screen adds where you died and what the coach saw. Reads Riot contradicts are hidden, and the review says what the check changed: on one real Valorant match the screen read 22 deaths, Riot had 21, and the extra one was dropped."
8. **Can I share a review?** "Yes. Share image in a review draws its Verdict on your PC: the grade, its one reason, up to four numbers from the match, what you played and the date, and no Riot ID, yours included. Save it as a PNG or copy it. Nothing is uploaded, and there is no public link."
9. **Can it get my account banned?**, 10. **What do I need to run it?**, 11. **Why does Windows warn about an unknown publisher?**, 12. **Can I cancel, and can I get a refund?** (today's answers).
The file's header comment says the answers are true of Occlara 8.6.0.

**Closing.** The crescent, still, 72px. H2 **Your next match, graded.** Lead "Press Start, play, and read the review when it ends." Download for Windows (primary, `DOWNLOAD_URL`) and See pricing (ghost). "Windows 10 and 11 · 3-day money-back guarantee".

**Footer.** The brand line as today (pinned): "The post match coach for Valorant and League of Legends. In Valorant it captures the display the way OBS does; in League it reads the game's own live data. It never reads game memory, never touches game files, and never automates input." Columns: **Product** (How it works, The review, The verdict, Pricing, FAQ, Download for Windows); **Read** (Manifesto, Is Valorant coaching worth it?, How to review a Valorant match); **Legal**, renamed from Company (Privacy, Terms, Refunds, Fair play, Legal, support@occlara.app). Riot's notice word for word.

## /manifesto


H1: **Coaching belongs after the match.**

- `[ 01 ]` **Nothing while you play.** "Riot's developer policy for Valorant does not approve “in-game apps and overlays that include any real-time data that would improve a player's performance immediately by altering player behavior (i.e. 'go here now'), vs altering it upon reflection, learning and coaching the player game over game”. Occlara is built on the second half of that sentence. During a match its window shows one screen, Recording, and locks every page. Ask Coach answers nothing, the shortcut to your last review does nothing, and an update waits until you are done. League of Legends is held to the same rule."
- `[ 02 ]` **Code checks the model.** "In Valorant, the coach reads your screen with a model, and a model can be wrong. So the app checks the model with rules written for failures we reproduced: which map it is on, whether the scoreboard still adds up, whether a health bar says you are still alive, whether you are spectating a teammate. When code and the model disagree, code wins."
- `[ 03 ]` **Riot's record has the last word.** "With your Riot ID connected, every Valorant review is checked against Riot's record of the match. Deaths, killers, weapons, timing and round results come from Riot. Reads Riot contradicts are hidden, and the review says what the check changed."
- `[ 04 ]` **It says when it cannot tell.** "When the frames the coach had missed the fight, its look says Frame unclear and names no cause and no better play. In a Valorant review, where you died is read off the screen, not taken from Riot's record, and the review says so."
- `[ 05 ]` **A fair fight is not a mistake.** "When the coach looks at a death and finds a fair fight you lost, it calls it Lost the duel, and it does not count against you as a mistake."
- `[ 06 ]` **The reason is counted.** "The one reason under a Verdict is counted from the match, never written by the model. If nothing can be counted, the Verdict has no reason rather than an invented one."
- `[ 07 ]` **Your recording stays yours.** "When your PC can record, the match is recorded on it and deleted once the review is built, apart from clips of up to six deaths, under a space limit you set. The clips never leave your PC. In Valorant, the frames the coach reads, up to one a second, and a few stills of each death it looks at are sent to Occlara's server to be read, and the server keeps none of them."
- `[ 08 ]` **No one else's name.** "A review names agents, never players. The agent who killed you is named, never the player; your team is agents and numbers; and the picture you share carries no Riot ID, yours included."
- `[ 09 ]` **It never touches the game.** "No game memory, no game files, no input. In Valorant it captures your display the way OBS does; in League of Legends it reads the game's own Live Client Data."

## Other pages

- **Fair play**, the During list's recording item: "Records the match on your own PC when recording is on, so your review can play back the moments it looked at. The recording and its clips never leave your PC; in Valorant, the frames the coach reads, up to one a second, and a few stills of each death the coach looks at are sent to Occlara's server to be read." The After list keeps its two pinned game lines.
- **Privacy**, three paragraphs added in its own voice:
    - "Ask Coach. When you ask Ask Coach about a match, the app sends that match as its review keeps it (its round facts with agents and weapons, the grade and its evidence, the lists, the patterns and the breakdown rows for its map and agent), a line for each of your eight newest other matches, and your question, to Occlara's server and its AI provider to write the answer. No player's name is sent. Asking about a frame of a Valorant session in the AI log sends that frame and, for a round Riot's record covers in Valorant, its facts."
    - "AI providers. Every request to the AI provider asks for providers that neither keep it nor train on it. When none of the model's providers offers that, the request is sent once more without that preference, so the review still arrives. Occlara's server keeps no frame and no still."
    - "This website. occlara.app loads DataFast's analytics and PromoteKit's referral script, and Lovable, which hosts the site, adds its own page analytics. PromoteKit may set a cookie to credit a referral."
    - The owner's TO COMPLETE gaps (seller name and address, legal bases, retention periods, EU and UK representative) stay for the owner; nothing invents them.
- **Sign up**: the panel line "Your account holds your license and your devices. Your reviews and clips are kept on your PC."; benefits "License activation and device controls", "A graded review after each match you play with Occlara on, Valorant with your Riot ID connected", "Valorant stats once your Riot ID is connected"; on the Log in tab "By logging in, you agree to the Terms of Service and Privacy Policy."
- **One spelling, the app's**: visible copy says "license", as the app ("License key", "Enter your license key.") and the Account page's pinned lines ("Your license has expired.") already do. The three visible "licence" (the Games lead, the pricing line, the sign up panel line) move with their two pins in `two-games.test.tsx`; identifiers and comments are left alone.
- **The emails**: `theme.ts` takes the new grounds (page #0A0B0E, card #0F1116, raised #14161C) and a 6px card radius; Geist stays; there is no mark or red in them. Deploying the edge functions that send them is the owner's.
- **Guide 1** ("Is Valorant Coaching Worth It?"), line 72: "In Valorant, Occlara watches the visible match through screen capture, the same way OBS does. It reads the screen up to once a second, shows you nothing while you play, and turns what it read into a round by round review when the match ends, graded once your Riot ID is connected, with a clip of each death it looked at." Its closing line: "In Valorant, Occlara records your match in silence and opens a round by round review when it ends, graded once your Riot ID is connected. 3-day money-back guarantee."
- **Guide 2** ("How to Review a Valorant Match and Actually Improve"), line 74: "This is the part Occlara does for you. In Valorant, it watches your match silently through screen capture, shows nothing while you play, and opens your review when the match ends, graded once your Riot ID is connected, with a clip of each death it looked at, so you can see the moment instead of trying to remember it." Its closing line as guide 1's.
- Fixes found in the survey: /reset-password shows "This reset link has expired or was already used." with a link to /forgot-password when no session arrives within 10 seconds; at 320px the login, forgot password, reset password and OAuth consent pages (11px) and guide 1 (4px) stop scrolling sideways.

## The demos, and what is labelled

Every review string below is read from `src/components/proof/proof.generated.json`, the export the app writes (`node scripts/export-site-proof.js` in the app's repo, copied in), never typed. `data.ts` keeps only the example library and the diagram's numbers.

| Demo | What it is | Label |
|---|---|---|
| HeroDemo | The app's 8.6 window drawn in HTML: the crescent, the 2px marker, Start in the signal with its dark label, the Recording screen with its still dot and three fact rows, nothing breathing; then the seal lifting and the review opening on the export's Abyss Verdict (B 71, "20 of your 21 deaths went untraded.", K/D/A 31/21/4, ACS 382, ADR 243), its meta line "Jett · Abyss · Unrated · 24 rounds watched", its verification sentence, the four categories and the first mistake. It starts when it scrolls into view (a phone saw only its end) and keeps Replay | DEMO, DRAWN FROM THE APP'S OWN SCREENS |
| RecordingDemo | One minute pages, four clips kept at the export's picker rounds (2, 3, 10 and 19), the rest deleted; the example look sentences go | DIAGRAM |
| ReviewDemo | The export's Abyss review, every line word for word, opening on its Verdict; the round strip as the app draws it, round 17 a won round with no death mark, the verification sentence under it; each round a button, its facts in a live region. The screen count turning into Riot's and the invented death that is struck go: the app never draws a death it dropped | "A real Valorant match on Abyss, as Occlara 8.6 reviews it" |
| Verdict cards | The export's three saved reviews, agents and numbers only | REAL MATCH |
| RoundDemo (replaces MomentDemo) | Fracture rounds 2, 5 and 6 from the export word for word; five stills drawn with MomentDemo's greybox scene under their real labels; the timeline as the clip player draws it; sticky on desktop, a static stack of the four steps on phones and under reduced motion | STAND IN on each still, and the caption |
| LibraryDemo | The example library of ten, restyled; its Abyss row from the export | AN EXAMPLE LIBRARY |
| Proof drawings | 1 the Recording screen as the app draws it; 2 and 3 the export's strip and rows; 4 a diagram | DIAGRAM on 4 |

Footage, later and only with the owner's OK: the app's window after a match, recorded on our own PC, with the kill feed, the death screen, chat and any notification blurred; never gameplay with the app drawn over it; it replaces a drawn demo and says REAL FOOTAGE.

`ProductProof.test.tsx` follows: the H1 "Silent while you play. Graded when it ends.", Create account with `btn-primary`; the headings in order "Press Start, then play.", "A grade you can check.", "The grade, and the reason for it.", "Rewatch the moment. Then fix it.", "It remembers every match."; the recording strings; the round's tabs become the RoundDemo's steps. New `src/test/proof-export.test.tsx` renders the HeroDemo, the ReviewDemo, the RoundDemo, the three Verdict cards and Proof 2 and 3, and asserts that every string the export marks as shown is in the rendered text: the Verdicts, the meta line, the verification sentence, round 17 with no death mark, round 2's facts, five still labels, what and Better, rounds 5 and 6 with their Better lines, the unclear row with its Coach's read, and the picker's rounds 2, 3, 10 and 19.

## llms.txt

```
# Occlara

> Occlara is a post match AI coach for Valorant and League of Legends, on Windows 10 and 11. It shows nothing about the match while you play, records the match on your PC when the PC can record, and opens a review when the match ends.

In Valorant, Occlara reads your main display the way OBS captures it, up to once a second. With a Riot ID connected, a Valorant match gets a score out of 100 and a letter once Riot's record of it is found, usually 1 to 4 minutes after it ends. The score comes from four categories (Survival, Impact, Teamplay, Decisions), each listing the facts it came from, and each Valorant review is checked against Riot's record of the match. The review lists the mistakes you keep making with one fix for each, what went well and what you missed, and opens on its Verdict, the grade with one reason counted from the match, which can be saved or copied as a picture made on your PC with no Riot ID on it.

When the PC can record, the match is recorded on it with the graphics card's H.264 encoder and deleted once the review is built, apart from clips of up to six deaths, each up to 15 seconds. No recording or clip leaves the PC. In Valorant, the frames the coach reads, up to one a second, and a few stills of each death it looks at are sent to Occlara's server to be read, and the server keeps none of them. The library counts what repeats across your last ten matches, breaks your record down by map and agent, and shows your Valorant rank and RR.

League of Legends is graded from the game's own Live Client Data on your PC, never from its screen, with every death listed by the game clock and clips of up to six of them. Occlara never reads game memory, never touches game files, and never automates input.

## Pages

- [Home](/): What Occlara does, the review, the Verdict, recording, the library, pricing, and FAQ.
- [Manifesto](/manifesto): Why Occlara shows you nothing while you play, and what it promises about the review after.
- [Sign up](/signup): Create an Occlara account or log in.
- [Fair play](/fair-play): How Occlara reads matches silently and reviews them after they end.
- [Privacy Policy](/privacy): How data is handled, and what stays on your PC.
- [Terms of Service](/terms): Rules for using Occlara.
- [Refund Policy](/refund): 3-day money-back guarantee terms.

## Guides

- [Is Valorant Coaching Worth It?](/blog/is-valorant-coaching-worth-it): Why evidence and honesty matter more than the volume of advice.
- [How to Review a Valorant Match and Actually Improve](/blog/how-to-review-valorant-matches): A way to review your own matches that finds the habit, not the highlight.
```
