# Ask Coach knows the match it is asked about

Moved out of CLAUDE.md word for word, nothing reworded or dropped (CLAUDE.md as of commit cc1f880, 8.5.0, lines 3574 to 3815). Sections here: "Ask Coach knows the match it is asked about". "Above" and "below" in the text name sections that may now sit in another file under docs/claude/: grep the section's title there to find it. The table in CLAUDE.md says which file to read for which work.

## Ask Coach knows the match it is asked about

Ask Coach (8.5.0, v2) answers about one match at a time, and code decides
which. Before it was handed a 2,400 character summary of whichever review was
open, the tip era's session tips and the tracker's profile, and the model said
every game number from memory.

```
src/shared/chat-context.js       which match, the hold, the rounds a question names, the v2 context, the fill's rules
src/main/services/ask-coach.js   main's half: the chip, the refusals, both shapes, the one time fill
src/renderer/chat/               the page: the match chip, the starters, a thread per match
server/services/chat-prompt.js   normalise, the prompt, parseReply, the retry's words
server/services/fact-gates.js    the reply gates, a sentence at a time
scripts/bench-chat.js            the bench that picks the model (spends money)
```

- **Which match, in code** (`chat-context.js pickMatch`). The chip says it:
  the newest of the game when the page is opened from the sidebar, the
  review's own from "Ask about this match", one picked from the ten newest,
  or none for a general question. A question moves it only by the map rule:
  a map written as a proper noun after "on", "in", "at" or "my", in a question
  with a match word (a round, a death, a result, "match", "that game"), and
  exactly one of the ten newest on that map. "How do I play B on Split" names
  no match; "why did I die in round 5 on Split" does. Two of the ten or more
  on it is answered by asking which, none by saying so, with no model call
  either way, and a question that moved the chip goes alone, under a divider,
  its reply naming the match. The round a question names is read in code as
  well (`roundOf`): round 5, round five, R5, round #12, the pistol round by
  side (the second is the mode's own, round 5 in Swiftplay), the first, the
  last, overtime, and ronda, Runde, rodada, manche. A review older than the
  ten newest that "Ask about this match" or the chip named stays the match,
  and joins the list (`ask-coach.js list`): asked about the player's eleventh,
  the question went to the newest.
- **Nothing mid match, nothing of a held match.** A question asked while a
  match is in progress is refused before any request (`MID_MATCH`), and asked
  again after the fill and the tracker, which take time. A review saved after
  a stop in the middle of its match may be of a match still being played
  (`held`: `stoppedLive`, not linked, saved under 90 minutes ago, no review
  after it): never the default, never listed, refused when "Ask about this
  match" names it with the time it lifts, and frame chat refuses its frames
  (`HELD_FRAME`), until Riot's record links it, a later match is recorded or
  90 minutes pass. Its counts are no part of what the chat is told across
  matches either (`ask-coach.js library`): the patterns and the breakdown's
  rows are counted again without it while it is held, where they had told
  "across your last matches" what the held match had shown so far.
- **What it is sent** (`context.v: 2`, `build()`): the match as its review
  keeps it, each card's Riot facts (the second, the killer and gun, first death
  and kill, kills, the trade, the numbers standing, the clutch, the plant's
  site and time, the kill feed in order with its agents and guns, kept from
  the link since 8.5.0 and once filled on a review saved before), the
  numbers an explanation needs computed (seconds from the player's last kill
  to the death, seconds after the plant), the screen's spot and ult, a saved
  look's cause, sentences and digits, the counted lists and patterns, the
  grade with its evidence, the numbers against the player's own average, the
  coach's summary and focus, the breakdown's rows for the map and the agent,
  the patterns across matches, the tracker's numbers by name and the eight
  newest other matches a line each. A card saved before 8.0.3 is read back
  from its sentences (`oldFacts`), as the breakdown reads them: the player's
  Abyss swiftplay went with no killer, second or trade in any round. A saved
  lost duel whose better play moves the player goes without its label (the
  phrase lists, above). NEVER SENT: the engine's match memory, session tips,
  the tracker's `_riotId`, the match list's 0 to 100 rating, any player's name,
  a held match, anything mid match. Today's fields go beside it, so a server
  from before answers as it always did (`oldText` is the old string, moved
  whole).
- **The server takes it bounded** (`chat-prompt.js normalise`): agents, guns,
  maps and callouts against the game data, causes against `CAUSES`, numbers
  in range, free text through the handle shape, `BUY_BLAME`, the match's own
  name set when this server holds it, the capital rule and the killer gate,
  and the spike's time left computed from the primer's stated timer, never
  typed on the client. The capital rule reads the game's own capitals in lower
  case first, the review route's `REVIEW_WORDS` word for word and the chat's
  own (`fact-gates.js lowerGameWords`, test:chatgates holding the two lists
  equal): a summary sentence with "K/D", "ACS", "MVP" or "Victory" in it
  never reached the prompt.
- **The prompt** (`buildPrompt`): the spec's rules word for word, the primer's
  core for the match's mode as of the match (the same text for every match on
  the patch, so it can be cached), then the player, the match (the asked round
  in full with its feed in order, every other round a line), the kits and,
  with `CHAT_PRIMER_GUNS=slices`, the guns named (the core then keeping its
  roster), eight coaching notes at most (by the topics the counted mistakes
  point to, and `retrieve()` on the asked round, Advanced coaching honoured),
  the conversation, and outside English the language line. A 20 round match
  fits its own 19,000 characters with its round in full (`DYNAMIC_MAX_CHARS`,
  trimmed in four steps). League gets its computed review and no primer;
  `v2-noprimer` is the bench's control.
- **The enemy team and the worked cases** (8.8, `docs/claude/playbook.md`,
  "The enemy team, and the worked cases"). For a client of 8.7.6 or later
  (`coach.js chatV2` sets `input.byEnemy` by `clientAtLeast(req, V876)`) the
  notes see the enemy's agents, the match's `comps.them` and each card's
  Riot killer, agents only (`chat-prompt.js enemiesOf`): a note for an enemy
  agent is served only against it, never blind, and a client before it gets
  no enemy note at all. After the notes come at most two worked cases
  (`casesFor`, `cases.js`), only where the question's situation matches one:
  the asked round's side, plant, clutch, second, pistol and look, else every
  round of the match, the counted causes and the patterns, the question's
  own words in English, the enemy, the band and Advanced coaching. A case
  takes the place of the lowest notes so the prompt grows by `CASE_GROWTH`
  (10%) at most and stays inside the dynamic budget; a question no case
  matches is today's prompt. `test:chatgates` holds all of it, and
  `test:chatcontext` what the server reads of the context the client sends.
- **The gates, a sentence at a time** (`fact-gates.js check`, through
  `parseReply`). A sentence that fails one is dropped, never repaired: a
  player's name or handle, or a capitalised word the player typed (never in
  German); a source named; a meta or a ranking ("X is the best agent"); a round
  the match does not have; a result or a death the record contradicts, the
  negation read at its verb ("you didn't lose round 5" stays); a death called
  something its look did not call it; a killer who is not Riot's; a callout
  off the map or an ability off the player's kit in a sentence about a round;
  a standing, a time or a gun the record contradicts; the buy phase or the
  spawn blamed; an economy claim (Riot's record holds no buys before Phase D);
  "N of M" that is no counted one; "0:08" for a second; and every number,
  spelled ones and hit words turned to digits first, each by its unit and
  what it is about, against the primer's own provenance (by gun, part, armour
  and band), the match's numbers, the round's times within a second, the
  standings and the look's digits. Outside English a number is checked by its
  digits and unit alone, and the capital rule is English's. The name heuristic
  is in log mode (`name-log`, counted, never dropped) until bench:chat
  measures it. A reply whose first sentence was dropped, or that keeps fewer
  than two, is asked for once more with the reasons named (`retryPrompt`),
  else the honest line.
- **What bench:chat's panel found the gates dropping true, 15 Oct** (Sol v2,
  30 answers read by three agents; each fix pinned in test:chatgates from the
  run's own replies). The match's own result beside a round ("which you won
  13 to 11, round 22 was an attack you lost") was taken for the round's; a
  curly apostrophe (Sol's "didn’t") broke the negation, so the gates read every
  sentence straightened (`straighten`) and the reply keeps it as written;
  "pistol round" named round 1 wherever it stood, so it names a round only as
  one ("the pistol round", "your second pistol round", the second the match's
  second), and the review's run reader never sees it, nor "and one of", which
  read "pistol round and one of the two rounds you survived" as round 1. A
  question naming two rounds sent neither in full, the cause of both wrong
  facts the panel found: every round a question names is told in full, three
  at most (`MAX_ASKED_ROUNDS`). A bare "Yes." or "No." whose claim was dropped
  goes with it and the reply is asked for again. A gun said to be the
  player's must be one the round's facts give them ("you fought Clove with a
  Classic" where the Classic was the killer's drops). The prompt's static
  prefix and the match's facts come first, byte for byte the same for every
  question of a match (`buildParts`), and the gun table is in the slices by
  default (`CHAT_PRIMER_GUNS=core` puts it back), since Sol cached 0 tokens.
- **The 23 Oct run and what its panel found** (Sol v2, 90 answers, three runs
  of the 30 questions, read by three agents, merged 2 of 3; $1.95). Premises
  9 of 9 corrected, the honest line 1.1%, drops 5.0%, retries 12.2% (the bar
  10%), depth 4.78 of 5, names, kits, relabels, economy and meta 0 shown, p90
  6.1 s, $0.0087 a question with 77.6% of prompt tokens cached. Four wrong
  facts in 90, from two causes, both fixed and replayed offline over the 90
  raw replies (and the 15 Oct run's 120): a teammate named alone against N is
  that teammate's standing, 1 against N, never the player's clutch
  (`clutchOwner`, `standingClaims`), since "leaving Skye alone against three"
  dropped the sentence carrying the player's death and the trade after it read
  2 s early; and a standing said to be left by the player's death ("leaving",
  "down to", "after you died", "that left", across two sentences too) is the
  one after it (`deathStandingsOf`, `leftByDeath`, `gateLeftAcross`), since
  "Tejo killed you 13 s in, leaving your team 4 against 5" gave the standing at
  the death. And in English a sentence that leans on a dropped one, for its
  time ("one second later"), its subject ("She killed you 5 times") or what it
  answers, goes with it (`leansOn`, gate `leans`), never retried. On the
  replay: the four wrong facts gone, drops 59 to 63, no answer's retry or
  honest line changed.
- **Whose a first death, a first kill, a trade and a plant is (8.7.2, the
  review audit)**. Riot's firstDeath and firstKill are the player's, so the
  standing gate holds one to them only when the sentence says it is the
  player's (`firstOwner`, read as `clutchOwner` reads a clutch): "your Sova
  died first", "their Jett got the first kill on your Sova" and "the enemy
  Jett opened the round by killing your Sova", true of a round where the
  player had neither, were dropped; an enemy's first kill on the player ("on
  you", "by killing you") is held to the player's first death. And a
  teammate trading or avenging the player ("your Sova traded your death", "a
  teammate avenged you", `MATE_TRADED_YOU`) and the player planting ("you
  planted the spike", `YOU_PLANTED`) were kept on a round Riot has untraded
  and with no plant: both drop now, never under a negation. And the 2026
  modes and headline stats (Skirmish, Retake, Knockout, Gauntlet, Performance
  Score, Map Rating, Accolades, Mastery) are game words to `name-gate.js`,
  never a name (each pinned in test:chatgates).
- **What an independent probe of the gates found, 15 Oct** (each pinned in
  test:chatgates, each pin failing with its rule reverted). Passed: "Neon is
  better than Jett right now", "Jett is S tier", "the highest win rate on
  Abyss", "the most picked duelist" and "strong in the current patch", all
  rankings now (`AGENT_RANKED`, `TIER`, `RATE_RANKED`, `MOST_PICKED`,
  `PATCH_NOW`); "Pro players like Brimo" with the capital that opens a
  sentence; "the coach calls round 6 a lost duel", the label read past the
  round named; "you lost the first round", "round 5 was a loss" and "the enemy
  took round 5"; in a reply about one round, "nobody traded you" and "a
  teammate traded you", what the player bought or saved and their own gun
  ("your Vandal lost to his Sheriff"), none of them read as about the round;
  "3 against 4" for 4 against 3, the player's side now first unless the
  sentence is about theirs; "you died 25 s into the round" for another
  kill's 25 s or a counted line's 30, a death's time now Riot's second of it
  within one; "three kills in round 3" for two, a named round's own count; in
  League, "Ahri is better than Zed right now" and "the best champion right
  now" (`CHAMPION_RANKED`, `CHAMPION_META`, League's alone, "your best
  champion by grade" the player's own). And a review's own sentence naming a
  player of the match in lower case reached the prompt: the match's name set
  holds it now (`chat-prompt.js matchNames`).
  Dropped wrongly: "I don't have pick rates or a tier list for the current
  patch", the honest answer the rules ask for, with its retry told it had
  ranked agents (a meta word a negation or "rather than" governs is no
  claim, `META_REFUSED`); every sentence saying "K/D", "Overtime" or "Attack"
  once the player had typed the word with a capital, as an echo of a name
  (the coach's own words and the game's capitals are no name they typed);
  "I cannot tell you what you bought, because this match's record does not
  hold it" (`ECON_REFUSAL`), and "you bought time" or "you saved your
  ultimate", money words only where they are money; "a 1.48 K/D", "your K/D
  in this match was 1.48", "your grade for the match was 66" and "you went
  31 and 21", the scoreboard as the review itself writes it; "you died 21
  times in 24 rounds", the scoreline's own deaths read as a repeat nobody
  counted; a League death "12 minutes 34 seconds in", as the prompt itself
  writes it; and the counted line quoted, "you got the first kill of the
  round 8 times, rounds 5, 11 and 2 more", read as rounds 8 and 2 (a counted
  line quoted is about the match, never the asked round alone,
  `quotesCounted`). Still unchecked, by the spec's own reach: a claim about
  the round that is not about the player ("the spike was planted at B", "it
  was a clutch"), another kill's killer ("their Viper killed your Sova"), any
  number outside English beyond its digits being one the facts hold
  somewhere, and an echo in German, which capitalises every noun. Still
  dropped: a past sentence with "kept" or "again" in it that no counted line
  says ("you kept your crosshair at head height"), and a general rule naming
  round numbers ("a save in round 2 sets up a full buy in round 3").
  bench:chat's raw rate, its drop rate and the person's read are what
  measure them.
- **The round 3 audit and what changed (Nov 2026, stream B)**. Sixty real
  answers on six of the player's matches, read by six judges. Replayed offline
  over the audit's own raw replies (each context rebuilt through
  `ask-coach.js`, the gates run on `raw` and `rawRetry`): 8 of 60 honest lines
  before, 0 after. The causes and the fixes, each pinned in test:chatgates on
  the dropped sentence and a planted false variant:
  - THE PLAYER's "in 5 of 6 matches" said back as "5 of your last 6 matches"
    was no pair (`fact-gates.js pairWords`, and `chat-prompt.js factsOf` adds
    each pattern's pair); "all 5 of your deaths" was a number tied to nothing
    (`OF_YOUR_NOUN`, `shareOk`: a total of the facts or a counted pair);
    "the last one standing against 2" is held to a round's clutch
    (`CLUTCH_AGAINST_BEFORE`); "worth keeping" is no repeat; "take one more
    shot" in advice, after an "if" too, claims no hits (`SMALL_ADVICE_AFTER`,
    `leadInstruction`); a gun is the round named alone before it
    (`singleRoundBefore`); "of your 21 deaths, 20 went unanswered" is the
    counted pair the other way round (`OF_TOTAL_BEFORE`); "two head hits but
    four body hits" reads the part named right after each number (`hitsOk`);
    "peeked the same angle twice" of a repeek is the label (`repeekTwice`);
    "the part to keep" is no repeat; "you traded a teammate 4 times" is the
    cards' own sum (`factsOf tradedMates`). 4 of your last 6, 19 of your
    deaths, against 3, three Sheriff body hits and a Sheriff in the wrong round
    still drop. Over the audit's 60 replies the number gate's drops went from
    35 to 10 and the count gate's from 21 to 10, the rest read as true drops.
  - THE FALLBACK (`parseReply fallback`, `coach.js chatV2`): when the retry
    fails the gates too, a reply that kept `FALLBACK_KEPT` (3) sentences or
    more is shown, the retry's first and then the first's, every sentence of it
    through every gate. Fewer is the honest line, as before.
  - New gates, after every older one: `template` (the rules' own "when this
    happens, do that"), `aim` ("aim is not the problem" or "can wait" stands
    only where the coach looked: each named round looked at and none a lost
    duel, the asked round when a one round answer names none, else two or
    more deaths, half or more, looked at and none a lost duel), `kit`
    (`ability-facts.js checkText`: a key, an ultimate, an effect
    or an owner the game data contradicts, and `checkState` for a health
    number and a standing past five a side, a standing inside it staying the
    timeline gate's), `mode` (a Deathmatch or Range drill that needs
    teammates, the Range read only with its capital so "within the range of a
    teammate" is a distance, and Team Deathmatch left alone) and `ability-kill` (an enemy ability called the killer where
    Riot's record has that agent's gun).
  - The question's own notes (`questionTopics`, `QUESTION_TOPICS`): aim,
    practice, climbing, the mental side, comms, the economy, ultimates and the
    agent the question names get up to three notes that answer them first,
    whatever cause they are tagged for, a general question two of the band's
    own fundamentals, and then one note of the counted patterns rather than
    three. An aim question retrieves as a lost duel and its cases too. A
    question with none of those words, or outside English, is today's notes.
  - The rules: answer the question asked, a general question needs no round,
    aim from the deaths and the headshot rate (never waved away without the
    looks), no template words, abilities by name never by key, an enemy
    ability as the killer only where the record says, no praise of a traded
    death in a lost round, no orb, health, spike carrier or alive count the
    facts lack, drills the mode allows, the counted line's numbers as given,
    and band lines that differ by more than their words.
  - One death count: the counted line of deaths nobody traded leaves out a
    death as the last one alive (`insights.js diedAlone`) while each card said
    "not traded", so the model counted 14 of 16 where the line said 13 of 15.
    The card now says such a death was the last one alive, and the rules say
    to quote the counted line, which is the one the review page shows (both
    read the review's saved insights).
- **The re-audit of 8.7.7 and what changed (Nov 2026, stream B)**. The same
  84 items asked live after 8.7.7: useful up, refusals 8 to 0, but wrong
  claims up, the trade habit opening 9 of 10 "how do I improve" answers, aim
  answers against the looks, library numbers nobody could check, orphan
  text and product talk. Replayed offline over the 60 raw replies (each
  context rebuilt through `ask-coach.js`): 0 honest lines, the drops below
  each one a judge's wrong claim, and six true "your own average" sentences
  the number gate had dropped now kept. Each pinned in test:chatgates,
  section 15, on the live sentence and a true variant:
  - THE LEVER (`chat-prompt.js leverLine`, `leversOf`, `LEVER_WEIGHTS`): a
    general question (biggest mistake, improve, climb, practise, not aim, no
    agent) from a client that sends a band gets one lever chosen in code from
    this match's counted facts (the mistakes, the early and retake or post
    plant patterns, the grade's "first to die in N of M", the headshot rate
    against the player's own average), weighed by band and, for practice, by
    what can be drilled. Above Gold the trade check leads only when nothing
    else is counted. Near ties (within `LEVER_TIE`, 85%) go by a seed of the
    match and the question's kind. No band, no lever: the prompt is today's.
    On the audit's ten climb questions the lever names trading for 2 (the
    answers had opened on it 9 times), both Silver or below where it is the
    largest count. Not yet measured on live answers.
    **Iron to Gold only since the blind audit of 8.7.8 against 8.7.7**
    (`LEVER_BANDS`, `rulesFor`): at Plat to Diamond and Ascendant and up the
    lever picked one the record did not support and the model invented
    evidence for it, scored worse than 8.7.7 there. Those two bands get no
    LEVER line and 8.7.7's improving rule (`IMPROVING_RULE_877` swapped for
    `IMPROVING_RULE` in the static prefix, so the prefix has two variants),
    every gate and gate rule of 8.7.8 kept. On the 60 audit chat contexts the
    Plat and Asc+ prompts differ from 8.7.7's only in gate lines (the product
    and cross match rules, the aim praise and side and spike sentences, the
    "Said to the player" library lines, the kit block), and Iron, Silver and
    no band equal 8.7.8's byte for byte. The review side's lever is unchanged.
  - `server/services/coherence.js`, shared with the review side:
    `checkOrphans` (a he or she with no agent who could be meant, a person
    noun counting only in the sentence before, a lead in whose promise was
    dropped, "with it up", "those rounds"), run by `gateReply` after the
    gates as gate `orphan`, dropped and never retried; `checkProduct` (the
    next review, the app, Occlara, a page, a setting, Advanced coaching) as
    gate `product`; `checkRoundState` (on attack with no spike down nobody has
    to come to you, on defence with it down the defenders retake, an attacker
    never retakes, a defender never holds the spike; a plant with no time and
    no afterPlant judges nothing) as gate `state`, of the round named, else
    the one asked, else the side the sentence names itself.
  - Aim against the looks (`gateAim`): an `unclear` look is no look that
    calls a death something else (four unclear looks had let "aim is not the
    first thing to fix" stand); the dismissal in other words ("not lost on
    the shot", "mechanics are not what is costing you", "not that you are
    losing duels", "but it is not what cost you"); praise of the aim only at
    or above the player's own headshot average (`AIM_PRAISED`, `facts.aim`);
    and "a fight you should not have taken" where every death the coach could
    tell about was a lost duel (`AVOIDABLE`, "rather than" excepted).
  - The library (`gateLibrary`, `facts.library`): a sentence about other
    matches holds "N of your last M matches" to a pattern's pair and an
    average to the against line's baselines, the rows, the tracker or a
    counted "average is N"; a season, act or episode drops; this match's
    rounds told as a pattern across matches drop. The number gate keeps an
    average the library holds ("against your usual 32"), and THE PLAYER's
    pattern lines and the against line carry the words to say them in.
  - `habit`: "you are taking the first fight" said of the match where the
    player was the first death in under a quarter of the rounds.
  - The kits (`renderSlices`): one block of `ability-facts.js kitBlock`
    lines (`KIT_HEAD`), the player's agent, the agent asked, the asked
    rounds' killers or else the two who killed the player most, four at most,
    the primer's kits only without the module. `gateKit` passes `ultOf`, the
    agent asked about else the asked round's killer, so "his ultimate is a
    single still" in a Cypher answer drops.
  - The rules: no product talk, cross match numbers only as given and no
    season, THE LEVER first with trading at most once, no aim praise the
    numbers deny, the side and the spike before advice about a round.
- **The blind audit of 8.7.8 and what changed (Nov 2026, stream A)**. Shared
  by Ask Coach (`chat-prompt.js gateReply`) and the review (`match-review.js
  parse`, `recordGates` and `seamGates`, every client, English only). Replayed
  offline over the audit's 60 raw replies and its 24 reviews: every sentence
  removed is one a judge flagged or a stock closer, none of the 8.7.7 or 8.7.6
  replies lost a sentence to the new record gate, and five true "practise it
  in your next match rather than in Deathmatch" sentences the mode gate had
  dropped now stay. Each pinned in test:chatgates (the audit's sentence caught,
  a true one kept) and the review's in test:valorantreview.
  - `server/services/record-claims.js`, gate `record`, judging only what the
    record makes certain: a kill of an agent in a named round ("You beat him
    twice, in rounds 14 and 16", a he or a she read as the agent named before
    it) where Riot's feed has the player's kills on others, the player killed
    nobody, or that agent killed the player (never with an enemy Sage or for
    Clove, who can come back, and never without both comps); "X got you in most
    of them" where X made half or fewer of the deaths named, the early ones
    where the sentence says early; "before your team had touched B" of a death
    at B Site, and a death told before or after the plant the other way; in the
    review a round line's side and result too. A sentence of no round is read
    as the round its paragraph named, else the one asked. A kill is read in
    its own clause (`clauseAt`): "You killed their Chamber in round 4, and in
    round 8 Chamber killed you" judges round 4 only, and a kill whose clause
    names no round where another clause does judges nothing.
  - TEAM STAT BLAME: where the player died before the plant in half or more of
    a side's planted rounds (three at least; dead before it by Riot's plant
    time, else by the early pattern's "before any plant" rounds, code counted),
    the match's COUNTED block carries "Alive at the plant: of the 9 defence
    rounds they planted in, you died before the plant in 5 of those 9, rounds
    1, 5, 6, 7 and 8, ..." (`plantLines`, its numbers harvested so the count
    gate knows them), and a sentence blaming the player for that record (the
    mistake, the lever, what held them back, "you won 0 of 9", "your
    retakes") goes. "Your team won 0 of 9", advice for a retake, and a sentence
    saying when the player was alive stay. The review gets the gate, not the
    line: its rounds hold no plant time, so only the early pattern decides.
  - SEAMS (`coherence.js repairSeams`): a swing fact glued on with its capital
    ("even as You died", "both sides: You lost", "and You died") is written
    you, and a sentence a cut left ending on a conjunction, an article or a
    comma goes (gate `seam`). The orphan pass also drops "Then it flipped
    fast:" with the opening cut (`then`, never a step of advice such as
    "Then take one piece of space", `THEN_STEP`), "If nobody can see that angle" with
    the angle's sentence cut and no kept sentence before naming one (`that`),
    a bare list item ("Round 14, 14 s in, to a Marshal.", `item`), and the lead
    ins "Here's the round in order." and "Look at when those deaths came."; and
    what leaned on a sentence the record or orphan pass dropped goes with it
    (`leanPass`, run again).
  - DEATHMATCH DRILLS: the mode gate reads "a second person" and "anyone could
    follow / help / trade" as teammates, and the record gate drops an agent
    taken into Deathmatch (abilities are off there) and an enemy of the
    match's comp in a Deathmatch drill, or fought in the Range ("learn her
    Alarmbot by playing Killjoy in the Range" stays). A drill sent away from
    the mode ("in your next match rather than in Deathmatch") stays.
  - SAMENESS (`coherence.js fillerOf`, gate `filler`): "the other things can
    wait" ended 28 of 60 answers. A sentence that is only the stock closer
    ("The rest can wait.", "Everything else can wait.", "The other patterns
    can wait.", "Your other counted habits can wait.") goes, a clause of it is
    cut ("That is the lever, and the other things can wait." is "That is the
    lever."), "nothing else needs fixing first" too; what names what waits
    stays, except the trade check since 8.7.9's audit (below). `filler` and
    `seam` are quiet: a first sentence lost that way never asks for the reply
    again.
  - The rules gained a line and the drill line grew (test:chatgates holds them word for word): name
    what can wait (since 8.7.9's audit: never close on what can wait), never
    blame the team's record after the plant where the player died before it,
    never a kill the record does not have, and no agent's kit or matchup
    practised in Deathmatch.
- **The blind audit of 8.7.9 and what changed (Nov 2026, stream B)**. The 84
  items of 8.7.9 judged blind against 8.7.7 and 8.7.8: Plat chat recovered,
  Asc+ chat got worse on real errors, "The trade check can wait" closed 29 of
  60 answers. Replayed offline over the 60 raw replies and the 24 reviews
  (each context rebuilt through `ask-coach.js` with the audit's record
  fields), every new drop a judge's flag, 0 honest lines, and three true
  sentences the killer gate had dropped now kept. Each pinned in
  test:chatgates (section "the blind audit of 8.7.9, stream B") and the
  review's in test:valorantreview, on the live sentence and a true one:
  - THE COSTLIEST DEATHS (`record-claims.js costRank`, `costLine`), from
    Platinum only (chat `input.rankBand`, the review a round 4 client's band):
    the match's deaths ranked in code from Riot's record, a lost round 100
    above any won one, then the numbers the death left (a player down 3, the
    advantage given back to even 2), after the plant 2, untraded 3 (never the
    last one alive), the round's first death 1. The top three go in the
    COUNTED block (chat) or beside SWING AND COUNTS (review) as a finished
    line with the rule: name the costliest first, never a won round's death
    above a lost one's. Gate `priority` (`fact-gates.js gatePriority`): "your
    biggest mistake was the repeek in round 2" of a won round where a lost
    round ranks first goes, and the reply is asked for again.
  - Counts and kit: `gateCounted` ("this match's one counted decision
    mistake" where code counted none, against the lists' lengths),
    `gateOwnAgent` ("against Jett" to a Jett whose enemies had none),
    `gateLethal` (a health number and one hit said to end it, held to the
    primer's best hit of the gun named: a Sheriff body hit does 55, so "at 57
    health any clean hit ends you" goes), `gateTeamUtility` (a dart, a drone,
    a recon or a prowler asked of a team with no agent whose kit has one,
    `UTILITY_OWNERS` from the game data), `gateAbilityKill` in general words
    ("the thing that kills you is her star setup" where every death to that
    agent was a gun), `gateStaleBuy` (the record said not to hold the buy over
    round lines that give it). The TEAMS line says to ask only for the team's
    utility and never to name the player's own agent as an enemy.
  - The record (`record-claims.js`, both surfaces): `checkPostPlant` (advice
    for after the plant, holding or playing the spike, a defuse, "once the
    spike is down", of a death the record has before the plant: Pearl round 3
    in three reviews, Sunset round 1), `checkScore` ("the score was 5 against
    4" of a round whose score was 2 to 0, "the round ended 3 to 13" of round
    2: a score said of a round is its score before or after), and in Ask
    Coach `checkClock` (the attackers put on the clock after their own plant,
    the review's is `match-review.js clockWrong`, stream A).
  - THE CLOSER: the rules no longer ask to name what waits ("End on the last
    real point of the answer. Never close by saying what can wait"), the
    improving rule and THE LEVER say to leave the others out, and
    `coherence.js fillerOf` drops any deferral of the trade check
    (`TRADE_WAIT_WHOLE`, "The trade check can wait here, since your teammate
    was close", a list holding it, "The larger pattern of unanswered deaths
    can wait") and cuts it as a clause after a comma (`TRADE_WAIT_CLAUSE`).
    Another named deferral ("Your Reyna problem can wait") still stays.
  - CUT SENTENCES (`coherence.js checkOrphans`, each only after a dropped
    sentence): `all` ("All three need a star"), `same` ("Same story in round
    7"), `ellipsis` ("The fights you choose are."), `one` ("You will not have
    one, so ..."), and `those` reading "Those came when you had support". And
    the cause of two of them: "Round 4, 17 s in" named round 17 and "in round
    2, 31 s in" round 31 (`match-review.js namedRounds`, `record-claims.js
    ROUND_RUN`), so true sentences fell to the killer and round gates and
    what followed dangled.
  - The verify pass over all 252 audit outputs (8.7.7, 8.7.8, 8.7.9) found
    true sentences the new gates took, and each is kept now and pinned in
    test:chatgates ("7b"): a fall back before the plant told by staying alive
    for it ("staying alive keeps you available for the planted spike", Pearl
    round 6 in three reviews) and "play for the plant" (`checkPostPlant`); a
    sentence telling both phases, "the attackers are on the clock until they
    plant" (`PRE_PLANT`, and `CLOCK_PRE_PLANT` in `clockWrong`); "the final
    score was 13 to 7" after a round (`checkScore`); the enemy's dart or drone
    ("after a dart reveals you") where the enemy comp has one and nothing ties
    it to the player's side (`UTILITY_OURS`); one player's buy said beside the
    team's (`BUY_HELD_SAID`, the very hedge `BUY_HEDGE_RECORD` asks for); and
    a short sentence ending on its verb with a wh word ("Here is what you can
    do.", `ELLIPSIS_WHOLE`). THE COSTLIEST DEATHS line sits on top of the
    match budget (`buildParts` costRoom): on the Corrode and Split Plat+
    prompts it had pushed the match part to level 3, taking the coach's looks
    out of every round line and THE PLAYER's lists to three.
  - Not yet measured on live answers.
- **Its model, its time and its cap are the route's** (above, "Ask Coach v2,
  the route's half"): `AI_CHAT_MODEL` pinned with no weaker model behind it,
  40 s across both calls, and $0.15 a licence a rolling day. The page says
  the cap in the player's language with when it lifts ("You've used today's
  questions. Ask Coach is back at 21:14."), and main waits 50 s for a reply.
- **No games left, no Ask Coach, and no spam (8.7.3).** With `ENFORCE_CAPS=1`
  an account with every game used gets no model on chat or frame chat
  (`coach.js chatLocked`, the read gate's rule): a client from 8.7.3 is
  answered 429 `chat-cap` and the page says `chat.locked` ("You have used all
  your games. Get more games in your Profile or upgrade your plan to ask me
  about your matches.") as a line, never a bubble, with an Open Profile
  button (`go('profile')`, chat-preload); 8.7.2 gets that sentence as its
  reply, older builds one naming occlara.app. Never mid match: main refuses
  the question before it is sent. An account with games is held by the spam
  guard (`server/services/chat-guard.js CHAT_LIMITS`): one question at a time,
  2 s from the last one's start, 5 a minute, and the same question about the
  same match or frame within 30 s is the remembered answer with no model
  call, beside the chat limiter's 25 in 5 minutes and the daily cap. Every
  version, every number and why: accounts.md, "Ask Coach is locked with the
  games" and "Rate limits". `test:caplock` and `test:chatspam` hold them.
- **The one time fill** (`ask-coach.js fill`, `chat-context.js needsFill`,
  `applyRoundRecord`). A review linked before 8.5.0 keeps no kill feed, plant
  time or comps, though Riot's round record has them. Ask Coach opening on it
  asks `/match-rounds` once, `purpose=fill` (the server's fill reserve), for
  the connected Riot ID only, three seconds after this app's last HenrikDev
  request, never mid match, never for a held match and never while the
  backfill or a review's own link is at work, and stores those fields and the
  stamp, nothing else: no regrade, no narrative, no list. An answer that will
  not change stamps it asked and it is never asked again; a 503 asks on the
  next open. A question waits for a fill under way 8 s at most. The fill
  stores the feed by the link's own function (`valorant-verify.js
  killFeedOf`), so a review linked by 8.5.0, which keeps the same fields from
  its link, is never filled.
- **League and frame chat.** A League question gets the computed review alone
  (the scoreline, the grade, the lists, every death by the game's clock),
  never the summoner name. Frame chat sends a linked round's Riot facts
  (`riot`, read by the route's `riotFrameFacts`) and refuses a held match's
  frames.
- **The page** (`src/renderer/chat/`): the chip is the shared dropdown, the
  starters come from the match (its round with a look to walk through, its
  agent, its lost rounds; general ones with none; League's own), a switch
  starts a new thread under a divider, the cap and the hold are lines rather
  than bubbles, and a reply keeps its paragraphs (`white-space: pre-line`),
  set by textContent alone. An answer still on its way when the chip moves
  lands where its typing dots stood, in the thread that asked it, and never
  joins the new thread's conversation: it had landed under the new match's
  divider and gone to the model with that match's next question.

- **The coach shows the player's own clips** (the player's ask: bring up
  their clips "so the player knows what its talking about").
  `src/main/services/ask-coach.js clipsOf` reads which rounds of the asked
  Valorant review have a death clip on disk, the Moments page's own read
  (index.js deps `clips`, over `moments.js build`), and sends their ROUND
  NUMBERS alone as `context.match.clips`: no path, no URL, no file name
  leaves the PC. The server keeps only deaths of the match's own cards
  (`chat-prompt.js normalise`), and the match part of the prompt gains a
  CLIPS block saying those rounds and the marker `[clip:r5]` to end a
  paragraph with, three at most (`renderClips`); with no clips the prompt
  is byte for byte what it was. `server/services/chat-clips.js` takes every
  marker out before any gate reads a word (`extract`: well formed or not, a
  path or a URL in one, a marker inside thinking), keeps a round in the list
  as an ask (three, one a round, in order), ties it to the paragraph it was
  written in (`asksOf`), keeps it only when a sentence of that paragraph
  survives the gates (`parseReply clipAsks`) and the route's passes
  (`place`, by the kept sentence's words, else by place when every paragraph
  stood), and the answer carries `clips: [{ round, para }]` only when there
  is one, never on the honest line. Main plays each from THIS review's own
  clip of that round (`clipsFor`): a round of another match, a clip gone, a
  URL or a path in the answer, a paragraph the reply lacks, none of it shows.
  The page draws a reply with clips as its paragraphs, each set as text, with
  a ghost capsule "Watch round N" under the paragraph; a click makes it the
  review's own clip player (clip-player.js: 1x, 0.5x, 0.25x, the death
  marked), nothing loaded before it and never autoplay. A reply without one
  is the one pre-line bubble it was. Nothing mid match: the question is
  refused before any request, the page is sealed, and a hidden page pauses
  every clip. League has no round clips and is never told any.
  `npm run test:chatclips` holds all of it, the page on a fake clip list.

`npm run test:chatcontext` holds the hold (a held match's counts out of the
patterns too), the map rule and the rounds, a review older than the ten
newest kept as the match, what is never sent, the cards and looks (old cards
read back equal to their fields on the real Abyss), the fill and the refusals
on fakes, and both shapes; `npm run test:chatgates` every gate on its
positives and negatives, each regex on a known positive and negative, the
independent probe's cases above, the prompt's order and budget, the slices,
the retry and the honest line, and the real primer's numbers; `test:surfaces`
the page.

**bench:chat picks the model** (`npm run bench:chat`, spends money, about
$3.80, stopped at `--budget`, $5). Six matches: the repo's Abyss 13 to 11
built offline and filled from its own record, and its Split 13 to 7 (the
player's upgraded review where their library has it, else the repo's 8.0.1
review upgraded offline), their questions in
`scripts/fixtures/chat-questions.json`; and the player's Fracture, Sunset,
Abyss swiftplay and Pearl, theirs in `userData/bench/chat/`, never in the
repo. About thirty questions, each with a key written by hand from
Riot's record (what a right answer states and the claims it must not make),
checked apart from the gates. Every question goes through `ask-coach.js`
itself on a read-only copy of the library, the player's reviews filled as the
fill fills them, kept beside the bench and never saved. The server must send
an admin bench the model's own text (`raw: true` beside the admin password:
`raw`, `rawRetry` when the gates asked again, and `usage`, both calls' prompt,
cached and completion tokens; a licence's own `raw: true` is sent the reply
alone), or the bench stops at its first answer. Even there a sentence carrying
a word of the match's name set is withheld (`coach.js rawForBench`, the
marker `name-gate.js WITHHELD`, which bench:chat counts as a name), since the
bench scores raw replies: the wrong fact rate with its exact 95%
interval, what the gates caught and what slipped past them, drops, retries,
honest lines, names, cost, cached tokens and latency, every bar of 8.13 and
the cheapest model passing them all. The finalist's answers go to a sheet for
a person to read, folded in by `--score <run> --read <read>`. `--dry` sends
nothing, reads no licence or password and writes nothing: it holds every key
to its own samples and every question to the match and round it must land on.
It ran after the server deployed with v2 off. **v2 is the default for 8.5.0
and later since 23 Oct 2026**, after the run of that day, its panel's read and
the two gate fixes it found, with the player's yes (`coach.js chatPromoted`:
`CHAT_PROMPT` unset is v2, `CHAT_PROMPT=v1` turns it off; `AI_CHAT_MODEL`
unset is Sol). test:serverguards holds the default, the switch off, and an
8.4.4 install's Ask Coach byte for byte as today.

**Today's (v1) answer names nobody either** (round 8). Its reply goes a
sentence at a time through `withoutNames`, with the match's name set when the
body names the match (`chatNames`) and a Riot ID's or a handle's shape, in any
language and game, and a reply left empty is the fallback line. Not the
capital rule (`capitals: false`), as in v2, which counts it and never drops on
it: enforced, it took League's "Ahri" and "Dragon", every German noun, and
"RR", "Plat", "Ranked" and "Aim Lab", and served the fallback line for whole
true answers (round 8 review). It is counted for English Valorant replies as
`v1-name-log` in `/api/admin/chat` `logged`; its messages go through `scrubAsked`, so a
typed Riot ID never reaches the model (8.8 review: in any script, as "Jürgen#EUW" or a CJK
name, and with inner spaces, the words before the tag that are capitalised or in the match's
name set, "Big Bob#NA1", up to 16 characters; v2 the same); settings and stat units are no
handle (`name-gate.js GAME_FORM`: 240Hz, 1440p, 1920x1080, 800dpi, 18RR, 80cs, LP, GB); its retry log carries the reply's
length, never its words; and a v2 request that fell back to it is counted
(`fellToV1` in `/api/admin/chat`). Over all 84 round 7 outputs v1's pass
drops no sentence; `test:serverguards` holds a League, a German and two
English Valorant answers whole.

### The round record in Ask Coach (8.8)

A match whose cards carry Riot's buy, the nearest teammate, the death's
callout, the casts or an AFK round gets a `THE ROUND RECORD` line in the
match's part (`chat-prompt.js recordUseLine`), one sentence per kind present,
and none otherwise, so the static rules stay the cache's prefix. The cards
choose notes and cases through `recordSignalsFor` (the asked round alone, or
the whole match), the facts carry `place`, `buy`, `mate`, `casts` and `afk`
into the gates, `gateEconomy` passes the kind of round a card names (an eco,
a full buy) and nothing else about money, and `record-claims.js checkRecord`
drops a sentence the round contradicts. Detail: `riot-record.md`, "Teaching
the coach the round record".

A death in a round Riot says the player sat out (8.8) is in no line or count
of the enemy block (`enemyAskedOf`: it was listed as "nobody traded it" and
counted in "Nobody traded 4 of the 5") and picks no case phase, and an old
review's fill learns the flags (`chat-context.js applyRoundRecord`). The
counted mistake `untraded` keeps every untraded death in one entry, its
close ones told inside it (8.8 review, `grade-breakdown.md`); `leversOf`
still reads a key `untraded-close` as the trade lever, which no client sends.

### The blind audit of round 6, stream B: the inputs (Nov 2026)

What the prompts are given, so the model has less to invent (the gates are stream A's).

- **Why a death cost, in code** (`match-review.js costReasonLine`, both surfaces): THE COSTLIEST
  DEATHS keeps costRank's reasons and adds the team's economy and where the round sat ("round 5
  of the 6 the match had, not its last"), then `COST_RULE`: state only these reasons, a round is
  the last, a pistol round or match point only where the line says so. Fracture's round 5 had
  been "the last round of the match". No total known: record-claims.js `costLine` as before.
- **Only Riot's place in a review round** (`match-review.js placesKept`, `knowledge.js
  placesNamed`, `samePlace`, `placeRegion`): where Riot places the death, a screen read or the
  look's words naming another callout are not sent (an area holding the callout agrees, "Mid"
  and "Mid Plaza"); where it places only the player's kills (`killPlaces`, sent by
  `valorant-review.js requestBody` for a verified death with no Riot place, since round 8 for every
  verified round with a kill Riot places, the region test still only where Riot has no death place), the screen spot and
  reads in no region of a kill go. Pearl R4 and R5, Corrode R10 and R11, Sunset 2 to 5 R6.
- **The enemy asked about** (`chat-prompt.js enemyAskedOf`, byEnemy clients): each round that
  agent killed the player from Riot's record (gun, place, seconds, teammate close or far, traded,
  economy, the look), the counts in the count gate's shape ("1 of the 2"), and the rule to answer
  from it and the kit lines. Cases are picked against that agent alone (`enemyCases`).
- **Aim from Platinum** (`aimFactsOf`, `aimNote`): THE AIM FACTS (headshot rate against the
  player's own average, each fair fight lost on the shot with the look's words, the guns of the
  kills and the deaths, a range the look gives), and the question's notes are the lost duel notes,
  band narrowed first, never the basics (stop before the shot, counter strafe, a core all band
  note) unless a look saw a shot on the move. There is no per band headshot norm in the repo, so
  none is stated. Since round 8 THE AIM FACTS come at every band, with the guns' own lines (see
  "Round 8: usefulness" below); the notes rule above is still Platinum and up only.
- The round record's economy sentence (both prompts) no longer says a pistol or eco death "costs
  little", which Sunset 4 to 13's Killjoy answer repeated.

Tests: `test:chatgates` and `test:valorantreview`, "the blind audit of round 6, stream B".

### The blind audit of round 6, stream A: the gates (Nov 2026)

- **Claims over several rounds** (`record-claims.js checkMulti`): alone, a teammate close, early,
  traded or untraded, said of a list, "those six" of the list the sentence before named, or "your
  deaths" of every death, with a count, all, none or most, goes where the rounds the record leaves
  possible cannot make it true (an unknown round counts for the claim). "Your deaths" with a
  qualifier after it ("to Killjoy", "on defence", "after the plant") is some of them and judges
  nothing (`SUBSET_AFTER`); "in this match" is still every death (`WHOLE_AFTER`).
- **A cheap pistol death** (`checkLowCost`) where the team lost that pistol round, and **the last
  or first round** (`checkOrdinal`) said of a round that was not.
- **The structural pass** (`coherence.js checkStructure`, last in `gateReply`, and
  `match-review.js structureGates` for the summary and focus): a lead right before a cut ("look at
  where those fights happened"), a sentence only referring back to a cut one ("If nobody is,",
  "That post-plant record", "The problem is what happens next."), and a garble ("Your gun is the
  Vandal or Phantom range game"). An instruction is never a lead (`isInstruction`): "check where
  your nearest teammate is" stays, since a lead's wh clause is about what the match showed
  (`LEAD_PAST`).
- Replayed offline over the 286 chat raws of the four audited versions: 16 sentences newly dropped,
  every one false or a lead to a cut, 14 of them in round 6; the six round 6 claims the judges
  called misleading in the three chat answers and all seven chat orphans are caught.

### Round 8: counts over several rounds, and alone said of a teammate close (Nov 2026)

The biggest share of round 7's wrong chat claims were counts over several rounds and distance
contradictions: "Three of those six he was never traded" of Omen's six (Riot: 5), "both times
nobody was close enough to trade you" of two traded deaths, "a couple of those early rounds a
teammate was close and nobody answered" (round 6 alone), "Rounds 2, 7, 10 and 12 all show it"
after an alone claim (round 2 close), "holding the angle alone" and "away from your teammate's
reach" of deaths Riot has a teammate close at, and "The clearest one was round 2", a won and
traded round, where round 5 cost most. The model copied counts it was given, and was given three
that counted "untraded" three ways, so the fix is one counted input and gates that read it.

- **THE TRADES AND THE DISTANCE** (`record-claims.js tradeLedger`, `ledgerLine`, `ledgerBins`):
  one partition of the player's deaths from the rows the gate reads, every count with its rounds:
  traded; nobody traded as the last one alive; nobody traded with a teammate close (a lesson about
  when they took the fight); nobody traded with no teammate close (where they stood); nobody
  traded with no distance; trade unknown; then the distance alone, traded or not. For the match
  and the early deaths (30 s and under, before any plant, `earlyDeathsOf`) in the match's part,
  before ROUNDS (`renderMatch`), and for the agent the question names in THE ENEMY ASKED ABOUT,
  which no longer says "Nobody traded 3 of the 6" (the last one alive left out unsaid). A round
  sat out (8.8) is in none of it. Computed on the server from the cards every client sends, so
  8.7.9 gets it; its numbers are harvested (`factsOf`), its length sits on top of the budget as
  the costliest deaths line does. The review gets the match's and the early lines beside SWING
  AND COUNTS (`match-review.js ledgerOf`, every band, round 4 clients), its pairs quotable
  (`allowedPairs`). No semicolon.
- **The prompt's words.** The plain words rule keeps "a teammate close enough to kill your
  killer" for a habit and says what happened as "no teammate was close" or "nobody traded you",
  never "nobody was close enough to trade you". A round line of a close untraded death says "so
  the fight came before that teammate could swing", a last one alive line no longer adds "with a
  teammate close by". The costliest deaths say "nobody traded it though a teammate was close" or
  "nobody traded it, with no teammate close" (`costRank`). The teammate rule (THE TEAMMATE AT THE
  DEATH) moved above ROUNDS with "a death nobody traded is never proof the player was alone".
  The counted untraded mistake and the cross match pattern render under the honest title "Deaths
  not traded within five seconds", the counted line split by Riot's distance, the last one alive
  apart, a fix per group (`untradedEntry`). The client's title in insights.js is unchanged here (a
  src/ change ships only with a release); its 8.8 title "Deaths nobody traded" with the close
  ones in its detail (one key, `untraded`) is the client half.
- **Three claims told apart** (`MULTI_CLAIMS`): `far` (no teammate close, on your own, holding
  the angle alone, spots where nobody could see, out of a teammate's reach; Riot's distance word
  first, so a traded death Riot has far is far), `couldnt` (nobody close enough to trade, nobody
  could trade or answer; false of a traded death and of one with a teammate close, never the last
  one alive) and `untraded` (also "was never traded", "nobody answered"), with close, early and
  traded. The untraded and traded judges now read the row's own untraded: before they read
  `traded === false`, which a row never holds, so every round was unknown to them.
- **The set a count names** (`resolveSet`, `anaphorSet`): the rounds of the clause; for those,
  these, both times, each time or "a couple of those" the sentence's own list before the words,
  "those early" the early deaths, else the first whose size fits of the list right before, an
  agent's deaths a sentence counted ("Omen killed you six times", `AGENT_KILLS`; "Cypher got you
  twice" is no soft "twice"), the asked agent's and the reply's last list. "And two more you were
  the last one alive" takes those out only where exactly that many are (`LAST_ALIVE_APART`). A
  bare count is exact where nothing in the set is unknown, unless "at least", "more than" or "a
  couple" lead it. Two claims under one quantifier of a named set are judged together (`together`,
  never two that cannot both be). One claim a round (`PER_ROUND`), a list split by counts
  (`SHARE`, "twice with no teammate close and once with one close"), and a sentence that only
  points its rounds at the claim before it (`POINTER`, two kept sentences back in its paragraph)
  are judged too. Advice after the claim (`ADVICE_CUT`, ", so before you swing") is cut off first.
- **Alone said of one death** (`checkAlone`, both surfaces, after `record`): alone, isolated, on
  your own, out of a teammate's reach, where nobody could answer, of a death Riot has a teammate
  close at goes, the reason naming the fact; "nobody could trade you" of a death with a teammate
  close and no trade is rewritten to "nobody traded you" and kept (`{ rewrite }`, logged as
  `record-rewrite`; the review rewrites the line in place), "dying where nobody could trade you"
  of the untraded deaths the same, and either of a traded death goes. The round: named, else the
  paragraph's, else the asked round, else the reply's only round so far. Plans, predictions and
  rules in the present judge nothing; "rather than holding alone" is judged unless the sentence
  states the teammate or the trade itself. Since the 8.8 review: a plan may open on avoid, stop,
  focus, cut, limit, reduce or work on (`PLAN_OPEN`), so "Avoid fights nobody could answer." is no
  longer rewritten to a past tense; alone in a sentence that names the teammate close itself ("took
  the duel alone, when a teammate was close enough to trade you and nobody did", `MATE_COULD_SAID`)
  is kept; and "nobody traded" with only the advice's "instead of taking the peek alone" (a peek or
  a swing, `SWING_ALONE`, never a place held, `HELD_ALONE`) is kept. The round 8 replay's two false
  drops, Fracture Plat round 5 and Sunset Iron round 6. A trade with no distance known proves nothing here: only
  a teammate close makes alone certainly false. A list right after an alone claim and a habit (no
  round, three deaths nobody traded at least, close in as many as far) are judged too.
- **The clearest one** (`checkClearest`): "the clearest one was round N" after a sentence about
  what cost the player, from Platinum, where round N was won and the costliest death lost.
- **THE COACH'S EARLIER WORDS through the gates** (`chat-prompt.js earlierFilter`, at prompt time,
  since a saved review keeps its build's words): a round line the record makes false is left out,
  a summary or focus sentence alone, a rewrite used; the asked round's earlier line the same.
- **Retrieval** (`knowledge.js recordSignals` `ruledOut`, `ISOLATION_LESSON`): where the deaths
  nobody traded had a teammate close and none far, 'isolated' is ruled out, and no case for that
  cause or teaching an isolation lesson by its words is served (`cases.js scored`, Ask Coach and
  the review), nor an isolation note in Ask Coach (`pickNotes`). Fracture no longer gets k110.
- **Proof.** Replayed over all 84 round 7 outputs (60 chat served and raw, 24 reviews): every
  count and distance claim of the judges' list is caught (the Split raw "twice with no teammate
  close" too, though in the reply a timeline gate drops it first), plus Pearl Iron's "both times
  nobody close enough to answer" the judges missed. Every newly dropped sentence is listed with why it is wrong in the
  round 8 stage report; the true ones dropped are only those leaning on a dropped one
  (`leans`, `orphan`). Tests: test:chatgates "round 8, counts and contradictions".

### Round 8: the timeline and the state (Nov 2026)

Seven round 7 claims were true of another moment or another number. Each reader is in
`record-claims.js` (both READERS lists, so Ask Coach and the review's round lines and summary),
judges only what Riot's record makes certainly false, and is proven on its audit sentence and a
true variant in test:chatgates "round 8, the timeline and the state".

- **The plant phase** (`checkPlantPhase`, `PLANT_DURING`): "as your teammate plants", "while your
  team was planting", "mid plant", "during the plant" of a death Riot has after the plant (Fracture
  5 to 1 Iron round 5) or more than 4.5 s before it (planting takes 4 s). The review line now says
  Riot's plant second and the death's side of it, and drops the screen's "while ally plants" read.
- **The enemy by its side** (`checkEnemyRole`): "make the attacker expose themselves" to an attacker
  (Corrode 3 to 13 Asc+ round 1): the noun a verb acts on, or one coming at "you", in one round of
  known side. The player's own side named as theirs ("as the attacker") is not read, nor a role
  noun after the other half is named (`OTHER_HALF`, "next half on defence, make the attackers
  come to you", 8.8 review).
- **The first contact** (`checkFirst`): "you were the first contact / the first one into" a death
  with a teammate already down (Pearl 1 to 5 rounds 3 and 4, 4 against 5), or a first fight word
  where the enemy had lost one and Riot gives the first kill to someone else (`row.firstKill`).
- **What the death left, in words** (`checkLeftWords`): "your death left four players ... a man
  down" of a death 4 against 5 (it left 3 against 5, two down). A death told between goes unjudged.
  Not folded into `fact-gates.js standingClaims`, so `gateLeftAcross` does not hold it across two
  sentences.
- **A gap held to its anchor** (`checkLater`, Ask Coach only: it needs the feed's second, `row.deathAt`
  and `row.ownKills` from `feedTimes`): "the spike landed at B. Six seconds later you were dead"
  where the death came 1.5 s after the plant (Sunset 2 to 5 Iron round 2). The anchor is the event
  the gap names, else the last plant or own kill told in the sentence or the kept one before it;
  1 s of tolerance. The prompt now writes the computed gaps into the death's own feed entry ("27 s
  in (1.5 s after the plant, 6.4 s after your last kill, ...)"), the plant to the tenth, with a rule
  line on gaps (`VALORANT_RULES`); the sentence apart is kept only where the feed has no death.
- **The kill's place** (`checkKillPlace`, `placesOf().canonOf`): "after the first kill at A Alley"
  where Riot has the kill at A Elbow and the death at A Alley (Sunset 4 to 13 round 7, Plat, and
  Silver, which the judges missed). Only a kill certainly the player's ("your", "you got", or the
  first kill where Riot gives it to the player); a bare site of the kill's side passes. The
  article is no site (8.8 review, `articleNotSite`, `placeMatch`): "a site retake", "a main
  angle" and "holding a site alone" read as the A side under the 'i' flag; a place opening on a,
  b or c and a space is a callout only with its capital, here, in `checkRecord` and in
  `death-forensics.js`.
- **The example held to the cost rank** (`checkClearest`, widened): "the plainest / most costly /
  most obvious one" with the cost said before, and `COST_MOST`, "the one that cost you the most was
  round N", which needs no cost sentence before. The Fracture Plat improve answer was already caught.
- **The standing in the prompt** (`cardLine`): "4 against 5 standing as you died (you counted), not
  the first death: 1 teammate already down, leaving 3 against 5".

**Proof.** All 84 round 7 outputs (60 chats through `gateReply`, 24 reviews through `checkRows` with
the kill places Riot has, as the round 8 client sends them): the seven target claims are caught plus
the Silver Sunset round 7 kill place, and nothing else drops.

### Round 8: what the game itself makes certain (Nov 2026)

`server/services/game-claims.js`, pure, English only, asserted both ways in `test:gameclaims`
and `test:chatgates`. Four gates run after every gate before (`GATES`, last four):

- **`oneshot`** (`gateOneShot`, `checkOneShot`): a one hit kill of a named part of one named gun,
  held to Heavy Armor from full health, simulated hit by hit with the primer's own absorption
  (100 health, Heavy Armor 50 at 0.66). Chat reads the primer's `hits` entries for the match's
  patch, the review the game data. "The Outlaw's one-shot body at any range" goes (140 body, Heavy
  Armor takes 2); the Operator body, the Vandal head, a sentence naming its armour ("against no
  armour or Light Armor"), a negation and one naming no part judge nothing. "At any range" judges
  every band, "long range" the last, else the closest.
- **`move-fire`** (`gateMoveFire`, `checkMoveFire`): "bursting and moving", "shoot while
  strafing", "run and gun", "burst, move, burst". Passes moving between bursts, a negation before,
  a shotgun, and the habit named as the error ("and missed", "stop instead"), and since the 8.8
  review the habit diagnosed: a past lead ("you were", "lost", `MOVE_FIRE_PAST`) or a cost in the
  sentence ("inaccurate", "everywhere", "wide", "counter-strafe", `MOVE_FIRE_COST`). "Try shooting
  while moving" still goes.
- **`bullets`** (gate `kit`, `checkBullets`): "Contingency is just a smoke, bullets go through
  it", held to `server/data/kit-rules.json`. The other direction, "High Tide blocks bullets", goes
  by the kit gate itself (`ability-facts.js` `CLAIM_VERBS.bullets`, judged only of an ability the
  kit rules list with `bullets: false`). Since the 8.8 review a name is found as a whole word,
  longest first ("Cove" was found inside "Dark Cover" and "Cover"), a negation right before a
  claim flips it ("will not stop bullets", "cannot block bullets", "is not just a smoke"), and the
  sentence goes only when no claim in its clip agrees with the kit rules.
- **`unseen`** (`gateUnseen`, `checkUnobserved`): where the player's crosshair sat or what the
  player saw, said as fact ("your crosshair sat too deep toward the wall"). Passes a hypothetical,
  a place ("where you saw him"), the minimap, and a look whose WHAT (never its better play, which
  is advice) speaks of the crosshair or of seeing, for the round the sentence names or the asked
  round, else any look of the match.

**Deathmatch and the Range, past one sentence.** `gateMode` now reads the sentence with its
disclaimer taken out (`stripDisclaimer`: "where there are no teammates", "Deathmatch has no
teammates"), so "practise in Deathmatch, where there are no teammates: ask whether a teammate
could trade you" goes; the wider absence words (`NO_TEAM_SAID`: "do not practise trades there")
apply only where a disclaimer was taken out, so nothing the old gate dropped passes. `TEAM_WORDS`
is the shared one of `game-claims.js`, "backs you up" added. `gateReply` then runs
`soloDrillFrame` after the record pass: a sentence naming the mode opens a frame to the end of its
paragraph or to a sentence that moves the drill to a match (`MATCH_FRAME`, since the 8.8 review
with "in the match", "once the match starts" and "in game"), and a team rule inside
it goes as gate `mode` ("play Deathmatch ... Before every engagement, ask whether you have an
escape or a teammate nearby"). The review reads the same frame across its summary and focus.

**The prompt.** THE AIM FACTS ask for "where the crosshair should wait next time" and say no look
states where it was unless a look line does; COACHING NOTES says each note is a rule for a kind of
situation, not a record of this match. Not yet benched (`bench:chat` at Plat and Asc is the check).

**Proof.** All 84 round 7 outputs replayed with the round 8 gates live and stubbed (60 chats
through `gateReply` on the raw reply, 24 reviews through `claimGates`): exactly the four target
sentences drop (Split Silver aim's teammate nearby, Corrode Plat aim's crosshair, Pearl Iron aim's
bursting and moving, Sunset Iron's Outlaw), nothing else and no lean or orphan after them. Over the
earlier rounds' outputs the checks find only the after1 failures the judges flagged (the review's
"Burst, move, burst, move", two Deathmatch team drills).

### Round 8: usefulness, aim as aim and the two weakest numbers (Nov 2026)

Round 7's aim answers turned into a trading lecture at every band, the answers below Platinum were
generic, and the Plat and Asc improve answers were one trade template. Every piece below is in
`chat-prompt.js` unless named, and each is asserted in test:chatgates, "round 8, usefulness".

- **An aim question is aim** (`questionTopics`): with aim asked, climbing is no topic of it ("get
  better", "my rank" read as climbing and general), and it is general only where practice is asked
  too. So no climbing notes, no band fundamentals and no three counted trade notes.
- **No trade or spacing note in an aim answer** (`AIM_TEAM_NOTE`, `pickNotes`): the counted
  pattern notes must be about the shot (`AIM_TOPIC.note`), and a note about trades, teammates,
  solo fights or crossfires is left out of the retrieved fill and the final list.
- **THE AIM FACTS at every band** (`aimFactsOf(m, aim, { band, primer })`), a client that sends no
  band gets none as before. New: a line per gun (`gunLineOf`) for the two guns the player killed
  with most and the one that killed them most, against Heavy Armor, the hits by band from the chat
  facts' own primer entries (the match's patch), so "past 20 m one head hit no longer kills" is
  finished in code; a gun the primer gives no hits for has no line. Below Platinum the ask is one
  basic of the shot (the stop before the first bullet stays the basic there); from Platinum the
  fine point, as before. Every band: the drill is the shot's in the Range or Deathmatch (crosshair
  placement, counter strafing below Platinum or where a look saw a shot on the move, the first
  bullet, spray control, bursts at range), and position or trading once at most, after the habit,
  only for a round line that shows it. Notes tagged for those guns (`note.weapons`) now serve an
  aim answer, two at most, after the question's own three.
- **Five aim drill notes** (`playbook.json`, topics ending in "drill"): Range bots set to strafe,
  a one rifle Deathmatch with the crosshair parked at head height, burst by range in Deathmatch,
  spray control at a Range wall, the first bullet off an angle. Real tools only. The shooting error
  graph note stays: the setting is real (Video, Stats, Shooting Error).
- **The rules**: the aim rule answers about the shot first and mentions position or trading once at
  most ("nobody able to trade, name that first" is gone); `IMPROVING_RULE` and THE LEVER say leave
  trading out unless the lever is trading (no "as a second point"); the plain words rule says the
  trade (a teammate killed your killer) and the distance (near or far) apart, never "close enough to
  kill or trade". `IMPROVING_RULE_877` and `LEVER_BANDS` are as e9726e0 left them.
- **The aim focus pass** (`gateReply`, gate `focus`, quiet): in an aim answer the first sentence
  about trading or a teammate's distance (`TRADE_SENT`) is kept and every later one goes, unless it
  also teaches the shot (`tradeOnly`). `parseReply` retries where those sentences were over half of
  what the reply said (`FOCUS_SHARE`).
- **A drill of "that" after a team habit** (`game-claims.js pronounDrill`, gate `mode`): "Practise
  that in Deathmatch, where you have no teammates" right after a team habit goes, the disclaimer
  notwithstanding. Its case is spelled, no 'i' flag (8.8 review), as in `MODE_AWAY`: "the range
  you died from" is a distance, not the Range.
- **THE TWO WEAKEST NUMBERS from Platinum** (`weakTwoOf`, `weakTwoLine`, `WEAK_WEIGHTS`): for an
  improve, climb or biggest mistake question (never aim, practice or an agent), the two weakest
  measured numbers ranked in code, one a family: a number against the player's own average, a grade
  category under 75, the advantage given back with its rounds, the first death rate from a fifth of
  the rounds, the spike records under half, the untraded count, the trade weighed lowest. Each a
  finished line in words the number gate ties (`K/D in this match was`). This is not the lever that
  e9726e0 took away above Gold: it names numbers, never a kind for the model to find evidence for.
  Corrode Plat gets the advantage given back in rounds 7, 9 and 14 and K/D 1.08 against 1.92; Split
  Asc K/D and headshot rate; Fracture Decisions 50 and headshot rate. The lead check
  (`weakLeadOf`): an answer whose first two kept sentences say the untraded count and neither weak
  number is retried (`WEAK_LEAD_REASON`). Not yet benched at Plat and Asc.
- **"where you were the first contact"** (`record-claims.js FIRST_CONTACT`, kind `first`, and
  `fact-gates.js FIRST_DEATH` for one round): held to Riot's first death, read even inside a plan.
- The number gate reads "from 20 to 50 m" as the band it names, and a clause's own band first
  (`bandNamed`, `hitsOk`), so the gun lines said back are kept and a wrong one still goes.

**Iron and Bronze.** Round 7's Iron correctness fell on summaries the gates let through ("a couple
of those", "both times", "all show it", "holding the angle alone", "three of those six", "first
contact"); the ledger and the multi round gates of the earlier round 8 stages drop all of them on
the replay, and the "second point" invitation that produced the Sunset practice one is gone.

**Proof.** All 84 round 7 outputs replayed against the tree before this stage: no review changes;
in the chats the focus pass drops three sentences (Split Asc aim's second and third trade sentences,
Sunset Silver aim's "more of your kills come with a teammate nearby"), one orphan follows ("If
nobody is,"), and the lead check retries the three improve and biggest answers that open on the
untraded count (Split Asc both, Corrode Plat biggest). Nothing else changes.

### Round 8: each round's clause, the asked agent's he, a connective after a cut (Nov 2026)

From the Pearl Silver Cypher answer and the Fracture Ascendant aim answer of round 7:

- **Each round's claims in its own clause** (`fact-gates.js scopeOf`, `ROUND_MENTION`, in
  `gateStanding` and `gateEconomy`): in a sentence naming two rounds or more, a round's scope runs
  from its mention to the next, the text before the first mention shared by all. "In round 3 you
  died 13 s in at B Screen to his Phantom, and in round 5, the pistol round, you died 9 s in at Mid
  Doors to his Classic." is no pistol claim about round 3, and the three true sentences that went
  after it stay. A list ("rounds 3 and 5", "round 3 and round 5 you ...", a mention with only a
  joining word after it) holds its claim to every round of it, and a mention with nothing after it
  ("and so was round 3") reads the sentence whole. One mention, or none, reads whole as before.
  Replayed over round 7, five sentences kept that went before, each checked true against Riot's
  record (Pearl Iron and Silver, Fracture Plat, Sunset 2 to 5 Iron, Sunset 4 to 13 Silver).
- **A he or a she the asked agent can be is no lean** (`chat-prompt.js leansHere`, in the first
  lean loop of `gateReply` and in `leanPass`): a sentence that leans only by its opening he, his,
  him (she, her) stays after a cut when an agent the question names can be that pronoun
  (`coherence.js MALE`, `FEMALE`, or neither list). "His Trapwire tethers you" kept, asked about
  Cypher; dropped asked about Reyna or with nobody asked. A lean by time, by a trade or by that,
  this or it is a lean as before.
- **A connective after a cut** (`coherence.js repairConnective`, last in `gateReply`, the review's
  `structureGates` too): "So", "Thus", "Hence", "Therefore", "As a result" and "Because of that"
  leading a clause, at the head of what is shown or right after a dropped sentence, are struck and
  the clause capitalised: "So the fix is not a new sensitivity or a longer warmup." with its lead
  cut by the name gate is served "The fix is not a new sensitivity or a longer warmup." "So far",
  "so much", "so many", "so long", "so often" and "so that" are no connective. "That is why",
  "This means", "Which is how" right after a cut go as orphans. The first gate that repairs rather
  than drops, and only this. Nothing is touched where nothing was cut before it.

Tests: `test:chatgates` ("ROUND 8: THE THIN REVIEW STAGE"), each regex on a positive and a negative.

### The blind audit of round 8, stream C: six wrong claims as classes (Nov 2026)

Six wrong claims a blind audit of 84 answers of the live 8.8.0 server found, each fixed as a class
in code, on both surfaces where the class reaches both. Tests: `test:chatgates` ("the blind audit
of round 8, stream C") and `test:valorantreview` (the same title), each on the audit's sentence and
a true one.

- **The death's place is Riot's** (`record-claims.js checkDeathPlace`, reader `place`, both
  surfaces): a sentence about the player's death that puts the player at another callout than
  Riot's (not an area holding it, not a kill place of the round) is kept with Riot's callout in
  its place (`{ rewrite }`, logged `record-rewrite`). Corrode Iron round 10, "at Mid Stairs" for
  Riot's Mid Bottom. Only where "you" is the clause's subject before the place with no agent,
  pronoun, teammate or kill between, one place said, and Riot's place a callout, never a bare
  site word. The input too (`chat-prompt.js lookPlaceFix`, a prompt change): a look's WHAT
  naming one other place says Riot's, naming more is not sent, as the review's `placesKept`.
- **A look's finding only of a round it looked at** (`fact-gates.js gateLabelAcross`,
  `LOOK_SEEN`, gate `label`): "Both were fair fights the look called lost on the shot" after a
  sentence telling rounds 3 and 5 is held to both, and round 3 had no look (Pearl Iron, Cypher);
  "the coach looked at round 3" of a round with no look drops. "lost on the shot" is a lost
  duel label word now.
- **Utility the team lacks** (`fact-gates.js teamUtilityFix`): "a teammate's flash or drone" to
  a team with no drone is "a teammate's flash", in Ask Coach (`utility-rewrite`) and in the review
  (`match-review.js utilityGates`, the Pearl Plat round 3 and focus). The review learns the team
  from `context.teamAgents` (sent by `valorant-review.js requestBody` from this release) or, for
  a client before it, the five of its own "Your team had no controller:" line (`teamOf`).
- **How many deaths the coach looked at** (`fact-gates.js gateLookCount`, gate `looks`, last):
  "The coach looked at one of your deaths" where it looked at all 3 (Fracture Asc and Plat aim),
  and the looked at total of "1 of the 2 deaths the coach looked at", held to the deaths with a
  look, unclear looks counted or not.
- **Kills against deaths** (`record-claims.js checkKillsDeaths`, reader `kd`, both surfaces):
  "so you died more than you killed" at 17 and 16 (Split Asc improve) is cut off its sentence
  where it is a clause after a comma, else the sentence goes. Never under a negation or a plan.
- **A count and the rounds it lists** (`record-claims.js checkCountList`, reader `countlist`,
  both surfaces): "5 of your 5 deaths ... in rounds 1, 3, 4 and 5" is written with the counted
  line's rounds 1, 3, 4, 5 and 6 (Pearl Asc review), and a count whose list cannot agree with a
  counted line goes ("9 of your 11 deaths went unanswered, leaving nobody to kill your killer in
  rounds 2, 7, 8 and 9", the re-audit's Corrode Plat summary, is gone too). Deaths and rounds
  only (a kill or a trade may come twice in a round), never a list with "and 3 more" or
  "including", a range read as its rounds, a list in a clause of its own left alone.

Replayed offline over all 84 round 8 outputs: the six targets fixed, plus the same classes in
Fracture Plat aim (looked at one) and the Corrode Iron review's round 10 ("flash or drone" to
Clove, Iso, Skye, Veto, Waylay), and nothing else changes.

#### Its review (Nov 2026)

A review of the stream C diff reproduced 15 wrong keeps and drops; each is fixed and tested in
`test:chatgates` ("the review of stream C") and `test:valorantreview` ("the review of stream C,
in the review"):

- `checkDeathPlace` judges a place only right after the death's own verb with nothing of the
  killer's between ("killed you while holding X", "the Phoenix who killed you was in X" are the
  killer's), or after a subject "you" (never "killed you") with no earlier position ("started
  the round at", "spent 20 seconds in") and no later movement after it. A sentence that names
  Riot's place anywhere judges nothing. New heads: a place as the verb's object ("you peeked X",
  "pushed X", "walked up X") and "your round 10 death came at X".
- `lookPlaceFix` swaps only the player's own place ("you" as subject, no enemy subject between,
  never after "from" or "to"), and a WHAT naming Riot's place is sent as written, never withheld.
- `teamUtilityFix` cuts a list only where it is asked of the player's team (a teammate's, your,
  ask for, wait for, from a teammate) and no enemy or "their" owns it; else the sentence drops
  as before. Lists with articles ("flash or a drone"), "/" and "recon dart" are read, and
  `UTILITY_ASKED` knows "ask a teammate for a drone" and "a teammate to drone".
- `checkKillsDeaths` needs the player as subject and skips a half, a side, a gun, another
  match, pistol or eco rounds; more phrasings ("deaths outnumbered your kills", "went
  negative", "dying more than you were killing") both ways.
- `checkCountList`: the list must follow a comma, a colon, a bracket or "in", "during", "on"
  (never "starting in", "from", "after", "before", "by" round N, nor "round 7 on"); one round
  listed judges nothing; a counted line rewrites a list only where it counts the same kind of
  thing (`countKinds`: untraded, early, alone and so on); "every one of your 5" counts five;
  "all 5 of your deaths", R1, R3 lists, number words (`foldRounds`) and a list before the count
  (`LIST_BEFORE`) are read. The last newly drops the re-audit's Sunset Iron summary sentence "In
  rounds 1, 3, 5 and 6, 12 of your 13 deaths went unanswered", twelve deaths told as four rounds.
- `gateLookCount` skips a part of the deaths ("that ended in lost duels", "on defence", "to
  Sova", a word before "deaths") and reads the passive and noun forms ("was looked at by the
  coach", "got a look from the coach", "had a look at", "the coach's look covered"). Run on
  reviews too since the open gaps pass below.
- `LOOK_SEEN`: a bare "the coach" says what a look found only by its look verbs (saw, called,
  looked at, reviewed round N), or by found, says or reads with a look's own words in the clause
  (`LOOK_WORDS`), so "the coach found that Cypher killed you twice" is the record's fact.
  `gateLabelAcross` also holds a look or coach that says it of "both" or "them" as its object
  (`LOOK_ANAPHOR`).

#### The open gaps of stream C (Nov 2026)

Two gaps the review of stream C left, closed with deterministic gates:

- **A list with no count told as the whole set** (`record-claims.js checkWholeList`, reader
  `wholelist` right after `countlist`). "Your early deaths came in rounds 1, 3, 4 and 5", "the
  rounds where you died early were ...", "the deaths nobody traded were ...": a list after "your"
  or "the" deaths of one kind (early, before any plant, untraded, traded, opening) and a verb is
  the whole set. Where the match has that set (`wholeSets`: a counted line whose list is as long
  as its count, the first death line, or Riot's rows when they are every round of the final score
  and every death's trade is known), a list that is a strict subset of it is written as the set.
  A list with a round outside the set judges nothing. Never touched: "two of", "the worst of"
  (`WHOLE_PART_BEFORE`), "including", "among others", "and 2 more", a further "and round 1", a part
  after it ("on defence", "to Cypher", `WHOLE_PART_AFTER`), a list in its own clause, one round.
  Since the review of this reader (a rewrite that makes a true sentence false is worse than a
  miss): only a list that **ends its clause** is rewritten (`WHOLE_CLEAN_TAIL`: the end of the
  sentence, or ", so", ", which", ", each", ", and each" and the like), so "then again in rounds 15
  and 18", "and 2 other rounds", "for instance", "too", "mostly", "this half", "before the switch",
  ", both lost", "among four" are never touched; a negated or limited head ("Not all of", "Even",
  "Only", `WHOLE_NOT_BEFORE`, or a not earlier in the sentence) judges nothing. The audited claim's
  rephrasings are read too: "occurred", "showed up", "took place", a colon ("Your early deaths:
  rounds ..."), "Each of your", "Every early death came in" (`WHOLE_EVERY`) and "Rounds 1, 3, 4 and
  5 were your early deaths" (`WHOLE_REVERSED`), in Ask Coach and in the review alike.
- **The look count on reviews** (`match-review.js lookGates`, after `utilityGates`). Every client
  already sends an unclear look as `cause: 'unclear'`; `normalise` still makes it `cause: null` and
  now also sets `unclearLook: true` on that round (left out on every other round, so nothing else
  changes). `lookFacts` builds the gate's facts: a look on each death with a cause or an unclear
  look, and the scoreline's deaths. `gateLookCount` then holds a review's count as it holds Ask
  Coach's, with the unclear looks or without them. A round line goes whole, a summary or focus
  sentence alone. A review with no look judges nothing. No client change was needed. Since its
  review: a sentence scoped to a part the gate's subset readers do not know (`LOOK_SCOPE_REVIEW`:
  "this round", "here", "in R2", "before" or "after", "deaths you took" or "lost") judges nothing,
  and in a round line "one death" without "of your" or "of the" is that round's own death
  (`LOOK_ONE_DEATH`, `LOOK_OF_ALL`); "the coach looked at one of your deaths" there still goes.

Tests: `test:chatgates` ("The open gap" in the stream C review block) and `test:valorantreview`
("the open gaps of stream C, in the review"). The offline replay of the 84 round 8 outputs is
unchanged by both (no output used either form), and all six of the blind audit's wrong claims stay
gated. Known false drops left, outside these gates: `checkMulti` drops "Two of your early deaths
came in rounds 1 and 3" (it reads "two" as the count of early deaths), an older summary count pass
drops "The coach looked at 3 of your 5 deaths", and `gateNumbers` drops "one head hit kills" of the
Vandal where the facts carry no damage line.

### The coach bench: no match, no record (Nov 2026)

72 moments from public VOD reviews asked with no match attached (the playbook side is in
`playbook.md`, "The coach bench"). Three answers cited a record that did not exist ("The record
for that round has you dying on site"), read by a player as Occlara claiming to have seen the
match, and about a third opened with a paragraph on what the coach could not see.

- **The rules with no match** (`chat-prompt.js rulesFor`, `noMatch`): a Valorant question with no
  match gets `NO_RECORD_HEDGE` in place of `BUY_HEDGE` (there is no record at all, take the round
  and the buy as the player tells them, never say what a record holds) and the save line without
  its "say first that the record does not hold" (`NO_RECORD_SAVE`). A match with a buy keeps
  `BUY_HEDGE_RECORD`, one without keeps the rules word for word. A second static prefix variant.
- **`NO_MATCH`** says there is no record, round line or look, the player's account is the only
  one, answer in the first sentence, say at most once in a few words that it goes by their
  description, never say a record shows or holds anything.
- **Gate `no-record`** (`fact-gates.js gateNoRecord`, `NO_RECORD_SAID`, right after `product`):
  with `facts.noMatch`, English only, a sentence saying a record (Riot's, the match's, the
  round's) has, shows, holds, lacks or says anything, or citing one ("in the record"), goes and
  the reply is asked for again. "I don't have the record of that match" and "there is no record"
  stay; with a match the gate judges nothing.
- **Two rules in `VALORANT_RULES`** (and `SPEC_RULES`): a buy question names first which round it
  is (pistol, after a won pistol, the team's full buy, a team save with a bank for two buys, an
  eco) and the save rule answers a save question only; a question naming an ability is answered
  with how to use that ability first, the principle second.

Tests: `test:chatgates`, "the coach bench, no match and no record". Not benched (`bench:chat`).
The "rounds 1 to 24" budget check measures against `DYNAMIC_MAX_CHARS` while `buildParts` allows
the cost and ledger lines on top (`costRoom`), so it sits about 15 to 25 characters under the bar
with the notes' jitter: a longer note in that prompt fails it, as the first wording of the rifle
note did (40 of 300 draws).

### The coach bench: the notes for the round the player describes (Nov 2026)

Asked cold, the bench's moments tell their agent, map, side, gun and round ("I was on Jett on Sunset,
defense, round three ... with the Outlaw"), and `pickNotes` read none of it. With no match there was no
agent, map, side or gun, so every agent and weapon note and every side note of `retrieve()` was out,
the player's own agent was read as an enemy named (its notes' text mentions scored, "Count enemy ults,
a Jett with knives" in every Jett answer), and the 16 notes written for the bench's gaps reached 6 of
the 34 questions they were written for.

- **`askedSituation(input, messages)`** (`chat-prompt.js`, beside `questionTopics`): with no match and
  in English only, the player's account read as `{ agent, map, side, phase, round, flags, guns, topics,
  retake, abilities, abilitiesAsked, mates, inQuestion }`. The agent is the one after "I was on", "as",
  "playing" (`OWN_AGENT_BEFORE`), the map one after "on" or "in", the side the first of defense or attack
  said (a retake alone is defence), the phase `buy` when the question sentence asks a buy (`ASK_BUY`;
  "should I have saved" is the gun, not the buy), `postplant` for a plant, a retake or a defuse unless
  "not planted", else `active`. The round type (`flags`, `knowledge.js ASKED_FLAGS`): pistol, a won
  pistol (`antieco` in round 2, `winstreak` in 3), a lost pistol, an eco the enemy is on (`antieco`, an
  enemy word within 30 characters before it, `ENEMY_BEFORE`) or the player's own or a team save
  (`eco`), a full buy, a force or half buy. Guns are the player's only after "with", "bought", "had"
  and the like and never after "one with" or "into" (`OWN_GUN_BEFORE`, `NOT_OWN_GUN`); teammates are the
  agents after "our" or "my" (`mates`). `SIT_TOPICS` names the rest, each with the account's words and a
  note's: low HP, the enemy's pattern across rounds, holding an angle still, a rich player, the numbers
  up, who to play beside, the peek. Abilities are the agent's kit as the data names them or as players
  say them (`ABILITY_SAID`: dash, bird, slows, satchel, teleport, flash). **Whose words they are**
  (the review of this reader, each a reproduced wrong note set): the enemy as subject or owner right
  before a word (`ENEMY_SUBJECT`, `byEnemy`, `mentionsOf`) turns it around. "Their defense" is the
  player's attack and "their attack" the defence ("attacked" and "defended" count too); "they won the
  pistol" is the player's lost pistol and "they lost pistol" a won one; "they were defusing" or "they
  retook" is no retake and an attacker's side; "they full buy" is no full buy; "their team was saving"
  is no team save but `antieco` (`ENEMY_SAVE`, and `TEAM_SAVE` refuses "their team"). "Won the eco" is
  a past round, not this round's eco (`PAST_ECO_BEFORE`), and round three after "won round two" or
  "won the eco" is no lost pistol save (`WON_ROUND_TWO`). A force is the buy, never the verb ("forced
  me off my angle", `FORCE_BUY`'s lookahead). A gun is never the player's after "killed me with",
  "died to ... with", "by a" or an agent who holds it ("a Jett with an Operator", `ENEMY_GUN_BEFORE`,
  `AGENT_GUN_BETWEEN`, `enemyGun`). A bare "as" names the player's agent only outside a clause ("As
  Chamber, what", "as Sova on Bind"), never "I pushed as Omen smoked the door" (`BARE_AS_BEFORE`,
  `BARE_AS_AFTER`). Tests: `test:chatgates`, "THE KILLER'S GUN" to "A BARE AS". **No account of a round** (no
  agent, side, phase, round type, gun or topic, "What's the best agent on Abyss right now?") is null,
  and so is every question with a match: a match's own facts are exact.
- **In `pickNotes`**: the agent and map stand in for the match's; the player's agent is no agent asked
  about unless the question sentence names it, and a teammate never an enemy; the guns join `aimGuns`,
  so their notes take the two gun slots; each note scores `SIT_HIT` (3) for every part of the account it
  answers (`situationHits`: a round type, a buy note in a buy question, a retake, a topic, the gun, the
  ability used, the ability asked again; no ability in a buy question, where it is what was bought), and
  `fitsSituation` leaves out another side's note, a buy note outside a buy question, another phase's
  note in a buy or post plant question, and a note for another round type. From Platinum the aim
  question's duel rule (`aimNote`) does not drop a note on the ability the question asks about. The
  context for `retrieve()` takes the side, the phase, the round, the first gun as `playerWeapon` and the
  round type as `asked` flags, in place of the eco words' stand in credits.
- **In `casesFor`**: the agent, the map, the side, the post plant (`retake` on defence) and the round
  types a case names, so k201 reaches the Chamber buy question; a case still needs its second anchor.

Measured (the replay is in the bench's research folder, `retr/`): of the 34 gap questions, 6 had the
intended note before and 34 after, on each of 20 jitter seeds; `bench:chat --dry`'s 29 questions keep
their notes and cases byte for byte. Tests: `test:chatgates`, "the coach bench, the notes for the round
the player describes" (every new regex both ways, and twelve bench questions served their note). Not
benched: the bench and `bench:chat` are the next step.

### The coach bench 9: the economy out of scope, the pistol premise, the map habit (Nov 2026)

Bench 9 (72 moments, judged blind, 8.8.1 code) left 7% weaker or wrong. Per topic (same, partial or
sound over all): positioning 14 of 17 (82%), map control 7 of 9 (78%), every other topic 100% (aim 3,
entry and trade 3 and comms 1 too few to judge). Its wrong facts were small: "the enemy is on their
smallest loss pay" after two straight losses, "the Marshal's one-shot body hit at any range", an
invented Haven habit and two invented won pistols. **The owner's rule after it: the coach does not
coach the economy** (loss pay, buys, saves, credits, who buys what), since it could not be told right
consistently, and any topic under 88% is fixed at its cause or dropped. What changed:

- **The economy is out of scope** (`chat-prompt.js outOfScope`, `ECON_QUESTION`, `ECONOMY_OUT`): a
  Valorant question in English whose question sentence asks whether or what to buy, save or force, how
  much to spend, credits, the loss bonus or the economy ("should I buy up in round 3?", "Should I have
  saved my gun in round 4?") is answered with `ECONOMY_OUT` by `coach.js chatV2`, no model call, no cap
  spent, `outOfScope: 'economy'` in the answer. "Is pushing my own smoke a good eco play?" and "should I
  save my ult" are in scope. The rules' save and buy question lines gave way to `ECONOMY_RULE`, and the
  question topic `economy` is gone; `noteInScope` keeps every note that teaches the economy
  (`game-claims.js economyClaim`, 84 of the corpus) and every case whose words do out of the prompt.
  Gate `economy-scope` (`fact-gates.js gateEconomyScope`, after every gate before) drops a sentence
  with an economy claim or economy advice whatever it says; a round's kind as the situation ("on an
  eco", "against an eco or half buy"), money words that are no money ("your flash buys you the close
  fight", "the seconds you buy", "cannot afford to be seen", `BUY_FOR`, `BUY_SUBJECT`,
  `BUY_TIME_BEFORE`, `AFFORD_TO`, `ROUND_KIND_LABEL`), the record's own team buy of the round named, and
  a sentence saying the record does not hold a buy (`ECON_REFUSAL`, what follows its "but" still read)
  stay. Replayed over the bench's 657 answer sentences: 33 dropped, every one money advice or a money
  claim, 25 of them in the questions now out of scope. The review, frame
  chat, v1 and answers outside English followed (below, "The economy out of scope everywhere").
- **The one shot beside a second gun** (`game-claims.js checkOneShot`, `GUN_BEFORE_CLAIM`): with two
  guns named the claim's own is the one right before it ("a Spectre ... the Marshal's one-shot body
  hit at any range" had judged nothing). The loss pay claim needed no gate of its own: it is economy.
- **A pistol result nobody had** (gate `premise`, `game-claims.js checkPistolPremise`,
  `chat-prompt.js pistolKnown`, `facts.pistol`): Riot's pistol round for the asked round's half where a
  match is attached, else the player's own words (`pistolSaid`: "we lost pistol", "they lost the
  pistol" is a won one). "After winning a pistol round" to "We lost pistol on C" goes, and "the round
  after a won pistol" where nobody said one; a general rule ("when you win a pistol round") and a
  hypothetical stay. And the cause of the first: the note "After you win the pistol round, treat the
  next round ..." was served to a lost pistol; a note written for the other result is no longer served
  (`notePistolConflict`).
- **No habit of the whole map as fact** (gate `map-habit`, `game-claims.js checkMapHabit`, and
  `MAP_HABIT_RULE` in the rules): "on Haven, C is the site a five-stack with no lurks reaches last",
  "most teams usually hit B" go; advice ("C is the site you should rotate to first") and this enemy's
  own habit stay.
- **Map control and positioning** (`docs/claude/playbook.md`, "The coach bench 9"): FD8OFhwHF5M-3 had
  the right note ("expect the other site next round") and leaned B, the site that held, since "the
  other site" read as the other one from the player; it now says a different site, not the one that
  held. Three notes added (the late half planned on the habits seen, Chamber commits on a read, set up
  from the enemy pattern), the hand written "patterns repeat" note says it is about a hit that won, a
  question topic `read` (patterns, earlier rounds, "changed our setup", "where should I have set up")
  and the `pattern` situation words now reach them. WCgnalZDT_A-4 (pushing your own smoke) still has no
  note, as the bench's retrieval pass decided.
- **WCgnalZDT_A-5 cut to two sentences**: offline, the eco read its first answer leaned on ("they are
  on a bonus, so ...") is an economy claim with a round named and no record, which the economy gate
  drops; the retry then took its premise from the won pistol note. Both causes are closed above.

The `sunset-r5-premise` slip was the bench's key, not the product: the answer corrected the premise and
its last sentence was about the next round ("despite winning round 5, the next round was the turning
point: you died before the plant"). The key's regex in the player's `userData/bench/chat/questions.json`
no longer reads a death across "the next round" or another round's number, with that sentence and
"After round 5, in round 6 you died" as negatives (`bench:chat --dry` holds it).

Estimated offline, not measured: with the right note served and the false claims gated, four of the five
weaker or wrong map control and positioning answers have their cause closed, which would put positioning
at 16 of 17 and map control at 9 of 9 if the model follows; a live rerun of the bench measures it.
Tests: `test:gameclaims` section 9 and `test:chatgates`, "the coach bench 9".

### The coach bench 10: refrag after the plant, own smoke timing, and five small wrong facts (Nov 2026)

Bench 10 (the 72 moments rerun on 8.9.3, judged blind) put every topic at or above the owner's 88% bar
but post-plant, 7 of 8 (87.5%). Each weaker answer and each new wrong fact, its cause and its fix:

- **_BagmBAjtsc-3** (post-plant, weaker): the swarms were right, but "if a teammate is fighting deep on
  site, let them take that fight" sent the player away from the coach's point, refrag the teammates
  fighting deep. No note said it, and the served "sentinel post plant" note ("worth more than a risky
  peek") and "low health after the plant" ("never take an even fight") leaned the other way. A note was
  added (`playbook.md`, "The coach bench 10") and the situation topic `refrag` (`SIT_TOPICS`: teammates
  fought, fighting or took fights deep or on site) serves it.
- **WCgnalZDT_A-4** (positioning, weaker twice): "never push your own smoke" against the coach's "it
  works with a short wait and a pillar spot". A note gives the conditions, the situation topic `ownsmoke`
  (the question asks about pushing into or through my or our own smoke) serves it, and `PLAY_RULE` in the
  static rules says a play the notes give conditions for is never called always wrong.
- **A Sheriff head hit at any range** (mhInXPZdTHs-5): `ONE_SHOT` never read a gun between the article and
  the hit ("a Sheriff or a Marshal head hit kills you"), and the enemy's "they are on an eco" read as the
  victim's armour. `game-claims.js ONE_SHOT_GUN` holds every gun the claim names to its bands (the
  Sheriff's head takes two past 30 m through Heavy Armor), an enemy's eco (`ENEMY_ECO`) is no armour of a
  "kills you" claim, and a claim with its own distance in metres (`RANGE_STATED`) is the number gate's.
- **The clock before the plant** (x6HlAE0wHRA-1, gate `clock`, `game-claims.js checkClockBeforePlant`):
  "let the clock and the spike force the defence to show themselves" goes where the sentence says before
  the plant, or where the player's account is an attack with no plant (`facts.said`); after the plant, on
  defence, negated or hypothetical it stays. `PLAY_RULE` says it too.
- **A rifle forgiving a moving first bullet** (Klgi_mbrwP8-1): `MOVE_FIRE` reads firing while moving
  told as the play, and this said a moving shot is forgiven. `MOVE_ACCURATE` in `checkMoveFire` drops a
  shot on the move said to be forgiven, accurate or fine; a negation before it and a shotgun named pass.
- **The spike down nobody said** (bNC4PU5AwEA-3, gate `spike-premise`, `checkSpikePremise`): "late in a
  lost A take, so the spike was down" of an account with no plant goes, a hypothetical and a negation
  stay; `MAP_HABIT_RULE`'s premise line now names the spike. **The orphaned it**: "It chases the first
  enemy it sees" stayed after the sentence naming the Boom Bot went, since `leansOn`'s verb list for it,
  this and that had no "chases". `fact-gates.js LEANS_IT_VERB` reads any present tense verb of its own
  after them ("That changes everything" too), and never "This angle" or "That Jett".
- **The bird blamed on where she looked** (BfumSarDJKw-3): the note was served, and its "because it only
  blinds players looking at it" was the reason the answer gave for the full blind. The note now says a
  bird popped short gives a short blind.

`facts.said` (`chat-prompt.js factsOf`) is `{ side, planted }` from `askedSituation` with no match,
planted false where the account names no plant, retake or defuse; null with a match. Tests:
`test:chatgates`, "the coach bench 10" (every new regex both ways, the three notes served), and
`test:gameclaims`, "the coach bench 10". Not benched live.

### The economy out of scope everywhere the coach speaks (Nov 2026)

The bench 9 rule (above) reached every other place the coach talks:

- **Every coaching language** (`chat-prompt.js outOfScope`, `ECON_WORDS`): a question in a language
  of `languages.js` other than English is read from a word list of its own, money words always (the
  economy, credits, the loss bonus, a buy verb, force or full buy) and a save verb only where the
  sentence names no ult or ability ("Soll ich meine Ult sparen?" is in scope); its question sentences
  only (a "?" or a full width one), else the whole message, as in English. A round named by its kind
  ("eine Eco-Runde") is no economy question. The English `ECON_QUESTION` reads every language too,
  since players type the jargon ("Should I force buy here?" with Portuguese set). Japanese and Korean
  stems are read anywhere (no spaces); Korean's ult word is `궁(?!금)`, since 궁금 is "curious". The
  scope line is said in the player's language (`economyOut`, `ECONOMY_OUT_LANG`, English for a code
  it has none for), in v2 too. Each language has its positives and negatives in `test:chatgates`.
  The economy gate over a reply stays English, as every v2 gate.
- **Ask Coach v1 and frame chat** (`coach.js economyScopeLine`, `economyGateReply`): an economy
  question is answered `{ reply: <scope line>, outOfScope: 'economy' }` after the lock and the spam
  guard and before the daily cap, no model call, counted as `outOfScope` in `/api/admin/chat`; a
  reply loses each economy sentence (`chat-prompt.js economyDrop`, gate `economy-scope` sentence by
  sentence), English Valorant only, v1's counted as `dropped.economy`. v1's prompt no longer offers
  "what to buy" or "keep economy discipline", has the economy rule, and its fallback line asks about
  utility, not the economy.
- **v2's round record line** (`chat-prompt.js recordUseLine`): `RECORD_USE.buy` ("the team economy
  changes what a death teaches ... teach the full buy deaths first"), left by bench 9, is no longer
  said, and the held line names the casts only (`RECORD_USE.heldCasts`); a card's buy stays its label.
- **The review**: `docs/claude/match-to-review.md`, "The economy is out of scope in the review".
- **The bench keys**: `abyss-econ-r4` (`scripts/fixtures/chat-questions.json`) and `pearl-econ-r4`
  (the player's `userData/bench/chat/questions.json`) expect the scope line ("coach the economy")
  in place of "the record does not hold what was bought", so `bench:chat` scores the decline as a pass.

Tests: `test:chatgates` ("the economy out of scope everywhere the coach speaks"; the old "Valorant in
English only" check now expects an English economy question with German set to be out of scope, and
the two round record checks expect no economy line),
`test:reviewroute` (v1 and frame chat through the route).
