-- OCCLARA DUOS (docs/claude/duos.md). Needs social-001-profiles.sql first,
-- and the accounts tables every live server already has (public.entitlements,
-- public.game_usage). Run 001 before this, undo this before 001's undo.
--
-- A duo is two friends, made by an invite one of them sends while on a Max
-- plan (by exact username, or by a code sent any way they like). It is ACTIVE
-- while at least one of the two is on Max (read FRESH from public.entitlements
-- on every call, so a plan that lapsed or was refunded pauses the duo on the
-- next read with nothing written), PAUSED while neither is, and ENDED when
-- either removes the other or blocks them (a trigger on social_blocks). For a
-- match both played on one team and both reviewed, each one's app uploads a
-- compact sheet of numbers and fixed words, and its clips, which the other
-- may open and pin. Everything shared expires 30 days after the match.
--
-- WHAT THIS CREATES, all in public, all reached only by the server's service
-- role (row level security on, no policy, every privilege of PUBLIC, anon and
-- authenticated revoked, EXECUTE on each function below granted to the
-- service role alone), and one private storage bucket:
--
--   social_duo_invites  an invite: from, to (a profile, or none), the name as
--                       the sender typed it, or a code's salted hash; 7 days
--   social_duo_pairs    a duo: the two accounts (ordered), paired or ended,
--                       who ended it and why, when each last saw the pins,
--                       each member's storage tag
--   social_duo_reports  "I reviewed this match": the match id as the server's
--                       salted hash, the team as its agents, the own agent,
--                       the live game row it spent; kept 3 days
--   social_duo_matches  a match two partners reported: the pair, the hash, when,
--                       and when it expires (30 days on)
--   social_duo_sheets   each member's sheet of a shared match (numbers and keys)
--   social_duo_clips    each clip uploaded or being uploaded: its storage path
--                       (chosen here), its size, its marks
--   social_duo_pins     a partner's mark on a moment of the other's clip: a
--                       label and a reaction from fixed lists, never text
--   social_duo_bytes    every upload and download in bytes, for the quotas
--   social_duo_trash    storage paths to delete (a clip row gone, by any path:
--                       its expiry, the duo ended, an account deleted), kept
--                       until the server removed the object after its upload
--                       URL could last
--   social_duo_guesses  wrong invite codes, counted per account
--   bucket duo-clips    private, 80 MB a file, video/x-matroska only
--
-- HOW TO RUN IT: paste the whole file into the Supabase SQL editor and press
-- Run. It is idempotent. Nothing changes for players until SOCIAL_DUOS_ON=1
-- (and SOCIAL_ON=1) is set on the server. If the bucket insert at the end is
-- refused by the project, it says so in a NOTICE: then make the bucket in the
-- dashboard by hand (Storage, New bucket, name duo-clips, private, file size
-- limit 80 MB, allowed MIME types video/x-matroska).
-- To take it away: FIRST run `node server/scripts/duos-purge.js --apply` (it
-- removes every stored clip through the Storage API: deleting rows here never
-- deletes the files), then social-002-duos-undo.sql.
--
-- No user id, email, puuid, match id or hash ever leaves through a route:
-- every row a route answers has a short random `ref` of its own.

-- ── A short random reference for a row ────────────────────────────────────
CREATE OR REPLACE FUNCTION public.social_duo_new_ref()
RETURNS text
LANGUAGE sql
VOLATILE
SET search_path TO 'public'
AS $function$
  SELECT left(replace(gen_random_uuid()::text, '-', ''), 12) || left(replace(gen_random_uuid()::text, '-', ''), 4);
$function$;

-- ── The tables ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.social_duo_invites (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ref         text NOT NULL UNIQUE DEFAULT public.social_duo_new_ref() CHECK (ref ~ '^[0-9a-f]{16}$'),
  from_user   uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  -- The profile it reaches, or null: a code, or a name that is no profile
  -- this sender may reach (the sender is told the same either way).
  to_user     uuid REFERENCES auth.users (id) ON DELETE CASCADE,
  -- As the sender typed it, and the only name of the invitee ever listed.
  to_name     text CHECK (to_name IS NULL OR to_name ~ '^[A-Za-z0-9_]{1,20}$'),
  -- Its key, made by the server (NFKC, lower case), never Postgres lower().
  to_key      text CHECK (to_key IS NULL OR char_length(to_key) BETWEEN 1 AND 40),
  code_hash   text UNIQUE CHECK (code_hash IS NULL OR code_hash ~ '^[0-9a-f]{64}$'),
  status      text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'accepted', 'declined', 'cancelled')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL,
  CONSTRAINT social_duo_invites_kind CHECK ((to_name IS NULL) <> (code_hash IS NULL) AND (to_name IS NULL) = (to_key IS NULL)),
  CONSTRAINT social_duo_invites_not_self CHECK (to_user IS NULL OR to_user <> from_user)
);
CREATE INDEX IF NOT EXISTS social_duo_invites_from_idx ON public.social_duo_invites (from_user, status);
CREATE INDEX IF NOT EXISTS social_duo_invites_to_idx ON public.social_duo_invites (to_user, status);

CREATE TABLE IF NOT EXISTS public.social_duo_pairs (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ref         text NOT NULL UNIQUE DEFAULT public.social_duo_new_ref() CHECK (ref ~ '^[0-9a-f]{16}$'),
  user_a      uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  user_b      uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  -- Each member's part of a storage path: random, of this duo only.
  tag_a       text NOT NULL DEFAULT public.social_duo_new_ref() CHECK (tag_a ~ '^[0-9a-f]{16}$'),
  tag_b       text NOT NULL DEFAULT public.social_duo_new_ref() CHECK (tag_b ~ '^[0-9a-f]{16}$'),
  status      text NOT NULL DEFAULT 'paired' CHECK (status IN ('paired', 'ended')),
  ended_by    uuid,
  ended_why   text CHECK (ended_why IS NULL OR ended_why IN ('removed', 'blocked')),
  paired_at   timestamptz NOT NULL DEFAULT now(),
  ended_at    timestamptz,
  a_seen_at   timestamptz NOT NULL DEFAULT now(),
  b_seen_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT social_duo_pairs_order CHECK (user_a < user_b)
);
-- One live duo per two accounts.
CREATE UNIQUE INDEX IF NOT EXISTS social_duo_pairs_live_key ON public.social_duo_pairs (user_a, user_b) WHERE status = 'paired';
CREATE INDEX IF NOT EXISTS social_duo_pairs_b_idx ON public.social_duo_pairs (user_b);

CREATE TABLE IF NOT EXISTS public.social_duo_reports (
  user_id     uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  match_hash  text NOT NULL CHECK (match_hash ~ '^[0-9a-f]{64}$'),
  -- The team as its agents, sorted, then the other team's: "Jett,Omen,...|Fade,...".
  team        text NOT NULL CHECK (char_length(team) BETWEEN 3 AND 200 AND team ~ '^[A-Za-z/,|]+$'),
  agent       text NOT NULL CHECK (agent ~ '^[A-Za-z/]{2,24}$'),
  -- The live game row of game_usage this report spent: one report a game.
  usage_id    text NOT NULL CHECK (char_length(usage_id) BETWEEN 1 AND 64),
  at          timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, match_hash)
);
CREATE UNIQUE INDEX IF NOT EXISTS social_duo_reports_usage_key ON public.social_duo_reports (user_id, usage_id);
CREATE INDEX IF NOT EXISTS social_duo_reports_match_idx ON public.social_duo_reports (match_hash);

CREATE TABLE IF NOT EXISTS public.social_duo_matches (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ref         text NOT NULL UNIQUE DEFAULT public.social_duo_new_ref() CHECK (ref ~ '^[0-9a-f]{16}$'),
  pair_id     uuid NOT NULL REFERENCES public.social_duo_pairs (id) ON DELETE CASCADE,
  match_hash  text NOT NULL CHECK (match_hash ~ '^[0-9a-f]{64}$'),
  played_at   timestamptz NOT NULL,
  expires_at  timestamptz NOT NULL,
  UNIQUE (pair_id, match_hash)
);
CREATE INDEX IF NOT EXISTS social_duo_matches_expiry_idx ON public.social_duo_matches (expires_at);

CREATE TABLE IF NOT EXISTS public.social_duo_sheets (
  match_id    uuid NOT NULL REFERENCES public.social_duo_matches (id) ON DELETE CASCADE,
  user_id     uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  sheet       jsonb NOT NULL CHECK (octet_length(sheet::text) <= 32768),
  at          timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (match_id, user_id)
);

CREATE TABLE IF NOT EXISTS public.social_duo_clips (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ref         text NOT NULL UNIQUE DEFAULT public.social_duo_new_ref() CHECK (ref ~ '^[0-9a-f]{16}$'),
  match_id    uuid NOT NULL REFERENCES public.social_duo_matches (id) ON DELETE CASCADE,
  user_id     uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  name        text NOT NULL CHECK (name ~ '^[rdh][0-9]{1,3}-clip\.mkv$'),
  round       integer NOT NULL CHECK (round BETWEEN 1 AND 50),
  kind        text NOT NULL CHECK (kind IN ('death', 'flag', 'highlight')),
  marks       jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (octet_length(marks::text) <= 2048),
  -- The duo, the match, the member's tag, then THIS ROW's own ref before the
  -- name: a new row never reuses a path, so a file of a dropped upload in the
  -- trash is never a newer upload's file.
  path        text NOT NULL UNIQUE CHECK (path ~ '^[0-9a-f]{16}/[0-9a-f]{16}/[0-9a-f]{16}/[0-9a-f]{16}-[rdh][0-9]{1,3}-clip\.mkv$'),
  status      text NOT NULL DEFAULT 'issued' CHECK (status IN ('issued', 'stored')),
  -- Held against the quota from the moment an upload URL is issued (the most
  -- a file may be), settled to the real size once the file is seen stored.
  reserved    bigint NOT NULL CHECK (reserved >= 0),
  size        bigint CHECK (size IS NULL OR size >= 0),
  issues      integer NOT NULL DEFAULT 1,
  issued_at   timestamptz NOT NULL DEFAULT now(),
  stored_at   timestamptz,
  UNIQUE (match_id, user_id, name)
);
CREATE INDEX IF NOT EXISTS social_duo_clips_status_idx ON public.social_duo_clips (status, issued_at);

CREATE TABLE IF NOT EXISTS public.social_duo_pins (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ref         text NOT NULL UNIQUE DEFAULT public.social_duo_new_ref() CHECK (ref ~ '^[0-9a-f]{16}$'),
  clip_id     uuid NOT NULL REFERENCES public.social_duo_clips (id) ON DELETE CASCADE,
  author      uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  at_ms       integer NOT NULL CHECK (at_ms BETWEEN 0 AND 600000),
  label       text NOT NULL CHECK (label IN ('good-trade', 'should-trade', 'too-far', 'good-utility', 'wait-for-me', 'nice-shot', 'wrong-timing', 'my-mistake')),
  reaction    text CHECK (reaction IS NULL OR reaction IN ('nice', 'wow', 'agreed', 'oops')),
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS social_duo_pins_clip_idx ON public.social_duo_pins (clip_id);

CREATE TABLE IF NOT EXISTS public.social_duo_bytes (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  dir         text NOT NULL CHECK (dir IN ('up', 'down')),
  bytes       bigint NOT NULL CHECK (bytes >= 0),
  clip_id     uuid,
  at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS social_duo_bytes_user_idx ON public.social_duo_bytes (user_id, dir, at);

CREATE TABLE IF NOT EXISTS public.social_duo_trash (
  path        text PRIMARY KEY CHECK (char_length(path) <= 200),
  -- An upload URL can still land a file until then: the object is removed at
  -- once AND again after this, and only then is the row let go.
  not_before  timestamptz NOT NULL,
  added_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.social_duo_guesses (
  user_id     uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS social_duo_guesses_user_idx ON public.social_duo_guesses (user_id, at);

-- ── Discoverable, as Duos reads it ────────────────────────────────────────
-- 8.19's switch said "Nothing is shared yet". A flag turned on under those
-- words is no consent to what Duos does with it, so Duos counts it only once
-- it was turned on again through Duos' own route, under the words that say
-- what it now allows (social_duo_set_discoverable stamps this). Turned off
-- anywhere, the stamp goes with it (the trigger below).
ALTER TABLE public.social_profiles ADD COLUMN IF NOT EXISTS duo_discoverable_at timestamptz;

-- ── Nothing through Supabase's public API ─────────────────────────────────
ALTER TABLE public.social_duo_invites ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.social_duo_pairs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.social_duo_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.social_duo_matches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.social_duo_sheets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.social_duo_clips ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.social_duo_pins ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.social_duo_bytes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.social_duo_trash ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.social_duo_guesses ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.social_duo_invites, public.social_duo_pairs, public.social_duo_reports, public.social_duo_matches,
  public.social_duo_sheets, public.social_duo_clips, public.social_duo_pins, public.social_duo_bytes, public.social_duo_trash,
  public.social_duo_guesses FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.social_duo_invites, public.social_duo_pairs, public.social_duo_reports, public.social_duo_matches,
  public.social_duo_sheets, public.social_duo_clips, public.social_duo_pins, public.social_duo_bytes, public.social_duo_trash,
  public.social_duo_guesses TO service_role;

-- ── A clip row gone, by any path, puts its file in the trash ──────────────
-- Its expiry, the duo ended, a block, an account deleted (the cascade fires
-- this trigger row by row): the file is never left behind with no row.
CREATE OR REPLACE FUNCTION public.social_duo_clip_gone()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
BEGIN
  INSERT INTO public.social_duo_trash (path, not_before)
  VALUES (OLD.path, GREATEST(now(), OLD.issued_at + interval '2 hours 10 minutes'))
  ON CONFLICT (path) DO UPDATE SET not_before = GREATEST(public.social_duo_trash.not_before, EXCLUDED.not_before);
  RETURN OLD;
END;
$function$;

DROP TRIGGER IF EXISTS social_duo_clips_gone ON public.social_duo_clips;
CREATE TRIGGER social_duo_clips_gone
  AFTER DELETE ON public.social_duo_clips
  FOR EACH ROW EXECUTE FUNCTION public.social_duo_clip_gone();

-- ── A block ends a duo and every invite between the two, at once ──────────
CREATE OR REPLACE FUNCTION public.social_duo_on_block()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
BEGIN
  -- THE LOCK ORDER, everywhere two accounts are locked (here and in
  -- social_duo_join): the lower uuid's 'social-duo-user:' lock, then the
  -- higher's. A join racing this block either finishes first (and its duo is
  -- ended here) or waits and then sees the block.
  PERFORM pg_advisory_xact_lock(hashtext('social-duo-user:' || LEAST(NEW.blocker, NEW.blocked)::text));
  PERFORM pg_advisory_xact_lock(hashtext('social-duo-user:' || GREATEST(NEW.blocker, NEW.blocked)::text));
  UPDATE public.social_duo_pairs SET status = 'ended', ended_by = NEW.blocker, ended_why = 'blocked', ended_at = now()
  WHERE status = 'paired' AND user_a = LEAST(NEW.blocker, NEW.blocked) AND user_b = GREATEST(NEW.blocker, NEW.blocked);
  -- Everything the two shared goes (the clips through the trash).
  DELETE FROM public.social_duo_matches m USING public.social_duo_pairs p
  WHERE m.pair_id = p.id AND p.user_a = LEAST(NEW.blocker, NEW.blocked) AND p.user_b = GREATEST(NEW.blocker, NEW.blocked);
  UPDATE public.social_duo_invites SET status = 'cancelled'
  WHERE status = 'open' AND ((from_user = NEW.blocker AND to_user = NEW.blocked) OR (from_user = NEW.blocked AND to_user = NEW.blocker));
  RETURN NEW;
END;
$function$;

-- Discoverable turned off, by any route: Duos' consent stamp goes too.
CREATE OR REPLACE FUNCTION public.social_duo_disc_off()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.discoverable IS NOT TRUE THEN NEW.duo_discoverable_at := NULL; END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS social_duo_disc_off ON public.social_profiles;
CREATE TRIGGER social_duo_disc_off
  BEFORE UPDATE OF discoverable ON public.social_profiles
  FOR EACH ROW EXECUTE FUNCTION public.social_duo_disc_off();

DROP TRIGGER IF EXISTS social_duo_blocks_end ON public.social_blocks;
CREATE TRIGGER social_duo_blocks_end
  AFTER INSERT ON public.social_blocks
  FOR EACH ROW EXECUTE FUNCTION public.social_duo_on_block();

-- ── The functions the server calls ────────────────────────────────────────

-- Live: every table here, and the two accounts tables this reads, exist.
CREATE OR REPLACE FUNCTION public.social_duo_status()
RETURNS boolean
LANGUAGE plpgsql
STABLE
SET search_path TO 'public'
AS $function$
BEGIN
  RETURN to_regclass('public.social_duo_invites') IS NOT NULL AND to_regclass('public.social_duo_pairs') IS NOT NULL
     AND to_regclass('public.social_duo_reports') IS NOT NULL AND to_regclass('public.social_duo_matches') IS NOT NULL
     AND to_regclass('public.social_duo_sheets') IS NOT NULL AND to_regclass('public.social_duo_clips') IS NOT NULL
     AND to_regclass('public.social_duo_pins') IS NOT NULL AND to_regclass('public.social_duo_bytes') IS NOT NULL
     AND to_regclass('public.social_duo_trash') IS NOT NULL AND to_regclass('public.social_duo_guesses') IS NOT NULL
     AND to_regclass('public.social_profiles') IS NOT NULL AND to_regclass('public.social_blocks') IS NOT NULL
     AND to_regclass('public.entitlements') IS NOT NULL AND to_regclass('public.game_usage') IS NOT NULL;
END;
$function$;

-- Whether an account is on Max NOW: its entitlement, read fresh, tier max and
-- not ended. Never the client's word, and never a cached answer.
CREATE OR REPLACE FUNCTION public.social_duo_max(p_user uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SET search_path TO 'public'
AS $function$
BEGIN
  RETURN EXISTS (SELECT 1 FROM public.entitlements e
                 WHERE e.user_id = p_user AND e.tier = 'max' AND COALESCE(e.status, 'active') = 'active');
END;
$function$;

-- Either of two accounts blocked the other.
CREATE OR REPLACE FUNCTION public.social_duo_blocked(p_x uuid, p_y uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $function$
  SELECT EXISTS (SELECT 1 FROM public.social_blocks b
                 WHERE (b.blocker = p_x AND b.blocked = p_y) OR (b.blocker = p_y AND b.blocked = p_x));
$function$;

-- The live duo of two accounts, or null.
CREATE OR REPLACE FUNCTION public.social_duo_pair_of(p_x uuid, p_y uuid)
RETURNS uuid
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $function$
  SELECT id FROM public.social_duo_pairs WHERE status = 'paired' AND user_a = LEAST(p_x, p_y) AND user_b = GREATEST(p_x, p_y);
$function$;

-- How many live duos an account is in (active or paused).
CREATE OR REPLACE FUNCTION public.social_duo_count(p_user uuid)
RETURNS integer
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $function$
  SELECT count(*)::integer FROM public.social_duo_pairs WHERE status = 'paired' AND (user_a = p_user OR user_b = p_user)
    AND NOT public.social_duo_blocked(user_a, user_b);
$function$;

-- The page's whole state for one account: { username, discoverable, max,
-- partners, ended, invites_in, invites_out, found, up_bytes, down_bytes }.
-- Never an id: partners and invites by username and ref.
CREATE OR REPLACE FUNCTION public.social_duo_me(p_user uuid, p_window_ms bigint, p_ended_days integer, p_quota_days integer)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SET search_path TO 'public'
AS $function$
DECLARE
  me public.social_profiles%ROWTYPE;
BEGIN
  SELECT * INTO me FROM public.social_profiles WHERE user_id = p_user;
  RETURN jsonb_build_object(
    'username', me.username,
    'discoverable', COALESCE(me.discoverable AND me.duo_discoverable_at IS NOT NULL, false),
    'max', public.social_duo_max(p_user),
    'partners', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'ref', p.ref, 'username', o.username, 'since', p.paired_at,
        'mine_max', public.social_duo_max(p_user), 'their_max', public.social_duo_max(o.user_id),
        'public', o.is_public, 'verified', o.riot_verified, 'rank_current', CASE WHEN o.riot_verified THEN o.rank_current END,
        'pc_rank', CASE WHEN o.is_public THEN o.stats -> 'rank' ->> 'current' END,
        'new_pins', (SELECT count(*) FROM public.social_duo_pins pn JOIN public.social_duo_clips c ON c.id = pn.clip_id
                     JOIN public.social_duo_matches m ON m.id = c.match_id
                     WHERE m.pair_id = p.id AND c.user_id = p_user AND pn.author = o.user_id
                       AND pn.created_at > CASE WHEN p.user_a = p_user THEN p.a_seen_at ELSE p.b_seen_at END),
        'matches', (SELECT count(*) FROM public.social_duo_matches m WHERE m.pair_id = p.id AND m.expires_at > now()))
        ORDER BY o.username_key)
      FROM public.social_duo_pairs p
      JOIN public.social_profiles o ON o.user_id = CASE WHEN p.user_a = p_user THEN p.user_b ELSE p.user_a END
      WHERE p.status = 'paired' AND (p.user_a = p_user OR p.user_b = p_user)
        AND NOT public.social_duo_blocked(p.user_a, p.user_b)), '[]'::jsonb),
    -- A duo the other ended (or this account), never one a block ended.
    'ended', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('username', o.username, 'by_me', p.ended_by = p_user, 'at', p.ended_at) ORDER BY p.ended_at DESC)
      FROM public.social_duo_pairs p
      JOIN public.social_profiles o ON o.user_id = CASE WHEN p.user_a = p_user THEN p.user_b ELSE p.user_a END
      WHERE p.status = 'ended' AND (p.user_a = p_user OR p.user_b = p_user) AND p.ended_why = 'removed'
        AND p.ended_at > now() - make_interval(days => p_ended_days)
        AND NOT public.social_duo_blocked(p.user_a, p.user_b)
        AND public.social_duo_pair_of(p.user_a, p.user_b) IS NULL), '[]'::jsonb),
    'invites_in', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('ref', i.ref, 'username', f.username, 'at', i.created_at, 'expires_at', i.expires_at) ORDER BY i.created_at DESC)
      FROM public.social_duo_invites i JOIN public.social_profiles f ON f.user_id = i.from_user
      WHERE i.to_user = p_user AND i.status = 'open' AND i.expires_at > now() AND f.username IS NOT NULL
        AND NOT public.social_duo_blocked(i.from_user, p_user)), '[]'::jsonb),
    'invites_out', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('ref', i.ref, 'name', i.to_name, 'code', i.code_hash IS NOT NULL, 'at', i.created_at, 'expires_at', i.expires_at) ORDER BY i.created_at DESC)
      FROM public.social_duo_invites i
      WHERE i.from_user = p_user AND i.status = 'open' AND i.expires_at > now()), '[]'::jsonb),
    -- Teammates found: another account that reported one of this account's
    -- recent matches, on the same team, within the window of this one's
    -- report, both discoverable, no block, not partners already.
    'found', COALESCE((
      SELECT jsonb_agg(x.j ORDER BY x.at DESC) FROM (
        SELECT DISTINCT ON (r2.user_id) jsonb_build_object('username', o.username, 'agent', r2.agent, 'at', LEAST(r1.at, r2.at)) AS j, LEAST(r1.at, r2.at) AS at
        FROM public.social_duo_reports r1
        JOIN public.social_duo_reports r2 ON r2.match_hash = r1.match_hash AND r2.user_id <> r1.user_id AND r2.team = r1.team
        JOIN public.social_profiles o ON o.user_id = r2.user_id
        WHERE r1.user_id = p_user AND me.discoverable AND me.duo_discoverable_at IS NOT NULL
          AND o.discoverable AND o.duo_discoverable_at IS NOT NULL AND o.username IS NOT NULL
          AND abs(extract(epoch FROM (r2.at - r1.at)) * 1000) <= p_window_ms
          AND NOT public.social_duo_blocked(p_user, r2.user_id)
          AND public.social_duo_pair_of(p_user, r2.user_id) IS NULL
        ORDER BY r2.user_id, LEAST(r1.at, r2.at) DESC
        LIMIT 20) x), '[]'::jsonb),
    'up_bytes', (SELECT COALESCE(sum(bytes), 0) FROM public.social_duo_bytes WHERE user_id = p_user AND dir = 'up' AND at > now() - make_interval(days => p_quota_days)),
    'down_bytes', (SELECT COALESCE(sum(bytes), 0) FROM public.social_duo_bytes WHERE user_id = p_user AND dir = 'down' AND at > now() - interval '1 day'));
END;
$function$;

-- An invite by exact username: { ok, reason }. Refused 'no-username',
-- 'no-max', 'too-many' (p_open_max open), 'full' (p_partner_max duos),
-- 'self', 'partner' (already a duo), 'already' (an open invite to that name).
-- Anything else is 'sent', WHETHER OR NOT THE NAME IS A PROFILE THIS SENDER
-- MAY REACH: it reaches a profile only when that profile is PUBLIC (being
-- discoverable never lets a stranger who knows the name invite it), neither
-- blocked the other, and that profile did not decline this sender in the
-- last 7 days; otherwise it reaches nobody and expires, and the sender is
-- told exactly the same.
CREATE OR REPLACE FUNCTION public.social_duo_invite_name(p_user uuid, p_name text, p_key text, p_ttl_ms bigint, p_open_max integer, p_partner_max integer)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
DECLARE
  v_me public.social_profiles%ROWTYPE;
  v_to uuid;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('social-duo-user:' || p_user::text));
  SELECT * INTO v_me FROM public.social_profiles WHERE user_id = p_user;
  IF NOT FOUND OR v_me.username IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'no-username'); END IF;
  IF NOT public.social_duo_max(p_user) THEN RETURN jsonb_build_object('ok', false, 'reason', 'no-max'); END IF;
  IF v_me.username_key = p_key THEN RETURN jsonb_build_object('ok', false, 'reason', 'self'); END IF;
  UPDATE public.social_duo_invites SET status = 'cancelled' WHERE from_user = p_user AND status = 'open' AND expires_at <= now();
  IF public.social_duo_count(p_user) >= p_partner_max THEN RETURN jsonb_build_object('ok', false, 'reason', 'full'); END IF;
  IF EXISTS (SELECT 1 FROM public.social_duo_invites WHERE from_user = p_user AND status = 'open' AND to_key = p_key) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'already');
  END IF;
  -- A partner already: the two know each other, so this says nothing new.
  IF public.social_duo_pair_of(p_user, (SELECT user_id FROM public.social_profiles WHERE username_key = p_key)) IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'partner');
  END IF;
  IF (SELECT count(*) FROM public.social_duo_invites WHERE from_user = p_user AND status = 'open') >= p_open_max THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'too-many');
  END IF;
  SELECT o.user_id INTO v_to FROM public.social_profiles o
  WHERE o.username_key = p_key AND o.user_id <> p_user AND o.is_public
    AND NOT public.social_duo_blocked(p_user, o.user_id)
    AND NOT EXISTS (SELECT 1 FROM public.social_duo_invites d WHERE d.from_user = p_user AND d.to_user = o.user_id
                      AND d.status = 'declined' AND d.created_at > now() - interval '7 days');
  INSERT INTO public.social_duo_invites (from_user, to_user, to_name, to_key, expires_at)
  VALUES (p_user, v_to, p_name, p_key, now() + make_interval(secs => p_ttl_ms / 1000.0));
  RETURN jsonb_build_object('ok', true, 'reason', 'sent');
END;
$function$;

-- An invite code: { ok, reason, expires_at }. The code is made by the server
-- and only its salted hash is kept. Refused as an invite by name is.
CREATE OR REPLACE FUNCTION public.social_duo_invite_code(p_user uuid, p_code_hash text, p_ttl_ms bigint, p_open_max integer, p_partner_max integer)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
DECLARE
  v_exp timestamptz := now() + make_interval(secs => p_ttl_ms / 1000.0);
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('social-duo-user:' || p_user::text));
  IF NOT EXISTS (SELECT 1 FROM public.social_profiles WHERE user_id = p_user AND username IS NOT NULL) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'no-username');
  END IF;
  IF NOT public.social_duo_max(p_user) THEN RETURN jsonb_build_object('ok', false, 'reason', 'no-max'); END IF;
  UPDATE public.social_duo_invites SET status = 'cancelled' WHERE from_user = p_user AND status = 'open' AND expires_at <= now();
  IF public.social_duo_count(p_user) >= p_partner_max THEN RETURN jsonb_build_object('ok', false, 'reason', 'full'); END IF;
  IF (SELECT count(*) FROM public.social_duo_invites WHERE from_user = p_user AND status = 'open') >= p_open_max THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'too-many');
  END IF;
  INSERT INTO public.social_duo_invites (from_user, code_hash, expires_at) VALUES (p_user, p_code_hash, v_exp);
  RETURN jsonb_build_object('ok', true, 'reason', 'made', 'expires_at', v_exp);
EXCEPTION WHEN unique_violation THEN
  RETURN jsonb_build_object('ok', false, 'reason', 'try-again');
END;
$function$;

-- Make the duo of an open invite, under both accounts' locks in order.
CREATE OR REPLACE FUNCTION public.social_duo_join(p_invite uuid, p_user uuid, p_partner_max integer)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
DECLARE
  i public.social_duo_invites%ROWTYPE;
  v_from text;
BEGIN
  SELECT * INTO i FROM public.social_duo_invites WHERE id = p_invite;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'reason', 'gone'); END IF;
  PERFORM pg_advisory_xact_lock(hashtext('social-duo-user:' || LEAST(i.from_user, p_user)::text));
  PERFORM pg_advisory_xact_lock(hashtext('social-duo-user:' || GREATEST(i.from_user, p_user)::text));
  SELECT * INTO i FROM public.social_duo_invites WHERE id = p_invite AND status = 'open' AND expires_at > now() FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'reason', 'gone'); END IF;
  IF i.from_user = p_user THEN RETURN jsonb_build_object('ok', false, 'reason', 'own'); END IF;
  IF public.social_duo_blocked(i.from_user, p_user) THEN RETURN jsonb_build_object('ok', false, 'reason', 'gone'); END IF;
  SELECT username INTO v_from FROM public.social_profiles WHERE user_id = i.from_user;
  IF v_from IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'gone'); END IF;
  IF public.social_duo_pair_of(i.from_user, p_user) IS NOT NULL THEN
    UPDATE public.social_duo_invites SET status = 'accepted' WHERE id = i.id;
    RETURN jsonb_build_object('ok', true, 'reason', 'partner', 'username', v_from);
  END IF;
  IF public.social_duo_count(p_user) >= p_partner_max THEN RETURN jsonb_build_object('ok', false, 'reason', 'full'); END IF;
  IF public.social_duo_count(i.from_user) >= p_partner_max THEN RETURN jsonb_build_object('ok', false, 'reason', 'their-full'); END IF;
  INSERT INTO public.social_duo_pairs (user_a, user_b) VALUES (LEAST(i.from_user, p_user), GREATEST(i.from_user, p_user));
  UPDATE public.social_duo_invites SET status = 'accepted' WHERE id = i.id;
  -- Any other open invite between the two is spent with it.
  UPDATE public.social_duo_invites SET status = 'accepted' WHERE status = 'open' AND id <> i.id
    AND ((from_user = i.from_user AND to_user = p_user) OR (from_user = p_user AND to_user = i.from_user));
  RETURN jsonb_build_object('ok', true, 'reason', 'paired', 'username', v_from);
END;
$function$;

-- Accept by code: { ok, reason, username }. The guesses are counted FIRST:
-- past p_guess_day wrong codes in a rolling day, 'guesses' and nothing is
-- looked up. A code that is no open invite, expired, used, or from an
-- account this one blocked or is blocked by, is one answer: 'bad-code'.
CREATE OR REPLACE FUNCTION public.social_duo_accept_code(p_user uuid, p_code_hash text, p_partner_max integer, p_guess_day integer)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
DECLARE
  v_id uuid;
  v_from uuid;
BEGIN
  -- One accept of this account at a time, so two at once never both pass the count.
  PERFORM pg_advisory_xact_lock(hashtext('social-duo-guess:' || p_user::text));
  IF NOT EXISTS (SELECT 1 FROM public.social_profiles WHERE user_id = p_user AND username IS NOT NULL) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'no-username');
  END IF;
  IF (SELECT count(*) FROM public.social_duo_guesses WHERE user_id = p_user AND at > now() - interval '1 day') >= p_guess_day THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'guesses');
  END IF;
  SELECT id, from_user INTO v_id, v_from FROM public.social_duo_invites
  WHERE code_hash = p_code_hash AND status = 'open' AND expires_at > now();
  IF v_id IS NULL OR v_from = p_user OR public.social_duo_blocked(v_from, p_user) THEN
    IF v_from IS DISTINCT FROM p_user THEN
      DELETE FROM public.social_duo_guesses WHERE user_id = p_user AND at < now() - interval '2 days';
      INSERT INTO public.social_duo_guesses (user_id) VALUES (p_user);
      RETURN jsonb_build_object('ok', false, 'reason', 'bad-code');
    END IF;
    RETURN jsonb_build_object('ok', false, 'reason', 'own');
  END IF;
  RETURN public.social_duo_join(v_id, p_user, p_partner_max);
END;
$function$;

-- Accept an invite this account was sent, by the sender's username key.
CREATE OR REPLACE FUNCTION public.social_duo_accept_from(p_user uuid, p_from_key text, p_partner_max integer)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
DECLARE
  v_id uuid;
BEGIN
  SELECT i.id INTO v_id FROM public.social_duo_invites i JOIN public.social_profiles f ON f.user_id = i.from_user
  WHERE i.to_user = p_user AND f.username_key = p_from_key AND i.status = 'open' AND i.expires_at > now()
  ORDER BY i.created_at DESC LIMIT 1;
  IF v_id IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'gone'); END IF;
  RETURN public.social_duo_join(v_id, p_user, p_partner_max);
END;
$function$;

-- Decline an invite this account was sent (by the sender's username key).
CREATE OR REPLACE FUNCTION public.social_duo_decline(p_user uuid, p_from_key text)
RETURNS boolean
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
BEGIN
  UPDATE public.social_duo_invites i SET status = 'declined' FROM public.social_profiles f
  WHERE f.user_id = i.from_user AND f.username_key = p_from_key AND i.to_user = p_user AND i.status = 'open';
  RETURN FOUND;
END;
$function$;

-- Take back an invite this account sent, by its ref.
CREATE OR REPLACE FUNCTION public.social_duo_cancel(p_user uuid, p_ref text)
RETURNS boolean
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
BEGIN
  UPDATE public.social_duo_invites SET status = 'cancelled' WHERE ref = p_ref AND from_user = p_user AND status = 'open';
  RETURN FOUND;
END;
$function$;

-- End a duo, by the partner's username key: the pair ended, everything it
-- shared deleted (the clips through the trash). { ok }.
CREATE OR REPLACE FUNCTION public.social_duo_remove(p_user uuid, p_key text)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
DECLARE
  v_other uuid;
  v_pair uuid;
BEGIN
  SELECT user_id INTO v_other FROM public.social_profiles WHERE username_key = p_key;
  v_pair := CASE WHEN v_other IS NULL THEN NULL ELSE public.social_duo_pair_of(p_user, v_other) END;
  IF v_pair IS NULL THEN RETURN jsonb_build_object('ok', true, 'reason', 'none'); END IF;
  UPDATE public.social_duo_pairs SET status = 'ended', ended_by = p_user, ended_why = 'removed', ended_at = now() WHERE id = v_pair;
  DELETE FROM public.social_duo_matches WHERE pair_id = v_pair;
  RETURN jsonb_build_object('ok', true, 'reason', 'ended');
END;
$function$;

-- "This account reviewed this match": { ok, reason, matches: [{ ref, partner }], found: [{ username, agent }] }.
-- BOUND TO A LIVE GAME: the account must hold a live Valorant game_usage row
-- (reserved or counted) made in the last p_usage_hours that no earlier report
-- spent; a report of a match already reported spends nothing and answers
-- again. Refused 'no-username', 'not-engaged' (no live duo, no open invite
-- to or from it, not discoverable under Duos' words: nothing is kept of an
-- account that never opted in to anything), 'no-game'. Then every other report of the
-- same match on the SAME TEAM within p_window_ms: a partner in an ACTIVE duo
-- makes a shared match (expiring p_keep_days after the earlier report); a
-- discoverable teammate (both discoverable, no block, not partners) is found.
-- Old reports and guesses are deleted on the way.
CREATE OR REPLACE FUNCTION public.social_duo_report(p_user uuid, p_match_hash text, p_team text, p_agent text,
  p_usage_hours integer, p_window_ms bigint, p_report_days integer, p_keep_days integer)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
DECLARE
  v_me public.social_profiles%ROWTYPE;
  v_usage text;
  r public.social_duo_reports%ROWTYPE;
  o record;
  v_pair uuid;
  v_matches jsonb := '[]'::jsonb;
  v_found jsonb := '[]'::jsonb;
  v_ref text;
BEGIN
  SELECT * INTO v_me FROM public.social_profiles WHERE user_id = p_user;
  IF NOT FOUND OR v_me.username IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'no-username'); END IF;
  IF NOT ((v_me.discoverable AND v_me.duo_discoverable_at IS NOT NULL)
          OR EXISTS (SELECT 1 FROM public.social_duo_pairs p WHERE p.status = 'paired' AND (p.user_a = p_user OR p.user_b = p_user)
                       AND NOT public.social_duo_blocked(p.user_a, p.user_b))
          OR EXISTS (SELECT 1 FROM public.social_duo_invites i WHERE i.status = 'open' AND i.expires_at > now()
                       AND (i.from_user = p_user OR i.to_user = p_user))) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not-engaged');
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext('social-duo-report:' || p_user::text));
  DELETE FROM public.social_duo_reports WHERE at < now() - make_interval(days => p_report_days);
  SELECT * INTO r FROM public.social_duo_reports WHERE user_id = p_user AND match_hash = p_match_hash;
  IF NOT FOUND THEN
    SELECT g.id::text INTO v_usage FROM public.game_usage g
    WHERE g.user_id = p_user AND g.game = 'valorant' AND g.kind = 'live' AND g.status IN ('reserved', 'counted')
      AND g.created_at > now() - make_interval(hours => p_usage_hours)
      AND NOT EXISTS (SELECT 1 FROM public.social_duo_reports x WHERE x.user_id = p_user AND x.usage_id = g.id::text)
    ORDER BY g.created_at DESC LIMIT 1;
    IF v_usage IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'no-game'); END IF;
    INSERT INTO public.social_duo_reports (user_id, match_hash, team, agent, usage_id) VALUES (p_user, p_match_hash, p_team, p_agent, v_usage)
    RETURNING * INTO r;
  END IF;
  FOR o IN
    SELECT x.user_id, x.agent, x.at, pr.username, (pr.discoverable AND pr.duo_discoverable_at IS NOT NULL) AS discoverable
    FROM public.social_duo_reports x JOIN public.social_profiles pr ON pr.user_id = x.user_id
    WHERE x.match_hash = p_match_hash AND x.user_id <> p_user AND x.team = r.team AND pr.username IS NOT NULL
      AND abs(extract(epoch FROM (x.at - r.at)) * 1000) <= p_window_ms
      AND NOT public.social_duo_blocked(p_user, x.user_id)
  LOOP
    v_pair := public.social_duo_pair_of(p_user, o.user_id);
    IF v_pair IS NOT NULL THEN
      IF public.social_duo_max(p_user) OR public.social_duo_max(o.user_id) THEN
        INSERT INTO public.social_duo_matches (pair_id, match_hash, played_at, expires_at)
        VALUES (v_pair, p_match_hash, LEAST(o.at, r.at), LEAST(o.at, r.at) + make_interval(days => p_keep_days))
        ON CONFLICT (pair_id, match_hash) DO NOTHING;
        SELECT ref INTO v_ref FROM public.social_duo_matches WHERE pair_id = v_pair AND match_hash = p_match_hash AND expires_at > now();
        IF v_ref IS NOT NULL THEN v_matches := v_matches || jsonb_build_array(jsonb_build_object('ref', v_ref, 'partner', o.username)); END IF;
      END IF;
    ELSIF v_me.discoverable AND v_me.duo_discoverable_at IS NOT NULL AND o.discoverable THEN
      v_found := v_found || jsonb_build_array(jsonb_build_object('username', o.username, 'agent', o.agent));
    END IF;
  END LOOP;
  RETURN jsonb_build_object('ok', true, 'reason', NULL, 'matches', v_matches, 'found', v_found);
END;
$function$;

-- The shared matches of every live duo of this account, newest first, not
-- expired: [{ ref, partner, played_at, expires_at, active, mine, theirs, clips }].
CREATE OR REPLACE FUNCTION public.social_duo_matches_of(p_user uuid, p_limit integer)
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $function$
  SELECT COALESCE(jsonb_agg(x.j ORDER BY x.played_at DESC), '[]'::jsonb) FROM (
    SELECT jsonb_build_object(
      'ref', m.ref, 'partner', o.username, 'played_at', m.played_at, 'expires_at', m.expires_at,
      'active', public.social_duo_max(p.user_a) OR public.social_duo_max(p.user_b),
      'mine', (SELECT s.sheet FROM public.social_duo_sheets s WHERE s.match_id = m.id AND s.user_id = p_user),
      'theirs', (SELECT s.sheet FROM public.social_duo_sheets s WHERE s.match_id = m.id AND s.user_id = o.user_id),
      'my_clips', (SELECT count(*) FROM public.social_duo_clips c WHERE c.match_id = m.id AND c.user_id = p_user AND c.status = 'stored'),
      'their_clips', (SELECT count(*) FROM public.social_duo_clips c WHERE c.match_id = m.id AND c.user_id = o.user_id AND c.status = 'stored')) AS j,
      m.played_at
    FROM public.social_duo_matches m
    JOIN public.social_duo_pairs p ON p.id = m.pair_id AND p.status = 'paired'
    JOIN public.social_profiles o ON o.user_id = CASE WHEN p.user_a = p_user THEN p.user_b ELSE p.user_a END
    WHERE (p.user_a = p_user OR p.user_b = p_user) AND m.expires_at > now()
      AND NOT public.social_duo_blocked(p.user_a, p.user_b)
    ORDER BY m.played_at DESC
    LIMIT LEAST(GREATEST(COALESCE(p_limit, 30), 1), 60)
  ) x;
$function$;

-- One shared match as this account may see it, or null (not its duo's,
-- expired, ended, blocked): its sheets, its stored clips with their marks,
-- and the pins.
CREATE OR REPLACE FUNCTION public.social_duo_match(p_user uuid, p_ref text)
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $function$
  SELECT jsonb_build_object(
    'ref', m.ref, 'partner', o.username, 'played_at', m.played_at, 'expires_at', m.expires_at,
    'active', public.social_duo_max(p.user_a) OR public.social_duo_max(p.user_b),
    'mine', (SELECT s.sheet FROM public.social_duo_sheets s WHERE s.match_id = m.id AND s.user_id = p_user),
    'theirs', (SELECT s.sheet FROM public.social_duo_sheets s WHERE s.match_id = m.id AND s.user_id = o.user_id),
    'clips', COALESCE((SELECT jsonb_agg(jsonb_build_object('ref', c.ref, 'mine', c.user_id = p_user, 'name', c.name, 'round', c.round,
                         'kind', c.kind, 'marks', c.marks, 'size', c.size) ORDER BY c.round, c.name)
                       FROM public.social_duo_clips c WHERE c.match_id = m.id AND c.status = 'stored'), '[]'::jsonb),
    'pins', COALESCE((SELECT jsonb_agg(jsonb_build_object('ref', pn.ref, 'clip', c.ref, 'at_ms', pn.at_ms, 'label', pn.label,
                        'reaction', pn.reaction, 'mine', pn.author = p_user, 'at', pn.created_at) ORDER BY c.round, pn.at_ms)
                      FROM public.social_duo_pins pn JOIN public.social_duo_clips c ON c.id = pn.clip_id WHERE c.match_id = m.id), '[]'::jsonb))
  FROM public.social_duo_matches m
  JOIN public.social_duo_pairs p ON p.id = m.pair_id AND p.status = 'paired'
  JOIN public.social_profiles o ON o.user_id = CASE WHEN p.user_a = p_user THEN p.user_b ELSE p.user_a END
  WHERE m.ref = p_ref AND (p.user_a = p_user OR p.user_b = p_user) AND m.expires_at > now()
    AND NOT public.social_duo_blocked(p.user_a, p.user_b);
$function$;

-- Put this account's sheet of a shared match: { ok, reason }. Only while the
-- duo is ACTIVE (one of the two on Max now). Refused 'none', 'paused', 'too-big'.
CREATE OR REPLACE FUNCTION public.social_duo_sheet_put(p_user uuid, p_ref text, p_sheet jsonb, p_max integer)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
DECLARE
  v_match uuid;
  p public.social_duo_pairs%ROWTYPE;
BEGIN
  IF p_sheet IS NULL OR jsonb_typeof(p_sheet) <> 'object' OR octet_length(p_sheet::text) > LEAST(p_max, 32768) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'too-big');
  END IF;
  SELECT m.id INTO v_match FROM public.social_duo_matches m JOIN public.social_duo_pairs pr ON pr.id = m.pair_id
  WHERE m.ref = p_ref AND pr.status = 'paired' AND (pr.user_a = p_user OR pr.user_b = p_user) AND m.expires_at > now();
  IF v_match IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'none'); END IF;
  SELECT pr.* INTO p FROM public.social_duo_pairs pr JOIN public.social_duo_matches m ON m.pair_id = pr.id WHERE m.id = v_match;
  IF public.social_duo_blocked(p.user_a, p.user_b) THEN RETURN jsonb_build_object('ok', false, 'reason', 'none'); END IF;
  IF NOT (public.social_duo_max(p.user_a) OR public.social_duo_max(p.user_b)) THEN RETURN jsonb_build_object('ok', false, 'reason', 'paused'); END IF;
  INSERT INTO public.social_duo_sheets (match_id, user_id, sheet) VALUES (v_match, p_user, p_sheet)
  ON CONFLICT (match_id, user_id) DO UPDATE SET sheet = EXCLUDED.sheet, at = now();
  RETURN jsonb_build_object('ok', true, 'reason', NULL);
END;
$function$;

-- An upload of one clip may start: { ok, reason, path, ref, stored }. Only
-- while the duo is ACTIVE and the match not expired. A clip already stored
-- answers stored (it is never sent again); one issued and not seen stored
-- is issued again at the same path (at most p_issues times), its bytes held
-- once. A new one needs fewer than p_per_match of this account's clips in
-- the match and its whole p_reserve (the most a file may be) under the
-- account's quota (p_quota bytes in p_quota_days, every upload counted,
-- whatever later happened to it). Refused 'none', 'paused', 'count',
-- 'quota', 'issues'.
CREATE OR REPLACE FUNCTION public.social_duo_clip_start(p_user uuid, p_ref text, p_name text, p_round integer, p_kind text, p_marks jsonb,
  p_reserve bigint, p_per_match integer, p_quota bigint, p_quota_days integer, p_issues integer)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
DECLARE
  m public.social_duo_matches%ROWTYPE;
  p public.social_duo_pairs%ROWTYPE;
  c public.social_duo_clips%ROWTYPE;
  v_used bigint;
  v_tag text;
  v_ref text;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('social-duo-bytes:' || p_user::text));
  SELECT * INTO m FROM public.social_duo_matches WHERE ref = p_ref AND expires_at > now();
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'reason', 'none'); END IF;
  SELECT * INTO p FROM public.social_duo_pairs WHERE id = m.pair_id AND status = 'paired' AND (user_a = p_user OR user_b = p_user);
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'reason', 'none'); END IF;
  IF public.social_duo_blocked(p.user_a, p.user_b) THEN RETURN jsonb_build_object('ok', false, 'reason', 'none'); END IF;
  IF NOT (public.social_duo_max(p.user_a) OR public.social_duo_max(p.user_b)) THEN RETURN jsonb_build_object('ok', false, 'reason', 'paused'); END IF;
  SELECT * INTO c FROM public.social_duo_clips WHERE match_id = m.id AND user_id = p_user AND name = p_name FOR UPDATE;
  IF FOUND THEN
    IF c.status = 'stored' THEN RETURN jsonb_build_object('ok', true, 'reason', 'stored', 'stored', true, 'ref', c.ref); END IF;
    IF c.issues >= p_issues THEN RETURN jsonb_build_object('ok', false, 'reason', 'issues'); END IF;
    UPDATE public.social_duo_clips SET issues = issues + 1, issued_at = now(), marks = COALESCE(p_marks, marks) WHERE id = c.id;
    RETURN jsonb_build_object('ok', true, 'reason', 'again', 'stored', false, 'path', c.path, 'ref', c.ref);
  END IF;
  IF (SELECT count(*) FROM public.social_duo_clips WHERE match_id = m.id AND user_id = p_user) >= p_per_match THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'count');
  END IF;
  SELECT COALESCE(sum(bytes), 0) INTO v_used FROM public.social_duo_bytes
  WHERE user_id = p_user AND dir = 'up' AND at > now() - make_interval(days => p_quota_days);
  IF v_used + p_reserve > p_quota THEN RETURN jsonb_build_object('ok', false, 'reason', 'quota'); END IF;
  v_tag := CASE WHEN p.user_a = p_user THEN p.tag_a ELSE p.tag_b END;
  v_ref := public.social_duo_new_ref();
  INSERT INTO public.social_duo_clips (ref, match_id, user_id, name, round, kind, marks, path, reserved)
  VALUES (v_ref, m.id, p_user, p_name, p_round, p_kind, COALESCE(p_marks, '{}'::jsonb), p.ref || '/' || m.ref || '/' || v_tag || '/' || v_ref || '-' || p_name, p_reserve)
  RETURNING * INTO c;
  INSERT INTO public.social_duo_bytes (user_id, dir, bytes, clip_id) VALUES (p_user, 'up', p_reserve, c.id);
  RETURN jsonb_build_object('ok', true, 'reason', 'new', 'stored', false, 'path', c.path, 'ref', c.ref);
END;
$function$;

-- What the server needs to look a clip of this account's up in storage: { path } or null.
CREATE OR REPLACE FUNCTION public.social_duo_clip_path(p_user uuid, p_ref text)
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $function$
  SELECT jsonb_build_object('path', c.path, 'status', c.status) FROM public.social_duo_clips c
  WHERE c.ref = p_ref AND c.user_id = p_user;
$function$;

-- The file was looked up in storage (p_size its size there, null when it is
-- not there): { ok, reason }. Stored, the quota is settled to the real size;
-- over p_cap, the clip goes (its file through the trash) and the reserve stays
-- spent. Not there yet: 'missing', nothing changes.
CREATE OR REPLACE FUNCTION public.social_duo_clip_done(p_user uuid, p_ref text, p_size bigint, p_cap bigint)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
DECLARE
  c public.social_duo_clips%ROWTYPE;
BEGIN
  SELECT * INTO c FROM public.social_duo_clips WHERE ref = p_ref AND (p_user IS NULL OR user_id = p_user) FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'reason', 'none'); END IF;
  -- Across a block the clip is never made shared (the sweep settles it, p_user null).
  IF p_user IS NOT NULL AND EXISTS (SELECT 1 FROM public.social_duo_matches m JOIN public.social_duo_pairs p ON p.id = m.pair_id
       WHERE m.id = c.match_id AND (p.status <> 'paired' OR public.social_duo_blocked(p.user_a, p.user_b))) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'none');
  END IF;
  IF c.status = 'stored' THEN RETURN jsonb_build_object('ok', true, 'reason', 'stored'); END IF;
  IF p_size IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'missing'); END IF;
  -- p_size is the size STORAGE reports for the file, never the app's word. A
  -- file over the cap or over what was held for it goes (into the trash),
  -- its reserve stays spent.
  IF p_size > p_cap OR p_size > c.reserved OR p_size < 64 THEN
    DELETE FROM public.social_duo_clips WHERE id = c.id;
    RETURN jsonb_build_object('ok', false, 'reason', 'too-big');
  END IF;
  UPDATE public.social_duo_clips SET status = 'stored', size = p_size, stored_at = now() WHERE id = c.id;
  UPDATE public.social_duo_bytes SET bytes = p_size WHERE clip_id = c.id AND dir = 'up';
  RETURN jsonb_build_object('ok', true, 'reason', 'stored');
END;
$function$;

-- A clip to download: { ok, reason, path, size }. Only a STORED clip of a
-- live duo this account is in (active or paused: shared data stays viewable
-- until it expires), never expired, never across a block, and within the
-- account's download budget (p_down bytes a rolling day, counted here).
CREATE OR REPLACE FUNCTION public.social_duo_clip_get(p_user uuid, p_ref text, p_down bigint, p_urls integer)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
DECLARE
  c public.social_duo_clips%ROWTYPE;
  v_used bigint;
BEGIN
  SELECT c2.* INTO c FROM public.social_duo_clips c2
  JOIN public.social_duo_matches m ON m.id = c2.match_id
  JOIN public.social_duo_pairs p ON p.id = m.pair_id AND p.status = 'paired'
  WHERE c2.ref = p_ref AND c2.status = 'stored' AND m.expires_at > now() AND (p.user_a = p_user OR p.user_b = p_user)
    AND NOT public.social_duo_blocked(p.user_a, p.user_b);
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'reason', 'none'); END IF;
  PERFORM pg_advisory_xact_lock(hashtext('social-duo-bytes:' || p_user::text));
  SELECT COALESCE(sum(bytes), 0) INTO v_used FROM public.social_duo_bytes WHERE user_id = p_user AND dir = 'down' AND at > now() - interval '1 day';
  IF v_used + COALESCE(c.size, 0) > p_down THEN RETURN jsonb_build_object('ok', false, 'reason', 'budget'); END IF;
  -- And at most p_urls download URLs a rolling day, whatever their size: a
  -- signed URL can be fetched again within its few seconds (duos.md).
  IF (SELECT count(*) FROM public.social_duo_bytes WHERE user_id = p_user AND dir = 'down' AND at > now() - interval '1 day') >= p_urls THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'budget');
  END IF;
  INSERT INTO public.social_duo_bytes (user_id, dir, bytes, clip_id) VALUES (p_user, 'down', COALESCE(c.size, 0), c.id);
  RETURN jsonb_build_object('ok', true, 'reason', NULL, 'path', c.path, 'size', c.size);
END;
$function$;

-- A pin on the PARTNER'S clip: { ok, reason, ref }. Refused 'none', 'too-many' (p_max on one clip by one author).
CREATE OR REPLACE FUNCTION public.social_duo_pin(p_user uuid, p_clip text, p_at_ms integer, p_label text, p_reaction text, p_max integer)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
DECLARE
  c public.social_duo_clips%ROWTYPE;
  v_ref text;
BEGIN
  SELECT c2.* INTO c FROM public.social_duo_clips c2
  JOIN public.social_duo_matches m ON m.id = c2.match_id
  JOIN public.social_duo_pairs p ON p.id = m.pair_id AND p.status = 'paired'
  WHERE c2.ref = p_clip AND c2.status = 'stored' AND c2.user_id <> p_user AND m.expires_at > now()
    AND (p.user_a = p_user OR p.user_b = p_user) AND NOT public.social_duo_blocked(p.user_a, p.user_b);
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'reason', 'none'); END IF;
  IF (SELECT count(*) FROM public.social_duo_pins WHERE clip_id = c.id AND author = p_user) >= p_max THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'too-many');
  END IF;
  INSERT INTO public.social_duo_pins (clip_id, author, at_ms, label, reaction) VALUES (c.id, p_user, p_at_ms, p_label, p_reaction)
  RETURNING ref INTO v_ref;
  RETURN jsonb_build_object('ok', true, 'reason', NULL, 'ref', v_ref);
END;
$function$;

-- Take back one of this account's own pins.
CREATE OR REPLACE FUNCTION public.social_duo_pin_remove(p_user uuid, p_ref text)
RETURNS boolean
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
BEGIN
  DELETE FROM public.social_duo_pins WHERE ref = p_ref AND author = p_user;
  RETURN FOUND;
END;
$function$;

-- The Duos page was opened: the pins on this account's clips are seen.
CREATE OR REPLACE FUNCTION public.social_duo_seen(p_user uuid)
RETURNS boolean
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
BEGIN
  UPDATE public.social_duo_pairs SET a_seen_at = CASE WHEN user_a = p_user THEN now() ELSE a_seen_at END,
    b_seen_at = CASE WHEN user_b = p_user THEN now() ELSE b_seen_at END
  WHERE status = 'paired' AND (user_a = p_user OR user_b = p_user);
  RETURN true;
END;
$function$;

-- What a report about a duo player names for the owner's inbox: their opaque
-- profile id and username, only for a partner, a partner of the last 14 days
-- or an account that invited this one (never a stranger by name), else null.
CREATE OR REPLACE FUNCTION public.social_duo_report_target(p_user uuid, p_key text)
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $function$
  SELECT jsonb_build_object('public_id', o.public_id, 'username', o.username)
  FROM public.social_profiles o
  WHERE o.username_key = p_key AND o.user_id <> p_user
    AND (public.social_duo_pair_of(p_user, o.user_id) IS NOT NULL
         -- A teammate this account was shown as found (the same match, the same team, the last 3 days).
         OR EXISTS (SELECT 1 FROM public.social_duo_reports r1 JOIN public.social_duo_reports r2
                      ON r2.match_hash = r1.match_hash AND r2.team = r1.team
                    WHERE r1.user_id = p_user AND r2.user_id = o.user_id)
         OR EXISTS (SELECT 1 FROM public.social_duo_invites i WHERE i.from_user = o.user_id AND i.to_user = p_user
                      AND i.created_at > now() - interval '30 days')
         -- A duo that ended in the last 14 days: what was said in it can still be reported.
         OR EXISTS (SELECT 1 FROM public.social_duo_pairs p WHERE p.user_a = LEAST(p_user, o.user_id) AND p.user_b = GREATEST(p_user, o.user_id)
                      AND p.status = 'ended' AND p.ended_at > now() - interval '14 days'));
$function$;

-- THE SWEEP, a small batch at a time (the server's tick, and every upload):
-- expired shared matches deleted (their clips through the trash), ended duos
-- and old invites, reports, guesses and byte counts let go, and the next
-- p_limit paths of the trash answered for the server to remove from storage.
-- { paths: [..], stale: [{ ref }] }: stale are clips issued longer ago than
-- an upload URL lasts and never seen stored, for the server to look up.
CREATE OR REPLACE FUNCTION public.social_duo_sweep(p_limit integer, p_ended_days integer, p_report_days integer, p_quota_days integer)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
DECLARE
  v_n integer := LEAST(GREATEST(COALESCE(p_limit, 20), 1), 200);
BEGIN
  DELETE FROM public.social_duo_matches WHERE id IN (SELECT id FROM public.social_duo_matches WHERE expires_at <= now() ORDER BY expires_at LIMIT v_n);
  DELETE FROM public.social_duo_pairs WHERE id IN (SELECT id FROM public.social_duo_pairs WHERE status = 'ended'
    AND ended_at < now() - make_interval(days => p_ended_days) LIMIT v_n);
  DELETE FROM public.social_duo_invites WHERE id IN (SELECT id FROM public.social_duo_invites
    WHERE (status <> 'open' AND created_at < now() - interval '31 days') OR (status = 'open' AND expires_at < now() - interval '31 days') LIMIT v_n);
  DELETE FROM public.social_duo_reports WHERE at < now() - make_interval(days => p_report_days);
  DELETE FROM public.social_duo_guesses WHERE at < now() - interval '2 days';
  DELETE FROM public.social_duo_bytes WHERE id IN (SELECT id FROM public.social_duo_bytes
    WHERE at < now() - make_interval(days => p_quota_days + 1) LIMIT v_n * 10);
  RETURN jsonb_build_object(
    -- Only a path no live clip row points at is ever handed over for removal.
    'paths', COALESCE((SELECT jsonb_agg(t.path) FROM (SELECT tr.path FROM public.social_duo_trash tr
      WHERE NOT EXISTS (SELECT 1 FROM public.social_duo_clips c WHERE c.path = tr.path) ORDER BY tr.added_at LIMIT v_n) t), '[]'::jsonb),
    'stale', COALESCE((SELECT jsonb_agg(jsonb_build_object('ref', s.ref, 'path', s.path)) FROM (SELECT ref, path FROM public.social_duo_clips
      WHERE status = 'issued' AND issued_at < now() - interval '2 hours 10 minutes' ORDER BY issued_at LIMIT v_n) s), '[]'::jsonb));
END;
$function$;

-- The server removed these paths from storage: a row is let go once no
-- upload URL can land the file any more (not_before passed); one that still
-- could is kept, to be removed again on a later sweep.
CREATE OR REPLACE FUNCTION public.social_duo_trash_done(p_paths text[])
RETURNS integer
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
DECLARE
  v_n integer;
BEGIN
  -- A path a live row holds is never trash.
  DELETE FROM public.social_duo_trash t WHERE t.path = ANY (p_paths) AND EXISTS (SELECT 1 FROM public.social_duo_clips c WHERE c.path = t.path);
  DELETE FROM public.social_duo_trash WHERE path = ANY (p_paths) AND not_before <= now();
  GET DIAGNOSTICS v_n = ROW_COUNT;
  UPDATE public.social_duo_trash SET added_at = now() WHERE path = ANY (p_paths);
  RETURN v_n;
END;
$function$;

-- A clip issued long ago and never seen stored: its reserve is given back and
-- it goes (its path into the trash, in case the file lands later).
CREATE OR REPLACE FUNCTION public.social_duo_clip_drop(p_ref text)
RETURNS boolean
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
DECLARE
  v_id uuid;
BEGIN
  SELECT id INTO v_id FROM public.social_duo_clips WHERE ref = p_ref AND status = 'issued';
  IF v_id IS NULL THEN RETURN false; END IF;
  UPDATE public.social_duo_bytes SET bytes = 0 WHERE clip_id = v_id AND dir = 'up';
  DELETE FROM public.social_duo_clips WHERE id = v_id;
  RETURN true;
END;
$function$;

-- Discoverable through Duos, under the words that say what it allows: the
-- 8.19 flag and Duos' consent stamp together. { ok, reason }: 'no-username'.
CREATE OR REPLACE FUNCTION public.social_duo_set_discoverable(p_user uuid, p_on boolean)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
BEGIN
  UPDATE public.social_profiles SET discoverable = p_on, duo_discoverable_at = CASE WHEN p_on THEN now() ELSE NULL END, updated_at = now()
  WHERE user_id = p_user AND username IS NOT NULL;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'reason', 'no-username'); END IF;
  RETURN jsonb_build_object('ok', true, 'reason', NULL);
END;
$function$;

-- Whether this account is discoverable as Duos reads it (null: no profile).
CREATE OR REPLACE FUNCTION public.social_duo_discoverable(p_user uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $function$
  SELECT discoverable AND duo_discoverable_at IS NOT NULL FROM public.social_profiles WHERE user_id = p_user;
$function$;

-- Every storage path this migration's rows know, a page at a time, for the
-- purge before the undo (server/scripts/duos-purge.js).
CREATE OR REPLACE FUNCTION public.social_duo_all_paths(p_limit integer, p_after text)
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $function$
  SELECT COALESCE(jsonb_agg(x.path ORDER BY x.path), '[]'::jsonb) FROM (
    SELECT path FROM (SELECT path FROM public.social_duo_clips UNION SELECT path FROM public.social_duo_trash) u
    WHERE p_after IS NULL OR path > p_after ORDER BY path LIMIT LEAST(GREATEST(COALESCE(p_limit, 100), 1), 1000)) x;
$function$;

-- ── Only the service role may call them ───────────────────────────────────
-- THE FUNCTIONS THIS MIGRATION CREATES, by signature, the same list as the
-- undo's (test:duossql holds that every function created above is in it).
DO $grants$
DECLARE
  f text;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'public.social_duo_new_ref()',
    'public.social_duo_clip_gone()',
    'public.social_duo_on_block()',
    'public.social_duo_disc_off()',
    'public.social_duo_set_discoverable(uuid, boolean)',
    'public.social_duo_discoverable(uuid)',
    'public.social_duo_status()',
    'public.social_duo_max(uuid)',
    'public.social_duo_blocked(uuid, uuid)',
    'public.social_duo_pair_of(uuid, uuid)',
    'public.social_duo_count(uuid)',
    'public.social_duo_me(uuid, bigint, integer, integer)',
    'public.social_duo_invite_name(uuid, text, text, bigint, integer, integer)',
    'public.social_duo_invite_code(uuid, text, bigint, integer, integer)',
    'public.social_duo_join(uuid, uuid, integer)',
    'public.social_duo_accept_code(uuid, text, integer, integer)',
    'public.social_duo_accept_from(uuid, text, integer)',
    'public.social_duo_decline(uuid, text)',
    'public.social_duo_cancel(uuid, text)',
    'public.social_duo_remove(uuid, text)',
    'public.social_duo_report(uuid, text, text, text, integer, bigint, integer, integer)',
    'public.social_duo_matches_of(uuid, integer)',
    'public.social_duo_match(uuid, text)',
    'public.social_duo_sheet_put(uuid, text, jsonb, integer)',
    'public.social_duo_clip_start(uuid, text, text, integer, text, jsonb, bigint, integer, bigint, integer, integer)',
    'public.social_duo_clip_path(uuid, text)',
    'public.social_duo_clip_done(uuid, text, bigint, bigint)',
    'public.social_duo_clip_get(uuid, text, bigint, integer)',
    'public.social_duo_pin(uuid, text, integer, text, text, integer)',
    'public.social_duo_pin_remove(uuid, text)',
    'public.social_duo_seen(uuid)',
    'public.social_duo_report_target(uuid, text)',
    'public.social_duo_sweep(integer, integer, integer, integer)',
    'public.social_duo_trash_done(text[])',
    'public.social_duo_clip_drop(text)',
    'public.social_duo_all_paths(integer, text)'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', f);
  END LOOP;
END;
$grants$;

-- ── The private bucket: 80 MB a file, Matroska only ───────────────────────
-- Supabase Storage itself refuses a larger file or another type at upload,
-- whatever the app declared. If this project refuses the insert, the NOTICE
-- says so and the bucket is made by hand (see the top of this file).
DO $bucket$
BEGIN
  INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  VALUES ('duo-clips', 'duo-clips', false, 83886080, ARRAY['video/x-matroska'])
  ON CONFLICT (id) DO UPDATE SET public = false, file_size_limit = 83886080, allowed_mime_types = ARRAY['video/x-matroska'];
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'The duo-clips bucket was not made here (%): make it in the dashboard, private, 80 MB, video/x-matroska.', SQLERRM;
END;
$bucket$;

-- PostgREST reads the new functions at once.
NOTIFY pgrst, 'reload schema';
