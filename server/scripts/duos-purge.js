'use strict';

/**
 * EVERY DUO CLIP OUT OF THE BUCKET, before social-002-duos-undo.sql
 * (docs/claude/duos.md, "Taking it away").
 *
 * Deleting rows in SQL never deletes a file in Supabase Storage, so the undo
 * alone would leave every stored clip in the duo-clips bucket with no row to
 * find it by. This removes them through the Storage API, twice over: every
 * path the database knows (social_duo_all_paths: the clips and the trash),
 * then every file the bucket itself lists, folder by folder, so nothing a row
 * lost is left either.
 *
 * A DRY RUN BY DEFAULT: it removes nothing and prints how many files it
 * found. `--apply` removes them, 100 at a time, each call's error checked:
 * any failure is said and the script exits 1. Paths are never printed.
 *
 * Run from server/, with the server's environment:  node scripts/duos-purge.js [--apply]
 */

const BUCKET = 'duo-clips';

/** Every file under a folder of the bucket, walked down (a folder lists with no id). */
async function walk(bucket, folder, out, depth = 0) {
  if (depth > 6) return;
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await bucket.list(folder, { limit: 1000, offset });
    if (error) throw new Error(`list failed: ${error.message || error.statusCode}`);
    const rows = Array.isArray(data) ? data : [];
    for (const o of rows) {
      if (!o || !o.name) continue;
      const p = folder ? `${folder}/${o.name}` : o.name;
      if (o.id === null || o.id === undefined) await walk(bucket, p, out, depth + 1);
      else out.add(p);
    }
    if (rows.length < 1000) break;
  }
}

async function purge(supabase, { apply = false, log = console.log } = {}) {
  const paths = new Set();
  // Every path the rows know.
  let after = null;
  for (;;) {
    const { data, error } = await supabase.rpc('social_duo_all_paths', { p_limit: 1000, p_after: after });
    if (error) {
      if (/does not exist|PGRST202|42883/.test(`${error.code} ${error.message}`)) { log('[duos-purge] the duo tables are not there: only the bucket is walked'); break; }
      throw new Error(`social_duo_all_paths failed: ${error.message || error.code}`);
    }
    const list = Array.isArray(data) ? data : [];
    for (const p of list) if (typeof p === 'string') paths.add(p);
    if (list.length < 1000) break;
    after = list[list.length - 1];
  }
  const known = paths.size;
  // Every file the bucket lists.
  const bucket = supabase.storage.from(BUCKET);
  try { await walk(bucket, '', paths); } catch (e) {
    if (/bucket not found/i.test(e.message)) log('[duos-purge] there is no duo-clips bucket');
    else throw e;
  }
  log(`[duos-purge] ${paths.size} file path${paths.size === 1 ? '' : 's'} (${known} known to the database)${apply ? ', removing' : ', a dry run: nothing removed (--apply removes them)'}`);
  if (!apply) return { found: paths.size, removed: 0 };
  const all = [...paths];
  let removed = 0;
  for (let i = 0; i < all.length; i += 100) {
    const part = all.slice(i, i + 100);
    const { error } = await bucket.remove(part);
    if (error) throw new Error(`remove failed: ${error.message || error.statusCode}`);
    removed += part.length;
  }
  log(`[duos-purge] removed ${removed}. The bucket can now be deleted in the dashboard, then run social-002-duos-undo.sql.`);
  return { found: paths.size, removed };
}

if (require.main === module) {
  const supabase = require('../db/supabase');
  purge(supabase, { apply: process.argv.includes('--apply') })
    .then(() => process.exit(0))
    .catch((e) => { console.error('[duos-purge] failed:', e.message); process.exit(1); });
}

module.exports = { purge, BUCKET };
