'use strict';
const express  = require('express');
const stripe   = require('stripe')(process.env.STRIPE_SECRET_KEY);
const supabase = require('../db/supabase');

const router = express.Router();

// GET /api/account/dashboard?userId=xxx
// Returns full license + deactivation info for the website dashboard.
router.get('/dashboard', async (req, res) => {
  const userId = req.query.userId;
  if (!userId) return res.status(400).json({ error: 'userId is required' });

  const { data: license } = await supabase
    .from('licenses')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(1)
    .single();

  /*
   * WHETHER IT RENEWS COMES FROM STRIPE, not from the licence row.
   *
   * A cancelled subscription keeps running to the end of the paid period, so its
   * row stays status:'active' with a future expires_at and looks identical to one
   * that will renew. The row cannot tell them apart and it should not try: Stripe
   * owns that fact, and a copy of it here would be one more thing to drift.
   *
   * Wrapped, and null on any failure. This is the difference between "cancelled"
   * and "renews on the 8th" in the dashboard's wording, which is worth having and
   * is never worth failing the whole page over.
   */
  let subscription = null;
  if (license && license.stripe_subscription_id) {
    try {
      const s = await stripe.subscriptions.retrieve(license.stripe_subscription_id);
      subscription = {
        stripe_status:        s.status,
        cancel_at_period_end: !!s.cancel_at_period_end,
        current_period_end:   s.current_period_end
          ? new Date(s.current_period_end * 1000).toISOString() : null,
      };
    } catch (e) {
      console.warn('[account] could not read subscription:', e.message);
    }
  }

  let licenseData = null;
  if (license) {
    const thisMonth = new Date().toISOString().slice(0, 7);
    const lastDeactMonth = license.last_deactivation_date ? license.last_deactivation_date.slice(0, 7) : null;
    const deactivationsThisMonth = lastDeactMonth === thisMonth ? (license.deactivation_count || 0) : 0;

    licenseData = {
      key:                      license.license_key,
      plan:                     license.plan,
      status:                   license.status,
      created_at:               license.created_at,
      expires_at:               license.expires_at,
      device_name:              license.device_name || null,
      device_activated:         !!license.device_name,
      deactivations_this_month: deactivationsThisMonth,
      deactivations_remaining:  Math.max(0, 3 - deactivationsThisMonth),
      // Derived, so the site does not have to know the rule. False means it has
      // been cancelled and expires_at is the last day of access. Null when there
      // is no subscription to ask about, which includes lifetime.
      renews: subscription ? !subscription.cancel_at_period_end : null,
    };
  }

  res.json({
    license: licenseData,
    subscription,
    stripe: { can_manage_subscription: !!(license?.stripe_customer_id), portal_url: null },
  });
});

// POST /api/account/portal
// Body: { userId }
// Creates a Stripe Customer Portal session for subscription management.
router.post('/portal', async (req, res) => {
  const { userId } = req.body;
  if (!userId) return res.status(400).json({ error: 'userId is required' });

  const { data: license } = await supabase
    .from('licenses')
    .select('stripe_customer_id')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(1)
    .single();

  if (!license?.stripe_customer_id) {
    return res.status(400).json({ error: 'No Stripe subscription found for this account' });
  }

  try {
    const session = await stripe.billingPortal.sessions.create({
      customer:   license.stripe_customer_id,
      return_url: 'https://occlara.app/account',
    });
    res.json({ url: session.url });
  } catch (err) {
    console.error('[account] Portal error:', err.message);
    res.status(500).json({ error: 'Failed to create billing portal session' });
  }
});

module.exports = router;
