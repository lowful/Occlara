'use strict';

/**
 * THE KEYS OF EVERY ACCOUNT THAT PLAYED A FREE GAME BEFORE 8.8.
 *
 * Free games are one per player from 8.8 (server/services/free-allowance.js,
 * free-allowance.sql): an account whose keys meet an account that played its
 * free games first gets none. The server notes an account's keys whenever it
 * is seen, so an account made and spent before 8.8 that never comes back
 * would have no keys, and the second account of its player would still get
 * free games. This notes them once, from what the database already holds:
 *
 *   email    auth.users, canonical (gmail dots and plus tags dropped)
 *   device   every device_hash its games and its app sessions carry
 *   net      the networks its app sessions signed in from (weak, never alone)
 *
 * Every key is made exactly as the server makes it, with ACCOUNT_HASH_SALT,
 * so this MUST run with the server's own salt (Railway's value, or unset if
 * Railway has none), or the keys meet nothing. Unset, it says so.
 *
 * A DRY RUN BY DEFAULT: prints how many accounts and keys it would note, never
 * an email or a key. `--apply` writes them through free_allowance_note, each
 * call's error checked; any failure is listed and the script exits 1.
 * Idempotent: a key already noted only moves its last_seen.
 *
 * Run from server/:  node scripts/backfill-free-keys.js [--apply]
 */

const { keysFor } = require('../services/free-allowance');

const PAGE = 1000;
const notLive = (error) => !!error && ['42P01', 'PGRST205', 'PGRST202', '42883'].includes(String(error.code || ''));

async function readAll(supabase, table, cols, filter) {
  const out = [];
  for (let from = 0; ; from += PAGE) {
    let q = supabase.from(table).select(cols);
    if (filter) q = filter(q);
    const { data, error } = await q.order('created_at', { ascending: true }).range(from, from + PAGE - 1);
    if (error) throw Object.assign(new Error(`${table}: ${error.code} ${error.message}`), { pg: error });
    out.push(...(data || []));
    if (!data || data.length < PAGE) return out;
  }
}

/**
 * Given a supabase-js client: { accounts, keys, noted: [...], failed: [...] }.
 */
async function backfill(supabase, { apply = false, env = process.env, log = console.log } = {}) {
  if (!String(env.ACCOUNT_HASH_SALT || '').trim()) {
    log('warning  ACCOUNT_HASH_SALT is not set here: the keys use the default salt, which meets the server\'s only if Railway has none set either.');
  }
  let free;
  let sessions;
  try {
    free = await readAll(supabase, 'game_usage', 'user_id,device_hash,source,status,created_at',
      (q) => q.eq('source', 'free').in('status', ['reserved', 'counted']));
    sessions = await readAll(supabase, 'app_sessions', 'user_id,device_hash,ip_prefix_hash,created_at');
  } catch (e) {
    if (e.pg && notLive(e.pg)) throw new Error('the accounts tables do not exist yet: apply the accounts migration first');
    throw e;
  }

  const users = new Map();   // user id -> { devices: Set, nets: Set }
  const of = (id) => {
    if (!users.has(id)) users.set(id, { devices: new Set(), nets: new Set() });
    return users.get(id);
  };
  for (const g of free) {
    if (!g.user_id) continue;
    const u = of(g.user_id);
    if (g.device_hash) u.devices.add(g.device_hash);
  }
  for (const s of sessions) {
    if (!s.user_id || !users.has(s.user_id)) continue;
    const u = users.get(s.user_id);
    if (s.device_hash) u.devices.add(s.device_hash);
    if (s.ip_prefix_hash) u.nets.add(s.ip_prefix_hash);
  }

  const result = { accounts: users.size, keys: 0, noted: [], failed: [] };
  for (const [userId, u] of users) {
    let email = null;
    try {
      const { data, error } = await supabase.auth.admin.getUserById(userId);
      if (!error) email = (data && data.user && data.user.email) || null;
    } catch { /* noted without its email */ }
    // One call per batch of keys: free_allowance_note reads at most 8.
    const all = [];
    const add = (parts) => { for (const k of keysFor(parts, env)) if (!all.some((x) => x.key === k.key)) all.push(k); };
    add({ email });
    for (const d of u.devices) add({ deviceHash: d });
    for (const n of u.nets) add({ netHash: n });
    result.keys += all.length;
    log(`${apply ? 'note' : 'would note'}  ${userId}  ${all.length} keys (${all.map((k) => k.kind).join(', ') || 'none'})`);
    if (!apply || !all.length) continue;
    let failed = null;
    for (let i = 0; i < all.length; i += 8) {
      const { error } = await supabase.rpc('free_allowance_note', { p_user: userId, p_keys: all.slice(i, i + 8) });
      if (error) { failed = error; break; }
    }
    if (failed) {
      result.failed.push({ userId, code: failed.code, message: failed.message });
      log(`FAILED   ${userId}  ${failed.code} ${failed.message}`);
      if (notLive(failed)) throw new Error('free_allowance_note does not exist: apply free-allowance.sql first');
      continue;
    }
    result.noted.push(userId);
  }
  log('');
  log(`${result.accounts} accounts played a free game, ${result.keys} keys ${apply ? 'noted' : 'would be noted'}`);
  if (apply) log(`${result.noted.length} noted, ${result.failed.length} failed`);
  else if (result.accounts) log('A dry run: nothing was written. Run with --apply (and the server\'s ACCOUNT_HASH_SALT) to note them.');
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
  main().catch((e) => { console.error(`[backfill-free-keys] ${e.message}`); process.exit(1); });
}

module.exports = { backfill };
