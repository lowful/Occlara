-- UNDO social-001-profiles.sql (Occlara, docs/claude/social.md).
--
-- Takes public profiles and player search away: the six tables WITH EVERY
-- USERNAME, BLOCK, CHALLENGE AND SNAPSHOT IN THEM, the trigger, and exactly
-- the functions the migration creates (the same list as its grant block;
-- nothing else in the database is touched). Run it in the Supabase SQL
-- editor; it is idempotent. Afterwards GET /api/social/status answers
-- {"live":false,...} (within 30 seconds) and the app hides the feature again.

DROP TABLE IF EXISTS public.social_riot_used;
DROP TABLE IF EXISTS public.social_riot_attempts;
DROP TABLE IF EXISTS public.social_riot_challenges;
DROP TABLE IF EXISTS public.social_blocks;
DROP TABLE IF EXISTS public.social_username_holds;
-- The trigger goes with its table.
DROP TABLE IF EXISTS public.social_profiles;

DROP FUNCTION IF EXISTS public.social_hold_old_name();
DROP FUNCTION IF EXISTS public.social_status();
DROP FUNCTION IF EXISTS public.social_me(uuid);
DROP FUNCTION IF EXISTS public.social_name_free(uuid, text, text, integer);
DROP FUNCTION IF EXISTS public.social_set_username(uuid, text, text, text, integer, integer);
DROP FUNCTION IF EXISTS public.social_set_flags(uuid, boolean, boolean, boolean);
DROP FUNCTION IF EXISTS public.social_put_stats(uuid, jsonb, integer);
DROP FUNCTION IF EXISTS public.social_view(uuid, text, bigint);
DROP FUNCTION IF EXISTS public.social_search(uuid, text, text, integer);
DROP FUNCTION IF EXISTS public.social_block(uuid, text, text, boolean, integer);
DROP FUNCTION IF EXISTS public.social_report_target(uuid, text);
DROP FUNCTION IF EXISTS public.social_challenge_attempt(uuid, integer, integer);
DROP FUNCTION IF EXISTS public.social_challenge_start(uuid, text, text, text, text, text[], text, bigint);
DROP FUNCTION IF EXISTS public.social_challenge_get(uuid);
DROP FUNCTION IF EXISTS public.social_challenge_note_check(uuid, bigint, integer);
DROP FUNCTION IF EXISTS public.social_challenge_refund(uuid, uuid);
DROP FUNCTION IF EXISTS public.social_challenge_result(uuid, uuid, text, integer);
DROP FUNCTION IF EXISTS public.social_challenge_pass(uuid, uuid, text, text, text, timestamptz, timestamptz);
DROP FUNCTION IF EXISTS public.social_unverify(uuid, text);
DROP FUNCTION IF EXISTS public.social_note_gone(uuid, text, bigint);
DROP FUNCTION IF EXISTS public.social_rank_due(uuid, text, bigint);
DROP FUNCTION IF EXISTS public.social_set_rank(uuid, text, text, text);

NOTIFY pgrst, 'reload schema';
