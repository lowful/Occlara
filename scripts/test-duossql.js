'use strict';

/**
 * OCCLARA DUOS' SQL ITSELF (docs/sql/social-002-duos.sql), on a real Postgres
 * (PGlite) with what Supabase gives every project, Supabase's default
 * privileges included, after social-001 (fixtures/pglite-duos.js):
 *   - it runs twice, the undo twice, and again;
 *   - every table: RLS on, no policy, nothing for anon or authenticated;
 *     every function: EXECUTE for the service role only, every function it
 *     makes in the grant loop and in the undo, by name, no pattern;
 *   - the plan read fresh: a duo pauses the moment neither is on Max (a
 *     refund ends the entitlement), and a paused duo uploads nothing;
 *   - invites: Max only, 'sent' alike for a private, a missing and a blocked
 *     name (and nothing delivered), codes single use, expired, own, the
 *     guess limit; five duos at most;
 *   - the report: bound to a live game row, one report a game, the same team
 *     within the window, partners shared, discoverable teammates found and
 *     nobody else, never an enemy, never across a block;
 *   - clips: the path the database chose, the count cap, the quota held at
 *     the cap and settled, a file over the cap removed, downloads only inside
 *     the duo and within the day's budget, pins on the partner's clip only;
 *   - a block, a removal, an account deleted and an expiry each leave every
 *     file path in the trash, and the trash lets a path go only once no upload
 *     URL could still land it;
 *   - and mutants of the SQL (no block check on a match, no plan check on an
 *     upload, no team check on a report) fail these cases.
 *
 * Run: npm run test:duossql
 */

const fs = require('fs');
const pg = require('./fixtures/pglite-duos');

let fails = 0;
let checks = 0;
const ok = (cond, what, extra) => {
  checks++;
  if (!cond) { fails++; console.log(`FAIL  ${what}${extra !== undefined ? `  ${JSON.stringify(extra)}` : ''}`); } else console.log(`ok    ${what}`);
};
const U = (n) => `${String(n).padStart(8, '0')}-0000-4000-8000-000000000000`;
const H = (c) => c.repeat(64);
const DAY = 86400000;

/** A small world on a database: names, tiers, a duo. */
async function world(db) {
  const r = (n, a) => pg.rpc(db, n, a);
  for (let i = 1; i <= 12; i++) await pg.addUser(db, U(i));
  const name = (u, n) => r('social_set_username', { p_user: U(u), p_username: n, p_key: n.toLowerCase(), p_fold: n.toLowerCase(), p_change_days: 30, p_hold_days: 30 });
  const names = ['Alder', 'Birch', 'Cedar', 'Dogwood', 'Elm', 'Fir', 'Gum', 'Hazel', 'Ivy', 'Juniper'];
  for (let i = 1; i <= 10; i++) await name(i, names[i - 1]);
  return { r, names };
}
const inviteCode = (r, u, hash, ttl = 7 * DAY) => r('social_duo_invite_code', { p_user: U(u), p_code_hash: hash, p_ttl_ms: ttl, p_open_max: 10, p_partner_max: 5 });
const acceptCode = (r, u, hash) => r('social_duo_accept_code', { p_user: U(u), p_code_hash: hash, p_partner_max: 5, p_guess_day: 10 });
const report = (r, u, match, team = 'Jett,Sova|Fade,Omen', agent = 'Jett') => r('social_duo_report', { p_user: U(u), p_match_hash: match, p_team: team, p_agent: agent,
  p_usage_hours: 4, p_window_ms: 3 * 3600000, p_report_days: 3, p_keep_days: 30 });
const clipStart = (r, u, ref, name, o = {}) => r('social_duo_clip_start', { p_user: U(u), p_ref: ref, p_name: name, p_round: o.round || 2, p_kind: 'death', p_marks: {},
  p_reserve: o.reserve || 80 * 1024 * 1024, p_per_match: o.per || 18, p_quota: o.quota || 2 * 1024 ** 3, p_quota_days: 30, p_issues: 6 });
const matchOf = (r, u, ref) => r('social_duo_match', { p_user: U(u), p_ref: ref });

/** The privacy and plan cases, true when every one holds (quiet), for the mutants. */
async function cases(db, say) {
  const tell = say || (() => {});
  let all = true;
  const t = (cond, what, extra) => { if (!cond) all = false; tell(cond, what, extra); };
  const { r } = await world(db);
  await pg.setTier(db, U(1), 'max');
  for (const u of [1, 2]) await pg.addGame(db, U(u));
  await inviteCode(r, 1, H('1'));
  await acceptCode(r, 2, H('1'));
  const rep1 = await report(r, 1, H('a'));
  const rep2 = await report(r, 2, H('a'), 'Jett,Sova|Fade,Omen', 'Sova');
  t(rep1.ok && rep1.matches.length === 0 && rep2.ok && rep2.matches.length === 1 && rep2.matches[0].partner === 'Alder', 'two partners on one team report one match: it is shared', [rep1, rep2]);
  const ref = rep2.matches[0] && rep2.matches[0].ref;
  // An enemy's report of the same match (the other team) pairs with nobody.
  await pg.setTier(db, U(3), 'max');
  await inviteCode(r, 3, H('3'));
  await acceptCode(r, 1, H('3'));
  await pg.addGame(db, U(3));
  const enemy = await report(r, 3, H('a'), 'Fade,Omen|Jett,Sova', 'Fade');
  t(enemy.ok && enemy.matches.length === 0, 'a partner on the OTHER team of that match shares nothing', enemy);
  // A paused duo uploads nothing.
  await pg.setTier(db, U(1), 'free');
  const paused = await clipStart(r, 1, ref, 'r2-clip.mkv');
  t(paused.ok === false && paused.reason === 'paused', 'neither on Max: an upload is refused, paused', paused);
  const pausedSheet = await r('social_duo_sheet_put', { p_user: U(2), p_ref: ref, p_sheet: { v: 1 }, p_max: 49152 });
  t(pausedSheet.reason === 'paused', 'and a sheet too', pausedSheet);
  // A discoverable teammate is found only by another discoverable one: the
  // two partners here are not, so a discoverable third finds neither.
  await r('social_duo_set_discoverable', { p_user: U(10), p_on: true });
  await pg.addGame(db, U(10));
  const third = await report(r, 10, H('a'), 'Jett,Sova|Fade,Omen', 'Omen');
  t(third.ok && third.found.length === 0, 'a discoverable teammate finds nobody who is not discoverable', third);
  await pg.setTier(db, U(1), 'max');
  const c = await clipStart(r, 1, ref, 'r2-clip.mkv');
  await r('social_duo_clip_done', { p_user: U(1), p_ref: c.ref, p_size: 1000000, p_cap: 80 * 1024 * 1024 });
  // AN OUTSIDER WITH A VALID REF, on every function that takes one.
  const c2 = await clipStart(r, 1, ref, 'r3-clip.mkv');
  const o = {
    match: await matchOf(r, 4, ref),
    start: await clipStart(r, 4, ref, 'r4-clip.mkv'),
    sheet: await r('social_duo_sheet_put', { p_user: U(4), p_ref: ref, p_sheet: { v: 1 }, p_max: 49152 }),
    get: await r('social_duo_clip_get', { p_user: U(4), p_ref: c.ref, p_down: 1e10, p_urls: 120 }),
    pin: await r('social_duo_pin', { p_user: U(4), p_clip: c.ref, p_at_ms: 1, p_label: 'nice-shot', p_reaction: null, p_max: 20 }),
    done: await r('social_duo_clip_done', { p_user: U(4), p_ref: c2.ref, p_size: 5000, p_cap: 83886080 }),
    // The PARTNER is no outsider to the match, but a clip is its owner's alone to settle.
    partnerDone: await r('social_duo_clip_done', { p_user: U(2), p_ref: c2.ref, p_size: 5000, p_cap: 83886080 }),
    path: await r('social_duo_clip_path', { p_user: U(4), p_ref: c.ref }),
  };
  const c2row = (await db.query('SELECT status FROM public.social_duo_clips WHERE ref = $1', [c2.ref])).rows[0];
  t(o.match === null && o.start.reason === 'none' && o.sheet.reason === 'none' && o.get.ok === false && o.pin.ok === false && o.done.reason === 'none'
    && o.partnerDone.reason === 'none' && o.path === null && c2row.status === 'issued',
  'an outsider with a valid ref gets nothing from the match, a clip start, a sheet, a download, a pin, a done or a path, and a partner cannot settle the other\'s clip', o);
  // A join across a block (the race's outcome): refused by join itself.
  await pg.setTier(db, U(5), 'max');
  await inviteCode(r, 5, H('5'));
  const inv5 = (await db.query('SELECT id FROM public.social_duo_invites WHERE code_hash = $1', [H('5')])).rows[0].id;
  await r('social_block', { p_user: U(6), p_key: 'elm', p_name: 'Elm', p_on: true, p_max: 500 });
  const joined = await r('social_duo_join', { p_invite: inv5, p_user: U(6), p_partner_max: 5 });
  t(joined.ok === false && joined.reason === 'gone', 'join itself refuses a pair across a block', joined);
  // An invite, and a duo, that exist across a block (a block landed with no
  // trigger, as a race could leave it): every read and write passes it over.
  await r('social_set_flags', { p_user: U(7), p_public: true, p_show_riot_id: null, p_discoverable: null });
  await r('social_duo_invite_name', { p_user: U(5), p_name: 'Gum', p_key: 'gum', p_ttl_ms: 7 * DAY, p_open_max: 10, p_partner_max: 5 });
  await db.exec('ALTER TABLE public.social_blocks DISABLE TRIGGER USER');
  await db.query("INSERT INTO public.social_blocks (blocker, blocked, blocked_name, blocked_key) VALUES ($1, $2, 'Elm', 'elm')", [U(7), U(5)]);
  await db.query("INSERT INTO public.social_blocks (blocker, blocked, blocked_name, blocked_key) VALUES ($1, $2, 'Hazel', 'hazel')", [U(9), U(8)]);
  await db.exec('ALTER TABLE public.social_blocks ENABLE TRIGGER USER');
  const me7 = await r('social_duo_me', { p_user: U(7), p_window_ms: 1, p_ended_days: 14, p_quota_days: 30 });
  t(me7.invites_in.length === 0, 'an invite across a block is never listed', me7.invites_in);
  await db.query('INSERT INTO public.social_duo_pairs (user_a, user_b) VALUES ($1, $2)', [U(8), U(9)]);
  const pr89 = (await db.query('SELECT id FROM public.social_duo_pairs WHERE user_a = $1 AND user_b = $2', [U(8), U(9)])).rows[0].id;
  await db.query("INSERT INTO public.social_duo_matches (pair_id, match_hash, played_at, expires_at) VALUES ($1, repeat('c', 64), now(), now() + interval '30 days')", [pr89]);
  const m89 = (await db.query('SELECT ref FROM public.social_duo_matches WHERE pair_id = $1', [pr89])).rows[0].ref;
  await pg.setTier(db, U(8), 'max');
  const me8 = await r('social_duo_me', { p_user: U(8), p_window_ms: 1, p_ended_days: 14, p_quota_days: 30 });
  const across = { start: await clipStart(r, 8, m89, 'r1-clip.mkv'), sheet: await r('social_duo_sheet_put', { p_user: U(8), p_ref: m89, p_sheet: { v: 1 }, p_max: 49152 }),
    match: await matchOf(r, 8, m89), count: await r('social_duo_count', { p_user: U(8) }) };
  t(me8.partners.length === 0 && across.start.reason === 'none' && across.sheet.reason === 'none' && across.match === null && across.count === 0,
    'a duo across a block: not listed, no upload, no sheet, no match, not counted toward the cap', across);
  // A block hides the match both ways.
  await r('social_block', { p_user: U(2), p_key: 'alder', p_name: 'Alder', p_on: true, p_max: 500 });
  t(await matchOf(r, 1, ref) === null && await matchOf(r, 2, ref) === null, 'a block: the shared match is no match to either');
  const got = await r('social_duo_clip_get', { p_user: U(2), p_ref: c.ref, p_down: 1536 * 1024 * 1024, p_urls: 120 });
  t(got.ok === false, 'nor is its clip given to either', got);
  return all;
}

(async () => {
  const sqlText = fs.readFileSync(pg.DUOS_FILE, 'utf8');
  const undo = fs.readFileSync(pg.DUOS_UNDO, 'utf8');
  const db = await pg.makeDb();
  ok(true, 'the migration runs twice on Postgres, after 001, over Supabase\'s default privileges');
  const q = async (s, p) => (await db.query(s, p)).rows;
  ok((await pg.rpc(db, 'social_duo_status', {})) === true, 'and says it is live');
  const bucket = (await q("SELECT public, file_size_limit, allowed_mime_types FROM storage.buckets WHERE id = 'duo-clips'"))[0];
  ok(bucket && bucket.public === false && Number(bucket.file_size_limit) === 83886080 && bucket.allowed_mime_types.join() === 'video/x-matroska',
    'the bucket: private, 80 MB a file, Matroska only', bucket);

  // ── Privileges ──────────────────────────────────────────────────────────
  const tables = await q("SELECT c.relname, c.relrowsecurity rls, has_table_privilege('anon', c.oid, 'SELECT,INSERT,UPDATE,DELETE') a, has_table_privilege('authenticated', c.oid, 'SELECT,INSERT,UPDATE,DELETE') au, has_table_privilege('service_role', c.oid, 'SELECT') s FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relname LIKE 'social\\_duo\\_%' AND c.relkind = 'r'");
  ok(tables.length === 10 && tables.every((x) => x.rls && !x.a && !x.au && x.s), 'every table: RLS on, nothing for anon or authenticated, the service role reads', tables.length);
  ok((await q("SELECT count(*)::int n FROM pg_policies WHERE tablename LIKE 'social\\_duo\\_%'"))[0].n === 0, 'and no policy at all');
  const declared = [...sqlText.matchAll(/CREATE OR REPLACE FUNCTION public\.(social_duo_[a-z_]+)\(/g)].map((m) => m[1]);
  const fns = await q("SELECT p.proname, has_function_privilege('anon', p.oid, 'EXECUTE') a, has_function_privilege('authenticated', p.oid, 'EXECUTE') au, has_function_privilege('service_role', p.oid, 'EXECUTE') s FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname LIKE 'social\\_duo\\_%'");
  ok(declared.length >= 30 && fns.length === declared.length && declared.every((f) => fns.some((x) => x.proname === f)), 'every function the migration declares exists, and no other', [fns.length, declared.length]);
  const grantList = [...sqlText.slice(sqlText.indexOf('DO $grants$')).matchAll(/'public\.(social_duo_[a-z_]+)\(/g)].map((m) => m[1]);
  const undoList = [...undo.matchAll(/DROP FUNCTION IF EXISTS public\.(social_duo_[a-z_]+)\(/g)].map((m) => m[1]);
  const same = (x) => x.length === declared.length && declared.every((f) => x.includes(f));
  ok(same(grantList) && same(undoList) && !/LIKE 'social/.test(sqlText.replace(/--[^\n]*/g, '')) && !/LIKE 'social/.test(undo),
    'the grant block and the undo list exactly the functions the migration creates, no pattern', [grantList.length, undoList.length, declared.length]);
  ok(fns.every((x) => !x.a && !x.au && x.s), 'every function: no EXECUTE for anon or authenticated, EXECUTE for the service role', fns.filter((x) => x.a || x.au || !x.s).map((x) => x.proname));
  for (const role of ['anon', 'authenticated']) {
    const callable = await q("SELECT p.proname, p.pronargs FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname LIKE 'social\\_duo\\_%' AND p.prorettype <> 'trigger'::regtype");
    await db.exec(`SET ROLE ${role}`);
    let refusedT = 0;
    for (const tb of tables) { try { await db.query(`SELECT * FROM public.${tb.relname}`); } catch { refusedT++; } }
    let refusedF = 0;
    for (const f of callable) {
      try { await db.query(`SELECT public.${f.proname}(${Array.from({ length: f.pronargs }, () => 'NULL').join(', ')})`); } catch (e) { if (/permission denied/.test(e.message)) refusedF++; }
    }
    await db.exec('RESET ROLE');
    ok(refusedT === tables.length && refusedF === callable.length, `${role} cannot read any table nor call any function`, [refusedT, refusedF, callable.length]);
  }
  ok(!/\blower\(/.test(sqlText.replace(/--[^\n]*/g, '')), 'the SQL never matches by Postgres lower()');

  // ── The cases, on the migration as written ───────────────────────────────
  ok(await cases(db, (c, w, x) => ok(c, w, x)), 'the privacy and plan cases hold on the migration as written');

  // ── They catch a broken SQL ─────────────────────────────────────────────
  const mutants = {
    // A block is held twice over: the trigger ends the duo, and every read checks the block list.
    'the block trigger and the block clauses of the match and the clip taken out': sqlText
      .replace('CREATE TRIGGER social_duo_blocks_end\n  AFTER INSERT ON public.social_blocks\n  FOR EACH ROW EXECUTE FUNCTION public.social_duo_on_block();', '')
      .replace(/(WHERE m\.ref = p_ref AND \(p\.user_a = p_user OR p\.user_b = p_user\) AND m\.expires_at > now\(\))\n\s+AND NOT public\.social_duo_blocked\(p\.user_a, p\.user_b\);/, '$1;')
      .replace("WHERE c2.ref = p_ref AND c2.status = 'stored' AND m.expires_at > now() AND (p.user_a = p_user OR p.user_b = p_user)\n    AND NOT public.social_duo_blocked(p.user_a, p.user_b);",
        "WHERE c2.ref = p_ref AND c2.status = 'stored' AND m.expires_at > now() AND (p.user_a = p_user OR p.user_b = p_user);"),
    'the plan check taken out of an upload': sqlText.replace("IF NOT (public.social_duo_max(p.user_a) OR public.social_duo_max(p.user_b)) THEN RETURN jsonb_build_object('ok', false, 'reason', 'paused'); END IF;\n  SELECT * INTO c FROM public.social_duo_clips",
      "SELECT * INTO c FROM public.social_duo_clips"),
    'the team check taken out of the report': sqlText.replace('WHERE x.match_hash = p_match_hash AND x.user_id <> p_user AND x.team = r.team AND', 'WHERE x.match_hash = p_match_hash AND x.user_id <> p_user AND'),
    // The review of 25 Nov: each of these passed both suites before.
    'the membership check taken out of the match view': sqlText.replace("WHERE m.ref = p_ref AND (p.user_a = p_user OR p.user_b = p_user) AND m.expires_at > now()\n    AND NOT", "WHERE m.ref = p_ref AND m.expires_at > now()\n    AND NOT"),
    'the membership check taken out of an upload start': sqlText.replace("WHERE id = m.pair_id AND status = 'paired' AND (user_a = p_user OR user_b = p_user);", "WHERE id = m.pair_id AND status = 'paired';"),
    'the discoverable check taken out of the report': sqlText.replace('ELSIF v_me.discoverable AND v_me.duo_discoverable_at IS NOT NULL AND o.discoverable THEN', 'ELSIF true THEN'),
    'the plan check taken out of a sheet': sqlText.replace("IF NOT (public.social_duo_max(p.user_a) OR public.social_duo_max(p.user_b)) THEN RETURN jsonb_build_object('ok', false, 'reason', 'paused'); END IF;\n  INSERT INTO public.social_duo_sheets", "INSERT INTO public.social_duo_sheets"),
    'the owner check taken out of clip_done': sqlText.replace('WHERE ref = p_ref AND (p_user IS NULL OR user_id = p_user) FOR UPDATE;', 'WHERE ref = p_ref FOR UPDATE;'),
    'the block check taken out of join': sqlText.replace("IF public.social_duo_blocked(i.from_user, p_user) THEN RETURN jsonb_build_object('ok', false, 'reason', 'gone'); END IF;\n  SELECT username INTO v_from", "SELECT username INTO v_from"),
    'the block check taken out of the invites in': sqlText.replace("AND NOT public.social_duo_blocked(i.from_user, p_user)), '[]'::jsonb),", "), '[]'::jsonb),"),
  };
  for (const [what, text] of Object.entries(mutants)) {
    ok(text !== sqlText, `the mutation "${what}" changes the SQL`);
    const m = await pg.makeDb({ duos: text });
    ok(!(await cases(m)), `and the cases fail on it: ${what}`);
  }

  // ── Invites ─────────────────────────────────────────────────────────────
  const db2 = await pg.makeDb();
  const { r } = await world(db2);
  const q2 = async (s, p) => (await db2.query(s, p)).rows;
  const inviteName = (u, n) => r('social_duo_invite_name', { p_user: U(u), p_name: n, p_key: n.toLowerCase(), p_ttl_ms: 7 * DAY, p_open_max: 10, p_partner_max: 5 });
  ok((await inviteName(1, 'Birch')).reason === 'no-max' && (await inviteCode(r, 1, H('9'))).reason === 'no-max', 'no Max: no invite by name, no code');
  await pg.setTier(db2, U(1), 'max');
  // Birch private, not discoverable; Cedar public; Dogwood discoverable; Elm blocked Alder.
  await r('social_set_flags', { p_user: U(3), p_public: true, p_show_riot_id: null, p_discoverable: null });
  await r('social_duo_set_discoverable', { p_user: U(4), p_on: true });
  await r('social_set_flags', { p_user: U(5), p_public: true, p_show_riot_id: null, p_discoverable: null });
  await r('social_block', { p_user: U(5), p_key: 'alder', p_name: 'Alder', p_on: true, p_max: 500 });
  const sent = {};
  for (const n of ['Birch', 'Cedar', 'Dogwood', 'Elm', 'Nobody_here']) sent[n] = await inviteName(1, n);
  ok(Object.values(sent).every((x) => x.ok === true && x.reason === 'sent'), 'a private, a public, a discoverable, a blocking and a missing name: one answer, sent', sent);
  const inbox = async (u) => (await r('social_duo_me', { p_user: U(u), p_window_ms: 3 * 3600000, p_ended_days: 14, p_quota_days: 30 })).invites_in.map((i) => i.username);
  ok((await inbox(2)).length === 0 && (await inbox(5)).length === 0, 'and nothing reaches the private profile nor the one that blocked the sender');
  ok((await inbox(3)).join() === 'Alder' && (await inbox(4)).length === 0, 'the public profile sees it; a private one that is discoverable never does (an invite by name reaches public profiles only)');
  ok((await inviteName(1, 'birch')).reason === 'already', 'the same name again (any case): already, whoever it is');
  const out = (await r('social_duo_me', { p_user: U(1), p_window_ms: 1, p_ended_days: 14, p_quota_days: 30 })).invites_out;
  ok(out.length === 5 && out.every((i) => /^[0-9a-f]{16}$/.test(i.ref) && !('to_user' in i)), 'the sender sees each invite by the name as typed and a ref, never whether it reached anyone', out.map((i) => i.name));
  // Codes.
  await inviteCode(r, 1, H('c'));
  ok((await acceptCode(r, 1, H('c'))).reason === 'own', 'your own code: own, nothing counted');
  const join = await acceptCode(r, 6, H('c'));
  ok(join.ok && join.reason === 'paired' && join.username === 'Alder', 'a code makes the duo, for an account with no plan at all', join);
  ok((await acceptCode(r, 7, H('c'))).reason === 'bad-code', 'and works once');
  await inviteCode(r, 1, H('e'), 1000);
  await db2.query("UPDATE public.social_duo_invites SET expires_at = now() - interval '1 second' WHERE code_hash = $1", [H('e')]);
  ok((await acceptCode(r, 7, H('e'))).reason === 'bad-code', 'an expired code is a bad code');
  for (let i = 0; i < 9; i++) await acceptCode(r, 8, H(String(i)));
  ok((await acceptCode(r, 8, H('f'))).reason === 'bad-code' && (await acceptCode(r, 8, H('f'))).reason === 'guesses',
    'ten wrong codes in a day, then guesses: nothing more is looked up');
  ok((await q2('SELECT count(*)::int n FROM public.social_duo_guesses WHERE user_id = $1', [U(8)]))[0].n === 10, 'and the guesses were counted, the refused one not');
  // A decline holds the sender off that profile for 7 days, said to the sender as the ordinary sent.
  await r('social_set_flags', { p_user: U(8), p_public: true, p_show_riot_id: null, p_discoverable: null });
  await inviteName(1, 'Hazel');
  ok((await inbox(8)).join() === 'Alder', 'a public profile is invited');
  await r('social_duo_decline', { p_user: U(8), p_from_key: 'alder' });
  const again8 = await inviteName(1, 'Hazel');
  ok(again8.reason === 'sent' && (await inbox(8)).length === 0, 'declined: an invite again is "sent" and reaches nobody for 7 days', again8);
  await db2.query("UPDATE public.social_duo_invites SET created_at = now() - interval '8 days' WHERE status = 'declined'");
  await db2.query("UPDATE public.social_duo_invites SET status = 'cancelled' WHERE status = 'open' AND to_key = 'hazel'");
  await inviteName(1, 'Hazel');
  ok((await inbox(8)).join() === 'Alder', 'after 7 days it reaches them again');
  await db2.query("UPDATE public.social_duo_invites SET status = 'cancelled' WHERE status = 'open' AND to_key = 'hazel'");
  await r('social_set_flags', { p_user: U(8), p_public: false, p_show_riot_id: null, p_discoverable: null });
  // Accept by name; the five duos cap.
  const acc = await r('social_duo_accept_from', { p_user: U(3), p_from_key: 'alder', p_partner_max: 5 });
  ok(acc.ok && acc.reason === 'paired', 'an invite by name accepted by its invitee', acc);
  ok((await r('social_duo_accept_from', { p_user: U(2), p_from_key: 'alder', p_partner_max: 5 })).reason === 'gone', 'the private profile it never reached cannot accept it');
  ok((await r('social_duo_accept_from', { p_user: U(4), p_from_key: 'alder', p_partner_max: 5 })).reason === 'gone', 'nor the discoverable private one');
  await inviteCode(r, 1, H('4')); await acceptCode(r, 4, H('4'));
  for (const u of [9, 10]) { await inviteCode(r, 1, H(String(u - 2))); await acceptCode(r, u, H(String(u - 2))); }
  ok((await r('social_duo_count', { p_user: U(1) })) === 5, 'five duos');
  ok((await inviteCode(r, 1, H('d'))).reason === 'full' && (await inviteName(1, 'Hazel')).reason === 'full', 'and a sixth cannot be started');
  // Lazily paused: a refund ends the entitlement, the next read says paused.
  let me1 = await r('social_duo_me', { p_user: U(6), p_window_ms: 1, p_ended_days: 14, p_quota_days: 30 });
  ok(me1.partners[0].their_max === true && me1.partners[0].mine_max === false, 'the invitee with no plan: active on the partner\'s Max', me1.partners);
  await pg.setTier(db2, U(1), 'max', 'ended');
  me1 = await r('social_duo_me', { p_user: U(6), p_window_ms: 1, p_ended_days: 14, p_quota_days: 30 });
  ok(me1.partners[0].their_max === false && me1.partners[0].mine_max === false, 'the Max plan refunded (ended): paused on the very next read, nothing written', me1.partners);
  await pg.setTier(db2, U(1), 'max');

  // ── The report ──────────────────────────────────────────────────────────
  ok((await report(r, 6, H('7'))).reason === 'no-game', 'no live game metered in the last 4 hours: no report');
  await pg.addGame(db2, U(6), { minutesAgo: 300 });
  await pg.addGame(db2, U(6), { kind: 'riot' });
  ok((await report(r, 6, H('7'))).reason === 'no-game', 'a game 5 hours old, or a Riot record review, does not bind one');
  await pg.addGame(db2, U(6));
  const first = await report(r, 6, H('7'));
  ok(first.ok, 'a live game an hour old binds one report', first);
  ok((await report(r, 6, H('7'))).ok && (await report(r, 6, H('8'))).reason === 'no-game', 'the same match again answers again, another match needs another game');
  await pg.addGame(db2, U(1));
  const shared = await report(r, 1, H('7'), 'Jett,Sova|Fade,Omen', 'Sova');
  ok(shared.matches.length === 1 && shared.matches[0].partner === 'Fir', 'the partner\'s report pairs with it', shared);
  const exp = (await q2('SELECT played_at, expires_at FROM public.social_duo_matches'))[0];
  ok(Math.abs(new Date(exp.expires_at) - new Date(exp.played_at) - 30 * DAY) < 1000, 'and the shared match expires 30 days after it');
  // Found: both discoverable, same team, no block, not partners.
  // Discoverable under 8.19's words ("Nothing is shared yet") is no consent: only Duos' own route counts.
  const disc = async (u) => (await r('social_duo_me', { p_user: U(u), p_window_ms: 1, p_ended_days: 14, p_quota_days: 30 })).discoverable;
  await r('social_set_flags', { p_user: U(7), p_public: null, p_show_riot_id: null, p_discoverable: true });
  const before = await disc(7);
  await r('social_duo_set_discoverable', { p_user: U(7), p_on: true });
  const after = await disc(7);
  await r('social_set_flags', { p_user: U(7), p_public: null, p_show_riot_id: null, p_discoverable: false });
  await r('social_set_flags', { p_user: U(7), p_public: null, p_show_riot_id: null, p_discoverable: true });
  const cleared = await disc(7);
  ok(before === false && after === true && cleared === false && (await r('social_duo_discoverable', { p_user: U(7) })) === false,
    'a flag set by the 8.19 route reads off; turned on through Duos it counts; turned off anywhere and on again by 8.19, off again', [before, after, cleared]);
  await r('social_duo_set_discoverable', { p_user: U(7), p_on: true });
  await r('social_duo_set_discoverable', { p_user: U(8), p_on: true });
  await r('social_duo_set_discoverable', { p_user: U(6), p_on: true });
  for (const u of [7, 8, 2]) await pg.addGame(db2, U(u));
  await report(r, 7, H('7'), 'Jett,Sova|Fade,Omen', 'Jett');
  await report(r, 8, H('7'), 'Fade,Omen|Jett,Sova', 'Fade');
  const lone = await report(r, 2, H('7'), 'Jett,Sova|Fade,Omen', 'Jett');
  ok(lone.reason === 'not-engaged' && (await q2('SELECT count(*)::int n FROM public.social_duo_reports WHERE user_id = $1', [U(2)]))[0].n === 0,
    'an account with no duo, no invite and not discoverable: its report is refused and nothing of it is kept', lone);
  const found6 = (await r('social_duo_me', { p_user: U(6), p_window_ms: 3 * 3600000, p_ended_days: 14, p_quota_days: 30 })).found.map((f) => f.username);
  ok(found6.join() === 'Gum', 'found: the discoverable teammate, never the enemy, never one not discoverable, never the partner', found6);
  const found7 = (await r('social_duo_me', { p_user: U(7), p_window_ms: 3 * 3600000, p_ended_days: 14, p_quota_days: 30 })).found.map((f) => f.username);
  ok(found7.join() === 'Fir', 'and mutual: the teammate sees the asker too', found7);
  await r('social_block', { p_user: U(7), p_key: 'fir', p_name: 'Fir', p_on: true, p_max: 500 });
  ok((await r('social_duo_me', { p_user: U(6), p_window_ms: 3 * 3600000, p_ended_days: 14, p_quota_days: 30 })).found.length === 0, 'a block: found by neither');
  await db2.query("UPDATE public.social_duo_reports SET at = now() - interval '5 hours' WHERE user_id = $1", [U(8)]);
  await pg.addGame(db2, U(9));
  await r('social_duo_set_discoverable', { p_user: U(9), p_on: true });
  await report(r, 9, H('7'), 'Fade,Omen|Jett,Sova', 'Omen');
  ok(!(await r('social_duo_me', { p_user: U(9), p_window_ms: 3 * 3600000, p_ended_days: 14, p_quota_days: 30 })).found.length, 'a report more than 3 hours from another pairs with nothing');

  // ── Clips ───────────────────────────────────────────────────────────────
  const mref = shared.matches[0].ref;
  const c1 = await clipStart(r, 1, mref, 'r3-clip.mkv');
  ok(c1.ok && c1.reason === 'new' && /^[0-9a-f]{16}\/[0-9a-f]{16}\/[0-9a-f]{16}\/[0-9a-f]{16}-r3-clip\.mkv$/.test(c1.path) && !c1.path.includes(U(1).slice(0, 8))
    && c1.path.split('/')[3].startsWith(`${c1.ref}-`), 'an upload: the path the database chose, refs, a tag and the clip\'s own ref, never an id', c1.path);
  const pairRef = (await q2('SELECT p.ref, p.tag_a, p.tag_b FROM public.social_duo_pairs p JOIN public.social_duo_matches m ON m.pair_id = p.id WHERE m.ref = $1', [mref]))[0];
  ok(c1.path.startsWith(`${pairRef.ref}/${mref}/`) && [pairRef.tag_a, pairRef.tag_b].includes(c1.path.split('/')[2]), 'its parts: the duo, the match, the member\'s tag');
  const again = await clipStart(r, 1, mref, 'r3-clip.mkv');
  ok(again.reason === 'again' && again.path === c1.path, 'a clip not yet stored is issued again at its path, its bytes held once');
  const held = async (u) => Number((await q2("SELECT COALESCE(sum(bytes), 0)::bigint n FROM public.social_duo_bytes WHERE user_id = $1 AND dir = 'up'", [U(u)]))[0].n);
  ok(await held(1) === 80 * 1024 * 1024, 'the quota holds the whole 80 MB from the moment the URL is issued');
  ok((await r('social_duo_clip_done', { p_user: U(1), p_ref: c1.ref, p_size: null, p_cap: 83886080 })).reason === 'missing', 'not there yet: missing, nothing changes');
  ok((await r('social_duo_clip_done', { p_user: U(1), p_ref: c1.ref, p_size: 12345678, p_cap: 83886080 })).ok && await held(1) === 12345678, 'stored: settled to the size storage reports');
  const small = await clipStart(r, 1, mref, 'r7-clip.mkv', { reserve: 1000 });
  const over = await r('social_duo_clip_done', { p_user: U(1), p_ref: small.ref, p_size: 5000, p_cap: 83886080 });
  ok(over.reason === 'too-big' && (await q2('SELECT count(*)::int n FROM public.social_duo_trash WHERE path = $1', [small.path]))[0].n === 1, 'a file over what was held for it: the clip goes, its file in the trash', over);
  ok((await clipStart(r, 1, mref, 'r3-clip.mkv')).stored === true, 'and never sent again');
  const big = await clipStart(r, 1, mref, 'r4-clip.mkv');
  ok((await r('social_duo_clip_done', { p_user: U(1), p_ref: big.ref, p_size: 83886081, p_cap: 83886080 })).reason === 'too-big', 'a file over the cap: the clip goes');
  ok((await q2('SELECT count(*)::int n FROM public.social_duo_trash WHERE path = $1', [big.path]))[0].n === 1 && await held(1) === 12345678 + 1000 + 83886080, 'its file in the trash, its reserve spent');
  ok((await clipStart(r, 1, mref, 'r5-clip.mkv', { per: 1 })).reason === 'count', 'the count cap a match');
  ok((await clipStart(r, 1, mref, 'r6-clip.mkv', { quota: 150 * 1024 * 1024 })).reason === 'quota', 'the quota: a clip whose cap would pass it is refused');
  // Downloads.
  const outsider = await r('social_duo_clip_get', { p_user: U(2), p_ref: c1.ref, p_down: 1536 * 1024 * 1024, p_urls: 120 });
  const partner = await r('social_duo_clip_get', { p_user: U(6), p_ref: c1.ref, p_down: 1536 * 1024 * 1024, p_urls: 120 });
  ok(outsider.ok === false && partner.ok === true && partner.path === c1.path, 'a download only for the duo', [outsider, partner.ok]);
  ok((await r('social_duo_clip_get', { p_user: U(6), p_ref: c1.ref, p_down: 20000000, p_urls: 120 })).reason === 'budget', 'and within the day\'s download budget, counted');
  ok((await r('social_duo_clip_get', { p_user: U(6), p_ref: c1.ref, p_down: 1e12, p_urls: 1 })).reason === 'budget', 'and within the day\'s count of download URLs, whatever their size');
  // Pins.
  const pinOwn = await r('social_duo_pin', { p_user: U(1), p_clip: c1.ref, p_at_ms: 1000, p_label: 'nice-shot', p_reaction: null, p_max: 20 });
  const pin = await r('social_duo_pin', { p_user: U(6), p_clip: c1.ref, p_at_ms: 1000, p_label: 'good-trade', p_reaction: 'wow', p_max: 20 });
  ok(pinOwn.ok === false && pin.ok === true, 'a pin on the partner\'s clip, never on one\'s own', [pinOwn, pin]);
  let badLabel = false;
  try { await db2.query("INSERT INTO public.social_duo_pins (clip_id, author, at_ms, label) SELECT id, $1, 0, 'free text' FROM public.social_duo_clips LIMIT 1", [U(6)]); } catch { badLabel = true; }
  ok(badLabel, 'a label off the fixed list is refused by the table itself');
  const me1b = await r('social_duo_me', { p_user: U(1), p_window_ms: 1, p_ended_days: 14, p_quota_days: 30 });
  ok(me1b.partners.find((p) => p.username === 'Fir').new_pins === 1, 'the owner sees a new pin');
  await r('social_duo_seen', { p_user: U(1) });
  ok((await r('social_duo_me', { p_user: U(1), p_window_ms: 1, p_ended_days: 14, p_quota_days: 30 })).partners.find((p) => p.username === 'Fir').new_pins === 0, 'and once seen, none is new');

  // ── Ending, deleting, expiring: every path to the trash ──────────────────
  const paths = async () => (await q2('SELECT path FROM public.social_duo_trash')).map((x) => x.path);
  await r('social_duo_remove', { p_user: U(6), p_key: 'alder' });
  ok((await paths()).includes(c1.path) && (await q2('SELECT count(*)::int n FROM public.social_duo_matches m JOIN public.social_duo_pairs p ON p.id = m.pair_id WHERE p.ref = $1', [pairRef.ref]))[0].n === 0,
    'a removal: the duo ended, its matches deleted, every file in the trash');
  const ended = (await r('social_duo_me', { p_user: U(1), p_window_ms: 1, p_ended_days: 14, p_quota_days: 30 })).ended;
  ok(ended.length === 1 && ended[0].username === 'Fir' && ended[0].by_me === false, 'and the other side is told it ended', ended);
  // Account deletion: a duo with a stored clip, then the account goes.
  for (const u of [11, 12]) await r('social_set_username', { p_user: U(u), p_username: `Del_${u}`, p_key: `del_${u}`, p_fold: `dei_${u}`, p_change_days: 30, p_hold_days: 30 });
  await pg.setTier(db2, U(11), 'max');
  await inviteCode(r, 11, H('5'));
  await acceptCode(r, 12, H('5'));
  for (const u of [11, 12]) await pg.addGame(db2, U(u));
  await report(r, 11, H('6'));
  const m2 = (await report(r, 12, H('6'))).matches[0].ref;
  const c2 = await clipStart(r, 12, m2, 'h4-clip.mkv');
  await db2.query('DELETE FROM auth.users WHERE id = $1', [U(12)]);
  ok((await paths()).includes(c2.path) && (await q2('SELECT count(*)::int n FROM public.social_duo_clips WHERE path = $1', [c2.path]))[0].n === 0,
    'an account deleted: its rows cascade away and its files are in the trash, none orphaned');
  // Expiry.
  await pg.addGame(db2, U(3)); await pg.addGame(db2, U(1));
  await report(r, 3, H('4')); const m3 = (await report(r, 1, H('4'))).matches[0].ref;
  const c3 = await clipStart(r, 3, m3, 'r1-clip.mkv');
  await r('social_duo_clip_done', { p_user: U(3), p_ref: c3.ref, p_size: 5000, p_cap: 83886080 });
  await db2.query("UPDATE public.social_duo_matches SET expires_at = now() - interval '1 second' WHERE ref = $1", [m3]);
  ok(await matchOf(r, 1, m3) === null && (await r('social_duo_clip_get', { p_user: U(1), p_ref: c3.ref, p_down: 1e10, p_urls: 120 })).ok === false, 'expired: no match and no URL, before the sweep');
  const sw = await r('social_duo_sweep', { p_limit: 50, p_ended_days: 14, p_report_days: 3, p_quota_days: 30 });
  ok(sw.paths.includes(c3.path) && (await q2('SELECT count(*)::int n FROM public.social_duo_matches WHERE ref = $1', [m3]))[0].n === 0, 'the sweep deletes it and hands its files over', sw.paths.length);
  // The trash: a path whose upload URL could still land a file is kept after a removal.
  const removed = await r('social_duo_trash_done', { p_paths: sw.paths });
  const left = await paths();
  ok(removed >= 0 && left.includes(c3.path), 'a file whose upload URL could still land stays in the trash after it is removed, to be removed again');
  await db2.query("UPDATE public.social_duo_trash SET not_before = now() - interval '1 second'");
  await r('social_duo_trash_done', { p_paths: left });
  ok((await paths()).length === 0, 'and goes once no URL could land it');
  // Stale uploads.
  await pg.addGame(db2, U(9)); await pg.addGame(db2, U(10)); await pg.setTier(db2, U(9), 'max');
  await inviteCode(r, 9, H('2')); await acceptCode(r, 10, H('2'));
  await report(r, 9, H('3')); const m4 = (await report(r, 10, H('3'))).matches[0].ref;
  const c4 = await clipStart(r, 10, m4, 'r2-clip.mkv');
  await db2.query("UPDATE public.social_duo_clips SET issued_at = now() - interval '3 hours' WHERE ref = $1", [c4.ref]);
  const sw2 = await r('social_duo_sweep', { p_limit: 50, p_ended_days: 14, p_report_days: 3, p_quota_days: 30 });
  ok(sw2.stale.some((s) => s.ref === c4.ref), 'an upload never finished is handed over as stale');
  await r('social_duo_clip_drop', { p_ref: c4.ref });
  ok(await held(10) === 0 && (await paths()).includes(c4.path), 'dropped: its reserve given back, its path in the trash in case the file lands late');
  const c4b = await clipStart(r, 10, m4, 'r2-clip.mkv');
  ok(c4b.ok && c4b.path !== c4.path, 'the retry is a new row at a NEW path: the trash never holds a live file\'s path', [c4.path, c4b.path]);
  await db2.query("INSERT INTO public.social_duo_trash (path, not_before) VALUES ($1, now() - interval '1 second') ON CONFLICT DO NOTHING", [c4b.path]);
  const sw3 = await r('social_duo_sweep', { p_limit: 50, p_ended_days: 14, p_report_days: 3, p_quota_days: 30 });
  await r('social_duo_trash_done', { p_paths: [c4b.path] });
  ok(!sw3.paths.includes(c4b.path) && !(await paths()).includes(c4b.path), 'and a path a live row holds is never handed over for removal, and leaves the trash');
  // The guesses are counted one accept at a time.
  await db2.query('DELETE FROM public.social_duo_guesses');
  await Promise.all(Array.from({ length: 20 }, (_, i) => acceptCode(r, 7, H(String(i % 10)))));
  ok((await q2('SELECT count(*)::int n FROM public.social_duo_guesses WHERE user_id = $1', [U(7)]))[0].n === 10, 'twenty wrong codes at once: exactly ten counted, the rest refused');

  // Idempotent with data in it; the undo; again.
  await db2.exec(sqlText);
  ok((await q2('SELECT count(*)::int n FROM public.social_duo_pairs'))[0].n > 0, 'a third run keeps every row');
  await db2.exec(undo);
  await db2.exec(undo);
  ok((await q2("SELECT count(*)::int n FROM pg_proc WHERE proname LIKE 'social\\_duo\\_%'"))[0].n === 0 && (await q2("SELECT to_regclass('public.social_duo_pairs')::text t"))[0].t === null
    && (await q2("SELECT count(*)::int n FROM pg_trigger WHERE tgname = 'social_duo_blocks_end'"))[0].n === 0,
    'the undo takes every table, function and trigger away, twice');
  ok((await q2('SELECT count(*)::int n FROM public.social_profiles'))[0].n > 0 && (await pg.rpc(db2, 'social_status', {})) === true, 'and leaves 001 whole');
  await db2.exec(sqlText);
  ok((await pg.rpc(db2, 'social_duo_status', {})) === true, 'and the migration runs again after it');

  const dash = new RegExp(`[${String.fromCharCode(0x2013)}${String.fromCharCode(0x2014)}]`);
  ok(![pg.DUOS_FILE, pg.DUOS_UNDO, __filename, require.resolve('./fixtures/pglite-duos')].some((f) => dash.test(fs.readFileSync(f, 'utf8'))), 'no em or en dash in the SQL or this test');

  console.log(`\n${checks - fails}/${checks} checks passed`);
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
