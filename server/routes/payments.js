'use strict';
const express  = require('express');
const stripe   = require('stripe')(process.env.STRIPE_SECRET_KEY);
const supabase = require('../db/supabase');
const { requireUser } = require('../services/account-auth');

const router = express.Router();
const signedIn = requireUser(supabase);

/*
 * The licence /cancel acts on: the newest one with a subscription that can
 * still charge. 'payment_failed' counts, because Stripe is still retrying that
 * card and stopping it is exactly what the player wants. Rows come newest first.
 */
const CANCELLABLE = new Set(['active', 'payment_failed']);
function cancellableOf(rows) {
  return (rows || []).find((l) => l && l.stripe_subscription_id && CANCELLABLE.has(l.status)) || null;
}

const PRICE_IDS = {
  weekly:   process.env.STRIPE_PRICE_WEEKLY,
  monthly:  process.env.STRIPE_PRICE_MONTHLY,
  lifetime: process.env.STRIPE_PRICE_LIFETIME,
};

const PLAN_MODES = {
  weekly:   'subscription',
  monthly:  'subscription',
  lifetime: 'payment',
};

// POST /api/payments/create-checkout
// Body: { plan, userId, email, referral? }
// No JWT required, Supabase auth is handled client-side on the website.
router.post('/create-checkout', async (req, res) => {
  const { plan, userId, email, referral } = req.body;

  if (!plan || !userId || !email) {
    return res.status(400).json({ error: 'plan, userId, and email are required' });
  }
  if (!['weekly', 'monthly', 'lifetime'].includes(plan)) {
    return res.status(400).json({ error: 'Invalid plan. Must be weekly, monthly, or lifetime.' });
  }

  const priceId = PRICE_IDS[plan];
  if (!priceId) {
    return res.status(500).json({ error: `Price ID for plan "${plan}" is not configured on the server.` });
  }

  try {
    const session = await stripe.checkout.sessions.create({
      mode:                PLAN_MODES[plan],
      payment_method_types: ['card'],
      line_items:          [{ price: priceId, quantity: 1 }],
      success_url:         'https://occlara.app/success?session_id={CHECKOUT_SESSION_ID}',
      cancel_url:          'https://occlara.app/signup',
      client_reference_id: String(userId),
      customer_email:      email,
      allow_promotion_codes: true,
      metadata:            { plan, userId: String(userId), promotekit_referral: referral || '' },
    });

    res.json({ url: session.url, sessionId: session.id });
  } catch (err) {
    console.error('[payments] Create checkout error:', err.message);
    res.status(500).json({ error: 'Failed to create checkout session' });
  }
});

// POST /api/payments/cancel
// Header: Authorization: Bearer <Supabase access token>. Body: { userId?, email? },
// and a userId sent must be the token's own user. The website sends both.
router.post('/cancel', signedIn, async (req, res) => {
  try {
    const userId = req.user.id;

    /*
     * EVERY LICENCE THIS USER HOLDS, newest first, then the one to cancel.
     *
     * This used to be .eq('user_id').single(), and .single() errors on more
     * than one row. The webhook writes a row per purchase, so a monthly
     * subscriber who resubscribed or later bought lifetime was told "No license
     * found" and could not stop the subscription that was still charging them.
     */
    const { data: rows, error: licenseError } = await supabase
      .from('licenses')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });

    if (licenseError) {
      console.error('[payments] cancel lookup failed:', licenseError.message || licenseError.code);
      return res.status(503).json({ error: 'Could not read your licences right now. Try again in a minute.', retry: true });
    }
    const all = rows || [];
    if (!all.length) return res.status(404).json({ error: 'No license found' });

    const license = cancellableOf(all);
    if (!license) {
      // NOTHING THAT CAN CHARGE AGAIN: a lifetime licence never renews, and
      // neither does one granted without Stripe. Nothing is written, where a
      // row with no subscription used to be set to 'cancelled' on the spot,
      // ending access the player still had.
      //
      // Still a 400 with the sentence in `error`, the shape lifetime always
      // got. The website is a separate repo and cannot be seen from here, and
      // a page that branches on res.ok would read a 200 as "your subscription
      // was cancelled" when nothing was. The fields after `error` are for a
      // page that wants to say which case it is.
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

    const subscription = await stripe.subscriptions.update(license.stripe_subscription_id, {
      cancel_at_period_end: true,
    });

    /*
     * DO NOT WRITE status HERE, and this is the whole bug that was fixed.
     *
     * cancel_at_period_end means Stripe keeps the subscription running until the
     * period the customer already paid for runs out. This used to write
     * status:'cancelled' at the same moment, and licence.js rejects any row whose
     * status is not 'active' BEFORE it ever looks at expires_at. So a customer who
     * cancelled on day 2 of a paid month was locked out of the app within three
     * minutes, on a month they had paid for, while this same function was
     * returning accessUntil telling them the opposite.
     *
     * expires_at is the only thing that needs to move. It now holds the end of the
     * paid period, the guards let them through until then, and
     * customer.subscription.deleted flips status to 'cancelled' when Stripe
     * actually ends it. Access stops at the right moment either way, because
     * expires_at alone would end it even if that webhook never arrived.
     */
    await supabase
      .from('licenses')
      .update({ expires_at: new Date(subscription.current_period_end * 1000).toISOString() })
      .eq('id', license.id);

    console.log('[payments] Subscription cancelled for user:', userId);
    res.json({
      success:     true,
      cancelled:   true,
      message:     'Subscription cancelled',
      accessUntil: new Date(subscription.current_period_end * 1000).toISOString(),
    });
  } catch (e) {
    console.error('[payments] Cancel error:', e.message);
    res.status(500).json({ error: 'Failed to cancel subscription: ' + e.message });
  }
});

// GET /api/payments/success?session_id=xxx
// Called by success page after Stripe redirect.
// Retrieves session from Stripe, then polls Supabase for the generated license.
router.get('/success', async (req, res) => {
  const { session_id } = req.query;
  if (!session_id) return res.status(400).json({ error: 'session_id is required' });

  let userId;
  try {
    const session = await stripe.checkout.sessions.retrieve(session_id);
    userId = session.client_reference_id;
  } catch (err) {
    console.error('[payments] Error retrieving session:', err.message);
    return res.status(400).json({ error: 'Invalid session_id' });
  }

  if (!userId) return res.status(400).json({ error: 'No user associated with this session' });

  // Poll Supabase up to 30s for the webhook to generate the license
  const maxAttempts = 15;
  for (let i = 0; i < maxAttempts; i++) {
    const { data: license } = await supabase
      .from('licenses')
      .select('*')
      .eq('user_id', userId)
      .eq('status', 'active')
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    if (license) {
      return res.json({
        licenseKey: license.license_key,
        plan:       license.plan,
        status:     license.status,
        expiresAt:  license.expires_at,
      });
    }
    await new Promise(r => setTimeout(r, 2000));
  }

  /*
   * NO EMAIL IS EVER SENT, so this must not promise one.
   *
   * It used to say "Your license key will be emailed shortly". There is no mail
   * code anywhere in the server, so a buyer whose webhook took longer than this
   * 30 second poll waited for an email that never came, and reported a lifetime
   * purchase as missing when the licence was usually sitting in their account.
   * Point them at the place it actually appears.
   */
  res.status(202).json({
    message:    'Payment received. Your licence is still being set up, it will appear in your '
      + 'account dashboard within a few minutes. Sign in with the same account you paid with.',
    processing: true,
  });
});

module.exports = router;
