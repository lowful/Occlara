'use strict';

/**
 * A lifetime purchase must become a lifetime licence, whatever path it took.
 *
 * THE BUG. When a checkout arrived without metadata.plan, the plan came from
 * the price ID, and anything that did not match an env var exactly fell through
 * to `plan = 'monthly'; // safe fallback`. That covers every Payment Link,
 * every checkout the website builds itself, every price recreated in the Stripe
 * dashboard, and any failure to list line items. A lifetime buyer got a 30 day
 * licence and lost the product a month later, with nothing logged but a name.
 *
 * session.mode settles it: a one-time payment can only be lifetime. And a
 * subscription's plan is its price's own interval (week, month, year), so the
 * STRIPE_PRICE_* variables are not needed to tell weekly from yearly any more.
 *
 * Only the old Railway checkout's purchases (client_reference_id or
 * metadata.userId) are minted by the webhook; the site mints its own.
 *
 * The real webhook runs here against fake-billing.js.
 *
 * Run: npm run test:checkoutplan
 */

const path = require('path');
const { makeSupabase, makeStripe, loadWith, deliver, captureLogs, SERVER } = require('./fixtures/fake-billing');

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost:54321';
process.env.SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || 'test-key-not-used';
// The webhook no longer reads these; a price matching one must change nothing.
process.env.STRIPE_PRICE_WEEKLY = 'price_week';
process.env.STRIPE_PRICE_MONTHLY = 'price_month';
process.env.STRIPE_PRICE_LIFETIME = 'price_life';

let fails = 0;
const ok = (cond, what) => { if (!cond) { fails++; console.log(`FAIL  ${what}`); } else console.log(`ok    ${what}`); };

const sb = makeSupabase();
const st = makeStripe();
const handler = loadWith(path.join(SERVER, 'routes', 'webhook.js'), { supabase: sb, stripe: st.api });

async function buy({ mode, metaPlan, priceId, interval, lineItemsThrow, userId = 'user_1' }) {
  st.reset();
  sb.reset({ rows: [], schema: 'migrated' });
  if (lineItemsThrow) st.s.fail.add('checkout.sessions.listLineItems');
  const session = {
    id: 'cs_1', mode, customer: 'cus_1', subscription: mode === 'subscription' ? 'sub_1' : null,
    client_reference_id: userId, metadata: metaPlan ? { plan: metaPlan, userId } : {},
    customer_details: { email: 'buyer@example.com' }, payment_status: 'paid', priceId, interval,
  };
  st.s.sessions.set(session.id, session);
  let res;
  const logs = await captureLogs(async () => {
    res = await deliver(handler, st.event('checkout.session.completed', 'session', session));
  });
  return { lic: sb._db.rows[0] || null, logs, res };
}

(async () => {
  // ── The app's own checkout: metadata says lifetime ──────────────────────────
  {
    const { lic } = await buy({ mode: 'payment', metaPlan: 'lifetime', priceId: 'price_life' });
    ok(lic && lic.plan === 'lifetime', `the normal checkout gives lifetime (${lic && lic.plan})`);
    ok(lic && lic.expires_at === null, 'and it never expires');
  }

  // ── THE BUG: no metadata, and a price the env does not know ─────────────────
  // A Payment Link, a checkout the website built, or a price recreated in the
  // dashboard. This used to become a 30 day monthly licence.
  {
    const { lic } = await buy({ mode: 'payment', priceId: 'price_recreated_in_dashboard' });
    ok(lic && lic.plan === 'lifetime',
      `an unrecognised one-time price is LIFETIME, not monthly (${lic && lic.plan})`);
    ok(lic && lic.expires_at === null, 'and never expires');
  }

  // ── Stripe failing to list line items must not downgrade either ─────────────
  {
    const { lic } = await buy({ mode: 'payment', lineItemsThrow: true });
    ok(lic && lic.plan === 'lifetime',
      `a line item lookup failure on a one-time payment still gives lifetime (${lic && lic.plan})`);
  }

  // ── Subscriptions take the plan from the price's own interval ──────────────
  {
    const w = (await buy({ mode: 'subscription', priceId: 'price_any_weekly', interval: 'week' })).lic;
    ok(w && w.plan === 'weekly', `a weekly price is weekly, by its interval rather than an env var (${w && w.plan})`);
    const y = (await buy({ mode: 'subscription', priceId: 'price_any_yearly', interval: 'year' })).lic;
    ok(y && y.plan === 'yearly', `a yearly price is yearly (${y && y.plan})`);
    const e = (await buy({ mode: 'subscription', priceId: 'price_week' })).lic;
    ok(e && e.plan === 'monthly', `a price matching a STRIPE_PRICE_* variable but carrying no interval is not read from the variable (${e && e.plan})`);
    const m = (await buy({ mode: 'subscription', priceId: 'price_unknown_sub' })).lic;
    ok(m && m.plan === 'monthly',
      `an unrecognised subscription still falls back to monthly (${m && m.plan})`);
    ok(m && m.expires_at !== null, 'which does expire, since it renews');
  }

  // ── A purchase with no user creates nothing, and says so ────────────────────
  {
    const { lic, logs } = await buy({ mode: 'payment', metaPlan: 'lifetime', priceId: 'price_life', userId: null });
    ok(lic === null, 'a purchase with no user creates no licence');
    const line = logs.find((l) => l.includes('UNLINKED PURCHASE')) || '';
    ok(line.includes('cs_1') && line.includes('cus_1'), 'but logs the session and the customer, so support can find the buyer in Stripe');
    ok(!logs.join('\n').includes('buyer@example.com'), 'and never the email itself');
  }

  console.log(`\n${fails ? fails + ' failure(s)' : 'all checkout plan checks passed'}`);
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.log('FAIL  the test crashed:', e.stack || e.message); process.exit(1); });
