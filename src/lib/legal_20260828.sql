-- ============================================================
-- ConnectTrip 보안·법규 마이그레이션 (2026-08-28)
--
-- 2026-08-28 감사에서 확정된 두 건을 처리한다. 두 마이그레이션 모두 운영 DB
-- (Supabase travelers-hub / owhtldabzcvavsazdufy)에 이미 적용·검증했다.
-- 이 파일은 그 내용을 저장소에 남기기 위한 기록본이다. 재실행해도 안전하다(멱등).
--
--   1) 쪽지 본문 변조 차단
--      messages 의 RLS 정책은 행 범위(수신자 본인)만 제한했고 컬럼 권한은 전 컬럼에
--      열려 있었다. 그래서 쪽지를 받은 쪽이 상대방이 보낸 content 를 마음대로
--      고쳐 쓸 수 있었다. 클라이언트의 messages UPDATE 경로는 db.js markAsRead 의
--      read_at 하나뿐임을 전수 확인하고 컬럼 단위로 좁혔다.
--
--   2) 가입 동의 이력
--      실제 가입 폼(SignupEmail/SignupComplete)에 개인정보 수집·이용 동의 절차가
--      없었다. 동의 기록을 profiles_private 에 두면 본인 UPDATE 정책 때문에 사후
--      변경이 가능해 입증력이 약하다. 그래서 append-only 전용 테이블로 분리하고
--      쓰기는 SECURITY DEFINER 함수로만 되게 했다.
--
-- 배포 순서: SQL 먼저 → 프런트 push. (legal_20260711.sql 과 같은 원칙)
--   지금 p_terms_agreed_at / p_privacy_agreed_at 은 DEFAULT NULL 인 선택 인자다.
--   구버전 클라이언트가 13인자로 호출해도 깨지지 않는다. 프런트 배포가 끝나고
--   실제 가입 1건으로 동의 기록을 확인한 뒤 필수로 조인다(아래 3단계 참조).
-- ============================================================


-- ── 1) 쪽지: read_at 만 갱신 가능하게 ─────────────────────────────────────────
-- 주의: 컬럼 GRANT 는 RLS 위에 곱해진다. 기존 RLS 정책은 그대로 두면 된다.
-- service_role 은 REVOKE 대상이 아니라 관리자/서버 작업은 영향 없다.
REVOKE UPDATE ON TABLE public.messages FROM anon, authenticated;
GRANT UPDATE (read_at) ON TABLE public.messages TO authenticated;


-- ── 2) 동의 이력 테이블 (append-only) ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.user_consents (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  policy_type    text NOT NULL CHECK (policy_type IN ('terms', 'privacy', 'age14')),
  policy_version text NOT NULL,
  agreed_at      timestamptz NOT NULL DEFAULT now(),
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS user_consents_user_idx
  ON public.user_consents (user_id, policy_type, agreed_at DESC);

ALTER TABLE public.user_consents ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS user_consents_select_own ON public.user_consents;
CREATE POLICY user_consents_select_own ON public.user_consents
  FOR SELECT TO authenticated USING (user_id = auth.uid());

-- 본인 조회만 허용. INSERT/UPDATE/DELETE 권한을 아예 주지 않아 append-only 가 된다.
REVOKE ALL ON TABLE public.user_consents FROM anon, authenticated;
GRANT SELECT ON TABLE public.user_consents TO authenticated;


-- ── 3) complete_signup_profile 에 동의 인자 추가 ─────────────────────────────
-- 기본값을 가진 인자를 덧붙이면 기존 13인자 호출이 두 함수 모두에 매칭돼
-- "function is not unique" 가 된다. 반드시 기존 시그니처를 DROP 하고 새로 만든다.
--
-- 함수 본문은 운영 DB 에 적용된 것과 동일하다. 전문은 아래 명령으로 확인할 수 있다.
--   select pg_get_functiondef(p.oid) from pg_proc p
--     join pg_namespace n on n.oid = p.pronamespace
--    where n.nspname = 'public' and p.proname = 'complete_signup_profile';
--
-- 기존 검증 로직(연령·번호 중복·OTP 소비·승무원 도메인)은 한 줄도 바꾸지 않았고,
-- 프로필 UPDATE 뒤에 아래 블록만 덧붙였다:
--
--   IF p_terms_agreed_at IS NOT NULL THEN
--     INSERT INTO public.user_consents (user_id, policy_type, policy_version)
--     VALUES (auth.uid(), 'terms', v_policy_version);
--   END IF;
--   IF p_privacy_agreed_at IS NOT NULL THEN
--     INSERT INTO public.user_consents (user_id, policy_type, policy_version)
--     VALUES (auth.uid(), 'privacy', v_policy_version);
--     INSERT INTO public.user_consents (user_id, policy_type, policy_version)
--     VALUES (auth.uid(), 'age14', v_policy_version);
--   END IF;
--
-- 동의 시각은 클라이언트가 보낸 값을 믿지 않고 서버 시각(DEFAULT now())으로 남긴다.
-- 인자는 "동의했다"는 신호로만 쓴다. 만 14세는 생년월일 검증이 이미 통과한 뒤이므로
-- privacy 동의와 함께 기록한다.
--
-- 권한은 기존과 동일하게 복원했다:
--   REVOKE ALL ... FROM PUBLIC, anon;
--   GRANT EXECUTE ... TO authenticated, service_role;


-- ── 4) 프런트 배포 뒤에 실행할 것 (아직 실행하지 않음) ────────────────────────
-- 새 가입 폼이 배포되고 실제 가입 1건으로 user_consents 에 terms/privacy/age14 세 행이
-- 남는 것을 확인한 다음, 아래를 함수 앞부분에 넣어 동의를 필수로 만든다.
--
--   IF p_terms_agreed_at IS NULL OR p_privacy_agreed_at IS NULL THEN
--     RAISE EXCEPTION 'CONSENT_REQUIRED';
--   END IF;
--
-- 이 단계를 미리 하면 아직 갱신되지 않은 클라이언트의 가입이 통째로 막힌다.
