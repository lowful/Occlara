# The live read's STATE line

Moved out of CLAUDE.md word for word, nothing reworded or dropped (CLAUDE.md as of commit cc1f880, 8.5.0, lines 2433 to 2704). Sections here: "The live read's STATE line". "Above" and "below" in the text name sections that may now sit in another file under docs/claude/: grep the section's title there to find it. The table in CLAUDE.md says which file to read for which work.

## The live read's STATE line

The model replies `LOBBY` or `STATE: {...}` (`read-prompt.js`). The STATE is
parsed by `mapState()` in `server/routes/coach.js` and fed back as context on
the next read. **If that shape changes, the feedback loop dies silently**: reads
keep arriving, they just stop being informed by the previous one.

The models are whatever Railway says where an env var is set, and the code
default where it is not: `AI_READ_MODEL` (default deepseek/deepseek-v4.1-flash),
`AI_FORENSICS_MODEL` (default openai/gpt-6-sol since 8.4.0), `AI_REVIEW_MODEL`
(default openai/gpt-6-sol since 8.4.0, no longer falling back to
`AI_TEXT_MODEL`, which Ask Coach keeps for every client before 8.5.0; the
bench tables are beside each in coach.js), and `AI_CHAT_MODEL` (8.5.0, Ask
Coach v2's, below, default openai/gpt-6-sol until bench:chat names a winner).
`AI_TEXT_MODEL`'s code default is google/gemini-3-flash-preview, so a /health
naming qwen/qwen3.7-flash as `textModel` is Railway's env var, which
bench:review measured at 10 wrong facts or more in 84 lines against Gemini 3
Flash's 4. Two rounds of benches on 13 Oct 2026 kept the read on DeepSeek: the
one model that agreed with one more of Riot's deaths, Gemini 3.5 Flash Lite,
cost 4 to 5.6 times as much, and every other candidate agreed with fewer at
2.3 to 8 times the price. `AI_VISION_MODEL` serves the look at the agent
(`/detect-agent`, the player's bar off their own HUD since 8.4.4, a look the
client keeps off until a reader passes its bench: "And the look is off",
below) and frame chat;
the tip era routes it also served to installs before 8.0 (`/analyze`,
`/recap`, `/summary/*`, `/suggest-library-tip`) answer 410 with an "update
Occlara" sentence, no licence checked and no model called, as every
`/api/rivals` path does since 8.4.0 (below, "Marvel Rivals was removed in
8.4.0"). Every model call switches reasoning off and retries a 400 without the
switch. There is a credits breaker: on a 402 the server reports it honestly
rather than pretending to be down, and the client backs off for three minutes.

**A pinned call never falls back, and a strike is its own model's** (8.5.0,
`textInfer`'s `fallback`, `textStrikes`). textInfer sent a call that came back
empty or timed out again to `AI_TEXT_MODEL_FALLBACK` or the vision model,
pinned or not, so the review (Sol, chosen by bench:review) came back written by
whatever that was when Sol hiccuped; and one strike anywhere moved every
unpinned text call for the life of the process, so a review's Sol timing out
moved Ask Coach. The review passes `fallback: false`, and so does Ask Coach v2:
a failure there is no narrative (a 503, or an empty reply that parses to a null
summary, which every client handles, and Riot's repaint asks again). Strikes
are counted per model, an empty wallet striking none, and the configured text
model moves to the backstop only after its own: `/health` says `textModel` and
`textModelNow`, the one unpinned calls go to now, and `chatModel`. Only an
UNPINNED call strikes: bench:review and bench:chat bench Gemini 3 Flash, the
text model's own default, and one bench answer empty or cut off at v2's
deadline, struck, moved every old client's Ask Coach to the backstop until a
restart (`test:serverguards`, a review bench and a v2 bench on that model).

**What the calls cost is the provider's own figure** (8.3.1, `coach.js
bookCost`). Every call to OpenRouter asks for its usage (`usage: { include:
true }`) and books the `usage.cost` it returns under the route it served
(read, forensics, review, chat, bench, other) and the licence that made it, by day
and by month, carried with the request (`costScope`, which the coach router
sets). A call that returns no cost (another provider, the legacy Gemini path,
one aborted at its deadline, billed all the same) books the flat price per
image instead, counted apart as estimated; one the provider refused books
nothing. `/api/admin/costs` shows `spend` today and this month by route, real
and estimated apart, and each licence's own by its hash; `global` keeps the
calls as the routes count them and the flat estimate beside them. `npm run
test:aicost` holds it on a scripted provider. **A bench is booked apart**
(8.5.0, `benchCall`): a request with the admin password naming a bench model or
a prompt variant is booked under `bench` with no licence, whatever route it
went to, so a licence's figures and Ask Coach's cap never count a bench run,
and a bench reads its cost off `spend.<period>.routes.bench`. bench-sessions.js
counts that route beside the licence's own read over the same period, and
bench-review.js `--costs` prints a `--models` review off it: read off the
licence alone, a candidate's run cost $0 and bench:sessions' `--max-usd` never
stopped one (`test:benchsession`, on a stand in that books as this server does).

**Ask Coach v2, the route's half** (8.5.0, `coach.js chatV2`; the prompt and
the reply gates are `chat-prompt.js` over `fact-gates.js`). Served to a request
whose context is v2 (`context.v: 2`) from a client of 8.5.0 or later once
`CHAT_PROMPT=v2` is set on Railway, or to an admin bench naming `variant: 'v2'`
or `'v2-noprimer'`; everything else, every client before 8.5.0 above all, is
answered as today, byte for byte, and a deploy without `chat-prompt.js`, or a v2
context it cannot take, is answered as today too. An 8.5.0 client answered
that way sends its matches without the 0 to 100 rating, and today's prompt
lists them without one where it said "rating undefined" on every line; a
client before it sends one on every match, so its prompt is unchanged
(`test:serverguards`). `AI_CHAT_MODEL` answers,
pinned with `fallback: false` (an admin bench may name a model from
`BENCH_MODELS`, and is told which answered), 900 tokens at 0.4, inside one 40 s
budget from the request (`CHAT_TIMES`): the first call abandoned at 28 s, the
gates' one retry (a first sentence dropped, or fewer than two left) with their
reasons named and at most 500 tokens only with 15 s left, and otherwise the
honest line, `honest: true` so a client can say it in the player's language.
The question reaches the prompt with "round #12" read as round 12 before the
Riot ID scrub (`scrubAsked`), the reply keeps its paragraphs, each sanitised on
its own and cut at 4,000 characters, the match's name set goes to the gates and
a sentence still carrying one of its words is dropped here, and `dropped`
(counts by gate), `logged` (what a rule in log mode, the name rule's, would
have dropped) and `sentences` (how many the gates weighed) go back, counts
only, for bench:chat's rates. THE DAILY CAP is per licence, one rolling 24 hour
list of (time, booked cost) (`chatRoom`, the question's own line filled by
`bookCost`, an aborted call included): `CHAT_DAY_USD` (default $0.15) or
`CHAT_DAY_QUESTIONS` (default 40) reached, the question is 429 `{ error:
'chat-daily', resetsAt }`, the moment enough of the list leaves the day, before
any model is called. It covers v2 and, from 8.5.0, frame chat; a bench is never
counted, and a client before 8.5.0 is never capped and keeps the limiter's 25
messages in 5 minutes. In memory, so a deploy resets it. The day's questions,
drops by gate, retries, honest lines and refusals are `GET /api/admin/chat`
(server.js, behind the admin password), never `/health`. FRAME CHAT lost "THE
TIP IT GAVE THEN" (no tip since 8.0), takes a linked round's Riot facts as an
8.5.0 client sends them (`riot`, bounded by `riotFrameFacts`), and drops a
sentence of its answer naming a player. THE VERSION GATE is one function,
`clientAtLeast`, as `knowsGrace` reads X-Occlara-Version: it serves v2 and the
death look's variant b (`forensicsVariant`: 8.5.0 and later once
`FORENSICS_PROMPT=b`, or an admin bench, `'a'` its control), and nothing new
reaches a client built before it (`test:serverguards`, `test:aicost`).

**No player is named in what the server's models write back** (8.5.0,
`namesSomeoneHere`). The review's summary, focus and round lines and frame
chat's answer go a sentence at a time through the match's name set (in any
language, the match id an 8.5.0 client sends) and the server's name gate
(`name-gate.js`: a Riot ID or a handle's shape in any language, its capital
rule in English), a sentence naming someone dropped whole and a round line with
it, logged by place only. The review's and frame chat's own words reach the
capital rule in lower case (`REVIEW_WORDS`: MVP, ACS, ADR, K/D, HS, Victory,
Defeat, Attack, Defense, the banners, and what the HUD prints in capitals,
COMBAT REPORT, SWITCH PLAYER, SPECTATORS, MATCH POINT), which it would take for
names; over the 696 sentences the 13 Oct bench:review wrote and the 45 of the
player's saved reviews it drops none (`test:reviewroute`). Frame chat has no
answer on record to measure it over, and its own words are there too: the "I"
its prompt asks for ("I cannot tell from this frame"), the gear by the game's
names (Heavy Shields, Regen Shield), Melee, HEADSHOT, CREDITS and ADS. Without
them an old client's frame chat answer came back "5 seconds before it.", or no
answer at all. And a sentence dropped takes no number with it: a point between
two digits ends no sentence (`sentencesOf`), where "a 1.48 K/D" came back
"a 1. 48 K/D" beside a summary sentence the gate took out (`test:serverguards`).

**`npm run verify:ai` is the gate for any read prompt or model change.** It
runs the live read over the 240 real frames and fails on parse under 95%,
labels under 95%, more than one invented death, under 80% of Riot's deaths
agreed, or a p90 over six seconds. With up to four reads in flight a tier holds
while p90 stays under its gap x 4 x 1.1, so the 1s tier holds while p90 stays
under 4.4 seconds, and the table it prints gives the tier each model holds. Run
it as `npm run verify:ai -- --lag 4` as well, before a release and for any
change that ages the read's context (more in flight, a longer read timeout):
with four reads in flight each frame goes with the context of four reads
earlier. The session is read from `userData/bench/<session>` first and
from the AI log only after it, because the AI log keeps the five newest
sessions and prunes the rest at every Start; keep the fixture copied to
`%APPDATA%\Occlara\bench\session-2026-09-22T04-24-07-240Z` (bench:forensics
reads it the same way, and `test:benchsession` holds the order). It spends
real money, so it is a manual pre-flight, never CI.

**A read prompt changes as a variant first** (8.4.1, `read-prompt.js
VARIANTS`, `coach.js readVariant`). On the player's Fracture swiftplay of 14
Oct the live prompt registered two deaths of a living player: it offers "the
word Spectating" as a dead tell and hands the model "a teammate's portrait and
name above SWITCH PLAYER", which came back word for word on frames whose only
cue was the SPECTATORS 1 counter, it never says what that counter is, and it
says a planted spike has a timer, which Valorant does not print. Variant b
drops the word, says the counter counts who watches the player on screen and
is no sign of death (nor of life), asks for SWITCH PLAYER, KILLED BY or COMBAT
REPORT only when they are printed on the frame, with nothing quoted to copy,
and says there is no clock after a plant; the STATE line is the same. It is
served only to a request that names it (`variant: 'b'`) beside the admin
password, as a bench model is: a player naming it is read with the live
prompt, and the reply says which prompt answered whenever one was named. b
keeps 90 characters of aliveTell where the live prompt keeps 60 (`TELL_MAX`),
which cut frame-00186's "SPECTATORS 1" to "SPE", where `SPECTATOR_COUNT`
would have seen the counter. `npm run verify:ai -- --variant b` and `-- --lag
4 --variant b` bench it, with the admin password, and stop if the server read
with another prompt. It becomes the default only once both pass live; until
then `test:serverguards` holds the live prompt byte for byte, who may ask for
b and what b says, and `test:benchsession` the bench's flag.

**Variant c** came from judging b's bench frame by frame against Riot's
record over four real sessions, and b did not replace the live prompt: on the
three current sessions the live prompt caught 24 of Riot's 24 deaths and b
21, and where the two disagreed on dead or alive the frames sided with the
live prompt 74 times to 22, nearly all in the buy phase, where the round
before's COMBAT REPORT, KILLED BY at its top, is on screen over a living
player (111 such frames read dead on b, 59 on the live prompt). c keeps b's
one clean win, no "Spectating" and nothing quoted to copy, and: the player is
dead only on SWITCH PLAYER, a COMBAT REPORT with ROUND ONGOING at its foot,
or no health number; the buy phase is never death; the SPECTATORS counter,
the skull of the player's own kill banner, the kill feed, the scoreboard, the
map, the buy menu and a WON, LOST or FLAWLESS banner are no sign of death and
stay out of the tell; no word the frame does not print and none saying a word
is absent (each of b's "SWITCH PLAYER not shown" was a death to the server);
alive null when it cannot tell; and the timer is read as printed until the
spike icon takes its place, a timer still counting being no plant. It keeps
120 characters of aliveTell (`TELL_MAX`), since 90 cut "SPECTATORS 1" to
"SPECTATOR", which the spectator tell reads and the counter rule does not.
Served exactly as b is, `npm run verify:ai -- --variant c` benches it. It
replaces the live prompt only when three runs of each, interleaved over the
four sessions on one upstream, each frame sent the engine's own context
(`readContext()`) and scored by time against Riot, show it missing no death
the live prompt caught, inventing no more deaths or plants, reading fewer buy
frames dead in every session and no more LOBBY, and passing verify:ai plain
and at `--lag 4`, its cost a read within a tenth. `test:serverguards` holds c as
the live prompt with its alive and clock lines given the judge's word for
word, who may ask for it and its cap, and `test:benchsession` the bench's
flag for c.

**c is the live prompt since 15 Oct 2026**, the player's choice, and the
prompt every install read with before it is variant a, byte for byte, for the
benches to measure against (`read-prompt.js`: `LINES.alive.live` and
`LINES.clock.live` are c's; `TELL_MAX` 120 live and on c, 60 on a, 90 on b).
`npm run bench:sessions`, three runs of each interleaved over the four
sessions: invented deaths 4.33 a run against 7.33, no death the prompt before
caught missed (the Abyss 17.3 of 21 caught against 15, the Split 16 of 16
against 15.7, the Sunset 5 of 5 and the Fracture 3 of 3 both), buy frames
read dead 0.5 to 4.1% against 8.2 to 32.8% in every session, LOBBY replies
10.7 against 38, invented plants 1.33 both, verify:ai PASSED plain and at
`--lag 4`. It missed one term, a read costing 12.7% more ($0.0003173 against
$0.0002816, its prompt about 1,000 characters longer) where the bench allowed
a tenth, and the player chose c for the rest. `test:serverguards` holds the
live prompt byte for byte as c's, c's bench read with that very prompt, and a
byte for byte as the prompt before.

**The bench that decides it reads as the app reads** (8.4.3,
`bench-read.js --engine`, `scripts/read-score.js`, `npm run bench:sessions`).
verify:ai sends each frame the server's own replies merged raw, so a misread
fed back stays fed back: on both Fracture runs of b's bench a 0 to 0 read
dropped the score line from the next prompt and the engine's new match rule
reset the match, and buy frames sent "the player was DEAD on the last frame"
were read dead 35 to 50% of the time against 11 to 19% without it. And it
scores every session against the Abyss record. `--engine` sends each frame
what the real engine's `readContext()` gives and applies each reply through
the engine in capture order as `drain()` does (a failed read skipped, a LOBBY
a menu), its network stubbed and its clock the frame's capture time
(`AppReader`, started as the app starts it, no heartbeat, and no frame for the
look at the agent, so no agent, as in a match whose look never locked one,
where the app's context carries the agent the look locked from its round 1
buy phase on, since 8.4.4 for every player); `--lag N` sends frame k
the context once the replies up to k - N are applied; each trace line keeps
the reply as sent and what the frame was `sent`; `--gate` is refused beside
it. Without the flag nothing moves: `test:benchsession` holds the default run,
verify:ai and `--lag 4` to 8.4.2's requests, table and trace byte for byte over
a scripted session, and `--engine` to an engine of the test's own. It reads
every frame the log kept, where the app's read cadence would skip some.
`read-score.js` is the judge's scorer made reusable: each round's barrier
drop from every run's clocked reads of its frames (one vote a frame and clock),
numbered by the score most runs read there; Riot's death the drop plus Riot's
milliseconds, or the whole second the Sunset's and the Fracture's reviews kept
(`riot-sunset-2-5.json`, `riot-fracture-5-1.json`: rounds, sides, results,
death seconds, agents and plants, `wholeSeconds`); a death caught from 5 s
before it to the next buy phase and still standing, one the next read withdrew
no catch, the rest invented; and per run the false plants, LOBBY replies, buy
frames read dead of those judged, parse, labels, p50, p90 and the rounds one
by one. Every run is replayed on the guards of the day, so its numbers move
with them. On b's traces of 14 Oct it gives the judge's numbers exactly, ten
runs and three AI logs, and from the AI log's reads alone it puts Riot's deaths
within 0.6 s of the Sunset's clips and the Fracture's recording looks
(`test:readscore`, which also scans every Riot record here for a player name,
a puuid or a tag). `npm run bench:sessions` SPENDS MONEY and spends nothing
without `--go`: it prints every run, its reads, the cost at the two prices seen
($0.00033 a read, $0.00012 after OpenRouter moved the read at about 23:08 UTC
on 14 Oct) and the time. With it the candidates' verify:ai goes first, plain
and at `--lag 4` (its verdict read off its printed line), then runs of live
and c in turn over the sessions, `--engine` each, every run its own process
costed exactly from the licence's read spend in `/api/admin/costs` before and
after, stopping before the next run on a prompt not served, a refused read
(401, 402, 403, 429), over 5% failed, a run that read fewer frames than its
session has (it died part way, and is scored as no run), a data policy
fallback, a restart or the `--max-usd` cap; then every whole run is scored
together and the judge's terms are checked and printed (`acceptance`: the
judge's bench first, three whole runs of each prompt on each of the four
sessions with every run done, so a bench that stopped, on its last run as
on any other, or ran fewer replaces nothing; then no death live caught in
most runs caught in half or fewer of the candidate's, invented deaths,
plants and LOBBY at or under live's mean, buy frames read dead under live's
in every session, both gates passed, a read's cost within a tenth). The
default, three runs of each on the
four sessions, is 26 runs and 9,576 reads: about $3.16 and 6.4 hours at the
first price, $1.15 and 2.7 hours at the second. `test:benchsession` runs it
offline against a stand in for the server.
