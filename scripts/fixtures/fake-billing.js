'use strict';

/**
 * A FAKE STRIPE AND A FAKE SUPABASE THAT REFUSE WHAT THE REAL ONES REFUSE.
 *
 * test:refundrevoke passed for months while every refund on the site left the
 * key working, because its fakes agreed to everything: the fake Stripe found a
 * checkout session for any payment intent (a subscription's has none), and the
 * fake database had no CHECK and no trigger, so a write the real table refuses
 * was recorded as done. These fakes are built from what the real ones do:
 *
 *   THE LICENCES TABLE as the site's migrations define it: exactly the columns
 *   src/integrations/supabase/types.ts lists, a status CHECK and a plan CHECK
 *   (today's, or the ones the site's migration adds: 'refunded', 'disputed',
 *   'yearly'), NOT NULL and UNIQUE where the table has them, given the
 *   project's users the user_id uuid and its foreign key, and optionally the
 *   prevent_license_privilege_escalation trigger as it behaves live, refusing
 *   the service role's every write to a protected field (B1). A write the real
 *   table refuses comes back as PostgREST's own error (23514, 23502, 23505,
 *   P0001, PGRST204 for a column the table does not have) and changes nothing.
 *   An update returns no rows unless .select() asks, as supabase-js does.
 *
 *   STRIPE as stripe-node 14 sees it: the server's own API calls are answered
 *   in the version it pins (2023-10-16, where an Invoice has `subscription` and
 *   a Charge has `invoice`), while an event is built in the webhook endpoint's
 *   version, either 2023-10-16 or 2025-03-31.basil, where an Invoice's
 *   subscription moved to parent.subscription_details.subscription, a Charge
 *   lost `invoice` and a Subscription's period moved onto its items. A
 *   subscription that ended cannot be updated or cancelled again, an id that
 *   does not exist is resource_missing, and any method can be made to fail.
 *
 * Nothing here touches a network.
 */

const LIVE_COLUMNS = ['id', 'user_id', 'license_key', 'plan', 'status', 'device_id', 'device_name',
  'stripe_customer_id', 'stripe_subscription_id', 'stripe_session_id', 'created_at', 'expires_at'];

// supabase/migrations/20260315204558_...sql, and what the site's migration adds.
const CHECKS = {
  today: {
    status: ['active', 'expired', 'cancelled', 'payment_failed'],
    plan: ['weekly', 'monthly', 'lifetime'],
  },
  migrated: {
    status: ['active', 'expired', 'cancelled', 'payment_failed', 'refunded', 'disputed'],
    plan: ['weekly', 'monthly', 'yearly', 'lifetime'],
  },
};

// The fields prevent_license_privilege_escalation() refuses to let change.
const PROTECTED = ['status', 'plan', 'expires_at', 'stripe_customer_id', 'stripe_subscription_id', 'license_key', 'user_id'];

const clone = (o) => JSON.parse(JSON.stringify(o));
let seq = 0;
const uuid = () => {
  seq++;
  const h = String(seq).padStart(12, '0');
  return `00000000-0000-4000-8000-${h}`;
};

const pgError = (code, message, details = null) => ({ code, message, details, hint: null });
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The licences table behind a supabase-js shaped client.
 * opts: { rows, schema: 'today' | 'migrated', trigger: 'broken' | 'fixed', columns, users }
 */
function makeSupabase(opts = {}) {
  const db = {
    rows: [], schema: 'today', trigger: 'fixed', columns: new Set(LIVE_COLUMNS),
    outage: false, writes: [], reads: 0, users: {},
  };

  function reset(next = {}) {
    db.rows = (next.rows || []).map((r) => {
      const row = Object.fromEntries([...db.columns].map((c) => [c, null]));
      Object.assign(row, clone(r));
      if (!row.id) row.id = uuid();
      if (!row.created_at) row.created_at = new Date().toISOString();
      if (!row.status) row.status = 'active';
      return row;
    });
    db.schema = next.schema || 'today';
    db.trigger = next.trigger || 'fixed';
    db.columns = new Set(next.columns || LIVE_COLUMNS);
    db.outage = !!next.outage;
    // Reads answer, writes fail: the connection dropping between the two.
    db.failWrites = !!next.failWrites;
    db.writes = [];
    db.reads = 0;
    db.users = next.users || {};
    // licences.user_id is a uuid that references auth.users. Given the ids of
    // the users the project has, an insert is held to both, as the real table
    // holds it (22P02, 23503); without them the fake takes any user_id.
    db.authUsers = next.authUsers ? new Set(next.authUsers) : null;
  }
  reset(opts);

  const OUTAGE = { data: null, error: pgError('', 'TypeError: fetch failed', '') };

  function unknownFilter(filters) {
    for (const f of filters) if (!db.columns.has(f[1])) return f[1];
    return null;
  }
  function matches(row, filters) {
    return filters.every((f) => {
      const [op, col] = f;
      const v = row[col];
      if (op === 'eq') return v === f[2];
      if (op === 'neq') return v !== f[2];
      if (op === 'in') return f[2].includes(v);
      if (op === 'is') return v === f[2];
      if (op === 'not') {
        // The forms the server could use: not(col, 'is', null), not(col, 'in', '(a,b)').
        if (f[2] === 'is') return v !== f[3];
        if (f[2] !== 'in') throw new Error(`the fake supports not(col, 'is' | 'in', ...) only, got ${f[2]}`);
        const list = String(f[3]).replace(/^\(|\)$/g, '').split(',').map((s) => s.trim().replace(/^"|"$/g, ''));
        return !list.includes(v);
      }
      throw new Error(`the fake does not support the filter ${op}`);
    });
  }
  function project(row, cols) {
    if (!cols || cols === '*') return clone(row);
    const out = {};
    for (const c of cols.split(',').map((s) => s.trim()).filter(Boolean)) out[c] = row[c] === undefined ? null : clone(row[c]);
    return out;
  }
  function unknownColumn(cols) {
    if (!cols || cols === '*') return null;
    for (const c of cols.split(',').map((s) => s.trim()).filter(Boolean)) if (!db.columns.has(c)) return c;
    return null;
  }
  function checkRow(row) {
    const allowed = CHECKS[db.schema];
    if (!allowed.status.includes(row.status)) {
      return pgError('23514', 'new row for relation "licenses" violates check constraint "licenses_status_check"',
        `Failing row contains (${LIVE_COLUMNS.map((c) => row[c]).join(', ')}).`);
    }
    if (!allowed.plan.includes(row.plan)) {
      return pgError('23514', 'new row for relation "licenses" violates check constraint "licenses_plan_check"',
        `Failing row contains (${LIVE_COLUMNS.map((c) => row[c]).join(', ')}).`);
    }
    return null;
  }
  function single(q, rows) {
    if (q.single) {
      if (rows.length === 1) return { data: rows[0], error: null };
      return { data: null, error: pgError('PGRST116', 'JSON object requested, multiple (or no) rows returned',
        `The result contains ${rows.length} rows`) };
    }
    if (q.maybe) {
      if (rows.length <= 1) return { data: rows[0] || null, error: null };
      return { data: null, error: pgError('PGRST116', 'JSON object requested, multiple (or no) rows returned',
        `The result contains ${rows.length} rows`) };
    }
    return { data: rows, error: null };
  }

  function run(q) {
    if (db.outage) return OUTAGE;
    const badFilter = unknownFilter(q.filters);
    if (badFilter) return { data: null, error: pgError('42703', `column licenses.${badFilter} does not exist`) };

    if (q.op === 'select') {
      db.reads++;
      const badCol = unknownColumn(q.cols);
      if (badCol) return { data: null, error: pgError('42703', `column licenses.${badCol} does not exist`) };
      let rows = db.rows.filter((r) => matches(r, q.filters));
      if (q.order) {
        const { c, asc } = q.order;
        rows = rows.slice().sort((a, b) => (a[c] < b[c] ? -1 : a[c] > b[c] ? 1 : 0) * (asc ? 1 : -1));
      }
      if (q.range) rows = rows.slice(q.range[0], q.range[1] + 1);
      if (q.limit != null) rows = rows.slice(0, q.limit);
      return single(q, rows.map((r) => project(r, q.cols)));
    }

    if ((q.op === 'update' || q.op === 'insert') && db.failWrites) {
      const error = pgError('08006', 'connection failure during write');
      db.writes.push({ op: q.op, patch: clone(q.patch || q.rows), error });
      return { data: null, error };
    }

    if (q.op === 'update') {
      const record = (error, ids) => db.writes.push({ op: 'update', patch: clone(q.patch), filters: clone(q.filters), ids, error });
      for (const c of Object.keys(q.patch)) {
        if (!db.columns.has(c)) {
          const error = pgError('PGRST204', `Could not find the '${c}' column of 'licenses' in the schema cache`);
          record(error, []);
          return { data: null, error };
        }
      }
      const hit = db.rows.filter((r) => matches(r, q.filters));
      const next = hit.map((r) => ({ ...r, ...clone(q.patch) }));
      // A BEFORE UPDATE trigger runs before the row's CHECK constraints are tested.
      if (db.trigger === 'broken') {
        const touches = hit.some((r, i) => PROTECTED.some((c) => JSON.stringify(r[c]) !== JSON.stringify(next[i][c])));
        if (touches) {
          const error = pgError('P0001', 'Modification of protected license fields is not allowed');
          record(error, []);
          return { data: null, error };
        }
      }
      for (const n of next) {
        const err = checkRow(n);
        if (err) { record(err, []); return { data: null, error: err }; }
      }
      hit.forEach((r, i) => Object.assign(r, next[i]));
      record(null, hit.map((r) => r.id));
      if (!q.returning) return { data: null, error: null };
      return single(q, hit.map((r) => project(r, q.cols)));
    }

    if (q.op === 'insert') {
      const made = [];
      for (const input of q.rows) {
        for (const c of Object.keys(input)) {
          if (!db.columns.has(c)) {
            const error = pgError('PGRST204', `Could not find the '${c}' column of 'licenses' in the schema cache`);
            db.writes.push({ op: 'insert', row: clone(input), error });
            return { data: null, error };
          }
        }
        const row = Object.fromEntries([...db.columns].map((c) => [c, null]));
        Object.assign(row, { id: uuid(), created_at: new Date().toISOString(), status: 'active' }, clone(input));
        for (const c of ['user_id', 'license_key', 'plan', 'status']) {
          if (row[c] == null) {
            const error = pgError('23502', `null value in column "${c}" of relation "licenses" violates not-null constraint`);
            db.writes.push({ op: 'insert', row: clone(input), error });
            return { data: null, error };
          }
        }
        const err = checkRow(row);
        if (err) { db.writes.push({ op: 'insert', row: clone(input), error: err }); return { data: null, error: err }; }
        if (db.authUsers) {
          const fk = !UUID_RE.test(String(row.user_id))
            ? pgError('22P02', `invalid input syntax for type uuid: "${row.user_id}"`)
            : !db.authUsers.has(row.user_id)
              ? pgError('23503', 'insert or update on table "licenses" violates foreign key constraint "licenses_user_id_fkey"',
                `Key (user_id)=(${row.user_id}) is not present in table "users".`)
              : null;
          if (fk) { db.writes.push({ op: 'insert', row: clone(input), error: fk }); return { data: null, error: fk }; }
        }
        const dupKey = db.rows.concat(made).some((r) => r.license_key === row.license_key);
        const dupSession = row.stripe_session_id
          && db.rows.concat(made).some((r) => r.stripe_session_id === row.stripe_session_id);
        if (dupKey || dupSession) {
          const error = pgError('23505', `duplicate key value violates unique constraint "${dupKey ? 'licenses_license_key_key' : 'licenses_stripe_session_id_key'}"`);
          db.writes.push({ op: 'insert', row: clone(input), error });
          return { data: null, error };
        }
        made.push(row);
      }
      db.rows.push(...made);
      for (const m of made) db.writes.push({ op: 'insert', row: clone(m), error: null });
      if (!q.returning) return { data: null, error: null };
      return single(q, made.map((r) => project(r, q.cols)));
    }
    throw new Error(`the fake does not support ${q.op}`);
  }

  function from(table) {
    if (table !== 'licenses') throw new Error(`the fake knows the licenses table only, not ${table}`);
    const q = { op: 'select', cols: '*', patch: null, rows: null, filters: [], order: null, range: null,
      limit: null, single: false, maybe: false, returning: false };
    const b = {
      select(cols) {
        if (q.op === 'select') q.cols = cols || '*';
        else { q.returning = true; q.cols = cols || '*'; }
        return b;
      },
      update(patch) { q.op = 'update'; q.patch = patch || {}; return b; },
      insert(rows) { q.op = 'insert'; q.rows = Array.isArray(rows) ? rows : [rows]; return b; },
      eq(c, v) { q.filters.push(['eq', c, v]); return b; },
      neq(c, v) { q.filters.push(['neq', c, v]); return b; },
      in(c, vs) { q.filters.push(['in', c, Array.from(vs)]); return b; },
      is(c, v) { q.filters.push(['is', c, v]); return b; },
      not(c, op, v) { q.filters.push(['not', c, op, v]); return b; },
      order(c, o) { q.order = { c, asc: !(o && o.ascending === false) }; return b; },
      limit(n) { q.limit = n; return b; },
      range(a, z) { q.range = [a, z]; return b; },
      single() { q.single = true; return b; },
      maybeSingle() { q.maybe = true; return b; },
      abortSignal() { return b; },
      then(res, rej) { return Promise.resolve().then(() => run(q)).then(res, rej); },
    };
    return b;
  }

  const auth = {
    getUser: async (token) => {
      const user = db.users[token];
      return user ? { data: { user }, error: null }
        : { data: { user: null }, error: Object.assign(new Error('invalid JWT'), { status: 403 }) };
    },
    admin: { getUserById: async () => ({ data: { user: null }, error: null }) },
  };

  return { from, auth, _db: db, reset };
}

// ── Stripe ─────────────────────────────────────────────────────────────────

const SERVER_VERSION = '2023-10-16';      // what stripe-node 14 pins for the server's own calls
const VERSIONS = ['2023-10-16', '2025-03-31.basil'];

function stripeError(type, code, statusCode, message) {
  return Object.assign(new Error(message), { type, code, statusCode, raw: { code, message } });
}

/**
 * The canonical objects live in maps; render() draws one in an API version.
 *
 * sub:     { id, customer, status, cancel_at_period_end, current_period_start, current_period_end,
 *            canceled_at, ended_at, interval }
 * invoice: { id, customer, subscription, status, billing_reason, charge, payment_intent,
 *            lines: [{ id, subscription, start, end, proration }] }
 * charge:  { id, customer, invoice, payment_intent, amount, amount_refunded, refunded, disputed }
 * session: { id, mode, customer, subscription, payment_intent, invoice, metadata,
 *            client_reference_id, customer_details, payment_status, interval, priceId }
 */
function render(kind, o, version) {
  const basil = version !== '2023-10-16';
  if (kind === 'subscription') {
    const item = {
      id: `si_${o.id.slice(4)}`, object: 'subscription_item',
      price: { id: o.priceId || `price_${o.interval || 'month'}`, object: 'price', recurring: { interval: o.interval || 'month', interval_count: 1 } },
    };
    if (basil) Object.assign(item, { current_period_start: o.current_period_start, current_period_end: o.current_period_end });
    const out = {
      id: o.id, object: 'subscription', customer: o.customer, status: o.status,
      cancel_at_period_end: !!o.cancel_at_period_end, canceled_at: o.canceled_at || null, ended_at: o.ended_at || null,
      items: { object: 'list', data: [item], has_more: false },
    };
    if (!basil) Object.assign(out, { current_period_start: o.current_period_start, current_period_end: o.current_period_end });
    return out;
  }
  if (kind === 'invoice') {
    const lines = (o.lines || []).map((l) => {
      const line = { id: l.id, object: 'line_item', period: { start: l.start, end: l.end }, amount: l.amount || 0 };
      if (basil) {
        line.parent = { type: 'subscription_item_details', invoice_item_details: null,
          subscription_item_details: { subscription: l.subscription || null, subscription_item: 'si_x', proration: !!l.proration, invoice_item: null } };
      } else {
        Object.assign(line, { type: 'subscription', subscription: l.subscription || null, proration: !!l.proration });
      }
      return line;
    });
    const out = { id: o.id, object: 'invoice', customer: o.customer, status: o.status, billing_reason: o.billing_reason || 'subscription_cycle',
      lines: { object: 'list', data: lines, has_more: false } };
    if (basil) {
      out.parent = o.subscription
        ? { type: 'subscription_details', quote_details: null, subscription_details: { metadata: {}, subscription: o.subscription } }
        : null;
    } else {
      Object.assign(out, { subscription: o.subscription || null, charge: o.charge || null,
        payment_intent: o.payment_intent || null, paid: o.status === 'paid' });
    }
    return out;
  }
  if (kind === 'charge') {
    const out = { id: o.id, object: 'charge', customer: o.customer || null, payment_intent: o.payment_intent || null,
      amount: o.amount, amount_refunded: o.amount_refunded || 0, refunded: !!o.refunded, disputed: !!o.disputed };
    if (!basil) out.invoice = o.invoice || null;
    return out;
  }
  if (kind === 'dispute') {
    return { id: o.id, object: 'dispute', charge: o.charge, payment_intent: o.payment_intent || null,
      amount: o.amount || 0, status: 'needs_response', reason: 'fraudulent' };
  }
  if (kind === 'session') {
    return { id: o.id, object: 'checkout.session', mode: o.mode, customer: o.customer || null,
      subscription: o.subscription || null, payment_intent: o.payment_intent || null, invoice: o.invoice || null,
      metadata: o.metadata || {}, client_reference_id: o.client_reference_id || null,
      customer_details: o.customer_details || null, payment_status: o.payment_status || 'paid' };
  }
  throw new Error(`render: unknown kind ${kind}`);
}

function makeStripe() {
  const s = { subs: new Map(), invoices: new Map(), charges: new Map(), sessions: new Map(), calls: [], fail: new Set(), now: () => Math.floor(Date.now() / 1000) };

  function reset() {
    for (const m of [s.subs, s.invoices, s.charges, s.sessions]) m.clear();
    s.calls = [];
    s.fail = new Set();
  }
  const note = (method, id, params) => {
    s.calls.push({ method, id, params: params ? clone(params) : null });
    if (s.fail.has(method)) throw stripeError('StripeConnectionError', undefined, undefined, 'An error occurred with our connection to Stripe.');
  };
  const need = (map, id, kind) => {
    const o = map.get(id);
    if (!o) throw stripeError('StripeInvalidRequestError', 'resource_missing', 404, `No such ${kind}: '${id}'`);
    return o;
  };
  const ended = (sub) => sub.status === 'canceled' || sub.status === 'incomplete_expired';

  const api = {
    webhooks: {
      constructEvent: (body, sig) => {
        if (!sig) throw new Error('No stripe-signature header value was provided.');
        return JSON.parse(Buffer.isBuffer(body) ? body.toString('utf8') : String(body));
      },
    },
    subscriptions: {
      retrieve: async (id) => { note('subscriptions.retrieve', id); return render('subscription', need(s.subs, id, 'subscription'), SERVER_VERSION); },
      update: async (id, params = {}) => {
        note('subscriptions.update', id, params);
        const sub = need(s.subs, id, 'subscription');
        if (ended(sub)) throw stripeError('StripeInvalidRequestError', undefined, 400, 'A canceled subscription can only update its cancellation_details and metadata.');
        if ('cancel_at_period_end' in params) sub.cancel_at_period_end = !!params.cancel_at_period_end;
        return render('subscription', sub, SERVER_VERSION);
      },
      cancel: async (id) => {
        note('subscriptions.cancel', id);
        const sub = need(s.subs, id, 'subscription');
        if (ended(sub)) throw stripeError('StripeInvalidRequestError', undefined, 400, `This subscription has already been canceled: ${id}`);
        sub.status = 'canceled';
        sub.canceled_at = s.now();
        sub.ended_at = s.now();
        return render('subscription', sub, SERVER_VERSION);
      },
    },
    charges: {
      retrieve: async (id, params = {}) => {
        note('charges.retrieve', id, params);
        const ch = need(s.charges, id, 'charge');
        const out = render('charge', ch, SERVER_VERSION);
        if ((params.expand || []).includes('invoice') && out.invoice) {
          out.invoice = render('invoice', need(s.invoices, out.invoice, 'invoice'), SERVER_VERSION);
        }
        return out;
      },
    },
    invoices: {
      retrieve: async (id) => { note('invoices.retrieve', id); return render('invoice', need(s.invoices, id, 'invoice'), SERVER_VERSION); },
    },
    checkout: {
      sessions: {
        list: async (params = {}) => {
          note('checkout.sessions.list', null, params);
          // A subscription's Checkout Session has no payment_intent, so a list
          // by payment intent never finds one: the real API's behaviour. By
          // subscription it finds the session that started it.
          const data = [...s.sessions.values()]
            .filter((x) => (params.payment_intent || params.subscription)
              && (!params.payment_intent || x.payment_intent === params.payment_intent)
              && (!params.subscription || x.subscription === params.subscription))
            .map((x) => render('session', x, SERVER_VERSION));
          return { object: 'list', data: data.slice(0, params.limit || 10), has_more: false };
        },
        listLineItems: async (id) => {
          note('checkout.sessions.listLineItems', id);
          const x = need(s.sessions, id, 'checkout session');
          const price = { id: x.priceId || 'price_unknown', object: 'price' };
          if (x.mode === 'subscription' && x.interval) price.recurring = { interval: x.interval, interval_count: 1 };
          else price.recurring = null;
          return { object: 'list', data: [{ id: 'li_1', object: 'item', price, quantity: 1 }], has_more: false };
        },
        retrieve: async (id) => { note('checkout.sessions.retrieve', id); return render('session', need(s.sessions, id, 'checkout session'), SERVER_VERSION); },
        create: async (params) => { note('checkout.sessions.create', null, params); return { id: 'cs_new', url: 'https://checkout.test/cs_new' }; },
      },
    },
    billingPortal: {
      sessions: { create: async (o) => { note('billingPortal.sessions.create', o.customer, o); return { url: `https://billing.test/${o.customer}` }; } },
    },
  };

  /** One Stripe event, its object drawn in the endpoint's API version. */
  function event(type, kind, o, version = SERVER_VERSION) {
    if (!VERSIONS.includes(version)) throw new Error(`unknown API version ${version}`);
    return { id: `evt_${Math.random().toString(36).slice(2, 10)}`, object: 'event', api_version: version, type,
      data: { object: render(kind, o, version) } };
  }

  return { api, s, reset, event, calls: (method) => s.calls.filter((c) => !method || c.method === method) };
}

// ── Loading a route module with the fakes in place of the real clients ─────

const Module = require('module');
const path = require('path');

function loadWith(file, { supabase, stripe }) {
  const real = Module._load;
  Module._load = function patched(request, parent, isMain) {
    if (request === '../db/supabase') return supabase;
    if (request === 'stripe') return () => stripe;
    return real(request, parent, isMain);
  };
  try {
    const p = require.resolve(file);
    delete require.cache[p];
    return require(p);
  } finally {
    Module._load = real;
  }
}

/** Drive one request through an Express router, resolving with its answer. */
function callRouter(router, method, url, { headers = {}, body = {} } = {}) {
  return new Promise((resolve, reject) => {
    const [pathname, qs] = url.split('?');
    const timer = setTimeout(() => reject(new Error(`${method} ${url} never answered`)), 8000);
    const done = (v) => { clearTimeout(timer); resolve(v); };
    const req = {
      method, url, originalUrl: url, path: pathname, body,
      headers: Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v])),
      query: Object.fromEntries(new URLSearchParams(qs || '')),
    };
    const res = {
      statusCode: 200, headersSent: false,
      status(c) { this.statusCode = c; return this; },
      setHeader() {}, set() { return this; }, type() { return this; },
      json(b) { this.headersSent = true; done({ status: this.statusCode, body: b }); return this; },
      send(b) { this.headersSent = true; done({ status: this.statusCode, body: b }); return this; },
      end() { this.headersSent = true; done({ status: this.statusCode, body: null }); return this; },
    };
    router(req, res, (err) => (err ? reject(err) : done({ status: 404, body: null })));
  });
}

/** Hand one event to the webhook handler as Stripe would, raw body and all. */
async function deliver(handler, evt) {
  const res = { code: 200, body: null };
  res.status = (c) => { res.code = c; return res; };
  res.json = (b) => { res.body = b; return res; };
  await handler({ headers: { 'stripe-signature': 't=1,v1=fake' }, body: Buffer.from(JSON.stringify(evt)) }, res);
  return res;
}

/** Everything the code under test printed while fn ran, as one string per line. */
async function captureLogs(fn) {
  const lines = [];
  const orig = { log: console.log, warn: console.warn, error: console.error };
  const grab = (...a) => lines.push(a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' '));
  console.log = grab; console.warn = grab; console.error = grab;
  try { await fn(); } finally { Object.assign(console, orig); }
  return lines;
}

const DAY = 24 * 60 * 60;

module.exports = {
  LIVE_COLUMNS, CHECKS, PROTECTED, SERVER_VERSION, VERSIONS, DAY,
  makeSupabase, makeStripe, render, loadWith, callRouter, deliver, captureLogs,
  SERVER: path.join(__dirname, '..', '..', 'server'),
};
