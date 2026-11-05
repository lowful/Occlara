'use strict';
const crypto   = require('crypto');
const stripe   = require('stripe')(process.env.STRIPE_SECRET_KEY);
const supabase = require('../db/supabase');
const {
  DAY_MS, GRACE_MS, LICENCE_ENDED: ENDED, LICENCE_REVOKED: REVOKED, SUB_BILLING: BILLING, SUB_ENDED,
  idOf, subscriptionOf, latestLineEnd, periodStartOf, periodEndOf, withGrace, dbError,
  LOOKUP_KEY, INTERVAL_PLAN, accountsMissing, tierOfPlan, tierOfPrice, priceOfSubscription,
  GAME_PRICE_CENTS, wholeGames,
} = require('../services/billing');

/*
 * ── THE LICENCE FOLLOWS STRIPE, AND EVERY WRITE TO IT IS CHECKED ────────────
 *
 * Renewals never reached a licence, and the logs said they did. The licences
 * table's trigger refused the service role's every write to status and
 * expires_at, nothing here read the error, and "renewed. New expiry" was
 * logged either way, so every subscriber lost the app at the end of the first
 * period while Stripe went on charging them. Three more things would have done
 * it on their own:
 *
 *   THE INVOICE'S SUBSCRIPTION MOVED. Stripe's API 2025-03-31.basil took
 *   `subscription` off Invoice; it is parent.subscription_details.subscription
 *   now. Events arrive in the webhook endpoint's own version, so an endpoint on
 *   basil or newer made invoice.paid and invoice.payment_failed break out
 *   silently. subscriptionOf() reads both shapes.
 *
 *   THE EXPIRY WAS COUNTED, NOT READ. A renewal added 7 or 30 days to the old
 *   expiry and knew no yearly plan at all, while Stripe charges about an hour
 *   after a period ends (up to three days when its deliveries fail) and months
 *   run 28 to 31 days. The expiry is now Stripe's own period end, the latest
 *   line of the paid invoice, plus GRACE, so a renewal charge that lands after
 *   the period ends never reads as expired in between, whatever the plan.
 *
 *   A FAILED WRITE ANSWERED 200. Every licence write here now checks its error
 *   and throws, the handler answers 500, and Stripe retries the event for up to
 *   three days. A renewal refused by the database is retried until it lands,
 *   rather than lost with a line in the log saying it worked.
 *
 * Errors are logged by code and message only, never their details: a CHECK
 * violation's details are the whole failing row, licence key included.
 */

// The plans the licences table knows, once the site's migration adds yearly.
const PLANS = new Set(['weekly', 'monthly', 'yearly', 'lifetime']);
const PLAN_DAYS = { weekly: 7, monthly: 30, yearly: 365 };

// The reason a revoked licence carries, and what is written while the
// licences table's status CHECK does not allow it yet.
const REVOKED_FALLBACK = 'cancelled';

/*
 * EVERY EVENT OF THE STRIPE ACCOUNT ARRIVES HERE, another product's included,
 * so two things are held to Occlara's own objects:
 *
 *   A REFUND OR A DISPUTE CANCELS ONLY OCCLARA'S SUBSCRIPTION (below,
 *   occlaraSubscription): one an Occlara checkout started, or one a licence
 *   names. Unguarded, a full refund of another product's subscription charge
 *   cancelled that product's customer's subscription.
 *
 *   A CHECKOUT NAMING A USER THE LICENCES TABLE DOES NOT HAVE MINTS NOTHING.
 *   A checkout that sets client_reference_id to its own app's user reads here
 *   like the old Railway checkout's, and licences.user_id references
 *   auth.users, so the insert is refused: 23503, or 22P02 for an id that is
 *   not a uuid. Thrown as a failed write, it answered 500, Stripe retried each
 *   such sale for three days, and an endpoint that keeps failing is one Stripe
 *   disables, renewals and refunds with it.
 */
const FOREIGN_USER = new Set(['23503', '22P02']);

/** A Checkout Session one of Occlara's checkouts made: the site's (user_id) or the old Railway one's (userId). */
function occlaraCheckout(session) {
  const meta = (session && session.metadata) || {};
  return occlaraPlanName(meta.plan) && !!(meta.user_id || meta.userId);
}

/*
 * A plan name one of Occlara's checkouts writes: an old plan (weekly, monthly,
 * yearly, lifetime), or from 8.7 a tier and period (pro_monthly, max_yearly)
 * or the price's own lookup key (occlara_pro_monthly). The site's checkout
 * decides which it writes; all three are read as Occlara's.
 */
const TIER_PLAN = /^(pro|max)_(monthly|yearly)$/;
function occlaraPlanName(name) {
  const s = String(name || '');
  return PLANS.has(s) || TIER_PLAN.test(s) || LOOKUP_KEY.test(s);
}

/*
 * Keys are the product's only lock, so they are drawn from the operating
 * system's random source. Math.random is a seeded generator whose next
 * outputs can be worked out from earlier ones.
 */
const KEY_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
function generateLicenseKey() {
  const seg = () => Array.from({ length: 4 }, () => KEY_CHARS[crypto.randomInt(KEY_CHARS.length)]).join('');
  return `GC-${seg()}-${seg()}-${seg()}-${seg()}`;
}

/**
 * The expiry a licence minted HERE starts with: the plan's length plus GRACE,
 * or none for lifetime. Only the old Railway checkout's purchases are minted
 * here; the site mints its own (create-license), and from the first renewal on
 * the expiry is Stripe's period end either way.
 */
function getExpiresAt(plan, now = Date.now()) {
  if (plan === 'lifetime') return null;
  const days = PLAN_DAYS[plan] || PLAN_DAYS.monthly;
  return new Date(now + days * DAY_MS + GRACE_MS).toISOString();
}

/*
 * THE PLAN WHEN NOTHING ELSE SAYS, read from how Stripe charged rather than
 * guessed.
 *
 * This used to be `plan = 'monthly'; // safe fallback`, and it was not safe.
 * Any purchase that arrived without metadata.plan and with a price ID that did
 * not exactly match an env var, which is every Payment Link, every checkout the
 * website builds itself, and every price recreated in the dashboard, became a
 * MONTHLY licence. A lifetime buyer got 30 days and then lost the product they
 * had paid for once, with nothing logged beyond a plan name.
 *
 * The price's own interval says it now (week, month, year), so the
 * STRIPE_PRICE_* variables are no longer read and can go. Without one,
 * session.mode settles it: a one-time charge can only ever be lifetime, and a
 * subscription falls back to monthly, which is at worst generous for a weekly
 * buyer and never takes anything away.
 */
function planFromMode(session) {
  if (session && session.mode === 'payment') {
    console.warn(`[webhook] plan unresolved for ${session.id}, one-time payment so LIFETIME`);
    return 'lifetime';
  }
  console.warn(`[webhook] plan unresolved for ${session && session.id}, subscription so monthly`);
  return 'monthly';
}

/**
 * The price a checkout charged, asked of Stripe once per event however many
 * readers want it (the plan below, the tier further down), or null when
 * Stripe could not list it, which is logged and read as "nothing says".
 */
function checkoutPrice(session) {
  let asked = null;
  return () => {
    if (!asked) {
      asked = (async () => {
        try {
          const items = await stripe.checkout.sessions.listLineItems(session.id);
          return (items && items.data && items.data[0] && items.data[0].price) || null;
        } catch (e) {
          console.error(`[webhook] could not list the line items of ${session.id}:`, e.message);
          return null;
        }
      })();
    }
    return asked;
  };
}

/*
 * A KEY IS NEVER MINTED WITH PLAN 'pro' OR 'max'. An 8.6 client's usable() is
 * shipped and knows weekly, monthly, yearly and lifetime, so a tier price
 * (lookup key occlara_{pro,max}_{monthly,yearly}) mints the period, monthly or
 * yearly, and the tier lives on the account (entitlements, below).
 */
async function planOfCheckout(session, price = checkoutPrice(session)) {
  const named = session.metadata && session.metadata.plan;
  if (PLANS.has(named)) return named;
  const p = await price();
  const tier = LOOKUP_KEY.exec(String((p && p.lookup_key) || ''));
  if (session.mode === 'subscription' && tier) return tier[2];
  const interval = p && p.recurring && p.recurring.interval;
  if (session.mode === 'subscription' && INTERVAL_PLAN[interval]) return INTERVAL_PLAN[interval];
  return planFromMode(session);
}

// Stripe's objects are read in either API version by services/billing.js
// (subscriptionOf, latestLineEnd, periodEndOf), shared with /cancel and the
// admin repair route so the three cannot drift.

/** A failed database call as an Error to throw: its code and message, never its details. */
function dbFailure(what, error) {
  console.error(`[webhook] could not ${what}: ${dbError(error)}`);
  return Object.assign(new Error(`could not ${what}: ${dbError(error)}`), { code: error && error.code });
}

// ── Renewals ────────────────────────────────────────────────────────────────

/**
 * Every licence of a subscription runs to the period an invoice paid for.
 *
 * One that has ended stays ended unless it was merely cancelled and Stripe is
 * still billing its subscription: one cancelled on the site while Stripe went
 * on charging is brought back, because the customer has just paid for the
 * period. A refund cancels the subscription, so a late delivery of the refunded
 * invoice's own invoice.paid (Stripe does not promise order) finds it cancelled
 * and changes nothing. One revoked for a refund or a chargeback is never
 * brought back by a payment: that is a human's call, and it is logged as one.
 *
 * NEVER EARLIER THAN THE EXPIRY A LICENCE ALREADY HAS. An invoice whose lines
 * end sooner (a one-off charge on the subscription, a proration, an old event
 * replayed) does not shorten a period that was paid for: a too-short expiry
 * locks out a paying customer, while one Stripe ends early is cut by its status
 * (customer.subscription.deleted, invoice.payment_failed) all the same.
 */
/*
 * Answers the licences of the subscription as they were read (their user and
 * key too, for the account below), [] when none carries it yet, or null when
 * the invoice is too old to renew anything.
 */
async function renew(subId, endSec, invoiceId) {
  const expiresAt = withGrace(endSec);
  if (Date.parse(expiresAt) <= Date.now()) {
    console.warn(`[webhook] invoice ${invoiceId} paid for a period that ended over two days ago, nothing renewed`);
    return null;
  }
  // A lifetime licence that names a subscription (one made lifetime by hand)
  // is not billed by it, so a renewal never gives it an expiry.
  const { data: rows, error } = await supabase
    .from('licenses')
    .select('id,status,expires_at,user_id,license_key,plan')
    .eq('stripe_subscription_id', subId)
    .neq('plan', 'lifetime');
  if (error) throw dbFailure(`read the licences of subscription ${subId}`, error);
  if (!rows || !rows.length) {
    // The site mints the licence when the buyer reaches /success, from the
    // same period, so the first invoice of a subscription often lands here.
    console.warn(`[webhook] no licence carries subscription ${subId} yet, nothing renewed (invoice ${invoiceId})`);
    return [];
  }
  let ids = rows.filter((r) => !ENDED.has(r.status)).map((r) => r.id);
  const revoked = rows.filter((r) => REVOKED.has(r.status));
  const cancelled = rows.filter((r) => r.status === 'cancelled');
  if (revoked.length) {
    console.error(`[webhook] invoice ${invoiceId} was paid on subscription ${subId}, whose licence was revoked `
      + `(${revoked.map((r) => r.status).join(', ')}). Left revoked; stop the subscription in Stripe or refund this payment. Needs a human.`);
  }
  if (cancelled.length) {
    const sub = await stripe.subscriptions.retrieve(subId);
    if (BILLING.has(sub.status)) {
      console.warn(`[webhook] subscription ${subId} is ${sub.status} and paid, so ${cancelled.length} cancelled licence(s) are active again`);
      ids = ids.concat(cancelled.map((r) => r.id));
    } else {
      console.warn(`[webhook] subscription ${subId} is ${sub.status}: ${cancelled.length} cancelled licence(s) stay cancelled`);
    }
  }
  for (const id of ids) {
    const had = rows.find((r) => r.id === id).expires_at;
    const until = had && Date.parse(had) > Date.parse(expiresAt) ? new Date(Date.parse(had)).toISOString() : expiresAt;
    const { data: done, error: updErr } = await supabase
      .from('licenses')
      .update({ status: 'active', expires_at: until })
      .eq('id', id)
      .select('id');
    if (updErr) throw dbFailure(`renew subscription ${subId}`, updErr);
    if (!done || !done.length) throw new Error(`renewing subscription ${subId} changed no row for licence ${id}`);
    console.log(`[webhook] subscription ${subId} renewed licence ${id} to ${until}`);
  }
  return rows;
}

// ── Revoking a licence after a refund or a chargeback ──────────────────────

/*
 * A REFUND OR A CHARGEBACK ENDS THE PURCHASE, the subscription included.
 *
 * This webhook once handled four events and none of them was a refund: a
 * LIFETIME purchase writes expires_at null and status active, has no
 * subscription to cancel, and validateKey only asks for status active and an
 * unexpired date, so a refunded lifetime stayed valid forever. That was fixed,
 * and then every purchase moved to the site, where all three plans are
 * subscriptions, and none of it reached them:
 *
 *   A subscription's Checkout Session has no payment intent, so the lookup by
 *   session never found a site licence. A Dispute carries no customer, so a
 *   chargeback had nothing to go on at all. And a refund did not cancel the
 *   subscription: a weekly refunded on day two was charged again on day seven.
 *
 * FINDING THE LICENCE, in this order:
 *   1. The charge as this server's own API version renders it (stripe-node 14
 *      pins 2023-10-16, which still has charge.invoice; an event in basil does
 *      not), its invoice, and that invoice's subscription: every licence on
 *      that subscription. A subscription is one purchase, so this is exact.
 *   2. The checkout session of the charge's payment intent, which is how a
 *      one-time purchase (the old lifetime) is found.
 *   3. The customer, as a FALLBACK and only when they hold exactly one active
 *      licence: a customer who bought twice has several, and revoking all of
 *      them over one refund is a worse bug than the one this fixes.
 *
 * THE SUBSCRIPTION IS CANCELLED FIRST, so billing stops even while the
 * database refuses the revoke and Stripe retries it. A full refund or any
 * dispute cancels it, when it is Occlara's (occlaraSubscription); a partial
 * refund changes nothing at all.
 *
 * BOTH FIELDS ARE WRITTEN. status carries the reason, which support needs, and
 * expires_at is set to now so the licence dies even if validateKey is ever
 * relaxed about status. Two independent reasons for the same answer. The
 * reason is 'refunded' or 'disputed' where the licences table allows it, and
 * 'cancelled' where its status CHECK does not yet: the site's migration adds
 * the two, and this works on either side of it.
 */
async function revokeWhere(column, value, reason, label) {
  const at = new Date().toISOString();
  const pick = 'id,plan,status,stripe_subscription_id,user_id';
  let { data, error } = await supabase
    .from('licenses')
    .update({ status: reason, expires_at: at })
    .eq(column, value)
    .select(pick);
  if (error && error.code === '23514') {
    console.warn(`[webhook] ${label}: the licences table does not allow '${reason}' yet, writing '${REVOKED_FALLBACK}'`);
    ({ data, error } = await supabase
      .from('licenses')
      .update({ status: REVOKED_FALLBACK, expires_at: at })
      .eq(column, value)
      .select(pick));
  }
  if (error) throw dbFailure(`revoke the licences with ${column} ${value}`, error);
  if (data && data.length) console.log(`[webhook] ${label}: revoked ${data.length} licence(s) by ${column} ${value}`);
  return data || [];
}

async function revokeOnlyActive(customer, reason, label) {
  const { data: owned, error } = await supabase
    .from('licenses')
    .select('id,status,plan')
    .eq('stripe_customer_id', customer);
  if (error) throw dbFailure(`read the licences of customer ${customer}`, error);
  // A failed payment's licence works through its grace (license.js usable),
  // so it is one of the customer's live licences too. A FREE key is never one
  // a charge bought, so it neither counts toward "exactly one" nor is revoked
  // for one: the refund zeroes the account's free games instead (below).
  const live = (owned || []).filter((l) => l.plan !== 'free'
    && (l.status === 'active' || l.status === 'payment_failed'));
  if (live.length !== 1) {
    // Deliberately loud and deliberately inert. Revoking the wrong licence of a
    // repeat customer is worse than a refund that needs a human, so this asks
    // for one rather than guessing.
    console.error(`[webhook] ${label}: customer ${customer} has ${live.length} active licence(s), `
      + 'so this needs a human. NOT revoked.');
    return [];
  }
  return revokeWhere('id', live[0].id, reason, label);
}

/*
 * A RETRY OF A REFUND THE CUSTOMER FALLBACK MATCHED. The first delivery
 * revoked the customer's one live licence and then failed on the account (a
 * transient database error), so Stripe retried. On the retry revokeOnlyActive
 * finds no live licence, since it was revoked, and the account was never
 * ended. So when the fallback matches nothing, the customer's ONE licence
 * already revoked for a refund or a dispute names the account to end, with no
 * live one beside it: a customer with several is left for a human, as above.
 */
async function alreadyRevokedUsers(customer, label) {
  const { data: owned, error } = await supabase
    .from('licenses')
    .select('id,status,plan,user_id')
    .eq('stripe_customer_id', customer);
  if (error) throw dbFailure(`read the licences of customer ${customer}`, error);
  const paid = (owned || []).filter((l) => l.plan !== 'free');
  const live = paid.filter((l) => l.status === 'active' || l.status === 'payment_failed');
  // Refunded or disputed only: 'cancelled' is also an ordinary subscription's end.
  const revoked = paid.filter((l) => REVOKED.has(l.status));
  if (live.length || revoked.length !== 1 || !revoked[0].user_id) return [];
  console.log(`[webhook] ${label}: customer ${customer}'s one licence was revoked already (a retry), its account is ended`);
  return [revoked[0].user_id];
}

/**
 * Whether a refunded or disputed charge's subscription is Occlara's to stop.
 * The checkout that started it is asked first, from Stripe alone, so billing
 * stops even while the licences table cannot be read (a site checkout always
 * names its plan and its user, and so did the old Railway one); then whether a
 * licence names it (one made by hand, or bought before the site named its
 * plan). The site mints its licence at /success, so a refund that lands before
 * the buyer got there still stops the billing.
 */
async function occlaraSubscription(subId, label) {
  const list = await stripe.checkout.sessions.list({ subscription: subId, limit: 1 });
  const started = list && list.data && list.data[0];
  if (started && occlaraCheckout(started)) return true;
  const { data, error } = await supabase
    .from('licenses')
    .select('id')
    .eq('stripe_subscription_id', subId)
    .limit(1);
  if (error) throw dbFailure(`read the licences of subscription ${subId}`, error);
  if (data && data.length) return true;
  console.warn(`[webhook] ${label}: subscription ${subId} is not Occlara's (no Occlara checkout started it and no licence `
    + 'names it), so it is left billing');
  return false;
}

/** Stop a subscription billing, once, and never one Stripe already ended. */
async function cancelSubscription(subId, label, done) {
  if (!subId || done.has(subId)) return;
  done.add(subId);
  let sub;
  try {
    sub = await stripe.subscriptions.retrieve(subId);
  } catch (e) {
    if (e && e.code === 'resource_missing') {
      console.warn(`[webhook] ${label}: subscription ${subId} is not in Stripe, nothing to cancel`);
      return;
    }
    throw e;
  }
  if (SUB_ENDED.has(sub.status)) return;
  await stripe.subscriptions.cancel(subId);
  console.log(`[webhook] ${label}: subscription ${subId} cancelled, nothing more will be charged`);
}

async function revokeForCharge({ chargeId, customer, paymentIntent, reason, label }) {
  let charge = null;
  if (chargeId) charge = await stripe.charges.retrieve(chargeId, { expand: ['invoice'] });
  const who = idOf(charge && charge.customer) || customer || null;
  const pi = idOf(charge && charge.payment_intent) || paymentIntent || null;
  let subId = null;
  const inv = charge && charge.invoice;
  if (inv) subId = subscriptionOf(typeof inv === 'string' ? await stripe.invoices.retrieve(inv) : inv);

  const cancelled = new Set();
  const occlara = !!subId && await occlaraSubscription(subId, label);
  if (occlara) await cancelSubscription(subId, label, cancelled);

  let revoked = [];
  if (subId) revoked = await revokeWhere('stripe_subscription_id', subId, reason, label);
  if (!revoked.length && pi) {
    const list = await stripe.checkout.sessions.list({ payment_intent: pi, limit: 1 });
    const sessionId = list && list.data && list.data[0] ? list.data[0].id : null;
    if (sessionId) revoked = await revokeWhere('stripe_session_id', sessionId, reason, label);
  }
  if (!revoked.length && who) revoked = await revokeOnlyActive(who, reason, label);
  for (const r of revoked) await cancelSubscription(r.stripe_subscription_id, label, cancelled);

  if (!revoked.length) {
    console.error(`[webhook] ${label} on charge ${chargeId}: no licence matched (subscription ${subId}, `
      + `payment_intent ${pi}, customer ${who}), licence NOT revoked`);
  }

  // AND THEN THE ACCOUNT, only after the licence is revoked and the billing
  // stopped: the order above is unchanged, and a refused write here throws
  // like any licence write, so Stripe retries the whole event. A retry the
  // customer fallback can no longer match still finds its account
  // (alreadyRevokedUsers).
  const users = revoked.map((r) => r.user_id);
  if (!revoked.length && !subId && who) users.push(...await alreadyRevokedUsers(who, label));
  await endAccounts({
    users: [...new Set(users.filter(Boolean))],
    subId: occlara ? subId : null,
    label,
  });
  return revoked.length > 0;
}

// ── The one licence this server still mints ────────────────────────────────

/*
 * THE OLD RAILWAY CHECKOUT'S PURCHASES, named by client_reference_id or
 * metadata.userId. The site's checkout names its buyer as metadata.user_id and
 * mints its own licence (create-license, at /success and from the account page),
 * so a site purchase is one quiet line here, not an "UNLINKED PURCHASE": that
 * line, logged for every site sale, hid the real orphans it was written to find.
 */
/*
 * Answers { key } with the licence key the checkout holds (minted here or
 * before), { key: null } when it was minted meanwhile by someone else, or null
 * when the checkout is no Occlara purchase (its user is unknown).
 */
async function mintFromCheckout(session, userId, price) {
  const plan = await planOfCheckout(session, price);

  const { data: existing, error: lookupError } = await supabase
    .from('licenses')
    .select('id,license_key')
    .eq('stripe_session_id', session.id);
  if (lookupError) throw dbFailure(`look up a licence for checkout ${session.id}`, lookupError);
  if (existing && existing.length) {
    console.log(`[webhook] checkout ${session.id} already has its licence`);
    return { key: existing[0].license_key || null };
  }

  const key = generateLicenseKey();
  const { error: insertError } = await supabase.from('licenses').insert({
    user_id:                userId,
    license_key:            key,
    plan,
    status:                 'active',
    expires_at:             getExpiresAt(plan),
    stripe_customer_id:     idOf(session.customer),
    stripe_subscription_id: idOf(session.subscription),
    stripe_session_id:      session.id,
  });
  if (insertError && insertError.code === '23505') {
    console.log(`[webhook] checkout ${session.id} was minted meanwhile, nothing to add`);
    return { key: null };
  }
  if (insertError && FOREIGN_USER.has(insertError.code)) {
    // Not a buyer Occlara has: another app's checkout (FOREIGN_USER, above).
    console.warn(`[webhook] checkout ${session.id} names a user Occlara does not have (${insertError.code}), `
      + 'so it is no Occlara purchase: nothing minted');
    return null;
  }
  if (insertError) throw dbFailure(`mint the ${plan} licence of checkout ${session.id}`, insertError);
  console.log(`[webhook] checkout ${session.id}: minted a ${plan} licence`);
  return { key };
}

// ── The account (8.7): tier, monthly cap and free games ────────────────────

/*
 * WHAT A PURCHASE ENTITLES LIVES ON THE ACCOUNT, the entitlements table: the
 * tier (free, pro, max), the monthly cap (25 or 70), the free games and the
 * referral bonus. The licence key above stays exactly as it was for every 8.6
 * client; this is written beside it.
 *
 *   A purchase or a renewal (checkout.session.completed, invoice.paid) sets
 *   the tier from the price (billing.js tierOfPrice), cap, source, the
 *   subscription and period_anchor, the subscription's current period start,
 *   which the monthly cap counts from. A key minted here becomes the account's
 *   account_key.
 *   Stripe ending the subscription sets the tier free and the cap 0, the free
 *   games kept.
 *   A full refund or any dispute, after the licence is revoked and billing
 *   stopped (unchanged, above), sets the tier free and zeroes the free games
 *   and the bonus too, status ended: a refunded buyer does not keep games.
 *
 * Two kinds of row a subscription never moves: one made Max for life
 * (legacy_lifetime) and one given by hand (comp). A refund still ends them,
 * as it revokes anything the charge bought.
 *
 * EVERY WRITE CHECKS ITS ERROR AND THROWS, as the licence writes do, so Stripe
 * retries the event. Until the migration is live (accountsMissing) the
 * account is skipped with one line and the licence path is all there is.
 */
const NOT_LIVE = Symbol('accounts not live');
const HELD_SOURCES = new Set(['legacy_lifetime', 'comp']);

function accountsNotLive(label) {
  console.log(`[webhook] ${label}: accounts are not live yet (no entitlements table), the licence alone was handled`);
  return NOT_LIVE;
}

/** The user's entitlement row, made if missing (ensure_entitlement), null for a user Occlara does not have. */
async function ensureEntitlement(userId, label) {
  const { data, error } = await supabase.rpc('ensure_entitlement', { p_user: userId });
  if (accountsMissing(error)) return accountsNotLive(label);
  if (error && FOREIGN_USER.has(error.code)) {
    console.warn(`[webhook] ${label}: no such user for an account (${error.code}), account left`);
    return null;
  }
  if (error) throw dbFailure(`${label}: make the account of a buyer`, error);
  return (Array.isArray(data) ? data[0] : data) || null;
}

/**
 * One checked write to entitlements, its filters added by `where`. Answers the
 * rows it changed, or NOT_LIVE. An account_key another account already holds
 * (23505, the column is unique) is left as it is and the rest written, since
 * a retry could never land it.
 */
async function writeEntitlements(where, patch, what) {
  const run = (p) => where(supabase.from('entitlements').update({ ...p, updated_at: new Date().toISOString() })).select('user_id');
  let { data, error } = await run(patch);
  if (accountsMissing(error)) return accountsNotLive(what);
  if (error && error.code === '23505' && 'account_key' in patch) {
    console.warn(`[webhook] ${what}: that account key is another account's, written without it`);
    const rest = { ...patch };
    delete rest.account_key;
    ({ data, error } = await run(rest));
  }
  if (error) throw dbFailure(what, error);
  return data || [];
}

/**
 * A paid tier on one user's account. `ent` is the row ensureEntitlement gave.
 * A subscription's late event never revives an account its own refund ended,
 * and never moves a lifetime or comp account (above).
 */
async function grantPaid(userId, ent, grant, { subId, anchor, accountKey, label, boughtAt }) {
  if (!ent || ent === NOT_LIVE) return;
  if (ent.status === 'ended' && subId && ent.stripe_subscription_id === subId) {
    console.warn(`[webhook] ${label}: subscription ${subId} ended this account for a refund or a dispute, left ended. Needs a human.`);
    return;
  }
  // A purchase made before a refund or a dispute ended the account never
  // revives it: a replayed or late event of a one-time (lifetime) purchase has
  // no subscription to match above. Only a purchase made after it moves it.
  const endedAt = Date.parse(ent.updated_at || '');
  if (ent.status === 'ended' && Number.isFinite(boughtAt) && Number.isFinite(endedAt) && boughtAt <= endedAt) {
    console.warn(`[webhook] ${label}: bought before this account was ended for a refund or a dispute, left ended. Needs a human.`);
    return;
  }
  if (HELD_SOURCES.has(ent.source) && grant.source !== 'legacy_lifetime') {
    console.warn(`[webhook] ${label}: the account is ${ent.source}, which a subscription does not move, left as it is`);
    return;
  }
  const patch = {
    tier: grant.tier,
    cap_monthly: grant.cap,
    source: grant.source,
    stripe_subscription_id: subId || null,
    period_anchor: anchor,
    status: 'active',
    renew_as: grant.renewAs,
  };
  if (accountKey && accountKey !== ent.account_key) patch.account_key = accountKey;
  const done = await writeEntitlements((q) => q.eq('user_id', userId), patch, `${label}: set the ${grant.tier} tier`);
  if (done === NOT_LIVE) return;
  if (!done.length) throw new Error(`${label}: setting the ${grant.tier} tier changed no account`);
  console.log(`[webhook] ${label}: account set to ${grant.tier} (${grant.source}, ${grant.cap} a month)`);
}

/** The licence key of a user that this purchase bought, for account_key: never a free one. */
function keyOf(rows, userId) {
  const row = (rows || []).find((r) => r.user_id === userId && r.license_key && r.plan !== 'free' && !ENDED.has(r.status));
  return row ? row.license_key : null;
}

/** A checkout's account: the tier its price (or plan) entitles, from the period it started. */
async function entitleCheckout(session, userId, mintedKey, price) {
  const label = `checkout ${session.id}`;
  const ent = await ensureEntitlement(userId, label);
  if (!ent || ent === NOT_LIVE) return;

  const subId = idOf(session.subscription);
  let grant = null;
  let anchor = null;
  if (subId) {
    let sub = null;
    try {
      sub = await stripe.subscriptions.retrieve(subId);
    } catch (e) {
      if (!(e && e.code === 'resource_missing')) throw e;
      console.warn(`[webhook] ${label}: subscription ${subId} is not in Stripe, the tier is read from the checkout`);
    }
    if (sub && SUB_ENDED.has(sub.status)) {
      console.warn(`[webhook] ${label}: subscription ${subId} is ${sub.status} already, account left`);
      return;
    }
    grant = tierOfPrice(priceOfSubscription(sub));
    const start = periodStartOf(sub);
    if (start) anchor = new Date(start * 1000).toISOString();
  }
  if (!grant) grant = tierOfPrice(await price());
  if (!grant) grant = tierOfPlan(session.mode === 'payment' ? 'lifetime' : await planOfCheckout(session, price));
  if (!grant) {
    console.error(`[webhook] ${label}: nothing says what this purchase entitles, account left. Needs a human.`);
    return;
  }
  if (!anchor) anchor = new Date((Number(session.created) > 0 ? Number(session.created) * 1000 : Date.now())).toISOString();

  // The checkout's own licences: one revoked for a refund or a dispute means
  // this purchase was taken back, and a redelivered (or manually resent)
  // completion of it must never grant it again.
  const { data: bought, error: boughtError } = await supabase
    .from('licenses')
    .select('user_id,license_key,plan,status')
    .eq('stripe_session_id', session.id);
  if (boughtError) throw dbFailure(`${label}: read its licence for the account`, boughtError);
  if ((bought || []).some((r) => REVOKED.has(r.status))) {
    console.warn(`[webhook] ${label}: this purchase was refunded or disputed, account left as it is`);
    return;
  }
  const key = mintedKey || keyOf(bought, userId);
  const boughtAt = Number(session.created) > 0 ? Number(session.created) * 1000 : NaN;
  await grantPaid(userId, ent, grant, { subId, anchor, accountKey: key, label, boughtAt });
}

/**
 * The users a paid invoice's subscription belongs to: its licences' first,
 * then an account already naming it, then the Occlara checkout that started
 * it (the site mints the licence at /success, often after the first invoice).
 * NOT_LIVE when the accounts tables are not there.
 */
async function usersOfSubscription(subId, licences, label) {
  const { data: named, error } = await supabase
    .from('entitlements')
    .select('user_id')
    .eq('stripe_subscription_id', subId);
  if (accountsMissing(error)) return accountsNotLive(label);
  if (error) throw dbFailure(`${label}: read the accounts of subscription ${subId}`, error);
  const users = new Set((licences || []).map((r) => r.user_id).filter(Boolean));
  for (const r of named || []) if (r.user_id) users.add(r.user_id);
  if (!users.size) {
    const list = await stripe.checkout.sessions.list({ subscription: subId, limit: 1 });
    const started = list && list.data && list.data[0];
    const meta = (started && started.metadata) || {};
    const user = started && occlaraCheckout(started) ? (meta.user_id || meta.userId) : null;
    if (user) users.add(user);
  }
  return [...users];
}

/** A paid invoice's account: the tier its subscription's price entitles, from its current period. */
async function entitleInvoice(invoice, subId, licences) {
  const label = `invoice ${invoice.id}`;
  if (licences === null) return;   // too old to renew anything (renew)
  if ((licences || []).some((r) => REVOKED.has(r.status))) return;   // renew logged it for a human
  const users = await usersOfSubscription(subId, licences, label);
  if (users === NOT_LIVE) return;
  if (!users.length) {
    console.warn(`[webhook] ${label}: no account or Occlara checkout names subscription ${subId}, account left`);
    return;
  }
  const sub = await stripe.subscriptions.retrieve(subId);
  if (SUB_ENDED.has(sub.status)) {
    console.warn(`[webhook] ${label}: subscription ${subId} is ${sub.status}, account left`);
    return;
  }
  // A yearly bought before 8.7 is Max until it renews and Pro from then on:
  // a renewal is billing_reason subscription_cycle.
  const grant = tierOfPrice(priceOfSubscription(sub), { renewal: invoice.billing_reason === 'subscription_cycle' });
  if (!grant) {
    console.error(`[webhook] ${label}: subscription ${subId} has no price to read a tier from, account left`);
    return;
  }
  const start = periodStartOf(sub);
  const anchor = new Date(start ? start * 1000 : Date.now()).toISOString();
  for (const userId of users) {
    const ent = await ensureEntitlement(userId, label);
    if (ent === NOT_LIVE) return;
    await grantPaid(userId, ent, grant, { subId, anchor, accountKey: keyOf(licences, userId), label,
      boughtAt: Number(invoice.created) > 0 ? Number(invoice.created) * 1000 : NaN });
  }
}

/** Stripe ended a subscription: its accounts go free, cap 0, their free games kept. */
async function endSubscriptionAccounts(subId) {
  const label = `subscription ${subId} ended`;
  const done = await writeEntitlements(
    (q) => q.eq('stripe_subscription_id', subId).eq('status', 'active')
      .not('source', 'in', `(${[...HELD_SOURCES].join(',')})`),
    { tier: 'free', cap_monthly: 0, renew_as: null },
    `${label}: set its accounts free`);
  if (done !== NOT_LIVE) console.log(`[webhook] ${label}: ${done.length} account(s) set free`);
}

/*
 * A full refund or a dispute: every account the charge bought for ends, free
 * games and bonus zeroed. The users of the revoked licences, each made sure
 * of first (an account made later would start with free games), and any
 * account naming the subscription, which is how a refund that lands before
 * the site minted its licence still reaches the buyer.
 */
const ENDED_ACCOUNT = { tier: 'free', cap_monthly: 0, free_total: 0, bonus_pool: 0, status: 'ended', renew_as: null };
/*
 * The buyer an Occlara checkout that started a subscription names (metadata
 * user_id, or userId on the old checkout), as usersOfSubscription reads it.
 * A refund that lands before the site minted the licence AND before any event
 * set the account's subscription id ended nothing: the retried checkout event
 * then saw the subscription cancelled and left the account its free games.
 */
async function buyerOfSubscription(subId) {
  const list = await stripe.checkout.sessions.list({ subscription: subId, limit: 1 });
  const started = list && list.data && list.data[0];
  if (!started || !occlaraCheckout(started)) return null;
  const meta = started.metadata || {};
  return meta.user_id || meta.userId || started.client_reference_id || null;
}

async function endAccounts({ users, subId, label }) {
  let ended = 0;
  const buyers = new Set();
  if (subId) {
    const done = await writeEntitlements((q) => q.eq('stripe_subscription_id', subId), ENDED_ACCOUNT,
      `${label}: end the accounts of subscription ${subId}`);
    if (done === NOT_LIVE) return;
    ended += done.length;
    if (!done.length) {
      const buyer = await buyerOfSubscription(subId);
      if (buyer && !users.includes(buyer)) buyers.add(buyer);
    }
  }
  for (const userId of [...users, ...buyers]) {
    const ent = await ensureEntitlement(userId, label);
    if (ent === NOT_LIVE) return;
    if (!ent) continue;
    // Found only through the checkout: an account already paid for by ANOTHER
    // subscription is that purchase's, left for a human rather than ended.
    if (buyers.has(userId) && ent.stripe_subscription_id && ent.stripe_subscription_id !== subId && ent.status === 'active') {
      console.error(`[webhook] ${label}: the buyer of subscription ${subId} is on another subscription, account left. Needs a human.`);
      continue;
    }
    const done = await writeEntitlements((q) => q.eq('user_id', userId), ENDED_ACCOUNT, `${label}: end an account`);
    if (done === NOT_LIVE) return;
    if (!done.length) throw new Error(`${label}: ending an account changed no row`);
    ended += done.length;
  }
  console.log(`[webhook] ${label}: ${ended} account write(s) ended, free games zeroed`);
}

// ── Games bought one by one (8.8) ──────────────────────────────────────────

/*
 * A GAME IS GAME_PRICE_CENTS ($2), ANY WHOLE NUMBER FROM 1 TO 500 IN ONE
 * CHECKOUT. The site's create-games-checkout makes a mode payment Checkout
 * Session with one line (unit_amount 200, quantity N) and the metadata
 * { kind: 'games', games: N, user_id } on the session and on its payment
 * intent, the user taken from the buyer's verified JWT.
 *
 *   CREDIT. checkout.session.completed (or async_payment_succeeded) of kind
 *   games, paid, is held to what Stripe charged: amount_total exactly N times
 *   the price in usd, one line, quantity N. Anything else is refused with
 *   "GAMES PURCHASE REFUSED" in the log and answered 200, since a retry can
 *   never make it match (a human finds the buyer on the session). Then
 *   grant_purchased_games adds N to the account's bonus_pool, once per
 *   checkout session: game_purchases.ref is unique, so a redelivery grants
 *   nothing. Never to bonus_earned, which is the referral cap. A failed write
 *   throws, as every licence write does, and Stripe retries.
 *
 *   REFUND. A full refund or any dispute of a games payment takes back the
 *   unused games of THAT purchase (refund_purchased_games: bonus_pool less
 *   the smaller of the games it granted and what the pool holds, never below
 *   0) and RETURNS. It never reaches the licence code: the customer fallback
 *   there revokes a customer's ONE live licence, so a $2 pack refunded by a
 *   Pro subscriber revoked their Pro licence, cancelled their subscription
 *   and ended their account. A partial refund does nothing, as for a licence.
 *
 * A GAMES PAYMENT IS TOLD by the kind on its charge, then on its payment
 * intent, then on the checkout session of that payment intent, then by a
 * game_purchases row for that session. A charge with an invoice is a
 * subscription's and never a games payment.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isGamesMeta = (meta) => !!meta && meta.kind === 'games';

/** A games checkout refused for good: logged for a human and answered 200. */
function refuseGames(label, why) {
  console.error(`[webhook] GAMES PURCHASE REFUSED: ${label}, ${why}. Nothing granted; find the buyer on the session in Stripe. Needs a human.`);
}

async function grantGames(session) {
  const label = `games checkout ${session.id}`;
  const meta = session.metadata || {};
  if (session.payment_status !== 'paid') {
    console.log(`[webhook] ${label} is ${session.payment_status || 'not paid'}, nothing granted until it is paid`);
    return;
  }
  const games = wholeGames(meta.games);
  if (!games) return refuseGames(label, 'its metadata names no whole number of games from 1 to 500');
  const user = meta.user_id;
  if (!user || !UUID.test(String(user))) return refuseGames(label, 'its metadata names no user');
  const want = games * GAME_PRICE_CENTS;
  // ADAPTIVE PRICING: a buyer abroad may pay in their own currency, and then
  // the session's amount_total and currency are that currency's, while
  // currency_conversion (set by Stripe, never by the buyer) keeps what the
  // checkout was priced at, in usd. Held to that, or a paid buyer abroad
  // would be refused. Without a conversion, the session's own figures.
  const conv = session.currency_conversion && typeof session.currency_conversion === 'object'
    ? session.currency_conversion : null;
  const charged = conv ? conv.amount_total : session.amount_total;
  const chargedIn = conv ? conv.source_currency : session.currency;
  if (charged !== want) {
    return refuseGames(label, `it charged ${charged} for ${games} game(s), where ${want} was due`);
  }
  if (String(chargedIn || '').toLowerCase() !== 'usd') {
    return refuseGames(label, `it charged in ${chargedIn || 'no currency'}, not usd`);
  }
  // A Stripe failure here throws, and Stripe retries the event.
  const items = await stripe.checkout.sessions.listLineItems(session.id);
  const lines = (items && items.data) || [];
  const line = lines[0];
  const unit = line && line.price && line.price.unit_amount;
  if (lines.length !== 1 || line.quantity !== games || (unit != null && unit !== GAME_PRICE_CENTS)
    || (typeof line.amount_total === 'number' && String(line.currency || 'usd').toLowerCase() === 'usd'
      && line.amount_total !== want)) {
    return refuseGames(label, `its line items do not say ${games} game(s) at ${GAME_PRICE_CENTS}`);
  }

  const { data, error } = await supabase.rpc('grant_purchased_games',
    { p_user: user, p_games: games, p_ref: session.id, p_amount_cents: want });
  if (error && FOREIGN_USER.has(error.code)) return refuseGames(label, `it names a user Occlara does not have (${error.code})`);
  // Not live yet (the games migration) is a failed write too: the buyer paid,
  // so Stripe retries until the functions are there.
  if (error) throw dbFailure(`${label}: grant ${games} game(s)`, error);
  const r = (Array.isArray(data) ? data[0] : data) || {};
  if (!r.granted) {
    console.log(`[webhook] ${label}: granted before or refunded (${r.reason || 'no reason'}), nothing added`);
    return;
  }
  console.log(`[webhook] ${label}: ${games} game(s) added to the account, ${r.bonus_pool} bonus game(s) now`);
  if (r.account_status === 'ended') {
    console.error(`[webhook] ${label}: the buyer's account was ended by a refund or a dispute, so the games are held but `
      + 'cannot be played until a human reopens it. Needs a human.');
  }
}

/**
 * Whether a charge paid for games, decided before any licence is looked at.
 * Answers { sessionId, meta } for a games payment (sessionId null when no
 * checkout session can be found for it), or null for anything else.
 */
async function gamesPaymentOf({ chargeId, paymentIntent, eventCharge }) {
  let charge = null;
  if (chargeId) {
    try {
      charge = await stripe.charges.retrieve(chargeId);
    } catch (e) {
      // The licence path below asks for the same charge and answers for it.
      if (e && e.code === 'resource_missing') return null;
      throw e;
    }
  }
  const chargeMeta = (eventCharge && eventCharge.metadata) || (charge && charge.metadata) || {};
  let meta = isGamesMeta(chargeMeta) ? chargeMeta : null;
  // A subscription's charge (it has an invoice) is never a games payment.
  if (!meta && charge && charge.invoice) return null;

  const pi = idOf(charge && charge.payment_intent) || idOf(eventCharge && eventCharge.payment_intent) || paymentIntent || null;
  if (!meta && !pi) return null;
  if (!meta && pi) {
    let intent = null;
    try {
      intent = await stripe.paymentIntents.retrieve(pi);
    } catch (e) {
      if (!(e && e.code === 'resource_missing')) throw e;
    }
    if (intent && intent.invoice) return null;
    if (isGamesMeta(intent && intent.metadata)) meta = intent.metadata;
  }

  let session = null;
  if (pi) {
    const list = await stripe.checkout.sessions.list({ payment_intent: pi, limit: 1 });
    session = (list && list.data && list.data[0]) || null;
  }
  if (!meta && session && isGamesMeta(session.metadata)) meta = session.metadata;
  if (!meta && session) {
    // The row is the last word: a games purchase whose metadata were lost.
    const { data, error } = await supabase.from('game_purchases').select('ref,user_id,games').eq('ref', session.id).limit(1);
    if (error && !accountsMissing(error)) throw dbFailure(`read the games purchase of checkout ${session.id}`, error);
    const row = !error && data && data[0];
    if (row) meta = { kind: 'games', games: String(row.games), user_id: row.user_id };
  }
  if (!meta) return null;
  return { sessionId: session ? session.id : null, meta };
}

/** A full refund or a dispute of a games payment: the purchase's unused games taken back, nothing else. */
async function refundGames({ sessionId, meta }, label) {
  if (!sessionId) {
    console.error(`[webhook] ${label} of a games payment: no checkout session names it, no games taken back. `
      + 'The licence is left alone. Needs a human.');
    return;
  }
  const user = meta.user_id && UUID.test(String(meta.user_id)) ? meta.user_id : null;
  const { data, error } = await supabase.rpc('refund_purchased_games',
    { p_ref: sessionId, p_user: user, p_games: wholeGames(meta.games) });
  if (error && FOREIGN_USER.has(error.code)) {
    console.warn(`[webhook] ${label} of games checkout ${sessionId}: no such user (${error.code}), nothing to take back`);
    return;
  }
  if (error) throw dbFailure(`${label}: take back the games of checkout ${sessionId}`, error);
  const r = (Array.isArray(data) ? data[0] : data) || {};
  if (r.reason === 'none') {
    console.error(`[webhook] ${label} of games checkout ${sessionId}: no purchase and no buyer to record it under. Needs a human.`);
  } else if (r.reason === 'recorded') {
    console.warn(`[webhook] ${label} of games checkout ${sessionId} arrived before its grant: recorded, so the grant adds nothing`);
  } else if (!r.refunded) {
    console.log(`[webhook] ${label} of games checkout ${sessionId}: taken back before, nothing changed`);
  } else {
    console.log(`[webhook] ${label} of games checkout ${sessionId}: ${r.taken_back} unused game(s) taken back, licence untouched`);
  }
}

// POST /api/payments/webhook
async function webhookHandler(req, res) {
  const sig = req.headers['stripe-signature'];
  if (!sig) {
    console.warn('[webhook] Missing stripe-signature header');
    return res.status(400).json({ error: 'Missing Stripe signature' });
  }

  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error('[webhook] Signature verification failed:', err.message);
    return res.status(400).json({ error: `Webhook signature verification failed: ${err.message}` });
  }

  console.log(`[webhook] ${event.type} ${event.id || ''}`);

  try {
    switch (event.type) {

      // Only a games checkout is paid later (a delayed payment method); a
      // licence checkout's is left as it always was.
      case 'checkout.session.async_payment_succeeded': {
        const session = event.data.object;
        if (isGamesMeta(session.metadata)) await grantGames(session);
        else console.log(`[webhook] checkout ${session.id} paid later, not a games checkout, nothing to do`);
        break;
      }

      case 'checkout.session.completed': {
        const session = event.data.object;
        const meta = session.metadata || {};
        // Games are credited on their own and never mint or move a licence.
        if (isGamesMeta(meta)) {
          await grantGames(session);
          break;
        }
        const userId = session.client_reference_id || meta.userId || null;
        const price = checkoutPrice(session);
        if (!userId) {
          if (meta.user_id) {
            console.log(`[webhook] checkout ${session.id}: a site purchase (${meta.plan || 'plan not named'}), the site mints its licence`);
            // The site mints the key; the account is set here, at once, so
            // the tier holds before the buyer reaches /success.
            if (occlaraCheckout(session)) await entitleCheckout(session, meta.user_id, null, price);
            break;
          }
          // A PAID PURCHASE WITH NO LICENCE: neither the site's checkout nor
          // the old one made it. The buyer is on the session in Stripe.
          // Search Railway logs for "UNLINKED PURCHASE" to find every one.
          console.error(`[webhook] UNLINKED PURCHASE: checkout ${session.id}, customer ${idOf(session.customer) || 'none'}, `
            + `mode ${session.mode}. No licence was created; find the buyer on the session in Stripe.`);
          break;
        }
        const minted = await mintFromCheckout(session, userId, price);
        if (minted) await entitleCheckout(session, userId, minted.key, price);
        break;
      }

      case 'invoice.paid': {
        const invoice = event.data.object;
        const subId = subscriptionOf(invoice);
        if (!subId) {
          console.log(`[webhook] invoice ${invoice.id} paid, not a subscription's, nothing to renew`);
          break;
        }
        let end = latestLineEnd(invoice);
        if (!end) end = periodEndOf(await stripe.subscriptions.retrieve(subId));
        if (!end) throw new Error(`invoice ${invoice.id}: no period end on its lines or on subscription ${subId}`);
        const licences = await renew(subId, end, invoice.id);
        await entitleInvoice(invoice, subId, licences);
        break;
      }

      /*
       * A failed payment marks the licence, as it always did. Two things it
       * no longer does: rewrite a licence that has ended (cancelled, refunded,
       * disputed), and mark a customer who has since paid. Stripe does not
       * promise events in order, so a failure retried late can arrive after
       * the retry that succeeded, and it would have locked out a paying
       * customer until the next renewal. The invoice is asked how it stands now.
       */
      case 'invoice.payment_failed': {
        const invoice = event.data.object;
        const subId = subscriptionOf(invoice);
        if (!subId) break;
        const now = await stripe.invoices.retrieve(invoice.id);
        if (now && now.status === 'paid') {
          console.log(`[webhook] invoice ${invoice.id} failed once and is paid now, licence left as it is`);
          break;
        }
        const { data, error } = await supabase
          .from('licenses')
          .update({ status: 'payment_failed' })
          .eq('stripe_subscription_id', subId)
          .eq('status', 'active')
          .neq('plan', 'lifetime')
          .select('id');
        if (error) throw dbFailure(`mark subscription ${subId} payment_failed`, error);
        console.log(`[webhook] payment failed for subscription ${subId}, ${data ? data.length : 0} licence(s) marked`);
        break;
      }

      // Stripe ended the subscription. A licence revoked for a refund or a
      // chargeback keeps that reason rather than becoming merely cancelled,
      // and a lifetime licence that names it is not billed by it.
      case 'customer.subscription.deleted': {
        const subId = event.data.object.id;
        const { data, error } = await supabase
          .from('licenses')
          .update({ status: 'cancelled' })
          .eq('stripe_subscription_id', subId)
          .in('status', ['active', 'payment_failed', 'expired'])
          .neq('plan', 'lifetime')
          .select('id');
        if (error) throw dbFailure(`cancel the licences of subscription ${subId}`, error);
        console.log(`[webhook] subscription ${subId} ended, ${data ? data.length : 0} licence(s) cancelled`);
        await endSubscriptionAccounts(subId);
        break;
      }

      /*
       * A FULL refund revokes. A PARTIAL one must not: charge.refunded fires
       * for both, and a goodwill partial refund is not a reason to take the
       * product away. Stripe sets `refunded` true only when the charge is
       * fully refunded, and the amounts are compared as well because that
       * flag is the one thing here worth double checking.
       */
      case 'charge.refunded': {
        const charge = event.data.object;
        const full = charge.refunded === true && charge.amount_refunded >= charge.amount;
        if (!full) {
          console.log(`[webhook] partial refund on charge ${charge.id} `
            + `(${charge.amount_refunded} of ${charge.amount}), licence left alone`);
          break;
        }
        // A games payment takes back its games and RETURNS, before any licence lookup.
        const games = await gamesPaymentOf({ chargeId: charge.id, paymentIntent: idOf(charge.payment_intent), eventCharge: charge });
        if (games) {
          await refundGames(games, 'refund');
          break;
        }
        await revokeForCharge({
          chargeId: charge.id,
          customer: idOf(charge.customer),
          paymentIntent: idOf(charge.payment_intent),
          reason: 'refunded',
          label: 'refund',
        });
        break;
      }

      /*
       * A chargeback is a refund the customer took without asking, so it
       * revokes on the same terms. Waiting for the dispute to resolve would
       * mean serving a product to someone who has already taken the money back.
       * A Dispute has no customer of its own: the charge it names has.
       */
      case 'charge.dispute.created': {
        const dispute = event.data.object;
        const games = await gamesPaymentOf({ chargeId: idOf(dispute.charge), paymentIntent: idOf(dispute.payment_intent) });
        if (games) {
          await refundGames(games, 'chargeback');
          break;
        }
        await revokeForCharge({
          chargeId: idOf(dispute.charge),
          paymentIntent: idOf(dispute.payment_intent),
          reason: 'disputed',
          label: 'chargeback',
        });
        break;
      }

      default:
        console.log(`[webhook] Unhandled event type: ${event.type}`);
    }

    res.json({ received: true });
  } catch (err) {
    console.error('[webhook] Handler error:', err.message);
    res.status(500).json({ error: 'Webhook handler failed' });
  }
}

module.exports = webhookHandler;
// For the offline tests.
module.exports.__test = { getExpiresAt, generateLicenseKey, planFromMode, PLAN_DAYS, occlaraPlanName };
