# The coach's look at a death

Moved out of CLAUDE.md word for word, nothing reworded or dropped (CLAUDE.md as of commit cc1f880, 8.5.0, lines 627 to 1008). Sections here: "The coach's look at a death". It is a part of the section "Nothing reaches the screen during a match, in any game". "Above" and "below" in the text name sections that may now sit in another file under docs/claude/: grep the section's title there to find it. The table in CLAUDE.md says which file to read for which work.

### The coach's look at a death

For the four most teachable verified deaths (`teachableDeaths`: a lost round, a
first death, an untraded one, a death with the team ahead; spread across the
match), the client sends frames of each, each with its seconds from Riot's death
(below), and `/api/coach/death-forensics` returns ONE cause from a closed
list (`CAUSES`, mirrored in `src/shared/death-causes.js`; `test:forensics` keeps
the two in step), what happened, and the better play.

**When Riot's death was on the wall clock** (8.3.1, `death-frames.js
barrierDrop`, `deathMoment`). Every frame of a round that shows the round clock
says when its barriers dropped to within a second (the HUD shows the seconds
left rounded down: a frame reading S left was taken 99 - S to 100 - S seconds
in), and the drop is where those spans meet, buy timers (45 s or less) and
frames after the plant left out, a misread outvoted, two agreeing groups (two
rounds' frames filed under one) no answer. Riot's death is the drop plus
Riot's own milliseconds (`withRiotTimes`: reconcile keeps the second alone),
after the plant too, by the clock before it (Riot's `plantMs`; a post plant
death without it is not timed), and only inside the round's own frames. The
rule before read one frame's clock against Riot's rounded second, and on the
real Sunset match no look saw its fight: round 2's frames, a post plant death,
both came after it, and round 6's "after" frame 0.12 s before it, alive. Now
its four deaths land within 0.6 s of where their clips show them, the real
Split match's within half a second of its buy timers, and the Abyss looks
within 1.5 s of the rule before (`test:clips`, on
`valorant-session-sunset-swiftplay.json`, the match's AI log through
`make-session-fixture.js`; Riot's record of it is not in the repo). The read
frames are then the last one at least 0.3 s before the death and the first one
past it, any phase, `frameAt` beside them; a round with no clocked frame keeps
the rule before.

**The look sees the recording** (8.3.1, `index.js forensicsFor`,
`look-stills.js`, `clip-frames.js`, `windows/frames-window.js`,
`renderer/frames`). The clip of each death is cut first, and the look is sent
stills of it (`clips.LOOK_AT`): Riot's at 3, 1.5, 0.7 and 0.3 s before the death
and 0.7 s after (the fight on screen from 0.7 s before on the Sunset match's
clips, then KILLED BY and the combat report; past about 1 s after, the player's
own map, black, a teammate), the screen's at 4.5, 3, 2 and 1 s before its read
of the death and that moment, since the screen read it 0.7 to 2.7 s late. Each
is decoded in a page nobody sees with WebCodecs on the clip's own H.264, the
frame on screen at that second, 1280x720 JPEG at the read's quality: measured
on the real round 3 clip, 101 frames decoded in 116 ms preferring the GPU and
599 in software, every still the frame ffmpeg decodes at that index, where a
`<video>` seeked in the same hidden window took 6.3 s for six and its
`requestVideoFrameCallback` fired on three. Never while a match is in progress
(`afterMatch`: the look waits for it, an hour at most), the page opened for the
look and closed after it, the stills kept beside the review as
`r<n>-rec<k>-before.jpg`/`-after.jpg` with `frameAt` and `framesFrom:
'recording'`. Only stills leave the PC. Sent with the last before the death and
the first after it ahead of the rest (`sendOrder`; with none after it, the last
two before it in time order, since a screen look's last still, at its read,
lands a frame early as often as not), so a server from before keeps those two,
and deploys first; the server takes up to five a death with their seconds,
sorts them, and its prompt names each one's second from Riot's death second
(from the screen, from its read of the death), the frames after it as the
death screen, and the screen's spot as giving way to the place the frames
print (round 6's was a round earlier's). A body with no `frameAt` gets two
frames and the words it always did. A death with no clip (not recorded, Off)
is sent the read frames, timed as above, and so is a Riot look with no
`moment` of its own (`clips.stillsMomentOf`): its stills would be called
seconds from Riot's death, good to a few tenths, around a moment the rule
before puts two seconds and more out. Its card keeps up to five frames in
time order with `frameAt` and `framesFrom` (`valorant-review.js lookFrames`),
which the page labels them by: cut to two, a recorded look showed 3 and 1.5 s
before the death and lost the fight and the death screen.

- **A cause is a label so it can be counted.** "Your most repeated mistake" is
  a count, and a sentence cannot be counted across matches.
- **A lost duel is on the list and is not a mistake**, so the model has an
  honest place for a fair fight instead of inventing a positioning error.
- **Unclear carries no sentences.** On the bench every unclear answer came with
  a sentence about the frame itself.
- Every sentence passes the map gate (a callout from another map), the ability
  gate (another agent's ability, unless its owner is named), the killer gate
  and, since 8.5.0, the name gate (below).
- Without a death moment the frame picker wants a full two seconds of margin
  before Riot's second, because the clock is read to the second and a
  same-second frame showed the combat report instead of the fight.
- **The fixture frames carry the old tip cards over the game**, and the first
  bench had models reading the card back. The prompt says to ignore overlays.
  The model was chosen by `npm run bench:forensics`: GPT 6 Luna said "unclear"
  when the frame did not show the fight, where the others invented a peek.
  Since 8.4.0 it is GPT 6 Sol, benched again on the body 8.3.1+ clients send
  (`--timed`): 1 confident wrong cause in 36 looks against Luna's 7, the R3
  fight in Mid Library found 12 of 13 times against 0, no overlay copied, at
  about $0.03 a match (the table beside `forensicsModel`).

**Two gates every client gets** (8.5.0, `death-forensics.js parse`):

- **No player is named in a look** (`server/services/name-gate.js`). The look
  sees KILLED BY, the kill feed and teammates' cards, and a name it copies is
  saved, shown and handed to the review and Ask Coach. The gate is the
  client's read rule (`valorant-rounds.js namesSomeone`: a capitalised word no
  list of the game's knows is a name) with three changes: each sentence's
  first word is exempt, a word after "teammate" or "ally" counts only when
  capitalised, and the game's words grow (the keys C, Q, E and X, the modes,
  the ranks, the roles, the sides, Riot, Valorant, Occlara). As the client's
  rule stands it called 66 of the 122 look sentences and round lines on record
  names ("Stay" 16, "Hold" 14, "Take" 8); this calls none, and still catches
  "You were killed by Morvane with a Vandal." and "Your teammate Tessik was ahead
  of you." (`scripts/fixtures/look-sentences.json`: the bench's 98 verbatim,
  the library's 24 retyped as equivalents). A Riot ID or a handle's shape (an
  underscore inside a word, letters and digits mixed in four or more that are
  no game form: R5, 4v3, 100hp) counts in any language, first word included,
  "round #12" never; and so does any word of the match's own players, when an
  8.5.0 client sent the match id and the server holds that match's name set
  (`riot-rounds.js nameSetOf`, handed in as `input.names`, which answers
  has(text) and holds nothing it could print). The capital rule is English's
  alone: German writes every noun with one, Polish and Turkish put a case
  ending on an agent's own name; a language code the prompt does not know is
  asked in English (`promptName`), and read as English. A sentence ends at a
  full stop, a question, an exclamation mark or a colon, and never at a
  semicolon, after "vs." or at the colon of "by:" and "to:": split there too,
  the death screen copied as "KILLED BY: Zorbo" made the name a first word,
  exempt. The death screen's and the shop's own words reach the capital rule
  in lower case (`GAME_PHRASES`: COMBAT REPORT, SWITCH PLAYER, SPECTATING,
  Light, Heavy and Regen Armor or Shields, Headshot, the Clutch, Thrifty and
  Flawless banners), since a look reads them off its last frame and "The
  COMBAT REPORT shows you dealt 0 damage." was a name to it; a word of them
  alone, "Report", still is. None of the 122, nor of the 696 sentences the 13
  Oct bench:review wrote, turns on either. The sentence is dropped as one
  naming another map is, logged as "a name", never the name; its plain words
  are the client's, word for word (`test:forensics` holds the two lists
  equal).
- **Isolated is refused on a death Riot records as traded**: the look is
  unclear, with no sentences, logged by round. "Too far from teammates to be
  traded" beside Riot's own trade is the screen's word over Riot's.

**Variant b: the fight judged first, the label last** (8.5.0, an admin bench's
alone until bench A passes, then 8.5.0 and later by `FORENSICS_PROMPT=b`). On
8.4.3, with five recording stills a death, four of Sol's five speaking looks on
the player's Fracture and Pearl swiftplays were "Lost the duel", a fair fight
with nothing to fix, beside a better play saying to fall back after the first
shots: the reply asked for the cause first and the advice after it. Variant b's
reply comes in the order it is decided, `{what, fight, better, change, cause,
alt}`, 400 tokens to a's 320. It judges the fight (`FIGHTS`: right, wrong-spot,
wrong-time, not-needed, unclear) in place of a's "a fair fight from a sound
position is lost-duel", writes the better play (a right fight's is about the
duel, and may say to be ready to step back if the first shots miss), says the
one thing it changes most (`CHANGES`), and only then picks a cause from that
judgement's family: right is lost-duel; wrong-spot is isolated, crossfire,
overextend, exposed or rotating; wrong-time is repeek, dry-peek or rotating;
not-needed is overextend, repeek, exposed or dry-peek. A Duelist's entry with a
teammate close enough to trade is no wrong spot on its own. Code holds it:

- a cause outside its fight's family gives way to `alt`, failing both the look
  is unclear with no sentences, and the conflict is logged by keys alone
  (`[forensics] R5 conflict: fight right, cause repeek, alt none`; a word off
  the lists is "unknown", never the model's word);
- a `change` outside its fight's set is saved as null and the label kept:
  data for Ask Coach and the bench, never the grade;
- isolated on a traded death is unclear, as above; unclear carries no
  sentences; a mistake with no surviving what is unclear, lost-duel excepted.

The look saves `fight`, `change` and `variant` beside its cause (`index.js
askForensics`, the reply's variant where the look names none, and the card
keeps them through `valorant-review.js lookJudgement`, each from its closed
list); one saved with none was asked with a. And it sends Riot's match id
(Riot's look's own, the scoreboard's for the look from the screen), the key to
the match's name set on the server, as Riot's review written again does
(`test:forensics`, `askForensics` run in a sandbox). **No key is added and
none renamed**: b's words widen repeek to "fought again from the same angle
after the first exchange or a kill, by staying on it or by peeking it again"
(`CAUSES_B`; the review keeps quoting
`CAUSES`), so the Fracture swiftplay's rounds 2, 5 and 6, one lesson under three
labels, can count as one: "Repeeks, rounds 2, 5 and 6". The client's words and
fix follow (`death-causes.js`, `insights.js CAUSE_FIX`), true of every repeek
ever saved; the chip and titles stay Repeek and Repeeks, and an 8.4 client draws
nothing new. **Who gets which is the route's** (`coach.js forensicsVariant`, by
the one version gate `clientAtLeast`): a client before 8.5.0 is answered with
today's prompt and parse byte for byte but for the two gates above, held to
the look as 8.4.4 shipped it, frozen in `scripts/fixtures/death-forensics-844.js`
(150 bodies' prompts, 4,740 replies). The module asks with b only when
`input.variant` is 'b'.

**Variant b2: b with the evidence each judgement rests on** (8.5.0, the
default for 8.5.0 and later since 22 Oct 2026; `FORENSICS_PROMPT=a` or `=b`
names another, and a client before 8.5.0 never gets one). Bench A of 15 Oct ran b
five times on 16 of the player's deaths against a key three agent panels
wrote from the stills and Riot's facts, merged 2 of 3 and frozen before the
first run: b held its families (no look contradicted itself) and beat a on
forbidden labels, 5 in 80 against 13, but called Fracture round 6 (a Sheriff
fight opened from the open against a Chamber holding the far end, three
missed shots, no damage) right four runs of five, round 5 (the key's one fair
duel) "stayed on the angle" three of five, and two read frames of round 1 a
lost duel every run. b2 writes the judgement out (`judgementB2`): first a
check that the frames are of this death at all, against Riot's facts (the
frame after the death still alive, the spike down before its plant, another
round's score); then what to read (where the player stood, who held the
angle, health and ammo frame by frame, the damage each side dealt); then the
judgements by that evidence: right is set at the edge of cover with the enemy
coming into the angle, or a meeting with neither set, in one exchange; a held
angle walked into, or a long fight opened from the open with no utility
first, is a dry peek even when the player shot first; a repeek needs an
exchange the frames show ending and the same angle again, and a new place
after a kill is never one. Unclear is asked for empty (`REPLY_B2`). Its
causes, families and parse are b's, and its looks carry b's labels as 'b'
(`LABELS`), the word an 8.5.0 client keeps and a cause's trend is held to;
the reply's own `variant` says b2.

**b2's bench, and why it is the default** (bench A, 22 Oct, five runs of the
same 16 deaths against the same frozen key): forbidden labels 3 in 80 (a 13, b
5), the fair duel a lost duel 5 of 5, unclear wherever the key says 4 of 4 (a
3), the Fracture's rounds 2, 5 and 6 all acceptable in 3 runs of 5 (a and b 0),
no look contradicting itself and no conflict after parse, p90 3.39 s (a 5.03).
It missed three terms narrowly: forbidden by one (round 2 a lost duel twice,
the Abyss round 3 a dry peek once), the Fracture by one run, and the avoidable
bar, 55% where the merged key's union rule set 49% though the three panels'
own keys ran 50 to 62.5%. Better than a on every term, it is the default by
the player's rule, the better prompt overall (`coach.js forensicsVariant`:
`FORENSICS_PROMPT` unset is b2; test:forensics and test:serverguards hold the
default and an 8.4.4 install's look byte for byte as it shipped).

**The phrase lists set no label, in any variant** (`death-forensics.js
PHRASES`; one list in four copies, the client's in `death-causes.js` and Ask
Coach's in `fact-gates.js` and `chat-context.js`, held equal regex for regex):
what a better play says it changes (decision, team, reset and timing, utility,
the player's own abilities by name, aim), each regex held to a phrase it must
catch and one it must not. They cannot tell a hedge from a lesson, so they only log a lost
duel whose better play trips one but aim (`lost-duel better play trips
reset`), keep a saved lost duel's label from Ask Coach when its better play
moves the player (`movesPlayer`), and are Ask Coach's fair fight check. On the
23 lost duels on record (`scripts/fixtures/lost-duel-answers.json`, the bench's
18 verbatim and the library's 5 retyped) they change no label.

**Bench A runs on the live body** (`npm run bench:forensics -- openai/gpt-6-sol
--own --key --variant b --runs 5 --costs`, and `--variant a` as the control;
spends money, about $1.10 a variant, each run stopped at `--budget`, $1.50 by
default, so the two together stop at bench A's $3). Its set is
`userData/bench/looks/set.json`, never the repo, written by `scripts/make-look-set.js`
under Electron: the stills a review kept (Fracture R2, R5, R6, Pearl R1, R4,
R5, R6), the stills a kept clip holds, decoded at `clips.LOOK_AT` through the
app's own frames page (the Sunset swiftplay's R2, R3, R6 and R7, recorded on
8.3.0 before a look took stills, their moments in the clip given with `--at
l7eesy@2=9.2`: an argument shaped `x:2` makes Electron exit unseen), the
read's frames where nothing else was kept (the Abyss swiftplay's R2) and the
Abyss 13 to 11's four from the bench's copy of its session: 16 deaths, 80
looks a variant. Each death goes alone, and each reply is scored RAW, before
parse(), beside the server's parsed look (`scripts/bench-look-score.js`), since
a parse that enforces the families cannot show a contradiction. The server
sends an admin bench each reply's label words raw (`/death-forensics` with
`raw: true` beside the admin password, `look.raw`; a licence's own `raw: true`
is sent nothing), or the bench would stop at its first answer:
`death-forensics.js rawLabels`, the fight, cause, alt and
change as the model wrote them, each its key or "unknown", and whether it
wrote a what, never a sentence or a word off a list, since a name in one would
leave the server; the bench scores them as it would the reply's text
(`test:serverguards` on the route itself). A look
the server failed (its timeout, the provider) is asked once more, and a second
failure stops the run saying so. The key (`key.json` beside the set, from the
`key.template.json` and `key-sheet.html` the script writes, never overwritten)
is written before the bench by people who watched each death: the fight,
whether it was a fair duel, the labels acceptable and forbidden. Pass:
forbidden labels at most 2 in 80;
every fair duel lost-duel in 4 runs of 5; the avoidable share at most the
key's plus 5 points; unclear wherever the key says so; raw self contradictions
at most 5% and conflicts at most 10% of the looks that spoke; the Fracture
three all acceptable in 4 runs of 5; p90 at most 4 s on the five still body.
`--dry` builds every body and sends nothing. `test:forensics` holds the
arithmetic of every bar on a set of its own, and runs the bench end to end on
a profile of its own against a stand in server on 127.0.0.1 that answers with
the real parse and rawLabels: the retry, what each look is sent with, the
ledger's spend, and a run file with no licence and no word off a list.

**A review Riot's record never reached looks too** (8.2). Before, frames
reached a review only through Riot's verified deaths, so a screen only review
showed no picture though the AI log kept its death frames. `screenLook(job)`
in `src/main/index.js` runs the look from the screen once a review: right
after the narrative when no Riot ID is set, else in `linkRiotRecord`'s `done()`
when Riot's rounds never came (the scoreboard never linked, or its rounds kept
failing), always before the frames are released, and never over Riot's look,
which wins whether it lands first or while the screen's is out.

- **Which deaths** (`death-frames.js teachableScreenDeaths`): the screen knows
  no first death and no trade, so a lost round scores 3 and an early death 1
  over a base of 1 that lets a won round be chosen, spread by thirds as Riot's
  are. `looksFor(records, rounds, window, 'screen')` frames each one by
  `framesFor`'s no clock path, the frame that registered the death and the one
  before it, and passes over a death whose registering frame is all its round
  has: that frame shows the player already dead. On the real Abyss ledger that
  is rounds 2, 14, 19 and 22, round 14 in place of round 13.
- **What the server is told** (`source: 'screen'`, which survives `normalise`;
  no source is Riot's, every client before 8.2): the facts were read off the
  screen and may be incomplete, never "Riot's record, exact"; Riot's facts
  arriving beside it are dropped; the frames are framed by when the screen read
  the death, which can be late (if the first frame shows the player dead or
  watching a teammate, unclear); and no killer may be named at all. `parse`
  drops every sentence naming an agent as the killer, in any of its wordings,
  since `wrongKiller` had nothing to check without Riot's killer. Its kill
  words are English, and the look is written in the player's language, so in
  any other language it drops every sentence naming an agent but the player's
  own: "Una Sova te mató" matched none of them. The agent goes
  only once the engine locked it, since 8.4.4 off the player's own HUD (two
  answers on buy phase frames, `lookForAgent`; the player's tick before it),
  the rule every guard keeps, so the ability gate never passes a spectated
  teammate's kit as the player's.
- **It reaches the lists, never the grade.** A cause from the screen is counted
  like any other (`cause:` keys, judged), but Decisions skips it (`grade.js`):
  its frames were chosen by the screen's own timing, and with it a review Riot
  never checked spoke in Survival and Decisions, half the weight: four avoidable
  labels graded the real 31 kill Jett at 58 from the screen alone
  (`test:valorantreview`).
- **A look is inside its own round** (8.3.1, `review.js paintRounds`). The
  review is one list of rounds under the strip: a round the coach looked at is
  a row with its facts once, then on one side the clip from the match's
  recording when there is one (8.3, below) with the frames under it as a
  filmstrip, four to the row at least (with no clip, the two read frames two a
  row and the five stills of a clip since cleared three, where two a row stood
  them 520px tall), and on the other the cause chip marked
  "Coach's look", what happened and the better play, and for a screen look
  "Timed from the coach's read of the screen, not Riot's record." Frames are
  labelled by `frameAt`, their seconds against the death to the tenth, every
  one before it by its own ("3 s before", "1.5 s before", "0.7 s before",
  "0.3 s before", then "Just after" within a second after it; rounded to
  whole seconds, the 1.5 s still read "2 s", and the last second's two both
  read "Just before"), a screen look's against its read of
  the death ("1 s before", the read's own frame "Read as dead"), never "At
  the death": the screen read the player's Sunset deaths 0.7 to 2.7 s late,
  so those frames can show the player already dead. Frames with no `frameAt`
  (a look saved before, the screen's read frames) are labelled by their
  names. A click zooms one; under its clip, where the card says where the
  death falls in it, a click on a still moves the clip to that still's own
  frame and pauses it there instead, the clip at the width a zoomed frame
  takes (8.4.4, "The clip's player" below). Unclear keeps its frames and no
  sentence, and its round's why, marked "Coach's read", is the advice it has.
  A look that speaks takes the why's place for Riot's look only, which is
  sent to the narrative that writes the why, so the two are one account of
  the death. The screen's look lands after the lines are written
  (`screenLook`, after the narrative) and nothing writes them again, so its
  round keeps the why written without it: the look's lines and its timing
  first, then the why, a block of its own under a hairline. A round with
  no look carries its why, and one with nothing to say is one line. The
  coach's raw reads are not shown, and nothing says them hidden: the
  verification line no longer counts the reads Riot contradicts, and a round
  the coach never watched has "no death location and nothing seen on screen",
  never "no coach's read" (`served()` says both in today's words for a review
  saved before). It was a section of its own at the bottom
  ("Where you died, and how"), each look's facts said there a second time,
  with "See where you died" on the round's card: the player's latest review,
  seven rounds with four looks, painted 8,096px and paints 4,071. Each look
  keeps `source` and `at`, when its first frame was captured, and the eye on
  its moment, in its round's line, sends `REVIEW_AILOG(id, at)`: main takes a
  time inside the match's window only, and the AI log opens on the frame
  nearest it.
- **The rest of the page says each thing once** (8.3.1): Riot's four numbers
  sit in the result's card with the player's own average under each (the
  "Against your own average" section repeated them), no scoreboard note before
  the match links (the grade's note and the refusals say it), the grade under
  the result and the lists under the coach's read, a pattern under the strip
  only where no list entry counts it (`SAID`, the post plants' miss included),
  a study note only where the focus does not already say it (`restates`),
  and each death the coach looked at, a miss of its own under "What you
  missed" ("Round 6:" and what the look saw, the better play its fix), as its
  title and its round chip, which jumps to the round saying both sentences
  (`saidInRound`, GradeView's `saidInRound` option, only where the row says
  them). The library and Home draw it whole, and the lists are counted by
  key, so nothing in them changed.
- **Both team comps, one line under the strip** (8.5.0, the player's choice,
  `review.js paintComps`): "Your team: Breach, Jett (you), Killjoy, Omen,
  Sova. Theirs: Cypher, Fade, Reyna, Sage, Viper." It is computed when the
  review is shown (`valorant-review.js served`, `compsLine`), never kept on
  disk, from the review's `comps`, which the link keeps since 8.5.0 and Ask
  Coach's fill keeps on a review saved before: agents the game data knows and
  nothing else, sorted, the player's own marked, set by textContent. A review
  with no comps, or only its own team's, has no line (`test:surfaces`;
  `check:mainwindow` paints it in the real window). Riot's record of each
  death in a line of its own (what was bought, the damage each way) is Phase
  D's.

The frames the review looked at are saved beside it in the library, so the
moment survives the AI log rolling past it, and a version painted after a look
still shows them (`job.frames`). Since 8.3 so is a clip of each moment from the
match's recording, cut before the look is sent (8.3.1) and played above its
frames, under a cap (below, "The match is recorded on the PC"). The AI log keeps every frame
of the last three minutes, every frame around a registered death, the ten
seconds either side of a round change (8.3.1, marked `turn`, which the frame
cap takes before any death's and after a held match's other frames: on the
Sunset swiftplay the read that began round 5 in round 4's buy phase had been
thinned away), one frame
per ten seconds of the rest, and holds a finished match's frames whole until
its review has looked (`holdAiLogFrames`): until released, an hour at most
(`HOLD_MAX_MS`), because a match stopped halfway retries the link for 35
minutes (`match-link.js`) and then Riot's rounds and the look after that.
`test:valorantreview` fails the day
the retries outgrow the hold. `test:forensics` holds the screen prompt, the
killer gate, the timed prompt and its limits (five stills from the recording
by their seconds from Riot's death second or the screen's read, two untimed
from a client before), and the real Split round 15, a buy phase frame read as
the round clock once told "in the second the player died", told its frames'
own seconds; `test:clips` the drop, the moments and the stills' plan,
`check:clips` the stills taken live and held against the clip's own frames,
`test:valorantreview` the picker on the real ledger, `test:surfaces`
the one list, a recording look of four frames, the read frames, a screen look
and the eye at a moment, and `check:matches` paints a kept frame in its round
(`#round-2 .v-moment img`) and opens the AI log at it.
