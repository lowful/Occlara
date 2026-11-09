# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

(An Electron desktop app for Windows. Every surface is plain HTML, CSS and JS in Chromium, with no framework and no build step.)

## Users
Players of Valorant and League of Legends who want to improve. They open Occlara at their gaming PC, often in a dim room. They use it in two moments: they press Start before a match, then read the review when the match ends, usually in the few minutes before the next queue. Some come back later to look over their match library and the patterns that keep repeating.

## Product Purpose
Occlara is a post-match AI coach. It reads the game while it is played and shows nothing during the match. When the match ends it opens a graded review: a score out of 100 with four categories and their evidence, the player's repeated mistakes with a fix for each, what went well, and what was missed. Success means the player leaves each review knowing the one thing to do differently next match, and sees that mistake shrink over time.

## Positioning
- The client never reads game memory, never touches game files and never automates input; it captures the display the way OBS does.
- Nothing reaches the screen during a match, in any game. That keeps it within Riot's policy, where live tips have cost players bans.
- The review is checked against Riot's own match record, so the grade rests on facts rather than impressions.

## Operating Context
- **Before a match:** Home and the Start button.
- **During a match:** a sealed Recording screen only. Every page is locked, and no notice or sound mentions the match.
- **After the match:** the review opens, with Home, Matches, Patterns, Moments, Stats, Ask Coach, Invite and Settings around it.
- **Separate windows:** Sign in (activation), onboarding, splash, the dock, the clip player, the AI log viewer and the Verdict share image.
- **Accounts (8.7):** Free, Pro and Max, with a monthly game cap and referral invites.

## Capabilities and Constraints
- Nothing may show, animate or play during a match; the seal (`syncSeal`) locks every page. Reveal motion and sound run only after the review opens.
- No framework, bundler or webfont URL. Fonts must be bundled locally because the renderer CSP forbids URLs: Geist and Geist Mono, and no other face.
- The coach's pen (`shared/marks.js`) draws only on the review's reveal or a page's first paint after a match, never while coaching and never under reduced motion; `test:marks` holds it there.
- No em or en dashes in any copy.
- Copy must never show another player's Riot ID. One game's data is never shown under another game's name.
- `check:palette`, `check:dom`, `test:surfaces`, `check:mainwindow` and `check:seal` hold the UI's rules and must keep passing; when a rule is changed on purpose, the test changes with it.

## Brand Commitments
- **Name:** Occlara. The crescent is the mark today, and the owner has said nothing is sacred.
- **Owner's direction for 8.8, "the coach's notebook":** the app should look hand made rather than generated, mostly in its layout and in how information reaches the player. It should feel as if a coach marked up your match: warm and personal, on the same dark ground. Before anything is added, decide what it is for. "Fine" is the trap, because fine is easy now and says nothing about care.
- **The one thing only Occlara makes:** the coach's pen, hand drawn strokes (underline, circle, bracket, arrow, tick, strike) on the fix, the rounds that prove it, a best and a cleared habit. Use one to three on a screen, never on chrome.
- **One type family: Geist.** The app's look is bold, tight and confident (Geist 600 and 700 at -0.02 to -0.03em), and 8.8 keeps it, cleaner. There is no serif and no second display face: a new face looks random next to the system. The coach's voice is set apart by role: the fix line and hero lines are Geist 700 (`.t-fix`), the coach's read, round notes and Ask Coach's answers Geist 400 at 16 to 17px on a 1.55 line in the full ink (`.t-voice`), labels 500, titles 600, and Geist Mono 400 for round numbers, times and margin notes.
- **8.7's direction still holds where 8.8 does not change it:** simple and calm while keeping all the information, precise, high quality motion, and not "vibe coded". What 8.8 changes: the one capsule everywhere becomes three button ranks, the flat 500 and 600 weights become 400, 500 and 600 roles, and "hairline, grey label, rows" becomes a margin layout like a marked up match sheet.
- **The owner rejects:** boxes nested in boxes, walls of small grey text, glows or gradients, a handwriting font, centred template screens, and identical stat columns.

## Evidence on Hand
- Real screens from the current build are in `dist-surface-shots/` (`OCCLARA_SHOTS=1 npm run check:mainwindow`, `npx electron scripts/shot-surface.js <surface>`).
- The seeded reviews are the sample library in `scripts/fixtures/proof-reviews.js` (a Jett on Abyss, 13 : 11, a B of 71, three older matches rising to it), which `check:mainwindow` boots on and `npm run export:siteproof` pictures for the website (`scripts/export-site-proof.js`: the pages as WebP at 2x, the share image, and `proof.generated.json`, the display strings read off the real pages, labelled "Sample match").
- There are no testimonials, user counts or benchmarks, and none may be invented.

## Product Principles
1. Silence during play is the product. A design that could show or play anything mid match is wrong, however good it looks.
2. Each review leads with one thing to do next match; all the detail stays available, folded below it.
3. Facts over adjectives. Show numbers from the record, never praise without a source.
4. Calm between matches. The player has minutes, so the essential reads at a glance.
5. A hand, not a template. Every mark, margin note and line of the coach's voice is there because a coach would have put it there. If it could appear in any app, it does not belong.

## Accessibility & Inclusion
Text keeps at least 4.5:1 contrast on its ground, and UI parts and the pen's ink keep 3:1. Every motion has a `prefers-reduced-motion` path. Everything works from the keyboard, with a visible focus ring.
