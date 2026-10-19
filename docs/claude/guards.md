# Do not simplify the guards

Moved out of CLAUDE.md word for word, nothing reworded or dropped (CLAUDE.md as of commit cc1f880, 8.5.0, lines 2705 to 2884). Sections here: "Do not simplify the guards", "Whose HUD is it". Its part "The agent is read off the player's own HUD" is in agent-hud.md. "Above" and "below" in the text name sections that may now sit in another file under docs/claude/: grep the section's title there to find it. The table in CLAUDE.md says which file to read for which work.

## Do not simplify the guards

`coaching-engine.js` contains deterministic checks that **deliberately override
the model**. Each one exists because of a specific, reproduced failure, and each
one looks like removable defensive cruft until you know the story. They no longer
guard tips; they guard the facts every review is built from. Do not refactor
these away.

- **Map lock with correction** (`applyMapRead`). The model repeatedly insisted
  the player was on Ascent while they were on Breeze. Two agreeing reads
  acquire the lock, two agreeing contradictions correct it. And the labels hold
  it to account short of naming the map: two reads of a printed label the
  locked map does not have release it (`weighLockAgainst`), one only some maps
  have, the locked one among them, clears that doubt, and a model read outside
  the maps the labels leave is refused (`labelCandidates`). On the player's
  Sunset swiftplay Haven, locked on the first two buy phase reads, went back to
  the model as context for three minutes while B Lobby was printed. A map the
  game data does not know (one released after the last `sync:valorant`) is
  never weighed against the labels, which say nothing about it, as the
  server's `labelFitsMap` has it: weighed, every label it printed read as one
  it lacks.
- **Map fingerprint from printed labels** (`applyLocationLabel`,
  `mapFromLabels`). Valorant prints the location name on screen. Accumulated
  labels identify the map far more reliably than the model's guess, and once
  `mapConfirmedByLabels` is true the model can no longer change it.
- **Scoreboard continuity** (`scoreboardChallenge`). One round forward needs two
  agreeing reads like any other jump, a step the model misread on consecutive
  frames is taken back by three reads that carry on from the score before it
  (`lastStep`, never once a buy phase has confirmed it), and a lone digit is
  checked against the held other one rather than merged raw. Scores never move
  backwards, and a forward jump needs two agreeing reads before it is accepted.
  A read with a round number and no scores is no evidence either way (8.3.2):
  it neither takes the place of a step read once with its scores, nor clears
  it, since the round number is the model's inference and printed nowhere. It
  used to, so the step's second read was a first read again
  (`test:scoreguards`).
- **HP beats death.** A death is only registered when health is genuinely
  absent and the tell is unambiguous. The model kept announcing deaths that had
  not happened. The phase "dead" needs the same proof as the alive flag and
  waits for the same second read (it registered on one unchecked frame), and
  the proof knows the death screen, KILLED BY, the COMBAT REPORT and SWITCH
  PLAYER (`DEAD_TELL`), which every real death of the Sunset match read first.
  A dead read in a buy phase is no first read of two. A death on a weak tell,
  none of what the death screen prints, is withdrawn when the very next read,
  in the same round, is the player's own HUD as it stood, the same health and
  the same gun (`judgeTrial`): its frame is filed in the ledger again as no
  death and its AI log record is written with the verdict. A different health
  or gun is the spectated teammate's HUD called "own", and the death stands.
  So does one the spectate guard calls somebody else's HUD (a teammate's kit
  called "own", the kill feed's KILLED BY), and one whose next read came more
  than 15 seconds later (`TRIAL_MS`): after a pause or an outage that read can
  be a later round, its score unread, the player at full health with the same
  rifle bought again. The
  death's 20 second cooldown stands after a withdrawal, even for the death
  screen: on the Abyss swiftplay the withdrawn round 7 death was followed
  eight seconds later by "SWITCH PLAYER" read on the living player, and a
  death screen let past the cooldown filed it again (`test:sessionreplay`).
- **A return from the dead waits for a second read** (8.4.1). Nobody comes
  back mid round but by a revive, and one read saying so is likelier the death
  screen read wrong: on the player's Fracture swiftplay, 34 seconds after round
  6's death, a frame of SWITCH PLAYER, a teammate's portrait and the COMBAT
  REPORT read "own HP 50 and Sheriff". Believed, it was the "coming back from
  spectating" boundary, which switches off every weak signal (the gun gone from
  Ghost to Sheriff among them), the player was alive again, and the next read's
  SWITCH PLAYER registered a second death in the round, which the ledger's one
  death a round refused and the AI log kept. So while a registered death
  stands, an alive read whose round clock carries on the clock at the death
  (within 3 s) is held for one more read: the next such read is believed (a
  revive costs one read, and Riot's record puts it back), a dead or buy read
  starts it again, and a buy read, a score that moved or a clock that does not
  carry on is never held. `judgeTrial` runs first and is untouched. On the
  committed sessions it takes away one duplicate round 10 registration on the
  Abyss unrated, which the ledger had refused already (`test:sessionreplay`).
- **No spike is down while the round clock runs** (8.4.1). After a plant the
  spike icon takes the timer's place, so a read of the live round (phase
  active) whose own round clock still counts, over 45 s or carrying on the
  round clock in play, has its "planted" dropped before the merge, and the
  context never holds it: on the player's Fracture swiftplay round 3 at 0:51
  read "planted at B" off the chat line "spotted the SPIKE in B", the clock
  running on to 0:41 and 0:32, and Riot has no plant. A read held as a return
  from the dead is weighed by the phase it claimed. A plant the context already
  holds stays, and the frame of the plant itself, read post plant with the
  timer's last second on it, plants: it is the only planted read of the
  Split's round 2, which Riot has, at 1:12. Checked against every committed
  session's plants: the same rounds and sites, the Abyss unrated's round 14
  set on its next read, its "active 1:22, planted" having come 7 s before
  Riot's plant, which moves that death's moment 0.4 s (`test:valorantreview`'s
  "R14 5.5 s after" is 5.1). Known exposure: the Fracture round 3 countdown,
  read "postplant 0:00, planted at B Site", still credits round 3 a plant, the
  ledger filing a plant read before the new round's first buy or play into the
  round that ended, and no clock rule tells it from a plant seen only on a
  banner.
- **Spectating** (`isSpectating`, `spectate-tells.js`), below.

The governing principle: **the coach reports what is actually on screen and
never infers.** When code and model disagree, code wins.

### Whose HUD is it

Valorant puts you on a teammate's camera the instant you die, so the health, the
weapon and the abilities in that corner become THEIRS. Every guard reasoning "a
readable health number means alive" is then reading somebody else's health.

A real graded session: the player's first death was rejected twice with "said the
player was dead while they were alive at 100 HP". The frames read `own HP 100 and
Ghost`, then `own HP 100 and Bandit`, then `own HP 19 and **Sova** abilities`,
while the player was Iso. One bug, four consequences: the death never registered,
so `lastDeathAt` was never set, so `isSpectating()` stayed false, so the spectator
merge guard never engaged and a teammate's Ghost, Bandit and Sword were logged as
the player's own weapon.

`src/shared/spectate-tells.js` is the fix. **A HUD that changes whose it is mid
round is spectating, whatever the health says.** One strong signal (a named
spectator screen, or another agent's abilities called "own") or two weak ones (a
weapon change, health rising) decides it. A buy phase and a return from
spectating are boundaries, because `roundNumber` was missing on a third of the
real frames. `server/routes/coach.js` mirrors the vocabulary by hand, since
`check:server` forbids reaching into `src/`, and `npm run test:spectate` asserts
both copies agree on the real frames. `playerUlt` is spectator owned too: after
a death that icon is the teammate's, so the ledger only keeps an ult read taken
while alive, and each frame hands it its own read (`ultRead`), never the one
the context holds over an empty read.

**The SPECTATORS counter is a false friend** (`SPECTATOR_COUNT`,
`countsSpectators`, in both copies). "SPECTATORS 1" at the top right counts who
is watching the player, so it is on a living player's HUD, and on the player's
Sunset swiftplay the model wrote it as "Spectating 1 top right": two deaths
registered in rounds Riot has survived, one of them pushing out round 6's real
one. The counter is no spectator screen and no proof, and a dead read whose
only evidence it is is dropped, not waited on, unless the death screen or
another strong signal (a teammate's kit, the kill feed's KILLED BY) is beside
it.

**Every form of the word reads alike on both copies** (8.4.3). The client
reads "spectat" with no word boundary; the server's copy, between word
boundaries, read "spectating" and "spectator" but not "spectated", which
variant b of the read prompt wrote on four reads of the bench ("belongs to the
spectated teammate"), a spectator screen to the client and none to the server.
It reads the word as the client does now, and `test:spectate` holds a tell of
every form equal on both copies (spectate, spectated, spectates, spectating,
spectator, spectators, b's four verbatim), the counter's forms the counter on
both, and each copy's own list word for word over every tell it holds, so a
word one list reads and the other does not fails it even where the counter
hides the difference. The counter's number follows any form of the word:
"Spectated 1 top right" and "spectated by 1" are the player being watched,
and with the number read only after "spectate", "spectates", "spectating" and
"spectator", both copies took them for a spectator screen and the client's own
guard dropped a living player's 99 and proved a death on one frame
(`test:spectate`, `test:deathhp`). "The spectated teammate" with a number
further on is still the screen. No read the bench or the AI logs kept writes
"spectated" before a number; every one is the dead player's view of a
teammate.

**A death word the tell's own clause negates is no death word** (8.4.3,
`affirms`, in both copies; the engine's `DEAD_TELL` and `DEATH_SCREEN` and the
cadence's are read through it). On the bench of the player's four sessions,
variant b of the read prompt wrote "SWITCH PLAYER not shown", "SWITCH PLAYER
not printed" and "no SWITCH PLAYER or KILLED BY printed", nine reads, eight of
them a living player in a buy phase, and both copies took the words for the
screen. So a death word (spectating, SWITCH PLAYER, KILLED BY, the COMBAT
REPORT, a killcam, a death recap, YOU DIED, TEAM ELIMINATED, observer,
respawn) counts only where its own clause, to a comma, a full stop, a
semicolon or a bar, does not negate it: "no", "not", "without", "never",
"neither" or "nor" right before it, or "not shown", "not printed", "not
visible", "not on screen", "absent", "missing" or "hidden" right after it, at
most two words for what it is ("text", "prompt", "panel") or "is" between; two
joined by "or" or "nor" share one negation. The "no" of "SWITCH PLAYER bottom
left, no own HP" and "KILLED BY Sage, no own health" is the health's, and the
word stands. A tell is weighed word by word, never dropped whole for one
negated word: seven of the nine still print KILLED BY and the COMBAT REPORT,
which stand, and one of them, "KILLED BY PHOENIX and COMBAT REPORT panel
printed, SWITCH PLAYER not visible", is the Abyss match's round 20 death. Over
the bench's ten runs, the AI logs and the committed session fixtures, 6,797
reads with a tell, the rule moves two, both b's on the Split, and replayed
through the real engine every run and AI log registers and files each frame
as it did; the live prompt wrote no such tell. `test:spectate` holds the two
copies equal on the nine and on every committed fixture's tell,
`test:serverguards` the read route, `test:deathhp` the engine's proof, its
trial and the read that judges it, and `test:readpolicy` the cadence.
