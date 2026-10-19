# The grade, the lists under it, and the breakdown

Moved out of CLAUDE.md word for word, nothing reworded or dropped (CLAUDE.md as of commit cc1f880, 8.5.0, lines 1101 to 1168 and 1360 to 1394). Sections here: "The grade, and the lists under it", "The breakdown". It is a part of the section "Nothing reaches the screen during a match, in any game". "Above" and "below" in the text name sections that may now sit in another file under docs/claude/: grep the section's title there to find it. The table in CLAUDE.md says which file to read for which work.

### The grade, and the lists under it

`src/shared/grade.js`, pure, one grader per game. **Every category carries the
facts it came from**, so a player who disagrees can see which fact they
disagree with. The model never writes a number a player is judged by; the one
model judgement that reaches a grade is the death cause label, and only in
Decisions.

- Valorant: Survival (deaths a round, first deaths beyond the role's share),
  Impact (combat score against the player's own role average once there are
  three matches, an absolute ladder until then; first kills; multi kill rounds),
  Teamplay (traded deaths, trades made, assists), Decisions (deaths with the
  team ahead and the round lost, ult held, avoidable causes; clutches won).
- League: Farming (not for supports), Survival, Vision, Objectives.
- **One category is not a grade.** From the screen alone Valorant can count
  deaths and nothing else, and that graded a 13 to 11 win at 45. An overall needs
  two categories carrying half the weight; below that it says what would grade it.
- **The Duelist curves are shifted**, because the entry dies more and is traded
  less by design: on the shared curves the real 31 kill Jett read as a player who
  could not stay alive. The lesson from the retired grade-blend.js stands: a real
  scoreboard outranks a count of mistakes, which is why Impact weighs most.
- **A short match is judged over twelve rounds** (8.5.0, the player's choice,
  `decisionsShare`). Decisions is a curve over the share of rounds flagged, so
  in a six round Swiftplay one label was a sixth of the match: it moved the
  player's Fracture and Pearl swiftplays 21 to 25 points in Decisions and 5 to
  6 overall, and six flawless rounds scored 96. A match under twelve rounds is
  filled up to twelve at the typical share, (flags + 0.12 x (12 - rounds)) /
  12, 0.12 being where the curve gives about 79, the median of the player's
  twelve saved Decisions grades. One label in six rounds moves it 13 points
  where it moved 25, both ways; Fracture as saved grades 63 and 87 A where it
  was saved at 50 and 84, with rounds 5 and 6 Repeeks 53 and 85 A, and Pearl
  92 and 71 B where it was 100 and 73, with rounds 1 and 5 avoidable 67 and 65
  C (`test:grade`, on both matches' facts). Twelve rounds and more are judged
  as they always were. Its evidence gains "judged as a short match, over 12
  rounds". A grade already saved is shown and counted as it was saved, never
  graded again; a review graded anew (Riot's record laid over it, at the
  match's end or by the late link's upgrade in place) is graded by this rule.

`src/shared/insights.js` makes the three lists from the same facts, each entry
with a floor, a stable `key` (the library counts by it, so renaming one orphans
every saved review that used it) and, for mistakes, a one line `fix`. A
cause's title is in the singular for one and the plural for two or more
(8.4.1, `death-causes.js causeTitle`): one look's miss read "Repeeks" beside
its round's "Repeek" chip, and a count across matches is always the plural
(`repeatTitle`). The trades line says its count first, "Twice you killed an
enemy right after they killed a teammate.", where 8.4.0's "You killed the
player who had just killed a teammate twice." read as the enemy killing
twice. A review saved before is shown in today's words, its facts and the
patterns included (`inTodaysWords`, `factsView`), never rewritten on disk.
`patterns.js` counts those keys across the last ten recorded reviews of a game
(one graded from Riot's record alone has a grade and no list to count, below);
**a pattern needs two matches**, and its trend compares the newer half of the
window with the older half ('rising', 'falling', 'steady'). **A cause's trend
is one prompt's** (8.5.0, `lookVariant`): variant b widened what a repeek is, so
counted across the two prompts a repeek would read as rising for its
definition's growth. A `cause:` key's halves are compared only across the
matches the newest look's prompt looked at (a look saved with no variant was a;
a match never looked at, or by both, is none's), with no trend before four of
them; its counts, in how many matches and how often, are every match's.

`npm run test:grade` covers the graders on the real fixture, the lists, the
frame picker, the store, the patterns and the weekly report, the short match
rule on the Fracture and Pearl swiftplays, repeek counted as one lesson and the
trend by prompt. `npm run
check:matches` boots the app with saved reviews, reads the library back from the
DOM, paints the breakdown, and clicks a row through to its review and its kept
frame, and its eye through to the AI log on that match.

### The breakdown

`src/shared/breakdown.js` cuts every saved review of a game by map and agent
(map and champion for League), cached in main until the next save. Counted,
never written, and every number carries its sample:

- Round numbers come only from Riot checked rounds (the screen files a result a
  round late often enough to fake a side win rate), death locations only from
  recorded rounds, the scoreboard only from matches that have one. K/D is total
  kills over total deaths; ACS, ADR and headshot % are weighted by rounds.
  K/D/A (Valorant) is an average match's kills, deaths and assists,
  over only the matches whose line read all three, and it sorts on their K/D.
  Pistol rounds are round 1 and the first round Riot's sides change, never
  overtime; the review's own halftime is used only when no side is known,
  because an 8.0.0 or 8.0.1 review carries the screen's guess at it.
- A rate under its floor (`FLOOR`) is shown as "3 of 7", never a percentage.
  A row against the rest needs three matches on each side.
- A headline (strongest or weakest map, best agent) needs three graded matches
  on the row, three outside it, six in all, and a gap of six points that is
  also one and a half standard errors. Otherwise the page says nothing stands
  out yet.
- **Cards saved before 8.0.3 have no structured fields**, so the breakdown and
  the late link read their facts back from the sentences `roundFacts()` writes.
  Change one of those sentences and `npm run test:breakdown` fails, which is
  the point: the two readings are held equal on the real match.
- Spike Rush, Replication, Escalation, customs and deathmatches are left out,
  and counted as left out. **League is one mode at a time, with no All**:
  Summoner's Rift, ARAM, Arena and Swiftplay are other maps or clocks, so a CS
  a minute across them is a number about nothing; the most played opens first.
- **A repeat across matches is the same thing each time.** "Dying at A Site"
  repeats only at A Site on the same map (the name exists on nearly every
  map) and "Skye kept winning" only against Skye (`insights.repeatTitle`, used
  by the patterns too). Otherwise the title is one that is true of every match
  it counts.
