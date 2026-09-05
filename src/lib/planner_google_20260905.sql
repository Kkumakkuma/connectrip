-- 플래너 구글 지도 전환 지원 SQL (2026-09-05, 운영 적용 완료)
--
-- 1) planner_catalog_refresh_due / _apply : 구글 장소 25일 지난 행 재조회(약관 3.2.3 — place ID 외 콘텐츠는 30일 넘게
--    보관 금지). service_role 전용. api/planner/_refresh_core.js 가 쓴다.
-- 2) pg_cron 'planner-catalog-refresh' : 매일 18:50 UTC(KST 03:50) purge 엔드포인트 ?task=refresh 호출 (별도 실행, jobid 4)
--
-- 호출 한도(planner_daily_reserve / planner_map_load_slot / planner_daily_hit / planner_daily_buckets)는 같은 날 쿠마님 결정
-- ("사용자가 한도에 막혀 떠나면 목표를 못 이룬다")으로 **전부 제거**했다. 아래 §3 의 DROP 이 운영에 적용된 상태다.
-- 남용 방어는 구글 콘솔 쿼터(쿠마님 결정)로만 한다.

-- ---------------------------------------------------------------------------
-- 1. 구글 카탈로그 재조회(약관 3.2.3). service_role 만.
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
-- 2. pg_cron (별도 실행, 적용 완료 jobid 4)
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

-- ---------------------------------------------------------------------------
-- 3. 호출 한도 제거 (2026-09-05 쿠마님 결정, 운영 적용 완료)
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.planner_map_load_slot();
DROP FUNCTION IF EXISTS public.planner_daily_reserve(text, integer);
DROP FUNCTION IF EXISTS public.planner_daily_reserve_internal(text, integer, date);
DROP FUNCTION IF EXISTS public.planner_daily_hit(text, integer);
DROP TABLE IF EXISTS public.planner_daily_buckets;

-- 확인: SELECT jobname, schedule FROM cron.job WHERE jobname = 'planner-catalog-refresh';

-- ---------------------------------------------------------------------------
-- 5. 이동시간 서버 계산·저장 (2026-09-05, 마이그레이션 planner_day_fp_service_role)
--    routes.js 가 body.day_id 로 그 날짜 핀을 DB 에서 읽어 구간을 계산하고 planner_days.legs 에
--    {mode, computed_at, fp, items} 로 저장한다. fp 는 저장 직전 planner_day_places_fp 로 다시 읽는다.
-- ---------------------------------------------------------------------------
GRANT EXECUTE ON FUNCTION public.planner_day_places_fp(uuid) TO service_role;

-- ---------------------------------------------------------------------------
-- 6. 이동시간 원자 저장 (2026-09-05, 마이그레이션 planner_save_day_legs, 교차검토 codex·agy 지적 반영)
--    · legs.mode 에 'AUTO'(구간별 자동 수단) 허용 — CHECK planner_days_legs_shape 재정의
--    · planner_save_day_legs(p_day_id, p_user_id, p_fp, p_legs): 날짜 행 FOR UPDATE 잠금 → 소유자 확인 → 지문 재계산이
--      p_fp 와 같을 때만 저장(true). 핀 변경 트랜잭션의 무효화 트리거는 같은 행 잠금을 기다리므로 어느 순서든 옛 legs 가 안 남는다.
-- ---------------------------------------------------------------------------
ALTER TABLE public.planner_days DROP CONSTRAINT IF EXISTS planner_days_legs_shape;
ALTER TABLE public.planner_days ADD CONSTRAINT planner_days_legs_shape CHECK (
  legs IS NULL OR COALESCE(
        jsonb_typeof(legs) = 'object'
    AND COALESCE(CASE WHEN jsonb_typeof(legs->'items') = 'array'
                      THEN jsonb_array_length(legs->'items') END, -1) BETWEEN 0 AND 200
    AND COALESCE(legs->>'mode', '') IN ('WALK','DRIVE','TRANSIT','AUTO')
    AND (legs->>'computed_at') IS NOT NULL
    AND COALESCE(legs->>'fp', '') ~ '^[0-9a-f]{32}$'
  , false)
);
CREATE OR REPLACE FUNCTION public.planner_save_day_legs(p_day_id uuid, p_user_id uuid, p_fp text, p_legs jsonb)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_catalog, pg_temp AS $$
DECLARE v_owner uuid; v_fp text;
BEGIN
  IF current_setting('request.jwt.claims', true)::jsonb->>'role' IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'service role required';
  END IF;
  IF p_day_id IS NULL OR p_user_id IS NULL OR p_fp IS NULL OR p_legs IS NULL THEN RETURN false; END IF;
  SELECT d.user_id INTO v_owner FROM public.planner_days d WHERE d.id = p_day_id FOR UPDATE;
  IF NOT FOUND OR v_owner IS DISTINCT FROM p_user_id THEN RETURN false; END IF;
  v_fp := public.planner_day_places_fp(p_day_id);
  IF v_fp IS DISTINCT FROM p_fp THEN RETURN false; END IF;
  UPDATE public.planner_days SET legs = p_legs WHERE id = p_day_id;
  RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.planner_save_day_legs(uuid, uuid, text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.planner_save_day_legs(uuid, uuid, text, jsonb) TO service_role;
