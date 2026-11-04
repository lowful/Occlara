'use strict';

/**
 * THE 8.7 ACCOUNTS TABLES BESIDE fake-billing.js's LICENCES TABLE, for the
 * billing tests.
 *
 * fake-billing.js knows the licences table only, and its from() throws for
 * any other: a real supabase-js never throws, it answers PostgREST's error.
 * So a billing test wraps its fake in one of these two:
 *
 *   notLive(sb)       the migration is not applied: every other table answers
 *                     PGRST205 and every SQL function PGRST202, as PostgREST
 *                     answers a relation or function its schema cache lacks.
 *                     The 8.6 billing tests run through this, which is what
 *                     holds "the server works as today without the tables".
 *   withAccounts(sb)  the entitlements table and ensure_entitlement() as the
 *                     contract defines them: the tier, status and source
 *                     CHECKs (23514), account_key UNIQUE (23505), a column the
 *                     table lacks (PGRST204), ensure_entitlement's foreign key
 *                     to auth.users (23503, 22P02), and writes that can be made
 *                     to fail.
 *
 * Everything for the licences table goes to the wrapped fake untouched, and
 * its reset() and _db stay reachable. When fake-billing.js models these tables
 * itself, this file can go.
 */

const path = require('path');
const { FREE_GAMES } = require(path.join(__dirname, '..', '..', 'server', 'services', 'caller.js'));

const clone = (o) => JSON.parse(JSON.stringify(o));
const pgError = (code, message, details = null) => ({ code, message, details, hint: null });
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const ENTITLEMENT_COLUMNS = ['user_id', 'tier', 'cap_monthly', 'free_total', 'bonus_pool', 'bonus_earned', 'source',
  'stripe_subscription_id', 'period_anchor', 'status', 'renew_as', 'account_key', 'created_at', 'updated_at'];
const TIERS = ['free', 'pro', 'max'];
const STATUSES = ['active', 'ended'];
const SOURCES = ['free', 'stripe', 'legacy_weekly', 'legacy_monthly', 'legacy_yearly', 'legacy_lifetime', 'comp'];

/** A query builder of any shape that answers one error when awaited. */
function refusing(error) {
  const b = new Proxy({}, {
    get(_, prop) {
      if (prop === 'then') return (res, rej) => Promise.resolve({ data: null, error }).then(res, rej);
      return () => b;
    },
  });
  return b;
}

const missingTable = (t) => pgError('PGRST205', `Could not find the table 'public.${t}' in the schema cache`);
const missingFunction = (f) => pgError('PGRST202', `Could not find the function public.${f} without parameters in the schema cache`);

function passthrough(sb, from, rpc) {
  const out = Object.create(sb);
  out.from = from;
  out.rpc = rpc;
  return out;
}

function notLive(sb) {
  return passthrough(sb,
    (t) => (t === 'licenses' ? sb.from(t) : refusing(missingTable(t))),
    async (f) => ({ data: null, error: missingFunction(f) }));
}

function withAccounts(sb, opts = {}) {
  const acc = {
    rows: (opts.rows || []).map((r) => ({ ...blank(r.user_id), ...clone(r) })),
    writes: [], ensures: [],
    authUsers: opts.authUsers ? new Set(opts.authUsers) : null,
    failWrites: null,       // a pg error code every entitlements write answers, or null
    failEnsure: null,       // the same for ensure_entitlement
  };
  let keys = 0;
  function blank(userId) {
    keys++;
    return {
      user_id: userId, tier: 'free', cap_monthly: null, free_total: FREE_GAMES, bonus_pool: 0, bonus_earned: 0, source: 'free',
      stripe_subscription_id: null, period_anchor: null, status: 'active', renew_as: null,
      account_key: `GC-ACCT-${String(keys).padStart(4, '0')}-0000-0000`,
      created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    };
  }
  function check(row) {
    if (!TIERS.includes(row.tier)) return pgError('23514', 'new row for relation "entitlements" violates check constraint "entitlements_tier_check"');
    if (!STATUSES.includes(row.status)) return pgError('23514', 'new row for relation "entitlements" violates check constraint "entitlements_status_check"');
    if (row.source != null && !SOURCES.includes(row.source)) return pgError('23514', 'new row for relation "entitlements" violates check constraint "entitlements_source_check"');
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
        if (f[2] === 'is') return v !== f[3];
        if (f[2] !== 'in') throw new Error(`fake-accounts supports not(col, 'is' | 'in', ...) only, got ${f[2]}`);
        const list = String(f[3]).replace(/^\(|\)$/g, '').split(',').map((s) => s.trim().replace(/^"|"$/g, ''));
        return !list.includes(v);
      }
      throw new Error(`fake-accounts does not support the filter ${op}`);
    });
  }
  function project(row, cols) {
    if (!cols || cols === '*') return clone(row);
    const out = {};
    for (const c of cols.split(',').map((s) => s.trim()).filter(Boolean)) out[c] = row[c] === undefined ? null : clone(row[c]);
    return out;
  }
  function run(q) {
    for (const f of q.filters) if (!ENTITLEMENT_COLUMNS.includes(f[1])) return { data: null, error: pgError('42703', `column entitlements.${f[1]} does not exist`) };
    if (q.op === 'select') {
      return { data: acc.rows.filter((r) => matches(r, q.filters)).map((r) => project(r, q.cols)), error: null };
    }
    if (q.op === 'update') {
      const record = (error, ids) => acc.writes.push({ patch: clone(q.patch), filters: clone(q.filters), ids, error });
      if (acc.failWrites) { const e = pgError(acc.failWrites, 'entitlements write refused'); record(e, []); return { data: null, error: e }; }
      for (const c of Object.keys(q.patch)) {
        if (!ENTITLEMENT_COLUMNS.includes(c)) {
          const e = pgError('PGRST204', `Could not find the '${c}' column of 'entitlements' in the schema cache`);
          record(e, []); return { data: null, error: e };
        }
      }
      const hit = acc.rows.filter((r) => matches(r, q.filters));
      const next = hit.map((r) => ({ ...r, ...clone(q.patch) }));
      for (const n of next) {
        const e = check(n);
        if (e) { record(e, []); return { data: null, error: e }; }
        if (n.account_key && acc.rows.some((r) => r.user_id !== n.user_id && r.account_key === n.account_key)) {
          const dup = pgError('23505', 'duplicate key value violates unique constraint "entitlements_account_key_key"');
          record(dup, []); return { data: null, error: dup };
        }
      }
      hit.forEach((r, i) => Object.assign(r, next[i]));
      record(null, hit.map((r) => r.user_id));
      return { data: q.returning ? hit.map((r) => project(r, q.cols)) : null, error: null };
    }
    throw new Error(`fake-accounts does not support ${q.op}`);
  }
  function entitlements() {
    const q = { op: 'select', cols: '*', patch: null, filters: [], returning: false };
    const b = {
      select(cols) { if (q.op === 'select') q.cols = cols || '*'; else { q.returning = true; q.cols = cols || '*'; } return b; },
      update(patch) { q.op = 'update'; q.patch = patch || {}; return b; },
      eq(c, v) { q.filters.push(['eq', c, v]); return b; },
      neq(c, v) { q.filters.push(['neq', c, v]); return b; },
      in(c, vs) { q.filters.push(['in', c, Array.from(vs)]); return b; },
      is(c, v) { q.filters.push(['is', c, v]); return b; },
      not(c, op, v) { q.filters.push(['not', c, op, v]); return b; },
      limit() { return b; },
      then(res, rej) { return Promise.resolve().then(() => run(q)).then(res, rej); },
    };
    return b;
  }
  async function rpc(name, args = {}) {
    if (name !== 'ensure_entitlement') return { data: null, error: missingFunction(name) };
    acc.ensures.push(args.p_user);
    if (acc.failEnsure) return { data: null, error: pgError(acc.failEnsure, 'ensure_entitlement refused') };
    const user = args.p_user;
    if (!UUID_RE.test(String(user))) return { data: null, error: pgError('22P02', `invalid input syntax for type uuid: "${user}"`) };
    if (acc.authUsers && !acc.authUsers.has(user)) {
      return { data: null, error: pgError('23503', 'insert or update on table "entitlements" violates foreign key constraint "entitlements_user_id_fkey"') };
    }
    let row = acc.rows.find((r) => r.user_id === user);
    if (!row) { row = blank(user); acc.rows.push(row); }
    return { data: clone(row), error: null };
  }
  const out = passthrough(sb, (t) => (t === 'licenses' ? sb.from(t) : t === 'entitlements' ? entitlements() : refusing(missingTable(t))), rpc);
  out.accounts = acc;
  out.entitlementOf = (user) => acc.rows.find((r) => r.user_id === user) || null;
  return out;
}

module.exports = { notLive, withAccounts, missingTable, missingFunction, ENTITLEMENT_COLUMNS };
