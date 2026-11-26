'use strict';

/**
 * THE PUBLIC PROFILE'S SQL ITSELF (docs/sql/social-001-profiles.sql), on a
 * real Postgres (PGlite) with what Supabase gives every project, Supabase's
 * default privileges included (anon and authenticated granted ALL on what the
 * migration creates, before its revokes):
 *   - it runs twice, and the undo twice, and again;
 *   - every table: RLS on, no policy, nothing for anon or authenticated;
 *     every function: no EXECUTE for anon or authenticated, EXECUTE for the
 *     service role, and every function the migration makes is in the grant
 *     loop (compared with pg_proc);
 *   - private invisible; a blocked pair invisible both ways; search's
 *     minimums, its 10, LIKE escaping; usernames unique under two sets at
 *     once; the holds (no user id kept after deletion, gone after 30 days);
 *     the challenge tables and the takeover; the cascade on deletion;
 *   - and that these cases CATCH a broken SQL: a copy with is_public or the
 *     block clause taken out of the view or the search fails them.
 *
 * Run: npm run test:socialsql
 */

const fs = require('fs');
const pg = require('./fixtures/pglite-social');

let fails = 0;
let checks = 0;
const ok = (cond, what, extra) => {
  checks++;
  if (!cond) { fails++; console.log(`FAIL  ${what}${extra !== undefined ? `  ${JSON.stringify(extra)}` : ''}`); } else console.log(`ok    ${what}`);
};
const U = (n) => `${String(n).padStart(8, '0')}-0000-4000-8000-000000000000`;
const H = (c) => c.repeat(64);

/** The privacy cases, on a database: true when every one holds (quiet), for the mutation runs. */
async function privacy(db, say) {
  const tell = say || (() => {});
  const r = (n, a) => pg.rpc(db, n, a);
  let all = true;
  const t = (cond, what) => { if (!cond) all = false; tell(cond, what); };
  for (let i = 1; i <= 8; i++) await pg.addUser(db, U(i));
  const set = (u, n) => r('social_set_username', { p_user: U(u), p_username: n, p_key: n.toLowerCase(), p_fold: n.toLowerCase(), p_change_days: 30, p_hold_days: 30 });
  await set(1, 'Alder'); await set(2, 'Alder_two'); await set(3, 'Birch'); await set(4, 'a_b_c');
  for (const u of [1, 2, 4]) await r('social_set_flags', { p_user: U(u), p_public: true, p_show_riot_id: null, p_discoverable: null });
  const view = (v, k) => r('social_view', { p_viewer: U(v), p_key: k, p_rank_ms: 21600000 });
  const search = (v, mode, key) => r('social_search', { p_viewer: U(v), p_mode: mode, p_key: key, p_limit: 50 });
  t(await view(2, 'birch') === null, 'a private profile is no profile to others');
  t((await search(2, 'name', 'bir')).length === 0, 'and is not found by search');
  t((await view(3, 'birch')).self === true, 'its owner sees it');
  await r('social_block', { p_user: U(1), p_key: 'alder_two', p_name: 'Alder_two', p_on: true, p_max: 500 });
  t(await view(1, 'alder_two') === null && await view(2, 'alder') === null, 'a blocked pair cannot open each other, both ways');
  t((await search(1, 'name', 'ald')).every((x) => x.username !== 'Alder_two') && (await search(2, 'name', 'ald')).every((x) => x.username !== 'Alder'),
    'nor find each other, both ways');
  t((await search(5, 'name', 'ald')).length === 2, 'a third player finds both');
  t((await search(5, 'name', 'al')).length === 0, 'two characters find nothing');
  t((await search(5, 'name', 'a_b')).map((x) => x.username).join() === 'a_b_c' && (await search(5, 'name', 'a%b')).length === 0
    && (await search(5, 'name', 'a\\b')).length === 0, 'an underscore, a percent and a backslash are matched literally');
  return all;
}

(async () => {
  const sqlText = fs.readFileSync(pg.SQL_FILE, 'utf8');
  const undo = fs.readFileSync(pg.UNDO_FILE, 'utf8');
  const db = await pg.makeDb();
  ok(true, 'the migration runs twice on Postgres, over Supabase\'s default privileges');
  const q = async (s, p) => (await db.query(s, p)).rows;

  // Privileges.
  const tables = await q("SELECT c.relname, c.relrowsecurity rls, has_table_privilege('anon', c.oid, 'SELECT,INSERT,UPDATE,DELETE') a, has_table_privilege('authenticated', c.oid, 'SELECT,INSERT,UPDATE,DELETE') au, has_table_privilege('service_role', c.oid, 'SELECT') s FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relname LIKE 'social\\_%' AND c.relkind = 'r'");
  ok(tables.length === 6 && tables.every((x) => x.rls && !x.a && !x.au && x.s), 'every table: RLS on, nothing for anon or authenticated, the service role reads', tables);
  ok((await q("SELECT count(*)::int n FROM pg_policies WHERE tablename LIKE 'social\\_%'"))[0].n === 0, 'and no policy at all');
  const fns = await q("SELECT p.proname, has_function_privilege('anon', p.oid, 'EXECUTE') a, has_function_privilege('authenticated', p.oid, 'EXECUTE') au, has_function_privilege('service_role', p.oid, 'EXECUTE') s FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname LIKE 'social\\_%'");
  const declared = [...sqlText.matchAll(/CREATE OR REPLACE FUNCTION public\.(social_[a-z_]+)\(/g)].map((m) => m[1]);
  ok(fns.length === declared.length && declared.every((f) => fns.some((x) => x.proname === f)), 'every function the migration declares exists, and no other', [fns.length, declared.length]);
  // The grant block and the undo name each created function, by signature, and nothing else.
  const grantList = [...sqlText.slice(sqlText.indexOf('DO $grants$')).matchAll(/'public\.(social_[a-z_]+)\(/g)].map((m) => m[1]);
  const undoList = [...undo.matchAll(/DROP FUNCTION IF EXISTS public\.(social_[a-z_]+)\(/g)].map((m) => m[1]);
  const same = (x) => x.length === declared.length && declared.every((f) => x.includes(f));
  ok(same(grantList) && same(undoList) && !/LIKE 'social/.test(sqlText.replace(/--[^\n]*/g, '')) && !/LIKE 'social/.test(undo), 'the grant block and the undo list exactly the functions the migration creates, no pattern', [grantList.length, undoList.length, declared.length]);
  ok(fns.every((x) => !x.a && !x.au && x.s), 'every function: no EXECUTE for anon or authenticated, EXECUTE for the service role (the grant loop missed none)', fns.filter((x) => x.a || x.au || !x.s));
  for (const role of ['anon', 'authenticated']) {
    await db.exec(`SET ROLE ${role}`);
    let refusedT = 0;
    for (const tb of tables) { try { await db.query(`SELECT * FROM public.${tb.relname}`); } catch { refusedT++; } }
    await db.exec('RESET ROLE');
    const callable = await q("SELECT p.proname, p.pronargs FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname LIKE 'social\\_%' AND p.prorettype <> 'trigger'::regtype");
    await db.exec(`SET ROLE ${role}`);
    let refusedF = 0;
    for (const f of callable) {
      try { await db.query(`SELECT public.${f.proname}(${Array.from({ length: f.pronargs }, () => 'NULL').join(', ')})`); } catch (e) { if (/permission denied/.test(e.message)) refusedF++; }
    }
    await db.exec('RESET ROLE');
    ok(refusedT === tables.length, `${role} cannot read any table`);
    ok(callable.length === declared.length - 1 && refusedF === callable.length, `${role} is refused every function it could call`, [refusedF, callable.length]);
  }

  // The privacy cases, on the real SQL.
  ok(await privacy(db, (c, w) => ok(c, w)), 'the privacy cases hold on the migration as written');

  // They catch a broken SQL.
  const mutants = {
    'is_public taken out of the view': sqlText.replace('AND (p.is_public OR p.user_id = p_viewer)', ''),
    'the block clause taken out of the view': sqlText.replace(/(social_view[\s\S]*?)AND NOT EXISTS \(SELECT 1 FROM public\.social_blocks b[\s\S]*?\);\n\$function\$;/, '$1;\n$function$;'),
    'is_public taken out of the search': sqlText.replace('WHERE p.is_public AND p.username IS NOT NULL', 'WHERE p.username IS NOT NULL'),
    'the block clause taken out of the search': sqlText.replace(/(ELSE false END\n)\s+AND NOT EXISTS \(SELECT 1 FROM public\.social_blocks b\n[^\n]*\n/, '$1'),
  };
  for (const [what, text] of Object.entries(mutants)) {
    ok(text !== sqlText, `the mutation "${what}" changes the SQL`);
    const m = await pg.makeDb({ sql: text });
    ok(!(await privacy(m)), `and the privacy cases fail on it: ${what}`);
  }

  // Usernames: unique under two sets at once, by fold too, the holds.
  const r = (n, a) => pg.rpc(db, n, a);
  const setName = (u, name, fold) => r('social_set_username', { p_user: U(u), p_username: name, p_key: name.toLowerCase(), p_fold: fold || name.toLowerCase(), p_change_days: 30, p_hold_days: 30 });
  for (let i = 10; i <= 40; i++) await pg.addUser(db, U(i));
  const both = await Promise.all([10, 11].map((u) => setName(u, 'Twin')));
  ok(both.filter((x) => x.ok).length === 1 && both.some((x) => x.reason === 'taken'), 'two accounts setting one name at once: one gets it', both);
  ok((await q("SELECT count(*)::int n FROM public.social_profiles WHERE username_key = 'twin'"))[0].n === 1, 'and the table holds it once');
  await setName(16, 'Kestrel', 'kestrei');
  ok((await setName(17, 'KestreI', 'kestrei')).reason === 'taken' && (await setName(17, 'Kestre1', 'kestrei')).reason === 'taken', 'a name whose fold is taken is taken');
  let foldDup = false;
  try { await db.query("UPDATE public.social_profiles SET username = 'KestreX', username_key = 'kestrex', username_fold = 'kestrei' WHERE user_id = $1", [U(10)]); } catch (e) { foldDup = /unique/i.test(e.message); }
  ok(foldDup, 'the fold is unique by its index too');
  await setName(12, 'Leaving');
  await db.query('DELETE FROM auth.users WHERE id = $1', [U(12)]);
  const hold = await q("SELECT user_id FROM public.social_username_holds WHERE username_fold = 'leaving'");
  ok(hold.length === 1 && hold[0].user_id === null, 'a deleted account: its profile cascades away, its name held with no user id');
  ok((await setName(13, 'Leaving')).reason === 'held', 'and held from everyone');
  await db.query("UPDATE public.social_username_holds SET released_at = now() - interval '31 days'");
  ok((await setName(13, 'Leaving')).ok, 'after 30 days it is free');
  ok((await q("SELECT count(*)::int n FROM public.social_username_holds WHERE released_at < now() - interval '30 days'"))[0].n === 0, 'and the old holds were deleted on that write');

  // The proof of control's tables.
  for (const u of [14, 15, 18, 19, 20, 21]) await setName(u, `Prover_${u}`);
  const CAND = ['Sage,Jett,Sova', 'Jett,Sage,Sova'];
  const start = (u, cand = CAND, hash = H('a')) => r('social_challenge_start', { p_user: U(u), p_hash: hash, p_name: 'Nightjar', p_tag: 'EUW', p_region: 'eu',
    p_candidates: cand, p_seed: 's', p_ttl_ms: 14400000 });
  const c14 = await start(14);
  ok(c14.ok && c14.challenge.agents.length === 3 && !('user_id' in c14.challenge) && !('puuid_hash' in c14.challenge), 'a challenge of three agents, never answered with its user or hash');
  const c18 = await start(18);
  ok(c18.ok && c18.challenge.seq !== c14.challenge.seq, 'a second challenge on the same Riot account takes the other sequence');
  const c19 = await start(19);
  ok(c19.ok === false && c19.reason === 'busy', 'with every candidate held open on that Riot account: busy (said as try later)');
  let seqDup = false;
  try { await db.query("INSERT INTO public.social_riot_challenges (user_id, puuid_hash, riot_name, riot_tag, riot_region, agents, seq, expires_at) VALUES ($1, $2, 'X', 'Y', 'eu', $3, $4, now() + interval '1 hour')",
    [U(19), H('a'), c14.challenge.agents, c14.challenge.seq]); } catch (e) { seqDup = /unique/i.test(e.message); }
  ok(seqDup, 'and the index refuses one sequence twice open on one Riot account');
  const race = await Promise.all([20, 21].map((u) => start(u, ['Brimstone,Phoenix,Sage'], H('b'))));
  ok(race.filter((x) => x.ok).length === 1 && race.some((x) => x.reason === 'busy'), 'two starts at once with one sequence left: one gets it', race.map((x) => x.reason));
  // Passes: the window, the matches used once, two at once, the takeover.
  const n14 = await r('social_challenge_note_check', { p_user: U(14), p_gap_ms: 60000, p_max: 30 });
  const t = (min) => new Date(Date.now() + min * 60000).toISOString();
  ok((await r('social_challenge_pass', { p_user: U(14), p_id: n14.challenge.id, p_name: 'Nightjar', p_tag: 'EUW', p_key: 'nightjar#euw', p_first: t(-60), p_last: t(1) })).reason === 'window',
    'matches from before the challenge: refused');
  ok((await r('social_challenge_pass', { p_user: U(14), p_id: n14.challenge.id, p_name: 'Nightjar', p_tag: 'EUW', p_key: 'nightjar#euw', p_first: t(1), p_last: t(3) })).ok, 'a pass verifies');
  const twice = await Promise.all([
    r('social_challenge_pass', { p_user: U(18), p_id: c18.challenge.id, p_name: 'Nightjar', p_tag: 'EUW', p_key: 'nightjar#euw', p_first: t(2), p_last: t(4) }),
    r('social_challenge_pass', { p_user: U(18), p_id: c18.challenge.id, p_name: 'Nightjar', p_tag: 'EUW', p_key: 'nightjar#euw', p_first: t(2), p_last: t(4) }),
  ]);
  ok(twice.every((x) => x && x.ok === false && x.reason === 'used'), 'matches a proof used (or overlapping them) never pass again, two at once included, no error', twice);
  ok((await r('social_challenge_pass', { p_user: U(18), p_id: c18.challenge.id, p_name: 'Nightjar', p_tag: 'EUW', p_key: 'nightjar#euw', p_first: t(10), p_last: t(12) })).ok,
    'newer matches pass');
  const rows = await q('SELECT user_id, riot_verified, riot_lost_reason FROM public.social_profiles WHERE user_id IN ($1, $2) ORDER BY user_id', [U(14), U(18)]);
  ok(rows[0].riot_verified === false && rows[0].riot_lost_reason === 'takeover' && rows[1].riot_verified === true, 'and takes it over: the older profile loses it, told why, no lockout', rows);
  // Attempts: counted before Riot is asked, two a day.
  const att = [];
  for (let k = 0; k < 3; k++) att.push(await r('social_challenge_attempt', { p_user: U(15), p_day: 2, p_month: 6 }));
  ok(att[0].reason === null && att[1].reason === null && att[2].reason === 'day' && (await q('SELECT count(*)::int n FROM public.social_riot_attempts WHERE user_id = $1', [U(15)]))[0].n === 2,
    'every attempt counted, the third in a day refused and not counted');
  await db.query('DELETE FROM auth.users WHERE id = $1', [U(18)]);
  ok((await q('SELECT count(*)::int n FROM public.social_riot_challenges WHERE user_id = $1', [U(18)]))[0].n === 0, 'a deleted account takes its challenges with it');

  // Idempotent with data in it; the undo; again.
  await db.exec(fs.readFileSync(pg.SQL_FILE, 'utf8'));
  ok((await q('SELECT count(*)::int n FROM public.social_profiles'))[0].n > 0, 'a third run keeps every row');
  await db.exec(undo);
  await db.exec(undo);
  ok((await q("SELECT count(*)::int n FROM pg_proc WHERE proname LIKE 'social\\_%'"))[0].n === 0 && (await q("SELECT to_regclass('public.social_profiles')::text t"))[0].t === null,
    'the undo takes every table and function away, twice');
  await db.exec(fs.readFileSync(pg.SQL_FILE, 'utf8'));
  ok((await pg.rpc(db, 'social_status', {})) === true, 'and the migration runs again after it');

  console.log(`\n${checks - fails}/${checks} checks passed`);
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
