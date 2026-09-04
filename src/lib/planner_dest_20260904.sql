-- ---------------------------------------------------------------------------
-- 플래너: 목적지 컬럼 추가 + 게시글 동기화 판정 버그 수정 (2026-09-04)
--
-- planner_20260904.sql 이후에 적용하는 추가 마이그레이션이다. 전부 멱등이라
-- 여러 번 돌려도 된다. Supabase SQL Editor 에 통째로 붙여 넣고 Run 하면 된다.
--
-- 무엇을 고치나
--  1) [기존 버그] planner_build_snapshot 은 호출할 때마다 generated_at 에 now() 를 넣는데,
--     동기화 판정(planner_board_sync_state / _list)이 스냅샷 전문의 md5 를 비교한다.
--     그래서 내용이 하나도 안 바뀌어도 게시글이 항상 "반영 안 됨"으로 표시된다.
--     운영 DB 실측(2026-09-04): 게시글 1건이 변경 없이 stale=true, generated_at 을 빼면 false.
--     → 비교에서 generated_at 을 제외한다.
--  2) 목적지(dest_*) 컬럼. 여행판이 비었을 때 그 도시의 추천 명소를 보여주는 데 쓴다.
--     dest_id = 정적 목적지 목록(public/planner-data/destinations.json)의 슬러그.
--     목록에 없는 도시를 직접 검색해 고르면 dest_id 는 NULL 이고 이름·좌표만 남는다.
--  3) planner_create_trip 에 목적지 인자 4개 추가.
--  4) planner_import 가 원본 여행의 목적지를 그대로 복사한다.
--     스냅샷에는 dest_* 를 넣지 않는다 — 스냅샷 형식 v 를 유지한 채 키를 추가하면
--     이미 게시된 글이 전부 stale 로 뒤집힌다. planner_import 는 양쪽 경로(post/token)에서
--     이미 원본 여행 id(v_src_trip)를 들고 있으므로 거기서 바로 읽어 온다.
-- ---------------------------------------------------------------------------

BEGIN;

-- --- 1. 동기화 판정에서 생성시각 제외 ---------------------------------------
CREATE OR REPLACE FUNCTION public.planner_board_sync_state(p_trip_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path = public, pg_temp AS $$
DECLARE v_me uuid := auth.uid(); v_post_id uuid; v_snap jsonb; v_updated timestamptz; v_cur jsonb;
BEGIN
  IF v_me IS NULL THEN RAISE EXCEPTION 'auth required'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.planner_trips WHERE id = p_trip_id AND user_id = v_me) THEN RAISE EXCEPTION 'not found'; END IF;
  SELECT id, snapshot, updated_at INTO v_post_id, v_snap, v_updated
    FROM public.itinerary_posts WHERE trip_id = p_trip_id AND user_id = v_me;
  IF v_post_id IS NULL THEN RETURN jsonb_build_object('published', false, 'stale', false); END IF;
  v_cur := public.planner_build_snapshot(p_trip_id);
  RETURN jsonb_build_object(
    'published', true, 'post_id', v_post_id, 'post_updated_at', v_updated,
    -- 스냅샷 형식 v 가 올라간 뒤에는 전량 stale 로 보이지 않도록 같은 버전일 때만 비교한다.
    -- generated_at 은 매 호출 now() 이므로 비교에서 반드시 빼야 한다(안 빼면 항상 stale).
    'stale', CASE WHEN v_cur IS NULL OR (v_snap->>'v') IS DISTINCT FROM (v_cur->>'v') THEN false
                  ELSE md5((v_cur - 'generated_at')::text) IS DISTINCT FROM md5((v_snap - 'generated_at')::text) END);
END $$;
REVOKE ALL ON FUNCTION public.planner_board_sync_state(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.planner_board_sync_state(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.planner_board_sync_list()
RETURNS TABLE (trip_id uuid, post_id uuid, stale boolean)
LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public, pg_temp AS $$
  SELECT p.trip_id, p.id,
         CASE WHEN cur.snap IS NULL OR (p.snapshot->>'v') IS DISTINCT FROM (cur.snap->>'v') THEN false
              ELSE md5((cur.snap - 'generated_at')::text) IS DISTINCT FROM md5((p.snapshot - 'generated_at')::text) END
  FROM public.itinerary_posts p
  CROSS JOIN LATERAL (SELECT public.planner_build_snapshot(p.trip_id) AS snap) cur
  WHERE p.user_id = auth.uid();
$$;
REVOKE ALL ON FUNCTION public.planner_board_sync_list() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.planner_board_sync_list() TO authenticated;

-- --- 2. 목적지 컬럼 ----------------------------------------------------------
ALTER TABLE public.planner_trips ADD COLUMN IF NOT EXISTS dest_id   text;
ALTER TABLE public.planner_trips ADD COLUMN IF NOT EXISTS dest_name text;
ALTER TABLE public.planner_trips ADD COLUMN IF NOT EXISTS dest_lat  double precision;
ALTER TABLE public.planner_trips ADD COLUMN IF NOT EXISTS dest_lng  double precision;

ALTER TABLE public.planner_trips DROP CONSTRAINT IF EXISTS planner_trips_dest_check;
ALTER TABLE public.planner_trips ADD CONSTRAINT planner_trips_dest_check CHECK (
      (dest_id   IS NULL OR dest_id ~ '^[a-z0-9][a-z0-9_-]{0,39}$')
  AND (dest_name IS NULL OR length(btrim(dest_name)) BETWEEN 1 AND 120)
  AND (dest_lat  IS NULL OR dest_lat BETWEEN -90 AND 90)
  AND (dest_lng  IS NULL OR dest_lng BETWEEN -180 AND 180)
  -- 좌표는 쌍으로만 존재한다
  AND ((dest_lat IS NULL) = (dest_lng IS NULL))
  -- 목록에서 고른 목적지(dest_id 있음)는 이름과 좌표가 반드시 있어야 한다.
  -- 추천 명소 조회와 타임존 폴백이 둘 다 좌표를 필요로 한다.
  AND (dest_id IS NULL OR (dest_name IS NOT NULL AND dest_lat IS NOT NULL))
);

-- 컬럼 단위 GRANT 는 새로 추가한 컬럼을 자동으로 포함하지 않는다.
-- GRANT 는 합집합이라 기존 컬럼 권한은 그대로 유지된다.
GRANT UPDATE (dest_id, dest_name, dest_lat, dest_lng) ON public.planner_trips TO authenticated;

-- --- 3. 여행 생성 RPC 확장 ---------------------------------------------------
-- 기존 5인자와 새 9인자가 공존하면 PostgREST 가 이름 기반으로 함수를 고르지 못한다(오버로드 모호성).
-- 같은 트랜잭션에서 DROP → CREATE 하므로 밖에서 함수가 없는 구간은 보이지 않는다.
-- 뒤 4개가 전부 DEFAULT 라 구버전 프런트의 5인자 호출도 그대로 받는다(배포 순서: SQL 먼저).
DROP FUNCTION IF EXISTS public.planner_create_trip(text, date, date, text, text);

CREATE FUNCTION public.planner_create_trip(
  p_title text, p_start date, p_end date,
  p_currency text DEFAULT 'KRW', p_country text DEFAULT NULL,
  p_dest_id text DEFAULT NULL, p_dest_name text DEFAULT NULL,
  p_dest_lat double precision DEFAULT NULL, p_dest_lng double precision DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_me uuid := auth.uid(); v_id uuid; v_i integer;
        v_dest_id text; v_dest_name text;
BEGIN
  IF v_me IS NULL THEN RAISE EXCEPTION 'auth required'; END IF;
  IF p_title IS NULL OR length(btrim(p_title)) NOT BETWEEN 1 AND 80 THEN RAISE EXCEPTION 'bad title'; END IF;
  IF p_start IS NULL OR p_end IS NULL OR p_end < p_start OR (p_end - p_start) > 60 THEN RAISE EXCEPTION 'bad dates'; END IF;

  -- 좌표는 쌍으로만 받는다. 한쪽만 온 것은 클라이언트 버그라 조용히 NULL 로 삼키지 않고 거절한다.
  IF (p_dest_lat IS NULL) <> (p_dest_lng IS NULL) THEN RAISE EXCEPTION 'bad coords'; END IF;
  IF p_dest_lat IS NOT NULL AND (p_dest_lat NOT BETWEEN -90 AND 90 OR p_dest_lng NOT BETWEEN -180 AND 180) THEN
    RAISE EXCEPTION 'bad coords';
  END IF;

  v_dest_name := left(NULLIF(btrim(COALESCE(p_dest_name, '')), ''), 120);
  v_dest_id   := NULLIF(btrim(lower(COALESCE(p_dest_id, ''))), '');
  IF v_dest_id IS NOT NULL AND v_dest_id !~ '^[a-z0-9][a-z0-9_-]{0,39}$' THEN RAISE EXCEPTION 'bad dest'; END IF;
  -- 목록에서 고른 목적지는 이름·좌표가 함께 와야 한다(CHECK 와 같은 규칙을 여기서 먼저 막는다).
  IF v_dest_id IS NOT NULL AND (v_dest_name IS NULL OR p_dest_lat IS NULL) THEN RAISE EXCEPTION 'bad dest'; END IF;

  INSERT INTO public.planner_trips (user_id, title, start_date, end_date, currency, country,
                                    dest_id, dest_name, dest_lat, dest_lng)
  VALUES (v_me, btrim(p_title), p_start, p_end,
          COALESCE(NULLIF(upper(btrim(p_currency)), ''), 'KRW'), NULLIF(btrim(p_country), ''),
          v_dest_id, v_dest_name, p_dest_lat, p_dest_lng)
  RETURNING id INTO v_id;

  FOR v_i IN 0..(p_end - p_start) LOOP
    INSERT INTO public.planner_days (trip_id, user_id, day_index, date) VALUES (v_id, v_me, v_i, p_start + v_i);
  END LOOP;
  RETURN v_id;
END $$;

-- 함수를 DROP 하면 그 함수에 걸려 있던 ACL 도 함께 사라진다. 새 시그니처에 다시 건다.
REVOKE ALL ON FUNCTION public.planner_create_trip(text, date, date, text, text, text, text, double precision, double precision)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.planner_create_trip(text, date, date, text, text, text, text, double precision, double precision)
  TO authenticated;

-- --- 4. 가져오기가 원본 여행의 목적지를 복사한다 ------------------------------
-- 현재 정의를 그대로 읽어 여행 INSERT 한 줄만 바꾼다. 손으로 옮겨 적으면 나머지 본문에서
-- 실수가 나므로 pg_get_functiondef 를 원본으로 삼는다. 이미 적용됐으면 아무것도 하지 않는다.
DO $mig$
DECLARE v_def text; v_new text; v_from text; v_to text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_def
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'planner_import'
     AND pg_get_function_identity_arguments(p.oid) = 'p_post_id uuid, p_token text';
  IF v_def IS NULL THEN RAISE EXCEPTION 'planner_import(uuid, text) 를 찾지 못했습니다'; END IF;

  IF position('dest_id' IN v_def) > 0 THEN
    RAISE NOTICE 'planner_import 는 이미 목적지를 복사합니다 — 건너뜁니다.';
    RETURN;
  END IF;

  v_from := 'INSERT INTO public.planner_trips (user_id, title, start_date, end_date, currency, country, origin_post_id)';
  v_to   := 'INSERT INTO public.planner_trips (user_id, title, start_date, end_date, currency, country, origin_post_id,'
         || ' dest_id, dest_name, dest_lat, dest_lng)';
  IF position(v_from IN v_def) = 0 THEN RAISE EXCEPTION 'planner_import 의 여행 INSERT 컬럼 목록을 찾지 못했습니다'; END IF;
  v_new := replace(v_def, v_from, v_to);

  v_from := 'VALUES (v_me, v_title, v_start, v_end, v_currency, v_country, p_post_id) RETURNING id INTO v_trip;';
  v_to   := 'VALUES (v_me, v_title, v_start, v_end, v_currency, v_country, p_post_id,'
         || ' v_dest_id, v_dest_name, v_dest_lat, v_dest_lng) RETURNING id INTO v_trip;';
  IF position(v_from IN v_new) = 0 THEN RAISE EXCEPTION 'planner_import 의 여행 VALUES 절을 찾지 못했습니다'; END IF;
  v_new := replace(v_new, v_from, v_to);

  -- 변수 선언 추가 + 원본 여행에서 목적지 읽기. v_src_trip 은 post·token 두 경로 모두에서 채워진다.
  v_from := '  v_src_trip uuid; v_n integer := 0; v_dn integer := 0;';
  v_to   := '  v_src_trip uuid; v_n integer := 0; v_dn integer := 0;'
         || E'\n  v_dest_id text; v_dest_name text; v_dest_lat double precision; v_dest_lng double precision;';
  IF position(v_from IN v_new) = 0 THEN RAISE EXCEPTION 'planner_import 의 DECLARE 절을 찾지 못했습니다'; END IF;
  v_new := replace(v_new, v_from, v_to);

  -- 스냅샷에는 목적지가 없다(형식 v 를 유지하려고 일부러 뺐다). 원본 여행 행에서 직접 읽는다.
  -- 원본이 이미 지워졌으면 v_src_trip 이 NULL 이거나 조회가 0행이라 그대로 NULL 로 남는다.
  v_from := '  v_title := left(COALESCE(NULLIF(btrim(v_snap->>''title''), ''''), ''가져온 일정''), 80);';
  v_to   := '  IF v_src_trip IS NOT NULL THEN'
         || E'\n    SELECT t.dest_id, t.dest_name, t.dest_lat, t.dest_lng'
         || E'\n      INTO v_dest_id, v_dest_name, v_dest_lat, v_dest_lng'
         || E'\n      FROM public.planner_trips t WHERE t.id = v_src_trip;'
         || E'\n  END IF;'
         || E'\n' || v_from;
  IF position(v_from IN v_new) = 0 THEN RAISE EXCEPTION 'planner_import 의 제목 처리 구문을 찾지 못했습니다'; END IF;
  v_new := replace(v_new, v_from, v_to);

  EXECUTE v_new;
  RAISE NOTICE 'planner_import 에 목적지 복사를 넣었습니다.';
END $mig$;

REVOKE ALL ON FUNCTION public.planner_import(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.planner_import(uuid, text) TO authenticated;

COMMIT;

-- PostgREST 스키마 캐시를 즉시 갱신한다(안 하면 잠깐 구버전 시그니처를 들고 있을 수 있다).
NOTIFY pgrst, 'reload schema';

-- ---------------------------------------------------------------------------
-- 되돌리기 (이 파일이 만든 것만)
--   ALTER TABLE public.planner_trips DROP CONSTRAINT IF EXISTS planner_trips_dest_check;
--   ALTER TABLE public.planner_trips
--     DROP COLUMN IF EXISTS dest_id, DROP COLUMN IF EXISTS dest_name,
--     DROP COLUMN IF EXISTS dest_lat, DROP COLUMN IF EXISTS dest_lng;
--   DROP FUNCTION IF EXISTS public.planner_create_trip(
--     text, date, date, text, text, text, text, double precision, double precision);
--   그 뒤 planner_20260904.sql 의 planner_create_trip / planner_board_sync_state /
--   planner_board_sync_list / planner_import 블록을 다시 실행하면 원상복구된다.
-- ---------------------------------------------------------------------------
