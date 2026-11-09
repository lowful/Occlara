# Accounts, tiers, game caps and referral (8.7)

Sections here: "What an account is", "Counting games", "Free games are one
per player (8.8)", "Signing the app in", "Referral", "Switches", "Not in this
repo". The licence path of 8.6 is
unchanged underneath all of it, and a server without the new tables serves
8.6 keys exactly as before.

## What an account is

A Supabase user with one `entitlements` row: tier `free`, `pro` (25 games a
month) or `max` (70 a month), `free_total` (4 for life, 6 if invited; 2 and 4 before 2026-11-09, 3 and
5 before 2026-11-04),
`bonus_pool` (referral games and, from 8.8, games bought at $2 each, which
never expire: licence-billing.md, "Games bought one by one") and
`bonus_earned` (referral games only, the cap of 20), `source`, the Stripe
subscription, `period_anchor`, status `active` or `ended`, `renew_as`, and
`account_key`, the GC key shown on the account and accepted as the fallback
sign in. The cap is monthly even on a yearly plan: the period is the anchor
stepped by whole UTC months (Jan 31 steps to Feb 28, then Mar 31).

`ensure_entitlement` makes the row on first ask. A user with a licence maps
from it by the payer rules: weekly and monthly become Pro at their price until
they cancel, yearly becomes Max until its renewal and then renews as Pro yearly
(`renew_as 'pro_yearly'`), lifetime becomes Max for life. A user with no
licence gets a `plan 'free'` licence (active, no expiry), so the key fallback
works for free accounts too. `server/scripts/backfill-entitlements.js` makes the
rows for every licence holder, dry run by default, `--apply` to write.

**The free count lives in one place per side.** Server: `FREE_GAMES` and
`INVITE_EXTRA_GAMES` in `server/services/caller.js` (used by `usage.js` redeem,
`INVITED_FREE_TOTAL`, and by `backfill-entitlements.js`). Client:
`src/shared/usage.js FREE_GAMES` and `FRIEND_GIFT`. The SQL must say the same:
`free_total`'s DEFAULT and the two `ELSE n` in `ensure_entitlement`. Moving
Free from 3 to 2 took a follow up migration (`ALTER COLUMN free_total SET
DEFAULT 2`, `ensure_entitlement` again with `ELSE 2`, and untouched rows moved
3 to 2 and invited 5 to 4). Moving it from 2 to 4 (2026-11-09) took another,
`0010_free_tier_four_games.sql`: `SET DEFAULT 4`, `ensure_entitlement` (0008's,
gifts and all) with `ELSE 4`, and every active free account raised once by 2,
played or not (2 to 4, invited 4 to 6), so a player who had used both games
plays 2 more. Raising `free_total` is the whole change: the free allowance is
`free_total` minus the free games used (`entitlement_allowance`), and the
person and device rules are untouched. `test:claimgame` with `OCCLARA_SITE_DIR` checks the
last word of the site's migrations against `FREE_GAMES`. The site's own copy is
`src/data/plans.ts FREE_GAMES` in the site repo.

New sales still mint a licence with plan `monthly` or `yearly`, never `pro` or
`max`, because the 8.6 client's `usable()` is shipped and only knows the old
plans. The tier comes from the Stripe Price lookup key
`occlara_{pro,max}_{monthly,yearly}` (`billing.js tierOfPrice`). The site's
create-license mints the key of a site sale and sets `account_key` to it; the
webhook sets the tier, cap, source, subscription and anchor and never mints for
a site sale, so the two cannot make two keys.

The refund rule of licence-billing.md holds and goes further: a full
`charge.refunded` or any dispute revokes and cancels first, unchanged, then
sets every account of those licences to free, cap 0, `free_total` 0,
`bonus_pool` 0, status ended. A partial refund writes nothing. A late
`invoice.paid` never brings back an account its own refund ended.
Subscription deleted sets free, cap 0 and keeps the free games, and so does
an update to unpaid or paused (no deleted event comes for either; past_due
keeps the plan, licence-billing.md).

An ended account never gets a game back, by any path: `claim_game` never
plays it on its bonus pool, a bonus game refunded after the refund (settle,
stale, release) refills the pool only while the account is `active`, an
invite it made qualifies as `inviter-ended` with nothing added, and redeeming
an invite on it is refused (`account-ended`). The webhook also ends the
account when a retried refund can only be matched by the customer's ONE
licence already refunded or disputed (`alreadyRevokedUsers`), and when a
refund lands before any licence or account names the subscription (the
starting checkout's `user_id`, `buyerOfSubscription`, unless another live
subscription pays for that account). A checkout whose licence is refunded or
disputed, or that was bought before the account was ended (`session.created`
not after `updated_at`), never grants again: a replayed lifetime completion
has no subscription for the older guard to match.

## Counting games

Every match counts once, in `game_usage`, by `claim_game` (it locks the
entitlement row, then the device row) and `settle_game`:

- **Live Valorant:** the read gate (`usage.js createMeter`) refuses /read with
  402 `{error:'cap', left:0}` BEFORE the model call when the account has no
  open live row and no allowance. The first in-match reply claims the game
  (`inMatchState`: a phase, a round or both scores; LOBBY never claims).
  Reaching 120 match reads, or a successful /match-review, counts it. A match
  that ends short (under 120 reads, no review, 45 min quiet) is given back, at
  most 3 refunds per account per rolling day (`refund-cap` after that).
- **Riot-record-only reviews** (backfill) claim `riot:<matchId>`, **League**
  games of 5 min or more claim `lol:<startedAt>`, through `POST
  /api/usage/claim`, counted at once. Refused means the review is saved
  `locked: true`.
- Free games are refused (`device`) on a device whose first account already
  used its free games, and from 8.8 (`person`) on any account of a player
  whose free games another of their accounts used ("Free games are one per
  player", below). Errors never refuse: the server grants with reason
  `unavailable` or `not-live`, and the client lets Start through on any error.
- **The device is the caller's, never the body's.** `/usage/claim` takes the
  session's device (fixed at exchange) or the key's (`licenses.device_id`);
  the body's `device_id` only for a key not activated on a device, and a site
  JWT cannot claim. A fresh `device_id` per request walked past the device
  rule and qualified invites with nobody playing.
- **A live claim never carries a client id.** `/read` ignores `clientMatchId`:
  claim_game answers a known id with its first row whatever its status, so
  one id sent every match replayed a counted game forever.
- **One meter row per account AND device** (`rowKey`), and claim_game reuses
  an open live row of the same `device_hash` only: one account on two PCs at
  once is two games.
- **A late review never counts the next match.** /match-review is called
  again from `riotLook` once Riot publishes (90 s to 8 min on, with Riot's
  `matchId`), often during the next match. Such a review (`late`) leaves a
  row read in a match in the last minute alone and never falls back to the
  database (`reviewDone`).
- **A restart forgets nothing that matters.** The read gate lets a read
  through when account_state says 0 left but the caller has a reserved live
  row under 3 h on this device in the database (its own last game), and
  `account_state` runs `entitlement_settle_stale` like claim_game, so a row a
  restart orphaned is given back where `left` is worked out.
- **A Riot record run taken back releases its games.** `backfill.js takeBack`
  calls `POST /api/usage/release` (`release_game`) for every claim the server
  granted: the caller's own counted `riot` row, under 24 h, within the 3 a
  day refund cap.

**The 402 is silent.** The engine stops reading for that match, recording
goes on, and the review is saved locked: Riot's record stats and an upgrade
card, no Verdict, grade, read, rounds, Ask, reveal or sound. Start refuses only
when `me()` said `capped: true` in the last 5 minutes, and with no games left
one read every 5 minutes asks again. Every cap or games left line waits for
the seal to lift (screen-silence.md).

`402 {error:'cap'}` is not the old `402 {error:'ai-credits'}`; both stay.

**A capped account's last game is not a six hour pass (8.7.3).** The review
gate's window (a live game open or counted in the last 6 h) exists for the
late review, but it let a capped account have the model review and look at
every refused match after its last counted one, for six hours. Now, while
`account_state` says 0 left, each live game in the window gets
`REVIEWS_PER_GAME` (4) reviews and 4 looks (the engine's, the late one, two
spare), then 402 cap before the model (`usage.js reviewGate`, `withinBudget`,
the `spent` map, bounded like the others). An account with games left, or one
whose count cannot be had, is as before. `test:caplock` drives every model
route for Free 4 of 4, Pro 25 of 25, bonus games used and a legacy key, in
shadow and enforced, plus refunds and bought games.

**Ask Coach is locked with the games (8.7.3).** With `ENFORCE_CAPS=1`, an
account the read gate would refuse (`usage.js gate`, asked with `count:
false` so `gated` stays reads and reviews: `account_state` says 0 left and no
live game of this device is open) gets no model on `/chat` (v1 and v2) or
`/frame-chat`, nothing booked and no daily cap line (`coach.js chatLocked`,
before the spam guard and the daily cap). Never a 402, which every shipped
client says as "out of credits". Said per client version:

| Client | Answer | What the player sees |
| --- | --- | --- |
| 8.7.3 and later | 429 `{ error: 'chat-cap', left: 0 }` | Ask Coach: a calm line (`chat.locked`) with an Open Profile button; frame chat: the same sentence (index.js `chatFailureText`) |
| 8.7.2 | 200 `{ reply }`, `CHAT_LOCK_LINES.profile` | the coach's answer: "You have used all your games. Get more games in your Profile or upgrade your plan to ask me about your matches." |
| before 8.7.2, or no version | 200 `{ reply }`, `CHAT_LOCK_LINES.site` | the same, naming occlara.app instead: those builds have no Profile page |

A 429 `chat-daily` was not used for 8.5.0 to 8.7.2: those clients say it as
"Ask Coach is back at" a time, which a game cap has not. Shadow, a legacy key
before `LEGACY_CAP_FROM`, accounts not live and an `account_state` that
cannot be read are answered as before: never locked on an unknown. Games
bought lift it at once: the webhook's grant calls `forgetGamesLeft`, which
forgets the meter's 30 s memory of the buyer (`meter.forget(userId)`: the
games left, a refused read's row) and the resolver's entitlement. A new month
lifts it within 30 s. The player's last game counted, its review is not open
to Ask Coach either: that is the read gate's rule, as asked. `test:caplock`
holds every version on chat, v2 chat and frame chat for Free 4 of 4 and Pro
25 of 25 (no model, no cost, no cap line), shadow, an outage, games left,
bought games and a new month.

## Free games are one per player (8.8)

Until 8.8 the Free tier's 2 games (4 invited) were per ACCOUNT: spend them,
sign up with another email, have 2 more. Now they are the person's. The
server notes an account's keys (`server/services/free-allowance.js`), the
database decides (`free-allowance.sql`, given to the site as its own
migration), and an account whose STRONG keys meet another account that
played a free game BEFORE this one played its first has 0 free games:

| Key | Where it comes from | Strong |
| --- | --- | --- |
| `puuid` | the Riot account, found by the server in Riot's record of a match (`/match-rounds`, `puuidInMatch(riotRounds.playersOf(d), name, tag)`), never a puuid the client names, and only on the live link of a match the app recorded (`purpose=live`, a match Riot says started in the last 24 hours, `linkMayNote`) when the server also holds a live game of that account's own (a `game_usage` row, kind `live`, reserved or counted) claimed within 2 hours of Riot's start (`playedLive`, `PROVEN_MS`): the purpose is client sent and never enough alone, a review the cap locked (no claim, no row) notes nothing, and neither does a Riot ID typed into Settings or Connect, a fill or a backfill. ONE PER ACCOUNT: only the first puuid ever noted for an account is kept (below) | yes, until its holders span 3 machines and 3 emails |
| `device` | the app's device id (`computeDeviceId`), as the session holds it since the exchange, or the key's `licenses.device_id` | yes, until its holders span 4 Riot accounts (each holder's first noted one) |
| `machine` | Windows' MachineGuid, read with reg.exe and hashed on the PC (`src/main/services/machine-id.js`), sent at sign in as `machine_id` and, from 8.7.4, as the `X-Occlara-Machine` header on every `/account/me` (below): the same through a new Windows user or PC name, but the same on every PC cloned from one image (Sysprep keeps it). reg.exe runs by its absolute path, `%SystemRoot%\System32\reg.exe` (`C:\Windows` when SystemRoot is unset, `regPath`), never through PATH | yes, but met on it ALONE a new account plays 1 free game, and the rest once its Riot account differs from the earlier holders' (below), and it is ignored once its holders span 4 Riot accounts (each holder's first noted one) |
| `email` | auth.users (or the verified JWT's own claim), `canonicalEmail`: lowercase, googlemail is gmail, gmail dots gone, a plus tag gone at gmail.com, outlook.com, hotmail.com and its country domains, live.com, msn.com, icloud.com, me.com, mac.com and Proton (proton.me, protonmail.com, protonmail.ch and pm.me are one domain), Yahoo's hyphen keyword gone at yahoo.com, its country domains and ymail.com. Each domain is written out whole (`HOTMAIL`, `YAHOO`, `PLUS_DOMAINS`): a domain that merely starts with a provider's word (live.example.org, outlook.example.com) is left alone, as is every other domain, dots and plus kept. Before this a pattern on the first word folded those too, and Fastmail, Zoho, Yandex, GMX, AOL, Tutanota and HEY were folded, now they are not | yes |
| `net` | the sign in's /24 or /48 (`ipPrefixHash`) | NO, never blocks alone: a household or a cafe shares one |

Each key is `HMAC-SHA256(ACCOUNT_HASH_SALT, kind|value)`, so
`free_allowance_keys` holds no email, puuid or id. Keys are noted at the
exchange (email, device, machine, net), on `/account/me` (email, device,
machine from the `X-Occlara-Machine` header),
before every claim (the meter's live claim and `/usage/claim`), at redeem
(email, net) and on `/match-rounds` (puuid, also on its cache hit through
`puuidOf`, both through `noteLinkPuuid`, so only with `purpose=live` and a live game of its own around the match). Each user's keys are sent at most once every 10 minutes, and
whether it is shared is remembered 30 s.

What the rule does:

- **Who is first** is the account whose first free game it still holds
  (reserved or counted, never one given back) is older, ties to the lower
  user id. A free game given back (a short match, a Riot record run taken
  back) is not a game used. A refunded or disputed account's free games
  still count: a refund is no way back to free games. An account a refund
  or a dispute ended (status `ended`) counts as first even with no free
  game at all, when it was made before the other played its first: a payer
  refunded from the start is still the first holder of its keys, and a
  second account of that person gets none. That holds after a new purchase
  makes the ended account active again: `free_allowance_ended` remembers
  every account ever ended (a trigger on `entitlements`,
  `free_allowance_mark_ended`, plus a one time fill of the accounts already
  ended), so being first never depends on today's status. An ended account
  made after another played first takes nothing from it. And an ended
  account is first only through a key it shares DIRECTLY, an email, a
  machine or a device (`met.direct`), never a puuid alone: a griefer who
  played one match beside a stranger, its live link naming the stranger's
  Riot ID, then refunded, must not take the stranger's free games (a
  griefer who played a free game first still meets a victim through the
  puuid, as before, which the crowd rule below bounds).
- **One Riot account per account.** Only the FIRST puuid ever noted for an
  account is its key. A later, different one is never noted:
  `noteLinkPuuid` refuses it before the database (`heldPuuid`, the account's
  puuid rows read once and kept, `counts.secondPuuid`), and
  `free_allowance_note` refuses it again in the database (under an advisory
  lock per account, so two notes at once never write two), deciding alone
  when the server cannot say. The same puuid again only moves `last_seen`.
  `free_allowance_shared`, `free_allowance_related` and
  `free_allowance_apart` meet through that one puuid only
  (`free_allowance_first_puuid`, by `first_seen` then key), and a puuid's
  holders, for its crowd, are the accounts whose one puuid it is, so a
  second puuid row written before this rule (or by a race) blocks and
  relates no one. A griefer whose live link names other players of its match
  takes at most one victim per account, and a person's own Riot account,
  read first off their own live game, stays their key.
- **The machine id on every session.** The app sends the hashed machine id
  (`machine-id.js machineId()`, the cached read, the same value it sends at
  exchange) as `X-Occlara-Machine` on its authed `/account/me`
  (`account-service.js meNow`, `/me` only, never in `auth()`), and
  `/account/me` notes it like the exchange does (`noteCaller` with
  `machineId`, `keysFor` drops anything not 64 hex, the same HMAC), so an
  account signed in on 8.7.3 or earlier, which never sent it at exchange,
  gains its machine key on its first 8.7.4 launch. Who played first decides
  as for every key. An old app sends none, and a missing or malformed
  header changes nothing.
- **Met on the machine key alone, one free game first.** A PC cafe's every
  seat sends one MachineGuid, and refusing there outright was a deadlock: a
  refused player never plays, so no Riot account is ever read off a live
  game, so the room can never show the crowd rule it is many people. So
  when the only key an account meets another on is the machine (no device,
  email or puuid of that account met as well), `free_allowance_shared`
  lets its FIRST free game through (`me.t IS NULL`), and the rest only
  once `free_allowance_apart` says both have their one puuid noted and the
  two differ. The same puuid, or an earlier holder with none noted (an 8.7 app,
  or one that only ever graded from Riot's record), still blocks the
  rest. A machine match that also meets a device, an email or a puuid
  blocks exactly as before. The trade: one person with a new Windows user
  name and a new email per account gets 1 free game per extra account,
  never more, while the same Riot account is read off it. With a new Riot
  account per extra account as well they look exactly like a cafe of
  different people and get all of them: that is the price of never locking a real
  room out.
- **A crowded key is no key** (`free_allowance_key_counts`), ignored by
  `free_allowance_shared` and `free_allowance_related`, so a Riot ID shared
  or griefed, or a Windows image cloned across a PC cafe or a school lab,
  never blocks everyone after the first player. A key is crowded only when
  its holders are DIFFERENT PEOPLE by a key independent of it, never by a
  count of accounts: before this it was "a puuid held by more than 2
  accounts, a device or machine by more than 3", and one person could make
  that crowd and switch their own key off (A plays 2 free, B and C on the
  same PC with the same Riot account push the puuid to 3 holders and both
  had free games back, 4 Windows user names did the same to the machine
  key). Now a puuid is crowded only when its holders span at least 3
  distinct machines (an account's machine keys, or its device keys when it
  has none) AND at least 3 distinct canonical emails, and a device or a
  machine id only when its holders span at least 4 distinct puuids (a cafe:
  many Riot accounts on one cloned id), each holder counting only its FIRST
  noted puuid (`first_puuid`, by `first_seen`), the only one noted now
  anyway, so one account whose live link names four players of its one
  match never makes that crowd alone.
  An account with no value for the independent key adds nothing to its
  count. The email is never crowded, and the 8.7 device rule
  (`devices.free_used`) still holds on its own. The machine and device ids
  the puuid count leans on are client sent.
- **Only the free allowance.** `entitlement_allowance` gives 0 on the free
  branch alone. Pro, Max, games bought and games earned from invites
  (`bonus_pool`) are exactly what they were. A shared account can sign in,
  open every review it already has and buy. The same account signing in
  again, on a reinstall or a new PC, is never shared with itself.
- **Two at once.** claim_game takes `free_allowance_lock`, a transaction
  advisory lock per strong key in key order, before it works out the
  allowance (free or ended accounts only), so two accounts of one person
  claiming at the same moment run one after the other and the second reads
  the first's game. Refused, the reason is `person` (`device` still wins
  where the 8.7 device rule applies, which is unchanged).
- **The app says it calmly.** `/account/me` adds `free_shared: true` on a
  free account so shared, `usage.js capState` writes "You have no free
  games left" with "Free games are one per player." before the upgrade line,
  `gamesLeft` says "You have no free games left, free games are one per
  player", the Profile hero's last line starts with the same sentence. No
  accusation, never mid match (the cap lines already wait for the seal).
- **Invites.** Redeem refuses `self` when the invitee shares a strong key
  with the inviter and `free-used` (the site's default sentence) when the
  invitee is shared with anyone. `entitlement_qualify_referral` refuses
  `same-person` after the device check, so an invite between two accounts
  of one person never pays, even when the keys meet only after the redeem
  (a game bought on the inviter's machine, say).

**It degrades to 8.7, never to "accounts not live".** Every allowance call
has its own breaker: a missing function (42883, PGRST202, PGRST205, 42P01)
switches the allowance off for 5 minutes WITHOUT `resolver.noteError`,
which would switch caps off for everyone. An error or a timeout (`CALL_MS`
4 s, its own timer) is "cannot say": nothing refused, nothing waits longer.
With `ENFORCE_CAPS=0` a shared account's game is granted in shadow, reason
`person`.

**Free games need 8.7.4 (`caller.js FREE_PLAY_FROM`, `playsFree`).** An
app before it sends no machine id and no `purpose=live`, so it gives the
email, device and network keys and never a puuid: kept from updating, with
a new Windows user name and a new email per account, it met nothing but
its network. So with `ENFORCE_CAPS=1` the meter's `needsUpdate` refuses
the next game such an app would play on the FREE ALLOWANCE (account_state:
not an active Pro or Max, `allowance_left > 0`, `bonus_pool` 0), on the
read gate (`gate(caller, { req })` from `/read` and the agent look: 402
`{ error: 'cap', left: 0, reason: 'update-required', message }`) and on
`/usage/claim` (`{ granted: false, left: 0, reason: 'update-required',
message }`, unless that client match id was claimed already). Those are
the shapes an 8.7 app already reads as no game: the read stops silently for
the match and the review is saved locked, a claim's review is locked. The
sentence is `UPDATE_FOR_FREE`, "Update Occlara to keep playing your free
games.", in `message`: an 8.7 app shows its own cap card (it reads no
server text on an account), the sentence is for any app that reads it. A
paid tier's month, games bought or earned from invites, an account with no
free game left (its own cap or the person rule answers as before) and any
doubt (no account_state) are untouched, and with `ENFORCE_CAPS=0` the game
is granted and counted (`counts.oldFree`). account_state is remembered 30
s per account (`olds`). An account with free games left AND bought games
still plays on 8.7 (claim_game draws the free one first, as it always has).

`server/scripts/backfill-free-keys.js` (dry run, `--apply`, run with
Railway's `ACCOUNT_HASH_SALT`) notes the email, devices and networks of
every account that played a free game before 8.8, so an account spent then
that never comes back still counts.

What a determined player can still do: a new Riot account, on a new
Windows install or another PC, with a new email at a domain we do not fold
(or a new Gmail), never on a network or device we know. On one PC, a new
Windows user name, a new email AND a new Riot account per extra account
(each one's Riot account read off its own live game) gets both free games
per account, as a cafe player does, while with the same Riot account it is
1 per extra account. Four or more accounts on one machine id with four
different Riot accounts read on live links crowd the machine key out (four
Windows user names alone do not, nor one account naming four Riot IDs). A modified client that sends a made up machine and device id
per account, on 3 accounts with 3 emails, can still crowd out its own
puuid. The puuid is noted only with `purpose=live` AND a live game of the
account's own within 2 hours of the match's start, and `purpose=live` is what
`src/main/index.js riotRoundsFor` sends, and only it (`test:freeallowance`
holds both halves; before that line it sent none, and no puuid was ever
noted) (the client's live link, the
one call checked against the recording): a modified client can still send
it with any Riot ID from ANY match that started within 2 hours of one of its
own live games (`playedLive` proves a live game around then, not that match:
a live row holds no match id), but only the first puuid an account ever
notes is kept, so each griefing account takes one victim at most, and only
if the account noted no puuid of its own before. A puuid whose holders span 3
machines and 3 emails is ignored, but a griefer and its one victim (2 accounts) still meet,
and that victim, when its first free game comes later, loses the rest of its free games.
Every key except the email is sent by the client: the device id, the machine
id, the `purpose=live` link that lets a puuid be noted and the Riot ID named
in it, and the network the client connects from. Only the email is the
server's own (auth.users). So a modified client with a fresh email, a made
up device and machine id and no puuid can still get one more free allowance
per account. Two people who really share one PC share one free allowance, as the
8.7 device rule already meant. The machine id is client sent like every
device id.

## Signing the app in

`account-service.js signIn()` opens a one-shot loopback server on 127.0.0.1,
makes a state (16 bytes) and a PKCE verifier (32), and opens
`https://occlara.app/app/signin?state&challenge&port`. The site signs the
player in, and only when they press Continue posts `{state, challenge}` with
their Supabase JWT to `POST /api/account/handoff`, which answers a one-time
code (120 s), and sends the browser to `http://127.0.0.1:<port>/callback`.
The app posts `{code, verifier, state, device_id, device_name}` to `POST
/api/account/exchange` (single use, marked used before checking) and stores
the `occ_` token with safeStorage under `accountToken`, never logged. The
fallback link `occlara://auth?code&state` is taken only while a flow with that
state is pending (packaged builds register the protocol; appId untouched).

Every request then carries `Authorization: Bearer occ_...`, else
`X-License-Key`. `services/caller.js resolveCaller` reads either (and a
Supabase JWT, verified locally with ES256 against the project JWKS) into one
caller whose `accountKey` keys the rate limiters, the cost ledger, Ask
Coach's cap and presence: `u:<userId>` for a session, a JWT and a key whose
user signed in to the app, else the licence key, so an 8.6 key (legacy, and
every key while accounts are not live) keeps its 8.6 ledgers. A key is
`legacy` when its plan is not free and its user has no app session.

Traps in `caller.js`:

- **Email confirmed is auth.users' word** (`email_confirmed_at` via the cached
  `userOf`), never `user_metadata.email_verified`, which the user can write.
- **"Accounts not live" is 503 for a session, never 401.** The app drops its
  token for good on a 401, so a migration re-run or a schema reload would
  sign every player out. A session confirmed in the last 30 min is honoured.
- **The account lookups have their own breaker** (`DOWN_MS` 30 s): after a
  failed or timed out lookup none is asked, the last answer is served, and for
  10 min after a failure an expired answer is served at once and refreshed
  behind it. A hanging database used to add two 5 s timeouts to every key
  request, past the client's 12 s read timeout.
- **A free plan key needs 8.7.0 or later** (`knowsFreeKeys`, by
  X-Occlara-Version): older apps read a cap 402 as the AI out of credits, so
  `/license/activate` and `/validate` answer `update-required` and the coach
  routes refuse the key. The 8.7 release MUST bump package.json to 8.7.0, or
  its own free keys are refused.

Routes (`server/routes/usage.js`, under /api): `account/handoff`,
`account/exchange`, `account/signout`, `account/me`, `usage/claim`,
`usage/release`, `referral`, `referral/redeem`.

## Referral

`GET /api/referral` makes an 8 character code (`CODE_ALPHABET`, capitals and
digits 2 to 9, no 0 O 1 I) and the link `https://occlara.app/invite/<code>`;
the app hands a page only a link of that shape (`account-service.js
INVITE_LINK`, 4 to 16 letters and digits, the redeem's `REF_CODE`), which the
site's `isInviteCode` also accepts. The site keeps the code 7 days and redeems
it once after signup with the invitee's JWT. Redeem refuses self referral (an
account's age is no limit since 8.7, only that it has played nothing), an email not confirmed (401 `email-unconfirmed`,
which the site treats as "try again later" and keeps the code), one that has
played, a sixth friend, the
inviter's network (/24 hash), an inviter known on no network
(`inviter-unverified`: never signed in to the app) and an ended account
(`account-ended`). A key whose user never signed in to the app gets 403
`sign-in-required` from `GET /api/referral` (the Invite page says "Invites
need an account"). The friend gets `free_total` 6 (`INVITED_FREE_TOTAL`); on
their first counted
real game (source free, allowance or bonus, not over the cap, never shadow)
on a device that is not the inviter's, the inviter gets 4 games, up to 20
earned. The inviter's devices are their app sessions', the devices their
games were first claimed on (`devices.first_user_id`, checked by claim_game
before a free claim takes the device) and their licence's `device_id`.

## Buying games, in the app (8.8)

A game is $2.00 (`profile.js GAME_PRICE_CENTS = 200`), any whole number from
1 to 500 in one checkout (`MAX_GAMES_PER_PURCHASE`), with quick picks of 1,
5, 10 and 25. The app takes no payment: the Profile page's Buy asks main
(`PROFILE_BUY`, the number), which opens `https://occlara.app/buy?games=N` in
the browser only when `profile.isBuyUrl` passes (that origin, `/buy`, one
`games` parameter, a whole 1 to 500, nothing else) and never mid match or
while sealed. The site signs the visitor in with the same Supabase account,
re-validates N and makes the Stripe checkout (`create-games-checkout`), and
the server's webhook grants the games once per checkout session into
`bonus_pool` (not `bonus_earned`), where they never expire and are used after
the plan's own games. A refund or dispute of a games purchase takes back its
unused games and never touches the licence, tier or subscription
(licence-billing.md, "Games bought one by one"). Signed out (a licence key
alone) the button signs in first (`ACCOUNT_SIGNIN`). The games left the page
shows come from the account's view (`games`, `profile.gamesState`: tier,
left, cap_monthly, free_total, bonus_pool, period_end, never the email or
key), worded by `profile.hero`. `test:profile`, `test:surfaces` and
`check:seal` hold it.

`usage.js gamesLeft` (the rail's line) still calls everything in
`bonus_pool` "earned games", which a bought game is not: worth rewording to
"bonus games" once purchases go live.

## Gifts (8.8)

A player buys Pro or Max for someone else, one month or one year, at the
plan's own price (Pro $24.99 or $249.99, Max $69.99 or $699.99,
`services/gifts.js GIFT_OFFERS`, the site's `OFFERS`, the app's
`profile.js PLANS`, held equal by `test:gifts` and the site's
`edge-create-gift-checkout.test.ts`), sends a link, and the friend redeems it
once on their own account.

- **Buying.** The app's Profile page has Gift Pro and Gift Max at the cycle
  the Plans toggle shows (`PROFILE_GIFT`, main opens
  `occlara.app/buy?gift=<offer>` only as `gifts.isGiftBuyUrl` passes it, never
  mid match), and the site's pricing section links "Gift Pro or Max". The
  site's `create-gift-checkout` (JWT required, the offer one of the four, card
  only, one time, 8 checkouts in 10 minutes per account like games) makes the
  session with metadata `{ kind: 'gift', offer, user_id, from_name }` on the
  session and its payment intent. The webhook mints the gift
  (licence-billing.md, "Gifts").
- **The code** is 26 characters of Crockford base32, 130 bits, an HMAC of the
  checkout session id with `GIFT_CODE_SECRET` (Railway, 32 characters or
  more). The same session always makes the same code, so a redelivery mints
  nothing new, and the buyer's link can be made again for the Profile and
  Account pages without the code being stored: `gifts.code_hash` is its
  SHA-256. Changing the secret makes old links impossible to show again
  (they still redeem), so set it once. A pasted link, upper case, dashes,
  spaces, I or L for 1 and O for 0 all read as the same code
  (`normalizeCode`, the same in `src/shared/gifts.js` and the site's
  `lib/gift.ts`).
- **The link** is `https://occlara.app/gift/<code>`. The site page (noindex)
  asks `POST /api/gifts/peek` what it gives (plan, months, the buyer's first
  name only if they signed it, and `yours: 'buyer' | 'redeemer'` for a
  signed in caller), keeps the code in the browser 30 days for a visitor who
  must sign up (the confirmation email lands on the home page, and
  `GiftReturn` sends a signed in visitor with a kept code back to the gift),
  and redeems with `POST /api/gifts/redeem` and the visitor's own token. The
  app's Profile has a Redeem field too (`PROFILE_REDEEM`, through
  `account-service.js redeemGift`, the session's own token). `/gift/sent` is
  where Stripe sends the buyer: it polls `GET /api/gifts` and shows the link.
- **Redeeming** is one SQL call (`redeem_gift`, atomic: the account's row,
  its `gift_accounts` row, then the gift, locked in that order). Refused:
  `unknown` (404, a malformed code too), `void` (410, refunded), `already` (409
  `already-redeemed`, another account), `self` (the buyer, said kindly),
  `account-ended` (a refund or a dispute ended the account: nothing comes
  back to it, as for invites), `lifetime` (legacy_lifetime or comp: the gift
  would never start, so the code stays for someone else). The same account
  again is answered again, nothing added.
- **The stacking rule.** A free account becomes Pro or Max at once for the
  gift's time (calendar months, the cap counting from the day it started,
  `period_anchor`), source `gift`, and goes back to exactly what it had when
  it ends (tier, cap, source, subscription, anchor, renew_as), its free games
  never touched. An account on ANY paid plan, of the same tier, a higher one
  or a lower one, keeps it and the gift WAITS: it starts the moment that plan
  ends (Stripe ends it, or it lapses unpaid or paused) for the whole time
  bought. Chosen over stacking Max on a Pro subscription because every
  subscription event of the webhook writes the tier, so a gift laid over a
  live plan would be overwritten by the next renewal; waiting loses nothing.
  Two gifts run back to back, oldest redeemed first. A plan bought while a
  gift runs takes over, and what was left of the gift runs after it.
- **Expiry needs no job.** `gifts.sql` gives `ensure_entitlement` (0005's,
  word for word) a `gift_settle` before each return, and `account_state`,
  `claim_game`, the webhook and every gift function call it first: a gift
  that ended is undone, the next one started at the moment the last ended,
  even after months with nobody asking. An account that never redeemed a gift
  returns at once. The server's 30 s memory of the tier (`caller.js`) and the
  meter's games left are forgotten on a redemption (`routes/gifts.js
  forgetAccount`) and on a void.
- **Guessing.** 130 bits, and `routes/gifts.js` stops an address after 10
  unknown codes an hour (peek and redeem together, `createGuessGuard`), 429
  before any lookup. Peek is also 60 in 10 minutes per address, redeem 20 per
  account, the list 60 per account.
- **The Profile** lists the gifts bought (state and Copy link: main holds the
  links from the last `PROFILE_GET` and copies only an
  `occlara.app/gift/` one, `PROFILE_GIFT_COPY`) and the gift running on the
  account. Every gift channel answers nothing mid match or sealed
  (`check:seal`).
- **Not live** (gifts.sql not applied): every gift route answers 503
  `gifts-not-live`, the app says "Gifts are not open yet", and a paid gift
  checkout answers 500 so Stripe retries it until it is.

`test:gifts` holds all of it against `scripts/fixtures/fake-gifts.js` (the
model of gifts.sql on top of fake-billing.js) and checks the SQL's own text
with `OCCLARA_GIFTS_SQL` set.

## Rate limits

Every limit answers 429 `{ error: 'rate-limited', what, retryAfter }` with a
`Retry-After` header, except the licence routes, whose `error` stays a sentence
(the activation window prints it) with `code: 'rate-limited'` and `retry:
true`. Every shipped client (8.6 to 8.7.2) reads a 429 on a background call as
"try later" and says nothing: me() returns null, a claim is granted unknown
(no server cost, the client grades from Riot's record), a review or look has
no narrative, the licence keeps its cache. Nothing about a limit is shown mid
match. New limits are `server/services/rate-limits.js` (`routeLimits`, a fixed
window per key, swept each window and capped at 20000 keys), mounted in
`server.js` after `identifyFirst` and the body parsers; the Stripe webhook is
mounted before every limiter and is never limited (Stripe retries, the
signature verifies it).

Keys: "account" is the verified caller's `accountKey` (`u:<userId>` or the
licence key), so two players on one router never share a bucket; a caller not
verified falls back to its address. "Address" is `req.ip` with `trust proxy
1`: the entry Railway's edge appends, so a client's own X-Forwarded-For or
X-Real-IP never moves it to a fresh bucket (`test:ratelimits` proves it over
HTTP). If Railway ever adds a second hop, every caller would share one
address and the address keyed limits would trip for everyone together.
Nothing logs `req.ip`, so after any change in front of the server check by
hand: a burst of 121 `/health` calls from one network is refused, and another
network is not.

| Route | Key | Limit | Why |
| --- | --- | --- | --- |
| `/api/coach/read` | account | 150 a min (unchanged) | the read gate is the real limit; the busiest recorded minute read 57 |
| `/api/coach/*` (all) | account | 90 a min (unchanged, read skipped) | model calls, agent look |
| `/api/coach/chat`, `/frame-chat` | account | 25 in 5 min, one bucket (frame chat joined 8.7.3) | model calls, plus the daily cap |
| same, inside the routes (8.7.3, `chat-guard.js`) | account | one question in flight; 2 s from the last one's start; 5 a minute; the same question about the same match or frame within 30 s is the remembered answer, no model | spam from an account with games (below) |
| `/api/coach/match-review` | account | 60 an hour, bench skipped | the costliest call: two a match |
| `/api/coach/death-forensics` | account | 60 an hour, bench skipped | up to twenty stills a call: two a match |
| Riot data (`player-stats`, `rank-history`, `match-deaths`, `match-rounds`, `matches`, `last-match`, `recent-matches`) | account | 120 in 10 min, and free 40 in 10 min (unchanged) | HenrikDev's shared quota |
| `/api/coach/session-report` | account | 30 an hour | telemetry, one a session |
| `/api/account/me` | account | 120 in 10 min | account_state per call; the app asks about once a minute |
| `/api/usage/claim`, `/release` | account | 60 in 10 min, one bucket | claim_game and settle; a Riot record run claims 10 |
| `/api/referral`, `/redeem` | account | 30 in 10 min; redeem also 10 a min per address | code inserts and lookups |
| `/api/gifts/peek` | address | 60 in 10 min | a gift lookup, no sign in |
| `/api/gifts/redeem` | account | 20 in 10 min | one SQL call |
| `/api/gifts` (all) | account | 60 in 10 min | the list |
| `/api/gifts/peek`, `/redeem` (routes/gifts.js) | address | 10 UNKNOWN codes an hour, then 429 before the lookup | code guessing |
| `/api/account/handoff`, `/signout` | account | 30 in 10 min; handoff also 20 a min per address | a code insert each |
| `/api/account/exchange` | address | 10 a min (unchanged) | no auth, a session insert |
| `/api/license/activate`, `/validate` | address and key | 30 in 10 min, and 300 in 10 min per address | a licence lookup each; the app re-checks every 3 min |
| same | address | 10 FAILED an hour (unchanged, now on `/validate` too) | key guessing |
| `/api/account/dashboard` | address | 60 in 10 min | a Supabase Auth call before the route |
| `/api/account/portal`, `/api/payments/cancel`, `/api/license/deactivate` | address | 20 in 10 min, one bucket | Stripe calls or licence writes |
| `/api/payments/create-checkout` | address | 20 an hour (unchanged, answers 410) | retired |
| `/health`, `/api/health`, `/admin` | address | 120 a min | public |
| any `/api` with no credentials | address | 300 a min | the floor for everything unauthenticated |
| `/api/admin/*`, `/admin` | address | 10 FAILED passwords an hour (unchanged) | password guessing |
| credentials refused (`identifyFirst`) | address | 60 in 10 min, then 429 before the lookup | made up keys and tokens each cost a lookup |
| `/api/payments/webhook` | none | never | Stripe |

**Ask Coach's spam guard** (`server/services/chat-guard.js`, `CHAT_LIMITS`,
the one place its numbers live, the server.js chat limiter's included):
`BURST_MAX` 5 in `BURST_WINDOW_MS` 60 s, `GAP_MS` 2 s, one in flight
(`IN_FLIGHT_MS` 60 s before a turn that never ended stops counting),
`REPEAT_MS` 30 s, `MAX_KEYS` 20000. Keyed by `rate-limits.js byCaller`, chat
and frame chat together; a bench is never guarded. Refused is 429 `{ error:
'rate-limited', what: 'chat-one-at-a-time' | 'chat-gap' | 'chat-burst',
retryAfter, message }` with Retry-After, which every client says as "Too
many questions too quickly. Wait a few seconds and ask again." and 8.7.3 says
`chat-one-at-a-time` as "One question at a time. Ask again once this answer
is in." Only accepted questions count, so a client that keeps knocking is
free once the window turns. The gap runs from the last question's start, so
a player asking as soon as an answer lands is never refused. A repeat is
answered from memory rather than refused, since a remembered answer cannot
break a retry: only an answer is kept (never a failure, the honest line, the
v1 fallback line or a cap line), so a retry after an error reaches the model.
The question was already clipped before any prompt: frame chat at 500
characters, each chat message at 1,200, the last eight (v2) or twelve (v1).
`test:chatspam` holds each of these.

`test:ratelimits` trips each at its number, resets it, keeps two accounts
apart, sweeps old keys, and replays the five recorded sessions back to back
twice with every call the app makes around them, and a cafe of twenty players
on one address: no 429.

## Switches

All default off, read from env on Railway:

- `ENFORCE_CAPS=1` refuses. Off, every game is still counted, past the cap as
  `source 'shadow'`, `over_cap`; `/api/admin/costs` shows the counts.
- `LEGACY_CAP_FROM` (ISO date): legacy keys are capped from then. Unset means
  never. Free keys are capped whenever enforcing.
- `REFERRALS_ON=1` lets redeem work (403 `referrals-off` otherwise).
- `ACCOUNT_HASH_SALT` salts the network hashes and every free allowance key
  (free-allowance.js). Changing it once keys exist makes every old key meet
  nothing: set it before the free allowance SQL runs, never move it after.
- `OCCLARA_NO_METER_SWEEP=1` turns off the meter's 60 s sweep (tests).

## Not in this repo

- The migration, in the site repo as `drizzle/migrations/0004_accounts_tiers_referral.sql`
  (once `supabase/migrations/20261104000000_accounts_tiers_referral.sql`),
  applied by the owner through Lovable, and the follow ups that moved Free to 2 (0005) and to 4 (0010). It has never run against a real
  Postgres: run it on a branch database first. Server first or migration first
  are both safe: every missing table or function (42P01, PGRST205, PGRST202,
  42883) reads as "accounts not live".
- In Stripe, four Prices with the lookup keys above, and the four
  `STRIPE_PRICE_OCCLARA_*` secrets on the site's edge functions.
- An old yearly subscription has to be moved to the `occlara_pro_yearly` Price
  before it renews to be charged $249.99; the webhook only changes the tier.
- Google enabled in Supabase Auth, and `https://occlara.app/app/signin`
  allow-listed as a redirect URL.
- The gifts SQL (8.8), written as `gifts.sql` for the site repo's migrations
  after the free allowance one: the tables `gifts` and `gift_accounts` (no
  foreign key to auth.users), `entitlements.source` taking `gift`,
  `gift_settle`, `gift_end_running`, `gift_mint`, `gift_of_ref`, `gift_peek`,
  `gift_list`, `redeem_gift`, `void_gift`, and `ensure_entitlement` again,
  word for word with 0005 except its three returns. Never run against a real
  Postgres yet: run it on a branch database first, and try two redemptions of
  one code at once there. `GIFT_CODE_SECRET` set on Railway before the first
  gift is sold. The site's `create-gift-checkout`, `/gift/:code`, `/gift/sent`
  and the Buy page's gift form (branch `gifts-8.8` of the site repo).
- The free allowance SQL (8.8), written as `free-allowance.sql` for the site
  repo's migrations after `0006_game_purchases.sql`: the table
  `free_allowance_keys` (no foreign key to auth.users, on purpose: a deleted
  account's keys still count), `free_allowance_note`, `_shared`,
  `_related`, `_apart`, `_lock`, `_first_free`, and `entitlement_allowance`,
  `claim_game` and `entitlement_qualify_referral` again, each word for word
  with 0004 except the lines it adds. Never run against a real Postgres yet,
  and its concurrency (the advisory locks) is proven only on the fake: try
  two claims at once on a branch database before it goes live. Then
  `node scripts/backfill-free-keys.js --apply` from server/.

Tests: `test:caplock` (the lock on every model route), `test:ratelimits`,
`test:claimgame` (the fake's model of the SQL, plus a text check of the
SQL file with `OCCLARA_SITE_DIR` set), `test:entitlementwebhook`,
`test:caller`, `test:usageroutes`, `test:readgate`, `test:referral`,
`test:accountservice`, `test:usage`, `test:readcap`, `test:backfill` (the
release on a take back), `test:freeallowance` (one free allowance per
player through the routes, the meter and the fake's model of
free-allowance.sql, which is live only with `reset({ allowance: true })`;
the SQL's own text with `OCCLARA_FREE_ALLOWANCE_SQL` set) and `check:sessionend` (booted: a sign in refused mid
match ends no licence and the Sign in window waits for a held seal).
