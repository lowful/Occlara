# Public profiles and player search (built 2026-11-25, reworked twice the same day after security reviews, not yet live)

The owner's ask: "a way to search for users in occlara similar to valorant
tracker and see if they use occlara and to see their stats as well and their
rank", the foundation Occlara Duos (friends, a shared match page) is built on
next. Sections: "What it is", "The rule it changes", "The Riot ID proof ships
off", "Proving a Riot ID", "Residual risks", "Why not verified by play", "The
rank", "The tables", "The routes", "Privacy and safety", "What search can
still reveal", "The app", "Tests", "Turning it on (the owner's runbook)",
"What Duos adds".

## What it is

A signed in player picks a username and may make a public profile. Other
signed in players find it on the Players page by the start of a username (3
characters at least), and, once the Riot ID proof is on, by a whole Riot ID.
They see the username, the Riot ID once its owner PROVED it (and unless they
turned "Show my Riot ID" off), the rank, and Occlara's numbers from the
player's own PC (matches reviewed, record, average grade and its letter, K/D,
headshot share, main agents and maps, the last 10 matches, multi kills and
clutches won, Wrapped's title). Never a mistake, a weakness, a review, a
clip, an email or a free text: the only thing a user types that others see
is the username.

## The rule it changes

`games.md` and CLAUDE.md: no other player's Riot ID is shown, only agents and
numbers. That STAYS for everyone who has not opted in. The one exception (the
owner, 2026-11-25) is a user's own Riot ID, proved in the game, on their own
public profile and in search, because they turned it on. Nothing else reads a
profile's Riot ID.

## The Riot ID proof ships off

It was built without a live HenrikDev to try it on, so it is OFF until the
owner has proved his own Riot ID with it: the server env var
`SOCIAL_RIOT_PROOF` must be exactly `1` (`social.js riotProofOn`). Off:

- `/riot/start` and `/riot/check` answer one fixed `404 { ok: false, reason:
  'not-available' }`, call nothing (no database, no HenrikDev) and count
  nothing;
- `/status` says `riotProof: false`;
- a whole Riot ID search answers `{ results: [] }`, the shape of any miss;
- no profile, result or `/me` shows or answers a Riot ID (a rank shown is the
  one the player's own PC sent), and no rank is looked up;
- the app shows no Riot ID step, no "Show my Riot ID" switch and no word
  about Riot IDs on Profile, and the Players page says "by username" only.

Usernames, public profiles, search by username, blocks and reports work the
same either way.

## Proving a Riot ID

Occlara cannot use Riot Sign On (it needs Riot's approval), so ownership is
proved by doing something only the account's player can do, checked in Riot's
own record:

1. **Start** (`POST /api/social/riot/start { riotId: "Name#TAG" }`). The
   attempt is COUNTED FIRST, whatever follows (`social_challenge_attempt`: 2
   a rolling day and 6 in 30 days per account; a `riot-not-found` spends one
   too), so a refused start asks HenrikDev nothing. Then the account is looked
   up FRESH (`coach.js socialRiot.account`: `/valorant/v2/account`, remembered
   5 minutes at most and never served stale; a name with no account
   remembered 10 minutes), and its newest matches are read. The server names
   a SEQUENCE of owned agents (Brimstone, Jett, Phoenix, Sage, Sova; the game
   data has no base content flag, so `BASE_AGENTS` writes them out):
   - THREE different agents (60 sequences) with at least two the account has
     not played in its last 10 matches (`candidatesFor`);
   - FOUR different agents (all 120) when fewer than two owned agents are
     unplayed there (a player who rotates them, as a new account does).
   The database picks one (`social_challenge_start`, under an advisory lock
   on the Riot account's hash, in an order a seed shuffles) that NO OTHER OPEN
   CHALLENGE on that Riot account holds, by anyone; a partial unique index on
   (hash, sequence) where open enforces it. When every sequence of the length
   is held, the answer is the ordinary "try again in a few minutes", the same
   as a spent budget. Stored: user, the puuid as the free allowance's salted
   HMAC, Riot's name and tag, region, the sequence, issued, expires (4 hours).
   Nothing in a start's answer depends on what other accounts did with that
   Riot ID.
2. **Check** (`POST /api/social/riot/check`). Counted, spaced (a minute) and
   capped (30) in the database before Riot is asked; a check Riot could not
   answer (`try-later`) gives its count back. The account is looked up fresh:
   another puuid behind the name is `other-account`. The match list is used
   only to FIND a candidate (`judge`): the sequence as CONSECUTIVE matches of
   the account's history, each started after the challenge was issued and
   after the last match any earlier proof on that Riot account used, and
   before it expires. A list row naming another puuid is `other-account`.
   Then EACH candidate match is CONFIRMED in Riot's own match record
   (`socialRiot.match`, `/valorant/v4/match/{region}/{id}`, the call
   `/match-rounds` makes, players kept only as hashes): the player with the
   challenge's puuid must be in it and have played that agent, and the start
   times come from the record. A record without that player fails closed
   (`other-account`). Otherwise the result is said: `not-yet`, `half` (with
   how many of the sequence are in), `wrong-agent`, `in-between`, `used`,
   `expired`.
3. **On a pass** (`social_challenge_pass`, under the same lock): the matches
   must still be newer than the last proof's on that Riot account
   (`social_riot_used`), else `used`; then the profile holds the Riot ID, ANY
   other profile holding that Riot account loses it (`takeover`: proof of
   current control wins, its owner is told and can prove again), and the
   last match's start is kept so those matches never serve another proof.
   Two passes at once are serialised by the lock: one passes, the other is
   `used`, never a 500.

**What the code relied on, and where it is used already:** the match list is
`/valorant/v1/stored-matches/{region}/{name}/{tag}?size=10` with no queue
filter, the call `/last-match` makes to find a match that ended minutes ago
(its rows' `meta.id`, `meta.started_at` and `stats.character.name`, which
`lastMatchRow` reads; `stats.puuid` is read when present, used nowhere else).
That deathmatch rows appear in it rests on `/last-match`'s own comment about
deathmatches crowding the list. The match record is `/valorant/v4/match`,
`/match-rounds`'s call; its players' `puuid` and `agent.name` are what
`riot-rounds.js playersOf` and `coach.js` already read, its
`metadata.started_at` what `/match-rounds` reads. Rows reach the list "a few
minutes after they end".

**Limits:** per account, 2 starts a day and 6 in 30 days (every attempt) and a
check a minute, 30 a challenge; per address, 20 starts an hour and 60 checks
in 10 minutes; per account route ceilings 10 starts an hour and 20 checks in
10 minutes; and every HenrikDev call of the feature through `coach.js
socialMay` (the shared key's throttle and 60 calls in 10 minutes server
wide; a cache hit spends none). NO limit and no answer depends on what other
accounts did with a Riot ID (a cap per Riot account, in the first rework, let
three free accounts lock its owner out and told a stranger someone was
trying; it is gone), except the uniqueness rule above, whose refusal is the
generic try later.

## Residual risks

Said plainly, for the owner's call:

- A player who rotates the owned agents can, very rarely, satisfy an
  attacker's four agent sequence by their own natural play within the
  attacker's four hours. The real owner can always take the Riot ID back by
  proving it again.
- Holding every sequence open against one Riot account (to keep its owner
  from starting) needs dozens of accounts, each limited to 2 starts a day,
  renewing every 4 hours, and only delays the owner.
- The match list and the account are HenrikDev's view of Riot's data; if it
  is wrong, the proof is wrong. Each match is confirmed in Riot's own match
  record, which narrows this, it does not remove it.
- Real proof of ownership is Riot Sign On, which needs Riot's approval.
  Turning this proof on for everyone is the owner's call; applying for RSO is
  the lasting fix.

## Why not "verified by play"

The first build verified a Riot ID when the server saw the account's own live
link (`/match-rounds`, `purpose=live`) name it in three matches. The first
review showed it proved nothing: `/match-rounds` takes the match id, the Riot
ID and the purpose from the client, and a live usage row holds no match id,
so anyone could link a stranger's public matches and wear their Riot ID.
Passive observation cannot prove ownership. The second review then found the
two agent proof's flaws (two open challenges could share a sequence and ride
one honest play, a pass did not spend its matches, the per Riot account cap
was a lockout and an oracle, the budget could be burned for free, identity
rested on the name based list): this design answers each.

## The rank

A **proved** profile shows the server's rank, labelled "Verified":
`coach.js socialRank` (the fresh account lookup, then MMR v3 by puuid), at
most every 6 h a profile, 20 refreshes in 10 minutes server wide, only when
viewed or its owner's app asks `/me`, never awaited, and only while the proof
is on. A DIFFERENT account behind the name unverifies at once (`renamed`); NO
account behind it is noted the first time and unverifies (`gone`) only on a
second failure at least 6 hours later (`social_note_gone`); a success clears
the note. The owner is told why on Profile.

An **unproved** profile (or any profile while the proof is off) shows the
rank its own app sent in the snapshot (the tracker profile of the Riot ID in
Settings), validated against the real tiers, labelled "From this player's
PC". Never both. No rank tier icons ship in assets/, so a rank is words.

## The tables (docs/sql/social-001-profiles.sql)

Run by hand in the Supabase SQL editor (the repo keeps hand run SQL in
`docs/sql/`). Named `social_*`, not `profiles`, because a Lovable made project
often has a `public.profiles` of its own.

- `social_profiles`: username, `username_key` (NFKC then lower case, unique)
  and `username_fold` (look alikes folded, unique: KestreI, Kestre1 and
  Kestrel are one name, 0sprey and Osprey too), the opt ins, the proved Riot
  ID (name, tag, key, region, hash, verified at), `riot_gone_at`, why it was
  lost, the rank, the snapshot.
- `social_username_holds` (by fold): 30 days; no user id after deletion;
  older holds deleted on every username write.
- `social_blocks`: the blocked name AS THE BLOCKER TYPED IT and its key; the
  only name ever listed; unblock by it.
- `social_riot_challenges` (sequence `agents text[]` and `seq`, unique per
  open Riot account), `social_riot_attempts` (every start counted),
  `social_riot_used` (per Riot account, the last match a proof used).
- Keys are made in JavaScript and compared as they are; the SQL never matches
  with Postgres `lower()`.
- RLS on for all six, no policy, every privilege of PUBLIC, anon and
  authenticated revoked (over Supabase's default privileges), and EXECUTE
  revoked from them and granted to `service_role` on an EXPLICIT LIST of the
  22 functions this migration creates; the undo drops exactly that list (no
  pattern that could touch another `social_*` function).
- Usernames under concurrency: the account's row, then an advisory lock per
  fold, then the holds are read.

## The routes (server/routes/social.js, /api/social)

`GET /status` (`{ live, riotProof, duos }`, duos.md), `GET /me`, `GET|POST /username`, `POST
/flags`, `POST /stats`, `GET /profile?name=`, `GET /search?q=`, `POST
/block`, `POST /report`, `POST /riot/start`, `POST /riot/check`.

- **An account, signed in**: only `caller.via` `session` (the app) or `jwt`
  (the site). A licence key, even one linked to an account, is 403
  `sign-in-required` on every route, the proof's too. A request with no
  credentials is 401 `sign-in-required`; an outage 503. Not live: 503
  `social-not-live`.
- **Username rules**, byte for byte the same in `src/shared/social.js`: look
  alikes folded, reserved words, the block list, once every 30 days; plus the
  fold's uniqueness in the database.
- **Search**: a whole `Name#TAG` exactly (only while the proof is on), or a
  username start of 3 or more; public only, never a blocked pair, at most 10.
- **The snapshot**: whitelisted, every number in range, the whole refused
  when impossible; 8 KB; only while public, deleted on private.
- **Report**: a reason from a fixed list, into `feedback_reports`.
- **Nothing that names an account leaves**; **one answer in shape and time**
  for `/profile`, `/search`, `/username` and `/block` (the 250 ms floor,
  refusals and 429s included); **a double slash is made one** before every
  route and limit (`collapseSlashes`), so it is the same path under the same
  limits.
- **Rate limits** (`rate-limits.js routeLimits`): search 20 a minute and 200
  a day per account, 60 a minute per address; a profile 60 in 10 minutes and
  400 a day per account, 60 a minute per address; the username 60 in 10
  minutes; the snapshot 20 an hour; a report 5 an hour; flags and blocks 30
  in 10 minutes; riot start 10 an hour per account and 20 an hour per
  address, riot check 20 in 10 minutes per account and 60 per address;
  everything under /api/social 240 in 10 minutes.

## Privacy and safety

- Opt in only. Off removes the profile from search and view at once and
  deletes the snapshot. Deleting the account deletes its row, blocks,
  challenges and attempts; its name is held 30 days with no user id.
- Minors use Occlara: no bio, no avatar upload, no free text but the username.
- The app makes no social request with no account to ask with, and none mid
  match.

## What search can still reveal

Whether a username (or one that reads as it) exists, through the availability
check; public profiles by a username start of 3, 10 at a time, within the
limits; whether a whole Riot ID has a public, proved profile that shows it.
Not revealed: private profiles, blocked pairs, a Riot ID that is not proved
or not shown (or any while the proof is off), and anything about who else
started a proof for a Riot ID.

## The app

- **Profile, "Public profile"** (hidden unless `/status` says live): the
  username; with the proof on, **Riot ID** with its state and the steps (the
  Riot ID and Start; the three or four agents with their portraits, the plan,
  the time left; Check, and what it found, "This proves the Riot ID is yours,
  so nobody else can show it."), and the Show my Riot ID switch; with it off,
  none of that and no word of it; Public, Discoverable, the preview, Blocked
  players, Find players.
- **Players**: the hint, the field's label and placeholder follow `riotProof`
  ("by username" alone when off); results, a profile with its rank labelled
  "Verified" or "From this player's PC".
- **Main** (`social-service.js`): reads `riotProof` from `/status` and passes
  it on; every channel null mid match; the snapshot after a review, at launch
  and on going public, only while public.

## Tests

- `test:social` (106 checks), every route on the real SQL (PGlite), the
  proof end to end on fixtures of the match list AND the match records, both
  ways of the flag, every case of the second review (two challenges on one
  Riot account in both orders, matches reused, a refused or not found start
  calling nothing on repeat and spending an attempt, a linked key on the
  proof's routes, a record without the puuid, a changed name, two passes and
  two starts at once, the lockout gone, the four agent rule), `coach.js
  socialRiot` on a fake fetch (negative cache, no budget on a hit, hashes
  only), the wiring and the floor.
- `test:socialsql` (50 checks): the migration twice over Supabase's default
  privileges, privileges on all six tables and every function, the grant
  block and the undo listing exactly the created functions, the privacy cases
  and their mutants failing, folds, holds, sequence uniqueness (by index and
  under two starts at once), the window, matches used once (two passes at
  once), the takeover, attempts, cascades, the undo.
- The review's `repro.js` calls `pickAgents`, which no longer exists; an
  adapted copy (that one line) shows the attacker never passing, no lockout,
  no oracle, and riot-not-found starts spending attempts.

## Turning it on (the owner's runbook)

The whole feature has one switch, `SOCIAL_ON` on Railway (exactly `1`,
`routes/social.js switchedOn`). Without it every route but `/status` answers
503 `social-not-live` before doing any work and `/status` says not live, so
the app hides everything, whether or not the tables exist. It is also the way
to hide the feature again at once, with no SQL undone.

1. Deploy the server (Railway builds it from the push). Safe before the SQL.
2. Run `docs/sql/social-001-profiles.sql` in the Supabase SQL editor. Nothing
   changes for players yet.
3. Set `SOCIAL_ON=1` on Railway (it redeploys). Check
   `curl https://ghostcoach-production.up.railway.app/api/social/status`
   answers `{"live":true,"riotProof":false}` within 30 seconds. Usernames,
   public profiles and search by username now work for every app from 8.19.
   Try it on your own account first: pick a username, turn Public on, find
   yourself on Players. If anything is wrong, unset `SOCIAL_ON`.
4. The app carries the feature from 8.19.0; it shows by itself once step 3
   says live (the app asks `/status` again within a few minutes).
5. **The Riot ID proof, when you choose**: set `SOCIAL_RIOT_PROOF=1` on
   Railway (it redeploys), confirm `/status` says `"riotProof":true`, then
   prove YOUR OWN Riot ID first from the Profile page: Start, play the three
   or four agents it names back to back (Deathmatch is quickest), wait a few
   minutes after the last one, press Check. In the Railway log look for
   `[social] a proof of control was started (3 agents)` (or 4),
   `[social] a Riot ID was proved`, and no `[social] the account lookup
   failed`, `the match list failed` or `a match record failed` lines. If a
   check keeps answering "not yet" well after the matches ended, or a real
   play is refused, the match list or records are not what the code expects:
   turn it off and send the log.
6. **Turning it off**: unset `SOCIAL_RIOT_PROOF` (or set anything but 1). At
   once no Riot ID is shown, searched or answered anywhere; proved Riot IDs
   stay in the table and show again when it is turned back on.
7. Support: to clear a Riot ID by hand, `SELECT public.social_unverify('<public id from the report>', riot_puuid_hash) FROM public.social_profiles WHERE public_id = '<id>';`
8. To take it all away: `docs/sql/social-001-profiles-undo.sql`.

## What Duos adds

Built 2026-11-25, off until `SOCIAL_DUOS_ON=1` (docs/claude/duos.md):
`discoverable` now finds teammates who also use Occlara after a match played
together (both on, one team, mutual), but only once turned on again under
Duos' words (a flag set under "Nothing is shared yet" reads off: duos.md,
"Consent"); the block list ends a duo and hides it both ways by a trigger on
`social_blocks`, and `/status` answers `duos` too. An invite by username adds
nothing to "What search can still reveal": it is answered `sent` whoever the
name is, and reaches only a public profile.
