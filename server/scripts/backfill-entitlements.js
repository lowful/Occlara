'use strict';

/**
 * ONE ENTITLEMENT PER LICENCE HOLDER, BY THE PAYER RULES.
 *
 * Occlara 8.7 counts games against an account (entitlements, the site's
 * migration 20261104000000_accounts_tiers_referral.sql). Every user who holds a
 * licence gets the row now, so a payer's tier is right before they ever sign in:
 *
 *   weekly, monthly  Pro, 25 games a month, at their price until they cancel
 *   yearly           Max, 70 a month until renewal, then renews as Pro yearly
 *   lifetime         Max, 70 a month, for life
 *   none live        Free, 3 games; none at all after a refund or a dispute
 *
 * A licence is live when it is active, or payment_failed in its grace, and its
 * expiry has not passed. The best live one decides (lifetime, then yearly, then
 * monthly, then weekly, newest first), its key becomes the account key and its
 * start the period anchor. mapLicences below is the same rule as the SQL
 * function ensure_entitlement, and the fake database the server tests run on
 * (scripts/fixtures/fake-billing.js) uses this very function.
 *
 * A DRY RUN BY DEFAULT: it writes nothing and prints every row it would create.
 * `--apply` creates them, each through ensure_entitlement (so the database's own
 * rule writes them), each call's error checked: any failure is listed and the
 * script exits 1. Idempotent: a user who already has an entitlement is left as
 * it is (the webhook and the games played have moved it on since), and one that
 * differs from the rule is listed for a human.
 *
 * Keys are never printed whole.
 *
 * Run from server/:  node scripts/backfill-entitlements.js [--apply]
 */

const PAID = ['weekly', 'monthly', 'yearly', 'lifetime'];
const RANK = { lifetime: 4, yearly: 3, monthly: 2, weekly: 1 };

const ms = (t) => (t == null ? null : Date.parse(t));

function isLive(l, now) {
  if (!l || !PAID.includes(l.plan)) return false;
  if (l.status !== 'active' && l.status !== 'payment_failed') return false;
  return l.expires_at == null || ms(l.expires_at) > now;
}

/**
 * The entitlement a user's licences give them, as ensure_entitlement makes it.
 * Returns the row's fields, plus `mintFree: true` when the user has no licence
 * at all (ensure_entitlement then mints a key with a 'free' licence) and
 * `licence`, the licence the row follows (or null).
 */
function mapLicences(licences, now = Date.now()) {
  const list = (licences || []).slice();
  const revoked = list.some((l) => l.status === 'refunded' || l.status === 'disputed');
  const live = list.filter((l) => isLive(l, now))
    .sort((a, b) => (RANK[b.plan] - RANK[a.plan]) || (ms(b.created_at) - ms(a.created_at)));
  const best = live[0];
  if (best) {
    const max = best.plan === 'yearly' || best.plan === 'lifetime';
    return {
      tier: max ? 'max' : 'pro',
      cap_monthly: max ? 70 : 25,
      free_total: revoked ? 0 : 3,
      source: `legacy_${best.plan}`,
      stripe_subscription_id: best.stripe_subscription_id || null,
      period_anchor: best.created_at || null,
      status: 'active',
      renew_as: best.plan === 'yearly' ? 'pro_yearly' : null,
      account_key: best.license_key,
      mintFree: false,
      licence: best,
    };
  }
  const anyLic = list.slice().sort((a, b) => {
    const fa = a.plan === 'free' && a.status === 'active' ? 1 : 0;
    const fb = b.plan === 'free' && b.status === 'active' ? 1 : 0;
    return (fb - fa) || (ms(b.created_at) - ms(a.created_at));
  })[0];
  return {
    tier: 'free',
    cap_monthly: 0,
    free_total: revoked ? 0 : 3,
    source: 'free',
    stripe_subscription_id: null,
    period_anchor: null, // ensure_entitlement writes now()
    status: revoked ? 'ended' : 'active',
    renew_as: null,
    account_key: anyLic ? anyLic.license_key : null,
    mintFree: !anyLic,
    licence: anyLic || null,
  };
}

/** The fields of an existing entitlement that differ from the rule. */
function differences(row, want) {
  const out = [];
  for (const f of ['tier', 'cap_monthly', 'source', 'renew_as', 'account_key']) {
    if ((row[f] ?? null) !== (want[f] ?? null)) out.push(f);
  }
  return out;
}

const mask = (k) => (k ? `${String(k).slice(0, 8)}****` : '(new key)');
const notLive = (error) => !!error && (error.code === '42P01' || error.code === 'PGRST205' || error.code === 'PGRST202');

async function readAll(supabase, table, cols) {
  const out = [];
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase.from(table).select(cols).order('created_at', { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw Object.assign(new Error(`${table}: ${error.code} ${error.message}`), { pg: error });
    out.push(...(data || []));
    if (!data || data.length < PAGE) return out;
  }
}

/**
 * The backfill itself, given a supabase-js client. Returns
 * { planned: [...], existing, differing: [...], created: [...], failed: [...] }.
 */
async function backfill(supabase, { apply = false, now = Date.now(), log = console.log } = {}) {
  let licences;
  let ents;
  try {
    licences = await readAll(supabase, 'licenses',
      'user_id, license_key, plan, status, expires_at, stripe_subscription_id, created_at');
    ents = await readAll(supabase, 'entitlements', 'user_id, tier, cap_monthly, source, renew_as, account_key, created_at');
  } catch (e) {
    if (e.pg && notLive(e.pg)) {
      throw new Error('the entitlements table does not exist: apply 20261104000000_accounts_tiers_referral.sql first');
    }
    throw e;
  }

  const byUser = new Map();
  for (const l of licences) {
    if (!byUser.has(l.user_id)) byUser.set(l.user_id, []);
    byUser.get(l.user_id).push(l);
  }
  const have = new Map(ents.map((e) => [e.user_id, e]));

  const result = { planned: [], existing: 0, differing: [], created: [], failed: [] };
  for (const [userId, list] of byUser) {
    const want = mapLicences(list, now);
    const row = have.get(userId);
    if (row) {
      result.existing++;
      const diff = differences(row, want);
      if (diff.length) {
        result.differing.push({ userId, fields: diff });
        log(`differs  ${userId}  has ${row.tier}/${row.source}, the rule says ${want.tier}/${want.source} (${diff.join(', ')}), left as it is`);
      }
      continue;
    }
    result.planned.push({ userId, ...want, licence: undefined });
    log(`${apply ? 'create' : 'would create'}  ${userId}  ${want.tier} cap ${want.cap_monthly} free ${want.free_total}`
      + `  ${want.source}${want.renew_as ? ` renews as ${want.renew_as}` : ''}  key ${mask(want.account_key)}`);
    if (!apply) continue;
    const { data, error } = await supabase.rpc('ensure_entitlement', { p_user: userId });
    if (error) {
      result.failed.push({ userId, code: error.code, message: error.message });
      log(`FAILED   ${userId}  ${error.code} ${error.message}`);
      continue;
    }
    result.created.push(userId);
    const diff = data ? differences(data, want) : [];
    if (diff.length) log(`warning  ${userId}  ensure_entitlement wrote ${data.tier}/${data.source}, this script expected ${want.tier}/${want.source}`);
  }

  log('');
  log(`${byUser.size} licence holders, ${result.existing} already have an entitlement`
    + ` (${result.differing.length} differ from the rule), ${result.planned.length} ${apply ? 'to create' : 'would be created'}`);
  if (apply) log(`${result.created.length} created, ${result.failed.length} failed`);
  else if (result.planned.length) log('A dry run: nothing was written. Run with --apply to create them.');
  return result;
}

async function main() {
  const apply = process.argv.includes('--apply');
  try { require('dotenv').config(); } catch (_) { /* env from the host */ }
  const supabase = require('../db/supabase');
  const result = await backfill(supabase, { apply });
  if (result.failed.length) process.exit(1);
}

if (require.main === module) {
  main().catch((e) => { console.error(`[backfill-entitlements] ${e.message}`); process.exit(1); });
}

module.exports = { mapLicences, isLive, differences, backfill };
