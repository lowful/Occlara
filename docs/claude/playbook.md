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
exposed post plant and retake shape. The summary and the focus already name
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
through untouched. Its 69 notes are 42 imported from pro VOD reviews and 27 of
Occlara's own, computed from the damage table or written from round shapes, and
**an imported note must carry `source.topic`**, which is what `study()` picks
by, or the checker fails it.

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

`advancedTips` in config, off by default, surfaced in Settings as Advanced
coaching. It now shapes the notes the REVIEW draws on (`match-review.js` passes
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
