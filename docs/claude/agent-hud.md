# The agent is read off the player's own HUD

Moved out of CLAUDE.md word for word, nothing reworded or dropped (CLAUDE.md as of commit cc1f880, 8.5.0, lines 2885 to 3101). Sections here: "The agent is read off the player's own HUD". It is a part of the section "Do not simplify the guards". "Above" and "below" in the text name sections that may now sit in another file under docs/claude/: grep the section's title there to find it. The table in CLAUDE.md says which file to read for which work.

### The agent is read off the player's own HUD

Nothing asks the player which agent they are on (8.4.4, the player's ask).
Until 8.4.3 the engine captured a frame of its own three seconds after Start
and every 30 seconds until detect-agent named one, and the record card asked
"Playing" and the agent with a tick nine seconds in, or for it to be typed with
the player's mains offered. Start is pressed in the menus or in agent select,
so that first frame was usually agent select: on the player's 8.4.0 Fracture
swiftplay it named a teammate's KAY/O, and the player typed Jett by hand. The
abilities on the player's own HUD say the agent during the match, and Riot's
record says exactly which one it was after it. The tour's first page says so
("Just play: nothing asks which agent you are on", `onboarding/index.html`),
where it had kept telling the player to confirm the agent when the sidebar
asked.

So `lookForAgent` (coaching-engine.js) sends detect-agent the player's bar cut
out of a read's OWN frame (below, "The call carries the bar"), once its reply
is applied, and only a frame that surely shows the player's own ability bar
(`ownHudFrame`). It is off for now (below, "And the look is off"):

- **A buy phase**, where nobody spectates. The read saw the player alive with
  their own health number, nothing of the death screen or the spectator camera
  in its tell or its kill feed, and no doubt (the buy phase is where Valorant
  shows the COMBAT REPORT of the round before, KILLED BY ASTRA over Astra's
  face); a buy timer read on the frame from 0:45 down to 0:08, since the round
  end countdown reads like one (0:07 to 0:00 on that Fracture match, the TAB
  scoreboard's ten portraits open over it), begun after the last frame of
  play (`beganAfterPlay`); and the guards left it a buy phase with the player
  alive and no sign of anyone else's HUD (`hudRead`). And its timer is the
  ledger's: the end its own clock gives (its capture time plus its timer)
  within 3 s of the ledger's `buyEndsAt` once the frame is filed
  (`AGENT_BUY_END_MS`), when the ledger has one. The ledger sets that end from
  a buy frame it takes, so one it did not take is a buy read that was not: on
  the bench sessions the Abyss round 19's 0:00 as its barriers dropped, read
  "buy 0:10", a live round at 1:39 read "buy 0:08", each the clock a buy frame
  read seconds before, and the Sunset round 5's post plant read "buy 0:39" off
  the ammo counter, six frames of the 187 the look took (five on the Abyss).
  Each showed the player alive on their own bar, but a reader that reads the
  bar would read a spectated teammate's as well, and a buy read with a misread
  clock while dead would lock the teammate. And never after a death until a
  round has ended (`look.deathRounds`): the score, as the frame printed it or
  as the guards hold it, past the rounds it had when the look saw the player
  die. Dead, the player is on a teammate's camera until the round is over, and
  the ledger takes a buy read there for the next buy phase, the spectator
  camera's frames being no play to it, so that read's own timer sets the very
  end the rule before holds it to: offline, "buy 0:39" read off a spectated
  teammate's ammo counter twenty seconds into the camera, the teammate's HUD
  called own, passed that rule, and so did "buy 0:36" three seconds later, the
  round clock read as a buy timer late in a round and a post plant's camera,
  each pair two answers that lock the teammate. A death seen before its match
  began is the last match's (`beginMatch`, the watch's new match keeping the
  look). On the bench sessions it leaves out five more frames, each the first
  buy frame after a death with no score yet read past the death's, so the look
  takes 176 of the 181, and the app's own sequence on their answers locks what
  it did in all five.
- **A live round, as the fallback**, from round 4 of a match no buy phase
  frame has shown the HUD in (a player who stays in the shop, every buy read a
  LOBBY): its first 20 seconds, the tell claiming the player's own HUD, the
  spectate guard seeing no signal at all, no death in the last 30 seconds, and
  only in a round read as it began (`look.startAt`, `seesRoundBegin`: its
  first seven seconds on its clock, or a buy phase read in the ten seconds
  before its barriers dropped). Start pressed mid match, or a pause lifted,
  finds a round nobody saw begin and a death in it nobody registered: Start
  pressed while dead in round 6's first 20 seconds sent the spectated
  teammate's HUD, read as "own HP 100 and Ghost" on frames no sign flagged,
  and two answers naming the teammate's Sova locked it as the player's. A
  LOBBY is no round beginning, since Start is pressed in Occlara's own window
  and its frames read as one.
- Never a LOBBY (menus, agent select, a loading screen), the end screen or what
  is played after it until the next match shows itself, nor the next match's
  frames while the wait for it counts (`newMatchRun`).

**Two answers that agree lock it**, on two frames at least three seconds apart
with no answer naming another between them: a disagreement keeps looking, the
newer answer the one the next must agree with, and an answer naming no agent is
no evidence either way. A name the game data does not know, or one only near a
real one, locks nothing (`exactAgent`). Locked (`lockAgent`), it is
`agentConfirmed` with `agentSource: 'hud'`: the agent every guard holds the HUD
to (the spectate guard's teammate's kit called "own", the trial of a weak death,
`foreignKit` on the round notes, the screen look's ability gate) and the read's
context, as only a tick's ever was. One call out at a time, off the read path
(no capture of its own, nothing waiting on it, 30 seconds for its answer), three
a round and eight a match at most, none once locked; the look starts again with
every match (`beginMatch`) and drops an answer about the last one, and a match
that resumes after the watch ended it too early gets its own agent back.

**Two calls a match, once it is on.** Replayed through the real engine over the
five committed sessions, detect-agent stood in for and answering in two seconds,
every one locked in round 1's buy phase in two calls, 12 to 16 seconds after the
first frame it sent; with three answers in ten naming no agent and one in seven
the wrong one, two to five calls, every lock right; with every buy read a LOBBY
the fallback locked each in round 4, 5 or 6, in two (the Sunset's in round 6:
its AI log is thinned to a frame every ten seconds, and no frame of round 5 was
read in its first seven seconds). Before, a capture every 30 seconds until an
answer came.

**The call carries the bar, never the frame** (`agent-crop.js`, handed to the
engine by index.js as `cropAgent`, Electron's nativeImage in main). Benched
live on the four Jett sessions with the route's live prompt
(qwen/qwen3.7-flash), the whole frame was read Neon on 86 of its 163 accepted
frames and on 34 of 36 round 1 samples, so the look locked Neon in four
sessions of four. Every one of those frames shows the player's own Jett bar,
its icons about 30 pixels across, and eleven more answers came off the rest of
the frame: an agent named in chat, the killer's panel, a teammate standing in
front. So the look sends x 340 to 940 and y 636 to the foot of the 1280x720
frame, the health number to the ammo count, as fractions (the performance
profile's 854x480 gives the same bar), scaled up three times to 1800x252, a
JPEG of the read's own quality, about 29 KB. A crop that cannot be cut (a
frame that does not decode, a crop or a scale of another size, no encoder)
sends nothing, never the whole frame, and spends no look. No chat line, kill
feed, teammate's card or top bar of portraits leaves the PC for the look.

**And the look is off** (`AGENT_LOOKS_PER_MATCH` 0): nothing is sent and
nothing locks, and the agent waits for Riot's record, as for a player who never
ticked in 8.4.3. The crop was benched live, 198 calls one at a time and two
seconds apart at least, every one a 200, $0.006896 as OpenRouter priced them
($0.0000348 a call, the whole frame's $0.0000487), over five sessions: the four
Jett ones and the player's Pearl swiftplay as Raze, each AI log replayed
through the real engine with the route's answers taken live, and every frame
the look accepts sent once. The bar read the Jett right on 107 of its 157
frames (68%, the whole frame's 37%), Neon on 47, and round 1's twelve 8 Jett
and 4 Neon. The app's own sequence locked Jett on the Abyss (two calls), the
Split and the Sunset (three), but Neon on the Fracture (eight calls, round 4),
and Killjoy on the Pearl in five: not one of the Raze's 24 frames was read as
Raze (Killjoy 18, KAY/O 4, Miks 2). In random orders of each session's frames
two agreeing answers lock the wrong agent 6.7% (Abyss), 15.9% (Split), 10.7%
(Sunset), 53.5% (Fracture) and 99.6% (Pearl) of the time, where the gate was
under 1 in 100. Leaving out the pistol rounds (round 1, and the first round
after the swap) did no better: on the same answers Neon locked on the Split and
the Fracture and Killjoy on the Pearl, 10.4% to 99.8% wrong in random orders,
and with fresh answers KAY/O on the Pearl. On the crops read by eye, thirteen
from all five sessions with the misread ones among them, the four icons are
plain: it is the reader that fails. So the next step is a stronger vision
model pinned for this route (it shares `AI_VISION_MODEL` with frame chat),
which needs a deploy and the same bench over the same crops, and the look
goes back to eight a match only once the app's own sequence locks Riot's agent
or nothing in every session and random orders lock a wrong one under 1 in 100.

**A HUD agent never costs a match its Riot link** (`match-link.js
linkAgentOf`). The live link, the late link and the backfill (`backfill.js
windowOf`, through the ledger, which keeps `agentSource`) see no agent in one
the screen found by itself, as in one never confirmed: it refuses no match and
confirms none either, so a match with no map read still needs one. One the
player confirmed, every review saved before 8.4.4, is checked as it always was.
Riot's agent, once its record is in, is the review's (`game.agent`,
`kitAgentOf`, Riot's look, the narrative), and so is the role the match is
graded on and its baseline row takes (`index.js buildValorantReview`, the
scoreboard's agent or Riot's own line before the screen's: on the HUD's, a
Sova locked where Riot has Jett was graded on an Initiator's curves and its
row was an Initiator's), and the agent the look from the screen is told once
the scoreboard has linked and only Riot's rounds never came (`lookFromScreen`).
A match neither the HUD nor Riot named an agent for says nothing of one. A
match that resumes gets its agent back with its source (`resumeMatch`): back
as a bare confirmed agent, it read to the link as the player's tick.

**A wrong lock is worse than none for the spectate guard**: on the wrong agent
a tell naming the player's real kit reads as a teammate's, a strong signal. So
the route's prompt is the thing to bench. The live one, which every install is
answered with byte for byte, asks for the four ability icons at the bottom
center "just above their HP bar"; on the player's round 1 buy phase as Jett
they sit beside the health number in one bar, their keys under them (C, Q, MB4
and X: the player has E on a mouse button), and every in game frame carries
the ten agent portraits along the top bar. From round 2 a buy phase frame can
carry far more: the cards over teammates, each with its portrait and ability
icons, and the COMBAT REPORT of the round before, KILLED BY ASTRA over Astra's
face, which the read need not mention: round 3 of the Fracture swiftplay at
0:23 was read "own HP 100 and Classic" with all of it on screen, a frame
`ownHudFrame` takes while no agent is locked. Variant
b (`detectPrompt('b')`, `detectVariant`, an admin bench's alone as the read
prompt's variants are, and told back as `variant`) says where the bar is and
what is in it, a key under an icon perhaps rebound, answers from the four icons
and from no face, name or other icons (the teammates' cards named), and says
UNKNOWN for a spectated teammate's bar. It replaces the live prompt only once
a bench over the buy phase frames this client sends has measured both against
Riot's agent.

**And for the stronger reader, variant crop and a bench model** (8.5.0, the
server's half of the next step). Since 8.4.4 the call carries the bar alone,
where b describes a whole screen. Variant crop (`detectPrompt('crop')`, served
as b is, an admin bench's alone) is written for that picture: a crop enlarged
three times, the health number at its left, the four icons with their keys
under them (perhaps rebound, X the ultimate with its pips), the ammo count at
its right, an icon dimmed or carrying charge pips when used or not bought
still its shape, and nothing about faces, cards or panels, none of which is in
it. And an admin bench may name a model from `BENCH_MODELS` on `/detect-agent`
as on every other route, and is told which answered (`model`), so the bench
over the same crops can measure a stronger vision model before one is pinned.
The live prompt and `AI_VISION_MODEL` answer every install as they did
(`test:serverguards`).

Nothing of it reaches the screen, at any time. `npm run test:agentdetect`
holds the look through the real engine on a fake clock, turned on by hand at
eight a match (Start and agent select, one answer, two agreeing, a
disagreement, spectating, the death screen and the combat report, the
countdown, a timer begun in play, a buy timer ending away from the ledger's,
a buy read on the spectator camera before its round ended (a teammate's ammo,
the round clock late in a round, a post plant's camera), the buy phase once it
has, and a death before a match began, the caps, a new match, the fallback,
and no fallback in a round never read as it began: Start pressed while dead, a
pause lifted while dead), the call
carrying the crop and nothing when the crop cannot be cut, the crop itself
(its bounds on both profiles, its scale, the read's quality, null and never
the frame when it cannot be made), the look off in the engine as it ships (two
buy phases of the player's own HUD send nothing, cut nothing and lock
nothing), no page telling the player to confirm, pick or type an agent, and
the prompt byte for byte beside b (b taking a key under an icon as perhaps
rebound, and the teammates' cards as no kit of the player's);
`test:serverguards` the route answering a player with the live prompt and an
admin bench with b; `test:cadence` the reader as it ships sending no look, and
turned on, the look off the read path on the bar cut from the read's own
frames; `test:matchlink` and
`test:backfill` the link's rule; `test:valorantreview` Riot's agent over the
HUD's, the ledger's source, and main's role and look from the screen on Riot's
agent; `test:matchlifecycle` a resumed match's HUD agent keeping its source;
`test:surfaces` and `check:mainwindow` the card, its two buttons alone
recording and mid match.
