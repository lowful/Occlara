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
- **Its model, its time and its cap are the route's** (above, "Ask Coach v2,
  the route's half"): `AI_CHAT_MODEL` pinned with no weaker model behind it,
  40 s across both calls, and $0.15 a licence a rolling day. The page says
  the cap in the player's language with when it lifts ("You've used today's
  questions. Ask Coach is back at 21:14."), and main waits 50 s for a reply.
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
It runs after the server deploys with v2 off; on a pass `AI_CHAT_MODEL` and
`CHAT_PROMPT=v2` are set on Railway, and unsetting `CHAT_PROMPT` rolls it back.
