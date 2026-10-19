# The Valorant primer: every game number has a source

Moved out of CLAUDE.md word for word, nothing reworded or dropped (CLAUDE.md as of commit cc1f880, 8.5.0, lines 3384 to 3573). Sections here: "The Valorant primer: every game number has a source". "Above" and "below" in the text name sections that may now sit in another file under docs/claude/: grep the section's title there to find it. The table in CLAUDE.md says which file to read for which work.

## The Valorant primer: every game number has a source

`server/services/game-primer.js` (8.5.0) renders what the models are told
about the game: how a match runs, the credits, damage and armour, a line per
gun, duels, roles and teams, every agent's kit on its keys, attack and
defence, and what the review counts. Before it, every number Ask Coach said
came from the model's memory, which predates the Bandit, the Warden, the Regen
Shield, Veto, Miks and Phoenix's key swap. **Every game number is synced,
stated and confirmed, or measured, never typed.** Three tiers, and nothing
else reaches the text:

- **Synced**, from the game's own files through valorant-api.com. Since 8.5.0
  `sync:valorant` keeps every gun's head, body and leg damage by band, its fire
  rate, magazine, reload, draw, running speed, first bullet spread, aimed
  burst, pellets, alt fire, penetration and feature; the armour (cost, the
  share of each hit it takes, what it absorbs before it breaks, read from its
  own text, and the Regen Shield's pool); each agent's kit (slot, default key
  C, Q, E or X, name, description) and Riot's role descriptions; Standard's and
  Swiftplay's own rules ("First to 13 wins.", Swiftplay's halves of 4 and no
  win by two); the patch and version; each map's minimap transform (for Riot's
  kill positions later). Every field the gates read is as it was
  (`abilities` the lower case list in the game's order, `ranges[].body`), and
  both copies stay identical. The extraction is
  `server/services/valorant-extract.js`, which the sync requires, so the live
  check reads the live game with the code that wrote the synced copy. It
  FAILS CLOSED, naming every problem: fewer than 15 guns, a missing armour,
  an agent missing a used slot or a description, a gun or gear item
  `KNOWN_WEAPONS` or `KNOWN_GEAR` does not list, a field the API renamed. A
  new gun is a renderer change first, then a sync.
- **Stated**, in `server/data/game-rules.json`: the numbers no game data API
  publishes, each once, with its kind (`riot-notes`, `measured`, `occlara`,
  `wiki`), source, `verifiedPatch`, topic tags, check and `confirmed`. **A
  wiki fact renders only once confirmed.** The player confirmed on 15 Oct 2026,
  with the VALORANT Wiki as the stated source, the standard economy (the 800
  start, the 3,000 win, the 1,900, 2,400 and 2,900 losses, the 200 kill, the
  300 plant, overtime's 5,000), the spike (the 4 s plant, the 7 s defuse with
  its half at 3.5 s, the 45 s timer, the beeps at 20 and 10 s) and ultimate
  points (1 each for a kill, a death, a plant or defuse, an orb). Swiftplay's
  pays and its ultimate start stay `confirmed: null` and are said in words
  ("the second round of a half pays more after a won first round"); the kill
  and plant pays are Competitive's facts, so Swiftplay is told they pay only
  once they are stated and confirmed for it, never read into its "same core
  rules". Riot's
  patch notes give the 9,000 cap, the surviving loser's 1,000 and the Regen
  Shield's 25. Measured: health 100 (the AI log fixtures' canary), the round's
  100 s and the buy's 30 and 45 s (the client's constants). Occlara's own: the
  trade's 5 s (imported from `TRADE_MS`, never copied), the early death's 30
  s, the multi kill's 3, halves of 12, overtime won by a lead of 2 and
  Unrated's 12 all decider (`match-end.js`). check:primer holds every mirror
  equal to the code it mirrors, by export where there is one and by a pattern
  that must read the number where there is not.
- **Principles**: coaching text with no digits and no spelled numbers.

**Every number goes through one helper, and keeps its provenance.** `n()`
records the value, how it is shown (a number, beside the printed `text`), its
subject and `subjectKind` (gun, gear, agent, ability, rule), its attribute in
the number gate's own words (`hits`, `head`, `body`, `legs`, `price`,
`credits`, `seconds`, `rate`, `magazine`, `pellets`, `health`, `percent`,
`points`, `metres`, `kills`), its part, band and armour (`none`, `Light
Armor`, `Heavy Armor`), the words a rule's number is tied by in a sentence,
its source and the inputs it was computed from; a grouped number keeps an
entry for each gun it covers. `provenance(mode, opts)` is what
`fact-gates.js primerHas` checks a reply's numbers against. Hits to kill are
simulated hit by hit through the absorption rule (and held equal to the
closed form for every gun, band, part and armour); time to kill is the first
hit at once and then one a fire interval, so a Spectre's 6 body hits on Heavy
Armor take 0.38 s and a Vandal's 4 take 0.31. **Damage prints as the game
shows it**, the whole number below a fractional value (the Sheriff's head hit
is 159, as the player's Fracture combat report showed it), with the exact
value kept for the arithmetic. Every grouping is computed: the prototype's
hand typed "sidearms run at 85%" was false for the Sheriff and the Shorty.
Riot's own kit text goes through the same helper, its digits and its spelled
numbers ("every two kills") included.

**Every sentence is a unit with its inputs**, and a unit whose input is
withheld is left out whole, or said in its fallback words; a heading or a
bullet whose units all go goes with them. Withheld are a synced number the
live game no longer has and every sentence computed from it; the gun table
and the kits (every `w:`, `g:` and `a:` input) when a differing live patch
cannot be fetched or extracted, or no check has succeeded for 24 hours; a
stated fact a patch since its `verifiedPatch` may have touched; and for a
past match (`matchAt`), what the patches released since it tagged. **The
numbers are the game as it is now**, and the header says so word for word:
"These are the game's numbers as it is now. A match played before a patch can
differ, and a number a patch has changed since that match is left out for it."

**The live version check** (`startLiveCheck()`, at boot and every six hours;
`liveStatus()`, `{ synced, live, withheld }`, for `/api/admin`) asks
valorant-api.com's `/v1/version`. When it differs from the synced version it
fetches the endpoints the sync uses, extracts them with `valorant-extract.js`
and diffs every synced number the primer prints (`flatten`). A changed number
is withheld until the next sync and deploy, one log line names it (and only
when that changes), and **a new number is never stated before check:primer
has run on it**: the primer prints the synced data only, the live data is
read to diff and nothing else. Nothing runs at require time, since
check:server loads every server file, and the timer never holds a process
open. **server.js starts it once listening, on Railway alone**
(`liveCheckWanted`: `RAILWAY_ENVIRONMENT_NAME` or the older
`RAILWAY_ENVIRONMENT`, which Railway sets on every deploy, or
`PRIMER_LIVE_CHECK=on`; `PRIMER_LIVE_CHECK=off` stops it anywhere, and every
test that boots server.js sets it): no check, test or CI run calls
valorant-api.com, and Railway's server is never left unchecked, which after a
day would withhold the gun table and the kits. `GET /api/admin/primer`, behind
the admin password, is `liveStatus()`: after a deploy `live.lastOkAt` set and
`withheld` and `statedGate` empty say the primer states everything it has
(`check:primer`, `test:serverguards`).

**The patch history and its two gates.** `server/patch-notes.generated.json`
keeps the last 12 patches in `history`, each with its release date and EVERY
line of its notes, since the old sync dropped a line naming no agent, gun or
map and an economy change names none. Every line means the short and the long
ones too, which the prompt's five words to 240 characters keep out of
`changes` only: Riot writes a change as a heading and short lines under it,
and the heading is what names the topic (9.10's Regen Shield was "Regen
Shield" over "Damage Absorption: 25 HP", neither five words, so the prompt's
filter left the history nothing about the shield). A patch's notes count as
found only on a line of five words or more (`substantive`), so a page of
nothing but its own chrome withholds rather than vouches. The top level fields
`patch-context.js` reads are as they were, and `npm run sync:patch --
--upgrade` converts an old file offline (its lines named only, so it can
withhold a gun but never clear a stated fact). A line is tagged by topic
(`server/services/patch-topics.js`: economy, armor, spike, timers, format,
ultimate, swiftplay, health, each pattern narrow on purpose and asserted on a
positive and a negative line and its `CASES`: a heading names its topic, a
plant time is the spike's, Spike Rush is a mode, a buy time is a timer).
**The stated facts gate**, deploy wide: a fact passes when it was verified on
the synced patch, or when every patch since had its notes found whole and none
of their lines carries one of its topics; re-stamping is one edit of
`verifiedPatch`, made after reading the lines. **A past match** is on the
patch live on its date (`matchAt`), and within 48 hours after a release on
both, or on Riot's own patch for it once the record gives one (`matchPatch`,
Phase D's `game_version`); it loses what the patches since tagged (a stated
fact by its topics, a gun or an agent by name, the armour by `armor`), and
every stated fact a patch can touch when a patch since has no notes, notes
kept only in part, or is missing from the history altogether (a hole between
two kept patches is a patch nobody read; the sync records one it could not
read rather than leaving the hole; across a major only its X.00 follows the
last major's patch, so 14.01 straight over 13.08 is 14.00 missing). Occlara's
own rules, the facts with no topic (the trade's 5 s, the early death, the multi
kill), no patch changes, and no gate withholds them: the review a match was
graded by says them.

**Where it goes, and never.** Ask Coach gets the core for the match's mode
and its slices (`kit`, `guns`), the death look the duel slice (`duel`, worded
"bought", from full health) and both kits, the review the core without the
gun table and the roster (`guns: false`) and the match's slices. The slices
count only what they can: a shotgun in a duel by the pellets of one shell
("a shell kills with 9 of its 12 body pellets"), never as a race of shots at
its fire rate and never against a rifle's body count (counted as shots, a
Judge at 5 m read as 2.29 s to kill Heavy Armor); a Regen Shield bought by its
own absorption and its own name; an armour the game data does not name as no
duel at all, never as none; the comps (`comps`) only by agents the game data
knows, anything else in a team list counted and never printed, a player's
name above all, and a team holding one never said to lack a role; the guns
slice's effective health only while the armour rule holds, as the core's. If
prefix caching does not reach the provider, Ask Coach's gun table moves to
slices with the roster kept (`guns: false, roster: true`). The core renders in about
4 ms and is the same text for every match on the synced patch, so it can sit
first in a prompt for caching. Never the live read, never League, never `src/`
(check:primer scans every require of it).

**Today's knowledge, corrected** (8.5.0). `knowledge.js`'s four unsourced
numbers went: footsteps "audible around 20 meters" (no source anywhere), the
defuse's 7 and 3.5 s (now read from the confirmed rules), "the Frenzy melts
inside 10 meters" (the band now read from the table, 20 m), and "the Spectre
stays accurate on the move" (in no data); the Spectre's 15 m reads the table
too. `situationOf`'s pistol rounds follow the mode (`ctx.mode`, or the live
engine's `gameMode`: round 5 in Swiftplay, where round 13 never comes, with no
mode Competitive as before) and its eco and full buy lines are computed (a
Spectre with Light Armor, 2,000; a rifle with Heavy Armor, 3,900). Measured
against 8.4.4: the study pool is identical, and of the 86 notes every review
and chat retrieval can reach only the footsteps note's words changed.

`npm run check:primer` (in npm test) holds all of it offline: every number in
every render inside a recorded number, with no spelled one in the primer's
own words (a planted digit must be caught); the extraction giving the
generated file back from the API's shape and failing closed on each rule;
only confirmed facts, and exactly the player's decision; hits, time to kill
per gun and damage as shown, recomputed independently; mutation (a Spectre
head hit of 110 removes "no Spectre head hit kills"); the mirrors and the
canaries; size (the Ask Coach core under 17,000 characters, about 16,400
today); no dashes, no source name, no patch number; the live check on a faked
valorant-api (a changed Sheriff head hit withheld with its sentences, an
outage after 24 hours, a failed extraction at once); the history and both
gates (a heading and its short lines kept, a page of chrome no notes, a 13.09
that moved the shield and the plant withholding both, 14.01 over 13.08 a hole,
Occlara's own rules never withheld); the slices' counts (a Judge's shell, a
Regen Shield, an unknown armour, a name in a team list); check:playbook's
planted controls; and where the primer goes.
