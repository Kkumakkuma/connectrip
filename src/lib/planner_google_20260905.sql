-- 플래너 구글 지도 전환 지원 SQL (2026-09-05, 등급 3 교차검토 반영 v2)
--
-- 1) planner_daily_reserve       : 조건부 일일 예약(hits < limit 일 때만 +1, 초과 뒤엔 안 올림 — codex 지적)
-- 2) planner_map_load_slot       : 로그인 사용자가 구글 지도를 그리기 직전에 부른다(사용자 60/일 → 전역 300/일)
-- 3) planner_catalog_refresh_due / _apply : 구글 장소 25일 지난 행 재조회(약관 3.2.3, agy 지적) — service_role 전용
-- 4) pg_cron 'planner-catalog-refresh' : 매일 18:50 UTC(KST 03:50) purge 엔드포인트 ?task=refresh 호출 (별도 실행)
--
-- 한도 근거(2026-09-05 실측, 2025-03 요금제): Dynamic Maps 월 10,000 무료 → 300/일×31=9,300.
-- Place Details Pro 월 5,000 무료 → 100/일×31=3,100. 한도를 바꾸면 프런트/서버 상수와 같이 바꾼다.

-- ---------------------------------------------------------------------------
-- 1. 조건부 일일 예약. 내부 함수(권한 검사 없음)는 다른 SECURITY DEFINER 함수에서만 부른다.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.planner_daily_reserve_internal(p_key text, p_limit integer, p_day date)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_catalog, pg_temp AS $$
DECLARE v_hits integer;
BEGIN
  IF COALESCE(btrim(p_key), '') = '' OR p_limit IS NULL OR p_limit < 1 OR p_day IS NULL THEN RETURN false; END IF;
  DELETE FROM public.planner_daily_buckets WHERE day < p_day - 7;
  INSERT INTO public.planner_daily_buckets (key, day, hits) VALUES (p_key, p_day, 1)
  ON CONFLICT (key, day) DO UPDATE SET hits = public.planner_daily_buckets.hits + 1
    WHERE public.planner_daily_buckets.hits < p_limit
  RETURNING hits INTO v_hits;
  -- WHERE 에 걸려 갱신되지 않으면 RETURNING 이 비고 v_hits 는 NULL → 예약 실패.
  RETURN v_hits IS NOT NULL;
END $$;
REVOKE ALL ON FUNCTION public.planner_daily_reserve_internal(text, integer, date) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.planner_daily_reserve(p_key text, p_limit integer)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_catalog, pg_temp AS $$
BEGIN
  IF current_setting('request.jwt.claims', true)::jsonb->>'role' IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'service role required';
  END IF;
  RETURN public.planner_daily_reserve_internal(p_key, p_limit, (now() AT TIME ZONE 'Asia/Seoul')::date);
END $$;
REVOKE ALL ON FUNCTION public.planner_daily_reserve(text, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.planner_daily_reserve(text, integer) TO service_role;

-- ---------------------------------------------------------------------------
-- 2. 지도 로드 슬롯. 프런트 google/MapView.jsx 가 <Map> 을 그리기 전에 한 번 부른다.
--    · 플래그가 꺼져 있으면 false(카운트도 안 한다) · 사용자 60/일 먼저, 통과했을 때만 전역 300/일.
--    · 한 계정이 전역을 혼자 태우지 못하게 사용자 축을 먼저 센다. 한도 도달 시 지도만 안 뜨고 편집은 된다.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.planner_map_load_slot()
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_catalog, pg_temp AS $$
DECLARE v_uid uuid := auth.uid(); v_day date := (now() AT TIME ZONE 'Asia/Seoul')::date;
BEGIN
  IF v_uid IS NULL THEN RETURN false; END IF;
  IF NOT public.planner_google_enabled() THEN RETURN false; END IF;
  IF NOT public.planner_daily_reserve_internal('google_map_loads:user:' || v_uid::text, 60, v_day) THEN RETURN false; END IF;
  RETURN public.planner_daily_reserve_internal('google_map_loads', 300, v_day);
END $$;
REVOKE ALL ON FUNCTION public.planner_map_load_slot() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.planner_map_load_slot() TO authenticated;

-- ---------------------------------------------------------------------------
-- 3. 구글 카탈로그 재조회(약관 3.2.3). service_role 만.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.planner_catalog_refresh_due(p_limit integer DEFAULT 40)
RETURNS TABLE (id uuid, provider_place_id text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_catalog, pg_temp AS $$
BEGIN
  IF current_setting('request.jwt.claims', true)::jsonb->>'role' IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'service role required';
  END IF;
  RETURN QUERY
    SELECT c.id, c.provider_place_id
      FROM public.planner_catalog c
     WHERE c.provider = 'google' AND c.fetched_at < now() - interval '25 days'
     ORDER BY c.fetched_at ASC
     LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 40), 100));
END $$;
REVOKE ALL ON FUNCTION public.planner_catalog_refresh_due(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.planner_catalog_refresh_due(integer) TO service_role;

-- p_name 이 NULL 이면 값은 그대로 두고 fetched_at 만 올린다(404·형식 불량). 값이 오면 카탈로그와 사용자 핀 사본을 같이 갱신한다.
-- 핀 사본의 이름·주소는 사용자가 손대지 않은 경우(=옛 카탈로그 값과 같은 경우)만 바꾸고, 좌표는 항상 맞춘다.
CREATE OR REPLACE FUNCTION public.planner_catalog_refresh_apply(
  p_id uuid, p_name text, p_address text, p_lat double precision, p_lng double precision)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_catalog, pg_temp AS $$
DECLARE v_old_name text; v_old_addr text; v_name text; v_addr text;
BEGIN
  IF current_setting('request.jwt.claims', true)::jsonb->>'role' IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'service role required';
  END IF;
  SELECT c.name, c.address INTO v_old_name, v_old_addr
    FROM public.planner_catalog c WHERE c.id = p_id AND c.provider = 'google' FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;

  IF p_name IS NULL THEN
    UPDATE public.planner_catalog SET fetched_at = now() WHERE id = p_id;
    RETURN;
  END IF;

  v_name := btrim(p_name);
  IF length(v_name) NOT BETWEEN 1 AND 200 THEN RAISE EXCEPTION 'bad name'; END IF;
  IF p_lat IS NULL OR p_lng IS NULL OR p_lat NOT BETWEEN -90 AND 90 OR p_lng NOT BETWEEN -180 AND 180 THEN
    RAISE EXCEPTION 'bad coords';
  END IF;
  v_addr := NULLIF(left(btrim(COALESCE(p_address, '')), 300), '');

  UPDATE public.planner_catalog
     SET name = v_name, address = v_addr, lat = p_lat, lng = p_lng, fetched_at = now()
   WHERE id = p_id;

  UPDATE public.planner_places pl
     SET lat = p_lat,
         lng = p_lng,
         name = CASE WHEN pl.name = v_old_name THEN v_name ELSE pl.name END,
         address = CASE WHEN pl.address IS NOT DISTINCT FROM v_old_addr THEN v_addr ELSE pl.address END
   WHERE pl.catalog_id = p_id
     AND (pl.lat IS DISTINCT FROM p_lat OR pl.lng IS DISTINCT FROM p_lng
          OR pl.name = v_old_name OR pl.address IS NOT DISTINCT FROM v_old_addr);
END $$;
REVOKE ALL ON FUNCTION public.planner_catalog_refresh_apply(uuid, text, text, double precision, double precision) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.planner_catalog_refresh_apply(uuid, text, text, double precision, double precision) TO service_role;

-- ---------------------------------------------------------------------------
-- 4. pg_cron (별도 실행 — 마이그레이션 분류기가 cron 을 섞으면 막는 실측이 있어 따로 돌린다)
-- ---------------------------------------------------------------------------
-- select cron.schedule('planner-catalog-refresh', '50 18 * * *', $cron$
--   select net.http_get(
--     url := 'https://www.connecttrip.co.kr/api/planner/purge?task=refresh',
--     headers := jsonb_build_object(
--       'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'ct_planner_purge_secret'),
--       'User-Agent', 'ct-pgcron/1.0'
--     ),
--     timeout_milliseconds := 60000
--   );
-- $cron$);
--
-- 확인: SELECT key, day, hits FROM public.planner_daily_buckets ORDER BY day DESC, key;
--       SELECT jobname, schedule FROM cron.job WHERE jobname = 'planner-catalog-refresh';
