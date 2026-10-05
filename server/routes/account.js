'use strict';
const express  = require('express');
const stripe   = require('stripe')(process.env.STRIPE_SECRET_KEY);
const supabase = require('../db/supabase');
const { requireUser } = require('../services/account-auth');

const router = express.Router();

// Both routes act on the SIGNED IN user: the caller sends its Supabase access
// token as Authorization: Bearer, and a userId it names as well must be that
// same user. They used to take any userId at all, which handed anyone who knew
// an id that account's licence key and its Stripe billing portal.
const signedIn = requireUser(supabase);

// A failed read is not an account with no licence. See routes/license.js.
const UNAVAILABLE = { error: 'account-unavailable', retry: true };

// GET /api/account/dashboard[?userId=xxx]
// Header: Authorization: Bearer <Supabase access token>.
// Returns full license + deactivation info for the website dashboard.
router.get('/dashboard', signedIn, async (req, res) => {
  const userId = req.user.id;

  // Every licence, newest first. The newest is the one shown, as before, but
  // whether the billing portal can open is a question about ALL of them: see
  // can_manage_subscription below.
  const { data: rows, error } = await supabase
    .from('licenses')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });
  if (error) {
    console.error('[account] dashboard lookup failed:', error.message || error.code);
    return res.status(503).json(UNAVAILABLE);
  }
  const all = (rows || []).filter(Boolean);
  const license = all[0] || null;

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
    // True exactly when /portal can open, which is when ANY licence has a
    // Stripe customer. Read off the newest alone, a monthly subscriber who
    // later bought lifetime (a one time Checkout creates no customer) was told
    // there was nothing to manage while the monthly kept charging.
    stripe: { can_manage_subscription: all.some((r) => !!r.stripe_customer_id), portal_url: null },
  });
});

// POST /api/account/portal
// Header: Authorization: Bearer <Supabase access token>. Body: { userId? }.
// Creates a Stripe Customer Portal session for subscription management.
router.post('/portal', signedIn, async (req, res) => {
  const userId = req.user.id;

  /*
   * THE NEWEST LICENCE THAT HAS A STRIPE CUSTOMER, not simply the newest one.
   *
   * The webhook writes one row per purchase. A monthly subscriber who later
   * bought lifetime has the lifetime as their newest row, and a one time
   * Checkout with only an email creates no Stripe customer, so that row's
   * stripe_customer_id is null. Taking the newest row answered "No Stripe
   * subscription found" while the monthly kept charging, and left the site
   * with no way to stop it.
   *
   * A row that also carries a subscription comes first, because that is the
   * customer the subscription bills: if a one time purchase ever does get a
   * customer of its own, it is a different one, whose portal has nothing to
   * cancel.
   */
  const { data: rows, error } = await supabase
    .from('licenses')
    .select('stripe_customer_id,stripe_subscription_id,created_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });
  if (error) {
    console.error('[account] portal lookup failed:', error.message || error.code);
    return res.status(503).json(UNAVAILABLE);
  }
  const withCustomer = (rows || []).filter((r) => r && r.stripe_customer_id);
  const license = withCustomer.find((r) => r.stripe_subscription_id) || withCustomer[0];

  if (!license) {
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
