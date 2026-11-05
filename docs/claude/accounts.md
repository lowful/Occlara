# Accounts, tiers, game caps and referral (8.7)

Sections here: "What an account is", "Counting games", "Signing the app in",
"Referral", "Switches", "Not in this repo". The licence path of 8.6 is
unchanged underneath all of it, and a server without the new tables serves
8.6 keys exactly as before.

## What an account is

A Supabase user with one `entitlements` row: tier `free`, `pro` (25 games a
month) or `max` (70 a month), `free_total` (2 for life, 4 if invited; 3 and
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
3 to 2 and invited 5 to 4); `test:claimgame` with `OCCLARA_SITE_DIR` checks the
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
Subscription deleted sets free, cap 0 and keeps the free games.

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
  used its free games. Errors never refuse: the server grants with reason
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
route for Free 2 of 2, Pro 25 of 25, bonus games used and a legacy key, in
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
holds every version on chat, v2 chat and frame chat for Free 2 of 2 and Pro
25 of 25 (no model, no cost, no cap line), shadow, an outage, games left,
bought games and a new month.

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
need an account"). The friend gets `free_total` 4 (`INVITED_FREE_TOTAL`); on
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
- `ACCOUNT_HASH_SALT` salts the network hashes.
- `OCCLARA_NO_METER_SWEEP=1` turns off the meter's 60 s sweep (tests).

## Not in this repo

- The migration, in the site repo as `drizzle/migrations/0004_accounts_tiers_referral.sql`
  (once `supabase/migrations/20261104000000_accounts_tiers_referral.sql`),
  applied by the owner through Lovable, and the follow up that moved Free to 2. It has never run against a real
  Postgres: run it on a branch database first. Server first or migration first
  are both safe: every missing table or function (42P01, PGRST205, PGRST202,
  42883) reads as "accounts not live".
- In Stripe, four Prices with the lookup keys above, and the four
  `STRIPE_PRICE_OCCLARA_*` secrets on the site's edge functions.
- An old yearly subscription has to be moved to the `occlara_pro_yearly` Price
  before it renews to be charged $249.99; the webhook only changes the tier.
- Google enabled in Supabase Auth, and `https://occlara.app/app/signin`
  allow-listed as a redirect URL.

Tests: `test:caplock` (the lock on every model route), `test:ratelimits`,
`test:claimgame` (the fake's model of the SQL, plus a text check of the
SQL file with `OCCLARA_SITE_DIR` set), `test:entitlementwebhook`,
`test:caller`, `test:usageroutes`, `test:readgate`, `test:referral`,
`test:accountservice`, `test:usage`, `test:readcap`, `test:backfill` (the
release on a take back) and `check:sessionend` (booted: a sign in refused mid
match ends no licence and the Sign in window waits for a held seal).
