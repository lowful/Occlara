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
 *   THE ACCOUNTS TABLES AND FUNCTIONS of 8.7 (the site's migration
 *   20261104000000_accounts_tiers_referral.sql), when `accounts: true`:
 *   entitlements, game_usage, app_sessions, auth_handoffs, referral_codes,
 *   referral_redemptions and devices with their columns, CHECKs, NOT NULLs,
 *   keys and unique constraints, and supabase.rpc() running ensure_entitlement,
 *   claim_game, settle_game and account_state with the SQL's own semantics
 *   (the same payer rules, through server/scripts/backfill-entitlements.js
 *   mapLicences, the same month stepping, the same refund cap). Without
 *   `accounts`, the server's view before the migration runs: every account
 *   table is PGRST205 and every account function PGRST202, as PostgREST
 *   answers for a relation or function it does not have. The clock is
 *   settable (`now` in reset, setNow, advance), so periods and the 3 hour
 *   stale rule can be driven.
 *
 * Nothing here touches a network.
 */

const crypto = require('crypto');

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
  // 20261104000000_accounts_tiers_referral.sql: 'free' is a plan too.
  accounts: {
    status: ['active', 'expired', 'cancelled', 'payment_failed', 'refunded', 'disputed'],
    plan: ['weekly', 'monthly', 'yearly', 'lifetime', 'free'],
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
    // The clock every account function and default reads. A number (ms) or a
    // function; real time when not given, as before.
    db.clock = typeof next.now === 'function' ? next.now
      : next.now != null ? (() => { const t = next.now; return () => t; })() : () => Date.now();
    db.rows = (next.rows || []).map((r) => {
      const row = Object.fromEntries([...db.columns].map((c) => [c, null]));
      Object.assign(row, clone(r));
      if (!row.id) row.id = uuid();
      if (!row.created_at) row.created_at = new Date(db.clock()).toISOString();
      if (!row.status) row.status = 'active';
      return row;
    });
    db.accounts = !!next.accounts;
    db.schema = next.schema || (db.accounts ? 'accounts' : 'today');
    db.tables = Object.fromEntries(Object.keys(ACCOUNT_TABLES).map((t) => [t, []]));
    for (const [t, rows] of Object.entries(next.tables || {})) {
      if (!ACCOUNT_TABLES[t]) throw new Error(`the fake has no table ${t}`);
      db.tables[t] = rows.map((r) => withDefaults(t, r, db.clock()));
    }
    db.rpcCalls = [];
    // auth.admin.getUserById answers from here: { [id]: { id, email, created_at, ... } }.
    db.userRecords = next.userRecords || {};
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

  const accounts = makeAccounts(db, { checkRow, OUTAGE });

  function from(table) {
    if (ACCOUNT_TABLES[table]) return accounts.from(table);
    if (table !== 'licenses') throw new Error(`the fake knows the licenses and the accounts tables only, not ${table}`);
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
    admin: {
      getUserById: async (id) => {
        const user = db.userRecords[id];
        return user ? { data: { user: clone(user) }, error: null }
          : { data: { user: null }, error: null };
      },
    },
  };

  const setNow = (t) => { db.clock = typeof t === 'function' ? t : () => t; };
  const advance = (msBy) => { const t = db.clock() + msBy; db.clock = () => t; };

  return { from, auth, rpc: accounts.rpc, _db: db, reset, setNow, advance };
}

// ── The 8.7 accounts tables and functions ─────────────────────────────────

const HOUR_MS = 60 * 60 * 1000;
const STALE_MS = 3 * HOUR_MS;
const MATCH_READS_COUNTED = 120;
const REFUND_CAP = 3;
const REFERRAL_BONUS = 4;
const REFERRAL_MAX_EARNED = 20;

// Every table of 20261104000000_accounts_tiers_referral.sql: its columns and
// their defaults (a function of the clock for the time ones), NOT NULL columns,
// CHECKs, its key and its unique constraints. A unique constraint over a null
// value never conflicts, as in Postgres.
const ACCOUNT_TABLES = {
  entitlements: {
    columns: { user_id: null, tier: 'free', cap_monthly: 0, free_total: 3, bonus_pool: 0, bonus_earned: 0,
      source: 'free', stripe_subscription_id: null, period_anchor: null, status: 'active', renew_as: null,
      account_key: null, created_at: (t) => t, updated_at: (t) => t },
    notNull: ['user_id', 'tier', 'cap_monthly', 'free_total', 'bonus_pool', 'bonus_earned', 'source', 'status'],
    checks: {
      tier: ['free', 'pro', 'max'],
      source: ['free', 'stripe', 'legacy_weekly', 'legacy_monthly', 'legacy_yearly', 'legacy_lifetime', 'comp'],
      status: ['active', 'ended'],
    },
    nonNegative: ['cap_monthly', 'free_total', 'bonus_pool', 'bonus_earned'],
    pk: ['user_id'], unique: [['account_key']], users: ['user_id'],
  },
  game_usage: {
    columns: { id: () => uuid(), user_id: null, period_start: null, game: null, kind: null, client_match_id: null,
      device_hash: null, riot_puuid: null, status: 'reserved', source: null, over_cap: false, reads: 0,
      match_reads: 0, reason: null, created_at: (t) => t, settled_at: null },
    notNull: ['id', 'user_id', 'game', 'kind', 'status', 'source', 'over_cap', 'reads', 'match_reads'],
    checks: {
      game: ['valorant', 'lol'], kind: ['live', 'riot', 'league'],
      status: ['reserved', 'counted', 'refunded'], source: ['allowance', 'free', 'bonus', 'shadow'],
    },
    pk: ['id'], unique: [['user_id', 'client_match_id']], users: ['user_id'],
    names: { 'user_id,client_match_id': 'game_usage_user_client_match_key' },
  },
  app_sessions: {
    columns: { id: () => uuid(), user_id: null, token_hash: null, device_hash: null, device_name: null,
      ip_prefix_hash: null, created_at: (t) => t, last_seen: (t) => t, revoked_at: null },
    notNull: ['id', 'user_id', 'token_hash'],
    pk: ['id'], unique: [['token_hash']], users: ['user_id'],
  },
  auth_handoffs: {
    columns: { code_hash: null, user_id: null, state: null, challenge: null, expires_at: null, used_at: null },
    notNull: ['code_hash', 'user_id', 'state', 'challenge', 'expires_at'],
    pk: ['code_hash'], unique: [], users: ['user_id'],
  },
  referral_codes: {
    columns: { user_id: null, code: null, created_at: (t) => t },
    notNull: ['user_id', 'code'],
    pk: ['user_id'], unique: [['code']], users: ['user_id'],
  },
  referral_redemptions: {
    columns: { invitee_id: null, inviter_id: null, code: null, status: 'pending', reason: null,
      created_at: (t) => t, qualified_at: null },
    notNull: ['invitee_id', 'inviter_id', 'code', 'status'],
    checks: { status: ['pending', 'qualified', 'refused'] },
    pk: ['invitee_id'], unique: [], users: ['invitee_id', 'inviter_id'],
  },
  devices: {
    columns: { device_hash: null, first_user_id: null, free_used: false, created_at: (t) => t },
    notNull: ['device_hash', 'free_used'],
    pk: ['device_hash'], unique: [], users: [],
  },
};

const ACCOUNT_FUNCTIONS = ['ensure_entitlement', 'claim_game', 'settle_game', 'account_state'];

function withDefaults(table, input, nowMs) {
  const spec = ACCOUNT_TABLES[table];
  const iso = new Date(nowMs).toISOString();
  const row = {};
  for (const [c, d] of Object.entries(spec.columns)) {
    row[c] = typeof d === 'function' ? (d.length ? d(iso) : d()) : d;
  }
  return Object.assign(row, clone(input));
}

// A timestamp stepped by whole months in UTC, a day past a short month's end
// landing on its last day, as Postgres adds interval '1 month'.
function addMonthsUTC(msAt, n) {
  const d = new Date(msAt);
  const m = d.getUTCMonth() + n;
  const y = d.getUTCFullYear() + Math.floor(m / 12);
  const mm = ((m % 12) + 12) % 12;
  const last = new Date(Date.UTC(y, mm + 1, 0)).getUTCDate();
  return Date.UTC(y, mm, Math.min(d.getUTCDate(), last), d.getUTCHours(), d.getUTCMinutes(),
    d.getUTCSeconds(), d.getUTCMilliseconds());
}

/** entitlement_period: the anchor stepped in whole months to the latest step not after `at`. */
function entitlementPeriod(anchor, at) {
  if (anchor == null) return { start: null, end: null };
  const a = typeof anchor === 'number' ? anchor : Date.parse(anchor);
  const t = typeof at === 'number' ? at : Date.parse(at);
  const da = new Date(a);
  const dt = new Date(t);
  let n = (dt.getUTCFullYear() - da.getUTCFullYear()) * 12 + (dt.getUTCMonth() - da.getUTCMonth());
  while (addMonthsUTC(a, n) > t) n--;
  while (addMonthsUTC(a, n + 1) <= t) n++;
  return { start: addMonthsUTC(a, n), end: addMonthsUTC(a, n + 1) };
}

function makeAccounts(db, { checkRow, OUTAGE }) {
  const now = () => db.clock();
  const iso = (t) => (t == null ? null : new Date(t).toISOString());
  const ms = (t) => (t == null ? null : Date.parse(t));
  const T = (name) => db.tables[name];
  const missingTable = (t) => ({ data: null, error: pgError('PGRST205',
    `Could not find the table 'public.${t}' in the schema cache`) });
  const raise = (message) => { throw Object.assign(new Error(message), { pg: pgError('P0001', message) }); };

  // ── constraints ──
  function violates(table, row, others) {
    const spec = ACCOUNT_TABLES[table];
    for (const c of Object.keys(row)) {
      if (!(c in spec.columns)) return pgError('PGRST204', `Could not find the '${c}' column of '${table}' in the schema cache`);
    }
    for (const c of spec.notNull) {
      if (row[c] == null) return pgError('23502', `null value in column "${c}" of relation "${table}" violates not-null constraint`);
    }
    for (const [c, allowed] of Object.entries(spec.checks || {})) {
      if (row[c] != null && !allowed.includes(row[c])) {
        return pgError('23514', `new row for relation "${table}" violates check constraint "${table}_${c}_check"`);
      }
    }
    for (const c of spec.nonNegative || []) {
      if (row[c] != null && row[c] < 0) {
        return pgError('23514', `new row for relation "${table}" violates check constraint "${table}_${c}_check"`);
      }
    }
    for (const cols of [spec.pk, ...spec.unique]) {
      if (cols.some((c) => row[c] == null)) continue;
      if (others.some((o) => cols.every((c) => o[c] === row[c]))) {
        const name = (spec.names && spec.names[cols.join(',')])
          || (cols === spec.pk ? `${table}_pkey` : `${table}_${cols.join('_')}_key`);
        return pgError('23505', `duplicate key value violates unique constraint "${name}"`);
      }
    }
    if (db.authUsers) {
      for (const c of spec.users) {
        if (row[c] == null) continue;
        if (!UUID_RE.test(String(row[c]))) return pgError('22P02', `invalid input syntax for type uuid: "${row[c]}"`);
        if (!db.authUsers.has(row[c])) {
          return pgError('23503', `insert or update on table "${table}" violates foreign key constraint "${table}_${c}_fkey"`);
        }
      }
    }
    return null;
  }

  // Writes the account functions make go through the same constraints, and a
  // refused one raises, as it would inside the SQL function.
  function put(table, input) {
    const row = withDefaults(table, input, now());
    const err = violates(table, row, T(table));
    if (err) throw Object.assign(new Error(err.message), { pg: err });
    T(table).push(row);
    return row;
  }
  function patch(table, row, changes) {
    const next = { ...row, ...changes };
    const err = violates(table, next, T(table).filter((o) => o !== row));
    if (err) throw Object.assign(new Error(err.message), { pg: err });
    Object.assign(row, changes);
    return row;
  }

  // ── the SQL functions ──
  const { mapLicences } = require(path.join(__dirname, '..', '..', 'server', 'scripts', 'backfill-entitlements.js'));
  const KEY_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  function newKey() {
    for (;;) {
      const seg = () => Array.from({ length: 4 }, () => KEY_CHARS[crypto.randomInt(36)]).join('');
      const k = `GC-${seg()}-${seg()}-${seg()}-${seg()}`;
      if (!db.rows.some((r) => r.license_key === k) && !T('entitlements').some((e) => e.account_key === k)) return k;
    }
  }
  const entitlementOf = (user) => T('entitlements').find((e) => e.user_id === user);

  function ensureEntitlement(user) {
    if (!user) raise('ensure_entitlement: no user');
    const have = entitlementOf(user);
    if (have) return have;
    const lics = db.rows.filter((r) => r.user_id === user);
    const want = mapLicences(lics, now());
    let key = want.account_key;
    if (want.mintFree) {
      key = newKey();
      const lic = Object.fromEntries([...db.columns].map((c) => [c, null]));
      Object.assign(lic, { id: uuid(), user_id: user, license_key: key, plan: 'free', status: 'active',
        expires_at: null, created_at: iso(now()) });
      const err = checkRow(lic);
      if (err) throw Object.assign(new Error(err.message), { pg: err });
      db.rows.push(lic);
      db.writes.push({ op: 'insert', row: clone(lic), error: null });
    }
    return put('entitlements', {
      user_id: user, tier: want.tier, cap_monthly: want.cap_monthly, free_total: want.free_total,
      source: want.source, stripe_subscription_id: want.stripe_subscription_id,
      period_anchor: want.tier === 'free' ? iso(now()) : want.period_anchor,
      status: want.status, renew_as: want.renew_as, account_key: key,
    });
  }

  const paidActive = (e) => (e.tier === 'pro' || e.tier === 'max') && e.status === 'active';
  const live = (g) => g.status === 'reserved' || g.status === 'counted';

  function allowance(e) {
    if (paidActive(e)) {
      const p = entitlementPeriod(e.period_anchor || e.created_at, now());
      const used = T('game_usage').filter((g) => g.user_id === e.user_id && g.source === 'allowance'
        && live(g) && ms(g.created_at) >= p.start).length;
      return { period_start: iso(p.start), period_end: iso(p.end), used,
        allowance_left: Math.max((e.cap_monthly || 0) - used, 0) };
    }
    const used = T('game_usage').filter((g) => g.user_id === e.user_id && g.source === 'free' && live(g)).length;
    return { period_start: null, period_end: null, used, allowance_left: Math.max((e.free_total || 0) - used, 0) };
  }

  const refundsToday = (user) => T('game_usage').filter((g) => g.user_id === user && g.status === 'refunded'
    && g.settled_at && ms(g.settled_at) > now() - 24 * HOUR_MS).length;

  const sha256hex = (v) => crypto.createHash('sha256').update(String(v)).digest('hex');
  // A device the inviter is known on: an app session, the device their games
  // were first claimed on, or the device their licence key is activated on.
  const inviterDevice = (inviter, device) => T('app_sessions').some((s) => s.user_id === inviter && s.device_hash === device)
    || T('devices').some((d) => d.device_hash === device && d.first_user_id === inviter)
    || db.rows.some((l) => l.user_id === inviter && l.device_id != null && sha256hex(l.device_id) === device);
  // Only a game the account really had qualifies an invite, never a shadow one.
  const realGame = (source, over) => ['free', 'allowance', 'bonus'].includes(source) && !over;

  function qualifyReferral(user, device) {
    if (device == null) return;
    const r = T('referral_redemptions').find((x) => x.invitee_id === user && x.status === 'pending');
    if (!r) return;
    if (inviterDevice(r.inviter_id, device)) {
      patch('referral_redemptions', r, { status: 'refused', reason: 'inviter-device' });
      return;
    }
    ensureEntitlement(r.inviter_id);
    const inv = entitlementOf(r.inviter_id);
    const ended = inv.status === 'ended';
    const add = ended ? 0 : Math.min(REFERRAL_BONUS, Math.max(REFERRAL_MAX_EARNED - inv.bonus_earned, 0));
    if (add > 0) {
      patch('entitlements', inv, { bonus_pool: inv.bonus_pool + add, bonus_earned: inv.bonus_earned + add,
        updated_at: iso(now()) });
    }
    patch('referral_redemptions', r, { status: 'qualified', qualified_at: iso(now()),
      reason: ended ? 'inviter-ended' : add > 0 ? null : 'max-earned' });
  }

  /** entitlement_settle_stale: live rows reserved past 3 hours, counted or given back. */
  function settleStale(user) {
    const e = entitlementOf(user);
    const stale = T('game_usage').filter((g) => g.user_id === user && g.kind === 'live' && g.status === 'reserved'
      && ms(g.created_at) < now() - STALE_MS).sort((a, b) => ms(a.created_at) - ms(b.created_at));
    for (const g of stale) {
      if (g.match_reads >= MATCH_READS_COUNTED) {
        patch('game_usage', g, { status: 'counted', reason: 'reads', settled_at: iso(now()) });
      } else if (refundsToday(user) >= REFUND_CAP) {
        patch('game_usage', g, { status: 'counted', reason: 'refund-cap', settled_at: iso(now()) });
      } else {
        patch('game_usage', g, { status: 'refunded', reason: 'stale', settled_at: iso(now()) });
        if (g.source === 'bonus' && e && e.status === 'active') {
          patch('entitlements', e, { bonus_pool: e.bonus_pool + 1, updated_at: iso(now()) });
        }
      }
    }
  }

  function claimGame({ p_user, p_game, p_kind, p_client_match_id = null, p_device_hash = null, p_enforce = false }) {
    if (!p_user) raise('claim_game: no user');
    if (!['valorant', 'lol'].includes(p_game)) raise(`claim_game: unknown game ${p_game}`);
    if (!['live', 'riot', 'league'].includes(p_kind)) raise(`claim_game: unknown kind ${p_kind}`);
    const e = ensureEntitlement(p_user);

    let d = null;
    if (p_device_hash != null) {
      d = T('devices').find((x) => x.device_hash === p_device_hash)
        || put('devices', { device_hash: p_device_hash, first_user_id: p_user });
      // The inviter's own device: the pending invite is refused before a free
      // claim makes the device this user's.
      if (d.first_user_id !== p_user) {
        for (const r of T('referral_redemptions')) {
          if (r.invitee_id === p_user && r.status === 'pending' && r.inviter_id === d.first_user_id) {
            patch('referral_redemptions', r, { status: 'refused', reason: 'inviter-device' });
          }
        }
      }
    }

    settleStale(p_user);

    if (p_client_match_id != null) {
      const u = T('game_usage').find((g) => g.user_id === p_user && g.client_match_id === p_client_match_id);
      if (u) {
        return { granted: u.status !== 'refunded', usage_id: u.id, left: allowance(e).allowance_left + e.bonus_pool,
          reason: 'existing' };
      }
    } else if (p_kind === 'live') {
      const u = T('game_usage').filter((g) => g.user_id === p_user && g.kind === 'live' && g.game === p_game
        && g.status === 'reserved' && ms(g.created_at) >= now() - STALE_MS
        && (g.device_hash == null ? p_device_hash == null : g.device_hash === p_device_hash))
        .sort((a, b) => ms(b.created_at) - ms(a.created_at))[0];
      if (u) return { granted: true, usage_id: u.id, left: allowance(e).allowance_left + e.bonus_pool, reason: 'open' };
    }

    const al = allowance(e);
    const deviceBlocked = !paidActive(e) && !!d && d.first_user_id !== p_user && d.free_used;
    let source;
    let overCap = false;
    let reason = null;
    if (al.allowance_left > 0 && !deviceBlocked) source = paidActive(e) ? 'allowance' : 'free';
    else if (e.bonus_pool > 0 && e.status !== 'ended') source = 'bonus';
    else if (p_enforce) return { granted: false, usage_id: null, left: 0, reason: deviceBlocked ? 'device' : 'cap' };
    else { source = 'shadow'; overCap = true; reason = deviceBlocked ? 'device' : 'cap'; }

    const status = p_kind === 'live' ? 'reserved' : 'counted';
    const u = put('game_usage', {
      user_id: p_user, period_start: al.period_start, game: p_game, kind: p_kind, client_match_id: p_client_match_id,
      device_hash: p_device_hash, status, source, over_cap: overCap, reason,
      settled_at: status === 'counted' ? iso(now()) : null,
    });
    if (source === 'bonus') patch('entitlements', e, { bonus_pool: e.bonus_pool - 1, updated_at: iso(now()) });
    if (source === 'free' && d) patch('devices', d, { first_user_id: p_user, free_used: true });
    if (status === 'counted' && realGame(source, overCap)) qualifyReferral(p_user, p_device_hash);

    let left = source === 'allowance' || source === 'free' ? al.allowance_left - 1 : al.allowance_left;
    if (deviceBlocked) left = 0;
    return { granted: true, usage_id: u.id, left: Math.max(left, 0) + e.bonus_pool, reason };
  }

  function settleGame({ p_usage, p_outcome, p_reason = null }) {
    if (!['counted', 'refunded'].includes(p_outcome)) raise(`settle_game: unknown outcome ${p_outcome}`);
    const u = T('game_usage').find((g) => g.id === p_usage);
    if (!u) raise(`settle_game: no usage row ${p_usage}`);
    if (u.status !== 'reserved') return { usage_id: u.id, status: u.status, reason: u.reason, changed: false };
    let status = p_outcome;
    let reason = p_reason;
    if (p_outcome === 'refunded' && refundsToday(u.user_id) >= REFUND_CAP) { status = 'counted'; reason = 'refund-cap'; }
    patch('game_usage', u, { status, reason: reason != null ? reason : u.reason, settled_at: iso(now()) });
    if (status === 'refunded' && u.source === 'bonus') {
      const e = entitlementOf(u.user_id);
      if (e && e.status === 'active') patch('entitlements', e, { bonus_pool: e.bonus_pool + 1, updated_at: iso(now()) });
    }
    if (status === 'counted' && realGame(u.source, u.over_cap)) qualifyReferral(u.user_id, u.device_hash);
    return { usage_id: u.id, status: u.status, reason: u.reason, changed: true };
  }

  /** release_game: the caller's counted riot row of one client_match_id given back, within the refund cap. */
  function releaseGame({ p_user, p_client_match_id }) {
    if (!p_user || p_client_match_id == null) raise('release_game: no user or match');
    const u = T('game_usage').find((g) => g.user_id === p_user && g.client_match_id === p_client_match_id);
    if (!u) return { usage_id: null, status: null, reason: 'none', changed: false };
    if (u.kind !== 'riot' || u.status !== 'counted' || ms(u.created_at) < now() - 24 * HOUR_MS) {
      return { usage_id: u.id, status: u.status, reason: u.reason, changed: false };
    }
    if (refundsToday(p_user) >= REFUND_CAP) return { usage_id: u.id, status: u.status, reason: 'refund-cap', changed: false };
    patch('game_usage', u, { status: 'refunded', reason: 'taken-back', settled_at: iso(now()) });
    const e = entitlementOf(p_user);
    if (u.source === 'bonus' && e && e.status === 'active') {
      patch('entitlements', e, { bonus_pool: e.bonus_pool + 1, updated_at: iso(now()) });
    }
    return { usage_id: u.id, status: u.status, reason: u.reason, changed: true };
  }

  function accountState({ p_user }) {
    ensureEntitlement(p_user);
    settleStale(p_user);
    const e = entitlementOf(p_user);
    const al = allowance(e);
    const mine = T('referral_redemptions').filter((r) => r.inviter_id === p_user);
    const by = (s) => mine.filter((r) => r.status === s).length;
    return {
      tier: e.tier, status: e.status, source: e.source, cap_monthly: e.cap_monthly,
      used: al.used, left: al.allowance_left + e.bonus_pool, allowance_left: al.allowance_left,
      period_start: al.period_start, period_end: al.period_end,
      free_total: e.free_total, bonus_pool: e.bonus_pool, bonus_earned: e.bonus_earned, renew_as: e.renew_as,
      invites: { pending: by('pending'), qualified: by('qualified'), refused: by('refused'), total: mine.length },
      account_key: e.account_key,
    };
  }

  const FUNCS = {
    ensure_entitlement: (a) => ensureEntitlement(a.p_user),
    claim_game: claimGame,
    settle_game: settleGame,
    release_game: releaseGame,
    account_state: accountState,
  };

  // A function runs as one transaction: a raise leaves every table as it was.
  function transaction(fn) {
    const snap = { tables: clone(db.tables), rows: clone(db.rows), writes: db.writes.length };
    try {
      return { data: clone(fn()), error: null };
    } catch (err) {
      if (!err.pg) throw err;
      db.tables = snap.tables;
      db.rows.splice(0, db.rows.length, ...snap.rows);
      db.writes.length = snap.writes;
      return { data: null, error: err.pg };
    }
  }

  function rpc(name, args = {}) {
    const run = () => {
      db.rpcCalls.push({ name, args: clone(args) });
      if (db.outage) return OUTAGE;
      if (!FUNCS[name] || !db.accounts) {
        return { data: null, error: pgError('PGRST202',
          `Could not find the function public.${name} without parameters in the schema cache`) };
      }
      if (db.failWrites) return { data: null, error: pgError('08006', 'connection failure during write') };
      return transaction(() => FUNCS[name](args || {}));
    };
    const b = {
      single() { return b; },
      maybeSingle() { return b; },
      abortSignal() { return b; },
      then(res, rej) { return Promise.resolve().then(run).then(res, rej); },
    };
    return b;
  }

  // ── from(): the tables through PostgREST ──
  function cmp(a, b) {
    const da = typeof a === 'string' && /^\d{4}-\d\d-\d\dT/.test(a) ? Date.parse(a) : a;
    const dbv = typeof b === 'string' && /^\d{4}-\d\d-\d\dT/.test(b) ? Date.parse(b) : b;
    return da < dbv ? -1 : da > dbv ? 1 : 0;
  }
  function matchesRow(row, filters) {
    return filters.every((f) => {
      const [op, col] = f;
      const v = row[col];
      if (op === 'eq') return v === f[2];
      if (op === 'neq') return v !== f[2];
      if (op === 'in') return f[2].includes(v);
      if (op === 'is') return v === f[2];
      if (op === 'gt') return v != null && cmp(v, f[2]) > 0;
      if (op === 'gte') return v != null && cmp(v, f[2]) >= 0;
      if (op === 'lt') return v != null && cmp(v, f[2]) < 0;
      if (op === 'lte') return v != null && cmp(v, f[2]) <= 0;
      if (op === 'not') {
        if (f[2] === 'is') return v !== f[3];
        if (f[2] === 'eq') return v !== f[3];
        if (f[2] !== 'in') throw new Error(`the fake supports not(col, 'is' | 'eq' | 'in', ...) only, got ${f[2]}`);
        const list = String(f[3]).replace(/^\(|\)$/g, '').split(',').map((s) => s.trim().replace(/^"|"$/g, ''));
        return !list.includes(v);
      }
      throw new Error(`the fake does not support the filter ${op}`);
    });
  }
  const colsOf = (cols) => (!cols || cols.trim() === '*' ? null : cols.split(',').map((s) => s.trim()).filter(Boolean));
  function projectRow(row, cols) {
    const list = colsOf(cols);
    if (!list) return clone(row);
    return Object.fromEntries(list.map((c) => [c, row[c] === undefined ? null : clone(row[c])]));
  }
  function shape(q, rows, count) {
    const extra = q.count ? { count } : {};
    if (q.head) return { data: null, error: null, ...extra };
    if (q.single) {
      if (rows.length === 1) return { data: rows[0], error: null, ...extra };
      return { data: null, error: pgError('PGRST116', 'JSON object requested, multiple (or no) rows returned',
        `The result contains ${rows.length} rows`) };
    }
    if (q.maybe) {
      if (rows.length <= 1) return { data: rows[0] || null, error: null, ...extra };
      return { data: null, error: pgError('PGRST116', 'JSON object requested, multiple (or no) rows returned',
        `The result contains ${rows.length} rows`) };
    }
    return { data: rows, error: null, ...extra };
  }

  function runQuery(q) {
    if (db.outage) return OUTAGE;
    if (!db.accounts) return missingTable(q.table);
    const spec = ACCOUNT_TABLES[q.table];
    const rows = T(q.table);
    for (const f of q.filters) {
      if (!(f[1] in spec.columns)) return { data: null, error: pgError('42703', `column ${q.table}.${f[1]} does not exist`) };
    }
    const badCol = (colsOf(q.cols) || []).find((c) => !(c in spec.columns));
    if (badCol) return { data: null, error: pgError('42703', `column ${q.table}.${badCol} does not exist`) };
    if (q.op !== 'select' && db.failWrites) return { data: null, error: pgError('08006', 'connection failure during write') };

    const record = (error, extra) => { if (q.op !== 'select') db.writes.push({ table: q.table, op: q.op, error, ...extra }); };

    if (q.op === 'select') {
      db.reads++;
      let hit = rows.filter((r) => matchesRow(r, q.filters));
      const count = hit.length;
      if (q.order) hit = hit.slice().sort((a, b) => cmp(a[q.order.c], b[q.order.c]) * (q.order.asc ? 1 : -1));
      if (q.range) hit = hit.slice(q.range[0], q.range[1] + 1);
      if (q.limit != null) hit = hit.slice(0, q.limit);
      return shape(q, hit.map((r) => projectRow(r, q.cols)), count);
    }

    if (q.op === 'update') {
      const hit = rows.filter((r) => matchesRow(r, q.filters));
      const next = hit.map((r) => ({ ...r, ...clone(q.patch) }));
      for (let i = 0; i < next.length; i++) {
        const err = violates(q.table, next[i], rows.filter((o) => o !== hit[i]).map((o) => {
          const j = hit.indexOf(o);
          return j >= 0 ? next[j] : o;
        }));
        if (err) { record(err, { patch: clone(q.patch) }); return { data: null, error: err }; }
      }
      if (!hit.length) {
        const unknown = Object.keys(q.patch).find((c) => !(c in spec.columns));
        if (unknown) {
          const err = pgError('PGRST204', `Could not find the '${unknown}' column of '${q.table}' in the schema cache`);
          record(err, { patch: clone(q.patch) });
          return { data: null, error: err };
        }
      }
      hit.forEach((r, i) => Object.assign(r, next[i]));
      record(null, { patch: clone(q.patch), count: hit.length });
      if (!q.returning) return { data: null, error: null };
      return shape(q, hit.map((r) => projectRow(r, q.cols)), hit.length);
    }

    if (q.op === 'delete') {
      const hit = rows.filter((r) => matchesRow(r, q.filters));
      db.tables[q.table] = rows.filter((r) => !hit.includes(r));
      record(null, { count: hit.length });
      if (!q.returning) return { data: null, error: null };
      return shape(q, hit.map((r) => projectRow(r, q.cols)), hit.length);
    }

    if (q.op === 'insert' || q.op === 'upsert') {
      const conflict = q.onConflict ? q.onConflict.split(',').map((s) => s.trim()) : spec.pk;
      const made = [];
      const touched = [];
      const work = rows.slice();
      for (const input of q.rows) {
        if (q.op === 'upsert') {
          const existing = work.find((o) => conflict.every((c) => input[c] != null && o[c] === input[c]));
          if (existing) {
            if (q.ignoreDuplicates) continue;
            const next = { ...existing, ...clone(input) };
            const err = violates(q.table, next, work.filter((o) => o !== existing));
            if (err) { record(err, { row: clone(input) }); return { data: null, error: err }; }
            touched.push([existing, next]);
            continue;
          }
        }
        const row = withDefaults(q.table, input, now());
        const err = violates(q.table, row, work);
        if (err) { record(err, { row: clone(input) }); return { data: null, error: err }; }
        made.push(row);
        work.push(row);
      }
      for (const [r, n] of touched) Object.assign(r, n);
      rows.push(...made);
      record(null, { rows: clone(made.concat(touched.map((t) => t[0]))) });
      if (!q.returning) return { data: null, error: null };
      const out = made.concat(touched.map((t) => t[0]));
      return shape(q, out.map((r) => projectRow(r, q.cols)), out.length);
    }
    throw new Error(`the fake does not support ${q.op}`);
  }

  function from(table) {
    const q = { table, op: 'select', cols: '*', patch: null, rows: null, filters: [], order: null, range: null,
      limit: null, single: false, maybe: false, returning: false, count: null, head: false,
      onConflict: null, ignoreDuplicates: false };
    const b = {
      select(cols, opts = {}) {
        if (q.op === 'select') {
          q.cols = cols || '*';
          if (opts.count) q.count = opts.count;
          if (opts.head) q.head = true;
        } else { q.returning = true; q.cols = cols || '*'; }
        return b;
      },
      update(p) { q.op = 'update'; q.patch = p || {}; return b; },
      insert(r) { q.op = 'insert'; q.rows = Array.isArray(r) ? r : [r]; return b; },
      upsert(r, opts = {}) {
        q.op = 'upsert'; q.rows = Array.isArray(r) ? r : [r];
        q.onConflict = opts.onConflict || null; q.ignoreDuplicates = !!opts.ignoreDuplicates;
        return b;
      },
      delete() { q.op = 'delete'; return b; },
      eq(c, v) { q.filters.push(['eq', c, v]); return b; },
      neq(c, v) { q.filters.push(['neq', c, v]); return b; },
      gt(c, v) { q.filters.push(['gt', c, v]); return b; },
      gte(c, v) { q.filters.push(['gte', c, v]); return b; },
      lt(c, v) { q.filters.push(['lt', c, v]); return b; },
      lte(c, v) { q.filters.push(['lte', c, v]); return b; },
      in(c, vs) { q.filters.push(['in', c, Array.from(vs)]); return b; },
      is(c, v) { q.filters.push(['is', c, v]); return b; },
      not(c, op, v) { q.filters.push(['not', c, op, v]); return b; },
      order(c, o) { q.order = { c, asc: !(o && o.ascending === false) }; return b; },
      limit(n) { q.limit = n; return b; },
      range(a, z) { q.range = [a, z]; return b; },
      single() { q.single = true; return b; },
      maybeSingle() { q.maybe = true; return b; },
      abortSignal() { return b; },
      then(res, rej) { return Promise.resolve().then(() => runQuery(q)).then(res, rej); },
    };
    return b;
  }

  return { from, rpc, ensureEntitlement, claimGame, settleGame, accountState };
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
 *            client_reference_id, customer_details, payment_status, interval, priceId, lookupKey }
 *          (lookupKey, on a subscription or a session, is rendered as the price's lookup_key)
 */
function render(kind, o, version) {
  const basil = version !== '2023-10-16';
  if (kind === 'subscription') {
    const item = {
      id: `si_${o.id.slice(4)}`, object: 'subscription_item',
      price: { id: o.priceId || `price_${o.interval || 'month'}`, object: 'price', ...(o.lookupKey ? { lookup_key: o.lookupKey } : {}), recurring: { interval: o.interval || 'month', interval_count: 1 } },
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
      customer_details: o.customer_details || null, payment_status: o.payment_status || 'paid',
      ...(o.created ? { created: o.created } : {}) };
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
          const price = { id: x.priceId || 'price_unknown', object: 'price', ...(x.lookupKey ? { lookup_key: x.lookupKey } : {}) };
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
  ACCOUNT_TABLES, ACCOUNT_FUNCTIONS, entitlementPeriod, addMonthsUTC,
  STALE_MS, MATCH_READS_COUNTED, REFUND_CAP, REFERRAL_BONUS, REFERRAL_MAX_EARNED,
  SERVER: path.join(__dirname, '..', '..', 'server'),
};
