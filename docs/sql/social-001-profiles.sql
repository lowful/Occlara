-- PUBLIC PROFILES AND PLAYER SEARCH (Occlara, docs/claude/social.md).
--
-- WHAT THIS CREATES, all in public, all reached only by the server's service
-- role (row level security on, no policy, every privilege of PUBLIC, anon and
-- authenticated revoked, and EXECUTE on each function below granted to the
-- service role alone):
--
--   social_profiles        one row per account that picked a username: the
--                          username with its key and its look alike fold
--                          (both unique), the opt ins (public, show Riot ID,
--                          discoverable), the Riot ID once its owner PROVED
--                          CONTROL of it (name, tag, region, the puuid only as
--                          the server's salted HMAC), the rank the server
--                          looked up, and the stats snapshot the player's app
--                          uploaded. Deleted with the account.
--   social_username_holds  a username let go (by its fold), kept from
--                          everyone else for 30 days; a deleted account's
--                          hold keeps no user id
--   social_blocks          who blocked whom, with the name as the blocker
--                          typed it: neither sees the other
--   social_riot_challenges the proof of control: a sequence of three or four
--                          agents to play, in order, within 4 hours, unique
--                          among the open challenges on one Riot account
--   social_riot_attempts   every start of a proof, counted before Riot is asked
--   social_riot_used       per Riot account, the start of the last match a
--                          proof used: a later proof needs newer matches
--   the functions          listed in the grant block at the end
--
-- HOW TO RUN IT: paste the whole file into the Supabase SQL editor of the
-- project the server uses and press Run. It is idempotent: running it again
-- changes nothing and fails on nothing. Then check that
-- GET https://ghostcoach-production.up.railway.app/api/social/status answers
-- {"live":true,...} (within 30 seconds, the server's memory of the answer).
-- To take it away again: social-001-profiles-undo.sql.
--
-- Until this runs every social route answers 503 social-not-live and the app
-- hides the feature. Nothing else on the server changes either way.
--
-- KEYS ARE MADE IN THE SERVER, never here: a username's key (NFKC then lower
-- case), its fold (look alikes folded: social.js fold) and a Riot ID's key are
-- passed in and compared as they are. Postgres lower() and JavaScript disagree
-- on some letters, so lower() is never used to match.

-- ── The tables ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.social_profiles (
  user_id            uuid PRIMARY KEY REFERENCES auth.users (id) ON DELETE CASCADE,
  -- An opaque id for the owner's inbox (a report names it); never answered by a route.
  public_id          uuid NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  username           text,
  username_key       text,
  username_fold      text,
  username_set_at    timestamptz,
  is_public          boolean NOT NULL DEFAULT false,
  show_riot_id       boolean NOT NULL DEFAULT true,
  discoverable       boolean NOT NULL DEFAULT false,
  riot_name          text,
  riot_tag           text,
  riot_key           text,
  riot_region        text,
  riot_puuid_hash    text,
  riot_verified      boolean NOT NULL DEFAULT false,
  riot_verified_at   timestamptz,
  -- The first rank lookup that found no account behind the name: a second
  -- one at least 6 hours later unverifies as 'gone'; a success clears it.
  riot_gone_at       timestamptz,
  -- Why a Riot ID this profile had was taken away, said to its owner:
  -- 'takeover' (another account proved control), 'renamed' (another Riot
  -- account now has that name) or 'gone' (the name no longer resolves).
  riot_lost_reason   text,
  riot_lost_at       timestamptz,
  rank_current       text,
  rank_peak          text,
  rank_at            timestamptz,
  stats              jsonb,
  stats_at           timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT social_profiles_username_shape CHECK (
    username IS NULL OR (username ~ '^[A-Za-z0-9_]{3,20}$' AND username ~ '[A-Za-z]')),
  CONSTRAINT social_profiles_username_key CHECK (
    (username IS NULL AND username_key IS NULL AND username_fold IS NULL)
    OR (username_key ~ '^[a-z0-9_]{3,20}$' AND username_fold ~ '^[a-z0-9_]{1,20}$')),
  CONSTRAINT social_profiles_public_needs_name CHECK (NOT is_public OR username IS NOT NULL),
  CONSTRAINT social_profiles_riot_shape CHECK (
    (riot_name IS NULL OR char_length(riot_name) BETWEEN 1 AND 32)
    AND (riot_tag IS NULL OR char_length(riot_tag) BETWEEN 1 AND 8)
    AND (riot_key IS NULL OR char_length(riot_key) BETWEEN 3 AND 48)
    AND (riot_region IS NULL OR riot_region ~ '^[a-z]{2,8}$')),
  CONSTRAINT social_profiles_verified_has_riot CHECK (
    NOT riot_verified OR (riot_name IS NOT NULL AND riot_tag IS NOT NULL AND riot_key IS NOT NULL AND riot_puuid_hash IS NOT NULL)),
  CONSTRAINT social_profiles_hash_shape CHECK (riot_puuid_hash IS NULL OR riot_puuid_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT social_profiles_lost_reason CHECK (riot_lost_reason IS NULL OR riot_lost_reason IN ('takeover', 'renamed', 'gone')),
  CONSTRAINT social_profiles_rank_shape CHECK (
    (rank_current IS NULL OR char_length(rank_current) <= 16) AND (rank_peak IS NULL OR char_length(rank_peak) <= 16)),
  CONSTRAINT social_profiles_stats_size CHECK (stats IS NULL OR octet_length(stats::text) <= 16384)
);

-- One username per profile, by its key, and none that reads as another (its fold).
CREATE UNIQUE INDEX IF NOT EXISTS social_profiles_username_key_key
  ON public.social_profiles (username_key) WHERE username_key IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS social_profiles_username_fold_key
  ON public.social_profiles (username_fold) WHERE username_fold IS NOT NULL;
-- One profile per Riot account at a time: the last to prove control holds it.
CREATE UNIQUE INDEX IF NOT EXISTS social_profiles_verified_puuid_key
  ON public.social_profiles (riot_puuid_hash) WHERE riot_verified;
-- Search by a username's start, and by a whole Riot ID, public profiles only.
CREATE INDEX IF NOT EXISTS social_profiles_search_name_idx
  ON public.social_profiles (username_key text_pattern_ops) WHERE is_public;
CREATE INDEX IF NOT EXISTS social_profiles_search_riot_idx
  ON public.social_profiles (riot_key) WHERE is_public AND riot_verified AND show_riot_id;

CREATE TABLE IF NOT EXISTS public.social_username_holds (
  username_fold text PRIMARY KEY,
  -- Null once the account that let it go is deleted: nothing of it is kept.
  user_id       uuid,
  released_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.social_blocks (
  blocker      uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  blocked      uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  -- The name AS THE BLOCKER TYPED IT, and the only one ever listed: neither
  -- the blocked player's exact casing nor a later rename is shown.
  blocked_name text NOT NULL CHECK (blocked_name ~ '^[A-Za-z0-9_]{1,20}$'),
  blocked_key  text NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (blocker, blocked),
  CONSTRAINT social_blocks_not_self CHECK (blocker <> blocked)
);
CREATE INDEX IF NOT EXISTS social_blocks_blocked_idx ON public.social_blocks (blocked);

CREATE TABLE IF NOT EXISTS public.social_riot_challenges (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  puuid_hash   text NOT NULL CHECK (puuid_hash ~ '^[0-9a-f]{64}$'),
  riot_name    text NOT NULL CHECK (char_length(riot_name) BETWEEN 1 AND 32),
  riot_tag     text NOT NULL CHECK (char_length(riot_tag) BETWEEN 1 AND 8),
  riot_region  text NOT NULL CHECK (riot_region ~ '^[a-z]{2,8}$'),
  -- The agents in order, three or four different ones, and the same as one
  -- word for the uniqueness index ("Sage,Jett,Sova").
  agents       text[] NOT NULL CHECK (cardinality(agents) BETWEEN 3 AND 4),
  seq          text NOT NULL CHECK (seq ~ '^[A-Za-z/]+(,[A-Za-z/]+){2,3}$'),
  issued_at    timestamptz NOT NULL DEFAULT now(),
  expires_at   timestamptz NOT NULL,
  status       text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'passed', 'expired', 'spent')),
  checks       integer NOT NULL DEFAULT 0,
  last_check_at timestamptz,
  last_result  text,
  progress     integer NOT NULL DEFAULT 0
);
-- One open challenge per account.
CREATE UNIQUE INDEX IF NOT EXISTS social_riot_challenges_open_key
  ON public.social_riot_challenges (user_id) WHERE status = 'open';
-- Never two open challenges with one sequence on one Riot account.
CREATE UNIQUE INDEX IF NOT EXISTS social_riot_challenges_open_seq_key
  ON public.social_riot_challenges (puuid_hash, seq) WHERE status = 'open';
CREATE INDEX IF NOT EXISTS social_riot_challenges_user_idx ON public.social_riot_challenges (user_id, issued_at);

CREATE TABLE IF NOT EXISTS public.social_riot_attempts (
  user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS social_riot_attempts_user_idx ON public.social_riot_attempts (user_id, at);

CREATE TABLE IF NOT EXISTS public.social_riot_used (
  puuid_hash   text PRIMARY KEY CHECK (puuid_hash ~ '^[0-9a-f]{64}$'),
  last_used_at timestamptz NOT NULL
);

-- ── Nothing through Supabase's public API ─────────────────────────────────
ALTER TABLE public.social_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.social_username_holds ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.social_blocks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.social_riot_challenges ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.social_riot_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.social_riot_used ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.social_profiles, public.social_username_holds, public.social_blocks, public.social_riot_challenges,
  public.social_riot_attempts, public.social_riot_used FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.social_profiles, public.social_username_holds, public.social_blocks, public.social_riot_challenges,
  public.social_riot_attempts, public.social_riot_used TO service_role;

-- ── A username let go is held (the trigger) ───────────────────────────────
-- By its fold: a change holds the old one for its owner; a deleted account's
-- is held with no user id at all. Holds older than 30 days are deleted on
-- every username write.
CREATE OR REPLACE FUNCTION public.social_hold_old_name()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
BEGIN
  IF OLD.username_fold IS NOT NULL AND (TG_OP = 'DELETE' OR OLD.username_fold IS DISTINCT FROM NEW.username_fold) THEN
    PERFORM pg_advisory_xact_lock(hashtext('social-name:' || OLD.username_fold));
    INSERT INTO public.social_username_holds (username_fold, user_id, released_at)
    VALUES (OLD.username_fold, CASE WHEN TG_OP = 'DELETE' THEN NULL ELSE OLD.user_id END, now())
    ON CONFLICT (username_fold) DO UPDATE SET user_id = EXCLUDED.user_id, released_at = EXCLUDED.released_at;
  END IF;
  IF TG_OP = 'DELETE' THEN
    -- The account is gone: none of its holds keeps its id.
    UPDATE public.social_username_holds SET user_id = NULL WHERE user_id = OLD.user_id;
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS social_profiles_hold_name ON public.social_profiles;
CREATE TRIGGER social_profiles_hold_name
  AFTER UPDATE OF username_fold OR DELETE ON public.social_profiles
  FOR EACH ROW EXECUTE FUNCTION public.social_hold_old_name();

-- ── The functions the server calls ────────────────────────────────────────

-- Live: the tables are here.
CREATE OR REPLACE FUNCTION public.social_status()
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $function$
  SELECT (SELECT count(*) FROM (SELECT 1 FROM public.social_profiles LIMIT 1) p) >= 0
     AND (SELECT count(*) FROM (SELECT 1 FROM public.social_blocks LIMIT 1) b) >= 0
     AND (SELECT count(*) FROM (SELECT 1 FROM public.social_username_holds LIMIT 1) h) >= 0
     AND (SELECT count(*) FROM (SELECT 1 FROM public.social_riot_challenges LIMIT 1) c) >= 0
     AND (SELECT count(*) FROM (SELECT 1 FROM public.social_riot_attempts LIMIT 1) a) >= 0
     AND (SELECT count(*) FROM (SELECT 1 FROM public.social_riot_used LIMIT 1) u) >= 0;
$function$;

-- The owner's own profile, everything they may see of it, or null.
CREATE OR REPLACE FUNCTION public.social_me(p_user uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $function$
  SELECT jsonb_build_object(
    'username', p.username, 'username_set_at', p.username_set_at,
    'public', p.is_public, 'show_riot_id', p.show_riot_id, 'discoverable', p.discoverable,
    'riot_name', CASE WHEN p.riot_verified THEN p.riot_name END,
    'riot_tag', CASE WHEN p.riot_verified THEN p.riot_tag END,
    'riot_verified', p.riot_verified, 'riot_verified_at', p.riot_verified_at,
    'riot_lost_reason', p.riot_lost_reason, 'riot_lost_at', p.riot_lost_at,
    'rank_current', p.rank_current, 'rank_peak', p.rank_peak, 'rank_at', p.rank_at,
    'stats_at', p.stats_at,
    'blocked', COALESCE((SELECT jsonb_agg(b.blocked_name ORDER BY b.blocked_key)
                         FROM public.social_blocks b WHERE b.blocker = p.user_id), '[]'::jsonb))
  FROM public.social_profiles p
  WHERE p.user_id = p_user;
$function$;

-- Whether a username (its key and fold) could be this account's now:
-- 'free', 'yours', 'taken' (that name, or one that reads as it) or 'held'.
CREATE OR REPLACE FUNCTION public.social_name_free(p_user uuid, p_key text, p_fold text, p_hold_days integer)
RETURNS text
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $function$
  SELECT CASE
    WHEN EXISTS (SELECT 1 FROM public.social_profiles WHERE username_key = p_key AND user_id = p_user) THEN 'yours'
    WHEN EXISTS (SELECT 1 FROM public.social_profiles WHERE (username_key = p_key OR username_fold = p_fold) AND user_id <> p_user) THEN 'taken'
    WHEN EXISTS (SELECT 1 FROM public.social_username_holds h WHERE h.username_fold = p_fold
                   AND h.user_id IS DISTINCT FROM p_user AND h.released_at > now() - make_interval(days => p_hold_days)) THEN 'held'
    ELSE 'free' END;
$function$;

-- Pick or change the username: { ok, reason, next_at }. reason: 'set',
-- 'same', 'case', 'held', 'taken', 'too-soon'. The shape and the word rules
-- are the server's (social.js checkUsername) and the CHECK's.
-- LOCKS FIRST: the account's own row, then the new fold and the old one by an
-- advisory lock each in order (the trigger takes the old one's too), and only
-- then the hold is read, so a pick racing a release waits for it.
CREATE OR REPLACE FUNCTION public.social_set_username(p_user uuid, p_username text, p_key text, p_fold text, p_change_days integer, p_hold_days integer)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
DECLARE
  r public.social_profiles%ROWTYPE;
  v_found boolean;
BEGIN
  SELECT * INTO r FROM public.social_profiles WHERE user_id = p_user FOR UPDATE;
  v_found := FOUND;
  IF v_found AND r.username_fold IS NOT NULL AND r.username_fold < p_fold THEN
    PERFORM pg_advisory_xact_lock(hashtext('social-name:' || r.username_fold));
    PERFORM pg_advisory_xact_lock(hashtext('social-name:' || p_fold));
  ELSIF v_found AND r.username_fold IS NOT NULL AND r.username_fold > p_fold THEN
    PERFORM pg_advisory_xact_lock(hashtext('social-name:' || p_fold));
    PERFORM pg_advisory_xact_lock(hashtext('social-name:' || r.username_fold));
  ELSE
    PERFORM pg_advisory_xact_lock(hashtext('social-name:' || p_fold));
  END IF;
  DELETE FROM public.social_username_holds WHERE released_at < now() - make_interval(days => p_hold_days);
  IF EXISTS (SELECT 1 FROM public.social_username_holds h WHERE h.username_fold = p_fold
               AND h.user_id IS DISTINCT FROM p_user) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'held');
  END IF;
  IF EXISTS (SELECT 1 FROM public.social_profiles WHERE (username_key = p_key OR username_fold = p_fold) AND user_id <> p_user) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'taken');
  END IF;
  IF NOT v_found THEN
    INSERT INTO public.social_profiles (user_id, username, username_key, username_fold, username_set_at)
    VALUES (p_user, p_username, p_key, p_fold, now());
    RETURN jsonb_build_object('ok', true, 'reason', 'set');
  END IF;
  IF r.username = p_username THEN
    RETURN jsonb_build_object('ok', true, 'reason', 'same');
  END IF;
  IF r.username_key = p_key THEN
    UPDATE public.social_profiles SET username = p_username, updated_at = now() WHERE user_id = p_user;
    RETURN jsonb_build_object('ok', true, 'reason', 'case');
  END IF;
  IF r.username IS NOT NULL AND r.username_set_at > now() - make_interval(days => p_change_days) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'too-soon',
      'next_at', r.username_set_at + make_interval(days => p_change_days));
  END IF;
  UPDATE public.social_profiles SET username = p_username, username_key = p_key, username_fold = p_fold,
    username_set_at = now(), updated_at = now()
  WHERE user_id = p_user;
  RETURN jsonb_build_object('ok', true, 'reason', 'set');
EXCEPTION WHEN unique_violation THEN
  RETURN jsonb_build_object('ok', false, 'reason', 'taken');
END;
$function$;

-- The three switches (a null leaves one as it is). Private takes the
-- snapshot away at once. { ok, reason }: 'no-username' with no profile.
CREATE OR REPLACE FUNCTION public.social_set_flags(p_user uuid, p_public boolean, p_show_riot_id boolean, p_discoverable boolean)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
BEGIN
  UPDATE public.social_profiles SET
    is_public = COALESCE(p_public, is_public),
    show_riot_id = COALESCE(p_show_riot_id, show_riot_id),
    discoverable = COALESCE(p_discoverable, discoverable),
    stats = CASE WHEN COALESCE(p_public, is_public) THEN stats ELSE NULL END,
    stats_at = CASE WHEN COALESCE(p_public, is_public) THEN stats_at ELSE NULL END,
    updated_at = now()
  WHERE user_id = p_user AND username IS NOT NULL;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'reason', 'no-username'); END IF;
  RETURN jsonb_build_object('ok', true);
END;
$function$;

-- The snapshot, kept only on a public profile. { ok, reason }: 'private', 'too-big'.
CREATE OR REPLACE FUNCTION public.social_put_stats(p_user uuid, p_stats jsonb, p_max integer)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
BEGIN
  IF p_stats IS NULL OR jsonb_typeof(p_stats) <> 'object' OR octet_length(p_stats::text) > LEAST(p_max, 16384) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'too-big');
  END IF;
  UPDATE public.social_profiles SET stats = p_stats, stats_at = now(), updated_at = now()
  WHERE user_id = p_user AND is_public;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'reason', 'private'); END IF;
  RETURN jsonb_build_object('ok', true);
END;
$function$;

-- A profile as the viewer may see it, or null: not there, private (to anyone
-- but its owner), or either of the two blocked the other all answer null.
-- A Riot ID only once proved, and only with its switch on (and the server's
-- SOCIAL_RIOT_PROOF on, which the route applies).
CREATE OR REPLACE FUNCTION public.social_view(p_viewer uuid, p_key text, p_rank_ms bigint)
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $function$
  SELECT jsonb_build_object(
    'username', p.username, 'self', p.user_id = p_viewer, 'public', p.is_public,
    'verified', p.riot_verified,
    'riot_name', CASE WHEN p.riot_verified AND p.show_riot_id THEN p.riot_name END,
    'riot_tag', CASE WHEN p.riot_verified AND p.show_riot_id THEN p.riot_tag END,
    'rank_current', CASE WHEN p.riot_verified THEN p.rank_current END,
    'rank_peak', CASE WHEN p.riot_verified THEN p.rank_peak END,
    'rank_at', CASE WHEN p.riot_verified THEN p.rank_at END,
    'rank_due', p.riot_verified AND (p.rank_at IS NULL OR p.rank_at < now() - make_interval(secs => p_rank_ms / 1000.0)),
    'stats', p.stats,
    'stats_at', p.stats_at)
  FROM public.social_profiles p
  WHERE p.username_key = p_key
    AND (p.is_public OR p.user_id = p_viewer)
    AND NOT EXISTS (SELECT 1 FROM public.social_blocks b
                    WHERE (b.blocker = p_viewer AND b.blocked = p.user_id) OR (b.blocker = p.user_id AND b.blocked = p_viewer));
$function$;

-- Search, public profiles only, never a blocked pair, at most 10:
--   'name'  a username key's start, 3 characters at least
--   'riot'  a whole Riot ID's key exactly ('name#tag', as social.js keyOf makes it)
-- The start is matched literally: % and _ and \ in it are not wildcards.
CREATE OR REPLACE FUNCTION public.social_search(p_viewer uuid, p_mode text, p_key text, p_limit integer)
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $function$
  WITH q AS (
    SELECT replace(replace(replace(COALESCE(p_key, ''), '\', '\\'), '%', '\%'), '_', '\_') || '%' AS pre
  )
  SELECT COALESCE(jsonb_agg(s.x ORDER BY s.ord), '[]'::jsonb) FROM (
    SELECT jsonb_build_object(
      'username', p.username,
      'riot_name', CASE WHEN p.riot_verified AND p.show_riot_id THEN p.riot_name END,
      'riot_tag', CASE WHEN p.riot_verified AND p.show_riot_id THEN p.riot_tag END,
      'rank_current', CASE WHEN p.riot_verified THEN p.rank_current END,
      'verified', p.riot_verified,
      'pc_rank', p.stats -> 'rank' ->> 'current',
      'agent', p.stats -> 'agents' -> 0 ->> 'name',
      'grade', p.stats -> 'grade' ->> 'avg') AS x,
      p.username_key AS ord
    FROM public.social_profiles p, q
    WHERE p.is_public AND p.username IS NOT NULL
      AND CASE p_mode
        WHEN 'name' THEN char_length(p_key) >= 3 AND p.username_key LIKE q.pre
        WHEN 'riot' THEN p.riot_verified AND p.show_riot_id AND p.riot_key = p_key
        ELSE false END
      AND NOT EXISTS (SELECT 1 FROM public.social_blocks b
                      WHERE (b.blocker = p_viewer AND b.blocked = p.user_id) OR (b.blocker = p.user_id AND b.blocked = p_viewer))
    ORDER BY p.username_key
    LIMIT LEAST(GREATEST(COALESCE(p_limit, 10), 1), 10)
  ) s;
$function$;

-- Block a username (its key, and the name as the blocker typed it) or
-- unblock a name on the blocker's own list (by its key): { ok, reason }. A
-- name that is no profile is answered ok as well, so a block says nothing
-- about who exists. Refused: 'self', 'too-many' (p_max).
CREATE OR REPLACE FUNCTION public.social_block(p_user uuid, p_key text, p_name text, p_on boolean, p_max integer)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
DECLARE
  v_target uuid;
BEGIN
  IF NOT p_on THEN
    DELETE FROM public.social_blocks WHERE blocker = p_user AND blocked_key = p_key;
    RETURN jsonb_build_object('ok', true);
  END IF;
  SELECT user_id INTO v_target FROM public.social_profiles WHERE username_key = p_key;
  IF v_target IS NULL THEN RETURN jsonb_build_object('ok', true); END IF;
  IF v_target = p_user THEN RETURN jsonb_build_object('ok', false, 'reason', 'self'); END IF;
  IF (SELECT count(*) FROM public.social_blocks WHERE blocker = p_user) >= p_max
     AND NOT EXISTS (SELECT 1 FROM public.social_blocks WHERE blocker = p_user AND blocked = v_target) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'too-many');
  END IF;
  INSERT INTO public.social_blocks (blocker, blocked, blocked_name, blocked_key) VALUES (p_user, v_target, p_name, p_key)
  ON CONFLICT DO NOTHING;
  RETURN jsonb_build_object('ok', true);
END;
$function$;

-- What a report names for the owner's inbox: the profile's opaque id and its
-- username, only when the reporter can see it (as social_view), else null.
CREATE OR REPLACE FUNCTION public.social_report_target(p_viewer uuid, p_key text)
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $function$
  SELECT jsonb_build_object('public_id', p.public_id, 'username', p.username)
  FROM public.social_profiles p
  WHERE p.username_key = p_key AND p.is_public AND p.user_id <> p_viewer
    AND NOT EXISTS (SELECT 1 FROM public.social_blocks b
                    WHERE (b.blocker = p_viewer AND b.blocked = p.user_id) OR (b.blocker = p.user_id AND b.blocked = p_viewer));
$function$;

-- ── The proof of control (docs/claude/social.md) ──────────────────────────
-- NOTHING HERE DEPENDS ON WHAT OTHER ACCOUNTS DID WITH A RIOT ID, but the
-- one rule that keeps two open challenges on one Riot account from sharing a
-- sequence, whose refusal the route says as the ordinary "try again later".

-- A start of a proof, counted BEFORE Riot is asked: { open, reason }. The
-- account's open challenge is answered as it is (nothing counted); else
-- refused 'no-username', 'day' (p_day a rolling day) or 'month' (p_month in
-- 30 days); else the attempt is written and counts whatever follows.
CREATE OR REPLACE FUNCTION public.social_challenge_attempt(p_user uuid, p_day integer, p_month integer)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
DECLARE
  c public.social_riot_challenges%ROWTYPE;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('social-challenge-user:' || p_user::text));
  UPDATE public.social_riot_challenges SET status = 'expired' WHERE user_id = p_user AND status = 'open' AND expires_at <= now();
  IF NOT EXISTS (SELECT 1 FROM public.social_profiles WHERE user_id = p_user AND username IS NOT NULL) THEN
    RETURN jsonb_build_object('open', NULL, 'reason', 'no-username');
  END IF;
  SELECT * INTO c FROM public.social_riot_challenges WHERE user_id = p_user AND status = 'open';
  IF FOUND THEN RETURN jsonb_build_object('open', to_jsonb(c) - 'user_id' - 'puuid_hash', 'reason', NULL); END IF;
  IF (SELECT count(*) FROM public.social_riot_attempts WHERE user_id = p_user AND at > now() - interval '1 day') >= p_day THEN
    RETURN jsonb_build_object('open', NULL, 'reason', 'day');
  END IF;
  IF (SELECT count(*) FROM public.social_riot_attempts WHERE user_id = p_user AND at > now() - interval '30 days') >= p_month THEN
    RETURN jsonb_build_object('open', NULL, 'reason', 'month');
  END IF;
  DELETE FROM public.social_riot_attempts WHERE user_id = p_user AND at < now() - interval '31 days';
  INSERT INTO public.social_riot_attempts (user_id) VALUES (p_user);
  RETURN jsonb_build_object('open', NULL, 'reason', NULL);
END;
$function$;

-- A new challenge: under a lock on the Riot account, the first sequence of
-- p_candidates (the server's list for this account, in an order p_seed
-- shuffles) that no OPEN challenge on the same Riot account holds, by
-- anyone. { ok, reason, challenge }: 'open' (this account's open one is
-- answered), 'busy' (every candidate is held: the route says "try again").
CREATE OR REPLACE FUNCTION public.social_challenge_start(p_user uuid, p_hash text, p_name text, p_tag text, p_region text,
  p_candidates text[], p_seed text, p_ttl_ms bigint)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
DECLARE
  c public.social_riot_challenges%ROWTYPE;
  v_seq text;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('social-challenge-riot:' || p_hash));
  UPDATE public.social_riot_challenges SET status = 'expired' WHERE puuid_hash = p_hash AND status = 'open' AND expires_at <= now();
  SELECT * INTO c FROM public.social_riot_challenges WHERE user_id = p_user AND status = 'open' AND expires_at > now();
  IF FOUND THEN RETURN jsonb_build_object('ok', false, 'reason', 'open', 'challenge', to_jsonb(c) - 'user_id' - 'puuid_hash'); END IF;
  SELECT x INTO v_seq FROM unnest(p_candidates) AS x
  WHERE x ~ '^[A-Za-z/]+(,[A-Za-z/]+){2,3}$'
    AND NOT EXISTS (SELECT 1 FROM public.social_riot_challenges o WHERE o.puuid_hash = p_hash AND o.status = 'open' AND o.seq = x)
  ORDER BY md5(x || COALESCE(p_seed, '')) LIMIT 1;
  IF v_seq IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'busy'); END IF;
  INSERT INTO public.social_riot_challenges (user_id, puuid_hash, riot_name, riot_tag, riot_region, agents, seq, expires_at)
  VALUES (p_user, p_hash, p_name, p_tag, p_region, string_to_array(v_seq, ','), v_seq, now() + make_interval(secs => p_ttl_ms / 1000.0))
  RETURNING * INTO c;
  RETURN jsonb_build_object('ok', true, 'reason', NULL, 'challenge', to_jsonb(c) - 'user_id' - 'puuid_hash');
EXCEPTION WHEN unique_violation THEN
  -- This account's own open challenge raced in: answered as it stands.
  SELECT * INTO c FROM public.social_riot_challenges WHERE user_id = p_user AND status = 'open';
  IF FOUND THEN RETURN jsonb_build_object('ok', false, 'reason', 'open', 'challenge', to_jsonb(c) - 'user_id' - 'puuid_hash'); END IF;
  RETURN jsonb_build_object('ok', false, 'reason', 'busy');
END;
$function$;

-- The account's open challenge (closing it when expired), else its newest
-- one of the last day, for the Profile page; null with none.
CREATE OR REPLACE FUNCTION public.social_challenge_get(p_user uuid)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
DECLARE
  c public.social_riot_challenges%ROWTYPE;
BEGIN
  UPDATE public.social_riot_challenges SET status = 'expired' WHERE user_id = p_user AND status = 'open' AND expires_at <= now();
  SELECT * INTO c FROM public.social_riot_challenges WHERE user_id = p_user
    AND (status = 'open' OR issued_at > now() - interval '1 day') ORDER BY (status = 'open') DESC, issued_at DESC LIMIT 1;
  IF NOT FOUND THEN RETURN NULL; END IF;
  RETURN to_jsonb(c) - 'user_id' - 'puuid_hash';
END;
$function$;

-- A check is about to read Riot's record: { ok, reason, challenge, hash,
-- used_until }. Refused before any HenrikDev call: 'none' (no open
-- challenge), 'expired', 'too-soon' (p_gap_ms since the last check),
-- 'too-many' (p_max checks, the challenge is then spent). The hash and
-- used_until (the start of the last match a proof on this Riot account used)
-- go to the server only, never a player.
CREATE OR REPLACE FUNCTION public.social_challenge_note_check(p_user uuid, p_gap_ms bigint, p_max integer)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
DECLARE
  c public.social_riot_challenges%ROWTYPE;
BEGIN
  SELECT * INTO c FROM public.social_riot_challenges WHERE user_id = p_user AND status = 'open' FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'reason', 'none'); END IF;
  IF c.expires_at <= now() THEN
    UPDATE public.social_riot_challenges SET status = 'expired' WHERE id = c.id;
    RETURN jsonb_build_object('ok', false, 'reason', 'expired');
  END IF;
  IF c.last_check_at IS NOT NULL AND c.last_check_at > now() - make_interval(secs => p_gap_ms / 1000.0) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'too-soon', 'challenge', to_jsonb(c) - 'user_id' - 'puuid_hash');
  END IF;
  IF c.checks >= p_max THEN
    UPDATE public.social_riot_challenges SET status = 'spent' WHERE id = c.id;
    RETURN jsonb_build_object('ok', false, 'reason', 'too-many');
  END IF;
  UPDATE public.social_riot_challenges SET checks = checks + 1, last_check_at = now() WHERE id = c.id RETURNING * INTO c;
  RETURN jsonb_build_object('ok', true, 'reason', NULL, 'challenge', to_jsonb(c) - 'user_id' - 'puuid_hash', 'hash', c.puuid_hash,
    'used_until', (SELECT last_used_at FROM public.social_riot_used WHERE puuid_hash = c.puuid_hash));
END;
$function$;

-- A check Riot could not answer (try later) gives its count back.
CREATE OR REPLACE FUNCTION public.social_challenge_refund(p_user uuid, p_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
BEGIN
  UPDATE public.social_riot_challenges SET checks = GREATEST(checks - 1, 0)
  WHERE id = p_id AND user_id = p_user AND status = 'open';
  RETURN FOUND;
END;
$function$;

-- What a check found, kept for the page (one word, and how many agents of
-- the sequence are done).
CREATE OR REPLACE FUNCTION public.social_challenge_result(p_user uuid, p_id uuid, p_result text, p_progress integer)
RETURNS boolean
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
BEGIN
  UPDATE public.social_riot_challenges SET last_result = left(p_result, 24), progress = GREATEST(0, LEAST(COALESCE(p_progress, 0), 4)),
    status = CASE WHEN p_result = 'expired' THEN 'expired' ELSE status END
  WHERE id = p_id AND user_id = p_user AND status = 'open';
  RETURN FOUND;
END;
$function$;

-- PASSED: under the Riot account's lock, the matches used (p_first to
-- p_last, their start times from Riot's match records) must all be newer
-- than the last proof's on this Riot account and inside the window; then
-- the profile holds the Riot ID, ANY other profile holding that Riot account
-- loses it ('takeover': proof of current control wins), and the matches are
-- spent. { ok, reason }: 'none', 'no-username', 'used' (matches a proof
-- already used), 'window'.
CREATE OR REPLACE FUNCTION public.social_challenge_pass(p_user uuid, p_id uuid, p_name text, p_tag text, p_key text,
  p_first timestamptz, p_last timestamptz)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
DECLARE
  c public.social_riot_challenges%ROWTYPE;
  v_used timestamptz;
BEGIN
  SELECT * INTO c FROM public.social_riot_challenges WHERE id = p_id AND user_id = p_user;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'reason', 'none'); END IF;
  PERFORM pg_advisory_xact_lock(hashtext('social-challenge-riot:' || c.puuid_hash));
  SELECT * INTO c FROM public.social_riot_challenges WHERE id = p_id AND user_id = p_user AND status = 'open' FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'reason', 'none'); END IF;
  IF p_first IS NULL OR p_last IS NULL OR p_first <= c.issued_at OR p_last >= c.expires_at OR p_last < p_first THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'window');
  END IF;
  SELECT last_used_at INTO v_used FROM public.social_riot_used WHERE puuid_hash = c.puuid_hash;
  IF v_used IS NOT NULL AND p_first <= v_used THEN RETURN jsonb_build_object('ok', false, 'reason', 'used'); END IF;
  PERFORM 1 FROM public.social_profiles WHERE user_id = p_user AND username IS NOT NULL FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'reason', 'no-username'); END IF;
  UPDATE public.social_profiles SET riot_verified = false, riot_name = NULL, riot_tag = NULL, riot_key = NULL,
    riot_region = NULL, riot_puuid_hash = NULL, riot_verified_at = NULL, riot_gone_at = NULL, rank_current = NULL, rank_peak = NULL, rank_at = NULL,
    riot_lost_reason = 'takeover', riot_lost_at = now(), updated_at = now()
  WHERE riot_verified AND riot_puuid_hash = c.puuid_hash AND user_id <> p_user;
  UPDATE public.social_profiles SET riot_verified = true, riot_name = p_name, riot_tag = p_tag, riot_key = p_key,
    riot_region = c.riot_region, riot_puuid_hash = c.puuid_hash, riot_verified_at = now(), riot_gone_at = NULL,
    riot_lost_reason = NULL, riot_lost_at = NULL, rank_current = NULL, rank_peak = NULL, rank_at = NULL, updated_at = now()
  WHERE user_id = p_user;
  INSERT INTO public.social_riot_used (puuid_hash, last_used_at) VALUES (c.puuid_hash, p_last)
  ON CONFLICT (puuid_hash) DO UPDATE SET last_used_at = GREATEST(public.social_riot_used.last_used_at, EXCLUDED.last_used_at);
  UPDATE public.social_riot_challenges SET status = 'passed', last_result = 'passed' WHERE id = c.id;
  RETURN jsonb_build_object('ok', true, 'reason', NULL);
END;
$function$;

-- Another Riot account is behind the name the profile proved: hidden and out
-- of search until its owner proves it again ('renamed').
CREATE OR REPLACE FUNCTION public.social_unverify(p_key uuid, p_hash text)
RETURNS boolean
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
BEGIN
  UPDATE public.social_profiles SET riot_verified = false, riot_name = NULL, riot_tag = NULL, riot_key = NULL,
    riot_region = NULL, riot_puuid_hash = NULL, riot_verified_at = NULL, riot_gone_at = NULL, rank_current = NULL, rank_peak = NULL, rank_at = NULL,
    riot_lost_reason = 'renamed', riot_lost_at = now(), updated_at = now()
  WHERE public_id = p_key AND riot_verified AND riot_puuid_hash = p_hash;
  RETURN FOUND;
END;
$function$;

-- No account behind the name: the first time is noted ('noted'); a second
-- time at least p_min_ms after the first unverifies as 'gone' ('unverified').
CREATE OR REPLACE FUNCTION public.social_note_gone(p_key uuid, p_hash text, p_min_ms bigint)
RETURNS text
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
DECLARE
  v_gone timestamptz;
BEGIN
  SELECT riot_gone_at INTO v_gone FROM public.social_profiles WHERE public_id = p_key AND riot_verified AND riot_puuid_hash = p_hash FOR UPDATE;
  IF NOT FOUND THEN RETURN 'none'; END IF;
  IF v_gone IS NULL OR v_gone > now() - make_interval(secs => p_min_ms / 1000.0) THEN
    UPDATE public.social_profiles SET riot_gone_at = COALESCE(riot_gone_at, now()), rank_at = now() WHERE public_id = p_key;
    RETURN 'noted';
  END IF;
  UPDATE public.social_profiles SET riot_verified = false, riot_name = NULL, riot_tag = NULL, riot_key = NULL,
    riot_region = NULL, riot_puuid_hash = NULL, riot_verified_at = NULL, riot_gone_at = NULL, rank_current = NULL, rank_peak = NULL, rank_at = NULL,
    riot_lost_reason = 'gone', riot_lost_at = now(), updated_at = now()
  WHERE public_id = p_key;
  RETURN 'unverified';
END;
$function$;

-- What the server needs to look a verified profile's rank up, when it is due
-- (never looked up, or longer ago than p_rank_ms): the opaque key, Riot's name
-- and tag and the hash the answer must match. By the owner (p_user) or by a
-- public username key. Null when not verified or not due.
CREATE OR REPLACE FUNCTION public.social_rank_due(p_user uuid, p_key text, p_rank_ms bigint)
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $function$
  SELECT jsonb_build_object('key', p.public_id, 'riot_name', p.riot_name, 'riot_tag', p.riot_tag, 'hash', p.riot_puuid_hash)
  FROM public.social_profiles p
  WHERE p.riot_verified
    AND ((p_user IS NOT NULL AND p.user_id = p_user) OR (p_user IS NULL AND p.is_public AND p.username_key = p_key))
    AND (p.rank_at IS NULL OR p.rank_at < now() - make_interval(secs => p_rank_ms / 1000.0))
  LIMIT 1;
$function$;

-- The rank looked up, kept only while the profile still holds that Riot account.
CREATE OR REPLACE FUNCTION public.social_set_rank(p_key uuid, p_hash text, p_current text, p_peak text)
RETURNS boolean
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
BEGIN
  UPDATE public.social_profiles SET rank_current = p_current, rank_peak = p_peak, rank_at = now(), riot_gone_at = NULL, updated_at = now()
  WHERE public_id = p_key AND riot_verified AND riot_puuid_hash = p_hash;
  RETURN FOUND;
END;
$function$;

-- ── Only the service role may call them ───────────────────────────────────
-- THE FUNCTIONS THIS MIGRATION CREATES, by signature, the same list as the
-- undo's (test:socialsql holds that every function created above is in it,
-- and that nothing else is touched).
DO $grants$
DECLARE
  f text;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'public.social_hold_old_name()',
    'public.social_status()',
    'public.social_me(uuid)',
    'public.social_name_free(uuid, text, text, integer)',
    'public.social_set_username(uuid, text, text, text, integer, integer)',
    'public.social_set_flags(uuid, boolean, boolean, boolean)',
    'public.social_put_stats(uuid, jsonb, integer)',
    'public.social_view(uuid, text, bigint)',
    'public.social_search(uuid, text, text, integer)',
    'public.social_block(uuid, text, text, boolean, integer)',
    'public.social_report_target(uuid, text)',
    'public.social_challenge_attempt(uuid, integer, integer)',
    'public.social_challenge_start(uuid, text, text, text, text, text[], text, bigint)',
    'public.social_challenge_get(uuid)',
    'public.social_challenge_note_check(uuid, bigint, integer)',
    'public.social_challenge_refund(uuid, uuid)',
    'public.social_challenge_result(uuid, uuid, text, integer)',
    'public.social_challenge_pass(uuid, uuid, text, text, text, timestamptz, timestamptz)',
    'public.social_unverify(uuid, text)',
    'public.social_note_gone(uuid, text, bigint)',
    'public.social_rank_due(uuid, text, bigint)',
    'public.social_set_rank(uuid, text, text, text)'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', f);
  END LOOP;
END;
$grants$;

-- PostgREST reads the new functions at once.
NOTIFY pgrst, 'reload schema';
