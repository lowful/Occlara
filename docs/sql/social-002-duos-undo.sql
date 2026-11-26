-- UNDO social-002-duos.sql (Occlara Duos, docs/claude/duos.md).
--
-- FIRST: `node server/scripts/duos-purge.js --apply` with the server's
-- environment, which removes every stored clip from the duo-clips bucket
-- through the Storage API. Deleting the rows below never deletes a file, so
-- without the purge the files would be left in the bucket with no row.
--
-- Takes Occlara Duos away: its ten tables WITH EVERY DUO, INVITE, SHEET,
-- CLIP RECORD AND PIN IN THEM, its three triggers (the ones on social_blocks and
-- social_profiles too) and Duos' column on social_profiles, and exactly the functions the migration creates (the same list as its
-- grant block; nothing of social-001 or anything else is touched). Run it in
-- the Supabase SQL editor; it is idempotent. Run it before 001's undo.
-- The bucket is left in place: once the purge emptied it, delete it in the
-- dashboard (Storage, duo-clips, Delete bucket).

DROP TRIGGER IF EXISTS social_duo_blocks_end ON public.social_blocks;
DROP TRIGGER IF EXISTS social_duo_disc_off ON public.social_profiles;
-- Duos' consent stamp on 001's table (the 8.19 flag itself stays).
ALTER TABLE IF EXISTS public.social_profiles DROP COLUMN IF EXISTS duo_discoverable_at;

DROP TABLE IF EXISTS public.social_duo_pins;
DROP TABLE IF EXISTS public.social_duo_bytes;
DROP TABLE IF EXISTS public.social_duo_guesses;
DROP TABLE IF EXISTS public.social_duo_trash;
-- The clip trigger goes with its table.
DROP TABLE IF EXISTS public.social_duo_clips;
DROP TABLE IF EXISTS public.social_duo_sheets;
DROP TABLE IF EXISTS public.social_duo_matches;
DROP TABLE IF EXISTS public.social_duo_reports;
DROP TABLE IF EXISTS public.social_duo_pairs;
DROP TABLE IF EXISTS public.social_duo_invites;

DROP FUNCTION IF EXISTS public.social_duo_new_ref();
DROP FUNCTION IF EXISTS public.social_duo_clip_gone();
DROP FUNCTION IF EXISTS public.social_duo_on_block();
DROP FUNCTION IF EXISTS public.social_duo_disc_off();
DROP FUNCTION IF EXISTS public.social_duo_set_discoverable(uuid, boolean);
DROP FUNCTION IF EXISTS public.social_duo_discoverable(uuid);
DROP FUNCTION IF EXISTS public.social_duo_status();
DROP FUNCTION IF EXISTS public.social_duo_max(uuid);
DROP FUNCTION IF EXISTS public.social_duo_blocked(uuid, uuid);
DROP FUNCTION IF EXISTS public.social_duo_pair_of(uuid, uuid);
DROP FUNCTION IF EXISTS public.social_duo_count(uuid);
DROP FUNCTION IF EXISTS public.social_duo_me(uuid, bigint, integer, integer);
DROP FUNCTION IF EXISTS public.social_duo_invite_name(uuid, text, text, bigint, integer, integer);
DROP FUNCTION IF EXISTS public.social_duo_invite_code(uuid, text, bigint, integer, integer);
DROP FUNCTION IF EXISTS public.social_duo_join(uuid, uuid, integer);
DROP FUNCTION IF EXISTS public.social_duo_accept_code(uuid, text, integer, integer);
DROP FUNCTION IF EXISTS public.social_duo_accept_from(uuid, text, integer);
DROP FUNCTION IF EXISTS public.social_duo_decline(uuid, text);
DROP FUNCTION IF EXISTS public.social_duo_cancel(uuid, text);
DROP FUNCTION IF EXISTS public.social_duo_remove(uuid, text);
DROP FUNCTION IF EXISTS public.social_duo_report(uuid, text, text, text, integer, bigint, integer, integer);
DROP FUNCTION IF EXISTS public.social_duo_matches_of(uuid, integer);
DROP FUNCTION IF EXISTS public.social_duo_match(uuid, text);
DROP FUNCTION IF EXISTS public.social_duo_sheet_put(uuid, text, jsonb, integer);
DROP FUNCTION IF EXISTS public.social_duo_clip_start(uuid, text, text, integer, text, jsonb, bigint, integer, bigint, integer, integer);
DROP FUNCTION IF EXISTS public.social_duo_clip_path(uuid, text);
DROP FUNCTION IF EXISTS public.social_duo_clip_done(uuid, text, bigint, bigint);
DROP FUNCTION IF EXISTS public.social_duo_clip_get(uuid, text, bigint, integer);
DROP FUNCTION IF EXISTS public.social_duo_pin(uuid, text, integer, text, text, integer);
DROP FUNCTION IF EXISTS public.social_duo_pin_remove(uuid, text);
DROP FUNCTION IF EXISTS public.social_duo_seen(uuid);
DROP FUNCTION IF EXISTS public.social_duo_report_target(uuid, text);
DROP FUNCTION IF EXISTS public.social_duo_sweep(integer, integer, integer, integer);
DROP FUNCTION IF EXISTS public.social_duo_trash_done(text[]);
DROP FUNCTION IF EXISTS public.social_duo_clip_drop(text);
DROP FUNCTION IF EXISTS public.social_duo_clip_reject(text);
DROP FUNCTION IF EXISTS public.social_duo_paths_live(text[]);
DROP FUNCTION IF EXISTS public.social_duo_all_paths(integer, text);

NOTIFY pgrst, 'reload schema';
