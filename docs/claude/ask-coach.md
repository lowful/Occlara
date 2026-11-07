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
    ("Trading is the second point and can wait") stays. The rules say to name
    what waits and vary the close. `filler` and `seam` are quiet: a first
    sentence lost that way never asks for the reply again.
  - The rules gained a line and the drill line grew (test:chatgates holds them word for word): name
    what can wait, never blame the team's record after the plant where the
    player died before it, never a kill the record does not have, and no
    agent's kit or matchup practised in Deathmatch. Not yet measured on live
    answers.
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
