'use strict';

/**
 * HOW A LICENCE FOLLOWS ITS STRIPE SUBSCRIPTION, in one place.
 *
 * The webhook (renewals, refunds), /api/payments/cancel and the admin repair
 * route all read Stripe's objects and turn them into a licence's status and
 * expiry. Three copies of that rule would drift the way the channel names once
 * did, so they share this one.
 *
 * TWO API VERSIONS AT ONCE. The server's own calls are answered in the version
 * stripe-node 14 pins (2023-10-16), but a webhook event arrives in the
 * endpoint's version, and from 2025-03-31.basil on an Invoice's subscription is
 * parent.subscription_details.subscription and a Subscription's period is on
 * its items. Everything here reads both shapes.
 *
 * THE EXPIRY IS STRIPE'S PERIOD END PLUS A GRACE. Stripe charges a renewal
 * about an hour after the period ends, up to three days later when its own
 * deliveries fail, and the desktop app stops the recording in progress the
 * minute a licence's expiry passes. So a licence runs two days past the period
 * end, and invoice.paid moves it on.
 *
 * ONE SET TO CANCEL AT THE PERIOD END GETS THE GRACE TOO. It used to run to
 * that end exactly, because nothing would renew it, but the customer can renew
 * it in Stripe's billing portal before then (the site's Manage subscription),
 * and nothing tells this server: the renewal came about an hour after the end,
 * and for that hour the licence read as expired and the app stopped the match
 * being recorded. Access still stops at the end when the customer does not
 * renew: Stripe ends the subscription then, and the webhook's
 * customer.subscription.deleted sets the licence cancelled. The end the
 * customer is shown is Stripe's own, never this expiry.
 */

const DAY_MS = 24 * 60 * 60 * 1000;
const GRACE_MS = 2 * DAY_MS;

// A licence in one of these has ended: by Stripe, or revoked for a refund or a
// chargeback. 'refunded' and 'disputed' exist once the site's migration adds them.
const LICENCE_ENDED = new Set(['cancelled', 'refunded', 'disputed']);
const LICENCE_REVOKED = new Set(['refunded', 'disputed']);
// A subscription Stripe is billing, and one it has finished with.
const SUB_BILLING = new Set(['active', 'trialing']);
const SUB_ENDED = new Set(['canceled', 'incomplete_expired']);

/** An id, whether Stripe sent the id or the expanded object. */
function idOf(x) {
  if (!x) return null;
  if (typeof x === 'string') return x;
  return typeof x.id === 'string' ? x.id : null;
}

/**
 * The subscription an invoice bills: `subscription` up to 2025-03-31.basil,
 * parent.subscription_details.subscription from it on, and a line's own as
 * the last resort (line.subscription, or its parent's subscription_item_details).
 */
function subscriptionOf(invoice) {
  if (!invoice || typeof invoice !== 'object') return null;
  const details = invoice.parent && invoice.parent.subscription_details;
  const direct = idOf(invoice.subscription) || idOf(details && details.subscription);
  if (direct) return direct;
  for (const line of (invoice.lines && invoice.lines.data) || []) {
    const item = line && line.parent && line.parent.subscription_item_details;
    const id = idOf(line && line.subscription) || idOf(item && item.subscription);
    if (id) return id;
  }
  return null;
}

/** The latest period end on an invoice's lines, in seconds, or null. */
function latestLineEnd(invoice) {
  let end = null;
  for (const line of (invoice && invoice.lines && invoice.lines.data) || []) {
    const e = line && line.period && Number(line.period.end);
    if (Number.isFinite(e) && e > 0 && (end === null || e > end)) end = e;
  }
  return end;
}

/** A subscription's current period end in seconds: on it up to basil, on its items from basil on. */
function periodEndOf(sub) {
  if (!sub) return null;
  const top = Number(sub.current_period_end);
  if (Number.isFinite(top) && top > 0) return top;
  let end = null;
  for (const item of (sub.items && sub.items.data) || []) {
    const e = Number(item && item.current_period_end);
    if (Number.isFinite(e) && e > 0 && (end === null || e > end)) end = e;
  }
  return end;
}

/** A subscription's current period start in seconds: on it up to basil, on its items from basil on (the earliest). */
function periodStartOf(sub) {
  if (!sub) return null;
  const top = Number(sub.current_period_start);
  if (Number.isFinite(top) && top > 0) return top;
  let start = null;
  for (const item of (sub.items && sub.items.data) || []) {
    const s = Number(item && item.current_period_start);
    if (Number.isFinite(s) && s > 0 && (start === null || s < start)) start = s;
  }
  return start;
}

/** A period end in seconds as a licence's expiry: that end plus the grace. */
function withGrace(endSec) {
  return new Date(endSec * 1000 + GRACE_MS).toISOString();
}

/**
 * The expiry a living subscription gives its licence, or null when it has no
 * period: its period end plus the grace, set to cancel or not (above).
 */
function expiryFor(sub) {
  const end = periodEndOf(sub);
  return end ? withGrace(end) : null;
}

/**
 * THE EXPIRY OF A LICENCE WHOSE PAYMENT IS FAILING (past_due, unpaid,
 * incomplete, paused): the period PAID for plus the grace, never the one
 * being collected, or null when the subscription gives no period start.
 *
 * Stripe moves a subscription's period on when it bills the renewal, paid or
 * not ("the subscription continues to create invoices"), so a failing one's
 * current period is the one nobody paid for, and it began where the paid one
 * ended. Its END plus the grace was harmless while no licence check took
 * payment_failed; since a failed payment is a grace (routes/license.js
 * usable), it was the whole unpaid period free: 32 days on a monthly plan,
 * 367 on a yearly one, and an unpaid licence (Stripe done retrying) revived.
 *
 *   past_due   Stripe is still trying the card: the period's start plus the
 *              grace, what invoice.payment_failed leaves on a licence, so a
 *              licence whose renewals never reached it gets its grace too.
 *              This takes Stripe's default status rule (the most recent
 *              invoice decides), under which past_due means the current
 *              period's renewal failed.
 *   unpaid, incomplete, paused
 *              Stripe has stopped collecting, or never collected: never later
 *              than the licence already runs (`current`), nor than that start
 *              plus the grace.
 */
function failingExpiryFor(sub, current) {
  const start = periodStartOf(sub);
  if (!start) return null;
  const paid = withGrace(start);
  if (sub.status === 'past_due') return paid;
  const own = current ? Date.parse(current) : NaN;
  return Number.isFinite(own) && own < Date.parse(paid) ? new Date(own).toISOString() : paid;
}

/**
 * The licence status a subscription's status means. A subscription Stripe is
 * billing is active; one whose payment is failing, unpaid, incomplete or
 * paused is payment_failed, which the app words as "update your payment
 * method"; one Stripe ended is cancelled.
 */
function licenceStatusOf(subStatus) {
  if (SUB_BILLING.has(subStatus)) return 'active';
  if (SUB_ENDED.has(subStatus)) return 'cancelled';
  if (['past_due', 'unpaid', 'incomplete', 'paused'].includes(subStatus)) return 'payment_failed';
  return null;
}

/** A failed database call, logged by code and message: a CHECK violation's details are the whole row, key included. */
function dbError(error) {
  return `${(error && error.code) || 'no code'} ${(error && error.message) || String(error)}`;
}

/*
 * ── TIERS (8.7): what a purchase entitles, read from the price ──────────────
 *
 * A licence key keeps the plan an 8.6 client understands (weekly, monthly,
 * yearly, lifetime, and now free): its usable() is shipped and cannot change,
 * so a key is never minted with plan 'pro' or 'max'. The TIER lives on the
 * account (the entitlements table) and is read from the Stripe price's
 * lookup_key, occlara_{pro,max}_{monthly,yearly}. A price without one is an
 * old price, and the payer rules say what it becomes:
 *
 *   weekly, monthly  Pro, at the price they pay, until they cancel.
 *   yearly           Max until its renewal, then Pro yearly (renew_as
 *                    'pro_yearly' says so until it renews).
 *   lifetime         Max for life.
 *
 * The cap is per month on every paid tier, yearly included.
 */
const TIER_CAP = Object.freeze({ pro: 25, max: 70 });
const LOOKUP_KEY = /^occlara_(pro|max)_(monthly|yearly)$/;
const INTERVAL_PLAN = Object.freeze({ week: 'weekly', month: 'monthly', year: 'yearly' });

/*
 * THE ACCOUNTS TABLES MAY NOT EXIST YET. The site's migration adds them and the
 * owner applies it; until then every query of them is refused as a relation
 * PostgREST does not know (PGRST205, or 42P01 from Postgres itself), and the
 * SQL functions as unknown (PGRST202, or 42883). Any of those means "accounts
 * not live": the licence is handled exactly as before and the account is left.
 */
const ACCOUNTS_MISSING = new Set(['42P01', 'PGRST205', 'PGRST202', '42883']);
function accountsMissing(error) {
  return !!(error && ACCOUNTS_MISSING.has(error.code));
}

/**
 * What an old plan entitles, by the payer rules (above), or null for a plan
 * that is none of them. `renewal` says a yearly is being renewed, which is
 * where it moves from Max to Pro.
 */
function tierOfPlan(plan, { renewal = false } = {}) {
  if (plan === 'weekly') return { tier: 'pro', cap: TIER_CAP.pro, source: 'legacy_weekly', plan, renewAs: null };
  if (plan === 'monthly') return { tier: 'pro', cap: TIER_CAP.pro, source: 'legacy_monthly', plan, renewAs: null };
  if (plan === 'yearly') {
    return renewal
      ? { tier: 'pro', cap: TIER_CAP.pro, source: 'legacy_yearly', plan, renewAs: null }
      : { tier: 'max', cap: TIER_CAP.max, source: 'legacy_yearly', plan, renewAs: 'pro_yearly' };
  }
  if (plan === 'lifetime') return { tier: 'max', cap: TIER_CAP.max, source: 'legacy_lifetime', plan, renewAs: null };
  return null;
}

/**
 * What a Stripe price entitles: its lookup_key when it is one of Occlara's
 * tiers (source 'stripe', the licence plan monthly or yearly), else the old
 * plan its interval names (a price with no recurring interval is a one-time
 * charge, the old lifetime). Null when there is no price to read.
 */
function tierOfPrice(price, { renewal = false } = {}) {
  if (!price || typeof price !== 'object') return null;
  const m = LOOKUP_KEY.exec(String(price.lookup_key || ''));
  if (m) return { tier: m[1], cap: TIER_CAP[m[1]], source: 'stripe', plan: m[2], renewAs: null };
  const interval = price.recurring && price.recurring.interval;
  if (interval) return tierOfPlan(INTERVAL_PLAN[interval] || null, { renewal });
  return tierOfPlan('lifetime');
}

/** The price a subscription bills: its first item's (Occlara's have one). */
function priceOfSubscription(sub) {
  const item = sub && sub.items && sub.items.data && sub.items.data[0];
  return (item && item.price) || null;
}

module.exports = {
  DAY_MS, GRACE_MS, LICENCE_ENDED, LICENCE_REVOKED, SUB_BILLING, SUB_ENDED,
  idOf, subscriptionOf, latestLineEnd, periodStartOf, periodEndOf, withGrace, expiryFor, failingExpiryFor,
  licenceStatusOf, dbError,
  TIER_CAP, LOOKUP_KEY, INTERVAL_PLAN, accountsMissing, tierOfPlan, tierOfPrice, priceOfSubscription,
};
