-- 2026-09-14 이용약관·개인정보처리방침 개정에 맞춰 가입 동의 기록 버전을 올린다.
--   개정 내용: 칭찬매칭·추천코드·포인트 기능 숨김(src/lib/featureFlags.js)에 따라 포인트·매칭신청권 조항과
--   칭찬매칭/포인트 이용 목적을 화면 문서에서 내림(주소는 같은 날 쿠마님 지시로 계속 수집 — 목적을 이벤트 경품 배송으로 정리),
--   Google LLC(여행 플래너 지도·장소·경로) 위탁·국외이전 고지 추가.
--   user_consents 에 'terms'·'privacy'·'age14' 로 남는 policy_version 이 화면의 '최종 개정일'과 같아야 한다(Privacy.jsx 상단 주석).
--
-- 방식: 운영 함수 정의를 그대로 읽어 v_policy_version 상수 한 줄만 치환해 재정의한다.
--   함수 본문 전체를 손으로 다시 쓰면 이후 마이그레이션(pii 암호화 등)에서 바뀐 로직을 덮어쓸 위험이 있어서다.
--   CREATE OR REPLACE 는 소유자·권한(GRANT)·SECURITY DEFINER·search_path 설정을 유지한다.
-- 적용 전 실측(2026-09-14): 상수는 public.complete_signup_profile_for 한 곳에만 있다
--   (complete_signup_profile / complete_signup_profile_admin 은 이 함수를 호출하는 래퍼).

DO $$
DECLARE
  v_oid oid;
  v_cnt int;
  v_def text;
  v_new text;
BEGIN
  SELECT count(*), min(p.oid) INTO v_cnt, v_oid
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'complete_signup_profile_for';
  IF v_cnt <> 1 THEN
    RAISE EXCEPTION 'complete_signup_profile_for overload count = % (expected 1)', v_cnt;
  END IF;

  v_def := pg_get_functiondef(v_oid);
  v_new := replace(v_def,
    'v_policy_version CONSTANT TEXT := ''2026-09-02'';',
    'v_policy_version CONSTANT TEXT := ''2026-09-14'';');
  IF v_new = v_def THEN
    RAISE EXCEPTION 'policy_version constant 2026-09-02 not found';
  END IF;
  EXECUTE v_new;
END $$;
