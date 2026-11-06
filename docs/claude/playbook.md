# The Pro Playbook, and how to grow it

Moved out of CLAUDE.md word for word, nothing reworded or dropped (CLAUDE.md as of commit cc1f880, 8.5.0, lines 3274 to 3383). Sections here: "The Pro Playbook, and how to grow it", "Advanced coaching is a BIAS, never a replacement". "Above" and "below" in the text name sections that may now sit in another file under docs/claude/: grep the section's title there to find it. The table in CLAUDE.md says which file to read for which work.

## The Pro Playbook, and how to grow it

`server/services/knowledge.js` holds the playbook: tagged notes scored against
a situation by `retrieve()`, which returns **only eight**. The review draws on
it twice: `study()` picks the imported notes worth reading before the next
match, by the topic a pattern points to, and the round lines are written with
the retrieved notes in the prompt.

**And by the topic a death's cause points to** (8.5.0, `match-review.js
CAUSE_TOPICS`, for a client of 8.5.0 or later: the route sets `byCause` by the
version gate, and one before it is listed its notes as today, byte for byte).
A counted `cause:` mistake's topics weigh as a pattern's (+5), a single death
the coach looked at gives its cause's +2: dry-peek planning the peek, filling
utility and paint the picture; isolated checkpoints; repeek giving ground,
planning the peek and movement; crossfire planning the peek and paint the
picture; rotating its three rotation topics; overextend checkpoints and tempo;
exposed post plant and retake shape; and since 8.7.2 lost-duel the lost duel
checklist, the stop before the first shot and the peek method before aim
(it had no topics, so a match whose counted mistake was lost duels, the most
common one at Gold to Plat, was sent nothing to study). The summary and the focus already name
the first counted mistake, so the study notes now follow it; against agent
tagged notes at +4 the shift is small (an Omen's counted dry peeks bring in
planning the peek). Ask Coach's notes leave out the review's own list as
either kind of client was given it. `check:playbook` fails a topic of either
table that no note carries (`CHECK_PLAYBOOK_TOPIC` plants one, which
`test:valorantreview` holds it to), and `test:serverguards` holds the route's
gate.

**New knowledge goes in `server/data/playbook.json`**, the growth hook the
module has always documented. It merges at startup, `check:playbook` covers it
automatically through `knowledge.all()`, and extra fields such as `source` pass
through untouched. It began as 69 notes (42 imported from pro VOD reviews and
27 of Occlara's own, computed from the damage table or written from round
shapes), grew to 227 with the 2026 imports, to 308 with the 8.7.2 audit, to 469
with the 8.8 coach consensus and to 602 with its second round (below); the live count is `knowledge.all().length` minus the hand written
set, and the boot line `[knowledge] merged N` says it. **An imported note must
carry `source.topic`**, which is what `study()` picks by, or the checker fails
it.

**The app never says where a note came from.** A source holds its kind and its
topic, never a name: `check:playbook` fails a note with a `coach` key, the
study card is the note's text alone, the review prompt tells the model never to
name a source, and `present()` in `src/main/index.js` cuts every study note to
its text on every review a window is handed, the ones saved before 8.2
included. `npm run check:attribution` reads every tracked file, and every file
git would add, for the names of the coach and team the notes were taken from,
built from character codes so the checker never contains them. Git history and
the website repo still carry them.

**Tagging decides whether a note exists at all.** Scoring is `agents +4`,
`weapons +4`, `maps +3`, `situations +2` each, `side/phase/roles +2`, and only
eight notes survive. Measured: a role-tagged note loses to an agent-tagged one
every time for a confirmed agent, so a Jett got **zero** of the imported notes
until the load-bearing role notes were given their role's agent list too. An
untagged note competes with 357 others and loses.

**A typo in a tag is invisible.** `retrieve()` excludes rather than warns, so
`phase: 'postpant'` makes a note permanently unreachable with no error. That is
what the tag vocabulary check exists for, and the vocabulary list is itself
checked against the flags `situationOf` actually produces, in both directions.

**Weapon numbers are computed.** `sync:valorant` pulls the damage table (20
weapons, 13 with falloff), and any note declaring `source.numbers` has every
number in it verified against that weapon's real ranges, its spelled numbers
too since 8.5.0 ("two taps", "a fifth bullet"; "one" only before what it
counts, never the pronoun). A derived number (hits to kill, a magazine) is
legal only as a claim the note declares in `source.claims`, `{ weapon, part,
armor, hits, band }` or `{ weapon, field, value }`, which check:playbook
computes against the table through the primer (`game-primer.js noteClaims`).
Two of Occlara's own notes were false that way and nothing could see it: the
Guardian's "two taps a full shield" (two body hits leave Heavy Armor on 20)
and the Marshal's "one body and one pistol shot is a kill" (true only with a
Sheriff, or against Light Armor). Both are computed claims now, and
check:primer plants them word for word into check:playbook, which must fail
them. A Riot rebalance fails the build rather than leaving the coach
confidently wrong. Notes that give tactical distances, "play inside 5 meters",
are NOT checked, because that is advice and not a claim about the table.

A contradiction advisory was built here and **removed after measuring**: both
alarms it raised were false, "send it" matching Wingman and Owl Drone rather
than aggression. What would actually work is recorded in the file.

### Advanced coaching is a BIAS, never a replacement

`advancedTips` in config, surfaced in Settings and onboarding as Advanced
coaching, and **ON for everyone since 8.8**: the notes are sized to the
player's rank (`knowledge.js rankAdjust`), so a Gold player is never handed a
Radiant only note, and the deeper coaching is the best coaching at every rank.
A player can still turn it off, and that choice sticks.

- **Every reader treats unset as on.** Main reads it through
  `src/main/services/advanced-coaching.js` `on(store)` (`!== false`), the
  engine's snapshot and both pages likewise. Only an explicit `false` is off.
- **The one time switch, and why a default alone was not enough.**
  electron-store (conf) writes its defaults into the file on first run, so
  every install from before 8.8 holds `advancedTips: false` on disk, a value
  its player never chose, and the file beats the new default.
  `turnOnOnce(store)` runs as `store.js` opens: when `advancedTipsOnAt` is 0 it
  sets `advancedTips: true` and stamps the flag in one write, and never runs
  again, so a player who turns it off after the update keeps it off.
  `test:advancedtips` proves the trap on the real conf in a temp folder, then
  the four cases: fresh install on, an existing false turned on once, off after
  the switch sticks, never twice.
- **The server is unchanged and reads only an explicit true**
  (`match-review.js clean()`, `chat-prompt.js`). Every client since the toggle
  sends a boolean, so an old client sending false stays false, and a client so
  old it sends nothing reads as it always did.

It now shapes the notes the REVIEW draws on (`match-review.js` passes
`context.advancedTips` to `retrieve()`), and the study list keeps the same
reserve at its scale: off, `study()` lists core notes only; on, two of three are
advanced with a core note always among them, and a match lost in a run of
rounds (the `streak` pattern) gives core two of three. A note carries `tier:
'core' | 'advanced'`, core being the default so the 357 hand written ones are
untouched. With the toggle on the mix `retrieve()` serves goes from about 30% to 75%
advanced, measured across 12 real logged contexts plus 6 synthetic (the sixth,
Swiftplay's round 5 pistol, since 8.5.0).

**A floor of core notes always survives, and on a deathstreak core takes the
majority back.** That is the design, not a hedge: advanced advice assumes the
fundamentals are in place, and a player dying on repeat needs to stop walking
into open ground rather than a damage breakpoint. The override is deliberately
not configurable, because someone who turned advanced mode on is exactly the
person who will not turn it off while losing.

It is a **reserve, not a score bonus**. A bonus was the first design and does
not do what it says: with `agents +4` in play, a bonus big enough to guarantee
advanced notes surface drowns the specificity that makes any note relevant.

**A weapon note must never name the weapon it is tagged for**, since the player
can see their own gun. They give a distance to play instead, which is better
advice anyway. Naming a DIFFERENT gun is allowed and is often the point.

`npm run test:advancedtips` measures the retrieval shift offline. **Always run
it on both sets**: measured on real contexts alone, all twelve came back "no
agent", so `agents` notes, the highest scoring tag at +4, were never exercised.
It also pins what the primer changed in retrieval (below): the pistol rounds by
mode, the computed buy lines, and the four notes that lost a typed number.

## The cause tag, and the coaching rubric (8.7, 2026-11-04)

**A note may carry `cause`**, an array of the labels the death look gives
(`death-forensics.js CAUSES`: dry-peek, isolated, repeek, crossfire, rotating,
overextend, exposed, lost-duel). `retrieve()` serves a cause tagged note only
when the context carries one of its causes (`ctx.cause`, one label, which Ask
Coach sets from the asked round's look; `ctx.causes`, a list, which the review
sets from its counted `cause:` mistakes and its rounds' causes, for a client of
8.5.0 or later, the same `byCause` gate as `study()`), and scores it +5, above
general advice. `check:playbook` fails a `cause` that is not one of the eight.
Notes also keep `when` (the observable situation that should bring the note
up) and `why`; neither is rendered to a model or a player, they document the
tagging. exposed, rotating and overextend have the fewest cause notes.

**The 8.7.2 audit (2026-11-04).** 81 notes were added from published coaching
guides, Riot's 13.00 to 13.09 notes and the damage table (the Warden, Hush's
kit, Summit's walls, Corrode's water and mid, every pool map, the exposed,
rotating and overextend causes that had the fewest notes, comms, economy and
round logic), 15 notes were corrected (the two checkpoints notes are attack
only and list Hush; the shallow smoke and the thorn are defence only; the
pattern smoke is Viper's and Astra's; the Sheriff, Classic and Bandit lines
now say what the table supports, with the Sheriff and Bandit one taps as
declared claims; the anti eco armour reason; the clutch plant), and in
`knowledge.js` fourteen weapon notes stopped naming their own gun, the Lotus
doors, the round clock, the drop rule, the call order and peeker's advantage
were reworded, `ROLE_OF` gained Hush, Veto and Miks, and `TEAM_PLAY` also
excludes "a team", "the default" and "group on a site" from a solo clutch.
The source kinds in use are vod-review, computed, round-shape, guide,
riot-notes and stats; nothing reads the kind. Every weapon claim in a new
note is declared in `source.claims` with the armour as `none`, `light` or
`heavy` (the keys `noteClaims` reads). Summit's B Drop note was kept: the
map guides describe it as the silent one way drop from B Tower onto the site.

**Where the 2026 imports came from.** 159 notes were added from coach VOD
transcripts and guides (fundamentals and death causes, roles and every agent's
kit checked against valorant-api, macro, and how a coach runs a review), and
about 36 hand written notes were corrected or dropped (Harbor's Cove, Clove's
Ruse, the minimap and counter strafe lines, the trade rule). Notes the
researchers flagged "verify" (shotguns after patch 12.09, scoping, crossfire
spacing) were left as they were.

**The review and Ask Coach prompts follow one rubric** (match-review.js
`promptRounds` and `GROUNDING`, chat-prompt.js `VALORANT_RULES`, whose copy in
`test-chat-gates.js SPEC_RULES` is held word for word): one fix, not a list;
rule out whether the fight needed taking, whether anyone could trade it and
whether there was information or utility before the shot, and call it aim only
where the look said a fair fight was lost on the shot; every fix is when this
happens, do that, because; praise a habit and why it works, never a scoreboard
number; never blame teammates or luck; size the advice to a rank only where
Ask Coach is given one. The chat rules must not contain the words "THE PLAYER":
the budget test slices the prompt at that heading. A fix has no count or timer
of its own, because the number gate would drop the sentence. The rank band line
for the review came in 8.8 (below). Not done: the look prompt's "better play"
wording (needs the forensics bench). Run `bench:review` and
`bench:chat` before the next release: neither has been run on this wording.

**8.7.2 added to the prompts, each a sentence** (from the audit of what the
model actually wrote): the review's round lines each teach a different
lesson and say "nobody traded you" at most once (the counted mistake already
says it); a plain words rule in `GROUNDING`, `VALORANT_RULES` and the look
(a teammate close enough to kill your killer, not trading distance; the
smoke by name, not utility; never impact, tempo, map control, situational
awareness); Ask Coach answers a game number the facts hold in its first
sentence and stops, names at most one ability in an answer about a round, and
teaches the save rule once by side; the look names an ability only for what
it does (Iso's Undercut "checked" an angle in a shipped look), reads
"rotating" only for a player who had not started a fight, and judges a lurk
by the fight and the exit rather than the distance to the team. None of it
has been benched either: `bench:review`, `bench:chat` and `bench:forensics`
are the next step.

## The rank band, and the coach consensus (8.8, 2026-11-05)

**A note may carry `ranks`**, the rank bands it is for: `iron_bronze` (Iron
and Bronze), `silver_gold`, `plat_diamond`, `asc_plus` (Ascendant, Immortal,
Radiant). A note with no `ranks` suits every band, which is every note written
before 8.8, so nothing existing changed. A band is where the habit first pays,
not who may hear it: the fundamentals carry the low bands (and usually every
band above), the micro decisions start at Platinum. `check:playbook` fails a
value that is not one of the four, a band listed twice, an empty list, and the
four lists falling out of step: its own, `knowledge.js RANK_BANDS` and the
client's `src/shared/rank-band.js BANDS` (neither side may require the other).
It is a different axis from `tier`: the Advanced coaching toggle stays the
player's choice. Its reserve follows the band since round two (below, "The
reserve follows the band").

**How the coach knows the rank.** The client sends a band, never a tier name
and never a Riot ID, as `rankBand` on the review (`context.rankBand`, from
`coaching-engine.js` through `experiments().rankBand` and from `index.js
riotLook`), on the look at a death (`rankBand` on the body) and on Ask Coach
(`context.rankBand`, deps.rankBand). `index.js rankBandNow` derives it from
what main already holds for the Riot ID in Settings, with no request of its
own: the rank history's newest rated game (`RankHistory.held`), then the
tracker profile's `rank`, then its `peakRank` (`rank-band.js rankBand`, pure,
`test:rank-band`). The history leads because a promotion shows there a game
before the profile catches up; the peak stands in for a player unrated this
act. Unranked, Unrated or a word the file does not know is no band, and League
is sent none. Every server reader (`match-review.js normalise`,
`death-forensics.js normalise`, `chat-prompt.js normalise`) keeps the field
only when it is one of the four keys and otherwise leaves it out, so a client
before 8.8, or one sending junk, gets today's input, prompt and notes byte for
byte (held in `test:rank-band`, `test:valorantreview`, `test:advancedtips`,
`test:chatgates`).

**The retrieval rule** (`knowledge.js rankAdjust`, used by `retrieve()`,
`match-review.js study()` and Ask Coach's topical notes):

- a note whose LOWEST band is above the player's is excluded, so an Ascendant
  micro decision never reaches a Gold player;
- a note narrowed to bands that include the player's scores +2 (`RANK_FIT`; a
  note listing all four is a note for everyone and gets nothing);
- a note for lower bands only is excluded for a higher player (a -3 score
  alone let an agent and role tagged "in Gold and below" initiator note
  outscore its Plat+ opposite for a Plat Sova), unless the player's own data shows the fundamental missing: in `retrieve()`
  a cause note the context carries or a death streak, in `study()` a topic the
  match's patterns or causes point to or a cause of its deaths, in Ask Coach
  every topical note (they are all the player's own patterns);
- no band changes nothing: `rankAdjust` answers 0 for every note, the loop
  runs the same exclusions and draws the same jitter.

The eight note cap, the death streak override and the agent, role, map and
cause filters are untouched. `test:advancedtips` and `test:agentroster` hold
all of it at every band.

**The reserve follows the band** (round two, `knowledge.js
ADVANCED_SLOTS_BY_BAND`). With Advanced coaching on for everyone, six of eight
slots went to some forty unbanded advanced notes at Iron and Gold, and the
band's own fundamentals lost the two left: measured, Iron's eco got no
economy note and Iron's clutch no clutch note. With a band the advanced share
is 1 of 8 at `iron_bronze`, 2 at `silver_gold` and today's 6 at `plat_diamond`
and `asc_plus` (the death streak takes the smaller of its 3 and the band's),
and inside the advanced queue a note narrowed to the player's band goes
before an unbanded one (`bandFirst`). `study()` takes the same share at its
scale (0 of 4 at Iron, 1 at Gold, 3 from Platinum). No band, or one no key
matches, is today's reserve byte for byte, the same notes and draws.
Measured with the round two simulation (`sim2.js` in the research folder):
Iron and Gold now get 2 to 3 eco notes in the eco, 3 clutch notes in the
clutch, 6 to 8 retake notes in the lost retake and 7 to 8 trade notes in the
untraded death, Platinum and Ascendant+ keep 6 advanced of 8 in every context.

**The prompts.** With a band, the review gets a `PLAYER LEVEL` paragraph
before `GROUNDING` (`match-review.js rankRule`: below Platinum the one basic
habit that matters most there, Platinum and Diamond the one decision,
Ascendant and up the specific timing, utility or read and what it risks, never
a high rank micro decision for a lower band, never the rank said back), Ask
Coach a line in the player's facts (`chat-prompt.js renderPlayer`, beside the
rank rule `VALORANT_RULES` already had), and the look one rule
(`death-forensics.js rankRule`: the better play fits the level, the cause is
judged the same at every rank). Without a band none of the three is there.
None of the three has been benched: `bench:review`, `bench:chat` and
`bench:forensics` before a release that ships them.

**The coach consensus import.** 167 notes (`source.kind: 'coach-consensus'`)
came from a research pass over VOD reviews, guides and threads by high level
coaches and Radiant or Immortal players only, every claim restated as a
teaching habit in Occlara's own words: claims were clustered by topic,
independence counted by person (one coach's channel, AMA and threads are one
source), a candidate kept only with two or more independent teaching sources
and no contradiction, or one source plus a Riot fact the damage table,
`game-rules.json` or the 13.09 notes verify, and every candidate then read by
a separate verifier pass that kept, edited (text and bands) or dropped it (14
dropped). Weapon numbers were checked against the synced table and the ones a
note states are declared in `source.claims`. Weight follows the independent
sources (one 1, two or three 2, four or more 3), `tier` is advanced when the
lowest band is Platinum or above, and a candidate on a subject a pattern or a
cause already points to carries that topic. The same pass replaced or removed
the existing notes the verified consensus contradicts or supersedes (the
fixed tempo switch, the recon fired before every hit, the flash only for a
teammate at Gold and below, three duplicated pairs and others). **The
evidence lives outside the repo**, in the research scratch folder of the
session that ran it (sources, claims, candidates, verifier verdicts, the
conflict list and the change list with every removal's reason): it holds the
names and links of the sources, which no file in this repo may carry
(`check:attribution`).

## The enemy team, and the worked cases (8.8, round two, 2026-11-06)

**A note may carry `enemyAgents`**, the enemy agents it answers (an Operator
held by a Chamber or a Jett, a Killjoy setup, a Hush pull, a Phoenix
ultimate). `knowledge.js enemyFit` makes it eligible ONLY when at least one
of them was on the enemy team, and scores it `ENEMY_FIT` (+2) then, so a
matchup read is never served blind. `enemyWithout` is the other shape, a read
that holds only while the enemy has none of those agents (the comp with no
flash): it needs the whole comp, five agents, because a few rounds' killers
say nothing about who was not there. `retrieve()` reads `ctx.enemyAgents`,
`study()` and Ask Coach's topical notes the same list; every list goes
through `knowledge.enemiesOf`, which keeps only the game data's agents, as
the data spells them, five at most, so a name or a Riot ID can never be one.
**No list is today's retrieval byte for byte**: every enemy note is excluded
before its jitter is drawn (`test:advancedtips` holds it against a corpus
that never had them, the same notes and the same draws).

**`enemyHint`** is the soft shape, for the notes about an enemy agent that
were served blind before the comp could be known (the Hush anchor, the Cypher
snapshot, the Lockdown, the Hush redirect, the Clove Not Dead Yet, the Neon
distance). The comp unknown or partial (fewer than five, a few rounds'
killers) is today's, served as before; a known comp of five with none of them
in it leaves the note out; one of them present scores `ENEMY_FIT`.
`check:playbook` holds it to the game's agents and never beside `enemyAgents`
or `enemyWithout`. A strict tag would have taken those notes from every client
that sends no comp.

**Where the list comes from.** The review: the comp the client sends as
`context.enemyAgents` (`valorant-review.js requestBody`, from Riot's
`comps.them` through `compsOf`, which `index.js riotLook` now passes), and,
for a client the route marks (`input.byEnemy`, `clientAtLeast(req, V876)`,
8.7.6 and up), the agents Riot's record says killed the player
(`match-review.js enemiesOf`). Ask Coach: the match's `comps.them` and each
card's Riot killer (`chat-prompt.js enemiesOf`), for a client the route marks
the same way. A client before it sends no new field and is never marked, so
its notes and cases are chosen as before (`test:serverguards` holds both
gates).

**Worked cases** (`server/data/cases.json`, `server/services/cases.js`).
A case is one decision worked through: `{ id, title, situation { phase,
side, role, agent, enemyAgents, map, site, economy }, signal, decision, why,
mistakeToAvoid, cause?, patterns?, ranks, minBand, tier, weight,
patchSensitive, source { kind, topic, claims? } }`, in the app's coaching
voice. `cases.pick` serves at most `MAX_CASES` (2), and only on a real
situational match (`cases.js situational`, round two: the first measure gave
every one of 20 reviews and 100 questions a block, nearly always the same two,
because an agent or a phase alone reached `MIN_SCORE`). A case for an agent or
a role needs one of a phase, a cause, an economy round, an enemy agent or a
pattern beside it; a case for any agent needs two different kinds of those.
Over a whole match a phase counts only where the deaths gather, at least two
and a third of them (`concentrated`); an asked round keeps its own phase. The
cases for any agent with one kind of anchor are held back by design (42 of
157, mostly mid or late round reads no review can see), and `check:cases`
lists them and fails past `HELD_BACK_MAX`. Every case also needs a score of `MIN_SCORE`. The same filters as the notes:
another agent's, role's or map's case is excluded, a side case for a player
who never played that side, enemy cases never blind, the rank band through
`rankAdjust` exactly as notes (above the band out; below it only when a cause
or a pattern the case answers shows it missing), and Advanced coaching off
leaves the advanced ones out. A second case is served only when it matched
something the first did not and teaches none of the first's causes, patterns
or phase (`lessonsOf`). Near ties turn by the match's seed (`VARIETY`, up to
2 points from a hash of the seed and the id): Ask Coach's Riot match id or
review id, the review's own rounds (`reviewSeed`, the body has no match id),
so one match always gets the same cases and another may get others; no seed
is ties by id. Measured on the 20 review and 100 chat fixtures: 20 reviews
with cases (10 with two, before 20), 82 questions (25 with two, before 100
and 92), growth over HEAD at most 9.1% and 7.0%. `cases.fromReview` builds the review's situation (sides played,
the phases and pistol rounds of the deaths, causes, patterns), and
`chat-prompt.js casesFor` the question's (the asked round, else the match,
and the question's own words in English).

**The prompt.** The block is `WORKED CASES from high level coaching: when
the player's situation matches, reason from the case, never copy it word for
word, never name it as a case, and never say where it comes from`, one line a
case. The review puts it after the coaching knowledge, Ask Coach after its
notes, and either may grow by `CASE_GROWTH` (10%) at most: past it the lowest
notes go one at a time down to three, then the second case, else the prompt
is today's (`match-review.js withinBudget`, the same loop in `buildParts`,
which also keeps the dynamic budget). A review or a question no case matches
is today's prompt byte for byte, and `buildPrompt(input, { cases: false })`
is that prompt for the tests and benches. `test:valorantreview` and
`test:chatgates` assert it precisely: the notes kept are today's first ones,
and taking the block out leaves today's prompt with those notes.

**`check:cases`** (`scripts/check-cases.js`) validates the file: the shape,
every tag value cases.js can match, the four bands with minBand their lowest
and tier advanced from Platinum up, every case reachable in the situation its
own tags describe, no dashes, no curly quotes, no semicolons, NO NAMES (a
capitalised word inside a sentence must be a word of the game, a rank or a
role), an ability only of an agent the case is about, a callout only of its
map, a source of kind and topic alone, and every declared claim computed by
the primer, including the new `{ rule, value }` claim for a stated game rule
(`game-primer.js noteClaims`, used by `check:playbook` too: the spike's 7 and
3.5 seconds in two notes and four cases). `test:advancedtips` plants eight
bad cases it must fail. `check:attribution` scans the file like any other.

**The import.** 133 notes (of 151 candidates, 18 dropped by the verifier,
edits applied with their bands; 22 carry enemy agents; 20 took the topic a
pattern or a cause already points to, so `study()` follows them) and 157
cases (of 176 candidates, 8 dropped by the verifier and 11 left out as unreachable from
anything a review or a question shows and taught by a note already: agent
select, the scoreboard, the score late in a map). One existing note
changed: `playbook.json` #32 (second entry as a sentinel) is scoped to a trap
already watching the flank, as the new sentinel note says. The flank watcher
on every hit, the burst length note, the fake defuse tap and the two
ultimates note were left as they are (not verified wrong, the evidence is in
the research folder). `test:advancedtips`'s side check reads twelve notes,
not eight: the new Sova notes held the eight free of side notes on about a
third of the random draws. Nothing was benched: `bench:review` and
`bench:chat` before a release that ships the cases.
