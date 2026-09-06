-- 플래너 대중교통 경로 요약 (2026-09-06)
-- 사용자 요청: "실시간 시각까지는 아니어도 대중교통 경로(노선·정류장·환승) 정도는 보여 달라".
--
-- 서버(api/planner/routes.js)가 TRANSIT 구간의 구글 Routes 응답에서 단계 요약(steps: 도보/탑승 목록)을 만들어
--   · planner_days.legs.items[].steps 에 그대로 저장(jsonb, RPC planner_save_day_legs 변경 없음)
--   · planner_route_cache.steps 에도 캐시(30일). 이 컬럼이 없으면 캐시 적중 때 요약이 비어 매번 구글을 다시 불러야 한다.
-- 정책 변화 없음: planner_route_cache 는 RLS on + 정책 없음 + 전부 REVOKE(service_role 만). 요약에는 개인정보가 없다(노선명·정류장명).
-- 비용: 호출 수 동일. 필드마스크 추가 항목(대중교통 상세)은 Compute Routes Essentials SKU 조건 안(구글 문서 확인).

ALTER TABLE public.planner_route_cache ADD COLUMN IF NOT EXISTS steps jsonb;
COMMENT ON COLUMN public.planner_route_cache.steps IS '대중교통 단계 요약 [{t:WALK,s}|{t:TRANSIT,v,line,from,to,stops,s}]. TRANSIT 모드에서 구글이 답했을 때만. NULL 이면 요약 없음(옛 캐시 → 재조회)';
