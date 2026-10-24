# The Verdict and its share image

New in 8.6.0. Sections here: "What the Verdict says", "Why the reason is counted", "The share image", "Tests and rerunning the values", "Traps". The site's export, `scripts/export-site-proof.js` with `test:siteproof`, is added in its own change, and that change adds its section here. The table in CLAUDE.md says which file to read for which work.

## What the Verdict says

`src/shared/verdict.js`, pure, no Electron and no DOM. `of(review)` takes a
review as the page is served it (`valorant-review.js served()`, or a League
review as `finishLolGame()` saves it) and gives the card at the top of a
graded review, labelled VERDICT, and the share image drawn from it:

```
{ game, title, right, letter, score, provisional, reason, stats, sub, at }
```

- `game` 'valorant' or 'lol', by the review's `kind`. A review of neither
  (a retired game's) has no Verdict, never another game's.
- `title` the map or the champion alone, for the image's file name.
- `right` Valorant: map, score, result ("Abyss · 13-11 · Win", Victory as
  Win, Defeat as Loss). League: champion and the game's length ("Ahri ·
  31:05") and no result, because League's review has none (`lol-review.js`
  `game`); one is added only by reader work on a League schema checked
  against a live patch.
- `letter`, `score`, `provisional` the grade's own (`grade.js`), never
  recomputed.
- `reason` the one counted reason, or null (below).
- `stats` [label, value] pairs. Valorant: K/D/A, ACS, ADR, HS. League: K/D/A,
  CS, CS at 10, Ward. A number the review does not have is left out, never
  shown as "--", so a card shows what it has: a review built from Riot's own
  line has no headshot share (the tracker has one, Riot's line has head, body
  and leg shots the review does not turn into one), and its Verdict has no HS.
- `sub` Valorant agent and mode, League role and mode.
- `at` the review's own timestamp, for the date on the image.

It is null while the review is still being built (`work` set), when the grade
has no score (a review too thin to grade says so in words instead), and when
the score has no letter beside it.

**No name.** The object has no field for a Riot ID or a summoner name, the
player's own included. League's `game.me` is never read. A string with a '#'
in it, the mark of a Riot ID, is left out wherever it came from (an agent, a
map, an entry's title), and the next counted line becomes the reason.

The review page gets it through `review-preload.js`, which requires
`../shared/verdict` and exposes `verdictOf(review)`, as `home-preload.js` does
for `home-model.js`. Home keeps its grade card and shows no Verdict.

## Why the reason is counted

A confident wrong sentence costs most after the match, when the player can
only check it against a half memory, so the reason is never the model's. It
is the review's own top entry, every number in it arithmetic (`insights.js`):

1. for an S or an A, the first strength;
2. otherwise the first mistake;
3. then Riot's first fact, for a match graded from Riot's record alone
   (`insights.asFacts`, in the order Riot's record is read: a neutral list,
   so a low grade can carry a fact such as "First kill of the round 4 times.");
4. then the first round pattern, cut to its first clause (`firstClause`,
   `CLAUSE_CUT`: ", in rounds 2", ", 4", ", more than", ", before" and ": "
   end the clause, "On attack, won 1 of 2 rounds" stays whole).

An entry the coach's look judged (`judged: true`, a death cause the model
labelled) is passed over wherever it ranks. The summary and the focus are
never read. With nothing counted there is no reason, never an invented one.

A Valorant entry speaks in a short line by its key (`LINES`: "20 of your 21
deaths went untraded.", "First kill of the round 3 times."), else its title
and how many rounds ("Dying at A Site, 4 rounds."). A League entry speaks in
its own counted detail ("4 of your 6 deaths happened with no ally dying
anywhere near.", "CS at 10:00: 52 this game, against your average of 61."),
never its bare title: "CS at 10:00." says nothing a player can check, and a
skill measured without its numbers gives no reason at all.

**The trade denominator is Riot's, under `riot`.** A round card carries its
trade as `riot.traded` (`valorant-review.js` cards), never on itself. Read off
the card, every death counted as unknown and the Abyss match said "20 of your
deaths went untraded." where Riot knows the trade of all 21.

The values the site shows, from the public fixture and the player's saved
reviews (spec 7.2, `test:verdict`):

| Review | Verdict |
|---|---|
| Abyss 13-11, the fixture linked as the app links it | B 71, "20 of your 21 deaths went untraded.", 31/21/4, ACS 382, ADR 243, no HS, Jett · Unrated |
| Fracture 5-1 (eq7o3v) | A 84, "First kill of the round 3 times.", 12/3/2, 569, 320, 24%, Jett · Swiftplay |
| Sunset 2-5 (l7eesy) | B 73, "4 of your 5 deaths went untraded.", 10/5/1, 406, 264, 25%, Jett · Swiftplay |
| Abyss 3-5 (610vb4) | S 97, "First kill of the round 4 times.", 11/5/2, 417, 285, 33%, Jett · Swiftplay |
| Split 13-7 (nut54a) | B 71, "14 of your 16 deaths went untraded.", 17/16/8, 279, 181, 22%, Jett · Competitive |
| Split, the saved 8.0.1 fixture | none (no grade); its reason would be "2 of your 7 deaths were at B Back." |

"Linked as the app links it" is `riotLook` and `buildValorantReview` in
`src/main/index.js`: `reconcile`, the context's agent from `riot.me`, `riotMe:
riot.me`, `queue: riot.queue`, `verification: describe(checks)`, the role from
that agent, `riotIdSet: true`, no tracker, no history, no narrative. Built the
way `test:grade` builds it (Riot's line cut to kills, deaths, assists and
score, no agent) the fixture prints no ADR and no agent, which is not how the
app links a match.

## The share image

`src/renderer/shared/verdict-card.js`, a plain script that sets
`window.VerdictCard`: `draw(v, { size, paper })` gives a canvas, `render()`
loads the faces first, `save()` and `copy()` resolve true or false and never
throw, `fileName(v)` and `dateLabel(at)` name and date it.

- **Three sizes**, each laid out in a reference box drawn at 2.5 times: the
  card 1586 by 1000 (1.586:1), the post 1080 by 1350 (4:5), Discord 1200 by
  628 (1.91:1, a link preview's shape, posted as an image). An unknown size
  is the card.
- **Paper by default**: `--paper` ground, every letter in `--paper-ink` (a
  grade's colours measure about 2.7:1 on paper, and the number beside it says
  the rest), text in `--paper-ink-2` and `-3`, brackets `--paper-ink-2`. Dark:
  `--bg`, the letter in its tone from `GradeView.gradeTone`, the one grade
  colour rule (S and A `--good`, B ink, C `--warn`, D `--bad`); without
  GradeView on the page the letter is ink, since the card keeps no letter
  table of its own.
- **What it draws and nothing else**: four corner brackets as lines; the
  crescent from its path, one scale on both axes so never stretched; VERDICT;
  the right line; the letter and the number out of 100, PROVISIONAL just
  above the number when the grade is; the reason in up to two lines (three on
  the post), cut with an ellipsis; the numbers, nulls left out with their
  labels; the sub line; "occlara.app" as typed; the date in mono ("4 OCT
  2026"), none when the Verdict has no `at`. A string with a '#' is not drawn.
- **Tokens off `:root` with getComputedStyle**, because a canvas cannot read
  `var()`: handed one as a fillStyle or a font it refuses it without a word and
  keeps the one before. `--font` and `--font-mono` give the families,
  `--track-label` and `--track-display` the tracking, and a token that is
  missing or still reads as a `var()` gives its fallback, the token's own
  value. Geist 600 and 500 and Geist Mono 500 only, loaded with
  `document.fonts.load` before drawing. No gradient, no pattern.
- **Save and Copy happen here, with no channel and no network.** Save hands
  the PNG to the browser as a download from a blob URL, named
  `occlara-verdict-<map or champion>-<score>-<yyyy-mm-dd>.png` (the day local),
  so Windows asks where to keep it; Copy writes an `image/png` ClipboardItem.
  Nothing is uploaded and no link is made (occlara.app/v/<id> is not built).
- In the review, Share image opens a sheet under the header with a live
  preview, Card, Post and Discord, Paper and Dark, Save image and Copy image,
  each saying Saved or Copied for 1.4 s or "Could not copy", and Esc closes
  the sheet.

Stats' old "Generate card" is retired by it: it printed the Riot ID, stretched
the mark, drew two gradients and passed `var()` to its canvas.

## Tests and rerunning the values

`npm run test:verdict` (`scripts/test-verdict.js`, offline, spends nothing):
the fixture built as the app links it and the 8.0.1 Split fixture with the
values above; `firstClause` on the nine pattern templates and the cut on a
known positive and negative; the reason's order, a judged entry passed over,
no summary or focus read; nulls left out; no name key and no '#' in any
Verdict, a planted Riot ID included; League's champion and length, no result
and no read of `game.me`. When this PC has the player's library it checks the
four saved reviews' values and every graded review's Verdict for a name, a
'#' or a word of the Riot ID in Settings; without it, it says so and skips
them. The card is drawn in all three sizes on both grounds on a stand in
canvas with the real theme tokens: the sizes, no gradient, no `var()` in any
fillStyle, strokeStyle or font, the faces and weights, every word drawn, the
letter's colour on each ground, the mark square, the ellipsis, the
fallbacks, the file name, Save and Copy. Every rule it pins was reverted once
and seen to fail.

Look at the images, not only the test: render each size on both grounds in
Chromium (an offscreen BrowserWindow loading a page that links `theme.css`,
`grade-view.js` and `verdict-card.js`, exporting `toDataURL`), with
`ELECTRON_RUN_AS_NODE` unset.

## Traps

- **A canvas ignores `var()` silently.** Every colour and font goes through
  `tok()`.
- **The renderer scans read comments too.** `test:surfaces` fails a renderer
  script that writes a letter table (`letter === 'S'`), and `check:palette`
  counts gradient calls by their text, so neither appears in the card even in
  a comment. The signal's tokens never appear in it: it has no use for them.
- **Measure without drawing.** A label is measured with no colour, which
  draws nothing; drawn off canvas to measure it, it would still be a draw.
- **The Discord reason takes two lines.** It has 224 of the 480 at 15px, and
  "20 of your 21 deaths went untraded." already wraps there, so the grade
  sits at 140, high enough that a second line clears the bottom row. Move the
  grade down and the second line runs into "occlara.app".
