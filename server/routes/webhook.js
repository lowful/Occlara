'use strict';
const stripe   = require('stripe')(process.env.STRIPE_SECRET_KEY);
const supabase = require('../db/supabase');

function generateLicenseKey() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  const seg = () => Array.from({ length: 4 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
  return `GC-${seg()}-${seg()}-${seg()}-${seg()}`;
}

function getExpiresAt(plan) {
  if (plan === 'lifetime') return null;
  const d = new Date();
  if (plan === 'weekly')  d.setDate(d.getDate() + 7);
  if (plan === 'monthly') d.setDate(d.getDate() + 30);
  return d.toISOString();
}

function extendExpiresAt(currentExpires, plan) {
  const base = currentExpires ? new Date(currentExpires) : new Date();
  const from = base < new Date() ? new Date() : base;
  if (plan === 'weekly')  from.setDate(from.getDate() + 7);
  if (plan === 'monthly') from.setDate(from.getDate() + 30);
  return from.toISOString();
}


/*
 * ── REVOKING A LICENCE AFTER A REFUND OR A CHARGEBACK ───────────────────────
 *
 * This webhook handled four events and none of them was a refund, which left a
 * hole with no floor under it: a LIFETIME purchase writes expires_at null and
 * status active, has no subscription to cancel, and validateKey only asks for
 * status active and an unexpired date. So buy lifetime, refund it, and the
 * licence stays valid forever. Nothing fired, nothing logged, nothing expired.
 *
 * Subscriptions leaked less because they expire on their own, but a refunded
 * month still bought a month of free coaching.
 *
 * FINDING THE LICENCE. Licences store stripe_session_id and stripe_customer_id,
 * never the payment intent, so the charge is resolved through the checkout
 * session that created it. The customer is a FALLBACK and only when it matches
 * exactly one licence: a customer who bought twice, or upgraded, has several,
 * and revoking all of them over one refund is a worse bug than the one this
 * fixes.
 *
 * BOTH FIELDS ARE WRITTEN. status carries the reason, which support needs, and
 * expires_at is set to now so the licence dies even if validateKey is ever
 * relaxed about status. Two independent reasons for the same answer.
 */
async function revokeLicence({ paymentIntent, customer, reason, label }) {
  const patch = { status: reason, expires_at: new Date().toISOString() };

  // 1. The exact route: charge -> payment intent -> checkout session -> licence.
  let sessionId = null;
  if (paymentIntent) {
    try {
      const list = await stripe.checkout.sessions.list({ payment_intent: paymentIntent, limit: 1 });
      sessionId = list && list.data && list.data[0] ? list.data[0].id : null;
    } catch (e) {
      console.error(`[webhook] ${label}: could not resolve a session from payment intent ${paymentIntent}:`, e.message);
    }
  }

  if (sessionId) {
    const { data, error } = await supabase
      .from('licenses')
      .update(patch)
      .eq('stripe_session_id', sessionId)
      .select();
    if (error) {
      console.error(`[webhook] ${label}: revoke by session failed:`, JSON.stringify(error));
    } else if (data && data.length) {
      console.log(`[webhook] ${label}: revoked ${data.length} licence(s) for session ${sessionId}`);
      return true;
    } else {
      console.warn(`[webhook] ${label}: no licence carried session ${sessionId}, trying the customer`);
    }
  }

  // 2. The fallback, and only when it is unambiguous.
  if (!customer) {
    console.error(`[webhook] ${label}: nothing to match on, licence NOT revoked. `
      + `payment_intent=${paymentIntent} customer=${customer}`);
    return false;
  }

  const { data: owned, error: lookupError } = await supabase
    .from('licenses')
    .select('id,license_key,plan,status')
    .eq('stripe_customer_id', customer);

  if (lookupError) {
    console.error(`[webhook] ${label}: customer lookup failed:`, JSON.stringify(lookupError));
    return false;
  }
  const live = (owned || []).filter((l) => l.status === 'active');
  if (live.length !== 1) {
    // Deliberately loud and deliberately inert. Revoking the wrong licence of a
    // repeat customer is worse than a refund that needs a human, so this asks
    // for one rather than guessing.
    console.error(`[webhook] ${label}: customer ${customer} has ${live.length} active licence(s), `
      + 'so this needs a human. NOT revoked.');
    return false;
  }

  const { error: updErr } = await supabase.from('licenses').update(patch).eq('id', live[0].id);
  if (updErr) {
    console.error(`[webhook] ${label}: revoke by customer failed:`, JSON.stringify(updErr));
    return false;
  }
  console.log(`[webhook] ${label}: revoked ${live[0].license_key} (${live[0].plan}) via customer ${customer}`);
  return true;
}

// POST /api/payments/webhook
async function webhookHandler(req, res) {
  console.log('[webhook] Received webhook event');

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

  console.log(`[webhook] Processing event: ${event.type}`);

  try {
    switch (event.type) {

      case 'checkout.session.completed': {
        const session = event.data.object;

        // Full session dump so we can see exactly what arrived
        console.log('[webhook] checkout.session.completed fired');
        console.log('[webhook] Session ID:', session.id);
        console.log('[webhook] Mode:', session.mode);
        console.log('[webhook] client_reference_id:', session.client_reference_id);
        console.log('[webhook] customer:', session.customer);
        console.log('[webhook] subscription:', session.subscription);
        console.log('[webhook] customer_email:', session.customer_details?.email);
        console.log('[webhook] metadata:', JSON.stringify(session.metadata));
        console.log('[webhook] payment_status:', session.payment_status);

        const userId = session.client_reference_id || session.metadata?.userId || null;
        let plan = session.metadata?.plan || null;

        console.log('[webhook] Resolved userId:', userId);
        console.log('[webhook] Resolved plan from metadata:', plan);

        // Fallback: determine plan from price ID if metadata.plan is missing
        if (!plan) {
          console.log('[webhook] Plan missing from metadata, looking up from line items...');
          try {
            const lineItems = await stripe.checkout.sessions.listLineItems(session.id);
            const priceId = lineItems.data[0]?.price?.id;
            console.log('[webhook] Price ID from line items:', priceId);
            if (priceId === process.env.STRIPE_PRICE_WEEKLY)   plan = 'weekly';
            else if (priceId === process.env.STRIPE_PRICE_MONTHLY)  plan = 'monthly';
            else if (priceId === process.env.STRIPE_PRICE_LIFETIME) plan = 'lifetime';
            else plan = 'monthly'; // safe fallback
            console.log('[webhook] Determined plan from price ID:', plan);
          } catch (e) {
            console.error('[webhook] Failed to look up line items:', e.message);
            plan = 'monthly';
          }
        }

        if (!userId) {
          console.error('[webhook] CRITICAL: userId is null, cannot create license. Session:', session.id);
          console.error('[webhook] client_reference_id was:', session.client_reference_id);
          console.error('[webhook] metadata was:', JSON.stringify(session.metadata));
          break;
        }

        // Idempotency, skip if license already exists for this session
        console.log('[webhook] Checking for existing license for session:', session.id);
        const { data: existing, error: lookupError } = await supabase
          .from('licenses')
          .select('id')
          .eq('stripe_session_id', session.id)
          .single();

        if (lookupError && lookupError.code !== 'PGRST116') {
          console.error('[webhook] Idempotency check error:', JSON.stringify(lookupError));
        }

        if (existing) {
          console.log(`[webhook] License already exists for session ${session.id}, skipping`);
          break;
        }

        const licenseKey = generateLicenseKey();
        const expiresAt  = getExpiresAt(plan);

        console.log('[webhook] Inserting license into Supabase...');
        console.log('[webhook] License key:', licenseKey);
        console.log('[webhook] User ID:', userId);
        console.log('[webhook] Plan:', plan);
        console.log('[webhook] Expires at:', expiresAt);

        const { data: insertData, error: insertError } = await supabase.from('licenses').insert({
          user_id:                userId,
          license_key:            licenseKey,
          plan,
          status:                 'active',
          expires_at:             expiresAt,
          stripe_customer_id:     session.customer || null,
          stripe_subscription_id: session.subscription || null,
          stripe_session_id:      session.id,
        }).select();

        if (insertError) {
          console.error('[webhook] SUPABASE INSERT FAILED:', JSON.stringify(insertError));
          console.error('[webhook] Insert error code:', insertError.code);
          console.error('[webhook] Insert error message:', insertError.message);
          console.error('[webhook] Insert error details:', insertError.details);
          break;
        }

        console.log(`[webhook] SUCCESS: License ${licenseKey} created for user ${userId} (${plan})`);
        console.log('[webhook] Insert result:', JSON.stringify(insertData));
        break;
      }

      case 'invoice.paid': {
        const invoice        = event.data.object;
        const subscriptionId = invoice.subscription;
        if (!subscriptionId) break;

        const { data: license } = await supabase
          .from('licenses')
          .select('expires_at, plan')
          .eq('stripe_subscription_id', subscriptionId)
          .single();

        if (!license) {
          console.warn(`[webhook] No license found for subscription ${subscriptionId}`);
          break;
        }

        const newExpiry = extendExpiresAt(license.expires_at, license.plan);
        await supabase
          .from('licenses')
          .update({ expires_at: newExpiry, status: 'active' })
          .eq('stripe_subscription_id', subscriptionId);

        console.log(`[webhook] Subscription ${subscriptionId} renewed. New expiry: ${newExpiry}`);
        break;
      }

      case 'invoice.payment_failed': {
        const subscriptionId = event.data.object.subscription;
        if (!subscriptionId) break;
        await supabase
          .from('licenses')
          .update({ status: 'payment_failed' })
          .eq('stripe_subscription_id', subscriptionId);
        console.log(`[webhook] Payment failed for subscription ${subscriptionId}`);
        break;
      }

      case 'customer.subscription.deleted': {
        const subscriptionId = event.data.object.id;
        await supabase
          .from('licenses')
          .update({ status: 'cancelled' })
          .eq('stripe_subscription_id', subscriptionId);
        console.log(`[webhook] Subscription ${subscriptionId} cancelled`);
        break;
      }

      /*
       * A FULL refund revokes. A PARTIAL one must not: charge.refunded fires
       * for both, and a goodwill partial refund on a lifetime purchase is not a
       * reason to take the product away. Stripe sets `refunded` true only when
       * the charge is fully refunded, and the amounts are compared as well
       * because that flag is the one thing here worth double checking.
       */
      case 'charge.refunded': {
        const charge = event.data.object;
        const full = charge.refunded === true && charge.amount_refunded >= charge.amount;
        if (!full) {
          console.log(`[webhook] partial refund on charge ${charge.id} `
            + `(${charge.amount_refunded} of ${charge.amount}), licence left alone`);
          break;
        }
        await revokeLicence({
          paymentIntent: charge.payment_intent,
          customer: charge.customer,
          reason: 'refunded',
          label: 'refund',
        });
        break;
      }

      /*
       * A chargeback is a refund the customer took without asking, so it
       * revokes on the same terms. Waiting for the dispute to resolve would
       * mean serving a product to someone who has already taken the money back.
       */
      case 'charge.dispute.created': {
        const dispute = event.data.object;
        await revokeLicence({
          paymentIntent: dispute.payment_intent,
          customer: dispute.customer || null,
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
    console.error('[webhook] Handler error:', err.message, err.stack);
    res.status(500).json({ error: 'Webhook handler failed' });
  }
}

module.exports = webhookHandler;
