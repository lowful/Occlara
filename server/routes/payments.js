'use strict';
const express  = require('express');
const stripe   = require('stripe')(process.env.STRIPE_SECRET_KEY);
const supabase = require('../db/supabase');

const router = express.Router();

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
// Body: { userId }
router.post('/cancel', async (req, res) => {
  try {
    const { userId } = req.body;
    if (!userId) return res.status(400).json({ error: 'Missing userId' });

    const { data: license, error: licenseError } = await supabase
      .from('licenses')
      .select('*')
      .eq('user_id', userId)
      .single();

    if (licenseError || !license) {
      return res.status(404).json({ error: 'No license found' });
    }

    if (license.plan === 'lifetime') {
      return res.status(400).json({ error: 'Lifetime plans cannot be cancelled' });
    }

    if (!license.stripe_subscription_id) {
      await supabase
        .from('licenses')
        .update({ status: 'cancelled' })
        .eq('id', license.id);
      return res.json({ success: true, message: 'Subscription cancelled' });
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

  res.status(202).json({
    message:    'Payment is processing. Your license key will be emailed shortly.',
    processing: true,
  });
});

module.exports = router;
