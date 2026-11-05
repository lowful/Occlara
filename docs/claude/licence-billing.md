# A refund must take the licence away, and renewals reach it

Moved out of CLAUDE.md word for word, nothing reworded or dropped (CLAUDE.md as of commit cc1f880, 8.5.0, lines 3816 to 4022). Sections here: "A refund must take the licence away", "Renewals reach the licence, and a refused write says so". "Above" and "below" in the text name sections that may now sit in another file under docs/claude/: grep the section's title there to find it. The table in CLAUDE.md says which file to read for which work.

## A refund must take the licence away

The Stripe webhook handled four events and none of them was a refund. That left
a hole with no floor under it: a LIFETIME purchase writes `expires_at: null` and
`status: 'active'`, has no subscription to cancel, and `validateKey` asks only
for an active status and an unexpired date. **Buy lifetime, refund it, keep the
product forever.** Nothing fired, nothing logged, nothing expired.

`charge.refunded` and `charge.dispute.created` now revoke, writing both the
status and `expires_at: now`. Two independent reasons for the same answer, so
the licence dies even if `validateKey` is ever relaxed about status.

**And then every plan became a subscription, and none of it reached them.**
The site sells weekly, monthly and yearly through its own create-checkout, all
three `mode: subscription`. A subscription's Checkout Session has no payment
intent, so the lookup by session never found a site licence; a Dispute has no
customer, so a chargeback had nothing to go on; a refund left the subscription
billing (a weekly refunded on day two was charged again on day seven); and the
status written, 'refunded', is one the licences table's CHECK refused. So the
charge is read again as the server's own API version renders it (stripe-node
14 pins 2023-10-16, which still has `charge.invoice`; a basil event does not),
and the licence is found in this order: **its invoice's subscription** (exact,
since a subscription is one purchase), then the checkout session of its
payment intent (the old one-time lifetime), then the customer.

**A full refund or any dispute cancels the subscription, FIRST**, so billing
stops even while the database refuses the revoke and Stripe retries it.

**A PARTIAL refund must not revoke.** `charge.refunded` fires for both, and a
goodwill partial refund is not a reason to take the product away. The amounts
are compared as well as the flag. A goodwill refund must be partial, because a
full one ends the purchase, its subscription included.

**The customer is a FALLBACK and only when unambiguous.** When neither the
subscription nor the session names a licence, the customer is used only if they
have exactly ONE active licence: a repeat buyer has several, and revoking all of
them over one refund is a worse bug than the one this fixes. It logs loudly and
refuses rather than guessing. A dispute takes its customer from its charge.

**The reason is written where the table allows it.** 'refunded' and 'disputed'
once the site's migration adds them to the status CHECK; until then the CHECK
refuses them (23514) and 'cancelled' is written with the expiry now, so the
same code works on either side of the migration. Nothing that follows undoes a
revoke: `customer.subscription.deleted` keeps a 'refunded' or 'disputed' reason,
and a payment never brings a revoked licence back (a renewal logs it for a human).

### Renewals reach the licence, and a refused write says so

**No renewal ever reached a licence, and the logs said they did.** The licences
table's trigger (`prevent_license_privilege_escalation`) exempted the service
role by `request.jwt.claim.role`, a setting PostgREST no longer sets, so it
refused the webhook's every write to status and expires_at; nothing read the
error, "renewed. New expiry" was logged either way, and every subscriber lost
the app at the end of the first period while Stripe went on charging them.
Three more things would each have done it alone: Stripe's API 2025-03-31.basil
moved an Invoice's subscription to `parent.subscription_details.subscription`
(events arrive in the endpoint's version, so both invoice handlers broke out
silently), the expiry was the old one plus 7 or 30 days with no yearly at all,
and a failed write answered 200, so Stripe never retried it.

- **Every licence write in the webhook checks its error and throws**, the
  handler answers 500, and Stripe retries the event for up to three days. A
  write the database refuses is retried until it lands, never logged as done.
  Errors are logged by code and message only: a CHECK violation's details are
  the whole row, key and all.
- **The expiry is Stripe's own period end plus two days** (`services/billing.js`,
  shared by the webhook, `/api/payments/cancel` and the repair route below):
  `invoice.paid` writes the paid invoice's latest line period end plus the
  grace, status active, in either API version and for every plan. Stripe charges
  a renewal about an hour after the period ends, up to three days when its own
  deliveries fail, and the app stops the recording in progress the minute an
  expiry passes. A subscription set to cancel at its period end gets the grace
  too: the customer can renew it in Stripe's portal (the site's Manage
  subscription) before then, which tells this server nothing, and that renewal
  is charged about an hour after the end, so an exact end stopped the match
  being recorded for that hour. Access stops when Stripe ends it:
  `customer.subscription.deleted` sets the licence cancelled. A renewal never
  moves an expiry earlier: an invoice that ends sooner (a one-off charge on the
  subscription, a proration, an old event replayed) cannot cut a paid period.
- **Stripe does not promise order.** `invoice.payment_failed` asks the invoice
  how it stands now, so a failure delivered after the retry that paid cannot
  lock out a paying customer, and it marks only an active licence. A renewal
  brings back a merely cancelled licence only while Stripe still bills its
  subscription (one cancelled on the site while its billing call failed).
- **A failed payment is a grace, not an end.** `invoice.payment_failed` marks
  the licence on Stripe's first failed attempt at a renewal, while its expiry
  still runs two days past the period end and Stripe tries the card again, and
  every licence check refused it: within three minutes of a declined card the
  app stopped the match being recorded. Now a payment_failed licence is usable
  until its expiry: `checkKey` (coach.js) answers valid, and
  `/api/license/activate` and `/validate` answer `valid: true` with
  `status: 'payment_failed'`, the plan and `expiresAt`, which the app warns on
  and works through. The device lock holds as before. With no expiry, or a
  past one (answered `expired`), it is not usable, and cancelled, expired,
  refunded and disputed never are. One rule, `usable` in `routes/license.js`,
  shared by checkKey and held equal to the app's own (`license-service.js
  usable`) by `test:licenceoutage`. Only to an app that knows it
  (`knowsGrace`, 8.3.2 and later by the `X-Occlara-Version` every request
  carries): one before it read anything but 'active' as ended on its own
  minute check, so answered valid it stopped the session after every three
  minute re-check and offered Start again in between, and it is refused as it
  always was. The refund's customer fallback counts a licence in its grace as
  live, and the account dashboard's `renews` is false once Stripe has ended
  the subscription (canceled, incomplete_expired, or no record of it).
- **A lifetime licence that names a subscription** (one made lifetime by hand)
  is never given an expiry, cancelled or marked payment_failed by that
  subscription's renewals, failed payments or end. A full refund or a dispute
  of its charge still revokes it, as it revokes anything that charge bought.
- **`/api/payments/cancel` stops every subscription Stripe still bills**, not
  the newest licence's: Stripe is asked about every subscription the user's
  licences name, whatever their status, each is set to cancel at its period
  end, and each licence still on runs to that end plus the grace (the end the
  customer is told is Stripe's own). One whose payment is failing (past_due,
  unpaid, incomplete, paused) is cancelled now and says `endedNow`: its period
  was never paid, and set to cancel at its end Stripe went on retrying the
  unpaid invoice, so a customer who cancelled to stop the retries could still
  be charged. A Stripe failure is a 502 and a refused write a 500 that says
  billing is stopped, never a 200.
- **Only Occlara's own objects.** Every event of the Stripe account reaches the
  endpoint, another product's included. A full refund or a dispute cancels a
  subscription only when an Occlara checkout started it (its metadata names
  one of Occlara's plans and a `user_id` or `userId`, asked of Stripe first so
  billing stops while the licences table is down) or a licence names it, and a
  checkout naming a user the licences table does not have (`user_id`
  references auth.users: 23503, or 22P02 for an id that is no uuid) mints
  nothing and answers 200: as a 500, Stripe retried each such sale for three
  days, and an endpoint that keeps failing is one Stripe disables.

**The repair: `POST /api/admin/licenses/sync-expiry`**, behind the admin
password. Fixing the webhook moves a licence on at its next renewal; this moves
every existing one now, by the same rule, reading each licence's subscription
in Stripe. A DRY RUN BY DEFAULT: it writes nothing and lists every row it would
change, before and after; `?apply=1` writes them, each write checked, and answers
500 listing any that failed. One Stripe bills runs to its period end plus two
days (the same when set to cancel). One whose card fails is payment_failed to
the end of the period PAID for plus two days, which is where the unpaid period
began (`billing.js failingExpiryFor`): Stripe moves the period on when it bills
the renewal, paid or not, and since a failed payment is a grace the unpaid
period's end was that period free, 32 days on a monthly plan and 367 on a
yearly one, and an unpaid licence (Stripe done retrying) revived; an unpaid,
incomplete or paused one is never moved later than it already runs.
A site cancelled licence Stripe still bills is active again for the period paid,
one Stripe ended is cancelled at the moment it ended, and a revoked licence
whose subscription still bills, a lifetime one, or a subscription Stripe has no
record of is listed and left as it is. Run it once the migration below is live.

**What the webhook mints, and what it logs.** The site mints its own licences
(create-license, at /success and from the account page), naming the buyer as
`metadata.user_id`, so a site purchase is one quiet line here: "UNLINKED
PURCHASE" is kept for a checkout neither checkout made, where it was logged for
every site sale and hid the real orphans. Only the old Railway checkout's
purchases (`client_reference_id` or `metadata.userId`) are minted here, the plan
from the price's own interval (week, month, year) rather than STRIPE_PRICE_*,
the key from `crypto.randomInt`. No licence key or email is printed anywhere.
The old public `POST /api/payments/create-checkout` (no sign in, any userId, the
old $20 and $100 prices) and `GET /api/payments/success` (a key for any session
id) answer 410: neither the site nor the app calls them.

**The frames go only to providers that keep nothing, and asking never takes
the product down.** Every OpenRouter call (`chatCall` in coach.js) asks for
`provider: { data_collection: 'deny' }`. A model with no provider that denies
collection has every call refused, HTTP 404 "No endpoints found matching your
data policy" (or the 503 OpenRouter's errors page lists for the same, "There
is no available model provider that meets your routing requirements", the
data policy being the only routing requirement sent), so that one refusal
falls back per call: it is sent once more without the preference, booked as
any call, and nothing else ever is (a 400, 401, 402, 403, 429, any other 5xx
or a timeout is the call's own answer). The calls
that fell back are counted per route since boot (read, forensics, review,
chat, bench, other), said in one log line a route an hour at most, and
`GET /health` counts them as `dataPolicy: { mode, fellBack, refusedAgain,
since }`: a route counting in `fellBack` sends its model's frames to providers
that may keep them, each call after a refused round trip, until the model
changes. They are counted by what happened to the retry: one OpenRouter
refuses again ("No endpoints found" once more) went to no provider, so it is
`refusedAgain`, never `fellBack`: an account wide privacy setting or a model
with no live provider stops it, which `AI_DATA_COLLECTION=allow` does not
change. One answered, cut off, or refused in other words may have reached a
provider, so it is `fellBack`.
`AI_DATA_COLLECTION=allow` sends no preference and retries nothing.
`test:aiprivacy` holds it on a scripted provider, and boots the server for
/health.

**NOT IN THIS REPO, and none of it works without them:**
- The site's SQL migration: the trigger's service role exemption read from
  `request.jwt.claims`, and the plan and status CHECKs taking 'yearly',
  'refunded' and 'disputed'. Until it is live every renewal and revoke answers
  500 and Stripe keeps retrying, which is the intended, loud failure, so it
  goes live BEFORE this server deploys: the old server is unharmed by it, and
  Stripe retries an event for three days and disables an endpoint that keeps
  failing.
- The Stripe endpoint subscribed to `invoice.paid`, `invoice.payment_failed`,
  `customer.subscription.deleted`, `customer.subscription.updated`,
  `charge.refunded`, `charge.dispute.created` and
  `checkout.session.completed`. It was created listing four. Its API
  version can be either shape; the code reads both.
- The repair run once, dry first, then `?apply=1`.
- STRIPE_PRICE_WEEKLY, MONTHLY and LIFETIME removed from Railway: nothing reads them.

`npm run test:refundrevoke`, `test:renewals`, `test:billingroutes` and
`test:checkoutplan` run the real handlers against `scripts/fixtures/fake-billing.js`:
a licences table with exactly the live columns, the status and plan CHECKs as
the migrations define them (before and after the site's), the trigger as it
behaves live, and PostgREST's own errors; a Stripe that answers the server in
2023-10-16 and sends events in 2023-10-16 or basil. The old fakes agreed to
everything, which is how test:refundrevoke passed while every site refund left
its key working. Each fix was proved by reverting it and watching its check fail.

### Entitlements ride on the same events (8.7)

The webhook also writes the account (`entitlements`): tier and cap from the
Price lookup key, and on a full refund or a dispute, AFTER the unchanged revoke
and cancel, every account of those licences goes free with no games left. A
partial refund still writes nothing. Every entitlement write checks its error
and throws, and with the tables missing the licence path runs unchanged. The
detail, the payer rules and the switches are in accounts.md;
`test:entitlementwebhook` holds it.

**Stripe can stop a subscription without ending it, so the plan ends on
`customer.subscription.updated` too.** With its retries done Stripe leaves a
subscription `unpaid` (or cancels it, by the account's setting), and a trial
that ends with no payment method leaves it `paused`; neither sends
`customer.subscription.deleted`. Only deleted took the tier away, so the
licence ran out at its expiry while a signed in app kept Pro or Max and its
monthly games renewed. The update handler asks Stripe how the subscription
stands NOW (order is not promised, so an unpaid delivered after the payment
that brought it back ends nothing):

- `canceled`, `incomplete_expired`: ended exactly as deleted (`endSubscription`):
  licence cancelled, account free, cap 0, free games kept.
- `unpaid`, `paused` (`SUB_LAPSED` in `billing.js`): the account goes free, cap
  0, free games and bonus kept, its subscription id kept (`endSubscriptionAccounts`).
  The licence is not touched: it runs to its expiry as it always did, a legacy
  key included, `invoice.payment_failed` having marked it.
- `past_due`: nothing. Stripe is still trying the card; that is the grace.
- `active`, `trialing`: nothing. The plan comes back with the payment that
  brought it back, `invoice.paid`, which holds the tier, the anchor, the
  legacy yearly's Max to Pro rule and the licence's expiry. An OLDER invoice
  paid while the subscription stays lapsed (not its `latest_invoice`) brings
  nothing back, and a late `checkout.session.completed` of a lapsed one leaves
  the account as it is.

Only rows naming that subscription are written, so another purchase of the
same Stripe customer is never touched, a comp or lifetime account is never
moved, a repeat changes nothing, and every write throws on error.
`test:entitlementwebhook` and `test:renewals` hold it. A resume that bills no
invoice at all (a paused one resumed with `billing_cycle_anchor: unchanged`
and no proration) stays free until its next `invoice.paid`.

### Games bought one by one (8.8), and their refund never reaches the licence

A game is $2.00 (`GAME_PRICE_CENTS` 200 in `services/billing.js`), any whole
number from 1 to 500 (`MAX_GAMES_PER_PURCHASE`) in one checkout, the app's
quick picks (1, 5, 10, 25) only that rate times the count. The app opens
`https://occlara.app/buy?games=N`; the site's `create-games-checkout` edge
function takes the user from the verified JWT and makes a mode payment Checkout
Session, one line of quantity N at unit_amount 200 usd, metadata
`{ kind: 'games', games, user_id }` on the session and on its payment intent.

**The credit.** `checkout.session.completed` (or
`checkout.session.async_payment_succeeded`) of kind games, paid, is held to what
Stripe charged: amount_total exactly N times 200, usd, one line of quantity N at
200, a uuid user. Anything else is refused, logged `GAMES PURCHASE REFUSED`
(search Railway for it) and answered 200, since a retry can never make it match;
an unpaid session grants nothing until its async payment succeeds. Then the
database function `grant_purchased_games(p_user, p_games, p_ref, p_amount_cents)`
adds N to `entitlements.bonus_pool`, NOT to `bonus_earned` (the referral cap),
once per session: `game_purchases.ref` is the session id and unique, so a
redelivery grants nothing. Its error is checked and thrown like every licence
write, so Stripe retries, the functions not being live yet included (the buyer
paid). A user Occlara does not have (23503, 22P02) is refused with a 200. A
grant to an account a refund or a dispute ended is held and logged for a human:
claim_game plays no bonus game on an ended account.

**The refund.** A full `charge.refunded` or any `charge.dispute.created` of a
games payment calls `refund_purchased_games(p_ref)`, which takes back the
smaller of the games that purchase granted and what bonus_pool holds (never
below 0, never a game already played), marks the purchase refunded, once, and
RETURNS. It never revokes, expires or cancels a licence or a subscription, and
never writes the tier, free_total, bonus_earned or the account's status. A
partial refund does nothing. **This check runs before any licence lookup**,
because the customer fallback (above) finds a customer's ONE live licence: a $2
pack refunded by a Pro subscriber revoked their Pro licence, cancelled their
subscription and ended their account. A games payment is told by, in order, the
kind on its charge, on its payment intent (retrieved), on the checkout session
of that payment intent, or a `game_purchases` row for that session; a charge
with an invoice is a subscription's and never one. A refund that arrives before
its grant is recorded refunded with nothing granted (`p_user` and `p_games`
from the metadata), so the grant that follows adds nothing. Games are not tagged
with the purchase they came from, so with invite games or another purchase in
the pool, this purchase's games are the unused ones first.

**Unchanged:** a full refund or a dispute of a LICENCE payment revokes, cancels
and ends the account exactly as above, and that end still zeroes bonus_pool,
bought games included (the owner's call to keep or change).

`games left` (`account_state.left`, `GET /api/account/me`) is the allowance plus
bonus_pool, so bought games count and nothing caps them at the referral's 20;
`/api/referral` alone reads bonus_earned.

**NOT IN THIS REPO:** the games SQL (table `game_purchases`, both functions,
service_role only), applied by the site after 0004, BEFORE this server deploys;
the site's `/buy` page and `create-games-checkout`; and the Stripe endpoint
subscribed to `checkout.session.async_payment_succeeded` as well. The webhook's
own refund handling needs nothing new. `npm run test:gamespurchase` runs the real
handler against `fake-billing.js` (whose two functions follow the SQL), and
checks the SQL itself when `OCCLARA_SITE_DIR` or `OCCLARA_GAMES_SQL` finds it.
Removing the games check makes its Pro licence checks fail.

### Gifts (8.8), and their refund never reaches the licence either

A gift is Pro or Max for someone else, a month or a year, at the plan's own
price, a one time payment made by the site's `create-gift-checkout`, metadata
`{ kind: 'gift', offer, user_id, from_name }` on the session and its payment
intent. What it does on the recipient's account and the stacking rule are in
accounts.md, "Gifts".

**The mint.** `checkout.session.completed` (or async_payment_succeeded) of
kind gift, paid, is held to what Stripe charged (`gifts.checkoutGift`): the
offer's price exactly, usd (or the adaptive pricing conversion's usd), one
line of quantity 1, a uuid buyer, a payment mode session. Anything else is
logged `GIFT PURCHASE REFUSED` and answered 200. Then `gift_mint`, once per
session (`gifts.ref` unique, and the code is made from the session id, so a
redelivery is the same gift). A database error, gifts.sql not live, or
`GIFT_CODE_SECRET` not set answers 500 and Stripe retries: the buyer paid.

**The refund.** A full `charge.refunded` or any `charge.dispute.created` of a
gift payment calls `void_gift(p_ref, 'refunded' | 'disputed')` and RETURNS,
before any licence lookup, through the same check as games (`oneTimePaymentOf`:
the kind on the charge, its payment intent, the checkout session of that
intent, then `gift_of_ref` for a gift whose metadata were lost; a charge with
an invoice is never one). So the buyer's own licence, plan, subscription and
account are never touched, the customer fallback included. What it voids:

- unredeemed: the link answers "refunded" and can never be redeemed;
- redeemed and waiting (behind a paid plan or another gift): it never starts;
- running: it ends now and the recipient's account goes back to what it had
  (free, its free games untouched, never ended), and the next waiting gift
  starts;
- used up: marked void, nothing to take back (the time was spent).

A refund that lands before the mint mints the gift first (when the metadata
and the secret allow) and voids it, so the late mint makes nothing
redeemable. A second refund event changes nothing. A partial refund does
nothing. `void_gift` raises 40001 when the gift was redeemed between its first
read and its lock, and Stripe's retry finds it redeemed and takes its time away.

**NOT IN THIS REPO:** gifts.sql in the site's migrations, applied BEFORE this
server deploys (until then every gift route answers 503 and a paid gift is
retried by Stripe), `GIFT_CODE_SECRET` on Railway, and the site's
`create-gift-checkout`. The Stripe endpoint needs no new event types: it
already takes `checkout.session.completed`, `async_payment_succeeded`,
`charge.refunded` and `charge.dispute.created`. `npm run test:gifts` runs the
real handler and routes against `fake-gifts.js`; removing the gift check from
the refund path makes its licence checks fail.
