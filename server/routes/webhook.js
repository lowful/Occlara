'use strict';
const crypto   = require('crypto');
const stripe   = require('stripe')(process.env.STRIPE_SECRET_KEY);
const supabase = require('../db/supabase');
const {
  DAY_MS, GRACE_MS, LICENCE_ENDED: ENDED, LICENCE_REVOKED: REVOKED, SUB_BILLING: BILLING, SUB_ENDED,
  idOf, subscriptionOf, latestLineEnd, periodEndOf, withGrace, dbError,
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
const INTERVAL_PLAN = { week: 'weekly', month: 'monthly', year: 'yearly' };

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
  return PLANS.has(meta.plan) && !!(meta.user_id || meta.userId);
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

async function planOfCheckout(session) {
  const named = session.metadata && session.metadata.plan;
  if (PLANS.has(named)) return named;
  try {
    const items = await stripe.checkout.sessions.listLineItems(session.id);
    const price = items && items.data && items.data[0] && items.data[0].price;
    const interval = price && price.recurring && price.recurring.interval;
    if (session.mode === 'subscription' && INTERVAL_PLAN[interval]) return INTERVAL_PLAN[interval];
  } catch (e) {
    console.error(`[webhook] could not list the line items of ${session.id}:`, e.message);
  }
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
async function renew(subId, endSec, invoiceId) {
  const expiresAt = withGrace(endSec);
  if (Date.parse(expiresAt) <= Date.now()) {
    console.warn(`[webhook] invoice ${invoiceId} paid for a period that ended over two days ago, nothing renewed`);
    return;
  }
  // A lifetime licence that names a subscription (one made lifetime by hand)
  // is not billed by it, so a renewal never gives it an expiry.
  const { data: rows, error } = await supabase
    .from('licenses')
    .select('id,status,expires_at')
    .eq('stripe_subscription_id', subId)
    .neq('plan', 'lifetime');
  if (error) throw dbFailure(`read the licences of subscription ${subId}`, error);
  if (!rows || !rows.length) {
    // The site mints the licence when the buyer reaches /success, from the
    // same period, so the first invoice of a subscription often lands here.
    console.warn(`[webhook] no licence carries subscription ${subId} yet, nothing renewed (invoice ${invoiceId})`);
    return;
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
  const pick = 'id,plan,status,stripe_subscription_id';
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
    .select('id,status')
    .eq('stripe_customer_id', customer);
  if (error) throw dbFailure(`read the licences of customer ${customer}`, error);
  // A failed payment's licence works through its grace (license.js usable),
  // so it is one of the customer's live licences too.
  const live = (owned || []).filter((l) => l.status === 'active' || l.status === 'payment_failed');
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
  if (subId && await occlaraSubscription(subId, label)) await cancelSubscription(subId, label, cancelled);

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
async function mintFromCheckout(session, userId) {
  const plan = await planOfCheckout(session);

  const { data: existing, error: lookupError } = await supabase
    .from('licenses')
    .select('id')
    .eq('stripe_session_id', session.id);
  if (lookupError) throw dbFailure(`look up a licence for checkout ${session.id}`, lookupError);
  if (existing && existing.length) {
    console.log(`[webhook] checkout ${session.id} already has its licence`);
    return;
  }

  const { error: insertError } = await supabase.from('licenses').insert({
    user_id:                userId,
    license_key:            generateLicenseKey(),
    plan,
    status:                 'active',
    expires_at:             getExpiresAt(plan),
    stripe_customer_id:     idOf(session.customer),
    stripe_subscription_id: idOf(session.subscription),
    stripe_session_id:      session.id,
  });
  if (insertError && insertError.code === '23505') {
    console.log(`[webhook] checkout ${session.id} was minted meanwhile, nothing to add`);
    return;
  }
  if (insertError && FOREIGN_USER.has(insertError.code)) {
    // Not a buyer Occlara has: another app's checkout (FOREIGN_USER, above).
    console.warn(`[webhook] checkout ${session.id} names a user Occlara does not have (${insertError.code}), `
      + 'so it is no Occlara purchase: nothing minted');
    return;
  }
  if (insertError) throw dbFailure(`mint the ${plan} licence of checkout ${session.id}`, insertError);
  console.log(`[webhook] checkout ${session.id}: minted a ${plan} licence`);
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

      case 'checkout.session.completed': {
        const session = event.data.object;
        const meta = session.metadata || {};
        const userId = session.client_reference_id || meta.userId || null;
        if (!userId) {
          if (meta.user_id) {
            console.log(`[webhook] checkout ${session.id}: a site purchase (${meta.plan || 'plan not named'}), the site mints its licence`);
            break;
          }
          // A PAID PURCHASE WITH NO LICENCE: neither the site's checkout nor
          // the old one made it. The buyer is on the session in Stripe.
          // Search Railway logs for "UNLINKED PURCHASE" to find every one.
          console.error(`[webhook] UNLINKED PURCHASE: checkout ${session.id}, customer ${idOf(session.customer) || 'none'}, `
            + `mode ${session.mode}. No licence was created; find the buyer on the session in Stripe.`);
          break;
        }
        await mintFromCheckout(session, userId);
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
        await renew(subId, end, invoice.id);
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
module.exports.__test = { getExpiresAt, generateLicenseKey, planFromMode, PLAN_DAYS };
