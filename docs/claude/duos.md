# Occlara Duos (built 2026-11-25, not yet live)

The owner's ask: "a way to detect if another user is using occlara, for
example 'Occlara duos', and the users can add each other and they can both see
where each died on their screen and vod review each other and see what each of
them were doing in that round." His decisions: clips upload automatically after
a match; only a Max plan can start a duo, anyone (any plan or none) can join
one. Built on the public profiles of 8.19 (social.md): usernames, blocks,
`discoverable`, the routes' patterns, the PGlite tests. Sections: "What it is",
"The switch", "The plan", "A duo and its states", "Invites", "Detecting
teammates", "Consent: Discoverable as Duos reads it", "What a shared match holds", "The clips and the bucket", "Caps,
quotas and the worst case", "Expiry, the sweep and the trash", "Blocks,
removal, deletion", "Pins", "Names", "Main's half", "What runs when", "The page", "The routes",
"The tables", "Residual risks", "Tests", "Turning it on (the owner's
runbook)", "Taking it away".

## What it is

Two friends who both use Occlara are a duo. For a match they played together
ON ONE TEAM and both reviewed (the review linked to Riot's record), each one's
app uploads a compact **sheet** of its own side (numbers, agents, the map,
Riot's places and guns, fixed keys) and its **clips** (death `r`, flagged
`d`, highlight `h`). On the **Duos page** each sees both sides round by round,
one time axis per round with both players' kills and deaths, and a round's two
clips side by side on one clock; each may **pin** a moment of the other's clip
with a label and a reaction from fixed lists. Everything shared expires 30 days
after the match.

## The switch

`SOCIAL_DUOS_ON` exactly `1` AND `SOCIAL_ON` exactly `1` (`duos.js duosOn`).
Off (either unset, or anything but `1`, or social-002's SQL not run): every
`/api/social/duos/*` route answers `503 { error: 'duos-not-live' }` before
any lookup, count or write; `/api/social/status` says `duos: false`; the app
shows no trace of Duos (no account menu row, no page, the Discoverable switch
says nothing of Duos). The sweep still runs while the tables exist, so expiry
holds while Duos is hidden.

`/api/social/status` gained the field `duos` (additive: `live` and `riotProof`
answer as in 8.19).

## The plan

The top plan the owner calls Max is entitlement tier **`max`** (accounts.md:
`free`, `pro`, `max`; Stripe lookup keys `occlara_max_*`; a yearly or lifetime
licence maps to `max`). The SQL reads it FRESH from `public.entitlements`
(`social_duo_max`: tier `max` and status `active`) inside every function that
creates or uploads (an invite, a code, a sheet, a clip), never the client's
word and never the resolver's 30 s cache. A refund ends the entitlement
(licence-billing.md, untouched here), so a duo that depended on it is
**paused on the very next call** with nothing written. The Stripe webhook is
not touched.

## A duo and its states

- **invited**: an open invite (by name or code), 7 days.
- **active**: a pair at least one of whom is on Max now.
- **paused**: neither is on Max now. Nothing new is shared (sheet and clip
  uploads answer `paused`), what was shared stays viewable until it expires,
  the page says why.
- **ended**: either removed the other (`social_duo_remove`) or blocked them
  (the trigger). Ending deletes the pair's shared matches, sheets, clip rows
  and pins at once, and every file through the trash (below). The other side
  sees "X ended your duo" for 14 days; a block's end is never said.

At most **5** live duos (active or paused) an account; at most **10** open
invites sent.

## Invites

- **By exact username** (`POST /invite`): Max only. The answer is `sent`
  WHETHER OR NOT the name is a profile this sender may reach, in shape and (the
  250 ms floor) in time. It reaches the profile only when that profile is
  **PUBLIC** (being discoverable never lets a stranger who knows a name invite
  it), neither blocked the other, and that profile did not DECLINE this sender
  in the 7 days since the decline (`declined_at`); otherwise it reaches nobody and expires. The sender's
  list shows the name AS THEY TYPED IT. So an invite adds nothing to "What
  search can still reveal" (social.md): it never says whether a private
  profile exists, nor that a decline happened. The only refusals that name a
  fact about the other are `partner` (already a duo: both know) and `self`.
- **By code** (`POST /code`): Max only. 10 letters of a 32 letter alphabet (no
  0, 1, I, O), 50 bits, made from `crypto.randomBytes`, shown once as
  `K7M2Q-9XH4P`, kept only as an HMAC with `ACCOUNT_HASH_SALT`. Single use, 7
  days. Anyone with a username may paste it (`POST /accept { code }`), with no
  plan at all. A code is how a private profile joins a duo.
- **Guessing**: every wrong code is counted in the database FIRST, one accept
  of an account at a time (an advisory lock per account, so two at once never
  both pass the count): 10 a rolling day per account, then `guesses` with
  nothing looked up; plus the route limits (20 accepts an hour per account,
  60 per address). A wrong, used, expired or blocked code is one answer,
  `bad-code`.
- **Every invite row, in and out, and every teammate found** has Block and
  Report on the page.

## Detecting teammates

**Who reports at all (the review of 25 Nov, finding 5).** Only an account
that opted in to something: a live duo, an open invite IT SENT (never one it
was sent: a stranger's invite never makes an app report), or Discoverable
turned on under Duos' words. The app knows it from the Duos
page, its actions and the Profile switch, and asks once (`GET /me`) when it
does not know or its answer is a day old, never right after a match of an
account known to have opted in to nothing; such an account makes NO duo
request after a match (test:duosflow). The server refuses the report of any
other account (`not-engaged`) and keeps nothing of it.

The report (`POST /report { matchId, us, them, agent }`) is sent once a match
is linked to Riot's record (the review has a `matchId` and both comps). The
server stores the match id only as `HMAC(salt, 'duo-match|' + id)`, the team
as one word both teammates send alike (their team's agents sorted, a bar, the
other team's sorted; a mirror comp is refused, never paired), the own agent,
and the live game row it spent; reports are kept **3 days**.

**The binding**: a report spends one `game_usage` row of the account, kind
`live`, game `valorant`, reserved or counted, made in the last **4 hours**, not
spent by an earlier report. A report of a match already reported spends
nothing. **What it proves**: the account played a live Valorant game that the
server metered in the last 4 hours, and gets one report for it. **What it
does not prove**: that it was THIS match, or this team. A live row holds no
match id (free-allowance.js says the same).

Two reports pair when they name the same match hash, the same team word, and
landed within **3 hours** of each other:
- partners in an ACTIVE duo: the match is shared (`social_duo_matches`, 30
  days from the earlier report), which is what starts the uploads; no
  Discoverable needed;
- otherwise, both Discoverable (under Duos' words), neither blocked the other:
  each is **found** by the other (username and the agent they played) on the
  Duos page, with "Invite to duo" (the viewer has Max) or "Ask them to invite
  you", Block and Report. Never an enemy, never a Riot ID.

**The first reporter (finding 2).** Whoever reports first is answered with no
shared match: the partner has not reported yet. Its app keeps the report
PENDING and sends it again on a backing off timer (1, 2, 5, 10, 20, then
every 30 minutes) until the pairing window (3 hours and 10 minutes from the
first answer) passes, and AT ONCE when the duos' match list, which it asks
each tick while a report is pending, shows a match it has not queued (the
partner's report paired it). Sending a report again costs nothing: it spends
no second live game, and it is under the report route's own limit (30 an
hour). test:duosflow holds both orders, the partner reporting 2.5 hours late,
and nothing pairing past the window.

## Consent: Discoverable as Duos reads it

8.19's switch said "Nothing is shared yet". A flag turned on under those
words is no consent to what Duos does with it. So Duos reads Discoverable as
on only when the 8.19 flag is on AND Duos' own stamp
(`social_profiles.duo_discoverable_at`, added by social-002) is set, which
only `POST /api/social/duos/discoverable` sets, the route the Profile switch
uses while Duos is open, under the words that say what it now allows
(social.js `DISCOVER_EXPLAIN`: a teammate on your side of a match you played,
who turned it on too, sees your username and agent and you theirs, so either
can invite the other; never an opponent, never anyone else, never your Riot
ID; it does not let anyone invite you by typing your username, which reaches
public profiles only). Turned off by any route, the stamp goes with it (a
trigger). While Duos is open the Profile switch shows Duos' reading, so a
flag from 8.19 shows OFF until the player turns it on again. With Duos off,
the switch says no word of Duos (`DISCOVER_EXPLAIN_OFF`).

## What a shared match holds

**The sheet** (`src/shared/duos.js sheetOf`, the server's `cleanSheet`): agent,
map, mode, result, score, grade (score and letter), the scoreline (K, D, A),
and per round: number, side, result, died and its second, the place of the
death (Riot's callout, else the screen's, kept only if the map's places hold
it), killer agent and gun (a gun the game data knows, Melee, or an ability by
its kit name), the player's kills by second, first kill, first death, traded,
a clutch, the alive counts at the death, the plant site and second, where the
kills fell, and the death's cause as its fixed key (forensics, `CAUSE_KEYS`).
No sentence of a review (summary, why, read, a look's words, the facts line),
never a name. Validated like the stats snapshot: a whitelist, every number in
range, the whole refused when impossible (a round twice, more wins than the
score, six kills in a round, a killer with no death, kills after the death,
more kills than the scoreline, a C site on a two site map), 24 KB. Read back
through the same cleaner. "The spot they held": a review keeps no such field
today (only the death's place and where the kills fell), so none is sent.

**The clips**: every `r`, `d` and `h` clip of the match the review names, each
with its marks (ms on its own timeline: the death, a highlight's kills and
cuts) and its **anchor**, one moment on both clocks (the death: `clipDeath` and
Riot's ms of the death off the feed; a highlight: its first kill mark and
Riot's first kill), which is what lets two clips share one clock
(`renderer/duos/duo-time.js`, cuts included). A clip with no anchor plays
alone.

## The clips and the bucket

A NEW private bucket, **`duo-clips`**: 80 MB a file, `video/x-matroska` only,
made by the SQL (`storage.buckets`), so Supabase Storage refuses a bigger
file or another DECLARED type at upload. Files never pass through the Express
server (its JSON limit is 2 MB):

1. `POST /clip/start { ref, name, round, kind, marks }`: the duo active, not
   across a block, the match not expired, fewer than **18** of this account's
   clips in it, and the account's quota able to take the WHOLE 80 MB (it is
   held from the moment the URL is issued). The database chooses the path
   `<pair ref>/<match ref>/<member tag>/<clip ref>-<name>`: all random 16 hex,
   and the last part the clip ROW's own ref, so a new row never reuses a path
   (a dropped upload's path in the trash is never a newer upload's). Never a
   user id, a profile id or the match hash: a signed URL carries its path, and
   a URL is an answer. The server answers a signed upload URL (Supabase's,
   about 2 hours) **without upsert: a path is written once** (finding 1). A
   clip already stored answers `stored` and is never sent again. One issued
   and not stored is first LOOKED UP in storage: a file already there is
   settled from its real size and no new URL is issued; none there, a new URL
   for the same path, at most 6 times.
2. The app PUTs the file there (`Content-Type: video/x-matroska`).
3. `POST /clip/done { clip }`: the server asks STORAGE for the file's size
   (`list` through the service role, never the app's word) and settles the
   row and the quota to exactly that size; a file over the cap or over what was
   held for it goes (into the trash), its reserve spent.
4. `POST /clip/url { clip }` (a partner opening it): the file is LOOKED UP
   AGAIN, and one that is not the size it was settled at (grown, or gone) is
   deleted with its row and no URL is given. This is the real guarantee
   against an overwrite whatever Supabase does with an upload URL used twice.

So a file in the bucket is always one PUT of at most 80 MB, charged at the
size storage reports, and downloads are charged by that same size
(test:duosflow tries the overwrite: 409, 64 bytes stored, 64 charged).

A partner gets a download only by `POST /clip/url { clip }`: a STORED clip of
a live duo they are in (active or paused), not across a block, not expired,
within the day's download budget AND the day's count of download URLs.

## Caps, quotas and the worst case

| What | Cap |
| --- | --- |
| a clip | 80 MB (the bucket's own limit) |
| clips one account shares of one match | 18 |
| upload URLs one clip may be given | 6 |
| uploaded by one account | 2 GB in a rolling 30 days, every upload counted (a clip later deleted still counts), the 80 MB held at issue, settled to storage's size |
| download URLs one account is given | 120 a rolling day, and their files' sizes 1.5 GB a rolling day, counted when each URL is issued |
| a download URL's life | 10 seconds |
| a sheet | 24 KB, one per account per shared match |
| duos | 5 an account; 10 open invites sent |
| pins | 20 per author per clip, labels and reactions from fixed lists |
| reports | one per live game metered; kept 3 days |
| the partner's clips on a PC | 2 GB (the duo cache, least recently used first out) |

**The clip cap stays 80 MB, not 50.** clips.md measures a 45 s 1080p
highlight at 34 to 68 MB and a flagged death can be 45 s too, so 50 MB would
refuse real 1080p highlights; a death clip (15 s) is about 11 to 22 MB.

**Stored, worst case**: every stored file was uploaded within the last 30
days (a file can only be uploaded while its match is not expired, and it
expires 30 days after the match), every file is one PUT charged at its real
size, so one account's files in the bucket never pass **2 GB** at any moment,
plus the sweep's lag. For N accounts that upload, at most **N x 2 GB** (1,000
accounts: 2 TB, about $42 a month at Supabase's $0.021 a GB).

**Egress, said honestly (finding 3).** What is bounded is what is ISSUED: at
most 120 download URLs and 1.5 GB of files a day per account. What is not is
a refetch INSIDE a URL's life: Supabase has no single use download URL, so a
modified client can fetch the same signed URL again and again for its 10
seconds. The app needs a URL only to START its download (it fetches the
moment the URL arrives; Supabase checks the token when a request starts, and a
transfer already started goes on), so 10 seconds is enough for a slow line's
connection and TLS handshake and leaves the least room. Realistic worst case
for a hostile account on a fast line (about 100 MB/s): 10 s of refetching a
URL is about 1 GB, so 120 URLs a day are at most about 120 GB a day, about
$11 a day of egress at $0.09 a GB, until the account is noticed and blocked;
an honest app downloads each clip once (the cache), well under the 1.5 GB.

## Expiry, the sweep and the trash

- A shared match, its sheets, clips and pins expire **30 days** after the
  match. Expired data is never answered (the reads filter on `expires_at`),
  and no URL is issued for it, before the sweep has run.
- **The sweep** (`routes/duos.js sweep`, `social_duo_sweep`): every 10 minutes
  on the server (server.js), 200 at a time, and a small one on every upload
  start and every removal. It deletes expired matches, ended duos after 14
  days, old invites, reports, guesses and byte counts, and hands over the
  trash's paths, which the server removes from the bucket.
- **The trash** (`social_duo_trash`): a trigger puts the path of every clip row
  deleted BY ANY PATH (expiry, a removal, a block, an account deleted by
  cascade, a dropped upload) into it. A path is handed over for removal ONLY
  when no live clip row points at it (and such a path leaves the trash), and
  is let go only **26 hours after its upload URL was issued** (a URL lasts
  about 2 hours, and a slow PUT started just before its end can still land
  long after); until then each sweep removes it again, so a file that lands
  late is removed too.
- **The reconciliation** (the second review, finding 5): each sweep also walks
  a little of the bucket's own listing (6 list calls, folder by folder, from
  where the last one stopped, back to the top when done) and deletes any file
  that no live clip row points at and that is older than 26 hours, whatever
  table forgot it.
- An upload issued and never seen stored for 2 h 10 min is **stale**: the
  sweep looks it up; there, it is settled from storage's size; not there, it
  is dropped (its reserve given back, its path into the trash for 26 hours).
  Its retry is a new row at a new path.

## Blocks, removal, deletion

- **A block** (8.19's `social_blocks`) ends a duo AT ONCE by a trigger,
  deletes everything it shared, cancels every open invite between the two.
  **The lock order**, everywhere two accounts are locked (the block trigger
  and `social_duo_join`): the lower uuid's `social-duo-user:` advisory lock,
  then the higher's. A join racing a block either finishes first and its duo
  is then ended by the trigger, or waits and then sees the block. **And every
  read and write of a pair checks the block list itself**, defence in depth:
  `me` (partners, invites, found, the count toward the cap), `matches_of`,
  `match`, `sheet_put`, `clip_start`, `clip_done`, `clip_get`, `pin`, the
  report's pairing and `join`.
- **Remove** ends the duo the same way, said to the other side.
- **Account deletion** cascades every row (pairs, matches, clips, pins,
  reports, bytes, guesses) and the trigger leaves every file path in the
  trash: no orphaned storage.
- **Report**: a partner, a partner of the last 14 days, an account that
  invited this one, or a teammate this account was shown as found (never a
  stranger by name), with a reason from a fixed list (`username`, `pins`,
  `clips`, `other`) into `feedback_reports`. The answer is the same whether
  or not anything was filed; a real one IS filed (test:duosflow).
- **A decline** holds that sender off that profile for 7 days (said to the
  sender as the ordinary `sent`).

## Pins

A partner puts a pin on a moment of the OTHER's clip (never their own): the
clip, the ms, a label (good trade, should have traded, too far from me, good
utility, wait for me, nice shot, wrong timing, my mistake) and an optional
reaction (nice, wow, agreed, oops). No typed text anywhere: the table refuses
a label off the list. The owner sees new pins on the Duos page the next time
it is opened ("2 new pins on your clips"), marked seen then. Never a
notification mid match, and no OS notification at all in this build.

## Names

The server never shows a player's Riot ID here. A partner is known by their
Occlara username. The sheet is numbers, agents, places, guns and fixed keys.
**The one place names appear is the partner's clip**: it is their own screen
recording, shared by their choice, so it shows the game's HUD as it was (the
kill feed, the scoreboard). The page says so under the clips
(`duos.js NAMES_NOTE`).

## Main's half (`src/main/services/duos-service.js`)

- **Nothing mid match.** Every method answers null while a match is in
  progress or the window is sealed, asking nothing (check:seal drives every
  channel and the tick mid match: no answer, no request). An upload in flight
  AND a download in flight are **aborted** the moment a match starts (watched
  every 500 ms while they run). An aborted upload is no try and is sent again
  whole after the match; an aborted download keeps nothing, and its budget
  stays spent (given back, an abort would be a way to download for free).
- **The status** (the second review, finding 3). While Duos is NOT known to
  be live, the duos service asks nothing of its own: it re-reads, on every
  tick, the status the profiles service already holds (`peekStatus`;
  social-service.js asks it at launch when the shell paints the account menu,
  and when a social page opens, and remembers it a minute). The Duos row and
  page ask through that same service (`socialLive`). Once Duos is known live,
  the duos service keeps that answer at least **15 minutes**, then asks
  `/api/social/status` itself (only while live: to notice Duos switched off),
  at most 96 times a day.
- **Engaged** (findings 4 and 8): a duo (active or paused), an invite this
  account SENT, or Discoverable under Duos' words. An invite it was SENT never
  counts. Learned from the page, its actions and the Profile switch; else
  `GET /me` when not known or a day old, stamped on ANY answer (401 and 403:
  not engaged), backed off on a failure (1, 5, 15, 60 minutes, then daily). An
  app with no session (a licence key alone) asks nothing at all.
- **The report** (findings 2 and 6): once a review is linked; a first answer
  with no shared match stays pending and goes again at 1, 2, 5, 10, 20, then
  every 30 minutes, or at once when the duos' match list shows a match not
  queued; a failure (offline, 5xx, 429, 401) backs off 1, 5, 15, 60 minutes;
  either stops at the pairing window (3 h 10 min from the first try); and
  this app sends at most **20 reports in any hour** whatever is pending.
- **The sheet and the clips** (findings 1 and 2), one thing at a time, an item
  that waits never blocks the next:

  | Answer | Sheet | Clip start |
  | --- | --- | --- |
  | ok | sent | upload, then done |
  | `paused`, `quota` | waits 6 h | waits 6 h |
  | `none` (no pair, expired) | the match leaves the queue | the match leaves the queue |
  | `too-big` | refused, final | too large, final |
  | `count`, `issues`, `clip` | | failed, final |
  | another 4xx (400 invalid, 413) | refused, final, said on the page | backed off, never final |
  | 429 | backed off on its own clock, the queue moves on | backed off (1, 5, 15, 60 min, daily), never final |
  | 401, 403, 404 | 401 and 403 back off and stop the step | backed off, never final |
  | 5xx, offline | the step stops, next tick | backed off, never final |

  An upload that fails (not 413) is a try; five and the clip is failed. A 413,
  or a 400 whose body says `statusCode: "413"` (some Supabase versions), is
  too large: said on the page, never tried again. The sheet is built so the
  server never refuses an honest review (`sheetOf` drops whatever part
  disagrees: a scoreline counted early, won rounds over the score, rounds
  past it, a kill after the death, a C site on a two site map); test:duosretry
  runs it over 60 reviews the fixtures build.
- **The partner's clips** download only when opened, through the signed URL,
  into `userData/duo-cache` (2 GB, least recently used first out), are checked
  to begin with the Matroska magic `1A 45 DF A3` before they are kept, and
  play through `occlara-clip://duo/<ref>/<name>`. **A cached clip is
  removed**: when the Duos page loads and its match is not in the server's
  list; on the tick, at most every 10 minutes, when its match is not in the
  server's list (expired, ended, blocked); when ITS MATCH'S expiry passes (the
  page hands the expiry through the preload and the IPC); every one when the
  account is signed out, another account signs in, there is no session, Duos
  is not live, or the account is no longer engaged; and any file the index
  does not name (a `.part` a crash left) on every tick and at launch.

## What runs when

What the duos service (main) and the server do, by moment. "Asks" means a
request to `/api/social/duos/*` or `/api/social/status` made by the duos
service itself.

| Moment | Duos OFF (or not yet known) | Duos ON |
| --- | --- | --- |
| App start | Nothing asked. `start()` sweeps stray cache files and sets the 1 minute tick. The shell paints the account menu: the profiles service asks the status (8.19's own ask); the Duos row stays hidden | The same; the Duos row shows once the profiles service's answer says live |
| Each tick (1 min) | Re-reads the profiles service's status, asks NOTHING; the cache is wiped when the status says not live, kept when it is not known | No session: nothing asked, cache wiped. Engagement not known or a day old: `GET /me` (backed off on failure). Not engaged: nothing more, cache wiped. Engaged: the match list (only while a report is pending or the cache is due its 10 minute check), due reports (at most 20 an hour), one sheet or clip at a time. The status asked again only every 15 minutes |
| After a review is saved | Nothing | On the next tick, if engaged and the review is linked to Riot (a `matchId`, both comps) and under 4 hours old: its report |
| The Duos page opened | Not reachable (no row) | The profiles service's status ask, then `GET /me` and `GET /matches`; the cache pruned to the list; pins seen |
| Sign in | Nothing | The next tick learns engagement (`GET /me`) |
| Sign out, or another account | Queue, reports, engagement and every cached clip forgotten (`forget()`); nothing asked | The same |
| A match starts | Nothing (every call null) | Every call null, the tick does nothing, an upload or download in flight aborted |
| Quit | The tick stops (`stop()`), an upload in flight aborted; its clip goes again next launch | The same |
| The server, every 10 min | The sweep runs while the tables exist: expiry, trash, stale uploads, the reconciliation | The same |

## The page (`src/renderer/duos/`)

In the **account menu, under Players** (shell-nav.js `duos`, `nav: false`):
the top bar is full (8 tabs), Duos is Players' family (people, by username),
and the menu's rows are locked by the seal like every page. Shown only while
the server says Duos is open. The page: what Duos is; your duos (state and why,
rank from their profile, new pins, Remove, Report, Block); invites in and out;
start a duo (by username, or a code) or, without Max, what Duos is, that it
needs Max on one side, See plans (Profile's `PROFILE_PLANS` way) and "ask a
friend with Max"; join with a code; teammates found; shared matches; the
upload switch and what was shared. A shared match: both grades, round by round
both players side by side, one axis per round (the player's own lane above,
solid, the partner's below, dashed; a kill a tick in --good, a death a cross in
--bad, the plant a dashed line), and Watch: the round's two clips side by side
in two of the review's own clip players under one outer controller (Play both,
a second and a frame either way, a round time slider) that holds the follower
to the lead's round time (within 150 ms); with one side missing or no anchor,
each plays alone and the page says why. Pins under the partner's clip, on its
track and in a list. Every state written: loading, signed out, no username,
offline, not live, no Max, paused, empty, partner removed, blocked, expired,
upload failed, quota reached.

## The routes (`server/routes/duos.js`, `/api/social/duos`)

`GET /me`, `POST /invite`, `POST /code`, `POST /accept`, `POST /decline`,
`POST /cancel`, `POST /remove`, `POST /report`, `GET /matches`, `GET /match`,
`POST /sheet`, `POST /clip/start`, `POST /clip/done`, `POST /clip/url`, `POST
/pin`, `POST /pin/remove`, `POST /seen`, `POST /flag`, `GET|POST
/discoverable`. Session or site JWT only (a licence key, linked or not, is
403; none 401). Every answer built field by field: no email, user id,
profile id, account key, puuid, match id, hash or code hash; rows by random 16
hex refs. The 250 ms floor on `/invite`, `/accept` and `/flag`. Limits
(`rate-limits.js routeLimits`): accept 20 an hour per account and 60 per
address; invite and code 20 an hour; report 30 an hour; clip 240 an hour;
sheet 60 an hour; pin 60 in 10 minutes; flag 5 an hour; discoverable 30 in 10
minutes; all of Duos 300 in 10 minutes, NOT counted against 8.19's `social`
240.

## The tables (`docs/sql/social-002-duos.sql`)

Ten `social_duo_*` tables (invites, pairs, reports, matches, sheets, clips,
pins, bytes, trash, guesses) and one column on 001's `social_profiles`
(`duo_discoverable_at`), RLS on with no policy, every privilege of PUBLIC,
anon and authenticated revoked, EXECUTE granted to `service_role` on an
EXPLICIT list of the 38 functions it creates (the undo drops exactly that
list), three triggers (a clip row gone into the trash; a block ends a duo;
Discoverable off clears Duos' stamp), the bucket. Needs social-001 and the
live accounts tables (`entitlements`, `game_usage`).

## Residual risks

- **The report proves a recent live game, not this match.** A modified client
  of an ENGAGED account that knows a match id (match ids are visible to anyone
  who can see a player's match history on a tracker) can report it as its
  own, once per live game it plays, and learn whether a DISCOVERABLE player on
  the team it names reviewed that match, which is what that player opted in
  to under words that say so; it exposes the asker's own username in return,
  because discovery is mutual. It cannot learn a Riot ID, reach a player who
  did not turn Discoverable on through Duos, or join anyone's duo by it.
- **A team word can be claimed**, limited by the report budget above.
- **A signed download URL can be refetched within its 10 seconds** (above).
- **Content is checked only so far.** Supabase checks the DECLARED content
  type, and the app checks only the first 4 bytes (the EBML magic). Any bytes
  after that header reach Chromium's Matroska demuxer, from a partner the
  player chose to be a duo with; a malformed file is a crash or a decode
  error in the sandboxed renderer, never a file written anywhere.
- **A partner's clip shows names** in the game's HUD (above).
- **The upload is the app's whole file at once in memory** (80 MB at most).

## Tests

- `test:duossql`: the SQL on PGlite over Supabase's default privileges after
  001, twice, the undo twice and again; privileges on every table and
  function, the grant and undo lists exact; invites (one answer for every
  name, public profiles only, a decline's 7 days), codes (own, single use,
  expired, the guess limit counted first, twenty at once counting ten), five
  duos, the lazy pause on a refund; Discoverable's consent stamp; the report's
  binding, its `not-engaged` refusal and its window, partners shared,
  discoverable teammates found and never an enemy or across a block; clips
  (the path with the row's ref, the count, the quota held and settled to
  storage's size, a file over the cap or its reserve removed, a retry at a new
  path, a live path never handed to the sweep), downloads, their budget and
  their daily count, pins; an outsider with a valid ref on every function; a
  duo and an invite across a block passed over everywhere; removal, account
  deletion, expiry and stale uploads each leaving every path in the trash;
  and the mutants (10): the block trigger and the block clauses of the match
  and the clip taken out; the plan check taken out of an upload; the team
  check taken out of the report; the membership check taken out of the match
  view; the membership check taken out of an upload start; the discoverable
  check taken out of the report; the plan check taken out of a sheet; the
  owner check taken out of clip_done; the block check taken out of join; the
  block check taken out of the invites in. Each fails the cases, and the test
  holds this list to its own.
- `test:duos`: the rules byte for byte; codes; the team word; the sheet; the
  two clip clock; the scheme's duo host; THE SWITCH three ways; the real
  routes on PGlite and the storage stand-in with main's half uploading and
  downloading for real, the pause mid upload, the switch, a file that is not
  Matroska refused, pins, the lazy pause, a block and an expiry emptying the
  bucket, the purge; no leak in any answer; the limits and the floor; the page
  in the fake DOM in every state; Discoverable both ways; the site proof off.
- `test:duosflow`, one case per finding of the first review of 25 Nov: the
  overwrite refused and the bound, a retry settled from storage; the first
  reporter uploading in both orders, late in the window, and not past it; the
  10 second URL; an outsider with a valid ref on every route; no duo request
  from an account that opted in to nothing; consent and public only invites;
  a found teammate reported; Block and Report on the rows; a download aborted
  by a match; the cache pruned on the tick; Duos off asking nothing for a day
  and Duos on asking the status at most every 15 minutes; Duos' own limit; a
  413 never retried.
- `test:duosretry`, one case per finding of the second review: a refused
  sheet final and the queue moving on, a 429 backed off; `sheetOf` over 60
  reviews the fixtures build, every one taken by the server; every final and
  every backed off answer of a clip start; Duos off or not known, and a
  licence key alone, asking nothing for 24 hours; `GET /me` answering 403, 500
  and 429 for a day; failing reports at most 20 an hour and none past the
  window; an invite received never engaging, in the app and on the server; a
  decline counted from the decline; who pays never said; a teammate never
  shown not reportable; a cached clip leaving at its match's expiry; a file
  grown after it was settled refused and deleted at download; a 400 saying
  413 too large; a dropped upload's path kept 26 hours and the
  reconciliation removing a late landing.
- `check:seal`: Duos mid match: not shown, its row locked, every channel null,
  the tick asks nothing. `check:mainwindow`: the row, the page, a match, the
  stage on the duos stand-in. `export:siteproof` boots it NOT live.

## Turning it on (the owner's runbook)

1. Make sure social-001 is run and `SOCIAL_ON=1` works (social.md).
2. Deploy the server (safe before the SQL: Duos answers not live).
3. Run `docs/sql/social-002-duos.sql` in the Supabase SQL editor. If its last
   NOTICE says the bucket was not made, make it in the dashboard: Storage, New
   bucket, `duo-clips`, private, file size limit 80 MB, allowed MIME types
   `video/x-matroska`. **On a Supabase Free plan the global file limit is 50
   MB**: clips over it are refused at upload (the app says "too large for the
   server" and does not retry). Raise the project's global limit (a paid plan)
   to 80 MB or more before switching on.
4. Set `SOCIAL_DUOS_ON=1` on Railway (it redeploys). Check
   `curl https://ghostcoach-production.up.railway.app/api/social/status`
   answers `"duos":true` within 30 seconds.
5. **Try it with a second account**: sign in to the app as yourself (Max), pick
   a username; on a second PC (or a second Windows user) sign in with another
   email (no plan needed), pick a username. On yours, Duos (account menu),
   Make an invite code; on the other, paste it, Join. Both may turn
   Discoverable on (Profile) to see "found"; a Discoverable turned on before
   Duos shows off and must be turned on again. Play one match together on one
   team, both recording; once both reviews are linked to Riot's record (a few
   minutes after the match), the match shows under Shared matches on both
   within a few minutes, then the clips. In the Railway log look for
   `[duos] a duo was made`, `[duos] a match was shared`, and no `[duos] route
   failed` or `[duos] the sweep failed`.
   **Two checks on the real project**, both made safe in code either way:
   (a) a second PUT to an upload URL already used, sent WITH
   `x-upsert: true`, must be refused (storage-js sends that header from the
   PUT; the design assumes Supabase obeys the token's own claim of no upsert;
   if it does not, the server's look at the file's size at `/clip/done` and
   again at every download URL is the guarantee: a grown file is deleted);
   (b) an upload over the plan's file limit: note whether Supabase answers
   413, or 400 with `"statusCode": "413"` in the body (the app reads both as
   too large).
6. **Turning it off**: unset `SOCIAL_DUOS_ON`. At once nothing of Duos is
   answered or shown; the sweep keeps expiring what is stored.

## Taking it away

1. Unset `SOCIAL_DUOS_ON`, then **wait 26 hours**: an upload URL issued just
   before lasts about 2 hours, and a slow PUT started inside it can land later
   (the trash keeps a path that long for the same reason).
2. From `server/` with the server's environment: `node scripts/duos-purge.js`
   (a dry run: how many files), then `node scripts/duos-purge.js --apply` (every
   file the database knows and every file the bucket lists, removed through
   the Storage API; deleting rows never deletes a file).
3. Run `docs/sql/social-002-duos-undo.sql` (before 001's undo, if that too).
4. Delete the empty `duo-clips` bucket in the dashboard.
