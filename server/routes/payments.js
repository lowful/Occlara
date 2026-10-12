'use strict';
const express  = require('express');
const stripe   = require('stripe')(process.env.STRIPE_SECRET_KEY);
const supabase = require('../db/supabase');
const { requireUser } = require('../services/account-auth');
const { SUB_ENDED, periodEndOf, withGrace, licenceStatusOf, dbError } = require('../services/billing');

const router = express.Router();
const signedIn = requireUser(supabase);

/*
 * THE OLD PUBLIC CHECKOUT IS CLOSED, and so is its success page.
 *
 * POST /create-checkout asked for no sign in, took any userId and email, and
 * sold whatever STRIPE_PRICE_WEEKLY, MONTHLY and LIFETIME named, the $20 and
 * $100 prices among them, while the webhook minted the licence. This repo is
 * public, so anyone could buy lifetime with one curl. GET /success handed the
 * licence key of whoever owned a session to anyone holding its id, again with
 * no sign in. The site sells through its own create-checkout (a Supabase edge
 * function that needs the buyer's session) and shows the key on its own
 * /success, and neither the site nor the app calls these two any more, so they
 * answer 410 Gone with a sentence saying where to go. The STRIPE_PRICE_*
 * variables are read nowhere now and can be removed from Railway.
 */
router.post('/create-checkout', (req, res) => {
  res.status(410).json({ error: 'This checkout is no longer in use. Buy Occlara at occlara.app.' });
});
router.get('/success', (req, res) => {
  res.status(410).json({ error: 'This page is no longer in use. Your licence key is in your account at occlara.app.' });
});

// A licence that can still lose access early to a write here: the expiry of
// one already cancelled, refunded or disputed is left as it is.
const STILL_ON = ['active', 'payment_failed'];

// POST /api/payments/cancel
// Header: Authorization: Bearer <Supabase access token>. Body: { userId?, email? },
// and a userId sent must be the token's own user. The website sends both.
router.post('/cancel', signedIn, async (req, res) => {
  // Express 4 does not catch an async route's throw: the request would hang
  // until the client gave up. Anything unexpected is a 500 with a sentence.
  try {
    await cancelAll(req, res);
  } catch (e) {
    console.error('[payments] Cancel error:', e.message);
    if (!res.headersSent) res.status(500).json({ error: 'Failed to cancel subscription: ' + e.message });
  }
});

async function cancelAll(req, res) {
  const userId = req.user.id;

  /*
   * EVERY LICENCE THIS USER HOLDS, newest first.
   *
   * This used to be .eq('user_id').single(), and .single() errors on more
   * than one row. The site writes a row per purchase, so a monthly subscriber
   * who resubscribed or later bought lifetime was told "No license found" and
   * could not stop the subscription that was still charging them.
   */
  const { data: rows, error: licenseError } = await supabase
    .from('licenses')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });

  if (licenseError) {
    console.error('[payments] cancel lookup failed:', dbError(licenseError));
    return res.status(503).json({ error: 'Could not read your licences right now. Try again in a minute.', retry: true });
  }
  const all = rows || [];
  if (!all.length) return res.status(404).json({ error: 'No license found' });

  /*
   * EVERY SUBSCRIPTION STRIPE IS STILL BILLING, not just the newest licence's.
   *
   * Only the newest cancellable row used to be cancelled, so a customer with
   * two subscriptions (a weekly, then a monthly bought on top of it) stopped
   * one and went on paying for the other. And the row's status is not the
   * question: a licence the site marked cancelled while its Stripe call failed
   * kept billing, and was then refused here as having nothing to cancel. So
   * Stripe is asked about every subscription any of the user's licences
   * names, and every one it has not ended is set to cancel at its period end,
   * or ended now when its payment is failing (below).
   */
  const subIds = [...new Set(all.map((l) => l.stripe_subscription_id).filter(Boolean))];
  const billing = [];
  const failed = [];
  for (const id of subIds) {
    try {
      const sub = await stripe.subscriptions.retrieve(id);
      if (!SUB_ENDED.has(sub.status)) billing.push({ id, status: sub.status });
    } catch (e) {
      // A subscription Stripe has no record of cannot charge anyone.
      if (e && e.code === 'resource_missing') continue;
      failed.push({ id, error: e.message });
    }
  }

  if (!billing.length && !failed.length) {
    // NOTHING THAT CAN CHARGE AGAIN: a lifetime licence never renews, and
    // neither does one granted without Stripe or one Stripe already ended.
    // Nothing is written, where a row with no subscription used to be set to
    // 'cancelled' on the spot, ending access the player still had.
    //
    // Still a 400 with the sentence in `error`, the shape lifetime always
    // got. The website is a separate repo, and a page that branches on res.ok
    // would read a 200 as "your subscription was cancelled" when nothing was.
    // The fields after `error` are for a page that wants to say which case it is.
    const newest = all.find((l) => l.status === 'active') || all[0];
    const message = newest.plan === 'lifetime'
      ? 'A lifetime licence has no subscription, so nothing will be charged again and there is nothing to cancel.'
      : 'There is no active subscription on this account to cancel.';
    return res.status(400).json({
      error: message,
      success: false,
      cancelled: false,
      reason: 'no-subscription',
      plan: newest.plan || null,
      message,
    });
  }

  /*
   * ONE WHOSE PAYMENT IS FAILING IS ENDED NOW, not at its period end.
   *
   * past_due, unpaid, incomplete or paused means the current period was never
   * paid, so there is no paid access to keep, and the licence is already
   * payment_failed. Set to cancel at its period end, Stripe went on retrying
   * the unpaid invoice for the rest of that period (Smart Retries, up to two
   * weeks), so a customer who pressed Cancel, which the account page offers
   * them as the way to stop the retries, could still be charged for a period
   * they had cancelled. Cancelling it now stops every retry: Stripe stops
   * collecting a cancelled subscription's open invoices.
   */
  const stopped = [];
  for (const { id, status } of billing) {
    try {
      if (licenceStatusOf(status) === 'payment_failed') {
        await stripe.subscriptions.cancel(id);
        stopped.push({ id, endSec: null, accessUntil: null, endedNow: true });
        continue;
      }
      const sub = await stripe.subscriptions.update(id, { cancel_at_period_end: true });
      const end = periodEndOf(sub);
      stopped.push({ id, endSec: end || null, accessUntil: end ? new Date(end * 1000).toISOString() : null });
    } catch (e) {
      failed.push({ id, error: e.message });
    }
  }

  /*
   * DO NOT WRITE status HERE, and this is the whole bug that was fixed.
   *
   * cancel_at_period_end means Stripe keeps the subscription running until the
   * period the customer already paid for runs out. This used to write
   * status:'cancelled' at the same moment, and licence.js rejects any row whose
   * status is not 'active' BEFORE it ever looks at expires_at. So a customer who
   * cancelled on day 2 of a paid month was locked out of the app within three
   * minutes, on a month they had paid for.
   *
   * expires_at is the only thing that moves: to the end of the paid period
   * plus the grace, the same as a renewal gives (services/billing.js), because
   * the customer can still renew it in Stripe's portal before the end, which
   * nothing tells this server, and Stripe charges that renewal about an hour
   * after the end. The guards let them through, and customer.subscription.deleted
   * flips status to 'cancelled' when Stripe actually ends it, at the end the
   * customer is told (accessUntil, Stripe's own). Every write is checked: one
   * the database refused used to be ignored, and the page was told it worked.
   * One ended now writes nothing here: the webhook's subscription.deleted does.
   */
  const writeFailed = [];
  for (const s of stopped) {
    if (!s.endSec) continue;
    // A lifetime licence that names the subscription (made lifetime by hand)
    // is not billed by it, and is never given an expiry here.
    const { error } = await supabase
      .from('licenses')
      .update({ expires_at: withGrace(s.endSec) })
      .eq('stripe_subscription_id', s.id)
      .in('status', STILL_ON)
      .neq('plan', 'lifetime');
    if (error) {
      console.error(`[payments] cancel: the expiry of subscription ${s.id} was not written:`, dbError(error));
      writeFailed.push(s.id);
    }
  }

  // endedNow marks one whose payment was failing, cancelled at once: no access
  // is left on it to promise, so it carries no accessUntil.
  const subscriptions = stopped.map((s) => (s.endedNow
    ? { id: s.id, cancelled: true, accessUntil: null, endedNow: true }
    : { id: s.id, cancelled: true, accessUntil: s.accessUntil }))
    .concat(failed.map((f) => ({ id: f.id, cancelled: false })));

  if (failed.length) {
    console.error(`[payments] cancel: ${failed.length} of ${subIds.length} subscription(s) not stopped:`,
      failed.map((f) => `${f.id} ${f.error}`).join('; '));
    return res.status(502).json({
      error: stopped.length
        ? 'Billing was stopped for some of your subscriptions but not all of them. Try again in a minute, or email support@occlara.app.'
        : 'Billing could not be stopped just now. Nothing was changed. Try again in a minute, or email support@occlara.app.',
      success: false,
      cancelled: false,
      partial: stopped.length > 0,
      retry: true,
      subscriptions,
    });
  }
  if (writeFailed.length) {
    return res.status(500).json({
      error: 'Billing is stopped, but your licence could not be updated just now. Try again in a minute.',
      success: false,
      cancelled: true,
      billingStopped: true,
      retry: true,
      subscriptions,
    });
  }

  const ends = stopped.map((s) => s.accessUntil).filter(Boolean).sort();
  const now = stopped.filter((s) => s.endedNow).length;
  console.log(`[payments] ${stopped.length - now} subscription(s) set to cancel at the period end, ${now} failing one(s) ended now`);
  return res.json({
    success:     true,
    cancelled:   true,
    message:     'Subscription cancelled',
    accessUntil: ends.length ? ends[ends.length - 1] : null,
    subscriptions,
  });
}

module.exports = router;
