-- 보안 점검 후속 조치 (2026-09-05)
--
-- 근거: Supabase security advisor 91건을 전수 확인해, 실제로 손댈 값어치가 있는 것만 담았다.
--   · authenticated/anon 이 SECURITY DEFINER 함수를 실행할 수 있다(67건) — 설계 그대로다.
--     PostgREST 로 부르라고 만든 RPC 이고, 각 함수가 안에서 auth.uid() 로 스스로를 지킨다.
--     다만 그중 "트리거 전용" 함수 넷은 아무도 직접 부를 일이 없으므로 권한을 회수한다(아래 3).
--   · RLS 는 켜졌는데 정책이 없다(19건) — OTP·본인확인·결제·캐시·레이트버킷 테이블이다.
--     정책이 없으면 anon·authenticated 는 한 줄도 못 읽는다. 서버(service_role)만 쓰는 게 의도다.
--     클라이언트 코드가 이 테이블들을 직접 읽는 곳이 하나도 없음을 확인했다. 그대로 둔다.
--   · 유출 비밀번호 차단이 꺼져 있다(1건) — SQL 이 아니라 대시보드 설정이라 여기서 못 고친다.
--
-- 되돌리기: 아래 셋 다 ALTER/GRANT 한 줄로 원복된다. 데이터는 건드리지 않는다.
-- 다만 flight_board_writable 을 다시 IMMUTABLE 로 되돌리는 건 논리적으로 틀린 롤백이다
-- (본문에 CURRENT_DATE 가 있는 한 STABLE 이 맞다). 문제가 생기면 다른 방법을 찾을 것.
--
-- 한 덩어리로 적용한다. 중간에 하나라도 실패하면 전부 되돌아간다.
BEGIN;

-- 1) search_path 고정 --------------------------------------------------------
-- 고정하지 않은 함수는 호출자가 search_path 를 바꿔 같은 이름의 다른 함수·연산자를 태울 수 있다.
-- 네 함수 모두 pg_catalog 내장만 쓰므로(regexp_replace·split_part·lower·btrim·now·CURRENT_DATE)
-- public 을 뺀 최소 경로로 묶는다.
ALTER FUNCTION public.canon_phone(text)           SET search_path = pg_catalog, pg_temp;
ALTER FUNCTION public.canon_airline_email(text)   SET search_path = pg_catalog, pg_temp;
ALTER FUNCTION public.ct_payment_orders_freeze()  SET search_path = pg_catalog, pg_temp;
ALTER FUNCTION public.flight_board_writable(date) SET search_path = pg_catalog, pg_temp;

-- 2) flight_board_writable 의 변동성 정정 -------------------------------------
-- CURRENT_DATE 를 쓰면서 IMMUTABLE 로 선언돼 있었다. IMMUTABLE 은 "같은 입력이면 영원히 같은 값"이라는
-- 약속이라, 계획 캐시가 그 값을 접어 두면 글쓰기 창(출발 21일 전 ~ 당일)이 닫힌 뒤에도 통과할 수 있다.
-- 이 함수는 인덱스·제약·생성열 어디에도 쓰이지 않고 RLS WITH CHECK 두 곳(flight_posts,
-- flight_post_comments)에서만 쓰이므로 STABLE 로 바꿔도 재빌드가 필요 없다.
ALTER FUNCTION public.flight_board_writable(date) STABLE;

-- 3) 트리거 전용 함수의 직접 실행 권한 회수 -----------------------------------
-- PostgreSQL 은 트리거가 "생성될 때"만 EXECUTE 권한을 보고, 발화할 때는 보지 않는다.
-- 그래서 지금 회수해도 트리거는 그대로 돈다. 직접 호출은 어차피 에러지만, 남겨 둘 이유가 없다.
--
-- 주의: 회수 뒤에는 이 함수로 트리거를 "다시 만들 때" EXECUTE 권한이 필요하다.
-- Supabase 마이그레이션은 함수 소유자(postgres)로 도니 문제없지만, 다른 롤로 트리거를
-- 재생성하려 하면 권한 오류가 난다. 그때는 소유자로 실행하거나 임시로 GRANT 후 회수할 것.
REVOKE ALL ON FUNCTION public.ct_payment_orders_freeze()           FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.flight_board_content_guard()         FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.flight_schedules_guard()             FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.flight_schedules_sync_from_profile() FROM PUBLIC, anon, authenticated;

-- 확인 --------------------------------------------------------------------
-- select proname, provolatile, array_to_string(proconfig,',') , proacl
--   from pg_proc p join pg_namespace n on n.oid=p.pronamespace
--  where n.nspname='public' and proname in
--        ('canon_phone','canon_airline_email','ct_payment_orders_freeze','flight_board_writable',
--         'flight_board_content_guard','flight_schedules_guard','flight_schedules_sync_from_profile');

COMMIT;

-- ===========================================================================
-- 2차 (같은 날, agy 검토 반영). 위 COMMIT 뒤에 별도로 적용했다.
-- ===========================================================================

-- 4) SECURITY DEFINER 함수의 search_path 에 pg_temp 를 명시 ------------------
-- pg_temp 를 안 적으면 PostgreSQL 이 임시 스키마를 "맨 앞에서" 암묵적으로 찾는다.
-- 그래서 search_path=public 만 걸린 SECURITY DEFINER 함수는, 공격자가 같은 이름의 임시
-- 테이블·타입을 만들어 소유자 권한 실행 흐름을 가로챌 수 있다(권한 상승).
-- 맨 뒤에 명시하면 막힌다. public 이 그대로 앞이라 본문의 참조 해석은 달라지지 않는다.
-- 적용 대상 44개(= 당시 pg_temp 없던 전부), 적용 후 0개 확인.
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure::text AS sig
      FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
     WHERE ns.nspname = 'public' AND p.prokind = 'f' AND p.prosecdef
       AND p.proconfig @> ARRAY['search_path=public']
  LOOP
    EXECUTE format('ALTER FUNCTION %s SET search_path = public, pg_catalog, pg_temp', r.sig);
  END LOOP;
  FOR r IN
    SELECT p.oid::regprocedure::text AS sig
      FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
     WHERE ns.nspname = 'public' AND p.prokind = 'f' AND p.prosecdef
       AND p.proconfig @> ARRAY['search_path=pg_catalog']
  LOOP
    EXECUTE format('ALTER FUNCTION %s SET search_path = pg_catalog, pg_temp', r.sig);
  END LOOP;
END $$;

-- 5) 항공편 게시판 글쓰기 창을 한국 날짜로 판단 ------------------------------
-- CURRENT_DATE 는 세션 타임존을 따르고 PostgREST 세션은 UTC 다. 그래서 한국 자정~오전 9시
-- 사이에는 DB 가 "어제"로 셌다. 실측(2026-09-05 01:5x KST): 한국 2026-09-05 / DB 2026-09-04.
-- 이용자가 보는 날짜가 한국 날짜이므로 기준도 한국 날짜여야 한다.
CREATE OR REPLACE FUNCTION public.flight_board_writable(p_date date)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = pg_catalog, pg_temp
AS $function$
  SELECT ((now() AT TIME ZONE 'Asia/Seoul')::date) >= (p_date - 21)
     AND ((now() AT TIME ZONE 'Asia/Seoul')::date) <= p_date;
$function$;

-- 6) 개인정보 최소 보관 ------------------------------------------------------
-- 암호화보다 확실한 건 안 갖고 있는 것이다. 본인확인 원본(이름·생년월일·전화·IP)은
-- 가입에 한 번 쓰이고 그 뒤로 아무도 읽지 않는다. 소비 1시간 뒤 지운다.
-- 중복·차단 판정용 ci_hash, 재사용 방지용 provider_ref, 감사용 consumed_at/by 는 남긴다.
-- (본문은 별도 마이그레이션 privacy_scrub_and_retention 으로 적용, pg_cron 매시 17분)
--   select cron.schedule('privacy-scrub', '17 * * * *', $q$select public.privacy_scrub()$q$);

-- 검토자 의견 중 반려한 것 --------------------------------------------------
-- [agy] "트리거 함수 REVOKE 는 실효성 없는 조치다" — 절반만 동의한다. 공격 표면이 줄지 않는 건
--   맞지만 비용이 0 이고 점검 경고가 사라진다. 마이그레이션 실패 위험은 주석으로 남겼다. 유지.
-- [agy] "DELETE 정책에도 글쓰기 기간을 걸었는지 확인하라" — 확인했고 걸지 않는 게 맞다.
--   flight_posts/flight_post_comments 의 DELETE 는 본인 또는 관리자다. 기간이 지난 자기 글을
--   지우는 건 막을 이유가 없다. UPDATE 정책은 아예 없어 수정 자체가 차단돼 있다.
