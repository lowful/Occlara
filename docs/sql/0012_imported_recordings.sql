-- Imported recordings (Occlara 8.12). Apply through Lovable on the site's
-- database, as the next drizzle migration, BEFORE the 8.12 app goes out. Until
-- it runs the server answers imports-not-ready and no import can start.
--
--   Free          no imports
--   Pro           5 a billing month, then only with a bought or earned game
--   Max           no monthly limit
--   Every import  needs a game and uses one, whatever ENFORCE_CAPS says
--
-- The 5 must match IMPORTS_PER_MONTH_PRO in server/services/caller.js.

ALTER TABLE public.game_usage DROP CONSTRAINT IF EXISTS game_usage_kind_check;
ALTER TABLE public.game_usage ADD CONSTRAINT game_usage_kind_check
  CHECK (kind IN ('live', 'riot', 'league', 'import'));

-- An import opened by a bought or earned game after Pro's 5. Its own column,
-- because settling a row writes its reason.
ALTER TABLE public.game_usage ADD COLUMN IF NOT EXISTS import_past_limit BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS game_usage_imports_idx
  ON public.game_usage (user_id, created_at) WHERE kind = 'import';

-- An import left reserved by a crash or a quit settles like a live game, on a
-- longer clock: a job can wait out a match the player starts meanwhile.
CREATE OR REPLACE FUNCTION public.entitlement_settle_stale(p_user uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  st record;
  v_back integer := 0;
BEGIN
  FOR st IN
    SELECT * FROM public.game_usage
    WHERE user_id = p_user AND status = 'reserved'
      AND ((kind = 'live' AND created_at < now() - interval '3 hours')
        OR (kind = 'import' AND created_at < now() - interval '12 hours'))
    ORDER BY created_at
    FOR UPDATE
  LOOP
    IF st.match_reads >= 120 THEN
      UPDATE public.game_usage SET status = 'counted', reason = 'reads', settled_at = now() WHERE id = st.id;
    ELSIF public.entitlement_refunds_today(p_user) >= 3 THEN
      UPDATE public.game_usage SET status = 'counted', reason = 'refund-cap', settled_at = now() WHERE id = st.id;
    ELSE
      UPDATE public.game_usage SET status = 'refunded', reason = 'stale', settled_at = now() WHERE id = st.id;
      IF st.source = 'bonus' THEN
        UPDATE public.entitlements SET bonus_pool = bonus_pool + 1, updated_at = now()
          WHERE user_id = p_user AND status = 'active';
        IF FOUND THEN
          v_back := v_back + 1;
        END IF;
      END IF;
    END IF;
  END LOOP;
  RETURN v_back;
END;
$function$;

-- The imports this period that count against Pro's 5. One paid for with a
-- bought or earned game past the 5 (import_past_limit) does not.
CREATE OR REPLACE FUNCTION public.count_imports(p_user uuid, p_from timestamptz)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT count(*)::integer FROM public.game_usage g
  WHERE g.user_id = p_user AND g.kind = 'import'
    AND g.status IN ('reserved', 'counted')
    AND g.created_at >= p_from
    AND NOT g.import_past_limit;
$function$;

-- What the import panel shows. Writes nothing but the stale settle.
CREATE OR REPLACE FUNCTION public.import_state(p_user uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  e public.entitlements%ROWTYPE;
  al record;
  v_paid boolean;
  v_monthly integer;
  v_used integer := 0;
  v_imports_left integer;
  v_games integer;
  v_reason text := NULL;
BEGIN
  PERFORM public.ensure_entitlement(p_user);
  PERFORM 1 FROM public.entitlements WHERE user_id = p_user FOR UPDATE;
  PERFORM public.entitlement_settle_stale(p_user);
  SELECT * INTO e FROM public.entitlements WHERE user_id = p_user;
  SELECT * INTO al FROM public.entitlement_allowance(e);

  v_paid := e.tier IN ('pro', 'max') AND e.status = 'active';
  v_monthly := CASE WHEN v_paid AND e.tier = 'pro' THEN 5 ELSE NULL END;
  v_games := al.allowance_left + e.bonus_pool;
  IF v_paid THEN
    v_used := public.count_imports(p_user, al.period_start);
  END IF;
  v_imports_left := CASE WHEN v_monthly IS NULL THEN NULL ELSE greatest(v_monthly - v_used, 0) END;

  IF NOT v_paid THEN
    v_reason := 'plan';
  ELSIF v_monthly IS NOT NULL AND v_imports_left = 0 AND e.bonus_pool <= 0 THEN
    v_reason := 'imports';
  ELSIF v_games <= 0 THEN
    v_reason := 'games';
  END IF;

  RETURN jsonb_build_object(
    'tier', CASE WHEN v_paid THEN e.tier ELSE 'free' END,
    'allowed', v_reason IS NULL,
    'reason', v_reason,
    'monthly', v_monthly,
    'imports_left', v_imports_left,
    'games_left', v_games,
    'bonus_pool', e.bonus_pool,
    'period_end', al.period_end
  );
END;
$function$;

-- One import and one game, decided and written under the entitlement's lock,
-- so two imports started together can never both take the last one. The row
-- starts reserved; the server settles it (settle_game) when the job ends.
CREATE OR REPLACE FUNCTION public.claim_import(
  p_user uuid,
  p_client_match_id text,
  p_device_hash text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  e public.entitlements%ROWTYPE;
  al record;
  u public.game_usage%ROWTYPE;
  v_paid boolean;
  v_monthly integer;
  v_used integer := 0;
  v_source text;
  v_past boolean := false;
  v_allowance integer;
BEGIN
  IF p_user IS NULL THEN
    RAISE EXCEPTION 'claim_import: no user';
  END IF;
  IF p_client_match_id IS NULL OR p_client_match_id NOT LIKE 'import:%' THEN
    RAISE EXCEPTION 'claim_import: bad id';
  END IF;

  PERFORM public.ensure_entitlement(p_user);
  SELECT * INTO e FROM public.entitlements WHERE user_id = p_user FOR UPDATE;
  e.bonus_pool := e.bonus_pool + public.entitlement_settle_stale(p_user);
  SELECT * INTO al FROM public.entitlement_allowance(e);

  v_paid := e.tier IN ('pro', 'max') AND e.status = 'active';
  v_monthly := CASE WHEN v_paid AND e.tier = 'pro' THEN 5 ELSE NULL END;
  IF v_paid THEN
    v_used := public.count_imports(p_user, al.period_start);
  END IF;
  v_allowance := al.allowance_left;

  -- The same job asked again answers what it got the first time.
  SELECT * INTO u FROM public.game_usage WHERE user_id = p_user AND client_match_id = p_client_match_id;
  IF FOUND THEN
    RETURN jsonb_build_object('granted', u.status <> 'refunded', 'usage_id', u.id, 'reason', 'existing',
      'tier', e.tier, 'monthly', v_monthly,
      'imports_left', CASE WHEN v_monthly IS NULL THEN NULL ELSE greatest(v_monthly - v_used, 0) END,
      'games_left', v_allowance + e.bonus_pool, 'bonus_pool', e.bonus_pool, 'period_end', al.period_end);
  END IF;

  IF NOT v_paid THEN
    RETURN jsonb_build_object('granted', false, 'reason', 'plan', 'tier', 'free',
      'games_left', v_allowance + e.bonus_pool, 'bonus_pool', e.bonus_pool);
  END IF;

  IF v_monthly IS NOT NULL AND v_used >= v_monthly THEN
    -- Past Pro's 5: only a bought or earned game opens one more.
    IF e.bonus_pool <= 0 THEN
      RETURN jsonb_build_object('granted', false, 'reason', 'imports', 'tier', e.tier, 'monthly', v_monthly,
        'imports_left', 0, 'games_left', v_allowance, 'bonus_pool', 0, 'period_end', al.period_end);
    END IF;
    v_source := 'bonus';
    v_past := true;
  ELSIF v_allowance > 0 THEN
    v_source := 'allowance';
  ELSIF e.bonus_pool > 0 THEN
    v_source := 'bonus';
  ELSE
    RETURN jsonb_build_object('granted', false, 'reason', 'games', 'tier', e.tier, 'monthly', v_monthly,
      'imports_left', CASE WHEN v_monthly IS NULL THEN NULL ELSE greatest(v_monthly - v_used, 0) END,
      'games_left', 0, 'bonus_pool', 0, 'period_end', al.period_end);
  END IF;

  INSERT INTO public.game_usage (user_id, period_start, game, kind, client_match_id, device_hash, status, source, over_cap, import_past_limit)
  VALUES (p_user, al.period_start, 'valorant', 'import', p_client_match_id, p_device_hash, 'reserved', v_source, false, v_past)
  RETURNING * INTO u;

  IF v_source = 'bonus' THEN
    UPDATE public.entitlements SET bonus_pool = bonus_pool - 1, updated_at = now() WHERE user_id = p_user;
    e.bonus_pool := e.bonus_pool - 1;
  ELSE
    v_allowance := v_allowance - 1;
  END IF;
  IF NOT v_past THEN
    v_used := v_used + 1;
  END IF;

  RETURN jsonb_build_object('granted', true, 'usage_id', u.id, 'reason', NULL,
    'tier', e.tier, 'monthly', v_monthly,
    'imports_left', CASE WHEN v_monthly IS NULL THEN NULL ELSE greatest(v_monthly - v_used, 0) END,
    'games_left', greatest(v_allowance, 0) + e.bonus_pool, 'bonus_pool', e.bonus_pool, 'period_end', al.period_end);
END;
$function$;

REVOKE ALL ON FUNCTION public.entitlement_settle_stale(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.count_imports(uuid, timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.import_state(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.claim_import(uuid, text, text) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.entitlement_settle_stale(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.count_imports(uuid, timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION public.import_state(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_import(uuid, text, text) TO service_role;
