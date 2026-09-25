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
 * session.mode settles it: a one-time payment can only be lifetime, because
 * payments.js maps weekly and monthly to subscriptions.
 *
 * The real webhook runs here against a fake Stripe and a fake Supabase.
 *
 * Run: npm run test:checkoutplan
 */

const path = require('path');
const Module = require('module');

let fails = 0;
const ok = (cond, what) => { if (!cond) { fails++; console.log(`FAIL  ${what}`); } else console.log(`ok    ${what}`); };

function makeDb() {
  const inserted = [];
  return {
    inserted,
    from: () => {
      const q = {};
      q.select = () => q;
      q.eq = () => q;
      // No existing licence, so the idempotency check always passes.
      q.single = () => ({ data: null, error: { code: 'PGRST116' } });
      q.insert = (row) => {
        inserted.push(row);
        const value = { data: [row], error: null };
        return { select: () => ({ then: (res) => res(value) }) };
      };
      return q;
    },
  };
}

function load(db, priceId, lineItemsThrow) {
  const real = Module._load;
  Module._load = function patched(request, parent, isMain) {
    if (request === 'stripe') {
      return () => ({
        webhooks: { constructEvent: (body) => JSON.parse(body) },
        checkout: {
          sessions: {
            list: async () => ({ data: [] }),
            listLineItems: async () => {
              if (lineItemsThrow) throw new Error('stripe is down');
              return { data: [{ price: { id: priceId } }] };
            },
          },
        },
      });
    }
    if (request === '../db/supabase') return db;
    return real(request, parent, isMain);
  };
  try {
    const p = path.join(__dirname, '..', 'server', 'routes', 'webhook.js');
    delete require.cache[require.resolve(p)];
    return require(p);
  } finally {
    Module._load = real;
  }
}

async function buy({ mode, metaPlan, priceId, lineItemsThrow, userId = 'user_1' }) {
  process.env.STRIPE_PRICE_WEEKLY = 'price_week';
  process.env.STRIPE_PRICE_MONTHLY = 'price_month';
  process.env.STRIPE_PRICE_LIFETIME = 'price_life';
  const db = makeDb();
  const handler = load(db, priceId, lineItemsThrow);
  const session = {
    id: 'cs_1', mode, customer: 'cus_1', subscription: mode === 'subscription' ? 'sub_1' : null,
    client_reference_id: userId, metadata: metaPlan ? { plan: metaPlan, userId } : {},
    customer_details: { email: 'buyer@example.com' }, payment_status: 'paid',
  };
  const res = { status: () => res, json: () => res };
  await handler({ headers: { 'stripe-signature': 's' },
    body: JSON.stringify({ type: 'checkout.session.completed', data: { object: session } }) }, res);
  return db.inserted[0] || null;
}

(async () => {
  // ── The app's own checkout: metadata says lifetime ──────────────────────────
  {
    const lic = await buy({ mode: 'payment', metaPlan: 'lifetime', priceId: 'price_life' });
    ok(lic && lic.plan === 'lifetime', `the normal checkout gives lifetime (${lic && lic.plan})`);
    ok(lic && lic.expires_at === null, 'and it never expires');
  }

  // ── THE BUG: no metadata, and a price the env does not know ─────────────────
  // A Payment Link, a checkout the website built, or a price recreated in the
  // dashboard. This used to become a 30 day monthly licence.
  {
    const lic = await buy({ mode: 'payment', priceId: 'price_recreated_in_dashboard' });
    ok(lic && lic.plan === 'lifetime',
      `an unrecognised one-time price is LIFETIME, not monthly (${lic && lic.plan})`);
    ok(lic && lic.expires_at === null, 'and never expires');
  }

  // ── Stripe failing to list line items must not downgrade either ─────────────
  {
    const lic = await buy({ mode: 'payment', lineItemsThrow: true });
    ok(lic && lic.plan === 'lifetime',
      `a line item lookup failure on a one-time payment still gives lifetime (${lic && lic.plan})`);
  }

  // ── Subscriptions keep their existing behaviour ─────────────────────────────
  {
    const w = await buy({ mode: 'subscription', priceId: 'price_week' });
    ok(w && w.plan === 'weekly', `a recognised weekly price is weekly (${w && w.plan})`);
    const m = await buy({ mode: 'subscription', priceId: 'price_unknown_sub' });
    ok(m && m.plan === 'monthly',
      `an unrecognised subscription still falls back to monthly (${m && m.plan})`);
    ok(m && m.expires_at !== null, 'which does expire, since it renews');
  }

  // ── A purchase with no user creates nothing, and says so ────────────────────
  {
    const logs = [];
    const orig = console.error;
    console.error = (...a) => { logs.push(a.join(' ')); };
    const lic = await buy({ mode: 'payment', metaPlan: 'lifetime', priceId: 'price_life', userId: null });
    console.error = orig;
    ok(lic === null, 'a purchase with no user creates no licence');
    const line = logs.find((l) => l.includes('UNLINKED PURCHASE')) || '';
    ok(line.includes('buyer@example.com'), 'but logs WHO paid, so support can fix it');
    ok(line.includes('cs_1'), 'and the session to link by hand');
  }

  console.log(`\n${fails ? fails + ' failure(s)' : 'all checkout plan checks passed'}`);
  process.exit(fails ? 1 : 0);
})();
