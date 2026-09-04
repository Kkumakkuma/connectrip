-- ============================================================================
-- 커넥트립 플래너 스키마 v2 (planner_20260904 → v2)  — 운영 DB 적용본, 재실행 안전(멱등)
-- 목적: 여행 일정 플래너(/planner) + "여행 일정" 게시판(/itinerary)
-- 적용: Supabase MCP execute_sql 로 전체 실행(apply_migration 이 차단되면 execute_sql).
-- 배포 순서: 이 SQL 먼저 → 프런트/서버리스 push. (RPC 부재 시 프런트는 기능 플래그로 숨김)
-- 원칙(집안 규칙): 새 테이블은 RLS on + REVOKE ALL(anon 포함) 후 필요한 동사만 GRANT,
--   정책은 TO authenticated + 소유자 조건, 카운터·스냅샷·토큰은 SECURITY DEFINER RPC 전용,
--   가드 bypass 판정은 COALESCE 필수(2026-07-18 실사고), SET search_path = public, pg_temp.
-- 롤백: 파일 맨 아래 "ROLLBACK" 절.
--
-- ----------------------------------------------------------------------------
-- v1 대비 변경 요약 (교차검토 41건 판정 중 SQL 반영분 18건)
-- ----------------------------------------------------------------------------
-- [agy-6]+[codex-13] (통합) 외부 지오코더 전역 페이싱. 두 지적이 같은 문제라 하나로 합쳤다.
--        → 9-b 절: planner_provider_gate 테이블 + planner_geo_slot(text,int,int) 슬롯 예약 RPC
--          + planner_place_search_cache(24h 검색 캐시). 이름은 codex-13 안을 채택하고
--          파라미터 클램프(1000~10000ms)까지 받았다. agy-6 의 planner_pace_acquire /
--          planner_provider_pace / planner_geo_cache 는 중복이라 만들지 않는다.
-- [agy-4]  티켓 실파일 고아 방지 → 5-b 절: planner_orphan_objects 큐 + planner_tickets
--          AFTER DELETE 트리거. 탈퇴·여행삭제 CASCADE·개별삭제 세 경로가 한 번에 잡힌다.
-- [agy-5]+[codex-12] (통합) 카탈로그 제공자별 파편화. 별도 canonical 테이블은 반려하고
--          자기참조 병합 포인터(canonical_id)로 축소. 함수 이름은 codex-12 안 채택
--          (planner_catalog_root / planner_catalog_group / planner_reviews_of /
--           planner_merge_catalog), 체인 금지 트리거·not-self CHECK·lat/lng 인덱스는
--          agy-5 안을 채택. planner_merge_catalog 는 is_admin() 게이트 + authenticated
--          EXECUTE(관리자가 앱에서 쓰는 경로) — agy-5 의 "authenticated 전면 REVOKE"는 반려.
--          병합 시 자식 재지정을 먼저 하고 그다음 본인을 지정한다(체인 가드와 충돌 회피).
-- [codex-2] 카탈로그 무제한 열람 → anon 직접 SELECT 폐지, authenticated 는 "내 핀·내 후기에
--          연결된 행"만. 죽은 컬럼 rating / user_rating_count 제거. 권한·정책 블록은
--          planner_places·planner_place_reviews 생성 이후(6-b 절)로 이동.
-- [codex-8] planner_days.date 를 trips.start_date + day_index 파생값으로 가드에서 강제.
--          day_index 상한 60, planner_days 는 legs 만 클라이언트 UPDATE 허용,
--          planner_trips 는 컬럼 단위 UPDATE 허용, planner_places.sort_order >= 0.
-- [codex-10] legs 무효화 + 형상 강제 → planner_day_places_fp 지문, planner_places 변경 시
--          legs NULL 로 폐기하는 트리거, planner_days.legs CHECK, 스냅샷에서 지문
--          불일치 legs 는 빈 배열로 표시 + legs_computed_at 동봉.
-- [agy-12] planner_set_dates 를 4-arg(p_confirm_detach)로 교체. 보관함으로 밀려날 핀이
--          있으면 confirm_detach:N 으로 거절하고, 확인 후 재호출 시 이동 수를 반환.
--          3-arg 는 오버로드 모호성을 없애려고 DROP 먼저.
-- [agy-7]  구글/OSM 제공자 잠금 → planner_settings(단일행) + planner_google_enabled().
--          구글 비활성 시 ① 카탈로그 정책에서 google 행 차단 ② upsert 거절
--          ③ 스냅샷의 provider/provider_place_id 마스킹.
-- [codex-9] itinerary_posts 파생 컬럼 무결성 CHECK(기간·카운터) 추가.
-- [codex-5] 가드 bypass GUC 를 전역 app.allow_sensitive → 플래너 전용 app.planner_bypass
--          로 축소. toggle_post_like 의 set_config('app.allow_sensitive') 는 profiles_guard
--          가 읽는 이름이라 그대로 둔다(바꾸면 좋아요 포인트 적립이 깨진다).
-- [codex-7] 티켓 경로를 <user_id>/<trip_id>/<파일명> 3조각으로 CHECK 강제, storage INSERT
--          정책에 "내 소유 여행" EXISTS 추가, 고아 조회 뷰 planner_ticket_orphans.
--          SELECT/DELETE 정책은 uid-only 유지(강화하면 여행 삭제 후 본인도 못 지운다).
-- [codex-6] 공유 링크 만료(expires_at, 기본 180일) + 조회 스로틀(성공한 trip_id 기준).
--          planner_get_shared 의 STABLE 제거(비휘발성 함수에선 카운터 INSERT 불가).
--          planner_import·planner_unpublish 의 공유 조회에도 만료 반영.
--          planner_bump_post_view 도 같은 방식으로 스로틀.
-- [codex-4] planner_days.day_index 상한(codex-8 과 같은 제약으로 통합) + planner_import
--          날짜 루프에 61일 상한(v_dn). catalog 존재확인·기간검증·중복순서는 이미 구현됨(반려).
-- [codex-11] 스냅샷에 schema / generated_at / timezone 추가, planner_trips.timezone 컬럼.
--          v 는 1 유지 → planner_import 하위호환 그대로(신규 키는 읽지 않는다).
-- [codex-21] toggle_post_like 에 INSERT 전 대상 게시물 존재 확인(v_exists). 취소 경로는
--          그대로 둬서 삭제된 글의 좋아요 해제는 계속 가능.
-- [agy-13] 게시글 동기화 상태 → planner_board_sync_state(uuid) / planner_board_sync_list().
--          updated_at 비교가 아니라 스냅샷 md5 비교(핀 편집이 부모 updated_at 을 안 건드림).
--
-- 반려(반영하지 않음): agy-1(likes_count 컬럼 — 전제가 거짓), agy-3(카탈로그 오염 — 이미 방어),
--   agy-10(블라인드 컬럼 — 기존 게시판에도 없음), codex-1(교차 소유권 — 이미 트리거로 해결),
--   codex-3(게시물 CASCADE — 제안대로 하면 삭제가 예외로 실패), codex-24(트리거 대상 — 이미 명시),
--   agy-11(manualChunks 인과 오류 — 프런트 App.jsx lazy 가드만 별건 반영).
--
-- v2 자체 판단으로 추가한 정합성 수정 2건(판정에 없던 결함):
--   (a) planner_invalidate_legs 는 부모 여행이 이미 삭제된 CASCADE 경로에서 아무것도 하지
--       않는다. 안 그러면 planner_days UPDATE 가 소유자 가드의 'trip owner mismatch' 에
--       걸려 여행 삭제 트랜잭션 전체가 실패한다.
--   (b) planner_trips 컬럼 단위 UPDATE 허용 목록에 timezone 포함(codex-11 이 새로 넣은 컬럼).
--   (c) 카탈로그 대표 해석 헬퍼 3종(root/group/reviews_of)을 SECURITY DEFINER 로 만든다.
--       codex-2 가 카탈로그 직접 SELECT 를 "내 핀·내 후기" 로 좁혔기 때문에, invoker 권한이면
--       남의 장소 후기를 볼 때 대표 해석이 0행이 되어 목록이 통째로 비어 버린다.
--
-- ----------------------------------------------------------------------------
-- 후속 작업(이 SQL 밖 — 프런트/서버리스/운영. 여기서는 만들지 않는다)
-- ----------------------------------------------------------------------------
-- 1) api/planner/places.js  : ① 검색어 정규화 → sha256 → planner_place_search_cache 조회
--    (fetched_at > now()-24h 면 즉시 반환) ② 미스면 rpc('planner_geo_slot', {p_provider:'osm',
--    p_interval_ms:1100, p_max_wait_ms:3000}) ③ 반환값 null 또는 <0 이면 429 + "잠시 후 다시
--    검색해 주세요" ④ >0 이면 그만큼 대기 후 fetch, 헤더에
--    User-Agent: ConnectTrip-Planner/1.0 (200kgBrothers@gmail.com) ⑤ 응답을 캐시에 upsert.
--    링크로 담기(extract-links.js)도 후보 1건마다 같은 슬롯을 통과시키고 요청당 지오코딩 8건 상한.
-- 2) api/planner/routes.js  : legs 저장 시 {mode, computed_at, fp, items} 형태로 쓴다.
--    fp 는 클라이언트가 보낸 값이 아니라 서버가 planner_day_places_fp 로 다시 읽은 값.
-- 3) 프런트 티켓 삭제 순서 : 티켓 1건 = DB DELETE → 성공 시 storage.remove([path]).
--    여행 삭제 = storage_path 목록 확보 → 여행 DELETE → storage.remove(paths).
--    탈퇴(MyPage.jsx handleDeleteAccount) = request_account_deletion 호출 직전에
--    본인 planner_tickets 경로를 100개씩 remove(세션이 살아 있는 마지막 시점).
-- 4) 운영 스위퍼(하루 1회, GitHub Actions cron 또는 EC2 헬스체크에 등록) :
--    planner_orphan_objects 의 purged_at IS NULL 행 100개씩 → storage remove → purged_at 갱신
--    (실패 시 attempts+1, last_error). 백스톱으로 planner_ticket_orphans 뷰에서 24시간 이상
--    지난 고아만 삭제. 개인정보처리방침 6조에 이 주기를 명시.
-- 5) 프런트 기간 변경 핸들러 : planner_set_dates 가 confirm_detach:N 예외를 던지면
--    window.confirm 후 p_confirm_detach:true 로 재호출, 반환값 N 을 토스트로 안내.
-- 6) 프런트 후기 : planner_place_reviews 직접 SELECT 금지, rpc('planner_reviews_of') 사용.
-- 7) 프런트 일정판/목록 : planner_board_sync_state / planner_board_sync_list 로 "반영 안 됨"
--    배지 표시, 버튼 라벨은 게시 여부에 따라 "게시판에 올리기"/"게시글 갱신".
-- 8) 프런트 공유 보기 : 폐기·만료를 구분하지 않는 단일 문구(서버 응답 균질화와 맞춘다).
-- 9) 프런트 ics 내보내기 : startOutputType:'local'(floating). snapshot.timezone 있으면 TZID.
-- 10) design_v1.md 갱신 : 검증 기준의 "anon catalog SELECT 가능" → 42501, 가드 GUC 이름,
--    set_dates 시그니처, 스냅샷 예시(schema/generated_at/timezone/unassigned/legs_*),
--    지오코더 페이싱 문구, canonical_id·신규 RPC 목록.
-- 11) 구글 키 도착 시(P2) : planner_settings.google_maps_enabled = true (service_role) 후
--    좌표 30m + 이름 정규화 유사도 후보를 사람이 확인해 planner_merge_catalog 로 건별 병합.
--    자동 병합은 금지(같은 건물 다른 매장 오병합). catalog fetched_at 30일 만료·재조회도 별건.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 0. 공통 트리거 함수
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.planner_touch_updated_at()
RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.planner_touch_updated_at() FROM PUBLIC, anon, authenticated;

-- 소유자 가드: INSERT 시 user_id 를 호출자로 강제, UPDATE 시 소유자·부모 변경 금지,
-- 자식 행이 같은 여행에 속하는지(day_id·place_id) 검증, 티켓 저장 경로 접두 검증,
-- planner_days.date 는 여행 시작일 + day_index 파생값으로 강제.
-- [codex-5] bypass 표식은 전역 app.allow_sensitive 가 아니라 플래너 전용 app.planner_bypass 만 신뢰한다.
-- ⚠ COALESCE 필수: 미설정 세션에서 NULL 이면 가드 전체가 무력화된다(2026-07-18 실사고).
CREATE OR REPLACE FUNCTION public.planner_owner_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_bypass boolean := (auth.uid() IS NULL)
    OR (COALESCE(current_setting('app.planner_bypass', true), 'off') = 'on')
    OR COALESCE(public.is_admin(), FALSE);
  v_trip_owner uuid;
  v_trip_start date;
  v_has_trip boolean;
BEGIN
  -- ⚠ PL/pgSQL 은 `A AND B` 에서 단축 평가를 보장하지 않는다. 표현식 하나에
  --    TG_TABLE_NAME 검사와 NEW.<그 테이블에만 있는 컬럼> 을 함께 쓰면, 컬럼이 없는
  --    다른 테이블의 트리거에서 42703 (record "new" has no field ...) 이 난다.
  --    실측 2026-09-04: planner_trips INSERT 가 'planner_places' 분기의 NEW.day_id 때문에 실패.
  --    따라서 테이블 판정과 컬럼 접근은 반드시 중첩 IF 로 분리한다.
  v_has_trip := TG_TABLE_NAME IN ('planner_days','planner_places','planner_tickets','planner_shares','itinerary_posts');

  IF TG_OP = 'INSERT' THEN
    IF NOT v_bypass THEN NEW.user_id := auth.uid(); END IF;
    IF NEW.user_id IS NULL THEN RAISE EXCEPTION 'owner required'; END IF;
  ELSIF TG_OP = 'UPDATE' THEN
    IF NEW.user_id IS DISTINCT FROM OLD.user_id THEN RAISE EXCEPTION 'owner cannot change'; END IF;
    IF v_has_trip THEN
      IF NEW.trip_id IS DISTINCT FROM OLD.trip_id THEN RAISE EXCEPTION 'trip cannot change'; END IF;
    END IF;
    IF TG_TABLE_NAME = 'planner_place_reviews' THEN
      IF NEW.catalog_id IS DISTINCT FROM OLD.catalog_id THEN RAISE EXCEPTION 'catalog cannot change'; END IF;
    END IF;
  END IF;

  -- 자식 테이블: 부모 여행의 소유자와 일치해야 한다(가드는 정책과 별개로 한 번 더 막는다)
  IF v_has_trip THEN
    SELECT user_id, start_date INTO v_trip_owner, v_trip_start
      FROM public.planner_trips WHERE id = NEW.trip_id;
    -- ⚠ 부모 여행이 이미 사라진 UPDATE 는 FK 의 ON DELETE SET NULL 이 만든 것이다.
    --    (여행 삭제 → planner_days CASCADE → planner_places.day_id SET NULL → 이 가드,
    --     planner_places CASCADE → planner_tickets.place_id SET NULL → 이 가드)
    --    여기서 예외를 던지면 삭제 트랜잭션 전체가 실패해 여행 삭제·회원 탈퇴가 막힌다.
    --    이 행들은 같은 트랜잭션에서 함께 사라지므로 검증할 대상이 없다.
    IF v_trip_owner IS NULL THEN
      IF TG_OP = 'UPDATE' THEN RETURN NEW; END IF;
      RAISE EXCEPTION 'trip owner mismatch';
    END IF;
    IF v_trip_owner <> NEW.user_id THEN RAISE EXCEPTION 'trip owner mismatch'; END IF;
  END IF;

  -- [codex-8] 클라이언트·RPC 가 무엇을 넣든 date 는 파생값으로 덮어쓴다.
  IF TG_TABLE_NAME = 'planner_days' THEN
    NEW.date := v_trip_start + NEW.day_index;
  END IF;

  IF TG_TABLE_NAME = 'planner_places' THEN
    IF NEW.day_id IS NOT NULL THEN
      IF NOT EXISTS (SELECT 1 FROM public.planner_days d WHERE d.id = NEW.day_id AND d.trip_id = NEW.trip_id) THEN
        RAISE EXCEPTION 'day not in trip';
      END IF;
    END IF;
  END IF;

  IF TG_TABLE_NAME = 'planner_tickets' THEN
    IF position((NEW.user_id::text || '/') IN NEW.storage_path) <> 1 THEN RAISE EXCEPTION 'bad storage path'; END IF;
    IF NEW.place_id IS NOT NULL THEN
      IF NOT EXISTS (SELECT 1 FROM public.planner_places p WHERE p.id = NEW.place_id AND p.trip_id = NEW.trip_id) THEN
        RAISE EXCEPTION 'place not in trip';
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.planner_owner_guard() FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 1. 여행
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.planner_trips (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  title text NOT NULL CHECK (length(btrim(title)) BETWEEN 1 AND 80),
  start_date date NOT NULL,
  end_date date NOT NULL,
  currency text NOT NULL DEFAULT 'KRW' CHECK (currency ~ '^[A-Z]{3}$'),
  budget_total integer CHECK (budget_total IS NULL OR budget_total >= 0),
  country text CHECK (country IS NULL OR length(country) <= 60),
  timezone text,
  cover_place_id uuid,
  visibility text NOT NULL DEFAULT 'private' CHECK (visibility IN ('private','link','board')),
  origin_post_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT planner_trips_dates_check CHECK (end_date >= start_date AND (end_date - start_date) <= 60)
);
-- [codex-11] 이미 v1 이 적용된 DB 를 위한 멱등 보정
ALTER TABLE public.planner_trips ADD COLUMN IF NOT EXISTS timezone text;
ALTER TABLE public.planner_trips DROP CONSTRAINT IF EXISTS planner_trips_timezone_check;
ALTER TABLE public.planner_trips ADD CONSTRAINT planner_trips_timezone_check
  CHECK (timezone IS NULL OR (length(timezone) <= 64 AND timezone ~ '^[A-Za-z][A-Za-z0-9_+-]*(/[A-Za-z0-9_+-]+){1,2}$'));

CREATE INDEX IF NOT EXISTS idx_planner_trips_user_updated ON public.planner_trips (user_id, updated_at DESC);
ALTER TABLE public.planner_trips ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.planner_trips FROM PUBLIC, anon, authenticated;
-- [codex-8] 기간(start_date·end_date)은 planner_set_dates 로만, visibility 는 공유·게시 RPC 로만.
GRANT SELECT, INSERT, DELETE ON public.planner_trips TO authenticated;
GRANT UPDATE (title, currency, budget_total, country, timezone, cover_place_id, updated_at)
  ON public.planner_trips TO authenticated;
DROP POLICY IF EXISTS "planner trips select own" ON public.planner_trips;
CREATE POLICY "planner trips select own" ON public.planner_trips FOR SELECT TO authenticated USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "planner trips insert own" ON public.planner_trips;
CREATE POLICY "planner trips insert own" ON public.planner_trips FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "planner trips update own" ON public.planner_trips;
CREATE POLICY "planner trips update own" ON public.planner_trips FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "planner trips delete own" ON public.planner_trips;
CREATE POLICY "planner trips delete own" ON public.planner_trips FOR DELETE TO authenticated USING (auth.uid() = user_id);
DROP TRIGGER IF EXISTS trg_planner_trips_guard ON public.planner_trips;
CREATE TRIGGER trg_planner_trips_guard BEFORE INSERT OR UPDATE ON public.planner_trips FOR EACH ROW EXECUTE FUNCTION public.planner_owner_guard();
DROP TRIGGER IF EXISTS trg_planner_trips_touch ON public.planner_trips;
CREATE TRIGGER trg_planner_trips_touch BEFORE UPDATE ON public.planner_trips FOR EACH ROW EXECUTE FUNCTION public.planner_touch_updated_at();

-- ---------------------------------------------------------------------------
-- 2. 날짜
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.planner_days (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id uuid NOT NULL REFERENCES public.planner_trips(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  day_index integer NOT NULL CHECK (day_index >= 0),
  date date NOT NULL,
  legs jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (trip_id, day_index)
);
-- [codex-8]+[codex-4] day_index 상한 = planner_trips 60일 제한과 동일(days_count 최대 61).
--   두 지적이 같은 제약이라 이름 하나로 통합하고, 다른 이름으로 먼저 적용됐을 수 있는 흔적도 지운다.
ALTER TABLE public.planner_days DROP CONSTRAINT IF EXISTS planner_days_index_max_check;
ALTER TABLE public.planner_days DROP CONSTRAINT IF EXISTS planner_days_day_index_range;
ALTER TABLE public.planner_days ADD CONSTRAINT planner_days_day_index_range CHECK (day_index BETWEEN 0 AND 60);

-- [codex-10] legs 형상 강제: mode·computed_at·fp·items 필수(NULL 은 허용 = 미계산).
ALTER TABLE public.planner_days DROP CONSTRAINT IF EXISTS planner_days_legs_shape;
-- ⚠ CHECK 는 NULL 을 만족으로 취급한다. legs->'items' 가 없으면 jsonb_typeof 가 SQL NULL 을
--    돌려주고 AND 체인 전체가 NULL 이 되어 제약이 통째로 무력화된다(예: legs = '{"a":1}' 통과).
--    바깥을 COALESCE(..., false) 로 감싸고, 배열 길이는 배열일 때만 계산한다
--    (스칼라에 jsonb_array_length 를 부르면 22023 으로 엉뚱한 에러가 난다).
ALTER TABLE public.planner_days ADD CONSTRAINT planner_days_legs_shape CHECK (
  legs IS NULL OR COALESCE(
        jsonb_typeof(legs) = 'object'
    AND COALESCE(CASE WHEN jsonb_typeof(legs->'items') = 'array'
                      THEN jsonb_array_length(legs->'items') END, -1) BETWEEN 0 AND 200
    AND COALESCE(legs->>'mode', '') IN ('WALK','DRIVE','TRANSIT')
    AND (legs->>'computed_at') IS NOT NULL
    AND COALESCE(legs->>'fp', '') ~ '^[0-9a-f]{32}$'
  , false)
);

CREATE INDEX IF NOT EXISTS idx_planner_days_trip ON public.planner_days (trip_id, day_index);
ALTER TABLE public.planner_days ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.planner_days FROM PUBLIC, anon, authenticated;
-- [codex-8] 날짜 행 생성·삭제·날짜 변경은 RPC 전용(planner_create_trip / planner_set_dates / planner_import).
--   SECURITY DEFINER 함수는 소유자 권한으로 돌므로 이 제한의 영향을 받지 않는다. 클라이언트는 legs 만 쓴다.
GRANT SELECT ON public.planner_days TO authenticated;
GRANT UPDATE (legs, updated_at) ON public.planner_days TO authenticated;
-- 정책은 심층 방어로 남긴다(실제 차단은 위 컬럼 단위 권한이 한다).
DROP POLICY IF EXISTS "planner days select own" ON public.planner_days;
CREATE POLICY "planner days select own" ON public.planner_days FOR SELECT TO authenticated USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "planner days insert own" ON public.planner_days;
CREATE POLICY "planner days insert own" ON public.planner_days FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id AND EXISTS (SELECT 1 FROM public.planner_trips t WHERE t.id = trip_id AND t.user_id = auth.uid()));
DROP POLICY IF EXISTS "planner days update own" ON public.planner_days;
CREATE POLICY "planner days update own" ON public.planner_days FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "planner days delete own" ON public.planner_days;
CREATE POLICY "planner days delete own" ON public.planner_days FOR DELETE TO authenticated USING (auth.uid() = user_id);
DROP TRIGGER IF EXISTS trg_planner_days_guard ON public.planner_days;
CREATE TRIGGER trg_planner_days_guard BEFORE INSERT OR UPDATE ON public.planner_days FOR EACH ROW EXECUTE FUNCTION public.planner_owner_guard();
DROP TRIGGER IF EXISTS trg_planner_days_touch ON public.planner_days;
CREATE TRIGGER trg_planner_days_touch BEFORE UPDATE ON public.planner_days FOR EACH ROW EXECUTE FUNCTION public.planner_touch_updated_at();

-- ---------------------------------------------------------------------------
-- 3. 장소 카탈로그(제공자별 1행). 쓰기는 RPC/서버(service_role)만.
--    [codex-2] 권한·정책은 planner_places / planner_place_reviews 생성 이후여야 하므로 6-b 절로 옮겼다.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.planner_catalog (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL CHECK (provider IN ('google','osm')),
  provider_place_id text NOT NULL CHECK (length(provider_place_id) BETWEEN 1 AND 300),
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 200),
  address text CHECK (address IS NULL OR length(address) <= 300),
  lat double precision NOT NULL CHECK (lat BETWEEN -90 AND 90),
  lng double precision NOT NULL CHECK (lng BETWEEN -180 AND 180),
  opening_hours jsonb,
  website text CHECK (website IS NULL OR length(website) <= 500),
  phone text CHECK (phone IS NULL OR length(phone) <= 40),
  canonical_id uuid REFERENCES public.planner_catalog(id) ON DELETE SET NULL,
  fetched_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, provider_place_id)
);
ALTER TABLE public.planner_catalog ENABLE ROW LEVEL SECURITY;

-- [codex-2] 아무도 쓰지 않는 죽은 컬럼 제거(v1 이 이미 적용된 DB 대비, 멱등).
ALTER TABLE public.planner_catalog DROP COLUMN IF EXISTS rating;
ALTER TABLE public.planner_catalog DROP COLUMN IF EXISTS user_rating_count;

-- [agy-5]+[codex-12] 병합 포인터: NULL = 이 행이 대표. 값이 있으면 그 행이 대표.
ALTER TABLE public.planner_catalog
  ADD COLUMN IF NOT EXISTS canonical_id uuid REFERENCES public.planner_catalog(id) ON DELETE SET NULL;
ALTER TABLE public.planner_catalog DROP CONSTRAINT IF EXISTS planner_catalog_canonical_not_self;
ALTER TABLE public.planner_catalog
  ADD CONSTRAINT planner_catalog_canonical_not_self CHECK (canonical_id IS NULL OR canonical_id <> id);
CREATE INDEX IF NOT EXISTS idx_planner_catalog_canonical
  ON public.planner_catalog (canonical_id) WHERE canonical_id IS NOT NULL;
-- 나중에 좌표 근접 후보를 찾을 때 쓴다(지금은 인덱스만 미리 둔다).
CREATE INDEX IF NOT EXISTS idx_planner_catalog_latlng ON public.planner_catalog (lat, lng);

-- 체인(A→B→C) 금지: 항상 1단계만 허용해서 대표 해석을 COALESCE 한 번으로 끝낸다.
CREATE OR REPLACE FUNCTION public.planner_catalog_canonical_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NEW.canonical_id IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM public.planner_catalog c
                WHERE c.id = NEW.canonical_id AND c.canonical_id IS NOT NULL) THEN
      RAISE EXCEPTION 'canonical target must be a root row';
    END IF;
    IF EXISTS (SELECT 1 FROM public.planner_catalog c WHERE c.canonical_id = NEW.id) THEN
      RAISE EXCEPTION 'row is already a canonical target';
    END IF;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.planner_catalog_canonical_guard() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_planner_catalog_canonical ON public.planner_catalog;
CREATE TRIGGER trg_planner_catalog_canonical BEFORE INSERT OR UPDATE ON public.planner_catalog
  FOR EACH ROW EXECUTE FUNCTION public.planner_catalog_canonical_guard();

-- ---------------------------------------------------------------------------
-- 3-a. [agy-7] 활성 지도 제공자 잠금(SSOT). 프런트 providers/index.js 는 env 가 아니라
--      이 RPC 를 읽어 지도를 고른다 → 지도와 장소 데이터 제공자가 갈라질 수 없다.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.planner_settings (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  google_maps_enabled boolean NOT NULL DEFAULT false,   -- 구글 결제 계정 승인 후에만 true
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO public.planner_settings (id) VALUES (true) ON CONFLICT (id) DO NOTHING;
ALTER TABLE public.planner_settings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.planner_settings FROM PUBLIC, anon, authenticated;  -- 읽기도 RPC 경유, 수정은 service_role

CREATE OR REPLACE FUNCTION public.planner_google_enabled()
RETURNS boolean LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public, pg_temp AS $$
  SELECT COALESCE((SELECT s.google_maps_enabled FROM public.planner_settings s WHERE s.id), false);
$$;
REVOKE ALL ON FUNCTION public.planner_google_enabled() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.planner_google_enabled() TO anon, authenticated;
-- 주의(SQL 로는 못 막는 부분): planner_places.name/address 는 핀 생성 시점의 표시용 사본이라
--   구글에서 온 문자열이 남는다. 따라서 google_maps_enabled 는 한 번 true 가 되면 구글 장소 행이
--   남아 있는 동안 false 로 되돌리지 않는다. 키가 만료되면 지도를 OSM 으로 강등하지 말고
--   "지도를 불러올 수 없습니다" 목록 모드로 떨어뜨린다.

-- ---------------------------------------------------------------------------
-- 4. 핀
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.planner_places (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id uuid NOT NULL REFERENCES public.planner_trips(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  day_id uuid REFERENCES public.planner_days(id) ON DELETE SET NULL,
  catalog_id uuid REFERENCES public.planner_catalog(id) ON DELETE SET NULL,
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 200),
  address text CHECK (address IS NULL OR length(address) <= 300),
  lat double precision NOT NULL CHECK (lat BETWEEN -90 AND 90),
  lng double precision NOT NULL CHECK (lng BETWEEN -180 AND 180),
  sort_order integer NOT NULL DEFAULT 0,
  planned_time time,
  stay_min integer CHECK (stay_min IS NULL OR stay_min BETWEEN 0 AND 1440),
  cost integer CHECK (cost IS NULL OR cost >= 0),
  note text CHECK (note IS NULL OR length(note) <= 2000),
  note_public boolean NOT NULL DEFAULT false,
  visited_at timestamptz,
  source text NOT NULL DEFAULT 'search' CHECK (source IN ('search','longpress','link','import')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
-- [codex-8] sort_order 는 음수만 금지. 유일 제약은 걸지 않는다
--   (DEFAULT 0 다중 INSERT + planner_reorder_places 의 행 단위 재번호와 충돌한다).
ALTER TABLE public.planner_places DROP CONSTRAINT IF EXISTS planner_places_sort_order_nonneg;
ALTER TABLE public.planner_places ADD CONSTRAINT planner_places_sort_order_nonneg CHECK (sort_order >= 0);

CREATE INDEX IF NOT EXISTS idx_planner_places_trip_day ON public.planner_places (trip_id, day_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_planner_places_catalog ON public.planner_places (catalog_id);
-- [codex-2] 6-b 절 카탈로그 정책의 EXISTS (user_id, catalog_id) 조회용.
CREATE INDEX IF NOT EXISTS idx_planner_places_user_catalog
  ON public.planner_places (user_id, catalog_id) WHERE catalog_id IS NOT NULL;
ALTER TABLE public.planner_places ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.planner_places FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.planner_places TO authenticated;
DROP POLICY IF EXISTS "planner places select own" ON public.planner_places;
CREATE POLICY "planner places select own" ON public.planner_places FOR SELECT TO authenticated USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "planner places insert own" ON public.planner_places;
CREATE POLICY "planner places insert own" ON public.planner_places FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id AND EXISTS (SELECT 1 FROM public.planner_trips t WHERE t.id = trip_id AND t.user_id = auth.uid()));
DROP POLICY IF EXISTS "planner places update own" ON public.planner_places;
CREATE POLICY "planner places update own" ON public.planner_places FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "planner places delete own" ON public.planner_places;
CREATE POLICY "planner places delete own" ON public.planner_places FOR DELETE TO authenticated USING (auth.uid() = user_id);
DROP TRIGGER IF EXISTS trg_planner_places_guard ON public.planner_places;
CREATE TRIGGER trg_planner_places_guard BEFORE INSERT OR UPDATE ON public.planner_places FOR EACH ROW EXECUTE FUNCTION public.planner_owner_guard();
DROP TRIGGER IF EXISTS trg_planner_places_touch ON public.planner_places;
CREATE TRIGGER trg_planner_places_touch BEFORE UPDATE ON public.planner_places FOR EACH ROW EXECUTE FUNCTION public.planner_touch_updated_at();

-- ---------------------------------------------------------------------------
-- 4-b. [codex-10] legs 정합성 — 핀 구성 지문 + 변경 시 즉시 폐기
-- ---------------------------------------------------------------------------
-- 날짜별 핀 구성 지문: legs 가 "어느 핀 구성"으로 계산됐는지 식별하는 안정 키.
-- place uuid 를 스냅샷에 노출하지 않으면서 정합성만 검증한다.
CREATE OR REPLACE FUNCTION public.planner_day_places_fp(p_day_id uuid)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT COALESCE(md5(string_agg(
           p.id::text || ':' || round(p.lat::numeric, 6) || ':' || round(p.lng::numeric, 6),
           ',' ORDER BY p.sort_order, p.created_at, p.id)), '')
  FROM public.planner_places p WHERE p.day_id = p_day_id;
$$;
REVOKE ALL ON FUNCTION public.planner_day_places_fp(uuid) FROM PUBLIC, anon, authenticated;

-- 핀이 바뀌면 그 날짜의 legs 를 즉시 폐기(정렬·이동·삭제·좌표수정 전부).
-- ⚠ v2 추가 가드: 부모 여행이 이미 삭제된 CASCADE 경로에서는 아무 일도 하지 않는다.
--    안 그러면 planner_days UPDATE 가 소유자 가드의 'trip owner mismatch' 에 걸려
--    여행 삭제(또는 탈퇴) 트랜잭션 전체가 실패한다.
CREATE OR REPLACE FUNCTION public.planner_invalidate_legs()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF NOT EXISTS (SELECT 1 FROM public.planner_trips t WHERE t.id = OLD.trip_id) THEN RETURN NULL; END IF;
  END IF;
  IF TG_OP IN ('UPDATE','DELETE') AND OLD.day_id IS NOT NULL THEN
    UPDATE public.planner_days SET legs = NULL WHERE id = OLD.day_id AND legs IS NOT NULL;
  END IF;
  IF TG_OP IN ('INSERT','UPDATE') AND NEW.day_id IS NOT NULL THEN
    UPDATE public.planner_days SET legs = NULL WHERE id = NEW.day_id AND legs IS NOT NULL;
  END IF;
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION public.planner_invalidate_legs() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_planner_places_invalidate_legs ON public.planner_places;
CREATE TRIGGER trg_planner_places_invalidate_legs
  AFTER INSERT OR DELETE OR UPDATE OF day_id, sort_order, lat, lng ON public.planner_places
  FOR EACH ROW EXECUTE FUNCTION public.planner_invalidate_legs();

-- ---------------------------------------------------------------------------
-- 5. 티켓 메타 + 비공개 버킷
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.planner_tickets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id uuid NOT NULL REFERENCES public.planner_trips(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  place_id uuid REFERENCES public.planner_places(id) ON DELETE SET NULL,
  storage_path text NOT NULL UNIQUE CHECK (length(storage_path) BETWEEN 40 AND 300),
  mime text NOT NULL CHECK (mime IN ('image/jpeg','image/png','image/webp','application/pdf')),
  size_bytes integer NOT NULL CHECK (size_bytes BETWEEN 1 AND 15728640),
  title text CHECK (title IS NULL OR length(title) <= 120),
  kind text CHECK (kind IS NULL OR kind IN ('flight','train','bus','ticket','hotel','other')),
  event_date date,
  event_time time,
  barcode_text text CHECK (barcode_text IS NULL OR length(barcode_text) <= 2000),
  barcode_format text CHECK (barcode_format IS NULL OR length(barcode_format) <= 30),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
-- [codex-7] 경로를 <user_id>/<trip_id>/<파일명> 3조각으로 강제.
--   CHECK 는 admin·bypass 경로에도 항상 적용되어 가드보다 강하다(가드의 접두 검사는 중복이지만 무해).
ALTER TABLE public.planner_tickets DROP CONSTRAINT IF EXISTS planner_tickets_path_shape;
ALTER TABLE public.planner_tickets ADD CONSTRAINT planner_tickets_path_shape CHECK (
  array_length(string_to_array(storage_path, '/'), 1) = 3
  AND split_part(storage_path, '/', 1) = user_id::text
  AND split_part(storage_path, '/', 2) = trip_id::text
  AND length(split_part(storage_path, '/', 3)) BETWEEN 5 AND 200
);

CREATE INDEX IF NOT EXISTS idx_planner_tickets_trip_date ON public.planner_tickets (trip_id, event_date);
ALTER TABLE public.planner_tickets ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.planner_tickets FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.planner_tickets TO authenticated;
DROP POLICY IF EXISTS "planner tickets select own" ON public.planner_tickets;
CREATE POLICY "planner tickets select own" ON public.planner_tickets FOR SELECT TO authenticated USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "planner tickets insert own" ON public.planner_tickets;
CREATE POLICY "planner tickets insert own" ON public.planner_tickets FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id AND EXISTS (SELECT 1 FROM public.planner_trips t WHERE t.id = trip_id AND t.user_id = auth.uid()));
DROP POLICY IF EXISTS "planner tickets update own" ON public.planner_tickets;
CREATE POLICY "planner tickets update own" ON public.planner_tickets FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "planner tickets delete own" ON public.planner_tickets;
CREATE POLICY "planner tickets delete own" ON public.planner_tickets FOR DELETE TO authenticated USING (auth.uid() = user_id);
DROP TRIGGER IF EXISTS trg_planner_tickets_guard ON public.planner_tickets;
CREATE TRIGGER trg_planner_tickets_guard BEFORE INSERT OR UPDATE ON public.planner_tickets FOR EACH ROW EXECUTE FUNCTION public.planner_owner_guard();
DROP TRIGGER IF EXISTS trg_planner_tickets_touch ON public.planner_tickets;
CREATE TRIGGER trg_planner_tickets_touch BEFORE UPDATE ON public.planner_tickets FOR EACH ROW EXECUTE FUNCTION public.planner_touch_updated_at();

-- 비공개 버킷(존재하면 설정만 맞춤). 파일 경로 규칙: <auth.uid()>/<trip_id>/<uuid>.<ext>
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('planner-tickets', 'planner-tickets', false, 15728640, ARRAY['image/jpeg','image/png','image/webp','application/pdf'])
ON CONFLICT (id) DO UPDATE SET public = false, file_size_limit = EXCLUDED.file_size_limit, allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS "planner tickets storage select own" ON storage.objects;
CREATE POLICY "planner tickets storage select own" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'planner-tickets' AND (storage.foldername(name))[1] = auth.uid()::text);
-- [codex-7] 업로드만 두 번째 조각이 "내가 소유한 여행"인지 확인한다.
--   uuid 캐스팅 예외를 피하려고 t.id::text 로 비교한다.
DROP POLICY IF EXISTS "planner tickets storage insert own" ON storage.objects;
CREATE POLICY "planner tickets storage insert own" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'planner-tickets'
    AND array_length(storage.foldername(name), 1) = 2
    AND (storage.foldername(name))[1] = auth.uid()::text
    AND EXISTS (
      SELECT 1 FROM public.planner_trips t
      WHERE t.id::text = (storage.foldername(name))[2] AND t.user_id = auth.uid()
    )
  );
-- SELECT/DELETE 정책은 uid-only 그대로 둔다. 여기에 같은 EXISTS 를 걸면
-- 여행이 CASCADE 삭제된 뒤 남은 파일을 본인도 지울 수 없게 되어 고아가 영구 고착된다.
DROP POLICY IF EXISTS "planner tickets storage delete own" ON storage.objects;
CREATE POLICY "planner tickets storage delete own" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'planner-tickets' AND (storage.foldername(name))[1] = auth.uid()::text);

-- ---------------------------------------------------------------------------
-- 5-b. [agy-4] 티켓 파일 삭제 대기 큐 (탈퇴/여행삭제 CASCADE 시 Storage 실파일 정리용)
--   CASCADE 삭제도 자식 테이블의 행 트리거를 발화시키므로 탈퇴·여행 삭제·개별 삭제
--   세 경로가 한 번에 잡히고, identity_20260902.sql 의 탈퇴 RPC 를 건드릴 필요가 없다.
--   ⚠ storage.objects 행을 지운다고 실제 파일이 지워지지 않는다. 반드시 Storage API 로 지운다.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.planner_orphan_objects (
  id bigserial PRIMARY KEY,
  bucket_id text NOT NULL DEFAULT 'planner-tickets',
  storage_path text NOT NULL,
  owner_id uuid,                                  -- FK 없음: 탈퇴 후에도 남아야 한다
  queued_at timestamptz NOT NULL DEFAULT now(),
  purged_at timestamptz,
  attempts smallint NOT NULL DEFAULT 0,
  last_error text
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_planner_orphan_path
  ON public.planner_orphan_objects (bucket_id, storage_path);
CREATE INDEX IF NOT EXISTS idx_planner_orphan_pending
  ON public.planner_orphan_objects (queued_at) WHERE purged_at IS NULL;
ALTER TABLE public.planner_orphan_objects ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.planner_orphan_objects FROM PUBLIC, anon, authenticated;
REVOKE ALL ON SEQUENCE public.planner_orphan_objects_id_seq FROM PUBLIC, anon, authenticated;
-- 정책 없음 → service_role 전용 (9절 캐시 테이블과 동일 관례)

CREATE OR REPLACE FUNCTION public.planner_queue_ticket_object()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  INSERT INTO public.planner_orphan_objects (bucket_id, storage_path, owner_id)
  VALUES ('planner-tickets', OLD.storage_path, OLD.user_id)
  ON CONFLICT (bucket_id, storage_path) DO UPDATE
    SET queued_at = now(), purged_at = NULL, attempts = 0, last_error = NULL;
  RETURN OLD;
END $$;
REVOKE ALL ON FUNCTION public.planner_queue_ticket_object() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_planner_tickets_queue_object ON public.planner_tickets;
CREATE TRIGGER trg_planner_tickets_queue_object
  AFTER DELETE ON public.planner_tickets
  FOR EACH ROW EXECUTE FUNCTION public.planner_queue_ticket_object();

-- [codex-7] 백스톱: 업로드는 됐는데 행이 안 생긴 파일(큐가 못 잡는 경우)을 찾는 뷰.
--   스윕 스크립트는 24시간 이상 지난 항목만 지운다(업로드 직후 INSERT 전 파일 보호).
CREATE OR REPLACE VIEW public.planner_ticket_orphans AS
SELECT o.name AS storage_path, o.created_at
FROM storage.objects o
WHERE o.bucket_id = 'planner-tickets'
  AND NOT EXISTS (SELECT 1 FROM public.planner_tickets t WHERE t.storage_path = o.name);
REVOKE ALL ON public.planner_ticket_orphans FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.planner_ticket_orphans TO service_role;

-- ---------------------------------------------------------------------------
-- 6. 후기(다녀온 사람만). INSERT 는 RPC 전용, 열람은 공개
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.planner_place_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  catalog_id uuid NOT NULL REFERENCES public.planner_catalog(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  rating smallint NOT NULL CHECK (rating BETWEEN 1 AND 5),
  body text CHECK (body IS NULL OR length(body) <= 1000),
  recommended_menu text CHECK (recommended_menu IS NULL OR length(recommended_menu) <= 200),
  visited_on date NOT NULL,
  author_name text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (catalog_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_planner_place_reviews_catalog ON public.planner_place_reviews (catalog_id, created_at DESC);
ALTER TABLE public.planner_place_reviews ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.planner_place_reviews FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.planner_place_reviews TO anon, authenticated;
GRANT UPDATE (rating, body, recommended_menu, updated_at), DELETE ON public.planner_place_reviews TO authenticated;
DROP POLICY IF EXISTS "planner reviews read" ON public.planner_place_reviews;
CREATE POLICY "planner reviews read" ON public.planner_place_reviews FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "planner reviews update own" ON public.planner_place_reviews;
CREATE POLICY "planner reviews update own" ON public.planner_place_reviews FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "planner reviews delete own or admin" ON public.planner_place_reviews;
CREATE POLICY "planner reviews delete own or admin" ON public.planner_place_reviews FOR DELETE TO authenticated
  USING (auth.uid() = user_id OR COALESCE(public.is_admin(), FALSE));
DROP TRIGGER IF EXISTS trg_planner_place_reviews_guard ON public.planner_place_reviews;
CREATE TRIGGER trg_planner_place_reviews_guard BEFORE INSERT OR UPDATE ON public.planner_place_reviews FOR EACH ROW EXECUTE FUNCTION public.planner_owner_guard();
DROP TRIGGER IF EXISTS trg_planner_place_reviews_touch ON public.planner_place_reviews;
CREATE TRIGGER trg_planner_place_reviews_touch BEFORE UPDATE ON public.planner_place_reviews FOR EACH ROW EXECUTE FUNCTION public.planner_touch_updated_at();

-- ---------------------------------------------------------------------------
-- 6-b. 카탈로그 권한·정책 + 병합 헬퍼
--   (planner_places / planner_place_reviews 가 만들어진 뒤여야 한다 — 정책이 두 테이블을 참조)
--   [codex-2] anon 직접 SELECT 폐지: 비로그인 경로는 planner_get_shared(SECURITY DEFINER)와
--     itinerary_posts 정책뿐이라 테이블 권한이 필요 없다.
--     authenticated 는 "본인이 실제로 참조하는 행"만 — 전체 카탈로그 대량 수집 차단.
--     (동선 검사가 opening_hours 를 요구하므로 직접 SELECT 자체는 유지한다)
--   [agy-7] 여기에 제공자 잠금을 AND 로 겹친다: 구글 지도가 꺼져 있으면 구글 장소 행은 안 나간다.
-- ---------------------------------------------------------------------------
REVOKE ALL ON public.planner_catalog FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.planner_catalog TO authenticated;

DROP POLICY IF EXISTS "planner catalog read" ON public.planner_catalog;
DROP POLICY IF EXISTS "planner catalog read linked" ON public.planner_catalog;
CREATE POLICY "planner catalog read linked" ON public.planner_catalog FOR SELECT TO authenticated
USING (
  (planner_catalog.provider = 'osm' OR (SELECT public.planner_google_enabled()))
  AND (
    EXISTS (
      SELECT 1 FROM public.planner_places p
       WHERE p.catalog_id = planner_catalog.id AND p.user_id = auth.uid()
    )
    OR EXISTS (
      SELECT 1 FROM public.planner_place_reviews r
       WHERE r.catalog_id = planner_catalog.id AND r.user_id = auth.uid()
    )
  )
);

-- [agy-5]+[codex-12] 대표 해석 + 그룹 전개 (NULL = 자기 자신이 대표, 체인 없이 1단계만)
-- ⚠ 세 헬퍼 모두 SECURITY DEFINER 여야 한다. codex-2 로 planner_catalog 직접 SELECT 가
--   "내 핀·내 후기에 연결된 행"으로 좁혀졌기 때문에, invoker 권한으로 돌면 남의 장소를 볼 때
--   대표 해석이 0행이 되어 후기 목록이 통째로 비어 버린다.
CREATE OR REPLACE FUNCTION public.planner_catalog_root(p_catalog_id uuid)
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT COALESCE(c.canonical_id, c.id) FROM public.planner_catalog c WHERE c.id = p_catalog_id;
$$;
REVOKE ALL ON FUNCTION public.planner_catalog_root(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.planner_catalog_root(uuid) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.planner_catalog_group(p_catalog_id uuid)
RETURNS SETOF uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT c.id FROM public.planner_catalog c
   WHERE c.id = public.planner_catalog_root(p_catalog_id)
      OR c.canonical_id = public.planner_catalog_root(p_catalog_id);
$$;
REVOKE ALL ON FUNCTION public.planner_catalog_group(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.planner_catalog_group(uuid) TO anon, authenticated;

-- 후기 읽기 — 그룹 전체 + 같은 사람 중복행 제거(병합 이전에 갈라진 행 대비).
-- 프런트는 planner_place_reviews 를 직접 SELECT 하지 말고 이 함수만 쓴다.
CREATE OR REPLACE FUNCTION public.planner_reviews_of(p_catalog_id uuid)
RETURNS TABLE (id uuid, user_id uuid, rating smallint, body text, recommended_menu text,
               visited_on date, author_name text, created_at timestamptz, updated_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT * FROM (
    SELECT DISTINCT ON (r.user_id)
           r.id, r.user_id, r.rating, r.body, r.recommended_menu, r.visited_on, r.author_name, r.created_at, r.updated_at
      FROM public.planner_place_reviews r
     WHERE r.catalog_id IN (SELECT public.planner_catalog_group(p_catalog_id))
     ORDER BY r.user_id, r.updated_at DESC
  ) x ORDER BY x.created_at DESC;
$$;
REVOKE ALL ON FUNCTION public.planner_reviews_of(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.planner_reviews_of(uuid) TO anon, authenticated;

-- 관리자 병합. 잘못 합쳤으면 p_from 의 canonical_id 를 NULL 로 되돌리면 끝이다.
-- 자식을 먼저 재지정하고 그다음 본인을 지정한다 — 순서를 바꾸면 체인 가드가
-- 'row is already a canonical target' 으로 거절한다.
CREATE OR REPLACE FUNCTION public.planner_merge_catalog(p_from uuid, p_to uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NOT COALESCE(public.is_admin(), FALSE) THEN RAISE EXCEPTION 'admin only'; END IF;
  IF p_from IS NULL OR p_to IS NULL OR p_from = p_to THEN RAISE EXCEPTION 'bad args'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.planner_catalog WHERE id = p_to AND canonical_id IS NULL) THEN
    RAISE EXCEPTION 'target must be a root';
  END IF;
  UPDATE public.planner_catalog SET canonical_id = p_to WHERE canonical_id = p_from;
  UPDATE public.planner_catalog SET canonical_id = p_to WHERE id = p_from;
END $$;
REVOKE ALL ON FUNCTION public.planner_merge_catalog(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.planner_merge_catalog(uuid, uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- 7. 공유 토큰(해시만 저장). [codex-6] 만료(기본 180일) 추가
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.planner_shares (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id uuid NOT NULL REFERENCES public.planner_trips(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  revoked_at timestamptz,
  expires_at timestamptz NOT NULL DEFAULT (now() + INTERVAL '180 days'),
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.planner_shares
  ADD COLUMN IF NOT EXISTS expires_at timestamptz NOT NULL DEFAULT (now() + INTERVAL '180 days');
CREATE INDEX IF NOT EXISTS idx_planner_shares_trip ON public.planner_shares (trip_id);
CREATE INDEX IF NOT EXISTS idx_planner_shares_live
  ON public.planner_shares (token_hash) WHERE revoked_at IS NULL;
ALTER TABLE public.planner_shares ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.planner_shares FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.planner_shares TO authenticated;
DROP POLICY IF EXISTS "planner shares select own" ON public.planner_shares;
CREATE POLICY "planner shares select own" ON public.planner_shares FOR SELECT TO authenticated USING (auth.uid() = user_id);
DROP TRIGGER IF EXISTS trg_planner_shares_guard ON public.planner_shares;
CREATE TRIGGER trg_planner_shares_guard BEFORE INSERT OR UPDATE ON public.planner_shares FOR EACH ROW EXECUTE FUNCTION public.planner_owner_guard();

-- ---------------------------------------------------------------------------
-- 8. 게시판 글(1여행 1글, 스냅샷 보관). 쓰기는 RPC 전용, 읽기 공개, 삭제는 본인·관리자
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.itinerary_posts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  trip_id uuid NOT NULL UNIQUE REFERENCES public.planner_trips(id) ON DELETE CASCADE,
  title text NOT NULL CHECK (length(btrim(title)) BETWEEN 1 AND 120),
  content text CHECK (content IS NULL OR length(content) <= 5000),
  author_name text,
  country text CHECK (country IS NULL OR length(country) <= 60),
  region_id text REFERENCES public.regions(id),
  start_date date NOT NULL,
  end_date date NOT NULL,
  days_count integer NOT NULL CHECK (days_count BETWEEN 1 AND 61),
  places_count integer NOT NULL CHECK (places_count >= 0),
  snapshot jsonb NOT NULL,
  import_count integer NOT NULL DEFAULT 0,
  view_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
-- [codex-9] 파생 컬럼 무결성(심층 방어): 쓰기는 RPC 전용이지만 service_role 직접 쓰기까지 막는다.
ALTER TABLE public.itinerary_posts DROP CONSTRAINT IF EXISTS itinerary_posts_dates_check;
ALTER TABLE public.itinerary_posts ADD CONSTRAINT itinerary_posts_dates_check
  CHECK (end_date >= start_date AND (end_date - start_date) <= 60);
ALTER TABLE public.itinerary_posts DROP CONSTRAINT IF EXISTS itinerary_posts_counters_check;
ALTER TABLE public.itinerary_posts ADD CONSTRAINT itinerary_posts_counters_check
  CHECK (import_count >= 0 AND view_count >= 0);

CREATE INDEX IF NOT EXISTS idx_itinerary_posts_created ON public.itinerary_posts (created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_itinerary_posts_user ON public.itinerary_posts (user_id);
ALTER TABLE public.itinerary_posts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.itinerary_posts FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.itinerary_posts TO anon, authenticated;
GRANT DELETE ON public.itinerary_posts TO authenticated;
DROP POLICY IF EXISTS "itinerary posts read" ON public.itinerary_posts;
CREATE POLICY "itinerary posts read" ON public.itinerary_posts FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "itinerary posts delete own or admin" ON public.itinerary_posts;
CREATE POLICY "itinerary posts delete own or admin" ON public.itinerary_posts FOR DELETE TO authenticated
  USING (auth.uid() = user_id OR COALESCE(public.is_admin(), FALSE));
DROP TRIGGER IF EXISTS trg_itinerary_posts_guard ON public.itinerary_posts;
CREATE TRIGGER trg_itinerary_posts_guard BEFORE INSERT OR UPDATE ON public.itinerary_posts FOR EACH ROW EXECUTE FUNCTION public.planner_owner_guard();
DROP TRIGGER IF EXISTS trg_itinerary_posts_touch ON public.itinerary_posts;
-- ⚠ 조회수 증가(planner_bump_post_view)는 updated_at 을 건드리면 안 된다. agy-13 의 동기화 배지가
--    "글 갱신 시각"으로 이 값을 쓰는데, 익명 조회 한 번에 배지가 바뀌어 버린다.
--    그래서 내용 컬럼이 실제로 바뀔 때만 발화시킨다(publish RPC 는 ON CONFLICT 에서 updated_at 을 직접 넣는다).
CREATE TRIGGER trg_itinerary_posts_touch
  BEFORE UPDATE OF title, content, author_name, country, region_id,
                   start_date, end_date, days_count, places_count, snapshot
  ON public.itinerary_posts FOR EACH ROW EXECUTE FUNCTION public.planner_touch_updated_at();

-- ---------------------------------------------------------------------------
-- 9. 서버 전용 캐시·레이트 버킷 (RLS on + 정책 없음 + 전부 REVOKE → service_role 만)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.planner_route_cache (
  key_hash text PRIMARY KEY,
  mode text NOT NULL,
  duration_s integer NOT NULL,
  distance_m integer NOT NULL,
  polyline text,
  fetched_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.planner_route_cache ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.planner_route_cache FROM PUBLIC, anon, authenticated;

CREATE TABLE IF NOT EXISTS public.planner_link_cache (
  url_hash text PRIMARY KEY,
  result jsonb NOT NULL,
  fetched_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.planner_link_cache ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.planner_link_cache FROM PUBLIC, anon, authenticated;

CREATE TABLE IF NOT EXISTS public.planner_rate_buckets (
  key text NOT NULL,
  window_start timestamptz NOT NULL,
  hits integer NOT NULL DEFAULT 0,
  PRIMARY KEY (key, window_start)
);
ALTER TABLE public.planner_rate_buckets ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.planner_rate_buckets FROM PUBLIC, anon, authenticated;

-- 사용자 축 레이트리밋(10분 창 누적). SECURITY DEFINER 인 다른 RPC 안에서도 호출된다.
CREATE OR REPLACE FUNCTION public.planner_rate_hit(p_key text, p_limit integer DEFAULT 60)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_win timestamptz; v_hits integer;
BEGIN
  IF COALESCE(btrim(p_key), '') = '' THEN RETURN 0; END IF;
  v_win := date_trunc('hour', now()) + (floor(extract(minute FROM now()) / 10) * INTERVAL '10 minutes');
  DELETE FROM public.planner_rate_buckets WHERE window_start < now() - INTERVAL '1 hour';
  INSERT INTO public.planner_rate_buckets (key, window_start, hits) VALUES (p_key, v_win, 1)
  ON CONFLICT (key, window_start) DO UPDATE SET hits = public.planner_rate_buckets.hits + 1
  RETURNING hits INTO v_hits;
  RETURN v_hits;
END $$;
REVOKE ALL ON FUNCTION public.planner_rate_hit(text, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.planner_rate_hit(text, integer) TO service_role;

-- ---------------------------------------------------------------------------
-- 9-b. [agy-6]+[codex-13] 외부 지오코더 전역 게이트 + 장소 검색 캐시 (service_role 전용)
--   Nominatim 약관은 "앱 합계 1 req/s". 서버리스는 인스턴스가 여러 개라 프로세스 내부 큐로는
--   지킬 수 없다. DB 한 행에 다음 호출 가능 시각을 예약해 앱 전체를 직렬화한다.
--   PostgREST RPC 는 호출마다 독립 트랜잭션이라 FOR UPDATE 락이 커밋 직후 풀리고 예약은
--   next_at 값으로 남는다. 인스턴스가 예약 후 죽으면 슬롯 하나를 버리는 쪽(보수적)이라
--   약관 위반 방향으로 새지 않는다.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.planner_provider_gate (
  provider text PRIMARY KEY,
  next_at   timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.planner_provider_gate ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.planner_provider_gate FROM PUBLIC, anon, authenticated;

-- 반환값 = 요청 발사 전에 기다려야 하는 밀리초. -1 이면 대기 상한 초과 → 호출 포기(429).
CREATE OR REPLACE FUNCTION public.planner_geo_slot(
  p_provider    text,
  p_interval_ms integer DEFAULT 1100,   -- Nominatim 1 req/s + 여유 100ms
  p_max_wait_ms integer DEFAULT 3000
)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_next timestamptz; v_start timestamptz; v_wait integer;
BEGIN
  IF COALESCE(btrim(p_provider), '') = '' THEN RAISE EXCEPTION 'bad provider'; END IF;
  p_interval_ms := LEAST(GREATEST(COALESCE(p_interval_ms, 1100), 1000), 10000);
  p_max_wait_ms := LEAST(GREATEST(COALESCE(p_max_wait_ms, 3000), 0), 15000);

  INSERT INTO public.planner_provider_gate (provider, next_at)
  VALUES (p_provider, now()) ON CONFLICT (provider) DO NOTHING;

  -- FOR UPDATE 가 동시 호출을 이 한 행에 줄 세운다(인스턴스 수와 무관).
  SELECT next_at INTO v_next FROM public.planner_provider_gate
   WHERE provider = p_provider FOR UPDATE;
  -- 행이 없으면 뒤따르는 UPDATE 도 0행이라 게이트가 조용히 무력화된다. 소리내어 실패시킨다.
  IF NOT FOUND THEN RAISE EXCEPTION 'gate row missing'; END IF;

  v_start := GREATEST(v_next, now());
  v_wait  := GREATEST(ceil(extract(epoch FROM (v_start - now())) * 1000)::integer, 0);
  IF v_wait > p_max_wait_ms THEN RETURN -1; END IF;   -- 예약하지 않고 반려

  UPDATE public.planner_provider_gate
     SET next_at = v_start + make_interval(secs => p_interval_ms / 1000.0)
   WHERE provider = p_provider;
  RETURN v_wait;
END $$;
REVOKE ALL ON FUNCTION public.planner_geo_slot(text, integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.planner_geo_slot(text, integer, integer) TO service_role;

-- 설계 4절이 약속한 "결과 캐시 24h" 의 실제 저장소. 캐시 히트는 게이트를 건너뛴다.
CREATE TABLE IF NOT EXISTS public.planner_place_search_cache (
  query_hash text PRIMARY KEY,   -- sha256(provider || '|' || lower(btrim(q)) || '|' || lang)
  provider   text NOT NULL CHECK (provider IN ('google','osm')),
  result     jsonb NOT NULL,
  fetched_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_planner_place_search_cache_fetched
  ON public.planner_place_search_cache (fetched_at);
ALTER TABLE public.planner_place_search_cache ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.planner_place_search_cache FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 10. RPC — 여행 생성·기간 변경·정렬
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.planner_create_trip(p_title text, p_start date, p_end date, p_currency text DEFAULT 'KRW', p_country text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_me uuid := auth.uid(); v_id uuid; v_i integer;
BEGIN
  IF v_me IS NULL THEN RAISE EXCEPTION 'auth required'; END IF;
  IF p_title IS NULL OR length(btrim(p_title)) NOT BETWEEN 1 AND 80 THEN RAISE EXCEPTION 'bad title'; END IF;
  IF p_start IS NULL OR p_end IS NULL OR p_end < p_start OR (p_end - p_start) > 60 THEN RAISE EXCEPTION 'bad dates'; END IF;
  INSERT INTO public.planner_trips (user_id, title, start_date, end_date, currency, country)
  VALUES (v_me, btrim(p_title), p_start, p_end, COALESCE(NULLIF(upper(btrim(p_currency)), ''), 'KRW'), NULLIF(btrim(p_country), ''))
  RETURNING id INTO v_id;
  FOR v_i IN 0..(p_end - p_start) LOOP
    INSERT INTO public.planner_days (trip_id, user_id, day_index, date) VALUES (v_id, v_me, v_i, p_start + v_i);
  END LOOP;
  RETURN v_id;
END $$;
REVOKE ALL ON FUNCTION public.planner_create_trip(text, date, date, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.planner_create_trip(text, date, date, text, text) TO authenticated;

-- [agy-12] 기간 변경: 날짜 행을 늘리거나 줄인다. 줄어든 날짜의 핀은 보관함(day_id NULL)으로.
--   보관함으로 밀려날 핀이 있으면 p_confirm_detach=false 일 때 confirm_detach:N 으로 거절한다.
--   가드를 프런트가 아니라 RPC 안에 둔 이유: 나중에 나올 별도 안드로이드 앱이 같은 보호 로직을
--   중복 구현하지 않아도 되고, 카운트와 DELETE 가 한 트랜잭션이라 경합이 없다.
-- 3-arg 를 남겨두면 오버로드 후보가 2개가 되어 PostgREST 호출이 모호해진다. 반드시 DROP 먼저.
DROP FUNCTION IF EXISTS public.planner_set_dates(uuid, date, date);

CREATE OR REPLACE FUNCTION public.planner_set_dates(
  p_trip_id uuid, p_start date, p_end date, p_confirm_detach boolean DEFAULT false)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_me uuid := auth.uid(); v_i integer; v_n integer; v_detach integer;
BEGIN
  IF v_me IS NULL THEN RAISE EXCEPTION 'auth required'; END IF;
  IF p_start IS NULL OR p_end IS NULL OR p_end < p_start OR (p_end - p_start) > 60 THEN RAISE EXCEPTION 'bad dates'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.planner_trips WHERE id = p_trip_id AND user_id = v_me) THEN RAISE EXCEPTION 'not found'; END IF;
  v_n := p_end - p_start;

  -- 잘려나갈 날짜에 붙어 있는 핀 수 = 보관함으로 이동할 대상
  SELECT count(*) INTO v_detach
  FROM public.planner_places p
  JOIN public.planner_days d ON d.id = p.day_id
  WHERE p.trip_id = p_trip_id AND d.day_index > v_n;

  IF v_detach > 0 AND NOT COALESCE(p_confirm_detach, false) THEN
    RAISE EXCEPTION 'confirm_detach:%', v_detach USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.planner_trips SET start_date = p_start, end_date = p_end WHERE id = p_trip_id;
  DELETE FROM public.planner_days WHERE trip_id = p_trip_id AND day_index > v_n;  -- 핀은 FK SET NULL 로 보관함 이동
  FOR v_i IN 0..v_n LOOP
    INSERT INTO public.planner_days (trip_id, user_id, day_index, date) VALUES (p_trip_id, v_me, v_i, p_start + v_i)
    ON CONFLICT (trip_id, day_index) DO UPDATE SET date = EXCLUDED.date;
  END LOOP;
  RETURN v_detach;  -- 실제로 보관함으로 옮겨진 핀 수
END $$;
REVOKE ALL ON FUNCTION public.planner_set_dates(uuid, date, date, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.planner_set_dates(uuid, date, date, boolean) TO authenticated;

-- 정렬·날짜 이동을 한 번에: p_day_id(NULL=보관함)에 p_place_ids 순서대로 배치
CREATE OR REPLACE FUNCTION public.planner_reorder_places(p_trip_id uuid, p_day_id uuid, p_place_ids uuid[])
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_me uuid := auth.uid(); v_i integer;
BEGIN
  IF v_me IS NULL THEN RAISE EXCEPTION 'auth required'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.planner_trips WHERE id = p_trip_id AND user_id = v_me) THEN RAISE EXCEPTION 'not found'; END IF;
  IF p_day_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.planner_days WHERE id = p_day_id AND trip_id = p_trip_id) THEN RAISE EXCEPTION 'day not in trip'; END IF;
  IF p_place_ids IS NULL THEN RETURN; END IF;
  IF array_length(p_place_ids, 1) > 200 THEN RAISE EXCEPTION 'too many'; END IF;
  IF EXISTS (SELECT 1 FROM unnest(p_place_ids) AS x(id) WHERE NOT EXISTS (SELECT 1 FROM public.planner_places p WHERE p.id = x.id AND p.trip_id = p_trip_id)) THEN
    RAISE EXCEPTION 'place not in trip';
  END IF;
  FOR v_i IN 1..array_length(p_place_ids, 1) LOOP
    UPDATE public.planner_places SET day_id = p_day_id, sort_order = v_i - 1 WHERE id = p_place_ids[v_i] AND trip_id = p_trip_id;
  END LOOP;
END $$;
REVOKE ALL ON FUNCTION public.planner_reorder_places(uuid, uuid, uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.planner_reorder_places(uuid, uuid, uuid[]) TO authenticated;

-- ---------------------------------------------------------------------------
-- 11. RPC — 카탈로그 upsert (회원은 없는 행만 추가, 기존 행의 값은 덮어쓰지 못한다)
--     [agy-7] 구글 지도가 꺼져 있으면 구글 장소 행 자체를 만들지 않는다.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.planner_upsert_catalog(
  p_provider text, p_provider_place_id text, p_name text, p_address text, p_lat double precision, p_lng double precision, p_extra jsonb DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_me uuid := auth.uid(); v_id uuid;
BEGIN
  IF v_me IS NULL THEN RAISE EXCEPTION 'auth required'; END IF;
  IF p_provider NOT IN ('google','osm') THEN RAISE EXCEPTION 'bad provider'; END IF;
  IF p_provider = 'google' AND NOT public.planner_google_enabled() THEN
    RAISE EXCEPTION 'google provider disabled';
  END IF;
  IF p_provider_place_id IS NULL OR length(p_provider_place_id) NOT BETWEEN 1 AND 300 THEN RAISE EXCEPTION 'bad place id'; END IF;
  IF p_name IS NULL OR length(btrim(p_name)) NOT BETWEEN 1 AND 200 THEN RAISE EXCEPTION 'bad name'; END IF;
  IF p_lat IS NULL OR p_lng IS NULL OR p_lat NOT BETWEEN -90 AND 90 OR p_lng NOT BETWEEN -180 AND 180 THEN RAISE EXCEPTION 'bad coords'; END IF;
  SELECT id INTO v_id FROM public.planner_catalog WHERE provider = p_provider AND provider_place_id = p_provider_place_id;
  IF v_id IS NOT NULL THEN RETURN v_id; END IF;
  INSERT INTO public.planner_catalog (provider, provider_place_id, name, address, lat, lng, opening_hours, website, phone)
  VALUES (p_provider, p_provider_place_id, btrim(p_name), NULLIF(left(btrim(COALESCE(p_address, '')), 300), ''), p_lat, p_lng,
          CASE WHEN p_extra ? 'opening_hours' THEN p_extra->'opening_hours' ELSE NULL END,
          NULLIF(left(COALESCE(p_extra->>'website', ''), 500), ''),
          NULLIF(left(COALESCE(p_extra->>'phone', ''), 40), ''))
  ON CONFLICT (provider, provider_place_id) DO UPDATE SET fetched_at = public.planner_catalog.fetched_at
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;
REVOKE ALL ON FUNCTION public.planner_upsert_catalog(text, text, text, text, double precision, double precision, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.planner_upsert_catalog(text, text, text, text, double precision, double precision, jsonb) TO authenticated;

-- ---------------------------------------------------------------------------
-- 12. RPC — 후기(방문 완료한 본인 핀이 있을 때만)
--     [agy-5]+[codex-12] 저장은 항상 대표 행에, 방문 판정은 병합된 형제 행 전체에서.
--     (OSM 으로 방문한 뒤 구글로 전환돼도 후기를 쓸 수 있어야 한다)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.planner_submit_review(p_catalog_id uuid, p_rating integer, p_body text DEFAULT NULL, p_menu text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_me uuid := auth.uid(); v_root uuid; v_visited date; v_name text; v_id uuid;
BEGIN
  IF v_me IS NULL THEN RAISE EXCEPTION 'auth required'; END IF;
  IF p_rating IS NULL OR p_rating NOT BETWEEN 1 AND 5 THEN RAISE EXCEPTION 'bad rating'; END IF;
  IF p_body IS NOT NULL AND length(p_body) > 1000 THEN RAISE EXCEPTION 'body too long'; END IF;
  IF p_menu IS NOT NULL AND length(p_menu) > 200 THEN RAISE EXCEPTION 'menu too long'; END IF;
  v_root := public.planner_catalog_root(p_catalog_id);
  IF v_root IS NULL THEN RAISE EXCEPTION 'unknown place'; END IF;
  SELECT min(visited_at)::date INTO v_visited FROM public.planner_places
   WHERE user_id = v_me AND visited_at IS NOT NULL
     AND catalog_id IN (SELECT public.planner_catalog_group(v_root));
  IF v_visited IS NULL THEN RAISE EXCEPTION 'visit required'; END IF;
  SELECT COALESCE(NULLIF(nickname, ''), NULLIF(name, ''), '익명') INTO v_name FROM public.profiles WHERE id = v_me;
  INSERT INTO public.planner_place_reviews (catalog_id, user_id, rating, body, recommended_menu, visited_on, author_name)
  VALUES (v_root, v_me, p_rating, NULLIF(btrim(COALESCE(p_body, '')), ''), NULLIF(btrim(COALESCE(p_menu, '')), ''), v_visited, v_name)
  ON CONFLICT (catalog_id, user_id) DO UPDATE
    SET rating = EXCLUDED.rating, body = EXCLUDED.body, recommended_menu = EXCLUDED.recommended_menu,
        visited_on = EXCLUDED.visited_on, updated_at = now()
  RETURNING id INTO v_id;
  -- 병합 이전에 형제 행에 남아 있던 같은 사람 후기는 정리한다(읽기 쪽 중복 제거와 짝).
  DELETE FROM public.planner_place_reviews r
   WHERE r.user_id = v_me AND r.id <> v_id
     AND r.catalog_id IN (SELECT public.planner_catalog_group(v_root));
  RETURN v_id;
END $$;
REVOKE ALL ON FUNCTION public.planner_submit_review(uuid, integer, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.planner_submit_review(uuid, integer, text, text) TO authenticated;

-- ---------------------------------------------------------------------------
-- 13. 스냅샷 빌더(내부 전용) — 티켓·비공개 메모 제외
--   [codex-10] legs 는 지문이 현재 핀 구성과 일치할 때만 싣는다(불일치 = 빈 배열).
--   [codex-11] schema / generated_at / timezone 추가. v 는 1 유지 → planner_import 하위호환.
--   [agy-7]   구글 지도가 꺼져 있으면 구글 장소의 provider·provider_place_id 를 마스킹.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.planner_build_snapshot(p_trip_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path = public, pg_temp AS $$
DECLARE
  v_trip public.planner_trips%ROWTYPE;
  v_days jsonb; v_unassigned jsonb; v_places integer; v_cost bigint; v_daycount integer;
  v_google boolean := public.planner_google_enabled();
BEGIN
  SELECT * INTO v_trip FROM public.planner_trips WHERE id = p_trip_id;
  IF NOT FOUND THEN RETURN NULL; END IF;

  SELECT COALESCE(jsonb_agg(d ORDER BY (d->>'index')::int), '[]'::jsonb) INTO v_days FROM (
    SELECT jsonb_build_object(
      'index', dy.day_index,
      'date', dy.date,
      'places', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'order', pl.sort_order, 'name', pl.name, 'address', pl.address, 'lat', pl.lat, 'lng', pl.lng,
          'provider',          CASE WHEN c.provider = 'google' AND NOT v_google THEN NULL ELSE c.provider END,
          'provider_place_id', CASE WHEN c.provider = 'google' AND NOT v_google THEN NULL ELSE c.provider_place_id END,
          'catalog_id', pl.catalog_id,
          'planned_time', pl.planned_time, 'stay_min', pl.stay_min, 'cost', pl.cost,
          'note', CASE WHEN pl.note_public THEN pl.note ELSE NULL END
        ) ORDER BY pl.sort_order, pl.created_at)
        FROM public.planner_places pl LEFT JOIN public.planner_catalog c ON c.id = pl.catalog_id
        WHERE pl.day_id = dy.id), '[]'::jsonb),
      'legs', CASE WHEN dy.legs->>'fp' IS NOT DISTINCT FROM public.planner_day_places_fp(dy.id)
                   THEN COALESCE(dy.legs->'items', '[]'::jsonb) ELSE '[]'::jsonb END,
      'legs_mode', dy.legs->>'mode',
      'legs_computed_at', dy.legs->>'computed_at'
    ) AS d
    FROM public.planner_days dy WHERE dy.trip_id = p_trip_id) s;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'order', pl.sort_order, 'name', pl.name, 'address', pl.address, 'lat', pl.lat, 'lng', pl.lng,
      'provider',          CASE WHEN c.provider = 'google' AND NOT v_google THEN NULL ELSE c.provider END,
      'provider_place_id', CASE WHEN c.provider = 'google' AND NOT v_google THEN NULL ELSE c.provider_place_id END,
      'catalog_id', pl.catalog_id,
      'planned_time', pl.planned_time, 'stay_min', pl.stay_min, 'cost', pl.cost,
      'note', CASE WHEN pl.note_public THEN pl.note ELSE NULL END
    ) ORDER BY pl.sort_order, pl.created_at), '[]'::jsonb) INTO v_unassigned
  FROM public.planner_places pl LEFT JOIN public.planner_catalog c ON c.id = pl.catalog_id
  WHERE pl.trip_id = p_trip_id AND pl.day_id IS NULL;

  SELECT count(*), COALESCE(sum(cost), 0) INTO v_places, v_cost FROM public.planner_places WHERE trip_id = p_trip_id;
  SELECT count(*) INTO v_daycount FROM public.planner_days WHERE trip_id = p_trip_id;

  RETURN jsonb_build_object(
    'v', 1,
    'schema', 'planner.snapshot/v1',
    'generated_at', to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
    'timezone', v_trip.timezone,
    'title', v_trip.title, 'start_date', v_trip.start_date, 'end_date', v_trip.end_date,
    'currency', v_trip.currency, 'country', v_trip.country,
    'days', v_days, 'unassigned', v_unassigned,
    'summary', jsonb_build_object('days_count', v_daycount, 'places_count', v_places, 'cost_total', v_cost)
  );
END $$;
REVOKE ALL ON FUNCTION public.planner_build_snapshot(uuid) FROM PUBLIC, anon, authenticated;

-- 동선 요약 텍스트(게시글 content, 검색·키워드 알림 대상)
-- STABLE 이다(IMMUTABLE 아님). 내부의 to_char(timestamp, text) 가 DateStyle 설정에 의존한다.
CREATE OR REPLACE FUNCTION public.planner_summary_text(p_snapshot jsonb)
RETURNS text LANGUAGE sql STABLE SET search_path = public, pg_temp AS $$
  SELECT left(COALESCE(string_agg(
    ((d->>'index')::int + 1) || '일차 ' || to_char((d->>'date')::date, 'MM.DD') || ': ' ||
    COALESCE((SELECT string_agg(p->>'name', ' → ' ORDER BY (p->>'order')::int) FROM jsonb_array_elements(d->'places') p), '(비어 있음)'),
    E'\n' ORDER BY (d->>'index')::int), ''), 5000)
  FROM jsonb_array_elements(p_snapshot->'days') d;
$$;
REVOKE ALL ON FUNCTION public.planner_summary_text(jsonb) FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 14. RPC — 공유 링크
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.planner_create_share(p_trip_id uuid)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_me uuid := auth.uid(); v_token text; v_hash text;
BEGIN
  IF v_me IS NULL THEN RAISE EXCEPTION 'auth required'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.planner_trips WHERE id = p_trip_id AND user_id = v_me) THEN RAISE EXCEPTION 'not found'; END IF;
  v_token := encode(extensions.gen_random_bytes(32), 'hex');
  v_hash := encode(extensions.digest(v_token, 'sha256'), 'hex');
  UPDATE public.planner_shares SET revoked_at = now() WHERE trip_id = p_trip_id AND revoked_at IS NULL;  -- 재발급 = 이전 링크 무효
  INSERT INTO public.planner_shares (trip_id, user_id, token_hash) VALUES (p_trip_id, v_me, v_hash);
  UPDATE public.planner_trips SET visibility = 'link' WHERE id = p_trip_id AND visibility = 'private';
  RETURN v_token;
END $$;
REVOKE ALL ON FUNCTION public.planner_create_share(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.planner_create_share(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.planner_revoke_share(p_trip_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_me uuid := auth.uid();
BEGIN
  IF v_me IS NULL THEN RAISE EXCEPTION 'auth required'; END IF;
  UPDATE public.planner_shares SET revoked_at = now() WHERE trip_id = p_trip_id AND user_id = v_me AND revoked_at IS NULL;
  UPDATE public.planner_trips SET visibility = 'private' WHERE id = p_trip_id AND user_id = v_me AND visibility = 'link';
END $$;
REVOKE ALL ON FUNCTION public.planner_revoke_share(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.planner_revoke_share(uuid) TO authenticated;

-- 비로그인 열람 허용. 토큰은 256비트 랜덤(무차별 대입 불가). 원문 토큰은 어디에도 저장하지 않는다.
-- [codex-6] 만료 반영 + 조회 스로틀. 스로틀 키는 토큰 해시가 아니라 "조회에 성공한 trip_id" 다 —
--   해시로 키를 잡으면 무작위 64-hex 를 흘리는 것만으로 레이트 버킷에 정크 행을 무한히 만들 수 있다.
--   ⚠ STABLE 을 붙이면 안 된다. PL/pgSQL 은 비휘발성 함수를 read-only 로 실행해서 카운터 INSERT 가 막힌다.
CREATE OR REPLACE FUNCTION public.planner_get_shared(p_token text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_trip uuid; v_owner uuid; v_snap jsonb; v_name text;
BEGIN
  IF p_token IS NULL OR p_token !~ '^[0-9a-f]{64}$' THEN RETURN NULL; END IF;
  SELECT s.trip_id, s.user_id INTO v_trip, v_owner FROM public.planner_shares s
   WHERE s.token_hash = encode(extensions.digest(p_token, 'sha256'), 'hex')
     AND s.revoked_at IS NULL AND s.expires_at > now();
  IF v_trip IS NULL THEN RETURN NULL; END IF;
  -- 링크당 10분 120회. 초과해도 예외가 아니라 NULL 이라 응답 균질화가 유지된다.
  IF public.planner_rate_hit('share:' || v_trip::text, 120) > 120 THEN RETURN NULL; END IF;
  v_snap := public.planner_build_snapshot(v_trip);
  IF v_snap IS NULL THEN RETURN NULL; END IF;
  SELECT COALESCE(NULLIF(nickname, ''), NULLIF(name, ''), '익명') INTO v_name FROM public.profiles WHERE id = v_owner;
  RETURN v_snap || jsonb_build_object('shared', true, 'author_name', v_name);
END $$;
REVOKE ALL ON FUNCTION public.planner_get_shared(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.planner_get_shared(text) TO anon, authenticated;

-- ---------------------------------------------------------------------------
-- 15. RPC — 게시판 자동 게시 / 내리기 / 조회수 / 동기화 상태
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.planner_publish_to_board(p_trip_id uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_me uuid := auth.uid(); v_trip public.planner_trips%ROWTYPE; v_snap jsonb; v_title text; v_name text; v_id uuid; v_content text;
BEGIN
  IF v_me IS NULL THEN RAISE EXCEPTION 'auth required'; END IF;
  SELECT * INTO v_trip FROM public.planner_trips WHERE id = p_trip_id AND user_id = v_me;
  IF NOT FOUND THEN RAISE EXCEPTION 'not found'; END IF;
  v_snap := public.planner_build_snapshot(p_trip_id);
  IF (v_snap->'summary'->>'places_count')::int < 1 THEN RAISE EXCEPTION 'empty trip'; END IF;
  -- [codex-9 후속] itinerary_posts_dates_check 가 days_count >= 1 을 요구한다. 날짜 행 없이
  -- 만들어진 여행(RPC 를 거치지 않고 테이블에 직접 INSERT 한 경우)이면 원시 23514 대신 여기서 막는다.
  IF (v_snap->'summary'->>'days_count')::int < 1 THEN RAISE EXCEPTION 'no days'; END IF;
  v_title := left(v_trip.title || ' · ' || to_char(v_trip.start_date, 'YYYY.MM.DD') ||
             CASE WHEN v_trip.end_date <> v_trip.start_date THEN '~' || to_char(v_trip.end_date, CASE WHEN extract(year FROM v_trip.end_date) = extract(year FROM v_trip.start_date) THEN 'MM.DD' ELSE 'YYYY.MM.DD' END) ELSE '' END, 120);
  v_content := public.planner_summary_text(v_snap);
  SELECT COALESCE(NULLIF(nickname, ''), NULLIF(name, ''), '익명') INTO v_name FROM public.profiles WHERE id = v_me;
  INSERT INTO public.itinerary_posts (user_id, trip_id, title, content, author_name, country, start_date, end_date, days_count, places_count, snapshot)
  VALUES (v_me, p_trip_id, v_title, v_content, v_name, v_trip.country, v_trip.start_date, v_trip.end_date,
          (v_snap->'summary'->>'days_count')::int, (v_snap->'summary'->>'places_count')::int, v_snap)
  ON CONFLICT (trip_id) DO UPDATE
    SET title = EXCLUDED.title, content = EXCLUDED.content, author_name = EXCLUDED.author_name, country = EXCLUDED.country,
        start_date = EXCLUDED.start_date, end_date = EXCLUDED.end_date, days_count = EXCLUDED.days_count,
        places_count = EXCLUDED.places_count, snapshot = EXCLUDED.snapshot, updated_at = now()
  RETURNING id INTO v_id;
  UPDATE public.planner_trips SET visibility = 'board' WHERE id = p_trip_id;
  RETURN v_id;
END $$;
REVOKE ALL ON FUNCTION public.planner_publish_to_board(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.planner_publish_to_board(uuid) TO authenticated;

-- [codex-6] 만료된 공유는 'link' 복원 대상이 아니다.
CREATE OR REPLACE FUNCTION public.planner_unpublish(p_trip_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_me uuid := auth.uid();
BEGIN
  IF v_me IS NULL THEN RAISE EXCEPTION 'auth required'; END IF;
  DELETE FROM public.itinerary_posts WHERE trip_id = p_trip_id AND user_id = v_me;
  UPDATE public.planner_trips
     SET visibility = CASE WHEN EXISTS (
           SELECT 1 FROM public.planner_shares s
            WHERE s.trip_id = p_trip_id AND s.revoked_at IS NULL AND s.expires_at > now()
         ) THEN 'link' ELSE 'private' END
   WHERE id = p_trip_id AND user_id = v_me AND visibility = 'board';
END $$;
REVOKE ALL ON FUNCTION public.planner_unpublish(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.planner_unpublish(uuid) TO authenticated;

-- [codex-6] anon 무제한 증가 방지. 글당 10분 60회.
CREATE OR REPLACE FUNCTION public.planner_bump_post_view(p_post_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF p_post_id IS NULL THEN RETURN; END IF;
  IF public.planner_rate_hit('view:' || p_post_id::text, 60) > 60 THEN RETURN; END IF;
  UPDATE public.itinerary_posts SET view_count = view_count + 1 WHERE id = p_post_id;
END $$;
REVOKE ALL ON FUNCTION public.planner_bump_post_view(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.planner_bump_post_view(uuid) TO anon, authenticated;

-- [agy-13] 게시글 동기화 상태(일정판 헤더용). 스냅샷 전문이 글에 있으므로 기존 글에도 소급 적용된다.
--   updated_at 비교가 아니라 md5 비교를 쓴다 — 핀 편집은 planner_trips.updated_at 을 건드리지 않는다.
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
    -- 스냅샷 형식 v 가 올라간 뒤에는(향후 v2) 전량 stale 로 보이지 않도록 같은 버전일 때만 비교
    'stale', CASE WHEN v_cur IS NULL OR (v_snap->>'v') IS DISTINCT FROM (v_cur->>'v') THEN false
                  ELSE md5(v_cur::text) IS DISTINCT FROM md5(v_snap::text) END);
END $$;
REVOKE ALL ON FUNCTION public.planner_board_sync_state(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.planner_board_sync_state(uuid) TO authenticated;

-- 목록 화면용 일괄 조회(/planner 카드에서 N번 호출 방지). 내 글만 대상이라 최대 수십 건.
-- LATERAL 로 스냅샷을 행당 1회만 만든다.
CREATE OR REPLACE FUNCTION public.planner_board_sync_list()
RETURNS TABLE (trip_id uuid, post_id uuid, stale boolean)
LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public, pg_temp AS $$
  SELECT p.trip_id, p.id,
         CASE WHEN cur.snap IS NULL OR (p.snapshot->>'v') IS DISTINCT FROM (cur.snap->>'v') THEN false
              ELSE md5(cur.snap::text) IS DISTINCT FROM md5(p.snapshot::text) END
  FROM public.itinerary_posts p
  CROSS JOIN LATERAL (SELECT public.planner_build_snapshot(p.trip_id) AS snap) cur
  WHERE p.user_id = auth.uid();
$$;
REVOKE ALL ON FUNCTION public.planner_board_sync_list() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.planner_board_sync_list() TO authenticated;

-- ---------------------------------------------------------------------------
-- 16. RPC — 가져오기(스냅샷 → 호출자 소유 사본). 스냅샷 값은 전부 재검증한다.
--   하위호환: v=1 스냅샷만 받는다. v2 가 새로 넣은 schema/generated_at/timezone/legs_* 키는
--   읽지 않으므로 v1 시절에 저장된 게시글 스냅샷도 그대로 가져와진다(신규 필드는 화이트리스트 밖).
--   [codex-6] 만료된 공유 토큰으로는 가져올 수 없다.
--   [codex-4] 빈 날이 많은 스냅샷은 500핀 상한에 안 걸리므로 날짜 루프에 61일 상한을 따로 둔다.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.planner_import(p_post_id uuid DEFAULT NULL, p_token text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_me uuid := auth.uid(); v_snap jsonb; v_trip uuid; v_start date; v_end date; v_title text; v_currency text; v_country text;
  v_day jsonb; v_place jsonb; v_day_id uuid; v_idx integer; v_i integer; v_catalog uuid; v_lat double precision; v_lng double precision;
  v_src_trip uuid; v_n integer := 0; v_dn integer := 0;
BEGIN
  IF v_me IS NULL THEN RAISE EXCEPTION 'auth required'; END IF;
  IF p_post_id IS NOT NULL THEN
    SELECT snapshot, trip_id INTO v_snap, v_src_trip FROM public.itinerary_posts WHERE id = p_post_id;
    IF v_snap IS NULL THEN RAISE EXCEPTION 'not found'; END IF;
  ELSIF p_token IS NOT NULL THEN
    IF p_token !~ '^[0-9a-f]{64}$' THEN RAISE EXCEPTION 'not found'; END IF;
    SELECT s.trip_id INTO v_src_trip FROM public.planner_shares s
     WHERE s.token_hash = encode(extensions.digest(p_token, 'sha256'), 'hex')
       AND s.revoked_at IS NULL AND s.expires_at > now();
    IF v_src_trip IS NULL THEN RAISE EXCEPTION 'not found'; END IF;
    v_snap := public.planner_build_snapshot(v_src_trip);
  ELSE
    RAISE EXCEPTION 'bad request';
  END IF;
  IF (v_snap->>'v')::int IS DISTINCT FROM 1 THEN RAISE EXCEPTION 'unsupported snapshot'; END IF;

  -- 내 여행이 이미 100개면 중단(무한 복사 방어)
  IF (SELECT count(*) FROM public.planner_trips WHERE user_id = v_me) >= 100 THEN RAISE EXCEPTION 'too many trips'; END IF;

  v_title := left(COALESCE(NULLIF(btrim(v_snap->>'title'), ''), '가져온 일정'), 80);
  v_start := COALESCE((v_snap->>'start_date')::date, CURRENT_DATE);
  v_end := COALESCE((v_snap->>'end_date')::date, v_start);
  IF v_end < v_start OR (v_end - v_start) > 60 THEN v_end := v_start; END IF;
  v_currency := COALESCE(NULLIF(upper(v_snap->>'currency'), ''), 'KRW');
  IF v_currency !~ '^[A-Z]{3}$' THEN v_currency := 'KRW'; END IF;
  v_country := NULLIF(left(COALESCE(v_snap->>'country', ''), 60), '');

  INSERT INTO public.planner_trips (user_id, title, start_date, end_date, currency, country, origin_post_id)
  VALUES (v_me, v_title, v_start, v_end, v_currency, v_country, p_post_id) RETURNING id INTO v_trip;

  FOR v_i IN 0..(v_end - v_start) LOOP
    INSERT INTO public.planner_days (trip_id, user_id, day_index, date) VALUES (v_trip, v_me, v_i, v_start + v_i);
  END LOOP;

  FOR v_day IN SELECT * FROM jsonb_array_elements(COALESCE(v_snap->'days', '[]'::jsonb)) LOOP
    v_dn := v_dn + 1;
    IF v_dn > 61 THEN RAISE EXCEPTION 'too many days'; END IF;
    v_idx := NULLIF(v_day->>'index', '')::int;
    SELECT id INTO v_day_id FROM public.planner_days WHERE trip_id = v_trip AND day_index = v_idx;  -- 범위 밖이면 NULL=보관함
    v_i := 0;
    FOR v_place IN SELECT * FROM jsonb_array_elements(COALESCE(v_day->'places', '[]'::jsonb)) ORDER BY (value->>'order')::int NULLS LAST LOOP
      v_lat := NULLIF(v_place->>'lat', '')::double precision; v_lng := NULLIF(v_place->>'lng', '')::double precision;
      IF v_lat IS NULL OR v_lng IS NULL OR v_lat NOT BETWEEN -90 AND 90 OR v_lng NOT BETWEEN -180 AND 180 THEN CONTINUE; END IF;
      v_catalog := NULL;
      IF (v_place->>'catalog_id') IS NOT NULL THEN
        SELECT id INTO v_catalog FROM public.planner_catalog WHERE id = (v_place->>'catalog_id')::uuid;
      END IF;
      INSERT INTO public.planner_places (trip_id, user_id, day_id, catalog_id, name, address, lat, lng, sort_order, planned_time, stay_min, cost, note, note_public, source)
      VALUES (v_trip, v_me, v_day_id, v_catalog,
              left(COALESCE(NULLIF(btrim(v_place->>'name'), ''), '이름 없는 장소'), 200),
              NULLIF(left(COALESCE(v_place->>'address', ''), 300), ''), v_lat, v_lng, v_i,
              CASE WHEN (v_place->>'planned_time') ~ '^\d{2}:\d{2}' THEN (v_place->>'planned_time')::time ELSE NULL END,
              CASE WHEN (v_place->>'stay_min') ~ '^\d+$' AND (v_place->>'stay_min')::int <= 1440 THEN (v_place->>'stay_min')::int ELSE NULL END,
              CASE WHEN (v_place->>'cost') ~ '^\d+$' AND (v_place->>'cost')::bigint <= 2147483647 THEN (v_place->>'cost')::int ELSE NULL END,
              NULLIF(left(COALESCE(v_place->>'note', ''), 2000), ''), (v_place->>'note') IS NOT NULL, 'import');
      v_i := v_i + 1; v_n := v_n + 1;
      IF v_n > 500 THEN RAISE EXCEPTION 'too many places'; END IF;
    END LOOP;
  END LOOP;

  v_i := 0;
  FOR v_place IN SELECT * FROM jsonb_array_elements(COALESCE(v_snap->'unassigned', '[]'::jsonb)) ORDER BY (value->>'order')::int NULLS LAST LOOP
    v_lat := NULLIF(v_place->>'lat', '')::double precision; v_lng := NULLIF(v_place->>'lng', '')::double precision;
    IF v_lat IS NULL OR v_lng IS NULL OR v_lat NOT BETWEEN -90 AND 90 OR v_lng NOT BETWEEN -180 AND 180 THEN CONTINUE; END IF;
    v_catalog := NULL;
    IF (v_place->>'catalog_id') IS NOT NULL THEN SELECT id INTO v_catalog FROM public.planner_catalog WHERE id = (v_place->>'catalog_id')::uuid; END IF;
    INSERT INTO public.planner_places (trip_id, user_id, day_id, catalog_id, name, address, lat, lng, sort_order, cost, note, note_public, source)
    VALUES (v_trip, v_me, NULL, v_catalog, left(COALESCE(NULLIF(btrim(v_place->>'name'), ''), '이름 없는 장소'), 200),
            NULLIF(left(COALESCE(v_place->>'address', ''), 300), ''), v_lat, v_lng, v_i,
            CASE WHEN (v_place->>'cost') ~ '^\d+$' AND (v_place->>'cost')::bigint <= 2147483647 THEN (v_place->>'cost')::int ELSE NULL END,
            NULLIF(left(COALESCE(v_place->>'note', ''), 2000), ''), (v_place->>'note') IS NOT NULL, 'import');
    v_i := v_i + 1; v_n := v_n + 1;
    IF v_n > 500 THEN RAISE EXCEPTION 'too many places'; END IF;
  END LOOP;

  IF p_post_id IS NOT NULL THEN UPDATE public.itinerary_posts SET import_count = import_count + 1 WHERE id = p_post_id; END IF;
  RETURN v_trip;
END $$;
REVOKE ALL ON FUNCTION public.planner_import(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.planner_import(uuid, text) TO authenticated;

-- ---------------------------------------------------------------------------
-- 17. 기존 객체 연동: 좋아요 화이트리스트 / 키워드 알림 링크
-- ---------------------------------------------------------------------------
ALTER TABLE public.post_likes DROP CONSTRAINT IF EXISTS post_likes_board_type_check;
ALTER TABLE public.post_likes ADD CONSTRAINT post_likes_board_type_check
  CHECK (board_type IN ('destinations','reviews','qna_posts','companion_posts','crew_posts','itinerary_posts'));

-- toggle_post_like: 운영 정의(2026-09-03 pg_get_functiondef 실측) + itinerary_posts 추가.
-- [codex-21] INSERT 전에 대상 게시물 존재를 확인한다. post_likes.post_id 는 polymorphic 이라
--   FK 로는 못 막고, 5개 기존 게시판은 user_id 가 nullable 이라 v_author IS NULL 을 존재 판정에
--   쓰면 안 된다. 취소(delete) 경로는 그대로 둬서 삭제된 글의 좋아요 해제는 계속 가능하다.
-- ⚠ set_config('app.allow_sensitive') 는 profiles_guard(security_hardening.sql)가 읽는 이름이라
--   플래너 가드가 app.planner_bypass 로 옮겨간 뒤에도 여기만은 그대로 둔다. 바꾸면 포인트 적립이 깨진다.
-- 포인트 적립은 crew_posts 만(변경 없음).
CREATE OR REPLACE FUNCTION public.toggle_post_like(p_board_type text, p_post_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
declare
  v_user uuid := auth.uid();
  v_liked boolean;
  v_count int;
  v_exists boolean;
  v_author uuid;
  v_month_earned int;
  c_reward int := 1;         -- 좋아요 1개당 작성자 적립 포인트(쿠마님 확정: 1)
  c_month_cap int := 2000;   -- 작성자 월 적립 상한(인플레/어뷰징 방어)
begin
  if v_user is null then raise exception 'auth required'; end if;
  if not exists (
    select 1 from public.profiles
    where id = v_user and coalesce(phone_verified, false) = true and coalesce(is_banned, false) = false
  ) then
    raise exception 'phone verification required';
  end if;
  if p_board_type not in ('destinations','reviews','qna_posts','companion_posts','crew_posts','itinerary_posts') then
    raise exception 'invalid board_type';
  end if;
  if p_post_id is null then raise exception 'post not found'; end if;

  delete from public.post_likes
    where user_id = v_user and board_type = p_board_type and post_id = p_post_id;
  if found then
    v_liked := false;   -- 취소는 대상 존재 확인 없이 허용(삭제된 글의 잔여 행 정리 경로 보존)
  else
    v_exists := case p_board_type
      when 'destinations'     then exists (select 1 from public.destinations     where id = p_post_id)
      when 'reviews'          then exists (select 1 from public.reviews          where id = p_post_id)
      when 'qna_posts'        then exists (select 1 from public.qna_posts        where id = p_post_id)
      when 'companion_posts'  then exists (select 1 from public.companion_posts  where id = p_post_id)
      when 'crew_posts'       then exists (select 1 from public.crew_posts       where id = p_post_id)
      when 'itinerary_posts'  then exists (select 1 from public.itinerary_posts  where id = p_post_id)
    end;
    if not coalesce(v_exists, false) then raise exception 'post not found'; end if;

    insert into public.post_likes(user_id, board_type, post_id)
      values (v_user, p_board_type, p_post_id);
    v_liked := true;

    v_author := case p_board_type
      when 'destinations'     then (select user_id from public.destinations     where id = p_post_id)
      when 'reviews'          then (select user_id from public.reviews          where id = p_post_id)
      when 'qna_posts'        then (select user_id from public.qna_posts        where id = p_post_id)
      when 'companion_posts'  then (select user_id from public.companion_posts  where id = p_post_id)
      when 'crew_posts'       then (select user_id from public.crew_posts       where id = p_post_id)
      when 'itinerary_posts'  then (select user_id from public.itinerary_posts  where id = p_post_id)
    end;

    if p_board_type = 'crew_posts'
       and v_author is not null and v_author <> v_user
       and exists (select 1 from public.profiles where id = v_author and user_type = 'crew' and coalesce(crew_verified, false) = true) then
      select coalesce(sum(amount), 0) into v_month_earned
        from public.point_transactions
        where user_id = v_author and type = 'like_earn'
          and created_at >= date_trunc('month', now());
      if v_month_earned < c_month_cap then
        perform set_config('app.allow_sensitive', 'on', true);
        update public.profiles
          set points_balance = coalesce(points_balance, 0) + c_reward, updated_at = now()
          where id = v_author;
        insert into public.point_transactions(user_id, amount, type, description)
          values (v_author, c_reward, 'like_earn', '게시글 좋아요 보상');
      end if;
    end if;
  end if;

  select count(*) into v_count
    from public.post_likes where board_type = p_board_type and post_id = p_post_id;
  return jsonb_build_object('liked', v_liked, 'likes_count', v_count);
end;
$$;
REVOKE ALL ON FUNCTION public.toggle_post_like(text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.toggle_post_like(text, uuid) TO authenticated;

-- [codex-21] 이미 쌓인 유령 행 정리는 이 마이그레이션에 넣지 않는다.
--   운영 데이터를 지우는 작업이라 별도 판단이 필요하고, 위 패치만으로 신규 유입은 막힌다.
--   지우기로 결정하면 아래를 1회 수동 실행한다.
-- DELETE FROM public.post_likes pl WHERE NOT EXISTS (
--   SELECT 1 FROM public.destinations     d  WHERE d.id  = pl.post_id AND pl.board_type = 'destinations'
--   UNION ALL SELECT 1 FROM public.reviews          r  WHERE r.id  = pl.post_id AND pl.board_type = 'reviews'
--   UNION ALL SELECT 1 FROM public.qna_posts        q  WHERE q.id  = pl.post_id AND pl.board_type = 'qna_posts'
--   UNION ALL SELECT 1 FROM public.companion_posts  c  WHERE c.id  = pl.post_id AND pl.board_type = 'companion_posts'
--   UNION ALL SELECT 1 FROM public.crew_posts       cp WHERE cp.id = pl.post_id AND pl.board_type = 'crew_posts'
--   UNION ALL SELECT 1 FROM public.itinerary_posts  ip WHERE ip.id = pl.post_id AND pl.board_type = 'itinerary_posts'
-- );

-- add_keyword_notification: 운영 정의 + 'itinerary' 분기(글 단위 링크)
CREATE OR REPLACE FUNCTION public.add_keyword_notification(p_post_id uuid, p_post_type text, p_keyword text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_me uuid := auth.uid(); v_link text; v_region text;
BEGIN
  IF v_me IS NULL THEN RAISE EXCEPTION 'auth required'; END IF;
  IF p_post_id IS NULL OR p_keyword IS NULL OR length(p_keyword) > 50 THEN RAISE EXCEPTION 'bad request'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.user_keywords WHERE user_id = v_me AND keyword = p_keyword) THEN RETURN; END IF;
  CASE p_post_type
    WHEN 'qna' THEN IF NOT EXISTS (SELECT 1 FROM public.qna_posts WHERE id = p_post_id) THEN RETURN; END IF; v_link := '/qna';
    WHEN 'market' THEN IF NOT EXISTS (SELECT 1 FROM public.market_listings WHERE id = p_post_id) THEN RETURN; END IF; v_link := '/market';
    WHEN 'reviews' THEN IF NOT EXISTS (SELECT 1 FROM public.reviews WHERE id = p_post_id) THEN RETURN; END IF; v_link := '/reviews';
    WHEN 'destinations' THEN SELECT region_id INTO v_region FROM public.destinations WHERE id = p_post_id; IF NOT FOUND THEN RETURN; END IF; v_link := '/recommend' || COALESCE('/' || v_region, '');
    WHEN 'companion' THEN SELECT region_id INTO v_region FROM public.companion_posts WHERE id = p_post_id; IF NOT FOUND THEN RETURN; END IF; v_link := '/companion' || COALESCE('/' || v_region, '');
    WHEN 'itinerary' THEN IF NOT EXISTS (SELECT 1 FROM public.itinerary_posts WHERE id = p_post_id) THEN RETURN; END IF; v_link := '/itinerary/' || p_post_id::text;
    ELSE RAISE EXCEPTION 'bad post type';
  END CASE;
  PERFORM public.notify_user(v_me, 'keywords', 'keyword', '''' || p_keyword || ''' 키워드의 새 글이 올라왔습니다', v_link, p_post_id, NULL);
END; $$;
-- 운영 DB 는 CREATE OR REPLACE 가 기존 ACL 을 보존하지만, 함수가 없는 DB(브랜치·신규 프로젝트)에
-- 이 파일만 돌리면 기본 PUBLIC EXECUTE 로 생성된다. 원본(notifications_20260903.sql)과 같게 맞춘다.
REVOKE ALL ON FUNCTION public.add_keyword_notification(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.add_keyword_notification(uuid, text, text) TO authenticated;

-- ============================================================================
-- ROLLBACK (필요 시 수동 실행) — v2 신규 객체 포함
--
-- -- 1) RPC·헬퍼 함수
-- DROP FUNCTION IF EXISTS public.planner_import(uuid, text), public.planner_board_sync_list(),
--   public.planner_board_sync_state(uuid), public.planner_bump_post_view(uuid), public.planner_unpublish(uuid),
--   public.planner_publish_to_board(uuid), public.planner_get_shared(text), public.planner_revoke_share(uuid),
--   public.planner_create_share(uuid), public.planner_summary_text(jsonb), public.planner_build_snapshot(uuid),
--   public.planner_submit_review(uuid, integer, text, text),
--   public.planner_reviews_of(uuid), public.planner_catalog_group(uuid), public.planner_catalog_root(uuid),
--   public.planner_merge_catalog(uuid, uuid),
--   public.planner_upsert_catalog(text, text, text, text, double precision, double precision, jsonb),
--   public.planner_reorder_places(uuid, uuid, uuid[]), public.planner_set_dates(uuid, date, date, boolean),
--   public.planner_create_trip(text, date, date, text, text), public.planner_rate_hit(text, integer),
--   public.planner_geo_slot(text, integer, integer), public.planner_google_enabled(),
--   public.planner_day_places_fp(uuid);
--
-- -- 2) 트리거 함수(트리거는 테이블과 함께 사라지지만, 함수는 따로 지운다)
-- DROP FUNCTION IF EXISTS public.planner_invalidate_legs(), public.planner_queue_ticket_object(),
--   public.planner_catalog_canonical_guard(), public.planner_owner_guard(), public.planner_touch_updated_at();
--
-- -- 3) 뷰
-- DROP VIEW IF EXISTS public.planner_ticket_orphans;
--
-- -- 4) 테이블(서로 참조하므로 한 문장에 나열. 필요하면 CASCADE)
-- DROP TABLE IF EXISTS public.itinerary_posts, public.planner_shares, public.planner_place_reviews,
--   public.planner_tickets, public.planner_places, public.planner_catalog, public.planner_days,
--   public.planner_trips, public.planner_route_cache, public.planner_link_cache, public.planner_rate_buckets,
--   public.planner_provider_gate, public.planner_place_search_cache, public.planner_orphan_objects,
--   public.planner_settings;
--
-- -- 5) Storage
-- DROP POLICY IF EXISTS "planner tickets storage select own" ON storage.objects;
-- DROP POLICY IF EXISTS "planner tickets storage insert own" ON storage.objects;
-- DROP POLICY IF EXISTS "planner tickets storage delete own" ON storage.objects;
-- DELETE FROM storage.buckets WHERE id = 'planner-tickets';
--   (실파일은 Storage API 로 따로 지운다. 버킷 행 삭제만으로는 남는다.)
--
-- -- 6) 기존 객체 원복
-- ALTER TABLE public.post_likes DROP CONSTRAINT IF EXISTS post_likes_board_type_check;
-- ALTER TABLE public.post_likes ADD CONSTRAINT post_likes_board_type_check
--   CHECK (board_type IN ('destinations','reviews','qna_posts','companion_posts','crew_posts'));
-- toggle_post_like / add_keyword_notification 은 likes_economy.sql / notifications_20260903.sql 원본으로 복구.
--
-- -- 7) 위 4)에서 테이블을 통째로 지우지 않고 v1 로만 되돌릴 때 추가로 필요한 것
-- ALTER TABLE public.planner_trips DROP CONSTRAINT IF EXISTS planner_trips_timezone_check;
-- ALTER TABLE public.planner_trips DROP COLUMN IF EXISTS timezone;
-- ALTER TABLE public.planner_days  DROP CONSTRAINT IF EXISTS planner_days_day_index_range;
-- ALTER TABLE public.planner_days  DROP CONSTRAINT IF EXISTS planner_days_legs_shape;
-- ALTER TABLE public.planner_places DROP CONSTRAINT IF EXISTS planner_places_sort_order_nonneg;
-- ALTER TABLE public.planner_tickets DROP CONSTRAINT IF EXISTS planner_tickets_path_shape;
-- ALTER TABLE public.itinerary_posts DROP CONSTRAINT IF EXISTS itinerary_posts_dates_check;
-- ALTER TABLE public.itinerary_posts DROP CONSTRAINT IF EXISTS itinerary_posts_counters_check;
-- ALTER TABLE public.planner_catalog DROP CONSTRAINT IF EXISTS planner_catalog_canonical_not_self;
-- ALTER TABLE public.planner_catalog DROP COLUMN IF EXISTS canonical_id;
-- ALTER TABLE public.planner_shares  DROP COLUMN IF EXISTS expires_at;
-- DROP TRIGGER IF EXISTS trg_planner_catalog_canonical ON public.planner_catalog;
-- DROP TRIGGER IF EXISTS trg_planner_places_invalidate_legs ON public.planner_places;
-- DROP TRIGGER IF EXISTS trg_planner_tickets_queue_object ON public.planner_tickets;
-- GRANT UPDATE ON public.planner_trips TO authenticated;                       -- 컬럼 단위 → 전체로 복구
-- GRANT INSERT, UPDATE, DELETE ON public.planner_days TO authenticated;        -- RPC 전용 → 복구
-- GRANT SELECT ON public.planner_catalog TO anon;                              -- anon 열람 복구
-- DROP POLICY IF EXISTS "planner catalog read linked" ON public.planner_catalog;
-- CREATE POLICY "planner catalog read" ON public.planner_catalog FOR SELECT TO anon, authenticated USING (true);
-- DROP INDEX IF EXISTS public.idx_planner_catalog_latlng;
-- DROP INDEX IF EXISTS public.idx_planner_places_user_catalog;
-- DROP INDEX IF EXISTS public.idx_planner_shares_live;
-- ALTER TABLE public.planner_catalog ADD COLUMN IF NOT EXISTS rating numeric;                 -- codex-2 로 지운 죽은 컬럼
-- ALTER TABLE public.planner_catalog ADD COLUMN IF NOT EXISTS user_rating_count integer;
-- -- 4-arg planner_set_dates 를 v1 3-arg 로 되돌릴 때는 먼저 DROP 해야 오버로드가 겹치지 않는다:
-- DROP FUNCTION IF EXISTS public.planner_set_dates(uuid, date, date, boolean);
-- -- 그 뒤 planner_20260904.sql(v1)의 3-arg planner_set_dates 정의를 그대로 다시 실행한다.
-- ============================================================================
