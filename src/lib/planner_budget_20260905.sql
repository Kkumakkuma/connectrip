-- 플래너 외부 제공자(구글 Routes) 일일 예산 카운터 (2026-09-05, 운영 적용: 마이그레이션 planner_daily_budget)
--
-- 왜: api/planner/routes.js 는 한 요청에 최대 30구간을 계산한다. 사용자 축 요청 제한(120/10분)만으로는
--     구글 호출이 30배 증폭된다(codex 감사 ③). 구글 Routes 는 월 10,000회까지 무료(2025-03 요금제, Essentials)이고
--     넘으면 1,000회당 5달러 — 쿠마님 "추가 지출 금지" 원칙에 따라 무료 범위 안에서만 호출한다.
-- 무엇: planner_rate_hit(10분 창)는 하루 누적을 못 세므로 일일 버킷 테이블 + planner_daily_hit RPC 를 둔다.
--     routes.js 는 캐시 미스로 실제 구글을 부르는 구간마다 (사용자 200/10분) + (전역 300/일) 두 예산을 함께 세고,
--     초과하거나 카운터 RPC 가 실패하면 구글을 부르지 않고 추정치로 답한다(fail-closed).
-- 300/일 × 30일 = 9,000 < 10,000(무료). 한도를 올리려면 routes.js 의 p_limit 과 여기 기본값을 같이 바꾼다.

CREATE TABLE IF NOT EXISTS public.planner_daily_buckets (
  key TEXT NOT NULL,
  day DATE NOT NULL,
  hits INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (key, day)
);
ALTER TABLE public.planner_daily_buckets ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.planner_daily_buckets FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.planner_daily_hit(p_key TEXT, p_limit INTEGER DEFAULT 300)
RETURNS INTEGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_catalog, pg_temp AS $$
DECLARE v_day DATE := (now() AT TIME ZONE 'Asia/Seoul')::date; v_hits INTEGER;
BEGIN
  IF current_setting('request.jwt.claims', true)::jsonb->>'role' IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'service role required';
  END IF;
  IF COALESCE(btrim(p_key), '') = '' THEN RETURN 0; END IF;
  DELETE FROM public.planner_daily_buckets WHERE day < v_day - 7;
  INSERT INTO public.planner_daily_buckets (key, day, hits) VALUES (p_key, v_day, 1)
  ON CONFLICT (key, day) DO UPDATE SET hits = public.planner_daily_buckets.hits + 1
  RETURNING hits INTO v_hits;
  RETURN v_hits;
END;
$$;
REVOKE ALL ON FUNCTION public.planner_daily_hit(TEXT, INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.planner_daily_hit(TEXT, INTEGER) TO service_role;

-- 확인: SELECT key, day, hits FROM public.planner_daily_buckets ORDER BY day DESC;
-- 구글 제공자 켜기(키 등록 후): planner_settings 의 google 플래그 → planner_google_enabled() 가 true 를 돌려주게 (planner_20260904.sql 참고)
