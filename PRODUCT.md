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
- **After the match:** the review opens, with Home, Matches, Patterns, Breakdown, Stats, Ask Coach, Invite and Settings around it.
- **Separate windows:** Sign in (activation), onboarding, splash, the dock, the clip player, the AI log viewer and the Verdict share image.
- **Accounts (8.7):** Free, Pro and Max, with a monthly game cap and referral invites.

## Capabilities and Constraints
- Nothing may show, animate or play during a match; the seal (`syncSeal`) locks every page. Reveal motion and sound run only after the review opens.
- No framework, bundler or webfont URL. Fonts must be bundled locally because the renderer CSP forbids URLs.
- No em or en dashes in any copy.
- Copy must never show another player's Riot ID. One game's data is never shown under another game's name.
- `check:palette`, `check:dom`, `test:surfaces`, `check:mainwindow` and `check:seal` hold the UI's rules and must keep passing; when a rule is changed on purpose, the test changes with it.

## Brand Commitments
- **Name:** Occlara. The crescent is the mark today, and the owner has said nothing is sacred.
- **Owner's direction for the 8.7 redesign:** dark ground; simple and calm while keeping all the information; Linear-quality precision and high-quality motion; a unique look, not "vibe coded".
- **The owner rejects:** boxes nested in boxes, walls of small grey text, and glows or gradients.

## Evidence on Hand
- Real screens from the current build are in `dist-surface-shots/` (`OCCLARA_SHOTS=1 npm run check:mainwindow`, `npx electron scripts/shot-surface.js <surface>`).
- Seeded reviews live in `scripts/check-main-window.js`.
- There are no testimonials, user counts or benchmarks, and none may be invented.

## Product Principles
1. Silence during play is the product. A design that could show or play anything mid match is wrong, however good it looks.
2. Each review leads with one thing to do next match; all the detail stays available, folded below it.
3. Facts over adjectives. Show numbers from the record, never praise without a source.
4. Calm between matches. The player has minutes, so the essential reads at a glance.

## Accessibility & Inclusion
Text keeps at least 4.5:1 contrast on its ground. Every motion has a `prefers-reduced-motion` path. Everything works from the keyboard, with a visible focus ring.
