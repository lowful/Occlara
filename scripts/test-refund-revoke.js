'use strict';

/**
 * A refund must take the licence away, and a partial one must not.
 *
 * THE HOLE THIS CLOSES. The webhook handled four events and none was a refund.
 * A lifetime purchase writes `expires_at: null` and `status: 'active'`, has no
 * subscription to cancel, and validateKey asks only for an active status and an
 * unexpired date. So buy lifetime, refund it, keep the product forever. Nothing
 * fired, nothing logged, nothing expired. Subscriptions leaked less only
 * because they expire on their own.
 *
 * The real handler runs here against a fake Stripe and a fake Supabase, so the
 * switch, the amount comparison and the lookup order are all exercised rather
 * than described. Nothing touches the network or a real database.
 *
 * Run: npm run test:refundrevoke
 */

const path = require('path');
const Module = require('module');

let fails = 0;
const ok = (cond, what) => { if (!cond) { fails++; console.log(`FAIL  ${what}`); } else console.log(`ok    ${what}`); };

// ── A fake Supabase that records what the handler tried to do ───────────────
function makeDb(rows) {
  const state = { rows: rows.map((r) => ({ ...r })), updates: [] };
  const api = (table) => {
    const q = { _filters: {}, _patch: null, _mode: null };
    q.select = () => q;
    q.update = (patch) => { q._patch = patch; q._mode = 'update'; return q; };
    q.eq = (col, val) => {
      q._filters[col] = val;
      return q._mode === 'update' ? finish() : q;
    };
    q.single = () => ({ data: match()[0] || null, error: match().length ? null : { code: 'PGRST116' } });
    // A select with .eq() and no .single() resolves as a thenable, which is how
    // the handler reads a customer's licences. Resolves with a PLAIN object for
    // the reason recorded in finish() below.
    q.then = (res) => res({ data: match(), error: null });

    function match() {
      return state.rows.filter((r) => Object.entries(q._filters)
        .every(([c, v]) => r[c] === v));
    }
    function finish() {
      const hit = match();
      for (const r of hit) Object.assign(r, q._patch);
      state.updates.push({ table, patch: q._patch, filters: { ...q._filters }, hit: hit.length });
      /*
       * THE RESULT A `then` RESOLVES WITH MUST NOT ITSELF BE A THENABLE.
       *
       * The first version did `out.then = (res) => res(out)`, where `out` also
       * carried `.then`. Awaiting it made the promise machinery see a thenable,
       * call its `then`, get the same thenable back, and do it again: the test
       * hung forever having printed nothing, which reads exactly like a bug in
       * the code under test rather than in the harness.
       *
       * So the chainable object and the resolved VALUE are separate things.
       */
      const value = { data: hit, error: null };
      const out = { select: () => out, then: (res) => res(value) };
      return out;
    }
    return q;
  };
  return { from: api, _state: state };
}

// ── Load webhook.js with Stripe and Supabase replaced ───────────────────────
function loadHandler(db, sessionsForIntent) {
  const real = Module._load;
  Module._load = function patched(request, parent, isMain) {
    if (request === 'stripe') {
      return () => ({
        webhooks: { constructEvent: (body) => JSON.parse(body) },
        checkout: {
          sessions: {
            list: async ({ payment_intent: pi }) => ({
              data: sessionsForIntent[pi] ? [{ id: sessionsForIntent[pi] }] : [],
            }),
            listLineItems: async () => ({ data: [] }),
          },
        },
      });
    }
    if (request === '../db/supabase') return db;
    return real(request, parent, isMain);
  };
  try {
    delete require.cache[require.resolve(path.join(__dirname, '..', 'server', 'routes', 'webhook.js'))];
    return require(path.join(__dirname, '..', 'server', 'routes', 'webhook.js'));
  } finally {
    Module._load = real;
  }
}

function fakeRes() {
  const r = { code: 200, body: null };
  r.status = (c) => { r.code = c; return r; };
  r.json = (b) => { r.body = b; return r; };
  return r;
}

const LIFETIME = {
  id: 'lic_1', license_key: 'GC-AAAA-BBBB-CCCC-DDDD', plan: 'lifetime', status: 'active',
  expires_at: null, stripe_customer_id: 'cus_1', stripe_session_id: 'cs_1', stripe_subscription_id: null,
};

async function fire(db, event, sessions = { pi_1: 'cs_1' }) {
  const handler = loadHandler(db, sessions);
  const res = fakeRes();
  await handler({ headers: { 'stripe-signature': 'sig' }, body: JSON.stringify(event) }, res);
  return res;
}

const refund = (over = {}) => ({
  type: 'charge.refunded',
  data: { object: { id: 'ch_1', payment_intent: 'pi_1', customer: 'cus_1',
    amount: 9900, amount_refunded: 9900, refunded: true, ...over } },
});

(async () => {
  // ── THE BUG: a fully refunded lifetime licence must die ───────────────────
  {
    const db = makeDb([LIFETIME]);
    await fire(db, refund());
    const lic = db._state.rows[0];
    ok(lic.status === 'refunded', `a refunded lifetime licence is no longer active (${lic.status})`);
    ok(lic.expires_at && new Date(lic.expires_at) <= new Date(),
      'and its expiry is set to now, so it dies twice over');
  }

  // ── validateKey's own rule, applied to the result ─────────────────────────
  // The whole point is the licence stops validating. This mirrors the real
  // check in coach.js rather than trusting that a status change is enough.
  {
    const db = makeDb([LIFETIME]);
    await fire(db, refund());
    const lic = db._state.rows[0];
    const valid = lic.status === 'active'
      && !(lic.expires_at && new Date(lic.expires_at) < new Date());
    ok(!valid, 'and validateKey would now reject it');
  }

  // ── A PARTIAL refund must NOT revoke ──────────────────────────────────────
  // charge.refunded fires for both, and a goodwill partial refund is not a
  // reason to take the product away.
  {
    const db = makeDb([LIFETIME]);
    await fire(db, refund({ amount_refunded: 2000, refunded: false }));
    ok(db._state.rows[0].status === 'active', 'a partial refund leaves the licence alone');
    ok(db._state.updates.length === 0, 'and writes nothing at all');
  }
  {
    // Stripe says refunded true but the amounts disagree. The amounts win.
    const db = makeDb([LIFETIME]);
    await fire(db, refund({ amount_refunded: 5000, refunded: true }));
    ok(db._state.rows[0].status === 'active',
      'a flag saying fully refunded is not trusted over the amounts');
  }

  // ── A chargeback revokes on the same terms ────────────────────────────────
  {
    const db = makeDb([LIFETIME]);
    await fire(db, { type: 'charge.dispute.created',
      data: { object: { id: 'dp_1', payment_intent: 'pi_1', customer: 'cus_1' } } });
    ok(db._state.rows[0].status === 'disputed', 'a chargeback revokes too, with its own reason');
  }

  // ── The customer fallback, and its safety rail ────────────────────────────
  {
    // No session resolves, one active licence on the customer: safe to revoke.
    const db = makeDb([LIFETIME]);
    await fire(db, refund(), {});
    ok(db._state.rows[0].status === 'refunded',
      'with no session it falls back to the customer when that is unambiguous');
  }
  {
    // TWO active licences on one customer. Revoking both over one refund is a
    // worse bug than the one being fixed, so it refuses and says so.
    const db = makeDb([LIFETIME, { ...LIFETIME, id: 'lic_2', license_key: 'GC-EEEE-FFFF-GGGG-HHHH', stripe_session_id: 'cs_2' }]);
    await fire(db, refund(), {});
    const stillActive = db._state.rows.filter((r) => r.status === 'active').length;
    ok(stillActive === 2, 'but refuses when the customer has two active licences, rather than guessing');
  }
  {
    // A repeat customer whose OTHER licence was already refunded: the one live
    // licence is still unambiguous, so this must not be blocked by history.
    const db = makeDb([
      { ...LIFETIME, id: 'lic_old', status: 'refunded', stripe_session_id: 'cs_old' },
      LIFETIME,
    ]);
    await fire(db, refund(), {});
    ok(db._state.rows[1].status === 'refunded',
      'an already refunded past licence does not block the fallback');
  }

  // ── Unrelated licences are never touched ──────────────────────────────────
  {
    const other = { ...LIFETIME, id: 'lic_x', license_key: 'GC-XXXX-XXXX-XXXX-XXXX',
      stripe_customer_id: 'cus_other', stripe_session_id: 'cs_other' };
    const db = makeDb([LIFETIME, other]);
    await fire(db, refund());
    ok(db._state.rows[1].status === 'active', "another customer's licence is untouched");
  }

  // ── The handler still answers Stripe ──────────────────────────────────────
  // A non 200 makes Stripe retry the event forever.
  {
    const db = makeDb([LIFETIME]);
    const res = await fire(db, refund());
    ok(res.code === 200, `the webhook answers 200 so Stripe does not retry (${res.code})`);
  }

  console.log(`\n${fails ? fails + ' failure(s)' : 'all refund revoke checks passed'}`);
  process.exit(fails ? 1 : 0);
})();
